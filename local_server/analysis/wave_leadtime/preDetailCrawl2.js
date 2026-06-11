/**
 * preDetailCrawl2.js — 예비특보 상세에서 (발표시각, 예상발효시점, 해역) 추출 (풍랑/태풍)
 *
 * 본문 라인: "o 02월 02일 오전(06시~12시) : 동해남부…, 제주도…"
 *   → 예상발효시점 = 해당 연-월-일 + 괄호 시작시각(없으면 시간대어 매핑)
 *   → 그 라인의 해역들 각각에 (tmFc, onset, area, kind) 레코드
 * 결과: data/pre_wt_onset.json
 */
'use strict';
const https = require('https'), fs = require('fs'), path = require('path');
const { URLSearchParams } = require('url');
const HOST = 'dmdw.kma.go.kr', BASE = 'https://' + HOST; const cookies = {}; let csrf = '';
const enc64 = (s) => Buffer.from(encodeURIComponent(s), 'utf8').toString('base64');
const ch = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
const ing = (sc) => { if (!sc) return; (Array.isArray(sc) ? sc : [sc]).forEach((c) => { const kv = c.split(';')[0].trim(); const i = kv.indexOf('='); if (i > 0) cookies[kv.slice(0, i)] = kv.slice(i + 1); }); };
function req(m, p, b, e) { return new Promise((res, rej) => { const h = Object.assign({ 'User-Agent': 'Mozilla/5.0', 'Cookie': ch() }, e || {}); if (b) { h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; h['Content-Length'] = Buffer.byteLength(b); } const r = https.request({ method: m, host: HOST, path: p, headers: h, timeout: 25000 }, (x) => { ing(x.headers['set-cookie']); const c = []; x.on('data', (d) => c.push(d)); x.on('end', () => res({ s: x.statusCode, t: Buffer.concat(c).toString('utf8') })); }); r.on('error', rej); r.on('timeout', () => r.destroy(new Error('t'))); if (b) r.write(b); r.end(); }); }
const gc = (h) => { const m = h.match(/name=["']_csrf["'][^>]*content=["']([^"']+)["']/); return m ? m[1] : ''; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORD_H = { '새벽': 3, '아침': 7, '오전': 9, '한낮': 12, '낮': 13, '오후': 15, '늦은오후': 16, '저녁': 19, '밤': 22, '늦은밤': 23 };

// tmFc(Date) 기준, "MM월 DD일 <시간대>(HH시~..)" → 예상 발효 Date
function parseOnset(tmFc, dateStr, timeStr) {
    const md = dateStr.match(/(\d{1,2})월\s*(\d{1,2})일/); if (!md) return null;
    const mo = +md[1], d = +md[2];
    let hh = 9; const hm = timeStr && timeStr.match(/\((\d{1,2})시/); if (hm) hh = +hm[1];
    else { for (const w in WORD_H) if (timeStr && timeStr.includes(w)) { hh = WORD_H[w]; break; } }
    let yr = tmFc.getFullYear(); if (mo < tmFc.getMonth() + 1 - 1) yr++; // 연말→연초 보정
    return new Date(yr, mo - 1, d, hh, 0, 0);
}
function parseDetail(html, tmFc) {
    if (!html) return [];
    const lines = String(html).replace(/<br\s*\/?>/g, '\n').split('\n');
    const out = []; let cur = null;
    for (const raw of lines) {
        const line = raw.trim(); if (!line) continue;
        const sec = line.match(/\(\d+\)\s*(풍랑|태풍|강풍|대설|호우|한파|건조|폭풍해일|황사)\s*예비특보/);
        if (sec) { cur = (sec[1] === '풍랑' || sec[1] === '태풍') ? sec[1] : null; continue; }
        if (cur && /^o\s/.test(line)) {
            const ci = line.indexOf(':'); if (ci < 0) continue;
            const left = line.slice(0, ci), right = line.slice(ci + 1);
            const onset = parseOnset(tmFc, left, left); if (!onset) continue;
            const areas = right.split(/[,，]/).map((s) => s.replace(/\(.*?\)/g, '').trim()).filter(Boolean);
            for (const a of areas) out.push({ onsetMs: onset.getTime(), area: a, kind: cur });
        }
    }
    return out;
}

(async () => {
    let m = await req('GET', '/rsw/mfp/mfpMain'); csrf = gc(m.t);
    await req('POST', '/rsw/rest/frm/login_user', new URLSearchParams({ userId: enc64(process.env.PID), userPwd: enc64(process.env.PPW) }).toString(), { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': csrf, 'Origin': BASE, 'Referer': BASE + '/rsw/mfp/mfpMain', 'Accept': 'application/json' });
    const p = await req('GET', '/rsw/mfp/mfpSub?lv2Id=B002'); csrf = gc(p.t) || csrf;
    const post = (pp, body) => req('POST', pp, new URLSearchParams(body).toString(), { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': csrf, 'Origin': BASE, 'Referer': BASE + '/rsw/mfp/wrn/rswWeaWnotRetrieve', 'Accept': 'application/json, text/javascript, */*' });
    const recs = [];
    for (let y = 2023; y <= 2026; y++) for (let mo = 1; mo <= 12; mo++) {
        if (y === 2023 && mo < 7) continue; if (y === 2026 && mo > 6) continue;
        const sd = `${y}${String(mo).padStart(2, '0')}01`, em = mo === 12 ? `${y + 1}0101` : `${y}${String(mo + 1).padStart(2, '0')}01`;
        let lr; try { lr = await post('/rsw/rest/mfp/wrn/retRswWrnRptList.json', { rpt: '7', stnId: '108', startDate: sd, endDate: em }); } catch (e) { continue; }
        let items; try { items = JSON.parse(lr.t).body || []; } catch (e) { continue; }
        for (const it of items) {
            const f = String(it.code).split('|'); const ts = f[3];
            const tmFc = new Date(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12) || 0);
            let dr; try { dr = await post('/rsw/rest/mfp/wrn/retRswWrnRptDetail.json', { rpt: it.code, stnId: '108' }); } catch (e) { continue; }
            let dj; try { dj = JSON.parse(dr.t); } catch (e) { continue; }
            const b = dj.body && dj.body.result; if (!b) continue;
            for (const e of parseDetail((b.t4 || '') + '<br>' + (b.other || ''), tmFc)) recs.push({ tmFcMs: tmFc.getTime(), ...e });
            await sleep(85);
        }
        process.stderr.write(`${sd} `);
    }
    fs.writeFileSync(path.join(__dirname, 'data', 'pre_wt_onset.json'), JSON.stringify(recs));
    console.log(`\n예비특보 풍랑/태풍 (해역×예상시점) 레코드 ${recs.length}건 → data/pre_wt_onset.json`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
