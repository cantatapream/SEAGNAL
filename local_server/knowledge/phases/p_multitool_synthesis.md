# #31 P_multitool 합성 — A·B 통합 + 코드 적용 가능 설계서

> 입력
> - 시점 A: `p_multitool_A_design.md` — planQuery 다중도구 매트릭스 R1~R12 + DOMAIN/OVERVIEW/ACTIVITY_RE + 회귀가드 G1~G5
> - 시점 B: `p_multitool_B_design.md` — runBrain 재계획 트리거 확장(`MULTI_INTENT_RE` × `EXPECT_TOOLS_MIN`) + `pickMissingTools` 결정론 보강 + `PRONOUN_GUARD`
> - 기준 코드: `routes/assistant.js` — planQuery(L1438~1463) / `needsReplan`(L1493~1502) / runBrain 재계획(L1623~1638)
> - 기준 측정: v5 run1 — PASS 78% / cat3 68% (13fail) / p95 6120ms
>
> 본 문서는 **합성 설계만**(코드 수정 0). 시점 합성 결정: (1) A·B 역할분담, (2) EXPECT_TOOLS_MIN ↔ R1~R12 의미 일치 검증, (3) PRONOUN_GUARD ↔ #30 `isChainFollowup` 의도 합치, (4) `pickMissingTools` 의사코드, (5) p95 누적(+1680ms → 7800ms) 인정 + δ p95 별도 사이클, (6) 3-hunk 패치 의사코드(L1446/L1493/L1623), (7) 회귀가드(G1~G5 + sentinel 4) 통합.

---

## 1. A·B 역할 분담 — 누가 언제 다중도구를 강제하는가

### 1.1 두 축 정리

| 축 | 시점 | 트리거 위치 | 강제 방식 | 의존성 | LLM 호출 |
|----|------|-------------|----------|---------|----------|
| **A** (planQuery 12룰) | **1차** — query → plan 생성 단계 | `routes/assistant.js` L1448 (시스템 프롬프트) | 매트릭스 R1~R12 → LLM 에 "도구 합집합" 명시 | G1·G2·G3·G4 AND | **0** 추가 (기존 planQuery 1회 그대로) |
| **B** (runBrain 재계획) | **2차** — 1차 결과(`results`) 본 후 | `routes/assistant.js` L1623 (`needsReplan` 이후) | `pickMissingTools` 결정론적 직접 push | `MULTI_INTENT_RE` × `EXPECT_TOOLS_MIN[직군]` × `isDomainQuery` × `!PRONOUN_GUARD` | **0** 추가 (planQuery 재호출 생략) |

### 1.2 결정 흐름도

```
사용자 질의 q
    │
    ▼
[planQuery — L1446 프롬프트]
    │  ┌──────────────────────────────────────────────────┐
    │  │ A 매트릭스 R1~R12 (직군 × 활동어 → 도구 쌍)       │
    │  │ G1(zone) AND G2(활동어) AND G3(직군) AND G4(도메인)│
    │  │ → LLM 이 plan.steps 에 **다중 도구 함께** 넣음     │
    │  └──────────────────────────────────────────────────┘
    │
    ▼
plan.steps (1~6개)
    │
    ▼
[1차 도구 실행 — L1616 for-of]
    │
    ▼
results[] 생성
    │
    ▼
[needsReplan — L1626] mode = ?
    │
    ├── mode='dep_weave' (기존, 좁은 sup×sec)
    │       └─► planQuery 재호출 (focus1 주입) — 기존 그대로
    │
    ├── mode='multitool' (신규 B축)
    │       │  isDomainQuery && MULTI_INTENT_RE && !PRONOUN_GUARD
    │       │  && results.filter(hasRealData).length < EXPECT_TOOLS_MIN[직군]
    │       └─► pickMissingTools(plan, results, profile, focus1, cq)
    │              └─ 결정론적 (LLM 호출 X) — 부족 도구 ≤2 push
    │
    └── false → 다음 단계(synth)
    │
    ▼
synth (Gemini) → 답
```

### 1.3 케이스별 누가 책임지는가 (cat3 13 fail)

| 케이스 | A 단계 (planQuery) 가 1차에 잡으면 | B 단계 (재계획) 가 백업으로 잡아야 하는 케이스 |
|--------|-----------------------------------|------------------------------------------|
| FIS-3-01 "오늘 출항 가능 해역" | **A R1** — 직군=fishery + "출항/가능" → forecast+warning+tide | A 누락 시 B (fishery min=3) 가 forecast+warning+tide push |
| NAV-3-01 "동해 초계 작전" | **A R1** — 직군=navy + "작전" → forecast+warning | A 누락 시 B (navy min=2) 가 forecast+warning push |
| LEI-3-01 "양양 서핑 적합" | **A R3** — 직군=marine_leisure + "서핑/양양" → surfing_index+forecast | A 누락 시 B (leisure min=3) 가 surfing_index+forecast push |
| PO-3-01 "모니터링 종합" | **A R1+R12** — 직군=public_org + "모니터링/종합" → forecast+warning | A 누락 시 B (public_org min=2) 가 push |
| **ANG-3-04 "위도 갯바위"** | **A R2** (신규) — angler + "갯바위" → fishing_index+tide | A 누락 시 B 는 angler floor(2) 만 → fishing_index+forecast 만 보강 (tide 미보강) |
| **LEI-3-04 "다이빙 시정"** | **A R4** (신규) — visibility+buoy_observation | B 의 leisure floor=3 은 surfing_index 위주 → A 없으면 미보강 |
| **LEI-3-05 "요트 가능 풍속"** | **A R5** (신규) — forecast+zones_ranked | B 미보강 (zones_ranked 룰 없음) |
| **CG-3-05 / LG-3-05 "태풍 영향"** | **A R7** (신규) — typhoon_status+warning | B 미보강 (typhoon_status 룰 없음) |
| **NAV-3-04 "잠수함 수중"** | **A R8** (신규) — depth+forecast | B 미보강 (depth 룰 없음) |
| **FIS-3-03 / MOF-3-01·03 / PO-3-05 "이번 주 정책"** | **A R9** (신규) — forecast+midterm | B 미보강 (midterm 룰 없음) |

