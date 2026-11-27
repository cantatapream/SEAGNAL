
// [이 파일의 업데이트 관련 부분 — 2026-11-20]
//   · 업데이트 안내 창(시안 C): showUpdatePopup — 옛 앱(1.1.1 이하)에서 서버 latestVersion 이 더 높을 때. 「나중에」 24시간.
//     바뀐 점 목록은 관리자 센터 버전 탭 「업데이트 메시지」(서버 local_server/data/app_version.json — services/app_version_store.js). 관리자 미리 보기 = window.SeagnalUpdatePopup.
//   · 앱 안 업데이트(유연형): tryInAppUpdate — 1.3.0 이후 앱. 설계·검증: 00_docs/operations/app-release-headsup-inapp-update.md
//   · 시험: local_server/scripts/test_inapp_update_flow.js
// Capacitor 전역 객체 확보
import { Geolocation } from '@capacitor/geolocation';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
const { PushNotifications, SplashScreen, Capacitor } = window.Capacitor ? window.Capacitor.Plugins : {};

// [SplashScreen] 앱 로드 즉시 네이티브 스플래시 숨김 (웹 스플래시 노출을 위해)
if (SplashScreen && SplashScreen.hide) {
    SplashScreen.hide();
}

// [서버 구독 전송 함수] - 토큰과 사용자의 앱 내 설정(ON/OFF 등)을 서버로 전송
window.subscribeUser = async (token = null) => {
    if (!token) {
        token = localStorage.getItem('push_token');
    }
    if (!token) return;

    localStorage.setItem('push_token', token);

    // app.js에 정의된 NotificationSettings 및 UserSettings에서 값 가져오기
    const pushSettings = JSON.parse(localStorage.getItem('notificationSettings_v1') || '{}');
    const userSettings = JSON.parse(localStorage.getItem('weatherAppSettings_v1') || '{}');

    // [푸시 구역 목록] 서버에 전송할 해역 목록 (소분류 = 실제 특보가 발령되는 개별 해역 단위)
    // 대분류(동해/서해/남해/제주)와 중분류(남해동부해상 등)는 포함하지 않음.
    // 이유: 서버의 expandToMinorZones가 대분류를 해당 대분류 아래 "모든" 소분류로 확장하기 때문에,
    // 사용자가 일부 소분류만 켜놓아도 대분류가 포함되면 꺼놓은 해역까지 푸시가 발송되는 버그 방지.
    // 예) 남해동부해상만 ON, 남해서부해상 OFF인 사용자에게 '남해' 대분류가 전달되면
    //     서버가 남해 전체(동부+서부)로 확장하여 남해서부 푸시도 발송됨.
    const ALL_ZONES = [
        // 동해남부 소분류
        '울산앞바다', '경북남부앞바다', '경북북부앞바다', '동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다', '동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다',
        // 동해중부 소분류
        '강원북부앞바다', '강원중부앞바다', '강원남부앞바다', '동해중부안쪽먼바다', '동해중부바깥먼바다',
        // 서해중부 소분류
        '인천·경기북부앞바다', '인천·경기남부앞바다', '충남북부앞바다', '충남남부앞바다', '서해중부안쪽먼바다', '서해중부바깥먼바다',
        // 서해남부 소분류
        '전북북부앞바다', '전북남부앞바다', '전남북부서해앞바다', '전남중부서해앞바다', '전남남부서해앞바다', '서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다', '서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다',
        // 남해동부 소분류
        '부산앞바다', '경남서부남해앞바다', '경남중부남해앞바다', '거제시동부앞바다', '남해동부안쪽먼바다', '남해동부바깥먼바다',
        // 남해서부 소분류
        '전남서부남해앞바다', '전남동부남해앞바다', '남해서부서쪽먼바다', '남해서부동쪽먼바다',
        // 제주 소분류
        '제주도북부앞바다', '제주도남부앞바다', '제주도동부앞바다', '제주도서부앞바다', '제주도남서쪽안쪽먼바다', '제주도남동쪽안쪽먼바다', '제주도남쪽바깥먼바다'
    ];

    // 'all'이면 전체 소분류 목록 전송, 'interest'면 사용자가 끈 해역만 제외
    // (기본값 = true, 명시적으로 false 설정한 해역만 제외)
    // [구역 분할] 전환(서버가 정한다) 뒤 「제주도남쪽바깥먼바다」 대신 남서쪽·남동쪽바깥먼바다 둘로 구독한다(js/core/zone_split.js).
    //   저장값(옛 구역 켬/끔)은 zone_split.js 가 화면을 열 때 새 두 이름으로 이미 옮겨 두었다.
    const ZONES_NOW = (window.ZoneSplit && window.ZoneSplit.splitNames) ? window.ZoneSplit.splitNames(ALL_ZONES) : ALL_ZONES;
    const selectedZones = (pushSettings.target === 'all')
        ? ZONES_NOW
        : ZONES_NOW.filter(zone => userSettings[zone] !== false);

    try {
        // deviceId: 제보 답변 푸시 등 기기 식별용
        const deviceId = localStorage.getItem('seagnal_device_id') || '';

        // [폰 권한 보고 2026-11-18] 폰 자체 설정에서 알림 권한이 꺼져 있는지 서버에 알린다.
        //   FCM 은 폰이 알림을 막아도 "보냈다"고만 답해 서버가 알 길이 없다 — 관리자 「구독 현황」의
        //   실제 수신자 수에서 빼기 위해서다(발송은 그대로 한다). 확인 실패 시에는 보내지 않는다(모르면 모른다).
        let osPermission;
        try {
            const st = await window.Capacitor.Plugins.PushNotifications.checkPermissions();
            osPermission = st && st.receive;
        } catch (_) { /* 웹·플러그인 없음 — 보고하지 않음 */ }

        await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                zones: selectedZones,
                options: pushSettings, // 여기에 master(ON/OFF) 상태가 포함됨
                deviceId: deviceId,
                osPermission: osPermission
            })
        });
        console.log('Server subscription updated:', pushSettings.master ? 'ON' : 'OFF', '| Zones:', selectedZones.length);
    } catch (e) {
        console.error('Subscription error:', e);
    }
};

