/**
 * ============================================================================
 * 파일명: services/admin_auth.js
 * 역할 : 관리자 비밀번호 검증 + 토큰 기반 인증 (Phase 4-A 보안 강화)
 * ============================================================================
 *
 * [왜 이 파일이 생겼는가]
 *   기존 동작:
 *     - 클라이언트 코드(index2.html, admin.js)에 비밀번호가 하드코딩되어 있음
 *     - 서버 admin API는 누구나 호출 가능 (인증 미들웨어 0건)
 *     → 누구나 점검 모드 토글 가능 / 비밀번호 소스 보기로 노출
 *   변경 후 (이 모듈 도입):
 *     - 비밀번호는 환경변수(ADMIN_PASSWORD)에만 존재, 코드에 노출 0
 *     - 로그인 성공 시 랜덤 토큰 발급 → 이후 모든 admin API 호출에 토큰 필요
 *     - 토큰 없으면 401 거부 → 서비스 마비 공격 차단
 *
 * [주요 함수]
 *   verifyPassword(password)              비밀번호 일치 여부만 검증 (점검 우회용)
 *   issueToken(password, longTerm)        비밀번호 검증 후 토큰 발급
 *   verifyToken(token)                    토큰 유효성 (만료 포함) 검증
 *   requireAdminToken (Express 미들웨어)  X-Admin-Token 헤더 검증
 *
 * [토큰 만료 정책]
 *   기본(longTerm=false): 24시간 — 일반 admin 작업
 *   장기(longTerm=true) : 30일   — "비밀번호 저장" 체크 사용자
 *
 * [메모리 관리]
 *   토큰은 서버 메모리에만 보관 (Map<token, expiresAt>).
 *   서버 재시작 시 모든 토큰 무효 → admin들 재로그인 필요 (의도).
 *   1시간마다 만료된 토큰 자동 청소 (메모리 누수 방지).
 *
 * [연계]
 *   - routes/admin.js : 본 모듈의 미들웨어와 헬퍼 사용
 *   - .env / Fly.io secrets : ADMIN_PASSWORD 값 보관
 *   - js/admin.js : 클라이언트가 /api/admin/login 호출 후 X-Admin-Token 사용
 *
 * [초보자 안내]
 * "토큰(Token)" 은 손목띠 같은 거예요. 입구(로그인)에서 비밀번호 확인하고
 * 채워주면, 안에서는 손목띠만 보이면 통과. 손목띠는 일정 시간 후 풀려요.
 * 비밀번호를 매번 들고 다니지 않아도 되어 보안과 편의가 모두 좋아집니다.
 * ============================================================================
 */

const crypto = require('crypto');

// ============================================================================
// 환경변수에서 비밀번호 로드 (서버 시작 시 1회)
// ============================================================================
//
// .env 파일에 ADMIN_PASSWORD=... 형태로 정의되어 있어야 함.
// Fly.io 배포 시: `fly secrets set ADMIN_PASSWORD=<값>` 로 등록.
//
// 안전 가드:
//   - 환경변수 미설정 시 비어있는 문자열 → 어떤 입력으로도 인증 실패
//     (코드에 비밀번호 fallback 을 두면 보안 회귀가 됨)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

if (!ADMIN_PASSWORD) {
    console.warn('[admin_auth] ⚠ ADMIN_PASSWORD 환경변수가 설정되지 않았습니다. 모든 admin 로그인이 실패합니다.');
}

// ============================================================================
// 상수
// ============================================================================

// 짧은 만료 (일반 admin 작업): 24시간
const TOKEN_TTL_SHORT_MS = 24 * 60 * 60 * 1000;

// 긴 만료 ("비밀번호 저장" 체크 사용자): 30일
const TOKEN_TTL_LONG_MS = 30 * 24 * 60 * 60 * 1000;

// 만료 토큰 청소 주기: 1시간마다 1회
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// ============================================================================
// 토큰 저장소 — 서버 메모리
// ============================================================================
//
// key   : 토큰 문자열 (64자 hex)
// value : { expiresAt: number(timestamp ms) }
//
// Map 사용 이유:
//   - O(1) 조회
//   - 키 추가/삭제 추적 용이
//   - 만료 일괄 처리 시 entries() 순회
const tokens = new Map();

// ============================================================================
// 헬퍼: 비밀번호 일치 검증
// ============================================================================

/**
 * 입력 비밀번호가 ENV의 ADMIN_PASSWORD 와 일치하는지 검증.
 *
 * [타이밍 공격 방어]
 *   단순 === 비교는 문자열 길이/일치 위치에 따라 시간이 미세하게 달라져
 *   원격 공격자가 추론을 시도할 수 있음. crypto.timingSafeEqual 로 상수
 *   시간 비교 → 입력 길이에 따른 부수 정보 누출 차단.
 *
 *   주의: 길이가 다르면 timingSafeEqual 는 예외를 던지므로,
 *         사전에 같은 길이로 패딩 후 비교 후 길이도 함께 검사.
 *
 * @param {string} input 사용자가 보낸 비밀번호
 * @returns {boolean} 일치 여부
 */
