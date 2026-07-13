# SEAGNAL 폴더 구조 리팩토링 제안서

> 작성일: 2026-07-13 (KST)
> 목적: 뒤죽박죽인 JS/네이티브/서버 파일을 **메인탭(기능) 기준**으로 구조화하는 방안 검토
> 범위: **폴더 구조 재편성안 제시** (코드 로직 변경 없음)

---

## 1. 현재 구조 진단

### 1.1 현재 구조 요약

```
SEAGNAL/
├── android/                     ← Capacitor 안드로이드 네이티브
├── src/main/webapp/             ← (?) KHOA OpenLayers API 샘플 (Maven/pom.xml 잔재)
├── local_server/                ← ★ 서버 + 프론트엔드가 한 폴더에 혼재
│   ├── server.js, scheduler.js(2,672줄)
│   ├── routes/    (32개)        ← Express 라우트 (비교적 정리됨)
│   ├── services/  (35개)        ← 서버 서비스 (비교적 정리됨)
│   ├── advisory/                ← 특보 예측 엔진
│   ├── js/        (90개, 67,150줄) ← ★ 프론트 JS 전부가 평면(flat) 구조
│   ├── index2.html (5,581줄)    ← 모든 탭의 마크업이 단일 파일
│   ├── style.css   (11,043줄)   ← 모든 탭의 스타일이 단일 파일
│   ├── *.js (루트에 20여 개)     ← 크롤러/조석/푸시 등 서버·프론트 파일 혼재
│   ├── serviceAccountKey.json   ← ⚠️ 보안 문제 (아래 1.3)
│   └── assets/, images/, data/, knowledge/, tools/, scripts/
├── apk_build/, dist/            ← 빌드 산출물
├── 00_docs/                     ← 문서
└── (루트에 리포트 md, png, pdf, zone_editor_standalone.html 2.6MB 등 산재)
```

### 1.2 핵심 문제점

| # | 문제 | 상세 |
|---|------|------|
| 1 | **프론트/서버 미분리** | `local_server/`가 정적 루트(staticRoot)이자 서버 코드 폴더. 어떤 파일이 브라우저용인지 Node용인지 이름만으로 구분 불가 |
| 2 | **js/ 평면 구조** | 90개 파일이 한 폴더에. `surfing1~5`, `marine_chart1~5`, `ocean_warn_active1~5` 등 번호 접미사 파일이 어느 탭 소속인지 파악 어려움 |
| 3 | **local_server 루트 혼재** | `tide.js`(프론트), `push_sender.js`(서버), `marine_warning_crawler.js`(서버 크롤러), `sw.js`(서비스워커)가 같은 층위에 존재 |
| 4 | **횡단 기능(cross-cutting) 기준 부재** | 푸시·위치기반·AI어시스턴트·관리자 파일이 탭 파일들과 뒤섞임 |
| 5 | **저장소 루트 오염** | 작업 리포트 md, 스크린샷 png, 실험용 html, 옛 Maven 프로젝트(src/, pom.xml, target/)가 루트에 방치 |
| 6 | **거대 단일 파일** | index2.html 5,581줄 / style.css 11,043줄 / scheduler.js 2,672줄 |

### 1.3 ⚠️ 최우선(Phase 0) — 보안 이슈

구조 정리와 무관하게 **가장 먼저** 처리해야 할 사항:

- `local_server/serviceAccountKey.json`, `serviceAccountKey_Backup.json`, `googla_cloud_api_backup_bot_key/*.json` 이 **git에 커밋되어 있음**
- `local_server/`는 정적 파일 루트이므로, 차단 로직이 없으면 `https://<서버>/serviceAccountKey.json` 으로 **외부에서 다운로드 가능성** 있음 (server.js에 해당 파일 차단 코드 없음)
- 조치: ① GCP/Firebase 콘솔에서 **키 재발급(rotate) 후 기존 키 폐기** ② 파일을 정적 루트 밖(예: `server/secrets/` 또는 환경변수/Fly secrets)으로 이동 ③ `.gitignore` 등록 ④ git 히스토리에서 제거(BFG 등)

