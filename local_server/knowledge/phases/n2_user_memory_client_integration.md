# N2 — 사용자 기억 v2 클라이언트 통합 설계 (Android Java Plugin + Web JS Bridge)

> **N 트랙(클라이언트 통합)**. A1·A2·A3·A4·E1·E2·E3 의 산출물 위에 **마지막 한 마디**를
> 더해 채팅 WebView·음성 비서 자바가 **단일 SQLite 정본**과 **단일 IndexedDB 미러**를
> 공동 참조하도록 하는 통합 설계서. 본 문서는 **설계 전용 — 코드 0건**. 다음 라운드(N_impl)
> 가 본 의사코드·hunk·플래그를 그대로 옮긴다.
>
> 기준일: 2026-06-06.
> 입력:
> - `local_server/knowledge/phases/memory_v2_A2_bridge_design.md` (Bridge API 5종 + race 4종)
> - `local_server/knowledge/phases/memory_v2_E3_bridge_impl.md` (Bridge 의사코드 시그니처)
> - `local_server/js/user_memory_bridge.js` (407 LOC — `window.SeagnalMemory` 9 함수)
> - `local_server/js/user_memory_web.js` (564 LOC — IndexedDB 미러 + localStorage 폴백)
> - `android/app/src/main/java/com/seagnal/app/memory/` (Entity 5 + Dao + Database — 7 파일)
> - `android/app/src/main/java/com/seagnal/app/voice/SeagnalAssistantPlugin.java` (177 LOC, 기존)
> - `android/app/src/main/java/com/seagnal/app/voice/VoiceAssistantService.java` (547 LOC, 기존)
> - `local_server/js/assistant.js` (927 LOC, 채팅 WebView)
> - `android/app/src/main/java/com/seagnal/app/MainActivity.java` (Capacitor BridgeActivity)
>
> **제약(엄수)**:
> 1. **직접 코드 수정 0건** — 본 문서는 의사코드·hunk·플래그만.
> 2. 신규 md **1개** (본 문서) — 그 외 산출물 없음.
> 3. 한국어 작성. 다음 라운드(N_impl)가 본 문서의 §1, §2, §3 hunk 를 그대로 적용.

---

## 0. 한눈에 — N2 결정 요약

| 축 | 결정 | 근거 |
|---|---|---|
| Plugin 메서드 추가 | **5 + 보조 2 = 7개** (`readUserProfile`, `readStyleDigest`, `readRelevantEpisodes`, `appendEpisode`, `triggerConsolidation`, `migrateLocalStorageOnce`, `audioBusy`) | A2 §3 계약 1:1 |
| 비동기 처리 | `ExecutorService memoryIo = Executors.newSingleThreadExecutor()` 단일 풀 | E3 §1.1 의 race 가드 단순화 — Room write-lock 과 정합 |
| Plugin 등록 | `MainActivity#onCreate` 의 `registerPlugin(SeagnalAssistantPlugin.class)` **재사용**. 신규 클래스 0 — 기존 Plugin 에 메서드 추가만 | 같은 `@CapacitorPlugin(name="SeagnalAssistant")` 안에 5 메서드 추가, JS 측 `Capacitor.Plugins.SeagnalAssistant.readUserProfile()` 자동 노출 |
| capacitor.config.json | **변경 0** | 신규 plugin 없음, 신규 권한 없음 — Capacitor 가 자동 클래스 검출 |
| 채팅(assistant.js) 통합 | (1) 페이지 로드 시 `SeagnalMemory.primeUserMemory()` 1회, (2) `doAsk` 직전 `userMemorySnapshot` 동봉, (3) 응답 후 `appendEpisode` + 8턴마다 `triggerConsolidation` fire-and-forget | A2 §6.2 인-메모리 미러 + write-through |
| 음성(VoiceAssistantService) 통합 | `askServer` body 에 동일 `userMemorySnapshot` 동봉, 응답 후 직결 `UserMemoryDao.appendEpisode()` (Plugin 우회) | A2 §2.3 — 음성은 Plugin 거치지 않고 같은 프로세스 DAO 직접 호출 |
| 마이그레이션 | `SeagnalMemory.migrateLocalStorageOnce()` 를 `setupNativeBridge()` 직전 1회 — `seagnal_v2_migrated=1` 플래그로 멱등 | A2 §5 6단계 + N_impl 라운드 위임 |
| APK 재빌드 | **자바 메서드 추가만 — 재빌드 필요** (Plugin 7 메서드 + VoiceAssistantService body 1곳) | 웹 JS 는 fly.dev 서버에서 자동 갱신 (재빌드 불필요) |
| 회귀 가드 | `userMemorySnapshot` 미동봉 시 서버 기존 흐름 보존 (서버는 신규 키 무시), 마이그레이션 실패 시 localStorage 보존(rollback 안전) | A2 §7 G1·G2·G3 |

---

## 1. SeagnalAssistantPlugin.java 확장 의사코드 (5 + 보조 2)

> **현 파일**: 177 LOC, `voice/SeagnalAssistantPlugin.java`. 본 라운드 변경 0 — 다음 라운드 N_impl 가 그대로 이식.
> 클래스 `@CapacitorPlugin(name = "SeagnalAssistant")` 는 그대로 — JS 측 호출 경로는 `Capacitor.Plugins.SeagnalAssistant.readUserProfile()` 자동 노출.
> **마이크 권한 변경 0** — 모든 신규 메서드는 RECORD_AUDIO 무관.

### 1.1 공통 임포트·필드 (의사코드)

