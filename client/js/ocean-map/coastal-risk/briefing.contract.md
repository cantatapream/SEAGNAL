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
| 생성 | 08:00 · 17:30 · 23:00 KST(23시 판 = 「오늘 밤~내일」, 대상 날짜 = 내일) + 특보가 바뀔 때(바뀐 특보구역에 걸친 관할만). 운영 서버(FLY)에서만 · 특보 변경은 마지막 변경 뒤 3분 조용할 때 한 번(계속 바뀌어도 첫 변경 뒤 15분이면) · 실행이 실패하면 10분 쉬고 같은 판은 3번까지 |
| 판단 | 전부 서버 규칙. AI 는 **총평 두 문단(육상·해상, 각 3~5문장)만**. 카드·근거·특별 상황은 서버 틀 문장 |
| AI 순서 | ChatGPT(관리자 정액제 VM) → 꺼짐·실패면 Gemini → 둘 다 실패면 틀 총평. 해양경찰서별 묶음(21회/판), 입력이 같으면 재사용 |
| 노출 기본값 | **관리자에게만** — 관리자 등록 기기 또는 관리자 로그인 토큰일 때만 내용을 준다 |
| 특보 시각 | 기상청이 준 발표·발효(예정)·해제 예고 시각 그대로(2026-10-16 결정 1 — 「더 일찍 풀릴 수 있음」 같은 꼬리 없음). 시각 종류·출처 표는 설계서 §11.8 |
| 오류 | 관리자 오류현황(위험예측 오류현황) 원천 `stationBriefing` — 실행 실패·10시간 넘게 실행 없음·AI 총평 대신 틀(결정 6, §6.1) |

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
  "schema": "station-briefing-v1", "rulesVersion": "station-briefing-rules-v3",
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
    { "kind": "release", "zone": "제주도북부앞바다", "title": "제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고(10월 16일 21:00 발표)",
      "lines": ["해제 뒤 출항이 이어질 수 있습니다.", "2020~2025년 특보 해제 뒤 이틀 동안 전복·침몰·침수·표류 사고가 평소보다 약 1.2~1.3배 많았습니다."] },
    { "kind": "prewarn", "zone": "제주도서부앞바다", "title": "제주도서부앞바다 풍랑주의보 예비특보 — 21~24시 발효 예정(05:00 발표)", "lines": [] } ],
  "sea": {
    "level": { "rank": 2, "word": "주의 필요", "source": "공식 사고예보 '주의'", "partial": false },
    "overviewLevel": { "rank": 2, "word": "주의 필요" },
    "reviewedCells": 52, "attentionRegions": 3, "missing": [], "missingSlots": {},
    "weather": { "label": "대해구 232", "onsetAt": "…T15:00:00+09:00", "endAt": "…T21:00:00+09:00", "max": { "wh": 2.6, "ws": 14 }, "text": "대해구 232 예보는 15시부터 파고 2.4m·풍속 13m/s로 높아집니다(12시 파고 1.4m·풍속 9m/s), 21시부터 기준 아래로 내려갑니다" },
    "weatherByHaegu": { "232": { …weather 와 같은 꼴… } },
    "timeBar": [ { "at": "…T06:00:00+09:00", "label": "06시", "rank": 2, "word": "주의 필요", "region": "한림항 북동방 5.2해리 해역(232-3해구)",
                   "labels": ["제주도북부앞바다 풍랑주의보"], "events": [ { "kind": "release", "text": "제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고(10월 16일 21:00 발표)" } ] }, … ],
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
    "level": { "rank": 2, "word": "주의 필요", "source": "연안 위험지수 72 '높음'" },
    "reviewedSpots": 4, "failedSpots": 0, "reviewedHazards": 1, "missing": [],
    "cards": [ { "id": "50110|협재해수욕장", "name": "협재해수욕장", "rank": 2, "word": "주의 필요", "sourceLabel": "연안 위험지수 72 '높음'",
                 "index": 72, "band": "높음", "peakAt": "…T15:00:00+09:00",
                 "traits": { "hazard": { "count": 4, "byType": [ … ] }, "history": { "count": 6, "from": "2020-01-01", "to": "2024-12-31", "topTypes": [ … ] }, "beach": true, "text": "위험구역 4곳(…) · 2020~2024 연안사고 6건(표류 4) · 해수욕장" },
                 "today": { "changes": ["사람 평소의 1.8배", "해안 바람 9m/s(튜브·물놀이기구 떠밀림 주의)"], "text": "…" },
                 "sentence": "협재해수욕장 — 사람 평소의 1.8배, 해안 바람 9m/s(튜브·물놀이기구 떠밀림 주의). 물가 접근에 주의가 필요합니다.",
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
| `special[]` | 특별 상황 칸: `release`(해제 예고 — 「… — 06~09시 해제 예고(10월 16일 21:00 발표)」, `lines` 두 줄을 그대로) · `prewarn`(예비특보 — 「… 예비특보 — 21~24시 발효 예정(05:00 발표)」) · `released`(이미 해제 — 특보 구간 기록의 실제 해제 시각, 「… — 07:30 해제」 + 해제 안내 두 줄). 시각은 기상청 것 그대로, 발표 시각이 있으면 괄호로(결정 1). 해제 예고·발효 예정 **범위가 창과 겹치면** 넣는다(창 시작 전에 시작해도 — 17:30 판의 「12~18시 해제 예고」). 특보 원천(`sources.warnings`)이 ok 가 아니면 만들지 않는다(시간 막대 사건도) | ② 특별 상황 |
| `sea.level` | 해상 분석 단계(공식 사고예보 순위 「주의」 포함). 남은 자료로 0 인데 원천이 빠졌으면 `word` 가 「확인 불가(일부)」(넷 다 빠지면 「확인 불가」) — 「평소 수준」이라 쓰지 않는다(`partial:true`) | ③ 해상 분석 머리 |
| `sea.overviewLevel` | 총평에 쓴 단계(순위만 「주의」인 칸 제외 — §11.6-17①). 결측 규칙은 `sea.level` 과 같다 | 총평 옆 배지 |
| `sea.timeBar[]` | 3시간 칸마다 관할 최고 단계·그 해역·근거 이름·사건(`release`·`prewarn`·`released`·`warnStart`). 특보 해제 뒤 「관심」은 **해제 뒤 1시간이 걸친 칸만**(결정 4 — 「Z 풍랑주의보 해제 뒤」·이미 해제면 「…(07:30 해제)」) | 해상 시간 막대(칸 색 = `rank` 0~3, 사건은 ⚑) |
| `sea.cards[]` | 해역 카드(최대 10, 순위 = 단계 > 지속 칸 > 기상·혼잡 겹침 > 과거 사고). `window`·`today.lines`·`overview.window` 는 이어진 칸 묶음별 — 끊기면 「06~09시·21~24시」(하나로 잇지 않는다), `peakAt` = 가장 높은 단계의 첫 칸. `traits.history` 가 `{count:0, available:false}` 면 「선박사고 이력 자료 없음(집계 불가)」, `available:true` 면 「…선박사고 기록 없음」(0건). `sea.overviewTop` 은 카드 상한과 상관없이 총평 단계 순위에서 고른다(카드 10개 밖이어도 총평 근거면 들어간다) | [특성] `traits.text` · [오늘 예상] `today.lines` · 틀 문장 `sentence` |
| `card.link` | 위험예측 화면으로 바로가기 재료 — 교통 칸 `gridId`(없으면 `accidentGridId`)·좌표·시각 `t` | [위험예측에서 보기 ›] (§11.4, U55) |
| `land.cards[]` | 관심 이상 관광지(최대 10). 단계(결정 2): **경계** = 풍랑·태풍·강풍 경보 발효 · 연안 위험지수 100('매우 높음') + 오늘 바뀐 요소 / **주의** = 주의보 발효 · 지수 '높음'(67+) + 바뀐 요소 / **관심** = '다소 높음' 이상 + 바뀐 요소 · 예비특보 · 떠밀림 · 행사 · 특보 해제 뒤 3시간(결정 4). `sourceLabel` = 무엇 때문인지(「연안 위험지수 72 '높음'」·「풍랑주의보」·「풍랑주의보 해제 뒤(07:30 해제)」). `today.changes` 의 특보는 기상청 시각째: 「풍랑주의보 발효(06~09시 해제 예고, 10월 16일 14:00 발표)」·「강풍주의보 예비특보(10월 18일 03:00 발효 예정)」 | ④ 육상 분석 |
| `land.constant[]` | 상시 위험 장소(바뀐 요소 없음 + 관광지에 안 붙은 위험구역, 최대 12) | 「상시 위험 장소」 접힘 목록 |
| `land.card.link` | `spotId`·좌표·`date` — 연안 시트(`/coast/spot?id=…&t=그 날짜`)로 | 바로가기 |
| `tide` | 서해·남해·**제주** 관할(아래 §2.2, 제주는 결정 5). 동해 등 그 밖은 `null` | 조석 게이지 |
| `sources` · `sea.missing` · `sea.missingSlots` · `land.missing` · `land.failedSpots` | 원천 상태. ok 가 아닌 원천의 근거는 판단에서 뺐다. `sea.missingSlots.accident` = 공식 사고예보 원천은 ok 인데 프레임이 빠진 칸(그 칸 사고예보는 「없음」이 아니라 확인 불가 — `sea.missing` 에도 `accident`). `land.reviewedSpots` 는 연안 하루 값을 실제로 받은 곳만, 실패 수는 `failedSpots`(`land.missing` 에 `detail`). 빠진 원천은 총평 첫 문장에 이름으로 밝힌다 | 「일부 자료 확인 불가」 |
| `rank` | 0 평소 수준 · 1 관심 필요 · 2 주의 필요 · 3 경계 필요 (`word` 가 그 말) | 색 |

### 2.2 조석(`tide`) — 해양종합정보 바텀시트 조석 게이지와 같은 재료
```json
{ "anchor": { "id": "A7", "distKm": 3.2 }, "region": "westsouth", "date": "2026-10-17",
  "gauge": { "curve": [ { "t": "00:00", "cm": 312 }, …144개(10분) ], "peaks": [ { "type": "high", "t": "00:50", "cm": 610 }, { "type": "low", "t": "06:12", "cm": -12 }, … ],
             "prevPeak": { "type": "high", "t": "23:59", "cm": 600 }, "nextPeak": null, "unit": "cm" },
  "rocks": { "count": 1, "first": "07:10", "last": "18:40" },
  "text": ["06:12 저조 뒤부터 물이 차오릅니다(12:30 고조) · 18:40 저조 뒤부터 물이 차오릅니다(10월 18일 00:55 고조) — 갯벌·바위에 나가 있다면 물이 차오르기 전에 나오세요.",
           "관할 안 잠기는 바위(간출암) 1곳이 07:10~18:40 사이 물에 잠깁니다 — 바위 위 낚시·채취 중 고립에 주의가 필요합니다."] }
```
- 게이지(`ocean_bottom_sheet3.js` renderTideData)는 `peaks` 를 `{type, minutes, level}` 로 쓴다 — 화면에서 `minutes = HH*60+MM`, `level = cm` 로 바꾼다. `prevPeak` 는 **전날 자신의 시각**이다(화면이 1440 을 빼서 앞날로 민다 — hazard_rocks 곡선 API 와 같은 관례).
- `region`: `westsouth`(서해·남해 — 물빠짐 앵커 `tide_field`) · `jeju`(제주 — 제주 고립판정 촘촘 격자 앵커 `curves_jeju`, 그 격자가 없으면 제주 간출암 앵커 `hazard_rocks/curves`; 2026-10-16 결정 5 *"나 는 반영하자"*). 둘 다 매일 KST 23:30 자동 수집, 같은 꼴.
- 대표 위치가 서해·남해·제주가 아니거나 25km 안 앵커·곡선이 없으면 `null`. 전날 곡선은 매일 밤 지워지므로 `prevPeak` 가 `null` 일 수 있다.
- `text` 첫 줄은 **밀물(저조 → 다음 고조) 중심**(결정 5 *"저조가 아니라 고조지 않니? 물이 오르는시간이니까"*): 「HH:MM 저조 뒤부터 물이 차오릅니다(HH:MM 고조)」를 창(`window`)에 걸친 밀물마다 「 · 」로 잇고 「 — 갯벌·바위에 나가 있다면 물이 차오르기 전에 나오세요.」로 끝낸다. 창 앞 저조라도 고조가 창 안이면 넣고(23시 판은 전날 곡선의 밤 저조에 날짜를 붙여 — 「10월 17일 18:40 저조 뒤부터 …(10월 17일 22:50 고조)」), 다음 날 첫 고조는 `nextPeak`. 게이지(`gauge.peaks`)는 그날 것 전부 그대로.
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
| `PUT /api/admin/station-briefing/config` | 본문 JSON 에 바꿀 칸만. 선택지 밖 값이면 400 `설정값 오류: {칸}`, 모르는 칸(`__proto__`·`constructor` 포함)이면 400 `설정 칸 오류: {칸}` |
| `GET /api/admin/station-briefing/status` | `{ok, config, choices, lastRun:{at,kind,zones,results:[{date,stations,stats:{calls,reused,ai,template,retried,deadline},errors}],ms}, done:[판 열쇠], errors:[최근 50 — {at,stage:'call'|'parse'|'validate'|'deadline'|'run',provider,stations,reason,edition,date}], days:[저장된 날짜], running, failures:{판 열쇠 또는 warning → {count,lastAt,reason}}, pendingWarn:{zones,lastChangeAt}|null}` — `lastRun.aiDisabled` 가 있으면 개발 환경이라 틀 총평만 만든 것. `errors[].stage` 에 `run`(실행 실패)·`deadline`(데드라인 넘어 틀) 추가 |
| `POST /api/admin/station-briefing/run` | 지금 바로 만든다(화면이 지금 보일 날짜 — 21시 전 오늘, 이후 내일). 202 `{ok, started}` 즉시 응답, 결과는 status 로. **이미 실행 중이면 409** `{ok:false, started:false, running:true, error, lastRun}`(예전에는 202 라고 답하고 건너뛰었다) |

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

관할마다 따로 검사(`station_briefing_ai.validateOverview`, 2026-10-16 독립 검토 반영 — 판 `sb-validate-v2`). 모든 대조는 **NFKC 정규화**한 글로(전각 「９９m」 → 「99m」):
- 모양: 문단 문장 수 3~5 · 해상만 관할의 육상 문단 금지 · **HTML 태그·URL·마크다운 링크 금지**(`markup`).
- 숫자: **「숫자+단위」째**(m·m/s·km·cm·해리·해구·시·시간·분·초·칸·척·건·곳·명·개·배·%·년·월·일, 시각 HH:MM) 서버 사실 문장(틀 총평 포함)에 있는 꼴만 — 「3m」는 「232-3해구」의 3 으로 통과하지 못한다. 범위(「12~15m/s」)는 **범위 자체**가 입력에 있어야 한다(입력 범위의 양 끝은 낱으로도 허용). 단위 없는 숫자도 입력에 단위 없이 있어야. **한글 수사**(「세 시」·「두 척」·「서른 미터」·「구 미터」)는 대조할 수 없어 막는다.
- 배수: **문단별** — 해상은 해제 칸이 있을 때 1.2·1.3·1.2~1.3 만(「사고 1.8배」·「두 배」 금지), 육상은 그 관할 사람 혼잡 배수만.
- 지명: 항·포구·해수욕장·해변·앞바다·먼바다·연안바다·해구·파출소·해양경찰서·방파제·**갯바위·부두·등대·섬·곶·만·포·도** 접미사, 띄어 쓴 지명(「제주도 동부 앞바다」)도 앞 낱말을 붙여 대조. 허용 = 허용 이름이 후보의 **끝에 오는** 경우(「한림항 방파제」 ⊃ 「한림항」은 되지만 「림항」·「한림해수욕장」은 안 됨) 또는 이름 줄기(파출소 이름에서 「파출소」를 뗀 「한림」, 특보구역 줄기 「제주도」, 띄어 쓴 허용 이름의 앞 낱말)와 정확히 같을 때. 「바람도」·「정도」·「운항」 같은 낱말은 지명으로 보지 않는다.
- 단계 말: 「관심/주의/경계」 + **필요·요구·요망·단계·수준·하십시오·하세요·해야·바랍니다·기울·태세·강화** 등 모든 서술 꼴. 문단별 대상 단계(`levels.sea`·`levels.land` — 관할 이름은 그 문단 단계, 육상 관광지는 결정 2 의 카드 단계 그대로 — 지수 '높음'이면 주의까지)를 넘지 못하고, **대상 이름이 없는 문장은 그 문단의 가장 낮은 단계까지**(「관심」은 늘 허용). 서버 사실 문장(조석·해제 안내)을 그대로 옮긴 문장은 제외.
- 공식 단계 이름(`'주의'` 등)은 서버 문장에 있는 것만 · 해상 첫 해역·육상 첫 장소 이름 필수 · **빠진 원천 이름 필수**(`required.missing` — 그 문단에 「…자료를 확인하지 못했다」).
- 금지어: **공백·제로폭 문자를 지우고** 대조(「순 찰」·「순​찰」도) — 순찰·배치·출동·단속·통제·**투입·경비정·검문·감시 강화·집중 감시·근무**·사고 확률·확률. 안전 단정: 「안전합니다」·**「안전한 상태」·「이상 없」·「문제없」·「위험 요소가 (전혀) 없」·「걱정 없」·「우려 없」**(「특별한 위험 요소는 확인되지 않았습니다」는 허용 — coastal_risk §10.3).
- **화면은 총평·카드 문장을 `textContent` 로만 넣는다**(innerHTML 금지) — 검증이 HTML 을 거르더라도 화면이 한 번 더 막는다.

실패는 `status.errors` 에 남는다.
AI 입력에는 기상청 해상 기상 전망(단기 통보문) 원문 발췌(`marine_forecast.json` shortTerm `codeCategories` — 해상·강풍·너울·바다안개, 각 600자)를 원인·흐름 참고용으로 넣는다. 그 안의 숫자·지명은 허용 목록에 넣지 않는다(옮기면 검증 실패).

### 5.1 AI 호출·실행의 시간·재시도 규칙 (2026-10-16 독립 검토 반영)
| 무엇 | 규칙 |
|---|---|
| 호출 시간 제한 | 호출마다 VM 320초(codex_bridge 자체 300초 뒤)·Gemini 100초 — 넘으면 끊기 요청(`signal`)과 함께 다음 공급자로. 실제 Gemini 어댑터는 `config.abortSignal`(90초, @google/genai)로 요청을 끊는다(gemini_client 는 고치지 않음) |
| 실행 데드라인 | 한 번 실행에 AI 20분 — 넘으면 남은 관할은 틀 총평(`errors[].stage:'deadline'`, `stats.deadline`) |
| VM 차단기 | VM 이 잇달아 3번 실패(호출·시간초과·해석)하면 그 실행 동안 VM 을 건너뛰고 Gemini 로 |
| 재사용 해시 | 관할 입력 + 규칙 판(`rulesVersion`)·검증 판·지시문 판 + 생성 방식 + ChatGPT·Gemini 모델 + 기상청 전망. 같은 해시라도 지난 글이 ChatGPT 방식인데 Gemini 가 쓴 것이면 VM 이 살아 있을 때 다시 만든다 |
| 실행 실패 | 실행이 던지면(파일 쓰기 실패 등) `status.failures` 에 횟수·시각을 남기고 10분 뒤 다시, 같은 판은 3번까지(특보 변경도 같게 — 3번 실패하면 그 특보 서명을 받아들이고 멈춤). 매분 다시 모으거나 AI 를 다시 부르지 않는다 |
| 특보 변경 | 마지막 변경 뒤 3분 조용할 때 한 번(그 사이 바뀐 구역은 합침). 내용이 같은 채 파일 시각만 바뀌면 기다림을 늘리지 않고, 계속 바뀌어도 첫 변경 뒤 15분이면 만든다. 내일 판을 고칠 때 21시 전이면 내일 0시부터(오늘 칸을 섞지 않음) |
| 개발 환경 | 실제 AI 는 운영(`FLY_ALLOC_ID`) 또는 `STATION_BRIEFING_DEV_AI=1` 일 때만 — 그 밖의 관리자 실행은 틀 총평(`lastRun.aiDisabled`) |
| 대표 위치 | 카카오 묻기는 한 실행 60초·한 건 15초 상한. 키 없음·401·403 이면 그 자리에서 멈추고 6시간, 호출 고장이 3번 이어지면 30분 묻지 않는다(`locations.json` 의 `backoff`). 실패 로그는 실행마다 한 줄. 주소나 정리된 질의가 바뀌면 「일치 없음」이었던 곳도 다시 묻는다 |
| 시각 | 연안 하루 값은 모으기 직전 시각으로 묻는다(위치 찾기·AI 가 오래 걸려도 risk_store 의 「지금−5분」 거부에 걸리지 않게) |

## 6. 저장 위치(운영 볼륨 `local_server/data/station_briefing/`)

`config.json`(설정) · `state.json`(만든 판·특보 서명·관할별 특보구역·마지막 실행(`lastRun.method` 포함)·오류 200개) · `briefings_YYYY-MM-DD.json`(어제·오늘·내일만 남김) · `locations.json`(대표 위치 — 카카오 결과·실패 사유).
읽기만 하는 것: `data/risk_forecast/warning_history.json`(특보 구간 기록 `sea_warning_history` — 이미 해제된 특보의 실제 해제 시각, 결정 4. 해제 뒤 기간이 가장 긴 육상 3시간에 맞춰 창 시작 3시간 전부터).

### 6.1 관리자 오류현황 원천 `stationBriefing` (결정 6)
| 상태 | 언제 | 분류·상세 |
|---|---|---|
| `error` | 실행 실패(`state.failures`)가 마지막 실행보다 나중 | 분류 = 고정 이름(`io.errorName`, 원문은 넘기지 않음) · 상세 「브리핑 실행 실패(연속 N번, 마지막 MM-DD HH:MM KST)」 |
| `missing` | 실행 기록 없음 | — |
| `stale` | 마지막 실행이 10시간 넘음(정시 판 최장 간격 23:00→08:00 9시간 + 1시간) | 상세 「마지막 실행 … — 정시 판이 10시간 넘게 없음」 |
| `partial` | AI 방식(`method` ≠ template, 개발 환경 아님)인데 마지막 실행에서 틀 총평으로 대체된 관할이 있음 | 분류 「브리핑 일부 실패 — AI 총평 대신 틀」 · 상세 「마지막 실행 AI 총평 대신 틀 N곳(validate n·call n) — 생성 방식 chatgpt」 |
| `ok` | 그 밖(VM 이 실패하고 Gemini 가 쓴 것처럼 결과가 AI 면 정상) | — |

판정 함수는 `station_briefing.historyRow` 하나 — 실행 직후(`run`·`reportFailure`)와 1분 감시(`risk_history_sources.briefingSource`, 운영만)가 같은 판정이라 감시가 다른 상태로 덮어 가짜 사건을 만들지 않는다. 데이터 수집현황 목록표 1단계 「활동지점 안전 브리핑 (우리 서버 생성)」(출처 `seagnal` 「우리 서버 생성」, 일정 08:00·17:30·23:00), 관리자 원천 선택지 「활동지점 안전 브리핑」.

## 7. 화면 단계에 넘기는 메모

- 관할 고르기는 §11.6 Q3 「파출소 관할 하나만 고르면 해상·육상 둘 다」 — `stations` 의 `key` 를 저장한다.
- 해상만 관할은 육상 칸 대신 `seaOnlyReason` 한 줄.
- 시간 막대 색은 단계 0~3. `events` 가 있는 칸에 ⚑.
- 「지금 밀집」(`now`)은 오늘 판에서만 온다.
- 관리자 오류현황(위험예측 오류현황 `risk_error_history`)에 원천 `stationBriefing` 으로 들어간다(2026-10-16 결정 6 *"추천대로"* — §6.1). 상세 오류 목록은 여전히 `status.errors`.
