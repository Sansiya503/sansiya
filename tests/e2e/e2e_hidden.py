import os
import sys, re
from playwright.sync_api import sync_playwright
SP = sys.argv[1]; BASE = "http://localhost:8768/"
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "e2e_broker.py")).read()
exec(src.split("log = []")[0].split("from playwright.sync_api import sync_playwright")[1].replace('SP = sys.argv[1]; BASE = "http://localhost:8768/"', ''))
log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
def row(id_, sym, name, market, cur, qty, avg, broker, watch=False, sort=1):
    return {"id": id_, "user_id": UID, "symbol": sym, "market": market, "name": name, "currency": cur, "watch": watch, "qty": qty, "avg_price": avg,
            "target_price": None, "memo": "", "notes": [], "sort": sort, "broker": broker, "broker_synced_at": "2026-10-20T13:00:00Z" if broker else None,
            "created_at": "2026-10-20T00:00:00Z", "updated_at": "2026-10-20T13:00:00Z"}
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={"width": 412, "height": 915}, is_mobile=True, service_workers="block")
    c.route(LIB, lambda r: r.fulfill(status=200, content_type="application/javascript", body=MOCK))
    c.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body="window.SANSIYA_CONFIG={supabaseUrl:'https://abcd.supabase.co',supabaseKey:'sb_publishable_test_key_123456789'};"))
    for pat in ["https://fonts.googleapis.com/**", "https://financialmodelingprep.com/**", "https://assets.parqet.com/**"]: c.route(pat, lambda r: r.abort())
    pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    db = pg.evaluate("JSON.parse(sessionStorage.getItem('mockdb'))") or {"entries":{},"settings":{},"stocks":{},"dividends":{},"files":{},"broker_links":{}}
    db["stocks"] = {"s1": row("s1", "AAPL", "애플", "US", "USD", 3, 150, "toss", True, 1), "s2": row("s2", "MSTR", "스트래티지", "US", "USD", 6.4, 406.85, "toss", False, 2)}
    pg.evaluate("d => sessionStorage.setItem('mockdb', JSON.stringify(d))", db)
    pg.goto("about:blank"); pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    pg.locator("[data-view=stocks]:visible").first.click(); pg.wait_for_timeout(800)
    before = pg.inner_text(".st-big")
    pg.locator("#main .st-row", has_text="스트래티지").click(); pg.wait_for_selector(".st-sheet")
    pg.click("#stFoot [data-act=stEdit]"); pg.wait_for_selector("#stf-hidden")
    pg.check("#stf-hidden"); pg.click("#stForm button[type=submit]"); pg.wait_for_timeout(500)
    ok("detail shows 숨김", "숨김" in pg.inner_text(".st-dsym"))
    pg.click(".st-sheet [data-act=close]"); pg.wait_for_timeout(300)
    db = pg.evaluate("JSON.parse(sessionStorage.getItem('mockdb'))")
    m = db["stocks"]["s2"]
    ok("saved hidden, qty kept, broker kept", m["hidden"] is True and m["qty"] == 6.4 and m.get("broker") == "toss", str({k: m.get(k) for k in ["hidden", "qty", "broker"]}))
    rows = [t for t in pg.locator("#main .st-list:not(.st-dim) .st-row").all_inner_texts()]
    ok("list excludes hidden", all("스트래티지" not in r for r in rows) and any("애플" in r for r in rows))
    after = pg.inner_text(".st-big")
    ok("total excludes hidden", before != after, f"{before} -> {after}")
    ok("toggle shown", "숨긴 종목 1개" in pg.inner_text("#main"))
    pg.click("[data-act=showHidden]"); pg.wait_for_timeout(200)
    ok("toggle reveals dimmed row", pg.locator(".st-dim .st-row", has_text="스트래티지").count() == 1)
    pg.screenshot(path=f"{SP}/shots/hidden-hold.png", full_page=True)
    pg.locator(".st-dim .st-row", has_text="스트래티지").click(); pg.wait_for_selector(".st-sheet")
    pg.click("#stFoot [data-act=stEdit]"); pg.wait_for_selector("#stf-hidden")
    pg.uncheck("#stf-hidden"); pg.click("#stForm button[type=submit]"); pg.wait_for_timeout(400)
    pg.click(".st-sheet [data-act=close]"); pg.wait_for_timeout(300)
    ok("unhide restores", pg.inner_text(".st-big") == before and "숨긴 종목" not in pg.inner_text("#main"))
    ok("no errors", not errs, str(errs))
    b.close()
print("\n".join(log)); print("FAILS:", sum(l.startswith("FAIL") for l in log))
