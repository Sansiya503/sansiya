/* 산시야 — personal archive PWA
 * Data: Supabase (login, Postgres, Storage) with a local IndexedDB cache and an
 * offline outbox, or a device-only local mode (?demo or "이 기기에만 저장").
 */
(() => {
"use strict";

const APP_VERSION = "1.0.1";
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
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout|the network connection/i.test(String(err && (err.message || err) || ""));
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
    async removePhotos(paths){ if(!paths.length) return; const { error } = await sb.storage.from("photos").remove(paths); if(error) throw error; }
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
    async removePhotos(paths){ for(const p of paths) await KV.del("local:photo:" + p); }
  };
}

/* ---------- state ---------- */
const S = {
  B:null, uid:null, email:"",
  entries:[], loaded:false, cats:DEFAULT_CATS.slice(),
  view:"archive", filter:{cat:"all", type:"all", tag:null, q:""},
  sort:"date-desc", layout:"list", calMonth:null, calSel:null,
  outbox:[], lastSync:0, lastPull:0, sync:"idle", syncErr:"",
  urls:new Map(), installEvt:null
};
try{ const p = JSON.parse(localStorage.getItem("sansiya-prefs") || "{}"); if(p.layout) S.layout = p.layout; if(p.sort) S.sort = p.sort; }catch(e){}
function savePrefs(){ try{ localStorage.setItem("sansiya-prefs", JSON.stringify({ layout:S.layout, sort:S.sort })); }catch(e){} }
const k = name => `u:${S.uid}:${name}`;
const saveCache = () => KV.set(k("entries"), S.entries);
const saveOutbox = () => KV.set(k("outbox"), S.outbox);
const catOf = code => S.cats.find(c => c.code === code) || { code:code || "ETC", name:code || "기타" };
const sheetNo = e => `${esc(e.cat || "ETC")}-${pad(e.seq || 0, 3)}`;

/* ---------- sync ---------- */
const opKey = o => o.op === "settings" ? "settings" : (o.entry ? o.entry.id : o.id);
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
  S.outbox = S.outbox.filter(o => opKey(o) !== key);
  S.outbox.push(op); await saveOutbox(); updateSyncUI(); markPending();
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
    const [rows, st] = await Promise.all([S.B.fetchEntries(), S.B.fetchSettings()]);
    if(S.outbox.length){ setSync("idle"); return; }
    S.entries = rows;
    if(st && Array.isArray(st.categories) && st.categories.length) S.cats = st.categories.map(c => ({ code:c.code, name:c.name }));
    S.loaded = true; S.lastSync = Date.now();
    await Promise.all([saveCache(), KV.set(k("settings"), { categories:S.cats }), KV.set(k("lastSync"), S.lastSync)]);
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
  if(S.view === "archive" || S.view === "calendar") render();
}

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
const VIEWS = [["archive","아카이브"],["calendar","캘린더"],["stats","통계 · 회고"]];
function renderChrome(){
  $("#brandCount").textContent = S.loaded ? `Personal register · ${S.entries.length}건` : "Personal register";
  $("#tabbar").innerHTML = VIEWS.map(([v, l]) => `<button type="button" data-view="${v}" aria-current="${S.view === v}">${l}</button>`).join("");
  const f = S.filter;
  const cats = S.cats.map(c => ({ ...c, n:count(e => e.cat === c.code) }));
  const tags = tagCounts().slice(0, 14);
  $("#side").innerHTML = `
    <div><h4>보기</h4><div class="nav">${VIEWS.map(([v, l]) => `<button type="button" data-view="${v}" aria-current="${S.view === v}">${l}</button>`).join("")}</div></div>
    <div><h4>유형</h4><div class="nav">
      ${[["all","전체",S.entries.length],["scrap","스크랩 · 정보",count(e => e.type === "scrap")],["taste","취향 · 컬렉션",count(e => e.type === "taste")]]
        .map(([key, l, n]) => `<button type="button" data-type="${key}" aria-current="${f.type === key}">${l}<span class="n">${n}</span></button>`).join("")}
    </div></div>
    <div><h4>분야</h4><div class="nav">
      <button type="button" data-cat="all" aria-current="${f.cat === "all"}"><span class="code">ALL</span>전체 분야<span class="n">${S.entries.length}</span></button>
      ${cats.map(c => `<button type="button" data-cat="${esc(c.code)}" aria-current="${f.cat === c.code}"><span class="code">${esc(c.code)}</span>${esc(c.name)}<span class="n">${c.n || ""}</span></button>`).join("")}
    </div></div>
    ${tags.length ? `<div><h4>태그</h4><div class="tagcloud">${tags.map(([t, n]) => `<button type="button" class="chip ${f.tag === t ? "on" : ""}" data-tag="${esc(t)}">#${esc(t)} <span class="mono" style="font-size:10.5px;opacity:.7">${n}</span></button>`).join("")}</div></div>` : ""}
    <div class="side-foot">
      ${S.installEvt ? `<button type="button" class="install" data-act="install">앱으로 설치하기</button>` : ""}
      <button type="button" data-act="cats">분야 관리</button>
      <button type="button" data-act="settings">설정 · 백업</button>
    </div>`;
  updateSyncUI();
}

