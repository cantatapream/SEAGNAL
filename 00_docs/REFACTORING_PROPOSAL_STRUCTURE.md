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
│   │   ├── ui/                      ui_modal
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
│       │   board/ (promo, image_compress)  comments/ (promo_comment1~5)
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

### 대원칙 — 코드 내용 무수정 (기능 보존)

> **리팩토링의 목적은 "파일 배치만 바꾸고 기존 기능에는 어떤 문제도 생기지 않게 하는 것"이다.**

| 원칙 | 내용 |
|------|------|
| 이동 ≠ 수정 | 파일 이동(`git mv`) 시 **파일 내용은 1바이트도 바꾸지 않는다** |
| 유일한 예외 | `index.html`의 `<script src>` 경로와 서버 설정의 경로 상수 — 이동의 물리적 결과일 뿐, 로직 무변경 |
| 단계 격리 | "이동"과 "문서/주석 작업"을 **별도 커밋(별도 Phase)** 으로 분리 — 문제 발생 시 원인 즉시 특정 |
| 주석 = 추가만 | §11 주석 정비 단계에서도 코드 로직은 무변경. **주석 줄 추가만** 허용, diff 검수로 확인 |
| 검증 게이트 | 각 단계 후 스테이징 배포 → 4개 탭 + 푸시 + 위치경보 + AI비서 동작 확인 후 다음 단계 |

```
Phase 0   보안: 서비스 계정 키 rotate + 정적 루트 밖으로 + .gitignore    [즉시]
Phase 1   루트 청소: 리포트/실험파일/옛 Maven → docs/project, archive    [반나절]
Phase 2a  이동만: js/ 기능별 폴더화 (git mv) + index2.html 경로 수정     [1일]
          → 코드 내용 무수정. 배포 검증 게이트 통과 후 다음 단계
Phase 2b  문서만: README/guide/design 생성 + 최상단 설계도면(§12) 작성    [1일]
          → 새 md 파일 추가만. 코드 파일은 건드리지 않음
Phase 2c  주석만: §11 파일 헤더·함수 주석 정비                           [1~2일]
          → 주석 줄 추가만 (diff 에 로직 변경이 없음을 검수)
Phase 3   = 안 B: client/server 분리, staticRoot 변경, 크롤러 → jobs/    [1~2일]
Phase 4   (선택) index.html 탭별 분할, style.css 기능별 분할 — 이 단계만
          파일 내용 수정이 불가피하므로 별도 승인 후 진행
```

> 파일별 상세 배치는 §8, 문서화 규칙은 §9~§10, 주석 표준은 §11, 최상단 설계도면은 §12 참고.

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

---

## 8. 세부 기능 폴더 상세 배치표 (파일 하나하나의 새 주소)

> 원칙: **메인탭 폴더 안에서도 세부 기능마다 폴더를 만든다.**
> 파일이 1개뿐인 기능(예: 갯벌체험)도 반드시 자기 폴더를 가진다 — 폴더가 곧 "기능의 단위"이고,
> README와 향후 추가 파일이 들어갈 자리이기 때문.
>
> 각 폴더에는: 해당 JS 파일들 + `README.md` + (코드가 여러 개면) 파일/모듈별 `<파일명>.guide.md`(§9)
> 아래 트리의 `README.md` 표기는 지면상 대표만 적은 것 — 실제 문서 개수는 §9.1 규칙
> (코드 1개면 README 하나로 통합, 여러 개면 개요 + guide, 분할 모듈은 대표 1개)을 따른다.

### 8.1 core/ — 앱 구동

```
client/core/
├── README.md
├── app_init.js          앱 초기화, 시간 표시, 폰트 크기, 방문자 카운터
├── config.js            전역 설정(CONFIG), 해역 상수, 해역 분류 체계
├── backbutton.js        하드웨어 뒤로가기 버튼 처리 + 팝업 스택 관리
├── auto_refresh.js      주기적 자동 새로고침
├── fix_popup_logic.js   팝업 동작 보정 패치
├── index2_patch.js      런타임 패치 모음
└── native/
    ├── README.md
    └── capacitor-plugins.js   Capacitor 플러그인 브리지 (푸시 토큰, 위치, 알림 권한 등)
```

### 8.2 shared/ — 여러 기능이 공유하는 재료

```
client/shared/
├── ui/
│   ├── README.md
│   └── ui_modal.js            공통 UI 모달 (기상청 iframe, 시스템 모달)
├── utils/
│   ├── README.md
│   ├── utils.js               전역 상태(appState), 날짜/시간 포맷 유틸
│   └── mappings.js            연안바다/평수구역 매핑, 부이 위치·타입 정의
├── geo/                       ★ 해역·좌표 데이터 (현재 local_server 루트에 흩어져 있던 것)
│   ├── README.md
│   ├── seaZones.js  seaZonesData.js  seaZoneCoordinates.js
│   ├── zoneOverlayConfig.js  gridCalibrationData.js  buoyLocations.js
│   └── land_mask_korea.json  marine_zone_area.json
└── tide/                      ★ 조석 계산 (특보탭·해양지도·해양생활이 모두 사용)
    ├── README.md
    └── tide.js  tide_calendar.js  tide_helpers.js  tide_exception.js
```

### 8.3 features/forecast/ — [탭1] 특보 및 전망

```
client/features/forecast/
├── README.md                  탭 전체 개요 (하위 기능 안내)
├── alerts/                    ◆ 해역별 특보 현황
│   ├── README.md
│   ├── data.js                특보 데이터 수집(fetchAllData), 부이 데이터, API 상태
│   ├── render.js              메인 UI 렌더링 (renderApp, createAlertElement)
│   ├── render_coastal.js      연안 구역 렌더링, 부이 데이터 표시
│   ├── zone_avg.js            해역 평균 파고/풍속 모듈
│   ├── alert_history.js       특보 히스토리 팝업 (해역별 통보문 이력)
│   └── marine.js              해구별 기상정보 모달, 해양 차트 렌더링
├── prediction/                ◆ 해역별 특보 예측
│   ├── README.md
│   └── advisory_prediction.js 특보 예측 아코디언 렌더러
├── outlook/                   ◆ 해상 전망
│   ├── README.md
│   ├── forecast.js            해상예보 테이블, 정보 팝업(해구별/특보/조석)
│   ├── marine_forecast.js     기상청 해상 기상 전망 로드/렌더링
│   └── windy.js               Windy 팝업, 상태 카드
└── marine-chart/              ◆ 해상일기도 (서브탭)
    ├── README.md
    ├── marine_chart1.js       카탈로그/상태/DOM 바인딩/드롭다운
    ├── marine_chart2.js       데이터 fetch / 이미지 렌더 / 재생 컨트롤
    ├── marine_chart3.js       전체화면 진입/종료
    ├── marine_chart4.js       전체화면 컨트롤 자동 페이드
    └── marine_chart5.js       전체화면 제스처 (핀치줌·팬·탭)
```

### 8.4 features/ocean-map/ — [탭2] 해양종합정보

```
client/features/ocean-map/
├── README.md
├── map/                       ◆ 지도 코어
│   ├── README.md
│   ├── ocean_map.js           지도 초기화 + 베이스맵 전환 + 기본 인터랙션
│   ├── ocean_markers.js       조석 표준항 마커 + 클릭 처리
│   ├── ocean_overlay.js       해류/바람/파고 캔버스 오버레이 + 파티클 애니메이션
│   └── ocean_northup.js       진북(North Up) 회전 컨트롤
├── bottom-sheet/              ◆ 해점 클릭 바텀시트
│   ├── README.md
│   ├── ocean_bottom_sheet1.js 코어/네임스페이스/진입점/공용 유틸
│   ├── ocean_bottom_sheet2.js 헤더 — 날짜 네비 + 음력 + 토글
│   ├── ocean_bottom_sheet3.js 조석 카드 (TideBED 폴링 + 3모드 렌더)
│   ├── ocean_bottom_sheet4.js 동해 북부 IDW 보간 + 천문 카드
│   ├── ocean_bottom_sheet5.js 6개 일반 카드 + 저질 분석 + 오케스트레이터
│   ├── ocean_bottom_sheet_weather.js  천기 카드 (KMA 단기예보 종합)
│   ├── ocean_bottom_sheet_vsby.js     시정 카드
│   └── ocean_sheet_timeline.js        바텀시트 내부 시간 슬라이더
├── warnings/                  ◆ 지도 위 특보 표시
│   ├── README.md
│   ├── ocean_warn_zone.js     KMA 예특보구역 폴리곤 outline
│   ├── ocean_warn_active1~5.js  활성 특보 색칠 (1:상수 2:계산 3:스타일 4:토글 5:정보박스)
│   └── ocean_warn_vsby.js     특보 카드 시정 뱃지
├── layers/                    ◆ 예측 오버레이 레이어
│   ├── README.md
│   ├── shrt_forecast_layer.js KMA 단기예보(천기) 오버레이
│   ├── vsby_forecast_layer.js KMA RDPS 시정예측 raster 오버레이
│   └── tide_field.js          서해·남해 물빠짐(갯벌 노출) 예측 레이어
├── observation/               ◆ 관측 장비
│   ├── README.md
│   └── ocean_buoy.js          기상부이 + 주요지명 격자 샘플링 레이어
├── cctv/                      ◆ 연안 CCTV
│   ├── README.md
│   ├── cctv1.js               CCTV 제공기관별 데이터 정의
│   ├── cctv4.js               클릭 핸들러 + 모달 + 즐겨찾기
│   └── ocean_cctv.js          지도 CCTV 레이어
└── timeline/                  ◆ 72시간 예측 타임라인
    ├── README.md
    └── ocean_timeline.js      해양현황 타임라인 슬라이더
```

