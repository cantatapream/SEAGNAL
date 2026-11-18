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
 *          해제는 그 항목의 해제 시각(t3)이 되어야 지운다 — 그 전까지는 특보를 두고 해제 예고 칸에 정확한 시각을 넣는다(2026-11-16 사용자 「해당 시간이 도래해야 지우는거야」).
 *          해제 예고가 범위(「17일 오전(09시~12시)」)이고 범위가 끝났는데 해제 통보문이 없으면 특보를 그대로 둔다(사용자 확정 「가」 — 대전 2026 10-2호: 범위 끝 4시간 뒤 해제).
 *          발효 중 특보 위에 발효 시각이 아직인 「변경·발표」가 오면 지금 것을 두고 다음(next)으로 든다(MMIS current·upcoming — 적대검증 2026-11-16).
 *          부모 이름만 = 자식 전부 포함, 「A(x 제외)」 = x 빼고, 「A(x)」 = **그 자식 x 만**(부모는 건드리지 않는다 — 전 관서 같음, README ⑫).
 *          「A(x)」는 자식 줄기 통보문(통보문 자료의 wrnFc '02' — 연안바다·평수구역 전용)에만 나온다. 부모와 자식의 특보는 따로 살고 끝난다.
 *          첫 통보문은 발효 중 칸(t6) + 그 통보문 변경 칸으로 시작(일반 줄기의 t6 엔 자식 줄이 없어 자식은 어림 → 다음 자식 줄기 통보문으로 맞춤).
 *          부모 없이 자식만 특보면 화면용으로 부모 칸을 「자식만 특보」로 채운다(fillParents — 사용자 결정 2026-11-18 (가)).
 *   예비 = 두 줄기를 따로 읽어 합친다: 부모 = 일반 줄기의 마지막 예비 통보문 목록(전체 목록이 매번 다시 온다),
 *          자식 = 자식 줄기 목록이 더 새것이면 그 목록, 아니면 일반 목록의 부모 예비를 물려받음(+ 부모가 정식 특보 중인 자식만 옛 자식 목록에서).
 *          − 그 뒤 「풍랑예비특보 해제」 통보문 구역 − 정식 특보가 된 구역, 시간창 끝 + 10분이 지나면 뺀다.
 *   참고사항 AI(2026-11-16 사용자 「좋아 그렇게 진행하자」) = 규칙 계산이 끝난 뒤 services/bulletin_ai_live 의 후보(검사 통과분)를 덧씌운다 —
 *          그 해역의 규칙 근거(그 상태를 만든 통보문)보다 **더 새 통보문**일 때만(새 것이 이긴다). 예비취소 → 예비 뺌 · 해제예고변경·연장·정확해제시각 → 해제 예고 칸.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_watch(bulletins — 관찰기가 받아 둔 본문) · analysis/bulletin_survey/lifecycle_check(해역 해석) ·
 *                   services/bulletin_ai_live(candidates — 참고사항 AI 후보) ·
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
    let cur = [];
    for (const l of lines(r.t4)) {
        // 「(1) ,(2) 풍랑주의보 발표 / o 해제 예고: …」처럼 여러 항목이 한 머리를 함께 쓴다(2026-11-15 대구 11-24호) — 머리의 번호를 전부 읽는다
        const h = l.match(/^((?:\(\d+\)\s*,?\s*)+)/); if (h) cur = [...h[1].matchAll(/\((\d+)\)/g)].map((m) => +m[1]);
        const c = l.match(/해제\s*예고\s*:\s*(.+)$/); if (c) for (const n of cur) clr[n] = c[1].trim();
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
 * 한 관서의 정식 특보 상태(특보 통보문들 → 단위별 상태). nowMs = 지금(해제 시각이 아직 안 된 해제는 특보를 두고 해제 예고 칸만 정확한 시각으로).
 * @returns {{state: Map<string, {type, level, tmFc, tmEf, efMs, clr, ho, inMs}>, yebiRelease: Array<{ms, units:Set}>}}  inMs = 그 상태를 만든 통보문 입력시각(AI 덧씌움의 「새 것이 이긴다」 기준)
 * [연계] ← compute(이 파일)
 */
function computeFormal(list, nowMs = Infinity) {
    const state = new Map(), yebiRelease = [];
    let seeded = false;
    for (const b of latest(list)) {
        const r = b.result, items = parseItems(r.t2, []), { ef, clr } = itemTimes(r);
        const base = { tmFc: korTime(r.tmFc), ho: r.t1Title, inMs: KST(r.tmIn) };
        if (!seeded) {
            // 첫 통보문: 발효 중 칸으로 시작(부모 단위) — 3일 전보다 먼저 발효된 특보도 이렇게 잡힌다
            for (const [u, lv] of parseCurrent(r.t6, []).cur) { const m = lv.match(/^(풍랑|태풍)(주의보|경보)$/); if (m) state.set(u, Object.assign({ type: m[1], level: m[2], tmEf: '', efMs: 0, clr: '', issueMs: base.inMs }, base)); }
            //   발효 중 칸은 해제 통보문을 낸 순간 해제 예정 해역을 이미 뺀다 — 첫 통보문이 해제이고 해제 시각이 아직이면 그 해역도 넣어 둔다(아래 해제 항목이 해제 시각까지 둔다).
            //   적대검증 2026-11-16: 강원 2026 1-97호(앞 통보문이 3일 넘게 전) — 해제 시각까지 3시간 「없음」으로 나왔다.
            for (const it of items) if (it.action === '해제' && /^(풍랑|태풍)$/.test(it.type) && (ef[it.n] || {}).ms) for (const u of it.units) if (!state.has(u)) state.set(u, Object.assign({ type: it.type, level: it.level, tmEf: '', efMs: 0, clr: '' }, base));
            //   일반 줄기 통보문의 발효 중 칸은 부모만 적는다(자식 줄은 자식 줄기 통보문에만) — 3일보다 먼저 발표된 특보의 자식이 통째로 빠졌다
            //   (2026-11-18 되풀이: 자식 줄기 통보문 323건 중 7건 — 부산 2026 9-15호 등). 부모 이름만 = 자식 전부가 기본이므로(부모 발표 1,512건 중 1,361건)
            //   그 부모의 자식을 「전부 포함」으로 어림(assumed)해 두고, 뒤에 오는 자식 줄기 통보문의 발효 중 칸(특보 중인 자식을 전부 적는다)으로 맞춘다(아래).
            //   이 통보문이 스스로 발표·변경하는 부모는 어림하지 않는다 — 아래 항목이 「제외」 줄까지 읽어 정확히 넣는다.
            if (r.wrnFc !== '02') {
                const own = new Set(items.filter((it) => it.action === '발표' || it.action === '변경').flatMap((it) => [...it.units]));
                for (const [u, z] of [...state]) if (PARENTS.has(u) && !own.has(u)) for (const k of childrenOf(u)) if (!state.has(k)) state.set(k, Object.assign({}, z, { assumed: true }));
            }
            seeded = true;
        }
        for (const it of items) {
            const t = ef[it.n] || {}, c = clr[it.n];
            for (const u of it.units) {
                // 이 통보문이 들어올 때 이미 해제 시각이 지난 상태는 끝난 것 — 다음 특보(next)가 기다리면 그것이 이어받고, 없으면 지운다.
                //   2026-11-18 실자료: 대전 2025 12-12 01:00 에 해제된 당진평수구역이 12-14 00:04 부모 재발표(12-23호) 때 「지금 발효 중」으로 잡혀,
                //   2분 뒤 자식 해제(12-24호, 03:00)의 해제 시각을 넘겨받고 03:00 까지 「주의보 발효 중(11일 10:00~)」으로 되살아났다.
                //   해제예고·연장은 건드리지 않는다(해제 시각 전에 들어온 연장이 그 해제를 물릴 수 있다).
                if (it.action === '해제' || it.action === '발표' || it.action === '변경') { const z = state.get(u); if (z && z.relMs && z.relMs <= base.inMs) { if (z.next) state.set(u, z.next); else state.delete(u); } }
                // 부모를 적은 항목의 「x 제외」 = 그 자식은 이 특보에 들어 있지 않다(해제라면 이미 끝나 있었다 — 자식은 부모보다 오래 살지 않는다, 실자료 0건).
                //   어림으로 넣어 둔 자식(assumed)이 거기 해당하면 뺀다 — 안 빼면 부모가 끝난 뒤 그 자식만 남아 「자식만 특보」 카드가 생기거나(되풀이 4건: 부산 2025 8-36호 등),
                //   부모가 「변경」된 뒤 옛 등급으로 남는다(적대검증 2026-11-18 — 실자료 0건).
                if (PARENTS.has(u)) for (const k of childrenOf(u)) { const c = state.get(k); if (c && c.assumed && !it.units.has(k)) state.delete(k); }
                if (it.action === '해제') {
                    // 해제 시각(t3)이 아직이면 지우지 않는다 — 해제 예고 칸 = 정확한 해제 시각(앱 「🕐 해제시각 변경」과 같은 걸음), 그 시각이 되면 지운다
                    //   시각이 이미 지났어도 여기선 달아만 둔다 — 뒤 통보문(해제예고연장 등)이 이 해제를 물릴 수 있으니, 다 적용한 뒤 시각 지난 것을 지운다(아래)
                    //   아직 발효 전인 특보를 그 발효 시각 전(또는 같은 시각)에 해제 = 한 번도 발효하지 않는다 → 바로 뺀다.
                    //   실자료 45건 전부 「부모 이름만 발표(자식 포함) → 20분 안에 자식 줄기가 그 자식 해제」 — 「x 제외」 줄 대신 쓰는 방법(README ⑫ ③).
                    //   기다리던 다음 특보(next — 발효 전 「변경」 등)도 같다: 그 발효 시각 전에 해제되면 이어받지 않는다(적대검증 2026-11-18 — 실자료 0건, 종전엔 해제 뒤 그 등급이 되살아났다).
                    const z = state.get(u);
                    if (z && t.ms && z.next && z.next.efMs >= t.ms) delete z.next;
                    if (z && t.ms && !(z.efMs && z.efMs >= t.ms)) Object.assign(z, { clr: t.text, relMs: t.ms, inMs: base.inMs });
                    else state.delete(u);
                }
                else if (it.action === '발표' || it.action === '변경') {
                    const nx = Object.assign({ type: it.type, level: it.level, tmEf: t.text || '', efMs: t.ms || 0, clr: c || '', issueMs: base.inMs }, base), cur = state.get(u);   // issueMs = 이 특보를 낸 통보문(해제예고만 바뀌어도 그대로) — 다가오는 예비가 이 특보보다 새것인지 볼 때
                    // 지금 발효 중인 특보가 있는데 새 특보의 발효 시각이 아직이면 지금 것을 두고 다음 것(next)으로 — 앱(MMIS)이 current·upcoming 을 함께 드는 것과 같다.
                    //   적대검증 2026-11-16: 주의보→경보 「변경」(발효 10:00)을 09:02 부터 「발표(발효 전)」으로만 들어 지금 주의보가 사라지고 「📢 경보 발표」로 나갔다 — 앱은 「격상 발표」(실제 954 단위).
                    if (cur && cur.inMs !== base.inMs && !(cur.efMs > nowMs) && nx.efMs > nowMs) cur.next = nx;   // 같은 통보문이 만든 상태(첫 통보문의 발효 중 칸 등)는 그대로 바꾼다
                    else state.set(u, nx);
                }
                else if (/해제예고|연장/.test(it.action) && state.has(u) && c) { const z = state.get(u); Object.assign(z, { clr: c, inMs: base.inMs }); delete z.relMs; }   // 해제 예고만 바꿈(그 통보문이 새 근거 — 해제 시각 기다림도 그 통보문을 따른다)
            }
        }
        // 자식 줄기 통보문의 발효 중 칸 = 그 순간 특보 중인 자식 전부 → 어림해 둔 자식(assumed)을 맞춘다: 적혀 있으면(또는 이 통보문이 해제 중이면) 확정, 없으면 창 밖에서 이미 빠진 것
        if (r.wrnFc === '02') { const kids6 = parseCurrent(r.t6, []).cur; for (const [u, z] of [...state]) if (z.assumed) { if (kids6.has(u) || z.relMs) delete z.assumed; else state.delete(u); } }
        const yr = yebiReleaseUnits(r);
        if (yr.size) yebiRelease.push({ ms: KST(r.tmIn), units: yr });
    }
    // 해제 시각이 된 것만 지운다 — 그 사이 같은 단위에 새 특보가 발표돼 다음(next)으로 기다리고 있었으면 그것이 이어받는다(해제 뒤 재발표)
    for (const [u, z] of state) if (z.relMs && z.relMs <= nowMs) { if (z.next) state.set(u, z.next); else state.delete(u); }
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
 * @param {Array<{종류, zones:string[], office, ho, inMs, 시간_후}>} [cands] 참고사항 AI 후보(bulletin_ai_live.candidates — 입력시각 순)
 * @returns {{zones: Object<string, {parent, kind:'formal'|'yebi', type, level, tmFc, tmEf, clr, ho, inMs, ai?}>, tree: object, waiting: string[], aiApplied: Array}}
 *   zones: 단위(부모·자식) → 상태(정식이 예비보다 앞선다 — 정식 중인 해역의 예비는 그 정식의 upYebi(다가오는 특보)) · waiting: 시간창이 끝나 10분 기다리는 예비 단위 · aiApplied: 실제로 덧씌운 AI 후보
 * [연계] ← run(이 파일) · bulletin_compare · test_bulletin_status
 */
function compute(bulletins, nowMs, cands = []) {
    const byOffice = {};
    for (const b of bulletins) if (b && b.result) (byOffice[b.office] = byOffice[b.office] || { w: [], y: [] })[b.rpt === '7' ? 'y' : 'w'].push(b);
    const zones = {}, waiting = [];
    for (const { w, y } of Object.values(byOffice)) {
        const { state, yebiRelease } = computeFormal(w, nowMs);
        for (const [u, s] of state) zones[u] = Object.assign({ parent: parentOf(u), kind: 'formal' }, s);
        // 예비 통보문은 두 줄기다(README ⑫): 일반 줄기(부모 이름 — 자식 포함) · 자식 줄기(wrnFc '02' — 「A(자식)」 = 그 자식만, 2026-06-20 부터).
        //   종전엔 가장 최근 예비 통보문 하나만 봐서, 자식 줄기가 최신이면 일반 줄기의 부모 예비가 통째로 빠졌다(딸린 예비 현황과 어긋난 「C 유형」의 원인).
        //   부모 예비 = 일반 줄기의 최신 목록. 자식 예비 = 자식 줄기 목록이 더 새것이면 그 목록이 전부(「없음」 = 자식 예비 없음 — 실자료 24건 전부 그렇게 읽힌다),
        //   일반 목록이 더 새것이면 그 부모 예비를 물려받고, 옛 자식 줄기 목록에서는 부모가 정식 특보 중인 자식(자식만 예비)만 남긴다.
        const yR = latest(y.filter((b) => b.result.wrnFc !== '02')).pop(), yK = latest(y.filter((b) => b.result.wrnFc === '02')).pop();
        if (!yR && !yK) continue;
        const tR = yR ? KST(yR.result.tmIn) : 0, tK = yK ? KST(yK.result.tmIn) : 0;
        const listOf = (b, tY) => parseYebiList(b.result.t4, b.result.tmFc).filter((e) => e.end + YEBI_WAIT_MS > nowMs).map((e) => Object.assign(e, { src: b.result, tY }));   // 끝나고 10분 지난 것은 뺌
        const listR = yR ? listOf(yR, tR) : [], listK = yK ? listOf(yK, tK).filter((e) => !PARENTS.has(e.unit)) : [];
        const ylist = tK > tR
            ? listR.filter((e) => PARENTS.has(e.unit)).concat(listK)
            : listR.concat(listK.filter((e) => { const p = zones[parentOf(e.unit)]; return p && p.kind === 'formal' && !listR.some((x) => x.unit === e.unit); }));
        const wins = {}; for (const e of ylist) wins[e.unit] = (wins[e.unit] || 0) + 1;   // 단위별 남은 시간창 수 — AI 예비취소가 다른 시간창까지 지우지 않게
        for (const e of ylist) {
            if (yebiRelease.some((x) => x.ms >= e.tY && x.units.has(e.unit))) continue;   // 예비 해제 통보문(그 목록보다 나중)
            const z0 = zones[e.unit], tY = e.tY;
            if (z0) {
                // 정식 특보가 발효 중인 해역의 예비 = 「다가오는 특보」(upYebi — 앱 MMIS 의 current·upcoming 공존과 같다). 정식이 해제되면 이 예비가 이어받는다(정식이 지워진 계산에선 아래 일반 예비로).
                //   사용자 확정 2026-11-17 「풍랑주의보 발효 중인경우 같은 해역에 예비 특보가 나오는 경우 다가오는 특보로」 — 종전엔 버렸다(실측 155건 전부).
                //   다음 정식 특보(next)가 이미 기다리면 그쪽이 다가오는 칸을 쓴다. 시간창이 여럿이면 가장 이른 것.
                //   단, 그 예비 목록이 이 정식 특보보다 나중에 나왔을 때만 — 먼저 나온 목록의 예비는 이 정식 특보로 넘어간 것(실측: 종전 규칙대로면 1,441건이 더 있음)
                if (z0.kind === 'formal' && !z0.next && !z0.upYebi && tY > (z0.issueMs || z0.inMs || 0)) z0.upYebi = { type: e.type, level: '예비', tmFc: korTime(e.src.tmFc), tmEf: e.tmEf, ho: e.src.t1Title, inMs: tY, endMs: e.end, yebiWins: wins[e.unit] };
                continue;
            }
            if (e.end <= nowMs) waiting.push(e.unit);
            zones[e.unit] = { parent: parentOf(e.unit), kind: 'yebi', type: e.type, level: '예비', tmFc: korTime(e.src.tmFc), tmEf: e.tmEf, clr: '', ho: e.src.t1Title, endMs: e.end, inMs: tY, yebiWins: wins[e.unit] };
        }
    }
    const aiApplied = applyAi(zones, cands);
    fillParents(zones);
    return { zones, tree: toTree(zones), waiting: waiting.filter((u) => zones[u]), aiApplied };
}

/**
 * 자식 해역(연안바다·평수구역)에만 특보가 있고 부모 칸이 비어 있으면, 화면에 보이도록 부모 칸을 「자식만 특보」(derived)로 채운다.
 *   통보문의 「A(평수구역)」 = 그 평수구역만 — 부모 A 는 특보가 아니다(README ⑫: 전 관서 같음, 자식 줄기 통보문).
 *   실자료에서 부모 없이 자식만 특보인 것은 2건(수도권 2025 8-29호 「인천·경기남부앞바다(먼평수구역)」 09:10~15:15 · 2026 2-37호 평수구역 3곳, 부모는 밤 예비).
 *   메인 화면(data.js)은 부모 칸이 있어야 카드가 나오므로 그 2건이 화면에서 빠진다 → 사용자 결정 2026-11-18
 *   「(가) 부모 카드를 "일부 해역(평수구역)만"으로 띄우고, 자식이 끝나면 함께 사라지게」.
 *   매 계산마다 다시 만든다(상태로 들지 않는다) — 자식이 끝나면 부모 칸도 없다. 부모가 부모 자신으로 특보 중이면 건드리지 않는다.
 *   고르는 법: 정식 > 예비, 같은 단계면 경보 > 주의보, 그다음 먼저 발효(예비는 이른 시간창).
 *   부모가 예비뿐인데 자식이 정식이면 부모 칸을 「자식만 특보」로 올리고, 부모의 예비는 다가오는 특보(upYebi)로 옮긴다(2-37호).
 * 예: { 인천·경기남부앞바다중먼평수구역: {kind:'formal', level:'주의보'} } → 인천·경기남부앞바다 = 같은 주의보(derived:true) → 나무에서 current.kidsOnly = true
 * [연계] ← compute(이 파일) / → toTree(부모 current·upcoming, kidsOnly 표시)
 */
function fillParents(zones) {
    const rank = (z) => (z.kind === 'formal' ? 100 : 0) + (z.level === '경보' ? 10 : 0) - (z.efMs || z.endMs || 0) / 1e13;
    const best = new Map();
    for (const [u, z] of Object.entries(zones)) {
        if (PARENTS.has(u) || !z.parent) continue;
        const own = zones[z.parent];
        // 부모 칸이 비었거나, 부모는 예비뿐인데 자식이 정식 특보일 때(수도권 2026 2-37호: 「인천·경기북부앞바다(평수구역)」만 주의보 — 부모는 앞 목록의 예비로 남았다)
        if (own && !(own.kind === 'yebi' && z.kind === 'formal')) continue;
        const b = best.get(z.parent);
        if (!b || rank(z) > rank(b)) best.set(z.parent, z);
    }
    for (const [p, z] of best) {
        const own = zones[p];
        const c = Object.assign({}, z, { parent: p, derived: true });
        delete c.upYebi; delete c.next; delete c.relMs;
        //   부모가 갖고 있던 예비는 버리지 않고 「다가오는 특보」로 — MMIS current(주의보)·upcoming(예비) 공존과 같은 꼴
        if (own && own.kind === 'yebi') c.upYebi = { type: own.type, level: '예비', tmFc: own.tmFc, tmEf: own.tmEf, ho: own.ho, inMs: own.inMs, endMs: own.endMs, yebiWins: own.yebiWins };
        zones[p] = c;
    }
}

/**
 * 참고사항 AI 후보를 규칙 결과 위에 덧씌운다 — 그 단위의 규칙 근거 통보문보다 후보 통보문이 더 새것일 때만(새 것이 이긴다).
 *   예비취소 → 예비 단위를 뺀다(예비 목록 통보문이 1~4분 늦게 오는 틈 — 늦게 온 목록이 그 해역을 다시 적으면 그 목록이 더 새것이라 다시 들어온다).
 *             단, 그 단위에 남은 예비 시간창이 둘 이상이면 어느 시간창인지 못 가려 안 뺀다.
 *   해제예고변경·해제예고연장·정확해제시각 → 발효 중 특보 단위의 해제 예고 칸을 시간_후 글자로.
 * 후보의 해역은 부모 이름(resolveZones) — 그 부모와 그 자식 단위에 건다.
 * 예: zones { 남해동부바깥먼바다: {kind:'yebi', inMs: 10:00} } + 후보 { 종류:'예비취소', zones:['남해동부바깥먼바다'], inMs: 10:02 } → 뺌
 * @returns {Array<{office, ho, unit, 종류, what}>} 실제로 덧씌운 것
 * [연계] ← compute(이 파일) / 후보 ← services/bulletin_ai_live.candidates
 */
function applyAi(zones, cands) {
    const out = [];
    for (const c of cands || []) {
        const ps = new Set(c.zones || []);
        for (const [u, z] of Object.entries(zones)) {
            //   exact = 해역이 본문 항목의 실제 단위(「위 해역」) — 그 단위에만(부모로 넓히지 않는다: 자식만 해제할 때 남는 부모를 덮던 일, 적대검증 2026-11-16 부산 2025 1-60호)
            if (!(ps.has(u) || (!c.exact && ps.has(z.parent)))) continue;
            //   다가오는 예비 취소는 그 예비보다 새것이면 된다(정식이 그 뒤 해제예고 등으로 더 새로워져도 — 적대검증 2026-11-17 D4)
            if (c.종류 === '예비취소' && z.kind === 'formal' && z.upYebi && !(z.upYebi.yebiWins > 1) && c.inMs > (z.upYebi.inMs || 0)) { delete z.upYebi; out.push({ office: c.office, ho: c.ho, unit: u, 종류: c.종류, what: '다가오는 예비 뺌' }); continue; }
            if (!(c.inMs > (z.inMs || 0))) continue;
            //   예비 시간창이 둘 이상 남은 단위는 문장이 어느 시간창을 지웠는지 단위만으로 못 가린다 → 안 덧씌움(적대검증 2026-11-16)
            //   정식 특보 중인 해역의 다가오는 예비(upYebi)도 같은 규칙으로 — 그 예비보다 새 통보문이고 시간창이 하나일 때만
            if (c.종류 === '예비취소' && z.kind === 'yebi' && !(z.yebiWins > 1)) { delete zones[u]; out.push({ office: c.office, ho: c.ho, unit: u, 종류: c.종류, what: '예비 뺌' }); }
            else if (c.종류 !== '예비취소' && z.kind === 'formal' && c.시간_후) {
                Object.assign(z, { clr: c.시간_후, inMs: c.inMs, ai: { ho: c.ho, 종류: c.종류 } }); delete z.relMs;   // 더 새 통보문의 해제 예고가 이긴다 — 앞 해제 시각 기다림도 그만
                out.push({ office: c.office, ho: c.ho, unit: u, 종류: c.종류, what: '해제 예고 → ' + c.시간_후 });
            }
        }
    }
    return out;
}

/**
 * 단위별 상태 → /api/weather-alerts 와 같은 나무(marine_warning_crawler._buildZoneTreeFromSnapshot 재사용), 출처 표시만 'BULLETIN'.
 * [연계] ← compute(이 파일) / → marine_warning_crawler._buildZoneTreeFromSnapshot
 */
function toTree(zones) {
    const info = (z) => ({ wrnTp: z.type, wrnTpNm: z.type, wrnLvlNm: z.level, tmFc: z.tmFc, tmEf: z.tmEf, tmYn: '', clrNtcTm: z.clr || '' });
    const parents = new Map(), upcomings = new Map(), children = new Map();
    for (const [u, z] of Object.entries(zones)) {
        if (PARENTS.has(u)) { (z.kind === 'yebi' ? upcomings : parents).set(u, info(z)); const up = z.next || z.upYebi; if (up) upcomings.set(u, info(up)); }   // 발효 중 + 다가오는 특보(다음 정식 또는 예비) = MMIS current·upcoming
        else if (z.parent) { if (!children.has(z.parent)) children.set(z.parent, new Map()); children.get(z.parent).set(u, info(z)); }
    }
    const tree = require('../marine_warning_crawler')._buildZoneTreeFromSnapshot({ parents, upcomings, children });
    (function mark(o) { if (!o || typeof o !== 'object') return; if (o.source === 'MARINE_MMIS') o.source = 'BULLETIN'; for (const v of Object.values(o)) mark(v); })(tree);
    // 「자식만 특보」(fillParents 가 채운 부모) — 화면이 「일부 해역만」으로 적을 수 있게 그 부모 칸에 표시한다
    const derived = new Set(Object.entries(zones).filter(([u, z]) => PARENTS.has(u) && z.derived).map(([u]) => u));
    if (derived.size) (function tag(o) { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (derived.has(k) && v && typeof v === 'object') { for (const slot of ['current', 'upcoming']) if (v[slot] && !(slot === 'upcoming' && zones[k].upYebi)) v[slot].kidsOnly = true; } else tag(v); } })(tree);
    return tree;
}

/**
 * 한 번 계산해 저장한다(관찰기가 돈 다음 매분).
 * @param {{watch?: object, ai?: object, now?: function(): number, file?: string}} [o]  ai = 참고사항 AI 후보 출처(bulletin_ai_live — candidates())
 * @returns {{updatedAt:string, zones:object, current:object, waiting:string[], bulletins:number, aiApplied:Array}}
 * [연계] ← scheduler.js / → data/bulletin_status.json
 */
function run({ watch = require('./bulletin_watch'), ai = require('./bulletin_ai_live'), now = () => Date.now(), file = FILE } = {}) {
    const list = watch.bulletins();
    let cands = [];
    try { cands = ai.enabled === false ? [] : ai.candidates(); } catch (e) { console.warn('[통보문 기준] AI 후보를 못 읽어 규칙만:', e && e.message); }
    const r = compute(list, now(), cands);
    const out = { updatedAt: new Date(now()).toISOString(), bulletins: list.length, zones: r.zones, waiting: r.waiting, current: r.tree, aiApplied: r.aiApplied };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(out)); fs.renameSync(file + '.tmp', file);
    return out;
}
/** 마지막 계산 결과(없으면 null). [연계] → routes/bulletin_watch GET /api/admin/bulletin-status */
function read(file = FILE) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }

module.exports = { compute, applyAi, fillParents, run, read, toTree, parseYebiList, itemTimes, yebiReleaseUnits, korTime, YEBI_WAIT_MS };
