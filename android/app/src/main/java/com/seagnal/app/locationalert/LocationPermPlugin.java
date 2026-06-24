package com.seagnal.app.locationalert;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 위치 '항상 허용'(백그라운드 위치) 권한을 네이티브에서 직접 요청하는 Capacitor 플러그인.
 *
 * [왜 필요한가]
 *   안드로이드에는 "앱별 위치-권한 라디오 화면(항상 허용/앱 사용 중에만 허용/…)"으로 바로 가는
 *   공개 인텐트가 없다(알림과 달리). JS 의 설정 열기로는 '앱 정보(권한)' 화면까지만 갈 수 있다.
 *   하지만 **안드로이드 11+(API 30)는 백그라운드 위치 권한을 런타임 요청하면 그 라디오 화면을
 *   시스템이 직접 띄운다**(전경 위치가 이미 허용된 상태에서). → 사용자가 한 번에 '항상 허용' 가능.
 *
 * [전제]
 *   전경 위치(ACCESS_FINE/COARSE_LOCATION)가 먼저 허용돼 있어야 한다(JS 동의 흐름이 선행 요청).
 *
 * [JS]
 *   const { LocationPerm } = Capacitor.Plugins;
 *   await LocationPerm.requestBackground();   // → '항상 허용' 화면
 *   const { granted } = await LocationPerm.checkBackground();
 */
@CapacitorPlugin(
        name = "LocationPerm",
        permissions = {
                @Permission(alias = "backgroundLocation", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION })
        }
)
public class LocationPermPlugin extends Plugin {

    /** 백그라운드 위치('항상 허용') 권한 요청. 이미 허용이면 즉시 반환. */
    @PluginMethod
    public void requestBackground(PluginCall call) {
        // Android 10(API 29) 미만은 백그라운드 권한 개념이 없음 → 전경 권한이면 충분.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            resolveGranted(call, true);
            return;
        }
        if (getPermissionState("backgroundLocation") == PermissionState.GRANTED) {
            resolveGranted(call, true);
            return;
        }
        // 요청 → Android 11+ 는 '위치 액세스 권한' 화면을 직접 띄운다.
        requestPermissionForAlias("backgroundLocation", call, "bgLocCallback");
    }

    @PermissionCallback
    private void bgLocCallback(PluginCall call) {
        resolveGranted(call, getPermissionState("backgroundLocation") == PermissionState.GRANTED);
    }

    /** 현재 백그라운드 위치 권한 상태 조회. */
    @PluginMethod
    public void checkBackground(PluginCall call) {
        boolean granted = (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)
                || getPermissionState("backgroundLocation") == PermissionState.GRANTED;
        resolveGranted(call, granted);
    }

    private void resolveGranted(PluginCall call, boolean granted) {
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }
}
