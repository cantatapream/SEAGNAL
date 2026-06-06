# 사용자 기억 시스템 v2 — E3: Capacitor Bridge 5 메서드 통합 설계서

> **E 트랙(통합)**. E1(안드로이드 Room DAO·Entity) + E2(웹 IndexedDB 미러) + E_server(서버 측 풀 인입)
> 를 잇는 **다리 계층**. A2 브리지 설계서(`memory_v2_A2_bridge_design.md`)의 5 메서드 계약을
> 자바 Plugin·웹 헬퍼 두 갈래로 동시에 실체화하기 위한 **의사코드·시그니처·시퀀스 명세**.
>
> **본 문서 자체로는 코드 0건** — 다음 라운드(E_impl) 통합 시점에 본 의사코드를 그대로 옮긴다.
> 다만 본 라운드 산출물에는 **신규 JS 1개(`user_memory_bridge.js`)** 포함 — 자바 Plugin 직접
> 수정 금지 제약 하에서, 웹 측 호출 wrapper 는 사장님 지시에 따라 선반영한다.
>
> 기준일: 2026-06-06.
> 입력:
> - `local_server/knowledge/phases/memory_v2_A2_bridge_design.md` (Bridge API 5종 · race · 미러)
> - `local_server/knowledge/phases/memory_v2_A1_storage_design.md` (스키마 · 마이그레이션)
> - `android/app/src/main/java/com/seagnal/app/voice/SeagnalAssistantPlugin.java` (현 Plugin)
> - `android/app/src/main/java/com/seagnal/app/memory/UserProfileEntity.java` (E1 Entity 일부)
> - `local_server/js/assistant.js` (현 채널 호출 패턴)
>
> 제약(엄수):
> 1. 자바 Plugin **직접 수정 금지** — 본 문서는 의사코드만.
> 2. `local_server/js/assistant.js` **수정 금지** — 헬퍼는 신규 파일로만.
> 3. 신규 JS 1개 + 본 설계 md 1개 — 그 외 파일 0건.

---

## 0. 한눈에 — E3 결정 요약

| 축 | 결정 | 근거 |
|---|---|---|
| 자바 Plugin 표면 | A2 §3 의 5개 `@PluginMethod` + 보조 `migrateLocalStorageOnce` + 폴링 헬퍼 1개 = **총 7 메서드 의사코드** | A2 §3 계약 1:1, 비동기 race 가드는 §4 의 트랜잭션·ts 비교 호출 라인까지 구체화 |
| 비동기 처리 | `getCachedExecutorService()` 단일 백그라운드 풀, 결과는 `bridge.triggerJSEvent` 가 아닌 `call.resolve` 로 메인 스레드 복귀 | Capacitor 권장 — UI 스레드 차단 0, JSON 직렬화 비용은 풀 안에서 처리 |
| 웹 헬퍼 채널 | `window.Capacitor?.isNativePlatform()` 분기. 안드로이드 → Plugin, 웹/PWA → `user_memory_web.js`(E2 산출물) | A2 §1.3 의 "Plugin 은 WebView 만 거친다" 원칙 + IndexedDB 폴백 |
| 캐시 모델 | 모듈 스코프 `MemoryCache` 객체 — profile/style/focusLast 1슬롯 + episodes LRU(8) | A2 §6.2 의 인-메모리 미러 권고 |
| write-through 정책 | (1) 캐시 head push (즉시) → (2) IndexedDB write (await) → (3) Plugin 호출 (fire-and-forget) | UI 지연 0 + 다음 prime 까지 동등성 보장 |
| 이벤트 발행 | `appendEpisode` 성공 시 `window.dispatchEvent(new CustomEvent('episodesChanged', {detail:{episode,channel}}))`. Plugin 도 `notifyListeners('episodesChanged', ...)` 발행 — 음성쪽 쓰기를 WebView 가 수신 | A2 §6.2 무효화 정책 |
| Safari/Private 분기 | E2 산출물의 `user_memory_web.isAvailable()` 가 false 면 헬퍼는 `localStorage` 직읽기 + 쓰기 큐(메모리) 폴백 + 1회 토스트 신호 | A1 §1.2 폴백 정책 |
| 부팅 prime | 진입점 `primeUserMemory()` — 4 호출 병렬, 캐시 hydration, `seagnal_memory_primed` 이벤트 발행 | A2 §6.2 "선읽기 일괄화" |

