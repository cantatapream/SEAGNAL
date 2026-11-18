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
 *   발자취(2026-11-18 사용자 「해당 특보의 시작(발표)부터 종료까지 특보의 생애주기 동안에 대한 통보문이 나오도록」 · 「적용범위는 나(모든 사용자)」) =
 *          단위마다 「지금 특보」에 관여한 통보문(예비 → 발표 → 변경·연장 → 해제)을 함께 적어 둔다(trails) → 메인 화면 📋 해역별 통보문 팝업이 이것을 보인다
 *          (zoneBulletins — **일반 사용자 앱에도 나가는 유일한 통보문 기준 자료**. 특보현황·푸시는 계속 MMIS). 해제 시각이 되면 그 단위가 빠지며 발자취도 끝난다.
 *          누르면 종전처럼 원문 PDF 가 열린다 — 주소는 통보문 자료만으로 만든다(pdfOf — MMIS 코드와 엮지 않는다: 사용자 「나중에는 mmis를 … 삭제할 예정 … 엮이면 안될 것」).
 *          그림 이름이 없거나 PDF 가 아직 안 올라온 통보문(keepLivePdf)은 본문 글을 펼친다. 참고사항 AI 는 발자취에 섞지 않는다(규칙 계산까지만 일반 사용자에게 나간다).
 *          2026-11-18 부터 원문은 우리 서버에 받아 쪽 그림으로 바꿔 두고(services/bulletin_docs — 발자취에 든 동안만) 그것을 먼저 보인다. 구글 문서 뷰어·바깥 PDF 는 그림이 아직 없을 때의 길.
 *          검산: analysis/bulletin_survey/trail_check.js(발효 중 칸에 끊김 없이 적힌 구간의 첫 통보문 = 발자취의 첫 정식 통보문, 10,241/10,241).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_watch(bulletins — 관찰기가 받아 둔 본문) · analysis/bulletin_survey/lifecycle_check(해역 해석) ·
 *                   services/bulletin_ai_live(candidates — 참고사항 AI 후보) ·
 *                   marine_warning_crawler(_buildZoneTreeFromSnapshot — MMIS 와 같은 나무 모양)
 *  - 저장          : data/bulletin_status.json(마지막 계산 결과 — zones·current 나무·trails 발자취·listsOkMs)
 *  - 나를 쓰는 곳  : scheduler.js(관찰기 다음 매분) · routes/bulletin_watch.js(GET /api/admin/bulletin-status) · services/bulletin_compare.js ·
 *                   routes/weather.js(GET /api/zone-bulletins — 📋 해역별 통보문 팝업, zoneBulletins) · 검사 test_bulletin_status
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const LC = require('../analysis/bulletin_survey/lifecycle_check');
const { norm, lines, splitTop, expand, parseItems, parseCurrent, PARENTS, childrenOf } = LC;

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
 * @returns {{state: Map<string, {type, level, tmFc, tmEf, efMs, clr, ho, inMs}>, yebiRelease: Array<{ms, units:Set}>, ended: Map<string, number>}}  inMs = 그 상태를 만든 통보문 입력시각(AI 덧씌움의 「새 것이 이긴다」 기준)
 * [연계] ← compute(이 파일)
 */
