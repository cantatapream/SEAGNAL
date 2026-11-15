'use strict';
/**
 * notes_classify.js — 통보문 참고사항(other)·예비특보 본문에서 풍랑·태풍 문장을 뽑아 유형별로 나눈다(분석용, 2026-11-12).
 * 확정 표현만 상태 변화로 본다: 해제합니다·연장합니다·변경합니다·연장 발표합니다 / 「~하나·~되나」 뒤 안내는 상태 변화 아님.
 * 실행: node notes_classify.js 2025-01 … [--show=8]
 * [연계] ← 사람이 실행 / → raw/<달>/*.json
 */
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), months = args.filter((a) => /^\d{4}-\d{2}$/.test(a));
const SHOW = +((args.find((a) => a.startsWith('--show=')) || '--show=6').split('=')[1]);
const RULES = [
    ['예비특보 취소', /예비\s*특보.*(가능성이\s*낮아|해제\s*합니다|해제합니다|해제\s*하며|취소)/],
    ['예비특보 시간대 연장·변경', /예비\s*특보.*(연장\s*발표|연장합니다|변경\s*발표|조정)/],
    ['해제예고 연장·변경', /해제\s*예고.*(연장|변경)/],
    ['등급 변경(격상·격하)', /(주의보를|경보를)\s*\S*(경보|주의보)로/],
    ['정확한 해제 시각', /\d+시(\s*\d+분)?\s*을?\s*기해\s*해제/],
    ['일부 구역만 해제·발표', /(중|의)\s*\S+(평수구역|연안바다).*(해제|발표)/],
    ['안내(상태 변화 아님)', /(해제하나|해제되나|해제되겠으나|해제되었으나|발표된 가운데|가능성이 있|유의|참고하기|예상되니)/],
];
const C = {}, EX = {};
let total = 0;
for (const ym of months) for (const f of fs.readdirSync(path.join(__dirname, 'raw', ym))) {
    const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw', ym, f), 'utf8'));
    for (const it of Object.values(d.items)) {
        const r = it.result || {};
        const text = String(r.other || '').replace(/<br\s*\/?>/gi, '\n').replace(/\r/g, '');
        for (let s of text.split('\n')) {
            s = s.trim(); if (!/풍랑|태풍/.test(s)) continue;
            total++;
            const hit = RULES.find(([, re]) => re.test(s));
            const k = hit ? hit[0] : '분류 못 함';
            C[k] = (C[k] || 0) + 1;
            (EX[k] = EX[k] || []).length < SHOW && EX[k].push(`${d.officeName} ${it.rpt === '7' ? '예비' : '특보'} ${r.t1Title}: ${s.slice(0, 160)}`);
        }
    }
}
console.log('풍랑·태풍이 들어간 참고사항 문장', total);
for (const [k] of [...RULES, ['분류 못 함']]) if (C[k]) { console.log(`\n== ${k} ${C[k]}건`); for (const e of EX[k]) console.log('   ' + e); }
