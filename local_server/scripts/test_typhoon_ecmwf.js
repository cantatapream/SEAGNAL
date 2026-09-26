/**
 * test_typhoon_ecmwf.js — 태풍 탭의 "유럽(ECMWF)" 출처가 조용히 깨지지 않게 고정한다.
 *
 * [왜 이 검사가 특히 중요한가] 유럽 자료는 이진 형식(BUFR)이라 우리가 직접 푼다
 *   (services/ecmwf_bufr.js). 비트가 한 칸만 어긋나도 뒤의 숫자가 전부 엉뚱해지는데,
 *   지도에는 그래도 그럴듯한 선이 그려진다 — 눈으로는 안 걸린다.
 *   그래서 ECMWF 공식 도구(ecCodes 2.49.0)가 같은 파일을 푼 결과를 정답지로 두고
 *   **모든 칸**을 대조한다.
 *
 * [정답지 만들기] fixtures/ecmwf_oper_tf_oracle.json 은 2026-09-26 에 ecCodes 파이썬
 *   꾸러미로 fixtures/ecmwf_oper_tf.bufr 를 풀어 저장한 것이다. 이 검사 자체는 파이썬
 *   없이 돈다. (그때 같은 방법으로 다른 실행 2개·앙상블 파일 1개도 대조해 모두 어긋남 0 —
 *   총 123,968칸. 저장소에는 대표 파일 하나만 둔다.)
 *
 * [실제 자료] 2026-09-25 12z 실행 파일 — 메시지 25개(실제 태풍 6개 + 발생 예상 자리 19개).
 *
 * [실행] node local_server/scripts/test_typhoon_ecmwf.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → local_server/services/ecmwf_bufr.js · routes/typhoon_foreign.js
 *        → client/js/typhoon/ocean_typhoon.js · client/index2.html
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const EC = require(path.join(ROOT, 'local_server', 'services', 'ecmwf_bufr.js'));
const route = require(path.join(ROOT, 'local_server', 'routes', 'typhoon_foreign.js'));

const BUF = fs.readFileSync(path.join(__dirname, 'fixtures', 'ecmwf_oper_tf.bufr'));
const ORACLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ecmwf_oper_tf_oracle.json'), 'utf8'));
const DECODER_SRC = fs.readFileSync(path.join(ROOT, 'local_server', 'services', 'ecmwf_bufr.js'), 'utf8');
const ROUTE_SRC = fs.readFileSync(path.join(ROOT, 'local_server', 'routes', 'typhoon_foreign.js'), 'utf8');
const TYPHOON_SRC = fs.readFileSync(path.join(ROOT, 'client', 'js', 'typhoon', 'ocean_typhoon.js'), 'utf8');
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'client', 'index2.html'), 'utf8');
const VERIFY_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

const MSGS = EC.decodeMessages(BUF);

// ── [1] 공식 도구와 전 칸 대조 ─────────────────────────────────────────────
console.log('\n[1] 해독 — ECMWF 공식 도구(ecCodes) 결과와 모든 칸 대조');

/** 우리 해독 결과를 ecCodes 가 내놓는 순서(키별 평탄 배열)로 펼친다. */
function flatten(r) {
    const o = { meteorologicalAttributeSignificance: [], latitude: [], longitude: [],
        pressureReducedToMeanSeaLevel: [], windSpeedAt10M: [], windSpeedThreshold: [],
        bearingOrAzimuth: [], effectiveRadiusWithRespectToWindSpeedsAboveThreshold: [],
        timeSignificance: [], timePeriod: [] };
    const loc = (l) => { o.meteorologicalAttributeSignificance.push(l.sig); o.latitude.push(l.lat); o.longitude.push(l.lon); };
    const rad = (rs) => rs.forEach((t) => {
        o.windSpeedThreshold.push(t.thr);
        t.quads.forEach((q) => {
            o.bearingOrAzimuth.push(q.b1, q.b2);
            o.effectiveRadiusWithRespectToWindSpeedsAboveThreshold.push(q.r);
        });
    });
    loc(r.initial.obs); loc(r.initial.ana); o.pressureReducedToMeanSeaLevel.push(r.initial.ana.pmsl);
    loc(r.initial.maxWind); o.windSpeedAt10M.push(r.initial.maxWind.wind); rad(r.initial.radii);
    r.periods.forEach((p) => {
        o.timeSignificance.push(p.timeSig); o.timePeriod.push(p.period);
        loc(p.centre); o.pressureReducedToMeanSeaLevel.push(p.centre.pmsl);
        loc(p.maxWind); o.windSpeedAt10M.push(p.maxWind.wind); rad(p.radii);
    });
    return o;
}
let cells = 0, bad = 0;
const firstBad = [];
function same(a, b) {
    if (a === null && b === null) return true;
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
    return a === b;
}
ORACLE.forEach((o, i) => {
    const r = MSGS[i];
    if (!r) { bad++; firstBad.push(i + ': 못 풀었음'); return; }
    const pairs = [['id', r.id, o.id], ['name', r.name, o.name], ['member', r.member, o.member]]
        .concat(o.date.map((v, j) => ['date' + j, r.date[j], v]));
    pairs.forEach((p) => { cells++; if (!same(p[1], p[2])) { bad++; if (firstBad.length < 5) firstBad.push(i + ' ' + p[0]); } });
    const f = flatten(r);
    Object.keys(f).forEach((k) => {
        if (f[k].length !== o[k].length) { bad++; firstBad.push(i + ' ' + k + ' 개수'); return; }
        f[k].forEach((v, j) => {
            cells++;
            if (!same(v, o[k][j])) { bad++; if (firstBad.length < 5) firstBad.push(i + ' ' + k + '[' + j + '] ' + v + '≠' + o[k][j]); }
        });
    });
});
ok('메시지 25개를 모두 푼다', MSGS.length === 25 && MSGS.every(Boolean), String(MSGS.filter(Boolean).length));
ok('★정답지와 모든 칸이 같다 (38,000칸 이상 · 어긋남 0)',
    cells > 38000 && bad === 0, cells + '칸 중 ' + bad + '칸 어긋남 ' + firstBad.join(' / '));

