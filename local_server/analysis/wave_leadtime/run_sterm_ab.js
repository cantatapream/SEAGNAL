'use strict';
/**
 * run_sterm_ab.js — 거친 폴리곤(warn_zones) vs 정밀 폴리곤(sterm) 실증 A/B.
 *
 *   같은 표본(과거 풍랑 발효=양성, ±24h 잔잔 구역=음성)·같은 프레임에서
 *   warn_zones 폴리곤과 sea_sterm_zones 폴리곤의 "구역 내 임계초과 면적비율·최대밴드"를
 *   각각 산출해, 발효판정 규칙별 재현율(양성 적중)·오탐율(음성 헛발효)을 비교한다.
 *   캐시 GIF만 사용(오프라인). 풍속 신호(≥20kt) 기준, lead 24h.
 *
 *   결론 판정:
 *     - sterm 이 같은 재현율에서 오탐율을 낮추거나, 같은 오탐율에서 재현율을 높이면 → 교체 이득.
 *     - 재현율↓·오탐율↑ 면 → 교체 보류(정밀≠항상 우수).
 *
 * 실행: node analysis/wave_leadtime/run_sterm_ab.js [--maxev=80]
 * 산출: reports/STERM_ab.md
 */
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { CALIB, OFFICE_CHART, decode } = require('./geoCalib');
const { resolveZone, ZONES } = require('./zones');
const { getStaticMask } = require('./staticMask');
const windPalette = require('./windPalette');
const { REGIONAL_OFFICES } = require('./chartClient');
const { loadZonePolygons, zonePixelIndices, analyzeByIndices, normName } = require('./zonePolygon');

const GIF = path.join(__dirname, 'cache', 'gif');
const CSV = path.join(__dirname, 'data', 'warnings_2023-2026.csv');
const OUT = path.join(__dirname, 'out');
const STERM = path.resolve(__dirname, '..', '..', 'assets', 'sea_sterm_zones.geojson');
const LEAD = 24;
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const MAX_EV = args.maxev ? +args.maxev : 80;
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };

function calibAdapter(code) { const c = CALIB[code]; if (!c) return null; return { xOf: lon => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: lat => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; }
const loadGif = fn => { const p = path.join(GIF, fn); return fs.existsSync(p) ? fs.readFileSync(p) : null; };
const sort = a => a.slice().sort((x, y) => x - y);
const median = a => { if (!a.length) return null; const s = sort(a); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return null; const s = sort(a); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f2 = x => x == null ? '-' : (x * 100).toFixed(1) + '%';

(async () => {
    const warnMap = loadZonePolygons();
    const stermMap = loadZonePolygons(STERM, { nameKeys: ['sterm_parent'], aliases: new Map([['경기북부앞바다', '인천경기북부앞바다']]) });
    console.error(`[ab] warn ${warnMap.size} zones · sterm ${stermMap.size} zones`);

    const pos = [], neg = []; // {wb,wf,sb,sf} = warnBand/warnFrac/stermBand/stermFrac
    let bothCov = 0, warnOnly = 0, stermOnly = 0, neither = 0;

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
        const zoneWarnTimes = new Map();
        for (const e of evs) {
            const k = e.effectiveAt.toISOString(); if (!areasByT.has(k)) areasByT.set(k, new Set());
            e.seaAreas.forEach(a => { areasByT.get(k).add(a); const n = normName(a); if (!zoneWarnTimes.has(n)) zoneWarnTimes.set(n, []); zoneWarnTimes.get(n).push(e.effectiveAt.getTime()); });
        }
        const DAY = 24 * 3600 * 1000;
        const isZoneCalmAt = (zname, tms) => { const arr = zoneWarnTimes.get(normName(zname)); if (!arr) return true; for (const wt of arr) if (Math.abs(wt - tms) <= DAY) return false; return true; };
        const chartZones = ZONES.filter(z => { const cx = cal.xOf(z.lon), cy = cal.yOf(z.lat); return cx >= cal.frame.x0 && cx <= cal.frame.x1 && cy >= cal.frame.y0 && cy <= cal.frame.y1; });

        // 폴리곤 픽셀 인덱스 캐시(구역×소스 1회)
        const wIdxC = new Map(), sIdxC = new Map();
        const idxOf = (cache, map, zname, dec) => {
            if (cache.has(zname)) return cache.get(zname);
            const polys = map.get(normName(zname));
            const idx = polys ? zonePixelIndices(cal, polys, dec.w, dec.h) : null;
            cache.set(zname, idx); return idx;
        };
        const fracOf = (dec, idx) => { if (!idx || !idx.length) return null; const a = analyzeByIndices(dec, idx, { mask: m, classify: windPalette.classify, ge3Level: 20, ge5Level: 40, minBandPixels: 12 }); return a ? { frac: a.areaFraction, band: a.maxBand } : null; };

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
            const push = (z, sink) => {
                const w = fracOf(dec, idxOf(wIdxC, warnMap, z.name, dec));
                const s = fracOf(dec, idxOf(sIdxC, stermMap, z.name, dec));
                if (w && s) { sink.push({ wb: w.band, wf: w.frac, sb: s.band, sf: s.frac }); bothCov++; }
                else if (w && !s) warnOnly++; else if (!w && s) stermOnly++; else neither++;
            };
            for (const z of [...areas].map(resolveZone).filter(Boolean)) push(z, pos);
            for (const z of chartZones) {
                if (warnedNorm.has(normName(z.name))) continue;
                if (!isZoneCalmAt(z.name, tms)) continue;
                push(z, neg);
            }
        }
        console.error(`[ab] ${code}: events ${ev}, frames ${decCache.size}`);
    }

    const rate = (arr, fn) => arr.length ? arr.filter(fn).length / arr.length : null;
    // 동일 게이트를 warn / sterm 각각에 적용
    const gates = [[25, 0.30], [25, 0.40], [25, 0.50], [30, 0.30]];
    let md = '# 거친(warn) vs 정밀(sterm) 폴리곤 A/B — 풍속, lead 24h\n\n';
    md += `표본(양쪽 폴리곤 모두 보유): 양성 ${pos.length} · 음성(±24h 잔잔) ${neg.length}\n`;
    md += `커버리지: both ${bothCov} · warn만 ${warnOnly} · sterm만 ${stermOnly} · 둘다없음 ${neither}\n\n`;
    md += '| 게이트(밴드&면적) | 소스 | 재현율(양성 적중) | **오탐율(음성 헛발효)** |\n|---|---|---|---|\n';
    for (const [b, a] of gates) {
        const wfn = s => s.wb >= b && s.wf >= a;
        const sfn = s => s.sb >= b && s.sf >= a;
        md += `| ≥${b}kt & 면적≥${a * 100}% | warn(거침) | ${f2(rate(pos, wfn))} | ${f2(rate(neg, wfn))} |\n`;
        md += `| ≥${b}kt & 면적≥${a * 100}% | **sterm(정밀)** | ${f2(rate(pos, sfn))} | ${f2(rate(neg, sfn))} |\n`;
    }
    md += '\n## 면적비율 분포 (참고)\n\n| 폴리곤 | 양성 중앙값 | 음성 중앙값 | 음성 p90 |\n|---|---|---|---|\n';
    md += `| warn(거침) | ${f2(median(pos.map(s => s.wf)))} | ${f2(median(neg.map(s => s.wf)))} | ${f2(pct(neg.map(s => s.wf), .9))} |\n`;
    md += `| sterm(정밀) | ${f2(median(pos.map(s => s.sf)))} | ${f2(median(neg.map(s => s.sf)))} | ${f2(pct(neg.map(s => s.sf), .9))} |\n`;
    md += '\n## 밴드 분포 (참고)\n\n| 폴리곤 | 양성 중앙밴드 | 음성 중앙밴드 |\n|---|---|---|\n';
    md += `| warn(거침) | ${median(pos.map(s => s.wb))} | ${median(neg.map(s => s.wb))} |\n`;
    md += `| sterm(정밀) | ${median(pos.map(s => s.sb))} | ${median(neg.map(s => s.sb))} |\n`;
    md += '\n> 판정: 같은 게이트에서 sterm 의 오탐율이 warn 보다 낮으면서 재현율이 유지/개선되면 교체 이득. 아니면 보류.\n';

    try { fs.writeFileSync(path.join(__dirname, 'reports', 'STERM_ab.md'), md); } catch (_) {}
    console.log('\n' + md);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
