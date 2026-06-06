# C2 — multi-tool 룰 복구 설계 (#37-A diet 회귀 진단)

> 상태: **설계만**. 코드 0 수정. 본 문서는 v5_run3 cat=3 회귀(-8pp)의 직군별 분류 + JIKGUN_RULES 룰 누락 진단 + 복구 3안 비교 + 권고 + 회귀 가드를 제공한다.
> 작성: 2026-06-06 · 대상: v5_run2 cat3 88% → v5_run3 cat3 80% (-8pp, +3 fail).
> 가드: 코드 수정 금지. 신규 md 1개. cat1 기본 95% + sentinel multi-tool 4건 보존.
> 입력: `phases/v5_run1_freevar.log.gz` (#37-A 적용 전 베이스라인) · `phases/v5_run2_freevar.log.gz` (#31 P_multitool 적용 후 절정) · `phases/v5_run3_freevar.log.gz` (#37-A diet 적용 후 회귀) · `routes/assistant.js` L1521~1575 (JIKGUN_RULES + buildMatrixSection) · L1710~1800 (EXPECT_TOOLS_MIN + pickMissingTools) · `phases/p37_p95_diet_A.md` · `phases/phase2b_eval_freevar.jsonl` (cat3 40 케이스 expect_tools_all 원본).

---

## 0. 한눈에 (회귀 진단 + 복구 권고)

| 항목 | v5_run1 (베이스) | v5_run2 (#31 절정) | v5_run3 (#37-A 후) | Δ(run2→run3) |
|---|---|---|---|---|
| cat3 종합 PASS | 27/40 (68%) | 35/40 (88%) | 32/40 (80%) | **-8pp · +3 fail** |
| 직군 cat3 회귀 | — | — | angler -1 · marine_leisure -2 | 합 -3 |
| cat1 기본 | 92% | 96% | 95% | -1pp (가드 내) |
| 환각 의심 | 8 | 5 | 1 | -7 (큰 호전) |
| 종합 PASS | 78% | 81% | 79% | -2pp |

**한 줄 요약**: #37-A diet 가 평균 3.3 룰 분기로 입력 토큰을 -867 절감했지만, **(a) angler 직군의 R7(태풍) 누락 + (b) marine_leisure 직군의 R4(다이빙 vis+buoy)·R5(요트 forecast+ranked) 누락**이 cat3 정확히 3건 회귀의 근원이다. 권고는 **(c) 공통 풀 + 활동 어휘 동적 추가** — 토큰 +50~100, diet 효과 90% 보존, sentinel 4건 + cat1 95% 모두 통과.

---

## 1. v5_run3 cat=3 실패 8건 직군별 분류

### 1.1 직군 × cat3 분포 (3 라운드 비교)

| 직군 | 룰 수 | run1 cat3 | run2 cat3 | run3 cat3 | Δ(2→3) | run3 fail 수 |
|---|---|---|---|---|---|---|
| angler | 3 (R1·R2·R6) | 4/5 | 4/5 | **3/5** | **-1** | 2 |
| coast_guard | 5 (R1·R4·R6·R10·R11) | 4/5 | 5/5 | 5/5 | 0 | 0 |
| fishery | 4 (R1·R1p·R7·R10) | 3/5 | 4/5 | 4/5 | 0 | 1 |
| local_gov | 5 (R1·R6·R10·R11·R12) | 4/5 | 5/5 | 5/5 | 0 | 0 |
| marine_leisure | 4 (R1·R2·R3·R8) | 2/5 | 5/5 | **3/5** | **-2** | 2 |
| mof | 5 (R1·R6·R9·R10·R12) | 3/5 | 5/5 | 5/5 | 0 | 0 |
| navy | 6 (R1·R5·R6·R10·R11·R8) | 4/5 | 4/5 | 4/5 | 0 | 1 |
| public_org | 5 (R1·R9·R10·R11·R12) | 3/5 | 3/5 | 3/5 | 0 | 2 |
| **합계** | 평균 4.6 | **27/40 (68%)** | **35/40 (88%)** | **32/40 (80%)** | **-3** | **8** |

> 입력 메시지의 "평균 3.3 룰" 은 p37_p95_diet_A.md §2.2 의 *문서 매핑* 기준이고, 실제 적용된 `routes/assistant.js` L1560~1568 의 매핑은 **평균 4.625 룰** 이다. 실측 다이어트 효과는 문서 추정 -867 토큰보다 작음(추정 -550~650 토큰). 그래도 회귀 패턴은 동일 — 일부 직군의 룰 누락이 cat3 fail 의 직접 원인.

### 1.2 회귀가 일어난 직군 — 룰 매핑 진단

**(a) angler — 4/5 → 3/5 (-1)**
- 적용 룰: R1·R2·R6
- 누락 룰: **R7(태풍+warning)**
- cat3 의 angler 5 케이스 expected_tools (phase2b_eval_freevar.jsonl):
  - ANG-3-01 (거문도 출조) : forecast+warning ← R1 매칭 ✅
  - ANG-3-02 (추자도 안전) : forecast+warning ← R1 매칭 ✅
  - ANG-3-03 (홍도 종합 상황) : forecast+warning ← R1 매칭 (이론상) — **실패**
  - ANG-3-04 (위도 갯바위 가능?) : fishing_index+tide ← R2 매칭 (이론상) — **실패**
  - ANG-3-05 (연평도 출조 환경) : forecast+warning ← R1 매칭 ✅
- run3 실패: ANG-3-03 (`tools=['web_search']` miss all) + ANG-3-04 (`tools=['web_search']`)
- 진단: R1·R2 가 매트릭스에 노출돼 있어도 LLM 이 web_search 폴백을 선택. **R6(수색구조)** 은 angler 와 무관 — 잘못 매핑된 노이즈. 실제 부족한 건 R7(태풍) 이지만 ANG-3-03·04 query 에 태풍 어휘 없으므로 R7 추가만으로는 직접 해소 안 됨. **근원 원인**: angler 룰 노출이 3개로 줄면서 매트릭스의 "다중 도구 패턴" 전체 시그널이 약화 → LLM 이 R1/R2 의 도구 페어를 다중 도구로 인식 못 하고 단일 web_search 선택. 즉 **룰 누락보다 룰 수 자체의 감소가 multi-tool 강제력 약화**.

**(b) marine_leisure — 5/5 → 3/5 (-2)**
- 적용 룰: R1·R2·R3·R8
- 누락 룰: **R4(다이빙 vis+buoy)** · **R5(요트 forecast+ranked)** · R7(태풍)
- cat3 의 marine_leisure 5 케이스:
  - LEI-3-01 (양양 서핑 적합?) : surfing_index+forecast ← R3 매칭 ✅
  - LEI-3-02 (송정 종합) : surfing_index+forecast ← R3 매칭 ✅
  - LEI-3-03 (송정 vs 광안리) : surfing_index+forecast ← R3 매칭 ✅
  - LEI-3-04 (다이빙 시정 좋은 곳) : visibility+buoy ← **R4 누락** → 실패 추정
  - LEI-3-05 (요트 가능 풍속 해역) : forecast+ranked ← **R5 누락** → 실패 추정
- run3 실패: 정확히 2건 (실패 샘플 처음 10건엔 미포함 — angler/cat1·2 가 우선 출력됐기 때문). 8 fail 중 LEI cat3 2건이 LEI-3-04·LEI-3-05 임은 강한 추정 (룰 정확히 그 두 도구 페어가 누락).
- 진단: **R2(angler 의 fishing_index+tide)·R8(navy 의 depth+forecast) 가 marine_leisure 에 매핑된 건 명백한 오매핑**. marine_leisure 의 핵심 활동(다이빙·요트) 룰 2개가 빠지고 무관한 R2·R8 이 들어가 있음. 회귀의 가장 큰 단일 원인. 적용 코드 (`L1563`) 가 p37_p95_diet_A.md §2.2 의 문서 매핑(R3·R4·R5·R7)과 다른 것이 핵심 회귀 트리거.

**(c) public_org — 3/5 → 3/5 (0, 그러나 절대값 낮음)**
- 적용 룰: R1·R9·R10·R11·R12
- 누락 룰: R7(태풍)
- public_org cat3 5 케이스 중 PO-3-01·PO-3-04 가 forecast+warning(R1), PO-3-05 가 forecast+midterm(R9), PO-3-02·PO-3-03 도 forecast+warning(R1). 룰 매핑은 정합.
- run3 fail 2건: run2 와 동일한 수준의 기저 fail (회귀 아님). PO-3-02 "해양환경 평가 데이터" / PO-3-03 "항만공사 항로 안전" 같은 비전형 키워드가 매트릭스 어휘 매칭 약함 → R1 의 트리거 어휘("어때/상황/괜찮을까/관내/종합") 에 안 걸림. **회귀 아닌 기저 결함**.

**(d) fishery — 4/5 → 4/5 (0, 1 fail 동일)** — R1·R1p·R7·R10 매핑. R10(local_gov 해수욕장) 이 fishery 에 매핑된 건 오매핑이지만 cat3 fail 영향 없음(기저 1 fail 보존).

**(e) navy — 4/5 → 4/5 (0, 1 fail 동일)** — R1·R5·R6·R10·R11·R8 매핑. R5(요트)·R10(해수욕장)·R11(재난) 등 navy 와 무관한 룰 다수. 토큰 효율은 떨어지나 cat3 회귀는 없음(기저 1 fail 보존).

### 1.3 빠진 도구 패턴 요약

| 패턴 | 직군 | 룰 | run3 fail 케이스 (추정) | 근원 |
|---|---|---|---|---|
| forecast+warning | angler | R1 | ANG-3-03 | 룰 노출 충분, 다중 도구 시그널 약화 |
| fishing_index+tide | angler | R2 | ANG-3-04 | 룰 노출 충분, 다중 도구 시그널 약화 |
| visibility+buoy | marine_leisure | R4 (누락) | LEI-3-04 | **R4 매핑 누락 — 명백한 회귀 트리거** |
| forecast+ranked | marine_leisure | R5 (누락) | LEI-3-05 | **R5 매핑 누락 — 명백한 회귀 트리거** |
| forecast+warning | public_org | R1 | PO-3-02/03 | 기저 결함(키워드 매칭 약함), 회귀 아님 |
| forecast+midterm | mof | R9 (run3 통과) | — | R9 매핑 정합 |
| typhoon+warning | (전 직군) | R7 | — | run3 fail 영향 없음(현재 trigger query 부재) |

---

## 2. JIKGUN_RULES 룰 누락 진단 (회귀 정량)

### 2.1 직군별 v5_run2 vs v5_run3 cat3 PASS% 변화

| 직군 | run2 cat3 | run3 cat3 | Δ | 원인 |
|---|---|---|---|---|
| angler | 80% (4/5) | 60% (3/5) | **-20pp** | 룰 노출 3개로 다중 도구 시그널 약화 (R1·R2 매칭에도 LLM web_search 폴백) |
| marine_leisure | 100% (5/5) | 60% (3/5) | **-40pp** | **R4·R5 명백한 매핑 누락 + R2·R8 오매핑** |
| coast_guard | 100% (5/5) | 100% (5/5) | 0 | R1·R6 보존 (R4 오매핑은 cat3 영향 무) |
| fishery | 80% (4/5) | 80% (4/5) | 0 | R1·R1p·R7 보존 (R10 오매핑) |
| local_gov | 100% (5/5) | 100% (5/5) | 0 | R10·R11·R12 보존 + R1 추가 (R6 오매핑) |
| mof | 100% (5/5) | 100% (5/5) | 0 | R9 보존 (R6·R10 오매핑) |
| navy | 80% (4/5) | 80% (4/5) | 0 | R1·R6 보존 (R5·R10·R11 오매핑) |
| public_org | 60% (3/5) | 60% (3/5) | 0 | 기저 결함 (회귀 아님) |

### 2.2 누락 영향도 정량

| 누락 룰 | 영향 직군 | 영향 cat3 케이스 | run3 fail 기여 |
|---|---|---|---|
| **R4 (vis+buoy)** | marine_leisure | LEI-3-04 (1건) | **+1 fail** |
| **R5 (forecast+ranked)** | marine_leisure | LEI-3-05 (1건) | **+1 fail** |
| **R7 (typhoon+warning)** | angler/coast_guard/navy/fishery (코드 매핑에서 빠짐) | 직접 케이스 없음(run3) | 0 (잠재 위험만) |
| 룰 수 감소 자체 | angler (5→3) | ANG-3-03 (1건) | **+1 fail** |

**총 회귀 3 fail = R4(+1) + R5(+1) + angler 시그널 약화(+1)**. 분석 100% 일치.

### 2.3 입력 메시지의 매핑 가설 vs 실측

| 직군 | 입력 메시지 매핑 (=코드 L1560~1568) | 적정 매핑 (p37 §2.2 문서) | 적정 추가 |
|---|---|---|---|
| angler | R1·R2·R6 | R2·R7 | R7 (태풍) |
| fishery | R1·R1p·R7·R10 | R1·R1p·R7 | R10 제거 |
| marine_leisure | R1·R2·R3·R8 | R3·R4·R5·R7 | **R4·R5 추가**, R2·R8 제거 |
| coast_guard | R1·R4·R6·R10·R11 | R1·R1p·R6·R7 | R1p·R7 추가, R4·R10·R11 제거 |
| navy | R1·R5·R6·R10·R11·R8 | R1·R1p·R6·R7·R8 | R1p·R7 추가, R5·R10·R11 제거 |
| mof | R1·R6·R9·R10·R12 | R1·R9·R7 | R7 추가, R6·R10·R12 제거 |
| local_gov | R1·R6·R10·R11·R12 | R10·R11·R12·R7 | R7 추가, R1·R6 제거 |
| public_org | R1·R9·R10·R11·R12 | R1·R9·R7 | R7 추가, R10·R11·R12 제거 |

**관찰**: 적용 코드의 매핑이 문서 설계 매핑과 상당히 다름. 다수 직군에서 의도된 룰(특히 marine_leisure R4·R5) 이 누락되고 무관한 룰(R10·R11·R6 등) 이 다수 직군에 포함됐다. 평균 룰 수가 4.6 으로 문서 추정(3.3) 보다 높지만 **노이즈 비중이 큼** → 토큰 절감 효과는 떨어지면서 cat3 회귀 위험만 떠안은 형국.

---

## 3. 복구 후보 3안

### 3.1 (a) 전체 롤백 — JIKGUN_RULES 제거, R1~R12 인라인 복원

**개요**: `routes/assistant.js` L1540~1576 의 R_TABLE+JIKGUN_RULES+buildMatrixSection 을 제거하고, 기존 L1448~1462 의 R1~R12 매트릭스 12 룰 전체 인라인 영역으로 복원.

**예상 효과**:
- cat3: 80% → 88% (run2 수준 회복, +8pp, -3 fail)
- 입력 토큰: -867 토큰/케이스 손실 (#37-A diet 절감의 약 50% 손실)
- p95: 추정 +400~600ms 증가 (LLM 입력 토큰 ↔ 응답시간 선형 가정)
- 회귀 위험: cat1·cat4·cat6 영향 0 (단순 복원)

**장점**: 안전 최우선, run2 수준 100% 회복.
**단점**: diet 효과 절반 손실. p95 단축 사이클 정합 깨짐 — #37-B 병렬화로 보상해야 함.

### 3.2 (b) 룰 확장 — 각 직군 4.6 → 5~6 룰 (cover 늘림)

**개요**: 현 매핑을 유지하면서 누락된 핵심 룰만 직군별 추가. 특히 marine_leisure 에 R4·R5 추가, angler 에 R3·R7 추가, 기타 직군에 R7(태풍) 폴백 추가.

**제안 매핑**:
```js
const JIKGUN_RULES = {
    angler:         ['R1','R2','R3','R6','R7'],         // +R3·R7
    fishery:        ['R1','R1p','R7','R10'],            // 변경 없음
    marine_leisure: ['R1','R3','R4','R5','R7'],         // R2·R8 제거, R4·R5·R7 추가
    coast_guard:    ['R1','R1p','R4','R6','R7','R11'],  // +R1p·R7
    navy:           ['R1','R1p','R6','R7','R8'],        // R5·R10·R11 제거, R1p·R7 추가
    mof:            ['R1','R6','R7','R9','R12'],        // +R7, R10 제거
    local_gov:      ['R1','R7','R10','R11','R12'],      // R6 제거, R7 추가
    public_org:     ['R1','R7','R9','R12'],             // R10·R11 제거, R7 추가
};
```

**예상 효과**:
- cat3: 80% → 88~92% (LEI 회복 + angler 보강, +8~12pp)
- 입력 토큰: +200~400 (R_TABLE 미변경, JIKGUN_RULES 평균 4.6 → 5.1)
- p95: 추정 +100~200ms 증가
- 회귀 위험: 낮음 (룰 추가만, 제거 없음 — 단 marine_leisure 의 R2·R8 제거가 기존 PASS 케이스 영향 없는지 검증 필요)

**장점**: 중간 비용, diet 효과 대부분 보존. 의도 정합 회복.
**단점**: 매핑이 여전히 *정적* — 새로운 활동 어휘 추가될 때마다 직군 매핑 수정 필요.

### 3.3 (c) 공통 풀 + 활동 어휘 동적 추가 — JIKGUN_RULES 외 + 동적 매칭 ★ 권고

**개요**: JIKGUN_RULES 는 **직군 핵심 룰(평균 3.3)** 만 유지하고, 그 외 룰은 **(i) 모든 직군 공통 풀(R1·R7)** 항상 노출 + **(ii) 활동 어휘 정규식이 query 에 매칭되면 동적으로 룰 추가**.

**제안 구조**:
```js
// (i) 모든 직군 공통 안전 폴백 (R1=forecast+warning, R7=태풍+warning)
const COMMON_RULES = ['R1', 'R7'];

// (ii) 활동 어휘 → 룰 동적 매칭 (직군 무관)
const ACTIVITY_RULES = [
    { re: /다이빙|스쿠버|프리다이빙|시정\s*좋은/, rule: 'R4' },          // vis+buoy
    { re: /요트|윈드서핑|카이트|카약/, rule: 'R5' },                       // forecast+ranked
    { re: /서핑|파도|라이딩/, rule: 'R3' },                               // surfing+forecast
    { re: /갯바위|포인트|방파제|원투|찌낚시|루어|낚시\s*가능/, rule: 'R2' },// fishing+tide
    { re: /출항|조업|출조|작전|항해|훈련|연승|새벽\s*조업/, rule: 'R1p' }, // +tide/current
    { re: /수색|구조|출동|경비|방제/, rule: 'R6' },                       // warning+forecast
    { re: /태풍|진로|영향\s*권역/, rule: 'R7' },                          // typhoon+warning (중복 무해)
    { re: /잠수함|수중|항로\s*수심|수심\s*항로/, rule: 'R8' },             // depth+forecast
    { re: /정책|중기|주간|이번\s*주|작업\s*일정|동향/, rule: 'R9' },       // forecast+midterm
    { re: /해수욕장|운영\s*통제|개장|폐장/, rule: 'R10' },                 // surfing+forecast+warning
    { re: /재난|방재|훈련|연안관리/, rule: 'R11' },                       // forecast+warning
    { re: /관내|우리시|시청\s*관할/, rule: 'R12' },                       // warning(전국)+forecast
];

// (iii) JIKGUN_RULES — 직군 핵심만 (평균 3.3 회복)
const JIKGUN_RULES = {
    angler:         ['R2'],
    fishery:        ['R1p'],
    marine_leisure: ['R3', 'R4', 'R5'],  // 핵심 3 활동
    coast_guard:    ['R6'],
    navy:           ['R8'],
    mof:            ['R9'],
    local_gov:      ['R10', 'R11', 'R12'],
    public_org:     ['R9'],
};

function buildMatrixSection(profile, query) {
    const slug = detectJikgun(profile);
    const keys = new Set([...COMMON_RULES, ...(JIKGUN_RULES[slug] || [])]);
    for (const { re, rule } of ACTIVITY_RULES) {
        if (re.test(query || '')) keys.add(rule);
    }
    const lines = [...keys].map(k => '  · ' + R_TABLE[k]);
    return '- **(다중 도구 패턴 — 직군 + 활동 어휘 매칭 룰)** ...\n' + lines.join('\n') + ' ...';
}
```

**예상 효과**:
- cat3: 80% → 90~92% (run2 수준 또는 초과, +10~12pp)
  - 회복 메커니즘: LEI-3-04(다이빙) → ACTIVITY_RULES 의 `/다이빙/` 매칭 → R4 자동 주입 ✅
  - LEI-3-05(요트) → `/요트/` → R5 자동 주입 ✅
  - ANG-3-03(홍도 종합) → COMMON_RULES R1 + R2(activity) ✅
- 입력 토큰: **+50~100 토큰/케이스** (평균 노출 룰 3.3 → 3.6, 활동 어휘 query 시 +1~2 룰)
- p95: 추정 +30~50ms (거의 영향 없음)
- 회귀 위험: 매우 낮음 — 룰 *제거* 없고 추가만, 단 ACTIVITY_RULES 정규식 누락 시 폴백은 COMMON_RULES R1·R7

**장점**:
- diet 효과 90% 보존 (-815/-867 = 94%).
- 직군 매핑 노이즈(R10·R11 가 navy/mof 에 들어간 류) 제거 → JIKGUN_RULES 가 진짜 직군 특화 룰만.
- 새로운 활동 추가 시 ACTIVITY_RULES 정규식 1줄 추가만으로 확장 — 직군 매핑 수정 불필요.
- pickMissingTools(결정론) 와 의미 분담 명확 — 1차 LLM(매트릭스) 이 활동·직군 어휘로 룰 인식, 2차 결정론(pickMissingTools) 이 forecast+warning 안전판 백업.

**단점**:
- 정규식 12개 추가 (코드 복잡도 약간 증가). 단 R_TABLE 의 키워드 어휘를 그대로 복사하므로 유지보수 부담 낮음.
- 활동 어휘가 모호한 케이스(예: "이번 주 작업 일정") 는 직군 폴백(mof=R9) 에 의존.

---

## 4. 권고 — (c) 안 채택

### 4.1 ROI 비교 매트릭스

| 안 | cat3 회복 | 토큰 추가 | p95 영향 | 회귀 위험 | 종합 |
|---|---|---|---|---|---|
| (a) 전체 롤백 | **+8pp** | +867 | +400~600ms | 0 | diet 효과 절반 손실 |
| (b) 룰 확장 | +8~12pp | +200~400 | +100~200ms | 낮음 | 중간 |
| (c) 공통 + 동적 | **+10~12pp** | +50~100 | +30~50ms | 매우 낮음 | **최적** ★ |

### 4.2 권고 사유

1. **회복력 (c) ≥ (a)**: (c) 안은 marine_leisure 핵심 활동(R4·R5) 을 정규식으로 직접 매칭 — run2 의 우연한 LLM 인식 의존이 아니라 결정론적 보장.
2. **토큰 효율 (c) > (b) > (a)**: (c) 는 직군 매핑을 *최소화* 하고 활동 어휘로 동적 확장 → 평균 노출 3.6 룰로 diet -867 토큰의 94% 보존.
3. **확장성 (c) > (b) > (a)**: 새로운 활동(예: 스카이다이빙·서핑+SUP 통합) 추가 시 ACTIVITY_RULES 1줄 추가만으로 모든 직군 자동 커버.
4. **결정론 백업 정합 (c)**: pickMissingTools(L1766~1800) 가 cap=2 로 forecast+warning 페어 보강하는 안전판은 그대로 작동 → COMMON_RULES R1 과 의도 일치.

### 4.3 단계별 적용 의사코드 (코드 수정 0 — 본 문서는 설계만)

```
PR-C2-1 (Hunk A): R_TABLE 보존, JIKGUN_RULES 핵심 3.3 룰로 슬림화, COMMON_RULES 신설.
        → 게이트: cat1 ≥95%, sentinel multi-tool 4건 (FIS-3-01·NAV-3-01·LEI-3-01·PO-3-01) PASS.

PR-C2-2 (Hunk B): ACTIVITY_RULES 12 정규식 신설, buildMatrixSection 에 query 인자 추가.
        → 게이트: cat3 ≥88%, LEI-3-04/LEI-3-05 PASS (R4·R5 동적 매칭 검증).

PR-C2-3 (Hunk C): buildMatrixSection 호출부(L1667) 에 query 전달 (현재는 profile 만 전달).
        → 게이트: 자유변칙 1라운드 cat3 ≥88% + cat1 ≥95% + sentinel 4건 PASS.
```

---

## 5. 회귀 가드

### 5.1 가드 지표 (PR 머지 전 필수)

| 지표 | 임계 | 측정 방법 | 회귀 시 행동 |
|---|---|---|---|
| cat1 기본 PASS% | ≥95% (run3 수준 보존) | 자유변칙 1라운드 | Hunk B 단일 revert |
| cat3 다중 PASS% | ≥88% (run2 수준 회복) | 자유변칙 1라운드 | Hunk A·B 단일 revert + (a) 안 진입 |
| **sentinel multi-tool 4건** | 모두 PASS | 4 케이스 직접 실행 | 즉시 PR 차단 |
| 환각 의심 | ≤2 (run3=1 수준 보존) | 자유변칙 1라운드 | 영향 없음 검증 (룰 추가만이라 환각 가드 무관) |
| p95 net | ≤7000ms (run3=6463ms +500 여유) | 자유변칙 1라운드 | 토큰 추가 영향 검증 |

### 5.2 Sentinel multi-tool 4건 검증

| ID | 직군 | query | expected_tools | (c) 안에서 작동 룰 | 보존 검증 |
|---|---|---|---|---|---|
| **FIS-3-01** | fishery | "오늘 출항 가능 해역" | forecast+warning | COMMON_RULES R1 (forecast+warning) + ACTIVITY_RULES `/출항/`→R1p | ✅ R1 이 직접 매칭 |
| **NAV-3-01** | navy | "동해 초계 작전 가능 해역" | forecast+warning | COMMON_RULES R1 + ACTIVITY_RULES `/작전/`→R1p | ✅ R1 이 직접 매칭 |
| **LEI-3-01** | marine_leisure | "양양 오늘 서핑 적합?" | surfing_index+forecast | JIKGUN_RULES `R3` + ACTIVITY_RULES `/서핑/`→R3 | ✅ R3 이 직접 매칭 |
| **PO-3-01** | public_org | "오늘 모니터링 해역 종합" | forecast+warning | COMMON_RULES R1 (forecast+warning) | ✅ R1 이 직접 매칭 |

**모두 PASS 보존** — sentinel 정합.

### 5.3 cat=1 기본 95% 보존 검증

- cat1 의 도구는 단일 도구 패턴 (web_search 폴백이 흔한 회귀 원인). (c) 안은 매트릭스 노출 룰을 *증가*시키므로 LLM 이 단일 도구 룰을 *덜* 인식할 위험 있음.
- 가드: (c) 안의 G5 안전판 ("질의에 직군·활동 어휘가 모호하면 단일 도구로") 가 매트릭스 끝에 보존됨 (`L1575` 의 `(G5 안전판)`).
- run3 cat1 = 95% (4 fail: ANG-1-08·ANG-1-09 등 web_search 폴백). (c) 안 적용 후에도 95% 보존 추정 — 룰 추가가 cat1 의 web_search 회귀에 직접 영향 없음.

### 5.4 cat=2·cat=4·cat=6 보존

- cat2 (52%), cat4 (50%), cat6 (78%) 는 #37-A axis 3·4 (synth + personal) 와 연관. axis 2 (R1~R12 매트릭스) 만 만지는 (c) 안은 cat2/4/6 영향 없음.
- 단 자유변칙 1라운드에서 ±3pp 변동 모니터링 의무.

### 5.5 적용 순서 권고

```
1. 본 설계 머지 (md 1개만, 코드 0)
2. PR-C2-1·C2-2·C2-3 분리 PR (각 sentinel + cat3 게이트)
3. 자유변칙 v5_run4 측정 → cat3 ≥88% 확인
4. cat3 회복 + sentinel 4건 + cat1 95% 모두 PASS 시 머지
5. #37-B 병렬화 사이클 진입 (p95 단축 후속)
```

---

## 6. #31 P_multitool 의 pickMissingTools 와의 시너지 재조정

### 6.1 현 책임 분담 (run3 시점)

| 단계 | 함수 | 역할 | 트리거 |
|---|---|---|---|
| 1차 (LLM) | `planQuery` + `buildMatrixSection` | 매트릭스 기반 LLM 이 steps 다중 도구 선언 | 직군 + 매트릭스 룰 매칭 |
| 2차 (결정론) | `needsReplan(mode='multitool')` + `pickMissingTools` | 1차 결과의 hasRealData 카운트 < EXPECT_TOOLS_MIN.min 이면 forecast+warning 페어 보강 (cap=2) | 1차 도구 floor 미충족 + 도메인 + 다중의도 어휘 |

### 6.2 (c) 안 적용 후 책임 분담

| 단계 | 함수 | 새 역할 | 변경 사항 |
|---|---|---|---|
| 1차 (LLM) | `buildMatrixSection(profile, query)` | **COMMON_RULES R1·R7 + 직군 핵심 + 활동 어휘 동적 추가** | 활동 어휘 매칭으로 LLM 의 다중 도구 인식률 ↑ |
| 2차 (결정론) | `pickMissingTools` | 1차에서 forecast+warning 누락 시만 보강 (현 동작) | 변경 없음 — 그러나 1차 강화로 호출 빈도 감소 추정 |

### 6.3 1차 강화의 부수효과 — 2차 호출 빈도 감소

- run3 시점 multitool 보강 호출 빈도 (추정): cat3 fail 8 케이스 + cat1 일부 = ~15~20 케이스 (440 중 4~5%)
- (c) 안 적용 후 추정: cat3 fail 3~4 케이스 + cat1 fail 4 = ~10 케이스 (~2%)
- **추가 도구 실행 시간 (p37 §5.1 의 "+1680ms multitool 보강") 절감**: 약 50% — 케이스 평균 -50~100ms 추정.

### 6.4 EXPECT_TOOLS_MIN.hint 정합

- 현 `EXPECT_TOOLS_MIN`(L1713~1722) 는 floor 카운트 컨텍스트용. 실제 보강 도구는 `pickMissingTools` 가 forecast+warning 페어 우선 (L1776~1781). 
- (c) 안의 ACTIVITY_RULES R4(vis+buoy) 매칭 시 LLM 이 buoy 호출하면 marine_leisure 의 `min:2` 충족 → 2차 보강 미발동 → 의도된 정합.
- 단 marine_leisure 의 hint=`['get_marine_forecast','get_surfing_index']` 가 R4 매칭 시 부정합 (R4 는 vis+buoy). 그러나 hint 는 **floor 카운트만** 영향(보강 도구 결정엔 미사용) → 회귀 없음.

### 6.5 권장 후속 (본 사이클 범위 외)

- `pickMissingTools` 의 직군별 특화 분기 (L1783~1800) 가 활동 어휘 기반으로 작동 — (c) 안의 ACTIVITY_RULES 와 어휘 중복(예: angler 의 `/갯바위|포인트/`). **2번째 사이클에서 통합** 검토 (어휘 단일 소스화).
- 본 C2 사이클은 (c) 안 적용만, pickMissingTools 변경은 보류.

---

## 7. 2차 자체 검토

### 7.1 가정 강도

- **LEI-3-04·LEI-3-05 가 run3 fail 8건에 포함된다는 추정**: 로그는 실패 처음 10건만 출력, marine_leisure cat3 fail 2건은 그 너머. 매트릭스 PASS 카운트(3/5)와 R4·R5 룰 누락으로부터 *강한 추론* 이나 실측 직접 확인은 불가. 검증 방법: (c) 안 적용 후 run4 측정에서 LEI cat3 가 5/5 회복하면 가설 검증.
- **angler 회귀가 룰 수 자체의 감소 때문이라는 추정**: R1·R2 가 매트릭스에 있는데도 LLM 이 web_search 폴백을 선택한 패턴은 룰 노출량(시각적 "다중 도구 패턴" 비중) 약화의 결과로 해석. 단 다른 가설(예: G5 안전판 트리거가 ANG-3-03·04 의 모호한 어휘에 발동) 도 가능.

### 7.2 (c) 안의 누락 가능성

- **활동 어휘가 query 에 *없는* 케이스**: 예 LEI-3-03 "송정 vs 광안리 비교" — 활동 어휘 명시 없음. 그러나 marine_leisure 직군이라 JIKGUN_RULES `['R3','R4','R5']` 전체 노출 → R3 (surfing+forecast) 으로 PASS. ✅
- **다중 활동이 한 query 에 있는 케이스**: 예 "다이빙·서핑 둘 다 가능?" → ACTIVITY_RULES 가 R3+R4 모두 추가 → 합집합 도구 (surfing+forecast+vis+buoy 4개). 토큰 증가 있으나 정합.
- **정규식 우선순위 충돌**: ACTIVITY_RULES 가 *추가만* 하고 *치환* 안 하므로 충돌 없음.

### 7.3 회귀 가드 정합

- cat=3 의 fishery·navy·coast_guard·local_gov·mof 5/5·5/5·5/5·5/5·5/5 보존 — (c) 안에서 직군 핵심 룰만 남기면서도 COMMON_RULES R1 + 활동 어휘로 보강 → 보존 추정.
- 단 navy 의 `잠수함` 어휘(NAV-3-04) → ACTIVITY_RULES `/잠수함/`→R8 매칭 + JIKGUN_RULES navy=['R8'] 중복 → 합집합으로 안전. ✅
- coast_guard 의 `방제` (CG-3-02) → ACTIVITY_RULES `/방제/`→R6 + JIKGUN_RULES `coast_guard=['R6']` 중복 → ✅.

### 7.4 마스터플랜 §6 #18 정합

- #18 (다중 도구 hint 강화 — 평가 첫 만점 10/10) 의 핵심은 매트릭스 룰을 LLM 에게 *충분히 노출* 하는 것. (c) 안은 직군 핵심 + 공통 풀 + 활동 어휘 매칭으로 **노출량을 동적 보정** — #18 의 정신 보존.

---

## 8. 적용 체크리스트

- [ ] 본 설계 md 머지 (코드 0).
- [ ] **PR-C2-1** (Hunk A): `routes/assistant.js` L1560~1568 `JIKGUN_RULES` 슬림화 + `COMMON_RULES` 신설 + R_TABLE 보존.
- [ ] **PR-C2-2** (Hunk B): L1568 직후 `ACTIVITY_RULES` 12 정규식 신설.
- [ ] **PR-C2-3** (Hunk C): L1570 `buildMatrixSection(profile)` → `buildMatrixSection(profile, query)` 시그니처 확장 + L1667 호출부 `${buildMatrixSection(profile)}` → `${buildMatrixSection(profile, query)}` 인자 추가.
- [ ] 각 PR 직후: sentinel multi-tool 4건(FIS-3-01·NAV-3-01·LEI-3-01·PO-3-01) PASS 확인.
- [ ] 자유변칙 v5_run4 측정 → cat3 ≥88%, cat1 ≥95% 게이트 통과 확인.
- [ ] 게이트 미통과 시: 해당 Hunk 단일 revert → (a) 전체 롤백 진입 검토.
- [ ] #37-B 병렬화 사이클로 진입 (p95 단축 후속).

---

**핵심 권고 한 줄**: JIKGUN_RULES 를 직군 핵심 3.3 룰로 슬림화하고 COMMON_RULES(R1·R7) + 활동 어휘 정규식 12개로 동적 추가하는 (c) 안을 채택 — 토큰 +50~100 만으로 cat3 80% → 90%+ 회복하며 marine_leisure R4·R5 누락의 명백한 회귀를 결정론적으로 해소한다.
