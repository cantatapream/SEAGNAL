# bottom-sheet  `local_server/js/ocean-map/bottom-sheet/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `ocean_bottom_sheet1.js` | 해양종합정보 바텀시트 — 코어/네임스페이스/진입점/공용 유틸 | `endDrag`, `updateTyphoonEtaBadge`, `showOceanBottomSheet` |
| `ocean_bottom_sheet2.js` | 바텀시트 헤더 — 날짜 네비게이션 + 음력 표시 + 📍 토글 + ✕ 닫기 | — |
| `ocean_bottom_sheet3.js` | 바텀시트 조석 카드 — TideBED 폴링 + 3모드 렌더링(loading/error/detail). 게이지·고저조 목록 HTML 은 `buildTideGauge` 한 곳(2026-10-16 에 `OS.tideGaugeHtml` 로도 열어 연안 안전 브리핑 「조석」 칸이 같이 썼으나, 2026-10-18 그 칸을 빼며 그 출입구도 뺐다 — 설계서 §11.10.34) | `gridPointKey`, `loadGridHashLS`, `persistGridHashIfFavorite`, `rememberGridHash`, `forgetGridHash`, `lookupGridHash`, `OS.prefetchFavoriteTides`, `buildTideGauge` |
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

## 시정 카드 — 선택 시각과 1시간 넘게 먼 자료뿐이면 「정보 없음」 (2026-10-15)

`ocean_bottom_sheet_vsby.js` 는 선택 시각에 가장 가까운 시정 frame 을 고르되, 그 frame 도 60분 넘게 떨어져 있으면 **「정보 없음」** 으로 표시한다(MMIS 수집 정지 중 옛 예보가 오늘 값처럼 보이던 문제).
시간 거리는 실제 분으로 잰다 — 예전엔 `YYYYMMDDHHmm` 숫자를 그냥 빼서 자정을 넘는 비교가 틀렸다.
시험: `local_server/scripts/test_vsby_stale.js`.

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).

## 2026-11-24 — 물때·조석 칸·시트 높이
- **물때**: `tide.js computeMulddae` 가 음력 날짜로 정한다(남해·동해 `(음력일+7)%15`, 서해는 한 칸 늦고 조금 다음 날이 무시).
  그 전의 월령·반올림 방식은 하루 사이 한 칸을 건너뛰고(12물→14물) 같은 날에도 시각에 따라 바뀌었다. 로딩 중에도 물때는 바로 보인다.
  음력표(`getLunarDate`)의 2026·2027년 달 길이와 2027·2028년 설날을 서울 시각 삭 날짜로 바로잡았다. 검사: `test_mulddae_lunar.js`.
- **조석 칸**: 3일치(어제·오늘·내일)가 다 모인 뒤 한 번 그린다. 2.5초 안에 안 모이면 받은 것으로 먼저 한 번, 다 모였을 때 내용이 달라진 경우에만 한 번 더.
  이전 날짜·지점의 요청이 늦게 도착하면 버린다(`isStaleTideRequest` — 종전에는 지금 보는 날짜의 칸을 덮어썼다).
- **시트 높이**: `OS.holdSheetHeight`(5.js) — 자료를 받기 시작할 때 높이를 붙잡고, 받는 중인 칸이 없어지면 새 높이로 0.28초에 부드럽게 맞춘다.
  받는 동안 숨어 있는 칸은 `OS.state._wxPending`·`_vsbyPending`·`_romsPending` 으로 알린다. 새로 늦게 채워지는 칸을 만들면 이 표시도 함께 넣는다.
