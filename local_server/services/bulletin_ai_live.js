'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_ai_live.js
 * 역할  : 통보문 「참고사항」을 AI 로 실시간 해석해, 규칙이 못 읽는 부분을 「통보문 기준 특보현황」에 보탤 후보로 남긴다.
 *         관찰기가 받은 통보문 중 참고사항이 있는 것을 한 번씩 「② 참고사항 해석」 순서 AI 에 읽힌다(같은 관서 최근 3일 흐름을 맥락으로 함께 준다).
 *         AI 답은 검사(근거 문장 원문 그대로 · 해역을 규칙이 관할 안에서 펼침 · 시각 글자가 근거 문장에 있음)를 통과한 것만 후보가 되고,
 *         실제로 덧씌울지는 bulletin_status.compute 가 정한다(그 해역의 규칙 근거보다 새 통보문일 때만 — 새 것이 이긴다).
 *         검사에 떨어진 것·자동으로 덧씌우지 않는 종류는 「관리자 확인」으로 보고서에 남는다.
 * 사용자 확정 2026-11-16: 「좋아 그렇게 진행하자」 — 제안 원문:
 *   「규칙이 먼저 계산 → 규칙이 못 다루는 참고사항 문장만 AI → AI 에 그 통보문만이 아니라 같은 해역의 앞선 통보문 흐름(3일)을 같이 줘서 맥락으로 판단 →
 *    AI 답은 검사(근거 문장이 원문에 그대로 있나·해역이 관할 안인가·다음 통보문과 모순 없나)를 통과한 것만 반영, 못 통과하면 관리자 확인 목록 →
 *    반영 범위는 통보문 쪽 특보현황만(일반 사용자 화면·푸시는 안 건드림)」
 * 자동으로 덧씌우는 종류(나머지는 기록·관리자 확인만):
 *   예비취소 → 그 해역 예비 뺌(예비 목록 통보문이 1~4분 늦게 오는 틈 — README 「예비 어긋남」) ·
 *   해제예고변경·해제예고연장·정확해제시각 → 발효 중 특보의 해제 예고 칸(시간_후 글자 그대로)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_watch(bulletins) · services/bulletin_ai(call 'interpret' — 관리자 「AI 모델 설정」 ② 순서) ·
 *                   services/bulletin_ai_trial(buildPrompt·resolveZones·namedParents·isLand·KINDS — 시험 3차례에서 검산한 것 그대로)
 *  - 저장          : data/bulletin_ai_live.json(통보문별 AI 답·검사 결과 — 관찰기가 그 통보문을 들고 있는 동안)
 *  - 나를 쓰는 곳  : scheduler.js(관찰기 다음 매분, 기다리지 않음) · services/bulletin_status.js(candidates) ·
 *                   routes/bulletin_watch.js(GET /api/admin/bulletin-ai-live/report.md) · 검사 test_bulletin_ai_live
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const T = require('./bulletin_ai_trial');

