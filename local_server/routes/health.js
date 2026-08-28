/**
 * ============================================================================
 * 파일명: routes/health.js
 * 역할: 서버 상태 확인(헬스체크) 및 메인 페이지 라우트 + 점검 정보 인젝션
 * ============================================================================
 *
 * [핵심 동작]
 * 사용자가 앱을 켜면 GET / 요청이 이 파일로 와요. 이때 단순히 index2.html을
 * 파일 그대로 보내는 것이 아니라, **점검 모드 상태를 HTML 안에 미리 박아서**
 * 보냅니다.
 *
 * [왜 이렇게 하는가? - 앱 시작 속도 개선]
 *   기존: 앱 켜기 → HTML 받기(1) → 점검여부 따로 묻기(2) → 화면 진입  (왕복 2번)
 *   변경: 앱 켜기 → HTML 안에 점검정보 포함하여 한 번에 받기 → 화면 진입 (왕복 1번)
 *   효과: 통신 왕복 1번 절약 → 콜드 스타트 0.4~1.2초 단축.
 *
 * [너의 의도("점검 중엔 절대 진입 불가") 100% 보존]
 *   매 GET / 요청마다 서버 메모리에 있는 점검 상태를 실시간으로 HTML에 박아 전송.
 *   관리자가 점검 모드를 켜면 fs.watch 가 즉시 감지하여 캐시 갱신 → 그 후 들어오는
 *   모든 사용자에게 점검 화면이 표시됩니다.
 *
 * [연계 파일]
 *   - config/server_config.js → staticRoot 경로
 *   - data/maintenance_config.json → 점검 모드 설정 파일 (admin이 갱신)
 *   - routes/admin.js → POST /api/admin/maintenance 가 위 파일을 갱신
 *   - index2.html → <!--MAINTENANCE_INJECT--> 마커가 박혀있어야 동작
 *   - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * "헬스체크"란 서버가 정상적으로 작동하고 있는지 확인하는 간단한 API입니다.
 * Fly.io 같은 클라우드 서비스는 이 API를 주기적으로 호출하여
 * 서버가 살아있는지 자동으로 확인합니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { staticRoot } = require('../config/server_config');

// ============================================================================
// 상수 정의
// ============================================================================

// 점검 모드 설정 파일 경로 (routes/admin.js 의 MAINTENANCE_FILE 과 동일)
const MAINTENANCE_FILE = path.join(__dirname, '..', 'data', 'maintenance_config.json');

// 사용자에게 응답할 HTML 파일 경로 (index2.html 만 사용 — index.html 은 향후 삭제 예정)
const INDEX_HTML_PATH = path.join(staticRoot, 'index2.html');

// HTML 안에 박혀있어야 하는 인젝션 마커 (이 위치가 점검 정보로 치환됨)
const INJECT_MARKER = '<!--MAINTENANCE_INJECT-->';

// maintenance_config.json 이 없거나 손상되었을 때 사용할 안전 기본값.
// "점검 아님"으로 둬야 진입 자체는 막히지 않음 (fail-open).
// 단, 운영자가 점검 모드를 켜놨다면 fs.watch 로 즉시 active=true 로 갱신됨.
const DEFAULT_MAINTENANCE = { active: false };

// ============================================================================
// 메모리 캐시 — 서버 시작 시 1회 로드, 파일 변경 시 fs.watch 가 자동 갱신
// ============================================================================

// index2.html 의 전체 텍스트 (약 224KB).
// 매 요청마다 디스크 읽기를 피해 응답 속도를 빠르게 하기 위한 캐시.
let cachedHtml = '';

// 현재 점검 모드 상태 (active/title/content/blockedFeatures).
// 매 요청마다 이 변수를 JSON 직렬화하여 HTML 에 박음.
let cachedMaintenance = DEFAULT_MAINTENANCE;

// 인젝션 마커가 HTML 안에 존재하는지 여부.
// 없으면 인젝션이 일어나지 않고 클라이언트가 옛 방식(/api/maintenance-status fetch)
// 으로 자동 폴백되어 안전합니다 (속도 개선 효과만 사라짐).
let markerFound = false;

// ============================================================================
// 캐시 갱신 함수
// ============================================================================

/**
 * maintenance_config.json 을 디스크에서 다시 읽어 메모리 캐시에 반영.
 *
 * [언제 호출되는가]
 *   - 서버 시작 시 1회
 *   - fs.watch 가 파일 변경을 감지했을 때 (관리자가 점검 모드 토글)
 *
 * [실패 시 동작]
 *   파일이 없거나 JSON 파싱 실패 시 DEFAULT_MAINTENANCE 로 안전 폴백.
 *   서버를 죽이지 않습니다.
 */
