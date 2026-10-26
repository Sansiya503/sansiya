import sys
from datetime import datetime
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; BASE = "http://localhost:8768/?demo"; IM = OUT + "/imgs"; log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
MONTH = datetime.now().strftime("%Y.%m")

with sync_playwright() as pw:
    b = pw.chromium.launch()
    def ctx(w, h, mob, scheme="light"):
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mob, device_scale_factor=2 if mob else 1, color_scheme=scheme, service_workers="block")
        for pat in ["https://fonts.googleapis.com/**", "https://icons.duckduckgo.com/**"]: c.route(pat, lambda r: r.fulfill(status=404, body=""))
        return c
    def add(pg, text):
        pg.fill("#bmkIn", text); pg.press("#bmkIn", "Enter"); pg.wait_for_timeout(120)
    items = lambda pg: pg.locator(".bmk-item").count()
    toast = lambda pg: pg.text_content("#toastRoot") or ""

    # ---------- PC, light ----------
    c = ctx(1280, 900, False); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    pg.locator("#tabbar [data-view=bookmarks]").click(); pg.wait_for_selector(".bmk")
    L = pg.evaluate("""() => { const r = s => document.querySelector(s).getBoundingClientRect();
      return { side: r('.bmk-side').width, sideLeft: r('.bmk-side').left < r('.bmk-pane').left, all: document.querySelector('.bmk-allbtn').textContent,
               allColor: getComputedStyle(document.querySelector('.bmk-allbtn')).color, colq: document.querySelector('#bmkColQ').placeholder,
               q: document.querySelector('#bmkQ').placeholder, inp: document.querySelector('#bmkIn').placeholder,
               icons: document.querySelectorAll('.bmk-add .bmk-ic').length, sideIcons: document.querySelectorAll('.bmk-side-head .bmk-ic').length,
               refresh: !!document.querySelector('[data-bmkrefresh]'), headerSearch: getComputedStyle(document.querySelector('.top .search')).display }; }""")
    ok("PC: collections sidebar on the left", L["sideLeft"] and 260 <= L["side"] <= 290, str(L["side"]))
    ok("PC: 전체보기 active in orange, sort + trash icons", L["all"] == "전체보기" and L["allColor"] == "rgb(242, 166, 0)" and L["sideIcons"] == 2, L["allColor"])
    ok("PC: placeholders match", L["colq"] == "컬렉션 검색 및 추가" and L["q"] == "검색어 입력" and L["inp"] == "URL 및 텍스트 입력, 파일 끌어 놓기", str(L))
    ok("PC: input has link / file / memo icons, refresh button, header search hidden", L["icons"] == 3 and L["refresh"] and L["headerSearch"] == "none")
    tabs = pg.eval_on_selector_all(".bmk-tabs button", "els => els.map(e => e.textContent)")
    ok("tabs", tabs == ["전체", "링크", "사진/동영상", "파일", "메모"], str(tabs))
    ok("empty state", "아직 저장한 게 없어요" in pg.inner_text(".bmk-list"))
    add(pg, "naver.com"); add(pg, "youtube.com/watch?v=abc"); add(pg, "example.com/files/plan.pdf"); add(pg, "회의 아이디어 정리하기")
    ok("plain text saved as memo", "메모로 저장" in toast(pg))
    ok("4 items", items(pg) == 4, str(items(pg)))
    heads = pg.eval_on_selector_all(".bmk-month", "els => els.map(e => e.innerText.replace(/\\s+/g, ' ').trim())")
    ok("month header with 선택", heads == [f"{MONTH} 선택"], str(heads))
    row = pg.evaluate("""() => { const it = [...document.querySelectorAll('.bmk-item')].find(e => e.innerText.includes('naver.com')); const th = it.querySelector('.bmk-th').getBoundingClientRect();
      return { th: [Math.round(th.width), Math.round(th.height)], src: it.querySelector('.bmk-tx small').textContent, more: !!it.querySelector('.bmk-more'), href: it.querySelector('a.bmk-go').href, target: it.querySelector('a.bmk-go').target }; }""")
    ok("row: 86px thumb, 'site | 링크', ⋮, opens in new tab", row["th"] == [86, 86] and row["src"] == "naver.com | 링크" and row["more"] and row["href"] == "https://naver.com/" and row["target"] == "_blank", str(row))
    srcs = pg.eval_on_selector_all(".bmk-item .bmk-tx small", "els => els.map(e => e.textContent)")
    ok("kinds detected", sorted(srcs) == sorted(["naver.com | 링크", "youtube.com | 사진/동영상", "example.com | 파일", "메모"]), str(srcs))
    for key, want in [("link", 1), ("media", 1), ("file", 1), ("memo", 1), ("all", 4)]:
        pg.click(f"[data-bmktab={key}]"); pg.wait_for_timeout(80)
        ok(f"tab {key} shows {want}", items(pg) == want and pg.get_attribute(f"[data-bmktab={key}]", "aria-selected") == "true", str(items(pg)))
    pg.fill("#bmkQ", "아이디어"); pg.wait_for_timeout(100)
    ok("search keeps focus and filters", items(pg) == 1 and pg.evaluate("document.activeElement.id") == "bmkQ")
    pg.fill("#bmkQ", "없는말"); pg.wait_for_timeout(100); ok("search: nothing found", "에 맞는 항목이 없어요" in pg.inner_text(".bmk-list"))
    pg.fill("#bmkQ", ""); pg.wait_for_timeout(100)
    # collections
    none = pg.text_content(f"[data-bmkcol='__none'] small")
    ok("컬렉션 없음 count", none == "4", none)
    pg.fill("#bmkColQ", "건축"); pg.wait_for_timeout(80)
    ok("typing a new name offers to create it", "‘건축’ 컬렉션 만들기" in pg.inner_text("#bmkCols"))
    pg.press("#bmkColQ", "Enter"); pg.wait_for_timeout(150)
    ok("new empty collection is selected", pg.get_attribute("[data-bmkcol='건축']", "aria-current") == "true" and "이 컬렉션이 비어 있어요" in pg.inner_text(".bmk-list"))
    add(pg, "dezeen.com/architecture")
    ok("link added inside a collection joins it", pg.text_content("[data-bmkcol='건축'] small") == "1" and items(pg) == 1)
    pg.click("[data-bmkcol='']"); pg.wait_for_timeout(100)
    nid = pg.evaluate("window.__sansiya.S.bookmarks.find(b => b.url === 'https://naver.com/').id")
    pg.click(f"[data-bmkmenu='{nid}']"); pg.wait_for_timeout(80)
    menu = pg.eval_on_selector_all(".bmk-pop button", "els => els.map(e => e.textContent)")
    ok("⋮ menu", menu == ["편집", "컬렉션 지정", "링크 복사", "삭제"], str(menu))
    pg.screenshot(path=f"{OUT}/shots/bmk-menu-desk.png")
    pg.mouse.click(5, 300); pg.wait_for_timeout(80); ok("menu closes on outside click", pg.locator(".bmk-pop").count() == 0)
    pg.click(f"[data-bmkmenu='{nid}']"); pg.click(f"[data-bmkact='col:{nid}']"); pg.wait_for_selector("#bmkColPick")
    pg.click("[data-bmkpickcol='건축']"); pg.fill("#bmk-newcol", "읽을거리"); pg.click("#bmkColPick [type=submit]"); pg.wait_for_timeout(150)
    ok("collection picker sets collections", pg.text_content("[data-bmkcol='건축'] small") == "2" and pg.text_content("[data-bmkcol='읽을거리'] small") == "1")
    pg.click("[data-bmkcol='__none']"); pg.wait_for_timeout(80); ok("컬렉션 없음 filter", items(pg) == 3, str(items(pg)))
    pg.click("[data-bmkcol='']"); pg.wait_for_timeout(80)
    # memo editor
    pg.click("[data-bmkact='memo:']"); pg.wait_for_selector("#bmkMemoForm")
    pg.fill("#bmk-memo", "다음 답사지\n루이스 칸 소크 연구소"); pg.click("#bmkMemoForm [type=submit]"); pg.wait_for_timeout(150)
    pg.click("[data-bmktab=memo]"); pg.wait_for_timeout(80)
    titles = pg.eval_on_selector_all(".bmk-item .bmk-tx b", "els => els.map(e => e.textContent)")
    ok("memo editor: first line is the title", "다음 답사지" in titles and items(pg) == 2, str(titles))
    ok("memo second line shown as source", "루이스 칸 소크 연구소 | 메모" in pg.inner_text(".bmk-list"))
    pg.locator(".bmk-go[data-bmkact^='memo:']").first.click(); pg.wait_for_selector("#bmkMemoForm"); ok("tapping a memo opens it", pg.input_value("#bmk-memo").startswith("다음 답사지")); pg.click("[data-act=close]")
    pg.click("[data-bmktab=all]"); pg.wait_for_timeout(80)
    # sort
    pg.click("[data-bmksort]"); pg.wait_for_timeout(80); ok("sort: 오래된순", "오래된순" in toast(pg) and pg.locator(".bmk-item .bmk-tx b").first.text_content() == "naver.com")
    pg.click("[data-bmksort]"); pg.wait_for_timeout(80); ok("sort: 이름순 (one group)", pg.eval_on_selector_all(".bmk-month b", "els => els.map(e => e.textContent)") == ["이름순"])
    pg.click("[data-bmksort]"); pg.wait_for_timeout(80)
    # select + delete to trash + restore
    pg.click("[data-bmkselect]"); pg.wait_for_timeout(80)
    ok("select mode: checkboxes, no ⋮, 취소", pg.locator(".bmk-ck").count() == items(pg) and pg.locator(".bmk-more").count() == 0 and pg.text_content(".bmk-selbtn") == "취소")
    pg.locator(".bmk-go[data-bmkpick]").nth(0).click(); pg.locator(".bmk-go[data-bmkpick]").nth(1).click(); pg.wait_for_timeout(80)
    ok("select bar counts", "2개 선택" in pg.inner_text(".bmk-selbar"))
    pg.screenshot(path=f"{OUT}/shots/bmk-select-desk.png")
    before = items(pg)
    pg.click(".bmk-selbar [data-bmkact='del:*']"); pg.wait_for_timeout(150)
    ok("delete moves to trash", items(pg) == before - 2 and "휴지통으로" in toast(pg) and pg.locator(".bmk-selbar").count() == 0)
    pg.click("[data-bmktrash]"); pg.wait_for_timeout(100)
    ok("trash view lists them", pg.locator(".bmk-item").count() == 2 and "30일" in pg.inner_text(".bmk-trashhead"))
    pg.locator("[data-bmkact^='restore:']").first.click(); pg.wait_for_timeout(100)
    ok("restore one", pg.locator(".bmk-item").count() == 1 and "되돌렸어요" in toast(pg))
    pg.click("[data-bmkact='empty:ask']"); pg.click("[data-bmkact='empty:yes']"); pg.wait_for_timeout(100)
    ok("empty trash", "휴지통이 비어 있어요" in pg.inner_text(".bmk-list"))
    pg.click("[data-bmkcol='']"); pg.wait_for_timeout(80); ok("back to list", items(pg) == before - 1, str(items(pg)))
    # drop a link, pick a photo with the file button
    pg.evaluate("""() => { const dt = new DataTransfer(); dt.setData('text/uri-list', 'https://www.archdaily.com/1'); const t = document.querySelector('.bmk-add');
      t.dispatchEvent(new DragEvent('dragover', { dataTransfer:dt, bubbles:true, cancelable:true })); t.dispatchEvent(new DragEvent('drop', { dataTransfer:dt, bubbles:true, cancelable:true })); }""")
    pg.wait_for_timeout(150); ok("dropping a link saves it", "archdaily.com" in pg.inner_text(".bmk-list"))
    pg.set_input_files("#bmkFile", [f"{IM}/trip.jpg"]); pg.wait_for_function("[...document.querySelectorAll('.bmk-item small')].some(e => e.textContent === '앨범 | 사진')", timeout=15000)
    ok("file button uploads a photo and bookmarks it", pg.evaluate("window.__sansiya.S.photos.length") == 1)
    # scroll to top
    pg.evaluate("""() => { const S = window.__sansiya.S, now = Date.now(); for(let i = 0; i < 40; i++) S.bookmarks.push({ id:crypto.randomUUID(), kind:'link', ref:'', url:'https://site' + i + '.com/', title:'항목 ' + i, memo:'', tags:[], createdAt:now - i * 86400e3 * 3, updatedAt:now }); }""")
    pg.locator("#tabbar [data-view=bookmarks]").click(); pg.wait_for_timeout(150)
    ok("top button hidden at the top", pg.locator(".bmk-totop").is_hidden())
    pg.mouse.wheel(0, 3000); pg.wait_for_timeout(300); ok("top button appears after scrolling", pg.locator(".bmk-totop").is_visible())
    ok("older items grouped by month", pg.locator(".bmk-month").count() >= 3 and pg.locator(".bmk-selbtn").count() == 1)
    pg.click(".bmk-totop"); pg.wait_for_function("window.scrollY < 50", timeout=4000); ok("top button scrolls up", pg.evaluate("window.scrollY") < 50)
    pg.screenshot(path=f"{OUT}/shots/bmk-desk-light.png")
    ok("PC no sideways scroll", pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))
    ok("PC no errors", not errs, str(errs))
    c.close()

    # ---------- phones + dark ----------
    for w, h, scheme in [(360, 780, "light"), (412, 900, "dark")]:
        c = ctx(w, h, True, scheme); pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
        pg.locator("#tabbar [data-view=bookmarks]").click(); pg.wait_for_selector(".bmk")
        for x in ["naver.com", "youtube.com/watch?v=1", "회의 메모 한 줄"]: add(pg, x)
        pg.fill("#bmkColQ", "건축"); pg.press("#bmkColQ", "Enter"); pg.wait_for_timeout(100); pg.click("[data-bmkcol='']"); pg.wait_for_timeout(80)
        t = f"[{w}/{scheme}]"
        g = pg.evaluate("""() => { const r = s => document.querySelector(s).getBoundingClientRect(); const cut = [...document.querySelectorAll('.bmk-tabs button')].filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent);
          return { stacked: r('.bmk-side').bottom <= r('.bmk-pane').top + 1, colsRow: getComputedStyle(document.querySelector('.bmk-cols')).flexDirection, cut, th: Math.round(r('.bmk-th').width),
                   fit: document.documentElement.scrollWidth <= document.documentElement.clientWidth, bg: getComputedStyle(document.querySelector('.bmk')).backgroundColor }; }""")
        ok(f"{t} collections above the list, in one scrolling row", g["stacked"] and g["colsRow"] == "row", str(g))
        ok(f"{t} tab names not cut, 64px thumbs, no sideways scroll", not g["cut"] and g["th"] == 64 and g["fit"], str(g))
        ok(f"{t} theme background", g["bg"] == ("rgb(28, 24, 19)" if scheme == "dark" else "rgb(255, 255, 255)"), g["bg"])
        pg.click("[data-bmkselect]"); pg.locator(".bmk-go[data-bmkpick]").first.click(); pg.wait_for_timeout(80)
        sb = pg.evaluate("(() => { const r = document.querySelector('.bmk-selbar').getBoundingClientRect(); return [r.left >= 0, r.right <= document.documentElement.clientWidth]; })()")
        ok(f"{t} select bar fits the screen", sb == [True, True], str(sb))
        pg.click("[data-bmksort]"); pg.wait_for_timeout(80)
        ov = pg.evaluate("(() => { const a = document.querySelector('.toast').getBoundingClientRect(), b = document.querySelector('.bmk-selbar').getBoundingClientRect(); return a.bottom <= b.top + 1; })()")
        ok(f"{t} toast sits above the select bar", ov)
        pg.screenshot(path=f"{OUT}/shots/bmk-{w}-{scheme}.png", full_page=True)
        ok(f"{t} no errors", not errs, str(errs))
        c.close()
    b.close()
print("\n".join(log)); print("FAILS:", sum(l.startswith("FAIL") for l in log))
