package com.seagnal.app.locationalert;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * LocationAlertLocator — 이벤트 기반(깨우는 신호 시점) fresh-fix 위치 획득 헬퍼.
 *
 * [전환 배경] 상시 GPS 수집(전경 서비스 + 상시 알림 + 15분 타이머)을 제거하고, 특보
 *   발표·변경(=FCM wake) 시점에 그 순간 위치를 1회 수집한다. JS getFreshPosition() 의
 *   네이티브 대응(killed 상태 포함).
 *
 * [전략] Google Play Services(play-services-location) 미사용 — android.location.LocationManager
 *   만 사용(기존 VoiceAssistantService.getLastLocation 패턴과 동일, 새 의존성 0).
 *   1) 권한(ACCESS_FINE/COARSE) 게이트.
 *   2) ACTIVE 단발 업데이트 시도(짧은 타임아웃 ~8초):
 *        - API 30+: LocationManager.getCurrentLocation(provider, ...)
 *        - 그 미만: LocationManager.requestSingleUpdate(provider, listener, mainLooper) + 타임아웃 폴백
 *   3) 실패 시 getLastKnownLocation 을 GPS/NETWORK/PASSIVE 에서 가장 최근 것으로.
 *   4) 그래도 없으면 LocationAlertStore.getPosition(ctx)(저장 폴백).
 *   5) fresh fix 성공 시 LocationAlertStore.putPosition(ctx,...) 로 저장(미러 + 진단 갱신).
 *
 * [완전 on-device] 위치는 단말 안에서만. 네트워크 전송 0. 모든 경로 완전 방어적(try/catch).
 */
public final class LocationAlertLocator {

    private static final String TAG = "LocationAlertLocator";
    private static final long ACTIVE_TIMEOUT_MS = 8000L;   // 단발 ACTIVE fix 타임아웃(JS 와 동일 ~8초)

    private LocationAlertLocator() { }

    /**
     * 깨우는 신호 시점에 그 순간 위치를 1회 수집(권한 있을 때). 모든 단계 실패 시에만 null.
     * fresh fix 에 성공하면 LocationAlertStore.putPosition 으로 저장(POS_KEY 미러 갱신).
     */
    public static LocationAlertStore.Position getFresh(Context ctx) {
        try {
            if (ctx == null) return null;   // 컨텍스트 없으면 위치 접근/저장 폴백 모두 불가 → null.
            Context app = ctx.getApplicationContext();

            // 1) 권한 게이트 — 둘 다 없으면 위치 접근 불가 → 저장 폴백만.
            boolean fine = hasPermission(app, Manifest.permission.ACCESS_FINE_LOCATION);
            boolean coarse = hasPermission(app, Manifest.permission.ACCESS_COARSE_LOCATION);
            if (!fine && !coarse) {
                Log.d(TAG, "위치 권한 없음 → 저장 위치 폴백");
                return LocationAlertStore.getPosition(app);
            }

            LocationManager lm = (LocationManager) app.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return LocationAlertStore.getPosition(app);

            // 2) ACTIVE 단발 fix 시도(GPS → NETWORK 순). 성공 시 저장 후 반환.
            Location active = requestActiveFix(app, lm, fine);
            if (active != null) {
                return persistAndWrap(app, active, true);   // ACTIVE = 그 순간 측정 → at=현재시각
            }

            // 3) getLastKnownLocation 폴백(GPS/NETWORK/PASSIVE 중 가장 최근).
            Location last = lastKnown(lm);
            if (last != null) {
                return persistAndWrap(app, last, false);     // 캐시값 → at=실제 측정시각(낡음 가드 정확)
            }

            // 4) 저장 위치 폴백(JS savePosition 미러).
            return LocationAlertStore.getPosition(app);
        } catch (Throwable t) {
            Log.w(TAG, "getFresh 실패 → 저장 위치 폴백", t);
            try { return LocationAlertStore.getPosition(ctx); } catch (Throwable t2) { return null; }
        }
    }

