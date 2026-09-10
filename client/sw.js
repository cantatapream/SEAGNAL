/**
 * ============================================================================
 * 파일명: sw.js (Service Worker)
 * 역할 : 푸시 알림 수신 + 정적 자원 캐시 (C안 단위 3-A 적용)
 * ============================================================================
 *
 * [핵심 기능 두 가지]
 *
 * 1) 푸시 알림 수신 및 클릭 처리 (기존 기능 — 보존)
 *    - 서버에서 보낸 푸시 알림을 받아 표시
 *    - 알림 클릭 시 지정된 URL 로 앱 열기/포커스
 *
 * 2) 정적 자원 캐시 (신규 — 앱 시작 속도 개선)
 *    - 우리 서버의 정적 파일(JS/CSS/이미지/글꼴 등)을 휴대폰에 캐시
 *    - 두 번째 실행부터 캐시에서 즉시 응답 → 시작 속도 0.5~2초 단축
 *    - "Stale-While-Revalidate" 전략: 캐시 즉시 제공 + 백그라운드 갱신
 *
 * [캐시 안 하는 것 — 블랙리스트 방식]
 *   /api/*         → 모든 API 호출 (148개)
 *   /data/*        → JSON 데이터 직접 서빙
 *   /uploads/*     → 사용자 업로드 (게시판 첨부 등)
 *   /tide_data/*   → 조석 과거치 데이터 (용량 큼, 사용자 결정으로 캐시 제외)
 *   /              → HTML (점검 상태가 매 응답마다 박혀 있어 캐시 불가)
 *   /index.html, /index2.html → HTML
 *   /app_version.json, /version.json → 관리자가 갱신하는 동적 파일
 *   /access_control_zones.json, /fishing_ban_zones.json, /hazard_rocks.json,
 *   /seaway_zones.json, /vts_zones.json → 해양안전 폴리곤 레이어 데이터(수시 갱신)
 *
 * 이 패턴들을 제외한 모든 GET 요청은 자동으로 캐시됨.
 * 새 API 가 /api/ 패턴을 따르면 자동으로 캐시 제외 → 누락 위험 낮음.
 *
 * [캐시 버전 관리]
 *   CACHE_VERSION 상수를 매 배포마다 새 값으로 bump → 옛 캐시 자동 무효화.
 *   activate 이벤트에서 다른 버전 캐시는 모두 삭제.
 *   (단위 3-B 에서 빌드 스크립트로 자동화 예정)
 *
 * [연계]
 *   - index2.html: navigator.serviceWorker.register('/sw.js') 호출 필요 (단위 3-C)
 *   - 푸시 발송: routes/push.js + push_sender.js
 *
 * [초보자를 위한 안내]
 * "서비스 워커(Service Worker)" 는 웹 페이지와 네트워크 사이에 위치하는
 * 작은 프록시 같은 프로그램입니다. 페이지가 만든 요청을 가로채서:
 *  - 캐시에서 응답할지
 *  - 네트워크에 전달할지
 *  - 또는 둘 다 할지
 * 직접 결정할 수 있습니다. 사용자가 앱을 끄거나 와이파이를 꺼도 백그라운드
 * 에서 푸시 알림을 받을 수 있는 것도 이 덕분입니다.
 * ============================================================================
 */

// ============================================================================
// 캐시 버전 — 배포마다 갱신 (단위 3-B 스크립트가 자동 bump)
// ============================================================================
//
// 이 값이 바뀌면 옛 캐시는 activate 이벤트에서 모두 삭제됨 → 사용자는 새 자원
// 을 다시 받음. 코드 변경 후 배포 시 반드시 bump 해야 옛 캐시 꼬임 방지.
//
// 형식: 'YYYYMMDD-HHMMSS' (UTC) 또는 git short hash 또는 임의 문자열.
// 단위 3-B 의 빌드 스크립트가 빌드 시점의 타임스탬프로 자동 치환합니다.
const CACHE_VERSION = '__CACHE_VERSION__';
const CACHE_NAME = `seagnal-${CACHE_VERSION}`;

// ============================================================================
// 캐시 금지 패턴 (블랙리스트) — 결정 사항 6 줄 규칙
// ============================================================================

// 경로 접두사 패턴 (정규식) — startsWith 동등
// 한 줄 추가하면 새 동적 API 도 자동 차단됨.
const BLACKLIST_PREFIXES = [
    '/api/',         // 모든 API (148개 + 미래 추가될 것)
    '/data/',        // JSON 데이터 직접 서빙
    '/uploads/',     // 사용자 업로드 (게시판 첨부, 제보 첨부)
    '/tide_data/',   // 조석 과거치 (용량 크고 사용자 결정으로 제외)
];

// 정확히 일치하는 경로 (HTML 및 관리자 갱신 JSON)
const BLACKLIST_EXACT = new Set([
    '/',
    '/index2.html',
    '/app_version.json',
    '/version.json',
    // 해양안전 폴리곤 레이어 데이터 — 수시로 수정·재배포되는 정적 GeoJSON.
    // 캐시 대상이면 수정해도 사용자 기기에 옛 데이터가 남아 반영이 안 된 것처럼
    // 보인다(실제 사례: 관제구역 수정 후에도 옛 34개 데이터가 계속 보임).
    '/access_control_zones.json',
    '/fishing_ban_zones.json',
    '/hazard_rocks.json',
    '/shore_rocks.json',
    '/seaway_zones.json',
    '/vts_zones.json',
]);