const FILE = path.join(__dirname, '..', 'data', 'bulletin_ai_live.json');
const RETRY_MS = 10 * 60e3;           // AI 실패 뒤 다시 시도까지
const MAX_TRIES = 3;                  // 세 번 실패하면 그 통보문은 「AI 실패」로 두고 더 부르지 않는다
const CONTEXT_N = 8;                  // 맥락으로 줄 같은 관서 앞선 통보문 수
const AUTO = new Set(['예비취소', '해제예고변경', '해제예고연장', '정확해제시각']);
const MIN_EVIDENCE = 10;             // 근거 문장 최소 글자(공백 뺀) — 「해제」 두 글자로 통과하지 않게(적대검증 2026-11-16)
const SEA = /(바다|해상|구역|해역|연안|평수)/;
const CHILDISH = /연안바다|평수구역|제외|\s중\s/;
// 근거 문장이 딸린 해역을 말하는가(2026-11-23) — 「특정관리해역의 … 예비특보는 해제」「당진 평수구역 … 해제」「A 중 연안바다와 평수구역을 해제」.
//   과거 표본 585건 중 참고사항에 이 말이 든 48건은 전부 자식 해역만 바뀌는 문장이었다(부모 전체가 바뀐 것 0). 관찰 기록 214건 중 1건(대전 예비 제11-6호).
const CHILD_TALK = /특정관리해역|연안바다|평수구역/;
// 시각 꼴: 「17일」만은 안 된다 — 날+시간대 또는 시각(「17일 오전(09시~12시)」 「17일 06시」 「오늘 밤」)
const TIMEISH = /(\d+\s*시|새벽|아침|오전|낮|오후|저녁|밤|늦은|이른)/;
let _oz = null;
/** 관서 → 관할 부모 해역(analysis/bulletin_survey/office_zones.json — resolveZones 와 같은 표). */
function officeZones() { if (!_oz) { try { _oz = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'analysis', 'bulletin_survey', 'office_zones.json'), 'utf8')); } catch (e) { console.warn('[참고사항 AI] 관할 표 없음 — 자동 반영 안 함', e && e.message); _oz = {}; } } return _oz; }
const clean = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/\r/g, '').trim();
const norm = (s) => String(s || '').replace(/\s+/g, '');
const isNone = (s) => /^o?\s*없\s*음$/i.test(clean(s).replace(/\s+/g, ' '));
const isWave = (r) => /풍랑|태풍|바다|해상/.test((r.t1 || '') + (r.t2 || '') + (r.t4 || '') + (r.other || ''));
const KST = (s) => Date.parse(String(s).slice(0, 19).replace(' ', 'T') + '+09:00');
const hhmm = (s) => String(s || '').slice(5, 16);

/** 통보문 하나의 열쇠 — 같은 통보문이라도 참고사항 글이 바뀌면 다시 읽힌다. */
const keyOf = (b) => b.code + '#' + crypto.createHash('sha1').update(clean(b.result.other)).digest('hex').slice(0, 10);

/**
 * 관찰기 통보문 → 시험과 같은 꼴의 항목(buildPrompt 가 읽는 칸).
 * 예: { office:'부산청', rpt:'7', result:{ t1Title:'제11-3호', tmFc:'2026-11-16 10:00:00.0', t4:'…', other:'o 당초 …' } } → { office, 종류:'예비특보', 호, 발표, 본문, 참고사항, rpt }
 * [연계] ← runOne · candidates(이 파일)
 */
function itemOf(b) {
    const r = b.result;
    return { office: b.office, rpt: b.rpt, 종류: b.rpt === '7' ? '예비특보' : '특보', 호: r.t1Title, 발표: hhmm(r.tmFc),
        본문: clean(b.rpt === '7' ? r.t4 : r.t2).slice(0, 1500), 참고사항: clean(r.other).slice(0, 2500) };
}

/**
 * 같은 관서의 앞선 통보문 흐름(최근 것부터 CONTEXT_N 개, 이 통보문보다 먼저 입력된 것만) — AI 가 맥락으로만 보게.
 * [연계] ← promptOf(이 파일)
 */
function contextOf(b, all) {
    const t = b.result.tmIn;
    const prev = all.filter((x) => x.office === b.office && x.code !== b.code && x.result.tmIn < t)
        .sort((x, y) => y.result.tmIn.localeCompare(x.result.tmIn)).slice(0, CONTEXT_N).reverse();
    if (!prev.length) return '(앞선 통보문 없음 — 관찰 3일 안)';
    return prev.map((x) => `- ${x.result.t1Title} (입력 ${hhmm(x.result.tmIn)}) ${clean(x.result.t1).slice(0, 80)}\n  본문: ${clean(x.rpt === '7' ? x.result.t4 : x.result.t2).replace(/\n+/g, ' / ').slice(0, 300)}` +
        (isNone(x.result.other) || !clean(x.result.other) ? '' : `\n  참고사항: ${clean(x.result.other).replace(/\n+/g, ' / ').slice(0, 300)}`)).join('\n');
}

