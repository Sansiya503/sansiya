import sys, re, json, time
from datetime import date
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; BASE = "http://localhost:8768/"; IM = OUT + "/imgs"
src = open(__file__.replace("e2e_album.py", "e2e_stocks.py")).read()
MOCK = re.search(r'MOCK = r"""(.*?)"""', src, re.S).group(1)
# missing-table switch, storage spies, link titles
MOCK = MOCK.replace('''  function run(st){
    if(window.__fail) return Promise.reject(new TypeError("Failed to fetch"));''', '''  function run(st){
    if(window.__fail) return Promise.reject(new TypeError("Failed to fetch"));
    if(sessionStorage.getItem("noAlbum") && (st.table === "photos" || st.table === "bookmarks")) return Promise.resolve({data:null, error:{code:"PGRST205", message:"Could not find the table 'public." + st.table + "' in the schema cache"}});''')
MOCK = MOCK.replace('''    if(body.action === "search"){''', '''    if(body.action === "linkmeta"){ window.__meta = (window.__meta || 0) + 1; return {data:{title: body.url.includes("example.com") ? "Example Article — Daily" : "", description:"", url:body.url}, error:null}; }
    if(body.action === "search"){''')
MOCK = MOCK.replace('''async upload(){ return {error:null}; }, async remove(){ return {error:null}; }''', '''async upload(p){ (window.__uploads = window.__uploads || []).push(p); return {error:null}; }, async remove(ps){ (window.__removed = window.__removed || []).push(...ps); return {error:null}; }''')
assert "__uploads" in MOCK and "noAlbum" in MOCK and "__meta" in MOCK
LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js"
UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
WD = "일월화수목금토"
def fd(s):
    y, m, d = map(int, s.split("-")); return f"{y}.{m:02d}.{d:02d} {WD[(date(y, m, d).weekday() + 1) % 7]}"

