'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_escalation.js
 * 역할  : 「격상 가능성」 — 기상청이 「풍랑경보로 변경될 가능성」「태풍특보로 변경될 가능성」이 있다고 알린 해역과 시점을 읽어,
 *         메인 화면 특보구역 카드에 보일 목록으로 계산해 둔다(뱃지 「풍랑 주의보 🔺」 + 카드 안 빨강 상자).
 *         읽는 곳 둘: ① 방재기상플랫폼 통보문의 참고사항(표 꼴 「풍랑 경보 변경 가능 시점」 · 문장 꼴) ② 기상청 날씨해설(단기·초단기 전망)의 해상 문단.
 * 사용자 2026-11-18~19:
 *   「통보문의 참고사항을 조사하여 경보로 격상하거나 태풍으로 올릴수있다는 그런 문구들 … 해당 특보구역의 카드 내에 언제부로 경보로 격상 가능성이 있다 라는 식으로」
 *   「기상청해상기상전망의 단기, 초단기예보를 보면 … 해역과 태풍 가능성을 명시하는 정보가 있거든? … 가져와서 표출하는 방법도」
 *   「통보문을 우선하고, 통보문에 없는 것(태풍 등)만 날씨해설로 채우는 방식 … 동의」
 *   「제주도해상 그밖의 해상 등 어떤 상황에서 그 문구를 썻는지가 중요함. 해당 용어가 나온 전문을 확인해서 맥락을 읽어야함」
 *   「넓게 부른 안내 - 추천대로」(= 기상청이 쓴 그대로 그 이름에 든 모든 해역에, 「(○○ 제외)」는 뺀다) · 「격상의 경우에만 하고자함. 재발표는 제외」
 *   「관리자페이지에서 어떤 ai 쓸건지 결정하는 부분도 ui 만들어야」(= bulletin_ai ⑤ escalation)
 * 읽는 규칙(전문 조사 — analysis/bulletin_survey/README.md ⑯):
 *   · **토막(절) 단위**로 읽는다 — 「풍랑경보로 변경(강화)될 가능성」「태풍특보로 변경될 가능성」이 글자 그대로 든 토막의 해역만.
 *     같은 문장의 「풍랑특보를 발표할 가능성」(새 특보)·「발효된 가운데」(지금 상태)·물결 높이 설명에 나온 해역은 쓰지 않는다.
 *   · 해역 말을 하나라도 못 풀면(「제주도해상」「그 밖의 해상」「서해먼바다」 …) 그 토막은 통째로 안 쓴다 — 반만 보이지 않는다.
 *   · 「묶음(○○ 제외)」「묶음(○○, ○○)」를 반영한다. 해역마다 시간이 다르면 짝지어 읽는다. 「D일」이 발표일보다 앞서면 다음 달.
 *   · 규칙이 못 읽은 문장만 AI(⑤)에 묻는다. AI 답은 그 문장에 글자 그대로 있는 해역 말·시간 말이고 규칙이 풀 수 있을 때만 쓴다(AI 가 해역을 지어낼 수 없다).
 * 지우는 때:
 *   통보문 안내 — 그 뒤에 그 해역의 풍랑경보 발표·변경, 해제, 태풍특보 통보문이 나오면 끝 · 「가능성이 낮아졌음」 취소 문구 · 시간창 끝 + 6시간 ·
 *                 시간이 없으면 96시간 · 같은 해역에 더 새 안내가 있으면 그것으로 바꾼다(새 통보문에 안내가 없다는 것만으로는 안 지운다).
 *   날씨해설 안내 — 발표 18시간 · 더 새 글이 그 해역을 다시 말하면 그것으로 · 그 글 뒤에 그 해역 경보(태풍은 태풍특보)·해제 통보문이 나오면 끝 ·
 *                   통보문 안내가 그 글 뒤에 끝났으면 되살리지 않는다 · 이미 풍랑경보인 해역에는 풍랑 가능성을 안 붙인다(태풍 가능성은 붙인다 — 태풍은 풍랑경보에서 오른다).
 * MMIS 코드와 엮지 않는다(통보문 자료·날씨해설 저장 파일만 읽는다).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_watch(bulletins) · services/bulletin_status(계산 결과의 zones) · services/bulletin_docs(docOf — 📋 원문) ·
 *                   services/bulletin_ai(call 'escalation' — 관리자 「AI 모델 설정」 ⑤) · analysis/bulletin_survey/lifecycle_check(PARENTS·parseItems·splitTop) ·
 *                   config/zone_group_map · data/marine_forecast.json(marine_forecast_processor 가 받아 둔 날씨해설)
 *  - 저장          : data/bulletin_escalation.json(계산 결과) · data/bulletin_escalation_ai.json(AI 답 — 문장별)
 *  - 나를 쓰는 곳  : scheduler.js(통보문 기준 계산 다음 매분 run → 그 결과의 refs 를 bulletin_docs.sync 에) · routes/weather.js(GET /api/zone-escalations) ·
 *                   검사 scripts/test_bulletin_escalation.js
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const LC = require('../analysis/bulletin_survey/lifecycle_check');
const { ZONE_GROUP_MAP } = require('../config/zone_group_map');
const { PARENTS, splitTop, parseItems } = LC;

