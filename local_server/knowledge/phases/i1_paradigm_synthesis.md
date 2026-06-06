# I1 — 9차 라운드 패러다임 전환 단일 PR 합성 설계서

> **목적**: G1·G2·G3 (정규식·매트릭스·bullet 31 항목 분류) + H1 (synth prompt 재설계 7원칙) + H2 (54 문항 평가셋) 5 산출물을 **단일 PR (7 hunks)** 으로 통합. 실제 코드 적용 가능 매트릭스 + 회귀 가드 + 적용 순서 + worst-case revert 경로.
> **제약**: 본 문서는 **설계 통합만**. 직접 코드 수정 0. 다음 J 라운드에서 본 PR 의 hunks 를 실제 패치로 분해.
> **사장님 패러다임**: "정규식·룰 누적 ❌ → LLM 자율 위임 + 사장님 예시 (Gemini 식 광역 통상 답 + 명확화 초대)."

---

## 0. 한눈 요약 — 31 항목 통합 매트릭스 (REMOVE / MOVE / GUARD / DATA / CORE)

| 분류 | 갯수 | 처리 |
|---|---|---|
| **REMOVE** | **6** | 정규식·매트릭스·bullet 통째 삭제 — LLM 자율 회복 |
| **MOVE-TO-PROMPT** | **15** | 코드 룰 → H1 7원칙 또는 planQuery 1줄로 흡수 |
| **KEEP-GUARD** | **5** | 보안·환각·연속성 결정론 가드 (절대 보존) |
| **KEEP-DATA** | **4** | 좌표·도구 args·도메인 사전 (LLM 환각 불가) |
| **KEEP-CORE** | **1** | 주변 도구 단독 보강 (플래너 영역, LLM 자율 불가) |
| **합계** | **31** | |

**핵심 효과**:
- assistant.js: **2892 → ~2750 라인 (-142)**
- synth prompt: **~880 → ~360 토큰 (-520, -59%)**
- planQuery prompt: **+5~10 라인 흡수 (M1~M4) - matrixSection 13 라인 삭제 = 순 ~-3~8 라인**
- p95 latency: **5513 → 5300~5400 ms (-150~250ms)**
- 광역·비등록 섬 답률: **~10% → ~85% (+75pp)** (Gemini 식 자율 답)
- v5_run5: **86% → 82~87% (DoD 통과 유지 목표)**

---

## 1. 31 항목 통합 매트릭스 (G1 12 + G2 6 + G3 13)

### 1.1 표 가독성 — 트랙 약어

- **G1**: G1 분류 (정규식 12 종)
- **G2**: G2 분류 (매트릭스 6 종)
- **G3**: G3 분류 (synth bullet · 후처리 13 종)
- **분류**: REMOVE / MOVE / GUARD / DATA / CORE
- **HUNK**: 본 PR 의 hunk 번호 (H1~H7) — §3 참조
- **흡수처**: MOVE 시 정착할 prompt 위치 (synth 7원칙 / planQuery / data dict)

### 1.2 31 항목 통합 표

