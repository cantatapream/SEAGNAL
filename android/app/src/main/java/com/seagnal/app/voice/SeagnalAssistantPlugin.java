package com.seagnal.app.voice;

import android.Manifest;
import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 웹(WebView) ↔ 네이티브 음성 비서 서비스 브릿지 Capacitor 플러그인.
 *
 * [JS 에서 사용]
 *   const { SeagnalAssistant } = Capacitor.Plugins;
 *   await SeagnalAssistant.enable({ serverUrl });  // 마이크 권한 요청 후 상시 청취 시작
 *   await SeagnalAssistant.disable();              // 청취 중지(서비스 종료)
 *   const { running } = await SeagnalAssistant.isEnabled();
 *
 * [권한]
 *   RECORD_AUDIO 는 런타임 권한이라 enable() 시점에 요청한다.
 *   (POST_NOTIFICATIONS 는 매니페스트에 이미 선언됨 — Android 13+ 알림 표시용)
 */
@CapacitorPlugin(
        name = "SeagnalAssistant",
        permissions = {
                @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
        }
)
public class SeagnalAssistantPlugin extends Plugin {

    @PluginMethod
    public void enable(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermissionCallback");
        } else {
            startVoiceService(call);
        }
    }

    @PermissionCallback
    private void micPermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            startVoiceService(call);
        } else {
            call.reject("마이크 권한이 필요합니다. 설정에서 허용해 주세요.");
        }
    }

    private void startVoiceService(PluginCall call) {
        Intent intent = new Intent(getContext(), VoiceAssistantService.class);
        String serverUrl = call.getString("serverUrl");
        if (serverUrl != null && !serverUrl.isEmpty()) {
            intent.putExtra(VoiceAssistantService.EXTRA_SERVER_URL, serverUrl);
        }
        ContextCompat.startForegroundService(getContext(), intent);

        JSObject ret = new JSObject();
        ret.put("running", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        Intent intent = new Intent(getContext(), VoiceAssistantService.class);
        intent.setAction(VoiceAssistantService.ACTION_STOP);
        getContext().startService(intent);

        JSObject ret = new JSObject();
        ret.put("running", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", VoiceAssistantService.isRunning);
        call.resolve(ret);
    }
}
