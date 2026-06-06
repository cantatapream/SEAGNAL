# Memory v2 — A4: 회수(Retrieval) 두뇌 설계

> 사장님 요구 직역: "답하기 전에 AI 가 사용자 DB 한번 싹 훑고 관련 정보 회수해서 답변에 반영. 단, 관계없는 답 X."
> A4 는 모든 답변 전 **1 회의 RAG 회수**를 수행해, `planQuery` 와 `synth` 에 *힌트*로만 주입하는 두뇌이다.
> **본 문서는 설계 명세이며 코드 수정 0.** 실제 구현은 후속 패치(memory_v2_A4_impl) 에서.

---

## 0. 위치 — 두뇌 흐름 안에서의 A4

```
User Query
   │
   ├─► [A4 회수] ──► [A5 연관성 가드] ──► retrievedHints (≤ K)
   │                                              │
   ├─► planQuery(query, profile, location, memory, focus, retrievedHints) ◄┘
   │      │
   │      └─► steps (도구 계획)
   │
   ├─► runTools(steps)
   │
   └─► synth(query, results, style, retrievedHints, styleNote) ──► answer
```

- **호출 시점**: `runBrain` 진입 직후, `planQuery` 직전. **planQuery 와 병렬 가능**(아래 §6).
- **출력 위치**: `planQuery` 프롬프트의 새 섹션 `[관련 기억]` + `synth` 프롬프트의 1~2 줄 `[사용자 맥락]`.
- **회귀 무영향 원칙**: 회수 실패(타임아웃·임베딩 미준비·DB 빈) → 빈 배열 → 현재 흐름 그대로 (기존 `simLine` 패턴과 동일한 silent fallback).

---

## 1. 입력 / 출력 계약

### 1.1 입력 (A1 저장소에서)
- `episodes`              : 시계열 raw 대화 (요약 전). A4 는 *건드리지 않음* — A3(비동기 압축) 결과만 사용.
- `consolidated_memory[]` : `{ id, userId, summary, summaryVec, zoneKey?, jikgun?, topicKey?, lastSeenAt, refCount, sourceEpisodeIds[] }`
- `interest_topics[]`     : `{ topicKey, label, hotness, lastSeenAt, jikgun? }`  (hotness = EMA of refCount)
- `style_digest`          : `{ tone, length, dialect, prefs }` — A4 출력에 1 줄로 함께 실음.

### 1.2 출력 (A5 가드 통과 후)
```js
retrievedHints = {
  consolidated: [           // 상위 K=3~5
    { id, summary, score, ageDays, refCount, reasonTags }  // reasonTags: ["zone-exact","embed","recency"]
  ],
  hotTopics: [              // 상위 3
    { topicKey, label, hotness }
  ],
  styleNote: "짧고 단정. 거제 사투리 톤. 숫자·해구번호 선호.",
  meta: { latencyMs, stageCounts, droppedByA5 }
}
```
- **계약 키 안정성**: 모든 필드 누락 허용(`?.` 접근 안전). 빈 객체도 valid → planQuery/synth 가 분기 없이 받음.

---

## 2. 4 단계 하이브리드 회수 알고리즘

전 단계는 `consolidated_memory[]` 전체를 후보로 시작. 각 단계는 *후보를 줄이지 않고* **점수 컬럼을 누적**한다.
최종 점수 = `(stage1_exact ∨ stage2_embed) × stage3_recency × stage4_freq`.

### Stage 1 — 정확 매칭 (deterministic, ~5 ms)

```
score1[i] = 1.0 if any of:
              item.zoneKey   === queryCtx.zoneKey
              item.jikgun    === profile.jikgun
              item.topicKey  ∈ queryCtx.topicKeys   (룰베이스 직군 매트릭스 결과)
            else 0
```

- `queryCtx` 는 기존 `detectZoneDeterministic`, `detectJikgun`, `jikgunDigest` 결과를 그대로 재사용.
- 정확 매칭 항목은 항상 후보에 포함 보장(아래 union 규칙).

### Stage 2 — 임베딩 유사도 (~150~300 ms, 캐시 hit 시 ~5 ms)

```
qVec   = topic_embedding.embedQuery(query)        // 기존 LRU 캐시 재사용
score2[i] = cosine(qVec, item.summaryVec)         // [0, 1]
```