---

## 1. SeagnalAssistantPlugin.java 확장 의사코드

> **현 파일**: `android/app/src/main/java/com/seagnal/app/voice/SeagnalAssistantPlugin.java` (177 LOC).
> **본 라운드 변경 0건** — 다음 라운드(E_impl) 가 그대로 이식.
> Entity 출처: `com/seagnal/app/memory/UserProfileEntity.java`, `InterestTopicEntity.java` (E1).
> DAO 진입점: `com.seagnal.app.memory.UserMemoryDao` (E1 라운드 산출 가정).
>
> 비동기 처리 원칙: **모든 DB I/O 는 `Executors.newSingleThreadExecutor()` 풀 안에서 수행**.
> 단일 스레드 풀 채택 이유 = A2 §4.2 의 SQLite write-lock 가드와 같이 가는 단순 직렬화.
> (Room 의 자체 비동기 API 를 써도 무방하나, race 가드는 본 풀이 더 단순.)

### 1.1 공통 임포트·필드 (의사코드)

```java
// 추가될 import 라인:
//   import com.seagnal.app.memory.UserMemoryDao;
//   import com.seagnal.app.memory.UserMemoryRepository;
//   import com.seagnal.app.memory.UserProfileEntity;
//   import org.json.JSONArray;
//   import org.json.JSONObject;
//   import java.util.List;
//   import java.util.concurrent.ExecutorService;
//   import java.util.concurrent.Executors;

// 클래스 멤버 추가:
private final ExecutorService memoryIo = Executors.newSingleThreadExecutor();
private UserMemoryRepository memoryRepo;   // load() 에서 lazy init
// 마지막 알려진 episode id — episodesChanged notify 시 페이로드로 사용
private volatile long lastEpisodeId = 0L;
```

`load()` 끝에 1줄 추가:
```java
this.memoryRepo = UserMemoryRepository.get(getContext()); // 싱글톤, E1 산출
```

### 1.2 `readUserProfile` — JS: `await SeagnalAssistant.readUserProfile()`

```java
@PluginMethod
public void readUserProfile(PluginCall call) {
    memoryIo.execute(() -> {
        try {
            UserProfileEntity row = memoryRepo.userMemoryDao().getProfile();
            JSObject ret = new JSObject();
            ret.put("profile", row == null ? JSObject.NULL : serializeProfile(row));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("readUserProfile_failed", e);
        }
    });
}

// 직렬화 — DDL snake_case → JS camelCase 매핑(웹 헬퍼와 합의)
private JSObject serializeProfile(UserProfileEntity e) {
    JSObject o = new JSObject();
    o.put("jikgun",          e.jikgun);
    o.put("defaultZone",     e.defaultZone);
    o.put("displayName",     e.displayName);
    o.put("answerStyle",     e.answerStyle);
    o.put("experienceYears", e.experienceYears);
    o.put("preferredFormat", e.preferredFormat);
    o.put("onboardedAt",     e.onboardedAt);
    o.put("updatedAt",       e.updatedAt);
    return o;
}
```
- **반환**: `{ profile: { jikgun, defaultZone, ... } | null }`.
- **SLO**: ≤ 5ms (싱글톤 PK 조회).
- **Race 가드**: 읽기는 SQLite 의 shared lock — 다른 쓰기 트랜잭션 중이라도 차단 없음.

### 1.3 `readStyleDigest` — JS: `await SeagnalAssistant.readStyleDigest()`

