/**
 * run_advisory_render_test.js — node 렌더 테스트 하네스 (브라우저 불필요).
 *   require('./advisory_prediction') 의 buildAdvisoryHtml / buildHeaderStatus 를
 *   mock data 로 호출해 문자열 assert 한다.
 *
 * 실행: node /home/user/SEAGNAL/local_server/js/run_advisory_render_test.js
 * 결과: js/advisory_render_test.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { buildAdvisoryHtml, buildHeaderStatus } = require('./advisory_prediction');

const results = [];
function record(name, pass, detail) {
    results.push({ case: name, pass: !!pass, detail: detail || '' });
    console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

// ---- mock data ------------------------------------------------------------
const ZONE_HIGH = '제주도남쪽바깥먼바다';
const ZONE_WATCH = '제주도남동쪽안쪽먼바다';
const ZONE_RESOLVED = '제주도남서쪽안쪽먼바다';

function makeFullData() {
    return {
        generatedAt: '2026-06-10T12:00:00.000Z',
        baseTimeKST: '2026061021',
        active: [
            // watch 를 일부러 먼저 넣어 정렬이 high 를 앞으로 올리는지 확인
            {
                office: 'jeju', zone: ZONE_WATCH, lat: 33, lon: 126,
                grade: { key: 'watch', label: '관심', emoji: '🟡' },
                probPct: 55, windKt: 22, windMs: 11, waveM: 2.0,
                onsetISO: '2026-06-14T15:00:00Z', onsetLabel: '6/14(일) 새벽',
                narrative: '🟡 ' + ZONE_WATCH + ' 55% · 풍속~22kt · 6/14(일) 새벽'
            },
            {
                office: 'jeju', zone: ZONE_HIGH, lat: 33, lon: 126,
                grade: { key: 'high', label: '높음', emoji: '🔴' },
                probPct: 80, windKt: 30, windMs: 15, waveM: 2.5,
                onsetISO: '2026-06-13T12:00:00Z', onsetLabel: '6/13(토) 밤',
                narrative: '🔴 ' + ZONE_HIGH + ' 80% · 풍속~30kt · 6/13(토) 밤'
            }
        ],
        resolved: [
            {
                zone: ZONE_RESOLVED, office: 'jeju', reason: 'forecast_eased',
                onsetISO: '2026-06-12T00:00:00Z', resolvedAt: '2026-06-10T11:00:00Z',
                before: { windKt: 30, waveM: 3.5, probPct: 65 },
                after: { windKt: 18, waveM: 1.5, probPct: 20 },
                narrative: ZONE_RESOLVED + ' 예보 호전 — 발효 가능성 낮아짐 (풍속 ~30kt→~18kt, 파고 ~3.5m→~1.5m, 가능성 65%→20%)'
            }
        ],
        counts: { high: 1, watch: 1, resolved: 1 },
        filtered: false
    };
}

const emptyData = {
    generatedAt: '2026-06-10T12:00:00.000Z', baseTimeKST: '2026061021',
    active: [], resolved: [], counts: { high: 0, watch: 0, resolved: 0 }, filtered: false
};

// ---- Case 1: full — active 2건(high/watch)+resolved 1건, isVisible=()=>true --
(function () {
    const html = buildAdvisoryHtml(makeFullData(), () => true);
    const checks = [];
    checks.push(['high zone 포함', html.includes(ZONE_HIGH)]);
    checks.push(['watch zone 포함', html.includes(ZONE_WATCH)]);
    checks.push(['80% 포함', html.includes('80%')]);
    checks.push(['onsetLabel 포함', html.includes('6/13(토) 밤')]);
    checks.push(['최근 해소 포함', html.includes('최근 해소')]);
    checks.push(['면책문구 포함', html.includes('SEAGNAL 자체 예측')]);
    checks.push(['기준 시각 포함', html.includes('기준 2026-06-10 21시')]);
    const idxHigh = html.indexOf(ZONE_HIGH);
    const idxWatch = html.indexOf(ZONE_WATCH);
    checks.push(['high가 watch보다 앞', idxHigh !== -1 && idxWatch !== -1 && idxHigh < idxWatch]);

    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case1_full', failed.length === 0,
        failed.length === 0 ? '모든 검사 통과' : '실패: ' + failed.join(', '));
})();

// ---- Case 2: 필터 — isVisible=z=>z===ZONE_HIGH → 그 zone 만 ------------------
(function () {
    const html = buildAdvisoryHtml(makeFullData(), (z) => z === ZONE_HIGH);
    const checks = [];
    checks.push(['high zone 포함', html.includes(ZONE_HIGH)]);
    checks.push(['watch zone 미포함', !html.includes(ZONE_WATCH)]);
    checks.push(['해소 zone 미포함', !html.includes(ZONE_RESOLVED)]);
    checks.push(['최근 해소 섹션 생략', !html.includes('최근 해소')]);
    checks.push(['면책문구 유지', html.includes('SEAGNAL 자체 예측')]);

    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case2_filter', failed.length === 0,
        failed.length === 0 ? '필터 정상' : '실패: ' + failed.join(', '));
})();

// ---- Case 3: 빈 데이터 → "예측된 특보가 없습니다" --------------------------
(function () {
    const html = buildAdvisoryHtml(emptyData, () => true);
    const checks = [];
    checks.push(['빈 안내 문구', html.includes('예측된 특보가 없습니다')]);
    checks.push(['최근 해소 섹션 없음', !html.includes('최근 해소')]);
    checks.push(['면책문구 유지', html.includes('SEAGNAL 자체 예측')]);

    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case3_empty', failed.length === 0,
        failed.length === 0 ? '빈 상태 정상' : '실패: ' + failed.join(', '));
})();

// ---- Case 4: XSS — zone 에 <script> → escape -------------------------------
(function () {
    const data = {
        baseTimeKST: '2026061021',
        active: [{
            office: 'x', zone: '<script>alert(1)</script>',
            grade: { key: 'high', label: '높음', emoji: '🔴' },
            probPct: 80, windKt: 30, onsetLabel: '밤',
            narrative: '<img src=x onerror=alert(2)> 위험'
        }],
        resolved: [],
        counts: { high: 1, watch: 0, resolved: 0 }
    };
    const html = buildAdvisoryHtml(data, () => true);
    const checks = [];
    checks.push(['raw <script> 미포함', !html.includes('<script>alert(1)</script>')]);
    checks.push(['escape된 &lt;script&gt; 포함', html.includes('&lt;script&gt;')]);
    checks.push(['raw onerror 태그 미포함', !html.includes('<img src=x onerror=alert(2)>')]);
    checks.push(['narrative escape 확인', html.includes('&lt;img')]);

    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case4_xss', failed.length === 0,
        failed.length === 0 ? 'XSS escape 정상' : '실패: ' + failed.join(', '));
})();

// ---- Case 5: buildHeaderStatus — counts 반영 + 빈 데이터 --------------------
(function () {
    const hs = buildHeaderStatus(makeFullData(), () => true);
    const hsHighOnly = buildHeaderStatus(makeFullData(), (z) => z === ZONE_HIGH);
    const hsEmpty = buildHeaderStatus(emptyData, () => true);

    const checks = [];
    checks.push(['high 배지(🔴 1)', hs.includes('🔴') && hs.includes('1')]);
    checks.push(['watch 배지(🟡 1)', hs.includes('🟡')]);
    checks.push(['해소 배지', hs.includes('해소')]);
    checks.push(['필터 후 high만(🟡 미포함)', hsHighOnly.includes('🔴') && !hsHighOnly.includes('🟡')]);
    checks.push(['빈 데이터 "예측 없음"', hsEmpty.includes('예측 없음')]);

    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case5_header_status', failed.length === 0,
        failed.length === 0 ? '헤더 배지 정상' : '실패: ' + failed.join(', '));
})();

// ---- Case 6: grade 형태 견고성 — 문자열 grade('high'/'watch')도 정상 렌더 ----
//   회귀 방지: 엔진은 {key,label,emoji} 객체를 출력하지만, 문자열이 들어와도
//   emoji/label/등급색/헤더배지가 깨지지 않아야 한다(normGrade 방어).
(function () {
    const data = {
        baseTimeKST: '2026061021',
        active: [
            { office: 'jeju', zone: ZONE_WATCH, grade: 'watch', probPct: 55, windKt: 22, onsetLabel: '6/14(일) 새벽', narrative: 'w' },
            { office: 'jeju', zone: ZONE_HIGH, grade: 'high', probPct: 80, windKt: 30, onsetLabel: '6/13(토) 밤', narrative: 'h' }
        ],
        resolved: [],
        counts: { high: 1, watch: 1, resolved: 0 }
    };
    const html = buildAdvisoryHtml(data, () => true);
    const hs = buildHeaderStatus(data, () => true);
    const checks = [];
    // 카드: high 항목에 🔴/높음/빨강 클래스, watch 항목에 🟡/관심
    checks.push(['🔴 emoji 보강', html.includes('🔴')]);
    checks.push(['높음 label 보강', html.includes('높음')]);
    checks.push(['🟡 emoji 보강', html.includes('🟡')]);
    checks.push(['관심 label 보강', html.includes('관심')]);
    checks.push(['high 카드 adv-grade-high 클래스', html.includes('adv-grade-high')]);
    checks.push(['watch 카드 adv-grade-watch 클래스', html.includes('adv-grade-watch')]);
    checks.push(['high가 watch보다 앞(정렬)', html.indexOf(ZONE_HIGH) < html.indexOf(ZONE_WATCH)]);
    // 헤더 배지: 문자열 grade 에서도 카운트 정상
    checks.push(['헤더 🔴 1', hs.includes('🔴') && hs.includes('1')]);
    checks.push(['헤더 🟡 포함', hs.includes('🟡')]);
    checks.push(['헤더 빈 문자열 아님', hs.length > 0]);

    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case6_grade_string_robust', failed.length === 0,
        failed.length === 0 ? '문자열 grade 견고성 정상' : '실패: ' + failed.join(', '));
})();

// ---- 결과 출력 + JSON 기록 ------------------------------------------------
const allPass = results.every((r) => r.pass);
const outPath = path.join(__dirname, 'advisory_render_test.json');
fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    variant: 'merged',
    allPass: allPass,
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    results: results
}, null, 2));

console.log('---------------------------------------------------');
console.log((allPass ? 'ALL PASS' : 'SOME FAILED') + '  (' +
    results.filter((r) => r.pass).length + '/' + results.length + ')');
console.log('결과 기록: ' + outPath);

process.exit(allPass ? 0 : 1);
