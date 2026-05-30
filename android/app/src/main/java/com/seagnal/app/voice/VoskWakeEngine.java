package com.seagnal.app.voice;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;

import java.io.IOException;
import java.util.Locale;

/**
 * Vosk(오프라인 한국어 ASR) 기반 호출어 감지 엔진.
 *
 * [원리]
 *   Recognizer 의 문법을 "나리야" 변형들로 제한하면 인식기는 그 단어 외엔 [unk] 로만 응답한다.
 *   → 풀 STT 대비 CPU·오탐 모두 크게 낮춰 키워드 스포터처럼 동작한다.
 *
 * [수명주기]
 *   start(cb) → 모델 디렉터리 로드(백그라운드) → SpeechService 시작 → 인식 결과에 변형 포함 시 onWake()
 *   stop()    → SpeechService 정지(자원 유지)
 *   destroy() → SpeechService·Recognizer·Model 해제
 *
 * [전제]
 *   VoskModelManager.isReady(ctx) == true. 모델 미준비 상태에서 이 엔진을 만들면 start 시 onError.
 *
 * [스레드]
 *   Vosk 콜백은 내부 캡처 스레드에서 발생 — onWake/onError 는 메인 스레드로 포스트한다.
 */
public class VoskWakeEngine implements WakeWordEngine {

    private static final String TAG = "VoskWake";
    private static final float SAMPLE_RATE = 16000f;

    // 한국어 STT 변형 — AndroidSpeech 엔진과 동일 정책. JSON 그대로 부분문자열 검사.
    private static final String[] WAKE_VARIANTS = { "나리야", "나리아", "나리", "날이야", "나리얌" };
    // Recognizer 문법(공백 구분 단어 목록 JSON). [unk] 는 그 외 음성을 모두 흡수.
    private static final String GRAMMAR = "[\"나리야 나리아 나리 날이야 나리얌\", \"[unk]\"]";

    private final Context appContext;
    private final Handler main = new Handler(Looper.getMainLooper());

    private Callback callback;
    private Model model;
    private Recognizer recognizer;
    private SpeechService speech;
    private volatile boolean running = false;
    private volatile boolean starting = false;

    public VoskWakeEngine(Context ctx) {
        this.appContext = ctx.getApplicationContext();
        try { LibVosk.setLogLevel(LogLevel.WARNINGS); } catch (Throwable ignored) {}
    }

    public static boolean isAvailable(Context ctx) {
        return VoskModelManager.get().isReady(ctx);
    }

    @Override
    public void start(final Callback cb) {
        this.callback = cb;
        if (running || starting) return;
        if (!isAvailable(appContext)) { notifyError("Vosk 모델이 준비되지 않았습니다"); return; }
        starting = true;
        // 모델 로드는 ~수백 ms ~ 1s 걸릴 수 있어 백그라운드.
        new Thread(() -> {
            try {
                if (model == null) {
                    model = new Model(VoskModelManager.modelDir(appContext).getAbsolutePath());
                }
                if (recognizer == null) {
                    recognizer = new Recognizer(model, SAMPLE_RATE, GRAMMAR);
                }
                if (speech == null) {
                    speech = new SpeechService(recognizer, SAMPLE_RATE);
                }
                main.post(() -> {
                    if (callback == null) { starting = false; return; }
                    try {
                        speech.startListening(listener);
                        running = true;
                        starting = false;
                    } catch (Throwable t) {
                        starting = false;
                        notifyError("Vosk 시작 실패: " + t.getMessage());
                    }
                });
            } catch (IOException ioe) {
                starting = false;
                Log.w(TAG, "Vosk 모델 로드 실패", ioe);
                notifyError("호출어 엔진 초기화 실패");
            } catch (Throwable t) {
                starting = false;
                Log.w(TAG, "Vosk 초기화 실패", t);
                notifyError("호출어 엔진 초기화 실패: " + t.getClass().getSimpleName());
            }
        }, "VoskWakeInit").start();
    }

    @Override
    public void stop() {
        running = false;
        try { if (speech != null) speech.stop(); } catch (Throwable ignored) {}
    }

    @Override
    public void destroy() {
        running = false;
        try { if (speech != null) { speech.stop(); speech.shutdown(); } } catch (Throwable ignored) {}
        try { if (recognizer != null) recognizer.close(); } catch (Throwable ignored) {}
        try { if (model != null) model.close(); } catch (Throwable ignored) {}
        speech = null; recognizer = null; model = null;
    }

    // ── 매칭 ──────────────────────────────────────────────────────────────
    private boolean containsWake(String hypothesisJson) {
        if (hypothesisJson == null) return false;
        // Vosk hypothesis 는 {"partial":"..."} / {"text":"..."} 형태. 공백·구두점 제거 후 변형 부분일치.
        String norm = hypothesisJson.toLowerCase(Locale.KOREAN).replaceAll("[\\s.,!?~·\\\"\\{\\}:\\[\\]]", "");
        for (String w : WAKE_VARIANTS) {
            if (norm.contains(w)) return true;
        }
        return false;
    }

    private void fireWake() {
        running = false; // 서비스가 명령 인식으로 전환하므로 일단 정지
        final Callback cb = callback;
        if (cb != null) main.post(cb::onWake);
    }

    private void notifyError(final String msg) {
        final Callback cb = callback;
        if (cb != null) main.post(() -> cb.onError(msg));
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onPartialResult(String hypothesis) {
            if (running && containsWake(hypothesis)) fireWake();
        }
        @Override public void onResult(String hypothesis) {
            if (running && containsWake(hypothesis)) fireWake();
        }
        @Override public void onFinalResult(String hypothesis) {
            if (running && containsWake(hypothesis)) fireWake();
        }
        @Override public void onError(Exception e) {
            Log.w(TAG, "Vosk 오류", e);
            // 일시 오류는 폴백 흐름에 영향 주지 않게 onError 콜백은 생략 — 서비스가 재시작 정책 결정.
        }
        @Override public void onTimeout() { /* no-op: SpeechService 가 자동 재시작 */ }
    };
}
