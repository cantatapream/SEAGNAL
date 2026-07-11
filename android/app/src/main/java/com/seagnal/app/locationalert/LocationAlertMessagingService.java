package com.seagnal.app.locationalert;

import android.content.Context;
import android.util.Log;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;
import java.util.Map;

/**
 * LocationAlertMessagingService — 앱 완전 종료(killed) 상태에서도 위치기반 해상특보를
 * 네이티브가 직접 처리하기 위한 FCM 수신 서비스.
 *
 * [공존 전략 — 기존 푸시 불파괴]
 *   @capacitor/push-notifications 의 서비스(com.capacitorjs.plugins.pushnotifications.
 *   MessagingService)를 그대로 상속한다. FirebaseMessagingService 는 앱당 하나만
 *   메시지를 받으므로, 매니페스트에서 라이브러리 서비스를 제거(tools:node="remove")하고
 *   이 서비스를 firebase MESSAGING_EVENT 로 등록한다.
 *   onMessageReceived 에서:
 *     1) data.type == 'location_alert_wake' 이면 네이티브로 직접 판정/알림(killed 대응)
 *     2) 항상 super.onMessageReceived(...) 호출 → 기존 Capacitor 푸시 경로 그대로 유지
 *        (앱 켜짐 시 pushNotificationReceived JS 리스너, 일반 알림 표시, onNewToken 등록 등)
 *   onNewToken 도 super 호출만 하면 기존 토큰 등록 흐름이 보존된다.
 *
 * [완전 on-device] 위치/판정은 단말 안에서만. 네트워크 전송 0.
 */
public class LocationAlertMessagingService extends MessagingService {

    private static final String TAG = "LocationAlertFCM";
    private static final String WAKE_TYPE = "location_alert_wake";
    private static final String TYPHOON_WAKE_TYPE = "typhoon_radius_wake";

    // #3 저장 위치를 "낡음"으로 보는 임계(기본 12시간). 튜닝 가능. JS STALE_MAX_MS 와 동일.
    private static final long STALE_MAX_MS = 12L * 60L * 60L * 1000L;

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        // 1) 위치기반 깨우기 신호면 네이티브가 직접 처리(켜짐/백그라운드/종료 모두에서 안전).
        //    앱이 켜져 있을 땐 super 가 JS 로도 전달하므로, 동일 메시지를 양쪽에서 처리하지
        //    않도록 — 네이티브는 "유효 특보일 때만" 알림을 띄우고, JS handleWake 도 동일 게이팅이라
        //    실제로 둘 다 떠도 동일 1건씩이며, 게이팅 미통과 시 둘 다 안 뜬다.
        //    (중복 헤드업이 우려되면 추후 ProcessLifecycleOwner 로 포그라운드면 native skip 가능.)
        try {
            Map<String, String> data = remoteMessage.getData();
            if (data != null) {
                String type = data.get("type");
                if (WAKE_TYPE.equals(type)) {
                    handleWake(getApplicationContext(), data);
                } else if (TYPHOON_WAKE_TYPE.equals(type)) {
                    // [Phase 2b] 위치기반 태풍 반경 알림 — killed 포함 모든 상태를 네이티브가 처리.
                    handleTyphoonWake(getApplicationContext());
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "wake 처리 실패", t);
        }

        // 2) 기존 Capacitor 푸시 처리 보존(중요): 일반 푸시/포그라운드 리스너/토큰 흐름 유지.
        super.onMessageReceived(remoteMessage);
    }

    /**
     * "마지막 wake 처리" 진단 1건 기록 — {at,src,lat,lng,posAt,outcome,zone}.
     *   알림 여부와 무관하게 handleWake 의 **모든** 종료 경로에서 호출된다(관측 불가 wake 제거).
     *   위치가 없으면 lat/lng=null. 활성/동의 플래그를 요구하지 않는다(disabled-skip 가시화).
     *   완전 on-device — 네트워크 전송 없음. 어떤 실패도 삼킨다(방어적).
     */
    private static void writeLastWake(Context ctx, String outcome, String zone,
            LocationAlertStore.Position pos, boolean isDemo) {
        try {
            JSONObject o = new JSONObject();
            o.put("at", nowIso());
            o.put("src", isDemo ? "demo" : "gps");
            o.put("lat", pos != null ? pos.lat : JSONObject.NULL);
            o.put("lng", pos != null ? pos.lng : JSONObject.NULL);
            o.put("posAt", (pos != null && pos.at != null) ? pos.at : "");
            o.put("outcome", outcome != null ? outcome : "");
            o.put("zone", zone != null ? zone : "");
            LocationAlertStore.putLastWake(ctx, o.toString());
        } catch (Throwable t) {
            Log.w(TAG, "last_wake 기록 실패(무시)", t);
        }
    }

