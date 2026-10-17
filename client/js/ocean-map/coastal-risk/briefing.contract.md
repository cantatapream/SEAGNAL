# 연안 안전 브리핑(종전 「활동지점 안전 브리핑」) — 서버 API 계약 (1단계 구현 2026-10-16 · 공개 시각·분석 문단 2026-10-17 §11.10.4)

> 화면(해양예보 탭 아코디언·설정 흐름·관리자 「AI 브리핑」 탭)은 **다음 단계**다. 이 문서는 그 단계가 서버를 그대로 쓰도록
> 경로·요청·응답 필드·노출 판정·설정 API 를 정한다. 요구사항 원문: `coastal_safety_forecast.design.md` §11.6 결정 1~17.
> 서버 파일: `local_server/routes/station_briefing.js` · `services/station_briefing{,_rules,_ai,_inputs}.js` · 시험 `scripts/test_station_briefing.js`.
> 파출소 주소 확인 목록: `station_addresses.md`(같은 폴더).

## 0. 한눈에

> **2026-10-17 바뀐 것(설계서 §11.10.4)** — 화면 이름 「연안 안전 브리핑」·제목 「HH:MM AI 연안 안전 브리핑」 · 정시 판은 **만들기 시작 07:10·17:10·22:40 → 공개 07:30·17:30·23:00**(공개 전에는 날짜 파일 `pending`, 그동안 API 는 이전 판 — §1.2·§6) · 특보 변경·관리자 실행은 곧바로 공개 ·
> AI 는 관할마다 **연안·해상 분석 문단(각 3~5문장, 마지막 「따라서 … 필요합니다」)** · 다시 시도 **VM 최대 3번(버려진 이유를 지시문에) → Gemini 한 번 → 서버 규칙 분석(`summary.analysis`)** · 데드라인 = min(20분, 공개 시각까지).
> 아래 표의 「08:00」·「1~2문장 해설」·「1회 재시도」·「틀(해설 없음)」 줄은 그 전 이력이며 각 줄 끝의 ⚠ 표시가 지금 값을 가리킨다.

| 무엇 | 어떻게 |
|---|---|
| 단위 | 파출소 관할 97곳(`config/coastal_safety/coastguard_stations.geojson`). 열쇠 `key` = `"{해양경찰서}|{파출소}"`(남항파출소가 부산·목포 둘이라 이름만으로는 안 된다) |
| 해상만 | 목포·완도·여수해양경찰서 19곳(여수바다 포함) — `seaOnly:true`, `land:null` |
| 생성 | ⚠§11.10.4 부터 07:10·17:10·22:40 시작 → 07:30·17:30·23:00 공개(종전 08:00 · 17:30 · 23:00 KST) (23시 판 = 「오늘 밤~내일」, 대상 날짜 = 내일) + 특보가 바뀔 때(바뀐 특보구역에 걸친 관할만). 운영 서버(FLY)에서만 · 특보 변경은 마지막 변경 뒤 3분 조용할 때 한 번(계속 바뀌어도 첫 변경 뒤 15분이면) · 실행이 실패하면 10분 쉬고 같은 판은 3번까지 |
| 판단 | 전부 서버 규칙. 「총평과 권고」의 **결론·근거·권고·물때(`summary`)도 서버**가 만들고, AI 는 그 아래 **짧은 해설(육상·해상 각 1~2문장 — `overview.land/sea`)만**(2026-10-17 결정, 설계서 §11.10 — 종전 「총평 두 문단 3~5문장」 대체). 카드·특별 상황은 서버 틀 문장 |
| AI 순서 | ChatGPT(관리자 정액제 VM) → 꺼짐·실패면 Gemini → 둘 다 실패면 틀(AI 해설 없음). 해양경찰서별 묶음(21회/판), 입력이 같으면 재사용. ⚠§11.10.4 부터: VM 최대 3번(실패 관할만, 이유 되먹임) → Gemini 한 번 → 규칙 분석(`summary.analysis`) |
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

### 1.1b `GET /api/station-briefing/areas` — 관할 구역(설정 화면 「지도에서 선택하기」, 2026-10-17 추가)
노출 판정·헤더는 1.1 과 같다. 지도 탭을 처음 열 때만 부른다(97곳 약 158KB, 서버 압축 약 33KB — `compression()`).
```json
{ "ok": true, "audience": "admin", "display": true,
  "areas": [ { "key": "제주해양경찰서|한림파출소", "seas": ["제주"],
               "geometry": { "type": "Polygon", "coordinates": [[[126.2, 33.4], …]] } } ] }
```
- `geometry` = 정리판(`coastguard_stations.geojson`) 관할 폴리곤, 좌표만 소수 넷째 자리(약 11m)로 반올림 — 꼭짓점을 줄이지(단순화) 않는다.
- `seas` = 관할이 걸치는 해역(앱 `SEA_REGIONS` 의 `동해`·`서해`·`남해`·`제주`), 많이 걸친 차례(첫째 = 주 해역). 규칙은 `station_briefing_inputs.stationSeas` —
  관할 안 표본점(상자 12×12)이 드는 특보구역(앞바다·먼바다 44곳)의 해역(`push_helpers.ZONE_HIERARCHY`)을 센다. 지방청(`region`)과 다를 수 있다
  (여수·완도서 11곳 남해 · 울산서 4곳 동해 · 추자 남해+제주 · 땅끝 서해+남해 · 기장 남해+동해 — 2026-10-17 실측).
- `display:false` 이면 `areas: []`.

