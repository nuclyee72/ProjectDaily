# ProjectDaily — 데일리 퍼즐

하루 한 판 퍼즐 세 개를 한 사이트에서.

- **메인(허브):** https://nuclyee72.github.io/ProjectDaily/ — 게임 카드를 좌우로 넘긴다
- **게임:** `/ProjectDaily/DailySudoku/` · `/ProjectDaily/DailyTrilateral/` · `/ProjectDaily/DailyWordship/`

## 구조

```
ProjectDaily/                  ← 이 레포 (허브)
├─ index.html                  ← 메인 화면. 카드 안에서 지난 퍼즐 · 자유 연습 모드 · 통계까지
├─ scripts/assemble-site.mjs   ← 허브 + 세 게임을 배포용 사이트 하나로 조립
├─ tests/                      ← 브라우저 자동 테스트 (Playwright)
├─ .github/workflows/pages.yml ← 배포
├─ DailySudoku/                ← 서브모듈 → nuclyee72/DailySudoku
├─ DailyTrilateral/            ← 서브모듈 → nuclyee72/DailyTrilateral
└─ DailyWordship/              ← 서브모듈 → nuclyee72/DailyWordship
```

게임 코드와 매일 퍼즐 생성(cron)은 각 게임 레포에 그대로 있다. 이 레포는 허브 페이지와 배포만 맡는다.

## 허브 ↔ 게임 연결

게임마다 `src/hub.js`(세 게임 공통 파일)와 `src/hubApi.js`가 있다.

| 허브에서 | 게임 주소 | 게임이 하는 일 |
|---|---|---|
| 오늘의 퍼즐 카드 · 스도쿠 자유 연습 | `?open=<랜딩 버튼 id>` | 그 버튼을 대신 눌러 바로 시작 |
| 지난 퍼즐 → 날짜 · 모드 → 플레이 | `?archive=YYYY-MM-DD&mode=<모드>` | 그 퍼즐로 바로 시작 |
| 자유 연습 → 모드 (삼각관계 · 워드십) | `?free=<모드>` | 그 모드로 바로 시작 |
| 통계 | (이동 없음) | 허브가 `src/hubApi.js`를 불러 게임 통계창과 같은 계산으로 표시 |

- 허브에서 들어온 탭에서는 게임의 "메인 화면" · 지난 퍼즐 "뒤로" · 자유 연습 모드 취소가 허브로 돌아간다. 이때 방문 기록을 쌓지 않아서, 휴대폰 "뒤로"가 방금 나온 게임으로 되돌아가지 않는다.
- 게임 주소로 직접 들어오면 스도쿠·삼각관계는 예전처럼 게임 자체 랜딩을 쓴다(왼쪽 위 "‹ 뒤로"는 허브로).
  워드십은 메인 화면이 허브 카드 하나 — 게임 주소로 바로 오면(허브의 `?open`·`?archive`·`?free` 없이) 허브 `#wordship`으로 보낸다. 게임 자체 랜딩은 로컬 개발(`npm run dev`)에서만.
- 워드십 익스텐디드 카드 설명은 그날의 기믹 이름 (`hubApi.dailyDesc`).
- 다크 모드는 허브·세 게임이 같이 쓴다. 어디서 바꾸든 전부 같이 바뀐다 (`hub.js`의 `saveDarkMode`).
- 플레이 기록(localStorage)은 도메인 단위라, 게임 레포의 예전 주소(`/DailySudoku/` 등)와 새 주소가 같이 쓴다.

## 배포

`pages.yml`이 배포 때마다 서브모듈을 각 게임 레포 `main` 최신으로 받아 조립한다. 그래서 이 레포에 기록된 서브모듈 커밋이 오래돼도 사이트는 항상 최신이다.

배포가 도는 때:
- **이 레포에 push**
- **게임 레포 배포 직후 (즉시)** — 게임 레포의 `pages.yml` 끝 `notify-hub` 단계가 이 레포의 배포를 실행한다. 코드 push와 매일 퍼즐 커밋 둘 다.
- **6시간마다** — 위가 실패해도 따라잡는 예비용
- **수동:** `gh workflow run "Deploy Pages" -R nuclyee72/ProjectDaily`

### 즉시 반영용 토큰 (`HUB_DEPLOY_TOKEN`)

게임 레포가 다른 레포(이 레포)의 워크플로를 실행하려면 토큰이 필요하다. 세 게임 레포에 시크릿 `HUB_DEPLOY_TOKEN`으로 들어 있다.

- 종류: fine-grained PAT · 저장소 `nuclyee72/ProjectDaily` 하나 · 권한 **Actions: Read and write**
- 만료되면: 게임 배포 로그에 경고가 뜨고 허브는 6시간마다만 반영된다. 새로 만들어 세 레포에 다시 넣는다:
  - 발급: https://github.com/settings/personal-access-tokens/new
  - 등록: 각 게임 레포 Settings → Secrets and variables → Actions → `HUB_DEPLOY_TOKEN`

## 로컬 작업

```bash
git clone --recurse-submodules https://github.com/nuclyee72/ProjectDaily.git
cd ProjectDaily
npm install          # 테스트용 Playwright
npm run build        # _site/ 에 배포와 같은 사이트 조립
npm test             # 조립 → /ProjectDaily/ 경로로 로컬 서빙 → 브라우저 테스트
```

게임 코드는 각 게임 폴더(= 게임 레포)에서 고치고 그 레포에 커밋·push한다. 허브는 자동으로 다시 배포된다.

실제 사이트를 테스트하려면: `BASE=https://nuclyee72.github.io/ProjectDaily/ npm test`

### 테스트가 확인하는 것

- `hub.test.cjs` — 스와이프 · 딥링크 · 지난 퍼즐(카드 안) → 게임 · "메인 화면" → 허브 · 뒤로가기 · 다크 모드 공유 · 직접 접속 · 아침 6시 날짜 갱신
- `stats.test.cjs` — 허브 통계가 게임 통계창과 같은지 (숫자 · 분포 · 달력 공유 문구 · 오늘 결과 공유 문구), 자유 연습 모드 고르기
- `layout.test.cjs` — 메인·모든 하위 화면이 320×480 ~ 1280×720에서 카드 폭 그대로 · 스크롤 없이 들어가는지 (6줄 달 기준)
