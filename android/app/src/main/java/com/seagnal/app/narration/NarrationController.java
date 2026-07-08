package com.seagnal.app.narration;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.seagnal.app.R;

/**
 * [임시 — 발표 나레이션] 네이티브 오디오 재생 + 상태표시줄 컴팩트 알림 컨트롤러.
 *
 * ※ 발표 시연용 임시 기능. 발표 종료 후 narration/ 패키지 3개 파일과
 *   MainActivity 의 registerPlugin(NarrationPlayerPlugin.class),
 *   AndroidManifest 의 NarrationControlReceiver 를 함께 제거하면 된다.
 *
 * [왜 네이티브인가]
 *   WebView 의 HTML5 Audio + Media Session API 로는 안드로이드 상태표시줄에
 *   재생 컨트롤이 표출되지 않는다(웹뷰 미지원). 발표 중 시연 조작을 하면서
 *   상태바를 내려 나레이션을 정지/탐색해야 하므로 네이티브 MediaPlayer 로 재생한다.
 *
 * [컴팩트 알림 — MediaSession 미사용]
 *   MediaSession/MediaStyle 을 쓰면 시스템(삼성 "실시간 정보" 등)이 큰 미디어 카드를
 *   자체 렌더링해 상태바를 지나치게 차지한다(사용자 요청: 절반 크기).
 *   → 일반(Standard) 알림 + 액션 버튼(⟲10초·재생/일시정지·⟳10초)으로 교체.
 *     시크바 드래그 탐색은 사라지지만 ±10초 버튼과 비대화형 진행바 + 시각
 *     텍스트("0:06 / 0:18")로 진행 상황을 보여준다. 재생 중 1초 간격 갱신.
 *
 * [호출 경로]
 *   NarrationPlayerPlugin(웹 JS) → play()/toggle()/seekTo()/stop()
 *   NarrationControlReceiver(알림 버튼) → toggle()/rewind()/forward()/stop()
 */
public final class NarrationController {

    private static final String TAG = "NarrationPlayer";
    private static final String CHANNEL_ID = "narration_player";
    private static final String CHANNEL_NAME = "발표 나레이션";
    private static final int NOTIF_ID = 88231;
    private static final int SKIP_MS = 10_000;   // ⟲/⟳ 버튼 이동량 (10초)
    private static final int TICK_MS = 1_000;    // 재생 중 알림 진행바 갱신 주기

    // 알림 버튼 → NarrationControlReceiver 브로드캐스트 액션
    static final String ACTION_TOGGLE  = "com.seagnal.app.narration.TOGGLE";
    static final String ACTION_REWIND  = "com.seagnal.app.narration.REWIND";
    static final String ACTION_FORWARD = "com.seagnal.app.narration.FORWARD";
    static final String ACTION_STOP    = "com.seagnal.app.narration.STOP";

    /** prepareAsync 결과를 플러그인(PluginCall)에 알리기 위한 콜백. */
    public interface PrepareCallback {
        void onReady();
        void onError(String message);
    }

    private static NarrationController instance;

    public static synchronized NarrationController get() {
        if (instance == null) instance = new NarrationController();
        return instance;
    }

    private NarrationController() { }

    private Context appCtx;
    private MediaPlayer mp;
    private AudioFocusRequest focusReq;    // API 26+ 오디오 포커스 핸들
    private String title = "발표 나레이션";
    private boolean prepared = false;
    private float rate = 1.0f;             // 관리자 설정 재생 배속 (0.5~2.0)

    // 재생 중 알림 진행바 1초 갱신용 타이머 (메인 루퍼)
    private final Handler ticker = new Handler(Looper.getMainLooper());
    private final Runnable tickRun = new Runnable() {
        @Override public void run() {
            synchronized (NarrationController.this) {
                if (mp == null || !prepared || !isPlayingUnsafe()) return;
                showNotification();
                ticker.postDelayed(this, TICK_MS);
            }
        }
    };

    // 포커스 상실 시 일시정지 (발표 중 다른 소리와 충돌 방지)
    private final AudioManager.OnAudioFocusChangeListener focusListener = new AudioManager.OnAudioFocusChangeListener() {
        @Override public void onAudioFocusChange(int change) {
            if (change == AudioManager.AUDIOFOCUS_LOSS
                    || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
                pause();
            }
        }
    };

