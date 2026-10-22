# 30 round emblem concepts for 산시야 — "공상을 현실로 구현하는 기업".
# Each mark is drawn on a 100x100 grid for a round badge (disc r=50). C = mark colour, B = disc colour
# (used for knock-outs, so the mark reads as one solid shape on the disc).
import math, re

def P(*pts): return " ".join(f"{x:.2f} {y:.2f}" for x, y in pts)
def pol(cx, cy, r, a): t = math.radians(a); return (cx + r * math.cos(t), cy + r * math.sin(t))
def hexpath(cx, cy, r, rot=30):
    return "M" + " L".join(P(pol(cx, cy, r, rot + 60 * i)) for i in range(6)) + "Z"
def star4(cx, cy, r, k=0.22):
    return (f"M{cx} {cy-r} C{cx+r*k*.5} {cy-r*k} {cx+r*k} {cy-r*k*.5} {cx+r} {cy} C{cx+r*k} {cy+r*k*.5} {cx+r*k*.5} {cy+r*k} {cx} {cy+r} "
            f"C{cx-r*k*.5} {cy+r*k} {cx-r*k} {cy+r*k*.5} {cx-r} {cy} C{cx-r*k} {cy-r*k*.5} {cx-r*k*.5} {cy-r*k} {cx} {cy-r}Z")

def m01(C, B):  # Dawn Horizon
    return (f'<path d="M33 60 A17 17 0 0 1 67 60Z" fill="{C}"/><rect x="20" y="60" width="60" height="5.5" rx="2.75" fill="{C}"/>'
            f'<rect x="31" y="70.5" width="38" height="4.5" rx="2.25" fill="{C}"/><rect x="41" y="79.5" width="18" height="4" rx="2" fill="{C}"/>')
def m02(C, B):  # Half Real
    return (f'<path d="M50 23 A27 27 0 0 0 50 77" fill="none" stroke="{C}" stroke-width="5.5" stroke-linecap="round" stroke-dasharray="0.1 9.5"/>'
            f'<path d="M50 23 A27 27 0 0 1 50 77Z" fill="{C}"/>')
def m03(C, B):  # Peak breaking through the ring
    return (f'<circle cx="50" cy="53" r="26" fill="none" stroke="{C}" stroke-width="5"/>'
            f'<path d="M30 71 L50 15 L70 71Z" fill="{B}" stroke="{B}" stroke-width="7" stroke-linejoin="round"/><path d="M30 71 L50 15 L70 71Z" fill="{C}"/>')

def m04(C, B):  # Aperture
    out = []
    for i in range(6):
        t = 60 * i
        out.append(f'<path d="M{P(pol(50,50,9,t))} L{P(pol(50,50,9,t+60))} L{P(pol(50,50,31,t+105))} L{P(pol(50,50,31,t+45))}Z" fill="{C}" stroke="{B}" stroke-width="2.4" stroke-linejoin="round"/>')
    return f'<clipPath id="ap"><circle cx="50" cy="50" r="30"/></clipPath><g clip-path="url(#ap)">' + "".join(out) + "</g>"
def m05(C, B):  # Iso Cube
    a = pol(50, 50, 27, -90); b = pol(50, 50, 27, -30); c = pol(50, 50, 27, 30); d = pol(50, 50, 27, 90); e = pol(50, 50, 27, 150); f = pol(50, 50, 27, 210)
    return (f'<path d="M50 50 L{P(f)} L{P(e)} L{P(d)}Z" fill="{C}"/><path d="M50 50 L{P(b)} L{P(c)} L{P(d)}Z" fill="{C}" opacity=".7"/>'
            f'<path d="M{P(a)} L{P(b)} L50 50 L{P(f)}Z" fill="none" stroke="{C}" stroke-width="4.5" stroke-linejoin="round"/><circle cx="50" cy="36.5" r="4.5" fill="{C}"/>')
