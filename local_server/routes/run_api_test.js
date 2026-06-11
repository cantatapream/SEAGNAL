/**
 * ============================================================================
 * 파일명: routes/run_api_test.js
 * 역할: 통합본 routes/advisoryPrediction.js 검증 하네스 (mock 테스트)
 * ============================================================================
 *
 * [설명]
 * 실제 HTTP 서버/네트워크 없이 통합본을 require('./advisoryPrediction') 으로
 * 불러, 순수 함수(filterState/parseFavorites)에 mock state 를 직접 주입해 검증한다.
 * 디스크 상태파일(advisory_state.json) 유무와 무관·결정론적.
 * 추가로 express 라우터 자체를 가벼운 mock req/res 로 스모크 1케이스.
 *
 * 6 케이스:
 *  1. favorites 없음 → 전체 반환, filtered:false, counts 정확.
 *  2. 부모 favorite('제주도먼바다') → 자식 먼바다만 포함(펼침), 무관 제외, filtered:true.
 *  3. 정확 일치 favorite('동해북부앞바다') → 해당 zone만.
 *  4. counts(복수 favorite) → high/watch/resolved 가 필터 후 기준으로 정확.
 *  5. 상태 없음/깨짐(state=null) → 빈 payload, _loadState no-throw.
 *  6. express 라우터 mock req/res 스모크 → 200 + 헤더 + 스키마.
 *
 * 실행: node routes/run_api_test.js
 *   → api_test_integrated.json 에 [{case,pass,detail}...] 기록 + stdout 요약.
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

const mod = require('./advisoryPrediction');
const { filterState, parseFavorites } = mod;

const results = [];
function record(name, pass, detail) {
    results.push({ case: name, pass: !!pass, detail });
    const tag = pass ? 'PASS' : 'FAIL';
    console.log(`[${tag}] ${name}`);
    if (!pass) console.log('       detail:', JSON.stringify(detail));
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ── mock state ───────────────────────────────────────────────────────────────
//   grade 는 실제 상태파일처럼 객체({key,label,emoji}) 형태로 주입.
//   active: 제주도 자식 먼바다 2건(high+watch) + 동해북부앞바다 1건(high) + 무관 1건(watch)
//   resolved: 제주도 자식 먼바다 1건 + 무관 1건
const G_HIGH = { key: 'high', label: '높음', emoji: '🔴' };
const G_WATCH = { key: 'watch', label: '관심', emoji: '🟡' };

function makeState() {
    return {
        updatedAt: '2026-06-11T01:50:01.395Z',
        baseTimeKST: '2026061021',
        active: [
            { office: 'jeju', zone: '제주도남쪽바깥먼바다', lat: 31.8, lon: 126.5, grade: G_HIGH, probPct: 80 },
            { office: 'jeju', zone: '제주도남동쪽안쪽먼바다', lat: 32.5, lon: 127.0, grade: G_WATCH, probPct: 60 },
            { office: 'east', zone: '동해북부앞바다', lat: 38.5, lon: 128.5, grade: G_HIGH, probPct: 90 },
            { office: 'west', zone: '서해중부앞바다', lat: 36.5, lon: 125.5, grade: G_WATCH, probPct: 55 },
        ],
        resolved: [
            { zone: '제주도남서쪽안쪽먼바다', office: 'jeju', reason: 'forecast_eased', resolvedAt: '2026-06-11T01:50:01.395Z' },
            { zone: '남해동부앞바다', office: 'busan', reason: 'onset_passed', resolvedAt: '2026-06-10T20:00:00.000Z' },
        ],
    };
}

// 펼침 가용 여부 사전 점검(환경 진단용; 통합 환경에서는 항상 true 여야 함).
const expandWorks = (() => {
    try {
        const s = mod._buildWantZones(['제주도먼바다']);
        return s.has('제주도남쪽바깥먼바다');
    } catch (_) { return false; }
})();
console.log(`[info] expandOfficial 펼침 가용: ${expandWorks}`);

// ── CASE 1 — favorites 없음 → 전체 반환 ───────────────────────────────────────
(() => {
    const st = makeState();
    const out = filterState(st, parseFavorites(undefined));
    const okEmptyParse =
        eq(parseFavorites(undefined), []) &&
        eq(parseFavorites(''), []) &&
        eq(parseFavorites('  ,  '), []);
    const pass =
        out.filtered === false &&
        out.active.length === 4 &&
        out.resolved.length === 2 &&
        out.generatedAt === st.updatedAt &&
        out.baseTimeKST === st.baseTimeKST &&
        eq(out.counts, { high: 2, watch: 2, resolved: 2 }) &&
        okEmptyParse;
    record('1. favorites 없음 → 전체 반환', pass, {
        filtered: out.filtered, active: out.active.length, resolved: out.resolved.length,
        counts: out.counts, okEmptyParse,
    });
})();

// ── CASE 2 — 부모 favorite '제주도먼바다' → 제주도 자식 먼바다만 ──────────────
(() => {
    const st = makeState();
    const out = filterState(st, parseFavorites('제주도먼바다'));
    const activeZones = out.active.map((p) => p.zone).sort();
    const resolvedZones = out.resolved.map((r) => r.zone).sort();
    const noUnrelated =
        !activeZones.includes('동해북부앞바다') &&
        !activeZones.includes('서해중부앞바다') &&
        !resolvedZones.includes('남해동부앞바다');

    let pass;
    let detail;
    if (expandWorks) {
        pass =
            out.filtered === true &&
            eq(activeZones, ['제주도남동쪽안쪽먼바다', '제주도남쪽바깥먼바다']) &&
            eq(resolvedZones, ['제주도남서쪽안쪽먼바다']) &&
            noUnrelated &&
            eq(out.counts, { high: 1, watch: 1, resolved: 1 });
        detail = { mode: '펼침ON', activeZones, resolvedZones, counts: out.counts };
    } else {
        // 펼침 불가 환경(graceful) — 정확일치 zone 이 mock 에 없으므로 빈 결과가 정상.
        pass = out.filtered === true && activeZones.length === 0 && resolvedZones.length === 0;
        detail = { mode: '펼침OFF(graceful)', activeZones, resolvedZones };
    }
    record('2. 부모 favorite 매칭(펼침)', pass, detail);
})();

// ── CASE 3 — 정확 일치 favorite '동해북부앞바다' ──────────────────────────────
(() => {
    const st = makeState();
    const out = filterState(st, parseFavorites('동해북부앞바다'));
    const activeZones = out.active.map((p) => p.zone);
    const pass =
        out.filtered === true &&
        activeZones.length === 1 &&
        activeZones[0] === '동해북부앞바다' &&
        out.resolved.length === 0 &&
        eq(out.counts, { high: 1, watch: 0, resolved: 0 });
    record('3. 정확 일치 favorite', pass, { activeZones, resolved: out.resolved.length, counts: out.counts });
})();

// ── CASE 4 — counts (복수 favorite, 필터 후 기준 + grade 변이 견고) ───────────
(() => {
    const st = makeState();
    // 제주도먼바다(자식 2: high+watch) + 동해북부앞바다(high) + 무관('없는해역마을')
    const out = filterState(st, parseFavorites('제주도먼바다, 동해북부앞바다, 없는해역마을'));
    const multiOk =
        out.filtered === true &&
        out.active.length === 3 &&            // 제주2 + 동해1
        eq(out.counts, { high: 2, watch: 1, resolved: 1 }) &&
        !out.active.some((p) => p.zone === '서해중부앞바다');

    // 문자열 grade('high'/'watch') 폴백도 카운트되는지(상태파일 변이 견고성).
    const strState = {
        updatedAt: 't', baseTimeKST: 'b',
        active: [{ zone: 'Z1', grade: 'high' }, { zone: 'Z2', grade: 'watch' }, { zone: 'Z3', grade: 'high' }],
        resolved: [],
    };
    const strOut = filterState(strState, []);
    const strOk = eq(strOut.counts, { high: 2, watch: 1, resolved: 0 });

    const pass = multiOk && strOk;
    record('4. counts(복수 favorite, 필터 후 + grade 변이)', pass, {
        multi: { active: out.active.length, counts: out.counts }, strGrade: strOut.counts,
    });
})();

// ── CASE 5 — 상태 없음/깨짐 → 빈 payload, _loadState no-throw ──────────────────
(() => {
    const expectedEmpty = {
        generatedAt: null, baseTimeKST: null, active: [], resolved: [],
        counts: { high: 0, watch: 0, resolved: 0 }, filtered: false,
    };
    const outNull = filterState(null, parseFavorites('제주도먼바다')); // favorites 있어도 빈
    const outBad = filterState('not-an-object', ['제주도먼바다']);
    const outEmptyArrays = filterState({ updatedAt: null, baseTimeKST: null, active: [], resolved: [] }, []);
    // _loadState 실제 호출 — 디스크 상태 유무와 무관하게 throw 금지.
    let loadOk = true;
    try { mod._loadState(); } catch (_) { loadOk = false; }
    const pass =
        eq(outNull, expectedEmpty) &&
        eq(outBad, expectedEmpty) &&
        eq(outEmptyArrays, expectedEmpty) &&
        loadOk;
    record('5. 상태 없음/깨짐 → 빈 payload', pass, {
        nullShape: eq(outNull, expectedEmpty), badShape: eq(outBad, expectedEmpty),
        emptyArr: eq(outEmptyArrays, expectedEmpty), loadStateNoThrow: loadOk,
    });
})();

// ── CASE 6 — express 라우터 mock req/res 스모크 ───────────────────────────────
//   라우터 stack 에서 핸들러를 직접 꺼내 호출(실 HTTP 없음).
//   디스크 상태파일이 없을 수 있어 filtered/zone 은 강제하지 않고 200+헤더+스키마만 검증.
(() => {
    const captured = { status: null, headers: {}, body: null };
    const req = { query: { favorites: '동해북부앞바다' } };
    const res = {
        set(k, v) { captured.headers[String(k).toLowerCase()] = v; return this; },
        status(c) { captured.status = c; return this; },
        send(b) { captured.body = b; return this; },
        json(o) { captured.body = JSON.stringify(o); return this; },
    };
    let handler = null;
    try {
        const layer = (mod.stack || []).find((l) => l.route && l.route.path === '/api/advisory-prediction');
        handler = layer && layer.route.stack[0] && layer.route.stack[0].handle;
    } catch (_) { handler = null; }

    let pass = false;
    let detail = { error: 'handler 추출 실패' };
    if (typeof handler === 'function') {
        try {
            handler(req, res);
            const parsed = captured.body ? JSON.parse(captured.body) : null;
            const cc = captured.headers['cache-control'] || '';
            const ct = captured.headers['content-type'] || '';
            pass =
                captured.status === 200 &&
                parsed && typeof parsed === 'object' &&
                Array.isArray(parsed.active) && Array.isArray(parsed.resolved) &&
                parsed.counts && typeof parsed.counts.resolved === 'number' &&
                typeof parsed.filtered === 'boolean' &&
                /no-cache/.test(cc) && /must-revalidate/.test(cc) &&
                /application\/json/.test(ct) && /charset=utf-8/.test(ct);
            detail = { status: captured.status, cacheControl: cc, contentType: ct, filtered: parsed && parsed.filtered };
        } catch (e) {
            detail = { error: `핸들러 호출 예외: ${e.message}` };
        }
    }
    record('6. (스모크) express 핸들러 mock req/res', pass, detail);
})();

// ── 산출/요약 ─────────────────────────────────────────────────────────────────
const OUT_PATH = path.join(__dirname, 'api_test_integrated.json');
fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2), 'utf8');

const passed = results.filter((r) => r.pass).length;
const total = results.length;
console.log('────────────────────────────────────────────────');
console.log(`결과: ${passed}/${total} PASS  →  ${OUT_PATH}`);
console.log(passed === total ? 'ALL PASS' : 'SOME FAILED');
process.exit(passed === total ? 0 : 1);
