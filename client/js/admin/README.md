# admin  `local_server/js/admin/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `admin.js` | 통합 관리자 시스템 (인증, 대시보드, 특보 관리) | `getStoredAdminToken`, `saveAdminToken`, `clearAdminToken`, `setAdminAuthState`, `_getDeviceToken`, `renderUnifiedAiTab` |
| `admin_collect.js` | 특보 수집 테스트, 결과 팝업, 방문자 통계 차트 | `isAdminTestMode`, `getAdminToken`, `getTestModeParams`, `renderATMStatus`, `renderATMCollect`, `renderATMForecast` |
| `admin_location_status.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `readPrefFirst`, `readPos`, `fmtAgo`, `fmtAbs`, `esc`, `seaLandOf` |
| `admin_report.js` | 관리자 제보 관리 + 차단 관리 UI | `escapeHTML`, `_reportDisplayName`, `loadReportList`, `renderReportList`, `_loadCommentReportList`, `_renderCommentReportList` |
| `admin_survey.js` | 통합 관리자 센터 - 설문조사 탭 UI (생성/현황/결과분석/이력관리) | `renderUnifiedSurveyContent`, `escSvAttr`, `renderSurveyCreateTab`, `renderQuestionsList`, `renderSurveyStatusTab`, `_reloadSurveyStatusKeepPage` |
| `admin_trigger.js` | 관리자 트리거(15회 클릭), 공지/점검/오류 팝업 | `initAdminTrigger`, `checkNoticeStatus`, `showAdminNoticeModal`, `loadPromoListForNoticeLegacy`, `requestNoticeUpdate`, `showNoticePopup` |
| `advisory_manage_admin.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `esc`, `api`, `toast`, `load`, `statsHtml`, `modeBtn` |
| `cctv7.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `toggleCctvEditMode`, `handleCctvEditClick`, `_selectEditFeature`, `_moveSelectedFeature`, `_clearEditSelection`, `_updateEditPanel` |
| `pagination_helper.js` | 관리자 리스트 화면용 공용 페이지네이션 UI helper | `buildPageList`, `renderStandardPagination`, `resolveScrollTarget`, `normalize` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
