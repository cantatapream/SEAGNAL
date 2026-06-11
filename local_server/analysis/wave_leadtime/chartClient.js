/**
 * ============================================================================
 * chartClient.js — 방재기상플랫폼(dmdw) 위험기상일기도(해상풍/유의파고) 차트 클라이언트
 * ============================================================================
 *
 * [목적]
 *  과거 특정 base time(발표시각)의 해상 수치예보 일기도(GIF)를 인증 세션으로
 *  내려받는다. dmdw_warn_crawler.js 와 동일한 로그인 규약을 재사용한다.
 *
 * [역설계로 확인된 흐름 — 2026-06]
 *  1) GET  /rsw/mfp/mfpMain                     → 쿠키 + CSRF
 *  2) POST /rsw/rest/frm/login_user             → base64(encodeURIComponent) 자격증명, statecode==10
 *  3) GET  /rsw/mfp/cht/rswChtSvrRetrieve       → 위험기상일기도 페이지 (CSRF 갱신)
 *  4) POST /rsw/mfp/cht/rswChtSvrBodyRetrieve   → cmdType=LIST + headData(prefix) + tm(base)
 *         → 응답 HTML 안에 <img src=".../retChtSvrImgView?...&dirName=..&fileName=..gif"> 들
 *  5) GET  /rsw/rest/mfp/cht/retChtSvrImgView?cmdType=VIEW&tm=&dirName=&fileName=  → image/gif
 *
 * [headData 규약]  "<flag>#<step>#<unit>#<basePath>#<filePrefix>"
 *  예) KIM전구 광역 해상풍·유의파고:
 *      "0#12#3#/DATA/CHT/KIMA/#/kim_rww3_wave_ft03_pa4_"
 *      → 파일명: kim_rww3_wave_ft03_pa4_s###_<basetime>.gif (s000~s120, 3시간 간격)
 *  예) 국지해안(지방청) 각 청 해상풍/유의파고 (APPM):
 *      "0#12#3#/DATA/CHT/APPM/#/cww3_jeju_wave_"
 *
 * [자격증명]  process.env.KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD
 *  (dmdw_warn_crawler.js 와 동일 변수 재사용)
 * ============================================================================
 */
'use strict';

const https = require('https');
const { URLSearchParams } = require('url');

const HOST = 'dmdw.kma.go.kr';
const BASE = 'https://' + HOST;
const HTTP_TIMEOUT_MS = 20000;

// ----------------------------------------------------------------------------
// 청별 국지해안(지방청) 해상풍/유의파고 prefix 카탈로그
//  - rswChtSvrRetrieve.js 의 frmBValue10NotCompare(국지해안 지방청) 에서 추출
//  - CSV '지역' 컬럼과의 매핑을 함께 보관 (warnings.js 매칭에 사용)
// ----------------------------------------------------------------------------
const REGIONAL_OFFICES = {
    jeju: { name: '제주청',  csvRegion: '제주도',              prefixKIM: 'kim_cww3_jeju_wave_', prefixAPPM: 'cww3_jeju_wave_' },
    busn: { name: '부산청',  csvRegion: '부산·울산·경상남도',  prefixKIM: 'kim_cww3_busn_wave_', prefixAPPM: 'cww3_busn_wave_' },
    gwju: { name: '광주청',  csvRegion: '광주·전라남도',        prefixKIM: 'kim_cww3_gwju_wave_', prefixAPPM: 'cww3_gwju_wave_' },
    degu: { name: '대구청',  csvRegion: '대구·경상북도',        prefixKIM: null,                  prefixAPPM: 'cww3_degu_wave_' },
    gawn: { name: '강원청',  csvRegion: '강원특별자치도',        prefixKIM: 'kim_cww3_gawn_wave_', prefixAPPM: 'cww3_gawn_wave_' },
    dajn: { name: '대전청',  csvRegion: '대전·세종·충청남도',  prefixKIM: 'kim_cww3_dajn_wave_', prefixAPPM: 'cww3_dajn_wave_' },
};

// 광역(KIM전구 ReWW3) 해상풍·유의파고 — 전국 1장, 단일 투영(검증 완료)
const NATIONAL_WAVE = {
    model: 'KIMA', modelText: 'KIM전구', type: 'wave',
    headData: '0#12#3#/DATA/CHT/KIMA/#/kim_rww3_wave_ft03_pa4_',
};

// ----------------------------------------------------------------------------
// 세션 상태 (메모리)
// ----------------------------------------------------------------------------
const session = { cookies: {}, csrf: '', loginAt: 0 };
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