/**
 * 통보문 본문 항목의 실제 단위(부모·자식 그대로) — 「위 해역」이 가리키는 곳.
 * 예: 특보 「(1) 풍랑주의보 해제 : 울산앞바다(평수구역, 연안바다)」 → ['울산앞바다중평수구역','울산앞바다중연안바다'] · 예비 = 목록의 단위
 * [연계] ← runOne(이 파일) / → lifecycle_check.parseItems · bulletin_status.parseYebiList
 */
function bodyUnits(b) {
    const r = b.result;
    if (b.rpt === '7') return [...new Set(require('./bulletin_status').parseYebiList(r.t4, r.tmFc).map((e) => e.unit))];
    return [...new Set(require('../analysis/bulletin_survey/lifecycle_check').parseItems(r.t2, []).flatMap((it) => [...it.units]))];
}

/** 시험 지시문(buildPrompt — 3차례 검산한 것) + 맥락 덩어리. */
function promptOf(b, all) {
    return T.buildPrompt(itemOf(b)) + '\n\n[같은 관서 앞선 통보문 흐름 — 맥락 참고용. 사건은 위 「참고사항」에 적힌 것만 옮긴다]\n' + contextOf(b, all);
}

/**
 * AI 답 사건 하나를 검사한다(자동 반영 후보가 될 수 있나).
 * 예: ({종류:'예비취소', 해역표현:'남해동부바깥먼바다', 근거문장:'…해제합니다'}, item, bodyZones) → { 판정:'후보', zones:['남해동부바깥먼바다'] }
 * @returns {{판정:'후보'|'확인필요'|'참고', 까닭:string, zones?:string[]}}
 *   후보 = 검사 통과 + 자동 반영 종류(실제 반영은 bulletin_status 가 「더 새 통보문인가」를 보고 정함) · 확인필요 = 검사 탈락 · 참고 = 자동 반영하지 않는 종류
 * [연계] ← runOne(이 파일)
 */
