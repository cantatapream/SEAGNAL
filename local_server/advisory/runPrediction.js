'use strict';
/**
 * ============================================================================
 * advisory/runPrediction.js — 특보 예측 통합 오케스트레이터 (Phase 6)
 * ============================================================================
 *
 * 예측 파이프라인 한 사이클을 엮는다:
 *
 *     엔진(generatePredictions)
 *        → 억제(applySuppression)
 *        → 교차참조(crossReference — 기상청 단기예보 숫자 병기)
 *        → 상태관리(updateState)
 *        → data/advisory_state.json 저장
 *
 * - 스케줄러가 주기적으로 fire-and-forget 호출(권장: 시간당 1회, 매시 :25).
 * - CLI 로도 1회 실행 가능(`node advisory/runPrediction.js`).
 * - 교차참조 실패는 흡수 — 병기만 생략하고 예측은 그대로 진행한다.
 * - Gemini 해설은 이번 범위 제외(deferred).
 *
 * [설계 원칙]
 *  - 절대 throw 가 스케줄러로 새지 않게 전체를 try/catch 로 격리.
 *  - 엔진 실패 → 이전 상태 보존(updateState 호출 안 함).
 *  - 억제 실패 → 보수적 폴백(visible=전체, suppressed=[]) 으로 과억제 방지.
 *  - 테스트를 위해 세 의존 모듈을 opts.deps 로 주입 가능(네트워크 0 검증).
 *
 * 운영 전제: dmdw 자격증명 env(KMA_DMDW_USER_ID / KMA_DMDW_USER_PWD 등)가
 * 필요하다. 없으면 generate 단계가 실패하고 이전 상태가 유지된다(graceful).
 * ============================================================================
 */

// 운영 기본 의존 모듈 (테스트 시 opts.deps 로 대체).
//  - generatePredictions: module.exports = fn; module.exports.generatePredictions = fn
//  - applySuppression / updateState: named exports
const generatePredictions = require('./predictionEngine');
const { applySuppression } = require('./suppression');
const { updateState } = require('./stateManager');

/**
 * 예측 파이프라인 한 사이클을 실행한다.
 *
 * @param {object} [opts]
 * @param {object} [opts.deps]        - 의존성 주입(테스트용).
 *        { generatePredictions, applySuppression, updateState }
 * @param {object} [opts.genOptions]  - 엔진에 전달할 옵션(windCutKt, waveCutM, noWrite ...).
 * @param {object} [opts.stateOpts]   - updateState 에 전달할 옵션(now, noWrite, prevState ...).
 * @returns {Promise<object>} 요약. 성공 시
 *   { ok:true, generatedAt, baseTimeKST, activeCount, suppressedCount, resolvedCount }
 *   실패 시(엔진 단계) { ok:false, stage:'generate', error }
 *   또는 예기치 못한 실패 시 { ok:false, stage:'unknown', error }
 */
