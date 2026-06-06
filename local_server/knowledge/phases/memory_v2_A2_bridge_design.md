# 사용자 기억 시스템 v2 — A2: 채팅 ↔ 음성 통합 브리지 설계

> **A 트랙(브리지)**. A1(저장소) 가정 위에서 채팅창(WebView)과 음성 비서(자바)가
> **하나의 영구 SQLite 를 공동 참조**하도록 잇는 브리지 설계서. 코드 수정 0건, 설계 전용.
> 기준일: 2026-06-06. 입력: `local_server/js/assistant.js`, `voice/VoiceAssistantService.java`,
> `voice/SeagnalAssistantPlugin.java`, `cross_cutting.md`.
>
> **사장님 요구(원문)**: "채팅·음성 둘 다 같은 영구 DB 참조하게."
> **현 갭**: 채팅은 `localStorage` 5키(`seagnal_profile`/`_memory`/`_style`/`_focus`/...),
> 음성은 자바 `private` 필드(`profileJson`, `lastFocusJson`, `recentMemory: ArrayDeque<8>`).
> **공유 0%, 재시작 시 음성쪽 휘발.**
>
> **A1 가정(이 설계가 의존하는 계약)**
> - 안드로이드: Room/SQLite `seagnal_memory.db` — 테이블 `profile(singleton)`,
>   `style_digest(singleton)`, `episode(id, ts, channel, zone, query, answer_short, focus_json, tools_json)`,
>   `episode_embedding(episode_id, vec)` (A4용).
> - 웹: IndexedDB 는 **세션 미러용 캐시만** (A1 의 "정본 = 안드로이드 SQLite" 원칙을 유지).
>
> **A4 가정**: `RelevantEpisodeRetriever` 가 `query → episode_id[] (topK)` 회수 두뇌를 노출.
> **A3 가정**: `Consolidator` 가 비동기 압축 두뇌(원시 episode → style_digest/profile 갱신).
>
> **cross_cutting.md 참조 정정**: 원 프롬프트의 "§6 음성 비서↔채팅 동등성" 라벨은 현
> 문서에 존재하지 않는다(§6 = 보안 격리). 동등성 요건은 §3 프라이버시(로컬 원칙) +
> §1 평가·회귀(불변식)의 교차 부산물로 명문화한다. → 본 문서 §7 회귀 가드로 반영.

---

## 1. 현 데이터 흐름 매핑 (As-Is 시퀀스)

### 1.1 채팅 흐름 — WebView ↔ `localStorage` 직결
```
[User]            [WebView assistant.js]          [Server /api/assistant/ask]
   │                       │                                │
   │  텍스트 입력          │                                │
   ├──────────────────────►│                                │
   │                       │ getProfile()  → localStorage   │
   │                       │ getMemory()   → localStorage   │
   │                       │ getStyle()    → localStorage   │
   │                       │ getFocus()    → localStorage   │
   │                       │                                │
   │                       │ POST {query, profile, memory,  │
   │                       │       style, location, focus}  │
   │                       ├───────────────────────────────►│
   │                       │                                │
   │                       │◄─── {answer, zone, focus, ...}─┤
   │                       │                                │
   │                       │ pushMemory("zone: 질문 → 답")  │  → localStorage
   │                       │ setFocus(d.focus)              │  → localStorage
   │                       │ updateStyleStats(d)            │  → localStorage
   │  TTS 재생             │ (8턴마다 refreshStyleDigest)   │
   │◄──────────────────────┤                                │
```
- 키: `seagnal_profile`, `seagnal_memory`(MAX 20), `seagnal_style`, `seagnal_focus`, `seagnal_natural_voice`.
- 저장 위치: **WebView 단독** `localStorage`. 자바·DB 접근 0.

