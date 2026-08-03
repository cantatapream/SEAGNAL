# SEAGNAL 설계도면 (ARCHITECTURE)

> 이 문서 하나로 앱의 전체 구조·중점 원칙·각 파일의 특징을 파악할 수 있습니다.
> 자동 생성: `node scripts/refactor/gen_architecture.js > ARCHITECTURE.md` (구조 변경 시 재생성)
> 마지막 생성 기준: 프론트 JS 97개 · 코드 추가·수정 규칙은 `DEVELOPMENT_GUIDE.md` 참고.

---

## 1. 이 앱은 무엇인가

SEAGNAL(바다날씨)은 해양 기상특보·해양종합정보·해양생활·공지를 제공하는
**하이브리드 모바일 앱**(Capacitor + 웹)입니다. 하단 4개 메인탭으로 구성됩니다:
특보 및 전망 · 해양종합정보 · 해양생활 · 공지사항.

## 2. 설계 중점 사항 (5원칙)

1. **3분리**: `client/`(브라우저 — 정적 서빙 루트) · `local_server/`(Node 서버 전용) ·
   `android/·ios/`(네이티브 셸). ※ STEP 7 완료 — 서버 코드는 더 이상 정적 서빙되지 않음.
2. **client 3계층**: `core/`(구동) · `shared/`(공용) · `features/`(기능).
   판단 — 없으면 앱이 안 뜨면 core, 여럿이 쓰면 shared, 하나의 기능이면 features.
3. **기능 폴더 = 자기완결 단위**: 코드 + README + (필요 시) guide/design 콜로케이션.
4. **문서 3종**: `README.md`(개요) · `<파일>.guide.md`(설명서) · `<주제>.design.md`(설계배경).
5. **주석 표준**: 파일 헤더(역할 + [연계] 4종 + 로드순서) + 함수 주석(설명+예시+연계).

## 3. 전체 구조 도면 (프론트 js/)

