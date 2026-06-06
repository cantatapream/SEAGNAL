# 사용자 기억 시스템 v2 — A3 압축·통합 두뇌 설계 (LLM Memory Consolidation)

> **스코프**: 코드 수정 0. 본 문서는 *설계*만 한다. A3 는 **A1 episodes(원본 누적) 저장소** 와 **A4 회수기**, **A5 연관성 가드** 사이에 끼어드는 *압축 두뇌* 로, 매 사용자 질문 후 신규 episode 와 기존 consolidated_memory 를 LLM 이 비교·합쳐 *DB 가 100건 질문 후에도 항목 수가 선형 폭발하지 않게* 한다.

---

## 0. 입력·출력·이웃 컴포넌트 (전역 가정)

| 컴포넌트 | 책임 | A3 와의 관계 |
|---|---|---|
| **A1 episodes**  | 원본 사용자 질문·답변 모두 누적 (덧붙임 only, 진실의 원천) | A3 입력 — 신규 1건 + 회귀 시 전체 재압축 풀 |
| **A2 토픽 모델** | episode 의 zone·tools·intent·키워드 추출 (LLM-lite 또는 결정론) | A3 입력 — `topic` 라벨 |
| **A3 (본 문서)** | 신규 episode + 기존 consolidated 상위 N 항목 → `merge / add / skip` 결정 → consolidated_memory 갱신 | — |
| **A4 회수기**    | 새 질문 들어오면 consolidated_memory 에서 관련 상위 N 회수 (코사인/태그 매칭) | A3 입력에 *기존 회수 결과 N 항목* 제공 |
| **A5 연관성 가드** | 비도메인 질문(예: 낚시 사용자가 환율 물음) 의 personal 컨텍스트 주입 차단 | A3 출력의 `action='skip'` 로 협업 — A5 가 비도메인 판정한 episode 는 consolidated 진입 자체 차단 |

A3 의 **단일 출력**: `consolidated_memory` 한 행을 (1) 새로 만들거나, (2) 기존 행과 합치거나, (3) 아무 것도 안 하거나 셋 중 하나.

기존 자산:
- 프런트 `local_server/js/assistant.js:169` `STYLE_REFRESH_EVERY=8` — 8건마다 말투 다이제스트 LLM 갱신 (기존 기성 모듈, A3 가 재사용).
- 백 `local_server/routes/assistant.js:2157` `synth` 프롬프트 — 답변 생성 LLM 호출. A3 는 이와 *별도* LLM 호출이지만 동일 `gemini.callGemini` 경로·동일 키 풀을 쓴다.

---

## 1. 트리거 시점 (When)

세 가지 후보 중 **하이브리드(실시간 가벼운 압축 + 주기적 깊은 압축)** 채택.

### 1.1 실시간(Always, async) — *매 질문* 직후 비동기

- 시점: `synth` 답변이 사용자에게 *반환된 직후* (응답 차단 X)
- 패턴: `res.json(answer); queueMicrotask(() => consolidateLight(newEpisode))` 또는 별도 워커 큐 enqueue
- 페이로드: **신규 episode 1건 + A4 가 회수한 상위 5건 (관련성 점수 ≥ τ_recall)**
- 출력: 단일 `{action, target_id?, ...}` JSON 한 줄
- 비용: LLM 호출 1회 (가벼운 모델 또는 BRAIN_MODEL flash 변형) — *사용자가 절대 기다리지 않음* (응답 후 백그라운드)

### 1.2 주기적 깊은 압축(Batch) — 일정 누적 시 *전체 풀 재정렬*

- 트리거 조건 (둘 중 빠른 쪽):
  - episodes 누적 **5건마다** (사용자별 카운터; 기존 `STYLE_REFRESH_EVERY=8` 와 동기 가능)
  - 또는 consolidated_memory 항목 수 ≥ **30** 도달 시 (오버플로 트리거)
