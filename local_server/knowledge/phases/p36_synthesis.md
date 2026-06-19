# #36 cat=2 zone-miss 잔존 3건 합성 — A·B 진단 통합 + 코드 적용 가능 설계서

> 입력
> - `p36_zone_debug_A.md` (워커 A: buoyToZone 자동 보강이 C4 게이트 무력화 + ZONE_NAME_TO_CODE 광역 alias 부재, 권고 (b)+(c) 병행)
> - `p36_zone_debug_B.md` (워커 B: synth 가 표준명 풀어쓸 때 공백/조사 매칭 깨짐, originalLocToken 보존 권고)
>
> 본 문서는 **합성 설계서**. **직접 코드 수정 0**. 의사코드와 hunk-diff 는 후속 적용자(별도 워커) 참조용.

---

## 0. 핵심 합성 결정 (한 줄)

(b) ZONE_NAME_TO_CODE 광역 alias 12건 + REGION_DIR_RE 광역/전역/권역 토큰 추가 + (c) deriveFocus 5단(buoyToZone) 을 runBrain zone-arg 폴백 후단으로 이동(C4 게이트 보존) + synth 프롬프트 후속 표기 규칙 1줄 + focus.originalLocToken 신규 필드 보존 — 4 hunk 단일 PR 로 ANG/NAV/PO 3건 동시 해소.

---

## 1. 3 케이스 실패 메커니즘 통합표

| ID | 사용자 입력 | A 진단 (zone 사전·게이트) | B 진단 (synth 표기·focus) | 통합 결론 | 통합 해결 |
|----|------------|---------------------------|---------------------------|----------|----------|
| **ANG-2-01b** | 거문도 파고 → 거기 풍속? | `buoyToZone("거문도")` 가 deriveFocus 5단에서 `focus.zone="남해서부동쪽먼바다"` 강제 보강 → runBrain L1864~1879 **C4 부이-폴백 게이트(`!focusZone`)** 미발동 → `get_buoy_observation(buoyName="거문도")` 강제 추가 안 됨 → 답에 "거문도" 사라짐 | focus.buoy="거문도" 는 보존되나 plan.steps 에 `get_buoy_observation` 이 빠지면 synth 가 buoy.name 호명할 근거 없음. 게다가 focus 객체에 *원어휘 보존 필드* 부재 | A 진단 = 게이트 무력화가 1차 원인. B 진단 = focus.buoy 호명 *근거 부재* 가 2차 원인. **두 진단 일치** (게이트만 살려도 buoy 도구가 plan 에 들어와 buoy.name 자연 호명) | **(c)** deriveFocus 5단을 runBrain zone-arg 폴백 후단으로 이동 → C4 게이트 보존 → `get_buoy_observation(buoyName="거문도")` 강제 → synth 답에 "거문도" 등장. **보강**: focus.originalLocToken 으로 synth 가 1회 미러링. |
| **NAV-2-01b** | 동해중부 파고 → 거기 수심? | `detectZoneDeterministic("동해중부 파고")` Stage 2 의 REGION_DIR_RE 토큰("동해","중부") 2-token 매칭 → "동해중부앞바다" 정확 매핑됨 (※ 그러나 LLM plan.zone 이 비표준명 박힐 가능성 + synth 의 zone 명 생략 가능성) | focus.zone="동해중부앞바다" 까지는 도달. **synth 가 "동해 중부 앞바다" 처럼 공백 분리해 풀어쓰면** sentinel 의 `"동해중부" in ans` 부분문자열 검사 깨짐. 또는 synth 가 zone 명 생략 | A = LLM/canonZone 단계 안정성 의심 / B = synth 표기 비결정 (공백·조사). **B 가 더 정확** — Stage 2 매칭은 결정론적으로 성공. 잔존 실패는 synth 자연어 단계. | **synth 프롬프트 규칙 1줄** "후속 응답엔 직전 zone 명을 원형 공백 없이 1회 이상 명시" → "동해중부앞바다" 그대로 박혀 부분문자열 통과. **보조 안전망**: (b) 의 단독 "동해중부" alias 도 추가해 plan/canonZone 단계 안정화. |
| **PO-2-01b** | 동해광역 시정 → 거기 풍속? | `ZONE_NAME_TO_CODE["동해광역"]` undefined, `REGION_DIR_RE` 에 "광역" 미수록 → detectZoneDeterministic Stage 3 nqTokens=["동해"] 길이 1 < 2 임계 → null. LLM 이 어떤 추측을 하든 focus.zone 은 "동해광역" 그대로 혹은 다른 표준명 → expect 토큰 "동해광역" 영구 미등장 | focus.zone 에 "동해광역" 문자열은 *결코* 저장 불가 (사전 부재). synth 가 자발적으로 "광역" 쓸 가능성 0 → 영구 fail. focus.originalLocToken 으로 사용자 원어휘 보존 + synth 가 인용 후 환산 필요 | A = 사전 부재 / B = 원어휘 보존 부재. **두 진단 상보적** — alias 추가 시 표준 zone 으로 정착하나 expect "동해광역" 토큰은 여전히 미등장 → originalLocToken 미러링 필수 | **(b)** ZONE_NAME_TO_CODE 광역 alias 12건 추가 + REGION_DIR_RE 광역/전역/권역 토큰 + **focus.originalLocToken** 보존 + **synth 규칙** "사용자 비표준 광역어를 1회 인용 후 표준명 환산" → "동해광역(관측해역 동해중부앞바다 기준) 시정은…" 형태 → expect 토큰 PASS. |

