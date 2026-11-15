/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing_errlog.js
 * 역할  : 「연안 안전 브리핑」 AI 오류를 처리 완료 전까지 쌓아 두는 누적 오류 기록(error_log.json)의 순수 함수 모음.
 *         오류마다 번호(id)를 붙여 최대 90일(KST 날짜) 보관하고, 오류를 유형(family — 예: 「해상 분석 문장 수」·「허용되지 않은 숫자」)으로 묶어
 *         「내보내기」(관리자가 누적 md 를 받을 때 그때의 처리 안 된 오류·유형 번호 G01… 를 기록)와 「처리 완료」(유형 단위 — 관리자 버튼 또는
 *         머지된 저장소 파일 config/station_briefing_resolved.json)를 맡는다. 파일 읽기·쓰기는 하지 않는다(station_briefing.js 가 한다).
 *         2026-11-15 사용자 결정(설계서 §11.10.48): *"그냥 쭉 보관하도록 하는거야 승인(처리 완료) 전까지는"* · 보관 90일 · *"수정이 완료되어 머지가 되면 해당 부분이 자동으로 완료 처리"* · 고친 유형만.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing_rules.js(kstDate·isoKst — KST 날짜·시각)
 *  - 서버 API      : 없음(routes/station_briefing.js → services/station_briefing.js 가 부른다)
 *  - 나를 쓰는 곳  : services/station_briefing.js(addErrors·status·exportOpen·resolveExport·applyResolved) · scripts/test_station_briefing.js
 *  - 짝            : client/js/admin/admin_station_briefing.js familyText(유형 열쇠의 한글 이름 — codeFamily 가 만드는 열쇠와 맞아야 한다, 시험이 본다)
 * [로드 순서] require 부작용 없음.
 * ============================================================================
 */
'use strict';
const R = require('./station_briefing_rules');

// 보관 기간 90일(사용자 결정). 안전 상한 LOG_HARD_CAP: 이 파일은 실행마다 통째로 읽고 쓴다 — 오류가 폭주하는 고장(예: 실행마다 관할 97곳 × 4번 탈락)이
// 90일 이어지면 끝없이 커져 Fly 볼륨을 채울 수 있다(ENOSPC 는 운영에서 실제로 난 적이 있다 — test_station_briefing [§11.10.8] 의 ENOSPC 사례).
// 운영 정시 판 오류는 판마다 4~14건(2026-11-13~15 관리자 화면 6판 — 사용자 스크린샷)이라 하루 수십 건, 90일 수천 건이다. 30,000 은 그 몇 배 여유.
// 상한으로 지운 것은 capped 로 남겨 관리자 화면이 밝힌다(조용히 사라지지 않게 — CLAUDE.md L-291).
const LOG_KEEP_DAYS = 90, LOG_HARD_CAP = 30000;
// 탈락 글(text·allowed) 보관 건수(독립 검토 ④): 글이 실린 오류는 한 건이 수 KB(문단 460자 둘 + 허용 숫자 — 검토 실측 3.7KB 꼴)라, 상한 30,000건을 모두 실으면 이 파일이 약 78MB
//   (검토 실측 — 실행마다·관리자 화면마다 통째로 읽고 쓴다). 사용자 「파일이 길어져도 관계 없어」는 md 쪽 말이라, 서버 파일은 처리 안 된 것 중 최근 5,000건(약 18MB)만 글을 싣는다.
//   그보다 오래된 것은 글만 빼고 textDropped:true(오류 줄은 그대로 — md 가 「보관 상한으로 글을 지움」을 밝힌다). 하루 60건 꼴이면 80일 넘게 글이 남는다(어림).
const LOG_TEXT_KEEP = 5000;
const DAY = 86400000;

/** 빈 기록. @returns {object} {seq, errors, exports, capped}(+ 깨진 파일에서 되살렸으면 recovered {at, file}) [연계] ← normLog·station_briefing.loadLog */
function emptyLog() { return { seq: 0, errors: [], exports: [], capped: null }; }
/** 파일에서 읽은 값을 기록 꼴로 다듬는다(칸이 빠졌거나 배열이 아니면 빈 값). @param {object|null} x @returns {object} [연계] ← station_briefing.loadLog */
function normLog(x) {
    const o = x && typeof x === 'object' ? x : {};
    return { seq: Number.isFinite(o.seq) ? o.seq : 0, errors: Array.isArray(o.errors) ? o.errors : [], exports: Array.isArray(o.exports) ? o.exports : [], capped: o.capped || null, ...(o.recovered ? { recovered: o.recovered } : {}) };
}

