# #31 P_multitool 패치 — 설계 시점 A

> planQuery 시스템 프롬프트 **다중 도구(multi-tool) 패턴 확장 설계서**.
> 본 문서는 **설계만**이며 코드 수정 없음. 시점 B(구현/회귀 측정)에서 패치 적용.
>
> - 기준 리포트: `v5_run1_report.md` (PASS 347/440=78%, cat3=68% 13fail)
> - 기준 로그: `v5_run1_freevar.log.gz`
> - 기준 케이스: `phase2b_eval_freevar.jsonl` cat=3 40건
> - 기준 코드: `routes/assistant.js` planQuery (#18 다중 도구 hint, L1448)
> - 기준 마스터플랜: §7 2026-05-30 "#18 평가 첫 만점 PASS 10/10"

---

## 1. cat=3 실패 13건 분석

### 1.1 직군별 실패 분포 (직군 × cat3 표 역산)

| 직군 | 통과/총 | 실패수 | 추정 실패 케이스 (40건 중) |
|------|---------|--------|----------------------------|
| angler | 4/5 | 1 | ANG-3-04 (로그 실패 샘플로 확정) |
| coast_guard | 4/5 | 1 | CG-3-05 추정 (typhoon_status 다중 결합) |
| fishery | 3/5 | 2 | FIS-3-03 추정 (midterm_forecast), FIS-3-05 (연승어업 미지정 키워드) |
| local_gov | 4/5 | 1 | LG-3-05 추정 (typhoon_status 결합) |
| **marine_leisure** | **2/5** | **3** | LEI-3-04 (visibility+buoy), LEI-3-05 (zones_ranked), LEI-3-01·02·03 중 1건 |
| mof | 3/5 | 2 | MOF-3-01·03 (midterm_forecast 결합), MOF-3-03 추정 |
| navy | 4/5 | 1 | NAV-3-04 (depth+forecast 특수결합) 추정 |
| public_org | 3/5 | 2 | PO-3-05 (midterm), PO-3-03/04 중 1건 |
| **합** | **27/40** | **13** | cat3 실패율 32%, multi=68% 정합 |

> 로그상 명시 실패 샘플은 **ANG-3-04 1건뿐** (`miss all=['get_fishing_index', 'get_tide']`).
> 나머지 12건은 위 표의 **추정**임 — 시점 B 에서 jsonl runner 출력 raw 를 별도 채집해 확정.

### 1.2 expect_tools_all 미충족 패턴별 빈도

cat=3 케이스 40건에 명시된 **`expect_tools_all` 도구 쌍 분포**:

| 도구 쌍 | 건수 | 점유 |
|---------|------|------|
| forecast + warning | **29건** | 72.5% |
| forecast + midterm_forecast | 4건 | 10.0% |
| surfing_index + forecast | 3건 | 7.5% |
| typhoon_status + warning | 2건 | 5.0% |
| fishing_index + tide | 1건 | 2.5% (ANG-3-04) |
| visibility + buoy_observation | 1건 | 2.5% (LEI-3-04) |
| forecast + zones_ranked | 1건 | 2.5% (LEI-3-05 요트) |
| midterm + warning | 1건 | 2.5% (MOF-3-03) |
| depth + forecast | 1건 | 2.5% (NAV-3-04 잠수함) |

**도구별 누락 빈도(가중치 = 그 도구를 포함한 쌍에서 expect 미충족 추정 횟수):**

| 도구 | 등장(쌍) | 추정 누락 | 비고 |
|------|----------|-----------|------|
| `get_marine_forecast` | 38 | 낮음 | 거의 항상 잡힘(LLM 1순위) |
| `get_warning` | 32 | **중** | "관내·종합·상황·평가" 같은 우회표현에서 종종 누락 |
| `get_midterm_forecast` | 5 | **높음** | 정책·중기 키워드 hint 가 #18 룰에 1회만 언급, 강제력 약함 |
| `get_typhoon_status` | 2 | **높음** | 룰에 명시 없음 — "태풍 영향" 키워드만으로 LLM 이 단일 도구로 끝냄 |
| `get_surfing_index` | 3 | 중 | floor 보강룰(L1450)에 있으나 forecast 와 *함께* 호출 강제는 약함 |
| `get_visibility` | 1 | **높음** | "다이빙 시정 좋은 곳" → visibility 단일 호출에 그치고 buoy_observation 누락 |
| `get_zones_ranked` | 1 | **높음** | "요트 가능 풍속 해역" → forecast 단독, ranking 호출 안 함 |
| `get_fishing_index` | 1 | **높음** | "갯바위 가능" 표현이 fishing 어휘에 없어 web_search 폴백 (ANG-3-04 확정) |
| `get_tide` | 1 | **높음** | 동상 — fishing 동반 누락 |
| `get_depth` | 1 | 중 | 잠수함 키워드 → depth 만 부르고 forecast 누락 가능 |

**핵심 결함 5축:**

1. **F-1 (특수 결합 누락)**: `typhoon_status + warning`, `depth + forecast`, `visibility + buoy_observation`, `zones_ranked + forecast` 같은 *비표준* 쌍이 #18 룰의 일반 패턴("forecast + warning")만 따라가서 누락.
2. **F-2 (midterm 강제력 부족)**: #18 룰 끝에 한 줄("정책·중기 관심 직군은 추가로 midterm")만 있고, "이번 주/주간/중기/장기/정책 결정" 트리거 어휘가 명시되지 않아 LLM 이 흘려보냄.
3. **F-3 (낚시 활동 어휘 빈틈)**: "갯바위/포인트/방파제/원투" 같은 angler 활동 어휘가 trigger 키워드("어때/상황/괜찮을까")와 겹치지 않아 룰 outside.
4. **F-4 (marine_leisure 미포함)**: #18 multi-tool 직군 목록에 **marine_leisure 누락**(L1448). floor 보강 룰(L1450, surfing_index 우선)은 있으나 *함께* 호출 강제는 약함.
5. **F-5 (typhoon 어휘 트리거 부재)**: "태풍 영향/태풍 경로/태풍 진로" → typhoon_status 단일 또는 warning 단일로 끝남.

---

## 2. planQuery multi-tool 패턴 확장 후보

### 2.1 확장 룰 매트릭스 (직군 × 활동 키워드 → 도구 쌍)

> 표 우측 "회귀 가드" 열은 §3 의 회귀 방지 조건. **AND 조합** 만족 시에만 multi 강제.

| # | 직군 | 활동·질의 키워드(any) | → 강제 도구 쌍 | 회귀 가드 |
|---|------|-----------------------|----------------|-----------|
| R1 | fishery / angler | 출항, 조업, 출조, 작업, 새벽 조업, 연승, 안전 | forecast + warning + (tide∨current 선택) | zone 확정 OR profile.activity 명시 |
| R2 | angler | 갯바위, 포인트, 방파제, 원투, 찌낚시, 루어 | **fishing_index + tide** + (forecast 선택) | zone or 섬·해변명 토큰 1개+ |
| R3 | marine_leisure | 서핑, 파도, 라이딩 | **surfing_index + forecast** + warning 선택 | beach 어휘 1개+ (양양/송정/광안리…) |
| R4 | marine_leisure | 다이빙, 스쿠버, 프리다이빙, 시정 | **visibility + buoy_observation** | zone 확정 |
| R5 | marine_leisure | 요트, 윈드서핑, 카이트, 카약, "어디" | **forecast + zones_ranked(scope:'haegu')** | "어디/추천/좋은 곳" 어휘 |
| R6 | coast_guard | 수색, 구조, 출동, 경비, 방제, 안전성 | warning + forecast + (typhoon_status 선택) | 활성 태풍 시즌(8~10월) OR "태풍" 어휘 |
| R7 | coast_guard / local_gov / mof / navy | 태풍, 진로, 영향 권역 | **typhoon_status + warning** | "태풍" 어휘 명시 (R6 와 OR) |
| R8 | navy | 잠수함, 수중, 항로 수심 | **depth + forecast** + warning 선택 | "잠수함/수심" 어휘 |
| R9 | mof / public_org | 정책, 중기, 주간, 이번 주, 작업 일정, 동향, 모니터링 | forecast + **midterm_forecast** + warning | "정책/중기/주간/이번 주" 어휘 |
| R10 | local_gov | 해수욕장, 운영, 통제, 개장, 폐장 | surfing_index + forecast + warning | 해수욕장명 OR beach 어휘 |
| R11 | local_gov | 재난, 방재 훈련, 연안관리 | forecast + warning | "관내/방재/훈련" 어휘 |
| R12 | 전 직군 | "관내, 우리시, 시청 관할" + 종합 | get_warning(전국 집계) + forecast | 모호지명 (§기존 C5 보강 재사용) |

### 2.2 룰 R1~R12 의 cat=3 케이스 매칭 (40건 커버리지)

| 케이스 | 룰 | 핵심 트리거 | 비고 |
|--------|----|-----|------|
| ANG-3-01..03 | R1 | "출조/안전/종합" | 현행 #18 로 통과(추정) |
| **ANG-3-04** | **R2** | "갯바위 가능" | **신규 — fishing_index+tide 강제** |
| ANG-3-05 | R1 | "출조 환경" | 통과 |
| FIS-3-01·02·04·05 | R1 | "출항/조업/종합/연승어업" | 통과 ↔ FIS-3-05 의 "연승어업" 어휘 룰 추가 |
| **FIS-3-03** | **R9** | "이번 주 작업 일정" | **신규 — midterm 강제** |
| LEI-3-01·02·03 | R3 | "서핑/송정/광안리/양양" | 통과 (현 floor 보강) — 단 multi 강제 누락 시 1건 fail |
| **LEI-3-04** | **R4** | "다이빙 시정" | **신규 — visibility+buoy_observation 강제** |
| **LEI-3-05** | **R5** | "요트 가능 풍속 해역" | **신규 — forecast+zones_ranked 강제** |
| CG-3-01..04 | R6 | "수색/방제/경비/관내" | 통과 |
| **CG-3-05** | **R7** | "태풍 영향" | **신규 — typhoon_status+warning 강제** |
| NAV-3-01·02·03·05 | R1 | "초계/상륙/항해/모니터링" | 통과 |
| **NAV-3-04** | **R8** | "잠수함 운용" | **신규 — depth+forecast 강제** |
| **MOF-3-01** | **R9** | "이번 주 정책" | **신규 — midterm 강제** |
| MOF-3-02·04·05 | R1+R9 일부 | "어업관리/수산자원/해양환경" | 통과 |
| **MOF-3-03** | **R9 변종** | "정책 결정 자료" | **신규 — midterm+warning 강제** |
| LG-3-01..04 | R10·R11·R12 | "관내/재난/해수욕장/연안관리" | 통과 (현 C5/C5-b 보강) |
| **LG-3-05** | **R7** | "태풍 영향 관내" | **신규 — typhoon_status+warning 강제** |
| PO-3-01..04 | R1 | "모니터링/평가/항로/연안" | 통과 |
| **PO-3-05** | **R9** | "환경 데이터 동향" | **신규 — midterm 강제** |

**신규 룰이 해소하는 예상 통과수: 12건** (NAV-3-04 추정 포함). 회귀 0 시 cat3: 27→39/40 = **97.5%**.
보수적 추정(R7/R8/R9 부분 누락): **+9~12건** → cat3 ≥ 90%.

### 2.3 프롬프트 텍스트 초안 (L1448 교체)

> 현재 한 줄로 묶인 #18 룰을 **계층화**해 LLM 의 미스 감소. **이중 콜론(::)** 으로 "조건 → 도구" 시각 강조.

```
- **(다중 도구 패턴 — v2)** 아래 매트릭스 중 하나라도 매칭되면 해당 도구들을 **모두** steps 에 함께 넣으세요(빈 결과 우려해도 호출은 같이 — 합성이 자료별로 있음/없음 보고합니다):
  · [R1 어업·해군·해경·지자체·공공기관·해수부 + "어때/상황/괜찮을까/전반/전체/관내/종합/모니터링/평가"]
    :: get_marine_forecast + get_warning
  · [R1+ 어업·해경·해군 + "출항/조업/출조/작업/연승/새벽 조업/안전"]
    :: 위 + get_tide 또는 get_current (해역 확정 시)
  · [R2 angler + "갯바위/포인트/방파제/원투/찌낚시/루어/낚시 가능"]
    :: get_fishing_index + get_tide (+ 선택: get_marine_forecast)
  · [R3 marine_leisure + "서핑/파도/라이딩" + 해수욕장명]
    :: get_surfing_index + get_marine_forecast
  · [R4 marine_leisure + "다이빙/스쿠버/프리다이빙/시정 좋은"]
    :: get_visibility + get_buoy_observation
  · [R5 marine_leisure + "요트/윈드서핑/카이트/카약" + "어디/추천/좋은 곳/가능 해역"]
    :: get_marine_forecast + get_zones_ranked(scope:"haegu")
  · [R6 coast_guard + "수색/구조/출동/경비/방제"]
    :: get_warning + get_marine_forecast (+ 태풍 시즌: get_typhoon_status)
  · [R7 전 직군 + "태풍/진로/영향 권역"]
    :: get_typhoon_status + get_warning
  · [R8 navy + "잠수함/수중/항로 수심"]
    :: get_depth + get_marine_forecast
  · [R9 mof·public_org·전 정책 직군 + "정책/중기/주간/이번 주/작업 일정/동향"]
    :: get_marine_forecast + get_midterm_forecast (+ 정책 결정: get_warning)
  · [R10 local_gov + "해수욕장/운영/통제/개장/폐장"]
    :: get_surfing_index + get_marine_forecast + get_warning
  · [R11 local_gov + "재난/방재/훈련/연안관리"]
    :: get_marine_forecast + get_warning
  · [R12 전 직군 + "관내/우리시/시청 관할" + 종합]
    :: get_warning(zone="전국" 또는 비움) + get_marine_forecast
  매칭이 둘 이상이면 도구 합집합(중복 제거).
```

### 2.4 룰 우선순위 (다중 매칭 시 충돌 해소)

R2 > R4 > R5 > R8 > R7 > R9 > R3 > R10 > R6 > R1 > R11 > R12.

- 특수 결합(R2/R4/R5/R8) 우선 — 일반 R1 보다 더 정확한 도구가 있을 때.
- R7 (태풍) 은 R6/R11 보다 우선 — 활성 태풍이 있으면 모든 경비/방재 결정의 1차.
- R1/R12 는 최후 폴백.

---

## 3. 회귀 방지 (cat=1 기본 92% 보호)

### 3.1 cat=1 실패 6건 회귀 위험 분석

v5 로그 cat=1 실패 sample 3건 (ANG-1-05, ANG-1-06, ANG-1-09):

- ANG-1-05 "위도" — zone 모호(섬 이름 "위도" vs 좌표 위도)
- ANG-1-06 "어느 해역" — zone 미지정 클라리피케이션
- ANG-1-09 "연평도 ?" — 서해 5도 정치적 맥락으로 빠짐

→ **공통: zone 토큰 0~1개의 모호 질의**. 이 영역에 multi 강제하면 빈 호출 다수 발생.

### 3.2 트리거 좁힘 가드

룰 R1~R12 모두에 **AND 조건** 부가:

| 가드 | 조건 | 적용 |
|------|------|------|
| G1: zone 확정 | `detectZoneDeterministic(query) || focus.zone || profileDefaultZone || GPS` 중 1개+ | R1·R2·R4·R8 |
| G2: 활동 어휘 명시 | 위 §2.1 키워드 컬럼 어휘 1개+ (정규식 매칭) | 모든 R |
| G3: 직군 매칭 | `detectJikgun(profile)` 결과가 룰의 직군 집합에 속함 | R1·R3·R4·R5·R6·R8·R9·R10·R11 |
| G4: 비도메인 차단 | `DOMAIN_RE.test(query)` 통과 (§5 와 통합) | 모든 R |
| G5: zone 모호 시 단일 | 0 zone 토큰 + cat=1 형 모호 어휘("어떻게/뭐야") → multi off | 전체 |

**핵심 결정**: `G1 AND G2 AND G3 AND G4 = true` 이며 `G5 ≠ true` 일 때만 multi 강제.
즉 **zone 모호 + 단순 어휘 = 현행 단일 도구 유지** → cat=1 회귀 0 기대.

### 3.3 LLM 측 안전판 (프롬프트 명시)

```
※ 단, 해역/지명/해변명이 질의에 **하나도 없고** 직군·활동 어휘도 모호하면(예: "어떻게 돼", "뭐야", "괜찮아")
  위 매트릭스 룰을 적용하지 말고 *기존 단일 도구* 룰로 처리하세요.
  Zone 모호 + multi 강제는 빈 결과만 늘립니다.
```

### 3.4 cat=2 연속(48%, 42fail) 영향 추정

cat=2 의 실패는 zone follow-up(focus.zone 전파) 결함이 주축 — R1~R12 는 *직접 질의*에서만 작동하고
focus 후속에서는 §6 #22 v2 의 FOCUS_ZONE_ARG 매핑이 우선. 따라서 cat=2 회귀 영향 **최소** (예상 ±0pp).

다만 R2(angler "갯바위") 같은 활동 어휘 후속이 있으면 도구 수가 늘어 응답시간 증가 → §5 참조.

---

## 4. DOMAIN_RE 와 trigger 통합 (α 의 isDomainQuery 분기)

### 4.1 현행 (L1657~1661)

```js
const DOMAIN_RE = /특보|예보|파고|파주기|풍속|풍향|풍랑|해상|해양|연안|해역|해구|부이|시정|가시거리|조석|만조|간조|물때|유속|유향|해류|수심|태풍|기상|관측|수온|낚시|서핑|어업|조업|항해|바다|섬|항구|항만/;
const ISLAND_BUOY_RE = /거문도|오륙도|마라도|.../;
const isDomainQuery = DOMAIN_RE.test(q) || ISLAND_BUOY_RE.test(q) || !!detectZoneDeterministic(q);
```

### 4.2 종합 질의 패턴 명시 추가

```js
// 종합 모니터링 질의 — 직군·zone 없어도 도메인 질의로 인정
const OVERVIEW_RE  = /어때|상황|전반|전체|괜찮|종합|모니터링|평가|동향|작업\s*환경|운영\s*결정|관할|관내|우리\s*시/;
// 활동 어휘 — R2~R10 트리거 (도구 합집합 결정)
const ACTIVITY_RE  = /출항|조업|출조|연승|갯바위|포인트|방파제|원투|찌낚시|루어|서핑|파도|라이딩|다이빙|스쿠버|프리다이빙|요트|윈드서핑|카이트|카약|패들|수색|구조|출동|경비|방제|잠수함|수중|항로|해수욕장|운영|통제|개장|폐장|재난|방재|훈련|연안관리|정책|중기|주간|이번\s*주|작업\s*일정|태풍|진로|영향\s*권역/;
const isDomainQuery = DOMAIN_RE.test(q) || ISLAND_BUOY_RE.test(q)
                    || OVERVIEW_RE.test(q) || ACTIVITY_RE.test(q)
                    || !!detectZoneDeterministic(q);
```

### 4.3 효과

- **isDomainQuery 확장**: cat=3 "이번 주 작업 일정", "수색구조 출동 가능" 같이 **명사형 도메인 어휘가 없는 질의**도 도메인으로 인식 → web_search 폴백 차단(L1665 환각 가드 진입).
- **회귀 위험**: OVERVIEW_RE 가 "전반" 같이 일상어를 포함 — 비도메인 자유 대화("오늘 기분 어때") 도 도메인으로 잡힐 위험. **G1(zone) AND G3(직군) AND G4(DOMAIN_RE_strict)** 의 strict 매트릭스로 multi 트리거만 좁히고, isDomainQuery 자체는 web_search 폴백만 막으므로 큰 회귀 없음 (cat=5 비도메인 98% → ≥95% 유지 예상).

---

## 5. 위험 평가

### 5.1 응답 시간 (p95)

| 지표 | v5 측정 | P_multitool 후 예상 | 변화 |
|------|---------|---------------------|------|
| 평균 도구 호출/케이스 | 1.6 | 2.4 | +0.8 |
| **p95 (현)** | **6120ms** | **6800~7400ms** | **+11~21%** |
| p50 | 1140ms | 1300ms | +14% |
| 단일 도구 평균 latency | ~520ms | ~520ms | — |

### 5.2 병렬 vs 직렬 권고

현행 L1616 `for...of plan.steps.slice(0, 6)` 는 **직렬 실행**. P_multitool 로 도구 수가 1→2+ 늘면 p95 선형 증가.

**권고**: 시점 B 에서 R1~R12 가 강제하는 도구 쌍을 **`Promise.all`** 로 병렬화:

```js
const results = await Promise.all(plan.steps.slice(0, 6).map(async step => {
  try { return { tool: step.tool, args: step.args || {}, result: await TOOL_EXEC[step.tool](step.args || {}) }; }
  catch (e) { return { tool: step.tool, error: e.message }; }
}));
```

- **장점**: p95 +11~21% → +5~8% 로 완화 (도구별 latency 가 dominant 이므로).
- **단점**: 1) 의존 위빙(needsReplan)이 *직렬 결과* 가정 — focus1 추출에 영향. 2) deriveFocus 가 results 순서 의존이면 destabilize. → **현행 직렬 유지, 시점 B 별도 패치로 분리**.

