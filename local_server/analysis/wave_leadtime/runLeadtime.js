/**
 * ============================================================================
 * runLeadtime.js — 일기도(예보) vs 실제 풍랑 발효 리드타임 분석 러너
 * ============================================================================
 *
 * [질문] "풍랑주의보가 실제로 발효되기 L시간 전, 그 시점에 가용했던 예보 일기도는
 *         이미 해당 청 해역에 유의파고 ≥ 3.0m(주의보급)를 그리고 있었는가?"
 *
 * [방법]
 *  각 풍랑 발효 이벤트 E(청 C, 발효시각 T_ef) 에 대해 리드타임 L ∈ LEAD_HOURS:
 *    1) LIST 질의 tm = (T_ef - L)  → 서버는 그 시각에 가용했던 '최신 run(issuance ≤ T_ef-L)'
 *       의 프레임 목록을 반환 (미래 run 을 엿보지 않음 — 인과성 보장).
 *    2) 반환 프레임 중 valid time 이 T_ef 에 가장 가까운(±3h) 프레임 선택.
 *    3) 그 프레임을 디코딩 → 해당 청 국지 차트의 maxBand / areaGE3 산출.
 *    4) maxBand ≥ 3.0 이면 "L시간 전에 이미 주의보급 예측" = HIT.
 *
 * [집계]
 *  - 리드타임별 HIT 율: "발효 L시간 전, 일기도가 이미 주의보급을 그린 비율"
 *  - 이벤트별 '최초 감지 리드타임'(가장 이른 L 에서 HIT) 분포
 *
 * [캐시] (office, queryTm) LIST 결과 + fileName GIF 를 디스크 캐시해 재실행 비용 절감.
 *
 * [사용]
 *  KMA_DMDW_USER_ID=.. KMA_DMDW_USER_PWD=.. \
 *    node runLeadtime.js --office=제주도 --from=2026-04-01 --to=2026-05-01 \
 *                        --leads=12,24,48,72 --level=주의보 --limit=40
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parseWarnings } = require('./warnings');
const { REGIONAL_OFFICES, listFrames, downloadFrame } = require('./chartClient');
const { analyze } = require('./analyzeChart');
const { getStaticMask } = require('./staticMask');

const DATA_DIR = path.join(__dirname, 'data');
const CSV = path.join(DATA_DIR, 'warnings_2023-2026.csv');
const CACHE_DIR = path.join(__dirname, 'cache');
const GIF_CACHE = path.join(CACHE_DIR, 'gif');
const OUT_DIR = path.join(__dirname, 'out');

for (const d of [CACHE_DIR, GIF_CACHE, OUT_DIR]) fs.mkdirSync(d, { recursive: true });

// ----- 인자 파싱 -----
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const OFFICE = args.office || '제주도';
const FROM = args.from ? new Date(args.from + 'T00:00:00') : null;
const TO = args.to ? new Date(args.to + 'T00:00:00') : null;
const LEADS = (args.leads || '12,24,48,72').split(',').map(Number).sort((a, b) => a - b);
const LEVEL = args.level || null;          // '주의보' | '경보' | null(전체)
const LIMIT = args.limit ? +args.limit : 0;
const SLEEP_MS = args.sleep ? +args.sleep : 150;
// HIT(주의보급/경보급) 인정 최소 면적(픽셀). 해역 ~30만 px 기준 150px ≈ 0.05%.
const HIT_GE3_PIXELS = args.minge3 ? +args.minge3 : 150;
const HIT_GE5_PIXELS = args.minge5 ? +args.minge5 : 80;

// office(청 csvRegion) → 차트 코드
const officeEntry = Object.entries(REGIONAL_OFFICES).find(([, v]) => v.csvRegion === OFFICE);
if (!officeEntry) { console.error('알 수 없는 청:', OFFICE); process.exit(1); }
const [officeCode, officeMeta] = officeEntry;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const ymdh = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}`;
function ymdhToDate(s) { // 'YYYYMMDDHH' KST → Date
    return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), 0, 0);
}

// ----------------------------------------------------------------------------
// run 슬롯 정렬 — LIST 의 tm 은 '정확히 run 의 s000 유효시각(KST)' 이어야 한다.
//   KIM 해상모델 run: 00/12 UTC = 09/21 KST. 임의 tm 은 빈 목록을 반환.
//   또한 run 은 발표 지연(PUB_DELAY_H) 후에야 실제 가용 → 인과성 보장 위해
//   "유효시각 + 발표지연 ≤ queryAt" 인 최신 슬롯을 선택.
// ----------------------------------------------------------------------------
const PUB_DELAY_H = args.pubdelay ? +args.pubdelay : 7; // KIM 산출물 가용까지 대략 지연(h)
function runSlotsBefore(queryAt, maxBack = 4) {
    const avail = new Date(queryAt.getTime() - PUB_DELAY_H * 3600 * 1000);
    const d = new Date(avail);
    d.setMinutes(0, 0, 0);
    while (!(d.getHours() === 9 || d.getHours() === 21)) d.setHours(d.getHours() - 1);
    const slots = [];
    for (let i = 0; i < maxBack; i++) {
        slots.push(ymdh(d));
        d.setHours(d.getHours() - 12); // 직전 슬롯 (09↔21, 12h 간격)
    }
    return slots; // 최신 → 과거 순
}

// LIST 결과 캐시 (메모리 + 디스크)
const listCache = new Map();
async function getFrames(queryTm) {
    if (listCache.has(queryTm)) return listCache.get(queryTm);
    const diskFile = path.join(CACHE_DIR, `list_${officeCode}_${queryTm}.json`);
    if (fs.existsSync(diskFile)) {
        const v = JSON.parse(fs.readFileSync(diskFile, 'utf8'));
        listCache.set(queryTm, v); return v;
    }
    // KIM 우선, 없으면 APPM prefix. headData step=12h, unit=3h.
    const prefix = officeMeta.prefixKIM || officeMeta.prefixAPPM;
    const model = officeMeta.prefixKIM ? 'KIMA' : 'APPM';
    const headData = `0#12#3#/DATA/CHT/${model === 'KIMA' ? 'KIMA' : 'APPM'}/#/${prefix}`;
    let frames = [];
    try {
        frames = await listFrames({ headData, model, modelText: officeMeta.name, type: 'wave' }, queryTm);
    } catch (e) { frames = []; }
    fs.writeFileSync(diskFile, JSON.stringify(frames));
    listCache.set(queryTm, frames);
    return frames;
}

async function getGif(frame) {
    const file = path.join(GIF_CACHE, frame.fileName);
    if (fs.existsSync(file)) return fs.readFileSync(file);
    const buf = await downloadFrame(frame);
    fs.writeFileSync(file, buf);
    await sleep(SLEEP_MS);
    return buf;
}

// 프레임 분석 캐시 (정적 마스크 적용)
const analyzeCache = new Map();
let STATIC_MASK = null; // { w, h, mask } — 본 실행 시작 시 1회 구축
function analyzeFrame(buf, fileName) {
    if (analyzeCache.has(fileName)) return analyzeCache.get(fileName);
    const r = analyze(buf, { mask: STATIC_MASK && STATIC_MASK.mask });
    analyzeCache.set(fileName, r);
    return r;
}

(async () => {
    console.log(`[run] 청=${OFFICE}(${officeMeta.name}) leads=${LEADS}h level=${LEVEL || '전체'}`);

    // 정적 요소 마스크 구축(청별 1회, 캐시) — 범례·캡션·마커 false positive 제거
    try { STATIC_MASK = await getStaticMask(officeCode, officeMeta, { rebuild: !!args.rebuildmask }); }
    catch (e) { console.log('[mask] 구축 실패, 마스크 없이 진행:', e.message); }

    let events = parseWarnings(CSV, { kinds: new Set(['풍랑']), actions: new Set(['발표', '변경']) })
        .filter((e) => e.officeRegion === OFFICE && e.effectiveAt);
    if (LEVEL) events = events.filter((e) => e.level === LEVEL);
    if (FROM) events = events.filter((e) => e.effectiveAt >= FROM);
    if (TO) events = events.filter((e) => e.effectiveAt < TO);
    // 동일 발효시각 중복(여러 해역) 은 청 단위 분석에서 1건으로 축약
    const uniq = new Map();
    for (const e of events) {
        const k = e.effectiveAt.getTime() + '|' + e.level;
        if (!uniq.has(k)) uniq.set(k, e);
    }
    events = [...uniq.values()].sort((a, b) => a.effectiveAt - b.effectiveAt);
    if (LIMIT) events = events.slice(0, LIMIT);
    console.log(`[run] 분석 이벤트 ${events.length}건`);

    const results = [];
    let idx = 0;
    for (const e of events) {
        idx++;
        const row = { effectiveAt: e.effectiveAt.toISOString(), level: e.level, leads: {} };
        for (const L of LEADS) {
            const queryAt = new Date(e.effectiveAt.getTime() - L * 3600 * 1000);
            let rec = { ok: false };
            try {
                // queryAt 시점에 가용했던 최신 run 슬롯부터 과거로 시도(archive gap 대비)
                let frames = [];
                let usedSlot = null;
                for (const slot of runSlotsBefore(queryAt)) {
                    frames = await getFrames(slot);
                    if (frames.length) { usedSlot = slot; break; }
                }
                if (frames.length) {
                    // valid time(frame.tm) 이 T_ef 에 가장 가까운 프레임 (±3h, 인과성: issuance ≤ queryAt)
                    let best = null, bestDiff = Infinity;
                    for (const f of frames) {
                        if (!f.tm) continue;
                        const vt = ymdhToDate(f.tm);
                        const diff = Math.abs(vt - e.effectiveAt);
                        if (diff < bestDiff) { bestDiff = diff; best = f; }
                    }
                    if (best && bestDiff <= 3 * 3600 * 1000 + 1) {
                        const buf = await getGif(best);
                        const a = analyzeFrame(buf, best.fileName);
                        // HIT 판정: maxBand 는 이미 MIN_BAND_PIXELS(=60px) 이상인 ≥3m 밴드가
                        //   존재할 때만 ≥3.0 이 되므로(정적마스크+하단크롭으로 캡션/범례 제거됨),
                        //   maxBand 임계만으로 면적 하한이 내포된다. (음성대조 검증: 잔잔한 날
                        //   maxBand≤2.5, 폭풍날 ≥3.5)
                        rec = {
                            ok: true, frame: best.fileName, ftHours: best.ftHours,
                            validDiffMin: Math.round(bestDiff / 60000),
                            maxBand: a.maxBand, areaGE3: +a.areaGE3.toFixed(4), areaGE5: +a.areaGE5.toFixed(4),
                            pixelsGE3: a.pixelsGE3, pixelsGE5: a.pixelsGE5,
                            hit3: a.maxBand >= 3.0,
                            hit5: a.maxBand >= 5.0,
                        };
                    }
                }
            } catch (err) { rec = { ok: false, err: err.message }; }
            row.leads[L] = rec;
        }
        results.push(row);
        const summary = LEADS.map((L) => {
            const r = row.leads[L];
            return `${L}h:${r.ok ? (r.hit3 ? `★${r.maxBand}` : r.maxBand) : '-'}`;
        }).join(' ');
        console.log(`  [${idx}/${events.length}] ${row.effectiveAt.slice(0, 16)} ${e.level} | ${summary}`);
    }

    // ----- 집계 -----
    const agg = { office: OFFICE, officeName: officeMeta.name, level: LEVEL || '전체', events: results.length, leads: {} };
    for (const L of LEADS) {
        const withData = results.filter((r) => r.leads[L] && r.leads[L].ok);
        const hits = withData.filter((r) => r.leads[L].hit3).length;
        agg.leads[L] = {
            covered: withData.length,
            hit3: hits,
            hit3Rate: withData.length ? +(hits / withData.length).toFixed(3) : null,
            meanAreaGE3: withData.length ? +(withData.reduce((s, r) => s + r.leads[L].areaGE3, 0) / withData.length).toFixed(4) : null,
        };
    }
    // 이벤트별 최초 감지 리드타임(가장 이른 L 에서 hit3)
    const earliest = results.map((r) => {
        for (const L of [...LEADS].sort((a, b) => b - a)) { // 큰 L(이른 시점)부터
            if (r.leads[L] && r.leads[L].ok && r.leads[L].hit3) return L;
        }
        return null;
    });
    agg.earliestDetectHist = {};
    for (const L of LEADS) agg.earliestDetectHist[L] = earliest.filter((x) => x === L).length;
    agg.earliestDetectHist['none'] = earliest.filter((x) => x === null).length;

    // ----- 음성 대조군(거짓경보율) -----
    // 분석 창 안에서 '풍랑 발효 ±24h 와 겹치지 않는' 잔잔한 run 슬롯을 표본 추출해,
    // 그 시점 실황 근접 프레임(s000)의 maxBand≥3 비율 = 거짓경보율(false positive).
    if (!args.nocontrol) {
        const warnTimes = results.map((r) => new Date(r.effectiveAt).getTime());
        const isCalm = (t) => warnTimes.every((wt) => Math.abs(wt - t) > 24 * 3600 * 1000);
        const winFrom = FROM || new Date(results[0] ? results[0].effectiveAt : Date.now());
        const winTo = TO || new Date((results.at(-1) ? new Date(results.at(-1).effectiveAt).getTime() : Date.now()) + 86400000);
        const calmSlots = [];
        for (let d = new Date(winFrom); d < winTo; d.setHours(d.getHours() + 12)) {
            if (d.getHours() !== 9 && d.getHours() !== 21) { d.setHours(d.getHours() === 21 ? 9 : 21); }
            if (isCalm(d.getTime())) calmSlots.push(ymdh(d));
            if (calmSlots.length >= 30) break;
        }
        let cChecked = 0, cFalse = 0;
        for (const slot of calmSlots) {
            try {
                const frames = await getFrames(slot);
                const f0 = frames.find((f) => f.ftHours === 0) || frames[0];
                if (!f0) continue;
                const a = analyzeFrame(await getGif(f0), f0.fileName);
                cChecked++;
                if (a.maxBand >= 3.0) cFalse++;
            } catch (e) { /* skip */ }
        }
        agg.control = { sampled: cChecked, falsePositive: cFalse, falseRate: cChecked ? +(cFalse / cChecked).toFixed(3) : null };
        console.log(`[control] 잔잔한 슬롯 ${cChecked}개 중 ≥3m 오탐 ${cFalse}개 (거짓경보율 ${agg.control.falseRate})`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const outBase = path.join(OUT_DIR, `leadtime_${officeCode}_${stamp}`);
    fs.writeFileSync(outBase + '.json', JSON.stringify({ agg, results }, null, 1));
    fs.writeFileSync(outBase + '.md', renderReport(agg));
    console.log('\n[done] 결과 저장:', outBase + '.md');
    console.log(renderReport(agg));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

function renderReport(agg) {
    const L = Object.keys(agg.leads).map(Number).sort((a, b) => a - b);
    let s = `# 리드타임 분석 — ${agg.office} (${agg.officeName}) / 풍랑${agg.level}\n\n`;
    s += `- 분석 이벤트: **${agg.events}건**\n`;
    s += `- 가설: "일기도가 유의파고 ≥ 3.0m(주의보급)를 그리면 → 풍랑주의보로 이어진다"\n\n`;
    s += `## 발효 L시간 전, 일기도가 이미 주의보급(≥3m)을 그린 비율\n\n`;
    s += `| 리드타임 | 분석가능 | HIT(≥3m) | HIT율 | 평균 ≥3m 면적비 |\n|---|---|---|---|---|\n`;
    for (const l of L) {
        const x = agg.leads[l];
        s += `| ${l}시간 전 | ${x.covered} | ${x.hit3} | ${x.hit3Rate != null ? (x.hit3Rate * 100).toFixed(0) + '%' : '-'} | ${x.meanAreaGE3 != null ? (x.meanAreaGE3 * 100).toFixed(1) + '%' : '-'} |\n`;
    }
    if (agg.control) {
        s += `\n## 음성 대조군 (거짓경보율)\n\n`;
        s += `풍랑 발효와 겹치지 않는 잔잔한 시점 **${agg.control.sampled}개** 표본 중, 일기도가 ≥3m 를 그린 경우(오탐): **${agg.control.falsePositive}개** → 거짓경보율 **${agg.control.falseRate != null ? (agg.control.falseRate * 100).toFixed(0) + '%' : '-'}**\n`;
    }
    s += `\n## 이벤트별 '최초 감지 리드타임' 분포\n\n`;
    s += `(가장 이른 시점에 일기도가 ≥3m 를 그린 리드타임)\n\n| 최초 감지 | 건수 |\n|---|---|\n`;
    for (const l of L) s += `| ${l}시간 전 | ${agg.earliestDetectHist[l]} |\n`;
    s += `| 감지 못함 | ${agg.earliestDetectHist['none']} |\n`;
    return s;
}