**합성 한 줄**: 3건은 *세 개의 다른 단계* (게이트, synth 표기, 사전) 결함이며, 4 hunk 단일 PR 로 동시 해소 가능. A·B 진단은 충돌 없이 **상보적** (A 의 (b)+(c) + B 의 synth 규칙+originalLocToken = 4 hunk).

---

## 2. (b) ZONE_NAME_TO_CODE 광역 alias 카탈로그 — 12 키

각 alias 는 해당 해역의 **광역 대표 zone code** (= 중부 or 표준 앞바다 대표) 로 매핑. code → name 역인덱스(L162~170) 는 첫 매칭 보존이므로 alias 추가가 기존 정확 매핑(예: "동해중부앞바다" → 12C20100)을 흐트러뜨리지 않는다 (alias 는 *후순위*).

| # | alias 키 | code | 표준 zone (역해석) | 비고 |
|---|---------|------|-------------------|------|
| 1 | 동해광역 | 12C20100 | 동해중부앞바다 | 중부를 광역 대표로 |
| 2 | 동해전역 | 12C20100 | 동해중부앞바다 | 동의어 |
| 3 | 동해권역 | 12C20100 | 동해중부앞바다 | 동의어 |
| 4 | 동해전체 | 12C20100 | 동해중부앞바다 | 동의어 |
| 5 | 서해광역 | 12A20100 | 서해중부앞바다 | 중부를 광역 대표로 |
| 6 | 서해전역 | 12A20100 | 서해중부앞바다 | 동의어 |
| 7 | 서해권역 | 12A20100 | 서해중부앞바다 | 동의어 |
| 8 | 서해전체 | 12A20100 | 서해중부앞바다 | 동의어 |
| 9 | 남해광역 | 12B10100 | 남해서부앞바다 | 서부를 광역 대표로 (제주 별도) |
| 10 | 남해전역 | 12B10100 | 남해서부앞바다 | 동의어 |
| 11 | 남해권역 | 12B10100 | 남해서부앞바다 | 동의어 |
| 12 | 남해전체 | 12B10100 | 남해서부앞바다 | 동의어 |

**REGION_DIR_RE 동반 패치** (L600): `/제주|...|광역|전역|권역|전체/g` 4 토큰 추가 → Stage 3 nqTokens 길이 ≥ 2 임계 통과 ("동해광역" → ["동해","광역"]).

