# admin  `local_server/js/admin/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `admin.js` | 통합 관리자 시스템 (인증, 대시보드, 특보 관리) | `getStoredAdminToken`, `saveAdminToken`, `clearAdminToken`, `setAdminAuthState`, `_getDeviceToken`, `renderUnifiedAiTab`, `renderAiForecastSubtab` |
| `admin_data_status.js` | 관리자 → 점검 → 데이터 수집현황 화면(수집 목록·현재 원천 상태·오류·복구 이력) | `renderDataCollectionTab`, `renderDataCollectionList` |
| `admin_station_briefing.js` | 관리자 → AI → 「AI 브리핑」 하위 탭 — 활동지점 안전 브리핑 생성 방식·모델·노출 범위·묶음 단위·바뀐 곳만·상태·[지금 다시 만들기](409)·관할 미리보기(`/api/admin/station-briefing/*`) | `renderStationBriefingAdmin`, `drawConfig`, `drawStatus`, `drawPreview`, `nextEdition` |
| `admin_collect.js` | 특보 수집 테스트, 결과 팝업, 방문자 통계 차트 | `isAdminTestMode`, `getAdminToken`, `getTestModeParams`, `renderATMStatus`, `renderATMCollect`, `renderATMForecast` |
| `admin_location_status.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `readPrefFirst`, `readPos`, `fmtAgo`, `fmtAbs`, `esc`, `seaLandOf` |
| `admin_report.js` | 관리자 제보 관리 + 차단 관리 UI | `escapeHTML`, `_reportDisplayName`, `loadReportList`, `renderReportList`, `_loadCommentReportList`, `_renderCommentReportList` |
| `admin_survey.js` | 통합 관리자 센터 - 설문조사 탭 UI (생성/현황/결과분석/이력관리) | `renderUnifiedSurveyContent`, `escSvAttr`, `renderSurveyCreateTab`, `renderQuestionsList`, `renderSurveyStatusTab`, `_reloadSurveyStatusKeepPage` |
| `admin_trigger.js` | 관리자 트리거(15회 클릭), 공지/점검/오류 팝업 | `initAdminTrigger`, `checkNoticeStatus`, `showAdminNoticeModal`, `loadPromoListForNoticeLegacy`, `requestNoticeUpdate`, `showNoticePopup` |
| `advisory_manage_admin.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `esc`, `api`, `toast`, `load`, `statsHtml`, `modeBtn` |
| `cctv7.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `toggleCctvEditMode`, `handleCctvEditClick`, `_selectEditFeature`, `_moveSelectedFeature`, `_clearEditSelection`, `_updateEditPanel` |
| `pagination_helper.js` | 관리자 리스트 화면용 공용 페이지네이션 UI helper | `buildPageList`, `renderStandardPagination`, `resolveScrollTarget`, `normalize` |

## 점검 탭 — 선택 차단 트리 (2026-09-10 갱신)

`admin.js` 의 `featureTree` 가 관리자가 고를 수 있는 "잠글 기능" 목록이고, 실제로 잠그는 코드는
`client/index2.html` 의 `applyFeatureBlocks()`(버튼·탭·아코디언 매핑)와 `survey_user.js`(설문 팝업)다.
**트리에 id 를 더하면 같은 커밋에서 그 매핑에도 더한다** — 빠지면 `local_server/scripts/test_maintenance_tree.js`
(verify_all)가 실패한다. 화면 접근만 막는 것이 목적이라 서버 API 는 막지 않는다(사용자 확정 2026-09-10).
점검 중 "푸시 알림 차단"은 특보 푸시·태풍 푸시·**위치기반 특보 알림**(`services/location_alert_dispatch.js`) 모두에 적용된다.

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).

## AI 사고예측 → 오류현황

> ⚠**위치 바뀜 (2026-10-15)** — 이 화면은 이제 **점검 → 데이터 수집현황**의 「현재 원천 상태」·「오류·복구 이력」 하위 탭이다(아래 절). AI 탭에서는 빠졌다. 사용자 원문: 「빠져서 점검 탭 아래로 가는게 맞음」. 아래 설명의 내용(필터·색·상세)은 그대로 맞다.

기존 통합 관리자 인증으로 로그인한 뒤 **AI → AI 사고예측 → 오류현황**에서 현재 원천 상태와 오류·복구 이력을 확인한다. `renderAiForecastSubtab`은 `GET /api/admin/risk-forecast/errors`를 호출한다. 기존 `adminAwareFetch`가 토큰을 붙이고 401을 처리한다. 원천·상태 필터, 30건 페이지, 수동 새로고침을 제공하며 KST 시각과 최종 상태 확인 시각을 표시한다. 탭을 떠난 뒤 늦게 도착한 응답은 무시한다. 비밀번호를 새로 만들거나 코드에 넣지 않는다.

**필터는 두 구역에 함께 걸린다(2026-10-15 수정).** 전에는 서버 `risk_error_history.list()`가 원천·상태 조건을 이력(`data`)에만 걸고 현재 상태(`current`)는 그대로 돌려줘, 원천을 골라도 위쪽 「현재 원천 상태」가 바뀌지 않았다(사용자 지적 「필터가 제대로 작동하지 않는다」). 지금은 원천·상태가 현재 상태와 이력 둘 다를 거르고, 기간(`from/to`)만 이력 전용이다. 상태 선택지에 「비운영 기간」(`offseason`)도 넣었다.

**모양**: 같은 AI 탭의 AI 비서·서버 로그와 같은 어두운 상자·버튼·선택칸 꼴을 그대로 쓴다(새 CSS 없음, 인라인 스타일). 원천마다 카드 한 장, 왼쪽 띠와 상태 배지 색은 정상 초록 `#34d399`·자료 오래됨 노랑 `#fbbf24`·일부 실패 주황 `#fb923c`·수집 실패 빨강 `#f87171`·자료 없음 회색 `#94a3b8`·비운영 기간 청록 `#22d3ee`. 카드 안은 「마지막 정상 수집·최신화 확인·분류·상세」(이력은 「기록 시각·최초 감지·분류·상세」)를 이름 칸/값 칸 두 줄로 맞춘다. 분류가 상태와 같은 말(`stale`·`missing`)이면 겹치므로 생략한다. 조건에 맞는 것이 없으면 각 구역에 빈 안내가 나온다. 검사: `test_risk_errors_filter_ui`(실제 라우터 + Chromium, 380px).