- 동작: consolidated_memory 전체를 zone·topic 그룹으로 재클러스터링 → LLM 에게 *그룹별로 다시 압축* 시킴 → refCount 낮고 휘발성 높은 항목은 demote/drop
- 비용: LLM 호출 3~5회 (그룹 수) — 사용자 idle 시점에 백그라운드 cron (예: 새벽 03:00 KST) 또는 episode 5건째 직후 비동기

### 1.3 STYLE_REFRESH_EVERY=8 와 정합

- `STYLE_REFRESH_EVERY=8` 은 *말투 다이제스트* 갱신 주기. A3 의 *주기적 깊은 압축* 은 더 잦게(5건) — *말투* 보다 *지식 토픽* 이 더 자주 변하기 때문.
- 두 갱신은 **묶어서 한 LLM 콜로 합치지 말 것**. 입력 컨텍스트(전자: 토픽·tools·zone / 후자: 어휘·문체) 가 다르고, 결과 저장소도 다름(`consolidated_memory` vs `style_digest`).
- **그러나 트리거 카운터는 공유 권장**: 사용자별 `totalQuestions` 1개로 5/8 modulo 동시 평가 → DB 라운드트립 절약.

### 1.4 결정 사유

매 질문마다(1.1) 만 하면: 최신 episode 1건은 잘 처리되지만 *오래된 항목들 사이의 점진적 중복* 은 정리 안 됨 → 30건 천장 도달.
주기 압축만(1.2) 하면: 5건 누적 전까지 사용자는 *방금 말한 정보* 가 personal 컨텍스트에 안 박혀서 일관성 저하.
**둘 다** 채택해야 *실시간 정합 + 장기 부피 안정* 동시 달성.

---

## 2. 압축 LLM 프롬프트 설계 (Real-Time Light Pass)

### 2.1 입력 페이로드

```json
{
  "newEpisode": {
    "id": 1234,
    "ts": "2026-06-06T09:12:30+09:00",
    "query": "거문도 부이 지금 파고?",
    "answer": "거문도 부이 현재 파고 1.2미터, 풍속 초속 7미터…",
    "zone": "남해서부앞바다",
    "tools": ["get_buoy_obs"],
    "intent": "obs",
    "channel": "voice",
    "topicHints": ["부이","파고","거문도"]
  },
  "existingMemory": [
    {"id": 11, "topic": "부이/파고 — 거문도", "zone": "남해서부앞바다",
     "summary": "거문도 부이 파고를 자주 확인. 1m 안팎이면 출항 결정.",
     "refCount": 4, "lastTs": "2026-06-04T08:10:00+09:00",
     "tags": ["부이","파고","거문도","출항판단"]},
    {"id": 7, "topic": "특보 — 풍랑", "zone": "남해서부앞바다",
     "summary": "풍랑특보 발효 시 출항 보류 패턴.",
     "refCount": 2, "lastTs": "2026-05-30T07:20:00+09:00",
     "tags": ["풍랑특보","출항보류"]}
  ],
  "interestTopics": { "부이": 8, "특보": 3, "조석": 1 },
  "styleDigest": "간결한 1~2문장 선호, 결정 단어 1회 포함",
  "userProfile": { "jikgun": "어선장", "homeZone": "남해서부앞바다" }
}
```

### 2.2 시스템 프롬프트 (한국어, 구조화 출력)

