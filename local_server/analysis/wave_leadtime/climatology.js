'use strict';
/**
 * climatology.js — 풍랑/태풍 발효 기후값(2020-06 ~ 2026-06, 6년) census.
 *
 *  입력: data/warnings_2020-2023.csv + data/warnings_2023-2026.csv (발효 통보문)
 *  목적: 차트/예비 없이도 가능한 "전체 검토" — 발효 빈도의 연·월·구역 분포, 계절성,
 *        구역별 base-rate. 우리 예측이 어디·언제 가장 가치있는지 가중치를 제공.
 *        (차트는 2023-05+ 만 존재 → 2020-2023 은 예측로직 재채점 불가, 기후값 검토만.)
 *
 *  실행: node analysis/wave_leadtime/climatology.js
 *  산출: reports/CLIMATOLOGY.md
 */
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { normName } = require('./zonePolygon');

const DIR = path.join(__dirname, 'data');
const FILES = ['warnings_2020-2023.csv', 'warnings_2023-2026.csv'];
const OUT_MD = path.join(__dirname, 'reports', 'CLIMATOLOGY.md');
const H = 3600 * 1000;

function loadAll() {
    const all = [];
    for (const f of FILES) {
        const p = path.join(DIR, f); if (!fs.existsSync(p)) continue;
        for (const e of parseWarnings(p, { kinds: new Set(['풍랑', '태풍']), actions: new Set(['발표', '변경']) })) {
            if (e.effectiveAt) all.push(e);
        }
    }
    return all;
}

/** (zone,kind) 24h dedup → 에피소드 [{zone,kind,t}] */
function episodes(evs) {
    const rows = [];
    for (const e of evs) for (const a of e.seaAreas) {
        const z = normName(a); if (!z) continue;
        rows.push({ zone: z, kind: e.kind || '풍랑', t: e.effectiveAt.getTime() });
    }
    rows.sort((a, b) => a.t - b.t);
    const last = new Map(); const eps = [];
    for (const r of rows) {
        const k = r.kind + '|' + r.zone; const lt = last.get(k);
        if (lt != null && r.t - lt <= 24 * H) { last.set(k, r.t); continue; }
        last.set(k, r.t); eps.push(r);
    }
    return eps;
}

(function main() {
    const evs = loadAll();
    const eps = episodes(evs);
    const v = eps.filter(e => e.kind === '풍랑'), t = eps.filter(e => e.kind === '태풍');
    const yrs = ['2020', '2021', '2022', '2023', '2024', '2025', '2026'];
    const mos = Array.from({ length: 12 }, (_, i) => i + 1);

    const pcS = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '-';
    const byYear = y => eps.filter(e => new Date(e.t).getFullYear() === +y);
    const byMonth = (arr, m) => arr.filter(e => new Date(e.t).getMonth() + 1 === m).length;

    let md = '# 풍랑·태풍 발효 기후값 (2020-06 ~ 2026-06, 6년)\n\n';
    md += `발효 에피소드(24h dedup): 풍랑 **${v.length}** · 태풍 **${t.length}** (구역×이벤트)\n\n`;

    md += '## 연도별\n\n| 연도 | 풍랑 | 태풍 |\n|---|---|---|\n';
    for (const y of yrs) { const g = byYear(y); md += `| ${y} | ${g.filter(e => e.kind === '풍랑').length} | ${g.filter(e => e.kind === '태풍').length} |\n`; }

    md += '\n## 월별 계절성 (전 연도 합산, 풍랑)\n\n| 월 | 풍랑 발효 | |\n|---|---|---|\n';
    const vmax = Math.max(...mos.map(m => byMonth(v, m)));
    for (const m of mos) { const c = byMonth(v, m); const bar = '█'.repeat(Math.round(c / vmax * 24)); md += `| ${m}월 | ${c} | ${bar} |\n`; }

    md += '\n## 구역별 풍랑 발효 빈도 (상위 15)\n\n| 구역 | 풍랑 에피소드 |\n|---|---|\n';
    const byZone = new Map();
    for (const e of v) byZone.set(e.zone, (byZone.get(e.zone) || 0) + 1);
    const top = [...byZone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    for (const [z, c] of top) md += `| ${z} | ${c} |\n`;

    md += `\n> 구역 종류 수: ${byZone.size} · 차트 가용은 2023-05+ 이므로 2020-2023 은 기후값 검토 전용(예측로직 재채점 불가).\n`;

    // ── KMA 자체 운영 리드(발표→발효), 풍랑 ─────────────────────────────────────
    const leads = evs.filter(e => e.kind === '풍랑' && e.announceAt && e.effectiveAt)
        .map(e => (e.effectiveAt.getTime() - e.announceAt.getTime()) / H).filter(x => x >= 0 && x <= 120);
    const sortN = a => a.slice().sort((x, y) => x - y);
    const q = (a, p) => { if (!a.length) return null; const s = sortN(a); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    const f1 = v => v == null ? '-' : v.toFixed(1);
    md += '\n## KMA 자체 운영 리드: 발표 → 발효 (풍랑, 전 기간)\n\n';
    md += `- 표본 ${leads.length}건 · 중앙 **${f1(q(leads, .5))}h** · p25 ${f1(q(leads, .25))} · p75 ${f1(q(leads, .75))} · p90 ${f1(q(leads, .9))}\n`;
    const le3 = leads.filter(x => x <= 3).length, le6 = leads.filter(x => x <= 6).length;
    md += `- ${pcS(le3, leads.length)} 는 발효 3h 이내 발표 · ${pcS(le6, leads.length)} 는 6h 이내 발표\n`;
    md += `  → KMA 공식 발표는 대개 임박(수 시간 전). 우리 예측이 노리는 24~72h 선행과는 시간대가 다름(상호보완).\n`;

    fs.writeFileSync(OUT_MD, md);
    console.log(md);
})();