**「일부 실패」(`partial`, 2026-10-15)** — 자료는 저장되어 쓰이고 있지만 일부가 빠졌다는 뜻이다. 지금은 **행사** 수집에서 Gemini 보충검색이 일부 시도(시·도)에서 실패했을 때만 쓴다(분류 「Gemini 일부 실패」, 상세에 「시도 실패 경상남도(Gemini 호출 실패)」처럼 시도와 사유). 실패한 시도는 다음 03:20(또는 재기동)에 그 시도만 다시 묻고, 모두 성공하면 이력에 「복구」가 남는다. 사용자 원문: *"우리 앱에 저장실패했다는 내용을 알려야하겠지? 우리 기능 중 오류를 기록하는 기능이 있잖아? 서버 기록 말고. 통합관리자 센터에서."* 상태 선택지에도 「일부 실패」가 있다. 검사: `test_risk_errors`·`test_risk_errors_filter_ui`·`test_risk_collectors` 9·`test_risk_history_sources`.

**「일부 실패」 갱신(2026-10-15 D7·3차 검토)** — 위 「Gemini 보충검색이 일부 시도에서 실패했을 때만」·「분류 Gemini 일부 실패」는 낡았다. 지금은 행사 수집의 실패한 부분(Gemini·카카오로 실패한 시도, 공식 목록 받기·공식 행사 위치 연결)이 있으면 「일부 실패」이고, 분류는 원인별 고정 이름이다: `행사 일부 실패 — Gemini` / `— 카카오` / `— 공식 목록`, 여러 원인이면 `— Gemini·카카오` 처럼 묶음(원인을 모르는 옛 상태 파일은 `행사 일부 실패`, 이 변경 전 이력의 `Gemini 일부 실패` 도 그대로 읽힌다). 원인이 바뀌면 이력에 「문제 변경」이 남는다. 상세 예: `공식 목록 다시 받기 실패(HTTP 500) · 저장된 행사 유지(공식 목록 마지막 성공 10-01 03:20 KST) · 시도 실패 10곳(카카오 키 없음(설정))` — 실패 시도는 사유별로 묶고(3곳까지 이름) 200자를 넘지 않게 줄인다. **지난 달 닫기**: 1분 감시가 더 보지 않는 지난 달 행사의 문제 상태(일부 실패·실패 등)는 이력에 **「수집 종료」**(상태 배지 「비운영 기간」, 상세 「지난 달 — 더 수집하지 않음(마지막 상태: …)」)를 남기고 현재 상태에서 빠진다 — 종전엔 약 3개월 동안 현재 상태에 남았다(`phaseName`: recovered 사건인데 상태가 offseason 이면 「수집 종료」). 검사: `test_risk_errors`(지난 달 닫기·원인별 분류)·`test_risk_errors_filter_ui`(수집 종료 표시)·`test_risk_collectors` 19~23.

