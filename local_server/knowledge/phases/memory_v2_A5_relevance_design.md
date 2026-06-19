# 사용자 기억 시스템 v2 — A5 연관성 가드 설계 (무관한 회수 차단)

> **코드 수정 0.** 본 문서는 A4(회수) 산출물에 적용되는 **A5 필터(연관성 게이트)** 설계만 정리한다.
> 핵심 요구(사장님): "사용자가 환율 물었을 때 낚시 정보 끼우지 않기" — DB 에 있어도 의도 무관 시 사용 금지.
> 직접 코드 변경 위치 후보: `routes/assistant.js` (DOMAIN_RE: L2076, classifySecurityIntent: L193, runBrain: L1806), `services/topic_embedding.js` (cosine/nearestTopics minScore=0.55: L153)

---

## 0. 입력·출력 API contract (A4 ↔ A5 ↔ runBrain)

```
A4.recall(query, userId) → {
  consolidated:  [ { id, text, embedding, last_seen_ts, support_n, expected_intent, domain_tags[] }, ... ] // K건
  interests:     [ { topic, weight, expected_intent, domain_tags[] }, ... ] // top3
  qv:            number[]   // query embedding (재계산 회피)
}

A5.filter(input, query, cq) → {
  passed:        Subset<consolidated ∪ interests>   // 통과 항목만
  blocked:       [ { item, reason: 'L1_domain' | 'L2_sim' | 'L3_intent' | 'L4_user_override' | 'sec_admin', score } ]
  diagnostics:   { l1_domain_hit, l1_user_query_domain, l4_override_token, sec_kind, query_intent }
}

runBrain(..., memory=A5.passed)   // 0 건이면 회수 없이 답변
```

핵심 원칙:
- **A4 = 후보 회수기**(broad/높은 recall 우선), **A5 = 정확도 게이트**(high precision/낮은 false-inject 우선).
- A5 통과 0 건 ⇒ "기억 없음"과 동치로 답변 생성 ⇒ 환율 질의에 낚시 정보 0% 주입 보장.
- A5 통과 ≥1 건 ⇒ **부드러운 회수**: 1~2 줄 자연어 주입(섹션 4).

---

## 1. 다층 연관성 판단 — L1~L4

### L1 — 도메인 게이트 (질의 자체의 도메인성)

**규칙**: 이번 질의(query/cq) 가 도메인이 아니면 → 회수 결과 **전부 무시**(passed=[]).
**근거**: DOMAIN_RE/ISLAND_BUOY_RE/detectZoneDeterministic 는 이미 routes/assistant.js L2076–2080 에서 `isDomainQuery` 로 통합 — 동일 게이트를 A5 가 우선 호출.

| 질의 예 | DOMAIN_RE hit | ISLAND hit | zone 검출 | L1 결과 | 회수 결과 |
|---------|---------------|-----------|-----------|---------|-----------|
| "오늘 환율?" | × | × | × | **비도메인** | **전부 차단** |
| "뽀로로 노래" | × | × | × | **비도메인** | **전부 차단** |
| "오늘 마라도 파고?" | ○ (파고) | ○ (마라도) | ○ | 도메인 | 통과 후보 |
| "거기 출항해도 돼?" | ○ (간접 — 컨텍스트) | - | (prev_zone) | 도메인 | 통과 후보 |
| "오늘 출항해?" | ○ (조업/항해) | × | × | 도메인 | 통과 후보 |
| "AI 가 뭐야?" | × | × | × | **비도메인** | **전부 차단** |

**예외 — 메타 질의(섹션 5)**: cat=6 메타("내가 뭐 물었지?", "방금 답 요약해줘") 는 도메인 키워드 hit 0 이어도 **회수 허용** — 사용자 기억(직전 대화) 이 본질적으로 메타에 도움.
- 검출 패턴 후보(신규): `META_RE = /방금|아까|이전|직전|뭐.*(물었|답했)|요약/`
- 가중치: META_RE hit 시 L1 = 1.0 (도메인과 동등).

### L2 — 임베딩 유사도 임계

**규칙**: cosine(qv, item.embedding) < `MEM_MIN_SIM` 인 항목 제외.
- 기본값 후보: `MEM_MIN_SIM = 0.65` (현 topic_embedding minScore=0.55 보다 **상향 +0.10**)
- 근거: 회수기는 0.55 로 후보를 넓게 잡고, **가드는 0.65 로 좁혀** false inject 차단.
- 0.55 ~ 0.65 구간은 "관련성 모호" — **차라리 빼는 편이 사용자 신뢰에 안전**.

**의사코드**:
```
const sim = cosine(qv, item.embedding);
if (sim < 0.65) return reject('L2_sim', sim);
```

