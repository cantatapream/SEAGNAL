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
| iOS 확장 대응 | 불가 (서버코드 혼재로 번들링 불가) | **가능 (client/ 복사 = 번들)** | 가능하나 과함 |
| 지금 필요한가 | — | **적정** | 과함 |

**권장: 안 B를 목표로, 안 A를 1단계로 삼아 점진 진행** (안 A의 폴더 구분이 안 B에 그대로 승계되므로 버리는 작업이 없음)

> iOS 확장 계획이 있는 경우 안 B는 사실상 전제 조건 — 상세는 §6 참고. iOS 자체는 안 B 구조에 `ios/` 폴더 하나가 추가되는 것으로 흡수되며, 모노레포(안 C)까지 갈 필요 없음.

```
Phase 0  보안: 서비스 계정 키 rotate + 정적 루트 밖으로 + .gitignore     [즉시]
Phase 1  루트 청소: 리포트/실험파일/옛 Maven → 00_docs, archive          [반나절]
Phase 2  = 안 A: js/ 기능별 폴더화 + index2.html 경로 수정               [1일]
Phase 3  = 안 B: client/server 분리, staticRoot 변경, 크롤러 → jobs/     [1~2일]
Phase 4  (선택) index.html 탭별 분할, style.css 기능별 분할, scheduler 분할
```

각 Phase 완료 시마다 스테이징(fly.staging) 배포 → 4개 탭 + 푸시 + 위치경보 동작 확인 후 다음 단계로.

---

## 6. 안 B + iOS 확장 시나리오

> 결론부터: **iOS를 추가해도 안 C(모노레포)로 갈 필요가 없습니다.**
> Capacitor는 네이티브 셸을 "플랫폼 폴더"로 추가하는 방식이라, 안 B 구조에서
> 루트에 `ios/`가 하나 늘어나는 것이 전부입니다. `client/`는 3개 플랫폼이 100% 공유합니다.

### 6.1 iOS 추가 후 전체 구조

```
SEAGNAL/
│
├── client/                      ★ 웹·Android·iOS가 100% 공유 (안 B와 동일, 변경 없음)
│   ├── core/
│   │   └── native/              capacitor-plugins.js 등 네이티브 브리지 코드 모음
│   │                            → 플랫폼 분기(Capacitor.getPlatform())가 여기 집중
│   ├── shared/
│   └── features/                (탭 4개 + 횡단 기능, 안 B와 동일)
│
├── server/                      (안 B와 동일, 변경 없음)
│   └── push/                    이미 FCM(firebase-admin) 기반 → iOS도 거의 그대로 사용
│
├── android/                     Android 네이티브 셸
├── ios/                         ★ 신설: npx cap add ios 로 생성되는 iOS 네이티브 셸
│   └── App/App/Info.plist       위치·알림 권한 문구 (Android의 AndroidManifest 대응)
│
├── capacitor.config.json        ← 루트 고정 (아래 6.2 참고)
└── scripts/
    └── build_www.js             (선택) client/ → www/ 복사 — App Store 번들 대응 (6.3)
```

### 6.2 왜 `ios/`는 루트에 두는가 (Capacitor 제약)

- Capacitor는 네이티브 프로젝트 경로를 **`capacitor.config.json`이 있는 위치 기준 `./android`, `./ios`로 고정**합니다. 커스텀 경로 설정을 공식 지원하지 않으므로, `apps/mobile/` 같은 하위 폴더로 옮기면 `cap sync`가 깨집니다.
- 따라서 "네이티브 셸 = 루트의 `android/`, `ios/`" / "공유 웹 코드 = `client/`" / "백엔드 = `server/`" 라는 3분할이 Capacitor 하이브리드 앱의 사실상 표준 구조입니다.

### 6.3 ⚠️ iOS에서 가장 큰 이슈: 원격 로딩과 App Store 심사

현재 `capacitor.config.json`은 `server.url = https://seagnal-server.fly.dev` 로 **모든 UI를 원격에서 로드**합니다. Android(Play Store)는 통과했지만, **Apple 심사는 "웹사이트 래퍼" 성격의 원격 로딩 앱을 거절하는 경우가 많습니다** (최소 기능성 가이드라인 4.2 등).

대응 전략 — 안 B의 `client/` 분리가 정확히 이 토대가 됩니다:

