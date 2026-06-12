'use strict';
/**
 * ============================================================================
 * advisory/journal.js — 예측·결과 누적 저널 (분석력 강화용 데이터 축적)
 * ============================================================================
 *
 *  목적: 운영 중 발생하는 예측(관심/높음)·해소·공식특보 관측을 append-only 로
 *        누적해, "기존 검증(2020~2026 과거데이터) + 운영 누적 데이터"로
 *        확률표·게이트를 주기적으로 재보정할 수 있는 원천을 만든다.
 *
 *  파일: data/advisory_journal.jsonl (JSONL, 한 줄당 한 사건. gitignore — Fly 볼륨)
 *   - {k:'pred', t, base, zone, grade, prob, windKt, waveM, areaPct, onsetISO, st}
 *       st: 'shown'(표출) | 'pending'(지속성 대기) | 'suppressed'(공식특보로 억제 — 즉시 적중 증거)
 *   - {k:'warn', t, zone}   현재 발효 중 공식 풍랑/태풍 특보 구역 관측(신규 등장 시 1회)
 *
 *  중복 방지(파일 비대 억제):
 *   - pred: 같은 (zone, base) 는 1회만 기록(시간당 사이클이 같은 run 을 반복하므로).
 *   - warn: 같은 zone 은 '연속 관측'이 끊긴 뒤에만 재기록(에피소드 단위) — 마지막
 *           관측이 RE_OBSERVE_H 이내면 스킵.
 *
 *  결과(적중/미적중) 판정은 기록 시점이 아니라 분석 시점에 조인으로 계산한다
 *  (append-only 유지): analysis/wave_leadtime/journal_report.js 참고.
 *  모든 동작 graceful — 저널 실패가 예측 사이클을 깨지 않는다.
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

let DATA_DIR;
try { ({ DATA_DIR } = require('../config/server_config')); } catch (_) { DATA_DIR = null; }
if (!DATA_DIR) DATA_DIR = path.resolve(__dirname, '..', 'data');

const JOURNAL_FILE = path.join(DATA_DIR, 'advisory_journal.jsonl');
const RE_OBSERVE_H = 30;            // warn 재기록 간격(에피소드 분리 기준)
const TAIL_SCAN_BYTES = 512 * 1024; // 중복판정용 꼬리 스캔(전체 로드 회피)

function appendLines(lines) {
    if (!lines.length) return true;
    try {
        fs.mkdirSync(path.dirname(JOURNAL_FILE), { recursive: true });
        fs.appendFileSync(JOURNAL_FILE, lines.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8');
        return true;
    } catch (_) { return false; }
}

/** 꼬리 N바이트만 읽어 최근 항목 파싱(중복 방지 판정용). 실패 시 []. */
function readTail() {
    try {
        const st = fs.statSync(JOURNAL_FILE);
        const start = Math.max(0, st.size - TAIL_SCAN_BYTES);
        const fd = fs.openSync(JOURNAL_FILE, 'r');
        const buf = Buffer.alloc(st.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        const out = [];
        for (const ln of buf.toString('utf8').split('\n')) {
            const s = ln.trim(); if (!s) continue;
            try { out.push(JSON.parse(s)); } catch (_) { /* 부분 줄 — 무시 */ }
        }
        return out;
    } catch (_) { return []; }
}

/**
 * 한 사이클의 예측/관측을 기록한다. 모든 인자 graceful.
 * @param {object} p
 *        p.baseTimeKST  — run 슬롯('YYYYMMDDHH')
 *        p.shown        — 표출 예측 배열
 *        p.pending      — 지속성 대기 배열
 *        p.suppressed   — 억제된 예측 배열(공식특보 구역 — 즉시 적중 증거)
 *        p.warnZones    — 현재 발효 중 공식 풍랑/태풍 특보 구역 이름 배열
 * @returns {{preds:number, warns:number}} 신규 기록 수
 */
function logCycle(p) {
    p = p && typeof p === 'object' ? p : {};
    const now = new Date().toISOString();
    const base = p.baseTimeKST || null;
    const tail = readTail();

    // 중복 키 구성
    const seenPred = new Set();
    const lastWarnAt = new Map();
    for (const r of tail) {
        if (r.k === 'pred' && r.zone && r.base) seenPred.add(r.zone + '|' + r.base);
        else if (r.k === 'warn' && r.zone) lastWarnAt.set(r.zone, Date.parse(r.t) || 0);
    }

    const lines = [];
    const pushPred = (arr, st) => {
        for (const x of (Array.isArray(arr) ? arr : [])) {
            if (!x || !x.zone) continue;
            const key = x.zone + '|' + base;
            if (base && seenPred.has(key)) continue;
            seenPred.add(key);
            lines.push({
                k: 'pred', t: now, base, zone: x.zone,
                grade: (x.grade && x.grade.key) || null, prob: x.probPct != null ? x.probPct : null,
                windKt: x.windKt != null ? x.windKt : null, waveM: x.waveM != null ? x.waveM : null,
                areaPct: x.areaPct != null ? x.areaPct : null,
                onsetISO: x.onsetISO || null, st,
            });
        }
    };
    pushPred(p.shown, 'shown');
    pushPred(p.pending, 'pending');
    pushPred(p.suppressed, 'suppressed');

    let warns = 0;
    const nowMs = Date.now();
    for (const z of (Array.isArray(p.warnZones) ? p.warnZones : [])) {
        if (!z) continue;
        const last = lastWarnAt.get(z) || 0;
        if (nowMs - last < RE_OBSERVE_H * 3600 * 1000) continue; // 같은 에피소드 — 스킵
        lastWarnAt.set(z, nowMs);
        lines.push({ k: 'warn', t: now, zone: z });
        warns++;
    }

    appendLines(lines);
    return { preds: lines.length - warns, warns };
}

// ── 통계(적중/미적중 판정 + 집계) — 관리자 탭·journal_report 공용 ────────────
const WIN_BEFORE_H = 12, WIN_AFTER_H = 24; // 적중 창: onset −12h ~ +24h

/** 저널 전체 로드(통계용 — 관리자 조회 빈도라 전량 읽기 허용). */
function readAll() {
    const preds = [], warns = [];
    try {
        for (const ln of fs.readFileSync(JOURNAL_FILE, 'utf8').split('\n')) {
            const s = ln.trim(); if (!s) continue;
            let r; try { r = JSON.parse(s); } catch (_) { continue; }
            if (r.k === 'pred') preds.push(r); else if (r.k === 'warn') warns.push(r);
        }
    } catch (_) { /* 저널 없음 */ }
    return { preds, warns };
}

/**
 * 등급별/확률구간별 적중 통계 (+ 기간 조회/월별 누적).
 *  - 적중: onset −12h~+24h 창에 같은 zone 공식특보 관측. 억제(suppressed) 기록은 정의상 적중.
 *  - 창이 안 끝났으면 '진행중'(미결정).
 *  - 기간 필터(opt.fromMs/toMs): 예측 '기록 시각' 기준으로 집계 대상을 제한.
 *    (warn 관측은 기간과 무관하게 전체 사용 — 창 끝이 기간 밖이어도 판정 정확)
 * @param {{fromMs?:number, toMs?:number}} [opt]
 * @returns {{counts, byGrade, byProb, byMonth, recent, period, window}}
 */
function computeStats(opt) {
    opt = opt && typeof opt === 'object' ? opt : {};
    const { preds: allPreds, warns } = readAll();
    const H = 3600 * 1000;
    const fromMs = isFinite(opt.fromMs) ? opt.fromMs : -Infinity;
    const toMs = isFinite(opt.toMs) ? opt.toMs : Infinity;
    const preds = allPreds.filter((p) => {
        const t = Date.parse(p.t);
        return isFinite(t) && t >= fromMs && t <= toMs;
    });
    const warnByZone = new Map();
    for (const w of warns) {
        const t = Date.parse(w.t); if (!isFinite(t)) continue;
        if (!warnByZone.has(w.zone)) warnByZone.set(w.zone, []);
        warnByZone.get(w.zone).push(t);
    }
    const now = Date.now();
    for (const p of preds) {
        if (p.st === 'suppressed') { p.outcome = 'hit'; continue; }
        const onset = Date.parse(p.onsetISO || '');
        if (!isFinite(onset)) { p.outcome = 'invalid'; continue; }
        const lo = onset - WIN_BEFORE_H * H, hi = onset + WIN_AFTER_H * H;
        if ((warnByZone.get(p.zone) || []).some((t) => t >= lo && t <= hi)) p.outcome = 'hit';
        else p.outcome = (now > hi) ? 'miss' : 'pending';
    }
    const agg = (arr) => {
        const hit = arr.filter((p) => p.outcome === 'hit').length;
        const miss = arr.filter((p) => p.outcome === 'miss').length;
        const pending = arr.filter((p) => p.outcome === 'pending').length;
        const decided = hit + miss;
        return { hit, miss, pending, decided, ratePct: decided ? Math.round(hit / decided * 100) : null };
    };
    const byProb = [[51, 56], [57, 64], [65, 100]].map(([lo, hi]) => Object.assign(
        { range: `${lo}~${hi}%` }, agg(preds.filter((p) => p.prob >= lo && p.prob <= hi))));
    // 월별 누적 (기록 시각 기준 YYYY-MM, 최신 월 먼저)
    const monthKey = (p) => {
        const d = new Date(Date.parse(p.t));
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    const monthMap = new Map();
    for (const p of preds) {
        const k = monthKey(p);
        if (!monthMap.has(k)) monthMap.set(k, []);
        monthMap.get(k).push(p);
    }
    const byMonth = Array.from(monthMap.entries())
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([month, arr]) => Object.assign({ month }, agg(arr)));
    const recent = preds
        .filter((p) => p.outcome === 'hit' || p.outcome === 'miss')
        .sort((a, b) => Date.parse(b.t) - Date.parse(a.t))
        .slice(0, 20)
        .map((p) => ({ t: p.t, zone: p.zone, grade: p.grade, prob: p.prob, st: p.st, outcome: p.outcome }));
    return {
        counts: { pred: preds.length, warn: warns.length, ...agg(preds) },
        byGrade: {
            high: agg(preds.filter((p) => p.grade === 'high')),
            watch: agg(preds.filter((p) => p.grade === 'watch')),
        },
        byProb, byMonth, recent,
        period: {
            from: isFinite(fromMs) && fromMs !== -Infinity ? new Date(fromMs).toISOString() : null,
            to: isFinite(toMs) && toMs !== Infinity ? new Date(toMs).toISOString() : null,
        },
        window: { beforeH: WIN_BEFORE_H, afterH: WIN_AFTER_H },
    };
}

module.exports = { JOURNAL_FILE, logCycle, readTail, readAll, computeStats };
