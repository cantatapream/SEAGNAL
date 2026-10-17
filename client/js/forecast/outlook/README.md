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

## 관심 기상청 — 「기상청 해상 기상 전망」 종합 예보 (2026-10-17 사용자 확정)

> 사용자 원문: *"현재 기상청 해상 기상 전망은 최초 앱 설치 시 모든 지방청 단기전망이 모두 나오도록 되어있고 설정 버튼을 통해서 원하는 지방기상청 정보를 수신할 수 있도록 되어있는데 이렇게 하지말고 처음 설치했을 때 기상청 해상 기상 전망 아코디언을 누르면 관심 기상청이 설정되지 않았다는 문구와 함께 아코디언 펼쳐진 화면에 설정하기 버튼이 있는데 그것을 누르면 이렇게 나오도록하고, 여기서 복수로 선택되도록 하는것이 아닌 한개 기상청만 선택할 수 있도록 하자. 그리고 초기화 버튼을 없애고 완료와 취소 버튼을 두도록 하는거야."*
>
> 같은 날 추가 원문(⚙ 자리): *"아코디언에 설정버튼 반영방법은 이미지 5처럼 반영해줘(기상청 해상 기상 전망도 마찬가지로)"* — 이미지 5 = 「🧭 활동지점 안전 브리핑」 머리 오른쪽 끝의 회색 ⚙.

### 무엇을 보여 주나 (`marine_forecast.js` `getRelevantOfficeCodes`)

| 상태 | 종합 예보 칸 |
|---|---|
| 관심 기상청을 골라 둠 | 그 지방청 하나 |
| 안 골랐고, 관심해역을 골라 둠(`UserSettings.hasInterestZones()`) | 관심해역이 가장 많은 지방청 하나(`config.js getTopOffice` — 2026-09-27 사용자 확정, 그대로 둠) |
| 둘 다 없음(처음 설치 등) | 「관심 기상청이 설정되지 않았습니다.」 + 「설정하면 그 지방기상청의 해상 단기 전망을 보여 드립니다.」 + **[설정하기]** — 7곳을 다 보이던 종전 동작은 없앴다 |

- 팝업 안내 「※ 이 설정은 관심해역 설정보다 우선 적용됩니다.」 는 **여전히 참이라 그대로 둠**(위 표 1행이 2행보다 앞선다).
- 관심해역 「골라 둠」의 기준은 `UserSettings.hasInterestZones()` — 꺼 둔 구역·해역이 하나라도 있으면 참.
  「관심해역별 특보현황」 제목 판정(`render.js`)·관심해역 넛지(`zone_guide.js isAllZonesOn`)와 같은 규칙.
  ⚠종전에는 `getTopOffice` 가 「저장값이 비었나」만 봐서, 전부 켬으로 저장한 사람에겐 7곳 중 구역이 가장 많은 곳이 떴다 — 이제는 그 경우도 「설정되지 않음」이다.

### 설정 팝업 (`openOfficeSettingsPanel`)

- 여는 곳: 아코디언 **머리 오른쪽 끝 ⚙**(`#regional-office-settings-btn`, 늘 보임 — 종전의 「종합 예보」 칸 ⚙ 를 옮김) · 안내 칸 [설정하기]. 아코디언이 닫혀 있으면 펼친 뒤 맨 위에 띄운다.
- 모양은 종전 팝업(📋 지방청 표시 설정) 그대로, **라디오 7줄(한 곳만)** · [초기화] 없음 · **[취소] / [완료]**. [완료]는 한 곳을 골라야 눌린다.
- [완료] = 저장 → 닫기 → 종합 예보 다시 그림. [취소]·×·Esc·하드웨어 뒤로가기(`PopupStack` `'office-settings-panel'`) = 저장 없이 닫기. ⚙ 를 한 번 더 눌러도 [취소]와 같다.
- 처음 선택 = 지금 화면에 보이는 곳(관심해역에서 고른 곳 포함).

### 저장 (`localStorage 'officeManualSettings'`)

- 꼴은 종전과 같다 `{ "109": false, …, "184": true }` — 이제 [완료]는 **한 곳만 true** 로 저장한다(옛 판 앱이 읽어도 그 한 곳이 보인다).
- 읽는 곳: 이 파일뿐(`getOfficeManualSettings` → `getChosenOfficeCode`). 서버·푸시 구독은 이 값을 쓰지 않는다(2026-10-17 `client`·`local_server` 전체 grep 으로 확인 — station-briefing 문서의 「같은 관례」 언급 2곳만 있음).
- **옛 설정 옮기기**: 여러 곳을 켜 둔 저장값은 **팝업 차례(수도권→부산→광주→강원→대전→대구→제주)에서 가장 앞선 곳 하나**만 쓴다. 읽을 때마다 같은 규칙으로 줄이고 저장값은 [완료] 전까지 그대로 둔다. 전부 꺼 둔 저장값·깨진 값은 「안 고름」으로 본다(빈 화면 대신 안내 칸 또는 관심해역 기준).

### 회귀 시험

`local_server/scripts/test_forecast_gear_ui.js`(verify_all `SUITES`) — 처음 설치 안내·한 곳만·[완료]/[취소]/Esc/뒤로가기·⚙ 다시 열기·옛 설정 옮기기·⚙ 자리와 모양(브리핑 ⚙ 와 같은 계산 스타일).
