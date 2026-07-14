# SEAGNAL (바다날씨)

해양 기상특보·해양종합정보·해양생활·공지를 제공하는 하이브리드 모바일 앱(Capacitor + 웹).
하단 4개 메인탭: **특보 및 전망 · 해양종합정보 · 해양생활 · 공지사항**.

## 어디를 보면 되나요

| 하고 싶은 것 | 볼 문서 |
|--------------|---------|
| 🗺️ **구조가 궁금하다** — 폴더가 어떻게 짜여 있고 각 파일이 뭘 하는지 | **[ARCHITECTURE.md](ARCHITECTURE.md)** (설계도면) |
| 🛠️ **코드를 추가·수정하려 한다** | **[DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md)** (개발지침) — 작업 전 필독 |
| 📐 왜 이렇게 정리했나 (리팩토링 배경) | [00_docs/REFACTORING_PROPOSAL_STRUCTURE.md](00_docs/REFACTORING_PROPOSAL_STRUCTURE.md) |

## 빠른 실행

```bash
npm install --legacy-peer-deps       # 의존성 설치
node local_server/server.js          # 서버 기동 (http://localhost:3001)
bash scripts/refactor/verify_all.sh  # 구조 검증 (경로·로드순서·시뮬레이션)
```

## 폴더 한눈에

```
client/          🌐 프론트엔드 (정적 서빙 루트)
├── js/          기능별 폴더 — core/ shared/ + 탭 4개(forecast·ocean-map·marine-life·notice) + 횡단 기능
├── index2.html  단일 페이지 셸          sw.js  서비스워커
└── assets/ images/ tide_data/ css 등 브라우저 자산 전부
local_server/    ⚙️ 서버 전용 (Node — 더 이상 정적 서빙되지 않음)
├── routes/      서버 API 라우트        services/  서버 서비스
├── advisory/    특보 예측 엔진          data/  런타임 데이터(Fly 볼륨)
android/         Capacitor 안드로이드 네이티브 셸
secrets/         서비스 계정 키 (git 미추적)
scripts/refactor/  리팩토링 검증·생성 도구
docs/ · 00_docs/   문서
```

> 서비스 계정 키는 `secrets/` 에 두며 git 에 올리지 않습니다. 새 환경에서는 수동 배치 필요.