```
당신은 SEAGNAL "나리야" 의 사용자 장기기억 관리자입니다.
방금 신규 episode 가 발생했습니다. 기존 consolidated_memory (사용자 장기기억) 와 비교해,
신규 episode 가 *어디로 흡수되어야 하는지* 결정하세요.

[원칙]
1. 같은 zone + 같은 토픽이면 기존 항목과 merge (summary 갱신, refCount++).
2. 새 zone 또는 새 토픽이면 add.
3. 일회성·단발적·비반복 가능성 높은 질의(여행 정보·인사·잡담·비도메인)는 skip.
   - skip 이어도 A1 episodes 원본은 그대로 남아 있습니다. consolidated 만 안 들어갑니다.
4. 직군(어선장/낚시/해경)과 무관한 도메인은 skip 권장 (예: 어선장이 환율을 물었을 때).
5. summary 는 80자 이내 한 줄. "사용자가 ~를 자주 묻는다 / ~ 결정에 ~ 임계를 쓴다" 형태.
6. relevance_tags 는 3~5개. 한국어 단어, 검색 회수(A4) 가 쓰는 키.

[입력]
신규: <newEpisode JSON>
기존 메모리(상위 5건): <existingMemory JSON>
사용자 관심 토픽 카운트: <interestTopics>
사용자 직군: <userProfile.jikgun>

[출력 — JSON only, 다른 텍스트 금지]
{
  "action": "merge" | "add" | "skip",
  "target_id": <merge 일 때만 — 합칠 기존 항목의 id>,
  "new_summary": "<merge: 합쳐진 새 summary / add: 신규 summary / skip: 생략>",
  "new_topic": "<add 일 때만 — 신규 토픽 라벨>",
  "relevance_tags": ["…"],
  "reason": "<한 줄 — 왜 이 action 인지. 모니터링용>"
}
```

### 2.3 LLM 호출 파라미터

| 파라미터 | 값 | 사유 |
|---|---|---|
| model | `BRAIN_MODEL` (flash 우선) | synth 와 동일 풀. 압축은 *작은 모델*도 충분 — 추후 별도 `CONSOLIDATE_MODEL` 분리 옵션 |
| temperature | `0.0` | 같은 입력엔 같은 결정 — 회귀 가능성 |
| response_mime_type | `application/json` | 스키마 안정성 |
| caller | `Assistant-Consolidate` | 비용 트래킹 분리 |
| timeout | 4초 | 실패해도 사용자 응답엔 영향 없음 (async) |

### 2.4 컨텍스트 격리

§6 #24 와 동일 — 입력에 다른 사용자 데이터 절대 섞지 말 것. 사용자별 DB 격리 + LLM 프롬프트에 user_id 명시 금지(LLM 이 그걸 답에 적으면 누설). 출력 JSON 의 `reason` 도 사용자에게 절대 노출 안 함 — 서버 로그 only.

---

## 3. 3종 Action 룰 (Spec)

### 3.1 `action = "merge"`

- **조건 추천**: 신규 episode 의 zone == 기존 행 zone *그리고* tags 교집합 ≥ 2 (또는 `topic` 동일).
- **DB 효과**:
  ```sql
  UPDATE consolidated_memory
     SET summary    = :new_summary,
         tags       = :merged_tags,        -- 합집합
         ref_count  = ref_count + 1,
         last_ts    = NOW(),
         last_episode_id = :newEpisode.id
   WHERE id = :target_id
  ```
- **예시**:
  - 기존: "거문도 부이 파고 자주 확인. 1m 안팎 출항 결정."
  - 신규: "거문도 부이 지금 파고?" → 답 "1.2m"
  - 신규 merged summary: "거문도 부이 파고 상시 모니터, 1.2m 이하면 출항. refCount=5"

### 3.2 `action = "add"`

- **조건**: 새 zone 이거나 기존 어떤 항목과도 tags 교집합 < 2.
- **DB 효과**:
  ```sql
  INSERT INTO consolidated_memory
    (user_id, topic, zone, summary, tags, ref_count, last_ts, last_episode_id)
   VALUES (:uid, :new_topic, :zone, :new_summary, :tags, 1, NOW(), :ep_id)
  ```
- **예시**: 어선장이 처음으로 "동해 시정" 을 물음 → 새 topic "시정 — 동해" 추가.

### 3.3 `action = "skip"`

- **조건**:
  - 비도메인 (A5 가 미리 표시: `episode.domain='off'`)
  - 사용자가 *한 번* 묻고 다시 안 물을 가능성 높음 (예: "뽀로로 파크 어디?", 일회성 지명 검색)
  - LLM 이 reason 에 "단발성·비도메인·잡담" 중 하나 명시
