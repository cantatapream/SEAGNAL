package kr.seagnal.kakaorelay;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

/**
 * 30분마다 서버로 "살아 있음" 신호를 보내는 알람.
 * 서비스 안 타이머(Handler)는 기기가 깊이 잠들면 멈추므로, 절전 중에도 깨워 주는 AlarmManager 를 쓴다
 * (setAndAllowWhileIdle — 정확한 시각은 아니어서 몇 분 늦을 수 있다. 서버는 70분을 넘겨야 끊김으로 본다).
 * 기기를 다시 켜면(BOOT_COMPLETED) 알람을 다시 건다.
 */
public class BeatReceiver extends BroadcastReceiver {
    private static final String ACTION = "kr.seagnal.kakaorelay.BEAT";

    @Override public void onReceive(Context c, Intent i) {
        schedule(c);   // 다음 회차를 먼저 건다(이번 전송이 실패해도 알람은 이어지게)
        beatNow(c);
    }

    /** 지금 상태를 담아 신호를 보낸다. note 꼴은 서버 kakao_relay.judgeHealth 가 읽는다. */
    static void beatNow(Context c) {
        // 자동 중계를 끈 기기는 신호를 보내지 않는다 — 보내면 서버 멈춤 감시가 이 기기 상태를 태블릿 상태로 오인한다.
        if (!Config.auto(c)) { Config.status(c, "자동 중계 꺼짐 — 신호 안 보냄"); return; }
        // 알림 글만 보내는 기기는 화면 읽기를 쓰지 않으므로 접근성 상태를 이상으로 보내지 않는다.
        String note = (Config.notiOnly(c) ? "ok(알림 글만)" : ReaderService.isOn() ? "ok" : "접근성 꺼짐")
                + (KakaoNotiService.isConnected() ? "" : " · 알림 감시 끊김")
                + " | 마지막 읽기: " + Config.prefs(c).getString("lastRead", "없음");
        Sender.heartbeat(c, note);
    }

    static void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = PendingIntent.getBroadcast(c, 0,
                new Intent(c, BeatReceiver.class).setAction(ACTION),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + KakaoNotiService.BEAT_MS, pi);
    }
}
