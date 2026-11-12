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

    // 최근 10분 안에 뜬 특보 알림 글 — 대화방에서 읽은 말풍선 중 어느 것이 「이번 알림」인지 가리는 데 쓴다.
    private static final java.util.ArrayDeque<Object[]> RECENT = new java.util.ArrayDeque<>();
    private static final long RECENT_MS = 10 * 60 * 1000L;

    private static String norm(String s) { return s == null ? "" : s.replaceAll("\\s+", " ").trim(); }

    static synchronized void rememberNotification(String text) {
        long now = System.currentTimeMillis();
        while (!RECENT.isEmpty() && now - (Long) RECENT.peekFirst()[1] > RECENT_MS) RECENT.pollFirst();
        RECENT.addLast(new Object[]{norm(text), now});
    }

    /**
     * 이 말풍선이 최근 뜬 알림의 글인가. 알림 글은 200자에서 잘려 오므로(2026-11-03 실측) 앞부분이 같으면 같은 글로 본다.
     * 예: 알림 「…제주도남서쪽안쪽먼바다,\n풍랑주의보 11월 0」 ↔ 말풍선 「…11월 03일 03시 00분 해제」 → true
     */
    static synchronized boolean isRecentNotification(String bubble) {
        String b = norm(bubble);
        long now = System.currentTimeMillis();
        for (Object[] r : RECENT) {
            if (now - (Long) r[1] > RECENT_MS) continue;
            String n = (String) r[0];
            String prefix = n.length() >= 190 ? n.substring(0, n.length() - 3) : n;
            if (!prefix.isEmpty() && b.startsWith(prefix)) return true;
        }
        return false;
    }

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
        if (!Config.auto(this)) return;   // 자동 중계를 끈 기기(본 휴대폰 등)는 아무것도 하지 않는다
        Notification n = sbn.getNotification();
        Bundle x = n.extras;
        String title = String.valueOf(x.getCharSequence(Notification.EXTRA_TITLE));
        CharSequence big = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
        String text = String.valueOf(big != null ? big : x.getCharSequence(Notification.EXTRA_TEXT));
        // 보낸 쪽(알림 제목)이 그 채널일 때만 — 본문에 표식만 흉내 낸 다른 대화는 무시한다(가짜 특보 방지).
        if (!title.contains(Config.CHANNEL)) return;

        Config.status(this, "특보 알림 감지 (" + text.length() + "자)");
        // 진단(0.3): 이 채널 알림을 받을 때마다 길이·표식 여부·앞부분을 서버 기록장에 남긴다 —
        //   표식 없는 알림(11/09 04:31)·안 온 알림을 화면 캡처 없이 가려내려고.
        try {
            Sender.sendDiag(this, new org.json.JSONObject().put("kind", "noti").put("len", text.length())
                    .put("marker", text.contains(Config.MARKER)).put("big", big != null)
                    .put("head", text.substring(0, Math.min(80, text.length()))));
        } catch (org.json.JSONException ignored) { /* 기록만 */ }
        if (text.contains(Config.MARKER)) {
            rememberNotification(text);
            Sender.sendMessages(this, Collections.singletonList(text), "notification");
        }
        if (Config.notiOnly(this)) return;   // 휴대폰용 — 화면·카톡을 건드리지 않고 알림 글만 보낸다
        ReaderService.openAndRead(this, n.contentIntent);
    }
}
