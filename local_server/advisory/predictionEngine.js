/**
 * ============================================================================
 * advisory/predictionEngine.js — 특보 예측 엔진 (Phase 1, 통합본 A+B)
 * ============================================================================
 *
 * 최신 청별 국지 CoWW3 일기도(해상풍/유의파고 GIF)를 분석해, 각 특보구역의
 * 풍랑주의보 발효 "예측"(onset 시점 + 결합확률 + 등급 + 서술문구)을 생성하고
 * JSON 으로 저장한다.
 *
 * 단일 출처 설정: advisory/predictionConfig.js
 * 검증된 모듈 재사용(재구현 금지): analysis/wave_leadtime/{chartClient,geoCalib,
 *                                  staticMask,windPalette,palette,zones}
 *
 * [핵심 설계 — B(검증본) 기반 + A 장점 병합]
 *  - 타임존: 모든 시각 비교를 'KST 벽시계를 UTC 필드에 담은 Date' 로 통일하고,
 *    onsetISO 출력 시에만 -9h 하여 실제 UTC ISO 로 변환. (서버 TZ 비의존, 검증됨)
 *  - run 슬롯: 현재KST-7h(발표지연) 기준 가장 가까운 09/21시(KST) 슬롯부터,
 *    listFrames 가 비면 12h 씩 최대 4회 역행.
 *  - onset 전방 스캔: 유효시각 오름차순 + 동일 유효시각 파고 동시 평가.
 *    풍속(≥WIND_KT) 또는 파고(≥WAVE_M) 가 처음 임계를 넘는 유효시각 = onset.
 *    LEAD_MAX_H 는 run 슬롯 기준 예보지평으로 사전 필터(B). 첫 초과 즉시 중단.
 *  - decode 캐시(메모리 Map, fileName 키) → 풍속/파고 중복 디코드 방지.
 *  - 청/구역 단위 try-catch 로 부분 실패 흡수. 마스크 실패시 null 로 진행.
 *
 * 출력:
 *  - 검증 산출: advisory/sample_output.json
 *  - 운영 저장: data/advisory_prediction.json
 *
 * 실행: KMA_DMDW_USER_ID=.. KMA_DMDW_USER_PWD=.. node predictionEngine.js
 *       옵션: --windCut=<kt> --waveCut=<m> --noWrite
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

// --- 설정 단일 출처 ---
const cfg = require('./predictionConfig');
const { CALIB, OFFICE_CHART, OFFICES, THRESHOLDS, gradeOf2 } = cfg;

// --- 프레임-외부 onset 스캔 (메모리 절감; zone-outer 와 동치 — run_onsetscan_test) ---
const { scanOnsets } = require('./onsetScan');

// --- 재사용 검증 모듈 (../analysis/wave_leadtime) ---
const WL = path.join(__dirname, '..', 'analysis', 'wave_leadtime');
const { REGIONAL_OFFICES, listFrames, downloadFrame } = require(path.join(WL, 'chartClient'));
const { decode } = require(path.join(WL, 'geoCalib'));
const { getStaticMask } = require(path.join(WL, 'staticMask'));
const windPalette = require(path.join(WL, 'windPalette'));
const wavePalette = require(path.join(WL, 'palette'));
const { ZONES } = require(path.join(WL, 'zones'));
// 폴리곤+면적 (검증된 과탐억제 — CALIB_ABS/BEATKMA). 원형 반경 방식 폐지.
const { loadZonePolygons, zonePixelIndices, analyzeByIndices, normName } = require(path.join(WL, 'zonePolygon'));

// 검증 산출(advisory) + 운영 저장(data) 경로
const OUT_SAMPLE = path.join(__dirname, 'sample_output.json');
const OUT_OPERATIONAL = path.join(__dirname, '..', 'data', 'advisory_prediction.json');
// 2사이클 지속성 상태(직전 사이클에 게이트 통과한 구역 집합). Fly 볼륨에 보존.
const STATE_PENDING = path.join(__dirname, '..', 'data', 'advisory_pending.json');

// 폴리곤 1회 로드(구역명 normName 키). 비면 기존처럼 구역 스킵.
const polyMap = loadZonePolygons();

const PUB_DELAY_H = 7;          // 발표지연(가용성 보정) — 슬롯 선택에만 사용
const RUN_BACK_MAX = 4;         // run 슬롯 역행 횟수
const SLEEP_MIN = 80, SLEEP_MAX = 120;
const KT_TO_MS = 0.514444;

// ----------------------------------------------------------------------------
// 시간 유틸 — 서버 TZ 비의존. 차트 유효시각(tm)은 KST 'YYYYMMDDHH'.
//   비교용 Date 는 'KST 벽시계를 UTC 필드에 담은' 표현으로 통일(getUTC* 사용).
//   실제 UTC 변환은 ISO 출력 시점에만 -9h.
// ----------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => SLEEP_MIN + Math.floor(Math.random() * (SLEEP_MAX - SLEEP_MIN + 1));

// 현재시각의 'KST 벽시계' 표현(UTC Date 이지만 getUTC* 가 KST 벽시계를 반환)
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
const ymdhKST = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
// 'YYYYMMDDHH'(KST) → KST 벽시계 Date
const ymdhToKstDate = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), 0, 0));
// KST 벽시계 Date → 실제 UTC ISO 문자열
const kstDateToISO = (d) => new Date(d.getTime() - 9 * 3600 * 1000).toISOString();

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 현재시각 기준, 가용한 가장 가까운 run 슬롯(09/21 KST)부터 과거로 maxBack개.
 * 발표지연(PUB_DELAY_H)을 빼서 실제 archive 에 올라왔을 슬롯을 고른다.
 */
