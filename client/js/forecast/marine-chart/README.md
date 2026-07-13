# marine-chart  `local_server/js/forecast/marine-chart/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `marine_chart1.js` | 해상일기도(KMA 날씨누리) — 카탈로그/상태/DOM 바인딩/드롭다운 | `init`, `bindEvents`, `onCategoryClick`, `switchControlGroup`, `applyCategoryUiState`, `refreshSurgeDataOptions` |
| `marine_chart2.js` | 해상일기도 — 데이터 fetch / 이미지 render / 시간 점프 / 재생 컨트롤 | `fetchList`, `findCurrentIndex`, `updateSliderRange`, `render`, `jumpHours`, `highlightJumpButton` |
| `marine_chart3.js` | 해상일기도 — 전체화면 진입/종료 (SEAGNAL 통합 PopupStack 패턴) | `enterFullscreen`, `exitFullscreen`, `_doClose`, `bindEnterTrigger`, `bindExitTrigger`, `bindTabGuard` |
| `marine_chart4.js` | 해상일기도 — 전체화면 컨트롤 자동 페이드 (동영상 플레이어 패턴) | `showControls`, `hideControls`, `toggleControls`, `cancelFadeTimer`, `bindActivityRefresh`, `bindSliderHold` |
| `marine_chart5.js` | 해상일기도 — 전체화면 제스처 (핀치줌·팬·탭 토글) | `applyTransform`, `resetTransform`, `resetZoomPan`, `toggleRotation`, `distance`, `clampPan` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