// ── [2] 틀이 다르면 풀지 않는다 ────────────────────────────────────────────
console.log('\n[2] 모르는 틀 — 추측으로 풀지 않는다');

function firstMsgCopy() {
    const len = BUF.readUIntBE(4, 3);
    return Buffer.from(BUF.slice(0, len));
}
/** 3절(틀 정보)이 시작하는 위치 — 1절 다음, 2절이 있으면 그것도 건너뛴다(ECMWF 파일은 2절이 있다). */
function s3Offset(b) {
    let p = 8 + b.readUIntBE(8, 3);
    if (b[8 + 9] & 0x80) p += b.readUIntBE(p, 3);
    return p;
}
ok('시험 도우미가 3절을 제대로 찾는다 (틀 번호 3-16-082 가 그 자리에 있다)',
    firstMsgCopy().readUInt16BE(s3Offset(firstMsgCopy()) + 7) === ((3 << 14) | (16 << 8) | 82));
(function () {
    const b = firstMsgCopy(); b[8 + 13] = 36;               // 마스터 표 판 35 → 36
    ok('★표 판이 다르면 버린다', EC.decodeMessages(b)[0] === null);
})();
(function () {
    const b = firstMsgCopy(); b.writeUInt16BE(0xD000 | 1, s3Offset(b) + 7);   // 3-16-082 → 3-16-001
    ok('★템플릿이 다르면 버린다', EC.decodeMessages(b)[0] === null);
})();
(function () {
    const b = firstMsgCopy(); b[s3Offset(b) + 6] |= 0x40;   // 압축 표시를 켠다
    ok('★압축된 메시지는 버린다 (앙상블 파일 대부분이 이 형식)', EC.decodeMessages(b)[0] === null);
})();
(function () {
    const b = firstMsgCopy(); b.writeUInt16BE(2, s3Offset(b) + 4);   // 건수 1 → 2
    ok('한 메시지에 여러 건이면 버린다', EC.decodeMessages(b)[0] === null);
})();
(function () {
    // 자료 절을 앞부분만 남기면 비트가 모자란다 — 엉뚱한 숫자를 내지 말고 버려야 한다.
    const b = firstMsgCopy();
    const s4 = s3Offset(b) + b.readUIntBE(s3Offset(b), 3);
    b.writeUIntBE(40, s4, 3);
    ok('★자료가 모자라면(비트 부족) 버린다', EC.decodeMessages(b)[0] === null);
})();
ok('BUFR 가 아니면 빈 목록', EC.decodeMessages(Buffer.from('그냥 글')).length === 0 &&
    EC.decodeMessages(null).length === 0);

