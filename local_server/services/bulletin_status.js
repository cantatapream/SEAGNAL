'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_status.js
 * 역할  : 방재기상플랫폼 통보문만으로 해역별(부모+연안바다·평수구역) 특보현황을 계산한다 — 「통보문 기준 특보현황」.
 *         결과는 /api/weather-alerts 와 **같은 모양의 나무**(바다 → 묶음 → 부모 해역 → {current, upcoming, children})라
 *         관리자가 메인 화면에서 [통보문] 버튼을 누르면 같은 화면 코드로 그대로 그린다. 실제 앱(일반 사용자·푸시)은 계속 MMIS 다.
 * 사용자 확정 2026-11-15:
 *   「관리자 권한으로 로그인한 경우에 한해서만 기상정보라는 텍스트 오른쪽에 … MMIS 그리고 통보문이라는 버튼 두 개 … 기본적으로는 MMIS를 기준으로 표출」
 *   「통보문은 3일 전꺼부터 수집해서 관찰 … 이미 발효/발표된 특보들 … 그것부터 따라가도록」
 *   예비특보 시간창이 끝난 뒤 10분까지 정식 특보·연장·취소 글을 기다린다(「10분까지 기다릴 수 있도록 해줘」), 목록에서 빠질 때는 기다리지 않는다.
 * 규칙(analysis/bulletin_survey/README.md — 2025-01~2026-11 전수 검산 3,711/3,712):
 *   특보 = 관서별 입력시각 순으로 변경 칸(t2) 적용(발표·변경 = 그 종류·등급, 해제 = 지움, 해제예고 연장·변경 = 해제 예고만 바꿈).
 *          부모 이름만 = 자식 전부 포함, 일부 포함·제외는 괄호로. 첫 통보문은 발효 중 칸(t6) + 그 통보문 변경 칸으로 시작.
 *   예비 = 관서별 마지막 예비 통보문 목록(전체 목록이 매번 다시 온다) − 그 뒤 「풍랑예비특보 해제」 통보문 구역 − 정식 특보가 된 구역,
 *          시간창 끝 + 10분이 지나면 뺀다.
 *   참고사항 AI 해석은 아직 넣지 않았다(규칙만) — 시험 결과는 bulletin_ai_trial.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_watch(bulletins — 관찰기가 받아 둔 본문) · analysis/bulletin_survey/lifecycle_check(해역 해석) ·
 *                   marine_warning_crawler(_buildZoneTreeFromSnapshot — MMIS 와 같은 나무 모양)
 *  - 저장          : data/bulletin_status.json(마지막 계산 결과)
 *  - 나를 쓰는 곳  : scheduler.js(관찰기 다음 매분) · routes/bulletin_watch.js(GET /api/admin/bulletin-status) · services/bulletin_compare.js · 검사 test_bulletin_status
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const LC = require('../analysis/bulletin_survey/lifecycle_check');
const { lines, splitTop, expand, parseItems, parseCurrent, PARENTS, childrenOf } = LC;

const FILE = path.join(__dirname, '..', 'data', 'bulletin_status.json');
const YEBI_WAIT_MS = 10 * 60e3;   // 예비 시간창 끝 뒤 기다림(사용자 확정 2026-11-15)
const KST = (s) => Date.parse(String(s).slice(0, 19).replace(' ', 'T') + '+09:00');
const pad = (n) => String(n).padStart(2, '0');
/** '2026-11-15 16:00:00.0' → '2026년 11월 15일 16시 00분' (MMIS 나무의 tmFc 꼴) */
const korTime = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/); return m ? `${m[1]}년 ${m[2]}월 ${m[3]}일 ${m[4]}시 ${m[5]}분` : ''; };
const parentOf = (x) => (PARENTS.has(x) ? x : [...PARENTS].find((p) => childrenOf(p).includes(x)));

/** 같은 호는 마지막 판만(호 번호는 해마다 다시 시작 — 연도를 붙인다), 입력시각 순. */
function latest(list) {
    const m = new Map();
    for (const b of list) { const r = b.result; const k = String(r.tmFc).slice(0, 4) + ' ' + r.t1Title; if (!m.has(k) || m.get(k).result.tmIn < r.tmIn) m.set(k, b); }
    return [...m.values()].sort((a, b) => (a.result.tmIn + a.result.tmFc).localeCompare(b.result.tmIn + b.result.tmFc));
}

/**
 * 발효 시각 칸(t3)·내용 칸(t4)을 항목 번호별로 읽는다.
 * 예: t3 '(1) 풍랑주의보 발표 : 2026년 03월 06일 10시 00분' → { 1: { ms, text:'2026년 03월 06일 10시 00분' } }
 *     t4 '(1) 풍랑주의보 발표 / o 해제 예고: 26일 늦은 오후(15시~18시)' → { 1: '26일 늦은 오후(15시~18시)' }
 * [연계] ← computeFormal(이 파일)
 */
