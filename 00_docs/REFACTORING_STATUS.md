# SEAGNAL 리팩토링 종합 현황

> 최종 업데이트: 2026-02-21 16:30 (KST)

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
| Phase 5 | 프로덕션 전환 | ✅ 완료 |
| **기능 확장** | **게시판 동적 관리** | ✅ 완료 |
| **기능 확장** | **설문조사 시스템** | ✅ 완료 |

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

## 5. Phase 3: 서버 리팩토링 ✅ (2,758줄 → 83줄 진입점 + 모듈)

### 서버 구조
```
local_server/
├── server.js                       ← 모듈화된 진입점 (83줄)       ✅
├── server_original.js              ← 원본 백업 (2,758줄)
├── server_new.js                   ← 교체 전 테스트 버전 (보존)
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
│   ├── admin.js                    ← 관리자(크롤링/수집/수동특보) API ✅
│   └── survey.js        (361줄)   ← 설문조사 CRUD/응답/CSV API     ✅ [2026-02-21 추가]
├── data/
│   └── surveys.json                ← 설문 메타데이터 저장소          ✅ [2026-02-21 추가]
│   └── survey_responses_*.json     ← 설문별 응답 저장소 (자동 생성)
```

---

## 6. Phase 4: 프론트엔드 리팩토링 ✅ (app.js 12,077줄 → 15개 모듈)

### 프론트엔드 구조
```
local_server/
├── index.html                       ← 15개 모듈 로딩 (교체됨)       ✅
├── index_original.html              ← 원본 백업 (app.js 로딩)
├── index_staging.html               ← 교체 전 테스트 버전 (보존)
├── app.js                           ← 원본 보존 (12,077줄)
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
│   ├── admin_survey.js   (679줄)   ← 설문조사 관리자 UI (4개 서브탭)  ✅ [2026-02-21 추가]
│   ├── survey_user.js    (362줄)   ← 사용자 설문 팝업 (자동 표시)     ✅ [2026-02-21 추가]
│   └── history.js        (1347줄)   ← 특보 이력, 마무리 유틸          ✅
```

### 모듈 로딩 순서 (index.html)
1. `js/config.js` → 2. `js/mappings.js` → 3. `js/utils.js` → 4. `js/data.js`
→ 5. `js/render.js` → 6. `js/render_coastal.js` → 7. `js/marine.js`
→ 8. `js/settings.js` → 9. `js/forecast.js` → 10. `js/windy.js`
→ 11. `js/admin_trigger.js` → 12. `js/promo.js` → 13. `js/admin.js`
→ 14. `js/admin_collect.js` → **15. `js/admin_survey.js`** → **16. `js/survey_user.js`**
→ 17. `js/history.js`

---

## 7. Phase 5: 프로덕션 전환 ✅

### 5.1 파일 교체 완료
- [x] `server_new.js` → `server.js` 교체 (원본 → `server_original.js` 백업)
- [x] `index_staging.html` → `index.html` 교체 (원본 → `index_original.html` 백업)

### 5.2 롤백 방법
원본으로 되돌리려면:
```bash
cd local_server
cp server_original.js server.js
cp index_original.html index.html
```

---

## 8. 기능 확장 이력 (리팩토링 이후 신규 기능)

### 8.1 게시판 동적 관리 ✅ (2026-02-20)
- 게시판 추가/수정/삭제/정렬 기능 구현
- 관리자 센터 → 게시판 관리 탭 서브탭 추가

### 8.2 설문조사 시스템 ✅ (2026-02-21)

| 파일 | 줄수 | 역할 |
|------|------|------|
| routes/survey.js | 361줄 | 백엔드 API 10개 엔드포인트 (CRUD/응답/CSV) |
| js/admin_survey.js | 679줄 | 관리자 설문 관리 UI (4개 서브탭) |
| js/survey_user.js | 362줄 | 사용자 설문 팝업 (완료 시 재표시 방지) |
| data/surveys.json | - | 설문 메타데이터 저장소 |

#### 기존 파일 최소 수정:
| 파일 | 수정 내용 | 변경량 |
|------|----------|--------|
| config/server_config.js | FILES.SURVEYS 경로 추가 | +1줄 |
| server.js | survey 라우터 등록 | +2줄 |
| js/admin.js | 설문조사 탭 추가 | +2줄 |
| index.html | script 태그 2개 추가 | +2줄 |

#### 핵심 설계 결정:
- **재표시 방지**: localStorage `seagnal_survey_done_{id}` + 서버 deviceId 이중 체크
- **질문 유형 5종**: 단일선택, 복수선택, 주관식, 별점평가, 드롭다운
- **결과 시각화**: Chart.js 연동 (도넛/막대/별점 차트)
- **CSV 다운로드**: BOM 포함 한글 엑셀 호환

---

## 핵심 원칙

1. **원본 보존**: `server_original.js`, `index_original.html`, `app.js` 원본 백업 유지
2. **기능 100% 유지**: 코드 위치만 이동, 로직 변경 없음
3. **파일 헤더 주석**: 모든 모듈 파일에 역할/연계/초보자 안내 포함
