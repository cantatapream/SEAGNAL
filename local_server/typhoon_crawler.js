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
    module.exports = {
        enabled: false,
        async run() { /* no-op */ },
        async getTyphoonList() { return []; },
        async getBulletinList() { return []; },
        async getBulletin() { return null; },
        async getTyphoonImage() { return { statusCode: 503, contentType: '', buffer: Buffer.alloc(0) }; }
    };
    return;
}

const HOST = 'dmdw.kma.go.kr';
const HTTP_TIMEOUT_MS = 20000;
const SESSION_REFRESH_MS = 3 * 60 * 60 * 1000; // 3시간마다 예방적 재로그인
const DETAIL_DELAY_MS = 150;                   // 통보문 표 호출 간 간격
const MAX_BULLETINS = 60;                      // 안전 상한 (한 태풍의 통보문 표 수집 개수)
const MAX_CHECK_TYPHOONS = 5;                  // 활성 여부를 검사할 최근 태풍 수(최신 seq부터)
const ACTIVE_WINDOW_HOURS = 72;                // 최신 통보문이 이 시간 내면 "활성"으로 간주
                                               //   (태풍 종료 통보문 발표 후에도 3일간 버튼/조회 유지 — 사용자 요구)

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
let _loginPromise = null;   // 동시 로그인 직렬화(폴러 + on-demand 요청 동시 접근 대비)

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
    const need = !session.csrf || !session.cookies.AFS2O_SESSION
        || Date.now() - session.loginAt > SESSION_REFRESH_MS;
    if (!need) return;
    if (_loginPromise) return _loginPromise;          // 진행 중 로그인 재사용
    _loginPromise = login().finally(() => { _loginPromise = null; });
    return _loginPromise;
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
        // 강풍/폭풍반경은 비대칭(위험반원=장반경 / 가항반원=단반경). KMA 는 대표(장)반경 + 단반경 방향을 제공.
        //   radStrong  : 장반경(대표 강풍반경, km) — KMA "강풍반경" 헤드라인 값
        //   radStrongS : 단반경(가항측으로 줄어든 반경, km)
        //   radStrongD : 단반경 방향(8/16방위, 예: SW) — 이 방향 반원이 작아짐
        radStrong: num(r.ft15 != null ? r.ft15 : (r.typ15 != null ? r.typ15 : (r.ft15er != null ? r.ft15er : r.typ15er))),
        radStrongS: num(r.ft15er != null ? r.ft15er : r.typ15er),
        radStrongD: trimStr(r.ft15ed != null ? r.ft15ed : r.typ15ed),
        radStorm: num(r.ft25 != null ? r.ft25 : (r.typ25 != null ? r.typ25 : (r.ft25er != null ? r.ft25er : r.typ25er))),
        radStormS: num(r.ft25er != null ? r.ft25er : r.typ25er),
        radStormD: trimStr(r.ft25ed != null ? r.ft25ed : r.typ25ed),
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
    // rem: 발표 예정/약화·종료 안내(여러 문장은 '|' 구분). other: 참고사항(이름 출처 등).
    const rem = infoArr.length ? trimStr(infoArr[0].rem) : '';
    const other = infoArr.length ? trimStr(infoArr[0].other) : '';
    return { current, forecast, name, nameEn, rem, other };
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

