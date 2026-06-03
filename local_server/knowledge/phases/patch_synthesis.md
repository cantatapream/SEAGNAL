# 패치 A + B 종합 — sentinel 잔존 결함 4건 단일 PR 통합 계획

> 입력: `patch_A_continuity_localgov.md` (ANG-2-01b, LG-1-01) + `patch_B_quantitative.md` (LG-4-01, MOF-4-01)
> 본 문서는 **설계 종합만**. 코드·A/B 원안 md 수정 금지. 단일 PR (`feat: sentinel 4 결함 일괄 직타`) 로 묶기 위한 충돌·순서·검증·ROI 정리.

---

## 1. 코드 변경 위치 충돌 점검

### 1.1 변경 표면 정리

| # | 영역 | 함수/블록 | 라인(현재) | 패치 | 변경 성격 |
|---|------|----------|-----------|------|-----------|
| 1 | helper | `buoyToCoords` 신설 | 110 직후 (신규) | A | 신규 함수 (충돌 0) |
| 2 | focus | `deriveFocus` — coords 폴백 | 1271-1294 (내부 if 블록 추가) | A | 기존 블록 내 if 추가 |
| 3 | personal | `buildPersonalContext` — 임계표 trigger 규칙 문자열 | 724 | B | 한 줄 template string 교체 |
| 4 | exec | `TOOL_EXEC.get_warning` — zone 비움 전국 집계 | 1135 | A | 함수 본문 교체 |
| 5 | plan | runBrain — 부이 follow-up 폴백 블록 (§A 2.3) | 1502 직후 (신규) | A | 신규 블록 |
| 6 | plan | runBrain — local_gov "관내" 강제 호출 블록 (§A 4.2) | 1502 직후 (신규, A 의 5 와 인접) | A | 신규 블록 |
| 7 | guard | runBrain — `isDomainQuery` 보강 (§A 4.3) | 1548 | A | 변수 선언 확장 |
| 8 | synth | runBrain — synth prompt 의 "가설·조건문" bullet 추가 (§B 2.2) | 1579 직후 | B | template 라인 1개 추가 |
| 9 | eval | `phase2b_eval_freevar_runner.py` — `DECISION_RE` + `DECISION_RE_WEAK` | 59 | B | 정규식 교체 + 새 변수 |

### 1.2 동일 함수 동시 수정 면

| 함수 | A 의 수정 | B 의 수정 | 충돌 등급 | 머지 처리 |
|------|----------|----------|----------|-----------|
| `buildPersonalContext` (assistant.js:711) | 없음 | 임계표 규칙 강화 (724) | 없음 | B 단독 적용 |
| `runBrain` (1271~1601) | §A2.3+§A4.2+§A4.3 = 3 곳 신규/확장 | §B2.2 = synth template 1 곳 추가 | **있음** (동일 함수, 동일 블록 내 라인 가까움) | 순서 머지: A 의 §2.3/§4.2 블록(1502 직후) → §4.3 (1548 보강) → B 의 synth bullet (1579 직후). 라인 번호 drift 발생하나 영역이 분리돼 git diff 충돌 없음 |
| `TOOL_EXEC.get_warning` | zone 폴백 구현 | 없음 | 없음 | A 단독 |
| `deriveFocus` | coords 폴백 | 없음 | 없음 | A 단독 |
| synth prompt template | 없음 | bullet 추가 | A 의 §A4.3 가 같은 runBrain 함수지만 다른 라인 — git 차원 충돌 없음 | B 단독 |
| `DECISION_RE` (runner.py) | 없음 | 정규식 교체 | 없음 | B 단독 |

### 1.3 식별된 잠재 충돌 (실제 머지 단계 주의)

1. **runBrain 라인 1502 직후 블록 누적 — 변수 스코프 공유**
   A 의 §2.3 부이 폴백 블록과 §4.2 local_gov 블록이 같은 위치(1502 직후)에 *2개 연속* 삽입된다.
   두 블록 모두 `planTools = new Set(plan.steps.map(s => s.tool))` 를 *각자* 계산하는데, §2.3 가 `plan.steps.unshift()` 로 추가한 도구는 §4.2 의 `planTools` 에 자동 반영된다(코드 순서 의존). 머지 시 **§2.3 → §4.2 순서 고정**, `planTools` 변수명 중복 방지를 위해 두 블록 안에서 `const` 로 각각 새 식별자(예: `_buoyPlanTools` / `_lgPlanTools`) 사용 권장. A 원안엔 동일 변수명 — 컴파일 오류 잠재.