**부수효과 점검**:
- 단독 "동해중부" / "남해서부" 등 *방위 단독* alias 는 본 합성에서 **추가하지 않음** (REGION_DIR_RE Stage 2 토큰 매칭으로 이미 표준명에 합류 가능 — 워커 A §3.1 검증). NAV-2-01b 는 synth 규칙으로 해소.
- "제주광역" 류는 미수록 (현 sentinel 미요청, 회귀 위험 최소화).
- 광역 alias 채택 시 사용자 입력 "동해광역" → focus.zone 에 "동해중부앞바다" 박힘 → expect "동해광역" 토큰은 여전히 답에 미등장 → **반드시 originalLocToken + synth 인용 규칙과 병행**.

---

## 3. (c) deriveFocus 5단(buoyToZone) 이동 — runBrain zone-arg 폴백 후단으로

### 3.1 현 구조 (L1493~1496)

```js
// deriveFocus 6단 사다리 내부
if (!focus.zone && focus.buoy) {                                      // 5
    const z = buoyToZone(focus.buoy);
    if (z) focus.zone = z;
}
```

### 3.2 이동 후 구조 (의사코드)

**deriveFocus 5단 제거**:
```js
// (5단 buoyToZone 블록 삭제 — 4단 haeguToZone 와 6단 rankedItems 사이 비움)
// 단, focus.buoy 자체는 그대로 보존 (L1453~1460 유지)
```

**runBrain zone-arg 폴백에 4단 추가** (L1819~1828 부근):
```js
// 현재: (a) LLM canonZone → (b) focusZone → (c) detectZoneDeterministic(cq)
// 추가: (d) buoyToZone(focus.buoy)  — 단 (a)(b)(c) 모두 실패한 경우만
let z = step.args[zoneArg];
if (typeof z === 'string') z = canonZone(z);
if (!z && focusZone) z = focusZone;
if (!z) z = detectZoneDeterministic(cq);
if (!z && focus && focus.buoy) z = buoyToZone(focus.buoy);   // ★ NEW 4단
if (z) step.args[zoneArg] = z;
```

**C4 부이-폴백 게이트는 변경 없음** (L1864~1879):
- 조건 `!focusZone` 의 의미: "*결정론적/LLM 출처로 zone 이 안 잡힌 부이-중심 후속*" 만 부이 도구 강제.
- 이동 후엔 ANG-2-01b 의 `focus.zone` 이 null (5단 미발동) → 게이트 발동 → `get_buoy_observation(buoyName="거문도")` 강제 추가 → synth 답에 "거문도" 등장.

### 3.3 회귀 영향 평가

- **장점**: ANG-2-01b 직타. 동일 패턴(부이 앵커 후속) 의 다른 케이스도 buoy 도구가 자연스럽게 살아남.
- **위험 (등급 3)**: deriveFocus 의 5단을 제거하면 *다른 chain* 에서 `focus.zone` 이 비어 후속 zone-arg 가 (c)detectZone(cq) 로만 의존 → 광역어 후속 ("거기 풍속") 에서 cq fuzzy null 가능 → 도구가 zone 없이 호출되어 빈 결과.
- **완화**: runBrain zone-arg 4단(buoyToZone)이 *zone-arg 단계에서만* 채우므로 step.args 에는 표준 zone 박힘 (도구 실행은 정상). focus.zone 은 비워둠 → C4 게이트 발동 + chain zone-miss 거절 폴백(L1983~2003) 의 anchor 검사 정상 작동.
- **회귀 가드**: 별도 워커 적용 시 `phase2b_sentinel_v2.jsonl` 전체 (cat=1~5) + freevar 회귀 무손실 확인 필수.

---

## 4. synth 프롬프트 신규 규칙 — 한 줄 추가 (L2050 직후)

### 4.1 추가 위치
L2050 (`- 핵심만 간결하게...`) 와 L2051 (`- 여러 항목...`) 사이 1줄 삽입.

### 4.2 추가 텍스트

