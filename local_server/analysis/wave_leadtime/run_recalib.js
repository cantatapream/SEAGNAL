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
const PUB_DELAY_H = 7;
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const ONLY = args.office || null;                       // 청별 실행(예: --office=jeju)
const POSCAP = args.poscap ? +args.poscap : (ONLY ? 100000 : 120); // 청별이면 전 이벤트 사용
// 발효 5일 전부터 전 시점 스캔(이미지↔발효 매칭). leadtime JSON 에 12~120h 프레임 캐시됨.
const LEADS = (args.leads ? String(args.leads).split(',') : ['12', '24', '48', '72', '96', '120']).map(Number);
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
        if (ONLY && code !== ONLY) continue;
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
        // 발효 5일 전부터 전 시점(LEADS) × 전 이벤트 전수. 각 lead 프레임을 디코드해 폴리곤/원 동시 분석.
        const usable = results.filter(r => areasByT.get(r.effectiveAt) && LEADS.some(L => { const rc = r.leads[L]; return rc && rc.ok && rc.frame; }));
        let nev = 0;
        for (const r of usable) {
            if (nev >= POSCAP) break;
            const tt = new Date(r.effectiveAt), tms = tt.getTime();
            const areas = areasByT.get(r.effectiveAt); const warnedNorm = new Set([...areas].map(normName));
            const warned = [...areas].map(resolveZone).filter(Boolean);
            let used = false;
            for (const L of LEADS) {
                const rc = r.leads[L]; if (!rc || !rc.ok || !rc.frame) continue;
                const b = loadGif(rc.frame); if (!b) continue;
                let dec; try { dec = decode(b); } catch (_) { continue; }
                used = true;
                for (const z of warned) { const f = feat(dec, z); if (f) samples.push({ time: tt, label: 1, lead: L, ...f }); }
                for (const z of chartZones) { if (warnedNorm.has(normName(z.name))) continue; if (!isZoneCalmAt(z.name, tms)) continue; const f = feat(dec, z); if (f) samples.push({ time: tt, label: 0, lead: L, ...f }); }
            }
            if (used) nev++;
            if (nev % 50 === 0) console.error(`[recalib] ${code}: ${nev}/${usable.length} 이벤트, 표본 ${samples.length}`);
        }
        console.error(`[recalib] ${code}: 이벤트 ${nev}, 표본 ${samples.length} (lead ${LEADS.join('/')}h)`);
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

const pc = x => x == null ? '-' : (x * 100).toFixed(0) + '%';
const pc1 = x => x == null ? '-' : (x * 100).toFixed(1) + '%';
const med = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p90 = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(.9 * s.length)]; };