function reloadMaintenance() {
    try {
        if (fs.existsSync(MAINTENANCE_FILE)) {
            const raw = fs.readFileSync(MAINTENANCE_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            // 응답에 필요한 필드만 명시적으로 추려서 저장 (예측 가능성 / 안전성)
            cachedMaintenance = {
                active: !!parsed.active,
                title: typeof parsed.title === 'string' ? parsed.title : '',
                content: typeof parsed.content === 'string' ? parsed.content : '',
                blockedFeatures: Array.isArray(parsed.blockedFeatures) ? parsed.blockedFeatures : []
            };
        } else {
            cachedMaintenance = DEFAULT_MAINTENANCE;
        }
    } catch (e) {
        console.warn('[health] maintenance_config 로드 실패, 기본값 사용:', e && e.message);
        cachedMaintenance = DEFAULT_MAINTENANCE;
    }
}

/**
 * index2.html 을 디스크에서 다시 읽어 메모리 캐시에 반영하고,
 * 인젝션 마커가 들어있는지 검증합니다.
 *
 * [언제 호출되는가]
 *   - 서버 시작 시 1회
 *   - fs.watch 가 파일 변경을 감지했을 때 (배포로 HTML 갱신)
 */
function reloadHtml() {
    try {
        if (fs.existsSync(INDEX_HTML_PATH)) {
            cachedHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
            markerFound = cachedHtml.indexOf(INJECT_MARKER) !== -1;
            if (!markerFound) {
                // 마커가 없어도 서비스는 동작합니다 (클라이언트 폴백 fetch).
                // 다만 속도 개선 효과가 사라지므로 운영자에게 경고를 띄웁니다.
                console.warn(`[health] ⚠ ${INJECT_MARKER} 마커가 index2.html 에 없습니다. 클라이언트 fetch 폴백으로 동작합니다.`);
            } else {
                console.log('[health] ✅ index2.html 메모리 캐시 갱신 완료 (마커 OK)');
            }
        } else {
            cachedHtml = '';
            markerFound = false;
            console.error('[health] ❌ index2.html 파일을 찾을 수 없습니다:', INDEX_HTML_PATH);
        }
    } catch (e) {
        console.error('[health] index2.html 로드 실패:', e && e.message);
        cachedHtml = '';
        markerFound = false;
    }
}

// ============================================================================
// 보안: <script> 태그 안 JSON 안전 이스케이프
// ============================================================================

/**
 * JSON 문자열을 <script> 태그 안에 박을 때 위험한 문자를 이스케이프.
 *
 * [왜 필요한가]
 *   관리자가 점검 제목/내용에 "</script>" 같은 문자열을 입력하면,
 *   브라우저가 그 부분을 만난 즉시 스크립트 블록을 종료해버리는 문제 발생.
 *   또한 JS 코드가 깨져 페이지 진입 자체가 실패할 수 있음.
 *   따라서 < > & 및 라인 종결자(U+2028, U+2029)를 유니코드 이스케이프로 치환.
 *
 * [예시]
 *   입력 제목: 점검중</script><script>alert(1)</script>
 *   결과:     "점검중</script><script>alert(1)</script>"
 *   → 브라우저는 이를 문자열로만 인식, 코드로 실행하지 않음.
 *
 * [부가 안전]
 *   JSON.stringify 가 이미 따옴표/백슬래시/제어문자를 안전하게 처리하므로,
 *   여기서는 HTML 컨텍스트 특유의 위험 문자만 추가 처리합니다.
 */
function escapeForScriptTag(jsonString) {
    return jsonString
        .replace(/</g, '\\u003C')   // <  → <  (</script> 차단)
        .replace(/>/g, '\\u003E')   // >  → >
        .replace(/&/g, '\\u0026')   // &  → &  (HTML 엔티티 모호성 차단)
        .replace(/\u2028/g, '\\u2028')  // 라인 분리자 → JS 문법 깨짐 차단
        .replace(/\u2029/g, '\\u2029'); // 단락 분리자 → 동일
}

/**
 * 메모리에 있는 HTML 의 마커를 점검 정보가 들어간 <script> 로 치환하여 반환.
 *
 * [흐름]
 *   1) cachedHtml 이 비어있으면 빈 문자열 반환 (404 처리에서 사용)
 *   2) cachedMaintenance 객체를 JSON 직렬화
 *   3) 안전 이스케이프
 *   4) <script>window.__MAINTENANCE__ = {...};</script> 형태로 감쌈
 *   5) HTML 안의 마커를 위 스크립트로 치환
 *
 * [마커가 없는 경우]
 *   replace() 가 아무 일도 하지 않으므로 원본 HTML 그대로 반환.
 *   → 클라이언트는 window.__MAINTENANCE__ 가 undefined 임을 보고 옛 방식으로 폴백.
 */
function buildResponseHtml() {
    if (!cachedHtml) return '';
    const json = JSON.stringify(cachedMaintenance);
    const safe = escapeForScriptTag(json);
    const injection = `<script>window.__MAINTENANCE__ = ${safe};</script>`;
    return cachedHtml.replace(INJECT_MARKER, injection);
}

// ============================================================================
// 초기화 — 서버 시작 시 1회 실행
// ============================================================================

reloadHtml();
reloadMaintenance();

// 파일 변경 감지 — 운영자가 점검 토글 또는 배포로 HTML 갱신 시 자동 반영
// (각 watch 호출은 try/catch 로 감싸 일부 환경에서 실패해도 서버 시작에는 영향 없음)

try {
    fs.watch(MAINTENANCE_FILE, { persistent: false }, (event) => {
        // 'change' 또는 'rename' 이벤트 모두 재로드. (일부 OS/도구는 저장 시 rename 이벤트)
        if (event === 'change' || event === 'rename') {
            reloadMaintenance();
        }
    });
    console.log('[health] maintenance_config 변경 감지 활성화');
} catch (e) {
    console.warn('[health] maintenance_config fs.watch 실패 (정상 동작은 유지):', e && e.message);
}

try {
    fs.watch(INDEX_HTML_PATH, { persistent: false }, (event) => {
        if (event === 'change' || event === 'rename') {
            reloadHtml();
        }
    });
    console.log('[health] index2.html 변경 감지 활성화');
} catch (e) {
    console.warn('[health] index2.html fs.watch 실패 (정상 동작은 유지):', e && e.message);
}

// ============================================================================
// 라우트
// ============================================================================

/**
 * GET / → 메인 페이지 응답 (점검 정보 인젝션 + 강한 캐시 금지 헤더)
 *
 * [캐시 금지 헤더 3중 명시]
 *   - Cache-Control: no-cache, no-store, must-revalidate (Chromium 표준)
 *   - Pragma: no-cache (HTTP/1.0 호환)
 *   - Expires: 0 (옛 프록시 호환)
 *   세 가지 모두 박아 다양한 환경에서 HTML 이 캐시되지 않도록 강건성 확보.
 *   왜 캐시하면 안 되는가: HTML 에 점검 상태가 박혀있어 매번 최신을 받아야 함.
 *
 * [응답 흐름]
 *   1) cachedHtml 비어있으면 404
 *   2) 캐시 금지 헤더 설정
 *   3) buildResponseHtml() 로 점검 정보 인젝션된 HTML 생성
 *   4) 응답
 */
router.get('/', (req, res) => {
    if (!cachedHtml) {
        return res.status(404).send('index2.html 파일을 찾을 수 없습니다.');
    }
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Content-Type': 'text/html; charset=utf-8'
    });
    res.send(buildResponseHtml());
});

