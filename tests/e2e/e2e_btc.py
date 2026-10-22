import sys, re, json, math, time
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; BASE = "http://localhost:8768/"
src = open(__file__.replace("e2e_btc.py", "e2e_stocks.py")).read()
MOCK = re.search(r'MOCK = r"""(.*?)"""', src, re.S).group(1)
MOCK = MOCK.replace('''    if(body.action === "search"){''', '''    if(body.action === "mempool"){
      if(window.__mpFail) return {data:null, error:{name:"FunctionsHttpError", message:"boom", context:{json:async()=>({error:"boom"})}}};
      const pools = ["F2Pool","MARA Pool","Luxor","AntPool","Foundry USA"]; const blocks = [];
      for(let i=0;i<15;i++) blocks.push({height:972389-i, ts:Math.floor(Date.now()/1000) - (i*9+23)*60, size:1500000+i*10000, tx:3000+i, pool:pools[i%5], fee:1});
      return {data:{blocks, fees:{eco:0.2, low:0.4, mid:1.0, high:1.8, min:0.1}, pending:{vsize:25300000, count:52000, next:{median:0.5, n:3021, vsize:997000}}, src:"mempool.space", at:Date.now()}, error:null};
    }
    if(body.action === "search"){''')
assert "__mpFail" in MOCK
LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js"
FAKE_WS = r"""
(() => {
  const enc = new TextEncoder();
  window.__ws = [];
  window.__wsPrice = { up:[110458000, -0.0039], bith:[110412000, -0.0041], usdt:[1338, 0], bn:[82992, 1.20] };
  class FakeWS {
    constructor(url){ this.url = url; this.readyState = 0; this.binaryType = "blob"; this.sent = []; this.closed = false; window.__ws.push(this);
      setTimeout(() => { if(this.closed) return; this.readyState = 1; this.onopen && this.onopen({}); if(/binance/.test(url)) this._tick(); }, 60); }
    send(d){ this.sent.push(d); if(/upbit|bithumb/.test(this.url)) this._tick(); }
    _emit(o){ if(this.closed || this.readyState !== 1) return; const s = JSON.stringify(o); this.onmessage && this.onmessage({ data: /binance/.test(this.url) ? s : enc.encode(s).buffer }); }
    _tick(){ if(this.closed) return; const P = window.__wsPrice;
      if(/binance/.test(this.url)) this._emit({ e:"24hrTicker", s:"BTCUSDT", c:String(P.bn[0]), P:String(P.bn[1]) });
      else { const k = /bithumb/.test(this.url) ? P.bith : P.up; this._emit({ type:"ticker", code:"KRW-BTC", trade_price:k[0], signed_change_rate:k[1] }); this._emit({ type:"ticker", code:"KRW-USDT", trade_price:P.usdt[0], signed_change_rate:0 }); }
      clearTimeout(this._t); this._t = setTimeout(() => this._tick(), 400); }
    close(){ this.closed = true; this.readyState = 3; clearTimeout(this._t); }
  }
  window.WebSocket = FakeWS;
  window.__opened = []; window.open = u => { window.__opened.push(u); return null; };
})();
"""
NOW = int(time.time() * 1000)
STEP = {"5m":300e3, "1h":3600e3, "2h":7200e3, "4h":14400e3, "1d":86400e3, "1w":604800e3}
def kl(interval, limit):
    rows = []
    for i in range(limit):
        t = NOW - (limit - i) * STEP[interval]
        o = 60000 + 40000 * math.sin(i / limit * 3) + i * 30
        c = o * (1.01 if i % 3 else 0.988)
        rows.append([int(t), f"{o:.2f}", f"{max(o, c) * 1.003:.2f}", f"{min(o, c) * 0.997:.2f}", f"{c:.2f}", "1", int(t + STEP[interval] - 1), "1", 1, "1", "1", "0"])
    return rows
