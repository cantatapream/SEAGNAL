package kr.seagnal.kakaorelay;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 임시 「긁어오기」(사용자 확정 2026-11-02 「임시로만」): 이미 받은 옛 특보 알림톡을 분석용으로 모은다.
 * [긁어오기 시작] → 사람이 카톡에서 「해양기상정보포털」 대화방을 연다 → 화면에 채널 이름이 보이면 시작 →
 * 화면의 특보 글을 읽어 보내고 → 위로 한 화면 넘기기 → 반복. 새 글이 4번 연속 없거나 더 넘길 수 없으면 끝.
 * 날짜 줄·시각도 함께 붙인다(분석용).
 * ★1단계(분석, 사용자 확정 2026-11-02 「파일로 저장해서 채팅에 첨부」): 서버로 보내지 않고 휴대폰 「다운로드」 폴더에
 *   kakao_backfill_날짜시각.json 으로 저장한다. 분석을 위해 표식 글만이 아니라 그 채널 대화방 안의 글(15자 이상)을
 *   모두 담고 hasMarker 로 구분한다 — 표식 없는 다른 꼴 메시지가 있는지도 봐야 하므로. 다른 대화방은 읽지 않는다(채널 이름 확인).
 *   서버 주소가 설정돼 있으면 표식 글만 서버 임시 보관함에도 보낸다(2단계 이후용).
 */
final class Backfill {
    private static final long STEP_MS = 1_500L;      // 넘긴 뒤 옛 글이 불려 와 그려질 때까지 기다림
    private static final long ARM_TIMEOUT_MS = 3 * 60_000L;
    private static final int MAX_ROUNDS = 1500;
    private static final int IDLE_STOP = 4;
    private static final Pattern DATE = Pattern.compile("\\d{4}년\\s*\\d{1,2}월\\s*\\d{1,2}일.*");
    private static final Pattern TIME = Pattern.compile("^(오전|오후)\\s?\\d{1,2}:\\d{2}$");

    private enum St { OFF, ARMED, RUNNING }
    private static St st = St.OFF;
    private static long armedAt;
    private static int rounds, idle, total;
    private static final Set<String> seen = new HashSet<>();
    private static final Handler H = new Handler(Looper.getMainLooper());
    private static Context app;
    private static JSONArray all = new JSONArray();   // 이번 회차에 모은 전부(파일로 저장)
    private static long lastMiss;
    private static boolean dumped;   // 회차마다 진단 파일 1번

    private Backfill() {}

    static boolean active() { return st != St.OFF; }
    static int total() { return total; }

    /** [긁어오기 시작] — 대화방이 열리기를 기다린다. */
    static void arm(Context c) {
        app = c.getApplicationContext();
        if (!ReaderService.isOn()) { Config.status(app, "긁어오기: 화면 읽기(접근성)를 먼저 켜세요"); return; }
        st = St.ARMED;
        armedAt = System.currentTimeMillis();
        rounds = 0; idle = 0; total = 0;
        seen.clear();
        all = new JSONArray();
        dumped = false;
        lastMiss = 0;
        Config.status(app, "긁어오기 대기 — 카톡에서 「" + Config.CHANNEL + "」 대화방을 여세요(3분 안)");
    }

    /** [긁어오기 중지] 또는 끝났을 때. */
    static void stop(String why) {
        if (st == St.OFF) return;
        boolean wasRunning = st == St.RUNNING;
        st = St.OFF;
        H.removeCallbacksAndMessages(null);
        String saved = wasRunning && all.length() > 0 ? save() : "저장할 글 없음";
        if (app != null) Config.status(app, "긁어오기 끝 — " + why + " · 모은 글 " + all.length() + "개 · " + saved);
        ReaderService s = ReaderService.get();
        if (s != null) s.resumePending();
    }

    /** ReaderService 가 화면 변화마다 넘겨준다 — 대기 중일 때 대화방이 열렸는지만 본다. */
    static void onEvent(ReaderService s, AccessibilityEvent e) {
        if (st != St.ARMED) return;
        if (System.currentTimeMillis() - armedAt > ARM_TIMEOUT_MS) { stop("3분 안에 대화방이 열리지 않음"); return; }
        if (e.getPackageName() == null || !Config.KAKAO.contentEquals(e.getPackageName())) return;
        AccessibilityNodeInfo root = ReaderService.kakaoRoot(s);
        if (root == null) return;
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        ReaderService.collect(root, nodes);
        if (!ReaderService.hasChannelTitle(nodes)) {
            // 어디서 막혔는지 남긴다(5초에 한 번). 진단 파일은 채널 이름을 못 찾았으므로 글자 없이 구조만 저장한다.
            long now = System.currentTimeMillis();
            if (now - lastMiss > 5_000L) {
                lastMiss = now;
                Config.status(app, "긁어오기 대기 — 카톡 화면은 보이나 채널 이름을 못 찾음(화면 요소 " + nodes.size() + "개)");
                if (!dumped) { dumped = true; Config.status(app, dump(nodes, false)); }
            }
            return;
        }
        if (!dumped) { dumped = true; Config.status(app, dump(nodes, true)); }
        st = St.RUNNING;
        Config.status(app, "긁어오기 시작 — 위로 넘기며 읽는 중(카톡 화면을 만지지 마세요)");
        H.postDelayed(Backfill::step, STEP_MS);
    }

