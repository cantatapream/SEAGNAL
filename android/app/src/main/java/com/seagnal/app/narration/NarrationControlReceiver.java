package com.seagnal.app.narration;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * [임시 — 발표 나레이션] 상태표시줄 미디어 알림 버튼(⟲/⏯/⟳, 스와이프 삭제)
 * 브로드캐스트 수신 → NarrationController 로 위임.
 *
 * AndroidManifest 에 exported="false" 로 등록 — 알림의 PendingIntent(명시적
 * 인텐트)만 도달 가능, 외부 앱은 호출 불가.
 */
public class NarrationControlReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        NarrationController c = NarrationController.get();
        switch (intent.getAction()) {
            case NarrationController.ACTION_TOGGLE:  c.toggle();  break;
            case NarrationController.ACTION_REWIND:  c.rewind();  break;
            case NarrationController.ACTION_FORWARD: c.forward(); break;
            case NarrationController.ACTION_STOP:    c.stop();    break;
            default: break;
        }
    }
}