function computeFormal(list, nowMs = Infinity) {
    const state = new Map(), yebiRelease = [];
    // ended: 단위 → 해제로 끝난 마지막 정식 특보를 낸 통보문 시각. 그 특보보다 먼저 나온 예비 목록은 그 특보로 넘어간 「옛 예비」라, 특보가 해제된 뒤 다시 예비로 보이면 안 된다.
    //   전수조사 2026-11-18: 실자료에서 부모 3번(창 끝 시각에 해제 → 10분 대기 동안. 제주 2026-11-02 서부앞바다 18:01~18:09) ·
    //   자식 22번(부모 발표로 함께 발효됐다가 자식만 먼저 해제 — 최장 제주 2026-03-25 남부 연안바다 10:31~12:09) 되살아났다.
    //   한 번도 발효하지 않고 빠진 것(「x 제외」 · 발효 전 해제)은 여기 넣지 않는다 — 그 예비는 특보로 넘어간 적이 없어 그대로 남는다(대구 2026 6-3호가 나중에 따로 취소).
    const ended = new Map(), end = (u, z) => ended.set(u, z.issueMs || z.inMs || 0);
    let seeded = false;
    for (const b of latest(list)) {
        const r = b.result, items = parseItems(r.t2, []), { ef, clr } = itemTimes(r);
        const base = { tmFc: korTime(r.tmFc), ho: r.t1Title, inMs: KST(r.tmIn) };
        // 발자취(trail) — 그 단위의 지금 특보(생애주기)에 관여한 통보문을 차례로 적어 둔다(📋 해역별 통보문 팝업, 사용자 2026-11-18 「해당 특보의 시작(발표)부터 종료까지」).
        //   발표 = 새 발자취(앞 특보가 해제 통보문을 받은 뒤의 발표도 새 특보) · 발효 중 특보 위의 발표·변경 = 같은 발자취에 잇는다 · 해제·연장 = 덧붙인다.
        //   첫 통보문의 발효 중 칸으로 시작한 특보는 앞부분(발표)을 모른다(cut).
        const mark = (it) => ({ rpt: '6', office: b.office, ho: r.t1Title, inMs: base.inMs, act: `${it.type}${it.level} ${it.action}` });
        if (!seeded) {
            // 첫 통보문: 발효 중 칸으로 시작(부모 단위) — 3일 전보다 먼저 발효된 특보도 이렇게 잡힌다
            for (const [u, lv] of parseCurrent(r.t6, []).cur) { const m = lv.match(/^(풍랑|태풍)(주의보|경보)$/); if (m) state.set(u, Object.assign({ type: m[1], level: m[2], tmEf: '', efMs: 0, clr: '', issueMs: base.inMs, cut: true }, base)); }
            //   발효 중 칸은 해제 통보문을 낸 순간 해제 예정 해역을 이미 뺀다 — 첫 통보문이 해제이고 해제 시각이 아직이면 그 해역도 넣어 둔다(아래 해제 항목이 해제 시각까지 둔다).
            //   적대검증 2026-11-16: 강원 2026 1-97호(앞 통보문이 3일 넘게 전) — 해제 시각까지 3시간 「없음」으로 나왔다.
            for (const it of items) if (it.action === '해제' && /^(풍랑|태풍)$/.test(it.type) && (ef[it.n] || {}).ms) for (const u of it.units) if (!state.has(u)) state.set(u, Object.assign({ type: it.type, level: it.level, tmEf: '', efMs: 0, clr: '', cut: true }, base));
            //   일반 줄기 통보문의 발효 중 칸은 부모만 적는다(자식 줄은 자식 줄기 통보문에만) — 3일보다 먼저 발표된 특보의 자식이 통째로 빠졌다
            //   (2026-11-18 되풀이: 자식 줄기 통보문 323건 중 7건 — 부산 2026 9-15호 등). 부모 이름만 = 자식 전부가 기본이므로(부모 발표 1,512건 중 1,361건)
            //   그 부모의 자식을 「전부 포함」으로 어림(assumed)해 두고, 뒤에 오는 자식 줄기 통보문의 발효 중 칸(특보 중인 자식을 전부 적는다)으로 맞춘다(아래).
            //   이 통보문이 스스로 발표·변경하는 부모는 어림하지 않는다 — 아래 항목이 「제외」 줄까지 읽어 정확히 넣는다.
            if (r.wrnFc !== '02') {
                const own = new Set(items.filter((it) => it.action === '발표' || it.action === '변경').flatMap((it) => [...it.units]));
                for (const [u, z] of [...state]) if (PARENTS.has(u) && !own.has(u)) for (const k of childrenOf(u)) if (!state.has(k)) state.set(k, Object.assign({}, z, { assumed: true, trail: [] }));
            }
            seeded = true;
        }
        for (const it of items) {
            const t = ef[it.n] || {}, c = clr[it.n];
            for (const u of it.units) {
                // 이 통보문이 들어올 때 이미 해제 시각이 지난 상태는 끝난 것 — 다음 특보(next)가 기다리면 그것이 이어받고, 없으면 지운다.
                //   2026-11-18 실자료: 대전 2025 12-12 01:00 에 해제된 당진평수구역이 12-14 00:04 부모 재발표(12-23호) 때 「지금 발효 중」으로 잡혀,
                //   2분 뒤 자식 해제(12-24호, 03:00)의 해제 시각을 넘겨받고 03:00 까지 「주의보 발효 중(11일 10:00~)」으로 되살아났다.
                //   연장(해제 예고 연장)도 같다 — 해제 시각 **전에** 들어온 연장은 그 해제를 물리지만(아래), 해제 시각이 지난 뒤에 온 연장은 이미 끝난 특보를 되살리지 않는다.
                //   전수조사 2026-11-18: 수도권 2025 2-5호(평수구역 3곳 해제 11:25) 3분 뒤 2-6호 「풍랑주의보 연장 : 서해중부앞바다(…)」(부모 이름 = 자식 포함)가
                //   그 평수구역을 25분간 주의보로 되살렸다(기상청이 2-7호로 다시 해제). 해제 시각 뒤에 온 연장은 실자료에 이 꼴(부모 연장에 딸려 온 자식 5단위)뿐.
                { const z = state.get(u); if (z && z.relMs && z.relMs <= base.inMs) { if (z.next) state.set(u, z.next); else { end(u, z); state.delete(u); } } }
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
                    if (z && t.ms && !(z.efMs && z.efMs >= t.ms)) { Object.assign(z, { clr: t.text, relMs: t.ms, inMs: base.inMs }); (z.trail = z.trail || []).push(mark(it)); }
                    else { if (z && !t.ms) end(u, z); state.delete(u); }   // 해제 시각을 못 읽은 해제 = 바로 끝(발효 전 해제는 ended 에 넣지 않는다)
                }
                else if (it.action === '발표' || it.action === '변경') {
                    const nx = Object.assign({ type: it.type, level: it.level, tmEf: t.text || '', efMs: t.ms || 0, clr: c || '', issueMs: base.inMs }, base), cur = state.get(u);   // issueMs = 이 특보를 낸 통보문(해제예고만 바뀌어도 그대로) — 다가오는 예비가 이 특보보다 새것인지 볼 때
                    // 지금 발효 중인 특보가 있는데 새 특보의 발효 시각이 아직이면 지금 것을 두고 다음 것(next)으로 — 앱(MMIS)이 current·upcoming 을 함께 드는 것과 같다.
                    //   적대검증 2026-11-16: 주의보→경보 「변경」(발효 10:00)을 09:02 부터 「발표(발효 전)」으로만 들어 지금 주의보가 사라지고 「📢 경보 발표」로 나갔다 — 앱은 「격상 발표」(실제 954 단위).
                    // 발자취: 해제 통보문을 받은 특보 뒤의 발표 = 새 특보(새 발자취), 그 밖에는 지금 특보에 잇는다(같은 배열 — 다음(next)으로 기다리는 동안에도 지금 특보 쪽에서 보인다)
                    const cont = cur && !cur.relMs;
                    nx.trail = cont ? (cur.trail = cur.trail || []) : [];
                    nx.trail.push(mark(it));
                    if (cont && cur.cut && !(it.action === '발표' && cur.inMs === base.inMs)) nx.cut = true;   // 첫 통보문이 스스로 「발표」한 것만 앞부분을 안다
                    if (cur && cur.inMs !== base.inMs && !(cur.efMs > nowMs) && nx.efMs > nowMs) cur.next = nx;   // 같은 통보문이 만든 상태(첫 통보문의 발효 중 칸 등)는 그대로 바꾼다
                    else state.set(u, nx);
                }
                else if (/해제예고|연장/.test(it.action) && state.has(u) && c) { const z = state.get(u); Object.assign(z, { clr: c, inMs: base.inMs }); delete z.relMs; (z.trail = z.trail || []).push(mark(it)); }   // 해제 예고만 바꿈(그 통보문이 새 근거 — 해제 시각 기다림도 그 통보문을 따른다)
            }
        }
        // 자식 줄기 통보문의 발효 중 칸 = 그 순간 특보 중인 자식 전부 → 어림해 둔 자식(assumed)을 맞춘다: 적혀 있으면(또는 이 통보문이 해제 중이면) 확정, 없으면 창 밖에서 이미 빠진 것
        if (r.wrnFc === '02') { const kids6 = parseCurrent(r.t6, []).cur; for (const [u, z] of [...state]) if (z.assumed) { if (kids6.has(u) || z.relMs) delete z.assumed; else state.delete(u); } }
        const yr = yebiReleaseUnits(r);
        if (yr.size) yebiRelease.push({ ms: KST(r.tmIn), units: yr });
    }
    // 해제 시각이 된 것만 지운다 — 그 사이 같은 단위에 새 특보가 발표돼 다음(next)으로 기다리고 있었으면 그것이 이어받는다(해제 뒤 재발표)
    for (const [u, z] of state) if (z.relMs && z.relMs <= nowMs) { if (z.next) state.set(u, z.next); else { end(u, z); state.delete(u); } }
    return { state, yebiRelease, ended };
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
 * @returns {{zones: Object<string, {parent, kind:'formal'|'yebi', type, level, tmFc, tmEf, clr, ho, inMs, ai?}>, tree: object, waiting: string[], aiApplied: Array, trails: object}}  trails = 단위별 통보문 발자취(buildTrails)
 *   zones: 단위(부모·자식) → 상태(정식이 예비보다 앞선다 — 정식 중인 해역의 예비는 그 정식의 upYebi(다가오는 특보)) · waiting: 시간창이 끝나 10분 기다리는 예비 단위 · aiApplied: 실제로 덧씌운 AI 후보
 * [연계] ← run(이 파일) · bulletin_compare · test_bulletin_status
 */