### 1.2 음성 흐름 — 자바 RAM 단독
```
[User]      [VoiceAssistantService.java]        [Server /api/assistant/ask]
   │                  │                                  │
   │ "나리야"+질문    │                                  │
   ├─────────────────►│                                  │
   │                  │ profileJson    ← Intent EXTRA    │ (앱 enable 시 1회)
   │                  │ lastFocusJson  ← 자바 필드(휘발) │
   │                  │ recentMemory   ← ArrayDeque<8>   │
   │                  │                                  │
   │                  │ POST {query, profile, memory,    │
   │                  │       location, focus}           │
   │                  ├─────────────────────────────────►│
   │                  │                                  │
   │                  │◄─── {answer, zone, focus, ...}───┤
   │                  │                                  │
   │                  │ recentMemory.addLast(note)       │ (RAM)
   │                  │ lastFocusJson = focus.toString() │ (RAM)
   │                  │                                  │
   │ TTS 재생         │                                  │
   │◄─────────────────┤                                  │
```
- 저장 위치: **서비스 프로세스 RAM**. 서비스 종료/재부팅 = **전소실**.
- `style` 미동봉(채팅과 불일치 1: 음성에 말투 다이제스트 없음).
- `profile` 은 Capacitor `enable({profile})` 호출 시점에 **스냅샷**으로 1회 전달 — 채팅에서 프로필을 바꿔도 음성쪽 미반영(불일치 2).
- `recentMemory` 8건 vs 채팅 20건(불일치 3: 양쪽이 본 "최근 대화"가 다름).

### 1.3 핵심 단절점(요약)
| 항목 | 채팅 | 음성 | 단절 결과 |
|---|---|---|---|
| profile | localStorage 실시간 | Intent 스냅샷 | 음성이 옛 프로필 본다 |
| memory | localStorage 20건 | RAM 8건 | 같은 사용자 = 다른 기억 |
| style | localStorage + 8턴 갱신 | 미사용 | 음성에 말투 적용 0 |
| focus | localStorage 영속 | RAM 휘발 | 음성 재시작 시 "거기 경위도?" 끊김 |
| 영속성 | 휴대폰 잔존 | 프로세스 사망 시 0 | 음성 = 실질적 무기억 |

---

## 2. 신규 흐름 — 단일 진실 소스(SoT) 통합

### 2.1 원칙
1. **정본 = 안드로이드 SQLite 1개** (`seagnal_memory.db`, A1 스펙).
2. **음성 자바**: SQLite 를 **직접** 읽기/쓰기 (DAO 호출).
3. **채팅 WebView**: SQLite 접근을 `SeagnalAssistantPlugin` 의 신규 메서드로 **위임**
   (Capacitor bridge). WebView 의 IndexedDB 는 **세션 미러(읽기 캐시)** 로만 쓴다.
4. **회수 두뇌(A4)** 호출 진입점은 단일: `readRelevantEpisodes(query, limit)`. 채팅·음성
   양쪽이 같은 결과를 보장 → 동등성 회귀 가드(§7) 의 토대.
5. **압축 두뇌(A3)** 트리거도 단일: `triggerConsolidation()` 비동기. 채팅 8턴, 음성 8턴
   기존 정책을 그대로 유지하되 호출 진입점만 통일.
6. **마이그레이션**: 첫 실행 시 `localStorage` 5키를 SQLite 로 1회 이전 후 키 폐기.