| 전략 | 내용 | 비고 |
|------|------|------|
| ① 번들링 | 빌드 시 `client/` → `www/` 복사 후 `cap sync ios` 로 **앱에 웹 자산을 내장** | 심사 안전. API만 서버 호출 |
| ② 번들 + 라이브 업데이트 | ①에 Capgo/Ionic Appflow 등을 더해 스토어 재심사 없이 웹 자산 갱신 | 현재의 "서버 배포=즉시 반영" 운영감 유지 |
| ③ 원격 로딩 유지 | 지금 방식 그대로 iOS 제출 | 거절 리스크 있음, 비권장 |

- 현재 구조(`local_server/` 안에 서버 코드·크롤러·비밀키까지 혼재)에서는 ①이 불가능하지만(서버 코드가 번들에 딸려 들어감), **안 B로 `client/`를 분리하면 폴더 하나를 복사하는 것으로 번들이 완성**됩니다. → iOS 계획이 있다면 안 B는 선택이 아니라 사실상 전제 조건입니다.
- ①로 가면 Android도 동일하게 번들링으로 통일하는 것을 권장 (오프라인 초기 화면 개선 효과도 있음).

### 6.4 iOS 확장 시 기능별 영향 점검

| 기능 | 현재 상태 | iOS 대응 |
|------|-----------|----------|
| 푸시 알림 | firebase-admin(FCM) 발송 | Firebase 콘솔에 **APNs 키 등록**만 하면 서버 코드 유지. 구독 저장 시 `platform: 'ios'` 필드 추가 권장 |
| 위치기반 경보 | @capacitor-community/background-geolocation | iOS 지원됨. Info.plist에 위치 권한 문구 + Background Modes(location) 필요. iOS는 백그라운드 위치 정책이 엄격 → 심사 대비 사용 사유 문구 중요 |
| 로컬 알림 | @capacitor/local-notifications | iOS 지원됨 |
| safe-area | CSS에서 `env(safe-area-inset-bottom)` 이미 사용 중 | 노치/다이나믹아일랜드 대응 준비됨 ✅ |
| 화면 방향 | @capacitor/screen-orientation | iOS 지원됨 |
| 뒤로가기 | js/backbutton.js (Android 물리키) | iOS는 물리 뒤로가기 없음 → 스와이프 제스처/UI 뒤로가기 확인 필요 |
| WebView | Android WebView 기준 개발 | iOS는 WKWebView — 스크롤/바운스/오디오 자동재생 등 미세 차이 QA 필요 |

### 6.5 플랫폼 분기 코드 배치 규칙

```
원칙: "플랫폼 분기는 core/native/ 에 모으고, feature 코드는 플랫폼을 모른다"

client/core/native/
├── capacitor-plugins.js     이미 isNativePlatform() 분기가 잘 되어 있음 ✅
├── platform.js              (신설 권장) getPlatform() 래퍼 — 'web' | 'android' | 'ios'
└── ...

feature 안에서 분기가 불가피할 때만:
features/push/push_ios.js 처럼 접미사로 구분하고 진입점에서 선택 로드
```

---

## 7. 주의사항 (이 코드베이스 특유의 제약)

1. **script 로드 순서 의존성**: 번들러 없이 `<script>` 태그 순서로 전역 스코프에 로드됨. **파일을 옮겨도 index2.html 내 로드 순서는 절대 바꾸지 말 것** (예: `surfing1→5`, `config→utils→data→render` 순서)
2. **sw.js 위치**: 서비스워커의 scope 규칙 때문에 정적 루트 최상단에 있어야 함. `js/` 안으로 옮기면 안 됨
3. **캐시 버스팅**: `?v=Patch_...` 쿼리와 `bump_cache_version.js`가 경로 문자열에 의존 → 경로 변경 시 함께 수정
4. **서버↔프론트 겸용 파일**: `services/typhoon_radius.js`, `services/typhoon_message.js`는 서버가 require하면서 index2.html도 script로 로드. 이동 시 양쪽 경로 모두 수정 (안 B에서는 `shared/` 또는 심볼릭 유지, 안 C에서는 `packages/typhoon/`)
5. **Fly.io 볼륨 경로**: `data/`, `uploads/` 등 런타임 쓰기 폴더는 볼륨 마운트 경로와 연결 → server_config의 경로 상수 확인 후 이동
6. **git 이력 보존**: 이동은 `git mv`로 수행해야 blame/이력 추적 유지
