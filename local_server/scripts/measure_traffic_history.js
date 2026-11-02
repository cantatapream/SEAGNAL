/**
 * 파일명: local_server/scripts/measure_traffic_history.js
 * 역할  : 30분 교통량 이력의 실제 크기를 잰다 — 가짜 자료(4,046칸 × 5분 6번 × 48칸)로 하루 압축 파일 크기,
 *         1년 추정, 최근 15일을 메모리에 올렸을 때 늘어난 양. 설계 문서의 숫자를 다시 만들 수 있게 남긴다.
 * [연계] services/sea_traffic_history.js(add·series) · client/js/marine-life/risk-forecast/traffic_history.design.md(실측 표)
 * [로드 순서] 독립 실행: `node --expose-gc local_server/scripts/measure_traffic_history.js` — 네트워크·실제 키 없음, 임시 폴더만 쓴다.
 *        가짜 척수 분포: 칸마다 평균 λ = 80·u³ (u 는 0~1 균등, 중앙값 10척·평균 20척), 5분 값은 포아송(λ)을 0~80 으로 자름.
 *        실제 분포는 확인하지 않았다(운영 자료 없음) — 숫자 크기에는 영향이 있으니 결과를 어림값으로 읽는다.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('../services/sea_traffic_history');
const CELLS = 4046, DAY = 86400000, HOUR = 3600000;

let seed = 20261015;
/** 같은 결과가 나오도록 고정 씨앗 난수(mulberry32 — 32비트 정수 연산이라 큰 수 곱셈의 정밀도 손실이 없다). @returns {number} 0~1 [연계] ← poisson·main */
function rand() { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
/** 포아송 난수(크누스 방식, λ≤80 이면 충분히 빠름). @param {number} l 평균 @returns {number} [연계] ← main */
function poisson(l) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= rand(); } while (p > L); return k - 1; }
/** 실제 번호 짜임의 칸 번호를 n개 만든다(한반도 주변 범위). @param {number} n @returns {string[]} [연계] ← main */
function cellIds(n) {
    const C = require('../services/sea_realtime_collector'), out = new Set(), L = 'ABCDEFGHIJKLMNOP', Y = 'ABCDEFGHIJKLMNOPQRSTUVWXY';
    while (out.size < n) {
        const id = 'GR4_' + 'EFGH'[Math.floor(rand() * 4)] + (1 + Math.floor(rand() * 4)) + L[Math.floor(rand() * 16)] + (1 + Math.floor(rand() * 4)) + (1 + Math.floor(rand() * 4)) + '_' + Y[Math.floor(rand() * 25)] + (1 + Math.floor(rand() * 4));
        const b = C.cellBounds(id);
        if (b && b[0] >= 123 && b[2] <= 132 && b[1] >= 32 && b[3] <= 39) out.add(id);
    }
    return [...out];
}
/** 메모리(힙 + 형식 배열) 사용량을 GC 후 잰다. @returns {number} 바이트 [연계] ← main */
function mem() { if (global.gc) { global.gc(); global.gc(); } const m = process.memoryUsage(); return m.heapUsed + m.arrayBuffers; }

const ids = cellIds(CELLS), lambda = ids.map(() => 80 * rand() ** 3);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-measure-'));
const day0 = Date.parse('2026-10-14T00:00:00+09:00');
let now = day0;
const h = H.createHistory({ dir, clock: () => now });
const t0 = Date.now();
let openSize = 0;
for (let k = 0; k < 24 * 12; k++) {
    now = day0 + k * 300000 + 6000;
    const at = new Date(now + 9 * HOUR).toISOString().slice(0, 19) + '+09:00';
    h.add({ sourceAt: at, rows: ids.map((id, i) => ({ id, count: Math.min(80, poisson(lambda[i])) })) });
    if (k === 5) openSize = fs.statSync(path.join(dir, 'traffic_history', 'open.json.gz')).size;
}
now = day0 + DAY + 60000; h.flush();
const addMs = Date.now() - t0;
const folder = path.join(dir, 'traffic_history'), dayFile = path.join(folder, '2026-10-14.json.gz');
const daySize = fs.statSync(dayFile).size;
const raw = require('zlib').gunzipSync(fs.readFileSync(dayFile)).length;
// 같은 하루를 15일치로 복사해 메모리 증가를 잰다(칸 구성이 날마다 같다고 본 경우).
const content = JSON.parse(require('zlib').gunzipSync(fs.readFileSync(dayFile)));
const io = require('../services/risk_collector_io');
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-measure2-')), today = Date.parse('2026-10-15T12:00:00+09:00');
for (let d = 0; d < 15; d++) { const date = io.day(today - d * DAY); io.write(path.join(dir2, 'traffic_history', date + '.json.gz'), { ...content, date }); }
const before = mem(), t1 = Date.now();
const h2 = H.createHistory({ dir: dir2, clock: () => today });
const s = h2.series(ids[0], Date.parse('2026-10-02T00:00:00+09:00'), 672);
const loadMs = Date.now() - t1, after = mem();
const t2 = Date.now(); for (let i = 0; i < 100; i++) h2.series(ids[i], Date.parse('2026-10-02T00:00:00+09:00'), 672); const queryMs = (Date.now() - t2) / 100;
console.log(JSON.stringify({
    cells: CELLS, samplesPerSlot: 6, openFileGzipBytes: openSize, dayFileGzipBytes: daySize, dayFileRawBytes: raw, yearEstimateMB: +(daySize * 365 / 1048576).toFixed(1),
    memoryDays: h2._memory().days.length, memoryIncreaseMB: +((after - before) / 1048576).toFixed(2), gcExposed: !!global.gc,
    oneDayAddMs: addMs, loadFifteenDaysMs: loadMs, queryOneCellMs: +queryMs.toFixed(3), sampleValues: s.values.slice(-60, -48)
}, null, 1));
fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(dir2, { recursive: true, force: true });
