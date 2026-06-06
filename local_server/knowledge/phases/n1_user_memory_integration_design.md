# N1 — 사용자 기억 v2 (Personal RAG) `routes/assistant.js` 통합 설계

> 트랙: **N1** · 상위 비전: "LLM 이 사용자에 대해 계속 공부하면서 매 질문마다 그 공부 내용을 보고 답한다."
> 작성일: 2026-06-06 · 상태: **설계 전용 (코드 수정 0건, 신규 md 1개)**
> 입력: `services/user_memory.js` (E_server 703 라인, 4 공개 함수) · `routes/assistant.js` (K 라운드 2859 라인) ·
>       `memory_v2_A1_storage_design.md` · `memory_v2_A2_bridge_design.md` · `memory_v2_A4_retrieve_design.md`
> 후속 트랙: N2 (실코드 적용 / 회귀 검증) · N3 (consolidate LLM DI / gemini_client 결합) · N4 (관측 라벨 추가)

---

## 0. 한눈에 — 통합 결정 요약

| 축 | 결정 | 근거 |
|---|---|---|
| **데이터 경로** | 클라이언트 (안드로이드 SQLite / 웹 IndexedDB) 가 `userMemorySnapshot` 으로 req.body 동봉 | A2 §2 SoT 정본 = 안드로이드 SQLite. 서버는 **stateless 유지** (PII 영속 0). |
| **회수 시점** | `runBrain` 진입 직후 · `planQuery` 직전 — **순차 호출** (병렬은 N2 측정 후 결정) | A4 §6.2 권장 "병렬 + 조건부 재호출". 본 라운드는 단순성 우선, p95 +50~120ms 허용. |
| **주입 위치 2 곳** | (a) `planQuery` 의 `simLine` 직후 `memorySection` 삽입 · (b) `synth` 의 `personal` 직후 `[사용자 맥락]` 삽입 | A4 §4.1 (planQuery 섹션) + §4.2 (synth 톤 가이드). 기존 simLine/personal 과 동일 패턴 — 회귀 표면적 최소. |
| **압축 시점** | `res.json()` 직후 `queueMicrotask` 비동기 (fire-and-forget) | A3 압축은 사용자 응답 차단 X. 설계 §0 "응답 후 비동기 공부". |
| **silent fallback** | `userMemorySnapshot` 없음/빈 객체 → user_memory 콜 skip, 기존 흐름 100% 보존 | DoD 86% 무회귀 가드. simLine/toolSimLine 패턴과 동일 (try/race timeout). |
| **focus.topic 시너지** | K2 의 `focus.topic` 을 `queryCtx.topicKeys` 1개로 prepend → A4 Stage1 정확매칭 부스트 | K2-N1 페어 — "직전 주제" 가 "장기 기억 회수" 의 검색 hint 로 기능. |
| **보안** | A5 게이트 + A6 5겹 누출 가드 모두 `user_memory.js` 내부에서 자동 적용 — assistant.js 측 추가 가드 0 | 책임 분리. assistant.js 는 silent fallback 만 보장. |

**한 줄**: 클라이언트가 보낸 사용자 기억 스냅샷을 받아 `planQuery` 직전 retrieveMemory 로 회수 → 두 prompt 에 silent 주입 → 응답 후 consolidateMemory 비동기. `userMemorySnapshot` 빈 입력엔 회귀 0.

---

## 1. 데이터 계약 — req.body 신규 필드

### 1.1 신규 필드 — `userMemorySnapshot`

클라이언트(안드로이드 자바 DAO 또는 WebView `idb`)가 **질의 직전** SQLite/IndexedDB 에서 미리 fetch 해 동봉.

```jsonc
// req.body
{
  "query": "오늘 어디서 잡힐까?",
  "profile": { /* 기존 */ },
  "memory":  [ /* 기존 — 최근 대화 자유텍스트, MAX 20 */ ],
  "style":   { /* 기존 */ },
  "location": { "lat": 34.7, "lon": 128.5 },
  "focus":   { "zone": "...", "topic": "참돔 미끼" /* K2 */ },

  // ── N1 신규 ──
  "userMemorySnapshot": {
    "consolidated": [             // A1 §2.5 consolidated_memory 상위 N (보통 50 ~ 100건 슬라이스)
      {
        "id": 17,
        "topic": "참돔 채비",
        "topicKey": "fishing_chamdom",
        "summary": "사장님은 거제 동쪽 해구 320~325 에서 참돔 미끼·채비를 자주 묻습니다.",
        "summaryVec": [ /* float32[3072] — gemini-embedding-001, A1 가 저장 시 미리 임베딩 */ ],
        "zoneKey": "KR_S_SOUTH",
        "jikgun": "angler",
        "tags": ["참돔", "채비", "거제"],
        "expected_intent": "info_lookup",
        "refCount": 7,
        "lastSeenAt": 1717545600000,
        "sourceEpisodeIds": [4, 11, 23]
      }
      // … 상위 N
    ],
    "interestTopics": [           // A1 §2.2 interest_topics 상위 (hotness desc, K=10)
      { "topicKey": "fishing_chamdom", "label": "참돔 미끼", "hotness": 0.82, "jikgun": "angler" }
    ],
    "styleDigest": {              // A1 §2.3 style_digest (단일 행)
      "tone": "짧고 단정",
      "length": "short",
      "dialect": "경상남",
      "prefs": ["숫자 선호", "해구번호 선호"]
    }
  }
}
```

