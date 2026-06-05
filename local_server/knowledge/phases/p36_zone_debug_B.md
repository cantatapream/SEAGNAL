# #36 cat=2 zone-miss 잔존 3건 디버그 시점 B — chain_focus·prev_id 흐름 추적

> 입력: phase2b_sentinel_v2.jsonl (ANG/NAV/PO -2-01a/b 6건), phase0_runner.py(`run_sentinel_v2`), routes/assistant.js(deriveFocus·runBrain·PRONOUN_RE·zone-arg 폴백·chain 거절), p_continuity_v2_synthesis.md(7단계 폴백).
> 본 문서는 **진단 only**. 코드 수정 0. chain 흐름 + isChainFollowup 발동 조건 + synth 답변 zone 누락의 원인 + 수정 후보 3안.

---

## 1. 잔존 실패 3건 — 사실 시트

| ID | profile | 선행 query | 후속 query | expect_zone_match | 핵심 의문 |
|----|---------|-----------|-----------|-------------------|----------|
| **ANG-2-01b** | angler {purpose:낚시} | "거문도 파고 알려줘" | "거기 풍속은?" | **거문도** | "거문도"는 *부이*임 (해역명 미존재) |
| **NAV-2-01b** | navy {occupation:해군} | "동해중부 파고" | "거기 수심?" | **동해중부** | "동해중부"는 *부분 명* (해역명에 "앞바다/먼바다" 후미 필수) |
| **PO-2-01b** | public_org {affiliation:해양환경공단} | "동해광역 시정" | "거기 풍속?" | **동해광역** | "동해광역"은 *zone 사전에 전무* (행정/광역 단어) |

세 케이스 공통점: **expect 의 zone 문자열이 ZONE_NAMES(L554) 의 표준 해역명과 정확히 일치하지 않는다**. 즉 어떤 zone 폴백 단계를 거쳐도 `focus.zone` 에 "거문도"/"동해중부"/"동해광역" 문자열이 그대로 저장될 가능성은 0 에 수렴한다. 이것이 검사기 `expect_zone_match → "거문도" in ans` 와의 본질적 부정합.

---

## 2. chain 흐름 정밀 추적 — 선행(01a) → 후속(01b)

### 2.1 phase0_runner 의 chain_focus 전달 (phase0_runner.py L285·L289·L303)

```python
chain_focus = {}                                   # case-id → 직전 응답 focus
for i, c in enumerate(cases, 1):
    if c.get("prev_id") and chain_focus.get(c["prev_id"]):
        c = dict(c)
        c["focus"] = chain_focus[c["prev_id"]]    # 후속 요청 body 에 focus 동봉
    resp, err = sentinel_v2_call(c, i)
    ...
    if resp is not None:
        chain_focus[c["id"]] = resp.get("focus") or None   # 매 응답 focus 저장
```

`sentinel_v2_call` 은 `body["focus"] = case["focus"]` 로 전송(L184–185). 즉 **모든 후속 케이스의 request body 에 직전 턴 `runBrain` 응답의 focus 객체가 그대로 동봉**된다. 누락·소실 없음. runner 측은 정상.

### 2.2 서버 진입 — routes/assistant.js L2111

```js
const focus = (req.body && req.body.focus && typeof req.body.focus === 'object') ? req.body.focus : null;
...
const brain = await runBrain(query, profile, memory, style, loc, focus);   // L2137
```

focus 객체가 runBrain 6번째 인자로 전달된다. planQuery 에는 `(query, profile, location, memory, focus)` 로 전달(L1760), focusLine(L1515–) 으로 LLM 프롬프트에 `[직전 확정 대상] 해역=… 해구=… 부이/지점=…` 라벨로 삽입.

### 2.3 선행 01a 의 응답 focus — 케이스별 추정

`deriveFocus(plan, results, plan.zone, cq)` 가 응답에 반환된다(L2084).

