'use strict';
/**
 * run_crossref_test.js — crossReference 순수 함수 검증(네트워크/디스크 0).
 *
 *   onsetToSlot / parseWindSpeed / parseWaveHeight / buildKmaForecast /
 *   enrichPredictions 를 mock 으로 검증한다.
 *
 * 산출: crossref_test_integrated.json  +  stdout PASS/FAIL.
 * 실행: node /home/user/SEAGNAL/local_server/advisory/run_crossref_test.js
 */
const fs = require('fs');
const path = require('path');
const cx = require('./crossReference');

const OUT = path.join(__dirname, 'crossref_test_integrated.json');
const results = [];
function rec(name, pass, detail) {
    results.push({ case: name, pass: !!pass, detail: detail || '' });
    console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

// ── 1) onsetToSlot — UTC → KST 슬롯(오전/오후) ────────────────────────────────
(function () {
    const checks = [];
    // 2026-06-13T12:00Z → KST 21시 → 20260613 / pm
    const a = cx.onsetToSlot('2026-06-13T12:00:00.000Z');
    checks.push(['밤(pm)', a && a.date === '20260613' && a.period === 'pm']);
    // 2026-06-14T00:00Z → KST 09시 → 20260614 / am
    const b = cx.onsetToSlot('2026-06-14T00:00:00.000Z');
    checks.push(['오전(am)', b && b.date === '20260614' && b.period === 'am']);
    // 2026-06-14T06:00Z → KST 15시 → 20260614 / pm
    const c = cx.onsetToSlot('2026-06-14T06:00:00.000Z');
    checks.push(['오후(pm)', c && c.date === '20260614' && c.period === 'pm']);
    // 날짜 넘김: 2026-06-13T15:00Z → KST 익일 00시 → 20260614 / am
    const d = cx.onsetToSlot('2026-06-13T15:00:00.000Z');
    checks.push(['자정 넘김', d && d.date === '20260614' && d.period === 'am']);
    checks.push(['잘못된 입력 → null', cx.onsetToSlot('nope') === null && cx.onsetToSlot('') === null]);
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    rec('onsetToSlot', failed.length === 0, failed.length ? '실패: ' + failed.join(', ') : 'OK');
})();

// ── 2) parseWindSpeed / parseWaveHeight ──────────────────────────────────────
(function () {
    const checks = [];
    checks.push(['방향/속도', cx.parseWindSpeed('북동~동 / 7~11') === '7~11']);
    checks.push(['속도 단독', cx.parseWindSpeed('9~13') === '9~13']);
    checks.push(['공백 제거', cx.parseWindSpeed('남서 / 10 ~ 14') === '10~14']);
    checks.push(['하이픈 → null', cx.parseWindSpeed('-') === null]);
    checks.push(['빈값 → null', cx.parseWindSpeed('') === null && cx.parseWindSpeed(null) === null]);
    checks.push(['파고 범위', cx.parseWaveHeight('0.5~1.0') === '0.5~1.0']);
    checks.push(['파고 단일', cx.parseWaveHeight('1.5') === '1.5']);
    checks.push(['파고 하이픈 → null', cx.parseWaveHeight('-') === null]);
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    rec('parse_wind_wave', failed.length === 0, failed.length ? '실패: ' + failed.join(', ') : 'OK');
})();

// ── 3) buildKmaForecast — 슬롯 매칭 ──────────────────────────────────────────
(function () {
    const zf = {
        publishTime: '2026061105',
        periods: [
            { date: '20260613', period: 'am', wind: '북 / 5~8', waveHeight: '0.5' },
            { date: '20260613', period: 'pm', wind: '북서~서 / 12~16', waveHeight: '1.5~2.5' },
            { date: '20260614', period: 'am', wind: '-', waveHeight: '-' },
        ],
    };
    const checks = [];
    const hit = cx.buildKmaForecast(zf, '2026-06-13T12:00:00.000Z'); // KST 21시 pm
    checks.push(['pm 매칭 풍속', hit && hit.windSpeed === '12~16']);
    checks.push(['pm 매칭 파고', hit && hit.waveHeight === '1.5~2.5']);
    checks.push(['periodLabel', hit && /6\/13.*오후/.test(hit.periodLabel)]);
    checks.push(['publishTime 전달', hit && hit.publishTime === '2026061105']);

    const am = cx.buildKmaForecast(zf, '2026-06-13T00:00:00.000Z'); // KST 09시 am
    checks.push(['am 매칭 풍속', am && am.windSpeed === '5~8']);

    // 슬롯 둘 다 '-' → null
    const none = cx.buildKmaForecast(zf, '2026-06-14T00:00:00.000Z'); // 20260614 am, 둘 다 '-'
    checks.push(['표출값 없으면 null', none === null]);

    // 매칭 슬롯 없음(없는 날짜) → null
    const miss = cx.buildKmaForecast(zf, '2026-06-20T00:00:00.000Z');
    checks.push(['슬롯 없음 → null', miss === null]);

    // 빈/잘못된 입력
    checks.push(['빈 forecast → null', cx.buildKmaForecast(null, '2026-06-13T12:00:00Z') === null]);
    checks.push(['periods 없음 → null', cx.buildKmaForecast({}, '2026-06-13T12:00:00Z') === null]);

    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    rec('buildKmaForecast', failed.length === 0, failed.length ? '실패: ' + failed.join(', ') : 'OK');
})();

// ── 4) enrichPredictions — 매칭 시 부착 / 미매칭 시 원본 보존 ─────────────────
(function () {
    const map = {
        '제주도남쪽바깥먼바다': {
            publishTime: '2026061105',
            periods: [{ date: '20260613', period: 'pm', wind: '서 / 14~18', waveHeight: '2.0~3.0' }],
        },
    };
    const predictions = [
        { zone: '제주도남쪽바깥먼바다', onsetISO: '2026-06-13T12:00:00.000Z', probPct: 80 },
        { zone: '동해북부앞바다', onsetISO: '2026-06-13T12:00:00.000Z', probPct: 63 }, // map 에 없음
    ];
    const out = cx.enrichPredictions(predictions, map);
    const checks = [];
    checks.push(['배열 길이 유지', out.length === 2]);
    checks.push(['매칭 항목 kmaForecast 부착', out[0].kmaForecast && out[0].kmaForecast.windSpeed === '14~18']);
    checks.push(['매칭 파고', out[0].kmaForecast && out[0].kmaForecast.waveHeight === '2.0~3.0']);
    checks.push(['미매칭 항목 원본 참조 유지', out[1] === predictions[1] && !out[1].kmaForecast]);
    checks.push(['원본 불변(mutate 안 함)', !predictions[0].kmaForecast]);
    // 빈 맵 → 전부 원본 참조
    const out2 = cx.enrichPredictions(predictions, {});
    checks.push(['빈 맵 → 원본 그대로', out2[0] === predictions[0] && out2[1] === predictions[1]]);
    // 비배열 방어
    checks.push(['비배열 입력 방어', cx.enrichPredictions(null, map) === null]);
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    rec('enrichPredictions', failed.length === 0, failed.length ? '실패: ' + failed.join(', ') : 'OK');
})();

// ── 결과 기록 ────────────────────────────────────────────────────────────────
const allPass = results.every((r) => r.pass);
fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    allPass,
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    results,
}, null, 2));
console.log('---------------------------------------------------');
console.log((allPass ? 'ALL PASS' : 'SOME FAILED') +
    '  (' + results.filter((r) => r.pass).length + '/' + results.length + ')');
console.log('결과 기록: ' + OUT);
process.exit(allPass ? 0 : 1);
