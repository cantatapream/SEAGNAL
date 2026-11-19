/**
 * ============================================================================
 * 파일명: local_server/services/nariya_autorun.js
 * 역할  : AI 챗봇(해양법령 챗봇) 「자동 반영」 — 개정검토 승인·원문신선도 변경이 오면 10분 기다렸다가
 *         클라우드 Claude 세션(예약 작업)을 깨우고, 그 세션의 시작·완료를 관리자 휴대폰에 푸시로 알린다.
 *         (초보자용: 사장님이 md 파일을 세션에 직접 붙여 넣던 일을, 서버가 「일이 생겼다」고 세션에 알려 주는 것으로 바꾼다.
 *          서버는 일감 목록을 들고 있고, 세션이 와서 꺼내 간다. 승인과 머지·배포는 여전히 사장님이 한다.)
 *         설계안(명세): services/nariya_autorun.design.md — §1 흐름 · §2 환경 변수 · §3 열쇠 · §4 잠금 · §5 대기 중 상태 변화 표.
 * ----------------------------------------------------------------------------
 * [사용자 확정 2026-11-15 원문 — 설계안 §0]
 *   「a+b로 진행하고 그 개정, 원문신선도 등 변경되었을 때 푸시알림오잖아 ? 그리고 세션에 전달이 정상적으로 되면 또 푸시알림.
 *    완료가 되면 또 푸시알림 오도록도 할 수 있니 ?」 → 푸시① 기존 감지 알림 · 푸시② 세션 시작/전달 실패 · 푸시③ 완료.
 *   독립 검토 2건 뒤 「추천대로」 → ①claim 하는 순간 대기 신호를 넘겨받는다 ②원문신선도 「다시 뜬 카드」만 있어도 깨운다.
 *
 * [무엇을 들고 있나 — DATA_DIR/nariya_autorun_state.json (재시작에도 남게)]
 *   lock     : {run_id, since, source:'fire'|'claim', taken, workNotified} — 지금 일하는 세션. 3시간 지나면 무효(설계안 §4).
 *              taken = 그 세션이 넘겨받은 대기 몫(실패·만료 때 대기로 되돌리지 않는다 — 설계안 §4).
 *   pending  : {reasons:{amend?, fresh?}, since, lastAt} — 아직 세션에 넘기지 못한 요청(건수 누적).
 *   inFlight : [{run_id, pr_url, amend_ids, fresh_ids, mok_ids, since}] — PR 은 냈지만 아직 머지·반영 안 된 일. 자동 세션에는 숨긴다(14일까지).
 *   expired  : 3시간 만료로 풀린 run 최근 10개 — 그 세션이 다시 claim 하면 원래 출처·「작업 시작」 여부를 이어받는다(relocked).
 *   unknownFires : 시간초과로 전달 여부를 모르는 발사 최근 5개(3시간) — 그 run 이 claim 하면 늦게 성공 처리.
 *   doneIds  : 끝난 run 최근 20개 — done 중복 판정 · 늦게 온 발사 응답이 끝난 run 을 다시 잠그지 않게.
 *   lastFire · lastDone : 마지막 발사·마지막 완료 보고(상태 화면).
 *
 * [연계]
 *  - 사용하는 파일 : services/admin_push.js sendAdminPush(푸시 — 운영 seagnal-server 일 때만, 쓸 때 require)
 *                    · services/admin_auth.js requireAdminToken(관리자 토큰도 받는 조합 열쇠 — 쓸 때 require)
 *                    · Node 내장 fetch(예약 작업 API 트리거 POST — 설계안 §2)
 *  - 환경 변수     : NARIYA_ROUTINE_FIRE_URL · NARIYA_ROUTINE_TOKEN · NARIYA_AUTOMATION_TOKEN(32자 이상) · FLY_APP_NAME
 *  - 서버 API      : routes/legal.js POST /api/legal/autorun/claim · POST /api/legal/autorun/done · GET /api/legal/autorun/status
 *                    (열쇠 조합은 GET /api/legal/amendments/wiki-brief-all · GET /api/legal/freshness 에도 걸린다 — 자동화 열쇠로
 *                     부르면 inFlight 의 id 를 hiddenIds() 로 빼고 돌려준다)
 *  - 나를 부르는 곳 : routes/legal.js(개정 decide·decide-all 새 승인 뒤 requestRun('amend')) ·
 *                    services/admrul_fresh_scanner.js(새로 발견·다시 뜬 카드가 있으면 requestRun('fresh')) ·
 *                    server.js(시작 때 start() — pending·잠금 타이머 복원)
 *  - 검사          : scripts/test_nariya_autorun.js (설계안 §5 표 1:1)
 * [로드 순서] require 부작용 없음. 기본 인스턴스는 처음 쓸 때 만든다. start() 를 불러야 파일의 pending·잠금 타이머를 되살린다.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_FILE = path.join(DATA_DIR, 'nariya_autorun_state.json');
// 10분: 승인을 여러 번 나눠 눌러도 세션은 1번만 깨우려고(설계안 §1 — 요청마다 다시 잰다).
const DEBOUNCE_MS = 10 * 60000;
// 3시간: 이 상한이 없으면 세션이 done 을 못 보내고 죽었을 때 잠금이 영원히 남아 다시는 안 돈다(설계안 §4, 한 회차 실측 1~2시간).
const LOCK_TTL_MS = 3 * 3600000;
// 60초: 이 상한이 없으면 응답이 안 오는 연결 하나가 「발사 중」 표시를 붙들어, 그동안 다음 발사가 전부 건너뛰어진다.
const FIRE_TIMEOUT_MS = 60000;
// 14일: 이 상한이 없으면 PR 이 거절·방치됐을 때 그 일이 자동 세션에서 영원히 숨는다(설계안 §4 inFlight).
const INFLIGHT_TTL_MS = 14 * 24 * 3600000;
// 시간당 10통: 이 상한이 없으면 세션이 고장 나 done 을 쏟아낼 때 관리자 휴대폰이 푸시로 덮인다(넘으면 콘솔만).
const DONE_PUSH_PER_HOUR = 10;
// 열쇠 최소 32자: 짧은 열쇠는 맞혀 볼 수 있다 — 그보다 짧으면 없는 것으로 본다(설계안 §2).
const MIN_TOKEN_LEN = 32;
const PROD_APP = 'seagnal-server';   // 운영 앱 이름(fly.toml). 스테이징(seagnal-staging)·개발은 발사·푸시 안 함.
// mok(원문 결손 — 조문 목·고시 별표 누락)은 2026-11-16 사용자 확정 「자동슈정」으로 더했다.
const KINDS = { amend: '개정 승인', fresh: '원문 구버전·이름바뀜·다시 뜬 카드', mok: '원문 결손(목·별표 누락)', conflict: '충돌 난 자동 반영 PR', answer: '결정 필요에 단 사장님 답' };   // conflict(2026-11-18 사용자 「자동으로 세션이 해결」) — id 는 PR 번호, 머지 담당(nariya_pr_merge.handleConflict)이 맡긴다 · answer(같은 날 「앱에 답 칸 만들기」) — id 「PR번호-줄」
// 최근 기억 칸 수 — 만료로 풀린 run 10개(다시 claim 하면 이어받기) · 결과 불명 발사 5개(3시간) · 끝난 run 20개(done 중복·늦은 발사 응답 판정).
const KEEP = { expired: 10, unknown: 5, done: 20, seen: 2000 };
// 14일: 「세션이 결정 필요로 남긴 일」(deferred) 기억. 이 상한이 없으면 같은 id 가 몇 달 뒤 다시 낡아 돌아와도(같은 카드 id 재사용) 영영 안 깨운다(2026-11-16 남은 일 점검).
const SEEN_TTL_MS = 14 * 24 * 3600000;
// 3일: 실패·응답 없음으로 끝난 세션이 받았던 일의 쉼. 이 쉼이 없으면 고쳐지지 않는 원인(권한·커넥터)으로 매일 세션 1개·푸시 2통이 끝없이 나간다(적대검증 #3).
const COOLDOWN_MS = 3 * 24 * 3600000;
// 6시간: 새벽 점검 사슬이 도는 동안 세션 깨우기를 붙드는 상한. 이 상한이 없으면 사슬이 죽어 풀기를 못 부르면 세션이 영영 안 뜬다.
const HOLD_MAX_MS = 6 * 3600000;
const MAX_COUNT = 100000;   // 파일에서 읽은 건수 상한(깨진 값이 1e308 같은 수로 들어와도 글이 망가지지 않게)
const RUN_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const ITEM_ID_RE = /^[A-Za-z0-9._:-]{1,80}$/;
const PR_URL_RE = /^https:\/\/github\.com\/cantatapream\/SEAGNAL\/pull\/\d+$/;
// 제어문자(줄바꿈 \n 은 남김)와 글 방향을 바꾸는 문자 — 푸시·상태 화면에서 글을 뒤집거나 숨기는 데 쓰일 수 있다.
const UNSAFE_CHARS_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g;
// done 본문 상한 — 세션이 보낸 글이 푸시·상태 파일을 부풀리지 않게.
const LIMITS = { summary: 2000, needsCount: 20, needsLen: 300, ids: 300 };
const SUMMARY_FALLBACK = { pr: 'PR 을 만들었습니다.', nothing: '반영할 것이 없었습니다.', failed: '세션이 실패했습니다 — 세션 기록을 확인해 주세요.' };

/** ms → 'YYYY-MM-DDTHH:mm:ss+09:00'(KST). 예: 0 → '1970-01-01T09:00:00+09:00'. @param {number} ms @returns {string|null} */
function iso(ms) { return Number.isFinite(ms) ? new Date(ms + 9 * 3600000).toISOString().slice(0, 19) + '+09:00' : null; }

/** 빈 상태. [연계] ← readState */
function blank() { return { v: 1, lock: null, pending: null, inFlight: [], expired: [], unknownFires: [], doneIds: [], seen: [], lastFire: null, lastDone: null, lastSweep: null }; }
const isPlain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
/** 사유 객체를 검사한다. 예: {amend:'5', fresh:2} → {fresh:2}. @param {*} r @returns {object} */
function cleanReasons(r) {
    const out = {};
    if (!isPlain(r)) return out;
    for (const k of Object.keys(KINDS)) if (Number.isInteger(r[k]) && r[k] > 0 && r[k] <= MAX_COUNT) out[k] = r[k];
    return out;
}
const cleanIds = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && ITEM_ID_RE.test(x)).slice(0, LIMITS.ids) : []);
/** 잠금이 자동 세션에 내준 id 목록을 검사한다. 예: {amend:['a',1]} → {amend:['a'], fresh:[]}. @param {*} v @returns {{amend:string[], fresh:string[]}} */
function cleanServed(v) {
    const o = isPlain(v) ? v : {};
    const one = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && ITEM_ID_RE.test(x)))].slice(0, KEEP.seen) : []);
    return { amend: one(o.amend), fresh: one(o.fresh), mok: one(o.mok), conflict: one(o.conflict), answer: one(o.answer) };   // conflict(2026-11-18) — 세션이 꺼내 간 충돌 PR 번호
}