- **재사용**: `services/topic_embedding.js` 의 `embedQuery()` · `cosine()` · `EMBED_MODEL` (gemini-embedding-001, 3072d).
- **신규 인덱스 X**: `consolidated_memory.summaryVec` 는 A1/A3 가 저장 시점에 미리 임베딩해 둠(A1 계약). A4 는 *읽기 전용*.
- **임계**: `score2 ≥ 0.55` (토픽 임베딩 기존 임계와 정렬). 미만은 컷.

### Stage 3 — 시간 가중 (multiplicative, ~0 ms)

```
ageDays = (now - item.lastSeenAt) / 1d
recencyBoost =
   1.2  if ageDays ≤ 7
   1.0  if ageDays ≤ 30
   0.8  otherwise
```

- "사장님이 어제 한 말 > 한 달 전 말" 직관 반영.
- 0.8 floor — 오래된 기억도 정확 매칭이면 살아남게.

### Stage 4 — 빈도 가중 (logarithmic, ~0 ms)

```
freqBoost = 1.0 + 0.1 × min(1, log2(1 + refCount) / log2(11))
                 // refCount=10 일 때 ≈ 1.1 cap
```

- 자주 언급된 주제는 사용자 핵심 관심사 → 살짝 가중.
- cap 1.1 — 한 항목이 회수를 독점하지 않도록.

### 2.1 최종 랭킹

```
finalScore[i] = max(score1[i], score2[i]) × recencyBoost[i] × freqBoost[i]
candidates    = items where score1 == 1 OR score2 ≥ 0.55
top           = sort desc by finalScore, take K (default 4)
```

- **K 조정**: 직군 모니터형(local_gov, coast_guard) K=5, 일반 K=3.
- **다양성**: 같은 `topicKey` 인 항목은 상위 2 개로 제한(편향 방지).

### 2.2 핫 토픽 회수

```
hotTopics = interest_topics
            .filter(t => !profile.jikgun || t.jikgun === profile.jikgun || t.jikgun == null)
            .sort by hotness desc
            .take 3
```

- planQuery 의 기존 `[사용자 직군: ...]` 섹션을 **개인화**로 보강.

---

## 3. A5 연관성 게이트 (협업 — API contract)

A4 는 *후보를 만들고*, A5 가 *관련 없는 것을 잘라낸다*. 두 모듈은 다음 함수 시그니처로 결합.

```js
// A4 가 호출, A5 가 구현
const filtered = A5.filterRelevance({
  query, queryCtx, candidates: top, hotTopics
});
// → { consolidated: [...], hotTopics: [...], dropped: [{id, reason}] }
```

### 3.1 A5 의 책임 (이 문서는 *수신 인터페이스* 만 정의)
- 의도 분류(질문 의도 vs 항목 의도) 후 mismatch 제외.
- 도메인 격리: 해상 도메인 질의 ↔ 행정/일상 기억 교차 차단.
- 보안: PII/시크릿이 섞인 항목 — 답변 주입 금지(보안 v1 §35 와 정합).

### 3.2 회수↔가드 메시지 흐름
```
A4 → A5 : candidates (with reasonTags)
A5 → A4 : filtered  (with dropReasons for log)
A4      : meta.droppedByA5 = filtered.dropped.length
```

- A5 가 미준비(스텁) → `filterRelevance` 가 입력을 그대로 반환(passthrough). A4 단독 동작 보장.

---

## 4. 답변 프롬프트 주입 — 정확한 위치와 톤

### 4.1 planQuery 주입 — `[관련 기억]` 섹션

기존 `memLine` 직후에 새 섹션을 추가. 형식 예:
```
[관련 기억 (사용자 DB 회수, K=3) — 참고만 하고 수치는 도구 결과에서만]
- (zone-exact·embed) "사장님은 거제 동쪽 해구 320 ~ 325 를 자주 묻습니다." (7일전·×3)
- (embed) "낚시지수보다 부이 풍속을 더 신뢰합니다." (3일전·×2)
- (zone-exact) "관내=거제시 관할로 해석해 왔습니다." (1일전·×5)
[핫 관심사 top3] 부이 풍속 · 해구 랭킹 · 낚시 가능 판단
```

- **금지문**: 회수 항목이 도구 호출 args 를 *강제*하지 않도록 명시. "참고만, 수치는 도구 결과에서만" 한 줄.
- **분량 캡**: 각 항목 60 자, 전체 섹션 4 줄 이내(기존 `simLine` 분량과 정합).

