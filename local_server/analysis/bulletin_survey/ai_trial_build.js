'use strict';
/**
 * ai_trial_build.js — 참고사항 AI 시험용 표본 200건을 고르고, 같은 통보문에 대한 「규칙 결과」를 미리 계산해 둔다(분석용, 2026-11-15).
 * 사용자 확정 2026-11-15: 「대표 표본 200건으로 확인해보자」. 시험은 운영 서버 ChatGPT(codex_bridge)로 돈다 — services/bulletin_ai_trial.js.
 * 고르는 법: 관서 8곳 × 참고사항 종류(취소·연장·연기·추가 발표·앞으로 가능성·유의 당부·분류 안 됨)에 고르게, 오늘 찾은 특이 사례는 전부.
 *   종류 분류는 낱말 어림이다(표본을 고르게 펴는 용도일 뿐, 판정에 쓰지 않는다).
 * 규칙 결과: 예비특보 통보문이면 같은 관서 직전 예비 통보문 목록과 비교한 「빠짐·새로·시간 바뀜」(부모 해역×시간창),
 *   특보 통보문이면 변경 칸(t2)을 규칙으로 펼친 「발표·변경·해제」.
 * 실행: node ai_trial_build.js   → ai_trial_sample.json
 * [연계] ← 사람이 실행 / → raw/ · lifecycle_check.js · services/bulletin_ai_trial.js(읽음)
 */
const fs = require('fs'), path = require('path');
const { lines, splitTop, expand, parseItems, PARENTS } = require('./lifecycle_check');
const RAW = path.join(__dirname, 'raw');
const K = (s) => Date.parse(String(s).slice(0, 19).replace(' ', 'T') + '+09:00');
const fmt = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');
const clean = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/\r/g, '').trim();
const isNone = (s) => /^o\s*없\s*음$/.test(clean(s).replace(/\s+/g, ' '));

