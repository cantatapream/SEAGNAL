# admin  `local_server/js/admin/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `admin.js` | 통합 관리자 시스템 (인증, 대시보드, 특보 관리) | `getStoredAdminToken`, `saveAdminToken`, `clearAdminToken`, `setAdminAuthState`, `_getDeviceToken`, `renderUnifiedAiTab`, `renderAiForecastSubtab` |
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

기존 통합 관리자 인증으로 로그인한 뒤 **AI → AI 사고예측 → 오류현황**에서 현재 원천 상태와 오류·복구 이력을 확인한다. `renderAiForecastSubtab`은 `GET /api/admin/risk-forecast/errors`를 호출한다. 기존 `adminAwareFetch`가 토큰을 붙이고 401을 처리한다. 원천·상태 필터, 30건 페이지, 수동 새로고침을 제공하며 KST 시각과 최종 상태 확인 시각을 표시한다. 탭을 떠난 뒤 늦게 도착한 응답은 무시한다. 비밀번호를 새로 만들거나 코드에 넣지 않는다.

**필터는 두 구역에 함께 걸린다(2026-10-15 수정).** 전에는 서버 `risk_error_history.list()`가 원천·상태 조건을 이력(`data`)에만 걸고 현재 상태(`current`)는 그대로 돌려줘, 원천을 골라도 위쪽 「현재 원천 상태」가 바뀌지 않았다(사용자 지적 「필터가 제대로 작동하지 않는다」). 지금은 원천·상태가 현재 상태와 이력 둘 다를 거르고, 기간(`from/to`)만 이력 전용이다. 상태 선택지에 「비운영 기간」(`offseason`)도 넣었다.

**모양**: 같은 AI 탭의 AI 비서·서버 로그와 같은 어두운 상자·버튼·선택칸 꼴을 그대로 쓴다(새 CSS 없음, 인라인 스타일). 원천마다 카드 한 장, 왼쪽 띠와 상태 배지 색은 정상 초록 `#34d399`·자료 오래됨 노랑 `#fbbf24`·일부 실패 주황 `#fb923c`·수집 실패 빨강 `#f87171`·자료 없음 회색 `#94a3b8`·비운영 기간 청록 `#22d3ee`. 카드 안은 「마지막 정상 수집·최신화 확인·분류·상세」(이력은 「기록 시각·최초 감지·분류·상세」)를 이름 칸/값 칸 두 줄로 맞춘다. 분류가 상태와 같은 말(`stale`·`missing`)이면 겹치므로 생략한다. 조건에 맞는 것이 없으면 각 구역에 빈 안내가 나온다. 검사: `test_risk_errors_filter_ui`(실제 라우터 + Chromium, 380px).

**「일부 실패」(`partial`, 2026-10-15)** — 자료는 저장되어 쓰이고 있지만 일부가 빠졌다는 뜻이다. 지금은 **행사** 수집에서 Gemini 보충검색이 일부 시도(시·도)에서 실패했을 때만 쓴다(분류 「Gemini 일부 실패」, 상세에 「시도 실패 경상남도(Gemini 호출 실패)」처럼 시도와 사유). 실패한 시도는 다음 03:20(또는 재기동)에 그 시도만 다시 묻고, 모두 성공하면 이력에 「복구」가 남는다. 사용자 원문: *"우리 앱에 저장실패했다는 내용을 알려야하겠지? 우리 기능 중 오류를 기록하는 기능이 있잖아? 서버 기록 말고. 통합관리자 센터에서."* 상태 선택지에도 「일부 실패」가 있다. 검사: `test_risk_errors`·`test_risk_errors_filter_ui`·`test_risk_collectors` 9·`test_risk_history_sources`.

원천 상태에 「**상세**」 줄이 붙으면 수집기가 남긴 실패·제외 사유다(2026-10-15, 현재 실시간 선박 교통만). 예: 「API HTTP 503 · 웹 invalid response(접속 페이지에 보안 토큰 없음)」, 「API 2줄: 밀집도 범위 밖(척수는 유지) 1, 격자번호 형식 1」. 고정 문구와 숫자뿐이라 키·주소는 나오지 않는다.

원천 목록에는 2026-10-15부터 **해구별 시정 예측**(`visibility`)이 포함된다. imgList 확인이 3회 연속 실패하면 「수집 실패」, 마지막 래스터 수집이 36시간을 넘으면 「자료 오래됨」으로 보이며, 「마지막 정상 수집」에 마지막 수집 시각이 나온다. 경계와 근거는 `00_docs/operations/risk-forecast-error-history.md`.