function runSlotsNow(maxBack = RUN_BACK_MAX) {
    const d = new Date(kstNow().getTime() - PUB_DELAY_H * 3600 * 1000);
    d.setUTCMinutes(0, 0, 0);
    while (!(d.getUTCHours() === 9 || d.getUTCHours() === 21)) d.setUTCHours(d.getUTCHours() - 1);
    const out = [];
    for (let i = 0; i < maxBack; i++) { out.push(ymdhKST(d)); d.setUTCHours(d.getUTCHours() - 12); }
    return out;
}

/**
 * 유효시각(KST 벽시계 Date) → 한국어 시간대 라벨. "6/13(토) 저녁" 형태.
 *   구간: 새벽0-6 / 오전6-12 / 낮12-15 / 오후15-18 / 저녁18-21 / 밤21-24
 */
function onsetLabel(kstDate) {
    const mo = kstDate.getUTCMonth() + 1, da = kstDate.getUTCDate();
    const wd = WEEKDAY[kstDate.getUTCDay()];
    const h = kstDate.getUTCHours();
    let band;
    if (h < 6) band = '새벽';
    else if (h < 12) band = '오전';
    else if (h < 15) band = '낮';
    else if (h < 18) band = '오후';
    else if (h < 21) band = '저녁';
    else band = '밤';
    return `${mo}/${da}(${wd}) ${band}`;
}

// ----------------------------------------------------------------------------
// 보정 어댑터 — geoCalib.calibFor 와 동일식. predictionConfig.CALIB 사용.
// ----------------------------------------------------------------------------
function calibAdapterFor(chartCode) {
    const c = CALIB[chartCode];
    if (!c) return null;
    return {
        xOf: (lon) => c.xRefPx + (lon - c.xRefDeg) * c.lonPxPerDeg,
        yOf: (lat) => c.yRefPx - (lat - c.yRefDeg) * c.latPxPerDeg,
        frame: c.frame,
    };
}

function inFrame(cal, z) {
    const x = Math.round(cal.xOf(z.lon)), y = Math.round(cal.yOf(z.lat));
    const f = cal.frame;
    return x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1;
}

// ----------------------------------------------------------------------------
// 프레임 목록 확보: 가용 run 슬롯부터 역행하며 listFrames 가 비지 않는 첫 슬롯 사용.
//   반환 { slot, frames } 또는 null.
// ----------------------------------------------------------------------------
async function latestFrames({ headData, model, modelText, type }) {
    for (const slot of runSlotsNow()) {
        let frames = [];
        try { frames = await listFrames({ headData, model, modelText, type }, slot); }
        catch (e) { continue; }
        if (frames && frames.length) return { slot, frames };
    }
    return null;
}

// ----------------------------------------------------------------------------
// 정적마스크 확보(신호별). 실패시 null(마스크 없이 진행 — 안전).
//   getStaticMask(officeCode, officeMeta{name,prefixKIM}, opt) 시그니처 준수.
// ----------------------------------------------------------------------------
async function maskFor(chartCode, regMeta, signal, classify, ge3Level, prefix) {
    try {
        const m = await getStaticMask(chartCode, regMeta, { signal, classify, ge3Level, prefix });
        return m && m.mask ? m.mask : null;
    } catch (e) {
        console.error(`[mask] ${chartCode}/${signal} 실패: ${e.message}`);
        return null;
    }
}