---

## 2. 앱 기능 지도 (분류의 기준)

하단 메인탭 4개 + 횡단 기능으로 전체 90개 프론트 JS를 분류하면:

```
📱 SEAGNAL 앱
│
├── [탭1] 특보 및 전망 (weather-group)
│   ├── 특보 현황/전망: data, render, render_coastal, marine, forecast,
│   │                  marine_forecast, advisory_prediction, alert_history, zone_avg
│   └── 해상일기도:     marine_chart1~5
│
├── [탭2] 해양종합정보 (ocean-map-section)
│   ├── 지도 코어:   ocean_map, ocean_markers, ocean_overlay, ocean_northup
│   ├── 바텀시트:    ocean_bottom_sheet1~5, _weather, _vsby, ocean_sheet_timeline
│   ├── 특보 표시:   ocean_warn_zone, ocean_warn_active1~5, ocean_warn_vsby
│   ├── 레이어:      shrt_forecast_layer, vsby_forecast_layer, tide_field, windy
│   ├── 관측/시설:   ocean_buoy, ocean_cctv, cctv1, cctv4
│   └── 타임라인:    ocean_timeline
│
├── [탭3] 해양생활 (ocean-life-group)
│   ├── 바다낚시: fishing        ├── 서핑: surfing1~5
│   ├── 해수욕: (swimming)       ├── 스킨스쿠버: scuba
│   ├── 갯벌체험: mudflat        ├── 바다갈라짐: sea_parting
│   └── 이안류: ripcurrent
│
├── [탭4] 공지사항 (promo-section)
│   └── promo, promo_comment1~5, image_compress, pagination_helper
│
└── [횡단 기능] ─ 특정 탭에 속하지 않음
    ├── 푸시알림:     alert_push (+ 서버: push_sender, routes/push)
    ├── 위치기반경보: location_alert_core/background/runtime/ui/typhoon_runtime
    ├── 태풍:         ocean_typhoon, typhoon_radius, typhoon_message
    ├── AI 어시스턴트: assistant, assistant_deeplink, assistant_overlay
    ├── 관리자:       admin, admin_collect/survey/report/trigger/location_status,
    │                advisory_manage_admin
    ├── 설정:         settings, zone_guide
    ├── 사용자참여:   report_user, survey_user
    ├── 조석(공용):   tide, tide_calendar, tide_helpers, tide_exception
    └── 앱 코어:      app_init, config, utils, mappings, backbutton, ui_modal,
                     capacitor-plugins, user_memory_bridge/web, sw.js
```

---

## 3. 횡단 기능 정리의 표준 관행 (공통 원칙)

이 규모의 웹앱/하이브리드앱에서 통용되는 **3계층 규칙**:

```
core/      앱이 "구동"되는 데 필요한 것        → 부트스트랩, 설정, 네이티브 브리지, 뒤로가기
features/  독립적인 "기능" 단위 전부           → 탭 4개 + 푸시, 위치경보, AI, 관리자, 설정...
shared/    여러 feature가 "공유"하는 재료      → 유틸, 공용 UI(모달), 공용 데이터(해역좌표), 조석 계산
```

판단 기준 (한 줄 규칙):

| 질문 | 답 | 위치 |
|------|-----|------|
| 이 파일이 없으면 앱이 아예 안 뜨는가? | 예 | `core/` |
| 화면(탭)이든 아니든, 하나의 독립 기능인가? | 예 | `features/<기능명>/` |
| 두 개 이상의 feature가 import해서 쓰는가? | 예 | `shared/` |

> **핵심**: 푸시·위치기반·AI는 "탭이 아니라서 애매한 것"이 아니라, **탭과 동급의 feature**로 취급하면 고민이 사라집니다. `features/` 아래에는 "탭 feature"와 "횡단 feature"가 나란히 놓입니다.

