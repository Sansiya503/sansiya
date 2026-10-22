import sys, re
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; BASE = "http://localhost:8768/"
src = open(__file__.replace("e2e_market.py", "e2e_stocks.py")).read()
MOCK = re.search(r'MOCK = r"""(.*?)"""', src, re.S).group(1)
LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js"
# add market rows to the quotes answer, and index history
MOCK = MOCK.replace('return {data:{quotes, fx:{usdkrw:1330.15, time:Math.floor(Date.now()/1000)}, at:Date.now()}, error:null};',
 '''window.__lastQuotesBody = body;
      const MK = {"^IXIC":[22875.31,118.4],"^GSPC":[6712.5,-20.25],"^DJI":[46190.61,0],"KRW=X":[1431.2,3.2],"JPYKRW=X":[9.3215,-0.0412],"EURKRW=X":[1545.8,4.1]};
      let market; if(Array.isArray(body.market)){ market = {}; body.market.forEach(s => { const m = MK[s]; if(!m) return; const sp = []; for(let i=0;i<48;i++) sp.push(m[0]-m[1] + m[1]*i/47 + Math.sin(i/4)*m[0]*0.001);
        market[s] = {symbol:s, price:m[0], prevClose:m[0]-m[1], change:m[1], changePct:m[1]/(m[0]-m[1])*100, time:Math.floor(Date.now()/1000)-600, spark:sp}; }); }
      return {data:{quotes, fx:{usdkrw:1431.2, time:Math.floor(Date.now()/1000)}, market, at:Date.now()}, error:null};''')
