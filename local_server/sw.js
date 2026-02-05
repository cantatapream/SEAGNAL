// [SEAGNAL Push Service Worker] - v=TimeFormatUpdate_20260204 (Force Update)
// 캐싱 기능 없이 오직 푸시 알림 수신만 담당합니다.

self.addEventListener('install', (event) => {
    // 즉시 활성화
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // 즉시 제어권 가져오기
    event.waitUntil(self.clients.claim());
});

// 캐시 없이 네트워크만 사용 (혹시 모를 캐시 문제 원천 차단)
self.addEventListener('fetch', (event) => {
    // 아무것도 안 함 -> 브라우저 기본 동작(네트워크) 수행
    return;
});

// 🔔 푸시 알림 수신
self.addEventListener('push', (event) => {
    if (!event.data) return;

    try {
        const payload = event.data.json();
        const title = payload.title || '기상특보 알림';
        const options = {
            body: payload.body || '새로운 특보가 발표되었습니다.',
            icon: 'icon-192.png', // 앱 아이콘 경로
            badge: 'icon-192.png', // 상단바 작은 아이콘
            vibrate: [200, 100, 200],
            data: { url: payload.url || '/' },
            tag: 'weather-alert', // 중복 알림 덮어쓰기 (원하면 제거)
            renotify: true // tag가 같아도 다시 진동/알림
        };

        event.waitUntil(
            self.registration.showNotification(title, options)
        );
    } catch (e) {
        console.error('Push parse error:', e);
    }
});

// 🔔 알림 클릭 핸들러
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    // 클릭 시 앱 열기 (또는 포커스)
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // 이미 열린 창이 있으면 포커스
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if ('focus' in client) {
                    // 필요 시 URL 이동 로직 추가 가능 (client.navigate)
                    return client.focus();
                }
            }
            // 없으면 새로 열기
            if (clients.openWindow) {
                return clients.openWindow(event.notification.data.url || '/');
            }
        })
    );
});