### 8.5 features/marine-life/ — [탭3] 해양생활 (요청하신 세부 기능별 분리)

```
client/features/marine-life/
├── README.md                  탭 개요 + 공통 패턴 설명 (지도형 지수 UI 공통 구조)
├── fishing/                   ◆ 바다낚시
│   ├── README.md
│   └── fishing.js             바다낚시 지수 전체 로직 (지도/마커/바텀시트)
├── surfing/                   ◆ 서핑
│   ├── README.md
│   ├── surfing1.js            기본 구조/상태/지도 초기화/데이터 로드
│   ├── surfing2.js            마커 렌더링/범례/"서핑지수란?" 팝업
│   ├── surfing3.js            팝업 열기/닫기 + 날짜 네비게이션
│   ├── surfing4.js            팝업 콘텐츠 렌더링 (지수 테이블)
│   └── surfing5.js            해상특보 맵 구축 + 특보 HTML 생성
├── swimming/                  ◆ 해수욕 (시즌제)
│   └── README.md              ※ 현재 전용 JS 없음 — 개장기간 안내만 표시.
│                                 향후 해수욕장 지수 로직이 생기면 이 폴더에 추가
├── scuba/                     ◆ 스킨스쿠버
│   ├── README.md
│   └── scuba.js               스킨스쿠버 지수 전체 로직
├── mudflat/                   ◆ 갯벌체험
│   ├── README.md
│   └── mudflat.js             갯벌체험 지수 전체 로직 (지도형)
├── sea-parting/               ◆ 바다갈라짐
│   ├── README.md              (§9.3 에 실제 예시 수록)
│   └── sea_parting.js         바다갈라짐 시간 전체 로직
└── ripcurrent/                ◆ 이안류 (현재 탭 숨김 상태)
    ├── README.md
    └── ripcurrent.js          이안류 지수 전체 로직 (지도형)
```

### 8.6 features/notice/ — [탭4] 공지사항

```
client/features/notice/
├── README.md
├── board/                     ◆ 게시판
│   ├── README.md
│   ├── promo.js               게시판 렌더링/검색/파일첨부/관리자 편집
│   └── image_compress.js      게시글 에디터(Quill) 이미지 자동 압축
└── comments/                  ◆ 댓글 시스템
    ├── README.md
    ├── promo_comment1.js      공통 유틸 (닉네임, 기기ID)
    ├── promo_comment2.js      댓글 렌더링
    ├── promo_comment3.js      등록/수정/삭제
    ├── promo_comment4.js      답글 + 관리자 전용 기능
    └── promo_comment5.js      초기화 진입점 + 새로고침
```

### 8.7 features/ — 횡단 기능 (탭에 속하지 않는 것)

```
client/features/
├── push/                      ◆ 푸시 알림
│   ├── README.md
│   └── alert_push.js          해양특보 알림 관리 모달 (발표/발효/해제/격상/이력)
├── location-alert/            ◆ 위치기반 특보 경보
│   ├── README.md
│   ├── location_alert_core.js        순수 판정 로직 (좌표→해역 매칭)
│   ├── location_alert_background.js  이벤트 기반 위치 수집 (백그라운드)
│   ├── location_alert_runtime.js     깨우는 신호 처리·재동기화
│   └── location_alert_ui.js          동의·활성 UI
├── typhoon/                   ◆ 태풍 (지도 오버레이 + 반경 알림)
│   ├── README.md
│   ├── ocean_typhoon.js               지도 태풍 오버레이 + 재생 애니메이션
│   ├── location_alert_typhoon_runtime.js  태풍 반경 알림 런타임
│   └── (typhoon_radius.js / typhoon_message.js — 서버와 공용, §7-4 참고)
├── assistant/                 ◆ AI 음성 비서
│   ├── README.md
│   ├── assistant.js           음성 비서 프론트 (호출어 + STT + TTS)
│   ├── assistant_deeplink.js  답변 "바로가기" → 해당 지도 레이어 딥링크
│   ├── assistant_overlay.js   백그라운드 비서 상태/대화 오버레이
│   └── memory/
│       ├── README.md
│       ├── user_memory_bridge.js  사용자 기억 v2 — WebView↔네이티브 다리
│       └── user_memory_web.js     사용자 기억 v2 — 웹 IndexedDB 어댑터
├── settings/                  ◆ 설정
│   ├── README.md
│   ├── settings.js            탭 시스템, 사용자 설정, 알림 설정, 위치 검색
│   └── zone_guide.js          관심 해역 설정 유도 팝업 (1회성)
├── engagement/                ◆ 사용자 참여 (제보/설문)
│   ├── README.md
│   ├── report_user.js         사용자 제보 (작성/답변 팝업/차단 확인)
│   └── survey_user.js         설문조사 팝업 (자동 표시/재표시 방지)
└── admin/                     ◆ 관리자 센터
    ├── README.md
    ├── admin.js               통합 관리자 (인증, 대시보드, 특보 관리)
    ├── admin_collect.js       특보 수집 테스트, 방문자 통계 차트
    ├── admin_survey.js        설문조사 탭 (생성/현황/결과분석)
    ├── admin_report.js        제보 관리 + 차단 관리
    ├── admin_trigger.js       관리자 트리거(15회 클릭), 공지/점검 팝업
    ├── admin_location_status.js  "위치 기반" 탭
    ├── advisory_manage_admin.js  특보 관리 → 특보 예측 탭
    ├── pagination_helper.js   관리자 리스트 공용 페이지네이션
    └── cctv7.js               CCTV 위치 편집 도구 (개발용 — index2에 미로드)
```

### 8.8 배치 애매 파일 판정 기록

| 파일 | 판정 | 이유 |
|------|------|------|
| `marine.js` | forecast/alerts/ | 해구별 기상정보 모달 — 특보 현황 화면에서 호출 |
| `windy.js` | forecast/outlook/ | Windy 전망 팝업 — 특보탭 소속 |
| `ocean_warn_vsby.js` | ocean-map/warnings/ | 특보 "카드"에 붙지만 코드가 지도 특보군과 한 몸 |
| `image_compress.js` | notice/board/ | 게시글 에디터 전용 (다른 곳에서 쓰게 되면 shared/ui로 승격) |
| `pagination_helper.js` | admin/ | 관리자 리스트 전용 (동일 — 공용화되면 shared/ui로 승격) |
| `user_memory_*.js` | assistant/memory/ | AI 비서의 사용자 기억 기능 |
| `location_alert_typhoon_runtime.js` | typhoon/ | 위치경보 계열이지만 태풍 도메인이 본질 |
| `run_advisory_render_test.js` + 테스트 json | server/scripts/tests/ | 브라우저 코드 아님 (node 테스트 하네스) |
| `cctv7.js` | admin/ (또는 archive/) | index2.html에 로드되지 않는 편집 도구 |

> 승격 규칙: 한 기능 전용 파일이 나중에 **두 번째 기능에서도 쓰이게 되는 순간** `shared/`로 이동한다. 처음부터 shared에 넣지 않는다 (shared 비대화 방지).

---

## 9. 폴더별 README 문서화 규칙 (초보자용 설명서)

### 9.1 규칙 (문서 3종 — 이름만 봐도 특성이 드러나게)