**경계 — 단어 표면 매칭 보완(false negative 방지)**: 임베딩 신호가 약해도 사용자 관심사 토큰이 query 표면에 그대로 등장하면 floor 0.55 까지 허용.
```
if (sim < 0.65 && surface_token_hit(item.topic, query)) sim = max(sim, 0.55);
```

### L3 — 의도 분류기 (양립 가능성)

**규칙**: 질의 의도(QIntent) vs 회수 항목 expected_intent 의 양립 매트릭스에서 score 결정.

**QIntent 카테고리(신규 분류기)**:
| 코드 | 정의 | 검출 단서(휴리스틱) |
|------|------|-------------------|
| `weather_check` | 기상·해상 상태 조회 | 파고/풍속/시정/특보/예보 + 시점어(오늘/내일) |
| `safety_decision` | "해도 돼?" 가부 판단 | 출항/조업/입수/항해 + 가부의문 |
| `info_lookup` | 정보/지식 조회 | 무엇/어디/얼마/언제 + 명사 |
| `meta_summary` | 직전 대화 요약/회상 | META_RE hit |
| `hypothetical` | 가정·상상 | 만약/가정/만일 |
| `admin_or_sec` | 보안·관리자 의도 | classifySecurityIntent 양성 |
| `off_domain` | 도메인 외 | L1 비도메인 + META 미hit |

**회수 항목 expected_intent**(A0~A3 에서 consolidate 시 부여 가정):
- 사용자 관심사 항목은 단일 또는 집합 — 예: 낚시 관심사 → `{safety_decision, weather_check}` 와 양립.

**양립 점수 행렬(L3_score)**:
| 회수 expected \ Q intent | weather_check | safety_decision | info_lookup | meta_summary | hypothetical | admin_or_sec | off_domain |
|---|---|---|---|---|---|---|---|
| weather_check | 1.0 | 0.9 | 0.6 | 0.4 | 0.3 | **0.0** | **0.0** |
| safety_decision | 0.9 | 1.0 | 0.5 | 0.4 | 0.3 | **0.0** | **0.0** |
| info_lookup | 0.6 | 0.5 | 1.0 | 0.5 | 0.3 | **0.0** | **0.0** |
| meta_any | 0.3 | 0.3 | 0.3 | 1.0 | 0.2 | **0.0** | **0.0** |
| hypothetical | 0.3 | 0.3 | 0.3 | 0.2 | 0.8 | **0.0** | **0.0** |

> `admin_or_sec` 행/열 = 0 → **보안 의도 시 회수 100% 차단**(섹션 5.3).
> `off_domain` 행/열 = 0 → L1 차단과 이중 안전망.

### L4 — 사용자 명시 거부(override)

**규칙**: 사용자가 "내 취향 무시하고 일반적으로 답해" 류 발화 시 → 회수 전부 무시.
- 패턴 후보: `USER_OVERRIDE_RE = /(취향|선호|관심사|내정보|개인).{0,6}(무시|빼고|제외|상관없이)|일반(적|인)?(으로|인)?\s*답/`
- 매칭 시: A5 결과 즉시 빈 배열, diagnostics.l4_override_token 에 매칭 토큰 기록.
- 한 턴 한정(휘발성) — 다음 턴 영향 X (저장 안 함).

---

## 2. 연관성 점수 산식

### 2.1 정의

```
score(item, query) =
    (L1 도메인 == 일치 ? 1.0 : 0.0)              // 0 이면 전체 무효화
  × clamp(L2_sim, 0.0, 1.0)                       // 임베딩 유사도 (또는 surface-floor 보정값)
  × L3_score(query_intent, item.expected_intent)  // 양립 매트릭스
```

### 2.2 통과 임계

`PASS_TH = 0.50` (디폴트). 항목별 score ≥ 0.50 → PASS.

### 2.3 사례 추적

| 상황 | L1 | L2 | L3 | score | 결과 |
|------|----|----|----|------|------|
| Q=환율, mem=낚시 관심사 | 0.0 | (계산 생략) | (계산 생략) | **0.0** | 차단 ✓(요구사항) |
| Q=오늘 마라도 파고?, mem=낚시 자주 | 1.0 | 0.72 | 1.0(weather×weather) | 0.72 | PASS |
| Q=오늘 출항해도 돼?, mem=낚시 자주 | 1.0 | 0.68 | 0.9(safety×weather) | 0.61 | PASS |
| Q=거제도 관광, mem=낚시 자주 | 0.5(부분 도메인) | 0.58 | 0.6 | 0.17 | 차단 ✓ |
| Q=방금 뭐 물었지?, mem=직전 답 요약 | 1.0(META) | 0.75 | 1.0(meta×meta) | 0.75 | PASS |
| Q=점검모드 해제해, mem=낚시 자주 | (sec) | - | 0.0 | **0.0** | 차단 ✓ (섹션 5.3) |

