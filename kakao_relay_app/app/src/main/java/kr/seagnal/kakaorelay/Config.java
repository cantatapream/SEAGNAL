package kr.seagnal.kakaorelay;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * 설정값(서버 주소·비밀 열쇠·기기 이름)과 작은 상태값을 태블릿에 저장한다.
 * 예: Config.server(ctx) → "https://seagnal.fly.dev"
 */
final class Config {
    /** 알림톡을 보내는 채널 이름 — 이 대화방만 연다. */
    static final String CHANNEL = "해양기상정보포털";
    /** 특보 알림톡 본문에 반드시 들어 있는 표식 — 이 글자가 든 글만 서버로 보낸다. */
    static final String MARKER = "[해양기상기후정보 알림]";
    static final String KAKAO = "com.kakao.talk";

    private Config() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("relay", Context.MODE_PRIVATE);
    }
    static String server(Context c) { return prefs(c).getString("server", ""); }
    static String token(Context c) { return prefs(c).getString("token", ""); }
    static String device(Context c) { return prefs(c).getString("device", "tablet"); }

    /** 화면에 보여 줄 최근 상태 한 줄을 남긴다. */
    static void status(Context c, String s) {
        String line = new java.text.SimpleDateFormat("MM-dd HH:mm:ss", java.util.Locale.KOREA)
                .format(new java.util.Date()) + "  " + s;
        String old = prefs(c).getString("log", "");
        String all = line + "\n" + old;
        if (all.length() > 4000) all = all.substring(0, 4000);
        prefs(c).edit().putString("log", all).apply();
    }
}