2. **§4.2 와 §4.3 가 `VAGUE_LOCAL_RE`·`MONITOR_JIKGUN` 공유**
   §4.3 의 보강이 §4.2 보다 *아래* 라인(1548) 에 위치하지만 두 블록이 같은 정규식을 *각자* 선언하면 중복. A 원안도 §4.3 주석에 "변수 스코프 정리는 구현 시 함수 상단으로" 라고 명시 → runBrain 진입 직후 1회만 선언, 두 블록 공유. **단일 PR 머지 시 이 정리 필수**.

3. **B 의 synth bullet 추가가 A 의 §4.2 결과 의존**
   B §2.2 의 "가설·조건문" bullet 가 효과를 내려면 `results.length ≥ 1` (즉 `get_warning` 또는 `get_marine_forecast` 결과 객체) 가 synth 입력에 있어야 한다. A 의 §4.2 가 LG-4-01 케이스에서 `get_warning(args={})` 를 강제 호출해 빈 트리도 객체로 보냄 → B 의 가설답 bullet 가 "현재 특보 없음" 부기를 자연스럽게 만들 수 있음. **A 와 B 가 같은 PR 에 묶이면 LG-4-01 의 두 결함(빈 도구 결과 + 결정 단어 부재)이 *동시에* 해소됨**. 분리 머지 시 B 만 적용하면 LG-4-01 의 "결정 단어" 는 통과해도 `expect_tools_any: ['get_warning']` 같은 도구 게이트가 함께 있다면 회귀 가능.

4. **`get_warning` 시그니처 변경 (A) 와 synth bullet (B) 의 응답 형태 충돌**
   A 의 §4.4 가 zone 비움 시 `{zone:'전국', activeCount:N, warnings:[...]}` 형태로 키 변경. B 의 §2.2 bullet 는 "현재는 특보 없음" 류 부기를 LLM 에게 맡김. synth 가 새 키(`activeCount`, `warnings[]`)를 잘 해석해야 하는데, 기존 키(`warning:{}`)와 혼재 가능. **회귀 항목**: A 적용 후 zone 있는 호출이 여전히 `{zone, warning}` 형태인지 확인 + B 적용 후 두 형태 모두 자연어로 풀어쓰는지 확인.

### 1.4 결론

- git diff 차원 충돌은 없으나(서로 다른 라인 영역), **runBrain 내부 신규 블록 3개의 변수 스코프 정리**가 단일 PR 머지의 핵심 위생 작업.
- 위 4개의 잠재 이슈 중 #1, #2 는 *반드시* 머지 단계에 처리. #3, #4 는 검증 단계에서 확인.

---

## 2. 회귀 위험 종합

### 2.1 A·B 가 각자 명시한 위험 (요지 재인용)

- **A §5.1 (ANG-2-01b)**: `buoyToCoords` 의 양방향 includes 매칭 오매칭, plan.steps 자동 증가로 토큰/지연 소폭 ↑, get_buoys_with_obs 결과 cap(6) 안전 범위.
- **A §5.2 (LG-1-01)**: `get_warning(zone=null)` 신 키 (`warnings:[]` vs 기존 `warning:{}`) 의 synth 혼동 가능성, monitorOverview 확장으로 web_search 폴백 차단 — 의도된 변화이나 비도메인 검증 필요.
- **B §5.1 (정량)**: 임계표 over-trigger (R1), 가설답이 현재 상태 보고를 덮음 (R2), DECISION_RE 확장 false-positive (R3), 보수 SOP 가 사용자 판단 침해 (R4), short SOP comment 직군(R5), runner-synth drift (R6).

### 2.2 종합·신규 위험 (A·B 가 *함께* 머지될 때만 드러나는 것)