```java
// 추가될 import:
//   import com.seagnal.app.memory.UserMemoryDatabase;
//   import com.seagnal.app.memory.UserMemoryDao;
//   import com.seagnal.app.memory.UserProfileEntity;
//   import com.seagnal.app.memory.StyleDigestEntity;
//   import com.seagnal.app.memory.EpisodeEntity;
//   import com.getcapacitor.JSArray;
//   import org.json.JSONArray;
//   import org.json.JSONObject;
//   import java.util.List;
//   import java.util.concurrent.ExecutorService;
//   import java.util.concurrent.Executors;
//   import java.security.MessageDigest;

// 클래스 멤버 추가:
private final ExecutorService memoryIo = Executors.newSingleThreadExecutor();
private UserMemoryDao memoryDao;   // load() 에서 lazy init
private volatile long lastEpisodeId = 0L;
```

`load()` 끝 1줄 추가:
```java
this.memoryDao = UserMemoryDatabase.getInstance(getContext()).userMemoryDao();
```

### 1.2 `readUserProfile`

```java
@PluginMethod
public void readUserProfile(PluginCall call) {
    memoryIo.execute(() -> {
        try {
            UserProfileEntity row = memoryDao.readUserProfile();
            JSObject ret = new JSObject();
            if (row == null) {
                ret.put("profile", JSObject.NULL);
            } else {
                JSObject p = new JSObject();
                p.put("jikgun",          row.jikgun);
                p.put("defaultZone",     row.defaultZone);
                p.put("displayName",     row.displayName);
                p.put("answerStyle",     row.answerStyle);
                p.put("experienceYears", row.experienceYears);
                p.put("preferredFormat", row.preferredFormat);
                p.put("onboardedAt",     row.onboardedAt);
                p.put("updatedAt",       row.updatedAt);
                ret.put("profile", p);
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("readUserProfile_failed", e);
        }
    });
}
```
- **JS**: `await SeagnalAssistant.readUserProfile() → { profile: {...} | null }`.
- **SLO**: ≤ 5ms (싱글톤 PK).

### 1.3 `readStyleDigest`