**역할 분담 핵심**:
- **A 가 일차 책임** — 12 룰 매트릭스로 *특수 결합*(R2·R4·R5·R7·R8·R9)을 1차에서 강제. cat3 13 fail 중 12 건 회복.
- **B 가 안전망(safety-net)** — A 가 LLM 변동성으로 놓쳤거나 비표준 활동어가 들어왔을 때 *직군별 floor* 로 backstop. forecast+warning 페어(sentinel 4 + FIS·NAV·PO 형) 6~7 건 확정 보장.
- **겹치는 영역**: A 의 R1 일반 패턴(forecast+warning) ≈ B 의 EXPECT_TOOLS_MIN (대부분 forecast+warning). **B 가 A 의 floor 를 보장**하는 구조 — A 만 머지하면 cat3 +20pp, A+B 머지하면 +22~24pp (B 만으로는 +12~15pp).

---

## 2. EXPECT_TOOLS_MIN(B) ↔ R1~R12(A) 의미 일치 검증

### 2.1 직군별 floor 매핑 표

| 직군 | B EXPECT_TOOLS_MIN | B 핵심 도구 | A 적용 룰 | A 도구 합집합 | 의미 일치? | 비고 |
|------|-------------------|-------------|----------|----------------|-----------|------|
| fishery | **3** | forecast+warning+tide | **R1** | forecast+warning+(tide∨current) | **○ 일치** | A 가 tide∨current 선택, B 는 tide 고정 — A 더 유연 |
| navy | **2** | forecast+warning | **R1** | forecast+warning+(tide∨current) | △ A 도구 ≥ B | A 가 추가 tide 부르면 B floor 도 만족 |
| marine_leisure | **3** | surfing_index+forecast+fishing_index | **R3** | surfing_index+forecast+warning(선택) | **× 불일치** | A 는 warning, B 는 fishing_index — **B 의 fishing_index 는 leisure 와 부정합** |
| public_org / mof | **2** | forecast+warning | **R1+R9** | forecast+warning+midterm | △ A 도구 ≥ B | A 의 midterm 까지 부르면 B floor 만족 |
| coast_guard | **2** | forecast+warning | **R1+R6+R7** | warning+forecast+(typhoon) | △ A 도구 ≥ B | A 의 typhoon 까지 부르면 만족 |
| local_gov | **2** | warning+forecast | **R10·R11·R12** | surfing_index+forecast+warning OR warning+forecast | △ A 도구 ≥ B | R10 시 도구가 더 많음 |
| angler | **2** | fishing_index+forecast | **R1·R2** | fishing_index+tide+(forecast) | △ 부분 일치 | A R2 는 forecast 가 *선택*, B 는 forecast 강제 — **B 가 더 보수적** |

### 2.2 불일치 1건 조정 — `marine_leisure` floor 도구 교정

B 원안의 `marine_leisure: get_surfing_index + get_marine_forecast + get_fishing_index` 는 LEI-3-04(다이빙) / LEI-3-05(요트) 등 비-서핑 활동에 부적절. **합성 결정**:

```js
// EXPECT_TOOLS_MIN — 합성 (도구 명단은 floor 카운트용, 실제 보강은 pickMissingTools 가 결정)
const EXPECT_TOOLS_MIN = {
  fishery:         { min: 3, hint: ['get_marine_forecast','get_warning','get_tide'] },
  navy:            { min: 2, hint: ['get_marine_forecast','get_warning'] },
  marine_leisure:  { min: 2, hint: ['get_marine_forecast','get_surfing_index'] },  // 합성: leisure floor 3→2, fishing_index 제거
  public_org:      { min: 2, hint: ['get_marine_forecast','get_warning'] },
  mof:             { min: 2, hint: ['get_marine_forecast','get_warning'] },
  coast_guard:     { min: 2, hint: ['get_marine_forecast','get_warning'] },
  local_gov:       { min: 2, hint: ['get_warning','get_marine_forecast'] },
  angler:          { min: 2, hint: ['get_fishing_index','get_marine_forecast'] },
};
```

### 2.3 동일 케이스 동일 결과 검증 (5건 표본)