const enc64 = (s) => Buffer.from(encodeURIComponent(s), 'utf8').toString('base64');
const cookieHeader = () => Object.entries(session.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
function ingest(setCookie) {
    if (!setCookie) return;
    (Array.isArray(setCookie) ? setCookie : [setCookie]).forEach((c) => {
        const kv = c.split(';')[0].trim();
        const i = kv.indexOf('=');
        if (i > 0) session.cookies[kv.slice(0, i)] = kv.slice(i + 1);
    });
}

function request(method, path, body, extra) {
    return new Promise((resolve, reject) => {
        const headers = Object.assign(
            { 'User-Agent': 'Mozilla/5.0 (SEAGNAL/wave-leadtime)', 'Cookie': cookieHeader() },
            extra || {}
        );
        if (body) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
            headers['Content-Length'] = Buffer.byteLength(body);
        }
        const req = https.request({ method, host: HOST, path, headers, timeout: HTTP_TIMEOUT_MS }, (res) => {
            ingest(res.headers['set-cookie']);
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        if (body) req.write(body);
        req.end();
    });
}

const extractCsrf = (html) => {
    const m = html.match(/name=["']_csrf["']\s+content=["']([^"']+)["']/);
    return m ? m[1] : '';
};

async function login() {
    const USER_ID = process.env.KMA_DMDW_USER_ID || '';
    const USER_PWD = process.env.KMA_DMDW_USER_PWD || '';
    if (!USER_ID || !USER_PWD) throw new Error('KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD 미설정');

    const warm = await request('GET', '/rsw/mfp/mfpMain');
    session.csrf = extractCsrf(warm.buf.toString('utf8'));
    if (!session.csrf) throw new Error('CSRF 토큰 추출 실패');

    const loginBody = new URLSearchParams({ userId: enc64(USER_ID), userPwd: enc64(USER_PWD) }).toString();
    const lr = await request('POST', '/rsw/rest/frm/login_user', loginBody, {
        'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': session.csrf,
        'Origin': BASE, 'Referer': BASE + '/rsw/mfp/mfpMain', 'Accept': 'application/json',
    });
    let lj;
    try { lj = JSON.parse(lr.buf.toString('utf8')); } catch (e) { throw new Error('로그인 응답 JSON 파싱 실패'); }
    const state = lj && lj.body && lj.body.result && lj.body.result.statecode;
    if (state !== '10') throw new Error(`로그인 거부: statecode=${state}`);

    // 위험기상일기도 페이지 → 새 CSRF
    const pg = await request('GET', '/rsw/mfp/cht/rswChtSvrRetrieve', null, { 'Referer': BASE + '/rsw/mfp/mfpSub?lv2Id=B002' });
    const c2 = extractCsrf(pg.buf.toString('utf8'));
    if (c2) session.csrf = c2;
    session.loginAt = Date.now();
}

async function ensureSession() {
    if (!session.csrf || !session.cookies.AFS2O_SESSION || Date.now() - session.loginAt > SESSION_TTL_MS) {
        await login();
    }
}

// ----------------------------------------------------------------------------
// base time(YYYYMMDDHH, KST) 의 프레임 목록 조회.
//   반환: [{ fileName, dirName, tm, stm(예보 step 's012'), ftHours(예보시간) }]
// ----------------------------------------------------------------------------
async function listFrames({ headData, model = 'KIMA', modelText = 'KIM전구', type = 'wave' }, baseTimeYmdh) {
    await ensureSession();
    const body = new URLSearchParams({
        cmdType: 'LIST', model, modelText, autoMan: 'A', type,
        headData, dtm: '0', tm: baseTimeYmdh, tmEf: '',
    }).toString();
    const r = await request('POST', '/rsw/mfp/cht/rswChtSvrBodyRetrieve', body, {
        'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': session.csrf,
        'Origin': BASE, 'Referer': BASE + '/rsw/mfp/cht/rswChtSvrRetrieve', 'Accept': '*/*',
    });
    if (r.status !== 200) throw new Error(`LIST HTTP ${r.status}`);
    const html = r.buf.toString('utf8');
    // <img src="/rsw/rest/mfp/cht/retChtSvrImgView?cmdType=VIEW&tm=..&dirName=..&fileName=..gif" ...>
    const frames = [];
    const seen = new Set();
    const re = /retChtSvrImgView\?cmdType=VIEW&tm=([^&"']+)&dirName=([^&"']+)&fileName=([^&"'\s]+\.gif)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const fileName = m[3];
        if (seen.has(fileName)) continue;
        seen.add(fileName);
        const stmMatch = fileName.match(/_s(\d{3})_/);
        frames.push({
            tm: m[1],
            dirName: m[2],
            fileName,
            stm: stmMatch ? 's' + stmMatch[1] : null,
            ftHours: stmMatch ? parseInt(stmMatch[1], 10) : null, // s012 → +12h
        });
    }
    return frames;
}

// ----------------------------------------------------------------------------
// 프레임 1장(GIF Buffer) 다운로드.
// ----------------------------------------------------------------------------
async function downloadFrame(frame) {
    await ensureSession();
    const path = `/rsw/rest/mfp/cht/retChtSvrImgView?cmdType=VIEW&tm=${encodeURIComponent(frame.tm)}` +
        `&dirName=${encodeURIComponent(frame.dirName)}&fileName=${encodeURIComponent(frame.fileName)}`;
    let r = await request('GET', path, null, {
        'Referer': BASE + '/rsw/mfp/cht/rswChtSvrRetrieve', 'Accept': 'image/*,*/*',
    });
    const ctype = (r.headers['content-type'] || '').toLowerCase();
    if (r.status !== 200 || ctype.indexOf('image') === -1) {
        // 세션 만료 추정 → 1회 재로그인 후 재시도
        await login();
        r = await request('GET', path, null, { 'Referer': BASE + '/rsw/mfp/cht/rswChtSvrRetrieve', 'Accept': 'image/*,*/*' });
    }
    const ct2 = (r.headers['content-type'] || '').toLowerCase();
    if (ct2.indexOf('image') === -1) throw new Error(`이미지 아님 (HTTP ${r.status}, ${ct2})`);
    return r.buf;
}

module.exports = {
    REGIONAL_OFFICES, NATIONAL_WAVE,
    login, ensureSession, listFrames, downloadFrame,
};