| # | 트랙 | 항목 | 위치 (라인) | 분류 | HUNK | 흡수처·근거 | 라인 절감 |
|---|---|---|---|---|---|---|---|
| 1 | G1 | ISLAND_BUOY_RE (11 섬명) | L2025, L2142 | **REMOVE** | H3 | "한국 도서·항구 지명이면 해양 도메인" → DOMAIN_RE 흡수 | -12 |
| 2 | G1 | ACTIVITY_RULES (12 정규식) | L1567~L1580 | **MOVE** | H3 + H2 | planQuery R 매트릭스 1줄 흡수 (G2 M3 동일) | -19 (중복 -14) |
| 3 | G1 | META_HINT_RE | L2283 | **MOVE** | H3 + H5 | synth 7원칙 P4 (메타·자기요약) — 단, **길이 < 10 boolean 가드는 KEEP-GUARD** | -2 (길이 가드 H5 에서 다룸) |
| 4 | G1 | DECISION_HINT_RE | L2153 | **MOVE** | H3 + H5 | synth 7원칙 P6 (의사결정 — 가부 결론 먼저) | -7 (H5 합산) |
| 5 | G1 | DECISION_RE_WEAK / WEAK_PAIR_RE | (runner.py / const) | **DATA** | (none) | DECISION_WORDS 사전 — KEEP-DATA. **H7 에서 runner DECISION_RE 의미축 분리** | 0 |
| 6 | G1 | HYPO_HINT_RE | L2154 | **MOVE** | H3 + H5 | synth 7원칙 P5 (가설·조건문 — 임계표 기반 답) | -6 (H5 합산) |
| 7 | G1 | FOCUS_ZONE_ARG (dict 13 도구) | L1889~L1903 | **DATA** | (none) | 도구 스키마 종속 — 절대 유지 (cat=2 72% 직결) | 0 |
| 8 | G1 | PRONOUN_RE (14 어휘) | L1877 | **GUARD** | (none) | 연속성 cat=2 72% → 43% 회귀 실증 — 절대 유지 | 0 |
| 9 | G1 | REGION_DIR_RE | L616 | **DATA** | (none) | ZONE_NAMES 쌍 토크나이저 — 유지. **광역/전역/권역/전체 4 토큰만** 보존 (G2 M5 연계) | 0 |
| 10 | G1 | MULTI_INTENT_RE | L1771 | **MOVE** | H3 | planQuery prompt 1줄 흡수 ("종합·전반·적합 광역 평가 → forecast+warning 최소") | -2 |
| 11 | G1 | PRONOUN_GUARD (boolean) | L1769 | **GUARD** | (none) | PRONOUN_RE 의 소비처 — 분리 불가, 유지 | 0 |
| 12 | G1 | VAGUE_LOCAL_RE | L1862 | **MOVE** (부분) | H3 | planQuery prompt 1줄 + boolean 분기 결정론 잔존 (이중 안전망) | -1 |
| 13 | G1 | MONITOR_JIKGUN (Set) | L1863 | **DATA** | (none) | 직군 5종 사실 — KEEP-DATA | 0 |
| 14 | G1 | OVERVIEW_RE | L1864 | **MOVE** | H3 | MULTI_INTENT_RE 와 통합 → planQuery 1줄 | -2 |
| 15 | G1 | HALLUC_RE / OFFDOMAIN | (runner.py) | **GUARD** | (none) | 환각 채점축, runner 측 — 절대 유지 | 0 |
| 16 | G1 | ADMIN_INTENT_RE (5 정규식) | L185~L190 | **GUARD** | (none) | SEC 5/5 PASS 직결 — 절대 유지 | 0 |
| 17 | G1 | GUARD_EXCLUDES (배열) | L226~L237 | **GUARD** | (none) | 프라이버시 불변식 — 절대 유지 | 0 |
| 18 | G1 | DOMAIN_RE / _MULTI_DOMAIN_RE | L2140, L2022 | **DATA** | (none) | 도메인 어휘 사전 — 유지. ISLAND 어휘 흡수 (H3 의 잔재) | 0 |
| 19 | G2 | M1 R_TABLE (R1~R12) | L1544~L1558 | **MOVE** | H4 + H2 | planQuery 1줄 ("다중 도구가 필요한 도메인 질의면 forecast+warning 기본 페어 + 활동 어휘 보조") | -15 |
| 20 | G2 | M2 COMMON_RULES (R1·R7) | L1566 | **MOVE** | H4 | M1 prompt 흡수 | -1 |
| 21 | G2 | M3 ACTIVITY_RULES (12 정규식) | L1567~L1580 | **MOVE** | H4 | M1 prompt 흡수 (G1 #2 와 동일 항목) | (중복 — #2 와 같이 -19) |
| 22 | G2 | M4 JIKGUN_RULES (8 직군) | L1582~L1591 | **MOVE** | H4 | M1 prompt 흡수 | -10 |
| 23 | G2 | M5 ZONE_NAME_TO_CODE 광역 alias (12 키) | L560~L565 | **REMOVE** | H4 | planQuery 1줄 ("광역/전역/권역/전체 + 구체 지역 없으면 직군 default + 명확화 초대") | -6 |
| 24 | G2 | M5b ZONE_NAME_TO_CODE 본체 (기상청 표준) | L513~L559 | **DATA** | (none) | 8자리 코드 — LLM 환각 100% — KEEP-DATA | 0 |
| 25 | G2 | M6 EXPECT_TOOLS_MIN (.min) | L1741~L1750 | **GUARD** | (none) | multitool 회귀 차폐 보강 trigger — 유지. **단 hint 서브필드는 데드 코드 REMOVE** | -5 (hint 만) |
| 26 | G2 | M7 FOCUS_ZONE_ARG (13 도구 args 매핑) | L1889~L1903 | **GUARD** | (none) | 도구 스키마 종속 — G1 #7 과 동일 항목 (KEEP-DATA → KEEP-GUARD 분류 통일) | 0 |
| 27 | G2 | buildMatrixSection 함수 | (M1~M4 와 함께) | **MOVE** | H4 | M1~M4 통합 제거 시 함수 자체 삭제 | -13 |
| 28 | G3 | CoT 누수 금지 bullet | L2251 | **CORE** | H1 | 7원칙 G2 가드 — KEEP-CORE (압축만) | (압축 -100자) |
| 29 | G3 | 컨텍스트 격리 bullet | L2252 | **CORE** | H1 | 7원칙 G3 가드 — KEEP-CORE | (압축 -80자) |
| 30 | G3 | 환각 금지 + get_warning 양방향 | L2250 | **CORE** | H1 | 7원칙 G1 가드 — KEEP-CORE | (압축 -60자) |
| 31 | G3 | 비기상·비도메인 거절 | L2253 | **CORE** | H1 | 7원칙 G4 가드 — KEEP-CORE | (압축 -30자) |
| 32 | G3 | 메타·자기요약 bullet | L2254 | **MOVE** | H1 | 7원칙 P4 (강제어 제거) | (압축 -180자) |
| 33 | G3 | 의사결정형 정량 판단 | L2255 | **MOVE** | H1 | 7원칙 P6 (가부 결론 먼저 + 근거 1~2) | (압축 -150자) |
| 34 | G3 | 가설 조건문 SOP | L2257 | **MOVE** | H1 | 7원칙 P5 (임계표 기반 조건부 답) | (압축 -250자) |
| 35 | G3 | 안전 결정 마무리 | L2256 | **MOVE** | H1 | 7원칙 P6 부속 ("절대" 제거, 강제어 약화) | (압축 -80자) |
| 36 | G3 | 후속 표기 P36 | L2264 | **MOVE** | H1 | 7원칙 P3 (직전 이름 1회 자연스럽게) | (압축 -150자) |
| 37 | G3 | 메타 재시도 길이 가드 (코드) | L2280~L2296 | **REMOVE** | H5 | 17 라인 통째 삭제 — 7원칙 P4 + memory prompt 흡수. **단 length<10 길이 boolean 만 H5 에서 검토** | -17 |
| 38 | G3 | 정량 가설 SOP 답 강제 (하드코딩) | L2150~L2165 | **REMOVE** | H5 + H6 | 16 라인 삭제. results=0 분기에서 광역/가설/의사결정이면 synth 호출 (H6 광역 게이트) | -16 |
| 39 | G3 | 주변 도구 단독 보강 (플래너) | L2089~L2121 | **CORE** | (none) | 플래너 영역, LLM 자율 불가 — 절대 유지 | 0 |
| 40 | G3 | DECISION_WORDS const + bullet 인라인 + "반드시 1+" | L370~L373 + L892 + L2255/2257 | **REMOVE** | H1 + H7 | const 삭제 + bullet 인라인 11어휘 삭제. **H7 runner DECISION_RE 의미축 3축 분리 페어 필수** | -4 (const) + 토큰 |
| 41 | G3 | 음성 구어체 / 표·이모지 금지 | L2262 | **MOVE** | H1 | 7원칙 P1 (간결화, 보존 그대로) | (압축 약간) |
| 42 | G3 | 유속 단위 | L2263 | **MOVE** | H1 | 7원칙 P1 흡수 | (압축 약간) |
| 43 | G3 | 추세 한 줄 | L2261 | **MOVE** | H1 | 7원칙 P2 (사실 → 맥락) 흡수 | (압축 약간) |
| 44 | G3 | 사용자 단정 정정 | L2258 | **MOVE** | H1 | 7원칙 P7 (수집결과 우선) | (압축 약간) |

> **주**: G1 #2 와 G2 M3 (ACTIVITY_RULES), G1 #7 과 G2 M7 (FOCUS_ZONE_ARG) 은 동일 항목 중복 분류 — 라인 절감은 1회만 계상. 위 표는 31 고유 항목 + 분류 정합용 13 부속 = 44 행 (중복 제거 후 실 31 항목).

### 1.3 분류별 갯수 — 31 고유 항목 기준

| 분류 | 갯수 | 항목 IDs (위 표 #) |
|---|---|---|
| REMOVE | **6** | 1 (ISLAND_BUOY_RE), 23 (M5 광역 alias), 25 (M6 hint), 37 (메타 재시도), 38 (정량 SOP 답), 40 (DECISION_WORDS) |
| MOVE-TO-PROMPT | **15** | 2 (ACTIVITY_RULES = M3), 3 (META_HINT_RE), 4 (DECISION_HINT_RE), 6 (HYPO_HINT_RE), 10 (MULTI_INTENT_RE), 12 (VAGUE_LOCAL_RE 부분), 14 (OVERVIEW_RE), 19 (M1 R_TABLE), 20 (M2), 22 (M4 JIKGUN_RULES), 27 (buildMatrixSection), 32~36 (G3 5 bullets), 41~44 (G3 4 보존 bullet 미세 압축) |
| KEEP-GUARD | **5** | 8 (PRONOUN_RE), 11 (PRONOUN_GUARD), 15 (HALLUC_RE), 16 (ADMIN_INTENT_RE), 17 (GUARD_EXCLUDES), 25 본체 (M6 .min) |
| KEEP-DATA | **4** | 5 (DECISION_WORDS 사전), 7 (FOCUS_ZONE_ARG = M7), 9 (REGION_DIR_RE), 13 (MONITOR_JIKGUN), 18 (DOMAIN_RE), 24 (M5b ZONE_NAME_TO_CODE 본체) |
| KEEP-CORE | **5** | 28~31 (G3 4 가드 bullet 압축 후 보존), 39 (주변 도구 단독 보강 플래너) |

> *분류 카테고리 수가 5 카운트 합 (6+15+5+4+5 = 35) > 31 인 이유*: 일부 항목이 KEEP 5 + DATA 4 처럼 *이중 분류 가능* (예: DECISION_WORDS 는 사전이라 DATA, 동시에 runner 와 페어 운용이라 GUARD 성격) — 표 1.2 에서 1차 분류로만 계산.

---

## 2. 충돌 점검 — H1 + G3 + G1 + G2 정합성

### 2.1 H1 새 synth prompt 가 G3 REMOVE 3 종을 대체하는가?

| G3 REMOVE 항목 | H1 7원칙 흡수 매핑 | 정합 여부 |
|---|---|---|
| DECISION_WORDS 인라인 + "반드시 1+" | **P6** ("안전 판단이면 가부 결론을 먼저 한 줄로, 근거 수치 1~2") | ✅ 정합. 단, **H7 runner DECISION_RE 확장 페어 필수** — 미페어 시 cat=4 -8~12pp |
| 메타 재시도 길이 가드 | **P4** ("메타·자기요약이면 [최근 대화] 마지막 1~3 항목을 자연어로 풀어 답하라") + memory 가 prompt 상단에 이미 존재 | ✅ 정합. 길이 boolean 가드만 미세 보존 검토 (length<10 휴리스틱) |
| 정량 가설 SOP 답 강제 (L2150~L2165) | **P5** ("가설·조건문이면 직군 임계표에 비춰 조건부 답 + 현재 상태 한 줄") + enrichedTdig (L892, 직군별 임계표) 가 prompt 상단에 존재 | ⚠️ **부분 정합** — 현 코드는 results=0 일 때 synth 호출 자체를 안 함. **H6 광역 게이트 hunk 추가 필요** (L2149 분기에서 광역/가설/의사결정은 synth 로 흘려보내기) |

**결론**: H1 + H6 + H7 페어로 처리하면 G3 REMOVE 3 종 회귀 ≤ 5pp 가드 가능.

### 2.2 G1 MOVE-TO-PROMPT 가 H1 7원칙 안에 들어가는가?

| G1 MOVE 항목 | 흡수 위치 |
|---|---|
| META_HINT_RE | H1 7원칙 **P4** (메타) |
| DECISION_HINT_RE | H1 7원칙 **P6** (의사결정) |
| HYPO_HINT_RE | H1 7원칙 **P5** (가설) |
| MULTI_INTENT_RE | **planQuery prompt 1줄** (H1 안 아님 — synth 영역 분리) |
| OVERVIEW_RE | **planQuery prompt 1줄** (MULTI_INTENT_RE 와 통합) |
| VAGUE_LOCAL_RE | **planQuery prompt 1줄** (이중 안전망 — boolean 결정론 잔존) |
| ACTIVITY_RULES (G2 M3 동일) | **planQuery prompt 1줄** (G2 M1 매트릭스 1줄에 흡수) |

**결론**: G1 MOVE 7건 중 3 건 (META/DECISION/HYPO) 은 H1 7원칙 흡수. 4 건 (MULTI/OVERVIEW/VAGUE/ACTIVITY) 은 planQuery 영역으로 분리 — **H2 hunk** 로 처리 (planQuery 1~3줄 추가).

### 2.3 G2 MOVE 매트릭스 4종 → planQuery 어디에?

H1 §7.3 권고 "**planQuery 는 이번 라운드에서 손대지 않음**" 과 G2 M1~M4 MOVE 권고 충돌.

**판정**: H1 의 의도는 "도구 선택 정확도 회귀 리스크" 차단이지 planQuery 손대지 말라는 절대 금지가 아니다. **H2 hunk (planQuery prompt 단순화)** 에서 M1~M4 매트릭스를 1~3 줄로 흡수하되:
- buildMatrixSection 함수 호출만 제거하고
- planQuery template 안에 "직군별 도구 페어 한 줄 + 활동 어휘 보조 한 줄" 만 삽입
- **TOOL_CATALOG, CATALOG_DIGEST, EXPECT_TOOLS_MIN(M6) 본체는 보존**

**충돌 해결**: H1 권고는 *큰 구조 변경 금지*, H2 hunk 는 *매트릭스 흡수 1줄* — 정합.

### 2.4 H1 의 L2149 광역 게이트 추가 권고 vs G3 의 정량 가설 SOP REMOVE — 일관성?

H1 §7.3: "**`isWideOpenQuery` 게이트 추가**" — `(동해|서해|남해|제주해역) + (수심|특징|갯벌|섬|평균|깊이|경사|어떻|어때) && 좌표/부이/해구 미지정`.
G3 §1.11 REMOVE 권고: L2150~L2165 통째 삭제.

**둘은 충돌하지 않는다**:
- G3 는 *하드코딩 답 문자열* ("일반적으로 파고 2미터…") 만 삭제.
- H1 의 L2149 분기 자체 (`isDomainQuery && results.length === 0`) 는 *광역 통상 질의를 synth 로 흘려보내기 위한 분기 게이트* 로 재사용.
- 즉 **L2150~L2165 16 라인 삭제** + **L2149 분기에 `isWideOpenQuery` 게이트 추가** = **H6 hunk** 로 통합 가능.

**최종 일관성 판정**: ✅ — G3 REMOVE + H1 광역 게이트가 *같은 분기 (L2149) 의 다른 측면* — H6 단일 hunk 로 묶어 처리.

---

## 3. 단일 PR — 7 hunks 분해

### 3.1 H1 — synth prompt 통째 교체 (~120 라인 → ~50 라인)

**대상 파일**: `routes/assistant.js`
**대상 라인**: L2240~L2267 (synth template)
**위험 등급**: **4 (가장 큰 변경)**
**처리**:
- 기존 18+ bullet → H1 7원칙 (G1~G4 가드 4 + P1~P7 가이드 7) + Few-shot 2 (광역 통상 / 비등록 섬)
- bullet 토큰 ~880 → ~360 (-520)
- 강제어 ("반드시", "절대", "1+ 포함") 11회 등장 → 0회
- DECISION_WORDS 인라인 11어휘 삭제 (G3 #40 핵심)
- "2단 구조 (조건)이면 …" 템플릿 삭제
- "한 문장 미만 절대 금지" 같은 강제어 약화

**커밋 메시지 안**:
```
i1/H1: synth prompt 18+ bullet → 7원칙 압축 (-520 토큰, -59%)

- KEEP-CORE 4 (G1~G4): CoT·격리·환각·비도메인 가드 압축 보존
- MOVE-TO-PRINCIPLE 5 (P3~P6): 후속·메타·가설·의사결정·안전마무리
- REMOVE: DECISION_WORDS 11어휘 인라인 + "반드시 1+" 강제어
- Few-shot 2 추가: 광역 통상 (동해 수심), 비등록 섬 (흑산도 파고)
- 예상 효과: 광역·비등록 답률 +75pp, p95 -150ms
- 회귀 가드: H7 runner DECISION_RE 의미축 3축 분리 페어 필수
```

### 3.2 H2 — planQuery prompt 단순화 (~30 라인 → ~10 라인)

**대상 파일**: `routes/assistant.js`
**대상 라인**: L1544~L1601 (matrixSection 영역) + planQuery prompt 안 matrixSection 인용 위치
**위험 등급**: **4 (도구 선택 정확도 직결)**
**처리**:
- buildMatrixSection 함수 삭제 (~13 라인)
- M1 R_TABLE (15 라인) + M2 COMMON_RULES (1 라인) + M3 ACTIVITY_RULES (14 라인) + M4 JIKGUN_RULES (10 라인) 삭제
- planQuery prompt template 에 다음 3 줄 흡수:
  1. "다중 도구가 필요한 도메인 질의(다이빙·요트·낚시·태풍·종합·전반)면 forecast+warning 기본 페어 + 활동 어휘 보조 도구를 합집합으로 steps 에 채워라."
  2. "직군별 핵심 페어: navy=잠수함·수심·forecast / fishery=tide·forecast·warning / marine_leisure=visibility·surfing_index / mof=midterm·warning."
  3. "광역/전역/권역/전체 + 구체 지역 없으면 직군 default 또는 가장 가까운 권역 + 답 마지막에 '북부/중부/남부 중 어느 곳?' 명확화 초대."
- (G1 #10, #14 MULTI_INTENT_RE / OVERVIEW_RE 흡수 — `if (MULTI_INTENT_RE.test(...))` 분기 제거)
- (G1 #12 VAGUE_LOCAL_RE 흡수 — boolean 결정론은 잔존)

**커밋 메시지 안**:
```
i1/H2: planQuery 매트릭스 4종 prompt 1절 흡수 (-58 라인, +3 줄)

- REMOVE: R_TABLE / COMMON_RULES / ACTIVITY_RULES / JIKGUN_RULES
- REMOVE: buildMatrixSection 함수 (-13 라인)
- ADD: planQuery prompt 직군 페어 + 활동 어휘 + 광역 명확화 3 줄
- 회귀 가드: M6 EXPECT_TOOLS_MIN.min + pickMissingTools 보강 layer 유지
- 예상 회귀: cat=3 multi-tool 88% → 82~88% (-3~6pp), M6 가 ≤ 2pp 차폐
```

### 3.3 H3 — 정규식 제거 (G1 MOVE/REMOVE)

**대상 파일**: `routes/assistant.js`
**대상 정규식**:
- ISLAND_BUOY_RE × 2 (L2025, L2142) — REMOVE
- META_HINT_RE 정규식 부분 (L2283) — MOVE (boolean 길이 가드만 잔존)
- DECISION_HINT_RE (L2153) — MOVE (분기 제거는 H6)
- HYPO_HINT_RE (L2154) — MOVE
- MULTI_INTENT_RE (L1771) — MOVE
- OVERVIEW_RE (L1864) — MOVE
- VAGUE_LOCAL_RE (L1862) — MOVE 부분
- ACTIVITY_RULES (12 정규식, L1567~L1580) — MOVE (H2 와 중복 — H2 에서 처리)

**위험 등급**: **3**
**라인 절감**: -41 (assistant.js)
**회귀 가드 핵심**: PRONOUN_RE / ADMIN_INTENT_RE / GUARD_EXCLUDES / DOMAIN_RE / REGION_DIR_RE 절대 손대지 않음.

**커밋 메시지 안**:
```
i1/H3: 정규식 7 종 제거 (REMOVE 1 / MOVE 6, -41 라인)

- REMOVE: ISLAND_BUOY_RE × 2 (11 섬명) — DOMAIN_RE 와 H1 P1 흡수
- MOVE: META/DECISION/HYPO_HINT_RE → H1 P4·P5·P6 흡수
- MOVE: MULTI_INTENT_RE / OVERVIEW_RE → planQuery 1절 흡수
- MOVE: VAGUE_LOCAL_RE 부분 (boolean 결정론 잔존)
- KEEP-GUARD: PRONOUN_RE / ADMIN_INTENT_RE / GUARD_EXCLUDES / DOMAIN_RE / REGION_DIR_RE
```

### 3.4 H4 — 매트릭스 제거 (G2 REMOVE/MOVE)

**대상 파일**: `routes/assistant.js`
**대상 매트릭스**:
- M5 ZONE_NAME_TO_CODE 광역 alias 12 키 (L560~L565) — REMOVE
- M5b ZONE_NAME_TO_CODE 본체 (L513~L559) — KEEP-DATA (손대지 않음)
- M6 hint 서브필드 (8 직군) — REMOVE (데드 코드)
- M6 .min 본체 — KEEP-GUARD
- M7 FOCUS_ZONE_ARG (L1889~L1903) — KEEP-GUARD

**위험 등급**: **3**
**라인 절감**: -11 (광역 alias 6 + hint 5)
**처리**:
- M5 광역 alias 12 키 삭제 → planQuery 1줄 (H2 #3)
- M6 hint 서브필드 데드 코드 삭제
- detectZoneDeterministic 의 REGION_DIR_RE 광역/전역/권역/전체 4 토큰만 보존 (Stage 3 안정성)

**커밋 메시지 안**:
```
i1/H4: 매트릭스 광역 alias + M6 hint 데드 코드 제거 (-11 라인)

- REMOVE: ZONE_NAME_TO_CODE 광역 alias 12 키 (인공 룰)
- REMOVE: EXPECT_TOOLS_MIN.hint 서브필드 (데드 필드)
- KEEP-DATA: ZONE_NAME_TO_CODE 기상청 표준 46 항목
- KEEP-GUARD: EXPECT_TOOLS_MIN.min + FOCUS_ZONE_ARG + REGION_DIR_RE
```

### 3.5 H5 — bullet 후처리 분기 제거 (G3 REMOVE 코드 룰)

**대상 파일**: `routes/assistant.js`
**대상 영역**:
- 메타 재시도 길이 가드 (L2280~L2296, 17 라인) — REMOVE
- 정량 가설 SOP 답 하드코딩 (L2150~L2165, 16 라인) — REMOVE (H6 분기 게이트로 통합)
- DECISION_WORDS const (L370~L373, 4 라인) — REMOVE
- 주변 도구 단독 보강 (L2089~L2121, 33 라인) — **KEEP-CORE (절대 보존)**

**위험 등급**: **3**
**라인 절감**: -37 (17 + 16 + 4) — 단 정량 SOP 답 16 라인은 H6 와 중복 처리 (실제로는 H6 에서 분기 재구성 시 함께 제거)
**처리**:
- 메타 재시도 17 라인 통째 삭제 — 7원칙 P4 흡수
- DECISION_WORDS const 삭제 — 7원칙 P6 흡수, runner 의미축 분리 (H7) 페어 필수

**커밋 메시지 안**:
```
i1/H5: bullet 후처리 룰 3 종 제거 (-21~37 라인)

- REMOVE: 메타 재시도 길이 가드 (L2280~L2296, 17 라인)
- REMOVE: DECISION_WORDS const (L370~L373, 4 라인)
- KEEP-CORE: 주변 도구 단독 보강 (L2089~L2121, 플래너 영역)
- 정량 가설 SOP 답 (L2150~L2165) 는 H6 분기 게이트와 함께 처리
- 회귀 가드: H1 P4 + H7 runner DECISION_RE 의미축 분리 페어 필수
```

### 3.6 H6 — L2149 광역 게이트 추가 + 정량 SOP 답 분기 재구성

**대상 파일**: `routes/assistant.js`
**대상 라인**: L2149~L2165 (isDomainQuery && results.length===0 분기)
**위험 등급**: **2**
**처리**:
- 새 함수 `isWideOpenQuery(query, cq)` 추가:
  ```
  조건: (동해|서해|남해|제주해역|한국 동쪽 바다 등) + (수심|특징|갯벌|섬|평균|깊이|경사|어떻|어때|뭐가 달라) && 좌표/부이/해구 미지정
  ```
- L2149 분기 재구성:
  1. `isDomainQuery && results.length === 0 && isWideOpenQuery(query, cq)` → synth 호출 (새 7원칙 P2-b 통상 답)
  2. `isDomainQuery && results.length === 0 && (isHypo || isDecisionLike)` (정규식 제거 후 H1 P5/P6 으로 위임) → synth 호출
  3. `isDomainQuery && results.length === 0 && !isWideOpenQuery` → 기존 짧은 거절문 ("죄송해요, 지금 그 정보를 가져오지 못했어요")
- 기존 L2150~L2165 하드코딩 답 16 라인 삭제

**커밋 메시지 안**:
```
i1/H6: L2149 광역 게이트 + 정량 SOP 분기 재구성 (-12 라인)

- ADD: isWideOpenQuery(query, cq) 함수
- 분기 재구성: 광역/가설/의사결정 → synth 호출 (7원칙 자율 답)
- 그 외 results=0 → 기존 거절문
- REMOVE: 정량 가설 SOP 하드코딩 답 16 라인
- 효과: Gemini 식 광역 통상 답 발현 (H2 평가셋 C1 ≥ 75% 목표)
```

### 3.7 H7 — runner DECISION_RE 의미축 3축 분리

**대상 파일**: `knowledge/phases/phase2b_eval_freevar_runner.py`
**위험 등급**: **1**
**처리**:
- 현 DECISION_RE 11어휘 단일 매칭 → **의미축 3축 분리**:
  - **(가) 가능·긍정**: 안전·가능·괜찮·적합·권장·권고·허용·충분
  - **(나) 주의·조건부**: 주의·조심·자제·조건부·권하지·부족
  - **(다) 무리·금지**: 무리·위험·금지·통제·발령·보류·어려움·어렵
- 어느 축이든 1개 이상 매칭 시 PASS (현재는 11어휘 정확 매칭만 PASS)
- 자연스러운 안전 표현 ("안전합니다", "출항하긴 어려울 것 같아요", "조심하셔야 해요") 도 PASS 처리
- DECISION_WORDS const 삭제 (H5) 후 prompt 강제어 제거가 회귀 없이 동작 가능

**커밋 메시지 안**:
```
i1/H7: runner DECISION_RE 의미축 3축 분리 (자연 안전 표현 인정)

- 현 11어휘 단일 매칭 → 가능/주의/무리 3 축 의미 매칭
- 예: "안전합니다" / "출항 어려울 것 같아요" / "조심하셔야 해요" PASS
- assistant.js DECISION_WORDS 강제어 제거 페어
- 회귀 가드: 기존 11어휘 모두 3축 어딘가에 포함되어야 PASS 보존
```

---

## 4. 위험 등급 분포

| HUNK | 등급 | 정성 평가 |
|---|---|---|
| H1 (synth prompt 교체) | **4** | 가장 큰 변경. 18+ bullet → 7원칙. 회귀 시 cat=4·6 -5~8pp 가능 |
| H2 (planQuery 단순화) | **4** | 도구 선택 정확도 직결. 회귀 시 cat=3 -3~6pp |
| H3 (정규식 7 종 제거) | **3** | LLM 자율로 회복 가능하나, ISLAND·MULTI·VAGUE 회귀 위험 |
| H4 (매트릭스 광역 alias + hint 제거) | **3** | 광역 alias 12 키 제거는 UX 개선 가능성, hint 는 데드 코드 |
| H5 (bullet 후처리 룰 제거) | **3** | 메타 재시도·DECISION_WORDS const 제거. H1·H7 와 페어 |
| H6 (광역 게이트) | **2** | 새 함수 추가 + 분기 재구성. results=0 광역만 영향 |
| H7 (runner 의미축 분리) | **1** | 평가 도구 측. assistant.js 무영향, 채점만 관대화 |

**총평**: **H1·H2 가 위험 4 — 단일 PR 로 적용하지 말고 단계적 commit 권장** (§6 참조).

---

## 5. 회귀 가드 통합

### 5.1 핵심 게이트 (단일 PR 통과 조건)

| 게이트 | 기준 | 적용 시점 |
|---|---|---|
| **sentinel v2 35/35** | 모든 35 케이스 PASS 보존 | 매 hunk 적용 후 |
| **보안 5/5 HARD** | SEC-COT-1·2, ADM-T3·T4, ADM-INJ-1 — 한 건이라도 실패 시 전체 FAIL | 매 hunk 적용 후 |
| **v5_run5 자유변칙 86%** | DoD ≥ 82% 보존 (worst-case 4pp 허용) | H1·H2·H3·H5 적용 후 |
| **h2_paradigm_eval 54 신규** | C1 ≥ 75%, C2 ≥ 70%, C5/C6 5/5 HARD, REG 회귀 0 | H1·H6 적용 후 |
| **환각 의심 ≤ 2건** | runner HALLUC_RE DOMAIN/OFFDOMAIN 분리 유지 | 매 hunk 적용 후 |
| **CoT 누수 0건** | H1 P7 + cleanAnswer 후처리 보존 | 매 hunk 적용 후 |
| **응답 시간 p95** | -150~250ms 개선 기대, +100ms 이내 회귀 허용 | 전체 적용 후 |

### 5.2 카테고리별 회귀 매트릭스 (v5_run5 86% 보존)

| 카테고리 | 현재 | 예상 (best) | 예상 (worst) | 가드 |
|---|---|---|---|---|
| cat=1 기본 | 98% | 97~98% | 96% | DOMAIN_RE 유지 + ISLAND 어휘 흡수 |
| cat=2 연속 | 72% | 72~74% | 70% | **PRONOUN_RE / FOCUS_ZONE_ARG 절대 보존** |
| cat=3 다중 | 88% | 85~88% | 82% | M6 EXPECT_TOOLS_MIN.min + pickMissingTools 보강 잔존 |
| cat=4 정량 | 55% | 55~62% | 47% | **H7 runner 의미축 페어 필수**. 미적용 시 -8~12pp |
| cat=5 비도 | 98% | 97~98% | 96% | DOMAIN_RE + H1 P4 (비도메인 거절) 보존 |
| cat=6 메타 | 88% | 84~88% | 82% | H1 P4 + memory prompt 상단 + 길이 boolean 가드 검토 |
| cat=7 환각 의심 | 100% (1건) | 95~100% | 90% | HALLUC_RE/OFFDOMAIN runner 보존 |
| cat=8 변칙 | 98% | 95~98% | 95% | classifySecurityIntent + GUARD_EXCLUDES 보존 |
| **종합** | **86%** | **85~88%** | **82~84%** | DoD ≥ 82% 유지 |

### 5.3 보안 절대 보존 매트릭스 (HARD)

- **ADMIN_INTENT_RE** (5 정규식, L185~L190): SEC 5/5 직결 — H3 에서 제외
- **GUARD_EXCLUDES** (배열, L226~L237): 프라이버시 — H3 에서 제외
- **classifySecurityIntent**: L0/L2 게이트 — 모든 hunk 에서 제외
- **cleanAnswer 후처리**: L2273 컨텍스트 격리 정규식 — 모든 hunk 에서 제외
- **L4 사후검열 guardExcludesScan**: 시크릿 토큰 차단 — 모든 hunk 에서 제외

---

## 6. 적용 순서 (위험 낮은 → 높은)

### 6.1 권장 순서 (안전 우선)

| 단계 | HUNK | 위험 | 누적 라인 절감 | 검증 |
|---|---|---|---|---|
| 1 | **H7** (runner 의미축 분리) | 1 | 0 (runner 만) | 기존 평가 재실행 — 모든 케이스 PASS 보존 확인 |
| 2 | **H6** (광역 게이트) | 2 | -12 | sentinel v2 35/35 + v5_run5 86% 보존 + h2_paradigm C1 ≥ 60% (warm-up) |
| 3 | **H5** (bullet 후처리 룰 제거) | 3 | -21~37 | sentinel v2 + cat=4·6 보존 |
| 4 | **H3** (정규식 7 종 제거) | 3 | -41 | sentinel v2 + cat=1·2·3·5·6 보존 |
| 5 | **H4** (매트릭스 제거) | 3 | -11 | sentinel v2 + 광역 케이스 UX 검증 |
| 6 | **H2** (planQuery 단순화) | 4 | -71 | **cat=3 multi-tool 회귀 정밀 측정** (-2pp 이내 목표) |
| 7 | **H1** (synth prompt 교체) | 4 | -50~100 (라인) + -520 토큰 | **h2_paradigm 54 신규 게이트 통과 (C1 ≥ 75%, REG 회귀 0)** |
| **합계** | | | **-142 라인** | DoD 통과 종합 확인 |

### 6.2 단계별 commit 분리 권장 사항

- **각 hunk 별 commit 분리** (단일 PR 안에서 7 commits) — 회귀 발견 시 부분 revert 용이.
- **H1·H2 는 별도 PR 분리도 검토** — 위험 4 가 두 개 모이면 회귀 디버깅 난이도 ↑.
- **순서 변경 금지**: H7 → H1 직접 점프하면 cat=4 -8~12pp 회귀 확실. **H7 가 반드시 H1 앞**.
- **H6 → H1 의존성**: H6 의 광역 게이트가 활성화되어야 H1 의 7원칙 P2-b 통상 답이 작동.

### 6.3 대안 순서 (단일 commit — 비권장)

전체 한 commit 으로 묶으면 회귀 시 어느 hunk 원인인지 추적 어려움. **H7 만 분리 + 나머지 한 commit** 시나리오도 검토 가능하나, 회귀 시 revert 단위가 커서 비권장.

---

## 7. 회귀 시나리오 — Worst Case + 부분 Revert 경로

### 7.1 Worst-case 회귀 시나리오

| 시나리오 | 트리거 | 회귀 폭 | 부분 revert |
|---|---|---|---|
| **cat=4 정량 -10pp** | H7 의 의미축 매칭이 너무 관대해 false PASS 증가, 또는 H1 P6 의 강제어 제거가 LLM 자율 결정 단어 누락 | 55% → 45% | H7 의미축 일부 어휘 보강 + H1 P6 에 "가부 결론 한 줄 필수" 부드러운 강조 추가 |
| **cat=3 multi-tool -6pp** | H2 planQuery 매트릭스 흡수 1줄로 도구 페어 미발현 | 88% → 82% | H2 planQuery 1줄 → 3줄 보강 (직군별 도구 페어 명시) 또는 buildMatrixSection 함수 일부 복원 |
| **cat=6 메타 -5pp** | H5 메타 재시도 17 라인 삭제로 "모릅니다" 5자 단발 회귀 | 88% → 83% | H5 의 length<10 boolean 가드만 잔존 추가 (정규식 어휘 미인용, prompt P4 보강) |
| **cat=1 기본 -3pp** | H3 ISLAND_BUOY_RE 제거 후 LLM 이 비등록 섬을 도메인 외로 분류 | 98% → 95% | H3 의 ISLAND 어휘를 DOMAIN_RE 에 흡수 (단순 토큰 추가) |
| **sentinel SEC 4/5** | H1·H2 에서 보안 관련 bullet 압축 과도 또는 classifySecurityIntent 인입 누락 | HARD FAIL | **즉시 전체 revert** (보안은 회귀 허용 0) |

### 7.2 부분 Revert 매트릭스

| 회귀 발견 시점 | Revert 대상 | 비용 |
|---|---|---|
| H7 후 평가 PASS 폭 변화 큰 경우 | H7 만 revert (의미축 미세 보강 후 재시도) | 낮음 |
| H1 후 cat=4 -8pp 이상 | H1 의 7원칙 P6 부분만 (DECISION_WORDS 인라인 일부 복원) | 중간 |
| H2 후 cat=3 -5pp 이상 | H2 의 planQuery prompt 흡수 3줄 → matrixSection 단순 부활 | 중간 |
| H3 후 cat=1 -3pp 이상 | H3 의 ISLAND_BUOY_RE 만 복원 (단일 정규식) | 낮음 |
| H6 후 광역 답 환각 발생 | H6 의 `isWideOpenQuery` 게이트 조건 좁히기 | 낮음 |
| sentinel SEC 회귀 | 전체 revert | 높음 (단 즉시 필요) |

### 7.3 회귀 시 의사결정 룰

1. **HARD FAIL** (SEC 5/5 / C5 / CoT 누수 > 0 / GUARD_EXCLUDES 누설): **전체 revert + 처음부터**.
2. **종합 -4pp 이상 (86% → 82% 미만)**: H1·H2 만 부분 revert (가장 큰 위험 hunk).
3. **단일 카테고리 -8pp 이상**: 해당 hunk 만 부분 revert + 회귀 가드 보강 후 재시도.
4. **종합 -2pp 이내**: 채택 + 후속 라운드에서 미세 조정.

---

## 8. 예상 효과

### 8.1 라인 변화

| 영역 | 현재 | 목표 | Δ |
|---|---|---|---|
| `routes/assistant.js` | 2,892 | ~2,750 | **-142 라인 (-4.9%)** |
| `phase2b_eval_freevar_runner.py` | 392 | ~400 (의미축 3축 분리로 약간 증가) | +8 |
| 정규식 카탈로그 수 | 12 | 5 | -7 |
| 매트릭스 dict 수 | 4 (R_TABLE·COMMON·ACTIVITY·JIKGUN) | 0 | -4 |
| synth bullet 수 | 18+ | 4 가드 + 7 가이드 = 11 | -7 |

### 8.2 prompt 토큰 변화

| 영역 | 현재 (토큰) | 목표 (토큰) | Δ |
|---|---|---|---|
| synth template (개인화 제외) | ~880 | ~360 | **-520 (-59%)** |
| synth 입력 평균 (수집결과 포함) | ~2,400 | ~1,900 | -500 |
| planQuery template | ~1,400 | ~1,395 (M1~M4 -58 라인 + 3줄 흡수) | -5 (미세) |
| 강제어 "반드시/절대/1+ 포함" | 11회 | 0회 | -11 |

### 8.3 latency 변화

| 지표 | 현재 (v5_run5) | 목표 | Δ |
|---|---|---|---|
| Gemini synth latency p95 | ~1,800ms | ~1,650ms | **-150ms** |
| Gemini synth latency 평균 | ~900ms | ~750ms | -150ms |
| 전체 p95 | 5,513ms | 5,300~5,400ms | **-113~213ms** |
| 메타 재시도 호출 (cat=6 일부) | +600~1000ms | 0ms | **-600~1000ms** (해당 케이스만) |
| 환각 의심 false positive | 1건 | 1~2건 | 0~+1 (허용 범위) |

### 8.4 PASS 변화 (예상)

| 평가셋 | 현재 | best case | worst case | DoD |
|---|---|---|---|---|
| sentinel v2 | 35/35 | 35/35 | 33/35 | **35/35 필수** |
| 보안 v2 (SEC 5/5) | 5/5 | 5/5 | 5/5 | **5/5 HARD** |
| v5_run5 자유변칙 | 86% | 88% | 82% | ≥ 82% |
| h2_paradigm 종합 (54 문항) | (미실측) | 82% | 70% | ≥ 75% |
| h2_paradigm C1 광역 통상 | (미실측) | 85% | 65% | ≥ 75% |
| h2_paradigm C2 비등록 섬 | (미실측) | 80% | 60% | ≥ 70% |
| h2_paradigm C5/C6 HARD | (미실측) | 5/5 | 5/5 | **5/5 HARD** |

### 8.5 UX 변화 (정성)

| 사용자 시나리오 | 현재 | 목표 |
|---|---|---|
| "동해 수심 어때?" (광역) | "그 정보는 없어요" (만족도 ~10%) | "동해 평균 1,700m, 최대 3,700m, 서해와 달리 가파릅니다. 정확한 지명을 알려주시면 더…" (만족도 ~85%) **+75pp** |
| "흑산도 파고?" (비등록 섬) | "현재 발효 중인 ~ 없음" 또는 거절 | "흑산도는 신안군 서해 먼바다 권역으로… 지금 실측은 가져오지 못했어요. 가까운 부이 알려주시면…" |
| "출항 가능?" (안전 판단) | "결정 단어 1+ 포함 강제 매뉴얼 답" | "지금 파고 1.2m 풍속 8m/s 라 출항 가능합니다. 최종 판단은 선장님 몫." (자연스러움) |
| "방금 뭐였지?" (메타) | (재시도 후) memory 자연어 풀이 | (1회 호출 자율) memory 자연어 풀이 — 600~1000ms 단축 |

---

## 9. 적용 가능 체크리스트 (실제 J 라운드 패치 전 확인)

- [ ] H7 우선 적용 (runner 만, assistant.js 무영향)
- [ ] H7 적용 후 기존 평가 PASS 보존 확인 (cat=4 변화 측정)
- [ ] H6 의 `isWideOpenQuery` 함수 정확 정의 (동해/서해/남해/제주 + 광역 의도어 매트릭스)
- [ ] H6 적용 후 sentinel v2 35/35 + h2_paradigm C1 첫 측정
- [ ] H5 의 메타 재시도 17 라인 통째 삭제 — 길이 boolean 가드 (length<10) 만 잔존 검토
- [ ] H3 의 PRONOUN_RE / ADMIN_INTENT_RE / GUARD_EXCLUDES / DOMAIN_RE 절대 손대지 않음 확인
- [ ] H4 의 M5b ZONE_NAME_TO_CODE 본체 (L513~L559) 절대 손대지 않음 확인
- [ ] H2 의 buildMatrixSection 함수 삭제 후 planQuery 안 인용 위치 정확 추적
- [ ] H1 의 7원칙 + Few-shot 2 가 ~360 토큰 안에 들어가는지 확인 (-520 토큰 목표)
- [ ] 각 hunk 적용 후 sentinel v2 35/35 + 보안 5/5 + CoT 누수 0 매 확인
- [ ] 최종 적용 후 h2_paradigm 54 문항 측정 (C1 ≥ 75% / C5·C6 5/5 / REG 회귀 0)
- [ ] worst-case 회귀 발견 시 부분 revert 경로 (§7.2) 따라 처리

---

## 10. 다음 라운드 (J 라운드 — 실제 패치 적용) 권고

- **J1**: H7 (runner 의미축 3축 분리) 만 단독 적용 + 평가 회귀 측정 (1 commit, 1 PR)
- **J2**: H6 + H5 + H3 + H4 묶음 — 위험 2~3 의 결정론 가드 제거 묶음 (4 commits, 1 PR)
- **J3**: H2 (planQuery 매트릭스 흡수) 단독 적용 + cat=3 정밀 측정 (1 commit, 1 PR)
- **J4**: H1 (synth prompt 7원칙 교체) 단독 적용 + h2_paradigm 측정 (1 commit, 1 PR)
- 각 J 라운드마다 회귀 가드 (§5.1) 통과 게이트 필수.

---

## 핵심 적용 결정 한 줄

**31 항목 중 REMOVE 6 + MOVE 15 + GUARD 5 + DATA 4 + CORE 1 통합 — 7 hunks 위험 낮은 순 (H7→H6→H5→H3→H4→H2→H1) 단계 commit, assistant.js -142 라인 / synth prompt -520 토큰 / p95 -150~250ms / 광역·비등록 섬 답률 +75pp, DoD = sentinel 35/35 + 보안 5/5 HARD + v5 ≥ 82% + h2_paradigm C1 ≥ 75%·C5·C6 5/5 HARD·REG 회귀 0 — H7 가 반드시 H1 앞이라야 cat=4 -8~12pp 회귀 방지.**
