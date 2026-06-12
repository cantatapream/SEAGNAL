'use strict';
/**
 * fetch_calm.js — "잔잔한 날"(특보/예비 없음) 해상풍 일기도 표본 수집.
 *
 *  목적: 절대확률표 보정의 빈 곳 메우기. 오프라인 캐시는 "발효 이벤트 주변" 프레임만 있어
 *        음성(잔잔)표본이 거의 없다 → 절대 P(발효|신호) 가 붕괴. 전 기간에 걸쳐 고르게
 *        '잔잔한 (구역, 시각)' 을 샘플해 그 24h 전 예보 프레임을 내려받아 캐시에 채운다.
 *
 *  잔잔 정의: 해당 구역에 표본시각 ±BUSY_PAD_H 안에 풍랑/태풍 발효도, 최근 예비특보도 없음.
 *  매칭: run_prelim_eval 과 동일한 프레임 선택(폴리곤+면적 평가가 그대로 읽도록 파일명 일치).
 *
 *  자격증명: KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD (env, 파일 평문 금지). 천천히(SLEEP_MS),
 *            재개 가능(이미 받은 프레임/표본은 건너뜀).
 *
 *  실행:
 *    KMA_DMDW_USER_ID=.. KMA_DMDW_USER_PWD=.. node fetch_calm.js [--ncalm=60] [--lead=24] [--plan]
 *      --plan : 네트워크 없이 표본 계획만 출력(자격증명 점검 전 건수 확인용)
 *  산출: out/calm_samples.json  — [{zone, office, validAt, base, kstSlot, step, fileName}]
 *        (실제 GIF 는 cache/gif/ 에 저장 → calib_abs.js 가 폴리곤+면적으로 분석)
 */
const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { CALIB, OFFICE_CHART } = require('./geoCalib');
const { REGIONAL_OFFICES, listFrames, downloadFrame } = require('./chartClient');
const { loadZonePolygons, zonePixelIndices, normName } = require('./zonePolygon');

const GIF = path.join(__dirname, 'cache', 'gif');
const CACHE = path.join(__dirname, 'cache');
const CSV = path.join(__dirname, 'data', 'warnings_2023-2026.csv');
const EVENTS = path.join(__dirname, 'out', 'prelim_events.json');
const OUT = path.join(__dirname, 'out', 'calm_samples.json');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const NCALM = args.ncalm ? +args.ncalm : 60;        // office 당 월별 목표 표본 합계
const LEAD_H = args.lead ? +args.lead : 24;
const PLAN_ONLY = !!args.plan;
const SLEEP_MS = args.sleep ? +args.sleep : 2500;
const BUSY_PAD_H = 12;                                // 표본시각 ±이 시간 안에 발효/예비 없어야 잔잔
const PUB_DELAY_H = 7;

const H = 3600 * 1000;
const OFFICES = ['jeju', 'busn', 'gwju', 'gawn', 'dajn'];   // degu→gawn 차트
const pad = n => String(n).padStart(2, '0');
const ymdh = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function calibAdapter(code) { const c = CALIB[code]; if (!c) return null; return { xOf: lon => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg, yOf: lat => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg, frame: c.frame }; }
function runSlotsBefore(queryAt, maxBack = 3) {
    const d = new Date(queryAt.getTime() - PUB_DELAY_H * H); d.setMinutes(0, 0, 0);
    while (!(d.getHours() === 9 || d.getHours() === 21)) d.setHours(d.getHours() - 1);
    const out = []; for (let i = 0; i < maxBack; i++) { out.push(d.getTime()); d.setHours(d.getHours() - 12); } return out;
}

// ── 구역 → 담당 청(차트 내부 픽셀이 가장 많은 청) ────────────────────────────
function buildZoneOffice(polyMap) {
    const W = 730, Hh = 600;
    const m = new Map();
    for (const [zn, polys] of polyMap) {
        let best = null, bestN = 0;
        for (const o of OFFICES) {
            const cal = calibAdapter(OFFICE_CHART[o] || o); if (!cal) continue;
            const idx = zonePixelIndices(cal, polys, W, Hh);
            const n = idx ? idx.length : 0; if (n > bestN) { bestN = n; best = o; }
        }
        if (best) m.set(zn, best);
    }
    return m;
}

// ── 구역별 busy 구간(발효/예비) ─────────────────────────────────────────────
function buildBusy(polyMap) {
    const busy = new Map(); // zoneNorm → [[from,to]...]
    const add = (z, a, b) => { if (!busy.has(z)) busy.set(z, []); busy.get(z).push([a, b]); };
    const evs = parseWarnings(CSV, { kinds: new Set(['풍랑', '태풍']), actions: new Set(['발표', '변경']) }).filter(e => e.effectiveAt);
    for (const e of evs) for (const a of e.seaAreas) { const z = normName(a); if (z && polyMap.has(z)) add(z, e.effectiveAt.getTime() - 12 * H, e.effectiveAt.getTime() + 36 * H); }
    try {
        const eps = JSON.parse(fs.readFileSync(EVENTS, 'utf8'));
        for (const ep of eps) { if (!polyMap.has(ep.zone)) continue; const a = ep.announceAt, e = ep.expectedAt || (a + 24 * H); add(ep.zone, a - 6 * H, e + 12 * H); }
    } catch (_) {}
    for (const arr of busy.values()) arr.sort((x, y) => x[0] - y[0]);
    return busy;
}
const isBusy = (busy, z, t) => (busy.get(z) || []).some(([a, b]) => t >= a - BUSY_PAD_H * H && t <= b + BUSY_PAD_H * H);

