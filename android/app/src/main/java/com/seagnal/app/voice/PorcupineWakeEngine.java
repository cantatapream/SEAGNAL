package com.seagnal.app.voice;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

import ai.picovoice.porcupine.PorcupineManager;

/**
 * Porcupine(Picovoice) 온디바이스 호출어 엔진 — "나리야"만 저전력·고신뢰로 감지.
 *
 * [활성 조건]
 *   assets/ 에 아래 3개 파일이 모두 있어야 동작한다(없으면 isAvailable()=false →
 *   서비스가 AndroidSpeechWakeEngine 으로 자동 폴백):
 *     - nariya.ppn                (콘솔에서 만든 한국어 "나리야" 호출어 모델)
 *     - porcupine_params_ko.pv    (한국어 파라미터 모델)
 *     - picovoice_access_key.txt  (AccessKey 한 줄)
 *
 * [동작]
 *   start(cb) 시 PorcupineManager 가 마이크를 잡고 "나리야" 감지 → cb.onWake().
 *   서비스가 onWake 후 stop() 으로 멈추고 명령 인식을 진행, 끝나면 다시 start().
 *
 * [주의] Porcupine 은 파일 경로가 필요하므로 assets 를 filesDir 로 복사해서 사용.
 *        RECORD_AUDIO 권한 필요(서비스가 enable 시 요청).
 */
public class PorcupineWakeEngine implements WakeWordEngine {

    private static final String TAG = "PorcupineWake";
    private static final String KEYWORD_ASSET = "nariya.ppn";
    private static final String PARAMS_ASSET = "porcupine_params_ko.pv";
    private static final String KEY_ASSET = "picovoice_access_key.txt";

    private final Context appContext;
    private PorcupineManager manager;
    private Callback callback;

    public PorcupineWakeEngine(Context context) {
        this.appContext = context.getApplicationContext();
    }

    /** assets에 Porcupine 구성 파일 3종 + AccessKey가 모두 있는지 */
    public static boolean isAvailable(Context c) {
        return assetExists(c, KEYWORD_ASSET) && assetExists(c, PARAMS_ASSET) && readAccessKey(c) != null;
    }

    private static boolean assetExists(Context c, String name) {
        try (InputStream is = c.getAssets().open(name)) { return true; }
        catch (Exception e) { return false; }
    }

    private static String readAccessKey(Context c) {
        try (InputStream is = c.getAssets().open(KEY_ASSET)) {
            byte[] buf = new byte[256];
            int n = is.read(buf);
            if (n <= 0) return null;
            String key = new String(buf, 0, n, "UTF-8").trim();
            return key.isEmpty() ? null : key;
        } catch (Exception e) { return null; }
    }

    /** assets 파일을 filesDir 로 복사하고 절대경로 반환 */
    private String copyAsset(String name) throws Exception {
        File out = new File(appContext.getFilesDir(), name);
        try (InputStream is = appContext.getAssets().open(name); OutputStream os = new FileOutputStream(out)) {
            byte[] buf = new byte[8192];
            int r;
            while ((r = is.read(buf)) != -1) os.write(buf, 0, r);
        }
        return out.getAbsolutePath();
    }

    @Override
    public void start(Callback cb) {
        this.callback = cb;
        try {
            if (manager == null) {
                String keywordPath = copyAsset(KEYWORD_ASSET);
                String modelPath = copyAsset(PARAMS_ASSET);
                String accessKey = readAccessKey(appContext);
                manager = new PorcupineManager.Builder()
                        .setAccessKey(accessKey)
                        .setKeywordPath(keywordPath)
                        .setModelPath(modelPath)
                        .setSensitivity(0.6f)
                        .build(appContext, keywordIndex -> {
                            if (callback != null) callback.onWake();
                        });
            }
            manager.start();
        } catch (Exception e) {
            Log.w(TAG, "Porcupine 시작 실패: " + e.getMessage());
            if (callback != null) callback.onError("호출어 엔진 시작 실패: " + e.getMessage());
        }
    }

    @Override
    public void stop() {
        try { if (manager != null) manager.stop(); } catch (Exception ignored) {}
    }

    @Override
    public void destroy() {
        try { if (manager != null) { manager.stop(); manager.delete(); manager = null; } } catch (Exception ignored) {}
    }
}