// ── 이 프로세스(머신)를 구분하는 짧은 표식 ──
// [왜 있나 — 2026-08-28]
//   fly 볼륨(`local_server/data`)은 **머신 한 대에 붙는다.** 머신이 여러 대면 승인 이력 같은
//   런타임 파일이 머신마다 따로 생기고, 서버 안의 직렬 쓰기 락(`withLock`)도 프로세스 안에서만
//   도니 머신 사이에는 아무 보호가 없다. 그런데 **머신이 몇 대인지 밖에서 확인할 방법이 없어**
//   독립 검토자도 나도 "코드상 보장이 없다"까지만 적고 멈췄다.
//   그래서 /api/health 를 여러 번 불러 **서로 다른 표식이 몇 개 나오는지 세면** 알 수 있게 한다.
// ⚠fly 머신 ID 를 그대로 내보내지 않는다 — 해시 앞 8자리만 쓴다(대수 세기에는 충분하다).
const crypto = require('crypto');
const INSTANCE = crypto.createHash('sha1')
    .update(String(process.env.FLY_MACHINE_ID || process.env.FLY_ALLOC_ID || require('os').hostname()))
    .digest('hex').slice(0, 8);
const STARTED_AT = new Date().toISOString();

/**
 * 서버 상태 확인 API (Fly.io / UptimeRobot 등 모니터링 도구가 사용).
 * 점검 모드와 무관하게 항상 200 OK 응답.
 * `instance` 는 이 프로세스를 구분하는 표식이다 — 여러 번 불러 값이 몇 가지 나오는지 세면
 * **머신이 몇 대 도는지** 알 수 있다(위 주석 참조). `startedAt` 은 이 프로세스가 뜬 시각.
 */
router.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), instance: INSTANCE, startedAt: STARTED_AT });
});

module.exports = router;