```
client/js/
├── admin/  ← ⚡ 관리자 센터
│   ├── admin_collect.js
│   ├── admin_location_status.js
│   ├── admin_report.js
│   ├── admin_survey.js
│   ├── admin_trigger.js
│   ├── admin.js
│   ├── advisory_manage_admin.js
│   ├── cctv7.js
│   └── pagination_helper.js
├── ai-chat/
│   └── ai_chat.js
├── assistant/  ← ⚡ AI 음성비서
│   ├── memory/
│   │   ├── user_memory_bridge.js
│   │   └── user_memory_web.js
│   ├── assistant_deeplink.js
│   ├── assistant_overlay.js
│   └── assistant.js
├── core/  ← 앱 구동(부트스트랩·설정·네이티브 브리지)
│   ├── app_init.js
│   ├── backbutton.js
│   ├── config.js
│   └── index2_patch.js
├── engagement/  ← ⚡ 제보·설문
│   ├── report_user.js
│   └── survey_user.js
├── forecast/  ← [탭1] 특보 및 전망
│   ├── alerts/
│   │   ├── alert_history.js
│   │   ├── data.js
│   │   ├── marine.js
│   │   ├── render_coastal.js
│   │   ├── render.js
│   │   └── zone_avg.js
│   ├── marine-chart/
│   │   ├── marine_chart1.js
│   │   ├── marine_chart2.js
│   │   ├── marine_chart3.js
│   │   ├── marine_chart4.js
│   │   └── marine_chart5.js
│   ├── outlook/
│   │   ├── forecast.js
│   │   ├── marine_forecast.js
│   │   └── windy.js
│   └── prediction/
│       ├── advisory_prediction.js
│       └── run_advisory_render_test.js
├── location-alert/  ← ⚡ 위치기반 경보
│   ├── location_alert_background.js
│   ├── location_alert_core.js
│   ├── location_alert_runtime.js
│   └── location_alert_ui.js
├── marine-life/  ← [탭3] 해양생활
│   ├── fishing/
│   │   └── fishing.js
│   ├── mudflat/
│   │   └── mudflat.js
│   ├── ripcurrent/
│   │   └── ripcurrent.js
│   ├── safety/
│   │   ├── access_control.js
│   │   ├── fishing_ban.js
│   │   ├── hazard_rocks.js
│   │   └── life_safety.js
│   ├── scuba/
│   │   └── scuba.js
│   ├── sea-parting/
│   │   └── sea_parting.js
│   └── surfing/
│       ├── surfing1.js
│       ├── surfing2.js
│       ├── surfing3.js
│       ├── surfing4.js
│       └── surfing5.js
├── notice/  ← [탭4] 공지사항
│   ├── board/
│   │   ├── image_compress.js
│   │   └── promo.js
│   └── comments/
│       ├── promo_comment1.js
│       ├── promo_comment2.js
│       ├── promo_comment3.js
│       ├── promo_comment4.js
│       └── promo_comment5.js
├── ocean-map/  ← [탭2] 해양종합정보
│   ├── bottom-sheet/
│   │   ├── ocean_bottom_sheet_vsby.js
│   │   ├── ocean_bottom_sheet_weather.js
│   │   ├── ocean_bottom_sheet1.js
│   │   ├── ocean_bottom_sheet2.js
│   │   ├── ocean_bottom_sheet3.js
│   │   ├── ocean_bottom_sheet4.js
│   │   ├── ocean_bottom_sheet5.js
│   │   └── ocean_sheet_timeline.js
│   ├── cctv/
│   │   ├── cctv1.js
│   │   ├── cctv4.js
│   │   └── ocean_cctv.js
│   ├── layers/
│   │   ├── shrt_forecast_layer.js
│   │   ├── tide_field.js
│   │   └── vsby_forecast_layer.js
│   ├── map/
│   │   ├── ocean_map.js
│   │   ├── ocean_markers.js
│   │   ├── ocean_northup.js
│   │   └── ocean_overlay.js
│   ├── observation/
│   │   └── ocean_buoy.js
│   ├── timeline/
│   │   └── ocean_timeline.js
│   └── warnings/
│       ├── ocean_warn_active1.js
│       ├── ocean_warn_active2.js
│       ├── ocean_warn_active3.js
│       ├── ocean_warn_active4.js
│       ├── ocean_warn_active5.js
│       ├── ocean_warn_vsby.js
│       └── ocean_warn_zone.js
├── push/  ← ⚡ 푸시 알림
│   └── alert_push.js
├── settings/  ← ⚡ 설정
│   ├── settings.js
│   └── zone_guide.js
├── shared/  ← 공용 재료(유틸·UI·데이터)
│   ├── ui/
│   │   └── ui_modal.js
│   └── utils/
│       ├── mappings.js
│       └── utils.js
└── typhoon/  ← ⚡ 태풍
    ├── location_alert_typhoon_runtime.js
    └── ocean_typhoon.js
```

## 4. 전체 파일 인덱스

> "역할" 문구는 각 파일 헤더의 `역할:` 첫 줄과 동일 — 코드와 도면이 어긋나면 check_headers 가 잡음.

### `client/js/admin/`

| 파일 | 역할 |
|------|------|
| `admin.js` | 통합 관리자 시스템 (인증, 대시보드, 특보 관리) |
| `admin_collect.js` | 특보 수집 테스트, 결과 팝업, 방문자 통계 차트 |
| `admin_location_status.js` | 관리자 센터 "위치 기반" 탭 — 이 기기가 수집·저장한 최신 GPS 위치 표시 |
| `admin_report.js` | 관리자 제보 관리 + 차단 관리 UI |
| `admin_survey.js` | 통합 관리자 센터 - 설문조사 탭 UI (생성/현황/결과분석/이력관리) |
| `admin_trigger.js` | 관리자 트리거(15회 클릭), 공지/점검/오류 팝업 |
| `advisory_manage_admin.js` | 관리자 "특보 관리 → 특보 예측" 운영 UI (청중 모드 토글·예측 목록 관리) |
| `cctv7.js` | 마커 좌표가 잘못된 경우 지도 상에서 직접 위치를 교정합니다. |
| `pagination_helper.js` | 관리자 리스트 화면용 공용 페이지네이션 UI helper |