### 1.2 선택 이유 — 왜 서버에서 직접 DB 안 읽나

- **stateless 서버 원칙** — A1 §0/§4 "정본 = 휴대폰 로컬, 서버 미동기화". 서버가 사용자 DB 를 읽으면 PII 가 서버 메모리에 진입.
- **A2 §2.1 SoT** — 안드로이드 SQLite 가 정본. WebView 는 미러 캐시. 서버는 **읽기 위임 0**.
- **클라이언트 측 retrieveMemory pre-fetch 패턴**:
  - 안드로이드: `SeagnalAssistantPlugin.askWithMemory(query)` 가 DAO 호출 → consolidated 상위 100 + interest_topics 상위 10 + style_digest 1 → JSON 직렬화 → POST.
  - WebView: `assistant.js` 클라이언트가 `idb.getAll()` 후 동봉 (Safari Private Mode 폴백 시 빈 객체).
- **회귀 보장** — 기존 클라이언트(필드 미동봉) 는 `userMemorySnapshot === undefined` → 본 설계 silent fallback → 100% 무회귀.

### 1.3 크기 가드 (서버 측)

```
const MAX_SNAPSHOT_BYTES = 256 * 1024;  // 256 KB — 100건 × 3072 float32 ≈ 1.2 MB → 클라이언트가 슬라이스
const MAX_CONSOLIDATED_ITEMS = 100;
const MAX_INTEREST_TOPICS    = 20;
```
- 초과 시 → `userMemorySnapshot = null` 로 강등 + `console.warn` (silent fallback 으로 회귀 0).
- 클라이언트는 **summaryVec 을 보낼지 말지** 옵션 — 없으면 A4 Stage2 임베딩 부족 → Stage1+3+4 만 동작 (A4 회귀 가드 §5 와 정합).

---

## 2. runBrain 흐름에 통합 — 3 위치

### 2.1 흐름도

```
POST /api/assistant/ask
  │
  ├─► req.body 파싱 (L2295~)
  │      ┝ query, profile, memory, style, loc, focus
  │      └─► [신규] userMemorySnapshot       ← (1.1) hunk 1
  │
  ├─► runBrain(query, profile, memory, style, loc, focus, userMemorySnapshot)
  │      │
  │      ├─► [P0 보안 거절] 동일
  │      │
  │      ├─► [N1 회수]  retrievedHints = await retrieveMemory(...)    ← hunk 2-a
  │      │      ┝ silent fallback: snapshot 빈 객체면 retrievedHints = {}
  │      │      └─► A5 게이트 내장 (user_memory.js)
  │      │
  │      ├─► planQuery(query, profile, location, memory, focus, retrievedHints)  ← hunk 2-b
  │      │      └─► prompt 안 memorySection (buildMemoryPromptSection 결과) 삽입
  │      │
  │      ├─► runTools(steps) ... 기존
  │      │
  │      ├─► synth prompt 빌드 — personal 직후 [사용자 맥락] 1~2줄 삽입  ← hunk 2-c
  │      │
  │      └─► return { answer, zone, toolsUsed, focus, ... }
  │
  ├─► res.json({ ok, answer, ... })          ← 응답 즉시 송출
  │
  └─► queueMicrotask(() => consolidateMemory(...))   ← hunk 3, fire-and-forget
```

### 2.2 회수 호출 — `runBrain` 시그니처 확장

```js
async function runBrain(query, profile, memory, style, location, focus, userMemorySnapshot) {
  // ... 기존 sec0 가드 ...

  // ── N1 회수 (silent fallback) ─────────────────────────────────────
  let retrievedHints = null;
  if (userMemorySnapshot
      && typeof userMemorySnapshot === 'object'
      && Array.isArray(userMemorySnapshot.consolidated)
      && userMemorySnapshot.consolidated.length > 0) {
    try {
      const jikgun = detectJikgun(profile);
      const zoneCanon = detectZoneDeterministic(query) || profileDefaultZone(profile);
      retrievedHints = await userMemory.retrieveMemory(
        query,
        {
          zoneKey: zoneCanon,
          jikgun,
          topicKeys: focus && focus.topic ? [focus.topic] : [],   // ← K2 시너지
          cq: query,
          // intent / isDomain / isSec 는 user_memory.js 내부 휴리스틱이 자체 분류
        },
        userMemorySnapshot,
        { jikgunMonitor: MONITOR_JIKGUN.has(jikgun) }
      );
    } catch (e) {
      console.warn('[N1] retrieveMemory threw → silent fallback:', e && e.message);
      retrievedHints = null;
    }
  }
  // retrievedHints 가 null/빈 객체이면 이하 모든 주입 분기에서 silent skip.

  const plan = await planQuery(query, profile, location, memory, focus, retrievedHints);
  // ... 기존 흐름 ...
}
```

### 2.3 핵심 제약