function parseYebi(text, tmFc) {
    const out = []; let kind = null; const y0 = +String(tmFc).slice(0, 4), m0 = +String(tmFc).slice(5, 7);
    for (const l of lines(text)) {
        const h = l.match(/^\(\d+\)\s*(\S+)\s*예비특보/); if (h) { kind = h[1]; continue; }
        const m = l.match(/^[oOㅇ]\s*(\d+)월\s*(\d+)일\s*[^(]*\((\d+)시~(\d+)시\)\s*:\s*(.+)$/);
        if (!m || !(kind === '풍랑' || kind === '태풍')) continue;
        const mo = +m[1], a = +m[3], b = +m[4]; const yr = mo < m0 - 6 ? y0 + 1 : (mo > m0 + 6 ? y0 - 1 : y0);
        const day = Date.UTC(yr, mo - 1, +m[2]) - 9 * 3600e3;
        for (const tok of splitTop(m[5])) { const u = expand(tok, []); if (u) for (const x of u) if (PARENTS.has(x)) out.push({ unit: x, start: day + a * 3600e3, end: day + (b <= a ? b + 24 : b) * 3600e3 }); }
    }
    return out;
}
const win = (e) => `${fmt(e.start)}~${fmt(e.end).slice(6)}`;
const TAGS = [
    ['취소', /가능성이?\s*(낮|적|없)|해제\s*합니다|해제하니|해제하나/],
    ['연장·연기', /연장|연기/],
    ['추가 발표', /추가\s*발표/],
    ['앞으로 가능성', /경보\s*변경\s*가능|변경될\s*가능성|발표될\s*가능성/],
    ['유의 당부', /유의|주의하기|안전사고/],
];
const tagOf = (t) => (TAGS.find(([, re]) => re.test(t)) || ['분류 안 됨'])[0];

// 같은 호는 마지막 판만(호 번호는 해마다 다시 시작 — 연도를 붙인다)
const all = [];
for (const ym of fs.readdirSync(RAW)) for (const f of fs.readdirSync(path.join(RAW, ym))) {
    const d = JSON.parse(fs.readFileSync(path.join(RAW, ym, f), 'utf8'));
    for (const it of Object.values(d.items)) if (it.result) all.push({ office: d.officeName, stn: d.office, rpt: it.rpt, code: it.code, r: it.result });
}
const lastMap = new Map();
for (const x of all) { const k = x.office + '|' + x.rpt + '|' + String(x.r.tmFc).slice(0, 4) + '|' + x.r.t1Title; if (!lastMap.has(k) || lastMap.get(k).r.tmIn < x.r.tmIn) lastMap.set(k, x); }
const bulletins = [...lastMap.values()].sort((a, b) => a.r.tmIn.localeCompare(b.r.tmIn));
const isWave = (x) => /풍랑|태풍|바다|해상/.test((x.r.t1 || '') + (x.r.t2 || '') + (x.r.t4 || '') + (x.r.other || ''));

// 규칙 결과
const prevYebi = {};
for (const x of bulletins) {
    if (x.rpt === '7') {
        const now = parseYebi(x.r.t4, x.r.tmFc), before = prevYebi[x.office] || [];
        const key = (e) => e.unit + '|' + e.start + '|' + e.end;
        const ks = new Set(now.map(key)), bs = new Set(before.map(key)), t = K(x.r.tmIn);
        const removed = before.filter((e) => !ks.has(key(e)) && e.end > t);
        const added = now.filter((e) => !bs.has(key(e)));
        x.rule = {
            kind: '예비 목록 비교(직전 예비 통보문과)',
            빠짐: removed.filter((e) => !now.some((n) => n.unit === e.unit)).map((e) => ({ 해역: e.unit, 시간창: win(e) })),
            시간바뀜: removed.filter((e) => now.some((n) => n.unit === e.unit)).map((e) => ({ 해역: e.unit, 전: win(e), 후: now.filter((n) => n.unit === e.unit).map(win) })),
            새로: added.filter((e) => !before.some((b) => b.unit === e.unit)).map((e) => ({ 해역: e.unit, 시간창: win(e) })),
            // 직전 목록에 있었지만 이 통보문 전에 시간이 끝난 줄(12시간 안) — 끝난 뒤 나온 취소·연장 문장과 맞춰 보려고
            시간지나끝남: before.filter((e) => e.end <= t && e.end > t - 12 * 3600e3 && !ks.has(key(e))).map((e) => ({ 해역: e.unit, 시간창: win(e), 다시나옴: now.filter((n) => n.unit === e.unit).map(win) })),
            지금목록: now.map((e) => ({ 해역: e.unit, 시간창: win(e) })),
        };
        prevYebi[x.office] = now;
    } else {
        const items = parseItems(x.r.t2, []);
        x.rule = { kind: '특보 변경 칸(t2) 규칙 해석', 항목: items.map((it) => ({ 종류: it.type + it.level, 동작: it.action, 해역: [...it.units].filter((u) => PARENTS.has(u)) })) };
    }
}

// 고르기
const pool = bulletins.filter((x) => isWave(x) && !isNone(x.r.other) && clean(x.r.other));
const SPECIAL = [
    (x) => /풍랑특보는\s*발표\s*가능성/.test(x.r.other),          // 예비특보를 「풍랑특보」로 잘못 씀(강원)
    (x) => /남쪽해상/.test(x.r.other),                             // 「동해남부남쪽해상」(부산 2025-10-13)
    (x) => /강원중\.\s*북부앞바다/.test(x.r.other),                 // 「강원중.북부앞바다」
    (x) => /연기하여/.test(x.r.other),                             // 연기(대구 2025-11-02)
    (x) => x.office === '강원청' && x.r.t1Title === '제 3-19호' && String(x.r.tmFc).startsWith('2025'),   // 끝난 뒤 연장
    (x) => /풍랑\s*경보\s*변경\s*가능\s*시점/.test(x.r.other),       // 경보 변경 가능 시점 안내
    (x) => /발표될\s*가능성/.test(x.r.other),                       // 앞으로 특보 가능성
];
const picked = new Map();
for (const f of SPECIAL) for (const x of pool.filter(f).slice(0, 3)) picked.set(x.code, Object.assign(x, { special: true }));
// 이유 문장 없이 목록에서만 빠진 예비 취소 2건(참고사항 「o 없음」) — AI 가 빈 글에서 아무것도 지어내지 않는지 본다
for (const [o, ho, y] of [['수도권청', '제 6-2호', '2026'], ['부산청', '제 1-21호', '2026']]) {
    const x = bulletins.find((b) => b.office === o && b.rpt === '7' && b.r.t1Title === ho && String(b.r.tmFc).startsWith(y));
    if (x) picked.set(x.code, Object.assign(x, { special: true, noText: true }));
}
// 나머지는 관서×종류 칸을 돌며 하나씩(칸 안에서는 고르게 띄워서)
const cells = {};
for (const x of pool) { const k = x.office + '|' + tagOf(x.r.other); (cells[k] = cells[k] || []).push(x); }
const keys = Object.keys(cells).sort(); let round = 0;
while (picked.size < 200 && round < 200) {
    for (const k of keys) {
        if (picked.size >= 200) break;
        const c = cells[k]; if (!c.length) continue;
        const i = Math.floor((round * 7919) % c.length);     // 칸 안에서 고르게 흩어 뽑기(결정적)
        const x = c[i]; if (!picked.has(x.code)) picked.set(x.code, x);
    }
    round++;
}
const out = [...picked.values()].sort((a, b) => a.r.tmIn.localeCompare(b.r.tmIn)).map((x, i) => ({
    id: i + 1, office: x.office, stn: x.stn, rpt: x.rpt, 종류: x.rpt === '7' ? '예비특보' : '특보', 호: x.r.t1Title,
    발표: String(x.r.tmFc).slice(0, 16), 입력: String(x.r.tmIn).slice(0, 16), 제목: x.r.t1 || '',
    본문: clean(x.rpt === '7' ? x.r.t4 : x.r.t2).slice(0, 1500), 참고사항: clean(x.r.other).slice(0, 2500),
    분류어림: x.noText ? '문장 없음(목록에서만 빠짐)' : tagOf(x.r.other), 특이: !!x.special, rule: x.rule,
}));
fs.writeFileSync(path.join(__dirname, 'ai_trial_sample.json'), JSON.stringify(out, null, 1));
const c = {}; for (const x of out) { c[x.office] = (c[x.office] || 0) + 1; c['#' + x.분류어림] = (c['#' + x.분류어림] || 0) + 1; }
console.log('표본', out.length, '· 특이', out.filter((x) => x.특이).length, '· 후보 풀', pool.length, c);
