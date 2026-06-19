# #36 cat=2 zone-miss 잔존 3건 디버그 — 시점 A (buoyToZone / ZONE_COORDS)

> 입력: `phase2b_sentinel_v2.jsonl` 의 ANG-2-01b / NAV-2-01b / PO-2-01b (잔존 zone-miss)
> 코드 정본: `routes/assistant.js` (2666 lines)
> 본 문서는 **진단만**. 수정 코드 0.

---

## 0. 핵심 한 줄

**`expect_zone_match` 는 답 텍스트의 *부분일치* 검사** (`zone in ans`, runner L172~176). 따라서:

- 답에 `"거문도"`, `"동해중부"`, `"동해광역"` 문자열이 **그대로** 들어가야 통과.
- 그러나 현행 파이프라인은 follow-up 단계에서 `focus.zone` 을 **표준 해역명**(예: "남해서부동쪽먼바다", "동해중부앞바다")으로 *치환* 한 뒤 synth 가 그 이름을 출력 → 원래 사용자 키워드(거문도/동해중부/동해광역)는 답에서 사라진다.

세 케이스의 실패 메커니즘은 **서로 다른 위치**에서 발생하며, 단일 패치로는 다 못 잡는다.

---

## 1. 3 케이스 실 질의·prev_id chain (jsonl 정확 인용)

### 1.1 ANG-2-01 (angler / 낚시)

```jsonl
{"id":"ANG-2-01a","jikgun":"angler","category":2,"label":"후속 선행","profile":{"purpose":"낚시"},
 "query":"거문도 파고 알려줘",
 "expect_tools_any":["get_marine_forecast","get_buoy_observation","get_fishing_index","get_tide"], ...}
{"id":"ANG-2-01b","jikgun":"angler","category":2,"label":"후속 잇기","profile":{"purpose":"낚시"},
 "query":"거기 풍속은?","prev_id":"ANG-2-01a","expect_zone_match":"거문도",
 "expect_no_halluc":true, ...}
```

- 선행 질의의 **앵커**: "거문도" (부이 지명, ZONE_NAMES 비포함).
- 잇기 질의: 대명사 "거기" → PRONOUN_RE 매칭 (`L1787`).
- **기대**: 후속 답이 여전히 "거문도" 라는 단어를 입에 담을 것.

### 1.2 NAV-2-01 (navy / 해군)

```jsonl
{"id":"NAV-2-01a","jikgun":"navy","category":2,"label":"후속 선행","profile":{"occupation":"해군"},
 "query":"동해중부 파고",
 "expect_tools_any":["get_marine_forecast","get_warning","get_depth","get_buoy_observation"], ...}
{"id":"NAV-2-01b","jikgun":"navy","category":2,"label":"후속 잇기","profile":{"occupation":"해군"},
 "query":"거기 수심?","prev_id":"NAV-2-01a","expect_zone_match":"동해중부",
 "expect_no_halluc":true, ...}
```

- 앵커: "동해중부" (비표준 광역 alias — `ZONE_NAME_TO_CODE` 에는 `동해중부앞바다/먼바다/안쪽먼바다/바깥먼바다` 만, 단독 "동해중부" 키 없음).
- 잇기: "거기 수심?" → PRONOUN_RE 매칭 + R8 (navy + 수심 → `get_depth`).

### 1.3 PO-2-01 (public_org / 해양환경공단)

```jsonl
{"id":"PO-2-01a","jikgun":"public_org","category":2,"label":"후속 선행","profile":{"affiliation":"해양환경공단"},
 "query":"동해광역 시정",
 "expect_tools_any":["get_marine_forecast","get_warning","get_buoy_observation","get_visibility"], ...}
{"id":"PO-2-01b","jikgun":"public_org","category":2,"label":"후속 잇기","profile":{"affiliation":"해양환경공단"},
 "query":"거기 풍속?","prev_id":"PO-2-01a","expect_zone_match":"동해광역",
 "expect_no_halluc":true, ...}
```

- 앵커: **"동해광역"** — `ZONE_NAME_TO_CODE` 전무, `detectZoneDeterministic` 의 3단도 모두 실패(아래 §4 참조).

---

