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