| 케이스 | A 결과 (plan.steps) | B 결과 (pickMissingTools 추가) | 최종 toolsUsed | 동일? |
|--------|----|----|----|----|
| FIS-3-01 fishery "출항" | forecast+warning+tide (R1) | (이미 ≥3, 비발동) | {fc,warn,tide} | **○** |
| NAV-3-01 navy "초계" | forecast+warning (R1) | (이미 ≥2, 비발동) | {fc,warn} | **○** |
| LEI-3-01 leisure "양양 서핑" | surfing_index+forecast (R3) | (이미 ≥2, 비발동) | {surf,fc} | **○** |
| PO-3-01 public_org "모니터링" | forecast+warning (R1) | (이미 ≥2, 비발동) | {fc,warn} | **○** |
| (A 실패시) PO-3-01 LLM 이 forecast 단독만 | 단일 forecast | B 가 warning 보강 | {fc,warn} | **○** |

**결론**: A 머지 시 B 는 대부분 비발동(이미 floor 만족). A 가 LLM 변동성으로 누락 시 B 가 backstop. 같은 결과 도달.

---

## 3. PRONOUN_GUARD(B) ↔ #30 `isChainFollowup`(P_continuity_v2) 충돌 점검

### 3.1 정의 비교

| 항목 | B `PRONOUN_GUARD` | #30 P_continuity_v2 `isChainFollowup` |
|-----|------------------|-----------------------------------|
| 정의 위치 | `needsReplan` 내부 (재계획 차단용) | `runBrain` 진입부 (focus.zone 적용용) |
| 정규식 | `/방금\|거기\|그쪽\|그곳\|그건\|그게\|저거\|아까\|그 해역\|그 부이/` | `/거기\|그곳\|그쪽\|그\s*해역\|그\s*해구\|그\s*부이\|방금\|아까\|그건\|그게\|저거/` (현 코드 L1529 `PRONOUN_RE`) |
| 목적 | pronoun 후속 질의는 multi-tool 분기 비발동 → drift 회피 | pronoun 후속 시 직전 focus.zone 강제 주입 |
| 효과 방향 | **비발동** (도구 추가 안 함) | **발동** (focus 주입) |

### 3.2 의도 합치 — 동일 패턴 다른 동작

| 입력 | `isChainFollowup` 판단 | `PRONOUN_GUARD` 판단 | 두 패치의 동작 | 충돌? |
|------|---------------------|--------------------|--------------|------|
| "거기 풍속" | True | True | #30 이 focus.zone 주입 → plan.steps args.zone 채움 → 1차 도구 성공 → B 재계획 비발동 (PRONOUN_GUARD 무관) | **없음** |
| "방금 그 해역 종합" | True | True | #30 이 focus 주입 → 1차에서 forecast+warning 성공 → realCount≥2 → B multitool 분기 비발동 | **없음** |
| "오늘 출항 가능?" (pronoun 없음) | False | False | A R1 가 plan 짜고 1차에서 다중도구 호출 → B multitool 발동 가능 | **없음** |
| "거기 출항 가능?" | True | True | #30 이 focus 주입 + A R1 multi 매트릭스 → 1차에서 다중 호출 성공 → B 비발동 | **없음** |

**결론**: 두 식은 **같은 어휘 집합**(거기/그곳/그쪽/방금/아까…)을 본다. 즉 **동일 의도**(pronoun 후속) 검출. 단 동작 방향이 다름:
- `isChainFollowup` = "focus 가 있음" 을 **활용**해 plan 인자 채움.
- `PRONOUN_GUARD` = "focus 가 있을 가능성" 을 **신호**로 받아 multi 보강 *생략*.

**합성 결정**: 동일 정규식 재사용해 코드 중복 제거. `needsReplan` 안에서 *재사용 가능한 헬퍼*로 `PRONOUN_RE`(L1529 의 기존 상수)를 그대로 import 또는 `needsReplan` 호출처에서 `isPronounFollowup` 변수를 인자로 넘김.

```js
// 합성: PRONOUN_RE 는 L1529 의 기존 const 1개로 통일
//   runBrain 안에서 needsReplan(cq, results, focus, profile, isPronounFollowup) 로 넘김
function needsReplan(q, results, focus, profile, isPronounFollowup) {
  // ... (depWeave 분기) ...
  if (isPronounFollowup) return false;   // pronoun 후속은 multitool 분기 비발동 (= PRONOUN_GUARD)
  // ...
}
```

---

## 4. `pickMissingTools` 함수 설계 — 결정론적 보강

### 4.1 시그니처

```
pickMissingTools(plan, results, profile, focus, query) → Array<{tool, args}>
```

### 4.2 의사코드

