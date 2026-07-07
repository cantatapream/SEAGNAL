package com.seagnal.app.narration;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * [임시 — 발표 나레이션] 웹(WebView) ↔ 네이티브 나레이션 플레이어 브릿지.
 *
 * [JS 에서 사용] (js/demo_quick_trigger.js)
 *   const { NarrationPlayer } = Capacitor.Plugins;
 *   await NarrationPlayer.play({ url, title });  // 재생 시작 + 상태바 미디어 알림 표출
 *   await NarrationPlayer.toggle();              // 재생/일시정지
 *   await NarrationPlayer.seekTo({ seconds });   // 위치 이동
 *   await NarrationPlayer.stop();                // 정지 + 알림 제거
 *   const { playing } = await NarrationPlayer.getState();
 *
 * play() 는 prepareAsync 완료(onPrepared) 시 resolve, 실패 시 reject —
 * JS 쪽이 reject 를 받으면 웹 오디오(미니 플레이어)로 폴백한다.
 */
@CapacitorPlugin(name = "NarrationPlayer")
public class NarrationPlayerPlugin extends Plugin {

    @PluginMethod
    public void play(final PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "발표 나레이션");
        if (url == null || url.isEmpty()) {
            call.reject("url 이 필요합니다.");
            return;
        }
        NarrationController.get().play(getContext(), url, title, new NarrationController.PrepareCallback() {
            @Override public void onReady() { call.resolve(); }
            @Override public void onError(String message) { call.reject(message); }
        });
    }

    @PluginMethod
    public void toggle(PluginCall call) {
        NarrationController.get().toggle();
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        NarrationController.get().pause();
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        NarrationController.get().resume();
        call.resolve();
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Double sec = call.getDouble("seconds");
        if (sec != null) NarrationController.get().seekTo((long) (sec * 1000));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        NarrationController.get().stop();
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("playing", NarrationController.get().isPlaying());
        call.resolve(ret);
    }
}
