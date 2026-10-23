# 산시야 — Claude 작업 안내

이 파일은 Claude가 이 저장소에서 일을 시작할 때 먼저 읽는 안내서예요. 지금까지 대화로 쌓인 규칙과 진행 상황을 정리했어요.
**이 저장소는 공개(public)예요. 여기에 비밀번호·키·토큰 같은 비밀은 절대 적지 마세요.**

## 사용자와 일하는 방식

- 사용자는 한국어로 말해요. 답도 한국어 해요체로 짧고 친절하게 해 주세요. 개발 용어는 쉬운 말로 풀어 주세요.
- 사용자는 주로 스크린샷을 보내고, 화면 속 이름(아카이브, 주식, 비트코인, 사진, 북마크, "+ 새 기록" 등)으로 위치를 말해요.
- "만들어 줘"라는 요청은 **실제 사이트에 배포하고 확인하는 것까지**가 한 번의 작업이에요. 끝나면 버전 번호와 바뀐 점을 몇 줄로 알려 주세요.
- 화면 요청은 폰(360~430px)과 PC 둘 다, 라이트·다크 모드 둘 다 맞춰 주세요.

## 프로젝트 한눈에

- 개인 아카이브 PWA. 빌드 도구 없는 순수 HTML/CSS/JS예요. 파일을 고치면 그대로 배포돼요.
- 실제 주소: https://sansiya503.github.io/sansiya/ (GitHub Pages, `main` 브랜치 루트를 그대로 서비스)
- 저장: Supabase(로그인·Postgres·Storage) + 기기 안 IndexedDB 캐시 + 오프라인 대기열(outbox). `?demo`를 붙이면 서버 없이 기기에만 저장하는 모드로 열려요.
- 메뉴: 아카이브 · 통계 · 회고 · 주식 · 비트코인 · 사진 · SNS · 북마크 (`app.js`의 `VIEWS`)

| 파일 | 하는 일 |
|---|---|
| `index.html` | 화면 뼈대 (헤더: 로고, 검색, 동기화, 설정, + 새 기록, 서울 시계 / 메뉴줄) |
| `styles.css` | 디자인 전부. 색은 맨 위 CSS 변수(토큰)로 관리 |
| `app.js` | 기능 전부 (하나의 IIFE, 약 3,600줄) |
| `sw.js` | 오프라인 캐시·업데이트. `VERSION` 상수 |
| `config.js` | Supabase 주소와 공개해도 되는 publishable 키 |
| `setup.sql`, `supabase/*.sql` | DB 테이블·보안(RLS). 모두 적용 완료 |
| `supabase/functions/quotes/index.ts` | Edge Function `quotes` (배포 완료) |
| `toss-sync/` | 사용자 PC(Windows)에서 도는 토스증권 보유 종목 동기화 도구 |
| `sns/feed.json` | SNS 메뉴에 보이는 X 소식 목록 (앱이 매번 새로 받아요. 공개 저장소라 누구나 볼 수 있어요) |
| `sns/add.py` | X 글 주소 목록(picks.json)을 받아 `feed.json`에 넣는 도구. 사용법은 파일 맨 위 설명 |
| `tests/` | 브라우저 자동 테스트 (Playwright) |

### app.js 지도 (섹션 주석 `/* ---------- 이름 ---------- */` 으로 찾기)

utils → IndexedDB KV → backends(`TABLES`: DB 행 ↔ 앱 객체 변환) → state(`S`) → sync(pull/flush, outbox) → photo URLs → filtering → render: chrome / views(아카이브·통계) → stocks(helpers, quotes, Toss link, market strip, allocation 도넛, main, detail, search/form, dividend) → overlays(편집기·설정 등, 안드로이드 뒤로가기 지원) → gate(설정·로그인) → photo album(`PH_*`, 100장씩 무한 스크롤, 주제 칩) → bookmarks(링크 + 앱 안 즐겨찾기) → SNS(`SNS_*`, X처럼 생긴 피드, `sns/feed.json`을 읽어요) → bitcoin(`BT_*`, 실시간 시세·블록·환산·김치 프리미엄) → events(클릭/키보드, 헤더 시계 `tickClock`) → service worker → boot.