### 2.2 신규 시퀀스 — 채팅
```
[User] [WebView assistant.js] [SeagnalAssistant Plugin] [Room DAO] [SQLite] [Server]
  │            │                       │                   │          │        │
  │ 텍스트     │                       │                   │          │        │
  ├──────────►│                       │                   │          │        │
  │            │ readUserProfile()     │                   │          │        │
  │            ├──────────────────────►│ profileDao.get()  │          │        │
  │            │                       ├──────────────────►├─────────►│        │
  │            │◄────────── profile ───┤◄──────────────────┤◄─────────┤        │
  │            │ readStyleDigest()     │  (병렬 호출)      │          │        │
  │            │ readRelevantEpisodes("거기 경위도", 5)    │          │        │
  │            ├──────────────────────►│ A4 retriever      │          │        │
  │            │◄────────── episodes ──┤                   │          │        │
  │            │                       │                   │          │        │
  │            │ POST {query, profile, memory=episodes,    │          │        │
  │            │       style, focus(last), location}       │          │        │
  │            ├──────────────────────────────────────────────────────────────►│
  │            │◄──────────── {answer, zone, focus} ─────────────────────────┤
  │            │                       │                   │          │        │
  │            │ appendEpisode(query, answer, zone, tools, channel="chat")    │
  │            ├──────────────────────►│ episodeDao.insert │          │        │
  │            │                       ├──────────────────►├─────────►│        │
  │            │                       │                   │          │        │
  │            │ triggerConsolidation() (8턴마다)          │          │        │
  │            ├──────────────────────►│ A3 압축 비동기    │          │        │
  │            │◄── ack ──────────────┤                   │          │        │
  │ TTS 재생   │                       │                   │          │        │
  │◄──────────┤                       │                   │          │        │
```

### 2.3 신규 시퀀스 — 음성 (자바 직결)
```
[User] [VoiceAssistantService] [Room DAO] [SQLite] [Server]
  │             │                  │          │        │
  │ "나리야"+   │                  │          │        │
  │ 질문        │                  │          │        │
  ├────────────►│                  │          │        │
  │             │ profileDao.get() │          │        │
  │             ├─────────────────►├─────────►│        │
  │             │◄─────────────────┤◄─────────┤        │
  │             │ styleDao.get()   │          │        │
  │             │ retriever.query(text, 5)    │        │
  │             │ focusDao.last()  │          │        │
  │             │                  │          │        │
  │             │ POST {query, profile, memory=episodes,│
  │             │       style, focus, location}        │
  │             ├─────────────────────────────────────►│
  │             │◄──── {answer, zone, focus} ─────────┤
  │             │                  │          │        │
  │             │ episodeDao.insert(query, answer,     │
  │             │   zone, tools, channel="voice")     │
  │             ├─────────────────►├─────────►│        │
  │             │                  │          │        │
  │             │ Consolidator.scheduleAsync() (8턴마다)│
  │ TTS 재생    │                  │          │        │
  │◄────────────┤                  │          │        │
```
**핵심**: 음성쪽은 Plugin 우회 — Room DAO 를 **같은 프로세스에서 직접** 호출. 동일 DB 파일
이므로 결과 동등성 보장. Plugin 은 **WebView 만** 거친다.

---

## 3. Capacitor Bridge API 신규 메서드 (이름·시그니처)

> 모두 `SeagnalAssistantPlugin` 에 `@PluginMethod` 로 추가. 인자/응답은 JSON.
> 자바측은 Room DAO 호출 (또는 A4 회수기·A3 압축기 위임).
> 비동기 오버헤드 완화는 §6(인-메모리 미러) 참조.

### 3.1 `readUserProfile() → JSON`
- **JS 시그니처**: `await SeagnalAssistant.readUserProfile() → { profile: object|null }`
- **자바**:
  ```java
  @PluginMethod
  public void readUserProfile(PluginCall call) {
      JSObject ret = new JSObject();
      ret.put("profile", MemoryRepository.get(getContext()).getProfile()); // JSObject or null
      call.resolve(ret);
  }
  ```
- **현 채팅 매핑**: `getProfile()` 의 localStorage 접근을 본 메서드로 치환.
- **반환 시간 SLO**: ≤ 5ms (단일 row 조회, 인덱스 PK).

### 3.2 `readStyleDigest() → JSON`
- **JS 시그니처**: `await SeagnalAssistant.readStyleDigest() → { style: object }`
- **자바**: `style_digest` 싱글톤 row 반환. 없으면 `{ totalQuestions:0, zoneCounts:{}, topicCounts:{} }`.
- **현 채팅 매핑**: `getStyle()` 치환. **음성쪽도** 동일 호출로 말투 동봉 가능(현재 불일치 해소).
- **반환 시간 SLO**: ≤ 5ms.

