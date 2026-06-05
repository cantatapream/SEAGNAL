# #31 P_multitool 설계 시점 B — runBrain 재계획 트리거 강화 (코드 수정 0)

> 입력
> - v5 1회차 리포트 `v5_run1_report.md` (cat3 다중 68% / 실패 13건, cat2 연속 48% / 실패 42건)
> - v5 1회차 freevar 로그(failures 캡처): `v5_run1_freevar.log.gz` (cat3 가시 fail = ANG-3-04 — `miss all=['get_fishing_index','get_tide']`)
> - `routes/assistant.js` `runBrain` 함수 (L1504~1714) 의 1차 도구 실행 → 1회 재계획 흐름 (L1615~1638)
> - 마스터플랜 §7 `2026-05-29 P4 의존 위빙(1회 재계획)` 항목 — 좁은 트리거(`supRE && secRE`) + 도구 중복 방지
> - 합성본 `alpha_synthesis_R2.md` (C4 `_buoyPlanTools` / C5 `_lgPlanTools` 강제 호출 블록 — L1502 직후 plan.steps 보강 블록)
>
> 본 문서는 **설계만**(코드 수정 금지). 신규 결정: (1) 현 1회 재계획 라인 범위·트리거 식별, (2) 재계획 트리거 확장 후보 3종(A/B/C) + 합성, (3) #30 P_continuity_v2 와 상호작용 점검, (4) v5 cat3 13건 중 재계획 회복 가능 추정, (5) p95 트레이드오프(+1500ms / 6120→~7000ms), (6) sentinel multi-tool 4건(FIS-3-01·NAV-3-01·LEI-3-01·PO-3-01) 회귀 가드.

---

## 1. 현 1회 재계획 로직 식별 — 트리거·라인 범위·도구 화이트리스트

### 1.1 라인 범위 (assistant.js)

| 영역 | 라인 | 코드 요약 |
|------|-----|----------|
| `needsReplan` 함수 정의 | L1493 ~ L1502 | 좁은 supRE + secRE 매칭만 트리거 |
| `deriveFocus` 함수 정의 | L1322 ~ L1359 | rankedItems / coords / haegu / buoy 추출 |
| 1차 plan.steps 실행 (cap=6) | L1615 ~ L1621 | `plan.steps.slice(0,6)` 순회 |
| **1회 재계획 트리거 블록** | **L1623 ~ L1638** | `focus1 = deriveFocus(...)` → `needsReplan(cq, results, focus1)` 시 `planQuery` 재호출 + plan2.steps.slice(0,3) 추가 실행 (중복 도구 차단) |

### 1.2 현 트리거 조건 (`needsReplan` L1493~L1502)

```
function needsReplan(q, results, focus) {
  if (!focus || (!focus.coords && !focus.haegu && !focus.zone)) return false;
  const nq = normalize(q);
  const sup = /(가장|제일|최고|최저|높은|낮은|센|약한|많은|적은|상위|랭킹|줄세|순위)/.test(nq);
  const sec = /(조석|물때|만조|간조|유속|유향|해류|수심|특보|주의보|경보|해무|씨씨티비)/.test(nq);
  if (!(sup && sec)) return false;
  const done = new Set((results||[]).map(r => r.tool));
  const secTools = ['get_tide','get_current','get_depth','get_warning','get_seafog_cctv'];
  return !secTools.some(t => done.has(t));
}
```

### 1.3 현 트리거의 한계 — v5 cat3 13건이 거의 못 잡힘

- **supRE (랭킹어)** 가 *필수* 조건이라 "오늘 출항 가능 해역" / "동해 초계 작전 가능 해역" / "양양 오늘 서핑 적합?" / "오늘 모니터링 해역 종합" 같은 **multi-tool 종합 질의는 1건도 supRE 매칭 안 됨**.
- secRE 의 대상 도구도 5개(`get_tide·get_current·get_depth·get_warning·get_seafog_cctv`) 로 좁음 — `get_marine_forecast` / `get_buoy_observation` / `get_fishing_index` / `get_surfing_index` / `get_midterm_forecast` 가 누락되어 cat3 직군 종합 패턴에 전혀 발동 안 됨.
- 결과: v5 cat3 13 fail 중 현 1회 재계획이 회복한 건수 ≈ **0건**. cat3 68% 의 정체는 본질적으로 *planQuery 1차 호출에서 LLM 이 multi-tool 못 짠 경우* → 1차 도구 결과 부족 → 합성이 web_search 폴백 / "그 정보는 없어요" 로 종결.