    /** 데이터 메시지(data 맵) → 위치 선택(시연/실제) → 판정 → 네이티브 알림 + 진단 기록. */
    private void handleWake(Context ctx, Map<String, String> data) {
        if (data == null) return;
        String snapshotStr = data.get("snapshot");
        if (snapshotStr == null || snapshotStr.isEmpty()) {
            // 스냅샷 없는 비정상 wake 도 처리 시도로 기록(best-effort).
            writeLastWake(ctx, "suberror", "", null, false);
            return;
        }

        // 게이팅: 활성+동의 플래그가 있을 때만 동작.
        //   ★ skip 전에 last_wake 를 먼저 기록 — 플래그 desync(재설치 등으로 Preferences 유실)로
        //   네이티브가 조용히 skip 하는 상황을 시연 탭에서 볼 수 있게 한다. putLastWake 는
        //   플래그와 무관하게 동작(위치 수집도 하지 않음 — at+outcome 만).
        if (!LocationAlertStore.isEnabled(ctx)) {
            writeLastWake(ctx, "disabled-skip", "", null, false);
            Log.d(TAG, "비활성/미동의 → skip");
            return;
        }

        // 위치 선택: demoLat/demoLng 가 있으면 시연 위치(메시지 동봉) — 실제 저장 위치(POS_KEY) 미사용.
        //   없으면 단말 진짜 백그라운드 GPS(POS_KEY).
        boolean isDemo = false;
        LocationAlertStore.Position pos = null;
        String demoLat = data.get("demoLat");
        String demoLng = data.get("demoLng");
        if (demoLat != null && demoLng != null) {
            try {
                LocationAlertStore.Position dp = new LocationAlertStore.Position();
                dp.lat = Double.parseDouble(demoLat);
                dp.lng = Double.parseDouble(demoLng);
                double acc = 0.0;
                String demoAcc = data.get("demoAcc");
                if (demoAcc != null) {
                    try { acc = Double.parseDouble(demoAcc); } catch (Exception ignore) { acc = 0.0; }
                }
                dp.accuracyM = acc;
                pos = dp;
                isDemo = true;
            } catch (Exception e) {
                Log.w(TAG, "demoPos 파싱 실패 → 실제 위치 사용", e);
                pos = null;
                isDemo = false;
            }
        }
        if (pos == null) {
            // ── 이벤트 기반(2026-06-26): 그 순간 FRESH 위치 1회 수집 ───────────────────
            //   상시 수집을 제거했으므로 wake 시점에 LocationAlertLocator.getFresh()로 직접
            //   픽스를 받는다(활성 단발 픽스 → getLastKnownLocation → 저장 폴백). 좌표는 단말
            //   밖으로 절대 나가지 않음. fresh fix 성공 시 LocationAlertStore.putPosition 으로
            //   저장 캐시·진단을 갱신한다.
            pos = LocationAlertLocator.getFresh(ctx);
        }
        if (pos == null) {
            writeLastWake(ctx, "no-position", "", null, isDemo);
            Log.d(TAG, "위치 없음(fresh fix 실패) → skip");
            return;
        }

        // ── #3 낡음 가드 (실제 GPS 한정, 데모는 절대 적용 안 함) ──────────────────
        //   이벤트 기반 전환 후엔 getFresh()가 직전 시각으로 at 을 스탬프하므로 보통 낡지 않다.
        //   다만 활성 픽스 실패로 getLastKnownLocation/저장 폴백을 쓴 경우 pos.at 이 과거일 수
        //   있어, 12시간(STALE_MAX_MS) 초과면 잘못된 구역 알림을 막는다(진단만 기록 후 종료).
        //   파싱 실패는 "낡지 않음"으로 취급(유효 알림 억제 방지). 완전 방어적.
        if (!isDemo) {
            try {
                long ageMs = ageMillis(pos.at);
                if (ageMs >= 0 && ageMs > STALE_MAX_MS) {
                    try {
                        JSONObject diag = new JSONObject();
                        diag.put("zone", "");
                        diag.put("src", "gps-stale");
                        diag.put("skipped", "stale");
                        diag.put("ageMin", Math.round(ageMs / 60000.0));
                        diag.put("at", nowIso());
                        LocationAlertStore.putLastMatch(ctx, diag.toString());
                    } catch (Throwable t) {
                        Log.w(TAG, "낡음 진단 기록 실패(무시)", t);
                    }
                    writeLastWake(ctx, "stale-skip", "", pos, false);
                    Log.d(TAG, "저장 위치 낡음(12h 초과) → skip");
                    return;
                }
            } catch (Throwable t) {
                Log.w(TAG, "낡음 가드 평가 실패 → 진행", t);
            }
        }

        List<LocationAlertCore.Feature> features = WarnZoneAssets.load(ctx);
        if (features.isEmpty()) {
            writeLastWake(ctx, "suberror", "", pos, isDemo);
            Log.w(TAG, "번들 폴리곤 로드 실패 → skip");
            return;
        }

        try {
            JSONObject snapshot = new JSONObject(snapshotStr);
            // 진단 오버로드 — 무표출(null) 사유(off-sea/no-warning)를 last_wake 에 남긴다.
            //   판정 로직·반환 계약은 기존 5-인자와 완전히 동일.
            LocationAlertDecider.Diag dg = new LocationAlertDecider.Diag();
            LocationAlertCore.Message msg = LocationAlertDecider.decideAlert(
                    pos.lat, pos.lng, pos.accuracyM, features, snapshot, dg);
            if (msg != null) {
                // 진단 기록(단말 로컬에만 — 네트워크 전송 없음). 완전 방어적.
                //   last_match 는 기존 그대로 "마지막 성공 판정"만 기록(의미 불변).
                try {
                    JSONObject diag = new JSONObject();
                    diag.put("zone", msg.zone != null ? msg.zone : "");
                    diag.put("lat", pos.lat);
                    diag.put("lng", pos.lng);
                    diag.put("src", isDemo ? "demo" : "gps");
                    diag.put("tier", msg.tier != null ? msg.tier : "");
                    diag.put("event", msg.event != null ? msg.event : "");
                    diag.put("at", nowIso());
                    LocationAlertStore.putLastMatch(ctx, diag.toString());
                } catch (Throwable t) {
                    Log.w(TAG, "진단 기록 실패(무시)", t);
                }
                writeLastWake(ctx, "notified", msg.zone != null ? msg.zone : "", pos, isDemo);
                LocationAlertNotifier.notify(ctx, msg.title, msg.body);
            } else {
                // 무표출 wake 도 반드시 기록 — off-sea(육지/외해) vs no-warning(구역 내 무특보·회색지대).
                String outcome = "off-sea".equals(dg.reason) ? "off-sea"
                        : ("no-warning".equals(dg.reason) ? "no-warning" : "no-match");
                writeLastWake(ctx, outcome, dg.locatedZone, pos, isDemo);
            }
        } catch (Exception e) {
            writeLastWake(ctx, "suberror", "", pos, isDemo);
            Log.e(TAG, "decideAlert 실패", e);
        }
    }

