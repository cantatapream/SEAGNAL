package com.seagnal.app.narration;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.util.Log;

import com.seagnal.app.R;

/**
 * [임시 — 발표 나레이션] 네이티브 오디오 재생 + 상태표시줄 미디어 알림 컨트롤러.
 *
 * ※ 발표 시연용 임시 기능. 발표 종료 후 narration/ 패키지 3개 파일과
 *   MainActivity 의 registerPlugin(NarrationPlayerPlugin.class),
 *   AndroidManifest 의 NarrationControlReceiver 를 함께 제거하면 된다.
 *
 * [왜 네이티브인가]
 *   WebView 의 HTML5 Audio + Media Session API 로는 안드로이드 상태표시줄에
 *   미디어 알림이 표출되지 않는다(웹뷰 미지원). 발표 중 시연 조작을 하면서
 *   상태바를 내려 나레이션을 정지/탐색해야 하므로, 네이티브 MediaPlayer +
 *   MediaSession + MediaStyle 알림으로 시스템 미디어 컨트롤을 제공한다.
 *
 * [구성]
 *   - MediaPlayer : 서버 업로드 음성(URL) 스트리밍 재생
 *   - MediaSession: 시스템 미디어 컨트롤(알림 시크바 드래그 = onSeekTo) 연동
 *   - MediaStyle 알림: ⟲10초 · 재생/일시정지 · ⟳10초 버튼
 *                     (Android 10+ 는 시크바도 자동 표시 — METADATA duration +
 *                      PlaybackState position/ACTION_SEEK_TO 로 동작)
 *   - 알림 스와이프 삭제(일시정지 상태에서만 가능) = 정지
 *
 * [호출 경로]
 *   NarrationPlayerPlugin(웹 JS) → play()/toggle()/seekTo()/stop()
 *   NarrationControlReceiver(알림 버튼) → toggle()/rewind()/forward()/stop()
 *   MediaSession.Callback(알림 시크바/미디어키) → onPlay/onPause/onSeekTo/...
 */
public final class NarrationController {

    private static final String TAG = "NarrationPlayer";
    private static final String CHANNEL_ID = "narration_player";
    private static final String CHANNEL_NAME = "발표 나레이션";
    private static final int NOTIF_ID = 88231;
    private static final int SKIP_MS = 10_000;   // ⟲/⟳ 버튼 이동량 (10초)

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
    private MediaSession session;
    private AudioFocusRequest focusReq;    // API 26+ 오디오 포커스 핸들
    private String title = "발표 나레이션";
    private boolean prepared = false;
    private float rate = 1.0f;             // 관리자 설정 재생 배속 (0.5~2.0)

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
        ensureSession();
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
                    updateMetadata();
                    updateSessionState();
                    showNotification();
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
        if (mp.isPlaying()) pauseInternal();
        else resumeInternal();
    }

    public synchronized void pause() {
        if (mp != null && prepared && mp.isPlaying()) pauseInternal();
    }

    public synchronized void resume() {
        if (mp != null && prepared && !mp.isPlaying()) resumeInternal();
    }

    public synchronized void rewind()  { seekBy(-SKIP_MS); }
    public synchronized void forward() { seekBy(SKIP_MS); }

    /** 절대 위치(ms)로 이동 — 알림 시크바 드래그(onSeekTo)/JS seekTo. */
    public synchronized void seekTo(long posMs) {
        if (mp == null || !prepared) return;
        long dur = mp.getDuration();
        if (posMs < 0) posMs = 0;
        if (dur > 0 && posMs > dur) posMs = dur;
        mp.seekTo((int) posMs);
        updateSessionState();
        showNotification();
    }

    /** 정지 + 알림/세션/플레이어 정리. */
    public synchronized void stop() {
        releasePlayerOnly();
        abandonFocus();
        if (session != null) {
            try { session.setActive(false); session.release(); } catch (Exception ignore) { }
            session = null;
        }
        if (appCtx != null) {
            NotificationManager nm = (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_ID);
        }
    }

    /** JS getState() 용 현재 상태. */
    public synchronized boolean isPlaying() {
        return mp != null && prepared && mp.isPlaying();
    }

    // ────────────────────────────────────────────────────────────────────
    // 내부 구현
    // ────────────────────────────────────────────────────────────────────

    private void pauseInternal() {
        mp.pause();
        updateSessionState();
        showNotification();
    }

    private void resumeInternal() {
        requestFocus();
        mp.start();
        updateSessionState();
        showNotification();
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
        if (mp != null) {
            try { mp.stop(); } catch (Exception ignore) { }
            try { mp.release(); } catch (Exception ignore) { }
            mp = null;
        }
    }

    private void ensureSession() {
        if (session != null) return;
        session = new MediaSession(appCtx, "seagnal_narration");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay()  { resume(); }
            @Override public void onPause() { pause(); }
            @Override public void onSeekTo(long pos) { seekTo(pos); }
            @Override public void onRewind() { rewind(); }
            @Override public void onFastForward() { forward(); }
            @Override public void onStop()  { stop(); }
        });
        session.setActive(true);
    }

    private void ensureChannel() {
        NotificationManager nm = (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        // IMPORTANCE_LOW: 미디어 컨트롤 알림 — 소리/진동 없이 조용히 표시
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("발표 시연 나레이션 재생 컨트롤");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    private void updateMetadata() {
        if (session == null || mp == null) return;
        long dur = 0;
        try { dur = mp.getDuration(); } catch (Exception ignore) { }
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "SEA:GNAL 시연")
                .putLong(MediaMetadata.METADATA_KEY_DURATION, dur)
                .build());
    }

    /** PlaybackState 갱신 — 알림 시크바(Android 10+)가 이 position/speed 로 진행된다. */
    private void updateSessionState() {
        if (session == null) return;
        long pos = 0;
        boolean playing = false;
        if (mp != null && prepared) {
            try { pos = mp.getCurrentPosition(); playing = mp.isPlaying(); } catch (Exception ignore) { }
        }
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SEEK_TO
                | PlaybackState.ACTION_REWIND | PlaybackState.ACTION_FAST_FORWARD
                | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        pos, playing ? rate : 0f)   // 배속 반영 — 알림 시크바 진행 속도 일치
                .build());
    }

    private PendingIntent broadcastPI(String action, int reqCode) {
        Intent i = new Intent(appCtx, NarrationControlReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(appCtx, reqCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void showNotification() {
        if (appCtx == null || session == null) return;
        NotificationManager nm = (NotificationManager) appCtx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        boolean playing = isPlaying();

        Notification.Builder b = new Notification.Builder(appCtx, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setLargeIcon(BitmapFactory.decodeResource(appCtx.getResources(), R.mipmap.ic_launcher))
                .setContentTitle(title)
                .setContentText("SEA:GNAL 시연 나레이션")
                .setVisibility(Notification.VISIBILITY_PUBLIC)   // 잠금화면에서도 컨트롤 노출
                .setOnlyAlertOnce(true)
                .setOngoing(playing)                              // 재생 중 스와이프 삭제 방지
                .setDeleteIntent(broadcastPI(ACTION_STOP, 3))     // (일시정지 중) 스와이프 = 정지
                .setStyle(new Notification.MediaStyle()
                        .setMediaSession(session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2));

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
