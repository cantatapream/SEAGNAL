
// Capacitor 전역 객체 확보
import { Geolocation } from '@capacitor/geolocation';
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

initPushNotifications();
