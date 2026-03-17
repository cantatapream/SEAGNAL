
// Capacitor 전역 객체 확보
import { Geolocation } from '@capacitor/geolocation';
import { App } from '@capacitor/app';
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
    if (permStatus.receive === 'prompt') {
        permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive === 'granted') {
        await PushNotifications.register();
    }
};

// 시스템 설정화면 열기
window.openAppSettings = async () => {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        const { NativeSettings } = window.Capacitor.Plugins;
        try {
            await NativeSettings.open({ option: 'app_notification' });
        } catch (e) {
            await NativeSettings.open({ option: 'application_details' });
        }
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

    // 업데이트 버튼 클릭 → Play Store로 이동
    document.getElementById('app-update-btn').addEventListener('click', () => {
        window.open(playStoreUrl, '_system');
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
