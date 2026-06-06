package com.seagnal.app.voice;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import java.util.ArrayList;
import java.util.Locale;

/**
 * 안드로이드 기본 {@link SpeechRecognizer} 기반 호출어 감지 엔진 (하이브리드 1단계).
 *
 * [동작]
 *   연속 음성인식을 돌리면서 부분/최종 결과 텍스트에 호출어가 들어있는지 검사한다.
 *   감지되면 {@link Callback#onWake()} 를 한 번 통지한다.
 *   기본 인식기는 "짧은 한 번" 용이라, 세션이 끝날 때마다(onResults/onError/
 *   onEndOfSpeech) 자동으로 재시작하여 "상시 대기"를 흉내낸다.
 *
 * [한계 — 의도된 트레이드오프]
 *   - 재시작 사이의 짧은 공백 동안의 발화는 놓칠 수 있다.
 *   - 전체 STT 를 계속 돌리므로 배터리 소모가 크고, OEM 배터리 최적화가
 *     백그라운드 서비스를 죽일 수 있다.
 *   → 프로덕션 상시 대기는 PorcupineWakeEngine 으로 교체 권장.
 *
 * [스레드]
 *   SpeechRecognizer 는 메인 스레드(Looper) 에서 생성/조작해야 한다.
 *   모든 인식기 조작을 mainHandler 로 포스트한다.
 */
public class AndroidSpeechWakeEngine implements WakeWordEngine {

    private static final String TAG = "WakeEngine";

    // 호출어 변형 — 한국어 STT 가 "나리야"를 살짝 다르게 받아쓸 수 있어 여러 형태를 허용.
    private static final String[] WAKE_VARIANTS = {
            "나리야", "나리아", "나리", "날이야", "나리얌"
    };

    // 오류 후 재시작 지연(ms). RECOGNIZER_BUSY 등 연쇄 오류 시 폭주 방지.
    private static final long RESTART_DELAY_MS = 400L;

    private final Context appContext;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private SpeechRecognizer recognizer;
    private Callback callback;
    private volatile boolean running = false;

    public AndroidSpeechWakeEngine(Context context) {
        this.appContext = context.getApplicationContext();
    }

    @Override
    public void start(final Callback cb) {
        this.callback = cb;
        if (running) return;
        running = true;
        mainHandler.post(this::beginListening);
    }

    @Override
    public void stop() {
        running = false;
        mainHandler.post(() -> {
            if (recognizer != null) {
                try { recognizer.cancel(); } catch (Exception ignored) {}
            }
        });
    }

    @Override
    public void destroy() {
        running = false;
        mainHandler.post(() -> {
            if (recognizer != null) {
                try { recognizer.destroy(); } catch (Exception ignored) {}
                recognizer = null;
            }
        });
    }

    /** 메인 스레드에서 인식 세션 1회 시작 (끝나면 onEnd 계열에서 재시작). */
    private void beginListening() {
        if (!running) return;
        if (!SpeechRecognizer.isRecognitionAvailable(appContext)) {
            notifyError("이 기기에서 음성 인식을 사용할 수 없습니다.");
            running = false;
            return;
        }
        try {
            if (recognizer == null) {
                recognizer = SpeechRecognizer.createSpeechRecognizer(appContext);
                recognizer.setRecognitionListener(listener);
            }
            recognizer.startListening(buildIntent());
        } catch (Exception e) {
            Log.w(TAG, "startListening 실패: " + e.getMessage());
            scheduleRestart();
        }
    }

    private Intent buildIntent() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        // 가능하면 온디바이스 인식 — 네트워크/배터리 절감 (Android 13+)
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, appContext.getPackageName());
        return intent;
    }

    private void scheduleRestart() {
        if (!running) return;
        mainHandler.postDelayed(this::beginListening, RESTART_DELAY_MS);
    }

    private void notifyError(final String msg) {
        final Callback cb = callback;
        if (cb != null) mainHandler.post(() -> cb.onError(msg));
    }

    /** 결과 텍스트에 호출어가 들어있으면 onWake 통지 후 true 반환. */
    private boolean checkWake(Bundle results) {
        if (results == null) return false;
        ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (list == null) return false;
        for (String phrase : list) {
            String norm = normalize(phrase);
            for (String w : WAKE_VARIANTS) {
                if (norm.contains(normalize(w))) {
                    return true;
                }
            }
        }
        return false;
    }

    private static String normalize(String s) {
        if (s == null) return "";
        return s.toLowerCase(Locale.KOREAN).replaceAll("[\\s.,!?~·]", "");
    }

    private void fireWake() {
        running = false; // onWake 후엔 서비스가 명령 인식을 진행하므로 일단 정지
        final Callback cb = callback;
        if (cb != null) cb.onWake();
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}

        @Override
        public void onPartialResults(Bundle partialResults) {
            // 부분 결과로 호출어를 빠르게 잡아 반응 지연을 줄인다.
            if (running && checkWake(partialResults)) {
                fireWake();
            }
        }

        @Override
        public void onResults(Bundle results) {
            if (!running) return;
            if (checkWake(results)) {
                fireWake();
            } else {
                scheduleRestart();
            }
        }

        @Override
        public void onError(int error) {
            if (!running) return;
            // NO_MATCH / SPEECH_TIMEOUT / BUSY 등은 정상 흐름 — 그냥 재시작.
            scheduleRestart();
        }

        @Override public void onEvent(int eventType, Bundle params) {}
    };
}