def m06(C, B):  # Orbit Cube
    cube = hexpath(50, 50, 15, 30)
    return (f'<path d="{cube}" fill="{C}"/><path d="M50 50 L{P(pol(50,50,15,-30))} M50 50 L{P(pol(50,50,15,210))} M50 50 L50 65" stroke="{B}" stroke-width="2.4"/>'
            f'<ellipse cx="50" cy="50" rx="34" ry="12" transform="rotate(-22 50 50)" fill="none" stroke="{B}" stroke-width="9"/>'
            f'<ellipse cx="50" cy="50" rx="34" ry="12" transform="rotate(-22 50 50)" fill="none" stroke="{C}" stroke-width="4"/><circle cx="{P(pol(50,50,1,0))[0:0]}81" cy="38" r="4.6" fill="{C}"/>')
def m07(C, B):  # Launch Spark
    return (f'<path d="M27 73 Q31 40 60 33" fill="none" stroke="{C}" stroke-width="6" stroke-linecap="round"/>'
            f'<path d="{star4(69, 31, 15, 0.2)}" fill="{C}"/><circle cx="27" cy="73" r="5.5" fill="{C}"/>')

def m08(C, B):  # Sprout
    return (f'<path d="M50 78 V48" stroke="{C}" stroke-width="5" stroke-linecap="round"/>'
            f'<path d="M50 56 C37 56 28 48 28 35 C41 35 50 43 50 56Z" fill="{C}"/><path d="M50 48 C50 33 59 23 74 23 C74 38 65 48 50 48Z" fill="{C}"/>'
            f'<rect x="34" y="76" width="32" height="5" rx="2.5" fill="{C}"/>')
def m09(C, B):  # Arch Window
    return (f'<path fill-rule="evenodd" fill="{C}" d="M30 74 V48 A20 20 0 0 1 70 48 V74Z M40 74 V49 A10 10 0 0 1 60 49 V74Z"/>'
            f'<circle cx="50" cy="58" r="5" fill="{C}"/><rect x="24" y="74" width="52" height="5" rx="2.5" fill="{C}"/>')
def m10(C, B):  # City in a circle
    return (f'<clipPath id="ap"><circle cx="50" cy="50" r="27"/></clipPath>'
            f'<path clip-path="url(#ap)" fill="{C}" d="M18 84 V62 H28 V54 H35 V60 H41 V40 L46 33 L51 40 V56 H57 V46 H64 V58 H70 V51 H82 V84Z"/>'
            f'<circle cx="50" cy="50" r="27" fill="none" stroke="{C}" stroke-width="4.5"/><circle cx="64" cy="34" r="4.4" fill="{C}"/>')

def m11(C, B):  # Pixel Moon
    sq = []
    s, g = 6.2, 1.4
    for i in range(-5, 6):
        for j in range(-5, 6):
            x, y = 50 + i * (s + g), 50 + j * (s + g)
            if (x - 50) ** 2 + (y - 50) ** 2 <= 27 ** 2 and (x - 61) ** 2 + (y - 43) ** 2 > 21 ** 2:
                sq.append(f'<rect x="{x - s/2:.2f}" y="{y - s/2:.2f}" width="{s}" height="{s}" rx="1" fill="{C}"/>')
    return "".join(sq) + f'<rect x="{66 - s/2}" y="{30 - s/2}" width="{s}" height="{s}" rx="1" fill="{C}" transform="rotate(45 66 30)"/>'
def m12(C, B):  # Contours
    return "".join(f'<circle cx="50" cy="{50 - 4 * i}" r="{30 - 8 * i}" fill="none" stroke="{C}" stroke-width="3.6"/>' for i in range(3)) + f'<circle cx="50" cy="38" r="5.5" fill="{C}"/>'