/**
 * 상태 파일을 읽어 모양을 맞춘다. 없으면 빈 상태. 깨졌으면 `.corrupt-<ms>` 로 옮겨 두고 빈 상태(설계안 §4 F17).
 * 미래 시각(since > now)의 잠금은 버린다 — 남겨 두면 만료 타이머가 엉뚱한 시간으로 걸린다.
 * 예: {"v":1,"lock":{"run_id":"ar-1","since":5,"source":"fire"}} → lock 그대로(taken {})
 * @param {string} file @param {number} nowMs @returns {{state:object, error:string|null}}
 * [연계] ← createAutorun.load
 */
function readState(file, nowMs) {
    let raw;
    try {
        if (!fs.existsSync(file)) return { state: blank(), error: null };
        raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
        console.error('[nariya_autorun] 상태 파일을 읽지 못해 빈 상태로 시작:', e && e.message);
        return { state: blank(), error: '읽기 실패: ' + String((e && e.message) || e).slice(0, 120) };
    }
    let o;
    try {
        o = JSON.parse(raw);
        if (!isPlain(o) || o.v !== 1) throw Error('형식이 맞지 않음');
    } catch (e) {
        const moved = file + '.corrupt-' + nowMs;
        try { fs.renameSync(file, moved); } catch (e2) { console.error('[nariya_autorun] 깨진 상태 파일을 옮기지 못함:', e2 && e2.message); }
        console.error('[nariya_autorun] 상태 파일이 깨져 ' + path.basename(moved) + ' 로 옮기고 빈 상태로 시작:', e && e.message);
        return { state: blank(), error: '깨진 파일 → ' + path.basename(moved) + ' (' + String((e && e.message) || e).slice(0, 80) + ')' };
    }
    const s = blank();
    let error = null;
    const l = o.lock;
    if (isPlain(l) && typeof l.run_id === 'string' && RUN_ID_RE.test(l.run_id) && Number.isFinite(l.since) && (l.source === 'fire' || l.source === 'claim')) {
        if (l.since > nowMs) { error = '미래 시각의 잠금을 버림(' + l.run_id + ')'; console.error('[nariya_autorun] ' + error); }
        else s.lock = { run_id: l.run_id, since: l.since, source: l.source, taken: cleanReasons(l.taken), workNotified: l.workNotified === true, served: cleanServed(l.served), startedAt: Number.isFinite(l.startedAt) && l.startedAt <= l.since ? l.startedAt : l.since };
    }
    const p = o.pending;
    if (isPlain(p)) {
        const reasons = cleanReasons(p.reasons);
        if (Object.keys(reasons).length) s.pending = { reasons, since: Number.isFinite(p.since) ? p.since : null, lastAt: Number.isFinite(p.lastAt) ? p.lastAt : null };
    }
    if (Array.isArray(o.inFlight)) {
        for (const f of o.inFlight) {
            if (!isPlain(f) || typeof f.run_id !== 'string' || !RUN_ID_RE.test(f.run_id) || !Number.isFinite(f.since) || f.since > nowMs) continue;
            const e = { run_id: f.run_id, pr_url: typeof f.pr_url === 'string' && PR_URL_RE.test(f.pr_url) ? f.pr_url : null, amend_ids: cleanIds(f.amend_ids), fresh_ids: cleanIds(f.fresh_ids), mok_ids: cleanIds(f.mok_ids), since: f.since };
            if (e.amend_ids.length || e.fresh_ids.length || e.mok_ids.length) s.inFlight.push(e);
        }
    }
    if (Array.isArray(o.expired)) {
        s.expired = o.expired.filter((x) => isPlain(x) && typeof x.run_id === 'string' && RUN_ID_RE.test(x.run_id) && (x.source === 'fire' || x.source === 'claim'))
            .map((x) => ({ run_id: x.run_id, source: x.source, workNotified: x.workNotified === true, at: Number.isFinite(x.at) ? x.at : null, served: cleanServed(x.served), startedAt: Number.isFinite(x.startedAt) ? x.startedAt : null })).slice(-KEEP.expired);
    }
    if (Array.isArray(o.unknownFires)) {
        s.unknownFires = o.unknownFires.filter((x) => isPlain(x) && typeof x.run_id === 'string' && RUN_ID_RE.test(x.run_id) && Number.isFinite(x.at) && x.at <= nowMs)
            .map((x) => ({ run_id: x.run_id, at: x.at, reasons: cleanReasons(x.reasons) })).slice(-KEEP.unknown);
    }
    if (Array.isArray(o.doneIds)) s.doneIds = o.doneIds.filter((x) => typeof x === 'string' && RUN_ID_RE.test(x)).slice(-KEEP.done);
    if (Array.isArray(o.seen)) {
        s.seen = o.seen.filter((x) => isPlain(x) && KINDS[x.kind] && typeof x.id === 'string' && ITEM_ID_RE.test(x.id) && Number.isFinite(x.at) && x.at <= nowMs)
            .map((x) => ({ kind: x.kind, id: x.id, at: x.at, ttl: Number.isFinite(x.ttl) && x.ttl > 0 && x.ttl <= SEEN_TTL_MS ? x.ttl : SEEN_TTL_MS })).slice(-KEEP.seen);
    }
    if (isPlain(o.lastFire)) s.lastFire = o.lastFire;
    if (isPlain(o.lastDone)) s.lastDone = o.lastDone;
    if (isPlain(o.lastSweep)) s.lastSweep = o.lastSweep;
    return { state: s, error };
}

/** 사유 → 사람이 읽을 글. 예: {amend:3, fresh:2} → '개정 승인 3건 · 원문 구버전·이름바뀜·다시 뜬 카드 2건'. @param {object} r @returns {string} */
function reasonText(r) {
    const parts = Object.keys(KINDS).filter((k) => r && r[k] > 0).map((k) => KINDS[k] + ' ' + r[k] + '건');
    return parts.length ? parts.join(' · ') : '사유 없음';
}
/** 글에서 제어문자·방향 바꿈 문자를 빼고 자른다. 예: clean('a‮b\u0007', 10) → 'ab'. @param {string} t @param {number} n @returns {string} */
function cleanText(t, n) { return String(t).replace(UNSAFE_CHARS_RE, '').slice(0, n); }

/**
 * done 본문을 검사해 실을 것만 남긴다. run_id·outcome·id 목록 꼴이 틀리면 거절, 글은 상한까지 자르고 위험 문자를 뺀다.
 * 예: {run_id:'ar-1', outcome:'pr', pr_url:'https://evil.com/x', summary:'…5000자'} → {ok:true, value:{…, pr_url:null, summary:'…2000자'}}
 * @param {*} body @returns {{ok:true, value:object}|{ok:false, error:string}}
 * [연계] ← done / 검사
 */
function validateDone(body) {
    if (!isPlain(body)) return { ok: false, error: '본문이 객체가 아닙니다.' };
    if (typeof body.run_id !== 'string' || !RUN_ID_RE.test(body.run_id)) return { ok: false, error: 'run_id 가 없거나 형식이 틀렸습니다(영문·숫자·._:- 64자 이하).' };
    if (!['pr', 'nothing', 'failed'].includes(body.outcome)) return { ok: false, error: "outcome 은 'pr'|'nothing'|'failed' 중 하나여야 합니다." };
    const ids = {};
    for (const k of ['amend_ids', 'fresh_ids', 'mok_ids', 'conflict_ids', 'answer_ids', 'deferred_amend_ids', 'deferred_fresh_ids', 'deferred_mok_ids', 'deferred_conflict_ids', 'deferred_answer_ids']) {
        const a = body[k];
        if (a === undefined || a === null) { ids[k] = []; continue; }
        if (!Array.isArray(a) || a.length > LIMITS.ids || !a.every((x) => typeof x === 'string' && ITEM_ID_RE.test(x))) {
            return { ok: false, error: `${k} 는 id 문자열 배열(각 [A-Za-z0-9._:-] 80자 이하, 최대 ${LIMITS.ids}개)이어야 합니다.` };
        }
        ids[k] = [...new Set(a)];
    }
    // 앞뒤 공백·끝 '/' 는 떼고 본다(적대검증 C#중-5 — 줄바꿈 하나로 PR 주소를 잃으면 「앱에서 머지 버튼」 푸시가 카드 없는 막다른 길이 된다).
    const prRaw = typeof body.pr_url === 'string' ? body.pr_url.trim().replace(/\/+$/, '') : '';
    const pr_url = PR_URL_RE.test(prRaw) ? prRaw : null;
    const summary = typeof body.summary === 'string' ? cleanText(body.summary, LIMITS.summary) : '';
    const needs_decision = Array.isArray(body.needs_decision)
        ? body.needs_decision.filter((x) => typeof x === 'string').map((x) => cleanText(x, LIMITS.needsLen)).filter((x) => x.trim()).slice(0, LIMITS.needsCount)
        : [];
    // needs_options(2026-11-18 사용자 「추천안을 버튼으로」) — 결정 필요마다 세션이 고른 답 보기 2~4개(첫 칸이 추천). needs_decision 과 같은 순서, 없으면 빈 칸.
    const needs_options = needs_decision.map((_, i) => (Array.isArray(body.needs_options) && Array.isArray(body.needs_options[i])
        ? body.needs_options[i].filter((x) => typeof x === 'string').map((x) => cleanText(x, 80)).filter((x) => x.trim()).slice(0, 4) : []));
    return { ok: true, value: { run_id: body.run_id, outcome: body.outcome, pr_url, summary, needs_decision, needs_options, amend_ids: ids.amend_ids, fresh_ids: ids.fresh_ids, mok_ids: ids.mok_ids, deferred_amend_ids: ids.deferred_amend_ids, deferred_fresh_ids: ids.deferred_fresh_ids, deferred_mok_ids: ids.deferred_mok_ids, conflict_ids: ids.conflict_ids, deferred_conflict_ids: ids.deferred_conflict_ids, answer_ids: ids.answer_ids, deferred_answer_ids: ids.deferred_answer_ids } };
}

/**
 * 두 열쇠를 같은가 본다 — 양쪽 sha256 다이제스트를 timingSafeEqual 로 비교(길이 정보도 새지 않는다).
 * 기대 열쇠가 32자 미만이면 언제나 false(없는 것으로 본다).
 * 예: sameKey('a'.repeat(32), 'a'.repeat(32)) → true · sameKey('abc','abc') → false(짧음)
 * @param {string} given @param {string} expected @returns {boolean}
 * [연계] ← requireAutomation · requireAdminOrAutomation
 */
function sameKey(given, expected) {
    if (typeof given !== 'string' || typeof expected !== 'string' || !given || expected.length < MIN_TOKEN_LEN) return false;
    const a = crypto.createHash('sha256').update(given).digest(), b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b);
}

