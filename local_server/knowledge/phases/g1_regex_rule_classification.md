# G1 — 정규식 룰 제거 분류 (LLM 자율 위임 가능성 평가)

> **목적**: 7~8 라운드 누적된 정규식 룰을 LLM 자율 위임으로 전환할지, 보안·환각 가드로 유지할지,
> synth prompt 한 줄로 이동할지, 도메인 데이터로 보존할지 4 분류로 분기.
> **제약**: 본 산출물은 분류만 — 코드 직접 수정 0. 후속 G2~G4 가 실제 패치 트랙.

---

## 0. 분류 기준 4 카테고리

| 분류 | 정의 | 판단 신호 | 대표 예시 |
|---|---|---|---|
| **REMOVE** | LLM 자율 인지로 룰 없어도 동일한 답 가능. 정규식이 LLM 능력의 *하위 호환* 일 뿐 | "Gemini 가 이 어휘를 자연어로 알아본다" / 룰 매칭 결과가 단순 boolean 으로만 쓰임 / 매칭 후 prompt 인용으로 종결 | ISLAND_BUOY_RE (Gemini 가 "홍도" 도서명 인지) |
| **KEEP-GUARD** | 보안·환각·프라이버시 가드. LLM 위임 시 회귀 위험 크고, 결정론적 차단이 안전 불변식 | sec/halluc/sentinel 평가셋이 직접 가드 동작에 의존 / DoD 항목과 직결 | classifySecurityIntent, GUARD_EXCLUDES |
| **MOVE-TO-PROMPT** | 룰 자체는 단순하나 prompt 한 줄로 표현 가능. 정규식 → "이런 어휘가 보이면 X" synth 지시문으로 자연어화 | 분기 결과가 prompt 의 한 bullet 으로 흡수 가능 / 결정론 거절 아닌 *답 형태 가이드* | MULTI_INTENT_RE, OVERVIEW_RE |
| **KEEP-DATA** | 룰이 아니라 도메인 사실 데이터. 좌표·매핑·도구 args 매핑 등 | 데이터 룩업·dict / boolean 분기 아님 / 사실 자체가 진리값 | FOCUS_ZONE_ARG, ZONE_COORDS |

---

## 1. 분류 대상 정규식 12종 — 라인·라운드·분류·영향·대체

