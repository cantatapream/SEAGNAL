package com.seagnal.app.voice;

import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// [N2] 사용자 기억 v2 — 같은 프로세스의 Room DAO 직결.
//   설계: local_server/knowledge/phases/n2_user_memory_client_integration.md §1.1
import com.seagnal.app.memory.EpisodeEntity;
import com.seagnal.app.memory.StyleDigestEntity;
import com.seagnal.app.memory.UserMemoryDao;
import com.seagnal.app.memory.UserMemoryDatabase;
import com.seagnal.app.memory.UserProfileEntity;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 웹(WebView) ↔ 네이티브 사용자 기억(Room SQLite) 브릿지 Capacitor 플러그인.
 *
 * [JS 에서 사용] client/js/assistant/memory/user_memory_bridge.js
 *   const { SeagnalAssistant } = Capacitor.Plugins;
 *   await SeagnalAssistant.readUserProfile();  …  appendEpisode / readRelevantEpisodes 등
 *
 * [음성 비서 삭제 — 2026-11-19, 사용자 지시]
 *   원문: "마이크가 들어가는 부분은 모두 제거해줘. 사용하지 않을거야." · "음성모델 ? 그것도 제거해줘."
 *   이 플러그인에 있던 마이크 권한(RECORD_AUDIO)·상시 청취 서비스 켜기/끄기(enable·disable·isEnabled)·
 *   호출어 엔진 조회(getCapabilities)·Vosk 음성 모델 내려받기(requestVoskDownload·cancelVoskDownload)·
 *   audioBusy 와, 같은 패키지의 VoiceAssistantService·Vosk*·Porcupine*·AndroidSpeech* 를 전부 지웠다.
 *   사용자 기억 메서드는 그대로다. 패키지 이름(voice)과 플러그인 이름(SeagnalAssistant)은
 *   JS 와의 약속이라 바꾸지 않았다.
 */
@CapacitorPlugin(name = "SeagnalAssistant")
public class SeagnalAssistantPlugin extends Plugin {

    private static final String TAG = "SeagnalAssistant";

    // [N2] 사용자 기억 v2 — Room 의 write-lock 과 정합하는 단일 IO 풀.
    //   설계 §1.1: ExecutorService memoryIo = Executors.newSingleThreadExecutor() — race 가드.
    //   같은 풀에서 직렬화되므로 호출 순서 보존(트랜잭션 폭주 시 큐 길이만 ↑, 실행은 직렬).
    private final ExecutorService memoryIo = Executors.newSingleThreadExecutor();

    // [N2] DAO 캐시 — load() 에서 lazy init. UserMemoryDatabase 는 internal storage 의 싱글톤.
    private volatile UserMemoryDao memoryDao;

    // [N2] 마지막 적재 episode id — 디버깅·이벤트 페이로드 검증용.
    private volatile long lastEpisodeId = 0L;

