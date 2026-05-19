/**
 * ============================================================================
 * 파일명: dmdw_warn_crawler.js
 * 역할 : 방재기상플랫폼(dmdw.kma.go.kr) 특보발효현황 페이지에서
 *        "자식 해역(연안바다/평수구역)" 단위의 특보 발효·발표 상태를
 *        1분 주기로 수집해 dmdw_alerts.json 으로 저장
 * ============================================================================
 *
 * [이 모듈이 왜 필요한가 — 초보자용 설명]
 *  기존 weather_alerts_crawler.js 는 기상청 일반 페이지(weather.go.kr) 에서
 *  부모 해역(예: 제주도서부앞바다) 단위 특보만 수집한다. 자식 해역
 *  (예: 북서연안바다, 가파도연안바다 등) 은 단지 "활성 Y/N" 만 표시되어
 *  자식별로 풍랑→태풍 종류 전환, 주의보→경보 격상 같은 변화를 추적할 수 없다.
 *
 *  방재기상플랫폼(dmdw)은 자식 단위로 wrnTp(특보종류), wrnLvl(등급), tmFc(발표시각),
 *  tmEf(발효시각) 을 모두 제공한다. 이 모듈은 해당 데이터를 별도 JSON 파일에
 *  쌓아두고, /api/weather-alerts 응답 시점에 기존 weather_alerts.json 와
 *  머지(merge) 되어 자식 해역 뱃지가 정확한 종류·등급으로 표시되게 만든다.
 *
 * [데이터 흐름]
 *   [매 1분]
 *     scheduler.js setInterval → dmdwCrawler.run()
 *       → login (필요시 4시간 만료 또는 401 응답 시)
 *       → fetchTimeline('EF') 최근 N시간 코드 목록
 *       → fetchTimeline('FC') 최근 N시간 코드 목록
 *       → 신규 코드만 fetchDetail() 호출
 *       → row → 자식별 (wrnTp, wrnLvl) 분배
 *       → children 갱신, _upcoming 갱신, 해제 감지
 *       → dmdw_alerts.json 원자적 쓰기
 *
 *   [GET /api/weather-alerts]
 *     routes/weather.js 가 dmdw_alerts.json + weather_alerts.json 을
 *     읽어 머지한 결과를 응답 (S3 단계에서 구현)
 *
 * [연계 파일]
 *   - scheduler.js                       : 1분 주기 호출
 *   - routes/weather.js                  : 응답 시점 머지
 *   - js/data.js / js/render_coastal.js  : 프론트 렌더링 (S4,S5)
 *   - data/dmdw_alerts.json              : 이 모듈이 쓰는 출력 파일
 *
 * [자격증명]
 *   - process.env.KMA_DMDW_USER_ID
 *   - process.env.KMA_DMDW_USER_PWD
 *   - process.env.KMA_DMDW_DISABLE   (선택, "1" 이면 강제 비활성)
 *   둘 다 없으면 모듈이 silent disable 되어 운영 영향 0.
 *
 * [안전 정책]
 *   - 5xx 응답 → 재로그인 1회 → 그래도 실패면 해당 코드 skip + 다음 코드 계속
 *   - 401/세션 만료 → 자동 재로그인 후 1회 재시도
 *   - 출력 파일은 tmp → rename 으로 원자적 쓰기 (부분 쓰기 방지)
 *   - 자격증명 미설정 시 enabled=false (module.exports.enabled 로 노출)
 *
 * ============================================================================
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { URLSearchParams } = require('url');

// [관리자 푸시 알림] 로그인 실패·서버 장애 등 운영자가 인지해야 할 사건 발생 시
// admin_devices.json 에 등록된 관리자 기기로만 자연어 본문의 푸시 알림 발송.
// require 자체는 동기·가벼움 (firebase-admin 은 lazy 로딩이라 첫 발송 시점에 초기화).
const adminPush = require('./services/admin_push');

// [관리자 페이지 오류 기록] 푸시 알림이 발송된 모든 사건을 디스크에 누적 기록.
// 관리자 페이지의 "특보 알림 ▸ 특보 수집 오류 ▸ dmdw 오류" 하위 탭에서 목록·확인·삭제 가능.
// 푸시 쿨다운(30분) 과 무관하게 매 발생 시 기록 → 관리자가 페이지 열면 모든 이력 확인 가능.
const dmdwErrorLog = require('./services/dmdw_error_log');

// [자식 해역 푸시 발송기] 자식 단위 발효/발표/해제/격상/격하 등 6종 이벤트를 큐에 적재 후
// 사이클 끝에 flush() 1회 호출로 그룹화·200자 분할·중복방지 적용해 관리자 기기에만 발송.
// 백필 사이클(runBackfill) 중에는 enqueue/flush 호출 자체를 안 한다 (1일치 데이터 한꺼번에 → 폭주 방지).
const dmdwPushSender = require('./services/dmdw_push_sender');

// ============================================================================
// 1. 환경변수 + 자격증명 게이트
// ============================================================================
//
// 자격증명이 환경변수에 없으면 모듈 자체를 "비활성" 상태로 export 한다.
// scheduler 가 enabled === true 일 때만 run() 을 호출하도록 약속.
// 운영 시 운영자가 fly secrets set 으로 등록할 때까지 무해하게 대기.

const USER_ID = process.env.KMA_DMDW_USER_ID || '';
const USER_PWD = process.env.KMA_DMDW_USER_PWD || '';
const FORCE_DISABLED = process.env.KMA_DMDW_DISABLE === '1';
const ENABLED = !!USER_ID && !!USER_PWD && !FORCE_DISABLED;

// 로그 출력 시 ID 마스킹: "kirt8293@korea.kr" → "kir***@korea.kr"
function maskUserId(id) {
    if (!id) return '(none)';
    return id.replace(/(.{3}).+(@.+)/, '$1***$2');
}

// 모듈 자체가 비활성 상태라면 즉시 빈 인터페이스만 노출하고 끝.
// (require 시점에 env 가 안 잡혀 있으면 이 분기로 빠짐)
if (!ENABLED) {
    if (!FORCE_DISABLED) {
        console.log('[dmdw] 자격증명 미설정 — 크롤러 비활성. 운영 영향 없음.');
    } else {
        console.log('[dmdw] KMA_DMDW_DISABLE=1 — 크롤러 강제 비활성.');
    }
    module.exports = {
        enabled: false,
        async run() { /* 비활성: 아무 동작 안 함 */ }
    };
    return;
}

// ============================================================================
// 2. 상수 / 설정
// ============================================================================

const BASE = 'https://dmdw.kma.go.kr';
const PATHS = {
    MAIN: '/rsw/mfp/mfpMain',                           // 로그인 페이지 (CSRF 토큰 추출용)
    LOGIN: '/rsw/rest/frm/login_user',                  // POST 로그인
    WTM_PAGE: '/rsw/mfp/wrn/wrnWeaWtmRetrieve',         // 특보발효현황 페이지 (CSRF 갱신용)
    TIMELINE: '/rsw/rest/mfp/wrn/retRswWrnTmInfo.json', // POST 타임라인 (해당시각 목록)
    DETAIL_V1: '/rsw/rest/mfp/wrn/retRswWrnTmDetailInfo.json'
    // ↑ v1 사용 이유: 과거 데이터까지 완벽 커버 + body 가 flat list 라 파싱 단순.
    //   v2(retRswWrnTmDetailInfo2.json) 는 2025-04 이후 데이터만 안정 응답.
};

