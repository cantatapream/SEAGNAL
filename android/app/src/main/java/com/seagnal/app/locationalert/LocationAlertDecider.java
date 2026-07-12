package com.seagnal.app.locationalert;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * LocationAlertDecider — local_server/js/location_alert_runtime.js 의 decideAlert 포팅.
 *
 * 단말 저장 위치 + 번들 폴리곤 + 스냅샷(zones)으로 표출할 {title, body} 또는 null 결정.
 * JS decideAlert 와 동일한 게이팅/회색지대 규칙을 따른다.
 *
 * [안전-치명 수정] 폴리곤명(공백·'.')과 스냅샷 표준 구역명(무공백·'·') 차이 때문에
 *   특보구역이 무특보로 오판정되던 버그를 LocationAlertCore.canonZone 정규화 인덱스로
 *   해소한다(JS runtime.decideAlert 와 동일 로직).
 */
public final class LocationAlertDecider {

    private LocationAlertDecider() { }

    /**
     * 진단 out-param — decideAlert 가 null 을 반환한 사유를 노출(JS diag 와 동일 개념).
     *   locatedZone: 위치가 속한 바다 구역명("" = 바다 구역 밖).
     *   reason: "notified" | "off-sea" | "no-warning"(무특보·회색지대 보류) | "invalid".
     * 반환 계약(Message|null)은 불변 — 기존 호출부는 5-인자 오버로드를 그대로 사용.
     */
    public static final class Diag {
        public String locatedZone = "";
        public String reason = "";
    }

    /** zones 를 canonZone(키)→zone JSON 으로 정규화한 인덱스. (JS normZones 와 동일) */
    private static Map<String, JSONObject> normIndex(JSONObject zones) {
        Map<String, JSONObject> m = new HashMap<>();
        if (zones == null) return m;
        Iterator<String> it = zones.keys();
        while (it.hasNext()) {
            String k = it.next();
            JSONObject z = zones.optJSONObject(k);
            if (z != null) m.put(LocationAlertCore.canonZone(k), z);
        }
        return m;
    }

    /** 정확 일치 우선(안전) → 정규화 조회로 zone JSON 을 찾는다. (JS: zonesRaw[name] || normZones[canon(name)]) */
    private static JSONObject lookupZone(JSONObject zones, Map<String, JSONObject> norm, String name) {
        if (zones != null) {
            JSONObject exact = zones.optJSONObject(name);
            if (exact != null) return exact;
        }
        return norm.get(LocationAlertCore.canonZone(name));
    }

    /** snapshot.zones[name].tier (정규화 조회; 없으면 'none'). JS tierOfZone 와 동일. */
    private static String tierOfZone(JSONObject zones, Map<String, JSONObject> norm, String name) {
        JSONObject z = lookupZone(zones, norm, name);
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
        // 기존 공개 계약(5-인자) 유지 — 진단 불필요 호출부는 그대로.
        return decideAlert(lat, lng, accuracyM, features, snapshot, null);
    }

    /**
     * 진단 오버로드 — diag(nullable)에 locatedZone/reason 을 채운다(JS decideAlert 의
     * 선택적 diag out-param 과 동일). 판정 로직·반환값은 5-인자와 완전히 동일.
     */
    public static LocationAlertCore.Message decideAlert(
            double lat, double lng, double accuracyM,
            List<LocationAlertCore.Feature> features, JSONObject snapshot, Diag diag) {

        if (features == null || features.isEmpty() || snapshot == null) {
            if (diag != null) diag.reason = "invalid";
            return null;
        }

        final double[] pt = LocationAlertCore.toLngLat(lat, lng);

        // 폴리곤명↔스냅샷 표준 구역명 차이를 흡수하는 정규화 인덱스를 1회 구축(JS normZones 대응).
        final JSONObject zones = snapshot.optJSONObject("zones");
        final Map<String, JSONObject> norm = normIndex(zones);

        LocationAlertCore.Located located = LocationAlertCore.locateZone(pt, features, accuracyM);
        if (located == null) { // 바다 구역 밖(육지/외해)
            if (diag != null) { diag.locatedZone = ""; diag.reason = "off-sea"; }
            return null;
        }

        final String zoneName = located.feature.name;
        if (diag != null) diag.locatedZone = zoneName != null ? zoneName : "";
        // 사용자 자기 구역: 정확 일치 우선 → 정규화 조회.
        JSONObject z = lookupZone(zones, norm, zoneName);
        if (z == null) {
            if (diag != null) diag.reason = "no-warning"; // 내 구역에 유효 특보 없음
            return null;
        }
        String tier = z.optString("tier", null);
        if (tier == null || tier.isEmpty() || "none".equals(tier) || "prelim_none".equals(tier)) {
            if (diag != null) diag.reason = "no-warning";
            return null; // 내 구역에 유효 특보 없음
        }

        // 경계 회색지대(GPS 오차 반경 내): severe 만 보류. 예비·주의보는 그대로 표출.
        //   진단상 '유효 특보 억제(no-warning)'로 기록(회색지대 보류 = 표출 없음).
        if (located.grayZone && "severe".equals(tier)) {
            if (diag != null) diag.reason = "no-warning";
            return null;
        }

        // 최근접 무특보 구역 — 정규화 tierOfZone(특보구역이 무특보로 오판정되지 않도록).
        LocationAlertCore.Target nearestClear = LocationAlertCore.nearestZoneBy(pt, features,
                f -> "none".equals(tierOfZone(zones, norm, f.name)));

        // severe 면 '경보·태풍이 아닌(주의보/예비)' 최근접도
        LocationAlertCore.Target nearestLower = null;
        if ("severe".equals(tier)) {
            nearestLower = LocationAlertCore.nearestZoneBy(pt, features,
                    f -> !f.name.equals(zoneName) && !"severe".equals(tierOfZone(zones, norm, f.name)));
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
        if (diag != null) diag.reason = msg != null ? "notified" : "no-warning"; // buildMessage null(비정상)도 무표출로 기록
        return msg;
    }

    private static String optStr(JSONObject o, String key, String def) {
        String v = o.optString(key, null);
        return (v == null || v.isEmpty() || "null".equals(v)) ? def : v;
    }
}
