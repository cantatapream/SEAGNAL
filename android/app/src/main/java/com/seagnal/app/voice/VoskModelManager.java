package com.seagnal.app.voice;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import java.io.File;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Vosk 한국어 모델의 다운로드 상태·경로를 단일 출처로 관리하는 싱글톤.
 *
 * [상태]
 *   NOT_DOWNLOADED → DOWNLOADING → READY  (정상 경로)
 *                              ↘ FAILED        (네트워크·압축해제 오류 등)
 *                              ↘ WIFI_REQUIRED (Wi-Fi 아님 + allowMobile=false)
 *   READY 는 모델 디렉터리 내 .ready 마커 파일로 영구 판단(앱 재기동 후에도 유지).
 *   그 외 상태는 휘발(앱 종료 시 사라짐 — 미완료 다운로드는 다음 요청 때 처음부터).
 *
 * [경로 규약]
 *   modelDir = filesDir/vosk-model-ko/                ← Vosk Model 생성자에 넘기는 경로
 *   marker   = filesDir/vosk-model-ko/.ready          ← 정상 압축해제 완료 후 0바이트 생성
 *   tmpZip   = filesDir/vosk-model-ko.zip.partial     ← 다운로드 중 임시 zip
 *
 * [리스너]
 *   addListener / removeListener — 진행률·상태 변경을 메인 스레드로 통지.
 *   SeagnalAssistantPlugin 이 구독해 voskState 이벤트로 WebView 에 전달한다.
 *
 * [모델 출처]
 *   alphacephei 공식 한국어 소형 모델(MODEL_URL). Apache-2.0. 사이즈 ~82MB.
 *   URL/파일명은 setSource() 로 런타임 교체 가능(향후 미러 대비).
 */
public final class VoskModelManager {

    public static final String MODEL_DIR_NAME = "vosk-model-ko";
    private static final String MARKER_NAME = ".ready";
    public static final String TMP_ZIP_NAME = "vosk-model-ko.zip.partial";

    // 기본 다운로드 URL (alphacephei 공식 한국어 소형 모델). 필요시 setSource 로 교체.
    private static volatile String MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-ko-0.22.zip";
    // 예상 크기(바이트, 참고용 — 진행률 표시 등에 사용). Content-Length 가 우선.
    private static volatile long EXPECTED_BYTES = 82_000_000L;

    public enum State { NOT_DOWNLOADED, DOWNLOADING, READY, FAILED, WIFI_REQUIRED }

    public interface Listener {
        /** 메인 스레드. state 가 DOWNLOADING 일 때만 progress 0~100 유효, 그 외 -1. */
        void onVoskStateChanged(State state, int progress, String message);
    }

    private static volatile VoskModelManager INSTANCE;
    public static VoskModelManager get() {
        if (INSTANCE == null) {
            synchronized (VoskModelManager.class) {
                if (INSTANCE == null) INSTANCE = new VoskModelManager();
            }
        }
        return INSTANCE;
    }
    private VoskModelManager() {}

    private final Handler main = new Handler(Looper.getMainLooper());
    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<>();
    private volatile State state = null;            // null = 아직 초기화 안 됨(파일 체크 전)
    private volatile int progress = -1;
    private volatile String message = null;

    // ── 경로/마커 ────────────────────────────────────────────────────────────
    public static File modelDir(Context ctx) { return new File(ctx.getFilesDir(), MODEL_DIR_NAME); }
    public static File markerFile(Context ctx) { return new File(modelDir(ctx), MARKER_NAME); }
    public static File tmpZipFile(Context ctx) { return new File(ctx.getFilesDir(), TMP_ZIP_NAME); }

    /** READY 여부를 디스크에서 즉시 판단(앱 재기동 직후에도 정확). */
    public boolean isReady(Context ctx) { return markerFile(ctx).isFile(); }

    /** 디스크 + 메모리 상태를 반영해 현재 상태를 돌려준다. */
    public State currentState(Context ctx) {
        if (isReady(ctx)) return State.READY;
        State s = state;
        return s != null ? s : State.NOT_DOWNLOADED;
    }
    public int currentProgress() { return progress; }
    public String currentMessage() { return message; }

    public static String modelUrl() { return MODEL_URL; }
    public static long expectedBytes() { return EXPECTED_BYTES; }
    /** 향후 미러 URL 등으로 교체할 때 사용. expected 가 0 이하면 변경하지 않음. */
    public void setSource(String url, long expected) {
        if (url != null && !url.isEmpty()) MODEL_URL = url;
        if (expected > 0) EXPECTED_BYTES = expected;
    }

    // ── 리스너 ───────────────────────────────────────────────────────────────
    public void addListener(Listener l) { if (l != null && !listeners.contains(l)) listeners.add(l); }
    public void removeListener(Listener l) { if (l != null) listeners.remove(l); }

    /** 서비스/다운로드가 상태 변경을 알릴 때 호출. progress 는 DOWNLOADING 일 때만 유효. */
    public void setState(final State s, final int p, final String msg) {
        this.state = s;
        this.progress = (s == State.DOWNLOADING) ? Math.max(0, Math.min(100, p)) : -1;
        this.message = msg;
        for (final Listener l : listeners) {
            main.post(() -> { try { l.onVoskStateChanged(s, progress, msg); } catch (Throwable ignored) {} });
        }
    }

    /** 정상 압축해제 완료 후 마커 생성(다음 부팅 후에도 READY 인식). */
    public boolean markReady(Context ctx) {
        try {
            File dir = modelDir(ctx);
            if (!dir.isDirectory()) return false;
            File m = markerFile(ctx);
            if (!m.exists()) {
                if (!m.createNewFile()) return false;
            }
            setState(State.READY, -1, null);
            return true;
        } catch (Throwable t) { return false; }
    }

    /** 모델 디렉터리·임시 zip 을 모두 삭제. 재다운로드 직전 정리용. */
    public void reset(Context ctx) {
        deleteRecursive(modelDir(ctx));
        File z = tmpZipFile(ctx); if (z.exists()) z.delete();
        setState(State.NOT_DOWNLOADED, -1, null);
    }

    public static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRecursive(k);
        }
        f.delete();
    }
}