const FILE = path.join(__dirname, '..', 'data', 'bulletin_escalation.json');
const AI_FILE = path.join(__dirname, '..', 'data', 'bulletin_escalation_ai.json');
const FORECAST_FILE = path.join(__dirname, '..', 'data', 'marine_forecast.json');
const H = 36e5, DAY = 864e5;
const GRACE_MS = 6 * H;        // 시간창 끝 뒤에도 보이는 시간 — 없으면: 경보가 안내한 시간창보다 조금 늦게 나는 경우(실자료 157건 중 창 뒤 16건) 경보 직전에 안내가 사라진다
const NOTIME_MS = 96 * H;      // 시간이 안 적힌 안내를 보이는 최대 — 없으면: 경보도 해제도 안 나오는 안내가 끝없이 남는다(실자료: 시간 없는 안내 → 경보 최장 79.9시간)
const CMT_MS = 18 * H;         // 날씨해설 한 편을 믿는 시간 — 없으면: 수집이 멈췄을 때 옛 글의 「오늘 밤부터」가 며칠씩 남는다(같은 종류 글은 12시간마다 나온다)
const AI_RETRY_MS = 10 * 60e3, AI_MAX_TRIES = 3;
const CAVEAT = { wave: '발효 여부와 시점은 조정될 수 있음', typhoon: '태풍 진로에 따라 매우 유동적' };

const nz = (s) => String(s || '').replace(/\s+/g, '').replace(/[.]/g, '·');
const clean = (s) => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/\r/g, '').replace(/&nbsp;/g, ' ');
const KST = (s) => Date.parse(String(s).slice(0, 19).replace(' ', 'T') + '+09:00');
const kstDay0 = (ms) => Math.floor((ms + 9 * H) / DAY) * DAY - 9 * H;   // 그 순간이 든 KST 날의 0시
const keyOf = (text) => crypto.createHash('sha1').update(nz(text)).digest('hex').slice(0, 16);

// ── 해역 이름 풀기 ─────────────────────────────────────────────────────────
// 줄임 이름 — 통보문 정식 칸(해당 구역·발효현황)에는 안 나오고 참고사항·날씨해설에만 나온다.
//   제주도남쪽안쪽먼바다 = 남동쪽·남서쪽 안쪽(제주 2026 10-48호가 「남쪽안쪽먼바다 24일 새벽」이라 한 뒤 두 곳이 함께 경보) ·
//   제주도남쪽먼바다 = 제주 먼바다 셋(날씨해설 「제주도남쪽먼바다 … 풍랑경보로」 뒤 세 곳이 차례로 경보 — 2026-10-24. 정황 근거이고 기상청 정의 문서는 못 찾았다).
const ALIAS = {
    제주도남쪽안쪽먼바다: ['제주도남동쪽안쪽먼바다', '제주도남서쪽안쪽먼바다'],
    get 제주도남쪽먼바다() { return ZONE_GROUP_MAP['제주도먼바다']; },   // 읽을 때마다 — 2026-11-26 구역 분할 뒤에는 4구역(config/zone_group_map.js)
};
/** 이름 하나(괄호 없이) → 부모 해역들 | null. 예: '동해남부북쪽먼바다' → [안쪽, 바깥] · '제주도해상' → null */
function baseParents(name) {
    if (PARENTS.has(name)) return require('../config/zone_split').splitNames([name]);   // 2026-11-26 구역 분할 뒤 옛 이름 = 새 두 구역(카드 열쇠가 새 이름이다)
    if (ZONE_GROUP_MAP[name]) return ZONE_GROUP_MAP[name].slice();
    if (ALIAS[name]) return ALIAS[name].slice();
    const m = name.match(/^(.+)먼바다$/);   // 「○○먼바다」 = ○○안쪽먼바다 + ○○바깥먼바다(둘 다 있을 때만)
    if (m && PARENTS.has(m[1] + '안쪽먼바다') && PARENTS.has(m[1] + '바깥먼바다')) return [m[1] + '안쪽먼바다', m[1] + '바깥먼바다'];
    return null;
}
/**
 * 해역 표현 하나 → 부모 해역들. 못 풀면 null(반만 풀지 않는다).
 * 예: '제주도앞바다(북부 제외)' → [동부·남부·서부앞바다] · '제주도전해상(제주도서부앞바다 제외)' → 여섯 곳 · '제주도해상' → null · '경북북부앞바다(연안바다)' → null(자식만)
 * @param {string} token @returns {string[]|null}
 * [연계] ← readHead · readBulletin(이 파일). lifecycle_check.expand 는 묶음 이름의 「제외」를 무시한다(정식 칸에는 그런 표현이 0건이라 거기서는 문제가 없다).
 */
function resolve(token) {
    const m = String(token || '').match(/^([^()]+)(?:\(([^()]*)\))?$/);
    if (!m) return null;
    const base = baseParents(nz(m[1])), inner = nz(m[2] || '');
    if (!base) return null;
    if (!inner) return base;
    const excl = /제외$/.test(inner);
    const toks = splitTop(inner.replace(/제외$/, '')).map(nz).filter(Boolean);
    if (!toks.length) return null;
    if (base.length === 1) return excl ? base : null;   // 부모 하나에 붙은 괄호 = 자식 이야기: 「(연안바다 제외)」면 부모는 그대로, 「(연안바다)」면 자식만이라 부모 카드에 안 붙인다
    const picked = [];
    for (const t of toks) {
        const hit = base.filter((p) => p === t || p.endsWith(t) || p.replace(/(앞바다|먼바다)$/, '').endsWith(t));
        if (!hit.length) return null;
        picked.push(...hit);
    }
    return excl ? base.filter((p) => !picked.includes(p)) : [...new Set(picked)];
}

