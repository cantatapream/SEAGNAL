package com.seagnal.app.voice;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import com.seagnal.app.MainActivity;
import com.seagnal.app.R;

// [N2] 사용자 기억 v2 — 같은 프로세스 DAO 직결(Plugin 우회).
//   설계: local_server/knowledge/phases/n2_user_memory_client_integration.md §3
import com.seagnal.app.memory.EpisodeEntity;
import com.seagnal.app.memory.StyleDigestEntity;
import com.seagnal.app.memory.UserMemoryDao;
import com.seagnal.app.memory.UserMemoryDatabase;
import com.seagnal.app.memory.UserProfileEntity;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 음성 비서 백그라운드 상시 청취 서비스 (포그라운드 서비스).
 *
 * [전체 흐름 — 상태 머신]
 *   WAKE(호출어 대기) → onWake → COMMAND(질문 녹음) → THINKING(서버 질의)
 *   → SPEAKING(TTS 답변) → 다시 WAKE
 *
 * [구성]
 *   - 호출어 감지: {@link WakeWordEngine} (현재 안드로이드 기본 인식 구현)
 *   - 질문 녹음:   별도 SpeechRecognizer 1회 세션 (호출어 엔진은 그동안 정지)
 *   - 서버 질의:   POST {serverUrl}/api/assistant/ask  → JSON {answer}
 *   - 답변 출력:   TextToSpeech(ko-KR)
 *
 * [안드로이드 14+(API34)]
 *   마이크 포그라운드 서비스는 매니페스트 foregroundServiceType="microphone" +
 *   FOREGROUND_SERVICE_MICROPHONE 권한 + 앱이 포그라운드일 때 시작해야 한다.
 *   (플러그인 enable() 이 앱 화면에서 호출되므로 충족)
 *
 * [Porcupine 교체 지점]
 *   wakeEngine 생성부만 PorcupineWakeEngine 으로 바꾸면 나머지는 그대로 동작.
 */
public class VoiceAssistantService extends Service {

    private static final String TAG = "VoiceAssistant";

    public static final String ACTION_STOP = "com.seagnal.app.voice.STOP";
    public static final String ACTION_LISTEN_ONCE = "com.seagnal.app.voice.LISTEN_ONCE";
    public static final String EXTRA_SERVER_URL = "serverUrl";
    public static final String EXTRA_PROFILE = "profile";
    public static final String EXTRA_MODE = "mode";   // "always"(상시 대기) | "ptt"(버튼 눌러 말하기)
    private static final String DEFAULT_SERVER_URL = "https://seagnal-server.fly.dev";

    // 상태표시줄에 거의 안 보이게(IMPORTANCE_MIN). 기존 채널은 한 번 만들어지면 중요도를
    //   못 낮추므로 새 채널 ID 로 교체해 MIN 중요도를 확실히 적용한다.
    private static final String CHANNEL_ID = "seagnal_voice_assistant_min";
    private static final int NOTIF_ID = 7321;
    private static final long COMMAND_TIMEOUT_MS = 7000L;

    /** 플러그인(SeagnalAssistantPlugin) 의 isEnabled 조회용. */
    public static volatile boolean isRunning = false;

