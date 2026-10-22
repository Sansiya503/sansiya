import os
import sys, re, json, hashlib
from playwright.sync_api import sync_playwright
SP = sys.argv[1]; BASE = "http://localhost:8768/"
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "e2e_stocks.py")).read()
MOCK = re.search(r'MOCK = r"""(.*?)"""', src, re.S).group(1)
MOCK = MOCK.replace('if(st.op === "delete"){', 'if(st.op === "update"){ Object.keys(tbl).forEach(k => { if(st.filters.every(([c,v]) => tbl[k][c] === v)) Object.assign(tbl[k], st.patch); }); save(d); return Promise.resolve({data:null, error:null}); }\n    if(st.op === "delete"){')
MOCK = MOCK.replace('st.rows.forEach(r => { tbl[r.id || r.user_id] = r; });', 'st.rows.forEach(r => { const k = r.id || r.user_id; tbl[k] = Object.assign(tbl[k] || {}, r); });')
assert 'Object.assign(tbl[k] || {}, r)' in MOCK
MOCK = MOCK.replace('upsert(rows){', 'update(o){st.op="update";st.patch=o;return api}, upsert(rows){')
MOCK = MOCK.replace('{"entries":{},"settings":{},"stocks":{},"dividends":{},"files":{}}', '{"entries":{},"settings":{},"stocks":{},"dividends":{},"files":{},"broker_links":{}}')
assert 'st.op === "update"' in MOCK and 'update(o)' in MOCK
LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js"
UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
def row(id_, sym, name, market, cur, qty, avg, broker, watch=False, sort=1):
    return {"id": id_, "user_id": UID, "symbol": sym, "market": market, "name": name, "currency": cur, "watch": watch, "qty": qty, "avg_price": avg,
            "target_price": None, "memo": "", "notes": [], "sort": sort, "broker": broker, "broker_synced_at": "2026-10-20T13:00:00Z" if broker else None,
            "created_at": "2026-10-20T00:00:00Z", "updated_at": "2026-10-20T13:00:00Z"}