    /** 한 화면을 읽어 보내고 위로 한 화면 넘긴다. */
    private static void step() {
        if (st != St.RUNNING) return;
        ReaderService s = ReaderService.get();
        if (s == null) { stop("화면 읽기 꺼짐"); return; }
        AccessibilityNodeInfo root = ReaderService.kakaoRoot(s);
        if (root == null) { H.postDelayed(Backfill::step, STEP_MS); return; }
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        ReaderService.collect(root, nodes);
        List<AccessibilityNodeInfo> room = ReaderService.roomNodes(nodes);   // 대화창 영역만(태블릿 목록 제외)
        if (room == null) { stop("대화방을 벗어남"); return; }

        JSONArray batch = new JSONArray();
        String date = null;
        JSONObject last = null;
        AccessibilityNodeInfo list = ReaderService.roomScroller(room);
        try {
            for (AccessibilityNodeInfo n : room) {
                String t = ReaderService.textOf(n);
                if (t == null) continue;
                String x = t.trim();
                if (DATE.matcher(x).matches() && x.length() < 30) { date = x; continue; }
                if (TIME.matcher(x).matches()) {
                    if (last != null && !last.has("time")) last.put("time", x);
                    continue;
                }
                if (x.length() < 15) continue;   // 「채널 추가」 같은 짧은 화면 글자는 뺀다
                boolean marker = x.contains(Config.MARKER);
                last = null;
                if (!seen.add(x)) continue;
                last = new JSONObject().put("text", x).put("hasMarker", marker);
                if (date != null) last.put("date", date);
                all.put(last);
                if (marker) batch.put(last);
            }
        } catch (Exception e) {
            stop("읽기 오류 " + e.getMessage());
            return;
        }
        if (batch.length() > 0 || all.length() > total) {
            total = all.length();
            idle = 0;
            if (batch.length() > 0 && !Config.server(app).isEmpty()) Sender.sendBackfill(app, batch);
            Config.status(app, "긁어오기 중 — 모은 글 " + total + "개");
        } else {
            idle++;
        }
        rounds++;
        if (idle >= IDLE_STOP) { stop("더 옛 글 없음(새 글 " + IDLE_STOP + "번 연속 없음)"); return; }
        if (rounds >= MAX_ROUNDS) { stop("최대 " + MAX_ROUNDS + "화면"); return; }
        boolean moved = list != null && list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD);
        if (!moved && batch.length() == 0) { stop("더 넘길 수 없음"); return; }
        H.postDelayed(Backfill::step, STEP_MS);
    }

    /**
     * 모은 글을 「다운로드」 폴더에 JSON 파일로 저장한다. 위에서 아래로 넘겼으므로 화면 순서는 최신→옛날이다.
     * @return 사람에게 보일 결과 한 줄
     */
    /**
     * 진단: 카톡 화면 구조(요소마다 종류·id·글자/설명 유무)를 다운로드 폴더에 저장한다.
     * withText=true(채널 대화방임을 확인한 뒤)일 때만 글자 앞 60자를 담는다 — 다른 대화 목록의 글자가 새지 않게.
     */
    private static String dump(List<AccessibilityNodeInfo> nodes, boolean withText) {
        try {
            JSONArray arr = new JSONArray();
            for (AccessibilityNodeInfo n : nodes) {
                CharSequence tx = n.getText(), ds = n.getContentDescription();
                JSONObject o = new JSONObject()
                        .put("cls", String.valueOf(n.getClassName()))
                        .put("id", String.valueOf(n.getViewIdResourceName()))
                        .put("textLen", tx == null ? 0 : tx.length())
                        .put("descLen", ds == null ? 0 : ds.length())
                        .put("scroll", n.isScrollable());
                if (withText) {
                    if (tx != null) o.put("text", tx.toString().substring(0, Math.min(60, tx.length())));
                    if (ds != null) o.put("desc", ds.toString().substring(0, Math.min(60, ds.length())));
                }
                arr.put(o);
            }
            return "진단 " + write("kakao_screen_" + (withText ? "room_" : "unknown_"),
                    new JSONObject().put("withText", withText).put("nodes", arr));
        } catch (Exception e) {
            return "진단 저장 실패: " + e.getMessage();
        }
    }

    private static String save() {
        try {
            JSONObject doc = new JSONObject()
                    .put("note", "SEAGNAL 특보중계 임시 긁어오기 — 채널 「" + Config.CHANNEL + "」 대화방, 화면 순서 최신→옛날")
                    .put("savedAt", new java.util.Date().toString())
                    .put("count", all.length())
                    .put("messages", all);
            return write("kakao_backfill_", doc);
        } catch (Exception e) {
            return "파일 저장 실패: " + e.getMessage();
        }
    }

    /** 다운로드 폴더에 prefix+날짜시각.json 으로 쓴다. @return 사람에게 보일 결과 한 줄 */
    private static String write(String prefix, JSONObject doc) throws Exception {
        String name = prefix + new java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.KOREA)
                .format(new java.util.Date()) + ".json";
        byte[] bytes = doc.toString(1).getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            android.content.ContentValues cv = new android.content.ContentValues();
            cv.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name);
            cv.put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/json");
            android.net.Uri uri = app.getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) return "파일 저장 실패";
            try (java.io.OutputStream o = app.getContentResolver().openOutputStream(uri)) { o.write(bytes); }
            return "다운로드 폴더에 " + name + " 저장";
        }
        java.io.File f = new java.io.File(app.getExternalFilesDir(null), name);
        try (java.io.FileOutputStream o = new java.io.FileOutputStream(f)) { o.write(bytes); }
        return f.getAbsolutePath() + " 저장";
    }

}