| ID | 위험 | 트리거 조건 | 완화 |
|----|------|------------|------|
| **S1** | A 의 §4.2 가 LG 케이스에 강제로 `get_warning({})` + `get_typhoon_status({})` 2개 도구를 plan 앞뒤로 끼우고, B 의 synth bullet 가 가설답 + 현 상태 부기를 *둘 다* 출력 → 답이 길어져 음성 출력 시간 ↑. KPI 의 답변 길이 게이트(있다면) 회귀 | local_gov + 모호어 + 가설 어휘 동시 매칭 시 (LG-4-01 의 변형 케이스) | B §2.2 의 bullet 가 "2단 구조 *간결히*" 라고 이미 명시. 추가로 synth `cleanAnswer` 단계에서 길이 trim 불필요. |
| **S2** | A 의 §A2.3 부이 폴백이 plan.steps 에 `get_buoys_with_obs` 를 자동 추가 + B 의 임계표 강화가 정량 결정 단어를 강요 → 부이 군집 결과(인근 부이들의 ws 배열)로 LLM 가 SOP 결정을 *각 부이별로* 반복 출력 | ANG-2-01b 의 변형 "거기 풍속 안전해?" 같이 결정 단어 동시 trigger | synth 의 "핵심만 간결" 규칙(1581)이 보조하나, *결정형* + *부이 follow-up* 동시 케이스가 sentinel/freevar 에 적은지 확인. 자유변칙 cat2 ∩ cat4 교집합 케이스 수 점검 권장. |
| **S3** | A 의 `isDomainQuery` 확장으로 web_search 폴백이 더 줄어 비도메인 모니터링 직군 잡담이 "지금 그 정보를 가져오지 못했어요"(환각가드, 1556)로 차단 | local_gov/coast_guard/navy/mof/public_org 사용자가 "어때/상황" 류 비기상 질문 ("회식 어때") | monitorOverview 의 trigger 어휘 ("어때|상황|전반|전체|괜찮") 가 일반적이라 false-positive 위험. **완화**: `VAGUE_LOCAL_RE` 와 결합 (`(VAGUE_LOCAL_RE.test \|\| /어때.../.test)`) 인 점은 OR — *VAGUE 미매칭 + "어때" 단독*도 도메인으로 잡힘. 단일 PR 머지 시 *AND* 로 좁히는 것 권장: `monitorOverview = MONITOR_JIKGUN.has(slug) && VAGUE_LOCAL_RE.test(cq) && /어때\|상황.../.test(cq)`. |
| **S4** | B 의 임계표 강화가 정량 수치 매칭으로 trigger 됨 + A 의 `get_warning({})` 가 전국 집계 결과를 던짐 → LG-4-01 답에 "전국 풍랑특보 N건 + 임계표 SOP 가설답 + 우리 시 미상" 3중 정보가 섞임 | LG-1-01 ∩ LG-4-01 변형 (예: "관내 풍랑특보 시 해수욕장 운영 가능?") | synth 의 "핵심만" + "최종 판단은 선장님 몫" 단일 출력 규칙이 정리. 회귀 시 합성 답이 모호하면 `expect_decision` 단어가 빠질 수 있음 — sentinel 외 자유변칙 시뮬레이션 필요. |
| **S5** | A 의 §A4.4 새 `get_warning` 응답 키(`warnings:[]`, `activeCount`)를 B 의 임계표 bullet 가 "수치"로 오인 (`activeCount: 3` 을 결정 단어 매핑에 끌어쓰는 환각) | local_gov 의 정량 케이스 | B §2.2 bullet 에 "*수치 데이터가 아니라 운용 기준*" 명시 (B §5.2 환각 가드 항목 참조) → 안전. |
| **S6** | runner 의 `DECISION_RE_WEAK` ("운영" 단독) 가 평가만 변경하고 synth 의 단어 채택은 prompt 보강에 의존 → A 단독 머지면 B 의 단어 보강이 빠져 평가 false-pass 가능 | 분리 머지 시나리오 | 단일 PR 묶으면 자연 해소. 만약 PR 분리 시 runner 와 synth prompt 의 어휘 enumeration 을 동기화. |
| **S7** | 단일 PR 의 변경 면이 8 곳 (assistant.js 6 + runner.py 1 + helper 1) → 리뷰 부담 ↑, 리뷰어 한 명이 모든 회귀 함의 추적 어려움 | 머지 운영 | **권장**: 단일 PR 이지만 커밋을 §3 의 6단계 순서로 분리하여 git log 추적성 확보. |

### 2.3 누락된 위험 (A·B 모두 안 다룬 것)

