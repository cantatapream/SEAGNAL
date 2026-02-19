# SEAGNAL 리팩토링 종합 현황

> 최종 업데이트: 2026-02-19 (KST)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 프로젝트 | SEAGNAL (바다날씨) |
| 프로덕션 | seagnal-server.fly.dev (변경 없음) |
| 스테이징 | seagnal-staging.fly.dev (리팩토링/테스트) |
| 리팩토링 목표 | 모놀리식 코드를 기능별 모듈로 분할 (기존 기능 100% 유지) |

---

## 2. 진행 현황 요약

| Phase | 내용 | 상태 |
|-------|------|------|
| Phase 1 | 스테이징 인프라 구축 | ✅ 완료 |
| Phase 2 | 문서화 기반 설정 | ✅ 완료 |
| Phase 3 | 서버 리팩토링 (server.js) | ✅ 완료 |
| Phase 4 | 프론트엔드 리팩토링 (app.js) | ✅ 완료 |
| Phase 5 | 최종 검증 및 프로덕션 전환 | ⬜ 대기 (사용자 검증 필요) |

---

## 3. Phase 1: 스테이징 인프라 구축 ✅

| Step | 내용 | 상태 |
|------|------|------|
| 1.1 | flyctl 확인/설치 | ⬜ 사용자 직접 실행 필요 |
| 1.2 | fly.staging.toml 생성 | ✅ 완료 |
| 1.3 | Fly.io 앱/볼륨 생성 | ⬜ 사용자 직접 실행 필요 |
| 1.4 | 환경변수 설정 | ⬜ 사용자 직접 실행 필요 |
| 1.5 | GitHub Actions 스테이징 워크플로우 | ✅ 완료 |
| 1.6 | Git 브랜치 전략 수립 | ✅ 완료 |

---

## 4. Phase 2: 문서화 기반 설정 ✅

| Step | 내용 | 상태 |
|------|------|------|
| 2.1 | REFACTORING_STATUS.md 생성 | ✅ 완료 |
| 2.2 | REFACTORING_LOG.md 생성 | ✅ 완료 |

---

## 5. Phase 3: 서버 리팩토링 ✅ (server.js 2,758줄 → server_new.js 83줄 + 모듈)

### 생성된 서버 모듈
```
local_server/
├── server_new.js                   ← 새 진입점 (83줄)           ✅
├── config/
│   └── server_config.js            ← Express 설정, 경로, 환경변수 ✅
├── services/
│   ├── cache_manager.js            ← 데이터 캐시 관리             ✅
│   ├── upload_manager.js           ← Cloudinary/로컬 업로드 설정   ✅
│   └── push_helpers.js             ← 푸시 구역매칭/메시지생성      ✅
├── routes/
│   ├── health.js                   ← GET /, /api/health           ✅
│   ├── weather.js                  ← 특보/전망/부이/설정 API       ✅
│   ├── tide.js                     ← 조석 데이터/TideBED API      ✅
│   ├── content.js                  ← 공지/홍보/이미지 업로드 API    ✅
│   ├── stats.js                    ← 방문자 통계 API               ✅
│   ├── archive.js                  ← 아카이브 다운로드 API          ✅
│   ├── push.js                     ← 푸시 구독/발송/이력 API       ✅
│   ├── push_test.js                ← 푸시 테스트 시나리오 API       ✅
│   └── admin.js                    ← 관리자(크롤링/수집/수동특보) API ✅
└── server.js                       ← 기존 원본 (2,758줄, 보존)
```

---

## 6. Phase 4: 프론트엔드 리팩토링 ✅ (app.js 12,077줄 → 15개 모듈)

### 생성된 프론트엔드 모듈
```
local_server/
├── index_staging.html               ← 15개 모듈 로딩 버전          ✅
├── js/
│   ├── config.js          (491줄)   ← CONFIG, 해역상수, Windy매핑   ✅
│   ├── mappings.js        (369줄)   ← 연안매핑, 부이매핑, 부이타입    ✅
│   ├── utils.js           (210줄)   ← appState, 유틸함수             ✅
│   ├── data.js            (565줄)   ← fetchAllData, fetchBuoyData    ✅
│   ├── render.js          (983줄)   ← renderApp, createAlertElement  ✅
│   ├── render_coastal.js  (583줄)   ← 연안 렌더링, 부이표시           ✅
│   ├── marine.js          (916줄)   ← 해구별 전망 모달, 차트          ✅
│   ├── settings.js        (969줄)   ← 탭, 설정, 알림, 위치검색       ✅
│   ├── forecast.js        (864줄)   ← 해상예보 테이블, 정보팝업       ✅
│   ├── windy.js           (774줄)   ← Windy 팝업, 상태카드           ✅
│   ├── admin_trigger.js   (549줄)   ← 관리자 트리거, 공지팝업         ✅
│   ├── promo.js           (960줄)   ← 홍보 게시판                    ✅
│   ├── admin.js          (1034줄)   ← 통합 관리자 시스템              ✅
│   ├── admin_collect.js  (1724줄)   ← 수집 테스트, 방문자 통계        ✅
│   └── history.js        (1347줄)   ← 특보 이력, 마무리 유틸          ✅
├── app.js                           ← 기존 원본 (12,077줄, 보존)
└── index.html                       ← 기존 원본 (보존)
```

### 모듈 로딩 순서 (index_staging.html)
1. `js/config.js` → 2. `js/mappings.js` → 3. `js/utils.js` → 4. `js/data.js`
→ 5. `js/render.js` → 6. `js/render_coastal.js` → 7. `js/marine.js`
→ 8. `js/settings.js` → 9. `js/forecast.js` → 10. `js/windy.js`
→ 11. `js/admin_trigger.js` → 12. `js/promo.js` → 13. `js/admin.js`
→ 14. `js/admin_collect.js` → 15. `js/history.js`

---

## 7. Phase 5: 최종 검증 및 프로덕션 전환 (대기)

### 5.1 사용자 확인 필요 사항
- [ ] `node server_new.js`로 서버 시작 → 정상 기동 확인
- [ ] `/index_staging.html`로 접속 → 전체 기능 동작 확인
- [ ] 원본 `/index.html` → 기존 app.js로 여전히 정상 동작 확인

### 5.2 프로덕션 전환 단계
- [ ] `server_new.js` → `server.js` 교체 (원본 백업)
- [ ] `index_staging.html` → `index.html` 교체 (원본 백업)
- [ ] 스테이징 배포 및 테스트
- [ ] staging → main PR 생성 및 머지

---

## 핵심 원칙 (리마인더)

1. **원본 보존**: server.js, app.js, index.html 원본은 모두 그대로 유지됨
2. **기능 100% 유지**: 코드 위치만 이동, 로직 변경 없음
3. **안전한 전환**: 새 파일(server_new.js, index_staging.html)로 먼저 테스트 후 교체
4. **파일 헤더 주석**: 모든 새 파일에 역할/연계/초보자 안내 포함
