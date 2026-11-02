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
 * 특보 표식([해양기상기후정보 알림])이 든 글만 보낸다. 날짜 줄·시각도 함께 붙인다(분석용).
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
        Config.status(app, "긁어오기 대기 — 카톡에서 「" + Config.CHANNEL + "」 대화방을 여세요(3분 안)");
    }

    /** [긁어오기 중지] 또는 끝났을 때. */
    static void stop(String why) {
        if (st == St.OFF) return;
        st = St.OFF;
        H.removeCallbacksAndMessages(null);
        if (app != null) Config.status(app, "긁어오기 끝 — " + why + " · 모은 글 " + total + "개");
        ReaderService s = ReaderService.get();
        if (s != null) s.resumePending();
    }

    /** ReaderService 가 화면 변화마다 넘겨준다 — 대기 중일 때 대화방이 열렸는지만 본다. */
    static void onEvent(ReaderService s, AccessibilityEvent e) {
        if (st != St.ARMED) return;
        if (System.currentTimeMillis() - armedAt > ARM_TIMEOUT_MS) { stop("3분 안에 대화방이 열리지 않음"); return; }
        if (e.getPackageName() == null || !Config.KAKAO.contentEquals(e.getPackageName())) return;
        AccessibilityNodeInfo root = s.getRootInActiveWindow();
        if (root == null) return;
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        ReaderService.collect(root, nodes);
        if (!ReaderService.hasChannelTitle(nodes)) return;
        st = St.RUNNING;
        Config.status(app, "긁어오기 시작 — 위로 넘기며 읽는 중(카톡 화면을 만지지 마세요)");
        H.postDelayed(Backfill::step, STEP_MS);
    }

    /** 한 화면을 읽어 보내고 위로 한 화면 넘긴다. */
    private static void step() {
        if (st != St.RUNNING) return;
        ReaderService s = ReaderService.get();
        if (s == null) { stop("화면 읽기 꺼짐"); return; }
        AccessibilityNodeInfo root = s.getRootInActiveWindow();
        if (root == null) { H.postDelayed(Backfill::step, STEP_MS); return; }
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        ReaderService.collect(root, nodes);
        if (!ReaderService.hasChannelTitle(nodes)) { stop("대화방을 벗어남"); return; }

        JSONArray batch = new JSONArray();
        String date = null;
        JSONObject last = null;
        AccessibilityNodeInfo list = null;
        try {
            for (AccessibilityNodeInfo n : nodes) {
                if (list == null && n.isScrollable()) list = n;
                CharSequence t = n.getText();
                if (t == null) continue;
                String x = t.toString().trim();
                if (DATE.matcher(x).matches() && x.length() < 30) { date = x; continue; }
                if (TIME.matcher(x).matches()) {
                    if (last != null && !last.has("time")) last.put("time", x);
                    continue;
                }
                if (!x.contains(Config.MARKER)) continue;
                last = null;
                if (!seen.add(x)) continue;
                last = new JSONObject().put("text", x);
                if (date != null) last.put("date", date);
                batch.put(last);
            }
        } catch (Exception e) {
            stop("읽기 오류 " + e.getMessage());
            return;
        }
        if (batch.length() > 0) {
            total += batch.length();
            idle = 0;
            Sender.sendBackfill(app, batch);
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
}
