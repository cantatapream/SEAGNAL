package com.seagnal.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.util.Log;

/**
 * SEAGNAL Application — 앱 프로세스가 뜰 때(화면을 열 때뿐 아니라 푸시를 받아 깨어날 때도) 가장 먼저 실행된다.
 *
 * [역할] 일반 푸시용 알림 채널 "seagnal_push_high"(중요도 높음)를 만든다.
 *
 * [왜 필요한가 — 헤드업 알림(화면 위에 잠깐 뜨는 알림)]
 *   서버는 일반 푸시(특보·공지·관리자 푸시)를 채널 지정 없이 보낸다. 그러면 Firebase 가 스스로 만드는
 *   "fcm_fallback_notification_channel"(중요도 보통)로 표시돼 상태표시줄 아이콘만 뜬다.
 *   안드로이드 8+ 는 채널 중요도가 "높음"이어야 헤드업으로 띄운다.
 *   AndroidManifest 의 meta-data(com.google.firebase.messaging.default_notification_channel_id)가
 *   이 채널을 "채널 지정이 없는 푸시의 기본 채널"로 지정한다 → 서버를 고치지 않아도 헤드업이 된다.
 *   Firebase 는 그 채널이 "이미 만들어져 있을 때만" 쓰고, 없으면 종전 채널로 돌아간다
 *   (firebase-messaging CommonNotificationBuilder.getOrCreateChannel). 그래서 푸시를 받아 프로세스가
 *   막 떴을 때도 채널이 있도록, Activity 가 아니라 Application 에서 만든다.
 *
 * [안전] 채널 만들기에 실패해도 앱은 그대로 뜬다(try/catch) — 그 경우 푸시는 종전처럼 표시될 뿐이다.
 *   이미 있는 채널에 다시 createNotificationChannel 을 불러도 사용자가 바꾼 설정(끔·조용히 등)은 유지된다.
 *
 * [연계]
 *   - AndroidManifest.xml: <application android:name=".SeagnalApplication"> + 위 meta-data
 *   - 위치기반 특보 알림은 별도 채널(LocationAlertNotifier "location_alert_safety")을 그대로 쓴다.
 */
public class SeagnalApplication extends Application {

    private static final String TAG = "SeagnalApplication";

    /** 일반 푸시 기본 채널 id — AndroidManifest 의 default_notification_channel_id 값과 같아야 한다. */
    public static final String PUSH_CHANNEL_ID = "seagnal_push_high";
    private static final String PUSH_CHANNEL_NAME = "SEA:GNAL 알림";

    @Override
    public void onCreate() {
        super.onCreate();
        ensurePushChannel();
    }

    /** 일반 푸시 채널(중요도 높음)을 만든다. 안드로이드 8(API 26) 미만은 채널 개념이 없어 건너뛴다. */
    private void ensurePushChannel() {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm == null) return;
            NotificationChannel channel = new NotificationChannel(
                    PUSH_CHANNEL_ID, PUSH_CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("해상특보·공지 등 일반 알림(화면 위에 잠깐 표시)");
            channel.enableVibration(true);
            nm.createNotificationChannel(channel);
        } catch (Throwable t) {
            Log.w(TAG, "푸시 알림 채널 만들기 실패 — 푸시는 종전 채널로 표시된다", t);
        }
    }
}
