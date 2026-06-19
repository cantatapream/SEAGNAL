'use strict';
/**
 * fetch_bulletin.js — 방재기상플랫폼(dmdw) "[날씨해설] 단기(3일 전망)" 통보문 전수 수집.
 *
 *  목적: 과거 통보문의 해상(풍랑/물결/너울) 전망을 시계열로 모아, 예비특보·발효
 *        시점 며칠 전 통보문이 어떻게 기록됐는지 매칭 분석(확률 보정 근거).
 *  출처: dmdw /rsw/rest/mfp/wrn/  (fetch_prelim.js 와 동일 인증/엔드포인트)
 *   - 목록: retRswWrnRptList.json {startDate,endDate,stnId,rpt:'10'}  (rpt=10 = 날씨해설)
 *   - 본문: retRswWrnRptDetail.json {stnId, rpt:<목록 code>}
 *  대상 관서(해상특보 발표 8청): 제주184·부산159·광주156·대구143·강원105·수도권109·대전133·전북146
 *  자격증명: KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD (env, 평문 금지).
 *  서버 부담 방지: 요청 간 SLEEP_MS(기본 2500) + 백오프 + 세션 재로그인. 재개 가능.
 *
 *  실행:
 *    # 테스트(목록/본문 형식): node fetch_bulletin.js --test
 *    # 전수: node fetch_bulletin.js --from=202006 --to=202606
 *    # 목록만(빠름): node fetch_bulletin.js --from=.. --to=.. --listonly
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const HOST = 'dmdw.kma.go.kr', BASE = 'https://' + HOST;
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
// 청별 병렬 수집 시 같은 파일 동시 쓰기 방지 — --stn 지정 시 관서별 출력으로 분리.
const OUT = path.join(__dirname, 'data', args.stn ? `bulletins_${args.stn}.json` : 'bulletins.json');
const SLEEP_MS = args.sleep ? +args.sleep : 2500;
const RPT_BULLETIN = '10';
const OFFICES = { '184': '제주', '159': '부산', '156': '광주', '143': '대구', '105': '강원', '109': '수도권', '133': '대전', '146': '전북' };

const S = { cookies: {}, csrf: '' };
const enc64 = s => Buffer.from(encodeURIComponent(s), 'utf8').toString('base64');
const ch = () => Object.entries(S.cookies).map(([k, v]) => k + '=' + v).join('; ');
const ing = sc => { if (!sc) return; (Array.isArray(sc) ? sc : [sc]).forEach(c => { const kv = c.split(';')[0].trim(); const i = kv.indexOf('='); if (i > 0) S.cookies[kv.slice(0, i)] = kv.slice(i + 1); }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function req(m, p, b, x) {
    return new Promise((res, rej) => {
        const h = Object.assign({ 'User-Agent': 'Mozilla/5.0 (SEAGNAL/bulletin)', 'Cookie': ch() }, x || {});
        if (b) { h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; h['Content-Length'] = Buffer.byteLength(b); }
        const r = https.request({ method: m, host: HOST, path: p, headers: h, timeout: 30000 }, o => { ing(o.headers['set-cookie']); const c = []; o.on('data', d => c.push(d)); o.on('end', () => res({ s: o.statusCode, t: Buffer.concat(c).toString('utf8') })); });
        r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout'))); if (b) r.write(b); r.end();
    });
}
const csrf = t => { const m = t.match(/name=["']_csrf["']\s+content=["']([^"']+)["']/); return m ? m[1] : ''; };
const H = () => ({ 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': S.csrf, 'Origin': BASE, 'Referer': BASE + '/rsw/mfp/mfpSub?lv2Id=B002', 'Accept': 'application/json' });
async function login() {
    const id = process.env.KMA_DMDW_USER_ID, pw = process.env.KMA_DMDW_USER_PWD;
    if (!id || !pw) throw new Error('KMA_DMDW_USER_ID/PWD 미설정');
    const w = await req('GET', '/rsw/mfp/mfpMain'); S.csrf = csrf(w.t);
    const lb = new URLSearchParams({ userId: enc64(id), userPwd: enc64(pw) }).toString();
    const lr = await req('POST', '/rsw/rest/frm/login_user', lb, { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': S.csrf, 'Origin': BASE, 'Referer': BASE + '/rsw/mfp/mfpMain', 'Accept': 'application/json' });
    if (JSON.parse(lr.t).body.result.statecode !== '10') throw new Error('로그인 거부');
    const f = await req('GET', '/rsw/mfp/wrn/rswWeaWnotRetrieve', null, { 'X-Requested-With': 'XMLHttpRequest' }); const c2 = csrf(f.t); if (c2) S.csrf = c2;
}
async function postJson(pathName, form, tries = 4) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            const r = await req('POST', pathName, new URLSearchParams(form).toString(), H());
            if (r.s === 200) { try { return JSON.parse(r.t); } catch (_) { return { _raw: r.t }; } }
            if (r.s === 401 || r.s === 302) { await sleep(1000); await login(); continue; }
            lastErr = 'HTTP ' + r.s;
        } catch (e) { lastErr = e.message; }
        await sleep(1500 * (i + 1));
    }
    throw new Error(pathName + ' 실패: ' + lastErr);
}
const lastDay = ym => new Date(+ym.slice(0, 4), +ym.slice(4, 6), 0).getDate();
const rows = j => { if (!j) return []; if (Array.isArray(j)) return j; for (const k of ['result', 'list', 'body', 'data']) if (Array.isArray(j[k])) return j[k]; return []; };
const clean = s => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&#40;/g, '(').replace(/&#41;/g, ')').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ');

async function listMonth(stn, ym) {
    const sd = ym + '01', ed = ym + String(lastDay(ym)).padStart(2, '0');
    const j = await postJson('/rsw/rest/mfp/wrn/retRswWrnRptList.json', { startDate: sd, endDate: ed, stnId: stn, rpt: RPT_BULLETIN });
    // "[날씨 해설] ... (단기...)" 만(초단기/중기 등 혼입 방지). 단순 "단기" 매칭(초단기 제외).
    return rows(j).filter(x => /날씨\s*해설/.test(x.value || '') && /\(단기/.test(x.value || ''));
}
async function detail(code, stn) {
    return postJson('/rsw/rest/mfp/wrn/retRswWrnRptDetail.json', { stnId: stn, rpt: code });
}
// 본문에서 해상(풍랑/물결/너울/바람) 관련 줄만 추출.
function marineLines(j) {
    const r = (j && j.body && j.body.result) || j || {};
    const full = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'].map(k => r[k] ? clean(r[k]) : '').join('\n');
    const lines = full.split('\n').map(s => s.trim()).filter(Boolean)
        .filter(l => /(해상|먼바다|앞바다|물결|풍랑|너울|바람.*m\/s|m\/s|km\/h|파고)/.test(l));
    // 중복 제거
    return [...new Set(lines)].slice(0, 12);
}

(async () => {
    await login();
    console.error('[bulletin] login ok');

    if (args.test) {
        for (const ym of ['202606', '202006']) {
            await sleep(SLEEP_MS);
            try {
                const list = await listMonth('184', ym);
                console.error(`[test] 제주 ${ym}: 단기해설 ${list.length}건  (rpt=10 과거 가용성 확인)`);
                if (ym === '202606' && list.length) {
                    await sleep(SLEEP_MS);
                    const d = await detail(list[0].code, '184');
                    const ml = marineLines(d);
                    console.log(`\n=== ${list[0].value.slice(0, 55)} ===`);
                    const rr = (d.body && d.body.result) || {};
                    console.log('tmFc:', rr.tmFc, '| validTm:', clean(rr.validTm).trim());
                    console.log('해상 줄:'); ml.forEach(l => console.log('  • ' + l.slice(0, 160)));
                }
            } catch (e) { console.error(`[test] ${ym} 실패: ${e.message}`); }
        }
        return;
    }

    // 전수 수집(재개 가능) — 관서 × 월
    const from = args.from || '202006', to = args.to || '202606';
    const stns = args.stn ? [args.stn] : Object.keys(OFFICES);
    let store = {}; try { store = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { store = {}; }
    const months = [];
    for (let y = +from.slice(0, 4), m = +from.slice(4, 6); ;) { const ym = '' + y + String(m).padStart(2, '0'); months.push(ym); if (ym === to) break; m++; if (m > 12) { m = 1; y++; } if (y > 2030) break; }
    let n = 0;
    for (const stn of stns) {
        for (const ym of months) {
            await sleep(SLEEP_MS);
            let list; try { list = await listMonth(stn, ym); } catch (e) { console.error(`[${OFFICES[stn]} ${ym}] 목록 실패: ${e.message}`); continue; }
            console.error(`[${OFFICES[stn]} ${ym}] 단기해설 ${list.length}건`);
            for (const it of list) {
                const key = stn + '|' + it.code;
                if (store[key]) continue;
                if (args.listonly) { store[key] = { stn, office: OFFICES[stn], title: it.value }; continue; }
                await sleep(SLEEP_MS);
                try {
                    const d = await detail(it.code, stn);
                    const r = (d.body && d.body.result) || {};
                    store[key] = { stn, office: OFFICES[stn], title: it.value, tmFc: r.tmFc || '', validTm: clean(r.validTm).trim(), marine: marineLines(d) };
                    if (++n % 20 === 0) { fs.writeFileSync(OUT, JSON.stringify(store)); console.error(`  ...${n}건 저장`); }
                } catch (e) { console.error(`  detail 실패 ${it.code}: ${e.message}`); }
            }
            fs.writeFileSync(OUT, JSON.stringify(store));
        }
    }
    fs.writeFileSync(OUT, JSON.stringify(store));
    console.error(`[bulletin] 완료. 총 ${Object.keys(store).length}건 → ${OUT}`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
