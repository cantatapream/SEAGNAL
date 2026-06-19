'use strict';
/**
 * fetch_hardneg.js — "어려운 음성"(hard negative) 일기도 전수 수집.
 *
 *  정의: 어떤 풍랑 발효 시각 t 에, 그 구역의 차트(청)에 속한 다른 구역들 중
 *        ±12h 내 발효가 없던 구역 = "이웃은 거친데 자기는 발효 안 된" 구역-시각.
 *        → 옛 과탐(원형+최대밴드)이 헛경보를 내던 바로 그 상황. 여기서의 오탐이
 *          운영 신뢰도를 좌우한다. (무작위 잔잔 음성은 fetch_calm.js 가 담당)
 *
 *  수집: 각 hard-neg (zone, t) 의 발효 24h 전 가용 예보 프레임을 다운로드(캐시 채움).
 *        calib_abs.js 가 calm + hardneg 를 음성으로 함께 읽어 진짜 오탐률을 측정.
 *
 *  자격증명: KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD. 천천히(SLEEP_MS), 재개 가능.
 *  실행: KMA_..=.. node fetch_hardneg.js [--cap=4000] [--plan]
 *  산출: out/hardneg_samples.json — [{zone, office, validAt, base, kstSlot, step, fileName, neg:'hard'}]
 */
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { CALIB, OFFICE_CHART } = require('./geoCalib');
const { REGIONAL_OFFICES, listFrames, downloadFrame } = require('./chartClient');
const { loadZonePolygons, zonePixelIndices, normName } = require('./zonePolygon');

const GIF = path.join(__dirname, 'cache', 'gif');
const CACHE = path.join(__dirname, 'cache');
const CSVS = ['warnings_2023-2026.csv'].map(f => path.join(__dirname, 'data', f)); // 차트 가용 2023-05+
const OUT = path.join(__dirname, 'out', 'hardneg_samples.json');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const CAP = args.cap ? +args.cap : 4000;
const PLAN_ONLY = !!args.plan;
const SLEEP_MS = args.sleep ? +args.sleep : 2500;
const PUB_DELAY_H = 7, NEIGHBOR_PAD_H = 12;
const H = 3600 * 1000;
const OFFICES = ['jeju', 'busn', 'gwju', 'gawn', 'dajn'];
const pad = n => String(n).padStart(2, '0');
const ymdh = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const calibAdapter = code => { const c = CALIB[code]; if (!c) return null; return { xOf: lon => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: lat => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; };
function runSlotsBefore(queryAt, maxBack = 3) {
    const d = new Date(queryAt - PUB_DELAY_H * H); d.setMinutes(0, 0, 0);
    while (!(d.getHours() === 9 || d.getHours() === 21)) d.setHours(d.getHours() - 1);
    const out = []; for (let i = 0; i < maxBack; i++) { out.push(d.getTime()); d.setHours(d.getHours() - 12); } return out;
}
function buildZoneOffice(polyMap) {
    const W = 730, Hh = 600, m = new Map();
    for (const [zn, polys] of polyMap) {
        let best = null, bestN = 0;
        for (const o of OFFICES) { const cal = calibAdapter(OFFICE_CHART[o] || o); if (!cal) continue; const idx = zonePixelIndices(cal, polys, W, Hh); const n = idx ? idx.length : 0; if (n > bestN) { bestN = n; best = o; } }
        if (best) m.set(zn, best);
    }
    return m;
}

function planHardNeg(polyMap, zoneOffice) {
    const byOffZones = {}; OFFICES.forEach(o => byOffZones[o] = []);
    for (const [z, o] of zoneOffice) byOffZones[o].push(z);

    // 풍랑 발효 이벤트 (차트 가용 2023-05+)
    const evs = [];
    for (const csv of CSVS) { if (!fs.existsSync(csv)) continue; for (const e of parseWarnings(csv, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) })) if (e.effectiveAt) evs.push(e); }
    // 구역별 발효시각(이웃 발효 판정용)
    const effByZone = new Map();
    for (const e of evs) for (const a of e.seaAreas) { const z = normName(a); if (!polyMap.has(z)) continue; if (!effByZone.has(z)) effByZone.set(z, []); effByZone.get(z).push(e.effectiveAt.getTime()); }
    for (const arr of effByZone.values()) arr.sort((a, b) => a - b);
    const zoneEffNear = (z, t) => (effByZone.get(z) || []).some(x => Math.abs(x - t) <= NEIGHBOR_PAD_H * H);

    // 각 발효 이벤트 t: 같은 청의 다른 구역 중 그 시각 발효 없던 구역 = hard-neg
    const seen = new Set(); const tasks = [];
    for (const e of evs) {
        const t = e.effectiveAt.getTime();
        const warnedOffices = new Set();
        for (const a of e.seaAreas) { const z = normName(a); const o = zoneOffice.get(z); if (o) warnedOffices.add(o); }
        for (const o of warnedOffices) {
            for (const z of byOffZones[o]) {
                if (zoneEffNear(z, t)) continue;          // 그 시각 자기도 발효 → 음성 아님
                const k = z + '|' + dayKey(t);
                if (seen.has(k)) continue; seen.add(k);
                const base = runSlotsBefore(t)[0];
                const step = Math.round((t - base) / H / 3) * 3;
                if (step < 0 || step > 120) continue;
                const kstSlot = ymdh(new Date(base));
                tasks.push({ zone: z, office: o, validAt: t, base, kstSlot, step });
            }
        }
    }
    // 균등 솎기(CAP)
    if (tasks.length > CAP) {
        const stride = tasks.length / CAP; const out = [];
        for (let i = 0; i < CAP; i++) out.push(tasks[Math.floor(i * stride)]);
        return out;
    }
    return tasks;
}

