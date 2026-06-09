/**
 * ============================================================================
 * probCalib.js — 발효 확률 보정 + 홀드아웃 검증 (풍속) — 음성표본 보강판
 * ============================================================================
 *
 * [개선] 이전판은 음성(잔잔)표본을 캐시에서만 뽑아 2026년 음성=0 → 보정/정밀도 무효였음.
 *   이번판은 잔잔한 시각을 '전 기간 2023-06~2026-06 에 고르게' 새로 샘플해서, 양성과
 *   동일한 방식(리드 L시간 전 예보 프레임, valid≈샘플시각)으로 특징을 뽑는다(필요시 다운로드).
 *
 * [표본] lead L=24h:
 *   - 양성(1): 풍랑주의보 발효 이벤트 warned-zone 풍속 최대밴드 (개선 wind JSON 의 매칭 프레임)
 *   - 음성(0): 잔잔한 시각(±24h 내 발효 없음)들의 차트 내 각 구역 풍속 최대밴드
 *
 * [홀드아웃] time<2026-01-01=학습, ≥=검증. 학습으로 밴드별 P(발효), 검증으로 보정도·정밀도·재현율.
 *
 * 사용: KMA_DMDW_USER_ID/PWD 필요. node probCalib.js [--lead=24] [--ncalm=90]
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { REGIONAL_OFFICES, listFrames, downloadFrame } = require('./chartClient');
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
const NCALM = args.ncalm ? +args.ncalm : 90;     // 청별 잔잔 샘플 시각 수(전 기간 분산)
const PUB_DELAY_H = 7;
const SPLIT = new Date('2026-01-01T00:00:00');
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };

const pad = (n) => String(n).padStart(2, '0');
const ymdh = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
const ymdhToDate = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), 0, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loadGifFile = (fn) => { const p = path.join(GIF, fn); return fs.existsSync(p) ? fs.readFileSync(p) : null; };
function calibAdapter(code) { const c = CALIB[code]; if (!c) return null;
    return { xOf: (lon) => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: (lat) => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; }
const radOf = (z) => Math.round((z.type === 'H' ? 55 : 30) * 1.8);

function runSlotsBefore(queryAt, maxBack = 4) {
    const avail = new Date(queryAt.getTime() - PUB_DELAY_H * 3600 * 1000); const d = new Date(avail); d.setMinutes(0, 0, 0);
    while (!(d.getHours() === 9 || d.getHours() === 21)) d.setHours(d.getHours() - 1);
    const out = []; for (let i = 0; i < maxBack; i++) { out.push(ymdh(d)); d.setHours(d.getHours() - 12); } return out;
}
async function getFramesCached(chartCode, prefix, model, modelText, queryTm) {
    const diskFile = path.join(CACHE, `list_${chartCode}_wind_${queryTm}.json`);
    if (fs.existsSync(diskFile)) return JSON.parse(fs.readFileSync(diskFile, 'utf8'));
    const headData = `0#12#3#/DATA/CHT/${model}/#/${prefix}`;
    let frames = []; try { frames = await listFrames({ headData, model, modelText, type: 'wind' }, queryTm); } catch (e) {}
    fs.writeFileSync(diskFile, JSON.stringify(frames)); return frames;
}
async function getGifCached(frame) {
    const file = path.join(GIF, frame.fileName); if (fs.existsSync(file)) return fs.readFileSync(file);
    const buf = await downloadFrame(frame); fs.writeFileSync(file, buf); await sleep(120); return buf;
}

async function collect() {
    const samples = [];
    for (const [code, region] of Object.entries(OFFICES)) {
        const jfs = fs.readdirSync(OUT).filter((f) => new RegExp(`^leadtime_${code}_wind_.*\\.json$`).test(f));
        if (!jfs.length) continue;
        const { results } = JSON.parse(fs.readFileSync(path.join(OUT, jfs.sort().pop()), 'utf8'));
        const chartCode = OFFICE_CHART[code] || code; const cal = calibAdapter(chartCode); if (!cal) continue;
        const meta = REGIONAL_OFFICES[chartCode];
        const prefix = (meta.prefixKIM || meta.prefixAPPM).replace('_wave_', '_wind_');
        const model = meta.prefixKIM ? 'KIMA' : 'APPM';
        const mask = await getStaticMask(chartCode, meta, { signal: 'wind', classify: windPalette.classify, ge3Level: 20, prefix });
        const m = mask && mask.mask;
        const zoneFeat = (dec, z) => { const a = analyzeZone(dec, cal, z, { mask: m, radiusPx: radOf(z), classify: windPalette.classify, ge3Level: 20, ge5Level: 40 }); return a ? { band: a.maxBand, frac: a.sampled ? a.pixelsGE3 / a.sampled : 0 } : { band: 0, frac: 0 }; };

        // 해역 매핑
        const evs = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter((e) => e.officeRegion === region && e.effectiveAt && e.level === '주의보');
        const areasByT = new Map();
        for (const e of evs) { const k = e.effectiveAt.toISOString(); if (!areasByT.has(k)) areasByT.set(k, new Set()); e.seaAreas.forEach((a) => areasByT.get(k).add(a)); }
        const warnTimes = [...new Set(evs.map((e) => e.effectiveAt.getTime()))];
        const isCalm = (t) => warnTimes.every((wt) => Math.abs(wt - t) > 24 * 3600 * 1000);

        // 양성
        for (const r of results) {
            const rec = r.leads[LEAD]; if (!rec || !rec.ok || !rec.frame) continue;
            const buf = loadGifFile(rec.frame); if (!buf) continue; const dec = decode(buf);
            const areas = areasByT.get(r.effectiveAt); if (!areas) continue;
            let band = 0, frac = 0; for (const z of [...areas].map(resolveZone).filter(Boolean)) { const f = zoneFeat(dec, z); band = Math.max(band, f.band); frac = Math.max(frac, f.frac); }
            samples.push({ band, frac, label: 1, time: new Date(r.effectiveAt), code });
        }

        // 음성: 전 기간 고르게 잔잔 시각 샘플 (NCALM 개)
        const chartZones = ZONES.filter((z) => { const cx = cal.xOf(z.lon), cy = cal.yOf(z.lat); return cx >= cal.frame.x0 && cx <= cal.frame.x1 && cy >= cal.frame.y0 && cy <= cal.frame.y1; });
        const START = new Date('2023-07-01T09:00:00'), END = new Date('2026-06-01T09:00:00');
        const spanDays = (END - START) / 86400000; const stepDays = Math.max(1, Math.floor(spanDays / (NCALM * 1.6)));
        let got = 0;
        for (let dd = 0; dd <= spanDays && got < NCALM; dd += stepDays) {
            const T = new Date(START.getTime() + dd * 86400000); T.setHours(dd % 2 ? 21 : 9, 0, 0, 0);
            if (!isCalm(T.getTime())) continue;
            // 리드 L시간 전 run → valid≈T 프레임
            let frames = [], chosen = null;
            for (const slot of runSlotsBefore(new Date(T.getTime()))) { frames = await getFramesCached(chartCode, prefix, model, meta.name, slot); if (frames.length) break; }
            if (!frames.length) continue;
            let best = null, bestDiff = Infinity; for (const f of frames) { if (!f.tm) continue; const di = Math.abs(ymdhToDate(f.tm) - T); if (di < bestDiff) { bestDiff = di; best = f; } }
            if (!best || bestDiff > 3 * 3600 * 1000 + 1) continue;
            let buf; try { buf = await getGifCached(best); } catch (e) { continue; }
            const dec = decode(buf); got++;
            for (const z of chartZones) { const f = zoneFeat(dec, z); samples.push({ band: f.band, frac: f.frac, label: 0, time: new Date(T), code }); }
        }
        console.error(`[calib] ${code}: 양성 ${results.length}, 잔잔시각 ${got} (음성 ${got * chartZones.length})`);
    }
    return samples;
}

function bandKey(b) { if (b >= 40) return '40+'; if (b >= 35) return '35'; if (b >= 30) return '30'; if (b >= 25) return '25'; if (b >= 20) return '20'; if (b >= 15) return '15'; return '<15'; }
const BANDS = ['<15', '15', '20', '25', '30', '35', '40+'];

(async () => {
    const all = await collect();
    const train = all.filter((s) => s.time < SPLIT), test = all.filter((s) => s.time >= SPLIT);
    const P = {};
    for (const k of BANDS) { const pos = train.filter((s) => bandKey(s.band) === k && s.label === 1).length, neg = train.filter((s) => bandKey(s.band) === k && s.label === 0).length; P[k] = (pos + neg) ? pos / (pos + neg) : null; }

    let md = `# 발효 확률 보정 + 홀드아웃 검증 (풍속, lead ${LEAD}h) — 음성표본 보강\n\n`;
    md += `학습 <2026 (양성 ${train.filter(s=>s.label).length}·음성 ${train.filter(s=>!s.label).length}) / 검증 2026~ (양성 ${test.filter(s=>s.label).length}·음성 ${test.filter(s=>!s.label).length})\n\n`;
    md += `## 1) 확률 보정표 — 구역 풍속 최대밴드 → 발효 확률 (학습기간)\n\n| 풍속 밴드 | 발효 확률 | 양성/전체 |\n|---|---|---|\n`;
    for (const k of BANDS) { const pos = train.filter((s) => bandKey(s.band) === k && s.label === 1).length, tot = train.filter((s) => bandKey(s.band) === k).length; md += `| ${k}kt | ${P[k] != null ? (P[k] * 100).toFixed(0) + '%' : '-'} | ${pos}/${tot} |\n`; }

    const withP = test.map((s) => ({ ...s, p: P[bandKey(s.band)] })).filter((s) => s.p != null);
    md += `\n## 2) 홀드아웃 신뢰도 (검증기간) — 예측확률 vs 실제 발효율\n\n| 예측 확률대 | 표본수 | 실제 발효율 |\n|---|---|---|\n`;
    for (const [lo, hi] of [[0, .2], [.2, .4], [.4, .6], [.6, .8], [.8, 1.01]]) { const g = withP.filter((s) => s.p >= lo && s.p < hi), fire = g.filter((s) => s.label === 1).length; md += `| ${(lo*100).toFixed(0)}~${(hi*100).toFixed(0)}% | ${g.length} | ${g.length ? (fire/g.length*100).toFixed(0)+'%' : '-'} |\n`; }
    md += `\n> 예측확률대 ≈ 실제발효율 이면 잘 보정된 것.\n`;

    const thr = 0.5;
    const tp = withP.filter((s) => s.p >= thr && s.label === 1).length, fp = withP.filter((s) => s.p >= thr && s.label === 0).length, fn = withP.filter((s) => s.p < thr && s.label === 1).length;
    md += `\n## 3) 검증기간 성능 (예측확률 ≥50% 를 '발효 가능' 으로)\n\n`;
    md += `- 재현율 = ${tp+fn ? (tp/(tp+fn)*100).toFixed(0) : '-'}% (실제 발효 ${tp+fn}건 중 ${tp}건)\n`;
    md += `- 정밀도 = ${tp+fp ? (tp/(tp+fp)*100).toFixed(0) : '-'}% (발효예측 ${tp+fp}건 중 ${tp}건 적중, 헛알람 ${fp})\n`;
    fs.writeFileSync(path.join(__dirname, 'reports', `PROB_calibration_lead${LEAD}.md`), md);
    console.log(md);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