with sync_playwright() as p:
    b = p.chromium.launch()
    for scheme, w, h, mob in [("light", 412, 915, True), ("dark", 1280, 860, False)]:
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mob, color_scheme=scheme, service_workers="block")
        c.grant_permissions(["clipboard-read", "clipboard-write"])
        c.route(LIB, lambda r: r.fulfill(status=200, content_type="application/javascript", body=MOCK))
        c.route("**/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body="window.SANSIYA_CONFIG={supabaseUrl:'https://abcd.supabase.co',supabaseKey:'sb_publishable_test_key_123456789'};"))
        for pat in ["https://fonts.googleapis.com/**", "https://financialmodelingprep.com/**", "https://assets.parqet.com/**"]: c.route(pat, lambda r: r.abort())
        pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        tag = scheme
        pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
        # 1. settings: not linked -> make code
        pg.click("#setBtn"); pg.wait_for_selector("text=토스증권 연동")
        pg.wait_for_selector("[data-act=brokerCode]")
        ok(f"[{tag}] settings offers link", "조회만 해요" in pg.inner_text(".set"))
        pg.click("[data-act=brokerCode]"); pg.wait_for_selector("#brokerCode")
        code = pg.inner_text("#brokerCode")
        ok(f"[{tag}] code format", re.fullmatch(r"ssy_[A-Za-z0-9_\-]{43}", code) is not None, code)
        db = pg.evaluate("JSON.parse(sessionStorage.getItem('mockdb'))")
        stored = list(db["broker_links"].values())
        ok(f"[{tag}] only hash stored", len(stored) == 1 and stored[0]["token_hash"] == hashlib.sha256(code.encode()).hexdigest() and code not in json.dumps(db))
        ok(f"[{tag}] steps + kit link", pg.locator("a[href='toss-sync/sansiya-toss-sync.zip']").count() == 1 and "1-install" in pg.inner_text(".set"))
        pg.click("[data-act=copyBroker]"); pg.wait_for_timeout(200)
        clip = pg.evaluate("navigator.clipboard.readText()")
        ok(f"[{tag}] copy", clip == code)
        pg.screenshot(path=f"{SP}/shots/broker-code-{tag}.png")
        pg.click(".sheetbox [data-act=close]"); pg.wait_for_timeout(200)
        # 2. simulate the connector having synced
        db = pg.evaluate("JSON.parse(sessionStorage.getItem('mockdb'))")
        db["stocks"] = {"s1": row("s1", "TSLA", "테슬라", "US", "USD", 3.5, 251.2, "toss", True, 1), "s2": row("s2", "005930.KS", "삼성전자", "KR", "KRW", 10, 65000, "toss", False, 2),
                        "s3": row("s3", "SCHD", "SCHD", "US", "USD", 5, 27, None, True, 3)}
        lk = list(db["broker_links"].values())[0]; lk.update({"last_status": "ok", "last_sync_at": "2026-10-20T13:00:00Z", "holdings_count": 2, "account_tail": "8901", "last_ip": "203.0.113.7"})
        pg.evaluate("d => sessionStorage.setItem('mockdb', JSON.stringify(d))", db)
        pg.goto("about:blank"); pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
        pg.locator("[data-view=stocks]:visible").first.click(); pg.wait_for_selector(".st-hero"); pg.wait_for_timeout(600)
        hold = pg.inner_text("#main")
        ok(f"[{tag}] toss tags on synced rows", pg.locator("#main .st-row .st-toss").count() == 2, str(pg.locator("#main .st-row .st-toss").count()))
        ok(f"[{tag}] status line", "토스증권 보유 종목과" in hold and "맞췄어요" in hold, [l for l in hold.split("\n") if "토스" in l][:2].__str__())
        pg.screenshot(path=f"{SP}/shots/broker-hold-{tag}.png")
        # 3. toss stock form is read-only and keeps qty
        pg.locator("#main .st-row", has_text="테슬라").click(); pg.wait_for_selector(".st-sheet")
        ok(f"[{tag}] detail button label", "메모·목표가 수정" in pg.inner_text("#stFoot"))
        pg.click("#stFoot [data-act=stEdit]"); pg.wait_for_selector("#stForm")
        ok(f"[{tag}] qty/avg readonly", pg.get_attribute("#stf-qty", "readonly") is not None and pg.get_attribute("#stf-avg", "readonly") is not None)
        pg.fill("#stf-target", "400"); pg.click("#stForm button[type=submit]"); pg.wait_for_timeout(500)
        db = pg.evaluate("JSON.parse(sessionStorage.getItem('mockdb'))")
        t = db["stocks"]["s1"]
        ok(f"[{tag}] save keeps qty, broker untouched", t["qty"] == 3.5 and t["avg_price"] == 251.2 and t.get("broker") == "toss" and t["target_price"] == 400, str({k: t.get(k) for k in ["qty", "avg_price", "broker", "target_price"]}))
        pg.click(".st-sheet [data-act=close]"); pg.wait_for_timeout(200)
        # 4. error state
        db["broker_links"][UID].update({"last_status": "error", "last_error": "ip-not-allowed", "last_ip": "198.51.100.9"})
        pg.evaluate("d => sessionStorage.setItem('mockdb', JSON.stringify(d))", db)
        pg.goto("about:blank"); pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
        pg.locator("[data-view=stocks]:visible").first.click(); pg.wait_for_timeout(800)
        ok(f"[{tag}] stocks shows problem", "연동 확인이 필요해요" in pg.inner_text("#main"))
        pg.click(".st-broker [data-act=settings]"); pg.wait_for_timeout(500)
        st = pg.inner_text(".set")
        ok(f"[{tag}] settings explains IP", "198.51.100.9" in st and "허용 IP 관리" in st, st[st.find("토스증권 연동"):][:160].replace("\n", " | "))
        pg.screenshot(path=f"{SP}/shots/broker-error-{tag}.png")
        # 5. unlink
        pg.click("[data-act=brokerOff]"); pg.click("[data-act=brokerOffYes]"); pg.wait_for_timeout(400)
        db = pg.evaluate("JSON.parse(sessionStorage.getItem('mockdb'))")
        ok(f"[{tag}] unlink clears link + flags", not db["broker_links"] and all(not r.get("broker") for r in db["stocks"].values()))
        ok(f"[{tag}] settings back to start", pg.locator("[data-act=brokerCode]").count() == 1)
        ok(f"[{tag}] no errors", not errs, str(errs))
        c.close()
    b.close()
print("\n".join(log)); print("FAILS:", sum(l.startswith("FAIL") for l in log))