function checkEvent(e, item, bodyZones, bodyOnly) {
    if (!e || typeof e !== 'object') return { 판정: '확인필요', 까닭: '사건 꼴이 아니다' };
    if (!T.KINDS.includes(e.종류)) return { 판정: '확인필요', 까닭: `정해진 종류가 아니다(${e.종류})` };
    const ev = norm(e.근거문장), ex = norm(e.해역표현);
    if (ev.length < MIN_EVIDENCE || !norm(item.참고사항).includes(ev)) return { 판정: '확인필요', 까닭: `근거 문장이 참고사항 원문에 그대로 없거나 너무 짧다(${MIN_EVIDENCE}자 미만)` };
    if (T.isLand(e.해역표현)) return { 판정: '참고', 까닭: '육상 지역 — 바다 특보가 아니다' };
    const auto = AUTO.has(e.종류);
    // 자동 반영 종류인데 근거 문장이 딸린 해역(특정관리해역·연안바다·평수구역)을 말하면 덧씌우지 않는다 — AI 가 「충남앞바다」처럼 부모 이름을 적으면 본체까지 바뀐다.
    //   운영 2026-11-23 대전 예비 제11-6호: 「충남앞바다 풍랑 예비특보에 맞춰 특정관리해역을 제외한 해역에 풍랑주의보는 발표하였으나, 특정관리해역의 … 예비특보는 해제합니다」를
    //   클로드·업스테이지 10개 설정이 모두 「예비취소 — 충남앞바다」로 뽑았고 검사를 통과했다(그때 본체는 이미 주의보라 덮을 예비가 없었을 뿐 — 본체가 예비였으면 본체 예비까지 지웠다).
    //   실제 변화는 규칙이 맡는다(통보문 본문의 항목 · 예비 목록 — 이번에도 11:04 예비 목록 「없음」으로 평수구역 예비를 지웠다). 사용자 「수정하기 위한 절차를 진행해줄래 ?」.
    if (auto && CHILD_TALK.test(String(e.근거문장 || ''))) return { 판정: '확인필요', 까닭: '근거 문장이 딸린 해역(특정관리해역·연안바다·평수구역)을 말한다 — 부모 이름으로 덧씌우면 본체까지 바뀐다(실제 변화는 본문·예비 목록 규칙이 맡는다)' };
    // 「위 해역·위 구역」 = 그 통보문 본문(특보 = 변경 칸, 예비 = 목록)에 적힌 해역(2026-11-16 사용자 「본문 전체에 명시된 해역을 위 해역이라고 명시 … 본문 전체를 모두 읽어야 해」).
    //   참고사항에 나온 다른 해역 이름은 넣지 않는다(적대검증 #8 — 「…유지합니다」 문장의 해역까지 걸렸다). 본문에서 못 찾으면 관리자 확인.
    const above = /^위\s*(구역|해역|지역)/.test(String(e.해역표현 || '').trim());
    //   bodyOnly = 본문 항목의 실제 단위(부모·자식 그대로 — 특보 = 변경 칸 항목, 예비 = 목록). 부모 이름으로 접으면 자식만 해제할 때 남는 부모까지 걸린다(적대검증 2026-11-16).
    if (auto && above) {
        const zs = [...new Set(bodyOnly || [])];
        if (!zs.length) return { 판정: '확인필요', 까닭: '「위 해역」인데 본문에서 해역을 못 찾았다' };
        return Object.assign(finishAuto(e, item, ev, zs, '「위 해역」 = 본문 항목 구역'), { exact: true });
    }
    // 자동 반영 종류는 해역을 문장에서 직접 읽을 수 있을 때만(적대검증 2026-11-16) — 해역 낱말 없는 표현은 어느 해역인지 못 정한다 → 관리자 확인
    if (auto && !SEA.test(String(e.해역표현 || ''))) return { 판정: '확인필요', 까닭: '해역 이름이 없는 표현 — 어느 해역인지 문장만으로 못 정한다' };
    if (auto && !ev.includes(ex)) return { 판정: '확인필요', 까닭: '해역 표현이 근거 문장 안에 없다' };
    //   자식(연안바다·평수구역)·「제외」·「A 중 B」를 말한 표현은 규칙이 부모로 접어 형제 자식까지 걸린다 → 관리자 확인(부모 이름만 = 자식 전부, 확정 규칙)
    if (auto && CHILDISH.test(String(e.해역표현 || ''))) return { 판정: '확인필요', 까닭: '자식 해역·제외를 말한 표현 — 부모 전체로 덧씌우면 안 된다', zones: T.resolveZones(e.해역표현, { office: item.office }) || undefined };
    const zones = T.resolveZones(e.해역표현, { office: item.office, bodyZones: auto ? undefined : bodyZones });
    if (!zones || !zones.length) return { 판정: '확인필요', 까닭: '해역 표현을 규칙이 펼치지 못했다' };
    if (!auto) return { 판정: '참고', 까닭: '자동으로 덧씌우지 않는 종류(기록만)', zones };
    return finishAuto(e, item, ev, zones, '');
}

/**
 * 자동 반영 종류의 남은 검사(관할 · 종류별 글자) — 「위 해역」과 해역 이름 표현이 같이 쓴다.
 * @returns {{판정, 까닭, zones}}  [연계] ← checkEvent(이 파일)
 */