## 2. ANG-2-01b — buoyToZone 호출 추적 (거문도)

### 2.1 데이터 검증

- `buoyLocations.js:11`:
  ```
  "22103": { name: "거문도", lon: 127.5014, lat: 34.0014, type: "B" }
  ```
- 따라서 `BUOY_BY_ID` 에 `{ name:"거문도", nname:"거문도", lat:34.0014, lon:127.5014 }` 등재됨.
- `buoyToCoords("거문도")` (`L114~121`) → `{ lat:34.0014, lon:127.5014 }` ✓

### 2.2 `nearestZoneByCoords(34.0014, 127.5014)` 거리 계산

`L128~150` 의 거리식 `dx=(lat-c.lat)*111, dy=(lon-c.lon)*88, d=sqrt(dx²+dy²)`. ZONE_COORDS 후보(거문도와 동·서·남해 인근):

| code      | name                  | lat   | lon    | dx     | dy     | d(km) |
|-----------|-----------------------|-------|--------|--------|--------|-------|
| 12B10102  | 전남동부남해앞바다     | 34.38 | 127.50 | -41.95 |   0.12 | **41.95** |
| 12B10202  | 남해서부동쪽먼바다     | 33.80 | 127.80 |  22.36 | -26.27 | **34.50** ★ |
| 12B10101  | 전남서부남해앞바다     | 34.23 | 126.11 | -25.40 | 122.40 | 124.99 |
| 12B10201  | 남해서부서쪽먼바다     | 33.80 | 126.14 |  22.36 | 119.76 | 121.83 |

**최소** = 12B10202 (`남해서부동쪽먼바다`, ~34.5km). `bestD ≤ 200` 만족 → `buoyToZone("거문도")` = **"남해서부동쪽먼바다"** 반환.

### 2.3 부작용 — `focus.zone` 이 **이미 채워짐**

`deriveFocus` 6단 사다리 (`L1476~1500`):

```
1) plan.zone/zoneName          — ANG-2-01a: plan.zone=null (LLM 이 비표준 거문도 처리)
2) top.zone(items)              — N/A (랭킹 없음)
3) detectZoneDeterministic(q)   — "거문도 파고 알려줘" → null (ZONE_NAMES 에 거문도 없음)
4) haeguToZone(focus.haegu)     — focus.haegu=null
5) buoyToZone(focus.buoy)       — ★ "남해서부동쪽먼바다" 강제 채움
6) rankedItems[0].zone          — skip (이미 채워짐)
```

→ ANG-2-01a 의 응답 focus = `{ zone:"남해서부동쪽먼바다", buoy:"거문도", coords:{34.0014,127.5014} }`.

### 2.4 후속(ANG-2-01b) 에서의 회귀

`runBrain` (`L1864~1879`) 의 **C4 게이트**:

```js
if (isPronounFollowup && focusBuoy && !focusZone) {
    // get_buoy_observation 강제 추가 → 부이명 그대로 답에 등장
}
```

- 조건 `!focusZone` = **false** (이미 "남해서부동쪽먼바다" 가 들어있음) → **게이트 미발동**.
- 대신 `FOCUS_ZONE_ARG` (`L1799~1813`) zone-arg 3단 (`L1819~1828`) 으로 모든 도구에 `zone="남해서부동쪽먼바다"` 가 박힘.
- synth 답: "남해서부동쪽먼바다 ... 풍속 ..." — **"거문도" 문자열이 사라짐** → C 축 fail.

> **핵심 회귀**: `buoyToZone` 의 친절(focus.zone 자동 보강) 이 C4 게이트의 발동조건(`!focusZone`)을 무력화. *zone 은 알지만 부이명을 잃는다* 의 정확한 표본.

---

## 3. NAV-2-01b — `detectZoneDeterministic` 동해중부 추적

### 3.1 선행(NAV-2-01a) "동해중부 파고" 진단

`detectZoneDeterministic("동해중부 파고")` (`L586~643`):