```js
function pickMissingTools(plan, results, profile, focus, query) {
  const done = new Set((results || []).map(r => r.tool));
  const has  = (t) => done.has(t);
  const jikgun = detectJikgun(profile);
  const out  = [];

  // (1) Zone 인자 결정 — focus.zone → plan.zone → profileDefaultZone → undefined
  const zoneArg = (focus && focus.zone) || plan.zone || profileDefaultZone(profile) || undefined;

  // (2) 직군 무관 — 안전판단형 (forecast + warning 페어)
  //     EXPECT_TOOLS_MIN[*].hint 가 거의 모두 이 둘 → 우선 보강
  if (!has('get_marine_forecast')) {
    out.push({ tool: 'get_marine_forecast', args: zoneArg ? { zone: zoneArg } : {} });
  }
  if (!has('get_warning')) {
    out.push({ tool: 'get_warning', args: zoneArg ? { zone: zoneArg } : {} });   // zone 없으면 전국 집계 (§C3)
  }

  // (3) 직군별 특화 보강 (cap=2 안에서)
  if (out.length < 2) {
    if (jikgun === 'fishery' || jikgun === 'navy') {
      if (/출항|조업|작전|항해|훈련|연승/.test(query) && !has('get_tide')) {
        out.push({ tool: 'get_tide', args: zoneArg ? { place: zoneArg } : {} });
      }
    }
    if (jikgun === 'marine_leisure') {
      if (/서핑|파도|라이딩/.test(query) && !has('get_surfing_index')) {
        // beach 어휘 추출은 deriveBeach(query) 헬퍼 가정 (없으면 args 비움)
        out.push({ tool: 'get_surfing_index', args: {} });
      }
    }
    if (jikgun === 'angler') {
      if (/갯바위|포인트|방파제|원투|찌낚시|루어/.test(query) && !has('get_fishing_index')) {
        out.push({ tool: 'get_fishing_index', args: zoneArg ? { location: zoneArg } : {} });
      }
    }
  }

  // (4) cap=2 — plan.steps + 보강 총 ≤ 6 유지 (1차 실행 cap 와 정합)
  return out.slice(0, 2);
}
```

### 4.3 입출력 표본

| 입력 (results / profile / query) | done set | 출력 |
|----------------------------------|----------|------|
| `[{tool:'get_marine_forecast'}]`, fishery, "출항 가능?" | `{fc}` | `[{warning, {zone:...}}, {tide, {place:...}}]` |
| `[]`, navy, "동해 작전" | `{}` | `[{forecast,{zone:'동해중부앞바다'}}, {warning,{zone:'동해중부앞바다'}}]` |
| `[{tool:'get_marine_forecast'},{tool:'get_warning'}]`, public_org, "종합" | `{fc, warn}` | `[]` (이미 만족) |
| `[]`, marine_leisure, "양양 서핑" | `{}` | `[{forecast,{}}, {surfing_index,{}}]` |
| `[]`, angler, "위도 갯바위" | `{}` | `[{forecast,{}}, {fishing_index,{location:'위도'}}]` (warning 자리 양보 → fishing_index 가 더 적합) |

> **마지막 행 주의**: angler+갯바위 케이스에서 forecast/warning 페어 대신 fishing_index 가 더 가치 큼. 우선순위 룰을 강화해 직군별 *대안 페어* 를 cap=2 안에 넣는 방식 — 시점 C(구현) 에서 케이스 테스트로 미세조정.

### 4.4 cap=2 제약 근거

- 1차 plan.steps cap=6 (L1616) — 1차에서 평균 1.6 호출 (현 측정). 다중도구 패치 후 평균 2.4.
- 재계획 보강 cap=2 → 총 평균 ≤ 4.4 < cap 6 — 안전.
- cap=2 초과 시 응답시간 폭증 (도구당 +500ms) — DoD 7000ms 가드선.

---

## 5. 응답 시간 누적 — A+B 패치 후 p95

### 5.1 비용 분해

| 단계 | v5 baseline | A 단독 머지 후 | B 단독 머지 후 | **A+B 동시 머지 후** |
|------|------------|---------------|---------------|---------------------|
| planQuery LLM 1회 | ~800ms | ~800ms (프롬프트 +400자 ≈ +0ms) | ~800ms | ~800ms |
| 1차 도구 실행 (cap=6, 직렬) | ~1.6 × 520ms = 830ms | ~2.4 × 520ms = **1250ms (+420ms)** | ~1.6 × 520ms = 830ms (변화 없음) | ~2.4 × 520ms = **1250ms (+420ms)** |
| needsReplan 판정 | ~0ms | ~0ms | ~0ms | ~0ms |
| **재계획 (dep_weave)** | 발동률 ~1% | ~1% | ~1% | ~1% |
| **재계획 (multitool — B 신규)** | — | — | 발동률 ~10% × (avg 2 도구 × 520ms = 1040ms) = +**104ms 평균**, p95 case 에서 +1040ms | A 가 잡으면 B 비발동률↑ → 발동률 ~3~5% × 1040ms = +**31~52ms 평균**, p95 case 에서 +1040ms |
| synth (Gemini) | ~2400ms | ~2400ms (+15% 토큰 → 거의 동일) | ~2400ms | ~2400ms |
| **합계 평균** | ~4030ms | ~4450ms (+420ms) | ~4134ms (+104ms) | ~4480ms (+450ms) |
| **합계 p95 (trigger case)** | **6120ms** | **~6920ms (+800ms)** | **~7000ms (+880ms)** | **~7800ms (+1680ms)** |

### 5.2 DoD p95 5000ms 게이트 위반