### 4.2 synth 주입 — `[사용자 맥락]` 1~2 줄

synth 프롬프트 상단(역할 정의 직후):
```
[사용자 맥락] {styleNote}. 자주 관심: {hotTopics[0..1]}.
[관련 컨솔 요약] {consolidated[0..1].summary}
```

- `styleNote` = `style_digest` 한 줄 변환 ("짧고 단정. 사투리 톤 약함. 숫자 선호.").
- **톤 가이드만, 사실 주입 금지** — synth 가 retrievedHints 의 *내용*을 사실로 인용하지 않도록 프롬프트에 명시.

### 4.3 주입 우선순위 (충돌 시)
```
실제 도구 결과 > focus(직전 확정 대상) > memory(직전 대화 3 턴) > retrievedHints
```
- 회수 힌트는 *최약 우선순위*. 회귀 가드의 핵심.

---

## 5. 회귀 가드 — 회수 실패 시 무영향 보장

| 실패 모드 | 검출 | 동작 |
|----|----|----|
| `consolidated_memory` 비어있음 | `items.length === 0` | retrievedHints = {} → planQuery 분기 없이 그대로 |
| 임베딩 미준비 (`topic_embedding.isReady()===false`) | 기존 동일 | stage2 skip, stage1+3+4 만 |
| `embedQuery` 타임아웃 | 600 ms race | stage2 skip |
| A5 가드 예외 | try/catch | passthrough (= 가드 미동작과 동일) |
| 전체 회수 타임아웃 | 800 ms race | retrievedHints = {} |
| DB 읽기 오류 | try/catch | retrievedHints = {} + log |

- **invariant**: A4 의 *어떤 실패도* 기존 `planQuery → runTools → synth` 결과를 바꾸지 않는다.
- 회수 0건도 정상 — 그건 "관련 기억 없음" 이고, 사장님 요구 "관계없는 답 X" 와 정합.

---

## 6. 지연 영향 — 예산과 병렬화

### 6.1 단계별 비용 (단일 호출, 캐시 cold)

| 단계 | 측정 추정 | 비고 |
|----|----|----|
| Stage 1 (exact)         |   ~5 ms | in-memory filter |
| Stage 2 (embedQuery)    | 150–250 ms | gemini-embedding-001 1 회 호출 |
| Stage 2 (cosine N=수백) |   ~5 ms | 3072d × 수백 = O(M) |
| Stage 3+4 (boost)       |   ~1 ms | |
| A5 게이트               |  20–50 ms | 의도 분류 lightweight |
| **합계 (cold)**         | **180–310 ms** | |
| **합계 (LRU hit)**      |   **30–60 ms** | 같은 사용자 연속 질의 |

> 사장님 가정 "+200~400 ms" 와 일치. **본 설계 정합 OK.**

### 6.2 병렬화 — δ p95 게이트 충격 완화

```
const [plan, hints] = await Promise.all([
   planQuery(query, profile, location, memory, focus, /*hints=*/null),  // ① hints 없이 1차 plan
   retrieveBrain(query, queryCtx, profile)                                // ② A4 회수
]);
// hints 가 의미 있으면 plan 재계산 — 단, 정합 게이트 통과 시만(아래)
```

- **단순 직렬**: planQuery 가 hints 를 받아 LLM 1 회 호출 → +250ms (cold)
- **권장 병렬**: ① 과 ② 동시 → planQuery 가 끝난 직후 hints 가 *steps 를 바꿔야만* 재호출
  - 바꿀 조건: `hints.consolidated[0].reasonTags` 가 "zone-exact" 포함 & `plan.steps` 에 그 zone 미반영
  - 대부분의 경우 hints 는 synth 톤 가이드로만 쓰여 → planQuery 재호출 0
- **p95 영향 추정**: 병렬 + 조건부 재호출 → **+50~120 ms** (현실 95 percentile, embedQuery LRU 평균 hit 가정)

### 6.3 δ p95 게이트 반영
- p95 측정 프레임(v5_measurement_frame_*) 에 새 라벨 `retrieval_ms` 추가.
- 게이트 임계: **회수 ON ↔ OFF p95 차 ≤ +150 ms** 시 통과 (이상이면 stage2 비활성화 폴백).

