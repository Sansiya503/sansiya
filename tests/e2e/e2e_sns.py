import sys, json
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]; BASE = "http://localhost:8768/?demo"; log = []
def ok(n, c, x=""): log.append(("PASS" if c else "FAIL") + f"  {n} {x}")
JPG = open(OUT + "/imgs/trip.jpg", "rb").read()
KST = timezone(timedelta(hours=9))
now = datetime.now(timezone.utc)
today = datetime.now(KST).date()
def iso(h): return (now - timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
def author(i, badge="blue", square=False):
    return {"name": f"연구자 {i}" if i != 3 else "아주 아주 긴 이름을 가진 게임 그래픽 프로그래머 계정입니다", "handle": f"dev_{i}", "avatar": f"https://pbs.twimg.com/profile_images/{i}/a_200x200.jpg", "square": square, "badge": badge}
IMG = lambda i: f"https://pbs.twimg.com/media/img{i}.jpg"
posts = []
kinds = ["text", "photo1", "photo2", "photo3", "photo4", "video", "card", "quote"]
for i in range(40):
    k = kinds[i % len(kinds)]
    day = today - timedelta(days=0 if i < 7 else 1 + (i - 7) // 8)
    p = {"id": str(1850000000000000000 + i), "url": f"https://x.com/dev_{i}/status/{1850000000000000000 + i}", "author": author(i, "gold" if i == 6 else "blue", i == 6),
         "lang": "en", "createdAt": iso(i * 3 + 0.5), "replies": 12 * i, "likes": [0, 999, 12345, 3400000][i % 4],
         "rich": [f"Post {i}: new Unreal Engine 5 Nanite demo ", ["epicgames.com/unreal…", "https://www.epicgames.com/unreal"], " ", ["#UE5", "https://x.com/hashtag/UE5"], "\nsecond line"],
         "media": [], "topics": [["ai"], ["science"], ["tech"], ["unreal"], ["gamedev"], ["graphics"], ["ai", "tech"], ["unreal", "graphics"]][i % 8],
         "addedOn": day.isoformat(), "following": i % 2 == 0}
    if i % 3 == 0: p["ko"] = f"게시물 {i}: 새 언리얼 엔진 5 나나이트 데모"
    if i == 0: p["more"] = True
    if i == 2: p["topics"] = ["arch"]
    if k.startswith("photo"): p["media"] = [{"type": "photo", "src": IMG(j), "w": 1200, "h": 800 if i != 1 else 2400} for j in range(int(k[-1]))]
    if k == "video": p["media"] = [{"type": "video", "src": IMG(9), "w": 1920, "h": 1080, "mp4": "https://video.twimg.com/v.mp4"}]
    if k == "card": p["card"] = {"title": "Introducing a new model for real-time global illumination", "domain": "research.example.com", "img": IMG(5), "href": "https://research.example.com/gi", "large": i % 16 == 6}
    if k == "quote": p["quote"] = {"id": "1", "url": "https://x.com/q/status/1", "author": author(99), "createdAt": iso(30), "rich": ["Quoted post text"], "media": [{"type": "photo", "src": IMG(1), "w": 800, "h": 800}]}
    posts.append(p)
FEED = json.dumps({"updatedAt": datetime.now(KST).isoformat(timespec="seconds"), "posts": posts})

with sync_playwright() as pw:
    b = pw.chromium.launch()
    for w, h, mob, scheme in [(360, 780, True, "light"), (412, 915, True, "dark"), (1280, 860, False, "light"), (1280, 860, False, "dark")]:
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mob, device_scale_factor=2 if mob else 1, color_scheme=scheme, service_workers="block")
        c.route("https://fonts.googleapis.com/**", lambda r: r.abort())
        c.route("https://pbs.twimg.com/**", lambda r: r.fulfill(status=200, content_type="image/jpeg", body=JPG))
        c.route("https://video.twimg.com/**", lambda r: r.fulfill(status=404, body=""))
        c.route("**/sns/feed.json*", lambda r: r.fulfill(status=200, content_type="application/json", body=FEED))
        pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
        t = f"[{w}/{scheme}]"
        tabs = pg.eval_on_selector_all("#tabbar button", "els => els.map(e => e.textContent.trim())")
        ok(f"{t} SNS sits between 사진 and 북마크", tabs[-3:] == ["사진", "SNS", "북마크"], str(tabs))
        ok(f"{t} SNS has a round icon", pg.locator("#tabbar [data-view=sns] .tb-ic svg circle").count() >= 1)
        ok(f"{t} menu fits without sideways scroll", pg.evaluate("(() => { const t = document.querySelector('#tabbar'); return t.scrollWidth <= t.clientWidth + 1; })()"))
        cut = pg.evaluate("[...document.querySelectorAll('#tabbar .tb-l')].filter(e => e.scrollWidth > e.clientWidth + 0.5).map(e => e.textContent)")
        ok(f"{t} no menu name cut off", not cut, str(cut))
        pg.locator("#tabbar [data-view=sns]").click(); pg.wait_for_selector(".xp")
        ok(f"{t} SNS selected", pg.get_attribute("#tabbar [data-view=sns]", "aria-current") == "true")
        n = pg.locator(".xp").count()
        ok(f"{t} first page shows 30 posts", n == 30, str(n))
        topics = pg.eval_on_selector_all(".xf-tabs button", "els => els.map(e => e.textContent)")
        ok(f"{t} topic tabs", topics == ["전체", "AI", "과학", "기술", "언리얼 엔진", "게임 개발", "게임 그래픽", "건축"], str(topics))
        ok(f"{t} header search hidden", not pg.is_visible(".top .search"))
        day0 = pg.text_content(".xf-day") or ""
        ok(f"{t} today's divider with count", day0.startswith("오늘 · ") and "소식 7개" in day0, day0)
        first = pg.locator(".xp").first
        ok(f"{t} post has avatar, name, badge, handle, time", first.locator(".xp-ava img").count() == 1 and first.locator(".xp-name b").count() == 1 and first.locator(".xp-badge").count() == 1 and "@dev_0" in first.locator(".xp-handle").text_content() and first.locator("time").text_content().strip() in ("방금", "30분"), first.locator("time").text_content())
        links = first.locator(".xp-text a").evaluate_all("els => els.map(e => [e.textContent, e.href, e.target])")
        ok(f"{t} links and hashtags open X in a new tab", links == [["epicgames.com/unreal…", "https://www.epicgames.com/unreal", "_blank"], ["#UE5", "https://x.com/hashtag/UE5", "_blank"]], str(links))
        ok(f"{t} line breaks kept", first.locator(".xp-text br").count() == 1)
        ok(f"{t} long post has 더 보기 link to X", first.locator(".xp-showmore").get_attribute("href") == posts[0]["url"] and pg.locator(".xp").nth(1).locator(".xp-showmore").count() == 0)
        ok(f"{t} action row: reply/repost/like + bookmark/share", first.locator(".xp-acts .xp-act").count() == 5)
        likes = pg.eval_on_selector_all(".xp .xp-act.lk span", "els => els.slice(0, 4).map(e => e.textContent)")
        ok(f"{t} counts formatted like X", likes == ["", "999", "1.2만", "340만"], str(likes))
        # translate toggle
        tr = first.locator(".xp-tr")
        ok(f"{t} translate button", tr.count() == 1 and tr.text_content() == "게시물 번역하기")
        tr.click(); pg.wait_for_timeout(100)
        ko = pg.locator(".xp").first.locator(".xp-ko")
        ok(f"{t} translation shows", ko.count() == 1 and "영어에서 번역함" in ko.text_content() and "나나이트" in ko.text_content())
        pg.locator(".xp").first.locator(".xp-ko button").click(); pg.wait_for_timeout(100)
        ok(f"{t} translation hides again", pg.locator(".xp").first.locator(".xp-ko").count() == 0)
        # media grids
        grid = pg.evaluate("""() => [...document.querySelectorAll('.xp')].slice(0, 8).map(a => { const m = a.querySelector('.xp-media'); return m ? [m.className, m.querySelectorAll('.xp-m').length] : null; })""")
        ok(f"{t} media layouts 1-4 + video", grid[1] == ["xp-media n1", 1] and grid[2] == ["xp-media n2", 2] and grid[3] == ["xp-media n3", 3] and grid[4] == ["xp-media n4", 4] and grid[5] == ["xp-media n1", 1], str(grid))
        tall = pg.evaluate("document.querySelectorAll('.xp')[1].querySelector('.xp-media').getBoundingClientRect().height")
        ok(f"{t} tall photo capped", tall <= 517, str(tall))
        ok(f"{t} video plays inline", pg.locator(".xp").nth(5).locator("video[controls][poster]").count() == 1)
        ok(f"{t} link card", pg.locator(".xp").nth(6).locator(".xp-card b").text_content().startswith("Introducing"))
        ok(f"{t} quoted post", pg.locator(".xp").nth(7).locator(".xp-quote .xp-name b").text_content() == "연구자 99")
        ok(f"{t} quoted post's picture stays inside the quote box", pg.locator(".xp").nth(7).locator(".xp-quote .xp-media img").count() == 1 and pg.locator(".xp").nth(7).locator(".xp-quote a").count() == 0)
        ok(f"{t} gold badge for business", pg.locator(".xp").nth(6).locator(".xp-badge.gold").count() == 1)
        # long name stays on one line
        r = pg.evaluate("(() => { const a = document.querySelectorAll('.xp')[3]; const h = a.querySelector('.xp-top').getBoundingClientRect(); return [h.height, a.getBoundingClientRect().right, document.documentElement.clientWidth]; })()")
        ok(f"{t} long name truncates", r[0] <= 32 and r[1] <= r[2] + 0.5, str(r))
        ok(f"{t} no sideways scroll", pg.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"))
        col = pg.evaluate("(() => { const r = document.querySelector('.xf').getBoundingClientRect(); return [r.width, r.left, getComputedStyle(document.querySelector('.xf')).backgroundColor]; })()")
        ok(f"{t} X-like column", (col[0] <= 600.5 if not mob else abs(col[0] - w) < 1) and col[2] == ("rgb(0, 0, 0)" if scheme == "dark" else "rgb(255, 255, 255)"), str(col))
        pg.screenshot(path=f"{OUT}/shots/sns-{w}-{scheme}.png")
        # infinite scroll
        for _ in range(10): pg.mouse.wheel(0, 4000); pg.wait_for_timeout(150)
        n2 = pg.locator(".xp").count()
        ok(f"{t} more posts load on scroll", n2 == 40 and pg.locator("#snsMore").count() == 0, str(n2))
        head = pg.evaluate("[Math.round(document.querySelector('.xf-head').getBoundingClientRect().top), Math.round(document.querySelector('.top').getBoundingClientRect().bottom)]")
        ok(f"{t} tabs stay pinned under header", abs(head[0] - head[1]) <= 1, str(head))
        # topic filter
        pg.click("[data-snstopic=unreal]"); pg.wait_for_timeout(150)
        ctx = pg.eval_on_selector_all(".xp .xp-ctx span", "els => els.map(e => e.textContent)")
        ok(f"{t} topic filter", len(ctx) == 10 and all("언리얼 엔진" in x for x in ctx) and pg.get_attribute("[data-snstopic=unreal]", "aria-selected") == "true", str(len(ctx)))
        ok(f"{t} filter resets scroll to top", pg.evaluate("window.scrollY") < 5)
        pg.click("[data-snstopic=arch]"); pg.wait_for_timeout(150)
        ok(f"{t} 건축 filter", pg.locator(".xp").count() == 1 and pg.text_content(".xp .xp-ctx span").startswith("건축"), str(pg.locator(".xp").count()))
        tabs_fit = pg.evaluate("(() => { const t = document.querySelector('.xf-tabs'); return [t.scrollWidth, t.clientWidth]; })()")
        if not mob: ok(f"{t} all 8 topic tabs fit across the column", tabs_fit[0] <= tabs_fit[1] + 1, str(tabs_fit))
        pg.click("[data-snstopic=science]"); pg.wait_for_timeout(100)
        # bookmark into the app's 북마크
        pg.locator(".xp").first.locator(".xp-act.bm").click(); pg.wait_for_timeout(150)
        ok(f"{t} bookmark toggles on", pg.locator(".xp").first.locator(".xp-act.bm").get_attribute("aria-pressed") == "true")
        pg.locator("#tabbar [data-view=bookmarks]").click(); pg.wait_for_timeout(200)
        bm = pg.text_content(".bm-list") or ""
        ok(f"{t} saved post shows in 북마크 with #SNS", "연구자 1" in bm and "#SNS" in bm, bm[:120])
        pg.locator("#tabbar [data-view=sns]").click(); pg.wait_for_selector(".xp")
        ok(f"{t} topic remembered", pg.get_attribute("[data-snstopic=science]", "aria-selected") == "true")
        pg.locator(".xp").first.locator(".xp-act.bm").click(); pg.wait_for_timeout(150)
        ok(f"{t} bookmark toggles off", pg.locator(".xp").first.locator(".xp-act.bm").get_attribute("aria-pressed") == "false")
        pg.click("[data-snstopic=all]")
        ok(f"{t} no errors", not errs, str(errs))
        c.close()

    # offline / failure: cached copy, then error message with retry
    c = b.new_context(viewport={"width": 412, "height": 900}, is_mobile=True, service_workers="block")
    c.route("https://fonts.googleapis.com/**", lambda r: r.abort())
    c.route("https://pbs.twimg.com/**", lambda r: r.fulfill(status=200, content_type="image/jpeg", body=JPG))
    state = {"fail": True}
    c.route("**/sns/feed.json*", lambda r: r.fulfill(status=503, body="") if state["fail"] else r.fulfill(status=200, content_type="application/json", body=FEED))
    pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    pg.locator("#tabbar [data-view=sns]").click(); pg.wait_for_selector(".xf-empty")
    ok("[fail] error message with retry", "불러오지 못했어요" in pg.text_content(".xf-empty") and pg.locator("[data-snsretry]").count() == 1)
    state["fail"] = False
    pg.click("[data-snsretry]"); pg.wait_for_selector(".xp")
    ok("[fail] retry loads the feed", pg.locator(".xp").count() == 30)
    state["fail"] = True
    pg.goto("about:blank"); pg.goto(BASE); pg.wait_for_selector("#app:not([hidden])")
    pg.locator("#tabbar [data-view=sns]").click(); pg.wait_for_timeout(600)
    ok("[fail] cached feed shown when the network fails", pg.locator(".xp").count() == 30)
    ok("[fail] no errors", not errs, str(errs))
    c.close()
    b.close()
print("\n".join(log)); print("FAILS:", sum(l.startswith("FAIL") for l in log))