function itemTimes(r) {
    const ef = {}, clr = {};
    for (const l of lines(r.t3)) {
        const m = l.match(/^\((\d+)\)[^:]*:\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2})시\s*(\d{1,2})분/);
        if (m) ef[+m[1]] = { ms: Date.parse(`${m[2]}-${pad(m[3])}-${pad(m[4])}T${pad(m[5])}:${pad(m[6])}:00+09:00`), text: `${m[2]}년 ${pad(m[3])}월 ${pad(m[4])}일 ${pad(m[5])}시 ${pad(m[6])}분` };
    }
    let cur = null;
    for (const l of lines(r.t4)) {
        const h = l.match(/^\((\d+)\)/); if (h) { cur = +h[1]; }
        const c = l.match(/해제\s*예고\s*:\s*(.+)$/); if (c && cur != null) clr[cur] = c[1].trim();
    }
    return { ef, clr };
}

/**
 * 「풍랑예비특보 해제」 몫의 구역 — 번호 없는 첫 덩어리(「경북남부앞바다( 평수구역 )」, 「…| (2) 풍랑주의보 발표 : …」 앞부분).
 * @returns {Set<string>} 단위(부모·자식)
 */
function yebiReleaseUnits(r) {
    if (!/예비특보\s*해제/.test(r.t1 || '')) return new Set();
    const first = String(r.t2 || '').replace(/<br\s*\/?>/gi, '\n').split(/\n\s*\(\d+\)|\|\s*\(\d+\)/)[0].replace(/^\(\d+\)[^:]*:\s*/, '');
    const out = new Set();
    for (const tok of splitTop(first.replace(/\s+/g, ''))) { const u = expand(tok, []); if (u) u.forEach((x) => out.add(x)); }
    return out;
}

/**
 * 한 관서의 정식 특보 상태(특보 통보문들 → 단위별 상태).
 * @returns {{state: Map<string, {type, level, tmFc, tmEf, efMs, clr, ho}>, yebiRelease: Array<{ms, units:Set}>}}
 * [연계] ← compute(이 파일)
 */
function computeFormal(list) {
    const state = new Map(), yebiRelease = [];
    let seeded = false;
    for (const b of latest(list)) {
        const r = b.result, items = parseItems(r.t2, []), { ef, clr } = itemTimes(r);
        const base = { tmFc: korTime(r.tmFc), ho: r.t1Title };
        if (!seeded) {
            // 첫 통보문: 발효 중 칸으로 시작(부모 단위) — 3일 전보다 먼저 발효된 특보도 이렇게 잡힌다
            for (const [u, lv] of parseCurrent(r.t6, []).cur) { const m = lv.match(/^(풍랑|태풍)(주의보|경보)$/); if (m) state.set(u, Object.assign({ type: m[1], level: m[2], tmEf: '', efMs: 0, clr: '' }, base)); }
            seeded = true;
        }
        for (const it of items) {
            const t = ef[it.n] || {}, c = clr[it.n];
            for (const u of it.units) {
                if (it.action === '해제') state.delete(u);
                else if (it.action === '발표' || it.action === '변경') state.set(u, Object.assign({ type: it.type, level: it.level, tmEf: t.text || '', efMs: t.ms || 0, clr: c || '' }, base));
                else if (/해제예고|연장/.test(it.action) && state.has(u) && c) state.get(u).clr = c;   // 해제 예고만 바꿈
            }
        }
        const yr = yebiReleaseUnits(r);
        if (yr.size) yebiRelease.push({ ms: KST(r.tmIn), units: yr });
    }
    return { state, yebiRelease };
}

/**
 * 예비 통보문 목록 한 줄씩 → [{unit, start, end, tmEf}] (풍랑·태풍만, 자식만 적힌 줄은 그 자식).
 * 예: '(1) 풍랑 예비특보 | o 11월 16일 저녁(18시~24시) : 제주도남쪽바깥먼바다' → tmEf '2026년 11월 16일 저녁(18시~24시)'
 */