- nq = `"동해중부파고"`.
- **Stage 1**: 정규화된 zone 명이 nq 에 포함? `동해중부앞바다/먼바다/...` 모두 nq 에 미포함 → fail.
- **Stage 2** (REGION_DIR_RE 토큰 매칭, `L600`):
    - `REGION_DIR_RE = /제주|북부|남부|동부|서부|북쪽|남쪽|동쪽|서쪽|인천|경기|충남|전북|전남|경남|부산|거제|울산|경북|강원|서해|남해|동해|중부/g`
    - 동해중부앞바다 → toks=["동해","중부"], 둘 다 nq 포함 → 2-token 매칭 ✓
    - 같은 점수의 동해중부먼바다는 wantFar=false ("먼바다" nq 미포함) → 앞바다 보존.
- **결과**: `detectZoneDeterministic("동해중부 파고")` = **"동해중부앞바다"** ✓

LLM plan 도 정상이면 `plan.zone="동해중부앞바다"` → `get_marine_forecast(zone="동해중부앞바다")` → 정상 응답.

deriveFocus → `focus.zone="동해중부앞바다"`.

### 3.2 후속(NAV-2-01b) "거기 수심?"

- PRONOUN_RE("거기") match → isPronounFollowup.
- zone-arg 3단 → `get_depth(zone="동해중부앞바다")` 호출.
- synth 답에 **"동해중부앞바다"** 등장 — **"동해중부" 부분일치 포함** → **C 축 통과되어야 함**.

### 3.3 그래도 실패하는 이유 — 가설 후보

NAV-2-01b 가 잔존 fail 인 원인은 *zone-arg 폴백 자체* 가 아니라:

1. **선행(NAV-2-01a) 실패 전파**: LLM 이 plan.zone 을 다르게 채움(예: "동해" 만, 혹은 null). `canonZone` 이 안 잡아 빈 결과 → `gotUseful=false` → `chain zone-miss 안전 거절`(`L1978~2003`) 도달 가능. 거절 메시지엔 "동해중부" 없음.
2. **deriveFocus 의 plan.zone 신뢰** (`L1447`): `focus.zone = zoneName || plan.zone || null`. LLM 이 비표준명("동해", "동해중부광역") 을 plan.zone 에 넣으면 그대로 focus.zone 으로 박힘 → canonZone 도 보호 못 함 → 후속 zone-arg 도 비표준 그대로 → 도구 실패.
3. **synth 가 zone 이름 생략**: gemini 답이 "수심은 ~m 입니다" 처럼 zone 명 생략 (간결 답 규칙 L2050 의 부작용). 이 경우 "동해중부" 누락.

→ 가장 의심: (2)+(3) 복합. 결정타를 위해 **runtime 실측 로그 필요** (planner 의 raw output / synth 답 raw text).

---

## 4. PO-2-01b — "동해광역" 매핑 부재 (가장 확정적 원인)

### 4.1 `ZONE_NAME_TO_CODE` 검증 (`L508~552`)

`동해광역` / `동해중부광역` / `동해전역` / `동해권역` — **단일 키 없음**.
`광역` 토큰 자체도 `REGION_DIR_RE` (`L600`) 에 미수록 → fuzzy 매칭도 불능.

### 4.2 선행(PO-2-01a) "동해광역 시정" 단계별 추적

- `detectZoneDeterministic("동해광역 시정")`:
    - nq = `"동해광역시정"`.
    - Stage 1: zone 명 포함 없음.
    - Stage 2: REGION_DIR_RE 로 zone 토큰 추출 시도. 모든 동해 zone 의 토큰 ⊃ {동해, 중부/남부/북부/...} — "중부/남부/북부" 가 nq 에 없으므로 매칭 0건.
    - Stage 3: nqTokens = ["동해"] (광역 미수록). 길이 1 < 2 임계치 → **null**.
- `resolveZoneName("동해광역")` = `ZONE_NAME_TO_CODE["동해광역"]` ⇒ undefined → `detectZoneDeterministic("동해광역")` → **null**.
- LLM 이 plan.zone 을 어떻게 채우든:
    - "동해광역" 그대로면 `get_marine_forecast(zone="동해광역")` → `resolveZoneName` 폴백도 null → `{error:"해당 해역 단기예보가 없습니다.", zone:null}`.
    - "동해중부앞바다" 등 추측으로 정정하면 통과 가능 (LLM 운).
    - `get_visibility(place="동해광역")` → `getVisibility` 의 place 매칭도 zone 명 기반 → 실패 가능.