/**
 * 주어진 URL 이 캐시 금지 대상인지 판정.
 * @param {URL} url
 * @returns {boolean} true = 캐시 안 함 (네트워크 직통)
 */
function isBlacklisted(url) {
    if (BLACKLIST_EXACT.has(url.pathname)) return true;
    for (const prefix of BLACKLIST_PREFIXES) {
        if (url.pathname.startsWith(prefix)) return true;
    }
    return false;
}

// ============================================================================
// install — 서비스워커 설치
// ============================================================================
self.addEventListener('install', (event) => {
    // skipWaiting: 새 SW 가 즉시 활성화되도록 (옛 SW 의 종료를 기다리지 않음)
    // → 배포 후 사용자 새로고침 시 새 캐시 정책 즉시 적용
    self.skipWaiting();
});

// ============================================================================
// activate — 서비스워커 활성화
// ============================================================================
self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            // 1) 옛 버전 캐시 삭제 (CACHE_NAME 과 다른 것 모두)
            //    배포로 CACHE_VERSION 이 bump 되면 자동으로 옛 캐시 비움.
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME)
                    .map(k => caches.delete(k))
            );

            // 2) 즉시 모든 클라이언트(탭) 제어 시작
            //    기본은 다음 페이지 로드부터 제어. claim() 으로 현재 탭도 즉시 제어.
            await self.clients.claim();
        })()
    );
});

// ============================================================================
// fetch — 모든 네트워크 요청 가로채기
// ============================================================================
//
// 처리 흐름:
//   1) GET 이 아니면 → 네트워크 직통 (POST/PUT/DELETE 등은 캐시 안 함)
//   2) 같은 origin 아니면 → 네트워크 직통 (외부 CDN 등은 SW 가 관여 안 함)
//   3) 블랙리스트 일치 → 네트워크 직통 (동적 데이터)
//   4) 그 외 → Stale-While-Revalidate 전략
//       - 캐시에 있으면 즉시 응답 + 동시에 백그라운드에서 새로 받아 캐시 갱신
//       - 캐시에 없으면 네트워크에서 받아 캐시 저장 후 응답
//
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // 1) GET 아닌 메서드는 SW 가 관여 안 함
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // 2) 다른 origin (CDN 등) 은 관여 안 함
    //    A안 적용 후엔 거의 같은 origin 이지만 안전망 차원.
    if (url.origin !== self.location.origin) return;

    // 3) 블랙리스트 일치 → 네트워크 직통, 캐시 안 함
    if (isBlacklisted(url)) return;

    // 4) Stale-While-Revalidate
    event.respondWith(staleWhileRevalidate(req));
});

/**
 * Stale-While-Revalidate 전략 구현.
 *
 * 동작:
 *  - 캐시에 있는지 먼저 본다.
 *  - 동시에 네트워크에서 새로 받기 시작한다 (백그라운드).
 *  - 캐시에 있으면 → 즉시 캐시 응답 반환 (사용자 체감 즉시).
 *  - 캐시에 없으면 → 네트워크 응답 도착할 때까지 기다려 반환.
 *  - 네트워크 응답이 200 OK 이면 캐시에 저장 (다음 요청용).
 *  - 네트워크 실패 + 캐시 없음 → 네트워크 에러를 그대로 사용자에게 (브라우저 기본 동작과 동일).
 *
 * @param {Request} req
 * @returns {Promise<Response>}
 */
async function staleWhileRevalidate(req) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);

    // 백그라운드 네트워크 요청 (캐시 적중 여부와 무관하게 항상 시도)
    const networkFetch = fetch(req)
        .then(res => {
            // 응답이 정상(2xx)일 때만 캐시 저장. 404/500 등은 캐시 오염 방지.
            // basic/cors 타입만 캐시 (opaque 응답은 크기를 알 수 없어 캐시 부담)
            if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
                // clone() 필수: 응답 본문은 한 번만 읽을 수 있으므로
                // cache.put 과 사용자 반환에 각각 사용하려면 복제 필요.
                cache.put(req, res.clone()).catch(() => {
                    // 캐시 put 실패는 무시 (할당량 초과 등) — 사용자에겐 정상 응답 줌.
                });
            }
            return res;
        })
        .catch(err => {
            // 네트워크 실패 — 캐시 적중이면 캐시 응답으로 폴백, 아니면 에러 전파.
            if (cached) return cached;
            throw err;
        });

    // 캐시 적중 시 즉시 캐시 반환, 백그라운드 fetch 는 계속 진행되어 캐시 갱신.
    // 캐시 미스 시 네트워크 fetch 결과 기다림.
    return cached || networkFetch;
}

// ============================================================================
// 푸시 알림 수신 (기존 기능 — 변경 없이 보존)
// ============================================================================
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

// ============================================================================
// 알림 클릭 핸들러 (기존 기능 — 변경 없이 보존)
// ============================================================================
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const targetUrl = event.notification.data.url || '/';

    // 클릭 시 앱 열기 (또는 포커스)
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // 이미 열린 창이 있으면 URL 이동 후 포커스
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if ('navigate' in client) {
                    // URL을 변경하여 popup 파라미터 전달
                    return client.navigate(targetUrl).then(client => client.focus());
                }
            }
            // 없으면 새로 열기
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