```
문서 3종의 이름·위치·단위

① README.md            기능 폴더마다 1개 — 폴더 개요 + 파일 목차 + 로드 순서
                        (이 이름을 유지하는 이유: GitHub/GitLab이 폴더를 열면
                         자동으로 본문에 표시해 주는 유일한 파일명)
② <파일명>.guide.md     코드 파일(또는 분할 모듈)마다 1개 — 코드와 같은 폴더에
                        예: sea_parting.js 옆에 sea_parting.guide.md
                        "guide" = 초보자용 사용·구조 설명서라는 특성이 이름에 드러남
③ <주제>.design.md      설계·추진배경·검증 리포트 — 코드와 같은 폴더에
                        예: location_alert.design.md
                        "design" = 왜 이렇게 만들었나(시점 기록)라는 특성이 드러남
                        ※ 설계 문서가 3개 이상으로 많은 기능만 docs/ 폴더로 묶음 (§10)
```

1. **중복 금지 — 문서 개수는 필요한 만큼만**
   - 코드 파일이 1개뿐인 기능: `README.md` 하나로 통합 (폴더 개요 + 파일 설명서 겸용).
     `<파일명>.guide.md`를 따로 만들지 않는다 — 내용이 사실상 같아지기 때문
   - 코드 파일이 여러 개인 기능: `README.md`(짧은 개요+목차) + 파일/모듈별 `<파일명>.guide.md`
   - 분할 모듈(한 몸인 1~5 파일)은 대표 1개: `surfing1~5.js` → `surfing.guide.md`
2. 모든 문서는 **설명 대상 코드와 같은 폴더에** 있어야 한다 (콜로케이션)
3. 설명 대상 독자는 **"이 코드를 처음 보는 사람"** — 용어를 아는 사람 기준으로 쓰지 않는다
4. 파일·함수를 수정하면 **같은 커밋에서 해당 guide도 갱신** (PR 체크리스트 항목화)
5. 탭 폴더 최상위 README(예: `features/marine-life/README.md`)는 하위 기능들의 **목차 + 공통 패턴** 설명
6. 이미 각 JS 파일 머리에 `역할:` 주석이 잘 달려 있으므로, 이것을 guide의 시드(초안)로 활용한다

배치 예시 (문서 개수가 기능 규모에 따라 달라지는 모습):

```
[코드 1개 기능 — 문서도 1개]              [코드 여러 개 기능 — 개요 + 모듈 guide]
features/marine-life/sea-parting/         features/marine-life/surfing/
├── README.md     개요+설명서 통합         ├── README.md        짧은 개요 + 목차
├── sea_parting.js                        ├── surfing1.js ~ surfing5.js
└── sea_parting.design.md  설계(있으면)    └── surfing.guide.md  5개 묶은 설명서

[설계 문서가 많은 기능 — 그때만 docs/]
features/assistant/
├── README.md
├── assistant*.js + assistant.guide.md
└── docs/phases/              ← 설계 이력 80여 개는 폴더로 묶어야 안 어지러움
```

### 9.2 파일별 설명서 표준 템플릿 (`<파일명>.guide.md` — 단일 파일 기능은 README.md에 동일 양식 적용)

```markdown
# <파일명>.js 설명서  `client/features/<탭>/<기능>/<파일명>.js`

## 1. 이 기능은 무엇인가요?
(초보자용 한 문단 — 사용자 입장에서 무엇이 보이고 무엇을 할 수 있는지)

## 2. 화면에서 찾아가는 방법
(예: 하단 메인탭 [해양생활] → 상단 서브탭 [바다갈라짐])

## 3. 파일 구성
| 파일 | 역할 | 로드 순서 |
|------|------|-----------|
(※ 로드 순서는 index.html의 script 순서와 반드시 일치시킬 것)

## 4. 주요 함수 설명
| 함수 | 하는 일 | 입력 | 출력/효과 | 호출하는 곳 |
|------|---------|------|-----------|--------------|

## 5. 데이터 흐름
(사용자 조작 → 함수 → 서버 API → 화면 갱신 순서를 화살표로)

## 6. 연계 파일
- 서버: routes/..., services/...
- 공용: shared/...
- 마크업: index.html 의 #<섹션 id>

## 7. 수정할 때 주의사항
(전역 변수, 로드 순서 의존, 캐시 등 함정 목록)
```

### 9.3 작성 예시 — `features/marine-life/sea-parting/README.md`
(코드 1개 기능이므로 규칙 1에 따라 README에 통합)

```markdown
# sea_parting.js 설명서 (바다갈라짐)  `client/features/marine-life/sea-parting/sea_parting.js`

## 1. 이 기능은 무엇인가요?
진도 신비의 바닷길처럼 썰물 때 바닷길이 열리는 명소들의 "갈라짐 시간표"를
보여주는 기능입니다. 장소를 선택하면 날짜별 갈라짐 시작/종료 시각, 지속
시간, 날씨를 카드로 보여주고, 자주 보는 장소는 즐겨찾기로 저장됩니다.

## 2. 화면에서 찾아가는 방법
하단 메인탭 [해양생활] → 상단 서브탭 [바다갈라짐]

## 3. 파일 구성
| 파일 | 역할 | 로드 순서 |
|------|------|-----------|
| sea_parting.js | 이 기능의 전체 로직 (단일 파일) | surfing 다음, mudflat 이전 |

## 4. 주요 함수 설명
| 함수 | 하는 일 | 입력 | 출력/효과 | 호출하는 곳 |
|------|---------|------|-----------|--------------|
| `_renderDropdown()` | 장소 선택 드롭다운을 만든다 | 없음(내부 데이터) | 드롭다운 DOM 생성 | 초기화 시 |
| `_autoSelectPlace()` | 즐겨찾기/기본 장소를 자동 선택 | 없음 | `_selectPlace()` 호출 | 초기화 시 |
| `_selectPlace(placeName)` | 특정 장소를 선택 상태로 만든다 | 장소 이름 | 데이터 렌더 트리거 | 드롭다운 클릭 |
| `_renderData(placeName, container)` | 갈라짐 시간표 카드를 그린다 | 장소, 컨테이너 | 날짜별 카드 DOM | `_selectPlace()` |
| `_getFavorite()` / `_setFavorite()` | 즐겨찾기 조회/저장 | -/장소 이름 | localStorage 읽기/쓰기 | 별 버튼 클릭 |
| `_openGuidePopup()` / `_closeGuidePopup()` | "바다갈라짐이란?" 안내 팝업 | 없음 | 팝업 표시/닫기 | ⓘ 버튼 |
| `_calcDuration(startStr, endStr)` | 갈라짐 지속 시간 계산 | 시작/종료 시각 | "N시간 M분" 문자열 | `_renderData()` |
| `_getWeatherIcon(weather)` | 날씨 문자열 → 이모지 아이콘 | 날씨 텍스트 | 아이콘 문자 | `_renderData()` |

## 5. 데이터 흐름
[서브탭 클릭] → 초기화 → _renderDropdown() → _autoSelectPlace()
→ _selectPlace("진도") → 서버 API 조회 → _renderData() → 화면에 날짜별 카드
→ (별 클릭) _setFavorite() → 다음 방문 때 _autoSelectPlace()가 그 장소를 먼저 선택

## 6. 연계 파일
- 서버: routes/tide.js (조석/갈라짐 데이터)
- 공용: shared/tide/ (조석 계산), shared/utils/utils.js (날짜 포맷)
- 마크업: index.html 의 #sea-parting-section

## 7. 수정할 때 주의사항
- 모든 함수가 `_` 접두사 내부 함수 — 전역 오염을 막는 클로저 구조이므로
  바깥에서 직접 호출할 수 없음. 진입점만 전역으로 노출됨
- 즐겨찾기는 localStorage 사용 — 키 이름을 바꾸면 기존 사용자 설정이 초기화됨
```

### 9.4 생성 및 유지 전략

| 단계 | 내용 |
|------|------|
| 초안 생성 | Phase 2(폴더 이동) 때 각 파일의 `역할:` 헤더 주석 + 함수 목록을 추출해 **파일/모듈별 `<파일명>.guide.md`** 초안과 폴더 README를 일괄 생성 (Claude로 자동화 가능) |
| 검수 | 기능별로 실제 화면과 대조하며 "찾아가는 방법"과 데이터 흐름 확인 |
| 유지 | PR 템플릿에 "□ 수정한 폴더의 README를 갱신했는가" 체크 항목 추가 |
| 서버 측 | 동일 규칙을 `server/routes/`, `server/services/`, `server/jobs/`에도 적용 (파일 수가 많으므로 폴더 단위 README 1개씩) |

---

## 10. 설계·추진배경 문서의 기능 폴더 배치

### 10.1 현황과 원칙

저장소 전수 조사 결과 설계/배경/이력 문서가 **약 200개**, 4곳에 흩어져 있음:
`00_docs/`(60+), 저장소 루트(3), `docs/`(1), `local_server/knowledge/phases/`(80+), `local_server/analysis/`(30+)