### 4.3 후속(PO-2-01b) 에서의 회귀

- focus.zone 은 "동해광역" 그대로 박힌 채(L1447, plan.zone 신뢰) 후속에 전달되거나, 아예 null.
- 시나리오 a (focus.zone="동해광역"):
    - canonZone("동해광역") → detectZoneDeterministic 가 null → z 보존 → 도구마다 zone="동해광역" → 전부 error.
    - results 는 error 만, `gotUseful=false` → `isDomainQuery=true` (풍속 키워드) → web_search 도 차단됨 (L2004 `!isDomainQuery` 필요).
    - synth 가 빈 results 로 가다가 — 실제로는 L1969 `results.length===0` 도 아니고, L1983 anchorOk 검사로 갈 수 있음. anchorOk: focus.buoy/haegu/coords 모두 null 이면 false → "이 후속 질의에 적용할 해역을 찾지 못했어요" 거절. **"동해광역" 미포함** → C fail.
- 시나리오 b (focus.zone=null + buoyToZone/haeguToZone 무관):
    - deriveFocus 6 단 모두 fail → chain zone-miss 거절 동일.

→ **PO 케이스는 ZONE_NAME_TO_CODE 의 alias 부재가 원인이며**, `buoyToZone` 폴백은 손도 못 댐 (focus.buoy 가 비어있음).

---

## 5. `ZONE_COORDS` 데이터 검증 정리

- `ZONE_COORDS` 는 `seaZoneCoordinates.js` (455 lines) 의 정규식 파싱 (`L267~278`).
  키는 zone *code* (예: "12C20100"), 값은 `{lat, lon}`.
- 12C20100 = **"동해중부안쪽먼바다"** (lat 37.90, lon 130.00) ← seaZoneCoordinates.js 의 raw name.
- ZONE_NAME_TO_CODE 측: `"동해중부앞바다": "12C20100"`. **이름과 좌표 출처가 분리**되어 있고, `nearestZoneByCoords._codeToName` 가 ZONE_NAME_TO_CODE 의 첫 매칭(`"동해중부앞바다"`) 으로 인덱스 빌드.
- 따라서 buoyToZone code→name 결과는 **"동해중부앞바다"** (raw 이름 "동해중부안쪽먼바다" 와 다름) — 정상 거동.
- ZONE_COORDS 키 개수는 가동 시 콘솔 로그 `[Assistant] 해역 좌표 N개 로드됨` 으로 확인 가능 (실측 별도 필요).

**광역 alias 부재**:

| 광역 이름   | ZONE_NAME_TO_CODE 키 존재? |
|-------------|----------------------------|
| 동해광역    | 없음 |
| 동해전역    | 없음 |
| 동해권역    | 없음 |
| 서해광역    | 없음 |
| 서해전역    | 없음 |
| 남해광역    | 없음 |
| 남해전역    | 없음 |
| 제주광역    | 없음 |
| 거문도(부이→해역) | 없음 (PoT: buoy→zone 폴백으로만 해소) |
| 추자도(섬→해역) | 없음 |

---

## 6. `detectZoneDeterministic` / fuzzy stage 3 한계

- Stage 3 nqTokens ≥ 2 요건은 "전남" 단일 같은 과매칭 차단용이지만, "동해광역" 같이 *광역 alias + 방위 1개* 패턴을 함께 죽인다.
- REGION_DIR_RE 에 "광역|전역|권역|연안" 같은 *범위 토큰* 이 없음 → 광역 alias 입력을 root zone(예: "동해중부앞바다") 으로 점프 못 함.

---

## 7. focus.zone vs zone-miss 분기 — 의사코드 추적