function verifyPassword(input) {
    if (typeof input !== 'string') return false;
    if (!ADMIN_PASSWORD) return false;          // ENV 미설정 → 항상 실패

    // 길이 다르면 즉시 false (timingSafeEqual 는 동일 길이 버퍼만 받음)
    if (input.length !== ADMIN_PASSWORD.length) {
        // 길이가 달라도 일관된 비교 시간을 흉내내기 위해 더미 비교 수행
        try {
            const a = Buffer.from(input.padEnd(ADMIN_PASSWORD.length, '\0'));
            const b = Buffer.from(ADMIN_PASSWORD);
            crypto.timingSafeEqual(a, b);
        } catch (_) { /* 무시 */ }
        return false;
    }

    try {
        return crypto.timingSafeEqual(
            Buffer.from(input),
            Buffer.from(ADMIN_PASSWORD)
        );
    } catch (_) {
        return false;
    }
}

// ============================================================================
// 토큰 발급 / 검증
// ============================================================================

/**
 * 비밀번호를 받아 검증 후 토큰을 발급.
 *
 * @param {string} password 사용자가 보낸 비밀번호
 * @param {boolean} longTerm true 면 30일, false 면 24시간 만료
 * @returns {{ token: string, expiresAt: number } | null}
 *          성공 시 토큰+만료시각, 실패 시 null
 */
function issueToken(password, longTerm) {
    if (!verifyPassword(password)) return null;

    // 64자 hex 토큰. 256비트 무작위 → 무차별 대입 사실상 불가.
    const token = crypto.randomBytes(32).toString('hex');
    const ttl = longTerm ? TOKEN_TTL_LONG_MS : TOKEN_TTL_SHORT_MS;
    const expiresAt = Date.now() + ttl;

    tokens.set(token, { expiresAt });
    return { token, expiresAt };
}

/**
 * 토큰이 유효한지(존재 + 만료 안 됨) 검증.
 *
 * 만료 토큰을 만나면 즉시 제거 (지연 청소).
 *
 * @param {string} token X-Admin-Token 헤더 값
 * @returns {boolean}
 */
function verifyToken(token) {
    if (typeof token !== 'string' || token.length === 0) return false;
    const entry = tokens.get(token);
    if (!entry) return false;
    if (entry.expiresAt < Date.now()) {
        tokens.delete(token);    // 만료된 토큰 즉시 제거
        return false;
    }
    return true;
}

// ============================================================================
// 주기적 청소 — 만료된 토큰을 메모리에서 일괄 제거
// ============================================================================
//
// verifyToken 에서 지연 청소도 하지만, 한 번 발급된 후 verify 호출 없는
// 토큰은 영원히 메모리에 남을 수 있음. 1시간 단위 일괄 청소로 보강.
setInterval(() => {
    const now = Date.now();
    let removed = 0;
    for (const [token, entry] of tokens.entries()) {
        if (entry.expiresAt < now) {
            tokens.delete(token);
            removed++;
        }
    }
    if (removed > 0) {
        console.log(`[admin_auth] 만료 토큰 ${removed} 개 청소 완료. 잔여: ${tokens.size}`);
    }
}, CLEANUP_INTERVAL_MS);

// ============================================================================
// Express 미들웨어 — 보호된 admin 라우트에 적용
// ============================================================================

/**
 * X-Admin-Token 헤더를 검증하는 미들웨어.
 *
 * 사용:
 *   router.use('/api/admin', requireAdminToken);   // 또는
 *   router.get('/api/admin/foo', requireAdminToken, handler);
 *
 * 예외 라우트(로그인 / 점검 우회 검증) 는 이 미들웨어 적용 전에 등록해야 함.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireAdminToken(req, res, next) {
    const token = req.get('X-Admin-Token') || req.get('x-admin-token') || '';
    if (verifyToken(token)) {
        return next();
    }
    return res.status(401).json({
        error: '관리자 인증이 필요합니다. 다시 로그인하세요.',
        code: 'ADMIN_AUTH_REQUIRED'
    });
}

// ============================================================================
// 운영자 헬프: 현재 등록된 토큰 개수 조회 (디버깅용, 토큰 자체 노출 안 함)
// ============================================================================
function getActiveTokenCount() {
    return tokens.size;
}

module.exports = {
    verifyPassword,
    issueToken,
    verifyToken,
    requireAdminToken,
    getActiveTokenCount,
    // 외부에서 만료 정책 확인용 (테스트, 로그)
    TOKEN_TTL_SHORT_MS,
    TOKEN_TTL_LONG_MS,
};