/**
 * 폰의 알림 권한이 허용돼 있으면 앱 설정의 "푸시 알림 받기"(master)를 자동으로 켠다.
 * 단, 사용자가 앱 설정에서 **직접 끈 경우**(push_master_user_off === '1')는 건드리지 않는다.
 * 예: 새로 설치해 권한 허용 → master=true 저장 / 설정에서 끄고 앱을 다시 켬 → 그대로 끔
 * @returns {boolean} 켰으면 true, 직접 끈 표시가 있어 건드리지 않았으면 false
 * [연계] ← initPushNotifications(권한 허용 확인 직후, 앱을 켤 때마다)
 *        ↔ js/settings/settings.js markPushMasterUserOff — 그쪽이 "직접 껐음" 표시를 남기고 지운다.
 *        → 저장값은 subscribeUser 가 읽어 서버(/api/subscribe)로 보낸다.
 * [왜] 2026-11-18: 종전에는 표시 없이 매번 켬으로 덮어써, 앱에서 알림을 꺼도 다음 실행 때
 *      다시 켜져 서버에도 켬으로 전달됐다(끈 사용자에게 푸시가 다시 감 · 구독 통계의 "알림 끔"도 틀어짐).
 */
function autoEnableMasterOnGrant() {
    try {
        if (localStorage.getItem('push_master_user_off') === '1') return false;
        const NOTI_KEY = 'notificationSettings_v1';
        const saved = localStorage.getItem(NOTI_KEY);
        const notiSettings = saved ? JSON.parse(saved) : {
            master: false, target: 'interest',
            announce: true, active: true, release: true, night: true
        };
        notiSettings.master = true;
        localStorage.setItem(NOTI_KEY, JSON.stringify(notiSettings));

        // UI가 이미 로드된 경우 토글 상태도 동기화
        const masterToggle = document.getElementById('push-master-toggle');
        if (masterToggle) masterToggle.checked = true;
        return true;
    } catch (e) {
        console.error('[Push] 알림 설정 자동 ON 실패:', e);
        return false;
    }
}

const initPushNotifications = async () => {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

    const { PushNotifications } = window.Capacitor.Plugins;

    // 1. 리스너 등록
    // 성공 시: 서버로 전송
    await PushNotifications.addListener('registration', (token) => {
        console.log('Push Registration Success. Token:', token.value);
        window.subscribeUser(token.value);
        // [위치기반 특보 C] 신규/회전(rotate) 토큰 즉시 동의 재등록.
        //   토큰이 바뀌면 서버 consent 기록(토큰 기준 upsert)이 새 토큰에 없어 wake 대상에서
        //   빠진다 → subscribeUser 가 push_token 을 저장한 직후 재등록(활성+동의 단말만 POST).
        //   약간 지연: subscribeUser 의 localStorage 저장 완료 + UI 모듈 로드 보장. 완전 방어적.
        try {
            setTimeout(() => {
                try {
                    if (window.LocationAlertUI
                        && typeof window.LocationAlertUI.resyncConsentToServer === 'function') {
                        window.LocationAlertUI.resyncConsentToServer();
                    }
                } catch (_) { /* 방어적 — 무시 */ }
            }, 500);
        } catch (_) { /* 방어적 — 무시 */ }
    });

    // 실패 시
    await PushNotifications.addListener('registrationError', (error) => {
        console.error('Push Registration Error:', error);
    });

    // 알림 수신 시 (앱이 열려있을 때)
    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push received:', notification);
        // [위치기반 특보] 깨우는 신호(데이터 메시지).
        //   네이티브 모듈이 있는(최신) 앱은 네이티브가 모든 상태(켜짐/백그라운드/종료)를 처리함이
        //   실기기에서 확인됨 → JS 경로는 건너뛴다(중복 알림 방지). 구버전 앱(네이티브 없음)만 JS 처리.
        try {
            const data = (notification && notification.data) || {};
            if (data.type === 'location_alert_wake' && window.LocationAlertRuntime) {
                const ui = window.LocationAlertUI;
                if (ui && typeof ui.isNativeCapable === 'function') {
                    ui.isNativeCapable().then((cap) => { if (!cap) window.LocationAlertRuntime.handleWake(data.snapshot, data); });
                } else {
                    window.LocationAlertRuntime.handleWake(data.snapshot, data);
                }
            }
            // [위치기반 태풍 반경 알림 — Phase 2b] 깨우는 신호(데이터 메시지).
            //   ★ Phase 2b 부터 네이티브가 typhoon_radius_wake 를 모든 상태(포그라운드 포함)에서
            //   처리한다 → native-capable 단말에선 JS 를 skip(중복 알림 방지). 웹/구버전 앱만 JS 처리.
            //   (location_alert_wake 게이트와 동일 패턴.)
            if (data.type === 'typhoon_radius_wake' && window.LocationAlertTyphoonRuntime) {
                const uiT = window.LocationAlertUI;
                if (uiT && typeof uiT.isNativeCapable === 'function') {
                    uiT.isNativeCapable().then((cap) => { if (!cap) window.LocationAlertTyphoonRuntime.handleTyphoonWake(data); });
                } else {
                    window.LocationAlertTyphoonRuntime.handleTyphoonWake(data);
                }
            }
        } catch (e) { console.error('location_alert_wake 처리 실패:', e); }
    });

    // 알림 클릭 시
    await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        const data = notification.notification.data;
        if (data && data.url) {
            // [수정] 현재 페이지가 index.html이고 팝업 데이터가 포함된 경우 페이지 새로고침(스플래시 재노출) 방지
            try {
                const targetUrl = new URL(data.url, window.location.origin);
                const isSamePage = targetUrl.pathname.endsWith('index.html') || targetUrl.pathname === '/';

                if (isSamePage && targetUrl.searchParams.get('popup') === 'true') {
                    // URL 파라미터만 업데이트하고 팝업 함수 직접 호출
                    window.history.replaceState(null, '', data.url);
                    if (typeof window.checkForPushPopup === 'function') {
                        window.checkForPushPopup();
                    }
                } else {
                    window.location.href = data.url;
                }
            } catch (e) {
                window.location.href = data.url;
            }
        }
    });

    // [위치기반 태풍 반경 알림 — Phase 2a] 로컬 알림 탭 라우팅.
    //   태풍 경보는 LocalNotifications(로컬 알림)로 표출되므로 PushNotifications 의
    //   actionPerformed 가 아니라 LocalNotifications.localNotificationActionPerformed 로 탭을 받는다.
    //   기존 push 라우팅과 별개(서로 간섭 없음). 플러그인 부재 시 안전하게 skip.
    try {
        const { LocalNotifications } = window.Capacitor.Plugins;
        if (LocalNotifications && typeof LocalNotifications.addListener === 'function') {
            await LocalNotifications.addListener('localNotificationActionPerformed', (ev) => {
                try {
                    const url = ev && ev.notification && ev.notification.extra && ev.notification.extra.url;
                    if (!url) return;
                    // 기존 push 핸들러와 동일한 same-page 처리 스타일 재사용.
                    const targetUrl = new URL(url, window.location.origin);
                    const isSamePage = targetUrl.pathname.endsWith('index.html') || targetUrl.pathname === '/';
                    if (isSamePage && targetUrl.searchParams.get('popup') === 'true') {
                        window.history.replaceState(null, '', url);
                        if (typeof window.checkForPushPopup === 'function') window.checkForPushPopup();
                    } else {
                        window.location.href = url;
                    }
                } catch (_) {
                    try { if (ev && ev.notification && ev.notification.extra && ev.notification.extra.url) window.location.href = ev.notification.extra.url; } catch (__) { }
                }
            });
        }
    } catch (e) { console.error('localNotificationActionPerformed 리스너 등록 실패(무시):', e); }

    // 2. 권한 확인 및 요청
    let permStatus = await PushNotifications.checkPermissions();

    if (permStatus.receive === 'prompt') {
        // 최초 실행: 커스텀 팝업으로 알림 허용 유도
        const hasAskedBefore = localStorage.getItem('push_permission_asked');

        if (!hasAskedBefore) {
            // DOM 준비 대기
            await new Promise((resolve) => {
                if (document.readyState === 'complete' || document.readyState === 'interactive') {
                    resolve();
                } else {
                    window.addEventListener('DOMContentLoaded', resolve, { once: true });
                }
            });

            const userAccepted = await showCustomPopup({
                icon: '<svg viewBox="0 0 24 24" stroke="#448aff"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
                iconBg: 'rgba(68, 138, 255, 0.12)',
                title: '실시간 특보 알림 안내',
                message: '해상 특보가 발표되면<br>실시간 푸시 알림으로 알려드립니다.<br><br>다음 화면에서 반드시<br><span style="color: #ffd600; font-weight: bold;">허용을 눌러주세요.</span><br><br><img src="images/push_permission_guide.png" alt="알림 허용 안내" style="width: 85%; border-radius: 12px; margin: 8px auto; display: block; border: 1px solid rgba(255,255,255,0.15);"><br><span style="color: #ef5350; font-weight: bold;">허용하지 않으면 실시간 특보 알림을 받을 수 없습니다.</span><br><br><span style="font-size: 0.82rem; color: #64748b;">알림은 설정에서 언제든 변경할 수 있습니다.</span>',
                confirmText: '확인'
            });

            localStorage.setItem('push_permission_asked', 'true');
        }

        permStatus = await PushNotifications.requestPermissions();

    }

    if (permStatus.receive === 'granted') {
        await PushNotifications.register();

        // 시스템에서 허용한 경우: 설정의 "푸시 알림 받기" 토글 자동 ON — 단, 사용자가 직접 끈 경우는 그대로 둔다
        autoEnableMasterOnGrant();
    } else if (localStorage.getItem('push_token')) {
        // 권한이 꺼져 있으면 register() 를 안 부르므로 등록 이벤트(→ subscribeUser)도 안 온다.
        // 예전에 등록된 적 있는 기기(토큰 보유)만 "지금 권한이 꺼져 있다"를 서버에 알린다.
        window.subscribeUser();
    }
};