### 1.4 알파 PR 의 plan.steps 보강 블록과의 관계

- 알파 §1.1 C4 부이 폴백 (L1502 직후 `_buoyPlanTools`) / 알파 C5 LG 강제 (L1502 직후 `_lgPlanTools`) 는 **plan.steps 그 자체를 수정**(unshift/push) 하는 *플랜 보강* 이지, *재계획 트리거* 가 아님.
- 따라서 P_multitool 의 본 설계는 **(a) 플랜 보강(알파 패턴)을 확장** 하거나 **(b) 1회 재계획 트리거를 확장** 두 길이 있음. 본 문서는 후자(B) 를 다룸 (입력 지시).

---

## 2. 재계획 트리거 확장 후보 — A·B·C 3종 + 합성안

### 2.1 후보 A — 1차 결과 `results.length < expect_threshold(≥2)` 시 부족 도구 자동 추가

**조건**: `results.filter(hasRealData).length < 2` && multi-tool 의도 신호 (직군 종합어 OR 다중주제어).

**다중 주제어 정규식 (신규)**:
```
const MULTI_INTENT_RE = /(?:어때|상황|어떻게|괜찮|종합|전반|전체|적합|가능|할\s*만|할\s*수)|(?:파고.*풍속|풍속.*파고|특보.*조석|조석.*특보|어업.*안전|작전.*해역)/;
```

**보강 도구 자동 선정 로직(의사코드)**:
```
function pickMissingTools(plan, results, profile, focus) {
  const done = new Set(results.map(r => r.tool));
  const has = (t) => done.has(t);
  const jikgun = detectJikgun(profile);
  const out = [];
  const wantWeather = !has('get_marine_forecast');
  const wantWarn    = !has('get_warning');
  // 안전 판단형(가능/적합/괜찮): 예보 + 특보 페어
  if (wantWeather) out.push({tool:'get_marine_forecast', args:{zone: focus?.zone || plan.zone}});
  if (wantWarn)    out.push({tool:'get_warning',         args:{zone: focus?.zone || plan.zone}});
  // 출항·조업·작전: 조석/유속 추가
  if (/출항|조업|작전|항해|훈련/.test(query) && !has('get_tide'))    out.push({tool:'get_tide',    args:{place: focus?.zone}});
  if (/출항|조업|작전/.test(query)            && !has('get_current')) out.push({tool:'get_current', args:{zone:  focus?.zone}});
  return out.slice(0, 2);   // 재계획 cap=2 (총 plan.steps + 보강 ≤ 6 유지)
}
```

**기대 회복**: ANG-3-04 형 (`miss all=['get_fishing_index','get_tide']`) + FIS-3-01 / NAV-3-01 / PO-3-01 형 (`miss all=['get_marine_forecast','get_warning']`).

### 2.2 후보 B — 직군별 `expected_tools_min` 미달 시 보강

**직군별 최소 도구 수 테이블 (신규 상수)**:

| 직군 | min | 핵심 도구 | 근거 |
|-----|-----|---------|-----|
| fishery | 3 | get_marine_forecast + get_warning + get_tide | 출항·조업 판단 = 예보 + 특보 + 조석 |
| navy | 2 | get_marine_forecast + get_warning | 작전·초계 = 예보 + 특보 |
| marine_leisure | 3 | get_surfing_index + get_marine_forecast + get_fishing_index | 서핑/물놀이 + 예보 + 보조지수 |
| public_org / mof | 2 | get_marine_forecast + get_warning | 모니터링·정책 = 종합 |
| coast_guard | 2 | get_marine_forecast + get_warning | SAR·구조 = 종합 |
| local_gov | 2 | get_warning + get_marine_forecast | 관할 종합 |
| angler | 2 | get_fishing_index + get_marine_forecast | 낚시 핵심 |

**트리거**:
```
if (jikgun && MULTI_INTENT_RE.test(cq) && results.filter(hasRealData).length < EXPECT_TOOLS_MIN[jikgun]) {
  // 부족분만 보강
}
```

