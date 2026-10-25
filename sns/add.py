#!/usr/bin/env python3
"""산시야 SNS 피드에 X 게시물을 넣는 도구.

    python sns/add.py picks.json          # 고른 글을 sns/feed.json 에 더해요
    python sns/add.py --refresh           # 이미 있는 글의 숫자(답글·마음에 들어요)만 새로 받아요

picks.json 은 이렇게 생긴 목록이에요 (url 대신 id 도 돼요):
    [{"url": "https://x.com/karpathy/status/123…", "topics": ["ai"], "ko": "한국어 번역", "following": true}]

topics: ai · science · tech · unreal · gamedev · graphics · arch(건축·조경·인테리어·도시계획·도시설계·공간디자인)
글 내용은 X의 공개 임베드용 주소(cdn.syndication.twimg.com)에서 받아요. 로그인·키가 필요 없어요.
"""
import datetime as dt
import html
import json
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
FEED = os.path.join(HERE, "feed.json")
TOPICS = {"ai", "science", "tech", "unreal", "gamedev", "graphics", "arch"}
MAX_POSTS = 600
KST = dt.timezone(dt.timedelta(hours=9))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"


def post_id(s):
    m = re.search(r"(?:status(?:es)?/)?(\d{6,25})", str(s))
    if not m:
        raise ValueError(f"X 게시물 주소가 아니에요: {s}")
    return m.group(1)


def fetch(pid):
    url = f"https://cdn.syndication.twimg.com/tweet-result?id={pid}&lang=ko&token=a"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read().decode("utf-8")
    if not body.strip():
        raise ValueError(f"{pid}: 글을 찾지 못했어요 (지워졌거나 비공개)")
    d = json.loads(body)
    if d.get("__typename") == "TweetTombstone" or "user" not in d:
        raise ValueError(f"{pid}: 볼 수 없는 글이에요")
    return d


def rich(d):
    """Post text as a list of plain strings and [label, href] links (t.co expanded, media links dropped)."""
    # X counts entity positions in characters (code points), the same way Python indexes str
    b = d.get("text") or ""
    n = len(b)
    lo, hi = (d.get("display_text_range") or [0, n])[:2]
    ent = d.get("entities") or {}
    spans = []
    for e in ent.get("urls") or []:
        spans.append((e["indices"][0], e["indices"][1], e.get("display_url") or e.get("expanded_url"), e.get("expanded_url") or e.get("url")))
    for e in ent.get("hashtags") or []:
        spans.append((e["indices"][0], e["indices"][1], None, "https://x.com/hashtag/" + e["text"]))
    for e in ent.get("symbols") or []:
        spans.append((e["indices"][0], e["indices"][1], None, "https://x.com/search?q=%24" + e["text"]))
    for e in ent.get("user_mentions") or []:
        spans.append((e["indices"][0], e["indices"][1], None, "https://x.com/" + e["screen_name"]))
    for e in ent.get("media") or []:
        spans.append((e["indices"][0], e["indices"][1], "", None))
    out, pos = [], lo
    for a, z, label, href in sorted(spans):
        if a < pos or a >= hi:
            continue
        if a > pos:
            out.append(html.unescape(b[pos:a]))
        if href:
            out.append([label or html.unescape(b[a:z]), href])
        pos = z
    if pos < hi:
        out.append(html.unescape(b[pos:hi]))
    # drop a reply's leading mentions and stray whitespace at the ends
    if out and isinstance(out[0], str):
        out[0] = out[0].lstrip()
    if out and isinstance(out[-1], str):
        out[-1] = out[-1].rstrip()
    return [x for x in out if x != ""]


def author(u):
    badge = None
    if u.get("verified_type") == "Business":
        badge = "gold"
    elif u.get("verified_type") == "Government":
        badge = "gray"
    elif u.get("is_blue_verified") or u.get("verified"):
        badge = "blue"
    return {
        "name": u.get("name") or u.get("screen_name"),
        "handle": u.get("screen_name"),
        "avatar": (u.get("profile_image_url_https") or "").replace("_normal.", "_200x200."),
        "square": u.get("profile_image_shape") == "Square",
        "badge": badge,
    }


def media(d):
    out = []
    for m in d.get("mediaDetails") or []:
        info = m.get("original_info") or {}
        item = {"type": {"animated_gif": "gif"}.get(m.get("type"), m.get("type")), "src": m.get("media_url_https"),
                "w": info.get("width"), "h": info.get("height")}
        if item["type"] in ("video", "gif"):
            mp4 = [v for v in (m.get("video_info") or {}).get("variants") or [] if v.get("content_type") == "video/mp4"]
            mp4.sort(key=lambda v: v.get("bitrate") or 0)
            ok = [v for v in mp4 if (v.get("bitrate") or 0) <= 2_200_000] or mp4
            if ok:
                item["mp4"] = ok[-1]["url"]
        out.append(item)
    return out[:4]