### 3.3 `readRelevantEpisodes(query: string, limit?: number) → JSON[]`
- **JS 시그니처**:
  ```ts
  await SeagnalAssistant.readRelevantEpisodes({ query, limit?: number })
    → { episodes: Array<{ id, ts, channel, zone, note }> }
  ```
- **자바**: A4 회수 두뇌(`RelevantEpisodeRetriever`) 호출 → topK episode 의 note 직렬화.
- **note 포맷**: 현 채팅·음성과 동일 — `"[zone:] \"query\" → answer(160자)"` (호환 유지로 서버 프롬프트 변경 0).
- **`limit` 기본값**: 8(현 음성 정책 = 양쪽 정렬). 채팅은 호출부에서 더 크게 줘도 됨.
- **현 채팅 매핑**: `getMemory()` 치환 — **단, 회수 두뇌가 단순 최근순이 아닌 의미검색을
  반환**(A4 가 그렇게 정의). 회수 두뇌 OFF(개발 플래그) 시 fallback = 최근 limit건 LIFO.
- **반환 시간 SLO**: ≤ 30ms (벡터 topK 8).

### 3.4 `appendEpisode(query, answer, zone, tools, channel) → void`
- **JS 시그니처**:
  ```ts
  await SeagnalAssistant.appendEpisode({
    query: string,
    answer: string,           // 호출자가 이미 160자 절단 권고(서버 응답 그대로면 자바가 절단)
    zone?: string,
    tools?: string[],
    channel: "chat" | "voice"
  }) → { id: number }
  ```
- **자바**:
  - `episode_id = episodeDao.insert(...)` (SQLite 트랜잭션 — §4).
  - 동일 트랜잭션에서 `focusDao.upsert(focus)` 도 받을 수 있게 옵션 인자 `focus?: object`
    추가(서버 응답의 d.focus 를 같이 묶어 보낼 때 1 호출로 끝남 → 호출 1회/턴 유지).
  - 임베딩(A4용)은 **post-commit** 워커가 채움 — 호출 자체는 동기 ack 후 즉시 반환.
- **반환 시간 SLO**: ≤ 10ms (insert + 트랜잭션 커밋).
- **호출자 책임**: 본 호출은 **append-only**. 압축은 별도(§3.5).

### 3.5 `triggerConsolidation() → void`
- **JS 시그니처**: `await SeagnalAssistant.triggerConsolidation() → { scheduled: boolean }`
- **자바**: WorkManager 또는 단일 백그라운드 Executor 에 `ConsolidationJob` enqueue.
  - 동일 작업 큐에 미완료 잡 있으면 **debounce**(머지) — 폭주 방어.
  - 잡은: 원시 episode 묶음 → A3 압축 두뇌 → `style_digest` upsert + 오래된 episode 요약화.
- **현 채팅 매핑**: `refreshStyleDigest()`(8턴마다) → 본 메서드 호출로 통일.
- **반환 시간 SLO**: ≤ 5ms(enqueue 만). 실제 압축은 비동기.
- **호출 빈도 정책**: 채팅·음성 모두 `episode` insert 시 **`(totalQuestions % 8) == 0` 인 턴
  뒤에 호출** — 양쪽 동일 카운터 = SQLite `style_digest.totalQuestions` 단일값 참조.

### 3.6 (보조) `migrateLocalStorageOnce(payload) → { migrated: bool }`
- 마이그레이션 1회용 — §5.

### 3.7 권한·CapacitorPlugin 어노테이션
- 새 메서드는 마이크 권한 무관 → `@CapacitorPlugin(permissions=...)` 추가 변경 0.
- 새 권한 0. 새 매니페스트 0.

---

## 4. Race Condition 방어 (채팅 ↔ 음성 동시 쓰기)

### 4.1 위협 모델
- **시나리오**: 사용자가 채팅으로 질문 보낸 0.5초 뒤 동승자가 "나리야~"로 음성 질문.
  서버 응답 2개가 거의 동시에 들어와 `appendEpisode` 2건이 충돌.