// 검사 오류 열쇠 → 유형 열쇠. 뒤에 붙는 값(지명·숫자·문장 수·글자 수)을 떼어 같은 종류를 한 유형으로 묶는다.
// 열쇠 목록은 station_briefing_ai.validateOverview 가 남기는 것 — 관리자 화면 codeText 가 푸는 것과 같다. 목록에 없는 열쇠는 그대로(값이 없는 고정 열쇠 — markup·word:기준·forbidden:… 등).
const FAMILY_RULES = [
    [/^shape:(land|sea)-sentences-\d+$/, (m) => 'shape:' + m[1] + '-sentences'],
    [/^shape:(land|sea)-too-long-\d+$/, (m) => 'shape:' + m[1] + '-too-long'],
    [/^word:level-need:/, () => 'word:level-need'],
    [/^number:hangul:/, () => 'number:hangul'],
    [/^number:/, () => 'number'],
    [/^multiplier:/, () => 'multiplier'],
    [/^place:/, () => 'place'],
    [/^(level|level-para|level-last|level-max):/, (m) => m[1]],
    [/^fact:/, () => 'fact'],
    [/^label:/, () => 'label'],
    [/^required:/, () => 'required'],
];
/**
 * 검사 오류 열쇠 하나의 유형. 예: 'shape:sea-sentences-2' → 'shape:sea-sentences' · 'number:0.5~1.5m' → 'number' · 'level-para:주의>1' → 'level-para' · 'markup' → 'markup'
 * @param {string} code @returns {string} [연계] ← familiesOf · 시험(화면 familyText 와 짝)
 */
function codeFamily(code) {
    const c = String(code || '').trim();
    for (const [re, f] of FAMILY_RULES) { const m = re.exec(c); if (m) return f(m); }
    return c;
}
/**
 * 오류 한 건의 유형들. 검사 탈락(validate)은 이유(쉼표로 이은 열쇠)마다 유형 하나 — 한 건이 여러 유형에 들 수 있다.
 * 그 밖(AI 호출 실패·응답 해석 실패·시간 초과·실행 실패)은 단계·공급자·이유 글(숫자는 # 로 — 「시간초과(320초)」와 「(310초)」를 한 유형으로) 하나. 「@」로 시작해 검사 열쇠와 섞이지 않는다.
 * 예: {stage:'validate',reason:'shape:sea-sentences-2,number:0.5m,number:4m/s'} → ['shape:sea-sentences','number']
 *     {stage:'call',provider:'vm',reason:'vm 시간초과(320초)'} → ['@call:vm:vm 시간초과(#초)'] · {stage:'deadline'} → ['@deadline']
 *     {stage:'run',reason:'2026-10-17|morning 실행 실패(2번째): ENOSPC'} → ['@run:ENOSPC']
 * @param {object} e @returns {string[]} [연계] ← isOpen·openFamilies·exportOpen·summary
 */