```
runBrain(query, profile, memory, style, location, focus):
    plan = planQuery(...)
    cq = plan.correctedQuery || query

    isPronounFollowup  = PRONOUN_RE.test(cq)                # 거기/그곳/...
    isChainFollowup    = !!(focus && (focus.zone || focus.haegu || focus.buoy || focus.coords))
    isFollowup         = isPronounFollowup || isChainFollowup
    focusZone          = focus && focus.zone

    for step in plan.steps:
        if step.args.zone: step.args.zone = canonZone(step.args.zone)
        if !isFollowup: continue

        # [zone-arg 3단]  (a) LLM canonZone  →  (b) focusZone  →  (c) detectZoneDeterministic(cq)
        zoneArg = FOCUS_ZONE_ARG[step.tool]
        if zoneArg:
            z = step.args[zoneArg]
            if string(z): z = canonZone(z)
            if !z && focusZone: z = focusZone                # ★ "동해광역" 같은 비표준 그대로 통과
            if !z: z = detectZoneDeterministic(cq)
            if z: step.args[zoneArg] = z

        if focusHaegu  && step.tool == 'get_zone_forecast'    && !step.args.zoneId   : step.args.zoneId  = focusHaegu
        if focusBuoy   && step.tool == 'get_buoy_observation' && !step.args.buoyName : step.args.buoyName= focusBuoy
        if focusCoords && COORD_TOOLS.has(step.tool) && step.args.lat==null && step.args.lon==null: step.args.lat,lon = focusCoords

    # [HUNK#4b 7단 profile default]
    if isFollowup && !focusZone:
        for step: step.args[zA] = profileDefaultZone(profile)

    # [C4 ANG-2-01b 부이 폴백] ★ !focusZone 조건이 buoyToZone 의 보강에 의해 무력화
    if isPronounFollowup && focusBuoy && !focusZone && needsBuoyObs:
        plan.steps.unshift(get_buoy_observation(buoyName=focusBuoy))

    results = exec(plan.steps)

    if isDomainQuery && results.length == 0:
        return "위치를 좀 더 구체적으로..."

    if isChainFollowup && !focusZone && isDomainQuery && results.length > 0:
        if !anchorOk(results, focus): return "이 후속 질의에 적용할 해역을 찾지 못했어요..."

    if !gotUseful && !isDomainQuery: web_search...
    synth(plan, results, focus, cq, profile, memory)
```

**3 케이스 실패 분기 요약**:

| case        | focusZone 상태                     | zone-arg 결과                       | C4 게이트 발동? | 실패 지점 |
|-------------|------------------------------------|--------------------------------------|-----------------|-----------|
| ANG-2-01b   | "남해서부동쪽먼바다" (buoyToZone)  | 도구 정상 호출, 답에 zone 명 박힘   | ❌ (`focusZone` 채워짐) | synth 답이 "거문도" 미언급 |
| NAV-2-01b   | "동해중부앞바다" 또는 null (LLM 의존) | 정상 또는 빈 결과                  | (focusBuoy null) | synth 가 "동해중부" 생략 or 거절 |
| PO-2-01b    | "동해광역" 또는 null                | canonZone 무력 → 도구 error 양산   | (focusBuoy null) | chain zone-miss 거절 (zone 부재) |

---

## 8. 수정 후보 3안 (제안만 — 코드 미수정)

### (a) `ZONE_COORDS` 거리 한도 200km → 400km 완화

- 위치: `L149` `(best && bestD <= 200) ? best : null` → 400.
- 효과: **거의 없음**. 본 3 케이스 모두 거리 문제 아님 (거문도 ~34km, 다른 둘은 buoyToZone 미사용).
- 위험: 먼 부이가 엉뚱한 광역 zone 에 강제 매칭 → 다른 카테고리 회귀 가능.
- **권장도: 낮음**. 본 패치로는 3건 모두 미해결.

### (b) `ZONE_NAME_TO_CODE` 광역 alias 카탈로그 추가 (★ 권장)

- 위치: `L508~552` 의 ZONE_NAME_TO_CODE 표에 alias 행 추가 (또는 `resolveZoneName` 내 별도 alias 맵 사용).
- 카탈로그(약 12 건):
    ```
    '동해광역':   '12C20100',  // 동해중부앞바다로 정착 (광역 대표)
    '동해전역':   '12C20100',
    '동해권역':   '12C20100',
    '동해중부':   '12C20100',  // 단독 alias
    '동해남부':   '12C10100',
    '동해북부':   '12C30100',
    '서해광역':   '12A20100',
    '서해전역':   '12A20100',
    '서해중부':   '12A20100',
    '서해남부':   '12A30100',
    '서해북부':   '12A10100',
    '남해광역':   '12B10100',
    '남해전역':   '12B10100',
    '남해서부':   '12B10100',
    '남해동부':   '12B20100',
    '제주광역':   '12B10300',
    '제주전역':   '12B10300',
    ```
