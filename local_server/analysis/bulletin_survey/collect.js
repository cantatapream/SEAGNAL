'use strict';
/**
 * collect.js — 방재기상플랫폼(dmdw) 「특보」·「예비특보」 통보문 전수 수집(원본 보관용).
 *
 * 목적(사용자 확정 2026-11-12): 특보현황을 통보문 기반으로 바꾸기 전에, 2025-01-01 ~ 현재 통보문으로
 *   해역(부모+자식)별 특보의 생애주기(발표·발효·변경·연장·해제, 예비 발효·취소)를 로직으로 따라갈 수 있는지 검토한다.
 *   「1개월 수집 → 구성 확인 → 정리 → 다음 달」 순서로 천천히 진행한다.
 * 대상: 관서 8곳(수도권109·부산159·대구143·광주156·전주146·대전133·강원105·제주184),
 *   특보(rpt=6, 특보종류 풍랑·태풍) · 예비특보(rpt=7, 종류 구분 없음 — 풍랑·태풍 여부는 분석 때 본문으로 거른다).
 * 출처: POST /rsw/rest/mfp/wrn/retRswWrnRptList.json {startDate,endDate,stnId,rpt,wrnKindNm}
 *       POST /rsw/rest/mfp/wrn/retRswWrnRptDetail.json {stnId, rpt:<목록 code>}
 *       (통보문 화면 /rsw/mfp/wrn/rswWeaWnotRetrieve 의 rswWeaWnotRetrieve.js 와 같은 요청 — 2026-11-12 확인)
 * 보관: raw/<YYYY-MM>/<관서>.json — 목록 한 줄과 본문을 고치지 않고 그대로(가져온 시각 포함). 다시 돌리면 없는 것만 가져온다.
 *   ⚠같은 호가 여러 판(code 끝 입력시각이 다름)으로 나오면 모두 가져온다. 지난 기록이 나중에 고쳐질 수 있어(예: 예비특보
 *   종료시각 칸) 가져온 시각을 함께 남긴다.
 * 자격증명: KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD (환경변수만 — 파일·저장소에 남기지 않는다).
 * 서버 부담: 요청 사이 SLEEP_MS(기본 2500ms), 실패 시 늦춰 다시, 세션이 끊기면 다시 로그인.
 *
 * 실행:  node collect.js --month=2025-01            (한 달)
 *        node collect.js --from=2025-01 --to=2025-03 (여러 달, 차례로)
 *        --stn=184 (관서 하나만) · --sleep=3000
 * [연계] ← 사람이 실행(분석용) / → analysis/bulletin_survey/raw · parse.js(분석)
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = 'dmdw.kma.go.kr', BASE = 'https://' + HOST;
const OFFICES = { '109': '수도권청', '159': '부산청', '143': '대구청', '156': '광주청', '146': '전주지청', '133': '대전청', '105': '강원청', '184': '제주청' };
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const SLEEP_MS = args.sleep ? +args.sleep : 2500;
const RAW = path.join(__dirname, 'raw');

const S = { cookies: {}, csrf: '' };
const enc64 = (s) => Buffer.from(encodeURIComponent(s), 'utf8').toString('base64');
const cookieHeader = () => Object.entries(S.cookies).map(([k, v]) => k + '=' + v).join('; ');
const ingest = (sc) => { if (!sc) return; (Array.isArray(sc) ? sc : [sc]).forEach((c) => { const kv = c.split(';')[0].trim(); const i = kv.indexOf('='); if (i > 0) S.cookies[kv.slice(0, i)] = kv.slice(i + 1); }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csrfOf = (t) => { const m = t.match(/name=["']_csrf["']\s+content=["']([^"']+)["']/); return m ? m[1] : ''; };

/** HTTPS 요청 한 번. 쿠키는 S.cookies 로 이어 간다. */
function req(method, p, body, extra) {
    return new Promise((resolve, reject) => {
        const h = Object.assign({ 'User-Agent': 'Mozilla/5.0 (SEAGNAL/bulletin-survey)', Cookie: cookieHeader() }, extra || {});
        if (body) { h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; h['Content-Length'] = Buffer.byteLength(body); }
        const r = https.request({ method, host: HOST, path: p, headers: h, timeout: 30000 }, (o) => {
            ingest(o.headers['set-cookie']);
            const c = []; o.on('data', (d) => c.push(d)); o.on('end', () => resolve({ s: o.statusCode, t: Buffer.concat(c).toString('utf8') }));
        });
        r.on('error', reject); r.on('timeout', () => r.destroy(new Error('timeout')));
        if (body) r.write(body); r.end();
    });
}

/** 로그인 — 일시적으로 거부되면(응답이 JSON 이 아님 등) 늦춰 가며 5번까지 다시 한다(2026-11-12 한 번 statecode=null 로 멈춤). */
async function login() {
    let last;
    for (let i = 0; i < 5; i++) {
        try { return await loginOnce(); }
        catch (e) { last = e; console.warn('[collect] 로그인 실패, 다시 시도:', e.message); await sleep(30000 * (i + 1)); }
    }
    throw last;
}