// ----------------------------------------------------------------------------
// 메인 — 예측 생성
// ----------------------------------------------------------------------------
async function generatePredictions(options = {}) {
    // 검증 시연용 임계 override (정상 운영은 config 기본값)
    const windCut = options.windCutKt != null ? options.windCutKt : THRESHOLDS.WIND_ONSET_KT;
    const waveCut = options.waveCutM != null ? options.waveCutM : THRESHOLDS.WAVE_M;

    const predictions = [];
    const zoneSignals = []; // 모든 도메인 구역의 현재 예보 peak 신호 (해소 카드 '전→후' 용)
    let baseTimeKST = null;

    // 프레임 1장만 메모리에 올렸다 버리는 디코더 (캐시 없음 — OOM 방지).
    async function decodeFrame(frame) {
        const buf = await downloadFrame(frame);
        await sleep(jitter());
        return decode(buf);
    }

    for (const code of Object.keys(OFFICES)) {
        try {
            const chartCode = OFFICE_CHART[code];
            const cal = calibAdapterFor(chartCode);
            if (!cal) { console.error(`[skip] ${code}: CALIB 없음(${chartCode})`); continue; }
            const meta = OFFICES[code];
            // 마스크용 메타는 차트 청 기준(예: degu→gawn 차트). 실제 prefix 는 opt.prefix 로 전달.
            const regMeta = REGIONAL_OFFICES[chartCode] || { name: code, prefixKIM: meta.windPrefix };
            const windPrefix = meta.windPrefix;
            const wavePrefix = meta.wavePrefix;
            const model = meta.model || 'KIMA';

            // --- 최신 프레임 목록(풍속/파고) ---
            const windList = await latestFrames({
                headData: `0#12#3#/DATA/CHT/${model}/#/${windPrefix}`,
                model, modelText: meta.csvRegion, type: 'wind',
            });
            const waveList = await latestFrames({
                headData: `0#12#3#/DATA/CHT/${model}/#/${wavePrefix}`,
                model, modelText: meta.csvRegion, type: 'wave',
            });
            if (!windList && !waveList) { console.error(`[skip] ${code}: 프레임 목록 비어있음`); continue; }

            const usedSlot = (windList && windList.slot) || (waveList && waveList.slot);
            if (!baseTimeKST || usedSlot > baseTimeKST) baseTimeKST = usedSlot;

            // --- 정적마스크(신호별 prefix 명시) ---
            const windMask = await maskFor(chartCode, regMeta, 'wind', windPalette.classify, windCut, windPrefix);
            const waveMask = await maskFor(chartCode, regMeta, 'wave', wavePalette.classify, waveCut, wavePrefix);

            // --- 유효시각 오름차순 + LEAD_MAX_H(run 슬롯 기준 예보지평) 필터 ---
            const slotDate = usedSlot ? ymdhToKstDate(usedSlot) : kstNow();
            const leadLimit = slotDate.getTime() + THRESHOLDS.LEAD_MAX_H * 3600 * 1000;
            const seq = (list) => !list ? [] : list.frames
                .filter((f) => f.tm)
                .map((f) => ({ f, vt: ymdhToKstDate(f.tm) }))
                .filter((x) => x.vt.getTime() <= leadLimit)
                .sort((a, b) => a.vt - b.vt);
            const windSeq = seq(windList);
            const waveSeq = seq(waveList);
            // 유효시각 → 파고프레임 빠른 조회(동일 valid 의 파고 동시 평가)
            const waveByVt = new Map(waveSeq.map((x) => [x.vt.getTime(), x.f]));

            // --- 이 차트 도메인 + 폴리곤 보유 구역만 (북부 등 폴리곤 없는 구역은 스킵) ---
            const zones = ZONES.filter((z) => inFrame(cal, z) && polyMap.has(normName(z.name)));

            // 구역별 폴리곤 픽셀 인덱스(차트 w/h 고정 → 첫 디코드 시 1회 산출 후 재사용)
            const idxCache = new Map();        // zone.name → Int32Array|null
            const windAreaAt = new Map();      // zone.name → 마지막 풍속 면적비율
            const waveAreaAt = new Map();      // zone.name → 마지막 파고 면적비율
            const zoneIdx = (dec, z) => {
                let idx = idxCache.get(z.name);
                if (idx === undefined) {
                    const polys = polyMap.get(normName(z.name));
                    idx = polys ? zonePixelIndices(cal, polys, dec.w, dec.h) : null;
                    idxCache.set(z.name, idx);
                }
                return idx;
            };

            // 프레임-외부 스캔: 일기도를 한 장씩만 디코드·분석·폐기(메모리에 1장만 유지).
            //   bandWind/bandWave 는 폴리곤 내부 면적게이트를 통과할 때만 밴드를 반환(아니면 0)
            //   → onset 은 "밴드≥컷 AND 면적≥게이트" 에서만 발화(이웃 번짐 스침 차단).
            const scan = await scanOnsets({
                primary: windSeq.length ? windSeq : waveSeq,
                waveByVt,
                hasWind: windSeq.length > 0,
                zones,
                windCut, waveCut,
                decodeFrame,
                bandWind: (dec, z) => {
                    const idx = zoneIdx(dec, z);
                    if (!idx || !idx.length) return 0;
                    const a = analyzeByIndices(dec, idx, {
                        mask: windMask, classify: windPalette.classify,
                        ge3Level: THRESHOLDS.GE3_KT, ge5Level: THRESHOLDS.WIND_ALARM_KT,
                        minBandPixels: THRESHOLDS.MIN_BAND_PIXELS,
                    });
                    if (!a) return 0;
                    windAreaAt.set(z.name, a.areaFraction);
                    return a.areaFraction >= THRESHOLDS.WIND_AREA_MIN ? a.maxBand : 0;
                },
                bandWave: (dec, z) => {
                    const idx = zoneIdx(dec, z);
                    if (!idx || !idx.length) return 0;
                    const a = analyzeByIndices(dec, idx, {
                        mask: waveMask, classify: wavePalette.classify,
                        ge3Level: waveCut, ge5Level: THRESHOLDS.WAVE_ALARM_M,
                        minBandPixels: THRESHOLDS.MIN_BAND_PIXELS,
                    });
                    if (!a) return 0;
                    waveAreaAt.set(z.name, a.areaFraction);
                    return a.areaFraction >= THRESHOLDS.WAVE_AREA_MIN ? a.maxBand : 0;
                },
            });

            for (const z of zones) {
                try {
                    const r = scan.get(z) || { onset: null, windBand: 0, waveBand: 0, peakWind: 0, peakWave: 0 };
                    const windArea = windAreaAt.get(z.name) || 0;
                    const waveArea = waveAreaAt.get(z.name) || 0;

                    // 구역별 현재 peak 신호 기록 (해소 카드 '전→후' / 디버그용)
                    //   prob: 등급기반(현실 정밀도) — 없으면 0. stateManager 가 그대로 사용.
                    const sigGrade = gradeOf2({ windKt: r.peakWind, windArea, waveM: r.peakWave, waveArea });
                    zoneSignals.push({ office: code, zone: z.name, windKt: r.peakWind, waveM: r.peakWave, windArea, waveArea, prob: sigGrade ? sigGrade.probPct / 100 : 0 });

                    if (!r.onset) continue; // 예측 없음

                    const windKt = r.windBand || 0;
                    const waveM = r.waveBand || 0;
                    const grade = gradeOf2({ windKt, windArea, waveM, waveArea });
                    if (!grade) continue; // 게이트 미달 → 미표시

                    const windMs = Math.round(windKt * KT_TO_MS);
                    const probPct = grade.probPct;
                    const areaPct = Math.round((windKt >= waveM ? windArea : Math.max(windArea, waveArea)) * 100);
                    const label = onsetLabel(r.onset);

                    const narrative =
                        `${z.name} 위험기상일기도 분석 결과, ${label}경 ` +
                        `풍속 ~${windKt}kt(${windMs}m/s)·파고 ~${waveM}m 가 구역의 약 ${areaPct}%에 예상됩니다. ` +
                        `과거 통계상 이 수준 신호의 약 ${probPct}%가 실제 발효로 이어졌습니다(${grade.emoji}${grade.label}).`;

                    predictions.push({
                        office: code,
                        zone: z.name,
                        lat: z.lat, lon: z.lon,
                        grade: { key: grade.key, label: grade.label, emoji: grade.emoji },
                        probPct,
                        windKt, windMs, waveM, areaPct,
                        onsetISO: kstDateToISO(r.onset),
                        onsetLabel: label,
                        narrative,
                    });
                } catch (zErr) {
                    console.error(`[zone] ${code}/${z.name} 실패: ${zErr.message}`);
                }
            }
            console.error(`[office] ${code}(${chartCode}): 도메인구역 ${zones.length}, 예측누적 ${predictions.length}`);
        } catch (oErr) {
            console.error(`[office] ${code} 실패: ${oErr.message}`);
        }
    }

    // 등급 강한 순 → 확률 순 → onset 빠른 순 정렬
    const gradeRank = { high: 2, watch: 1 };
    predictions.sort((a, b) =>
        (gradeRank[b.grade.key] - gradeRank[a.grade.key]) ||
        (b.probPct - a.probPct) ||
        (a.onsetISO < b.onsetISO ? -1 : a.onsetISO > b.onsetISO ? 1 : 0));

    // --- 2사이클 지속성: 직전 사이클에도 게이트 통과한 구역만 표출(1회성 노이즈 억제) ---
    //   상태파일(STATE_PENDING)에 이번 사이클 통과구역 전부를 기록하고, 표출은 직전 기록과의
    //   교집합만. 첫 등장은 '대기'(미표출), 다음 사이클에도 잡히면 '표출'. 직전 상태가
    //   PERSIST_MAX_AGE_H 보다 오래면 연속으로 보지 않음(전부 대기).
    const keyOf = (p) => `${p.office}|${p.zone}`;
    const thisFlagged = predictions.map(keyOf);
    let shown = predictions, pendingCount = 0;
    if (THRESHOLDS.PERSIST_ENABLED && !options.noPersist) {
        let prevFlagged = new Set();
        try {
            const prev = JSON.parse(fs.readFileSync(STATE_PENDING, 'utf8'));
            const ageH = (Date.now() - new Date(prev.generatedAt).getTime()) / 3600000;
            if (prev && Array.isArray(prev.flagged) && ageH <= THRESHOLDS.PERSIST_MAX_AGE_H) prevFlagged = new Set(prev.flagged);
        } catch (_) { /* 직전 상태 없음 → 전부 대기 */ }
        shown = predictions.filter((p) => prevFlagged.has(keyOf(p)));
        shown.forEach((p) => { p.confirmed = true; });
        pendingCount = predictions.length - shown.length;
        if (!options.noWrite) {
            try { fs.mkdirSync(path.dirname(STATE_PENDING), { recursive: true });
                fs.writeFileSync(STATE_PENDING, JSON.stringify({ generatedAt: new Date().toISOString(), baseTimeKST: baseTimeKST || null, flagged: thisFlagged })); }
            catch (e) { console.error(`[persist] 상태 저장 실패: ${e.message}`); }
        }
    }

    const result = {
        generatedAt: new Date().toISOString(),
        baseTimeKST: baseTimeKST || null,
        predictions: shown,                 // 표출 = 2사이클 연속 통과분
        pendingCount,                        // 이번에 처음 잡혀 대기 중인 구역 수
        zoneSignals, // 모든 도메인 구역 현재 peak 신호 (해소 '전→후' 계산용)
    };

    if (!options.noWrite) {
        const json = JSON.stringify(result, null, 2);
        try { fs.writeFileSync(OUT_SAMPLE, json); }
        catch (e) { console.error(`[write] sample_output.json 실패: ${e.message}`); }
        try {
            fs.mkdirSync(path.dirname(OUT_OPERATIONAL), { recursive: true });
            fs.writeFileSync(OUT_OPERATIONAL, json);
        } catch (e) { console.error(`[write] advisory_prediction.json 실패: ${e.message}`); }
    }
    return result;
}