function finishAuto(e, item, ev, zones, how) {
    //   관할 밖 해역(이웃 관서 해역을 함께 적는 일 — README 광주 5-9호)은 자동으로 안 한다
    const own = officeZones()[item.office] || [];
    const LC = require('../analysis/bulletin_survey/lifecycle_check');
    const parentOf = (x) => (LC.PARENTS.has(x) ? x : [...LC.PARENTS].find((p) => LC.childrenOf(p).includes(x)) || x);   // 자식 단위는 그 부모로 관할을 본다
    if (zones.some((z) => !own.includes(parentOf(z)))) return { 판정: '확인필요', 까닭: `관할 밖 해역이 들어 있다(${zones.filter((z) => !own.includes(parentOf(z))).join(', ')})`, zones };
    if (e.종류 === '예비취소') {
        if (!/해제|취소/.test(ev)) return { 판정: '확인필요', 까닭: '근거 문장에 해제·취소 낱말이 없다', zones };
    } else if (!e.시간_후 || !TIMEISH.test(String(e.시간_후)) || !ev.includes(norm(e.시간_후))) {
        return { 판정: '확인필요', 까닭: '바뀐 해제 시각(시간_후)이 시각 꼴이 아니거나 근거 문장에 그 글자가 없다', zones };
    }
    return { 판정: '후보', 까닭: '검사 통과' + (how ? ` (${how})` : ''), zones };
}

/**
 * 실행기를 만든다. 검사에서는 AI·관찰기·저장 위치·시계를 바꿔 끼운다.
 * @param {{ai?: function(string): Promise<{success:boolean, text?:string, error?:string, provider?:string}>, watch?: object, file?: string, now?: function(): number, sleep?: function(number): Promise<void>, gapMs?: number}} o
 * @returns {{run: function(): Promise<object>, candidates: function(): Array, entries: function(): Array}}
 * [연계] ← module.exports(실제) · test_bulletin_ai_live
 */
