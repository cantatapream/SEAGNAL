package com.seagnal.app.update;

import android.app.Activity;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * 앱 안 업데이트(Google Play In-App Updates · 유연형) Capacitor 플러그인.
 *
 * [유연형이란] 사용자가 앱을 계속 쓰는 동안 Play 스토어가 뒤에서 새 버전을 내려받고,
 *   다 받으면 화면에 「다시 시작」을 띄워 한 번 누르면 새 버전으로 바뀌는 방식(사용자 확정 2026-11-19).
 *
 * [JS — client/capacitor-plugins.js tryInAppUpdate]
 *   const AU = Capacitor.Plugins.SeagnalAppUpdate;
 *   const info = await AU.check();   // {updateAvailable, flexibleAllowed, inProgress, downloaded, …}
 *   await AU.start();                // Play 의 「업데이트할까요?」 확인 창 → {accepted}
 *   AU.addListener('installState', s => …);   // {status:'downloaded'|'failed'|…, downloaded}
 *   await AU.complete();             // 내려받은 새 버전 설치 + 앱 다시 시작
 *
 * [되는 조건] Play 스토어에서 설치한 앱에서만 된다. APK 를 직접 설치한 기기 등에서는 check() 가
 *   실패(reject)하고, JS 는 종전 방식(서버 버전 비교 → 스토어 이동 팝업)으로 돌아간다.
 *
 * [안전] 모든 메서드는 실패를 reject 로 돌려줄 뿐 앱을 죽이지 않는다. 이 플러그인이 없는 옛 APK 에서는
 *   JS 가 플러그인 부재를 보고 종전 방식을 쓴다.
 *
 * [연계] MainActivity.onCreate 의 registerPlugin(AppUpdatePlugin.class) ·
 *        app/build.gradle 의 com.google.android.play:app-update
 */