    @Override
    public void load() {
        // [N2] DAO lazy init — UserMemoryDatabase.getInstance 는 double-checked locking 으로 안전.
        //   실패해도 throw 하지 않는다 — Plugin 메서드 호출 시 재시도.
        try {
            this.memoryDao = UserMemoryDatabase.getInstance(getContext()).userMemoryDao();
        } catch (Exception e) {
            Log.w(TAG, "[N2] UserMemoryDao init 지연: " + e.getMessage());
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // [N2] 사용자 기억 v2 — Plugin 5 메서드 + 보조 2 메서드 = 7개
    //   설계: local_server/knowledge/phases/n2_user_memory_client_integration.md §1
    //   JS 노출: Capacitor.Plugins.SeagnalAssistant.<methodName>(...) — 자동.
    //   회귀 가드: 모든 메서드는 try/catch 로 실패 시 call.reject — 음성 비서 흐름 무관.
    // ════════════════════════════════════════════════════════════════════════

    /** DAO 캐시 — 미초기화 시 즉시 시도. 실패 시 null. */
    private UserMemoryDao memoryDaoOrNull() {
        if (memoryDao != null) return memoryDao;
        try {
            memoryDao = UserMemoryDatabase.getInstance(getContext()).userMemoryDao();
        } catch (Exception e) {
            Log.w(TAG, "[N2] memoryDaoOrNull 실패: " + e.getMessage());
        }
        return memoryDao;
    }

    /**
     * [N2 §1.2] readUserProfile — user_profile 싱글톤(id=1) 조회.
     *   JS: await SeagnalAssistant.readUserProfile() → { profile: {...} | null }
     *   SLO: ≤ 5ms.
     */
    @PluginMethod
    public void readUserProfile(PluginCall call) {
        memoryIo.execute(() -> {
            try {
                UserMemoryDao dao = memoryDaoOrNull();
                if (dao == null) { call.reject("memory_dao_unavailable"); return; }
                UserProfileEntity row = dao.readUserProfile();
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

    /**
     * [N2 §1.3] readStyleDigest — style_digest 싱글톤(id=1) 조회.
     *   JS: await SeagnalAssistant.readStyleDigest() → { style: {...} }
     *   SLO: ≤ 5ms.
     */
    @PluginMethod
    public void readStyleDigest(PluginCall call) {
        memoryIo.execute(() -> {
            try {
                UserMemoryDao dao = memoryDaoOrNull();
                if (dao == null) { call.reject("memory_dao_unavailable"); return; }
                StyleDigestEntity row = dao.readStyleDigest();
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
                    // zoneCounts/topicCounts 는 InterestTopicEntity 집계 — A4 도입 시 채움.
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

    /**
     * [N2 §1.4] readRelevantEpisodes — A4 회수 두뇌 미연결 시 DAO LIKE 폴백.
     *   JS: await SeagnalAssistant.readRelevantEpisodes({ query, limit }) → { episodes: [...] }
     *   note 포맷: '[zone:] "query" → answer(160자)' — assistant.js#pushMemory 와 byte-equal.
     *   SLO: ≤ 30ms.
     */
    @PluginMethod
    public void readRelevantEpisodes(PluginCall call) {
        final String query = call.getString("query", "");
        final int limit = call.getInt("limit", 8);
        memoryIo.execute(() -> {
            try {
                UserMemoryDao dao = memoryDaoOrNull();
                if (dao == null) { call.reject("memory_dao_unavailable"); return; }
                String safeQuery = (query == null) ? "" : query;
                String like = "%" + safeQuery + "%";
                List<EpisodeEntity> rows = (safeQuery.isEmpty())
                        ? dao.readRelevantEpisodes("%", limit)
                        : dao.readRelevantEpisodes(like, limit);

                JSArray arr = new JSArray();
                for (EpisodeEntity ep : rows) {
                    JSObject o = new JSObject();
                    o.put("id",      ep.id);
                    o.put("ts",      ep.createdAt);
                    o.put("channel", ep.sourceChannel);
                    o.put("zone",    ep.zone);
                    // assistant.js#pushMemory 와 byte-equal — 서버 프롬프트 변경 0 (G1).
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

    /**
     * [N2 §1.5] appendEpisode — 트랜잭션 INSERT + episodesChanged 이벤트 발행.
     *   JS: await SeagnalAssistant.appendEpisode({ query, answer, zone?, tools?, channel })
     *        → { id }
     *   Race 가드: DAO @Transaction 헬퍼가 직렬 INSERT 보장.
     *   SLO: ≤ 10ms.
     */
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
                UserMemoryDao dao = memoryDaoOrNull();
                if (dao == null) { call.reject("memory_dao_unavailable"); return; }
                String tools = (toolsJs == null) ? null : toolsJs.toString();
                String ans600 = answer.length() > 600 ? answer.substring(0, 600) : answer;
                String safeChannel = (channel == null || channel.isEmpty()) ? "chat" : channel;
                long id = dao.appendEpisode(query, ans600, zone, tools, safeChannel);
                lastEpisodeId = Math.max(lastEpisodeId, id);

                JSObject ret = new JSObject();
                ret.put("id", id);
                call.resolve(ret);

                // post-commit: WebView 캐시 무효화 신호 — 음성 측 쓰기일 때 채팅이 받음.
                JSObject evt = new JSObject();
                evt.put("id", id);
                evt.put("channel", safeChannel);
                evt.put("ts", System.currentTimeMillis());
                notifyListeners("episodesChanged", evt);
            } catch (Exception e) {
                call.reject("appendEpisode_failed", e);
            }
        });
    }

    /**
     * [N2 §1.6] triggerConsolidation — debounce enqueue.
     *   JS: await SeagnalAssistant.triggerConsolidation() → { scheduled }
     *   A3 Consolidator 미연결 — 단순 ack. memoryIo 가 단일 풀이라 폭주 무해.
     *   SLO: ≤ 5ms (enqueue 만).
     */
    @PluginMethod
    public void triggerConsolidation(PluginCall call) {
        memoryIo.execute(() -> {
            try {
                // A3 Consolidator 도입 시 enqueue() 1줄로 교체. 본 라운드는 ack 만.
                JSObject ret = new JSObject();
                ret.put("scheduled", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("triggerConsolidation_failed", e);
            }
        });
    }

    /**
     * [N2 §1.7] migrateLocalStorageOnce — localStorage 5키 → SQLite 1회 멱등 이전.
     *   JS: await SeagnalAssistant.migrateLocalStorageOnce({ profile, memory, style, focus, naturalVoice })
     *        → { migrated }
     *   멱등: readUserProfile() == null 가드 + DAO ABORT onConflict 로 중복 episode 무해.
     */
    @PluginMethod
    public void migrateLocalStorageOnce(PluginCall call) {
        final String profileJson  = call.getString("profile");
        final JSArray memoryArr   = call.getArray("memory");
        final String styleJson    = call.getString("style");
        // focus / naturalVoice 는 settings 테이블 후속 — 현재는 읽기만(미저장).
        final String focusJson    = call.getString("focus");
        final String naturalVoice = call.getString("naturalVoice");

        memoryIo.execute(() -> {
            try {
                UserMemoryDao dao = memoryDaoOrNull();
                if (dao == null) { call.reject("memory_dao_unavailable"); return; }
                boolean did = false;

                // (a) user_profile — SQLite 우선. null 일 때만 upsert.
                if (dao.readUserProfile() == null && profileJson != null && !profileJson.isEmpty()) {
                    try {
                        JSONObject p = new JSONObject(profileJson);
                        UserProfileEntity row = UserProfileEntity.of(
                                p.has("jikgun") ? p.optString("jikgun", null) : null,
                                p.has("defaultZone") ? p.optString("defaultZone", null) : null,
                                p.has("displayName") ? p.optString("displayName", null) : null,
                                p.has("answerStyle") ? p.optString("answerStyle", null) : null,
                                p.has("experienceYears") ? Integer.valueOf(p.optInt("experienceYears")) : null,
                                p.has("preferredFormat") ? p.optString("preferredFormat", null) : null,
                                System.currentTimeMillis(),
                                System.currentTimeMillis()
                        );
                        dao.upsertUserProfile(row);
                        did = true;
                    } catch (Exception pex) {
                        Log.w(TAG, "[N2] migrate profile 파싱 실패: " + pex.getMessage());
                    }
                }

                // (b) memory[] → episodes (channel='chat:legacy'). 순서 보존.
                if (memoryArr != null) {
                    int n = memoryArr.length();
                    for (int i = 0; i < n; i++) {
                        try {
                            String note = memoryArr.getString(i);
                            if (note == null) continue;
                            // 단순 파싱 실패 시 query 통째.
                            dao.appendEpisode(note, "", null, null, "chat:legacy");
                            did = true;
                        } catch (Exception ignored) { /* 중복·파싱 실패 무시(데이터 유실 0 — 멱등) */ }
                    }
                }

                // (c) style_digest — 단순 upsert (REPLACE).
                if (styleJson != null && !styleJson.isEmpty()) {
                    try {
                        JSONObject s = new JSONObject(styleJson);
                        StyleDigestEntity sd = new StyleDigestEntity();
                        sd.id = 1;
                        sd.totalQuestions  = s.optInt("totalQuestions", 0);
                        sd.styleNote       = s.has("styleNote") ? s.optString("styleNote", null) : null;
                        sd.preferredFormat = s.has("preferredFormat") ? s.optString("preferredFormat", null) : null;
                        sd.firstAt         = System.currentTimeMillis();
                        sd.updatedAt       = System.currentTimeMillis();
                        dao.upsertStyleDigest(sd);
                        did = true;
                    } catch (Exception sex) {
                        Log.w(TAG, "[N2] migrate style 파싱 실패: " + sex.getMessage());
                    }
                }

                // (d) focus / naturalVoice — settings 테이블 후속 라운드.
                //     자료 보존을 위해 입력은 받지만 본 라운드는 무저장(데이터 유실 0).
                if (focusJson != null) { /* settings 테이블 도입 후 채움 */ }
                if (naturalVoice != null) { /* settings 테이블 도입 후 채움 */ }

                JSObject ret = new JSObject();
                ret.put("migrated", did);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("migrate_failed", e);
            }
        });
    }
}