### `client/js/ai-chat/`

| 파일 | 역할 |
|------|------|
| `ai_chat.js` | 해양법령 챗봇(나리야) 인앱 모듈. 두 갈래로 나뉜다. |

### `client/js/assistant/`

| 파일 | 역할 |
|------|------|
| `assistant.js` | SEAGNAL 음성 비서 프론트엔드 (호출어 "누구야" + STT + TTS + 텍스트 폴백) |
| `assistant_deeplink.js` | AI 비서 답변의 "바로가기" 버튼 → 해양종합정보 페이지의 해당 레이어를 |
| `assistant_overlay.js` | 백그라운드 "나리야" 음성 비서의 상태/대화를 앱 화면에 동적 오버레이로 표시. |

### `client/js/assistant/memory/`

| 파일 | 역할 |
|------|------|
| `user_memory_bridge.js` | 사용자 기억 v2 — E3 통합 다리. 채팅(WebView) ↔ 자바 Plugin/IndexedDB 의 |
| `user_memory_web.js` | SEAGNAL 사용자 기억 v2 — 웹(브라우저) 측 IndexedDB 어댑터 (E2 트랙) |

### `client/js/core/`

| 파일 | 역할 |
|------|------|
| `app_init.js` | 앱 초기화, 시간 표시, 폰트 크기, 헤더 새로고침, 방문자 카운터 |
| `backbutton.js` | 하드웨어 뒤로가기 버튼 처리 + 팝업 스택 관리 |
| `config.js` | 전역 설정(CONFIG), 해역 상수, 윈디 매핑, 해역 분류 체계 |
| `index2_patch.js` | 1. 하단 탭 바 구조에 맞춰 탭 그룹 매핑 데이터를 오버라이드 |

### `client/js/engagement/`

| 파일 | 역할 |
|------|------|
| `report_user.js` | 사용자 제보 기능 (제보 작성, 답변 팝업, 차단 상태 확인) |
| `survey_user.js` | 사용자 설문조사 팝업 (앱 접속 시 자동 표시, 완료 시 재표시 방지) |

### `client/js/forecast/alerts/`

| 파일 | 역할 |
|------|------|
| `alert_history.js` | 특보 히스토리 팝업 모달 (해역별 통보문 이력 조회) |
| `data.js` | 데이터 수집(fetchAllData), 부이 데이터, API 상태 관리 |
| `marine.js` | 해구별 기상정보 모달, 해양 차트 렌더링 |
| `render.js` | 메인 UI 렌더링 (renderApp, createAlertElement) |
| `render_coastal.js` | 연안 구역 렌더링, 부이 데이터 표시, 로딩/시간 업데이트 |
| `zone_avg.js` | 특보구역별로 매핑된 대해구의 3시간 예보 wh/ws 평균을 계산해 노란 점선 박스 생성 |

### `client/js/forecast/marine-chart/`

| 파일 | 역할 |
|------|------|
| `marine_chart1.js` | 해상일기도(KMA 날씨누리) — 카탈로그/상태/DOM 바인딩/드롭다운 |
| `marine_chart2.js` | 해상일기도 — 데이터 fetch / 이미지 render / 시간 점프 / 재생 컨트롤 |
| `marine_chart3.js` | 해상일기도 — 전체화면 진입/종료 (SEAGNAL 통합 PopupStack 패턴) |
| `marine_chart4.js` | 해상일기도 — 전체화면 컨트롤 자동 페이드 (동영상 플레이어 패턴) |
| `marine_chart5.js` | 해상일기도 — 전체화면 제스처 (핀치줌·팬·탭 토글) |

### `client/js/forecast/outlook/`