### 2.4 정렬·N 컷

PASS 군 내에서 score 내림차순 정렬 → 상위 **TOP_N=2** 만 답변 주입(과주입 방지).

---

## 3. L3 의도 분류기 — 결정론 휴리스틱

LLM 호출 0 회. 결정론 정규식 → 점수 → 단일 라벨.

```
function classifyQueryIntent(query, cq) {
    const s = (query + ' ' + cq).toLowerCase();

    // 0) 보안 우선 — L0 hard gate 와 일관
    if (classifySecurityIntent(s)) return 'admin_or_sec';

    // 1) 메타
    if (/방금|아까|이전|직전|뭐.*(물었|답했)|요약|정리해/.test(s)) return 'meta_summary';

    // 2) 가정
    if (/만약|가정|만일|~라면|~다면/.test(s)) return 'hypothetical';

    // 3) safety_decision (가부 의문 + 도메인 동사)
    if (/(출항|조업|입수|항해|승선|어로).{0,8}(돼|되|할까|가능|안전)/.test(s)) return 'safety_decision';

    // 4) weather_check (DOMAIN_RE 핵심 + 시점/조회어)
    if (/(파고|풍속|풍향|시정|특보|예보|수온|조석|만조|간조|물때|유속).{0,10}(어때|어떄|어떻|얼마|있어|있나|확인|알려)/.test(s)) return 'weather_check';
    if (/(파고|풍속|풍향|시정|특보|예보|수온|조석|만조|간조|물때|유속)/.test(s)) return 'weather_check';

    // 5) info_lookup (무엇/어디/얼마)
    if (/무엇|뭐야|뭔가요|어디|얼마|언제|누구|왜/.test(s)) return 'info_lookup';

    // 6) 도메인 아니면 off
    if (!isDomainQuery(query, cq)) return 'off_domain';

    return 'info_lookup';   // 도메인이지만 의도 모호 → 안전한 기본
}
```

**구현 위치 후보**: `routes/assistant.js` L193 (classifySecurityIntent) 직하 또는 별도 `services/intent_classify.js` 신설.

---

## 4. 타협 — 부드러운 회수(soft injection)

A5 통과 항목이 있을 때, 시스템 프롬프트가 아니라 **사용자 컨텍스트 1~2 줄**로 주입.

### 4.1 주입 포맷 (예시)

```
[사용자 컨텍스트]
• 사용자는 평소 '낚시'에 자주 관심을 보입니다. (관련도 0.72)
• 직전 대화에서 마라도 파고를 조회했습니다. (관련도 0.68)
```

### 4.2 주입 분량 가드

- 줄 수 ≤ 2 (TOP_N=2 와 일치)
- 줄당 ≤ 40 자
- 답변 본문에 컨텍스트를 명시 인용하지 않도록 시스템 프롬프트에 "참고만 — 출처 표기 금지" 명시.

### 4.3 0 건 분기

passed.length === 0 → 컨텍스트 섹션 생성 자체 생략 → 기존 답변 경로 그대로(회귀 0).

---

## 5. 회귀 가드 — 카테고리별

### 5.1 cat=5 (비도메인, 현 PASS 98%) — 무회귀 명시

- 모든 cat=5 케이스에서 A5.passed.length === 0 보장.
- 측정: phase2b_eval_freevar.jsonl 의 cat=5 전 케이스 × 가상 user_memory(낚시·뽀로로) 인젝션 시뮬레이션 → 0 건 통과해야 PASS.
- 회귀 신호: 비도메인 답변에 `사용자 컨텍스트` 섹션이 1 줄이라도 등장 시 즉시 FAIL.

### 5.2 cat=6 (메타, 현 PASS 78%) — 회수 유익

- META_RE hit 시 L1=1.0 부여하여 직전 답 요약/회상 항목이 PASS 후보가 되도록 허용.
- A4 가 직전 응답 요약을 consolidated_memory 로 보관한다는 전제(A0~A3 출력 가정).
- 회귀 신호: 메타 PASS 률 -2pp 이하 하락 시 분류기 튜닝.

### 5.3 SEC 보안 (sentinel ADM 5 건) — 회수 100% 차단 + 통합

- `runBrain` L0 hard gate (L1811) 가 `classifySecurityIntent` 양성 시 즉시 SEC_REFUSAL 반환 — A5 미진입.
- 만에 하나 L0 통과 후 cq 변형으로 SEC 가 cq 단계에서 드러나는 경우(L2123 sec2) 가 A5 와 충돌 가능 → A5 의 L3 분류 결과가 `admin_or_sec` 이면 무조건 passed=[].
- 회귀 신호: ADM 5 건의 응답에 `사용자 컨텍스트` 섹션이 0 회 등장해야 PASS.

