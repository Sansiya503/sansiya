import sys
from playwright.sync_api import sync_playwright
SP = sys.argv[1]; log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, mob, scheme in [(412, 915, True, "light"), (412, 915, True, "dark"), (1280, 800, False, "light"), (1700, 900, False, "light"), (1700, 900, False, "dark")]:
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mob, color_scheme=scheme, service_workers="block")
        c.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://localhost:8768/?demo"); pg.wait_for_selector("#app:not([hidden])")
        t = f"[{w}/{scheme}]"
        g = pg.evaluate("""() => { const r = s => document.querySelector(s).getBoundingClientRect();
          const row = r('.top-row'), mb = r('.menubar'), tb = r('#tabbar'), top = r('.top');
          return {rowBottom: row.bottom, mbTop: mb.top, mbBorder: getComputedStyle(document.querySelector('.menubar')).borderTopWidth,
                  tabTop: tb.top, brandBottom: r('.brand').bottom, searchBottom: r('.search').bottom, newBottom: r('#newBtn').bottom,
                  mbW: mb.width, vw: document.documentElement.clientWidth, headerBottom: top.bottom, tabLeft: tb.left, brandLeft: r('.brand').left}; }""")
        ok(f"{t} menu sits under the header line", g["mbTop"] >= g["rowBottom"] - 0.5 and g["mbBorder"] == "1px" and g["tabTop"] > max(g["brandBottom"], g["searchBottom"], g["newBottom"]), str(g))
        ok(f"{t} line spans full width", abs(g["mbW"] - g["vw"]) < 1)
        ok(f"{t} menu lines up with logo", abs(g["tabLeft"] - g["brandLeft"]) < 2, f'{g["tabLeft"]} vs {g["brandLeft"]}')
        tabs = pg.eval_on_selector_all("#tabbar button", "els => els.map(e => e.textContent)")
        ok(f"{t} menus", tabs == ["아카이브", "통계 · 회고", "주식", "비트코인", "사진", "북마크"], str(tabs))
        pg.screenshot(path=f"{SP}/shots/menubar-{w}-{scheme}.png", clip={"x": 0, "y": 0, "width": w, "height": 260})
        for v in ["stats", "stocks", "archive"]:
            pg.locator(f"#tabbar [data-view={v}]").click(); pg.wait_for_timeout(250)
            ok(f"{t} switch to {v}", pg.get_attribute(f"#tabbar [data-view={v}]", "aria-current") == "true")
        pg.locator("#tabbar [data-view=stats]").click(); pg.wait_for_timeout(300)
        pg.evaluate("document.querySelector('#main').style.minHeight = '3000px'; window.scrollTo(0, 1200)"); pg.wait_for_timeout(300)
        pinned = pg.evaluate("(() => { const r = document.querySelector('#tabbar').getBoundingClientRect(); return [window.scrollY, r.top, r.bottom]; })()")
        ok(f"{t} menu stays pinned after scroll", pinned[0] > 200 and 0 < pinned[1] < 200, str(pinned))
        ok(f"{t} no sideways scroll", pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))
        ok(f"{t} no errors", not errs, str(errs))
        c.close()
    b.close()
print("\n".join(log)); print("FAILS:", sum(l.startswith("FAIL") for l in log))