- **세부 충돌**:
  - (a) `episode` PK auto-increment — Room/SQLite 가 자동 직렬화 → 충돌 없음.
  - (b) `style_digest.totalQuestions` 증분 — read-modify-write **lost update 위험**.
  - (c) `focus` 싱글톤 upsert — 마지막 쓰기 wins → "음성 focus 가 채팅 focus 를 덮음" 가능.
  - (d) `profile` upsert — 채팅 설정 화면 vs 음성 추후 학습(예정).

### 4.2 방어 1 — SQLite 트랜잭션(Room `@Transaction`)
- 모든 쓰기 API(`appendEpisode`, `upsertProfile`, `triggerConsolidation` 내부 잡)는
  Room `@Transaction` 어노테이션 메서드 안에서 수행.
- SQLite 는 기본 직렬화(`SERIALIZABLE`) — write lock 으로 자동 직렬화.
- `style_digest.totalQuestions += 1` 은 트랜잭션 내 `SELECT ... ; UPDATE ...` 1쌍으로
  묶어 lost update 차단(또는 `UPDATE style_digest SET totalQuestions = totalQuestions + 1`
  한 줄 — 원자적, 권장).

### 4.3 방어 2 — Mutex/RWLock (process-wide)
- WebView 가 plugin 거쳐 들어오는 호출과 음성 자바가 직결로 들어오는 호출은 **동일 프로세스**.
  Room `@Transaction` 이 SQLite 잠금까지 처리하지만, **`focus` 싱글톤의 의미적 충돌**
  (음성 답변이 채팅 답변보다 늦게 오는데 `focus` 를 덮는 문제)은 트랜잭션으로 못 막는다.
- **해결**: `focus` upsert 시 **`epoch_ts` 비교 후 더 최신만 적용**.
  ```sql
  UPDATE focus SET json = ?, ts = ?
    WHERE id = 0 AND ts < ?
  ```
  (= conditional last-writer-wins by timestamp).
- 또는 `channel` 별 분리(`focus_chat`, `focus_voice`) 도 대안이나, 사장님 원칙 "둘 다 같은
  DB 참조" 의 의미가 약해짐 → **단일 focus + ts 가드** 채택.

### 4.4 방어 3 — Music lock (오디오 상태 잠금)
- 별도 mutex 가 아니라 **음성 비서가 SPEAKING 상태일 때 채팅 ask 보류 옵션**.
  사장님 표현 "music lock" 을 해당 의미로 해석: 한쪽이 발화 중이면 다른 쪽 발화 중복 차단.
- 구현: `VoiceAssistantService.state == SPEAKING` 동안 `SeagnalAssistant.audioBusy()` 가
  `true` → 채팅이 TTS 호출 보류 + 화면 표시만 갱신.
- **DB 쓰기는 막지 않는다** — TTS 충돌만 막는 UX 잠금이지 데이터 일관성과 무관.

### 4.5 방어 4 — `episode.idempotency_key` (네트워크 재시도)
- 네트워크 재시도로 같은 응답이 2번 들어와 `appendEpisode` 가 2번 불려도 중복 행 방지.
- 키 = `sha1(query + answer + channel + ts_minute)`. Room `@Index(unique = true)`.

### 4.6 검증 사례
| # | 시나리오 | 보장 |
|---|---|---|
| R1 | 채팅·음성 동시 ask, 응답 100ms 차로 도착 | episode 2건 모두 적재(트랜잭션 직렬), focus = 더 늦은 ts 만 적용 |
| R2 | 음성 답변 재시도 → 같은 episode 2회 insert 시도 | idempotency_key UNIQUE 로 2번째 차단 |
| R3 | 8턴 마다 압축 2번 호출(채팅·음성 같은 턴) | enqueue debounce 머지 — 잡 1개만 실행 |

---

## 5. 마이그레이션 순서 (첫 실행 1회)