1. **memory · style 누적 효과**: A 의 §A2.3 가 plan.steps 에 도구를 강제 추가하면 `style.zoneCounts` 같은 누적 통계에 zone 이 잘못 카운트될 수 있음 (focus.buoy 만 있는데 `get_buoys_with_obs` 를 추가). 통계 drift 위험 낮으나 장기 사용자 personal context 의 "자주 보는 해역" 이 왜곡 가능.
2. **`needsReplan` (line 1515) 와의 상호작용**: A 의 §A2.3 가 plan.steps 를 늘리면 1차 results 가 6개 cap 에 빨리 도달 → 1회 재계획(line 1515) 이 1차에서 이미 cap 친 경우 추가 도구 실행 안 됨. 의존 위빙 회귀 가능성 (cat 6 다중도구 일부).
3. **TTS 친화 검증**: synth 의 새 bullet 가 "(파고 3m·풍속 14m)" 같이 단위 포함 *수치 괄호 표현* 을 강제 → "초속 N미터" 규칙(1584) 과 충돌 가능. 음성 응답에서 "파고 3m" 가 "삼엠" 으로 어색하게 읽힐 위험 — TTS 정합성 검증 필요.
4. **`detectJikgun(profile)` 호출 비용**: A 의 §A4.2 + §A4.3 가 runBrain 진입마다 `detectJikgun` 을 *2회* 호출. 매우 가벼운 정규식 매칭이라 무영향이지만, 함수 상단에서 1회 캐시 권장.

---

## 3. 적용 순서 · 테스트 단계

### 3.1 권장 커밋 순서 (단일 PR 내, 점진 검증)

| 단계 | 커밋 | 변경 | 단독 회귀 게이트 | 비고 |
|------|------|------|---------------|------|
| **C1** | `helper: add buoyToCoords` | assistant.js:110 직후 | 함수 호출 없음 → 회귀 0. lint·unit 만 | 위험 최저 |
| **C2** | `focus: derive buoy coords from BUOY_BY_ID` | deriveFocus 라인 1271-1294 보강 | sentinel ANG 전 케이스 — focus.coords 신규 채움이 부작용 없는지. 정확 일치 우선 매칭 (`nname === nn`) 적용 | A §2.2 |
| **C3** | `tools: get_warning supports nationwide aggregate` | TOOL_EXEC.get_warning (1135) | sentinel LG 전 케이스 + 기존 zone 호출 회귀 | A §4.4. 응답 키 변동 주의 |
| **C4** | `brain: buoy follow-up fallback for wind/vis/temp` | runBrain §A2.3 블록 (1502 직후) | sentinel ANG-2-01b PASS 확인. CG-2-01b/MOF-6-01b 회귀 | A §2.3. `_buoyPlanTools` 변수명 |
| **C5** | `brain: local_gov vague-area force-call get_warning` | runBrain §A4.2 + §A4.3 (1502 직후 + 1548) | sentinel LG-1-01 PASS 확인. monitorOverview AND-narrowing(§2.2 S3 완화) 적용 | A §4.2/§4.3. `_lgPlanTools` |
| **C6** | `personal: threshold rule accepts numeric/hypothetical` | buildPersonalContext (724) | sentinel MOF-4-01 PASS + 정량 직군 회귀 | B §3.2 |
| **C7** | `synth: hypothetical conditional bullet for SOP` | runBrain synth template (1579 직후) | sentinel LG-4-01 PASS + 결정 단어 출력 확인 | B §2.2 |
| **C8** | `eval: extend DECISION_RE with SOP vocabulary` | phase2b_eval_freevar_runner.py:59 | freevar cat4 PASS 율 변동 측정 | B §4. `DECISION_RE_WEAK` 도입 |

### 3.2 단계별 테스트 가이드

**Stage I — Sentinel 4건 직타 검증 (N=4)**
- ANG-2-01a → ANG-2-01b (2턴): 빈 응답 → "거문도 풍속은 초속 N미터" 또는 인근부이 군집답.
  - 통과 기준: `expect_tools_any` ⊇ {`get_buoy_observation`} (`get_buoys_with_obs` 포함) + `expect_no_halluc` 통과 + 답 ≥ 15자.
- LG-1-01: web_search 폴백 → `get_warning({})` 호출 + 자연어 응답.
  - 통과 기준: `toolsUsed` ⊇ {`get_warning`}, web_search 호출 0회.
- LG-4-01: "현재 발효 풍랑특보 없음" → 가설답 + 부기.
  - 통과 기준: `expect_decision` (확장 후 DECISION_RE 매칭) + `get_warning` 호출.
- MOF-4-01: "정보 없음" → "파고 2m 는 통제 기준 미만 → 통상 운영 권장".
  - 통과 기준: `expect_decision` 매칭.

**Stage II — Sentinel 잔여 16건 회귀 (N=16)**
- 후속 follow-up 쌍 (ANG-2-01a/CG-2-01a/b/MOF-6-01a/b): focus 폴백이 의도외 도구 추가 안 하는지.
- 정량 단정 케이스(`expect_decision`) 외 카테고리: B 의 임계표 over-trigger 없음 확인.
- 비도메인·자기요약·환각가드 케이스: A 의 isDomainQuery 확장이 false-positive 없음 확인 (특히 S3 완화 적용 후).