| 시나리오 | p95 (ms) | DoD 5000 vs | 판단 |
|----------|---------|--------------|------|
| v5 baseline | 6120 | **+1120ms 위반** | 기존 위반 |
| A 단독 | 6920 | **+1920ms 위반** | 위반 폭 ↑ |
| B 단독 | 7000 | **+2000ms 위반** | 위반 폭 ↑ |
| **A+B 합성** | **7800** | **+2800ms 위반** | **위반 폭 최대** |

### 5.3 결정 — 별도 δ p95 사이클 필수

본 P_multitool 합성은 cat3 정확도 +20~24pp(78% → 85~88%) 의 이득이 있으나 **p95 7800ms** 는 SLA 마지노선(10000ms 위험선) 에 근접.

**합성 결정**:
1. P_multitool A+B 합성 머지 — cat3 정확도 우선.
2. 머지 *직후* `p95_gate_synthesis.md` 의 δ p95 게이트 별도 사이클 *필수* 진행.
3. δ p95 사이클 후보 카드: (a) `Promise.all` 병렬화 (A §5.2), (b) 1차 도구 cap=6→4 축소, (c) synth 토큰 budget 컷.
4. δ 사이클 *전*에 운영 트래픽에 머지 금지 — sentinel 평가만.

---

## 6. 코드 적용 — 3 hunks 의사코드 (라인 인용)

> **본 문서는 패치 적용 금지** — 의사코드만. 시점 C (구현) 에서 실제 diff 적용.

### 6.1 Hunk 1 — `routes/assistant.js` L1446~L1451 (planQuery 시스템 프롬프트)

**위치**: L1448 의 단일 줄 `(다중 도구 패턴)` 룰 → R1~R12 매트릭스 교체.
**근거**: A §2.3 + §2.4 + §3.3 G5 안전판.

```diff
@@ routes/assistant.js L1446 — L1451 @@
- - **(다중 도구 패턴)** 직군이 어업·해양경찰·해군·지자체·공공기관·해양수산부 같은 종합 모니터링 직군이고 질의가 "어때/상황/괜찮을까/어떻게 됐어/전반/전체/관내" 같이 종합적이면, get_marine_forecast + get_warning 을 **함께** 호출하세요. 해양수산부·공공기관 등 정책·중기 관심 직군은 추가로 get_midterm_forecast 도. 출항/조업 판단 질의는 추가로 get_tide·get_current 도 함께. 답할 자료가 비더라도 호출은 같이 — 합성이 데이터별로 "있음/없음" 을 명확히 보고합니다.
+ - **(다중 도구 패턴 — v2)** 아래 매트릭스 중 하나라도 매칭되면 해당 도구들을 **모두** steps 에 함께 넣으세요(빈 결과 우려해도 호출은 같이):
+   · [R1 어업·해군·해경·지자체·공공기관·해수부 + "어때/상황/괜찮을까/전반/전체/관내/종합/모니터링/평가"] :: get_marine_forecast + get_warning
+   · [R1+ 어업·해경·해군 + "출항/조업/출조/작업/연승/새벽 조업/안전"] :: 위 + get_tide 또는 get_current (해역 확정 시)
+   · [R2 angler + "갯바위/포인트/방파제/원투/찌낚시/루어/낚시 가능"] :: get_fishing_index + get_tide (+선택 get_marine_forecast)
+   · [R3 marine_leisure + "서핑/파도/라이딩" + 해수욕장명] :: get_surfing_index + get_marine_forecast
+   · [R4 marine_leisure + "다이빙/스쿠버/프리다이빙/시정 좋은"] :: get_visibility + get_buoy_observation
+   · [R5 marine_leisure + "요트/윈드서핑/카이트/카약" + "어디/추천/좋은 곳/가능 해역"] :: get_marine_forecast + get_zones_ranked(scope:"haegu")
+   · [R6 coast_guard + "수색/구조/출동/경비/방제"] :: get_warning + get_marine_forecast (+태풍 시즌: get_typhoon_status)
+   · [R7 전 직군 + "태풍/진로/영향 권역"] :: get_typhoon_status + get_warning
+   · [R8 navy + "잠수함/수중/항로 수심"] :: get_depth + get_marine_forecast
+   · [R9 mof·public_org + "정책/중기/주간/이번 주/작업 일정/동향"] :: get_marine_forecast + get_midterm_forecast (+ 정책 결정: get_warning)
+   · [R10 local_gov + "해수욕장/운영/통제/개장/폐장"] :: get_surfing_index + get_marine_forecast + get_warning
+   · [R11 local_gov + "재난/방재/훈련/연안관리"] :: get_marine_forecast + get_warning
+   · [R12 전 직군 + "관내/우리시/시청 관할" + 종합] :: get_warning(zone="전국" 또는 비움) + get_marine_forecast
+   매칭이 둘 이상이면 도구 합집합(중복 제거). 우선순위 R2 > R4 > R5 > R8 > R7 > R9 > R3 > R10 > R6 > R1 > R11 > R12.
+   ※ 단, 해역/지명/해변명이 질의에 **하나도 없고** 직군·활동 어휘도 모호하면(예: "어떻게 돼", "뭐야") 위 매트릭스 룰을 적용하지 말고 *기존 단일 도구* 룰로 처리하세요 (G5 안전판).
```