function compute(bulletins, nowMs, cands = []) {
    const byOffice = {};
    for (const b of bulletins) if (b && b.result) (byOffice[b.office] = byOffice[b.office] || { w: [], y: [] })[b.rpt === '7' ? 'y' : 'w'].push(b);
    const zones = {}, waiting = [], ys = [], endedAll = new Map();
    for (const [office, { w, y }] of Object.entries(byOffice)) {
        const { state, yebiRelease, ended } = computeFormal(w, nowMs);
        for (const [u, s] of state) zones[u] = Object.assign({ parent: parentOf(u), kind: 'formal' }, s);
        // 발자취용: 이 관서의 예비 목록 전부(두 줄기 각각 같은 호는 마지막 판) · 끝난 특보 시각
        for (const kid of [false, true]) for (const b of latest(y.filter((x) => (x.result.wrnFc === '02') === kid))) ys.push({ kid, ref: { rpt: '7', office, ho: b.result.t1Title, inMs: KST(b.result.tmIn) }, list: parseYebiList(b.result.t4, b.result.tmFc) });
        for (const [u, t] of ended) if (!(endedAll.get(u) >= t)) endedAll.set(u, t);
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
            if (!z0 && ended.has(e.unit) && tY <= ended.get(e.unit)) continue;   // 이미 끝난 정식 특보로 넘어갔던 옛 예비 — 되살리지 않는다(위 ended)
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
    const trails = buildTrails(zones, ys.sort((a, b) => a.ref.inMs - b.ref.inMs), endedAll, nowMs);
    // 발자취는 규칙 계산까지만 본다 — 참고사항 AI 덧씌움(아래)은 발자취에 섞지 않는다. 발자취는 일반 사용자 앱(📋 팝업)에 나가고, AI 해석은 관리자 [통보문] 화면까지만이다
    //   (적대검증 2026-11-18: 처음엔 AI 가 해제 예고를 바꾼 통보문을 「참고사항 — …」 줄로 넣었다 — AI 가 지어낸 제목이 모든 사용자에게 나가는 길이었다).
    const aiApplied = applyAi(zones, cands);
    fillParents(zones);
    return { zones, tree: toTree(zones), waiting: waiting.filter((u) => zones[u]), aiApplied, trails };
}

/**
 * 단위별 「지금 특보의 통보문 발자취」 — 예비 통보문 → 발표 → 변경·연장 → 해제 순(📋 해역별 통보문 팝업이 쓴다).
 *   정식 특보: computeFormal 이 적어 둔 발자취(trail) 앞에, 그 특보로 넘어간 예비 통보문을 붙인다 —
 *              앞 특보(ended)보다 나중에 나오고, 그 특보 발표 때 시간창이 아직 살아 있던 예비 목록. 다음 특보(next)·다가오는 예비(upYebi)의 통보문은 뒤에.
 *   예비     : 지금 시간창이 살아 있는 예비 목록.
 *   예비 목록은 하루 두세 번 전체가 다시 오므로, 그 단위의 시간창이 처음 적혔거나 바뀐 통보문만 넣는다(관서·줄기별로 견줌).
 *   zones 에서는 발자취 칸(trail·cut)을 떼어 낸다 — zones 는 비교 기록(bulletin_compare)에 통째로 적히므로 가볍게 둔다.
 * 예: 제주도북부앞바다(주의보) → { cut:false, list:[{office:'제주청', ho:'제11-13호', act:'풍랑 예비특보', when:'2026년 11월 18일 오후(12시~18시)'}, {ho:'제11-51호', act:'풍랑주의보 발표'}] }
 * @param {Array<{kid:boolean, ref:{office, ho, inMs}, list:Array}>} ys  예비 목록(입력시각 순)
 * @returns {Object<string, {cut:boolean, list:Array<{rpt, office, ho, inMs, act, when?}>}>}  cut = 앞부분(발표)이 보관 기간 밖 · rpt '6' 특보 통보문 / '7' 예비 통보문(두 종류는 호 번호를 따로 매긴다)
 * [연계] ← compute(이 파일) / → run(저장) → zoneBulletins(이 파일) → routes/weather.js GET /api/zone-bulletins
 */
function buildTrails(zones, ys, ended, nowMs) {
    const yebi = (u, lo, T) => {
        const out = [], prev = {};
        for (const { kid, ref, list } of ys) {
            if (!(ref.inMs > lo && ref.inMs <= T)) continue;
            const mine = list.filter((e) => e.unit === u && e.end + YEBI_WAIT_MS > T), when = mine.map((e) => e.tmEf).join(' · ');
            const k = ref.office + kid;   // 관서·줄기별로 앞 목록과 견준다
            if (mine.length && when !== prev[k]) out.push(Object.assign({ act: `${mine[0].type} 예비특보`, when }, ref));
            prev[k] = when;
        }
        return out;
    };
    const trails = {};
    for (const [u, z] of Object.entries(zones)) {
        if (z.kind === 'yebi') { trails[u] = { cut: false, list: yebi(u, ended.get(u) || 0, nowMs) }; continue; }
        const own = z.trail || [], nx = z.next && z.next.trail !== z.trail ? z.next.trail || [] : [];   // 다음 특보가 같은 발자취(발효 중 변경)면 이미 들어 있다
        const list = (z.cut || !own.length ? [] : yebi(u, ended.get(u) || 0, own[0].inMs)).concat(own);
        if (nx.length) list.push(...yebi(u, z.issueMs || 0, nx[0].inMs), ...nx);
        if (z.upYebi) list.push(...yebi(u, z.issueMs || z.inMs || 0, nowMs));
        trails[u] = { cut: !!z.cut, list };
        delete z.trail; delete z.cut; if (z.next) { delete z.next.trail; delete z.next.cut; }
    }
    return trails;
}

/**
 * 자식 해역(연안바다·평수구역)에만 특보가 있고 부모 칸이 **비어 있으면**, 화면에 보이도록 부모 칸을 「자식만 특보」(derived)로 채운다.
 *   통보문의 「A(평수구역)」 = 그 평수구역만 — 부모 A 는 특보가 아니다(README ⑫: 전 관서 같음, 자식 줄기 통보문).
 *   메인 화면(data.js)은 부모 칸이 있어야 카드가 나오므로, 부모에 아무것도 없으면 그 자식이 화면에서 빠진다
 *   (실자료 1건: 수도권 2025 8-29호 「인천·경기남부앞바다(먼평수구역)」 09:10~15:15). 사용자 결정 2026-11-18
 *   「(가) 부모 카드를 "일부 해역(평수구역)만"으로 띄우고, 자식이 끝나면 함께 사라지게」 → 화면은 부모 이름 옆에 「일부 해역만」 배지만 단다.
 *   부모가 제 상태(예비·정식)를 갖고 있으면 건드리지 않는다 — 부모는 부모 상태, 자식은 자식 상태를 그대로 보인다.
 *   사용자 2026-11-18(수도권 2026 2-37호 — 부모는 밤 예비, 평수구역만 먼저 주의보): 「부모해역명 옆에 풍랑 예비라고 뱃지를 반영하고 일부해역만은 제외.
 *   세부를 열어봤을 때 부모해역 풍랑 예비 특보정보가 표시되고 그 아래 자식해역에 대해서는 현재 상태를 표출 … 다가오는으로 할 필요가 없잖아」.
 *   매 계산마다 다시 만든다(상태로 들지 않는다) — 자식이 끝나면 부모 칸도 없다.
 *   고르는 법: 정식 > 예비, 같은 단계면 경보 > 주의보, 그다음 먼저 발효(예비는 이른 시간창).
 * 예: { 인천·경기남부앞바다중먼평수구역: {kind:'formal', level:'주의보'} } → 인천·경기남부앞바다 = 같은 주의보(derived:true) → 나무에서 current.kidsOnly = true
 * [연계] ← compute(이 파일) / → toTree(부모 current·upcoming, kidsOnly 표시) → client data.js·render.js(「일부 해역만」)
 */
function fillParents(zones) {
    const rank = (z) => (z.kind === 'formal' ? 100 : 0) + (z.level === '경보' ? 10 : 0) - (z.efMs || z.endMs || 0) / 1e13;
    const best = new Map();
    for (const [u, z] of Object.entries(zones)) {
        if (PARENTS.has(u) || !z.parent || zones[z.parent]) continue;   // 부모 칸이 비어 있을 때만
        const b = best.get(z.parent);
        if (!b || rank(z) > rank(b)) best.set(z.parent, z);
    }
    for (const [p, z] of best) {
        const c = Object.assign({}, z, { parent: p, derived: true });
        delete c.upYebi; delete c.next; delete c.relMs; delete c.assumed;
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
    if (derived.size) (function tag(o) { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (derived.has(k) && v && typeof v === 'object') { for (const slot of ['current', 'upcoming']) if (v[slot]) v[slot].kidsOnly = true; } else tag(v); } })(tree);
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
    // listsOkMs = 관찰기가 목록 16개(8개 관서 × 특보·예비)를 마지막으로 다 받은 시각 — 📋 팝업이 「통보문이 최신인가」를 볼 때 쓴다(zoneBulletins)
    const out = { updatedAt: new Date(now()).toISOString(), bulletins: list.length, zones: r.zones, waiting: r.waiting, current: r.tree, aiApplied: r.aiApplied, trails: r.trails, listsOkMs: watch.listsOkMs ? watch.listsOkMs() : 0 };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(out)); fs.renameSync(file + '.tmp', file);
    return out;
}
/** 마지막 계산 결과(없으면 null). [연계] → routes/bulletin_watch GET /api/admin/bulletin-status */
function read(file = FILE) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }

