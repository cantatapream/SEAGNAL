'use strict';
/**
 * calib_abs.js — 절대 발효확률표 P(발효 | 풍속밴드, 면적) 보정 + 2026 홀드아웃.
 *
 *  표본(폴리곤+면적, lead≈24h):
 *   - 양성(1): 풍랑 발효 (zone,발효시각), 발효 24h 전 가용 프레임 (캐시).
 *   - 음성(0): fetch_calm.js 가 모은 잔잔 (zone,validAt) 프레임 (out/calm_samples.json).
 *  홀드아웃: 발효/표본 시각 <2026-01-01 학습 → 밴드별 P(발효), ≥ 검증 → 신뢰도·정밀/재현율.
 *
 *  ※ 음성표본이 없으면(=fetch_calm 미실행) 경고만 내고 종료. 자격증명 받아 수집 후 재실행.
 *
 *  실행: node analysis/wave_leadtime/calib_abs.js [--lead=24]
 *  산출: reports/CALIB_ABS.md
 */
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { CALIB, OFFICE_CHART, decode } = require('./geoCalib');
const { getStaticMask } = require('./staticMask');
const windPalette = require('./windPalette');
const { REGIONAL_OFFICES } = require('./chartClient');
const { loadZonePolygons, zonePixelIndices, analyzeByIndices, normName } = require('./zonePolygon');

const GIF = path.join(__dirname, 'cache', 'gif');
const FILES = ['warnings_2020-2023.csv', 'warnings_2023-2026.csv'].map(f => path.join(__dirname, 'data', f));
const CALM = path.join(__dirname, 'out', 'calm_samples.json');
const OUT_MD = path.join(__dirname, 'reports', 'CALIB_ABS.md');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const LEAD_H = args.lead ? +args.lead : 24;