@CapacitorPlugin(name = "SeagnalAppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String TAG = "SeagnalAppUpdate";

    private AppUpdateManager manager;
    private InstallStateUpdatedListener listener;

    /** 플러그인 로드 시 Play 업데이트 관리자를 준비하고, 내려받기 상태 변화를 JS 로 전달하는 리스너를 건다. */
    @Override
    public void load() {
        try {
            // Activity 가 아니라 앱 컨텍스트를 넘긴다(공식 문서: "the application Context for your app") — Activity 를 붙들지 않게.
            manager = AppUpdateManagerFactory.create(getContext().getApplicationContext());
            listener = state -> {
                int status = state.installStatus();
                // 내려받는 중(진행률)은 JS 가 쓰지 않아 보내지 않는다 — 상태가 바뀐 순간만 알린다.
                if (status == InstallStatus.DOWNLOADING) return;
                JSObject o = new JSObject();
                o.put("status", statusName(status));
                o.put("downloaded", status == InstallStatus.DOWNLOADED);
                notifyListeners("installState", o);
            };
            manager.registerListener(listener);
        } catch (Throwable t) {
            Log.w(TAG, "Play 업데이트 관리자 준비 실패 — 앱 안 업데이트를 쓰지 않는다", t);
            manager = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (manager != null && listener != null) manager.unregisterListener(listener);
        } catch (Throwable t) {
            Log.w(TAG, "리스너 해제 실패(무시)", t);
        }
        super.handleOnDestroy();
    }

    /**
     * Play 스토어에 "새 버전이 있나"를 묻는다.
     * 결과: known(Play 가 답을 알고 있음) · updateAvailable(새 버전 있음) · flexibleAllowed(유연형 가능) · inProgress(이미 내려받는 중) ·
     *       downloaded(다 받아 설치만 남음) · availableVersionCode · status(설치 상태 이름).
     * Play 에 물을 수 없으면(스토어 밖 설치 등) reject.
     */
    @PluginMethod
    public void check(PluginCall call) {
        if (manager == null) { call.reject("in-app update unavailable"); return; }
        try {
            manager.getAppUpdateInfo()
                    .addOnSuccessListener(info -> {
                        try {
                            int availability = info.updateAvailability();
                            int status = info.installStatus();
                            JSObject ret = new JSObject();
                            // known=false: Play 가 "모름"(UNKNOWN)이라고 답함 → JS 는 종전 방식(서버 버전 비교)으로 간다.
                            ret.put("known", availability != UpdateAvailability.UNKNOWN);
                            ret.put("updateAvailable", availability == UpdateAvailability.UPDATE_AVAILABLE);
                            ret.put("flexibleAllowed", info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE));
                            ret.put("inProgress", availability == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS
                                    && status != InstallStatus.DOWNLOADED);
                            ret.put("downloaded", status == InstallStatus.DOWNLOADED);
                            ret.put("availableVersionCode", info.availableVersionCode());
                            ret.put("status", statusName(status));
                            call.resolve(ret);
                        } catch (Throwable t) {
                            call.reject(messageOf(t));
                        }
                    })
                    .addOnFailureListener(e -> call.reject(messageOf(e)));
        } catch (Throwable t) {
            call.reject(messageOf(t));
        }
    }

    /**
     * 유연형 업데이트를 시작한다 — Play 의 확인 창(「업데이트할까요?」)이 뜬다.
     * 결과: started(창을 띄웠는가) · accepted(사용자가 [업데이트]를 눌렀는가).
     * 새 버전이 없거나 유연형이 안 되면 started=false. 창을 못 띄우면 reject.
     */
    @PluginMethod
    public void start(PluginCall call) {
        if (manager == null) { call.reject("in-app update unavailable"); return; }
        final Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }
        try {
            manager.getAppUpdateInfo()
                    .addOnSuccessListener(info -> {
                        try {
                            boolean ok = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                                    && info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE);
                            if (!ok) {
                                JSObject ret = new JSObject();
                                ret.put("started", false);
                                ret.put("accepted", false);
                                call.resolve(ret);
                                return;
                            }
                            manager.startUpdateFlow(info, activity,
                                            AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build())
                                    .addOnSuccessListener(resultCode -> {
                                        JSObject ret = new JSObject();
                                        ret.put("started", true);
                                        ret.put("accepted", resultCode != null && resultCode == Activity.RESULT_OK);
                                        call.resolve(ret);
                                    })
                                    .addOnFailureListener(e -> call.reject(messageOf(e)));
                        } catch (Throwable t) {
                            call.reject(messageOf(t));
                        }
                    })
                    .addOnFailureListener(e -> call.reject(messageOf(e)));
        } catch (Throwable t) {
            call.reject(messageOf(t));
        }
    }

    /** 내려받은 새 버전을 설치하고 앱을 다시 시작한다(「다시 시작」 버튼). 내려받은 것이 없으면 Play 가 실패를 돌려준다. */
    @PluginMethod
    public void complete(PluginCall call) {
        if (manager == null) { call.reject("in-app update unavailable"); return; }
        try {
            manager.completeUpdate()
                    .addOnSuccessListener(v -> call.resolve())
                    .addOnFailureListener(e -> call.reject(messageOf(e)));
        } catch (Throwable t) {
            call.reject(messageOf(t));
        }
    }

    private static String messageOf(Throwable t) {
        String m = (t != null) ? t.getMessage() : null;
        return (m != null && !m.isEmpty()) ? m : "in-app update error";
    }

    private static String statusName(int status) {
        switch (status) {
            case InstallStatus.PENDING: return "pending";
            case InstallStatus.DOWNLOADING: return "downloading";
            case InstallStatus.DOWNLOADED: return "downloaded";
            case InstallStatus.INSTALLING: return "installing";
            case InstallStatus.INSTALLED: return "installed";
            case InstallStatus.FAILED: return "failed";
            case InstallStatus.CANCELED: return "canceled";
            default: return "unknown";
        }
    }
}
