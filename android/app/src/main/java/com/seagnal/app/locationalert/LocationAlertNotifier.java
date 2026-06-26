package com.seagnal.app.locationalert;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.text.TextUtils;

import androidx.core.app.NotificationCompat;

import com.seagnal.app.MainActivity;
import com.seagnal.app.R;

/**
 * LocationAlertNotifier — killed 상태에서 네이티브가 직접 띄우는 로컬 알림.
 *
 * JS 경로(LocalNotifications)와 동일한 표현을 목표:
 *   - BigTextStyle(본문 전체) — 펼치면 여러 줄 본문이 잘리지 않음
 *   - 제목/본문은 LocationAlertCore.buildMessage 결과 그대로
 *   - 앱 마크 아이콘(ic_launcher_foreground) — 전용 알림 아이콘이 없어 앱 전경 드로어블 사용
 *
 * 채널은 음성비서/푸시와 분리(중요도 HIGH) — 종료 상태에서도 즉시 헤드업 노출.
 */
public final class LocationAlertNotifier {

    private static final String CHANNEL_ID = "location_alert_safety";
    private static final String CHANNEL_NAME = "해상특보 안전 경보";

    private LocationAlertNotifier() { }

    private static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm == null) return;
            if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("위치 기반 해상특보 안전 경보(앱 종료 시에도 동작)");
            channel.enableVibration(true);
            nm.createNotificationChannel(channel);
        }
    }

    private static int pendingFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return flags;
    }

    /** 경보 알림 표출. id 는 매번 달리하여 누적 표시(겹쳐 덮어쓰지 않음). 딥링크 없음(기본 앱 열기). */
    public static void notify(Context ctx, String title, String body) {
        int id = (int) (System.currentTimeMillis() % 2147483647L);
        notify(ctx, title, body, id, null);
    }

    /**
     * 경보 알림 표출(태풍 반경: 태풍별 고유 id + 딥링크). 기존 2-인자 notify 와 표현 동일.
     *   @param id  태풍별 고유 알림 id(TyphoonRadiusDecider.notifId(seq)) — 같은 태풍은 덮어쓰기.
     *   @param url 탭 시 이동할 딥링크(상대경로, 예 "/?assistant=ocean&...&dtGuide=1"). null/빈문자면 기본 앱 열기.
     *
     * [딥링크 처리] 앱이 원격(server.url=fly.dev) 모드라, 상대경로 url 을 절대 URL 로 만들어
     *   MainActivity 인텐트의 data(Uri) + extra 로 싣고 SINGLE_TOP/NEW_TASK 로 연다. WebView 가
     *   해당 통보문/행동요령 화면을 표출하도록 함(JS localNotificationActionPerformed 와 동일 의도).
     *   data Uri 는 알림별로 달라야 PendingIntent 가 합쳐지지 않으므로 requestCode 에 id 를 쓴다.
     */
    public static void notify(Context ctx, String title, String body, int id, String url) {
        ensureChannel(ctx);

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        if (!TextUtils.isEmpty(url)) {
            try {
                // 상대경로면 server.url 베이스로 절대화(앱이 fly.dev 원격 로드 모드).
                String abs = url.startsWith("http") ? url : (SERVER_BASE_URL + url);
                openIntent.setData(Uri.parse(abs));
                // Capacitor/웹 라우팅 폴백용 extra(push 경로의 data.url 관례와 동일 키 'url').
                openIntent.putExtra("url", abs);
                openIntent.putExtra("notificationUrl", abs);
            } catch (Throwable ignored) { /* 잘못된 url 은 기본 앱 열기로 폴백 */ }
        }
        // requestCode 를 id 로 → 알림마다 별개 PendingIntent(딥링크 섞임 방지).
        PendingIntent openPi = PendingIntent.getActivity(ctx, id, openIntent, pendingFlags());

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                // 기존 특보 푸시와 동일하게 앱 아이콘(사각) 사용. ic_launcher_foreground 는 기본
                // 안드로이드 로봇 전경이라 상태바에 로봇이 떴음 → 앱 아이콘 ic_launcher 로 교체.
                .setSmallIcon(R.mipmap.ic_launcher)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(openPi);

        try {
            b.setLargeIcon(BitmapFactory.decodeResource(ctx.getResources(), R.mipmap.ic_launcher));
        } catch (Exception ignored) { /* 라지 아이콘 실패는 비치명적 */ }

        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.notify(id, b.build());
    }

    // 딥링크 절대화용 베이스(capacitor.config.json server.url 과 동일). URL 변경 시 함께 갱신.
    private static final String SERVER_BASE_URL = "https://seagnal-server.fly.dev";
}