**ANG-2-01a: "거문도 파고 알려줘"**
- `detectZoneDeterministic("거문도 파고 알려줘")` → null (ZONE_NAMES 에 "거문도" 부분 매칭 zone 없음 — L591–596 의 includes 매칭 미스, REGION_DIR_RE 토큰 미보유 → 2차·3차 모두 미스).
- planQuery 가 LLM 으로 `get_buoy_observation(buoyName="거문도")` ± `get_marine_forecast(zone=null)` ± `get_fishing_index(location="거문도")` 등 선택.
- `get_buoy_observation` 결과에는 `v.name="거문도"` 가 들어옴 → `deriveFocus` L1453–1460 분기로 `focus.buoy = "거문도"`, `focus.coords = buoyToCoords("거문도") = {lat:34.0, lon:127.5}` (BUOY_BY_ID 의 22103).
- L1485 의 6단 폴백: `focus.zone` 채움 시도 — (3) detectZone(query)=null, (4) haeguToZone(focus.haegu)=null(없음), (5) `buoyToZone("거문도")` → `nearestZoneByCoords(34.0, 127.5)` → ZONE_COORDS 중 최근접 (≤200km) 표준 해역명 (예: "전남동부남해앞바다" 또는 "남해서부먼바다") — **이름이 "거문도"가 아님**.
- 결과: `focus = { zone:"전남동부남해앞바다(추정)", buoy:"거문도", coords:{34.0,127.5}, ... }`.

**NAV-2-01a: "동해중부 파고"**
- `detectZoneDeterministic("동해중부 파고")` → L591–596 의 includes 매칭: normalize("동해중부앞바다") 가 normalize("동해중부 파고") 에 포함되지 않음(앞바다/먼바다 토큰 미존재) → 1차 미스. 2차 REGION_DIR_RE 토큰: "동해"+"중부" 모두 포함 → ZONE_NAMES 중 두 토큰 다 보유한 후보: "동해중부앞바다"/"동해중부먼바다"/"동해중부안쪽먼바다"/"동해중부바깥먼바다". `wantFar=false`(query 에 "먼바다" 없음) → preferredDistance=true 인 "동해중부앞바다" 채택 가능성 가장 높음.
- 그러나 sentinel 회귀가 잔존하는 점으로 보아 plan.zone 이 LLM 입력에서 "동해중부" 로 그대로 들어와 `canonZone` 후 표준명으로 정정될 수도 있고, 또는 정정 실패로 null 일 수도 있다. 어느 경우든 **focus.zone 에는 "동해중부앞바다" 같은 표준 풀네임이 저장**되며, "동해중부" 문자열 단독으로는 아님.
- 결과: `focus.zone = "동해중부앞바다"`(추정).

**PO-2-01a: "동해광역 시정"**
- `detectZoneDeterministic("동해광역 시정")` → 1차 미스(ZONE_NAMES 에 "동해광역" 없음), 2차 토큰 "동해"만 추출 → REGION_DIR_RE 의 단일 토큰만 매칭 → toks.length=1 인 후보들 다수 중 "동해" 단일 매칭으로 "동해남부앞바다"/"동해북부앞바다"/"동해중부앞바다"… 동률 → bestScore 갱신 규칙(첫 매칭 보존) → 가장 먼저 순회된 항목 (선언 순서로 "동해남부앞바다" 추정).
- 또는 3차 nqTokens.length≥2 조건 미달이라 미스 → best 는 2차 결과.
- 결과: `focus.zone = "동해남부앞바다" 또는 "동해중부앞바다"` (어떤 경우든 "동해광역" 문자열은 아님).

### 2.4 핵심: focus.zone 에 expect 문자열이 *결코* 저장되지 않는다

세 케이스 모두 **선행 턴 응답의 `focus.zone` 에는 "거문도/동해중부/동해광역" 문자열이 아닌 *다른* 표준 해역명이 들어간다**. 따라서 후속 턴에서 focus 가 정확히 전파되더라도 synth 가 그 zone 을 쓰면 답에 표준 해역명이 등장할 뿐 expect 토큰이 등장하지 않는다.

---

## 3. runBrain 의 isChainFollowup 발동 조건 (L1788–1793)