// ── 글 속의 해역·시간 낱말 ──────────────────────────────────────────────────
const PART = '늦은\\s*오후|늦은\\s*밤|이른\\s*새벽|새벽|아침|오전|낮|오후|저녁|밤';
const ZONE_RE = '[가-힣·.]+?(?:전해상|먼바다|앞바다)(?:\\([^()]*\\))?';
//   「내일(24일) 새벽부터」「23일 밤(18시~24시)에」「오늘 오후에」「27일 오후(12~18시)」 | 시간대만 「밤부터」(앞 시간의 날을 잇는다)
const TIME_RE = `(?:(오늘|내일|모레|그글피|글피)\\s*(?:\\((?:\\d{1,2}월\\s*)?(\\d{1,2})일\\))?|(\\d{1,2})일)\\s*(${PART})?\\s*(?:\\(\\s*(\\d{1,2})시?\\s*~\\s*(\\d{1,2})시\\s*\\))?\\s*(부터|에)?|(${PART})\\s*(부터|에)`;
const REL = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3, 그글피: 4 };

/**
 * 「D일」→ 그 날 0시(KST) — 앞 달·이 달·다음 달의 D일 가운데 가늠한 날(targetMs)에 가장 가까운 날.
 * 예: 2월 28일 통보문의 「2일」 = 3월 2일(같은 달로 읽으면 뜨자마자 지워진다 — 실자료 3줄) ·
 *     0시 발표 통보문의 「오늘(18일)」 = 바로 전날 18일(「앞서면 다음 달」로 읽으면 한 달 뒤가 되어 한 달 내내 남는다 — 별도 에이전트 검토 2026-11-19)
 */
function dayOf(D, targetMs) {
    const b = new Date(targetMs + 9 * H);
    let best = null;
    for (const dm of [-1, 0, 1]) {
        const t = Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + dm, D) - 9 * H;
        if (new Date(t + 9 * H).getUTCDate() !== D) continue;   // 그 달에 없는 날(2월 30일)
        if (best === null || Math.abs(t - targetMs) < Math.abs(best - targetMs)) best = t;
    }
    return best === null ? kstDay0(targetMs) : best;
}

/**
 * 글 한 토막에서 해역 낱말·시간 낱말을 차례로 뽑는다. rest = 둘 다 아닌 나머지 글.
 * @returns {{toks:Array<{zone?:string, time?:object}>, rest:string}}
 * [연계] ← readHead · readBulletin(표 줄의 시간)
 */
function scan(text, baseMs) {
    const src = String(text || '').replace(/\(\d+\)\s*,?/g, ' ');   // 항목 번호 「(2)」는 쓰지 않는다(번호로 해역을 찾으면 과하게 덮는 통보문이 있다 — 제주 9-5호·2-66호)
    const toks = [], re = new RegExp(`(${TIME_RE})|(${ZONE_RE})`, 'g');
    let m, rest = '', last = 0, prevDay = kstDay0(baseMs);
    while ((m = re.exec(src))) {
        if (!m[0]) { re.lastIndex++; continue; }
        if (m[11] !== undefined) {
            toks.push({ zone: m[11].replace(/^(?:와|과|및)(?=[가-힣])/, '') });
        } else {
            const rel = m[2], D = m[3] || m[4], part = (m[5] || m[9] || '').replace(/\s+/g, ' '), hours = m[6] !== undefined && m[7] !== undefined, suf = m[8] || m[10] || '';
            if (!rel && D && !part && !hours) continue;   // 「21일부터 발효 중인」 — 가능 시점이 아니다(나머지 글로 둔다)
            const day = D ? dayOf(+D, kstDay0(baseMs) + (rel ? REL[rel] * DAY : 0)) : rel ? kstDay0(baseMs) + REL[rel] * DAY : prevDay;
            prevDay = day;
            const a = hours ? +m[6] : null, b = hours ? +m[7] : null;
            toks.push({ time: { dayMs: day, label: part + (hours ? `(${m[6]}시~${m[7]}시)` : '') + (suf === '부터' ? '부터' : ''),
                startMs: hours ? day + a * H : null, endMs: hours ? day + (b <= a ? b + 24 : b) * H : null } });
        }
        rest += src.slice(last, m.index); last = m.index + m[0].length;
    }
    return { toks, rest: rest + src.slice(last) };
}

/**
 * 머리 토막(해역·시간이 적힌 부분)에서 해역마다 시간을 짝지어 읽는다. 못 푸는 해역 말이 하나라도 남으면 null.
 * 예: 「A는 23일 밤(18시~24시)에, B는 24일 새벽(00시~06시)에」 → [{zones:[A], dayMs, label:'밤(18시~24시)', startMs, endMs}, {zones:[B], …}]
 *     「오늘(18일) 밤부터 A, 내일(19일) 새벽부터 B에」 → 시간이 먼저 나오면 그 뒤 해역에 붙는다
 * @param {string} head @param {number} baseMs 그 글의 발표 시각(날짜 기준)
 * @returns {Array<{zones:string[], dayMs:number|null, label:string, startMs:number|null, endMs:number|null}>|null}
 * [연계] ← readBulletin · readCommentary · fromAi(이 파일)
 */