/**
 * 자동 반영기를 만든다. 검사는 시계·타이머·fetch·푸시·파일·환경 변수·관리자 열쇠를 바꿔 넣는다(기본값은 실제 것).
 * @param {object} [o]
 * @param {string} [o.file] - 상태 파일 @param {function} [o.now] - ms @param {function} [o.setTimer] @param {function} [o.clearTimer]
 * @param {function} [o.fetch] - (url, init) → Promise<Response> @param {function} [o.push] - (title, body, data) → Promise
 * @param {object} [o.env] - 환경 변수(요청 때마다 읽는다) @param {function} [o.adminCheck] - Express 미들웨어(관리자 토큰)
 * @returns {object} requestRun·fire·claim·done·status·start·hiddenIds·requireAutomation·requireAdminOrAutomation
 * [연계] ← forDefault(운영 싱글톤) · scripts/test_nariya_autorun.js
 */
function createAutorun({
    file = DEFAULT_FILE,
    now = Date.now,
    setTimer = (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; },
    clearTimer = (t) => clearTimeout(t),
    fetch: doFetch = (url, init) => fetch(url, init),
    push = (t, b, d) => require('./admin_push').sendAdminPush(t, b, d),
    env = process.env,
    adminCheck = (req, res, next) => require('./admin_auth').requireAdminToken(req, res, next),
    prMerger = null,   // 2026-11-16 C(조건부 자동 머지) — 기본은 services/nariya_pr_merge.forDefault()(지연 require). 시험은 가짜를 넣는다.
} = {}) {
    let state = null, debounce = null, debounceAt = null, lockTimer = null, firing = false, firingRunId = null;
    let readError = null, saveError = null, warnedUnconfigured = false, holdUntil = null, holdTimer = null;
    const doneSent = [];   // 완료 푸시를 보낸 시각(시간당 상한용, 이 프로세스 안에서만)

    function load() {
        if (!state) { const r = readState(file, now()); state = r.state; if (r.error) readError = { at: now(), error: r.error }; }
        return state;
    }
    /** 원자적으로 쓴다(임시 파일 → 이름 바꾸기). 실패해도 메모리 상태로 계속 간다(콘솔 한 줄 + status 에 오류). */
    function save() {
        const tmp = file + '.' + process.pid + '.tmp';
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
            fs.renameSync(tmp, file);
        } catch (e) {
            try { fs.unlinkSync(tmp); } catch (_) { /* 임시 파일이 안 생겼으면 지울 것도 없다 */ }
            saveError = { at: now(), error: String((e && e.message) || e).slice(0, 120) };
            console.error('[nariya_autorun] 상태 저장 실패(재시작하면 대기·잠금이 사라질 수 있음):', e && e.message);
        }
    }
    // 운영 = 운영 앱(seagnal-server)만. 스테이징도 Fly 머신이라 FLY_ALLOC_ID 로는 못 가른다(disk_usage.js 와 같은 까닭).
    const isProd = () => env.FLY_APP_NAME === PROD_APP;
    const configured = () => !!(env.NARIYA_ROUTINE_FIRE_URL && env.NARIYA_ROUTINE_TOKEN);
    /** 새 run_id. 예: 'ar-202611151230-1a2b'(KST 분 + 무작위 4자). */
    const newRunId = () => 'ar-' + iso(now()).slice(0, 16).replace(/[-T:]/g, '') + '-' + crypto.randomBytes(2).toString('hex');
    const lockValid = () => { const l = load().lock; return !!l && now() - l.since < LOCK_TTL_MS; };

    /**
     * 관리자 푸시(운영만). 개발·스테이징은 콘솔 한 줄(설계안 §5 #9). 실패는 콘솔에 남긴다.
     * @returns {Promise<{sent:boolean, error?:string}>} [연계] → push(admin_push.sendAdminPush)
     */
    async function notify(title, body, data) {
        if (!isProd()) { console.log('[nariya_autorun] 운영 아님 — 관리자 푸시 생략: ' + title + ' / ' + body); return { sent: false, error: '운영 아님' }; }
        try {
            const r = await push(title, body, data);
            if (!(r && r.sent > 0)) console.warn('[nariya_autorun] 푸시 전달 0건: ' + title);
            return { sent: !!(r && r.sent > 0) };
        } catch (e) {
            console.error('[nariya_autorun] 푸시 실패:', e && e.message);
            return { sent: false, error: String((e && e.message) || e).slice(0, 120) };
        }
    }

    /** 10분 타이머를 (다시) 건다 — 요청마다 처음부터. [연계] ← requestRun · done · start · claim(지움) */
    function armDebounce() {
        if (debounce) clearTimer(debounce);
        debounceAt = now() + DEBOUNCE_MS;
        debounce = setTimer(() => { debounce = null; debounceAt = null; fire().catch((e) => console.error('[nariya_autorun] 발사 오류:', e && e.message)); }, DEBOUNCE_MS);
    }
    function clearDebounce() { if (debounce) clearTimer(debounce); debounce = null; debounceAt = null; }
    /** 잠금 만료 타이머를 건다(남은 시간만큼). [연계] ← setLock · claim(심장박동) · start */
    function armLockTimer() {
        if (lockTimer) clearTimer(lockTimer);
        lockTimer = null;
        const l = load().lock;
        if (!l) return;
        const left = Math.max(0, Math.min(LOCK_TTL_MS, l.since + LOCK_TTL_MS - now()));
        lockTimer = setTimer(() => { lockTimer = null; onLockExpired().catch((e) => console.error('[nariya_autorun] 잠금 만료 처리 오류:', e && e.message)); }, left);
    }
    /** 잠그고 파일에 남긴 뒤 3시간 만료 타이머를 건다. taken = 이 세션이 넘겨받은 대기 몫. [연계] ← fire(성공) · claim */
    function setLock(run_id, source, taken, workNotified, served, startedAt) {
        // startedAt: 그 run 이 처음 일을 시작한 시각(심장박동으로 바뀌는 since 와 다르다) — 자동 머지가 「그 세션이 만든 PR」인지 볼 때 쓴다(§9).
        load().lock = { run_id, since: now(), source, taken: Object.assign({}, taken || {}), workNotified: workNotified === true, served: cleanServed(served), startedAt: Number.isFinite(startedAt) ? startedAt : now() };
        save();
        armLockTimer();
    }
    /** 잠금을 풀고 만료 타이머를 지운다. 가져간 몫(taken)은 대기로 되돌리지 않는다(설계안 §4). [연계] ← done(같은 run) · expireIfStale */
    function clearLock() {
        load().lock = null;
        save();
        if (lockTimer) clearTimer(lockTimer);
        lockTimer = null;
    }

    /**
     * 잠금이 3시간을 넘겼으면 풀고 「이전 세션 응답 없음」 푸시 한 줄(설계안 §5 #5). 풀었으면 true.
     * @returns {boolean} [연계] ← onLockExpired · requestRun · claim · done
     */
    function expireIfStale() {
        const l = load().lock;
        if (!l || now() - l.since < LOCK_TTL_MS) return false;
        // 풀린 run 을 기억한다 — 그 세션이 살아 있다가 심장박동을 보내면 원래 출처·「작업 시작」 여부를 이어받게(§5 #21).
        const st = load();
        st.expired = st.expired.filter((x) => x.run_id !== l.run_id).concat([{ run_id: l.run_id, source: l.source, workNotified: l.workNotified === true, at: now(), served: cleanServed(l.served), startedAt: l.startedAt }]).slice(-KEEP.expired);
        markSeen(l.served, COOLDOWN_MS);   // 응답 없이 죽은 세션의 일은 3일 쉰다(다시 claim 하면 served 를 이어받는다)
        clearLock();
        console.warn('[nariya_autorun] 잠금 3시간 지남 — 해제: ' + l.run_id);
        notify('AI 챗봇 자동 반영 — 이전 세션 응답 없음', `세션(${l.run_id})이 3시간 동안 완료를 알리지 않아 잠금을 풀었습니다. 그 세션이 받은 일은 3일 쉰 뒤 새벽 「남은 일 점검」이 다시 넘깁니다.`, { type: 'nariya_autorun_stale', run_id: l.run_id });
        return true;
    }
    /** 잠금 만료 타이머가 울렸을 때 — 풀고, 대기가 있으면 발사(설계안 §5 #5). [연계] ← armLockTimer */
    async function onLockExpired() {
        if (expireIfStale()) return load().pending ? fire() : null;
        if (load().lock) armLockTimer();   // 타이머가 일찍 울렸거나 심장박동으로 늘었으면 남은 시간으로 다시 건다
        return null;
    }

    /**
     * 자동 반영을 요청한다. 사유를 대기(pending)에 더하고, 잠금이 없으면 10분 타이머를 다시 건다(요청마다 처음부터).
     * 잠금 중이면 타이머를 걸지 않는다 — done 이 오면 그때 건다(설계안 §4·§5 #1 #2 #4).
     * 운영인데 트리거 환경 변수가 없으면 이 프로세스의 첫 요청 때 「미설정」 푸시 1회(설계안 §5 #6b).
     * ids 를 주면(2026-11-16) **자동 세션이 이미 보고 남긴 id**(seen — 「결정 필요」로 둔 것)는 빼고 센다. 다 본 것이면
     * 대기에 넣지 않는다 — 사람이 정해야 할 같은 건으로 매일 세션을 다시 깨우지 않게. ids 를 안 주면 예전처럼 늘 넣는다.
     * 예: requestRun('amend', {count:3}) → 대기 {amend:3}, 10분 뒤 fire
     *     requestRun('fresh', {ids:['a','b']}) (a 는 본 것) → 대기 {fresh:1}
     * @param {'amend'|'fresh'} kind @param {{count?:number, ids?:string[]}} [detail]
     * @returns {{queued:boolean, locked:boolean, reasons:object, seen?:number}}
     * [연계] ← routes/legal.js(개정 승인) · services/admrul_fresh_scanner.js(구버전·다시 뜬 카드)
     *        · services/legal_amendment_scanner.js(감지 즉시 자동 승인, ids) · sweep(새벽 남은 일 점검, ids)
     */
    function requestRun(kind, detail) {
        if (!KINDS[kind]) throw Error('알 수 없는 kind: ' + kind);
        let n = detail && Number.isInteger(detail.count) && detail.count > 0 ? Math.min(detail.count, MAX_COUNT) : 1;
        const s = load();
        expireIfStale();
        let seenCount = 0;
        if (detail && Array.isArray(detail.ids)) {
            const ids = [...new Set(detail.ids.map(String))];
            const fresh = ids.filter((id) => !isSeen(kind, id));
            seenCount = ids.length - fresh.length;
            if (!fresh.length) return { queued: false, locked: lockValid(), reasons: s.pending ? Object.assign({}, s.pending.reasons) : {}, seen: seenCount };
            n = Math.min(fresh.length, MAX_COUNT);
        }
        const t = now();
        if (!s.pending) s.pending = { reasons: {}, since: t, lastAt: t };
        s.pending.reasons[kind] = Math.min(MAX_COUNT, (s.pending.reasons[kind] || 0) + n);
        s.pending.lastAt = t;
        save();
        if (isProd() && !configured() && !warnedUnconfigured) {
            warnedUnconfigured = true;
            notify('AI 챗봇 자동 반영 미설정', 'NARIYA_ROUTINE_FIRE_URL·NARIYA_ROUTINE_TOKEN 이 없어 세션을 깨울 수 없습니다 — 일은 대기에만 쌓입니다. Fly secrets 를 확인해 주세요.', { type: 'nariya_autorun_unconfigured' });
        }
        const locked = lockValid();
        if (!locked) armDebounce();
        return Object.assign({ queued: true, locked, reasons: Object.assign({}, s.pending.reasons) }, seenCount ? { seen: seenCount } : {});
    }

    /** 이 id 가 쉬는 중인가(seen — 결정 필요로 남김 14일 · 실패/응답 없음 3일). [연계] ← requestRun */
    function isSeen(kind, id) {
        const t = now();
        return load().seen.some((x) => x.kind === kind && x.id === id && t - x.at < x.ttl);
    }
    /**
     * id 묶음을 seen 에 ttl 동안 넣는다(같은 id 는 새 값으로 바꾼다). save 는 부른 쪽이 한다.
     * 예: markSeen({amend:['a'], fresh:[]}, COOLDOWN_MS)
     * [연계] ← done(deferred 14일 · failed 3일) · expireIfStale(3일)
     */
    function markSeen(ids, ttl) {
        const st = load(), t = now(), add = [];
        for (const k of Object.keys(KINDS)) for (const id of (ids && ids[k]) || []) add.push({ kind: k, id, at: t, ttl });
        if (!add.length) return;
        const keyOf = (x) => x.kind + '\u0000' + x.id, fresh = new Set(add.map(keyOf));
        st.seen = st.seen.filter((x) => !fresh.has(keyOf(x)) && t - x.at < x.ttl).concat(add).slice(-KEEP.seen);
    }

    /**
     * 자동 세션에 일 목록을 내줬다고 적는다(2026-11-16) — 지금 잠금(그 세션)의 served 에 id 를 더한다. 잠금이 없으면 아무것도 안 한다.
     * 그 세션이 done 을 보내면: 'pr'·'nothing' 이면 **served 중 deferred_*_ids 에 실은 것만** seen 14일(결정 필요 — 적대검증 #2),
     * 'failed' 면 served 전부 seen 3일(쉼 — #3). 손대지 않은 나머지는 seen 이 아니다(다음 새벽 점검이 다시 넘긴다).
     * 예: noteServed('amend', ['chg_1','chg_2'])
     * @param {'amend'|'fresh'} kind @param {string[]} ids @returns {boolean} 적었나
     * [연계] ← routes/legal.js wiki-brief-all · GET freshness(자동화 열쇠로 불렀을 때)
     */
    function noteServed(kind, ids) {
        if (!KINDS[kind] || !Array.isArray(ids)) return false;
        expireIfStale();
        const l = load().lock;
        if (!l || !lockValid()) return false;
        if (!l.served) l.served = { amend: [], fresh: [], mok: [], conflict: [], answer: [] };
        if (!l.served[kind]) l.served[kind] = [];
        l.served[kind] = cleanServed({ [kind]: l.served[kind].concat(ids.map(String)) })[kind];
        save();
        return true;
    }

    /**
     * 새벽 「남은 일 점검」(2026-11-16 사용자 확정 — 매일 고정 세션 대신). server.js 새벽 점검(runNariyaNightly, 03:00 · 하루 하나씩) 끝에서 부른다.
     *  · 잠금 중이면 아무것도 안 한다 — 일하는 세션이 남은 일을 전부 꺼내 간다(새로 깨우면 같은 일을 두 세션이 한다).
     *  · 대기(깨우기 실패로 남은 일)가 있으면 10분 타이머를 건다(이미 걸려 있으면 그대로).
     *  · 대기가 없으면 outstanding(승인했는데 반영 안 된 개정 · 대기 중인 원문신선도 카드, PR 진행 중인 것 빼고)을
     *    requestRun 에 ids 로 넘긴다 — 세션이 보고 남긴 것(seen)은 거기서 빠진다.
     * 이 점검이 없으면: 깨우기 실패·세션 실패로 남은 일이 다음 감지가 올 때까지(며칠~몇 주) 방치된다.
     * 예: sweep({amend:['chg_1'], fresh:[]}) → {action:'requested', amend:{queued:true,…}}
     * @param {{amend?:string[], fresh?:string[]}} outstanding @returns {object}
     * [연계] ← server.js runNariyaNightly(finally) — outstanding 은 collectOutstanding()
     */
    /**
     * 새벽 점검 사슬이 도는 동안 세션 깨우기를 붙든다(2026-11-16 적대검증 #4·#5) — 세션의 law.go.kr 수집이 서버 점검과 겹치지 않게.
     * 붙든 동안 대기는 쌓이고, 풀면 대기가 있고 잠금이 없을 때 10분 타이머를 건다. 6시간 뒤엔 저절로 푼다.
     * 예: setHold(true) … 점검 셋 … setHold(false)
     * @param {boolean} on @returns {{held:boolean}}
     * [연계] ← server.js runNariyaNightly(03:00)
     */
    function setHold(on) {
        if (holdTimer) clearTimer(holdTimer);
        holdTimer = null;
        if (on) {
            holdUntil = now() + HOLD_MAX_MS;
            holdTimer = setTimer(() => { holdTimer = null; setHold(false); }, HOLD_MAX_MS);
            return { held: true };
        }
        holdUntil = null;
        if (load().pending && !lockValid() && !debounce) armDebounce();
        return { held: false };
    }

    function sweep(outstanding) {
        expireIfStale();
        const s = load(), o = isPlain(outstanding) ? outstanding : {};
        const errs = Array.isArray(o.errors) ? o.errors.map((e) => cleanText(e, 160)).slice(0, 5) : [];
        const counts = {};
        for (const k of Object.keys(KINDS)) counts[k] = Array.isArray(o[k]) ? o[k].length : 0;
        let r;
        if (lockValid()) r = { action: 'locked', run_id: s.lock.run_id };
        else if (s.pending) { if (!debounce) armDebounce(); r = { action: 'pending', reasons: Object.assign({}, s.pending.reasons) }; }
        else {
            r = { action: 'none' };
            for (const k of Object.keys(KINDS)) {
                if (!counts[k]) continue;
                const q = requestRun(k, { ids: o[k] });
                r[k] = q;
                if (q.queued) r.action = 'requested';
                else if (r.action === 'none') r.action = 'seen';
            }
        }
        s.lastSweep = Object.assign({ at: now(), action: r.action, outstanding: counts }, errs.length ? { errors: errs } : {});
        save();
        // 목록을 못 읽은 것은 「남은 일 없음」이 아니다(L-291) — 알린다.
        if (errs.length) notify('AI 챗봇 자동 반영 — 남은 일 점검 실패', '남은 일 목록을 읽지 못했습니다(「남은 일 없음」이 아닙니다): ' + errs.join(' / ').slice(0, 200), { type: 'nariya_autorun_sweep_failed' });
        console.log(`[nariya_autorun] 남은 일 점검: ${r.action} (개정 ${counts.amend} · 원문신선도 ${counts.fresh} · 원문결손 ${counts.mok})`);
        return r;
    }

    /** 대기에서 r 만큼 뺀다(0 이하는 지우고, 다 비면 null). [연계] ← fire(성공) */
    function subtractPending(r) {
        const s = load();
        if (!s.pending) return;
        for (const k of Object.keys(r)) { s.pending.reasons[k] = (s.pending.reasons[k] || 0) - r[k]; if (s.pending.reasons[k] <= 0) delete s.pending.reasons[k]; }
        if (!Object.keys(s.pending.reasons).length) s.pending = null;
    }

    /**
     * 예약 작업 API 트리거를 부른다(설계안 §2). 운영 아님·환경 변수 없음·잠금 중·대기 없음·발사 중이면 부르지 않는다.
     * 성공 → 잠금(run_id = 신호에 실은 값, taken = 넘긴 몫) · 넘긴 만큼 대기에서 뺌 · 푸시② 「세션 시작」(세션 링크를 본문에).
     *        그새 다른 잠금이 유효하면 덮어쓰지 않고 그 사실을 기록·푸시에 표시(§5 #12).
     * 시간초과 → 「전달 여부 확인 불가」 · 대기 유지 · lastFire.unknown 에 run_id(그 run 이 claim 하면 늦게 성공 처리, §5 #11).
     * 실패 → 대기 유지 · 푸시② 「세션 전달 실패」(환경 변수 없음은 푸시 안 함). 자동 재시도 없음(§5 #6).
     * 예: await fire() → {fired:true, run_id:'ar-202611151230-1a2b', session_url:'https://claude.ai/code/…'}
     * @returns {Promise<object>}
     * [연계] ← armDebounce 타이머 · onLockExpired → fetch(NARIYA_ROUTINE_FIRE_URL) · notify
     */
    async function fire() {
        const s = load();
        if (!s.pending) return { fired: false, why: 'no_pending' };
        if (!isProd()) { console.log('[nariya_autorun] 운영 아님 — 세션 깨우기 생략: ' + reasonText(s.pending.reasons)); return { fired: false, why: 'dev' }; }
        if (lockValid()) return { fired: false, why: 'locked' };
        if (firing) return { fired: false, why: 'firing' };
        if (holdUntil && now() < holdUntil) { console.log('[nariya_autorun] 새벽 점검 중 — 세션 깨우기 보류(대기 유지): ' + reasonText(s.pending.reasons)); return { fired: false, why: 'held' }; }
        if (!configured()) {
            console.log('[nariya_autorun] NARIYA_ROUTINE_FIRE_URL·NARIYA_ROUTINE_TOKEN 없음 — 세션 깨우기 생략(대기 유지)');
            s.lastFire = { at: now(), ok: false, error: '환경 변수 없음', reasons: Object.assign({}, s.pending.reasons) };
            save();
            return { fired: false, why: 'no_env' };
        }
        const sent = Object.assign({}, s.pending.reasons);
        const run_id = newRunId();
        firing = true; firingRunId = run_id;
        // 지시문 전문은 싣지 않는다 — 신호 본문 크기 한도를 확인하지 못했다(설계안 §2·§7). 세션이 claim 뒤 서버에서 꺼내 간다.
        const text = `nariya-autorun run_id=${run_id} ` + Object.keys(KINDS).map((k) => k + '=' + (sent[k] || 0)).join(' ');
        let error = null, timedOut = false, session_url = null;
        try {
            const res = await doFetch(env.NARIYA_ROUTINE_FIRE_URL, {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + env.NARIYA_ROUTINE_TOKEN, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
                signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
            });
            if (!res || !res.ok) {
                error = 'HTTP ' + (res ? res.status : '응답 없음');
                console.error('[nariya_autorun] 세션 깨우기 실패(대기 유지):', error);
            } else {
                let j = null;
                // 본문이 JSON 이 아니어도 2xx 면 전달된 것으로 본다(설계안 §7) — 세션 링크만 빠진다.
                try { j = await res.json(); } catch (e) { console.warn('[nariya_autorun] 트리거 응답이 JSON 이 아님 — 세션 링크 없이 계속:', e && e.message); }
                if (j && typeof j.claude_code_session_url === 'string' && /^https:\/\//.test(j.claude_code_session_url)) session_url = j.claude_code_session_url.slice(0, 300);
            }
        } catch (e) {
            timedOut = !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');
            error = timedOut ? '시간초과' : '연결 실패: ' + String((e && e.message) || e).slice(0, 80);
            console.error('[nariya_autorun] 세션 깨우기 ' + (timedOut ? '— 전달 여부 확인 불가(대기 유지):' : '실패(대기 유지):'), error);
        } finally { firing = false; firingRunId = null; }

        // 응답이 시간초과·오류로 끝났어도 그 사이 그 세션이 claim 해 잠금을 쥐었거나 이미 done 했으면 전달된 것이다(§5 #24).
        const confirmed = (s.lock && s.lock.run_id === run_id) || s.doneIds.includes(run_id);
        if (error && confirmed) {
            s.lastFire = { at: now(), ok: true, run_id, session_url: null, reasons: sent, confirmedByClaim: true, responseError: error };
            save();
            await notify('AI 챗봇 자동 반영 — 세션 시작(확인됨)', `예약 작업 API 응답은 ${error}였지만 세션(${run_id})이 이미 일을 시작해 전달된 것으로 확인했습니다. ${reasonText(sent)}.`,
                { type: 'nariya_autorun_started', run_id, confirmed: 'true' });
            return { fired: true, run_id, confirmedByClaim: true };
        }
        if (timedOut) {
            s.lastFire = { at: now(), ok: false, unknown: true, run_id, error, reasons: sent };
            // 불명 run 은 최근 5개·3시간까지 기억한다 — 그 사이 다른 발사가 lastFire 를 덮어써도 늦은 claim 을 알아보게(§5 #23).
            s.unknownFires = s.unknownFires.filter((x) => now() - x.at < LOCK_TTL_MS).concat([{ run_id, at: now(), reasons: sent }]).slice(-KEEP.unknown);
            save();
            await notify('AI 챗봇 자동 반영 — 세션 전달 여부 확인 불가(시간초과)',
                `예약 작업 API 가 ${FIRE_TIMEOUT_MS / 1000}초 안에 답하지 않았습니다. 세션이 떴다면 일을 시작할 때 「늦게 확인됨」으로 다시 알립니다. 대기 중인 일(${reasonText(s.pending ? s.pending.reasons : sent)})은 남겨 둡니다.`,
                { type: 'nariya_autorun_fire_unknown', run_id });
            return { fired: false, why: 'timeout', run_id };
        }
        if (error) {
            s.lastFire = { at: now(), ok: false, run_id, error, reasons: sent };
            save();
            await notify('AI 챗봇 자동 반영 — 세션 전달 실패', `${error}. 대기 중인 일(${reasonText(s.pending ? s.pending.reasons : sent)})은 남겨 둡니다 — 다음 요청이나 새벽 「남은 일 점검」이 이어받습니다.`,
                { type: 'nariya_autorun_fire_failed', run_id });
            return { fired: false, why: 'error', error };
        }
        const link = session_url ? ' 세션: ' + session_url : '';
        if (s.doneIds.includes(run_id)) {
            // 응답보다 먼저 그 세션이 claim·done 까지 끝냈다 — 다시 잠그거나 대기를 깎지 않는다(§5 #25).
            s.lastFire = { at: now(), ok: true, run_id, session_url, reasons: sent, alreadyDone: true };
            save();
            console.log('[nariya_autorun] 발사 응답 전에 세션이 이미 끝남 — 잠그지 않음: ' + run_id);
            return { fired: true, run_id, session_url, alreadyDone: true };
        }
        const l = s.lock;
        if (l && lockValid() && l.run_id !== run_id) {
            // 발사하는 사이 다른 잠금이 생겼다 — 덮어쓰지 않는다. 대기도 그대로(그 잠금의 done 뒤 다시 돈다).
            s.lastFire = { at: now(), ok: true, run_id, session_url, reasons: sent, lockConflict: l.run_id };
            save();
            await notify('AI 챗봇 자동 반영 — 세션 시작(잠금 충돌)', `${reasonText(sent)}을 세션에 맡겼지만 다른 세션(${l.run_id})이 이미 잠금 중이라 잠금은 그대로 둡니다. 새 세션은 「진행 중」으로 끝날 수 있습니다.${link}`,
                Object.assign({ type: 'nariya_autorun_started', run_id, lock_conflict: l.run_id }, session_url ? { session_url } : {}));
            return { fired: true, run_id, session_url, lockConflict: l.run_id };
        }
        s.lastFire = { at: now(), ok: true, run_id, session_url, reasons: sent };
        if (l && l.run_id === run_id) {
            // 세션이 응답보다 먼저 claim 했다 — 그때 대기를 이미 넘겨받았으므로(taken) 더 빼지 않는다.
            l.source = 'fire';
            save();
        } else {
            subtractPending(sent);
            setLock(run_id, 'fire', sent);   // save 포함
        }
        await notify('AI 챗봇 자동 반영 — 세션 시작', `${reasonText(sent)}을 클라우드 세션에 맡겼습니다. 끝나면 다시 알립니다.${link}`,
            Object.assign({ type: 'nariya_autorun_started', run_id }, session_url ? { session_url } : {}));
        return { fired: true, run_id, session_url };
    }

    /**
     * 세션이 일을 시작한다고 알린다(설계안 §4). run_id 필수.
     *  · 같은 run_id 가 이미 잠금 → 심장박동(lock.since 를 지금으로).
     *  · 다른 run 이 잠금 중이거나 발사 중(firing) → busy.
     *  · 잠금이 없으면 이 run 이 잠그고 그때의 대기를 넘겨받는다(lock.taken, 대기 비움 — 사용자 확정 ①).
     *    시간초과로 「전달 여부 불명」이던 run_id 면 서버가 깨운 run 으로 늦게 성공 처리(푸시 「늦게 확인됨」).
     *  · work:{amend,fresh} — 정기 세션(source claim)이 그 run 에서 처음으로 n+m>0 을 보내면 푸시② 「정기 세션 — 작업 시작」 1회.
     * 예: claim({run_id:'daily-1'}) (잠금 없음) → {ok:true, busy:false, run_id:'daily-1', taken:{amend:2}}
     * @param {{run_id:string, work?:{amend?:number, fresh?:number}}} body @returns {object}
     * [연계] ← routes/legal.js POST /api/legal/autorun/claim
     */
    function claim(body) {
        const given = isPlain(body) ? body.run_id : undefined;
        if (typeof given !== 'string' || !RUN_ID_RE.test(given)) return { ok: false, status: 400, error: 'run_id 가 없거나 형식이 틀렸습니다(영문·숫자·._:- 64자 이하).' };
        const w = isPlain(body.work) ? body.work : {};
        const num = (x) => (Number.isInteger(x) && x >= 0 && x <= MAX_COUNT ? x : 0);
        const work = Object.fromEntries(Object.keys(KINDS).map((k) => [k, num(w[k])]));   // 모든 일감 종류(conflict·answer 포함 — 적대검증 하)
        expireIfStale();
        const s = load(), l = s.lock;
        let result;
        if (l && lockValid()) {
            if (given !== l.run_id) return { ok: true, busy: true, lock: { run_id: l.run_id, since: iso(l.since), source: l.source } };
            l.since = now();   // 심장박동 — 오래 걸리는 회차가 3시간에 잘리지 않게
            save();
            armLockTimer();
            result = { ok: true, busy: false, run_id: given, heartbeat: true };
        } else {
            if (firing && given !== firingRunId) return { ok: true, busy: true, firing: true };
            // 3시간 만료로 풀렸던 run 이 다시 오면 원래 출처·「작업 시작」 여부를 이어받는다(§5 #21).
            const prev = s.expired.find((x) => x.run_id === given);
            const late = !prev && s.unknownFires.some((x) => x.run_id === given && now() - x.at < LOCK_TTL_MS);
            const source = prev ? prev.source : late || (firing && given === firingRunId) ? 'fire' : 'claim';
            const taken = s.pending ? Object.assign({}, s.pending.reasons) : {};
            s.pending = null;
            clearDebounce();
            if (prev) s.expired = s.expired.filter((x) => x.run_id !== given);
            if (late) {
                s.unknownFires = s.unknownFires.filter((x) => x.run_id !== given);
                if (s.lastFire && s.lastFire.run_id === given) { s.lastFire.unknown = false; s.lastFire.lateConfirmedAt = now(); }
            }
            setLock(given, source, taken, prev ? prev.workNotified : false, prev ? prev.served : null, prev ? prev.startedAt : undefined);   // save 포함 · 만료로 풀렸던 run 은 내준 목록을 이어받는다(적대검증 #6)
            if (late) {
                notify('AI 챗봇 자동 반영 — 세션 시작(늦게 확인됨)', `시간초과로 확인하지 못했던 세션(${given})이 일을 시작했습니다. ${reasonText(taken)}. 끝나면 다시 알립니다.`,
                    { type: 'nariya_autorun_started', run_id: given, late: 'true' });
            }
            result = Object.assign({ ok: true, busy: false, run_id: given, taken }, prev ? { relocked: true } : {});
        }
        const lk = load().lock;
        if (lk.source === 'claim' && !lk.workNotified && work.amend + work.fresh + work.mok > 0) {
            lk.workNotified = true;
            save();
            notify(`AI 챗봇 자동 반영 — 작업 시작(직접 실행 · 개정 ${work.amend}·원문신선도 ${work.fresh}·원문결손 ${work.mok})`, '서버가 깨우지 않은 세션(예약 작업 「지금 실행」 등)이 반영할 일을 찾아 시작했습니다. 끝나면 다시 알립니다.',
                { type: 'nariya_autorun_daily_started', run_id: lk.run_id, amend: String(work.amend), fresh: String(work.fresh), mok: String(work.mok) });
        }
        return result;
    }

    /** 완료 푸시 — 시간당 상한을 넘으면 콘솔만. @returns {boolean} 보냈나(보내기 시작했나) [연계] ← done */
    function notifyDone(title, body, data) {
        const t = now();
        while (doneSent.length && t - doneSent[0] >= 3600000) doneSent.shift();
        if (doneSent.length >= DONE_PUSH_PER_HOUR) { console.warn(`[nariya_autorun] 완료 푸시 시간당 ${DONE_PUSH_PER_HOUR}통 넘음 — 콘솔만: ` + title); return false; }
        doneSent.push(t);
        notify(title, body, data);
        return true;
    }

    /**
     * 세션의 결과 보고(설계안 §3·§4). 응답은 푸시를 기다리지 않는다.
     *  · 같은 run_id 를 또 보내면 아무것도 바꾸지 않고 {duplicate:true}(§5 #13).
     *  · 잠금과 같은 run → 잠금 해제(가져간 몫은 되돌리지 않는다). 다른 run 이 잠금 중 → 잠금 유지 + 「잠금과 다른 run」.
     *    잠금이 없음(만료 뒤) → 「늦은 완료」.
     *  · outcome 'pr' + id 목록 → inFlight 에 남겨 자동 세션에서 숨긴다(§4).
     *  · 잠금이 없고 대기가 있으면 10분 타이머(§5 #4 · #14).
     *  · 정기 세션(source claim)의 'nothing' 은 푸시 안 함(§5 #15). 그 밖은 푸시③(시간당 10통 상한).
     * 예: done({run_id:'ar-1', outcome:'pr', pr_url:'https://github.com/cantatapream/SEAGNAL/pull/9'}) → {ok:true, released:true, …}
     * @param {*} body @returns {object}
     * [연계] ← routes/legal.js POST /api/legal/autorun/done → validateDone · notifyDone
     */
    function done(body) {
        const v = validateDone(body);
        if (!v.ok) return { ok: false, status: 400, error: v.error };
        const d = v.value, s = load();
        // 중복 판정은 최근 끝난 run 20개로 한다(§5 #13) — 한 칸(lastDone)이면 두 run 이 번갈아 보낸 재전송을 놓친다.
        if (s.doneIds.includes(d.run_id) || (s.lastDone && s.lastDone.run_id === d.run_id)) return { ok: true, duplicate: true };
        const l = s.lock;
        let released = false, lockMismatch = false, late = false, source = null, workNotified = false, servedOf = null, runSince = null;
        if (l && l.run_id === d.run_id) {
            // 같은 run 이면 3시간을 넘겼어도 그냥 푼다(「응답 없음」 푸시를 보낼 까닭이 없다).
            released = true; source = l.source; workNotified = l.workNotified === true;   // 잠금을 풀기 전 값
            servedOf = l.served; runSince = l.startedAt;
            clearLock();
        } else {
            expireIfStale();
            if (lockValid()) lockMismatch = true; else late = true;
            // 3시간 만료 뒤 늦게 온 done — 만료 기록에 남겨 둔 내준 목록을 쓴다(적대검증 #6).
            const ex = s.expired.find((x) => x.run_id === d.run_id);
            if (late && ex) { servedOf = ex.served; runSince = ex.startedAt; }
        }
        // 내준 일 처리(2026-11-16): 결정 필요(deferred)로 실은 것만 14일 · 실패면 전부 3일 쉼. PR 에 실린 id 는 inFlight 가 따로 숨긴다.
        if (servedOf) {
            if (d.outcome === 'failed') markSeen(servedOf, COOLDOWN_MS);
            else {
                const inS = (k, a) => a.filter((id) => (servedOf[k] || []).includes(id));
                markSeen({ amend: inS('amend', d.deferred_amend_ids), fresh: inS('fresh', d.deferred_fresh_ids), mok: inS('mok', d.deferred_mok_ids), conflict: inS('conflict', d.deferred_conflict_ids), answer: inS('answer', d.deferred_answer_ids) }, SEEN_TTL_MS);
            }
        }
        s.lastDone = { at: now(), run_id: d.run_id, outcome: d.outcome, pr_url: d.pr_url, summary: d.summary, needs_decision: d.needs_decision,
            amend: d.amend_ids.length, fresh: d.fresh_ids.length, mok: d.mok_ids.length, source, lockMismatch, late };
        s.doneIds = s.doneIds.concat([d.run_id]).slice(-KEEP.done);
        s.expired = s.expired.filter((x) => x.run_id !== d.run_id);
        if (d.outcome === 'pr' && (d.amend_ids.length || d.fresh_ids.length || d.mok_ids.length) && !s.inFlight.some((f) => f.run_id === d.run_id)) {
            s.inFlight.push({ run_id: d.run_id, pr_url: d.pr_url, amend_ids: d.amend_ids, fresh_ids: d.fresh_ids, mok_ids: d.mok_ids, since: now() });
        }
        save();
        if (!lockValid() && s.pending && !debounce) armDebounce();

        // C(사용자 「C로 하자」): PR 을 냈으면 머지 담당에게 넘긴다 — 결정 필요 0건이면 검사 통과 뒤 서버가 자동 머지, 아니면 앱 머지 버튼 몫.
        //   잠금 주인(released)이었거나 3시간 만료 뒤 같은 run 의 늦은 완료일 때만 자동 머지 후보다(적대검증 C#상-2 — 아무 run_id 로 남의 PR 을 맡기지 못하게).
        let prMode = null, prWhy = null, prHow = null, prStatus = null;
        if (d.outcome === 'pr' && d.pr_url) {
            try {
                const t = (prMerger || require('./nariya_pr_merge').forDefault()).track({ pr_url: d.pr_url, run_id: d.run_id, needs_decision: d.needs_decision, needs_options: d.needs_options, summary: d.summary },
                    { owner: servedOf !== null && Number.isFinite(runSince), runSince });
                prMode = t.tracked ? t.mode : null; prWhy = t.why || null; prHow = t.how || null; prStatus = t.status || null;
                if (!t.tracked) prWhy = t.why || 'PR 을 맡지 못함';
            } catch (e) { console.error('[nariya_autorun] PR 머지 담당에게 넘기기 실패(완료 처리는 정상):', e && e.message); prWhy = '서버가 PR 을 맡지 못함'; }
        } else if (d.outcome === 'pr') prWhy = 'PR 주소를 읽지 못함';

        let pushed = false;
        // 정기 세션의 'nothing' 은 매일 소음이라 생략한다 — 단 그 run 에서 「작업 시작」을 이미 알렸거나(시작만 오고 끝이 안 오면 안 된다)
        // 사람이 정할 것(needs_decision)이 있으면 알린다(§5 #15·#20b).
        // 충돌 풀기 결과(conflict_ids — 푼 PR, deferred_conflict_ids — 기록 파일 말고 다른 파일도 겹쳐 손대지 않은 PR)는 머지 담당에게 넘긴다(2026-11-18).
        const cf = d.conflict_ids, cfd = d.deferred_conflict_ids;
        if (cf.length || cfd.length) {
            try { const mg = prMerger || require('./nariya_pr_merge').forDefault(); if (typeof mg.conflictResult === 'function') Promise.resolve(mg.conflictResult(cf, cfd)).catch((e) => console.error('[nariya_autorun] 충돌 결과 넘기기 실패:', e && e.message)); }
            catch (e) { console.error('[nariya_autorun] 충돌 결과 넘기기 실패(완료 처리는 정상):', e && e.message); }
        }
        // 결정 필요 답 처리 결과(answer_ids — 끝낸 답, deferred_answer_ids — 답대로 할 수 없어 남긴 답)도 머지 담당에게(앱 카드에 「처리됨·보류」).
        if (d.answer_ids.length || d.deferred_answer_ids.length) {
            try { const mg = prMerger || require('./nariya_pr_merge').forDefault(); if (typeof mg.answersResult === 'function') mg.answersResult(d.answer_ids, d.deferred_answer_ids); }
            catch (e) { console.error('[nariya_autorun] 답 처리 결과 넘기기 실패(완료 처리는 정상):', e && e.message); }
        }
        const quietNothing = released && source === 'claim' && d.outcome === 'nothing' && !workNotified && !d.needs_decision.length && !cf.length && !cfd.length && !d.answer_ids.length && !d.deferred_answer_ids.length;
        if (!quietNothing) {
            // 푸시 문구(사용자: 「머지를 앱에서 눌러야한다고 푸시 알림 내용에 명시하도록」) — 2026-11-18 다시 정리:
            //   ①「머지 버튼을 눌러 주세요」는 여기서 보내지 않는다 — 이 시점엔 GitHub 검사가 막 시작돼 버튼이 잠겨 있다(사용자가 가 보니 잠김).
            //     머지 담당이 검사를 지켜보다 초록이 되면 그때 보낸다(nariya_pr_merge.handOver ready). 여기서는 「반영 끝 · 검사 중」만.
            //   ② 쉬운 말만 — 세션 요약(파일 이름·영문이 섞임)·PR 주소는 PR 을 맡았을 때 넣지 않는다(앱 카드에 있다). 사용자 원문:
            //     *"사용자가 굳이 알 필요가 없는 뭐 어려운 명칭이라던가 영문이라던가 이런 거는 굳이 필요가 없지 않니?"*
            //   맡지 못했으면(주소 못 읽음·맡기 실패) 앱에 카드가 없으므로 PR 주소를 남기고 「GitHub 에서 확인」으로 쓴다(적대검증 C#중-5).
            // 「검사 중 — 끝나면 알림」은 머지 담당이 **지금 검사를 지켜보는** PR(waiting·failed_checks)에만 쓴다(적대검증 중1 — 이미 머지·닫힘 등이면 오지 않을 알림을 약속했다).
            const watching = prStatus === 'waiting' || prStatus === 'failed_checks';
            const tracked = watching && (prMode === 'auto' || (prMode === 'human' && prHow !== 'secrets'));
            const head = d.outcome === 'pr'
                ? (tracked ? '반영 끝 · 검사 중'
                    : prMode && prHow !== 'secrets' ? 'PR 올림 · 앱에서 확인해 주세요'
                    : prMode === 'human' ? 'PR 올림 · 서버 GitHub 열쇠 확인 필요'
                    : 'PR 을 맡지 못함 · GitHub 에서 확인해 주세요')
                : d.outcome === 'nothing' && cf.length ? '충돌 ' + cf.length + '건 풀었음 · 검사 중'
                : { nothing: '완료 — 반영할 것 없음', failed: '세션 실패' }[d.outcome];
            const needs = d.needs_decision.length ? ` · 결정 필요 ${d.needs_decision.length}건` : '';
            const tag = lockMismatch ? '[잠금과 다른 run] ' : late ? '[늦은 완료] ' : '';
            const cnt = [['개정', d.amend_ids.length], ['원문 새 판', d.fresh_ids.length], ['빠진 원문', d.mok_ids.length]].filter((x) => x[1]).map((x) => `${x[0]} ${x[1]}건`).join('·');
            let bodyText;
            if (d.outcome === 'pr' && tracked) {
                bodyText = (cnt ? cnt + ' ' : '') + '반영을 마치고 PR 을 올렸습니다. ' + (prMode === 'auto'
                    // 이 시점엔 바뀐 파일을 아직 안 봤다 — 프로그램 코드가 섞이면 머지 담당이 사람 몫으로 내린다. 「누를 것 없음」을 약속하지 않는다(2026-11-18 PR #1497 — 사용자 「머지 자동으로 된다는 말이 잘못된거니?」).
                    ? 'GitHub 검사(약 20분)가 끝나면 결과를 알려 드립니다 — 위키·원문만 바뀌었으면 서버가 자동으로 머지·배포하고, 프로그램 코드처럼 확인이 필요한 파일이 섞였으면 「앱에서 머지 버튼을 눌러 주세요」 알림이 갑니다.'
                    : `GitHub 검사(약 20분)가 끝나면 「앱에서 머지 버튼을 눌러 주세요」 알림을 다시 보냅니다${d.needs_decision.length ? `(결정 필요 ${d.needs_decision.length}건 — 앱 「자동반영」 방에서 볼 수 있습니다)` : ''}.`);
            } else if (d.outcome === 'pr' && prMode && prHow !== 'secrets') {
                bodyText = (prStatus === 'merged' ? '이 PR 은 이미 머지됐습니다.' : prStatus === 'closed' ? '이 PR 은 닫혀 있습니다.' : '이 PR 은 이미 사람 확인 차례입니다.') + ' 앱 → 관리자 → 「자동반영」 방에서 확인해 주세요.';
            } else if (d.outcome === 'pr' && prMode === 'human') {
                bodyText = 'PR 은 올렸지만 서버에 GitHub 머지 열쇠(Fly secrets GITHUB_MERGE_TOKEN)가 없어 자동 머지·머지 버튼이 동작하지 않습니다.';
            } else if (d.outcome === 'pr') {
                bodyText = (prWhy || 'PR 을 맡지 못함') + ' — 앱 「자동반영」 방에 카드가 없습니다. GitHub 에서 PR 을 직접 확인해 주세요.' + (d.pr_url ? ' PR: ' + d.pr_url : '');
            } else {
                const needsText = d.needs_decision.length
                    ? ` · 결정 필요 ${d.needs_decision.length}건: ` + d.needs_decision.slice(0, 3).map((x) => x.slice(0, 60)).join(' / ') + (d.needs_decision.length > 3 ? ' 외' : '')
                    : '';
                bodyText = d.outcome === 'nothing' && cf.length
                    ? 'PR #' + cf.join('·#') + ' 의 작업 기록 충돌을 풀어 올렸습니다. 검사(약 20분)가 끝나면 다시 알립니다.' + needsText
                    : (d.summary || SUMMARY_FALLBACK[d.outcome]).slice(0, 180) + needsText;
            }
            if (cfd.length) bodyText += ' · 충돌 ' + cfd.length + '건(PR #' + cfd.join('·#') + ')은 작업 기록 말고 다른 파일도 겹쳐 자동으로 풀지 않았습니다 — 앱 「자동반영」 방에서 확인해 주세요.';
            pushed = notifyDone(tag + 'AI 챗봇 자동 반영 — ' + head + needs, bodyText,
                Object.assign({ type: 'nariya_autorun_done', run_id: d.run_id, outcome: d.outcome, needs: String(d.needs_decision.length), lock_mismatch: String(lockMismatch), late: String(late), merge: String(prMode || '') },
                    d.pr_url ? { pr_url: d.pr_url } : {}));
        }
        return { ok: true, released, lockMismatch, late, pushQueued: pushed };
    }

    /**
     * 자동 세션에 숨길 id(PR 을 냈지만 아직 반영되지 않은 일)를 돌려준다. 읽을 때 정리한다:
     *  amend id 는 위키 반영 장부(applied)에 들어오면 빠진다.
     *  fresh id 는 **점검기가 「이제 현행」으로 자동으로 닫은 카드**(admrul_fresh_scanner.closeNowFresh 가 남기는 auto_closed:true · status 'done')일 때만 빠진다 —
     *  관리자가 손으로 닫은 것(처리완료·해당없음)은 「머지·재수집이 끝났다」는 증거가 아니라서 풀지 않는다(§4 D7). 다시 뜬 카드(pending)도 그대로 숨긴다.
     *  14일 지난 항목은 통째로 버린다. 넘겨준 정보의 갈래만 정리한다(applied 만 주면 amend 만).
     * 예: hiddenIds({freshCards:new Map([['adf_a',{status:'done', auto_closed:true}]])}) → adf_a 는 빠진다
     *  mok id(2026-11-16)는 **결손 점검기가 「더는 누락 아님」으로 자동으로 닫은 카드**(mok_audit_scanner.autoResolveCleared 의 auto_resolved:true)일 때만 빠진다.
     * @param {{applied?:Map<string,*>, freshCards?:Map<string,{status?:string, auto_closed?:boolean}>, mokCards?:Map<string,{status?:string, auto_resolved?:boolean}>}} [ctx] @returns {{amend:Set<string>, fresh:Set<string>, mok:Set<string>}}
     * [연계] ← routes/legal.js wiki-brief-all(applied) · GET freshness(freshCards) — 자동화 열쇠로 부를 때만
     */
    function hiddenIds(ctx) {
        const s = load(), t = now(), c = ctx || {};
        const before = JSON.stringify(s.inFlight);
        s.inFlight = s.inFlight.filter((f) => t - f.since < INFLIGHT_TTL_MS).map((f) => ({
            ...f,
            amend_ids: c.applied ? f.amend_ids.filter((id) => !c.applied.has(id)) : f.amend_ids,
            fresh_ids: c.freshCards ? f.fresh_ids.filter((id) => { const e = c.freshCards.get(id); return !(e && (e.status || 'pending') !== 'pending' && e.auto_closed === true); }) : f.fresh_ids,
            mok_ids: c.mokCards ? (f.mok_ids || []).filter((id) => { const e = c.mokCards.get(id); return !(e && (e.status || 'pending') !== 'pending' && e.auto_resolved === true); }) : (f.mok_ids || []),
        })).filter((f) => f.amend_ids.length || f.fresh_ids.length || f.mok_ids.length);
        if (JSON.stringify(s.inFlight) !== before) save();
        const out = { amend: new Set(), fresh: new Set(), mok: new Set() };
        for (const f of s.inFlight) { f.amend_ids.forEach((id) => out.amend.add(id)); f.fresh_ids.forEach((id) => out.fresh.add(id)); f.mok_ids.forEach((id) => out.mok.add(id)); }
        return out;
    }

    /**
     * 잠금·대기·진행 중 PR·마지막 실행·파일 오류(열쇠 값은 싣지 않고 「있다/없다」만). 상태를 바꾸지 않는다.
     * @returns {object} [연계] ← routes/legal.js GET /api/legal/autorun/status
     */
    function status() {
        const s = load(), l = s.lock, valid = lockValid();
        const t = (o) => (o ? Object.assign({}, o, { at: iso(o.at) }) : null);
        return {
            production: isProd(),
            configured: { fireUrl: !!env.NARIYA_ROUTINE_FIRE_URL, routineToken: !!env.NARIYA_ROUTINE_TOKEN, automationToken: (env.NARIYA_AUTOMATION_TOKEN || '').length >= MIN_TOKEN_LEN },
            lock: l ? { run_id: l.run_id, source: l.source, since: iso(l.since), expiresAt: iso(l.since + LOCK_TTL_MS), valid, taken: l.taken } : null,
            pending: s.pending ? { reasons: s.pending.reasons, text: reasonText(s.pending.reasons), since: iso(s.pending.since), lastAt: iso(s.pending.lastAt), fireAt: valid ? null : iso(debounceAt) } : null,
            inFlight: s.inFlight.map((f) => ({ run_id: f.run_id, pr_url: f.pr_url, amend: f.amend_ids.length, fresh: f.fresh_ids.length, mok: f.mok_ids.length, since: iso(f.since) })),
            firing,
            lastFire: t(s.lastFire),
            lastDone: t(s.lastDone),
            lastSweep: t(s.lastSweep),
            seen: s.seen.filter((x) => now() - x.at < x.ttl).length,
            hold: holdUntil && now() < holdUntil ? iso(holdUntil) : null,
            errors: { read: readError && { at: iso(readError.at), error: readError.error }, save: saveError && { at: iso(saveError.at), error: saveError.error } },
        };
    }

    /**
     * 서버 시작 때 파일에서 되살린다 — 잠금이 있으면 남은 시간으로 만료 타이머(만료됐으면 곧 그 경로가 발사까지),
     * 잠금이 없고 대기가 있으면 10분 타이머(§5 #3). 자동화 열쇠가 32자 미만이면 콘솔 경고.
     * @returns {{pending:boolean, lock:boolean}} [연계] ← server.js 시작
     */
    function start() {
        const s = load();
        const tok = env.NARIYA_AUTOMATION_TOKEN || '';
        if (tok && tok.length < MIN_TOKEN_LEN) console.warn(`[nariya_autorun] NARIYA_AUTOMATION_TOKEN 이 ${MIN_TOKEN_LEN}자보다 짧아 없는 것으로 봅니다 — 자동화 경로는 전부 401.`);
        if (s.lock) armLockTimer();
        else if (s.pending) armDebounce();
        if (s.pending || s.lock) console.log(`[nariya_autorun] 복원 — 대기: ${s.pending ? reasonText(s.pending.reasons) : '없음'} · 잠금: ${s.lock ? s.lock.run_id : '없음'}`);
        return { pending: !!s.pending, lock: !!s.lock };
    }

    /** X-Automation-Token 이 NARIYA_AUTOMATION_TOKEN(32자 이상)과 같은가. 없거나 짧으면 언제나 false(§2 — 자동화 경로 전부 401). */
    const automationOk = (req) => sameKey(req.get('X-Automation-Token') || '', env.NARIYA_AUTOMATION_TOKEN || '');
    /** 자동화 열쇠만 받는 미들웨어. 틀리면 401. [연계] ← (검사) */
    function requireAutomation(req, res, next) {
        if (automationOk(req)) { req.viaAutomation = true; return next(); }
        return res.status(401).json({ error: '자동화 열쇠가 필요합니다.', code: 'AUTOMATION_AUTH_REQUIRED' });
    }
    /**
     * 자동화 열쇠가 맞으면 통과(req.viaAutomation = true — 라우트가 inFlight 를 숨기는 표시), 아니면 기존 관리자 토큰 검사로 넘긴다(관리자 동작 그대로).
     * [연계] ← routes/legal.js 다섯 경로 → admin_auth.requireAdminToken
     */
    function requireAdminOrAutomation(req, res, next) {
        if (automationOk(req)) { req.viaAutomation = true; return next(); }
        return adminCheck(req, res, next);
    }

    return { requestRun, fire, claim, done, status, start, hiddenIds, noteServed, sweep, setHold, requireAutomation, requireAdminOrAutomation, _state: () => load() };
}

