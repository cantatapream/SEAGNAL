package com.seagnal.app.locationalert;

import org.json.JSONObject;

import java.util.List;

/**
 * LocationAlertDecider — local_server/js/location_alert_runtime.js 의 decideAlert 포팅.
 *
 * 단말 저장 위치 + 번들 폴리곤 + 스냅샷(zones)으로 표출할 {title, body} 또는 null 결정.
 * JS decideAlert 와 동일한 게이팅/회색지대 규칙을 따른다.
 */
public final class LocationAlertDecider {

    private LocationAlertDecider() { }

    /** snapshot.zones[name].tier (없으면 'none'). */
    private static String tierOfZone(JSONObject snapshot, String name) {
        JSONObject zones = snapshot.optJSONObject("zones");
        if (zones == null) return "none";
        JSONObject z = zones.optJSONObject(name);
        if (z == null) return "none";
        String tier = z.optString("tier", null);
        return tier != null && !tier.isEmpty() ? tier : "none";
    }

    /**
     * 순수 판정. 표출할 메시지 또는 null.
     * @param lat,lng,accuracyM 단말 저장 위치
     * @param features 번들 폴리곤
     * @param snapshot { zones: { [구역명]: {warnType, level, event, efTime, tier} } }
     */
    public static LocationAlertCore.Message decideAlert(
            double lat, double lng, double accuracyM,
            List<LocationAlertCore.Feature> features, JSONObject snapshot) {

        if (features == null || features.isEmpty() || snapshot == null) return null;

        final double[] pt = LocationAlertCore.toLngLat(lat, lng);

        LocationAlertCore.Located located = LocationAlertCore.locateZone(pt, features, accuracyM);
        if (located == null) return null; // 바다 구역 밖(육지/외해)

        final String zoneName = located.feature.name;
        JSONObject zones = snapshot.optJSONObject("zones");
        JSONObject z = zones != null ? zones.optJSONObject(zoneName) : null;
        if (z == null) return null;
        String tier = z.optString("tier", null);
        if (tier == null || tier.isEmpty() || "none".equals(tier) || "prelim_none".equals(tier)) {
            return null; // 내 구역에 유효 특보 없음
        }

        // 경계 회색지대(GPS 오차 반경 내): severe 만 보류. 예비·주의보는 그대로 표출.
        if (located.grayZone && "severe".equals(tier)) return null;

        final JSONObject snap = snapshot;

        // 최근접 무특보 구역
        LocationAlertCore.Target nearestClear = LocationAlertCore.nearestZoneBy(pt, features,
                f -> "none".equals(tierOfZone(snap, f.name)));

        // severe 면 '경보·태풍이 아닌(주의보/예비)' 최근접도
        LocationAlertCore.Target nearestLower = null;
        if ("severe".equals(tier)) {
            nearestLower = LocationAlertCore.nearestZoneBy(pt, features,
                    f -> !f.name.equals(zoneName) && !"severe".equals(tierOfZone(snap, f.name)));
        }

        LocationAlertCore.MessageCtx ctx = new LocationAlertCore.MessageCtx();
        ctx.zoneName = zoneName;
        ctx.warnType = optStr(z, "warnType", "풍랑");
        ctx.tier = tier;
        ctx.event = optStr(z, "event", "active");
        ctx.timeText = optStr(z, "efTime", "");
        ctx.nearestClear = nearestClear;
        ctx.nearestLower = nearestLower;
        // 예측 기상(최악) — 서버가 스냅샷 zone.forecast {day, summary} 로 주입(위치 유출 방지).
        //   누락/형식오류 → null(줄 생략). JS decideAlert 의 z.forecast 전달과 동일.
        JSONObject fc = z.optJSONObject("forecast");
        if (fc != null) {
            ctx.forecastDay = optStr(fc, "day", null);
            ctx.forecastSummary = optStr(fc, "summary", null);
        }

        LocationAlertCore.Message msg = LocationAlertCore.buildMessage(ctx);
        // 진단 주석(텍스트는 변경하지 않음). 단말 last_match 기록 + 시연 탭 표시용.
        if (msg != null) { msg.zone = zoneName; msg.tier = tier; msg.event = ctx.event; }
        return msg;
    }

    private static String optStr(JSONObject o, String key, String def) {
        String v = o.optString(key, null);
        return (v == null || v.isEmpty() || "null".equals(v)) ? def : v;
    }
}