def m13(C, B):  # Star rising from a box
    t, r_, rb, b_, lb, l_ = (50, 46), (65.6, 55), (65.6, 73), (50, 82), (34.4, 73), (34.4, 55)
    c = (50, 64)
    return (f'<path d="M{P(l_)} L{P(c)} L{P(b_)} L{P(lb)}Z" fill="{C}"/><path d="M{P(c)} L{P(r_)} L{P(rb)} L{P(b_)}Z" fill="{C}" opacity=".72"/>'
            f'<path d="M{P(t)} L{P(r_)} L{P(c)} L{P(l_)}Z" fill="{C}" opacity=".35"/>'
            f'<path d="{star4(50, 29, 13, 0.2)}" fill="{C}"/><circle cx="66" cy="34" r="2.6" fill="{C}"/><circle cx="34" cy="38" r="2" fill="{C}"/>')

def m14(C, B):  # Grid Globe
    return (f'<circle cx="50" cy="50" r="28" fill="none" stroke="{C}" stroke-width="4.2"/><ellipse cx="50" cy="50" rx="12" ry="28" fill="none" stroke="{C}" stroke-width="3.6"/>'
            f'<path d="M23 50 H77 M27.5 36 H72.5 M27.5 64 H72.5" stroke="{C}" stroke-width="3.6"/>')
def m15(C, B):  # Neural Node
    pts = [pol(50, 50, 26, -90 + 60 * i) for i in range(6)]
    lines = "".join(f'<line x1="50" y1="50" x2="{x:.2f}" y2="{y:.2f}"/>' for x, y in pts) + "".join(f'<line x1="{pts[i][0]:.2f}" y1="{pts[i][1]:.2f}" x2="{pts[(i+1)%6][0]:.2f}" y2="{pts[(i+1)%6][1]:.2f}"/>' for i in (0, 2, 4))
    return f'<g stroke="{C}" stroke-width="3.4" stroke-linecap="round">{lines}</g><circle cx="50" cy="50" r="8.5" fill="{C}"/>' + "".join(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="5" fill="{C}"/>' for x, y in pts)
def m16(C, B):  # Dome
    return (f'<path d="M24 66 A26 26 0 0 1 76 66Z" fill="{C}"/>'
            f'<path d="M50 41 V66 M37.5 66 A12.5 25 0 0 1 62.5 66" fill="none" stroke="{B}" stroke-width="2.4"/>'
            f'<rect x="20" y="66" width="60" height="6" rx="1.5" fill="{C}"/><rect x="27" y="75" width="46" height="4.5" rx="1.5" fill="{C}"/>'
            f'<path d="M50 40 V31" stroke="{C}" stroke-width="3.2" stroke-linecap="round"/><circle cx="50" cy="28" r="3.4" fill="{C}"/>')

def m17(C, B):  # Stairs to Dot
    return f'<path d="M24 76 V66 H35 V56 H46 V46 H57 V36 H68 V76Z" fill="{C}"/><circle cx="74" cy="25" r="6.5" fill="{C}"/>'
def m18(C, B):  # Sieut monogram
    return (f'<path d="M52 22 L27 76" stroke="{C}" stroke-width="10" stroke-linecap="square"/><path d="M42.5 43 L73 76" stroke="{C}" stroke-width="10" stroke-linecap="square"/>'
            f'<circle cx="68" cy="30" r="5.5" fill="{C}"/>')
def m19(C, B):  # Hex Lattice
    cells = [(50, 50)] + [pol(50, 50, 16.6, -90 + 60 * i) for i in range(6)]
    return "".join(f'<path d="{hexpath(x, y, 9.2, 0)}" fill="{C if i == 0 else "none"}" stroke="{C}" stroke-width="3.2" stroke-linejoin="round"/>' for i, (x, y) in enumerate(cells))
def m20(C, B):  # Compass
    return (f'<path d="M50 28 L35 74 M50 28 L65 74" stroke="{C}" stroke-width="5.5" stroke-linecap="round"/><circle cx="50" cy="26" r="6" fill="{C}"/>'
            f'<path d="M27 64 Q50 80 73 64" fill="none" stroke="{C}" stroke-width="3.6" stroke-linecap="round"/><rect x="47.5" y="14" width="5" height="8" rx="2" fill="{C}"/>')
def m21(C, B):  # Door of Light
    return (f'<rect x="31" y="20" width="38" height="58" rx="3" fill="{C}"/><path d="M50 20 H56 L52 78 H50Z" fill="{B}"/>'
            f'<path d="M50 78 L52 78 L66 86 L36 86Z" fill="{C}" opacity=".6"/><circle cx="60" cy="50" r="2.6" fill="{B}"/>')
def m22(C, B):  # Dot Sphere
    out = []
    for i in range(-4, 5):
        for j in range(-4, 5):
            x, y = 50 + i * 6.4, 50 + j * 6.4
            d = math.hypot(x - 50, y - 50)
            if d > 28: continue
            shade = math.hypot(x - 41, y - 41) / 40
            r = max(0.7, min(3.0, 0.6 + 2.6 * shade))
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.2f}" fill="{C}"/>')
    return "".join(out)
