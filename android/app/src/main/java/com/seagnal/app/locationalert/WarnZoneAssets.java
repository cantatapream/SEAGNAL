package com.seagnal.app.locationalert;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * WarnZoneAssets — APK 에 번들된 특보구역 폴리곤(assets/warn_zones.geojson)을 로드.
 *
 * 오프라인/종료 상태에서도 네트워크 없이 폴리곤을 쓸 수 있도록
 * local_server/assets/warn_zones.geojson 을 android/app/src/main/assets/ 로 번들.
 * 프로세스 1회 파싱 후 캐시.
 */
public final class WarnZoneAssets {

    private static final String ASSET_NAME = "warn_zones.geojson";
    private static volatile List<LocationAlertCore.Feature> cache;

    private WarnZoneAssets() { }

    /** 번들 폴리곤 features. 실패 시 빈 리스트(예외 흡수). */
    public static List<LocationAlertCore.Feature> load(Context ctx) {
        List<LocationAlertCore.Feature> c = cache;
        if (c != null) return c;
        synchronized (WarnZoneAssets.class) {
            if (cache != null) return cache;
            try {
                String json = readAsset(ctx, ASSET_NAME);
                JSONObject root = new JSONObject(json);
                cache = LocationAlertCore.parseFeatureCollection(root);
            } catch (Exception e) {
                cache = java.util.Collections.emptyList();
            }
            return cache;
        }
    }

    private static String readAsset(Context ctx, String name) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (InputStream is = ctx.getApplicationContext().getAssets().open(name);
             BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
            char[] buf = new char[8192];
            int n;
            while ((n = br.read(buf)) != -1) sb.append(buf, 0, n);
        }
        return sb.toString();
    }
}