```java
@PluginMethod
public void readStyleDigest(PluginCall call) {
    memoryIo.execute(() -> {
        try {
            StyleDigestEntity row = memoryRepo.userMemoryDao().getStyleDigest();
            JSObject style = new JSObject();
            if (row == null) {
                style.put("totalQuestions", 0);
                style.put("zoneCounts",   new JSObject());
                style.put("topicCounts",  new JSObject());
            } else {
                style.put("totalQuestions",  row.totalQuestions);
                style.put("styleNote",       row.styleNote);
                style.put("preferredFormat", row.preferredFormat);
                // zoneCounts / topicCounts 는 별도 interest_topics 집계 (E1 DAO 가 제공)
                style.put("zoneCounts",  new JSObject(memoryRepo.zoneCountsJson()));
                style.put("topicCounts", new JSObject(memoryRepo.topicCountsJson()));
                style.put("updatedAt",       row.updatedAt);
            }
            JSObject ret = new JSObject();
            ret.put("style", style);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("readStyleDigest_failed", e);
        }
    });
}
```
- **반환**: `{ style: { totalQuestions, styleNote?, preferredFormat?, zoneCounts, topicCounts, updatedAt? } }`.
- **SLO**: ≤ 5ms.
- **누락 호환**: 채팅 `assistant.js#getStyle()` 의 빈 객체 형식과 byte-equal.

### 1.4 `readRelevantEpisodes` — JS: `await SeagnalAssistant.readRelevantEpisodes({query, limit})`

```java
@PluginMethod
public void readRelevantEpisodes(PluginCall call) {
    final String query = call.getString("query", "");
    final int limit = call.getInt("limit", 8);
    memoryIo.execute(() -> {
        try {
            // A4 회수 두뇌(RelevantEpisodeRetriever) 위임 — 미구현 시 fallback = 최근순
            List<EpisodeEntity> rows;
            if (memoryRepo.hasRetriever()) {
                rows = memoryRepo.retriever().query(query, limit);
            } else {
                rows = memoryRepo.userMemoryDao().latestEpisodes(limit);
            }
            JSONArray arr = new JSONArray();
            for (EpisodeEntity ep : rows) {
                JSONObject o = new JSONObject();
                o.put("id",      ep.id);
                o.put("ts",      ep.createdAt);
                o.put("channel", ep.sourceChannel);
                o.put("zone",    ep.zone);
                // 호환 노트 — assistant.js#pushMemory 의 포맷과 동일하게 직렬화
                o.put("note", (ep.zone == null ? "" : ep.zone + ": ")
                            + "\"" + ep.query + "\" → " + truncate(ep.answerSummary, 160));
                arr.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("episodes", JSObject.fromJSONObject(new JSONObject().put("a", arr)).getJSONArray("a"));
            // ↑ Capacitor JSObject 가 배열 직접 직렬화 미지원 → 임시 래핑/언래핑
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("readRelevantEpisodes_failed", e);
        }
    });
}

private static String truncate(String s, int n) {
    if (s == null) return "";
    return s.length() <= n ? s : s.substring(0, n);
}
```
- **반환**: `{ episodes: [{id, ts, channel, zone, note}, ...] }`.
- **SLO**: ≤ 30ms (벡터 topK 8) / 회수 OFF 시 ≤ 10ms.
- **호환**: `note` 포맷은 현 `pushMemory` 와 byte-equal → 서버 프롬프트 변경 0.

### 1.5 `appendEpisode` — JS: `await SeagnalAssistant.appendEpisode({...})`

