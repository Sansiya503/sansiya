import os
import sys, re
from playwright.sync_api import sync_playwright
SP = sys.argv[1]; BASE = "http://localhost:8768/"
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "e2e_broker.py")).read()
exec(src.split("log = []")[0].split("from playwright.sync_api import sync_playwright")[1].replace('SP = sys.argv[1]; BASE = "http://localhost:8768/"', ''))
UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
def row(id_, sym, name, market, cur, qty, avg, sort):
    return {"id": id_, "user_id": UID, "symbol": sym, "market": market, "name": name, "currency": cur, "watch": False, "qty": qty, "avg_price": avg,
            "target_price": None, "memo": "", "notes": [], "sort": sort, "broker": "toss", "broker_synced_at": "2026-10-20T13:00:00Z", "hidden": False,
            "created_at": "2026-10-20T00:00:00Z", "updated_at": "2026-10-20T13:00:00Z"}
SETS = {
  "seven": [("SCHD","SCHD",13.1,32.7),("QQQM","QQQM",1.47,291.45),("NVDA","엔비디아",0.485,221.2),("EQIX","이퀴닉스",0.0376,994.2),("TSLA","테슬라",0.0604,370),("GOOGL","알파벳 A",0.064,348.5),("AAPL","애플",0.05,180)],
  "real": [("SCHD","SCHD",13.1,32.7),("QQQM","QQQM",1.47,291.45),("NVDA","엔비디아",0.485,221.2),("EQIX","이퀴닉스",0.0376,994.2),("TSLA","테슬라",0.0604,370),("GOOGL","알파벳 A",0.064,348.5)],
  "today": [("SCHD","SCHD",13.128808,32.7),("QQQM","QQQM",1.468816,291.45),("NVDA","엔비디아",0.485103,221.2),("EQIX","이퀴닉스",0.037626,994.2),("TSLA","테슬라",0.060405,370),("GOOGL","알파벳 A",0.063983,348.5)],
  "nine": [("SCHD","SCHD",13.1,32.7),("QQQM","QQQM",1.47,291.45),("NVDA","엔비디아",0.485,221.2),("EQIX","이퀴닉스",0.0376,994.2),("TSLA","테슬라",0.0604,370),("GOOGL","알파벳 A",0.064,348.5),("AAPL","애플",0.05,180),("MSFT","마이크로소프트",0.02,420),("O","리얼티 인컴",0.3,55)],
}
log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
with sync_playwright() as p:
    b = p.chromium.launch()
    for setname, scheme, w, h, mob in [("today", "light", 412, 915, True), ("today", "dark", 412, 915, True), ("today", "light", 1280, 900, False), ("nine", "dark", 1280, 900, False)]:
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mob, color_scheme=scheme, service_workers="block")
        c.route(LIB, lambda r: r.fulfill(status=200, content_type="application/javascript", body=MOCK))
        c.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body="window.SANSIYA_CONFIG={supabaseUrl:'https://abcd.supabase.co',supabaseKey:'sb_publishable_test_key_123456789'};"))
        for pat in ["https://fonts.googleapis.com/**", "https://financialmodelingprep.com/**", "https://assets.parqet.com/**"]: c.route(pat, lambda r: r.abort())
        pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
        db = {"entries":{},"settings":{},"stocks":{},"dividends":{},"files":{},"broker_links":{}}
        for i, (sym, name, q, a) in enumerate(SETS[setname]): db["stocks"][f"s{i}"] = row(f"s{i}", sym, name, "US", "USD", q, a, i + 1)
        pg.evaluate("d => sessionStorage.setItem('mockdb', JSON.stringify(d))", db)
        pg.goto("about:blank"); pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
        pg.locator("[data-view=stocks]:visible").first.click(); pg.wait_for_selector("#stDonut svg"); pg.wait_for_timeout(500)
        tag = f"{setname}/{scheme}/{w}"
        n = len(SETS[setname]); expect = n if n <= 8 else 8
        ns = pg.locator("#stDonut .ds").count(); nl = pg.locator("#stDonut .st-lg").count()
        ok(f"[{tag}] slices = rows", ns == nl == expect, f"{ns}/{nl}/{expect}")
        ok(f"[{tag}] no old bars", pg.locator(".st-al").count() == 0)
        pcts = [float(t.strip('%')) for t in pg.eval_on_selector_all("#stDonut .st-lg b", "els => els.map(e => e.textContent)")]
        names = pg.eval_on_selector_all("#stDonut .st-lg .nm", "els => els.map(e => e.childNodes[0].textContent)")
        sorted_ok = all(pcts[i] >= pcts[i+1] for i in range(len(pcts) - 1 - (1 if names[-1] == '기타' else 0)))
        ok(f"[{tag}] biggest first", sorted_ok, str(list(zip(names, pcts))))
        if setname == "nine": ok(f"[{tag}] rest folded into 기타", names[-1] == "기타" and "2종목" in pg.text_content("#stDonut .st-lg:last-child"))
        same = pg.evaluate("""() => [...document.querySelectorAll('#stDonut .st-lg')].every((r, i) => r.querySelector('i').style.background === document.querySelector(`#stDonut .ds[data-slice="${i}"]`).getAttribute('fill'))""")
        ok(f"[{tag}] list colours match slices", same)
        top_ok = pg.evaluate("(() => { const d = document.querySelector('#stDonut .ds').getAttribute('d'); const m = d.match(/^M([\\d.]+) ([\\d.]+)/); return Math.abs(+m[1] - 120) < 0.5; })()")
        ok(f"[{tag}] starts at 12 o'clock", top_ok)
        pg.evaluate("document.querySelector('#stDonut').scrollIntoView({block:'center'})"); pg.wait_for_timeout(150)
        pg.locator("#stDonut .st-lg").nth(1).hover(); pg.wait_for_timeout(150)
        ok(f"[{tag}] hover row lights slice", pg.locator("#stDonut.hl .ds.on").count() == 1 and names[1][:8] in pg.text_content("#dcTop") and "%" in pg.text_content("#dcBig"), pg.text_content("#dcTop") + " " + pg.text_content("#dcBig"))
        pg.mouse.move(2, 2); pg.wait_for_timeout(150)
        ok(f"[{tag}] reset", "평가금액" in pg.text_content("#dcTop") and pg.locator("#stDonut.hl").count() == 0)
        ok(f"[{tag}] fits screen", pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))
        pg.locator(".st-mix").screenshot(path=f"{SP}/shots/mix-{setname}-{scheme}-{w}.png")
        pg.locator("#stDonut .st-lg").first.click(); pg.wait_for_selector(".st-sheet", timeout=3000)
        ok(f"[{tag}] row opens stock", names[0] in pg.inner_text(".st-sheet .st-dname"))
        ok(f"[{tag}] no errors", not errs, str(errs))
        c.close()
    b.close()
print("\n".join(log)); print("FAILS:", sum(l.startswith("FAIL") for l in log))