배치 원칙:

```
1. 문서는 "설명 대상 코드"와 같은 폴더로 간다  (콜로케이션)

2. README/guide 와 design 의 역할 구분 (§9.1 문서 3종)
   README.md / <파일명>.guide.md : "지금 코드가 어떻게 생겼나" (입문 설명서 — 항상 최신 유지)
   <주제>.design.md              : "왜 이렇게 만들었나" (설계 배경, 추진 경위, 검증 — 시점 기록)

3. docs/ 폴더는 필수가 아니다 — 설계 문서가 1~2개면 폴더 없이 <주제>.design.md 로
   코드 옆에 바로 놓고, 3개 이상으로 많을 때만 docs/ 폴더로 묶는다
   (예: 어시스턴트 설계 이력 80여 개, 특보 세분화 설계 56개 → docs/ 필요.
    위치기반 경보 설계서 1개 → location_alert.design.md 로 코드 옆에)

4. 기능이 클라이언트+서버에 걸치면 → 주 구현이 있는 쪽에 두고, 반대쪽 README에서 링크

5. 특정 기능에 속하지 않는 문서(리팩토링 로그, 홍보, 배포 절차) → 루트 docs/project/
```

### 10.2 기존 문서 → 새 위치 매핑표

| 현재 위치 | 문서 성격 | 새 위치 |
|-----------|-----------|---------|
| `00_docs/LOCATION_BASED_ALERT_DESIGN.md` | 위치기반 경보 설계 | `client/features/location-alert/location_alert.design.md` (1개 — 폴더 없이 코드 옆) |
| `00_docs/TYPHOON_LOCATION_RADIUS_ENGINE_DESIGN.md` | 태풍 반경 엔진 설계 | `client/features/typhoon/typhoon_radius_engine.design.md` |
| `00_docs/SUBREGION_ALERT/` (로직·데이터모델·운영·구현·감사 56개) | 특보 세분화(자식 통보문) 설계 일체 | `server/advisory/docs/subregion/` (주 구현이 서버 — child_bulletin 등) |
| `SYNTHESIS_Q_REPORT.md` (루트) | 부모 푸시+자식 정보 통합 설계 종합 | `server/push/parent_push_children.design.md` |
| `BOOST_REPORT.md` (루트) | weather_alerts 갱신 안전성 보강 리포트 | `server/jobs/weather_alerts_boost.design.md` |
| `CRITICAL_FIX_REPORT.md` (루트) | 해구별 시간 형식 수정 리포트 | `client/features/forecast/alerts/fmttime_fix.design.md` |
| `docs/MARINE_MMIS_HISTORY.md` | **MMIS 특보 시스템 단일 권위 문서** | `client/features/forecast/alerts/mmis_history.design.md` (탭1 대표 문서) |
| `00_docs/GEOJE_CCTV_CAMERA_LIST.md` + `ongjin_cctv_mapping.csv` | CCTV 카메라 목록/매핑 | `client/features/ocean-map/cctv/` (camera_list.design.md + 매핑 csv) |
| `local_server/analysis/wave_leadtime/` (검증 리포트 30+) | 특보 예측 리드타임 분석 | `server/advisory/analysis/` (기존 구조 유지한 채 이동) |
| `local_server/knowledge/phases/*.md` (설계 80+) | AI 비서 "나리야" 고도화 설계 이력 | `client/features/assistant/docs/phases/` |
| `local_server/knowledge/jikgun/`, `graph/` | ⚠️ 문서가 아니라 **서버 런타임이 읽는 지식 데이터** | `server/knowledge/` 로 유지 (이동 전 gemini_client/topic_embedding 참조 경로 확인 필수) |
| `local_server/scripts/TIDE_FIELD_README.md` | 물빠짐 예측 기능 문서 | `client/features/ocean-map/layers/tide_field.design.md` |
| `local_server/scripts/DEPLOY_CHECKLIST.md` | 배포 절차 | `docs/project/` |
| `00_docs/APP_PROMOTION_GUIDE.md` | 앱 홍보 가이드 | `docs/project/` |
| `00_docs/REFACTORING_*.md` + 본 제안서 | 리팩토링 이력/계획 | `docs/project/refactoring/` |

> ⚠️ `knowledge/` 폴더처럼 **코드가 실제로 읽는 파일**과 순수 문서를 구분할 것.
> 이동 전 `grep -rn "폴더명" server/` 로 참조 여부를 반드시 확인한다.

### 10.3 배치 후 기능 폴더의 완성형

```
client/features/location-alert/               ← "기능의 모든 것이 한 폴더에"
├── README.md                                 폴더 개요 (파일 목차 + 로드 순서)
├── location_alert.design.md                  설계·추진 배경 (1개라서 폴더 없이 코드 옆)
├── location_alert_core.js                    코드 (헤더 주석 표준 §11 적용)
├── location_alert_core.guide.md              ← 파일 설명서 (코드 바로 옆)
├── location_alert_background.js
├── location_alert_background.guide.md
├── location_alert_runtime.js
├── location_alert_runtime.guide.md
├── location_alert_ui.js
└── location_alert_ui.guide.md
```

---

## 11. 코드 주석 표준 (파일 헤더 · 함수 주석 · 연계 명시)

### 11.1 현황 (전수 조사)

| 항목 | 현재 상태 |
|------|-----------|
| 파일 서두 `역할:` 헤더 | 92개 중 **83개 보유** (9개 누락) — 문화가 이미 있음 ✅ |
| 파일 간 `[연계]` 명시 | 92개 중 **31개만 보유** (61개 보강 필요) |
| 함수별 초보자용 주석 | 파일마다 편차 큼 — 표준 없음 |

→ 새로 만드는 규칙이 아니라 **이미 있는 문화를 표준화하고 빈 곳을 채우는 작업**.

### 11.2 파일 헤더 표준 (모든 JS/CSS/HTML 파일 필수)

```javascript
/**
 * ============================================================================
 * 파일명: client/features/marine-life/sea-parting/sea_parting.js
 * 역할  : 바다갈라짐 명소의 갈라짐 시간표 표시 (장소 선택 → 날짜별 카드 렌더링,
 *         즐겨찾기 저장, "바다갈라짐이란?" 안내 팝업)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : shared/tide/tide.js        (조석 계산)
 *                    shared/utils/utils.js      (날짜 포맷 fmtDate)
 *  - 서버 API      : routes/tide.js             GET /api/sea-parting
 *  - 마크업        : index.html                 #sea-parting-section
 *  - 나를 쓰는 곳  : core/app_init.js 가 initSeaParting() 호출 (탭 진입 시)
 * [로드 순서] surfing5.js 다음 · mudflat.js 이전 — 순서 변경 금지
 * [저장소]   localStorage 키: seaparting_favorite (변경 시 사용자 설정 초기화됨)
 * ============================================================================
 */
```

핵심 규칙:
1. `역할:` — **초보자가 읽었을 때 이 파일이 무엇이고 왜 존재하는지 이해되는 1~3줄**
   (전체적인 특성 + 존재 이유 + 개요. 기술 용어만 나열하지 말 것)
2. `[연계]` 4종 세트 필수 — **사용하는 파일 / 서버 API / 마크업 / 나를 쓰는 곳**
   (연계가 없으면 "없음"이라고 적는다 — 빈칸과 "확인 안 함"을 구분하기 위해)
3. `[로드 순서]` — 앞뒤 파일명을 명시 (번들러가 없는 이 앱에서는 생명줄)

### 11.3 함수 주석 표준 (모든 최상위 함수 필수)

```javascript
/**
 * 갈라짐 지속 시간을 계산한다.
 * 예: "09:10" ~ "11:40" → "2시간 30분"
 *
 * @param {string} startStr - 갈라짐 시작 시각 ("HH:MM")
 * @param {string} endStr   - 갈라짐 종료 시각 ("HH:MM")
 * @returns {string} "N시간 M분" 문자열 (계산 불가 시 "-")
 * [연계] ← _renderData() (같은 파일)
 *          날짜 카드의 "지속 시간" 칸을 채워야 해서 카드를 그릴 때마다 이 함수를 부른다
 *        → fmtTime() (shared/utils/utils.js)
 *          "HH:MM" 문자열을 분(分) 숫자로 바꾸는 일은 공용 유틸에 맡긴다
 */
function _calcDuration(startStr, endStr) { ... }
```