- **try/catch 가드**: retrieveMemory 가 throw 해도 (설계상 throw 금지지만 방어적) silent fallback.
- **A4 §6.1 cold 비용 180~310ms** 가 추가 — δ p95 게이트 (`cross_cutting §2`) +150ms 임계 내.
- **병렬 미적용 (이번 라운드)**: planQuery 와 동시 호출 가능하나, retrieveMemory 결과를 planQuery prompt 에 주입해야 하므로 단순 직렬. 병렬화는 N2 측정 후 결정.

---

## 3. 3 hunks 의사코드 — 라인 인용

### Hunk 1 — req.body 파싱 (L2295~ 영역)

```diff
  const query = (req.body && req.body.query ? String(req.body.query) : '').trim();
  // [개인화] 휴대폰에 저장돼 함께 전송된 프로필/메모리 (없으면 무시)
  const profile = (req.body && req.body.profile) || null;
  const memory = (req.body && Array.isArray(req.body.memory)) ? req.body.memory : null;
  const style = (req.body && req.body.style && typeof req.body.style === 'object') ? req.body.style : null;
  // 사용자 GPS 좌표(있을 때만) — "내 위치 가까운 부이" 류 질문에 사용
  const loc = (req.body && req.body.location && req.body.location.lat != null && req.body.location.lon != null)
      ? { lat: +req.body.location.lat, lon: +req.body.location.lon } : null;
  // [구조화 연속성] 클라가 돌려보낸 직전 턴의 주목 대상(해역/해구/부이/좌표) — 후속 해소용
  const focus = (req.body && req.body.focus && typeof req.body.focus === 'object') ? req.body.focus : null;
+ // [N1 — 사용자 기억 v2 스냅샷] 클라이언트(안드 SQLite / WebView IndexedDB)가 pre-fetch 한
+ //   consolidated_memory 상위 N + interest_topics + style_digest. 없으면 silent fallback.
+ //   서버는 stateless — 사용자 DB 직접 접근 X (A2 §2.1 SoT 안드로이드 정본 원칙).
+ const userMemorySnapshot = (() => {
+     const raw = req.body && req.body.userMemorySnapshot;
+     if (!raw || typeof raw !== 'object') return null;
+     // 크기 가드 — 256KB 초과 시 강등 (silent).
+     try {
+         const sz = JSON.stringify(raw).length;
+         if (sz > 256 * 1024) {
+             console.warn('[N1] userMemorySnapshot too large:', sz, 'bytes → drop');
+             return null;
+         }
+     } catch (e) { return null; }
+     // 항목 cap.
+     const cons = Array.isArray(raw.consolidated) ? raw.consolidated.slice(0, 100) : [];
+     const ints = Array.isArray(raw.interestTopics) ? raw.interestTopics.slice(0, 20) : [];
+     const sd = raw.styleDigest && typeof raw.styleDigest === 'object' ? raw.styleDigest : null;
+     if (cons.length === 0 && ints.length === 0 && !sd) return null;  // 완전 빈 → null
+     return { consolidated: cons, interestTopics: ints, styleDigest: sd };
+ })();
```

이후 `runBrain` 호출에 1개 인자 추가:

```diff
- const brain = await runBrain(query, profile, memory, style, loc, focus);
+ const brain = await runBrain(query, profile, memory, style, loc, focus, userMemorySnapshot);
```

---

### Hunk 2 — `runBrain` 의 `planQuery` 직전 + planQuery prompt 주입 + synth prompt 주입

**Hunk 2-a** — `runBrain` (L1789 직전) — 회수 호출

```diff
  async function runBrain(query, profile, memory, style, location, focus, userMemorySnapshot) {
      // [§6 #35 SEC P0 — L0 hard gate] ... 동일 ...
      const sec0 = classifySecurityIntent(query);
      if (sec0) { return { ... }; }
+
+     // ── [N1 — Personal RAG 회수] planQuery 직전, A4 + A5 (filterRelevance 자동) ──
+     //   silent fallback: snapshot 빈 → retrievedHints = null → planQuery / synth 무회귀.
+     //   타임아웃: user_memory.js 내부 A4_OVERALL_TIMEOUT_MS=800ms · embed 단독 600ms.
+     //   K2 시너지: focus.topic 을 topicKeys hint 로 → Stage1 정확매칭 부스트.
+     let retrievedHints = null;
+     if (userMemorySnapshot && userMemorySnapshot.consolidated && userMemorySnapshot.consolidated.length > 0) {
+         try {
+             const jk = detectJikgun(profile);
+             const zk = detectZoneDeterministic(query) || profileDefaultZone(profile);
+             retrievedHints = await userMemory.retrieveMemory(
+                 query,
+                 {
+                     zoneKey: zk,
+                     jikgun: jk,
+                     topicKeys: focus && focus.topic ? [String(focus.topic)] : [],
+                     cq: query
+                 },
+                 userMemorySnapshot,
+                 { jikgunMonitor: MONITOR_JIKGUN.has(jk) }
+             );
+         } catch (e) {
+             console.warn('[N1] retrieveMemory failed → silent fallback:', e && e.message);
+             retrievedHints = null;
+         }
+     }
+
-     const plan = await planQuery(query, profile, location, memory, focus);
+     const plan = await planQuery(query, profile, location, memory, focus, retrievedHints);
```