    /**
     * [Phase 2b] 위치기반 태풍 반경 알림 — killed 포함 모든 상태에서 네이티브가 직접 처리.
     *   JS location_alert_typhoon_runtime.handleTyphoonWake 와 동일 흐름(완전 on-device 판정):
     *     ① subTyphoon 게이트(false 면 skip / 미설정은 fail-open)
     *     ② LocationAlertLocator.getFresh(ctx) — 그 순간 fresh 위치 1회(REUSE). null → skip.
     *     ③ TyphoonApi.fetchTyphoon() — 공개 /api/typhoon 만 GET. null/빈 → skip.
     *     ④ decideTyphoonAlerts — 진입한 태풍마다 1건(폭풍 우선/강풍 폴백).
     *     ⑤ 태풍별 별도 로컬 알림(고유 id + 행동요령 딥링크).
     *   좌표는 단말 밖으로 절대 나가지 않음. 모든 단계 try/catch — 서비스 절대 크래시 금지.
     */
    private void handleTyphoonWake(Context ctx) {
        try {
            // ① subTyphoon 게이트 — 명시적 false 만 skip. 미설정/읽기실패는 fail-open(진행).
            if (!LocationAlertStore.isTyphoonSubOn(ctx)) {
                Log.d(TAG, "subTyphoon OFF → skip");
                return;
            }

            // ② 그 순간 fresh 위치 1회(Phase-1 재사용). null → skip.
            LocationAlertStore.Position pos = LocationAlertLocator.getFresh(ctx);
            if (pos == null) {
                Log.d(TAG, "위치 없음(fresh fix 실패) → 태풍 반경 skip");
                return;
            }
            double[] loc = new double[] { pos.lat, pos.lng };   // {lat, lon=lng}

            // ③ /api/typhoon 재조회(공개 데이터만). null/빈 → skip.
            JSONObject typhoonJson = TyphoonApi.fetchTyphoon();
            if (typhoonJson == null) {
                Log.d(TAG, "/api/typhoon 응답 없음 → skip");
                return;
            }
            JSONArray typhoons = typhoonJson.optJSONArray("typhoons");
            if (typhoons == null || typhoons.length() == 0) {
                Log.d(TAG, "활성 태풍 없음 → skip");
                return;
            }
            // 딥링크 dtYear 폴백용 — 응답 최상위 year(JS root.__typhoonYear 대응). 없으면 null.
            String fallbackYear = (typhoonJson.has("year") && !typhoonJson.isNull("year"))
                    ? String.valueOf(typhoonJson.opt("year")) : null;

            // ④ 각 태풍 판정 — 진입한 태풍마다 1건.
            List<TyphoonRadiusDecider.Alert> alerts =
                    TyphoonRadiusDecider.decideTyphoonAlerts(loc, typhoons, fallbackYear);
            if (alerts.isEmpty()) {
                Log.d(TAG, "반경 진입 태풍 없음 → skip");
                return;
            }

            // ⑤ 태풍별 별도 로컬 알림(고유 id + 딥링크). 한 건 실패해도 나머지 진행.
            for (TyphoonRadiusDecider.Alert a : alerts) {
                try {
                    TyphoonRadiusDecider.RadiusMessage msg =
                            TyphoonRadiusDecider.buildRadiusAlert(a.which, a.seq, a.name, a.nameEn, a.etaTmFc);
                    if (msg == null) continue;
                    String url = TyphoonRadiusDecider.buildDemoUrl(a.year, a.seq, a.code, true);
                    LocationAlertNotifier.notify(ctx, msg.title, msg.body,
                            TyphoonRadiusDecider.notifId(a.seq), url);
                } catch (Throwable t) {
                    Log.w(TAG, "태풍 알림 표출 실패(무시)", t);
                }
            }
        } catch (Throwable t) {
            Log.e(TAG, "handleTyphoonWake 실패", t);
        }
    }