핵심 규칙:
1. 첫 줄 = "무엇을 한다" 를 우리말 동사로. 두 번째 줄 = **구체적인 예시** (초보자 이해의 핵심)
2. `@param` / `@returns` — 타입과 형태("HH:MM" 같은 실제 모양)를 함께
3. `[연계]` — 연계 함수가 있으면 **3요소를 전부** 적는다:
   - **누구와**: 상대 함수명 (`←` 나를 부르는 함수 / `→` 내가 부르는 함수)
   - **어디의**: 상대가 다른 파일이면 반드시 파일 경로 명시 (같은 파일이면 "같은 파일")
   - **왜**: 어떤 역할 때문에 연계되는지 한 줄 설명 — "호출한다"가 아니라 "~하기 위해 부른다"
4. 함수 내부 주석은 "왜 이렇게 했는지"가 필요한 곳에만 (한 줄마다 달지 않는다)

### 11.4 적용 및 검증 계획

| 단계 | 내용 |
|------|------|
| Phase 2 통합 | 폴더 이동 시 파일을 한 번씩 만지므로, **이동과 동시에** 헤더를 표준 템플릿으로 정비 (역할 누락 9개 신규 작성, 연계 61개 보강 — Claude 자동화 가능, 사람 검수 필수) |
| 함수 주석 | 기능 폴더 단위로 순차 적용 (README §9 작성과 같은 회차에 — 함수 표를 만들며 주석도 함께) |
| 검증 스크립트 | `server/scripts/check_headers.js` 신설 — 모든 JS의 헤더에 `역할:`·`[연계]` 존재 여부 검사, 누락 파일 목록 출력 (CI/배포 체크리스트에 포함) |
| 유지 | PR 체크리스트: "□ 새/수정 파일에 표준 헤더가 있는가" "□ 연계가 바뀌었으면 헤더의 [연계]도 갱신했는가" |

---

## 12. 최상단 설계도면 — `ARCHITECTURE.md` (저장소 루트)

### 12.1 목적

저장소 **최상단에 설계도면 마크다운 1개**를 두어, 이 파일 하나만 읽으면:
- 앱이 **어떻게 구성되어 있는지** (전체 폴더 트리)
- **어떤 중점 사항(원칙)으로** 정리되어 있는지 (3계층 규칙, 문서 3종, 주석 표준)
- **각 파일이 어떤 특징**을 갖는지 (전체 파일 인덱스)

를 전부 이해할 수 있게 한다. 새 개발자(또는 미래의 나)의 **첫 진입점**이다.

> 본 제안서(§1~§11)는 "계획서"이고, `ARCHITECTURE.md`는 리팩토링 완료 후의
> **"현재 상태 도면"** — Phase 2b에서 §8 배치표를 씨앗으로 생성하며,
> 이후 구조가 바뀔 때마다 함께 갱신한다 (제안서는 docs/project/refactoring/ 에 보존).

### 12.2 필수 구성 (목차 골격)

```markdown
# SEAGNAL 설계도면 (ARCHITECTURE)

## 1. 이 앱은 무엇인가                ← 한 문단: 바다날씨 하이브리드 앱, 4개 메인탭
## 2. 설계 중점 사항 (5가지 원칙)     ← 도면을 읽는 열쇠
   ① 클라이언트/서버/네이티브 3분리 (client/ server/ android/ ios/)
   ② client 는 core/shared/features 3계층 (판단 기준 1줄씩)
   ③ 기능 폴더 = 자기완결 단위 (코드+README/guide+design 콜로케이션)
   ④ 문서 3종 명명 규칙 (README.md / *.guide.md / *.design.md)
   ⑤ 코드 주석 표준 (역할 헤더 + [연계] 4종 + 함수 주석)
## 3. 전체 구조 도면                  ← 루트→기능 폴더까지 전체 트리 (§8 스타일)
## 4. 전체 파일 인덱스               ← 폴더별 표: 파일명 | 한 줄 특징 | 연계
   4.1 client/core        4.2 client/shared       4.3 client/features (탭1~4, 횡단)
   4.5 server (routes/services/advisory/jobs/push)
## 5. 데이터 흐름 한눈에             ← 크롤러→서버 캐시→API→프론트 렌더 (대표 경로 2~3개)
## 6. 규칙 문서 링크                 ← 주석 표준·문서 규칙·배포 체크리스트 위치
## 7. 갱신 규칙                      ← 언제 누가 이 도면을 고치는가
```

### 12.3 "전체 파일 인덱스"의 표 형식 (4장)

```markdown
### client/features/marine-life/sea-parting/
| 파일 | 특징 (한 줄) | 연계 |
|------|--------------|------|
| sea_parting.js | 바다갈라짐 명소 시간표 렌더링 + 즐겨찾기 | ← app_init / → shared/tide, routes/tide.js |
```

- 한 줄 특징은 각 파일 헤더의 `역할:` 첫 줄과 **동일 문구**를 쓴다
  (도면과 코드가 어긋나지 않게 — check_headers.js 가 대조 검증)
- 연계 열은 헤더 `[연계]`의 요약 (← 나를 쓰는 곳 / → 내가 쓰는 것)

### 12.4 유지 규칙

| 시점 | 할 일 |
|------|-------|
| 파일 추가/삭제/이동 | 같은 커밋에서 도면의 트리(3장)와 인덱스(4장) 갱신 |
| 파일 역할이 바뀜 | 헤더 `역할:` 수정 시 인덱스의 한 줄 특징도 동일하게 |
| 검증 | `check_headers.js` 확장: 실제 폴더 구조 ↔ 도면 트리 불일치, 헤더 역할 ↔ 인덱스 문구 불일치 검사 |
| PR 체크리스트 | "□ 구조가 바뀌었으면 ARCHITECTURE.md 도 갱신했는가" |

---

## 13. 구현 순서 권고 및 검증(시뮬레이션) 계획

> 대전제: **재배치로 인한 기능 저하·회귀는 절대 허용되지 않는다.**
> 이를 보장하는 방법은 "조심히 하는 것"이 아니라 **① 이동 전 기준선 기록 → ② 작은 배치로 이동
> → ③ 배치마다 자동 검증 → ④ 기준선과 비교** 라는 기계적 절차다.

### 13.1 검증 4종 세트 (이동을 시작하기 전에 먼저 만든다)

| # | 도구 | 검증 내용 | 회귀 검출 방식 |
|---|------|-----------|----------------|
| V1 | `verify_move.sh` | **이동 무결성**: 모든 파일이 내용 변경 없는 순수 이동인가 | `git diff -M100% --stat` 에 rename 외 항목이 0건, 이동 전후 파일 내용 sha256 전수 일치 |
| V2 | `check_paths.js` | **경로 무결성**: index.html의 모든 `<script src>`·`<link href>`·sw.js 캐시 목록이 실제 파일을 가리키는가 | 존재하지 않는 경로 1건이라도 있으면 실패 (배포 전 404 사전 차단) |
| V3 | `check_order.js` | **로드 순서 무결성**: script 태그의 파일명 나열 순서(경로 제외)가 이동 전과 100% 동일한가 | 이동 전 순서 스냅샷과 diff — 한 줄이라도 어긋나면 실패 |
| V4 | `simulate.spec.js` | **구동 무결성 (시뮬레이션)**: 헤드리스 브라우저(Playwright + Chromium)로 실제 앱을 띄워 작동 확인 | 아래 13.2 |

### 13.2 V4 시뮬레이션 검증의 내용

로컬에서 서버를 기동(`node server.js`)하고 헤드리스 Chromium이 실제 사용자처럼 주행:

```
[검사 항목]
1. 콘솔 에러 0        : ReferenceError/TypeError (전역 함수 누락 = 이동 실패의 전형)
2. 네트워크 404 = 0   : JS/CSS/이미지 로드 실패 없음
3. 전역 심볼 인벤토리  : 이동 전 window 에 노출되던 진입 함수 목록(스냅샷)이
                        이동 후에도 전부 동일하게 존재하는가
4. 시나리오 스모크    : 메인탭 4개 클릭 → 각 섹션 표시 확인
                        해양생활 서브탭 7개 순회 (낚시/서핑/해수욕/스쿠버/갯벌/갈라짐/이안류)
                        해양종합 지도 로드 + 해점 클릭 → 바텀시트 열림
                        특보 카드 렌더링, 해상일기도 이미지 로드, 게시판 목록 로드
```

**핵심 원리 — 기준선(baseline) 비교**: 이동을 시작하기 **전에** 같은 시뮬레이션을 먼저 돌려
결과(콘솔 로그, 404 목록, 전역 함수 목록, 시나리오 통과 여부)를 기준선으로 저장한다.
회귀 판정은 "에러가 있는가"가 아니라 **"기준선에 없던 에러가 새로 생겼는가"** —
원래 있던 경고와 이동이 만든 문제를 구분하는 유일한 방법.