```
- **(후속 표기 규칙)** [최근 대화] 또는 [직전 확정 대상] 에 명시된 해역명·지명·부이명·사용자 원어휘(focus.originalLocToken) 가 있고 사용자가 후속(거기/그곳/그 해역/그 부이) 으로 그 대상을 가리키면, **답변에 그 이름을 원형 공백·조사 없이 1회 이상 명시**하세요(예: "동해중부앞바다" 를 "동해 중부 앞바다" 로 쪼개 쓰지 말 것). 사용자가 부이명("거문도") 으로 가리키면 답 첫 줄에 그 부이명을 그대로 호명. 사용자가 비표준 광역어("동해광역/관내/관할") 로 가리켰으면, 답에 그 어휘를 1회 인용한 뒤 표준 해역명으로 환산해 풀어쓰세요(예: "동해광역(관측해역 동해중부앞바다 기준) 시정은…").
```

### 4.3 효과 매트릭스

| 케이스 | 효과 |
|--------|------|
| ANG-2-01b | focus.buoy="거문도" 가 personal/focus 라벨로 synth 입력에 들어가므로 답 첫 줄 호명 → expect "거문도" PASS. (단 plan.steps 에 buoy 도구도 들어와 있으면 더 안정 → (c) 가 보강) |
| NAV-2-01b | focus.zone="동해중부앞바다" 가 공백 없이 박혀 부분문자열 "동해중부" PASS. |
| PO-2-01b | focus.originalLocToken="동해광역" 이 인용되어 답에 등장 → expect "동해광역" PASS. (b) alias 가 focus.zone="동해중부앞바다" 를 채워주므로 환산문도 자연스러움. |

### 4.4 회귀 가드

- 의사결정형 (가/부) 응답에 군더더기 위험 → "후속(거기/그곳/그 해역/그 부이) 으로 그 대상을 가리키면" 조건 한정으로 일반 질의엔 무영향.
- 톤 변화 위험 (등급 2): cat=1·3·5 회귀는 표면 없음 (후속 케이스 자체가 cat=2 특화).

---

## 5. focus.originalLocToken 신규 필드 — deriveFocus 보존 방법

### 5.1 의도

사용자가 입력한 *비표준 원어휘* ("동해광역", "관내", "남해 일대" 등) 를 focus 객체에 보존 → synth 가 인용 가능.

### 5.2 deriveFocus 추출 로직 (의사코드)

```js
function deriveFocus(plan, results, zoneName, query) {
    const focus = { zone: ..., haegu: ..., buoy: ..., coords: ..., rankedItems: ..., lastTools: ..., originalLocToken: null };

    // [신규] 사용자 원어휘 추출 — plan.zone 정정 전 원래 zone 토큰 보존
    //   우선순위: (1) plan.originalQueryToken — planQuery 가 보존했다면
    //          → (2) query 내 광역/지방 어휘 정규식 매칭
    //          → (3) memory 마지막 zone 키워드 추출 (chain followup 시)
    if (typeof query === 'string') {
        const m = query.match(/(동해광역|동해전역|동해권역|동해전체|서해광역|서해전역|서해권역|서해전체|남해광역|남해전역|남해권역|남해전체|동해중부|동해남부|동해북부|서해중부|서해남부|서해북부|남해서부|남해동부|관내|관할|일대)/);
        if (m) focus.originalLocToken = m[1];
    }
    // ... 기존 로직 ...
    return ...;
}
```

### 5.3 chain 전파

- runner (phase0_runner.py L303) 가 응답 focus 객체 전체를 chain_focus 에 저장 → 후속 body 로 동봉 → runBrain 의 focus 인자에 그대로 들어옴.
- planQuery focusLine (L1515~1523) 에 한 줄 추가: `focus.originalLocToken ? '원어휘=' + focus.originalLocToken : null`.
- synth 의 personal/focus 라벨 (buildPersonalContext) 에도 자동 합류.

### 5.4 PO-2-01b 회복 흐름

