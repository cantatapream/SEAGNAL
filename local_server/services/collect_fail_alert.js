/**
 * ============================================================================
 * 파일명: local_server/services/collect_fail_alert.js
 * 역할  : 이안류·기상청 MMIS 자료를 불렀는데 받아오지 못하면 관리자 휴대폰에 푸시를 보낸다.
 *         실패가 시작될 때 1번, 다시 받아지면 「복구」 1번. 같은 실패가 이어지는 동안은 다시 보내지 않는다.
 *         시정 예측(visibility)만 연속 3번 실패해야 보낸다(사용자 확정 2026-10-15, 아래 [사용자 결정]).
 * ----------------------------------------------------------------------------
 * [사용자 결정 2026-10-15 원문]
 *   「이안류, mmis는 데이터를 호출했을 때 받아올 수 없다면 그 때 알려줘 보통 천기가 그런 경우가 많아.」
 *   「추천하는 방식으로 하고. 고르는건 나로 하자.」 → 천기(시정 예측)는 (나) 연속 3번 실패하면.
 *
 * [어떻게 「한 번만」을 지키나 — 상태(state)이지 사건(event)이 아니다 (CLAUDE.md 결정로그 ①)]
 *   항목마다 「관리자가 지금 무엇을 알고 있나」(notified)를 파일에 남긴다. 보고가 올 때마다
 *   「지금 사실」(연속 실패 수가 기준 이상인가)과 비교해 다를 때만 푸시를 보낸다(settle).
 *     · 실패가 이어져도 이미 알렸으면(notified=true) 안 보낸다.
 *     · 복구 후 다시 실패하면 notified 가 false 로 돌아가 있으므로 다시 보낸다.
 *     · 푸시가 전달되지 않으면(0건 전달·예외) notified 를 바꾸지 않는다 → 다음 보고 때 다시 시도한다.
 *       실패는 콘솔과 상태 파일(pushError)에 남는다 — 조용히 삼키지 않는다.
 *   파일은 data/ (운영 영속 볼륨)라 재기동·배포 뒤에도 「이미 알렸다」가 유지된다.
 *
 * [연계]
 *  - 사용하는 파일 : services/admin_push.js sendAdminPush (운영 FLY_ALLOC_ID 일 때만 — 개발은 보내지 않고 콘솔 한 줄)
 *                    config/data_collection_manifest.json (항목 이름 — 데이터 수집현황 카드와 같은 이름)
 *  - 저장          : data/collect_fail_alert.json (검사는 COLLECT_FAIL_ALERT_FILE 또는 createAlerter({file}) 로 임시 경로)
 *  - 나를 부르는 곳 : scheduler.js(이안류·MMIS 관측 4종) · marine_warning_crawler.js(특보·강풍)
 *                    services/swell_smallzone.js(너울) · services/vsby_smallzone.js(시정 예측)
 *  - 나를 읽는 곳  : services/data_collection_status.js (수집 목록 카드의 「마지막 수집 실패」 한 줄)
 *  - 검사          : scripts/test_collect_fail_alert.js
 *  - 설계 문서     : 00_docs/operations/collect-fail-alert.md
 * [로드 순서] require 부작용 없음. 상태 파일은 첫 report/records 때 읽는다. 한 서버 프로세스 안에서만 쓴다
 *            (상태를 메모리에 들고 바꾼 뒤 파일에 쓴다 — 동시에 들어온 다른 항목 보고가 서로 덮어쓰지 않게).
 * ============================================================================
 */
'use strict';
const fs = require('fs'),
    path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data'),
    DEFAULT_FILE = process.env.COLLECT_FAIL_ALERT_FILE || path.join(DATA_DIR, 'collect_fail_alert.json'),
    MANIFEST = path.join(__dirname, '..', 'config', 'data_collection_manifest.json'),
    KST = 9 * 3600000;

// 알림 대상과 규칙. 열쇠 = 데이터 수집현황 목록표(manifest) 의 id.
//   threshold: 연속 몇 번 실패하면 알리나(없으면 1 = 첫 실패). visibility 의 3 은
//     risk_history_sources.VSBY_FAIL_STREAK(오류현황이 「수집 실패」로 보는 기준)와 같아야 한다 — 검사가 둘을 맞대 본다.
//   push:false: 기록만 하고 푸시는 보내지 않는다. 강풍(gale)은 특보(warnings)와 **같은 호출**에서 나오므로
//     (marine_client.fetchAllRealtimeEndpoints 한 번) 같은 장애에 푸시 2통이 가지 않게 특보 알림 한 통에 담는다(label).
const ITEMS = {
    ripCurrent: {},
    warnings: { label: '해상 특보·육상 강풍특보 (기상청 MMIS)' },
    gale: { push: false },
    swell: {},
    visibility: { threshold: 3 },
    marineBuoys: {},
    marineWhBuoys: {},
    marineLhBuoys: {},
    marineVs: {},
};