- **DB 효과**: *없음*. A1 episodes 에는 원본 그대로 남음 — 나중에 사용자가 *유사 질문 재발* 시 A4 회수에서 이 episode 가 잡힐 가능성 있고, 두번째 episode 부터는 LLM 이 add 로 승격 가능.
- **안전망**: skip 도 *episode 카운터는 증가* — 주기 압축(§1.2) 트리거 영향 받음. interest_topics 갱신은 *zone 만* 반영 (topic 은 X) — 잡담이 관심사로 오인되지 않도록.

---

## 4. interest_topics 갱신 룰

`interest_topics` 는 `{ "토픽": 카운트 }` 사용자별 누적 맵. A1/A2/A3 모두 갱신 가능.

| 시점 | 행위 |
|---|---|
| A2 episode 적재 | `zoneCounts[zone]++` (결정론적, A3 와 무관) |
| A3 `action=merge` | merged `relevance_tags` 각 태그 +1 |
| A3 `action=add`   | `new_topic` 라벨 +1, tags 각각 +1 |
| A3 `action=skip`  | zoneCounts 만 +1 (위 A2 단계와 중복 시 한 번만) — topicCounts 변경 X |
| 주기 압축 | 항목 drop 시 해당 tags 카운트는 *유지* (관심사 이력은 보존, 메모리만 정리) |

프런트 `js/assistant.js:202` `updateStyleStats(d)` 는 현재 클라이언트 로컬스토리지에 zoneCounts/topicCounts 누적. A3 는 *서버측 interest_topics* 를 **별도로** 운영 — 다단말 동기화 고려 (장기). 단기엔 클라이언트 갱신만 유지하고 A3 는 서버 DB 의 동일 스키마를 그림자처럼 채워 둠.

---

## 5. style_digest 갱신 주기

- **유지**: `STYLE_REFRESH_EVERY = 8` (현행).
- **위치 이동 권고(중장기)**: 현재 클라이언트에서만 갱신 → 서버로 흡수 권고. A3 와 같은 트리거(질문 후 비동기) 에 묶어, 8번째 episode 마다 LLM 1콜로 처리.
- **A3 와의 관계**: A3 의 LLM 출력 JSON 에는 *말투 변경* 정보 포함시키지 말 것. style_digest 는 별 LLM 호출. 이유: (1) 한 콜에 두 책임 묶으면 프롬프트 비대화, (2) 말투 변경은 더 천천히 변해도 됨.

---

## 6. LLM 비용·지연 분석

### 6.1 단일 질문당 LLM 콜 수 (현행 → A3 후)

| 항목 | 현행 | A3 도입 후 | Δ |
|---|---|---|---|
| synth (답변 생성) | 1콜 | 1콜 | 0 |
| 실시간 가벼운 압축 | 0 | **1콜 (async)** | +1 (사용자는 미체감) |
| style_digest 갱신 | 1콜 / 8회 = 0.125 | 0.125 | 0 |
| 주기 깊은 압축 | 0 | 3~5콜 / 5회 = 0.6~1.0 (async) | +0.8 |
| **합계 (평균)** | ~1.13 | **~3.0** (그중 1.875 가 async) | 사용자 체감 +0 |

### 6.2 지연 (사용자 체감)

- 실시간 압축 호출은 `res.json()` *이후* 시작 → **사용자 체감 0ms**.
- 주기 압축은 백그라운드 워커 또는 cron — *사용자 체감 0ms*.
- 단, 동일 사용자가 *2초 안에 연속 질문* 보내면, 직전 압축 콜이 끝나기 전 새 질문이 도착할 수 있음.
  - 정책: **재진입 큐** — 동일 사용자 압축은 *직렬화*. 새 episode 가 큐에 쌓이면 직전 압축 끝난 후 *통합 처리* (한 콜에 2건). 큐 깊이 ≥ 3 이면 가장 오래된 건 *주기 압축에 넘김*.

### 6.3 비용 (추정, Gemini Flash 기준)

