/**
 * ============================================================================
 * 파일명: typhoon_crawler.js
 * 역할 : 방재기상플랫폼(dmdw.kma.go.kr) "태풍정보" 페이지에서 현재(최신) 태풍의
 *        통보문 목록(드롭다운)과 각 통보문의 예보 표(중심위치·반경·강도 등)를
 *        수집해 data/typhoon.json 으로 저장.
 * ============================================================================
 *
 * [이 모듈이 만드는 데이터]
 *   - 현재 연도 태풍 목록(typhoons)
 *   - 최신 태풍(active)의 통보문 목록(bulletins) — UI 드롭다운용
 *   - 각 통보문의 현재 위치(current) + 예상 진로(forecast[]) — 지도 애니메이션용
 *
 * [데이터 흐름]
 *   scheduler.js (주기 호출) → run()
 *     → login (필요 시) → retTypCombo(연도) → 최신 태풍 선택
 *     → retTypDetailCombo(연도, typSeq) → 통보문 목록
 *     → 신규 통보문만 rswTypInfoRetrieve / rswTypTdRetrieve 호출 (증분 캐시)
 *     → 정규화 후 data/typhoon.json 원자적 저장
 *   GET /api/typhoon (routes/typhoon.js) → 위 파일을 그대로 응답
 *   js/ocean_typhoon.js → 지도 오버레이 + 재생 애니메이션
 *
 * [자격증명] dmdw 크롤러와 동일한 계정 재사용:
 *   - process.env.KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD
 *   - process.env.KMA_DMDW_DISABLE === '1' 이면 강제 비활성
 *   미설정 시 enabled=false 로 silent disable (운영 영향 0).
 * ============================================================================
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const { URLSearchParams } = require('url');

const USER_ID = process.env.KMA_DMDW_USER_ID || '';
const USER_PWD = process.env.KMA_DMDW_USER_PWD || '';
const FORCE_DISABLED = process.env.KMA_DMDW_DISABLE === '1';
const ENABLED = !!USER_ID && !!USER_PWD && !FORCE_DISABLED;

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'typhoon.json');
const TMP_FILE = OUTPUT_FILE + '.tmp';

if (!ENABLED) {
    console.log('[typhoon] 자격증명 미설정 — 태풍 수집기 비활성 (운영 영향 없음).');
    module.exports = { enabled: false, async run() { /* no-op */ } };
    return;
}

const HOST = 'dmdw.kma.go.kr';
const HTTP_TIMEOUT_MS = 20000;
const SESSION_REFRESH_MS = 3 * 60 * 60 * 1000; // 3시간마다 예방적 재로그인
const DETAIL_DELAY_MS = 150;                   // 통보문 표 호출 간 간격
const MAX_BULLETINS = 60;                      // 안전 상한 (한 태풍의 통보문 표 수집 개수)

const PATHS = {
    MAIN: '/rsw/mfp/mfpMain',
    LOGIN: '/rsw/rest/frm/login_user',
    TYP_PAGE: '/rsw/mfp/typ/rswTypInfoRetrieve',
    COMBO: '/rsw/rest/mfp/typ/retTypCombo.json',          // 태풍명 목록
    DETAIL_COMBO: '/rsw/rest/mfp/typ/retTypDetailCombo.json', // 통보문 목록
    TYP_DATA: '/rsw/mfp/typ/rswTypInfoRetrieve',          // 태풍정보(oTypInfo=1) 표 JSON
    TD_DATA: '/rsw/mfp/typ/rswTypTdRetrieve'              // TD정보(oTypInfo=3) 표 JSON
};

// ----------------------------------------------------------------------------
// 세션 상태 (메모리)
// ----------------------------------------------------------------------------
const session = { cookies: {}, csrf: '', loginAt: 0 };
let runInProgress = false;