/** ms → 'MM/DD HH:mm' (KST). 예: 2026-10-15T18:00Z → '10/16 03:00'. @param {number} ms @returns {string} */
function fmtKst(ms) {
    if (!Number.isFinite(ms)) return '시각 모름';
    const d = new Date(ms + KST).toISOString();
    return d.slice(5, 7) + '/' + d.slice(8, 10) + ' ' + d.slice(11, 16);
}

/**
 * 오류를 관리자에게 보일 짧은 분류로 바꾼다. 원문(주소·키가 섞일 수 있다)은 푸시·파일에 넣지 않는다.
 * 예: Error('imgList 빈 응답 (HTTP 200, 0바이트, …)') → '빈 응답'
 *     SyntaxError('Unexpected end of JSON input') → '빈 응답 또는 잘린 응답'
 *     Error('HTTP 503') · Error('forecast-times 503') → 'HTTP 503'
 *     AbortError · 'network timeout at …' · ETIMEDOUT → '시간초과'
 *     Error('request to https://…?serviceKey=… failed, reason: getaddrinfo ENOTFOUND') → '연결 실패'
 * @param {*} err - Error 또는 문자열 @returns {string}
 * [연계] ← report / 수집기가 만든 오류문 꼴은 scheduler.js·vsby_smallzone.fetchImgList·swell_smallzone·marine_client 에서 확인
 */
function reasonOf(err) {
    const m = String((err && err.message) || err || ''),
        name = (err && err.name) || '';
    if (/빈 응답/.test(m)) return '빈 응답';
    if (/Unexpected end of JSON input/i.test(m)) return '빈 응답 또는 잘린 응답';
    if (name === 'AbortError' || (err && err.type === 'aborted') || /time ?out|timed ?out|aborted/i.test(m)) return '시간초과';
    if (name === 'SyntaxError' || /JSON 아님|JSON parse|Unexpected token/i.test(m)) return '응답 해석 실패';
    const http = /\bHTTP\s*(\d{3})\b/.exec(m) || /^(?:imgList|forecast-times|wfs|png) (\d{3})$/.exec(m);
    if (http) return 'HTTP ' + http[1];
    const code = /API (?:code|결과코드)=?\s*([\w-]{1,12})/.exec(m);
    if (code) return 'API 오류 코드 ' + code[1];
    if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|socket hang up|fetch failed|request to .* failed/i.test(m))
        return '연결 실패';
    return '기타 오류';
}

/** 항목 이름(관리자에게 보일 것). manifest name 을 쓰고 ITEMS.label 이 있으면 그것. [연계] ← message */
let _names = null;
function nameOf(id) {
    if (ITEMS[id] && ITEMS[id].label) return ITEMS[id].label;
    if (!_names) {
        _names = {};
        try {
            for (const it of JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).items || []) _names[it.id] = it.name;
        } catch (e) {
            console.error('[collect_alert] 목록표 이름을 읽지 못함 — 항목 열쇠로 대신 표시:', e.message);
        }
    }
    return _names[id] || id;
}

/** 빈 항목 상태. [연계] ← sanitize/report */
function blank() {
    return { streak: 0, since: null, reason: null, lastFailAt: null, okSince: null, notified: false, notifiedAt: null, pushError: null, pushErrorAt: null };
}
const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
/** 파일에서 읽은 한 항목을 검사해 모양을 맞춘다. 어긋난 칸은 비운다. @param {object} o @returns {object} */
function sanitize(o) {
    const s = blank();
    if (!o || typeof o !== 'object') return s;
    if (Number.isInteger(o.streak) && o.streak >= 0) s.streak = o.streak;
    for (const k of ['since', 'lastFailAt', 'okSince', 'notifiedAt', 'pushErrorAt']) s[k] = isIso(o[k]) ? o[k] : null;
    for (const k of ['reason', 'pushError']) s[k] = typeof o[k] === 'string' ? o[k].slice(0, 80) : null;
    s.notified = o.notified === true;
    return s;
}

/**
 * 상태 파일을 읽는다. 없으면 빈 상태, 형식이 어긋나면 콘솔에 남기고 빈 상태(→ 같은 실패를 한 번 더 알릴 수 있다).
 * @param {string} file @returns {{v:1, items:object}}
 * [연계] ← createAlerter.load · records(data_collection_status)
 */
function readFile(file) {
    try {
        if (!fs.existsSync(file)) return { v: 1, items: {} };
        const o = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!o || o.v !== 1 || !o.items || typeof o.items !== 'object' || Array.isArray(o.items)) throw Error('형식이 맞지 않음');
        const items = {};
        for (const id of Object.keys(ITEMS)) if (o.items[id]) items[id] = sanitize(o.items[id]);
        return { v: 1, items };
    } catch (e) {
        console.error('[collect_alert] 상태 파일을 읽지 못해 처음부터 셈:', e.message);
        return { v: 1, items: {} };
    }
}