```
선행: "동해광역 시정"
  → deriveFocus.originalLocToken = "동해광역"
  → (b) alias 로 focus.zone = "동해중부앞바다"
  → 응답 focus = { zone:"동해중부앞바다", originalLocToken:"동해광역", ... }

후속: "거기 풍속?"
  → planQuery focusLine: "해역=동해중부앞바다 · 원어휘=동해광역"
  → synth 가 §4 규칙으로 "동해광역(관측해역 동해중부앞바다 기준) 풍속은…" 답
  → expect "동해광역" in ans → PASS
```

---

## 6. 회귀 가드

| 항목 | 적용 전 | 적용 후 (목표) | 검증 방법 |
|------|---------|----------------|----------|
| **sentinel 일반 pass** | 27/30 | **30/30** (3 zone-miss 회복) | `python phase0_runner.py --jsonl phase2b_sentinel_v2.jsonl` |
| ANG-2-01b zone-miss | fail | pass | answer 에 "거문도" 부분문자열 매칭 |
| NAV-2-01b zone-miss | fail | pass | answer 에 "동해중부" 부분문자열 매칭 |
| PO-2-01b zone-miss | fail | pass | answer 에 "동해광역" 부분문자열 매칭 |
| 다른 cat=2 후속 (회귀) | (현 pass 케이스) | 무회귀 | sentinel_v2 의 cat=2 잔여 N건 통과 유지 |
| **SEC (Security/COT)** | 5/5 | 5/5 보존 | sec_phaseX 전수 회귀 |
| freevar (자유변형) | (현 라인) | 무회귀 | freevar 회귀 묶음 |
| dep_weave / multitool | (현 라인) | 무회귀 | needsReplan 분기 영향 없음 (zone-arg 4단은 zone-arg 단계 한정) |
| C4 부이-폴백 게이트 | ANG 미발동 | ANG 발동 | runtime log: "C4 게이트 발동" 표시 |
| C5 좌표 폴백 (coords) | 정상 | 정상 (focus.coords 는 deriveFocus 가 buoyToCoords 로 별도 채움 — buoyToZone 이동과 무관) | sentinel coords 케이스 통과 유지 |

**필수 사전 점검**: 4 hunk 적용 전 `git stash` → 적용 후 sentinel 전수 → 회귀 시 hunk 단위 bisect.

---

## 7. 위험 평가

| 변경 | 위험 등급 | 근거 |
|------|----------|------|
| **(b) alias 12건 + REGION_DIR_RE 4 토큰** | **1** | 순증 사전. 기존 키와 충돌 없음. ZONE_NAMES = Object.keys(...) 자동 갱신. detectZone Stage 2 토큰 다양화로 *과매칭* 위험만 점검 (광역/전역/권역/전체 4 토큰이 다른 zone 명에 우연 포함되는지 — 현 ZONE_NAME_TO_CODE 표 전수 검증: 미포함 확인). |
| **(c) deriveFocus 5단 이동** | **3** | C4/C5 게이트 영향 + 다른 chain 의 focus.zone 누락 가능. zone-arg 4단(buoyToZone)으로 step.args 는 정상 채움. 회귀는 sentinel 전수로 검출 가능. **반드시 sentinel 무회귀 확인 후 머지**. |
| **synth 프롬프트 규칙 추가** | **2** | 자연어 톤 변화 가능. 의사결정형/일반 질의는 "후속 ~ 으로 가리키면" 조건 한정으로 무영향. cat=4(메타)·cat=5(거절) 회귀 표면 없음. |
| **focus.originalLocToken 추가** | **2** | focus 객체 *순증 필드*. 기존 4 필드 (zone/haegu/buoy/coords) 비교 로직(`!focus.zone` 등) 무영향. planQuery focusLine 1줄 추가 + synth personal 라벨 자동 합류. |

**종합 위험**: (c) 의 등급 3 이 최대 → 단일 PR 머지 전 sentinel + freevar + cat=2 잔여 전수 회귀 필수.

---

## 8. 코드 적용 의사코드 (라인 + 4 hunks patch-diff)

> **본 합성서는 적용을 수행하지 않음**. 아래는 별도 적용 워커 / 후속 PR 작성용 patch hint.

