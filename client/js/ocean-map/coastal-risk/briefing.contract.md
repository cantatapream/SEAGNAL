# 활동지점 안전 브리핑 — 서버 API 계약 (1단계 구현, 2026-10-16)

> 화면(해양예보 탭 아코디언·설정 흐름·관리자 「AI 브리핑」 탭)은 **다음 단계**다. 이 문서는 그 단계가 서버를 그대로 쓰도록
> 경로·요청·응답 필드·노출 판정·설정 API 를 정한다. 요구사항 원문: `coastal_safety_forecast.design.md` §11.6 결정 1~17.
> 서버 파일: `local_server/routes/station_briefing.js` · `services/station_briefing{,_rules,_ai,_inputs}.js` · 시험 `scripts/test_station_briefing.js`.
> 파출소 주소 확인 목록: `station_addresses.md`(같은 폴더).

## 0. 한눈에

| 무엇 | 어떻게 |
|---|---|
| 단위 | 파출소 관할 97곳(`config/coastal_safety/coastguard_stations.geojson`). 열쇠 `key` = `"{해양경찰서}|{파출소}"`(남항파출소가 부산·목포 둘이라 이름만으로는 안 된다) |
| 해상만 | 목포·완도·여수해양경찰서 19곳(여수바다 포함) — `seaOnly:true`, `land:null` |
| 생성 | 08:00 · 17:30 · 23:00 KST(23시 판 = 「오늘 밤~내일」, 대상 날짜 = 내일) + 특보가 바뀔 때(바뀐 특보구역에 걸친 관할만). 운영 서버(FLY)에서만 |
| 판단 | 전부 서버 규칙. AI 는 **총평 두 문단(육상·해상, 각 3~5문장)만**. 카드·근거·특별 상황은 서버 틀 문장 |
| AI 순서 | ChatGPT(관리자 정액제 VM) → 꺼짐·실패면 Gemini → 둘 다 실패면 틀 총평. 해양경찰서별 묶음(21회/판), 입력이 같으면 재사용 |
| 노출 기본값 | **관리자에게만** — 관리자 등록 기기 또는 관리자 로그인 토큰일 때만 내용을 준다 |

## 1. 공개(노출 판정 거침) API

### 1.1 `GET /api/station-briefing/stations` — 관할 목록(설정 화면용)
요청 헤더/쿼리(노출 판정, §3): `X-Admin-Device`(또는 쿼리 `adminToken`·`endpoint`), `X-Admin-Token`(또는 쿼리 `adminAuthToken`).

```json
{ "ok": true, "audience": "admin", "display": true,
  "stations": [ { "key": "제주해양경찰서|한림파출소", "name": "한림파출소", "office": "제주해양경찰서",
                  "region": "제주지방해양경찰청", "seaOnly": false, "location": { "estimated": true } } ] }
```
`display:false` 이면 `stations: []`. `location` 은 카카오로 좌표를 얻었으면 `{lat,lon,estimated:false}`, 아니면 `{estimated:true}`.

### 1.2 `GET /api/station-briefing?station={key}&day=auto|today|tomorrow` — 관할 브리핑
- `day=auto`(기본) — U58: 21시 전이면 오늘 판, **21시부터 내일 판**. 내일 판(23:00 생성)이 아직 없으면 오늘 판을 주고 `fallback:true, wanted, nextExpectedAt:"…T23:00:00+09:00"`.
- 오류: `station` 없음 400 · `day` 이상 400 · 없는 관할 404(노출된 경우에만 검사). 노출 안 되면 언제나 200 + `display:false, briefing:null`.

```json
{ "ok": true, "audience": "admin", "display": true,
  "date": "2026-10-17", "fallback": false,
  "briefing": { …아래 §2… },
  "now": { "at": "2026-10-17T14:05:00+09:00", "count": 37, "gridCount": 12,
           "busiest": { "name": "한림항 북서방 1.2해리 해역(232-2해구)", "count": 18 },
           "text": "지금(14:05 기준) 관할 해역 선박 37척(교통 칸 12개) — 한림항 북서방 1.2해리 해역(232-2해구) 18척으로 충돌·접촉 주의" } }
```
`now` = 「지금 밀집」 한 줄(Q6 — AI 없음, **오늘 판에서만**, 요청 때 해상 통합 `briefing()` 의 현재 척수로 계산). 실시간 자료가 낡거나 없으면 `null`. 숫자는 위 예시처럼 형식만 보인 것.

## 2. 브리핑 본문(`briefing`) — `schema: "station-briefing-v1"`