// 통보문 발표시각 "YYYYMMDDHHmm"(KST) → 실제 UTC epoch ms (활성 판정용)
function tmFcToMs(s) {
    const d = String(s || '').replace(/[^0-9]/g, '');
    if (d.length < 12) return 0;
    return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10), +d.slice(10, 12)) - 9 * 3600000;
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
            save({ updatedAt: new Date().toISOString(), year, hasActive: false, typhoons: [] });
            return;
        }

        // 증분 캐시: 직전 typhoon.json 의 (seq, code) 별 통보문 표 재사용
        const prev = loadPrev();
        const prevMap = {};
        if (prev && Array.isArray(prev.typhoons)) {
            prev.typhoons.forEach(t => (t.bulletins || []).forEach(b => { if (b && b.code) prevMap[t.seq + '_' + b.code] = b; }));
        }

        const nowMs = Date.now();
        const win = ACTIVE_WINDOW_HOURS * 3600 * 1000;
        const checkList = typList.slice(0, MAX_CHECK_TYPHOONS); // 최신 seq 몇 개만 활성 검사
        const activeTyphoons = [];

        for (const t of checkList) {
            const seq = String(t.code);
            const name = trimStr(t.value);
            let combo;
            try { combo = await fetchDetailCombo(year, seq); }
            catch (e) { console.log(`[typhoon] detailCombo 실패(${seq}): ${e.message}`); continue; }
            if (!combo.length) continue;

            const latestTmFc = parseCode(String(combo[0].code)).tmFc;
            const latestMs = tmFcToMs(latestTmFc);
            if (!latestMs || (nowMs - latestMs) > win) continue; // 비활성(오래된 통보문) → skip

            const limited = combo.slice(0, MAX_BULLETINS);
            const bulletins = [];
            let nameEn = '';
            for (let i = 0; i < limited.length; i++) {
                const opt = limited[i];
                const code = String(opt.code);
                const meta = parseCode(code);
                const key = seq + '_' + code;
                // rem 필드가 없는(구버전) 캐시는 재수집해 rem/other 를 보강한다.
                if (prevMap[key] && Array.isArray(prevMap[key].forecast) && prevMap[key].forecast.length && prevMap[key].rem !== undefined) {
                    const cached = Object.assign({}, prevMap[key], { label: trimStr(opt.value), isLatest: i === 0 });
                    // 영문명은 "최신 태풍단계(TYP)" 통보문에서 취한다. 목록은 최신→과거 순이라
                    //   먼저 만난 TYP(=최신) 값만 채택하고, 이후 과거·TD 통보문이 덮어쓰지 않게 한다.
                    //   (과거 TD 통보문의 tdEn='TD' 등이 최종 nameEn 을 덮어써 'TD'로 남던 버그 방지.)
                    if (meta.kind === 'TYP' && !nameEn && cached.nameEn) nameEn = cached.nameEn;
                    bulletins.push(cached);
                    continue;
                }
                try {
                    const data = await fetchBulletin(year, code);
                    // 영문명은 최신 TYP 통보문 기준(위 캐시 분기와 동일 규칙 — TD 덮어쓰기 방지).
                    if (meta.kind === 'TYP' && !nameEn && data.nameEn) nameEn = data.nameEn;
                    bulletins.push({
                        code, label: trimStr(opt.value), kind: meta.kind, tmFc: meta.tmFc, seq: meta.tmSeq,
                        isLatest: i === 0, nameEn: data.nameEn, current: data.current, forecast: data.forecast,
                        rem: data.rem, other: data.other
                    });
                } catch (e) {
                    console.log(`[typhoon] 통보문 수집 실패(${code}): ${e.message}`);
                    if (/세션|파싱|HTTP 30|HTTP 401/.test(e.message)) { try { await login(); } catch (e2) { /* ignore */ } }
                }
                await new Promise(r => setTimeout(r, DETAIL_DELAY_MS));
            }
            if (bulletins.length) activeTyphoons.push({ seq, name, nameEn, latestTmFc, bulletins });
        }

        save({
            updatedAt: new Date().toISOString(),
            year,
            hasActive: activeTyphoons.length > 0,
            typhoons: activeTyphoons
        });
        console.log(`[typhoon] 수집 완료 — 활성 태풍 ${activeTyphoons.length}개 (${activeTyphoons.map(t => t.name).join(', ')})`);
    } catch (e) {
        console.log(`[typhoon] run 오류: ${e.message}`);
    } finally {
        runInProgress = false;
    }
}

// ----------------------------------------------------------------------------
// on-demand 조회 (routes/typhoon.js 가 연도/태풍/통보문 드롭다운에 사용)
// ----------------------------------------------------------------------------
async function getTyphoonList(year) {
    await ensureSession();
    const list = await fetchTypCombo(year);
    return list.map(t => ({ seq: String(t.code), name: trimStr(t.value) }));
}
async function getBulletinList(year, seq) {
    await ensureSession();
    const combo = await fetchDetailCombo(year, seq);
    return combo.map((opt, i) => {
        const m = parseCode(String(opt.code));
        return { code: String(opt.code), label: trimStr(opt.value), kind: m.kind, tmFc: m.tmFc, seq: m.tmSeq, isLatest: i === 0 };
    });
}
async function getBulletin(year, code) {
    await ensureSession();
    const data = await fetchBulletin(year, code);
    const m = parseCode(code);
    return { code, kind: m.kind, tmFc: m.tmFc, seq: m.tmSeq, name: data.name, nameEn: data.nameEn, current: data.current, forecast: data.forecast, rem: data.rem, other: data.other };
}

// 통보문 이미지(PNG)를 인증 세션으로 받아 Buffer 반환 — routes/typhoon.js 이미지 프록시용.
function fetchImageRaw(fileName) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            method: 'GET', host: HOST,
            path: '/rsw/rest/mfp/typ/file?mode=img&fileName=' + encodeURIComponent(fileName),
            headers: { 'User-Agent': 'Mozilla/5.0 (SEAGNAL/typhoon)', 'Accept': 'image/png,*/*', 'Referer': `https://${HOST}/rsw/mfp/mfpSub?lv2Id=B002`, 'Cookie': cookieHeader() },
            timeout: HTTP_TIMEOUT_MS
        }, res => {
            ingestCookies(res.headers['set-cookie']);
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'] || '', buffer: Buffer.concat(chunks) }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.end();
    });
}
async function getTyphoonImage(fileName) {
    await ensureSession();
    let r = await fetchImageRaw(fileName);
    // 세션 만료 등으로 이미지가 아니면(302/JSON) 1회 재로그인 후 재시도
    if (r.statusCode !== 200 || r.contentType.indexOf('image') === -1) {
        try { await login(); r = await fetchImageRaw(fileName); } catch (e) { /* ignore */ }
    }
    return r;
}

module.exports = { enabled: true, run, getTyphoonList, getBulletinList, getBulletin, getTyphoonImage };