// 통보문 원문 PDF 주소 — 통보문 자료에 적힌 그림 파일 자리(「202611/18/KTKO50_<발표시각>_<관서>_<호>.png」)와 같은 자리·같은 이름의 PDF 가 기상청 공개 파일 서버에 있다.
//   사용자 2026-11-18 「눌렀을 때 해당 통보문 pdf가 바로 뜨는 것 … 지금 방식대로」 · 「나중에는 mmis를 코드에서 주석처리하거나 삭제할 예정 … mmis와 엮이면 안될 것」
//   → MMIS 목록(로그인·ef/list·ntfctn/list)에서 찾지 않고 **통보문 자료만으로** 주소를 만든다(처음엔 MMIS 목록과 이름을 짝지었다 — 같은 날 사용자 지적으로 걷어 냄).
//   실측 2026-11-18 16:48: 그때 들고 있던 통보문 68건(특보 41 · 예비 27) 전부 이 주소에 PDF 가 있었다(200 application/pdf). 그림 이름은 실자료 특보 3,720건·예비 2,048건 전부 이 꼴.
//   ⚠파일이 놓인 곳은 해양기상정보포털(marine.kma.go.kr)의 공개 폴더다 — 우리 MMIS 코드(marine_client)는 쓰지 않지만 그 사이트가 파일을 치우면 PDF 가 안 열린다.
//     그때는 이 주소를 비우면 된다(pdfUrl 이 없는 줄은 화면이 본문 글을 펼친다).
const PDF_BASE = 'https://marine.kma.go.kr/resources/kmas/C5N_DATA/WRN/PDF/';
const pdfOf = (r) => { const m = String(r.rptImageName2 || r.pwnImageName || '').match(/^(\d{6}\/\d{2}\/KTKO5\d_\d{12}_\d+_\d+)\.png$/); return m ? PDF_BASE + m[1] + '.pdf' : ''; };
const STALE_MS = 10 * 60e3;   // 방재기상플랫폼 목록을 이만큼 못 받았으면 발자취를 믿지 않는다 — 없으면: 접속이 끊긴 동안 끝나고 새로 난 특보를 모른 채 옛 특보의 통보문을 지금 것처럼 보인다
const SECTIONS = { 6: [['t2', '해당 구역'], ['t3', '발효 시각'], ['t4', '내용'], ['t6', '특보 발효현황'], ['t7', '예비특보 발효현황'], ['other', '참고사항']], 7: [['t4', '예비특보 현황'], ['other', '참고사항']] };
/**
 * 📋 해역별 통보문 팝업 목록 — 그 부모 해역과 딸린 자식 해역(연안바다·평수구역)의 「지금 특보」 통보문을 최신순으로, 본문 글과 함께.
 *   사용자 2026-11-18: 「해당 특보의 시작(발표)부터 종료까지 특보의 생애주기 동안에 대한 통보문이 나오도록」 · 「적용범위는 나(모든 사용자)」 ·
 *   「해제 통보문은 보이되 … 해제되고나서는 통보문 버튼이 보일 필요가 없지」(해제 시각이 되면 그 해역이 계산에서 빠져 발자취도 없다 — 화면 카드·버튼도 함께 사라진다).
 *   null 을 돌려주면 부르는 쪽이 종전 방식(MMIS 목록)으로 그린다: 계산 결과가 없음 · 목록을 10분 넘게 못 받음 · 그 해역의 발자취가 없음(통보문이 아직 모르는 특보 · 보관 기간보다 먼저 시작한 특보).
 * 예: zoneBulletins('제주도북부앞바다', read(), watch.bulletins(), now) → { cut:false, bulletins:[{ time:'2026.11.18 16:00', reportNo:'제11-51호', title:'풍랑주의보 발표', childOnly:false, pdfUrl:'https://…/KTKO50_202611181600_184_51.pdf', sections:[{label:'해당 구역', text:'…'}] }, …] }
 * @param {string} zone 부모 해역 이름(화면 카드 이름)
 * @param {object|null} st read() 결과
 * @param {Array} bulletins bulletin_watch.bulletins()
 * @returns {{cut:boolean, bulletins:Array}|null}  cut = 앞부분 통보문이 보관 기간 밖
 * [연계] ← routes/weather.js GET /api/zone-bulletins / → client alert_history.js showZoneBulletins
 */