| 파일 | 역할 |
|------|------|
| `forecast.js` | 해상예보 테이블, 정보 팝업(해구별/특보/조석) |
| `marine_forecast.js` | 기상청 해상 기상 전망 데이터 로드 및 렌더링 |
| `windy.js` | Windy 팝업, 상태 카드 시스템 |

### `client/js/forecast/prediction/`

| 파일 | 역할 |
|------|------|
| `advisory_prediction.js` | "해역별 특보 예측" 아코디언 렌더러. |
| `run_advisory_render_test.js` | node 렌더 테스트 하네스 — advisory_prediction(v6) 렌더 함수 검증 (브라우저 불필요) |

### `client/js/location-alert/`

| 파일 | 역할 |
|------|------|
| `location_alert_background.js` | 위치기반 특보: 이벤트 기반 위치 수집 (② 단계) |
| `location_alert_core.js` | 위치 기반 해상특보 안전 경보: 순수 지오/문구 계산 로직 (외부 의존 없음) |
| `location_alert_runtime.js` | 위치기반 특보: 깨우는 신호 처리·경고 표시 (② 단계) |
| `location_alert_ui.js` | 위치 기반 기상 정보 제공: 동의·활성 UI (③ 단계) |

### `client/js/marine-life/fishing/`

| 파일 | 역할 |
|------|------|
| `fishing.js` | 바다낚시 지수 프론트엔드 전체 로직 |

### `client/js/marine-life/mudflat/`

| 파일 | 역할 |
|------|------|
| `mudflat.js` | 갯벌체험 지수 프론트엔드 전체 로직 (지도형 — 바다낚시/스킨스쿠버 방식) |

### `client/js/marine-life/ripcurrent/`

| 파일 | 역할 |
|------|------|
| `ripcurrent.js` | 이안류 지수 프론트엔드 전체 로직 (지도형 — 스킨스쿠버 방식) |

### `client/js/marine-life/safety/`

| 파일 | 역할 |
|------|------|
| `access_control.js` | 해양안전 지도에 "출입통제" 토글 버튼을 얹어, 연안사고 예방에 관한 |
| `fishing_ban.js` | 해양안전 지도에 "낚시금지" 토글 버튼을 얹어, 낚시 관리 및 육성법 |
| `hazard_rocks.js` | 해양안전 지도에 "노출암" / "간출암 등" 두 토글 버튼을 얹는다. 항상 |
| `life_safety.js` | "해양안전생활" 화면 — 하단 해양생활 탭을 10번 연달아 누르면 열리는 시험용 화면. |

### `client/js/marine-life/scuba/`

| 파일 | 역할 |
|------|------|
| `scuba.js` | 스킨스쿠버 지수 프론트엔드 전체 로직 |

### `client/js/marine-life/sea-parting/`

| 파일 | 역할 |
|------|------|
| `sea_parting.js` | 바다갈라짐(썰물 때 바닷길이 열리는 명소)의 갈라짐 시간표를 보여준다. |

### `client/js/marine-life/surfing/`

| 파일 | 역할 |
|------|------|
| `surfing1.js` | 서핑지수 프론트엔드 - 기본 구조 / 상태 / 지도 초기화 / 데이터 로드 / 유틸함수 |
| `surfing2.js` | 서핑지수 프론트엔드 - 마커 렌더링 / 범례 / "서핑지수란?" 버튼+팝업 |
| `surfing3.js` | 서핑지수 프론트엔드 - 팝업 열기/닫기 + 이벤트 바인딩 + 날짜 네비게이션 |
| `surfing4.js` | 서핑지수 프론트엔드 - 팝업 콘텐츠 렌더링 (서핑지수 테이블 + 상세정보) |
| `surfing5.js` | 서핑지수 프론트엔드 - 해상특보 맵 구축 + 해상특보 HTML 생성 |

### `client/js/notice/board/`

| 파일 | 역할 |
|------|------|
| `image_compress.js` | 관리자 게시글 에디터(Quill) 의 이미지 자동 압축 유틸리티 |
| `promo.js` | 홍보 게시판 (렌더링, 검색, 파일첨부, 관리자 편집) |

