# index1/index2 분리 분석 — 1. 자원 인벤토리

## 0. 본 문서 시리즈 개요

본 시리즈는 자식해역 표출 기능을 index1에만 도입하기 위한 사전 분석을 정리합니다.

- **01_inventory.md** (본 파일) — 모든 자원의 분류 인벤토리
- **02_dependencies.md** — 의존성 / 맞물림 핫스팟
- **03_risk_assessment.md** — 위험도 평가 + 분리 전략 권장

분석 일시: 2026-05-01

---

## 1. 페이지 식별 플래그 현황

| 페이지 | 플래그 | 위치 |
|---|---|---|
| index2 (`index2.html`) | `<script>window.__SEAGNAL_PAGE = 'index2';</script>` | line 886 |
| index1 (`index.html`) | **플래그 없음** (undefined) | — |

**현황 평가**: 비대칭 상태. 대부분의 코드가 `=== 'index2'`로 분기하고 있어 index1은 implicit "else" 경로로 처리됨. 본 작업으로 index1에도 명시 플래그 추가 필요.

---

## 2. HTML 파일 차이

| 항목 | index1 | index2 |
|---|---|---|
| 파일명 | `index.html` | `index2.html` |
| 줄 수 | ~2,077줄 | ~3,350줄 |
| Script 수 | 70개 | 82개 |
| 인라인 CSS | 12줄 (헤더 패딩만) | 200+줄 (line 7-220, 하단탭 UI 전용) |
| 메인 탭 위치 | 상단 (`.main-tabs`) | 상단 + **하단** (`.bottom-main-tabs`) |
| 시각 식별자 | 없음 | `__SEAGNAL_PAGE = 'index2'` (line 886) |

---

## 3. 라우팅 인벤토리

### 3.1 페이지 라우팅

| URL | 응답 | 처리 위치 |
|---|---|---|
| `/` | `index2.html` (운영 진입점) | `routes/health.js:33-40` |
| `/index.html` | `index.html` (테스트 페이지) | `express.static`이 직접 서빙 |
| `/index2.html` | `index2.html` (직접 URL 접속) | `express.static`이 직접 서빙 |

### 3.2 API 라우팅

전체 50+ 개의 `/api/*` 엔드포인트가 모두 **페이지 무관 공유**입니다.

| 영역 | 라우트 파일 | 주요 엔드포인트 | 분류 |
|---|---|---|---|
| 특보/날씨 | `routes/weather.js` | `/api/weather-alerts`, `/api/forecasts`, `/api/warn-zones` | (S) 공유 |
| 해양 | `routes/ocean1~5.js` | `/api/ocean/depth`, `/api/ocean/wave`, `/api/ocean/zone-forecasts` | (S) 공유 |
| 푸시 | `routes/push.js`, `push_test.js` | `/api/subscribe`, `/api/test-push`, `/api/push-history` | (S) 공유 |
| 관리자 | `routes/admin.js` | `/api/admin/crawl-toggle`, `/api/admin/manual-alert`, `/api/admin/alerts-reset` | (B) testMode로 분기 |
| 콘텐츠 | `routes/content.js` | `/api/notice`, `/api/promo` | (S) 공유 |
| 사용자 | `routes/report.js`, `comment.js`, `survey.js` | `/api/reports`, `/api/comments`, `/api/surveys` | (S) 공유 |
| 통계 | `routes/stats.js` | `/api/visit`, `/api/stats/visitors` | (S) 공유 |

**중요**: API 레벨에서는 페이지를 식별할 수 없습니다 (Referer 검사 등 없음).

---

## 4. 프론트엔드 JS 인벤토리

### 4.1 공유 스크립트 (Both pages, ~64개)

핵심 라이브러리/엔진:
- CDN: `quill`, `chart.js`, `chartjs-plugin-datalabels`, `ol@v8.2.0`, `suncalc`, `hls.min.js`
- 로컬 root: `tide.js`, `tide_calendar.js`, `seaZonesData.js`, `zoneOverlayConfig.js`, `gridCalibrationData.js`, `fix_popup_logic.js`, `auto_refresh.js`, `buoyLocations.js`, `seaZoneCoordinates.js`, `seaZones.js`
- `js/` 폴더: `config.js`, `mappings.js`, `utils.js`, `data.js`, `zone_avg.js`, `render.js`, `alert_history.js`, `render_coastal.js`, `marine.js`, `settings.js`, `forecast.js`, `windy.js`, `marine_forecast.js`, `fishing.js`, `surfing1~5.js`, `sea_parting.js`, `ocean_map.js`, `ocean_markers.js`, `ocean_bottom_sheet1~5.js`, `ocean_overlay.js`, `ocean_timeline.js`, `admin_trigger.js`, `image_compress.js`, `promo.js`, `promo_comment1~3.js`, `admin.js`, `admin_collect.js`, `admin_survey.js`, `admin_report.js`, `report_user.js`, `survey_user.js`, `zone_guide.js`, `alert_push.js`, `ui_modal.js`, `app_init.js`, `backbutton.js`

