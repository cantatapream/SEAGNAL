package com.seagnal.app.locationalert;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * TyphoonRadiusDecider — local_server/services/typhoon_radius.js +
 *   local_server/services/typhoon_message.js +
 *   local_server/js/location_alert_typhoon_runtime.js 의 네이티브(Java) 포팅.
 *
 * [목적]
 *   앱이 완전 종료(killed)된 상태에서 'typhoon_radius_wake' FCM 데이터 메시지를 받았을 때,
 *   그 순간 위치(LocationAlertLocator.getFresh) + 공개 /api/typhoon 데이터로 "내 위치가
 *   각 태풍의 (비대칭) 폭풍/강풍반경에 언제 처음 드는지"를 단말에서 직접 계산하고, JS 와
 *   글자/숫자 단위로 동일한 제목/본문/딥링크를 만든다.
 *
 * [완전 on-device 판정] 좌표는 단말 밖으로 나가지 않는다. /api/typhoon(공개)만 네트워크로 조회.
 *
 * JS 원본과 1:1 대응:
 *   typhoon_radius.js : DIR16_DEG, dirToDeg, angDiff, radAt, haversineKm, bearingDeg,
 *                       timeKey(정렬), radiusEntry.
 *   typhoon_runtime.js: framesOf, decideTyphoonAlerts, notifIdForSeq(=notifId).
 *   typhoon_message.js: formatTyphoonNumber, formatKstTime, pureName, namePhrase,
 *                       buildRadiusAlert, buildDemoUrl, TYPHOON_DEEPLINK_URL.
 *
 * 순수/정적 메서드만. org.json + java.* 외 의존성 없음. 모든 파싱 try/catch 방어(불량 → skip).
 */
public final class TyphoonRadiusDecider {

    private TyphoonRadiusDecider() { }

    // ── typhoon_message.js 상수 ───────────────────────────────────────────────
    /** 알림 탭 시 이동할 기본 딥링크(태풍 레이어 ON). typhoon_message.js TYPHOON_DEEPLINK_URL 과 동일. */
    public static final String TYPHOON_DEEPLINK_URL = "/?assistant=ocean&layer=typhoon";

    // ===========================================================================
    // typhoon_radius.js 포팅 — (비대칭) 반경 진입 판정
    // ===========================================================================

    /** 16방위 → 각도(deg). typhoon_radius.js DIR16_DEG 와 동일. 미지/null → null. */
    static Double dirToDeg(String d) {
        if (d == null) return null;
        String k = d.trim().toUpperCase(java.util.Locale.US);
        switch (k) {
            case "N":   return 0.0;
            case "NNE": return 22.5;
            case "NE":  return 45.0;
            case "ENE": return 67.5;
            case "E":   return 90.0;
            case "ESE": return 112.5;
            case "SE":  return 135.0;
            case "SSE": return 157.5;
            case "S":   return 180.0;
            case "SSW": return 202.5;
            case "SW":  return 225.0;
            case "WSW": return 247.5;
            case "W":   return 270.0;
            case "WNW": return 292.5;
            case "NW":  return 315.0;
            case "NNW": return 337.5;
            default:    return null;
        }
    }

    /** 두 방위(deg)의 최소 각도 차(0~180). JS angDiff 와 동일. */
    static double angDiff(double a, double b) {
        double x = Math.abs(a - b) % 360;
        return x > 180 ? 360 - x : x;
    }

    /**
     * 방위(brngDeg)에서의 (비대칭) 반경 — ed(가항측,0°)→rShort, 반대(위험측,180°)→rLong 코사인 보간.
     * JS radAt 와 동일: edDeg null / rShort null / rShort<=0 / rShort>=rLong 이면 rLong 그대로.
     */
    static double radAt(double rLong, Double rShort, Double edDeg, double brngDeg) {
        if (edDeg == null || rShort == null || !(rShort > 0) || rShort >= rLong) return rLong;
        double s = (1 - Math.cos(Math.PI * angDiff(brngDeg, edDeg) / 180)) / 2; // 0..1 S-커브
        return rShort + (rLong - rShort) * s;
    }