```js
const PRONOUN_RE = /거기|그곳|그\s*곳|그쪽|그\s*해역|그\s*해구|그\s*부이|.../;
const isPronounFollowup = PRONOUN_RE.test(cq);                                       // "거기 …" → true
const isChainFollowup   = !!(focus && (focus.zone || focus.haegu || focus.buoy || focus.coords));  // focus 비어있지 않으면 true
const isFollowup        = isPronounFollowup || isChainFollowup;
```

### 발동 매트릭스 (세 케이스 모두)

| 후속 쿼리 | PRONOUN_RE 매치 | focus 동봉(runner) | → isChainFollowup | → isFollowup |
|----------|---------------|------------------|------------------|------------|
| "거기 풍속은?" (ANG-2-01b) | **true** ("거기") | true | true | **true** |
| "거기 수심?" (NAV-2-01b) | **true** ("거기") | true | true | **true** |
| "거기 풍속?" (PO-2-01b) | **true** ("거기") | true | true | **true** |

**결론**: 세 케이스 모두 *isFollowup=true* 로 자동 발동되며, 이후 zone-arg 3단 폴백(L1819–1828)·7단 profile default 폴백(L1848–1857) 모두 도달한다. **발동 자체엔 결함 없음**.

### 발동 조건 정리 (질문 "focus !== null 이면 자동 발동?")

- `isChainFollowup` 은 PRONOUN_RE 매치와 **무관**하게 `focus` 객체 4필드 중 하나라도 truthy 면 true. (단 빈 객체 `{}` 는 false — FP-5 가드.)
- `isFollowup` 은 OR 결합. 대명사가 없는 한 단어 후속("파고?", "수온?")도 focus 동봉만 되면 흡수 가능.

---

## 4. zone-arg 3단 폴백 호출 흐름 (L1815–1842)

```js
for (const step of plan.steps || []) {
    if (step.args.zone) step.args.zone = canonZone(step.args.zone);
    if (!isFollowup) continue;
    const zoneArg = FOCUS_ZONE_ARG[step.tool];        // get_visibility:'place', get_marine_forecast:'zone', ...
    if (zoneArg) {
        let z = step.args[zoneArg];
        if (typeof z === 'string') z = canonZone(z);  // (a) LLM 채운 값 정규화
        if (!z && focusZone) z = focusZone;           // (b) chain focus
        if (!z) z = detectZoneDeterministic(cq);      // (c) cq fuzzy
        if (z) step.args[zoneArg] = z;
    }
    // 해구·부이·좌표 폴백도 후속 — L1830–1841
}
```

### 세 케이스에서의 z 결정

- **ANG-2-01b ("거기 풍속은?")**: cq="거기 풍속은?" — detectZone(cq)=null. focusZone="전남동부남해앞바다(추정)". → step.args.zone = "전남동부남해앞바다". 또한 L1864–1879 의 *부이 follow-up 게이트* 가 발동 (`focusBuoy="거문도" && !focusZone(원래 false 가 아님)`) — *focusZone 이 채워졌으면 미발동*. 즉 HUNK#2 의 5단 buoyToZone 덕분에 focusZone 이 채워져, 이 부이 게이트가 *역설적으로 사라진다*. `get_buoy_observation(buoyName="거문도")` 가 plan 에 안 들어오면 부이 실측 누락.
- **NAV-2-01b ("거기 수심?")**: focusZone="동해중부앞바다(추정)" → `get_depth(zone="동해중부앞바다")` (FOCUS_ZONE_ARG.get_depth='zone'). 도구가 ZONE_COORDS 의 12C20100 좌표로 ocean/depth 조회 → 결과의 zone 라벨도 "동해중부앞바다".
- **PO-2-01b ("거기 풍속?")**: focusZone="동해남부/중부앞바다(추정)" → `get_visibility(place=…)` 또는 `get_buoy_observation(?)` 호출. 결과 zone 라벨은 표준 해역명.

세 경우 모두 zone-arg 폴백은 *정상 작동* — z 값이 결정되어 도구 args 에 주입된다. 그러나 그 z 는 **expect 토큰("거문도"/"동해중부"/"동해광역") 이 아닌 표준 해역명**이다.

---

## 5. chain zone-miss 거절 폴백 (L1983–2003) 의 미발동 분석