def m23(C, B):  # Golden Spiral
    return (f'<path d="M50 50 m0 0 a3 3 0 0 1 3 3 a5 5 0 0 1 -5 5 a8 8 0 0 1 -8 -8 a13 13 0 0 1 13 -13 a21 21 0 0 1 21 21 a29 29 0 0 1 -29 29" '
            f'fill="none" stroke="{C}" stroke-width="6.5" stroke-linecap="round" transform="translate(50 50) scale(1.02) translate(-46 -54)"/>')

def m24(C, B):  # Perspective Room
    return (f'<rect x="26" y="26" width="48" height="48" rx="2" fill="none" stroke="{C}" stroke-width="4"/><rect x="41" y="41" width="18" height="18" fill="none" stroke="{C}" stroke-width="3.4"/>'
            f'<path d="M26 26 L41 41 M74 26 L59 41" stroke="{C}" stroke-width="3.4"/><path d="M26 74 L41 59 H59 L74 74Z" fill="{C}"/>')
def m25(C, B):  # Moon Block
    return (f'<path fill-rule="evenodd" fill="{C}" d="M50 23 A27 27 0 1 0 50 77 A27 27 0 1 0 50 23Z M60 27 A22 22 0 1 1 60 71 A22 22 0 1 1 60 27Z"/>'
            f'<rect x="51" y="41" width="18" height="18" rx="2" fill="{C}"/>')
def m26(C, B):  # Winding Path
    return (f'<path d="M36 80 C36 64 64 66 64 54 C64 44 40 46 40 36" fill="none" stroke="{C}" stroke-width="7" stroke-linecap="round"/>'
            f'<path d="M40 16 L52 30 H28Z" fill="{C}"/>')
def m27(C, B):  # Cloud to Block
    return (f'<path d="M30 52 A10 10 0 0 1 36 36 A13 13 0 0 1 60 32 A11 11 0 0 1 70 52" fill="none" stroke="{C}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<rect x="30" y="52" width="40" height="24" rx="2.5" fill="{C}"/><path d="M30 64 H70" stroke="{B}" stroke-width="2.2"/><path d="M50 52 V76" stroke="{B}" stroke-width="2.2"/>')
def m28(C, B):  # Point, Line, Plane
    return (f'<circle cx="32" cy="32" r="7.5" fill="{C}"/><path d="M43 43 L55 55" stroke="{C}" stroke-width="7.5" stroke-linecap="round"/>'
            f'<rect x="59" y="59" width="17" height="17" rx="2.5" fill="{C}"/>')

