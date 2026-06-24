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
