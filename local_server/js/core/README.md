# core  `local_server/js/core/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `app_init.js` | 앱 초기화, 시간 표시, 폰트 크기, 헤더 새로고침, 방문자 카운터 | `updateTimeDisplay`, `handleHeaderRefresh`, `openSettingsModal`, `updateVisitorStats`, `markVisitorCounterError`, `checkCollectFailures` |
| `backbutton.js` | 하드웨어 뒤로가기 버튼 처리 + 팝업 스택 관리 | `wrapSettingsModal`, `wrapKmaIframeModal`, `wrapSeagnalModal`, `wrapAlertHistoryPopup`, `wrapWindyPopup`, `wrapSeaZoneInfoPopup` |
| `config.js` | 전역 설정(CONFIG), 해역 상수, 윈디 매핑, 해역 분류 체계 | `slideDown`, `slideUp`, `showBuoyLocationOnMap`, `showBlinkingMarker`, `getWindyEmbedUrl`, `getSubRegion` |
| `index2_patch.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `updateSubTabsBottomPosition`, `_closeAllBottomSubTabs`, `_openSubTabsFor`, `_syncSubTabHeightVar`, `_applyScrollHeight`, `_applyOffsetHeight` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
