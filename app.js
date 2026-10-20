/* 산시야 — personal archive PWA
 * Data: Supabase (login, Postgres, Storage) with a local IndexedDB cache and an
 * offline outbox, or a device-only local mode (?demo or "이 기기에만 저장").
 */
(() => {
"use strict";

const APP_VERSION = "1.9.2";
const SUPA_SRC = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js";
const URL_TTL = 7 * 86400; // seconds a signed photo URL stays valid
const DEFAULT_CATS = [
  {code:"ARC", name:"건축"},
  {code:"INT", name:"인테리어"},
  {code:"LND", name:"조경"},
  {code:"URB", name:"도시설계·계획"},
  {code:"SPC", name:"공간디자인"},
  {code:"AI",  name:"인공지능"},
  {code:"GME", name:"게임"},
  {code:"STK", name:"주식"},
  {code:"SCI", name:"과학기술"},
  {code:"ETC", name:"기타"}
];
const TYPES = {scrap:"스크랩", taste:"취향"};
const STATUS = {done:"경험함", want:"위시"};
const WD = ["일","월","화","수","목","금","토"];
const MARK = `<svg viewBox="0 0 512 512" class="mark" aria-hidden="true"><rect width="512" height="512" rx="112" fill="var(--accent)"/><path d="M136 332 226 196l50 66 30-36 70 106" fill="none" stroke="var(--accent-ink)" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/><path d="M112 378h288" stroke="var(--accent-ink)" stroke-width="16" stroke-linecap="round"/><circle cx="338" cy="158" r="20" fill="var(--accent-ink)"/></svg>`;

/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = (n, w = 2) => String(n).padStart(w, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = s => { const [y,m,d] = String(s||"").split("-").map(Number); return new Date(y||1970, (m||1)-1, d||1); };
const fmtDate = s => { if(!s) return ""; const d = parseYmd(s); return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${WD[d.getDay()]}`; };
const fmtTime = t => { const d = new Date(t); return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const stars = r => r ? `<span class="stars" aria-label="별점 ${r}점">${"★".repeat(r)}<i>${"★".repeat(5-r)}</i></span>` : "";
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c === "x" ? r : (r&3|8)).toString(16); }));
const isUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s||""));
function linkify(t){
  return esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}
function domain(u){ try{ return new URL(u).hostname.replace(/^www\./, ""); }catch(e){ return u; } }
function isNetErr(err){
  if(!navigator.onLine) return true;
  if(err instanceof TypeError) return true;
  if(err && err.net) return true;
  return /failed to fetch|failed to send|networkerror|load failed|network request failed|fetch failed|timeout|the network connection/i.test(String(err && (err.message || err) || ""));
}
function errMsg(err){ return String(err && (err.message || err.error_description || err) || "알 수 없는 오류"); }
function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new TypeError("Failed to fetch " + src)); document.head.appendChild(s); });
}
let toastT;
function toast(msg, action){
  const r = $("#toastRoot");
  r.innerHTML = `<div class="toast" role="status">${esc(msg)}${action ? ` <button type="button" class="btn small" id="toastAct" style="margin-left:8px;height:26px">${esc(action.label)}</button>` : ""}</div>`;
  if(action) $("#toastAct").onclick = () => { r.innerHTML = ""; action.fn(); };
  clearTimeout(toastT); toastT = setTimeout(() => { r.innerHTML = ""; }, action ? 8000 : 2800);
}

/* ---------- tiny IndexedDB key-value store (memory fallback) ---------- */
const KV = (() => {
  const mem = new Map(); let dbp = null; let broken = false;
  function open(){
    if(broken) return Promise.reject(new Error("idb unavailable"));
    if(!dbp) dbp = new Promise((res, rej) => {
      try{
        const r = indexedDB.open("sansiya", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => res(r.result);
        r.onerror = () => { broken = true; rej(r.error); };
      }catch(e){ broken = true; rej(e); }
    });
    return dbp;
  }
  async function run(mode, fn){
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction("kv", mode); const req = fn(t.objectStore("kv"));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  return {
    async get(k){ try{ return await run("readonly", s => s.get(k)); }catch(e){ return mem.get(k); } },
    async set(k, v){ try{ await run("readwrite", s => s.put(v, k)); }catch(e){ mem.set(k, v); } },
    async del(k){ try{ await run("readwrite", s => s.delete(k)); }catch(e){ mem.delete(k); } }
  };
})();

/* ---------- backends ---------- */
function fromRow(r){
  return { id:r.id, type:r.type, cat:r.cat, seq:r.seq||0, title:r.title, date:r.date, url:r.url||"", body:r.body||"",
    tags:r.tags||[], rating:r.rating||0, status:r.status||"", photos:r.photos||[], example:!!r.example,
    createdAt:Date.parse(r.created_at)||0, updatedAt:Date.parse(r.updated_at)||0 };
}
function toRow(e, uid){
  return { id:e.id, user_id:uid, type:e.type, cat:e.cat, seq:e.seq||0, title:e.title, date:e.date, url:e.url||"", body:e.body||"",
    tags:e.tags||[], rating:e.rating||0, status:e.status||"", photos:e.photos||[], example:!!e.example,
    created_at:new Date(e.createdAt||Date.now()).toISOString(), updated_at:new Date(e.updatedAt||Date.now()).toISOString() };
}

const isoT = t => new Date(t || Date.now()).toISOString();
const numOrNull = v => v == null || v === "" || !isFinite(+v) ? null : +v;
const TABLES = {
  stocks: {
    order: ["sort", true],
    from: r => ({ id:r.id, symbol:r.symbol, market:r.market, name:r.name, currency:r.currency || "KRW", watch:!!r.watch,
      qty:+r.qty || 0, avgPrice:+r.avg_price || 0, target:numOrNull(r.target_price), memo:r.memo || "",
      notes:Array.isArray(r.notes) ? r.notes : [], sort:r.sort || 0, hidden:!!r.hidden, broker:r.broker || "", brokerSyncedAt:Date.parse(r.broker_synced_at) || 0,
      createdAt:Date.parse(r.created_at) || 0, updatedAt:Date.parse(r.updated_at) || 0 }),
    to: (s, uid) => ({ id:s.id, user_id:uid, symbol:s.symbol, market:s.market, name:s.name, currency:s.currency || "KRW", watch:!!s.watch,
      qty:+s.qty || 0, avg_price:+s.avgPrice || 0, target_price:numOrNull(s.target), memo:s.memo || "",
      notes:s.notes || [], sort:s.sort || 0, hidden:!!s.hidden, created_at:isoT(s.createdAt), updated_at:isoT(s.updatedAt) })
  },
  dividends: {
    order: ["date", false],
    from: r => ({ id:r.id, stockId:r.stock_id || null, symbol:r.symbol || "", name:r.name || "", date:r.date,
      amount:+r.amount || 0, currency:r.currency || "KRW", krw:numOrNull(r.krw_amount), memo:r.memo || "",
      createdAt:Date.parse(r.created_at) || 0, updatedAt:Date.parse(r.updated_at) || 0 }),
    to: (d, uid) => ({ id:d.id, user_id:uid, stock_id:d.stockId || null, symbol:d.symbol || "", name:d.name || "", date:d.date,
      amount:+d.amount || 0, currency:d.currency || "KRW", krw_amount:numOrNull(d.krw), memo:d.memo || "",
      created_at:isoT(d.createdAt), updated_at:isoT(d.updatedAt) })
  }
};

function makeSupabaseBackend(url, key){
  let sb = null, user = null;
  // password-reset links come back as #access_token=…&type=recovery (or #error=…)
  const hash = new URLSearchParams(location.hash.slice(1));
  let recovery = hash.get("type") === "recovery";
  const linkError = hash.get("error_description") ? (hash.get("error_code") || hash.get("error") || "error") : null;
  return {
    kind: "supabase",
    async init(){
      if(!window.supabase) await loadScript(SUPA_SRC);
      sb = window.supabase.createClient(url, key, { auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:"implicit", storageKey:"sansiya-auth" } });
      sb.auth.onAuthStateChange((ev, session) => {
        if(ev === "PASSWORD_RECOVERY") recovery = true;
        if(ev === "SIGNED_OUT" && user){ user = null; onSignedOut(); }
        else if(session && session.user) user = session.user;
      });
      const { data } = await sb.auth.getSession();
      user = data && data.session ? data.session.user : null;
      if(location.hash && /access_token|error|type=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
      return user;
    },
    user: () => user,
    recovery: () => recovery,
    clearRecovery(){ recovery = false; },
    linkError: () => linkError,
    async signIn(email, password){
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw error; user = data.user; return user;
    },
    async resetPassword(email){
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if(error) throw error;
    },
    async updatePassword(password){
      const { data, error } = await sb.auth.updateUser({ password });
      if(error) throw error; if(data && data.user) user = data.user; return user;
    },
    async signOut(){ user = null; try{ await sb.auth.signOut(); }catch(e){} },
    async fetchEntries(){
      const out = [];
      for(let from = 0; ; from += 1000){
        const { data, error } = await sb.from("entries").select("*").order("date", { ascending:false }).order("id").range(from, from + 999);
        if(error) throw error;
        out.push(...data); if(data.length < 1000) break;
      }
      return out.map(fromRow);
    },
    async upsertMany(list){
      for(let i = 0; i < list.length; i += 200){
        const { error } = await sb.from("entries").upsert(list.slice(i, i + 200).map(e => toRow(e, user.id)));
        if(error) throw error;
      }
    },
    async remove(id){ const { error } = await sb.from("entries").delete().eq("id", id); if(error) throw error; },
    async fetchSettings(){
      const { data, error } = await sb.from("settings").select("categories").eq("user_id", user.id).maybeSingle();
      if(error) throw error; return data ? { categories:data.categories } : null;
    },
    async saveSettings(s){
      const { error } = await sb.from("settings").upsert({ user_id:user.id, categories:s.categories, updated_at:new Date().toISOString() });
      if(error) throw error;
    },
    async uploadPhoto(blob){
      const ext = ({"image/webp":"webp","image/jpeg":"jpg","image/png":"png","image/gif":"gif"})[blob.type] || "jpg";
      const path = `${user.id}/${uuid()}.${ext}`;
      const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: blob.type || "image/jpeg", cacheControl:"31536000", upsert:false });
      if(error) throw error; return path;
    },
    async signUrls(paths){
      const out = [];
      for(let i = 0; i < paths.length; i += 100){
        const chunk = paths.slice(i, i + 100);
        const { data, error } = await sb.storage.from("photos").createSignedUrls(chunk, URL_TTL);
        if(error) throw error;
        chunk.forEach((p, j) => { const d = data && data[j]; out.push({ path:p, url: d && !d.error && d.signedUrl ? d.signedUrl : null }); });
      }
      return out;
    },
    async removePhotos(paths){ if(!paths.length) return; const { error } = await sb.storage.from("photos").remove(paths); if(error) throw error; },
    async fetchRows(table){
      const T = TABLES[table], out = [];
      for(let from = 0; ; from += 1000){
        const { data, error } = await sb.from(table).select("*").order(T.order[0], { ascending:T.order[1] }).order("id").range(from, from + 999);
        if(error) throw error;
        out.push(...data); if(data.length < 1000) break;
      }
      return out.map(T.from);
    },
    async upsertRow(table, rec){
      let row = TABLES[table].to(rec, user.id);
      let { error } = await sb.from(table).upsert(row);
      if(error && error.code === "23503" && table === "dividends"){ row = { ...row, stock_id:null }; ({ error } = await sb.from(table).upsert(row)); }
      if(error) throw error;
    },
    async deleteRow(table, id){ const { error } = await sb.from(table).delete().eq("id", id); if(error) throw error; },
    async getBrokerLink(){ const { data, error } = await sb.from("broker_links").select("*").maybeSingle(); if(error) throw error; return data || null; },
    async setBrokerLink(hash){
      const row = { user_id:user.id, broker:"toss", token_hash:hash, created_at:new Date().toISOString(), last_sync_at:null, last_status:null, last_error:null, last_ip:null, holdings_count:null, account_tail:null };
      const { error } = await sb.from("broker_links").upsert(row); if(error) throw error; return row;
    },
    async deleteBrokerLink(){
      const { error } = await sb.from("broker_links").delete().eq("user_id", user.id); if(error) throw error;
      await sb.from("stocks").update({ broker:null }).eq("broker", "toss");
    },
    async invoke(body){
      const { data, error } = await sb.functions.invoke("quotes", { body });
      if(error){
        let msg = error.message || "시세를 불러오지 못했어요.";
        try{ const j = await error.context.json(); if(j && j.error) msg = j.error; }catch(e){}
        const err = new Error(msg);
        if(error.name === "FunctionsFetchError" || error.name === "FunctionsRelayError") err.net = true;
        throw err;
      }
      return data;
    }
  };
}

function makeLocalBackend(){
  const user = { id:"local", email:"" };
  const objUrls = new Map();
  const net = () => { if(window.__sansiyaFailNet) throw new TypeError("Failed to fetch"); };
  const all = async () => (await KV.get("local:entries")) || {};
  return {
    kind: "local",
    async init(){ return user; },
    user: () => user,
    recovery: () => false,
    clearRecovery(){},
    linkError: () => null,
    async signIn(){ return user; },
    async resetPassword(){ throw new Error("이 기기 저장 모드에서는 쓸 수 없어요."); },
    async updatePassword(){ throw new Error("이 기기 저장 모드에서는 쓸 수 없어요."); },
    async signOut(){},
    async fetchEntries(){ net(); return Object.values(await all()); },
    async upsertMany(list){ net(); const m = await all(); list.forEach(e => { m[e.id] = JSON.parse(JSON.stringify(e)); }); await KV.set("local:entries", m); },
    async remove(id){ net(); const m = await all(); delete m[id]; await KV.set("local:entries", m); },
    async fetchSettings(){ net(); return (await KV.get("local:settings")) || null; },
    async saveSettings(s){ net(); await KV.set("local:settings", s); },
    async uploadPhoto(blob){ const path = `local/${uuid()}`; await KV.set("local:photo:" + path, blob); return path; },
    async signUrls(paths){
      const out = [];
      for(const p of paths){
        let u = objUrls.get(p);
        if(!u){ const b = await KV.get("local:photo:" + p); if(b){ u = URL.createObjectURL(b); objUrls.set(p, u); } }
        out.push({ path:p, url:u || null });
      }
      return out;
    },
    async removePhotos(paths){ for(const p of paths) await KV.del("local:photo:" + p); },
    async fetchRows(table){ net(); return Object.values((await KV.get("local:" + table)) || {}); },
    async upsertRow(table, rec){ net(); const m = (await KV.get("local:" + table)) || {}; m[rec.id] = JSON.parse(JSON.stringify(rec)); await KV.set("local:" + table, m); },
    async deleteRow(table, id){ net(); const m = (await KV.get("local:" + table)) || {}; delete m[id]; await KV.set("local:" + table, m); },
    async getBrokerLink(){ return (await KV.get("local:brokerLink")) || null; },
    async setBrokerLink(hash){ const row = { broker:"toss", token_hash:hash, created_at:new Date().toISOString() }; await KV.set("local:brokerLink", row); return row; },
    async deleteBrokerLink(){ await KV.del("local:brokerLink"); },
    async invoke(body){
      if(window.__sansiyaFakeQuotes) return window.__sansiyaFakeQuotes(body);
      throw new Error("이 기기 저장 모드에서는 시세를 불러올 수 없어요.");
    }
  };
}

/* ---------- state ---------- */
const S = {
  B:null, uid:null, email:"",
  entries:[], loaded:false, cats:DEFAULT_CATS.slice(),
  view:"archive", filter:{cat:"all", type:"all", tag:null, q:""},
  sort:"date-desc", layout:"list", calMonth:null, calSel:null,
  outbox:[], lastSync:0, lastPull:0, sync:"idle", syncErr:"",
  urls:new Map(), installEvt:null,
  stocks:[], divs:[], quotes:{}, fx:null, quotesAt:0, qLoading:false, qErr:"",
  stockTab:"hold", divYear:new Date().getFullYear(), hist:{}, market:{}, broker:undefined, showHidden:false,
  holdSort:"value", holdShow:"value", hideAmt:false
};
try{ const p = JSON.parse(localStorage.getItem("sansiya-prefs") || "{}"); if(p.layout) S.layout = p.layout; if(p.sort) S.sort = p.sort; if(p.holdSort) S.holdSort = p.holdSort; if(p.holdShow) S.holdShow = p.holdShow; if(p.hideAmt) S.hideAmt = true; }catch(e){}
function savePrefs(){ try{ localStorage.setItem("sansiya-prefs", JSON.stringify({ layout:S.layout, sort:S.sort, holdSort:S.holdSort, holdShow:S.holdShow, hideAmt:S.hideAmt })); }catch(e){} }
const k = name => `u:${S.uid}:${name}`;
const saveCache = () => KV.set(k("entries"), S.entries);
const saveOutbox = () => KV.set(k("outbox"), S.outbox);
const catOf = code => S.cats.find(c => c.code === code) || { code:code || "ETC", name:code || "기타" };
const sheetNo = e => `${esc(e.cat || "ETC")}-${pad(e.seq || 0, 3)}`;

/* ---------- sync ---------- */
const opKey = o => o.op === "settings" ? "settings"
  : (o.op === "row" || o.op === "rowdel") ? `${o.table}:${o.rec ? o.rec.id : o.id}`
  : (o.entry ? o.entry.id : o.id);
function setSync(s){ S.sync = s; updateSyncUI(); }
function updateSyncUI(){
  const b = $("#syncBtn"); if(!b) return;
  const n = S.outbox.length; let s = S.sync, label;
  if(S.B && S.B.kind === "local"){ s = "ok"; label = "이 기기 저장"; }
  else if(s === "busy") label = "동기화 중";
  else if(s === "error") label = "동기화 오류";
  else if(!navigator.onLine || s === "offline"){ s = "idle"; label = n ? `오프라인 · 대기 ${n}` : "오프라인"; }
  else if(n){ s = "idle"; label = `대기 ${n}건`; }
  else if(s === "ok") label = "동기화됨";
  else label = "준비 중";
  b.dataset.s = s; b.querySelector("span").textContent = label;
  b.title = S.lastSync ? `마지막 동기화 ${fmtTime(S.lastSync)} · 눌러서 지금 동기화` : "눌러서 지금 동기화";
  b.setAttribute("aria-label", label);
}
let flushing = null;
function flush(){
  if(flushing) return flushing;
  flushing = (async () => {
    while(S.outbox.length){
      const op = S.outbox[0];
      setSync("busy");
      try{
        if(op.op === "upsert"){
          await S.B.upsertMany([op.entry]);
          if(op.removed && op.removed.length) await S.B.removePhotos(op.removed).catch(() => {});
        }else if(op.op === "delete"){
          await S.B.remove(op.id);
          if(op.photos && op.photos.length) await S.B.removePhotos(op.photos).catch(() => {});
        }else if(op.op === "settings"){
          await S.B.saveSettings(op.settings);
        }else if(op.op === "row"){
          await S.B.upsertRow(op.table, op.rec);
        }else if(op.op === "rowdel"){
          await S.B.deleteRow(op.table, op.id);
        }
        S.outbox = S.outbox.filter(o => o !== op); await saveOutbox(); S.syncErr = "";
      }catch(err){
        if(isNetErr(err)){ setSync("offline"); return false; }
        S.syncErr = errMsg(err); op.error = S.syncErr; await saveOutbox(); setSync("error"); return false;
      }
    }
    return true;
  })().finally(() => { flushing = null; });
  return flushing;
}
async function enqueue(op){
  const key = opKey(op);
  const prev = S.outbox.find(o => opKey(o) === key);
  if(prev && prev.removed && op.op === "upsert") op.removed = [...new Set([...(prev.removed || []), ...(op.removed || [])])];
  if(prev && prev.removed && op.op === "delete") op.photos = [...new Set([...(op.photos || []), ...prev.removed])];
  // replace a pending change to the same record in place, so related changes keep their order
  // (an in-flight op that gets replaced is simply sent again with the newer content)
  const at = S.outbox.findIndex(o => opKey(o) === key);
  if(at >= 0) S.outbox[at] = op; else S.outbox.push(op);
  await saveOutbox(); updateSyncUI(); markPending();
  const ok = await flush();
  if(ok){ S.lastSync = Date.now(); KV.set(k("lastSync"), S.lastSync); setSync("ok"); }
  markPending();
}
async function pull(){
  if(!S.B || !S.uid) return;
  S.lastPull = Date.now();
  const ok = await flush();
  if(!ok){ if(!S.loaded){ S.loaded = true; refresh(); } return; }
  setSync("busy");
  try{
    const [rows, st, stocks, divs] = await Promise.all([S.B.fetchEntries(), S.B.fetchSettings(), S.B.fetchRows("stocks"), S.B.fetchRows("dividends")]);
    if(S.outbox.length){ setSync("idle"); return; }
    S.entries = rows; S.stocks = stocks; S.divs = divs;
    if(st && Array.isArray(st.categories) && st.categories.length) S.cats = st.categories.map(c => ({ code:c.code, name:c.name }));
    S.loaded = true; S.lastSync = Date.now();
    await Promise.all([saveCache(), saveStocks(), saveDivs(), KV.set(k("settings"), { categories:S.cats }), KV.set(k("lastSync"), S.lastSync)]);
    setSync("ok"); refresh();
  }catch(err){
    S.loaded = true;
    if(isNetErr(err)) setSync("offline"); else { S.syncErr = errMsg(err); setSync("error"); }
    refresh();
  }
}
function markPending(){
  if(OV && OV.kind === "edit") return;
  if(OV && OV.kind === "settings"){ renderSettings(); return; }
  if(S.view === "archive" || S.view === "calendar" || S.view === "stocks") render();
}
const saveStocks = () => KV.set(k("stocks"), S.stocks);
const saveDivs = () => KV.set(k("divs"), S.divs);

/* ---------- photo URLs ---------- */
async function ensureUrls(paths){
  if(!S.B) return;
  const now = Date.now();
  const need = [...new Set(paths)].filter(p => { const c = S.urls.get(p); return !c || (c.exp && c.exp - now < 86400e3); });
  if(!need.length) return;
  if(S.B.kind !== "local" && !navigator.onLine) return;
  try{
    const res = await S.B.signUrls(need);
    const exp = S.B.kind === "local" ? 0 : now + URL_TTL * 1000;
    res.forEach(r => { if(r.url) S.urls.set(r.path, { url:r.url, exp }); });
    persistUrls();
  }catch(e){}
}
function persistUrls(){
  if(!S.B || S.B.kind === "local") return;
  KV.set(k("urls"), [...S.urls.entries()].filter(([, c]) => c.url && !c.url.startsWith("blob:")));
}
const purl = p => { const c = S.urls.get(p); return c ? c.url : ""; };
const imgTag = (p, cls) => { const u = purl(p); return `<img${cls ? ` class="${cls}"` : ""} data-path="${esc(p)}"${u ? ` src="${esc(u)}"` : ""} alt="" loading="lazy">`; };
let hydrateT;
function hydrateImages(){
  clearTimeout(hydrateT);
  hydrateT = setTimeout(async () => {
    const paths = [...document.querySelectorAll("img[data-path]")].map(i => i.dataset.path);
    if(paths.length) await ensureUrls(paths);
    document.querySelectorAll("img[data-path]").forEach(i => { if(!i.getAttribute("src")){ const u = purl(i.dataset.path); if(u) i.src = u; } });
  }, 0);
}
document.addEventListener("error", ev => {
  const t = ev.target;
  if(t && t.classList && t.classList.contains("st-logo")){ t.remove(); return; }
  if(t && t.tagName === "IMG" && t.dataset && t.dataset.path && !t.dataset.retried && navigator.onLine){
    t.dataset.retried = "1"; S.urls.delete(t.dataset.path); t.removeAttribute("src"); hydrateImages();
  }
}, true);

/* ---------- filtering ---------- */
function filtered(){
  const f = S.filter, q = f.q.trim().toLowerCase();
  const list = S.entries.filter(e =>
    (f.cat === "all" || e.cat === f.cat) &&
    (f.type === "all" || e.type === f.type) &&
    (!f.tag || (e.tags || []).includes(f.tag)) &&
    (!q || [e.title, e.body, e.url, (e.tags || []).join(" "), catOf(e.cat).name, e.cat + "-" + pad(e.seq || 0, 3)].join(" ").toLowerCase().includes(q))
  );
  const by = {
    "date-desc": (a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0),
    "date-asc":  (a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0),
    "rating":    (a, b) => (b.rating || 0) - (a.rating || 0) || (b.date || "").localeCompare(a.date || ""),
    "updated":   (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  }[S.sort] || ((a, b) => 0);
  return list.sort(by);
}
const count = fn => S.entries.filter(fn).length;
function tagCounts(list = S.entries){
  const m = new Map(); list.forEach(e => (e.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
const pendingIds = () => new Set(S.outbox.filter(o => o.op === "upsert").map(o => o.entry.id));

/* ---------- render: chrome ---------- */
const VIEWS = [["archive","아카이브"],["calendar","캘린더"],["stats","통계 · 회고"],["stocks","주식"]];
function renderChrome(){
  $("#brandCount").textContent = S.loaded ? `Personal register · ${S.entries.length}건` : "Personal register";
  $("#tabbar").innerHTML = VIEWS.map(([v, l]) => `<button type="button" data-view="${v}" aria-current="${S.view === v}">${l}</button>`).join("");
  updateSyncUI();
}

/* ---------- render: views ---------- */
function render(){
  renderChrome();
  const m = $("#main");
  if(S.view === "archive") m.innerHTML = archiveHtml();
  else if(S.view === "calendar") m.innerHTML = calendarHtml();
  else if(S.view === "stocks"){ m.innerHTML = stocksHtml(); bindTips(m); bindDonut(m); }
  else m.innerHTML = statsHtml();
  hydrateImages();
}
function refresh(){
  if(OV && OV.kind === "edit"){ renderChrome(); return; }
  render();
  if(OV && OV.kind === "detail") renderDetail();
  if(OV && OV.kind === "settings") renderSettings();
  if(OV && OV.kind === "stock") updateStockDetail();
}
function rowHtml(e, pend){
  const c = catOf(e.cat), ph = e.photos || [];
  return `<article class="row" data-open="${esc(e.id)}" tabindex="0">
    ${coverHtml(e)}
    <div style="min-width:0">
      <div class="sheet"><b>${esc(e.cat)}</b>-${pad(e.seq || 0, 3)}</div>
      <h3>${esc(e.title || "제목 없음")}</h3>
      ${e.body ? `<p class="excerpt">${esc(e.body.slice(0, 240))}</p>` : ""}
      <div class="meta">
        <span class="d">${fmtDate(e.date)}</span>
        <span>${esc(c.name)}</span>
        <span class="pill ${e.type === "taste" ? "taste" : ""}">${TYPES[e.type] || "스크랩"}${e.type === "taste" && e.status === "want" ? " · 위시" : ""}</span>
        ${stars(e.rating)}
        ${(e.tags || []).slice(0, 4).map(t => `<span class="tag">#${esc(t)}</span>`).join("")}
        ${e.example ? `<span class="pill ex">예시</span>` : ""}
        ${pend && pend.has(e.id) ? `<span class="pill pend" title="인터넷에 연결되면 올라가요">동기화 대기</span>` : ""}
      </div>
    </div>
  </article>`;
}
// left image of a list row: first photo, or a tile with the field code when there is none
function coverHtml(e){
  const ph = e.photos || [], c = catOf(e.cat);
  if(ph.length) return `<div class="cover">${imgTag(ph[0])}${ph.length > 1 ? `<span class="more">+${ph.length - 1}</span>` : ""}</div>`;
  return `<div class="cover blank" aria-hidden="true"><b>${esc(e.cat)}</b><span>${esc(c.name)}</span></div>`;
}
function cardHtml(e){
  const c = catOf(e.cat), ph = e.photos || [];
  return `<article class="card" data-open="${esc(e.id)}" tabindex="0">
    <div class="ph">${ph.length ? imgTag(ph[0]) : `<div class="blank">${sheetNo(e)}</div>`}</div>
    <div class="sheet"><b>${esc(e.cat)}</b>-${pad(e.seq || 0, 3)} · ${esc(c.name)}</div>
    <h3>${esc(e.title || "제목 없음")}</h3>
    <div class="meta"><span class="d">${fmtDate(e.date)}</span>${stars(e.rating)}${e.example ? `<span class="pill ex">예시</span>` : ""}</div>
  </article>`;
}
function emptyHtml(){
  if(!S.loaded) return `<div class="list">${"<div class='skel'></div>".repeat(5)}</div>`;
  if(!S.entries.length) return `<div class="empty"><h3>첫 기록을 남겨 보세요</h3><p>인상 깊었던 건축물, 저장해 둘 AI 뉴스, 관심 종목 메모까지. 분야와 태그로 정리되고 캘린더와 통계로 돌아볼 수 있어요.</p><button class="btn primary" type="button" data-act="new">+ 새 기록</button></div>`;
  return `<div class="empty"><h3>조건에 맞는 기록이 없어요</h3><p>검색어나 필터를 바꿔 보세요.</p><button class="btn" type="button" data-act="clear">필터 지우기</button></div>`;
}
function archiveHtml(){
  const f = S.filter, list = filtered(), pend = pendingIds();
  const title = f.cat !== "all" ? catOf(f.cat).name : f.type !== "all" ? (f.type === "taste" ? "취향 컬렉션" : "스크랩 · 정보") : "전체 기록";
  const chips = [];
  if(f.type !== "all") chips.push(`<button type="button" class="chip on" data-clear="type">${TYPES[f.type]} <span class="x">×</span></button>`);
  if(f.cat !== "all") chips.push(`<button type="button" class="chip on" data-clear="cat">${esc(f.cat)} ${esc(catOf(f.cat).name)} <span class="x">×</span></button>`);
  if(f.tag) chips.push(`<button type="button" class="chip on" data-clear="tag">#${esc(f.tag)} <span class="x">×</span></button>`);
  if(f.q) chips.push(`<button type="button" class="chip on" data-clear="q">“${esc(f.q)}” <span class="x">×</span></button>`);
  const exN = count(e => e.example);
  return `
    <div class="mfilters">
      ${[["all","전체"],["scrap","스크랩"],["taste","취향"]].map(([key, l]) => `<button type="button" class="chip ${f.type === key ? "on" : ""}" data-type="${key}">${l}</button>`).join("")}
      <span style="width:1px;background:var(--line-2);flex:none"></span>
      <button type="button" class="chip ${f.cat === "all" ? "on" : ""}" data-cat="all">모든 분야</button>
      ${S.cats.map(c => `<button type="button" class="chip ${f.cat === c.code ? "on" : ""}" data-cat="${esc(c.code)}">${esc(c.name)}</button>`).join("")}
    </div>
    ${(() => { const tags = tagCounts().slice(0, 14); return tags.length ? `<nav class="tagbar" aria-label="자주 쓰는 태그"><div class="wrap"><span class="mt-l">태그</span>${tags.map(([t, n]) => `<button type="button" class="chip ${f.tag === t ? "on" : ""}" data-tag="${esc(t)}">#${esc(t)} <span class="mono" style="font-size:10.5px;opacity:.7">${n}</span></button>`).join("")}</div></nav>` : ""; })()}
    <div class="vhead">
      <h2>${esc(title)}</h2><span class="sub mono">${list.length}건</span>
      <div class="tools">
        <select class="sel" id="sortSel" aria-label="정렬">
          ${[["date-desc","최신 날짜순"],["date-asc","오래된 날짜순"],["rating","별점 높은순"],["updated","최근 수정순"]].map(([v, l]) => `<option value="${v}" ${S.sort === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <div class="seg" role="group" aria-label="보기 방식">
          <button type="button" data-layout="list" aria-pressed="${S.layout === "list"}">목록</button>
          <button type="button" data-layout="gallery" aria-pressed="${S.layout === "gallery"}">갤러리</button>
        </div>
      </div>
    </div>
    ${chips.length ? `<div class="filters">${chips.join("")}</div>` : ""}
    ${exN ? `<div class="banner"><span><b>예시 기록 ${exN}건</b>이 들어 있어요. 내 기록을 시작하면 지워 주세요.</span><button class="btn small" type="button" data-act="clearEx">예시 모두 지우기</button></div>` : ""}
    ${list.length ? (S.layout === "gallery" ? `<div class="gallery">${list.map(cardHtml).join("")}</div>` : `<div class="list">${list.map(e => rowHtml(e, pend)).join("")}</div>`) : emptyHtml()}`;
}
function calendarHtml(){
  if(!S.calMonth){ const d = new Date(); S.calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
  const m = S.calMonth, y = m.getFullYear(), mo = m.getMonth();
  const start = new Date(y, mo, 1 - new Date(y, mo, 1).getDay());
  const byDay = new Map(); S.entries.forEach(e => { if(!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); });
  const td = today(); const cells = [];
  const weeks = Math.ceil((new Date(y, mo, 1).getDay() + new Date(y, mo + 1, 0).getDate()) / 7);
  for(let i = 0; i < weeks * 7; i++){
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = ymd(d), list = byDay.get(key) || [];
    cells.push(`<button type="button" class="day ${d.getMonth() !== mo ? "out" : ""} ${key === td ? "today" : ""} ${S.calSel === key ? "sel" : ""}" data-day="${key}" aria-label="${fmtDate(key)} 기록 ${list.length}건">
      <span class="dn"><span>${d.getDate()}</span>${list.length ? `<span class="cnt mono">${list.length}</span>` : ""}</span>
      ${list.slice(0, 3).map(e => `<span class="t">${esc(e.title)}</span>`).join("")}
    </button>`);
  }
  const monthN = S.entries.filter(e => (e.date || "").startsWith(`${y}-${pad(mo + 1)}`)).length;
  let day = "";
  if(S.calSel){
    const list = (byDay.get(S.calSel) || []).slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const pend = pendingIds();
    day = `<section class="daylist"><h3>${fmtDate(S.calSel)}<span class="mono" style="font-size:12px;color:var(--ink-3)">${list.length}건</span><button class="btn small" type="button" data-act="newOn" data-date="${S.calSel}">+ 이 날 기록 추가</button></h3>
      ${list.length ? `<div class="list">${list.map(e => rowHtml(e, pend)).join("")}</div>` : `<p style="color:var(--ink-3);margin:0">이 날은 기록이 없어요.</p>`}</section>`;
  }
  return `
    <div class="vhead">
      <h2>${y}년 ${mo + 1}월</h2><span class="sub mono">${monthN}건</span>
      <div class="tools calnav">
        <button class="btn small" type="button" data-cal="-1" aria-label="이전 달">‹</button>
        <button class="btn small" type="button" data-cal="0">오늘</button>
        <button class="btn small" type="button" data-cal="1" aria-label="다음 달">›</button>
      </div>
    </div>
    <div class="calgrid">${WD.map((w, i) => `<div class="wd ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>`).join("")}${cells.join("")}</div>
    ${day || `<p style="color:var(--ink-3);font-size:13px;margin-top:14px">날짜를 누르면 그날의 기록을 볼 수 있어요.</p>`}`;
}
function statsHtml(){
  if(!S.loaded) return emptyHtml();
  const E = S.entries, now = new Date(), y = now.getFullYear(), ym = `${y}-${pad(now.getMonth() + 1)}`;
  const rated = E.filter(e => e.type === "taste" && e.rating);
  const avg = rated.length ? (rated.reduce((s, e) => s + e.rating, 0) / rated.length).toFixed(1) : "–";
  const kpis = [
    ["전체 기록", E.length, "건"],
    [`${y}년`, E.filter(e => (e.date || "").startsWith(String(y))).length, "건"],
    ["이번 달", E.filter(e => (e.date || "").startsWith(ym)).length, "건"],
    ["취향 평균 별점", avg, rated.length ? `/ 5 · ${rated.length}개` : ""]
  ];
  const months = [];
  for(let i = 11; i >= 0; i--){ const d = new Date(y, now.getMonth() - i, 1); months.push({ k:`${d.getFullYear()}-${pad(d.getMonth() + 1)}`, m:d.getMonth() + 1, y:d.getFullYear() }); }
  months.forEach(o => { o.n = E.filter(e => (e.date || "").startsWith(o.k)).length; });
  const max = Math.max(1, ...months.map(o => o.n));
  const W = 600, H = 210, top = 24, bot = 40, left = 8, bw = (W - left * 2) / 12;
  const bars = months.map((o, i) => {
    const h = (H - top - bot) * o.n / max, x = left + i * bw + bw * .18, w = bw * .64, yy = H - bot - h, cur = i === 11;
    return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, o.n ? 2 : 0).toFixed(1)}" rx="2" fill="${cur ? "var(--accent-strong)" : "var(--accent-mid)"}"/>
      ${o.n ? `<text x="${(x + w / 2).toFixed(1)}" y="${(yy - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-family="IBM Plex Mono, monospace" fill="var(--ink-2)">${o.n}</text>` : ""}
      <text x="${(x + w / 2).toFixed(1)}" y="${H - bot + 18}" text-anchor="middle" font-size="11" font-family="IBM Plex Mono, monospace" fill="${cur ? "var(--ink)" : "var(--ink-3)"}">${o.m}월</text>
      ${o.m === 1 || i === 0 ? `<text x="${(x + w / 2).toFixed(1)}" y="${H - bot + 33}" text-anchor="middle" font-size="10" font-family="IBM Plex Mono, monospace" fill="var(--ink-3)">${o.y}</text>` : ""}`;
  }).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 12개월 월별 기록 수"><line x1="${left}" x2="${W - left}" y1="${H - bot}" y2="${H - bot}" stroke="var(--line-2)"/>${bars}</svg>`;
  const cats = S.cats.map(c => ({ ...c, n:count(e => e.cat === c.code) })).filter(c => c.n).sort((a, b) => b.n - a.n);
  const cmax = Math.max(1, ...cats.map(c => c.n));
  const tags = tagCounts().slice(0, 18);
  const ago = new Date(y - 1, now.getMonth(), now.getDate());
  const near = E.filter(e => Math.abs(parseYmd(e.date) - ago) <= 7 * 864e5);
  const d30 = new Date(now - 30 * 864e5);
  const best = E.filter(e => e.rating && parseYmd(e.date) >= d30).sort((a, b) => b.rating - a.rating).slice(0, 5);
  const want = E.filter(e => e.type === "taste" && e.status === "want").sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);
  const mini = (list, empty, right) => list.length
    ? `<div class="mini">${list.map(e => `<button type="button" data-open="${esc(e.id)}"><span class="sheet">${sheetNo(e)}</span><span class="ti">${esc(e.title)}</span>${right(e)}</button>`).join("")}</div>`
    : `<div class="mini"><div class="note">${empty}</div></div>`;
  return `
    <div class="vhead"><h2>통계 · 회고</h2><span class="sub">${fmtDate(today())} 기준</span></div>
    <div class="kpis">${kpis.map(([l, v, u]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}<small>${u}</small></div></div>`).join("")}</div>
    <div class="stgrid">
      <section class="panel"><h3>월별 기록 <span>LAST 12 MONTHS</span></h3><div class="chart">${svg}</div></section>
      <section class="panel"><h3>분야별 기록 <span>BY FIELD</span></h3>
        ${cats.length ? `<div class="hbars">${cats.map(c => `<button type="button" class="hb" data-gocat="${esc(c.code)}"><span class="code">${esc(c.code)}</span><span class="nm">${esc(c.name)}</span><span class="tr"><span class="fl" style="width:${(c.n / cmax * 100).toFixed(1)}%"></span></span><span class="c">${c.n}</span></button>`).join("")}</div>` : `<p class="tag">아직 기록이 없어요.</p>`}
      </section>
      <section class="panel"><h3>1년 전 이맘때 <span>${fmtDate(ymd(ago)).slice(0, 10)} ±7일</span></h3>${mini(near, "1년 전 이맘때의 기록이 아직 없어요. 꾸준히 쌓이면 여기서 다시 만나요.", e => `<span class="tag mono">${(e.date || "").slice(5)}</span>`)}</section>
      <section class="panel"><h3>최근 30일 높은 별점 <span>TOP RATED</span></h3>${mini(best, "최근 30일 동안 별점을 매긴 기록이 없어요.", e => stars(e.rating))}</section>
      <section class="panel"><h3>위시 리스트 <span>WANT TO</span></h3>${mini(want, "취향 기록에서 상태를 ‘위시’로 두면 여기에 모여요.", e => `<span class="tag">${esc(catOf(e.cat).name)}</span>`)}</section>
      <section class="panel"><h3>자주 쓴 태그 <span>TAGS</span></h3>
        ${tags.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${tags.map(([t, n]) => `<button type="button" class="chip" data-gotag="${esc(t)}">#${esc(t)} <span class="mono" style="font-size:10.5px;opacity:.7">${n}</span></button>`).join("")}</div>` : `<p class="tag">태그를 붙이면 여기서 한눈에 보여요.</p>`}
      </section>
    </div>`;
}

/* ---------- stocks: helpers ---------- */
const PAL = ["#FFD580","#FFC067","#FFB343","#FFA500","#FFB27F","#FFA95C"];
const num = v => typeof v === "number" && isFinite(v);
const codeOf = sym => String(sym || "").replace(/\.(KS|KQ)$/, "");
const exchLabel = s => s.market === "KR" ? (/\.KQ$/.test(s.symbol) ? "코스닥" : "코스피") : "미국";
const parseNum = v => { const n = parseFloat(String(v ?? "").replace(/[,\s원$₩주]/g, "")); return isFinite(n) ? n : null; };
// company logos, trimmed to their content so the mark fills the circle.
// Financial Modeling Prep logos are redrawn on a canvas as Toss-style tiles (see fitLogo);
// Parqet is a plain fallback; otherwise the initial letter stays.
const LOGO_V = 3;
const FMP_LOGO = sym => `https://financialmodelingprep.com/image-stock/${encodeURIComponent(sym)}.png`;
const PARQET_LOGO = sym => `https://assets.parqet.com/logos/symbol/${encodeURIComponent(sym)}?format=png`;
let LOGOS = {};   // sym -> { u, bg } | { raw:url } | "none"
const logosReady = KV.get("logos-v" + LOGO_V).then(v => { if(v && typeof v === "object") LOGOS = v; }).catch(() => {});
const logoQueue = []; let logoBusy = false, logoSaveT = 0;
const isTicker = sym => /^[A-Za-z0-9.\-]{1,15}$/.test(sym);
try{ localStorage.removeItem("sansiya-logos"); }catch(e){}
for(let v = 1; v < LOGO_V; v++) KV.del("logos-v" + v).catch(() => {});
function logoImg(sym){
  const L = LOGOS[sym];
  if(L && L.u) return `<img class="st-logo fit ok" src="${L.u}" alt="">`;
  if(L && L.raw) return `<img class="st-logo raw" src="${esc(L.raw)}" alt="" referrerpolicy="no-referrer">`;
  return "";
}
function avaHtml(s, size){
  let h = 0; for(const ch of String(s.symbol || s.name || "?")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = PAL[h % PAL.length];
  const ch0 = (String(s.name || s.symbol || "?").match(/[가-힣A-Za-z0-9]/) || ["?"])[0].toUpperCase();
  const sym = String(s.symbol || ""), tick = isTicker(sym);
  if(tick && LOGOS[sym] === undefined) queueLogo(sym);
  return `<span class="st-ava${size ? " " + size : ""}" style="--ava:${c}" data-logo="${esc(sym)}" aria-hidden="true"><span class="st-ini">${esc(ch0)}</span>${tick ? logoImg(sym) : ""}</span>`;
}
function queueLogo(sym){ if(!logoQueue.includes(sym)) logoQueue.push(sym); if(!logoBusy) runLogoQueue(); }
async function runLogoQueue(){
  logoBusy = true;
  await logosReady;
  while(logoQueue.length){
    const sym = logoQueue.shift();
    if(LOGOS[sym] !== undefined){ paintLogo(sym); continue; }
    if(navigator.onLine === false){ logoQueue.length = 0; break; }
    let res = null;
    const st = S.stocks.find(x => x.symbol === sym);
    try{ res = await fitLogo(FMP_LOGO(sym), st ? st.name : sym); }catch(e){ res = null; }
    if(!res) res = (await probeRaw(PARQET_LOGO(sym))) ? { raw:PARQET_LOGO(sym) } : "none";
    LOGOS[sym] = res; paintLogo(sym);
    clearTimeout(logoSaveT); logoSaveT = setTimeout(() => KV.set("logos-v" + LOGO_V, LOGOS), 400);
  }
  logoBusy = false;
}
function probeRaw(url){
  return new Promise(r => { const im = new Image(); const t = setTimeout(() => r(false), 8000);
    im.referrerPolicy = "no-referrer"; im.onload = () => { clearTimeout(t); r(im.naturalWidth >= 8); }; im.onerror = () => { clearTimeout(t); r(false); }; im.src = url; });
}
function paintLogo(sym){
  const sel = `.st-ava[data-logo="${window.CSS && CSS.escape ? CSS.escape(sym) : sym}"]`;
  document.querySelectorAll(sel).forEach(el => { el.querySelectorAll(".st-logo").forEach(i => i.remove()); el.insertAdjacentHTML("beforeend", logoImg(sym)); });
}
// Toss-style tiles: a one-colour mark becomes a white mark on a circle of its brand colour,
// a mark drawn inside a coloured plate uses the plate as the circle, multi-colour marks stay on white,
// and pure wordmarks become the first letter of the stock name.
async function fitLogo(url, label){
  const r = await fetch(url, { mode:"cors", cache:"force-cache" });
  if(!r.ok) return null;
  const blob = await r.blob();
  if(!/^image\//.test(blob.type) || blob.size < 100) return null;
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height; if(w < 8 || h < 8) return null;
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d", { willReadFrequently:true }); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  const px = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
  let bg = null;
  if(corners.every(c => c[3] > 200)){
    const avg = [0, 1, 2].map(k => Math.round(corners.reduce((a, c) => a + c[k], 0) / 4));
    if(corners.every(c => Math.abs(c[0] - avg[0]) + Math.abs(c[1] - avg[1]) + Math.abs(c[2] - avg[2]) < 40)) bg = avg;
  }
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const bgWhite = !bg || lum(bg[0], bg[1], bg[2]) > 225;
  // how much a pixel belongs to the mark (0..1)
  const ink = i => {
    const a = d[i + 3] / 255; if(a < 0.12) return 0;
    if(!bg){
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if(mx - mn < 30 && mn > 200) return a * Math.max(0, 1 - (mn - 200) / 40);
      return a;
    }
    const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    return Math.max(0, Math.min(1, (dist - 30) / 150)) * a;
  };
  const A = { x0:w, y0:h, x1:-1, y1:-1, n:0 }, C = { x0:w, y0:h, x1:-1, y1:-1, n:0 };
  const add = (B, x, y) => { if(x < B.x0) B.x0 = x; if(y < B.y0) B.y0 = y; if(x > B.x1) B.x1 = x; if(y > B.y1) B.y1 = y; B.n++; };
  for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
    const i = (y * w + x) * 4;
    if(ink(i) < 0.35) continue;
    add(A, x, y);
    if(Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 70) add(C, x, y);
  }
  if(A.n < 20) return null;
  const area = B => (B.x1 - B.x0 + 1) * (B.y1 - B.y0 + 1);
  let box = A;
  if(C.n > 30 && C.n / A.n >= 0.25 && C.n / A.n < 0.85 && area(C) / area(A) < 0.6) box = C;
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  // colours inside the chosen box
  const bins = new Array(12).fill(0), binRGB = Array.from({ length:12 }, () => [0, 0, 0]);
  let inkW = 0, chromW = 0, darkW = 0, darkRGB = [0, 0, 0], lightW = 0;
  for(let y = box.y0; y <= box.y1; y++) for(let x = box.x0; x <= box.x1; x++){
    const i = (y * w + x) * 4, k = ink(i); if(k < 0.5) continue;
    const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B), L = lum(R, G, B);
    inkW += k;
    if(mx - mn > 60){
      let hue; const c = mx - mn;
      if(mx === R) hue = ((G - B) / c + 6) % 6; else if(mx === G) hue = (B - R) / c + 2; else hue = (R - G) / c + 4;
      const bi = Math.floor(hue * 2) % 12;
      bins[bi] += k; binRGB[bi][0] += R * k; binRGB[bi][1] += G * k; binRGB[bi][2] += B * k; chromW += k;
    } else if(L < 110){ darkW += k; darkRGB[0] += R * k; darkRGB[1] += G * k; darkRGB[2] += B * k; }
    else if(L > 200) lightW += k;
  }
  // merge neighbouring hue bins into clusters
  const order = bins.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const used = new Set(), clusters = [];
  for(const [v, i] of order){
    if(!v || used.has(i)) continue;
    let tot = 0, rgb = [0, 0, 0];
    for(const j of [i, (i + 1) % 12, (i + 11) % 12]) if(!used.has(j)){ used.add(j); tot += bins[j]; rgb = rgb.map((c, q) => c + binRGB[j][q]); }
    clusters.push({ w:tot, rgb:rgb.map(c => Math.round(c / tot)) });
  }
  const big = clusters.filter(c => c.w > 0.12 * Math.max(chromW, 1) && c.w > 0.06 * inkW);
  let mode, fill, markWhite = true;
  // a mark drawn as white details inside a coloured plate (a disc or a box): the plate colour fills the circle
  // and the inner white details become the mark
  let hole = null;
  if(bgWhite && bw > 8 && bh > 8){
    const n = bw * bh, inside = new Uint8Array(n);
    let inkN = 0;
    for(let y = 0; y < bh; y++) for(let x = 0; x < bw; x++){ if(ink(((y + box.y0) * w + (x + box.x0)) * 4) >= 0.5){ inside[y * bw + x] = 1; inkN++; } }
    const cx = (bw - 1) / 2, cy = (bh - 1) / 2, rx = bw / 2, ry = bh / 2;
    const inE = (x, y, k) => ((x - cx) / (rx * k)) ** 2 + ((y - cy) / (ry * k)) ** 2 <= 1;
    let eN = 0, eInk = 0, oInk = 0;
    for(let y = 0; y < bh; y++) for(let x = 0; x < bw; x++){ if(inE(x, y, 1)){ eN++; eInk += inside[y * bw + x]; } else oInk += inside[y * bw + x]; }
    // a plate has an (almost) unbroken edge: check a thin band along the box edge or the disc rim
    const band = test => { let t = 0, k = 0; for(let y = 0; y < bh; y++) for(let x = 0; x < bw; x++) if(test(x, y)){ t++; k += inside[y * bw + x]; } return t ? k / t : 0; };
    let region = null;
    const sides = [band((x, y) => y >= 1 && y < 4), band((x, y) => y >= bh - 4 && y < bh - 1), band((x, y) => x >= 1 && x < 4), band((x, y) => x >= bw - 4 && x < bw - 1)];
    if(inkN / n > 0.72 && Math.min(...sides) > 0.75)
      region = (x, y) => x >= 2 && y >= 2 && x < bw - 2 && y < bh - 2;
    else if(bw / bh > 0.8 && bw / bh < 1.25 && eInk / eN > 0.7 && oInk / Math.max(1, n - eN) < 0.2 && band((x, y) => inE(x, y, 0.96) && !inE(x, y, 0.84)) > 0.9)
      region = (x, y) => inE(x, y, 0.93);
    if(region){
      const outside = new Uint8Array(n), H = { x0:bw, y0:bh, x1:-1, y1:-1, n:0 };
      let rN = 0;
      for(let y = 0; y < bh; y++) for(let x = 0; x < bw; x++){
        const j = y * bw + x;
        if(!region(x, y)){ outside[j] = 1; continue; }
        rN++;
        if(!inside[j]) add(H, x, y);
      }
      if(H.n > 0.02 * rN){
        const seen = new Uint8Array(n); let pieces = 0;
        for(let j0 = 0; j0 < n; j0++){
          if(outside[j0] || inside[j0] || seen[j0]) continue;
          let size = 0; const st = [j0]; seen[j0] = 1;
          while(st.length){ const j = st.pop(), x = j % bw, y = (j / bw) | 0; size++;
            for(const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]){
              if(nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
              const k = ny * bw + nx; if(!outside[k] && !inside[k] && !seen[k]){ seen[k] = 1; st.push(k); } } }
          if(size > 3) pieces++;
        }
        hole = { outside, H, pieces };
      }
    }
  }
  const markBox = hole ? { x0:box.x0 + hole.H.x0, y0:box.y0 + hole.H.y0, x1:box.x0 + hole.H.x1, y1:box.y0 + hole.H.y1 } : box;
  const mbw = markBox.x1 - markBox.x0 + 1, mbh = markBox.y1 - markBox.y0 + 1;
  const lettering = hole && hole.pieces >= 6 && mbw / mbh > 1.5;
  const wordmark = (mbw / mbh > 2.4 && (box === A || !!hole)) || lettering;
  if(!bgWhite){ mode = "bg"; fill = bg; markWhite = false; }
  else if(big.length >= 2 && chromW > 0.35 * inkW){ mode = "multi"; fill = [255, 255, 255]; markWhite = false; }
  else if(chromW > 0.3 * inkW && big.length){ mode = "mono"; fill = big[0].rgb; }
  else if(darkW > 0){ mode = "mono"; fill = darkRGB.map(c => Math.round(c / darkW)); }
  else { mode = "multi"; fill = [255, 255, 255]; markWhite = false; }
  if(hole && mode === "mono") mode = "plate";
  if(wordmark && mode !== "multi") mode = "letter";
  // very light brand colours keep a dark mark
  const fillL = lum(fill[0], fill[1], fill[2]);
  const markColor = fillL > 190 ? [26, 26, 26] : [255, 255, 255];

  const N = 128, out = document.createElement("canvas"); out.width = out.height = N;
  const o = out.getContext("2d");
  o.fillStyle = `rgb(${fill.join(",")})`; o.fillRect(0, 0, N, N);
  o.imageSmoothingQuality = "high";
  if(mode === "letter"){
    const ch = (String(label || "?").match(/[가-힣A-Za-z0-9]/) || ["?"])[0].toUpperCase();
    o.fillStyle = `rgb(${markColor.join(",")})`;
    o.font = `700 ${/[가-힣]/.test(ch) ? 58 : 64}px "Pretendard","Apple SD Gothic Neo","Malgun Gothic","Segoe UI",sans-serif`;
    o.textAlign = "center"; o.textBaseline = "middle"; o.fillText(ch, N / 2, N / 2 + 3);
  } else {
    // mark size: about 58% of the circle, wide marks up to 68% wide
    const sc = Math.min((N * 0.68) / mbw, (N * 0.58) / mbh, (N * 0.62) / Math.sqrt(mbw * mbh));
    const dw = mbw * sc, dh = mbh * sc, dx = (N - dw) / 2, dy = (N - dh) / 2;
    if(mode === "plate"){
      const m = document.createElement("canvas"); m.width = mbw; m.height = mbh;
      const mg = m.getContext("2d"), md = mg.createImageData(mbw, mbh);
      for(let y = 0; y < mbh; y++) for(let x = 0; x < mbw; x++){
        const gx = x + markBox.x0, gy = y + markBox.y0, j = (y * mbw + x) * 4;
        md.data[j] = markColor[0]; md.data[j + 1] = markColor[1]; md.data[j + 2] = markColor[2];
        md.data[j + 3] = hole.outside[(gy - box.y0) * bw + (gx - box.x0)] ? 0 : Math.round((1 - ink((gy * w + gx) * 4)) * 255);
      }
      mg.putImageData(md, 0, 0);
      o.drawImage(m, 0, 0, mbw, mbh, dx, dy, dw, dh);
    } else if(markWhite && mode !== "bg"){
      const m = document.createElement("canvas"); m.width = bw; m.height = bh;
      const mg = m.getContext("2d"), md = mg.createImageData(bw, bh);
      for(let y = 0; y < bh; y++) for(let x = 0; x < bw; x++){
        const i = ((y + box.y0) * w + (x + box.x0)) * 4, j = (y * bw + x) * 4;
        md.data[j] = markColor[0]; md.data[j + 1] = markColor[1]; md.data[j + 2] = markColor[2];
        md.data[j + 3] = Math.round(ink(i) * 255);
      }
      mg.putImageData(md, 0, 0);
      o.drawImage(m, 0, 0, bw, bh, dx, dy, dw, dh);
    } else {
      o.drawImage(cv, box.x0, box.y0, bw, bh, dx, dy, dw, dh);
    }
  }
  return { u:out.toDataURL("image/png"), bg:`rgb(${fill.join(",")})`, mode };
}
// raw (fallback) logos: show once loaded, drop on error so the initial letter shows
document.addEventListener("load", ev => { const t = ev.target; if(t && t.classList && t.classList.contains("st-logo")) t.classList.add("ok"); }, true);
function fmtMoney(v, cur, sign){
  if(!num(v)) return "-";
  const sg = sign && v > 0 ? "+" : (v < 0 ? "-" : "");
  const a = Math.abs(v);
  if(cur === "PT" || cur === "FX") return `${sg}${a.toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 })}${cur === "FX" ? "원" : ""}`;
  return cur === "USD" ? `${sg}$${a.toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 })}` : `${sg}${Math.round(a).toLocaleString("ko-KR")}원`;
}
// my own amounts (valuation, profit, principal, dividends) can be hidden; prices and % stay visible
const my = (v, cur, sign) => S.hideAmt ? (cur === "USD" ? "$••••" : "••••원") : fmtMoney(v, cur, sign);
const fmtPct = (v, d = 2) => num(v) ? `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(d)}%` : "-";
const tone = v => !num(v) || Math.abs(v) < 1e-9 ? "flat" : v > 0 ? "up" : "down";
const fmtQty = q => (+q || 0).toLocaleString("ko-KR", { maximumFractionDigits:6 });
function fmtShort(v){
  if(!num(v)) return "-";
  const a = Math.abs(v);
  if(a >= 1e8) return (v / 1e8).toFixed(a >= 1e9 ? 0 : 1).replace(/\.0$/, "") + "억";
  if(a >= 1e4) return (v / 1e4).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "만";
  return Math.round(v).toLocaleString("ko-KR");
}
function fmtAgo(t){
  const s = (Date.now() - t) / 1000;
  return s < 60 ? "방금" : s < 3600 ? `${Math.floor(s / 60)}분 전` : fmtTime(t);
}
const fxRate = () => S.fx && num(S.fx.usdkrw) ? S.fx.usdkrw : null;
// "457,034원" for a dollar amount (empty for won amounts or when the rate is unknown)
const wonOf = (v, cur, sign) => cur === "USD" && num(v) && fxRate() ? fmtMoney(v * fxRate(), "KRW", sign) : "";
const toKRW = (v, cur) => !num(v) ? null : cur !== "USD" ? v : (fxRate() ? v * fxRate() : null);
const quoteOf = s => S.quotes[s.symbol] || null;
const divKRW = d => num(d.krw) ? d.krw : toKRW(d.amount, d.currency);
function position(s){
  const q = quoteOf(s), price = q && num(q.price) ? q.price : null;
  const qty = +s.qty || 0, avg = +s.avgPrice || 0, cost = qty * avg;
  const value = price != null ? qty * price : null;
  const pl = value != null ? value - cost : null;
  const plPct = value != null && cost > 0 ? pl / cost * 100 : null;
  const day = q && num(q.change) ? qty * q.change : null;
  return { q, price, qty, avg, cost, value, pl, plPct, day,
    valueKRW: toKRW(value != null ? value : cost, s.currency), costKRW: toKRW(cost, s.currency),
    plKRW: toKRW(pl, s.currency), dayKRW: toKRW(day, s.currency) };
}
function portfolio(){
  let value = 0, cost = 0, day = 0, missing = 0, fxMissing = false;
  const rows = S.stocks.filter(s => +s.qty > 0 && !s.hidden).map(s => {
    const p = position(s);
    if(p.price == null) missing++;
    if(s.currency === "USD" && !fxRate()) fxMissing = true;
    value += p.valueKRW || 0; cost += p.costKRW || 0; day += p.dayKRW || 0;
    return { s, p };
  }).sort((a, b) => (b.p.valueKRW || 0) - (a.p.valueKRW || 0));
  const pl = value - cost;
  return { rows, value, cost, pl, plPct: cost > 0 ? pl / cost * 100 : null, day, missing, fxMissing,
    hasUS: rows.some(r => r.s.currency === "USD") };
}

/* ---------- stocks: quotes ---------- */
async function refreshQuotes(force, only){
  if(!S.B || !S.uid || (S.qLoading && !only)) return;
  if(!force && !only && Date.now() - S.quotesAt < 55e3) return;
  if(!navigator.onLine){ S.qErr = "offline"; paintQuotes(); return; }
  const symbols = only || [...new Set(S.stocks.map(s => s.symbol))];
  if(!only){ S.qLoading = true; paintQuotes(true); }
  try{
    const d = await S.B.invoke(only ? { action:"quotes", symbols } : { action:"quotes", symbols, market:MARKET.map(m => m[0]) });
    Object.assign(S.quotes, d.quotes || {});
    if(d.fx) S.fx = d.fx;
    if(d.market) Object.assign(S.market, d.market);
    if(!only){ S.quotesAt = d.at || Date.now(); S.qErr = ""; }
    KV.set(k("quotes"), { quotes:S.quotes, fx:S.fx, at:S.quotesAt, market:S.market });
  }catch(e){
    if(!only) S.qErr = isNetErr(e) ? "offline" : errMsg(e);
  }finally{
    if(!only) S.qLoading = false;
    paintQuotes();
  }
}
function paintQuotes(onlyButton){
  if(onlyButton){ const b = $("#stRefresh"); if(b) b.textContent = "불러오는 중…"; return; }
  if(S.view === "stocks") render();
  if(OV && OV.kind === "stock") updateStockDetail();
  if(OV && OV.kind === "index"){ const el = $("#stp-price"), s = ovSubject(); if(el && s) el.innerHTML = indexPriceHtml(s); }
  if(OV && OV.kind === "stform"){ const el = $("#stfPrice"); if(el) el.innerHTML = stfPriceHtml(); }
  if(OV && OV.kind === "divform"){ const el = $("#dvKrwHint"); if(el) el.textContent = dvKrwHint(); }
}
const eyeBtn = () => `<button type="button" class="st-eye" data-act="stEye" aria-pressed="${S.hideAmt}">${S.hideAmt ? "금액 보기" : "금액 숨기기"}</button>`;
const refreshBtn = () => `<button type="button" class="st-refresh" id="stRefresh" data-act="stRefresh" title="시세 새로고침">${
  S.qLoading ? "불러오는 중…" : S.qErr === "offline" ? `오프라인${S.quotesAt ? " · " + fmtTime(S.quotesAt) : ""}` : S.qErr ? "다시 불러오기" : S.quotesAt ? `${fmtAgo(S.quotesAt)} 갱신` : "시세 불러오기"}</button>`;
function quoteLine(q, s){
  if(!q) return S.qErr && S.qErr !== "offline" ? esc(S.qErr) : "시세를 아직 불러오지 못했어요.";
  if(q.source === "krx-close") return `${esc(q.asOf || "")} 종가 기준 · 실시간 시세를 못 불러와 전 영업일 종가를 보여 줘요.`;
  const t = q.time ? fmtTime(q.time * 1000) : "";
  return `${t ? t + " 기준 · " : ""}${s.market === "KR" ? "한국 시세는 약 20분 늦을 수 있어요." : "시세는 조금 늦을 수 있어요."}`;
}

/* ---------- stocks: Toss Securities link (read-only holdings sync) ---------- */
const TOSS_KIT = "toss-sync/sansiya-toss-sync.zip";
async function loadBroker(){
  if(!S.B || !S.B.getBrokerLink || !navigator.onLine) return;
  try{ S.broker = await S.B.getBrokerLink(); }catch(e){ return; }
  if(OV && OV.kind === "settings") renderSettings();
  if(S.view === "stocks") render();
}
function brokerProblem(L){
  if(!L || L.last_status !== "error") return "";
  const ip = L.last_ip ? esc(L.last_ip) : "이 컴퓨터의 IP";
  const m = {
    "ip-not-allowed": `토스가 연결 프로그램의 IP(<b>${ip}</b>)를 막았어요. 토스증권 PC 웹 → 설정 → Open API → 허용 IP 관리에 등록해 주세요. 인터넷 공유기를 다시 켜면 IP가 바뀔 수 있어요.`,
    "invalid-client": "토스 Open API 키가 맞지 않아요. 키를 다시 발급했다면 연결 프로그램을 다시 설치해 주세요.",
    "no-account": "토스증권 종합매매 계좌를 찾지 못했어요.",
    "rate-limit": "토스 요청 한도에 잠깐 걸렸어요. 다음 동기화 때 다시 시도해요."
  }[L.last_error];
  return m || `토스에서 보유 종목을 읽지 못했어요 (${esc(L.last_error || "알 수 없는 오류")}).`;
}
function brokerStatusLine(){
  const L = S.broker, tossed = S.stocks.filter(x => x.broker === "toss");
  if(!L && !tossed.length) return "";
  const when = Math.max(0, ...tossed.map(x => x.brokerSyncedAt || 0), L && L.last_status === "ok" ? Date.parse(L.last_sync_at) || 0 : 0);
  const prob = brokerProblem(L);
  return `<p class="st-broker ${prob ? "bad" : ""}"><span class="st-toss">토스</span>${prob ? `연동 확인이 필요해요 · <button type="button" class="linkish" data-act="settings">설정 보기</button>`
    : when ? `토스증권 보유 종목과 ${esc(fmtAgo(when))} 맞췄어요` : `연결 프로그램을 설치하면 보유 종목이 자동으로 들어와요`}</p>`;
}
function randomCode(){
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return "ssy_" + btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256Hex(t){
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function makeBrokerCode(){
  if(!navigator.onLine){ toast("인터넷에 연결되어 있을 때 만들 수 있어요."); return; }
  const code = randomCode();
  try{ S.broker = await S.B.setBrokerLink(await sha256Hex(code)); }
  catch(e){ toast(/broker_links|relation|schema/i.test(errMsg(e)) ? "서버 준비가 아직 안 됐어요. 잠시 뒤 다시 시도해 주세요." : "연결 코드를 만들지 못했어요: " + errMsg(e)); return; }
  if(OV && OV.kind === "settings"){ OV.brokerCode = code; OV.brokerConfirm = false; renderSettings(); }
}
async function unlinkBroker(){
  try{ await S.B.deleteBrokerLink(); }catch(e){ toast("연결을 끊지 못했어요: " + errMsg(e)); return; }
  S.broker = null; S.stocks = S.stocks.map(x => x.broker === "toss" ? { ...x, broker:"" } : x); saveStocks();
  if(OV && OV.kind === "settings"){ OV.brokerCode = ""; OV.brokerConfirm = false; renderSettings(); }
  toast("토스증권 연결을 끊었어요. 컴퓨터의 연결 프로그램도 '3-turn-off'로 지워 주세요.");
}
function brokerSettingsHtml(){
  const L = S.broker, code = OV.brokerCode;
  if(S.B.kind === "local") return `<p class="note">이 기기 저장 모드에서는 쓸 수 없어요.</p>`;
  if(L === undefined) return `<p class="note">연동 상태를 불러오는 중…</p>`;
  const steps = `<ol class="steps">
      <li>컴퓨터에 <b>연결 프로그램</b>을 받아 압축을 풀어요. <a href="${TOSS_KIT}" download>연결 프로그램 받기 (Windows)</a></li>
      <li>토스증권 PC 웹 → 설정 → Open API에서 <b>키를 발급</b>하고, 아래쪽 <b>허용 IP 관리</b>에 설치 화면이 알려 주는 IP를 등록해요.</li>
      <li><b>1-install</b>을 더블클릭하고 키와 이 연결 코드를 붙여넣어요.</li></ol>`;
  if(code) return `<span>연결 코드가 만들어졌어요. 지금 한 번만 보여요.</span>
      <div class="codebox"><code id="brokerCode">${esc(code)}</code><button class="btn small" type="button" data-act="copyBroker">복사</button></div>
      ${steps}<p class="note">코드를 잃어버리면 새로 만들면 돼요. 새로 만들면 예전 코드는 바로 막혀요.</p>`;
  if(!L) return `<span>토스증권 계좌의 보유 종목·수량·평균 단가를 '내 주식'에 자동으로 맞춰요.</span>
      <p class="note">조회만 해요. 주문은 하지 않아요. 토스 키는 컴퓨터에만 암호화해서 두고, 산시야에는 보유 종목 정보만 와요. 컴퓨터가 켜져 있을 때 30분마다 맞춰요.</p>
      <div class="acts"><button class="btn small primary" type="button" data-act="brokerCode">연결 코드 만들기</button></div>`;
  const prob = brokerProblem(L);
  const ok = L.last_status === "ok";
  return `<span>${ok ? `연결됨 · 보유 ${L.holdings_count || 0}종목${L.account_tail ? ` · 계좌 ••••${esc(L.account_tail)}` : ""}` : prob ? "연결 확인이 필요해요" : "연결 프로그램을 기다리는 중이에요"}</span>
      ${L.last_sync_at ? `<p class="note">마지막 소식 ${esc(fmtTime(Date.parse(L.last_sync_at)))}</p>` : `<p class="note">아직 연결 프로그램에서 소식이 없어요. 설치를 마치면 여기에 표시돼요.</p>${steps}`}
      ${prob ? `<p class="err">${prob}</p>` : ""}
      ${OV.brokerConfirm ? `<p class="err">연결을 끊으면 연결 코드가 막혀서 더 이상 맞추지 않아요. 이미 들어온 보유 종목은 그대로 남아요.</p>
        <div class="acts"><button class="btn small danger" type="button" data-act="brokerOffYes">연결 끊기</button><button class="btn small" type="button" data-act="brokerOffNo">취소</button></div>`
      : `<div class="acts"><button class="btn small" type="button" data-act="brokerCode">새 연결 코드 만들기</button><button class="btn small ghost danger" type="button" data-act="brokerOff">연결 끊기</button></div>`}`;
}

/* ---------- stocks: market strip (US indices + dollar rate) ---------- */
const MARKET = [
  ["^IXIC", "나스닥", "NASDAQ Composite", "나스닥 거래소에 상장된 3,000여 종목으로 만든 지수예요. 기술주 비중이 높아요."],
  ["^GSPC", "S&P 500", "S&P 500 Index", "미국 대형주 500개로 만든 미국 시장의 대표 지수예요."],
  ["^DJI", "다우존스", "Dow Jones Industrial Average", "미국 대표 우량주 30개로 만든 가장 오래된 지수예요."],
  ["KRW=X", "달러 환율", "USD/KRW", "1달러를 사는 데 드는 원화예요. 환율이 오르면 미국 주식의 원화 평가금도 커져요."],
  ["JPYKRW=X", "엔화 환율", "JPY/KRW · 100엔 기준", "100엔을 사는 데 드는 원화예요. 일본 여행이나 엔화 자산을 볼 때 참고해요.", 100],
  ["EURKRW=X", "유로 환율", "EUR/KRW", "1유로를 사는 데 드는 원화예요. 유럽 여행이나 유로 자산을 볼 때 참고해요."]
];
const mkCur = sym => /=X$/.test(sym) ? "FX" : "PT";
const mkScale = sym => (MARKET.find(m => m[0] === sym) || [])[4] || 1;
// market row with the display scale applied (yen is shown per 100 yen)
function mkRow(sym){
  const m = S.market[sym]; if(!m) return null;
  const k = mkScale(sym), x = v => num(v) ? v * k : v;
  return { ...m, price:x(m.price), change:x(m.change), prevClose:x(m.prevClose), spark:(m.spark || []).map(x) };
}
function sparkSvg(vals, base, tn){
  if(!vals || vals.length < 2) return `<svg class="mk-sp" viewBox="0 0 100 26" aria-hidden="true"></svg>`;
  const all = num(base) ? vals.concat(base) : vals;
  let mn = Math.min(...all), mx = Math.max(...all); if(mn === mx){ mn -= 1; mx += 1; }
  const X = i => (i / (vals.length - 1) * 100).toFixed(2), Y = v => (2 + (mx - v) / (mx - mn) * 22).toFixed(2);
  const col = tn === "up" ? "var(--up)" : tn === "down" ? "var(--down)" : "var(--ink-3)";
  return `<svg class="mk-sp" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
    ${num(base) ? `<line x1="0" x2="100" y1="${Y(base)}" y2="${Y(base)}" stroke="var(--line-2)" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>` : ""}
    <polyline points="${vals.map((v, i) => X(i) + "," + Y(v)).join(" ")}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function marketHtml(){
  return `<div class="mk-row" role="list" aria-label="미국 지수와 달러 환율">${MARKET.map(([sym, name]) => {
    const m = mkRow(sym), cur = mkCur(sym), tn = tone(m && m.change);
    return `<button type="button" class="mk" role="listitem" data-index="${esc(sym)}">
      <span class="mk-n">${esc(name)}</span>
      <b class="mk-v">${m ? fmtMoney(m.price, cur) : "-"}</b>
      <span class="mk-c ${tn}">${m && num(m.changePct) ? `${fmtMoney(m.change, cur === "FX" ? "PT" : cur, true)} (${fmtPct(m.changePct)})` : "&nbsp;"}</span>
      ${sparkSvg(m && m.spark, m && m.prevClose, tn)}</button>`;
  }).join("")}</div>`;
}
function ovSubject(){
  if(!OV) return null;
  if(OV.kind === "stock") return S.stocks.find(x => x.id === OV.id) || null;
  if(OV.kind === "index"){ const m = MARKET.find(x => x[0] === OV.sym); return m ? { id:m[0], symbol:m[0], name:m[1], currency:mkCur(m[0]), scale:m[4] || 1 } : null; }
  return null;
}
function openIndex(sym){
  if(!MARKET.some(m => m[0] === sym)) return;
  if(OV) endOvKeepHistory();
  OV = { kind:"index", sym, range:"1d" };
  renderIndexDetail(); loadHistory();
}
function indexPriceHtml(s){
  const m = mkRow(s.symbol), cur = s.currency;
  const t = m && m.time ? fmtTime(m.time * 1000) : "";
  return `<div class="st-big">${m ? fmtMoney(m.price, cur) : "-"}</div>
    <div class="st-chg ${tone(m && m.change)}"><span class="st-muted0">어제보다</span> ${m && num(m.change) ? `${fmtMoney(m.change, cur, true)} (${fmtPct(m.changePct)})` : "시세 없음"}</div>
    <p class="st-note">${t ? t + " 기준 · " : ""}시세는 조금 늦을 수 있어요.</p>`;
}
function renderIndexDetail(){
  const s = ovSubject(); if(!s){ closeOv(); return; }
  const info = MARKET.find(x => x[0] === s.symbol);
  showOv(`<div class="sheetbox st-sheet" role="dialog" aria-modal="true" aria-label="${esc(s.name)}">
    <div class="sb-head"><span class="ttl">${s.currency === "FX" ? "환율" : "미국 지수"}</span>
      <div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body">
      <div class="st-dhead"><div style="min-width:0"><h2 class="st-dname">${esc(s.name)}</h2><div class="st-dsym">${esc(info[2])}</div></div></div>
      <div id="stp-price">${indexPriceHtml(s)}</div>
      <div class="st-chartbox">
        <div class="st-chart" id="stChart">${chartHtml(S.hist[s.symbol + "|" + OV.range], s)}</div>
        <div class="seg st-ranges" role="group" aria-label="기간">${RANGES.map(([r, l]) => `<button type="button" data-strange="${r}" aria-pressed="${OV.range === r}">${l}</button>`).join("")}</div>
      </div>
      <p class="mk-about">${esc(info[3])}</p>
    </div>
  </div>`);
  bindChart();
}

/* ---------- stocks: allocation donut ---------- */
// contrasting colours that go around the ring in an order checked for colour-blind and normal vision
// (every neighbouring pair, both themes); the biggest holding is always blue. Hex values live in styles.css.
const DONUT_RINGS = {
  1:["blue"], 2:["blue", "green"], 3:["blue", "pink", "green"], 4:["blue", "green", "violet", "red"],
  5:["blue", "pink", "green", "violet", "red"], 6:["blue", "aqua", "violet", "green", "cyan", "red"],
  7:["blue", "aqua", "violet", "red", "cyan", "green", "pink"]
};
const DONUT = DONUT_RINGS[7].map(n => `var(--dn-${n})`);
function ringColours(sl, best){
  const ring = best.slices, n = ring.filter(x => !x.other).length, pal = DONUT_RINGS[Math.min(7, Math.max(1, n))];
  let p0 = ring.findIndex(x => x.i === 0); if(p0 < 0) p0 = 0;
  let k = 0;
  for(let j = 0; j < ring.length; j++){
    const x = ring[(p0 + j) % ring.length];
    x.color = x.other ? "var(--donut-other)" : `var(--dn-${pal[k++ % pal.length]})`;
    sl[x.i].color = x.color;
  }
}
function allocSlices(P){
  const rows = P.rows.map(({ s, p }) => ({ name:s.name, v:p.valueKRW || 0, ids:[s.id] })).filter(r => r.v > 0);
  let sl = rows;
  if(rows.length > 7){
    const rest = rows.slice(6);
    sl = [...rows.slice(0, 6), { name:`기타 ${rest.length}종목`, v:rest.reduce((a, r) => a + r.v, 0), ids:rest.flatMap(r => r.ids), other:true }];
  }
  const tot = sl.reduce((a, r) => a + r.v, 0) || 1;
  sl.forEach((r, i) => { r.pct = r.v / tot * 100; r.color = r.other ? "var(--donut-other)" : DONUT[i]; });
  return sl;
}
const DONUT_MEMO = new Map();
const DG = { W:440, H:280, cx:220, cy:140, R:98, r:56, GAP:20 };
// places slices and labels so every leader line is one straight horizontal stroke (memoised by the slice shares)
function donutLayout(sl){
  const { H, cx, cy, R, r, GAP } = DG, TAU = Math.PI * 2;
  const angOf = (x, y) => { const a = Math.atan2(x - cx, cy - y); return a < 0 ? a + TAU : a; };
  const inSlice = (s, px, py) => { const dx = px - cx, dy = py - cy, rr = Math.hypot(dx, dy); if(rr < r + 1 || rr > R - 1) return false;
    return (angOf(px, py) - s.a0 + TAU * 2) % TAU <= s.a1 - s.a0; };
  // where on the slice a horizontal line at height y can start (closest to the label side)
  // the line must leave the slice through its outer edge, so it never runs over a neighbouring slice
  const dotAt = (s, y) => {
    const dy = y - cy; if(Math.abs(dy) > R - 4) return null;
    const ex = cx + s.side * Math.sqrt((R - 4) ** 2 - dy * dy);
    if(!inSlice(s, ex, y)) return null;
    // also clear of the neighbours where the line crosses the outer rim (with a little margin for the gap)
    const ox = cx + s.side * Math.sqrt(Math.max(0, (R + 1) ** 2 - dy * dy)), oa = (angOf(ox, y) - s.a0 + TAU * 2) % TAU;
    if(Math.abs(dy) > R || oa < 0.02 || oa > s.a1 - s.a0 - 0.02) return null;
    let len = 0; while(len < 14 && inSlice(s, ex - s.side * (len + 1), y)) len++;
    return [ex - s.side * Math.max(2, len), y];
  };
  const layout = (order, off, flips) => {
  let a0 = off, fk = 0;
  const slices = order.map(i => {
    const x = sl[i], a1 = a0 + x.pct / 100 * TAU, mid = (a0 + a1) / 2, s = { ...x, i, a0, a1, mid, side:Math.sin(mid) >= 0 ? 1 : -1 };
    // slices near 12 or 6 o'clock may put their label on either side
    if(Math.abs(Math.sin(mid)) < 0.57){ if(flips >> fk & 1) s.side = -s.side; fk++; }
    a0 = a1; return s;
  });
  // the heights this slice covers on its own side, and the height its label would like
  slices.forEach(s => {
    let lo = 1e9, hi = -1e9;
    for(let t = 0; t <= 40; t++){ const a = s.a0 + (s.a1 - s.a0) * t / 40; if(Math.sin(a) * s.side < -1e-6) continue;
      const y = cy - (R - 4) * Math.cos(a); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if(lo > hi){ lo = hi = cy - (r + R) / 2 * Math.cos(s.mid); }
    s.lo = lo + 1.5; s.hi = Math.max(lo + 1.5, hi - 1.5); s.want = Math.min(s.hi, Math.max(s.lo, cy - (r + R) / 2 * Math.cos(s.mid)));
  });
  for(const side of [1, -1]){
    const L = slices.filter(s => s.side === side).sort((a, b) => a.want - b.want);
    L.forEach((s, k) => { s.y = k ? Math.min(Math.max(s.want, L[k - 1].y + GAP), Math.max(s.hi, L[k - 1].y + GAP)) : s.want; });
    for(let k = L.length - 2; k >= 0; k--) if(L[k].y > L[k + 1].y - GAP) L[k].y = Math.max(L[k].lo, L[k + 1].y - GAP);
    for(let k = 1; k < L.length; k++) if(L[k].y < L[k - 1].y + GAP) L[k].y = L[k - 1].y + GAP;
    L.forEach(s => { s.y = Math.max(16, Math.min(H - 6, s.y)); });
  }
  let bent = 0, moved = 0;
  slices.forEach(s => { s.dot = dotAt(s, s.y); if(!s.dot) bent++; moved += Math.abs(s.y - s.want); });
  return { slices, score:bent * 1e4 + moved, flippable:fk };
  };
  // try the slices in size order and with big/small taking turns, at every 5° rotation; keep the tidiest
  const sorted = sl.map((_, i) => i), turns = [];
  for(let i = 0, j = sl.length - 1; i <= j; i++, j--){ turns.push(i); if(j !== i) turns.push(j); }
  const memoKey = sl.map(x => x.name + ":" + x.pct.toFixed(1)).join("|");
  let best = DONUT_MEMO.get(memoKey) ? layout(...DONUT_MEMO.get(memoKey)) : null;
  if(!best) search: for(const order of [sorted, turns]) for(let deg = 0; deg < 360; deg += 3){
    const off = deg / 180 * Math.PI, L0 = layout(order, off, 0);
    if(!best || L0.score < best.score - 0.5){ best = L0; best.args = [order, off, 0]; }
    for(let m = 1; m < 1 << Math.min(L0.flippable, 3); m++){ const L = layout(order, off, m); if(L.score < best.score - 0.5){ best = L; best.args = [order, off, m]; } }
    if(best.score < 12) break search;
  }
  if(best.args){ if(DONUT_MEMO.size > 30) DONUT_MEMO.clear(); DONUT_MEMO.set(memoKey, best.args); }
  return best;
}
// when there is no room for straight lines, the two smallest slices join "기타" (the bars still list every stock)
function donutPlan(P){
  let sl = allocSlices(P);
  for(let guard = 0; guard < 6; guard++){
    const best = sl.length ? donutLayout(sl) : null;
    if(!best || best.score < 1e4){ if(best) ringColours(sl, best); return { sl, best }; }
    const small = sl.filter(x => !x.other && x.pct < 3).sort((a, b) => a.pct - b.pct);
    const other = sl.find(x => x.other);
    if(small.length < (other ? 1 : 2)){ ringColours(sl, best); return { sl, best }; }
    const fold = other ? [other, small[0]] : small.slice(0, 2);
    const rest = sl.filter(x => !fold.includes(x));
    const ids = fold.flatMap(x => x.ids), v = fold.reduce((a, x) => a + x.v, 0);
    sl = [...rest, { name:`기타 ${ids.length}종목`, v, ids, other:true }];
    const tot = sl.reduce((a, x) => a + x.v, 0) || 1;
    let k = 0; sl.forEach(x => { x.pct = x.v / tot * 100; x.color = x.other ? "var(--donut-other)" : DONUT[k++]; });
  }
  const best = donutLayout(sl); ringColours(sl, best);
  return { sl, best };
}
function donutSvg(P, plan){
  const { sl, best } = plan; if(!sl.length || !best) return "";
  const { W, H, cx, cy, R, r } = DG;
  const f = n => n.toFixed(1);
  const slices = best.slices;
  const short = t => t.length > 8 ? t.slice(0, 7) + "…" : t;
  const paths = slices.map(s => {
    let d;
    if(sl.length === 1) d = `M${f(cx)} ${f(cy - R)}A${R} ${R} 0 1 1 ${f(cx - 0.01)} ${f(cy - R)}ZM${f(cx)} ${f(cy - r)}A${r} ${r} 0 1 0 ${f(cx + 0.01)} ${f(cy - r)}Z`;
    else {
      const pt = (rad, a) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
      const [x0, y0] = pt(R, s.a0), [x1, y1] = pt(R, s.a1), [x2, y2] = pt(r, s.a1), [x3, y3] = pt(r, s.a0), large = s.a1 - s.a0 > Math.PI ? 1 : 0;
      d = `M${f(x0)} ${f(y0)}A${R} ${R} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r} ${r} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
    }
    return `<path class="ds" data-slice="${s.i}" d="${d}" fill="${s.color}" stroke="var(--bg)" stroke-width="2" stroke-linejoin="round"/>`;
  }).join("");
  const labels = slices.map(s => {
    const ex = s.side > 0 ? W - 4 : 4;
    let dot = s.dot, line;
    if(dot) line = `M${f(dot[0])} ${f(s.y)}H${ex}`;
    else { // no room at that height: a short step, then the same straight line
      const m = (r + R) / 2; dot = [cx + m * Math.sin(s.mid), cy - m * Math.cos(s.mid)];
      const bx = cx + s.side * (R + 10);
      line = Math.abs(dot[1] - s.y) < 1 ? `M${f(dot[0])} ${f(s.y)}H${ex}` : `M${f(dot[0])} ${f(dot[1])}L${f(bx)} ${f(s.y)}H${ex}`;
    }
    return `<g class="dl" data-slice="${s.i}"><path d="${line}" fill="none" stroke="var(--ink-2)" stroke-width="1"/>
      <circle cx="${f(dot[0])}" cy="${f(dot[1])}" r="2.6" fill="var(--ink)"/>
      <text x="${ex}" y="${f(s.y - 6)}" text-anchor="${s.side > 0 ? "end" : "start"}" class="dn">${esc(short(s.name))}<tspan class="dp" dx="6">${s.pct.toFixed(1)}%</tspan></text></g>`;
  }).join("");
  const summary = sl.map(x => `${x.name} ${x.pct.toFixed(1)}%`).join(", ");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="종목 비중: ${esc(summary)}">
    ${paths}${labels}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="dc1" id="dcTop">보유 ${P.rows.length}종목</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="dc2" id="dcBig">${esc(S.hideAmt ? "••••원" : fmtShort(P.value) + "원")}</text>
  </svg>`;
}
function bindDonut(root){
  const box = root && root.querySelector("#stDonut"); if(!box) return;
  const svg = box.querySelector("svg"), P = portfolio(), sl = donutPlan(P).sl;
  const top = svg.querySelector("#dcTop"), big = svg.querySelector("#dcBig");
  const reset = () => { svg.classList.remove("hl"); svg.querySelectorAll(".on").forEach(e => e.classList.remove("on"));
    top.textContent = `보유 ${P.rows.length}종목`; big.textContent = S.hideAmt ? "••••원" : fmtShort(P.value) + "원"; };
  const show = i => { const x = sl[i]; if(!x) return; reset(); svg.classList.add("hl");
    svg.querySelectorAll(`[data-slice="${i}"]`).forEach(e => e.classList.add("on"));
    top.textContent = x.name.length > 8 ? x.name.slice(0, 7) + "…" : x.name; big.textContent = x.pct.toFixed(1) + "%"; };
  svg.querySelectorAll("[data-slice]").forEach(e => {
    e.addEventListener("pointerenter", () => show(+e.dataset.slice));
    e.addEventListener("pointerdown", () => show(+e.dataset.slice));
  });
  svg.addEventListener("pointerleave", reset);
}

/* ---------- stocks: main view ---------- */
function stocksHtml(){
  const tabs = [["hold","내 주식"],["watch","관심"],["div","배당"]];
  const body = S.stockTab === "watch" ? watchHtml() : S.stockTab === "div" ? divHtml() : holdHtml();
  return `<div class="st-wrap">
    ${marketHtml()}
    <div class="st-tabs" role="tablist">${tabs.map(([key, l]) => `<button type="button" role="tab" data-sttab="${key}" aria-selected="${S.stockTab === key}">${l}</button>`).join("")}</div>
    ${body}
    <p class="st-source">시세·차트: Yahoo Finance (지연될 수 있어요) · 한국 종목 정보: aikstockdata.com (금융위원회 공공데이터). 투자 판단의 근거가 아니라 기록용이에요.</p>
  </div>`;
}
function holdRowHtml(s, p){
  const krwOk = s.currency !== "USD" || fxRate();
  let right;
  if(S.holdShow === "price"){
    const q = p.q;
    right = `<b>${q ? fmtMoney(q.price, s.currency) : "-"}</b><small>${q && wonOf(q.price, s.currency) ? `<span class="st-won">${wonOf(q.price, s.currency)}</span> ` : ""}<span class="${tone(q && q.changePct)}">${q ? fmtPct(q.changePct, 1) : "시세 없음"}</span></small>`;
  }else{
    const val = krwOk ? my(p.valueKRW, "KRW") : my(p.value != null ? p.value : p.cost, s.currency);
    const pl = p.pl == null ? "시세 없음" : `${krwOk ? my(p.plKRW, "KRW", true) : my(p.pl, s.currency, true)} (${fmtPct(p.plPct, 1)})`;
    const usd = s.currency === "USD" && krwOk ? `<small class="st-won">${my(p.value != null ? p.value : p.cost, "USD")}</small>` : "";
    right = `<b>${val}</b>${usd}<small class="${tone(p.pl)}">${pl}</small>`;
  }
  return `<button type="button" class="st-row" data-stock="${esc(s.id)}">${avaHtml(s)}
    <span class="st-main"><b>${esc(s.name)}${s.broker === "toss" ? `<span class="st-toss" title="토스증권에서 자동으로 맞춰요">토스</span>` : ""}</b><small>${S.hideAmt ? "" : fmtQty(p.qty) + "주 · "}평균 ${fmtMoney(p.avg, s.currency)}</small></span>
    <span class="st-right">${right}</span></button>`;
}
function holdHtml(){
  const P = portfolio();
  const label = `<div class="st-label">내 주식 평가금액 <span class="st-tools">${eyeBtn()}${refreshBtn()}</span></div>`;
  if(!P.rows.length && !S.stocks.some(s => s.hidden && +s.qty > 0)){
    return `<section class="st-hero">${label}<div class="st-big">${my(0, "KRW")}</div></section>
      <div class="empty"><h3>보유 종목을 추가해 보세요</h3><p>종목을 검색해서 수량과 평균 단가를 넣으면 평가금액과 수익률을 자동으로 계산해요.</p><button class="btn primary" type="button" data-act="stAdd">+ 종목 추가</button></div>`;
  }
  const hero = `<section class="st-hero">${label}
    <div class="st-big">${my(P.value, "KRW")}</div>
    <div class="st-chg ${tone(P.pl)}">${S.hideAmt ? "수익률 " : my(P.pl, "KRW", true) + " "}(${fmtPct(P.plPct)})</div>
    <dl class="st-facts">
      <div><dt>어제보다</dt><dd class="${tone(P.day)}">${my(P.day, "KRW", true)}</dd></div>
      <div><dt>투자 원금</dt><dd>${my(P.cost, "KRW")}</dd></div>
      ${P.hasUS ? `<div><dt>달러 환율</dt><dd>${fxRate() ? fxRate().toLocaleString("ko-KR", { maximumFractionDigits:2 }) + "원" : "-"}</dd></div>` : ""}
    </dl>
    ${P.missing ? `<p class="st-warn">시세를 못 불러온 종목 ${P.missing}개는 평균 단가로 계산했어요.</p>` : ""}
    ${brokerStatusLine()}
    ${P.hasUS ? `<p class="st-warn">미국 주식은 지금 환율로 원화 환산해요.</p>` : ""}
  </section>`;
  const sorters = {
    value: (a, b) => (b.p.valueKRW || 0) - (a.p.valueKRW || 0),
    pl: (a, b) => (num(b.p.plPct) ? b.p.plPct : -1e9) - (num(a.p.plPct) ? a.p.plPct : -1e9),
    name: (a, b) => a.s.name.localeCompare(b.s.name, "ko")
  };
  const rows = P.rows.slice().sort(sorters[S.holdSort] || sorters.value);
  const ctrl = `<div class="st-ctrl">
    <select class="sel" id="holdSort" aria-label="정렬">${[["value","평가금순"],["pl","수익률순"],["name","이름순"]].map(([v, l]) => `<option value="${v}" ${S.holdSort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    <div class="seg" role="group" aria-label="보기">${[["value","평가금"],["price","현재가"]].map(([v, l]) => `<button type="button" data-holdshow="${v}" aria-pressed="${S.holdShow === v}">${l}</button>`).join("")}</div>
  </div>`;
  const groups = [["KR","국내 주식"],["US","해외 주식"]].map(([m, l]) => [m, l, rows.filter(r => r.s.market === m)]).filter(g => g[2].length);
  const body = groups.length > 1
    ? groups.map(([m, l, gr]) => `<div class="st-group"><span>${l} ${gr.length}</span><span>${my(gr.reduce((a, r) => a + (r.p.valueKRW || 0), 0), "KRW")}</span></div>${gr.map(r => holdRowHtml(r.s, r.p)).join("")}`).join("")
    : rows.map(r => holdRowHtml(r.s, r.p)).join("");
  const hid = S.stocks.filter(s => s.hidden && +s.qty > 0);
  const hidHtml = hid.length ? `<button type="button" class="st-hidden-tg" data-act="showHidden" aria-expanded="${S.showHidden}">숨긴 종목 ${hid.length}개 · ${S.showHidden ? "접기" : "보기"}<small>합계와 비중에서 빠져 있어요</small></button>
    ${S.showHidden ? `<div class="st-list st-dim">${hid.map(s => holdRowHtml(s, position(s))).join("")}</div>` : ""}` : "";
  const list = `<section class="st-sec">
    <div class="st-sec-h"><h3>보유 종목<span>${P.rows.length}</span></h3><button class="btn small" type="button" data-act="stAdd">+ 종목 추가</button></div>
    ${ctrl}<div class="st-list">${body}</div>${hidHtml}</section>`;
  const plan = P.rows.length > 1 && P.value > 0 ? donutPlan(P) : { sl:[], best:null }, sl = plan.sl;
  const colorOf = id => (sl.find(x => x.ids.includes(id)) || {}).color || "var(--donut-other)";
  const alloc = P.rows.length > 1 && P.value > 0 ? `<section class="st-sec">
    <div class="st-sec-h"><h3>종목 비중</h3></div>
    <div class="st-allocwrap">
      <div class="st-alloc">${P.rows.map(({ s, p }) => { const pct = (p.valueKRW || 0) / P.value * 100;
        return `<div class="st-al"><span class="nm"><i style="background:${colorOf(s.id)}"></i>${esc(s.name)}</span><span class="tr"><span class="fl" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></span></span><span class="pc">${pct.toFixed(1)}%</span></div>`; }).join("")}</div>
      <div class="st-donut" id="stDonut">${donutSvg(P, plan)}</div>
    </div>
  </section>` : "";
  return hero + list + alloc;
}
function targetInfo(s){
  const q = quoteOf(s);
  if(!num(s.target)) return "";
  if(!q || !num(q.price)) return `목표가 ${fmtMoney(s.target, s.currency)}`;
  const gap = (s.target - q.price) / q.price * 100;
  return gap <= 0 ? `목표가 ${fmtMoney(s.target, s.currency)} 도달` : `목표가 ${fmtMoney(s.target, s.currency)}${wonOf(s.target, s.currency) ? ` (${wonOf(s.target, s.currency)})` : ""} · ${gap.toFixed(1)}% 남음`;
}
function watchHtml(){
  const list = S.stocks.filter(s => s.watch && !s.hidden).sort((a, b) => (a.sort - b.sort) || (a.createdAt - b.createdAt));
  const head = `<div class="st-sec-h"><h3>관심 종목${list.length ? `<span>${list.length}</span>` : ""}</h3><span class="st-tools">${refreshBtn()}<button class="btn small" type="button" data-act="stAdd">+ 종목 추가</button></span></div>`;
  if(!list.length){
    return `<section class="st-sec st-sec-first">${head}</section><div class="empty"><h3>관심 종목을 모아 보세요</h3><p>지켜보는 종목을 추가하면 현재가와 오늘 등락, 목표가까지 남은 거리를 한눈에 볼 수 있어요.</p><button class="btn primary" type="button" data-act="stAdd">+ 종목 추가</button></div>`;
  }
  return `<section class="st-sec st-sec-first">
    ${head}
    <div class="st-list">${list.map(s => {
      const q = quoteOf(s);
      const sub = targetInfo(s) || (s.memo ? s.memo.split("\n")[0] : `${codeOf(s.symbol)} · ${exchLabel(s)}`);
      return `<button type="button" class="st-row" data-stock="${esc(s.id)}">${avaHtml(s)}
        <span class="st-main"><b>${esc(s.name)}</b><small>${esc(sub)}</small></span>
        <span class="st-right"><b>${q ? fmtMoney(q.price, s.currency) : "-"}</b><small>${q && wonOf(q.price, s.currency) ? `<span class="st-won">${wonOf(q.price, s.currency)}</span> ` : ""}<span class="${tone(q && q.changePct)}">${q ? fmtPct(q.changePct, 1) : "시세 없음"}</span></small></span></button>`;
    }).join("")}</div></section>`;
}
function divHtml(){
  const y = S.divYear, nowY = new Date().getFullYear();
  const years = S.divs.map(d => +String(d.date).slice(0, 4)).filter(Boolean);
  const minY = Math.min(nowY, ...years);
  const sum = list => list.reduce((a, d) => a + (divKRW(d) || 0), 0);
  const inYear = S.divs.filter(d => String(d.date).startsWith(String(y)));
  const months = Array.from({ length:12 }, (_, i) => sum(inYear.filter(d => +String(d.date).slice(5, 7) === i + 1)));
  const total = sum(inYear), last = sum(S.divs.filter(d => String(d.date).startsWith(String(y - 1)))), all = sum(S.divs);
  const monthsElapsed = y === nowY ? new Date().getMonth() + 1 : 12;
  const usdMissing = S.divs.some(d => d.currency === "USD" && !num(d.krw)) && !fxRate();
  const hero = `<section class="st-hero">
    <div class="st-label">${y}년 받은 배당금
      <span class="st-tools">${eyeBtn()}</span><span class="st-year"><button type="button" class="icon-btn sm" data-divyear="-1" aria-label="이전 해" ${y <= minY ? "disabled" : ""}>‹</button><button type="button" class="icon-btn sm" data-divyear="1" aria-label="다음 해" ${y >= nowY ? "disabled" : ""}>›</button></span></div>
    <div class="st-big">${my(total, "KRW")}</div>
    <dl class="st-facts">
      <div><dt>${y - 1}년</dt><dd>${my(last, "KRW")}</dd></div>
      <div><dt>월평균</dt><dd>${my(total / monthsElapsed, "KRW")}</dd></div>
      <div><dt>누적</dt><dd>${my(all, "KRW")}</dd></div>
    </dl>
    ${usdMissing ? `<p class="st-warn">달러 배당 일부는 환율을 불러오면 원화로 합산돼요.</p>` : ""}
  </section>`;
  const chart = `<section class="st-sec"><div class="st-sec-h"><h3>월별 배당</h3><button class="btn small" type="button" data-act="divAdd">+ 배당 기록</button></div>
    <div class="st-chart" data-tipwrap>${divChartSvg(months, y)}<div class="st-tip" hidden></div></div></section>`;
  const rows = inYear.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt - a.createdAt));
  let listHtml = "";
  if(!S.divs.length){
    listHtml = `<div class="empty"><h3>받은 배당금을 기록해 보세요</h3><p>배당이 들어올 때마다 적어 두면 월별·연도별로 얼마나 받았는지 모아서 보여 줘요.</p><button class="btn primary" type="button" data-act="divAdd">+ 배당 기록</button></div>`;
  }else if(!rows.length){
    listHtml = `<p class="st-warn" style="margin:12px 0 0">${y}년에는 기록한 배당이 없어요.</p>`;
  }else{
    let cur = 0;
    for(const d of rows){
      const m = +String(d.date).slice(5, 7);
      if(m !== cur){ cur = m; listHtml += `<div class="st-month"><span>${m}월</span><span>${my(months[m - 1], "KRW")}</span></div>`; }
      const s = S.stocks.find(x => x.id === d.stockId) || { symbol:d.symbol || d.name, name:d.name || "배당", market:d.currency === "USD" ? "US" : "KR" };
      listHtml += `<button type="button" class="st-row" data-div="${esc(d.id)}">${avaHtml(s, "sm")}
        <span class="st-main"><b>${esc(d.name || s.name)}</b><small>${String(d.date).slice(5).replace("-", ".")}${d.memo ? " · " + esc(d.memo) : ""}</small></span>
        <span class="st-right"><b>${num(divKRW(d)) ? my(divKRW(d), "KRW") : my(d.amount, d.currency)}</b>${d.currency === "USD" ? `<small class="flat">${my(d.amount, "USD")}</small>` : ""}</span></button>`;
    }
    listHtml = `<div class="st-list">${listHtml}</div>`;
  }
  return hero + chart + `<section class="st-sec"><div class="st-sec-h"><h3>배당 내역</h3></div>${listHtml}</section>`;
}
function barPath(x, y, w, h, r){
  r = Math.min(r, h, w / 2);
  return `M${x.toFixed(1)} ${(y + h).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + r).toFixed(1)} ${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)} ${y.toFixed(1)} ${(x + w).toFixed(1)} ${(y + r).toFixed(1)}V${(y + h).toFixed(1)}Z`;
}
function divChartSvg(months, y){
  const W = Math.max(280, Math.min(720, (document.getElementById("main") || {}).clientWidth || 600)), H = 190, T = 24, B = 26, bw = W / 12, mx = Math.max(...months, 1);
  const nowM = new Date().getFullYear() === y ? new Date().getMonth() : -1;
  let marks = "", hits = "";
  months.forEach((v, i) => {
    const h = v > 0 ? Math.max(3, (H - T - B) * v / mx) : 0, w = bw * 0.56, x = i * bw + (bw - w) / 2, yy = H - B - h;
    const tip = `${y}년 ${i + 1}월 · ${my(v, "KRW")}`;
    if(v > 0) marks += `<path d="${barPath(x, yy, w, h, 4)}" fill="var(--accent)"/>${S.hideAmt ? "" : `<text x="${(x + w / 2).toFixed(1)}" y="${(yy - 6).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--ink-2)">${fmtShort(v)}</text>`}`;
    marks += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle" font-size="11" fill="${i === nowM ? "var(--ink)" : "var(--ink-3)"}"${i === nowM ? ' font-weight="600"' : ""}>${i + 1}월</text>`;
    hits += `<rect x="${(i * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${H - T - B}" fill="transparent" data-tip="${esc(tip)}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${y}년 월별 배당금"><line x1="0" x2="${W}" y1="${H - B}" y2="${H - B}" stroke="var(--line-2)"/>${marks}${hits}</svg>`;
}
// shared hover tooltip for any [data-tip] mark inside [data-tipwrap]
function bindTips(root){
  root.querySelectorAll("[data-tipwrap]").forEach(wrap => {
    const tip = wrap.querySelector(".st-tip"); if(!tip) return;
    const show = ev => {
      const t = ev.target.closest && ev.target.closest("[data-tip]");
      if(!t){ tip.hidden = true; return; }
      const wr = wrap.getBoundingClientRect(), r = t.getBoundingClientRect();
      tip.textContent = t.dataset.tip; tip.hidden = false;
      const half = tip.offsetWidth / 2, cx = r.left - wr.left + r.width / 2;
      tip.style.left = Math.max(half, Math.min(wr.width - half, cx)) + "px";
      tip.style.top = Math.max(18, (r.top - wr.top) + r.height * 0.35) + "px";
    };
    wrap.addEventListener("pointermove", show);
    wrap.addEventListener("pointerdown", show);
    wrap.addEventListener("pointerleave", () => { tip.hidden = true; });
  });
}

/* ---------- stocks: detail ---------- */
let CH = null; // geometry of the price chart on screen
const RANGES = [["1d","1일"],["5d","1주"],["1mo","1달"],["3mo","3달"],["1y","1년"],["5y","5년"]];
function openStock(id){
  if(!S.stocks.find(s => s.id === id)) return;
  if(OV) endOvKeepHistory();
  OV = { kind:"stock", id, range:"1d", confirm:false };
  renderStockDetail(); loadHistory();
}
function stockParts(s){
  const p = position(s), q = p.q, cur = s.currency;
  const price = `<div class="st-big">${q ? fmtMoney(q.price, cur) : "-"}</div>
    ${q && wonOf(q.price, cur) ? `<div class="st-big2">${wonOf(q.price, cur)}</div>` : ""}
    <div class="st-chg ${tone(q && q.change)}"><span class="st-muted0">어제보다</span> ${q && num(q.change) ? `${fmtMoney(q.change, cur, true)}${wonOf(q.change, cur) ? ` · ${wonOf(q.change, cur, true)}` : ""} (${fmtPct(q.changePct)})` : "시세 없음"}</div>
    <p class="st-note">${quoteLine(q, s)}${cur === "USD" && fxRate() ? ` · 원화는 지금 환율 ${fxRate().toLocaleString("ko-KR", { maximumFractionDigits:2 })}원으로 계산해요.` : ""}</p>`;
  const krw = (v, sign) => cur === "USD" && num(toKRW(v, cur)) ? `<small>${my(toKRW(v, cur), "KRW", sign)}</small>` : "";
  const pos = p.qty > 0 ? `<h4 class="st-h4">내 주식${s.broker === "toss" ? `<span class="st-toss" title="토스증권에서 자동으로 맞춰요">토스</span>` : ""}</h4><dl class="st-grid">
      <div><dt>보유 수량</dt><dd>${S.hideAmt ? "••" : fmtQty(p.qty)}주</dd></div>
      <div><dt>1주 평균금액</dt><dd>${fmtMoney(p.avg, cur)}${cur === "USD" && wonOf(p.avg, cur) ? `<small>${wonOf(p.avg, cur)}</small>` : ""}</dd></div>
      <div><dt>총 금액</dt><dd>${my(p.value != null ? p.value : p.cost, cur)}${krw(p.value != null ? p.value : p.cost)}</dd></div>
      <div><dt>투자 원금</dt><dd>${my(p.cost, cur)}${krw(p.cost)}</dd></div>
      <div><dt>총 수익</dt><dd class="${tone(p.pl)}">${p.pl != null ? my(p.pl, cur, true) : "-"}${p.pl != null ? krw(p.pl, true) : ""}<small class="${tone(p.pl)}">${fmtPct(p.plPct)}</small></dd></div>
      <div><dt>어제보다</dt><dd class="${tone(p.day)}">${p.day != null ? my(p.day, cur, true) : "-"}${p.day != null ? krw(p.day, true) : ""}<small class="${tone(p.day)}">${p.q && num(p.q.changePct) ? fmtPct(p.q.changePct) : ""}</small></dd></div>
    </dl>` : "";
  const target = num(s.target) ? `<div class="st-target"><span>목표가</span><b>${fmtMoney(s.target, cur)}</b>${wonOf(s.target, cur) ? `<span>${wonOf(s.target, cur)}</span>` : ""}${q && num(q.price) ? `<small>${s.target > q.price ? `지금보다 ${fmtPct((s.target - q.price) / q.price * 100, 1)}` : "도달했어요"}</small>` : ""}</div>` : "";
  const notes = `<h4 class="st-h4">노트<span class="st-muted">${(s.notes || []).length || ""}</span></h4>
    ${(s.notes || []).length ? `<ul class="st-notes">${s.notes.map(n => `<li><time>${esc(String(n.date || "").replace(/-/g, "."))}</time><p>${linkify(n.text || "")}</p><button type="button" data-rmnote="${esc(n.id)}" aria-label="노트 지우기">×</button></li>`).join("")}</ul>` : `<p class="st-warn" style="margin:0">뉴스, 실적, 사고판 이유처럼 이 종목에 대한 생각을 날짜별로 남겨 보세요.</p>`}
    <div class="st-addnote"><textarea id="st-note" rows="2" placeholder="새 노트"></textarea><button type="button" class="btn" data-act="stNoteAdd">추가</button></div>`;
  const dl = S.divs.filter(d => d.stockId === s.id || (!d.stockId && d.symbol && d.symbol === s.symbol)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const divs = `<h4 class="st-h4">배당<span class="st-muted">${dl.length ? "누적 " + my(dl.reduce((a, d) => a + (divKRW(d) || 0), 0), "KRW") : ""}</span></h4>
    ${dl.length ? `<div class="st-list">${dl.slice(0, 6).map(d => `<button type="button" class="st-row st-row-tight" data-div="${esc(d.id)}"><span class="st-main"><b>${String(d.date).replace(/-/g, ".")}</b>${d.memo ? `<small>${esc(d.memo)}</small>` : ""}</span><span class="st-right"><b>${num(divKRW(d)) ? my(divKRW(d), "KRW") : my(d.amount, d.currency)}</b>${d.currency === "USD" ? `<small class="flat">${my(d.amount, "USD")}</small>` : ""}</span></button>`).join("")}</div>` : `<p class="st-warn" style="margin:0">받은 배당이 아직 없어요. 아래 ‘배당 기록’으로 남길 수 있어요.</p>`}`;
  return { price, pos, target, notes, divs };
}
function renderStockDetail(){
  const s = S.stocks.find(x => x.id === OV.id); if(!s){ closeOv(); return; }
  const parts = stockParts(s);
  const key = s.symbol + "|" + OV.range;
  showOv(`<div class="sheetbox st-sheet" role="dialog" aria-modal="true" aria-label="${esc(s.name)}">
    <div class="sb-head"><span class="ttl">${esc(codeOf(s.symbol))} · ${exchLabel(s)}</span>
      <div class="sp"><button class="btn small" type="button" data-act="stEdit">편집</button><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body">
      <div class="st-dhead">${avaHtml(s, "lg")}<div style="min-width:0"><h2 class="st-dname">${esc(s.name)}</h2><div class="st-dsym">${esc(s.symbol)}${s.watch ? " · 관심" : ""}${s.hidden ? " · 숨김" : ""}</div></div></div>
      <div id="stp-price">${parts.price}</div>
      <div class="st-chartbox">
        <div class="st-chart" id="stChart">${chartHtml(S.hist[key], s)}</div>
        <div class="seg st-ranges" role="group" aria-label="기간">${RANGES.map(([r, l]) => `<button type="button" data-strange="${r}" aria-pressed="${OV.range === r}">${l}</button>`).join("")}</div>
      </div>
      <div id="stp-pos">${parts.pos}</div>
      <div id="stp-target">${parts.target}</div>
      ${s.memo ? `<div class="dt-body st-memo">${linkify(s.memo)}</div>` : ""}
      <div id="stp-notes">${parts.notes}</div>
      <div id="stp-divs">${parts.divs}</div>
    </div>
    <div class="sb-foot st-actions" id="stFoot">${stockFootHtml(s)}</div>
  </div>`);
  bindChart();
}
const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.1C1.4 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.5 0 5.7 3.5 4.4 6.9-1.8 4.5-9.3 9.1-9.3 9.1z"/></svg>`;
function stockFootHtml(s){
  if(OV.confirm === "unwatch") return `<div class="confirm">보유 수량이 없어서 관심에서 빼면 목록에서 지워져요. 노트도 함께 지워져요. <button class="btn small danger" type="button" data-act="stDelYes">빼기</button><button class="btn small" type="button" data-act="stDelNo">취소</button></div>`;
  return `<button type="button" class="st-heart" data-act="stWatch" aria-pressed="${!!s.watch}" aria-label="${s.watch ? "관심 종목에서 빼기" : "관심 종목에 추가"}">${HEART}</button>
    <button class="btn" type="button" data-act="divAdd" data-for="${esc(s.id)}">배당 기록</button>
    <button class="btn primary" type="button" data-act="stEdit">${s.broker === "toss" ? "메모·목표가 수정" : s.qty > 0 ? "수량·단가 수정" : "보유 수량 입력"}</button>`;
}
function toggleWatch(){
  const s = S.stocks.find(x => x.id === OV.id); if(!s) return;
  if(s.watch && !(+s.qty > 0)){ setStockConfirm("unwatch"); return; }
  putStock({ ...s, watch:!s.watch, updatedAt:Date.now() });
  setStockConfirm(false); updateStockDetail();
  const head = document.querySelector(".st-dsym"); if(head) head.textContent = s.symbol + (!s.watch ? " · 관심" : "");
  toast(!s.watch ? "관심 종목에 추가했어요." : "관심 종목에서 뺐어요.");
}

function setStockConfirm(v){
  OV.confirm = v;
  const s = S.stocks.find(x => x.id === OV.id), f = $("#stFoot");
  if(s && f) f.innerHTML = stockFootHtml(s);
}
function setRange(r){
  OV.range = r;
  const s = ovSubject(); if(!s) return;
  document.querySelectorAll("[data-strange]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.strange === r)));
  const el = $("#stChart"); if(el){ el.innerHTML = chartHtml(S.hist[s.symbol + "|" + r], s); bindChart(); }
  loadHistory();
}
function updateStockDetail(){
  if(!OV || OV.kind !== "stock") return;
  const s = S.stocks.find(x => x.id === OV.id); if(!s){ closeOv(); return; }
  const parts = stockParts(s);
  const draft = ($("#st-note") || {}).value || "";
  for(const [key, html] of Object.entries(parts)){ const el = document.getElementById("stp-" + key); if(el) el.innerHTML = html; }
  const ta = $("#st-note"); if(ta && draft) ta.value = draft;
}
async function loadHistory(){
  const s = ovSubject(); if(!s) return;
  const key = s.symbol + "|" + OV.range, h = S.hist[key];
  if(h && !h.err && Date.now() - h.at < (OV.range === "1d" || OV.range === "5d" ? 60e3 : 10 * 60e3)) return;
  try{
    if(!navigator.onLine) throw new TypeError("Failed to fetch");
    const d = await S.B.invoke({ action:"history", symbol:s.symbol, range:OV.range });
    const k = s.scale || 1;
    S.hist[key] = { at:Date.now(), points:(d.points || []).map(([t, v]) => [t, v * k]), prevClose:num(d.prevClose) ? d.prevClose * k : null };
  }catch(e){
    S.hist[key] = { at:Date.now(), err: isNetErr(e) ? "인터넷에 연결되면 차트를 볼 수 있어요." : "차트를 불러오지 못했어요." };
  }
  const now = ovSubject();
  if(now && now.symbol === s.symbol && s.symbol + "|" + OV.range === key){
    const el = $("#stChart"); if(el){ el.innerHTML = chartHtml(S.hist[key], s); bindChart(); }
  }
}
function chartHtml(h, s){
  CH = null;
  if(!h) return `<div class="st-chart-msg">차트를 불러오는 중…</div>`;
  if(h.err) return `<div class="st-chart-msg">${esc(h.err)}</div>`;
  const pts = h.points || [];
  if(pts.length < 2) return `<div class="st-chart-msg">차트 데이터가 없어요.</div>`;
  const vw = window.innerWidth || 600, narrow = vw <= 560;
  const W = Math.max(280, Math.round(Math.min(680, vw - (narrow ? 16 : 32)) - (narrow ? 34 : 46)));
  const H = narrow ? 200 : 220, T = 26, B = 26, L = 6, R = 6, cur = s.currency;
  const range = OV.range, intraday = range === "1d" || range === "5d";
  const vals = pts.map(p => p[1]);
  const base = range === "1d" && num(h.prevClose) ? h.prevClose : vals[0];
  let mn = Math.min(...vals, base), mx = Math.max(...vals, base);
  if(mn === mx){ mn *= 0.99; mx *= 1.01; }
  const X = i => L + i * (W - L - R) / (pts.length - 1);
  const Y = v => T + (mx - v) / (mx - mn) * (H - T - B);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join("");
  const first = base, last = vals[vals.length - 1], up = last >= first, col = up ? "var(--up)" : "var(--down)";
  const imx = vals.indexOf(Math.max(...vals)), imn = vals.indexOf(Math.min(...vals));
  const fd = t => { const x = new Date(t); return range === "1d" ? `${pad(x.getHours())}:${pad(x.getMinutes())}` : range === "5d" ? `${x.getMonth() + 1}/${x.getDate()} ${pad(x.getHours())}:${pad(x.getMinutes())}` : `${x.getFullYear()}.${pad(x.getMonth() + 1)}.${pad(x.getDate())}`; };
  const lab = (i, txt, below) => {
    const x = X(i), y = Y(vals[i]);
    const anchor = x < 80 ? "start" : x > W - 80 ? "end" : "middle";
    const ty = below ? Math.min(y + 16, H - B - 4) : Math.max(y - 8, 12);
    return `<text x="${x.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" font-size="11.5" fill="var(--ink-2)">${txt}</text>`;
  };
  const rl = { "1d":"1일", "5d":"1주", "1mo":"1달", "3mo":"3달", "1y":"1년", "5y":"5년" }[range] || "";
  CH = { pts, X, Y, W, H, T, B, L, R, cur, fd };
  return `${range === "1d"
      ? `<div class="st-period"><span class="st-muted">점선은 어제 종가 ${fmtMoney(base, cur)}</span></div>`
      : `<div class="st-period ${up ? "up" : "down"}"><span class="st-muted">${rl} 전보다</span> ${fmtMoney(last - first, cur, true)} (${fmtPct((last - first) / first * 100)})</div>`}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.name)} ${rl} 주가">
      <defs><linearGradient id="stGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".18"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <line x1="${L}" x2="${W - R}" y1="${Y(first).toFixed(1)}" y2="${Y(first).toFixed(1)}" stroke="var(--line-2)" stroke-dasharray="3 4"/>
      <path d="${d}L${X(pts.length - 1).toFixed(1)} ${H - B}L${X(0).toFixed(1)} ${H - B}Z" fill="url(#stGrad)"/>
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${lab(imx, "최고 " + fmtMoney(vals[imx], cur), false)}${imn !== imx ? lab(imn, "최저 " + fmtMoney(vals[imn], cur), true) : ""}
      <text x="${L}" y="${H - 6}" font-size="11" fill="var(--ink-3)">${fd(pts[0][0])}</text>
      <text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--ink-3)">${fd(pts[pts.length - 1][0])}</text>
      <g class="st-cross" visibility="hidden"><line y1="${T - 8}" y2="${H - B}" stroke="var(--ink-3)" stroke-width="1"/><circle r="5" fill="${col}" stroke="var(--surface)" stroke-width="2"/></g>
      <rect class="st-hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    </svg><div class="st-tip" hidden></div>`;
}
function bindChart(){
  const box = $("#stChart"); if(!box || !CH) return;
  const svg = box.querySelector("svg"), tip = box.querySelector(".st-tip"), g = svg && svg.querySelector(".st-cross");
  if(!svg || !g) return;
  const geo = CH;
  const move = ev => {
    const r = svg.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * geo.W;
    let i = Math.round((x - geo.L) / (geo.W - geo.L - geo.R) * (geo.pts.length - 1));
    i = Math.max(0, Math.min(geo.pts.length - 1, i));
    const px = geo.X(i), py = geo.Y(geo.pts[i][1]);
    g.setAttribute("visibility", "visible");
    const ln = g.querySelector("line"); ln.setAttribute("x1", px); ln.setAttribute("x2", px);
    const c = g.querySelector("circle"); c.setAttribute("cx", px); c.setAttribute("cy", py);
    tip.textContent = `${geo.fd(geo.pts[i][0])} · ${fmtMoney(geo.pts[i][1], geo.cur)}${wonOf(geo.pts[i][1], geo.cur) ? ` (${wonOf(geo.pts[i][1], geo.cur)})` : ""}`; tip.hidden = false;
    const br = box.getBoundingClientRect(), half = tip.offsetWidth / 2;
    const left = r.left - br.left + px / geo.W * r.width;
    tip.style.left = Math.max(half, Math.min(br.width - half, left)) + "px";
    tip.style.top = (r.top - br.top + geo.T / geo.H * r.height) + "px";
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", () => { g.setAttribute("visibility", "hidden"); tip.hidden = true; });
}
function putStock(rec){
  const i = S.stocks.findIndex(x => x.id === rec.id);
  if(i >= 0) S.stocks[i] = rec; else S.stocks.push(rec);
  saveStocks(); enqueue({ op:"row", table:"stocks", rec });
}
function putDiv(rec){
  const i = S.divs.findIndex(x => x.id === rec.id);
  if(i >= 0) S.divs[i] = rec; else S.divs.push(rec);
  saveDivs(); enqueue({ op:"row", table:"dividends", rec });
}
function addNote(){
  const s = S.stocks.find(x => x.id === OV.id); const ta = $("#st-note");
  const text = (ta && ta.value || "").trim(); if(!s || !text) return;
  const rec = { ...s, notes:[{ id:uuid(), date:today(), text }, ...(s.notes || [])], updatedAt:Date.now() };
  ta.value = ""; putStock(rec); updateStockDetail(); toast("노트를 남겼어요.");
}
function removeNote(nid){
  const s = S.stocks.find(x => x.id === OV.id); if(!s) return;
  putStock({ ...s, notes:(s.notes || []).filter(n => n.id !== nid), updatedAt:Date.now() }); updateStockDetail();
}
function deleteStock(){
  const s = S.stocks.find(x => x.id === OV.id); if(!s) return;
  S.stocks = S.stocks.filter(x => x.id !== s.id); saveStocks();
  let touched = false;
  S.divs = S.divs.map(d => d.stockId === s.id ? (touched = true, { ...d, stockId:null, symbol:d.symbol || s.symbol, name:d.name || s.name }) : d);
  if(touched) saveDivs();
  closeOv(); render(); toast(`${s.name}을(를) 지웠어요.`);
  enqueue({ op:"rowdel", table:"stocks", id:s.id });
}

/* ---------- stocks: search & form ---------- */
function openStockSearch(){
  if(OV) endOvKeepHistory();
  OV = { kind:"stsearch", q:"", results:null, loading:false, err:"" };
  showOv(`<div class="sheetbox" role="dialog" aria-modal="true" aria-label="종목 추가">
    <div class="sb-head"><span class="ttl">종목 추가</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body">
      <div class="search st-search"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="st-q" type="search" placeholder="종목 이름, 코드, 티커" autocomplete="off" enterkeyhint="search"></div>
      <div id="stResults" class="st-results">${searchResultsHtml()}</div>
    </div></div>`);
  setTimeout(() => { const i = $("#st-q"); if(i) i.focus(); }, 40);
}
function searchResultsHtml(){
  const o = OV;
  if(!o.q.trim()) return `<p class="st-hint">한국 주식은 <b>한글 이름</b>이나 <b>6자리 코드</b>, 미국 주식은 <b>영문 이름</b>이나 <b>티커</b>로 찾아요.<br>예: 삼성전자 · 005930 · Apple · AAPL · QQQ</p>`;
  if(o.loading && !o.results) return `<p class="st-hint">찾는 중…</p>`;
  if(o.err) return `<p class="st-hint">${esc(o.err)}</p>`;
  if(!o.results || !o.results.length) return `<p class="st-hint">‘${esc(o.q)}’ 검색 결과가 없어요. 미국 주식은 영문으로 검색해 보세요.</p>`;
  return `<div class="st-list">${o.results.map((r, i) => {
    const have = S.stocks.find(s => s.symbol === r.symbol);
    return `<button type="button" class="st-row" data-stpick="${i}">${avaHtml(r)}
      <span class="st-main"><b>${esc(r.name)}</b><small>${esc(codeOf(r.symbol))} · ${esc(r.exchange || (r.market === "KR" ? "한국" : "미국"))}${r.type === "ETF" ? " · ETF" : ""}</small></span>
      <span class="st-right">${have ? `<small class="st-have">${have.qty > 0 ? "보유 중" : "관심 종목"}</small>` : `<small class="st-addtxt">추가</small>`}</span></button>`;
  }).join("")}</div>`;
}
let searchT = 0;
function onStockSearchInput(v){
  OV.q = v; clearTimeout(searchT);
  if(!v.trim()){ OV.results = null; OV.err = ""; $("#stResults").innerHTML = searchResultsHtml(); return; }
  searchT = setTimeout(async () => {
    const q = v.trim();
    OV.loading = true; OV.err = "";
    if(!OV.results) $("#stResults").innerHTML = searchResultsHtml();
    try{
      if(!navigator.onLine) throw new TypeError("Failed to fetch");
      const d = await S.B.invoke({ action:"search", q });
      if(!OV || OV.kind !== "stsearch" || OV.q.trim() !== q) return;
      OV.results = d.results || [];
    }catch(e){
      if(!OV || OV.kind !== "stsearch") return;
      OV.err = isNetErr(e) ? "인터넷에 연결되면 검색할 수 있어요." : errMsg(e); OV.results = null;
    }
    OV.loading = false;
    const el = $("#stResults"); if(el) el.innerHTML = searchResultsHtml();
  }, 280);
}
function openStockForm(base, id){
  const s = id ? S.stocks.find(x => x.id === id) : null;
  const src = s || base;
  if(OV) endOvKeepHistory();
  OV = { kind:"stform", id:s ? s.id : null, err:"", d:{
    symbol:src.symbol, market:src.market, currency:src.currency || (src.market === "US" ? "USD" : "KRW"), name:src.name,
    watch: s ? s.watch : true, qty: s && s.qty ? String(s.qty) : "", avgPrice: s && s.avgPrice ? String(s.avgPrice) : "",
    target: s && num(s.target) ? String(s.target) : "", memo: s ? s.memo : "", toss: !!(s && s.broker === "toss"), hidden: !!(s && s.hidden) } };
  renderStockForm();
  if(!quoteOf(OV.d)) refreshQuotes(true, [OV.d.symbol]);
}
function stfPriceHtml(){
  const d = OV && OV.d; if(!d) return "";
  const q = S.quotes[d.symbol];
  return q ? `현재가 <b>${fmtMoney(q.price, d.currency)}</b>${wonOf(q.price, d.currency) ? ` (${wonOf(q.price, d.currency)})` : ""} <span class="${tone(q.changePct)}">${fmtPct(q.changePct)}</span>` : (navigator.onLine ? "현재가 불러오는 중…" : "오프라인이라 현재가를 못 불러왔어요.");
}
function syncStForm(){
  if(!OV || OV.kind !== "stform" || !$("#stf-name")) return;
  const d = OV.d, v = id => ($(id) || {}).value || "";
  d.name = v("#stf-name"); d.qty = v("#stf-qty"); d.avgPrice = v("#stf-avg"); d.target = v("#stf-target"); d.memo = v("#stf-memo");
  d.watch = !!($("#stf-watch") || {}).checked;
  if($("#stf-hidden")) d.hidden = $("#stf-hidden").checked;
}
function renderStockForm(){
  const d = OV.d, unit = d.currency === "USD" ? "달러" : "원";
  showOv(`<form class="sheetbox" id="stForm" role="dialog" aria-modal="true" aria-label="${OV.id ? "종목 편집" : "종목 추가"}" novalidate>
    <div class="sb-head"><span class="ttl">${OV.id ? "종목 편집" : "종목 추가"}</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body">
      <div class="st-dhead">${avaHtml(d, "lg")}<div style="min-width:0"><div class="st-dsym">${esc(codeOf(d.symbol))} · ${esc(exchLabel(d))} · ${d.currency === "USD" ? "달러" : "원화"}</div><p class="st-note" id="stfPrice" style="margin:2px 0 0">${stfPriceHtml()}</p></div></div>
      ${!OV.id ? `<button type="button" class="btn small ghost" data-act="stAdd" style="align-self:flex-start;margin-top:-8px">다른 종목 고르기</button>` : ""}
      <div class="fld"><label for="stf-name">이름</label><input id="stf-name" type="text" value="${esc(d.name)}" maxlength="60"></div>
      <label class="st-toggle" for="stf-watch"><span><b>관심 종목에 표시</b><small>관심 탭에서 현재가와 등락을 볼 수 있어요.</small></span><input id="stf-watch" type="checkbox" ${d.watch ? "checked" : ""}></label>
      ${OV.id ? `<label class="st-toggle" for="stf-hidden"><span><b>목록에서 숨기기</b><small>내 주식·관심 목록과 합계에서 빠져요.${d.toss ? " 토스 동기화가 돌아도 숨긴 채로 남아요." : ""}</small></span><input id="stf-hidden" type="checkbox" ${d.hidden ? "checked" : ""}></label>` : ""}
      <div class="frow">
        <div class="fld"><label for="stf-qty">보유 수량 (주)</label><input id="stf-qty" type="text" inputmode="decimal" value="${esc(d.qty)}" placeholder="없으면 비워 두세요" ${d.toss ? "readonly" : ""}></div>
        <div class="fld"><label for="stf-avg">평균 단가 (${unit})</label><input id="stf-avg" type="text" inputmode="decimal" value="${esc(d.avgPrice)}" placeholder="${d.currency === "USD" ? "예: 182.50" : "예: 61000"}" ${d.toss ? "readonly" : ""}></div>
        ${d.toss ? `<p class="note st-tossnote"><span class="st-toss">토스</span>수량과 평균 단가는 토스증권 계좌에서 자동으로 맞춰요.</p>` : ""}
      </div>
      <div class="fld"><label for="stf-target">목표가 (${unit}, 선택)</label><input id="stf-target" type="text" inputmode="decimal" value="${esc(d.target)}"></div>
      <div class="fld"><label for="stf-memo">메모 (선택)</label><textarea id="stf-memo" rows="3" placeholder="이 종목을 보는 이유, 매수 계획 같은 것">${esc(d.memo)}</textarea></div>
      ${OV.err ? `<p class="err" style="margin:0;color:var(--danger);font-size:13px">${esc(OV.err)}</p>` : ""}
    </div>
    <div class="sb-foot">${OV.confirm
      ? `<div class="confirm">${esc(d.name)}을(를) 지울까요? 노트도 함께 지워져요. 배당 기록은 남아요. <button class="btn small danger" type="button" data-act="stDelYes">삭제</button><button class="btn small" type="button" data-act="stDelNo">취소</button></div>`
      : `${OV.id ? `<button class="btn small ghost danger" type="button" data-act="stDel">종목 삭제</button>` : ""}<span class="hint">평균 단가는 증권사 앱의 ‘평균 단가’를 그대로 적으면 돼요.</span><button class="btn" type="button" data-act="close">취소</button><button class="btn primary" type="submit">저장</button>`}</div>
  </form>`);
}
function saveStockForm(){
  syncStForm();
  const d = OV.d;
  const qty = d.qty.trim() ? parseNum(d.qty) : 0, avg = d.avgPrice.trim() ? parseNum(d.avgPrice) : 0;
  const target = d.target.trim() ? parseNum(d.target) : null;
  const fail = m => { OV.err = m; renderStockForm(); };
  if(!d.name.trim()) return fail("이름을 적어 주세요.");
  if(qty == null || qty < 0) return fail("보유 수량은 0 이상의 숫자로 적어 주세요.");
  if(avg == null || avg < 0) return fail("평균 단가는 숫자로 적어 주세요.");
  if(qty > 0 && !avg) return fail("보유 수량이 있으면 평균 단가도 적어 주세요.");
  if(d.target.trim() && (target == null || target <= 0)) return fail("목표가는 숫자로 적어 주세요.");
  if(!d.watch && !qty && !d.toss) return fail("관심 종목에 표시하거나 보유 수량을 적어 주세요.");
  const old = OV.id ? S.stocks.find(x => x.id === OV.id) : null;
  const now = Date.now();
  const rec = { id:old ? old.id : uuid(), symbol:d.symbol, market:d.market, name:d.name.trim(), currency:d.currency, watch:d.watch,
    qty, avgPrice:qty ? avg : (avg || 0), target, memo:d.memo.trim(), notes:old ? old.notes || [] : [],
    sort:old ? old.sort : Math.max(0, ...S.stocks.map(s => s.sort || 0)) + 1, createdAt:old ? old.createdAt : now, updatedAt:now,
    broker:old ? old.broker || "" : "", brokerSyncedAt:old ? old.brokerSyncedAt || 0 : 0, hidden:!!(old && d.hidden) };
  if(old && old.broker === "toss"){ rec.qty = old.qty; rec.avgPrice = old.avgPrice; }
  putStock(rec);
  if(!old) S.stockTab = qty > 0 ? "hold" : "watch";
  render();
  OV.saved = true; endOvKeepHistory();
  OV = { kind:"stock", id:rec.id, range:"1d", confirm:false };
  renderStockDetail(); loadHistory();
  toast(old ? "저장했어요." : `${rec.name}을(를) 추가했어요.`);
}

/* ---------- stocks: dividend form ---------- */
function openDivForm(id, forStockId){
  const d0 = id ? S.divs.find(x => x.id === id) : null;
  const s0 = forStockId ? S.stocks.find(x => x.id === forStockId)
    : (S.stocks.filter(x => +x.qty > 0).sort((a, b) => (position(b).valueKRW || 0) - (position(a).valueKRW || 0))[0] || S.stocks[0] || null);
  if(OV) endOvKeepHistory();
  OV = { kind:"divform", id:d0 ? d0.id : null, confirm:false, err:"", d: d0
    ? { ...d0, amount:String(d0.amount), krw:num(d0.krw) ? String(d0.krw) : "" }
    : { stockId:s0 ? s0.id : "", symbol:s0 ? s0.symbol : "", name:s0 ? s0.name : "", date:today(), amount:"", currency:s0 ? s0.currency : "KRW", krw:"", memo:"" } };
  renderDivForm();
  if(OV.d.currency === "USD" && !fxRate()) refreshQuotes(true, []);
}
function dvKrwHint(){
  const d = OV && OV.d; if(!d) return "";
  const a = parseNum(d.amount);
  return fxRate() ? `비워 두면 지금 환율(${fxRate().toLocaleString("ko-KR", { maximumFractionDigits:2 })}원)로 계산해요${num(a) ? ` · 약 ${fmtMoney(a * fxRate(), "KRW")}` : ""}.` : "환율을 불러오지 못했어요. 원화 금액을 직접 적어 주세요.";
}
function syncDivForm(){
  if(!OV || OV.kind !== "divform" || !$("#dv-date")) return;
  const d = OV.d, v = id => ($(id) || {}).value || "";
  d.stockId = v("#dv-stock"); d.date = v("#dv-date") || today(); d.amount = v("#dv-amt"); d.memo = v("#dv-memo");
  if($("#dv-krw")) d.krw = v("#dv-krw");
  if(!d.stockId && $("#dv-name")) d.name = v("#dv-name");
  if(d.stockId){ const s = S.stocks.find(x => x.id === d.stockId); if(s){ d.symbol = s.symbol; d.name = s.name; } }
}
function renderDivForm(){
  const d = OV.d;
  showOv(`<form class="sheetbox" id="divForm" role="dialog" aria-modal="true" aria-label="배당 기록" novalidate>
    <div class="sb-head"><span class="ttl">${OV.id ? "배당 기록 편집" : "배당 기록"}</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body">
      <div class="fld"><label for="dv-stock">종목</label>
        <select id="dv-stock"><option value="">직접 입력</option>${S.stocks.map(s => `<option value="${esc(s.id)}" ${d.stockId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      ${!d.stockId ? `<div class="fld"><label for="dv-name">종목 이름</label><input id="dv-name" type="text" value="${esc(d.name)}" maxlength="60"></div>` : ""}
      <div class="frow">
        <div class="fld"><label for="dv-date">받은 날</label><input id="dv-date" type="date" value="${esc(d.date)}"></div>
        <div class="fld"><span class="lb">통화</span><div class="seg" role="group" aria-label="통화"><button type="button" data-dvcur="KRW" aria-pressed="${d.currency !== "USD"}">원</button><button type="button" data-dvcur="USD" aria-pressed="${d.currency === "USD"}">달러</button></div></div>
      </div>
      <div class="fld"><label for="dv-amt">받은 금액 (${d.currency === "USD" ? "달러" : "원"})</label><input id="dv-amt" type="text" inputmode="decimal" value="${esc(d.amount)}" placeholder="${d.currency === "USD" ? "예: 12.34" : "예: 36100"}"></div>
      ${d.currency === "USD" ? `<div class="fld"><label for="dv-krw">원화 금액 (선택)</label><input id="dv-krw" type="text" inputmode="decimal" value="${esc(d.krw)}"><p class="st-note" id="dvKrwHint" style="margin:0">${dvKrwHint()}</p></div>` : ""}
      <div class="fld"><label for="dv-memo">메모 (선택)</label><input id="dv-memo" type="text" value="${esc(d.memo)}" maxlength="100" placeholder="예: 분기 배당, 세후"></div>
      ${OV.err ? `<p style="margin:0;color:var(--danger);font-size:13px">${esc(OV.err)}</p>` : ""}
    </div>
    <div class="sb-foot">${OV.confirm
      ? `<div class="confirm">이 배당 기록을 지울까요? <button class="btn small danger" type="button" data-act="divDelYes">삭제</button><button class="btn small" type="button" data-act="divDelNo">취소</button></div>`
      : `${OV.id ? `<button class="btn small ghost danger" type="button" data-act="divDel">삭제</button>` : ""}<span class="hint">세금을 뗀 실제 입금액을 적으면 편해요.</span><button class="btn" type="button" data-act="close">취소</button><button class="btn primary" type="submit">저장</button>`}</div>
  </form>`);
}
function saveDivForm(){
  syncDivForm();
  const d = OV.d, amount = parseNum(d.amount);
  const fail = m => { OV.err = m; renderDivForm(); };
  if(!d.stockId && !String(d.name || "").trim()) return fail("종목을 고르거나 이름을 적어 주세요.");
  if(amount == null || amount <= 0) return fail("받은 금액을 숫자로 적어 주세요.");
  let krw = null;
  if(d.currency === "USD"){
    krw = String(d.krw || "").trim() ? parseNum(d.krw) : (fxRate() ? Math.round(amount * fxRate()) : null);
    if(String(d.krw || "").trim() && krw == null) return fail("원화 금액은 숫자로 적어 주세요.");
  }
  const old = OV.id ? S.divs.find(x => x.id === OV.id) : null, now = Date.now();
  const rec = { id:old ? old.id : uuid(), stockId:d.stockId || null, symbol:d.symbol || "", name:String(d.name || "").trim(), date:d.date || today(),
    amount, currency:d.currency, krw, memo:String(d.memo || "").trim(), createdAt:old ? old.createdAt : now, updatedAt:now };
  putDiv(rec);
  S.divYear = +rec.date.slice(0, 4) || S.divYear;
  closeOv(); render(); toast(old ? "배당 기록을 고쳤어요." : "배당을 기록했어요.");
}
function deleteDiv(){
  const id = OV.id; S.divs = S.divs.filter(x => x.id !== id); saveDivs();
  closeOv(); render(); toast("배당 기록을 지웠어요.");
  enqueue({ op:"rowdel", table:"dividends", id });
}

/* ---------- overlays (with Android back-button support) ---------- */
let OV = null;
let ovPushed = false;
function endOv(){
  if(OV && OV.kind === "edit" && !OV.saved && OV.draft._new.length && S.B){
    const fresh = OV.draft._new.slice();
    S.B.removePhotos(fresh).catch(() => {});
  }
  OV = null; $("#ovRoot").innerHTML = ""; document.body.style.overflow = "";
}
function closeOv(){
  endOv();
  if(ovPushed){ ovPushed = false; try{ history.back(); }catch(e){} }
}
window.addEventListener("popstate", () => { if(ovPushed || OV){ ovPushed = false; endOv(); } });
function showOv(html){
  const fresh = !$("#ovRoot").firstElementChild;
  $("#ovRoot").innerHTML = `<div class="ov${fresh ? " anim" : ""}" data-ovbg>${html}</div>`;
  document.body.style.overflow = "hidden";
  if(!ovPushed){ try{ history.pushState({ sansiyaOv:1 }, ""); ovPushed = true; }catch(e){} }
  hydrateImages();
}

function openDetail(id){
  if(!S.entries.find(x => x.id === id)) return;
  if(OV) endOvKeepHistory();
  OV = { kind:"detail", id, confirm:false }; renderDetail();
}
function endOvKeepHistory(){ const p = ovPushed; endOv(); ovPushed = p; }
function renderDetail(){
  const e = S.entries.find(x => x.id === OV.id); if(!e){ closeOv(); return; }
  const c = catOf(e.cat);
  showOv(`<div class="sheetbox" role="dialog" aria-modal="true" aria-label="${esc(e.title)}">
    <div class="sb-head"><span class="ttl">${sheetNo(e)} · ${esc(c.name)}</span>
      <div class="sp"><button class="btn small" type="button" data-act="edit">편집</button><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body">
      <h2 class="dt-title">${esc(e.title)}</h2>
      <div class="dt-meta"><span class="mono">${fmtDate(e.date)}</span>
        <span class="pill ${e.type === "taste" ? "taste" : ""}">${TYPES[e.type] || "스크랩"}</span>
        ${e.type === "taste" && e.status ? `<span>${STATUS[e.status] || ""}</span>` : ""}
        ${stars(e.rating)}
        ${e.example ? `<span class="pill ex">예시</span>` : ""}
        ${pendingIds().has(e.id) ? `<span class="pill pend">동기화 대기</span>` : ""}</div>
      ${e.url ? `<div class="dt-link"><span class="mono">LINK</span><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(domain(e.url))}</a></div>` : ""}
      ${e.body ? `<div class="dt-body">${linkify(e.body)}</div>` : ""}
      ${(e.tags || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${e.tags.map(t => `<button type="button" class="chip" data-gotag="${esc(t)}">#${esc(t)}</button>`).join("")}</div>` : ""}
      ${(e.photos || []).length ? `<div class="dt-photos">${e.photos.map(p => imgTag(p)).join("")}</div>` : ""}
    </div>
    <div class="sb-foot">
      ${OV.confirm
        ? `<div class="confirm">이 기록${(e.photos || []).length ? "과 사진" : ""}을 완전히 지울까요? <button class="btn small danger" type="button" data-act="delYes">삭제</button><button class="btn small" type="button" data-act="delNo">취소</button></div>`
        : `<span class="hint">수정 ${e.updatedAt ? new Date(e.updatedAt).toLocaleDateString("ko-KR") : "-"}</span><button class="btn small ghost danger" type="button" data-act="del">삭제</button>`}
    </div></div>`);
}

function openEditor(id, presetDate){
  const e = id ? S.entries.find(x => x.id === id) : null;
  const f = S.filter;
  const draft = e ? { ...e, tags:[...(e.tags || [])], photos:[...(e.photos || [])] } :
    { type:f.type !== "all" ? f.type : "scrap", cat:f.cat !== "all" ? f.cat : (S.cats[0] || {}).code || "ETC", title:"", date:presetDate || today(), url:"", body:"", tags:f.tag ? [f.tag] : [], rating:0, status:"done", photos:[] };
  draft._new = []; draft._removed = [];
  if(OV) endOvKeepHistory();
  OV = { kind:"edit", id:id || null, draft, busy:0, saved:false };
  renderEditor();
  if(!id) setTimeout(() => { const t = $("#f-title"); if(t && window.matchMedia("(pointer:fine)").matches) t.focus(); }, 40);
}
function syncDraft(){
  if(!OV || OV.kind !== "edit" || !$("#f-title")) return;
  const d = OV.draft, v = s => ($(s) || {}).value;
  d.title = v("#f-title"); d.date = v("#f-date") || today(); d.url = (v("#f-url") || "").trim(); d.body = v("#f-body"); d.cat = v("#f-cat");
}
function renderEditor(){
  const d = OV.draft;
  const allTags = tagCounts().map(([t]) => t);
  const canPhoto = S.B && (S.B.kind === "local" || navigator.onLine);
  showOv(`<form class="sheetbox" id="edForm" role="dialog" aria-modal="true" aria-label="${OV.id ? "기록 편집" : "새 기록"}" novalidate>
    <div class="sb-head"><span class="ttl">${OV.id ? sheetNo(d) + " 편집" : "새 기록"}</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body">
      <div class="fld" id="f-photos"><span class="lb">사진 <span class="req">필수</span> <span style="color:var(--ink-3);font-weight:400">· 첫 번째 사진이 목록에 보여요</span></span>
        <div class="photos">${d.photos.map((p, i) => `<div class="p">${imgTag(p)}${i === 0 ? `<span class="first">대표</span>` : ""}<button type="button" data-rmphoto="${i}" aria-label="사진 빼기">×</button></div>`).join("")}
          ${Array.from({ length:OV.busy }, () => `<div class="busy">올리는 중…</div>`).join("")}
          ${canPhoto ? `<label class="add" for="f-photo"><span style="font-size:20px;line-height:1">+</span>사진 추가</label><input id="f-photo" type="file" accept="image/*" multiple hidden>` : `<span class="tag">사진은 인터넷에 연결되어 있을 때 올릴 수 있어요. 사진이 있어야 저장할 수 있어요.</span>`}
        </div></div>
      <div class="frow">
        <div class="fld"><span class="lb">유형</span>
          <div class="seg" role="group" aria-label="유형">
            <button type="button" data-ftype="scrap" aria-pressed="${d.type === "scrap"}">스크랩 · 정보</button>
            <button type="button" data-ftype="taste" aria-pressed="${d.type === "taste"}">취향 · 컬렉션</button>
          </div></div>
        <div class="fld"><label for="f-cat">분야</label>
          <select id="f-cat">${S.cats.map(c => `<option value="${esc(c.code)}" ${d.cat === c.code ? "selected" : ""}>${esc(c.code)} · ${esc(c.name)}</option>`).join("")}</select></div>
      </div>
      <div class="fld"><label for="f-title">제목</label><input class="big" id="f-title" type="text" value="${esc(d.title)}" placeholder="${d.type === "taste" ? "예: 선유도공원 산책" : "예: 서울 도시기본계획 요약"}" maxlength="200" enterkeyhint="next"></div>
      <div class="frow">
        <div class="fld"><label for="f-date">날짜</label><input id="f-date" type="date" value="${esc(d.date)}"></div>
        <div class="fld"><label for="f-url">링크 <span style="color:var(--ink-3);font-weight:400">(선택)</span></label><input id="f-url" type="url" inputmode="url" value="${esc(d.url)}" placeholder="https://"></div>
      </div>
      ${d.type === "taste" ? `<div class="frow">
        <div class="fld"><span class="lb">별점</span><div class="ratein" role="group" aria-label="별점">${[1,2,3,4,5].map(n => `<button type="button" data-rate="${n}" class="${d.rating >= n ? "on" : ""}" aria-label="${n}점">★</button>`).join("")}</div></div>
        <div class="fld"><span class="lb">상태</span><div class="seg" role="group" aria-label="상태">
          <button type="button" data-fstatus="done" aria-pressed="${d.status !== "want"}">경험함</button>
          <button type="button" data-fstatus="want" aria-pressed="${d.status === "want"}">위시</button></div></div>
      </div>` : ""}
      <div class="fld"><label for="f-body">내용</label><textarea id="f-body" placeholder="생각, 요약, 메모를 자유롭게. 링크는 자동으로 연결돼요.">${esc(d.body)}</textarea></div>
      <div class="fld"><label for="f-tag">태그</label>
        <div class="tagbox">${d.tags.map((t, i) => `<button type="button" class="chip on" data-rmtag="${i}">#${esc(t)} <span class="x">×</span></button>`).join("")}
          <input id="f-tag" type="text" list="tagList" placeholder="${d.tags.length ? "" : "입력 후 Enter (예: 미니멀, 콘크리트)"}" autocomplete="off" enterkeyhint="done"></div>
        <datalist id="tagList">${allTags.map(t => `<option value="${esc(t)}">`).join("")}</datalist></div>
    </div>
    <div class="sb-foot"><span class="hint">${navigator.onLine || S.B.kind === "local" ? "⌘/Ctrl + Enter 저장" : "오프라인: 저장해 두면 연결될 때 올라가요"}</span>
      <button class="btn" type="button" data-act="close">취소</button>
      <button class="btn primary" type="submit" ${OV.busy ? "disabled" : ""}>${OV.busy ? "사진 올리는 중…" : "저장"}</button></div>
  </form>`);
}
function addTag(raw){
  const d = OV.draft;
  raw.split(/[,#]/).map(s => s.trim()).filter(Boolean).forEach(t => { if(!d.tags.includes(t) && d.tags.length < 20) d.tags.push(t.slice(0, 30)); });
}
async function shrink(file){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try{
    const bmp = await createImageBitmap(file);
    const M = 2000, sc = Math.min(1, M / Math.max(bmp.width, bmp.height));
    if(sc === 1 && file.size < 1.5e6) return file;
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    let b = await new Promise(r => cv.toBlob(r, "image/webp", .86));
    if(!b || b.type !== "image/webp") b = await new Promise(r => cv.toBlob(r, "image/jpeg", .86));
    return b && b.size < file.size ? b : file;
  }catch(e){ return file; }
}
async function uploadPhotos(files){
  if(!(S.B.kind === "local" || navigator.onLine)){ toast("사진은 인터넷에 연결되어 있을 때 올릴 수 있어요."); return; }
  syncDraft();
  const list = [...files].filter(f => /^image\//.test(f.type) || !f.type).slice(0, 12);
  if(!list.length){ toast("사진 파일만 올릴 수 있어요."); return; }
  OV.busy += list.length; renderEditor();
  for(const f of list){
    try{
      if(/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || "")) throw { code:"heic" };
      const b = await shrink(f);
      if(b.size > 20 * 1024 * 1024) throw { code:"big" };
      const path = await S.B.uploadPhoto(b);
      if(S.B.kind !== "local") S.urls.set(path, { url:URL.createObjectURL(b), exp:Date.now() + 3600e3 });
      if(OV && OV.kind === "edit"){ OV.draft.photos.push(path); OV.draft._new.push(path); }
      else S.B.removePhotos([path]).catch(() => {});
    }catch(err){
      const m = String(err && (err.message || "") || "");
      toast(err && err.code === "heic" ? "HEIC 사진은 지원하지 않아요. JPG나 PNG로 바꿔서 올려 주세요."
        : err && err.code === "big" || /size|too large|exceed/i.test(m) ? "20MB 이하 사진만 올릴 수 있어요."
        : /mime|type/i.test(m) ? "JPG, PNG, WEBP, GIF 사진만 올릴 수 있어요."
        : isNetErr(err) ? "인터넷 연결이 끊겨 사진을 올리지 못했어요."
        : "사진을 올리지 못했어요. 다시 시도해 주세요.");
    }finally{
      if(OV && OV.kind === "edit"){ OV.busy = Math.max(0, OV.busy - 1); syncDraft(); renderEditor(); }
    }
  }
}
async function saveDraft(){
  syncDraft();
  const d = OV.draft;
  if(!d.photos.length){
    toast(OV.busy ? "사진을 올리는 중이에요. 잠시만 기다려 주세요." : "사진을 한 장 이상 넣어 주세요.");
    const box = $("#f-photos"); if(box){ box.classList.remove("need"); void box.offsetWidth; box.classList.add("need"); box.scrollIntoView({ block:"nearest", behavior:"smooth" }); }
    return;
  }
  if(!d.title.trim()){ toast("제목을 적어 주세요."); const t = $("#f-title"); if(t) t.focus(); return; }
  if(d.url && !/^https?:\/\//i.test(d.url)) d.url = "https://" + d.url;
  const pend = ($("#f-tag") || {}).value; if(pend) addTag(pend);
  const old = OV.id ? S.entries.find(x => x.id === OV.id) : null;
  let seq = d.seq;
  if(!old || old.cat !== d.cat) seq = Math.max(0, ...S.entries.filter(e => e.cat === d.cat).map(e => e.seq || 0)) + 1;
  const now = Date.now();
  const entry = { id:OV.id || uuid(), type:d.type, cat:d.cat, seq, title:d.title.trim(), date:d.date, url:d.url || "", body:d.body || "", tags:d.tags.slice(),
    rating:d.type === "taste" ? (d.rating || 0) : 0, status:d.type === "taste" ? (d.status || "done") : "",
    photos:d.photos.slice(), example:!!(old && old.example), createdAt:old ? (old.createdAt || now) : now, updatedAt:now };
  const i = S.entries.findIndex(e => e.id === entry.id);
  if(i >= 0) S.entries[i] = entry; else S.entries.push(entry);
  saveCache();
  const removed = d._removed.slice(), wasNew = !OV.id;
  OV.saved = true;
  if(wasNew){
    closeOv(); toast(`${entry.cat}-${pad(seq, 3)} 저장했어요.`);
    if(S.view === "calendar") S.calSel = entry.date;
    render();
  }else{
    endOvKeepHistory(); OV = { kind:"detail", id:entry.id, confirm:false }; renderDetail(); render();
    toast("수정했어요.");
  }
  enqueue({ op:"upsert", entry, removed });
}
async function deleteEntry(id){
  const e = S.entries.find(x => x.id === id); if(!e) return;
  S.entries = S.entries.filter(x => x.id !== id); saveCache();
  closeOv(); render(); toast("삭제했어요.");
  enqueue({ op:"delete", id, photos:(e.photos || []).slice() });
}
async function clearExamples(){
  const ex = S.entries.filter(e => e.example);
  S.entries = S.entries.filter(e => !e.example); saveCache(); render();
  toast(`예시 기록 ${ex.length}건을 지웠어요.`);
  for(const e of ex) await enqueue({ op:"delete", id:e.id, photos:e.photos || [] });
}

/* categories */
function openCats(){ if(OV) endOvKeepHistory(); OV = { kind:"cats", err:"" }; renderCats(); }
function renderCats(){
  showOv(`<div class="sheetbox" role="dialog" aria-modal="true" aria-label="분야 관리">
    <div class="sb-head"><span class="ttl">분야 관리</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body">
      <p style="margin:0;color:var(--ink-2);font-size:14px">분야 코드는 기록 번호 앞에 붙어요 (예: ARC-012). 기록이 있는 분야는 지울 수 없어요.</p>
      <div class="cats">${S.cats.map((c, i) => { const n = count(e => e.cat === c.code); return `<div class="cr"><span class="code">${esc(c.code)}</span><span>${esc(c.name)}</span><span class="n">${n}건</span><button class="btn small ghost danger" type="button" data-rmcat="${i}" ${n ? "disabled" : ""}>지우기</button></div>`; }).join("")}</div>
      <div class="addcat">
        <div class="fld"><label for="c-code">코드</label><input id="c-code" type="text" maxlength="4" placeholder="ART" autocapitalize="characters" style="text-transform:uppercase"></div>
        <div class="fld"><label for="c-name">이름</label><input id="c-name" type="text" maxlength="20" placeholder="예: 미술"></div>
        <button class="btn" type="button" data-act="addcat">분야 추가</button>
      </div>
      ${OV.err ? `<p style="margin:0;color:var(--danger);font-size:13px">${esc(OV.err)}</p>` : ""}
    </div></div>`);
}
function saveCats(cats){
  S.cats = cats; KV.set(k("settings"), { categories:cats });
  renderCats(); render();
  enqueue({ op:"settings", settings:{ categories:cats } });
}

/* settings */
function openSettings(){ if(OV) endOvKeepHistory(); OV = { kind:"settings", confirmOut:false, confirmDrop:false, brokerCode:"", brokerConfirm:false }; renderSettings(); loadBroker(); }
function themeNow(){ try{ return localStorage.getItem("sansiya-theme") || "system"; }catch(e){ return "system"; } }
function renderSettings(){
  const local = S.B.kind === "local";
  const n = S.outbox.length, standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const th = themeNow();
  showOv(`<div class="sheetbox" role="dialog" aria-modal="true" aria-label="설정">
    <div class="sb-head"><span class="ttl">설정 · 백업</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body"><div class="set">
      <section><h3>계정</h3><div class="sv">
        ${local ? `<span>로그인 없이 <b>이 기기에만</b> 저장하고 있어요.</span><p class="note">폰·컴퓨터 동기화를 쓰려면 Supabase에 연결하세요. 지금 기록은 백업 파일로 옮길 수 있어요.</p>
          <div class="acts"><button class="btn small" type="button" data-act="toSetup">Supabase 연결하기</button></div>`
        : `<span>${esc(S.email || "로그인됨")}</span>
          ${OV.confirmOut ? `<p class="err">${n ? `아직 올라가지 않은 변경 ${n}건이 있어요. 지금 로그아웃하면 사라져요. ` : ""}이 기기에 저장된 기록 사본을 지우고 로그아웃할까요?</p>
            <div class="acts"><button class="btn small danger" type="button" data-act="signOutYes">로그아웃</button><button class="btn small" type="button" data-act="signOutNo">취소</button></div>`
          : `<div class="acts"><button class="btn small" type="button" data-act="changePw">비밀번호 바꾸기</button><button class="btn small" type="button" data-act="signOut">로그아웃</button></div>`}`}
      </div></section>
      ${local ? "" : `<section><h3>동기화</h3><div class="sv">
        <span>${S.sync === "error" ? "동기화 오류" : !navigator.onLine ? "오프라인" : n ? `올라가길 기다리는 변경 ${n}건` : "모든 기록이 동기화됐어요"}</span>
        <p class="note">마지막 동기화 ${S.lastSync ? fmtTime(S.lastSync) : "없음"}</p>
        ${S.syncErr ? `<p class="err">${esc(S.syncErr)}</p>` : ""}
        <div class="acts"><button class="btn small" type="button" data-act="syncNow">지금 동기화</button>
          ${n && S.sync === "error" ? (OV.confirmDrop ? `<button class="btn small danger" type="button" data-act="dropYes">대기 중 변경 ${n}건 버리기</button><button class="btn small" type="button" data-act="dropNo">취소</button>` : `<button class="btn small ghost danger" type="button" data-act="drop">대기 중 변경 버리기</button>`) : ""}</div>
      </div></section>`}
      <section><h3>화면</h3><div class="sv">
        <div class="seg" role="group" aria-label="테마">
          ${[["system","시스템"],["light","라이트"],["dark","다크"]].map(([v, l]) => `<button type="button" data-theme-set="${v}" aria-pressed="${th === v}">${l}</button>`).join("")}
        </div>
      </div></section>
      <section><h3>분야</h3><div class="sv"><div class="acts"><button class="btn small" type="button" data-act="cats">분야 관리 열기</button></div></div></section>
      <section><h3>토스증권 연동</h3><div class="sv">${brokerSettingsHtml()}</div></section>
      <section><h3>백업</h3><div class="sv">
        <p class="note">기록 전체를 JSON 파일로 내려받거나, 백업 파일·이전 산시야(Claude 버전)의 백업을 가져올 수 있어요. 사진은 파일에 들어가지 않아요.</p>
        <div class="acts"><button class="btn small" type="button" data-act="export">JSON 내보내기</button>
          <label class="btn small" for="importFile">JSON 가져오기</label><input id="importFile" type="file" accept="application/json,.json" hidden></div>
      </div></section>
      <section><h3>앱 설치</h3><div class="sv">
        ${standalone ? `<span>설치된 앱으로 실행 중이에요.</span>`
          : S.installEvt ? `<div class="acts"><button class="btn small primary" type="button" data-act="install">홈 화면에 설치</button></div>`
          : `<p class="note">안드로이드 Chrome: 오른쪽 위 ⋮ 메뉴 → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>.</p>`}
      </div></section>
      <section><h3>정보</h3><div class="sv"><span class="mono" style="font-size:12px;color:var(--ink-3)">산시야 v${APP_VERSION} · ${local ? "이 기기 저장" : "Supabase 동기화"}</span></div></section>
    </div></div></div>`);
}
async function signOut(){
  const uid = S.uid;
  await S.B.signOut();
  await Promise.all(["entries","outbox","settings","urls","lastSync"].map(n => KV.del(`u:${uid}:${n}`)));
  resetState(); closeOv(); showGate("login");
}
function resetState(){
  S.uid = null; S.email = ""; S.entries = []; S.loaded = false; S.outbox = []; S.lastSync = 0; S.urls = new Map(); S.syncErr = ""; S.sync = "idle"; S.cats = DEFAULT_CATS.slice();
  S.stocks = []; S.divs = []; S.quotes = {}; S.fx = null; S.quotesAt = 0; S.qErr = ""; S.qLoading = false; S.hist = {}; S.market = {}; S.broker = undefined;
}
function onSignedOut(){
  if(!S.uid) return;
  endOv(); ovPushed = false; S.uid = null; S.loaded = false;
  showGate("login", "로그인이 만료됐어요. 다시 로그인해 주세요.");
}
function applyTheme(v){
  try{ if(v === "system") localStorage.removeItem("sansiya-theme"); else localStorage.setItem("sansiya-theme", v); }catch(e){}
  if(v === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", v);
  syncThemeColor();
}
const THEME_META = [...document.querySelectorAll('meta[name="theme-color"]')].map(m => ({ m, content:m.getAttribute("content"), media:m.getAttribute("media") }));
function syncThemeColor(){
  const t = themeNow();
  THEME_META.forEach(({ m, content, media }) => {
    if(t === "system"){ m.setAttribute("content", content); if(media) m.setAttribute("media", media); }
    else { m.setAttribute("content", t === "dark" ? "#14110D" : "#FFF9EF"); m.removeAttribute("media"); }
  });
}
syncThemeColor();

/* backup */
function exportJson(){
  const data = JSON.stringify({ app:"sansiya", version:APP_VERSION, exportedAt:new Date().toISOString(), categories:S.cats, entries:S.entries, stocks:S.stocks, dividends:S.divs }, null, 2);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type:"application/json" }));
  a.download = `산시야-백업-${today()}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast("백업 파일을 내려받았어요.");
}
function normEntry(r){
  const now = Date.now();
  return { id:r.id, type:r.type === "taste" ? "taste" : "scrap", cat:String(r.cat || "ETC").slice(0, 4).toUpperCase(), seq:+r.seq || 0,
    title:String(r.title).slice(0, 200), date:/^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date : today(), url:String(r.url || ""), body:String(r.body || ""),
    tags:Array.isArray(r.tags) ? r.tags.map(String).slice(0, 20) : [], rating:Math.max(0, Math.min(5, Math.round(+r.rating || 0))),
    status:r.type === "taste" ? (r.status === "want" ? "want" : "done") : "", photos:r.photos || [], example:!!r.example,
    createdAt:+r.createdAt || now, updatedAt:+r.updatedAt || now };
}
function parseImport(text){
  const j = JSON.parse(text);
  const src = Array.isArray(j) ? j : (Array.isArray(j.entries) ? j.entries : (Array.isArray(j.stocks) || Array.isArray(j.dividends) ? [] : null));
  if(!src) throw new Error("format");
  const cats = Array.isArray(j.categories) ? j.categories.filter(c => c && c.code && c.name).map(c => ({ code:String(c.code).slice(0, 4).toUpperCase(), name:String(c.name).slice(0, 20) })) : [];
  const existing = new Set(S.entries.map(e => e.id));
  let dropped = 0; const out = [];
  for(const r of src){
    if(!r || !r.title) continue;
    const photos = (Array.isArray(r.photos) ? r.photos : []).filter(p => typeof p === "string" && S.uid && p.startsWith(S.uid + "/"));
    dropped += (Array.isArray(r.photos) ? r.photos.length : 0) - photos.length;
    out.push(normEntry({ ...r, id:isUuid(r.id) ? r.id : uuid(), photos }));
  }
  // keep sheet numbers unique within each field
  const used = new Map();
  S.entries.filter(e => !out.some(o => o.id === e.id)).forEach(e => { if(!used.has(e.cat)) used.set(e.cat, new Set()); used.get(e.cat).add(e.seq); });
  out.sort((a, b) => a.createdAt - b.createdAt).forEach(e => {
    if(!used.has(e.cat)) used.set(e.cat, new Set());
    const u = used.get(e.cat);
    if(!e.seq || u.has(e.seq)) e.seq = Math.max(0, ...u) + 1;
    u.add(e.seq);
  });
  // stocks & dividends (merged by symbol so the same stock is never added twice)
  const idMap = new Map(), stocks = [], divs = [];
  for(const r of (Array.isArray(j.stocks) ? j.stocks : [])){
    if(!r || !r.symbol || !r.name) continue;
    const have = S.stocks.find(x => x.symbol === r.symbol);
    const id = have ? have.id : (isUuid(r.id) ? r.id : uuid());
    if(r.id) idMap.set(r.id, id);
    const now = Date.now();
    stocks.push({ id, symbol:String(r.symbol), market:r.market === "US" ? "US" : "KR", name:String(r.name).slice(0, 60), currency:r.currency === "USD" ? "USD" : "KRW",
      watch:r.watch !== false, qty:Math.max(0, +r.qty || 0), avgPrice:Math.max(0, +r.avgPrice || 0), target:numOrNull(r.target), memo:String(r.memo || ""),
      notes:Array.isArray(r.notes) ? r.notes.filter(n => n && n.text).map(n => ({ id:String(n.id || uuid()), date:String(n.date || today()), text:String(n.text) })) : [],
      sort:+r.sort || 0, createdAt:+r.createdAt || now, updatedAt:+r.updatedAt || now });
  }
  for(const r of (Array.isArray(j.dividends) ? j.dividends : [])){
    if(!r || !(+r.amount > 0)) continue;
    const now = Date.now(), sid = r.stockId ? (idMap.get(r.stockId) || (S.stocks.some(x => x.id === r.stockId) ? r.stockId : null)) : null;
    divs.push({ id:isUuid(r.id) ? r.id : uuid(), stockId:sid, symbol:String(r.symbol || ""), name:String(r.name || ""), date:/^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date : today(),
      amount:+r.amount, currency:r.currency === "USD" ? "USD" : "KRW", krw:numOrNull(r.krw), memo:String(r.memo || ""), createdAt:+r.createdAt || now, updatedAt:+r.updatedAt || now });
  }
  return { entries:out, cats, dropped, overwrite:out.filter(e => existing.has(e.id)).length, stocks, divs };
}
function openImport(res){ if(OV) endOvKeepHistory(); OV = { kind:"import", res }; renderImport(); }
function renderImport(){
  const r = OV.res;
  showOv(`<div class="sheetbox" role="dialog" aria-modal="true" aria-label="가져오기">
    <div class="sb-head"><span class="ttl">백업 가져오기</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body prose">
      <p style="margin:0;font-size:15px">${[r.entries.length ? `기록 <b>${r.entries.length}건</b>` : "", r.stocks.length ? `종목 <b>${r.stocks.length}개</b>` : "", r.divs.length ? `배당 <b>${r.divs.length}건</b>` : ""].filter(Boolean).join(", ")}을 가져올까요?</p>
      <p class="tag" style="margin:0">${r.overwrite ? `같은 기록 ${r.overwrite}건은 백업 내용으로 덮어써요. ` : ""}${r.dropped ? `사진 ${r.dropped}장은 옮길 수 없어서 빠져요. ` : ""}${r.entries.some(e => e.example) ? "예시 기록도 들어 있어요. 가져온 뒤 배너에서 한 번에 지울 수 있어요." : ""}</p>
    </div>
    <div class="sb-foot"><button class="btn" type="button" data-act="close">취소</button><button class="btn primary" type="button" data-act="importYes">가져오기</button></div></div>`);
}
async function doImport(){
  const r = OV.res; closeOv();
  const byId = new Map(S.entries.map(e => [e.id, e]));
  r.entries.forEach(e => byId.set(e.id, e));
  S.entries = [...byId.values()]; saveCache();
  const known = new Set(S.cats.map(c => c.code));
  const addCats = [];
  r.entries.forEach(e => { if(!known.has(e.cat)){ known.add(e.cat); const ic = r.cats.find(c => c.code === e.cat); addCats.push({ code:e.cat, name:ic ? ic.name : e.cat }); } });
  if(addCats.length){
    const cats = [...S.cats.filter(c => c.code !== "ETC"), ...addCats, ...S.cats.filter(c => c.code === "ETC")];
    S.cats = cats; KV.set(k("settings"), { categories:cats }); enqueue({ op:"settings", settings:{ categories:cats } });
  }
  if(r.stocks.length || r.divs.length){
    const sm = new Map(S.stocks.map(x => [x.id, x])); r.stocks.forEach(x => sm.set(x.id, x)); S.stocks = [...sm.values()]; saveStocks();
    const dm = new Map(S.divs.map(x => [x.id, x])); r.divs.forEach(x => dm.set(x.id, x)); S.divs = [...dm.values()]; saveDivs();
    for(const x of r.stocks) enqueue({ op:"row", table:"stocks", rec:x });
    for(const x of r.divs) enqueue({ op:"row", table:"dividends", rec:x });
  }
  render(); toast([r.entries.length ? `기록 ${r.entries.length}건` : "", r.stocks.length ? `종목 ${r.stocks.length}개` : "", r.divs.length ? `배당 ${r.divs.length}건` : ""].filter(Boolean).join(", ") + "을 가져왔어요.");
  if(!r.entries.length) return;
  try{
    setSync("busy"); await S.B.upsertMany(r.entries); S.lastSync = Date.now(); setSync("ok");
  }catch(err){
    r.entries.forEach(e => { S.outbox = S.outbox.filter(o => opKey(o) !== e.id); S.outbox.push({ op:"upsert", entry:e, removed:[] }); });
    await saveOutbox();
    if(isNetErr(err)) setSync("offline"); else { S.syncErr = errMsg(err); setSync("error"); }
    render();
  }
}

/* ---------- gate: setup / login ---------- */
function showGate(kind, msg, note){
  $("#app").hidden = true;
  const g = $("#gate"); g.hidden = false;
  const cfg = getConfig();
  const sheet = { setup:"SHEET 00 · SETUP", login:"SHEET 01 · SIGN IN", recover:"SHEET 02 · NEW PASSWORD" }[kind] || "SHEET 99 · NOTICE";
  const foot = `<div class="sheetno"><span>${sheet}</span><span>v${APP_VERSION}</span></div>`;
  if(kind === "recover"){
    const changing = !!S.uid;
    g.innerHTML = `<form class="gate-card" id="gateForm" data-kind="recover" novalidate>${MARK}
      <h1>새 비밀번호</h1><p class="lede">${changing ? "바꿀 비밀번호를 정해 주세요." : "산시야에 로그인할 새 비밀번호를 정해 주세요."}</p>
      <div class="fld"><label for="g-new">새 비밀번호 (6자 이상)</label><input id="g-new" type="password" autocomplete="new-password" required></div>
      <div class="fld"><label for="g-new2">새 비밀번호 확인</label><input id="g-new2" type="password" autocomplete="new-password" required></div>
      <label class="showpw"><input type="checkbox" data-showpw="g-new,g-new2"> 비밀번호 보기</label>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      <button class="btn primary block" type="submit" id="g-submit">${changing ? "비밀번호 바꾸기" : "저장하고 시작하기"}</button>
      ${changing ? `<button class="btn block" type="button" data-gate="cancelPw">취소</button>` : ""}
      <p class="foot">입력이 이상하면 키보드가 한글 상태인지 확인해 주세요. ‘비밀번호 보기’를 켜면 입력한 글자를 볼 수 있어요.</p>
      ${foot}</form>`;
    const f = $("#g-new"); if(f) f.focus();
    return;
  }
  if(kind === "setup"){
    g.innerHTML = `<form class="gate-card" id="gateForm" data-kind="setup" novalidate>${MARK}
      <h1>산시야</h1><p class="lede">처음 한 번만 Supabase 연결 정보를 넣어 주세요.</p>
      <div class="fld"><label for="g-url">Project URL</label><input id="g-url" type="url" inputmode="url" placeholder="https://xxxx.supabase.co" autocomplete="off" required></div>
      <div class="fld"><label for="g-key">Publishable key (또는 anon public key)</label><input id="g-key" type="text" placeholder="sb_publishable_… 또는 eyJ…" autocomplete="off" spellcheck="false" required></div>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      <button class="btn primary block" type="submit">연결하기</button>
      <p class="foot">두 값은 Supabase 대시보드의 Project Settings → API Keys에서 찾을 수 있어요. 기록은 로그인한 본인만 볼 수 있게 보호돼요.<br><br>
        <button type="button" data-gate="local">로그인 없이 이 기기에만 저장하기</button></p>
      ${foot}</form>`;
  }else if(kind === "login"){
    g.innerHTML = `<form class="gate-card" id="gateForm" data-kind="login" novalidate>${MARK}
      <h1>산시야</h1><p class="lede">나의 스크랩과 취향 기록장</p>
      <div class="fld"><label for="g-email">이메일</label><input id="g-email" type="email" inputmode="email" autocomplete="username" required></div>
      <div class="fld"><label for="g-pw">비밀번호</label><input id="g-pw" type="password" autocomplete="current-password" required></div>
      <label class="showpw"><input type="checkbox" data-showpw="g-pw"> 비밀번호 보기</label>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      ${note ? `<p class="note">${esc(note)}</p>` : ""}
      <button class="btn primary block" type="submit" id="g-submit">로그인</button>
      <p class="foot"><button type="button" data-gate="forgot">비밀번호를 잊으셨나요?</button> 이메일을 적고 누르면 새 비밀번호를 정하는 링크를 메일로 보내 드려요.
        ${cfg && cfg.source === "device" ? `<br><br><button type="button" data-gate="reset">연결 정보 다시 입력</button>` : ""}</p>
      ${foot}</form>`;
  }else{
    g.innerHTML = `<div class="gate-card">${MARK}<h1>산시야</h1><p class="lede">${esc(msg || "앱을 시작하지 못했어요.")}</p>
      <button class="btn primary block" type="button" data-gate="retry">다시 시도</button>${foot}</div>`;
  }
  const first = g.querySelector("input"); if(first && window.matchMedia("(pointer:fine)").matches) first.focus();
}
function hideGate(){ const g = $("#gate"); g.hidden = true; g.innerHTML = ""; $("#app").hidden = false; }
function getConfig(){
  const c = window.SANSIYA_CONFIG || {};
  if(c.supabaseUrl && c.supabaseKey) return { url:String(c.supabaseUrl).trim().replace(/\/+$/, ""), key:String(c.supabaseKey).trim(), source:"file" };
  try{
    const s = JSON.parse(localStorage.getItem("sansiya-config") || "null");
    if(s && s.supabaseUrl && s.supabaseKey) return { url:s.supabaseUrl, key:s.supabaseKey, source:"device" };
  }catch(e){}
  return null;
}
function getMode(){
  if(new URLSearchParams(location.search).has("demo")) return "local";
  try{ if(localStorage.getItem("sansiya-mode") === "local") return "local"; }catch(e){}
  return getConfig() ? "supabase" : "setup";
}
async function gateSubmit(form){
  const kind = form.dataset.kind;
  if(kind === "setup"){
    const url = $("#g-url").value.trim().replace(/\/+$/, ""), key = $("#g-key").value.trim();
    if(!/^https:\/\/[^\s/]+\.[^\s/]+$/.test(url)){ showGate("setup", "Project URL은 https://로 시작하는 주소예요 (예: https://abcd.supabase.co)."); $("#g-key").value = key; return; }
    if(key.length < 20){ showGate("setup", "Publishable key가 너무 짧아요. 전체를 복사해 붙여 넣어 주세요."); $("#g-url").value = url; return; }
    try{ localStorage.setItem("sansiya-config", JSON.stringify({ supabaseUrl:url, supabaseKey:key })); localStorage.removeItem("sansiya-mode"); }catch(e){}
    boot();
  }else if(kind === "recover"){
    const pw = $("#g-new").value, pw2 = $("#g-new2").value;
    if(pw.length < 6){ showGate("recover", "비밀번호는 6자 이상이어야 해요."); return; }
    if(pw !== pw2){ showGate("recover", "두 비밀번호가 서로 달라요. 다시 입력해 주세요."); return; }
    const btn = $("#g-submit"); btn.disabled = true; btn.textContent = "저장 중…";
    try{
      const user = await S.B.updatePassword(pw);
      S.B.clearRecovery();
      if(S.uid){ hideGate(); render(); toast("비밀번호를 바꿨어요."); }
      else { await startApp(user || S.B.user()); toast("새 비밀번호를 저장했어요."); }
    }catch(err){
      const m = errMsg(err);
      showGate("recover", /same|different from the old/i.test(m) ? "이전 비밀번호와 다른 비밀번호를 써 주세요."
        : /weak|at least|characters/i.test(m) ? "더 길거나 복잡한 비밀번호를 써 주세요."
        : /session|jwt|expired|not authenticated/i.test(m) ? "링크가 만료됐어요. 로그인 화면에서 ‘비밀번호를 잊으셨나요?’를 다시 눌러 주세요."
        : isNetErr(err) ? "인터넷 연결을 확인해 주세요." : m);
    }
  }else if(kind === "login"){
    const email = $("#g-email").value.trim(), pw = $("#g-pw").value;
    if(!email || !pw){ showGate("login", "이메일과 비밀번호를 모두 적어 주세요."); $("#g-email").value = email; return; }
    const btn = $("#g-submit"); btn.disabled = true; btn.textContent = "로그인 중…";
    try{
      const user = await S.B.signIn(email, pw);
      await startApp(user);
    }catch(err){
      const m = errMsg(err);
      const msg = /invalid login credentials/i.test(m) ? "이메일 또는 비밀번호가 맞지 않아요. 키보드가 한글 상태는 아닌지 확인해 보고, 계속 안 되면 아래 ‘비밀번호를 잊으셨나요?’를 눌러 주세요."
        : /email not confirmed/i.test(m) ? "이메일 인증이 안 된 계정이에요. 대시보드에서 Auto Confirm User를 켜고 만들었는지 확인해 주세요."
        : /invalid api key|no api key|apikey/i.test(m) ? "연결 키가 맞지 않아요. 연결 정보를 다시 확인해 주세요."
        : isNetErr(err) ? (navigator.onLine ? "Supabase에 연결하지 못했어요. Project URL이 맞는지, 프로젝트가 일시정지되지 않았는지 확인해 주세요." : "인터넷에 연결되어 있지 않아요.")
        : m;
      showGate("login", msg); const e = $("#g-email"); if(e) e.value = email;
    }
  }
}

async function forgotPassword(){
  const email = ($("#g-email") || {}).value ? $("#g-email").value.trim() : "";
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ showGate("login", "비밀번호를 다시 정할 이메일을 위 칸에 먼저 적어 주세요."); if($("#g-email")) $("#g-email").value = email; return; }
  try{
    await S.B.resetPassword(email);
    showGate("login", null, "비밀번호 재설정 메일을 보냈어요. 메일의 링크를 누르면 새 비밀번호를 정할 수 있어요. 메일이 안 보이면 스팸함도 확인해 주세요.");
  }catch(err){
    const m = errMsg(err);
    showGate("login", /rate|limit|seconds|too many/i.test(m) ? "메일을 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요." : isNetErr(err) ? "인터넷 연결을 확인해 주세요." : m);
  }
  if($("#g-email")) $("#g-email").value = email;
}

/* ---------- events ---------- */
function setFilter(key, v){ S.filter[key] = v; if(S.view !== "archive") S.view = "archive"; render(); window.scrollTo({ top:0 }); }
document.addEventListener("click", ev => {
  if(ev.target.matches && ev.target.matches("[data-ovbg]")){ closeOv(); return; }
  const t = ev.target.closest("button,[data-open]");
  if(!t) return;
  const ds = t.dataset;
  if(ds.gate){
    if(ds.gate === "local"){ try{ localStorage.setItem("sansiya-mode", "local"); }catch(e){} boot(); }
    else if(ds.gate === "reset"){ try{ localStorage.removeItem("sansiya-config"); }catch(e){} showGate("setup"); }
    else if(ds.gate === "retry") location.reload();
    else if(ds.gate === "cancelPw"){ hideGate(); render(); }
    else if(ds.gate === "forgot") forgotPassword();
    return;
  }
  if(ds.view){ S.view = ds.view; render(); window.scrollTo({ top:0 }); if(S.view === "stocks"){ refreshQuotes(); loadBroker(); } return; }
  // stocks
  if(ds.sttab){ S.stockTab = ds.sttab; render(); if(ds.sttab !== "div") refreshQuotes(); return; }
  if(ds.stock){ openStock(ds.stock); return; }
  if(ds.index){ openIndex(ds.index); return; }
  if(ds.div){ openDivForm(ds.div); return; }
  if(ds.divyear){ S.divYear += +ds.divyear; render(); return; }
  if(ds.strange){ setRange(ds.strange); return; }
  if(ds.stpick){ const r = OV && OV.results && OV.results[+ds.stpick]; if(r){ const have = S.stocks.find(s => s.symbol === r.symbol); if(have) openStock(have.id); else openStockForm(r); } return; }
  if(ds.rmnote){ removeNote(ds.rmnote); return; }
  if(ds.holdshow){ S.holdShow = ds.holdshow; savePrefs(); render(); return; }
  if(ds.dvcur){ syncDivForm(); OV.d.currency = ds.dvcur; renderDivForm(); if(ds.dvcur === "USD" && !fxRate()) refreshQuotes(true, []); return; }
  if(ds.type && !t.closest(".sheetbox")){ setFilter("type", ds.type); return; }
  if(ds.cat){ setFilter("cat", ds.cat); return; }
  if(ds.tag){ setFilter("tag", S.filter.tag === ds.tag ? null : ds.tag); return; }
  if(ds.gotag){ if(OV) closeOv(); setFilter("tag", ds.gotag); return; }
  if(ds.gocat){ setFilter("cat", ds.gocat); return; }
  if(ds.clear){ if(ds.clear === "q"){ S.filter.q = ""; $("#q").value = ""; } else S.filter[ds.clear] = ds.clear === "tag" ? null : "all"; render(); return; }
  if(ds.layout){ S.layout = ds.layout; savePrefs(); render(); return; }
  if(ds.cal){ const n = +ds.cal; if(n === 0){ const d = new Date(); S.calMonth = new Date(d.getFullYear(), d.getMonth(), 1); S.calSel = today(); } else S.calMonth = new Date(S.calMonth.getFullYear(), S.calMonth.getMonth() + n, 1); render(); return; }
  if(ds.day){ S.calSel = S.calSel === ds.day ? null : ds.day; render(); return; }
  if(ds.open){ openDetail(ds.open); return; }
  if(ds.ftype){ syncDraft(); OV.draft.type = ds.ftype; renderEditor(); return; }
  if(ds.fstatus){ syncDraft(); OV.draft.status = ds.fstatus; renderEditor(); return; }
  if(ds.rate){ syncDraft(); const n = +ds.rate; OV.draft.rating = OV.draft.rating === n ? 0 : n; renderEditor(); return; }
  if(ds.rmtag){ syncDraft(); OV.draft.tags.splice(+ds.rmtag, 1); renderEditor(); return; }
  if(ds.rmphoto){
    syncDraft(); const d = OV.draft, p = d.photos.splice(+ds.rmphoto, 1)[0];
    if(d._new.includes(p)){ d._new = d._new.filter(x => x !== p); S.B.removePhotos([p]).catch(() => {}); } else d._removed.push(p);
    renderEditor(); return;
  }
  if(ds.rmcat){ const cats = S.cats.slice(); cats.splice(+ds.rmcat, 1); saveCats(cats); return; }
  if(ds.themeSet){ applyTheme(ds.themeSet); renderSettings(); return; }
  switch(ds.act){
    case "new": openEditor(null); break;
    case "newOn": openEditor(null, ds.date); break;
    case "stAdd": openStockSearch(); break;
    case "stRefresh": refreshQuotes(true); break;
    case "stEdit": openStockForm(null, OV.id); break;
    case "stDel": if(OV.kind === "stform"){ syncStForm(); OV.confirm = true; renderStockForm(); } else setStockConfirm(true); break;
    case "stDelNo": if(OV.kind === "stform"){ syncStForm(); OV.confirm = false; renderStockForm(); } else setStockConfirm(false); break;
    case "stWatch": toggleWatch(); break;
    case "stEye": S.hideAmt = !S.hideAmt; savePrefs(); render(); if(OV && OV.kind === "stock") updateStockDetail(); break;
    case "stDelYes": deleteStock(); break;
    case "stNoteAdd": addNote(); break;
    case "divAdd": openDivForm(null, ds.for); break;
    case "divDel": syncDivForm(); OV.confirm = true; renderDivForm(); break;
    case "divDelNo": OV.confirm = false; renderDivForm(); break;
    case "divDelYes": deleteDiv(); break;
    case "close": closeOv(); break;
    case "edit": openEditor(OV.id); break;
    case "del": OV.confirm = true; renderDetail(); break;
    case "delNo": OV.confirm = false; renderDetail(); break;
    case "delYes": deleteEntry(OV.id); break;
    case "cats": openCats(); break;
    case "brokerCode": makeBrokerCode(); break;
    case "showHidden": S.showHidden = !S.showHidden; render(); break;
    case "brokerOff": OV.brokerConfirm = true; renderSettings(); break;
    case "brokerOffNo": OV.brokerConfirm = false; renderSettings(); break;
    case "brokerOffYes": unlinkBroker(); break;
    case "copyBroker": { const c = OV.brokerCode || ""; (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(() => toast("연결 코드를 복사했어요."), () => { const el = $("#brokerCode"); if(el){ const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } toast("코드를 길게 눌러 복사해 주세요."); }); break; }
    case "settings": openSettings(); break;
    case "clear": S.filter = { cat:"all", type:"all", tag:null, q:"" }; $("#q").value = ""; render(); break;
    case "clearEx": clearExamples(); break;
    case "export": exportJson(); break;
    case "importYes": doImport(); break;
    case "syncNow": pull().then(() => { if(OV && OV.kind === "settings") renderSettings(); }); break;
    case "drop": OV.confirmDrop = true; renderSettings(); break;
    case "dropNo": OV.confirmDrop = false; renderSettings(); break;
    case "dropYes": S.outbox = []; saveOutbox(); S.syncErr = ""; S.sync = "idle"; OV.confirmDrop = false; pull(); renderSettings(); break;
    case "signOut": OV.confirmOut = true; renderSettings(); break;
    case "signOutNo": OV.confirmOut = false; renderSettings(); break;
    case "signOutYes": signOut(); break;
    case "changePw": closeOv(); showGate("recover"); break;
    case "toSetup": try{ localStorage.removeItem("sansiya-mode"); }catch(e){} closeOv(); location.reload(); break;
    case "install":
      if(S.installEvt){ const e = S.installEvt; S.installEvt = null; e.prompt(); e.userChoice.finally(() => { renderChrome(); if(OV && OV.kind === "settings") renderSettings(); }); }
      break;
    case "addcat": {
      const code = ($("#c-code").value || "").trim().toUpperCase(), name = ($("#c-name").value || "").trim();
      if(!/^[A-Z0-9]{2,4}$/.test(code)){ OV.err = "코드는 영문·숫자 2~4자로 적어 주세요."; renderCats(); return; }
      if(!name){ OV.err = "이름을 적어 주세요."; renderCats(); return; }
      if(S.cats.some(c => c.code === code)){ OV.err = "이미 있는 코드예요."; renderCats(); return; }
      OV.err = ""; saveCats([...S.cats.filter(c => c.code !== "ETC"), { code, name }, ...S.cats.filter(c => c.code === "ETC")]); break;
    }
  }
});
$("#newBtn").addEventListener("click", () => openEditor(null));
$("#setBtn").addEventListener("click", () => openSettings());
$("#syncBtn").addEventListener("click", () => { if(S.B && S.B.kind !== "local") pull(); });
document.addEventListener("keydown", ev => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
  if(ev.key === "Escape" && OV){ closeOv(); return; }
  if(OV && OV.kind === "edit"){
    if((ev.metaKey || ev.ctrlKey) && ev.key === "Enter"){ ev.preventDefault(); if(!OV.busy) saveDraft(); return; }
    if(ev.target.id === "f-tag" && (ev.key === "Enter" || ev.key === ",") && !ev.isComposing){ ev.preventDefault(); syncDraft(); const v = ev.target.value; if(v.trim()){ addTag(v); renderEditor(); const t = $("#f-tag"); if(t) t.focus(); } return; }
    if(ev.target.id === "f-tag" && ev.key === "Backspace" && !ev.target.value && OV.draft.tags.length){ syncDraft(); OV.draft.tags.pop(); renderEditor(); const t = $("#f-tag"); if(t) t.focus(); return; }
    if(ev.target.id === "f-title" && ev.key === "Enter"){ ev.preventDefault(); return; }
  }
  if(ev.key === "Enter" && ev.target.matches && ev.target.matches("[data-open]")){ openDetail(ev.target.dataset.open); return; }
  if(typing || OV || ev.metaKey || ev.ctrlKey || ev.altKey || $("#app").hidden) return;
  if(ev.key === "n" || ev.key === "N" || ev.key === "ㅜ"){ ev.preventDefault(); openEditor(null); }
  else if(ev.key === "/"){ ev.preventDefault(); $("#q").focus(); }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if(t.dataset && t.dataset.showpw){ t.dataset.showpw.split(",").forEach(id => { const i = document.getElementById(id); if(i) i.type = t.checked ? "text" : "password"; }); return; }
  if(t.id === "sortSel"){ S.sort = t.value; savePrefs(); render(); }
  if(t.id === "holdSort"){ S.holdSort = t.value; savePrefs(); render(); }
  if(t.id === "dv-stock" && OV && OV.kind === "divform"){
    syncDivForm(); const s = S.stocks.find(x => x.id === OV.d.stockId);
    if(s) OV.d.currency = s.currency; else { OV.d.symbol = ""; }
    renderDivForm();
    if(OV.d.currency === "USD" && !fxRate()) refreshQuotes(true, []);
  }
  if(t.id === "f-photo" && t.files.length){ uploadPhotos(t.files); }
  if(t.id === "f-cat" && OV){ OV.draft.cat = t.value; }
  if(t.id === "importFile" && t.files.length){
    const f = t.files[0];
    f.text().then(txt => {
      let res; try{ res = parseImport(txt); }catch(e){ toast("산시야 백업 파일(JSON)이 아니에요."); return; }
      if(!res.entries.length && !res.stocks.length && !res.divs.length){ toast("가져올 기록이 없어요."); return; }
      openImport(res);
    });
  }
});
document.addEventListener("submit", ev => {
  ev.preventDefault();
  if(ev.target.id === "edForm"){ if(!OV.busy) saveDraft(); }
  else if(ev.target.id === "stForm") saveStockForm();
  else if(ev.target.id === "divForm") saveDivForm();
  else if(ev.target.id === "gateForm") gateSubmit(ev.target);
});
document.addEventListener("paste", ev => {
  if(!OV || OV.kind !== "edit") return;
  const files = [...((ev.clipboardData && ev.clipboardData.files) || [])].filter(f => f.type.startsWith("image/"));
  if(files.length){ ev.preventDefault(); uploadPhotos(files); }
});
let qT;
$("#q").addEventListener("input", ev => { clearTimeout(qT); qT = setTimeout(() => { S.filter.q = ev.target.value; if(S.view !== "archive") S.view = "archive"; render(); }, 150); });
document.addEventListener("input", ev => {
  const t = ev.target;
  if(t.id === "st-q" && OV && OV.kind === "stsearch") onStockSearchInput(t.value);
  if(t.id === "dv-amt" && OV && OV.kind === "divform"){ OV.d.amount = t.value; const h = $("#dvKrwHint"); if(h) h.textContent = dvKrwHint(); }
});
window.addEventListener("online", () => { updateSyncUI(); pull(); if(S.view === "stocks") refreshQuotes(true); });
window.addEventListener("offline", () => updateSyncUI());
document.addEventListener("visibilitychange", () => {
  if(document.visibilityState !== "visible" || !S.uid) return;
  if(Date.now() - S.lastPull > 30000) pull();
  if(S.view === "stocks" || (OV && (OV.kind === "stock" || OV.kind === "index"))) refreshQuotes();
});
setInterval(() => {
  if(S.uid && document.visibilityState === "visible" && (S.view === "stocks" || (OV && (OV.kind === "stock" || OV.kind === "index")))) refreshQuotes();
  if(OV && (OV.kind === "stock" || OV.kind === "index") && (OV.range === "1d" || OV.range === "5d") && document.visibilityState === "visible") loadHistory();
}, 60000);
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installEvt = e; if(S.uid) renderChrome(); });
window.addEventListener("appinstalled", () => { S.installEvt = null; toast("산시야를 설치했어요."); if(S.uid) renderChrome(); });

/* ---------- service worker ---------- */
if("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")){
  navigator.serviceWorker.register("sw.js").then(reg => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing; if(!w) return;
      w.addEventListener("statechange", () => {
        if(w.state === "activated" && navigator.serviceWorker.controller) toast("새 버전이 준비됐어요.", { label:"적용", fn:() => location.reload() });
      });
    });
  }).catch(() => {});
}

/* ---------- boot ---------- */
async function boot(){
  const mode = getMode();
  if(mode === "setup"){ showGate("setup"); return; }
  const cfg = getConfig();
  const B = mode === "local" ? makeLocalBackend() : makeSupabaseBackend(cfg.url, cfg.key);
  let user;
  try{ user = await B.init(); }
  catch(e){
    showGate("error", navigator.onLine ? "앱 구성 요소를 불러오지 못했어요. 잠시 후 다시 열어 주세요." : "처음 한 번은 인터넷에 연결된 상태에서 열어야 해요.");
    return;
  }
  S.B = B;
  if(user && B.recovery()){ showGate("recover"); return; }
  if(!user){
    const le = B.linkError();
    showGate("login", le ? (le === "otp_expired" ? "메일 링크가 만료됐거나 이미 사용됐어요. 이메일을 적고 ‘비밀번호를 잊으셨나요?’를 다시 눌러 주세요." : "메일 링크를 사용할 수 없어요. 다시 요청해 주세요.") : undefined);
    return;
  }
  await startApp(user);
}
async function startApp(user){
  resetState();
  S.uid = user.id; S.email = user.email || "";
  const [ents, st, ob, ls, urls, stx, dvs, qts] = await Promise.all(["entries","settings","outbox","lastSync","urls","stocks","divs","quotes"].map(n => KV.get(k(n))));
  S.entries = Array.isArray(ents) ? ents : []; S.loaded = Array.isArray(ents);
  S.stocks = Array.isArray(stx) ? stx : []; S.divs = Array.isArray(dvs) ? dvs : [];
  if(qts && qts.quotes){ S.quotes = qts.quotes; S.fx = qts.fx || null; S.quotesAt = qts.at || 0; S.market = qts.market || {}; }
  if(st && Array.isArray(st.categories) && st.categories.length) S.cats = st.categories;
  S.outbox = Array.isArray(ob) ? ob : []; S.lastSync = ls || 0;
  if(Array.isArray(urls) && S.B.kind !== "local") S.urls = new Map(urls.filter(([, c]) => c && c.url && c.exp > Date.now()));
  hideGate(); render();
  const qs = new URLSearchParams(location.search);
  if(qs.has("new")){ qs.delete("new"); history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs : "")); openEditor(null); }
  pull();
}
window.__sansiya = { S, pull, flush };
boot();
})();
