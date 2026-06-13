/**
 * preDetailCrawl.js — 전국 예비특보 통보문 상세를 크롤해 '풍랑/태풍' 예비특보만 추출
 *
 * 각 예비특보 통보문(rpt=7) 상세 본문(t4/other)에서 '(N) 풍랑 예비특보' / '태풍 예비특보'
 * 섹션의 해역 목록을 파싱. 결과: data/pre_windtyphoon.json = [{tmFcMs, kind, areas[]}]
 * (tmFc = 예비특보 발표시각)
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

// 본문에서 풍랑/태풍 섹션의 해역 추출
function parseWindTyphoon(html) {
    if (!html) return [];
    const txt = String(html).replace(/<br\s*\/?>/g, '\n');
    const lines = txt.split('\n');
    const out = []; let cur = null; // '풍랑' | '태풍' | null
    for (let raw of lines) {
        const line = raw.trim(); if (!line) continue;
        const sec = line.match(/\((\d+)\)\s*(풍랑|태풍|강풍|대설|호우|한파|건조|폭풍해일|황사)\s*예비특보/);
        if (sec) { cur = (sec[2] === '풍랑' || sec[2] === '태풍') ? sec[2] : null; continue; }
        if (cur && /^o\s/.test(line)) {
            const ci = line.indexOf(':'); if (ci < 0) continue;
            const areas = line.slice(ci + 1).split(/[,，]/).map((s) => s.replace(/\(.*?\)/g, '').trim()).filter(Boolean);
            for (const a of areas) out.push({ kind: cur, area: a });
        }
    }
    return out;
}

(async () => {
    let m = await req('GET', '/rsw/mfp/mfpMain'); csrf = gc(m.t);
    await req('POST', '/rsw/rest/frm/login_user', new URLSearchParams({ userId: enc64(process.env.PID), userPwd: enc64(process.env.PPW) }).toString(), { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': csrf, 'Origin': BASE, 'Referer': BASE + '/rsw/mfp/mfpMain', 'Accept': 'application/json' });
    const p = await req('GET', '/rsw/mfp/mfpSub?lv2Id=B002'); csrf = gc(p.t) || csrf;
    const post = (path, body) => req('POST', path, new URLSearchParams(body).toString(), { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': csrf, 'Origin': BASE, 'Referer': BASE + '/rsw/mfp/wrn/rswWeaWnotRetrieve', 'Accept': 'application/json, text/javascript, */*' });

    const records = []; let nDetail = 0, nWindTy = 0;
    for (let y = 2023; y <= 2026; y++) for (let mo = 1; mo <= 12; mo++) {
        if (y === 2023 && mo < 7) continue; if (y === 2026 && mo > 6) continue;
        const sd = `${y}${String(mo).padStart(2, '0')}01`, em = mo === 12 ? `${y + 1}0101` : `${y}${String(mo + 1).padStart(2, '0')}01`;
        let lr; try { lr = await post('/rsw/rest/mfp/wrn/retRswWrnRptList.json', { rpt: '7', stnId: '108', startDate: sd, endDate: em }); } catch (e) { continue; }
        let items; try { items = JSON.parse(lr.t).body || []; } catch (e) { continue; }
        for (const it of items) {
            const code = it.code; const f = String(code).split('|'); const tmStr = f[3]; // YYYYMMDDHHmm 발표시각
            let dr; try { dr = await post('/rsw/rest/mfp/wrn/retRswWrnRptDetail.json', { rpt: code, stnId: '108' }); } catch (e) { continue; }
            nDetail++;
            let dj; try { dj = JSON.parse(dr.t); } catch (e) { continue; }
            const body = dj.body && dj.body.result; if (!body) continue;
            const wt = parseWindTyphoon((body.t4 || '') + '<br>' + (body.other || ''));
            if (wt.length) {
                nWindTy++;
                const tmFcMs = new Date(+tmStr.slice(0, 4), +tmStr.slice(4, 6) - 1, +tmStr.slice(6, 8), +tmStr.slice(8, 10), +tmStr.slice(10, 12) || 0).getTime();
                records.push({ tmFcMs, areas: [...new Set(wt.map((x) => x.area))], hasTyphoon: wt.some((x) => x.kind === '태풍') });
            }
            await sleep(90);
        }
        process.stderr.write(`${sd}:${items.length} `);
    }
    fs.writeFileSync(path.join(__dirname, 'data', 'pre_windtyphoon.json'), JSON.stringify(records));
    console.log(`\n상세 ${nDetail}건 중 풍랑/태풍 포함 ${nWindTy}건 → data/pre_windtyphoon.json`);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
