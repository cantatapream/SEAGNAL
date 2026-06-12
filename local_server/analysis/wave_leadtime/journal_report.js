'use strict';
/**
 * journal_report.js — 운영 누적 저널(advisory_journal.jsonl) 적중률 분석.
 *
 *  목적: "기존 검증(2020~2026) + 운영 누적" 결합 재보정의 입력.
 *  판정·집계는 advisory/journal.computeStats() 공용(관리자 탭 통계와 동일 숫자).
 *  표본이 쌓이면(권장 결정 ≥100) calib_abs 게이트 스윕에 운영 표본을 합산해
 *  probPctOf 를 재보정한다(별도 단계).
 *
 *  실행: node analysis/wave_leadtime/journal_report.js
 *  산출: reports/JOURNAL_report.md (+ stdout)
 */
const fs = require('fs');
const path = require('path');
const { computeStats } = require('../../advisory/journal');

const OUT_MD = path.join(__dirname, 'reports', 'JOURNAL_report.md');

(function main() {
    const s = computeStats();
    const pc = (v) => v == null ? '-' : v + '%';
    const row = (label, a, expect) =>
        `| ${label} | ${a.hit} | ${a.miss} | ${a.pending} | **${pc(a.ratePct)}** | ${expect} |\n`;

    let md = `# 운영 누적 저널 적중률 (advisory_journal)\n\n`;
    md += `pred ${s.counts.pred} (결정 ${s.counts.decided} · 진행중 ${s.counts.pending}) · warn 관측 ${s.counts.warn}\n\n`;
    md += `| 분류 | 적중 | 미적중 | 진행중 | 적중률 | 보정표 기대 |\n|---|---|---|---|---|---|\n`;
    md += row('🔴 높음', s.byGrade.high, '64~70%');
    md += row('🟡 관심', s.byGrade.watch, '51~58%');
    for (const b of s.byProb) md += row(`확률 ${b.range}`, b, b.range);
    md += `\n- 적중 창: onset −${s.window.beforeH}h ~ +${s.window.afterH}h 내 공식 풍랑/태풍 발효 관측.\n`;
    md += `- 억제(suppressed) 기록은 공식특보 발효 중 신호 = 정의상 적중으로 집계.\n`;
    md += `- 결정 표본 ≥100 누적 시: calib_abs 게이트 스윕에 운영 표본 합산 → probPctOf 재보정 권장.\n`;

    try { fs.writeFileSync(OUT_MD, md); } catch (_) { /* reports 없으면 stdout만 */ }
    console.log(md);
})();