### `client/js/notice/comments/`

| 파일 | 역할 |
|------|------|
| `promo_comment1.js` | 게시글 댓글 시스템 - 공통 유틸리티 (닉네임, 기기ID, 헬퍼) |
| `promo_comment2.js` | 게시글 댓글 시스템 - 댓글 렌더링 (화면 표시) |
| `promo_comment3.js` | 게시글 댓글 시스템 - 댓글 등록/수정/삭제 (사용자 액션) |
| `promo_comment4.js` | 게시글 댓글 시스템 - 답글 입력 및 관리자 전용 기능 (원문 보기) |
| `promo_comment5.js` | 게시글 댓글 시스템 - 댓글 섹션 초기화 진입점 및 새로고침 |

### `client/js/ocean-map/bottom-sheet/`

| 파일 | 역할 |
|------|------|
| `ocean_bottom_sheet1.js` | 해양종합정보 바텀시트 — 코어/네임스페이스/진입점/공용 유틸 |
| `ocean_bottom_sheet2.js` | 바텀시트 헤더 — 날짜 네비게이션 + 음력 표시 + 📍 토글 + ✕ 닫기 |
| `ocean_bottom_sheet3.js` | 바텀시트 조석 카드 — TideBED 폴링 + 3모드 렌더링(loading/error/detail) |
| `ocean_bottom_sheet4.js` | 동해 북부(36°N+128°E+) IDW 보간 + 천문 카드 (SunCalc) |
| `ocean_bottom_sheet5.js` | 6개 일반 카드 + 전체 오케스트레이터 |
| `ocean_bottom_sheet_vsby.js` | 클릭한 해점(lat/lon)이 속한 '소해구'의 래스터 시정 시계열을 받아, |
| `ocean_bottom_sheet_weather.js` | 바텀시트 천기 카드 — 클릭한 해점의 KMA 단기예보 6 카테고리 종합 표시 |
| `ocean_sheet_timeline.js` | 해양종합정보 바텀시트 내부의 시간 이동 슬라이더 |

### `client/js/ocean-map/cctv/`

| 파일 | 역할 |
|------|------|
| `cctv1.js` | CCTV 제공기관(KBS, 거제시, 추후 지자체·중앙부처)을 키로 구분하여 |
| `cctv4.js` | 1. 지도 마커 클릭 이벤트를 처리합니다. |
| `ocean_cctv.js` | index2 (종합기상 > 해양종합) 에서 CCTV 기능을 oceanMap 위에 통합하는 모듈. |

### `client/js/ocean-map/layers/`

| 파일 | 역할 |
|------|------|
| `shrt_forecast_layer.js` | KMA 단기예보 (천기 — 강수확률/강수량/적설/하늘상태/강수형태) 오버레이 + |
| `tide_field.js` | "서해·남해 물빠짐(갯벌 노출) 예측" 프론트 레이어 (Phase 3) |
| `vsby_forecast_layer.js` | KMA RDPS 시정예측 (visibility, 안개) PNG raster 오버레이 + |

### `client/js/ocean-map/map/`

| 파일 | 역할 |
|------|------|
| `ocean_map.js` | 해양종합정보 지도 초기화 + 베이스맵 전환 + 기본 인터랙션 |
| `ocean_markers.js` | 해양종합정보 조석 표준항 마커 + 클릭 처리 |
| `ocean_northup.js` | 해양종합정보 지도의 "진북(North Up)" 회전 컨트롤 |
| `ocean_overlay.js` | 해양현황 캔버스 오버레이 (해류/바람/파고 색상 + 파티클 애니메이션) |

### `client/js/ocean-map/observation/`

| 파일 | 역할 |
|------|------|
| `ocean_buoy.js` | 해양종합 지도 – 기상부이 + 주요지명 격자 샘플링 레이어 (INDEX2 전용) |

### `client/js/ocean-map/timeline/`