예시는 한림 고정 시험 자료(가짜 숫자)로 실제로 만든 것을 줄인 것이다(`…` = 생략).

```json
{
  "schema": "station-briefing-v1", "rulesVersion": "station-briefing-rules-v1",
  "key": "제주해양경찰서|한림파출소",
  "station": { "name": "한림파출소", "office": "제주해양경찰서", "region": "제주지방해양경찰청" },
  "edition": "morning", "targetDate": "2026-10-17",
  "window": { "from": "2026-10-17T06:00:00+09:00", "to": "2026-10-18T00:00:00+09:00" },
  "generatedAt": "2026-10-17T08:00:00+09:00",
  "trigger": { "kind": "morning" },
  "seaOnly": false, "seaOnlyReason": null,
  "location": { "lat": 33.41, "lon": 126.26, "source": "estimate", "estimated": true, "method": "관할 관광지·위험구역 중심 평균(45점)", "address": "…" },
  "sources": { "accident": "ok", "congestion": "ok", "zoneForecasts": "ok", "warnings": "ok", "tourConcentration": "ok", "events": "ok" },
  "overview": { "land": "오늘 한림파출소 관할 육상은 관심 필요입니다(…). …", "sea": "오늘 한림파출소 관할 해상은 주의 필요입니다(관할 안 52칸 검토, 관심 이상 3개 해역). 대해구 232 예보는 15시부터 파고 2.4m·풍속 13m/s로 높아집니다(…). …", "source": "template", "model": null, "hash": "…" },
  "special": [
    { "kind": "release", "zone": "제주도북부앞바다", "title": "제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고(더 일찍 풀릴 수 있음)",
      "lines": ["해제 뒤 출항이 이어질 수 있습니다.", "2020~2025년 특보 해제 뒤 이틀 동안 전복·침몰·침수·표류 사고가 평소보다 약 1.2~1.3배 많았습니다."] },
    { "kind": "prewarn", "zone": "제주도서부앞바다", "title": "제주도서부앞바다 풍랑주의보 예비특보 — 21~24시 발효 예정", "lines": [] } ],
  "sea": {
    "level": { "rank": 2, "word": "주의 필요", "source": "공식 사고예보 '주의'" },
    "overviewLevel": { "rank": 2, "word": "주의 필요" },
    "reviewedCells": 52, "attentionRegions": 3, "missing": [],
    "weather": { "label": "대해구 232", "onsetAt": "…T15:00:00+09:00", "endAt": "…T21:00:00+09:00", "max": { "wh": 2.6, "ws": 14 }, "text": "대해구 232 예보는 15시부터 파고 2.4m·풍속 13m/s로 높아집니다(12시 파고 1.4m·풍속 9m/s), 21시부터 기준 아래로 내려갑니다" },
    "weatherByHaegu": { "232": { …weather 와 같은 꼴… } },
    "timeBar": [ { "at": "…T06:00:00+09:00", "label": "06시", "rank": 2, "word": "주의 필요", "region": "한림항 북동방 5.2해리 해역(232-3해구)",
                   "labels": ["제주도북부앞바다 풍랑주의보"], "events": [ { "kind": "release", "text": "제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고(더 일찍 풀릴 수 있음)" } ] }, … ],
    "cards": [ {
      "rid": "A:1001", "name": "비양도 북북서방 1.4해리 해역(232-2해구)", "nameBase": "비양도", "nameBaseKind": "place",
      "rank": 2, "word": "주의 필요", "sourceLabel": "공식 사고예보 '주의'", "window": "15~24시", "peakAt": "…T15:00:00+09:00",
      "overviewRank": 2, "overview": { "rank": 2, "word": "주의 필요", "window": "15~24시", "label": "공식 사고예보 '주의'(15~21시)·제주도서부앞바다 풍랑주의보 예비특보(발효 예정 시각 이후)(21~24시)", "at": "…" },
      "traits": { "history": { "from": "2021-01-01", "to": "2025-12-31", "count": 18, "topTypes": [ { "type": "충돌", "count": 7 } ], "death": 1, "missing": 0 },
                  "zone": { "name": "제주도서부앞바다", "kind": "main" }, "haegu": { "major": 232, "sub": 2, "label": "232-2" },
                  "text": "2021~2025년 선박사고 18건(충돌 7·침수 5), 사망 1·실종 0 · 제주도서부앞바다 · 232-2해구" },
      "today": { "lines": ["15~21시 공식 사고예보 '주의'", "15~18시 혼잡 예보 '높음'(15시 혼잡지수 12.3) → 충돌·접촉 주의", …],
                 "weather": { …sea.weather 꼴(이 해역 대해구)… },
                 "slots": [ { "at": "…T15:00:00+09:00", "rank": 2, "labels": ["공식 사고예보 '주의'", "혼잡 예보 '높음'(…) → 충돌·접촉 주의", "해구 예보 파고 2.4m·풍속 13m/s"] }, … ] },
      "sentence": "15~24시 이 해역은 공식 사고예보 '주의' 근거로 운항 시 주의가 필요합니다. 이 해역에서는 집계 기간 중 충돌 사고가 가장 많이 기록되었습니다.",
      "link": { "gridId": "GR4_1", "accidentGridId": "1001", "lat": 33.43, "lon": 126.22, "t": "…T15:00:00+09:00" } }, … ],
    "overviewTop": [ …cards 중 총평 후보(최대 2)… ] },
  "land": {
    "level": { "rank": 1, "word": "관심 필요", "source": "사람 평소의 1.8배" },
    "reviewedSpots": 4, "reviewedHazards": 1, "missing": [],
    "cards": [ { "id": "50110|협재해수욕장", "name": "협재해수욕장", "rank": 1, "word": "관심 필요", "sourceLabel": "사람 평소의 1.8배",
                 "index": 72, "band": "높음", "peakAt": "…T15:00:00+09:00",
                 "traits": { "hazard": { "count": 4, "byType": [ … ] }, "history": { "count": 6, "from": "2020-01-01", "to": "2024-12-31", "topTypes": [ … ] }, "beach": true, "text": "위험구역 4곳(…) · 2020~2024 연안사고 6건(표류 4) · 해수욕장" },
                 "today": { "changes": ["사람 평소의 1.8배", "해안 바람 9m/s(튜브·물놀이기구 떠밀림 주의)"], "text": "…" },
                 "sentence": "협재해수욕장 — 사람 평소의 1.8배, 해안 바람 9m/s(튜브·물놀이기구 떠밀림 주의). 물가 접근에 관심이 필요합니다.",
                 "missing": [], "link": { "spotId": "50110|협재해수욕장", "lat": 33.394, "lon": 126.239, "date": "2026-10-17" } } ],
    "constant": [ { "kind": "spot", "id": "50110|한림항", "name": "한림항", "text": "위험구역 3곳(사망사고 발생구역 3) · 2020~2024 연안사고 2건(추락 2)", "changedButLow": false },
                  { "kind": "hazard", "id": "한림-9", "name": "한림항 방파제", "text": "사망사고 발생구역 · 방파제" } ],
    "overviewTop": [ …cards 앞 3개… ] },
  "tide": null,
  "kmaOutlook": { "title": "…", "publishTime": "10.17. 05:00" },
  "notice": "참고 정보이며 안전을 보장하지 않습니다."
}
```

