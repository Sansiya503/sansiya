// 산시야 주가 조회 함수 (Supabase Edge Function: "quotes")
// - 주가·환율: Yahoo Finance 차트 데이터 (비공식, 한국 주식은 약 20분 지연)
// - 한국 종목 이름 검색: aikstockdata.com (전 영업일 확정 종가, 비상업적 이용·출처 표시)
// - 비트코인 블록·수수료: mempool.space 공개 API (25초 캐시)
// 로그인한 산시야 사용자만 호출할 수 있어요.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

// ---------- small in-memory caches (per function instance) ----------
const quoteCache = new Map<string, { at: number; data: Quote | null }>();
const histCache = new Map<string, { at: number; data: unknown }>();
let krList: { at: number; rows: KrRow[] } | null = null;

type Quote = {
  symbol: string; price: number; prevClose: number | null; change: number | null; changePct: number | null;
  currency: string; name: string; exchange: string; time: number | null; source: string; asOf?: string;
};
type KrRow = { code: string; name: string; market: string; close: number; change: number; changePct: number; cap: number; date: string };

async function getJson(url: string, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json,text/plain,*/*" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function yahooChart(symbol: string, range = "1d", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const j = await getJson(url);
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error(j?.chart?.error?.description || "no data");
  return res;
}

async function quoteOne(symbol: string): Promise<Quote | null> {
  const hit = quoteCache.get(symbol);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  let q: Quote | null = null;
  try {
    const res = await yahooChart(symbol, "5d", "1d");
    const m = res.meta || {};
    const closes: number[] = (res.indicators?.quote?.[0]?.close || []).filter((v: number | null) => v != null);
    const price = Number(m.regularMarketPrice ?? closes[closes.length - 1]);
    // previous close = the last daily close before today's bar
    let prev: number | null = null;
    const ts: number[] = res.timestamp || [];
    if (ts.length >= 2 && closes.length >= 2) {
      const lastBarDay = new Date((ts[ts.length - 1] + (m.gmtoffset || 0)) * 1000).toISOString().slice(0, 10);
      const marketDay = new Date(((m.regularMarketTime || ts[ts.length - 1]) + (m.gmtoffset || 0)) * 1000).toISOString().slice(0, 10);
      prev = lastBarDay === marketDay ? closes[closes.length - 2] : closes[closes.length - 1];
    }
    if (prev == null) prev = m.previousClose ?? m.chartPreviousClose ?? null;
    if (!isFinite(price)) throw new Error("no price");
    q = {
      symbol, price, prevClose: prev,
      change: prev != null ? price - prev : null,
      changePct: prev ? ((price - prev) / prev) * 100 : null,
      currency: m.currency || (symbol.endsWith(".KS") || symbol.endsWith(".KQ") ? "KRW" : "USD"),
      name: m.longName || m.shortName || symbol,
      exchange: m.fullExchangeName || m.exchangeName || "",
      time: m.regularMarketTime || null,
      source: "yahoo",
    };
  } catch (_e) {
    // fallback for Korean stocks: previous business day's official close
    const code = symbol.split(".")[0];
    if (/^\d{6}$/.test(code)) {
      const row = (await loadKrList().catch(() => [])).find((r) => r.code === code);
      if (row) {
        q = {
          symbol, price: row.close, prevClose: row.close - row.change, change: row.change, changePct: row.changePct,
          currency: "KRW", name: row.name, exchange: row.market, time: null, source: "krx-close", asOf: row.date,
        };
      }
    }
  }
  quoteCache.set(symbol, { at: Date.now(), data: q });
  return q;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  });
  await Promise.all(workers);
  return out;
}

async function loadKrList(): Promise<KrRow[]> {
  if (krList && Date.now() - krList.at < 6 * 3600_000) return krList.rows;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  const r = await fetch("https://aikstockdata.com/data/public/quotes_en.csv", { signal: ctl.signal }).finally(() => clearTimeout(t));
  if (!r.ok) throw new Error(`KR list HTTP ${r.status}`);
  const text = await r.text();
  const lines = text.split(/\r?\n/);
  const head = lines.shift()!.split(",");
  const ix = (k: string) => head.indexOf(k);
  const iDate = ix("base_date"), iCode = ix("code"), iName = ix("name_ko"), iMkt = ix("market"), iClose = ix("close"),
    iChg = ix("change"), iPct = ix("change_pct"), iCap = ix("market_cap_krw");
  const rows: KrRow[] = [];
  for (const line of lines) {
    if (!line) continue;
    const c = line.split(",");
    const market = c[iMkt];
    if (market !== "KOSPI" && market !== "KOSDAQ") continue;
    rows.push({
      code: c[iCode], name: c[iName], market, close: +c[iClose], change: +c[iChg], changePct: +c[iPct], cap: +c[iCap] || 0,
      date: c[iDate] ? `${c[iDate].slice(0, 4)}-${c[iDate].slice(4, 6)}-${c[iDate].slice(6, 8)}` : "",
    });
  }
  rows.sort((a, b) => b.cap - a.cap);
  krList = { at: Date.now(), rows };
  return rows;
}

const krSymbol = (r: KrRow) => `${r.code}.${r.market === "KOSPI" ? "KS" : "KQ"}`;
const US_EXCH = new Set(["NMS", "NYQ", "NGM", "NCM", "PCX", "ASE", "BTS", "NAS", "NYS", "PNK"]);

async function search(q: string) {
  q = q.trim();
  if (!q) return [];
  const out: Array<{ symbol: string; name: string; market: "KR" | "US"; exchange: string; currency: string; type: string }> = [];
  const seen = new Set<string>();
  const add = (x: typeof out[number]) => { if (!seen.has(x.symbol)) { seen.add(x.symbol); out.push(x); } };

  const hangul = /[가-힣]/.test(q);
  const digits = /^\d{1,6}$/.test(q);
  if (hangul || digits) {
    const rows = await loadKrList().catch(() => [] as KrRow[]);
    const ql = q.toLowerCase().replace(/\s+/g, "");
    for (const r of rows) {
      if (out.length >= 15) break;
      if (digits ? r.code.startsWith(q) : r.name.toLowerCase().replace(/\s+/g, "").includes(ql)) {
        add({ symbol: krSymbol(r), name: r.name, market: "KR", exchange: r.market === "KOSPI" ? "코스피" : "코스닥", currency: "KRW", type: "EQUITY" });
      }
    }
    // 6-digit code not in the list (e.g. ETFs): try Yahoo directly
    if (/^\d{6}$/.test(q) && !out.length) {
      for (const suf of ["KS", "KQ"]) {
        const qq = await quoteOne(`${q}.${suf}`);
        if (qq) { add({ symbol: qq.symbol, name: qq.name, market: "KR", exchange: suf === "KS" ? "코스피" : "코스닥", currency: "KRW", type: "ETF/기타" }); break; }
      }
    }
  }
  if (!hangul) {
    try {
      const j = await getJson(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0&lang=en-US&region=US`);
      for (const it of j?.quotes || []) {
        if (!it.symbol || !["EQUITY", "ETF"].includes(it.quoteType)) continue;
        const sym: string = it.symbol;
        if (/\.(KS|KQ)$/.test(sym)) {
          const code = sym.split(".")[0];
          const row = (krList?.rows || []).find((r) => r.code === code);
          add({ symbol: sym, name: row?.name || it.longname || it.shortname || sym, market: "KR", exchange: sym.endsWith(".KS") ? "코스피" : "코스닥", currency: "KRW", type: it.quoteType });
        } else if (!sym.includes(".") && US_EXCH.has(it.exchange)) {
          add({ symbol: sym, name: it.longname || it.shortname || sym, market: "US", exchange: it.exchDisp || it.exchange, currency: "USD", type: it.quoteType });
        }
      }
    } catch (_e) { /* search is best-effort */ }
  }
  return out.slice(0, 20);
}

