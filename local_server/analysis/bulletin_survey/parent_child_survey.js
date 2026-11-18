'use strict';
/**
 * parent_child_survey.js — (분석용, 2026-11-18) 부모 해역(앞바다)과 자식 해역(연안바다·평수구역)의 특보가
 *   통보문에서 실제로 어떻게 적히고 어떻게 살다 끝나는지를 전 관서·전 기간으로 센다. 결과는 README ⑫.
 * 왜: 「경북북부앞바다(연안바다)」가 「그 연안바다만」인지 「부모와 연안바다 둘 다」인지에 따라 규칙이 통째로 달라진다.
 *   2026-11-17 에 「둘 다」로 고쳤는데(⑪-2), 그 검산은 비교 쪽도 같은 가정으로 맞춘 것이어서 가정 자체를 시험하지 못했다.
 * 핵심 발견: 통보문 자료의 wrnFc 값이 '02' 인 통보문은 자식 해역만 다루는 따로 된 줄기다(아래 ①).
 * 실행: node parent_child_survey.js            (요약 표)
 *       node parent_child_survey.js --list     (사례 목록까지)
 * [연계] → raw/<달>/*.json · lifecycle_check.js(parseItems·parseCurrent·expand) · services/bulletin_status.itemTimes
 *        · marine_warning_crawler.PARENT_TO_CHILDREN
 */
const fs = require('fs'), path = require('path');
const LC = require('./lifecycle_check');
const S = require('../../services/bulletin_status');
const { PARENT_TO_CHILDREN } = require('../../marine_warning_crawler');
const LIST = process.argv.includes('--list');