---

## 4. 리팩토링 안 (3가지)

### 안 A — 최소 변경: `js/` 내부만 기능별 폴더화 (저위험·점진)

현 배포 구조(`local_server` = 정적 루트)를 그대로 두고, **js/ 안에서만** 폴더를 만듭니다.
index2.html의 `<script src>` 경로 수정만으로 완료되는 가장 안전한 안.

```
local_server/
├── server.js, routes/, services/, advisory/   (변경 없음)
├── index2.html, style.css, sw.js              (변경 없음, script 경로만 수정)
└── js/
    ├── core/            app_init, config, backbutton, capacitor-plugins ...
    ├── shared/          utils, mappings, ui_modal, pagination_helper,
    │                    seaZones*, tide*, buoyLocations ...
    ├── forecast/        (탭1) data, render, marine, forecast, alert_history ...
    │   └── chart/       marine_chart1~5
    ├── ocean-map/       (탭2) ocean_map, ocean_markers ...
    │   ├── sheet/       ocean_bottom_sheet1~5 ...
    │   ├── warn/        ocean_warn_*
    │   └── layers/      shrt_forecast_layer, vsby_forecast_layer, tide_field, windy
    ├── marine-life/     (탭3)
    │   ├── fishing/  surfing/  scuba/  mudflat/  sea-parting/  ripcurrent/
    ├── notice/          (탭4) promo, promo_comment1~5, image_compress
    ├── push/            alert_push
    ├── location-alert/  location_alert_*
    ├── typhoon/         ocean_typhoon, typhoon_radius, typhoon_message
    ├── assistant/       assistant*, user_memory_*
    ├── admin/           admin*, advisory_manage_admin
    ├── settings/        settings, zone_guide
    └── engagement/      report_user, survey_user
```

- 장점: 반나절~1일 작업. 서버/배포(Fly.io)/Capacitor 설정 무변경. 롤백 쉬움
- 단점: 프론트/서버 혼재(문제 1, 3)는 미해결. local_server 루트의 크롤러·tide.js 등은 그대로

---

### 안 B — 권장: 클라이언트/서버 완전 분리 + 메인탭 기준 feature 구조

`local_server/`를 `client/`(브라우저에 내려가는 것)와 `server/`(Node에서 도는 것)로 분리하고,
클라이언트는 안 A의 feature 구조를 적용합니다.

