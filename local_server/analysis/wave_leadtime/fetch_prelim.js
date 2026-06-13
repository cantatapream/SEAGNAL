'use strict';
/**
 * fetch_prelim.js — 방재기상플랫폼(dmdw) "예비특보 통보문" 전수 수집 (2023~).
 *
 *  출처: /rsw/mfp/wrn/rswWeaWnotRetrieve  (예·특보 → 특보 → 통보문)
 *   - 목록: POST /rsw/rest/mfp/wrn/retRswWrnRptList.json {startDate,endDate,stnId,rpt}
 *           rpt=7(예비특보), stnId=108(기상청 본청=전국). code 예: "7|108|26|202306302230|..."
 *   - 본문: POST /rsw/rest/mfp/wrn/retRswWrnRptDetail.json {stnId, rpt:<목록 code>}
 *
 *  목적: 과거 풍랑/태풍 "예비특보" 발표시각·구역 census 구축 → 예측 재검증용.
 *  자격증명: KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD (env, 파일에 평문 금지).
 *  서버 부담 방지: 요청 간 SLEEP_MS 지연 + 오류 백오프 + 세션 만료 재로그인. 재개 가능.
 *
 *  실행:
 *    # 테스트(본문 형식 확인): 한 달 + 상세 N건 raw 덤프
 *    KMA_DMDW_USER_ID=.. KMA_DMDW_USER_PWD=.. node fetch_prelim.js --month=202306 --maxdetail=3 --dump
 *    # 전수: 2023-06 ~ 2026-06
 *    KMA_DMDW_USER_ID=.. KMA_DMDW_USER_PWD=.. node fetch_prelim.js --from=202306 --to=202606
 * ============================================================================
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const HOST = 'dmdw.kma.go.kr', BASE = 'https://' + HOST;
const OUT = path.join(__dirname, 'data', 'prelim_warnings.json');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const SLEEP_MS = args.sleep ? +args.sleep : 2500;     // 요청 간 기본 지연(천천히)
const STN = '108';                                     // 기상청 본청(전국 통보문)
const RPT_PRELIM = '7';                                // 예비특보

const S = { cookies: {}, csrf: '' };
const enc64 = s => Buffer.from(encodeURIComponent(s), 'utf8').toString('base64');
const ch = () => Object.entries(S.cookies).map(([k, v]) => k + '=' + v).join('; ');
const ing = sc => { if (!sc) return; (Array.isArray(sc) ? sc : [sc]).forEach(c => { const kv = c.split(';')[0].trim(); const i = kv.indexOf('='); if (i > 0) S.cookies[kv.slice(0, i)] = kv.slice(i + 1); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function req(m, p, b, x) {
    return new Promise((res, rej) => {
        const h = Object.assign({ 'User-Agent': 'Mozilla/5.0 (SEAGNAL/prelim)', 'Cookie': ch() }, x || {});
        if (b) { h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; h['Content-Length'] = Buffer.byteLength(b); }
        const r = https.request({ method: m, host: HOST, path: p, headers: h, timeout: 30000 }, o => { ing(o.headers['set-cookie']); const c = []; o.on('data', d => c.push(d)); o.on('end', () => res({ s: o.statusCode, t: Buffer.concat(c).toString('utf8') })); });
        r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout'))); if (b) r.write(b); r.end();
    });
}
const csrf = t => { const m = t.match(/name=["']_csrf["']\s+content=["']([^"']+)["']/); return m ? m[1] : ''; };
const H = () => ({ 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': S.csrf, 'Origin': BASE, 'Referer': BASE + '/rsw/mfp/wrn/rswWeaWnotRetrieve', 'Accept': 'application/json' });
async function login() {
    const id = process.env.KMA_DMDW_USER_ID, pw = process.env.KMA_DMDW_USER_PWD;
    if (!id || !pw) throw new Error('KMA_DMDW_USER_ID/PWD 미설정');
    const w = await req('GET', '/rsw/mfp/mfpMain'); S.csrf = csrf(w.t);
    const lb = new URLSearchParams({ userId: enc64(id), userPwd: enc64(pw) }).toString();
    const lr = await req('POST', '/rsw/rest/frm/login_user', lb, { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': S.csrf, 'Origin': BASE, 'Referer': BASE + '/rsw/mfp/mfpMain', 'Accept': 'application/json' });
    if ((JSON.parse(lr.t).body.result.statecode) !== '10') throw new Error('로그인 거부');
    const f = await req('GET', '/rsw/mfp/wrn/rswWeaWnotRetrieve', null, { 'X-Requested-With': 'XMLHttpRequest' });
    const c2 = csrf(f.t); if (c2) S.csrf = c2;
}
async function postJson(pathName, form, tries = 4) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            const b = new URLSearchParams(form).toString();
            const r = await req('POST', pathName, b, H());
            if (r.s === 200) { try { return JSON.parse(r.t); } catch (_) { return { _raw: r.t }; } }
            if (r.s === 401 || r.s === 302) { await sleep(1000); await login(); continue; }
            lastErr = 'HTTP ' + r.s;
        } catch (e) { lastErr = e.message; }
        await sleep(1500 * (i + 1)); // 백오프
    }
    throw new Error(pathName + ' 실패: ' + lastErr);
}
const lastDay = ym => new Date(+ym.slice(0, 4), +ym.slice(4, 6), 0).getDate();
function rows(j) { if (!j) return []; if (Array.isArray(j)) return j; for (const k of ['result', 'list', 'body', 'data']) if (Array.isArray(j[k])) return j[k]; return []; }

async function listMonth(ym) {
    const sd = ym + '01', ed = ym + String(lastDay(ym)).padStart(2, '0');
    const j = await postJson('/rsw/rest/mfp/wrn/retRswWrnRptList.json', { startDate: sd, endDate: ed, stnId: STN, rpt: RPT_PRELIM });
    return rows(j); // [{code, value}]
}
async function detail(code) {
    const j = await postJson('/rsw/rest/mfp/wrn/retRswWrnRptDetail.json', { stnId: STN, rpt: code });
    return j;
}

// ── 본문 파싱(풍랑/태풍 예비특보 + 구역 + 시각) ──────────────────────────────
//   detail.body.result 의 t1~t7 에 "(N) <종류> 예비특보 / o <시간대> : <구역들>" 형식.
//   tmFc=발표시각, t5=유효(해제예정)시각.
function parseDetail(j) {
    const r = (j && j.body && j.body.result) || {};
    const lines = ['t1', 't2', 't3', 't4', 't6', 't7'].map(k => r[k]).filter(v => v && String(v).trim());
    const body = lines.join('\n').replace(/<br\s*\/?>/gi, ' ').replace(/\r/g, ' ').replace(/&#40;/g, '(').replace(/&#41;/g, ')').trim();
    return { tmFc: r.tmFc || '', tmFcNew: r.tmFcNew || '', valid: r.t5 || '', body, isV: /풍랑/.test(body), isT: /태풍/.test(body) };
}

(async () => {
    await login();
    console.error('[prelim] login ok');

    if (args.month) { // 테스트
        const list = await listMonth(args.month);
        console.error(`[prelim] ${args.month} 예비특보 통보문 ${list.length}건`);
        const N = args.maxdetail ? +args.maxdetail : 2;
        for (let i = 0; i < Math.min(N, list.length); i++) {
            await sleep(SLEEP_MS);
            const d = await detail(list[i].code);
            console.log(`\n=== [${i}] ${list[i].value} ===`);
            console.log('code:', list[i].code);
            if (args.dump) console.log('detail keys/raw:', JSON.stringify(d).slice(0, 1200));
        }
        return;
    }

    // 전수 수집 (재개 가능)
    const from = args.from || '202306', to = args.to || '202606';
    let store = {};
    try { store = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { store = {}; }
    const months = [];
    for (let y = +from.slice(0, 4), m = +from.slice(4, 6); ; ) { const ym = '' + y + String(m).padStart(2, '0'); months.push(ym); if (ym === to) break; m++; if (m > 12) { m = 1; y++; } if (y > 2030) break; }
    for (const ym of months) {
        await sleep(SLEEP_MS);
        let list;
        try { list = await listMonth(ym); } catch (e) { console.error(`[prelim] ${ym} 목록 실패: ${e.message}`); continue; }
        console.error(`[prelim] ${ym}: ${list.length}건`);
        for (const it of list) {
            if (store[it.code]) continue; // 재개: 이미 수집
            await sleep(SLEEP_MS);
            try {
                const d = await detail(it.code);
                const p = parseDetail(d);
                store[it.code] = { title: it.value, tmFc: p.tmFc, valid: p.valid, isV: p.isV, isT: p.isT, body: p.body };
                if (Object.keys(store).length % 20 === 0) fs.writeFileSync(OUT, JSON.stringify(store));
            } catch (e) { console.error(`  detail 실패 ${it.code}: ${e.message}`); }
        }
        fs.writeFileSync(OUT, JSON.stringify(store));
    }
    fs.writeFileSync(OUT, JSON.stringify(store));
    console.error(`[prelim] 완료. 총 ${Object.keys(store).length}건 → ${OUT}`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
