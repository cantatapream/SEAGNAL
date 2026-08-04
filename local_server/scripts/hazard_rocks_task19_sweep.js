/**
 * ============================================================================
 * 파일명: scripts/hazard_rocks_task19_sweep.js
 * 역할: Task #19 — 노출암(k=0) 전체 정밀 조석-스윕 스크리닝 (플러드필만, OCR 없음)
 * ============================================================================
 *
 * [무엇을 하나] 서해·남해 대상 노출암 전부에 대해, 프로덕션 tide-field API의
 *   예측 윈도우(3일) 전체를 1시간 간격으로 훑으며 그 시각 해안선-플러드필
 *   도달가능 여부(services/hazard_rocks_isolation.js)를 계산하고, 시간에 따라
 *   "연결↔고립"이 전환되는(=조석에 실제로 영향받는) 노출암만 후보로 추린다.
 *   HAZARD_ROCKS_HANDOFF.md §6.4 후보 선정 설계(2단계) 중 1단계.
 *
 * [로컬 tide_field 데이터 없음] grid_meta.json/anchors.json 은 로컬 저장소엔
 *   빈 스텁(no_bathymetry)뿐이라, 실제 격자는 프로덕션(seagnal-server.fly.dev)
 *   API를 직접 호출해서 얻는다(§6.2 검증 때와 동일 방식).
 *
 * [MAX_CANDIDATE_CELLS(14000) 우회] 전역 bbox 한 번에 조회하면 노출 셀이
 *   많은 시각엔 budget_dropped 로 잘린다 — dropped>0 이면 bbox 를 2x2로
 *   재귀 분할해 전량 수집한다(HAZARD_ROCKS_HANDOFF.md §6.2 부수발견 1 재사용).
 *
 * 사용법: node hazard_rocks_task19_sweep.js [--step-hours=1] [--out=<path>]
 * [연계]
 *   - services/hazard_rocks_isolation.js → floodFillReachable/classifyRocks
 *   - services/tide_field_common.js → isWestSouthSea (대상 해역 게이팅)
 *   - data/tide_field/coastline_cells.json → 해안선 시드
 *   - client/hazard_rocks.json → 노출암(k=0) 좌표
 *   - data/hazard_rocks/nearshore_isolation_review_1000.json → 300m 근접 OCR 결과(union 대상)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const TFC = require('../services/tide_field_common');
const ISO = require('../services/hazard_rocks_isolation');

const API_BASE = process.env.SWEEP_API_BASE || 'https://seagnal-server.fly.dev';
const REGION_BBOX = TFC.REGION_BBOX;

const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const STEP_HOURS = Number(args['step-hours'] || 1);
const OUT_PATH = args.out || path.join(__dirname, '..', 'data', 'hazard_rocks', 'isolation_sweep_full.json');
const SEARCH_RADIUS_CELLS = 2; // HAZARD_ROCKS_HANDOFF.md §6.2 classifyRocks 기본값과 동일

function httpGetJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: timeoutMs || 20000 }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} for ${url}: ${data.slice(0, 200)}`));
                    return;
                }
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`JSON parse fail for ${url}: ${e.message}`)); }
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

async function fetchJsonRetry(url, retries) {
    let lastErr;
    for (let i = 0; i <= (retries == null ? 3 : retries); i++) {
        try { return await httpGetJson(url); }
        catch (e) {
            lastErr = e;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    throw lastErr;
}

/**
 * 주어진 시각의 노출 셀 전체를 bbox 재귀분할로 캡(14000) 없이 수집한다.
 * @returns {Set<string>} cellKey("gx_gy") 집합 (state=1 노출 셀)
 */
async function fetchExposedCellsFull(timeISO, bbox) {
    const [lonMin, latMin, lonMax, latMax] = bbox;
    const url = `${API_BASE}/api/tide-field?time=${encodeURIComponent(timeISO)}&bbox=${lonMin},${latMin},${lonMax},${latMax}`;
    const resp = await fetchJsonRetry(url);
    const out = new Set();
    for (const c of resp.cells) out.add(ISO.cellKeyOf(c.lon, c.lat));

    if (resp.budget_dropped > 0) {
        // 면적이 0에 가까우면(부동소수 무한분할 방지) 더는 쪼개지 않고 있는 대로 반환.
        const lonSpan = lonMax - lonMin, latSpan = latMax - latMin;
        if (lonSpan < 0.02 && latSpan < 0.02) return out;
        const lonMid = (lonMin + lonMax) / 2, latMid = (latMin + latMax) / 2;
        const subBboxes = [
            [lonMin, latMin, lonMid, latMid],
            [lonMid, latMin, lonMax, latMid],
            [lonMin, latMid, lonMid, latMax],
            [lonMid, latMid, lonMax, latMax],
        ];
        const subResults = await Promise.all(subBboxes.map(b => fetchExposedCellsFull(timeISO, b)));
        for (const s of subResults) for (const k of s) out.add(k);
    }
    return out;
}