function readHead(head, baseMs) {
    const { toks, rest } = scan(head, baseMs);
    if (/바다|해상|해역/.test(rest)) return null;   // 못 읽은 해역 말이 남았다(「제주도해상」「그 밖의 해상」「서해상」「서해남부바깥(북쪽, 남쪽)먼바다」 …)
    if (!toks.some((t) => t.zone)) return null;
    const timeFirst = !!toks[0].time, groups = [];
    let cur = { names: [], time: null };
    for (const t of toks) {
        if (t.zone) { cur.names.push(t.zone); continue; }
        if (timeFirst) { if (cur.names.length) groups.push(cur); cur = { names: [], time: t.time }; }
        else { cur.time = t.time; groups.push(cur); cur = { names: [], time: null }; }
    }
    if (cur.names.length) groups.push(cur);
    const out = [];
    for (const g of groups) {
        if (!g.names.length) continue;
        const zones = [];
        for (const n of g.names) { const r = resolve(n); if (!r) return null; zones.push(...r); }
        const t = g.time || {};
        out.push({ zones: [...new Set(zones)], dayMs: t.dayMs != null ? t.dayMs : null, label: t.label || '', startMs: t.startMs != null ? t.startMs : null, endMs: t.endMs != null ? t.endMs : null });
    }
    return out.length ? out : null;
}

/**
 * AI(⑤) 답을 검사해 안내로 바꾼다 — 해역 말·시간 말이 그 문장에 글자 그대로 있고 규칙이 풀 수 있을 때만. 하나라도 어긋나면 null(통째로 안 쓴다).
 * 예: fromAi('…A와 B는 내일 새벽부터 … 풍랑경보로 변경될 가능성', [{해역:'A와 B', 시점:'내일 새벽부터'}], base) → [{zones:[A,B], …}]
 * @param {string} sentence @param {Array<{해역:string, 시점?:string}>} items @param {number} baseMs
 * [연계] ← readBulletin · readCommentary(이 파일)
 */
function fromAi(sentence, items, baseMs) {
    if (!Array.isArray(items) || !items.length) return null;
    //   「발효 중인 A는 … B는 경보로」처럼 지금 상태를 함께 적은 글은 AI 가 A 를 골라도 「글에 있는 해역」이라 검사를 통과한다 — 그런 글은 AI 로 읽지 않는다(못 읽은 채 둔다).
    if (/발효|발표된|발표한|해제/.test(sentence)) return null;
    const S = nz(sentence), out = [];
    for (const it of items) {
        const z = String((it && it.해역) || ''), t = String((it && it.시점) || '');
        if (!z || !S.includes(nz(z)) || (t && !S.includes(nz(t)))) return null;
        const h = readHead(z + ' ' + t, baseMs);
        if (!h) return null;
        out.push(...h);
    }
    return out;
}

// ── 통보문 참고사항 ────────────────────────────────────────────────────────
const HEADER = /풍랑\s*경보\s*(?:재\s*)?변경\s*가능(?:성)?\s*시점\s*$/;
const WAVE_UP = /풍랑\s*경보로\s*(?:재\s*)?(?:변경|강화)\s*(?:발표\s*)?될\s*가능성/;
const CANCEL = /풍랑\s*경보[^.\n]*가능성(?:이|은)?\s*(?:낮|없|희박)/;
//   「가능성」 뒤가 「…이 있(겠)…」일 때만 안내다 — 「가능성은 낮습니다」「가능성이 있었으나 변경하지 않습니다」를 안내로 읽지 않는다(과거 자료에는 0건, 별도 에이전트 검토 2026-11-19).
const POSITIVE = /^\s*(?:이|도)?\s*있(?!었)/;
//   통보문 한 줄 안의 토막 경계 — 「…해제하나, 9일 오전부터 A는 … 경보로」에서 앞 토막의 해역(방금 해제한 곳)을 읽지 않게.
const B_CLAUSE = /(?:니다\.|하나|이나|으나|하며|하고|가운데)\s*,?\s+/g;

/**
 * 통보문 하나의 참고사항 → 안내·취소·못 읽은 줄.
 * 예: 「○ 풍랑 경보 변경 가능 시점 / (3) 동해남부북쪽안쪽먼바다: 19일 새벽(00시~06시)」 → notices [{zones:[동해남부북쪽안쪽먼바다], label:'새벽(00시~06시)', startMs, endMs, form:'table'}]
 * @param {{result:object}} b 관찰기 통보문 @param {function(string): Array|null} [aiRead] 못 읽은 문장의 AI 답(없으면 null)
 * @returns {{notices:Array, cancels:Array<{zones:string[]}>, unread:string[]}}
 * [연계] ← compute(이 파일)
 */