**효과**: sentinel multi-tool 4 (FIS·NAV·LEI·PO) 가 직군 floor 로 직타 — `expect_tools_all` 미달 시 강제 보강 → A 축 통과.

**위험**: marine_leisure floor 3 은 `get_fishing_index` 까지 호출하므로 답이 길어질 수 있음 — 합성 prompt "간결히" 규칙으로 완화.

### 2.3 후보 C — 환각 의심(HALLUC_RE 매치) 응답 재평가 후 도구 추가

**구조**: 1차 results 로 합성된 답을 채점 → HALLUC_RE 매치면 결과 부족 가정 → 재계획.

**문제**: 본 설계는 **runBrain 안에서** 트리거되어야 하는데, HALLUC_RE 는 *답* 에 적용. 답을 만들려면 synth(Gemini) 1회 호출이 이미 발생 → 재계획 → synth 2회. **응답 시간 +3000~4000ms** 폭증. 채택 비추.

**대안 C'**: HALLUC_RE 가 아니라 **1차 results 의 *비도메인 패턴*** (예: `tools=['web_search']` 단독) 만 보고 재계획. 이는 후보 A 의 `results.length < 2` 와 동일 효과.

**결정**: 후보 C 는 본 라운드에서 **배제** (시간 비용 > 기대 효과). 환각 가드는 별도 P_halluc_v2 사이클로.

### 2.4 합성안 — `needsReplan` 확장 + `pickMissingTools` 신규

**`needsReplan` 시그니처 확장**:
```
function needsReplan(q, results, focus, profile) {
  // 기존: 의존 위빙 트리거 (좁은 sup×sec)
  const depWeave = (/* 기존 sup&sec 로직 */);
  if (depWeave) return { mode: 'dep_weave' };

  // 신규 (A+B): multi-tool 부족
  const realCount = results.filter(r => hasRealData(r.result)).length;
  const multi = MULTI_INTENT_RE.test(normalize(q));
  const jk = detectJikgun(profile);
  const minTools = (jk && EXPECT_TOOLS_MIN[jk]) || 2;
  if (multi && realCount < minTools) return { mode: 'multitool' };

  return false;
}
```

**runBrain 본문 (L1623~L1638) 분기**:
```
const replan = needsReplan(cq, results, focus1, profile);
if (replan?.mode === 'dep_weave') {
  // 기존 planQuery 재호출 (focus1 주입)
} else if (replan?.mode === 'multitool') {
  // pickMissingTools 로 결정론적 도구 보강 (planQuery 재호출 없이 직접 추가)
  const extra = pickMissingTools(plan, results, profile, focus1, cq);
  for (const step of extra.slice(0, 2)) {
    const exec = TOOL_EXEC[step.tool];
    if (!exec) continue;
    try { results.push({tool:step.tool, args:step.args, result: await exec(step.args)}); }
    catch (e) { results.push({tool:step.tool, error: e.message}); }
  }
}
```

**핵심 결정**:
- **dep_weave 분기**: 기존처럼 `planQuery` 재호출 (LLM 의존). 좁은 트리거라 영향 적음.
- **multitool 분기**: `planQuery` 호출 *생략* — 결정론적 `pickMissingTools` 만으로 도구 보강. **LLM 1회 호출 절감** → 응답 시간 +1500ms 가 아니라 **+(1500ms × 추가도구수 = 도구 평균 latency × N) ≈ +700~1500ms** 로 완화.

---

## 3. #30 P_continuity_v2 와 충돌·상호작용 점검

### 3.1 P_continuity_v2 가 공급할 focus

마스터플랜 §7 #30 의 핵심: pronoun 검출 후 직전 zone 즉시 적용 / focus.zone 우선 / prev_id chain. 즉 **focus.zone 채움 률 ↑**.

### 3.2 재계획 트리거에 미치는 영향

- 현 `needsReplan` 의 1차 가드 `if (!focus || (!focus.coords && !focus.haegu && !focus.zone)) return false;` 는 *focus 가 있어야* 트리거. P_continuity_v2 가 focus.zone 채움률을 올리면 → **dep_weave 분기 더 자주 발동** (양호).
- 본 설계의 신규 multitool 분기는 `focus1` 을 *참조* 만 함 (zone 인자 전달). focus 없어도 발동 — P_continuity_v2 와 충돌 없음.
- `pickMissingTools` 의 zone 인자: `focus?.zone || plan.zone` 순서. P_continuity_v2 의 focus.zone 우선 룰과 자연 정합.