def bci(name, span):
    n = {"7days":7, "30days":30, "1year":365, "5years":260, "10years":520, "all":800}.get(span, 100)
    vals = []
    for i in range(n):
        x = (NOW / 1000) - (n - i) * 86400 * (1 if span in ("7days", "30days", "1year") else 7)
        y = (1e14 * (1 + i / n)) if name == "difficulty" else (9e8 * (0.2 + i / n)) if name == "hash-rate" else (1000 + 110000 * (i / n) ** 2)
        vals.append({"x": int(x), "y": y})
    return {"status":"ok", "values":vals}
REQ = []
def api(route):
    u = route.request.url; REQ.append(u); body = None; ctype = "application/json"
    if "api.upbit.com/v1/ticker" in u: body = [{"market":"KRW-BTC","trade_price":110458000,"signed_change_rate":-0.0039},{"market":"KRW-USDT","trade_price":1338,"signed_change_rate":0}]
    elif "api.bithumb.com/v1/ticker" in u: body = [{"market":"KRW-BTC","trade_price":110412000,"signed_change_rate":-0.0041},{"market":"KRW-USDT","trade_price":1338,"signed_change_rate":0}]
    elif "/api/v3/ticker/24hr" in u: body = {"lastPrice":"82992.00","priceChangePercent":"1.200"}
    elif "/api/v3/klines" in u:
        m = re.search(r"interval=(\w+)&limit=(\d+)", u); body = kl(m.group(1), int(m.group(2)))
    elif "api.coingecko.com" in u: body = {"data":{"market_cap_percentage":{"btc":59.5,"eth":10.1}}}
    elif "api.alternative.me" in u: body = {"name":"Fear and Greed Index","data":[{"value":"55","value_classification":"Greed"}]}
    elif "blockstream.info/api/blocks/tip/height" in u: body = "972389"; ctype = "text/plain"
    elif "blockstream.info/api/blocks" in u: body = [{"id":"00"*32, "height":972389 - i, "timestamp":int(NOW / 1000) - (i * 9 + 23) * 60, "size":1500000 + i * 9000, "tx_count":3100 + i} for i in range(10)]
    elif "blockstream.info/api/fee-estimates" in u: body = {"1":2.1, "2":1.6, "3":1.2, "6":0.8, "144":0.3, "504":0.2, "1008":0.15}
    elif "blockstream.info/api/mempool" in u: body = {"count":3021, "vsize":5100000, "total_fee":123}
    elif "blockchain.info/q/getblockcount" in u: body = "972389"; ctype = "text/plain"
    elif "api.blockchain.info/charts/" in u:
        m = re.search(r"charts/([\w-]+)\?timespan=(\w+)", u); body = bci(m.group(1), m.group(2))
    elif "open.er-api.com" in u: body = {"result":"success", "time_last_update_unix":int(NOW / 1000) - 3600, "rates":{"KRW":1327.0}}
    if body is None: route.fulfill(status=404, body="nope", headers={"Access-Control-Allow-Origin":"*"}); return
    route.fulfill(status=200, content_type=ctype, body=body if isinstance(body, str) else json.dumps(body), headers={"Access-Control-Allow-Origin":"*"})
HOSTS = ["https://api.upbit.com/**", "https://api.bithumb.com/**", "https://api.binance.com/**", "https://data-api.binance.vision/**", "https://api.coingecko.com/**", "https://api.alternative.me/**", "https://blockstream.info/**", "https://blockchain.info/**", "https://api.blockchain.info/**", "https://open.er-api.com/**"]
log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
fmt = lambda v: f"{round(v):,}"
def expect_est():
    return (datetime.now() + timedelta(seconds=77611 * 600)).strftime("%Y.%m.%d")