---

## 7. 임베딩 캐시 확장 — `services/topic_embedding.js` 의 동적 인덱스

기존 캐시는 **빌드타임 정적** (169 토픽 + 20 도구). A4 는 **런타임 동적** 항목(사용자 episode 압축본)을 추가해야 한다.

### 7.1 확장 설계 (코드 수정 0 — 인터페이스 명세만)

```js
// services/topic_embedding.js 에 추가될 함수 (후속 패치)
addEpisodeVec(userId, episodeId, summary, vec)  // upsert
removeEpisodeVec(userId, episodeId)             // GC
nearestEpisodes(userId, query, k, minScore)     // 사용자별 격리 검색
```

- **격리**: `userId` 별 별도 인덱스 — 다른 사용자 기억이 새지 않게.
- **저장소**: `knowledge/graph/user_episodes/{userId}.json` (토픽 캐시와 같은 폴더 컨벤션).
- **GC**: A3(압축) 가 episode 를 consolidated_memory 로 통합하면 원본 episode 벡터 제거. consolidated 벡터만 유지.
- **모델 호환**: `EMBED_MODEL` 변경 시 사용자 인덱스 전체 무효화(기존 toplevel 캐시와 동일 정책).

### 7.2 메모리 영향
- 1 사용자 × 100 항목 × 3072 float32 = ~1.2 MB
- 사장님 단독 사용 가정 → 무시 가능. 다중 사용자 시 LRU 로 핫 사용자만 메모리 상주(설계 옵션).

### 7.3 회수 알고리즘과의 연결
- Stage 2 의 `consolidated_memory.summaryVec` 는 **A1 이 쓴 동일 모델 벡터** — addEpisodeVec 로 들어옴.
- 즉, A4 는 *벡터를 만들지 않고* A1 이 만든 벡터를 *읽기*만 함 → 책임 분리 명확.

---

## 8. 관측·로깅 — 사후 회귀 추적

`assistant_log` 에 다음 필드 추가:
```json
{
  "retrieval": {
    "latencyMs": 230,
    "candidates": 7,
    "topK": 3,
    "droppedByA5": 2,
    "topReasonTags": ["zone-exact", "embed"],
    "promptInjected": true,
    "planRecalled": false
  }
}
```
- A/B 비교(회수 ON/OFF) 용 라벨로 활용.
- "주입했는데 답이 동일" 케이스 검출 → 회수 무효 가설 검증.

---

## 9. 평가 — Phase 2b 골든셋과의 정합

- **회귀 가드 케이스**: 기존 phase2b_eval 골든 ≥ 95% 동일 답변 보장 (회수는 톤만 바꿈, 사실 X).
- **신규 회수 케이스** (별도 jsonl, 후속):
  - "어제 그 해구" → consolidated_memory 에 어제 해구 320 있으면 args 자동 채움
  - "전번에 말한 그 부이" → exact-match by 단어 "전번"+ buoy 키
  - "낚시 갈만 해?" + (사장님이 풍속 중시) → synth 가 풍속 한 줄 우선
- **무관 회수 차단 케이스**: "오늘 날씨" 에 행정 기억 회수 안 됨을 검증 (A5 게이트 시험).

---

## 10. 미해결·후속

- **A1 스키마 확정 필요** — `summaryVec` 저장 포맷(Float32Array vs base64) 결정.
- **A5 의도 분류기 선택** — lightweight 룰 vs LLM mini-call. A4 는 *어느 쪽이든* 동일 인터페이스.
- **다중 turn 회수** — 현재 설계는 *질의 1 회 회수 1 회*. 대화 누적 흐름에서 회수 반복 비용은 LRU 캐시로 흡수 가정. 후속 측정.
- **회수 결과 사용자 노출** — UI 에 "이 답변에 참고한 과거 대화" 표시는 본 단계 범위 X (privacy/UX 별도 결정).

---

## 핵심 결정 (한 줄)

**A4 는 4 단(exact ∪ embed) × (recency × freq) 점수로 K=3~5 회수 → A5 가 무관한 것 컷 → planQuery 의 새 `[관련 기억]` 섹션과 synth 의 `[사용자 맥락]` 1 줄에 *힌트로만* 주입하고, 실패·타임아웃·DB 빈 모두 silent fallback 으로 회귀 0 을 보장한다.**