### 4.2 index1 전용 (6개)

```
js/cctv1.js
js/cctv2.js
js/cctv3.js
js/cctv4.js
js/cctv5.js
js/cctv6.js
```

→ 구버전 CCTV 모듈. index2에서는 통합된 `js/ocean_cctv.js`로 대체됨.

### 4.3 index2 전용 (16개 + CDN 2개)

CDN:
- `proj4js/2.8.0/proj4.js` (line 924)
- `map.ngii.go.kr/openapi/wmts_ngiiMap` (line 925)

`js/`:
- `promo_comment4.js`, `promo_comment5.js`
- `marine_chart1~5.js` (5개)
- `ocean_buoy.js`
- `ocean_warn_zone.js`
- `ocean_warn_active1~5.js` (5개)
- `ocean_cctv.js`
- `index2_patch.js` (1019줄, **거대한 마스터 패치**)

---

## 5. CSS 인벤토리

### 5.1 공유 스타일시트

- `style.css?v=Margin_Final_v5`
- `splash.css`
- FontAwesome (CDN)
- OpenLayers (CDN)
- `kma_widget.css`

### 5.2 페이지별 인라인 CSS

| 페이지 | 위치 | 내용 |
|---|---|---|
| index1 (`index.html`) | line 7-12 | 헤더 패딩만 |
| index2 (`index2.html`) | line 7-220 | **200+줄**의 하단 탭 UI 전용 스타일 (`.bottom-main-tabs`, `.bottom-sub-tabs`, safe-area 패딩, body[data-active-tab] 분기 등) |

---

## 6. 페이지 식별 플래그 사용 코드 (15곳)

`window.__SEAGNAL_PAGE` 검사 위치:

| 파일 | 줄 | 조건 | 동작 |
|---|---|---|---|
| `seaZones.js` | 1983 | `=== 'index2'` | 부이 모달 크기 확대 |
| `seaZones.js` | 2243 | `=== 'index2'` | 부이 데이터 그리드 폰트 확대 |
| `js/render.js` | 1054 | `=== 'index2'` | ocean-map 존 버튼 활성화 |
| `js/render.js` | 1100 | `=== 'index2'` | 알림 카드에 4번째 버튼("종합정보") 추가 |
| `js/settings.js` | 48 | `=== 'index2'` | 숨겨진 탭 비밀 동작 분기 |
| `js/windy.js` | 313, 560, 703 | `=== 'index2'` | Windy 팝업 헤더/레이아웃 |
| `js/ocean_map.js` | 766 | `=== 'index2'` | 해구도 격자 레이어 초기화 |
| `js/ocean_buoy.js` | 29, 500 | `=== 'index2'` | 부이 클러스터링 470줄 전체를 가드 |
| `js/ocean_cctv.js` | 43 | `!== 'index2'` | index1면 즉시 return (CCTV 신버전 미동작) |
| `js/index2_patch.js` | 29, 1019 | `=== 'index2'` | 990줄 마스터 패치 전체를 가드 |
| `js/config.js` | 118 | `=== 'index2'` | 초기 라우팅을 ocean-map 탭으로 |

**관찰**: 대부분 `=== 'index2'` 양성 검사. index1은 implicit "else" (플래그 없음) 경로로 동작.

---

## 7. 백엔드 데이터 파일 인벤토리 (23개)

### 7.1 페이지 무관 공유 (대부분)

실시간/운영 파일:
- `weather_alerts.json` (86KB) — 부모해역 트리, 1분마다 갱신
- `active_lifecycle.json` (60KB) — 발효 상태 라이프사이클
- `zone_forecasts.json` (5.8MB) — 시간별 예보
- `general_forecasts.json` (95KB) — 일반 예보 그리드
- `regional_forecast.json` — 지방청 예보
- `buoys.json` (26KB) — 부이 관측 데이터
- `marine_forecast.json` — 해상 예보 (10분마다)
- `custom_push_history.json` (34KB) — 푸시 발송 이력
- `pending_pushes.json` — 푸시 재시도 큐

설정/메타:
- `zone_coords.json` (67KB) — 해역 좌표
- `tidebed_config.json`, `api_config.json`, `maintenance_config.json`, `work_mode_config.json`

콘텐츠:
- `notices.json`, `promo.json`, `marine_life_expiry.json`

사용자/통계:
- `subscriptions.json`, `admin_devices.json`, `visitors.json`, `visitors_stats.json`
- `review_needed.json`, `collect_failures.json`

### 7.2 테스트 모드 격리 파일 (1개)