| # | 정규식명 | 위치 (assistant.js) | 추가 라운드 | 추가 이유 (master plan §7) | 분류 | 제거 시 영향 | 대체 방법 |
|---|---|---|---|---|---|---|---|
| 1 | **ISLAND_BUOY_RE** | L2142, L2025 (MULTI_ISLAND_RE 쌍) | 8차 D1 | 홍도·연평·위도·격렬비열도 11개 섬명을 도메인 가드 + multitool 발동 트리거에 인식 (ANG-1-08/09, ANG-2-04a/b 회복) | **REMOVE** | isDomainQuery=false 로 비도메인 분기 → web_search 폴백. 단, **prompt 의 "한국 해양·기상" 명시 + ZONE_NAMES 1차 매칭 + DOMAIN_RE(파고·해역·해구 등)** 가 1차 게이트로 남아있어 진성 도메인 질의는 통과. 잔존 위험은 "홍도 가능?" 같이 *섬명만 + 짧은 동사* 케이스 — Gemini 가 "홍도=섬·해양" 인지하면 isDomainQuery 무관히 합리적 합성 가능 | (a) DOMAIN_RE 의 "섬·항구·항만" 토큰만 유지 (b) prompt 1줄 추가: "질문에 한국 도서·항구·해변 지명이 있으면 해양 도메인으로 간주" (c) 결과적으로 11개 섬 정규식 → 0 |
| 2 | **ACTIVITY_RULES** (12개) | L1567~L1580 | 7차 C2 | 활동 어휘 (다이빙·서핑·갯바위·출항…) → R1~R12 매트릭스 룰 결정론 추가. R4/R5 marine_leisure 회복 | **MOVE-TO-PROMPT** | JIKGUN_RULES 직군 기본 + COMMON_RULES (R1·R7) 는 보존 → 골격 유지. ACTIVITY_RULES 12개 정규식 제거 시 활동 매트릭스 약화 (자유변칙 cat3 다중 88%→소폭 회귀 예상). 단, prompt 의 "직군 + 활동 어휘 매트릭스" 룰을 LLM 이 R 행 인용해 도구 합집합 결정 | (a) ACTIVITY_RULES 12개 → buildMatrixSection 의 prompt 본문에 "다이빙·스쿠버 → R4; 요트·카약 → R5; 갯바위·찌낚시 → R2 … " 한 줄로 흡수 (b) LLM 이 query 어휘 보고 매트릭스 R 키 직접 선택 (c) JIKGUN_RULES dict 는 KEEP (직군 사실 — 데이터) |
| 3 | **META_HINT_RE** | L2283 | 8차 D1 | "방금/아까/정리해/뭐였지/뭐 물었" 메타 어휘 + memory 있음 + 답 짧음(< 10자) 시 재시도 prompt 발사 (ANG-6-01b "모릅니다." 5자 회복) | **MOVE-TO-PROMPT** | 메타 질의에 "모릅니다" 한 단어 답 회귀 가능 (메타 카테고리 88→소폭 하락). 단, synth prompt 의 "메타·자기요약 강화" bullet 이 이미 "memory 마지막 1~3 항목 자연어 1~3 문장 요약" 명시 → 일반 케이스는 LLM 자율 처리. 짧은 답 재시도 *루프*는 출력 길이 가드라 prompt 만으로는 강제 어려움 | (a) 정규식 제거 (b) synth bullet "메타·자기요약" 에 "한 문장 미만 답 절대 금지" 강화 1줄 추가 (이미 존재 — 재시도 루프만 제거 가능) (c) 단 짧은 답 가드는 *재시도 트리거* 라 절반 KEEP-GUARD (길이 < 10 boolean) — 정규식 부분만 REMOVE, 길이 검사는 유지 |
| 4 | **DECISION_HINT_RE** (`_DECISION_HINT_RE`) | L2153 | 7차 C1 + 8차 D1 (results=0 분기 보강) | "가능·위험·안전·괜찮·무리·적합·주의·판단·되[냐는요?]·돼·어떻·어때" 가설 분기에서 SOP 답 한 줄 (cat=4 정량 28→55→75% 회복 효과) | **MOVE-TO-PROMPT** | results=0 분기 SOP 답 미발동 → "지금 정보 가져오지 못했어요" 한 줄. cat=4 정량 회귀 (75→소폭 하락 예상). 단, synth prompt 의 "의사결정형 — 정량 판단 강화" bullet 이 결정 단어 11어휘 인라인 강제 → LLM 이 results 있을 때는 자율 처리. results=0 + 가설 케이스만 회귀 위험 | (a) 정규식 제거 (b) synth 의사결정 bullet 에 "results 가 빈 객체여도 결정 단어 1개 + 일반 임계 한 줄 (파고 2m / 풍속 14m/s 기준) 제공" 1줄 추가 (c) LLM 이 query 어휘 자율 판단 |
| 5 | **DECISION_RE_WEAK / DECISION_WEAK_PAIR_RE** | (현재 assistant.js 미존재 — runner.py / DECISION_RE 만 잔존) | 5차 α-C8 (`runner.py` DECISION_RE 9어 확장), 7차 C1 (synth ④⑤ bullet 복원) | 가설 케이스 SOP 답에 결정 단어 강제 (가능/주의/무리/위험…) — runner 채점축 | **KEEP-DATA** | runner.py 평가 채점 측 정규식 (DECISION_RE) 은 *평가 도구* 라 분류 대상 외. assistant.js 본체엔 약 정규식 변형 없음 (DECISION_WORDS const 가 synth bullet 인라인) | 현행 유지. DECISION_WORDS 는 데이터 (11 어휘 사전) → 데이터로 분류 |
| 6 | **HYPO_HINT_RE** (`_HYPO_HINT_RE`) | L2154 | 8차 D1 | "떨어지면·넘으면·되면·발효되면·이면·라면·시·뜨면·울리면·만약" 가설 조건문 인식 → SOP 답 (cat=4 정량 회복) | **MOVE-TO-PROMPT** | DECISION_HINT_RE 와 동일. results=0 + 가설 케이스만 회귀 위험. synth prompt 의 "가설·조건문 질의" bullet 이 이미 존재해 results 있을 땐 LLM 자율 처리. | (a) 정규식 제거 (b) synth 가설 bullet 강화 (c) LLM 자율 분기 |
| 7 | **FOCUS_ZONE_ARG** (dict) | L1889~L1903 | 4차 #22 (도구별 args 매핑) | 도구 14종마다 zone 받는 args 이름 (zone/place/location/beach/harbor) 다름 → focus.zone 정확 주입 | **KEEP-DATA** | 정규식이 아니라 dict (도구별 args 사실). 제거 시 도구 호출 args 빈 채로 호출 → focus 후속 전파 실패 (cat=2 연속 72%→대폭 회귀). prompt 위임 불가 — LLM 이 도구 args 이름을 매번 정확히 골라야 함 (cat 회귀 사례 다수 있었음) | 현행 유지. 도구 args 매핑은 TOOL_CATALOG 사실의 일부 |
| 8 | **PRONOUN_RE** | L1877 | 6차 #30 P_continuity_v2 (HUNK#3) | "거기/그곳/그쪽/그 해역/그 해구/그 부이/그 해변/그 항(만/구)/같은 곳/방금 거/아까/그건/저거" 대명사 후속 검출 → focus 결정론 주입 | **KEEP-GUARD** | 제거 시 isPronounFollowup=false → focus.zone/buoy/coords args 주입 차단 → 연속 카테고리 cat=2 72%→43% 회귀 (v3 측정 실증). 대명사 검출은 prompt 위임 시 LLM 비결정성으로 누락. **결정론 게이트 필수** | 현행 유지. 단 14개 어휘는 데이터 보강 (어휘 추가 시 정규식 확장만) |
| 9 | **REGION_DIR_RE** | L616 | 6차 #36 (광역/전역/권역/전체 4 토큰 추가) | 해역명 토큰 매칭 (제주·북부·동부·동해광역…) — detectZoneDeterministic Stage 2/3 | **KEEP-DATA** | 정규식이긴 하나 ZONE_NAMES 사전과 결합한 *fuzzy 매칭 토크나이저*. 제거 시 detectZoneDeterministic 무력화 → "전남남해" 같은 비표준명 → 표준 zone 매핑 실패 (cat=3 다중 88%→회귀). LLM 위임 시 args 결정 비결정. | 현행 유지. ZONE_NAMES 와 한 쌍의 데이터 (지역명·방위명 사전) |
| 10 | **MULTI_INTENT_RE** | L1771 | 5차 #31 P_multitool needsReplan v2 | "어때/상황/어떻게/괜찮/종합/전반/적합/할 만/파고+풍속 조합" → multitool 분기 → pickMissingTools 보강 | **MOVE-TO-PROMPT** | 제거 시 needsReplan multitool 분기 미발동 → 직군 floor (예: fishery min 3) 미충족 케이스 약화 (cat=3 다중 88%→소폭 회귀). 단, planQuery prompt 의 "다중 도구 패턴 매트릭스" + EXPECT_TOOLS_MIN dict 가 1차 게이트라 LLM 이 처음부터 forecast+warning 페어 선택 가능 | (a) 정규식 제거 (b) planQuery prompt 에 "종합·전반·적합 등 광역 평가 어휘면 forecast+warning 최소 함께 호출" 1줄 강화 (c) needsReplan 의 multitool 분기 자체를 prompt 후 1라운드 *pickMissingTools 결정론 보강* 만 남기고 정규식 게이트 제거 |
| 11 | **PRONOUN_GUARD** (boolean) | L1769 (`if (isPronounFollowup) return false`) | 5차 #31 (P_multitool needsReplan v2) | 대명사 후속이면 multitool 분기 차단 — #30 isChainFollowup 가 focus 주입 책임 (이중 처리 방지) | **KEEP-GUARD** | 제거 시 pronoun 후속이 multitool 보강에도 들어가 도구 중복 호출 + focus 주입 충돌. 가드 = boolean 분기 (정규식 아님). PRONOUN_RE 와 한 쌍 | 현행 유지. PRONOUN_RE 의 *소비처* — 분리 불가 |
| 12 | **VAGUE_LOCAL_RE** | L1862 | 5차 α-C2 (LG-1-01 게이트) | "관내/우리 시/시청 관할/관할 해역/관할 구역/우리 지역" 모호 지명 — local_gov 직군 + GPS/default/focus 무 → get_warning(zone:'') 전국 집계 강제 | **MOVE-TO-PROMPT** | 제거 시 local_gov 자치단체 "관내" 질의 → LLM 이 zone 비워 web_search 폴백 → 도메인 가드 막힘 → 빈 답. 단, planQuery prompt 의 "local_gov + 관내/우리시 → 전국 집계" 1줄 룰이 1차 게이트로 존재. assistant.js 본체의 결정론 강제는 *재발 보호* | (a) 정규식 제거 가능하나, prompt 무시 회귀 (이전 #23 시점) 가 잦았음 — *prompt 1줄 + 결정론 1회 우회* 의 이중 안전망이 sentinel LG-1-01 PASS 보존에 직결 (b) **부분 REMOVE** — VAGUE_LOCAL_RE 5어휘 → prompt 의 "관내/우리시/관할 등 모호 지명" 1줄로 흡수 가능. 결정론 강제는 boolean 분기로 잔존 |
| 13 | **MONITOR_JIKGUN** (Set) | L1863 | 5차 α-C2 | local_gov/coast_guard/navy/mof/public_org 5 직군 — 모니터링성 직군 구분 | **KEEP-DATA** | 정규식 아님 — Set 데이터 (직군 5종 사실). KEEP-DATA. 현재 사용처는 1곳 (`OVERVIEW_RE` 와 짝)이고 다른 직군 분기에도 재사용 여지 | 현행 유지. JIKGUN 데이터 |
| 14 | **OVERVIEW_RE** | L1864 | 5차 α-C2 | "어때/상황/전반/전체/괜찮" — isDomainQuery 보조 게이트 (모니터링 직군 광역 질의) | **MOVE-TO-PROMPT** | 제거 시 비지명 광역 질의 ("어때") 가 isDomainQuery=false → 안내 메시지. 단, MULTI_INTENT_RE 와 겹쳐 일부 중복. prompt 의 "광역 평가 어휘" 룰로 흡수 가능 | (a) 정규식 제거 (b) MULTI_INTENT_RE 와 통합 후 둘 다 prompt 1줄로 흡수 |
| 15 | **HALLUC_RE / HALLUC_INDICATORS_DOMAIN / OFFDOMAIN** | runner.py 측 (assistant.js 본체엔 미존재) | 8차 D2 (HALLUC_RE DOMAIN/OFFDOMAIN 분리) | 환각 의심 채점축 — false positive 5→1 (실측치 forecast/유속 패턴 오탐 분리) | **KEEP-GUARD** | runner.py 평가 채점 측 정규식. 환각 검출 DoD 항목 (≤2 의심) 직결. 제거 시 환각 의심 1→5+ 회귀 가능. assistant.js 본체 영역 외 | 현행 유지 — 평가 도구의 결정론 채점은 LLM 위임 불가 (메타 평가 일관성) |
| 16 | **ADMIN_INTENT_RE** (`SECRET_NOUN`·`SECRET_INTENT`·`DEST_NOUN`·`DEST_VERB`·`INJECTION`) | L185~L190 | 5차 #35 P0 (SEC L0/L2 gate) | 시크릿/파괴/인젝션 의도 분류 → 결정론 거절문 (sentinel SEC 5/5 PASS 보존) | **KEEP-GUARD** | 제거 시 SEC 게이트 무력화 — sentinel SEC 2/5 (5차 라운드 이전 회귀 수준) 즉시 회귀. sec0/sec2 두 진입 지점 (L1839/L2209) 재사용 필수. DoD SEC 5/5 + 보안 불변식 핵심 | 현행 유지. 보안 정규식 카탈로그는 LLM 위임 절대 금지 (jailbreak·prompt injection 위험) |
| 17 | **GUARD_EXCLUDES** (배열) | L226~L237 | 5차 #35 P0 (L4 사후검열) | 시크릿 토큰·거짓 수행어·라벨 누출 차단 (sk-, AIza, "삭제 완료", "memory:", "[직전 확정 대상]" 등) | **KEEP-GUARD** | 제거 시 web/synth 답에 시크릿 토큰·라벨 누출 가능 (ANG-6-03b 회귀, 다른 사용자 정보 누설 위험). 프라이버시 불변식 직결 | 현행 유지. 배열이 사실상 *부분일치 사전* — 데이터지만 가드 목적 |
| 18 | **DOMAIN_RE / _MULTI_DOMAIN_RE** | L2140, L2022 | 5차 라운드 이전 (도메인 가드, §6 #11), 5차 #35 시점 hoist | 도메인 어휘 24개 (특보·예보·파고·풍속·시정·부이·조석·…) — isDomainQuery 1차 게이트 | **KEEP-DATA** | 도메인 키워드 *사전*. 제거 시 isDomainQuery 결정 약화 → web_search 도메인 가드 무력 (cat=5 비도메인 98% 회귀). LLM 위임 가능하나 결정론 게이트가 비용 0 | 현행 유지. 어휘 사전 (데이터). 단, ISLAND_BUOY_RE 와 합쳐 1개 사전으로 통합 권장 |

---

## 2. 분류 요약 — 12 정규식 + 부속 6 = 18 정규식/데이터

| 분류 | 개수 | 정규식·데이터 (G1 12종 중심) |
|---|---|---|
| **REMOVE** | **1** | ISLAND_BUOY_RE (11 섬명) |
| **MOVE-TO-PROMPT** | **6** | ACTIVITY_RULES (12), META_HINT_RE, DECISION_HINT_RE, HYPO_HINT_RE, MULTI_INTENT_RE, OVERVIEW_RE, (부분) VAGUE_LOCAL_RE |
| **KEEP-GUARD** | **4** | PRONOUN_RE, PRONOUN_GUARD, ADMIN_INTENT_RE, GUARD_EXCLUDES, HALLUC_RE/OFFDOMAIN (runner) |
| **KEEP-DATA** | **5** | FOCUS_ZONE_ARG, REGION_DIR_RE, MONITOR_JIKGUN, DECISION_WORDS, DOMAIN_RE |

> *G1 분류 대상 12종 기준: REMOVE 1 / MOVE 6 / GUARD 3 (PRONOUN·ADMIN·GUARD_EXCLUDES) / DATA 2 (FOCUS_ZONE_ARG·MONITOR_JIKGUN).*
> *나머지 (DECISION_RE_WEAK·DECISION_WEAK_PAIR_RE) 는 runner 또는 const 로 본체 외부 — KEEP-DATA.*

---

## 3. 예상 라인 절감

| 분류 | 정규식·블록 | 절감 추정 (assistant.js 본체) |
|---|---|---|
| REMOVE | ISLAND_BUOY_RE × 2 (L2025, L2142) + 사용처 2줄 (L2027, L2144) | **-12 라인** |
| MOVE-TO-PROMPT | ACTIVITY_RULES 14줄 (L1567~L1580) + 사용 5줄 (L1596~L1601) | **-19 라인** |
| MOVE-TO-PROMPT | META_HINT_RE + 길이 가드 외 정규식 부분 (L2283~L2284, retry 블록 일부) | **-2 라인** |
| MOVE-TO-PROMPT | DECISION_HINT_RE + HYPO_HINT_RE + 분기 (L2153~L2165 일부) | **-13 라인** |
| MOVE-TO-PROMPT | MULTI_INTENT_RE + 분기 (L1771~L1772) | **-2 라인** |
| MOVE-TO-PROMPT | OVERVIEW_RE + 사용 (L1864, L2029) | **-2 라인** |
| MOVE-TO-PROMPT | VAGUE_LOCAL_RE 부분 (L1862, L1980 정규식만) | **-1 라인** |
| **합계** | | **~ -51 라인 (assistant.js 2892 → 2841, -1.8%)** |

> **순 절감은 작아 보이나 *정규식 카탈로그 수* 가 12 → 5 로 감소** — 룰 인지 부담 감소, LLM 위임 비율 증가가 본질 가치.
> *prompt 측 라인 +5~10 증가 예상* (synth/planQuery bullet 보강) → 총 라인 변화 약 -40 라인.

---

## 4. 회귀 위험 — sentinel v2 35 + v5_run5 86% 보존 가드

### 4.1 sentinel v2 35 케이스 (DoD 통과 게이트) 영향

| 정규식 제거 | 영향 케이스 | 위험 등급 |
|---|---|---|
| ISLAND_BUOY_RE → REMOVE | ANG-1-08/09 (홍도·연평), ANG-2-04a/b (위도·격렬비열도) | **중** — Gemini 도서명 인지 시 PASS, prompt 보강 필수 |
| ACTIVITY_RULES → MOVE-TO-PROMPT | marine_leisure 다이빙/요트/서핑 케이스 (R4·R5 결정론) | **중** — LLM 매트릭스 인용 누락 시 cat3 다중 88→80% 회귀 가능 |
| DECISION_HINT_RE / HYPO_HINT_RE → MOVE-TO-PROMPT | ANG-4-02/05 (cat=4 정량 가설 SOP 답) | **고** — results=0 분기에서 LLM 자율 결정 단어 미포함 시 cat4 정량 회귀 (75→50% 가능) |
| MULTI_INTENT_RE → MOVE-TO-PROMPT | FIS-3-01 등 종합·전반 multitool 케이스 | **중** — EXPECT_TOOLS_MIN floor 미충족 시 단일 도구 회귀 |
| META_HINT_RE → MOVE-TO-PROMPT | ANG-6-01b (메타 자기요약 "모릅니다" 5자) | **고** — 길이 < 10 재시도 트리거가 prompt 만으로는 어려움 — boolean 길이 가드만 KEEP-GUARD 권장 |
| VAGUE_LOCAL_RE → 부분 REMOVE | LG-1-01 (관내 + local_gov + GPS 없음) | **중** — planQuery prompt 무시 회귀 이력 있음 (#23 시점) — 결정론 강제 잔존 권장 |
| OVERVIEW_RE → MOVE-TO-PROMPT | baseline-geomun 류 ("어때" 모호어) | **저** — DOMAIN_RE 와 detectZoneDeterministic 으로 보완 가능 |

### 4.2 v5_run5 자유변칙 86% (440 케이스) 영향

| 카테고리 | 현재 % | REMOVE/MOVE 후 예상 | 회귀 가드 |
|---|---|---|---|
| cat=1 기본 | 98% | 97~98% | DOMAIN_RE 유지 + ISLAND 어휘 → DOMAIN_RE 흡수 |
| cat=2 연속 | 72% | **회귀 위험 — PRONOUN_RE KEEP-GUARD 필수** | PRONOUN_RE 절대 제거 금지 |
| cat=3 다중 | 88% | 82~88% (ACTIVITY_RULES MOVE 영향) | planQuery prompt 매트릭스 강화 + pickMissingTools 보강 잔존 |
| cat=4 정량 | 55% | 40~55% (DECISION_HINT/HYPO 영향) | synth 가설 bullet 강화 + results=0 분기 prompt 보강 |
| cat=5 비도 | 98% | 97~98% | DOMAIN_RE + 도메인 가드 prompt 유지 |
| cat=6 메타 | 88% | 80~88% (META_HINT 영향) | 짧은 답 길이 boolean 가드 KEEP |
| cat=7 환각 의심 | 100% (1건) | 95~100% | HALLUC_RE/OFFDOMAIN KEEP-GUARD 필수 |
| cat=8 변칙 | 98% | 95~98% | classifySecurityIntent KEEP-GUARD 필수 |

### 4.3 SEC 게이트 (sentinel v2 SEC 5/5)

**ADMIN_INTENT_RE + GUARD_EXCLUDES 는 절대 제거 금지**.
- ADM-T3 (API key 노출), ADM-T4 (로그 삭제), ADM-INJ-1 (admin 청구) 5/5 PASS 가 직결.
- LLM 위임 시 jailbreak/prompt injection 회귀 → DoD SEC 결합 AND 실패 → 전체 게이트 FAIL.

---

## 5. 권장 적용 순서 (G2 패치 우선순위)

1. **REMOVE 1건 (ISLAND_BUOY_RE)** — 위험 *중*, 라인 절감 12, prompt 보강 1줄로 봉합 가능. **최우선 — 사장님 피드백의 핵심 신호 ("Gemini 가 홍도 인지함")**.
2. **MOVE-TO-PROMPT 1건 (OVERVIEW_RE)** — 위험 *저*, 절감 2, MULTI_INTENT_RE 와 통합 가능.
3. **MOVE-TO-PROMPT 1건 (ACTIVITY_RULES)** — 위험 *중*, 절감 19. planQuery prompt 매트릭스 강화 + JIKGUN_RULES 데이터 보존 필수.
4. **MOVE-TO-PROMPT 2건 (META_HINT_RE, MULTI_INTENT_RE)** — 위험 *중~고*. 길이 boolean 가드만 잔존.
5. **(보류) MOVE-TO-PROMPT 2건 (DECISION_HINT_RE, HYPO_HINT_RE)** — 위험 *고*. cat4 정량 75% 보호 가장 어려움. 별도 라운드 (G3) 에서 prompt 보강 + 평가 측정 후 결정.
6. **(보류) 부분 REMOVE (VAGUE_LOCAL_RE)** — planQuery prompt 무시 회귀 이력. 결정론 잔존이 안전.

---

## 6. 핵심 결론

- **사장님 피드백 적용 가능 범위**: 12 정규식 중 **REMOVE 1 / MOVE-TO-PROMPT 6 = 7건 (58%) 위임 가능**. 보안·환각 가드 + 도구 args 데이터는 결정론 유지 필요.
- **라인 절감보다 *룰 카탈로그 수* 감소 (12 → 5) 가 본질**. LLM 자율성 ↑, 룰 인지 부담 ↓.
- **회귀 위험 최대 항목**: DECISION_HINT_RE / HYPO_HINT_RE (cat=4 정량 75% 보호), META_HINT_RE 의 길이 가드 (cat=6 메타 88%), VAGUE_LOCAL_RE (LG-1-01 회귀 이력).
- **절대 보존**: PRONOUN_RE, ADMIN_INTENT_RE, GUARD_EXCLUDES, HALLUC_RE/OFFDOMAIN — 보안·연속성·환각 불변식 직결.

---

## 7. 다음 단계 — G2 ~ G4 트랙 제안

- **G2** — REMOVE 1건 (ISLAND_BUOY_RE) + MOVE-TO-PROMPT 2건 (OVERVIEW_RE, MULTI_INTENT_RE) 실제 패치 + sentinel v2 회귀 측정.
- **G3** — MOVE-TO-PROMPT 3건 (ACTIVITY_RULES, META_HINT_RE, DECISION_HINT_RE+HYPO_HINT_RE) 실제 패치 + v5 자유변칙 측정.
- **G4** — VAGUE_LOCAL_RE 부분 정리 + DOMAIN_RE / ISLAND 흡수 통합 + 잔존 정규식 카탈로그 5개 최종 확정.

> 각 G 단계는 sentinel v2 35 PASS + v5_run5 86% DoD 보존 게이트 통과 필수.