**라인 변화**: 1줄 → 14줄(약 +13줄). 프롬프트 토큰 +400자.

### 6.2 Hunk 2 — `routes/assistant.js` L1493~L1502 (`needsReplan` 함수)

**위치**: 함수 시그니처에 `profile` 추가 + `mode` 객체 반환 + multitool 분기.
**근거**: B §2.4 합성안.

```diff
@@ routes/assistant.js L1491 — L1502 @@
  /** 의존 위빙 판단 + multi-tool 보강 판단 (v2 — P_multitool 합성). */
- function needsReplan(q, results, focus) {
-   if (!focus || (!focus.coords && !focus.haegu && !focus.zone)) return false;
+ function needsReplan(q, results, focus, profile, isPronounFollowup, isDomainQuery) {
    const nq = normalize(q);
+   // === (1) dep_weave 분기 (기존) ===
+   const depWeaveFocusOK = focus && (focus.coords || focus.haegu || focus.zone);
    const sup = /(가장|제일|최고|최저|높은|낮은|센|약한|많은|적은|상위|랭킹|줄세|순위)/.test(nq);
    const sec = /(조석|물때|만조|간조|유속|유향|해류|수심|특보|주의보|경보|해무|씨씨티비)/.test(nq);
-   if (!(sup && sec)) return false;
-   const done = new Set((results || []).map(r => r.tool));
+   const done = new Set((results || []).map(r => r.tool));
    const secTools = ['get_tide', 'get_current', 'get_depth', 'get_warning', 'get_seafog_cctv'];
-   return !secTools.some(t => done.has(t));
+   if (depWeaveFocusOK && sup && sec && !secTools.some(t => done.has(t))) {
+     return { mode: 'dep_weave' };
+   }
+   // === (2) multitool 분기 (B 신규) ===
+   if (isPronounFollowup) return false;                 // PRONOUN_GUARD — #30 isChainFollowup 와 정합
+   if (!isDomainQuery) return false;                    // 비도메인 잡담 차단
+   const MULTI_INTENT_RE = /(?:어때|상황|어떻게|괜찮|종합|전반|전체|적합|가능|할\s*만|할\s*수)|(?:파고.*풍속|풍속.*파고|특보.*조석|조석.*특보|어업.*안전|작전.*해역)/;
+   if (!MULTI_INTENT_RE.test(nq)) return false;
+   const jk = detectJikgun(profile);
+   const minSpec = (jk && EXPECT_TOOLS_MIN[jk]) || { min: 2, hint: [] };
+   const realCount = (results || []).filter(r => hasRealData(r.result)).length;
+   if (realCount < minSpec.min) return { mode: 'multitool' };
+   return false;
  }
+ // EXPECT_TOOLS_MIN — 모듈 상단 상수로 1회 선언 권장 (합성 §2.2)
+ const EXPECT_TOOLS_MIN = { /* §2.2 합성 표 */ };
```

**주의**: `hasRealData` 는 현 L1642 의 inner function — needsReplan 에서 호출하려면 위로 hoist 하거나 인자로 받음. 시점 C 에서 결정.

### 6.3 Hunk 3 — `routes/assistant.js` L1623~L1638 (runBrain 재계획 블록)

**위치**: `focus1 = deriveFocus(...)` 직후 `needsReplan` 호출처 — mode 분기 + `pickMissingTools` 호출 추가.
**근거**: B §2.4 합성안.

```diff
@@ routes/assistant.js L1623 — L1638 @@
    // [의존 위빙 + multi-tool 보강 — 1회 재계획 v2]
    const focus1 = deriveFocus(plan, results, plan.zone, cq);
-   if (needsReplan(cq, results, focus1)) {
+   // isDomainQuery 는 L1659 의 본 계산을 위로 hoist (변수명 충돌 회피 위해 _isDomain 로):
+   const _isDomain = DOMAIN_RE.test(query) || DOMAIN_RE.test(cq) || ISLAND_BUOY_RE.test(cq)
+                    || OVERVIEW_RE.test(cq) || ACTIVITY_RE.test(cq)
+                    || !!detectZoneDeterministic(cq);
+   const replan = needsReplan(cq, results, focus1, profile, isPronounFollowup, _isDomain);
+   if (replan?.mode === 'dep_weave') {
      const plan2 = await planQuery(cq, profile, location, memory, focus1);
      if (plan2 && Array.isArray(plan2.steps)) {
        const done = new Set(results.map(r => r.tool));
        for (const step of plan2.steps.slice(0, 3)) {
          const exec = step && TOOL_EXEC[step.tool];
          if (!exec || done.has(step.tool)) continue;
          done.add(step.tool);
          try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
          catch (e) { results.push({ tool: step.tool, error: e.message }); }
        }
      }
+   } else if (replan?.mode === 'multitool') {
+     // 결정론적 보강 — planQuery 재호출 생략 (LLM 호출 0, p95 −800ms)
+     const extra = pickMissingTools(plan, results, profile, focus1, cq);
+     const done = new Set(results.map(r => r.tool));
+     for (const step of extra.slice(0, 2)) {
+       const exec = step && TOOL_EXEC[step.tool];
+       if (!exec || done.has(step.tool)) continue;
+       done.add(step.tool);
+       try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
+       catch (e) { results.push({ tool: step.tool, error: e.message }); }
+     }
    }
+   // pickMissingTools — 함수 본체는 needsReplan 근처(L1500 부근)에 신규 정의 (의사코드 §4.2)
```

