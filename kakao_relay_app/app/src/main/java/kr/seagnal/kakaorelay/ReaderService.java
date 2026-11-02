package kr.seagnal.kakaorelay;

import android.accessibilityservice.AccessibilityService;
import android.app.ActivityOptions;
import android.app.PendingIntent;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayList;
import java.util.List;

/**
 * ② 카톡 대화방 화면의 글자를 읽는다(안드로이드 접근성 기능 — 화면 읽기 앱이 쓰는 것과 같은 기능).
 * 순서: 화면 켜기 → 알림을 눌러 대화방 열기 → 화면이 그려지면 글자 읽기 →
 *       긴 글에 「전체보기」가 있으면 눌러 전문 읽기 → 서버로 보내기 → 홈 화면으로.
 * ★특보 표식([해양기상기후정보 알림])이 든 글만 보낸다 — 다른 대화 내용은 서버로 가지 않는다.
 */
public class ReaderService extends AccessibilityService {
    private static final long TIMEOUT_MS = 45_000L;
    private static final long SETTLE_MS = 1_200L;   // 화면이 다 그려질 때까지 기다리는 시간
    private static final int KEEP_LAST = 5;         // 화면에 보이는 특보 글 중 최근 몇 개를 보낼지

    private static ReaderService instance;
    private enum State { IDLE, WAIT_CHAT, WAIT_FULL }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private State state = State.IDLE;
    private final List<String> found = new ArrayList<>();
    private PowerManager.WakeLock wake;
    private PendingIntent again;   // 읽는 도중 새 특보가 오면 끝난 뒤 한 번 더 읽는다

    private final Runnable readNow = this::readScreen;
    private final Runnable timeout = () -> finish("시간 초과");

    static boolean isOn() { return instance != null; }
    static ReaderService get() { return instance; }

    /** KakaoNotiService 가 부른다: 알림의 contentIntent 로 대화방을 열고 읽기 시작. */
    static void openAndRead(Context c, PendingIntent pi) {
        ReaderService s = instance;
        if (s == null) { Config.status(c, "접근성 꺼짐 — 대화방을 못 읽음(알림 글만 보냄)"); return; }
        s.handler.post(() -> s.start(pi));
    }

    @Override protected void onServiceConnected() {
        instance = this;
        Config.status(this, "화면 읽기 준비됨");
    }

    @Override public boolean onUnbind(android.content.Intent i) {
        instance = null;
        return super.onUnbind(i);
    }

    @Override public void onInterrupt() {}