// 폴링 범위: 매 사이클마다 (현재 시각 - LOOKBACK_HOURS) ~ 현재 까지의 코드만 조회
// 너무 짧으면 사이클 사이의 코드를 놓칠 수 있고, 너무 길면 매번 같은 코드를 중복 검사.
// 1시간이면 평균 사이클 간격(1분) 대비 안전 여유 충분.
const LOOKBACK_HOURS = 1;
const DETAIL_DELAY_MS = 120;             // detail 호출 사이 간격 (서버 부담 완화)
const HTTP_TIMEOUT_MS = 15000;           // 각 HTTP 요청 타임아웃
const SESSION_REFRESH_MS = 4 * 60 * 60 * 1000; // 4시간마다 예방적 재로그인
const RETRY_MAX = 3;                     // detail 호출 재시도 횟수

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'dmdw_alerts.json');
const TMP_FILE = OUTPUT_FILE + '.tmp';

// 특보종류 / 등급 한글 변환 표 (응답에 wrnTpNm/wrnLvlNm 이 이미 있지만 fallback 용)
// 'O'(폭풍해일) 은 수집 대상에서 제외 (extractChildEntries 에서 스킵) 되었으므로 매핑에서도 제거.
const WRN_TP_NM = { V: '풍랑', W: '강풍', S: '대설', D: '건조', C: '한파', H: '호우', T: '태풍' };
const WRN_LVL_NM = { '2': '주의보', '3': '경보' };

// 수집 제외 특보종류 코드 집합 (KMA dmdw wrnTp)
//   'O' = 폭풍해일 — 운영 정책상 수집·표시하지 않음
const EXCLUDED_WRN_TP = new Set(['O']);

// ============================================================================
// 3. 모듈 내부 상태 (메모리)
// ============================================================================
//
// 세션은 메모리에만 보관. 프로세스 재시작 시 새 로그인이 자동으로 일어남.

const sessionState = {
    cookies: {},     // { AFS2O_SESSION: '...', SCOUTER: '...' }
    csrfToken: '',
    loginAt: 0       // epoch ms — 최근 로그인 시각
};

// run() 동시 실행 방지 락 (scheduler 가 다음 사이클을 일찍 트리거하는 경우 대비)
let runInProgress = false;

// ============================================================================
// 3-1. 관리자 알림 — 쿨다운 + 정상화 추적
// ============================================================================
//
// [목적] 운영자(관리자 등록 기기 소유자)에게 dmdw 크롤러의 비정상 상황을
//        사람이 읽어서 즉시 이해할 수 있는 자연어 문장으로 푸시 발송.
//
// [폭주 방지]
//   - 같은 종류 알림(type)은 ALERT_COOLDOWN_MS 이내 1회만 발송
//   - 단 "에러가 해소되고 다시 에러"인 경우에는 즉시 발송 (한 번 정상화 후엔 쿨다운 리셋)
//
// [상태 추적]
//   - alertState.lastSentAt[type] : 마지막 발송 시각 (epoch ms)
//   - alertState.activeIssue      : 현재 미해소 상태인 에러 유형 (null = 정상)
//   - alertState.failedSinceMs    : 에러 시작 시각 (정상화 알림에 경과 시간 포함)
//
// [알림 유형]
//   'login_fail_credential' — 자격증명 거부 (statecode != '10')
//   'login_fail_network'    — 로그인 자체가 throw (서버 다운 / CSRF 등)
//   'recovered'             — 정상화 (issue 해소 직후 1회)

const ALERT_COOLDOWN_MS = 30 * 60 * 1000;  // 30분
const alertState = {
    lastSentAt: {},      // { 'login_fail_credential': 1700000000000, ... }
    activeIssue: null,   // 현재 진행 중인 issue 유형 (null = 정상)
    failedSinceMs: 0     // 에러 시작 시각
};

// 자연어 문장으로 관리자 알림 발송. 발송 자체 실패는 조용히 흡수.
async function notifyAdmin(type, title, body) {
    const now = Date.now();
    const last = alertState.lastSentAt[type] || 0;
    // 쿨다운: 같은 type 알림은 30분 안에 1회만 (정상화 알림은 별 type 이라 별도 카운트)
    if (now - last < ALERT_COOLDOWN_MS) {
        return;
    }
    alertState.lastSentAt[type] = now;
    try {
        await adminPush.sendAdminPush(title, body, { type: `dmdw_${type}` });
        console.log(`[dmdw] admin push sent: ${type}`);
    } catch (e) {
        // 알림 자체가 실패해도 크롤러 본체 영향 0
        console.log(`[dmdw] admin push failed (${type}): ${e.message}`);
    }
}

// 에러 발생 마킹 + 알림 발송 + 디스크 기록 진입점.
//  - 푸시 알림(notifyAdmin) 은 30분 쿨다운으로 동일 type 반복 발송 차단
//  - 디스크 기록(dmdwErrorLog.appendError) 은 쿨다운과 무관하게 매번 누적
//    → 관리자가 페이지 열어보면 모든 발생 이력 시간순으로 확인 가능
async function markIssueAndNotify(type, title, body, detail) {
    // 새 에러가 시작되는 시점이면 failedSinceMs 기록
    if (alertState.activeIssue !== type) {
        alertState.activeIssue = type;
        alertState.failedSinceMs = Date.now();
    }
    // 디스크 기록 — 실패해도 본 흐름 영향 0
    try {
        dmdwErrorLog.appendError(type, title, body, detail || '');
    } catch (e) {
        console.log(`[dmdw] error log append failed: ${e.message}`);
    }
    // 푸시 알림 (쿨다운 적용)
    await notifyAdmin(type, title, body);
}

// 정상화 시 호출: 직전에 에러 상태였으면 "정상화" 알림 1회 + 미확인 오류 자동 ack 후 상태 리셋.
//  - 미확인 오류 자동 ack: 운영자가 페이지 안 열어봐도 정상화된 이슈는 회색 처리
//    → 관리자 페이지 알림 피로 ↓
//  - 정상화 자체도 이력으로 기록 (type='recovered') — 관리자가 사후 경과 시간 확인 가능
async function markRecoveredIfNeeded() {
    if (!alertState.activeIssue) return;
    const prevIssue = alertState.activeIssue;
    const durMin = Math.max(1, Math.round((Date.now() - alertState.failedSinceMs) / 60000));
    // 상태 먼저 리셋해서 알림 발송 중 중복 진입 방지
    alertState.activeIssue = null;
    alertState.failedSinceMs = 0;
    // 동일 에러 재발 시 즉시 알림 발송 가능하도록 해당 에러 쿨다운 초기화
    delete alertState.lastSentAt[prevIssue];

    const recoveredTitle = '✅ 방재기상플랫폼 자식 해역 특보 수집 정상화';
    const recoveredBody = `직전 약 ${durMin}분간 중단되었던 자식 해역(연안바다·평수구역) 특보 자동 갱신이 정상적으로 재개되었습니다.`;

    // 1) 디스크 기록 — 정상화 사건 자체도 이력 한 줄 (선택적 안전망)
    //    + 직전 미확인 오류 항목 모두 자동 ack 처리
    try {
        dmdwErrorLog.appendError('recovered', recoveredTitle, recoveredBody, `from=${prevIssue}, dur=${durMin}min`);
        const r = dmdwErrorLog.acknowledgeAllUnack('auto-recovered');
        if (r.count > 0) {
            console.log(`[dmdw] error log: auto-acknowledged ${r.count} unack item(s) on recovery`);
        }
    } catch (e) {
        console.log(`[dmdw] error log recovery handling failed: ${e.message}`);
    }

    // 2) 푸시 알림
    try {
        await adminPush.sendAdminPush(
            recoveredTitle,
            recoveredBody,
            { type: 'dmdw_recovered' }
        );
        console.log(`[dmdw] admin push sent: recovered (after ${durMin}min)`);
    } catch (e) {
        console.log(`[dmdw] admin push failed (recovered): ${e.message}`);
    }
}