```java
@PluginMethod
public void appendEpisode(PluginCall call) {
    final String query   = call.getString("query");
    final String answer  = call.getString("answer");
    final String zone    = call.getString("zone");
    final String channel = call.getString("channel", "chat");
    final JSArray toolsJs = call.getArray("tools");                // optional
    final JSObject focusJs = call.getObject("focus");              // A2 §3.4 옵션
    final long now = System.currentTimeMillis();

    if (query == null || answer == null) {
        call.reject("appendEpisode_missing_query_or_answer");
        return;
    }

    memoryIo.execute(() -> {
        try {
            // idempotency_key — A2 §4.5
            String key = sha1(query + "|" + answer + "|" + channel + "|" + (now / 60_000L));

            long id = memoryRepo.runInTransaction(() -> {
                long episodeId = memoryRepo.userMemoryDao()
                        .insertIfAbsent(EpisodeEntity.of(
                                query, truncate(answer, 600), zone,
                                toolsJs == null ? null : toolsJs.toString(),
                                channel, now, key));
                // style_digest 카운터 — atomic UPDATE 한 줄 (A2 §4.2)
                memoryRepo.userMemoryDao().incrementTotalQuestions(now);
                // focus 업서트 — ts 비교 후 최신만 (A2 §4.3)
                if (focusJs != null) {
                    memoryRepo.userMemoryDao().upsertFocusIfNewer(focusJs.toString(), now);
                }
                return episodeId;
            });

            lastEpisodeId = Math.max(lastEpisodeId, id);

            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);

            // post-commit: WebView 캐시 무효화 신호 (음성 측 쓰기일 때만 유효)
            JSObject evt = new JSObject();
            evt.put("id", id);
            evt.put("channel", channel);
            evt.put("ts", now);
            notifyListeners("episodesChanged", evt);

            // post-commit: 임베딩 워커 큐(A4) — 미구현 시 no-op
            memoryRepo.enqueueEmbedding(id);
        } catch (Exception e) {
            call.reject("appendEpisode_failed", e);
        }
    });
}
```
- **반환**: `{ id: number }`.
- **SLO**: ≤ 10ms.
- **Race 가드**: `runInTransaction` 으로 insert + counter + focus 3종 원자화.
  `idempotency_key UNIQUE` (E1 Entity 인덱스) 로 재시도 중복 차단.
- **호출자 책임**: 본 호출은 append-only — 압축은 `triggerConsolidation` 별도.

### 1.6 `triggerConsolidation` — JS: `await SeagnalAssistant.triggerConsolidation()`

```java
@PluginMethod
public void triggerConsolidation(PluginCall call) {
    memoryIo.execute(() -> {
        try {
            boolean scheduled = memoryRepo.consolidator().scheduleAsync(); // A3 산출
            JSObject ret = new JSObject();
            ret.put("scheduled", scheduled); // debounce 머지 시 false
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("triggerConsolidation_failed", e);
        }
    });
}
```
- **반환**: `{ scheduled: bool }`.
- **SLO**: ≤ 5ms (enqueue 만).
- **호출 빈도**: 채팅·음성 모두 `(totalQuestions % 8) == 0` 인 턴 뒤 — debounce 머지가 폭주 차단.

### 1.7 `migrateLocalStorageOnce` — 보조 (A2 §3.6)

```java
@PluginMethod
public void migrateLocalStorageOnce(PluginCall call) {
    final String profileJson  = call.getString("profile");
    final JSArray memoryArr   = call.getArray("memory");
    final String styleJson    = call.getString("style");
    final String focusJson    = call.getString("focus");
    final String naturalVoice = call.getString("naturalVoice");

    memoryIo.execute(() -> {
        try {
            boolean migrated = memoryRepo.runInTransaction(() -> {
                // 5.2.4 의 부분 병합 규칙: profile 은 SQLite 의 것 우선
                boolean did = false;
                if (memoryRepo.userMemoryDao().getProfile() == null && profileJson != null) {
                    memoryRepo.userMemoryDao().upsertProfileFromJson(profileJson);
                    did = true;
                }
                if (memoryArr != null) {
                    for (int i = 0; i < memoryArr.length(); i++) {
                        memoryRepo.userMemoryDao().insertLegacyEpisode(
                                memoryArr.getString(i),
                                System.currentTimeMillis() - (memoryArr.length() - i) * 60_000L
                        );
                        did = true;
                    }
                }
                if (styleJson != null) {
                    memoryRepo.userMemoryDao().upsertStyleFromJson(styleJson);
                    did = true;
                }
                if (focusJson != null) {
                    memoryRepo.userMemoryDao().upsertFocusIfNewer(focusJson, System.currentTimeMillis());
                    did = true;
                }
                // naturalVoice 는 user_profile.answerStyle 이 아닌 별도 setting 키 (E1)
                if (naturalVoice != null) {
                    memoryRepo.userMemoryDao().putSetting("naturalVoice", naturalVoice);
                    did = true;
                }
                return did;
            });
            JSObject ret = new JSObject();
            ret.put("migrated", migrated);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("migrate_failed", e);
        }
    });
}
```
- **반환**: `{ migrated: bool }`.
- **멱등**: `getProfile() == null` 가드 + `idempotency_key` 가 재실행을 무해화.

