/**
 * test_hazard_rocks_tide.js — 간출암 조석 곡선 팝업이 조용히 깨지지 않게 고정한다.
 *
 * [왜 있나] 2026-09-09 사용자 지적으로 이 화면의 결함 세 가지가 한꺼번에 드러났다.
 *   ① "오늘" 화면에서 그날 첫 물때의 증감이 늘 빈칸이었다 — 어제 극값이 화면까지
 *      전달되지 않았기 때문(앵커 곡선 파일이 매일 밤 지워지고, 팝업은 오늘~모레만 받아옴).
 *   ② 게이지(진행률 막대) 유효성 검사가 이 파일에만 빠져 있었다 — 형제 화면 두 곳
 *      (ocean_bottom_sheet3.js·tide.js)은 "앞뒤 물때 간격 13시간 초과면 무효"를 이미 건다.
 *   ③ 증감을 "종류를 안 보고 시간순 바로 앞" 값과 뺐다 — 어제 마지막과 오늘 첫 물때가
 *      둘 다 고조인 날에는 고조에서 고조를 뺀 값이 조용히 표시됐다.
 *   그리고 **이 영역을 지키는 자동 검사가 하나도 없었다**(verify_all.sh 전체에
 *   hazard·tide·rock 문자열 0건) — 즉 팝업이 통째로 깨져도 "전체 검증 통과"가 찍혔다.
 *   CLAUDE.md 결정로그(2026-08-09) *"새 테스트 스위트는 만든 즉시 SUITES 배열에 등록"* 에
 *   따라 이 스위트를 만들고 같은 커밋에서 게이트에 등록한다.
 *
 * [무엇을 고정하나] 화면을 띄우지 않고 확인할 수 있는 것 — ①어제 극값 요약 모듈의
 *   저장·조회·정리 ②서버가 실제로 내주는 어제 극값(동해는 실데이터로 전수 확인)
 *   ③화면 코드에 세 가지 수정이 그대로 남아 있는가.
 *   서해·남해·제주 경로는 앵커 곡선 파일이 있어야 해서 합성 자료로만 확인한다.
 *
 * [실행] node local_server/scripts/test_hazard_rocks_tide.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → local_server/services/hazard_rocks_prev_peaks.js
 *        → local_server/services/hazard_rocks_submersion.js
 *        → client/js/marine-life/safety/hazard_rocks.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PrevPeaks = require(path.join(ROOT, 'local_server', 'services', 'hazard_rocks_prev_peaks.js'));
const Subm = require(path.join(ROOT, 'local_server', 'services', 'hazard_rocks_submersion.js'));

const SUBM_SRC = fs.readFileSync(path.join(ROOT, 'local_server', 'services', 'hazard_rocks_submersion.js'), 'utf8');
const CLIENT_SRC = fs.readFileSync(
    path.join(ROOT, 'client', 'js', 'marine-life', 'safety', 'hazard_rocks.js'), 'utf8');
const VERIFY_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

// ── [1] 어제 극값 요약 모듈 ────────────────────────────────────────────────
console.log('\n[1] 어제 극값 요약 모듈 — 곡선에서 극값을 뽑고, 저장하고, 정리하는가');

// 합성 곡선: 하루 두 번 오르내리는 반정현파(고조 2·저조 2). 1분 간격 1440점.
//   ⚠극값을 03:00/15:00 에 오게 180분 밀어 둔다 — 00:00 이나 23:5x 에 걸린 극값은
//     양옆 표본과 비교할 수 없어 검출되지 않는다(팝업의 오늘 극값 검출도 같은 한계).
function synthCurve(offsetMin) {
    const out = [];
    for (let m = 0; m < 1440; m++) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        // 주기 720분(12시간) — 고조 2회·저조 2회.
        const h = 300 + 250 * Math.cos((2 * Math.PI * (m - (offsetMin || 0))) / 720);
        out.push({ t: `${hh}:${mm}`, h: Math.round(h * 10) / 10 });
    }
    return out;
}

(function () {
    const ex = PrevPeaks.extremaOfCurve(synthCurve(180));
    const highs = ex.filter(e => e.type === 'high'), lows = ex.filter(e => e.type === 'low');
    ok('합성 곡선에서 고조 2개를 찾는다', highs.length === 2, highs.map(h => h.t).join(','));
    ok('합성 곡선에서 저조 2개를 찾는다', lows.length === 2, lows.map(l => l.t).join(','));
    ok('극값이 시각 오름차순이다', ex.every((e, i) => i === 0 || e.t > ex[i - 1].t));
    ok('첫 고조가 03:00 이다(180분 밀어 둔 대로)', highs[0] && highs[0].t === '03:00', highs[0] && highs[0].t);
    ok('두 번째 고조가 15:00 이다(주기 12시간)', highs[1] && highs[1].t === '15:00', highs[1] && highs[1].t);
    ok('저조 조위가 고조보다 낮다', lows[0].cm < highs[0].cm, `${lows[0].cm} < ${highs[0].cm}`);
})();

ok('곡선이 비면 극값도 빈 배열', PrevPeaks.extremaOfCurve([]).length === 0);
ok('곡선이 없으면(undefined) 빈 배열', PrevPeaks.extremaOfCurve(undefined).length === 0);

// 저장·조회 왕복 — 임시 곡선 파일을 만들어 capture → load
(function () {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hrpp-'));
    const TEST_YMD = 19000101;
    const ids = ['TEST_A', 'TEST_B'];
    ids.forEach((id, i) => {
        fs.writeFileSync(path.join(tmp, `${id}_${TEST_YMD}.json`),
            JSON.stringify({ anchorId: id, date: TEST_YMD, curve: synthCurve(180 + i * 60) }), 'utf8');
    });
    const curvePathFn = (id, ymd) => path.join(tmp, `${id}_${ymd}.json`);

    const r = PrevPeaks.capture('tf', TEST_YMD, ids, curvePathFn);
    ok('capture 가 두 앵커를 저장한다', r.anchors === 2, JSON.stringify(r));
    const table = PrevPeaks.load(TEST_YMD);
    ok('load 가 저장한 앵커를 그대로 돌려준다',
        Array.isArray(table.TEST_A) && Array.isArray(table.TEST_B),
        Object.keys(table).join(','));
    ok('저장된 극값이 {t,cm,type} 꼴이다',
        table.TEST_A.every(p => typeof p.t === 'string' && typeof p.cm === 'number' && (p.type === 'high' || p.type === 'low')));
    ok('앵커마다 극값 시각이 다르다(offset 60분을 준 대로)',
        table.TEST_A[0].t !== table.TEST_B[0].t, `${table.TEST_A[0].t} vs ${table.TEST_B[0].t}`);
    ok('없는 날짜를 load 하면 빈 객체', Object.keys(PrevPeaks.load(19000103)).length === 0);

    // prune — 기존 실제 파일은 건드리지 않고 테스트 파일만 지우는지 확인
    let before = [];
    try { before = fs.readdirSync(PrevPeaks.PREV_PEAKS_DIR); } catch (e) { before = []; }
    const realDates = before.map(f => (f.match(/^(?:tf|hr)_(\d{8})\.json$/) || [])[1]).filter(Boolean);
    PrevPeaks.capture('tf', 19000102, ids, curvePathFn);
    const removed = PrevPeaks.prune(realDates.concat(['19000101']));
    const after = fs.readdirSync(PrevPeaks.PREV_PEAKS_DIR);
    ok('prune 이 남기라고 한 날짜는 지우지 않는다', after.indexOf('tf_19000101.json') >= 0);
    ok('prune 이 목록에 없는 날짜만 지운다',
        after.indexOf('tf_19000102.json') < 0 && removed >= 1, `지운 수 ${removed}`);
    ok('prune 이 원래 있던 파일을 건드리지 않는다',
        realDates.every(d => after.some(f => f.indexOf(d) >= 0)), `원래 ${realDates.length}개`);

    // 뒷정리 — 테스트가 남긴 파일을 지운다(경로를 하나씩 지정, 디렉토리째 지우지 않는다)
    try { fs.unlinkSync(PrevPeaks.filePath('tf', 19000101)); } catch (e) { /* noop */ }
    fs.rmSync(tmp, { recursive: true, force: true });
    const left = fs.readdirSync(PrevPeaks.PREV_PEAKS_DIR).filter(f => f.indexOf('1900') >= 0);
    ok('테스트가 파일을 남기지 않는다', left.length === 0, left.join(','));
})();