원천 상태에 「**상세**」 줄이 붙으면 수집기가 남긴 실패·제외 사유다(2026-10-15, 현재 실시간 선박 교통만). 예: 「API HTTP 503 · 웹 invalid response(접속 페이지에 보안 토큰 없음)」, 「API 2줄: 밀집도 범위 밖(척수는 유지) 1, 격자번호 형식 1」. 고정 문구와 숫자뿐이라 키·주소는 나오지 않는다.

원천 목록에는 2026-10-15부터 **해구별 시정 예측**(`visibility`)이 포함된다. imgList 확인이 3회 연속 실패하면 「수집 실패」, 마지막 래스터 수집이 36시간을 넘으면 「자료 오래됨」으로 보이며, 「마지막 정상 수집」에 마지막 수집 시각이 나온다. 경계와 근거는 `00_docs/operations/risk-forecast-error-history.md`.

## 점검 → 데이터 수집현황 (2026-10-15)

관리자 센터 **점검** 탭의 네 번째 하위 탭. 그 안에 하위 탭이 셋 있다(마지막으로 연 탭을 기억 — `localStorage seagnal_datastatus_subtab`).

| 하위 탭 | 무엇 | 그리는 함수 / 서버 |
|---|---|---|
| 수집 목록 | 앱이 모으는 데이터마다 카드 한 장, 출처별 묶음 | `admin_data_status.js renderDataCollectionList` → `GET /api/admin/data-collection`(`routes/data_collection.js` → `services/data_collection_status.js`) |
| 현재 원천 상태 | 종전 「AI 사고예측 → 오류현황」의 위쪽 구역 | `admin.js renderAiForecastSubtab(host, {view:'current'})` |
| 오류·복구 이력 | 종전 화면의 아래쪽 구역(「일부 실패」 포함) | `renderAiForecastSubtab(host, {view:'history'})` |

②·③은 종전 화면을 그대로 쓰고(합치지 않음) `view` 로 한 구역만 그린다. `view` 를 안 주면 두 구역을 함께 그린다(검사 `test_risk_errors_ui`·`test_risk_errors_filter_ui` 가 그 꼴을 본다).

**사용자 확정(2026-10-15, 원문)**: 「1-목록범위 : 앱 수집 데이터 전체 2-공식 갱신 시기 - 추천대로 3-빠져서 점검 탭 아래로 가는게 맞음 4- 맞아.」
→ ①앱이 모으는 데이터 전체(1단계 위험예측 자료 11종, 2단계 그 밖) ②공식 갱신 시기는 근거가 있는 것만, 없으면 「확인 필요」, 직접 잰 값은 「실측」 ③점검 탭 아래 ④이름 끝에 출처 「○○ (기상청 MMIS)」.

**목록표(manifest)** — `local_server/config/data_collection_manifest.json`. 새 데이터는 `items` 에 한 줄만 더하면 화면에 나온다. 칸의 뜻은 파일 맨 위 `_about`. 근거(`evidence`)는 `{file, quote}` 로 적고, 서버가 그 인용을 찾아 줄 번호를 매번 센다(줄이 밀려도 낡지 않음). 출처 표기 없는 코드 주석은 근거로 치지 않고 `reference`(「참고」)에만 둔다.