/**
 * 운영 기본 발송: 운영(FLY_ALLOC_ID)에서만 sendAdminPush. 개발은 보내지 않고 콘솔 한 줄 + 「전달 안 됨」.
 * 예: 운영·기기 2대 → {delivered:true} / 개발 → {delivered:false, error:'개발 환경 — 푸시 생략'}
 * @param {string} title @param {string} body @param {object} data @returns {Promise<{delivered:boolean, error?:string}>}
 * [연계] → admin_push.sendAdminPush (그 함수는 Firebase 미초기화·기기 없음·발송 오류를 모두 {sent:0} 으로 돌려준다)
 */
async function defaultSend(title, body, data) {
    if (!process.env.FLY_ALLOC_ID) {
        console.log('[collect_alert] 개발 환경 — 관리자 푸시 생략: ' + body);
        return { delivered: false, error: '개발 환경 — 푸시 생략' };
    }
    const r = await require('./admin_push').sendAdminPush(title, body, data);
    if (r && r.sent > 0) return { delivered: true };
    return { delivered: false, error: r && r.failed > 0 ? '발송 실패 ' + r.failed + '건' : '전달 0건(기기 없음·Firebase 미초기화·발송 오류)' };
}

/**
 * 알림기를 만든다. 검사에서는 임시 파일·고정 시계·가짜 발송을 넣는다.
 * @param {object} [o] @param {string} [o.file] @param {function} [o.clock] - ms
 * @param {function} [o.send] - (title, body, data) → Promise<{delivered, error?}> (기본 defaultSend)
 * @returns {{report: function, records: function}}
 * [연계] ← 모듈 기본 싱글톤(수집기들) / 검사
 */