> 비고 — `detectJikgun` / `detectZoneDeterministic` / `profileDefaultZone` / `MONITOR_JIKGUN` 모두 기존 모듈 내 정의. `userMemory` 는 파일 상단 require 1줄 추가 필요(아래 N2 후속).

**Hunk 2-b** — `planQuery` 시그니처 + prompt 삽입 (L1542 / L1637 영역)

```diff
- async function planQuery(query, profile, location, memory, focus) {
+ async function planQuery(query, profile, location, memory, focus, retrievedHints) {
      // ... 기존 locLine / pzLine / memLine / focusLine / vocabLine / jikgunLine / simLine / toolSimLine ...

+     // ── [N1] 사용자 기억 v2 회수 결과 prompt 섹션. silent: 0 건 → '' ──
+     //   format: "[관련 기억 (사용자 DB 회수, K=N) — 참고만, 수치는 도구 결과에서만]"
+     //   주입 우선순위 (A4 §4.3): 도구 결과 > focus > memory > retrievedHints — 최약 우선.
+     const memorySection = retrievedHints
+         ? userMemory.buildMemoryPromptSection(retrievedHints)
+         : '';
+     const memoryLine = memorySection ? ('\n' + memorySection + '\n') : '';

      const prompt =
  `사용자의 한국어 질문에 답하기 위해 어떤 데이터를 가져올지 계획하세요.
  ... 규칙 ...
- ${...}${locLine}${pzLine}${focusLine}${memLine}${jikgunLine}${vocabLine}${simLine}${toolSimLine}
+ ${...}${locLine}${pzLine}${focusLine}${memLine}${jikgunLine}${vocabLine}${simLine}${toolSimLine}${memoryLine}
  사용자 프로필(참고): ${...}
  질문: "${query}"`;
```

> 위치 — 기존 `simLine` / `toolSimLine` 직후. simLine 이 "유사 관심사 임베딩 회수", memoryLine 은 "사용자 장기 기억 회수" — 의미 축 동일, 통상 패턴 정합.

**Hunk 2-c** — `synth` prompt 의 `personal` 직후 (L2173 영역)

```diff
  const personal = buildPersonalContext(profile, memory, style, cq);
+ // [N1] retrievedHints → synth 톤 가이드. styleNote + hotTopics 1~2 만, 사실 인용 금지.
+ //   buildMemoryPromptSection 은 동일 텍스트 (planQuery 와 공유) — synth 는 "톤 참고" 라벨.
+ //   A4 §4.2 — "사실 주입 금지, 톤 가이드만" 원칙 → prompt 안에 명시.
+ const memoryHint = retrievedHints
+     ? userMemory.buildMemoryPromptSection(retrievedHints)
+     : '';
+ const memoryHintBlock = memoryHint
+     ? `\n${memoryHint}\n[위 사용자 맥락은 톤·관심 분야 참고용. 수치·사실은 위 수집결과(JSON) 만 인용.]\n`
+     : '';
  const synth =
  `당신은 한국 어선·항해자·해양 종사자를 돕는 해양 기상 비서입니다.
  ... 4 가드 + 7 답 가이드 + Few-shot ...

- ${personal}
+ ${personal}${memoryHintBlock}
  질문: "${cq}"
  수집결과(JSON): ${JSON.stringify(results)}`;
```

> 비고 — `runBrain` 함수 내부 `synth` 빌드 지점이 retrievedHints 와 같은 스코프에 있으므로 클로저로 자연스럽게 캡처. (별도 인자 전달 불필요).

> **컨텍스트 격리 (G3 가드)** — cleanAnswer (L2256~) 의 라벨 필터 정규식에 `관련 기억` / `사용자 맥락` 추가:
> ```diff
> -        .filter(line => !/^\s*\[(최근 대화|직전 확정 대상|수집 데이터 인벤토리|유사 관심사|질의에 가까운 도구 후보|사용자 직군|관심사 지식|사용자 프로필|개인화)\b/.test(line))
> +        .filter(line => !/^\s*\[(최근 대화|직전 확정 대상|수집 데이터 인벤토리|유사 관심사|질의에 가까운 도구 후보|사용자 직군|관심사 지식|사용자 프로필|개인화|관련 기억|사용자 맥락|핫 관심사)\b/.test(line))
> ```
> GUARD_EXCLUDES (L234 영역) 에도 `[관련 기억]`, `[사용자 맥락]`, `[핫 관심사 top` 라벨 추가 — 사후검열 안전망.

---

### Hunk 3 — `res.json()` 직후 fire-and-forget consolidate (L2342 영역)