module.exports = generatePredictions;
module.exports.generatePredictions = generatePredictions;

// 직접 실행 시 1회 수행 + 요약 출력
if (require.main === module) {
    const opts = {};
    for (const a of process.argv.slice(2)) {
        const m = a.match(/^--([^=]+)=(.*)$/);
        if (m && m[1] === 'windCut') opts.windCutKt = +m[2];
        if (m && m[1] === 'waveCut') opts.waveCutM = +m[2];
        if (a === '--noWrite') opts.noWrite = true;
        if (a === '--noPersist') opts.noPersist = true;
    }
    generatePredictions(opts).then((r) => {
        console.log(`\n=== 예측 결과 ===`);
        console.log(`baseTimeKST=${r.baseTimeKST}  표출=${r.predictions.length}  대기(1회성)=${r.pendingCount}`);
        r.predictions.slice(0, 3).forEach((p, i) => {
            console.log(`\n[${i + 1}] ${p.office}/${p.zone}  ${p.grade.emoji}${p.grade.label} ${p.probPct}%  면적${p.areaPct}%`);
            console.log(`    onsetISO=${p.onsetISO}  windKt=${p.windKt}  waveM=${p.waveM}`);
            console.log(`    ${p.narrative}`);
        });
        if (!opts.noWrite) { console.log(`\n저장: ${OUT_SAMPLE}`); console.log(`저장: ${OUT_OPERATIONAL}`); }
    }).catch((e) => { console.error('FATAL', e); process.exit(1); });
}