```
SEAGNAL/
│
├── client/                          ★ 정적 루트 (staticRoot를 여기로 변경)
│   ├── index.html                   (index2.html 개명)
│   ├── sw.js                        (서비스워커 — 반드시 정적 루트 최상단 유지)
│   ├── manifest.json
│   ├── css/                         style.css, splash.css, kma_widget.css
│   ├── assets/  images/             (아이콘, 벤더 라이브러리, 이미지)
│   │
│   ├── core/                        앱 구동
│   │   app_init, config, capacitor-plugins, backbutton, auto_refresh, index2_patch
│   │
│   ├── shared/                      공용 재료
│   │   ├── ui/                      ui_modal, pagination_helper, image_compress
│   │   ├── utils/                   utils, mappings
│   │   ├── geo/                     seaZones, seaZonesData, seaZoneCoordinates,
│   │   │                            zoneOverlayConfig, gridCalibrationData, buoyLocations
│   │   └── tide/                    tide, tide_calendar, tide_helpers, tide_exception
│   │
│   └── features/
│       ├── forecast/                [탭1] 특보 및 전망
│       │   ├── alerts/              data, render, render_coastal, marine,
│       │   │                        alert_history, zone_avg, fix_popup_logic
│       │   ├── outlook/             forecast, marine_forecast, advisory_prediction, windy
│       │   └── marine-chart/        marine_chart1~5 (해상일기도)
│       │
│       ├── ocean-map/               [탭2] 해양종합정보
│       │   ├── map/                 ocean_map, ocean_markers, ocean_overlay, ocean_northup
│       │   ├── bottom-sheet/        ocean_bottom_sheet1~5, _weather, _vsby, ocean_sheet_timeline
│       │   ├── warnings/            ocean_warn_zone, ocean_warn_active1~5, ocean_warn_vsby
│       │   ├── layers/              shrt_forecast_layer, vsby_forecast_layer, tide_field
│       │   ├── observation/         ocean_buoy, ocean_cctv, cctv1, cctv4
│       │   └── timeline/            ocean_timeline
│       │
│       ├── marine-life/             [탭3] 해양생활
│       │   ├── fishing/  surfing/  swimming/  scuba/
│       │   ├── mudflat/  sea-parting/  ripcurrent/
│       │
│       ├── notice/                  [탭4] 공지사항
│       │   promo, promo_comment1~5
│       │
│       ├── push/                    ⚡ 횡단: alert_push
│       ├── location-alert/          ⚡ 횡단: location_alert_core/background/runtime/ui
│       ├── typhoon/                 ⚡ 횡단: ocean_typhoon, typhoon_radius, typhoon_message,
│       │                                    location_alert_typhoon_runtime
│       ├── assistant/               ⚡ 횡단: assistant*, user_memory_bridge/web
│       ├── settings/                ⚡ 횡단: settings, zone_guide
│       ├── engagement/              ⚡ 횡단: report_user, survey_user
│       └── admin/                   ⚡ 횡단: admin*, advisory_manage_admin, admin_trigger
│
├── server/
│   ├── server.js
│   ├── config/                      (기존 유지)
│   ├── routes/                      (기존 유지 — 이미 잘 분리됨)
│   ├── services/                    (기존 유지)
│   ├── advisory/                    특보 예측 엔진 (기존 유지)
│   ├── jobs/                        ★ 신설: 스케줄러 + 크롤러/수집기
│   │   scheduler, marine_warning_crawler, dmdw_warn_crawler, typhoon_crawler,
│   │   weather_alerts_crawler, regional_bulletin_collector, regional_forecast_collector,
│   │   marine_forecast_processor, report_alert_processor, _fetch_reports
│   ├── push/                        ★ 신설: push_sender, ai_report_parser(알림용이면)
│   ├── secrets/                     ★ 신설: 키 파일 (.gitignore, 정적 루트 밖)
│   ├── data/  knowledge/  uploads/  (기존 유지)
│   └── scripts/  tools/             빌드·테스트 스크립트 (기존 유지)
│
├── android/                         네이티브 (변경 없음)
├── 00_docs/                         문서 (루트의 *_REPORT.md 들도 여기로 흡수)
└── archive/                         ★ 신설: src/main(옛 KHOA 샘플), pom.xml,
                                     zone_editor_standalone.html, 실험 파일, 참고 pdf
```

수정이 필요한 연결 지점 (3곳뿐):

| 지점 | 수정 내용 |
|------|-----------|
| `server/config/server_config.js` | `staticRoot` → `../client` 로 변경 |
| `client/index.html` | `<script src>` 경로 일괄 치환 (로드 **순서는 유지**) |
| `sw.js` 캐시 목록 / `build-gzip.js` | 새 경로 반영 |

- 장점: 문제 1~5 전부 해결. "브라우저 코드 = client, 서버 코드 = server"가 폴더만 봐도 자명. 이후 index.html/style.css 분할(안 B-2단계)의 토대
- 단점: 2~4일 작업 + 스테이징 검증 필요. Dockerfile/fly.toml의 COPY 경로, `build-gzip.js`, `bump_cache_version.js` 등 빌드 스크립트 경로 수정 동반

---

### 안 C — 확장 대비: 모노레포 스타일 (apps / packages)

iOS 추가, 웹 단독 서비스, 관리자 웹 분리 등 **멀티 앱 확장 계획이 있을 때만** 권장.

