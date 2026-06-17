package com.seagnal.app.locationalert;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * LocationAlertCore — local_server/js/location_alert_core.js 의 네이티브(Java) 포팅.
 *
 * [목적]
 *   앱이 완전 종료(killed)된 상태에서도 FCM 데이터 메시지를 받아, 단말에 저장된
 *   마지막 위치 + APK 에 번들된 특보구역 폴리곤으로 "어느 구역에 있는지 / 가장 가까운
 *   무특보(및 비-severe) 구역" 을 직접 계산하고, JS 의 buildMessage 와 글자 단위로
 *   동일한 제목/본문을 만든다. (위치는 절대 단말 밖으로 나가지 않음 — 완전 on-device)
 *
 * [좌표 규약] 내부적으로 [lng, lat] (GeoJSON 표준). 거리 m / 해리(1해리=1852m).
 *   방위는 진북 기준 0~360° (시계방향).
 *
 * JS 원본과 1:1 대응:
 *   haversineMeters, bearingDeg, pointInRing, pointInPolygon, pointInGeometry,
 *   seaGeometry, closestPointOnSegment, nearestPointOnGeometry, locateZone,
 *   nearestZoneBy, segmentCrossesLand, classifyTier, fmtNm, buildMessage.
 *
 * 순수 계산만 수행 — 안드로이드 의존성/네트워크 없음. (org.json 만 사용)
 */
public final class LocationAlertCore {

    public static final double NM_M = 1852.0;       // 1 해리(미터)
    private static final double DEG2RAD = Math.PI / 180.0;
    private static final double R_EARTH = 6371000.0; // 지구 반경(m)

    private LocationAlertCore() { }

    // ── 좌표 헬퍼 ───────────────────────────────────────────────────────────
    /** {lat,lng} → [lng, lat]. */
    public static double[] toLngLat(double lat, double lng) {
        return new double[] { lng, lat };
    }

    // ── 거리·방위 ───────────────────────────────────────────────────────────
    /** a,b = [lng, lat]. JS haversineMeters 와 동일. */
    public static double haversineMeters(double[] a, double[] b) {
        double lon1 = a[0], lat1 = a[1], lon2 = b[0], lat2 = b[1];
        double dLat = (lat2 - lat1) * DEG2RAD, dLon = (lon2 - lon1) * DEG2RAD;
        double s = Math.pow(Math.sin(dLat / 2), 2)
                + Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.pow(Math.sin(dLon / 2), 2);
        return 2 * R_EARTH * Math.asin(Math.min(1.0, Math.sqrt(s)));
    }

    /** 진북 기준 초기 방위각(0~360°). from,to = [lng, lat]. */
    public static double bearingDeg(double[] from, double[] to) {
        double lon1 = from[0], lat1 = from[1], lon2 = to[0], lat2 = to[1];
        double phi1 = lat1 * DEG2RAD, phi2 = lat2 * DEG2RAD, dLam = (lon2 - lon1) * DEG2RAD;
        double y = Math.sin(dLam) * Math.cos(phi2);
        double x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
        return (Math.atan2(y, x) / DEG2RAD + 360) % 360;
    }

