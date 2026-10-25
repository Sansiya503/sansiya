/* 산시야 — personal archive PWA
 * Data: Supabase (login, Postgres, Storage) with a local IndexedDB cache and an
 * offline outbox, or a device-only local mode (?demo or "이 기기에만 저장").
 */
(() => {
"use strict";

const APP_VERSION = "1.13.2";
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
  },
  photos: {
    order: ["date", false],
    from: r => ({ id:r.id, path:r.path, thumb:r.thumb || "", date:r.date, caption:r.caption || "", w:+r.width || 0, h:+r.height || 0,
      topics:Array.isArray(r.topics) ? r.topics : [], createdAt:Date.parse(r.created_at) || 0, updatedAt:Date.parse(r.updated_at) || 0 }),
    to: (p, uid) => ({ id:p.id, user_id:uid, path:p.path, thumb:p.thumb || "", date:p.date, caption:p.caption || "", width:p.w || null, height:p.h || null,
      topics:p.topics || [], created_at:isoT(p.createdAt), updated_at:isoT(p.updatedAt) })
  },
  bookmarks: {
    order: ["created_at", false],
    from: r => ({ id:r.id, kind:r.kind || "link", ref:r.ref || "", url:r.url || "", title:r.title || "", memo:r.memo || "", tags:Array.isArray(r.tags) ? r.tags : [],
      createdAt:Date.parse(r.created_at) || 0, updatedAt:Date.parse(r.updated_at) || 0 }),
    to: (b, uid) => ({ id:b.id, user_id:uid, kind:b.kind || "link", ref:b.ref || "", url:b.url || "", title:b.title || "", memo:b.memo || "", tags:b.tags || [],
      created_at:isoT(b.createdAt), updated_at:isoT(b.updatedAt) })
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
  holdSort:"value", holdShow:"value", hideAmt:false,
  photos:[], bookmarks:[], albumMissing:false, phBusy:0, phQ:"", phFav:false, phTopic:"all", phLimit:100, bmTab:"links", bmTag:null, bmLoading:new Set(), snsTopic:"all"
};
try{ const p = JSON.parse(localStorage.getItem("sansiya-prefs") || "{}"); if(p.layout) S.layout = p.layout; if(p.sort) S.sort = p.sort; if(p.holdSort) S.holdSort = p.holdSort; if(p.holdShow) S.holdShow = p.holdShow; if(p.hideAmt) S.hideAmt = true; if(p.bmTab === "favs") S.bmTab = "favs"; if(p.phTopic) S.phTopic = p.phTopic; if(p.snsTopic) S.snsTopic = p.snsTopic; }catch(e){}
function savePrefs(){ try{ localStorage.setItem("sansiya-prefs", JSON.stringify({ layout:S.layout, sort:S.sort, holdSort:S.holdSort, holdShow:S.holdShow, hideAmt:S.hideAmt, bmTab:S.bmTab, phTopic:S.phTopic, snsTopic:S.snsTopic })); }catch(e){} }
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
          if(op.files && op.files.length) await S.B.removePhotos(op.files).catch(() => {});
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
    const opt = t => S.B.fetchRows(t).catch(e => missingTable(e) ? null : Promise.reject(e));
    const [rows, st, stocks, divs, photos, bms] = await Promise.all([S.B.fetchEntries(), S.B.fetchSettings(), S.B.fetchRows("stocks"), S.B.fetchRows("dividends"), opt("photos"), opt("bookmarks")]);
    if(S.outbox.length){ setSync("idle"); return; }
    S.entries = rows; S.stocks = stocks; S.divs = divs;
    S.albumMissing = !photos || !bms;
    if(photos){ S.photos = photos; savePhotos(); }
    if(bms){ S.bookmarks = bms; saveBookmarks(); }
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
  if(S.view === "archive" || S.view === "calendar" || S.view === "stocks" || S.view === "photos" || S.view === "bookmarks") render();
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
  if(t && t.classList && (t.classList.contains("st-logo") || t.classList.contains("bm-fav"))){ t.remove(); return; }
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
// the calendar view (calendarHtml) is kept in the code but hidden from the menu for now;
// put ["calendar","캘린더"] back here to bring it back
const VIEWS = [["archive","아카이브"],["stats","통계 · 회고"],["stocks","주식"],["bitcoin","비트코인"],["photos","사진"],["sns","SNS"],["bookmarks","북마크"]];
// round badge icons for the top menu, in the same style as the bitcoin coin (colour disc + white mark)
const VIEW_ICONS = {
  archive:`<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="#3D7BFA"/><g fill="#fff"><rect x="15" y="16.5" width="34" height="9.5" rx="3"/><path d="M18 28.5h28v14.5a4.5 4.5 0 0 1-4.5 4.5h-19A4.5 4.5 0 0 1 18 43z"/></g><rect x="26" y="32.5" width="12" height="4" rx="2" fill="#3D7BFA"/></svg>`,
  stats:`<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="#8A63F2"/><g fill="#fff"><rect x="16" y="33" width="8.5" height="14" rx="2.5"/><rect x="27.75" y="24" width="8.5" height="23" rx="2.5"/><rect x="39.5" y="16" width="8.5" height="31" rx="2.5"/></g></svg>`,
  stocks:`<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="#F04452"/><g fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 43.5 26.5 32l7.5 7.5L47.5 26"/><path d="M38 24.5h10.5V35"/></g></svg>`,
  photos:`<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="#20B46B"/><rect x="15" y="18" width="34" height="28" rx="5" fill="#fff"/><path d="M19 42l8.5-10 6 7 4-4.5L45 42z" fill="#20B46B"/><circle cx="40.5" cy="26" r="3.6" fill="#20B46B"/></svg>`,
  sns:`<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="31.25" fill="#0F1419" stroke="#5B6670" stroke-width="1.5"/><path d="M23 17.5h18a8 8 0 0 1 8 8v8a8 8 0 0 1-8 8H30l-8.5 6.5 1.8-6.6A8 8 0 0 1 15 33.5v-8a8 8 0 0 1 8-8z" fill="#fff"/><g fill="#0F1419"><circle cx="24.5" cy="29.5" r="2.7"/><circle cx="32" cy="29.5" r="2.7"/><circle cx="39.5" cy="29.5" r="2.7"/></g></svg>`,
  bookmarks:`<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="#E5468E"/><path d="M22 15.5h20a3 3 0 0 1 3 3V49l-13-8.5L19 49V18.5a3 3 0 0 1 3-3z" fill="#fff"/></svg>`
};
const viewIcon = v => VIEW_ICONS[v] || (v === "bitcoin" ? BT_COIN : "");
function renderChrome(){
  $("#tabbar").innerHTML = VIEWS.map(([v, l]) => `<button type="button" data-view="${v}" aria-current="${S.view === v}"><span class="tb-ic">${viewIcon(v)}</span><span class="tb-l">${l}</span></button>`).join("");
  updateSyncUI();
}

/* ---------- render: views ---------- */
function render(){
  renderChrome();
  const m = $("#main");
  if(S.view === "archive") m.innerHTML = archiveHtml();
  else if(S.view === "calendar") m.innerHTML = calendarHtml();
  else if(S.view === "stocks"){ m.innerHTML = stocksHtml(); bindTips(m); bindDonut(m); }
  else if(S.view === "bitcoin"){
    // keep the calculator input (and its cursor) when a background refresh re-renders
    const a = document.activeElement;
    if(m.querySelector(".bt-wrap") && a && a.tagName === "INPUT" && m.contains(a)) btPaintLive();
    else { m.innerHTML = bitcoinHtml(); bindBtChart(); }
  }
  else if(S.view === "photos"){
    const a = document.activeElement;
    if(m.querySelector(".ph") && a && a.id === "phQ") setH("phBody", phBodyHtml());
    else m.innerHTML = photosHtml();
    bindPhotoMore();
  }
  else if(S.view === "sns"){ m.innerHTML = snsHtml(); bindSnsMore(); snsLoad(); }
  else if(S.view === "bookmarks"){ m.innerHTML = bookmarksHtml(); if(S.bmTab === "favs" && favItems().stocks.length) refreshQuotes(); }
  else m.innerHTML = statsHtml();
  if(S.view === "bitcoin") btStart(); else btStop();
  document.body.dataset.view = S.view;
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

/* ---------- stocks: allocation (donut + list, in the style of an asset-mix card) ---------- */
// contrasting colours that go around the ring in an order checked for colour-blind and normal vision
// (every neighbouring pair, both themes); the biggest holding is always blue. Hex values live in styles.css.
const DONUT_RINGS = {
  1:["blue"], 2:["blue", "green"], 3:["blue", "pink", "green"], 4:["blue", "green", "violet", "red"],
  5:["blue", "pink", "green", "violet", "red"], 6:["blue", "aqua", "violet", "green", "cyan", "red"],
  7:["blue", "aqua", "violet", "red", "cyan", "green", "pink"]
};
// biggest first, clockwise from 12 o'clock; past the 7th holding the rest share one grey "기타" slice
function allocSlices(P){
  const rows = P.rows.map(({ s, p }) => ({ name:s.name, v:p.valueKRW || 0, ids:[s.id] })).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
  let sl = rows;
  if(rows.length > 8){
    const rest = rows.slice(7);
    sl = [...rows.slice(0, 7), { name:"기타", count:rest.length, v:rest.reduce((a, r) => a + r.v, 0), ids:rest.flatMap(r => r.ids), other:true }];
  }
  const tot = sl.reduce((a, r) => a + r.v, 0) || 1, pal = DONUT_RINGS[Math.min(7, sl.filter(x => !x.other).length) || 1];
  let k = 0;
  sl.forEach(r => { r.pct = r.v / tot * 100; r.color = r.other ? "var(--donut-other)" : `var(--dn-${pal[k++]})`; });
  return sl;
}
function donutSvg(P, sl){
  const S0 = 240, c = S0 / 2, R = 112, r = 74, TAU = Math.PI * 2, f = n => n.toFixed(2);
  const pt = (rad, a) => [c + rad * Math.sin(a), c - rad * Math.cos(a)];
  let a0 = 0;
  const paths = sl.map((x, i) => {
    const a1 = a0 + x.pct / 100 * TAU; let d;
    if(sl.length === 1) d = `M${c} ${c - R}A${R} ${R} 0 1 1 ${f(c - 0.01)} ${c - R}ZM${c} ${c - r}A${r} ${r} 0 1 0 ${f(c + 0.01)} ${c - r}Z`;
    else {
      const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r, a1), [x3, y3] = pt(r, a0), large = a1 - a0 > Math.PI ? 1 : 0;
      d = `M${f(x0)} ${f(y0)}A${R} ${R} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r} ${r} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
    }
    a0 = a1;
    return `<path class="ds" data-slice="${i}" d="${d}" fill="${x.color}" stroke="var(--surface)" stroke-width="2" stroke-linejoin="round"/>`;
  }).join("");
  const summary = sl.map(x => `${x.name} ${x.pct.toFixed(1)}%`).join(", ");
  return `<svg viewBox="0 0 ${S0} ${S0}" role="img" aria-label="종목 비중: ${esc(summary)}">${paths}
    <text x="${c}" y="${c - 8}" text-anchor="middle" class="dc1" id="dcTop">평가금액</text>
    <text x="${c}" y="${c + 18}" text-anchor="middle" class="dc2" id="dcBig">${esc(S.hideAmt ? "••••원" : fmtShort(P.value) + "원")}</text>
  </svg>`;
}
function allocHtml(P){
  const sl = allocSlices(P); if(!sl.length) return "";
  const rows = sl.map((x, i) => {
    const inner = `<i style="background:${x.color}"></i><span class="nm">${esc(x.name)}${x.other ? `<small>${x.count}종목</small>` : ""}</span><b>${x.pct.toFixed(1)}%</b>`;
    return x.other ? `<div class="st-lg" data-slice="${i}">${inner}</div>`
      : `<button type="button" class="st-lg" data-slice="${i}" data-stock="${esc(x.ids[0])}">${inner}</button>`;
  }).join("");
  return `<section class="st-sec">
    <div class="st-sec-h"><h3>종목 비중</h3></div>
    <div class="st-mix" id="stDonut"><div class="st-mix-d">${donutSvg(P, sl)}</div><div class="st-mix-l">${rows}</div></div>
  </section>`;
}
// hovering (or touching) a slice or a list row lights up both and shows that holding in the middle
function bindDonut(root){
  const box = root && root.querySelector("#stDonut"); if(!box) return;
  const P = portfolio(), sl = allocSlices(P), top = box.querySelector("#dcTop"), big = box.querySelector("#dcBig");
  const reset = () => { box.classList.remove("hl"); box.querySelectorAll(".on").forEach(e => e.classList.remove("on"));
    top.textContent = "평가금액"; big.textContent = S.hideAmt ? "••••원" : fmtShort(P.value) + "원"; };
  const show = i => { const x = sl[i]; if(!x) return; reset(); box.classList.add("hl");
    box.querySelectorAll(`[data-slice="${i}"]`).forEach(e => e.classList.add("on"));
    top.textContent = x.name.length > 9 ? x.name.slice(0, 8) + "…" : x.name; big.textContent = x.pct.toFixed(1) + "%"; };
  box.querySelectorAll("[data-slice]").forEach(e => e.addEventListener("pointerenter", () => show(+e.dataset.slice)));
  box.querySelectorAll(".ds").forEach(e => e.addEventListener("pointerdown", () => show(+e.dataset.slice)));
  box.addEventListener("pointerleave", reset);
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
  const alloc = P.rows.length > 1 && P.value > 0 ? allocHtml(P) : "";
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
      <div class="sp">${favBtn("stock", s.id)}<button class="btn small" type="button" data-act="stEdit">편집</button><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
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
  S.stocks = S.stocks.filter(x => x.id !== s.id); saveStocks(); dropFavs("stock", s.id);
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
      <div class="sp">${favBtn("entry", e.id)}<button class="btn small" type="button" data-act="edit">편집</button><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
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
  S.entries = S.entries.filter(x => x.id !== id); saveCache(); dropFavs("entry", id);
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
  S.photos = []; S.bookmarks = []; S.albumMissing = false; S.phBusy = 0; S.bmTag = null; S.bmLoading = new Set();
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
  const data = JSON.stringify({ app:"sansiya", version:APP_VERSION, exportedAt:new Date().toISOString(), categories:S.cats, entries:S.entries, stocks:S.stocks, dividends:S.divs, photos:S.photos, bookmarks:S.bookmarks }, null, 2);
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
  const src = Array.isArray(j) ? j : (Array.isArray(j.entries) ? j.entries : (Array.isArray(j.stocks) || Array.isArray(j.dividends) || Array.isArray(j.bookmarks) || Array.isArray(j.photos) ? [] : null));
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
  const now2 = Date.now();
  const photos = (Array.isArray(j.photos) ? j.photos : []).filter(r => r && typeof r.path === "string" && S.uid && r.path.startsWith(S.uid + "/") && !S.photos.some(p => p.path === r.path))
    .map(r => ({ id:isUuid(r.id) ? r.id : uuid(), path:r.path, thumb:typeof r.thumb === "string" && r.thumb.startsWith(S.uid + "/") ? r.thumb : r.path, date:/^\d{4}-\d{2}-\d{2}$/.test(r.date || "") ? r.date : today(),
      caption:String(r.caption || "").slice(0, 500), w:+r.w || 0, h:+r.h || 0, topics:Array.isArray(r.topics) ? r.topics.filter(x => PH_TOPIC_KEYS.includes(x)) : [], createdAt:+r.createdAt || now2, updatedAt:+r.updatedAt || now2 }));
  const bookmarks = (Array.isArray(j.bookmarks) ? j.bookmarks : []).filter(r => r && ["link","entry","stock","photo"].includes(r.kind))
    .filter(r => r.kind === "link" ? normUrl(r.url) && !S.bookmarks.some(b => b.kind === "link" && b.url === normUrl(r.url)) : r.ref && !S.bookmarks.some(b => b.kind === r.kind && b.ref === r.ref))
    .map(r => ({ id:isUuid(r.id) ? r.id : uuid(), kind:r.kind, ref:String(r.ref || ""), url:r.kind === "link" ? normUrl(r.url) : "", title:String(r.title || "").slice(0, 200), memo:String(r.memo || "").slice(0, 1000),
      tags:Array.isArray(r.tags) ? r.tags.map(String).slice(0, 20) : [], createdAt:+r.createdAt || now2, updatedAt:+r.updatedAt || now2 }));
  return { entries:out, cats, dropped, overwrite:out.filter(e => existing.has(e.id)).length, stocks, divs, photos, bookmarks };
}
function openImport(res){ if(OV) endOvKeepHistory(); OV = { kind:"import", res }; renderImport(); }
function renderImport(){
  const r = OV.res;
  showOv(`<div class="sheetbox" role="dialog" aria-modal="true" aria-label="가져오기">
    <div class="sb-head"><span class="ttl">백업 가져오기</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body prose">
      <p style="margin:0;font-size:15px">${[r.entries.length ? `기록 <b>${r.entries.length}건</b>` : "", r.stocks.length ? `종목 <b>${r.stocks.length}개</b>` : "", r.divs.length ? `배당 <b>${r.divs.length}건</b>` : "", r.photos.length ? `사진 <b>${r.photos.length}장</b>` : "", r.bookmarks.length ? `북마크 <b>${r.bookmarks.length}개</b>` : ""].filter(Boolean).join(", ")}을 가져올까요?</p>
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
  if(r.photos.length){ S.photos = [...S.photos, ...r.photos]; savePhotos(); for(const x of r.photos) enqueue({ op:"row", table:"photos", rec:x }); }
  if(r.bookmarks.length){ S.bookmarks = [...S.bookmarks, ...r.bookmarks]; saveBookmarks(); for(const x of r.bookmarks) enqueue({ op:"row", table:"bookmarks", rec:x }); }
  render(); toast([r.entries.length ? `기록 ${r.entries.length}건` : "", r.stocks.length ? `종목 ${r.stocks.length}개` : "", r.divs.length ? `배당 ${r.divs.length}건` : "", r.photos.length ? `사진 ${r.photos.length}장` : "", r.bookmarks.length ? `북마크 ${r.bookmarks.length}개` : ""].filter(Boolean).join(", ") + "을 가져왔어요.");
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

/* ---------- photo album ---------- */
const savePhotos = () => KV.set(k("photos"), S.photos);
const saveBookmarks = () => KV.set(k("bookmarks"), S.bookmarks);
const photoById = id => S.photos.find(p => p.id === id);
const photosSorted = () => S.photos.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
const missingTable = e => /PGRST205|42P01|does not exist|schema cache|Could not find the table/i.test(`${e && e.code || ""} ${e && e.message || e || ""}`);

// JPEG "date taken" (EXIF DateTimeOriginal), so photos land on the day they were shot
async function exifDate(file){
  if(!/jpe?g/i.test(file.type || "") && !/\.jpe?g$/i.test(file.name || "")) return null;
  try{
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if(v.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while(off + 4 < v.byteLength){
      const marker = v.getUint16(off), len = v.getUint16(off + 2);
      if(marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966){
        const t = off + 10, le = v.getUint16(t) === 0x4949;
        const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
        const str = (o, n) => { let s = ""; for(let i = 0; i < n; i++){ const c = v.getUint8(t + o + i); if(!c) break; s += String.fromCharCode(c); } return s; };
        const find = (ifd, tag) => { const n = u16(ifd); for(let i = 0; i < n; i++){ const e = ifd + 2 + i * 12; if(u16(e) === tag) return e; } return -1; };
        const ifd0 = u32(4); let s = "";
        const ex = find(ifd0, 0x8769);
        if(ex >= 0){ const d = find(u32(ex + 8), 0x9003); if(d >= 0) s = str(u32(d + 8), 19); }
        if(!s){ const d = find(ifd0, 0x0132); if(d >= 0) s = str(u32(d + 8), 19); }
        const m = /^(\d{4}):(\d\d):(\d\d)/.exec(s);
        return m && +m[1] > 1990 && +m[2] >= 1 && +m[2] <= 12 ? `${m[1]}-${m[2]}-${m[3]}` : null;
      }
      if((marker & 0xFF00) !== 0xFF00) break;
      off += 2 + len;
    }
  }catch(e){}
  return null;
}
async function photoDate(f){ return (await exifDate(f)) || (f.lastModified ? ymd(new Date(f.lastModified)) : today()); }
// size + a small square-ish preview for the grid
async function photoThumb(file){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)) return { w:0, h:0, thumb:null };
  try{
    const bmp = await createImageBitmap(file), w = bmp.width, h = bmp.height;
    const sc = Math.min(1, 420 / Math.min(w, h));
    if(sc === 1 && file.size < 120e3) return { w, h, thumb:null };
    const cv = document.createElement("canvas"); cv.width = Math.round(w * sc); cv.height = Math.round(h * sc);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    let b = await new Promise(r => cv.toBlob(r, "image/webp", .8));
    if(!b || b.type !== "image/webp") b = await new Promise(r => cv.toBlob(r, "image/jpeg", .82));
    return { w, h, thumb:b };
  }catch(e){ return { w:0, h:0, thumb:null }; }
}
async function uploadAlbum(files){
  if(!S.B) return;
  if(S.B.kind !== "local" && !navigator.onLine){ toast("사진은 인터넷에 연결되어 있을 때 올릴 수 있어요."); return; }
  if(S.albumMissing){ toast("사진 저장 공간을 준비하는 중이에요. 잠시 뒤 다시 올려 주세요."); return; }
  const list = [...files].filter(f => /^image\//.test(f.type) || !f.type).slice(0, 40);
  if(!list.length){ toast("사진 파일만 올릴 수 있어요."); return; }
  S.phBusy += list.length; if(S.view === "photos") render();
  let ok = 0, fail = "";
  const one = async f => {
    try{
      if(/heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || "")) throw { code:"heic" };
      const [date, main] = await Promise.all([photoDate(f), shrink(f)]);
      if(main.size > 20 * 1024 * 1024) throw { code:"big" };
      const { w, h, thumb:tb } = await photoThumb(main);
      const path = await S.B.uploadPhoto(main);
      let thumb = path;
      if(tb){ try{ thumb = await S.B.uploadPhoto(tb); }catch(e){ thumb = path; } }
      if(S.B.kind !== "local"){
        S.urls.set(path, { url:URL.createObjectURL(main), exp:Date.now() + 3600e3 });
        if(tb && thumb !== path) S.urls.set(thumb, { url:URL.createObjectURL(tb), exp:Date.now() + 3600e3 });
      }
      const now = Date.now(), rec = { id:uuid(), path, thumb, date, caption:"", w, h, topics:PH_TOPIC_KEYS.includes(S.phTopic) ? [S.phTopic] : [], createdAt:now, updatedAt:now };
      S.photos.push(rec); savePhotos(); ok++;
      enqueue({ op:"row", table:"photos", rec });
    }catch(err){
      const m = String(err && (err.message || "") || "");
      fail = err && err.code === "heic" ? "HEIC 사진은 JPG로 바꿔서 올려 주세요."
        : err && err.code === "big" || /size|too large|exceed/i.test(m) ? "20MB가 넘는 사진은 올릴 수 없어요."
        : isNetErr(err) ? "인터넷 연결이 끊겨 일부를 올리지 못했어요." : "일부 사진을 올리지 못했어요.";
    }finally{ S.phBusy = Math.max(0, S.phBusy - 1); if(S.view === "photos") render(); }
  };
  for(let i = 0; i < list.length; i += 3) await Promise.all(list.slice(i, i + 3).map(one));
  toast(ok ? `사진 ${ok}장을 올렸어요.${fail ? " " + fail : ""}` : (fail || "사진을 올리지 못했어요."));
}
const PH_ICON = {
  search:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"/><path d="m20.5 20.5-5-5"/></svg>`,
  add:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 7.5v9M7.5 12h9"/></svg>`,
  mark:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-5.6L5 21V4.5a1 1 0 0 1 1-1z"/></svg>`
};
// what the search box matches: caption + the date written several ways (2024, 2024.05, 2024년 5월, 5월 17일)
function phMatches(p, q){
  const [y, m, d] = String(p.date || "").split("-");
  const hay = [p.caption || "", fmtDate(p.date), `${y}`, `${y}.${m}`, `${y}-${m}`, `${y}년 ${+m}월`, `${+m}월 ${+d}일`, `${+m}월`].join(" ").toLowerCase();
  return q.split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}
const PH_TOPICS = [["all","All"],["travel","여행"],["food","음식"],["design","디자인"],["arch","건축"],["landscape","조경"],["interior","인테리어"]];
const PH_TOPIC_KEYS = PH_TOPICS.slice(1).map(t => t[0]);
const phTopicName = k => (PH_TOPICS.find(t => t[0] === k) || [k, k])[1];
const PH_PAGE = 100; // tiles added per scroll step
// All = every photo (whatever topics it has, and ones not sorted yet); a topic = only photos saved to it
function phList(){
  const q = S.phQ.trim().toLowerCase(), tp = PH_TOPIC_KEYS.includes(S.phTopic) ? S.phTopic : null;
  return photosSorted().filter(p => (!tp || (p.topics || []).includes(tp)) && (!S.phFav || isFav("photo", p.id)) && (!q || phMatches(p, q)));
}
function phTileHtml(p){
  return `<button type="button" class="ph-tile" data-photo="${esc(p.id)}" aria-label="${esc(fmtDate(p.date))} 사진${p.caption ? ": " + esc(p.caption) : ""}">${imgTag(p.thumb || p.path)}${isFav("photo", p.id) ? `<i class="ph-star" aria-hidden="true">${PH_ICON.mark}</i>` : ""}${p.caption ? `<span class="ph-hover" aria-hidden="true">${esc(p.caption)}</span>` : ""}</button>`;
}
function photosHtml(){
  return `<div class="ph">
    <div class="ph-head"><div class="ph-bar">
      <label class="ph-search">${PH_ICON.search}<input id="phQ" type="search" placeholder="검색" value="${esc(S.phQ)}" autocomplete="off" enterkeyhint="search" aria-label="사진 설명이나 날짜로 검색"></label>
      <label class="ph-ic ph-add" title="사진 올리기"><input type="file" id="phFile" accept="image/*" multiple hidden aria-label="사진 올리기">${PH_ICON.add}</label>
      <button type="button" class="ph-ic ph-mark" data-act="phFav" aria-pressed="${S.phFav}" aria-label="즐겨찾기한 사진만 보기" title="즐겨찾기한 사진만">${PH_ICON.mark}</button>
    </div>
    <div class="ph-topics" role="group" aria-label="사진 주제">${PH_TOPICS.map(([k, l]) => `<button type="button" data-phtopic="${k}" aria-pressed="${S.phTopic === k || (k === "all" && !PH_TOPIC_KEYS.includes(S.phTopic))}">${l}</button>`).join("")}</div></div>
    <div id="phBody">${phBodyHtml()}</div>
  </div>`;
}
function phBodyHtml(){
  const list = phList(), q = S.phQ.trim(), tp = PH_TOPIC_KEYS.includes(S.phTopic) ? S.phTopic : null;
  const waiting = Array.from({ length:S.phBusy }, () => `<div class="ph-tile ph-wait" aria-hidden="true"></div>`).join("");
  const status = S.phBusy ? `<p class="ph-busy" role="status"><i></i>사진 ${S.phBusy}장 올리는 중…${tp ? ` ‘${phTopicName(tp)}’에 넣을게요.` : ""}</p>` : "";
  if(!list.length && !S.phBusy){
    if(!S.photos.length) return `<div class="empty ph-empty"><h3>아직 사진이 없어요</h3><p>위쪽 ＋를 눌러 사진을 올려 보세요.${matchMedia("(hover:hover)").matches ? " 이 화면에 끌어다 놓아도 돼요." : ""} 주제를 고른 채로 올리면 그 주제에 바로 들어가요.</p></div>`;
    if(q) return `<div class="empty ph-empty"><h3>‘${esc(q)}’에 맞는 사진이 없어요</h3><p>설명에 쓴 낱말이나 2024.05, 5월 17일처럼 날짜로 찾아보세요.${tp ? ` 지금은 ‘${phTopicName(tp)}’ 안에서만 찾고 있어요.` : ""}</p></div>`;
    if(S.phFav) return `<div class="empty ph-empty"><h3>즐겨찾기한 ${tp ? `‘${phTopicName(tp)}’ ` : ""}사진이 없어요</h3><p>사진을 크게 연 뒤 ☆를 누르면 여기에 모여요.</p></div>`;
    return `<div class="empty ph-empty"><h3>‘${phTopicName(tp)}’ 사진이 아직 없어요</h3><p>이 주제를 고른 채로 ＋를 눌러 올리거나, 사진을 크게 열고 편집에서 주제를 골라 주세요.</p></div>`;
  }
  const shown = Math.min(list.length, Math.max(S.phLimit, PH_PAGE));
  const label = [tp ? `‘${phTopicName(tp)}’` : "", q ? `‘${esc(q)}’` : "", S.phFav ? "즐겨찾기" : ""].filter(Boolean).join(" · ");
  return `${status}<div class="ph-grid ph-insta" id="phGrid">${waiting}${list.slice(0, shown).map(phTileHtml).join("")}</div>
    ${shown < list.length ? `<div class="ph-more" id="phMore" aria-hidden="true"><i></i></div>` : `<p class="ph-count">${label ? label + " " : ""}사진 ${list.length}장</p>`}`;
}
// endless scroll: add the next rows when the bottom comes into view
let phIO = null;
function bindPhotoMore(){
  if(phIO){ phIO.disconnect(); phIO = null; }
  const more = document.getElementById("phMore"); if(!more || !("IntersectionObserver" in window)) return;
  phIO = new IntersectionObserver(ents => {
    if(!ents.some(e => e.isIntersecting)) return;
    const list = phList(), grid = document.getElementById("phGrid"); if(!grid) return;
    const from = grid.querySelectorAll(".ph-tile:not(.ph-wait)").length, to = Math.min(list.length, from + PH_PAGE);
    S.phLimit = to;
    grid.insertAdjacentHTML("beforeend", list.slice(from, to).map(phTileHtml).join(""));
    hydrateImages();
    if(to >= list.length){
      phIO.disconnect(); phIO = null;
      more.outerHTML = `<p class="ph-count">사진 ${list.length}장</p>`;
    }
  }, { rootMargin:"900px 0px" });
  phIO.observe(more);
}
function phSetTopic(k){
  S.phTopic = PH_TOPIC_KEYS.includes(k) ? k : "all"; S.phLimit = PH_PAGE; savePrefs();
  document.querySelectorAll(".ph-topics [data-phtopic]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.phtopic === S.phTopic)));
  const chip = document.querySelector(`.ph-topics [data-phtopic="${S.phTopic}"]`); if(chip && chip.scrollIntoView) chip.scrollIntoView({ block:"nearest", inline:"nearest" });
  setH("phBody", phBodyHtml()); bindPhotoMore(); hydrateImages();
}
function openPhoto(id){
  if(!photoById(id)) return;
  const ids = (S.view === "photos" ? phList() : S.view === "bookmarks" ? favItems().photos : photosSorted()).map(p => p.id);
  if(OV) endOvKeepHistory(); OV = { kind:"photo", id, ids:ids.includes(id) ? ids : [id], edit:false, confirm:false }; renderPhoto();
}
const pvList = () => (OV && OV.ids ? OV.ids.map(photoById).filter(Boolean) : photosSorted());
function renderPhoto(){
  const list = pvList(), i = list.findIndex(p => p.id === OV.id), p = list[i];
  if(!p){ closeOv(); return; }
  const fav = isFav("photo", p.id);
  const foot = OV.confirm
    ? `<div class="pv-confirm"><span>이 사진을 지울까요? 지우면 되돌릴 수 없어요.</span><button class="btn small danger" type="button" data-act="phDelYes">지우기</button><button class="btn small" type="button" data-act="phDelNo">취소</button></div>`
    : OV.edit
    ? `<form class="pv-edit" id="phForm"><div class="pv-tps" role="group" aria-label="주제">${PH_TOPICS.slice(1).map(([k, l]) => `<button type="button" class="pv-tp" data-pvtopic="${k}" aria-pressed="${(p.topics || []).includes(k)}">${l}</button>`).join("")}</div><label>날짜<input type="date" id="ph-date" value="${esc(p.date)}" required></label><label class="cap">설명<textarea id="ph-cap" rows="2" maxlength="500" placeholder="어떤 사진인지 적어 두세요">${esc(p.caption || "")}</textarea></label><div class="acts"><button class="btn small" type="button" data-act="phEditNo">취소</button><button class="btn small primary" type="submit">저장</button></div></form>`
    : `${(p.topics || []).length ? `<div class="pv-tags">${p.topics.filter(k => PH_TOPIC_KEYS.includes(k)).map(k => `<button type="button" data-phgo="${k}">#${phTopicName(k)}</button>`).join("")}</div>` : ""}${p.caption ? `<p class="pv-cap">${linkify(p.caption)}</p>` : `<button class="pv-addcap" type="button" data-act="phEdit">+ ${(p.topics || []).length ? "설명 추가" : "주제·설명 추가"}</button>`}`;
  showOv(`<div class="pv" role="dialog" aria-modal="true" aria-label="사진 크게 보기">
    <div class="pv-top">
      <button class="pv-btn" type="button" data-act="close" aria-label="닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="pv-meta"><b>${esc(fmtDate(p.date))}</b><span>${i + 1} / ${list.length}</span></div>
      <button class="pv-btn fav-btn" type="button" data-fav="photo:${esc(p.id)}" aria-pressed="${fav}" aria-label="즐겨찾기">${fav ? "★" : "☆"}</button>
      <button class="pv-btn" type="button" data-act="phEdit" aria-label="날짜·설명 편집"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg></button>
      <button class="pv-btn" type="button" data-act="phDel" aria-label="사진 지우기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg></button>
    </div>
    <div class="pv-stage" id="pvStage">
      ${i > 0 ? `<button class="pv-nav prev" type="button" data-phnav="-1" aria-label="이전 사진">‹</button>` : ""}
      <img data-path="${esc(p.path)}" ${purl(p.path) ? `src="${esc(purl(p.path))}"` : purl(p.thumb) ? `src="${esc(purl(p.thumb))}" data-low="1"` : ""} alt="${esc(p.caption || fmtDate(p.date) + " 사진")}">
      ${i < list.length - 1 ? `<button class="pv-nav next" type="button" data-phnav="1" aria-label="다음 사진">›</button>` : ""}
    </div>
    <div class="pv-foot">${foot}</div>
  </div>`);
  // the preview shows first; swap in the full photo once its link is signed
  const img = document.querySelector("#pvStage img");
  if(img && img.dataset.low) ensureUrls([p.path]).then(() => { const u = purl(p.path); if(u && img.isConnected){ img.src = u; delete img.dataset.low; } });
  bindPhotoSwipe();
}
function phNav(d){
  const list = pvList(), i = list.findIndex(p => p.id === OV.id), j = i + d;
  if(i < 0 || j < 0 || j >= list.length) return;
  OV.id = list[j].id; OV.edit = false; OV.confirm = false; renderPhoto();
}
function bindPhotoSwipe(){
  const st = document.getElementById("pvStage"); if(!st) return;
  let x0 = null, y0 = 0;
  st.addEventListener("pointerdown", e => { if(e.target.closest("button")) return; x0 = e.clientX; y0 = e.clientY; });
  st.addEventListener("pointerup", e => {
    if(x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if(Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) phNav(dx < 0 ? 1 : -1);
  });
}
function savePhotoEdit(){
  const p = photoById(OV.id); if(!p) return;
  const date = ($("#ph-date") || {}).value || p.date, caption = (($("#ph-cap") || {}).value || "").trim().slice(0, 500);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){ toast("날짜를 확인해 주세요."); return; }
  const topics = [...document.querySelectorAll("#phForm [data-pvtopic][aria-pressed=true]")].map(b => b.dataset.pvtopic);
  const rec = { ...p, date, caption, topics, updatedAt:Date.now() };
  S.photos = S.photos.map(x => x.id === p.id ? rec : x); savePhotos();
  OV.edit = false; renderPhoto(); if(S.view === "photos") render();
  enqueue({ op:"row", table:"photos", rec });
}
function deletePhoto(){
  const list = pvList(), i = list.findIndex(x => x.id === OV.id), p = list[i]; if(!p) return;
  const next = list[i + 1] || list[i - 1];
  S.photos = S.photos.filter(x => x.id !== p.id); savePhotos();
  if(OV.ids) OV.ids = OV.ids.filter(x => x !== p.id);
  dropFavs("photo", p.id);
  enqueue({ op:"rowdel", table:"photos", id:p.id, files:[...new Set([p.path, p.thumb].filter(Boolean))] });
  if(next){ OV.id = next.id; OV.confirm = false; OV.edit = false; renderPhoto(); } else closeOv();
  if(S.view === "photos" || S.view === "bookmarks") render();
  toast("사진을 지웠어요.");
}

/* ---------- bookmarks: web links + in-app favourites ---------- */
const favOf = (kind, ref) => S.bookmarks.find(b => b.kind === kind && b.ref === ref);
const isFav = (kind, ref) => !!favOf(kind, ref);
const favBtn = (kind, ref) => { const on = isFav(kind, ref); return `<button class="btn small fav-btn" type="button" data-fav="${kind}:${esc(ref)}" aria-pressed="${on}" aria-label="즐겨찾기">${on ? "★" : "☆"}<span class="fav-l">즐겨찾기</span></button>`; };
function putBookmark(rec){
  const i = S.bookmarks.findIndex(b => b.id === rec.id);
  if(i >= 0) S.bookmarks[i] = rec; else S.bookmarks.push(rec);
  saveBookmarks(); enqueue({ op:"row", table:"bookmarks", rec });
}
function dropBookmark(id){
  if(!S.bookmarks.some(b => b.id === id)) return;
  S.bookmarks = S.bookmarks.filter(b => b.id !== id); saveBookmarks();
  enqueue({ op:"rowdel", table:"bookmarks", id });
}
function dropFavs(kind, ref){ S.bookmarks.filter(b => b.kind === kind && b.ref === ref).forEach(b => dropBookmark(b.id)); }
function toggleFav(kind, ref){
  const b = favOf(kind, ref), now = Date.now();
  if(b){ dropBookmark(b.id); toast("즐겨찾기에서 뺐어요."); }
  else { putBookmark({ id:uuid(), kind, ref, url:"", title:"", memo:"", tags:[], createdAt:now, updatedAt:now }); toast("즐겨찾기에 담았어요. 북마크 메뉴에서 모아 볼 수 있어요."); }
  const on = isFav(kind, ref);
  document.querySelectorAll(`[data-fav="${kind}:${CSS.escape(ref)}"]`).forEach(btn => {
    btn.setAttribute("aria-pressed", String(on));
    if(btn.firstChild) btn.firstChild.textContent = on ? "★" : "☆";
  });
  if(S.view === "photos" || S.view === "bookmarks") render();
}
const bmHost = u => { try{ return new URL(u).hostname.replace(/^www\./, ""); }catch(e){ return ""; } };
const BM_TINTS = ["#3D7BFA","#8A63F2","#F04452","#F7931A","#20B46B","#E5468E","#0FA3B1","#6B7A90"];
function bmIcon(b){
  const h = bmHost(b.url), ch = (b.title || h || "?").trim().charAt(0).toUpperCase() || "?";
  const tint = BM_TINTS[[...h].reduce((a, c) => a + c.charCodeAt(0), 0) % BM_TINTS.length];
  return `<span class="bm-ic" style="--tint:${tint}"><i aria-hidden="true">${esc(ch)}</i>${h ? `<img class="bm-fav" src="https://icons.duckduckgo.com/ip3/${encodeURIComponent(h)}.ico" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</span>`;
}
function bookmarksHtml(){
  const links = S.bookmarks.filter(b => b.kind === "link");
  const favs = favItems(), nf = favs.entries.length + favs.stocks.length + favs.photos.length;
  return `<div class="bm">
    <div class="vhead"><h2>북마크</h2>
      <div class="tools"><div class="seg bm-seg" role="group" aria-label="북마크 종류">
        <button type="button" data-bmtab="links" aria-pressed="${S.bmTab !== "favs"}">웹 링크 <span class="mono">${links.length}</span></button>
        <button type="button" data-bmtab="favs" aria-pressed="${S.bmTab === "favs"}">앱 즐겨찾기 <span class="mono">${nf}</span></button>
      </div></div></div>
    ${S.bmTab === "favs" ? favsHtml(favs) : linksHtml(links)}
  </div>`;
}
function linksHtml(links){
  const tags = [...new Set(links.flatMap(b => b.tags || []))].sort((a, b) => a.localeCompare(b));
  if(S.bmTag && !tags.includes(S.bmTag)) S.bmTag = null;
  const list = links.filter(b => !S.bmTag || (b.tags || []).includes(S.bmTag)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const row = b => {
    const h = bmHost(b.url), loading = S.bmLoading.has(b.id);
    return `<article class="bm-row">
      <a class="bm-main" href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${bmIcon(b)}
        <span class="bm-tx"><b>${esc(b.title || h || b.url)}</b><small>${esc(h)}${loading ? " · 제목 불러오는 중…" : ""} · ${esc(fmtDate(ymd(new Date(b.createdAt || Date.now()))))}</small>
        ${b.memo ? `<span class="bm-memo">${esc(b.memo)}</span>` : ""}${(b.tags || []).length ? `<span class="bm-tags">${b.tags.map(t => "#" + esc(t)).join(" ")}</span>` : ""}</span></a>
      <button type="button" class="bm-more" data-bmedit="${esc(b.id)}" aria-label="${esc(b.title || h)} 편집"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button>
    </article>`;
  };
  return `<form class="bm-add" id="bmAdd" autocomplete="off">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>
      <input id="bmUrl" type="text" inputmode="url" placeholder="저장할 웹 주소를 붙여 넣으세요" aria-label="웹 주소" spellcheck="false">
      <button class="btn primary" type="submit">저장</button>
    </form>
    ${tags.length ? `<div class="mfilters bm-tagrow">${tags.map(t => `<button type="button" class="chip ${S.bmTag === t ? "on" : ""}" data-bmtag="${esc(t)}">#${esc(t)}</button>`).join("")}</div>` : ""}
    ${list.length ? `<div class="bm-list">${list.map(row).join("")}</div>`
      : `<div class="empty"><h3>${S.bmTag ? "이 태그의 링크가 없어요" : "저장한 링크가 없어요"}</h3><p>읽을거리, 자주 가는 사이트, 나중에 볼 영상 주소를 붙여 넣으면 제목과 사이트 아이콘을 붙여 정리해 드려요.</p></div>`}`;
}
function favItems(){
  const f = S.bookmarks.filter(b => b.kind !== "link").sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const pick = (kind, arr) => f.filter(b => b.kind === kind).map(b => arr.find(x => x.id === b.ref)).filter(Boolean);
  return { entries:pick("entry", S.entries), stocks:pick("stock", S.stocks), photos:pick("photo", S.photos) };
}
function favsHtml(fv){
  const star = (kind, id, label) => `<button type="button" class="bm-star fav-btn" data-fav="${kind}:${esc(id)}" aria-pressed="true" aria-label="${esc(label)} 즐겨찾기 빼기">★</button>`;
  const entryRow = e => `<article class="bm-row"><button type="button" class="bm-main" data-open="${esc(e.id)}">
      <span class="bm-thumb">${(e.photos || []).length ? imgTag(e.photos[0]) : `<i>${esc(e.cat || "")}</i>`}</span>
      <span class="bm-tx"><b>${esc(e.title || "제목 없음")}</b><small>${sheetNo(e)} · ${esc(catOf(e.cat).name)} · ${esc(fmtDate(e.date))}</small></span></button>${star("entry", e.id, e.title)}</article>`;
  const stockRow = s => { const q = quoteOf(s);
    return `<article class="bm-row"><button type="button" class="bm-main" data-stock="${esc(s.id)}">${avaHtml(s)}
      <span class="bm-tx"><b>${esc(s.name)}</b><small>${esc(s.symbol)}</small></span>
      <span class="bm-px">${q && num(q.price) ? `<b>${fmtMoney(q.price, s.currency)}</b><small class="${tone(q.changePct)}">${fmtPct(q.changePct)}</small>` : ""}</span></button>${star("stock", s.id, s.name)}</article>`; };
  const n = fv.entries.length + fv.stocks.length + fv.photos.length;
  if(!n) return `<div class="empty"><h3>아직 즐겨찾기가 없어요</h3><p>기록, 주식 종목, 사진을 열고 ☆ 즐겨찾기를 누르면 여기에 모여요.</p></div>`;
  return `${fv.entries.length ? `<section class="bm-sec"><h3>기록<span>${fv.entries.length}</span></h3><div class="bm-list">${fv.entries.map(entryRow).join("")}</div></section>` : ""}
    ${fv.stocks.length ? `<section class="bm-sec"><h3>주식<span>${fv.stocks.length}</span></h3><div class="bm-list">${fv.stocks.map(stockRow).join("")}</div></section>` : ""}
    ${fv.photos.length ? `<section class="bm-sec"><h3>사진<span>${fv.photos.length}</span></h3><div class="ph-grid bm-ph">${fv.photos.map(p => `<button type="button" class="ph-tile" data-photo="${esc(p.id)}" aria-label="${esc(fmtDate(p.date))} 사진">${imgTag(p.thumb || p.path)}</button>`).join("")}</div></section>` : ""}`;
}
function normUrl(raw){
  let u = String(raw || "").trim(); if(!u) return null;
  if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = "https://" + u;
  try{ const x = new URL(u); if(!/^https?:$/.test(x.protocol) || !x.hostname.includes(".")) return null; return x.href; }catch(e){ return null; }
}
function addLink(){
  const inp = $("#bmUrl"); const href = normUrl(inp && inp.value);
  if(!href){ toast(inp && inp.value.trim() ? "웹 주소가 올바르지 않아요." : "저장할 웹 주소를 붙여 넣어 주세요."); return; }
  if(S.bookmarks.some(b => b.kind === "link" && b.url === href)){ toast("이미 저장한 링크예요."); return; }
  const now = Date.now(), rec = { id:uuid(), kind:"link", ref:"", url:href, title:"", memo:"", tags:[], createdAt:now, updatedAt:now };
  S.bmTag = null; putBookmark(rec); render(); toast("링크를 저장했어요.");
  fetchLinkTitle(rec.id);
}
async function fetchLinkTitle(id){
  const b = S.bookmarks.find(x => x.id === id);
  if(!b || b.title || !S.B || S.B.kind === "local" || !navigator.onLine) return;
  S.bmLoading.add(id); if(S.view === "bookmarks") render();
  try{
    const d = await S.B.invoke({ action:"linkmeta", url:b.url });
    const cur = S.bookmarks.find(x => x.id === id);
    const title = d && String(d.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if(cur && !cur.title && title) putBookmark({ ...cur, title, updatedAt:Date.now() });
  }catch(e){}
  finally{ S.bmLoading.delete(id); if(S.view === "bookmarks") render(); if(OV && OV.kind === "bmform" && OV.id === id) renderBmForm(); }
}
function openBmForm(id){
  const b = S.bookmarks.find(x => x.id === id); if(!b) return;
  if(OV) endOvKeepHistory(); OV = { kind:"bmform", id, confirm:false, err:"" }; renderBmForm();
}
function renderBmForm(){
  const b = S.bookmarks.find(x => x.id === OV.id); if(!b){ closeOv(); return; }
  const keep = OV.draft;
  showOv(`<div class="sheetbox" role="dialog" aria-modal="true" aria-label="링크 편집">
    <div class="sb-head"><span class="ttl">링크 편집</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <form id="bmForm" class="sb-body bm-form" autocomplete="off">
      <div class="fld"><label for="bm-url">웹 주소</label><input id="bm-url" type="text" inputmode="url" value="${esc(keep ? keep.url : b.url)}" spellcheck="false" required></div>
      <div class="fld"><label for="bm-title">제목</label><input id="bm-title" type="text" maxlength="200" value="${esc(keep ? keep.title : b.title)}" placeholder="${esc(bmHost(b.url))}"></div>
      <div class="fld"><label for="bm-memo">메모</label><textarea id="bm-memo" rows="3" maxlength="1000" placeholder="왜 저장했는지 적어 두면 나중에 찾기 쉬워요">${esc(keep ? keep.memo : b.memo)}</textarea></div>
      <div class="fld"><label for="bm-tags">태그</label><input id="bm-tags" type="text" value="${esc(keep ? keep.tags : (b.tags || []).join(", "))}" placeholder="쉼표로 나눠 적어요 (예: 읽을거리, 건축)"></div>
      ${OV.err ? `<p class="err" style="margin:0;color:var(--danger);font-size:13px">${esc(OV.err)}</p>` : ""}
      <div class="bm-facts"><a href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">링크 열기 ↗</a><span>${esc(fmtDate(ymd(new Date(b.createdAt || Date.now()))))} 저장</span></div>
      <div class="sb-foot bm-foot">${OV.confirm
        ? `<span class="bm-q">이 링크를 지울까요?</span><button class="btn small danger" type="button" data-act="bmDelYes">지우기</button><button class="btn small" type="button" data-act="bmDelNo">취소</button>`
        : `<button class="btn ghost danger" type="button" data-act="bmDel">지우기</button><span class="sp"></span><button class="btn" type="button" data-act="close">취소</button><button class="btn primary" type="submit">저장</button>`}</div>
    </form></div>`);
}
function bmDraft(){ return { url:($("#bm-url") || {}).value || "", title:($("#bm-title") || {}).value || "", memo:($("#bm-memo") || {}).value || "", tags:($("#bm-tags") || {}).value || "" }; }
function saveBm(){
  const b = S.bookmarks.find(x => x.id === OV.id); if(!b) return;
  const d = bmDraft(), href = normUrl(d.url);
  if(!href){ OV.draft = d; OV.err = "웹 주소가 올바르지 않아요."; renderBmForm(); return; }
  const tags = [...new Set(d.tags.split(/[,#]/).map(s => s.trim()).filter(Boolean).map(s => s.slice(0, 30)))].slice(0, 20);
  putBookmark({ ...b, url:href, title:d.title.trim().slice(0, 200), memo:d.memo.trim().slice(0, 1000), tags, updatedAt:Date.now() });
  closeOv(); render(); toast("링크를 저장했어요.");
}
function deleteBm(){ const id = OV.id; closeOv(); dropBookmark(id); render(); toast("링크를 지웠어요."); }

// drop photos anywhere on the album screen (computer)
document.addEventListener("dragover", ev => { if(S.view === "photos" && !OV && ev.dataTransfer && [...ev.dataTransfer.types].includes("Files")){ ev.preventDefault(); document.body.classList.add("ph-drop"); } });
document.addEventListener("dragleave", ev => { if(!ev.relatedTarget) document.body.classList.remove("ph-drop"); });
document.addEventListener("drop", ev => {
  document.body.classList.remove("ph-drop");
  if(S.view !== "photos" || OV || !ev.dataTransfer || !ev.dataTransfer.files.length) return;
  ev.preventDefault(); uploadAlbum(ev.dataTransfer.files);
});

/* ---------- SNS: X-style feed of daily picks (sns/feed.json, filled by sns/add.py) ---------- */
const SNS_TOPICS = [["all","전체"],["ai","AI"],["science","과학"],["tech","기술"],["unreal","언리얼 엔진"],["gamedev","게임 개발"],["graphics","게임 그래픽"],["arch","건축"]];
const SNS_TOPIC_KEYS = SNS_TOPICS.slice(1).map(t => t[0]);
const SNS_PAGE = 30;
const SNS_LANG = { en:"영어", ja:"일본어", zh:"중국어", fr:"프랑스어", de:"독일어", es:"스페인어" };
const SNS = { posts:null, updatedAt:null, at:0, busy:false, err:false, limit:SNS_PAGE, ko:new Set() };
const snsTopicName = k => (SNS_TOPICS.find(t => t[0] === k) || [k, k])[1];
const snsTopic = () => SNS_TOPIC_KEYS.includes(S.snsTopic) ? S.snsTopic : "all";
const snsList = () => { const tp = snsTopic(); return (SNS.posts || []).filter(p => tp === "all" || (p.topics || []).includes(tp)); };
const snsNum = n => !(n > 0) ? "" : n < 1e4 ? n.toLocaleString("ko-KR") : n < 1e8 ? +(n / 1e4).toFixed(n < 1e5 ? 1 : 0) + "만" : +(n / 1e8).toFixed(1) + "억";
const snsHref = h => /^https?:\/\//i.test(String(h || ""));
const snsRich = r => (r || []).map(x => Array.isArray(x) ? (snsHref(x[1]) ? `<a href="${esc(x[1])}" target="_blank" rel="noopener noreferrer">${esc(x[0])}</a>` : esc(x[0])) : esc(x)).join("").replace(/\n/g, "<br>");
const snsPlain = r => (r || []).map(x => Array.isArray(x) ? x[0] : x).join("");
const snsImg = (src, size) => snsHref(src) ? esc(/pbs\.twimg\.com\/media\//.test(src) && !src.includes("?") ? src + "?name=" + size : src) : "";
function snsAgo(iso){
  const t = Date.parse(iso || ""); if(!t) return "";
  const s = (Date.now() - t) / 1000;
  if(s < 60) return "방금";
  if(s < 3600) return Math.floor(s / 60) + "분";
  if(s < 86400) return Math.floor(s / 3600) + "시간";
  const d = new Date(t + 9 * 3600e3), y = new Date(Date.now() + 9 * 3600e3).getUTCFullYear();
  return `${d.getUTCFullYear() === y ? "" : d.getUTCFullYear() + "년 "}${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}
function snsDay(day){
  const k = new Date(Date.now() + 9 * 3600e3), p2 = n => String(n).padStart(2, "0");
  const today = `${k.getUTCFullYear()}-${p2(k.getUTCMonth() + 1)}-${p2(k.getUTCDate())}`;
  const [y, m, d] = String(day || "").split("-").map(Number); if(!d) return "";
  return `${day === today ? "오늘 · " : ""}${m}월 ${d}일 (${WD[new Date(y, m - 1, d).getDay()]})`;
}
async function snsLoad(force){
  if(SNS.busy || (!force && Date.now() - SNS.at < 10 * 60e3)) return;
  SNS.busy = true; SNS.at = Date.now();
  try{
    if(!SNS.posts){ const c = await KV.get("sns-feed"); if(c && Array.isArray(c.posts)){ SNS.posts = c.posts; SNS.updatedAt = c.updatedAt || null; if(S.view === "sns") render(); } }
    const r = await fetch("sns/feed.json", { cache:"no-cache" });
    if(!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    SNS.posts = Array.isArray(j.posts) ? j.posts : []; SNS.updatedAt = j.updatedAt || null; SNS.err = false;
    KV.set("sns-feed", { posts:SNS.posts, updatedAt:SNS.updatedAt });
  }catch(e){ SNS.err = true; }
  finally{ SNS.busy = false; if(S.view === "sns") render(); }
}
const SNS_BADGE = c => c ? `<svg class="xp-badge ${esc(c)}" viewBox="0 0 22 22" role="img" aria-label="인증된 계정"><circle cx="11" cy="11" r="10"/><path d="m6.6 11.2 3.1 3.1 5.8-6.4" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>` : "";
const SNS_IC = {
  reply:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 4.5h5a6.5 6.5 0 0 1 0 13H12l-4.5 3.2v-3.6A6.5 6.5 0 0 1 9.5 4.5z"/></svg>`,
  repost:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9 7.5 6l3 3M7.5 6.5V15a2.5 2.5 0 0 0 2.5 2.5h4M19.5 15l-3 3-3-3M16.5 17.5V9A2.5 2.5 0 0 0 14 6.5h-4"/></svg>`,
  like:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"/></svg>`,
  mark:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10a1 1 0 0 1 1 1v14.2l-6-4.2-6 4.2V5.5a1 1 0 0 1 1-1z"/></svg>`,
  share:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4.5M7.5 8.5 12 4l4.5 4.5M5 13.5v4A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-4"/></svg>`,
  open:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4.5h5.5V10M19.5 4.5 11 13M17.5 14v3.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2H10"/></svg>`,
  ctx:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.9 5 5.1.4-3.9 3.3 1.2 5.1L12 14.6l-4.3 2.7 1.2-5.1L5 8.9l5.1-.4z"/></svg>`
};
const snsSaved = p => S.bookmarks.find(b => b.kind === "link" && b.url === p.url);
function snsMediaHtml(ms, url, small){
  ms = (ms || []).filter(m => m && snsHref(m.src)).slice(0, 4); if(!ms.length) return "";
  const n = ms.length, one = n === 1 ? ms[0] : null;
  const ratio = one && one.w > 0 && one.h > 0 ? Math.min(Math.max(one.w / one.h, 0.8), 2.4) : 16 / 9;
  // inside a quoted post the whole box is already a link, and links can't nest
  const tag = small ? "span" : "a", open = href => small ? "" : ` href="${esc(href)}" target="_blank" rel="noopener noreferrer"`;
  const item = (m, i) => {
    if(m.type === "video" || m.type === "gif"){
      if(!small && snsHref(m.mp4)) return `<div class="xp-m">${m.type === "gif"
        ? `<video src="${esc(m.mp4)}" poster="${snsImg(m.src, "small")}" autoplay muted loop playsinline preload="none"></video><i class="xp-gif">GIF</i>`
        : `<video src="${esc(m.mp4)}" poster="${snsImg(m.src, "small")}" controls playsinline preload="none"></video>`}</div>`;
      return `<${tag} class="xp-m"${open(url)}><img src="${snsImg(m.src, "small")}" alt="동영상" loading="lazy" referrerpolicy="no-referrer"><i class="xp-play" aria-hidden="true"></i></${tag}>`;
    }
    return `<${tag} class="xp-m"${open(`${url}/photo/${i + 1}`)}><img src="${snsImg(m.src, small || n > 1 ? "small" : "medium")}" alt="사진" loading="lazy" referrerpolicy="no-referrer"></${tag}>`;
  };
  return `<div class="xp-media n${n}${small ? " sm" : ""}"${one && !small ? ` style="aspect-ratio:${ratio.toFixed(3)}"` : ""}>${ms.map(item).join("")}</div>`;
}
function snsHeadHtml(a, url, at, small){
  const prof = "https://x.com/" + encodeURIComponent(a.handle || "");
  const name = `<b>${esc(a.name || a.handle || "")}</b>${SNS_BADGE(a.badge)}`;
  return `<div class="xp-head">
    ${small ? `<span class="xp-ava sm${a.square ? " sq" : ""}">${snsHref(a.avatar) ? `<img src="${esc(a.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</span><span class="xp-name">${name}</span>`
      : `<a class="xp-name" href="${prof}" target="_blank" rel="noopener noreferrer">${name}</a>`}
    <span class="xp-meta"><span class="xp-handle">@${esc(a.handle || "")}</span><span aria-hidden="true">·</span>${small ? `<time datetime="${esc(at || "")}">${esc(snsAgo(at))}</time>` : `<a class="xp-time" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><time datetime="${esc(at || "")}">${esc(snsAgo(at))}</time></a>`}</span>
  </div>`;
}
function snsPostHtml(p){
  const a = p.author || {}, url = snsHref(p.url) ? p.url : "https://x.com/i/status/" + encodeURIComponent(p.id);
  const prof = "https://x.com/" + encodeURIComponent(a.handle || "");
  const ctx = [...(p.topics || []).map(snsTopicName), p.following ? "팔로우 중" : ""].filter(Boolean).join(" · ");
  const tr = p.ko && p.lang !== "ko" ? (SNS.ko.has(p.id)
    ? `<div class="xp-ko"><small>${esc(SNS_LANG[p.lang] || "다른 언어")}에서 번역함 · <button type="button" data-snstr="${esc(p.id)}">원문만 보기</button></small><p>${esc(p.ko)}</p></div>`
    : `<button type="button" class="xp-tr" data-snstr="${esc(p.id)}">게시물 번역하기</button>`) : "";
  const c = p.card && snsHref(p.card.href) && p.card.title ? p.card : null;
  const q = p.quote && p.quote.author && snsHref(p.quote.url) ? p.quote : null;
  const saved = !!snsSaved(p);
  return `<article class="xp" data-xp="${esc(p.id)}">
    ${ctx ? `<div class="xp-ctx">${SNS_IC.ctx}<span>${esc(ctx)}</span></div>` : ""}
    <div class="xp-row">
      <a class="xp-ava${a.square ? " sq" : ""}" href="${prof}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${snsHref(a.avatar) ? `<img src="${esc(a.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</a>
      <div class="xp-main">
        <div class="xp-top">${snsHeadHtml(a, url, p.createdAt)}<a class="xp-open" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="X에서 열기" title="X에서 열기">${SNS_IC.open}</a></div>
        ${(p.rich || []).length ? `<div class="xp-text"${p.lang && /^[a-z]{2,3}$/.test(p.lang) ? ` lang="${esc(p.lang)}"` : ""}>${snsRich(p.rich)}</div>` : ""}
        ${p.more ? `<a class="xp-showmore" href="${esc(url)}" target="_blank" rel="noopener noreferrer">더 보기</a>` : ""}
        ${tr}
        ${snsMediaHtml(p.media, url)}
        ${c ? `<a class="xp-card${c.large && snsHref(c.img) ? " lg" : ""}" href="${esc(c.href)}" target="_blank" rel="noopener noreferrer">${snsHref(c.img) ? `<span class="xp-card-im"><img src="${esc(c.img)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : ""}<span class="xp-card-tx">${c.domain ? `<small>${esc(c.domain)}</small>` : ""}<b>${esc(c.title)}</b></span></a>` : ""}
        ${q ? `<a class="xp-quote" href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">${snsHeadHtml(q.author, q.url, q.createdAt, true)}${(q.rich || []).length ? `<div class="xp-text">${esc(snsPlain(q.rich))}</div>` : ""}${snsMediaHtml(q.media, q.url, true)}</a>` : ""}
        <div class="xp-acts">
          <a class="xp-act rp" href="${esc(url)}" target="_blank" rel="noopener noreferrer" aria-label="답글 ${p.replies || 0}개">${SNS_IC.reply}<span>${snsNum(p.replies)}</span></a>
          <a class="xp-act rt" href="https://x.com/intent/retweet?tweet_id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener noreferrer" aria-label="재게시">${SNS_IC.repost}<span></span></a>
          <a class="xp-act lk" href="https://x.com/intent/like?tweet_id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener noreferrer" aria-label="마음에 들어요 ${p.likes || 0}개">${SNS_IC.like}<span>${snsNum(p.likes)}</span></a>
          <span class="xp-sp"></span>
          <button type="button" class="xp-act bm" data-snsbm="${esc(p.id)}" aria-pressed="${saved}" aria-label="${saved ? "북마크에서 빼기" : "북마크에 저장"}" title="${saved ? "북마크에서 빼기" : "북마크에 저장"}">${SNS_IC.mark}</button>
          <button type="button" class="xp-act sh" data-snsshare="${esc(p.id)}" aria-label="공유" title="링크 공유">${SNS_IC.share}</button>
        </div>
      </div>
    </div>
  </article>`;
}
function snsRowsHtml(list, from, to){
  let out = "";
  for(let i = from; i < to; i++){
    const p = list[i];
    if(p.addedOn && (i === 0 || list[i - 1].addedOn !== p.addedOn)){
      const n = list.filter(x => x.addedOn === p.addedOn).length;
      out += `<div class="xf-day"><span>${esc(snsDay(p.addedOn))}</span><small>소식 ${n}개</small></div>`;
    }
    out += snsPostHtml(p);
  }
  return out;
}
function snsHtml(){
  const list = snsList(), tp = snsTopic(), to = Math.min(list.length, SNS.limit);
  const up = SNS.updatedAt ? new Date(SNS.updatedAt) : null;
  const sub = up && !isNaN(up) ? `${up.getMonth() + 1}월 ${up.getDate()}일 ${String(up.getHours()).padStart(2, "0")}:${String(up.getMinutes()).padStart(2, "0")} 업데이트` : "";
  let body;
  if(SNS.posts === null) body = SNS.err
    ? `<div class="xf-empty"><h3>소식을 불러오지 못했어요</h3><p>인터넷 연결을 확인하고 다시 시도해 주세요.</p><button type="button" class="xf-btn" data-snsretry="1">다시 시도</button></div>`
    : `<div class="xf-loading" aria-label="불러오는 중"><i></i></div>`;
  else if(!list.length) body = `<div class="xf-empty"><h3>${tp === "all" ? "아직 모은 소식이 없어요" : `${esc(snsTopicName(tp))} 소식이 아직 없어요`}</h3><p>매일 X에서 AI·과학·기술·언리얼 엔진·게임 개발·게임 그래픽·건축 소식을 골라 여기에 올려요.</p></div>`;
  else body = snsRowsHtml(list, 0, to);
  return `<div class="xf">
    <div class="xf-head">
      <div class="xf-title"><h2>SNS</h2>${sub ? `<small>${esc(sub)}</small>` : ""}</div>
      <nav class="xf-tabs" role="tablist" aria-label="SNS 주제">${SNS_TOPICS.map(([k, l]) => `<button type="button" role="tab" data-snstopic="${k}" aria-selected="${tp === k}"><span>${l}</span></button>`).join("")}</nav>
    </div>
    <div class="xf-list" id="snsList">${body}</div>
    ${to < list.length ? `<div class="xf-more" id="snsMore"><button type="button" class="xf-btn" data-snsmore="1">더 보기</button></div>` : ""}
  </div>`;
}
let snsIO = null;
function snsMore(){
  const list = snsList(), box = document.getElementById("snsList"), more = document.getElementById("snsMore"); if(!box) return;
  const from = Math.min(SNS.limit, list.length), to = Math.min(list.length, from + SNS_PAGE);
  SNS.limit = to; box.insertAdjacentHTML("beforeend", snsRowsHtml(list, from, to));
  if(to >= list.length && more){ more.remove(); if(snsIO){ snsIO.disconnect(); snsIO = null; } }
}
function bindSnsMore(){
  if(snsIO){ snsIO.disconnect(); snsIO = null; }
  const more = document.getElementById("snsMore"); if(!more || !("IntersectionObserver" in window)) return;
  snsIO = new IntersectionObserver(ents => { if(ents.some(e => e.isIntersecting)) snsMore(); }, { rootMargin:"600px 0px" });
  snsIO.observe(more);
}
function snsRepaint(id){
  const p = (SNS.posts || []).find(x => x.id === id), el = p && document.querySelector(`.xp[data-xp="${CSS.escape(id)}"]`);
  if(el) el.outerHTML = snsPostHtml(p);
}
function snsToggleBookmark(id){
  const p = (SNS.posts || []).find(x => x.id === id); if(!p) return;
  const b = snsSaved(p);
  if(b){ dropBookmark(b.id); toast("북마크에서 뺐어요."); }
  else {
    const a = p.author || {}, text = snsPlain(p.rich).replace(/\s+/g, " ").trim(), now = Date.now();
    putBookmark({ id:uuid(), kind:"link", ref:"", url:p.url, title:`${a.name || a.handle}: ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`, memo:p.ko || "", tags:["SNS"], createdAt:now, updatedAt:now });
    toast("북마크에 저장했어요.");
  }
  snsRepaint(id);
}
async function snsShare(id){
  const p = (SNS.posts || []).find(x => x.id === id); if(!p) return;
  try{
    if(navigator.share){ await navigator.share({ url:p.url }); return; }
    await navigator.clipboard.writeText(p.url); toast("링크를 복사했어요.");
  }catch(e){ if(!(e && e.name === "AbortError")) toast("링크를 복사하지 못했어요."); }
}

/* ---------- bitcoin ---------- */
// Live prices come straight from the exchanges' public websockets (KRW: Upbit or Bithumb, USD: Binance)
// with REST polling as a fallback. Dominance: CoinGecko, Fear & Greed: Alternative.me, charts: Binance
// klines + blockchain.com charts, blocks/fees: mempool.space through our "quotes" function, else Blockstream.
const BT_TABS = [["overview","개요"],["blocks","블록"],["convert","계산기"],["premium","프리미엄"]];
const BT_METRICS = [["price","시세"],["difficulty","채굴 난이도"],["hashrate","해시레이트"]];
const BT_RANGES = [["1d","1일"],["7d","7일"],["1m","1개월"],["1y","1년"],["5y","5년"],["10y","10년"],["all","전체"]];
const BT_LONG = ["1m","1y","5y","10y","all"]; // difficulty & hashrate only come as daily values
const BT_SAYINGS = ["겸손하게, 꾸준히 모으자.","팔지 말고 버티자.","믿지 말고, 검증하라.","내 키가 아니면 내 비트코인이 아니다.","비트코인이 필요해.","째깍째깍, 다음 블록.","1비트코인은 1비트코인."];
const BT_EX = {
  upbit:{ name:"업비트", tag:"업비트", ws:"wss://api.upbit.com/websocket/v1", rest:"https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-USDT" },
  bithumb:{ name:"빗썸", tag:"빗썸", ws:"wss://ws-api.bithumb.com/websocket/v1", rest:"https://api.bithumb.com/v1/ticker?markets=KRW-BTC,KRW-USDT" }
};
const BN_WS = ["wss://stream.binance.com:9443/ws/btcusdt@ticker", "wss://data-stream.binance.vision/ws/btcusdt@ticker"];
const BN_REST = ["https://api.binance.com", "https://data-api.binance.vision"];
const BT_BN = { "1d":["5m",288], "7d":["1h",168], "1m":["4h",180], "1y":["1d",365], "5y":["1w",260] };
const BT_BCI = { "7d":"7days", "1m":"30days", "1y":"1year", "5y":"5years", "10y":"10years", "all":"all" };
const BT_TTL = { fx:10 * 60e3, dom:5 * 60e3, fng:30 * 60e3, candles:60e3, height:60e3, mp:30e3, rest:10e3 };
const HALVING_EVERY = 210000;
const FNG_KO = { "extreme fear":"극단적 공포", "fear":"공포", "neutral":"중립", "greed":"탐욕", "extreme greed":"극단적 탐욕" };
const BT_UNITS = [["BTC","비트코인"],["SATS","사토시"],["KRW","원"],["USD","달러"]];

const BT = {
  on:false, paused:false, tab:"overview", ex:"upbit", fxBasis:"bank", metric:"price", range:"5y",
  krw:null, krwPct:null, usd:null, usdPct:null, usdtKrw:null, fx:null, fxAt:0,
  dom:null, fng:null, fngLabel:"", height:null, candles:null, mp:null, mpErr:"",
  at:{}, busy:{}, chart:{}, ws:{ kr:null, bn:null }, wsUp:{ kr:false, bn:false }, wsFail:{ kr:0, bn:0 }, wsLast:{ kr:0, bn:0 }, retry:{},
  menu:null, saying:BT_SAYINGS[0], conv:{ amt:"1", unit:"BTC", prem:"0" }, toasted:false, timer:null, paintT:null, snap:false
};
try{
  const p = JSON.parse(localStorage.getItem("sansiya-btc") || "{}");
  if(BT_TABS.some(t => t[0] === p.tab)) BT.tab = p.tab;
  if(BT_EX[p.ex]) BT.ex = p.ex;
  if(p.fxBasis === "usdt") BT.fxBasis = "usdt";
  if(BT_METRICS.some(m => m[0] === p.metric)) BT.metric = p.metric;
  if(BT_RANGES.some(r => r[0] === p.range)) BT.range = p.range;
  if(BT_UNITS.some(u => u[0] === p.unit)) BT.conv.unit = p.unit;
}catch(e){}
function btSavePrefs(){ try{ localStorage.setItem("sansiya-btc", JSON.stringify({ tab:BT.tab, ex:BT.ex, fxBasis:BT.fxBasis, metric:BT.metric, range:BT.range, unit:BT.conv.unit })); }catch(e){} }
const BT_SNAP = ["krw","krwPct","usd","usdPct","usdtKrw","fx","fxAt","dom","fng","fngLabel","height","candles","mp"];
function btSaveSnap(){ const o = { ex:BT.ex, savedAt:Date.now() }; BT_SNAP.forEach(key => { o[key] = BT[key]; }); KV.set("btc-snap", o); }
function btLoadSnap(){
  if(BT.snap) return; BT.snap = true;
  KV.get("btc-snap").then(o => {
    if(!o) return;
    BT_SNAP.forEach(key => {
      if(o.ex !== BT.ex && (key === "krw" || key === "krwPct" || key === "usdtKrw")) return;
      if(BT[key] == null && o[key] != null) BT[key] = o[key];
    });
    if(S.view === "bitcoin" && BT.on) btPaintAll();
  });
}

/* numbers */
const bInt = v => num(v) ? Math.round(v).toLocaleString("en-US") : "-";
const bFix = (v, d) => num(v) ? v.toLocaleString("en-US", { minimumFractionDigits:d, maximumFractionDigits:d }) : "-";
const bSign = v => num(v) && v > 0 ? "+" : num(v) && v < 0 ? "-" : "";
const bTone = v => !num(v) || Math.abs(v) < 0.005 ? "flat" : v > 0 ? "up" : "down"; // shown to 2 decimals, so ±0.00 reads as flat
const bFee = v => num(v) ? (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString("en-US")) : "-";
const bYmd = t => { const d = new Date(t); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
function bAgo(sec){
  const m = Math.max(0, Math.floor((Date.now() / 1000 - sec) / 60));
  if(m < 1) return "방금"; if(m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60); return h < 24 ? `${h}시간${m % 60 ? ` ${m % 60}분` : ""} 전` : `${Math.floor(h / 24)}일 전`;
}
function btUnit(v, units){ for(const [u, d] of units){ if(Math.abs(v) >= d) { const x = v / d; return (x >= 100 ? Math.round(x).toLocaleString("en-US") : x.toFixed(x >= 10 ? 1 : 2)) + u; } } return String(v); }
function btFmtMetric(v, metric){
  if(!num(v)) return "-";
  if(metric === "hashrate") return btUnit(v, [[" EH/s",1e6],[" PH/s",1e3],[" TH/s",1],[" GH/s",1e-3],[" MH/s",1e-6],[" KH/s",1e-9]]);
  if(metric === "difficulty") return btUnit(v, [["조",1e12],["억",1e8],["만",1e4],["",1e-9]]);
  return "$" + bInt(v);
}
const btRate = () => BT.fxBasis === "usdt" && num(BT.usdtKrw) ? BT.usdtKrw : BT.fx;
const btPremium = () => { const r = btRate(); return num(BT.krw) && num(BT.usd) && num(r) && BT.usd > 0 ? (BT.krw / (BT.usd * r) - 1) * 100 : null; };
function btHalving(){
  const h = BT.height; if(!num(h)) return null;
  const epoch = Math.floor(h / HALVING_EVERY), start = epoch * HALVING_EVERY, next = start + HALVING_EVERY, remain = next - h;
  return { h, p:(h - start) / HALVING_EVERY, remain, next, est:Date.now() + remain * 600e3, reward:50 / 2 ** (epoch + 1) };
}

/* icons */
const BT_COIN = `<svg class="bt-coin" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="var(--bt-orange)"/><g transform="rotate(14 32 32)" fill="#fff"><rect x="25" y="12" width="4.6" height="8" rx="1.2"/><rect x="33" y="12" width="4.6" height="8" rx="1.2"/><rect x="25" y="44" width="4.6" height="8" rx="1.2"/><rect x="33" y="44" width="4.6" height="8" rx="1.2"/><path d="M20 18h15.5c5.8 0 9.5 3 9.5 7.6 0 3.2-1.8 5.4-4.6 6.2 3.6.7 6 3.2 6 7 0 5.2-4.1 8.2-10.6 8.2H20v-5.3h3.4V23.3H20zm9.6 5.2v7.1h5.2c2.4 0 3.9-1.3 3.9-3.6s-1.5-3.5-3.9-3.5zm0 12.1v7.6h6c2.7 0 4.3-1.4 4.3-3.8s-1.6-3.8-4.3-3.8z"/></g></svg>`;
const BT_GEAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const BT_CHEV = `<svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 4.5 3.5 3.5 3.5-3.5"/></svg>`;
const BT_BARS = `<svg class="bars" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="9" width="4" height="9" rx="1"/><rect x="8" y="3" width="4" height="15" rx="1"/><rect x="14" y="6" width="4" height="12" rx="1"/></svg>`;
const BT_HALF = `<svg class="half" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M10 1.8a8.2 8.2 0 0 0 0 16.4z" fill="currentColor"/></svg>`;
const BT_TRI = { up:`<svg viewBox="0 0 10 8" aria-hidden="true"><path d="M5 0 10 8H0z"/></svg>`, down:`<svg viewBox="0 0 10 8" aria-hidden="true"><path d="M5 8 0 0h10z"/></svg>`, flat:"" };
const BT_COPY = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>`;
function btCubes(){
  const cube = (x, y, s) => { const w = s * 0.866, h = s / 2; return `<path d="M${x} ${y - h}L${x + w} ${y}L${x} ${y + h}L${x - w} ${y}Z M${x - w} ${y}V${y + s}L${x} ${y + s + h}L${x + w} ${y + s}V${y} M${x} ${y + h}V${y + s + h}"/>`; };
  return `<svg class="bt-cubes" viewBox="0 0 60 48" aria-hidden="true">${cube(14, 14, 11)}${cube(33, 26, 11)}${cube(48, 13, 9)}</svg>`;
}
const BT_ICONS = {
  overview:`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2" class="a"/><rect x="13" y="3" width="8" height="8" rx="2" class="b"/><rect x="3" y="13" width="8" height="8" rx="2" class="b"/><rect x="13" y="13" width="8" height="8" rx="2" class="a"/></svg>`,
  blocks:`<svg viewBox="0 0 24 24" aria-hidden="true" class="ln"><path d="M12 2.8 20 7.2v9.6L12 21.2 4 16.8V7.2z"/><path d="M4 7.2 12 11.6l8-4.4M12 11.6v9.6"/></svg>`,
  convert:`<svg viewBox="0 0 24 24" aria-hidden="true" class="ln"><path d="M4 8.5h15.5M15.5 4.5l4 4-4 4M20 15.5H4.5M8.5 11.5l-4 4 4 4"/></svg>`,
  premium:`<svg viewBox="0 0 24 24" aria-hidden="true" class="ln"><circle cx="12" cy="9" r="6"/><path d="m12 6 .95 1.95 2.15.3-1.55 1.5.37 2.13L12 10.88l-1.92 1 .37-2.13L8.9 8.25l2.15-.3z"/><path d="M8.3 13.7 7 21l5-2.6 5 2.6-1.3-7.3"/></svg>`
};

/* data */
const btSig = ms => (typeof AbortSignal !== "undefined" && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;
async function btJson(url, ms = 9000){
  const r = await fetch(url, { signal:btSig(ms), cache:"no-store" });
  if(!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function btLoad(name, fn){
  if(BT.busy[name]) return; BT.busy[name] = true;
  try{ await fn(); BT.at[name] = Date.now(); }
  catch(e){ BT.at[name] = Date.now() - (BT_TTL[name] || 60e3) + 20e3; }
  finally{ BT.busy[name] = false; }
}
const btLoadFx = () => btLoad("fx", async () => {
  let v = null, t = 0;
  if(S.fx && num(S.fx.usdkrw) && S.quotesAt && Date.now() - S.quotesAt < 30 * 60e3){ v = S.fx.usdkrw; t = S.fx.time ? S.fx.time * 1000 : S.quotesAt; }
  if(v == null && S.B && S.B.kind !== "local" && navigator.onLine){
    try{ const d = await S.B.invoke({ action:"quotes", symbols:[] }); if(d && d.fx && num(d.fx.usdkrw)){ S.fx = d.fx; v = d.fx.usdkrw; t = d.fx.time ? d.fx.time * 1000 : Date.now(); } }catch(e){}
  }
  if(v == null){ const j = await btJson("https://open.er-api.com/v6/latest/USD"); if(j && j.rates && num(j.rates.KRW)){ v = j.rates.KRW; t = (j.time_last_update_unix || 0) * 1000 || Date.now(); } }
  if(v == null) throw new Error("no fx");
  BT.fx = v; BT.fxAt = t;
});
const btLoadDom = () => btLoad("dom", async () => {
  const j = await btJson("https://api.coingecko.com/api/v3/global");
  const v = j && j.data && j.data.market_cap_percentage && j.data.market_cap_percentage.btc;
  if(!num(v)) throw new Error("no dominance"); BT.dom = v;
});
const btLoadFng = () => btLoad("fng", async () => {
  const j = await btJson("https://api.alternative.me/fng/?limit=1"); const d = j && j.data && j.data[0];
  if(!d || !isFinite(+d.value)) throw new Error("no fng");
  BT.fng = +d.value; BT.fngLabel = FNG_KO[String(d.value_classification || "").toLowerCase()] || String(d.value_classification || "");
});
async function btKlines(interval, limit){
  let last;
  for(const b of BN_REST){ try{ const j = await btJson(`${b}/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`, 10000); if(Array.isArray(j) && j.length) return j; }catch(e){ last = e; } }
  throw last || new Error("no klines");
}
const btLoadCandles = () => btLoad("candles", async () => { BT.candles = (await btKlines("2h", 12)).map(r => [+r[0], +r[1], +r[2], +r[3], +r[4]]); });
const btLoadHeight = () => btLoad("height", async () => {
  let h = null;
  for(const u of ["https://blockstream.info/api/blocks/tip/height", "https://blockchain.info/q/getblockcount?cors=true"]){
    try{ const r = await fetch(u, { signal:btSig(8000), cache:"no-store" }); if(r.ok){ const v = parseInt(await r.text(), 10); if(v > 800000){ h = v; break; } } }catch(e){}
  }
  if(h == null) throw new Error("no height");
  if(!num(BT.height) || h >= BT.height) BT.height = h;
});
async function btBlockstream(){
  const B = "https://blockstream.info/api";
  const [blocks, est, pool] = await Promise.all([btJson(B + "/blocks"), btJson(B + "/fee-estimates").catch(() => null), btJson(B + "/mempool").catch(() => null)]);
  if(!Array.isArray(blocks) || !blocks.length) throw new Error("no blocks");
  const f = est || {}, pick = (...ks) => { for(const kk of ks) if(num(f[kk])) return f[kk]; return null; };
  return {
    blocks:blocks.map(b => ({ height:b.height, ts:b.timestamp, size:b.size, tx:b.tx_count, pool:"" })),
    fees:{ eco:pick("144","504","1008"), low:pick("6","12","10"), mid:pick("3","4","2"), high:pick("1","2") },
    pending:pool ? { vsize:pool.vsize, count:pool.count, next:null } : null, src:"블록스트림", at:Date.now()
  };
}
const btLoadMp = () => btLoad("mp", async () => {
  let d = null;
  try{
    if(S.B && S.B.kind !== "local" && navigator.onLine){
      try{ d = await S.B.invoke({ action:"mempool" }); }catch(e){ d = null; }
      if(!d || !Array.isArray(d.blocks) || !d.blocks.length) d = null;
    }
    if(!d) d = await btBlockstream();
  }catch(e){ BT.mpErr = navigator.onLine ? "블록 정보를 불러오지 못했어요." : "인터넷에 연결되면 블록 정보를 볼 수 있어요."; throw e; }
  BT.mp = d; BT.mpErr = "";
  const top = d.blocks[0]; if(top && (!num(BT.height) || top.height > BT.height)) BT.height = top.height;
});
const btLoadRest = () => btLoad("rest", async () => {
  const jobs = [];
  if(Date.now() - BT.wsLast.kr > 15000){
    const ex = BT.ex;
    jobs.push(btJson(BT_EX[ex].rest).then(arr => { if(ex !== BT.ex) return; (arr || []).forEach(d => {
      if(d.market === "KRW-BTC" && isFinite(+d.trade_price)){ BT.krw = +d.trade_price; if(isFinite(+d.signed_change_rate)) BT.krwPct = +d.signed_change_rate * 100; }
      else if(d.market === "KRW-USDT" && isFinite(+d.trade_price)) BT.usdtKrw = +d.trade_price;
    }); }));
  }
  if(Date.now() - BT.wsLast.bn > 15000){
    jobs.push((async () => { for(const b of BN_REST){ try{ const d = await btJson(`${b}/api/v3/ticker/24hr?symbol=BTCUSDT`); if(isFinite(+d.lastPrice)){ BT.usd = +d.lastPrice; BT.usdPct = +d.priceChangePercent; return; } }catch(e){} } })());
  }
  await Promise.all(jobs.map(p => p.catch(() => {})));
});
const btRangeFor = () => BT.metric !== "price" && !BT_LONG.includes(BT.range) ? "1m" : BT.range;
const btChartKey = () => BT.metric + "|" + btRangeFor();
async function btLoadChart(){
  const metric = BT.metric, range = btRangeFor(), key = metric + "|" + range, c = BT.chart[key];
  const ttl = range === "1d" ? 60e3 : range === "7d" ? 5 * 60e3 : 60 * 60e3;
  if(c && Date.now() - c.at < (c.err ? 20e3 : ttl)) return;
  if(BT.busy["ch:" + key]) return; BT.busy["ch:" + key] = true;
  let pts = null, err = "";
  try{
    if(metric === "price" && BT_BN[range]){
      try{ const [iv, n] = BT_BN[range]; pts = (await btKlines(iv, n)).map(r => [+r[0], +r[4]]); }
      catch(e){ if(!BT_BCI[range] || range === "7d") throw e; }
    }
    if(!pts){
      const name = metric === "price" ? "market-price" : metric === "difficulty" ? "difficulty" : "hash-rate";
      const j = await btJson(`https://api.blockchain.info/charts/${name}?timespan=${BT_BCI[range]}&format=json&cors=true${range === "1m" ? "" : "&sampled=true"}`, 15000);
      pts = (j.values || []).map(v => [v.x * 1000, +v.y]).filter(p => num(p[1]) && p[1] > 0);
    }
    if(!pts || pts.length < 2) throw new Error("empty");
  }catch(e){ pts = null; err = navigator.onLine ? "차트를 불러오지 못했어요." : "인터넷에 연결되면 차트를 볼 수 있어요."; }
  finally{ BT.busy["ch:" + key] = false; }
  BT.chart[key] = { at:Date.now(), pts, err };
  if(BT.on && S.view === "bitcoin" && btChartKey() === key) btPaintChart();
}

/* live sockets */
function btConnect(which){
  if(!BT.on || BT.paused || BT.ws[which] || typeof WebSocket === "undefined") return;
  const ex = BT.ex, url = which === "kr" ? BT_EX[ex].ws : BN_WS[BT.wsFail.bn % 2];
  let ws; try{ ws = new WebSocket(url); }catch(e){ BT.wsFail[which]++; btRetry(which); return; }
  ws.binaryType = "arraybuffer"; BT.ws[which] = ws;
  ws.onopen = () => { if(which === "kr") ws.send(JSON.stringify([{ ticket:"sansiya-" + Math.random().toString(36).slice(2, 10) }, { type:"ticker", codes:["KRW-BTC","KRW-USDT"] }, { format:"DEFAULT" }])); };
  ws.onmessage = ev => {
    if(BT.ws[which] !== ws) return;
    let d; try{ d = JSON.parse(typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data)); }catch(e){ return; }
    if(which === "kr"){
      if(ex !== BT.ex || !d) return;
      if(d.code === "KRW-BTC" && isFinite(+d.trade_price)){ BT.krw = +d.trade_price; if(isFinite(+d.signed_change_rate)) BT.krwPct = +d.signed_change_rate * 100; }
      else if(d.code === "KRW-USDT" && isFinite(+d.trade_price)) BT.usdtKrw = +d.trade_price;
      else return;
    } else {
      if(!d || !isFinite(+d.c)) return;
      BT.usd = +d.c; if(isFinite(+d.P)) BT.usdPct = +d.P;
    }
    BT.wsLast[which] = Date.now();
    if(!BT.wsUp[which]){ BT.wsUp[which] = true; BT.wsFail[which] = 0; btConnToast(); }
    btSchedulePaint();
  };
  ws.onclose = () => {
    if(BT.ws[which] !== ws) return;
    BT.ws[which] = null; BT.wsUp[which] = false; btSchedulePaint();
    if(BT.on && !BT.paused){ BT.wsFail[which]++; btRetry(which); }
  };
  ws.onerror = () => { try{ ws.close(); }catch(e){} };
}
function btRetry(which){ clearTimeout(BT.retry[which]); const n = Math.max(1, BT.wsFail[which]); BT.retry[which] = setTimeout(() => btConnect(which), Math.min(30000, 1500 * 2 ** Math.min(n, 5))); }
function btClose(which){ clearTimeout(BT.retry[which]); const ws = BT.ws[which]; BT.ws[which] = null; BT.wsUp[which] = false; if(ws){ try{ ws.close(); }catch(e){} } }
function btConnToast(){
  if(BT.toasted || !BT.wsUp.kr || !BT.wsUp.bn || S.view !== "bitcoin") return;
  BT.toasted = true; toast(`${BT_EX[BT.ex].name} · 바이낸스 실시간 연결!`);
}
const btLiveState = () => (BT.wsUp.kr && BT.wsUp.bn) ? "on" : (BT.ws.kr || BT.ws.bn || BT.wsUp.kr || BT.wsUp.bn) ? "wait" : "off";
const btLiveLabel = () => ({ on:"실시간 연결됨", wait:"연결 중", off:"실시간 연결 끊김 · 잠시마다 새로 불러와요" })[btLiveState()];

function btStart(){
  if(BT.on) return;
  BT.on = true; BT.paused = document.visibilityState !== "visible";
  btLoadSnap();
  if(!BT.paused){ btConnect("kr"); btConnect("bn"); }
  btTick();
  BT.timer = setInterval(btTick, 4000);
}
function btStop(){
  if(!BT.on) return;
  BT.on = false; BT.menu = null; clearInterval(BT.timer); BT.timer = null;
  btClose("kr"); btClose("bn"); btSaveSnap();
}
function btPause(){ if(!BT.on || BT.paused) return; BT.paused = true; btClose("kr"); btClose("bn"); btSaveSnap(); }
function btResume(){ if(!BT.on || !BT.paused) return; BT.paused = false; BT.wsFail.kr = BT.wsFail.bn = 0; btConnect("kr"); btConnect("bn"); btTick(); }
function btTick(){
  if(!BT.on || BT.paused) return;
  const due = n => !BT.busy[n] && Date.now() - (BT.at[n] || 0) > BT_TTL[n];
  if(due("rest") && (Date.now() - BT.wsLast.kr > 15000 || Date.now() - BT.wsLast.bn > 15000)) btLoadRest().then(btPaintLive);
  if(due("fx")) btLoadFx().then(btPaintLive);
  if(due("dom")) btLoadDom().then(btPaintLive);
  if(due("fng")) btLoadFng().then(btPaintLive);
  if(due("candles")) btLoadCandles().then(btPaintCandles);
  if(due("height")) btLoadHeight().then(btPaintHalving);
  if((BT.tab === "blocks" || !BT.mp) && due("mp")) btLoadMp().then(() => { btPaintBlocks(); btPaintHalving(); });
  if(BT.tab === "overview") btLoadChart();
  if(Date.now() - (BT.at.snap || 0) > 60e3){ BT.at.snap = Date.now(); btSaveSnap(); }
  btSchedulePaint();
}

/* painting: live numbers update in place, parts re-render on their own */
function btSchedulePaint(){ if(BT.paintT) return; BT.paintT = setTimeout(() => { BT.paintT = null; btPaintLive(); }, 350); }
const setH = (id, html) => { const el = document.getElementById(id); if(el && el.innerHTML !== html) el.innerHTML = html; return el; };
const btKrwTxt = () => "₩" + bInt(BT.krw);
const btUsdTxt = () => "$ " + bInt(BT.usd);
const btChg = (id, pct) => `<span class="bt-chg ${bTone(pct)}" id="${id}">${BT_TRI[bTone(pct)]}${num(pct) ? Math.abs(pct).toFixed(2) + "%" : ""}</span>`;
function btPaintChg(id, pct){ const el = document.getElementById(id); if(!el) return; const c = "bt-chg " + bTone(pct); if(el.className !== c) el.className = c; setH(id, `${BT_TRI[bTone(pct)]}${num(pct) ? Math.abs(pct).toFixed(2) + "%" : ""}`); }
const btPct = (v, d = 2) => num(v) ? `${v.toFixed(d)}<small>%</small>` : "-";
function btLiveParts(){
  const pr = btPremium(), r = btRate(), usdt = BT.fxBasis === "usdt" && num(BT.usdtKrw);
  const krUsd = num(BT.krw) && num(r) ? BT.krw / r : null, bnKrw = num(BT.usd) && num(r) ? BT.usd * r : null;
  const dK = num(BT.krw) && num(bnKrw) ? BT.krw - bnKrw : null, dU = num(krUsd) && num(BT.usd) ? krUsd - BT.usd : null;
  return {
    btKrw:btKrwTxt(), btUsd:btUsdTxt(),
    btDom:btPct(BT.dom, 1), btFx:num(r) ? bFix(r, 1) : "-", btFxL:usdt ? "테더 환율" : "원/달러 환율", btPrem:btPct(pr), btFng:num(BT.fng) ? String(BT.fng) : "-",
    bcK:btKrwTxt(), bcU:"$" + bInt(BT.usd),
    bpBig:num(pr) ? `${bSign(pr)}${Math.abs(pr).toFixed(2)}%` : "-", bpBadge:num(pr) && pr < 0 ? "역프리미엄" : "프리미엄",
    bpKK:bInt(BT.krw), bpKU:bInt(krUsd), bpBK:bInt(bnKrw), bpBU:bInt(BT.usd),
    bpDK:num(dK) ? bSign(dK) + bInt(Math.abs(dK)) : "-", bpDU:num(dU) ? bSign(dU) + bInt(Math.abs(dU)) : "-",
    bpFx:num(r) ? bFix(r, 1) : "-", bpFxL:usdt ? `테더 시세(${BT_EX[BT.ex].name})` : "실시간 환율(원/달러)",
    bpFxT:usdt ? "실시간" : BT.fxAt ? `${bYmd(BT.fxAt)} 업데이트` : "",
    _pr:pr, _dK:dK
  };
}
function btPaintLive(){
  if(S.view !== "bitcoin") return;
  const v = btLiveParts();
  for(const [id, html] of Object.entries(v)) if(id[0] !== "_") setH(id, html);
  btPaintChg("btKrwChg", BT.krwPct); btPaintChg("btUsdChg", BT.usdPct); btPaintChg("bcKc", BT.krwPct); btPaintChg("bcUc", BT.usdPct);
  const live = document.getElementById("btLive");
  if(live){ const s = btLiveState(); if(live.dataset.live !== s){ live.dataset.live = s; live.title = btLiveLabel(); live.setAttribute("aria-label", btLiveLabel()); } }
  const pt = bTone(v._pr);
  ["bpBig", "bpBadge"].forEach(id => { const el = document.getElementById(id); if(el) el.dataset.tone = pt; });
  ["bpDK", "bpDU"].forEach(id => { const el = document.getElementById(id); if(el) el.dataset.tone = bTone(v._dK); });
  const mk = document.getElementById("bpMark"); if(mk) mk.style.left = (num(v._pr) ? Math.max(0, Math.min(100, (v._pr + 10) / 5 * 25)) : 50) + "%";
  btPaintCandles(true); btPaintConvert();
}
function btPaintCandles(liveOnly){
  const el = document.getElementById("btCandles"); if(!el) return;
  if(liveOnly && (!BT.candles || BT._cUsd === BT.usd)) return;
  BT._cUsd = BT.usd; el.outerHTML = btCandlesSvg();
}
function btPaintChart(){ const el = document.getElementById("btChart"); if(!el) return; el.innerHTML = btChartSvg(); bindBtChart(); }
function btPaintHalving(){
  if(S.view !== "bitcoin") return;
  setH("btHalving", btHalvingHtml()); setH("bkHalving", bkHalvingHtml());
}
function btPaintBlocks(){
  if(S.view !== "bitcoin" || BT.tab !== "blocks") return;
  setH("bkStrip", bkStripHtml()); setH("bkFeeHead", bkFeeHeadHtml()); setH("bkFees", bkFeesHtml()); setH("bkSrc", bkSrcHtml());
}
function btPaintMenus(){
  setH("btChHead", btChHeadHtml());
  setH("bcUnitWrap", bcUnitHtml());
}
function btPaintAll(){
  if(S.view !== "bitcoin") return;
  const body = document.getElementById("btBody"), a = document.activeElement;
  if(body && a && body.contains(a) && a.tagName === "INPUT"){ btPaintLive(); return; }
  if(body){ body.innerHTML = btBodyHtml(); bindBtChart(); }
  btPaintLive();
}

/* render */
function bitcoinHtml(){
  return `<div class="bt-wrap">
    <div class="bt-head">
      <h2 class="bt-title">${BT_COIN}<span>비트코인</span></h2>
      <span class="bt-live" id="btLive" data-live="${btLiveState()}" role="img" aria-label="${btLiveLabel()}" title="${btLiveLabel()}"></span>
      <button type="button" class="bt-gear" data-act="btSet" aria-label="비트코인 설정">${BT_GEAR}</button>
    </div>
    <div id="btBody">${btBodyHtml()}</div>
    <p class="bt-say" id="btSay">${esc(BT.saying)}</p>
    <p class="bt-src">시세 ${BT_EX[BT.ex].name}·바이낸스 실시간 · 도미넌스 코인게코 · 공포·탐욕 지수 alternative.me · 차트 바이낸스·blockchain.com · 블록 mempool.space·블록스트림. 투자 판단의 근거가 아니라 기록용이에요.</p>
    <nav class="bt-nav" aria-label="비트코인 메뉴">${BT_TABS.map(([v, l]) => `<button type="button" data-bttab="${v}" aria-current="${BT.tab === v}"><span class="ic">${BT_ICONS[v]}</span><span>${l}</span></button>`).join("")}</nav>
  </div>`;
}
function btBodyHtml(){
  return BT.tab === "blocks" ? btBlocksHtml() : BT.tab === "convert" ? btConvertHtml() : BT.tab === "premium" ? btPremiumHtml() : btOverviewHtml();
}
function btSetTab(tab){
  if(!BT_TABS.some(t => t[0] === tab)) return;
  BT.tab = tab; BT.menu = null; btSavePrefs();
  BT.saying = BT_SAYINGS[Math.floor(Math.random() * BT_SAYINGS.length)];
  if(S.view !== "bitcoin"){ S.view = "bitcoin"; render(); }
  else { setH("btBody", btBodyHtml()); setH("btSay", esc(BT.saying)); document.querySelectorAll(".bt-nav [data-bttab]").forEach(b => b.setAttribute("aria-current", String(b.dataset.bttab === tab))); bindBtChart(); btPaintLive(); }
  window.scrollTo({ top:0 });
  if(tab === "blocks") btLoadMp().then(() => { btPaintBlocks(); btPaintHalving(); });
  if(tab === "overview") btLoadChart();
}

/* overview */
function btOverviewHtml(){
  const v = btLiveParts();
  return `<section class="bt-top" aria-label="비트코인 시세">
      <div class="bt-prices">
        <div class="bt-pr"><b id="btKrw">${v.btKrw}</b>${btChg("btKrwChg", BT.krwPct)}</div>
        <div class="bt-pr"><b id="btUsd">${v.btUsd}</b>${btChg("btUsdChg", BT.usdPct)}</div>
      </div>
      ${btCandlesSvg()}
    </section>
    <div class="bt-tiles">
      <button type="button" class="bt-tile" data-bttile="dom"><span>도미넌스</span><b id="btDom">${v.btDom}</b></button>
      <button type="button" class="bt-tile" data-bttile="fx"><span id="btFxL">${v.btFxL}</span><b id="btFx">${v.btFx}</b></button>
      <button type="button" class="bt-tile" data-bttile="prem"><span>프리미엄</span><b id="btPrem">${v.btPrem}</b></button>
      <button type="button" class="bt-tile" data-bttile="fng"><span>공포·탐욕</span><b id="btFng">${v.btFng}</b></button>
    </div>
    <section class="bt-sec">
      <div class="bt-chhead" id="btChHead">${btChHeadHtml()}</div>
      <div class="bt-ch" id="btChart">${btChartSvg()}</div>
    </section>
    <section class="bt-sec" id="btHalving">${btHalvingHtml()}</section>`;
}
function btCandlesSvg(){
  const W = 120, H = 66, P = 6;
  const c = BT.candles;
  if(!c || c.length < 2) return `<svg class="bt-candles" id="btCandles" viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg>`;
  const rows = c.map((r, i) => i === c.length - 1 && num(BT.usd) ? [r[0], r[1], Math.max(r[2], BT.usd), Math.min(r[3], BT.usd), BT.usd] : r);
  const lo = Math.min(...rows.map(r => Math.min(r[1], r[4]))), hi = Math.max(...rows.map(r => Math.max(r[1], r[4])));
  const Y = v => P + (hi - v) / ((hi - lo) || 1) * (H - P * 2), step = (W - P * 2) / (rows.length - 1);
  const bars = rows.map((r, i) => {
    const x = (P + i * step).toFixed(1), y1 = Y(Math.max(r[1], r[4])), y2 = Math.max(Y(Math.min(r[1], r[4])), y1 + 0.5);
    return `<line x1="${x}" x2="${x}" y1="${y1.toFixed(1)}" y2="${y2.toFixed(1)}" class="${r[4] >= r[1] ? "u" : "d"}"/>`;
  }).join("");
  const up = rows[rows.length - 1][4] >= rows[0][1];
  return `<svg class="bt-candles" id="btCandles" viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 24시간 2시간 봉 ${rows.length}개, ${up ? "상승" : "하락"}">${bars}</svg>`;
}
function btChHeadHtml(){
  const ml = (BT_METRICS.find(m => m[0] === BT.metric) || BT_METRICS[0])[1], r = btRangeFor(), rl = (BT_RANGES.find(x => x[0] === r) || BT_RANGES[4])[1];
  const ranges = BT.metric === "price" ? BT_RANGES : BT_RANGES.filter(x => BT_LONG.includes(x[0]));
  return `<div class="bt-mw"><button type="button" class="bt-metric" data-btmenu="metric" aria-haspopup="menu" aria-expanded="${BT.menu === "metric"}">${BT_BARS}<span>${ml}</span>${BT_CHEV}</button>
      ${BT.menu === "metric" ? `<div class="bt-pop" role="menu" aria-label="차트 종류">${BT_METRICS.map(([v, l]) => `<button type="button" role="menuitemradio" aria-checked="${BT.metric === v}" data-btmetric="${v}">${l}</button>`).join("")}</div>` : ""}</div>
    <div class="bt-mw end"><button type="button" class="bt-range" data-btmenu="range" aria-haspopup="menu" aria-expanded="${BT.menu === "range"}" aria-label="기간 ${rl}">${BT_CHEV}<span>${rl}</span></button>
      ${BT.menu === "range" ? `<div class="bt-pop end" role="menu" aria-label="기간">${ranges.map(([v, l]) => `<button type="button" role="menuitemradio" aria-checked="${r === v}" data-btrange="${v}">${l}</button>`).join("")}</div>` : ""}</div>`;
}
let BTCH = null;
function btChartSvg(){
  BTCH = null;
  const key = btChartKey(), c = BT.chart[key], metric = BT.metric, range = btRangeFor();
  if(!c) return `<div class="bt-ch-msg">차트를 불러오는 중…</div>`;
  if(c.err || !c.pts) return `<div class="bt-ch-msg">${esc(c.err || "차트 데이터가 없어요.")}</div>`;
  const pts = c.pts, vals = pts.map(p => p[1]);
  const W = Math.max(300, Math.min(640, window.innerWidth || 600)), H = 196, T = 44, B = 14;
  let mn = Math.min(...vals), mx = Math.max(...vals); if(mn === mx){ mn *= 0.98; mx *= 1.02; }
  const X = i => i * W / (pts.length - 1), Y = v => T + (mx - v) / (mx - mn) * (H - T - B);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join("");
  const imx = vals.indexOf(mx), mxTxt = btFmtMetric(mx, metric);
  const lw = mxTxt.length * 8.2 + 22, lx = Math.max(lw / 2 + 2, Math.min(W - lw / 2 - 2, X(imx))), ly = Math.max(4, Y(mx) - 38);
  const grid = Array.from({ length:7 }, (_, i) => { const y = (8 + i * (H - 16) / 6).toFixed(1); return `<line x1="0" x2="${W}" y1="${y}" y2="${y}"/>`; }).join("");
  const fd = t => { const x = new Date(t); return range === "1d" ? `${pad(x.getHours())}:${pad(x.getMinutes())}` : (range === "7d" || range === "1m") ? `${x.getMonth() + 1}/${x.getDate()} ${pad(x.getHours())}:${pad(x.getMinutes())}` : bYmd(t); };
  const ml = (BT_METRICS.find(m => m[0] === metric) || BT_METRICS[0])[1], rl = (BT_RANGES.find(x => x[0] === range) || [0, ""])[1];
  BTCH = { pts, X, Y, W, H, T, fd, metric };
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="비트코인 ${ml} ${rl} 차트, 최고 ${esc(mxTxt)}">
      <defs><linearGradient id="btGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--bt-orange)" stop-opacity=".22"/><stop offset="1" stop-color="var(--bt-orange)" stop-opacity="0"/></linearGradient>
        <filter id="btGlow" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="3.5"/></filter></defs>
      <g class="bt-grid">${grid}</g>
      <path d="${d}L${W} ${H}L0 ${H}Z" fill="url(#btGrad)"/>
      <path d="${d}" class="bt-glow" filter="url(#btGlow)"/>
      <path d="${d}" class="bt-line"/>
      <circle cx="${X(imx).toFixed(1)}" cy="${Y(mx).toFixed(1)}" r="4.5" class="bt-mxdot"/>
      <g class="bt-mxlab"><rect x="${(lx - lw / 2).toFixed(1)}" y="${ly.toFixed(1)}" width="${lw.toFixed(1)}" height="27" rx="7"/><text x="${lx.toFixed(1)}" y="${(ly + 18.5).toFixed(1)}" text-anchor="middle">${esc(mxTxt)}</text></g>
      <g class="bt-cross" visibility="hidden"><line y1="0" y2="${H}"/><circle r="5"/></g>
      <rect class="bt-hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    </svg><div class="st-tip" hidden></div>`;
}
function bindBtChart(){
  const box = document.getElementById("btChart"); if(!box || !BTCH) return;
  const svg = box.querySelector("svg"), tip = box.querySelector(".st-tip"), g = svg && svg.querySelector(".bt-cross");
  if(!svg || !g || !tip) return;
  const geo = BTCH;
  const move = ev => {
    const r = svg.getBoundingClientRect(); if(!r.width) return;
    let i = Math.round((ev.clientX - r.left) / r.width * (geo.pts.length - 1));
    i = Math.max(0, Math.min(geo.pts.length - 1, i));
    const px = geo.X(i), py = geo.Y(geo.pts[i][1]);
    g.setAttribute("visibility", "visible");
    const ln = g.querySelector("line"); ln.setAttribute("x1", px); ln.setAttribute("x2", px);
    const c = g.querySelector("circle"); c.setAttribute("cx", px); c.setAttribute("cy", py);
    tip.textContent = `${geo.fd(geo.pts[i][0])} · ${btFmtMetric(geo.pts[i][1], geo.metric)}`; tip.hidden = false;
    const br = box.getBoundingClientRect(), half = tip.offsetWidth / 2, left = r.left - br.left + px / geo.W * r.width;
    tip.style.left = Math.max(half, Math.min(br.width - half, left)) + "px";
    tip.style.top = Math.max(24, r.top - br.top + py / geo.H * r.height - 10) + "px";
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", () => { g.setAttribute("visibility", "hidden"); tip.hidden = true; });
}
function btHalvingHtml(){
  const hv = btHalving();
  const segs = Array.from({ length:24 }, (_, i) => `<i class="${hv && i < Math.floor(hv.p * 24) ? "on" : ""}"></i>`).join("");
  return `<h3 class="bt-h3">${BT_HALF}<span>비트코인 반감기</span></h3>
    <div class="bt-hbar" role="img" aria-label="${hv ? `반감기 진행 ${(hv.p * 100).toFixed(2)}%` : "반감기 정보를 불러오는 중"}"><div class="bt-segs">${segs}</div><b>${hv ? (hv.p * 100).toFixed(2) + "%" : "-"}</b></div>
    <div class="bt-hstats">${btCubes()}
      <div><span>현재 블록</span><b>${hv ? bInt(hv.h) : "-"}</b></div>
      <div><span>남은 블록</span><b>${hv ? bInt(hv.remain) : "-"}</b></div>
      <div><span>예상일</span><b>${hv ? bYmd(hv.est) : "-"}</b></div>
    </div>`;
}

/* blocks */
function btBlocksHtml(){
  return `<section class="bk" aria-label="비트코인 블록과 트랜잭션 수수료">
    <div class="bk-strip" id="bkStrip">${bkStripHtml()}</div>
    <section class="bt-sec bk-feesec">
      <div class="bk-feehead" id="bkFeeHead">${bkFeeHeadHtml()}</div>
      <div class="bk-fees" id="bkFees">${bkFeesHtml()}</div>
    </section>
    <form class="bk-search" id="bkSearch" role="search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="bkQ" type="search" placeholder="트랜잭션을 검색해 보세요" autocomplete="off" spellcheck="false" aria-label="블록 높이, 트랜잭션 ID 또는 주소">
      <button type="button" class="bk-paste" data-act="bkPaste" aria-label="붙여넣기"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="12" height="16" rx="2"/><path d="M9 4V3h4v1M14 13h7M18 10l3 3-3 3"/></svg></button>
      <button type="submit" class="bk-go">검색</button>
    </form>
    <section class="bk-card" id="bkHalving">${bkHalvingHtml()}</section>
    <section class="bk-card bk-learn">
      <h3>비트코인 블록 이해하기</h3>
      <p>블록, 채굴, 반감기, 수수료까지 비트코인 네트워크의 기본 개념을 짧게 정리했어요.</p>
      <details><summary>비트코인 블록이란?</summary><p>비트코인 거래를 약 10분마다 한 묶음으로 모아 장부에 덧붙인 것이 블록이에요. 블록마다 거래 목록과 바로 앞 블록의 지문(해시)이 들어 있어서, 지난 기록을 몰래 고치려면 그 뒤 블록을 전부 다시 만들어야 해요. 위의 주황색 상자 하나가 블록 하나이고, 숫자는 첫 블록부터 센 순번(블록 높이)이에요.</p></details>
      <details><summary>채굴(Mining)은 어떻게 이뤄지나요?</summary><p>채굴자들은 정해진 조건을 만족하는 숫자를 찾는 계산 경쟁을 해요. 먼저 찾은 쪽이 다음 블록을 만들고, 새로 발행되는 비트코인과 블록에 담긴 거래 수수료를 보상으로 받아요. 난이도는 2,016블록(약 2주)마다 조정돼서 블록 간격이 평균 10분 안팎으로 유지돼요.</p></details>
      <details><summary>반감기(Halving)란 무엇인가요?</summary><p>21만 블록(약 4년)마다 블록 보상이 절반으로 줄어드는 규칙이에요. 2024년 4월 840,000번째 블록에서 보상이 3.125 BTC가 됐고, 다음 반감기인 1,050,000번째 블록부터는 1.5625 BTC가 돼요. 이렇게 발행량이 줄어들어 전체 발행량은 2,100만 개를 넘지 않아요.</p></details>
      <details><summary>트랜잭션 수수료는 왜 존재하나요?</summary><p>블록 하나에 담을 수 있는 공간이 정해져 있어서, 채굴자는 바이트당 수수료(sat/vB)를 많이 낸 거래부터 담아요. 급하면 수수료를 높게, 느긋하면 낮게 내면 돼요. 블록 보상이 줄어드는 만큼 수수료는 장기적으로 채굴자의 수입을 받쳐 주는 역할도 해요.</p></details>
    </section>
    <p class="bt-src" id="bkSrc">${bkSrcHtml()}</p>
  </section>`;
}
const bkSrcHtml = () => BT.mp ? `블록·수수료 ${esc(BT.mp.src || "")} · ${fmtAgo(BT.mp.at || Date.now())} 기준` : "";
function bkStripHtml(){
  const mp = BT.mp;
  if(!mp) return BT.mpErr ? `<p class="bk-msg">${esc(BT.mpErr)}</p>` : `<div class="bk-cube wait" aria-hidden="true"></div><span class="bk-div" aria-hidden="true"></span>${Array.from({ length:3 }, () => `<div class="bk-cube ghost" aria-hidden="true"></div>`).join("")}`;
  const nx = mp.pending && mp.pending.next;
  const pend = `<div class="bk-cube wait" aria-label="다음 블록 예상"><b>다음 블록</b><span>${nx && num(nx.median) ? `~${bFee(nx.median)} sat/vB` : mp.fees && num(mp.fees.high) ? `~${bFee(mp.fees.high)} sat/vB` : ""}</span><span>${nx && num(nx.n) ? `${bInt(nx.n)}건` : mp.pending && num(mp.pending.count) ? `대기 ${bInt(mp.pending.count)}건` : ""}</span><span>약 10분 후</span></div>`;
  return pend + `<span class="bk-div" aria-hidden="true"></span>` + mp.blocks.slice(0, 15).map(b => `<a class="bk-cube" href="https://blockstream.info/block-height/${b.height}" target="_blank" rel="noopener noreferrer" aria-label="블록 ${b.height}"><b>${b.height}</b><span>${num(b.size) ? (b.size / 1e6).toFixed(2).replace(/0$/, "") + "MB" : ""}</span><span>${esc(b.pool || (num(b.tx) ? bInt(b.tx) + "건" : ""))}</span><span class="ago">${num(b.ts) ? bAgo(b.ts) : ""}</span></a>`).join("");
}
function bkFeeHeadHtml(){
  const p = BT.mp && BT.mp.pending, blocks = p && num(p.vsize) ? Math.max(1, Math.round(p.vsize / 1e6)) : null;
  const lv = blocks == null ? "" : blocks <= 3 ? "한산" : blocks <= 30 ? "보통" : "혼잡";
  return `<h3>실시간 트랜잭션 수수료</h3>${blocks != null ? `<span class="bk-cong"><i class="dots" aria-hidden="true"><i></i><i></i><i></i></i>${lv} · 약 <b>${bInt(blocks)}</b> 블록 대기</span>` : ""}`;
}
function bkFeesHtml(){
  const f = (BT.mp && BT.mp.fees) || {};
  return [["최하위 순위","eco"],["낮은 우선 순위","low"],["중간 우선 순위","mid"],["높은 우선 순위","high"]].map(([l, kk]) => `<div><span>${l}</span><b>${bFee(f[kk])}<small>sat/vB</small></b></div>`).join("");
}
function bkHalvingHtml(){
  const hv = btHalving();
  return `<div class="bk-hh"><h3>반감기 현황</h3><b>${hv ? (hv.p * 100).toFixed(2) + "%" : "-"}</b></div>
    <div class="bk-hbar" role="img" aria-label="${hv ? `반감기 진행 ${(hv.p * 100).toFixed(2)}%` : "불러오는 중"}"><i style="width:${hv ? (hv.p * 100).toFixed(2) : 0}%"></i></div>
    <div class="bk-hl"><span>현재 <b>${hv ? bInt(hv.h) : "-"}</b> 블록</span><span>다음 반감기까지 <b>${hv ? bInt(hv.remain) : "-"}</b> 블록</span></div>
    <div class="bk-hl"><span>예상일 <b>${hv ? bYmd(hv.est) : "-"}</b></span>${hv ? `<span>다음 보상 <b>${hv.reward}</b> BTC</span>` : ""}</div>`;
}
function btSearch(){
  const q = (($("#bkQ") || {}).value || "").trim();
  let path = null;
  if(/^\d{1,7}$/.test(q)) path = "block-height/" + q;
  else if(/^0{8}[0-9a-f]{56}$/i.test(q)) path = "block/" + q;
  else if(/^[0-9a-f]{64}$/i.test(q)) path = "tx/" + q;
  else if(/^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/i.test(q)) path = "address/" + q;
  if(!path){ toast(q ? "블록 높이, 트랜잭션 ID, 주소 중 하나를 적어 주세요." : "검색할 내용을 적어 주세요."); return; }
  window.open("https://blockstream.info/" + path, "_blank", "noopener");
}

/* convert */
function bcCalc(){
  const a = parseFloat(String(BT.conv.amt).replace(/,/g, "")), P = 1 + (parseFloat(BT.conv.prem) || 0) / 100;
  const krw = num(BT.krw) ? BT.krw * P : null, usd = BT.usd;
  if(!isFinite(a)) return {};
  const btc = BT.conv.unit === "BTC" ? a : BT.conv.unit === "SATS" ? a / 1e8 : BT.conv.unit === "KRW" ? (num(krw) && krw > 0 ? a / krw : null) : (num(usd) && usd > 0 ? a / usd : null);
  return btc == null ? {} : { btc, krw:num(krw) ? btc * krw : null, usd:num(usd) ? btc * usd : null, sats:btc * 1e8 };
}
const bcFmtBtc = v => num(v) ? v.toLocaleString("en-US", { maximumFractionDigits:8 }) : "-";
function bcRows(){
  const u = BT.conv.unit, keys = u === "BTC" ? ["krw","usd","sats"] : u === "SATS" ? ["krw","usd","btc"] : u === "KRW" ? ["btc","usd","sats"] : ["krw","btc","sats"];
  const c = bcCalc(), fx = BT.fx;
  const def = {
    krw:["원화(₩):", bInt(c.krw), num(BT.krw) ? `* ${BT_EX[BT.ex].name} 1비트코인 = ${bInt(BT.krw)}원` : ""],
    usd:["달러($):", num(c.usd) ? bFix(c.usd, 2) : "-", num(fx) ? `* 1달러 = ${bInt(fx)}원` : ""],
    sats:["사토시:", bInt(c.sats), "* 1비트코인 = 100,000,000사토시"],
    btc:["비트코인(₿):", bcFmtBtc(c.btc), num(BT.usd) ? `* 1비트코인 = $${bInt(BT.usd)}` : ""]
  };
  return keys.map(kk => ({ key:kk, label:def[kk][0], val:def[kk][1], foot:def[kk][2], raw:c[kk] }));
}
function bcRowsHtml(){
  return bcRows().map(r => `<div class="bc-row"><span class="lb">${r.label}</span><b id="bc-${r.key}">${r.val}</b><button type="button" class="bc-copy" data-btcopy="${r.key}" aria-label="${r.label.replace(/[:()₩$₿]/g, "")} 금액 복사">${BT_COPY}</button><p class="ft">${esc(r.foot)}</p></div>`).join("");
}
function bcUnitHtml(){
  const u = (BT_UNITS.find(x => x[0] === BT.conv.unit) || BT_UNITS[0])[1];
  return `<button type="button" class="bc-unit" data-btmenu="unit" aria-haspopup="menu" aria-expanded="${BT.menu === "unit"}" aria-label="단위 ${u}">${u}${BT_CHEV}</button>
    ${BT.menu === "unit" ? `<div class="bt-pop end up" role="menu" aria-label="단위">${BT_UNITS.map(([v, l]) => `<button type="button" role="menuitemradio" aria-checked="${BT.conv.unit === v}" data-btunit="${v}">${l}</button>`).join("")}</div>` : ""}`;
}
function btConvertHtml(){
  const v = btLiveParts();
  return `<section class="bc" aria-label="비트코인 계산기">
    <div class="bc-strip">
      <span><i class="bt-b">₿</i><b id="bcK">${v.bcK}</b>${btChg("bcKc", BT.krwPct)}</span>
      <span><i class="bt-b">₿</i><b id="bcU">${v.bcU}</b>${btChg("bcUc", BT.usdPct)}</span>
    </div>
    <div class="bc-rows" id="bcRows">${bcRowsHtml()}</div>
    <div class="bc-in">
      <div class="bc-amt">
        <button type="button" class="bc-x" data-act="bcClear" aria-label="지우기">×</button>
        <input id="bcAmt" type="text" inputmode="decimal" autocomplete="off" value="${esc(BT.conv.amt)}" aria-label="계산할 금액">
        <div class="bt-mw end" id="bcUnitWrap">${bcUnitHtml()}</div>
      </div>
      <div class="bc-prem">
        <span class="t">프리미엄<small title="원화 금액에 프리미엄(%)을 더하거나 빼서 계산해요."><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 9v5M10 6.2v.1"/></svg>조정(%)</small></span>
        <input id="bcPrem" type="text" inputmode="decimal" autocomplete="off" value="${esc(BT.conv.prem)}" aria-label="프리미엄 퍼센트">
        <button type="button" class="bc-step" data-bcprem="-0.1" aria-label="프리미엄 0.1% 내리기">−</button><button type="button" class="bc-step" data-bcprem="0.1" aria-label="프리미엄 0.1% 올리기">+</button>
      </div>
    </div>
  </section>`;
}
function btPaintConvert(){
  if(BT.tab !== "convert" || !document.getElementById("bcRows")) return;
  const rows = bcRows(), have = [...document.querySelectorAll("#bcRows [data-btcopy]")].map(b => b.dataset.btcopy).join();
  if(have !== rows.map(r => r.key).join()){ setH("bcRows", bcRowsHtml()); return; }
  rows.forEach(r => { setH("bc-" + r.key, r.val); const ft = document.querySelector(`#bc-${r.key} ~ .ft`); if(ft && ft.textContent !== r.foot) ft.textContent = r.foot; });
}
function btCopy(key){
  const r = bcRows().find(x => x.key === key); if(!r || !num(r.raw)) return;
  const txt = key === "btc" ? String(+r.raw.toFixed(8)) : key === "usd" ? r.raw.toFixed(2) : String(Math.round(r.raw));
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast(`${txt} 복사했어요.`), () => toast("복사하지 못했어요."));
}

/* premium */
function btPremiumHtml(){
  const v = btLiveParts(), pt = bTone(v._pr), ex = BT_EX[BT.ex];
  const pos = num(v._pr) ? Math.max(0, Math.min(100, (v._pr + 10) / 5 * 25)) : 50;
  return `<section class="bp" aria-label="김치 프리미엄">
    <p class="bp-eye">김치 프리미엄</p>
    <h3 class="bp-ttl">비트코인 한국 프리미엄</h3>
    <p class="bp-desc">국내외 거래소의 실시간 비트코인 가격과 한국 프리미엄을 확인하세요.</p>
    <div class="bp-hero"><span class="bp-badge" id="bpBadge" data-tone="${pt}">${v.bpBadge}</span><b class="bp-big" id="bpBig" data-tone="${pt}">${v.bpBig}</b></div>
    <div class="bp-gauge" aria-hidden="true"><i id="bpMark" style="left:${pos}%"></i></div>
    <div class="bp-scale" aria-hidden="true"><span>-10%</span><span>0</span><span>+10%</span></div>
    <div class="bp-table">
      <div class="bp-r head"><span>구분</span><span>원화</span><span>달러</span></div>
      <div class="bp-r"><span><b>한국 가격</b><small>${ex.tag}</small></span><span id="bpKK">${v.bpKK}</span><span id="bpKU">${v.bpKU}</span></div>
      <div class="bp-r"><span><b>해외 가격</b><small>바이낸스</small></span><span id="bpBK">${v.bpBK}</span><span id="bpBU">${v.bpBU}</span></div>
      <div class="bp-r spread"><span><b>프리미엄 차이</b><small>국내 − 해외</small></span><span id="bpDK" data-tone="${bTone(v._dK)}">${v.bpDK}</span><span id="bpDU" data-tone="${bTone(v._dK)}">${v.bpDU}</span></div>
      <div class="bp-fx"><span><b id="bpFxL">${v.bpFxL}</b><small id="bpFxT">${v.bpFxT}</small></span><span><b id="bpFx">${v.bpFx}</b> 원</span></div>
    </div>
    <p class="bp-note">프리미엄 = 국내 가격 ÷ (바이낸스 가격 × ${BT.fxBasis === "usdt" ? "테더 원화 시세" : "환율"}) − 1 · 기준은 오른쪽 위 톱니바퀴에서 바꿀 수 있어요.</p>
  </section>`;
}

/* settings sheet */
function openBtSet(){ if(OV) endOvKeepHistory(); OV = { kind:"btset" }; renderBtSet(); }
function renderBtSet(){
  showOv(`<div class="sheetbox" role="dialog" aria-modal="true" aria-label="비트코인 설정">
    <div class="sb-head"><span class="ttl">비트코인 설정</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body"><div class="set">
      <section><h3>국내 거래소</h3><div class="sv">
        <div class="seg" role="group" aria-label="국내 거래소">${Object.entries(BT_EX).map(([v, e]) => `<button type="button" data-btex="${v}" aria-pressed="${BT.ex === v}">${e.name}</button>`).join("")}</div>
        <p class="note">원화 시세와 김치 프리미엄 계산에 써요. 해외 가격은 바이낸스 시세예요.</p>
      </div></section>
      <section><h3>프리미엄 환율</h3><div class="sv">
        <div class="seg" role="group" aria-label="프리미엄 환율 기준"><button type="button" data-btfx="bank" aria-pressed="${BT.fxBasis === "bank"}">은행 환율</button><button type="button" data-btfx="usdt" aria-pressed="${BT.fxBasis === "usdt"}">테더 시세</button></div>
        <p class="note">은행 환율은 야후 파이낸스의 원/달러 환율, 테더 시세는 ${BT_EX[BT.ex].name}의 테더(USDT) 원화 가격이에요. 테더 기준으로 보면 프리미엄이 보통 더 작게 나와요.</p>
      </div></section>
      <section><h3>데이터</h3><div class="sv">
        <p class="note">시세는 ${BT_EX[BT.ex].name}·바이낸스 공개 실시간 연결, 도미넌스 코인게코, 공포·탐욕 지수 alternative.me, 차트 바이낸스·blockchain.com, 블록·수수료 mempool.space(안 되면 블록스트림)에서 받아요. 키나 로그인이 필요 없는 공개 정보만 써요.</p>
      </div></section>
    </div></div></div>`);
}
function btSetEx(ex){
  if(!BT_EX[ex] || ex === BT.ex) return;
  BT.ex = ex; BT.krw = BT.krwPct = BT.usdtKrw = null; BT.wsLast.kr = 0; BT.at.rest = 0; BT.toasted = false;
  btSavePrefs(); btClose("kr"); BT.wsFail.kr = 0; btConnect("kr"); btTick();
  if(S.view === "bitcoin"){ setH("btBody", btBodyHtml()); bindBtChart(); btPaintLive(); const src = document.querySelector(".bt-src"); if(src) src.textContent = src.textContent.replace(/^시세 \S+?·/, `시세 ${BT_EX[ex].name}·`); }
}
function btTile(kind){
  if(kind === "prem"){ btSetTab("premium"); return; }
  if(kind === "dom") toast(num(BT.dom) ? `비트코인 도미넌스 ${BT.dom.toFixed(1)}% · 전체 암호화폐 시가총액 중 비트코인 비중` : "도미넌스를 불러오는 중이에요.");
  if(kind === "fx") toast(BT.fxBasis === "usdt" ? `${BT_EX[BT.ex].name} 테더(USDT) 원화 시세` : `은행 기준 원/달러 환율${BT.fxAt ? ` · ${bYmd(BT.fxAt)}` : ""}`);
  if(kind === "fng") toast(num(BT.fng) ? `공포·탐욕 지수 ${BT.fng} · ${BT.fngLabel} (0 극단적 공포 ~ 100 극단적 탐욕)` : "공포·탐욕 지수를 불러오는 중이에요.");
}
function btPaste(){
  (navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText() : Promise.reject())
    .then(t => { const i = $("#bkQ"); if(i){ i.value = String(t || "").trim(); i.focus(); } })
    .catch(() => toast("붙여넣기 권한이 없어요. 입력칸을 길게 눌러 붙여넣어 주세요."));
}
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") btResume(); else btPause(); });
window.addEventListener("pagehide", () => { if(BT.on) btSaveSnap(); });

/* ---------- events ---------- */
function setFilter(key, v){ S.filter[key] = v; if(S.view !== "archive") S.view = "archive"; render(); window.scrollTo({ top:0 }); }
document.addEventListener("click", ev => {
  if(ev.target.matches && ev.target.matches("[data-ovbg]")){ closeOv(); return; }
  if(BT.menu && !(ev.target.closest && ev.target.closest(".bt-pop,[data-btmenu]"))){ BT.menu = null; btPaintMenus(); }
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
  // photos & bookmarks
  if(ds.fav){ const c = ds.fav.indexOf(":"); toggleFav(ds.fav.slice(0, c), ds.fav.slice(c + 1)); return; }
  if(ds.photo){ openPhoto(ds.photo); return; }
  if(ds.phnav){ phNav(+ds.phnav); return; }
  if(ds.phtopic){ phSetTopic(ds.phtopic); return; }
  // SNS
  if(ds.snstopic){ S.snsTopic = ds.snstopic; SNS.limit = SNS_PAGE; savePrefs(); render(); const h = document.querySelector(".xf-head"); if(h && h.getBoundingClientRect().top <= (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top-h")) || 0) + 1) window.scrollTo({ top:0 }); return; }
  if(ds.snstr){ const id = ds.snstr; if(SNS.ko.has(id)) SNS.ko.delete(id); else SNS.ko.add(id); snsRepaint(id); return; }
  if(ds.snsbm){ snsToggleBookmark(ds.snsbm); return; }
  if(ds.snsshare){ snsShare(ds.snsshare); return; }
  if(ds.snsmore){ snsMore(); return; }
  if(ds.snsretry){ snsLoad(true); render(); return; }
  if(ds.pvtopic){ t.setAttribute("aria-pressed", String(t.getAttribute("aria-pressed") !== "true")); return; }
  if(ds.phgo){ const k = ds.phgo; closeOv(); if(S.view !== "photos"){ S.view = "photos"; } S.phQ = ""; S.phFav = false; S.phTopic = k; S.phLimit = PH_PAGE; savePrefs(); render(); window.scrollTo({ top:0 }); return; }
  if(ds.bmtab){ S.bmTab = ds.bmtab; savePrefs(); render(); return; }
  if(ds.bmtag){ S.bmTag = S.bmTag === ds.bmtag ? null : ds.bmtag; render(); return; }
  if(ds.bmedit){ openBmForm(ds.bmedit); return; }
  // bitcoin
  if(ds.bttab){ btSetTab(ds.bttab); return; }
  if(ds.btmenu){ BT.menu = BT.menu === ds.btmenu ? null : ds.btmenu; btPaintMenus(); return; }
  if(ds.btmetric){ BT.metric = ds.btmetric; BT.menu = null; btSavePrefs(); btPaintMenus(); btPaintChart(); btLoadChart(); return; }
  if(ds.btrange){ BT.range = ds.btrange; BT.menu = null; btSavePrefs(); btPaintMenus(); btPaintChart(); btLoadChart(); return; }
  if(ds.btunit){ BT.conv.unit = ds.btunit; BT.menu = null; btSavePrefs(); btPaintMenus(); btPaintConvert(); const i = $("#bcAmt"); if(i) i.focus(); return; }
  if(ds.btcopy){ btCopy(ds.btcopy); return; }
  if(ds.bcprem){ BT.conv.prem = String(Math.round(((parseFloat(BT.conv.prem) || 0) + +ds.bcprem) * 10) / 10); const i = $("#bcPrem"); if(i) i.value = BT.conv.prem; btPaintConvert(); return; }
  if(ds.bttile){ btTile(ds.bttile); return; }
  if(ds.btex){ btSetEx(ds.btex); renderBtSet(); return; }
  if(ds.btfx){ BT.fxBasis = ds.btfx; btSavePrefs(); renderBtSet(); btPaintAll(); return; }
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
    case "phFav": S.phFav = !S.phFav; S.phLimit = PH_PAGE; render(); break;
    case "phEdit": OV.edit = true; OV.confirm = false; renderPhoto(); { const c = $("#ph-cap"); if(c) c.focus(); } break;
    case "phEditNo": OV.edit = false; renderPhoto(); break;
    case "phDel": OV.confirm = true; OV.edit = false; renderPhoto(); break;
    case "phDelNo": OV.confirm = false; renderPhoto(); break;
    case "phDelYes": deletePhoto(); break;
    case "bmDel": OV.draft = bmDraft(); OV.confirm = true; renderBmForm(); break;
    case "bmDelNo": OV.confirm = false; renderBmForm(); break;
    case "bmDelYes": deleteBm(); break;
    case "btSet": openBtSet(); break;
    case "bcClear": { BT.conv.amt = ""; const i = $("#bcAmt"); if(i){ i.value = ""; i.focus(); } btPaintConvert(); break; }
    case "bkPaste": btPaste(); break;
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
/* 새 기록 옆 시계 — 서울 시간(UTC+9, 서머타임 없음) 기준, 분이 바뀔 때마다 갱신 */
const KST_DAYS = ["일", "월", "화", "수", "목", "금", "토"];
let clockTimer = 0;
function kstParts(ms = Date.now()){
  const k = new Date(ms + 9 * 3600e3), p2 = n => String(n).padStart(2, "0");
  const h24 = k.getUTCHours(), h12 = h24 % 12 || 12;
  const hm = `${p2(h12)}:${p2(k.getUTCMinutes())}`, ampm = h24 < 12 ? "a.m" : "p.m";
  return {
    hm, ampm, time: `${hm} ${ampm}`,
    date: `${k.getUTCFullYear()}-${p2(k.getUTCMonth() + 1)}-${p2(k.getUTCDate())} (${KST_DAYS[k.getUTCDay()]})`,
    iso: `${k.getUTCFullYear()}-${p2(k.getUTCMonth() + 1)}-${p2(k.getUTCDate())}T${p2(h24)}:${p2(k.getUTCMinutes())}+09:00`
  };
}
function tickClock(){
  clearTimeout(clockTimer);
  const el = $("#clock"); if(!el) return;
  const now = Date.now(), t = kstParts(now);
  const b = el.firstElementChild, s = el.lastElementChild;
  if(b.textContent !== t.hm + t.ampm) b.innerHTML = `${t.hm}<small class="ampm">${t.ampm}</small>`;
  if(s.textContent !== t.date) s.textContent = t.date;
  el.dateTime = t.iso;
  el.setAttribute("aria-label", `서울 ${t.date} ${t.time}`);
  clockTimer = setTimeout(tickClock, 60000 - (now % 60000) + 50);
}
tickClock();
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") tickClock(); });
$("#setBtn").addEventListener("click", () => openSettings());
$("#syncBtn").addEventListener("click", () => { if(S.B && S.B.kind !== "local") pull(); });
document.addEventListener("keydown", ev => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
  if(ev.key === "Escape" && OV){ closeOv(); return; }
  if(OV && OV.kind === "photo" && !typing && !OV.edit && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")){ ev.preventDefault(); phNav(ev.key === "ArrowLeft" ? -1 : 1); return; }
  if(ev.key === "Escape" && BT.menu){ BT.menu = null; btPaintMenus(); return; }
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
  if(t.id === "phFile" && t.files.length){ const fs = [...t.files]; t.value = ""; uploadAlbum(fs); }
  if(t.id === "f-cat" && OV){ OV.draft.cat = t.value; }
  if(t.id === "importFile" && t.files.length){
    const f = t.files[0];
    f.text().then(txt => {
      let res; try{ res = parseImport(txt); }catch(e){ toast("산시야 백업 파일(JSON)이 아니에요."); return; }
      if(!res.entries.length && !res.stocks.length && !res.divs.length && !res.photos.length && !res.bookmarks.length){ toast("가져올 기록이 없어요."); return; }
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
  else if(ev.target.id === "bkSearch") btSearch();
  else if(ev.target.id === "bmAdd") addLink();
  else if(ev.target.id === "bmForm") saveBm();
  else if(ev.target.id === "phForm") savePhotoEdit();
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
  if(t.id === "phQ"){ S.phQ = t.value; S.phLimit = PH_PAGE; setH("phBody", phBodyHtml()); bindPhotoMore(); hydrateImages(); }
  if(t.id === "bcAmt"){ BT.conv.amt = t.value; btPaintConvert(); }
  if(t.id === "bcPrem"){ BT.conv.prem = t.value; btPaintConvert(); }
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
  const [ents, st, ob, ls, urls, stx, dvs, qts, phs, bms] = await Promise.all(["entries","settings","outbox","lastSync","urls","stocks","divs","quotes","photos","bookmarks"].map(n => KV.get(k(n))));
  S.entries = Array.isArray(ents) ? ents : []; S.loaded = Array.isArray(ents);
  S.stocks = Array.isArray(stx) ? stx : []; S.divs = Array.isArray(dvs) ? dvs : [];
  S.photos = Array.isArray(phs) ? phs : []; S.bookmarks = Array.isArray(bms) ? bms : [];
  if(qts && qts.quotes){ S.quotes = qts.quotes; S.fx = qts.fx || null; S.quotesAt = qts.at || 0; S.market = qts.market || {}; }
  if(st && Array.isArray(st.categories) && st.categories.length) S.cats = st.categories;
  S.outbox = Array.isArray(ob) ? ob : []; S.lastSync = ls || 0;
  if(Array.isArray(urls) && S.B.kind !== "local") S.urls = new Map(urls.filter(([, c]) => c && c.url && c.exp > Date.now()));
  hideGate(); render();
  const qs = new URLSearchParams(location.search);
  if(qs.has("new")){ qs.delete("new"); history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs : "")); openEditor(null); }
  pull();
}
(() => { const top = document.querySelector(".top"); if(!top || !window.ResizeObserver) return;
  new ResizeObserver(() => document.documentElement.style.setProperty("--top-h", top.offsetHeight + "px")).observe(top); })();
window.__sansiya = { S, pull, flush };
boot();
})();