/* ---------- render: views ---------- */
function render(){
  renderChrome();
  const m = $("#main");
  if(S.view === "archive") m.innerHTML = archiveHtml();
  else if(S.view === "calendar") m.innerHTML = calendarHtml();
  else m.innerHTML = statsHtml();
  hydrateImages();
}
function refresh(){
  if(OV && OV.kind === "edit"){ renderChrome(); return; }
  render();
  if(OV && OV.kind === "detail") renderDetail();
  if(OV && OV.kind === "settings") renderSettings();
}
function rowHtml(e, pend){
  const c = catOf(e.cat), ph = e.photos || [];
  return `<article class="row" data-open="${esc(e.id)}" tabindex="0">
    <div class="sheet"><b>${esc(e.cat)}</b>-${pad(e.seq || 0, 3)}</div>
    <div style="min-width:0">
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
    <div class="thumbs">${ph.length ? `<div class="thumbwrap">${imgTag(ph[0], "thumb")}</div>${ph.length > 1 ? `<span class="more">+${ph.length - 1}</span>` : ""}` : ""}</div>
  </article>`;
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
    return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, o.n ? 2 : 0).toFixed(1)}" rx="2" fill="${cur ? "var(--accent)" : "var(--accent-mid)"}"/>
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
      <div class="fld"><span class="lb">사진</span>
        <div class="photos">${d.photos.map((p, i) => `<div class="p">${imgTag(p)}<button type="button" data-rmphoto="${i}" aria-label="사진 빼기">×</button></div>`).join("")}
          ${Array.from({ length:OV.busy }, () => `<div class="busy">올리는 중…</div>`).join("")}
          ${canPhoto ? `<label class="add" for="f-photo"><span style="font-size:20px;line-height:1">+</span>사진 추가</label><input id="f-photo" type="file" accept="image/*" multiple hidden>` : `<span class="tag">사진은 인터넷에 연결되어 있을 때 올릴 수 있어요.</span>`}
        </div></div>
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
function openSettings(){ if(OV) endOvKeepHistory(); OV = { kind:"settings", confirmOut:false, confirmDrop:false }; renderSettings(); }
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
    else { m.setAttribute("content", t === "dark" ? "#101216" : "#F5F6F8"); m.removeAttribute("media"); }
  });
}
syncThemeColor();

/* backup */
function exportJson(){
  const data = JSON.stringify({ app:"sansiya", version:APP_VERSION, exportedAt:new Date().toISOString(), categories:S.cats, entries:S.entries }, null, 2);
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
  const src = Array.isArray(j) ? j : (Array.isArray(j.entries) ? j.entries : null);
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
  return { entries:out, cats, dropped, overwrite:out.filter(e => existing.has(e.id)).length };
}
function openImport(res){ if(OV) endOvKeepHistory(); OV = { kind:"import", res }; renderImport(); }
function renderImport(){
  const r = OV.res;
  showOv(`<div class="sheetbox" role="dialog" aria-modal="true" aria-label="가져오기">
    <div class="sb-head"><span class="ttl">백업 가져오기</span><div class="sp"><button class="btn small ghost" type="button" data-act="close">닫기</button></div></div>
    <div class="sb-body prose">
      <p style="margin:0;font-size:15px">기록 <b>${r.entries.length}건</b>을 가져올까요?</p>
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
  render(); toast(`기록 ${r.entries.length}건을 가져왔어요.`);
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
  if(ds.view){ S.view = ds.view; render(); window.scrollTo({ top:0 }); return; }
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
    case "close": closeOv(); break;
    case "edit": openEditor(OV.id); break;
    case "del": OV.confirm = true; renderDetail(); break;
    case "delNo": OV.confirm = false; renderDetail(); break;
    case "delYes": deleteEntry(OV.id); break;
    case "cats": openCats(); break;
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
  if(t.id === "f-photo" && t.files.length){ uploadPhotos(t.files); }
  if(t.id === "f-cat" && OV){ OV.draft.cat = t.value; }
  if(t.id === "importFile" && t.files.length){
    const f = t.files[0];
    f.text().then(txt => {
      let res; try{ res = parseImport(txt); }catch(e){ toast("산시야 백업 파일(JSON)이 아니에요."); return; }
      if(!res.entries.length){ toast("가져올 기록이 없어요."); return; }
      openImport(res);
    });
  }
});
document.addEventListener("submit", ev => {
  ev.preventDefault();
  if(ev.target.id === "edForm"){ if(!OV.busy) saveDraft(); }
  else if(ev.target.id === "gateForm") gateSubmit(ev.target);
});
document.addEventListener("paste", ev => {
  if(!OV || OV.kind !== "edit") return;
  const files = [...((ev.clipboardData && ev.clipboardData.files) || [])].filter(f => f.type.startsWith("image/"));
  if(files.length){ ev.preventDefault(); uploadPhotos(files); }
});
let qT;
$("#q").addEventListener("input", ev => { clearTimeout(qT); qT = setTimeout(() => { S.filter.q = ev.target.value; if(S.view !== "archive") S.view = "archive"; render(); }, 150); });
window.addEventListener("online", () => { updateSyncUI(); pull(); });
window.addEventListener("offline", () => updateSyncUI());
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && S.uid && Date.now() - S.lastPull > 30000) pull(); });
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
  const [ents, st, ob, ls, urls] = await Promise.all(["entries","settings","outbox","lastSync","urls"].map(n => KV.get(k(n))));
  S.entries = Array.isArray(ents) ? ents : []; S.loaded = Array.isArray(ents);
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