### 1.2 `GET /api/station-briefing?station={key}&day=auto|today|tomorrow` — 관할 브리핑
- **공개 대기(§11.10.4)**: 정시 판은 공개 시각(`publishAt` 07:30·17:30·23:00) 전에는 날짜 파일 `pending` 에만 있고 이 API 는 이전 판을 준다. 공개 시각이 지난 판 중 **나중에 만든 것**(`generatedAt`)을 준다 — 대기 중 생긴 특보 변경 판·관리자 판을 공개 시각에 덮지 않는다. 보일 판이 없고 대기 판이 있으면 `nextExpectedAt` = 그 공개 시각.
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
  "schema": "station-briefing-v1", "rulesVersion": "station-briefing-rules-v7",
  "key": "제주해양경찰서|한림파출소",
  "station": { "name": "한림파출소", "office": "제주해양경찰서", "region": "제주지방해양경찰청" },
  "edition": "morning", "targetDate": "2026-10-17",
  "window": { "from": "2026-10-17T06:00:00+09:00", "to": "2026-10-18T00:00:00+09:00" },
  "generatedAt": "2026-10-17T08:00:00+09:00", "publishAt": "2026-10-17T08:00:00+09:00",   ← §11.10.4 부터 정시 판은 만들기 시작 시각(07:10)·공개 시각(07:30)
  "trigger": { "kind": "morning" },
  "seaOnly": false, "seaOnlyReason": null,
  "location": { "lat": 33.41, "lon": 126.26, "source": "estimate", "estimated": true, "method": "관할 관광지·위험구역 중심 평균(45점)", "address": "…" },
  "sources": { "accident": "ok", "congestion": "ok", "zoneForecasts": "ok", "warnings": "ok", "tourConcentration": "ok", "events": "ok" },
  "summary": {
    "weather": { "zone": "제주도서부앞바다", "distKm": 0.5, "kind": "coastal", "note": null,
                 "rows": [ { "label": "오늘 오전", "text": "구름많음 · 파고 0.5~1.5m · 풍속 7~11m/s · 풍향 동→남동", "ok": true }, { "label": "오늘 오후", "text": "…", "ok": true } ],
                 "source": "제주지방기상청 단기 해상예보 (10.17 05:00 발표)", "missing": false,
                 "notes": ["오늘 오후부터 제주도에 순간풍속 15m/s 안팎의 강한 바람(곳에 따라)", "풍랑 예비특보: 오늘 밤(18~24시) 제주도남쪽바깥먼바다 — 물결 1.5~3.0m로 높아짐"], "notesFound": true,
                 "notesSource": "제주지방기상청 단기 전망 (10.17 04:40 발표)", "bulletinMissing": false },
    "tide": [ …tide.text 그대로… ],
    "isolation": { "text": "(고립 주의) 저조 시간(06:12·18:40) 전후 사고 지점(5개소) 확인 및 주의가 필요합니다.", "link": "사고 지점(5개소)", "lows": ["06:12", "18:40"],
                   "rows": [ { "name": "도시해녀", "count": 1 }, …관할 관광지 중 고립 사고가 있는 곳 전부(건수 많은 순·이름 순)… ], "caption": "2020~2024 연안사고 기록 중 고립(관광지 구역 + 앞바다 500m)" },
    "land": { "headline": "오늘 한림파출소 관할 연안의 단계는 \"주의 필요\"입니다.",
              "basis": ["관할 관광지 4곳 중 평소보다 위험이 높아진 곳 2곳 (주의 1곳 · 관심 1곳)", "협재해수욕장 — 연안 위험지수 72(높음, 예상), 방문객 평소의 1.8배(예상), 해안 바람 9m/s(예상, 튜브·물놀이기구 떠밀림 주의)", "금능해수욕장 — 연안 위험지수 41(다소 높음, 예상), 방문객 평소의 1.3배(예상)"],
              "advice": "협재해수욕장·금능해수욕장 주변 연안사고에 주의가 필요합니다." },
    "sea": { "headline": "오늘 한림파출소 관할 해상의 단계는 \"주의 필요\"입니다.",
             "basis": ["관할 해역 30칸 중 위험이 높아진 해역 3칸", "해양사고 위험예보만 '주의·경계'인 해역 15칸", "대해구 232 예보 15시부터 파고 2.4m·풍속 13m/s로 높아짐(예상), 21시부터 기준 아래로 내려감",
                       "15~24시 비양도 북북서방 1.4해리 해역(232-2해구) — 해양사고 위험예보 '주의'(15~21시 예상)·…", …, "제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고", "제주도서부앞바다 풍랑주의보 예비특보 — 21~24시 발효 예정"],
             "advice": "15~24시 비양도 북북서방 1.4해리 해역 운항에 주의가 필요합니다.",
             "area": [ [ [ [126.4167, 33.4833], [126.3722, 33.5722], … ] ] ],
             "detail": [ { "line": 0, "key": "overview", "boxes": [ [126.2187, 33.4007, 126.2636, 33.4383], … ] },
                         { "line": 1, "key": "accidentOnly", "note": "(한국해양교통안전공단 예보에서는 위험 단계지만, 같은 시간대에 높은 파도·강한 바람이나 선박 몰림은 예상되지 않은 해역)", "boxes": [ … ] },
                         { "line": 2, "key": "haegu", "major": "232", "boxes": [ [126, 33, 126.5, 33.5] ] } ] } },
  ← §11.10.4: summary.analysis = { "land": "협재해수욕장은 연안 위험지수 72 '높음'(예상)으로 주의 필요 수준이며, … 따라서 … 연안사고에 주의가 필요합니다.", "sea": "대해구 232 예보는 15시부터 …로 높아지고, … 따라서 … 운항에 주의가 필요합니다." } (규칙 분석 문단 3~5문장 — 늘 만들어 둠)
  "overview": { "land": "협재해수욕장은 사람이 평소의 1.8배로 붐벼 …(AI 해설 1~2문장 — §11.10.4 부터 AI 분석 문단 3~5문장)", "sea": "15시부터 파고가 높아져 …(AI 해설 1~2문장)", "source": "chatgpt", "model": "gpt-6-luna", "hash": "…" },
  "special": [
    { "kind": "release", "zone": "제주도북부앞바다", "title": "제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고(10월 16일 21:00 발표)",
      "lines": ["해제 뒤 출항이 이어질 수 있습니다.", "2020~2025년 특보 해제 뒤 이틀 동안 전복·침몰·침수·표류 사고가 평소보다 약 1.2~1.3배 많았습니다."] },
    { "kind": "prewarn", "zone": "제주도서부앞바다", "title": "제주도서부앞바다 풍랑주의보 예비특보 — 21~24시 발효 예정(05:00 발표)", "lines": [] } ],
  "sea": {
    "level": { "rank": 2, "word": "주의 필요", "source": "공식 사고예보 '주의'", "partial": false },
    "overviewLevel": { "rank": 2, "word": "주의 필요" },
    "reviewedCells": 52, "attentionRegions": 3, "overviewRegions": 2, "missing": [], "missingSlots": {},
    "weather": { "label": "대해구 232", "onsetAt": "…T15:00:00+09:00", "endAt": "…T21:00:00+09:00", "max": { "wh": 2.6, "ws": 14 }, "text": "대해구 232 예보는 15시부터 파고 2.4m·풍속 13m/s로 높아집니다(12시 파고 1.4m·풍속 9m/s), 21시부터 기준 아래로 내려갑니다" },
    "weatherByHaegu": { "232": { …weather 와 같은 꼴… } },
    "timeBar": [ { "at": "…T06:00:00+09:00", "label": "06시", "rank": 2, "word": "주의 필요", "region": "한림항 북동방 5.2해리 해역(232-3해구)",
                   "labels": ["제주도북부앞바다 풍랑주의보"], "events": [ { "kind": "release", "text": "제주도북부앞바다 풍랑주의보 — 06~09시 해제 예고(10월 16일 21:00 발표)" } ] }, … ],
    "cards": [ {
      "rid": "A:1001", "name": "비양도 북북서방 1.4해리 해역(232-2해구)", "nameBase": "비양도", "nameBaseKind": "place",
      "rank": 2, "word": "주의 필요", "sourceLabel": "공식 사고예보 '주의'", "window": "15~24시", "peakAt": "…T15:00:00+09:00",
      "overviewRank": 2, "overview": { "rank": 2, "word": "주의 필요", "window": "15~24시", "label": "공식 사고예보 '주의'(15~21시)·제주도서부앞바다 풍랑주의보 예비특보(발효 예정 시각 이후)(21~24시)",
                                     "labels": [ { "label": "공식 사고예보 '주의'", "window": "15~21시" }, { "label": "제주도서부앞바다 풍랑주의보 예비특보(발효 예정 시각 이후)", "window": "21~24시" } ], "at": "…" },
      "traits": { "history": { "from": "2021-01-01", "to": "2025-12-31", "count": 18, "topTypes": [ { "type": "충돌", "count": 7 } ], "death": 1, "missing": 0 },
                  "zone": { "name": "제주도서부앞바다", "kind": "main" }, "haegu": { "major": 232, "sub": 2, "label": "232-2" },
                  "text": "2021~2025년 선박사고 18건(충돌 7·침수 5), 사망 1·실종 0 · 제주도서부앞바다 · 232-2해구" },
      "today": { "lines": ["15~21시 공식 사고예보 '주의'", "15~18시 혼잡 예보 '높음'(15시 혼잡지수 12.3) → 충돌·접촉 주의", …],
                 "weather": { …sea.weather 꼴(이 해역 대해구)… },
                 "slots": [ { "at": "…T15:00:00+09:00", "rank": 2, "labels": ["공식 사고예보 '주의'", "혼잡 예보 '높음'(…) → 충돌·접촉 주의", "해구 예보 파고 2.4m·풍속 13m/s"] }, … ] },
      "sentence": "15~24시 이 해역은 공식 사고예보 '주의' 근거로 운항 시 주의가 필요합니다. 이 해역에서는 집계 기간 중 충돌 사고가 가장 많이 기록되었습니다.",
      "link": { "gridId": "GR4_1", "accidentGridId": "1001", "lat": 33.43, "lon": 126.22, "t": "…T15:00:00+09:00" } }, … ],
    "overviewTop": [ …cards 중 총평 후보(최대 3 — 2026-10-17 전 2)… ] },
  "land": {
    "level": { "rank": 2, "word": "주의 필요", "source": "연안 위험지수 72 '높음'" },
    "reviewedSpots": 4, "failedSpots": 0, "reviewedHazards": 1, "attentionSpots": 2, "attentionByRank": { "1": 1, "2": 1, "3": 0 }, "missing": [],
    "cards": [ { "id": "50110|협재해수욕장", "name": "협재해수욕장", "rank": 2, "word": "주의 필요", "sourceLabel": "연안 위험지수 72 '높음'",
                 "index": 72, "band": "높음", "peakAt": "…T15:00:00+09:00",
                 "traits": { "hazard": { "count": 4, "byType": [ … ] }, "history": { "count": 6, "from": "2020-01-01", "to": "2024-12-31", "topTypes": [ … ] }, "beach": true, "text": "위험구역 4곳(…) · 2020~2024 연안사고 6건(표류 4) · 해수욕장" },
                 "today": { "changes": ["사람 평소의 1.8배", "해안 바람 9m/s(튜브·물놀이기구 떠밀림 주의)"], "kinds": ["people", "drift"], "text": "…" },
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
| `edition` | `morning`(08:00 — §11.10.4 부터 07:30 공개)·`evening`(17:30)·`night`(23:00)·`warning`(특보 변경)·`manual`(관리자 즉시 실행) | 머리 「기준 시각」 |
| `publishAt` | §11.10.4 — 공개 시각(KST ISO). 정시 판 = 07:30·17:30·23:00(`rules.publishAtFor` — 공개 시각이 지난 늦은 실행이면 그 시각 그대로라 곧바로 보임), 특보 변경·관리자 판 = 만든 시각. 없으면(그 전 판) 곧바로 보인 판 | 제목 「HH:MM AI 연안 안전 브리핑」(정시 판 = 이 시각, 그 밖 = `generatedAt`, 이 필드 없는 옛 판 = `generatedAt`) |
| `summary.analysis` | §11.10.4 — 규칙 분석 문단 `{land, sea}`(각 3~5문장, 마지막 「따라서 … 필요합니다.」 — `rules.ruleAnalysis`, 서버 값만). `land` 는 해상만 관할이면 `null`. 이 필드가 있으면 화면은 「가」 모양(결론 → 분석 문단 → 접힌 「연안/해상 분석 근거」 → (기상) → (물때)) | AI 분석이 없을 때 이름표 「규칙 분석」과 함께 |
| `generatedAt` · `trigger` | 만든 시각 · 왜 만들었나(`{kind:'warning', zones:[바뀐 특보구역 열쇠]}`) | **N 뱃지**: 화면이 마지막으로 본 `generatedAt` 보다 새로우면 표시(§11.3 — 기존 `.new-badge`) |
| `window` | 이 판이 다루는 3시간 칸 범위(지난 칸 제외) | 시간 막대 범위 |
| `summary.land/sea` | **「총평과 권고」 서버 결론**(2026-10-17 §11.10): `headline` 결론 한 줄(「오늘 ○○파출소 관할 연안(해상)의 단계는 "주의 필요"입니다.」 — 오늘/내일·단계 말 그대로) · `basis[]` 근거(육상: 「관할 관광지 N곳 중 평소보다 위험이 높아진 곳 M곳 (주의 a곳 · 관심 b곳)」 — **M 은 관심 이상 전체**(`attentionSpots`, 카드 상한 아님), 상위 장소 3곳까지 「장소 — 연안 위험지수 92(높음), 사람 평소의 2.2배」(지수는 단계 출처가 지수일 때만), 두 곳 이상 공통인 특보·예비특보·해제 뒤·해안 바람은 「… — A·B 공통」 한 줄, 확인하지 못한 자료 / 해상: 검토 칸·위험이 높아진 해역 수(`overviewRegions`)·공식 사고예보 단계만 있는 해역 수·해구 흐름·해역 3곳·해제 예고/예비특보 제목·확인하지 못한 자료) · `advice` 권고 한 줄(「따라서」 없음) · `tide[]`(육상만, `tide.text`). `land` 는 해상만 관할이면 `null`. **없으면(그 전에 저장된 브리핑) 화면은 종전 `overview` 문단 모양** | ① 총평 — 단계 배지 → 결론(굵게) → (근거) → (권고) → (물때) |
| `summary.weather` · `summary.tide` | **(기상)·(물때) 공용 칸**(2026-10-17 후속 결정, 설계서 §11.10.1 — 화면 순서 결론 → 기상 → 물때 → 육상·해상 근거·권고 → AI 해설). `weather.zone` = 파출소 대표 위치에서 가장 가까운 앞바다(특보구역 도형 `warn_zones.geojson` 경계 거리) · `rows` = 그 구역 지방기상청 단기 해상예보(인덱스 「○○앞바다 기상예보」와 같은 `loadCoastalForecasts`) 오전·오후 두 칸(08:00 판 오늘 오전·오후 / 17:30 판 오늘 오후·내일 오전 / 23:00 판 내일 오전·오후, 칸 없으면 `text:'자료 없음', ok:false`) · `missing` = 쓸 칸이 하나도 없음 · `notes` = 그 구역 관할 지방청 단기 전망 통보문에서 **대상일 것만** 결정론으로 뽑은 특이사항(최대 3줄 — 예비특보·강풍·해상·강한 비) · `bulletinMissing` = 통보문 없음·3일 이상 낡음. **2026-10-17 독립 검토(설계서 §11.10.2)**: `notes` 방향(높아짐·낮아짐)은 원문대로·지역·「(곳에 따라)」「(○○특보 가능성)」 단서 · 가장 가까운 구역(또는 상위 구역 — 「(…제외)」는 아님) 줄을 먼저 · 같은 구역 나열의 풍랑 예비특보+해상 줄은 한 줄 · `notesFound` = 통보문에 그날 토막(또는 날짜 없는 ○ 줄)이 있었는지 — `notes` 가 비고 `notesFound` 면 화면은 「단기 전망에서 항목을 뽑지 못했습니다 — 원문(…)을 확인하세요」, 아니면 「…없습니다」 · `kind` = `coastal`(앞바다) | `far`(먼바다) · `note` = 가장 가까운 앞바다가 30km 넘게 멀 때의 안내(먼바다 예보로 바꿨거나 먼 앞바다 그대로 — 화면 `[data-sb-wx-note]`). `weather` 칸이 없는 summary(§11.10 판)는 종전 모양(물때는 `land.tide`) | ① 총평 (기상)·(특이사항)·(물때) |
| `summary.isolation` · `summary.sea.area`·`detail` · `sea.reviewedRegions` | **2026-10-17 사용자 결정(설계서 §11.10.3)** — `isolation` = (물때) 아래 「(고립 주의) 저조 시간(…) 전후 사고 지점(N개소) 확인 및 주의가 필요합니다.」(`text`, 버튼 글 `link`, 창 안 저조 `lows`(= `tide.lows`), 지점 표 `rows` = 육상이 검토하는 같은 관광지 목록 중 연안사고 기록(coast_accidents.json — 관광지 구역 + 앞바다 500m, 관광지에 붙은 사고만)에 고립이 있는 곳 **전부** 건수 많은 순·이름 순, `caption`). 고립 지점 없음·해상만·조석 칸 없음이면 `null`. 육상 근거의 공통 이유 줄은 이유만(「— A·B 공통」 없음), 육상 권고 「… 주변 연안사고에 …가 필요합니다」(관심 없음: 「관할 연안사고에 평소처럼 관심이 필요합니다.」). 해상 근거 첫 줄 「관할 해역 N칸 중 위험이 높아진 해역 M칸」 — N = `sea.reviewedRegions`(검토한 해역 수 = 해양사고 위험예보 칸 하나 또는 그 밖의 혼잡 칸 하나, M 과 같은 단위; `reviewedCells` 는 사고·혼잡 칸을 따로 센 종전 값으로 AI 입력에만) · 「해양사고 위험예보만 '주의·경계'인 해역 K칸」(단계 말은 그 해역들에 있는 것만, 결론에는 넣지 않는 규칙 그대로) · 해구 예보 줄은 **기준(파고 2m·풍속 12m/s)을 넘을 때만** 「대해구 N 예보 15시부터 …로 높아짐(예상)」(사용자 「(가)로 진행하자」 — 넘지 않으면 줄 없음) · 권고에서 「…시경」의 「경」과 해역 이름 꼬리 「(…해구)」를 뺐다. `area` = 관할 폴리곤(소수 4자리·약 100m 단순화·1km 안 되는 안쪽 고리 뺌 — 97곳 합 약 49.6KB, 가장 큰 여호 약 13.9KB, 가운데값 약 120B), `detail[]` = 근거 줄 번호(`line`)별 `key`(overview·accidentOnly·haegu)·`note`(풀이)·`boxes`(깜빡일 칸·해구 상자 [서,남,동,북])·`major`. 브리핑 안에서 「공식 사고예보」는 「해양사고 위험예보」(`SOURCE_LABEL.accident`·칸 근거 이름) — 다른 화면 이름은 그대로. 규칙 판 `station-briefing-rules-v9` | ① 총평 (물때)·(근거) ▸ 지도 펼침 |
| 「예상」 | 근거 줄에서 예보·예측에서 온 값(방문객 N배·연안 위험지수·너울·해안 바람·공식 사고예보·혼잡 예보·해구 예보)에 「예상」. 발효 특보·예비특보·해제·이안류(관측)·행사는 붙이지 않음 — 분류표는 설계서 §11.10.1 | ① 총평 근거 |
| `overview.land/sea` | ⚠§11.10.4 부터 **AI 분석 문단**(연안·해상 각 3~5문장 — 장소·단계·원인·시간 흐름, 마지막 「따라서 … 필요합니다」, 이름표 「AI 분석 · ChatGPT/Gemini」, `attempts` = 몇 번째 시도에 통과). 그 전: **AI 해설**(육상·해상 각 1~2문장 — 원인·시간 흐름). 틀 방식·AI 실패면 `null`(해설 없음). `land` 는 해상만 관할이면 `null`. ⚠2026-10-17 전 브리핑(`summary` 없음)에서는 총평 문단(3~5문장) | ① 총평 — 「해설 · ChatGPT」 작은 이름표 |
| `overview.source` | `chatgpt`·`gemini`·`template`(+`reused:true` 면 지난 판 재사용) · `model`. `template` = AI 해설 없음(§11.10.4 부터 화면은 `summary.analysis` 규칙 분석) | 작은 글씨 「AI 해설 없음 — 결론·근거·권고는 서버가 계산한 값입니다.」 |
| `special[]` | 특별 상황 칸: `release`(해제 예고 — 「… — 06~09시 해제 예고(10월 16일 21:00 발표)」, `lines` 두 줄을 그대로) · `prewarn`(예비특보 — 「… 예비특보 — 21~24시 발효 예정(05:00 발표)」) · `released`(이미 해제 — 특보 구간 기록의 실제 해제 시각, 「… — 07:30 해제」 + 해제 안내 두 줄). 시각은 기상청 것 그대로, 발표 시각이 있으면 괄호로(결정 1). 해제 예고·발효 예정 **범위가 창과 겹치면** 넣는다(창 시작 전에 시작해도 — 17:30 판의 「12~18시 해제 예고」). 특보 원천(`sources.warnings`)이 ok 가 아니면 만들지 않는다(시간 막대 사건도) | ② 특별 상황 |
| `sea.level` | 해상 분석 단계(공식 사고예보 순위 「주의」 포함). 남은 자료로 0 인데 원천이 빠졌으면 `word` 가 「확인 불가(일부)」(넷 다 빠지면 「확인 불가」) — 「평소 수준」이라 쓰지 않는다(`partial:true`) | ③ 해상 분석 머리 |
| `sea.overviewLevel` | 총평에 쓴 단계(공식 사고예보 「주의」·**「경계」**만 있고 같은 칸에 기상·혼잡 근거가 없는 칸 제외 — §11.6-17① 「주의」, 2026-10-16 *"모두 추천대로."* 로 「경계」도 — §11.8 추가 결정 A). 결측 규칙은 `sea.level` 과 같다 | 총평 옆 배지 |
| `sea.attentionRegions` · `sea.overviewRegions` | 관심 이상 해역 수 — 카드·시간 막대 기준(`attentionRegions`) / 총평 기준(`overviewRegions`, 공식 사고예보 단계만 있는 해역 제외 — `overviewLevel` 과 같은 기준). 총평 근거 「평소보다 위험이 높아진 해역 N개」(2026-10-17 전 틀 총평 첫 문장)와 AI 입력 `attention_regions` 는 `overviewRegions` 를 쓰고, 차이가 있으면 「공식 사고예보 단계만 있는 해역 N개」(`accident_only_regions`)로 따로 적는다(2026-10-16 2단계 검토 B1 — 종전엔 「평소 수준입니다(… 관심 이상 1개 해역)」처럼 어긋났다). 규칙 판 `station-briefing-rules-v5` | ① 총평 · ③ 해상 분석 머리 |
| `sea.timeBar[]` | 3시간 칸마다 관할 최고 단계·그 해역·근거 이름·사건(`release`·`prewarn`·`released`·`warnStart`). 특보 해제 뒤 「관심」은 **해제 뒤 1시간이 걸친 칸만**(결정 4 — 「Z 풍랑주의보 해제 뒤」·이미 해제면 「…(07:30 해제)」) | 해상 시간 막대(칸 색 = `rank` 0~3, 사건은 ⚑) |
| `sea.cards[]` | 해역 카드(최대 10, 순위 = 단계 > 지속 칸 > 기상·혼잡 겹침 > 과거 사고). `window`·`today.lines`·`overview.window` 는 이어진 칸 묶음별 — 끊기면 「06~09시·21~24시」(하나로 잇지 않는다), `peakAt` = 가장 높은 단계의 첫 칸. `traits.history` 가 `{count:0, available:false}` 면 「선박사고 이력 자료 없음(집계 불가)」, `available:true` 면 「…선박사고 기록 없음」(0건). `sea.overviewTop` 은 카드 상한과 상관없이 총평 단계 순위에서 고른다(카드 10개 밖이어도 총평 근거면 들어간다) | [특성] `traits.text` · [오늘 예상] `today.lines` · 틀 문장 `sentence` |
| `card.link` | 위험예측 화면으로 바로가기 재료 — 교통 칸 `gridId`(없으면 `accidentGridId`)·좌표·시각 `t` | [위험예측에서 보기 ›] (§11.4, U55) |
| `land.cards[]` | 관심 이상 관광지(최대 10). 단계(결정 2): **경계** = 풍랑·태풍·강풍 경보 발효 · 연안 위험지수 100('매우 높음') + 오늘 바뀐 요소 / **주의** = 주의보 발효 · 지수 '높음'(67+) + 바뀐 요소 / **관심** = '다소 높음' 이상 + 바뀐 요소 · 예비특보 · 떠밀림 · 행사 · 특보 해제 뒤 3시간(결정 4). `sourceLabel` = 무엇 때문인지(「연안 위험지수 72 '높음'」·「풍랑주의보」·「풍랑주의보 해제 뒤(07:30 해제)」). `today.changes` 의 특보는 기상청 시각째: 「풍랑주의보 발효(06~09시 해제 예고, 10월 16일 14:00 발표)」·「강풍주의보 예비특보(10월 18일 03:00 발효 예정)」 | ④ 육상 분석 |
| `land.attentionSpots` · `land.attentionByRank` | 관심 이상 관광지 전체 수(카드는 그중 단계 높은 순 10곳) — 화면이 「카드는 10곳까지」를 밝힐 때 쓴다(2단계 검토 B5) · 단계별 전체 수 `{1:관심,2:주의,3:경계}`(총평 근거 「주의 a곳 · 관심 b곳」, 2026-10-17) | ④ 육상 분석 머리 · ① 총평 근거 |
| `card.today.kinds` · `card.overview.labels` | 육상 카드 `today.changes` 와 같은 순서의 요소 종류(people·event·swell·rip·warning·prewarn·drift·released — 공통 요소를 한 줄로 모으는 데·「예상」 가르는 데) · 해역 카드 총평 근거를 `[{label, kind, window}]` 로(kind 로 「예상」을 가름 — §11.10.1)(근거 하나이고 시간대가 창과 같으면 시간대를 되풀이하지 않는 데) — 2026-10-17 | ① 총평 근거 |
| `land.constant[]` | 상시 위험 장소(단계 0 인 관광지 + 관광지에 안 붙은 위험구역 가운데 **설명 글이 있는 곳**, 최대 12) | 「상시 위험 장소」 접힘 목록 |
| `land.card.link` | `spotId`·좌표·`date` — 연안 시트(`/coast/spot?id=…&t=그 날짜`)로 | 바로가기 |
| `tide` | 서해·남해·**제주** 관할(아래 §2.2, 제주는 결정 5). 동해 등 그 밖은 `null` | 조석 게이지 |
| `sources` · `sea.missing` · `sea.missingSlots` · `land.missing` · `land.failedSpots` | 원천 상태. ok 가 아닌 원천의 근거는 판단에서 뺐다. `sea.missingSlots.accident` = 공식 사고예보 원천은 ok 인데 프레임이 빠진 칸(그 칸 사고예보는 「없음」이 아니라 확인 불가 — `sea.missing` 에도 `accident`). `land.reviewedSpots` 는 연안 하루 값을 실제로 받은 곳만, 실패 수는 `failedSpots`(`land.missing` 에 `detail`). 빠진 원천은 총평 근거의 「확인하지 못한 자료: …」 줄에 이름으로 밝힌다(2026-10-17 전엔 틀 총평 첫 문장) | 「일부 자료 확인 불가」 |
| `rank` | 0 평소 수준 · 1 관심 필요 · 2 주의 필요 · 3 경계 필요 (`word` 가 그 말) | 색 |

### 2.2 조석(`tide`) — 해양종합정보 바텀시트 조석 게이지와 같은 재료
```json
{ "anchor": { "id": "A7", "distKm": 3.2 }, "region": "westsouth", "date": "2026-10-17",
  "gauge": { "curve": [ { "t": "00:00", "cm": 312 }, …144개(10분) ], "peaks": [ { "type": "high", "t": "00:50", "cm": 610 }, { "type": "low", "t": "06:12", "cm": -12 }, … ],
             "prevPeak": { "type": "high", "t": "23:59", "cm": 600 }, "nextPeak": null, "unit": "cm" },
  "rocks": { "count": 1, "first": "07:10", "last": "18:40" },
  "lows": ["06:12", "18:40"],
  "text": ["06:12 저조 뒤부터 물이 차오릅니다(12:30 고조) · 18:40 저조 뒤부터 물이 차오릅니다(10월 18일 00:55 고조).",
           "관할 안 잠기는 바위(간출암) 1곳이 07:10~18:40 사이 물에 잠깁니다 — 바위 위 낚시·채취 중 고립에 주의가 필요합니다."] }
```
- 게이지(`ocean_bottom_sheet3.js` renderTideData)는 `peaks` 를 `{type, minutes, level}` 로 쓴다 — 화면에서 `minutes = HH*60+MM`, `level = cm` 로 바꾼다. `prevPeak` 는 **전날 자신의 시각**이다(화면이 1440 을 빼서 앞날로 민다 — hazard_rocks 곡선 API 와 같은 관례).
- `region`: `westsouth`(서해·남해 — 물빠짐 앵커 `tide_field`) · `jeju`(제주 — 제주 고립판정 촘촘 격자 앵커 `curves_jeju`, 그 격자가 없으면 제주 간출암 앵커 `hazard_rocks/curves`; 2026-10-16 결정 5 *"나 는 반영하자"*). 둘 다 매일 KST 23:30 자동 수집, 같은 꼴.
- 대표 위치가 서해·남해·제주가 아니거나 25km 안 앵커·곡선이 없으면 `null`. 전날 곡선은 매일 밤 지워지므로 `prevPeak` 가 `null` 일 수 있다.
- `text` 첫 줄은 **밀물(저조 → 다음 고조) 중심**(결정 5 *"저조가 아니라 고조지 않니? 물이 오르는시간이니까"*): 「HH:MM 저조 뒤부터 물이 차오릅니다(HH:MM 고조)」를 창(`window`)에 걸친 밀물마다 「 · 」로 잇고 「 — 갯벌·바위에 나가 있다면 물이 차오르기 전에 나오세요.」로 끝낸다. 창 앞 저조라도 고조가 창 안이면 넣고(23시 판은 전날 곡선의 밤 저조에 날짜를 붙여 — 「10월 17일 18:40 저조 뒤부터 …(10월 17일 22:50 고조)」), 다음 날 첫 고조는 `nextPeak`. 게이지(`gauge.peaks`)는 그날 것 전부 그대로.
  ⚠2026-10-17(§11.10.3) 끝 문구 「 — 갯벌·바위에 나가 있다면 물이 차오르기 전에 나오세요.」는 뺐다(사용자 *"물이 차오르기 전에 나오세요 이벤트는 뺐으면 좋겠어"*) — 지금은 밀물 토막을 「 · 」로 잇고 「.」로 끝낸다. `lows` = 창 안 저조 시각(총평 (고립 주의) 줄).
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
| `GET /api/admin/station-briefing/status` | ⚠§11.10.4: `pending:[{date, publishAt, stations}]`(공개 예정) · `lastRun.publishAt` · `errors[].attempt` · `stats.gemini`. `{ok, config, choices, lastRun:{at,kind,zones,results:[{date,stations,stats:{calls,reused,ai,template,retried,deadline},errors}],ms}, done:[판 열쇠], errors:[**최근 3일(KST 오늘·어제·그제) 전부, 최근 것부터** — {at,stage:'call'|'parse'|'validate'|'deadline'|'run',provider,stations,reason,edition,date}], errorKeep:{days:3,cap:5000}, errorsCapped:{at,dropped,cap}|null, days:[저장된 날짜], running, failures:{판 열쇠 또는 warning → {count,lastAt,reason}}, pendingWarn:{zones,lastChangeAt}|null}` — `lastRun.aiDisabled` 가 있으면 개발 환경이라 틀(AI 해설 없음)만 만든 것. `errors[].stage` 에 `run`(실행 실패)·`deadline`(데드라인 넘어 틀) 추가. 오류 보관은 2026-10-17 결정(§11.10 — 종전 「최근 50·저장 200개」) — 안전 상한 5,000건을 넘으면 오래된 것부터 지우고 `errorsCapped` 에 남긴다(그 기록도 3일이 지나면 지운다 — §11.10.2). 관리자 화면이 전부를 목록으로 보이고 [복사](마크다운)·[md로 저장] |
| `GET /api/admin/station-briefing/status` (§11.10.7 덧붙임) | `runs:[{at,kind,method,ms,publishAt,results}]`(실행 기록 — 최근 3일, 최근 것부터, 오류 0 실행 포함. `at` = 그 실행 오류들의 `at`) · `progress`(실행 중일 때만, 아니면 null — `{at,kind,unit,phase:'locate'|'gather'|'ai'|'save',window,windows,date,stations,done,total,current,method,batches:[{name,state:'waiting'|'running'|'done',done,stations:[{key,name,state:'waiting'|'running'|'retry'|'done'|'rule',attempt?}]}]}`. 전체 칸 = 위치 확인 1 + 날짜마다(입력 모으기 1 + 관할 수)). **`?only=progress`** 면 `{ok, running, progress}` 만(진행 게이지가 2.5초마다 — 오류 목록을 싣지 않음) |
| `POST /api/admin/station-briefing/download` (§11.10.7) | 본문 `{name:'….md', text}` → `{ok, token, path:'/api/station-briefing/download/{token}', expiresInSec:300}`. 이름은 `[A-Za-z0-9_.-]{1,80}.md` 만(아니면 `station_briefing_errors.md`), 글 없으면 400. 앱 안 [md로 저장]용 |
| `GET /api/station-briefing/download/:token` (§11.10.7) | 관리자 머리글 없이(시스템 브라우저가 연다) — 열쇠 128비트 무작위·5분·**한 번**. 200 `text/markdown; charset=utf-8` + `Content-Disposition: attachment`, 지났거나 받은 열쇠는 404 글 |
| `GET /api/admin/station-briefing/stations` | `{ok, stations}` — 공개 목록과 같은 꼴, **노출 범위와 무관**(관리자 「AI 브리핑」 탭 미리보기용, 화면 2단계 2026-10-16 추가) |
| `GET /api/admin/station-briefing/preview?station=&day=` | ⚠§11.10.4: 공개 시각 전 판(그 관할의 더 나중 판)이 있으면 그것을 `{…, pending:true, publishAt, current:{generatedAt,edition}|null}` 로(화면 「예정 — … 에 공개될 판」). `{ok, date, briefing, fallback, wanted?, nextExpectedAt?}` — 공개 `GET /api/station-briefing` 과 같은 검사(400·404)·같은 `pick`, 노출 범위와 무관(「노출 안 함」이어도 관리자는 본다). `now` 줄은 없다 |
| `POST /api/admin/station-briefing/run` | 지금 바로 만든다(화면이 지금 보일 날짜 — 21시 전 오늘, 이후 내일 — 끝나면 곧바로 공개, 그보다 먼저 만든 대기 판은 지움 · §11.10.4). 202 `{ok, started}` 즉시 응답, 결과는 status 로. **이미 실행 중이면 409** `{ok:false, started:false, running:true, error, lastRun}`(예전에는 202 라고 답하고 건너뛰었다) |

설정 칸(기본값 굵게):

| 칸 | 선택지 |
|---|---|
| `method` 생성 방식 | **`chatgpt`**(VM → 꺼지면 Gemini → 틀) · `gemini`(Gemini → 틀) · `template`(AI 없음) |
| `chatgptModel` | **`gpt-6-luna`** · `gpt-6-sol` · `gpt-6-astra` (= `codex_bridge.ANSWER_MODELS` 에서 `gemini` 뺀 것) |
| `geminiModel` | **`gemini-2.5-flash`** · `gemini-2.5-flash-lite` |
| `exposure` 노출 범위 | `user` · **`admin`** · `off` |
| `batchUnit` 묶음 단위 | `station`(파출소, 97회) · **`office`**(해양경찰서, 21회) · `region`(지방청, 5회) |
| `onlyChanged` 바뀐 곳만 다시 | **`true`**(입력 해시가 지난 판과 같으면 AI 총평 재사용) · `false` |

## 5. AI 해설 검증(서버) — 실패한 관할만 1회 재시도, 그래도 실패면 틀(해설 없음)

> ⚠**§11.10.4(2026-10-17) 부터**: 분석 문단 **3~5문장**·**420자**·마지막 문장 「따라서 … 필요합니다」(`shape:<문단>-no-conclusion`)·나열 꼴 단계 말(「A에는 주의가, B에는 관심이 필요합니다」의 「주의가,」도 — 쉼표로 나뉜 대목에 대상 이름이 있으면 그 대상 단계로) · 판 `sb-validate-v5`·지시문 `sb-prompt-v6`(사용자 예시 두 개·예보 값 「예상」·`retry_feedback`).
> 다시 시도: 관할마다 VM 최대 3번(떨어진 관할만, 지시문 `stations[].retry_feedback = {attempt, reasons}` — `explainError` 「place:하저리해수욕장 — 그 지명은 입력에 없다」 등) → Gemini 한 번(VM 을 한 번도 못 불렀으면 두 번) → 규칙 분석. 오류마다 `attempt`. 아래 「1~2」·「220자」·「1회 재시도」는 그 전 이력.
> ⚠**§11.10.5(2026-10-17 독립 검토) 부터** 판 `sb-validate-v6`·지시문 `sb-prompt-v7`: **단계 아래쪽** — 결론 단계가 관심 이상이면 마지막 「따라서」 문장·문단의 가장 높은 단계 말이 결론 단계와 같아야(`level-last:관심≠2`·`level-max:`, 결론 「평소 수준」·「확인 불가」면 검사 없음) · **대상 이름 없는 대목은 문단 결론 단계까지**(`level-para:` — 아래 「가장 낮은 단계까지」는 이력) · **입력에 없는 말**(경보·태풍·사망자·사망·임박·대규모·「아무 일도·문제도 없」·「반드시 사고」 — 그 관할 입력 글에 같은 말이 있을 때만, `fact:`) · 나열 꼴 조사 없음·은·는·를·을·쉼표 없는 「주의가 B에는」 · 「요합니다」·「상태」 꼴 · 이유 글의 AI 글 조각은 20자까지. 다시 시도 순서: 한 바퀴마다 모든 해양경찰서 묶음이 한 걸음씩(첫 시도 전부 → 2번째 → 3번째 → Gemini). 원인·시제·「예상」 표기는 검사하지 못한다(설계서 §11.10.5).

> ⚠**§11.10.6(2026-10-17 운영 오판) 부터** 판 `sb-validate-v7`: 허용 이름의 괄호·가운뎃점 속 다른 이름(3글자 이상)도 허용 · 허용 이름 뒤에 조사만 붙은 낱말(「한림공원도」·「삼양해안도로를」) 통과 · 「…지만」은 지명 아님 · 연도에 붙은 「년」은 같은 수가 단위 없이 허용돼 있으면 통과. (기상) 칸 숫자는 그대로 막는다(사용자 확정). 같은 날 `sb-validate-v8`·`sb-prompt-v8`: 셈말·가리킴 말(「세 해수욕장」·「이들 해수욕장」)은 지명 앞 낱말로 붙이지 않음 · 지시문은 장소 수를 세지 말고 이름만 나열.

관할마다 따로 검사(`station_briefing_ai.validateOverview`, 2026-10-16 독립 검토 반영 · 2026-10-17 §11.10 · 같은 날 §11.10.2 — 판 `sb-validate-v4`·지시문 `sb-prompt-v5`). 모든 대조는 **NFKC 정규화**한 글로(전각 「９９m」 → 「99m」):
- 모양: 해설 문장 수 **1~2**(2026-10-17 전 총평 문단 3~5 — 문장 끝 = 마침표·물음표 뒤 공백, 「…다.다음」처럼 바로 붙은 한글, 줄바꿈; 「2.4m」·「천둥.번개」는 아님) · 문단 **220자** 이하(§11.10.2) · 해상만 관할의 육상 해설 금지 · **HTML 태그·URL·마크다운 링크 금지**(`markup`).
- 숫자: **「숫자+단위」째**(m·m/s·km·cm·해리·해구·시·시간·분·초·칸·척·건·곳·명·개·배·%·년·월·일, 시각 HH:MM) 서버 사실 문장(서버 결론·근거 줄 `summary` 포함)에 있는 꼴만 — 「3m」는 「232-3해구」의 3 으로 통과하지 못한다. 범위(「12~15m/s」)는 **범위 자체**가 입력에 있어야 한다(입력 범위의 양 끝은 낱으로도 허용). 단위 없는 숫자도 입력에 단위 없이 있어야. 허용 숫자는 서버 사실 문장 + 서버 결론·근거 줄(`summary`)에서 뽑는다(종전 틀 총평 문단 대신). **한글 수사**(「세 시」·「두 척」·「서른 미터」·「구 미터」)는 대조할 수 없어 막는다 — 다만 **곳·개를 세는 「두 곳」·「세 개」(「세 군데」 = 곳)는 그 수가 같은 단위로 허용 숫자(`2|곳`)에 있고, 그 문단(육상·해상) 서버 결론·근거·권고 줄(`count_keys`)에도 있을 때만 통과**(2026-10-17 · §11.10.2). 「두세 곳」「서너 곳」「한두 곳」 같은 어림 수사와 「세 번」·「세 차례」는 늘 실패(「두번째」 같은 차례 말은 셈말 아님).
- 배수: **문단별** — 해상은 해제 칸이 있을 때 1.2·1.3·1.2~1.3 만(「사고 1.8배」·「두 배」 금지), 육상은 그 관할 사람 혼잡 배수만.
- 지명: 항·포구·해수욕장·해변·앞바다·먼바다·연안바다·해구·파출소·해양경찰서·방파제·**갯바위·부두·등대·섬·곶·만·포·도** 접미사, 띄어 쓴 지명(「제주도 동부 앞바다」)도 앞 낱말을 붙여 대조. 허용 이름 = 관할·해역·구역·관광지 이름 + **그 관할에 관련된 기상청 해역 이름**(`kma_zones` — `config/zone_group_map.js` 이름 중 기상청 전망 발췌·(기상) 칸 구역·특이사항에 나온 것, 「제주도」는 제주 관할이거나 그 글에 있을 때만 · §11.10.2. 종전엔 전국 이름 전부 + 「제주도」를 모든 관할에 허용). 기상청 해역 이름은 후보와 **정확히 같을 때만**(「가짜제주도남쪽바깥먼바다」 실패). 관할·관광지 등 허용 이름은 후보의 **끝에 오는** 경우도 허용(「한림항 방파제」 ⊃ 「한림항」은 되지만 「림항」·「한림해수욕장」은 안 됨) 또는 이름 줄기(파출소 이름에서 「파출소」를 뗀 「한림」, 특보구역 줄기 「제주도」, 띄어 쓴 허용 이름의 앞 낱말)와 정확히 같을 때. 「바람도」·「정도」·「운항」 같은 낱말은 지명으로 보지 않는다.
- 단계 말: 「관심/주의/경계」 + **필요·요구·요망·단계·수준·하십시오·하세요·해야·바랍니다·기울·태세·강화** 등 모든 서술 꼴. 문단별 대상 단계(`levels.sea`·`levels.land` — 관할 이름은 그 문단 단계, 육상 관광지는 결정 2 의 카드 단계 그대로 — 지수 '높음'이면 주의까지)를 넘지 못하고, **대상 이름이 없는 문장은 그 문단의 가장 낮은 단계까지**(「관심」은 늘 허용). 서버 사실 문장(조석·해제 안내)을 그대로 옮긴 문장은 제외.
- 공식 단계 이름(`'주의'` 등)은 서버 문장에 있는 것만. ~~해상 첫 해역·육상 첫 장소 이름 필수 · 빠진 원천 이름 필수(`required`)~~ — 2026-10-17 없앰(결론·근거·빠진 자료 줄은 서버 `summary` 가 늘 보인다. 운영 `required:missing:swell` 오탐의 원인이기도 했다).
- 금지어: **공백·제로폭 문자를 지우고** 대조(「순 찰」·「순찰」도) — 순찰·배치·출동·단속·통제·**투입·경비정·검문·감시 강화·집중 감시·근무**·사고 확률·확률. 안전 단정: 「안전합니다」·**「안전한 상태」·「이상 없」·「문제없」·「위험 요소가 (전혀) 없」·「걱정 없」·「우려 없」**(「특별한 위험 요소는 확인되지 않았습니다」는 허용 — coastal_risk §10.3). **결론과 다른 단정**(§11.10.2): 「위험하지 않」·「위험이 크지 않」·「위험도가 낮」·「(사고가 날) 가능성은 낮」·「안심」·「출항하셔도 됩니다」, 대비·변화 말(지만·으나·다가·부터·이후…) 없는 「평온/잔잔/양호합니다」 — 「오전에는 잔잔하지만 오후부터 …」·「21시부터 위험이 낮아집니다」는 허용. **출항 지시**: 「출항하지 마」·「출항 금지」·「출항을 자제하」.
- **화면은 총평·카드 문장을 `textContent` 로만 넣는다**(innerHTML 금지) — 검증이 HTML 을 거르더라도 화면이 한 번 더 막는다.

실패는 `status.errors` 에 남는다.
AI 입력에는 기상청 해상 기상 전망(단기 통보문) 원문 발췌(`marine_forecast.json` shortTerm `codeCategories` — 해상·강풍·너울·바다안개, 각 600자)를 원인·흐름 참고용으로 넣는다. 그 안의 숫자는 허용 목록에 넣지 않는다(옮기면 검증 실패). 해역 이름은 그 관할의 `kma_zones`(위 — 관련 이름만, 관할마다)에 있으면 쓸 수 있다. 관할마다 화면에 이미 보이는 결론·근거·권고와 (기상)·(물때)(`shown.weather`·`shown.tide`, §11.10.1)를 함께 보내 되풀이하지 않게 한다 — 기상 칸의 숫자(예보·통보문)는 허용 숫자에 넣지 않는다(지시문 `sb-prompt-v4` → §11.10.2 `sb-prompt-v5`, 검증 판 `sb-validate-v4`).

### 5.1 AI 호출·실행의 시간·재시도 규칙 (2026-10-16 독립 검토 반영)
| 무엇 | 규칙 |
|---|---|
| 호출 시간 제한 | 호출마다 VM 320초(codex_bridge 자체 300초 뒤)·Gemini 100초 — 넘으면 끊기 요청(`signal`)과 함께 다음 공급자로. 실제 Gemini 어댑터는 `config.abortSignal`(90초, @google/genai)로 요청을 끊는다(gemini_client 는 고치지 않음) |
| 실행 데드라인 | 한 번 실행에 AI 20분 — 넘으면 남은 관할은 틀(AI 해설 없음 — `errors[].stage:'deadline'`, `stats.deadline`). ⚠§11.10.4 부터 min(20분, 공개 시각까지) — 공개 시각에 된 만큼(나머지 규칙 분석) 보이고 늦추지 않는다 |
| 다시 시도(§11.10.4) | VM 최대 3번 → Gemini 한 번 → 규칙 분석(위 §5 머리). VM 차단기·데드라인 그대로. `stats` 에 `gemini`(Gemini 호출 수)·`retried`(두 번째 시도까지 간 관할 수) |
| VM 차단기 | VM 이 잇달아 3번 실패(호출·시간초과·해석)하면 그 실행 동안 VM 을 건너뛰고 Gemini 로. ⚠§11.10.5: 데드라인까지 1초도 안 남아 끊긴 시간초과는 세지 않는다 · `stats.deadline` 은 시도가 남은 채 데드라인으로 멈춘 관할만 |
| 재사용 해시 | 관할 입력 + 규칙 판(`rulesVersion`)·검증 판·지시문 판 + 생성 방식 + ChatGPT·Gemini 모델 + 기상청 전망. 같은 해시라도 지난 글이 ChatGPT 방식인데 Gemini 가 쓴 것이면 VM 이 살아 있을 때 다시 만든다 |
| 실행 실패 | 실행이 던지면(파일 쓰기 실패 등) `status.failures` 에 횟수·시각을 남기고 10분 뒤 다시, 같은 판은 3번까지(특보 변경도 같게 — 3번 실패하면 그 특보 서명을 받아들이고 멈춤). 매분 다시 모으거나 AI 를 다시 부르지 않는다 |
| 특보 변경 | 마지막 변경 뒤 3분 조용할 때 한 번(그 사이 바뀐 구역은 합침). 내용이 같은 채 파일 시각만 바뀌면 기다림을 늘리지 않고, 계속 바뀌어도 첫 변경 뒤 15분이면 만든다. 내일 판을 고칠 때 21시 전이면 내일 0시부터(오늘 칸을 섞지 않음) |
| 개발 환경 | 실제 AI 는 운영(`FLY_ALLOC_ID`) 또는 `STATION_BRIEFING_DEV_AI=1` 일 때만 — 그 밖의 관리자 실행은 틀(AI 해설 없음, `lastRun.aiDisabled`) |
| 대표 위치 | 카카오 묻기는 한 실행 60초·한 건 15초 상한. 키 없음·401·403 이면 그 자리에서 멈추고 6시간, 호출 고장이 3번 이어지면 30분 묻지 않는다(`locations.json` 의 `backoff`). 실패 로그는 실행마다 한 줄. 주소나 정리된 질의가 바뀌면 「일치 없음」이었던 곳도 다시 묻는다 |
| 시각 | 연안 하루 값은 모으기 직전 시각으로 묻는다(위치 찾기·AI 가 오래 걸려도 risk_store 의 「지금−5분」 거부에 걸리지 않게) |

## 6. 저장 위치(운영 볼륨 `local_server/data/station_briefing/`)

⚠§11.10.4: 날짜 파일은 `{date, stations:{관할: 공개된 판}, pending?:{관할: 공개 시각 전 판(publishAt)}, updatedAt}` — 다음에 쓸 때 공개 시각이 지난 대기 판을 먼저 `stations` 로 옮기고(`settle`), 곧바로 공개하는 판(특보·관리자)을 쓸 때는 그 관할의 더 먼저 만든 대기 판을 지운다. `state.lastRun.publishAt`·`results[].publishAt`.

`config.json`(설정) · `state.json`(만든 판·특보 서명·관할별 특보구역·마지막 실행(`lastRun.method` 포함)·오류 최근 3일 전부(안전 상한 5,000 — `errorsCapped`, 2026-10-17 전 200개)) · `briefings_YYYY-MM-DD.json`(어제·오늘·내일만 남김) · `locations.json`(대표 위치 — 카카오 결과·실패 사유).
읽기만 하는 것: `data/risk_forecast/warning_history.json`(특보 구간 기록 `sea_warning_history` — 이미 해제된 특보의 실제 해제 시각, 결정 4. 해제 뒤 기간이 가장 긴 육상 3시간에 맞춰 창 시작 3시간 전부터).

### 6.1 관리자 오류현황 원천 `stationBriefing` (결정 6)
| 상태 | 언제 | 분류·상세 |
|---|---|---|
| `error` | 실행 실패(`state.failures`)가 마지막 실행보다 나중 | 분류 = 고정 이름(`io.errorName`, 원문은 넘기지 않음) · 상세 「브리핑 실행 실패(연속 N번, 마지막 MM-DD HH:MM KST)」 |
| `missing` | 실행 기록 없음 | — |
| `stale` | 마지막 실행이 10시간 넘음(정시 판 최장 간격 23:00→08:00 9시간 + 1시간 — §11.10.4 부터 실행 간격 22:40→07:10 8시간 30분, 기준 10시간 그대로) | 상세 「마지막 실행 … — 정시 판(07:30·17:30·23:00)이 10시간 넘게 없음」 |
| `partial` | AI 방식(`method` ≠ template, 개발 환경 아님)인데 마지막 실행에서 틀(AI 해설 없음)로 대체된 관할이 있음 | 분류 「브리핑 일부 실패 — AI 총평 대신 틀」 · 상세 「마지막 실행 AI 총평 대신 틀 N곳(validate n·call n) — 생성 방식 chatgpt」 |
| `ok` | 그 밖(VM 이 실패하고 Gemini 가 쓴 것처럼 결과가 AI 면 정상) | — |

판정 함수는 `station_briefing.historyRow` 하나 — 실행 직후(`run`·`reportFailure`)와 1분 감시(`risk_history_sources.briefingSource`, 운영만)가 같은 판정이라 감시가 다른 상태로 덮어 가짜 사건을 만들지 않는다. 데이터 수집현황 목록표 1단계 「활동지점 안전 브리핑 (우리 서버 생성)」(출처 `seagnal` 「우리 서버 생성」, 일정 08:00·17:30·23:00), 관리자 원천 선택지 「활동지점 안전 브리핑」.

## 6.2 2026-10-16 추가 결정 — 사용자 원문 *"모두 추천대로."* (설계서 §11.8 「추가 결정」)
- **공식 사고예보 「경계」도 거른다**: 「주의」처럼 같은 3시간 칸에 기상(특보·해구 파고 2m·풍속 12m/s)이나 혼잡('높음' 이상) 근거가 겹칠 때만 총평(`overview`·`sea.overviewLevel`·`sea.overviewTop`·카드 `overview`/`overviewRank`)에. 거른 칸도 카드 `rank`·`word`·`today.lines` 와 시간 막대 `timeBar[].rank` 에는 그대로 「경계 필요」. AI 검증 단계 상한(`levels.sea`, §5)은 총평 단계에서 오므로 함께 바뀐다. 규칙 판 `station-briefing-rules-v4`.
- **「특보 해제 뒤」는 「오늘 바뀐 요소」로 세지 않는다**(지금 규칙 확정).
- **파출소 주소 번지 엇갈림 3곳**(부산 남항 91/89·임원 12-18/12-22·지도 68/70)은 정리판 그대로(`station_addresses.md`).
- **「전남광주통합특별시」**: 대표 위치 카카오 대조(`coastal_events_collector.addressKey`)가 새 이름·옛 이름(전라남도·광주광역시)을 같은 시도로 본다 — 카카오가 어느 이름으로 답해도 목포·완도·여수서 관할 주소와 맞는다.
- (브리핑 밖) 공식 사고예보 단계별 칸 수 기록 — 관리자 `GET /api/admin/risk-forecast/accident-level-stats?days=7`(관리자 토큰). 형식은 설계서 §11.8 추가 결정 B.

## 7. 화면 단계에 넘기는 메모

> **화면 2단계 구현됨(2026-10-16)** — `client/js/forecast/station-briefing/`(아코디언·설정 흐름·본문·N 뱃지·바로가기·[기준 상세]) · `client/js/admin/admin_station_briefing.js`(AI → 「AI 브리핑」) · 시험 `local_server/scripts/test_station_briefing_ui.js`. 아래 메모는 그대로 지켰다.


- 관할 고르기는 §11.6 Q3 「파출소 관할 하나만 고르면 해상·육상 둘 다」 — `stations` 의 `key` 를 저장한다.
- 해상만 관할은 육상 칸 대신 `seaOnlyReason` 한 줄.
- 시간 막대 색은 단계 0~3. `events` 가 있는 칸에 ⚑.
- 「지금 밀집」(`now`)은 오늘 판에서만 온다.
- 관리자 오류현황(위험예측 오류현황 `risk_error_history`)에 원천 `stationBriefing` 으로 들어간다(2026-10-16 결정 6 *"추천대로"* — §6.1). 상세 오류 목록은 여전히 `status.errors`.
