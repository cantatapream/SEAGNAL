package com.seagnal.app.voice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
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

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
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
    public static final String EXTRA_SERVER_URL = "serverUrl";
    private static final String DEFAULT_SERVER_URL = "https://seagnal-server.fly.dev";

    private static final String CHANNEL_ID = "seagnal_voice_assistant";
    private static final int NOTIF_ID = 7321;
    private static final long COMMAND_TIMEOUT_MS = 7000L;

    /** 플러그인(SeagnalAssistantPlugin) 의 isEnabled 조회용. */
    public static volatile boolean isRunning = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private WakeWordEngine wakeEngine;
    private SpeechRecognizer commandRecognizer;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    private String serverUrl = DEFAULT_SERVER_URL;
    private Runnable commandTimeoutRunnable;

    private enum State { IDLE, WAKE, COMMAND, THINKING, SPEAKING }
    private volatile State state = State.IDLE;

    // ── 수명주기 ──────────────────────────────────────────────────────────
    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        initTts();
        wakeEngine = new AndroidSpeechWakeEngine(this);
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

        startForegroundSafely(getString_(R.string.app_name) + " 음성 비서", "\"나리야\" 라고 불러주세요");
        isRunning = true;
        enterWakeMode();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
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

    // ── 상태 전이 ──────────────────────────────────────────────────────────
    private void enterWakeMode() {
        state = State.WAKE;
        updateNotification("\"나리야\" 라고 불러주세요");
        wakeEngine.start(wakeCallback);
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
                speak("질문을 못 들었어요. 다시 나리야 라고 불러 주세요.");
            } else {
                enterWakeMode();
            }
        }
    };

    private void handleQuery(final String query) {
        state = State.THINKING;
        updateNotification("생각 중…");
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
            String answer = json.optString("answer", "");
            if (answer.isEmpty()) {
                return "죄송해요, 답변을 만들지 못했어요.";
            }
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
            mainHandler.post(VoiceAssistantService.this::enterWakeMode);
        }
        @Override public void onError(String utteranceId) {
            mainHandler.post(VoiceAssistantService.this::enterWakeMode);
        }
    };

    /** 답변을 화면 알림에 표시하고 음성으로 읽는다. 끝나면 호출어 대기로 복귀. */
    private void speak(String text) {
        state = State.SPEAKING;
        wakeEngine.stop(); // 자기 목소리를 다시 인식하지 않도록
        updateNotification(text);
        if (ttsReady && tts != null) {
            try {
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "seagnal-answer");
                return;
            } catch (Exception e) {
                Log.w(TAG, "TTS speak 실패: " + e.getMessage());
            }
        }
        // TTS 미준비/실패 시에도 멈추지 않고 호출어 대기로 복귀
        mainHandler.postDelayed(this::enterWakeMode, 1500L);
    }

    // ── 알림(포그라운드) ─────────────────────────────────────────────────────
    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "음성 비서", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("호출어 \"나리야\" 상시 청취");
            channel.setShowBadge(false);
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
                .setPriority(NotificationCompat.PRIORITY_LOW)
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
                enterWakeMode();
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
        cancelCommandTimeout();
        if (wakeEngine != null) wakeEngine.stop();
        releaseCommandRecognizer();
        if (tts != null) { try { tts.stop(); } catch (Exception ignored) {} }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void beep() {
        try {
            ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70);
            tg.startTone(ToneGenerator.TONE_PROP_BEEP, 150);
            mainHandler.postDelayed(tg::release, 250);
        } catch (Exception ignored) {}
    }

    private String firstResult(Bundle results) {
        if (results == null) return null;
        ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return (list != null && !list.isEmpty()) ? list.get(0) : null;
    }

    /** R.string 접근 실패(리소스 누락 등)에도 안전하게 문자열 반환. */
    private String getString_(int resId) {
        try { return getString(resId); } catch (Exception e) { return "SEAGNAL"; }
    }
}
