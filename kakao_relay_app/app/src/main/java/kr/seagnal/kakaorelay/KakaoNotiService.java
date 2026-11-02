package kr.seagnal.kakaorelay;

import android.app.Notification;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import java.util.Collections;

/**
 * ① 카톡 알림을 지켜본다. 「해양기상정보포털」 알림이 뜨면
 *   (가) 알림에 담긴 글을 바로 서버로 보내고(빠른 길, 잘려 있을 수 있음)
 *   (나) 그 알림을 눌러 대화방을 열도록 ReaderService 에 맡긴다(전문을 읽는 길).
 * 또 30분마다 서버에 "살아 있음" 신호를 보낸다.
 */
public class KakaoNotiService extends NotificationListenerService {
    private static final long BEAT_MS = 30 * 60 * 1000L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable beat = new Runnable() {
        @Override public void run() {
            Sender.heartbeat(KakaoNotiService.this, ReaderService.isOn() ? "ok" : "접근성 꺼짐");
            handler.postDelayed(this, BEAT_MS);
        }
    };

    @Override public void onListenerConnected() {
        Config.status(this, "알림 감시 시작");
        handler.removeCallbacks(beat);
        handler.post(beat);
    }

    @Override public void onListenerDisconnected() {
        handler.removeCallbacks(beat);
        Config.status(this, "알림 감시 끊김");
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (!Config.KAKAO.equals(sbn.getPackageName())) return;
        Notification n = sbn.getNotification();
        Bundle x = n.extras;
        String title = String.valueOf(x.getCharSequence(Notification.EXTRA_TITLE));
        CharSequence big = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
        String text = String.valueOf(big != null ? big : x.getCharSequence(Notification.EXTRA_TEXT));
        boolean ours = title.contains(Config.CHANNEL) || text.contains(Config.MARKER);
        if (!ours) return;  // 다른 대화방 알림은 아무것도 하지 않는다

        Config.status(this, "특보 알림 감지 (" + text.length() + "자)");
        if (text.contains(Config.MARKER)) {
            Sender.sendMessages(this, Collections.singletonList(text), "notification");
        }
        ReaderService.openAndRead(this, n.contentIntent);
    }
}