const KST = (s) => Date.parse(String(s).slice(0, 19).replace(' ', 'T') + '+09:00');
const fmt = (ms) => (ms ? new Date(ms + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '-');
const flat = LC.lines;
const parOf = {}; for (const [p, ks] of Object.entries(PARENT_TO_CHILDREN)) for (const k of ks) parOf[k] = p;
const HAS_KIDS = new Set(Object.keys(PARENT_TO_CHILDREN)), KIDS = new Set(Object.keys(parOf));

// ── 읽기: 관서별 입력시각 순 ──
const by = {};
const RAW = path.join(__dirname, 'raw');
for (const ym of fs.readdirSync(RAW)) for (const f of fs.readdirSync(path.join(RAW, ym))) {
    const d = JSON.parse(fs.readFileSync(path.join(RAW, ym, f), 'utf8'));
    for (const it of Object.values(d.items || {})) if (it.result && it.result.tmIn) (by[d.officeName] = by[d.officeName] || []).push({ rpt: it.rpt, r: it.result, ms: KST(it.result.tmIn), kid: it.result.wrnFc === '02' });
}
for (const l of Object.values(by)) l.sort((a, b) => a.ms - b.ms);

/**
 * 해역 목록 글 → 자식 있는 부모가 적힌 꼴들.
 * 예: '경북북부앞바다(연안바다), 동해남부앞바다(경북남부앞바다)' → [{form:'child',…}, {form:'bare',…}]
 *   bare = 부모 이름만 · excl = 「A(x 제외)」 · child = 「A(x)」 · 중 = 「A중 x」
 */
function forms(text) {
    const out = [];
    for (const tok of LC.splitTop(text)) {
        const m = tok.match(/^([^(]+)(?:\((.*)\))?$/); if (!m) continue;
        const name = LC.norm(m[1]), inner = (m[2] || '').trim();
        if (HAS_KIDS.has(name)) out.push(!inner ? 'bare' : /제외\s*$/.test(inner) ? 'excl' : 'child');
        else if (KIDS.has(name)) out.push('중');
        else if (inner) for (const s of LC.splitTop(inner)) { const n2 = LC.norm(s.replace(/\(.*$/, '')); if (HAS_KIDS.has(n2)) out.push(/\(/.test(s) ? (/제외\s*\)$/.test(s) ? 'excl' : 'child') : 'bare'); }
    }
    return out;
}
/** 예비 목록(풍랑·태풍) 줄들 */
function seaYebiLines(text) { const out = []; let k = null; for (const l of flat(text)) { const h = l.match(/^\(\d+\)\s*(\S+)\s*예비특보/); if (h) { k = h[1]; continue; } if (/풍랑|태풍/.test(k || '') && /^[oOㅇ]/.test(l)) out.push(l.replace(/^[oOㅇ]\s*/, '')); } return out; }
/** 「14일 새벽(00시~03시)」 → 그 구간의 끝(ms). 기준 = 통보문 발표시각 뒤 가장 가까운 그 날짜 */
function clrEnd(text, baseMs) {
    const m = String(text || '').match(/(\d+)일[^(]*\((\d+)시~(\d+)시\)/); if (!m) return null;
    const d0 = new Date(baseMs + 9 * 3600e3);
    for (let i = 0; i < 40; i++) { const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + i)); if (d.getUTCDate() === +m[1]) return { a: d.getTime() - 9 * 3600e3 + m[2] * 3600e3, b: d.getTime() - 9 * 3600e3 + (+m[3] <= +m[2] ? +m[3] + 24 : +m[3]) * 3600e3 }; }
    return null;
}
const show = (title, rows) => { console.log(title); if (LIST) for (const x of rows) console.log('      ' + x); };

// ══ ① 통보문 줄기(wrnFc)와 표기 꼴 ══
{
    const c = {}; const add = (k) => { c[k] = (c[k] || 0) + 1; };
    let nW = 0, nWk = 0, nY = 0, nYk = 0;
    for (const l of Object.values(by)) for (const b of l) {
        const w = b.kid ? '자식 줄기(wrnFc=02)' : '일반 줄기';
        if (b.rpt === '6') {
            b.kid ? nWk++ : nW++;
            for (const ln of flat(b.r.t2)) {
                const im = ln.match(/^\((\d+)\)\s*(.+?)\s*:\s*(.+)$/), sm = ln.match(/^[oOㅇ*]\s*(.+)$/);
                if (im && /풍랑|태풍/.test(im[2])) for (const f of forms(im[3])) add(`특보 통보문 ${w} · 변경 칸 ${f}`);
                else if (im && b.kid) add('특보 통보문 자식 줄기 · 바다 아닌 항목');
                else if (sm) for (const f of forms(sm[1])) add(`특보 통보문 ${w} · 세부 줄 ${f}`);
            }
            let k = null; for (const ln of flat(b.r.t7)) { const h = ln.match(/^\(\d+\)\s*(\S+)\s*예비특보/); if (h) { k = h[1]; continue; } const m = ln.match(/:\s*(.+)$/); if (m && /풍랑|태풍/.test(k || '')) for (const f of forms(m[1])) add(`특보 통보문 딸린 예비 현황(t7) ${f}`); }
        } else { b.kid ? nYk++ : nY++; for (const ln of seaYebiLines(b.r.t4)) for (const f of forms(ln.replace(/^.*?\)\s*:\s*/, ''))) add(`예비 통보문 ${w} · 목록 ${f}`); }
    }
    console.log(`① 통보문 ${nW + nWk + nY + nYk}건 = 특보 ${nW + nWk}(일반 ${nW} · 자식 줄기 ${nWk}) + 예비 ${nY + nYk}(일반 ${nY} · 자식 줄기 ${nYk})`);
    for (const k of Object.keys(c).sort()) console.log(`     ${k.padEnd(44)} ${c[k]}`);
    const per = {}; for (const [o, l] of Object.entries(by)) per[o] = { '특보 일반': 0, '특보 자식줄기': 0, '예비 일반': 0, '예비 자식줄기': 0 };
    for (const [o, l] of Object.entries(by)) for (const b of l) per[o][(b.rpt === '6' ? '특보 ' : '예비 ') + (b.kid ? '자식줄기' : '일반')]++;
    console.table(per);
}

// ══ 단위별 사건 목록 — 원래 해석(부모 이름만 = 부모+자식 전부 · 「A(x 제외)」 = x 빼고 · 「A(x)」 = x 만) ══
const events = {}, seqs = {};
for (const [o, l0] of Object.entries(by)) {
    const last = new Map(); for (const b of l0) if (b.rpt === '6') { const k = b.r.tmFc.slice(0, 4) + b.r.t1Title; if (!last.has(k) || last.get(k).ms < b.ms) last.set(k, b); }
    seqs[o] = [...last.values()].sort((a, b) => a.ms - b.ms); events[o] = {};
    for (const b of seqs[o]) {
        const { ef, clr } = S.itemTimes(b.r);
        for (const it of LC.parseItems(b.r.t2, [])) for (const u of it.units)
            (events[o][u] = events[o][u] || []).push({ ms: b.ms, ho: b.r.t1Title, kid: b.kid, action: it.action, level: it.level, efMs: (ef[it.n] || {}).ms || 0, clr: clr[it.n] || '', clrR: clrEnd(clr[it.n], KST(b.r.tmFc)), raw: it.raw });
    }
}
/** 그 시각(발표 시점 기준) 그 단위의 특보 사건. incl = 같은 통보문 것도 포함 */
const stateAt = (evs, ms, incl) => { let cur = null; for (const e of evs || []) { if (incl ? e.ms > ms : e.ms >= ms) break; if (e.action === '해제') cur = null; else if (/발표|변경/.test(e.action)) cur = e; } return cur; };

// ══ ② 자식 줄기 통보문의 발효 중 칸 — 자식이 특보일 때 부모는? ══
{
    const t = { '부모 같은 등급': 0, '부모 없음': 0, '부모가 높음': 0, '자식이 높음': 0 }, none = [];
    for (const [o, l] of Object.entries(by)) for (const b of l) {
        if (b.rpt !== '6' || !b.kid) continue;
        const { cur } = LC.parseCurrent(b.r.t6, []);
        for (const [u, lv] of cur) { const p = parOf[u]; if (!p) continue; const pl = cur.get(p), rk = (x) => (!x ? 0 : /경보/.test(x) ? 2 : 1);
            const k = !pl ? '부모 없음' : rk(pl) === rk(lv) ? '부모 같은 등급' : rk(pl) > rk(lv) ? '부모가 높음' : '자식이 높음'; t[k]++;
            if (k !== '부모 같은 등급') none.push(`${o} ${b.r.t1Title} ${b.r.tmIn.slice(0, 16)} ${u}=${lv} 부모=${pl || '없음'}`); }
    }
    console.log('\n② 자식 줄기 특보 통보문의 발효 중 칸에 적힌 자식 ' + Object.values(t).reduce((a, b) => a + b, 0) + '개:', JSON.stringify(t));
    for (const x of none) console.log('      ' + x);
}

// ══ ③ 관서별 발표·해제 방식 ══
{
    const T = {};
    for (const [o, us] of Object.entries(events)) {
        const t = T[o] = { '부모 발표': 0, '자식 전부 포함': 0, '제외 줄로 뺌': 0, '20분 안 자식줄기 해제로 뺌': 0, '자식줄기 발표': 0, '자식줄기 해제': 0, '그때 부모 계속': 0, '자식줄기 변경': 0 };
        for (const [u, evs] of Object.entries(us)) {
            const kids = PARENT_TO_CHILDREN[u];
            if (kids) for (const e of evs) if (e.action === '발표' && !e.kid) {
                t['부모 발표']++;
                const inc = kids.filter((k) => (us[k] || []).some((x) => x.ms === e.ms && x.action === '발표'));
                const rel = kids.filter((k) => (us[k] || []).some((x) => x.kid && x.action === '해제' && x.ms > e.ms && x.ms <= e.ms + 20 * 60e3));
                t[inc.length < kids.length ? '제외 줄로 뺌' : rel.length ? '20분 안 자식줄기 해제로 뺌' : '자식 전부 포함']++;
            }
            if (parOf[u]) for (const e of evs) if (e.kid) {
                if (e.action === '발표') t['자식줄기 발표']++;
                if (e.action === '변경') t['자식줄기 변경']++;
                if (e.action === '해제' && stateAt(evs, e.ms, false)) { t['자식줄기 해제']++; if (stateAt(us[parOf[u]], e.ms, true)) t['그때 부모 계속']++; }
            }
        }
    }
    console.log('\n③ 관서별(단위 기준 건수)'); console.table(T);
}

// ══ ④ 자식 줄기 발표·연장 때: 부모 상태 · 해제 예고 비교 · 발효 시각 ══
{
    const par = {}, clr = { 같음: 0, '자식이 이름': 0, '자식이 늦음': [], '부모 없음': 0 }; let n = 0, fut = 0;
    for (const [o, us] of Object.entries(events)) for (const [u, evs] of Object.entries(us)) {
        const p = parOf[u]; if (!p) continue;
        for (const e of evs) {
            if (!e.kid || !/발표|연장/.test(e.action)) continue;
            let cur = null; for (const x of us[p] || []) { if (x.ms > e.ms) break; if (x.action === '해제') cur = null; else if (/발표|변경/.test(x.action)) cur = Object.assign({}, x); else if (/연장/.test(x.action) && cur && x.clr) { cur.clr = x.clr; cur.clrR = x.clrR; } }
            if (e.action === '발표') { n++; if (e.efMs > e.ms + 60e3) fut++; const k = `부모 ${cur ? cur.level + (cur.efMs > e.ms ? '(발효 전)' : '(발효 중)') : '없음'}`; par[k] = (par[k] || 0) + 1; }
            if (!cur) clr['부모 없음']++;
            else if (e.clrR && cur.clrR) { if (e.clrR.a === cur.clrR.a && e.clrR.b === cur.clrR.b) clr.같음++; else if (e.clrR.b <= cur.clrR.b) clr['자식이 이름']++; else clr['자식이 늦음'].push(`${o} ${e.ho} ${fmt(e.ms)} ${u} 「${e.clr}」 / 부모 ${cur.ho} 「${cur.clr}」`); }
        }
    }
    console.log(`\n④ 자식 줄기의 자식 발표 ${n}건(단위): 발효 시각이 미래 ${fut} · 그때 부모`, JSON.stringify(par));
    console.log(`   해제 예고(발표·연장): 부모와 같음 ${clr.같음} · 자식이 더 이름 ${clr['자식이 이름']} · 자식이 더 늦음 ${clr['자식이 늦음'].length} · 부모 특보 없음 ${clr['부모 없음']}`);
    for (const x of clr['자식이 늦음']) console.log('      ' + x);
}

// ══ ⑤ 시간 순서가 얽힌 경우 ══
{
    const F = [], I = {}, Ilist = []; let relFuture = 0, relAll = 0;
    for (const [o, us] of Object.entries(events)) for (const [u, evs] of Object.entries(us)) evs.forEach((e, i) => {
        if (e.action === '해제') { relAll++; if (e.efMs > e.ms + 60e3) { relFuture++; for (const x of evs.slice(i + 1)) { if (x.ms >= e.efMs) break; if (/발표|변경/.test(x.action)) F.push(`${o} ${u}: ${e.ho} 해제(${fmt(e.efMs)}) → ${x.ho} ${x.action}`); } } }
        if (/발표|변경/.test(e.action) && e.efMs > e.ms + 60e3) for (const x of evs.slice(i + 1)) {
            if (x.ms >= e.efMs) break; if (x.action !== '해제') continue;
            const before = evs.slice(0, i).filter((y) => /발표|변경|해제/.test(y.action)).pop();
            const k = `①${e.action}(${e.kid ? '자식줄기' : '일반'}) → ②해제(${x.kid ? '자식줄기' : '일반'}) · ${parOf[u] ? '자식' : '부모'} 단위 · ①직전 ${before && before.action !== '해제' ? '특보 중' : '특보 없음'} · ${(x.ms - e.ms) / 60e3 <= 20 ? '20분 이내' : '20분 초과'}`;
            I[k] = (I[k] || 0) + 1; Ilist.push(`${o} ${u}: ${e.ho} ${fmt(e.ms)} 발표(발효 ${fmt(e.efMs)}) → ${x.ho} ${fmt(x.ms)} 해제(${fmt(x.efMs)})`);
        }
    });
    console.log(`\n⑤-가 해제 항목 ${relAll}건(단위) 중 해제 시각이 입력보다 뒤 ${relFuture}건 — 그 해제 시각 전에 같은 단위 새 발표·변경: ${F.length}건`); for (const x of F) console.log('      ' + x);
    show(`⑤-나 발효 전 발표·변경 뒤, 발효 시각 전에 같은 단위 해제: ${Ilist.length}건(단위) ${JSON.stringify(I)}`, Ilist);
}

// ══ ⑥ 자식 줄기 예비 통보문 ══
{
    const rows = [];
    for (const [o, l] of Object.entries(by)) for (const b of l) if (b.rpt === '7' && b.kid)
        rows.push(`${o} ${b.r.t1Title} ${b.r.tmIn.slice(0, 16)} 목록: ${seaYebiLines(b.r.t4).join(' ／ ') || '없음'} ‖ 참고: ${flat(b.r.other).filter((x) => !/^o\s*없음/.test(x)).join(' ').slice(0, 120) || '없음'}`);
    show(`\n⑥ 자식 줄기 예비 통보문 ${rows.length}건(목록이 「없음」인 것 ${rows.filter((x) => /목록: 없음/.test(x)).length}건)`, rows);
}