| 파일 | 역할 |
|------|------|
| `ocean_timeline.js` | 해양현황 타임라인 슬라이더 (72시간 예측) |

### `client/js/ocean-map/warnings/`

| 파일 | 역할 |
|------|------|
| `ocean_warn_active1.js` | 해양종합정보 지도 위에 "현재 활성/다가오는 특보"를 색칠하고, |
| `ocean_warn_active2.js` | appState.alerts 배열을 부모 zoneName 단위로 묶어 "활성 맵(activeMap)" |
| `ocean_warn_active3.js` | OceanWarnZone.setActiveStyler 에 등록할 스타일 함수 구현. |
| `ocean_warn_active4.js` | 우측 컨트롤 스택의 "🚨 ON/OFF" 토글 버튼을 바인딩하고, |
| `ocean_warn_active5.js` | 부모 zone 클릭 시 어두운 남색 정보 박스 표출, 외부 클릭 자동 close, |
| `ocean_warn_vsby.js` | 해역별 특보 현황 아코디언의 각 특보구역 카드에 "시정(visibility) 뱃지" |
| `ocean_warn_zone.js` | 해양종합정보 지도에 KMA 해상 예특보구역 폴리곤 outline 표출 |

### `client/js/push/`

| 파일 | 역할 |
|------|------|
| `alert_push.js` | 해양특보 알림 관리 모달 (발표/발효/해제/격상/직접발송/이력) |

### `client/js/settings/`

| 파일 | 역할 |
|------|------|
| `settings.js` | 탭 시스템, 스타일 주입, 사용자 설정, 알림 설정, 위치 기반 검색 |
| `zone_guide.js` | 관심 해역 설정 유도 팝업 (1회성 넛지) |

### `client/js/shared/ui/`

| 파일 | 역할 |
|------|------|
| `ui_modal.js` | 공통 UI 모달 (기상청 iframe, SEAGNAL 시스템 모달) |

### `client/js/shared/utils/`

| 파일 | 역할 |
|------|------|
| `mappings.js` | 연안바다/평수구역 매핑, 부이 위치 매핑, 부이 타입 정의 |
| `utils.js` | 전역 상태(appState), 유틸리티 함수, 날짜/시간 포맷팅 |

### `client/js/typhoon/`

| 파일 | 역할 |
|------|------|
| `location_alert_typhoon_runtime.js` | 위치기반 태풍 반경 알림 단말 런타임 (서버 wake 신호 → 반경 판정 → 알림) |
| `ocean_typhoon.js` | 해양종합 지도(OpenLayers)에 "태풍" 오버레이 + 재생 애니메이션을 표출. |


## 5. 서버 구조 (요약)

- `local_server/routes/` (31) — Express API 라우트
- `local_server/services/` (35) — 서버 서비스(캐시·푸시·수집 등)
- `local_server/advisory/` — 특보 예측 엔진
- `local_server/scheduler.js` — 크롤러·수집 스케줄러
- `local_server/data/` — 런타임 데이터 (Fly 볼륨 /app/local_server/data — 경로 변경 금지)
- 예외: `services/typhoon_radius.js`·`typhoon_message.js` 는 서버·클라 공용 —
  server.js 가 이 2개 URL 만 명시적으로 서빙.

## 6. 규칙 문서

- 코드 추가·수정 규칙: `DEVELOPMENT_GUIDE.md` (루트)
- 리팩토링 계획 전문: `00_docs/REFACTORING_PROPOSAL_STRUCTURE.md`
- 데드코드 판정: `docs/project/refactoring/DEADCODE_REPORT.md`
- 검증 도구: `scripts/refactor/` (verify_all.sh 로 일괄 실행)

## 7. 갱신 규칙

파일을 추가·삭제·이동하면 이 도면을 재생성하고(§위 명령), 같은 커밋에 포함합니다.
파일 역할이 바뀌면 헤더 `역할:` 을 고치면 인덱스도 자동 반영됩니다.