```
SEAGNAL/
├── apps/
│   ├── mobile/          android/ + capacitor.config.json + apk_build
│   ├── web/             client (안 B의 client/ 내용)
│   └── server/          Express 서버 (안 B의 server/ 내용)
├── packages/            앱 간 공유 코드
│   ├── geo-data/        seaZones*, 좌표, 격자 데이터 (서버·클라 공용)
│   ├── tide-engine/     조석 계산 (서버·클라 공용)
│   └── typhoon/         typhoon_radius, typhoon_message (현재도 양쪽에서 로드됨!)
├── docs/
└── archive/
```

- 장점: `services/typhoon_radius.js`처럼 **서버 파일을 프론트가 script로 로드하는 현재의 꼬임**을 packages/로 정식화. 확장성 최고
- 단점: 번들러(Vite 등) 없이 script 태그로 로드하는 현 방식과는 궁합이 나쁨. 도입하려면 빌드 도구 도입이 사실상 전제 → 작업량 1~2주+

---

## 5. 비교 및 권장

| 기준 | 안 A (js만 정리) | 안 B (클라/서버 분리) ★권장 | 안 C (모노레포) |
|------|:---:|:---:|:---:|
| 작업량 | 0.5~1일 | 2~4일 | 1~2주+ |
| 리스크 | 매우 낮음 | 중간 (경로 3곳) | 높음 (빌드 도구 전제) |
| 문제 해결 범위 | js 평면구조만 | 루트 혼재까지 전부 | 전부 + 공유코드 정식화 |
| 향후 확장성 | 낮음 | 좋음 | 최고 |
| 지금 필요한가 | — | **적정** | 과함 |

**권장: 안 B를 목표로, 안 A를 1단계로 삼아 점진 진행** (안 A의 폴더 구분이 안 B에 그대로 승계되므로 버리는 작업이 없음)

```
Phase 0  보안: 서비스 계정 키 rotate + 정적 루트 밖으로 + .gitignore     [즉시]
Phase 1  루트 청소: 리포트/실험파일/옛 Maven → 00_docs, archive          [반나절]
Phase 2  = 안 A: js/ 기능별 폴더화 + index2.html 경로 수정               [1일]
Phase 3  = 안 B: client/server 분리, staticRoot 변경, 크롤러 → jobs/     [1~2일]
Phase 4  (선택) index.html 탭별 분할, style.css 기능별 분할, scheduler 분할
```

각 Phase 완료 시마다 스테이징(fly.staging) 배포 → 4개 탭 + 푸시 + 위치경보 동작 확인 후 다음 단계로.

---

## 6. 주의사항 (이 코드베이스 특유의 제약)

1. **script 로드 순서 의존성**: 번들러 없이 `<script>` 태그 순서로 전역 스코프에 로드됨. **파일을 옮겨도 index2.html 내 로드 순서는 절대 바꾸지 말 것** (예: `surfing1→5`, `config→utils→data→render` 순서)
2. **sw.js 위치**: 서비스워커의 scope 규칙 때문에 정적 루트 최상단에 있어야 함. `js/` 안으로 옮기면 안 됨
3. **캐시 버스팅**: `?v=Patch_...` 쿼리와 `bump_cache_version.js`가 경로 문자열에 의존 → 경로 변경 시 함께 수정
4. **서버↔프론트 겸용 파일**: `services/typhoon_radius.js`, `services/typhoon_message.js`는 서버가 require하면서 index2.html도 script로 로드. 이동 시 양쪽 경로 모두 수정 (안 B에서는 `shared/` 또는 심볼릭 유지, 안 C에서는 `packages/typhoon/`)
5. **Fly.io 볼륨 경로**: `data/`, `uploads/` 등 런타임 쓰기 폴더는 볼륨 마운트 경로와 연결 → server_config의 경로 상수 확인 후 이동
6. **git 이력 보존**: 이동은 `git mv`로 수행해야 blame/이력 추적 유지