```diff
  return res.json({
      ok: true, zone: brain.zone, intent: 'brain', answer: brain.answer,
      data: { toolsUsed: brain.toolsUsed }, aiUsed: true, zoneFromProfile: false,
      links, tideSearch, corrected: brain.corrected || null, focus: brain.focus || null
  });
+
+ // ── [N1] 응답 후 비동기 압축 — fire-and-forget. 응답 차단 X. ──
+ //   queueMicrotask 로 다음 마이크로태스크 큐에 등록. consolidateMemory 가
+ //   LLM 4초 타임아웃 자체 보유 → 사용자 응답에 누적 지연 0.
+ //   silent: gemini 미주입 시 stub merge/add/skip 결정 (user_memory.js 내부).
+ //   클라이언트가 다음 질의에 갱신된 consolidated 를 동봉하도록 → 별도 endpoint
+ //   (POST /api/assistant/consolidate-result) 신설 권장 (N2 후속). 본 라운드는
+ //   서버측 LLM 결정만 만들고 응답 차단 0 보장.
+ queueMicrotask(async () => {
+     try {
+         if (!userMemorySnapshot) return;          // 스냅샷 없으면 압축 skip
+         const newEpisode = {
+             id: null,                              // 클라가 INSERT 후 채움
+             ts: Date.now(),
+             query, answer: brain.answer,
+             zone: brain.zone,
+             tools: brain.toolsUsed,
+             intent: 'brain',
+             channel: (req.headers['x-channel'] === 'voice') ? 'voice' : 'chat',
+             topicHints: brain.focus && brain.focus.topic ? [brain.focus.topic] : []
+         };
+         const existing = userMemorySnapshot.consolidated.slice(0, 5);
+         const decision = await userMemory.consolidateMemory(newEpisode, existing, {
+             gemini,                                // services/gemini_client 주입
+             brainModel: BRAIN_MODEL,
+             interestTopics: userMemorySnapshot.interestTopics || [],
+             styleDigest: userMemorySnapshot.styleDigest || '',
+             userProfile: profile || {},
+             a5Domain: brain.securityRefusal ? 'off' : 'in'   // P0 거절은 압축 skip
+         });
+         // 결정 자체는 서버가 보관 X (stateless). 다음 질의에 클라이언트가
+         // 별도 endpoint 로 pull 또는 SSE 로 push 받도록 N2 에서 결정.
+         // 본 라운드: assistant_log 에만 비식별 기록 (관측용).
+         if (decision && decision.action) {
+             console.log('[N1] consolidate decision:', decision.action, decision.reason || '');
+         }
+     } catch (e) {
+         console.warn('[N1] consolidate failed (non-blocking):', e && e.message);
+     }
+ });
```

> **회귀 무영향 보장** — `queueMicrotask` 내 throw 가 `res.json` 호출 후이므로 사용자 응답에 영향 X. 비동기 작업 실패도 console.warn 만 남기고 조용히 사망.

---

## 4. silent fallback — 회귀 무영향 보장

| 실패 모드 | 검출 위치 | 동작 |
|---|---|---|
| `userMemorySnapshot` 미동봉 | hunk 1 파싱 | `userMemorySnapshot = null` → hunk 2-a 분기 skip → 기존 흐름 100% |
| 스냅샷 256KB 초과 | hunk 1 크기 가드 | console.warn + null 강등 |
| `consolidated` 빈 배열 | hunk 2-a `length > 0` 가드 | retrievedHints = null → planQuery / synth 무주입 |
| `retrieveMemory` throw (방어) | try/catch | console.warn + retrievedHints = null |
| A4 내부 임베딩 미준비 | user_memory.js 자체 처리 | Stage 2 skip, Stage 1+3+4 만 동작 |
| A4 전체 타임아웃 (800ms) | user_memory.js `_withTimeout` | 빈 결과 반환 |
| A5 게이트 0건 통과 | user_memory.js 자체 처리 | `episodes: []` → buildMemoryPromptSection → `''` |
| `buildMemoryPromptSection` 0건 → `''` | 자체 | memoryLine = `''` → prompt 길이 무변동 |
| `consolidateMemory` 실패 | hunk 3 try/catch | console.warn, 응답 차단 0 |
| `gemini` 미주입 | user_memory.js stub fallback | merge by tag_overlap or add — 결정론 fallback |

**invariant**: `userMemorySnapshot === null` 또는 `userMemorySnapshot.consolidated.length === 0` 이면 기존 K 라운드 흐름과 **출력 동일**. DoD 86% 보존.

---

## 5. focus.topic 과의 시너지 — K2 ↔ N1 페어

### 5.1 시너지 채널

K2 의 `focus.topic` 은 **직전 1턴 주제 라벨** (synth 가 `[주제: 참돔 미끼]` 로 출력 → cleanAnswer 캡처 → 다음 턴 focus.topic 으로 전송). N1 은 이걸 retrieveMemory 의 hint 로 받아 회수 부스트.

```
[K2 직전 턴]          [N1 다음 턴]
synth 출력 [주제: 참돔 미끼]
    │
deriveFocus → focus.topic = "참돔 미끼"
    │
클라 저장 → 다음 POST 의 req.body.focus.topic
    │
runBrain → retrieveMemory(query, { topicKeys: ["참돔 미끼"], ... }, snapshot)
    │
A4 Stage 1 정확매칭 → consolidated 항목 중 topicKey="fishing_chamdom" 또는
                       tags 에 "참돔" 포함 → score1=1.0 부스트
    │
planQuery prompt 의 [관련 기억] 섹션 + [직전 확정 대상 — 주제=참돔 미끼] 동시 노출
    │
LLM 이 후속 질문 "오늘 어디서 잡힐까?" 를 자율적으로 "참돔 잡이"로 연결
```

