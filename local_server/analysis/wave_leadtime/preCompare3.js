/**
 * preCompare3.js — 예상시점 매칭으로 정확화한 '우리 검출 vs 풍랑/태풍 예비특보' 비교
 *
 * 핵심 수정: 예비특보를 '그 사건'에 맞추기 위해, 예비특보의 *예상 발효시점*이 실제
 *   발효시각과 ±ONSET_TOL 내이고 해역이 겹칠 때만 매칭. 그 중 가장 이른 발표시각 =
 *   KMA가 '이 사건'에 대해 처음 낸 예비특보. (이전 무관 사건 매칭 방지)
 *
 * 사용: node preCompare3.js [--tol=24]
 */
'use strict';
const fs = require('fs'), path = require('path');
const { parseWarnings } = require('./warnings');
const { resolveZone } = require('./zones');
const DIR = __dirname, OUT = path.join(DIR, 'out');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const TOL = (args.tol ? +args.tol : 24) * 3600000;
const med = (a) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };

// 예비특보 레코드 (해역→canonical zone name)
const recs = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'pre_wt_onset.json'), 'utf8'))
    .map((r) => { const z = resolveZone(r.area); return { tmFcMs: r.tmFcMs, onsetMs: r.onsetMs, zone: z ? z.name : r.area }; });

// 우리 Lmax (확장 wind JSON, effectiveAt→maxLead with zoneHit3)
const ourLmax = new Map();
for (const code of Object.keys(OFFICES)) {
    const f = fs.readdirSync(OUT).filter((x) => new RegExp(`^leadtime_${code}_wind_.*\\.json$`).test(x)); if (!f.length) continue;
    const { results } = JSON.parse(fs.readFileSync(path.join(OUT, f.sort().pop()), 'utf8'));
    const leads = Object.keys(results[0].leads).map(Number).sort((a, b) => b - a);
    for (const r of results) { let L = null; for (const l of leads) { const x = r.leads[l]; if (x && x.ok && x.zoneHit3) { L = l; break; } } const cur = ourLmax.get(r.effectiveAt); if (L != null && (cur == null || L > cur)) ourLmax.set(r.effectiveAt, L); }
}

// 실제 풍랑 발효 이벤트 (효시각 + 해역 zone set)
const evs = parseWarnings(path.join(DIR, 'data', 'warnings_2023-2026.csv'), { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter((e) => e.effectiveAt && e.level === '주의보');
const evMap = new Map();
for (const e of evs) { const k = e.effectiveAt.toISOString(); if (!evMap.has(k)) evMap.set(k, new Set()); e.seaAreas.forEach((a) => { const z = resolveZone(a); if (z) evMap.get(k).add(z.name); }); }

let hasPre = 0, both = 0, weEarlier = 0; const preLeads = [], diffs = [];
for (const [iso, zoneSet] of evMap) {
    const tEf = new Date(iso).getTime();
    // 이 사건에 매칭되는 예비특보: 예상시점 ±TOL & 해역 겹침 → 가장 이른 발표
    let firstPre = null;
    for (const r of recs) {
        if (Math.abs(r.onsetMs - tEf) > TOL) continue;
        if (!zoneSet.has(r.zone)) continue;
        if (r.tmFcMs < tEf && (firstPre == null || r.tmFcMs < firstPre)) firstPre = r.tmFcMs;
    }
    const our = ourLmax.get(iso);
    if (firstPre != null) { hasPre++; const lead = (tEf - firstPre) / 3600000; preLeads.push(lead);
        if (our != null) { both++; if (our >= lead) weEarlier++; diffs.push(our - lead); } }
}

let md = `# 우리 검출 vs 풍랑/태풍 예비특보 — 예상시점 매칭(정확화) [tol ±${TOL/3600000}h]\n\n`;
md += `> 수정: 예비특보의 '예상 발효시점'이 실제 발효 ±${TOL/3600000}h 이고 해역 겹칠 때만 매칭 → 그 사건의 첫 예비특보.\n\n`;
md += `## 결과\n\n`;
md += `- 풍랑 발효 이벤트 ${evMap.size}건 중, 매칭되는 예비특보 존재: **${hasPre}건 (${(hasPre/evMap.size*100).toFixed(0)}%)**\n`;
md += `- 기상청 예비특보 첫 발표 선행(이 사건 기준) 중앙값: **${med(preLeads)!=null?med(preLeads).toFixed(0):'-'}시간**\n\n`;
md += `### 우리 검출(≤96h) vs 예비특보 첫발표 (둘 다 있는 ${both}건)\n\n`;
md += `- 우리가 더 이르거나 동시: **${both?(weEarlier/both*100).toFixed(0):'-'}%** (${weEarlier}/${both})\n`;
md += `- (우리 Lmax − 예비특보 선행) 중앙값: **${med(diffs)!=null?med(diffs).toFixed(0):'-'}시간** (양수=우리가 더 일찍)\n`;
md += `\n> 우리 리드 ~96h 상한. 예비특보 선행이 이보다 큰 사건은 보수적으로 우리가 불리.\n`;
fs.writeFileSync(path.join(DIR, 'reports', 'PRE_onsetmatched_compare.md'), md);
console.log(md);
