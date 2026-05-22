/**
 * ============================================================================
 * 파일명: services/marine_client.js
 * 역할: marine.kma.go.kr (해양기상정보포털 MMIS) HTTP 클라이언트
 *       - 비로그인 endpoint (warn/list, warn/ready, warn-sasc/list,
 *         warn-sasc/ready) 호출
 *       - 로그인 endpoint (warn/ef/list, warn/ntfctn/list) 를 위한 JWT 세션
 *         관리 (login, refresh-token 자동 갱신, 401 재로그인)
 *       - rate limit 보호 (요청 사이 최소 간격)
 *       - 자격증명 마스킹 ("hy***")
 * ============================================================================
 *
 * [SPEC §2 — 인증 흐름]
 *   POST /mmis_marine_api/api/auth/login
 *     body: { mmbrId, mmbrPassword, rememberMe: false }
 *     응답 header: accesstoken (JWT 30분), refreshtoken (JWT 60분)
 *     Set-Cookie: JSESSIONID
 *   POST /mmis_marine_api/api/auth/refresh-token (25분 주기)
 *
 * [자격증명]
 *   process.env.MARINE_USER_ID   — fly.io secrets (평문 절대 금지)
 *   process.env.MARINE_USER_PWD  — fly.io secrets
 *   process.env.MARINE_DISABLE   ('1' 이면 강제 비활성)
 *
 *   둘 다 없으면 enabled=false → 인증 endpoint 호출 시 throw,
 *   비로그인 endpoint 는 호출 가능.
 *
 * [로그 마스킹 정책]
 *   ID 의 앞 2자 + "***" 만 노출 (예: "hy***").
 *   토큰·비밀번호는 어떤 경로로도 평문 출력 금지.
 *
 * [V8 — 폭풍해일 제외]
 *   본 모듈은 raw 응답만 반환. 필터링은 호출 측(marine_warning_crawler.js) 책임.
 *
 * [의존성]
 *   Node built-in https 만 사용 (외부 라이브러리 추가 금지 — SPEC §7).
 * ============================================================================
 */

'use strict';

const https = require('https');

// ============================================================================
// 1. 자격증명 + 활성 게이트
// ============================================================================

const USER_ID = process.env.MARINE_USER_ID || '';
const USER_PWD = process.env.MARINE_USER_PWD || '';
const FORCE_DISABLED = process.env.MARINE_DISABLE === '1';
const AUTH_ENABLED = !!USER_ID && !!USER_PWD && !FORCE_DISABLED;

/** ID 마스킹: 앞 2자 + "***" 만 노출. 2자 이하면 "***" 단독. */
function maskUserId(id) {
    if (!id) return '(none)';
    if (id.length <= 2) return '***';
    return id.substring(0, 2) + '***';
}

// ============================================================================
// 2. 상수
// ============================================================================

const HOST = 'marine.kma.go.kr';
const BASE_PATH = '/mmis_marine_api';

const PATHS = {
    LOGIN: '/mmis_marine_api/api/auth/login',
    REFRESH: '/mmis_marine_api/api/auth/refresh-token',
    TOKEN_CHECK: '/mmis_marine_api/api/auth/token-checker',
    WARN_LIST: '/mmis_marine_api/v1/kma/warn/list',
    WARN_READY: '/mmis_marine_api/v1/kma/warn/ready',
    WARN_SASC_LIST: '/mmis_marine_api/v1/kma/warn-sasc/list',
    WARN_SASC_READY: '/mmis_marine_api/v1/kma/warn-sasc/ready',
    WARN_LATEST: '/mmis_marine_api/v1/kma/warn/latest',
    WARN_SASC_LATEST: '/mmis_marine_api/v1/kma/warn-sasc/latest',
    WARN_EF_LIST: '/mmis_marine_api/v1/kma/warn/ef/list',
    WARN_NTFCTN_LIST: '/mmis_marine_api/v1/kma/warn/ntfctn/list'
};