### 1.8 (보조) `audioBusy` — A2 §4.4 의 music lock 신호

```java
@PluginMethod
public void audioBusy(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("busy", VoiceAssistantService.isSpeaking);
    call.resolve(ret);
}
```
- 별도 풀 불필요(휘발 플래그). 채팅이 TTS 직전 폴링 → 음성 발화 충돌 차단.

### 1.9 권한·매니페스트 영향

- 신규 권한 **0**. 매니페스트 변경 **0**.
- `@CapacitorPlugin(permissions = {...})` 도 그대로 — 마이크 권한과 무관.

### 1.10 의사코드 → 다음 라운드 체크리스트

| # | 항목 | 다음 라운드(E_impl) 작업 |
|---|---|---|
| 1 | UserMemoryRepository | E1 산출. DAO 묶음 + 트랜잭션 헬퍼 |
| 2 | UserMemoryDao | 위 의사코드의 모든 메서드 정의 |
| 3 | EpisodeEntity, StyleDigestEntity, FocusEntity | E1 산출 — A1 §2 DDL 1:1 |
| 4 | `JSObject ↔ JSONArray` 배열 직렬화 헬퍼 | Capacitor 의 `JSArray.from(list)` 활용 — 위 §1.4 의 임시 래핑 제거 |
| 5 | `sha1(...)` | `MessageDigest.getInstance("SHA-1")` 1줄 헬퍼 |
| 6 | A4 retriever 의 fallback 결정 | 본 라운드는 `latestEpisodes` 로 가정 |

---

## 2. JS 헬퍼 신규 파일 — `local_server/js/user_memory_bridge.js`

### 2.1 모듈 표면 (8 함수 — global `window.SeagnalMemory` 노출)

| # | 함수 | 의미 |
|---|---|---|
| 1 | `primeUserMemory()` | 부팅 1회 + 8턴마다 호출 — 4 호출 병렬 fetch 후 캐시 hydration |
| 2 | `getUserProfile()` | 캐시 → IndexedDB → Plugin 순 |
| 3 | `getStyleDigest()` | 동상 |
| 4 | `getRelevantEpisodes(query, limit)` | 의미검색 시 항상 fresh 호출(캐시 skip), 단 캐시 fallback 보유 |
| 5 | `appendEpisode(payload)` | write-through (캐시 + IndexedDB + Plugin 3중) |
| 6 | `triggerConsolidation()` | enqueue 만 — fire-and-forget |
| 7 | `migrateLocalStorageOnce()` | 첫 부팅 1회 |
| 8 | `isAudioBusy()` | 음성 발화 중 폴링 (TTS 충돌 가드 옵션) |

추가 1개(이벤트 발행): `onEpisodesChanged(handler)` — 구독자 등록 헬퍼.

### 2.2 채널 검출 분기

```
if (window.Capacitor?.isNativePlatform?.()) → channel = 'native'
else                                         → channel = 'web'
```
- `native`: `window.Capacitor.Plugins.SeagnalAssistant.*` 호출.
- `web`: `window.SeagnalMemoryWeb.*` 호출 (E2 산출 — 본 라운드는 미존재 가정 가능, 폴백 = localStorage).

### 2.3 캐시 객체

```js
var MemoryCache = {
  profile:    null,    // {jikgun, ...} | null
  style:      null,    // {totalQuestions, ...}
  focusLast:  null,    // 직전 턴 focus
  episodes:   [],      // LRU 8 — head 가 최신
  primedAt:   0,
  isStale:    true
};
```

### 2.4 write-through 흐름