- 실시간 압축 1콜: 입력 1.5K + 출력 0.3K 토큰 ≈ $0.0001/콜 = 무시 가능.
- 주기 압축 5콜: 입력 4K + 출력 1K ≈ $0.0005/회.
- *100회 질문* 시: 100 (실시간) + 20 (주기) = ~$0.02 — 1인 1일 비용으로 미미.

### 6.4 비동기 정당화

> "압축 LLM 호출이 +500~1000ms 더 들어도 사용자가 안 기다린다."

- synth 응답이 res.json() 으로 *먼저* 가고, 그 후 압축 호출이 시작되므로 사용자 TTFB·voice TTS 시작 시각 모두 영향 0.
- 단, *다음 질문이 들어왔을 때 이전 압축이 끝났다는 보장은 없음*. 그래서 다음 질문 시 A4 회수에는 *이전 압축이 반영되지 않은* consolidated_memory 가 들어갈 수 있음 — 허용. 그 결과로 *같은 topic 의 episode 가 일시적으로 중복 add* 될 수 있으나, 주기 압축에서 정리됨.

---

## 7. 회귀 가드 (Reliability)

### 7.1 압축 결과 부정확 시 fallback

- **A1 episodes 가 진실의 원천**. consolidated_memory 가 오염되어도 episodes 에서 *언제든 전체 재압축* 가능.
- 운영 명령(어드민 only):
  ```
  POST /api/admin/memory/reconsolidate  { userId, sinceTs }
  ```
  → A1 from `sinceTs` 모든 episode 를 빈 consolidated 위에 순차 압축 (LLM 콜 N회).

### 7.2 검증 LLM 1회 (Phase 2)

> "압축 결과 검증 LLM 1회 부터 도입 권고."

- **Phase 1 (지금)**: 미도입. 비용 절감, 회귀 가드는 A1 fallback 으로 충분.
- **Phase 2 (도입 권고 조건)**:
  - 운영 중 *오답 신고* 가 *컨텍스트 격리 위반* 또는 *잘못된 personal 주입* 으로 추적되면 도입.
  - 형태: 압축 LLM 출력 → 검증 LLM (작은 모델) 에 `{old_summary, new_summary, evidence_episode}` 를 주고 `{ok: bool, reason}` 만 받음.
  - 비용: 추가 1콜/episode = $0.0001 — 도입 부담 작음.

### 7.3 회귀 테스트 시드 (Golden)

신규 디렉터리 `local_server/knowledge/phases/memory_v2_consolidate_golden.jsonl` (다음 단계 작업):

```jsonl
{"name":"merge-same-zone-topic","input":{...},"expected_action":"merge","expected_target_id":11}
{"name":"add-new-zone","input":{...},"expected_action":"add"}
{"name":"skip-offdomain-fishing-asking-fx","input":{...},"expected_action":"skip"}
{"name":"skip-one-off-place-search","input":{...},"expected_action":"skip"}
{"name":"merge-with-tag-overlap","input":{...},"expected_action":"merge"}
```

CI: A3 LLM 호출을 *결정론 mock* 으로 대체 가능하도록 `gemini.callGemini` 에 `caller==='Assistant-Consolidate'` 분기 mock 훅 노출.

### 7.4 모니터링 시그널

- 사용자별 consolidated_memory 항목 수 분포 — 100건 질문 후 *상한 50건* 이내인지 (압축이 의도대로 작동하는지).
- `action` 분포 — `skip` 이 80% 이상이면 A2 토픽 추출이 부족하거나 LLM 이 보수적. `add` 가 80% 이상이면 merge 임계가 너무 빡빡.
- `refCount` 분포 — top-5 항목이 전체 refCount 의 50% 이상 차지하는지 (관심사 농도).

---

## 8. A5 연관성 가드와의 협업

A5 (별도 설계 — 본 문서 범위 밖) 는 사용자 *직군·관심사 화이트리스트* 를 기준으로 **신규 질문이 도메인 안인지** 판정.