async function history(symbol: string, range: string) {
  const plan: Record<string, [string, string]> = {
    "1d": ["1d", "5m"], "5d": ["5d", "30m"], "1mo": ["1mo", "1d"], "3mo": ["3mo", "1d"], "1y": ["1y", "1d"], "5y": ["5y", "1wk"],
  };
  const [r, iv] = plan[range] || plan["3mo"];
  const key = `${symbol}|${r}`;
  const hit = histCache.get(key);
  if (hit && Date.now() - hit.at < (r === "1d" || r === "5d" ? 60_000 : 10 * 60_000)) return hit.data;
  const res = await yahooChart(symbol, r, iv);
  const ts: number[] = res.timestamp || [];
  const cl: (number | null)[] = res.indicators?.quote?.[0]?.close || [];
  const points: [number, number][] = [];
  ts.forEach((t, i) => { const v = cl[i]; if (v != null && isFinite(v)) points.push([t * 1000, Math.round(v * 10000) / 10000]); });
  const data = { symbol, range: r, currency: res.meta?.currency || "", prevClose: res.meta?.chartPreviousClose ?? null, points };
  histCache.set(key, { at: Date.now(), data });
  return data;
}

// market strip: index / FX quote plus a small intraday line (about 48 points) for the card
async function marketRow(symbol: string) {
  const [q, h] = await Promise.all([quoteOne(symbol), history(symbol, "1d").catch(() => null)]);
  if (!q) return null;
  const pts = ((h as { points?: [number, number][] } | null)?.points) || [];
  const step = Math.max(1, Math.ceil(pts.length / 48));
  const spark = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => p[1]);
  return { symbol, price: q.price, prevClose: q.prevClose, change: q.change, changePct: q.changePct, time: q.time, spark };
}