function loadInScopeRocks() {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'hazard_rocks.json'), 'utf8'));
    const rocks = [];
    for (const f of raw.features) {
        if (f.properties.k !== 0) continue;
        const [lon, lat] = f.geometry.coordinates;
        if (!TFC.isWestSouthSea(lat, lon)) continue;
        rocks.push({ id: f.properties.id, lon, lat });
    }
    return rocks;
}

function loadCoastlineSeeds() {
    const cc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tide_field', 'coastline_cells.json'), 'utf8'));
    return new Set(cc.cells);
}

async function main() {
    console.log('[task19] 프로덕션 tide-field 메타 조회...');
    const meta = await fetchJsonRetry(`${API_BASE}/api/tide-field/meta`);
    if (!meta.success || !meta.ready) throw new Error('tide-field 준비 안 됨: ' + JSON.stringify(meta));
    console.log(`[task19] window ${meta.time_start} ~ ${meta.time_end} (cell_count=${meta.cell_count})`);

    const rocks = loadInScopeRocks();
    console.log(`[task19] in-scope 노출암(k=0, 서해·남해) ${rocks.length}개`);

    const coastlineSeeds = loadCoastlineSeeds();
    console.log(`[task19] 해안선 시드 셀 ${coastlineSeeds.size}개`);

    const start = new Date(meta.time_start).getTime();
    const end = new Date(meta.time_end).getTime();
    const timeSamples = [];
    for (let t = start; t < end; t += STEP_HOURS * 3600000) timeSamples.push(new Date(t).toISOString());
    console.log(`[task19] 시간 샘플 ${timeSamples.length}개 (${STEP_HOURS}시간 간격)`);

    // rock.id -> boolean[] (각 샘플 시각의 isolated 여부)
    const history = new Map(rocks.map(r => [r.id, []]));

    const bboxAll = [REGION_BBOX.lonMin, REGION_BBOX.latMin, REGION_BBOX.lonMax, REGION_BBOX.latMax];
    const t0 = Date.now();
    for (let i = 0; i < timeSamples.length; i++) {
        const timeISO = timeSamples[i];
        const exposedSet = await fetchExposedCellsFull(timeISO, bboxAll);
        const reachable = ISO.floodFillReachable(coastlineSeeds, (k) => exposedSet.has(k), exposedSet);
        const isolatedMap = ISO.classifyRocks(rocks, reachable, SEARCH_RADIUS_CELLS);
        for (const [id, isolated] of isolatedMap) history.get(id).push(isolated);
        const elapsedS = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`[task19] (${i + 1}/${timeSamples.length}) ${timeISO} exposed=${exposedSet.size} elapsed=${elapsedS}s`);
    }

    // 리뷰 대상: 1,000개 근접-해안 OCR 결과 (union 참고용, id로 교차)
    const nearshoreReviewPath = path.join(__dirname, '..', 'data', 'hazard_rocks', 'nearshore_isolation_review_1000.json');
    const nearshoreReview = fs.existsSync(nearshoreReviewPath)
        ? JSON.parse(fs.readFileSync(nearshoreReviewPath, 'utf8'))
        : [];
    const nearshoreIds = new Set(nearshoreReview.map(r => r.id));

    const results = rocks.map(r => {
        const hist = history.get(r.id);
        const isolatedCount = hist.filter(Boolean).length;
        const connectedCount = hist.length - isolatedCount;
        const transitions = hist.reduce((n, v, idx) => n + (idx > 0 && v !== hist[idx - 1] ? 1 : 0), 0);
        let category;
        if (isolatedCount === 0) category = 'always_connected';
        else if (connectedCount === 0) category = 'always_isolated';
        else category = 'transition';
        return {
            id: r.id, lon: r.lon, lat: r.lat,
            category, transitions,
            isolatedSamples: isolatedCount, totalSamples: hist.length,
            inNearshoreReview1000: nearshoreIds.has(r.id),
        };
    });

    const summary = {
        always_connected: results.filter(r => r.category === 'always_connected').length,
        always_isolated: results.filter(r => r.category === 'always_isolated').length,
        transition: results.filter(r => r.category === 'transition').length,
    };
    console.log('[task19] 분류 요약:', summary);

    const out = {
        generated_at: new Date().toISOString(),
        api_base: API_BASE,
        time_window: { start: meta.time_start, end: meta.time_end, step_hours: STEP_HOURS, sample_count: timeSamples.length },
        search_radius_cells: SEARCH_RADIUS_CELLS,
        in_scope_count: rocks.length,
        summary,
        rocks: results,
    };
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(out));
    console.log(`[task19] 저장: ${OUT_PATH}`);
}

main().catch(e => { console.error('[task19] 실패:', e); process.exit(1); });