```js
if (isChainFollowup && !focusZone && isDomainQuery && results.length > 0) {
    const anchorOk = results.some(r => { ... });
    if (!anchorOk) return { answer: '이 후속 질의에 적용할 해역을 찾지 못했어요. ...', ... };
}
```

세 케이스 모두 `focusZone` 이 truthy (deriveFocus 6단 폴백으로 채워짐) → **`!focusZone` 조건 false → 거절 폴백 미발동**. 결과적으로 synth 까지 도달하며, synth 가 표준 해역명을 자연어로 풀어낸 답을 생성한다. 답에 "거문도" 같은 expect 토큰이 들어갈 *합리적 이유가 없다*.

(주: L1969–1977 의 환각 가드도 `results.length === 0` 조건이라 미발동.)

---

## 6. synth 입력의 zone 흐름 + 답변 누락 원인

`synth` 프롬프트(L2040–2058) 에는 두 경로로 zone 정보가 흘러간다:

1. **`personal` 블록** (`buildPersonalContext` 결과) — 직전 확정 대상 + memory.
2. **`수집결과(JSON)`** — results 배열. 각 도구 응답에 `zone` 필드(표준 해역명) 포함.

planQuery 의 focusLine(L1515–) 은 *planQuery 의 LLM 호출* 에만 들어가고, synth(Assistant-Synth) 호출 자체에는 들어가지 않는다. synth 가 보는 zone 정보는 **(a) personal 의 memory/focus 텍스트 + (b) results 의 zone 필드** 뿐.

### 답에 expect 토큰이 안 나오는 결정적 이유

- ANG-2-01b: results 의 zone="전남동부남해앞바다(추정)", buoy.name="거문도". synth 는 "거문도 부이의 풍속은 …" 정도로 답할 수 있어 *간혹 PASS* 하지만, focus.buoy 가 후속 도구 호출에 정확히 동봉되지 않거나(부이 게이트 미발동) 부이명이 LLM 자연어로 빠지면 zone-miss.
- NAV-2-01b: results 의 zone="동해중부앞바다". synth 는 자연어로 "동해 중부 앞바다 수심은 …" 으로 풀어쓸 가능성 — *expect 토큰 "동해중부"는 정확히 부분일치하므로* (`"동해중부" in "동해 중부 앞바다"` — Python `in` 은 부분문자열) **공백 처리에 민감**. 만약 LLM 이 "동해 중부 앞바다" 처럼 공백을 넣으면 검사기는 미스("동해중부" 문자열이 통째로 등장해야 함).
- PO-2-01b: focus.zone="동해남부/중부앞바다", but expect="동해광역". *기본적으로 부정합* — synth 가 "광역" 단어를 자발적으로 쓸 가능성 0. **결정적 fail**.

### sentinel_v2_check L231–234 의 검사

```python
if case.get("expect_zone_match"):
    zone = case["expect_zone_match"]
    if zone not in ans:
        fails.append("zone-miss:%s" % zone)
```

`in` 은 *순수 부분문자열 매칭*. 공백/구두점/조사 모두 영향. "동해중부" expect 는 "동해 중부 앞바다" 같은 LLM 자연어에서 깨진다.

---

## 7. 결함 분리 매트릭스

| 케이스 | 결함 유형 | 결정적 원인 |
|--------|---------|----------|
| **ANG-2-01b** | 단어 매칭 (buoy ↔ zone 불일치) | "거문도"는 zone 사전 부재, buoyToZone(5단) 이 표준 해역명을 채워 *기대값 토큰을 영구 소실*. synth 가 buoy.name 을 자연어로 호명해야만 PASS — 도구 결과의 buoy.name 보존 여부에 따라 흔들리는 *불안정 PASS*. |
| **NAV-2-01b** | 공백/표기 비결정 | focus.zone="동해중부앞바다" 가 synth 자연어로 "동해 중부 앞바다" 가 되면 expect "동해중부" 미일치. *검사기 토큰화* + *synth 표기 정책 부재* 의 합. |
| **PO-2-01b** | 사전 부재 (광역) | "동해광역" 자체가 ZONE_NAMES 에 없음 — 어떤 폴백도 expect 토큰을 살릴 수 없음. synth 프롬프트가 "동해광역" 을 자발적으로 쓰지 않는 한 영구 fail. (synthesis §9 보류 항목 4 — "광역" 류는 v3 VAGUE_TO_ZONE 사전 필요로 명시) |