- `weather_alerts_test.json` — `routes/admin.js:53` `testMode=true` 시 사용

→ **이미 testMode 격리 패턴이 존재**. 본 작업에서 활용 가능.

---

## 8. 스케줄러 잡 인벤토리 (14개, 모두 공유)

`scheduler.js`:

| 잡 | 줄 | 주기 | 변경 대상 |
|---|---|---|---|
| `weatherAlertsCrawler.run` | 1436-1437 | **1분마다** | weather_alerts.json + active_lifecycle.json |
| `marineForecastProcessor.collectMarineForecasts` | 1443 | 10분마다 | marine_forecast.json |
| `collectBuoys` (multi) | 1383-1398 | 매 5,35분 (KMA 갱신 사이클) | buoys.json |
| `collectGeneralForecasts` | 1402 | 1일 2회 (05:15, 17:15) | general_forecasts.json |
| `collectZoneForecasts` | 1405 | 1일 2회 (09:30, 21:30) | zone_forecasts.json |
| `collectMidTermSeaForecasts` | 1408 | 1일 2회 | 중기 해상 예보 |
| `collectFishingIndex` | 1411 | 1일 2회 | fishing_index.json |
| `collectSurfingIndex` | 1414 | 1일 2회 | surfing_index.json |
| `collectSeaSplitIndex` | 1417 | 1시간마다 | sea_split_index.json |
| `collectRegionalForecasts` | 1420-1430 | 1일 3회 + 30분 재시도 | regional_forecast.json |
| `checkAndSendAdminReminder` | 1450 | 매시간 :00 | admin_devices.json 푸시 |
| `updateDuckDNS` | 1366 | 30분마다 | DDNS (외부) |
| `subscriberSnapshot.takeSnapshot` | `server.js:104` | 1일 1회 (23:55) | 가입자 스냅샷 |
| `cloudBackup.performBackup` | `server.js:114` | 1일 1회 (00:05) | 클라우드 백업 |

→ 모든 잡이 페이지 구분 없이 동작. 본 작업의 방재기상 폴링은 **15번째 신규 잡**으로 추가 예정.

---

## 9. 인증 / 권한 현황

**모든 라우트에 인증 없음.** 본 작업과 무관하지만 알아둬야 할 사실:

- `/api/admin/*` 라우트들도 인증 없음
- 일반 사용자가 `/index.html` URL을 알면 어드민 패널 접근 가능
- 본 작업은 보안 강화를 다루지 않으므로 기존 정책 그대로 유지

---

## 10. 클라우드 백업 대상 (cloud_backup.js)

위치: `cloud_backup.js:105-113`

현재 백업 대상:
```
visitors.json, visitors_stats.json, tidebed_config.json,
notice.json, notices.json, promo.json, surveys.json,
+ 동적: survey_responses_*.json
```

**백업 제외 (의도적)**:
- weather_alerts.json (실시간 운영 상태)
- active_lifecycle.json (재시도 큐)
- zone_forecasts.json (캐시)
- custom_push_history.json (감사 로그)
- admin_devices.json (관리자 설정)

**본 작업에서 추가될 신규 파일**:
- `region_alias_map.json` → **백업 대상 추가 권장** (메타데이터 정적 파일)
- `subregion_lifecycle.json` → 백업 제외 (실시간 운영 상태)
- `subregion_error_log.json` → 백업 제외 (감사 로그)

---

## 11. 분류 요약

### 11.1 분리 난이도 분류

| 카테고리 | 항목 수 | 난이도 |
|---|---|---|
| 이미 분리된 자원 | JS 22개, HTML 일부, CSS 200줄 | 0 (이미 분리) |
| 명시적 플래그로 분기 가능 | 15곳 | 낮음 (조건문 추가) |
| 데이터 파일 격리 | 신규 3개 + testMode 패턴 활용 | 낮음 |
| 백엔드 라우트 신규 추가 | `routes/subregion.js` 등 | 낮음 (신규 파일) |
| 스케줄러 잡 추가 | 1개 신규 | 낮음 |
| **공유 자원 (분리 안 함)** | API 50+, 데이터 파일 23개 | — (공유 유지) |

### 11.2 본 작업 분리 핵심 결론

- **대부분의 자원은 그대로 공유 유지** (분리 비용 > 효익)
- **신규 자원은 처음부터 분리 설계** (`subregion_*` 접두 + testMode 패턴)
- **index1에 페이지 플래그 추가** (가장 첫 번째 작업)
- **신규 JS는 시작 시 플래그 가드** (오작동 방지)

---

## 12. 다음 문서

- `02_dependencies.md` — index1 변경이 index2에 미치는 영향 경로 분석
- `03_risk_assessment.md` — 항목별 분리 위험도 평가 + 권장 분리 전략