/**
 * 새벽 「남은 일 점검」이 넘길 일 목록을 모은다(2026-11-16) — 자동 세션이 wiki-brief-all·freshness 에서 받는 것과 **같은 거름**:
 *  개정 = 승인됐고 · 위키 반영 장부에 없고 · PR 진행 중(inFlight)이 아닌 것 / 원문신선도·원문결손 = 대기(pending)이고 · PR 진행 중이 아닌 것.
 * 파일을 못 읽으면 그 갈래는 빈 목록 + errors 에 까닭 — 점검이 죽어 다른 갈래까지 잃지 않게, 그리고 sweep 이 「못 읽음」을 알리게(L-291).
 * 예: collectOutstanding() → {amend:['chg_20261116_ab12'], fresh:[], mok:[], errors:[]}
 * @returns {{amend:string[], fresh:string[], mok:string[], errors:string[]}}
 * [연계] ← server.js runNariyaNightly → sweep · legal_amendment_scanner(queueFile·loadWikiApplied) · admrul_fresh_scanner(QUEUE_FILE) · legal_admin_queues.readJsonl
 */
function collectOutstanding() {
    const out = { amend: [], fresh: [], mok: [], errors: [] };
    const adminQueues = require('./legal_admin_queues');
    try {
        const sc = require('./legal_amendment_scanner'), applied = sc.loadWikiApplied();
        const hid = forDefault().hiddenIds({ applied });
        out.amend = adminQueues.readJsonl(sc.queueFile())
            .filter((e) => e && (e.status || 'pending') === 'approved' && !applied.has(String(e.id)) && !hid.amend.has(String(e.id)))
            .map((e) => String(e.id));
    } catch (e) { console.error('[nariya_autorun] 남은 일 점검 — 개정 목록을 못 읽음:', e && e.message); out.errors.push('개정: ' + String((e && e.message) || e)); }
    try {
        const fs2 = require('./admrul_fresh_scanner'), all = adminQueues.readJsonl(fs2.QUEUE_FILE);
        const hid = forDefault().hiddenIds({ freshCards: new Map(all.map((e) => [String(e.id), e])) });
        out.fresh = all.filter((e) => e && (e.status || 'pending') === 'pending' && !hid.fresh.has(String(e.id))).map((e) => String(e.id));
    } catch (e) { console.error('[nariya_autorun] 남은 일 점검 — 원문신선도 목록을 못 읽음:', e && e.message); out.errors.push('원문신선도: ' + String((e && e.message) || e)); }
    try {
        const ms = require('./mok_audit_scanner'), all = adminQueues.readJsonl(ms.QUEUE_FILE);
        const hid = forDefault().hiddenIds({ mokCards: new Map(all.map((e) => [String(e.id), e])) });
        out.mok = all.filter((e) => e && (e.status || 'pending') === 'pending' && !hid.mok.has(String(e.id))).map((e) => String(e.id));
    } catch (e) { console.error('[nariya_autorun] 남은 일 점검 — 원문결손 목록을 못 읽음:', e && e.message); out.errors.push('원문결손: ' + String((e && e.message) || e)); }
    return out;
}