// ── [3] 태풍으로 옮기기 ────────────────────────────────────────────────────
console.log('\n[3] 태풍으로 옮기기 — 수리개(SURIGAE)');

const STORMS = MSGS.map(EC.toTyphoon).filter(Boolean);
ok('★실제 태풍 6개만 남긴다 (발생 예상 자리 19개는 버린다)',
    STORMS.length === 6 && STORMS.map(t => t.name).join(',') === 'NOLO,GONZALO,SURIGAE,FAY,ODALYS,POLO',
    STORMS.map(t => t.name).join(','));
// 71W 는 관측 위치가 비어 있고 모델 위치만 수리개와 같다 — 채워 넣으면 수리개가 두 번 나온다.
ok('★관측 위치가 없는 자리는 모델 위치로 채우지 않는다 (수리개 중복 방지)',
    !STORMS.some(t => /^7\dW$/.test(t.id)) &&
    MSGS.find(m => m.id === '71W').initial.obs.lat === null);
const SU = STORMS.find(t => t.name === 'SURIGAE');
const C0 = SU.frames[0];
ok('기준 시각 12UTC → 한국시각 21:00', SU.baseKst === '202609252100' && C0.time === '202609252100');
ok('★현재 위치는 관측 중심 (21.3N 127.9E — 일본 기상청 21:00 과 같다)',
    C0.lat === 21.3 && C0.lon === 127.9, C0.lat + ',' + C0.lon);
ok('★기압은 Pa → hPa (99800 → 998)', C0.pressure === 998, String(C0.pressure));
ok('풍속 21m/s → km/h 76', C0.windMs === 21 && C0.windKmh === 76);
ok('★초속 18m 반경을 네 방향 km 로 (북동 72 · 남동 48 · 남서 0 · 북서 70)',
    JSON.stringify(C0.radQuad34) === '{"ne":72,"se":48,"sw":0,"nw":70}', JSON.stringify(C0.radQuad34));
ok('장·단반경도 함께 채운다 (72 / 0)', C0.radStrong === 72 && C0.radStrongS === 0);
ok('없는 값은 비운다 — 70%반경·돌풍·이동방향·속력',
    SU.frames.every(f => f.radProb === null && f.gustMs === null && f.dir === '' && f.speedKmh === null));
ok('예보 시각이 6시간씩 늘어난다',
    SU.frames[1].time === '202609260300' && SU.frames[2].time === '202609260900');
ok('소멸 뒤 빈 시점은 버린다 (수리개는 24개 시점)', SU.frames.length === 24, String(SU.frames.length));

ok('★강도는 환산 없이 기상청 기준 (17→1 · 25→2 · 33→3) — 모델 풍속이라 근거 없는 환산을 하지 않는다',
    EC._gradeOfWind(17) === 1 && EC._gradeOfWind(25) === 2 && EC._gradeOfWind(33) === 3 &&
    EC._gradeOfWind(16.9) === 0 && EC._gradeOfWind(null) === null && !/0\.88/.test(DECODER_SRC));
ok('사분면이 모두 비어 있으면 null', EC._quadsToKm(null) === null &&
    EC._quadsToKm({ quads: [{ b1: 0, b2: 90, r: null }, { b1: 90, b2: 180, r: null },
                            { b1: 180, b2: 270, r: null }, { b1: 270, b2: 0, r: null }] }) === null);

// ── [4] 서버 ───────────────────────────────────────────────────────────────
console.log('\n[4] 서버 — 어디서 받아 무엇을 내주나');

const CAND = route._ecmwfCandidates(Date.parse('2026-09-26T05:00:00Z')).map(c => c.url);
ok('★최신 실행부터 찾는다 (26일 00z → 25일 12z → 25일 00z)',
    CAND.length === 3 &&
    /20260926\/00z\/ifs\/0p25\/oper\/20260926000000-360h-oper-tf\.bufr$/.test(CAND[0]) &&
    /20260925\/12z\/.*20260925120000-360h-oper-tf\.bufr$/.test(CAND[1]) &&
    /20260925\/00z\/.*20260925000000-360h-oper-tf\.bufr$/.test(CAND[2]), CAND.join(' '));
ok('아직 오지 않은 실행은 찾지 않는다 (05Z 에 26일 12z 를 부르지 않는다)',
    !CAND.some(u => /20260926120000/.test(u)));