// ── 리포트 렌더 (전체 + 2026 홀드아웃 + 청별) ────────────────────────────────
function renderReport(all, byOffice) {
    const evalOn = (set, fn) => { const pos = set.filter(s => s.label), neg = set.filter(s => !s.label); return { recall: pos.length ? pos.filter(fn).length / pos.length : null, fp: neg.length ? neg.filter(fn).length / neg.length : null }; };
    const curCurve = [18, 20, 22, 25, 28, 30, 33, 36].map(bt => ({ name: `원·밴드≥${bt}kt`, fn: s => s.cb >= bt }));
    const newPts = [];
    for (const bt of [18, 20, 22, 25, 28, 30]) for (const at of [0, .1, .2, .3, .4, .5, .6]) newPts.push({ name: `폴·밴드≥${bt}&면적≥${(at * 100) | 0}%`, fn: s => s.pb >= bt && s.pf >= at });
    const curveOf = (set, defs) => defs.map(d => ({ name: d.name, ...evalOn(set, d.fn) })).filter(p => p.recall != null && p.fp != null);
    const minFPatRecall = (curve, t) => { const ok = curve.filter(p => p.recall >= t); if (!ok.length) return null; return ok.reduce((a, b) => b.fp < a.fp ? b : a); };
    const section = (title, set) => {
        const cc = curveOf(set, curCurve), nc = curveOf(set, newPts);
        let s = `\n## ${title} (양성 ${set.filter(x => x.label).length} · 음성 ${set.filter(x => !x.label).length})\n\n`;
        s += '| 목표 재현율 | 현재식 최소 오탐 | 신방식 최소 오탐 | 오탐감소 |\n|---|---|---|---|\n';
        for (const tgt of [0.8, 0.7, 0.6, 0.5]) {
            const c = minFPatRecall(cc, tgt), n = minFPatRecall(nc, tgt);
            const red = (c && n) ? (c.fp - n.fp) : null;
            s += `| ≥${(tgt * 100) | 0}% | ${c ? pc1(c.fp) + ' (' + c.name + ',재현' + pc(c.recall) + ')' : '-'} | ${n ? pc1(n.fp) + ' (' + n.name + ',재현' + pc(n.recall) + ')' : '-'} | ${red != null ? pc1(red) : '-'} |\n`;
        }
        return s;
    };
    let md = '# 재검증 — 현재식(원+밴드) vs 신방식(폴리곤+면적)\n\n';
    md += `풍속 ge3=20kt, lead24h. 음성=±24h 잔잔(거친날씨 인근). 표본 ${all.length} (양성 ${all.filter(s => s.label).length}/음성 ${all.filter(s => !s.label).length}).\n`;
    md += '\n> 같은 재현율서 오탐(잔잔 헛발효) 작을수록 우수. "오탐감소" 양수=신방식 우월.\n';
    md += section('■ 전체(전 청 합산)', all);
    md += section('■ 2026 홀드아웃', all.filter(s => s.time >= SPLIT));

    // 발효 전 시점별(5일~12h) 탐지율/오탐 — 운영점 고정 비교
    const ruleC = s => s.cb >= 25, ruleP = s => s.pb >= 25 && s.pf >= 0.30;
    const atLead = (set, L, rule) => { const ss = set.filter(s => s.lead === L); const pos = ss.filter(s => s.label), neg = ss.filter(s => !s.label); return { recall: pos.length ? pos.filter(rule).length / pos.length : null, fp: neg.length ? neg.filter(rule).length / neg.length : null, npos: pos.length }; };
    const leadsPresent = [...new Set(all.map(s => s.lead).filter(v => v != null))].sort((a, b) => b - a);
    if (leadsPresent.length) {
        md += '\n## 발효 전 시점별 탐지/오탐 (5일~12h 전, 운영점 고정: 원 밴드≥25 / 폴 밴드≥25&면적≥30%)\n\n';
        md += '| 발효 전 | 표본(양성) | 현재식 탐지 | 현재식 오탐 | 신방식 탐지 | 신방식 오탐 |\n|---|---|---|---|---|---|\n';
        for (const L of leadsPresent) { const c = atLead(all, L, ruleC), n = atLead(all, L, ruleP); md += `| ${L}h(${(L / 24).toFixed(L % 24 ? 1 : 0)}일) | ${c.npos} | ${pc(c.recall)} | ${pc1(c.fp)} | ${pc(n.recall)} | ${pc1(n.fp)} |\n`; }
        md += '\n> 발효에 가까워질수록(아래로) 탐지율↑. 신방식이 같은 시점서 오탐을 낮추면 우월.\n';
    }

    // ── 발표시각 기준 시점별(발표 N시간 전) — 같은 프레임에서 발표→발효 간격만큼 보정 ──
    const aB = [['~12h(0.5일)', a => a >= 0 && a < 18], ['~24h(1일)', a => a >= 18 && a < 36], ['~48h(2일)', a => a >= 36 && a < 60], ['~72h(3일)', a => a >= 60 && a < 84], ['~96h(4일)', a => a >= 84]];
    if (all.some(s => s.alead != null)) {
        const atA = (set, f2, rule) => { const ss = set.filter(s => s.alead != null && f2(s.alead)); const pos = ss.filter(s => s.label), neg = ss.filter(s => !s.label); return { recall: pos.length ? pos.filter(rule).length / pos.length : null, fp: neg.length ? neg.filter(rule).length / neg.length : null, npos: pos.length }; };
        md += '\n## 발표시각 기준 시점별 탐지/오탐 (발표 N시간 전, 운영점 고정)\n\n';
        md += '| 발표 전 | 표본(양성) | 현재식 탐지 | 현재식 오탐 | 신방식 탐지 | 신방식 오탐 |\n|---|---|---|---|---|---|\n';
        for (const [name, f2] of aB) { const c = atA(all, f2, ruleC), n = atA(all, f2, ruleP); md += `| ${name} | ${c.npos} | ${pc(c.recall)} | ${pc1(c.fp)} | ${pc(n.recall)} | ${pc1(n.fp)} |\n`; }
        md += '\n> KMA 발표보다 일찍(위쪽 시점서도) 탐지할수록 선제적. 발표 후(음수 lead)는 제외.\n';
    }
    if (byOffice) for (const code of Object.keys(byOffice).sort()) {
        md += section(`▷ ${code} 전체`, byOffice[code]);
        md += section(`▷ ${code} 2026`, byOffice[code].filter(s => s.time >= SPLIT));
    }
    const P = all.filter(s => s.label), N = all.filter(s => !s.label);
    md += `\n## 참고 — 폴리곤 면적비율(전체)\n\n양성 중앙 ${pc1(med(P.map(s => s.pf)))} · 음성 중앙 ${pc1(med(N.map(s => s.pf)))} · 음성 p90 ${pc1(p90(N.map(s => s.pf)))}\n`;
    md += '\n## C(절대 확률표) 주의: 오프라인 캐시엔 잔잔날 프레임이 없어 배포용 절대 확률표는 KMA 자격증명 환경의 잔잔표본으로 마무리 필요. 본 검증은 "동일 재현율서 오탐 감소"를 증명.\n';
    return md;
}