/**
 * 오늘 새벽(03:00 KST) 돌릴 AI 챗봇 점검 하나를 고른다(2026-11-16 사용자 확정 — 하루 하나씩 돌려 가며).
 * 사용자 원문: 「그럼 격일마다 하도록 하자 하루 개정 하루는 결손 하루는 낡음 이런식으로 새벽 3시마다 돌아가게」
 * KST 날짜 번호(1970-01-01 부터 센 날 수)를 3으로 나눈 나머지로 고른다 — 서버를 다시 켜도, 하루를 걸러도 순서가 어긋나지 않는다.
 * 0 → 개정감지 · 1 → 원문결손 · 2 → 원문신선도(낡음). 셋 다 law.go.kr 을 두드려서 한 밤에 하나만 돌리면 겹칠 일이 없다.
 * 예: nightlyScanFor(Date.parse('2026-11-16T18:00:00Z')) → 2026-11-17 KST 의 몫
 * @param {number} ms 지금 시각(ms) @returns {'amend'|'mok'|'fresh'}
 * [연계] ← server.js runNariyaNightly(cron 03:00) · scripts/test_nariya_autorun.js
 */
function nightlyScanFor(ms) {
    const day = Math.floor((ms + 9 * 3600000) / 86400000);
    return ['amend', 'mok', 'fresh'][((day % 3) + 3) % 3];
}