### 2.1 필드 뜻과 화면 쓰임

| 필드 | 뜻 | 화면 |
|---|---|---|
| `edition` | `morning`(08:00)·`evening`(17:30)·`night`(23:00)·`warning`(특보 변경)·`manual`(관리자 즉시 실행) | 머리 「기준 시각」 |
| `generatedAt` · `trigger` | 만든 시각 · 왜 만들었나(`{kind:'warning', zones:[바뀐 특보구역 열쇠]}`) | **N 뱃지**: 화면이 마지막으로 본 `generatedAt` 보다 새로우면 표시(§11.3 — 기존 `.new-badge`) |
| `window` | 이 판이 다루는 3시간 칸 범위(지난 칸 제외) | 시간 막대 범위 |
| `overview.land/sea` | 총평 두 문단. `land` 는 해상만 관할이면 `null` | ① 총평 |
| `overview.source` | `chatgpt`·`gemini`·`template`(+`reused:true` 면 지난 판 재사용) · `model` | 관리자만 작은 글씨로(선택) |
| `special[]` | 특별 상황 칸: `release`(해제 예고 — 문구 고정, `lines` 두 줄을 그대로) · `prewarn`(예비특보) | ② 특별 상황 |
| `sea.level` | 해상 분석 단계(공식 사고예보 순위 「주의」 포함) | ③ 해상 분석 머리 |
| `sea.overviewLevel` | 총평에 쓴 단계(순위만 「주의」인 칸 제외 — §11.6-17①) | 총평 옆 배지 |
| `sea.timeBar[]` | 3시간 칸마다 관할 최고 단계·그 해역·근거 이름·사건(`release`·`prewarn`·`warnStart`) | 해상 시간 막대(칸 색 = `rank` 0~3, 사건은 ⚑) |
| `sea.cards[]` | 해역 카드(최대 10, 순위 = 단계 > 지속 칸 > 기상·혼잡 겹침 > 과거 사고) | [특성] `traits.text` · [오늘 예상] `today.lines` · 틀 문장 `sentence` |
| `card.link` | 위험예측 화면으로 바로가기 재료 — 교통 칸 `gridId`(없으면 `accidentGridId`)·좌표·시각 `t` | [위험예측에서 보기 ›] (§11.4, U55) |
| `land.cards[]` | 오늘 바뀐 요소가 있는 관광지(최대 10) | ④ 육상 분석 |
| `land.constant[]` | 상시 위험 장소(바뀐 요소 없음 + 관광지에 안 붙은 위험구역, 최대 12) | 「상시 위험 장소」 접힘 목록 |
| `land.card.link` | `spotId`·좌표·`date` — 연안 시트(`/coast/spot?id=…&t=그 날짜`)로 | 바로가기 |
| `tide` | 서해·남해 관할만(아래 §2.2). 그 밖은 `null` | 조석 게이지 |
| `sources` · `sea.missing` · `land.missing` | 원천 상태. ok 가 아닌 원천의 근거는 판단에서 뺐다 | 「일부 자료 확인 불가」 |
| `rank` | 0 평소 수준 · 1 관심 필요 · 2 주의 필요 · 3 경계 필요 (`word` 가 그 말) | 색 |

