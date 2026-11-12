package kr.seagnal.kakaorelay;

import android.app.Activity;
import android.app.KeyguardManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;

/**
 * 화면을 켜고 잠금 화면을 넘기는 빈(투명) 화면. 특보 알림이 왔을 때 ReaderService 가 잠깐 띄운다.
 * 왜: 최신 안드로이드는 「화면 켜기 잠금(ACQUIRE_CAUSES_WAKEUP)」으로 화면을 켜는 것을 막는다(2026-11-03 휴대폰에서
 *   화면이 꺼진 동안 온 특보를 대화방에서 못 읽음). 화면(Activity)에 「켜면서 보이기」를 거는 것은 공식으로 허용된다.
 * 잠금 방식이 「없음」이거나 밀어서 풀기면 잠금 화면도 넘긴다. 비밀번호·패턴 잠금이면 넘길 수 없다.
 * 몇 초 뒤 스스로 닫힌다(그 사이 카톡 대화방이 위에 열린다).
 */
public class WakeActivity extends Activity {
    @SuppressWarnings("deprecation")
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        new Handler(Looper.getMainLooper()).postDelayed(this::finish, 4_000L);
    }

    /**
     * 잠금 풀기 요청은 화면이 실제로 보일 때(onResume) 한다 — 만들어지는 순간(onCreate)에는 무시될 수 있다.
     * 결과(풀림·실패·취소)를 앱 기록에 남긴다(0.3 — 2026-11-12, 그 전에는 결과를 몰랐다).
     */
    @Override protected void onResume() {
        super.onResume();
        KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        if (km == null || Build.VERSION.SDK_INT < 26 || !km.isKeyguardLocked()) return;
        km.requestDismissKeyguard(this, new KeyguardManager.KeyguardDismissCallback() {
            @Override public void onDismissSucceeded() { Config.status(WakeActivity.this, "잠금 화면 넘김"); }
            @Override public void onDismissError() { Config.status(WakeActivity.this, "잠금 화면 넘기기 실패"); }
            @Override public void onDismissCancelled() { Config.status(WakeActivity.this, "잠금 화면 넘기기 취소됨(비밀번호 잠금?)"); }
        });
    }
}