    // ────────────────────────────────────────────────────────────────────
    // 공개 제어 API
    // ────────────────────────────────────────────────────────────────────

    /** URL 재생 시작. 이전 재생이 있으면 끊고 새로 시작한다. speed 는 0.5~2.0 배속(그 외 1.0). */
    public synchronized void play(Context ctx, String url, String narrTitle, float speed, final PrepareCallback cb) {
        appCtx = ctx.getApplicationContext();
        if (narrTitle != null && !narrTitle.isEmpty()) title = narrTitle;
        rate = (speed >= 0.5f && speed <= 2.0f) ? speed : 1.0f;
        releasePlayerOnly();
        ensureChannel();

        prepared = false;
        mp = new MediaPlayer();
        try {
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            mp.setDataSource(url);
        } catch (Exception e) {
            Log.e(TAG, "setDataSource 실패: " + e.getMessage());
            releasePlayerOnly();
            if (cb != null) cb.onError("음원 URL 설정 실패: " + e.getMessage());
            return;
        }
        mp.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
            @Override public void onPrepared(MediaPlayer p) {
                synchronized (NarrationController.this) {
                    if (p != mp) return;   // 그 사이 새 재생으로 교체됨
                    prepared = true;
                    requestFocus();
                    p.start();
                    applySpeed();
                    showNotification();
                    startTicker();
                }
                if (cb != null) cb.onReady();
            }
        });
        mp.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
            @Override public void onCompletion(MediaPlayer p) {
                // 자연 종료 → 알림 정리(발표 화면에 잔상 안 남게)
                stop();
            }
        });
        mp.setOnErrorListener(new MediaPlayer.OnErrorListener() {
            @Override public boolean onError(MediaPlayer p, int what, int extra) {
                Log.e(TAG, "MediaPlayer 오류 what=" + what + " extra=" + extra);
                boolean wasPreparing = !prepared;
                stop();
                if (wasPreparing && cb != null) cb.onError("재생 오류 (" + what + "/" + extra + ")");
                return true;
            }
        });
        mp.prepareAsync();
    }

    /** 재생/일시정지 토글 (알림 가운데 버튼). */
    public synchronized void toggle() {
        if (mp == null || !prepared) return;
        if (isPlayingUnsafe()) pauseInternal();
        else resumeInternal();
    }

    public synchronized void pause() {
        if (mp != null && prepared && isPlayingUnsafe()) pauseInternal();
    }

    public synchronized void resume() {
        if (mp != null && prepared && !isPlayingUnsafe()) resumeInternal();
    }

    public synchronized void rewind()  { seekBy(-SKIP_MS); }
    public synchronized void forward() { seekBy(SKIP_MS); }

    /** 절대 위치(ms)로 이동 — JS seekTo(웹 미니 플레이어 슬라이더). */
    public synchronized void seekTo(long posMs) {
        if (mp == null || !prepared) return;
        long dur = mp.getDuration();
        if (posMs < 0) posMs = 0;
        if (dur > 0 && posMs > dur) posMs = dur;
        mp.seekTo((int) posMs);
        showNotification();
    }

    /** 정지 + 알림/플레이어 정리. */
    public synchronized void stop() {
        stopTicker();
        releasePlayerOnly();
        abandonFocus();
        if (appCtx != null) {
            NotificationManager nm = (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID);
        }
    }

    /** JS getState() 용 현재 상태. */
    public synchronized boolean isPlaying() {
        return mp != null && prepared && isPlayingUnsafe();
    }

    // ────────────────────────────────────────────────────────────────────
    // 내부 구현
    // ────────────────────────────────────────────────────────────────────

    /** isPlaying() 이 IllegalStateException 을 던질 수 있는 상태 전이 틈 방어. */
    private boolean isPlayingUnsafe() {
        try { return mp != null && mp.isPlaying(); } catch (Exception e) { return false; }
    }

    private void pauseInternal() {
        mp.pause();
        stopTicker();
        showNotification();
    }

    private void resumeInternal() {
        requestFocus();
        mp.start();
        showNotification();
        startTicker();
    }

    private void seekBy(long deltaMs) {
        if (mp == null || !prepared) return;
        seekTo(mp.getCurrentPosition() + deltaMs);
    }

    /** 관리자 설정 배속 적용 (start() 직후 호출 — 미지원 배속 값은 조용히 무시). */
    private void applySpeed() {
        if (mp == null || rate == 1.0f) return;
        try {
            mp.setPlaybackParams(mp.getPlaybackParams().setSpeed(rate));
        } catch (Exception e) {
            Log.w(TAG, "배속 적용 실패(1.0x 재생): " + e.getMessage());
            rate = 1.0f;
        }
    }

    private void releasePlayerOnly() {
        prepared = false;
        stopTicker();
        if (mp != null) {
            try { mp.stop(); } catch (Exception ignore) { }
            try { mp.release(); } catch (Exception ignore) { }
            mp = null;
        }
    }

    private void startTicker() {
        ticker.removeCallbacks(tickRun);
        ticker.postDelayed(tickRun, TICK_MS);
    }

    private void stopTicker() {
        ticker.removeCallbacks(tickRun);
    }

    private void ensureChannel() {
        NotificationManager nm = (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        // IMPORTANCE_LOW: 재생 컨트롤 알림 — 소리/진동 없이 조용히 표시
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("발표 시연 나레이션 재생 컨트롤");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private PendingIntent broadcastPI(String action, int reqCode) {
        Intent i = new Intent(appCtx, NarrationControlReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(appCtx, reqCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** "m:ss" 형식 (진행 시각 표기용). */
    private static String fmtTime(long ms) {
        if (ms < 0) ms = 0;
        long totalSec = ms / 1000;
        return (totalSec / 60) + ":" + String.format(java.util.Locale.US, "%02d", totalSec % 60);
    }

    /**
     * 컴팩트 알림 표출/갱신.
     * MediaStyle 미사용 → 시스템 미디어 카드 없이 일반 알림 한 줄 + 액션 버튼만.
     * 진행 상황은 비대화형 진행바(setProgress) + "0:06 / 0:18" 텍스트로 표시.
     */
    private void showNotification() {
        if (appCtx == null) return;
        NotificationManager nm = (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        boolean playing = isPlayingUnsafe();
        long pos = 0, dur = 0;
        if (mp != null && prepared) {
            try { pos = mp.getCurrentPosition(); dur = mp.getDuration(); } catch (Exception ignore) { }
        }

        Notification.Builder b = new Notification.Builder(appCtx, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(fmtTime(pos) + " / " + fmtTime(dur) + " · SEA:GNAL 시연")
                .setVisibility(Notification.VISIBILITY_PUBLIC)   // 잠금화면에서도 컨트롤 노출
                .setOnlyAlertOnce(true)
                .setOngoing(playing)                              // 재생 중 스와이프 삭제 방지
                .setDeleteIntent(broadcastPI(ACTION_STOP, 3));    // (일시정지 중) 스와이프 = 정지
        if (dur > 0) b.setProgress((int) dur, (int) pos, false);

        b.addAction(new Notification.Action.Builder(
                Icon.createWithResource(appCtx, android.R.drawable.ic_media_rew),
                "10초 뒤로", broadcastPI(ACTION_REWIND, 0)).build());
        b.addAction(new Notification.Action.Builder(
                Icon.createWithResource(appCtx,
                        playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play),
                playing ? "일시정지" : "재생", broadcastPI(ACTION_TOGGLE, 1)).build());
        b.addAction(new Notification.Action.Builder(
                Icon.createWithResource(appCtx, android.R.drawable.ic_media_ff),
                "10초 앞으로", broadcastPI(ACTION_FORWARD, 2)).build());

        // 알림 본문 탭 → 앱 열기
        Intent launch = appCtx.getPackageManager().getLaunchIntentForPackage(appCtx.getPackageName());
        if (launch != null) {
            b.setContentIntent(PendingIntent.getActivity(appCtx, 4, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }

        nm.notify(NOTIF_ID, b.build());
    }

    private void requestFocus() {
        AudioManager am = (AudioManager) appCtx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focusReq == null) {
                focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build())
                        .setOnAudioFocusChangeListener(focusListener)
                        .build();
            }
            am.requestAudioFocus(focusReq);
        } else {
            am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    private void abandonFocus() {
        if (appCtx == null) return;
        AudioManager am = (AudioManager) appCtx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focusReq != null) am.abandonAudioFocusRequest(focusReq);
        } else {
            am.abandonAudioFocus(focusListener);
        }
    }
}