### 2.2 조석(`tide`) — 해양종합정보 바텀시트 조석 게이지와 같은 재료
```json
{ "anchor": { "id": "A7", "distKm": 3.2 }, "date": "2026-10-17",
  "gauge": { "curve": [ { "t": "00:00", "cm": 312 }, …144개(10분) ], "peaks": [ { "type": "high", "t": "00:50", "cm": 610 }, { "type": "low", "t": "06:12", "cm": -12 }, … ],
             "prevPeak": { "type": "high", "t": "23:59", "cm": 600 }, "nextPeak": null, "unit": "cm" },
  "rocks": { "count": 1, "first": "07:10", "last": "18:40" },
  "text": ["저조 06:12·18:40 무렵 갯벌·고립 주의 — 물이 빠져 갯벌·바위가 드러나고, 물이 다시 차오를 때 고립될 수 있습니다(고조 00:50·12:30).",
           "관할 안 잠기는 바위(간출암) 1곳이 07:10~18:40 사이 물에 잠깁니다 — 바위 위 낚시·채취 중 고립에 주의가 필요합니다."] }
```
- 게이지(`ocean_bottom_sheet3.js` renderTideData)는 `peaks` 를 `{type, minutes, level}` 로 쓴다 — 화면에서 `minutes = HH*60+MM`, `level = cm` 로 바꾼다. `prevPeak` 는 **전날 자신의 시각**이다(화면이 1440 을 빼서 앞날로 민다 — hazard_rocks 곡선 API 와 같은 관례).
- 대표 위치가 서해·남해(물빠짐 대상)가 아니거나 25km 안 앵커·곡선이 없으면 `null`. 전날 곡선은 매일 밤 지워지므로 `prevPeak` 가 `null` 일 수 있다.
- 조석·잠기는 바위는 **문구에만** 쓰고 단계(점수)에는 넣지 않는다(U45).

## 3. 노출 판정 (기본 「관리자에게만」)

| 설정 `exposure` | 판정 |
|---|---|
| `user` | 모두에게 내용 |
| `admin`(기본) | ① 관리자 등록 기기 — `admin_devices.json` 의 FCM 토큰 또는 웹푸시 endpoint 와 **그대로 일치**(`advisory/displayControl.isAdminDevice`, 특보 예측 표출 제어와 같은 함수·같은 요청 이름: 쿼리 `adminToken`·`endpoint` 또는 헤더 `X-Admin-Device`) ② 아니면 관리자 로그인 토큰(`X-Admin-Token` 또는 쿼리 `adminAuthToken`, `admin_auth.verifyToken` — 기기 등록이 안 되는 PC) |
| `off` | 아무에게도 안 줌 |

응답의 `audience` = 설정값(`user`·`admin`·`off`), `display` = 이 요청에 내용을 줬는지. 화면은 `display:false` 면 아코디언을 그리지 않는다.