function readBulletin(b, aiRead = () => null) {
    //   날짜 기준 = 발표시각과 입력시각 중 이른 쪽 — 0시 발표 통보문은 전날 밤에 입력되고 글도 전날 기준(「내일 오전」)으로 쓰인 것이 있다(0시 발표 237건 가운데 절반쯤).
    const r = b.result, baseMs = Math.min(...[r.tmFc, r.tmIn].filter(Boolean).map(KST));
    const L = clean(r.other).split('\n').map((x) => x.trim());
    const out = { notices: [], cancels: [], unread: [] };
    for (let i = 0; i < L.length; i++) {
        const line = L[i];
        if (!line || /^[※*]/.test(line)) continue;   // ※ 단서 문구(「풍랑경보 변경 가능 시점은 먼바다를 대상으로 …」)
        if (HEADER.test(line)) {
            for (i++; i < L.length; i++) {
                const t = L[i];
                if (!t) continue;
                const m = t.match(/^[o○-]?\s*(?:\(\d+\)\s*,?\s*)*(.*?)\s*[:：]\s*(\d{1,2}일.*)$/);
                if (!m) { i--; break; }   // 표가 끝났다(※ 단서·다른 글머리)
                const zones = [];
                let ok = !!m[1];
                for (const n of ok ? splitTop(m[1]) : []) { const z = resolve(n); if (!z) { ok = false; break; } zones.push(...z); }
                const tm = scan(m[2], baseMs).toks.filter((x) => x.time);
                if (!ok || !zones.length || tm.length !== 1) { out.unread.push(t); continue; }   // 이름이 빈 줄(「(2) : 20일 밤」)·못 푸는 이름 — 통째로 안 쓴다
                out.notices.push(Object.assign({}, tm[0].time, { zones: [...new Set(zones)], form: 'table' }));
            }
            continue;
        }
        if (CANCEL.test(line)) {
            const h = readHead(line.slice(0, line.search(/풍랑\s*경보/)), baseMs);
            if (h) out.cancels.push({ zones: [...new Set(h.flatMap((x) => x.zones))] }); else out.unread.push(line);
            continue;
        }
        const um = line.match(WAVE_UP);
        if (!um) continue;
        if (!POSITIVE.test(line.slice(um.index + um[0].length))) continue;   // 부정·과거 — 안내가 아니다
        //   머리 = 그 문구 앞에서, 해역이 적힌 마지막 토막. 뒤 토막에 해역이 없으면 앞 토막까지 넓힌다
        //   (광주 2025 3-33호 「남해서부동쪽먼바다에 풍랑경보를 풍랑주의보로 변경하나 16일 오후부터 … 풍랑경보로 변경 발표 될 가능성」 — 해역이 앞 토막에 있다).
        const before = line.slice(0, um.index), cuts = [0];
        let cm;
        B_CLAUSE.lastIndex = 0;
        while ((cm = B_CLAUSE.exec(before))) cuts.push(cm.index + cm[0].length);
        let head = before;
        for (let c = cuts.length - 1; c >= 0; c--) { head = before.slice(cuts[c]); if (scan(head, baseMs).toks.some((t) => t.zone)) break; }
        const cut = head.search(/물결이|바람이/);   // 해역·시간은 「물결이·바람이」 앞에 적힌다 — 그 뒤 괄호의 해역(물결 높이 설명)은 쓰지 않는다
        if (cut >= 0) head = head.slice(0, cut);
        const h = readHead(head, baseMs) || fromAi(head, aiRead(line), baseMs);
        if (!h) { out.unread.push(line); continue; }
        for (const x of h) out.notices.push(Object.assign(x, { form: 'sentence' }));
    }
    return out;
}

// ── 날씨해설 ──────────────────────────────────────────────────────────────
const CMT_UP = /풍랑\s*경보로\s*(?:변경|강화)될\s*가능성|태풍\s*특보로\s*변경될\s*가능성/g;
const CLAUSE_END = /(?:있겠고|있겠으며|가운데|겠으나|바라며)\s*,?/g;