// 상수가 팝업 쪽과 어긋나면 어제/오늘 극값 기준이 달라진다 — 값이 같은지 고정
(function () {
    const step = (SUBM_SRC.match(/CURVE_SAMPLE_STEP_MIN = (\d+)/) || [])[1];
    const gap = (SUBM_SRC.match(/PEAK_MERGE_GAP_MIN = (\d+)/) || [])[1];
    ok('표본 간격이 팝업(오늘 곡선)과 같다', String(PrevPeaks.SAMPLE_STEP_MIN) === step, `${PrevPeaks.SAMPLE_STEP_MIN} vs ${step}`);
    ok('극값 병합 간격이 팝업과 같다', String(PrevPeaks.PEAK_MERGE_GAP_MIN) === gap, `${PrevPeaks.PEAK_MERGE_GAP_MIN} vs ${gap}`);
})();

// ── [2] 서버가 실제로 내주는 어제 극값 (동해 = 실데이터) ───────────────────
console.log('\n[2] 서버 응답 — 어제 극값(prevPeaks)');

const rocks = Subm.loadRocks();
const eastIds = rocks.filter(r => Subm.classifyRegion(r.lat, r.lon) === 'eastsea').map(r => r.id);
ok('동해 간출암이 존재한다(실데이터)', eastIds.length > 0, `${eastIds.length}개`);