ok('유럽 공개자료 주소에서 받는다', /https:\/\/data\.ecmwf\.int\/forecasts\//.test(ROUTE_SRC));
ok('파일이 BUFR 로 시작하는지 확인한다 (오류 페이지를 풀지 않게)',
    /buf\.slice\(0, 4\)\.toString\('latin1'\) === 'BUFR'/.test(ROUTE_SRC));
ok('출처표기(other)에 CC BY 4.0 을 적는다', /CC BY 4\.0/.test(ROUTE_SRC));
ok('★안내문에 "공식 태풍 예보가 아닙니다"를 적는다', /공식 태풍 예보가 아닙니다/.test(ROUTE_SRC));

console.log('\n[4-2] 응답 한 판 — 실제 파일을 상류인 척 물려 끝까지 돌려 본다');
(function wholeResponse() {
    const realFetch = global.fetch, realLog = console.log, realNow = Date.now;
    // 시각 고정 — 실제 시계를 쓰면 날짜가 바뀔 때 후보 주소가 달라져 검사가 저절로 깨진다.
    Date.now = function () { return Date.parse('2026-09-26T05:00:00Z'); };
    global.fetch = async function (url) {
        if (/20260925120000-360h-oper-tf\.bufr$/.test(url)) {
            return { ok: true, status: 200, arrayBuffer: async () => BUF };
        }
        return { ok: false, status: 404, headers: new Map() };   // 26일 00z 는 아직 없음
    };
    console.log = function () {};
    route._clearCache();
    const handler = route.stack.find(l => l.route && l.route.path === '/api/typhoon/foreign').route.stack[0].handle;
    let out = null;
    handler({ query: { src: 'ecmwf' } }, { set: function () { return this; }, json: function (d) { out = d; } }, function () {});
    return new Promise(function (done) {
        setTimeout(function () {
            global.fetch = realFetch; console.log = realLog; Date.now = realNow;
            route._clearCache();
            const t = out && out.typhoons && out.typhoons.find(x => x.name === 'SURIGAE');
            const b = t && t.bulletins[0];
            ok('★없는 최신 실행(404)을 건너뛰고 그 앞 실행으로 성공한다',
                !!(out && out.success && out.src === 'ecmwf' && out.typhoons.length === 6));
            ok('라벨에 "모델 예측"과 기준시각이 들어간다',
                !!(b && b.label === '[ ECMWF ] 모델 예측 / 09.25. 21:00 기준(KST)'), b && b.label);
            const hours = b ? b.forecast.map(f => (route._kstStampToMs(f.time) - route._kstStampToMs(t.latestTmFc)) / 3600000) : [];
            ok('★예보는 12시간 간격 · 120시간까지만 (말풍선이 지도를 덮지 않게)',
                hours.length === 10 && hours.every(h => h % 12 === 0 && h > 0 && h <= 120), hours.join(','));
            ok('위험구역·지나온 경로·예보도 그림은 없다',
                !!(t && t.swath === null && t.past === null && !t.imageName));
            ok('응답이 크지 않다 (50KB 미만)', JSON.stringify(out).length < 50 * 1024,
                Math.round(JSON.stringify(out).length / 1024) + 'KB');
            done();
        }, 300);
    });
})().then(function () {

// ── [5] 화면 배선 ──────────────────────────────────────────────────────────
console.log('\n[5] 화면 배선');
ok('출처 드롭다운에서 유럽을 고를 수 있다 (잠금이 풀렸다)', /<option value="ecmwf">유럽\(ECMWF\)<\/option>/.test(HTML_SRC));
ok('★출처표기에 CC BY 4.0 과 "공식 태풍 예보 아님"이 있다',
    /ecmwf: \{ label: '유럽\(ECMWF\)'/.test(TYPHOON_SRC) &&
    /CC BY 4\.0 · 컴퓨터 모델 예측\(공식 태풍 예보 아님\)/.test(TYPHOON_SRC));
ok('유럽은 70%반경·위험구역 둘 다 잠긴다',
    /var PROB_SOURCES = \['kma', 'jma'\];/.test(TYPHOON_SRC) && /var SWATH_SOURCES = \['jtwc'\];/.test(TYPHOON_SRC));

// ── [6] 게이트 등록 ────────────────────────────────────────────────────────
console.log('\n[6] 게이트 등록');
ok('verify_all.sh SUITES 에 test_typhoon_ecmwf 가 있다', /test_typhoon_ecmwf/.test(VERIFY_SRC));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
}).catch(function (e) {
    console.log('  ❌ 응답 검사 도중 예외 — ' + e.message);
    process.exit(1);
});