// 시스템 설정화면 열기
window.openAppSettings = async () => {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const { NativeSettings } = window.Capacitor.Plugins;
        if (!NativeSettings) {
            return;
        }
        try {
            await NativeSettings.open({
                optionAndroid: 'app_notification',
                optionIOS: 'App'
            });
        } catch (e) {
            try {
                await NativeSettings.open({
                    optionAndroid: 'application_details',
                    optionIOS: 'App'
                });
            } catch (e2) {
            }
        }
    } else {
    }
};

// [위치기반 특보] 위치 권한 설정 — 알림 설정이 아니라 "앱 정보(권한)" 화면으로 이동.
//   여기서 권한 > 위치 > "항상 허용" 까지 설정 가능. (openAppSettings 는 알림 설정으로 감)
window.openAppLocationSettings = async () => {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const { NativeSettings } = window.Capacitor.Plugins;
        if (!NativeSettings) return;
        try {
            await NativeSettings.open({
                optionAndroid: 'application_details',
                optionIOS: 'App'
            });
        } catch (e) {
        }
    }
};

// [위치기반 특보] 전경 위치 "권한만" 요청(위치 획득 없이 — 빠름). 동의 흐름의 GPS 대기 지연 제거.
window.requestForegroundLocationPermission = async () => {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return 'granted';
    try {
        let st = await Geolocation.checkPermissions();
        const loc = st && st.location;
        if (loc === 'prompt' || loc === 'prompt-with-rationale' || loc === 'prompt-with-description') {
            st = await Geolocation.requestPermissions();
        }
        return (st && st.location) || 'denied';
    } catch (e) {
        return 'denied';
    }
};

// 권한 상태 확인
window.checkPushPermission = async () => {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return 'granted';
    try {
        const { PushNotifications } = window.Capacitor.Plugins;
        const status = await PushNotifications.checkPermissions();
        return status.receive;
    } catch (e) {
        return 'granted';
    }
};

// ============================================================================
// [알림 권한 팝업] 앱 스타일에 맞춘 커스텀 팝업 시스템
// ============================================================================

/**
 * 커스텀 팝업을 표시하고 사용자 선택을 Promise로 반환
 * @param {Object} options - 팝업 옵션
 * @param {string} options.icon - SVG 아이콘 HTML
 * @param {string} options.iconBg - 아이콘 배경색
 * @param {string} options.title - 팝업 제목
 * @param {string} options.message - 팝업 메시지 (HTML 가능)
 * @param {string} options.confirmText - 확인 버튼 텍스트
 * @param {string} [options.cancelText] - 취소 버튼 텍스트 (없으면 확인 버튼만 표시)
 * @returns {Promise<boolean>} 확인: true, 취소: false
 */