(function () {
    if (!eastIds.length) { fail++; console.log('  ❌ 동해 암초가 없어 이 절을 건너뜀'); return; }
    const one = Subm.getTideCurve(eastIds[0], 0);
    ok('day=0 응답에 prevPeaks 가 있다', Array.isArray(one.prevPeaks), typeof one.prevPeaks);
    ok('day=0 어제 극값이 2개 이상이다', (one.prevPeaks || []).length >= 2, String((one.prevPeaks || []).length));
    ok('day=1 은 어제 극값을 내지 않는다', (Subm.getTideCurve(eastIds[0], 1).prevPeaks || []).length === 0);
    ok('day=2 도 어제 극값을 내지 않는다', (Subm.getTideCurve(eastIds[0], 2).prevPeaks || []).length === 0);

    // 전수 검사 — 동해 암초 전부에 대해 형태가 깨지지 않는지
    let withPrev = 0, badTime = 0, badOrder = 0, badCluster = 0, badType = 0;
    for (const id of eastIds) {
        const r = Subm.getTideCurve(id, 0);
        const pp = r.prevPeaks || [];
        if (pp.length) withPrev++;
        for (let i = 0; i < pp.length; i++) {
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(pp[i].t)) badTime++;
            if (pp[i].type !== 'high' && pp[i].type !== 'low') badType++;
            if (i > 0) {
                const prevM = +pp[i - 1].t.slice(0, 2) * 60 + +pp[i - 1].t.slice(3);
                const curM = +pp[i].t.slice(0, 2) * 60 + +pp[i].t.slice(3);
                if (curM <= prevM) badOrder++;
                // 같은 종류가 90분 이내로 연달아 오면 "다른 지점의 다른 물때"를 섞은 것이다
                if (pp[i].type === pp[i - 1].type && (curM - prevM) <= 90) badCluster++;
            }
        }
    }
    ok('동해 암초 전부에서 어제 극값이 나온다', withPrev === eastIds.length, `${withPrev}/${eastIds.length}`);
    ok('어제 극값 시각이 모두 00:00~23:59 이다(음수·1440+ 아님)', badTime === 0, `${badTime}건`);
    ok('어제 극값 종류가 모두 high/low 이다', badType === 0, `${badType}건`);
    ok('어제 극값이 시각 오름차순이다', badOrder === 0, `${badOrder}건`);
    ok('같은 종류 물때가 90분 이내로 겹치지 않는다(위상 뒤섞임 없음)', badCluster === 0, `${badCluster}건`);
})();