(async () => {
    const polyMap = loadZonePolygons();
    const zoneOffice = buildZoneOffice(polyMap);
    const tasks = planHardNeg(polyMap, zoneOffice);
    const byOff = {}; tasks.forEach(t => byOff[t.office] = (byOff[t.office] || 0) + 1);
    console.error(`[hardneg] 계획 표본 ${tasks.length}건 (cap ${CAP}, office별 ${JSON.stringify(byOff)})`);
    if (PLAN_ONLY) { console.error('[hardneg] --plan: 계획만 출력 후 종료.'); return; }

    let done = []; try { done = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { done = []; }
    const doneKey = new Set(done.map(d => d.zone + '|' + d.kstSlot + '|' + d.step));
    const listMem = new Map();
    async function framesFor(office, kstSlot) {
        const chartCode = OFFICE_CHART[office] || office;
        const key = chartCode + '|' + kstSlot;
        if (listMem.has(key)) return listMem.get(key);
        const disk = path.join(CACHE, `list_${chartCode}_wind_${kstSlot}.json`);
        if (fs.existsSync(disk)) { const v = JSON.parse(fs.readFileSync(disk, 'utf8')); listMem.set(key, v); return v; }
        const meta = REGIONAL_OFFICES[chartCode];
        const model = meta.prefixKIM ? 'KIMA' : 'APPM';
        const prefix = (meta.prefixKIM || meta.prefixAPPM).replace('_wave_', '_wind_');
        const headData = `0#12#3#/DATA/CHT/${model}/#/${prefix}`;
        let frames = [];
        try { frames = await listFrames({ headData, model, modelText: meta.name, type: 'wave' }, kstSlot); }
        catch (e) { console.error(`  LIST 실패 ${chartCode} ${kstSlot}: ${e.message}`); frames = []; }
        fs.writeFileSync(disk, JSON.stringify(frames)); await sleep(SLEEP_MS);
        listMem.set(key, frames); return frames;
    }

    let fetched = 0, skipped = 0, miss = 0;
    for (const t of tasks) {
        const k = t.zone + '|' + t.kstSlot + '|' + t.step;
        if (doneKey.has(k)) { skipped++; continue; }
        const frames = await framesFor(t.office, t.kstSlot);
        let fr = null;
        for (const dlt of [0, 3, -3, 6, -6]) { const s = t.step + dlt; fr = frames.find(f => f.ftHours === s); if (fr) { t.step = s; break; } }
        if (!fr) { miss++; continue; }
        const gpath = path.join(GIF, fr.fileName);
        if (!fs.existsSync(gpath)) { try { const buf = await downloadFrame(fr); fs.writeFileSync(gpath, buf); await sleep(SLEEP_MS); fetched++; } catch (e) { console.error(`  GIF 실패 ${fr.fileName}: ${e.message}`); miss++; continue; } }
        done.push({ zone: t.zone, office: t.office, validAt: t.validAt, base: t.base, kstSlot: t.kstSlot, step: t.step, fileName: fr.fileName, neg: 'hard' });
        doneKey.add(k);
        if (done.length % 25 === 0) fs.writeFileSync(OUT, JSON.stringify(done));
    }
    fs.writeFileSync(OUT, JSON.stringify(done));
    console.error(`[hardneg] 완료. 신규 ${fetched} · 건너뜀 ${skipped} · 미매칭 ${miss} → 총 ${done.length} → ${OUT}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