const HTTP_TIMEOUT_MS = 15000;          // 단발 요청 타임아웃
const RATE_LIMIT_GAP_MS = 200;          // 요청 사이 최소 간격 (SPEC §8 V3)
const REFRESH_INTERVAL_MS = 25 * 60 * 1000;  // 25분 주기 refresh (token TTL 30분 대비 안전 여유)
const TOKEN_TTL_MS = 30 * 60 * 1000;    // accesstoken JWT exp 30분 — 가정값

// ============================================================================
// 3. 세션 상태 (메모리)
// ============================================================================

const session = {
    accessToken: '',
    refreshToken: '',
    jsessionId: '',
    loginAt: 0,                 // 마지막 login 성공 epoch ms
    lastRefreshAt: 0,           // 마지막 refresh 성공 epoch ms
    loginInProgress: false      // 동시 로그인 방지
};

// 마지막 요청 시각 (rate limit 게이트)
let _lastRequestAt = 0;

// ============================================================================
// 4. 저수준 HTTP 헬퍼
// ============================================================================

/** rate limit: 직전 요청과 최소 RATE_LIMIT_GAP_MS 간격 보장. */
async function _rateGate() {
    const now = Date.now();
    const wait = (_lastRequestAt + RATE_LIMIT_GAP_MS) - now;
    if (wait > 0) {
        await new Promise(r => setTimeout(r, wait));
    }
    _lastRequestAt = Date.now();
}

/** 쿠키 직렬화. */
function _cookieHeader() {
    if (!session.jsessionId) return '';
    return `JSESSIONID=${session.jsessionId}`;
}

/** Set-Cookie 응답 헤더 파싱 → session.jsessionId 갱신. */
function _ingestSetCookie(setCookies) {
    if (!setCookies) return;
    const arr = Array.isArray(setCookies) ? setCookies : [setCookies];
    for (const c of arr) {
        const m = String(c).match(/JSESSIONID=([^;]+)/i);
        if (m) session.jsessionId = m[1];
    }
}

/** 응답 헤더에서 새 access/refresh token 추출 (login/refresh 공통). */
function _ingestAuthTokens(headers) {
    if (!headers) return false;
    // header 키는 소문자로 정규화되어 전달됨
    const access = headers['accesstoken'] || headers['accessToken'];
    const refresh = headers['refreshtoken'] || headers['refreshToken'];
    let updated = false;
    if (access) { session.accessToken = String(access); updated = true; }
    if (refresh) { session.refreshToken = String(refresh); updated = true; }
    return updated;
}

/**
 * Promise 기반 HTTPS 요청 — 본 모듈 안에서만 사용.
 * - method, path, body, headers 옵션 처리
 * - rate limit 게이트 자동 호출
 * - 응답: { statusCode, headers, body(text) }
 */
function _request({ method = 'GET', path, body = null, headers = {}, authRequired = false }) {
    return new Promise(async (resolve, reject) => {
        try {
            await _rateGate();
        } catch (e) {
            // _rateGate 자체 실패는 무시
        }

        const reqHeaders = {
            'User-Agent': 'Mozilla/5.0 (Linux; SEAGNAL/marine-client)',
            'Accept': 'application/json',
            'Origin': `https://${HOST}`,
            'Referer': `https://${HOST}/mmis/`
        };
        if (body) {
            reqHeaders['Content-Type'] = 'application/json';
            reqHeaders['Content-Length'] = Buffer.byteLength(body);
        }
        const cookie = _cookieHeader();
        if (cookie) reqHeaders['Cookie'] = cookie;
        if (authRequired) {
            if (session.accessToken) reqHeaders['accesstoken'] = session.accessToken;
            if (session.refreshToken) reqHeaders['refreshtoken'] = session.refreshToken;
        }
        Object.assign(reqHeaders, headers);

        const req = https.request({
            method,
            host: HOST,
            path,
            headers: reqHeaders,
            timeout: HTTP_TIMEOUT_MS
        }, res => {
            _ingestSetCookie(res.headers['set-cookie']);
            // login / refresh 응답이 아닌 일반 응답도 헤더에 새 토큰이 실릴 수 있음
            if (authRequired) _ingestAuthTokens(res.headers);
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString('utf8')
                });
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        if (body) req.write(body);
        req.end();
    });
}

// ============================================================================
// 5. 인증 — login / refresh / ensureAuth
// ============================================================================