---

## 8. 수정 후보 3안 — 위험·효과 비교

### (a) chain 거절 폴백을 zone-arg 폴백 *전*으로 이동 (early refuse 회피)

**의도**: deriveFocus 6단이 채워준 *부정확한* focus.zone 으로 zone-arg 폴백이 도구를 호출하기 *전*에, anchor 정합 검사를 먼저 돌려 *불일치면 친절한 거절*.

| 항목 | 평가 |
|------|------|
| 효과 | PO-2-01b 는 거절 응답이 expect 토큰을 포함하지 않으면 여전히 fail. 단 *환각은 차단*. |
| 위험 | **3** — 현재 거절 폴백은 도구 실행 결과의 anchor 검사가 전제. 도구 *전* 으로 옮기면 anchor 검사 자체가 불가(results 가 없음). 다른 가드(focus.buoy/coords 동봉만으로 통과시키는 약한 anchor)로 재설계 필요. |
| 부수효과 | dep_weave/multitool 분기와의 순서 충돌. p_continuity_v2_synthesis §4.1 의 분기 배치 원칙 위반. |
| 권고 | **비추천** — 본 3건의 본질(zone 사전 부재 + 표기 비결정) 을 해결하지 못함. |

### (b) zone-arg 3단을 4단으로 (chain_focus[prev_id].haegu 도 zone 후보)

**의도**: focusZone 폴백 우선순위에 `haeguToZone(focus.haegu)` 를 zone-arg 단계에서도 한 번 더 호출 (현 구현은 deriveFocus 안에서만 1회).

| 항목 | 평가 |
|------|------|
| 효과 | NAV-2-01b 에서 focus.haegu 가 채워진 경우 zone-arg=haeguToZone(...) 으로 더 안정적 채움 — 그러나 결과는 여전히 표준 해역명 ("동해중부앞바다"). expect "동해중부" 토큰 보존 효과 0. |
| 위험 | **1** — 중복 폴백, 결정론. |
| 부수효과 | 거의 없음(이미 deriveFocus 가 같은 일을 수행). |
| 권고 | **비추천** — 동작은 안전하나 *세 케이스의 zone-miss 해결에 무효*. |

### (c) synth 프롬프트에 "후속 답변엔 직전 zone 명을 1회 이상 명시" 규칙 추가

**의도**: synth 시스템 프롬프트(L2040–2055) 에 다음과 같은 한 줄 추가 — "**(후속 표기 규칙)** [최근 대화] 또는 [직전 확정 대상] 에 명시된 해역명·지명·부이명이 있고 사용자가 후속(거기/그곳/그 해역/그 부이) 으로 그 대상을 가리키면, **답변에 그 이름을 원형 그대로 1회 이상 명시**하세요. 표준 해역명에 공백이나 조사를 끼워 쪼개지 마세요(예: '동해중부앞바다' 를 '동해 중부 앞바다' 로 쓰지 말 것). 사용자가 부이명("거문도")을 가리키면 답 첫 줄에 그 부이명을 그대로 호명."

| 항목 | 평가 |
|------|------|
| 효과 | • ANG-2-01b: focus.buoy="거문도" 가 synth 입력에 들어가므로 답 첫 줄에 "거문도 …" 호명 → expect PASS. <br>• NAV-2-01b: focus.zone="동해중부앞바다" 가 그대로 답에 박혀 expect "동해중부" 부분문자열 일치. <br>• PO-2-01b: focus.zone 이 "동해남부/중부앞바다" 이므로 "동해광역" 토큰은 여전히 미발생 — *별도 사전 보강 필요*. |
| 위험 | **2** — synth 자연어 톤 변화 가능. 회귀: 의사결정형(가/부) 응답에 군더더기 추가될 위험. |
| 부수효과 | cat=1·3·5 회귀는 미미 (후속 케이스 자체가 cat=2 표면). |
| 권고 | **권장(주력)** — 3건 중 2건 직타 해소, 위험 2. PO-2-01b 는 별도 보강(아래) 필요. |