- 화면은 `render()`가 문자열 HTML로 다시 그려요. 자주 바뀌는 숫자(비트코인 등)는 제자리 갱신 함수(`btPaintLive` 등)가 따로 있어요.
- 테이블이 아직 없을 때도 앱이 죽지 않게 `missingTable()`로 넘어가요. 새 테이블을 쓸 때도 같은 방식으로 해 주세요.
- 브라우저 저장소 키: `sansiya-mode`, `sansiya-config`, `sansiya-prefs`, `sansiya-theme`, `sansiya-btc`. KV: `local:*`, `btc-snap`, `logos-v`.

## 배포 순서 (매번 이대로)

1. 파일을 고쳐요.
2. **버전 두 곳을 같이 올려요.** `app.js` 8번째 줄 `APP_VERSION`과 `sw.js` 3번째 줄 `VERSION`(`sansiya-v…`). 작은 변경은 마지막 숫자 +1. 지금은 **1.13.0**이에요.
   - `CLAUDE.md`, `tests/`, `design/`, `sns/`처럼 앱 코드가 아닌 파일만 바꿀 때는 버전을 올리지 않아요. (`sns/feed.json`은 서비스 워커가 캐시하지 않아서 올리면 바로 보여요.)
3. 관련 테스트를 돌려요 (아래 "테스트").
4. 커밋해요. 메시지는 `vX.Y.Z: 한국어 한 줄 요약`. 작성자는 `Sansiya503 <sansiya503@users.noreply.github.com>`.
5. `main`에 push하면 1분 안팎으로 GitHub Pages에 올라가요.
6. **실제 사이트에서 확인해요.** 브라우저 창에서 사이트를 열고 콘솔/JS로:
   - `await (await navigator.serviceWorker.getRegistration()).update()` 후 `await caches.keys()`에 `sansiya-vX.Y.Z`가 있는지 봐요.
   - 페이지를 새로고침한 뒤 바뀐 부분을 DOM으로 확인해요.
   - 주의: 서비스 워커가 쿼리스트링을 무시하고 캐시본을 돌려줘서, 페이지 안에서 `sw.js`/`app.js`를 그냥 fetch하면 옛 버전이 보여요. `{cache:"no-store"}`로 받거나 위 방법을 쓰세요.

## 디자인 규칙

- 색 토큰(`styles.css` 맨 위): 배경 `#FFF9EF`, 글자 `#2B2013` / `#6B5A44` / `#857560`, 선 `#F1E4CC`, 주황 `--accent #FFB343`, 강조 글자 `#8A5300`, 칩 `#FBF0DD`/`#6E4200`. 메뉴 아이콘 색: 아카이브 `#3D7BFA`, 사진 `#20B46B`, 북마크 `#E5468E` 등 (`VIEW_ICONS`).
- **다크 모드는 토큰을 세 곳에 정의해요**: `:root`, `@media (prefers-color-scheme: dark){:root:not([data-theme="light"])…}`, `:root[data-theme="dark"]`. 새 색 토큰을 만들면 세 곳 모두에 넣어 주세요.
- 글꼴: 제목 Hahmlet(`--f-display`), 본문 IBM Plex Sans KR(`--f-body`), 숫자 IBM Plex Mono(`--f-mono`).
- 반응형 기준: 860px(검색창이 둘째 줄로), 600px, 560px(폰). 360px 폭에서도 옆으로 스크롤이 생기면 안 돼요.
- 화면 글자는 한국어로 써요 (사용자가 영어를 한글로 바꿔 달라고 한 적 있어요).
- 메뉴 이름 왼쪽의 둥근 아이콘, 사진 갤러리(정사각형 6칸 + 무한 스크롤, 조회수 없음), 주제 칩(All·여행·음식·디자인·건축·조경·인테리어), 헤더 시계(서울 시간, `08:05` + 파란 작은 `a.m`, 아래 `2026-10-23 (금)`)는 사용자가 정한 모양이니 그대로 유지해요.