DoD 게이트 (p95 ≤ 10000ms) 는 7400ms 도 통과 — 위험 **낮음**.

### 5.3 토큰·비용

- planQuery 시스템 프롬프트 ~400자 증가 (R1~R12 매트릭스). 비용 ≈ +5%.
- multi 호출 평균 +0.8 → API 호출 +50% (단가는 도구마다 다름, 평균 +20% 비용).
- LLM 합성 단계 입력 results 증가 → +15% 토큰.

**종합**: 케이스당 비용 +15~25%. 1회 평가(440 case) 기준 절대 영향 미미.

### 5.4 환각 의심 8건 회귀 위험

cat=3 multi 강제 결과 데이터가 늘면 합성 LLM 의 hallucination 표면적 증가. 특히:

- ANG-3-03 "홍도 종합 상황" — 현재 환각 의심 8건 중 1건. multi 강제 후 forecast+warning 둘 다 호출되면 LLM 이 둘을 섞어 더 풍부한 환각 가능.

**완화**: synth 프롬프트의 §환각 금지 룰(L1685) 강화 — "warnings 가 비어있으면 명시적으로 *없음* 보고" 가 이미 존재. P_multitool 단독으로 환각 +/-0 예상.

### 5.5 cat=1·2·5·7·8 회귀 예측표