/** 글 전체에서 「(해상)」 문단(다음 「○ (」 머리나 「<…>」 머리 앞까지). 없으면 ''. 「<예보의 변동성>」의 「태풍 … 변경될 가능성」(비 예보 이야기)은 여기 들지 않는다. */
function seaPart(rawText) {
    const text = String(rawText || '');
    const i = text.search(/[○o]\s*\(해상\)/);
    if (i < 0) {
        // 「(해상)」 표식 없이 「<해상>」 머리 아래에 바로 쓴 글(31일치 124건 중 1건 — cmt:202610281010:137): 그 머리부터 다음 「<…>」 머리 앞까지
        const h = text.search(/<[^>\n]*해상[^>\n]*>/);
        if (h < 0) return '';
        const e = text.slice(h + 1).search(/\n\s*<[^>\n]+>/);
        return e >= 0 ? text.slice(h, h + 1 + e) : text.slice(h);
    }
    const j = text.slice(i + 1).search(/\n\s*[○o]\s*\(|\n\s*<[^>\n]+>/);
    return j >= 0 ? text.slice(i, i + 1 + j) : text.slice(i);
}

/**
 * 날씨해설 한 편 → 격상 가능성 토막들.
 * 예: 「- 또한, 동해중부먼바다는 오늘(27일) 오후부터, 동해남부북쪽먼바다는 오늘 밤부터 … 풍랑경보로 변경될 가능성이 있겠고, 오늘 오후부터 그 밖의 대부분 해상에도 … 풍랑특보를 발표할 가능성」
 *     → wave [동해중부 안쪽·바깥 / 27일 오후부터] · wave [동해남부북쪽 안쪽·바깥 / 27일 밤부터] (뒤 토막 「그 밖의 대부분 해상」은 새 특보 이야기라 안 읽는다)
 * @param {string} rawText 글 전체 @param {number} pubMs 발표 시각 @param {function(string): Array|null} [aiRead]
 * @returns {{notices:Array<{kind:'wave'|'typhoon', zones:string[], dayMs:number|null, label:string}>, unread:string[]}}
 * [연계] ← compute(이 파일)
 */
function readCommentary(rawText, pubMs, aiRead = () => null) {
    const out = { notices: [], unread: [] };
    for (const s of seaPart(rawText).replace(/\n+/g, ' ').split(/(?<=니다\.)\s*/)) {
        CMT_UP.lastIndex = 0;
        let m;
        while ((m = CMT_UP.exec(s))) {
            if (!POSITIVE.test(s.slice(m.index + m[0].length))) continue;   // 「가능성은 낮겠으나」 — 안내가 아니다
            let start = 0, e;
            CLAUSE_END.lastIndex = 0;
            while ((e = CLAUSE_END.exec(s)) && e.index < m.index) start = e.index + e[0].length;   // 이 토막의 시작 = 앞 토막의 끝(「…가능성이 있겠고,」「…발효된 가운데,」)
            const clause = s.slice(start, m.index + m[0].length).trim();
            let head = s.slice(start, m.index);
            const cut = head.search(/물결이|바람이/);
            if (cut >= 0) head = head.slice(0, cut);
            head = head.replace(/^[\s\-–·○o]*(?:\(해상\))?\s*(?:특히|또한|한편)?\s*,?/, '').replace(/제\s*\d+호\s*태풍[^,]*?영향으로/, ' ').replace(/의\s*풍랑특보는/g, '는');
            const h = readHead(head, pubMs) || fromAi(head, aiRead(clause), pubMs);
            if (!h) { out.unread.push(clause); continue; }
            const kind = /태풍/.test(m[0]) ? 'typhoon' : 'wave';
            for (const x of h) out.notices.push({ kind, zones: x.zones, dayMs: x.dayMs, label: x.label });
        }
    }
    return out;
}

// ── 계산 ──────────────────────────────────────────────────────────────────
/** 같은 관서·같은 종류·같은 호는 마지막 판만(bulletin_status 의 latest 와 같은 규칙 — 호 번호는 해마다 다시 시작). */
function lastVersions(bulletins) {
    const m = new Map();
    for (const b of bulletins || []) {
        if (!b || !b.result || !b.result.tmIn) continue;
        const k = b.office + '|' + b.rpt + '|' + String(b.result.tmFc).slice(0, 4) + '|' + b.result.t1Title;
        const o = m.get(k);
        //   firstIn = 그 호가 처음 나온 시각. 안내의 시각으로 쓴다 — 고친 판의 시각을 쓰면, 경보가 난 뒤에 같은 호를 고쳐 다시 냈을 때 끝난 안내가 되살아난다(별도 에이전트 검토 2026-11-19).
        const firstIn = o && o.firstIn < b.result.tmIn ? o.firstIn : b.result.tmIn;
        m.set(k, { b: !o || o.b.result.tmIn < b.result.tmIn ? b : o.b, firstIn });
    }
    return [...m.values()].sort((x, y) => x.b.result.tmIn.localeCompare(y.b.result.tmIn));
}
const pubOf = (reportId) => { const m = String(reportId || '').match(/^cmt:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2}):/); return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`) : NaN; };

/**
 * 지금 화면에 보일 격상 가능성을 계산한다.
 * 예: compute({ bulletins, zones, forecasts, nowMs }) → { items: { 동해중부안쪽먼바다: [{ kind:'wave', source:'통보문', dayMs, label:'밤(18시~24시)', expMs, caveat, doc:{…} }] }, refs:[…], unread:[…] }
 * @param {{bulletins:Array, zones?:object, forecasts?:Array<{type:string, reportId:string, title:string, rawText:string}>, nowMs:number, aiRead?:function}} a
 *   zones = bulletin_status 계산 결과(해역 → 지금 특보) · forecasts = 날씨해설(단기·초단기 최신 한 편씩)
 * @returns {{at:number, items:object, refs:Array<{rpt, office, ho, inMs}>, unread:string[]}}
 *   refs = 지금 보이는 안내가 적힌 통보문(📋 로 열 원문 — bulletin_docs 가 보관해야 한다)
 * [연계] ← run(이 파일) · 검사 / → readBulletin · readCommentary
 */
function compute({ bulletins, zones = {}, forecasts = [], nowMs, aiRead = () => null }) {
    const V = lastVersions(bulletins), B = V.map((v) => v.b), unread = [];
    // 해역별 사건(특보 통보문의 해당 구역 칸) — 부모 해역만
    const events = new Map();
    for (const b of B) if (b.rpt === '6') {
        const inMs = KST(b.result.tmIn);
        for (const it of parseItems(b.result.t2, [])) for (const u of it.units) if (PARENTS.has(u)) {
            if (!events.has(u)) events.set(u, []);
            events.get(u).push({ inMs, type: it.type, level: it.level, action: it.action });
        }
    }
    const up = (e) => e.action === '발표' || e.action === '변경';
    const lifted = (e) => e.action === '해제';
    const waveEnd = (e) => lifted(e) || (up(e) && (e.type === '태풍' || e.level === '경보'));   // 풍랑 가능성이 끝나는 사건: 해제 · 풍랑경보 · 태풍특보
    const typhoonEnd = (e) => lifted(e) || (up(e) && e.type === '태풍');
    const firstAfter = (zone, t, pred) => { const e = (events.get(zone) || []).find((x) => x.inMs > t && pred(x)); return e ? e.inMs : Infinity; };

    // 통보문 안내 — 해역마다 가장 새 안내 하나
    const latest = new Map(), cancels = new Map();
    for (const { b, firstIn } of V) {
        const rd = readBulletin(b, aiRead), inMs = KST(firstIn);
        for (const u of rd.unread) unread.push(`${b.office} ${b.result.t1Title} — ${u}`);
        for (const c of rd.cancels) for (const z of c.zones) { if (!cancels.has(z)) cancels.set(z, []); cancels.get(z).push(inMs); }
        for (const n of rd.notices) for (const z of n.zones) latest.set(z, { n, b, inMs });   // B 는 입력시각 순 — 뒤의 것이 이긴다
    }
    const items = {}, refs = new Map(), bulletinEnd = new Map();
    const add = (zone, it) => { (items[zone] = items[zone] || []).push(it); };
    for (const [zone, { n, b, inMs }] of latest) {
        const cancelMs = (cancels.get(zone) || []).filter((t) => t >= inMs).sort((x, y) => x - y)[0];
        //   시간창이 있으면 창 끝 + 6시간 · 날짜만 알면(「16일 오후부터」) 그 날 끝 + 6시간 · 아무 때도 없으면 96시간
        const expMs = n.endMs != null ? n.endMs + GRACE_MS : n.dayMs != null ? Math.max(n.dayMs + DAY, inMs) + GRACE_MS : inMs + NOTIME_MS;
        const endMs = Math.min(expMs, firstAfter(zone, inMs, waveEnd), cancelMs === undefined ? Infinity : cancelMs);
        if (nowMs >= endMs || nowMs < inMs) { bulletinEnd.set(zone, Math.min(endMs, nowMs)); continue; }
        const r = b.result, d = require('./bulletin_docs').docOf(r);
        const ref = { rpt: b.rpt, office: b.office, ho: r.t1Title, inMs };
        refs.set([ref.rpt, ref.office, ref.ho, ref.inMs].join('|'), ref);
        add(zone, { kind: 'wave', source: '통보문', dayMs: n.dayMs, label: n.label, expMs, caveat: CAVEAT.wave,
            doc: { type: 'bulletin', title: `${r.t1Title} ${clean(r.t1).trim() || (b.rpt === '7' ? '예비특보' : '통보문')}`, key: d ? d.key : '', pdfUrl: d ? d.url : '' } });
    }
    for (const [zone, list] of cancels) if (!bulletinEnd.has(zone) && !(items[zone] || []).length) bulletinEnd.set(zone, Math.max(...list));   // 안내 없이 취소만 온 해역(안내는 관찰 범위 밖)

    // 날씨해설 — 통보문에 없는 것만 채운다. 더 새 글이 그 해역을 다시 말하면 그것으로(새 글에 없다고 지우지 않는다 — 초단기 글은 가까운 때만 다루기도 한다).
    const fill = new Map();
    const fc = (forecasts || []).map((f) => Object.assign({ pubMs: pubOf(f && f.reportId) }, f)).filter((f) => f.pubMs <= nowMs && nowMs - f.pubMs <= CMT_MS).sort((a, b) => a.pubMs - b.pubMs);
    for (const f of fc) {
        const rd = readCommentary(f.rawText, f.pubMs, aiRead);
        for (const u of rd.unread) unread.push(`${f.type} ${f.reportId} — ${u}`);
        for (const n of rd.notices) for (const z of n.zones) fill.set(z + '|' + n.kind, { n, f, zone: z });
    }
    for (const { n, f, zone } of fill.values()) {
        const z = zones[zone] || {}, typhoonNow = z.type === '태풍' || (z.next || {}).type === '태풍';
        if (n.kind === 'wave') {
            if ((items[zone] || []).some((x) => x.kind === 'wave')) continue;                 // 통보문이 먼저
            if (bulletinEnd.has(zone) && bulletinEnd.get(zone) > f.pubMs) continue;           // 통보문 안내가 이 글 뒤에 끝났다(취소·경보·해제·시간 지남) — 되살리지 않는다
            if (firstAfter(zone, f.pubMs, waveEnd) < Infinity) continue;                      // 이 글 뒤에 경보·해제·태풍특보 통보문이 나왔다
            if (typhoonNow || (z.kind !== 'yebi' && z.level === '경보') || (z.next || {}).level === '경보') continue;   // 이미 경보(곧 경보)
        } else {
            if (firstAfter(zone, f.pubMs, typhoonEnd) < Infinity || typhoonNow) continue;     // 이미 태풍특보 · 해제됨 (풍랑경보 해역에는 그대로 붙인다 — 태풍은 거기서 오른다)
        }
        const date = String(f.reportId).split(':')[1] || '';
        add(zone, { kind: n.kind, source: f.type === '초단기전망' ? '초단기전망' : '단기전망', dayMs: n.dayMs, label: n.label, expMs: f.pubMs + CMT_MS, caveat: CAVEAT[n.kind],
            doc: { type: 'web', title: String(f.title || '날씨해설').replace(/^\[해설\]\s*/, '').replace(/\s+/g, ' ').trim(),
                webUrl: `https://www.weather.go.kr/w/special-report/list.do?prevStn=108&stn=108&date=${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}&reportId=${encodeURIComponent(f.reportId)}` } });
    }
    return { at: nowMs, items, refs: [...refs.values()], unread };
}