function showCustomPopup({ icon, iconBg, title, message, confirmText, cancelText }) {
    return new Promise((resolve) => {
        if (document.getElementById('custom-popup-overlay')) {
            document.getElementById('custom-popup-overlay').remove();
        }

        const overlay = document.createElement('div');
        overlay.id = 'custom-popup-overlay';
        overlay.innerHTML = `
            <style>
                #custom-popup-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.75);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 999999;
                    padding: 24px;
                    backdrop-filter: blur(4px);
                    -webkit-backdrop-filter: blur(4px);
                    animation: popupFadeIn 0.25s ease-out;
                }
                @keyframes popupFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .custom-popup {
                    background: linear-gradient(135deg, #161b2d 0%, #1a2238 100%);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 20px;
                    padding: 36px 28px 28px;
                    max-width: 320px;
                    width: 100%;
                    text-align: center;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                    animation: popupSlideUp 0.3s ease-out;
                }
                @keyframes popupSlideUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .custom-popup-icon {
                    width: 64px;
                    height: 64px;
                    margin: 0 auto 20px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .custom-popup-icon svg {
                    width: 32px;
                    height: 32px;
                    fill: none;
                    stroke-width: 2;
                    stroke-linecap: round;
                    stroke-linejoin: round;
                }
                .custom-popup-title {
                    font-family: 'Inter', 'Noto Sans KR', sans-serif;
                    font-size: 1.2rem;
                    font-weight: 700;
                    color: #ffffff;
                    margin-bottom: 12px;
                }
                .custom-popup-message {
                    font-family: 'Inter', 'Noto Sans KR', sans-serif;
                    font-size: 0.92rem;
                    color: #94a3b8;
                    line-height: 1.7;
                    margin-bottom: 28px;
                }
                .custom-popup-buttons {
                    display: flex;
                    gap: 10px;
                }
                .custom-popup-btn {
                    flex: 1;
                    padding: 14px;
                    border: none;
                    border-radius: 12px;
                    font-family: 'Inter', 'Noto Sans KR', sans-serif;
                    font-size: 0.95rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s;
                    -webkit-tap-highlight-color: transparent;
                }
                .custom-popup-btn.confirm {
                    background: #448aff;
                    color: #ffffff;
                }
                .custom-popup-btn.confirm:active {
                    background: #2962ff;
                }
                .custom-popup-btn.cancel {
                    background: rgba(255, 255, 255, 0.08);
                    color: #94a3b8;
                }
                .custom-popup-btn.cancel:active {
                    background: rgba(255, 255, 255, 0.15);
                }
            </style>
            <div class="custom-popup">
                <div class="custom-popup-icon" style="background: ${iconBg}">
                    ${icon}
                </div>
                <div class="custom-popup-title">${title}</div>
                <div class="custom-popup-message">${message}</div>
                <div class="custom-popup-buttons">
                    ${cancelText ? `<button class="custom-popup-btn cancel" id="custom-popup-cancel">${cancelText}</button>` : ''}
                    <button class="custom-popup-btn confirm" id="custom-popup-confirm">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        document.getElementById('custom-popup-confirm').addEventListener('click', () => cleanup(true));
        const cancelBtn = document.getElementById('custom-popup-cancel');
        if (cancelBtn) cancelBtn.addEventListener('click', () => cleanup(false));
    });
}

// 전역 노출 (settings.js에서 사용)
window.showCustomPopup = showCustomPopup;

// [위치 정보] Capacitor를 이용한 위치 정보 획득 (권한 요청 포함)
window.getCurrentPositionViaCapacitor = async () => {
    // 1. 네이티브 모드가 아니면 기본 브라우저 기능 사용 시도
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false,
                timeout: 15000, // 10초에서 15초로 증가
                maximumAge: 10000 // 60초에서 10초로 단축 (더 신선한 좌표 우선)
            });
        });
    }

    // 2. 권한 확인 및 요청
    let permStatus = await Geolocation.checkPermissions();
    if (permStatus.location === 'prompt' || permStatus.location === 'prompt-with-description') {
        permStatus = await Geolocation.requestPermissions();
    }

    if (permStatus.location !== 'granted') {
        throw new Error('location_permission_denied');
    }

    // 3. 현재 위치 획득
    const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: false, // 배터리 절약 및 속도를 위해 정확도 낮춤
        timeout: 20000 // 네이티브 환경은 조금 더 여유있게 20초 부여
    });

    return position;
};

// ============================================================================
// [앱 업데이트 체크] 서버의 최신 버전과 현재 앱 버전을 비교하여 업데이트 유도
// ============================================================================

/**
 * 시맨틱 버전 비교 (예: "1.0.0" < "1.1.0" → true)
 * a가 b보다 낮으면 true 반환
 */
function isVersionLower(a, b) {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const numA = partsA[i] || 0;
        const numB = partsB[i] || 0;
        if (numA < numB) return true;
        if (numA > numB) return false;
    }
    return false;
}

// [업데이트 안내 창 — 시안 C] (2026-11-20, 사용자 확정)
//   사용자 원문: 「3안 처럼 반영하고자 하는데, 업데이트하러가기 버튼 내 텍스트 바로 아래 플레이스토어로 이동합니다. 라고 작게 명시」
//              「하루(24시간) 뒤 … 이대로 하자.」
//   - 새 아이콘 · 「새 버전이 나왔어요」 · v현재 → v최신 · 바뀐 점 목록 · [업데이트하러 가기(Play 스토어로 이동합니다)] · [나중에]
//   - 바뀐 점 목록은 관리자 센터 버전 탭의 「업데이트 메시지」에서 온다(/api/app-version 의 updateMessage — 서버 services/app_version_store.js).
//     입력 규칙: 한 줄 = 목록 한 칸, 줄 맨 앞 이모지 = 왼쪽 아이콘(없으면 •), 「|」 뒤 = 작은 설명.
//   - [나중에] → 창을 닫고 24시간 동안 다시 띄우지 않는다(UPDATE_POPUP_LATER_KEY). 앱 안 업데이트(IN_APP_UPDATE_ASK_GAP_MS)와 같은 간격.
//   - 이 창은 서버에서 내려가는 화면이라 1.1.1 앱에도 그대로 뜬다(APK 업데이트 불필요).
const UPDATE_POPUP_LATER_KEY = 'seagnal_update_popup_later_at';
const UPDATE_POPUP_LATER_MS = 24 * 60 * 60 * 1000;

/** HTML 특수문자를 막는다 — 업데이트 메시지는 관리자 입력이지만 화면에 그대로 끼우므로 막아 둔다. */
function escapeUpdateText(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 줄 맨 앞 이모지를 찾는 정규식. ★문자 속성(\p{…})을 모르는 오래된 WebView 에서 정규식을 "글자"로 적으면
//   이 파일 전체가 문법 오류로 안 돌아 푸시 초기화까지 멈춘다 → new RegExp 로 만들고, 실패하면 이모지 없이(•) 보인다.
let _leadingEmojiRe;
function getLeadingEmojiRe() {
    if (_leadingEmojiRe !== undefined) return _leadingEmojiRe;
    try {
        _leadingEmojiRe = new RegExp('^((?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})(?:\\uFE0F|\\u20E3|\\u200D(?:\\p{Extended_Pictographic}|\\uFE0F)|\\p{Emoji_Modifier}|\\p{Regional_Indicator})*)\\s*', 'u');
    } catch (_) {
        _leadingEmojiRe = null; // 문자 속성을 모르는 WebView — 아이콘은 기본 점(•)으로 보인다
    }
    return _leadingEmojiRe;
}

/**
 * 업데이트 메시지를 목록 칸으로 나눈다.
 * 예: '🔔 알림이 위에 떠요 | 놓치지 않게\n그냥 한 줄' → [{icon:'🔔', title:'알림이 위에 떠요', sub:'놓치지 않게'}, {icon:'•', title:'그냥 한 줄', sub:''}]
 * @param {string} message - 관리자 센터 「업데이트 메시지」
 * @returns {{icon:string, title:string, sub:string}[]}
 * [연계] ← showUpdatePopup · 관리자 센터 미리 보기(window.SeagnalUpdatePopup.parse)
 */
function parseUpdateItems(message) {
    return String(message || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
        let icon = '•';
        let rest = line;
        // 줄 맨 앞 이모지(이어 붙는 변형 문자·ZWJ 조합 포함) 하나를 아이콘으로 쓴다.
        const re = getLeadingEmojiRe();
        const m = re ? line.match(re) : null;
        if (m) { icon = m[1]; rest = line.slice(m[0].length); }
        const bar = rest.indexOf('|');
        const title = (bar >= 0 ? rest.slice(0, bar) : rest).trim();
        const sub = bar >= 0 ? rest.slice(bar + 1).trim() : '';
        return { icon, title, sub };
    }).filter((it) => it.title || it.sub);
}

/**
 * 업데이트 안내 창(시안 C)을 띄운다.
 * 예: showUpdatePopup('1.1.1', '1.3.0', '🔔 알림이 위에 떠요 | 놓치지 않게', 'https://play.google.com/…')
 * @param {string} currentVersion @param {string} latestVersion @param {string} updateMessage @param {string} playStoreUrl
 * @param {{preview?:boolean}} [opts] - preview: 관리자 센터 미리 보기(「나중에」 기록을 남기지 않는다)
 * [연계] ← checkAppUpdate(서버 버전이 더 높을 때) · admin.js 버전 탭 미리 보기 / → Browser.open(Play 스토어)
 */
function showUpdatePopup(currentVersion, latestVersion, updateMessage, playStoreUrl, opts) {
    // 이미 팝업이 있으면 중복 생성 방지
    if (document.getElementById('app-update-overlay')) return;
    const preview = !!(opts && opts.preview);
    const items = parseUpdateItems(updateMessage);
    const listHTML = items.length ? `<div class="update-list">${items.map((it) => `
                <div class="update-item"><span class="update-item-icon">${escapeUpdateText(it.icon)}</span><span class="update-item-text">${escapeUpdateText(it.title)}${it.sub ? `<small>${escapeUpdateText(it.sub)}</small>` : ''}</span></div>`).join('')}
            </div>` : '';

    const overlay = document.createElement('div');
    overlay.id = 'app-update-overlay';
    overlay.innerHTML = `
        <style>
            #app-update-overlay {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.75);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 999999;
                padding: 24px;
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
            }
            #app-update-overlay .update-popup {
                background: linear-gradient(135deg, #161b2d 0%, #1a2238 100%);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 20px;
                padding: 32px 24px 22px;
                max-width: 330px;
                width: 100%;
                max-height: calc(100vh - 48px);
                overflow-y: auto;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                font-family: 'Inter', 'Noto Sans KR', sans-serif;
            }
            #app-update-overlay .update-appicon {
                width: 68px; height: 68px;
                border-radius: 16px;
                margin: 0 auto 16px;
                display: block;
                box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
            }
            #app-update-overlay .update-title { font-size: 1.2rem; font-weight: 700; color: #ffffff; margin-bottom: 8px; }
            #app-update-overlay .update-version { font-size: 0.85rem; color: #94a3b8; margin-bottom: 16px; }
            #app-update-overlay .update-version b { color: #60a5fa; font-weight: 700; }
            #app-update-overlay .update-list {
                text-align: left;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 14px;
                padding: 14px 14px 2px;
                margin-bottom: 22px;
            }
            #app-update-overlay .update-item { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 12px; font-size: 0.9rem; color: #cbd5e1; line-height: 1.45; }
            #app-update-overlay .update-item-icon {
                flex: none; width: 26px; height: 26px; border-radius: 8px;
                background: rgba(68, 138, 255, 0.14);
                display: flex; align-items: center; justify-content: center;
                font-size: 0.85rem; color: #60a5fa;
            }
            #app-update-overlay .update-item-text { word-break: keep-all; overflow-wrap: anywhere; }
            #app-update-overlay .update-item-text small { display: block; color: #7c8aa0; font-size: 0.78rem; margin-top: 2px; }
            #app-update-overlay .update-button {
                display: block; width: 100%;
                padding: 12px 15px;
                background: #448aff; color: #ffffff;
                border: none; border-radius: 12px;
                font-family: inherit; font-size: 1rem; font-weight: 600;
                cursor: pointer;
                -webkit-tap-highlight-color: transparent;
            }
            #app-update-overlay .update-button:active { background: #2962ff; }
            #app-update-overlay .update-button small { display: block; font-size: 0.72rem; font-weight: 500; opacity: 0.85; margin-top: 3px; }
            #app-update-overlay .update-later {
                display: block; width: 100%;
                margin-top: 8px; padding: 10px;
                background: none; border: none;
                color: #94a3b8; font-family: inherit; font-size: 0.9rem;
                cursor: pointer;
                -webkit-tap-highlight-color: transparent;
            }
        </style>
        <div class="update-popup">
            <img class="update-appicon" src="assets/app_update_icon.png" alt="">
            <div class="update-title">새 버전이 나왔어요</div>
            <div class="update-version">v${escapeUpdateText(currentVersion)} → <b>v${escapeUpdateText(latestVersion)}</b></div>
            ${listHTML}
            <button class="update-button" id="app-update-btn">업데이트하러 가기<small>Play 스토어로 이동합니다</small></button>
            <button class="update-later" id="app-update-later-btn">나중에</button>
        </div>
    `;

    document.body.appendChild(overlay);

    // 업데이트 버튼 클릭 → Play Store로 이동 (Capacitor Browser 플러그인 사용)
    document.getElementById('app-update-btn').addEventListener('click', () => {
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            Browser.open({ url: playStoreUrl }).catch(() => {
                window.open(playStoreUrl, '_blank');
            });
        } else {
            window.open(playStoreUrl, '_blank');
        }
    });

    // 나중에 → 창을 닫고, 24시간 동안 다시 띄우지 않는다(미리 보기는 기록하지 않는다).
    document.getElementById('app-update-later-btn').addEventListener('click', () => {
        if (!preview) {
            try { localStorage.setItem(UPDATE_POPUP_LATER_KEY, String(Date.now())); } catch (_) { /* 저장소를 못 쓰면 다음 실행 때 다시 뜰 뿐이다 */ }
        }
        if (typeof overlay.remove === 'function') overlay.remove();
        else if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });
}

/** 「나중에」를 누른 지 24시간이 안 됐는가. 예: 1시간 전에 눌렀으면 true. [연계] ← checkAppUpdate */
function isUpdatePopupSnoozed() {
    let at = 0;
    try { at = Number(localStorage.getItem(UPDATE_POPUP_LATER_KEY)) || 0; } catch (_) { at = 0; }
    return !!at && Date.now() - at < UPDATE_POPUP_LATER_MS;
}

// 관리자 센터 버전 탭의 미리 보기가 같은 창을 띄우도록 내보낸다(이 파일은 module 이라 전역이 아니다).
if (typeof window !== 'undefined') {
    window.SeagnalUpdatePopup = {
        parse: parseUpdateItems,
        preview: (current, latest, message, url) => showUpdatePopup(current, latest, message, url, { preview: true }),
    };
}

// ----------------------------------------------------------------------------
// [앱 안 업데이트 — 유연형] (2026-11-19, 사용자 확정)
//   새 APK(네이티브 SeagnalAppUpdate 플러그인 — android/.../update/AppUpdatePlugin.java)에서만 동작한다.
//   흐름: 앱 시작 → Play 스토어에 새 버전을 묻는다 → 있으면 Play 의 「업데이트할까요?」 창 →
//         [업데이트]를 누르면 앱을 쓰는 동안 뒤에서 내려받는다 → 다 받으면 화면 아래 「다시 시작」 띠.
//   못 쓰는 경우(옛 APK·스토어 밖 설치·Play 가 유연형을 불허)는 false 를 돌려줘 아래 종전 방식
//   (서버 버전 비교 → 스토어 이동 팝업)이 그대로 돈다.
// ----------------------------------------------------------------------------

// 사용자가 Play 확인 창에서 [나중에]를 눌러도 앱을 켤 때마다 다시 묻지 않도록, 마지막으로 물은 시각을 남긴다.
//   이 간격이 없으면 하루에도 앱을 켤 때마다 「업데이트할까요?」 창이 뜬다.
const IN_APP_UPDATE_ASKED_KEY = 'seagnal_inapp_update_asked_at';
const IN_APP_UPDATE_ASK_GAP_MS = 24 * 60 * 60 * 1000;
// Play 에 새 버전을 묻는 호출(check)을 기다리는 한도. Capacitor 다리에는 시간 제한이 없어, Play 가 끝내 답하지 않으면
//   이 한도 없이는 종전 방식(스토어 팝업)으로도 못 넘어가 업데이트 안내가 아예 안 뜬다(독립 검토 A·B 지적).
const IN_APP_UPDATE_CHECK_TIMEOUT_MS = 10 * 1000;

/** 네이티브 앱 안 업데이트 플러그인(없으면 null — 옛 APK). */
function getInAppUpdatePlugin() {
    const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SeagnalAppUpdate;
    return (P && typeof P.check === 'function') ? P : null;
}

/**
 * 새 버전을 다 내려받았을 때 화면 아래에 「다시 시작」 띠를 띄운다.
 * 예: showUpdateReadyBar(AU) → 「새 버전을 내려받았습니다 [다시 시작]」 → 누르면 설치 후 앱이 새 버전으로 다시 켜진다
 * @param {object} AU - SeagnalAppUpdate 플러그인
 * [연계] ← tryInAppUpdate(앱 시작 때 이미 받아 둔 경우) · installState 리스너(쓰는 중에 다 받은 경우)
 *        → AU.complete() (AppUpdatePlugin.complete — Play 가 설치하고 앱을 다시 시작한다)
 */
function showUpdateReadyBar(AU) {
    if (!document.body || document.getElementById('app-update-ready-bar')) return; // 중복 생성 방지
    const bar = document.createElement('div');
    bar.id = 'app-update-ready-bar';
    bar.innerHTML = `
        <style>
            #app-update-ready-bar {
                position: fixed;
                left: 12px; right: 12px;
                bottom: calc(env(safe-area-inset-bottom, 0px) + 84px);
                z-index: 999990;
                display: flex; align-items: center; justify-content: space-between; gap: 12px;
                padding: 12px 14px;
                background: linear-gradient(135deg, #161b2d 0%, #1a2238 100%);
                border: 1px solid rgba(96, 165, 250, 0.45);
                border-radius: 14px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
                color: #e2e8f0;
                font-family: 'Inter', 'Noto Sans KR', sans-serif;
                font-size: 0.9rem; font-weight: 600;
            }
            #app-update-ready-bar button {
                flex: none;
                padding: 9px 16px;
                background: #2563eb; color: #fff;
                border: none; border-radius: 10px;
                font-size: 0.88rem; font-weight: 700;
                cursor: pointer;
            }
            #app-update-ready-bar button:disabled { opacity: 0.6; }
        </style>
        <span>새 버전을 내려받았습니다.</span>
        <button type="button" id="app-update-restart-btn">다시 시작</button>
    `;
    document.body.appendChild(bar);
    const btn = document.getElementById('app-update-restart-btn');
    btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = '설치 중…';
        // 성공하면 앱이 다시 시작되므로 아래 then 은 보통 실행되지 않는다. 실패하면 버튼을 되살린다.
        AU.complete().catch((e) => {
            console.error('[AppUpdate] 설치 시작 실패:', e && e.message);
            btn.disabled = false;
            btn.textContent = '다시 시작';
        });
    });
}

/**
 * 앱 안 업데이트(유연형)를 시도한다.
 * 예: 새 APK + Play 에 새 버전 있음 → Play 확인 창을 띄우고 true · 옛 APK → false(종전 방식으로)
 * @returns {Promise<boolean>} true = 이 길이 맡았다(종전 스토어 팝업을 띄우지 않는다) · false = 못 썼다(종전 방식으로)
 * [연계] ← checkAppUpdate / → AppUpdatePlugin(check·start·complete) · showUpdateReadyBar
 */
async function tryInAppUpdate() {
    const AU = getInAppUpdatePlugin();
    if (!AU) return false; // 옛 APK — 플러그인 없음

    // 쓰는 중에 내려받기가 끝나면 「다시 시작」 띠를 띄운다. 실패·취소면 다음 실행 때 다시 묻도록 기록을 지운다.
    //   ★check 보다 먼저 건다 — check 응답("내려받는 중")과 리스너 등록 사이에 완료 사건이 오면 놓친다(독립 검토 B).
    const onListenFail = (e) => console.warn('[AppUpdate] 상태 리스너 등록 실패(다 받으면 다음 실행 때 띠가 뜬다):', e && e.message);
    try {
        Promise.resolve(AU.addListener('installState', (s) => {
            if (!s) return;
            if (s.downloaded) showUpdateReadyBar(AU);
            else if (s.status === 'failed' || s.status === 'canceled') {
                console.warn('[AppUpdate] 내려받기 ' + s.status + ' — 다음 실행 때 다시 묻는다');
                try { localStorage.removeItem(IN_APP_UPDATE_ASKED_KEY); } catch (_) { /* 저장소를 못 쓰면 간격 기록도 없다 — 다음 실행 때 어차피 다시 묻는다 */ }
            }
        })).catch(onListenFail);
    } catch (e) {
        onListenFail(e);
    }

    let info;
    try {
        info = await Promise.race([
            AU.check(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('check timeout')), IN_APP_UPDATE_CHECK_TIMEOUT_MS)),
        ]);
    } catch (e) {
        // Play 에 물을 수 없다(스토어 밖 설치 등)·답이 없다 → 종전 방식.
        console.warn('[AppUpdate] 앱 안 업데이트 확인 불가 → 종전 방식:', e && e.message);
        return false;
    }
    if (!info) return false;
    if (info.known === false) return false;                         // Play 가 "모름"이라고 답함 → 종전 방식(독립 검토 B)

    if (info.downloaded) { showUpdateReadyBar(AU); return true; }   // 이미 받아 둠 → 설치만 남았다
    if (info.inProgress) return true;                               // 내려받는 중 → 리스너가 이어받는다
    if (!info.updateAvailable) {                                    // Play 기준 최신
        console.log('[AppUpdate] Play 기준 최신 버전입니다.');
        return true;
    }
    if (!info.flexibleAllowed) return false;                        // 새 버전은 있는데 유연형 불가 → 종전 방식(스토어)

    // 마지막으로 물은 지 하루가 안 됐으면 다시 묻지 않는다.
    let askedAt = 0;
    try { askedAt = Number(localStorage.getItem(IN_APP_UPDATE_ASKED_KEY)) || 0; } catch (_) { askedAt = 0; }
    if (askedAt && Date.now() - askedAt < IN_APP_UPDATE_ASK_GAP_MS) return true;
    try { localStorage.setItem(IN_APP_UPDATE_ASKED_KEY, String(Date.now())); } catch (_) { /* 저장소를 못 쓰면 다음 실행 때 다시 묻게 될 뿐이다 */ }

    try {
        const r = await AU.start(); // Play 확인 창 — 사용자가 고를 때까지 기다린다
        console.log('[AppUpdate] 앱 안 업데이트 ' + (r && r.accepted ? '수락 — 뒤에서 내려받는다' : '보류(나중에)'));
        return true;
    } catch (e) {
        // 창을 못 띄웠다 → 물은 기록을 지우고 종전 방식으로.
        console.warn('[AppUpdate] 앱 안 업데이트 시작 실패 → 종전 방식:', e && e.message);
        try { localStorage.removeItem(IN_APP_UPDATE_ASKED_KEY); } catch (_) { /* 위와 같다 */ }
        return false;
    }
}

/**
 * 앱 시작 시 업데이트를 확인한다.
 *   ① 앱 안 업데이트(유연형)를 먼저 시도하고(tryInAppUpdate),
 *   ② 그 길을 못 쓰면 종전대로 서버에서 최신 버전을 확인해 팝업(스토어 이동)을 띄운다.
 */
const checkAppUpdate = async () => {
    // 네이티브 앱에서만 동작 (브라우저에서는 무시)
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

    // ① 앱 안 업데이트 — 여기서 맡았으면 끝. 어떤 예외가 나도 종전 방식(②)은 그대로 돈다.
    try {
        if (await tryInAppUpdate()) return;
    } catch (e) {
        console.warn('[AppUpdate] 앱 안 업데이트 처리 중 예외 → 종전 방식:', e && e.message);
    }

    try {
        // 현재 앱 버전 가져오기 (@capacitor/app 플러그인)
        const appInfo = await App.getInfo();
        if (!appInfo || !appInfo.version) {
            console.log('[AppUpdate] 앱 버전 정보를 가져올 수 없습니다.');
            return;
        }
        const currentVersion = appInfo.version; // build.gradle의 versionName

        // 서버에서 최신 버전 조회
        const response = await fetch('/api/app-version?_t=' + Date.now());
        if (!response.ok) return;

        const data = await response.json();
        const { latestVersion, updateMessage, playStoreUrl } = data;

        if (!latestVersion) return;

        // 버전 비교: 현재 버전이 최신 버전보다 낮으면 업데이트 팝업 표시
        if (isVersionLower(currentVersion, latestVersion)) {
            console.log(`[AppUpdate] 업데이트 필요: ${currentVersion} → ${latestVersion}`);
            // 「나중에」를 누른 지 24시간이 안 됐으면 이번에는 띄우지 않는다(시안 C, 2026-11-20 사용자 확정).
            if (isUpdatePopupSnoozed()) { console.log('[AppUpdate] 「나중에」 24시간 안 — 이번에는 안내 창을 띄우지 않는다'); return; }
            // DOM이 준비된 후 팝업 표시
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                showUpdatePopup(currentVersion, latestVersion, updateMessage, playStoreUrl);
            } else {
                window.addEventListener('DOMContentLoaded', () => {
                    showUpdatePopup(currentVersion, latestVersion, updateMessage, playStoreUrl);
                });
            }
        } else {
            console.log(`[AppUpdate] 최신 버전입니다: ${currentVersion}`);
        }
    } catch (e) {
        console.error('[AppUpdate] 업데이트 확인 실패:', e.message);
    }
};

initPushNotifications();
checkAppUpdate();

// [음성 비서 삭제 2026-11-19] 사용자 지시로 마이크·호출어 듣기·음성 모델을 앱에서 뺐다(끄는 화면도 없어졌다).
//   옛 시험용 APK(1.1.2~1.2.2)에는 상시 청취 서비스가 아직 들어 있다 — 켜 둔 채 남아 있으면 여기서 끈다.
//   새 APK 와 스토어판(1.1.1)에는 disable 이 없어 아무 일도 하지 않는다.
try {
    const VA = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SeagnalAssistant;
    if (VA && typeof VA.disable === 'function') {
        Promise.resolve(VA.disable()).catch((e) => console.warn('[앱] 옛 음성 비서 서비스 끄기 실패:', e && e.message));
    }
} catch (e) { console.warn('[앱] 옛 음성 비서 서비스 끄기 실패:', e && e.message); }

// [위치기반 특보 #1] 앱 실행 시 fresh-fix 1회(이벤트 기반 전환).
//   상시 watcher/전경 서비스를 제거했으므로 "되살리기"가 아니라, 기능이 활성(+동의)이면
//   앱을 켤 때 그 시점 위치를 한 번 갱신해(ensureStarted→start→getFreshPosition) 다음 깨우는
//   신호 전까지의 폴백 정확도를 높인다. 실제 판정은 깨우는 신호 시점의 fresh-fix 가 담당.
//   푸시 리스너 등록(initPushNotifications) 이후에 호출. LocationAlertBackground 가 아직 로드되지
//   않았을 수 있어 약간 지연(setTimeout ~1500ms). 네이티브에서만 동작하며, 모든 호출은 방어적
//   (외부/내부 try/catch + setTimeout 콜백 내부에서도 네이티브/typeof 재확인).
if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    try {
        setTimeout(() => {
            try {
                if (typeof window !== 'undefined'
                    && window.Capacitor && window.Capacitor.isNativePlatform
                    && window.Capacitor.isNativePlatform()
                    && window.LocationAlertBackground
                    && typeof window.LocationAlertBackground.ensureStarted === 'function') {
                    window.LocationAlertBackground.ensureStarted();
                }
            } catch (e) { /* 방어적 — 무시 */ }
            // [위치기반 특보 B] 네이티브 게이팅 플래그 재미러 — 매 앱 실행마다.
            //   재설치/데이터 유실로 Preferences(location_alert_active/consent)가 비면 네이티브가
            //   매 wake 를 조용히 skip 했다(설정 모달을 열기 전까지 재미러 경로가 없었음).
            //   resyncNativeFlags 는 localStorage 의 "현재 저장 상태"만 미러 — OFF 를 ON 으로
            //   뒤집지 않는다. 멱등이라 설정 모달 init 과 중복 실행돼도 무해.
            try {
                if (window.LocationAlertUI
                    && typeof window.LocationAlertUI.resyncNativeFlags === 'function') {
                    window.LocationAlertUI.resyncNativeFlags();
                }
            } catch (e) { /* 방어적 — 무시 */ }
        }, 1500);
        // [위치기반 특보 C] 동의 사실 서버 재등록 — 매 앱 실행마다(활성+동의 단말만 POST).
        //   토글 시점에 push_token 이 없었거나 이후 토큰이 회전하면 서버 consent 기록이 현재
        //   토큰에 없어 wake 대상에서 빠진다. 푸시 등록(subscribeUser)이 push_token 을 저장할
        //   시간을 주기 위해 ~2.5초 지연. 서버 recordConsent 는 토큰 기준 upsert(멱등).
        setTimeout(() => {
            try {
                if (typeof window !== 'undefined'
                    && window.Capacitor && window.Capacitor.isNativePlatform
                    && window.Capacitor.isNativePlatform()
                    && window.LocationAlertUI
                    && typeof window.LocationAlertUI.resyncConsentToServer === 'function') {
                    window.LocationAlertUI.resyncConsentToServer();
                }
            } catch (e) { /* 방어적 — 무시 */ }
        }, 2500);
    } catch (e) { /* 방어적 — setTimeout 부재 등 무시 */ }
}

// ============================================================================
// [외부 링크 처리] Capacitor 앱에서 외부 링크를 시스템 브라우저로 열기
// ============================================================================
if (window.Capacitor && window.Capacitor.isNativePlatform()) {
    document.addEventListener('click', (e) => {
        const anchor = e.target.closest('a[target="_blank"]');
        if (!anchor) return;

        const href = anchor.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

        // 외부 URL인 경우 Capacitor Browser로 열기
        try {
            const url = new URL(href, window.location.origin);
            if (url.origin !== window.location.origin) {
                e.preventDefault();
                Browser.open({ url: href }).catch(() => {
                    window.open(href, '_blank');
                });
            }
        } catch (err) {
            // URL 파싱 실패 시 기본 동작
        }
    }, true);
}