    /** ACTIVE 단발 fix — API 30+ 는 getCurrentLocation, 그 미만은 requestSingleUpdate + 타임아웃. 실패 시 null. */
    private static Location requestActiveFix(Context app, LocationManager lm, boolean fine) {
        // 사용 가능한 provider 우선순위: GPS(정밀) → NETWORK(빠름).
        String[] providers = fine
                ? new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }
                : new String[] { LocationManager.NETWORK_PROVIDER };
        for (String provider : providers) {
            try {
                if (!isProviderUsable(lm, provider)) continue;
                Location l = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                        ? getCurrentLocationApi30(app, lm, provider)
                        : requestSingleUpdateLegacy(lm, provider);
                if (l != null) return l;
            } catch (SecurityException se) {
                // 권한 회수 등 — 다음 provider 시도.
            } catch (Throwable t) {
                Log.w(TAG, "ACTIVE fix(" + provider + ") 실패", t);
            }
        }
        return null;
    }

    /** API 30+ : LocationManager.getCurrentLocation(provider, ...) — 단발 fix, 타임아웃은 CountDownLatch 로. */
    private static Location getCurrentLocationApi30(Context app, LocationManager lm, String provider) {
        try {
            final AtomicReference<Location> ref = new AtomicReference<>(null);
            final CountDownLatch latch = new CountDownLatch(1);
            android.os.CancellationSignal signal = new android.os.CancellationSignal();
            lm.getCurrentLocation(
                    provider,
                    signal,
                    ContextCompat.getMainExecutor(app),
                    location -> { ref.set(location); latch.countDown(); });
            boolean got = latch.await(ACTIVE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            if (!got) {
                try { signal.cancel(); } catch (Throwable ignore) { }
            }
            return ref.get();
        } catch (Throwable t) {
            Log.w(TAG, "getCurrentLocation(API30) 실패", t);
            return null;
        }
    }

    /** API < 30 : requestSingleUpdate(provider, listener, mainLooper) + CountDownLatch 타임아웃 폴백. */
    private static Location requestSingleUpdateLegacy(LocationManager lm, String provider) {
        final AtomicReference<Location> ref = new AtomicReference<>(null);
        final CountDownLatch latch = new CountDownLatch(1);
        final LocationListener listener = new LocationListener() {
            @Override public void onLocationChanged(Location location) { ref.set(location); latch.countDown(); }
            @Override public void onStatusChanged(String p, int s, Bundle e) { }
            @Override public void onProviderEnabled(String p) { }
            @Override public void onProviderDisabled(String p) { latch.countDown(); }
        };
        try {
            // requestSingleUpdate 는 Looper 가 필요 — 메인 Looper 사용(콜백은 메인 스레드).
            lm.requestSingleUpdate(provider, listener, Looper.getMainLooper());
            latch.await(ACTIVE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (Throwable t) {
            Log.w(TAG, "requestSingleUpdate(" + provider + ") 실패", t);
        } finally {
            try { lm.removeUpdates(listener); } catch (Throwable ignore) { }
        }
        return ref.get();
    }

    /** getLastKnownLocation — GPS/NETWORK/PASSIVE 중 가장 최근. (VoiceAssistantService 패턴 재사용) */
    private static Location lastKnown(LocationManager lm) {
        String[] providers = {
                LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER };
        Location best = null;
        for (String p : providers) {
            try {
                Location l = lm.getLastKnownLocation(p);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            } catch (SecurityException ignored) {
            } catch (Throwable ignored) { }
        }
        return best;
    }

    private static boolean isProviderUsable(LocationManager lm, String provider) {
        try { return lm.isProviderEnabled(provider); }
        catch (Throwable t) { return false; }
    }

    private static boolean hasPermission(Context ctx, String perm) {
        try { return ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED; }
        catch (Throwable t) { return false; }
    }

    /** fix 를 저장(putPosition: POS_KEY 미러 + 진단 갱신)하고 Position 으로 래핑해 반환.
     *  @param isActiveFix true=그 순간 능동 측정(at=현재시각). false=getLastKnownLocation 캐시값
     *    (at=loc.getTime() 실제 측정시각). 캐시값을 현재시각으로 찍으면 12h 낡음 가드를 우회해
     *    며칠 정체된 단말이 낡은 위치로 오판정할 수 있으므로, 캐시는 실제 측정시각을 보존한다. */
    private static LocationAlertStore.Position persistAndWrap(Context app, Location loc, boolean isActiveFix) {
        double lat = loc.getLatitude();
        double lng = loc.getLongitude();
        double acc = loc.hasAccuracy() ? loc.getAccuracy() : 0.0;
        String at;
        if (isActiveFix) {
            at = nowIso();
        } else {
            long t = loc.getTime();
            at = (t > 0) ? isoFromMillis(t) : nowIso();   // 측정시각 불명(0)이면 현재시각으로
        }
        try { LocationAlertStore.putPosition(app, lat, lng, acc, at); } catch (Throwable ignore) { }
        LocationAlertStore.Position p = new LocationAlertStore.Position();
        p.lat = lat; p.lng = lng; p.accuracyM = acc; p.at = at;
        return p;
    }

    /** epoch millis → ISO-8601(UTC) 문자열 (JS savePosition 의 at 포맷과 동일). */
    private static String isoFromMillis(long millis) {
        try {
            java.text.SimpleDateFormat f =
                    new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            return f.format(new java.util.Date(millis));
        } catch (Throwable t) {
            return nowIso();
        }
    }

    /** ISO-8601(UTC) 현재 시각 — JS savePosition 의 at 포맷과 동일. */
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
