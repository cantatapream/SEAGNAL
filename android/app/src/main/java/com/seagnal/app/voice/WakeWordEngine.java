package com.seagnal.app.voice;

/**
 * 호출어("나리야") 감지 엔진 추상화.
 *
 * [목적]
 *   하이브리드 전략을 위한 경계면. 지금은 안드로이드 기본 음성인식 기반
 *   {@link AndroidSpeechWakeEngine} 를 쓰지만, 나중에 Porcupine 등 전용
 *   온디바이스 호출어 엔진으로 교체할 때 이 인터페이스만 새로 구현하면 된다.
 *   서비스({@link VoiceAssistantService})의 나머지 로직(명령 녹음·API 호출·
 *   TTS)은 엔진이 무엇이든 그대로 재사용된다.
 *
 * [수명주기]
 *   start(cb) → (호출어 감지 시 cb.onWake()) → stop() → … → destroy()
 *   onWake() 직후에는 서비스가 명령 인식을 위해 stop() 을 호출하므로, 엔진은
 *   onWake 를 한 번 통지한 뒤 추가 통지를 멈춰도 된다(서비스가 다시 start 한다).
 */
public interface WakeWordEngine {

    interface Callback {
        /** 호출어가 감지됨 — 메인 스레드에서 호출된다. */
        void onWake();
        /** 복구 불가능한 오류(예: 권한 거부) — 메인 스레드에서 호출된다. */
        void onError(String message);
    }

    /** 청취 시작. 이미 시작된 상태에서 다시 호출되면 무시한다. */
    void start(Callback callback);

    /** 청취 중지(자원은 유지). start 로 재개 가능. */
    void stop();

    /** 엔진 자원 완전 해제. 서비스 종료 시 호출. */
    void destroy();
}
