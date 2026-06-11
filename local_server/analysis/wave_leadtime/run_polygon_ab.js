'use strict';
/**
 * run_polygon_ab.js — 원(circle) vs 폴리곤(polygon) 면적비율 실증 A/B.
 *   과거 풍랑 발효 이벤트(양성)와 같은 프레임의 미발효 구역(음성)에 대해,
 *   기존 원 방식과 폴리곤 방식의 "구역 내 임계초과 면적비율"을 비교한다.
 *   캐시 GIF만 사용(오프라인). 풍속 신호(≥20kt) 기준.
 * 실행: node analysis/wave_leadtime/run_polygon_ab.js [--maxev=80]
 */
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { CALIB, OFFICE_CHART, decode, analyzeZone } = require('./geoCalib');
const { resolveZone, ZONES } = require('./zones');
const { getStaticMask } = require('./staticMask');
const windPalette = require('./windPalette');
const { REGIONAL_OFFICES } = require('./chartClient');
const { loadZonePolygons, zonePixelIndices, analyzeByIndices, normName } = require('./zonePolygon');

const GIF = path.join(__dirname, 'cache', 'gif');
const CSV = path.join(__dirname, 'data', 'warnings_2023-2026.csv');
const OUT = path.join(__dirname, 'out');
const LEAD = 24;
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const MAX_EV = args.maxev ? +args.maxev : 80;
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };

function calibAdapter(code) { const c = CALIB[code]; if (!c) return null; return { xOf: lon => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: lat => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; }
const radOf = z => Math.round((z.type === 'H' ? 55 : 30) * 1.8);
const loadGif = fn => { const p = path.join(GIF, fn); return fs.existsSync(p) ? fs.readFileSync(p) : null; };
const sort = a => a.slice().sort((x, y) => x - y);
const median = a => { if (!a.length) return null; const s = sort(a); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return null; const s = sort(a); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f2 = x => x == null ? '-' : (x * 100).toFixed(1) + '%';

(async () => {
    const polyMap = loadZonePolygons();
    const pos = [], neg = []; // 각 원소 {cb,cf,pb,pf} = circleBand/circleFrac/polyBand/polyFrac
    let covered = 0, missing = 0;

    for (const [code, region] of Object.entries(OFFICES)) {
        const jfs = fs.readdirSync(OUT).filter(f => new RegExp(`^leadtime_${code}_wind_.*\\.json$`).test(f));
        if (!jfs.length) { console.error(`[skip] ${code}: leadtime JSON 없음`); continue; }
        const { results } = JSON.parse(fs.readFileSync(path.join(OUT, jfs.sort().pop()), 'utf8'));
        const chartCode = OFFICE_CHART[code] || code; const cal = calibAdapter(chartCode); if (!cal) continue;
        const meta = REGIONAL_OFFICES[chartCode];
        const prefix = (meta.prefixKIM || meta.prefixAPPM).replace('_wave_', '_wind_');
        let m = null;
        try { const mk = await getStaticMask(chartCode, meta, { signal: 'wind', classify: windPalette.classify, ge3Level: 20, prefix }); m = mk && mk.mask; } catch (_) { m = null; }

        const evs = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter(e => e.officeRegion === region && e.effectiveAt && e.level === '주의보');
        const areasByT = new Map();
        const zoneWarnTimes = new Map(); // 정규화구역 → [발효시각ms...]
        for (const e of evs) {
            const k = e.effectiveAt.toISOString(); if (!areasByT.has(k)) areasByT.set(k, new Set());
            e.seaAreas.forEach(a => { areasByT.get(k).add(a); const n = normName(a); if (!zoneWarnTimes.has(n)) zoneWarnTimes.set(n, []); zoneWarnTimes.get(n).push(e.effectiveAt.getTime()); });
        }
        const DAY = 24 * 3600 * 1000;
        const isZoneCalmAt = (zname, tms) => { const arr = zoneWarnTimes.get(normName(zname)); if (!arr) return true; for (const wt of arr) if (Math.abs(wt - tms) <= DAY) return false; return true; };
        const chartZones = ZONES.filter(z => { const cx = cal.xOf(z.lon), cy = cal.yOf(z.lat); return cx >= cal.frame.x0 && cx <= cal.frame.x1 && cy >= cal.frame.y0 && cy <= cal.frame.y1; });

        const idxCache = new Map(); // zoneName → Int32Array (폴리곤 픽셀 인덱스, 1회)
        let w = 0, h = 0;
        const polyIdxOf = (z, dec) => {
            const key = z.name;
            if (idxCache.has(key)) return idxCache.get(key);
            const polys = polyMap.get(normName(z.name));
            const idx = polys ? zonePixelIndices(cal, polys, dec.w, dec.h) : null;
            idxCache.set(key, idx);
            return idx;
        };
        const fracCircle = (dec, z) => { const a = analyzeZone(dec, cal, z, { mask: m, radiusPx: radOf(z), classify: windPalette.classify, ge3Level: 20, ge5Level: 40 }); return a ? { frac: a.sampled ? a.pixelsGE3 / a.sampled : 0, band: a.maxBand } : null; };
        const fracPoly = (dec, z) => { const idx = polyIdxOf(z, dec); if (!idx) return null; const a = analyzeByIndices(dec, idx, { mask: m, classify: windPalette.classify, ge3Level: 20, ge5Level: 40, minBandPixels: 12 }); return a ? { frac: a.areaFraction, band: a.maxBand } : null; };

        const decCache = new Map();
        let ev = 0;
        for (const r of results) {
            if (ev >= MAX_EV) break;
            const rec = r.leads[LEAD]; if (!rec || !rec.ok || !rec.frame) continue;
            const areas = areasByT.get(r.effectiveAt); if (!areas) continue;
            let dec = decCache.get(rec.frame);
            if (!dec) { const buf = loadGif(rec.frame); if (!buf) continue; try { dec = decode(buf); } catch (_) { continue; } decCache.set(rec.frame, dec); }
            ev++;
            const tms = new Date(r.effectiveAt).getTime();
            const warnedNorm = new Set([...areas].map(normName));
            for (const z of [...areas].map(resolveZone).filter(Boolean)) {
                const c = fracCircle(dec, z); const p = fracPoly(dec, z);
                if (c && p) { pos.push({ cb: c.band, cf: c.frac, pb: p.band, pf: p.frac }); covered++; } else missing++;
            }
            for (const z of chartZones) {
                if (warnedNorm.has(normName(z.name))) continue;
                if (!isZoneCalmAt(z.name, tms)) continue; // ±24h 내 발효 없는 '진짜 잔잔' 구역만
                const c = fracCircle(dec, z); const p = fracPoly(dec, z);
                if (c && p) neg.push({ cb: c.band, cf: c.frac, pb: p.band, pf: p.frac });
            }
        }
        console.error(`[ab] ${code}: events ${ev}, frames ${decCache.size}`);
    }

    // 규칙별 재현율(양성 적중%)·오탐율(음성 발효판정%)
    const rate = (arr, fn) => arr.length ? arr.filter(fn).length / arr.length : null;
    const rules = [
        ['A) 현재식: 원 + maxBand≥25kt', s => s.cb >= 25],
        ['B) 폴리곤 + maxBand≥25kt', s => s.pb >= 25],
        ['C) 폴리곤 + maxBand≥25 & 면적≥30%', s => s.pb >= 25 && s.pf >= 0.30],
        ['D) 폴리곤 + maxBand≥25 & 면적≥40%', s => s.pb >= 25 && s.pf >= 0.40],
        ['E) 폴리곤 + maxBand≥25 & 면적≥50%', s => s.pb >= 25 && s.pf >= 0.50],
    ];
    let md = '';
    md += '# 과대검출 보정 A/B — 현재(원+maxBand) vs 폴리곤+면적 (풍속, lead 24h)\n\n';
    md += `표본(폴리곤 보유 구역만): 양성 ${pos.length} · 음성(±24h 잔잔) ${neg.length} · 폴백대상(폴리곤 없음) ${missing}\n\n`;
    md += '| 발효판정 규칙 | 재현율(양성 적중) | **오탐율(음성 헛발효)** |\n|---|---|---|\n';
    for (const [name, fn] of rules) {
        md += `| ${name} | ${f2(rate(pos, fn))} | ${f2(rate(neg, fn))} |\n`;
    }
    md += '\n## 면적비율 분포 (참고)\n\n| | 양성 중앙값 | 음성 중앙값 | 음성 p90 |\n|---|---|---|---|\n';
    md += `| 원(circle) 면적 | ${f2(median(pos.map(s => s.cf)))} | ${f2(median(neg.map(s => s.cf)))} | ${f2(pct(neg.map(s => s.cf), .9))} |\n`;
    md += `| 폴리곤 면적 | ${f2(median(pos.map(s => s.pf)))} | ${f2(median(neg.map(s => s.pf)))} | ${f2(pct(neg.map(s => s.pf), .9))} |\n`;
    md += '\n> 핵심: A(현재)의 오탐율 대비, C~E(폴리곤+면적)에서 오탐율이 얼마나 줄고 재현율은 얼마나 유지되는가.\n';

    try { fs.writeFileSync(path.join(__dirname, 'reports', 'POLYGON_ab.md'), md); } catch (_) {}
    console.log('\n' + md);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