function maskId(id) { return id ? id.replace(/(.{3}).+(@.+)/, '$1***$2') : '(none)'; }
function enc64(s) { return Buffer.from(encodeURIComponent(s), 'utf8').toString('base64'); }
function cookieHeader() { return Object.entries(session.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
function ingestCookies(setCookies) {
    if (!setCookies) return;
    (Array.isArray(setCookies) ? setCookies : [setCookies]).forEach(c => {
        const kv = c.split(';')[0].trim();
        const i = kv.indexOf('=');
        if (i > 0) session.cookies[kv.substring(0, i)] = kv.substring(i + 1);
    });
}
function extractCsrf(html) {
    const m = html.match(/name=["']_csrf["']\s+content=["']([^"']+)["']/);
    return m ? m[1] : '';
}

function httpGet(urlPath, extra) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            method: 'GET', host: HOST, path: urlPath,
            headers: Object.assign({
                'User-Agent': 'Mozilla/5.0 (SEAGNAL/typhoon-crawler)',
                'Accept': 'text/html,application/json',
                'Cookie': cookieHeader()
            }, extra || {}),
            timeout: HTTP_TIMEOUT_MS
        }, res => {
            ingestCookies(res.headers['set-cookie']);
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.end();
    });
}

function httpPost(urlPath, formObj, extra) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams(formObj).toString();
        const req = https.request({
            method: 'POST', host: HOST, path: urlPath,
            headers: Object.assign({
                'User-Agent': 'Mozilla/5.0 (SEAGNAL/typhoon-crawler)',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Content-Length': Buffer.byteLength(body),
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRF-TOKEN': session.csrf,
                'Referer': `https://${HOST}${PATHS.TYP_PAGE}`,
                'Origin': `https://${HOST}`,
                'Cookie': cookieHeader()
            }, extra || {}),
            timeout: HTTP_TIMEOUT_MS
        }, res => {
            ingestCookies(res.headers['set-cookie']);
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.write(body);
        req.end();
    });
}

// ----------------------------------------------------------------------------
// 로그인 / 세션
// ----------------------------------------------------------------------------
async function login() {
    const main = await httpGet(PATHS.MAIN);
    session.csrf = extractCsrf(main.text);
    if (!session.csrf) throw new Error('CSRF 토큰 추출 실패');

    const loginRes = await httpPost(PATHS.LOGIN, { userId: enc64(USER_ID), userPwd: enc64(USER_PWD) },
        { 'Referer': `https://${HOST}${PATHS.MAIN}` });
    let lj;
    try { lj = JSON.parse(loginRes.text); } catch (e) { throw new Error('login JSON 파싱 실패'); }
    const state = lj && lj.body && lj.body.result && lj.body.result.statecode;
    if (state !== '10') throw new Error(`login 실패 statecode=${state}`);

    // 태풍 페이지 GET → 새 CSRF
    const page = await httpGet(PATHS.TYP_PAGE);
    const c2 = extractCsrf(page.text);
    if (c2) session.csrf = c2;
    session.loginAt = Date.now();
    console.log(`[typhoon] login ok (user=${maskId(USER_ID)})`);
}

async function ensureSession() {
    if (!session.csrf || !session.cookies.AFS2O_SESSION || Date.now() - session.loginAt > SESSION_REFRESH_MS) {
        await login();
    }
}

// dmdw 응답 래퍼에서 body 추출 (두 가지 형태 모두 지원)
function unwrapBody(j) {
    if (!j) return null;
    if (j.body !== undefined) return j.body;
    if (j.kafApiResVo && j.kafApiResVo.body !== undefined) return j.kafApiResVo.body;
    return null;
}

// ----------------------------------------------------------------------------
// 콤보(목록) 조회
// ----------------------------------------------------------------------------
async function fetchTypCombo(year) {
    const res = await httpPost(PATHS.COMBO, { reqYyyy: String(year) });
    if (res.statusCode !== 200) throw new Error(`combo HTTP ${res.statusCode}`);
    const body = unwrapBody(JSON.parse(res.text));
    return Array.isArray(body) ? body : []; // [{code, value}]
}

async function fetchDetailCombo(year, typSeq) {
    const res = await httpPost(PATHS.DETAIL_COMBO, { reqYyyy: String(year), oTypSeq: String(typSeq) });
    if (res.statusCode !== 200) throw new Error(`detailCombo HTTP ${res.statusCode}`);
    const body = unwrapBody(JSON.parse(res.text));
    return Array.isArray(body) ? body : []; // [{code, value}] code="oTypInfo_oTmFc_oTdSeq_oTmSeq"
}

// ----------------------------------------------------------------------------
// 통보문 표 조회 + 정규화
// ----------------------------------------------------------------------------
function num(v) {
    if (v === null || v === undefined) return null;
    const n = parseFloat(String(v).trim());
    return Number.isFinite(n) ? n : null;
}
function trimStr(v) { return v === null || v === undefined ? '' : String(v).trim(); }

// 강도(grade): pwr(1~5) 우선, 없으면 풍속(m/s)로 판정. TD(<17m/s)는 0.
function deriveGrade(pwr, windMs) {
    const p = parseInt(String(pwr).trim(), 10);
    if (Number.isFinite(p) && p >= 1 && p <= 5) return p;
    const w = num(windMs);
    if (w === null) return 0;
    if (w < 17) return 0;       // 열대저압부
    if (w < 25) return 1;       // 약
    if (w < 33) return 2;       // 중
    if (w < 44) return 3;       // 강
    if (w < 54) return 4;       // 매우 강
    return 5;                   // 초강력
}

// 예보 표의 한 행 → 정규화된 프레임
function normRow(r, isCurrent) {
    const windMs = num(r.ftWs != null ? r.ftWs : r.typWs);
    const pwr = r.pwr;
    return {
        time: trimStr(r.ftTm || r.typTm),                 // YYYYMMDDHHmm
        lat: num(r.ftLat != null ? r.ftLat : (r.typLat != null ? r.typLat : r.tdLat)),
        lon: num(r.ftLon != null ? r.ftLon : (r.typLon != null ? r.typLon : r.tdLon)),
        pressure: num(r.ftPs != null ? r.ftPs : r.typPs), // hPa
        windMs: windMs,                                   // m/s
        windKmh: windMs != null ? Math.round(windMs * 3.6) : null,
        dir: trimStr(r.ftDir || r.typDir),                // 진행방향 (NNW 등)
        speedKmh: num(r.ftSp != null ? r.ftSp : r.typSp), // 이동속도 km/h
        radStrong: num(r.ft15er != null ? r.ft15er : r.typ15er), // 강풍반경(15m/s) km
        radStorm: num(r.ft25er != null ? r.ft25er : r.typ25er),  // 폭풍반경(25m/s) km
        radProb: num(r.radPr != null ? r.radPr : r.ftRad),       // 70% 확률반경 km
        grade: deriveGrade(pwr, windMs),                  // 0(TD)~5
        size: trimStr(r.sz),                              // 소형/중형/대형/초대형
        isCurrent: !!isCurrent
    };
}

// 통보문 1건의 표 조회 → { current, forecast[] }
async function fetchBulletin(year, code) {
    const parts = String(code).split('_');
    const oTypInfo = parts[0];        // '1'=태풍정보, '3'=TD정보
    const oTmFc = parts[1];           // 발표시각
    const oTdSeq = parts[2];          // 호수
    const oTmSeq = parts[parts.length - 1]; // 회차

    let form, urlPath;
    if (oTypInfo === '3') {
        urlPath = PATHS.TD_DATA;
        form = { lang: 'Kor', reqYyyy: String(year), oTmFc, oTmSeq, oTdSeq };
    } else {
        urlPath = PATHS.TYP_DATA;
        form = { lang: 'Kor', reqYyyy: String(year), oTypSeq: oTdSeq, oTmFc, oTmSeq };
    }
    const res = await httpPost(urlPath, form);
    if (res.statusCode !== 200) throw new Error(`bulletin HTTP ${res.statusCode}`);
    let j;
    try { j = JSON.parse(res.text); } catch (e) { throw new Error('bulletin JSON 파싱 실패(세션 만료 추정)'); }

    const fct = Array.isArray(j.fctList) ? j.fctList : [];
    const infoArr = Array.isArray(j.infoList) ? j.infoList
        : (Array.isArray(j.tdInfoList) ? j.tdInfoList : []);

    const forecast = fct.map(row => normRow(row, false)).filter(f => f.lat != null && f.lon != null);
    let current = null;
    if (infoArr.length) {
        const c = normRow(infoArr[0], true);
        if (c.lat != null && c.lon != null) current = c;
    }
    const name = infoArr.length ? trimStr(infoArr[0].typName || infoArr[0].tdName) : '';
    const nameEn = infoArr.length ? trimStr(infoArr[0].typEn || infoArr[0].tdEn) : '';
    return { current, forecast, name, nameEn };
}

// 통보문 라벨에서 종류/발표시각 파싱 (UI 표시는 value 그대로 사용)
function parseCode(code) {
    const p = String(code).split('_');
    return { kind: p[0] === '3' ? 'TD' : 'TYP', tmFc: p[1] || '', tdSeq: p[2] || '', tmSeq: p[p.length - 1] || '' };
}

// ----------------------------------------------------------------------------
// 디스크 저장/로드 (원자적)
// ----------------------------------------------------------------------------
function loadPrev() {
    try {
        if (fs.existsSync(OUTPUT_FILE)) return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (e) { /* ignore */ }
    return null;
}
function save(obj) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TMP_FILE, JSON.stringify(obj, null, 1), 'utf8');
    fs.renameSync(TMP_FILE, OUTPUT_FILE);
}

