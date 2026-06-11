/**
 * ============================================================================
 * leadVsAnnounce.js — 우리 알림이 '기상청 발표(announce)' 보다 얼마나 빠른가
 * ============================================================================
 *
 * 요건: 알림은 발효(effective)가 아니라 '발표(announce)' 보다 빨라야 한다.
 *
 * 각 발효 이벤트:
 *   - Lmax = 우리가 그 구역 신호를 잡은 '가장 이른 리드'(12/24/48/72h 중 zoneHit 최대)
 *     → 우리가 알릴 수 있던 시점 ourAlert = 발효 - Lmax
 *   - gap = 발효 - 발표 (기상청이 발효 몇 시간 전에 발표했나)
 *   - 발표대비 선행 = 발표 - ourAlert = Lmax - gap   (양수면 우리가 발표보다 빠름)
 *
 * 개선 풍속 JSON(zoneHit3) + CSV(발표/발효시각) 사용. 추가 다운로드 없음.
 * 사용: node leadVsAnnounce.js
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');

const OUT = path.join(__dirname, 'out');
const CSV = path.join(__dirname, 'data', 'warnings_2023-2026.csv');
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };
const NAME = { jeju: '제주청', busn: '부산청', gwju: '광주청', degu: '대구청', gawn: '강원청', dajn: '대전청' };
const med = (a) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null;

function latestWindJson(code) { const f = fs.readdirSync(OUT).filter((x) => new RegExp(`^leadtime_${code}_wind_.*\\.json$`).test(x)); return f.length ? path.join(OUT, f.sort().pop()) : null; }

// 발표/발효 둘 다 가진 이벤트 맵 (effectiveAt → announceAt, 가장 이른 발표)
function announceMap(region) {
    const evs = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter((e) => e.officeRegion === region && e.effectiveAt && e.announceAt && e.level === '주의보');
    const mp = new Map();
    for (const e of evs) { const k = e.effectiveAt.toISOString(); const cur = mp.get(k); if (!cur || e.announceAt < cur) mp.set(k, e.announceAt); }
    return mp;
}

const rowsAll = [];
const gaps = [];
for (const [code, region] of Object.entries(OFFICES)) {
    const jf = latestWindJson(code); if (!jf) continue;
    const { results } = JSON.parse(fs.readFileSync(jf, 'utf8'));
    const annMap = announceMap(region);
    const leads = Object.keys(results[0].leads).map(Number).sort((a, b) => b - a); // 큰 리드부터
    for (const r of results) {
        const ann = annMap.get(r.effectiveAt); if (!ann) continue;
        const eff = new Date(r.effectiveAt);
        const gapH = (eff - new Date(ann)) / 3600000; gaps.push(gapH);
        let Lmax = null;
        for (const L of leads) { const x = r.leads[L]; if (x && x.ok && x.zoneHit3) { Lmax = L; break; } }
        rowsAll.push({ code, Lmax, gapH, beforeAnnounceH: Lmax != null ? Lmax - gapH : null });
    }
}

const detected = rowsAll.filter((r) => r.Lmax != null);
const beat = detected.filter((r) => r.beforeAnnounceH > 0);
const leadsBefore = detected.map((r) => r.beforeAnnounceH).filter((x) => x != null);

let md = `# 발표시각 대비 선행성 — "우리 알림이 기상청 발표보다 빠른가"\n\n`;
md += `(리드는 12/24/48/72h 만 검사 → Lmax 72h 는 '≥72h' 의미. 추가 다운로드 없이 기존 결과로 계산)\n\n`;
md += `## 핵심\n\n`;
md += `- 전체 발효 ${rowsAll.length}건 중 우리가 신호 검출(선행 알림 가능) **${detected.length}건 (${(detected.length / rowsAll.length * 100).toFixed(0)}%)**\n`;
md += `- 그중 **기상청 발표보다 빠른 경우: ${beat.length}건 (${detected.length ? (beat.length / detected.length * 100).toFixed(0) : 0}%)**\n`;
md += `- 발표대비 선행 중앙값 **${med(leadsBefore) != null ? med(leadsBefore).toFixed(0) : '-'}시간** (즉 우리가 그만큼 먼저 알릴 수 있음)\n`;
md += `- 참고: 기상청은 보통 **발효 ${med(gaps) != null ? med(gaps).toFixed(0) : '-'}시간 전**(중앙값)에 발표 → 우리 예보검출 리드가 길어 크게 앞섬\n\n`;

md += `## 청별\n\n| 청 | 검출률 | 발표보다 빠른 비율 | 발표대비 선행(중앙값) |\n|---|---|---|---|\n`;
for (const code of Object.keys(OFFICES)) {
    const rs = rowsAll.filter((r) => r.code === code); const det = rs.filter((r) => r.Lmax != null); const bt = det.filter((r) => r.beforeAnnounceH > 0);
    const lb = det.map((r) => r.beforeAnnounceH);
    md += `| ${NAME[code]} | ${rs.length ? (det.length / rs.length * 100).toFixed(0) : '-'}% | ${det.length ? (bt.length / det.length * 100).toFixed(0) : '-'}% | ${med(lb) != null ? med(lb).toFixed(0) + 'h' : '-'} |\n`;
}
md += `\n> 결론: 기상청 풍랑주의보 '발표'는 발효 직전(중앙값 ${med(gaps) != null ? med(gaps).toFixed(0) : '-'}h)이라, 예보를 보는 우리 검출(수십 시간 전)이 거의 항상 더 빠르다.\n`;

fs.writeFileSync(path.join(__dirname, 'reports', 'LEAD_vs_announce.md'), md);
console.log(md);