with sync_playwright() as p:
    b = p.chromium.launch()
    def ctx_new(scheme="light", w=412, h=915, mobile=True):
        c = b.new_context(viewport={"width":w, "height":h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, color_scheme=scheme, service_workers="block")
        c.grant_permissions(["clipboard-read", "clipboard-write"], origin="http://localhost:8768")
        c.add_init_script(FAKE_WS)
        c.route(LIB, lambda r: r.fulfill(status=200, content_type="application/javascript", body=MOCK))
        c.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body="window.SANSIYA_CONFIG={supabaseUrl:'https://abcd.supabase.co',supabaseKey:'sb_publishable_test_key_123456789'};"))
        for pat in ["https://fonts.googleapis.com/**", "https://financialmodelingprep.com/**", "https://assets.parqet.com/**"]: c.route(pat, lambda r: r.abort())
        for h in HOSTS: c.route(h, api)
        return c
    def open_btc(pg, url=BASE):
        pg.goto(url); pg.wait_for_selector("#app:not([hidden])")
        pg.locator("#tabbar [data-view=bitcoin]").click(); pg.wait_for_selector(".bt-wrap")
    noov = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

    # ---------- A: signed in (server function path), phone light ----------
    c = ctx_new(); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    tabs = pg.eval_on_selector_all("#tabbar button", "els => els.map(e => e.textContent)")
    ok("menu has 비트코인 after 주식", tabs[:4] == ["아카이브", "통계 · 회고", "주식", "비트코인"], str(tabs))
    pg.locator("#tabbar [data-view=bitcoin]").click(); pg.wait_for_selector(".bt-wrap")
    pg.wait_for_function("document.querySelector('#btLive').dataset.live === 'on'", timeout=5000)
    ok("title + live dot on", pg.text_content(".bt-title").strip() == "비트코인" and pg.get_attribute("#btLive", "data-live") == "on")
    pg.wait_for_timeout(600)
    ok("connect toast", "실시간 연결" in (pg.text_content("#toastRoot") or ""), pg.text_content("#toastRoot"))
    pg.wait_for_function("document.querySelector('#btFng').textContent === '55' && document.querySelector('#btDom').textContent.startsWith('59.5')", timeout=8000)
    krw = pg.text_content("#btKrw"); usd = pg.text_content("#btUsd")
    ok("KRW price", krw == "₩110,458,000", krw)
    ok("USD price", usd == "$ 82,992", usd)
    ok("KRW change down 0.39%", "down" in pg.get_attribute("#btKrwChg", "class") and pg.text_content("#btKrwChg") == "0.39%", pg.text_content("#btKrwChg"))
    ok("USD change up 1.20%", "up" in pg.get_attribute("#btUsdChg", "class") and pg.text_content("#btUsdChg") == "1.20%")
    pg.wait_for_function("document.querySelector('#btFx').textContent !== '-'", timeout=8000)
    fx = 1330.15; prem = (110458000 / (82992 * fx) - 1) * 100
    tiles = {k: pg.text_content(f"#bt{k}") for k in ["Dom", "Fx", "Prem", "Fng"]}
    ok("tiles", tiles["Dom"] == "59.5%" and tiles["Fx"] == "1,330.2" and tiles["Prem"] == f"{prem:.2f}%" and tiles["Fng"] == "55", str(tiles) + f" exp prem {prem:.2f}")
    pg.wait_for_function("document.querySelectorAll('#btCandles line').length === 12", timeout=8000)
    ok("12 mini candles, both colours", pg.locator("#btCandles line.u").count() > 0 and pg.locator("#btCandles line.d").count() > 0)
    pg.wait_for_selector("#btChart svg .bt-line", timeout=8000)
    w5 = kl("1w", 260); mx = max(float(r[4]) for r in w5)
    ok("5Y chart max label", pg.text_content("#btChart .bt-mxlab text") == "$" + fmt(mx), pg.text_content("#btChart .bt-mxlab text") + " vs $" + fmt(mx))
    ok("5Y used weekly klines", any("interval=1w&limit=260" in u for u in REQ))
    pg.wait_for_function("document.querySelector('#btHalving b').textContent === '63.04%'", timeout=8000)
    hs = pg.eval_on_selector_all(".bt-hstats b", "els => els.map(e => e.textContent)")
    ok("halving stats", hs == ["972,389", "77,611", expect_est()] and pg.locator(".bt-segs i.on").count() == 15, str(hs))
    # chart hover
    pg.evaluate("document.querySelector('#btChart').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
    bx = pg.locator("#btChart svg").bounding_box(); pg.mouse.move(bx["x"] + bx["width"] * 0.6, bx["y"] + bx["height"] * 0.6); pg.wait_for_timeout(120)
    tip = pg.text_content("#btChart .st-tip")
    ok("chart tooltip", re.match(r"^\d{4}\.\d\d\.\d\d · \$[\d,]+$", tip or "") is not None and pg.get_attribute("#btChart .bt-cross", "visibility") == "visible", tip)
    # range menu
    pg.click("[data-btmenu=range]"); pg.wait_for_selector(".bt-pop [data-btrange]")
    rg = pg.eval_on_selector_all(".bt-pop [data-btrange]", "els => els.map(e => e.textContent)")
    ok("range menu 7 options", rg == ["1일", "7일", "1개월", "1년", "5년", "10년", "전체"], str(rg))
    pg.click("[data-btrange='1y']"); pg.wait_for_function("document.querySelector('.bt-range span').textContent === '1년'")
    pg.wait_for_function("!!document.querySelector('#btChart .bt-line')")
    ok("1Y uses daily klines, menu closed", any("interval=1d&limit=365" in u for u in REQ) and pg.locator(".bt-pop").count() == 0)
    pg.click("[data-btmenu=range]"); pg.click("[data-btrange='10y']"); pg.wait_for_timeout(400)
    ok("10Y uses blockchain.com", any("charts/market-price?timespan=10years" in u for u in REQ))
    # metric menu
    pg.click("[data-btmenu=metric]"); pg.wait_for_selector(".bt-pop [data-btmetric]")
    mt = pg.eval_on_selector_all(".bt-pop [data-btmetric]", "els => els.map(e => e.textContent)")
    ok("metric menu", mt == ["시세", "채굴 난이도", "해시레이트"], str(mt))
    pg.click("[data-btmetric=hashrate]"); pg.wait_for_timeout(500)
    lab = pg.text_content("#btChart .bt-mxlab text") or ""
    ok("hashrate chart in EH/s", lab.endswith("EH/s") and any("charts/hash-rate?timespan=10years" in u for u in REQ), lab)
    pg.click("[data-btmenu=range]"); rg2 = pg.eval_on_selector_all(".bt-pop [data-btrange]", "els => els.map(e => e.textContent)")
    ok("hashrate ranges are long only", rg2 == ["1개월", "1년", "5년", "10년", "전체"], str(rg2))
    pg.keyboard.press("Escape"); ok("Esc closes menu", pg.locator(".bt-pop").count() == 0)
    pg.click("[data-btmenu=metric]"); pg.click("[data-btmetric=difficulty]"); pg.wait_for_timeout(500)
    ok("difficulty chart in 조", (pg.text_content("#btChart .bt-mxlab text") or "").endswith("조"), pg.text_content("#btChart .bt-mxlab text"))
    pg.click("[data-btmenu=metric]"); pg.click(".bt-title"); ok("click outside closes menu", pg.locator(".bt-pop").count() == 0)
    pg.click("[data-btmenu=metric]"); pg.click("[data-btmetric=price]"); pg.click("[data-btmenu=range]"); pg.click("[data-btrange='5y']"); pg.wait_for_timeout(300)
    # live price push
    pg.evaluate("window.__wsPrice.up = [111000000, 0.0012]"); pg.wait_for_timeout(1200)
    ok("live KRW update + tone flip", pg.text_content("#btKrw") == "₩111,000,000" and "up" in pg.get_attribute("#btKrwChg", "class"), pg.text_content("#btKrw"))
    pg.evaluate("window.__wsPrice.up = [110458000, -0.0039]"); pg.wait_for_timeout(1000)
    ok("fits phone", noov(pg)); ok("bottom nav visible", pg.is_visible(".bt-nav") and pg.locator(".bt-nav button").count() == 4)
    pg.evaluate("window.scrollTo(0, 0)"); pg.wait_for_timeout(200); pg.screenshot(path=f"{OUT}/shots/btc-a-overview.png", full_page=True)
    # tile → premium
    pg.click("[data-bttile=fng]"); pg.wait_for_timeout(100)
    ok("F&G tile explains", "탐욕" in (pg.text_content("#toastRoot") or ""), pg.text_content("#toastRoot"))
    # blocks
    pg.click("[data-bttab=blocks]"); pg.wait_for_selector("a.bk-cube", timeout=8000)
    ok("blocks from server function", pg.locator("a.bk-cube").count() == 15 and "F2Pool" in pg.text_content("a.bk-cube") and "mempool" in pg.text_content("#bkSrc"), pg.text_content("a.bk-cube"))
    first = pg.inner_text("a.bk-cube").split("\n")
    ok("first cube text", first[0] == "972389" and first[1] == "1.5MB" and first[3] == "23분 전", str(first))
    ok("pending block", "~0.5 sat/vB" in pg.inner_text(".bk-cube.wait") and "3,021건" in pg.inner_text(".bk-cube.wait"))
    fees = pg.eval_on_selector_all(".bk-fees b", "els => els.map(e => e.textContent)")
    ok("fees", fees == ["0.2sat/vB", "0.4sat/vB", "1.0sat/vB", "1.8sat/vB"], str(fees))
    ok("congestion", "보통 · 약 25 블록 대기" in pg.inner_text("#bkFeeHead").replace("\n", " "), pg.inner_text("#bkFeeHead"))
    ok("blocks halving card", "63.04%" in pg.inner_text("#bkHalving") and "77,611" in pg.inner_text("#bkHalving") and "1.5625" in pg.inner_text("#bkHalving"))
    pg.fill("#bkQ", "972389"); pg.press("#bkQ", "Enter"); pg.wait_for_timeout(100)
    ok("search opens explorer", pg.evaluate("window.__opened.slice(-1)[0]") == "https://blockstream.info/block-height/972389", str(pg.evaluate("window.__opened")))
    pg.fill("#bkQ", "nonsense!"); pg.click(".bk-go"); pg.wait_for_timeout(80)
    ok("bad search hint", "블록 높이" in (pg.text_content("#toastRoot") or ""))
    pg.click(".bk-learn details summary"); ok("explainer opens", pg.evaluate("document.querySelector('.bk-learn details').open"))
    ok("blocks fits phone", noov(pg)); pg.screenshot(path=f"{OUT}/shots/btc-a-blocks.png", full_page=True)
    # convert
    pg.click("[data-bttab=convert]"); pg.wait_for_selector("#bcRows")
    rows = pg.eval_on_selector_all(".bc-row", "els => els.map(e => e.querySelector('.lb').textContent + ' ' + e.querySelector('b').textContent)")
    ok("convert 1 BTC", rows == ["원화(₩): 110,458,000", "달러($): 82,992.00", "사토시: 100,000,000"], str(rows))
    pg.fill("#bcAmt", "0.5"); pg.wait_for_timeout(80)
    ok("convert 0.5 BTC", pg.text_content("#bc-krw") == "55,229,000" and pg.text_content("#bc-sats") == "50,000,000", pg.text_content("#bc-krw"))
    pg.click("[data-bcprem='0.1']"); pg.wait_for_timeout(80)
    ok("premium +0.1%", pg.input_value("#bcPrem") == "0.1" and pg.text_content("#bc-krw") == fmt(0.5 * 110458000 * 1.001), pg.text_content("#bc-krw"))
    pg.click("[data-bcprem='-0.1']"); pg.click("[data-btmenu=unit]"); pg.click("[data-btunit=KRW]"); pg.wait_for_timeout(80)
    pg.fill("#bcAmt", "1000000"); pg.wait_for_timeout(80)
    rows = pg.eval_on_selector_all(".bc-row .lb", "els => els.map(e => e.textContent)")
    ok("KRW input shows BTC/USD/Sats", rows == ["비트코인(₿):", "달러($):", "사토시:"] and pg.text_content("#bc-btc") == f"{1000000 / 110458000:.8f}".rstrip("0"), str(rows) + " " + pg.text_content("#bc-btc"))
    pg.click("[data-btcopy=sats]"); pg.wait_for_timeout(150)
    ok("copy sats", pg.evaluate("navigator.clipboard.readText()") == str(round(1000000 / 110458000 * 1e8)), pg.evaluate("navigator.clipboard.readText()"))
    pg.click("[data-act=bcClear]"); ok("clear", pg.input_value("#bcAmt") == "" and pg.text_content("#bc-btc") == "-")
    pg.click("[data-btmenu=unit]"); pg.click("[data-btunit=BTC]"); pg.fill("#bcAmt", "1")
    ok("convert fits phone", noov(pg)); pg.screenshot(path=f"{OUT}/shots/btc-a-convert.png", full_page=True)
    # typing survives a background re-render
    pg.focus("#bcAmt"); pg.evaluate("window.__sansiya.pull()"); pg.wait_for_timeout(600)
    ok("input keeps focus on refresh", pg.evaluate("document.activeElement && document.activeElement.id") == "bcAmt")
    # premium
    pg.click("[data-bttab=premium]"); pg.wait_for_selector(".bp")
    big = pg.text_content("#bpBig")
    ok("premium big", big == f"+{prem:.2f}%" and pg.get_attribute("#bpBig", "data-tone") == "up", big)
    tbl = pg.eval_on_selector_all(".bp-r:not(.head)", "els => els.map(e => [...e.children].slice(1).map(x => x.textContent).join(' / '))")
    exp = [f"{fmt(110458000)} / {fmt(110458000 / fx)}", f"{fmt(82992 * fx)} / 82,992", f"+{fmt(110458000 - 82992 * fx)} / +{fmt(110458000 / fx - 82992)}"]
    ok("premium table", tbl == exp, str(tbl) + " vs " + str(exp))
    ok("premium rate row", pg.text_content("#bpFx") == "1,330.2" and "업데이트" in pg.text_content("#bpFxT"))
    pos = float(pg.evaluate("document.querySelector('#bpMark').style.left").rstrip("%"))
    ok("gauge marker", abs(pos - (prem + 10) * 5) < 0.2, str(pos))
    ok("premium fits phone", noov(pg)); pg.screenshot(path=f"{OUT}/shots/btc-a-premium.png", full_page=True)
    # settings: bithumb + usdt
    pg.click("[data-act=btSet]"); pg.wait_for_selector("[data-btex=bithumb]")
    pg.click("[data-btex=bithumb]"); pg.wait_for_timeout(900)
    ok("bithumb socket", pg.evaluate("window.__ws.some(w => /bithumb/.test(w.url) && !w.closed) && window.__ws.filter(w => /upbit/.test(w.url)).every(w => w.closed)"))
    pg.click("[data-btfx=usdt]"); pg.wait_for_timeout(300); pg.click("[data-act=close]"); pg.wait_for_timeout(500)
    prem2 = (110412000 / (82992 * 1338) - 1) * 100
    ok("bithumb + usdt premium", pg.text_content("#bpBig") == f"{'+' if prem2 > 0 else '-'}{abs(prem2):.2f}%" and "빗썸" in pg.inner_text(".bp-table") and "테더" in pg.text_content("#bpFxL"), pg.text_content("#bpBig") + f" exp {prem2:.2f}")
    pg.click("[data-bttab=overview]"); pg.wait_for_timeout(300)
    ok("tile label KRW/USDT", pg.text_content("#btFxL") == "테더 환율" and pg.text_content("#btFx") == "1,338.0")
    # leave view closes sockets
    pg.locator("#tabbar [data-view=stocks]").click(); pg.wait_for_timeout(300)
    ok("leaving closes sockets", pg.evaluate("window.__ws.every(w => w.closed)"))
    pg.locator("#tabbar [data-view=bitcoin]").click(); pg.wait_for_timeout(600)
    ok("coming back reconnects", pg.evaluate("window.__ws.filter(w => !w.closed).length") == 2 and pg.locator(".bt-nav [aria-current=true]").text_content() == "개요")
    # settings persisted after reload
    pg.goto("about:blank"); open_btc(pg); pg.wait_for_timeout(500)
    ok("prefs persist", pg.evaluate("window.__ws.some(w => /bithumb/.test(w.url))") and pg.text_content("#btFxL") == "테더 환율")
    pg.click("[data-act=btSet]"); pg.click("[data-btex=upbit]"); pg.click("[data-btfx=bank]"); pg.click("[data-act=close]")
    ok("A no page errors", not errs, str(errs))
    c.close()

    # ---------- B: device-only mode (fallback sources), phone dark ----------
    REQ.clear()
    c = ctx_new("dark"); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    open_btc(pg, BASE + "?demo")
    pg.wait_for_function("document.querySelector('#btFx').textContent === '1,327.0'", timeout=8000)
    prem3 = (110458000 / (82992 * 1327) - 1) * 100
    ok("B fx from open.er-api", any("open.er-api.com" in u for u in REQ) and pg.text_content("#btPrem") == f"{prem3:.2f}%", pg.text_content("#btPrem"))
    pg.wait_for_selector("#btChart .bt-line", timeout=8000)
    pg.screenshot(path=f"{OUT}/shots/btc-b-overview.png", full_page=True)
    pg.click("[data-bttab=blocks]"); pg.wait_for_selector("a.bk-cube", timeout=8000)
    ok("B blocks via Blockstream", pg.locator("a.bk-cube").count() == 10 and "3,100건" in pg.inner_text("a.bk-cube") and "블록스트림" in pg.text_content("#bkSrc"), pg.inner_text("a.bk-cube"))
    fees = pg.eval_on_selector_all(".bk-fees b", "els => els.map(e => e.textContent)")
    ok("B fees from estimates", fees == ["0.3sat/vB", "0.8sat/vB", "1.2sat/vB", "2.1sat/vB"], str(fees))
    ok("B congestion", "약 5 블록" in pg.inner_text("#bkFeeHead").replace("\n", " "), pg.inner_text("#bkFeeHead"))
    pg.screenshot(path=f"{OUT}/shots/btc-b-blocks.png", full_page=True)
    pg.click("[data-bttab=convert]"); pg.wait_for_selector("#bcRows"); pg.screenshot(path=f"{OUT}/shots/btc-b-convert.png", full_page=True)
    pg.click("[data-bttab=premium]"); pg.wait_for_selector(".bp"); pg.screenshot(path=f"{OUT}/shots/btc-b-premium.png", full_page=True)
    ok("B fits phone", noov(pg)); ok("B no page errors", not errs, str(errs))
    c.close()

    # ---------- C: desktop light + dark ----------
    for scheme in ["light", "dark"]:
        c = ctx_new(scheme, 1280, 900, False); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        open_btc(pg); pg.wait_for_selector("#btChart .bt-line", timeout=8000); pg.wait_for_function("document.querySelector('#btHalving b').textContent === '63.04%'", timeout=8000)
        pg.wait_for_timeout(500)
        for tab in ["overview", "blocks", "convert", "premium"]:
            pg.click(f"[data-bttab={tab}]"); pg.wait_for_timeout(700)
            pg.screenshot(path=f"{OUT}/shots/btc-c-{scheme}-{tab}.png", full_page=True)
            ok(f"C {scheme} {tab} fits", noov(pg))
        ok(f"C {scheme} no page errors", not errs, str(errs))
        c.close()
    b.close()
print("\n".join(log)); print("FAILS:", sum(1 for l in log if l.startswith("FAIL")))