const H = 3600 * 1000, PUB_DELAY_H = 7, HOLDOUT = Date.UTC(2026, 0, 1);
const pad = n => String(n).padStart(2, '0');
const ymdh = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
const calibAdapter = code => { const c = CALIB[code]; if (!c) return null; return { xOf: lon => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: lat => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; };
const OFFICES = ['jeju', 'busn', 'gwju', 'gawn', 'dajn'];
function runSlotsBefore(queryAt, maxBack = 3) {
    const d = new Date(queryAt - PUB_DELAY_H * H); d.setMinutes(0, 0, 0);
    while (!(d.getHours() === 9 || d.getHours() === 21)) d.setHours(d.getHours() - 1);
    const out = []; for (let i = 0; i < maxBack; i++) { out.push(d.getTime()); d.setHours(d.getHours() - 12); } return out;
}

(async () => {
    const polyMap = loadZonePolygons();
    let calm = [];
    try { calm = JSON.parse(fs.readFileSync(CALM, 'utf8')); } catch (_) { calm = []; }
    if (!calm.length) { console.error('[calib] 음성(잔잔) 표본 없음 → fetch_calm.js 를 자격증명으로 먼저 실행하세요. (out/calm_samples.json)'); process.exit(2); }

    // 양성: 풍랑 발효 (2023-06+, 차트 가용)
    const pos = [];
    for (const f of FILES) {
        if (!fs.existsSync(f)) continue;
        for (const e of parseWarnings(f, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) })) {
            if (!e.effectiveAt) continue; const t = e.effectiveAt.getTime();
            if (t < Date.UTC(2023, 4, 27)) continue; // 차트 가용 전 제외
            for (const a of e.seaAreas) { const z = normName(a); if (polyMap.has(z)) pos.push({ zone: z, targetAt: t }); }
        }
    }

    // 프레임 매칭: 양성은 캐시에서 lead≈LEAD_H, 음성은 calm_samples 의 fileName 직접.
    function findPos(zone, targetAt) {
        for (const base of runSlotsBefore(targetAt)) {
            const fnSlot = ymdh(new Date(base - 9 * H));
            const rawStep = Math.round((targetAt - base) / H / 3) * 3;
            for (const dlt of [0, 3, -3, 6, -6]) {
                const s = rawStep + dlt; if (s < 0 || s > 120) continue;
                for (const office of OFFICES) {
                    const fn = `kim_cww3_${office}_wind_s${pad(s).padStart(3, '0')}_${fnSlot}.gif`;
                    if (fs.existsSync(path.join(GIF, fn))) return { office, fn };
                }
            }
        }
        return null;
    }

    const tasks = [];
    for (const p of pos) { const f = findPos(p.zone, p.targetAt); if (f) tasks.push({ label: 1, zone: p.zone, office: f.office, fn: f.fn, time: p.targetAt }); }
    for (const c of calm) { if (fs.existsSync(path.join(GIF, c.fileName))) tasks.push({ label: 0, zone: c.zone, office: c.office, fn: c.fileName, time: c.validAt }); }

    // 마스크
    const masks = {};
    for (const office of OFFICES) {
        try { const meta = REGIONAL_OFFICES[OFFICE_CHART[office] || office]; const prefix = (meta.prefixKIM || meta.prefixAPPM).replace('_wave_', '_wind_');
            const mk = await getStaticMask(OFFICE_CHART[office] || office, meta, { signal: 'wind', classify: windPalette.classify, ge3Level: 20, prefix }); masks[office] = mk && mk.mask;
        } catch (_) { masks[office] = null; }
    }

    // 분석(프레임별 1 decode)
    const byFrame = new Map();
    for (const t of tasks) { if (!byFrame.has(t.fn)) byFrame.set(t.fn, []); byFrame.get(t.fn).push(t); }
    const idxCache = new Map();
    let dn = 0;
    for (const [fn, group] of byFrame) {
        let dec; try { dec = decode(fs.readFileSync(path.join(GIF, fn))); } catch (_) { continue; }
        for (const t of group) {
            const key = t.office + '|' + t.zone; let idx = idxCache.get(key);
            if (idx === undefined) { const cal = calibAdapter(OFFICE_CHART[t.office] || t.office); const polys = polyMap.get(t.zone); idx = (cal && polys) ? zonePixelIndices(cal, polys, dec.w, dec.h) : null; idxCache.set(key, idx); }
            if (!idx || !idx.length) continue;
            const a = analyzeByIndices(dec, idx, { mask: masks[t.office], classify: windPalette.classify, ge3Level: 20, ge5Level: 40, minBandPixels: 12 });
            if (a) { t.band = a.maxBand; t.area = a.areaFraction; }
        }
        if (++dn % 200 === 0) console.error(`[calib] 프레임 ${dn}/${byFrame.size}`);
    }

    const rows = tasks.filter(t => t.band != null);
    const train = rows.filter(t => t.time < HOLDOUT), test = rows.filter(t => t.time >= HOLDOUT);

    // 밴드 버킷(면적≥30% 통과분만) → P(발효)
    const BANDS = [[0, 19], [20, 24], [25, 29], [30, 34], [35, 99]];
    const label = b => b[1] >= 99 ? `${b[0]}kt+` : `${b[0]}–${b[1]}kt`;
    function table(set, areaMin) {
        return BANDS.map(b => {
            const inb = set.filter(t => t.band >= b[0] && t.band <= b[1] && t.area >= areaMin);
            const p = inb.filter(t => t.label === 1).length;
            return { band: label(b), n: inb.length, pos: p, prob: inb.length ? p / inb.length : null };
        });
    }
    const trTab = table(train, 0.30), teTab = table(test, 0.30);

    const pc = x => x == null ? '-' : (x * 100).toFixed(0) + '%';
    let md = '# 절대 발효확률표 보정 (폴리곤+면적≥30%, lead≈24h)\n\n';
    md += `표본: 양성(풍랑 발효) ${rows.filter(t => t.label === 1).length} · 음성(잔잔) ${rows.filter(t => t.label === 0).length}\n`;
    md += `학습(<2026) ${train.length} · 검증(2026) ${test.length}\n\n`;
    md += '## 학습셋 밴드별 발효확률 (이게 카드에 띄울 %의 근거)\n\n| 풍속밴드 | 표본 | 발효 | P(발효) |\n|---|---|---|---|\n';
    for (const r of trTab) md += `| ${r.band} | ${r.n} | ${r.pos} | **${pc(r.prob)}** |\n`;
    md += '\n## 2026 홀드아웃 신뢰도(같은 밴드의 실제 발효율)\n\n| 풍속밴드 | 표본 | 실제발효율 |\n|---|---|---|\n';
    for (const r of teTab) md += `| ${r.band} | ${r.n} | ${pc(r.prob)} |\n`;

    // 운영점(밴드≥25 & 면적≥30%) 정밀/재현 (검증셋)
    const op = t => t.band >= 25 && t.area >= 0.30;
    const tp = test.filter(t => t.label === 1 && op(t)).length, fp = test.filter(t => t.label === 0 && op(t)).length;
    const fn = test.filter(t => t.label === 1 && !op(t)).length, tn = test.filter(t => t.label === 0 && !op(t)).length;
    md += '\n## 운영점(밴드≥25kt & 면적≥30%) — 2026 검증\n\n';
    md += `- 정밀도(Precision): ${pc(tp + fp ? tp / (tp + fp) : null)}  ·  재현율(Recall): ${pc(tp + fn ? tp / (tp + fn) : null)}\n`;
    md += `- TP ${tp} · FP ${fp} · FN ${fn} · TN ${tn}\n\n`;
    md += '> 음성표본은 fetch_calm.js 의 잔잔 (구역,시각) 수집물. 표본이 적으면 %는 잠정 — ncalm 늘려 재수집 권장.\n';
    fs.writeFileSync(OUT_MD, md);
    console.log(md);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