## 데이터와 Supabase

- 프로젝트 ref `inaloiiabxzhdiivfkoj` (서울, 무료 플랜). 7일 동안 거의 안 쓰면 일시정지돼요 → 대시보드에서 Resume.
- 테이블(모두 RLS "본인 행만"): `entries`, `settings`(setup.sql) · `stocks`, `dividends`(stocks.sql) · `broker_links` + `broker_sync()` 함수(broker.sql) · `photos`(topics 배열 포함), `bookmarks`(album.sql). 사진 파일은 Storage.
- DB를 바꿀 때: `supabase/` 아래에 `if not exists`로 다시 실행해도 안전한 SQL 파일을 만들고, 대시보드 SQL 편집기(https://supabase.com/dashboard/project/inaloiiabxzhdiivfkoj/sql/new)에서 실행해요. 로그인은 사용자가 직접 해요.
  - 편집기 요령: 새 쿼리 URL이 `/sql/<uuid>`로 바뀔 때까지(2~3초) 기다린 뒤 `monaco.editor.getEditors()[0].setValue(sql)` → Run → 확인 창 승인. 결과는 `[role=gridcell]`로 확인.
- Edge Function `quotes`의 기능: `quotes`(시세·환율), `search`(종목 검색), `history`(차트), `mempool`(비트코인 블록, 25초 캐시), `linkmeta`(북마크 링크 제목, SSRF 차단, 1시간 캐시).
  - 배포: 대시보드 `/functions/quotes/code` 편집기에 커밋된 파일 내용을 넣고 **Deploy updates** → 확인. 버튼이 안내 팝업에 가려지면 JS로 `.click()`. "Successfully updated edge function"이 뜨면 성공.
  - 또는 Supabase CLI `supabase functions deploy quotes` (CLI 로그인은 사용자가 직접).

## 토스증권 연동 (`toss-sync/`)

- 사용자 PC에서 30분마다 토스증권 보유 종목·수량·평균 단가를 **읽기만** 해서 `broker_sync()`로 올려요. 주문은 절대 하지 않아요.
- 토스 키는 사용자 PC에 Windows DPAPI로 암호화해 `%LOCALAPPDATA%\Sansiya\TossSync`에만 있어요. 저장소·서버·대화로 옮기지 마세요.
- 스크립트를 고치면 `toss-sync/sansiya-toss-sync.zip`도 다시 만들어야 해요 (zip 안 폴더 `sansiya-toss-sync/`에 README.txt, *.cmd, *.ps1, run-hidden.vbs). 앱 설정 화면이 이 zip을 내려받게 해요(`TOSS_KIT`).

## 테스트

```bash
pip install playwright        # Chromium이 없으면: python -m playwright install chromium
bash tests/run_e2e.sh                     # 전부 (몇 분 걸려요)
bash tests/run_e2e.sh e2e_menubar e2e_topics   # 일부만
```

- 저장소를 `localhost:8768`에서 띄우고 Supabase 라이브러리를 가짜(mock)로 바꿔 끼워 돌려요. 실제 서버·계정에는 접속하지 않아요. 가짜 DB는 `sessionStorage.mockdb`.
- 가짜 Supabase 본체는 `tests/e2e/e2e_stocks.py`의 `MOCK = r"""…"""`이고, 다른 테스트들이 이걸 가져다 고쳐 써요.
- 알려진 실패 1건: `e2e_stocks`의 "sort by return puts Apple first" (예전부터 있던 것, 무시해도 돼요).
- 새 기능을 만들면 `tests/e2e/e2e_<기능>.py`를 같은 방식으로 추가해 주세요. 스크린샷은 `tests/out/shots/`(git 제외).

## 꼭 지킬 것 (보안)

- 비밀번호, API 키, 토스 client_id/secret, 연결 코드, Supabase 토큰은 **절대 대신 입력하지 않아요.** 필요하면 사용자에게 직접 넣어 달라고 해요.
- 매수·매도 등 거래 실행 금지. 투자 조언도 하지 않아요.
- 공개 저장소이므로 비밀 정보는 커밋하지 않아요 (`config.js`의 publishable 키는 공개용이라 괜찮아요).
- 사용자 이메일을 다른 서비스로 보내지 않아요.
- 다른 브랜드 로고를 베끼지 않아요.
- 실제 데이터를 지우는 작업은 먼저 사용자에게 확인받아요.

## 진행 중인 일

**새 로고(엠블럼) — 보류 (2026-10-23)**

- 지금까지 만든 시안(사각형 10개, 원형 30개)은 사용자가 모두 마음에 안 든다고 해서 완전히 지웠어요. 다시 쓰지 않아요. 새 로고는 나중에 처음부터 다시 상의해요. 그때까지 지금 로고(주황 원 로고)는 그대로 둬요.
- 로고가 상징할 것: "공상을 현실로 구현하는 기업"(건축·조경·인테리어·디자인·공간디자인·도시설계/계획·AI·게임·3D 디자인·나노기술).
- 새 로고가 확정되면 앱 전체에 적용해요 →
  `index.html`의 `.brand` 안 svg, `app.js`의 `MARK` 상수, `favicon.svg`, `icon-192.png`, `icon-512.png`, `maskable-512.png`(안전 영역 여백), `apple-touch-icon.png`, 필요하면 `manifest.webmanifest`. 그리고 버전 올려 배포.

**SNS 소식 매일 올리기 — 준비 중 (2026-10-23)**

- 사용자 요청: X에서 매일 5개 이상, 관심 분야(AI, 과학, 기술 발전, 언리얼 엔진, 게임 개발, 게임 그래픽) 소식을 SNS 메뉴에 올려요. 사용자가 팔로우한 AI 인물들 소식도 참고해요. 화면은 X와 최대한 비슷하게 해요.
- 방법: Claude 앱 브라우저에 로그인된 X에서 글을 고르고 → `picks.json`(주소, topics, 한국어 번역 `ko`, 팔로우 여부)을 만들고 → `python sns/add.py picks.json` → `sns/feed.json`을 커밋·push해요.
- X 로그인은 사용자가 Claude 앱 브라우저(Ctrl+Shift+B)에서 직접 해요. 매일 자동 실행은 Claude 앱 예약 작업으로 걸 예정이에요(앱이 켜져 있어야 돌아요).

## 최근 변경

- v1.13.0 SNS 메뉴(사진과 북마크 사이, 검은 원 + 흰 말풍선 아이콘), X 스타일 피드(주제 탭, 번역 보기, 사진 1~4장·동영상·링크 카드·인용 글, 북마크 저장), 폰 메뉴는 이름 길이만큼 폭을 나눠 가져요. 테스트 실행기는 UTF-8로 읽어요(Windows).
- v1.12.6 헤더 시계의 a.m/p.m을 2/3 크기·파란색(`--ampm`)으로
- v1.12.5 "+ 새 기록" 오른쪽에 서울 시간 시계 (12시간제, 날짜·요일)
- v1.12.4 왼쪽 위는 주황 로고 + "산시야"만
- v1.12.0~1.12.3 사진(인스타 탐색 스타일 갤러리, 주제 칩, 100장씩)·북마크 메뉴
- v1.11.x 비트코인 메뉴(only-btc.app 참고, 한국어화), 메뉴 아이콘
- v1.10.x 주식 자산 구성 도넛+리스트, 메뉴를 헤더 선 아래로
