package kr.seagnal.kakaorelay;

import android.content.Context;
import android.os.BatteryManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 서버로 글과 "살아 있음" 신호를 보낸다. 인터넷이 끊겨 실패한 글은 태블릿에 쌓아 두었다가 다음에 다시 보낸다.
 * 서버 쪽 받는 곳: local_server/routes/kakao_relay.js
 */
final class Sender {
    private static final ExecutorService POOL = Executors.newSingleThreadExecutor();
    private static final int MAX_QUEUE = 100;
    private static final int BATCH = 50;
    private static final int MAX_BACKFILL_QUEUE = 2000;

    private Sender() {}

    /** 글 목록을 대기열에 넣고 보낸다. source = "screen"(대화방에서 읽음) | "notification"(알림에서 읽음) */
    static void sendMessages(Context ctx, List<String> texts, String source) {
        final Context c = ctx.getApplicationContext();
        POOL.execute(() -> {
            try {
                JSONArray q = new JSONArray(Config.prefs(c).getString("queue", "[]"));
                for (String t : texts) q.put(new JSONObject().put("text", t).put("source", source));
                while (q.length() > MAX_QUEUE) q.remove(0);
                Config.prefs(c).edit().putString("queue", q.toString()).commit();
                flush(c);
            } catch (Exception e) {
                Config.status(c, "대기열 오류: " + e.getMessage());
            }
        });
    }

    /** 살아 있음 신호를 보내고, 쌓인 글이 있으면 같이 다시 보낸다. */
    static void heartbeat(Context ctx, String note) {
        final Context c = ctx.getApplicationContext();
        // 알람으로 깨어난 짧은 순간에 전송이 끝나기 전에 기기가 다시 잠들지 않게 잡아 둔다(최대 60초).
        android.os.PowerManager pm = (android.os.PowerManager) c.getSystemService(Context.POWER_SERVICE);
        final android.os.PowerManager.WakeLock wl = pm == null ? null
                : pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "relay:beat");
        if (wl != null) wl.acquire(60_000L);
        POOL.execute(() -> {
            try {
                BatteryManager bm = (BatteryManager) c.getSystemService(Context.BATTERY_SERVICE);
                JSONObject b = new JSONObject().put("device", Config.device(c)).put("note", note)
                        .put("battery", bm == null ? -1 : bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY));
                int code = post(c, "/api/kakao-relay/heartbeat", b);
                if (code != 200) Config.status(c, "신호 실패 HTTP " + code);
                flush(c);
            } catch (Exception e) {
                Config.status(c, "신호 실패: " + e.getMessage());
            } finally {
                if (wl != null && wl.isHeld()) wl.release();
            }
        });
    }

    /** 대기열을 서버로 보낸다. 성공하면 비운다(POOL 스레드에서만 부른다). */
    private static void flush(Context c) throws Exception {
        flush(c, "queue", "/api/kakao-relay/messages");
    }

    /**
     * 임시 「긁어오기」: 대화방에서 읽은 옛 특보 글을 분석용 보관함으로 보낸다(실시간 기록과 따로).
     * items 각각 {text, date?, time?}
     */
    static void sendBackfill(Context ctx, JSONArray items) {
        final Context c = ctx.getApplicationContext();
        POOL.execute(() -> {
            try {
                JSONArray q = new JSONArray(Config.prefs(c).getString("bqueue", "[]"));
                for (int i = 0; i < items.length(); i++) q.put(items.get(i));
                while (q.length() > MAX_BACKFILL_QUEUE) q.remove(0);
                Config.prefs(c).edit().putString("bqueue", q.toString()).commit();
                flush(c, "bqueue", "/api/kakao-relay/backfill");
            } catch (Exception e) {
                Config.status(c, "긁어오기 전송 오류: " + e.getMessage());
            }
        });
    }

    private static void flush(Context c, String key, String path) throws Exception {
        // 서버는 한 번에 50건까지 받는다 — 50건씩 나눠 보내고, 보낸 묶음만 대기열에서 지운다.
        while (true) {
            JSONArray q = new JSONArray(Config.prefs(c).getString(key, "[]"));
            if (q.length() == 0) return;
            JSONArray chunk = new JSONArray();
            for (int i = 0; i < Math.min(BATCH, q.length()); i++) chunk.put(q.get(i));
            JSONObject b = new JSONObject().put("device", Config.device(c)).put("messages", chunk);
            int code = post(c, path, b);
            if (code != 200) {
                Config.status(c, "전송 실패 HTTP " + code + " — " + q.length() + "건 대기");
                return;
            }
            JSONArray rest = new JSONArray();
            for (int i = chunk.length(); i < q.length(); i++) rest.put(q.get(i));
            Config.prefs(c).edit().putString(key, rest.toString()).commit();
            Config.status(c, "전송 성공 " + chunk.length() + "건");
        }
    }

    private static int post(Context c, String path, JSONObject body) throws Exception {
        String base = Config.server(c).replaceAll("/+$", "");
        if (base.isEmpty()) throw new IllegalStateException("서버 주소 미설정");
        HttpURLConnection h = (HttpURLConnection) new URL(base + path).openConnection();
        try {
            h.setConnectTimeout(15000);
            h.setReadTimeout(15000);
            h.setRequestMethod("POST");
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            h.setRequestProperty("X-Relay-Token", Config.token(c));
            try (OutputStream o = h.getOutputStream()) { o.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            return h.getResponseCode();
        } finally {
            h.disconnect();
        }
    }
}