    // ── 점-다각형 포함 판정 ──────────────────────────────────────────────────
    /** ray-casting: 점이 단일 링 내부인지. ring = double[N][2] ([lng,lat]). */
    public static boolean pointInRing(double[] pt, double[][] ring) {
        double xq = pt[0], yq = pt[1];
        boolean inside = false;
        for (int i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            double xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            boolean intersect = ((yi > yq) != (yj > yq))
                    && (xq < (xj - xi) * (yq - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    /** polygon = ring[0]=외곽, ring[1..]=구멍. 외곽 안 && 구멍 밖. */
    public static boolean pointInPolygon(double[] pt, double[][][] polygon) {
        if (polygon == null || polygon.length == 0) return false;
        if (!pointInRing(pt, polygon[0])) return false;
        for (int h = 1; h < polygon.length; h++) {
            if (pointInRing(pt, polygon[h])) return false; // 구멍(섬) 안 → 제외
        }
        return true;
    }

    /** Polygon/MultiPolygon geometry 안에 점이 있는지(구멍 반영). */
    public static boolean pointInGeometry(double[] pt, Geometry geom) {
        if (geom == null) return false;
        for (double[][][] poly : geom.polygons) {
            if (pointInPolygon(pt, poly)) return true;
        }
        return false;
    }

    // ── 점-선분 최단거리(평면 근사; 위도 보정) ──────────────────────────────
    private static double scaleKx(double lat) { return Math.cos(lat * DEG2RAD); }

    /** 점 pt 에서 선분 a-b 까지 최단점(근사). 반환 [lng,lat]. */
    public static double[] closestPointOnSegment(double[] pt, double[] a, double[] b) {
        double lat0 = pt[1];
        double kx = scaleKx(lat0);
        double px = pt[0] * kx, py = pt[1];
        double ax = a[0] * kx, ay = a[1], bx = b[0] * kx, by = b[1];
        double dx = bx - ax, dy = by - ay;
        double len2 = dx * dx + dy * dy;
        double t = (len2 == 0) ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        double cx = ax + t * dx, cy = ay + t * dy;
        return new double[] { cx / kx, cy };
    }

    /** geometry 외곽선들 위에서 pt 에 가장 가까운 점 + 미터거리. (구멍 무시: 진입은 외곽) */
    public static NearPoint nearestPointOnGeometry(double[] pt, Geometry geom) {
        double[] best = null;
        double bestD = Double.POSITIVE_INFINITY;
        for (double[][][] poly : geom.polygons) {
            double[][] ext = poly[0];
            for (int i = 0; i < ext.length - 1; i++) {
                double[] c = closestPointOnSegment(pt, ext[i], ext[i + 1]);
                double d = haversineMeters(pt, c);
                if (d < bestD) { bestD = d; best = c; }
            }
        }
        if (best == null) return null;
        return new NearPoint(best, bestD);
    }

    // ── 섬 구멍이 반영된 geometry 선택 ──────────────────────────────────────
    /** _holedGeometry 우선, 없으면 geometry. (Feature 에 미리 계산되어 있음) */
    public static Geometry seaGeometry(Feature f) {
        return f.holed != null ? f.holed : f.solid;
    }

    // ── 구역 판정 ───────────────────────────────────────────────────────────
    /**
     * 현재 위치가 속한 특보구역 feature 를 찾음(섬 제외).
     * GPS 오차(accuracyM) 반영: 구역 안이지만 외곽 경계까지 오차보다 가까우면 grayZone=true.
     * @return null 이면 어느 바다 구역에도 없음.
     */
    public static Located locateZone(double[] pt, List<Feature> features, double accuracyM) {
        for (Feature f : features) {
            Geometry geom = seaGeometry(f);
            if (pointInGeometry(pt, geom)) {
                NearPoint edge = nearestPointOnGeometry(pt, f.solid); // 외곽까지 거리
                double margin = accuracyM;
                boolean grayZone = edge != null && edge.distM < margin;
                return new Located(f, grayZone);
            }
        }
        return null;
    }

    // ── 최근접 대상 구역 ────────────────────────────────────────────────────
    public interface FeaturePredicate { boolean test(Feature f); }

    /**
     * predicate(true)인 구역들 중 pt 에서 가장 가까운 구역 + 방위/거리/경로 육지여부.
     */
    public static Target nearestZoneBy(double[] pt, List<Feature> features, FeaturePredicate predicate) {
        Feature bestF = null;
        NearPoint bestNp = null;
        for (Feature f : features) {
            if (!predicate.test(f)) continue;
            NearPoint np = nearestPointOnGeometry(pt, f.solid);
            if (np == null) continue;
            if (bestNp == null || np.distM < bestNp.distM) { bestF = f; bestNp = np; }
        }
        if (bestF == null) return null;
        Target t = new Target();
        t.name = bestF.name;
        t.warnCode = bestF.warnCode;
        t.bearing = (int) Math.round(bearingDeg(pt, bestNp.point));
        t.distM = bestNp.distM;
        t.distNm = bestNp.distM / NM_M;
        t.landOnPath = segmentCrossesLand(pt, bestNp.point, features, 24);
        return t;
    }

    /**
     * 직선 경로 p→q 가 육지·섬을 가로지르는지(개략). 표본점이 어느 바다 구역에도
     * 속하지 않으면 육지/섬으로 간주. JS segmentCrossesLand 와 동일(기본 N=24, i: 3..N-3).
     */
    public static boolean segmentCrossesLand(double[] p, double[] q, List<Feature> features, int samples) {
        int n = samples;
        double[] a = p, b = q;
        for (int i = 3; i <= n - 3; i++) {
            double t = (double) i / n;
            double[] s = new double[] { a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t };
            boolean inSea = false;
            for (Feature f : features) {
                if (pointInGeometry(s, seaGeometry(f))) { inSea = true; break; }
            }
            if (!inSea) return true;
        }
        return false;
    }

    // ── 특보 등급 분류 ──────────────────────────────────────────────────────
    /** warnings: [{type, level}]. 'severe'|'advisory'|'prelim'|'none'. JS classifyTier 와 동일. */
    public static String classifyTier(List<String[]> warnings) {
        if (warnings == null || warnings.isEmpty()) return "none";
        String tier = "none";
        for (String[] w : warnings) {
            String type = w[0], level = w[1];
            String t = "none";
            if ("예비".equals(level)) t = "prelim";
            else if ("태풍".equals(type)) t = "severe";
            else if ("경보".equals(level)) t = "severe";
            else if ("주의보".equals(level)) t = "advisory";
            if (rank(t) > rank(tier)) tier = t;
        }
        return tier;
    }

    private static int rank(String tier) {
        switch (tier) {
            case "severe": return 3;
            case "advisory": return 2;
            case "prelim": return 1;
            default: return 0;
        }
    }

    // ── 문구 생성 ───────────────────────────────────────────────────────────
    /** JS fmtNm: 10해리 미만 소수1, 이상 정수. */
    public static String fmtNm(double nm) {
        if (nm < 10) {
            return String.format(java.util.Locale.US, "%.1f해리", nm);
        }
        return Math.round(nm) + "해리";
    }

    private static String targetLine(String label, Target t) {
        return "🧭 " + label + " : " + t.name + " " + t.bearing + "° - " + fmtNm(t.distNm);
    }

    private static String footer(Target[] targets) {
        boolean land = false;
        for (Target t : targets) {
            if (t != null && t.landOnPath) { land = true; break; }
        }
        return land
                ? "⚠️ 경로상 육지·섬이 있으니 항행 장애물에 유의하여 항행하세요."
                : "🌊 항행 안전에 유의하여 항행하세요.";
    }

    /** 상황별 푸시 {title, body}. JS buildMessage 와 글자 단위로 동일. */
    public static Message buildMessage(MessageCtx ctx) {
        String z = ctx.zoneName;
        String wt = (ctx.warnType != null && !ctx.warnType.isEmpty()) ? ctx.warnType : "풍랑";

        if ("prelim".equals(ctx.tier)) {
            String title = "📍 [위치기반 안전정보] " + z + " " + wt + " 예비특보 발표";
            String timeText = (ctx.timeText != null && !ctx.timeText.isEmpty()) ? ctx.timeText : "미정";
            String body = "현재 위치하신 해역에 " + wt + " 예비특보가 발표되었습니다.\n"
                    + "🕒 발효 예정시각 : " + timeText + "\n"
                    + "기상이 악화될 가능성이 있으니, 현지 해상·기상 상황을 살피고 안전에 유의하세요.";
            return new Message(title, body);
        }

        if ("advisory".equals(ctx.tier)) {
            String verbTitle = "active".equals(ctx.event) ? "발효" : "발효 예정";
            String tText = ctx.timeText != null ? ctx.timeText : "";
            String sent = "active".equals(ctx.event)
                    ? "현재 위치하신 해역에 " + wt + "주의보가 발효 중입니다."
                    : "현재 위치하신 해역에 " + wt + "주의보가 " + tText + " 발효 예정입니다.";
            List<String> lines = new ArrayList<>();
            lines.add(sent);
            lines.add("발효 시 선박 톤수·운항 시기, 수상레저 종사 여부 등에 따라 조업·활동이 제한될 수 있으니 안전한 해역으로 이동을 고려하세요.");
            if (ctx.nearestClear != null) lines.add(targetLine("최근접 특보 미발표 해역", ctx.nearestClear));
            lines.add(footer(new Target[] { ctx.nearestClear }));
            String title = "📍 [위치기반 안전정보] " + z + " " + wt + "주의보 " + verbTitle;
            return new Message(title, join(lines));
        }

        // severe (경보·태풍)
        String verbTitle = "active".equals(ctx.event) ? "발효" : "발표";
        List<String> lines = new ArrayList<>();
        if ("active".equals(ctx.event)) {
            lines.add("현재 위치하신 해역은 조업 및 해상활동이 전면 제한되는 구역입니다.");
            lines.add("즉시 안전한 해역·항포구로 이동하세요.");
        } else {
            String tText = ctx.timeText != null ? ctx.timeText : "";
            lines.add("현재 위치하신 해역에 " + wt + "경보가 " + tText + " 발효 예정입니다.");
            lines.add("해당 해역에서 조업 및 해상활동이 전면 제한되므로 즉시 안전한 해역·항포구로 이동하세요.");
        }
        if (ctx.nearestClear != null) lines.add(targetLine("최근접 특보 미발표 해역", ctx.nearestClear));
        if (ctx.nearestLower != null
                && (ctx.nearestClear == null || !ctx.nearestLower.name.equals(ctx.nearestClear.name))) {
            lines.add(targetLine("최근접 주의보·예비특보 해역", ctx.nearestLower));
        }
        lines.add(footer(new Target[] { ctx.nearestClear, ctx.nearestLower }));
        String title = "📍 [위치기반 긴급경보🚨] " + z + " " + wt + "경보 " + verbTitle;
        return new Message(title, join(lines));
    }

    private static String join(List<String> lines) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.size(); i++) {
            if (i > 0) sb.append('\n');
            sb.append(lines.get(i));
        }
        return sb.toString();
    }

    // ════════════════════════════════════════════════════════════════════════
    //  GeoJSON 파싱 + 데이터 구조
    // ════════════════════════════════════════════════════════════════════════

    /** geometry: Polygon/MultiPolygon 을 폴리곤 리스트로 정규화. polygons[k] = ring[][2]. */
    public static final class Geometry {
        public final double[][][][] polygons; // [poly][ring][pt][2]
        Geometry(double[][][][] polygons) { this.polygons = polygons; }
    }

    public static final class Feature {
        public String name;
        public String warnCode;
        public Geometry solid;  // properties.geometry (외곽 거리/경로 판정용)
        public Geometry holed;  // properties._holedGeometry (포함 판정용; null 가능)
    }

    public static final class NearPoint {
        public final double[] point; // [lng,lat]
        public final double distM;
        NearPoint(double[] point, double distM) { this.point = point; this.distM = distM; }
    }

    public static final class Located {
        public final Feature feature;
        public final boolean grayZone;
        Located(Feature feature, boolean grayZone) { this.feature = feature; this.grayZone = grayZone; }
    }

    public static final class Target {
        public String name;
        public String warnCode;
        public int bearing;
        public double distM;
        public double distNm;
        public boolean landOnPath;
    }

    public static final class Message {
        public final String title;
        public final String body;
        Message(String title, String body) { this.title = title; this.body = body; }
    }

    public static final class MessageCtx {
        public String zoneName;
        public String warnType;
        public String tier;
        public String event;
        public String timeText;
        public Target nearestClear;
        public Target nearestLower;
    }

    /** FeatureCollection JSON → List<Feature>. _holedGeometry 우선, 없으면 null. */
    public static List<Feature> parseFeatureCollection(JSONObject root) throws JSONException {
        List<Feature> out = new ArrayList<>();
        JSONArray feats = root.optJSONArray("features");
        if (feats == null) return out;
        for (int i = 0; i < feats.length(); i++) {
            JSONObject fo = feats.optJSONObject(i);
            if (fo == null) continue;
            JSONObject props = fo.optJSONObject("properties");
            if (props == null) continue;
            Feature f = new Feature();
            f.name = props.optString("name", null);
            f.warnCode = props.optString("WarnCode", null);
            JSONObject geomObj = fo.optJSONObject("geometry");
            f.solid = geomObj != null ? parseGeometry(geomObj) : null;
            JSONObject holedObj = props.optJSONObject("_holedGeometry");
            f.holed = holedObj != null ? parseGeometry(holedObj) : null;
            if (f.solid == null && f.holed != null) f.solid = f.holed;
            out.add(f);
        }
        return out;
    }

    private static Geometry parseGeometry(JSONObject geom) throws JSONException {
        String type = geom.optString("type", "");
        JSONArray coords = geom.optJSONArray("coordinates");
        if (coords == null) return new Geometry(new double[0][][][]);
        List<double[][][]> polys = new ArrayList<>();
        if ("Polygon".equals(type)) {
            polys.add(parsePolygon(coords));
        } else if ("MultiPolygon".equals(type)) {
            for (int i = 0; i < coords.length(); i++) {
                polys.add(parsePolygon(coords.optJSONArray(i)));
            }
        }
        return new Geometry(polys.toArray(new double[0][][][]));
    }

    /** polygon coordinates = [ring, ...], ring = [[lng,lat], ...]. */
    private static double[][][] parsePolygon(JSONArray polyCoords) throws JSONException {
        if (polyCoords == null) return new double[0][][];
        double[][][] rings = new double[polyCoords.length()][][];
        for (int r = 0; r < polyCoords.length(); r++) {
            JSONArray ring = polyCoords.optJSONArray(r);
            int n = ring == null ? 0 : ring.length();
            double[][] pts = new double[n][2];
            for (int k = 0; k < n; k++) {
                JSONArray pt = ring.optJSONArray(k);
                pts[k][0] = pt.optDouble(0);
                pts[k][1] = pt.optDouble(1);
            }
            rings[r] = pts;
        }
        return rings;
    }
}