assert "__lastQuotesBody" in MOCK
log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
with sync_playwright() as p:
    b = p.chromium.launch()
    def ctx_new(scheme="light", w=412, h=915, mobile=True):
        c = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, color_scheme=scheme, service_workers="block")
        c.route(LIB, lambda r: r.fulfill(status=200, content_type="application/javascript", body=MOCK))
        c.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body="window.SANSIYA_CONFIG={supabaseUrl:'https://abcd.supabase.co',supabaseKey:'sb_publishable_test_key_123456789'};"))
        c.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        c.route("https://financialmodelingprep.com/**", lambda r: r.abort())
        c.route("https://assets.parqet.com/**", lambda r: r.abort())
        return c
    for scheme in ["light", "dark"]:
        ctx = ctx_new(scheme); pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
        pg.click("#tabbar [data-view=stocks]"); pg.wait_for_selector(".mk-row")
        pg.wait_for_function("document.querySelectorAll('.mk polyline').length === 6")
        names = pg.eval_on_selector_all(".mk .mk-n", "els => els.map(e => e.textContent)")
        ok(f"[{scheme}] 5 cards, no KOSPI/KOSDAQ", names == ["나스닥", "S&P 500", "다우존스", "달러 환율", "엔화 환율", "유로 환율"], str(names))
        body = pg.evaluate("window.__lastQuotesBody")
        ok(f"[{scheme}] request asks market symbols", body.get("market") == ["^IXIC", "^GSPC", "^DJI", "KRW=X", "JPYKRW=X", "EURKRW=X"], str(body))
        cards = pg.eval_on_selector_all(".mk", "els => els.map(e => e.innerText.replace(/\\n/g,' | '))")
        ok(f"[{scheme}] nasdaq card", "22,875.31" in cards[0] and "+118.40 (+0.52%)" in cards[0], cards[0])
        ok(f"[{scheme}] s&p down tone", pg.get_attribute(".mk:nth-child(2) .mk-c", "class").endswith("down"), cards[1])
        ok(f"[{scheme}] dow flat", pg.get_attribute(".mk:nth-child(3) .mk-c", "class").endswith("flat"), cards[2])
        ok(f"[{scheme}] fx card", "1,431.20원" in cards[3] and "+3.20 (+0.22%)" in cards[3], cards[3])
        ok(f"[{scheme}] yen card per 100", "932.15원" in cards[4] and "-4.12" in cards[4], cards[4])
        ok(f"[{scheme}] euro card", "1,545.80원" in cards[5], cards[5])
        ov = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ok(f"[{scheme}] no page horizontal scroll", ov <= 0, str(ov))
        row = pg.evaluate("(()=>{const r=document.querySelector('.mk-row');return [r.scrollWidth, r.clientWidth]})()")
        ok(f"[{scheme}] strip scrolls sideways", row[0] > row[1], str(row))
        pg.screenshot(path=f"{OUT}/mk-{scheme}.png")
        # tabs still work with the strip
        pg.click("[data-sttab=watch]"); pg.wait_for_timeout(150)
        ok(f"[{scheme}] strip stays on 관심 tab", pg.is_visible(".mk-row"))
        # open nasdaq detail
        pg.click(".mk[data-index='^IXIC']"); pg.wait_for_selector(".st-sheet #stChart svg")
        txt = pg.inner_text(".st-sheet")
        ok(f"[{scheme}] index detail", "나스닥" in txt and "NASDAQ Composite" in txt and "22,875.31" in txt and "+118.40 (+0.52%)" in txt and "기술주" in txt, txt[:200].replace("\n", " | "))
        ok(f"[{scheme}] no stock buttons in index sheet", pg.locator(".st-sheet [data-act=stEdit]").count() == 0 and pg.locator(".st-sheet [data-act=stWatch]").count() == 0)
        bx = pg.locator("#stChart svg").bounding_box(); pg.mouse.move(bx["x"] + bx["width"] * 0.5, bx["y"] + bx["height"] * 0.5); pg.wait_for_timeout(100)
        tip = pg.inner_text("#stChart .st-tip")
        ok(f"[{scheme}] tooltip uses points (no $)", "$" not in tip and "원" not in tip and re.search(r"\d", tip) is not None, tip)
        pg.click("[data-strange='1y']"); pg.wait_for_timeout(250)
        ok(f"[{scheme}] index range switch", pg.get_attribute("[data-strange='1y']", "aria-pressed") == "true" and "1년 전보다" in pg.inner_text("#stChart"), pg.inner_text("#stChart")[:60])
        pg.screenshot(path=f"{OUT}/mk-detail-{scheme}.png")
        pg.click(".st-sheet [data-act=close]"); pg.wait_for_timeout(200)
        pg.click(".mk[data-index='KRW=X']"); pg.wait_for_selector(".st-sheet #stChart svg")
        ok(f"[{scheme}] fx detail", "환율" in pg.inner_text(".st-sheet .sb-head") and "1,431.20원" in pg.inner_text("#stp-price"), pg.inner_text("#stp-price").replace("\n", " | "))
        pg.wait_for_timeout(200)
        bx = pg.locator("#stChart svg").bounding_box(); pg.mouse.move(bx["x"] + bx["width"] * 0.3, bx["y"] + bx["height"] * 0.5); pg.wait_for_timeout(100)
        ok(f"[{scheme}] fx tooltip has 원", "원" in pg.inner_text("#stChart .st-tip"), pg.inner_text("#stChart .st-tip"))
        pg.click(".st-sheet [data-act=close]"); pg.wait_for_timeout(200)
        # reload: cached market renders immediately
        pg.goto("about:blank"); pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
        pg.click("#tabbar [data-view=stocks]"); pg.wait_for_selector(".mk-row")
        ok(f"[{scheme}] cached cards after reload", "22,875.31" in pg.inner_text(".mk-row"))
        ok(f"[{scheme}] no page errors", not errs, str(errs))
        ctx.close()
    # desktop width
    ctx = ctx_new("light", 1280, 860, False); pg = ctx.new_page()
    pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    pg.locator("[data-view=stocks]:visible").first.click(); pg.wait_for_function("document.querySelectorAll('.mk polyline').length === 6")
    pg.screenshot(path=f"{OUT}/mk-desk.png")
    ctx.close()
    b.close()
print("\n".join(log))
print("FAILS:", sum(1 for l in log if l.startswith("FAIL")))