// ---------- bitcoin blocks & fees (mempool.space), cached for 25 s ----------
let mpCache: { at: number; data: unknown } | null = null;
type MpBlock = { height: number; timestamp: number; size: number; tx_count: number; extras?: { pool?: { name?: string }; medianFee?: number } };
type MpFees = { fastestFee: number; halfHourFee: number; hourFee: number; economyFee: number; minimumFee: number };
type MpProjected = { blockVSize: number; nTx: number; medianFee: number; feeRange?: number[] };
async function mempool() {
  if (mpCache && Date.now() - mpCache.at < 25_000) return mpCache.data;
  const base = "https://mempool.space/api";
  const [blocks, fees, projected] = await Promise.all([
    getJson(`${base}/v1/blocks`) as Promise<MpBlock[]>,
    (getJson(`${base}/v1/fees/precise`).catch(() => getJson(`${base}/v1/fees/recommended`))) as Promise<MpFees>,
    (getJson(`${base}/v1/fees/mempool-blocks`).catch(() => [])) as Promise<MpProjected[]>,
  ]);
  if (!Array.isArray(blocks) || !blocks.length) throw new Error("no blocks");
  const pr = Array.isArray(projected) ? projected : [];
  const data = {
    blocks: blocks.slice(0, 15).map((b) => ({ height: b.height, ts: b.timestamp, size: b.size, tx: b.tx_count, pool: b.extras?.pool?.name || "", fee: b.extras?.medianFee ?? null })),
    fees: { eco: fees?.economyFee ?? null, low: fees?.hourFee ?? null, mid: fees?.halfHourFee ?? null, high: fees?.fastestFee ?? null, min: fees?.minimumFee ?? null },
    pending: pr.length ? {
      vsize: pr.reduce((a, m) => a + (m.blockVSize || 0), 0),
      count: pr.reduce((a, m) => a + (m.nTx || 0), 0),
      next: { median: pr[0].medianFee, n: pr[0].nTx, vsize: pr[0].blockVSize, range: pr[0].feeRange || [] },
    } : null,
    src: "mempool.space",
    at: Date.now(),
  };
  mpCache = { at: Date.now(), data };
  return data;
}

async function requireUser(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const apikey = req.headers.get("apikey") || "";
  const url = Deno.env.get("SUPABASE_URL");
  if (!auth.startsWith("Bearer ") || !url) return false;
  const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    if (!(await requireUser(req))) return json({ error: "로그인이 필요해요." }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body.action || "quotes";
    if (action === "quotes") {
      const symbols: string[] = [...new Set(((body.symbols || []) as string[]).filter((s) => typeof s === "string" && /^[A-Za-z0-9.\-^=]{1,20}$/.test(s)))].slice(0, 60);
      const list = await mapLimit(symbols, 4, quoteOne);
      const quotes: Record<string, Quote> = {};
      list.forEach((q, i) => { if (q) quotes[symbols[i]] = q; });
      let fx: { usdkrw: number; time: number | null } | null = null;
      if (body.fx !== false) {
        const f = await quoteOne("KRW=X");
        if (f) fx = { usdkrw: f.price, time: f.time };
      }
      let market: Record<string, unknown> | undefined;
      if (Array.isArray(body.market)) {
        const ms: string[] = [...new Set((body.market as string[]).filter((s) => typeof s === "string" && /^[A-Za-z0-9.\-^=]{1,20}$/.test(s)))].slice(0, 8);
        const rows = await mapLimit(ms, 4, (s) => marketRow(s).catch(() => null));
        market = {};
        rows.forEach((r, i) => { if (r) market![ms[i]] = r; });
      }
      return json({ quotes, fx, market, at: Date.now() });
    }
    if (action === "search") return json({ results: await search(String(body.q || "").slice(0, 40)) });
    if (action === "history") {
      const s = String(body.symbol || "");
      if (!/^[A-Za-z0-9.\-^=]{1,20}$/.test(s)) return json({ error: "bad symbol" }, 400);
      return json(await history(s, String(body.range || "3mo")));
    }
    if (action === "mempool") return json(await mempool());
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
