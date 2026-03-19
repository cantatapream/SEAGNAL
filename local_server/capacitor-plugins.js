
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

    // [수정] 전체 해역 목록 기준으로 필터링 (기본값 = true, 명시적 false만 제외)
    // app.js의 SUB_REGION_ZONES와 SEA_REGIONS를 사용해야 하지만, 
    // capacitor-plugins.js는 app.js보다 먼저 로드될 수 있으므로 하드코딩된 목록 사용
    const ALL_ZONES = [
        // 대분류
        '동해', '서해', '남해', '제주',
        // 중분류
        '동해남부해상', '동해중부해상', '서해중부해상', '서해남부해상', '남해동부해상', '남해서부해상', '제주해역',
        // 동해남부
        '울산앞바다', '경북남부앞바다', '경북북부앞바다', '동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다', '동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다',
        // 동해중부
        '강원북부앞바다', '강원중부앞바다', '강원남부앞바다', '동해중부안쪽먼바다', '동해중부바깥먼바다',
        // 서해중부
        '인천·경기북부앞바다', '인천·경기남부앞바다', '충남북부앞바다', '충남남부앞바다', '서해중부안쪽먼바다', '서해중부바깥먼바다',
        // 서해남부
        '전북북부앞바다', '전북남부앞바다', '전남북부서해앞바다', '전남중부서해앞바다', '전남남부서해앞바다', '서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다', '서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다',
        // 남해동부
        '부산앞바다', '경남서부남해앞바다', '경남중부남해앞바다', '거제시동부앞바다', '남해동부안쪽먼바다', '남해동부바깥먼바다',
        // 남해서부
        '전남서부남해앞바다', '전남동부남해앞바다', '남해서부서쪽먼바다', '남해서부동쪽먼바다',
        // 제주
        '제주도북부앞바다', '제주도남부앞바다', '제주도동부앞바다', '제주도서부앞바다', '제주도남서쪽안쪽먼바다', '제주도남동쪽안쪽먼바다', '제주도남쪽바깥먼바다'
    ];

    // 'all'이면 전체 목록, 'interest'면 개별 필터링 (기본값 = true, 명시적 false만 제외)
    const selectedZones = (pushSettings.target === 'all')
        ? ALL_ZONES
        : ALL_ZONES.filter(zone => userSettings[zone] !== false);

    try {
        await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: token,
                zones: selectedZones,
                options: pushSettings // 여기에 master(ON/OFF) 상태가 포함됨
            })
        });
        console.log('Server subscription updated:', pushSettings.master ? 'ON' : 'OFF', '| Zones:', selectedZones.length);
    } catch (e) {
        console.error('Subscription error:', e);
    }
};

const initPushNotifications = async () => {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

    const { PushNotifications } = window.Capacitor.Plugins;

    // 1. 리스너 등록
    // 성공 시: 서버로 전송
    await PushNotifications.addListener('registration', (token) => {
        console.log('Push Registration Success. Token:', token.value);
        window.subscribeUser(token.value);
    });

    // 실패 시
    await PushNotifications.addListener('registrationError', (error) => {
        console.error('Push Registration Error:', error);
    });

    // 알림 수신 시 (앱이 열려있을 때)
    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push received:', notification);
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

    // 2. 권한 확인 및 요청
    let permStatus = await PushNotifications.checkPermissions();

    // [DEBUG] 화면에 권한 상태 표시 (확인 후 제거)
    const _dbg = document.createElement('div');
    _dbg.id = 'push-debug-overlay';
    _dbg.style.cssText = 'position:fixed;bottom:10px;left:10px;right:10px;background:rgba(0,0,0,0.85);color:#0f0;font-size:11px;padding:10px;border-radius:8px;z-index:999999;font-family:monospace;white-space:pre-wrap;pointer-events:none;';
    _dbg.textContent = '[Push Debug]\ncheckPermissions: ' + permStatus.receive + '\ntime: ' + new Date().toLocaleTimeString();
    document.body.appendChild(_dbg);
    window._updatePushDebug = (msg) => { _dbg.textContent += '\n' + msg; };

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
        if (window._updatePushDebug) window._updatePushDebug('afterRequest: ' + permStatus.receive);
    }

    if (window._updatePushDebug) window._updatePushDebug('finalStatus: ' + permStatus.receive);

    if (permStatus.receive === 'granted') {
        await PushNotifications.register();
        if (window._updatePushDebug) window._updatePushDebug('register() called, master set to true');

        // 시스템에서 허용한 경우: 설정의 "푸시 알림 받기" 토글 자동 ON
        try {
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
        } catch (e) {
            console.error('[Push] 알림 설정 자동 ON 실패:', e);
        }
    }
};

