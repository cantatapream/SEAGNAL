package com.seagnal.app.voice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.seagnal.app.MainActivity;
import com.seagnal.app.R;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Vosk 한국어 모델(~80MB) 1회 다운로드 + 압축해제 전담 전경 서비스.
 *
 * [흐름]
 *   onStartCommand → startForeground(진행률 알림) → 워커스레드:
 *     1) Wi-Fi 검사(allowMobile=false 시 Wi-Fi 아니면 WIFI_REQUIRED 로 중단)
 *     2) MODEL_URL 다운로드(tmpZip) — Content-Length 기반 진행률
 *     3) tmpZip 압축해제 → vosk-model-ko/ 로 정착(zip 내 단일 루트 디렉터리 사용)
 *     4) .ready 마커 생성 → VoskModelManager.markReady → 사용자/플러그인에 READY 통지
 *   취소(ACTION_CANCEL) 시 워커가 다음 청크에서 빠져나와 정리 후 종료.
 *
 * [상태 통지]
 *   모든 단계 변화는 VoskModelManager.setState() 로 알리고, SeagnalAssistantPlugin
 *   이 'voskState' 이벤트로 WebView 에 전달한다.
 *
 * [멱등성]
 *   이미 READY 면 즉시 stopSelf. DOWNLOADING 인데 중복 시작되면 무시.
 *
 * [안전 — zip slip]
 *   ZipEntry 이름이 ../ 등으로 정착 디렉터리 바깥을 가리키면 거부.
 */
public class VoskDownloadService extends Service {

    private static final String TAG = "VoskDL";
    public static final String ACTION_CANCEL = "com.seagnal.app.voice.VOSK_CANCEL";
    public static final String EXTRA_ALLOW_MOBILE = "allowMobile";

    private static final String CHANNEL_ID = "vosk_download";
    private static final int NOTIF_ID = 0x56304B; // 'V0K'
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS    = 30_000;
    private static final int BUFFER_BYTES       = 64 * 1024;
    private static final long PROGRESS_THROTTLE_MS = 700;

    private volatile boolean canceled = false;
    private volatile Thread worker = null;
    private static volatile boolean active = false;