    /**
     * 저장 위치 at(ISO-8601 UTC, 예 2026-06-25T06:45:00.000Z)의 경과 시간(ms).
     * 파싱 실패/널이면 -1 반환 → 호출부에서 "낡지 않음"으로 취급(유효 알림 억제 방지).
     * 밀리초 포맷을 우선 시도하고, 실패 시 초 단위 포맷으로 폴백(완전 방어적).
     */
    private static long ageMillis(String atIso) {
        if (atIso == null || atIso.isEmpty()) return -1;
        long t = parseIsoUtc(atIso, "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
        if (t < 0) t = parseIsoUtc(atIso, "yyyy-MM-dd'T'HH:mm:ss'Z'");
        if (t < 0) return -1;
        long age = System.currentTimeMillis() - t;
        return age >= 0 ? age : 0; // 미래 시각(시계 오차)은 0으로 보정(낡지 않음)
    }

    private static long parseIsoUtc(String s, String pattern) {
        try {
            java.text.SimpleDateFormat f =
                    new java.text.SimpleDateFormat(pattern, java.util.Locale.US);
            f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            f.setLenient(true);
            java.util.Date d = f.parse(s);
            return d != null ? d.getTime() : -1;
        } catch (Throwable t) {
            return -1;
        }
    }

    /** ISO-8601(UTC) 현재 시각. */
    private static String nowIso() {
        try {
            java.text.SimpleDateFormat f =
                    new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            return f.format(new java.util.Date());
        } catch (Throwable t) {
            return "";
        }
    }
}