```
appendEpisode(payload):
  // 1) 캐시 즉시 push (UI 일관성)
  MemoryCache.episodes.unshift(payload);
  if (MemoryCache.episodes.length > 8) MemoryCache.episodes.pop();
  if (payload.focus) MemoryCache.focusLast = payload.focus;

  // 2) IndexedDB write (await) — E2 산출. 미존재 시 localStorage 비상 큐
  await SeagnalMemoryWeb.appendEpisode(payload).catch(swallow);

  // 3) Plugin fire-and-forget — UI 지연 0
  if (channel === 'native') {
    Native.appendEpisode(payload).catch(swallow);
  }

  // 4) 이벤트 발행
  window.dispatchEvent(new CustomEvent('episodesChanged',
                                       { detail: payload }));
```

### 2.5 Safari/Private 폴백

```
isSupported():
  - native 채널이면 항상 true
  - 그 외 SeagnalMemoryWeb.isAvailable() 가 IndexedDB probe 결과 반환
  - false 면 → 헬퍼 내부 fallback:
      * 읽기: localStorage 5키 직접 read (legacy 호환)
      * 쓰기: 메모리 큐(`__pendingWrites`) 보관 + 1회 토스트 신호
              (window.dispatchEvent('memoryDegraded'))
      * 다음 prime 시 isAvailable() 재시도 → 큐 flush
```

### 2.6 부팅 prime 흐름

```
primeUserMemory():
  if (Date.now() - MemoryCache.primedAt < 5_000) return MemoryCache; // 폭주 가드
  var [profile, style, episodes] = await Promise.all([
    callRead('readUserProfile'),
    callRead('readStyleDigest'),
    callRead('readRelevantEpisodes', { query: '', limit: 8 })
  ]);
  MemoryCache.profile  = profile;
  MemoryCache.style    = style;
  MemoryCache.episodes = episodes || [];
  MemoryCache.primedAt = Date.now();
  MemoryCache.isStale  = false;
  window.dispatchEvent(new CustomEvent('memoryPrimed', { detail: MemoryCache }));
  return MemoryCache;
```

### 2.7 이벤트 무효화

- Plugin 이 발행하는 `episodesChanged` 를 `Capacitor.Plugins.SeagnalAssistant.addListener` 로 구독.
- 수신 시 `MemoryCache.isStale = true` → 다음 `getRelevantEpisodes` 가 캐시 skip + fresh fetch.

---

## 3. 부팅 prime 흐름 — 턴당 호출 0 목표

### 3.1 호출 사이트

- **앱 첫 부팅** (Capacitor `App.addListener('appStateChange')` 의 첫 active) → `primeUserMemory()`.
- **WebView 페이지 첫 로드** (`DOMContentLoaded`) → `primeUserMemory()`.
- **8턴마다** (`(totalQuestions % 8) === 0` 인 턴 끝에) → `primeUserMemory()`. 직전 `triggerConsolidation`
  과 같은 사이클에 묶음 — 압축 결과 반영을 다음 턴이 보장.
- **`episodesChanged` 이벤트 수신** → 다음 회수 호출 직전에 `isStale` 체크해 부분 prime.

### 3.2 1턴 내 호출 횟수 변화

| 단계 | 호출 횟수 | 비고 |
|---|---|---|
| **현 채팅 (localStorage 직결)** | 0 | bridge 없음 — 동기 read |
| **bridge 도입 + 캐시 OFF** | 4~5 / 턴 | A2 §6.1 의 40~50ms 추가 위협 |
| **bridge + 본 캐시 ON** | **0 / 턴** | 모두 캐시 hit. 8턴마다 1회 prime + 1 write/턴 (write-through) |

### 3.3 검증

```
assert(MemoryCache.primedAt > 0)
assert(getUserProfile() returns synchronously from cache)
assert(getRelevantEpisodes('아무거나', 8) returns from cache when !isStale)
```

---

## 4. 이벤트 발행 — `episodesChanged`

### 4.1 발행 측

| 측 | 시점 | 페이로드 |
|---|---|---|
| 자바 Plugin (음성 쓰기 → WebView 통지) | `appendEpisode` 트랜잭션 커밋 직후 | `{ id, channel:'voice', ts }` |
| JS 헬퍼 (채팅 쓰기 → 다른 컴포넌트 통지) | write-through 4단계 | 페이로드 전체 |

### 4.2 구독 측