// ============================================================================
// 4. 헬퍼 — 인코딩, 정규화, 시간
// ============================================================================

// KMA 로그인 규약: base64( encodeURIComponent( str ) )
// 예: "@1q2w3e4r" → encodeURIComponent → "%401q2w3e4r" → base64 → "JTQwMXEydzNlNHI="
function enc64(s) {
    return Buffer.from(encodeURIComponent(s), 'utf8').toString('base64');
}

// 자식 해역 명칭 정규화.
//
// [필요한 이유 — 6개월 데이터 비교 분석 결과]
// dmdw 응답에는 다음과 같은 표기 변이가 존재:
//   "당진 평수구역"     → 앱 mappings.js 의 "당진평수구역"
//   "안면도 서쪽 평수구역" → "안면도서쪽평수구역"
//   "울릉도울릉읍연안바다"  → mappings.js 는 "울릉읍연안바다" (울릉도 prefix 다름)
// 머지 시 부모.children 의 키(fullName)와 정확히 일치시켜야 하므로
// 두 표기를 모두 같은 정규형으로 만든 뒤 비교한다.
function normalizeChildName(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    // 공백 모두 제거: "당진 평수구역" → "당진평수구역"
    s = s.replace(/\s+/g, '');
    return s;
}

// "부모1(자식1, 자식2), 부모2(자식a)" → [["부모1",["자식1","자식2"]], ...]
// 괄호 깊이 추적으로 안전하게 분리 (단순 split 시 괄호 안 콤마 오인 발생).
function splitTop(text) {
    const out = [];
    let depth = 0;
    let buf = '';
    for (const ch of text) {
        if (ch === '(') { depth++; buf += ch; }
        else if (ch === ')') { depth--; buf += ch; }
        else if (ch === ',' && depth === 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; }
        else buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
}
function parseGrouped(text) {
    const res = [];
    for (const it of splitTop(text)) {
        const m = it.match(/^(.+?)\((.+)\)\s*$/);
        if (m) {
            const parent = m[1].trim();
            const kids = m[2].split(',').map(x => x.trim()).filter(Boolean);
            res.push({ parent, kids });
        } else {
            res.push({ parent: it.trim(), kids: [] });
        }
    }
    return res;
}

// "2026.05.16.15:23" → "2026.05.16.15:23" 형식 그대로 사용 (dmdw API가 이 포맷을 요구)
// Date → 위 포맷 변환
function toDmdwTime(dt) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `${y}.${m}.${d}.${hh}:${mm}`;
}

// ============================================================================
// 5. HTTP 헬퍼
// ============================================================================
//
// 외부 라이브러리(axios, requests) 추가 의존을 피하고 Node 내장 https 만 사용.
// 기존 다른 크롤러(weather_alerts_crawler.js, report_alert_processor.js)와
// 동일한 패턴이라 일관성 유지.

// 쿠키 직렬화 ("key=value; key2=value2" 형태로)
function cookieHeader() {
    return Object.entries(sessionState.cookies)
        .map(([k, v]) => `${k}=${v}`).join('; ');
}

// Set-Cookie 헤더 파싱 후 sessionState.cookies 에 저장
function ingestSetCookies(setCookies) {
    if (!setCookies) return;
    const arr = Array.isArray(setCookies) ? setCookies : [setCookies];
    for (const c of arr) {
        const kv = c.split(';')[0].trim();
        const eq = kv.indexOf('=');
        if (eq < 0) continue;
        const k = kv.substring(0, eq);
        const v = kv.substring(eq + 1);
        sessionState.cookies[k] = v;
    }
}

// HTTPS GET 헬퍼 — 본문(text) + statusCode + 헤더 반환
function httpGet(urlPath, extraHeaders) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            method: 'GET',
            host: 'dmdw.kma.go.kr',
            path: urlPath,
            headers: Object.assign({
                'User-Agent': 'Mozilla/5.0 (Linux; SEAGNAL/dmdw-crawler)',
                'Accept': 'text/html,application/json',
                'Cookie': cookieHeader()
            }, extraHeaders || {}),
            timeout: HTTP_TIMEOUT_MS
        }, res => {
            ingestSetCookies(res.headers['set-cookie']);
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                text: Buffer.concat(chunks).toString('utf8')
            }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        req.end();
    });
}

// HTTPS POST (application/x-www-form-urlencoded)
function httpPost(urlPath, formObj, extraHeaders) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams(formObj).toString();
        const req = https.request({
            method: 'POST',
            host: 'dmdw.kma.go.kr',
            path: urlPath,
            headers: Object.assign({
                'User-Agent': 'Mozilla/5.0 (Linux; SEAGNAL/dmdw-crawler)',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Content-Length': Buffer.byteLength(body),
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-TOKEN': sessionState.csrfToken,
                'Referer': `${BASE}${PATHS.WTM_PAGE}`,
                'Origin': BASE,
                'Cookie': cookieHeader()
            }, extraHeaders || {}),
            timeout: HTTP_TIMEOUT_MS
        }, res => {
            ingestSetCookies(res.headers['set-cookie']);
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                text: Buffer.concat(chunks).toString('utf8')
            }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        req.write(body);
        req.end();
    });
}

