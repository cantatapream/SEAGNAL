/**
 * ============================================================================
 * advisory/stateManager.js — SEAGNAL 특보 예측 상태관리 (Phase 3, 통합본)
 * ============================================================================
 *
 * variant A·B 를 검토해 하나로 통합한 최종 산출물.
 *
 * 매 예측 사이클 결과를 두 갈래로 추적한다.
 *   · active   : 지금 "예측 중"인 항목 (이미 Phase2 억제 후 visible 한 predictions)
 *   · resolved : "최근 해소"된 항목 (우리 판단으로 사라진 것만, RESOLVED_KEEP_H 유지)
 *
 * 예측이 직전 사이클(active)에 있다가 이번에 사라졌을 때:
 *   (1) 공식 특보/예비특보로 빠진 것(suppressedZones) → 완전 제거. 해소 X.
 *   (2) 우리 판단으로 빠진 것 → "최근 해소"로 이동, 사유 동반:
 *        · onset_passed   : 예상시각(onsetISO)+ONSET_GRACE_H 경과했는데 발효 안 됨
 *        · forecast_eased : 그 외 — 예보가 호전되어 가능성이 낮아짐
 *
 * 설계 원칙
 *   - 순수 로직 + 디스크. 네트워크 불필요.
 *   - graceful: 이전 상태 파일이 없거나 깨졌으면 빈 상태로 시작. 저장 실패 흡수.
 *   - now / prevState / noWrite 를 opts 로 주입 가능 → 테스트 결정론 보장.
 *
 * 통합 결정 요약
 *   - 만료 경계: A 의 strict `<` 채택 (정확히 RESOLVED_KEEP_H 경과 시점은 '유지').
 *   - after.probPct: B 채택 — zoneSignal.prob 있으면 사용, 없으면 combinedProb 폴백.
 *   - 숫자 폴백 표기: B 의 '-' 채택 (사용자 노출 문자열에 자연스러움).
 *   - exports: { updateState, STATE_PATH } (B — 운영/테스트 편의).
 *
 * 단일 출처 설정: ./predictionConfig (통합본은 advisory/ 레벨에 위치).
 * 상태파일: ../data/advisory_state.json (= local_server/data/advisory_state.json).
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

// 설정 단일 출처. THRESHOLDS.RESOLVED_KEEP_H / ONSET_GRACE_H, combinedProb 등.
const { THRESHOLDS } = require('./predictionConfig');

// 상태 영속 경로 (local_server/data/advisory_state.json).
const STATE_PATH = path.resolve(__dirname, '..', 'data', 'advisory_state.json');

const RESOLVED_KEEP_H = (THRESHOLDS && THRESHOLDS.RESOLVED_KEEP_H) || 24;
const ONSET_GRACE_H = (THRESHOLDS && THRESHOLDS.ONSET_GRACE_H) || 6;
const HOUR_MS = 60 * 60 * 1000;

// ── 작은 헬퍼 ───────────────────────────────────────────────────────────────

/** zone 키 정규화 (trim). null/undefined 안전. */
function zoneKey(z) {
    return z == null ? '' : String(z).trim();
}

/** JSON 안전 로드 — 없거나 깨졌으면 {active:[],resolved:[]}. */
function readPrevState() {
    try {
        const raw = fs.readFileSync(STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            active: Array.isArray(parsed.active) ? parsed.active : [],
            resolved: Array.isArray(parsed.resolved) ? parsed.resolved : [],
        };
    } catch (e) {
        return { active: [], resolved: [] };
    }
}

/** prev 상태 정규화 — 항상 {active:[], resolved:[]} 보장. */
function normalizePrev(prev) {
    const p = prev && typeof prev === 'object' ? prev : {};
    return {
        active: Array.isArray(p.active) ? p.active : [],
        resolved: Array.isArray(p.resolved) ? p.resolved : [],
    };
}

/** zone → {windKt, waveM, prob} 맵 (전 구역 현재 peak 신호; 해소 '후' 값). */
function buildZoneSignalMap(zoneSignals) {
    const m = new Map();
    for (const s of (Array.isArray(zoneSignals) ? zoneSignals : [])) {
        const k = zoneKey(s && s.zone);
        if (k) m.set(k, s);
    }
    return m;
}

/** 숫자 안전 출력 (서술용). 유효하지 않으면 '-'. */
function n(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : '-';
}

// ── 해소 서술문 ─────────────────────────────────────────────────────────────