with sync_playwright() as p:
    b = p.chromium.launch()
    def ctx_new(scheme="light", w=412, h=915, mobile=True):
        c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, color_scheme=scheme, service_workers="block")
        c.route(LIB, lambda r: r.fulfill(status=200, content_type="application/javascript", body=MOCK))
        c.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body="window.SANSIYA_CONFIG={supabaseUrl:'https://abcd.supabase.co',supabaseKey:'sb_publishable_test_key_123456789'};"))
        for pat in ["https://fonts.googleapis.com/**", "https://financialmodelingprep.com/**", "https://assets.parqet.com/**", "https://icons.duckduckgo.com/**"]: c.route(pat, lambda r: r.fulfill(status=404, body=""))
        return c
    def seed(pg, db):
        pg.evaluate("d => sessionStorage.setItem('mockdb', JSON.stringify(d))", db); pg.goto("about:blank"); pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])"); pg.wait_for_timeout(300)
    def go(pg, v): pg.locator(f"#tabbar [data-view={v}]").click(); pg.wait_for_timeout(250)
    noov = lambda pg: pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    now = "2026-10-21T10:00:00Z"
    entry = {"id":"11111111-1111-4111-8111-111111111111","user_id":UID,"type":"scrap","cat":"ARC","seq":1,"title":"루이스 칸 소크 연구소","date":"2026-10-20","url":"","body":"빛과 바다","tags":["건축"],"rating":0,"status":"","photos":[],"example":False,"created_at":now,"updated_at":now}
    stock = {"id":"22222222-2222-4222-8222-222222222222","user_id":UID,"symbol":"AAPL","market":"US","name":"애플","currency":"USD","watch":True,"qty":0,"avg_price":0,"target_price":None,"memo":"","notes":[],"sort":1,"hidden":False,"created_at":now,"updated_at":now}

    # ---------- A: signed in, phone ----------
    c = ctx_new(); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    seed(pg, {"entries":{entry["id"]:entry}, "settings":{}, "stocks":{stock["id"]:stock}, "dividends":{}, "files":{}})
    m = pg.evaluate("""() => { const t = document.querySelector('#tabbar'); const bs = [...t.querySelectorAll('button')];
      return { labels: bs.map(b => b.textContent.trim()), icons: bs.every(b => b.querySelector('.tb-ic svg')), stacked: getComputedStyle(bs[0]).flexDirection, fits: t.scrollWidth <= t.clientWidth + 1,
               iconAbove: bs.every(b => b.querySelector('.tb-ic').getBoundingClientRect().bottom <= b.querySelector('.tb-l').getBoundingClientRect().top + 1) }; }""")
    ok("seven menus with icons, all fit on phone", m["labels"] == ["아카이브", "통계 · 회고", "주식", "비트코인", "사진", "SNS", "북마크"] and m["icons"] and m["fits"], str(m))
    ok("phone: icon above name", m["stacked"] == "column" and m["iconAbove"], str(m))
    box = pg.locator(".menubar").bounding_box(); pg.screenshot(path=f"{OUT}/shots/al-menu-phone.png", clip={"x":0, "y":box["y"], "width":412, "height":box["height"]})
    go(pg, "photos")
    ok("album empty state", "아직 사진이 없어요" in pg.inner_text(".ph"))
    pg.set_input_files("#phFile", [f"{IM}/trip.jpg", f"{IM}/sunset.jpg", f"{IM}/small.png"])
    pg.wait_for_function("document.querySelectorAll('.ph-tile').length === 3 && !document.querySelector('.ph-busy')", timeout=15000)
    g = pg.evaluate("""() => { const grid = document.querySelector('.ph-insta'), t = [...grid.querySelectorAll('.ph-tile')].map(e => e.getBoundingClientRect());
      return { left: grid.getBoundingClientRect().left, right: grid.getBoundingClientRect().right, vw: document.documentElement.clientWidth, square: t.every(r => Math.abs(r.width - r.height) < 1),
               gap: Math.round((t[1].left - t[0].right) * 10) / 10, perRow: t.filter(r => Math.abs(r.top - t[0].top) < 1).length,
               heads: document.querySelectorAll('.ph-day').length, headerSearch: getComputedStyle(document.querySelector('.top .search')).display, counts: /조회|views/i.test(grid.innerText) }; }""")
    tw = pg.evaluate("document.querySelector('.ph-insta .ph-tile').getBoundingClientRect().width")
    ok("grid: square tiles, 6 a row, edge to edge", g["square"] and abs(tw - (g["vw"] - 5 * 1.5) / 6) < 0.6 and g["left"] == 0 and abs(g["right"] - g["vw"]) < 1, str(g) + f" tile {tw:.1f}")
    ok("no date headings, no view counts, header search hidden", g["heads"] == 0 and not g["counts"] and g["headerSearch"] == "none", str(g))
    ok("search bar + add + bookmark icons", pg.is_visible("#phQ") and pg.get_attribute("#phQ", "placeholder") == "검색" and pg.is_visible(".ph-add") and pg.is_visible("[data-act=phFav]"))
    order = pg.evaluate("[...document.querySelectorAll('.ph-tile')].map(t => t.getAttribute('aria-label'))")
    ok("newest date first, EXIF photo (2024-05-17) last", order[-1].startswith(fd("2024-05-17")), str(order))
    pg.wait_for_function("Object.keys(JSON.parse(sessionStorage.getItem('mockdb')).photos || {}).length === 3", timeout=8000)
    db = pg.evaluate("JSON.parse(sessionStorage.getItem('mockdb')).photos || {}")
    rows = list(db.values())
    ok("3 photo rows saved", len(rows) == 3, str(len(rows)))
    big = [r for r in rows if r["date"] == "2024-05-17"]
    ok("big photo has its own thumbnail + size", big and big[0]["thumb"] and big[0]["thumb"] != big[0]["path"] and big[0]["width"] == 1600 and big[0]["height"] == 1200, json.dumps(big)[:200])
    small = [r for r in rows if r["width"] == 300]
    ok("tiny photo reuses itself as thumbnail", small and small[0]["thumb"] == small[0]["path"], json.dumps(small)[:160])
    ok("uploads: main + thumbs", len(pg.evaluate("window.__uploads")) == 5, str(pg.evaluate("window.__uploads")))
    ok("upload toast", "사진 3장을 올렸어요" in (pg.text_content("#toastRoot") or ""), pg.text_content("#toastRoot"))
    pg.screenshot(path=f"{OUT}/shots/al-photos-phone.png", full_page=True)
    # viewer
    pg.locator(".ph-tile").first.click(); pg.wait_for_selector(".pv")
    ok("viewer opens on first", pg.text_content(".pv-meta span") == "1 / 3")
    pg.click(".pv-nav.next"); ok("next", pg.text_content(".pv-meta span") == "2 / 3")
    pg.keyboard.press("ArrowLeft"); ok("arrow key back", pg.text_content(".pv-meta span") == "1 / 3")
    pg.keyboard.press("End"); pg.click("[data-act=phEdit]"); pg.wait_for_selector("#phForm")
    pg.fill("#ph-cap", "제주 바다, 첫날"); pg.fill("#ph-date", "2024-05-18"); pg.click("#phForm [type=submit]"); pg.wait_for_timeout(250)
    ok("caption saved in viewer", "제주 바다, 첫날" in pg.inner_text(".pv-foot") and pg.text_content(".pv-meta b") == fd("2024-05-18"), pg.text_content(".pv-meta b"))
    pg.click(".pv [data-fav^='photo:']"); pg.wait_for_timeout(200)
    ok("star photo", pg.get_attribute(".pv [data-fav^='photo:']", "aria-pressed") == "true" and pg.text_content(".pv [data-fav^='photo:']").strip() == "★")
    pg.screenshot(path=f"{OUT}/shots/al-viewer-phone.png")
    pg.click("[data-act=close]"); pg.wait_for_timeout(200)
    ok("starred tile shows a bookmark mark", pg.locator(".ph-insta .ph-star svg").count() == 1)
    pg.fill("#phQ", "제주"); pg.wait_for_timeout(150)
    ok("search by caption", pg.locator(".ph-insta .ph-tile").count() == 1 and "‘제주’ 사진 1장" in pg.text_content(".ph-count"), pg.text_content(".ph-count"))
    ok("search keeps focus while typing", pg.evaluate("document.activeElement.id") == "phQ")
    pg.locator(".ph-insta .ph-tile").first.click(); pg.wait_for_selector(".pv"); ok("viewer walks the search results", pg.text_content(".pv-meta span") == "1 / 1"); pg.click("[data-act=close]"); pg.wait_for_timeout(150)
    pg.fill("#phQ", "2024.05"); pg.wait_for_timeout(150); ok("search by month", pg.locator(".ph-insta .ph-tile").count() == 2)
    pg.fill("#phQ", "5월 17일"); pg.wait_for_timeout(150); ok("search by Korean date", pg.locator(".ph-insta .ph-tile").count() == 1)
    pg.fill("#phQ", "없는말"); pg.wait_for_timeout(150); ok("no result message", "맞는 사진이 없어요" in pg.inner_text("#phBody"))
    pg.fill("#phQ", ""); pg.wait_for_timeout(150)
    pg.click("[data-act=phFav]"); pg.wait_for_timeout(150)
    ok("bookmark icon shows only starred", pg.get_attribute("[data-act=phFav]", "aria-pressed") == "true" and pg.locator(".ph-insta .ph-tile").count() == 1)
    pg.screenshot(path=f"{OUT}/shots/al-photos-fav-phone.png")
    pg.click("[data-act=phFav]"); pg.wait_for_timeout(150); ok("back to all photos", pg.locator(".ph-insta .ph-tile").count() == 3)
    # delete one (not the starred one)
    pg.locator(".ph-tile").first.click(); pg.wait_for_selector(".pv")
    del_id = pg.evaluate("document.querySelector('.pv [data-fav]').dataset.fav.split(':')[1]")
    drow = pg.evaluate("id => JSON.parse(sessionStorage.getItem('mockdb')).photos[id]", del_id)
    want = sorted(set([drow["path"], drow["thumb"]]))
    pg.click("[data-act=phDel]"); pg.click("[data-act=phDelYes]"); pg.wait_for_timeout(500)
    rem = pg.evaluate("window.__removed || []")
    ok("delete removes row + its files", len(pg.evaluate("Object.keys(JSON.parse(sessionStorage.getItem('mockdb')).photos)")) == 2 and sorted(rem) == want, str(rem) + " vs " + str(want))
    ok("viewer moves to a neighbour after delete", pg.locator(".pv").count() == 1 and pg.text_content(".pv-meta span") == "1 / 2")
    pg.click("[data-act=close]")
    # bookmarks: links
    go(pg, "bookmarks")
    ok("bookmarks opens on links", pg.get_attribute("[data-bmtab=links]", "aria-pressed") == "true" and "저장한 링크가 없어요" in pg.inner_text(".bm"))
    pg.fill("#bmUrl", "example.com/article"); pg.press("#bmUrl", "Enter")
    pg.wait_for_function("document.querySelector('.bm-row .bm-tx b') && document.querySelector('.bm-row .bm-tx b').textContent === 'Example Article — Daily'", timeout=5000)
    ok("link saved with fetched title", pg.get_attribute(".bm-row .bm-main", "href") == "https://example.com/article" and pg.evaluate("window.__meta") == 1)
    try: pg.wait_for_function("!document.querySelector('.bm-ic img')", timeout=3000)
    except Exception: pass
    ok("favicon fails → letter tile", pg.locator(".bm-ic img").count() == 0 and pg.text_content(".bm-ic i") == "E")
    pg.fill("#bmUrl", "https://example.com/article"); pg.press("#bmUrl", "Enter"); pg.wait_for_timeout(100)
    ok("duplicate refused", "이미 저장한" in (pg.text_content("#toastRoot") or "") and pg.locator(".bm-row").count() == 1)
    pg.fill("#bmUrl", "not a url"); pg.press("#bmUrl", "Enter"); pg.wait_for_timeout(100)
    ok("bad url refused", "올바르지" in (pg.text_content("#toastRoot") or ""))
    pg.fill("#bmUrl", "naver.com"); pg.press("#bmUrl", "Enter"); pg.wait_for_timeout(400)
    pg.click("[data-bmedit]"); pg.wait_for_selector("#bmForm")
    pg.fill("#bm-memo", "주말에 읽기"); pg.fill("#bm-tags", "읽을거리, 건축"); pg.click("#bmForm [type=submit]"); pg.wait_for_timeout(250)
    ok("edit memo + tags", "주말에 읽기" in pg.inner_text(".bm-list") and pg.locator("[data-bmtag]").count() == 2)
    pg.click("[data-bmtag='건축']"); ok("tag filter", pg.locator(".bm-row").count() == 1)
    pg.click("[data-bmtag='건축']"); ok("tag filter off", pg.locator(".bm-row").count() == 2)
    pg.screenshot(path=f"{OUT}/shots/al-links-phone.png", full_page=True)
    rows = pg.eval_on_selector_all(".bm-row .bm-tx b", "els => els.map(e => e.textContent)")
    pg.locator("[data-bmedit]").nth(rows.index("naver.com")).click(); pg.click("[data-act=bmDel]"); pg.click("[data-act=bmDelYes]"); pg.wait_for_timeout(250)
    ok("delete link", pg.locator(".bm-row").count() == 1)
    # favourites from record + stock
    go(pg, "archive"); pg.click(f"[data-open='{entry['id']}']"); pg.wait_for_selector(".sheetbox")
    pg.click(f"[data-fav='entry:{entry['id']}']"); pg.wait_for_timeout(150)
    ok("record detail star", pg.get_attribute(f"[data-fav='entry:{entry['id']}']", "aria-pressed") == "true")
    pg.click("[data-act=close]"); go(pg, "stocks"); pg.locator("[data-sttab=watch]").click(); pg.wait_for_timeout(200)
    pg.locator(f"[data-stock='{stock['id']}']").first.click(); pg.wait_for_selector(".st-sheet")
    pg.click(f"[data-fav='stock:{stock['id']}']"); pg.wait_for_timeout(150); pg.click("[data-act=close]")
    go(pg, "bookmarks"); pg.click("[data-bmtab=favs]"); pg.wait_for_timeout(300)
    secs = pg.eval_on_selector_all(".bm-sec h3", "els => els.map(e => e.textContent)")
    ok("favourites grouped", secs == ["기록1", "주식1", "사진1"], str(secs))
    ok("fav rows content", "루이스 칸" in pg.inner_text(".bm-sec") and "애플" in pg.inner_text(".bm") and pg.locator(".bm-ph .ph-tile").count() == 1)
    pg.screenshot(path=f"{OUT}/shots/al-favs-phone.png", full_page=True)
    pg.locator(".bm-sec").first.locator(".bm-main").click(); pg.wait_for_selector(".sheetbox"); ok("fav row opens record", "루이스 칸" in pg.inner_text(".sheetbox")); pg.click("[data-act=close]")
    pg.click(f".bm-star[data-fav='stock:{stock['id']}']"); pg.wait_for_timeout(200)
    ok("unstar from list", pg.eval_on_selector_all(".bm-sec h3", "els => els.map(e => e.textContent)") == ["기록1", "사진1"])
    favrows = pg.evaluate("Object.values(JSON.parse(sessionStorage.getItem('mockdb')).bookmarks).map(b => b.kind).sort()")
    ok("bookmark rows in db", favrows == ["entry", "link", "photo"], str(favrows))
    pg.reload(); pg.wait_for_selector("#app:not([hidden])"); go(pg, "bookmarks"); pg.wait_for_timeout(300)
    ok("tab choice remembered after reload", pg.get_attribute("[data-bmtab=favs]", "aria-pressed") == "true" and pg.locator(".bm-sec").count() == 2)
    go(pg, "photos"); ok("photos persist after reload", pg.locator(".ph-tile").count() == 2)
    ok("A fits phone", noov(pg)); ok("A no page errors", not errs, str(errs))
    c.close()

    # ---------- B: tables not created yet ----------
    c = ctx_new(); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    pg.evaluate("sessionStorage.setItem('noAlbum', '1')")
    seed(pg, {"entries":{entry["id"]:entry}, "settings":{}, "stocks":{}, "dividends":{}, "files":{}})
    ok("B records still load", pg.locator(f"[data-open='{entry['id']}']").count() == 1 and pg.get_attribute("#syncBtn", "data-s") == "ok", pg.get_attribute("#syncBtn", "data-s"))
    go(pg, "photos"); pg.set_input_files("#phFile", [f"{IM}/small.png"]); pg.wait_for_timeout(300)
    ok("B upload waits for storage", "준비하는 중" in (pg.text_content("#toastRoot") or ""), pg.text_content("#toastRoot"))
    ok("B no page errors", not errs, str(errs))
    c.close()

    # ---------- C: device-only mode ----------
    c = ctx_new("dark"); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "?demo"); pg.wait_for_selector("#app:not([hidden])"); go(pg, "photos")
    pg.set_input_files("#phFile", [f"{IM}/trip.jpg", f"{IM}/sunset.jpg"]); pg.wait_for_function("document.querySelectorAll('.ph-tile img[src^=\"blob:\"]').length === 2", timeout=15000)
    ok("C local photos render", True)
    pg.screenshot(path=f"{OUT}/shots/al-photos-dark.png", full_page=True)
    go(pg, "bookmarks"); pg.fill("#bmUrl", "github.com"); pg.press("#bmUrl", "Enter"); pg.wait_for_timeout(300)
    ok("C link without server title shows domain", pg.text_content(".bm-row .bm-tx b") == "github.com")
    ok("C no page errors", not errs, str(errs))
    c.close()

    # ---------- D: desktop screenshots ----------
    for scheme in ["light", "dark"]:
        c = ctx_new(scheme, 1280, 860, False); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE + "?demo"); pg.wait_for_selector("#app:not([hidden])")
        m = pg.evaluate("(() => { const bs = [...document.querySelectorAll('#tabbar button')]; return [getComputedStyle(bs[0]).flexDirection, document.querySelector('#tabbar').scrollWidth <= document.querySelector('#tabbar').clientWidth + 1]; })()")
        ok(f"D {scheme} desktop menu: icon left, fits", m == ["row", True], str(m))
        go(pg, "photos"); pg.set_input_files("#phFile", [f"{IM}/trip.jpg", f"{IM}/sunset.jpg", f"{IM}/small.png"]); pg.wait_for_function("document.querySelectorAll('.ph-tile img[src]').length === 3", timeout=15000)
        dg = pg.evaluate("(() => { const g = document.querySelector('.ph-insta').getBoundingClientRect(), t = [...document.querySelectorAll('.ph-insta .ph-tile')].map(e => e.getBoundingClientRect()); return [Math.round(g.width), Math.round(t[1].left - t[0].right), Math.round(t[0].width) === Math.round(t[0].height)]; })()")
        ok(f"D {scheme} desktop grid 935px, 6 a row, 4px gap, square", dg[0] == 935 and dg[1] == 4 and dg[2] and abs(pg.evaluate("document.querySelector('.ph-insta .ph-tile').getBoundingClientRect().width") - (935 - 20) / 6) < 0.6, str(dg))
        pg.screenshot(path=f"{OUT}/shots/al-photos-desk-{scheme}.png")
        pg.locator(".ph-tile").nth(1).click(); pg.wait_for_selector(".pv img[src]"); pg.wait_for_timeout(200); pg.screenshot(path=f"{OUT}/shots/al-viewer-desk-{scheme}.png"); pg.click("[data-act=close]")
        go(pg, "bookmarks"); pg.fill("#bmUrl", "github.com/anthropics"); pg.press("#bmUrl", "Enter"); pg.fill("#bmUrl", "youtube.com/watch?v=1"); pg.press("#bmUrl", "Enter"); pg.wait_for_timeout(300)
        pg.screenshot(path=f"{OUT}/shots/al-links-desk-{scheme}.png")
        box = pg.locator(".menubar").bounding_box(); pg.screenshot(path=f"{OUT}/shots/al-menu-desk-{scheme}.png", clip={"x":0, "y":box["y"], "width":900, "height":box["height"]})
        ok(f"D {scheme} no page errors", not errs, str(errs))
        c.close()
    b.close()
print("\n".join(log)); print("FAILS:", sum(1 for l in log if l.startswith("FAIL")))
