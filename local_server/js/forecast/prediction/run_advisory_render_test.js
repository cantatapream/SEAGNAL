/**
 * run_advisory_render_test.js — node 렌더 테스트 하네스 (브라우저 불필요).
 * 역할  : node 렌더 테스트 하네스 — advisory_prediction(v6) 렌더 함수 검증 (브라우저 불필요)
 *   advisory_prediction(v6) 의 buildAdvisoryHtml / buildHeaderStatus / formatBaseTime 검증.
 *
 * 실행: node /home/user/SEAGNAL/local_server/js/run_advisory_render_test.js
 * 결과: js/advisory_render_test.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { buildAdvisoryHtml, buildHeaderStatus, formatBaseTime } = require('./advisory_prediction');

const DISCLAIMER = '자체 예측 결과';   // 새 면책문구 핵심구

const results = [];
function record(name, pass, detail) {
    results.push({ case: name, pass: !!pass, detail: detail || '' });
    console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

const ZONE_HIGH = '제주도남쪽바깥먼바다';
const ZONE_WATCH = '제주도남동쪽안쪽먼바다';
const ZONE_RESOLVED = '제주도남서쪽안쪽먼바다';

function makeFullData() {
    return {
        generatedAt: '2026-06-10T12:00:00.000Z',
        baseTimeKST: '2026061021',
        active: [
            { office: 'jeju', zone: ZONE_WATCH, grade: { key: 'watch', label: '관심', emoji: '🟡' },
              probPct: 56, windKt: 27, windMs: 14, waveM: 2.0, areaPct: 55, onsetLabel: '6/14(일) 새벽' },
            { office: 'jeju', zone: ZONE_HIGH, grade: { key: 'high', label: '높음', emoji: '🔴' },
              probPct: 70, windKt: 35, windMs: 18, waveM: 2.5, areaPct: 70, onsetLabel: '6/13(토) 밤' }
        ],
        resolved: [
            { zone: ZONE_RESOLVED, office: 'jeju', reason: 'forecast_eased',
              narrative: ZONE_RESOLVED + ' 예보 호전 — 발효 가능성 낮아짐' }
        ],
        counts: { high: 1, watch: 1, resolved: 1 }, filtered: false
    };
}
const emptyData = { baseTimeKST: '2026061021', active: [], resolved: [], counts: { high: 0, watch: 0, resolved: 0 } };

// Case 1: full
(function () {
    const html = buildAdvisoryHtml(makeFullData(), () => true);
    const checks = [];
    checks.push(['high zone 포함', html.includes(ZONE_HIGH)]);
    checks.push(['watch zone 포함', html.includes(ZONE_WATCH)]);
    checks.push(['확률배지(70% 확률)', html.includes('70% 확률')]);
    checks.push(['onsetLabel 포함(서술)', html.includes('6/13(토) 밤')]);
    checks.push(['카드 아코디언(adv-card-head)', html.includes('adv-card-head')]);
    checks.push(['카드 이모지 제거(🔴 없음)', !html.includes('🔴')]);
    checks.push(['최근 해소 포함', html.includes('최근 해소')]);
    checks.push(['새 면책문구(최상단)', html.includes(DISCLAIMER) && html.indexOf('adv-disclaimer-top') < html.indexOf(ZONE_HIGH)]);
    checks.push(['기준시각 바디에 없음(헤더로 이동)', !html.includes('기준')]);
    checks.push(['high가 watch보다 앞', html.indexOf(ZONE_HIGH) !== -1 && html.indexOf(ZONE_HIGH) < html.indexOf(ZONE_WATCH)]);
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case1_full', failed.length === 0, failed.length === 0 ? '모든 검사 통과' : '실패: ' + failed.join(', '));
})();

// Case 2: 필터
(function () {
    const html = buildAdvisoryHtml(makeFullData(), (z) => z === ZONE_HIGH);
    const checks = [];
    checks.push(['high zone 포함', html.includes(ZONE_HIGH)]);
    checks.push(['watch zone 미포함', !html.includes(ZONE_WATCH)]);
    checks.push(['해소 zone 미포함', !html.includes(ZONE_RESOLVED)]);
    checks.push(['최근 해소 섹션 생략', !html.includes('최근 해소')]);
    checks.push(['면책문구 유지', html.includes(DISCLAIMER)]);
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case2_filter', failed.length === 0, failed.length === 0 ? '필터 정상' : '실패: ' + failed.join(', '));
})();

// Case 3: 빈 데이터 — 면책문구도 미표출(예측 정보 있을 때만)
(function () {
    const html = buildAdvisoryHtml(emptyData, () => true);
    const checks = [];
    checks.push(['빈 안내 문구', html.includes('예측된 특보가 없습니다')]);
    checks.push(['최근 해소 섹션 없음', !html.includes('최근 해소')]);
    checks.push(['면책문구 미표출(빈 상태)', !html.includes(DISCLAIMER)]);
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case3_empty', failed.length === 0, failed.length === 0 ? '빈 상태 정상' : '실패: ' + failed.join(', '));
})();

// Case 4: XSS — zone escape (narrative 필드는 active 카드에서 미사용 → 필드 기반 재구성)
(function () {
    const data = {
        baseTimeKST: '2026061021',
        active: [{ office: 'x', zone: '<script>alert(1)</script>', grade: { key: 'high', label: '높음', emoji: '🔴' },
            probPct: 70, windKt: 35, windMs: 18, waveM: 2.5, areaPct: 70, onsetLabel: '밤' }],
        resolved: [], counts: { high: 1, watch: 0, resolved: 0 }
    };
    const html = buildAdvisoryHtml(data, () => true);
    const checks = [];
    checks.push(['raw <script> 미포함', !html.includes('<script>alert(1)</script>')]);
    checks.push(['escape된 &lt;script&gt; 포함', html.includes('&lt;script&gt;')]);
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case4_xss', failed.length === 0, failed.length === 0 ? 'XSS escape 정상' : '실패: ' + failed.join(', '));
})();

// Case 5: buildHeaderStatus
(function () {
    const hs = buildHeaderStatus(makeFullData(), () => true);
    const hsHighOnly = buildHeaderStatus(makeFullData(), (z) => z === ZONE_HIGH);
    const hsEmpty = buildHeaderStatus(emptyData, () => true);
    const checks = [];
    checks.push(['high 배지(🔴 1)', hs.includes('🔴') && hs.includes('1')]);
    checks.push(['watch 배지(🟡 1)', hs.includes('🟡')]);
    checks.push(['해소 배지(초록원+체크, 숫자만)', hs.includes('adv-dot-check') && !hs.includes('해소')]);
    checks.push(['필터 후 high만(🟡 미포함)', hsHighOnly.includes('🔴') && !hsHighOnly.includes('🟡')]);
    checks.push(['빈 데이터 "예측 없음"', hsEmpty.includes('예측 없음')]);
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case5_header_status', failed.length === 0, failed.length === 0 ? '헤더 배지 정상' : '실패: ' + failed.join(', '));
})();

// Case 6: grade 형태 견고성(문자열 grade) — 카드는 이모지 없이 라벨/등급색, 헤더배지는 이모지
(function () {
    const data = {
        baseTimeKST: '2026061021',
        active: [
            { office: 'jeju', zone: ZONE_WATCH, grade: 'watch', probPct: 56, windKt: 27, windMs: 14, waveM: 0, areaPct: 50, onsetLabel: '6/14(일) 새벽' },
            { office: 'jeju', zone: ZONE_HIGH, grade: 'high', probPct: 70, windKt: 35, windMs: 18, waveM: 0, areaPct: 70, onsetLabel: '6/13(토) 밤' }
        ],
        resolved: [], counts: { high: 1, watch: 1, resolved: 0 }
    };
    const html = buildAdvisoryHtml(data, () => true);
    const hs = buildHeaderStatus(data, () => true);
    const checks = [];
    checks.push(['높음 label 보강', html.includes('높음')]);
    checks.push(['관심 label 보강', html.includes('관심')]);
    checks.push(['high 카드 adv-grade-high', html.includes('adv-grade-high')]);
    checks.push(['watch 카드 adv-grade-watch', html.includes('adv-grade-watch')]);
    checks.push(['카드에 이모지 없음', !html.includes('🔴') && !html.includes('🟡')]);
    checks.push(['high가 watch보다 앞', html.indexOf(ZONE_HIGH) < html.indexOf(ZONE_WATCH)]);
    checks.push(['헤더 🔴 1', hs.includes('🔴') && hs.includes('1')]);
    checks.push(['헤더 🟡 포함', hs.includes('🟡')]);
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case6_grade_string_robust', failed.length === 0, failed.length === 0 ? '문자열 grade 견고성 정상' : '실패: ' + failed.join(', '));
})();

// Case 7: 교차참조 — 발표청 + kt(m/s) + 발표시각, 없으면 줄 숨김, XSS escape
(function () {
    const withKma = {
        baseTimeKST: '2026061021',
        active: [
            { office: 'jeju', zone: ZONE_HIGH, grade: { key: 'high', label: '높음', emoji: '🔴' },
              probPct: 70, windKt: 35, windMs: 18, waveM: 2.5, areaPct: 70, onsetLabel: '6/13(토) 밤',
              kmaForecast: { office: '제주지방기상청', windKtMs: '27~35kt(14~18m/s)', waveHeight: '2.0~3.0',
                  periodLabel: '6/13(토) 오후', publishLabel: '06월 11일 05:00 발표' } },
            { office: 'jeju', zone: ZONE_WATCH, grade: { key: 'watch', label: '관심', emoji: '🟡' },
              probPct: 56, windKt: 27, windMs: 14, waveM: 0, areaPct: 50, onsetLabel: '6/14(일) 새벽' }
        ],
        resolved: [], counts: { high: 1, watch: 1, resolved: 0 }
    };
    const html = buildAdvisoryHtml(withKma, () => true);
    const checks = [];
    checks.push(['발표청 단기예보 라벨', html.includes('제주지방기상청 단기예보')]);
    checks.push(['kt(m/s) 병기', html.includes('27~35kt(14~18m/s)')]);
    checks.push(['파고 숫자', html.includes('2.0~3.0')]);
    checks.push(['예보 시간대 라벨', html.includes('6/13(토) 오후')]);
    checks.push(['발표시각 라벨', html.includes('06월 11일 05:00 발표')]);
    checks.push(['교차참조 블록 클래스', html.includes('class="adv-kma"')]);
    const occurrences = html.split('class="adv-kma"').length - 1;
    checks.push(['병기 줄 정확히 1회', occurrences === 1]);

    const xss = {
        baseTimeKST: '2026061021',
        active: [{ office: 'x', zone: ZONE_HIGH, grade: { key: 'high', label: '높음', emoji: '🔴' },
            probPct: 70, windKt: 35, windMs: 18, waveM: 0, areaPct: 70, onsetLabel: '밤',
            kmaForecast: { windKtMs: '<b>9~13kt</b>', waveHeight: '1.0', periodLabel: '<i>x</i>' } }],
        resolved: [], counts: { high: 1, watch: 0, resolved: 0 }
    };
    const xssHtml = buildAdvisoryHtml(xss, () => true);
    checks.push(['kma 값 escape', !xssHtml.includes('<b>9~13kt</b>') && xssHtml.includes('&lt;b&gt;9~13kt')]);

    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case7_crossref', failed.length === 0, failed.length === 0 ? '교차참조 병기 정상' : '실패: ' + failed.join(', '));
})();

// Case 8: formatBaseTime — KST "MM월 DD일 HH시 기준"
(function () {
    const checks = [];
    checks.push(['정상 포맷', formatBaseTime('2026061021') === '06월 10일 21시 기준']);
    checks.push(['형식 불량 → 빈문자', formatBaseTime('bad') === '' && formatBaseTime(null) === '']);
    const failed = checks.filter((c) => !c[1]).map((c) => c[0]);
    record('case8_basetime', failed.length === 0, failed.length === 0 ? '기준시각 포맷 정상' : '실패: ' + failed.join(', '));
})();

const allPass = results.every((r) => r.pass);
const outPath = path.join(__dirname, 'advisory_render_test.json');
fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(), variant: 'v6', allPass: allPass,
    total: results.length, passed: results.filter((r) => r.pass).length, results: results
}, null, 2));
console.log('---------------------------------------------------');
console.log((allPass ? 'ALL PASS' : 'SOME FAILED') + '  (' + results.filter((r) => r.pass).length + '/' + results.length + ')');
console.log('결과 기록: ' + outPath);
process.exit(allPass ? 0 : 1);