```js
SeagnalMemory.onEpisodesChanged(function (detail) {
  // assistant.js (수정 금지 — 본 라운드 미구독)
  // 향후 admin.js, profileBox 등이 캐시 invalidate 용으로 구독
});
```

### 4.3 이벤트 라이프사이클 보장

- Plugin → WebView 전송은 Capacitor 의 `notifyListeners` 가 보장.
- WebView 내부는 `CustomEvent` + `window` 디스패치 — 단일 페이지 SPA 가정에서 무손실.
- 누락 회복: 다음 `primeUserMemory()` 가 isStale 무관 fresh fetch.

---

## 5. 단위 시나리오 (회귀 가드 — A2 §7 와 결합)

### 시나리오 S1 — 채팅 write → 음성 read (cross-channel parity)

```
[셋업] SQLite·IndexedDB 모두 비어있음.

T0: 채팅에서 사장님 "장목항 만조 시간".
T1: assistant.js 가 서버 응답 수신.
T2: (가상 호출 — assistant.js 수정 금지이므로 본 시나리오는 헬퍼 사용자가 호출한다고 가정)
    SeagnalMemory.appendEpisode({
      query: '장목항 만조 시간',
      answer: '...160자...',
      zone: '장목항',
      channel: 'chat',
      focus: { zone:'장목항', lat:..., lon:... }
    });
    →
    (a) MemoryCache.episodes[0] = payload (즉시)
    (b) IndexedDB write (50ms 내)
    (c) Plugin.appendEpisode (200ms 내) — 같은 SQLite 트랜잭션으로 episode + focus + counter 적재
    (d) window.dispatchEvent('episodesChanged')

T3: 음성 비서 "나리야 / 거기 경위도?"
    VoiceAssistantService 가 직결로:
      profile = UserMemoryDao.getProfile()                                  → 매칭
      style   = UserMemoryDao.getStyleDigest()                              → 매칭
      eps     = RelevantEpisodeRetriever.query('거기 경위도', 8)            → episode#1 hit
      focus   = UserMemoryDao.getFocus()                                    → 장목항 좌표
    POST /api/assistant/ask 가 좌표 포함 응답.

[기대]
  - 음성 응답에 장목항 좌표 토큰 포함 ✅
  - episode 2건 (chat·voice) 적재 ✅
  - cross_cutting 동등성 가드 통과
```

### 시나리오 S2 — 음성 write → 채팅 새로고침 → 동기화

```
[셋업] SQLite 비어있음, IndexedDB 비어있음, 사용자가 채팅 페이지 열려 있음.

T0: 음성 "나리야 / 오늘 풍속".
T1: VoiceAssistantService 가 서버 응답 받고 직결 UserMemoryDao.insertEpisode(channel='voice').
    트랜잭션 커밋 직후 SeagnalAssistantPlugin.notifyListeners('episodesChanged', ...).

T2: 채팅 WebView 가 'episodesChanged' 수신:
    MemoryCache.isStale = true.

T3: 사용자가 채팅에서 새 질문 "다음 날 풍속".
    SeagnalMemory.getRelevantEpisodes('다음 날 풍속', 8):
      isStale → fresh fetch via Plugin → episode#voice 회수.

[기대]
  - 채팅 응답이 "어제 음성으로 물어보신 풍속과 비교..." 형태로 자연스럽게 이어짐.
  - 채팅 페이지 새로고침 없이도 IndexedDB 미러는 prime 시 자동 동기화.
```

### 시나리오 S3 — 마이그레이션 (첫 실행)