### 5.2 라이브 검증 보강 — Q2b "참돔 후속 미끼" 회기

- **현 갭**: K2 만 단독 — focus.topic 라벨이 *프롬프트 1줄* 에만 표시 → LLM 이 "참돔 미끼" 라는 추상 라벨에서 *어떤 미끼·어떤 채비*로 자율 발산하기 어려움.
- **N1 보강**: retrieveMemory 가 `consolidated_memory` 에서 "사장님이 자주 묻는 채비/미끼 종류" 의 압축 summary 를 회수 → planQuery prompt 에 ≤60자 ×2~3 줄 노출 → LLM 이 *과거 누적 사용자 컨텍스트* 와 결합해 더 정확한 후속.
- **회수 임계 조정 X** — A4 §2.1 default K=4, monitor 직군 K=5 그대로. angler 직군 K=4 면 충분 (한 주제당 상위 2 다양성 cap).

### 5.3 충돌 회피

| 충돌 시나리오 | 해소 |
|---|---|
| focus.topic 이 잘못 캡처 ("동해 광역" 같은 잡음 라벨) | A5 게이트 — `_classifyQueryIntent` 가 "광역" 류를 info_lookup 으로 분류 → L3 매트릭스 0.6, A5_PASS_THRESHOLD 0.5 부근 → 자연스럽게 drop. |
| focus.topic 이 신규 사용자 첫 턴 | focus 자체 null → topicKeys = [] → 일반 회수 (Stage 2 임베딩만 의존). |
| topicKey 가 consolidated 와 불일치 (label vs key 차이) | A4 Stage 1 정확매칭 실패 → Stage 2 임베딩이 보강 → silent. |

---

## 6. 보안 — A6 5겹 누출 가드 자동 적용

### 6.1 user_memory.js 내부 (A5 / A6 가드)

| 가드 | 위치 | 동작 |
|---|---|---|
| L1 도메인 게이트 | A5 `filterRelevance` | queryCtx.isDomain 또는 META 의도 강제 1.0, off_domain → 즉시 차단 |
| L2 임베딩 임계 | A5 `_cosine` | sim < 0.65 → drop (표면 토큰 일치 시 0.55 floor) |
| L3 의도 양립 매트릭스 | A5 `L3_MATRIX` | admin_or_sec / off_domain → 0 행/열 (이중 안전망) |
| L4 사용자 명시 거부 | A5 `USER_OVERRIDE_RE` | "내 취향 무시" 류 → 회수 0건 강제 |
| 보안 의도 차단 | A5 `intent === 'admin_or_sec'` | 시크릿·관리자 질의 시 회수 0건 |

### 6.2 assistant.js 측 추가 가드 (hunk 2-c 안)

- **cleanAnswer 라벨 필터 확장** — `[관련 기억]`, `[사용자 맥락]`, `[핫 관심사 top` 추가 (G3 컨텍스트 격리).
- **GUARD_EXCLUDES 사후검열 확장** — 위 라벨 토큰을 부분일치 차단 후보로 (L234 영역).

### 6.3 PII 방어

- A1 §2.4 의 episodes 트림 규칙(좌표·전화·이메일·계정 식별자 저장 금지) 은 **클라이언트 측** 책임. 서버는 받은 스냅샷에 PII 가 섞여 있다고 가정하지 않음 — 단 silent fallback 의 한계 자체가 "PII 가 prompt 에 들어가도 우리 cleanAnswer/GUARD_EXCLUDES 가 라벨 인용 자체를 차단" 으로 2차 안전망 역할.

---

## 7. 응답 시간 영향 — δ p95 예산

### 7.1 단계별 비용 추정

| 단계 | cold | LRU hit | 비고 |
|---|---|---|---|
| Hunk 1 (파싱·크기가드) | < 5ms | < 5ms | JSON.stringify 1회 |
| Hunk 2-a (retrieveMemory 직렬) | 180–310ms | 30–60ms | A4 §6.1 |
| Hunk 2-b (planQuery prompt + 1줄) | + LLM 토큰 ~150 | + LLM 토큰 ~150 | prompt 분량 +4 줄 |
| Hunk 2-c (synth prompt + 1~2줄) | + LLM 토큰 ~80 | + LLM 토큰 ~80 | |
| Hunk 3 (consolidateMemory 비동기) | **0** | **0** | queueMicrotask, 응답 후 |
| **합계 (응답 차단 경로)** | **+50~120ms** | **+30~70ms** | A4 §6.2 권장치와 정합 |

### 7.2 δ p95 게이트

- `cross_cutting §2` p95 ≤ 5000ms 게이트 — 본 통합 후 추가 부담 +50~120ms.
- 현재 측정 (K 라운드) p95 ~ 3200ms → N1 적용 후 p95 ~ 3320ms 추정 — 게이트 통과 여유 충분.
- **회수 ON/OFF p95 차 ≤ +150ms** 라벨 게이트 (A4 §6.3) → N2 에서 측정.

### 7.3 압축 (hunk 3) 비용