- 부수: `REGION_DIR_RE` 에 `광역|전역|권역` 추가도 같이 (3단 nqTokens 다양화).
- 효과:
    - PO-2-01a/b: "동해광역" → "동해중부앞바다" 정착 → focus.zone 정상 + synth 답에 "동해중부" 포함. 단, **"동해광역" 문자열 자체가 답에 들어가야 C 통과** → alias 채택 시 답에는 "동해중부앞바다" 가 박혀, "동해광역" 부분일치는 여전히 실패 위험. 보완으로 synth 프롬프트에 "사용자가 광역 alias 로 부르면 답에도 그 alias 를 1회 언급"같은 룰 또는 sentinel `expect_zone_match` 를 정규화 후 substring 비교로 완화 검토.
    - NAV-2-01: "동해중부" → 정확 매핑 후 답에 "동해중부앞바다" 등장 → 부분일치 OK.
- **권장도: 높음** (NAV 즉시 해결, PO 는 sentinel 정의 보정과 병행).

### (c) `buoyToZone` 결과를 deriveFocus 6단 + runBrain zone-arg 폴백 양쪽 호출

- 의도: focus.zone 보강 시점을 늦춰, `C4 게이트(!focusZone)` 가 발동할 수 있게 함.
- 구체:
    1. `deriveFocus` 의 5단(buoyToZone)을 **제거** 또는 `focus.zoneBackup` 같은 별도 필드로 분리.
    2. runBrain 의 zone-arg 3단 (c)검색 후 추가 4단으로 `focusBuoy && buoyToZone(focusBuoy)` 호출.
    3. C4 게이트 조건을 `!focusZone` → `!focusZoneStrict`(LLM·detectZone 출처만 신뢰) 로 좁힘.
- 효과:
    - ANG-2-01b: focus.zone null → C4 게이트 발동 → `get_buoy_observation(buoyName="거문도")` 강제 → 답에 "거문도" 등장 → C 통과.
    - NAV/PO 에는 무영향.
- 위험: 다른 chain (Buoy chain) 에서 focus.zone 이 비어 후속 zone-arg 가 cq 의 detectZone 으로 떨어짐 → "그 해역" 같이 zone 없는 질의가 zone 누락된 채 호출될 수 있음. 영향 면 점검 필요 (sentinel/freevar 회귀 테스트).
- **권장도: 중간**. ANG 직타. 단독으론 NAV/PO 무력.

---

## 9. 결론

- **3건 모두 다른 메커니즘** → 단일 패치로 못 잡음.
    - ANG-2-01b: `buoyToZone` 의 친절이 C4 게이트 무력화 → **(c)** 가 정타.
    - NAV-2-01b: synth 의 zone-명 생략 또는 LLM plan 비표준 zone 박힘 → **(b)** 가 정타 + synth prompt 보강 검토.
    - PO-2-01b: ZONE_NAME_TO_CODE alias 부재 → **(b)** 가 필수, 추가로 `expect_zone_match` 정의 완화 또는 synth 가 사용자 입력 alias 를 1회 미러링 (별도 시점 검토).
- 거리 한도 완화 **(a)** 는 본 3건 무효 → 보류.

---

## 핵심 원인 한 줄

`buoyToZone` 의 자동 focus.zone 보강이 ANG 의 C4 부이-폴백 게이트를 무력화하고, ZONE_NAME_TO_CODE 의 광역 alias 부재가 NAV/PO 의 zone 분기를 끊는다.

## 권고 수정안 한 줄

**(b) ZONE_NAME_TO_CODE 광역 alias 12건 추가 + REGION_DIR_RE 에 광역/전역/권역 토큰 추가** 와 **(c) deriveFocus 5단(buoyToZone) 을 runBrain zone-arg 폴백 후단으로 이동해 C4 게이트 보존** 의 병행 적용.