function zoneBulletins(zone, st, bulletins, nowMs = Date.now()) {
    if (!st || !st.trails || !(nowMs - (st.listsOkMs || 0) < STALE_MS)) return null;
    const P = norm(zone), found = new Map(); let cut = false;
    if (!PARENTS.has(P)) return null;   // 부모 해역 이름만(그 밖의 글자 — 'constructor' 등 — 는 종전 방식으로)
    for (const u of [P, ...childrenOf(P)]) {
        const t = st.trails[u]; if (!t) continue;
        if (t.cut) cut = true;
        for (const e of t.list) {
            const k = e.rpt + '|' + e.office + '|' + e.ho + '|' + e.inMs;
            if (!found.has(k)) found.set(k, { e, acts: new Map() });
            const a = found.get(k).acts, label = e.act + (e.when ? ` — ${e.when.replace(/^\d{4}년 /, '')}` : '');
            if (!a.has(label)) a.set(label, []);
            a.get(label).push(u);
        }
    }
    const short = (u) => u.replace(P + '중', '');
    const out = [];
    for (const { e, acts } of [...found.values()].sort((x, y) => y.e.inMs - x.e.inMs)) {
        // 그 통보문 본문 — 종류(특보·예비)·관서·호·입력시각이 다 같은 것만(특보와 예비는 호 번호를 따로 매겨 같은 호가 흔하다 — 적대검증 2026-11-18). 못 찾으면 그 줄은 뺀다(빈 줄을 보이지 않는다).
        const b = bulletins.find((x) => x.rpt === e.rpt && x.office === e.office && x.result.t1Title === e.ho && KST(x.result.tmIn) === e.inMs);
        if (!b) continue;
        const r = b.result, mine = [...acts].some(([, us]) => us.includes(P));
        // 부모가 든 몫은 그대로, 자식만의 몫은 자식 이름을 붙인다
        const title = [...acts].map(([label, us]) => (us.includes(P) ? label : `${label} (${us.map(short).join('·')})`)).join(' · ');
        const m = String(r.tmFc || '').match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        out.push({
            time: m ? `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}` : '', reportNo: e.ho, title, office: e.office, childOnly: !mine,
            pdfUrl: pdfOf(r),
            docKey: (require('./bulletin_docs').docOf(r) || {}).key || '',   // 우리 서버에 받아 둔 원문(그림·PDF)의 열쇠 — routes/weather.js 가 그림이 있으면 보기 주소(viewUrl)를 붙인다
            sections: (SECTIONS[b.rpt] || []).map(([k, label]) => ({ label, text: lines(r[k]).join('\n') })).filter((x) => x.text && !/^o?\s*없음$/.test(x.text)),
        });
    }
    return out.length ? { cut, bulletins: out } : null;
}