| A5 출력 | A3 동작 |
|---|---|
| `domain='in'` (어선장이 파고 물음) | 정상 — LLM 압축 실행, action 자유 |
| `domain='off'` (어선장이 환율 물음) | **A3 LLM 호출 *스킵*** — episode 는 A1 에 적재되나 consolidated 진입 *자동 skip* (LLM 비용 절약) |
| `domain='uncertain'` | A3 LLM 호출. 단 시스템 프롬프트에 *"비도메인 가능성 의심 — skip 우선 검토"* 한 줄 prepend |

핵심: A5 가 *명확히 비도메인* 으로 라벨한 episode 는 **A3 LLM 콜 자체를 안 함** → 비용·지연 추가 절감.

또한 A3 출력 `action='skip'` 인 항목은 A5 학습 시그널로 *역공급* — 사용자별 "관심사 아님" 후보 토픽을 누적해서 A5 가 도메인 판정 임계를 자가조정.

---

## 9. 데이터 스키마 (참고 — A1 측 책임 영역)

본 설계가 의존하는 consolidated_memory 스키마 (A1 문서가 확정):

```sql
CREATE TABLE consolidated_memory (
  id              INTEGER PRIMARY KEY,
  user_id         TEXT NOT NULL,
  topic           TEXT NOT NULL,          -- "부이/파고 — 거문도"
  zone            TEXT,                   -- "남해서부앞바다"
  summary         TEXT NOT NULL,          -- ≤80자, A3 LLM 생성
  tags            TEXT NOT NULL,          -- JSON array
  ref_count       INTEGER DEFAULT 1,
  last_ts         TEXT NOT NULL,
  last_episode_id INTEGER,                -- FK → episodes.id
  created_ts      TEXT NOT NULL
);
CREATE INDEX idx_cm_user_zone ON consolidated_memory(user_id, zone);
CREATE INDEX idx_cm_user_lastts ON consolidated_memory(user_id, last_ts DESC);
```

A4 회수기 가 이 테이블에서 `user_id` + (zone match OR tag overlap) 로 상위 N 회수.

---

## 10. 단계적 도입 로드맵

| Phase | 내용 | 예상 LOC 추가 |
|---|---|---|
| 0 (본 문서) | 설계 확정 — 코드 변경 0 | 0 |
| 1 | A1 스키마 + A3 실시간 압축 LLM 호출 (백엔드 async 워커) | ~200 LOC |
| 2 | 주기 깊은 압축 + reconsolidate 어드민 API | ~150 LOC |
| 3 | A5 협업 라벨 입력 + 도메인 외 skip 단락 | ~80 LOC |
| 4 | 검증 LLM 1콜 (회귀 신고 누적 후 결정) | ~60 LOC |
| 5 | 회귀 골든 jsonl + CI 통합 | ~120 LOC |

---

## 11. 핵심 결정 (Quick Reference)

- **트리거**: 매 질문 후 *비동기 가벼운 압축 1콜* + *5건마다 주기 깊은 압축 3~5콜*. 사용자 응답 차단 0ms.
- **LLM 출력 스키마**: `{action: merge|add|skip, target_id?, new_summary?, new_topic?, relevance_tags[], reason}` JSON only, temp=0.
- **3종 action 기준**: zone+tag 교집합 ≥ 2 → merge / 없음 → add / 단발성·비도메인 → skip.
- **회귀 가드**: A1 episodes 가 원본 원천. 어드민 reconsolidate 로 언제든 처음부터 다시. 검증 LLM 은 Phase 2 보류.
- **A5 협업**: 비도메인 라벨 episode 는 A3 LLM 콜 *자체* 스킵.
- **비용**: ~$0.02 / 100질문 / 사용자. *사용자 체감 지연 0ms*.

---

### 한 줄 핵심 결정
**A3 = 매 질문 후 비동기 LLM 1콜로 신규 episode 와 기존 상위 5건을 `merge / add / skip` 셋 중 하나로 라우팅 + 5건마다 주기 깊은 압축 — A1 원본 보존으로 회귀 가드, A5 비도메인 라벨로 비용 단축.**
