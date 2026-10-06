# bottom-sheet  `local_server/js/ocean-map/bottom-sheet/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `ocean_bottom_sheet1.js` | 해양종합정보 바텀시트 — 코어/네임스페이스/진입점/공용 유틸 | `endDrag`, `updateTyphoonEtaBadge`, `showOceanBottomSheet` |
| `ocean_bottom_sheet2.js` | 바텀시트 헤더 — 날짜 네비게이션 + 음력 표시 + 📍 토글 + ✕ 닫기 | — |
| `ocean_bottom_sheet3.js` | 바텀시트 조석 카드 — TideBED 폴링 + 3모드 렌더링(loading/error/detail) | `gridPointKey`, `loadGridHashLS`, `persistGridHashIfFavorite`, `rememberGridHash`, `forgetGridHash`, `lookupGridHash`, `OS.prefetchFavoriteTides` |
| `ocean_bottom_sheet4.js` | 동해 북부(36°N+128°E+) IDW 보간 + 천문 카드 (SunCalc) | `runIdw`, `afterLoads`, `loadNext`, `pickMoonPhase`, `fmt` |
| `ocean_bottom_sheet5.js` | 7개 일반 카드 + 전체 오케스트레이터 | `_isStaleEpoch`, `fetchDepth`, `fetchRoms`, `fetchPressure`, `fetchWeather`, `fetchWave` |
| `ocean_bottom_sheet_vsby.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `_keyOf`, `_fmtNum`, `_fmtVis`, `_setValue`, `_tKey`, `_dateKey` |
| `ocean_bottom_sheet_weather.js` | 바텀시트 천기 카드 — 클릭한 해점의 KMA 단기예보 6 카테고리 종합 표시 | `_fmtNum`, `_buildRainText`, `_setCell`, `_ensureLoadingSkeleton`, `_show`, `_renderData` |
| `ocean_sheet_timeline.js` | 해양종합정보 바텀시트 내부의 시간 이동 슬라이더 | `$`, `floor3h`, `displayTimeMs`, `computeMaxFromZone`, `sheetValueFromLayerHours`, `updateTooltip` |

## 즐겨찾기 조석 미리받기 (2026-10-06)

- 앱을 켤 때(load 3초 뒤)와 앱으로 돌아올 때(visibilitychange → visible) `ocean_bottom_sheet3.js` 의
  `OS.prefetchFavoriteTides()` 가 위치 즐겨찾기(최대 6곳) 중 **오늘치 조석이 영속 캐시(`tideCache:v1`)에
  없는 곳만** 한 곳씩 받아 넣는다. 화면·메모리 캐시는 건드리지 않는다.
- 그래서 즐겨찾기 칩을 누르면 `fetchTideForSheet` 가 캐시 hit → 조석 카드가 기다림 없이 뜬다.
- 범위: 조석만 · 같은 기기 기준(즐겨찾기가 localStorage 에만 있으므로). 실패는 조용히 넘기고 그 해점은
  예전처럼 시트를 열 때 받는다. 시험: `local_server/scripts/test_fav_tide_prefetch.js`.

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