### 5.1 트리거
- 앱 첫 부팅 또는 v2 첫 기동 시점에 WebView 가 가장 먼저 호출.
- 진입점: `assistant.js` 의 초기화 블럭 (현 `Native.enable({...})` 직전).

### 5.2 절차
```
1. localStorage 5키 읽기 (실패 무시):
   - seagnal_profile, seagnal_memory, seagnal_style, seagnal_focus, seagnal_natural_voice
2. 빈 객체면 skip — 신규 사용자.
3. SeagnalAssistant.migrateLocalStorageOnce({ profile, memory[], style, focus, naturalVoice })
4. 자바측:
   a. SQLite 가 비어있는지 확인(`profile == null && episode count == 0`).
      비어있지 않으면 = 이미 마이그레이션됨/혹은 음성이 먼저 학습됨 → 부분 병합:
         - profile 은 SQLite 의 것 우선(이미 사용자가 갱신했을 수 있음).
         - memory[] 는 episode 테이블에 append(채널 = "chat:legacy").
   b. style_digest, focus 도 동일 규칙으로 upsert/append.
   c. 단일 트랜잭션으로 묶음.
5. 성공 ack 받으면 localStorage 5키 삭제 + flag `seagnal_v2_migrated=1` 셋.
6. flag 있는 후속 부팅은 즉시 skip — 멱등.
```

### 5.3 실패 대응
- 4 단계 실패 시 localStorage 보존 + 다음 부팅 재시도.
- 5 단계는 4 성공 이후만 — **데이터 유실 0** 불변식.

### 5.4 롤백 경로
- 비상 시 디버그 플래그 `seagnal_v2_rollback=1` 로 IndexedDB 미러 → localStorage 역기록
  하는 헬퍼 1개 정의(코드 0건 — 본 설계서엔 인터페이스만).

---

## 6. WebView 측 단점 · 대안 (성능)

### 6.1 단점 — Capacitor bridge 비동기 오버헤드
- 채팅 1턴 = `readUserProfile + readStyleDigest + readRelevantEpisodes + appendEpisode
  (+ triggerConsolidation 8턴마다)` = **약 3~5 호출 / 턴**.
- 호출당 약 **5~10ms** (JNI + JSON 직렬화 + DAO).
- 최악 **40~50ms** 추가 — 자유변칙 p95 6712ms 목표(5000ms) 가뜩이나 초과 상황
  (cross_cutting.md §2 의 게이트 미달 항목)에서 추가 부담.

### 6.2 대안 — 1세션 분 인-메모리 미러(권고)
- WebView 측에 경량 캐시:
  ```js
  var MemoryCache = {
    profile: null, style: null, focusLast: null, episodes: null,
    primedAt: 0
  };
  ```
- **선읽기 일괄화**: 앱 부팅 시 1회 + 8턴마다 `prime()` — 4 메서드 병렬 호출 후 캐시 채움.
  ```js
  await Promise.all([readUserProfile, readStyleDigest, readRelevantEpisodes('', 8)])
  ```
- **턴마다는 캐시 사용** — bridge 호출 0 (∵ memory 의미검색은 채팅이 쓰는 케이스에선
  최근 8건 LIFO 로도 충분한 fallback, 정확도 손실은 매 턴 invalidate 로 보완).
- **쓰기는 캐시 + bridge 양쪽** — `appendEpisode` 호출하고 **동시에 캐시 head 에 push**
  (write-through). bridge 응답 대기 안 함(fire-and-forget) → UI 지연 0.
- **무효화**: 음성쪽이 episode 추가하면 `notifyListeners('episodesChanged')` 이벤트로
  WebView 캐시 무효화. → 동등성 유지(§7 가드).

### 6.3 잔여 위험
- bridge 호출이 캐시 미스로 떨어지는 첫 턴 = 50ms 추가. → 부팅 시 prime 으로 흡수.
- 이벤트 누락 시 stale cache → 다음 prime 또는 turn count gate 로 회복.

