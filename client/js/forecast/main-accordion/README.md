# main-accordion  `client/js/forecast/main-accordion/`

특보정보 탭의 큰 아코디언 4개를 **한 번에 하나만** 펼쳐지게 하는 기능.

## 화면에서 찾아가는 법

특보정보 탭 → 「기상청 해상 기상 전망」 · 「AI 연안 안전 브리핑」(노출 설정된 기기만) · 「해역별 특보현황」 · 「해역별 기상현황」.
하나를 펼치면 나머지가 접힌다. 접힌 아코디언을 다시 펼치면 그 안에서 직전에 펼쳐 두었던 칸이 그대로 펼쳐져 있다.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `main_accordion_solo.js` | 큰 아코디언 4개 몸통의 class 변화를 지켜보다가, 하나가 펼쳐지면 나머지를 접는다(안쪽 칸 상태는 건드리지 않음) | `collapseOthers`, `watch` |

## 사용자 확정 (2026-11-19)

> *"총 4개의 아코디언이 있잖아 ? 다른 아코디언이 펼쳐지면 기존 펼쳐져있던 아코디언은 접히도록 해줘. 단, 기존 아코디언을 다시 펼쳤을 때 그 아코디언 안에 직전에 펼쳐놨던 아코디언이 펼쳐져있게 해줘."*

질문에 대한 답(같은 날):
- 앱이 스스로 펼치는 동작(특보 있으면 특보현황, 없으면 기상현황) → **앱을 처음 켤 때만**. 그 뒤 자료 새로고침(5분마다·탭 이동·앱 복귀) 때는 사용자가 펼쳐 둔 것을 그대로 둔다 — `alerts/render.js` renderApp.

## 데이터 흐름

1. 어느 길로든 몸통에서 `.collapsed` 가 빠진다(머리 누르기 · 앱 처음 켤 때 자동 펼침 · 특보 상세 「목록에서 보기」 · ⚙ 설정 팝업).
2. `MutationObserver` 가 그 순간을 보고 나머지 몸통에 `.collapsed`(머리에는 `collapsed-state`)를 단다.
3. 접힌 몸통 안쪽 DOM 은 그대로라 다시 펼치면 직전 상태 그대로 보인다.
   5분마다 다시 그려지는 안쪽 칸(특보현황·기상현황의 중분류)은 각 파일이 펼친 칸을 기억해 둔다 — `alerts/render.js`·`outlook/windy.js`.

## 연계 파일

- `alerts/data.js` toggleMainAccordion · `outlook/windy.js` toggleMarineStatusAccordion · `outlook/marine_forecast.js` toggleMarineForecastAccordion · `station-briefing/station_briefing.js` toggle·expand
- 시험: `local_server/scripts/test_forecast_gear_ui.js`

## 수정 시 주의사항

- 큰 아코디언을 새로 추가하면 `ACCORDIONS` 표에 한 줄 넣는다.
- 몸통을 여는 쪽에서 나머지를 직접 접지 않아도 된다(여기서 처리).
