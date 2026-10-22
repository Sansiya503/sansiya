import sys, re, json
from datetime import date, timedelta
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; BASE = "http://localhost:8768/"; IM = OUT + "/imgs"
src = open(__file__.replace("e2e_topics.py", "e2e_album.py")).read()
pre = src.split("log = []")[0]
__file__ = __file__.replace("e2e_topics.py", "e2e_album.py"); exec(pre.split("with sync_playwright()")[0])  # MOCK, LIB, UID, helpers from the album test
log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
now = "2026-10-21T10:00:00Z"
def prow(i, topics=()):
    d = (date(2026, 10, 21) - timedelta(days=i)).isoformat()
    return {"id":f"{i:08d}-0000-4000-8000-000000000000", "user_id":UID, "path":f"{UID}/p{i}.jpg", "thumb":f"{UID}/p{i}.jpg", "date":d, "caption":"제주 여행" if i == 4 else "", "width":800, "height":800, "topics":list(topics), "created_at":now, "updated_at":now}
with sync_playwright() as p:
    b = p.chromium.launch()
    def ctx_new(scheme="light", w=412, h=860, mobile=True):
        c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, color_scheme=scheme, service_workers="block")
        c.route(LIB, lambda r: r.fulfill(status=200, content_type="application/javascript", body=MOCK))
        c.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body="window.SANSIYA_CONFIG={supabaseUrl:'https://abcd.supabase.co',supabaseKey:'sb_publishable_test_key_123456789'};"))
        for pat in ["https://fonts.googleapis.com/**", "https://icons.duckduckgo.com/**"]: c.route(pat, lambda r: r.fulfill(status=404, body=""))
        return c
    photos = {}
    for i in range(300):
        tp = ("travel",) if i % 3 == 0 else ("food",) if i % 3 == 1 else ()
        if i == 7: tp = ("arch", "landscape")
        r = prow(i, tp); photos[r["id"]] = r
    for w, scheme in [(412, "light"), (1280, "dark")]:
        mob = w < 600
        c = ctx_new(scheme, w, 860, mob); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
        pg.evaluate("d => sessionStorage.setItem('mockdb', JSON.stringify(d))", {"entries":{}, "settings":{}, "stocks":{}, "dividends":{}, "files":{}, "photos":photos})
        pg.goto("about:blank"); pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])"); pg.wait_for_timeout(400)
        pg.locator("#tabbar [data-view=photos]").click(); pg.wait_for_selector("#phGrid")
        t = f"[{w}]"
        chips = pg.eval_on_selector_all(".ph-topics button", "els => els.map(e => e.textContent)")
        ok(f"{t} topic chips in order", chips == ["All", "여행", "음식", "디자인", "건축", "조경", "인테리어"], str(chips))
        sizes = pg.evaluate("[parseFloat(getComputedStyle(document.querySelector('.ph-topics button')).fontSize), parseFloat(getComputedStyle(document.querySelector('#tabbar .tb-l')).fontSize)]")
        ok(f"{t} chip text smaller than main menu", sizes[0] < sizes[1], str(sizes))
        ok(f"{t} chips have no icons, sit under search", pg.locator(".ph-topics svg, .ph-topics img").count() == 0 and pg.evaluate("document.querySelector('.ph-topics').getBoundingClientRect().top >= document.querySelector('.ph-search').getBoundingClientRect().bottom"))
        ok(f"{t} All selected by default", pg.get_attribute("[data-phtopic=all]", "aria-pressed") == "true")
        per = pg.evaluate("(() => { const t = [...document.querySelectorAll('#phGrid .ph-tile')].map(e => e.getBoundingClientRect()); return t.filter(r => Math.abs(r.top - t[0].top) < 1).length; })()")
        ok(f"{t} 6 photos a row", per == 6, str(per))
        n0 = pg.locator("#phGrid .ph-tile").count()
        ok(f"{t} loads 100 at a time", n0 in (100, 200) and pg.locator("#phMore").count() == 1, str(n0))
        steps = []
        for _ in range(6):
            pg.mouse.wheel(0, 2500); pg.wait_for_timeout(200); steps.append(pg.locator("#phGrid .ph-tile").count())
        ok(f"{t} grows in steps of 100", all(x in (100, 200, 300) for x in steps), str(steps))
        for _ in range(8):
            pg.mouse.wheel(0, 6000); pg.wait_for_timeout(250)
        n1 = pg.locator("#phGrid .ph-tile").count()
        ok(f"{t} more photos load as you scroll", n1 == 300 and "사진 300장" in (pg.text_content(".ph-count") or ""), f"{n1} {pg.text_content('.ph-count')}")
        sticky = pg.evaluate("[Math.round(document.querySelector('.ph-head').getBoundingClientRect().top), Math.round(document.querySelector('.top').getBoundingClientRect().bottom), window.scrollY]")
        ok(f"{t} search + chips stay pinned under the header", abs(sticky[0] - sticky[1]) <= 1 and sticky[2] > 2000, str(sticky))
        pg.screenshot(path=f"{OUT}/shots/tp-scrolled-{w}.png")
        pg.evaluate("window.scrollTo(0, 0)")
        counts = {}
        for k in ["all", "travel", "food", "design", "arch", "landscape", "interior"]:
            pg.click(f"[data-phtopic={k}]"); pg.wait_for_timeout(150)
            for _ in range(6): pg.mouse.wheel(0, 6000); pg.wait_for_timeout(120)
            counts[k] = pg.locator("#phGrid .ph-tile").count()
            pg.evaluate("window.scrollTo(0, 0)")
        # seed: i%3==0 travel (100), i%3==1 food (100), i==7 arch+landscape (instead of food), the rest have no topic
        ok(f"{t} All shows every photo, topics only their own", counts == {"all":300, "travel":100, "food":99, "design":0, "arch":1, "landscape":1, "interior":0}, str(counts))
        pg.click("[data-phtopic=all]"); pg.wait_for_timeout(150)
        pg.click("[data-phtopic=travel]"); pg.wait_for_timeout(200)
        ok(f"{t} 여행 filter", pg.get_attribute("[data-phtopic=travel]", "aria-pressed") == "true" and pg.get_attribute("[data-phtopic=all]", "aria-pressed") == "false" and pg.locator("#phGrid .ph-tile").count() == 100 and "‘여행’ 사진 100장" in pg.text_content(".ph-count"), pg.text_content(".ph-count"))
        pg.fill("#phQ", "제주"); pg.wait_for_timeout(150)
        ok(f"{t} search inside topic", pg.locator("#phGrid .ph-tile").count() == 0 and "‘여행’ 안에서만" in pg.inner_text("#phBody"))
        pg.fill("#phQ", ""); pg.click("[data-phtopic=food]"); pg.fill("#phQ", "제주"); pg.wait_for_timeout(150)
        ok(f"{t} search inside 음식 finds the 제주 photo", pg.locator("#phGrid .ph-tile").count() == 1)
        pg.fill("#phQ", ""); pg.click("[data-phtopic=design]"); pg.wait_for_timeout(150)
        ok(f"{t} empty topic message", "‘디자인’ 사진이 아직 없어요" in pg.inner_text("#phBody"))
        if mob:
            pg.screenshot(path=f"{OUT}/shots/tp-empty-{w}.png")
            pg.set_input_files("#phFile", [f"{IM}/small.png"]); pg.wait_for_function("document.querySelectorAll('#phGrid .ph-tile').length === 1", timeout=10000)
            pg.wait_for_function("Object.values(JSON.parse(sessionStorage.getItem('mockdb')).photos).some(p => p.width === 300)", timeout=8000)
            new = pg.evaluate("Object.values(JSON.parse(sessionStorage.getItem('mockdb')).photos).filter(p => p.width === 300)")
            ok(f"{t} upload while 디자인 is chosen lands in 디자인", len(new) == 1 and new[0]["topics"] == ["design"], json.dumps(new)[:120])
        pg.click("[data-phtopic=arch]"); pg.wait_for_timeout(150)
        ok(f"{t} multi-topic photo shows under 건축", pg.locator("#phGrid .ph-tile").count() == 1)
        pg.locator("#phGrid .ph-tile").first.click(); pg.wait_for_selector(".pv")
        tags = pg.eval_on_selector_all(".pv-tags button", "els => els.map(e => e.textContent)")
        ok(f"{t} viewer shows topic tags", tags == ["#건축", "#조경"], str(tags))
        pg.click("[data-act=phEdit]"); pg.wait_for_selector("#phForm .pv-tp")
        pressed = pg.eval_on_selector_all("#phForm .pv-tp[aria-pressed=true]", "els => els.map(e => e.textContent)")
        ok(f"{t} editor preselects topics", pressed == ["건축", "조경"], str(pressed))
        pg.click("#phForm [data-pvtopic=landscape]"); pg.click("#phForm [data-pvtopic=interior]"); pg.click("#phForm [type=submit]"); pg.wait_for_timeout(250)
        tags = pg.eval_on_selector_all(".pv-tags button", "els => els.map(e => e.textContent)")
        ok(f"{t} topics saved", tags == ["#건축", "#인테리어"], str(tags))
        if mob: pg.screenshot(path=f"{OUT}/shots/tp-viewer-{w}.png")
        pg.click(".pv-tags [data-phgo=interior]"); pg.wait_for_timeout(250)
        ok(f"{t} tapping a tag jumps to that topic", pg.locator(".pv").count() == 0 and pg.get_attribute("[data-phtopic=interior]", "aria-pressed") == "true" and pg.locator("#phGrid .ph-tile").count() == 1)
        pg.reload(); pg.wait_for_selector("#app:not([hidden])"); pg.locator("#tabbar [data-view=photos]").click(); pg.wait_for_selector(".ph-topics")
        ok(f"{t} chosen topic remembered", pg.get_attribute("[data-phtopic=interior]", "aria-pressed") == "true")
        pg.click("[data-phtopic=all]"); pg.wait_for_timeout(200)
        pg.screenshot(path=f"{OUT}/shots/tp-all-{w}-{scheme}.png")
        ok(f"{t} no sideways scroll", pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))
        ok(f"{t} no page errors", not errs, str(errs))
        c.close()
    b.close()
print("\n".join(log)); print("FAILS:", sum(1 for l in log if l.startswith("FAIL")))