// ── AI(⑤) — 규칙이 못 읽은 문장만 ───────────────────────────────────────────
const PROMPT = (sentence) => `다음은 기상청 글의 한 문장(또는 토막)이다. 이 글이 「풍랑경보로 변경(강화)될 가능성」 또는 「태풍특보로 변경될 가능성」이 있다고 한 해역과 그 시점만 뽑아라.
규칙:
- 해역과 시점은 글에 적힌 글자를 그대로 옮긴다(풀어 쓰거나 고치거나 합치지 않는다).
- 새 특보를 「발표할 가능성」이 있다는 해역, 이미 특보가 「발효된」 해역, 물결 높이를 설명하는 괄호 안의 해역은 넣지 않는다.
- 해역마다 시점이 다르면 항목을 나눈다. 시점이 적혀 있지 않으면 "" 로 둔다.
- 그런 해역이 없으면 빈 배열.
JSON 만 답한다: {"항목":[{"해역":"글에 적힌 그대로","시점":"글에 적힌 그대로"}]}

글: ${sentence}`;

/**
 * AI 답 보관소 — 못 읽은 문장을 한 번씩 ⑤ 순서 AI 에 묻고 답을 문장별로 남긴다(검사는 쓸 때 fromAi 가 한다).
 * @param {{ai?:function(string): Promise<{success:boolean, text?:string, error?:string}>, file?:string, now?:function(): number}} [o]
 * @returns {{read:function(string): Array|null, fill:function(string[]): Promise<{asked:number, skipped?:boolean}>}}
 * [연계] ← run(이 파일) · 검사
 */