/**
 * 새벽 점검 한 바퀴의 **처리 결과 요약 푸시** 글을 만든다(2026-11-17 사용자 「각 매일마다 모든 사이클이 완료되면 완료되었다는 푸시알림이
 * 왔으면 좋겠어」·「처리결과에 관한 알림 말이야」). 순수 함수 — 보내기는 server.js runNariyaNightly 가 한다.
 * 종전에는 점검이 새로 찾은 것이 있거나 실패할 때만 푸시가 가서, 아무것도 없는 밤은 조용했다 — 「이상 없음」과 「점검이 안 돌았음」이
 * 같아 보였다(L-291). 이제 매일 한 통: 오늘 차례 점검 결과 · 대기 개정 자동 승인 · 자동 반영 세션을 깨웠는지 · 내일 차례.
 * 세션이 일을 끝낸 결과(PR·자동 머지·앱 버튼 필요)는 그 시각에 따로 푸시된다(done·nariya_pr_merge) — 이 요약은 새벽 점검까지.
 * 예: nightlySummary({which:'fresh', scan:{ok:true, checked:1504, stale:0, added:0, reopened:0}, approved:0, sweep:{action:'none'}, tomorrow:'amend'})
 *     → {title:'AI 챗봇 새벽 점검 완료 — 원문신선도 · 이상 없음', body:'원문신선도: 1,504건 대조 · 낡은 원문 없음 …'}
 * @param {{which:'amend'|'mok'|'fresh', scan:?object, scanError?:string, approved?:number, sweep:?object, sweepError?:string, tomorrow?:string}} o
 * @returns {{title:string, body:string, failed:boolean}}
 * [연계] ← server.js runNariyaNightly · scripts/test_nariya_autorun.js
 */