    /** 하버사인 거리(km). JS haversineKm 와 동일(R=6371.0088). */
    static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
        double R = 6371.0088;
        double dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    /** 초기 방위각(deg, 0~360): from(lat1,lon1) → to(lat2,lon2). JS bearingDeg 와 동일. */
    static double bearingDeg(double lat1, double lon1, double lat2, double lon2) {
        double la1 = toRad(lat1), la2 = toRad(lat2), dLon = toRad(lon2 - lon1);
        double y = Math.sin(dLon) * Math.cos(la2);
        double x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    private static double toRad(double x) { return x * Math.PI / 180; }

    /** 시각 문자열("YYYYMMDDHHmm") → 정렬용 정수(숫자만). JS timeKey 와 동일. 비어있으면 NaN(=null 반환). */
    static Double timeKey(String t) {
        String s = (t == null ? "" : t).replaceAll("[^0-9]", "");
        if (s.isEmpty()) return null;            // JS 의 NaN 대응(정렬 시 뒤로 보냄)
        try { return Double.valueOf(Double.parseDouble(s)); }
        catch (Exception e) { return null; }
    }

    /** radiusEntry 입력/출력 프레임(time + 좌표 + 강풍/폭풍 반경). */
    public static final class Frame {
        public String time;
        public double lat, lon;
        public Double radStrong, radStrongS;
        public String radStrongD;
        public Double radStorm, radStormS;
        public String radStormD;
    }

    /**
     * 가장 이른 (강풍/폭풍)반경 진입 프레임을 찾는다. JS radiusEntry 와 동일.
     * @param loc {lat,lon}
     * @param frames 통보문 프레임들
     * @param which "storm" | "strong"
     * @return 진입 프레임 | null
     */
    public static Frame radiusEntry(double[] loc, List<Frame> frames, String which) {
        if (loc == null || loc.length < 2) return null;
        // JS: typeof lat/lon !== 'number' → null. NaN/Infinity 방어.
        if (!isFiniteNum(loc[0]) || !isFiniteNum(loc[1])) return null;
        if (frames == null || frames.isEmpty()) return null;

        final boolean storm = "storm".equals(which);

        // time(문자열 YYYYMMDDHHmm) 오름차순 정렬 — 비파괴 복사 후 정렬(NaN/null 은 뒤로).
        List<Frame> sorted = new ArrayList<>(frames);
        Collections.sort(sorted, new Comparator<Frame>() {
            @Override public int compare(Frame a, Frame b) {
                Double ta = timeKey(a == null ? null : a.time);
                Double tb = timeKey(b == null ? null : b.time);
                if (ta == null && tb == null) return 0;
                if (ta == null) return 1;
                if (tb == null) return -1;
                return Double.compare(ta, tb);
            }
        });

        for (Frame f : sorted) {
            if (f == null) continue;
            Double rLong = storm ? f.radStorm : f.radStrong;
            if (rLong == null || !(rLong > 0)) continue; // 반경 없으면 판정 불가
            Double rShort = storm ? f.radStormS : f.radStrongS;
            Double edDeg = dirToDeg(storm ? f.radStormD : f.radStrongD);
            double dist = haversineKm(f.lat, f.lon, loc[0], loc[1]);
            double brng = bearingDeg(f.lat, f.lon, loc[0], loc[1]);
            double r = radAt(rLong, rShort, edDeg, brng);
            if (r >= dist) return f;
        }
        return null;
    }

    private static boolean isFiniteNum(double d) { return !Double.isNaN(d) && !Double.isInfinite(d); }

    // ===========================================================================
    // location_alert_typhoon_runtime.js 포팅 — framesOf / decideTyphoonAlerts / notifId
    // ===========================================================================

    /**
     * 한 태풍의 최신 통보문에서 radiusEntry 입력용 프레임 배열을 만든다. JS framesOf 와 동일.
     *   - 최신 통보문 선택: isLatest===true 우선, 없으면 0번.
     *   - current + forecast 프레임을 모으고, lat/lon(lng→lon 폴백) 유한값만 채택.
     */
    static List<Frame> framesOf(JSONObject typhoon) {
        List<Frame> out = new ArrayList<>();
        if (typhoon == null) return out;
        JSONArray bulletins = typhoon.optJSONArray("bulletins");
        if (bulletins == null || bulletins.length() == 0) return out;

        JSONObject b = null;
        for (int i = 0; i < bulletins.length(); i++) {
            JSONObject bi = bulletins.optJSONObject(i);
            if (bi != null && bi.optBoolean("isLatest", false)) { b = bi; break; }
        }
        if (b == null) b = bulletins.optJSONObject(0);
        if (b == null) return out;

        List<JSONObject> raw = new ArrayList<>();
        JSONObject cur = b.optJSONObject("current");
        if (cur != null) raw.add(cur);
        JSONArray fc = b.optJSONArray("forecast");
        if (fc != null) {
            for (int i = 0; i < fc.length(); i++) {
                JSONObject f = fc.optJSONObject(i);
                if (f != null) raw.add(f);
            }
        }

        for (JSONObject f : raw) {
            double lat = numOr(f, "lat", Double.NaN);
            double lon = numOr(f, "lon", Double.NaN);
            if (Double.isNaN(lon)) lon = numOr(f, "lng", Double.NaN); // lng→lon 폴백
            if (!isFiniteNum(lat) || !isFiniteNum(lon)) continue;
            Frame fr = new Frame();
            fr.time = f.isNull("time") ? null : f.optString("time", null);
            fr.lat = lat;
            fr.lon = lon;
            fr.radStrong  = optNum(f, "radStrong");
            fr.radStrongS = optNum(f, "radStrongS");
            fr.radStrongD = optStr(f, "radStrongD");
            fr.radStorm   = optNum(f, "radStorm");
            fr.radStormS  = optNum(f, "radStormS");
            fr.radStormD  = optStr(f, "radStormD");
            out.add(fr);
        }
        return out;
    }

    /** 한 태풍 판정 결과(seq/이름/코드/연도/which/etaTmFc + 메시지 빌더 입력 snap). */
    public static final class Alert {
        public String seq;
        public String name;
        public String nameEn;
        public String code;
        public String year;
        public String which;     // "storm" | "strong"
        public String etaTmFc;   // 진입 프레임 time
    }

    /**
     * 내 위치 + 활성 태풍들 → 진입한 태풍마다 1건. JS decideTyphoonAlerts 와 동일.
     *   각 태풍: 폭풍(storm) 우선, 없으면 강풍(strong). 둘 다 없으면 skip(earliest-only 아님).
     * @param fallbackYear 태풍 객체에 year 가 없을 때 폴백(=/api/typhoon 최상위 year). null 가능.
     *   JS _refOfTyphoon 의 year: (t.year != null) ? t.year : (root.__typhoonYear ?? '') 대응.
     */
    public static List<Alert> decideTyphoonAlerts(double[] loc, JSONArray typhoons, String fallbackYear) {
        List<Alert> out = new ArrayList<>();
        if (loc == null || loc.length < 2 || !isFiniteNum(loc[0]) || !isFiniteNum(loc[1])) return out;
        if (typhoons == null) return out;

        for (int i = 0; i < typhoons.length(); i++) {
            JSONObject t = typhoons.optJSONObject(i);
            if (t == null) continue;
            List<Frame> frames = framesOf(t);
            if (frames.isEmpty()) continue;
            String which = "storm";
            Frame entry = radiusEntry(loc, frames, "storm");
            if (entry == null) { which = "strong"; entry = radiusEntry(loc, frames, "strong"); }
            if (entry == null) continue; // 어느 반경에도 안 들면 skip

            Alert a = new Alert();
            a.seq = strOrNull(t, "seq");
            a.name = strOrNull(t, "name");
            a.nameEn = strOrNull(t, "nameEn");
            // year: 태풍 객체 우선 → 최상위 폴백 → 그래도 없으면 "" (JS _refOfTyphoon 동일).
            String yr = strOrNull(t, "year");
            a.year = (yr != null && !yr.isEmpty()) ? yr : (fallbackYear != null ? fallbackYear : "");
            a.code = latestBulletinCode(t);
            a.which = which;
            a.etaTmFc = entry.time;
            out.add(a);
        }
        return out;
    }

    /** 하위호환 오버로드 — fallbackYear 미지정(=태풍 객체 year 만, 폴백 없음). */
    public static List<Alert> decideTyphoonAlerts(double[] loc, JSONArray typhoons) {
        return decideTyphoonAlerts(loc, typhoons, null);
    }

    /** 최신 통보문의 code(딥링크 식별자). JS _refOfTyphoon 의 code 추출과 동일. */
    private static String latestBulletinCode(JSONObject t) {
        JSONArray bulletins = t.optJSONArray("bulletins");
        if (bulletins == null || bulletins.length() == 0) return null;
        JSONObject b = null;
        for (int i = 0; i < bulletins.length(); i++) {
            JSONObject bi = bulletins.optJSONObject(i);
            if (bi != null && bi.optBoolean("isLatest", false)) { b = bi; break; }
        }
        if (b == null) b = bulletins.optJSONObject(0);
        return b == null ? null : strOrNull(b, "code");
    }

    /**
     * seq → 안정적(태풍별 고유) 32-bit 양의 정수 알림 id. JS notifIdForSeq 와 동일.
     *   같은 태풍은 같은 id(중복 표출 방지). 700000000 베이스(특보/일반 알림 id 와 충돌 회피).
     *   JS: h = (h*31 + charCode) | 0; (Math.abs(h) % 1000000) + 700000000.
     */
    public static int notifId(String seq) {
        String s = (seq == null ? "" : seq);
        int h = 0;
        for (int i = 0; i < s.length(); i++) {
            h = (h * 31 + s.charAt(i)); // Java int 는 이미 32-bit 랩어라운드 = JS '| 0'.
        }
        long abs = Math.abs((long) h);   // JS Math.abs(h): h=Integer.MIN_VALUE 케이스 방어.
        return (int) (abs % 1000000) + 700000000;
    }

    // ===========================================================================
    // typhoon_message.js 포팅 — 제목/본문/딥링크
    // ===========================================================================

    /** 태풍 호수를 "제N호 " 접두로. 1~40 아니면 "". JS formatTyphoonNumber 와 동일. */
    static String formatTyphoonNumber(String seq) {
        String digits = (seq == null ? "" : seq).replaceAll("[^0-9]", "");
        if (digits.isEmpty()) return "";
        try {
            int n = Integer.parseInt(digits);
            return (n >= 1 && n <= 40) ? ("제" + n + "호 ") : "";
        } catch (Exception e) { return ""; }
    }

    /** "YYYYMMDDHHmm" → "M월 D일 H시". 형식 어긋나면 "". JS formatKstTime 와 동일. */
    static String formatKstTime(String yyyymmddhhmm) {
        String s = (yyyymmddhhmm == null ? "" : yyyymmddhhmm).replaceAll("[^0-9]", "");
        if (s.length() < 12) return "";
        int mo, d, h;
        try {
            mo = Integer.parseInt(s.substring(4, 6));
            d = Integer.parseInt(s.substring(6, 8));
            h = Integer.parseInt(s.substring(8, 10));
        } catch (Exception e) { return ""; }
        if (mo == 0 || d == 0) return ""; // JS: if (!mo || !d) return ''
        return mo + "월 " + d + "일 " + h + "시";
    }

    /** "제 N호 " 접두 제거. JS pureName 과 동일. */
    static String pureName(String name) {
        return (name == null ? "" : name).replaceFirst("^제\\s*\\d+\\s*호\\s*", "").trim();
    }

    /** "태풍 'OO'" 의 따옴표 이름 조각. 이름 없으면 "". JS namePhrase 와 동일. */
    static String namePhrase(String name, String nameEn) {
        String n = pureName(name);
        if (n.isEmpty()) n = (nameEn == null ? "" : nameEn).trim();
        return n.isEmpty() ? "" : (" '" + n + "'");
    }

    /** 제목/본문 묶음(JS buildRadiusAlert 출력 형태). */
    public static final class RadiusMessage {
        public final String title, body;
        RadiusMessage(String title, String body) { this.title = title; this.body = body; }
    }

    /**
     * [위치기반 반경] 강풍/폭풍반경 접근 긴급경보 문구. JS buildRadiusAlert 와 글자 단위 동일.
     * @param which "storm" | "strong"
     */
    public static RadiusMessage buildRadiusAlert(String which, String seq, String name, String nameEn, String etaTmFc) {
        String num = formatTyphoonNumber(seq);
        String np = namePhrase(name, nameEn);
        String when = formatKstTime(etaTmFc);
        String etaText = when + "경";
        if ("storm".equals(which)) {
            return new RadiusMessage(
                "📍 [위치기반 긴급경보🚨] " + num + "태풍" + np + " 폭풍반경 접근",
                "현재 위치하신 지역이 " + etaText + " 폭풍반경에 들 것으로 예상됩니다.\n"
                    + "폭풍반경에 해당될 경우 매우 위험하므로 행동요령에 따라 사전 안전점검 등 조치 바랍니다.\n"
                    + "이 알림을 누르면 행동요령 및 태풍 상세정보를 확인할 수 있습니다.");
        }
        return new RadiusMessage(
            "📍 [위치기반 긴급경보🚨] " + num + "태풍" + np + " 강풍반경 접근",
            "현재 위치하신 지역이 " + etaText + " 강풍반경에 들 것으로 예상됩니다.\n"
                + "강풍 대비 행동요령에 따라 사전 안전점검이 필요합니다.\n"
                + "이 알림을 누르면 행동요령 및 태풍 상세정보를 확인할 수 있습니다.");
    }

    /**
     * 탭 시 실제 통보문 표출 + 행동요령(2탭) 자동 표출 딥링크. JS buildDemoUrl(ref{...,guide:true}) 와 동일.
     *   code 없으면 일반 태풍 딥링크. guide=true 면 끝에 &dtGuide=1.
     */
    public static String buildDemoUrl(String year, String seq, String code, boolean guide) {
        if (code == null || code.isEmpty()) return TYPHOON_DEEPLINK_URL;
        return TYPHOON_DEEPLINK_URL
            + "&demoTphn=1"
            + "&dtYear=" + enc(year)
            + "&dtSeq=" + enc(seq)
            + "&dtCode=" + enc(code)
            + (guide ? "&dtGuide=1" : "");
    }

    /**
     * JS encodeURIComponent(x != null ? x : '') 동등. null → "".
     *   URLEncoder 는 application/x-www-form-urlencoded 규약(공백→'+', !'()~ 인코딩)이라
     *   JS encodeURIComponent 규약(미인코딩: A-Za-z0-9 - _ . ! ~ * ' ( ))과 차이가 있어 보정한다.
     *   year/seq/code 는 통상 숫자/영숫자라 차이가 드러날 일은 거의 없으나 공백/특수문자 방어.
     */
    private static String enc(String v) {
        String s = (v == null) ? "" : v;
        try {
            String e = java.net.URLEncoder.encode(s, "UTF-8");
            return e.replace("+", "%20")
                    .replace("%21", "!")
                    .replace("%27", "'")
                    .replace("%28", "(")
                    .replace("%29", ")")
                    .replace("%7E", "~");
            // URLEncoder 는 '*' 를 인코딩하지 않음(JS encodeURIComponent 도 '*' 미인코딩) → 보정 불필요.
        } catch (Exception ex) {
            return s;
        }
    }

    // ── org.json 안전 추출 헬퍼 ───────────────────────────────────────────────

    /** 숫자(Double) — 숫자/숫자형 문자열 모두 허용. 없거나 불가 → null(JS != null 폴백 대응). */
    private static Double optNum(JSONObject o, String key) {
        if (o == null || !o.has(key) || o.isNull(key)) return null;
        Object v = o.opt(key);
        if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            return isFiniteNum(d) ? Double.valueOf(d) : null;
        }
        if (v instanceof String) {
            String s = ((String) v).trim();
            if (s.isEmpty()) return null;
            try {
                double d = Double.parseDouble(s);
                return isFiniteNum(d) ? Double.valueOf(d) : null;
            } catch (Exception e) { return null; }
        }
        return null;
    }

    /** numOr — optNum 결과를 기본값으로(framesOf lat/lon 용). */
    private static double numOr(JSONObject o, String key, double dflt) {
        Double d = optNum(o, key);
        return d == null ? dflt : d;
    }

    /** 문자열(방위 등) — 없거나 null → null. */
    private static String optStr(JSONObject o, String key) {
        if (o == null || !o.has(key) || o.isNull(key)) return null;
        return o.optString(key, null);
    }

    /** seq/name/code 등 식별값 — 숫자여도 문자열로(JS String(seq) 대응). null/없음 → null. */
    private static String strOrNull(JSONObject o, String key) {
        if (o == null || !o.has(key) || o.isNull(key)) return null;
        Object v = o.opt(key);
        if (v == null) return null;
        if (v instanceof Number) {
            // 정수면 소수점 없이(예: 6 → "6"). JS String(6)==="6".
            double d = ((Number) v).doubleValue();
            if (d == Math.floor(d) && !Double.isInfinite(d)) return String.valueOf((long) d);
            return String.valueOf(d);
        }
        String s = String.valueOf(v);
        return s.isEmpty() ? null : s;
    }
}
