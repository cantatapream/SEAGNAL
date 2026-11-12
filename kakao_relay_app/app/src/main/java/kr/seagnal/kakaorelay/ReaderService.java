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
    // 맨 아래로 내리기·위로 거슬러 읽기·끝에 맨 아래 다시 확인까지 하므로 넉넉히(0.3 — 2026-11-12).
    private static final long TIMEOUT_MS = 120_000L;
    private static final long SETTLE_MS = 1_200L;   // 화면이 다 그려질 때까지 기다리는 시간
    // 동시에 여러 특보 카톡이 오는 경우가 있어(2026-11-01 16:03 예비특보·기상특보 2건 동시) 위로 2페이지까지 넘겨 읽는다
    //   (사용자 확정 2026-11-03 「최소한 스크롤 2페이지는 위로 돌려서 지금 데이터와 변동이 있는지 확인」).
    //   이미 본 글은 서버가 거른다(글 id·특보 줄 열쇠).
    //   넘길 때는 화면 높이의 60%만 끌어 직전 화면과 약 40% 겹치게 한다(사용자 제안 2026-11-03 「직전 페이지와 겹쳐서
    //   옮겨가면」 — 경계에 걸린 말풍선이 두 화면 사이에서 빠지지 않게). 2페이지 높이를 읽으려면 4번 끈다(4×0.6≈2.4).
    private static final int PAGES_UP = 4;
    static final float SWIPE_FRACTION = 0.6f;
    // 기준점(서버가 기억하는 「마지막으로 본 글」)이 있으면 그 글이 보일 때까지 올라간다(사용자 확정 2026-11-03).
    //   통신이 끊겼다가 특보가 여러 개 밀려 와도 빠짐없이 읽고, 새 글이 하나면 금방 멈춘다. 최대 15번 끌기.
    private static final int MAX_ANCHOR_SWIPES = 15;
    private static final long STEP_MS = 1_500L;     // 한 페이지 넘긴 뒤 그려질 때까지
    // ★0.3(사용자 확정 2026-11-12 「좋아」): 카톡은 대화방을 「마지막으로 보던 위치」에서 연다. 앱이 위로 거슬러 읽고
    //   그대로 나가면 다음 번에는 위쪽에서 열려 새 글(맨 아래)을 못 읽었다 — 태블릿 11/05~11/10 긴 특보 25건 중 19건의
    //   전문을 그 자리에서 못 받음(서버 기록 대조). 그래서 ① 열자마자 맨 아래로 내린 뒤 읽고 ② 끝나기 전에 맨 아래로
    //   돌아가 잠깐 기다렸다가 그사이 새로 붙은 글(몇 초 차이로 온 두 번째 카톡 — 방이 열려 있으면 카톡이 알림을 안 띄움)이
    //   있으면 한 번 더 읽고 ③ 맨 아래에 둔 채 나간다.
    private static final int MAX_BOTTOM_SWIPES = 20;
    private static final long BOTTOM_STEP_MS = 900L;
    private static final long LATE_WAIT_MS = 2_500L;

    private static ReaderService instance;
    private enum State { IDLE, WAIT_CHAT, BOTTOM, WAIT_FULL, SCROLL, FINAL }

    private final Handler handler = new Handler(Looper.getMainLooper());
    private State state = State.IDLE;
    private final java.util.LinkedHashSet<String> found = new java.util.LinkedHashSet<>();
    private int pagesLeft;
    private String lastSig;          // 넘기기 전 화면 서명 — 넘긴 뒤에도 같으면 안 움직인 것
    private String anchorId;         // 서버가 알려 준 기준점(마지막으로 본 글 id). 없으면 기본 양만 읽는다
    private boolean anchorFound;
    private String newestText;       // 첫 화면 맨 아래(가장 최근) 특보 글
    private boolean triedFallback;   // 끌기가 안 먹혀 「한 페이지 위로」를 한 번 시도했나
    private String scrollNote;   // 위 페이지를 다 못 읽었으면 그 까닭(기록용 — 실패로 치지 않는다)
    private PowerManager.WakeLock wake;
    private PendingIntent again;   // 읽는 도중 새 특보가 오면 끝난 뒤 한 번 더 읽는다
    private PendingIntent curPi;   // 지금 읽는 알림 — 끝에 맨 아래에서 새 글을 보면 이것으로 한 번 더 읽는다
    private boolean atBottom;      // 이번 읽기에서 맨 아래까지 내렸나
    private int bottomSwipes;      // 맨 아래로 내리며 끈 횟수(기록용)
    private String bottomSig;
    private Runnable afterBottom;  // 맨 아래에 닿은 뒤 할 일
    // 「마지막으로 본 글」(기준점)보다 아래에 있던 글 — 알림 글에 표식이 없어도 방금 온 글이다(11/09 04:31 놓친 글로 잘못 분류).
    private final java.util.LinkedHashSet<String> newer = new java.util.LinkedHashSet<>();
    private List<String> prevPage; // 직전 페이지의 특보 글 — 넘긴 뒤 하나도 안 겹치면 건너뛴 것
    private boolean triedOverlapFix;
    private int overlapMiss;       // 겹침을 못 찾은 횟수(기록용)
    private int lateNew;           // 끝에 맨 아래에서 새로 본 글 수
    private boolean lockedAtStart; // 읽기 시작 때 잠금 화면이 있었나(기록용)

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
        newer.clear();
        fullOk = false;
        curPi = pi;
        atBottom = false;
        bottomSwipes = 0;
        bottomSig = null;
        prevPage = null;
        triedOverlapFix = false;
        overlapMiss = 0;
        lateNew = 0;
        android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        lockedAtStart = km != null && km.isKeyguardLocked();
        anchorId = Config.prefs(this).getString("anchor", null);
        anchorFound = false;
        newestText = null;
        state = State.WAIT_CHAT;
        wakeScreen();
        handler.postDelayed(timeout, TIMEOUT_MS);
        // ① 화면 켜기·잠금 넘기기: 투명 화면(WakeActivity)을 잠깐 띄운다(2026-11-03 — 화면이 꺼진 동안 온 특보를 못 읽던 문제).
        try {
            startActivity(new android.content.Intent(this, WakeActivity.class)
                    .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_NO_ANIMATION));
            Config.status(this, "특보 — 화면 켜는 중");
        } catch (Exception e) {
            Config.status(this, "화면 켜기 실패(계속 진행): " + e.getMessage());
        }
        // ② 화면이 켜질 시간을 준 뒤 알림의 열기 동작으로 대화방을 연다.
        handler.postDelayed(() -> {
            if (state != State.WAIT_CHAT) return;
            try {
                if (Build.VERSION.SDK_INT >= 34) {
                    ActivityOptions o = ActivityOptions.makeBasic();
                    o.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                    pi.send(this, 0, null, null, null, null, o.toBundle());
                } else {
                    pi.send();
                }
                Config.status(this, "대화방 여는 중");
            } catch (Exception e) {
                finish("대화방 열기 실패: " + e.getMessage());
            }
        }, 1_200L);
    }

    @Override public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getPackageName() != null && Config.KAKAO.contentEquals(e.getPackageName())) Backfill.onDiagEvent(this);
        if (Backfill.active()) { Backfill.onEvent(this, e); return; }   // 임시 긁어오기 중에는 그쪽이 화면을 다룬다
        if (state == State.IDLE || state == State.SCROLL || state == State.BOTTOM || state == State.FINAL || e.getPackageName() == null) return;
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
            if (!atBottom) {
                // 카톡은 마지막으로 보던 위치에서 방을 연다 — 먼저 맨 아래(가장 최근)로 내린 뒤 읽는다.
                Config.status(this, "맨 아래로 내리는 중");
                state = State.BOTTOM;
                goBottom(() -> { state = State.WAIT_CHAT; handler.postDelayed(readNow, SETTLE_MS); });
                return;
            }
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
            found.addAll(texts);
            newestText = texts.get(texts.size() - 1);   // 대화창은 아래가 최신 — 화면 순서상 마지막이 맨 아래
            markNewer(texts);
            checkAnchor(texts);
            prevPage = texts;
            if (more != null && click(more)) {
                state = State.WAIT_FULL;
                Config.status(this, "전체보기 누름");
                return;
            }
            startScroll();
        } else if (state == State.WAIT_FULL) {
            String longest = texts.get(0);
            for (String t : texts) if (t.length() > longest.length()) longest = t;
            int had = 0;
            for (String t : found) had = Math.max(had, t.length());
            // 전문 화면이 아직 안 열렸는데 대화방 화면을 읽은 것일 수 있다 — 이미 모은 글보다 길 때만 전문으로 인정(적대검증 M9).
            if (longest.length() <= had) return;
            found.add(longest);
            // 전문이 기준점 아래(새 글)의 접힌 글과 같은 글이면 전문도 새 글이다(앞 150자로 맞춘다 — 머리말은 모든 글이 같다).
            for (String n : new ArrayList<>(newer)) {
                if (longest.startsWith(n.length() > 150 ? n.substring(0, 150) : n)) { newer.add(longest); break; }
            }
            fullOk = true;
            performGlobalAction(GLOBAL_ACTION_BACK);   // 전문 화면을 닫고 대화방으로 돌아가 위 페이지를 읽는다
            state = State.SCROLL;
            pagesLeft = anchorId == null ? PAGES_UP : MAX_ANCHOR_SWIPES;
            if (anchorFound) { handler.postDelayed(() -> finish(null), STEP_MS); return; }
            handler.postDelayed(this::scrollUp, STEP_MS);
        }
    }

    private void startScroll() {
        state = State.SCROLL;
        if (anchorFound) { finish(null); return; }   // 마지막으로 본 글이 첫 화면에 있다 — 그 아래만 새 글
        pagesLeft = anchorId == null ? PAGES_UP : MAX_ANCHOR_SWIPES;
        scrollUp();
    }

    /**
     * 기준점(마지막으로 본 글)보다 아래(=그 뒤에 온) 글을 표시한다. 기준점을 아직 못 봤으면 이 페이지 전부,
     * 이 페이지에 기준점이 있으면 그 아래 것만. 기준점을 끝내 못 찾으면 쓰지 않는다(finish — 옛 글이 섞일 수 있다).
     * 예: 페이지 [A, 기준점, B, C] → B·C 가 새 글
     * @param page 화면 순서(위→아래)의 특보 글
     */
    private void markNewer(List<String> page) {
        if (anchorId == null || anchorFound) return;
        int at = -1;
        for (int i = 0; i < page.size(); i++) if (anchorId.equals(idOf(page.get(i)))) { at = i; break; }
        for (int i = at + 1; i < page.size(); i++) newer.add(page.get(i));
    }

    /**
     * 맨 아래(가장 최근 글)까지 내린다 — 화면이 더 안 바뀔 때까지 아래쪽으로 넘긴다(최대 20번). 닿으면 next 를 부른다.
     * [연계] ← readScreen(처음) · finish(끝에 다시 확인)
     */
    private void goBottom(Runnable next) {
        atBottom = false;
        bottomSig = null;
        afterBottom = next;
        handler.post(this::bottomStep);
    }

    private void bottomStep() {
        if (state != State.BOTTOM && state != State.FINAL) return;
        List<AccessibilityNodeInfo> room = currentRoom();
        if (room == null) { atBottom = true; Runnable n = afterBottom; afterBottom = null; if (n != null) n.run(); return; }
        String sig = signature(room);
        if ((bottomSig != null && sig.equals(bottomSig)) || bottomSwipes >= MAX_BOTTOM_SWIPES) {
            atBottom = true;
            Runnable n = afterBottom;
            afterBottom = null;
            if (n != null) n.run();
            return;
        }
        bottomSig = sig;
        bottomSwipes++;
        AccessibilityNodeInfo sc = roomScroller(room);
        if (!swipe(this, sc, 0.8f, 0.2f, false) && (sc == null || !sc.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD))) {
            atBottom = true;
            Runnable n = afterBottom;
            afterBottom = null;
            if (n != null) n.run();
            return;
        }
        handler.postDelayed(this::bottomStep, BOTTOM_STEP_MS);
    }

    /** 이 글들 중에 기준점(마지막으로 본 글)이 있나. */
    private void checkAnchor(List<String> texts) {
        if (anchorId == null || anchorFound) return;
        for (String t : texts) if (anchorId.equals(idOf(t))) { anchorFound = true; return; }
    }

    /** 서버와 같은 글 id — sha256(앞뒤 공백 뺀 글)의 16진 앞 16자. 예: idOf("…") → "3fa9…" */
    static String idOf(String t) {
        try {
            byte[] d = java.security.MessageDigest.getInstance("SHA-256").digest(t.trim().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < 8; i++) b.append(String.format("%02x", d[i]));
            return b.toString();
        } catch (Exception e) { return ""; }
    }

    /** 대화창을 위로 넘긴다(직전 화면과 겹치게 60% 끌기). 더 못 넘기면(맨 위) 끝낸다. */
    private void scrollUp() {
        if (state != State.SCROLL) return;
        if (pagesLeft <= 0) { finish(null); return; }
        List<AccessibilityNodeInfo> room = currentRoom();
        if (room == null) { scrollNote = "위 페이지 전 대화방을 벗어남"; finish(null); return; }
        AccessibilityNodeInfo sc = roomScroller(room);
        if (sc == null) { finish(null); return; }
        lastSig = signature(room);
        triedFallback = false;
        if (!swipeDown(this, sc) && !sc.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) { finish(null); return; }
        pagesLeft--;
        handler.postDelayed(this::readPageUp, STEP_MS);
    }

    /** 넘긴 화면의 특보 글을 모으고 다음으로. 화면이 안 바뀌었으면 「한 페이지 위로」를 한 번 더 시도, 그래도 같으면 맨 위. */
    private void readPageUp() {
        if (state != State.SCROLL) return;
        List<AccessibilityNodeInfo> room = currentRoom();
        if (room == null) { scrollNote = "위 페이지를 읽는 중 대화방을 벗어남"; finish(null); return; }
        if (signature(room).equals(lastSig)) {
            AccessibilityNodeInfo sc = roomScroller(room);
            if (!triedFallback && sc != null && sc.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)) {
                triedFallback = true;
                handler.postDelayed(this::readPageUp, STEP_MS);
                return;
            }
            finish(null);   // 맨 위에 닿음
            return;
        }
        List<String> page = new ArrayList<>();
        for (AccessibilityNodeInfo n : room) {
            String s = textOf(n);
            if (s != null && s.contains(Config.MARKER)) page.add(s);
        }
        // 겹침 확인(사용자 지적 2026-11-12 「겹쳐서 훑음으로써 누락부분이 없게 하는 게 목적인데 겹침 없이 훑더라」):
        //   넘긴 화면에 직전 화면의 글이 하나도 없으면 그 사이 글을 건너뛰었을 수 있다 — 한 번은 조금 되돌려 다시 읽는다.
        if (prevPage != null && !prevPage.isEmpty() && !page.isEmpty() && java.util.Collections.disjoint(prevPage, page)) {
            overlapMiss++;
            if (!triedOverlapFix) {
                triedOverlapFix = true;
                AccessibilityNodeInfo sc = roomScroller(room);
                lastSig = signature(room);
                if (swipe(this, sc, 0.7f, 0.35f, true)) { handler.postDelayed(this::readPageUp, STEP_MS); return; }
            }
        } else triedOverlapFix = false;
        found.addAll(page);
        markNewer(page);
        checkAnchor(page);
        prevPage = page;
        if (anchorFound) { finish(null); return; }   // 마지막으로 본 글까지 올라왔다
        scrollUp();
    }

    /** 화면 서명 — 대화창에 보이는 글자들을 이어 붙인 것. 넘기기 전후가 같으면 화면이 안 움직인 것이다. */
    static String signature(List<AccessibilityNodeInfo> room) {
        StringBuilder b = new StringBuilder();
        for (AccessibilityNodeInfo n : room) {
            String s = textOf(n);
            if (s != null) b.append(s.length()).append(':').append(s.hashCode()).append('|');
        }
        return b.toString();
    }

    /**
     * 대화창 안에서 손가락을 위→아래로 화면 높이의 60%만큼 끈다(옛 글 쪽으로 넘기기, 직전 화면과 40% 겹침).
     * @return 동작을 보냈으면 true(안드로이드 7 미만·영역이 너무 작으면 false — 호출 쪽이 「한 페이지 위로」로 대신한다)
     * [연계] ← scrollUp(이 파일) · Backfill
     */
    static boolean swipeDown(AccessibilityService s, AccessibilityNodeInfo pane) {
        return swipe(s, pane, 0.2f, 0.2f + SWIPE_FRACTION, true);
    }

    /**
     * 대화창 안에서 손가락을 from→to(영역 높이에 대한 비율, 0=위 1=아래)로 끈다.
     * hold=true 면 끝에서 손가락을 0.3초 멈췄다가 뗀다 — 그냥 떼면 목록이 관성으로 더 미끄러져 직전 화면과 겹치지 않았다
     *   (사용자 확인 2026-11-12 휴대폰). 멈춘 뒤 떼면 속도가 0이라 미끄러지지 않는다(안드로이드 8 이상 — 그 아래는 그냥 뗀다).
     * 예: swipe(s, pane, 0.2f, 0.8f, true) → 옛 글 쪽으로 60% / swipe(s, pane, 0.8f, 0.2f, false) → 최근 쪽으로 빠르게
     */
    static boolean swipe(AccessibilityService s, AccessibilityNodeInfo pane, float from, float to, boolean hold) {
        if (Build.VERSION.SDK_INT < 24 || pane == null) return false;
        android.graphics.Rect r = new android.graphics.Rect();
        pane.getBoundsInScreen(r);
        if (r.height() < 200 || r.width() < 100) return false;
        float x = r.centerX();
        float y1 = r.top + r.height() * from, y2 = r.top + r.height() * to;
        android.graphics.Path p = new android.graphics.Path();
        p.moveTo(x, y1);
        p.lineTo(x, y2);
        if (!hold || Build.VERSION.SDK_INT < 26) {
            android.accessibilityservice.GestureDescription g = new android.accessibilityservice.GestureDescription.Builder()
                    .addStroke(new android.accessibilityservice.GestureDescription.StrokeDescription(p, 0, 400)).build();
            return s.dispatchGesture(g, null, null);
        }
        android.accessibilityservice.GestureDescription.StrokeDescription move =
                new android.accessibilityservice.GestureDescription.StrokeDescription(p, 0, 500, true);
        android.graphics.Path stay = new android.graphics.Path();
        stay.moveTo(x, y2);
        stay.lineTo(x, y2 + 1);   // 길이 0 인 경로는 받지 않는다 — 1픽셀
        final android.accessibilityservice.GestureDescription.StrokeDescription still = move.continueStroke(stay, 0, 300, false);
        android.accessibilityservice.GestureDescription g1 = new android.accessibilityservice.GestureDescription.Builder().addStroke(move).build();
        return s.dispatchGesture(g1, new AccessibilityService.GestureResultCallback() {
            @Override public void onCompleted(android.accessibilityservice.GestureDescription d) {
                s.dispatchGesture(new android.accessibilityservice.GestureDescription.Builder().addStroke(still).build(), null, null);
            }
        }, null);
    }

    private List<AccessibilityNodeInfo> currentRoom() {
        AccessibilityNodeInfo root = kakaoRoot(this);
        if (root == null) return null;
        List<AccessibilityNodeInfo> nodes = new ArrayList<>();
        collect(root, nodes);
        return roomNodes(nodes);
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
        // ① 카톡 이름표(id)로 찾는다 — 휴대폰·태블릿 진단 파일(2026-11-02)에서 둘 다 같은 id 확인:
        //    대화방 제목 toolbar_default_title_text(이름은 설명 칸), 대화 목록 chat_log_recycler_list
        //    (태블릿 세로: 목록 x144~805 · 대화창 x805~1581). 대화 목록 사각형 안의 노드만 대화방 글로 본다.
        AccessibilityNodeInfo idTitle = null, pane = null;
        for (AccessibilityNodeInfo n : nodes) {
            String id = n.getViewIdResourceName();
            if (id == null) continue;
            if (idTitle == null && id.endsWith(":id/toolbar_default_title_text")) {
                String t = textOf(n);
                if (t != null && t.contains(Config.CHANNEL)) idTitle = n;
            } else if (pane == null && id.endsWith(":id/chat_log_recycler_list")) pane = n;
        }
        if (idTitle != null && pane != null) {
            android.graphics.Rect pb = new android.graphics.Rect(), b = new android.graphics.Rect();
            pane.getBoundsInScreen(pb);
            List<AccessibilityNodeInfo> out = new ArrayList<>();
            for (AccessibilityNodeInfo n : nodes) {
                n.getBoundsInScreen(b);
                if (n == pane || pb.contains(b.centerX(), b.centerY())) out.add(n);
            }
            return out;
        }
        // ② id 가 바뀌었을 때를 위한 위치 방식(아래).
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
        for (AccessibilityNodeInfo n : room) {
            String id = n.getViewIdResourceName();
            if (id != null && id.endsWith(":id/chat_log_recycler_list")) return n;
        }
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

    /**
     * 읽기를 마친다. 정상으로 끝나면(why == null) 바로 끝내지 않고 맨 아래로 돌아가 잠깐 기다렸다가,
     * 그사이 새로 붙은 글이 있으면 한 번 더 읽게 걸어 둔다(몇 초 차이로 온 두 번째 카톡 — 방이 열려 있으면 알림이 안 온다).
     * 맨 아래에 둔 채 나가므로 다음 번에도 맨 아래에서 열린다.
     */
    private void finish(String why) {
        if (why == null && state != State.FINAL && state != State.WAIT_FULL && state != State.IDLE && !found.isEmpty()) {
            handler.removeCallbacks(readNow);
            state = State.FINAL;
            goBottom(() -> handler.postDelayed(this::lateCheck, LATE_WAIT_MS));
            return;
        }
        complete(why);
    }

    /** 끝에 맨 아래에서 처음 보는 특보 글이 있나 — 있으면 끝난 뒤 한 번 더 읽는다(그때는 기준점 아래라 새 글로 잡힌다). */
    private void lateCheck() {
        if (state != State.FINAL) return;
        List<AccessibilityNodeInfo> room = currentRoom();
        if (room != null) {
            for (AccessibilityNodeInfo n : room) {
                String s = textOf(n);
                if (s != null && s.contains(Config.MARKER) && !found.contains(s)) lateNew++;
            }
        }
        if (lateNew > 0) {
            Config.status(this, "맨 아래에 새 글 " + lateNew + "개 — 한 번 더 읽음");
            if (again == null) again = curPi;
        }
        complete(null);
    }

    private void complete(String why) {
        handler.removeCallbacks(timeout);
        handler.removeCallbacks(readNow);
        String result;
        if (state == State.WAIT_FULL && !fullOk) {
            result = "전체보기 실패(" + why + ") — 접힌 글 " + found.size() + "개만 보냄";
        } else if (!found.isEmpty()) {
            result = "성공 " + found.size() + "개" + (scrollNote == null ? "" : "(" + scrollNote + ")");
        } else {
            result = "실패: " + (why == null ? "글 없음" : why);
        }
        String anchorStatus = anchorId == null ? "none" : anchorFound ? "found" : "missing";
        // 기준점을 찾았을 때만 그 아래 글을 방금 온 글로 친다(못 찾았으면 옛 글이 섞였을 수 있다).
        java.util.Set<String> fresh = anchorFound ? new java.util.HashSet<>(newer) : java.util.Collections.emptySet();
        if (!found.isEmpty()) Sender.sendRead(this, new ArrayList<>(found), newestText, anchorStatus, fresh);
        // 진단 기록 — 매번 서버 기록장에 남긴다(어느 읽기가 왜 모자랐는지 화면 캡처 없이 알 수 있게).
        try {
            Sender.sendDiag(this, new org.json.JSONObject().put("kind", "read").put("result", result)
                    .put("bottomSwipes", bottomSwipes).put("reachedBottom", atBottom || bottomSwipes > 0)
                    .put("texts", found.size()).put("newer", fresh.size()).put("anchor", anchorStatus)
                    .put("overlapMiss", overlapMiss).put("lateNew", lateNew).put("locked", lockedAtStart)
                    .put("full", fullOk));
        } catch (org.json.JSONException ignored) { /* 기록만 — 읽기 결과에는 영향 없음 */ }
        Config.status(this, "대화방 읽기 " + result);
        // 서버 신호에 실어 보낼 마지막 결과(화면에만 남기지 않는다)
        Config.prefs(this).edit().putString("lastRead",
                new java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.KOREA).format(new java.util.Date()) + " " + result).apply();
        if (state == State.WAIT_FULL) performGlobalAction(GLOBAL_ACTION_BACK);   // 전문 화면을 닫고 나간다
        found.clear();
        fullOk = false;
        scrollNote = null;
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
        // CPU 를 깨워 둔다(화면이 꺼진 동안에도 시간 초과·다음 단계 타이머가 돌게). 화면 켜기는 WakeActivity 가 맡는다.
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "relay:read");
        wake.acquire(TIMEOUT_MS + 5_000L);
    }
}