async function loginOnce() {
    const id = process.env.KMA_DMDW_USER_ID, pw = process.env.KMA_DMDW_USER_PWD;
    if (!id || !pw) throw new Error('KMA_DMDW_USER_ID/PWD 환경변수 없음');
    S.cookies = {};
    const w = await req('GET', '/rsw/mfp/mfpMain'); S.csrf = csrfOf(w.t);
    const lr = await req('POST', '/rsw/rest/frm/login_user', new URLSearchParams({ userId: enc64(id), userPwd: enc64(pw) }).toString(),
        { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': S.csrf, Origin: BASE, Referer: BASE + '/rsw/mfp/mfpMain', Accept: 'application/json' });
    const state = (() => { try { return JSON.parse(lr.t).body.result.statecode; } catch (_) { return null; } })();
    if (state !== '10') throw new Error('로그인 거부(statecode=' + state + ')');
    const f = await req('GET', '/rsw/mfp/wrn/rswWeaWnotRetrieve', null, { 'X-Requested-With': 'XMLHttpRequest' });
    const c2 = csrfOf(f.t); if (c2) S.csrf = c2;
    console.log('[collect] 로그인 성공');
}

/** JSON POST — 세션이 끊기면 다시 로그인, 실패하면 늦춰 가며 4번까지. */
async function post(p, form) {
    let last;
    for (let i = 0; i < 4; i++) {
        try {
            const r = await req('POST', p, new URLSearchParams(form).toString(),
                { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': S.csrf, Origin: BASE, Referer: BASE + '/rsw/mfp/mfpSub?lv2Id=B001', Accept: 'application/json' });
            if (r.s === 401 || r.s === 302 || r.s === 403) { await sleep(2000); await login(); continue; }
            if (r.s !== 200) throw new Error('HTTP ' + r.s);
            const j = JSON.parse(r.t);
            if (j.statusCode && j.statusCode !== 200) throw new Error('statusCode ' + j.statusCode + ' ' + j.message);
            return j.body;
        } catch (e) { last = e; await sleep(SLEEP_MS * (i + 2)); }
    }
    throw last;
}

const monthsBetween = (from, to) => {
    const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
};
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/** 한 관서·한 달: 목록(특보 풍랑·태풍, 예비특보 전체) → 본문(없는 것만) → raw/<달>/<관서>.json */
async function collectOfficeMonth(ym, stn) {
    const dir = path.join(RAW, ym); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, stn + '.json');
    const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { office: stn, officeName: OFFICES[stn], month: ym, lists: {}, items: {} };
    const sd = ym.replace('-', '') + '01';
    let ed = ym.replace('-', '') + String(lastDay(ym)).padStart(2, '0');
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
    if (ed > today) ed = today;
    const queries = [['6', '풍랑'], ['6', '태풍'], ['7', '']];
    for (const [rpt, kind] of queries) {
        const key = rpt + (kind ? ':' + kind : '');
        await sleep(SLEEP_MS);
        const list = await post('/rsw/rest/mfp/wrn/retRswWrnRptList.json', Object.assign({ startDate: sd, endDate: ed, stnId: stn, rpt }, rpt === '6' ? { wrnKindNm: kind } : {}));
        doc.lists[key] = { fetchedAt: new Date().toISOString(), entries: Array.isArray(list) ? list : [] };
        fs.writeFileSync(file, JSON.stringify(doc));
    }
    const all = new Map();
    for (const [key, l] of Object.entries(doc.lists)) for (const e of l.entries) if (!all.has(e.code)) all.set(e.code, { listValue: e.value, query: key });
    let got = 0;
    for (const [code, meta] of all) {
        if (doc.items[code]) continue;
        await sleep(SLEEP_MS);
        const body = await post('/rsw/rest/mfp/wrn/retRswWrnRptDetail.json', { stnId: stn, rpt: code });
        doc.items[code] = { code, listValue: meta.listValue, query: meta.query, fetchedAt: new Date().toISOString(), rpt: body && body.rpt, result: body && body.result };
        got++;
        if (got % 10 === 0) fs.writeFileSync(file, JSON.stringify(doc));
    }
    fs.writeFileSync(file, JSON.stringify(doc));
    console.log(`[collect] ${ym} ${OFFICES[stn]}: 목록 ${all.size}건 · 새로 받은 본문 ${got}건 · 보관 ${Object.keys(doc.items).length}건`);
}

(async () => {
    const months = args.month ? [args.month] : monthsBetween(args.from || '2025-01', args.to || args.from || '2025-01');
    const stns = args.stn ? String(args.stn).split(',') : Object.keys(OFFICES);
    await login();
    for (const ym of months) for (const stn of stns) await collectOfficeMonth(ym, stn);
    console.log('[collect] 끝');
})().catch((e) => { console.error('[collect] 실패:', e.message); process.exit(1); });