### 3.3 동시 머지 시 위험 — connectivity drift

- P_continuity_v2 가 후속 턴 focus.zone 을 *강하게* 적용하면, multitool 분기의 `pickMissingTools` 가 *직전 턴 zone* 으로 도구를 부르게 됨. 직전 zone 이 현 질의와 무관(예: "방금" 없는 새 multi-tool 종합 질의) 이면 부적절 도구 호출.
- 가드: `MULTI_INTENT_RE` 에 *pronoun 어휘 배제* 처리 — `방금|거기|그쪽|그곳` 가 cq 에 있으면 `replan.mode='multitool'` 비발동.

```
const MULTI_INTENT_RE = /(?:어때|상황|어떻게|괜찮|종합|전반|전체|적합|가능)/;
const PRONOUN_GUARD = /방금|거기|그쪽|그곳|그건|그게|저거|아까|그 해역|그 부이/;
if (PRONOUN_GUARD.test(cq)) return false;   // pronoun follow-up 은 P_continuity_v2 단독으로
```

### 3.4 결론

- **동시 머지 가능**. 격리 규칙 §6.4 `P_continuity_v2 + P_multitool 동시 가능` 위반 0.
- 가드 1건 추가 (`PRONOUN_GUARD`) 로 drift 회피.

---

## 4. 재계획 회복 가능 추정 — v5 cat3 13건 중

### 4.1 v5 cat3 fail 13건 구성 (추정 분해, freevar 로그 가시 1건 + sentinel-유사 12건)

| 분류 | 추정 건수 | 패턴 | 본 설계 회복 가능 |
|-----|---------|------|----------------|
| 종합형 (`get_marine_forecast`+`get_warning` 페어 누락) | ~6건 | "출항 가능 해역" / "초계 작전" / "관내 종합" / "모니터링" — 1차에서 forecast 단독 호출 | **YES** (B 분기 직타) |
| 안전판단형 (forecast + tide + current) | ~3건 | "출항 가능?" / "조업해도 돼?" | **YES** (A+B 직타) |
| 직군특화형 (surfing_index 누락) | ~2건 | "양양 서핑 적합?" 류 marine_leisure | **YES** (B floor=3) |
| 비도메인 web 폴백형 | ~1건 | ANG-3-04 "위도 갯바위" — tools=['web_search'] | **부분** (A 가 `get_fishing_index`/`get_tide` 추가) |
| 환각형 (HALLUC_RE) | ~1건 | 거짓 수치 단정 | **NO** (후보 C 배제) |

### 4.2 회복 가능 총합 추정

- **회복 가능 ≈ 11/13 (84%)** — multi-tool 분기 + pickMissingTools 로 cat3 PASS율 **68% → 80~83%** 추정 (+12~15pp).
- 실측은 v5 run2 측정 필요. 시뮬레이션 가정: planQuery 가 1차에서 누락한 도구를 결정론적 보강이 항상 채움 (도구 자체가 빈 결과 줄 경우는 합성 단계 책임).

### 4.3 cat2 부수 효과

마스터플랜 §7 #31 ROI 산식 `cat2 × 0.05 × 42 = 2.1` — 후속 multi-tool 종합 질의 일부 회복.
추정: cat2 PASS 48% → 50~52% (+2~4pp).

---

## 5. 응답 시간 트레이드오프 — p95 영향

### 5.1 현 측정 (v5 run1)

- p50 = 1140ms · p95 = **6120ms** · DoD 5000ms 초과 (마스터플랜 §7 등재).

### 5.2 재계획 1회 추가 시 비용 분해

| 비용 항목 | 후보 A (planQuery 재호출) | 본 합성안 (multitool 분기, planQuery 생략) |
|--------|------------------------|---------------------------------------|
| planQuery LLM 호출 | +800~1200ms (Gemini Flash) | **0ms** (결정론적 pickMissingTools) |
| 추가 도구 실행 (평균 2개) | +600~1000ms | +600~1000ms |
| 합성 단계 토큰 ↑ | +100~200ms | +100~200ms |
| **총 추가 비용** | **+1500~2400ms** | **+700~1200ms** |

### 5.3 p95 시뮬레이션

