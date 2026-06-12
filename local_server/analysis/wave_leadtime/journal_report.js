'use strict';
/**
 * journal_report.js — 운영 누적 저널(advisory_journal.jsonl) 적중률 분석.
 *
 *  목적: "기존 검증(2020~2026) + 운영 누적" 결합 재보정의 입력.
 *   - pred(표출/대기/억제) 사건마다, 같은 zone 의 warn 관측이 [onset−12h, onset+24h]
 *     창에 있으면 적중(hit). 창이 아직 안 끝났으면 pending, 끝났으면 miss.
 *   - 등급·확률구간·신호강도별 적중률 표 + 보정표(probPctOf)와의 괴리 출력.
 *   - 표본이 쌓이면(권장 ≥100 결정 사례) calib_abs 의 게이트 스윕에 운영 표본을
 *     합산해 재보정한다(별도 단계).
 *
 *  실행: node analysis/wave_leadtime/journal_report.js
 *  산출: reports/JOURNAL_report.md (+ stdout)
 */
const fs = require('fs');
const path = require('path');

const JOURNAL = path.join(__dirname, '..', '..', 'data', 'advisory_journal.jsonl');
const OUT_MD = path.join(__dirname, 'reports', 'JOURNAL_report.md');
const H = 3600 * 1000;
const WIN_BEFORE_H = 12, WIN_AFTER_H = 24;

function loadAll() {
    let preds = [], warns = [];
    try {
        for (const ln of fs.readFileSync(JOURNAL, 'utf8').split('\n')) {
            const s = ln.trim(); if (!s) continue;
            let r; try { r = JSON.parse(s); } catch (_) { continue; }
            if (r.k === 'pred') preds.push(r); else if (r.k === 'warn') warns.push(r);
        }
    } catch (_) { /* 저널 없음 */ }
    return { preds, warns };
}

(function main() {
    const { preds, warns } = loadAll();
    const warnByZone = new Map();
    for (const w of warns) {
        const t = Date.parse(w.t); if (!isFinite(t)) continue;
        if (!warnByZone.has(w.zone)) warnByZone.set(w.zone, []);
        warnByZone.get(w.zone).push(t);
    }
    for (const a of warnByZone.values()) a.sort((x, y) => x - y);

    const now = Date.now();
    for (const p of preds) {
        // 억제 기록은 공식특보가 이미 발효 중 → 정의상 적중
        if (p.st === 'suppressed') { p.outcome = 'hit'; continue; }
        const onset = Date.parse(p.onsetISO || '');
        if (!isFinite(onset)) { p.outcome = 'invalid'; continue; }
        const lo = onset - WIN_BEFORE_H * H, hi = onset + WIN_AFTER_H * H;
        const hit = (warnByZone.get(p.zone) || []).some((t) => t >= lo && t <= hi);
        if (hit) p.outcome = 'hit';
        else p.outcome = (now > hi) ? 'miss' : 'pending';
    }

    const decided = preds.filter((p) => p.outcome === 'hit' || p.outcome === 'miss');
    const pend = preds.filter((p) => p.outcome === 'pending').length;
    const pc = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '-';
    const rate = (arr) => pc(arr.filter((p) => p.outcome === 'hit').length, arr.length);

    let md = `# 운영 누적 저널 적중률 (advisory_journal)\n\n`;
    md += `pred ${preds.length} (결정 ${decided.length} · 진행중 ${pend}) · warn 관측 ${warns.length}\n\n`;
    md += `| 분류 | 표본(결정) | 적중률 | 보정표 기대 |\n|---|---|---|---|\n`;
    const byGrade = { high: decided.filter((p) => p.grade === 'high'), watch: decided.filter((p) => p.grade === 'watch') };
    md += `| 🔴 높음 | ${byGrade.high.length} | **${rate(byGrade.high)}** | 64~70% |\n`;
    md += `| 🟡 관심 | ${byGrade.watch.length} | **${rate(byGrade.watch)}** | 51~58% |\n`;
    for (const [lo, hi2] of [[51, 56], [57, 64], [65, 100]]) {
        const g = decided.filter((p) => p.prob >= lo && p.prob <= hi2);
        md += `| 확률 ${lo}~${hi2}% | ${g.length} | ${rate(g)} | ${lo}~${hi2}% |\n`;
    }
    const shownOnly = decided.filter((p) => p.st === 'shown');
    md += `| 표출분만 | ${shownOnly.length} | ${rate(shownOnly)} | — |\n`;
    md += `\n- 적중 창: onset −${WIN_BEFORE_H}h ~ +${WIN_AFTER_H}h 내 공식 풍랑/태풍 발효 관측.\n`;
    md += `- 억제(suppressed) 기록은 공식특보 발효 중 신호 = 정의상 적중으로 집계.\n`;
    md += `- 결정 표본 ≥100 누적 시: calib_abs 게이트 스윕에 운영 표본 합산 → probPctOf 재보정 권장.\n`;

    try { fs.writeFileSync(OUT_MD, md); } catch (_) { /* reports 없으면 stdout만 */ }
    console.log(md);
})();