def m29(C, B):  # Idea Bulb
    return (f'<path d="M50 18 A20 20 0 0 1 62 54 V62 H38 V54 A20 20 0 0 1 50 18Z" fill="none" stroke="{C}" stroke-width="4.6" stroke-linejoin="round"/>'
            f'<path d="M41 50 L50 34 L59 50Z" fill="{C}"/><rect x="40" y="67" width="20" height="4.6" rx="2.3" fill="{C}"/><rect x="43" y="75" width="14" height="4.6" rx="2.3" fill="{C}"/>')
def m30(C, B):  # Ring S
    return (f'<path d="M64 33 A14 14 0 1 0 50 50 A14 14 0 1 1 36 67" fill="none" stroke="{C}" stroke-width="7.5" stroke-linecap="round"/>'
            f'<circle cx="64" cy="33" r="6" fill="{C}"/><circle cx="36" cy="67" r="6" fill="{C}"/>')

MARKS = [
  ("dawn", "새벽 지평선", "Dawn Horizon", m01, "지평선 위로 떠오르는 해. 상상이 처음 현실에 모습을 드러내는 새벽이에요."),
  ("half", "반쪽의 현실", "Half Real", m02, "왼쪽은 점선으로만 그린 상상, 오른쪽은 꽉 채운 현실. 그 사이를 잇는 일을 해요."),
  ("breakpeak", "돌파 봉우리", "Breakthrough Peak", m03, "둥근 틀을 뚫고 솟아오른 봉우리. 상상이 경계를 넘어 현실로 올라서요."),
  ("aperture", "조리개", "Aperture", m04, "카메라 조리개처럼 시야의 초점을 맞추는 정밀함. 디자인과 나노 공정의 감각이에요."),
  ("cube", "아이소 큐브", "Iso Cube", m05, "윗면에 점 하나가 놓인 정육면체. 한 점의 생각이 입체가 되는 3D 설계예요."),
  ("orbitcube", "오빗 큐브", "Orbit Cube", m06, "현실의 블록 주위를 도는 상상의 궤도와 위성 하나."),
  ("launch", "론치 스파크", "Launch Spark", m07, "땅에서 쏘아 올린 점이 곡선을 그리며 별이 돼요. 실행으로 빛나는 아이디어예요."),
  ("sprout", "새싹", "Sprout", m08, "땅에서 돋아난 두 잎. 작은 씨앗이 자라 조경과 도시의 숲이 돼요."),
  ("arch", "아치 창", "Arch Window", m09, "두꺼운 아치와 그 안에 뜬 해. 건축이 품는 빛이에요."),
  ("citycircle", "시티 서클", "City Circle", m10, "둥근 창 안에 들어선 도시와 그 위의 달. 꿈꾸던 도시가 세워진 풍경이에요."),
  ("pixelmoon", "픽셀 문", "Pixel Moon", m11, "게임 픽셀로 쌓은 초승달과 떠오르는 한 칸. 디지털로 빚는 꿈이에요."),
  ("contour", "등고선", "Contours", m12, "위로 갈수록 좁아지는 등고선. 땅을 읽고 높이를 계획하는 조경·도시설계예요."),
  ("starbox", "스타 박스", "Star Box", m13, "현실이라는 상자에서 별 하나가 떠올라요. 상상을 꺼내 손에 잡히게 만드는 일이에요."),
  ("globe", "그리드 글로브", "Grid Globe", m14, "위도·경도 격자로 감싼 구. 세계를 설계하는 도시계획과 3D예요."),
  ("neural", "뉴럴 노드", "Neural Node", m15, "가운데 생각에서 여섯 갈래로 뻗는 연결. AI가 아이디어를 잇는 모습이에요."),
  ("dome", "돔", "Dome", m16, "하늘을 품은 둥근 지붕. 사람을 모으는 건축과 공간의 상징이에요."),
  ("stairs", "꿈의 계단", "Stairs to Dot", m17, "한 칸씩 오르는 계단 끝에 떠 있는 점. 공상에 닿는 실행의 단계예요."),
  ("sieut", "ㅅ 모노그램", "Sieut", m18, "산·시야의 첫 자음 ㅅ을 봉우리처럼 세우고 점 하나를 더했어요."),
  ("hexlattice", "헥스 래티스", "Hex Lattice", m19, "나노 소재의 육각 격자 일곱 칸, 가운데가 채워진 핵심."),
  ("compass", "제도 컴퍼스", "Compass", m20, "선을 긋는 제도용 컴퍼스. 모든 건축과 디자인은 그리는 데서 시작돼요."),
  ("door", "빛의 문", "Door of Light", m21, "살짝 열린 문틈으로 빛이 쏟아져요. 상상의 방에서 현실로 나오는 문이에요."),
  ("dotsphere", "도트 스피어", "Dot Sphere", m22, "작은 점이 모여 빛과 그림자가 있는 구가 돼요. 입자에서 입체로, 나노에서 3D로."),
  ("spiral", "황금 나선", "Golden Spiral", m23, "자연과 디자인에 숨은 비율. 안에서 바깥으로 커져 가는 성장이에요."),
  ("room", "원근의 방", "Perspective Room", m24, "한 점으로 모이는 원근의 방. 인테리어와 공간디자인의 시점이에요."),
  ("moonblock", "초승달 블록", "Moon Block", m25, "꿈을 뜻하는 초승달이 현실의 블록 하나를 품고 있어요."),
  ("path", "굽은 길", "Winding Path", m26, "구불구불한 길 끝의 정상. 산시야의 S이자 공상에서 현실까지의 여정이에요."),
  ("cloud", "구름 블록", "Cloud to Block", m27, "위는 구름 같은 공상, 아래는 벽돌처럼 쌓인 현실. 아래로 내려오며 단단해져요."),
  ("pointplane", "점·선·면", "Point Line Plane", m28, "점(생각)이 선(계획)을 지나 면(현실)이 돼요. 디자인의 가장 기본 문법이에요."),
  ("bulb", "아이디어 전구", "Idea Bulb", m29, "전구 안에 들어 있는 산. 번뜩인 생각이 건축이 돼요."),
  ("rings", "링 S", "Ring S", m30, "두 개의 반원이 이어진 S. 끊기지 않고 이어지는 상상과 현실이에요."),
]

