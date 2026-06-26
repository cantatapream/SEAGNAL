package com.seagnal.app.locationalert;

import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * TyphoonApi — 공개 엔드포인트 /api/typhoon 만 GET 으로 가져오는 방어적 HTTP 헬퍼.
 *
 * [프라이버시] 위치/개인정보는 절대 전송하지 않는다. 보내는 것은 GET 요청 1건뿐이고,
 *   서버는 공개 태풍 데이터(좌표/반경/통보문)만 돌려준다. 좌표 판정은 전부 단말에서.
 *
 * [동작] FCM 백그라운드 스레드에서 호출(네트워크 off-main 허용). 짧은 타임아웃(~8초)
 *   + 완전 try/catch → 어떤 실패에도 null 반환. FCM 서비스를 절대 블록/크래시시키지 않는다.
 *
 * [URL] capacitor.config.json 의 "url"(=https://seagnal-server.fly.dev)과 동일.
 *   네이티브에서 config 를 런타임에 쉽게 읽을 수 없어 동일 값을 상수로 둔다(아래 BASE_URL).
 *   config 의 url 이 바뀌면 이 상수도 함께 갱신해야 한다.
 */
public final class TyphoonApi {

    private static final String TAG = "TyphoonApi";

    // capacitor.config.json → "url": "https://seagnal-server.fly.dev" 와 동일하게 유지.
    private static final String BASE_URL = "https://seagnal-server.fly.dev";
    private static final String TYPHOON_PATH = "/api/typhoon";

    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 8000;
    private static final int MAX_BYTES = 2 * 1024 * 1024; // 2MB 상한(이상치 방어)

    private TyphoonApi() { }

    /**
     * /api/typhoon 를 GET 해 JSON 으로 파싱. 어떤 실패에도 null.
     * @return { updatedAt, hasActive, year?, typhoons:[...] } 또는 null
     */
    public static JSONObject fetchTyphoon() {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(BASE_URL + TYPHOON_PATH);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Connection", "close");
            conn.setUseCaches(false);

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                Log.w(TAG, "fetchTyphoon HTTP " + code);
                return null;
            }

            String body = readStream(conn.getInputStream());
            if (body == null || body.isEmpty()) return null;
            return new JSONObject(body);
        } catch (Throwable t) {
            Log.w(TAG, "fetchTyphoon 실패(무시)", t);
            return null;
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Throwable ignore) { }
            }
        }
    }

    private static String readStream(InputStream in) {
        if (in == null) return null;
        BufferedReader reader = null;
        try {
            reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            char[] buf = new char[8192];
            int n, total = 0;
            while ((n = reader.read(buf)) != -1) {
                total += n;
                if (total > MAX_BYTES) break; // 이상치 방어
                sb.append(buf, 0, n);
            }
            return sb.toString();
        } catch (Throwable t) {
            return null;
        } finally {
            try { if (reader != null) reader.close(); } catch (Throwable ignore) { }
        }
    }
}