// ── 표본 계획: office별 월별 잔잔 (zone, validAt) 추출 ───────────────────────
function planSamples(polyMap, zoneOffice, busy) {
    const byOffZones = {}; OFFICES.forEach(o => byOffZones[o] = []);
    for (const [z, o] of zoneOffice) byOffZones[o].push(z);
    // 전 기간 월 목록 2023-06 ~ 2025-12 (홀드아웃 2026 은 평가에서만)
    const months = [];
    for (let y = 2023, mo = 6; !(y === 2026 && mo === 1); ) { months.push([y, mo]); mo++; if (mo > 12) { mo = 1; y++; } }
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const tasks = [];
    for (const o of OFFICES) {
        const zones = byOffZones[o]; if (!zones.length) continue;
        const perMonth = Math.max(1, Math.round(NCALM / months.length));
        for (const [y, mo] of months) {
            let got = 0, tries = 0;
            while (got < perMonth && tries < perMonth * 40) {
                tries++;
                const z = zones[Math.floor(rnd() * zones.length)];
                const day = 1 + Math.floor(rnd() * 28);
                const hh = [0, 6, 12, 18][Math.floor(rnd() * 4)];
                const validAt = new Date(y, mo - 1, day, hh, 0, 0).getTime();
                if (validAt < Date.UTC(2023, 5, 1) || isBusy(busy, z, validAt)) continue;
                const base = runSlotsBefore(new Date(validAt - 0))[0]; // 최신 가용 슬롯(≈ valid−PUB)
                // lead≈LEAD_H 가 되도록 valid 를 base+LEAD_H 로 본다(step 계산은 valid 기준)
                const step = Math.round(((validAt) - base) / H / 3) * 3;
                if (step < 0 || step > 120) continue;
                // LIST tm 은 KST 슬롯(09/21시) 그대로. (−9h 는 GIF 파일명 안의 베이스시각에만 해당)
                const kstSlot = ymdh(new Date(base));
                tasks.push({ zone: z, office: o, validAt, base, kstSlot, step });
                got++;
            }
        }
    }
    return tasks;
}

(async () => {
    const polyMap = loadZonePolygons();
    const zoneOffice = buildZoneOffice(polyMap);
    const busy = buildBusy(polyMap);
    const tasks = planSamples(polyMap, zoneOffice, busy);

    const byOff = {}; tasks.forEach(t => byOff[t.office] = (byOff[t.office] || 0) + 1);
    console.error(`[calm] 계획 표본 ${tasks.length}건 (office별 ${JSON.stringify(byOff)}), lead≈${LEAD_H}h`);
    if (PLAN_ONLY) { console.error('[calm] --plan: 네트워크 없이 계획만 출력하고 종료.'); return; }

    // 기존 진행분 로드(재개)
    let done = [];
    try { done = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { done = []; }
    const doneKey = new Set(done.map(d => d.zone + '|' + d.kstSlot + '|' + d.step));

    // LIST 캐시 디스크 재사용(runLeadtime 규약): list_<chart>_wind_<kstSlot>.json
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
        fs.writeFileSync(disk, JSON.stringify(frames));
        await sleep(SLEEP_MS);
        listMem.set(key, frames);
        return frames;
    }

    let fetched = 0, skipped = 0, miss = 0;
    for (const t of tasks) {
        const k = t.zone + '|' + t.kstSlot + '|' + t.step;
        if (doneKey.has(k)) { skipped++; continue; }
        const frames = await framesFor(t.office, t.kstSlot);
        // step 매칭: ±3,±6 허용
        let fr = null;
        for (const dlt of [0, 3, -3, 6, -6]) { const s = t.step + dlt; fr = frames.find(f => f.ftHours === s); if (fr) { t.step = s; break; } }
        if (!fr) { miss++; continue; }
        const gpath = path.join(GIF, fr.fileName);
        if (!fs.existsSync(gpath)) {
            try { const buf = await downloadFrame(fr); fs.writeFileSync(gpath, buf); await sleep(SLEEP_MS); fetched++; }
            catch (e) { console.error(`  GIF 실패 ${fr.fileName}: ${e.message}`); miss++; continue; }
        }
        done.push({ zone: t.zone, office: t.office, validAt: t.validAt, base: t.base, kstSlot: t.kstSlot, step: t.step, fileName: fr.fileName });
        doneKey.add(k);
        if (done.length % 20 === 0) fs.writeFileSync(OUT, JSON.stringify(done));
    }
    fs.writeFileSync(OUT, JSON.stringify(done));
    console.error(`[calm] 완료. 신규 ${fetched} · 재개건너뜀 ${skipped} · 미매칭 ${miss} → 총 표본 ${done.length} → ${OUT}`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