    public static boolean isActive() { return active; }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_CANCEL.equals(intent.getAction())) {
            canceled = true;
            if (worker != null) worker.interrupt();
            return START_NOT_STICKY;
        }
        if (VoskModelManager.get().isReady(this)) {
            // 이미 받아둠 — 멱등 종료
            VoskModelManager.get().setState(VoskModelManager.State.READY, -1, null);
            stopForegroundCompat(); stopSelf();
            return START_NOT_STICKY;
        }
        if (active) { // 이미 실행 중
            return START_NOT_STICKY;
        }
        active = true;
        canceled = false;

        ensureChannel();
        startForeground(NOTIF_ID, buildNotification("음성 지원을 하기 위한 데이터를 다운로드 중입니다", 0, true));

        final boolean allowMobile = intent != null && intent.getBooleanExtra(EXTRA_ALLOW_MOBILE, false);
        worker = new Thread(() -> runDownload(allowMobile), "VoskDownload");
        worker.start();
        return START_NOT_STICKY;
    }

    // ── 다운로드 본체 ──────────────────────────────────────────────────────
    private void runDownload(boolean allowMobile) {
        Context ctx = getApplicationContext();
        VoskModelManager mgr = VoskModelManager.get();
        File tmp = VoskModelManager.tmpZipFile(ctx);
        File staging = new File(ctx.getFilesDir(), VoskModelManager.MODEL_DIR_NAME + ".stage");
        File modelDir = VoskModelManager.modelDir(ctx);

        try {
            // 1) Wi-Fi 검사
            if (!allowMobile && !isWifi(ctx)) {
                mgr.setState(VoskModelManager.State.WIFI_REQUIRED, -1, "Wi-Fi 에 연결한 뒤 다시 시도해 주세요.");
                return;
            }
            mgr.setState(VoskModelManager.State.DOWNLOADING, 0, "다운로드 시작");

            // 2) 다운로드
            if (tmp.exists()) tmp.delete();
            VoskModelManager.deleteRecursive(staging);
            VoskModelManager.deleteRecursive(modelDir);

            HttpURLConnection conn = (HttpURLConnection) new URL(VoskModelManager.modelUrl()).openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(true);
            int code = conn.getResponseCode();
            if (code != 200) {
                mgr.setState(VoskModelManager.State.FAILED, -1, "서버 응답 오류: HTTP " + code);
                return;
            }
            long total = conn.getContentLengthLong();
            if (total <= 0) total = VoskModelManager.expectedBytes();

            long downloaded = 0, lastTick = 0;
            try (InputStream in = new BufferedInputStream(conn.getInputStream());
                 FileOutputStream out = new FileOutputStream(tmp)) {
                byte[] buf = new byte[BUFFER_BYTES];
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (canceled) throw new InterruptedException("취소됨");
                    out.write(buf, 0, n);
                    downloaded += n;
                    long now = System.currentTimeMillis();
                    if (now - lastTick > PROGRESS_THROTTLE_MS) {
                        lastTick = now;
                        int pct = total > 0 ? (int) Math.min(99, (downloaded * 100L) / total) : -1;
                        if (pct >= 0) {
                            updateNotification("음성 지원을 하기 위한 데이터를 다운로드 중입니다", pct);
                            mgr.setState(VoskModelManager.State.DOWNLOADING, pct, null);
                        }
                    }
                }
                out.flush();
            }
            conn.disconnect();

            // 3) 압축해제 — 안전 가드 + 단일 루트 정착
            if (canceled) throw new InterruptedException("취소됨");
            updateNotification("음성 지원 데이터 설치 중", 99);
            mgr.setState(VoskModelManager.State.DOWNLOADING, 99, "설치 중");
            if (!staging.mkdirs() && !staging.isDirectory()) throw new IOException("작업 폴더 생성 실패");
            unzipSafe(tmp, staging);
            File[] roots = staging.listFiles();
            File sourceRoot = null;
            if (roots != null && roots.length == 1 && roots[0].isDirectory()) sourceRoot = roots[0];
            File targetParent = new File(ctx.getFilesDir(), VoskModelManager.MODEL_DIR_NAME);
            if (targetParent.exists()) VoskModelManager.deleteRecursive(targetParent);
            File toMove = sourceRoot != null ? sourceRoot : staging;
            if (!toMove.renameTo(targetParent)) {
                // 같은 파일시스템이라 보통 성공. 실패 시 복사 폴백.
                copyDir(toMove, targetParent);
                VoskModelManager.deleteRecursive(toMove);
            }
            tmp.delete();
            VoskModelManager.deleteRecursive(staging);

            // 4) 마커 + READY
            if (!mgr.markReady(ctx)) throw new IOException("준비 마커 생성 실패");
            updateNotification("음성 지원 데이터 준비 완료", 100);
        } catch (InterruptedException ie) {
            cleanupPartial(tmp, staging, modelDir);
            mgr.setState(VoskModelManager.State.FAILED, -1, "다운로드가 취소되었습니다");
        } catch (Throwable t) {
            Log.w(TAG, "다운로드/설치 실패", t);
            cleanupPartial(tmp, staging, modelDir);
            mgr.setState(VoskModelManager.State.FAILED, -1, "다운로드 실패: " + (t.getMessage() != null ? t.getMessage() : t.getClass().getSimpleName()));
        } finally {
            active = false;
            stopForegroundCompat();
            stopSelf();
        }
    }

    private static void cleanupPartial(File tmp, File staging, File modelDir) {
        try { if (tmp != null && tmp.exists()) tmp.delete(); } catch (Throwable ignored) {}
        try { VoskModelManager.deleteRecursive(staging); } catch (Throwable ignored) {}
        // modelDir 자체는 .ready 가 없으면 다음 시도에 어차피 다시 정리됨.
    }

    private static boolean isWifi(Context ctx) {
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        Network n = cm.getActiveNetwork();
        if (n == null) return false;
        NetworkCapabilities c = cm.getNetworkCapabilities(n);
        return c != null && c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
    }

    // ── 압축해제 (zip slip 가드) ──────────────────────────────────────────
    private static void unzipSafe(File zipFile, File targetDir) throws IOException {
        String targetCanonical = targetDir.getCanonicalPath() + File.separator;
        try (ZipInputStream zin = new ZipInputStream(new BufferedInputStream(new java.io.FileInputStream(zipFile)))) {
            ZipEntry e;
            byte[] buf = new byte[BUFFER_BYTES];
            while ((e = zin.getNextEntry()) != null) {
                File outFile = new File(targetDir, e.getName());
                String outCanonical = outFile.getCanonicalPath();
                if (!outCanonical.startsWith(targetCanonical)) {
                    throw new IOException("부적절한 zip 경로: " + e.getName());
                }
                if (e.isDirectory()) {
                    if (!outFile.isDirectory() && !outFile.mkdirs()) throw new IOException("폴더 생성 실패: " + outFile);
                } else {
                    File parent = outFile.getParentFile();
                    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("폴더 생성 실패: " + parent);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        int n; while ((n = zin.read(buf)) > 0) fos.write(buf, 0, n);
                    }
                }
                zin.closeEntry();
            }
        }
    }

    private static void copyDir(File src, File dst) throws IOException {
        if (!dst.exists() && !dst.mkdirs()) throw new IOException("폴더 생성 실패: " + dst);
        File[] kids = src.listFiles();
        if (kids == null) return;
        for (File k : kids) {
            File d = new File(dst, k.getName());
            if (k.isDirectory()) copyDir(k, d);
            else {
                try (java.io.FileInputStream in = new java.io.FileInputStream(k);
                     FileOutputStream out = new FileOutputStream(d)) {
                    byte[] buf = new byte[BUFFER_BYTES];
                    int n; while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
            }
        }
    }

    // ── 알림 ──────────────────────────────────────────────────────────────
    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel ch = nm.getNotificationChannel(CHANNEL_ID);
        if (ch != null) return;
        ch = new NotificationChannel(CHANNEL_ID, "음성 지원 데이터", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("음성 비서 사용을 위한 한국어 모델 다운로드 진행 상황");
        nm.createNotificationChannel(ch);
    }

    private Notification buildNotification(String text, int percent, boolean indeterminate) {
        Intent open = new Intent(this, MainActivity.class);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("음성 지원 데이터")
                .setContentText(indeterminate ? text : (text + " (" + percent + "%)"))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setProgress(100, percent, indeterminate)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_LOW);
        return b.build();
    }

    private void updateNotification(String text, int percent) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        try { nm.notify(NOTIF_ID, buildNotification(text, percent, false)); } catch (Throwable ignored) {}
    }

    @SuppressWarnings("deprecation")
    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);  // pre-N: boolean 오버로드(deprecated in N+)
            }
        } catch (Throwable ignored) {}
    }
}
