import os
import sys, json
from playwright.sync_api import sync_playwright
SP = sys.argv[1]; BASE = "http://localhost:8768/?demo"
emap = {e["id"]: e for e in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "sample.json")))["entries"]}
log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h, mob, tag) in [(1280, 860, False, "desk"), (412, 915, True, "phone")]:
        for scheme in ["light", "dark"]:
            c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mob, color_scheme=scheme, service_workers="block")
            c.route("https://fonts.googleapis.com/**", lambda r: r.abort())
            pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
            pg.evaluate("""m => new Promise(res => { const r = indexedDB.open('sansiya', 1); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(m, 'local:entries'); tx.oncomplete = res; }; })""", emap)
            pg.goto("about:blank"); pg.goto(BASE); pg.wait_for_selector(".row"); pg.wait_for_timeout(300)
            n_rows = pg.locator("#main .row").count(); n_cov = pg.locator("#main .row .cover").count()
            ok(f"[{tag}/{scheme}] every row has a cover", n_rows > 0 and n_rows == n_cov, f"{n_cov}/{n_rows}")
            if scheme == "light":
                # new record without photo is blocked
                pg.locator("#newBtn").click(); pg.wait_for_selector("#edForm")
                first_fld = pg.eval_on_selector("#edForm .sb-body > .fld", "e => e.id")
                ok(f"[{tag}] photo field is first", first_fld == "f-photos")
                pg.fill("#f-title", "테스트 사진 기록")
                pg.click("#edForm button[type=submit]"); pg.wait_for_timeout(300)
                ok(f"[{tag}] save blocked without photo", pg.locator("#edForm").count() == 1 and "사진을 한 장 이상" in pg.inner_text("#toastRoot"), pg.inner_text("#toastRoot"))
                ok(f"[{tag}] photo box highlighted", "need" in (pg.get_attribute("#f-photos", "class") or ""))
                pg.set_input_files("#f-photo", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fixtures", "test-photo.jpg")); pg.wait_for_selector("#edForm .photos .p img[src]")
                ok(f"[{tag}] first photo marked 대표", pg.locator("#edForm .photos .p .first").count() == 1)
                pg.screenshot(path=f"{SP}/shots/cover-editor-{tag}.png")
                pg.click("#edForm button[type=submit]"); pg.wait_for_timeout(500)
                ok(f"[{tag}] saved with photo", pg.locator("#edForm").count() == 0 and "테스트 사진 기록" in pg.inner_text("#main"))
                row = pg.locator("#main .row", has_text="테스트 사진 기록")
                ok(f"[{tag}] new row shows its photo", row.locator(".cover img[src]").count() == 1)
                pg.wait_for_timeout(300)
            pg.screenshot(path=f"{SP}/shots/cover-{tag}-{scheme}.png")
            ok(f"[{tag}/{scheme}] no errors", not errs, str(errs))
            c.close()
    b.close()
print("\n".join(log)); print("FAILS:", sum(l.startswith("FAIL") for l in log))