function createAlerter({ file = DEFAULT_FILE, clock = Date.now, send = defaultSend } = {}) {
    let state = null;
    const busy = new Set(); // 푸시를 보내는 중인 항목 — 그동안 들어온 보고는 상태만 바꾸고, 보내던 쪽이 끝나며 다시 본다.

    function load() {
        if (!state) state = readFile(file);
        return state;
    }
    /** 원자적으로 쓴다(임시 파일 → 이름 바꾸기). 실패해도 메모리 상태로 계속 간다(콘솔 한 줄). */
    function save() {
        const tmp = file + '.' + process.pid + '.tmp';
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
            fs.renameSync(tmp, file);
        } catch (e) {
            try { fs.unlinkSync(tmp); } catch (_) { /* 임시 파일이 없으면 정리할 것도 없다 */ }
            console.error('[collect_alert] 상태 저장 실패(재기동 뒤 같은 알림이 한 번 더 갈 수 있음):', e.message);
        }
    }
    function item(id) {
        const st = load();
        if (!st.items[id]) st.items[id] = blank();
        return st.items[id];
    }
    const threshold = (id) => ITEMS[id].threshold || 1;

    /** 보낼 푸시 문장. 예: '시정 예측 (기상청 MMIS) 수집 실패 — 빈 응답, 10/16 03:00부터' */
    function message(id, s, failing) {
        const name = nameOf(id);
        return failing
            ? { title: '자료 수집 실패', body: name + ' 수집 실패 — ' + (s.reason || '기타 오류') + ', ' + fmtKst(Date.parse(s.since)) + '부터' }
            : { title: '자료 수집 복구', body: name + ' 수집 복구 — ' + fmtKst(Date.parse(s.okSince)) };
    }

    /**
     * 지금 관리자에게 「실패 중」이라고 알려 둬야 하나. 예: 알린 뒤 성공 보고(okSince)가 왔으면 false.
     * ★「복구」는 성공 보고로만 일어난다(검토 1, 2026-10-15): 알린 뒤에는 연속 실패 수가 줄어 보고돼도
     *   (시정 예측 vsby_check_state 손상·저장 실패로 failStreak 가 0 부터 다시 셈) 실패 중으로 둔다.
     *   그래서 복구 문장에는 늘 「다시 받은 시각」(okSince)이 있다 — 「시각 모름」 복구는 나가지 않는다.
     * @param {string} id @param {object} s - 항목 상태 @returns {boolean}
     * [연계] ← settle
     */
    function wantFailing(id, s) {
        return s.notified ? !s.okSince : s.streak >= threshold(id);
    }

    /**
     * 관리자가 아는 것(notified)을 지금 사실(wantFailing)에 맞춘다. 다르면 푸시 1통.
     * 보내는 사이 상태가 또 바뀌었으면(예: 실패 알림을 보내는 중 복구) 끝난 뒤 다시 맞춘다.
     * 전달되지 않으면 멈추고 다음 보고 때 다시 시도한다.
     * @param {string} id @returns {Promise<string[]>} 이번에 전달한 푸시 종류('fail'|'recover')
     */
    async function settle(id) {
        const sent = [];
        if (busy.has(id) || ITEMS[id].push === false) return sent;
        busy.add(id);
        try {
            for (;;) {
                const s = item(id),
                    failing = wantFailing(id, s);
                if (failing === s.notified) break;
                const msg = message(id, s, failing);
                let r;
                try {
                    r = await send(msg.title, msg.body, { kind: 'collect_fail', item: id, phase: failing ? 'fail' : 'recover' });
                } catch (e) {
                    console.error('[collect_alert] 관리자 푸시 발송 예외 — ' + id + ':', e && e.message);
                    r = { delivered: false, error: '발송 예외: ' + String((e && e.message) || e).slice(0, 60) };
                }
                if (!r || !r.delivered) {
                    const err = (r && r.error) || '전달 안 됨';
                    console.warn('[collect_alert] 관리자 푸시 미전달(다음 보고 때 다시 시도) — ' + id + ': ' + err);
                    s.pushError = err.slice(0, 80);
                    s.pushErrorAt = new Date(clock()).toISOString();
                    // 실패 알림이 안 나간 채 보내는 사이 들어온 성공 시각은 쓸 데가 없다(알린 적이 없으니 복구도 없다).
                    if (!s.notified) s.okSince = null;
                    save();
                    break;
                }
                console.log('[collect_alert] 관리자 푸시 전달 — ' + msg.body);
                sent.push(failing ? 'fail' : 'recover');
                s.notified = failing;
                s.notifiedAt = failing ? new Date(clock()).toISOString() : null;
                if (!failing) s.okSince = null;
                s.pushError = null;
                s.pushErrorAt = null;
                save();
            }
        } finally {
            busy.delete(id);
        }
        return sent;
    }

    /**
     * 수집 시도 한 번의 결과를 받는다. 절대 던지지 않는다(수집을 막지 않게).
     * 예: report('marineBuoys', {ok:false, error}) → 첫 실패면 푸시 '기상부이 관측 (기상청 MMIS) 수집 실패 — HTTP 503, 10/16 03:03부터'
     *     report('visibility', {ok:false, error, streak:3, since}) → 3번째에 푸시. streak/since 는 vsby 의 영속 failStreak/failSince.
     * @param {string} id - ITEMS 열쇠
     * @param {{ok:boolean, error?:*, streak?:number, since?:string}} outcome
     * @returns {Promise<{sent:string[]}>}
     * [연계] ← 수집기들 / → settle → send
     */
    async function report(id, { ok, error, streak, since } = {}) {
        try {
            if (!ITEMS[id]) {
                console.error('[collect_alert] 모르는 항목:', id);
                return { sent: [] };
            }
            const s = item(id),
                before = JSON.stringify(s),
                at = new Date(clock()).toISOString();
            if (ok) {
                // 복구 알림에 쓸 「다시 받은 시각」(첫 성공). 실패 알림을 보내는 중(busy)에 들어온 성공도 —
                //   그 알림이 전달되면 곧바로 복구 알림이 나가므로 시각이 있어야 한다(검사 C6).
                if ((s.notified || busy.has(id)) && !s.okSince) s.okSince = at;
                s.streak = 0;
                s.since = null;
                s.reason = null;
                // 알린 적이 없고 보내는 중도 아니면 더 보낼 푸시가 없다 — 「미전달」 표시를 지운다(수집현황 카드에 남지 않게).
                if (!s.notified && !busy.has(id)) {
                    s.pushError = null;
                    s.pushErrorAt = null;
                }
            } else {
                s.streak = Number.isInteger(streak) && streak > 0 ? streak : s.streak + 1;
                s.since = isIso(since) ? since : s.since || at;
                s.reason = reasonOf(error);
                s.lastFailAt = at;
                s.okSince = null; // 복구 알림이 아직 안 나갔는데 다시 실패 → 관리자가 아는 「실패 중」이 그대로 맞다
            }
            if (JSON.stringify(s) !== before) save();
            return { sent: await settle(id) };
        } catch (e) {
            console.error('[collect_alert] 보고 처리 실패:', id, e && e.message);
            return { sent: [] };
        }
    }

    /** 지금 상태(화면용). 파일에서 다시 읽는다 — 다른 프로세스가 쓴 것도 보이게. @returns {object} 항목별 상태 */
    function records() {
        return readFile(file).items;
    }
    return { report, records, _settle: settle };
}

module.exports = { ...createAlerter(), createAlerter, reasonOf, fmtKst, ITEMS };