시뮬레이션의 한계(→ 13.4 실기기 검증으로 보완): 푸시 수신, 백그라운드 위치, 음성(STT/TTS),
네이티브 뒤로가기 등 Capacitor 네이티브 기능은 헤드리스 브라우저로 검증 불가.

### 13.3 순차 구현 순서 (권고안)

```
STEP 0  [보안]     키 rotate + 정적 루트 밖 이동 + .gitignore          (코드 무관·독립)
STEP 1  [도구]     검증 4종 세트(V1~V4) 제작 → 이동 전 기준선 기록      ★이동보다 먼저
STEP 2  [무해물]   Phase 1 루트 청소 (문서/실험파일 → docs, archive)
                   └ 앱이 로드하지 않는 파일만 → 시뮬레이션 1회로 무영향 확인
STEP 3  [이동]     Phase 2a 를 7개 배치로 세분 — 작고 독립적인 것부터, 얽힌 것은 나중에:
        배치 ①  notice/       (게시판 — 독립성 최고, 파일 7개)     ← 패턴 확립용
        배치 ②  marine-life/  (단일 파일 기능 6개 + surfing 5)
        배치 ③  admin/ engagement/ settings/ assistant/
        배치 ④  push/ location-alert/ typhoon/                    ← 횡단 기능
        배치 ⑤  forecast/     (탭1)
        배치 ⑥  ocean-map/    (탭2 — 파일 최다·상호 참조 최다)
        배치 ⑦  core/ shared/ (전체가 의존 — 가장 마지막에, 가장 신중히)
        └ 매 배치마다: git mv → index.html 경로 수정 → V1+V2+V3 → V4 시뮬레이션
          → 기준선 대비 차이 0 확인 → 커밋. 차이 발생 시 해당 배치만 revert
STEP 4  [강화검증] ※스테이징 미사용 방침 → 로컬 검증을 강화해 main 직행 안전성 확보
                   verify_all.sh: V2·V3·V4 + 서버 API 스모크 + 이동 JS 경로 200 확인
                   + 92개 JS 파일 내용 해시 이동 전과 100% 동일 전수 대조
STEP 4b [데드코드] 전체 이동 완료 후 미사용 파일·이미지·함수 검출 → 3중 재검토
                   + 독립 에이전트 병렬 교차 검증(만장일치제, 단독 판정 금지)
                   → "확실" 판정만 리스트로 보고, 삭제는 사용자 승인 후 (§14)
STEP 5  [문서]     Phase 2b: README/guide/design + ARCHITECTURE.md    (md 추가만)
STEP 6  [주석]     Phase 2c: 헤더·함수 주석 정비 → diff 검수(주석 줄만) + V4 1회
STEP 7  [분리]     Phase 3: client/server 분리 + staticRoot 변경
                   └ V4에 서버 API 스모크 추가 (routes 32개 대표 엔드포인트 200 확인)
STEP 8  [실기기]   스테이징 URL 을 가리키는 디버그 APK 빌드 → 실기기에서
                   푸시/위치경보/음성비서/뒤로가기 등 네이티브 연동 확인
STEP 9  [전환]     프로덕션 배포 → V4 + 24시간 관찰 → 완료 선언
                   └ 롤백 플랜: 이동은 전부 rename 커밋이므로 revert 한 번으로 원복 가능
```

### 13.4 시뮬레이션 검증을 수행하는 시점 (질문에 대한 직접 답)

| 시점 | 시뮬레이션 | 이유 |
|------|-----------|------|
| STEP 1 (이동 전) | **기준선 기록** | 이것 없이는 회귀를 판정할 수 없음 — 가장 중요 |
| STEP 3 매 배치 후 | 전체 V4 | 문제를 배치 단위로 국소화 (7번 나눠 돌리는 이유) |
| STEP 4 스테이징 후 | 전체 V4 (스테이징 URL 대상) | 로컬과 배포 환경(gzip 빌드, Fly 볼륨) 차이 검출 |
| STEP 6 주석 후 | 1회 | 주석만 추가했어도 기계적 확인 (문자열 안 따옴표 실수 등) |
| STEP 7 분리 후 | 전체 V4 + 서버 스모크 | staticRoot 변경은 영향 범위가 전역 |
| STEP 9 프로덕션 후 | 1회 + 24h 관찰 | 최종 게이트 |

### 13.5 절대 회귀 금지를 위한 규율 요약

1. **기준선 없이 이동 없다** — 비교 대상이 없으면 검증이 아니라 감이다
2. **배치 없이 대량 이동 없다** — 90개를 한 번에 옮기면 무엇이 깨졌는지 못 찾는다
3. **초록불 없이 커밋 없다** — V1~V4 전부 통과해야 그 배치는 완료
4. **rename 아니면 되돌린다** — V1에서 rename 100%가 깨지면 실수로 내용을 건드린 것
5. **네이티브는 실기기다** — 시뮬레이터가 못 보는 것(푸시·위치·음성)은 STEP 8에서 사람이 본다

---

## 14. 데드코드·미사용 자산 검출 계획 (검출 → 3중 재검토 → 권고 → 승인 후 처리)

> 원칙: **검출은 자동, 판정은 3중 재검토, 보고는 "확실"만, 삭제는 사용자 승인 후.**
> 리팩토링 본 작업(이동)과 마찬가지로, 확신 없는 삭제는 회귀의 씨앗이므로
> "의심"은 절대 삭제 권고 리스트에 올리지 않는다.

### 14.1 왜 이 시점인가 (STEP 4b)

배치 이동(STEP 3)에서 어차피 모든 파일의 참조 관계를 전수 확인하므로, 그 과정에서
"어디에서도 참조되지 않는 것"이 자연스럽게 드러난다. 단, **판정은 전체 이동이 끝난
후에만** 한다 — 참조 그래프가 완성되기 전의 판정은 오판 위험이 있다.

### 14.2 1단계 — 자동 검출 (후보 수집): `find_unused.js`

| 대상 | 검출 방법 |
|------|-----------|
| JS 파일 | index.html의 script 태그에도 없고, 서버 require 체인에도 없고, sw.js 캐시 목록에도 없는 파일 |
| 이미지/자산 | 전체 코드(JS·CSS·HTML·manifest·sw.js)에서 파일명 문자열 참조가 0회인 파일 |
| CSS 규칙 | style.css 의 셀렉터가 index.html·JS 생성 DOM 어디에서도 쓰이지 않는 것 (참고 수준 — 위험도 높아 4단계 등급 '보류' 고정) |
| 함수 | 정의됐지만 저장소 전체에서 호출·참조 0회인 전역/내부 함수 |
| 중복 파일 | 내용 해시가 동일한 파일 쌍 (예: serviceAccountKey_Backup.json 같은 사본) |

### 14.3 2단계 — 3중 재검토 (자동 검출을 그대로 믿지 않는다)

번들러 없는 이 앱은 **문자열 참조가 많아 자동 검출의 오탐이 특히 위험**하다.
후보마다 아래 3가지를 순서대로 통과해야 "확실"이 된다:

```
검토 ①  동적 참조 확인 — grep 이 놓치는 참조 방식 전수 점검
        · 문자열 조립 경로: 'images/' + name + '.png', 템플릿 리터럴 `${...}`
        · 동적 함수 호출: window[fnName](), onclick="..." HTML 속성 안 호출
        · 서버가 동적으로 서빙/생성: uploads/, 크롤러 산출물, data/ 캐시
        · 네이티브 참조: AndroidManifest, capacitor.config, 푸시 payload 의 아이콘 경로

검토 ②  연계 코드 확인 — 이 파일/함수와 연계된 코드가 살아 있는지
        · 후보를 참조하는 코드가 있으면 → 그 참조 코드 자체가 데드인지 연쇄 추적
        · 예: cctv7.js(미로드)를 참조하는 admin 코드가 있다면 둘 다 보거나 둘 다 남김

검토 ③  의도 확인 — "아직 안 쓰는 것"과 "더 이상 안 쓰는 것"의 구분
        · 시즌 기능 (해수욕 — 개장기간에만), 숨김 탭 (이안류 display:none)
        · 설계 문서·주석·git 이력에서 "추후", "예정", "Phase" 언급 검색
        · 개발 도구 (cctv7.js 위치 편집기, zone_editor 등 — 데드 아님, 도구임)
```

### 14.4 3단계 — 다중 에이전트 병렬 교차 검증 (단독 판정 금지)

> **핵심 규칙: 어떤 후보도 단일 검토 주체가 혼자 "이상 없음(=데드 확실)"으로
> 속단할 수 없다.** 자동 검출을 수행한 주체와 판정하는 주체를 분리하고,
> 판정은 반드시 복수의 독립 에이전트가 병렬로 수행한다.

