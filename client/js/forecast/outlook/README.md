# outlook  `local_server/js/forecast/outlook/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `forecast.js` | 해상예보 테이블, 정보 팝업(해구별/특보/조석) | `degreeToWindDir`, `tmToKstDate`, `formatWaveHeight`, `getMidTermDisplayName`, `getMidTermRegId`, `midTermWeatherToEmoji` |
| `marine_forecast.js` | 기상청 해상 기상 전망 데이터 로드 및 렌더링 | `renderCategoryHtml`, `escapeHtml`, `renderForecastSection`, `_isMeaningfulText`, `loadMarineForecast`, `applyMarineForecastDefaultExpansion` |
| `windy.js` | Windy 팝업, 상태 카드 시스템 | `showWindyPopup`, `getSeaRegion`, `renderBuoyButtonsForStatus`, `renderOtherButtonsForStatus`, `renderMarineWeatherStatus`, `createStatusCard` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
