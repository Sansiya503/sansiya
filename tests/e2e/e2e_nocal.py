import sys
from playwright.sync_api import sync_playwright
SP = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, mob in [(412, 915, True), (1280, 800, False)]:
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mob, service_workers="block")
        c.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://localhost:8768/?demo"); pg.wait_for_selector("#app:not([hidden])")
        tabs = pg.eval_on_selector_all("#tabbar button", "els => els.map(e => e.textContent)")
        for v in ["archive", "stats", "stocks"]:
            pg.locator(f"#tabbar [data-view={v}]").click(); pg.wait_for_timeout(300)
        same_row = pg.evaluate("Math.abs(document.querySelector('#tabbar').getBoundingClientRect().top - document.querySelector('.brand').getBoundingClientRect().top) < 20")
        pg.screenshot(path=f"{SP}/shots/nocal-{w}.png")
        print(w, tabs, "calendar gone:", "캘린더" not in tabs and pg.locator("[data-view=calendar]").count() == 0, "| tabs beside logo:", same_row, "| errors:", errs)
        c.close()
    b.close()