    private void start(PendingIntent pi) {
        if (state != State.IDLE || Backfill.active()) { again = pi; return; }   // 읽는 중이면 끝난 뒤 다시 읽는다
        if (pi == null) { Config.status(this, "알림에 열기 동작이 없음"); return; }
        found.clear();
        fullOk = false;
        state = State.WAIT_CHAT;
        wakeScreen();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                ActivityOptions o = ActivityOptions.makeBasic();
                o.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                pi.send(this, 0, null, null, null, null, o.toBundle());
            } else {
                pi.send();
            }
        } catch (Exception e) {
            finish("대화방 열기 실패: " + e.getMessage());
            return;
        }
        handler.postDelayed(timeout, TIMEOUT_MS);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (Backfill.active()) { Backfill.onEvent(this, e); return; }   // 임시 긁어오기 중에는 그쪽이 화면을 다룬다
        if (state == State.IDLE || e.getPackageName() == null) return;
        if (!Config.KAKAO.contentEquals(e.getPackageName())) return;
        handler.removeCallbacks(readNow);
        handler.postDelayed(readNow, SETTLE_MS);   // 변화가 멈춘 뒤 한 번만 읽는다
    }

    private void readScreen() {
        AccessibilityNodeInfo root = kakaoRoot(this);
        if (root == null) return;
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        collect(root, nodes);

        // 대화방 화면에서는 그 대화창 영역 안만 읽는다(태블릿은 왼쪽 목록·오른쪽 대화창 — 목록 미리보기가 섞이지 않게).
        //   「전체보기」 화면은 제목이 다를 수 있어 카톡 창 전체에서 읽되, 특보 글 중 가장 긴 것을 전문으로 본다.
        List<AccessibilityNodeInfo> scope = nodes;
        if (state == State.WAIT_CHAT) {
            scope = roomNodes(nodes);
            if (scope == null) return;   // 그 채널 대화방이 아니다(목록·다른 방) — 다음 화면 변화 때 다시 본다
        }
        List<String> texts = new ArrayList<>();
        AccessibilityNodeInfo more = null;
        for (AccessibilityNodeInfo n : scope) {
            String s = textOf(n);
            if (s == null) continue;
            if (s.contains(Config.MARKER)) texts.add(s);
            else if (s.trim().equals("전체보기")) more = n;   // 카톡은 아주 긴 글을 접어 둔다(실제 확인 2026-11-02 태블릿 화면)
        }
        if (texts.isEmpty()) return;   // 아직 그려지는 중 — 다음 화면 변화 때 다시 읽는다

        if (state == State.WAIT_CHAT) {
            int from = Math.max(0, texts.size() - KEEP_LAST);
            found.addAll(texts.subList(from, texts.size()));
            if (more != null && click(more)) {
                state = State.WAIT_FULL;
                Config.status(this, "전체보기 누름");
                return;
            }
            finish(null);
        } else if (state == State.WAIT_FULL) {
            String longest = texts.get(0);
            for (String t : texts) if (t.length() > longest.length()) longest = t;
            found.add(longest);
            fullOk = true;
            finish(null);
        }
    }

    static boolean hasChannelTitle(List<AccessibilityNodeInfo> nodes) {
        return roomNodes(nodes) != null;
    }

    /**
     * 그 채널 대화창 영역 안의 노드들. 대화창이 아니면 null.
     * 제목 = 채널 이름이 든 짧은 글자 중 **넘겨지는 목록 안에 있지 않은 것**(대화방 머리의 고정 제목).
     *   목록 안의 같은 이름(태블릿 왼쪽 채팅 목록 항목, 말풍선 위 보낸 이 이름)은 제목이 아니다.
     * 영역 = 제목 아래, 제목 왼쪽 끝에서 제목 높이 2배만큼 왼쪽부터 화면 오른쪽 끝까지
     *   (태블릿 2026-11-02 화면: 왼쪽 목록 오른쪽 끝 < 대화창 제목 왼쪽 − 2×높이 / 휴대폰은 거의 화면 전체).
     */
    static List<AccessibilityNodeInfo> roomNodes(List<AccessibilityNodeInfo> nodes) {
        AccessibilityNodeInfo title = null;
        for (AccessibilityNodeInfo n : nodes) {
            String t = textOf(n);
            if (t != null && t.length() < 40 && t.contains(Config.CHANNEL) && !insideScrollable(n)) { title = n; break; }
        }
        if (title == null) return null;
        android.graphics.Rect tb = new android.graphics.Rect(), b = new android.graphics.Rect();
        title.getBoundsInScreen(tb);
        int left = Math.max(0, tb.left - 2 * tb.height());
        List<AccessibilityNodeInfo> out = new ArrayList<>();
        for (AccessibilityNodeInfo n : nodes) {
            n.getBoundsInScreen(b);
            if (b.centerX() >= left && b.centerY() > tb.bottom) out.add(n);
        }
        return out;
    }

    /** 대화창 영역 안에서 넘길 수 있는 목록(가장 큰 것). 없으면 null. */
    static AccessibilityNodeInfo roomScroller(List<AccessibilityNodeInfo> room) {
        AccessibilityNodeInfo best = null;
        long bestArea = -1;
        android.graphics.Rect b = new android.graphics.Rect();
        for (AccessibilityNodeInfo n : room) {
            if (!n.isScrollable()) continue;
            n.getBoundsInScreen(b);
            long a = (long) b.width() * b.height();
            if (a > bestArea) { bestArea = a; best = n; }
        }
        return best;
    }

    private static boolean insideScrollable(AccessibilityNodeInfo n) {
        for (AccessibilityNodeInfo p = n.getParent(); p != null; p = p.getParent()) if (p.isScrollable()) return true;
        return false;
    }

    /**
     * 노드의 글자. 화면 글자(text)가 없으면 설명(contentDescription)을 쓴다 —
     * 앱에 따라 제목·말풍선 글자를 설명 칸에만 넣어 두기 때문이다(2026-11-02 휴대폰 시험에서 대화방을 못 알아봄).
     */
    static String textOf(AccessibilityNodeInfo n) {
        CharSequence t = n.getText();
        if (t == null || t.length() == 0) t = n.getContentDescription();
        return t == null || t.length() == 0 ? null : t.toString();
    }

    /**
     * 카카오톡 창의 뿌리 노드. 지금 활성 창이 카톡이 아니면(접근성 바로가기 버튼 등이 앞에 있을 때)
     * 화면의 창 목록에서 카톡 창을 찾는다.
     */
    static AccessibilityNodeInfo kakaoRoot(AccessibilityService s) {
        AccessibilityNodeInfo r = s.getRootInActiveWindow();
        if (r != null && r.getPackageName() != null && Config.KAKAO.contentEquals(r.getPackageName())) return r;
        try {
            for (android.view.accessibility.AccessibilityWindowInfo w : s.getWindows()) {
                AccessibilityNodeInfo wr = w.getRoot();
                if (wr != null && wr.getPackageName() != null && Config.KAKAO.contentEquals(wr.getPackageName())) return wr;
            }
        } catch (Exception ignored) { /* 창 목록을 못 읽으면 활성 창으로 */ }
        return r;
    }

    static void collect(AccessibilityNodeInfo n, List<AccessibilityNodeInfo> out) {
        if (n == null) return;
        out.add(n);
        for (int i = 0; i < n.getChildCount(); i++) collect(n.getChild(i), out);
    }

    /** 노드 자신이 눌리지 않으면 눌리는 부모를 찾아 누른다. */
    private static boolean click(AccessibilityNodeInfo n) {
        for (AccessibilityNodeInfo p = n; p != null; p = p.getParent()) {
            if (p.isClickable()) return p.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        return false;
    }

    private boolean fullOk;

    /** 긁어오기가 끝난 뒤 미뤄 둔 실시간 읽기가 있으면 시작한다. [연계] ← Backfill.stop */
    void resumePending() {
        PendingIntent next = again;
        again = null;
        if (next != null && Config.auto(this)) handler.postDelayed(() -> start(next), 1_500L);
    }

    private void finish(String why) {
        handler.removeCallbacks(timeout);
        handler.removeCallbacks(readNow);
        String result;
        if (state == State.WAIT_FULL && !fullOk) {
            result = "전체보기 실패(" + why + ") — 접힌 글 " + found.size() + "개만 보냄";
        } else if (!found.isEmpty()) {
            result = "성공 " + found.size() + "개";
        } else {
            result = "실패: " + (why == null ? "글 없음" : why);
        }
        if (!found.isEmpty()) Sender.sendMessages(this, new ArrayList<>(found), "screen");
        Config.status(this, "대화방 읽기 " + result);
        // 서버 신호에 실어 보낼 마지막 결과(화면에만 남기지 않는다)
        Config.prefs(this).edit().putString("lastRead",
                new java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.KOREA).format(new java.util.Date()) + " " + result).apply();
        if (state == State.WAIT_FULL) performGlobalAction(GLOBAL_ACTION_BACK);   // 전문 화면을 닫고 나간다
        found.clear();
        fullOk = false;
        state = State.IDLE;
        performGlobalAction(GLOBAL_ACTION_HOME);
        if (wake != null && wake.isHeld()) wake.release();
        PendingIntent next = again;
        again = null;
        if (next != null) handler.postDelayed(() -> start(next), 1_500L);
    }

    @SuppressWarnings("deprecation")
    private void wakeScreen() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm == null) return;
        wake = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "relay:read");
        wake.acquire(TIMEOUT_MS + 5_000L);
    }
}
