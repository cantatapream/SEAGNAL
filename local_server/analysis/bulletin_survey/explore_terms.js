'use strict';
/**
 * explore_terms.js — 수집한 통보문 원본에서 해역 표현을 모두 뽑아 우리 해역표·묶음 사전과 맞대어 본다(분석용).
 * 실행: node explore_terms.js 2025-01 [2025-02 …]
 * [연계] ← 사람이 실행 / → raw/<달>/*.json · config/zone_group_map · services/kakao_relay.zoneTable(표준 93해역)
 */
const fs = require('fs'), path = require('path');
const { ZONE_GROUP_MAP } = require('../../config/zone_group_map');
const kr = require('../../services/kakao_relay');
const zt = kr.zoneTable();
const months = process.argv.slice(2);
const strip = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/\r/g, '');
const T = {}, P = {}, F = { t2: 0, t4: 0, t6: 0, t7: 0 };
const addT = (name, where, ex) => { const k = name; (T[k] = T[k] || { n: 0, where: new Set(), ex }).n++; T[k].where.add(where); };
function classify(name) {
    const n = name.replace(/\s+/g, '').replace(/[.]/g, '·');
    if (ZONE_GROUP_MAP[n]) return '묶음';
    if (zt.names.has(n)) return zt.childToParent[n] ? '자식' : '부모';
    return '모름';
}
function scan(text, where, label) {
    for (const raw of strip(text).split('\n')) {
        let line = raw.trim();
        if (!line || /^o\s*없\s*음$/.test(line)) continue;
        line = line.replace(/^\(\d+\)\s*/, '').replace(/^o\s*/, '');
        // 「종류 동작 : 목록」 또는 「날짜(시간대) : 목록」
        const m = line.match(/:\s*(.+)$/);
        const list = m ? m[1] : line;
        // 괄호 안(예외·세부) 따로
        for (const pm of list.matchAll(/\(([^)]*)\)/g)) (P[pm[1]] = P[pm[1]] || { n: 0, ex: label }).n++;
        for (const tok of list.replace(/\([^)]*\)/g, '').split(/[,，]/)) {
            const t = tok.trim().replace(/\s+/g, '');
            if (!t || /^\d|시$|분$|일$/.test(t)) continue;
            addT(t, where, label);
        }
    }
}
let n = 0;
for (const ym of months) for (const f of fs.readdirSync(path.join(__dirname, 'raw', ym))) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw', ym, f), 'utf8'));
    for (const it of Object.values(d.items)) {
        const r = it.result || {}; n++;
        const label = `${d.officeName} ${r.t1Title}`;
        if (it.rpt === '6') { scan(r.t2, 't2', label); scan(r.t6, 't6', label); scan(r.t7, 't7', label); }
        else { scan(r.t4, 't4', label); }
    }
}
console.log('통보문', n, '건');
const rows = Object.entries(T).map(([k, v]) => ({ k, n: v.n, c: classify(k), where: [...v.where].join('/'), ex: v.ex }));
for (const c of ['묶음', '부모', '자식', '모름']) {
    const rs = rows.filter((r) => r.c === c).sort((a, b) => b.n - a.n);
    console.log(`\n== ${c} ${rs.length}종`);
    for (const r of rs) console.log(`  ${r.k} ×${r.n} [${r.where}]${c === '모름' ? ' 예: ' + r.ex : ''}`);
}
console.log('\n== 괄호 안 표현');
for (const [k, v] of Object.entries(P).sort((a, b) => b[1].n - a[1].n)) console.log(`  (${k}) ×${v.n}  예: ${v.ex}`);