function nightlySummary(o) {
    const NAME = { amend: '개정감지', mok: '원문결손', fresh: '원문신선도' };
    const nf = (n) => Number(n || 0).toLocaleString('ko-KR');
    const sc = o.scan || null;
    let line, found = 0, failed = false;
    if (o.scanError || !sc) { failed = true; line = '점검이 끝나지 못했습니다 — ' + String(o.scanError || '결과 없음').slice(0, 120); }
    else if (o.which === 'amend') {
        found = sc.changed || 0;
        failed = !!sc.errors;
        line = failed ? '오늘 개정 여부를 확인하지 못했습니다(「개정 없음」이 아닙니다)'
            : found ? `새 개정 ${nf(found)}건 감지 · 자동 승인` : `새 개정 없음(탐지 대기 ${nf(sc.scanned)}건 확인)`;
    } else if (sc.ok === false) { failed = true; line = '점검 실패 — ' + String(sc.error || '').slice(0, 120); }
    else if (o.which === 'mok') {
        found = (sc.added || 0) + (sc.reopened || 0);
        line = `${nf(sc.checked)}계열 대조 · ` + (found ? `빠진 곳 새로 ${nf(sc.added)}건${sc.reopened ? ` · 다시 뜬 ${nf(sc.reopened)}건` : ''}` : '새로 빠진 곳 없음')
            + (sc.resolved ? ` · 해소돼 닫은 ${nf(sc.resolved)}건` : '') + (sc.partialError ? ' · ⚠일부 못 봄' : '');
    } else {
        found = (sc.added || 0) + (sc.reopened || 0);
        line = `${nf(sc.checked)}건 대조 · ` + (found ? `낡은 원문 새로 ${nf(sc.added)}건${sc.reopened ? ` · 다시 뜬 ${nf(sc.reopened)}건` : ''}` : '새로 낡은 원문 없음')
            + (sc.autoClosed ? ` · 현행 확인돼 닫은 ${nf(sc.autoClosed)}건` : '') + (sc.unknown ? ` · 조회 실패 ${nf(sc.unknown)}건` : '') + (sc.partialError ? ' · ⚠일부 못 봄' : '');
    }
    const parts = [NAME[o.which] + ': ' + line];
    if (o.approved) parts.push(`대기 중이던 개정 ${nf(o.approved)}건 자동 승인`);
    const sw = o.sweep || null;
    const SW = {
        requested: '자동 반영 세션을 곧 깨웁니다(끝나면 결과를 다시 알립니다)',
        pending: '자동 반영 세션을 곧 깨웁니다(끝나면 결과를 다시 알립니다)',
        locked: '자동 반영 세션이 이미 일하는 중입니다',
        seen: '남은 일은 사장님 결정 대기뿐입니다(앱 → 관리자 → 「자동반영」)',
        none: '자동 반영할 일 없음',
    };
    if (o.sweepError) { failed = true; parts.push('⚠남은 일 점검 실패 — ' + String(o.sweepError).slice(0, 100)); }
    else if (sw && sw.errors) parts.push('⚠남은 일 목록 일부를 못 읽음');
    else if (sw) parts.push(SW[sw.action] || ('남은 일 점검: ' + sw.action));
    if (o.tomorrow && NAME[o.tomorrow]) parts.push('내일 차례: ' + NAME[o.tomorrow]);
    const work = sw && (sw.action === 'requested' || sw.action === 'pending');
    const head = failed ? '⚠확인 필요' : work ? '처리할 일 있음' : found ? '새로 찾음' : '이상 없음';
    return { title: `AI 챗봇 새벽 점검 완료 — ${NAME[o.which]} · ${head}`, body: parts.join(' · '), failed };
}

let def = null;
/** 운영 기본 인스턴스(data/nariya_autorun_state.json · 실제 시계·타이머·fetch·푸시). @returns {object} [연계] ← routes/legal.js · admrul_fresh_scanner · server.js */
function forDefault() { return def || (def = createAutorun()); }

module.exports = {
    createAutorun, forDefault, validateDone, sameKey, reasonText, cleanText,
    requestRun: (k, d) => forDefault().requestRun(k, d),
    claim: (b) => forDefault().claim(b),
    done: (b) => forDefault().done(b),
    status: () => forDefault().status(),
    start: () => forDefault().start(),
    hiddenIds: (c) => forDefault().hiddenIds(c),
    noteServed: (k, ids) => forDefault().noteServed(k, ids),
    sweep: (o) => forDefault().sweep(o),
    setHold: (on) => forDefault().setHold(on),
    collectOutstanding, nightlyScanFor, nightlySummary,
    requireAdminOrAutomation: (req, res, next) => forDefault().requireAdminOrAutomation(req, res, next),
    DEBOUNCE_MS, LOCK_TTL_MS, INFLIGHT_TTL_MS, DONE_PUSH_PER_HOUR, MIN_TOKEN_LEN, LIMITS, KINDS,
};