```
[셋업]
  localStorage:
    seagnal_profile = { jikgun:'marine_leisure', defaultZone:'KR_S_SOUTH', ... }
    seagnal_memory  = [20건의 note 문자열]
    seagnal_style   = { totalQuestions:42, styleNote:'..', zoneCounts:{...} }
    seagnal_focus   = { zone:'장목항', ... }
    seagnal_natural_voice = '1'
  SQLite: 비어있음 (v2 첫 부팅).

T0: WebView 로드 시 SeagnalMemory.migrateLocalStorageOnce() 호출.
T1: 헬퍼가 localStorage 5키 read → 빈 객체면 skip.
T2: 헬퍼가 Plugin.migrateLocalStorageOnce({profile, memory, style, focus, naturalVoice}) 호출.
T3: Plugin 이 단일 트랜잭션으로:
    - user_profile 1행 INSERT
    - episodes 20행 INSERT (created_at = now - i*60_000, source_channel='chat')
    - style_digest 1행 INSERT
    - focus 1행 upsert (ts = now)
    - settings naturalVoice='1'
T4: Plugin resolve → 헬퍼가 localStorage 5키 DELETE + seagnal_v2_migrated=1 SET.
T5: 다음 부팅: 헬퍼가 flag 확인 → skip.

[기대]
  - 데이터 유실 0
  - 재실행 멱등: 같은 마이그레이션 페이로드를 한 번 더 보내도 SQLite 변화 0
    (UserMemoryDao.getProfile() != null 가드 + idempotency_key UNIQUE)
  - localStorage 90일 보존 정책은 본 헬퍼 범위 외 (A8 트랙).
```

### 시나리오 S4 (보조) — Safari Private (IndexedDB 쿼터 0)

```
[셋업] Safari Private 탭, native bridge 없음.

T0: primeUserMemory() 호출.
T1: SeagnalMemoryWeb.isAvailable() = false (IDB.open 실패).
T2: 헬퍼 fallback:
    - read: localStorage 5키 직접 read (legacy 호환)
    - write: 메모리 큐(__pendingWrites) 보관
    - 1회 'memoryDegraded' 이벤트 발행 → UI 토스트 (어시스턴트 페이지가 구독).
T3: 사용자가 일반 Safari 로 같은 페이지 다시 열면 IDB.open 성공 → 큐 flush.

[기대]
  - 동작은 작동 — 단 휘발 모드 안내가 사용자에게 표시.
  - cross_cutting §3 로컬 원칙 위반 0.
```

---

## 6. DoD (E3 설계 완료 기준)

1. SeagnalAssistantPlugin 5 메서드 + 보조 2 (migrate, audioBusy) **의사코드 시그니처 확정** — §1.
2. 채널 자동 검출(`Capacitor.isNativePlatform`) + IndexedDB 폴백 + write-through 3단 — §2.4·§2.5.
3. 부팅 prime + 8턴마다 + 이벤트 무효화 = **턴당 호출 0** 보장 — §3.
4. `episodesChanged` 이벤트 발행·구독 명문화 — §4.
5. 단위 시나리오 S1·S2·S3 (+ 보조 S4) — §5.
6. 코드 수정 0건 (자바·assistant.js) — 본 문서 의사코드 + 신규 JS 1개만.

---

## 7. A1·A2·A4 와의 인터페이스 의존 요약

| 트랙 | 본 설계가 의존하는 표면 | 본 설계가 제공하는 표면 |
|---|---|---|
| A1 저장소 | DDL 스키마(`user_profile`, `style_digest`, `episodes`, `focus`) | 변경 없음 |
| A2 브리지 계약 | 5 메서드 시그니처 + race 4종 가드 + 미러 권고 | 5 메서드 의사코드 + JS wrapper 구체화 |
| A3 압축 | `Consolidator.scheduleAsync()` (debounce) | `triggerConsolidation` 진입점 |
| A4 회수 | `RelevantEpisodeRetriever.query(text, k)` | `readRelevantEpisodes` 진입점 + fallback(`latestEpisodes`) |
| E1 자바 | `UserMemoryRepository`, `UserMemoryDao`, Entity 5종 | 본 의사코드의 호출 라인 |
| E2 웹 | `SeagnalMemoryWeb.isAvailable / readX / appendEpisode` | `getUserProfile / getStyleDigest / ...` (8 함수) |
| E_server | 변경 없음(서버는 풀 payload 그대로) | 변경 없음 |

---

## 8. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-06-06 | 문서 신설. 자바 Plugin 7 메서드 의사코드 + JS 헬퍼 9 함수 + 시나리오 S1·S2·S3·S4 + DoD |