### Hunk 1 — `routes/assistant.js` L508~552 (ZONE_NAME_TO_CODE 광역 alias 12건)

```diff
@@ L551 (동해북부)
     '동해북부앞바다': '12C30100', '동해북부먼바다': '12C30200'
+    ,
+    // [P36 — 광역 alias 카탈로그] 사용자 광역 어휘 12 키 → 광역 대표 zone code
+    '동해광역': '12C20100', '동해전역': '12C20100',
+    '동해권역': '12C20100', '동해전체': '12C20100',
+    '서해광역': '12A20100', '서해전역': '12A20100',
+    '서해권역': '12A20100', '서해전체': '12A20100',
+    '남해광역': '12B10100', '남해전역': '12B10100',
+    '남해권역': '12B10100', '남해전체': '12B10100'
 };
```

**동반 패치** — L600 REGION_DIR_RE:
```diff
-    const REGION_DIR_RE = /제주|북부|남부|동부|서부|북쪽|남쪽|동쪽|서쪽|인천|경기|충남|전북|전남|경남|부산|거제|울산|경북|강원|서해|남해|동해|중부/g;
+    const REGION_DIR_RE = /제주|북부|남부|동부|서부|북쪽|남쪽|동쪽|서쪽|인천|경기|충남|전북|전남|경남|부산|거제|울산|경북|강원|서해|남해|동해|중부|광역|전역|권역|전체/g;
```

### Hunk 2 — `routes/assistant.js` L1493~1496 (deriveFocus 5단 제거)

```diff
-    if (!focus.zone && focus.buoy) {                                      // 5
-        const z = buoyToZone(focus.buoy);
-        if (z) focus.zone = z;
-    }
+    // [P36 — HUNK#2] 5단(buoyToZone) 을 runBrain zone-arg 폴백 후단(4단)으로 이동
+    //   목적: C4 부이-폴백 게이트(!focusZone) 보존 → ANG-2-01b 의 buoy 도구 강제 추가 회복.
+    //   step.args.zone 에는 zone-arg 4단에서 buoyToZone 으로 채워짐(도구 실행 정상).
+    //   focus.zone 은 비워둬 C4/chain-zone-miss 거절 폴백이 정상 작동.
```

### Hunk 3 — `routes/assistant.js` L1819~1828 (zone-arg 폴백에 4단 buoyToZone 추가)

```diff
     if (zoneArg) {
         let z = step.args[zoneArg];
         if (typeof z === 'string') z = canonZone(z);
         if (!z && focusZone) z = focusZone;
         if (!z) z = detectZoneDeterministic(cq);
+        // [P36 — HUNK#3] 4단: deriveFocus 5단 이동 보강 — 부이 좌표 기반 zone 추정
+        if (!z && focus && focus.buoy) z = buoyToZone(focus.buoy);
         if (z) step.args[zoneArg] = z;
     }
```

### Hunk 4 — `routes/assistant.js` L1446 (deriveFocus return + originalLocToken) + L1515~1523 (focusLine) + L2050 (synth 규칙)

**4a. deriveFocus return** (L1446~1501):
```diff
 function deriveFocus(plan, results, zoneName, query) {
-    const focus = { zone: zoneName || (plan && plan.zone) || null, haegu: null, buoy: null, coords: null, rankedItems: null, lastTools: (results || []).map(r => r.tool) };
+    const focus = { zone: zoneName || (plan && plan.zone) || null, haegu: null, buoy: null, coords: null, rankedItems: null, lastTools: (results || []).map(r => r.tool), originalLocToken: null };
+    // [P36 — HUNK#4a] 사용자 원어휘 보존: 광역/지방 비표준 어휘를 synth 인용용으로 보존
+    if (typeof query === 'string') {
+        const m = query.match(/(동해광역|동해전역|동해권역|동해전체|서해광역|서해전역|서해권역|서해전체|남해광역|남해전역|남해권역|남해전체|관내|관할|일대)/);
+        if (m) focus.originalLocToken = m[1];
+    }
     for (const r of (results || [])) { ... }
     ...
-    return (focus.zone || focus.haegu || focus.buoy || focus.coords || focus.rankedItems) ? focus : null;
+    return (focus.zone || focus.haegu || focus.buoy || focus.coords || focus.rankedItems || focus.originalLocToken) ? focus : null;
 }
```