/**
 * 로그인 수행.
 *  - 성공 시 session.accessToken/refreshToken/jsessionId 채워짐
 *  - 실패 시 throw + session 미변경 (이전 토큰 유지)
 *  - 동시 호출 방지: loginInProgress 락
 */
async function login() {
    if (!AUTH_ENABLED) {
        throw new Error('marine_client: 자격증명 미설정 — login 불가');
    }
    if (session.loginInProgress) {
        // 다른 호출이 진행 중이면 대기
        while (session.loginInProgress) {
            await new Promise(r => setTimeout(r, 50));
        }
        // 대기 후 토큰이 새로 채워졌으면 그대로 사용
        if (session.accessToken) return;
    }
    session.loginInProgress = true;
    try {
        console.log(`[marine] login start (user=${maskUserId(USER_ID)})`);
        const payload = JSON.stringify({
            mmbrId: USER_ID,
            mmbrPassword: USER_PWD,
            rememberMe: false
        });
        const res = await _request({
            method: 'POST',
            path: PATHS.LOGIN,
            body: payload,
            // login 자체는 토큰 없이 호출. 응답 헤더에서 토큰 회수.
            authRequired: false
        });
        if (res.statusCode !== 200) {
            throw new Error(`login HTTP ${res.statusCode}`);
        }
        // 응답 헤더에서 토큰 회수
        const got = _ingestAuthTokens(res.headers);
        if (!got) {
            // 응답 body 분석 — status 200/payload 가 있어도 토큰이 없으면 실패
            throw new Error('login: accesstoken/refreshtoken 응답 헤더 없음');
        }
        // 응답 body 의 status 검증 (있으면)
        try {
            const j = JSON.parse(res.body);
            if (j && j.status && j.status !== 200) {
                throw new Error(`login body.status=${j.status}`);
            }
        } catch (e) {
            // body 파싱 실패는 무시 — 토큰이 있으면 성공으로 간주
        }
        session.loginAt = Date.now();
        session.lastRefreshAt = Date.now();
        console.log(`[marine] login ok`);
    } finally {
        session.loginInProgress = false;
    }
}

/**
 * refresh-token 호출 → 새 access/refresh token 회수.
 *  - 실패 시 throw (호출자는 login() 으로 fallback 가능)
 */
async function refreshToken() {
    if (!AUTH_ENABLED) {
        throw new Error('marine_client: 자격증명 미설정 — refresh 불가');
    }
    if (!session.refreshToken) {
        throw new Error('refresh: refreshToken 없음 — login 필요');
    }
    const res = await _request({
        method: 'POST',
        path: PATHS.REFRESH,
        authRequired: true   // 현재 토큰 첨부
    });
    if (res.statusCode !== 200) {
        throw new Error(`refresh HTTP ${res.statusCode}`);
    }
    const got = _ingestAuthTokens(res.headers);
    if (!got) {
        throw new Error('refresh: 새 토큰 응답 헤더 없음');
    }
    session.lastRefreshAt = Date.now();
    console.log('[marine] refresh-token ok');
}

/**
 * 인증 endpoint 호출 전에 호출 — 토큰 유효성 보장.
 *  - 토큰 없음 → login()
 *  - loginAt 으로부터 TOKEN_TTL_MS 가까이 → refreshToken() 시도
 *    실패 시 login() fallback
 *  - lastRefreshAt 으로부터 REFRESH_INTERVAL_MS 경과 → refreshToken()
 */
async function ensureAuth() {
    if (!AUTH_ENABLED) {
        throw new Error('marine_client: 자격증명 미설정 — 인증 endpoint 호출 불가');
    }
    const now = Date.now();
    if (!session.accessToken) {
        await login();
        return;
    }
    // 토큰 TTL 의 80% 도달 → 예방적 refresh
    const sinceRefresh = now - (session.lastRefreshAt || 0);
    if (sinceRefresh >= REFRESH_INTERVAL_MS) {
        try {
            await refreshToken();
        } catch (e) {
            console.log(`[marine] refresh 실패 (${e.message}) — 재로그인 시도`);
            await login();
        }
    }
}