function createLive({ ai = (p) => require('./bulletin_ai').call('interpret', p, { caller: 'Bulletin-AI-Live' }), watch = require('./bulletin_watch'), file = FILE,
    now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 2000 } = {}) {
    let st = null, running = false;
    const load = () => { if (st) return st; try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { st = {}; } st.done = st.done || {}; return st; };
    const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(st)); fs.renameSync(file + '.tmp', file); };

    /** 통보문 하나를 AI 에 읽히고 검사 결과를 남긴다. */
    async function runOne(b, all) {
        const k = keyOf(b), old = st.done[k] || {};
        const item = itemOf(b);
        const base = { code: b.code, office: b.office, rpt: b.rpt, ho: b.result.t1Title, tmIn: b.result.tmIn, inMs: KST(b.result.tmIn), tries: (old.tries || 0) + 1, at: new Date(now()).toISOString() };
        let r;
        try { r = await ai(promptOf(b, all)); } catch (e) { console.warn('[참고사항 AI] 호출 중 예외 — 10분 뒤 다시:', b.office, b.result.t1Title, e && e.message); r = { success: false, error: String(e && e.message || e) }; }
        let parsed = null;
        if (r && r.success) { try { parsed = JSON.parse(String(r.text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (_) { parsed = null; } }
        if (!parsed || !Array.isArray(parsed.사건)) {
            st.done[k] = Object.assign(base, { ok: false, error: r && r.success ? 'JSON 으로 읽을 수 없는 답' : String((r && r.error) || 'AI 실패').slice(0, 200), nextMs: now() + RETRY_MS });
            return;
        }
        const bodyZones = [...new Set(T.namedParents(item.본문 + '\n' + item.참고사항, item.office))];
        const bodyOnly = bodyUnits(b);   // 「위 해역」 = 본문 항목의 실제 단위만
        const events = parsed.사건.map((e) => Object.assign({ 종류: e && e.종류, 해역표현: e && e.해역표현, 시간_전: e && e.시간_전, 시간_후: e && e.시간_후, 근거문장: e && e.근거문장 }, checkEvent(e, item, bodyZones, bodyOnly)));
        st.done[k] = Object.assign(base, { ok: true, provider: r.provider || null, 요약: parsed.요약 || '', events });
    }

    /**
     * 아직 안 읽힌 통보문을 차례로 읽힌다(한 번에 하나씩, 겹쳐 돌지 않음). 끝나면 관찰기가 더는 들고 있지 않은 기록을 지운다(관찰기 보관 10일 — bulletin_watch SEEN_KEEP_DAYS).
     * @returns {Promise<{done:number, skipped?:boolean}>}
     * [연계] ← scheduler.js(매분 — 기다리지 않음)
     */
    async function run() {
        if (running) return { done: 0, skipped: true };
        running = true;
        try {
            load();
            const all = watch.bulletins().filter((b) => b && b.result && b.result.tmIn);
            const todo = all.filter((b) => isWave(b.result) && clean(b.result.other) && !isNone(b.result.other)).filter((b) => {
                const d = st.done[keyOf(b)];
                return !d || (!d.ok && d.tries < MAX_TRIES && (d.nextMs || 0) <= now());
            }).sort((x, y) => x.result.tmIn.localeCompare(y.result.tmIn));
            let n = 0;
            for (const b of todo) { await runOne(b, all); save(); n++; if (gapMs) await sleep(gapMs); }
            // 정리: 관찰기에 더는 없는 통보문(관찰기가 10일 뒤 지움 — bulletin_watch SEEN_KEEP_DAYS)과 참고사항이 바뀌어 옛 열쇠가 된 기록만 지운다.
            //   통보문 입력시각으로 자르면 관찰기가 아직 들고 있는 통보문을 매분 다시 AI 에 보낸다(적대검증 2026-11-16 — 재현 5분에 5번).
            //   관찰기 목록이 비었으면(읽기 실패 등) 지우지 않는다 — 다 지우면 전부 다시 부른다.
            if (all.length) {
                const live = new Set(all.map(keyOf));
                let pruned = false;
                for (const k of Object.keys(st.done)) if (!live.has(k)) { delete st.done[k]; pruned = true; }
                if (pruned) save();
            }
            return { done: n };
        } finally { running = false; }
    }

    /**
     * bulletin_status 가 덧씌울 후보(검사 통과 + 자동 반영 종류), 입력시각 순.
     * 예: [{ 종류:'예비취소', zones:['남해동부바깥먼바다'], office:'부산청', ho:'제11-3호', inMs, 시간_후:null, 근거문장:'…' }]
     * [연계] → services/bulletin_status.compute
     */
    function candidates() {
        load();
        // 지금 관찰기가 들고 있는 판만 — 참고사항이 고쳐진 옛 판·같은 호를 다시 낸 앞 판의 해석은 쓰지 않는다(규칙 latest() 와 같은 규칙, 적대검증 2026-11-16)
        const cur = watch.bulletins().filter((b) => b && b.result && b.result.tmIn);
        const live = new Set(cur.map(keyOf));
        const lastIn = new Map();
        for (const b of cur) { const h = b.office + '|' + String(b.result.tmFc).slice(0, 4) + '|' + b.result.t1Title; if (!(lastIn.get(h) >= b.result.tmIn)) lastIn.set(h, b.result.tmIn); }
        const out = [];
        for (const [k, d] of Object.entries(st.done)) {
            if (!d.ok || !live.has(k)) continue;
            const b = cur.find((x) => x.code === d.code);
            if (b && lastIn.get(b.office + '|' + String(b.result.tmFc).slice(0, 4) + '|' + b.result.t1Title) > b.result.tmIn) continue;
            for (const e of d.events) if (e.판정 === '후보') out.push({ 종류: e.종류, zones: e.zones, exact: !!e.exact, office: d.office, ho: d.ho, inMs: d.inMs, 시간_전: e.시간_전 || null, 시간_후: e.시간_후 || null, 근거문장: e.근거문장 });
        }
        return out.sort((a, b) => a.inMs - b.inMs);
    }
    /** 저장된 통보문별 기록 전부(입력시각 순) — 보고서용. */
    const entries = () => { load(); return Object.values(st.done).sort((a, b) => (a.inMs || 0) - (b.inMs || 0)); };
    return { run, candidates, entries };
}

/**
 * 보고서(마크다운) — 통보문별 AI 답·검사 판정·실제 반영 여부(bulletin_status 마지막 계산의 aiApplied).
 * @param {Array} entries  @param {Array<{ho, office, unit, 종류, what}>} applied
 * [연계] ← GET /api/admin/bulletin-ai-live/report.md
 */
function reportMarkdown(entries, applied) {
    const cnt = { 후보: 0, 확인필요: 0, 참고: 0 };
    for (const d of entries) if (d.ok) for (const e of d.events) cnt[e.판정] = (cnt[e.판정] || 0) + 1;
    const fail = entries.filter((d) => !d.ok);
    const out = ['# 참고사항 AI 실시간 해석 기록', '',
        '관찰기가 받은 통보문의 참고사항을 「AI 모델 설정 → ② 참고사항 해석」 순서 AI 에 한 번씩 읽힌 기록입니다(시각은 KST). 통보문 기준 특보현황(관리자 [통보문])에만 쓰이고, 앱·푸시는 바꾸지 않습니다.', '',
        '## 요약', '',
        `- 읽힌 통보문 ${entries.length}건 (AI 실패 ${fail.length}건)`,
        `- 사건 판정: 후보(검사 통과·자동 반영 종류) ${cnt.후보} · 관리자 확인 필요 ${cnt.확인필요} · 참고(기록만) ${cnt.참고}`,
        `- 지금 특보현황에 실제로 덧씌운 것: ${applied.length}곳 — 후보라도 그 해역의 규칙 근거가 더 새 통보문이면 덧씌우지 않는다(새 것이 이긴다).`, '',
        '## 지금 덧씌운 것', '', ...(applied.length ? applied.map((a) => `- ${a.office} ${a.ho} · ${a.unit} · ${a.종류} → ${a.what}`) : ['- 없음']), '',
        '## 관리자 확인 필요', '',
        ...(() => { const l = []; for (const d of entries) if (d.ok) for (const e of d.events) if (e.판정 === '확인필요') l.push(`- ${d.office} ${d.ho} (입력 ${hhmm(d.tmIn)}) [${e.종류}] 「${e.해역표현}」 — ${e.까닭}\n  근거: ${e.근거문장 || '(없음)'}`); return l.length ? l : ['- 없음']; })(), '',
        '## AI 실패', '', ...(fail.length ? fail.map((d) => `- ${d.office} ${d.ho} (입력 ${hhmm(d.tmIn)}) ${d.tries}번 시도 — ${d.error}`) : ['- 없음']), '',
        '## 통보문별 전체', '',
        ...entries.filter((d) => d.ok).map((d) => `### ${d.office} ${d.ho} (입력 ${hhmm(d.tmIn)}, ${d.provider || '?'})\n${d.요약 ? '요약: ' + d.요약 + '\n' : ''}` +
            (d.events.length ? d.events.map((e) => `- [${e.판정}] ${e.종류} 「${e.해역표현}」${e.zones ? ' → ' + e.zones.join(', ') : ''}${e.시간_후 ? ' · 시간_후 ' + e.시간_후 : ''} — ${e.까닭}`).join('\n') : '- 사건 없음')),
        ''];
    return out.join('\n');
}

let real = null;
const getReal = () => (real = real || createLive());
module.exports = {
    run: () => getReal().run(), candidates: () => getReal().candidates(), entries: () => getReal().entries(),
    enabled: process.env.BULLETIN_AI_LIVE_DISABLE !== '1',
    createLive, checkEvent, bodyUnits, promptOf, contextOf, itemOf, keyOf, reportMarkdown, AUTO,
};