```
후보 1건마다:

  [사전] 각 검증 에이전트는 작업 시작 전에 본 설계서(특히 §13.5 회귀 금지
         원칙과 §14.3 3중 재검토 기준)를 읽고, 그 지침에 따라 검토한다

  ┌─ 에이전트 A ─┐  ┌─ 에이전트 B ─┐  ┌─ 에이전트 C ─┐
  │ 관점: 반박자  │  │ 관점: 반박자  │  │ 관점: 반박자  │   ← 3개가 병렬·독립 실행
  │ "이 후보가   │  │ (동적 참조    │  │ (연계·의도    │      서로의 결과를 볼 수 없음
  │  살아있다는  │  │  중심으로     │  │  중심으로     │      (블라인드 — 한 명의 결론이
  │  증거를 찾아 │  │  반박 시도)   │  │  반박 시도)   │       다른 판단을 오염시키지 않게)
  │  라"         │  │               │  │               │
  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
         └────────────── 합의 판정 ──────────────┘
```

합의 규칙:

| 에이전트 판정 결과 | 최종 등급 |
|--------------------|-----------|
| **전원(3/3)이 "데드 확실"** — 아무도 살아있다는 증거를 못 찾음 | ✅ 확실 → 권고 리스트 등재 |
| **1명이라도** "살아있을 가능성" 또는 "판단 불가" | ⚠️ 의심 → 리스트 제외 (반대 근거 기록) |
| 전원이 "살아있음" 확인 | 후보 기각 — 오탐으로 기록 |

- 에이전트의 임무는 "데드임을 확인"이 아니라 **"살아있다는 증거를 찾아 반박하는 것"**
  (기각에 실패했을 때만 데드 — 확증 편향 차단)
- 각 에이전트는 결론과 함께 **검토 경로**(무엇을 grep 했고, 어떤 동적 패턴을 찾아봤는지)를
  제출 — 사람이 검토 과정 자체를 재검증할 수 있게
- 만장일치여도 §14.5 의 격리→관찰 절차는 생략하지 않는다 (에이전트 합의 ≠ 무오류)

### 14.4b 4단계 — 판정 등급과 보고

| 등급 | 기준 | 처리 |
|------|------|------|
| ✅ 확실 (dead) | 3중 검토(§14.3) 기준으로 **독립 에이전트 전원 만장일치**(§14.4) | **권고 리스트에 등재** |
| ⚠️ 의심 (unclear) | 에이전트 1명 이상이 반대/불확실, 또는 동적 참조 가능성 미배제 | 리스트에 올리지 않음. 근거와 함께 별도 참고란에만 기록 |
| ⏸ 보류 (planned) | 시즌·계획·개발 도구 | 데드 아님 — 해당 폴더에 유지, README에 상태 명시 |

보고 형식 — `docs/project/refactoring/DEADCODE_REPORT.md` (에이전트별 판정 병기):

```markdown
| # | 파일/함수 | 종류 | 검출 근거 | 검토① 동적 참조 | 검토② 연계 | 검토③ 의도 | A | B | C | 판정 |
|---|-----------|------|-----------|-----------------|------------|------------|---|---|---|------|
| 1 | images/old_banner.png | 이미지 | 전 코드 참조 0회 | 문자열 조립 패턴 없음 | 없음 | git: 2025-12 교체됨 | 데드 | 데드 | 데드 | ✅ 확실 (3/3) |
| 2 | js/legacy_fn() | 함수 | 호출 0회 | window[fn] 패턴 존재 가능 | - | - | 데드 | 불확실 | 데드 | ⚠️ 의심 (2/3) — 제외 |
```

### 14.5 5단계 — 승인 후에도 바로 삭제하지 않는다 (격리 → 관찰 → 삭제)

```
사용자 승인 → archive/deadcode_YYYYMMDD/ 로 이동 (삭제 아님, git mv)
→ 스테이징 + 프로덕션 1배포 주기(1~2주) 관찰 — 404/에러 로그에 해당 파일 요청이 없는지
→ 이상 없으면 그때 삭제 커밋 (이 커밋도 revert 한 번으로 원복 가능)
```

> 절대 회귀 금지 원칙(§13.5)은 데드코드 정리에도 동일하게 적용된다:
> "확실하지 않으면 남긴다. 확실해도 격리 먼저, 삭제는 마지막."

---

## 15. 향후 개발 지침 — `DEVELOPMENT_GUIDE.md` (저장소 루트, 독립 문서)

### 15.1 목적과 사용 방식

리팩토링은 "한 번 정리하고 끝"이 아니다. **이후에 추가·수정되는 모든 코드가 이 구조와
지침을 따라야** 구조가 다시 무너지지 않는다. 이를 위해 지침을 **설계도면(ARCHITECTURE.md)
과는 완전히 별개의 독립 파일**로 저장소 최상위(루트)에 둔다. 처음 저장소를 여는 사람이
"아, 코드는 이 지침에 따라 만들어지는구나"를 바로 인지할 수 있도록, 루트에 안내판
역할의 README.md 까지 포함한 **3문서 체계**를 갖춘다:

```
SEAGNAL/                   ← 저장소를 열면 가장 먼저 보이는 최상위
├── README.md              ① 입구 안내판 — 이 앱이 무엇인지 3줄 +
│                             "구조가 궁금하면 → ARCHITECTURE.md
│                              코드를 추가·수정하려면 → DEVELOPMENT_GUIDE.md 필독"
│                             (GitHub 이 저장소 첫 화면에 자동으로 표시하는 파일)
├── ARCHITECTURE.md        ② 설계도면 — "지금 어떻게 생겼나" (§12)
├── DEVELOPMENT_GUIDE.md   ③ 개발지침 — "앞으로 어떻게 만들어야 하나" (본 절) ★
├── CLAUDE.md              AI 용 자동 진입점 — "코드 작성 전 ③ 필독" 1줄
└── ...
```

②와 ③을 별개 파일로 두는 이유 — 성격과 갱신 주기가 다르다:
- ② 는 **현재 상태의 기록** → 구조가 바뀔 때마다 갱신 (자주)
- ③ 은 **행동 규칙** → 원칙 변경 시에만 사용자 승인 하에 갱신 (드묾)

따라서 새 코드 작업 지시는 "**DEVELOPMENT_GUIDE.md 를 읽고 지침에 따라 작성하라**"
한 문장으로 충분하며, ③이 필요로 하는 현재 구조 정보(어떤 폴더가 있는지 등)는
③ 안의 링크를 따라 ②에서 얻는다.

**사용 방식 (문서 서두에 명시할 문구):**

> 이 저장소에 코드를 추가하거나 수정하는 모든 작업자(사람·AI)는
> **작업 시작 전에 이 문서 전체를 읽고**, 아래 절차와 체크리스트에 따라 작업한다.
> 이 지침을 따르지 않은 코드는 구조에 반영하지 않는다.

- 사용자는 새 기능 개발을 지시할 때 "**DEVELOPMENT_GUIDE.md 를 읽고 지침에 따라
  생성하라**" 한 문장으로 지시할 수 있어야 한다 — 지침의 완결성이 곧 지시의 간결성
- (권장) 저장소 루트 `CLAUDE.md` 에 "코드 작성 전 DEVELOPMENT_GUIDE.md 를 읽을 것"을
  명시 — Claude Code 는 CLAUDE.md 를 자동으로 읽으므로 지침 누락을 구조적으로 방지

### 15.2 문서 구성 (독립 문서의 목차 골격)

