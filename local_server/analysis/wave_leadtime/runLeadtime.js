/**
 * ============================================================================
 * runLeadtime.js — 일기도(예보) vs 실제 풍랑 발효 리드타임 분석 러너
 * ============================================================================
 *
 * [질문] "풍랑특보가 실제로 발효되기 L시간 전, 그 시점에 가용했던 예보 일기도는
 *         이미 해당 해역에 유의파고 ≥ 3.0m(주의보급)를 그리고 있었는가?"
 *
 * [방법]  각 풍랑 발효 이벤트 E(청, 발효시각 T_ef, 해역들) 에 대해 리드타임 L:
 *   1) (T_ef-L) 시점 가용 최신 run(발표지연 반영, 인과성 보장) 선택
 *   2) valid time 이 T_ef 에 가장 가까운(±3h) 프레임
 *   3) 디코딩 → 두 가지 산출
 *      - 청 단위: 차트 전체 maxBand (analyzeChart)
 *      - per-zone: E 의 해역(부모 특보구역) 좌표를 차트에 투영, 그 구역만 maxBand (geoCalib)
 *   4) maxBand ≥ 3.0 → HIT (L시간 전 이미 주의보급 예측)
 *
 * [집계] 리드타임별 HIT율(청/zone) + 거짓경보율 + 이벤트별 최초감지 리드타임.
 *
 * [사용]
 *  KMA_DMDW_USER_ID=.. KMA_DMDW_USER_PWD=.. \
 *    node runLeadtime.js --office=제주도 --from=2026-04-01 --to=2026-05-01 \
 *                        --leads=12,24,48,72 --level=주의보 [--limit=N] [--nozone]
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { REGIONAL_OFFICES, listFrames, downloadFrame } = require('./chartClient');
const { analyze } = require('./analyzeChart');
const { getStaticMask } = require('./staticMask');
const { CALIB, OFFICE_CHART, decode, analyzeZone } = require('./geoCalib');
const { resolveZone } = require('./zones');

const DATA_DIR = path.join(__dirname, 'data');
const CSV = path.join(DATA_DIR, 'warnings_2023-2026.csv');
const CACHE_DIR = path.join(__dirname, 'cache');
const GIF_CACHE = path.join(CACHE_DIR, 'gif');
const OUT_DIR = path.join(__dirname, 'out');
for (const d of [CACHE_DIR, GIF_CACHE, OUT_DIR]) fs.mkdirSync(d, { recursive: true });

// ----- 인자 -----
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const OFFICE = args.office || '제주도';
const FROM = args.from ? new Date(args.from + 'T00:00:00') : null;
const TO = args.to ? new Date(args.to + 'T00:00:00') : null;
const LEADS = (args.leads || '12,24,48,72').split(',').map(Number).sort((a, b) => a - b);
const LEVEL = args.level || null;
const LIMIT = args.limit ? +args.limit : 0;
const SLEEP_MS = args.sleep ? +args.sleep : 150;
const PUB_DELAY_H = args.pubdelay ? +args.pubdelay : 7;
const DO_ZONE = !args.nozone;
const ZONE_RADIUS = args.zoneradius ? +args.zoneradius : 26; // 구역 샘플 반경(px)

// office(CSV 지역) → 차트 청코드(degu 는 gawn 차트 사용) + 보정 + 차트용 prefix
const officeEntry = Object.entries(REGIONAL_OFFICES).find(([, v]) => v.csvRegion === OFFICE);
if (!officeEntry) { console.error('알 수 없는 청:', OFFICE); process.exit(1); }
const [officeCode, officeMeta] = officeEntry;
const chartCode = OFFICE_CHART[officeCode] || officeCode;
const chartMeta = REGIONAL_OFFICES[chartCode];
const calib = CALIB[chartCode] || null;

// 신호: wave(유의파고, m) | wind(해상풍 풍속, kt). wind 는 '_wave_'→'_wind_' prefix.
const SIGNAL = args.signal === 'wind' ? 'wind' : 'wave';
const windPalette = require('./windPalette');
const SIG = SIGNAL === 'wind'
    ? { classify: windPalette.classify, ge3: windPalette.WARN_KT, ge5: windPalette.ALARM_KT, unit: 'kt',
        prefixKIM: chartMeta.prefixKIM && chartMeta.prefixKIM.replace('_wave_', '_wind_'),
        prefixAPPM: chartMeta.prefixAPPM && chartMeta.prefixAPPM.replace('_wave_', '_wind_') }
    : { classify: undefined, ge3: 3.0, ge5: 5.0, unit: 'm', prefixKIM: chartMeta.prefixKIM, prefixAPPM: chartMeta.prefixAPPM };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const ymdh = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
const ymdhToDate = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), 0, 0);

// run 슬롯: LIST tm 은 정확히 run s000 유효시각(KST=09/21시). 발표지연 반영해 최신 슬롯부터.
function runSlotsBefore(queryAt, maxBack = 4) {
    const avail = new Date(queryAt.getTime() - PUB_DELAY_H * 3600 * 1000);
    const d = new Date(avail); d.setMinutes(0, 0, 0);
    while (!(d.getHours() === 9 || d.getHours() === 21)) d.setHours(d.getHours() - 1);
    const slots = [];
    for (let i = 0; i < maxBack; i++) { slots.push(ymdh(d)); d.setHours(d.getHours() - 12); }
    return slots;
}

// LIST 캐시 (차트 청코드 기준)
const listCache = new Map();
async function getFrames(queryTm) {
    if (listCache.has(queryTm)) return listCache.get(queryTm);
    const diskFile = path.join(CACHE_DIR, `list_${chartCode}_${SIGNAL}_${queryTm}.json`);
    if (fs.existsSync(diskFile)) { const v = JSON.parse(fs.readFileSync(diskFile, 'utf8')); listCache.set(queryTm, v); return v; }
    const model = chartMeta.prefixKIM ? 'KIMA' : 'APPM';
    const prefix = SIG.prefixKIM || SIG.prefixAPPM;
    const headData = `0#12#3#/DATA/CHT/${model}/#/${prefix}`;
    let frames = [];
    try { frames = await listFrames({ headData, model, modelText: chartMeta.name, type: 'wave' }, queryTm); } catch (e) { frames = []; }
    fs.writeFileSync(diskFile, JSON.stringify(frames));
    listCache.set(queryTm, frames);
    return frames;
}
async function getGif(frame) {
    const file = path.join(GIF_CACHE, frame.fileName);
    if (fs.existsSync(file)) return fs.readFileSync(file);
    const buf = await downloadFrame(frame);
    fs.writeFileSync(file, buf); await sleep(SLEEP_MS); return buf;
}

// 청 단위 분석 캐시 + 디코드 LRU(per-zone 용)
let STATIC_MASK = null;
const wholeCache = new Map();
const decodedLRU = new Map(); const DECODE_CAP = 24;
function getWhole(buf, fileName) {
    if (wholeCache.has(fileName)) return wholeCache.get(fileName);
    const r = analyze(buf, { mask: STATIC_MASK && STATIC_MASK.mask, classify: SIG.classify, ge3Level: SIG.ge3, ge5Level: SIG.ge5 });
    wholeCache.set(fileName, r); return r;
}
function getDecoded(buf, fileName) {
    if (decodedLRU.has(fileName)) { const v = decodedLRU.get(fileName); decodedLRU.delete(fileName); decodedLRU.set(fileName, v); return v; }
    const d = decode(buf);
    decodedLRU.set(fileName, d);
    if (decodedLRU.size > DECODE_CAP) decodedLRU.delete(decodedLRU.keys().next().value);
    return d;
}

// 이벤트의 해역명 → 차트 프레임 안에 드는 부모 구역들
function eventZones(seaAreas) {
    const seen = new Set(); const out = [];
    for (const a of seaAreas || []) {
        const z = resolveZone(a);
        if (!z) continue;
        const key = z.name; if (seen.has(key)) continue; seen.add(key);
        if (calib) {
            const cx = calib.xRefPx + (z.lon - calib.xRefDeg) * calib.lonPxPerDeg;
            const cy = calib.yRefPx - (z.lat - calib.yRefDeg) * calib.latPxPerDeg;
            if (cx < calib.frame.x0 || cx > calib.frame.x1 || cy < calib.frame.y0 || cy > calib.frame.y1) continue;
        }
        out.push(z);
    }
    return out;
}
// geoCalib.analyzeZone 은 {xOf,yOf,frame} 형태 calib 를 기대 → 어댑터
const calibAdapter = calib ? {
    xOf: (lon) => calib.xRefPx + (lon - calib.xRefDeg) * calib.lonPxPerDeg,
    yOf: (lat) => calib.yRefPx - (lat - calib.yRefDeg) * calib.latPxPerDeg,
    frame: calib.frame,
} : null;

(async () => {
    console.log(`[run] 청=${OFFICE}(${officeMeta.name}) 차트=${chartCode} signal=${SIGNAL} leads=${LEADS}h level=${LEVEL || '전체'} zone=${DO_ZONE && !!calib}`);
    try {
        STATIC_MASK = await getStaticMask(chartCode, chartMeta, {
            rebuild: !!args.rebuildmask, signal: SIGNAL, classify: SIG.classify, ge3Level: SIG.ge3,
            prefix: chartMeta.prefixKIM ? SIG.prefixKIM : SIG.prefixAPPM,
        });
    } catch (e) { console.log('[mask] 실패, 마스크 없이:', e.message); }

    // 이벤트 파싱 + 필터 + 동일 발효시각 병합(해역 합치기)
    let raw = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) })
        .filter((e) => e.officeRegion === OFFICE && e.effectiveAt);
    if (LEVEL) raw = raw.filter((e) => e.level === LEVEL);
    if (FROM) raw = raw.filter((e) => e.effectiveAt >= FROM);
    if (TO) raw = raw.filter((e) => e.effectiveAt < TO);
    const uniq = new Map();
    for (const e of raw) {
        const k = e.effectiveAt.getTime() + '|' + e.level;
        if (!uniq.has(k)) uniq.set(k, { effectiveAt: e.effectiveAt, level: e.level, seaAreas: new Set(e.seaAreas) });
        else e.seaAreas.forEach((a) => uniq.get(k).seaAreas.add(a));
    }
    let events = [...uniq.values()].map((e) => ({ ...e, seaAreas: [...e.seaAreas] })).sort((a, b) => a.effectiveAt - b.effectiveAt);
    if (LIMIT) events = events.slice(0, LIMIT);
    console.log(`[run] 분석 이벤트 ${events.length}건`);

    const results = [];
    let idx = 0;
    for (const e of events) {
        idx++;
        const zones = (DO_ZONE && calib) ? eventZones(e.seaAreas) : [];
        const row = { effectiveAt: e.effectiveAt.toISOString(), level: e.level, nZones: zones.length, leads: {} };
        for (const L of LEADS) {
            const queryAt = new Date(e.effectiveAt.getTime() - L * 3600 * 1000);
            let rec = { ok: false };
            try {
                let frames = [];
                for (const slot of runSlotsBefore(queryAt)) { frames = await getFrames(slot); if (frames.length) break; }
                if (frames.length) {
                    let best = null, bestDiff = Infinity;
                    for (const f of frames) { if (!f.tm) continue; const d = Math.abs(ymdhToDate(f.tm) - e.effectiveAt); if (d < bestDiff) { bestDiff = d; best = f; } }
                    if (best && bestDiff <= 3 * 3600 * 1000 + 1) {
                        const buf = await getGif(best);
                        const whole = getWhole(buf, best.fileName);
                        rec = { ok: true, frame: best.fileName, ftHours: best.ftHours, validDiffMin: Math.round(bestDiff / 60000),
                                maxBand: whole.maxBand, hit3: whole.maxBand >= SIG.ge3, hit5: whole.maxBand >= SIG.ge5 };
                        if (DO_ZONE && calib && zones.length) {
                            const dec = getDecoded(buf, best.fileName);
                            let zMax = 0;
                            for (const z of zones) {
                                // 구역 크기에 맞춘 샘플 반경: H(광역 먼바다)는 크게, I(앞바다 국지)는 작게
                                const rad = args.zoneradius ? ZONE_RADIUS : (z.type === 'H' ? 55 : 30);
                                const za = analyzeZone(dec, calibAdapter, z, { mask: STATIC_MASK && STATIC_MASK.mask, radiusPx: rad,
                                    classify: SIG.classify, ge3Level: SIG.ge3, ge5Level: SIG.ge5 });
                                if (za && za.maxBand > zMax) zMax = za.maxBand;
                            }
                            rec.zoneMaxBand = zMax; rec.zoneHit3 = zMax >= SIG.ge3; rec.zoneHit5 = zMax >= SIG.ge5;
                        }
                    }
                }
            } catch (err) { rec = { ok: false, err: err.message }; }
            row.leads[L] = rec;
        }
        results.push(row);
        const sum = LEADS.map((L) => { const r = row.leads[L]; if (!r.ok) return `${L}:-`;
            const z = r.zoneHit3 != null ? (r.zoneHit3 ? `Z${r.zoneMaxBand}` : `z${r.zoneMaxBand}`) : '';
            return `${L}:${r.hit3 ? '★' : ''}${r.maxBand}${z ? '/' + z : ''}`; }).join(' ');
        console.log(`  [${idx}/${events.length}] ${row.effectiveAt.slice(0, 16)} ${e.level} z${zones.length} | ${sum}`);
    }

    // ----- 집계 -----
    const agg = { office: OFFICE, chart: chartCode, level: LEVEL || '전체', events: results.length, hasZone: DO_ZONE && !!calib, leads: {} };
    for (const L of LEADS) {
        const cov = results.filter((r) => r.leads[L] && r.leads[L].ok);
        const h = cov.filter((r) => r.leads[L].hit3).length;
        const zcov = cov.filter((r) => r.leads[L].zoneHit3 != null);
        const zh = zcov.filter((r) => r.leads[L].zoneHit3).length;
        agg.leads[L] = { covered: cov.length, hit3: h, hit3Rate: cov.length ? +(h / cov.length).toFixed(3) : null,
                         zoneCovered: zcov.length, zoneHit3: zh, zoneHit3Rate: zcov.length ? +(zh / zcov.length).toFixed(3) : null };
    }
    const earliest = (key) => results.map((r) => { for (const L of [...LEADS].sort((a, b) => b - a)) { const x = r.leads[L]; if (x && x.ok && x[key]) return L; } return null; });
    const eW = earliest('hit3'), eZ = earliest('zoneHit3');
    agg.earliestWhole = {}; agg.earliestZone = {};
    for (const L of LEADS) { agg.earliestWhole[L] = eW.filter((x) => x === L).length; agg.earliestZone[L] = eZ.filter((x) => x === L).length; }
    agg.earliestWhole.none = eW.filter((x) => x === null).length; agg.earliestZone.none = eZ.filter((x) => x === null).length;

    // 음성 대조군 (청 단위)
    if (!args.nocontrol && results.length) {
        const warnTimes = results.map((r) => new Date(r.effectiveAt).getTime());
        const isCalm = (t) => warnTimes.every((wt) => Math.abs(wt - t) > 24 * 3600 * 1000);
        const winFrom = FROM || new Date(results[0].effectiveAt);
        const winTo = TO || new Date(new Date(results.at(-1).effectiveAt).getTime() + 86400000);
        const calmSlots = [];
        for (let d = new Date(winFrom); d < winTo; d.setHours(d.getHours() + 12)) {
            if (d.getHours() !== 9 && d.getHours() !== 21) d.setHours(d.getHours() === 21 ? 9 : 21);
            if (isCalm(d.getTime())) calmSlots.push(ymdh(d));
            if (calmSlots.length >= 30) break;
        }
        let cChecked = 0, cFalse = 0;
        for (const slot of calmSlots) {
            try { const frames = await getFrames(slot); const f0 = frames.find((f) => f.ftHours === 0) || frames[0];
                if (!f0) continue; const a = getWhole(await getGif(f0), f0.fileName); cChecked++; if (a.maxBand >= SIG.ge3) cFalse++; } catch (e) { /* */ }
        }
        agg.control = { sampled: cChecked, falsePositive: cFalse, falseRate: cChecked ? +(cFalse / cChecked).toFixed(3) : null };
    }

    agg.signal = SIGNAL; agg.unit = SIG.unit;
    const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const outBase = path.join(OUT_DIR, `leadtime_${officeCode}_${SIGNAL}_${stamp}`);
    fs.writeFileSync(outBase + '.json', JSON.stringify({ agg, results }, null, 1));
    fs.writeFileSync(outBase + '.md', render(agg));
    console.log('\n[done]', outBase + '.md');
    console.log(render(agg));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

