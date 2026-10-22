import sys, json
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; BASE = "http://localhost:8768/"
LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js"
MOCK = r"""
(function(){
  const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const load = () => JSON.parse(sessionStorage.getItem("mockdb") || '{"entries":{},"settings":{},"stocks":{},"dividends":{},"files":{}}');
  const save = d => sessionStorage.setItem("mockdb", JSON.stringify(d));
  window.__fail = false;
  function run(st){
    if(window.__fail) return Promise.reject(new TypeError("Failed to fetch"));
    const d = load(); const tbl = d[st.table] || (d[st.table] = {});
    if(st.op === "upsert"){ st.rows.forEach(r => { tbl[r.id || r.user_id] = r; }); save(d); return Promise.resolve({data:null, error:null}); }
    if(st.op === "delete"){ Object.keys(tbl).forEach(k => { if(st.filters.every(([c,v]) => tbl[k][c] === v)) delete tbl[k]; }); save(d); return Promise.resolve({data:null, error:null}); }
    let rows = Object.values(tbl).filter(r => st.filters.every(([c,v]) => r[c] === v));
    if(st.range) rows = rows.slice(st.range[0], st.range[1]+1);
    if(st.single) return Promise.resolve({data: rows[0] || null, error:null});
    return Promise.resolve({data: rows, error:null});
  }
  function q(table){
    const st = {table, filters:[], op:"select"};
    const api = { select(){return api}, order(){return api}, range(a,b){st.range=[a,b];return api}, eq(c,v){st.filters.push([c,v]);return api}, maybeSingle(){st.single=true;return api},
      upsert(rows){st.op="upsert";st.rows=Array.isArray(rows)?rows:[rows];return api}, delete(){st.op="delete";return api}, then(res,rej){return run(st).then(res,rej)} };
    return api;
  }
  const BASEQ = { "005930.KS":[218000,2500,"Samsung Electronics Co., Ltd.","KRW"], "035720.KS":[32100,-250,"Kakao Corp.","KRW"], "AAPL":[343.27,-1.19,"Apple Inc.","USD"], "SCHD":[29.41,0.12,"Schwab US Dividend Equity ETF","USD"], "069500.KS":[89930,1180,"KODEX 200","KRW"] };
  window.__invokes = [];
  async function invoke(name, {body}){
    window.__invokes.push(body.action);
    if(window.__fail) return {data:null, error:{name:"FunctionsFetchError", message:"Failed to send a request to the Edge Function"}};
    if(body.action === "quotes"){
      const quotes = {}; (body.symbols||[]).forEach(s => { const b = BASEQ[s]; if(b){ quotes[s] = {symbol:s, price:b[0], prevClose:b[0]-b[1], change:b[1], changePct:b[1]/(b[0]-b[1])*100, currency:b[3], name:b[2], exchange:"", time:Math.floor(Date.now()/1000)-300, source:"yahoo"}; } });
      return {data:{quotes, fx:{usdkrw:1330.15, time:Math.floor(Date.now()/1000)}, at:Date.now()}, error:null};
    }
    if(body.action === "search"){
      const all = [ {symbol:"005930.KS",name:"삼성전자",market:"KR",exchange:"코스피",currency:"KRW",type:"EQUITY"}, {symbol:"005935.KS",name:"삼성전자우",market:"KR",exchange:"코스피",currency:"KRW",type:"EQUITY"},
        {symbol:"035720.KS",name:"카카오",market:"KR",exchange:"코스피",currency:"KRW",type:"EQUITY"}, {symbol:"AAPL",name:"Apple Inc.",market:"US",exchange:"NASDAQ",currency:"USD",type:"EQUITY"}, {symbol:"SCHD",name:"Schwab US Dividend Equity ETF",market:"US",exchange:"NYSE Arca",currency:"USD",type:"ETF"} ];
      const qq = body.q.toLowerCase(); return {data:{results: all.filter(r => r.name.toLowerCase().includes(qq) || r.symbol.toLowerCase().startsWith(qq))}, error:null};
    }
    if(body.action === "history"){
      const b = BASEQ[body.symbol] || [100,0]; const n = body.range === "1mo" ? 22 : body.range === "1y" ? 250 : 64; const pts = []; let v = b[0]*0.9;
      for(let i=0;i<n;i++){ v = v * (1 + Math.sin(i/5)*0.01 + 0.002); pts.push([Date.now() - (n-i)*86400000, Math.round(v*100)/100]); }
      return {data:{symbol:body.symbol, points:pts}, error:null};
    }
    return {data:null, error:{name:"FunctionsHttpError", message:"bad", context:{json:async()=>({error:"unknown"})}}};
  }
  window.supabase = { createClient(){ return {
    auth: { async getSession(){ return {data:{session:{user:{id:UID,email:"me@test.com"}}}}; }, async signInWithPassword(){ return {data:{user:{id:UID}}, error:null}; }, async signOut(){ return {error:null}; }, onAuthStateChange(){ return {data:{subscription:{unsubscribe(){}}}}; } },
    from: q, functions: { invoke },
    storage: { from(){ return { async createSignedUrls(p){ return {data:[], error:null}; }, async upload(){ return {error:null}; }, async remove(){ return {error:null}; } }; } }
  }; } };
})();
"""
log=[]
def ok(n,c,x=""): log.append(("PASS" if c else "FAIL")+f"  {n} {x}")
with sync_playwright() as p:
    b = p.chromium.launch()
    def ctx_new(scheme="light", w=412, h=915, mobile=True):
        c = b.new_context(viewport={"width":w,"height":h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, color_scheme=scheme, service_workers="block")
        c.route(LIB, lambda r: r.fulfill(status=200, content_type="application/javascript", body=MOCK))
        c.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body="window.SANSIYA_CONFIG={supabaseUrl:'https://abcd.supabase.co',supabaseKey:'sb_publishable_test_key_123456789'};"))
        c.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        return c
    ctx = ctx_new(); pg = ctx.new_page(); errs=[]
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console: "+m.text) if m.type=="error" and "ERR_FAILED" not in m.text and "net::" not in m.text else None)
    pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    pg.click("#tabbar [data-view=stocks]"); pg.wait_for_selector(".st-tabs")
    ok("stocks view opens with empty state", "보유 종목을 추가해 보세요" in pg.inner_text("#main"))
    # add Samsung via search
    pg.click("#main [data-act=stAdd]"); pg.wait_for_selector("#st-q")
    pg.fill("#st-q", "삼성"); pg.wait_for_selector("[data-stpick]")
    ok("search shows Korean results", "삼성전자" in pg.inner_text("#stResults"))
    pg.click("[data-stpick='0']"); pg.wait_for_selector("#stForm")
    pg.wait_for_timeout(300)
    ok("form shows current price", "218,000원" in pg.inner_text("#stfPrice"), pg.inner_text("#stfPrice"))
    pg.fill("#stf-qty", "10"); pg.fill("#stf-avg", "200,000"); pg.fill("#stf-target", "250000"); pg.fill("#stf-memo", "HBM 회복 기대")
    pg.click("#stForm button[type=submit]"); pg.wait_for_selector(".st-sheet")
    pg.wait_for_selector("#stChart svg")
    ok("detail opens with chart", True)
    pos = pg.inner_text("#stp-pos")
    ok("position math", "2,180,000원" in pos and "+180,000원" in pos and "+9.00%" in pos, pos.replace("\n"," | "))
    ok("target info", "250,000원" in pg.inner_text("#stp-target"))
    # hover chart
    box = pg.locator("#stChart svg").bounding_box(); pg.mouse.move(box["x"]+box["width"]*0.5, box["y"]+box["height"]*0.5); pg.wait_for_timeout(100)
    ok("chart crosshair tooltip", pg.is_visible("#stChart .st-tip") and "원" in pg.inner_text("#stChart .st-tip"), pg.inner_text("#stChart .st-tip"))
    pg.click("[data-strange='1y']"); pg.wait_for_timeout(200)
    ok("range switch", pg.get_attribute("[data-strange='1y']","aria-pressed")=="true" and "1년 전보다" in pg.inner_text("#stChart"))
    pg.fill("#st-note", "3분기 실적 발표 후 반등"); pg.click("[data-act=stNoteAdd]"); pg.wait_for_timeout(200)
    ok("note added", "3분기 실적" in pg.inner_text("#stp-notes"))
    pg.screenshot(path=OUT+"/s-detail.png", full_page=False)
    pg.click(".st-sheet [data-act=close]"); pg.wait_for_timeout(200)
    # add Apple (USD) holding + SCHD watch only
    for q, idx, qty, avg in [("apple", 0, "3", "180.5"), ("SCHD", 0, "", "")]:
        pg.click("#main [data-act=stAdd]"); pg.wait_for_selector("#st-q"); pg.fill("#st-q", q); pg.wait_for_selector("[data-stpick]")
        pg.click(f"[data-stpick='{idx}']"); pg.wait_for_selector("#stForm")
        if qty: pg.fill("#stf-qty", qty); pg.fill("#stf-avg", avg)
        pg.click("#stForm button[type=submit]"); pg.wait_for_selector(".st-sheet"); pg.click(".st-sheet [data-act=close]"); pg.wait_for_timeout(150)
    # duplicate pick opens existing
    pg.click("#main [data-sttab=hold]") if pg.locator("#main [data-sttab=hold]").count() else None
    pg.wait_for_timeout(200)
    hero = pg.inner_text(".st-hero")
    exp_val = 2180000 + round(3*343.27*1330.15)
    ok("hero total incl. USD", f"{exp_val:,}원" in hero, hero.replace("\n"," | ")+f" expected {exp_val:,}")
    ok("two holdings listed", pg.locator(".st-sec .st-row").count()==2)
    ok("allocation section", "종목 비중" in pg.inner_text("#main"))
    pg.screenshot(path=OUT+"/s-hold.png")
    pg.click("[data-sttab=watch]"); pg.wait_for_timeout(200)
    w = pg.inner_text("#main")
    ok("watch tab lists 3 (all default watch)", pg.locator(".st-row").count()==3, str(pg.locator(".st-row").count()))
    ok("watch shows target", "목표가 250,000원" in w)
    pg.screenshot(path=OUT+"/s-watch.png")
    # dividends
    pg.click("[data-sttab=div]"); pg.wait_for_timeout(200)
    pg.click("#main [data-act=divAdd] >> nth=0"); pg.wait_for_selector("#divForm")
    pg.fill("#dv-amt", "3,610"); pg.fill("#dv-memo", "분기 배당"); pg.click("#divForm button[type=submit]"); pg.wait_for_timeout(200)
    pg.click("#main [data-act=divAdd] >> nth=0"); pg.wait_for_selector("#divForm")
    pg.select_option("#dv-stock", label="Apple Inc."); pg.wait_for_timeout(150)
    ok("currency follows stock", pg.get_attribute("[data-dvcur=USD]","aria-pressed")=="true")
    pg.fill("#dv-amt", "0.78"); pg.wait_for_timeout(50)
    ok("krw hint", "1,038원" in pg.inner_text("#dvKrwHint"), pg.inner_text("#dvKrwHint"))
    pg.click("#divForm button[type=submit]"); pg.wait_for_timeout(200)
    d = pg.inner_text("#main")
    ok("dividend total", f"{3610+round(0.78*1330.15):,}원" in d, d[:200].replace("\n"," | "))
    # bar tooltip
    bars = pg.locator(".st-chart svg rect[data-tip]")
    nowm = int(pg.evaluate("new Date().getMonth()"))
    bb = bars.nth(nowm).bounding_box(); pg.mouse.move(bb["x"]+bb["width"]/2, bb["y"]+bb["height"]/2); pg.wait_for_timeout(100)
    ok("bar tooltip", pg.is_visible(".st-chart .st-tip") and "월" in pg.inner_text(".st-chart .st-tip"), pg.inner_text(".st-chart .st-tip"))
    pg.screenshot(path=OUT+"/s-div.png")
    # server state
    db = json.loads(pg.evaluate("sessionStorage.getItem('mockdb')"))
    ok("server has 3 stocks, 2 dividends", len(db["stocks"])==3 and len(db["dividends"])==2, f'{len(db["stocks"])} {len(db["dividends"])}')
    srow = [r for r in db["stocks"].values() if r["symbol"]=="005930.KS"][0]
    ok("stock row fields", srow["qty"]==10 and srow["avg_price"]==200000 and srow["target_price"]==250000 and len(srow["notes"])==1, json.dumps(srow, ensure_ascii=False)[:200])
    # offline: edit stock -> queued, then flush
    pg.evaluate("window.__fail = true")
    pg.click("[data-sttab=hold]"); pg.click(".st-sec .st-row >> nth=0"); pg.wait_for_selector(".st-sheet")
    pg.click("[data-act=stEdit]"); pg.wait_for_selector("#stForm"); pg.fill("#stf-qty","12"); pg.click("#stForm button[type=submit]"); pg.wait_for_timeout(300)
    ok("offline edit queued", pg.evaluate("window.__sansiya.S.outbox.length")>=1)
    pg.evaluate("window.__fail = false"); pg.evaluate("window.__sansiya.pull()"); pg.wait_for_timeout(500)
    db = json.loads(pg.evaluate("sessionStorage.getItem('mockdb')"))
    ok("queued stock edit synced", [r for r in db["stocks"].values() if r["symbol"]=="005930.KS"][0]["qty"]==12 and pg.evaluate("window.__sansiya.S.outbox.length")==0)
    pg.click(".st-sheet [data-act=close]") if pg.locator(".st-sheet").count() else None
    # wipe local cache, reload -> restored from server
    pg.evaluate("indexedDB.deleteDatabase('sansiya')"); pg.wait_for_timeout(300); pg.reload(); pg.wait_for_selector("#app:not([hidden])")
    pg.click("#tabbar [data-view=stocks]"); pg.wait_for_timeout(600)
    ok("restored from server", pg.locator(".st-sec .st-row").count()==2)
    # remove SCHD from watch via heart (no holdings -> confirm removal)
    pg.click("[data-sttab=watch]"); pg.click(".st-row:has-text('Schwab')"); pg.wait_for_selector(".st-sheet")
    pg.click("[data-act=stWatch]"); pg.wait_for_selector("#stFoot [data-act=stDelYes]"); pg.click("[data-act=stDelYes]"); pg.wait_for_timeout(300)
    db = json.loads(pg.evaluate("sessionStorage.getItem('mockdb')"))
    ok("stock deleted on server", len(db["stocks"])==2)
    # hide amounts + display toggle + sort
    pg.click("[data-sttab=hold]"); pg.click("[data-act=stEye]"); pg.wait_for_timeout(100)
    ok("amounts hidden", "••••원" in pg.inner_text(".st-hero") and "%" in pg.inner_text(".st-hero"))
    pg.click("[data-act=stEye]"); pg.click("[data-holdshow=price]"); pg.wait_for_timeout(100)
    ok("price display", "218,000원" in pg.inner_text(".st-list"))
    pg.click("[data-holdshow=value]"); pg.select_option("#holdSort","pl"); pg.wait_for_timeout(100)
    ok("sort by return puts Apple first", pg.locator(".st-list .st-row").nth(0).inner_text().startswith("A"), pg.locator(".st-list .st-row").nth(0).inner_text()[:20])
    ok("domestic/overseas groups", "국내 주식" in pg.inner_text(".st-list") and "해외 주식" in pg.inner_text(".st-list"))
    # export includes stocks
    pg.click("#setBtn"); 
    with pg.expect_download() as dl: pg.click("[data-act=export]")
    data = json.load(open(dl.value.path())); ok("export has stocks/dividends", len(data["stocks"])==2 and len(data["dividends"])==2)
    pg.click(".sheetbox [data-act=close]")
    # dark + desktop shots
    pg.emulate_media(color_scheme="dark"); pg.click("[data-sttab=hold]"); pg.wait_for_timeout(200); pg.screenshot(path=OUT+"/s-hold-dark.png")
    pg.click(".st-sec .st-row >> nth=0"); pg.wait_for_selector("#stChart svg"); pg.wait_for_timeout(300); pg.screenshot(path=OUT+"/s-detail-dark.png"); pg.click(".st-sheet [data-act=close]")
    pg.emulate_media(color_scheme="light"); pg.set_viewport_size({"width":1360,"height":900}); pg.wait_for_timeout(200); pg.screenshot(path=OUT+"/s-desktop.png")
    pg.click("#main [data-act=stAdd]"); pg.wait_for_selector("#st-q"); pg.fill("#st-q","삼성"); pg.wait_for_selector("[data-stpick]"); pg.screenshot(path=OUT+"/s-search.png")
    b.close()
for l in log: print(l)
print("errors:", errs or "none")