def card(d):
    c = d.get("card")
    if not c:
        return None
    bv = c.get("binding_values") or {}
    val = lambda k: ((bv.get(k) or {}).get("string_value"))
    img = None
    for k in ("summary_photo_image_large", "thumbnail_image_large", "photo_image_full_size_large", "thumbnail_image"):
        iv = (bv.get(k) or {}).get("image_value")
        if iv:
            img = iv.get("url")
            break
    href = c.get("url")
    for e in (d.get("entities") or {}).get("urls") or []:
        if e.get("url") == href:
            href = e.get("expanded_url") or href
    title = val("title")
    if not title:
        return None
    return {"title": title, "domain": val("vanity_url") or val("domain"), "img": img, "href": href,
            "large": (c.get("name") or "").endswith("summary_large_image")}


def build(d):
    a = author(d["user"])
    p = {
        "id": d["id_str"],
        "url": f"https://x.com/{a['handle']}/status/{d['id_str']}",
        "author": a,
        "lang": d.get("lang"),
        "createdAt": d.get("created_at"),
        "rich": rich(d),
        "media": media(d),
        "replies": d.get("conversation_count") or 0,
        "likes": d.get("favorite_count") or 0,
    }
    if d.get("note_tweet"):
        p["more"] = True  # a long post: the embed data only carries the first part, X shows the rest
    cd = card(d)
    if cd and not p["media"]:
        p["card"] = cd
    q = d.get("quoted_tweet")
    if q and q.get("user"):
        qa = author(q["user"])
        p["quote"] = {"id": q["id_str"], "url": f"https://x.com/{qa['handle']}/status/{q['id_str']}", "author": qa,
                      "createdAt": q.get("created_at"), "rich": rich(q), "media": media(q)[:1]}
    return p


def load():
    if os.path.exists(FEED):
        with open(FEED, encoding="utf-8") as f:
            return json.load(f)
    return {"updatedAt": None, "posts": []}


def save(feed):
    feed["posts"].sort(key=lambda p: (p.get("addedOn") or "", p.get("createdAt") or ""), reverse=True)
    feed["posts"] = feed["posts"][:MAX_POSTS]
    feed["updatedAt"] = dt.datetime.now(KST).isoformat(timespec="seconds")
    with open(FEED, "w", encoding="utf-8", newline="\n") as f:
        f.write('{"updatedAt": ' + json.dumps(feed["updatedAt"]) + ', "posts": [\n')
        f.write(",\n".join(json.dumps(p, ensure_ascii=False, separators=(",", ":")) for p in feed["posts"]))
        f.write("\n]}\n")


def main(argv):
    feed = load()
    by_id = {p["id"]: p for p in feed["posts"]}
    today = dt.datetime.now(KST).date().isoformat()
    if argv[:1] == ["--refresh"]:
        for p in feed["posts"][:60]:
            try:
                d = fetch(p["id"])
                p["replies"], p["likes"] = d.get("conversation_count") or 0, d.get("favorite_count") or 0
            except Exception as e:  # noqa: BLE001
                print("건너뜀", p["id"], e)
            time.sleep(0.4)
        save(feed)
        print("숫자를 새로 받았어요.")
        return 0
    if len(argv) != 1:
        print(__doc__)
        return 2
    with open(argv[0], encoding="utf-8") as f:
        picks = json.load(f)
    added, updated, failed = 0, 0, []
    for pick in picks:
        try:
            pid = post_id(pick.get("url") or pick.get("id"))
            p = build(fetch(pid))
        except Exception as e:  # noqa: BLE001
            failed.append(f"{pick.get('url') or pick.get('id')}: {e}")
            continue
        topics = [t for t in pick.get("topics") or [] if t in TOPICS]
        old = by_id.get(p["id"])
        if old:
            old.update({k: p[k] for k in ("rich", "media", "replies", "likes", "author", "lang", "more", "card", "quote") if k in p})
            if topics:
                old["topics"] = topics
            if pick.get("ko"):
                old["ko"] = pick["ko"]
            updated += 1
        else:
            p.update({"topics": topics or ["tech"], "addedOn": pick.get("addedOn") or today, "following": bool(pick.get("following"))})
            if pick.get("ko"):
                p["ko"] = pick["ko"]
            feed["posts"].append(p)
            by_id[p["id"]] = p
            added += 1
        time.sleep(0.4)
    save(feed)
    print(f"새 글 {added}개, 갱신 {updated}개. 피드 전체 {len(feed['posts'])}개.")
    for f in failed:
        print("실패", f)
    return 1 if failed and not added and not updated else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
