/**
 * preCompare2.js — 우리 검출 vs 기상청 '풍랑/태풍 예비특보' 첫 발표 (전국, 해역매칭)
 *
 * data/pre_windtyphoon.json (풍랑/태풍 예비특보: tmFcMs, areas[]) 와
 * 실제 풍랑 발효 이벤트를 '해역 겹침 + 168h 내'로 매칭해 KMA 예비특보 첫발표 선행을 구하고,
 * 우리 검출 리드(Lmax,≤96h(예보지평한계))와 비교.
 */
'use strict';
const fs = require('fs'), path = require('path');
const { parseWarnings } = require('./warnings');
const { resolveZone } = require('./zones');

const DIR = __dirname, OUT = path.join(DIR, 'out');
const pre = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'pre_windtyphoon.json'), 'utf8'))
    .map((r) => ({ tmFcMs: r.tmFcMs, hasTyphoon: r.hasTyphoon, zones: new Set(r.areas.map((a) => { const z = resolveZone(a); return z ? z.name : null; }).filter(Boolean)) }))
    .sort((a, b) => a.tmFcMs - b.tmFcMs);
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };
const med = (a) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;

// 우리 검출 Lmax (effectiveAt → 최대 리드)
const ourLmax = new Map();
for (const code of Object.keys(OFFICES)) {
    const f = fs.readdirSync(OUT).filter((x) => new RegExp(`^leadtime_${code}_wind_.*\\.json$`).test(x)); if (!f.length) continue;
    const { results } = JSON.parse(fs.readFileSync(path.join(OUT, f.sort().pop()), 'utf8'));
    const leads = Object.keys(results[0].leads).map(Number).sort((a, b) => b - a);
    for (const r of results) { let L = null; for (const l of leads) { const x = r.leads[l]; if (x && x.ok && x.zoneHit3) { L = l; break; } } const cur = ourLmax.get(r.effectiveAt); if (L != null && (cur == null || L > cur)) ourLmax.set(r.effectiveAt, L); }
}

// 실제 풍랑 발효 이벤트 (effectiveAt → 해역 zone set)
const evs = parseWarnings(path.join(DIR, 'data', 'warnings_2023-2026.csv'), { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter((e) => e.effectiveAt && e.level === '주의보');
const evMap = new Map();
for (const e of evs) { const k = e.effectiveAt.toISOString(); if (!evMap.has(k)) evMap.set(k, new Set()); e.seaAreas.forEach((a) => { const z = resolveZone(a); if (z) evMap.get(k).add(z.name); }); }

// 매칭: 발효 전 168h 내, 해역 겹치는 가장 이른 풍랑/태풍 예비특보
function firstPreLead(tEfMs, zoneSet) {
    let best = null;
    for (const r of pre) {
        if (r.tmFcMs >= tEfMs) break;
        if (tEfMs - r.tmFcMs > 168 * 3600000) continue;
        let overlap = false; for (const z of zoneSet) if (r.zones.has(z)) { overlap = true; break; }
        if (overlap) { best = r.tmFcMs; break; } // pre 는 시간오름차순 → 첫 겹침이 가장 이름
    }
    return best == null ? null : (tEfMs - best) / 3600000;
}

let hasPre = 0, both = 0, weEarlier = 0; const preLeads = [], diffs = [];
const evTimes = [...evMap.keys()].sort();
for (const k of evTimes) {
    const tEf = new Date(k).getTime(); const zoneSet = evMap.get(k); if (!zoneSet.size) continue;
    const pl = firstPreLead(tEf, zoneSet); const our = ourLmax.get(k);
    if (pl != null) { hasPre++; preLeads.push(pl); }
    if (pl != null && our != null) { both++; if (our >= pl) weEarlier++; diffs.push(our - pl); }
}

let md = `# 우리 검출 vs 기상청 '풍랑/태풍 예비특보' 첫 발표 (전국, 해역매칭)\n\n`;
md += `> 예비특보 통보문 상세에서 '풍랑/태풍' 섹션 해역만 추출해 실제 발효 해역과 매칭. 우리 리드 ≤72h(보수적).\n\n`;
md += `## 데이터\n- 풍랑/태풍 예비특보(전국): ${pre.length}건\n- 풍랑 발효 이벤트(유니크): ${evTimes.length}건\n\n`;
md += `## 결과\n`;
md += `- 발효 중 직전 168h 내 '풍랑/태풍 예비특보(해역일치)' 존재: **${hasPre}건 (${(hasPre / evTimes.length * 100).toFixed(0)}%)**\n`;
md += `- 기상청 풍랑/태풍 예비특보 **첫 발표 선행 중앙값: ${med(preLeads) != null ? med(preLeads).toFixed(0) : '-'}시간**\n\n`;
md += `### 우리 검출(Lmax,≤96h(예보지평한계)) vs 풍랑/태풍 예비특보 첫발표 (둘 다 있는 ${both}건)\n`;
md += `- 우리가 더 이르거나 동시: **${both ? (weEarlier / both * 100).toFixed(0) : '-'}%** (${weEarlier}/${both})\n`;
md += `- (우리 Lmax − 예비특보 첫발표) 중앙값: **${med(diffs) != null ? med(diffs).toFixed(0) : '-'}시간**\n`;
md += `\n> 우리 리드 ~96h 상한(예보지평) → 예비특보 72h+ 전이면 불리 집계(보수적). 즉 실제 우위는 이 값 이상.\n`;
fs.writeFileSync(path.join(DIR, 'reports', 'PRE_windtyphoon_compare.md'), md);
console.log(md);