    /**
     * 현재 가동 중인 서비스가 onCreate 에서 실제로 고른 호출어 엔진 표식(#39).
     * 관리자 AI 패널이 getCapabilities 로 읽어 "현재 엔진: Vosk ✅ / 안드로이드 기본 ⚠️"
     * 을 보여 폴백 여부를 즉시 눈으로 확인할 수 있게 한다. null = 미가동.
     */
    public static volatile String activeEngine = null;  // "porcupine" | "vosk" | "android"

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private WakeWordEngine wakeEngine;
    private SpeechRecognizer commandRecognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    private String serverUrl = DEFAULT_SERVER_URL;
    // 호출어 대기 방식: false=상시 대기("나리야" 핸즈프리), true=푸시투토크(버튼 탭할 때만 듣기).
    //   PTT 에서는 wakeEngine 을 켜지 않아 평소 마이크를 점유하지 않는다(초록 마이크 표시 없음).
    private volatile boolean pttMode = false;
    private String profileJson = null;   // 개인화용 프로필(JSON 문자열) — 휴대폰에서 전달받음
    // 직전 턴의 focus(서버 응답 그대로의 JSON 문자열) — 음성 비서 대화의 구조화 연속성.
    // 웹 UI(js/assistant.js)는 localStorage 로 이걸 잇지만, 음성 비서는 자체적으로
    // 기억해 두지 않으면 "거기 경위도?" 같은 후속질문이 끊긴다(서버 자체는 focus 만
    // 받으면 정확히 이어주는 것을 P3 단계에서 검증). null = 첫 턴 또는 직전 focus 없음.
    private String lastFocusJson = null;
    // 직전 N턴의 자연어 메모(채팅창 js/assistant.js 와 동일 포맷):
    //   `[zone:] "질문" → 답(160자)`. 채팅창은 localStorage 로 관리하지만 음성 비서는
    //   자체 보관. focus 는 해양·기상 *대상*만 담는 반면, memory 는 *비도메인*("뽀로로
    //   파크" 같은 일반 화제)까지 후속을 이을 수 있게 LLM 에 자연어로 전달.
    //   서버는 memory.slice(-3) 만 프롬프트에 박으므로 휴대폰엔 더 넉넉히 보관해 둔다.
    private static final int MEMORY_MAX = 8;
    private final java.util.ArrayDeque<String> recentMemory = new java.util.ArrayDeque<>(MEMORY_MAX);
    private Runnable commandTimeoutRunnable;

    private enum State { IDLE, WAKE, COMMAND, THINKING, SPEAKING }
    private volatile State state = State.IDLE;

    // ── 수명주기 ──────────────────────────────────────────────────────────
    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        initTts();
        // 호출어 엔진 선택 우선순위:
        //   1) Porcupine     — assets 3종(.ppn/params/key) 갖춰진 경우만(저전력 KWS)
        //   2) Vosk          — 사용자 동의로 한국어 모델 다운로드 완료 시(오프라인 ASR + 문법 제한)
        //   3) AndroidSpeech — 둘 다 없을 때의 마지막 안전망(연속 STT 기반 폴백)
        if (PorcupineWakeEngine.isAvailable(this)) {
            wakeEngine = new PorcupineWakeEngine(this);
            activeEngine = "porcupine";
            Log.i(TAG, "호출어 엔진: Porcupine");
        } else if (VoskWakeEngine.isAvailable(this)) {
            wakeEngine = new VoskWakeEngine(this);
            activeEngine = "vosk";
            Log.i(TAG, "호출어 엔진: Vosk(오프라인 한국어)");
        } else {
            wakeEngine = new AndroidSpeechWakeEngine(this);
            activeEngine = "android";
            Log.i(TAG, "호출어 엔진: AndroidSpeechRecognizer(폴백)");
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopEverythingAndSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && intent.hasExtra(EXTRA_SERVER_URL)) {
            String u = intent.getStringExtra(EXTRA_SERVER_URL);
            if (u != null && !u.isEmpty()) serverUrl = u.replaceAll("/+$", "");
        }
        if (intent != null && intent.hasExtra(EXTRA_PROFILE)) {
            profileJson = intent.getStringExtra(EXTRA_PROFILE);
        }
        if (intent != null && intent.hasExtra(EXTRA_MODE)) {
            pttMode = "ptt".equals(intent.getStringExtra(EXTRA_MODE));
        }

        // PTT: 버튼 탭(ACTION_LISTEN_ONCE)으로 한 번만 듣기. 평소엔 마이크를 켜지 않는다.
        if (intent != null && ACTION_LISTEN_ONCE.equals(intent.getAction())) {
            if (!isRunning) {
                startForegroundSafely(getString_(R.string.app_name) + " 음성 비서", "듣고 있어요…");
                isRunning = true;
            }
            enterCommandMode();
            return START_STICKY;
        }

