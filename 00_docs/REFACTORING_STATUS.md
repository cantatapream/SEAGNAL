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
| Phase 1 | 스테이징 인프라 구축 | 🔄 진행중 |
| Phase 2 | 문서화 기반 설정 | 🔄 진행중 |
| Phase 3 | 서버 리팩토링 (server.js) | ⬜ 대기 |
| Phase 4 | 프론트엔드 리팩토링 (app.js) | ⬜ 대기 |
| Phase 5 | 최종 검증 및 프로덕션 전환 | ⬜ 대기 |

---

## 3. Phase 1: 스테이징 인프라 구축

| Step | 내용 | 상태 |
|------|------|------|
| 1.1 | flyctl 확인/설치 | ⬜ 사용자 직접 실행 필요 |
| 1.2 | fly.staging.toml 생성 | ✅ 완료 |
| 1.3 | Fly.io 앱/볼륨 생성 | ⬜ 사용자 직접 실행 필요 |
| 1.4 | 환경변수 설정 | ⬜ 사용자 직접 실행 필요 |
| 1.5 | GitHub Actions 스테이징 워크플로우 | ✅ 완료 |
| 1.6 | Git 브랜치 전략 수립 | ✅ 완료 |
| 1.7 | 스테이징 초기 배포/검증 | ⬜ 사용자 직접 실행 필요 |

---

## 4. Phase 2: 문서화 기반 설정

| Step | 내용 | 상태 |
|------|------|------|
| 2.1 | REFACTORING_STATUS.md 생성 | ✅ 완료 |
| 2.2 | REFACTORING_LOG.md 생성 | ✅ 완료 |

---

## 5. Phase 3: 서버 리팩토링 (server.js 2,758줄 → 모듈 분할)

### 리팩토링 후 서버 구조
```
📂 local_server/
│
├── 📄 server.js                          ← 메인 엔트리 (~150줄)       ⬜
│
├── 📂 config/                            [서버 설정]
│   └── 📄 server_config.js              ← Express 설정, 경로, 환경변수 ⬜
│
├── 📂 services/                          [비즈니스 로직]
│   ├── 📄 cache_manager.js              ← 캐시 관리                   ⬜
│   ├── 📄 tide_collector.js             ← 조석 데이터 수집             ⬜
│   ├── 📄 file_helper.js               ← JSON 파일 I/O               ⬜
│   └── 📄 upload_manager.js            ← 업로드 설정                  ⬜
│
├── 📂 routes/                            [API 라우트]
│   ├── 📄 health.js                     ← GET /, /api/health          ⬜
│   ├── 📄 weather.js                    ← 특보/전망 API               ⬜
│   ├── 📄 buoy.js                       ← 부이 API                    ⬜
│   ├── 📄 tide.js                       ← 조석 API                    ⬜
│   ├── 📄 content.js                    ← 공지/홍보/업로드 API         ⬜
│   ├── 📄 stats.js                      ← 통계 API                    ⬜
│   ├── 📄 archive.js                    ← 아카이브 API                 ⬜
│   ├── 📄 push.js                       ← 푸시알림 API [마지막]        ⬜
│   └── 📄 admin.js                      ← 관리자 API [마지막]          ⬜
│
└── (기존 모듈 파일들 유지: scheduler.js, cloud_backup.js 등)
```

| Step | 내용 | 상태 |
|------|------|------|
| 3.1 | config/server_config.js 분리 | ⬜ |
| 3.1 | services/cache_manager.js 분리 | ⬜ |
| 3.1 | services/file_helper.js 분리 | ⬜ |
| 3.1 | services/upload_manager.js 분리 | ⬜ |
| 3.1 | services/tide_collector.js 분리 | ⬜ |
| 3.1 | 검증: 스테이징 배포 후 API 동작 확인 | ⬜ |
| 3.2 | routes/health.js 분리 | ⬜ |
| 3.2 | routes/weather.js 분리 | ⬜ |
| 3.2 | routes/buoy.js 분리 | ⬜ |
| 3.2 | routes/tide.js 분리 | ⬜ |
| 3.2 | routes/content.js 분리 | ⬜ |
| 3.2 | routes/stats.js 분리 | ⬜ |
| 3.2 | routes/archive.js 분리 | ⬜ |
| 3.2 | 검증: 모든 API 엔드포인트 동작 확인 | ⬜ |
| 3.3 | routes/push.js 분리 (마지막) | ⬜ |
| 3.3 | routes/admin.js 분리 (마지막) | ⬜ |
| 3.3 | 검증: 관리자/푸시 기능 확인 | ⬜ |

---

## 6. Phase 4: 프론트엔드 리팩토링 (app.js 12,077줄 → 모듈 분할)

