/**
 * ============================================================================
 * probCalib.js — 발효 확률 보정 + 홀드아웃 검증 (풍속 신호 기준)
 * ============================================================================
 *
 * [목표] "일기도가 이 구역에 풍속 강도 S 를 그리면 → 풍랑주의보 발효 가능성 P%" 를
 *   과거 빈도로 보정하고, 학습에 안 쓴 검증기간으로 그 확률이 실제로 맞는지 확인.
 *
 * [표본]  리드타임 24h 기준:
 *   - 양성(label=1): 실제 풍랑주의보 발효 이벤트의 '발효 구역' 풍속 최대밴드 (개선 wind JSON)
 *   - 음성(label=0): 잔잔한 슬롯의 차트 내 각 구역 풍속 최대밴드 (발효 없음)
 *   각 표본에 시각(time) 부여.
 *
 * [홀드아웃]  time < 2026-01-01 = 학습(train), ≥ = 검증(test).
 *   - train 으로 밴드별 P(발효)=양성/(양성+음성) 보정표 생성
 *   - test 에서 각 표본에 예측 P 부여 → 신뢰도(reliability): 예측P 구간별 실제 발효율
 *   - test 정밀도/재현율(P≥0.5 기준)
 *
 * 추가 다운로드 없음(캐시 프레임). 사용: node probCalib.js [--lead=24]
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { REGIONAL_OFFICES } = require('./chartClient');
const { CALIB, OFFICE_CHART, decode, analyzeZone } = require('./geoCalib');
const { resolveZone, ZONES } = require('./zones');
const { getStaticMask } = require('./staticMask');
const windPalette = require('./windPalette');

const OUT = path.join(__dirname, 'out');
const GIF = path.join(__dirname, 'cache', 'gif');
const CACHE = path.join(__dirname, 'cache');
const CSV = path.join(__dirname, 'data', 'warnings_2023-2026.csv');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const LEAD = args.lead ? +args.lead : 24;
const SPLIT = new Date('2026-01-01T00:00:00');
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };

function latestWindJson(code) {
    const files = fs.readdirSync(OUT).filter((f) => new RegExp(`^leadtime_${code}_wind_.*\\.json$`).test(f));
    return files.length ? path.join(OUT, files.sort().pop()) : null;
}
const loadGif = (fn) => { const p = path.join(GIF, fn); return fs.existsSync(p) ? fs.readFileSync(p) : null; };
function calibAdapter(code) { const c = CALIB[code]; if (!c) return null;
    return { xOf: (lon) => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: (lat) => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; }
const radOf = (z) => Math.round((z.type === 'H' ? 55 : 30) * 1.8);
const ymdh = (d) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}${String(d.getHours()).padStart(2,'0')}`;

async function collect() {
    const samples = []; // {band, frac, label, time}
    for (const [code, region] of Object.entries(OFFICES)) {
        const jf = latestWindJson(code); if (!jf) continue;
        const { results } = JSON.parse(fs.readFileSync(jf, 'utf8'));
        const chartCode = OFFICE_CHART[code] || code;
        const cal = calibAdapter(chartCode); if (!cal) continue;
        const meta = REGIONAL_OFFICES[chartCode];
        const mask = await getStaticMask(chartCode, meta, { signal: 'wind', classify: windPalette.classify, ge3Level: 20, prefix: (meta.prefixKIM || meta.prefixAPPM).replace('_wave_', '_wind_') });
        const m = mask && mask.mask;
        // 해역 매핑
        const evs = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter((e) => e.officeRegion === region && e.effectiveAt && e.level === '주의보');
        const areasByT = new Map();
        for (const e of evs) { const k = e.effectiveAt.toISOString(); if (!areasByT.has(k)) areasByT.set(k, new Set()); e.seaAreas.forEach((a) => areasByT.get(k).add(a)); }
        // 양성: 발효 이벤트 warned-zone
        for (const r of results) {
            const rec = r.leads[LEAD]; if (!rec || !rec.ok || !rec.frame) continue;
            const buf = loadGif(rec.frame); if (!buf) continue;
            const dec = decode(buf); const areas = areasByT.get(r.effectiveAt); if (!areas) continue;
            const zs = [...areas].map(resolveZone).filter(Boolean);
            let band = 0, frac = 0;
            for (const z of zs) { const a = analyzeZone(dec, cal, z, { mask: m, radiusPx: radOf(z), classify: windPalette.classify, ge3Level: 20, ge5Level: 40 }); if (a && a.maxBand > band) band = a.maxBand; if (a && a.sampled) frac = Math.max(frac, a.pixelsGE3 / a.sampled); }
            samples.push({ band, frac, label: 1, time: new Date(r.effectiveAt) });
        }
        // 음성: 잔잔 슬롯 차트 구역
        const warnTimes = results.map((x) => new Date(x.effectiveAt).getTime());
        const isCalm = (t) => warnTimes.every((wt) => Math.abs(wt - t) > 24 * 3600 * 1000);
        const chartZones = ZONES.filter((z) => { const cx = cal.xOf(z.lon), cy = cal.yOf(z.lat); return cx >= cal.frame.x0 && cx <= cal.frame.x1 && cy >= cal.frame.y0 && cy <= cal.frame.y1; });
        const listFiles = fs.readdirSync(CACHE).filter((f) => new RegExp(`^list_${chartCode}_wind_\\d`).test(f));
        let calmCnt = 0;
        for (const lf of listFiles) {
            if (calmCnt >= 60) break;
            const tm = lf.match(/_(\d{10})\.json$/); if (!tm) continue;
            const d = new Date(+tm[1].slice(0, 4), +tm[1].slice(4, 6) - 1, +tm[1].slice(6, 8), +tm[1].slice(8, 10));
            if (!isCalm(d.getTime())) continue;
            const frames = JSON.parse(fs.readFileSync(path.join(CACHE, lf), 'utf8'));
            const f0 = frames.find((x) => x.ftHours === 0); if (!f0) continue;
            const buf = loadGif(f0.fileName); if (!buf) continue;
            const dec = decode(buf); calmCnt++;
            for (const z of chartZones) { const a = analyzeZone(dec, cal, z, { mask: m, radiusPx: radOf(z), classify: windPalette.classify, ge3Level: 20, ge5Level: 40 }); samples.push({ band: a ? a.maxBand : 0, frac: a && a.sampled ? a.pixelsGE3 / a.sampled : 0, label: 0, time: d }); }
        }
    }
    return samples;
}

function bandKey(b) { if (b >= 40) return '40+'; if (b >= 35) return '35'; if (b >= 30) return '30'; if (b >= 25) return '25'; if (b >= 20) return '20'; if (b >= 15) return '15'; return '<15'; }
const BANDS = ['<15', '15', '20', '25', '30', '35', '40+'];

(async () => {
    const all = await collect();
    const train = all.filter((s) => s.time < SPLIT), test = all.filter((s) => s.time >= SPLIT);
    // 보정표: train 밴드별 P
    const P = {};
    for (const k of BANDS) { const pos = train.filter((s) => bandKey(s.band) === k && s.label === 1).length; const neg = train.filter((s) => bandKey(s.band) === k && s.label === 0).length; P[k] = (pos + neg) ? pos / (pos + neg) : null; }

    let md = `# 발효 확률 보정 + 홀드아웃 검증 (풍속, lead ${LEAD}h)\n\n`;
    md += `학습기간 <2026-01-01 (양성 ${train.filter(s=>s.label).length}·음성 ${train.filter(s=>!s.label).length}) / 검증기간 2026~ (양성 ${test.filter(s=>s.label).length}·음성 ${test.filter(s=>!s.label).length})\n\n`;
    md += `## 1) 확률 보정표 — "구역 풍속 최대밴드 → 발효 확률" (학습기간)\n\n`;
    md += `| 풍속 밴드 | 발효 확률 | (양성/전체) |\n|---|---|---|\n`;
    for (const k of BANDS) { const pos = train.filter((s) => bandKey(s.band) === k && s.label === 1).length, tot = train.filter((s) => bandKey(s.band) === k).length; md += `| ${k}kt | ${P[k] != null ? (P[k] * 100).toFixed(0) + '%' : '-'} | ${pos}/${tot} |\n`; }

    // 검증: test 표본에 예측P 부여 → 신뢰도(예측P 구간별 실제 발효율)
    const withP = test.map((s) => ({ ...s, p: P[bandKey(s.band)] })).filter((s) => s.p != null);
    const buckets = [[0, .2], [.2, .4], [.4, .6], [.6, .8], [.8, 1.01]];
    md += `\n## 2) 홀드아웃 신뢰도 (검증기간) — 예측확률 vs 실제 발효율\n\n`;
    md += `| 예측 확률대 | 표본수 | 실제 발효율 |\n|---|---|---|\n`;
    for (const [lo, hi] of buckets) { const grp = withP.filter((s) => s.p >= lo && s.p < hi); const fire = grp.filter((s) => s.label === 1).length; md += `| ${(lo * 100).toFixed(0)}~${(hi * 100).toFixed(0)}% | ${grp.length} | ${grp.length ? (fire / grp.length * 100).toFixed(0) + '%' : '-'} |\n`; }
    md += `\n> 예측확률대와 실제 발효율이 비슷할수록 '잘 보정됨'.\n`;

    // 검증 정밀도/재현율 (P≥0.5 를 '발효 예측'으로)
    const thr = 0.5;
    const tp = withP.filter((s) => s.p >= thr && s.label === 1).length, fp = withP.filter((s) => s.p >= thr && s.label === 0).length;
    const fn = withP.filter((s) => s.p < thr && s.label === 1).length;
    md += `\n## 3) 검증기간 성능 (예측확률 ≥50% 를 '발효 가능' 으로)\n\n`;
    md += `- 재현율(recall) = ${tp + fn ? (tp / (tp + fn) * 100).toFixed(0) : '-'}%  (실제 발효 ${tp + fn}건 중 ${tp}건 예측)\n`;
    md += `- 정밀도(precision) = ${tp + fp ? (tp / (tp + fp) * 100).toFixed(0) : '-'}%  (발효예측 ${tp + fp}건 중 ${tp}건 적중)\n`;

    fs.writeFileSync(path.join(__dirname, 'reports', `PROB_calibration_lead${LEAD}.md`), md);
    console.log(md);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
