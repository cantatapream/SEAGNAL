package com.seagnal.app.locationalert;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/**
 * LocationAlertStore — 단말에 저장된 위치/활성·동의 플래그를 네이티브에서 읽는다.
 *
 * [경위] 기존 JS 는 위치를 localStorage('location_alert_last_pos') 에 저장했는데,
 *   네이티브(killed 상태)는 WebView 의 localStorage 를 읽을 수 없다. 그래서 JS 를
 *   고쳐 @capacitor/preferences(= Android SharedPreferences "CapacitorStorage") 에도
 *   같은 값을 저장하게 했고, 여기서 그 SharedPreferences 를 직접 읽는다.
 *   (기존 localStorage 경로는 그대로 유지 — 앱 켜짐/백그라운드 JS 가 계속 사용.)
 *
 *   @capacitor/preferences 의 기본 그룹명은 "CapacitorStorage" 이고 키는 가공 없이
 *   그대로 저장된다(값은 문자열). → SharedPreferences("CapacitorStorage").getString(key).
 *
 * [완전 on-device] 읽기만 한다. 어떤 값도 단말 밖으로 내보내지 않는다.
 */
public final class LocationAlertStore {

    /** Capacitor Preferences 기본 SharedPreferences 그룹명. */
    private static final String PREF_GROUP = "CapacitorStorage";

    // JS 와 합의된 키 (capacitor-plugins.js / location_alert_background.js 가 동일 키로 저장)
    private static final String KEY_POS = "location_alert_last_pos";   // {lat,lng,acc,at}
    private static final String KEY_ACTIVE = "location_alert_active";  // "true"/"false"
    private static final String KEY_CONSENT = "location_alert_consent";// "true"/"false"

    private LocationAlertStore() { }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREF_GROUP, Context.MODE_PRIVATE);
    }

    /** 위치기반 경보가 활성+동의 상태인지(게이팅). 둘 다 true 여야 동작. */
    public static boolean isEnabled(Context ctx) {
        SharedPreferences p = prefs(ctx);
        return isTrue(p.getString(KEY_ACTIVE, null)) && isTrue(p.getString(KEY_CONSENT, null));
    }

    private static boolean isTrue(String v) {
        return v != null && ("true".equalsIgnoreCase(v) || "1".equals(v));
    }

    /** 마지막 저장 위치. 없거나 파싱 실패 시 null. */
    public static Position getPosition(Context ctx) {
        String raw = prefs(ctx).getString(KEY_POS, null);
        if (raw == null || raw.isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(raw);
            if (!o.has("lat") || !o.has("lng")) return null;
            Position pos = new Position();
            pos.lat = o.getDouble("lat");
            pos.lng = o.getDouble("lng");
            pos.accuracyM = o.isNull("acc") ? 0.0 : o.optDouble("acc", 0.0);
            pos.at = o.optString("at", null);
            return pos;
        } catch (Exception e) {
            return null;
        }
    }

    public static final class Position {
        public double lat;
        public double lng;
        public double accuracyM;
        public String at;
    }
}