### 리팩토링 후 프론트엔드 구조
```
📂 local_server/
│
├── 📄 app.js                             ← 오케스트레이터 (~300줄)      ⬜
│
├── 📂 js/                                [분할된 프론트엔드 모듈]
│   │
│   ├── 📂 00_config/                     [설정 및 상수]
│   │   ├── 📄 config.js                 ← CONFIG 객체                  ⬜
│   │   ├── 📄 zone_constants.js         ← 해구/해역/연안 매핑           ⬜
│   │   ├── 📄 buoy_constants.js         ← 부이 매핑                    ⬜
│   │   └── 📄 windy_constants.js        ← Windy URL/좌표               ⬜
│   │
│   ├── 📂 01_core/                       [핵심 상태/데이터]
│   │   ├── 📄 app_state.js              ← appState, fetchAllData       ⬜
│   │   └── 📄 utils.js                  ← 포맷팅 유틸리티               ⬜
│   │
│   ├── 📂 02_alerts/                     [특보 시스템]
│   │   ├── 📄 alert_processor.js        ← 특보 처리 로직               ⬜
│   │   └── 📄 alert_renderer.js         ← 특보 UI 렌더링               ⬜
│   │
│   ├── 📂 03_marine/                     [해구별 기상]
│   │   ├── 📄 marine_data.js            ← 해구별 데이터                 ⬜
│   │   ├── 📄 marine_modal.js           ← 해구별 모달                   ⬜
│   │   └── 📄 marine_chart.js           ← 차트 렌더링                   ⬜
│   │
│   ├── 📂 04_buoy/                       [부이 데이터]
│   │   ├── 📄 buoy_display.js           ← 부이 데이터 표시              ⬜
│   │   └── 📄 buoy_status.js            ← 부이 상태 카드                ⬜
│   │
│   ├── 📂 05_windy/                      [Windy 연동]
│   │   └── 📄 windy_integration.js      ← Windy 팝업                   ⬜
│   │
│   ├── 📂 06_settings/                   [사용자 설정]
│   │   ├── 📄 user_settings.js          ← 사용자 설정                   ⬜
│   │   └── 📄 notification_settings.js  ← 알림 설정                     ⬜
│   │
│   ├── 📂 07_admin/                      [관리자 시스템]
│   │   ├── 📄 admin_auth.js             ← 관리자 인증                   ⬜
│   │   └── 📄 admin_dashboard.js        ← 관리자 대시보드                ⬜
│   │
│   ├── 📂 08_promo/                      [홍보 게시판]
│   │   └── 📄 promo_manager.js          ← 홍보 게시판                   ⬜
│   │
│   ├── 📂 09_analytics/                  [방문자 통계]
│   │   ├── 📄 stats_data.js             ← 통계 데이터                   ⬜
│   │   └── 📄 stats_chart.js            ← 통계 차트                     ⬜
│   │
│   ├── 📂 10_ui/                         [UI 공통]
│   │   ├── 📄 animations.js             ← 애니메이션                    ⬜
│   │   ├── 📄 tabs.js                   ← 탭 시스템                     ⬜
│   │   ├── 📄 modals.js                 ← 모달/팝업                     ⬜
│   │   ├── 📄 time_display.js           ← 시간 표시                     ⬜
│   │   └── 📄 font_size.js              ← 글꼴 크기                     ⬜
│   │
│   ├── 📂 11_geo/                        [위치/좌표]
│   │   └── 📄 geolocation.js            ← 위치/좌표 변환                ⬜
│   │
│   ├── 📂 12_status/                     [상태 표시]
│   │   └── 📄 status_display.js         ← API 상태 표시                 ⬜
│   │
│   └── 📂 13_push/                       [푸시알림 UI - 마지막]
│       ├── 📄 push_custom.js            ← 커스텀 푸시                   ⬜
│       └── 📄 push_history.js           ← 히스토리                      ⬜
│
└── (기존 JS 파일들 유지: seaZones.js, tide.js 등)
```

| Step | 내용 | 상태 |
|------|------|------|
| 4.1 | 00_config/ 설정 및 상수 분리 | ⬜ |
| 4.1 | 검증: 스테이징에서 데이터 매핑 확인 | ⬜ |
| 4.2 | 01_core/utils.js, 10_ui/*, 11_geo/* 분리 | ⬜ |
| 4.2 | 검증: UI 동작 확인 | ⬜ |
| 4.3 | 01_core/app_state.js, 02_alerts/* 분리 | ⬜ |
| 4.3 | 검증: 특보 표출 확인 | ⬜ |
| 4.4 | 03_marine/*, 04_buoy/*, 05_windy/*, 12_status/* 분리 | ⬜ |
| 4.4 | 검증: 해구별/부이/Windy 확인 | ⬜ |
| 4.5 | 06_settings/*, 07_admin/*, 08_promo/*, 09_analytics/* 분리 | ⬜ |
| 4.5 | 검증: 설정/관리자/홍보/통계 확인 | ⬜ |
| 4.6 | 13_push/* 분리 (마지막) | ⬜ |
| 4.6 | app.js 오케스트레이터로 축소 | ⬜ |
| 4.6 | 검증: 전체 기능 종합 테스트 | ⬜ |

---

## 7. Phase 5: 최종 검증 및 프로덕션 전환

| Step | 내용 | 상태 |
|------|------|------|
| 5.1 | 스테이징 종합 테스트 | ⬜ |
| 5.2 | staging → main PR 머지 | ⬜ |
| 5.3 | 프로덕션 동작 확인 | ⬜ |
