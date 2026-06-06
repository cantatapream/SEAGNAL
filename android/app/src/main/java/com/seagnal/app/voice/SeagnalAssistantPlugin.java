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

    // 서비스 → WebView 로 상태/대화를 전달하기 위한 정적 참조.
    private static SeagnalAssistantPlugin instance;

    // Vosk 모델 상태 변경을 webview('voskState' 이벤트)로 중계하는 리스너.
    private final VoskModelManager.Listener voskListener = (state, progress, message) -> {
        if (instance == null) return;
        try {
            JSObject o = new JSObject();
            o.put("state", state.name());
            o.put("progress", progress);
            if (message != null) o.put("message", message);
            instance.notifyListeners("voskState", o);
        } catch (Exception ignored) {}
    };

    @Override
    public void load() {
        instance = this;
        VoskModelManager.get().addListener(voskListener);
    }

    @Override
    protected void handleOnDestroy() {
        VoskModelManager.get().removeListener(voskListener);
        super.handleOnDestroy();
    }

    /**
     * 음성 비서 상태/대화를 WebView(JS)로 통지. 화면 오버레이가 'assistantState' 이벤트를 구독.
     * @param state 'wake'|'listening'|'thinking'|'speaking'
     */
    public static void emitState(String state, String query, String answer) {
        if (instance == null) return;
        try {
            JSObject o = new JSObject();
            o.put("state", state);
            if (query != null) o.put("query", query);
            if (answer != null) o.put("answer", answer);
            instance.notifyListeners("assistantState", o);
        } catch (Exception ignored) {}
    }

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
        // 개인화용 프로필(JSON 문자열) — 음성 답변도 사용자 맞춤이 되도록 서비스로 전달
        String profile = call.getString("profile");
        if (profile != null && !profile.isEmpty()) {
            intent.putExtra(VoiceAssistantService.EXTRA_PROFILE, profile);
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

    /**
     * 호출어 엔진의 가용성 + Vosk 모델 상태 조회.
     * JS 가 enable() 호출 전에 이걸로 분기해 다운로드 다이얼로그를 띄운다.
     */
    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("porcupineAvailable", PorcupineWakeEngine.isAvailable(getContext()));
        VoskModelManager mgr = VoskModelManager.get();
        VoskModelManager.State st = mgr.currentState(getContext());
        JSObject vosk = new JSObject();
        vosk.put("state", st.name());
        vosk.put("progress", st == VoskModelManager.State.DOWNLOADING ? mgr.currentProgress() : -1);
        if (mgr.currentMessage() != null) vosk.put("message", mgr.currentMessage());
        ret.put("vosk", vosk);
        call.resolve(ret);
    }

    /**
     * Vosk 한국어 모델 다운로드 시작. allowMobile=false(기본) 면 Wi-Fi 가 아닐 때 WIFI_REQUIRED 로 거절.
     * 진행률·결과는 'voskState' 이벤트로 전달된다.
     */
    @PluginMethod
    public void requestVoskDownload(PluginCall call) {
        Boolean allow = call.getBoolean("allowMobile", false);
        Intent intent = new Intent(getContext(), VoskDownloadService.class);
        intent.putExtra(VoskDownloadService.EXTRA_ALLOW_MOBILE, allow != null && allow);
        ContextCompat.startForegroundService(getContext(), intent);
        JSObject ret = new JSObject();
        ret.put("started", true);
        call.resolve(ret);
    }

    /** 진행 중인 Vosk 모델 다운로드 취소. */
    @PluginMethod
    public void cancelVoskDownload(PluginCall call) {
        Intent intent = new Intent(getContext(), VoskDownloadService.class);
        intent.setAction(VoskDownloadService.ACTION_CANCEL);
        getContext().startService(intent);
        JSObject ret = new JSObject();
        ret.put("canceled", true);
        call.resolve(ret);
    }
}