ORANGE, INK, CREAM = "#FFB343", "#2B2013", "#FFF9EF"

def badge(i, size, bg=ORANGE, fg=INK, uid=""):
    key, name, en, fn, idea = MARKS[i]
    body = fn(fg, bg).replace('id="ap"', f'id="ap{uid}"').replace("url(#ap)", f"url(#ap{uid})")
    return (f'<svg viewBox="0 0 100 100" width="{size}" height="{size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{name}">'
            f'<circle cx="50" cy="50" r="50" fill="{bg}"/>{body}</svg>')

if __name__ == "__main__":
    import sys
    out = sys.argv[1]
    cards = []
    for i, (key, name, en, fn, idea) in enumerate(MARKS):
        cards.append(f'<div class="c"><div class="n">{i+1:02d} {name}</div>{badge(i, 128, uid=f"a{i}")}<div class="row">{badge(i, 40, uid=f"b{i}")}{badge(i, 24, uid=f"c{i}")}{badge(i, 16, uid=f"d{i}")}{badge(i, 40, bg=INK, fg=ORANGE, uid=f"e{i}")}</div></div>')
    html = f'''<!doctype html><meta charset="utf-8"><style>body{{margin:0;background:{CREAM};font-family:sans-serif;padding:16px}}
.g{{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}}.c{{background:#fff;border-radius:14px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px}}
.n{{font-weight:700;font-size:13px;color:{INK};align-self:flex-start}}.row{{display:flex;align-items:center;gap:8px}}</style><div class="g">{"".join(cards)}</div>'''
    open(out, "w").write(html); print("ok", len(MARKS))