## 4. 관리자 API (모두 `X-Admin-Token` 필요 — 기존 `admin_auth.requireAdminToken`, 없으면 401)

| 경로 | 하는 일 |
|---|---|
| `GET /api/admin/station-briefing/config` | `{ok, config, choices}` |
| `PUT /api/admin/station-briefing/config` | 본문 JSON 에 바꿀 칸만. 선택지 밖 값이면 400 `설정값 오류: {칸}` |
| `GET /api/admin/station-briefing/status` | `{ok, config, choices, lastRun:{at,kind,zones,results:[{date,stations,stats:{calls,reused,ai,template,retried},errors}],ms}, done:[판 열쇠], errors:[최근 50 — {at,stage:'call'|'parse'|'validate',provider,stations,reason,edition,date}], days:[저장된 날짜], running}` |
| `POST /api/admin/station-briefing/run` | 지금 바로 만든다(화면이 지금 보일 날짜 — 21시 전 오늘, 이후 내일). 202 `{ok, started}` 즉시 응답, 결과는 status 로 |

설정 칸(기본값 굵게):

| 칸 | 선택지 |
|---|---|
| `method` 생성 방식 | **`chatgpt`**(VM → 꺼지면 Gemini → 틀) · `gemini`(Gemini → 틀) · `template`(AI 없음) |
| `chatgptModel` | **`gpt-6-luna`** · `gpt-6-sol` · `gpt-6-astra` (= `codex_bridge.ANSWER_MODELS` 에서 `gemini` 뺀 것) |
| `geminiModel` | **`gemini-2.5-flash`** · `gemini-2.5-flash-lite` |
| `exposure` 노출 범위 | `user` · **`admin`** · `off` |
| `batchUnit` 묶음 단위 | `station`(파출소, 97회) · **`office`**(해양경찰서, 21회) · `region`(지방청, 5회) |
| `onlyChanged` 바뀐 곳만 다시 | **`true`**(입력 해시가 지난 판과 같으면 AI 총평 재사용) · `false` |

## 5. AI 총평 검증(서버) — 실패한 관할만 1회 재시도, 그래도 실패면 틀

관할마다 따로 검사(`station_briefing_ai.validateOverview`): 문단 문장 수 3~5 · 해상만 관할의 육상 문단 금지 · 숫자는 서버 사실 문장 안 숫자만 · 「N배」는 그 관할 사람 혼잡 배수와(해제 칸이 있을 때) 1.2·1.3 만 · 항·포구·해수욕장·앞바다·해구·파출소 이름은 허용 지명만 · 「관심/주의/경계(가) 필요」는 문장 속 대상의 서버 단계를 넘지 못함(「관심」은 늘 허용) · 따옴표 공식 단계 이름(`'주의'` 등)은 서버 문장에 있는 것만 · 해상 첫 해역·육상 첫 장소 이름 필수 · 금지어(순찰·배치·출동·단속·통제·사고 확률·확률·「안전합니다」 등). 실패는 `status.errors` 에 남는다.
AI 입력에는 기상청 해상 기상 전망(단기 통보문) 원문 발췌(`marine_forecast.json` shortTerm `codeCategories` — 해상·강풍·너울·바다안개, 각 600자)를 원인·흐름 참고용으로 넣는다. 그 안의 숫자·지명은 허용 목록에 넣지 않는다(옮기면 검증 실패).

## 6. 저장 위치(운영 볼륨 `local_server/data/station_briefing/`)

`config.json`(설정) · `state.json`(만든 판·특보 서명·관할별 특보구역·마지막 실행·오류 200개) · `briefings_YYYY-MM-DD.json`(어제·오늘·내일만 남김) · `locations.json`(대표 위치 — 카카오 결과·실패 사유).

## 7. 화면 단계에 넘기는 메모

- 관할 고르기는 §11.6 Q3 「파출소 관할 하나만 고르면 해상·육상 둘 다」 — `stations` 의 `key` 를 저장한다.
- 해상만 관할은 육상 칸 대신 `seaOnlyReason` 한 줄.
- 시간 막대 색은 단계 0~3. `events` 가 있는 칸에 ⚑.
- 「지금 밀집」(`now`)은 오늘 판에서만 온다.
- 관리자 오류현황(위험예측 오류현황 `risk_error_history`)에는 아직 안 넣었다 — 그 원천 목록을 늘리면 데이터 수집현황 목록표·관리자 원천 선택지까지 함께 바뀌어야 해서 이번 단계는 `status.errors` 로만 둔다(사용자 판단 필요).