async function runPredictionCycle(opts = {}) {
    opts = opts && typeof opts === 'object' ? opts : {};
    const deps = opts.deps || {};

    // deps 주입 지원 — 미지정 시 실제 모듈 사용.
    const gen = deps.generatePredictions || generatePredictions;
    const applySupp = deps.applySuppression || applySuppression;
    const updState = deps.updateState || updateState;

    try {
        // ── 0) 변경감지: 직전 처리 base 를 엔진에 전달(같으면 엔진이 스킵) ──
        let prevBaseKST = null;
        try {
            const sm = deps.stateManager || require('./stateManager');
            if (sm && typeof sm.readPrevState === 'function') {
                const ps = sm.readPrevState();
                prevBaseKST = ps && ps.baseTimeKST ? ps.baseTimeKST : null;
            }
        } catch (_) { prevBaseKST = null; }
        const genOptions = Object.assign({}, opts.genOptions || {});
        if (prevBaseKST && genOptions.prevBaseKST == null && !opts.forceFull) genOptions.prevBaseKST = prevBaseKST;

        // ── 1) 엔진: 예측 생성 ────────────────────────────────────────────
        //   실패 시 updateState 호출하지 않음 → 이전 상태(디스크) 보존.
        let g;
        try {
            g = await gen(genOptions);
        } catch (e) {
            const error = (e && e.message) || String(e);
            console.log(`[advisory] generate 실패 → 이전 상태 보존: ${error}`);
            // 이전 상태 보존: updateState 호출하지 않는다.
            return { ok: false, stage: 'generate', error };
        }
        g = g && typeof g === 'object' ? g : {};
        // 변경 없음 → 엔진이 스킵. 이전 상태 그대로 유지(updateState 호출 안 함).
        if (g.skipped) {
            console.log(`[advisory] cycle skip — base=${g.baseTimeKST} (변경 없음, 이전 상태 유지)`);
            return { ok: true, skipped: true, baseTimeKST: g.baseTimeKST || prevBaseKST || null };
        }
        const predictions = Array.isArray(g.predictions) ? g.predictions : [];
        const pendingRaw = Array.isArray(g.pending) ? g.pending : [];
        const zoneSignals = Array.isArray(g.zoneSignals) ? g.zoneSignals : [];

        // ── 2) 억제: 발효/예비특보 구역 가림 ──────────────────────────────
        //   applySuppression 자체가 graceful 이나, 방어적으로 try 로 감싸
        //   예외 시 보수적 폴백(과억제 방지)으로 계속한다.
        //   pending(지속성 대기)도 함께 억제 — 공식특보 구역의 대기 신호가
        //   carry-over 로 표출되는 일이 없도록. zone 집합으로 다시 분리
        //   (dedup 후라 한 zone 은 표출/대기 중 한쪽에만 존재).
        const pendingZoneSet = new Set(pendingRaw.map((p) => p && p.zone).filter(Boolean));
        let visible;
        let suppressed;
        let pendingVisible;
        try {
            const r = await applySupp(predictions.concat(pendingRaw));
            const vis = (r && Array.isArray(r.visible)) ? r.visible : predictions.concat(pendingRaw);
            visible = vis.filter((p) => p && !pendingZoneSet.has(p.zone));
            pendingVisible = vis.filter((p) => p && pendingZoneSet.has(p.zone));
            suppressed = (r && Array.isArray(r.suppressed)) ? r.suppressed : [];
        } catch (e) {
            const error = (e && e.message) || String(e);
            console.log(`[advisory] suppression 실패 → 폴백(과억제 방지): ${error}`);
            visible = predictions;   // 보수적: 전체 노출
            pendingVisible = pendingRaw;
            suppressed = [];
        }

        // ── 3) 억제된 zone 이름 배열(falsy 제거) ──────────────────────────
        const suppressedZones = (suppressed || [])
            .map((s) => s && s.zone)
            .filter(Boolean);

        // ── 3.5) 교차참조: 기상청 단기 해상예보 숫자 병기(판정 없이) ───────
        //   같은 해역·시간대의 기상청 공식 예보(풍속/파고)를 prediction.kmaForecast
        //   로 부착한다. 디스크 IO/매칭 실패는 모두 흡수 — 실패해도 예측은 그대로.
        let enriched = visible;
        try {
            const cx = deps.crossReference || require('./crossReference');
            const enrichPredictions = deps.enrichPredictions || cx.enrichPredictions;
            // 단일 출처: 날씨누리 [해설] 단기전망 통보문(풍속/파고/문장/발표시각).
            const loadBulletinMap = deps.loadBulletinMap || cx.loadBulletinMap || (() => ({}));
            const bulletinMap = loadBulletinMap();
            enriched = enrichPredictions(visible, bulletinMap) || visible;
        } catch (e) {
            const error = (e && e.message) || String(e);
            console.log(`[advisory] 교차참조 실패 → 병기 생략(예측 유지): ${error}`);
            enriched = visible;
        }

        // ── 4) 상태관리: data/advisory_state.json 갱신/저장 ───────────────
        const current = {
            baseTimeKST: g.baseTimeKST,
            predictions: enriched,
            pending: pendingVisible,   // 지속성 대기 — 직전 표출 구역이면 carry-over(해소 오판 방지)
            zoneSignals,
        };
        const state = updState(current, suppressedZones, opts.stateOpts || {}) || {};

        // ── 4.5) 누적 저널: 예측(표출/대기/억제) + 공식특보 관측 기록 ───────
        //   분석력 강화용 운영 데이터 축적(append-only). 실패해도 사이클은 정상.
        try {
            const journal = deps.journal || require('./journal');
            let warnZones = [];
            try {
                const supp = require('./suppression');
                const zset = supp.getActiveWarningZones();
                warnZones = zset ? Array.from(zset) : [];
            } catch (_) { warnZones = []; }
            journal.logCycle({
                baseTimeKST: g.baseTimeKST,
                shown: visible, pending: pendingVisible, suppressed,
                warnZones,
            });
        } catch (e) {
            console.log(`[advisory] journal 기록 실패(무시): ${(e && e.message) || e}`);
        }

        // ── 5) 요약 반환 ──────────────────────────────────────────────────
        const summary = {
            ok: true,
            generatedAt: g.generatedAt,
            baseTimeKST: g.baseTimeKST,
            activeCount: visible.length,
            suppressedCount: suppressed.length,
            resolvedCount: (state.resolved && state.resolved.length) || 0,
        };
        console.log(
            `[advisory] cycle ok — base=${summary.baseTimeKST} ` +
            `active=${summary.activeCount} suppressed=${summary.suppressedCount} ` +
            `resolved=${summary.resolvedCount}`
        );
        return summary;
    } catch (e) {
        // 전 단계 격리: 어떤 예외도 스케줄러로 새지 않게.
        const error = (e && e.message) || String(e);
        console.log(`[advisory] cycle 예기치 못한 실패: ${error}`);
        return { ok: false, stage: 'unknown', error };
    }
}

module.exports = { runPredictionCycle };

// ── CLI: 1회 실행 ──────────────────────────────────────────────────────────
if (require.main === module) {
    runPredictionCycle()
        .then((r) => {
            console.log(JSON.stringify(r));
            process.exit(r.ok ? 0 : 1);
        })
        .catch((e) => {
            console.error(e);
            process.exit(1);
        });
}