        String idleText = pttMode ? "탭하여 말하기" : "\"나리야\" 라고 불러주세요";
        startForegroundSafely(getString_(R.string.app_name) + " 음성 비서", idleText);
        isRunning = true;
        if (pttMode) enterPttIdle(); else enterWakeMode();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        activeEngine = null;
        SeagnalAssistantPlugin.emitState("idle", null, null);   // 화면 오버레이 즉시 숨김
        cancelCommandTimeout();
        if (wakeEngine != null) wakeEngine.destroy();
        releaseCommandRecognizer();
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (Exception ignored) {}
            tts = null;
        }
        io.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private String lastQuery = null;   // 화면 오버레이 표시용

    // ── 상태 전이 ──────────────────────────────────────────────────────────
    private void enterWakeMode() {
        state = State.WAKE;
        updateNotification("\"나리야\" 라고 불러주세요");
        SeagnalAssistantPlugin.emitState("wake", null, null);
        wakeEngine.start(wakeCallback);
    }

    /** PTT 대기 — 마이크를 켜지 않고 버튼 탭을 기다린다(초록 마이크 표시 없음). */
    private void enterPttIdle() {
        state = State.IDLE;
        if (wakeEngine != null) wakeEngine.stop();   // 혹시 켜져 있었다면 중지(마이크 해제)
        updateNotification("탭하여 말하기");
        SeagnalAssistantPlugin.emitState("idle", null, null);   // 오버레이 숨김
    }

    /** 한 턴(질문→답변)이 끝났을 때 복귀 — 상시 대기면 호출어 대기, PTT 면 마이크 끄고 대기. */
    private void afterTurn() {
        if (pttMode) enterPttIdle(); else enterWakeMode();
    }

    private final WakeWordEngine.Callback wakeCallback = new WakeWordEngine.Callback() {
        @Override public void onWake() {
            mainHandler.post(VoiceAssistantService.this::enterCommandMode);
        }
        @Override public void onError(String message) {
            mainHandler.post(() -> {
                Log.w(TAG, "WakeEngine 오류: " + message);
                updateNotification("음성 인식 사용 불가: " + message);
            });
        }
    };

    private void enterCommandMode() {
        state = State.COMMAND;
        wakeEngine.stop();              // 명령 녹음 동안 호출어 엔진 정지(마이크 충돌 방지)
        beep();
        updateNotification("듣고 있어요… 질문하세요");
        SeagnalAssistantPlugin.emitState("listening", null, null);
        startCommandRecognition();
        scheduleCommandTimeout();
    }

    private void startCommandRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            speak("이 기기에서는 음성 인식을 사용할 수 없습니다.");
            return;
        }
        releaseCommandRecognizer();
        commandRecognizer = SpeechRecognizer.createSpeechRecognizer(this);
        commandRecognizer.setRecognitionListener(commandListener);
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR");
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        // [정확도] 명령 인식은 온라인(고품질) 엔진을 쓰도록 오프라인 선호 해제.
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
        // [조기 종료 방지] 말이 끝나기 전에 인식이 끊겨 버리는 문제 완화 —
        //   침묵 허용 시간을 늘려 사용자가 잠깐 멈춰도 끝났다고 단정하지 않게 한다.
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
        intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 3000L);
        try {
            commandRecognizer.startListening(intent);
        } catch (Exception e) {
            Log.w(TAG, "명령 인식 시작 실패: " + e.getMessage());
            enterWakeMode();
        }
    }

    private final RecognitionListener commandListener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() { cancelCommandTimeout(); }
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onPartialResults(Bundle partialResults) {}
        @Override public void onEvent(int eventType, Bundle params) {}

        @Override
        public void onResults(Bundle results) {
            cancelCommandTimeout();
            String query = firstResult(results);
            if (query == null || query.trim().isEmpty()) {
                speak("질문을 잘 못 들었어요. 다시 불러 주세요.");
            } else {
                handleQuery(query.trim());
            }
        }

        @Override
        public void onError(int error) {
            cancelCommandTimeout();
            // 명령 인식 실패 → 짧게 안내하고 호출어 대기로 복귀
            if (error == SpeechRecognizer.ERROR_NO_MATCH
                    || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                speak(pttMode ? "질문을 못 들었어요. 다시 눌러서 말씀해 주세요."
                              : "질문을 못 들었어요. 다시 나리야 라고 불러 주세요.");
            } else {
                afterTurn();
            }
        }
    };

    private void handleQuery(final String query) {
        state = State.THINKING;
        lastQuery = query;
        updateNotification("생각 중…");
        SeagnalAssistantPlugin.emitState("thinking", query, null);
        io.execute(() -> {
            final String answer = askServer(query);
            mainHandler.post(() -> speak(answer));
        });
    }

    // ── 서버 질의 ──────────────────────────────────────────────────────────
    private String askServer(String query) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(serverUrl + "/api/assistant/ask");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(12000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");

            JSONObject body = new JSONObject();
            body.put("query", query);
            // 개인화 프로필 동봉(있으면). JSON 이면 객체로, 아니면 문자열로 전송.
            if (profileJson != null && !profileJson.isEmpty()) {
                try { body.put("profile", new JSONObject(profileJson)); }
                catch (Exception ex) { body.put("profile", profileJson); }
            }
            // 기기 최근 위치 동봉 — "내 위치 가까운 부이" 류 음성 질문 지원
            double[] loc = getLastLocation();
            if (loc != null) {
                JSONObject l = new JSONObject();
                l.put("lat", loc[0]); l.put("lon", loc[1]);
                body.put("location", l);
            }
            // 직전 턴 focus 동봉 — "거기 경위도?" 처럼 주어 없는 후속을 서버가 이어준다(P3).
            if (lastFocusJson != null && !lastFocusJson.isEmpty()) {
                try { body.put("focus", new JSONObject(lastFocusJson)); }
                catch (Exception ignored) { /* 손상 시 무시 — 다음 응답에서 다시 채워짐 */ }
            }
            // 직전 N턴 메모 동봉 — 비도메인 후속("뽀로로 파크 → 거기 이용 금액?") 등 focus 가
            //   못 담는 자유 화제를 LLM 이 자연어로 잇게 한다(채팅창과 동등).
            if (!recentMemory.isEmpty()) {
                org.json.JSONArray memArr = new org.json.JSONArray();
                for (String note : recentMemory) memArr.put(note);
                body.put("memory", memArr);
            }
            // [N2 §3.1] SQLite 정본 조회 → userMemorySnapshot 동봉(Plugin 우회 DAO 직결).
            //   같은 프로세스의 UserMemoryDao 직접 호출 — 채팅 WebView 와 동일 DB 단일 정본.
            //   회귀 가드: try/catch 로 SQLite 실패 시 기존 흐름 그대로(서버는 신키 무시 — G1).
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
                    try { snapshot.put("focus", new JSONObject(lastFocusJson)); }
                    catch (Exception ignored) { /* 손상 시 무시 */ }
                }
                org.json.JSONArray epsArr = new org.json.JSONArray();
                for (EpisodeEntity ep : epRows) {
                    JSONObject o = new JSONObject();
                    o.put("id",      ep.id);
                    o.put("ts",      ep.createdAt);
                    o.put("channel", ep.sourceChannel);
                    o.put("zone",    ep.zone);
                    // assistant.js#pushMemory 와 byte-equal — 서버 프롬프트 변경 0 (G1).
                    String z = ep.zone == null ? "" : ep.zone + ": ";
                    String a = ep.answerSummary == null ? "" : ep.answerSummary;
                    if (a.length() > 160) a = a.substring(0, 160);
                    o.put("note", z + "\"" + ep.query + "\" → " + a);
                    epsArr.put(o);
                }
                snapshot.put("episodes", epsArr);
                body.put("userMemorySnapshot", snapshot);
            } catch (Exception snapEx) {
                Log.w(TAG, "[N2] userMemorySnapshot skip: " + snapEx.getMessage());
                // 회귀 가드 — snapshot 미동봉 시 서버는 기존 profile/memory/focus 만 사용 (G1).
            }
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                return "서버에서 답을 받지 못했어요. 잠시 후 다시 시도해 주세요.";
            }
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }
            JSONObject json = new JSONObject(sb.toString());
            // 응답의 focus 를 다음 턴까지 들고 간다(없으면 초기화 — 명시적으로 컨텍스트 종료).
            JSONObject focusObj = json.optJSONObject("focus");
            lastFocusJson = (focusObj != null) ? focusObj.toString() : null;
            String answer = json.optString("answer", "");
            if (answer.isEmpty()) {
                return "죄송해요, 답변을 만들지 못했어요.";
            }
            // 자연어 메모 한 줄 추가 — 채팅창 js/assistant.js 와 동일 포맷.
            //   "[해역:] \"질문\" → 답(160자)". 다음 턴에 이전 N개를 함께 전송.
            try {
                String zone = json.optString("zone", "");
                String shortAns = answer.length() > 160 ? answer.substring(0, 160) : answer;
                String note = (zone != null && !zone.isEmpty() ? zone + ": " : "")
                        + "\"" + query + "\" → " + shortAns;
                recentMemory.addLast(note);
                while (recentMemory.size() > MEMORY_MAX) recentMemory.pollFirst();

                // [N2 §3.2] SQLite 정본 적재 — DAO 직결(Plugin 우회).
                //   트랜잭션은 DAO.appendEpisode 의 @Transaction 헬퍼가 보장.
                //   회귀 가드: 내부 try/catch — DAO 실패는 음성 답변 흐름과 무관.
                try {
                    UserMemoryDao dao = UserMemoryDatabase.getInstance(getApplicationContext()).userMemoryDao();
                    String ans600 = answer.length() > 600 ? answer.substring(0, 600) : answer;
                    long id = dao.appendEpisode(
                            query,
                            ans600,
                            (zone == null || zone.isEmpty()) ? null : zone,
                            null,        // tools — 음성 측은 미수집 (서버 응답의 links 도 미파싱)
                            "voice"
                    );
                    // 채팅 WebView 캐시 무효화 신호 — Plugin static helper 통해 notifyListeners.
                    SeagnalAssistantPlugin.notifyEpisodesChanged(id, "voice", System.currentTimeMillis());

                    // 8턴마다 압축 트리거 (debounce 머지 — 단일 풀이라 폭주 무해).
                    int cnt = dao.countEpisodes();
                    if (cnt > 0 && (cnt % 8) == 0) {
                        // A3 Consolidator 미연결 — N_impl 라운드가 채움.
                        // 본 라운드는 ack 만(자체 enqueue 도 무해).
                    }
                } catch (Exception dbEx) {
                    Log.w(TAG, "[N2] DAO appendEpisode 실패: " + dbEx.getMessage());
                }
            } catch (Exception ignored) { /* 메모 적재 실패는 답변 흐름과 무관 */ }
            return answer;
        } catch (Exception e) {
            Log.w(TAG, "서버 질의 실패: " + e.getMessage());
            return "지금은 데이터를 가져오지 못했어요. 네트워크를 확인해 주세요.";
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ── TTS ───────────────────────────────────────────────────────────────
    private void initTts() {
        tts = new TextToSpeech(this, status -> {
            if (status == TextToSpeech.SUCCESS) {
                try {
                    tts.setLanguage(Locale.KOREAN);
                    tts.setOnUtteranceProgressListener(utteranceListener);
                    ttsReady = true;
                } catch (Exception e) {
                    Log.w(TAG, "TTS 언어 설정 실패: " + e.getMessage());
                }
            } else {
                Log.w(TAG, "TTS 초기화 실패: status=" + status);
            }
        });
    }

    private final UtteranceProgressListener utteranceListener = new UtteranceProgressListener() {
        @Override public void onStart(String utteranceId) {}
        @Override public void onDone(String utteranceId) {
            mainHandler.post(VoiceAssistantService.this::afterTurn);
        }
        @Override public void onError(String utteranceId) {
            mainHandler.post(VoiceAssistantService.this::afterTurn);
        }
    };

    /** 답변을 화면 알림에 표시하고 음성으로 읽는다. 끝나면 호출어 대기로 복귀. */
    private void speak(String text) {
        state = State.SPEAKING;
        wakeEngine.stop(); // 자기 목소리를 다시 인식하지 않도록
        answerCue();       // 답변 시작 신호음(듣기 종료→답변 시작 구분)
        updateNotification(text);
        SeagnalAssistantPlugin.emitState("speaking", lastQuery, text);
        if (ttsReady && tts != null) {
            try {
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "seagnal-answer");
                return;
            } catch (Exception e) {
                Log.w(TAG, "TTS speak 실패: " + e.getMessage());
            }
        }
        // TTS 미준비/실패 시에도 멈추지 않고 대기로 복귀(상시=호출어 / PTT=버튼 대기)
        mainHandler.postDelayed(this::afterTurn, 1500L);
    }

    // ── 알림(포그라운드) ─────────────────────────────────────────────────────
    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "음성 비서", NotificationManager.IMPORTANCE_MIN);
            channel.setDescription("호출어 \"나리야\" 상시 청취");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            channel.enableVibration(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String title, String text) {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(
                this, 0, openIntent, pendingFlags());

        Intent stopIntent = new Intent(this, VoiceAssistantService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(
                this, 1, stopIntent, pendingFlags());

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openPi)
                .addAction(0, "끄기", stopPi)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setSilent(true)
                .build();
    }

    private int pendingFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return flags;
    }

    private void startForegroundSafely(String title, String text) {
        Notification n = buildNotification(title, text);
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
        try {
            ServiceCompat.startForeground(this, NOTIF_ID, n, type);
        } catch (Exception e) {
            // 일부 기기/상황(백그라운드 시작 제한)에서 실패할 수 있음 — 로그만 남김
            Log.w(TAG, "startForeground 실패: " + e.getMessage());
        }
    }

    private void updateNotification(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            nm.notify(NOTIF_ID, buildNotification(getString_(R.string.app_name) + " 음성 비서", text));
        }
    }

    // ── 유틸 ──────────────────────────────────────────────────────────────
    private void scheduleCommandTimeout() {
        cancelCommandTimeout();
        commandTimeoutRunnable = () -> {
            if (state == State.COMMAND) {
                releaseCommandRecognizer();
                afterTurn();
            }
        };
        mainHandler.postDelayed(commandTimeoutRunnable, COMMAND_TIMEOUT_MS);
    }

    private void cancelCommandTimeout() {
        if (commandTimeoutRunnable != null) {
            mainHandler.removeCallbacks(commandTimeoutRunnable);
            commandTimeoutRunnable = null;
        }
    }

    private void releaseCommandRecognizer() {
        if (commandRecognizer != null) {
            try { commandRecognizer.destroy(); } catch (Exception ignored) {}
            commandRecognizer = null;
        }
    }

    private void stopEverythingAndSelf() {
        isRunning = false;
        SeagnalAssistantPlugin.emitState("idle", null, null);   // 화면 오버레이 즉시 숨김
        cancelCommandTimeout();
        if (wakeEngine != null) wakeEngine.stop();
        releaseCommandRecognizer();
        if (tts != null) { try { tts.stop(); } catch (Exception ignored) {} }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /** 듣기 시작 신호음(짧은 단음) */
    private void beep() {
        try {
            ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70);
            tg.startTone(ToneGenerator.TONE_PROP_BEEP, 150);
            mainHandler.postDelayed(tg::release, 250);
        } catch (Exception ignored) {}
    }

    /** 답변 시작 신호음(상승 더블톤) — 듣기 종료 후 답변이 시작됨을 알림. */
    private void answerCue() {
        try {
            final ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70);
            tg.startTone(ToneGenerator.TONE_PROP_ACK, 200);
            mainHandler.postDelayed(tg::release, 350);
        } catch (Exception ignored) {}
    }

    private String firstResult(Bundle results) {
        if (results == null) return null;
        ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return (list != null && !list.isEmpty()) ? list.get(0) : null;
    }

    /** 기기 최근 위치(권한 있을 때) — "내 위치/가까운" 음성 질문에 좌표 동봉용. 없으면 null. */
    private double[] getLastLocation() {
        try {
            boolean fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            boolean coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            if (!fine && !coarse) return null;
            LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;
            String[] providers = { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER };
            Location best = null;
            for (String p : providers) {
                try {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                } catch (SecurityException ignored) {}
            }
            return best != null ? new double[] { best.getLatitude(), best.getLongitude() } : null;
        } catch (Exception e) { return null; }
    }

    /** R.string 접근 실패(리소스 누락 등)에도 안전하게 문자열 반환. */
    private String getString_(int resId) {
        try { return getString(resId); } catch (Exception e) { return "SEAGNAL"; }
    }
}