- LLM 1콜 (≤4초 타임아웃) — **응답 차단 X** (queueMicrotask).
- 단, 동시 사용자 N 명 시 gemini API rate-limit 부담. gemini_client 의 429 backoff 가 흡수.
- 본 라운드는 압축 결정만 만들고 보관 X (stateless 유지). 클라이언트로 push 하는 endpoint 는 N2.

---

## 8. 회귀 가드 — DoD 86% 보존

### 8.1 무회귀 조건

1. **req.body.userMemorySnapshot 미동봉** (기존 클라이언트) → hunk 1 → null → hunk 2-a / 2-c skip → hunk 3 도 snapshot null 가드로 skip → **100% 무회귀**.
2. **userMemorySnapshot 동봉이지만 빈 객체** → hunk 1 검사로 null 강등 → 동일.
3. **retrieveMemory 0건 회수** → buildMemoryPromptSection → `''` → memoryLine `''` → prompt 분량·내용 무변동.

### 8.2 골든셋 가드

- 기존 `phase2b_eval` 골든셋 — `userMemorySnapshot` 동봉 X 로 실행 → 답변 100% 동일 보장.
- **회수 ON 셋** (별도 jsonl, N2) — 사장님 시나리오 3건 (아래 §10).

### 8.3 K2 무회귀

- focus.topic null/누락 → topicKeys = [] → A4 Stage 1 정확매칭에서 topic-exact reasonTag 만 미발생 → 회수 자체 정상 (Stage 2 임베딩이 흡수).
- focus.topic 만 활성 / userMemorySnapshot 미동봉 → K2 단독 동작 그대로.

---

## 9. 통합 점검표 — 코드 적용 시 (N2 라운드)

- [ ] `routes/assistant.js` 상단: `const userMemory = require('../services/user_memory');`
- [ ] Hunk 1 — req.body 파싱 영역에 userMemorySnapshot 파싱 + 크기가드.
- [ ] runBrain 시그니처에 `userMemorySnapshot` 인자 1개 추가.
- [ ] /api/assistant/ask 의 runBrain 호출에 인자 1개 추가.
- [ ] Hunk 2-a — runBrain 의 sec0 가드 직후, planQuery 직전 회수 호출 블록 삽입.
- [ ] planQuery 시그니처에 `retrievedHints` 인자 추가 (선택, default null).
- [ ] Hunk 2-b — planQuery prompt 의 simLine/toolSimLine 직후 memoryLine 삽입.
- [ ] Hunk 2-c — synth prompt 의 personal 직후 memoryHintBlock 삽입.
- [ ] cleanAnswer 의 라벨 필터에 `관련 기억|사용자 맥락|핫 관심사` 추가.
- [ ] GUARD_EXCLUDES 토큰 목록에 `[관련 기억]`, `[사용자 맥락]`, `[핫 관심사 top` 추가.
- [ ] Hunk 3 — res.json 직후 queueMicrotask consolidate 블록 삽입.
- [ ] 회귀: 기존 phase2b 골든셋 (userMemorySnapshot 미동봉) 100% 동일 답변 검증.
- [ ] 신규: 사장님 시나리오 3건 (§10) 회수 ON 검증.

---

## 10. 검증 시나리오 — 3 건

### 시나리오 (a) — 빈 userMemory + 새 사용자

- **입력**:
  ```jsonc
  { "query": "오늘 거제 앞바다 어때?",
    "profile": { "jikgun": "angler" },
    "memory": [], "focus": null,
    "userMemorySnapshot": null }
  ```
- **기대**:
  - hunk 1 → userMemorySnapshot = null.
  - hunk 2-a → retrievedHints = null → planQuery `retrievedHints=null` → memoryLine `''`.
  - hunk 2-c → memoryHintBlock `''`.
  - hunk 3 → snapshot null 가드 → consolidate skip.
  - **답**: K 라운드와 100% 동일 — "거제 앞바다 ... (도구 결과 기반)".
- **회귀 가드**: prompt 길이 (byte) diff = 0 검증.

### 시나리오 (b) — "참돔 자주 묻는 사용자" + "오늘 뭐 잡힐까?"

- **입력**:
  ```jsonc
  { "query": "오늘 뭐 잡힐까?",
    "profile": { "jikgun": "angler", "default_zone": "전남남해" },
    "focus": { "topic": "참돔 미끼" },     // K2 직전 턴 캡처
    "userMemorySnapshot": {
      "consolidated": [
        { "id": 17, "topic": "참돔 채비",
          "topicKey": "fishing_chamdom", "tags": ["참돔","채비","거제"],
          "summary": "사장님은 거제 동쪽 해구 320~325 에서 참돔을 자주 잡으십니다. 봄~초여름 선호.",
          "summaryVec": [...], "zoneKey": "KR_S_SOUTH", "jikgun": "angler",
          "expected_intent": "info_lookup", "refCount": 7, "lastSeenAt": 1717545600000 },
        { "id": 24, "topic": "물때 우선",
          "topicKey": "tide_priority", "tags": ["물때","사리"],
          "summary": "물때 표 기준으로 출조 시각 결정. 사리 직전 선호.",
          "summaryVec": [...], "refCount": 4, "lastSeenAt": 1717372800000 }
      ],
      "interestTopics": [
        { "topicKey": "fishing_chamdom", "label": "참돔 미끼", "hotness": 0.82, "jikgun": "angler" }
      ],
      "styleDigest": { "tone": "짧고 단정", "length": "short", "dialect": "경상남" }
    } }
  ```