function kstYear() {
    const d = new Date();
    const kst = new Date(d.getTime() + (d.getTimezoneOffset() * 60000) + 9 * 3600000);
    return kst.getFullYear();
}

// ----------------------------------------------------------------------------
// 메인 run()
// ----------------------------------------------------------------------------
async function run() {
    if (runInProgress) return;
    runInProgress = true;
    try {
        await ensureSession();
        const year = kstYear();
        const typList = await fetchTypCombo(year);

        if (!typList.length) {
            save({ updatedAt: new Date().toISOString(), year, hasActive: false, typhoons: [], active: null, bulletins: [] });
            return;
        }

        const typhoons = typList.map(t => ({ seq: String(t.code), name: trimStr(t.value) }));
        const active = typhoons[0]; // 목록은 최신(호수 큰 순) → 첫 번째가 최신 태풍

        const combo = await fetchDetailCombo(year, active.seq);
        if (!combo.length) {
            save({ updatedAt: new Date().toISOString(), year, hasActive: false, typhoons, active: null, bulletins: [] });
            return;
        }

        // 증분 캐시: 직전 typhoon.json 의 같은 태풍 통보문 표 재사용
        const prev = loadPrev();
        const prevMap = {};
        if (prev && prev.active && prev.active.seq === active.seq && Array.isArray(prev.bulletins)) {
            prev.bulletins.forEach(b => { if (b && b.code) prevMap[b.code] = b; });
        }

        const limited = combo.slice(0, MAX_BULLETINS);
        const bulletins = [];
        for (let i = 0; i < limited.length; i++) {
            const opt = limited[i];
            const code = String(opt.code);
            const meta = parseCode(code);
            if (prevMap[code] && Array.isArray(prevMap[code].forecast) && prevMap[code].forecast.length) {
                // 이미 캐시된 통보문 — 라벨/순서만 최신화하여 재사용
                bulletins.push(Object.assign({}, prevMap[code], { label: trimStr(opt.value), isLatest: i === 0 }));
                continue;
            }
            try {
                const data = await fetchBulletin(year, code);
                bulletins.push({
                    code,
                    label: trimStr(opt.value),
                    kind: meta.kind,
                    tmFc: meta.tmFc,
                    seq: meta.tmSeq,
                    isLatest: i === 0,
                    current: data.current,
                    forecast: data.forecast
                });
            } catch (e) {
                console.log(`[typhoon] 통보문 수집 실패(${code}): ${e.message}`);
                // 세션 만료 추정 시 1회 재로그인 후 다음 통보문 계속
                if (/세션|파싱|HTTP 30|HTTP 401/.test(e.message)) {
                    try { await login(); } catch (e2) { /* ignore */ }
                }
            }
            await new Promise(r => setTimeout(r, DETAIL_DELAY_MS));
        }

        save({
            updatedAt: new Date().toISOString(),
            year,
            hasActive: bulletins.length > 0,
            typhoons,
            active: { seq: active.seq, name: active.name, nameEn: bulletins.find(b => b.nameEn) ? bulletins.find(b => b.nameEn).nameEn : '' },
            bulletins
        });
        console.log(`[typhoon] 수집 완료 — 태풍 ${active.name}, 통보문 ${bulletins.length}건`);
    } catch (e) {
        console.log(`[typhoon] run 오류: ${e.message}`);
    } finally {
        runInProgress = false;
    }
}

module.exports = { enabled: true, run };
