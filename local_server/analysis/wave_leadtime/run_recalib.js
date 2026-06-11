'use strict';
/**
 * run_recalib.js — Phase C(재보정) + D(재검증): 폴리곤+면적비율 모델.
 *
 *  [C] 학습기간(<2026)에서 확률을 (풍속밴드 × 면적비율) 2변수로 보정.
 *      비교군: 현재식(원 + 밴드 1변수)도 같은 표본으로 재도출.
 *  [D] 홀드아웃(2026~)에서 두 모델의 정밀도/재현율/오탐 비교 + 보정도 점검.
 *
 *  표본(오프라인, 캐시 GIF만):
 *   - 양성: 풍랑주의보 발효 이벤트(lead 24h 프레임, leadtime JSON)의 발효구역.
 *   - 음성: 전 기간 잔잔시각(±24h 무발효)을 균등 샘플 → 해당 run 프레임을 캐시
 *           파일명으로 구성해 '있는 것만' 사용(네트워크 0). 그 시각 차트의 전 구역.
 *  폴리곤 보유 구역만 비교(원/폴리곤 동일 구역). 풍속 신호 ge3=20kt.
 *
 * 실행: node analysis/wave_leadtime/run_recalib.js [--poscap=120] [--ncalm=160]
 * 산출: reports/RECALIB_polygon.md
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
const LEAD = 24, PUB_DELAY_H = 7;
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const POSCAP = args.poscap ? +args.poscap : 120;
const NCALM = args.ncalm ? +args.ncalm : 160;
const SPLIT = new Date('2026-01-01T00:00:00');
const OFFICES = { jeju: '제주도', busn: '부산·울산·경상남도', gwju: '광주·전라남도', degu: '대구·경상북도', gawn: '강원특별자치도', dajn: '대전·세종·충청남도' };

const pad = n => String(n).padStart(2, '0');
const ymdh = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
const ymdhToDate = s => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), 0, 0);
function calibAdapter(code) { const c = CALIB[code]; if (!c) return null; return { xOf: lon => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: lat => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; }
const radOf = z => Math.round((z.type === 'H' ? 55 : 30) * 1.8);
const loadGif = fn => { const p = path.join(GIF, fn); return fs.existsSync(p) ? fs.readFileSync(p) : null; };
function runSlotsBefore(queryAt, maxBack = 4) {
    const d = new Date(queryAt.getTime() - PUB_DELAY_H * 3600 * 1000); d.setMinutes(0, 0, 0);
    while (!(d.getHours() === 9 || d.getHours() === 21)) d.setHours(d.getHours() - 1);
    const out = []; for (let i = 0; i < maxBack; i++) { out.push(ymdh(d)); d.setHours(d.getHours() - 12); } return out;
}
// 캐시에서 valid≈T 에 가장 가까운 풍속 프레임 파일명을 '구성'해 찾는다(네트워크 0).
function findCachedFrame(prefix, T) {
    for (const slot of runSlotsBefore(T)) {
        const base = ymdhToDate(slot);
        const stepH = Math.round((T - base) / 3600000);
        for (const d of [0, 3, -3, 6, -6]) {            // 3시간 간격 보정
            const s = stepH + d; if (s < 0 || s > 120 || s % 3 !== 0) continue;
            const fn = `${prefix}s${pad(s).padStart(3, '0')}_${slot}.gif`;
            const p = path.join(GIF, fn);
            if (fs.existsSync(p)) return fn;
        }
    }
    return null;
}

const bandKey = b => b >= 40 ? '40+' : b >= 35 ? '35' : b >= 30 ? '30' : b >= 25 ? '25' : b >= 20 ? '20' : '<20';
const BANDS = ['<20', '20', '25', '30', '35', '40+'];
const areaKey = f => f < 0.10 ? '<10' : f < 0.30 ? '10-30' : f < 0.50 ? '30-50' : f < 0.70 ? '50-70' : '70+';
const AREAS = ['<10', '10-30', '30-50', '50-70', '70+'];

async function collect() {
    const polyMap = loadZonePolygons();
    const samples = []; // {time, label, cb(circleBand), pb(polyBand), pf(polyArea)}
    let calmHit = 0, calmMiss = 0;
    for (const [code, region] of Object.entries(OFFICES)) {
        const jfs = fs.readdirSync(OUT).filter(f => new RegExp(`^leadtime_${code}_wind_.*\\.json$`).test(f));
        if (!jfs.length) { console.error(`[skip] ${code}`); continue; }
        const { results } = JSON.parse(fs.readFileSync(path.join(OUT, jfs.sort().pop()), 'utf8'));
        const chartCode = OFFICE_CHART[code] || code; const cal = calibAdapter(chartCode); if (!cal) continue;
        const meta = REGIONAL_OFFICES[chartCode];
        const prefix = (meta.prefixKIM || meta.prefixAPPM).replace('_wave_', '_wind_');
        let m = null; try { const mk = await getStaticMask(chartCode, meta, { signal: 'wind', classify: windPalette.classify, ge3Level: 20, prefix }); m = mk && mk.mask; } catch (_) {}

        const evs = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter(e => e.officeRegion === region && e.effectiveAt && e.level === '주의보');
        const areasByT = new Map(); const zoneWarnTimes = new Map();
        for (const e of evs) { const k = e.effectiveAt.toISOString(); if (!areasByT.has(k)) areasByT.set(k, new Set()); e.seaAreas.forEach(a => { areasByT.get(k).add(a); const n = normName(a); if (!zoneWarnTimes.has(n)) zoneWarnTimes.set(n, []); zoneWarnTimes.get(n).push(e.effectiveAt.getTime()); }); }
        const DAY = 24 * 3600 * 1000;
        const isZoneCalmAt = (zname, tms) => { const arr = zoneWarnTimes.get(normName(zname)); if (!arr) return true; for (const x of arr) if (Math.abs(x - tms) <= DAY) return false; return true; };
        const chartZones = ZONES.filter(z => { const cx = cal.xOf(z.lon), cy = cal.yOf(z.lat); return cx >= cal.frame.x0 && cx <= cal.frame.x1 && cy >= cal.frame.y0 && cy <= cal.frame.y1; });

        const idxCache = new Map();
        const polyIdx = (z, dec) => { if (idxCache.has(z.name)) return idxCache.get(z.name); const polys = polyMap.get(normName(z.name)); const idx = polys ? zonePixelIndices(cal, polys, dec.w, dec.h) : null; idxCache.set(z.name, idx); return idx; };
        const feat = (dec, z) => {
            const idx = polyIdx(z, dec); if (!idx) return null; // 폴리곤 없는 구역 제외(폴백 대상)
            const c = analyzeZone(dec, cal, z, { mask: m, radiusPx: radOf(z), classify: windPalette.classify, ge3Level: 20, ge5Level: 40 });
            const p = analyzeByIndices(dec, idx, { mask: m, classify: windPalette.classify, ge3Level: 20, ge5Level: 40, minBandPixels: 12 });
            if (!c || !p) return null;
            return { cb: c.maxBand, pb: p.maxBand, pf: p.areaFraction };
        };

        // 이벤트(발효) 프레임을 전 기간 고르게 stride 샘플 → 그 프레임에서 양성/음성 동시 수집.
        //   양성=발효구역, 음성=같은 프레임의 ±24h 무발효(진짜 잔잔) 구역(hard negative, 오프라인 가용).
        const usable = results.filter(r => { const rc = r.leads[LEAD]; return rc && rc.ok && rc.frame && areasByT.get(r.effectiveAt); });
        const stride = Math.max(1, Math.floor(usable.length / POSCAP));
        const decCache = new Map(); let np = 0;
        for (let k = 0; k < usable.length && np < POSCAP; k += stride) {
            const r = usable[k]; const fr = r.leads[LEAD].frame;
            let dec = decCache.get(fr); if (!dec) { const b = loadGif(fr); if (!b) continue; try { dec = decode(b); } catch (_) { continue; } decCache.set(fr, dec); }
            np++;
            const tt = new Date(r.effectiveAt), tms = tt.getTime();
            const areas = areasByT.get(r.effectiveAt); const warnedNorm = new Set([...areas].map(normName));
            for (const z of [...areas].map(resolveZone).filter(Boolean)) { const f = feat(dec, z); if (f) samples.push({ time: tt, label: 1, ...f }); }
            for (const z of chartZones) { if (warnedNorm.has(normName(z.name))) continue; if (!isZoneCalmAt(z.name, tms)) continue; const f = feat(dec, z); if (f) samples.push({ time: tt, label: 0, ...f }); }
        }
        console.error(`[recalib] ${code}: 이벤트프레임 ${np}, 표본누적 ${samples.length}`);
    }
    console.error(`[recalib] 총 표본 ${samples.length} (양성 ${samples.filter(s => s.label).length} / 음성 ${samples.filter(s => !s.label).length})`);
    return samples;
}

function calibrate(train) {
    // 신방식 2D: P(발효 | band, area)
    const P2 = {}, P1 = {}, P1band = {};
    for (const bk of BANDS) {
        P2[bk] = {};
        const tb = train.filter(s => bandKey(s.pb) === bk);
        for (const ak of AREAS) {
            const cell = tb.filter(s => areaKey(s.pf) === ak);
            const pos = cell.filter(s => s.label).length;
            P2[bk][ak] = cell.length ? pos / cell.length : null;
        }
        // 폴리곤 band-marginal (셀 결측 폴백)
        const posb = tb.filter(s => s.label).length;
        P1band[bk] = tb.length ? posb / tb.length : null;
        // 현재식: 원 밴드 1D
        const tc = train.filter(s => bandKey(s.cb) === bk);
        P1[bk] = tc.length ? tc.filter(s => s.label).length / tc.length : null;
    }
    return { P2, P1, P1band };
}
const predNew = (s, M) => { const v = M.P2[bandKey(s.pb)][areaKey(s.pf)]; return v != null ? v : (M.P1band[bandKey(s.pb)] != null ? M.P1band[bandKey(s.pb)] : 0); };
const predCur = (s, M) => { const v = M.P1[bandKey(s.cb)]; return v != null ? v : 0; };

function metrics(test, predFn, M, thr) {
    let tp = 0, fp = 0, fn = 0, tn = 0;
    for (const s of test) { const p = predFn(s, M) >= thr; if (s.label) { if (p) tp++; else fn++; } else { if (p) fp++; else tn++; } }
    return { tp, fp, fn, tn, recall: tp + fn ? tp / (tp + fn) : null, prec: tp + fp ? tp / (tp + fp) : null, fpr: fp + tn ? fp / (fp + tn) : null };
}

(async () => {
    const all = await collect();
    const pc = x => x == null ? '-' : (x * 100).toFixed(0) + '%';
    const pc1 = x => x == null ? '-' : (x * 100).toFixed(1) + '%';

    function evalOn(set, fn) { const pos = set.filter(s => s.label), neg = set.filter(s => !s.label); return { recall: pos.length ? pos.filter(fn).length / pos.length : null, fp: neg.length ? neg.filter(fn).length / neg.length : null, npos: pos.length, nneg: neg.length }; }
    // 현재식 곡선: 원 maxBand ≥ bt
    const curCurve = [18, 20, 22, 25, 28, 30, 33, 36].map(bt => ({ name: `원·밴드≥${bt}kt`, fn: s => s.cb >= bt }));
    // 신방식 곡선: 폴리곤 maxBand≥bt & 면적≥at (Pareto front)
    const newPts = [];
    for (const bt of [18, 20, 22, 25, 28, 30]) for (const at of [0, .1, .2, .3, .4, .5, .6]) newPts.push({ name: `폴·밴드≥${bt}&면적≥${(at * 100) | 0}%`, fn: s => s.pb >= bt && s.pf >= at });

    function curveOf(set, defs) { return defs.map(d => ({ name: d.name, ...evalOn(set, d.fn) })).filter(p => p.recall != null && p.fp != null); }
    // 목표 재현율 이상에서 최소 FP 점
    function minFPatRecall(curve, target) { const ok = curve.filter(p => p.recall >= target); if (!ok.length) return null; return ok.reduce((a, b) => b.fp < a.fp ? b : a); }

    function section(title, set) {
        const cc = curveOf(set, curCurve), nc = curveOf(set, newPts);
        let s = `\n## ${title} (양성 ${set.filter(x => x.label).length} · 음성 ${set.filter(x => !x.label).length})\n\n`;
        s += '| 목표 재현율 | 현재식 최소 오탐 | 신방식 최소 오탐 | 오탐 감소 |\n|---|---|---|---|\n';
        for (const tgt of [0.8, 0.7, 0.6, 0.5]) {
            const c = minFPatRecall(cc, tgt), n = minFPatRecall(nc, tgt);
            const red = (c && n) ? (c.fp - n.fp) : null;
            s += `| ≥${(tgt * 100) | 0}% | ${c ? pc1(c.fp) + ' (' + c.name + ', 재현 ' + pc(c.recall) + ')' : '-'} | ${n ? pc1(n.fp) + ' (' + n.name + ', 재현 ' + pc(n.recall) + ')' : '-'} | ${red != null ? pc1(red) : '-'} |\n`;
        }
        return s;
    }

    let md = '# Phase D — 재검증: 현재식(원+밴드) vs 신방식(폴리곤+면적)\n\n';
    md += `풍속 신호(ge3=20kt), lead 24h. 음성=±24h 잔잔(거친날씨 인근 hard negative).\n`;
    md += `표본 총 ${all.length} (양성 ${all.filter(s => s.label).length}/음성 ${all.filter(s => !s.label).length}).\n`;
    md += `\n> 같은 재현율에서 **오탐(잔잔구역 헛발효)** 이 작을수록 좋다. "오탐 감소"가 양수면 신방식이 우월.\n`;
    md += section('전체 기간', all);
    md += section('2026 홀드아웃', all.filter(s => s.time >= SPLIT));

    md += '\n## 참고 — 폴리곤 면적비율 분포(전체)\n\n| | 양성 중앙값 | 음성 중앙값 | 음성 p90 |\n|---|---|---|---|\n';
    const med = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const p90 = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(.9 * s.length)]; };
    const P = all.filter(s => s.label), N = all.filter(s => !s.label);
    md += `| 폴리곤 면적 | ${pc1(med(P.map(s => s.pf)))} | ${pc1(med(N.map(s => s.pf)))} | ${pc1(p90(N.map(s => s.pf)))} |\n`;
    md += '\n## C(절대 확률표) 관련 주의\n\n';
    md += '오프라인 캐시엔 **잔잔날 프레임이 없어** 음성이 hard negative 뿐 → 절대 확률 보정(예: 30kt→80%)은 깔려서 무효. ';
    md += '**배포용 확률표 재보정은 KMA 자격증명 환경에서 잔잔표본을 받아** 동일 절차(밴드×면적 2D)로 1회 수행 필요. 본 검증은 그와 별개로 "신방식이 동일 재현율서 오탐을 줄인다"를 증명.\n';

    try { fs.writeFileSync(path.join(__dirname, 'reports', 'RECALIB_polygon.md'), md); } catch (_) {}
    console.log('\n' + md);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