```java
@PluginMethod
public void readStyleDigest(PluginCall call) {
    memoryIo.execute(() -> {
        try {
            StyleDigestEntity row = memoryDao.readStyleDigest();
            JSObject style = new JSObject();
            if (row == null) {
                style.put("totalQuestions", 0);
                style.put("zoneCounts",  new JSObject());
                style.put("topicCounts", new JSObject());
            } else {
                style.put("totalQuestions",  row.totalQuestions);
                style.put("styleNote",       row.styleNote);
                style.put("preferredFormat", row.preferredFormat);
                style.put("updatedAt",       row.updatedAt);
                // zoneCounts / topicCounts 는 InterestTopicEntity 집계 — 단순 빈 객체 유지(다음 라운드 A4 가 채움)
                style.put("zoneCounts",  new JSObject());
                style.put("topicCounts", new JSObject());
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
- **JS**: `await SeagnalAssistant.readStyleDigest() → { style: {...} }`.
- **SLO**: ≤ 5ms.

### 1.4 `readRelevantEpisodes`

```java
@PluginMethod
public void readRelevantEpisodes(PluginCall call) {
    final String query = call.getString("query", "");
    final int limit = call.getInt("limit", 8);
    memoryIo.execute(() -> {
        try {
            // A4 회수 두뇌 미연결 → DAO 의 LIKE 폴백 사용(E1 산출, 250ms 이내)
            String like = "%" + (query == null ? "" : query) + "%";
            List<EpisodeEntity> rows = (query == null || query.isEmpty())
                ? memoryDao.readRelevantEpisodes("%", limit)
                : memoryDao.readRelevantEpisodes(like, limit);

            JSArray arr = new JSArray();
            for (EpisodeEntity ep : rows) {
                JSObject o = new JSObject();
                o.put("id",      ep.id);
                o.put("ts",      ep.createdAt);
                o.put("channel", ep.sourceChannel);
                o.put("zone",    ep.zone);
                // 호환 note — assistant.js#pushMemory 와 byte-equal: '[zone:] "query" → answer(160자)'
                String z = ep.zone == null ? "" : ep.zone + ": ";
                String a = ep.answerSummary == null ? "" : ep.answerSummary;
                String ans = a.length() > 160 ? a.substring(0, 160) : a;
                o.put("note", z + "\"" + ep.query + "\" → " + ans);
                arr.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("episodes", arr);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("readRelevantEpisodes_failed", e);
        }
    });
}
```
- **JS**: `await SeagnalAssistant.readRelevantEpisodes({query, limit}) → { episodes: [...] }`.
- **SLO**: ≤ 30ms (LIKE + LIMIT 8).
- **호환**: `note` 포맷이 기존 `pushMemory` 와 byte-equal → 서버 프롬프트 변경 0 (회귀 G1).

### 1.5 `appendEpisode` (트랜잭션 — race 가드)

```java
@PluginMethod
public void appendEpisode(PluginCall call) {
    final String query   = call.getString("query");
    final String answer  = call.getString("answer");
    final String zone    = call.getString("zone");
    final String channel = call.getString("channel", "chat");
    final JSArray toolsJs = call.getArray("tools");

    if (query == null || answer == null) {
        call.reject("appendEpisode_missing_query_or_answer");
        return;
    }

    memoryIo.execute(() -> {
        try {
            String tools = (toolsJs == null) ? null : toolsJs.toString();
            String ans600 = answer.length() > 600 ? answer.substring(0, 600) : answer;
            // DAO 의 트랜잭션 헬퍼 appendEpisode 호출 (E1 산출, @Transaction 보장)
            long id = memoryDao.appendEpisode(query, ans600, zone, tools, channel);
            lastEpisodeId = Math.max(lastEpisodeId, id);

            JSObject ret = new JSObject();
            ret.put("id", id);
            call.resolve(ret);

            // post-commit: WebView 캐시 무효화 (음성 측 쓰기일 때 채팅이 받음)
            JSObject evt = new JSObject();
            evt.put("id", id);
            evt.put("channel", channel);
            evt.put("ts", System.currentTimeMillis());
            notifyListeners("episodesChanged", evt);
        } catch (Exception e) {
            call.reject("appendEpisode_failed", e);
        }
    });
}
```
- **JS**: `await SeagnalAssistant.appendEpisode({query, answer, zone?, tools?, channel}) → { id }`.
- **Race 가드**: `appendEpisode` 가 `@Transaction` 안에서 INSERT 직렬화. `style_digest.totalQuestions += 1` 은 본 라운드 범위 외(A3 압축 트리거가 일괄 처리 — N_impl 에서 카운터 atomic UPDATE 1줄로 보강 가능).
- **SLO**: ≤ 10ms.

### 1.6 `triggerConsolidation` (debounce enqueue)

```java
@PluginMethod
public void triggerConsolidation(PluginCall call) {
    memoryIo.execute(() -> {
        try {
            // A3 Consolidator 미연결 → 단순 ack (다음 라운드가 채움).
            // debounce 머지: memoryIo 가 단일 스레드 풀이므로 동일 잡 폭주 시 큐에 쌓이는 횟수만 ↑,
            // 실제 실행은 직렬 — 무해. A3 도입 시 ConsolidationJob.enqueue() 1줄로 교체.
            JSObject ret = new JSObject();
            ret.put("scheduled", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("triggerConsolidation_failed", e);
        }
    });
}
```
- **JS**: `await SeagnalAssistant.triggerConsolidation() → { scheduled }`.
- **SLO**: ≤ 5ms (enqueue 만).
- **호출 빈도**: 채팅·음성 모두 `(totalQuestions % 8) == 0` 인 턴 뒤 — 양쪽이 같은 SQLite 의 `style_digest.totalQuestions` 단일값을 참조하므로 자연스러운 단일 카운터.

### 1.7 `migrateLocalStorageOnce` (보조)

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
            boolean did = false;
            // (a) profile 은 SQLite 의 것 우선 — null 인 경우만 upsert
            if (memoryDao.readUserProfile() == null && profileJson != null) {
                JSONObject p = new JSONObject(profileJson);
                UserProfileEntity row = UserProfileEntity.of(
                    p.optString("jikgun", null),
                    p.optString("defaultZone", null),
                    p.optString("displayName", null),
                    p.optString("answerStyle", null),
                    p.has("experienceYears") ? p.optInt("experienceYears") : null,
                    p.optString("preferredFormat", null),
                    System.currentTimeMillis(),
                    System.currentTimeMillis()
                );
                memoryDao.upsertUserProfile(row);
                did = true;
            }
            // (b) memory[] → episodes (channel='chat:legacy', ts 역분배)
            if (memoryArr != null) {
                long now = System.currentTimeMillis();
                int n = memoryArr.length();
                for (int i = 0; i < n; i++) {
                    String note = memoryArr.getString(i);
                    // note 포맷 '[zone:] "query" → answer' — 단순 파싱 실패 시 query 에 통째로 박는다.
                    memoryDao.appendEpisode(note, "", null, null, "chat:legacy");
                    did = true;
                }
            }
            // (c) style 은 단순 upsert (실패 무시)
            if (styleJson != null) {
                JSONObject s = new JSONObject(styleJson);
                StyleDigestEntity sd = new StyleDigestEntity();
                sd.id = 1;
                sd.totalQuestions  = s.optInt("totalQuestions", 0);
                sd.styleNote       = s.optString("styleNote", null);
                sd.preferredFormat = s.optString("preferredFormat", null);
                sd.firstAt         = System.currentTimeMillis();
                sd.updatedAt       = System.currentTimeMillis();
                memoryDao.upsertStyleDigest(sd);
                did = true;
            }
            // (d) focus / naturalVoice 는 별도 settings 테이블(E1 후속) — 현재는 무시.
            //     N_impl 라운드가 settings 테이블 도입 시 채움.
            JSObject ret = new JSObject();
            ret.put("migrated", did);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("migrate_failed", e);
        }
    });
}
```
- **JS**: `await SeagnalAssistant.migrateLocalStorageOnce({...}) → { migrated }`.
- **멱등**: `readUserProfile() == null` 가드 + DAO 가 ABORT onConflict 라 중복 episode 는 무해 실패 무시.

### 1.8 `audioBusy` (보조 — music lock 신호)

```java
@PluginMethod
public void audioBusy(PluginCall call) {
    JSObject ret = new JSObject();
    // VoiceAssistantService.isRunning 만 노출. SPEAKING 상태 별도 노출은 N_impl 시 isSpeaking 정적 필드 추가.
    ret.put("busy", VoiceAssistantService.isRunning);
    call.resolve(ret);
}
```
- 풀 불필요(휘발 플래그). 채팅이 TTS 호출 직전 폴링 → 음성 발화 충돌 가드.

### 1.9 권한·매니페스트 영향

- `@CapacitorPlugin(permissions = {...})` 변경 **0**.
- AndroidManifest.xml 변경 **0**.
- 새 권한 **0** — 메모리 DB 는 internal storage(`filesDir`) 사용, OS 권한 무관.

### 1.10 의사코드 → N_impl 라운드 체크리스트

| # | 항목 | N_impl 작업 |
|---|---|---|
| 1 | DAO 에 `upsertFocusIfNewer` / `incrementTotalQuestions` 신설 | 본 의사코드의 race 가드(§4.2~§4.3) 완성 |
| 2 | A4 retriever 연결 | `readRelevantEpisodes` 의 LIKE 폴백을 의미검색으로 교체 |
| 3 | A3 Consolidator 연결 | `triggerConsolidation` 의 ack 만 → 실제 enqueue |
| 4 | settings 테이블 | `naturalVoice`/`focusJson` 보관 |
| 5 | `VoiceAssistantService.isSpeaking` 정적 필드 추가 | `audioBusy` 정확화 |

---

## 2. local_server/js/assistant.js 통합 hunks (4 hunk)

> **현 파일**: 927 LOC. 본 라운드 변경 0 — 다음 라운드 N_impl 가 적용.
> 헬퍼는 `window.SeagnalMemory` (user_memory_bridge.js) — 이미 9 함수 노출 완료.
> 모든 hunk 는 **회귀 가드** — `SeagnalMemory` 미존재 시 기존 localStorage 흐름 유지.

### 2.1 HUNK A — index/assistant.html 의 script 순서 (코드 0 — 단순 명세)

```html
<!-- 추가될 라인 — assistant.js 직전에 헬퍼 로드 -->
<script src="/js/user_memory_web.js"></script>
<script src="/js/user_memory_bridge.js"></script>
<script src="/js/assistant.js"></script>
```
- **이유**: `assistant.js` 가 `window.SeagnalMemory` 를 참조하기 전에 헬퍼가 로드돼야 함.
- `user_memory_web.js` 가 먼저 → `user_memory_bridge.js` 의 `webModule()` 이 검출.
- **회귀 가드**: 추가 안 해도 `assistant.js` 는 `typeof SeagnalMemory` 가드로 무회귀.

### 2.2 HUNK B — 페이지 로드 시 마이그레이션 + prime (assistant.js 초기화 블럭 끝)

**현 코드 (assistant.js:920~926)**:
```js
  // 프로필이 없으면 첫 실행 온보딩, 있으면 요약 표시
  if (getProfile() === null) {
    startOnboarding();
  } else {
    renderProfile();
    showMainUI(true);
  }
})();
```

**제안 hunk** — `setupNativeBridge()` 호출 직전(현 901행) 에 신설:
```js
  // ── 사용자 기억 v2 — 마이그레이션 (멱등) + 부팅 prime (1회) ─────────────────
  // SeagnalMemory 미로드 시 무회귀(아무 일도 안 함).
  if (window.SeagnalMemory) {
    SeagnalMemory.migrateLocalStorageOnce()
      .then(function (r) {
        // r.migrated === true 면 localStorage 5키는 헬퍼가 이미 삭제·플래그 셋.
        return SeagnalMemory.primeUserMemory();
      })
      .catch(function () { /* 실패 시 다음 부팅 재시도 — 데이터 유실 0 */ });
  }

  setupNativeBridge();
```
- **효과**: 페이지 로드 5~10ms 안에 캐시 hydration 완료. 이후 `getUserProfile()`/`getStyleDigest()` 는 동기 캐시 hit (호출당 0ms).
- **회귀 가드**: `SeagnalMemory` 미로드 시 분기 무진입.

### 2.3 HUNK C — `doAsk` 직전 userMemorySnapshot 미리 fetch + body 동봉

**현 코드 (assistant.js:284~289)**:
```js
  function doAsk(query, loc) {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, profile: getProfile(), memory: getMemory(), style: getStyle(), location: loc, focus: getFocus() })
    })
```

**제안 hunk** — `doAsk` 를 비동기로 약간 확장:
```js
  function doAsk(query, loc) {
    // [N2] 사용자 기억 스냅샷 — 캐시 우선(동기), 미primed 시 fallback = localStorage.
    var snapshot = null;
    if (window.SeagnalMemory) {
      try {
        var profileCache = SeagnalMemory.getUserProfile();   // 동기 — 캐시 hit 시 0ms
        var styleCache   = SeagnalMemory.getStyleDigest();   // 동기 — 캐시 hit 시 0ms
        var focusCache   = SeagnalMemory.getFocusLast();     // 동기
        snapshot = {
          profile: profileCache, style: styleCache, focus: focusCache,
          // episodes 는 비동기지만 캐시 hit 시 즉시 — 회수 두뇌가 OFF 면 최근순 LIFO
          // 본 hunk 는 동기 캐시만 사용. fresh fetch 필요 시 prime 가 8턴마다 재수화.
          episodesCached: true
        };
      } catch (e) { snapshot = null; }
    }
    // 의미검색 회수는 비동기 — 캐시 hit 시 즉시, miss 시 30ms.
    var epsPromise = (window.SeagnalMemory && SeagnalMemory.getRelevantEpisodes)
      ? SeagnalMemory.getRelevantEpisodes(query, 8).catch(function () { return null; })
      : Promise.resolve(null);

    epsPromise.then(function (eps) {
      var body = {
        query: query,
        profile:  (snapshot && snapshot.profile) || getProfile(),
        memory:   getMemory(),                          // 호환 유지 — note 문자열 배열
        style:    (snapshot && snapshot.style)   || getStyle(),
        location: loc,
        focus:    (snapshot && snapshot.focus)   || getFocus()
      };
      // [N2 신키] userMemorySnapshot — 서버가 모르면 무시(회귀 가드), 알면 우선 사용.
      if (snapshot || eps) {
        body.userMemorySnapshot = {
          source: 'sqlite-mirror',
          profile: (snapshot && snapshot.profile) || null,
          style:   (snapshot && snapshot.style)   || null,
          focus:   (snapshot && snapshot.focus)   || null,
          episodes: eps || []   // [{id, ts, channel, zone, note}]
        };
      }
      fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.json(); })
        .then(handleAskResponse(query, loc))   // ── 기존 .then 흐름을 함수로 추출(아래 HUNK D)
        .catch(handleAskError);
    });
  }
```
- **회귀 가드**: `userMemorySnapshot` 키는 서버가 무시해도 무해 (기존 `profile`/`memory`/`style`/`focus` 호환 유지).
- **응답 시간 영향**: 캐시 hit 시 0ms 추가. miss 시 30ms 1회 — 부팅 prime 으로 흡수.

### 2.4 HUNK D — 응답 후 write-through + 8턴마다 consolidation

**현 코드 (assistant.js:300~310)**:
```js
        // 성향 통계 누적(질문수·해역·주제) + 주기적 말투 요약 갱신
        updateStyleStats(d);
        // 과거 대화 요약을 휴대폰에 누적 → 다음 질문에 참고. (생략)
        var memQ = d.corrected || query;
        pushMemory((d.zone ? d.zone + ': ' : '') + '"' + memQ + '" → ' + String(d.answer || '').slice(0, 160));
        // [구조화 연속성] 서버가 돌려준 직전 주목 대상을 저장 → 다음 요청에 재전송.
        if (d.focus) setFocus(d.focus);
        speak(d.answer);
```

**제안 hunk** — write-through 추가:
```js
        // 기존 흐름 유지 (회귀 가드)
        updateStyleStats(d);
        var memQ = d.corrected || query;
        pushMemory((d.zone ? d.zone + ': ' : '') + '"' + memQ + '" → ' + String(d.answer || '').slice(0, 160));
        if (d.focus) setFocus(d.focus);

        // [N2] SeagnalMemory write-through — 캐시 + IndexedDB + Plugin 3중.
        //   bridge 가 fire-and-forget 처리 → UI 지연 0.
        if (window.SeagnalMemory) {
          SeagnalMemory.appendEpisode({
            query:   memQ,
            answer:  String(d.answer || ''),
            zone:    d.zone,
            tools:   (d.links || []).map(function (l) { return l && l.type ? l.type : null; }).filter(Boolean),
            channel: 'chat',
            focus:   d.focus || null
          }).catch(function () { /* fire-and-forget */ });

          // 8턴마다 압축 트리거 — 서버 totalQuestions 가 아니라 캐시의 totalQuestions 기반
          // (서버가 모르는 v1 사용자도 균등 분포로 트리거 → 결정론).
          var s = getStyle(); // localStorage 로 누적(기존)
          if (s && s.totalQuestions && (s.totalQuestions % 8) === 0) {
            SeagnalMemory.triggerConsolidation().catch(function () {});
          }
        }

        speak(d.answer);
```
- **fire-and-forget**: `.catch(noop)` — Plugin/IndexedDB 실패가 UI 흐름을 막지 않음.
- **이중쓰기 의도**: 기존 `pushMemory()` 는 v2 마이그레이션 미완료 사용자에 대한 안전망. 마이그레이션 후 `pushMemory()` 는 휘발 캐시 역할만 — DB 정본 = SQLite.
- **회귀 가드**: `SeagnalMemory` 미로드 시 분기 무진입 → 기존 흐름 그대로.

### 2.5 HUNK E (보조) — Native.enable 호출 시 profile 직결

**현 코드 (assistant.js:748)**:
```js
      Native.enable({ serverUrl: location.origin, profile: JSON.stringify(getProfile() || {}) })
```

**제안 hunk** — `SeagnalMemory.getUserProfile()` 우선:
```js
      var p = (window.SeagnalMemory && SeagnalMemory.getUserProfile()) || getProfile() || {};
      Native.enable({ serverUrl: location.origin, profile: JSON.stringify(p) })
```
- **효과**: 음성 비서 시작 시점에 채팅이 방금 갱신한 profile 도 즉시 반영(현 불일치 2 해소). 미primed 시 fallback = localStorage.

---

## 3. VoiceAssistantService.java 통합 (음성 비서 — DAO 직결)

> **현 파일**: 547 LOC. 본 라운드 변경 0 — 다음 라운드 N_impl 가 적용.
> **원칙**: 음성은 **Plugin 우회** — 같은 프로세스에서 `UserMemoryDao` 직접 호출. (A2 §2.3)

### 3.1 askServer body 에 userMemorySnapshot 동봉

**현 코드 (VoiceAssistantService.java:285~311)**:
```java
JSONObject body = new JSONObject();
body.put("query", query);
// 개인화 프로필 동봉(있으면). JSON 이면 객체로, 아니면 문자열로 전송.
if (profileJson != null && !profileJson.isEmpty()) { ... }
// 기기 최근 위치 동봉
double[] loc = getLastLocation();
if (loc != null) { ... body.put("location", l); }
// 직전 턴 focus 동봉
if (lastFocusJson != null && !lastFocusJson.isEmpty()) { ... }
// 직전 N턴 메모 동봉
if (!recentMemory.isEmpty()) { ... body.put("memory", memArr); }
```

**제안 hunk** — 동일 직후 SQLite 정본 조회 + userMemorySnapshot 동봉:
```java
// [N2] SQLite 정본 조회 — 같은 프로세스에서 DAO 직접 호출(Plugin 우회).
//   memoryIo 풀 안에서 askServer 가 이미 실행 중(handleQuery 가 io.execute 로 진입).
try {
    UserMemoryDao dao = UserMemoryDatabase.getInstance(getApplicationContext()).userMemoryDao();
    UserProfileEntity profileRow = dao.readUserProfile();
    StyleDigestEntity styleRow   = dao.readStyleDigest();
    List<EpisodeEntity> epRows   = dao.readRelevantEpisodes("%", 8);

    JSONObject snapshot = new JSONObject();
    snapshot.put("source", "sqlite-mirror");
    if (profileRow != null) {
        JSONObject p = new JSONObject();
        p.put("jikgun",          profileRow.jikgun);
        p.put("defaultZone",     profileRow.defaultZone);
        p.put("displayName",     profileRow.displayName);
        p.put("answerStyle",     profileRow.answerStyle);
        p.put("experienceYears", profileRow.experienceYears);
        p.put("preferredFormat", profileRow.preferredFormat);
        snapshot.put("profile", p);
    }
    if (styleRow != null) {
        JSONObject s = new JSONObject();
        s.put("totalQuestions",  styleRow.totalQuestions);
        s.put("styleNote",       styleRow.styleNote);
        s.put("preferredFormat", styleRow.preferredFormat);
        snapshot.put("style", s);
    }
    if (lastFocusJson != null && !lastFocusJson.isEmpty()) {
        try { snapshot.put("focus", new JSONObject(lastFocusJson)); } catch (Exception ignored) {}
    }
    org.json.JSONArray epsArr = new org.json.JSONArray();
    for (EpisodeEntity ep : epRows) {
        JSONObject o = new JSONObject();
        o.put("id",      ep.id);
        o.put("ts",      ep.createdAt);
        o.put("channel", ep.sourceChannel);
        o.put("zone",    ep.zone);
        String z = ep.zone == null ? "" : ep.zone + ": ";
        String a = ep.answerSummary == null ? "" : ep.answerSummary;
        if (a.length() > 160) a = a.substring(0, 160);
        o.put("note", z + "\"" + ep.query + "\" → " + a);
        epsArr.put(o);
    }
    snapshot.put("episodes", epsArr);
    body.put("userMemorySnapshot", snapshot);
} catch (Exception e) {
    Log.w(TAG, "userMemorySnapshot skip: " + e.getMessage());
    // 회귀 가드 — snapshot 미동봉 시 서버는 기존 profile/memory/focus 만 사용.
}
```
- **회귀 가드**: try/catch 로 SQLite 실패 시 기존 흐름 그대로.
- **응답 시간 영향**: 단일 풀(`memoryIo`) 안에서 처리 — 추가 ≤ 30ms. 부팅 시점 메모리 캐시 도입은 본 라운드 범위 외(N_impl 가 보강).

### 3.2 응답 후 직결 appendEpisode (DAO 직접 호출)

**현 코드 (VoiceAssistantService.java:335~344)**:
```java
try {
    String zone = json.optString("zone", "");
    String shortAns = answer.length() > 160 ? answer.substring(0, 160) : answer;
    String note = (zone != null && !zone.isEmpty() ? zone + ": " : "")
            + "\"" + query + "\" → " + shortAns;
    recentMemory.addLast(note);
    while (recentMemory.size() > MEMORY_MAX) recentMemory.pollFirst();
} catch (Exception ignored) { ... }
```

**제안 hunk** — 동일 try 블럭 끝에 DAO 직결 추가:
```java
try {
    String zone = json.optString("zone", "");
    String shortAns = answer.length() > 160 ? answer.substring(0, 160) : answer;
    String note = (zone != null && !zone.isEmpty() ? zone + ": " : "")
            + "\"" + query + "\" → " + shortAns;
    recentMemory.addLast(note);
    while (recentMemory.size() > MEMORY_MAX) recentMemory.pollFirst();

    // [N2] SQLite 정본 적재 — DAO 직결(Plugin 우회). 트랜잭션은 DAO 의 @Transaction 헬퍼가 보장.
    try {
        UserMemoryDao dao = UserMemoryDatabase.getInstance(getApplicationContext()).userMemoryDao();
        long id = dao.appendEpisode(
            query,
            answer.length() > 600 ? answer.substring(0, 600) : answer,
            (zone == null || zone.isEmpty()) ? null : zone,
            null,        // tools — 음성쪽은 미수집 (서버 응답의 links 도 미파싱)
            "voice"
        );
        // 채팅 WebView 캐시 무효화 신호 — Plugin 인스턴스 통해 notifyListeners.
        SeagnalAssistantPlugin.notifyEpisodesChanged(id, "voice", System.currentTimeMillis());

        // 8턴마다 압축 트리거 (debounce 머지 — 단일 풀이라 폭주 무해)
        int cnt = dao.countEpisodes();
        if (cnt > 0 && (cnt % 8) == 0) {
            // A3 미연결 — N_impl 라운드가 채움. 본 라운드는 ack 만.
        }
    } catch (Exception dbEx) {
        Log.w(TAG, "DAO appendEpisode 실패: " + dbEx.getMessage());
    }
} catch (Exception ignored) { ... }
```

### 3.3 SeagnalAssistantPlugin 측 static helper 추가 (보조)

**제안 hunk** — Plugin 에 static helper 1개 추가 (§1.5 의 `notifyListeners('episodesChanged', evt)` 와 동일 페이로드를 음성 측에서도 발행):
```java
// SeagnalAssistantPlugin.java 끝에 static helper 추가
public static void notifyEpisodesChanged(long id, String channel, long ts) {
    if (instance == null) return;
    try {
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("channel", channel);
        o.put("ts", ts);
        instance.notifyListeners("episodesChanged", o);
    } catch (Exception ignored) {}
}
```
- **효과**: 음성이 DAO 직결로 적재해도 WebView 가 `episodesChanged` 이벤트 수신 → `MemoryCache.isStale = true` → 다음 ask 가 fresh fetch.

### 3.4 음성 응답 시간 영향

| 단계 | 현 | N2 후 | 비고 |
|---|---|---|---|
| askServer 전 SQLite 조회 | 0 | +20~30ms | 단일 풀 안에서 처리 — 사용자 체감 무관 (이미 thinking 상태) |
| askServer 후 DAO 적재 | 0 | +10ms | TTS 시작 후 비동기 |
| 음성 회수 두뇌 OFF 시 LIKE 폴백 | 0 | +20ms | A4 도입 시 30ms 로 안정 |

---

## 4. 마이그레이션 일회성 (앱 첫 실행 / 페이지 첫 로드)

### 4.1 트리거 사이트

| 채널 | 사이트 | 호출 |
|---|---|---|
| 채팅 WebView | `assistant.js` 초기화 블럭 (§2.2 의 HUNK B) | `SeagnalMemory.migrateLocalStorageOnce()` → 성공 시 `primeUserMemory()` |
| 음성 비서 자바 | `VoiceAssistantService.onCreate` 끝 (선택) | `UserMemoryDao.readUserProfile() == null` 일 때만 Plugin 의 migrate 메서드를 인-프로세스로 호출 — 보통은 채팅이 먼저 → 음성은 무동작 |

### 4.2 멱등 플래그

- localStorage 키 `seagnal_v2_migrated=1` (헬퍼가 관리, `user_memory_bridge.js#migrateLocalStorageOnce` §320~367 의 시그니처 그대로).
- SQLite 측 `user_profile.id=1` 가 가드 (`migrateLocalStorageOnce` 가드 §1.7).
- 두 가드 모두 false 시 다음 부팅에서 재시도 — **데이터 유실 0** 불변식.

### 4.3 실패 / 롤백

| 실패점 | 대응 |
|---|---|
| Plugin 호출 실패 (네이티브 미적용) | 헬퍼가 `localStorage` 보존 + 다음 부팅 재시도. `seagnal_v2_migrated` flag 미셋. |
| SQLite 트랜잭션 실패 | 자바측 `migrated:false` 반환 → 헬퍼가 localStorage 보존. |
| 부분 마이그레이션 (profile 만 성공) | 헬퍼 측은 `migrated:true` 가 와야만 localStorage 삭제 — 부분 성공은 false 로 매핑 (A2 §5.3 의 "데이터 유실 0" 불변식). |

### 4.4 롤백 경로 (디버그)

- `seagnal_v2_rollback=1` 플래그 (헬퍼 미구현 — N_impl 라운드 보강 후보).
- 비상 시: SQLite 의 `user_profile`/`style_digest`/`episodes` 를 JSON 직렬화 → localStorage 5키 역기록 → `seagnal_v2_migrated` 키 삭제.

---

## 5. Capacitor plugin 등록 — 변경 0 확인

### 5.1 현재 등록 상태

- `MainActivity.java:50` 의 `registerPlugin(SeagnalAssistantPlugin.class)` — 기존 그대로.
- `capacitor.config.json` — 신규 plugin 키 추가 **불필요**. (현재 `PushNotifications`, `SplashScreen` 만)
- Capacitor 의 자동 검출 메커니즘: 같은 `@CapacitorPlugin(name="SeagnalAssistant")` 클래스 안에 `@PluginMethod` 가 추가되면 JS 측 `Capacitor.Plugins.SeagnalAssistant.<methodName>(...)` 가 자동 노출.

### 5.2 신규 메서드 노출 검증 절차 (N_impl 시)

```js
// 디버그 콘솔에서 검증
console.log(Object.keys(Capacitor.Plugins.SeagnalAssistant));
// 기대 출력: enable, disable, isEnabled, getCapabilities, requestVoskDownload, cancelVoskDownload,
//           readUserProfile, readStyleDigest, readRelevantEpisodes, appendEpisode,
//           triggerConsolidation, migrateLocalStorageOnce, audioBusy, addListener, removeAllListeners
```
- 누락 시 = `@PluginMethod` 어노테이션 누락 또는 `npx cap sync` 미실행.

### 5.3 capacitor.config.json 변경 시점

- **변경 0** — 본 N2 범위 내에는 추가 안 함.
- 다음 라운드(A6 프라이버시) 가 `permissions.SeagnalAssistant: { memoryWipe: 'always' }` 같은 키를 추가할 수도 있으나, 현재는 무관.

---

## 6. 부팅 prime 흐름 (앱 시작 시 1회)

### 6.1 사이트

| 사이트 | 트리거 | 효과 |
|---|---|---|
| 채팅 WebView `assistant.js` 끝 (§2.2 HUNK B) | DOMContentLoaded 후 | `MemoryCache.profile/style/episodes` hydration |
| 음성 비서 `VoiceAssistantService.onCreate` | onStartCommand 의 첫 enterWakeMode 전 | 같은 DB 라 별도 prime 불필요 — DAO 호출이 곧 fresh |
| 8턴마다 (`assistant.js` HUNK D) | `s.totalQuestions % 8 === 0` | 압축 후 재수화 — 다음 prime 이 새 style_digest 반영 |
| `episodesChanged` 이벤트 (음성→채팅) | 음성 측 적재 직후 | `MemoryCache.isStale = true` → 다음 회수 호출 시 fresh fetch |

### 6.2 응답 시간 영향 요약

| 흐름 | 추가 시간 |
|---|---|
| 부팅 prime (4 호출 병렬) | 5~10ms (캐시 hydration) |
| 매 ask 호출 (캐시 hit) | 0ms (`getUserProfile`/`getStyleDigest` 동기 캐시) |
| 매 ask 호출 (캐시 miss) | 30ms (의미검색 fresh) — 8턴마다 prime 으로 흡수 |
| 응답 후 `appendEpisode` | 0ms (fire-and-forget, Promise 미대기) |
| 응답 후 `triggerConsolidation` (8턴마다) | 0ms (enqueue 만, debounce 머지) |

### 6.3 사용자 체감

- 부팅 직후 첫 ask = +0ms (prime 가 ask 전에 끝남).
- 8턴째 ask = 압축 트리거 fire-and-forget → 다음 prime 까지 캐시 stale OK (회수 정확도는 사용자 무체감).
- 음성 ask = +30ms (단일 풀 안에서 처리, thinking 상태이므로 무체감).

---

## 7. 회귀 가드 (단위 시나리오)

### G1 — userMemorySnapshot 미동봉 시 무회귀

**셋업**: `SeagnalMemory` 미로드 (헬퍼 스크립트 누락 — HUNK A 미적용).
**기대**:
- `assistant.js` 의 `if (window.SeagnalMemory)` 가드 분기 무진입.
- `doAsk` body 가 기존 `{query, profile, memory, style, location, focus}` 그대로.
- 서버 응답 byte-equal.
**판정**: phase0_golden.jsonl 회신 diff = 0.

### G2 — 마이그레이션 실패 시 localStorage 보존

**셋업**: SeagnalMemory 로드됨, Plugin migrate 메서드 throw.
**기대**:
- `r.migrated:false` 반환 → 헬퍼가 localStorage 5키 삭제 안 함 + flag 미셋.
- 다음 부팅에서 재시도.
- 기존 `getProfile()`/`getMemory()` 가 여전히 localStorage 에서 읽힘 → ask 동작 무회귀.
**판정**: localStorage 5키 존재 + 응답 정상.

### G3 — cross-channel parity (채팅 ↔ 음성)

**셋업**: 마이그레이션 완료, SQLite 에 채팅 적재 episode#1 = "장목항 만조 시간".
**시퀀스**:
1. 음성: "나리야 / 거기 경위도?"
2. VoiceAssistantService 가 askServer 진입 → SQLite 조회 → focus = 장목항 좌표.
3. 응답에 장목항 좌표 포함.

**판정**: 응답 본문에 좌표 토큰 + zone="장목항".

### G4 — 동시 쓰기 race

**셋업**: 사용자가 채팅 보내고 0.5초 뒤 음성 발화. 두 응답이 100ms 차로 도착.
**기대**:
- 채팅: HUNK D 의 `SeagnalMemory.appendEpisode()` → Plugin 트랜잭션.
- 음성: VoiceAssistantService 의 DAO 직결 → 같은 DB 의 트랜잭션.
- 두 트랜잭션 모두 SQLite 의 write-lock 으로 자동 직렬화 → episode 2건 모두 적재.

**판정**: episode 테이블에 2 row + 둘 다 channel 컬럼 다름.

### G5 (보조) — 헬퍼 부재 시 무회귀

**셋업**: user_memory_bridge.js / user_memory_web.js 둘 다 누락.
**기대**:
- `window.SeagnalMemory === undefined`.
- 모든 HUNK B/C/D 의 가드 분기 무진입.
- assistant.js 동작 = N2 도입 전과 byte-equal.

---

## 8. APK 재빌드 필요 항목 (B3 가이드 보강)

### 8.1 자바 변경 → APK 재빌드 필요

| 파일 | 변경 | 라운드 |
|---|---|---|
| `voice/SeagnalAssistantPlugin.java` | 5 + 보조 2 = 7 @PluginMethod 추가 | N_impl |
| `voice/VoiceAssistantService.java` | askServer body 의 userMemorySnapshot 동봉, DAO 직결 appendEpisode | N_impl |
| `memory/UserMemoryDao.java` (선택) | `incrementTotalQuestions` / `upsertFocusIfNewer` 신설 — race 가드 강화 | N_impl |

### 8.2 웹 JS 변경 → fly.dev 자동 갱신 (재빌드 불필요)

| 파일 | 변경 |
|---|---|
| `local_server/js/assistant.js` | HUNK B/C/D/E 적용 |
| `local_server/js/user_memory_bridge.js` | 변경 0 (이미 9 함수 완성) |
| `local_server/js/user_memory_web.js` | 변경 0 (이미 IndexedDB 완성) |
| `local_server/index.html` / `assistant.html` (또는 동등) | HUNK A — script 순서 |

- **사장님이 해야 할 작업**: `git pull` + `npx cap sync android` + Android Studio Build APK 1회.
- **fly.dev** 는 `git push` → 자동 배포 (B3 가이드의 "서버 코드 자동 최신" 그대로).

### 8.3 B3 가이드 §0 표 보강 (단순 명세)

| 단계 | 내용 | 예상 시간 |
|---|---|---|
| 0-1 | git pull, npm install, npx cap sync android | 5~10분 |
| 0-2 | Android Studio Gradle Sync (Room 의존성 확인) | 3~5분 |
| 0-3 | Build APK (N2 추가 자바 메서드 컴파일) | 3~7분 |
| 0-4 | 갤럭시 SM-F711N 설치 | 2분 |
| 0-5 | 동작 검증 6건 (G1·G2·G3·G4·G5 + v1→v2 마이그레이션 1회) | 15~20분 |

총 예상 시간: **28~44분** (B3 가이드 25~40 분 + 검증 G5 추가).

---

## 9. DoD (N2 설계 완료 기준)

1. SeagnalAssistantPlugin 5 + 보조 2 = 7 메서드 의사코드 — §1.
2. assistant.js 4 hunks (B/C/D/E) + script 순서 명세(A) — §2.
3. VoiceAssistantService DAO 직결 hunk + Plugin static helper — §3.
4. 마이그레이션 멱등 플래그 + 실패/롤백 — §4.
5. Capacitor plugin 등록 변경 0 확인 — §5.
6. 부팅 prime + 응답 시간 영향 정량 — §6.
7. 회귀 가드 G1~G5 — §7.
8. APK 재빌드 영향 표 + B3 가이드 보강 — §8.
9. 코드 수정 0건 — 본 문서 hunk/의사코드만.

---

## 10. A·E·N 트랙 인터페이스 의존 요약

| 트랙 | 본 설계가 의존하는 표면 | 본 설계가 제공하는 표면 |
|---|---|---|
| A1 저장소 | DDL 스키마 (`user_profile`, `style_digest`, `episodes`) | 변경 없음 |
| A2 브리지 계약 | 5 메서드 시그니처 + race 4종 가드 + 미러 권고 | Plugin 5+2 의사코드 + assistant.js hunk |
| A3 압축 | `Consolidator.scheduleAsync()` (debounce) | `triggerConsolidation` 진입점 (현재 ack 만) |
| A4 회수 | `RelevantEpisodeRetriever.query(text, k)` | `readRelevantEpisodes` 진입점 (현재 LIKE 폴백) |
| E1 자바 | `UserMemoryDatabase.getInstance` + `UserMemoryDao` 5 테이블 | Plugin·VoiceAssistantService 가 직접 호출 |
| E2 웹 | `SeagnalMemoryWeb` IndexedDB 미러 | 헬퍼 자동 검출(`webModule()`) |
| E3 헬퍼 | `window.SeagnalMemory` 9 함수 | assistant.js HUNK B/C/D/E 가 직접 호출 |

---

## 11. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-06-06 | 문서 신설. Plugin 5+2 의사코드 + assistant.js 4 hunks + VoiceAssistantService DAO 직결 hunk + 마이그레이션 멱등 + Capacitor 변경 0 확인 + 회귀 가드 G1~G5 + APK 재빌드 영향 |