- **후보 A 만**: p95 6120 → ~7500ms (DoD 위반 폭 +2500ms).
- **본 합성안**: p95 6120 → **~7000ms** (DoD 위반 폭 +2000ms, 후보 A 대비 −500ms).
- 발동률 가정: multitool 분기 trigger 가 자유변칙 440 케이스 중 ~30건 (7%) → 평균 지연 영향 = 7% × 1000ms = +70ms 평균. p95 영향은 *trigger 케이스의 p95* 가 +1000~1500ms 으로 집중.

### 5.4 비용-효과 분석

| 항목 | 효과 | 비용 |
|-----|-----|-----|
| cat3 PASS | +12~15pp | — |
| cat2 PASS (부수) | +2~4pp | — |
| sentinel multi-tool 4 케이스 | 4/4 → 4/4 (회귀 0) + 직타 강화 | — |
| p95 영향 | — | +880ms (6120 → ~7000) |
| 평균 영향 | — | +70ms (140ms 미만, 무시 가능) |
| DoD 5000ms | — | 이미 초과, 본 패치로 더 멀어짐 |

**결정 권고**: cat3 +12~15pp 의 정확도 효과는 *p95 +880ms 비용보다 가치 큼* (정확도가 SLA 1순위, p95 는 δ p95 게이트 별도 트랙). 단, **DoD 5000ms 게이트화는 본 패치 머지 *후* 별도 사이클 (δ p95 게이트 — `p95_gate_synthesis.md`) 로 다뤄야 함**. 동시 머지 금지.

---

## 6. 회귀 가드 — sentinel multi-tool 4 케이스

### 6.1 sentinel v2 의 multi-tool 케이스

| ID | 직군 | query | expect_tools_all | 본 설계 발동 분기 | 통과 예측 |
|----|-----|------|----------------|----------------|---------|
| **FIS-3-01** | fishery | "오늘 출항 가능 해역" | get_marine_forecast + get_warning | B (fishery min=3) | ✅ 발동 — 두 도구 + get_tide 보강 |
| **NAV-3-01** | navy | "동해 초계 작전 가능 해역" | get_marine_forecast + get_warning | B (navy min=2) | ✅ 발동 — 두 도구 보강 |
| **LEI-3-01** | marine_leisure | "양양 오늘 서핑 적합?" | get_surfing_index + get_marine_forecast | B (marine_leisure min=3) | ✅ 발동 — surfing_index + forecast 보강 |
| **PO-3-01** | public_org | "오늘 모니터링 해역 종합" | get_marine_forecast + get_warning | B (public_org min=2) | ✅ 발동 — 두 도구 보강 |

### 6.2 Stage I — 직타 게이트

| 케이스 | 통과 기준 |
|-------|---------|
| FIS-3-01 | `toolsUsed ⊇ {get_marine_forecast, get_warning}` + 답 ≥ 15자 + p95 단일 ≤ 8000ms |
| NAV-3-01 | `toolsUsed ⊇ {get_marine_forecast, get_warning}` + 결정어 1개 이상 |
| LEI-3-01 | `toolsUsed ⊇ {get_surfing_index, get_marine_forecast}` + 답에 "양양" 포함 |
| PO-3-01 | `toolsUsed ⊇ {get_marine_forecast, get_warning}` + 답 ≥ 20자 |

### 6.3 Stage II — 잔여 sentinel 무회귀 (N=16, v2 총 20건 중 4건 제외)

| 케이스 군 | 점검 포인트 | 회귀 우려 |
|---------|-----------|---------|
| pronoun follow-up (ANG-2-01b·CG-2-01b·MOF-6-01b) | `PRONOUN_GUARD` 가 차단 → multitool 분기 비발동 | 본 설계 PRONOUN_GUARD |
| 단일 도구 충분 케이스 (cat1·cat5·cat8) | `MULTI_INTENT_RE` 미매칭 → 비발동 | 본 설계 MULTI_INTENT_RE |
| 비도메인 잡담 ("회식 어때") | `MULTI_INTENT_RE` 매칭 → multitool 분기 발동 → 도구 호출 추가 → web_search 폴백 차단 가능성 | **위험 ↑** — `isDomainQuery` 가드 같이 검사 필요 |
| 메타 자기요약 ("방금 결정 사유") | PRONOUN_GUARD ("방금") 매칭 → 차단 | 정합 |
| 환각가드 cat7 ("어선법 제5조") | MULTI_INTENT_RE 미매칭 → 비발동 | 정합 |
| 부이 follow-up (알파 C4 블록) | C4 가 plan.steps unshift → multitool 분기는 이미 `realCount ≥ minTools` 일 가능성 → 비발동 | 정합 |