// 시스템 설정화면 열기
window.openAppSettings = async () => {
    if (window._updatePushDebug) window._updatePushDebug('[openAppSettings] called');
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const { NativeSettings } = window.Capacitor.Plugins;
        if (!NativeSettings) {
            if (window._updatePushDebug) window._updatePushDebug('[openAppSettings] NativeSettings plugin NOT found');
            return;
        }
        try {
            if (window._updatePushDebug) window._updatePushDebug('[openAppSettings] trying app_notification');
            await NativeSettings.open({
                optionAndroid: 'app_notification',
                optionIOS: 'App'
            });
        } catch (e) {
            if (window._updatePushDebug) window._updatePushDebug('[openAppSettings] fallback: ' + e.message);
            try {
                await NativeSettings.open({
                    optionAndroid: 'application_details',
                    optionIOS: 'App'
                });
            } catch (e2) {
                if (window._updatePushDebug) window._updatePushDebug('[openAppSettings] all failed: ' + e2.message);
            }
        }
    } else {
        if (window._updatePushDebug) window._updatePushDebug('[openAppSettings] not native platform');
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

/**
 * 업데이트 팝업 HTML을 생성하고 body에 삽입
 */
function showUpdatePopup(currentVersion, latestVersion, updateMessage, playStoreUrl) {
    // 이미 팝업이 있으면 중복 생성 방지
    if (document.getElementById('app-update-overlay')) return;

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
            .update-popup {
                background: linear-gradient(135deg, #161b2d 0%, #1a2238 100%);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 20px;
                padding: 36px 28px 28px;
                max-width: 320px;
                width: 100%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            }
            .update-icon {
                width: 64px;
                height: 64px;
                margin: 0 auto 20px;
                border-radius: 50%;
                background: rgba(68, 138, 255, 0.12);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .update-icon svg {
                width: 32px;
                height: 32px;
                stroke: #448aff;
                fill: none;
                stroke-width: 2;
                stroke-linecap: round;
                stroke-linejoin: round;
            }
            .update-title {
                font-family: 'Inter', 'Noto Sans KR', sans-serif;
                font-size: 1.2rem;
                font-weight: 700;
                color: #ffffff;
                margin-bottom: 8px;
            }
            .update-version {
                font-family: 'Inter', 'Noto Sans KR', sans-serif;
                font-size: 0.85rem;
                color: #94a3b8;
                margin-bottom: 16px;
            }
            .update-message {
                font-family: 'Inter', 'Noto Sans KR', sans-serif;
                font-size: 0.95rem;
                color: #94a3b8;
                line-height: 1.6;
                margin-bottom: 28px;
            }
            .update-button {
                display: block;
                width: 100%;
                padding: 15px;
                background: #448aff;
                color: #ffffff;
                border: none;
                border-radius: 12px;
                font-family: 'Inter', 'Noto Sans KR', sans-serif;
                font-size: 1rem;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s;
                -webkit-tap-highlight-color: transparent;
            }
            .update-button:active {
                background: #2962ff;
            }
        </style>
        <div class="update-popup">
            <div class="update-icon">
                <svg viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </div>
            <div class="update-title">업데이트가 필요합니다</div>
            <div class="update-version">v${currentVersion} → v${latestVersion}</div>
            <p class="update-message">${updateMessage}</p>
            <button class="update-button" id="app-update-btn">업데이트</button>
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
}

/**
 * 앱 시작 시 서버에서 최신 버전을 확인하고, 업데이트가 필요하면 팝업 표시
 */
const checkAppUpdate = async () => {
    // 네이티브 앱에서만 동작 (브라우저에서는 무시)
    if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return;

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
