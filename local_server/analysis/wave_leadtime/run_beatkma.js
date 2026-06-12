'use strict';
/**
 * run_beatkma.js — "기상청보다 먼저 잡았나" 평가 (사용자 평가철학 반영).
 *
 *  사건마다 기상청 '첫 신호' 시각을 정한다:
 *    kmaFirst = min(예비특보 발표시각[구역,창내], 특보 발표시각)
 *      · 예비 있으면 → 예비 발표보다 먼저여야 가치 (예비 후 탐지는 무의미)
 *      · 예비 없으면(=무예비 발효) → 특보 발표(≈발효−2h)보다 먼저여야 가치
 *  우리 '첫 탐지 가용시각' = 운영점(폴리곤+면적) 으로 그 구역 onset 을 잡은
 *    가장 이른 run 의 가용시각(run 슬롯 + 발표지연). 캐시 프레임만 사용(다운로드 0).
 *  beat = ourFirstAvail < kmaFirst. 리드 = (kmaFirst − ourFirstAvail)/h.
 *
 *  실행: node run_beatkma.js [--band=25] [--area=0.30]
 *  산출: reports/BEATKMA.md
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
const CSVS = ['warnings_2023-2026.csv'].map(f => path.join(__dirname, 'data', f));
const EVENTS = path.join(__dirname, 'out', 'prelim_events.json');
const OUT_MD = path.join(__dirname, 'reports', 'BEATKMA.md');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const BAND = args.band ? +args.band : 25;
const AREA = args.area ? +args.area : 0.30;

const H = 3600 * 1000, PUB_DELAY_H = 7, GRACE_H = 6;
const pad = n => String(n).padStart(2, '0');
const ymdh = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
const calibAdapter = code => { const c = CALIB[code]; if (!c) return null; return { xOf: lon => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: lat => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; };
const OFFICES = ['jeju', 'busn', 'gwju', 'gawn', 'dajn'];
// run 슬롯들(KST 09/21)을 queryAt 이전으로 maxBack 개
function runSlotsBefore(queryAt, maxBack = 8) {
    const d = new Date(queryAt - PUB_DELAY_H * H); d.setMinutes(0, 0, 0);
    while (!(d.getHours() === 9 || d.getHours() === 21)) d.setHours(d.getHours() - 1);
    const out = []; for (let i = 0; i < maxBack; i++) { out.push(d.getTime()); d.setHours(d.getHours() - 12); } return out;
}

(async () => {
    const polyMap = loadZonePolygons();

    // 1) 풍랑 발효 에피소드 (zone, t_eff, 특보발표 announceAt) — 24h dedup, 차트가용 2023-05+
    const evs = [];
    for (const csv of CSVS) { if (!fs.existsSync(csv)) continue; for (const e of parseWarnings(csv, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) })) if (e.effectiveAt && e.announceAt) evs.push(e); }
    const rows = [];
    for (const e of evs) for (const a of e.seaAreas) { const z = normName(a); if (polyMap.has(z)) rows.push({ zone: z, tEff: e.effectiveAt.getTime(), tAnn: e.announceAt.getTime() }); }
    rows.sort((a, b) => a.tEff - b.tEff);
    const lastByZone = new Map(); const episodes = [];
    for (const r of rows) { const lt = lastByZone.get(r.zone); if (lt != null && r.tEff - lt <= 24 * H) { lastByZone.set(r.zone, r.tEff); continue; } lastByZone.set(r.zone, r.tEff); episodes.push(r); }

    // 2) 예비특보 발표시각(구역별)
    const preByZone = new Map();
    try { for (const ep of JSON.parse(fs.readFileSync(EVENTS, 'utf8'))) { if (ep.kind !== '풍랑') continue; if (!preByZone.has(ep.zone)) preByZone.set(ep.zone, []); preByZone.get(ep.zone).push(ep.announceAt); } } catch (_) {}
    for (const arr of preByZone.values()) arr.sort((a, b) => a - b);

    // 3) 사건별 kmaFirst + 분류
    for (const ep of episodes) {
        const pres = (preByZone.get(ep.zone) || []).filter(p => p >= ep.tEff - 72 * H && p <= ep.tEff + 2 * H);
        ep.hasPrelim = pres.length > 0;
        ep.kmaFirst = ep.hasPrelim ? Math.min(ep.tAnn, pres[0]) : ep.tAnn; // 무예비면 특보발표
    }

    // 4) 프레임 매칭: 각 에피소드, kmaFirst 이전 run 들에서 valid≈tEff 프레임 → onset 탐지여부
    function frameFor(zone, runBase, tEff) {
        const fnSlot = ymdh(new Date(runBase - 9 * H)); // 캐시 GIF 파일명은 UTC 베이스(00/12)
        const rawStep = Math.round((tEff - runBase) / H / 3) * 3;
        for (const dlt of [0, 3, -3, 6, -6]) { const s = rawStep + dlt; if (s < 0 || s > 120) continue; for (const office of OFFICES) { const fn = `kim_cww3_${office}_wind_s${pad(s).padStart(3, '0')}_${fnSlot}.gif`; if (fs.existsSync(path.join(GIF, fn))) return { office, fn }; } }
        return null;
    }
    // 에피소드별 (가장 이른 탐지 run) 찾기 위한 평가작업 수집 → 프레임 단위 그룹
    const work = []; // {ep, runBase, office, fn}
    for (const ep of episodes) {
        ep.cands = [];
        for (const runBase of runSlotsBefore(ep.kmaFirst, 8)) {
            const f = frameFor(ep.zone, runBase, ep.tEff);
            if (f) ep.cands.push({ runBase, office: f.office, fn: f.fn });
        }
        if (ep.cands.length) { ep.cov = true; for (const c of ep.cands) work.push({ ep, ...c }); } else ep.cov = false;
    }

    const masks = {};
    for (const office of OFFICES) { try { const meta = REGIONAL_OFFICES[OFFICE_CHART[office] || office]; const prefix = (meta.prefixKIM || meta.prefixAPPM).replace('_wave_', '_wind_'); const mk = await getStaticMask(OFFICE_CHART[office] || office, meta, { signal: 'wind', classify: windPalette.classify, ge3Level: 20, prefix }); masks[office] = mk && mk.mask; } catch (_) { masks[office] = null; } }

    const byFrame = new Map();
    for (const w of work) { if (!byFrame.has(w.fn)) byFrame.set(w.fn, []); byFrame.get(w.fn).push(w); }
    const idxCache = new Map(); let dn = 0;
    for (const [fn, group] of byFrame) {
        let dec; try { dec = decode(fs.readFileSync(path.join(GIF, fn))); } catch (_) { continue; }
        for (const w of group) {
            const key = w.office + '|' + w.ep.zone; let idx = idxCache.get(key);
            if (idx === undefined) { const cal = calibAdapter(OFFICE_CHART[w.office] || w.office); const polys = polyMap.get(w.ep.zone); idx = (cal && polys) ? zonePixelIndices(cal, polys, dec.w, dec.h) : null; idxCache.set(key, idx); }
            if (!idx || !idx.length) continue;
            const a = analyzeByIndices(dec, idx, { mask: masks[w.office], classify: windPalette.classify, ge3Level: 20, ge5Level: 40, minBandPixels: 12 });
            if (a && a.maxBand >= BAND && a.areaFraction >= AREA) {
                // 이 run 에서 탐지 — 가용시각 = runBase + 발표지연
                const avail = w.runBase + PUB_DELAY_H * H;
                if (w.ep.ourFirstAvail == null || avail < w.ep.ourFirstAvail) w.ep.ourFirstAvail = avail;
            }
        }
        if (++dn % 200 === 0) console.error(`[beatkma] 프레임 ${dn}/${byFrame.size}`);
    }

    // 5) 집계
    for (const ep of episodes) {
        ep.detected = ep.ourFirstAvail != null;
        ep.beat = ep.detected && ep.ourFirstAvail < ep.kmaFirst;
        ep.leadH = ep.beat ? (ep.kmaFirst - ep.ourFirstAvail) / H : null;
    }
    const evalable = episodes.filter(e => e.cov);
    const withP = evalable.filter(e => e.hasPrelim), noP = evalable.filter(e => !e.hasPrelim);
    const med = arr => { const s = arr.filter(x => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const pc = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '-';
    const f1 = v => v == null ? '-' : v.toFixed(1);
    const grp = arr => ({ n: arr.length, beat: arr.filter(e => e.beat).length, lead: med(arr.map(e => e.leadH)) });
    const gw = grp(withP), gn = grp(noP), ga = grp(evalable);

    let md = `# 기상청보다 먼저 탐지했나 (beatKMA) — 운영점 밴드≥${BAND}kt · 면적≥${AREA * 100}%\n\n`;
    md += `풍랑 발효 에피소드 ${episodes.length} · 캐시평가가능 ${evalable.length} (${pc(evalable.length, episodes.length)})\n\n`;
    md += '| 사건 분류 | 표본 | 기상청보다 먼저 | 리드 중앙(h) | 의미 |\n|---|---|---|---|---|\n';
    md += `| **무예비 발효** (특보발표보다 먼저) | ${gn.n} | **${pc(gn.beat, gn.n)}** | ${f1(gn.lead)} | 헤드라인 — 기상청 공백을 메움 |\n`;
    md += `| 예비 있던 발효 (예비발표보다 먼저) | ${gw.n} | ${pc(gw.beat, gw.n)} | ${f1(gw.lead)} | 예비조차 앞지른 비율 |\n`;
    md += `| 전체 | ${ga.n} | ${pc(ga.beat, ga.n)} | ${f1(ga.lead)} | |\n\n`;
    md += '## 해석\n\n';
    md += `- 무예비 발효(전체의 ~46%)에서 **${pc(gn.beat, gn.n)}** 를 특보 발표보다 먼저 포착 — 기상청이 어떤 정보도 안 줬을 때 우리가 선행 경고.\n`;
    md += `- 예비 있던 사건은 기상청이 이미 평균 24h 전 예비를 내므로, 그조차 앞지른 ${pc(gw.beat, gw.n)} 만 추가가치(나머지는 예비가 더 빠름 — 무의미 구간).\n`;
    md += `\n## 한계(정직)\n\n- 캐시평가가능 ${pc(evalable.length, episodes.length)} — kmaFirst 이전 run 의 일기도가 캐시에 있어야 채점. 없으면 제외(표본편향 가능).\n- 운영점(밴드/면적)은 calib_abs 게이트와 동일. 면적 50% 등 더 보수적 운영점은 --area 로 비교.\n`;
    fs.writeFileSync(OUT_MD, md);
    console.log('\n' + md);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