| cat | 현 | 예상 | Δ | 사유 |
|-----|----|------|---|------|
| 1 기본 | 92% | 92% | 0 | G5 가드로 zone 모호 분기 보호 |
| 2 연속 | 48% | 48~50% | +0~2pp | focus 후속에 R2/R3 어휘 매칭 시 보조 효과 |
| 3 다중 | **68%** | **88~95%** | **+20~27pp** | 12/13 fail 해소 추정 |
| 4 정량 | 75% | 75% | 0 | 별개 축 |
| 5 비도 | 98% | 95~98% | -0~3pp | OVERVIEW_RE 일상어 매칭 위험 (G4 strict 로 완화) |
| 6 메타 | 78% | 78% | 0 | 별개 축 |
| 7 환각 | 95% | 93~95% | -0~2pp | multi 호출 데이터로 합성 환각 표면적 증가 (synth 룰로 완화) |
| 8 변칙 | 98% | 98% | 0 | 별개 축 |

**종합 PASS**: 78% → **82~85%** (DoD ≥85% 마지노선 접근).

---

## 6. 구현 체크리스트 (시점 B 인계)

- [ ] L1448 의 단일 줄 #18 룰을 §2.3 매트릭스(R1~R12) 로 교체.
- [ ] §2.4 우선순위·§3.3 G5 안전판 프롬프트 명시.
- [ ] L1657 의 DOMAIN_RE 옆에 OVERVIEW_RE / ACTIVITY_RE 추가 (§4.2).
- [ ] isDomainQuery 분기에 OVERVIEW_RE || ACTIVITY_RE 추가.
- [ ] §3.2 가드(G1~G5) 는 LLM 측 룰로만 처리 — 결정론 코드 미터치 (회귀 risk 최소).
- [ ] (선택) §5.2 Promise.all 병렬화는 별도 PR.
- [ ] 회귀 검증: 자유변칙 v5 R2 실행 → cat3 ≥ 85%, cat1·5·7 ±2pp 이내 확인.
- [ ] 환각 의심 ≤2 유지 — synth 룰 변경 없음 전제.

---

## 7. 한 줄 요약

핵심 결정: **#18 단일 multi-tool 힌트를 12개 룰(R1~R12)의 매트릭스로 계층화**해 fishing_index+tide·visibility+buoy·midterm·typhoon·depth·zones_ranked 등 cat=3 미커버 6개 특수 결합을 강제하되, **G1(zone 확정) AND G2(활동 어휘) AND G3(직군 매칭) AND G4(DOMAIN_RE)** 의 AND 가드로 zone 모호 질의는 단일 도구를 유지해 cat=1 회귀 0 보장.