(async () => {
    if (args.aggregate) {                       // 청별 덤프 집계 → 전국 + 청별 리포트
        const files = fs.readdirSync(OUT).filter(f => /^recalib_samples_.+\.json$/.test(f));
        const byOffice = {}; const all = [];
        for (const f of files) {
            const code = f.match(/^recalib_samples_(.+)\.json$/)[1];
            // 발표시각 매핑: 그 청의 발효시각ms → 가장 이른 발표시각ms (발표기준 lead 유도용)
            const region = OFFICES[code]; const annMap = new Map();
            if (region) { for (const e of parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) }).filter(e => e.officeRegion === region && e.effectiveAt && e.announceAt && e.level === '주의보')) { const k = e.effectiveAt.getTime(), a = e.announceAt.getTime(); if (!annMap.has(k) || a < annMap.get(k)) annMap.set(k, a); } }
            const arr = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')).map(s => {
                const ann = annMap.get(s.t);
                const alead = (ann != null && s.lead != null) ? s.lead - (s.t - ann) / 3600000 : null; // 발표 N시간 전
                return { time: new Date(s.t), label: s.label, cb: s.cb, pb: s.pb, pf: s.pf, lead: s.lead, alead };
            });
            byOffice[code] = arr; all.push(...arr);
        }
        console.error(`[aggregate] ${files.length}청 합산, 표본 ${all.length}`);
        const md = renderReport(all, byOffice);
        try { fs.writeFileSync(path.join(__dirname, 'reports', 'RECALIB_national.md'), md); } catch (_) {}
        console.log(md); return;
    }
    const all = await collect();                // ONLY 지정 시 그 청만
    if (ONLY) { try { fs.writeFileSync(path.join(OUT, `recalib_samples_${ONLY}.json`), JSON.stringify(all.map(s => ({ t: s.time.getTime(), label: s.label, cb: s.cb, pb: s.pb, pf: s.pf, lead: s.lead })))); } catch (_) {} }
    const md = renderReport(all, ONLY ? { [ONLY]: all } : null);
    try { fs.writeFileSync(path.join(__dirname, 'reports', `RECALIB_${ONLY || 'all'}.md`), md); } catch (_) {}
    console.log(md);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