// HTML 본문에서 <meta name="_csrf" content="..."> 추출
function extractCsrf(html) {
    const m = html.match(/name=["']_csrf["']\s+content=["']([^"']+)["']/);
    return m ? m[1] : '';
}

// ============================================================================
// 6. 로그인 / 세션 관리
// ============================================================================
//
// [흐름]
//  1) GET /rsw/mfp/mfpMain          → 초기 쿠키 + CSRF 토큰
//  2) POST /rsw/rest/frm/login_user → AFS2O_SESSION 갱신, statecode==10 이면 성공
//  3) GET /rsw/mfp/wrn/wrnWeaWtmRetrieve → 로그인 후 CSRF 토큰 새로 받기
//                                        (페이지마다 CSRF 가 바뀌는 정책)
//
// 세션 유효시간은 명시되지 않지만 1분 폴링이 inactivity timer 를 매번 리셋해서
// 사실상 영구 유효. 단 4시간마다 예방적으로 재로그인 (서버 절대만료 대비).

async function login() {
    console.log(`[dmdw] login start (user=${maskUserId(USER_ID)})`);

    // 1) 메인 페이지 GET — 쿠키 + CSRF 토큰 발급
    const mainRes = await httpGet(PATHS.MAIN);
    if (mainRes.statusCode !== 200 && mainRes.statusCode !== 302) {
        throw new Error(`login warmup failed: HTTP ${mainRes.statusCode}`);
    }
    sessionState.csrfToken = extractCsrf(mainRes.text);
    if (!sessionState.csrfToken) {
        throw new Error('login warmup: CSRF token not found');
    }

    // 2) 로그인 POST
    const loginRes = await httpPost(PATHS.LOGIN, {
        userId: enc64(USER_ID),
        userPwd: enc64(USER_PWD)
    });
    let loginJson;
    try { loginJson = JSON.parse(loginRes.text); }
    catch (e) { throw new Error(`login: invalid JSON (HTTP ${loginRes.statusCode})`); }

    const state = loginJson && loginJson.body && loginJson.body.result
        && loginJson.body.result.statecode;
    if (state !== '10') {
        // statecode 의미: 00=등록되지 않은 계정, 01=승인대기, 11=비밀번호 만료
        //                 그 외 비정상 상태 (10 이외는 모두 실패)
        // [관리자 알림] 자격증명 자체의 문제로 즉시 운영자 개입이 필요한 케이스.
        const stateMeaning = {
            '00': '등록되지 않은 계정',
            '01': '승인 대기 상태인 계정',
            '11': '비밀번호 만료'
        }[String(state)] || `알 수 없는 상태(${state})`;
        await markIssueAndNotify(
            'login_fail_credential',
            '🔐 방재기상플랫폼 로그인 실패',
            `방재기상플랫폼(dmdw.kma.go.kr) 로그인이 거부되었습니다. ` +
            `사유: ${stateMeaning}. ID/비밀번호 또는 계정 승인 상태를 확인해 주세요. ` +
            `현재 자식 해역(연안바다·평수구역) 특보 자동 갱신이 중단된 상태입니다. ` +
            `해소 후 다음 1분 사이클에 자동으로 정상화됩니다.`,
            `statecode=${state}`   // detail — 디버깅용 짧은 원본 코드
        );
        throw new Error(`login failed: statecode=${state} msg=${loginJson.message || ''}`);
    }

    // 3) 특보발효현황 페이지 GET — 새 CSRF 토큰 발급 (이후 호출에 사용)
    const wtmRes = await httpGet(PATHS.WTM_PAGE);
    const newCsrf = extractCsrf(wtmRes.text);
    if (newCsrf) sessionState.csrfToken = newCsrf;

    sessionState.loginAt = Date.now();
    console.log(`[dmdw] login ok`);
}

// 로그인 필요 여부 판단 (없거나 4시간 경과 시 재로그인)
async function ensureSession() {
    if (!sessionState.csrfToken || !sessionState.cookies.AFS2O_SESSION
        || Date.now() - sessionState.loginAt > SESSION_REFRESH_MS) {
        await login();
    }
}

// ============================================================================
// 7. 타임라인 / 상세 호출
// ============================================================================

// EF | FC 타임라인: 특정 기간의 "해당시각" 코드 목록
//   응답: { statusCode:200, body: [ {code, value, count}, ... ] }
async function fetchTimeline(typ, sDate, eDate) {
    const res = await httpPost(PATHS.TIMELINE, {
        type: typ, sDate, eDate, specYn: 'yes'
    });
    if (res.statusCode !== 200) throw new Error(`timeline HTTP ${res.statusCode}`);
    const j = JSON.parse(res.text);
    if (j.statusCode !== 200 || !Array.isArray(j.body)) {
        throw new Error(`timeline status=${j.statusCode}`);
    }
    return j.body.map(c => c.code);
}

// 특정 시각의 상세 row 들 (v1 엔드포인트)
//   응답: { statusCode:200, body: [ {wrnTp, wrnLvl, regions, regionsSpec, tmFc, tmEf, ...}, ... ] }
async function fetchDetail(code, typ) {
    let lastErr = null;
    for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
        try {
            const res = await httpPost(PATHS.DETAIL_V1, {
                _DT: 'RSW:WRN:WRNTMEFREP',
                tmInfo: code,
                type: typ,
                specYn: 'yes'
            });
            // HTTP 200 이지만 body 안에 server 500 인 경우 있음 (과거 데이터 누락 등)
            if (res.statusCode !== 200) {
                lastErr = `HTTP ${res.statusCode}`;
            } else {
                const j = JSON.parse(res.text);
                if (j.statusCode === 200 && Array.isArray(j.body)) {
                    return j.body;
                }
                lastErr = `body status=${j.statusCode}`;
                // 세션 만료 추정: 200/210/401 등 — 즉시 재로그인
                if (String(j.statusCode) === '210' || String(j.statusCode) === '401') {
                    await login();
                    continue;
                }
            }
        } catch (e) {
            lastErr = e.message;
        }
        // 작은 백오프 (네트워크 일시 장애 대비)
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
    throw new Error(`detail fail ${typ}/${code}: ${lastErr}`);
}

// ============================================================================
// 8. dmdw row → 자식 상태 변환
// ============================================================================
//
// 응답의 한 row 에 regionsSpec 이 있으면 그게 자식 해역 정보.
//   예: "제주도서부앞바다(북서연안바다,남서연안바다,가파도연안바다)"
// 한 row 가 같은 부모 아래 여러 자식을 가질 수 있으므로 평탄화.
//
// [반환] [{ parent, childRaw, wrnTp, wrnLvl, wrnTpNm, wrnLvlNm, tmFc, tmEf, cmd }]
function extractChildEntries(row) {
    const spec = (row.regionsSpec || '').trim();
    if (!spec) return [];
    // [수집 제외] 폭풍해일(wrnTp='O') 은 운영 정책상 수집하지 않음.
    //   row 단위로 일괄 스킵해 children/_upcoming 상태에 아예 들어가지 않게 한다.
    if (EXCLUDED_WRN_TP.has(row.wrnTp)) return [];
    const out = [];
    for (const g of parseGrouped(spec)) {
        for (const childRaw of g.kids) {
            out.push({
                parent: g.parent,
                childRaw: childRaw,
                wrnTp: row.wrnTp || '',
                wrnTpNm: row.wrnTpNm || WRN_TP_NM[row.wrnTp] || '',
                wrnLvl: String(row.wrnLvl || ''),
                wrnLvlNm: row.wrnLvlNm || WRN_LVL_NM[String(row.wrnLvl)] || '',
                tmFc: row.tmFc || '',
                tmEf: row.tmEf || '',
                cmd: row.wrnCmdNm || ''
            });
        }
    }
    return out;
}

// 자식별 fullName 키 만들기:
//   parent="제주도서부앞바다", childRaw="북서연안바다" → "제주도서부앞바다중북서연안바다"
//   (mappings.js 의 fullName 표기 규약과 일치)
function makeChildKey(parent, childRaw) {
    const p = normalizeChildName(parent);
    const c = normalizeChildName(childRaw);
    // 울릉도 prefix 예외: "울릉도울릉읍연안바다" → 부모 "동해중부안쪽먼바다" 아래에서
    //   mappings.js 가 "울릉도울릉읍연안바다" 형태 그대로 사용함 → "중" 안 붙임.
    // 충남 평수구역 예외: "당진평수구역" 등도 부모 "충남북부앞바다" 아래에서
    //   "중" 없이 그 자체로 키 사용 → mappings.js 와 일치.
    // 일반 케이스만 "중" 으로 연결.
    if (c.startsWith('울릉도')) return c;            // 울릉도 자식 그대로
    // 충남 평수구역 4종은 부모 prefix 가 없음
    const NO_JOONG = new Set(['당진평수구역', '안면도서쪽평수구역', '천수만평수구역', '태안·서산북쪽평수구역']);
    if (NO_JOONG.has(c)) return c;
    return `${p}중${c}`;
}

// makeChildKey() 의 역함수에 가까운 표시용 자식 이름 복원.
// state.children[key] 객체에 raw childName 이 따로 저장되지 않으므로,
// 푸시 발송 시 화면에 표시할 짧은 자식 이름을 key + parentZone 에서 유도한다.
//   "제주도서부앞바다중북서연안바다" + parent="제주도서부앞바다" → "북서연안바다"
//   "울릉도울릉읍연안바다" → 그대로 (울릉도 prefix 예외)
//   "당진평수구역" → 그대로 (NO_JOONG 예외)
function _childDisplayNameFromKey(parentZone, key) {
    if (!key) return '';
    const p = normalizeChildName(parentZone || '');
    const joiner = `${p}중`;
    if (p && key.startsWith(joiner)) return key.substring(joiner.length);
    return key;
}

// ============================================================================
// 9. 상태 갱신 — 자식별 children / _upcoming 결정
// ============================================================================
//
// EF row → "현재 발효 중인 자식" 상태에 반영 (state.children).
// FC row 중 tmEf 가 미래 시각이면 → state._upcoming 에 보관 (UI 노출 안 함).
// 한 사이클의 EF 코드들을 모두 처리한 뒤, 이번 사이클에 "한 번도 등장 안 한"
// 자식은 set-diff 로 "해제됨"으로 간주 → children 에서 제거.
//
// [중요 — 사이클 단위 vs 시점 단위]
//   타임라인이 갱신 이벤트마다 새 코드를 만들기 때문에, 한 사이클 동안
//   여러 코드에서 같은 자식이 나타날 수 있음. 마지막(가장 최신) 코드의
//   상태를 자식의 최종 상태로 사용.

function nowKstStr() {
    // KST 기준 YYYY.MM.DD.HH:mm 시각
    const d = new Date();
    const kst = new Date(d.getTime() + (d.getTimezoneOffset() * 60 * 1000) + 9 * 3600 * 1000);
    return toDmdwTime(kst);
}

// tmEf 가 현재 시각보다 미래인가? 미래면 "예고(예정)" → _upcoming 으로.
function isFuture(tmEf, now) {
    if (!tmEf) return false;
    // 비교는 단순 문자열 비교: "YYYY.MM.DD.HH:mm" 포맷은 사전식 정렬이 시간순과 일치
    return tmEf > now;
}

// ============================================================================
// 10. 디스크 저장 (atomic write)
// ============================================================================

function loadState() {
    // 시작 시 기존 dmdw_alerts.json 이 있으면 children/_upcoming + 백필 메타를 복원.
    // 첫 실행이거나 파일이 깨졌으면 빈 상태로 시작.
    try {
        if (fs.existsSync(OUTPUT_FILE)) {
            const j = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
            return {
                children: j.children || {},
                _upcoming: j._upcoming || {},
                lastCode: j.lastCode || { EF: '', FC: '' },
                // [S9-B] 백필 메타 — 디스크에 남아있는 상태를 그대로 이어감
                backfillReady: j.backfillReady === true,
                backfillStartedAt: j.backfillStartedAt || null,
                backfillCompletedAt: j.backfillCompletedAt || null
            };
        }
    } catch (e) {
        console.log(`[dmdw] state load failed (${e.message}) — 빈 상태로 시작`);
    }
    return {
        children: {}, _upcoming: {}, lastCode: { EF: '', FC: '' },
        backfillReady: false, backfillStartedAt: null, backfillCompletedAt: null
    };
}

function saveState(state, stats) {
    // 데이터 디렉터리 존재 보장
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = {
        updatedAt: new Date().toISOString(),
        lastCode: state.lastCode,
        loginAt: sessionState.loginAt ? new Date(sessionState.loginAt).toISOString() : null,
        stats: stats || {},
        // [S9-B] 백필 메타 — routes/weather.js 머지 게이트가 backfillReady 만 확인
        backfillReady: state.backfillReady === true,
        backfillStartedAt: state.backfillStartedAt || null,
        backfillCompletedAt: state.backfillCompletedAt || null,
        children: state.children,
        _upcoming: state._upcoming
    };
    // 원자적 쓰기: tmp 파일에 먼저 쓴 뒤 rename (POSIX 원자 보장)
    fs.writeFileSync(TMP_FILE, JSON.stringify(out, null, 1), 'utf8');
    fs.renameSync(TMP_FILE, OUTPUT_FILE);
}

// ============================================================================
// 11. 메인 run() — 1분 사이클 진입점
// ============================================================================

// ============================================================================
// 11-B. runBackfill() — 서버 재시작 시 1회 백필
// ============================================================================
//
// [목적]
//  서버가 재시작되면 메모리는 비고 디스크엔 직전 상태만 남는다. 그 사이에
//  KMA 에 어떤 변화가 있었는지 모르므로, 직전 24시간 EF + FC 코드를 모두
//  훑어 자식 상태(state.children / _upcoming / presentInLastFc) 를 완전히
//  재구성한 뒤 정상 1분 사이클로 진입.
//
// [실행 정책]
//  - 호출 시점: scheduler.js 가 서버 시작 후 1회만 호출
//  - dmdw_alerts.json 이 backfillReady=true 로 이미 마킹되어 있으면 skip
//    (단 SERVER_RESTART_FORCE_REBACKFILL 환경변수가 있으면 강제 재실행 — 디버그용)
//  - 진행 중에는 backfillReady=false 유지 → routes/weather.js 머지 게이트에서
//    자식 머지 보류 (부모 데이터만 응답 — 사용자 결정 A 옵션)
//  - 백필 완료 후 backfillReady=true, backfillCompletedAt 마킹 + 저장
//  - 동시 실행 방지: backfillInProgress 락
//
// [실행 시간 추정]
//  평소: ~10초 (1일치 코드 ~25개 × 2 type × 200ms)
//  활동기(태풍): ~60~80초 (1일치 코드 ~100개)

let backfillInProgress = false;

async function runBackfill() {
    if (backfillInProgress) {
        console.log('[dmdw] backfill already in progress — skip');
        return;
    }
    // [H2] 정기 run() 과 같은 dmdw_alerts.json 에 동시 쓰는 race 방지를 위해
    //   "백필 진행 중" 락을 함수 최상단에서 즉시 set. 이전에는 loadState() 후에
    //   set 되어, 그 사이 1분 사이클이 loadState→saveState 수행 후 백필이 덮어쓰는
    //   race window 가 약 1초 존재했음. 락 위치 이동으로 race 사라짐.
    backfillInProgress = true;

    // 이미 백필 완료된 상태면 skip (정상 재시작 후 빠르게 1분 사이클로 진입)
    const prev = loadState();
    if (prev.backfillReady && !process.env.SERVER_RESTART_FORCE_REBACKFILL) {
        console.log('[dmdw] backfill already ready (from disk) — skipping');
        backfillInProgress = false; // skip 분기에서 락 즉시 해제
        return;
    }

    const startMs = Date.now();
    console.log('[dmdw] backfill START — 직전 24시간 자식 해역 상태 재구성 시작');

    // 시작 즉시 디스크에 "백필 진행 중" 마킹 → routes/weather.js 가 자식 머지 보류
    const state = loadState();
    state.backfillReady = false;
    state.backfillStartedAt = new Date().toISOString();
    saveState(state, { phase: 'backfill_start' });

    let skipCount = 0;

    try {
        await ensureSession();

        // 폴링 윈도우: 직전 24시간 (BACKFILL_HOURS)
        const BACKFILL_HOURS = 24;
        const nowDt = new Date();
        const nowStr = toDmdwTime(nowDt);
        const sDt = new Date(nowDt.getTime() - BACKFILL_HOURS * 3600 * 1000);
        const sDate = toDmdwTime(sDt);
        const eDate = toDmdwTime(nowDt);

        const [efCodes, fcCodes] = await Promise.all([
            fetchTimeline('EF', sDate, eDate).catch(e => {
                console.log(`[dmdw] backfill EF timeline fail: ${e.message}`); return [];
            }),
            fetchTimeline('FC', sDate, eDate).catch(e => {
                console.log(`[dmdw] backfill FC timeline fail: ${e.message}`); return [];
            })
        ]);

        console.log(`[dmdw] backfill — EF codes=${efCodes.length}, FC codes=${fcCodes.length} (예상 시간 ~${Math.round((efCodes.length + fcCodes.length) * 0.4)}초)`);

        // EF 처리 — 시간순 (오래된 → 최신)
        const sortedEf = [...efCodes].sort();
        const seenChildrenInBackfill = new Set();
        for (const code of sortedEf) {
            let rows;
            try {
                rows = await fetchDetail(code, 'EF');
            } catch (e) {
                console.log(`[dmdw] backfill SKIP EF ${code}: ${e.message}`);
                skipCount++;
                continue;
            }
            for (const row of rows) {
                for (const ent of extractChildEntries(row)) {
                    const key = makeChildKey(ent.parent, ent.childRaw);
                    seenChildrenInBackfill.add(key);
                    state.children[key] = {
                        parentZone: ent.parent,
                        wrnTp: ent.wrnTp, wrnTpNm: ent.wrnTpNm,
                        wrnLvl: ent.wrnLvl, wrnLvlNm: ent.wrnLvlNm,
                        tmFc: ent.tmFc, tmEf: ent.tmEf,
                        since: `EF|${code}`,
                        lastCmd: ent.cmd
                    };
                }
            }
            state.lastCode.EF = code;
            await new Promise(r => setTimeout(r, DETAIL_DELAY_MS));
        }

        // 백필 완료 시점에 한 번도 안 나타난 자식 → 해제됨 (children 에서 제거)
        // 단 전체 EF 코드가 0건이면 데이터 자체가 없는 것이므로 skip
        if (sortedEf.length > 0) {
            for (const key of Object.keys(state.children)) {
                if (!seenChildrenInBackfill.has(key)) delete state.children[key];
            }
        }

        // FC 처리 — 미래 발효 예정 + presentInLastFc 갱신용 등장 set
        const sortedFc = [...fcCodes].sort();
        const fcSeenInBackfill = new Set();
        for (const code of sortedFc) {
            let rows;
            try {
                rows = await fetchDetail(code, 'FC');
            } catch (e) {
                console.log(`[dmdw] backfill SKIP FC ${code}: ${e.message}`);
                skipCount++;
                continue;
            }
            for (const row of rows) {
                for (const ent of extractChildEntries(row)) {
                    const key = makeChildKey(ent.parent, ent.childRaw);
                    fcSeenInBackfill.add(key);
                    if (isFuture(ent.tmEf, nowStr)) {
                        state._upcoming[key] = {
                            parentZone: ent.parent,
                            wrnTp: ent.wrnTp, wrnTpNm: ent.wrnTpNm,
                            wrnLvl: ent.wrnLvl, wrnLvlNm: ent.wrnLvlNm,
                            tmFc: ent.tmFc, tmEf: ent.tmEf,
                            announcedAt: `FC|${code}`
                        };
                    }
                }
            }
            state.lastCode.FC = code;
            await new Promise(r => setTimeout(r, DETAIL_DELAY_MS));
        }

        // presentInLastFc 갱신 — 백필 전체 사이클 기준 (1일치 통째로 본 결과)
        if (sortedFc.length > 0) {
            for (const key of Object.keys(state.children)) {
                state.children[key].presentInLastFc = fcSeenInBackfill.has(key);
            }
        }

        // _upcoming 정리 — 백필 시점 nowStr 기준 과거 항목 제거
        for (const key of Object.keys(state._upcoming)) {
            const u = state._upcoming[key];
            if (!u || !u.tmEf || u.tmEf <= nowStr) delete state._upcoming[key];
        }

        // 백필 성공 마킹
        state.backfillReady = true;
        state.backfillCompletedAt = new Date().toISOString();
        const elapsedMs = Date.now() - startMs;
        saveState(state, {
            phase: 'backfill_complete',
            backfillMs: elapsedMs,
            backfillSkipCount: skipCount,
            backfillEfCodes: sortedEf.length,
            backfillFcCodes: sortedFc.length
        });

        console.log(`[dmdw] backfill DONE — ${Math.round(elapsedMs / 1000)}초, children=${Object.keys(state.children).length}, upcoming=${Object.keys(state._upcoming).length}, skip=${skipCount}`);
    } catch (e) {
        // [H3] 백필 실패 시 영구 머지 보류 방지.
        //   이전 동작: backfillReady=false 유지 → 다음 서버 재시작까지 자식 머지
        //              영구 보류 → 자식 폴리곤·박스 안 보임.
        //   변경 동작: 부분 성공이라도 backfillReady=true 마킹 → 1분 사이클이
        //              누적해서 점진적으로 정확한 상태에 수렴. 사용자 입장에선
        //              자식 데이터가 평소처럼 보이며, 첫 사이클들은 약간 불완전할
        //              수 있으나 분 단위로 자동 보정됨.
        //   안전망: state 객체가 정상이면 부분 데이터라도 disk 에 저장.
        console.log(`[dmdw] backfill FAILED: ${e.message} — backfillReady=true 마킹 후 1분 사이클로 누적 보정`);
        try {
            const state = loadState();
            state.backfillReady = true;   // 부분 성공으로 간주 — 자식 머지 활성화
            state.backfillCompletedAt = new Date().toISOString();
            saveState(state, {
                phase: 'backfill_failed_but_marked_ready',
                backfillError: String(e.message || '').substring(0, 200)
            });
        } catch (saveErr) {
            console.log(`[dmdw] backfill catch — saveState failed: ${saveErr.message}`);
        }
    } finally {
        backfillInProgress = false;
    }
}

async function run() {
    if (runInProgress) {
        console.log('[dmdw] previous cycle still running — skip');
        return;
    }
    // [S9-B] 백필이 진행 중이면 1분 사이클은 보류 — 같은 state 파일 동시 쓰기 방지.
    //         백필 완료 후 다음 1분에 자연스럽게 다시 진입.
    if (backfillInProgress) {
        console.log('[dmdw] backfill in progress — defer regular cycle');
        return;
    }
    runInProgress = true;
    const cycleStart = Date.now();
    let skipCount = 0;

    try {
        await ensureSession();

        // 메모리에 기존 상태 로드 (디스크에서 한 번 더 동기화)
        const state = loadState();
        // state.children, state._upcoming 가 기준 — 이번 사이클의 갱신을 누적 반영

        // ====================================================================
        // [자식 푸시] 직전 사이클 스냅샷 — 변화 감지용
        // ====================================================================
        //
        // 이번 사이클이 어떤 자식을 새로 추가/변경/제거하는지 탐지하려면
        // 갱신 전 시점의 children/_upcoming 상태를 가벼운 사본으로 보관한다.
        //
        // 정책:
        //  - 사본은 shallow copy 면 충분. 비교 키는 wrnTpNm/wrnLvlNm/tmEf 정도이고
        //    각 자식 객체는 매 사이클 새 객체로 재대입되므로 reference 공유 무관.
        //  - 이번 사이클이 push 발송에 실패해도 다음 사이클이 같은 스냅샷-비교로
        //    재시도(중복은 dmdwPushSender 내부 _sentKeys 가 막음).
        //  - 이번 사이클이 정기 사이클인지(백필 아님)는 위 함수 진입 시점에 이미 확인됨.
        const prevChildrenSnap = {};
        for (const k of Object.keys(state.children || {})) {
            const c = state.children[k];
            prevChildrenSnap[k] = {
                wrnTp: c.wrnTp, wrnTpNm: c.wrnTpNm,
                wrnLvl: c.wrnLvl, wrnLvlNm: c.wrnLvlNm,
                tmFc: c.tmFc, tmEf: c.tmEf,
                parentZone: c.parentZone
            };
        }
        const prevUpcomingSnap = {};
        for (const k of Object.keys(state._upcoming || {})) {
            const u = state._upcoming[k];
            prevUpcomingSnap[k] = {
                wrnTp: u.wrnTp, wrnTpNm: u.wrnTpNm,
                wrnLvl: u.wrnLvl, wrnLvlNm: u.wrnLvlNm,
                tmFc: u.tmFc, tmEf: u.tmEf,
                parentZone: u.parentZone
            };
        }

        // 이번 사이클의 cycleId — flush() 호출 시 같은 사이클의 적재 이벤트들을 한꺼번에 발송.
        // cycleStart(ms) 를 그대로 사용 (사이클 내 단조성·고유성 보장).
        const pushCycleId = cycleStart;

        // 폴링 윈도우: 최근 N시간
        const nowDt = new Date();
        const nowStr = toDmdwTime(nowDt);
        const sDt = new Date(nowDt.getTime() - LOOKBACK_HOURS * 3600 * 1000);
        const sDate = toDmdwTime(sDt);
        const eDate = toDmdwTime(nowDt);

        // EF (실 발효) + FC (발표) 두 가지 타임라인 가져오기
        const [efCodes, fcCodes] = await Promise.all([
            fetchTimeline('EF', sDate, eDate).catch(e => {
                console.log(`[dmdw] timeline EF fail: ${e.message}`); return [];
            }),
            fetchTimeline('FC', sDate, eDate).catch(e => {
                console.log(`[dmdw] timeline FC fail: ${e.message}`); return [];
            })
        ]);

        // 각 type 의 마지막 처리한 코드 이후의 신규 코드만 처리
        //   - 첫 실행 시 lastCode 비어있음 → 윈도우 전체 처리
        //   - 그 외엔 lastCode 보다 큰 코드만 (사전식 정렬이 시간순과 일치)
        const newEf = efCodes.filter(c => !state.lastCode.EF || c > state.lastCode.EF);
        const newFc = fcCodes.filter(c => !state.lastCode.FC || c > state.lastCode.FC);

        // EF 처리 — 자식별 "현재 발효 상태" 갱신
        // 이번 사이클에서 본 모든 자식 키를 추적 (해제 감지용)
        const seenChildrenThisCycle = new Set();

        // 코드 처리 순서: 시간순 (오래된 → 최신). 그래야 마지막 적용된 상태가 최신 코드의 값.
        const sortedNewEf = [...newEf].sort();
        for (const code of sortedNewEf) {
            let rows;
            try {
                rows = await fetchDetail(code, 'EF');
            } catch (e) {
                console.log(`[dmdw] SKIP EF ${code}: ${e.message}`);
                skipCount++;
                continue;
            }

            for (const row of rows) {
                for (const ent of extractChildEntries(row)) {
                    const key = makeChildKey(ent.parent, ent.childRaw);
                    seenChildrenThisCycle.add(key);
                    // [H1] 자식 객체 전체 재대입 시 직전 사이클의 presentInLastFc 마킹 손실
                    //   방지. 이번 사이클에 신규 FC 코드가 0건이면 갱신 블록(line 1010~)
                    //   이 실행 안 되어 마킹이 undefined 로 잔존 → 자식 박스의
                    //   "해제 예정" 표시가 분 단위로 깜빡이는 현상 발생.
                    //   해결: 기존 객체의 presentInLastFc 가 boolean 이면 보존.
                    const prevPresentInLastFc = state.children[key]
                        && typeof state.children[key].presentInLastFc === 'boolean'
                        ? state.children[key].presentInLastFc
                        : undefined;
                    state.children[key] = {
                        parentZone: ent.parent,
                        wrnTp: ent.wrnTp, wrnTpNm: ent.wrnTpNm,
                        wrnLvl: ent.wrnLvl, wrnLvlNm: ent.wrnLvlNm,
                        tmFc: ent.tmFc, tmEf: ent.tmEf,
                        since: `EF|${code}`,
                        lastCmd: ent.cmd,
                        // 직전 값 보존 — 이번 사이클 FC 처리에서 새 값으로 덮어쓸 수 있음
                        presentInLastFc: prevPresentInLastFc
                    };
                }
            }
            state.lastCode.EF = code;
            await new Promise(r => setTimeout(r, DETAIL_DELAY_MS));
        }

        // ====================================================================
        // [자식 푸시 — EF 변화 감지]
        // ====================================================================
        // EF 코드 전체 처리가 끝난 뒤(자식별 최종 상태가 모두 결정된 후)
        // 직전 스냅샷과 비교하여 다음을 적재한다.
        //   - 신규 자식 등장 → enqueueActive
        //   - 기존 자식의 wrnTpNm/wrnLvlNm 변경 → enqueueLevelChange('active')
        //
        // 시간순 누적 결과만 본다 (한 사이클 내 중간 상태는 무시 — 운영자 입장
        // 에서 의미 있는 변화는 "이번 사이클 끝 시점의 상태").
        if (sortedNewEf.length > 0) {
            try {
                for (const key of seenChildrenThisCycle) {
                    const curr = state.children[key];
                    if (!curr) continue;
                    const prev = prevChildrenSnap[key];
                    const childRawName = _childDisplayNameFromKey(curr.parentZone, key);
                    if (!prev) {
                        // 신규 자식 추가
                        dmdwPushSender.enqueueActive(pushCycleId, curr.parentZone, childRawName, curr);
                    } else if (prev.wrnTpNm !== curr.wrnTpNm || prev.wrnLvlNm !== curr.wrnLvlNm) {
                        // 등급 또는 종류 변경
                        dmdwPushSender.enqueueLevelChange(
                            pushCycleId, curr.parentZone, childRawName, prev, curr, 'active'
                        );
                    }
                }
            } catch (e) {
                console.log(`[dmdw] push enqueue (EF active/level) failed: ${e.message}`);
            }
        }

        // FC 처리 — 미래 발효 예정만 _upcoming 에 보관
        const sortedNewFc = [...newFc].sort();
        const fcSeenThisCycle = new Set();
        for (const code of sortedNewFc) {
            let rows;
            try {
                rows = await fetchDetail(code, 'FC');
            } catch (e) {
                console.log(`[dmdw] SKIP FC ${code}: ${e.message}`);
                skipCount++;
                continue;
            }
            for (const row of rows) {
                for (const ent of extractChildEntries(row)) {
                    const key = makeChildKey(ent.parent, ent.childRaw);
                    fcSeenThisCycle.add(key);
                    if (isFuture(ent.tmEf, nowStr)) {
                        state._upcoming[key] = {
                            parentZone: ent.parent,
                            wrnTp: ent.wrnTp, wrnTpNm: ent.wrnTpNm,
                            wrnLvl: ent.wrnLvl, wrnLvlNm: ent.wrnLvlNm,
                            tmFc: ent.tmFc, tmEf: ent.tmEf,
                            announcedAt: `FC|${code}`
                        };
                    }
                }
            }
            state.lastCode.FC = code;
            await new Promise(r => setTimeout(r, DETAIL_DELAY_MS));
        }

        // ====================================================================
        // [자식 푸시 — FC 변화 감지]
        // ====================================================================
        // FC 사이클 끝에서 _upcoming 의 직전 vs 현재 비교:
        //   - 신규 미래 발효 자식 (직전 _upcoming 에 없고 이번 사이클에 새로 등장) → enqueuePublish
        //   - 기존 미래 발효의 wrnTpNm/wrnLvlNm 변경 → enqueueLevelChange('publish')
        //
        // 추가 안전장치:
        //   - 즉시 발효(tmFc==tmEf) 케이스는 FC 응답에선 isFuture(tmEf, nowStr) 가 false 라
        //     state._upcoming 에 들어가지도 않음 → 자연히 publish 알림 대상 아님.
        //   - 그래도 push sender 의 M3 검증이 이중 안전망으로 작동.
        //   - 이미 EF children 에 있는 자식의 "동일 등급" 미래 발효는 publish 알림 의미가 약함.
        //     하지만 dedupKey 가 tmEf 까지 포함하므로 같은 자식의 다른 tmEf publish 는
        //     별개 이벤트로 인지된다 (사용자 합의: 미래 발효 잡혀도 알림 발송 — 운영자 가시성 우선).
        if (sortedNewFc.length > 0) {
            try {
                for (const key of Object.keys(state._upcoming)) {
                    const curr = state._upcoming[key];
                    if (!curr) continue;
                    const prev = prevUpcomingSnap[key];
                    const childRawName = _childDisplayNameFromKey(curr.parentZone, key);
                    if (!prev) {
                        // 새 미래 발효
                        dmdwPushSender.enqueuePublish(pushCycleId, curr.parentZone, childRawName, curr);
                    } else if (prev.wrnTpNm !== curr.wrnTpNm || prev.wrnLvlNm !== curr.wrnLvlNm) {
                        // 같은 자식의 등급/종류 변경 (예: 풍랑주의보→풍랑경보 격상 발표)
                        dmdwPushSender.enqueueLevelChange(
                            pushCycleId, curr.parentZone, childRawName, prev, curr, 'publish'
                        );
                    } else if (prev.tmEf !== curr.tmEf) {
                        // 등급은 같지만 tmEf 가 바뀐 발표 — 발효 시각 재안내 의미.
                        // (dedupKey 에 tmEf 가 들어가므로 별개 푸시로 인지됨)
                        dmdwPushSender.enqueuePublish(pushCycleId, curr.parentZone, childRawName, curr);
                    }
                }
            } catch (e) {
                console.log(`[dmdw] push enqueue (FC publish/level) failed: ${e.message}`);
            }
        }

        // [해제 감지 — set-diff]
        //   "이전 EF 사이클에 children 에 있었으나 이번 사이클에 한 번도 안 나타난" 자식
        //   = 해제됨. children 에서 제거.
        //   단 신규 EF 코드가 0개면 사이클이 본 게 없는 셈 → 해제 판단 보류 (오인 방지).
        if (sortedNewEf.length > 0) {
            for (const key of Object.keys(state.children)) {
                if (!seenChildrenThisCycle.has(key)) {
                    // [자식 푸시 — 해제] 직전 스냅샷에서 해제 정보(이전 종류/등급/tmEf) 회수.
                    //   prev 가 없다면(스냅샷에 못 들어간 경우) push 는 건너뛰고 state 제거만 수행.
                    try {
                        const prev = prevChildrenSnap[key];
                        if (prev && prev.parentZone) {
                            const childRawName = _childDisplayNameFromKey(prev.parentZone, key);
                            dmdwPushSender.enqueueRelease(pushCycleId, prev.parentZone, childRawName, prev);
                            // forgetChild — 같은 자식이 나중에 다시 발효될 때 푸시가 다시 가도록 이력 정리.
                            dmdwPushSender.forgetChild(prev.parentZone, childRawName);
                        }
                    } catch (e) {
                        console.log(`[dmdw] push enqueue (release) failed: ${e.message}`);
                    }
                    // 자식이 사라짐 — 해제 발효 확정
                    delete state.children[key];
                }
            }
        }

        // [발표(FC) 사이클 등장 여부 갱신 — presentInLastFc]
        //   각 자식별로 "이번 사이클 FC 응답에 등장했는가" 를 boolean 으로 기록.
        //   해제 감지(EF set-diff) 와 동일 정책: 신규 FC 코드가 1건 이상일 때만 갱신.
        //   0건이면 직전 사이클 값 그대로 유지 (오인 방지).
        //
        //   해석:
        //     true  → 통보문에 자식이 여전히 살아있음 (정상 발효 중)
        //     false → 통보문에서 빠짐 = 해제될 것 예고 단계 (S9-E 팝업에서 "해제 예정" 표시 대상)
        //     undefined (필드 자체 없음) → 새로 추가된 자식, FC 사이클 정보 부재
        //                                  S9-E 는 === false 일 때만 표시하므로 안전 fallback
        if (sortedNewFc.length > 0) {
            for (const key of Object.keys(state.children)) {
                state.children[key].presentInLastFc = fcSeenThisCycle.has(key);
            }
        }

        // _upcoming 정리:
        //   1) tmEf 가 이미 과거가 된 항목 (이미 EF 에 흡수됐을 것) 제거
        //   2) FC 사이클에 안 나타난 항목 (예고 취소 / 해제) → 보수적으로 제거
        for (const key of Object.keys(state._upcoming)) {
            const u = state._upcoming[key];
            if (!u || !u.tmEf || u.tmEf <= nowStr) {
                delete state._upcoming[key];
                continue;
            }
            if (sortedNewFc.length > 0 && !fcSeenThisCycle.has(key)) {
                delete state._upcoming[key];
            }
        }

        const elapsedMs = Date.now() - cycleStart;
        saveState(state, {
            lastCycleMs: elapsedMs,
            skipCodesLastCycle: skipCount,
            newEfCodes: sortedNewEf.length,
            newFcCodes: sortedNewFc.length
        });

        console.log(`[dmdw] cycle done — efNew=${sortedNewEf.length} fcNew=${sortedNewFc.length} skip=${skipCount} children=${Object.keys(state.children).length} upcoming=${Object.keys(state._upcoming).length} (${elapsedMs}ms)`);

        // ====================================================================
        // [자식 푸시 — 사이클 flush]
        // ====================================================================
        // 이번 사이클에 적재된 모든 enqueue* 이벤트를 그룹화·200자 분할·중복방지 적용해
        // 관리자 기기로 발송. push sender 내부에서 admin_push 실패는 흡수되며,
        // 그래도 throw 가 새 나가는 극단 케이스를 대비해 try/catch 로 한 번 더 감싼다.
        // (크롤러 본체에는 어떤 영향도 끼치지 않는 것이 본 통합의 핵심 원칙.)
        try {
            const flushed = await dmdwPushSender.flush(pushCycleId);
            if (flushed && flushed.length > 0) {
                console.log(`[dmdw] child push flushed: ${flushed.length} push(es)`);
            }
        } catch (e) {
            console.log(`[dmdw] push flush failed: ${e.message}`);
        }

        // [관리자 알림 — 정상화]
        //  직전 사이클들에서 issue(로그인 실패 등) 가 있었다면 이번 사이클이 끝까지
        //  성공적으로 돌았다는 의미 → 정상화 알림 1회 발송.
        await markRecoveredIfNeeded();
    } catch (e) {
        // 어떠한 예외도 상위(scheduler) 로 던지지 않음 — 다음 사이클에 재시도.
        // 자격증명 실패류는 ensureSession() 안에서 재로그인 시도, 그래도 실패면 메시지만.
        console.log(`[dmdw] cycle error: ${e.message}`);

        // [관리자 알림 — 비-자격증명 계열 장애 분기]
        //  자격증명 실패(statecode != 10)는 login() 안에서 이미 markIssueAndNotify 처리됨.
        //  여기서는 그 외 사유로 사이클이 중단된 경우만 다룬다 (네트워크/CSRF/타임아웃 등).
        //  e.message 에 'statecode=' 가 포함되어 있으면 login() 의 throw 라 중복 발송 방지.
        const msg = String(e.message || '');
        if (!msg.includes('statecode=')) {
            await markIssueAndNotify(
                'login_fail_network',
                '🌐 방재기상플랫폼 접속/통신 실패',
                `방재기상플랫폼(dmdw.kma.go.kr) 과의 통신에 문제가 발생하여 자식 해역 ` +
                `(연안바다·평수구역) 특보 자동 갱신이 일시 중단되었습니다. ` +
                `1분 후 자동으로 재시도되며, 일시적 네트워크 장애일 가능성이 높습니다. ` +
                `30분 이상 지속되면 KMA 서버 상태 또는 방화벽 변경을 확인해 주세요.`,
                msg.substring(0, 200)   // detail — 원본 에러 메시지
            );
        }
    } finally {
        runInProgress = false;
    }
}

// ============================================================================
// 12. 모듈 export
// ============================================================================

module.exports = {
    enabled: true,
    run,
    // [S9-B] 서버 시작 시 1회 호출되는 백필 함수.
    //         backfillReady 가 false 인 동안 routes/weather.js 가 자식 머지를 보류.
    runBackfill
};