// ============================================================================
// 6. 비로그인 endpoint 호출 — V9 정책 (4 실시간 endpoint 는 비인증)
// ============================================================================

/** 공통 GET — 비로그인. */
async function _getNoAuth(urlPath) {
    const res = await _request({
        method: 'GET',
        path: urlPath,
        authRequired: false
    });
    if (res.statusCode !== 200) {
        throw new Error(`GET ${urlPath} HTTP ${res.statusCode}`);
    }
    let j;
    try {
        j = JSON.parse(res.body);
    } catch (e) {
        throw new Error(`GET ${urlPath} JSON parse fail`);
    }
    return j;
}

/** 응답 envelope 정규화 — { status,payload } 또는 { code,data } 두 가지 모두 흡수.
 *   반환: 항상 row 배열 (없으면 []).
 *  [SPEC §2 §4 envelope 혼용] */
function _unwrap(j) {
    if (!j) return [];
    if (Array.isArray(j.payload)) return j.payload;
    if (Array.isArray(j.data)) return j.data;
    // 비어있을 수도 있음
    return [];
}

/** 현재 발효 부모 zone */
async function fetchWarnList() {
    const j = await _getNoAuth(PATHS.WARN_LIST);
    return _unwrap(j);
}
/** 현재 발효 자식 zone (연안바다·평수구역) */
async function fetchWarnSascList() {
    const j = await _getNoAuth(PATHS.WARN_SASC_LIST);
    return _unwrap(j);
}
/** 예비특보 부모 */
async function fetchWarnReady() {
    const j = await _getNoAuth(PATHS.WARN_READY);
    return _unwrap(j);
}
/** 예비특보 자식 */
async function fetchWarnSascReady() {
    const j = await _getNoAuth(PATHS.WARN_SASC_READY);
    return _unwrap(j);
}

/**
 * 부모 zone 별 "가장 최근 통보문" — 발효중 상태 아닌 미래 통보문(해제 발표 등) 포함.
 * 핵심: warn/list 응답이 "현재 발효 상태" 만 반환하는 반면,
 *      warn/latest 응답은 같은 zone 에 대해 발표된 가장 최신 통보문을 반환.
 *      해제 통보문이 발행되면 tm_ef 에 정확한 해제시각이 들어있고
 *      warn_inpt_tm 은 통보문 발행시각보다 사전등록된 시각.
 *      → 해제예고 범위형("23일 3시~6시") 대신 정확한 시각("2026.05.23 01:00") 확보.
 */
async function fetchWarnLatest() {
    const j = await _getNoAuth(PATHS.WARN_LATEST);
    return _unwrap(j);
}

/** 자식 zone "최신" — 현재는 list 와 동일한 형식(zone+lvl) 반환. 보조 검증용. */
async function fetchWarnSascLatest() {
    const j = await _getNoAuth(PATHS.WARN_SASC_LATEST);
    return _unwrap(j);
}

// ============================================================================
// [Followup E-4] 4 endpoint 묶음 호출 — 부분 실패 시 throw (cycle skip 유도)
// ============================================================================
//
// Promise.allSettled 로 4 endpoint 동시 호출. 하나라도 rejected 면 throw.
// 호출 측(marine_warning_crawler.run) 은 throw 를 잡아 이번 cycle 통째로 skip 하고
// 마지막 성공 state 를 유지 → release 폭주 방지.
//
// 정상 빈 응답(발효/예비 zone 없음) 은 _unwrap 이 [] 반환 → 정상 cycle 흐름.
// "실패" 의 정의: HTTP 4xx/5xx, network error, timeout, JSON parse fail 등 throw 사유.
async function fetchAllRealtimeEndpoints() {
    const settled = await Promise.allSettled([
        fetchWarnList(),
        fetchWarnSascList(),
        fetchWarnReady(),
        fetchWarnSascReady()
    ]);
    const labels = ['warnList', 'warnSascList', 'warnReady', 'warnSascReady'];
    const failed = [];
    for (let i = 0; i < settled.length; i++) {
        if (settled[i].status === 'rejected') {
            const reason = settled[i].reason;
            failed.push(`${labels[i]}: ${(reason && reason.message) || reason}`);
        }
    }
    if (failed.length > 0) {
        const err = new Error('marine endpoint 부분 실패: ' + failed.join(' | '));
        err.partial = true;
        err.failedEndpoints = failed;
        throw err;
    }
    return {
        warnList: settled[0].value || [],
        warnSascList: settled[1].value || [],
        warnReady: settled[2].value || [],
        warnSascReady: settled[3].value || []
    };
}

