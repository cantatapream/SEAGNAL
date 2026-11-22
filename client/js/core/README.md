# core  `local_server/js/core/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `app_init.js` | 앱 초기화, 시간 표시, 폰트 크기, 헤더 새로고침, 방문자 카운터 | `updateTimeDisplay`, `handleHeaderRefresh`, `openSettingsModal`, `updateVisitorStats`, `markVisitorCounterError`, `checkCollectFailures` |
| `backbutton.js` | 하드웨어 뒤로가기 버튼 처리 + 팝업 스택 관리 | `wrapSettingsModal`, `wrapKmaIframeModal`, `wrapSeagnalModal`, `wrapAlertHistoryPopup`, `wrapWindyPopup`, `wrapSeaZoneInfoPopup` |
| `config.js` | 전역 설정(CONFIG), 해역 상수, 윈디 매핑, 해역 분류 체계 | `slideDown`, `slideUp`, `showBuoyLocationOnMap`, `showBlinkingMarker`, `getWindyEmbedUrl`, `getSubRegion` |
| `zone_split.js` | 기상청 특보구역 개편(2026-11-26 제주도남쪽바깥먼바다 → 남서쪽·남동쪽바깥먼바다)을 그날 00시부터 화면이 스스로 따르게 한다 — 전환 판정·저장값 이어받기·자정 넘김 새로고침·「수정 진행 중」 버튼. 상세 `zone_split.design.md` | `isActive`, `isPending`, `splitNames`, `migrateSettings`, `makeDisabledButton` |
| `index2_patch.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `updateSubTabsBottomPosition`, `_closeAllBottomSubTabs`, `_openSubTabsFor`, `_syncSubTabHeightVar`, `_applyScrollHeight`, `_applyOffsetHeight` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