/**
 * 원문 PDF 가 아직 올라오지 않은 줄은 PDF 주소를 뗀다 → 화면이 그 줄은 본문 글을 펼친다(누르면 빈 화면이 뜨는 일을 막는다).
 *   갓 나온 통보문은 PDF 가 통보문보다 늦게 올라올 수 있다(얼마나 늦는지는 못 쟀다 — 2026-11-18 실측 때 새 통보문이 없었다).
 *   파일 서버는 **없는 파일에도 200(text/html)** 으로 답하므로 부르는 쪽 exists 가 「PDF 로 답했는가」를 본다.
 * 예: keepLivePdf([{pdfUrl:'a'}, {pdfUrl:'b'}], async (u) => u === 'a') → 둘째 줄 pdfUrl ''
 * @param {Array} items zoneBulletins(...).bulletins
 * @param {function(string): Promise<boolean>} exists 그 주소에 PDF 가 실제로 있는가(실패·시간 초과 = false)
 * [연계] ← routes/weather.js GET /api/zone-bulletins(_pdfExists)
 */
async function keepLivePdf(items, exists) {
    await Promise.all(items.map(async (it) => { if (it.pdfUrl && !(await exists(it.pdfUrl).catch(() => false))) it.pdfUrl = ''; }));
    return items;
}

module.exports = { compute, applyAi, fillParents, run, read, toTree, zoneBulletins, keepLivePdf, parseYebiList, itemTimes, yebiReleaseUnits, korTime, YEBI_WAIT_MS, STALE_MS };