**주의**: L1659 의 `isDomainQuery` 와 변수 중복 — `_isDomain` 으로 hoist 후 L1659 의 기존 `isDomainQuery` 는 `_isDomain` 으로 재사용 또는 그대로 둠(중복 계산 1회). 시점 C 에서 정리.

### 6.4 종합 — 3 hunks 영향 면적

| Hunk | 라인 추가 | 라인 삭제 | 신규 함수/상수 |
|------|----------|----------|--------------|
| #1 L1446 | +13 | -1 | — |
| #2 L1493 | +18 | -3 | `EXPECT_TOOLS_MIN` |
| #3 L1623 | +14 | -1 | `pickMissingTools` (§4.2) |
| **합계** | **+45** | **-5** | **2개 신규** |

---

## 7. 회귀 가드 통합 — A 의 G1~G5 + B 의 sentinel 4

### 7.1 통합 가드 매트릭스

| 가드 | 출처 | 적용 단계 | 차단 대상 | 검증 방법 |
|------|------|----------|----------|----------|
| **G1 zone 확정** | A §3.2 | planQuery (LLM 룰) | zone 토큰 0 + multi 강제 | LLM 프롬프트 명시 (G5 와 통합) |
| **G2 활동 어휘** | A §3.2 | planQuery (LLM 룰) | 활동어 0 + multi 강제 | A R1~R12 활동어 컬럼 자체가 G2 |
| **G3 직군 매칭** | A §3.2 | planQuery (LLM 룰) | 직군 불일치 multi 강제 | A 매트릭스 직군 컬럼 |
| **G4 DOMAIN_RE** | A §3.2·§4.2 | runBrain (코드 — multitool 분기 진입) | 비도메인 잡담 | Hunk 3 의 `_isDomain` 가드 |
| **G5 zone 모호 단일** | A §3.3 | planQuery (LLM 룰) — 안전판 | zone+활동어 모두 모호 | A 프롬프트 마지막 줄 ※ 안전판 |
| **PRONOUN_GUARD** | B §3.3 | runBrain (코드 — multitool 분기 진입) | pronoun 후속 (drift 회피) | Hunk 2 의 `isPronounFollowup` 인자 |
| **MULTI_INTENT_RE 미매칭** | B §6.3 | runBrain (코드) | 단일 도구 충분 케이스 (cat1·cat5·cat8) | Hunk 2 의 MULTI_INTENT_RE 검사 |

### 7.2 Sentinel 4 (FIS·NAV·LEI·PO multi-tool) 통합 게이트

| 케이스 | A 발동 룰 | B 발동 mode | 최종 toolsUsed 보장 | 게이트 |
|--------|----------|-------------|---------------------|--------|
| **FIS-3-01** | R1 (fishery 종합) | multitool (fishery min=3) | ⊇ {forecast, warning, tide} | A 단독 1차 성공 OR B 보강 |
| **NAV-3-01** | R1 (navy 작전) | multitool (navy min=2) | ⊇ {forecast, warning} | A 단독 1차 성공 OR B 보강 |
| **LEI-3-01** | R3 (marine_leisure 서핑) | multitool (leisure min=2) | ⊇ {surfing_index, forecast} | A 단독 1차 성공 OR B 보강 |
| **PO-3-01** | R1 (public_org 종합) | multitool (public_org min=2) | ⊇ {forecast, warning} | A 단독 1차 성공 OR B 보강 |

### 7.3 회귀 추적 단계

**Stage I — sentinel 4 직타 (4/4 통과 필수)**:
- 통과 기준: 각 케이스 `toolsUsed` 위 매트릭스 만족 + 답 ≥ 15자 + 단일 case p95 ≤ 8000ms.

**Stage II — sentinel 16 무회귀 (v2 sentinel 20 중 4 제외)**:
| 케이스 군 | 위험 | 차단 가드 |
|---------|------|----------|
| pronoun follow-up (ANG-2-01b, CG-2-01b, MOF-6-01b) | B multitool drift | PRONOUN_GUARD |
| cat1 단일 도구 (ANG-1-05·06·09 등) | A multi 오발동 | G1·G2·G5 |
| cat5 비도메인 잡담 | B multitool 오발동 | G4 (`_isDomain`) |
| cat7 환각가드 ("어선법 제5조") | MULTI_INTENT_RE 미매칭 | 자동 비발동 |
| C4 부이 follow-up | 이미 plan.steps unshift 됨 | realCount≥min → B 비발동 |