function render(agg) {
    const L = Object.keys(agg.leads).map(Number).sort((a, b) => a - b);
    const sigTxt = agg.signal === 'wind' ? '해상풍 풍속 ≥ 25kt(≈14m/s, 주의보 기준)' : '유의파고 ≥ 3.0m(주의보 기준)';
    let s = `# 리드타임 분석 — ${agg.office} (차트:${agg.chart}, 신호:${agg.signal || 'wave'}) / 풍랑${agg.level}\n\n`;
    s += `- 분석 이벤트: **${agg.events}건**${agg.hasZone ? ' (per-zone 적용)' : ''}\n`;
    s += `- 가설: "일기도가 ${sigTxt}를 그리면 → 풍랑주의보로 이어진다"\n\n`;
    s += `## 발효 L시간 전, 일기도가 이미 임계(${sigTxt})를 그린 비율\n\n`;
    s += `| 리드타임 | 청단위 HIT율 | per-zone HIT율 |\n|---|---|---|\n`;
    for (const l of L) { const x = agg.leads[l];
        const w = x.hit3Rate != null ? `${(x.hit3Rate * 100).toFixed(0)}% (${x.hit3}/${x.covered})` : '-';
        const z = x.zoneHit3Rate != null ? `${(x.zoneHit3Rate * 100).toFixed(0)}% (${x.zoneHit3}/${x.zoneCovered})` : '-';
        s += `| ${l}시간 전 | ${w} | ${z} |\n`; }
    if (agg.control) s += `\n## 음성 대조군(거짓경보율, 청단위)\n\n잔잔한 ${agg.control.sampled}개 표본 중 오탐 ${agg.control.falsePositive}개 → **${agg.control.falseRate != null ? (agg.control.falseRate * 100).toFixed(0) + '%' : '-'}**\n`;
    s += `\n## 이벤트별 최초 감지 리드타임\n\n| 최초 감지 | 청단위 | per-zone |\n|---|---|---|\n`;
    for (const l of L) s += `| ${l}시간 전 | ${agg.earliestWhole[l]} | ${agg.earliestZone[l]} |\n`;
    s += `| 감지 못함 | ${agg.earliestWhole.none} | ${agg.earliestZone.none} |\n`;
    return s;
}