function familiesOf(e) {
    if (!e) return [];
    // 기록에 넣을 때 정해 둔 유형(fam — append 가 단다)을 쓴다(독립 검토 ⑦): 이 규칙(FAMILY_RULES·숫자 → #)을 고쳐도 이미 처리 완료한 오류가 다른 유형 이름으로 바뀌어 되살아나지 않게.
    if (Array.isArray(e.fam) && e.fam.length) return e.fam;
    const reason = String(e.reason || '');
    if (e.stage === 'validate') { const f = [...new Set(reason.split(',').map((x) => x.trim()).filter(Boolean).map(codeFamily))]; return f.length ? f : ['@validate:']; }
    if (e.stage === 'deadline') return ['@deadline'];
    const r = reason.replace(/\d+(?:\.\d+)?/g, '#');
    if (e.stage === 'run') return ['@run:' + r.replace(/^\S+ 실행 실패\(#번째\): /, '').slice(0, 80)];
    return ['@' + (e.stage || '?') + ':' + (e.provider || '') + ':' + r.slice(0, 80)];
}
/** 아직 처리 완료되지 않은 유형들. 예: 유형 ['place','number'] 중 resolved {place:'E…'} → ['number']. @param {object} e @returns {string[]} [연계] ← isOpen·exportOpen·summary */
function openFamilies(e) { const done = (e && e.resolved) || {}; return familiesOf(e).filter((f) => !done[f]); }
/** 처리 안 된 유형이 하나라도 남았나. @param {object} e @returns {boolean} [연계] ← station_briefing.status(실행별 화면 「처리 완료」 표시)·exportOpen·summary */
function isOpen(e) { return openFamilies(e).length > 0; }

/** 보관 시작 날짜(KST) — 오늘 포함 LOG_KEEP_DAYS 일. 예: now 11-15 → '2026-08-18'. @param {number} now @returns {string} [연계] ← prune·applyRepo */
function keepFrom(now) { return R.kstDate(now - (LOG_KEEP_DAYS - 1) * DAY); }
/**
 * 보관 규칙대로 자른다(기록을 고친다) — 오류·내보내기는 최근 90일(KST 날짜)만. 오류가 상한을 넘으면 **처리 완료된 것부터**, 그래도 넘으면 처리 안 된 오래된 것을 지우고
 * capped 에 시각·수(독립 검토 ⑤ — 종전엔 처리 여부와 관계없이 오래된 것부터라 처리 안 된 오류가 먼저 사라졌다). 상한 기록도 90일이 지나면 버린다.
 * 처리 안 된 오류 중 최근 LOG_TEXT_KEEP 건만 탈락 글을 남긴다(그 전은 textDropped).
 * @param {object} log @param {number} now @returns {object} log [연계] ← append
 */
function prune(log, now) {
    const from = keepFrom(now);
    log.errors = log.errors.filter((e) => e && typeof e.at === 'string' && e.at.slice(0, 10) >= from);
    if (log.errors.length > LOG_HARD_CAP) {
        const n = log.errors.length - LOG_HARD_CAP, closed = log.errors.filter((e) => !isOpen(e)), drop = new Set(closed.slice(0, n));
        if (drop.size < n) for (const e of log.errors) { if (drop.size >= n) break; drop.add(e); }
        log.errors = log.errors.filter((e) => !drop.has(e)); log.capped = { at: R.isoKst(now), dropped: n, cap: LOG_HARD_CAP };
    } else if (log.capped && !(typeof log.capped.at === 'string' && log.capped.at.slice(0, 10) >= from)) log.capped = null;
    for (let i = log.errors.length - 1, n = 0; i >= 0; i--) { const e = log.errors[i]; if (!e.text || ++n <= LOG_TEXT_KEEP) continue; const { text: _t, allowed: _a, ...rest } = e; log.errors[i] = { ...rest, textDropped: true }; }
    log.exports = log.exports.filter((x) => x && typeof x.at === 'string' && x.at.slice(0, 10) >= from);
    return log;
}
/**
 * 오류들에 번호(id — 'e' + 늘어나는 수)와 유형(fam — 지금 규칙으로 정해 둠, familiesOf 참고)을 붙여 기록에 더하고 보관 규칙대로 자른다.
 * 이미 번호가 있는 오류는 번호를 그대로 두고, 기록에 같은 번호가 있으면 다시 넣지 않는다. 새 번호는 기록·넘겨받은 오류의 가장 큰 번호보다 크게(번호가 겹치지 않게 — 독립 검토 ①).
 * 예: append(log{seq:4}, [{at,stage,…}]) → [{id:'e5', fam:[…], at, stage, …}] (log.seq 5)
 * @param {object} log @param {object[]} add @param {number} now @returns {object[]} 번호가 붙은 오류(상태 파일의 최근 3일 목록에도 같은 것을 넣는다) [연계] ← station_briefing.addErrors·loadLog(처음 옮기기)
 */
function append(log, add, now) {
    const num = (id) => { const m = /^e(\d+)$/.exec(String(id || '')); return m ? Number(m[1]) : 0; };
    log.seq = Math.max(log.seq, ...log.errors.map((e) => num(e.id)), ...(add || []).map((e) => num(e && e.id)));
    const out = (add || []).filter(Boolean).map((e) => { const x = e.id ? e : Object.assign({ id: 'e' + (++log.seq) }, e); return Array.isArray(x.fam) ? x : { ...x, fam: familiesOf(x) }; });
    const have = new Set(log.errors.map((x) => x.id));
    log.errors = log.errors.concat(out.filter((e) => !have.has(e.id)));
    prune(log, now);
    return out;
}

/** 내보내기 번호. 예: 2026-11-15 22:10:34 KST → 'E20261115-221034'(같은 초에 또 만들면 '-2'). @param {object} log @param {number} now @returns {string} [연계] ← exportOpen */
function exportId(log, now) {
    const base = 'E' + R.isoKst(now).slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    let id = base, n = 1; while (log.exports.some((x) => x.id === id)) id = base + '-' + (++n);
    return id;
}
/**
 * 처리 안 된 오류 전부를 내보낸다 — 유형마다 번호(G01… — 건수 많은 순)를 붙이고, 그 유형에 든 오류 번호를 내보내기 기록에 남긴다(나중에 「이 md 에 들어 있던 것」만 처리 완료하려고).
 * 처리 안 된 오류가 없으면 null(기록에 아무것도 더하지 않는다).
 * 예: exportOpen(log, now) → {exp:{id:'E20261115-221034', at, groups:[{code:'G01', family:'shape:sea-sentences', ids:['e3','e9']}…], resolved:{}}, errors:[처리 안 된 오류(오래된 것부터)], stats:[familyStats — groups 와 같은 순서]}
 * 기록(exp)에는 번호·유형·오류 번호만 남긴다(파일 크기) — 관할·값 집계(stats)는 응답에만.
 * @param {object} log - 고친다(exports 에 더함) @param {number} now @returns {object|null} [연계] ← station_briefing.exportErrors
 */
function exportOpen(log, now) {
    const open = log.errors.filter(isOpen);
    if (!open.length) return null;
    const stats = familyStats(open), groups = stats.map((g, i) => ({ code: 'G' + String(i + 1).padStart(2, '0'), family: g.family, ids: g.ids }));
    const exp = { id: exportId(log, now), at: R.isoKst(now), groups, resolved: {} };
    log.exports.push(exp);
    return { exp, errors: open, stats };
}
/**
 * 내보내기 하나의 유형들을 처리 완료로 바꾼다 — 그 내보내기에 들어 있던 오류만(그 뒤 새로 난 같은 유형 오류는 그대로).
 * 오류의 모든 유형이 처리 완료되면 탈락 글·허용 목록(text·allowed)은 지운다(누적 md 에 더 나오지 않고, 실행별 md 는 상태 파일의 최근 3일 목록을 쓴다).
 * 예: resolve(log, 'E20261115-221034', ['G01'], 'merge', '문장 수 검사 고침', now) → {ok:true, resolved:['G01'], already:[], unknown:[]}
 *     codes null → 그 내보내기의 남은 유형 전부 · 없는 내보내기 → {ok:false, reason:'not-found'}
 * @param {object} log - 고친다 @param {string} id @param {string[]|null} codes @param {string} by - 'merge'|'manual' @param {string} note @param {number} now
 * @returns {object} [연계] ← station_briefing.resolveExport(관리자 버튼)·applyRepo(머지된 저장소 파일)
 */
function resolve(log, id, codes, by, note, now) {
    const exp = log.exports.find((x) => x.id === id);
    if (!exp) return { ok: false, reason: 'not-found', resolved: [], already: [], unknown: codes || [] };
    const want = Array.isArray(codes) ? codes : exp.groups.map((g) => g.code);
    const unknown = want.filter((c) => !exp.groups.some((g) => g.code === c)), already = [], done = [];
    const byId = new Map(log.errors.map((e, i) => [e.id, i]));
    exp.resolved = exp.resolved || {};
    for (const g of exp.groups) {
        if (!want.includes(g.code)) continue;
        if (exp.resolved[g.code]) { already.push(g.code); continue; }
        for (const eid of g.ids) {
            const i = byId.get(eid); if (i === undefined) continue;   // 보관 기간·상한으로 이미 지워짐
            const e = { ...log.errors[i], resolved: { ...(log.errors[i].resolved || {}), [g.family]: exp.id } };
            if (!isOpen(e)) { delete e.text; delete e.allowed; }
            log.errors[i] = e;
        }
        exp.resolved[g.code] = { at: R.isoKst(now), by, ...(note ? { note: String(note).slice(0, 200) } : {}) };
        done.push(g.code);
    }
    return { ok: true, resolved: done, already, unknown };
}
/**
 * 머지된 저장소 파일(config/station_briefing_resolved.json 의 resolved 배열)을 기록에 적용한다 — 서버가 켜진 뒤 첫 점검·관리자 상태·내보내기 때 부른다(이미 처리한 유형은 건너뛰어 여러 번 불러도 같다).
 * 줄 꼴: {export:'E20261115-221034', groups:['G01','G03'], note:'…'}.
 * 맞지 않는 줄은 issues 로 돌려준다(관리자 화면이 알림 — 번호를 잘못 적어 아무 일도 안 일어나는 것이 조용히 지나가지 않게, CLAUDE.md L-291):
 *   꼴이 틀림 · 이 서버에 없는 내보내기(보관 기간 90일이 지난 번호는 문제 아님 — 건너뜀) · 그 내보내기에 없는 유형 번호.
 * 예: applyRepo(log, [{export:'E20261115-221034', groups:['G01']}], now) → {changed:true, issues:[]}
 * @param {object} log - 고친다 @param {object[]} entries @param {number} now @returns {{changed:boolean, issues:object[]}} [연계] ← station_briefing.applyResolved
 */
function applyRepo(log, entries, now) {
    const issues = []; let changed = false;
    const from = keepFrom(now).replace(/-/g, '');
    (Array.isArray(entries) ? entries : []).forEach((x, i) => {
        // 'all' 은 받지 않는다(독립 검토 ⑪ — 사용자 결정 「고친 유형만」. 남은 유형 전부는 관리자 버튼으로)
        const okGroups = x && Array.isArray(x.groups) && x.groups.length && x.groups.every((g) => typeof g === 'string');
        if (!x || typeof x.export !== 'string' || !/^E\d{8}-\d{6}(?:-\d+)?$/.test(x.export) || !okGroups) { issues.push({ index: i, export: x && x.export ? String(x.export) : null, problem: '꼴이 틀림 — {"export":"E…","groups":["G01"]} 꼴이어야 함' }); return; }
        if (!log.exports.some((e) => e.id === x.export)) { if (x.export.slice(1, 9) >= from) issues.push({ index: i, export: x.export, problem: '이 서버에 없는 내보내기 번호' }); return; }
        const r = resolve(log, x.export, x.groups, 'merge', x.note, now);
        if (r.resolved.length) changed = true;
        if (r.unknown.length) issues.push({ index: i, export: x.export, problem: '그 내보내기에 없는 유형 번호 ' + r.unknown.join(', ') });
    });
    return { changed, issues };
}

/**
 * 처리 안 된 오류들을 유형마다 집계한다 — 건수·오류 번호·관할 수·많이 나온 관할(최대 8)·많이 나온 값(검사 열쇠 뒤 값, 최대 6)·예시 열쇠·처음·마지막. 건수 많은 순(같으면 유형 열쇠 순).
 * 예: familyStats([{id:'e1',at,stage:'validate',stations:['인천해양경찰서|강화파출소'],reason:'shape:sea-sentences-2'}])
 *     → [{family:'shape:sea-sentences', count:1, ids:['e1'], stations:1, top:[['강화파출소',1]], values:[['2',1]], sample:'shape:sea-sentences-2', first:at, last:at}]
 * @param {object[]} open - 처리 안 된 오류 @returns {object[]} [연계] ← exportOpen·summary
 */
function familyStats(open) {
    const fam = new Map();
    for (const e of open) {
        const codes = e.stage === 'validate' ? String(e.reason || '').split(',').map((x) => x.trim()).filter(Boolean) : [];
        for (const f of openFamilies(e)) {
            if (!fam.has(f)) fam.set(f, { family: f, ids: [], st: new Map(), val: new Map(), sample: null, first: e.at, last: e.at });
            const g = fam.get(f); g.ids.push(e.id);
            if (e.at < g.first) g.first = e.at;
            if (e.at > g.last) g.last = e.at;
            for (const k of Array.isArray(e.stations) ? e.stations : []) { const n = String(k).split('|').slice(1).join('|') || String(k); g.st.set(n, (g.st.get(n) || 0) + 1); }
            const mine = codes.filter((c) => codeFamily(c) === f);
            if (!g.sample) g.sample = mine[0] || String(e.reason || '').slice(0, 120);
            for (const c of mine) { if (c === f) continue; const v = c.slice(f.length).replace(/^[:-]/, ''); g.val.set(v, (g.val.get(v) || 0) + 1); }
        }
    }
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
    return [...fam.values()].sort((a, b) => b.ids.length - a.ids.length || (a.family < b.family ? -1 : 1))
        .map((g) => ({ family: g.family, count: g.ids.length, ids: g.ids, stations: g.st.size, top: top(g.st, 8), values: top(g.val, 6), sample: g.sample, first: g.first, last: g.last }));
}
/**
 * 관리자 「처리 안 된 오류 — 누적」 칸에 줄 요약(오류 원문·오류 번호 없이 — 상태 응답이 가볍게).
 * 유형마다 familyStats(ids 뺌), 최근 내보내기 10개(유형마다 오류 수·아직 남은 수·처리 기록), 처리 완료 목록 알림(issues).
 * 예: summary(log, now, []) → {keepDays:90, cap:30000, capped:null, open:66, since:'2026-11-13T22:20:00+09:00', families:[{family:'shape:sea-sentences', count:42, stations:18, top, values, sample, first, last}], exports:[…], issues:[]}
 * @param {object} log @param {number} now @param {object[]} issues - applyRepo 가 돌려준 것 @returns {object} [연계] ← station_briefing.status
 */
function summary(log, now, issues) {
    const open = log.errors.filter(isOpen);
    const families = familyStats(open).map(({ ids: _ids, ...g }) => g);
    const byId = new Map(log.errors.map((e) => [e.id, e]));
    // 내보내기마다 유형별 오류 수·남은 수·지워진 수(보관 기간·상한 — 독립 검토 ⑥: 지워진 것을 「다른 내보내기로 처리」라 하지 않게)·처리 기록, 남은 오류 수(유형이 둘인 오류를 두 번 세지 않음 — ⑫).
    // 목록: 남은 것이 있는 내보내기는 모두(독립 검토 ⑧ — 누를 때마다 새 내보내기가 생겨 10개 밖으로 밀리면 버튼으로 처리할 수 없었다), 끝난 것은 최근 5개.
    const rows = log.exports.slice().reverse().map((x) => {
        const left = new Set();
        const groups = (x.groups || []).map((g) => {
            let open = 0, gone = 0;
            for (const id of g.ids) { const e = byId.get(id); if (!e) gone++; else if (!(e.resolved || {})[g.family]) { open++; if (!(x.resolved || {})[g.code]) left.add(id); } }
            return { code: g.code, family: g.family, count: g.ids.length, open, gone, resolved: (x.resolved || {})[g.code] || null };
        });
        return { id: x.id, at: x.at, openErrors: left.size, groups };
    });
    const exports = rows.filter((x) => x.openErrors > 0).concat(rows.filter((x) => x.openErrors === 0).slice(0, 5));
    return { keepDays: LOG_KEEP_DAYS, cap: LOG_HARD_CAP, capped: log.capped, open: open.length, since: open.length ? open.reduce((m, e) => (e.at < m ? e.at : m), open[0].at) : null, families, exports, issues: issues || [] };
}

module.exports = { LOG_KEEP_DAYS, LOG_HARD_CAP, LOG_TEXT_KEEP, emptyLog, normLog, codeFamily, familiesOf, openFamilies, isOpen, prune, append, exportId, exportOpen, resolve, applyRepo, familyStats, summary };
