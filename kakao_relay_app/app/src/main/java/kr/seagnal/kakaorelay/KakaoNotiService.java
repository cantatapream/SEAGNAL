package kr.seagnal.kakaorelay;

import android.app.Notification;
import android.os.Bundle;
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
    /** 신호 간격. 서버 멈춤 판정(70분)과 데이터 수집현황 목록표 kakaoRelay 가 이 값을 근거로 쓴다. */
    static final long BEAT_MS = 30 * 60 * 1000L;
    private static volatile boolean connected;

    static boolean isConnected() { return connected; }

    @Override public void onListenerConnected() {
        connected = true;
        Config.status(this, "알림 감시 시작");
        BeatReceiver.schedule(this);   // 30분 신호는 알람으로(깊은 잠에서도 깨어남) — 서비스 안 타이머는 잠들면 멈춘다
        BeatReceiver.beatNow(this);
    }

    @Override public void onListenerDisconnected() {
        connected = false;
        Config.status(this, "알림 감시 끊김 — 다시 연결 요청");
        requestRebind(new android.content.ComponentName(this, KakaoNotiService.class));
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (!Config.KAKAO.equals(sbn.getPackageName())) return;
        Notification n = sbn.getNotification();
        Bundle x = n.extras;
        String title = String.valueOf(x.getCharSequence(Notification.EXTRA_TITLE));
        CharSequence big = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
        String text = String.valueOf(big != null ? big : x.getCharSequence(Notification.EXTRA_TEXT));
        // 보낸 쪽(알림 제목)이 그 채널일 때만 — 본문에 표식만 흉내 낸 다른 대화는 무시한다(가짜 특보 방지).
        if (!title.contains(Config.CHANNEL)) return;

        Config.status(this, "특보 알림 감지 (" + text.length() + "자)");
        if (text.contains(Config.MARKER)) {
            Sender.sendMessages(this, Collections.singletonList(text), "notification");
        }
        ReaderService.openAndRead(this, n.contentIntent);
    }
}