function createAi({ ai = (p) => require('./bulletin_ai').call('escalation', p, { caller: 'Bulletin-Escalation' }), file = AI_FILE, now = () => Date.now() } = {}) {
    let st = null, running = false;
    const obj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
    const load = () => { if (!st) { try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { st = {}; } if (!obj(st)) st = {}; if (!obj(st.done)) st.done = {}; } return st; };   // 파일 내용이 null·숫자·배열이어도 던지지 않는다
    const save = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(st)); fs.renameSync(file + '.tmp', file); };
    /** 그 문장의 AI 답(항목 배열) — 아직 없거나 실패했으면 null. */
    const read = (text) => { const d = load().done[keyOf(text)]; return d && d.ok ? d.items : null; };
    /**
     * 못 읽은 문장들 중 아직 안 물은 것을 차례로 묻는다(겹쳐 돌지 않음, 실패는 10분 뒤 다시 — 세 번까지). 더는 못 읽은 문장이 아닌 기록은 지운다.
     * @param {string[]} texts 지금 못 읽은 문장 전부
     */
    async function fill(texts) {
        if (running) return { asked: 0, skipped: true };
        running = true;
        let asked = 0;
        try {
            load();
            const live = new Set(texts.map(keyOf));
            let changed = false;
            for (const k of Object.keys(st.done)) if (!live.has(k) && !st.done[k].ok) { delete st.done[k]; changed = true; }   // 답을 쓴 문장(ok)은 그 답으로 읽혀 「못 읽은 문장」에서 빠진다 — 지우면 다시 묻게 된다
            for (const text of texts) {
                const k = keyOf(text), d = st.done[k];
                if (d && (d.ok || d.tries >= AI_MAX_TRIES || (d.nextMs || 0) > now())) continue;
                let r;
                try { r = await ai(PROMPT(text)); } catch (e) { console.warn('[격상 가능성] AI 호출 중 예외 — 10분 뒤 다시:', e && e.message); r = { success: false, error: String((e && e.message) || e) }; }
                let parsed = null;
                if (r && r.success) { try { parsed = JSON.parse(String(r.text || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (_) { parsed = null; } }
                const ok = !!parsed && Array.isArray(parsed.항목);
                st.done[k] = ok ? { ok: true, items: parsed.항목.slice(0, 20).map((x) => ({ 해역: String((x && x.해역) || '').slice(0, 100), 시점: String((x && x.시점) || '').slice(0, 60) })), text: String(text).slice(0, 400), at: now() }
                    : { ok: false, tries: ((d && d.tries) || 0) + 1, nextMs: now() + AI_RETRY_MS, error: String((r && r.error) || 'JSON 으로 읽을 수 없는 답').slice(0, 200), text: String(text).slice(0, 400) };
                asked++; changed = true;
            }
            if (changed) save();
        } catch (e) {
            console.warn('[격상 가능성] AI 보관소 갱신 실패:', e && e.message);
        } finally { running = false; }
        return { asked };
    }
    return { read, fill };
}

/** 받아 둔 날씨해설(단기·초단기 최신 한 편씩). 파일이 없거나 깨졌으면 빈 배열(날씨해설 없이 통보문 것만 보인다). */
function readForecasts(file = FORECAST_FILE) {
    let j;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.warn('[격상 가능성] 날씨해설 파일을 못 읽음 — 통보문 것만 계산:', e.message); return []; }
    return [j && j.shortTerm, j && j.ultraShort].filter((f) => f && f.reportId && f.rawText);
}

let realAi = null;
/**
 * 한 번 계산해 저장한다(통보문 기준 계산 다음 매분). 규칙이 못 읽은 문장은 AI 에 묻도록 걸어 두고 기다리지 않는다(답은 다음 분 계산에 쓰인다).
 * @param {{watch?:object, zones?:object, forecasts?:Array, file?:string, now?:function(): number, ai?:{read:function, fill:function}}} [o]
 * @returns {{at:number, items:object, refs:Array, unread:string[]}}
 * [연계] ← scheduler.js / → data/bulletin_escalation.json
 */
function run({ watch = require('./bulletin_watch'), zones, forecasts = readForecasts(), file = FILE, now = () => Date.now(), ai = (realAi = realAi || createAi()) } = {}) {
    const res = compute({ bulletins: watch.bulletins(), zones: zones || {}, forecasts, nowMs: now(), aiRead: ai.read });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(res)); fs.renameSync(file + '.tmp', file);
    //   AI 에는 답을 쓸 수 있는 문장(「…로 변경될 가능성」 문장·토막)만 — 표의 이름 빈 줄·취소 줄은 AI 답을 쓸 곳이 없다
    const ask = res.unread.map((u) => u.slice(u.indexOf(' — ') + 3)).filter((t) => WAVE_UP.test(t) || /태풍\s*특보로\s*변경될\s*가능성/.test(t));
    if (ask.length) ai.fill(ask).catch((e) => console.warn('[격상 가능성] AI 묻기 실패:', e && e.message));
    return res;
}
/** 마지막 계산 결과(없으면 null). */
function read(file = FILE) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }

module.exports = { run, read, compute, readBulletin, readCommentary, readHead, resolve, fromAi, seaPart, createAi, readForecasts, PROMPT, GRACE_MS, NOTIME_MS, CMT_MS, CAVEAT };
