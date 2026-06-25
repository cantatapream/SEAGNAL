package com.seagnal.app.locationalert;

import android.content.Context;
import android.util.Log;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

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
            if (data != null && WAKE_TYPE.equals(data.get("type"))) {
                handleWake(getApplicationContext(), data);
            }
        } catch (Throwable t) {
            Log.e(TAG, "wake 처리 실패", t);
        }

        // 2) 기존 Capacitor 푸시 처리 보존(중요): 일반 푸시/포그라운드 리스너/토큰 흐름 유지.
        super.onMessageReceived(remoteMessage);
    }

    /** 데이터 메시지(data 맵) → 위치 선택(시연/실제) → 판정 → 네이티브 알림 + 진단 기록. */
    private void handleWake(Context ctx, Map<String, String> data) {
        if (data == null) return;
        String snapshotStr = data.get("snapshot");
        if (snapshotStr == null || snapshotStr.isEmpty()) return;

        // 게이팅: 활성+동의 플래그가 있을 때만 동작.
        if (!LocationAlertStore.isEnabled(ctx)) {
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
            pos = LocationAlertStore.getPosition(ctx);
        }
        if (pos == null) {
            Log.d(TAG, "위치 없음 → skip");
            return;
        }

        // ── #3 낡음 가드 (저장 GPS 한정, 데모는 절대 적용 안 함) ──────────────────
        //   저장 위치(pos.at, ISO-8601 UTC)가 12시간(STALE_MAX_MS)보다 낡았으면 잘못된 구역
        //   알림을 막는다. 네이티브 v1 은 fresh fix 를 시도하지 않음(문서화된 한계 — killed 상태에서
        //   안정적인 위치 획득이 어려움) → 낡으면 알림 없이 진단만 남기고 종료.
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
                    Log.d(TAG, "저장 위치 낡음(12h 초과) → skip");
                    return;
                }
            } catch (Throwable t) {
                Log.w(TAG, "낡음 가드 평가 실패 → 진행", t);
            }
        }

        List<LocationAlertCore.Feature> features = WarnZoneAssets.load(ctx);
        if (features.isEmpty()) {
            Log.w(TAG, "번들 폴리곤 로드 실패 → skip");
            return;
        }

        try {
            JSONObject snapshot = new JSONObject(snapshotStr);
            LocationAlertCore.Message msg = LocationAlertDecider.decideAlert(
                    pos.lat, pos.lng, pos.accuracyM, features, snapshot);
            if (msg != null) {
                // 진단 기록(단말 로컬에만 — 네트워크 전송 없음). 완전 방어적.
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
                LocationAlertNotifier.notify(ctx, msg.title, msg.body);
            }
        } catch (Exception e) {
            Log.e(TAG, "decideAlert 실패", e);
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