/**
 * 해소 narrative 생성.
 * @param {string} reason  'forecast_eased' | 'onset_passed'
 * @param {string} zone
 * @param {{windKt,waveM,probPct}} before
 * @param {{windKt,waveM,probPct}|null} after
 */
function buildNarrative(reason, zone, before, after) {
    const b = before || {};
    if (reason === 'onset_passed') {
        return `${zone} 예상 시각 경과 — 발효되지 않음 ` +
            `(최종 예측 풍속 ~${n(b.windKt)}kt/파고 ~${n(b.waveM)}m)`;
    }
    // forecast_eased
    if (after) {
        return `${zone} 예보 호전 — 발효 가능성 낮아짐 ` +
            `(풍속 ~${n(b.windKt)}kt→~${n(after.windKt)}kt, ` +
            `파고 ~${n(b.waveM)}m→~${n(after.waveM)}m, ` +
            `가능성 ${n(b.probPct)}%→${n(after.probPct)}%)`;
    }
    // after 없음 = 현재 신호가 임계 미만으로 사라짐
    return `${zone} 예보 호전 — 발효 가능성 낮아짐 ` +
        `(풍속 ~${n(b.windKt)}kt→ 임계 미만, ` +
        `파고 ~${n(b.waveM)}m→ 임계 미만, ` +
        `가능성 ${n(b.probPct)}%→ 임계 미만)`;
}

// ── 메인 ────────────────────────────────────────────────────────────────────

/**
 * 상태 갱신.
 *
 * @param {{baseTimeKST?:string, predictions?:Array, pending?:Array, zoneSignals?:Array}} current
 *        pending — 지속성 '대기'(게이트 통과·미확정) 예측. 직전 표출 구역이면 carry-over.
 * @param {string[]} [suppressedZones=[]]  공식/예비특보로 억제된 zone 이름 배열
 * @param {object} [opts]
 *        opts.prevState  — 직접 주입할 이전 상태(없으면 디스크 로드)
 *        opts.now        — 기준 시각(Date|ISO|ms). 없으면 new Date().
 *        opts.noWrite    — true 면 디스크 저장 안 함.
 * @returns {{updatedAt, baseTimeKST, active:Array, resolved:Array}}
 */