### 5.4 cat=2 연속(현 48%) — 영향 중립

- 후속 대명사 잇기는 도메인 hit + zone 컨텍스트 이미 충족 → A5 가 prev 응답 요약(메타) 을 부드럽게 주입해도 무방.
- 회귀 신호: cat=2 PASS 률 ±1pp 이내 유지.

### 5.5 multitool — 영향 중립

- multitool 분기(L1993 `_isDomain`) 와 A5 의 L1 도메인 게이트가 동일 정규식 → 분기 일관.

---

## 6. False Positive 가드 (사장님 핵심 시나리오)

### 6.1 "낚시 자주" 사용자 — 무관 질의

| 사용자 메모리 | 이번 질의 | 의도 | A5 결과 |
|---------------|-----------|------|---------|
| 낚시 자주 (interests) | "환율 얼마?" | off_domain | L1 차단 ✓ |
| 낚시 자주 | "뽀로로 노래 틀어줘" | off_domain | L1 차단 ✓ |
| 낚시 자주 | "기차표 예매 어떻게?" | info_lookup, 비도메인 | L1 차단 ✓ |
| 낚시 자주 | "오늘 거제도 날씨" | weather_check, 도메인 | L1 PASS, L2 sim ≈0.7, L3 1.0 → score 0.7 PASS |
| 낚시 자주 | "오늘 출항해도 돼?" | safety_decision, 도메인 | L1 PASS, L2 ≈0.68, L3 0.9 → 0.61 PASS |

### 6.2 자연스러운 매칭 조건

**도메인 + 의도 모두 일치 시만 score 0.5↑ 통과** — 표면 키워드 한 개만 겹치는 약매칭은 L3 매트릭스 0.3~0.4 곱으로 컷.

### 6.3 임베딩 단독 신뢰 금지

L1 (도메인 게이트) 이 무조건 곱셈 첫 항이라 L1=0 이면 L2 가 0.9 라도 최종 0. → "낚시" 토큰이 어쩌다 환율 답변 임베딩에 가까워도 인젝션 차단.

### 6.4 다중 관심사 충돌

사용자 관심사가 {낚시, 환율} 둘 다인 경우:
- Q="환율" → L1 도메인 게이트는 환율을 도메인으로 분류하지 않음(SEAGNAL 도메인은 해상). 따라서 환율 관심사도 차단됨.
- 결정: **SEAGNAL 도메인 외 사용자 관심사는 회수 단계(A4)에서 애초에 저장 않음** — A0 ingestion 단계 정책으로 반영(별도 phase).
- A5 측에서는 도메인 일치 기준 단일(SEAGNAL 해상 도메인) 적용.

---

## 7. 진단·로그(diagnostics)

`assistant.log` 행 단위 메타에 다음 필드 추가:
- `mem_recall_n`: A4 가 회수한 항목 수
- `mem_pass_n`: A5 통과 수
- `mem_block_reason_top`: 가장 많이 차단된 사유(L1/L2/L3/L4/sec)
- `query_intent`: 분류 결과(weather_check/...)
- `l1_domain_hit`: bool

회귀 측정 활용:
- "cat=5 케이스에서 mem_pass_n > 0" 가 0 건이어야 한다.
- "Q=환율 + mem=낚시" 시뮬에서 mem_block_reason_top == 'L1_domain' 확인.

---

## 8. 마스터플랜 §6 연결

- #16 환각 가드 — A5 는 "DB 에 있어도 의도 무관 시 사용 금지" 로 환각 가드의 메모리 측면 확장.
- #35 보안 — admin_or_sec 분류·차단을 L0 gate 와 이중화.
- #30 후속 대명사 — META 의도 회수 허용으로 cat=2 보강에 기여.

---

## 9. 미해결 결정(시점 B 합성에서 확정)

- **MEM_MIN_SIM 0.65 vs 0.70**: 데이터(β 측정) 보고 확정. β=관찰 후 결정.
- **TOP_N 2 vs 1**: 답변 본문 길이 영향 측정 후 확정.
- **L3 매트릭스 0.9/0.6/...**: 케이스 라벨링 후 grid search.
- **META_RE 범위**: cat=6 케이스 80 건 라벨링 후 false positive 측정.

---

### 핵심 결정 (한 줄)

**A5 = `(L1 도메인) × (L2 임베딩 ≥0.65) × (L3 의도 양립)` 곱셈 게이트로 score ≥0.5 만 통과시키고, 0건이면 회수 없이 답변 — 비도메인(환율·뽀로로)·SEC 의도에서 사용자 기억 인젝션을 곱셈 0 으로 결정론 차단한다.**