// 위상 뒤섞임 방지 규칙이 코드에 남아 있는지(번호로 짝지으면 안 된다)
ok('어제 극값을 "번호"가 아니라 "시각"으로 묶는다',
    /function blendExtremaByTime/.test(SUBM_SRC) &&
    /PREV_CLUSTER_GAP_MIN = 90/.test(SUBM_SRC));
ok('가장 가까운 지점에 없는 물때는 버린다',
    /if \(!g\.items\.some\(x => x\.near\)\) continue;/.test(SUBM_SRC));
ok('어제 조회가 실패해도 오늘 곡선은 그대로 낸다(try/catch)',
    /try \{[\s\S]{0,400}anchorPrevExtrema\(refs, prevYmd\);[\s\S]{0,80}\} catch \(e\) \{ prevPeaks = \[\]; \}/.test(SUBM_SRC));
ok('어제 극값은 day=0 일 때만 계산한다', /if \(day === 0\) \{[\s\S]{0,300}prevPeaks =/.test(SUBM_SRC));

// ── [3] 화면 코드 — 세 가지 수정이 남아 있는가 ─────────────────────────────
console.log('\n[3] 화면 코드[2026-09-09 수정 3건]');

ok('① 옆날 캐시를 먼저 쓰고, 없을 때만 서버의 prevPeaks 를 쓴다',
    /var prevDayPeaks = \(prevDay && prevDay\.ready\) \? prevDay\.peaks : \(\(data && data\.prevPeaks\) \|\| null\);/.test(CLIENT_SRC));
ok('② 게이지 유효성 검사(0 초과 · 780분 이하)가 있다',
    /gapMin > 0 && gapMin <= 780/.test(CLIENT_SRC));
ok('② 게이지 간격을 prevPeak↔nextPeak 로 잰다',
    /var gapMin = \(prevPeak && nextPeak\) \? \(nextPeak\.m - prevPeak\.m\) : 0;/.test(CLIENT_SRC));
ok('③ 오늘 첫 극값만 "직전 반대 종류"와 짝짓는다',
    /var firstIdx = prevSorted\.length;/.test(CLIENT_SRC) &&
    /if \(chrono\[k\]\.type !== first\.type\) \{ opp = chrono\[k\]; break; \}/.test(CLIENT_SRC));
ok('③ 반대 종류가 없으면 값을 지어내지 않고 빈칸으로 둔다',
    /else delete diffByKey\[firstKey\];/.test(CLIENT_SRC));
ok('③ 나머지 행의 계산은 종전 그대로다(내일·모레 숫자 불변)',
    /for \(var j = 1; j < chrono\.length; j\+\+\) \{\s*\n\s*diffByKey\[chrono\[j\]\.m \+ '_' \+ chrono\[j\]\.type\] = Math\.round\(chrono\[j\]\.cm - chrono\[j - 1\]\.cm\);/.test(CLIENT_SRC));
ok('틀린 주석("동일한 정의")이 정정돼 있다',
    !/ocean_bottom_sheet3\.js 의 diff 와\s*\n?\s*\/\/ 동일한 정의/.test(CLIENT_SRC) &&
    /"같은 정의"가 아니다/.test(CLIENT_SRC));

// ── [4] 게이트 등록 ────────────────────────────────────────────────────────
console.log('\n[4] 게이트 등록 — 이 스위트가 verify_all.sh 에 올라가 있는가');
ok('verify_all.sh SUITES 에 test_hazard_rocks_tide 가 있다',
    /test_hazard_rocks_tide/.test(VERIFY_SRC));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
