/**
 * preCompare.js — 우리 검출 vs 기상청 '예비특보' 발표, 누가 먼저 (전국)
 *
 * 데이터:
 *   - data/pre_advisory_fc.json : 전국 예비특보 통보문 발표시각(YYYYMMDDHHmm) — dmdw 크롤
 *     (주의: 예비특보 통보문은 강풍/풍랑/대설 등 복합. 풍랑-only 분리는 상세파싱 필요 → 전국 근사)
 *   - 개선 wind JSON : 이벤트별 우리 최이른 검출 리드(Lmax, ≤72h)
 *   - CSV : 풍랑 발효시각(전국 통합 타임라인)
 *
 * 각 풍랑 발효 이벤트:
 *   - preLead = 발효 - (직전 예비특보 발표, 120h 내 최근접)
 *   - ourLead = Lmax (우리 검출 가장 이른 리드)
 *   - 우리가 빠름 = ourLead > preLead
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');

const DIR = __dirname, OUT = path.join(DIR, 'out');
const pre = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'pre_advisory_fc.json'), 'utf8'))
    .map((s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12) || 0))
    .sort((a, b) => a - b);
const preMs = pre.map((d) => d.getTime());
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };
const med = (a) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;

// 우리 검출 Lmax: 청별 개선 wind JSON 에서 effectiveAt→maxLead(zoneHit3)
const ourLmax = new Map();
for (const code of Object.keys(OFFICES)) {
    const fs2 = fs.readdirSync(OUT).filter((f) => new RegExp(`^leadtime_${code}_wind_.*\\.json$`).test(f));
    if (!fs2.length) continue;
    const { results } = JSON.parse(fs.readFileSync(path.join(OUT, fs2.sort().pop()), 'utf8'));
    const leads = Object.keys(results[0].leads).map(Number).sort((a, b) => b - a);
    for (const r of results) {
        let L = null; for (const l of leads) { const x = r.leads[l]; if (x && x.ok && x.zoneHit3) { L = l; break; } }
        const k = r.effectiveAt; const cur = ourLmax.get(k);
        if (L != null && (cur == null || L > cur)) ourLmax.set(k, L);
        else if (!ourLmax.has(k)) ourLmax.set(k, cur == null ? null : cur);
    }
}

// 전국 풍랑 발효 이벤트 타임라인 (effectiveAt 유니크)
const evs = parseWarnings(path.join(DIR, 'data', 'warnings_2023-2026.csv'), { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter((e) => e.effectiveAt && e.level === '주의보');
const evTimes = [...new Set(evs.map((e) => e.effectiveAt.toISOString()))].map((s) => new Date(s)).sort((a, b) => a - b);

// 직전 예비특보 인덱스 (발효 전 가장 가까운)
function prevIdx(tEf) {
    let lo = 0, hi = preMs.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (preMs[mid] < tEf) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    return idx;
}
// (a) 직전 예비특보 선행(마지막 갱신)  (b) 연속 클러스터의 '첫' 예비특보 선행
function preLeads(tEf) {
    const idx = prevIdx(tEf); if (idx < 0) return { last: null, first: null };
    const lastH = (tEf - preMs[idx]) / 3600000; if (lastH > 120) return { last: null, first: null };
    // 클러스터 첫: idx 에서 과거로, 인접 예비특보 간격 ≤24h 인 동안 확장
    let j = idx;
    while (j > 0 && (preMs[j] - preMs[j - 1]) / 3600000 <= 24) j--;
    const firstH = (tEf - preMs[j]) / 3600000;
    return { last: lastH, first: firstH };
}

let hasPre = 0, both = 0, weEarlier = 0;
const lastLeads = [], firstLeads = [], diffs = [];
for (const t of evTimes) {
    const tEf = t.getTime();
    const { last, first } = preLeads(tEf);  // 예비특보 마지막/첫 선행(시간)
    const our = ourLmax.get(t.toISOString()); // 우리 Lmax(시간) or null
    if (last != null) { hasPre++; lastLeads.push(last); firstLeads.push(first); }
    if (first != null && our != null) {
        both++;
        if (our >= first) weEarlier++;      // 클러스터 첫 예비특보 기준 비교
        diffs.push(our - first);
    }
}

let md = `# 우리 검출 vs 기상청 '예비특보' 발표 — 누가 먼저 (전국)\n\n`;
md += `> 주의: 예비특보 통보문은 강풍·풍랑·대설 복합이라 풍랑-only 분리 못함 → '전국 예비특보 발표시각' 근사. 우리 리드는 ≤72h(테스트 범위).\n\n`;
md += `## 데이터\n\n`;
md += `- 전국 예비특보 발표시각: ${pre.length}건 (2023-07~2026-06)\n`;
md += `- 풍랑 발효 이벤트(유니크 발효시각): ${evTimes.length}건\n\n`;
md += `## 결과\n\n`;
md += `- 풍랑 발효 중 **직전 120h 내 예비특보가 있었던 경우: ${hasPre}건 (${(hasPre / evTimes.length * 100).toFixed(0)}%)**\n`;
md += `- 기상청 예비특보 선행(발효 대비) 중앙값 — 마지막 갱신 **${med(lastLeads) != null ? med(lastLeads).toFixed(0) : '-'}시간**, **클러스터 첫 발표 ${med(firstLeads) != null ? med(firstLeads).toFixed(0) : '-'}시간**\n\n`;
md += `### 우리 검출(Lmax,≤72h) vs 예비특보 '첫 발표' (둘 다 있는 ${both}건)\n\n`;
md += `- 우리가 더 이르거나 동시: **${both ? (weEarlier / both * 100).toFixed(0) : '-'}%** (${weEarlier}/${both})\n`;
md += `- (우리 Lmax − 예비특보 첫발표 선행) 중앙값: **${med(diffs) != null ? med(diffs).toFixed(0) : '-'}시간** (양수=우리가 더 일찍)\n`;
md += `\n> 우리 리드는 72h 상한 → 예비특보가 72h+ 전이면 불리하게 집계(보수적).\n`;
md += `> 한계: 예비특보 통보문은 복합(풍랑-only 분리 못함), 클러스터=24h 간격 휴리스틱. 정밀화는 상세 통보문 파싱 필요.\n`;

fs.writeFileSync(path.join(DIR, 'reports', 'PRE_advisory_compare.md'), md);
console.log(md);