```markdown
# SEAGNAL 개발지침 (DEVELOPMENT GUIDE)

## 0. 이 문서를 읽는 법
   — 새 기능 추가면 1장부터, 기존 코드 수정이면 5장부터

## 1. 새 코드의 자리 찾기 (배치 결정 트리)
   Q1. 없으면 앱이 안 뜨는 코드인가?            → client/core/
   Q2. 두 개 이상의 기능이 함께 쓰는 재료인가?   → client/shared/<성격>/
   Q3. 4개 메인탭 중 하나의 화면 기능인가?       → client/features/<탭>/<기능>/ 신규 폴더
   Q4. 탭에 속하지 않는 독립 기능인가?           → client/features/<기능>/ 신규 폴더
   Q5. 서버 코드인가?                            → server/routes|services|jobs/
   ※ 기존 기능의 확장이면 새 폴더가 아니라 해당 기능 폴더 안에 추가

## 2. 기능 폴더 만들기 (신규 기능일 때)
   — 폴더명 규칙(영문 소문자-하이픈), 필수 구성물:
     코드 + README.md (+ 코드 여러 개면 *.guide.md) (+ 설계했다면 *.design.md)

## 3. 코드 작성 규칙
   — 파일 헤더 표준(역할·[연계] 4종·[로드 순서]) : ARCHITECTURE §규칙 링크
   — 함수 주석 표준(설명+예시+@param/@returns+[연계] 3요소: 누구와/어디의/왜)
   — 초보자 가독성 원칙: 용어를 아는 사람 기준으로 쓰지 않는다
   — index.html 로드 순서 등록 위치 결정 규칙 (의존하는 파일 뒤, 나를 쓰는 파일 앞)

## 4. 문서 작성 (코드와 같은 커밋에서)
   — README.md / <파일명>.guide.md 템플릿 (§9 양식 수록)
   — 설계 배경이 있으면 <주제>.design.md

## 5. 기존 코드 수정 시
   — 헤더의 역할·[연계]가 바뀌면 헤더도 같은 커밋에서 갱신
   — 해당 guide/README 의 함수 표·데이터 흐름 갱신
   — 로드 순서를 바꿔야 한다면: 바꾸기 전에 [로드 순서] 주석의 앞뒤 파일 확인 필수

## 6. 마무리 — 설계도면 갱신 (생략 불가)
   — ARCHITECTURE.md 3장(트리)·4장(파일 인덱스)에 새 파일 등재
   — 인덱스의 "한 줄 특징"은 파일 헤더 역할: 첫 줄과 동일 문구
   — check_headers.js 실행으로 도면↔코드 일치 확인

## 7. 검증
   — V2(경로)·V3(로드 순서)·V4(시뮬레이션) 통과 후 커밋
   — 기능 추가 시 V4 시나리오에 새 기능의 스모크 1개 추가

## 8. 최종 체크리스트 (커밋 전 전부 ☑ 되어야 함)
   □ 배치 결정 트리로 자리를 정했다        □ 파일 헤더 표준 적용
   □ 함수 주석(왜-연계 포함) 작성          □ README/guide 작성·갱신
   □ index.html 로드 순서 등록·확인        □ ARCHITECTURE.md 갱신
   □ V2·V3·V4 통과                          □ 문서와 코드가 같은 커밋
```

### 15.3 작동 예시 — "A 기능"이 새로 추가된다면

예: 해양생활 탭에 "요트" 지수 기능을 추가하는 경우, 지침에 따라 자동으로 이렇게 흘러간다:

```
1장 결정 트리 → Q3 해당 (해양생활 탭의 화면 기능)
   → client/features/marine-life/yacht/ 신규 폴더

2장 폴더 구성 → yacht.js + README.md (파일 1개이므로 guide 통합, §9.1 규칙)
   → 설계 논의가 있었다면 yacht.design.md 도 함께

3장 코드 작성 → yacht.js 헤더: 역할("요트 지수를 지도에…") + [연계]
   (→ shared/geo, routes/fishing.js API / ← app_init) + [로드 순서]
   → 모든 함수에 왜-연계 주석
   → index.html: scuba 로드 뒤에 script 등록 (같은 패턴 기능 뒤)

6장 도면 갱신 → ARCHITECTURE.md 트리에 yacht/ 추가,
   파일 인덱스에 "yacht.js | 요트 지수를 지도에… | ← app_init / → shared/geo" 등재

7장 검증 → V2·V3 통과, V4에 "요트 서브탭 클릭 → 지도 로드" 스모크 추가

8장 체크리스트 전부 ☑ → 커밋 (코드+문서+도면이 한 커밋)
```

→ 기능 추가가 "코드만 던져놓고 끝"이 될 수 없는 구조:
**자리 결정 → 코드 → 문서 → 도면 → 검증이 하나의 사슬**이며, 어느 고리를 빼먹으면
체크리스트와 check_headers.js 가 걸러낸다.

### 15.4 생성 시점과 유지

| 항목 | 내용 |
|------|------|
| 생성 시점 | Phase 2b — 루트 3문서(README·ARCHITECTURE·DEVELOPMENT_GUIDE)와 CLAUDE.md 를 같은 시점에 생성. §9~§12 의 규칙·템플릿을 실제 경로 기준으로 옮겨 담아 독립 문서화 |
| 관계 | 본 제안서(계획) → ARCHITECTURE.md(현재 도면) + DEVELOPMENT_GUIDE.md(미래 규칙) 로 역할 분리 |
| 유지 | 지침 자체를 바꿀 때는 반드시 사용자 승인 (구조 원칙의 변경이므로) |
| CLAUDE.md | 루트 CLAUDE.md 에 ① "코드 작성·수정 전 DEVELOPMENT_GUIDE.md 필독" 지시 + ② **핵심 규칙 요약 병기**(배치 결정 트리 5문항 + 8항목 체크리스트 축약본) — CLAUDE.md 는 세션 시작 시 자동 주입되므로, 만에 하나 가이드 원문을 읽지 않아도 핵심 규칙이 이미 컨텍스트에 존재하게 하는 이중 안전장치. 최후의 그물망은 check_headers.js·V2~V4 (지침 준수를 성실성이 아닌 기계 검증으로 보장) |

---

## 16. 실행 기록 (2026-07-13)

계획 대비 실제 실행 결과 요약. 상세는 각 커밋 메시지 참고.

| 계획 | 실행 결과 |
|------|-----------|
| STEP 0 보안 | ✅ 키 3종 → secrets/ (git 미추적). 구 URL 404 확인. 키 rotate 는 사용자 후속 조치 |
| STEP 1 도구·기준선 | ✅ V1~V4 + verify_all/check_comment_only/find_unused/gen_* 제작, 기준선 11/11 |
| STEP 2 루트 청소 | ✅ 옛 Maven·실험파일·중복 이미지 94파일 → archive/, docs/project/ |
| STEP 3 이동 7배치 | ✅ js/ 90파일 기능별 폴더화. 92개 JS 내용 해시 이동 전과 100% 동일 |
| STEP 4 검증 | ✅ 스테이징 미사용 방침 → verify_all 강화 검증으로 대체 |
| STEP 4b 데드코드 | ✅ 3인 에이전트 만장일치 2건만 격리(964KB). JS 후보 4건은 전원 '데드 아님' |
| STEP 5 문서 | ✅ 루트 4문서 + 폴더 README 30 + 설계문서 콜로케이션 5 |
| STEP 6 주석 | ✅ 역할 92/92 · [연계] 92/92. check_comment_only 로 로직 무변경 보증 |
| STEP 7 분리 | ✅ **변형 실행**: 안 B 의 server/ 개명 대신 **local_server 유지** (사용자 선택 ①) |

### STEP 7 변형 사유와 결과

- fly.toml 볼륨 마운트가 `/app/local_server/data` 고정 → 개명 시 배포 검증 불가 위험
- 따라서 브라우저 자산만 `client/` 로 분리, 서버는 `local_server/` 유지 (볼륨·start 무변경)
- 부수 보안 개선: 이전에는 routes/services/scheduler 등 **서버 소스 전체가 정적 서빙**되어
  다운로드 가능했음 → 분리 후 서버 코드 404 (services 공용 모듈 2종만 명시적 알리아스)
- URL 무변경 원칙: 디스크 배치만 바뀌고 모든 URL 동일 → 시뮬레이션 기준선 그대로 유효

### 남은 사용자 액션 (자동 배포 환경 기준 — deploy.yml 이 main push 시 자동 배포)

⚠️ **머지 = 자동 배포** 이므로, 머지 전에 ①②를 먼저 완료해야 푸시 알림이 유지된다.

1. **GitHub Secrets 등록 (머지 전 필수)** — 저장소 Settings → Secrets and variables
   → Actions → New repository secret:
   - `FIREBASE_SERVICE_ACCOUNT`: Firebase 콘솔에서 **새로 발급**한 키 JSON 내용 붙여넣기
     (새 키 발급 + 콘솔에서 옛 키 삭제 = 키 rotate 도 이때 함께 완료)
   - `GCS_BACKUP_SERVICE_ACCOUNT`: 백업용 키 JSON (git 과거 커밋에서 복사 가능,
     추후 GCP 콘솔에서 rotate 권장)
2. deploy.yml 의 키 주입 단계가 이 시크릿을 배포 시점에 secrets/ 로 생성 (코드 반영됨)
3. main 머지 → 자동 배포 → 배포 로그에서 "✅ serviceAccountKey.json 생성" 확인
4. 배포 후: /server.js 가 404 인지 확인(보안 적용 증거) + 실기기 푸시 1건 테스트
5. archive/deadcode_20260713 은 1~2주 관찰 후 삭제
