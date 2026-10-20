/* 산시야 service worker — keeps the app usable offline.
 * 수정 후 배포할 때는 아래 VERSION 숫자를 올려 주세요. 그래야 폰에 새 버전이 적용돼요. */
const VERSION = "sansiya-v1.8.0";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./config.js", "./manifest.webmanifest",
  "./favicon.svg", "./icon-192.png", "./icon-512.png", "./maskable-512.png", "./apple-touch-icon.png"
];
const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js";
const FONT_CACHE = "sansiya-fonts";
const PHOTO_CACHE = "sansiya-photos";
const LIB_CACHE = "sansiya-lib";
const LOGO_CACHE = "sansiya-logos";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map(u => new Request(u, { cache:"reload" })));
    try{ const l = await caches.open(LIB_CACHE); if(!(await l.match(LIB))) await l.add(new Request(LIB, { mode:"cors" })); }catch(e){}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = new Set([VERSION, FONT_CACHE, PHOTO_CACHE, LIB_CACHE, LOGO_CACHE]);
    for(const k of await caches.keys()) if(!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(cacheName, max){
  const c = await caches.open(cacheName); const keys = await c.keys();
  for(let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  // downloads (the Toss connector kit) always come straight from the network
  if(url.origin === location.origin && url.pathname.includes("/toss-sync/")) return;

  // app pages: network first so updates arrive, cached copy when offline
  if(req.mode === "navigate" && url.origin === location.origin){
    event.respondWith((async () => {
      try{
        const res = await fetch(req, { cache:"no-cache" });
        if(res.ok){ const c = await caches.open(VERSION); c.put("./index.html", res.clone()); }
        return res;
      }catch(e){
        return (await caches.match("./index.html", { cacheName:VERSION })) || (await caches.match("./")) || Response.error();
      }
    })());
    return;
  }

  // app files: cached copy right away, refresh in the background
  if(url.origin === location.origin){
    event.respondWith((async () => {
      const c = await caches.open(VERSION);
      const hit = await c.match(req, { ignoreSearch:true });
      const net = fetch(req, { cache:"no-cache" }).then(res => { if(res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      if(hit){ event.waitUntil(net); return hit; }
      return (await net) || Response.error();
    })());
    return;
  }

  // pinned library: cache first
  if(url.href === LIB || url.hostname === "cdn.jsdelivr.net"){
    event.respondWith((async () => {
      const c = await caches.open(LIB_CACHE);
      const hit = await c.match(req); if(hit) return hit;
      const res = await fetch(req); if(res.ok) c.put(req, res.clone()); return res;
    })());
    return;
  }

  // fonts: cached copy, refresh in the background
  if(url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    event.respondWith((async () => {
      const c = await caches.open(FONT_CACHE);
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if(res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => null);
      if(hit){ event.waitUntil(net); return hit; }
      return (await net) || Response.error();
    })());
    return;
  }

  // stock logos: cache first so they show offline
  if((url.hostname === "financialmodelingprep.com" || url.hostname === "assets.parqet.com") && req.mode === "no-cors"){
    event.respondWith((async () => {
      const c = await caches.open(LOGO_CACHE);
      const hit = await c.match(req); if(hit) return hit;
      const res = await fetch(req);
      if(res.ok || res.type === "opaque"){ await c.put(req, res.clone()); event.waitUntil(trim(LOGO_CACHE, 300)); }
      return res;
    })());
    return;
  }

  // photos (signed Supabase Storage links): cache first so they show offline
  if(url.pathname.includes("/storage/v1/object/sign/")){
    event.respondWith((async () => {
      const c = await caches.open(PHOTO_CACHE);
      const hit = await c.match(req); if(hit) return hit;
      const res = await fetch(req);
      if(res.ok){ await c.put(req, res.clone()); event.waitUntil(trim(PHOTO_CACHE, 400)); }
      return res;
    })());
  }
  // everything else (Supabase API, auth) goes straight to the network
});