### 6.4 위험 가드 — 비도메인 잡담 차단

본 설계는 `MULTI_INTENT_RE` 만으로 발동 → 직군 모니터링 사용자(public_org / local_gov / coast_guard / mof / navy) 가 "회식 어때" / "팀 분위기 어때" 같이 쓰면 multi-tool 분기 발동 → 무관 도구 호출 → 답 어색.

**가드 추가**:
```
if (!isDomainQuery) return false;   // 비도메인이면 multitool 분기 비발동
```

`isDomainQuery` 는 L1659 에서 이미 계산되나 *재계획 트리거는 L1623* 이라 *순서 앞당겨* 필요. 합성안 §2.4 의 `needsReplan` 안에 `isDomainQuery(cq)` 헬퍼 인라인 호출 (DOMAIN_RE / ISLAND_BUOY_RE / detectZoneDeterministic).

### 6.5 Stage III — freevar N=440 게이트

| 셋 | 합격선 |
|----|------|
| phase2b_eval_freevar.jsonl cat3 | **PASS 68% → ≥80%** (목표) |
| phase2b_eval_freevar.jsonl cat2 | 48% → ≥50% (부수) |
| 잔여 카테고리 (cat1·cat4·cat5·cat6·cat7·cat8) | ±2pp |
| p95 net | 6120ms → ≤7000ms (DoD 위반 인정, δ p95 게이트는 별도 사이클) |
| CoT 누수 | 0 (불변식 항구) |
| 환각 의심 | ≤ 2 (false positive 8건은 별도 P_halluc_v2) |

---

## 7. 결론 — 신규 결정 요약 (B 시점)

1. **현 1회 재계획 트리거 위치 확정**: `needsReplan` L1493~L1502 / runBrain 본문 L1623~L1638. 좁은 supRE×secRE 로 cat3 회복 = 0.
2. **재계획 트리거 확장안**: 후보 A(`results.length<2`) + 후보 B(직군 floor) 합성, 후보 C(HALLUC) 배제. `needsReplan` 시그니처에 `profile` 추가 + `mode` 반환 (`dep_weave` | `multitool` | false).
3. **결정론적 보강 전략**: multitool 분기는 `planQuery` 재호출 *없이* `pickMissingTools` 로 결정론적 도구 추가 — p95 +1500ms → +880ms 로 절감.
4. **#30 P_continuity_v2 와의 정합**: `PRONOUN_GUARD` 1건 추가로 drift 회피. 동시 머지 가능.
5. **회복 추정**: cat3 PASS 68% → 80~83% (+12~15pp), cat2 부수 +2~4pp, sentinel multi-tool 4건 4/4 강화.
6. **p95 트레이드오프**: 6120ms → ~7000ms (+880ms). DoD 위반 폭 ↑ 인정, 그러나 cat3 정확도 회복 효과가 비용 초과. δ p95 게이트화는 별도 사이클.
7. **위험 가드**: `isDomainQuery` 인라인 + `PRONOUN_GUARD` 로 잡담·pronoun follow-up false-positive 차단.
8. **회귀 가드 게이트**: Stage I (sentinel 4 직타) → Stage II (sentinel 16 무회귀) → Stage III (freevar cat3 ≥80% + p95 ≤7000ms).

---

**한 줄 핵심 결정**:
재계획 트리거를 `(좁은 sup×sec 의존 위빙)` → `(MULTI_INTENT_RE × 직군별 EXPECT_TOOLS_MIN(2~3) × isDomainQuery × !PRONOUN_GUARD)` 로 확장하고 **multitool 분기는 planQuery 재호출 없이 `pickMissingTools` 결정론적 보강** 으로 처리해 cat3 +12~15pp / p95 +880ms / sentinel 4 직타 강화 — #30 P_continuity_v2 와 동시 머지 가능, DoD p95 5000ms 게이트화는 본 패치 후 별도 δ 사이클.