**카드 칸**: 공식 갱신 · 우리 수집 시각(코드 일정) · 마지막 수집 · 자료 기준 시각(판·예보 날짜·API 등록시각 — 파일에 있을 때만) · 다음 기대 시각 · 상태 근거 · 상세 · 근거 보기(받는 곳·근거 파일:줄·상태를 읽은 곳). 읽을 곳이 없으면 「기록 없음」.

**상태 판정**(`data_collection_status.itemStatus`):
- 위험예측 원천(1단계)은 오류현황의 현재 상태를 그대로 쓴다(같은 화면 묶음에서 같은 뜻).
- 그 위에, **다음 기대 시각 + 여유(`graceMinutes`)가 지났는데 새 자료가 없으면 노랑(자료 오래됨)**. 다음 기대 시각은 ⓐ판 주기가 근거로 확인된 것(`basisCycleHours`, 지금은 해구 예보 12시간)은 「판 시각+주기」 뒤 첫 수집 회차 ⓑ하루 한 번 자료(`oncePerDay`)는 다음 날 첫 회차 ⓒ마지막 확인 기준(`nextFrom:'checked'` — 판이 바뀔 때만 다시 받는 시정·강풍·공식 사고예보) ⓓ그 밖은 마지막 수집 다음 회차. 다음 시각을 정할 수 없으면(`nextFrom:'none'` — 너울·행사) 이유만 보이고 판정하지 않는다.
- 여유가 없으면 수집 한 번 도는 몇 분 동안에도 노랑이 켜진다.
- 2단계는 `scheduler.getStatus()` 가 「실패」이고 새 자료도 없으면 빨강(수집 실패). 1회 실패만으로는 빨강이 아니다(상세에 「마지막 시도 실패」). `scheduler.js` 는 require 하면 수집이 시작되므로 이미 불러온 경우(`require.cache`)만 읽는다. 바다낚시·바다갈라짐·갯벌·스쿠버·해수욕은 `getStatus()` 가 한 카드로 합쳐 내보내 개별 실패를 못 읽는다 — 시각 판정(노랑)만 한다.
- **이안류·기상청 MMIS 수집 실패 기록(2026-10-15)** — 이안류·특보·강풍·너울·MMIS 관측 4종(기상부이·파고부이·등표·시정계)은 수집기가 매 시도의 성공·실패를 `services/collect_fail_alert.js` 에 알리고, 그 기록(`data/collect_fail_alert.json`, 재기동에도 남음)이 상세에 「마지막 수집 실패: HTTP 503 (연속 2회, 10-15 11:13 KST부터)」로 보이고, 연속 실패 중이면 파일 시각과 무관하게 빨강(「수집 실패 중(연속 N회)」 — 이안류는 실패해도 새 시각으로 파일을 쓰기 때문). 관리자 푸시가 전달되지 않았으면 「관리자 푸시 미전달: … (시각)」 한 줄(시정 예측 포함). 시정 예측의 실패 줄은 `vsby_check_state.json` 이 이미 보이므로 겹쳐 적지 않는다. 같은 기록으로 **관리자 푸시**가 실패 시작 때 1번·복구 때 1번 나간다(시정 예측만 연속 3번 실패해야). 사용자 원문: 「이안류, mmis는 데이터를 호출했을 때 받아올 수 없다면 그 때 알려줘 보통 천기가 그런 경우가 많아.」 설계·「실패」 정의 표: `00_docs/operations/collect-fail-alert.md`. 검사: `test_collect_fail_alert`·`test_data_collection_status`.

**해구 예보 예**: 00UTC 판(09시 KST)을 가진 채 21:30 회차에 12UTC 판이 없으면 22:00 KST 부터 노랑. 수집기는 「새 판 없음, 기존 판 유지」를 `data/zone_forecasts_status.json` 에 남기고(`services/zone_forecast_guard.js`), 찾은 판이 가진 판보다 오래되면 덮어쓰지 않는다.

검사: `test_data_collection_status`(목록표 규칙·근거 인용 실재·시각 읽기·다음 회차·판정·실제 관리자 인증 401/200·503) · `test_data_collection_ui`(실제 라우터+Chromium 380px — 하위 탭 셋·출처 묶음·배지 색·확인 필요·기록 없음·늦은 응답 무시·AI 탭에서 빠졌는지) · `test_zone_forecast_guard`.
