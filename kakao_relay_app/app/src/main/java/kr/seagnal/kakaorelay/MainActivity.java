package kr.seagnal.kakaorelay;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Collections;

/**
 * 설정 화면: 서버 주소·비밀 열쇠·기기 이름을 넣고, 필요한 권한 화면으로 바로 가는 버튼과 최근 기록을 보여 준다.
 */
public class MainActivity extends Activity {
    private EditText server, token, device;
    private android.widget.CheckBox auto, notiOnly;
    private TextView state, log;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        v.setPadding(40, 40, 40, 40);

        server = field(v, "서버 주소 (예: https://seagnal.fly.dev)", Config.server(this), false);
        token = field(v, "비밀 열쇠 (서버 KAKAO_RELAY_TOKEN 과 같게)", Config.token(this), true);
        device = field(v, "기기 이름", Config.device(this), false);

        auto = new android.widget.CheckBox(this);
        auto.setText("자동 중계 사용 (태블릿만 켜기 · 본 휴대폰은 끄기)");
        auto.setChecked(Config.auto(this));
        v.addView(auto);
        notiOnly = new android.widget.CheckBox(this);
        notiOnly.setText("알림 글만 보내기 (휴대폰용 · 화면과 카톡을 건드리지 않음)");
        notiOnly.setChecked(Config.notiOnly(this));
        v.addView(notiOnly);

        button(v, "저장", () -> {
            Config.prefs(this).edit()
                    .putString("server", server.getText().toString().trim())
                    .putString("token", token.getText().toString().trim())
                    .putString("device", device.getText().toString().trim())
                    .putBoolean("auto", auto.isChecked())
                    .putBoolean("notiOnly", notiOnly.isChecked()).apply();
            Config.status(this, "설정 저장");
            refresh();
        });
        button(v, "① 알림 접근 허용하러 가기", () ->
                startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        button(v, "② 접근성(화면 읽기) 켜러 가기", () ->
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        button(v, "③ 배터리 최적화 제외", () ->
                startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getPackageName()))));
        button(v, "서버 연결 시험(신호 보내기)", () -> BeatReceiver.beatNow(this));
        button(v, "시험 글 보내기", () -> Sender.sendMessages(this, Collections.singletonList(
                Config.MARKER + "\n\n[기상특보]\n시험바다,\n풍랑주의보 01월 01일 00시 00분\n시험 "
                        + System.currentTimeMillis()), "notification"));
        button(v, "[임시] 긁어오기 시작 — 누른 뒤 카톡 대화방 열기(결과는 다운로드 폴더 파일)", () -> {
            Backfill.arm(this);
            android.content.Intent k = getPackageManager().getLaunchIntentForPackage(Config.KAKAO);
            if (k != null) startActivity(k);
            refresh();
        });
        button(v, "[임시] 긁어오기 중지", () -> { Backfill.stop("사용자 중지"); refresh(); });
        button(v, "새로고침", this::refresh);

        state = new TextView(this);
        log = new TextView(this);
        log.setTextIsSelectable(true);
        v.addView(state);
        v.addView(log);

        ScrollView sv = new ScrollView(this);
        sv.addView(v);
        setContentView(sv);
    }

    @Override protected void onResume() {
        super.onResume();
        refresh();
    }

    private void refresh() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        String listeners = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        boolean noti = listeners != null && listeners.contains(getPackageName());
        boolean batt = pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        state.setText("\n알림 접근: " + (noti ? "✅" : "❌") + "   화면 읽기: " + (ReaderService.isOn() ? "✅" : "❌")
                + "   배터리 제외: " + (batt ? "✅" : "❌") + "\n대기 중인 글: "
                + queueCount() + "건\n자동 중계: " + (Config.auto(this) ? (Config.notiOnly(this) ? "켜짐(알림 글만)" : "켜짐(대화방 읽기)") : "꺼짐")
                + "   긁어오기: " + (Backfill.active() ? "진행 중 " + Backfill.total() + "개" : "멈춤") + "\n");
        log.setText(Config.prefs(this).getString("log", ""));
    }

    private int queueCount() {
        try { return new org.json.JSONArray(Config.prefs(this).getString("queue", "[]")).length(); }
        catch (Exception e) { return -1; }
    }

    private EditText field(LinearLayout v, String hint, String val, boolean secret) {
        TextView l = new TextView(this);
        l.setText(hint);
        v.addView(l);
        EditText e = new EditText(this);
        e.setText(val);
        e.setSingleLine(true);
        if (secret) e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        v.addView(e);
        return e;
    }

    private void button(LinearLayout v, String text, Runnable r) {
        Button b = new Button(this);
        b.setText(text);
        b.setOnClickListener(x -> r.run());
        v.addView(b);
    }
}