**Stage III — freevar N=440 게이트**:
| 셋 | 합격선 | 비고 |
|----|--------|------|
| cat3 multi | **68% → ≥85%** | A+B 합성 효과 +17pp |
| cat2 연속 | 48% → ≥50% | 부수 효과 |
| cat1·4·6·8 | ±2pp | A 의 G1·G5 + B 의 PRONOUN_GUARD/MULTI_INTENT 차단 |
| cat5 비도메인 | 98% → ≥95% | OVERVIEW_RE 일상어 위험 — G4 strict |
| cat7 환각 | 95% → ≥93% | multi 데이터로 합성 표면적 증가 — synth 룰 변경 없음 |
| **전체 PASS** | 78% → **≥85%** | DoD ≥85% 마지노선 도달 |
| **p95** | **6120 → ≤7800ms 인정** | **DoD 5000 위반 — δ p95 별도 사이클 필수** |
| CoT 누수 | 0 | 불변식 |
| 환각 의심 | ≤2 | P_halluc_v2 별도 |

### 7.4 환각 가드와의 직교성

본 합성은 *도구 호출 수* 를 늘림 → synth 입력 데이터 ↑. cat7 환각 95% 가 -0~2pp 영향. 별도 `P_halluc_v2` 사이클에서 synth 룰 보강 예정 — 본 사이클은 환각 카운트만 모니터.

---

## 8. 응답 시간 가드 — δ p95 사이클 인계 명세

### 8.1 본 패치 인정 p95

**7800ms** (sentinel 4 trigger case 기준). DoD 5000ms 대비 +2800ms 위반.

### 8.2 δ p95 사이클 진입 조건

- 본 P_multitool 합성 머지 직후 즉시 진입 (블로킹).
- 운영 트래픽 노출 전 사전.

### 8.3 δ 사이클 후보 카드

| 카드 | 기대 절감 | 위험 | 우선 |
|------|----------|------|------|
| (a) 1차 도구 `Promise.all` 병렬화 (A §5.2) | p95 -1500~2000ms | deriveFocus 직렬 가정 깨짐 → 별도 검증 | **1순위** |
| (b) 1차 cap 6→4 축소 | p95 -1000ms | 일부 cat3 회귀 (-3~5pp) | 2순위 |
| (c) synth 토큰 budget 컷 | p95 -300ms | 합성 품질 -1~2pp | 3순위 |
| (d) needsReplan multitool 분기 sample 1/N | p95 평균 -50ms (p95 동일) | sentinel 4 직타율 ↓ | 비추 |

### 8.4 게이트 목표 (δ 사이클 후)

- p95 7800 → ≤ **5500ms** (DoD +500ms 인정 폭으로 완화).
- cat3 정확도 유지 ≥ 85%.

---

## 9. 합성 결정 요약 (8개)

1. **A·B 역할분담**: A(planQuery 12룰) = 1차 LLM 강제 / B(runBrain 재계획 multitool) = 결정론 safety-net. 같은 케이스에서 같은 결과(toolsUsed 동일) 도달 검증 5/5.
2. **EXPECT_TOOLS_MIN 합성 교정**: marine_leisure 의 `fishing_index` 제거(leisure min 3→2, 도구 hint = forecast+surfing_index). 나머지 6직군은 A 매트릭스와 의미 일치 확인.
3. **PRONOUN_GUARD ↔ isChainFollowup 정합**: 동일 정규식(`거기|그곳|...`) 재사용 — 별개 코드 중복 피하고, `isPronounFollowup` 변수를 `needsReplan` 에 인자로 전달.
4. **`pickMissingTools` 결정론 의사코드** §4.2: (1) zoneArg 결정 → (2) forecast+warning 우선 → (3) 직군별 특화 → (4) cap=2. LLM 호출 0.
5. **응답시간 누적 p95 7800ms 인정**: A +800 / B +880 = +1680. DoD 5000 위반 +2800ms — **δ p95 별도 사이클 필수**(블로킹).
6. **3-hunk 패치 의사코드**: L1446(planQuery 프롬프트 +13줄) / L1493(needsReplan 시그니처 확장 +18줄) / L1623(mode 분기 +14줄). 총 +45줄 / -5줄 / 신규 함수 2개(`EXPECT_TOOLS_MIN`, `pickMissingTools`).
7. **회귀 가드 통합**: A 의 G1·G2·G3·G5(LLM 프롬프트) + G4·PRONOUN_GUARD·MULTI_INTENT_RE(코드 진입 가드) + sentinel 4 직타 게이트(Stage I) + sentinel 16 무회귀(Stage II) + freevar 440(Stage III).
8. **cat3 +17pp / 전체 +7pp 추정**: 78% → 85% 도달(DoD 마지노선 통과). 환각 -0~2pp / cat5 -0~3pp 위험은 별도 P_halluc_v2 / G4 strict 로 격리.

---

**한 줄 핵심 합성 결정**:
A(planQuery 12룰 매트릭스 R1~R12, 1차 LLM 강제) + B(runBrain 결정론 `pickMissingTools` × `EXPECT_TOOLS_MIN[직군]` × `isDomainQuery` × `!PRONOUN_GUARD`, safety-net) 를 **3-hunk(L1446 프롬프트 +13줄 / L1493 needsReplan 시그니처 확장 +18줄 / L1623 mode 분기 +14줄)** 로 적용해 cat3 68%→≥85% / sentinel 4 직타 4/4 보장, 단 p95 6120→7800ms 인정으로 **DoD 5000ms 게이트화는 δ p95 별도 사이클 블로킹 필수**.