---

## 7. 회귀 가드 (단위 시나리오 3건)

> "기존 채팅 동작 무변경 + 음성 비서 동작 무변경 + 양쪽이 같은 데이터를 본다" 를
> 단위 테스트로 박는다. `phase0_runner.py` 의 보조 시나리오로 추가 권고
> (cross_cutting.md §1 평가·회귀 축).

### G1 — 채팅 기존 동작 무변경
- **셋업**: SQLite 비어있음. 사용자: "장목항 만조 시간".
- **기대**:
  - 응답 정상(zone=장목항, intent=tide).
  - `episode` 테이블에 1건 적재(`channel="chat"`, `query=장목항 만조 시간`).
  - `focus.ts` 신규.
  - **응답 본문은 A1 도입 전 골든셋 회신과 byte-equal**(`phase0_golden.jsonl` 해당 케이스).
- **회귀 판정**: 골든 회신 diff = 0.

### G2 — 음성 기존 동작 무변경
- **셋업**: 동일 SQLite 비어있음. 음성 "나리야 / 장목항 만조 시간".
- **기대**:
  - 응답 TTS 동일 텍스트(채팅과 byte-equal).
  - `episode.channel="voice"` 1건 적재.
  - 자바 `recentMemory` 의 RAM 보조 카피는 더 이상 **정본 아님** — SQLite read 가 정본.
- **회귀 판정**: G1 응답 텍스트 = G2 응답 텍스트.

### G3 — 양쪽이 같은 데이터를 본다 (cross-channel parity)
- **셋업**: 비어있는 SQLite.
  1. 채팅: "장목항 만조 시간" → episode#1.
  2. 음성: "거기 경위도?" (=후속 focus 이어붙이기 케이스).
- **기대**:
  - 음성 응답이 **장목항 좌표**를 정확히 회신(채팅이 적은 focus 를 음성이 읽음).
  - 역방향(음성 먼저 → 채팅 후속) 도 동일.
- **회귀 판정**: 응답에 좌표 토큰 포함 + zone="장목항". 실패 시 = SoT 미작동.

### G4 (보조) — 마이그레이션 멱등
- 1회 마이그레이션 → 재부팅 → 재마이그레이션 시도. `episode` 중복 0.

---

## 8. DoD (A2 완료 기준)
1. `SeagnalAssistantPlugin` 에 5개 신규 메서드(+1 보조) **시그니처 확정**(본 문서 §3).
2. Race condition 4종 방어 정책 명문화(§4) — 트랜잭션·ts 가드·music lock·idempotency.
3. 마이그레이션 절차 6단계 + 실패 롤백(§5) 명문화.
4. WebView 인-메모리 미러 권고 — 부팅 prime + write-through + 이벤트 무효화(§6).
5. 회귀 가드 G1·G2·G3 정의(§7) — `phase0_runner.py` 추가 사이트 지정.
6. 코드 수정 0건 — 인터페이스 계약만 박는다.

---

## 9. A1·A3·A4 와의 인터페이스 의존 요약
| 트랙 | 본 설계가 의존하는 표면 | 본 설계가 노출하는 표면 |
|---|---|---|
| A1 저장소 | `MemoryRepository` (Room DAO·Entity 5종) | 없음 — A1 정본 그대로 사용 |
| A3 압축 | `Consolidator.scheduleAsync()` | `triggerConsolidation()` (Plugin 진입) |
| A4 회수 | `RelevantEpisodeRetriever.query(text, k)` | `readRelevantEpisodes()` (Plugin 진입) |
| A1 마이그레이션 | DAO bulk insert / 멱등 PK | `migrateLocalStorageOnce()` (Plugin 진입) |

---

## 10. 변경 이력
| 날짜 | 변경 |
|---|---|
| 2026-06-06 | 문서 신설. A2 브리지 5메서드(+1) · race 4종 방어 · 마이그레이션 6단계 · 인-메모리 미러 · 회귀 가드 G1~G3 |