- **기대 흐름**:
  - hunk 2-a → topicKeys=["참돔 미끼"] → A4 Stage 1 topic-exact 부스트 → consolidated id=17 score1=1.0.
  - planQuery prompt 안: `[관련 기억 (사용자 DB 회수 K=1) — 참고만, 수치는 도구 결과에서만]`
                         `- (topic-exact·embed) "사장님은 거제 동쪽 해구 320~325 에서 참돔을 자주 잡으십니다…" (7일전·×7)`
  - LLM 이 `get_fishing_index(location="거제 동쪽")` 또는 `get_zone_forecast(zoneId="325")` 호출 자율 선택.
  - synth prompt 안: `[사용자 맥락] 짧고 단정. 길이 short. 경상남. 자주 관심: 참돔 미끼.`
  - **답** (예): "거제 동쪽 해구 325 쪽은 오늘 파고 1.2미터, 풍속 초속 5미터로 잔잔합니다. 참돔 시즌 후반이라 만조 직전 1시간이 좋겠어요. 사리 직전이라 물때도 맞고요. 최종 판단은 선장님 몫."
- **K2 단독 vs K2+N1 비교**: K2 단독은 "참돔" 만 라벨로 노출. K2+N1 은 "거제 동쪽 해구 320~325 누적 선호" 까지 노출 → LLM 이 *지점 후보* 자체를 자율 좁힘.

### 시나리오 (c) — 비도메인 질의 (A5 게이트 차단)

- **입력**:
  ```jsonc
  { "query": "오늘 환율 얼마예요?",
    "profile": { "jikgun": "angler" },
    "userMemorySnapshot": {  // 같은 참돔 스냅샷
      "consolidated": [ { "id": 17, "topic": "참돔 채비", ... } ],
      "interestTopics": [ ... ], "styleDigest": { ... }
    } }
  ```
- **기대 흐름**:
  - hunk 2-a → retrieveMemory 호출.
  - user_memory.js 내부 `_classifyQueryIntent("오늘 환율 얼마예요?")` → '환율' 매칭 없음, info_lookup 으로 분류되나 queryCtx.isDomain 미명시.
  - A5 `filterRelevance` → L2 임베딩 sim ≈ 0.1 (참돔 ↔ 환율) → A5_SIM_MIN 0.65 미달 → 모두 drop.
  - 또는 L3 매트릭스: 항목 expected_intent=info_lookup × 질의 intent=info_lookup → 1.0 이지만 L2 게이트가 먼저 차단.
  - retrievedHints.episodes = [] → memoryLine = `''` → prompt 무영향.
  - synth G4 가드 → "환율은 해양·기상 도메인 아니에요" 거절 또는 "(일반 정보)" 라벨 답.
- **DoD 검증**: 회수 0건 / dropped > 0 로 meta 로깅 → A5 게이트 정상 동작 확인.

---

## 11. 관측 — assistant_log 라벨

```jsonc
{
  "n1_memory": {
    "snapshotBytes": 18472,
    "consolidatedCount": 12,
    "retrieved": 1,
    "droppedByA5": 0,
    "latencyMs": 87,
    "embedReady": true,
    "topicKeysHint": ["참돔 미끼"],
    "promptInjected": true,
    "consolidateAction": "merge",
    "consolidateTargetId": 17
  }
}
```

- A/B 게이트: 회수 ON ↔ OFF p95 차 측정.
- 회귀 가드: "주입했는데 답이 동일" 케이스 검출 (회수 무효 가설).

---

## 12. 미해결 · 후속

- **N2** — 실코드 적용. hunk 3개 + cleanAnswer/GUARD_EXCLUDES 라벨 가드. 회귀 골든셋 100%.
- **N3** — consolidateMemory 의 LLM DI (gemini_client) 결합. Phase 0 stub → 실제 호출.
- **N4** — 클라이언트로 consolidate 결정 push (별도 endpoint POST `/api/assistant/consolidate-result` 또는 SSE). 본 라운드는 서버 보관 X (stateless).
- **A1 스키마 확정** — summaryVec Float32Array vs base64 직렬화 (req.body JSON 화 영향).
- **client-side retrieveMemory 옵션** — 서버 부담 줄이려 회수 자체를 클라가 수행 후 retrievedHints 만 동봉. 본 설계는 "스냅샷 → 서버 회수" 단방향. N2 측정 결과에 따라 결정.

---

## 핵심 통합 결정 (한 줄)

클라이언트가 동봉한 `userMemorySnapshot` 으로 `runBrain` 의 planQuery 직전 1회 `retrieveMemory` → planQuery·synth 두 prompt 에 silent 주입 → 응답 후 `queueMicrotask` 로 `consolidateMemory` 비동기 — 빈 입력엔 100% 무회귀 (DoD 86% 보존).