**4b. planQuery focusLine** (L1515~1523):
```diff
     const focusLine = (focus && (focus.zone || focus.haegu || focus.buoy || focus.coords)) ?
 `\n[직전 확정 대상] ${[
     focus.zone ? '해역=' + focus.zone : null,
     focus.haegu ? '해구=' + focus.haegu + '번' : null,
     focus.buoy ? '부이/지점=' + focus.buoy : null,
     focus.coords ? ('좌표=' + focus.coords.lat + ',' + focus.coords.lon) : null,
-    (focus.rankedItems && focus.rankedItems.length) ? ('직전 랭킹 상위=' + focus.rankedItems.slice(0, 3).map(it => it['해구'] || it['지점'] || it.zone).filter(Boolean).join('/')) : null
+    (focus.rankedItems && focus.rankedItems.length) ? ('직전 랭킹 상위=' + focus.rankedItems.slice(0, 3).map(it => it['해구'] || it['지점'] || it.zone).filter(Boolean).join('/')) : null,
+    focus.originalLocToken ? '원어휘=' + focus.originalLocToken : null
 ].filter(Boolean).join(' · ')}
```

**4c. synth 프롬프트** (L2050 직후 1줄 삽입):
```diff
 - 핵심만 간결하게. 사용자가 묻지 않은 일반론·참고사항·주의문구를 덧붙이지 마세요.
+- **(후속 표기 규칙)** [최근 대화] 또는 [직전 확정 대상] 에 명시된 해역명·지명·부이명·사용자 원어휘(원어휘=...) 가 있고 사용자가 후속(거기/그곳/그 해역/그 부이) 으로 그 대상을 가리키면, **답변에 그 이름을 원형 공백·조사 없이 1회 이상 명시**하세요(예: "동해중부앞바다" 를 "동해 중부 앞바다" 로 쪼개 쓰지 말 것). 사용자가 부이명("거문도") 으로 가리키면 답 첫 줄에 그 부이명을 그대로 호명. 사용자가 비표준 광역어("동해광역/관내/관할") 로 가리켰으면, 답에 그 어휘를 1회 인용한 뒤 표준 해역명으로 환산해 풀어쓰세요(예: "동해광역(관측해역 동해중부앞바다 기준) 시정은…").
 - 여러 항목(예: 부이 여러 개)을 물으면 항목마다 이름과 관측 수치를 명확히, 관측 기준시각이 있으면 함께.
```

### 적용 라인 요약 (4 hunks)

| Hunk | 파일:라인 | 변경 |
|------|----------|------|
| 1 | `routes/assistant.js:551` + `:600` | ZONE_NAME_TO_CODE alias 12 + REGION_DIR_RE 4 토큰 |
| 2 | `routes/assistant.js:1493~1496` | deriveFocus 5단(buoyToZone) 블록 제거 |
| 3 | `routes/assistant.js:1819~1828` | zone-arg 폴백 4단(buoyToZone) 추가 |
| 4 | `routes/assistant.js:1446` + `:1515~1523` + `:2050` | originalLocToken 신규 필드 + focusLine + synth 규칙 |

---

## 9. 합성 결정 (한 줄)

(b) ZONE_NAME_TO_CODE 광역 alias 12건 + REGION_DIR_RE 광역/전역/권역/전체 토큰 + (c) deriveFocus 5단(buoyToZone) 을 runBrain zone-arg 폴백 4단으로 이동(C4 게이트 보존) + synth "후속 표기 규칙" 1줄 + focus.originalLocToken 신규 보존 — 4 hunk 단일 PR 로 ANG/NAV/PO 3건 동시 해소, 위험 등급 합 8 (1+3+2+2), sentinel 27→30/30 + SEC 5/5 보존 목표.