**Stage III — 평가셋 N=3 회귀**
- `phase2b_sentinel.jsonl` (N=20) 전체 PASS 율: 4 직타 + 16 무영향 = 20/20 목표.
- `phase2b_eval.jsonl` (구 평가셋): 기존 PASS 율 ±2%p.
- `phase2b_eval_freevar.jsonl` (N=440) **cat2 / cat4 우선 + cat1·5 회귀 보증**:
  - cat2 (연속 follow-up) 48%→ 상승 기대 (목표 +10%p).
  - cat4 (정량) 15%→ 70%+ 목표 (B §5.3).
  - cat1 (기본) ±2%p.
  - cat5 (비도메인) ±2%p (S3 완화 적용 시 안정).

**Stage IV — 자유변칙 일부 (N≈20 샘플)**
- 교집합 케이스 직접 샘플: (cat2 ∩ cat4) "거기서 출항해도 돼?" 류 — S2 회귀 점검.
- 모호 LG: "우리 시 관할 풍랑 떴어?" / "관내 출항 가능?" — S4 점검.
- 비도메인 monitorOverview: "회식 어때" / "팀 분위기 어때" (모니터링 직군) — S3 점검.
- TTS 출력 검증: "(파고 3m·풍속 14m)" → TTS 가 자연스레 읽는지 — 누락 위험 #3 점검.

---

## 4. 잔여 결함 — sentinel 4건 외 자유변칙 v3 의 또 다른 약점

A·B 패치 후에도 자유변칙 v3 평가셋(N=440)에서 *남아 있을 가능성이 큰* 결함 유형을 추정:

| 결함 그룹 | 추정 카테고리 | 사례형 | 미해결 이유 |
|----------|------------|--------|------------|
| **G1. 시계열·추세 follow-up** | cat2 (연속) | "거기 파고 점점 세져?" 같은 시계열 비교 후속 | A 의 focus 폴백은 *현재값* 도구만 보강. `get_marine_forecast` 시계열 보강 없음. synth 의 "추세" 규칙(1583)은 도구가 다중 timestep 줄 때만 동작 |
| **G2. 다중 좌표·다해역 비교** | cat6 (다중도구) | "남해 vs 동해 풍속 비교" 같이 두 zone 동시 호출 | planQuery 가 단일 zone 단일 호출 위주. 본 패치는 단일 focus 폴백만 처리 |
| **G3. 시간 표현 모호** | cat3·cat7 (시간) | "내일 오후 거기는?", "이번 주말 출항?" | 시간 파싱·예보 시계열 매핑이 별도 결함. 본 패치 무관 |
| **G4. 정량 + 시간 결합** | cat4 ∩ cat3 | "내일 파고 2m 넘으면 출항 가능?" | B 의 임계표 bullet 가 가설 조건은 잡으나 *내일 예보 수치* 와 매칭은 별도. 일부 부분 해소 가능, 완전 해소 X |
| **G5. 직군 정책 SOP 깊이** | cat4 | fishery·angler 의 *야간 보수화*, marine_leisure 의 *입수 통제 세부 기준* | 임계표 comment 가 짧은 직군(B §5.1 R5)은 가설답이 빈약. 추가 SOP 데이터 보강 필요 |
| **G6. 환각 - 정책 단정형** | cat5·cat7 | "어선법 제N조 알려줘" 류. web_search 결과를 그대로 채택 위험 | synth 의 "비기상·비도메인 정보 거절" 규칙(1577) 있으나 회피 환각 잔존 가능 |
| **G7. `nname` normalize 한계** | cat2 | "거기" 가 *이전이전* 턴의 부이를 가리키는 3턴 이상 follow-up | A 는 직전 1턴 focus 만 사용. memory 깊이 회귀 |
| **G8. 코드 변경 외 데이터 결함** | cat1·cat4 | 부이 ws 결측, 단기예보 zone 미지원 도서 등 | 본 패치 범위 밖 — 데이터 파이프라인 별도 |

→ 본 단일 PR 후 다음 phase 우선순위 후보: **G2 (다중 zone) + G4 (정량×시간) + G7 (3턴+ follow-up)**.

---

## 5. ROI 추정

### 5.1 가설 검증 — sentinel 80% → 95% 가능?