// ============================================================================
// 7. 인증 endpoint — ef/list (timeline diff 용)
// ============================================================================

/**
 * 발효 timeline (영구 row 보존) — 격상·해제·발표 derive 의 소스.
 *
 * @param {Object} params
 *   - prdc_go: 관할관서 코드 (기본 비워둠 → 전체)
 *   - warn_tp: 특보종류 코드 (CSV, 기본 ''). '6'=풍랑, '1'=강풍, '7'=태풍.
 *              폭풍해일 '5' 는 V8 정책에 따라 호출 측에서 제외.
 *   - st_tm:   YYYYMMDD (또는 YYYYMMDDHHmm 등 — KMA 사이트는 8자리 사용)
 *   - ed_tm:   YYYYMMDD
 * @returns {Array} ef row 배열 (warn_zone_cd, kor_nm, warn_tp_nm, warn_lvl_nm,
 *                   warn_cmd_nm, tm_fc, st_tm, ed_tm, ... )
 */
async function fetchWarnEfList({ prdc_go = '', warn_tp = '', st_tm = '', ed_tm = '' } = {}) {
    if (!AUTH_ENABLED) {
        // 자격증명 없으면 ef/list 호출 자체를 skip — 호출자는 빈 배열을 받아 timeline diff 를 비활성화.
        return [];
    }
    await ensureAuth();
    const qs = new URLSearchParams({
        prdc_go: String(prdc_go),
        warn_tp: String(warn_tp),
        st_tm: String(st_tm),
        ed_tm: String(ed_tm)
    }).toString();
    const path = `${PATHS.WARN_EF_LIST}?${qs}`;
    let res = await _request({ method: 'GET', path, authRequired: true });
    if (res.statusCode === 401) {
        // 세션 만료 — 재로그인 후 1회 재시도
        console.log('[marine] ef/list 401 — 재로그인 후 재시도');
        await login();
        res = await _request({ method: 'GET', path, authRequired: true });
    }
    if (res.statusCode !== 200) {
        throw new Error(`ef/list HTTP ${res.statusCode}`);
    }
    let j;
    try { j = JSON.parse(res.body); }
    catch (e) { throw new Error('ef/list JSON parse fail'); }
    return _unwrap(j);
}

// ============================================================================
// 8. 디버그 / 상태 조회
// ============================================================================

function getAuthStatus() {
    return {
        enabled: AUTH_ENABLED,
        userId: maskUserId(USER_ID),
        loggedIn: !!session.accessToken,
        loginAt: session.loginAt ? new Date(session.loginAt).toISOString() : null,
        lastRefreshAt: session.lastRefreshAt ? new Date(session.lastRefreshAt).toISOString() : null
    };
}

/** 테스트용 — 세션 초기화. */
function _resetSessionForTest() {
    session.accessToken = '';
    session.refreshToken = '';
    session.jsessionId = '';
    session.loginAt = 0;
    session.lastRefreshAt = 0;
    session.loginInProgress = false;
    _lastRequestAt = 0;
}

module.exports = {
    // 상태
    AUTH_ENABLED,
    maskUserId,
    getAuthStatus,
    // 인증
    login,
    refreshToken,
    ensureAuth,
    // 비로그인 endpoint
    fetchWarnList,
    fetchWarnSascList,
    fetchWarnReady,
    fetchWarnSascReady,
    // [V10 — warn/latest] 해제 통보문 정확한 시각 보강용
    fetchWarnLatest,
    fetchWarnSascLatest,
    // [Followup E-4] 4 endpoint 묶음 호출 (Promise.allSettled, 부분 실패 시 throw)
    fetchAllRealtimeEndpoints,
    // 인증 endpoint
    fetchWarnEfList,
    // 테스트
    _resetSessionForTest,
    _PATHS: PATHS
};