function updateState(current, suppressedZones = [], opts = {}) {
    current = current && typeof current === 'object' ? current : {};
    const nowDate = opts.now ? new Date(opts.now) : new Date();
    const nowMs = nowDate.getTime();
    const nowISO = nowDate.toISOString();

    // 1) 이전 상태
    const prev = normalizePrev(
        opts.prevState != null ? opts.prevState : readPrevState()
    );

    // 2) active = 이번 사이클 predictions (이미 억제 후 visible)
    const active = Array.isArray(current.predictions) ? current.predictions.slice() : [];

    // active zone 집합 (재진입 판정 + "사라진 것" 판정)
    const activeZones = new Set();
    for (const p of active) {
        const k = zoneKey(p && p.zone);
        if (k) activeZones.add(k);
    }

    // 2.5) 지속성 '대기' 연속 유지(carry-over) — 직전 사이클에 표출 중이던 구역이
    //   이번 사이클에 '대기'(게이트 통과·미확정, 예: 지속성 상태파일 유실/만료)로
    //   분류됐다면, 해소로 오판하지 않고 새 예측값으로 표출을 이어간다.
    //   (신호가 실제로 살아있으므로 해소→재등장 깜빡임 방지)
    const pendingMap = new Map();
    for (const p of (Array.isArray(current.pending) ? current.pending : [])) {
        const k = zoneKey(p && p.zone);
        if (k) pendingMap.set(k, p);
    }
    for (const pp of prev.active) {
        const zone = zoneKey(pp && pp.zone);
        if (!zone || activeZones.has(zone)) continue;
        const pend = pendingMap.get(zone);
        if (!pend) continue;
        const carried = Object.assign({}, pend, { confirmed: true });
        active.push(carried);
        activeZones.add(zone);
    }

    // 억제 zone 집합 (trim 정규화)
    const suppressedSet = new Set(
        (Array.isArray(suppressedZones) ? suppressedZones : [])
            .map(zoneKey)
            .filter(Boolean)
    );

    // 3) zoneSignal 조회 맵: zone → {windKt, waveM, prob}
    const signalMap = buildZoneSignalMap(current.zoneSignals);

    // 4) 해소 전이 — prev.active 중 이번 active 에 없는 zone 처리
    const newlyResolved = [];
    for (const pp of prev.active) {
        const zone = zoneKey(pp && pp.zone);
        if (!zone) continue;
        if (activeZones.has(zone)) continue;        // 여전히 예측 중 → 전이 없음
        if (suppressedSet.has(zone)) continue;      // 공식이 가져감 → drop (해소 X)

        // 사유 판정: onsetISO + ONSET_GRACE_H 경과 여부
        const onsetMs = pp && pp.onsetISO ? Date.parse(pp.onsetISO) : NaN;
        const onsetPassed = isFinite(onsetMs) && (nowMs > onsetMs + ONSET_GRACE_H * HOUR_MS);
        const reason = onsetPassed ? 'onset_passed' : 'forecast_eased';

        // before = prev prediction 값
        const before = {
            windKt: (pp && typeof pp.windKt === 'number') ? pp.windKt : null,
            waveM: (pp && typeof pp.waveM === 'number') ? pp.waveM : null,
            probPct: (pp && typeof pp.probPct === 'number') ? pp.probPct : null,
        };

        // after = 현재 zoneSignal (임계 미만 포함). 없으면 null.
        //   probPct: zoneSignal.prob(엔진이 등급기반으로 채움) 사용, 없으면 0.
        let after = null;
        const sig = signalMap.get(zone);
        if (sig) {
            const wk = sig.windKt;
            const wv = sig.waveM;
            const prob = (typeof sig.prob === 'number') ? sig.prob : 0;
            after = {
                windKt: (typeof wk === 'number') ? wk : null,
                waveM: (typeof wv === 'number') ? wv : null,
                probPct: (typeof prob === 'number' && isFinite(prob)) ? Math.round(prob * 100) : null,
            };
        }

        newlyResolved.push({
            zone,
            office: pp ? pp.office : undefined,
            reason,
            onsetISO: pp && pp.onsetISO ? pp.onsetISO : null,
            resolvedAt: nowISO,
            before,
            after,
            narrative: buildNarrative(reason, zone, before, after),
        });
    }

    // 5) resolved 병합·만료
    //    (a) 기존 prev.resolved + 신규
    //    (b) 현재 active 에 다시 든 zone 제거 (재진입)
    //    (c) now - RESOLVED_KEEP_H 보다 오래된 것 제거 (만료; strict <, 경계값 보존)
    //    (d) zone 중복 시 최신 resolvedAt 유지
    //    (e) 최신순 정렬
    const cutoffMs = nowMs - RESOLVED_KEEP_H * HOUR_MS;
    const byZone = new Map(); // zone → resolvedItem (최신만)

    const consider = (item) => {
        if (!item || typeof item !== 'object') return;
        const zone = zoneKey(item.zone);
        if (!zone) return;
        if (activeZones.has(zone)) return;              // (b) 재진입 → 제외
        const atMs = item.resolvedAt ? Date.parse(item.resolvedAt) : NaN;
        if (isFinite(atMs) && atMs < cutoffMs) return;  // (c) 만료 → 제외 (strict <)
        const cur = byZone.get(zone);
        if (!cur) { byZone.set(zone, item); return; }
        // (d) 중복 — 최신 resolvedAt 유지
        const curMs = cur.resolvedAt ? Date.parse(cur.resolvedAt) : -Infinity;
        const newMs = isFinite(atMs) ? atMs : -Infinity;
        if (newMs >= curMs) byZone.set(zone, item);
    };

    // 기존 먼저, 신규 나중 — 동률(같은 resolvedAt)일 때 신규 항목이 우선되도록.
    for (const it of prev.resolved) consider(it);
    for (const it of newlyResolved) consider(it);

    const resolved = Array.from(byZone.values())
        .sort((a, b) => Date.parse(b.resolvedAt || 0) - Date.parse(a.resolvedAt || 0));

    // 6) 새 상태
    const newState = {
        updatedAt: nowISO,
        baseTimeKST: current.baseTimeKST != null ? current.baseTimeKST : null,
        active,
        resolved,
    };

    if (!opts.noWrite) {
        try {
            fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
            fs.writeFileSync(STATE_PATH, JSON.stringify(newState, null, 2), 'utf8');
        } catch (e) {
            // 저장 실패는 흡수 — 반환값(상태)은 유효하므로 파이프라인 영향 0.
            if (process.env.ADVISORY_DEBUG) console.error('[stateManager] write failed:', e.message);
        }
    }

    return newState;
}

module.exports = { updateState, readPrevState, STATE_PATH };

// 신호 등급/확률은 엔진이 zoneSignal.prob(등급기반)으로 채워 전달 → 여기선 그대로 사용.