**현재 sentinel PASS 율 추정 (N=20, 4건 실패):** 16/20 = **80%**.

**패치 후 시나리오:**

| 시나리오 | 가정 | 결과 | PASS율 |
|---------|------|------|--------|
| **낙관** | 4건 모두 직타 해소 + 회귀 0 | 20/20 | **100%** |
| **현실** | 4건 중 3건 해소 (예: MOF-4-01 의 `get_marine_forecast` 빈 결과로 임계표만 trigger 됐는데 다른 케이스에서 trigger 미발동 1건 잔존) + 회귀 0 | 19/20 | **95%** |
| **보수** | 4건 중 3건 해소 + 회귀 1건 (예: S3 monitorOverview 가 모니터링 직군 비도메인 케이스 1건을 도메인으로 잘못 잡아 환각가드 차단) | 18/20 | **90%** |
| **비관** | 4건 중 2건만 해소 + 회귀 1건 (B 의 가설답이 결정 단어를 못 만들거나 A 의 §4.2 가 LG 다른 케이스에 영향) | 17/20 | **85%** |

→ **현실 시나리오에서 95% 달성 가능**. 단, "*낙관* = 100%" 는 회귀 0 가정이 강하므로 95% 가 SLA 측 약속선으로 적정.

### 5.2 자유변칙 KPI 영향 (가설)

| 카테고리 | 현재 PASS율 (추정) | 패치 후 목표 | Δ |
|---------|------------------|------------|---|
| cat1 기본 | ~85% | ~85% (±2pp) | 0 |
| cat2 연속 | ~48% | ~58-65% | +10~17pp (A §A2.3 효과) |
| cat3 시간 | ~50% | ~50% | 0 (G3 미해결) |
| cat4 정량 | ~15% | ~60-70% | +45~55pp (B 핵심 효과) |
| cat5 비도메인 | ~80% | ~78-82% (±2pp) | 0~−2pp (S3 위험) |
| cat6 다중도구 | ~40% | ~40% | 0 (G2 미해결) |
| cat7 환각가드 | ~60% | ~60% (±2pp) | 0 |
| cat8 직군 SOP | ~30% | ~40% | +10pp (B comment 강화 효과) |

**가중 평균(8 카테고리 균등 가정): 51% → 60% 이상 (+9pp).** issue #21 KPI (cat4 70%+) 와 정합.

### 5.3 코스트

- **개발**: 6 커밋 × 평균 30분 = 약 3시간. 변수 스코프 정리·테스트 포함 5시간.
- **테스트**: sentinel 1라운드 5분 + freevar 1라운드 약 45분(440 × 6s). 2회전 ≈ 100분.
- **런타임 비용**: plan.steps 자동 추가 → 도구 호출 1-2건 ↑, 평균 응답 토큰 5-15% ↑, p95 응답 시간 +50-150ms 추정 (단일 도구 평균 80ms).
- **유지보수**: monitorOverview·VAGUE_LOCAL_RE·MONITOR_JIKGUN 등 신규 정규식·상수 6개 — 추후 직군 추가 시 동기 갱신 필요.

### 5.4 결론

- sentinel 80%→95% **현실 시나리오에서 달성 가능 (단, S3 완화 적용 조건)**.
- freevar 종합 PASS율 +9pp, cat4 특히 +45~55pp.
- 단일 PR 의 ROI 는 매우 높음. 단, 잠재 회귀 7건(S1~S7)을 Stage II~IV 회귀로 차단해야 함.

---

## 6. 단일 PR 체크리스트

- [ ] runBrain 신규 변수 (`VAGUE_LOCAL_RE`, `MONITOR_JIKGUN`, `_buoyPlanTools`, `_lgPlanTools`) 함수 상단 1회 선언
- [ ] `buoyToCoords` 정확 일치 우선 매칭 (`nname === nn` → includes)
- [ ] `get_warning` 응답 키 호환성 (`{warning}` vs `{warnings, activeCount}`) 양쪽 synth 검증
- [ ] monitorOverview = AND-narrowed (S3 완화)
- [ ] DECISION_RE 어휘 ↔ synth bullet 어휘 동기화
- [ ] sentinel 20/20 PASS
- [ ] freevar cat4 ≥ 60%, cat5 ±2pp
- [ ] TTS 음성 출력 샘플 검증 ("파고 3m" 표기)
- [ ] 자유변칙 교집합 케이스 10건 수동 점검 (cat2∩cat4, LG×정량, monitor직군×비도메인)