function parseYebiList(text, tmFc) {
    const out = []; let kind = null;
    const y0 = +String(tmFc).slice(0, 4), m0 = +String(tmFc).slice(5, 7);
    for (const l of lines(text)) {
        const h = l.match(/^\(\d+\)\s*(\S+)\s*예비특보/); if (h) { kind = h[1]; continue; }
        const m = l.match(/^[oOㅇ]\s*(\d+)월\s*(\d+)일\s*([^(]*)\((\d+)시~(\d+)시\)\s*:\s*(.+)$/);
        if (!m || !(kind === '풍랑' || kind === '태풍')) continue;
        const mo = +m[1], dd = +m[2], a = +m[4], b = +m[5];
        const yr = mo < m0 - 6 ? y0 + 1 : (mo > m0 + 6 ? y0 - 1 : y0);
        const day = Date.UTC(yr, mo - 1, dd) - 9 * 3600e3;
        const tmEf = `${yr}년 ${pad(mo)}월 ${pad(dd)}일 ${m[3].trim()}(${pad(a)}시~${pad(b)}시)`;
        for (const tok of splitTop(m[6])) { const u = expand(tok, []); if (u) for (const x of u) out.push({ unit: x, type: kind, start: day + a * 3600e3, end: day + (b <= a ? b + 24 : b) * 3600e3, tmEf }); }
    }
    return out;
}

/**
 * 통보문들 → 통보문 기준 특보현황.
 * @param {Array<{office, rpt, result}>} bulletins  bulletin_watch.bulletins()
 * @param {number} nowMs
 * @returns {{zones: Object<string, {parent, kind:'formal'|'yebi', type, level, tmFc, tmEf, clr, ho}>, tree: object, waiting: string[]}}
 *   zones: 단위(부모·자식) → 상태(정식이 예비보다 앞선다) · waiting: 시간창이 끝나 10분 기다리는 예비 단위
 * [연계] ← run(이 파일) · bulletin_compare · test_bulletin_status
 */
function compute(bulletins, nowMs) {
    const byOffice = {};
    for (const b of bulletins) if (b && b.result) (byOffice[b.office] = byOffice[b.office] || { w: [], y: [] })[b.rpt === '7' ? 'y' : 'w'].push(b);
    const zones = {}, waiting = [];
    for (const { w, y } of Object.values(byOffice)) {
        const { state, yebiRelease } = computeFormal(w);
        for (const [u, s] of state) zones[u] = Object.assign({ parent: parentOf(u), kind: 'formal' }, s);
        const lastY = latest(y).pop();
        if (!lastY) continue;
        const tY = KST(lastY.result.tmIn);
        const released = new Set(yebiRelease.filter((x) => x.ms >= tY).flatMap((x) => [...x.units]));
        for (const e of parseYebiList(lastY.result.t4, lastY.result.tmFc)) {
            if (e.end + YEBI_WAIT_MS <= nowMs) continue;              // 끝나고 10분 지남
            if (released.has(e.unit) || zones[e.unit]) continue;       // 예비 해제 통보문·정식 특보가 이미 있음
            if (e.end <= nowMs) waiting.push(e.unit);
            zones[e.unit] = { parent: parentOf(e.unit), kind: 'yebi', type: e.type, level: '예비', tmFc: korTime(lastY.result.tmFc), tmEf: e.tmEf, clr: '', ho: lastY.result.t1Title, endMs: e.end };
        }
    }
    return { zones, tree: toTree(zones), waiting };
}

/**
 * 단위별 상태 → /api/weather-alerts 와 같은 나무(marine_warning_crawler._buildZoneTreeFromSnapshot 재사용), 출처 표시만 'BULLETIN'.
 * [연계] ← compute(이 파일) / → marine_warning_crawler._buildZoneTreeFromSnapshot
 */
function toTree(zones) {
    const info = (z) => ({ wrnTp: z.type, wrnTpNm: z.type, wrnLvlNm: z.level, tmFc: z.tmFc, tmEf: z.tmEf, tmYn: '', clrNtcTm: z.clr || '' });
    const parents = new Map(), upcomings = new Map(), children = new Map();
    for (const [u, z] of Object.entries(zones)) {
        if (PARENTS.has(u)) (z.kind === 'yebi' ? upcomings : parents).set(u, info(z));
        else if (z.parent) { if (!children.has(z.parent)) children.set(z.parent, new Map()); children.get(z.parent).set(u, info(z)); }
    }
    const tree = require('../marine_warning_crawler')._buildZoneTreeFromSnapshot({ parents, upcomings, children });
    (function mark(o) { if (!o || typeof o !== 'object') return; if (o.source === 'MARINE_MMIS') o.source = 'BULLETIN'; for (const v of Object.values(o)) mark(v); })(tree);
    return tree;
}

/**
 * 한 번 계산해 저장한다(관찰기가 돈 다음 매분).
 * @param {{watch?: object, now?: function(): number, file?: string}} [o]
 * @returns {{updatedAt:string, zones:object, current:object, waiting:string[], bulletins:number}}
 * [연계] ← scheduler.js / → data/bulletin_status.json
 */
function run({ watch = require('./bulletin_watch'), now = () => Date.now(), file = FILE } = {}) {
    const list = watch.bulletins();
    const r = compute(list, now());
    const out = { updatedAt: new Date(now()).toISOString(), bulletins: list.length, zones: r.zones, waiting: r.waiting, current: r.tree };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(out)); fs.renameSync(file + '.tmp', file);
    return out;
}
/** 마지막 계산 결과(없으면 null). [연계] → routes/bulletin_watch GET /api/admin/bulletin-status */
function read(file = FILE) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }

module.exports = { compute, run, read, toTree, parseYebiList, itemTimes, yebiReleaseUnits, korTime, YEBI_WAIT_MS };