### (c-보강) "광역/지방" 류 사용자 어휘를 synth 답에 *그대로 인용* 규칙 추가

planQuery 의 focusLine 에 `originalQueryToken: "동해광역"` 같은 *원본 토큰* 을 추가 보존하고, synth 프롬프트 (c) 규칙에 "사용자가 '광역/관내/관할' 같은 비표준 어휘로 해역을 가리켰으면, 답에 그 어휘를 1회 인용한 뒤 표준 해역명으로 환산해 풀어쓰세요" 한 줄. PO-2-01b 에서 "동해광역(관측해역 동해남부앞바다 기준) 시정은 …" 식 답이 가능 → expect 토큰 매치.

| 항목 | 평가 |
|------|------|
| 효과 | PO-2-01b 만 추가 해소. (c) 와 함께 적용 시 3건 모두 PASS 가능. |
| 위험 | **2** — 원본 토큰 보존 필드(`focus.originalLocToken` 신설) 추가 필요 — deriveFocus 시그니처 무변(focus 객체 내 필드만 추가). |
| 권고 | **권장(보강)** — (c) 와 단일 PR. |

### 종합 권고

**(c) + (c-보강) 동시 적용**. (a)·(b) 는 본 3건의 실제 원인(synth 답변 표기 비결정 + 사전 부재)을 직타하지 못하므로 비채택. zone-arg 폴백·chain 거절 폴백의 구조 자체는 *정상 작동* 중이며, 결함은 **synth 단계의 자연어 표기 규칙 부재 + ZONE_NAMES 사전의 "광역" 류 미수록** 두 지점에 집중되어 있다.

---

## 9. 보조 관찰

1. **isChainFollowup 의존도** — 세 케이스는 모두 PRONOUN_RE 매치 + focus 동봉 둘 다 충족이라 OR 결합이 *과잉*. 둘 중 하나만 빠져도 결과 동일. 즉 본 결함은 chain 게이트 결함이 아님.
2. **deriveFocus 의 ranked/buoy 채움 순서** — focus.zone 이 비어있을 때 buoyToZone(5단) 이 *지나치게 적극적*. ANG-2-01b 에서 이 5단이 무엇이든 채워버려서 focus.zone="거문도" 가 *되지 못함* (애초에 ZONE_NAMES 에 없으니 당연). 단, **deriveFocus 의 반환 focus 객체에 `originalNameHint` 같은 비결정 토큰 필드를 별도 보존**하면 (c-보강) 의 토대.
3. **검사기 `expect_zone_match` 의 토큰화 정책** — 현 `in` 부분문자열 매칭은 공백/조사 변형에 취약. 보조 안으로 **검사기를 `re.search(zone, ans.replace(/\s/g,''))` 로 정규화**도 가능하나, 이는 *런타임 결함 회피* 가 아닌 *검사 완화* 라 정직성 측면에서 (c) 가 우선.

---

## 10. 결론

**핵심 원인 (한 줄)**: 세 케이스의 expect_zone_match 토큰("거문도"/"동해중부"/"동해광역") 은 모두 ZONE_NAMES 표준 해역명과 정확히 일치하지 않아 deriveFocus 의 7단 폴백을 모두 통과해도 focus.zone 에 *결코* 그 문자열이 저장되지 않으며, synth 가 표준명을 자연어로 풀어쓸 때 공백·조사·환산이 끼어들어 부분문자열 매칭이 깨진다(특히 "동해광역" 은 사전 자체 부재로 영구 fail).

**권고 수정안 (한 줄)**: synth 시스템 프롬프트에 "후속 응답엔 직전 확정 대상(focus.zone/focus.buoy) 명을 원형 그대로 공백 없이 1회 이상 명시" 규칙 1줄 + focus 객체에 `originalLocToken` (사용자 원어휘) 필드 보존을 추가하고 synth 가 비표준 광역어("동해광역")를 인용 후 표준명으로 환산하도록 지시 — (c)+(c-보강) 동시 적용으로 ANG/NAV 직타·PO 해소, 위험 등급 2.
