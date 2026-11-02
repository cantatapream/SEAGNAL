/**
 * ============================================================================
 * services/location_alert_dispatch.js — 위치기반 특보: 깨우는 신호 디스패치 (④)
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md (§5 방식 A)
 *
 * 특보 변화 시, 동의(활성)한 단말에 **데이터 전용(조용한) FCM 메시지**로 현재
 * "활성 특보 스냅샷"을 보낸다. 단말은 이 스냅샷 + 내장 폴리곤 + 단말 저장 위치로
 * 직접 판정하여 맞춤 경고(로컬 알림)를 띄운다. (위치는 서버로 오지 않음)
 *
 * 스냅샷: { zones: { [구역명]: {tier, warnType?, event?, efTime?, forecast?} } }
 *   - 단말은 자기 구역명으로 조회 + 전체 맵으로 '최근접 무특보/주의보 구역' tier 판정.
 *   - 구역명에 없는 구역 = 무특보. ★구역은 절대 빼지 않는다(BUG A — 특보 해역을 무특보로 오판정).
 *   - [축약 2026-10-15] 단말이 안 읽는 level·ynTime·generatedAt 은 싣지 않고, 단말 기본값과 같은
 *     warnType '풍랑'·event 'active'·forecast null 은 생략, efTime 은 단말이 쓰는 경우(예비 또는
 *     event≠active)에만 싣는다. 단말(Java LocationAlertDecider·JS location_alert_runtime)의 기본값이
 *     같아 판정·문구가 글자까지 같다 — 검사: scripts/test_location_dispatch_reliability.js [5][6].
 *     사용자 결정(2026-10-15): "①②둘 다, 서버만, 앱 업데이트 없음".
 * 발송 신뢰성(2026-10-15): 토큰 ≤500개씩 나눠 보냄(fcm_multicast_chunked) · 이력 count=실제 성공수 ·
 *   성공 0이면 지문을 저장하지 않아 다음 주기(크롤러 1분)에 다시 보낸다 · 발송마다 요약 로그 1줄.
 *
 * 순수 부분(buildSnapshot/selectTargetTokens/buildDataMessage)은 테스트로 검증.
 * 실제 전송 sendFn / 동의자 getConsents 는 주입 가능(테스트 시 mock).
 * 점검 모드(2026-09-10): push_sender.isPushBlocked() 가 true(점검 중 + 푸시 차단)면 보내지 않는다
 *   — opts.isPushBlocked 로 주입 가능. 검사: scripts/test_maintenance_tree.js
 * ============================================================================
 */
'use strict';
const path = require('path');
const fs = require('fs');
const core = require('../../client/js/location-alert/location_alert_core.js'); // classifyTier 재사용

const _WEATHER_ALERTS_FILE = path.join(__dirname, '..', 'data', 'weather_alerts.json');
const _HISTORY_FILE = path.join(__dirname, '..', 'data', 'custom_push_history.json');
const RANK = { none: 0, prelim: 1, advisory: 2, severe: 3 };

// 위치기반 발송을 관리자 '실시간 특보 알림 관리 > 발송 이력'(tab:'location') + 누적 집계에 기록.
function _zoneSummary(snapshot) {
    const names = Object.keys((snapshot && snapshot.zones) || {});
    if (!names.length) return '';
    const tierLabel = (t) => t === 'severe' ? '경보' : (t === 'advisory' ? '주의보' : (t === 'prelim' ? '예비특보' : ''));
    const parts = names.slice(0, 5).map((z) => {
        const s = snapshot.zones[z] || {};
        // 스냅샷은 '풍랑'을 생략해 싣는다(단말 기본값) → 이력 문구는 기본값을 채워 종전과 같게.
        return z + '(' + (s.warnType || '풍랑') + tierLabel(s.tier) + ')';
    });
    return parts.join(', ') + (names.length > 5 ? ' 외 ' + (names.length - 5) + '개' : '');
}

function recordHistory(snapshot, count) {
    try {
        let history = [];
        try { const a = JSON.parse(fs.readFileSync(_HISTORY_FILE, 'utf8')); if (Array.isArray(a)) history = a; } catch (_) { history = []; }
        const kst = new Date(Date.now() + 9 * 3600 * 1000);
        const timeStr = kst.toISOString().replace('T', ' ').substring(2, 16).replace(/-/g, '.');
        history.unshift({
            id: Date.now() + Math.floor(Math.random() * 1000),
            time: timeStr,
            title: '📍 [위치기반] 해상특보 안전 경보 발송',
            content: _zoneSummary(snapshot) || '활성 특보 해역에 위치기반 경보 신호 발송',
            target: '', count: count || 0, status: 'sent',
            type: 'auto', tab: 'location', tmRef: '',
        });
        if (history.length > 500) history = history.slice(0, 500);
        fs.mkdirSync(path.dirname(_HISTORY_FILE), { recursive: true });
        fs.writeFileSync(_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
        try { require('./push_counter').incrementSend(count || 0); } catch (_) { /* 집계 실패 무시 */ }
    } catch (e) {
        console.error('[LocationAlertDispatch] 이력 기록 실패(무시):', e && e.message);
    }
}

function _tierOfOne(w) {
    return core.classifyTier([{ type: w.warnType, level: w.level }]);
}

/**
 * 활성 특보 레코드 배열 → 스냅샷.
 * @param activeWarnings [{ zone(구역명), warnType('풍랑'..), level('예비'|'주의보'|'경보'),
 *                          event('publish'|'active'), efTime, ynTime }]
 */
function buildSnapshot(activeWarnings, now) {
    const byZone = {};
    for (const w of (activeWarnings || [])) {
        if (!w || !w.zone) continue;
        (byZone[w.zone] = byZone[w.zone] || []).push(w);
    }
    const zones = {};
    for (const z of Object.keys(byZone)) {
        const ws = byZone[z];
        const tier = core.classifyTier(ws.map(w => ({ type: w.warnType, level: w.level })));
        // 대표(가장 높은 tier) 항목으로 표시 필드 구성
        const rep = ws.slice().sort((a, b) => RANK[_tierOfOne(b)] - RANK[_tierOfOne(a)])[0];
        // [축약 2026-10-15] FCM data 4096B 한도 때문에 단말이 안 쓰는 값은 싣지 않는다(구역은 그대로).
        //   단말 읽기(둘 다 확인): Java LocationAlertDecider.optStr(z,"warnType","풍랑")·("event","active")·
        //   ("efTime","") / JS runtime decideAlert `z.warnType || '풍랑'`·`z.event || 'active'`·`z.efTime || ''`.
        //   efTime 을 문구에 쓰는 곳은 buildMessage 의 예비(tier prelim)와 event≠active(발효 예정)뿐이다.
        //   level·ynTime·generatedAt 은 단말 어디에서도 읽지 않는다(Java·JS grep).
        const warnType = rep.warnType || '풍랑';
        const event = rep.event || 'active';
        const zone = { tier };
        if (warnType !== '풍랑') zone.warnType = warnType;
        if (event !== 'active') zone.event = event;
        if (rep.efTime && (tier === 'prelim' || event !== 'active')) zone.efTime = rep.efTime;
        zones[z] = zone;
        // 예측 기상(최악) 주입. 데모 override(레코드가 forecast 직접 보유) 우선,
        //   없으면 서버측 구역별 계산. 어떤 경우에도 throw 흡수(줄 생략 허용).
        let fc = null;
        if (rep && rep.forecast && typeof rep.forecast === 'object') {
            fc = rep.forecast;
        } else {
            // ws 중 forecast 를 가진 레코드가 있으면 사용
            const withFc = ws.find(w => w && w.forecast && typeof w.forecast === 'object');
            if (withFc) fc = withFc.forecast;
            else {
                try { fc = require('../services/location_alert_forecast').worstForZone(z); }
                catch (_) { fc = null; }
            }
        }
        if (fc) zones[z].forecast = fc; // 없으면 생략 — 단말은 없음/null 을 똑같이 '예측 줄 없음'으로 처리
    }
    return { zones };
}

/** 동의(활성) 레코드 → 중복 제거된 토큰 배열. */
function selectTargetTokens(consents) {
    const seen = new Set();
    const out = [];
    for (const c of (consents || [])) {
        if (c && c.agreed && c.token && !seen.has(c.token)) { seen.add(c.token); out.push(c.token); }
    }
    return out;
}

/** FCM 데이터 전용 메시지(알림 표시 없음 — 단말이 판정 후 로컬 알림). 값은 문자열.
 *  단말은 항상 진짜 백그라운드 GPS(POS_KEY)로 판정한다.
 *  크기 경고는 여기서 찍지 않고 dispatchWake 의 발송 요약 1줄에 함께 싣는다(주기당 로그 1줄). */
// FCM 데이터 메시지 페이로드 한도 4096B. 넘어도 구역은 빼지 않는다(BUG A 재유발 금지) — 로그로만 알린다.
const _FCM_DATA_LIMIT_BYTES = 4096;
const _FCM_DATA_WARN_BYTES = 3800;

/** data 맵의 키+값 바이트 합. ⚠FCM 이 한도를 세는 정확한 방식은 확인하지 않았다 — 키+값 합으로 어림. */
function _dataBytes(data) {
    let n = 0;
    for (const k of Object.keys(data || {})) n += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(String(data[k]), 'utf8');
    return n;
}

function buildDataMessage(snapshot) {
    const snapStr = JSON.stringify(snapshot);
    const data = {
        type: 'location_alert_wake',
        v: '1',
        snapshot: snapStr,
    };
    return {
        data,
        android: { priority: 'high' },
    };
}

/** 기본 전송: firebase-admin 데이터 메시지(멀티캐스트, 토큰 ≤500개씩). firebase 미구성/실패는 흡수.
 *  항상 숫자 successCount 를 돌려준다(미구성·예외 = 0). 로그는 여기서 찍지 않는다(dispatchWake 요약 1줄). */
async function _defaultSendFn(tokens, message) {
    try {
        const { getAdmin } = require('./firebase_admin_lazy');
        const admin = getAdmin();
        if (!admin || !admin.apps || admin.apps.length === 0) {
            return { ok: false, reason: 'no_admin', successCount: 0, failureCount: 0, errorCodes: {} };
        }
        return await require('./fcm_multicast_chunked').sendMulticastChunked(admin.messaging(), tokens, message);
    } catch (e) {
        console.error('[LocationAlertDispatch] send 실패:', e && e.message);
        return { ok: false, reason: e && e.message, successCount: 0, failureCount: tokens.length, errorCodes: { send_threw: tokens.length } };
    }
}

/**
 * 활성 특보 → 동의 단말에 깨우는 신호 전송.
 * @param activeWarnings 위 buildSnapshot 입력 형식
 * @param opts { sendFn, getConsents, now } (테스트 주입용)
 */
async function dispatchWake(activeWarnings, opts = {}) {
    // [점검 모드] 관리자가 "푸시 알림 차단"을 켠 점검 중에는 위치기반 깨우기도 보내지 않는다
    //   — 특보 푸시(push_sender)·태풍(typhoon_notifier)과 같은 규칙(사용자 확정 2026-09-10).
    //   종전엔 이 경로만 점검 설정을 안 봐서 점검 중에도 나갔다. 테스트는 opts.isPushBlocked 로 주입.
    const isPushBlocked = opts.isPushBlocked || (() => require('../push_sender').isPushBlocked());
    if (isPushBlocked()) return { sent: 0, targets: 0, reason: 'push_blocked_maintenance' };
    const snapshot = buildSnapshot(activeWarnings, opts.now);
    if (!snapshot.zones || Object.keys(snapshot.zones).length === 0) {
        return { sent: 0, targets: 0, reason: 'no_active_zones' };
    }
    const getConsents = opts.getConsents || (() => require('./location_alert_store').getActiveConsents());
    const tokens = selectTargetTokens(getConsents());
    if (tokens.length === 0) return { sent: 0, targets: 0, reason: 'no_targets' };

    const sendFn = opts.sendFn || _defaultSendFn;
    const message = buildDataMessage(snapshot);
    const result = await sendFn(tokens, message);
    // [2026-10-15] 실제 성공 수만 센다 — 결과에 숫자 successCount 가 없으면(예외·미구성) 0.
    //   종전엔 tokens.length 로 채워 "못 보냈는데 보낸 것처럼" 이력이 남을 수 있었다.
    const successCount = (result && Number.isFinite(result.successCount)) ? result.successCount : 0;
    const failureCount = (result && Number.isFinite(result.failureCount)) ? result.failureCount : (tokens.length - successCount);
    _logSendSummary(tokens.length, result, message, snapshot, successCount);
    // 발송 이력 + 누적 집계 기록(관리자 '실시간 특보 알림 관리'). 테스트는 opts.record===false 로 생략.
    //   opts.recordFailure===false(dispatchOnLatest 가 같은 상황의 재시도 때 넘김)면 성공 0 이력은 생략 —
    //   매 주기 0건 이력이 쌓이지 않게. opts.recordHistory 는 테스트 주입용.
    if (opts.record !== false && (successCount > 0 || opts.recordFailure !== false)) {
        (opts.recordHistory || recordHistory)(snapshot, successCount);
    }
    // sent = 실제 성공 수(종전: 대상 수). dispatchOnLatest 는 sent>0 일 때만 지문을 저장한다.
    return { sent: successCount, targets: tokens.length, failed: failureCount, snapshot, result };
}

/** 발송 1회 = 로그 1줄. 대상·성공·실패·실패코드(코드별 건수)·데이터 크기. 토큰 값은 남기지 않는다.
 *  [연계] ← dispatchWake / → fcm_multicast_chunked.formatSendSummary */
function _logSendSummary(targets, result, message, snapshot, successCount) {
    try {
        const summary = require('./fcm_multicast_chunked').formatSendSummary(targets, result);
        const zoneCount = Object.keys((snapshot && snapshot.zones) || {}).length;
        const bytes = _dataBytes(message && message.data);
        let size = ' · 데이터 ' + bytes + 'B(구역 ' + zoneCount + '개)';
        if (bytes > _FCM_DATA_LIMIT_BYTES) size += ' ⚠FCM 4096B 한도 초과 — 구역은 빼지 않고 그대로 보냄(BUG A 방지)';
        else if (bytes > _FCM_DATA_WARN_BYTES) size += ' ⚠4096B 한도 근접';
        const line = '[LocationAlertDispatch] 발송 결과 — ' + summary + size
            + (successCount > 0 ? '' : ' · 성공 0 → 지문 미저장, 다음 주기에 재시도');
        if (successCount > 0) console.log(line); else console.warn(line);
    } catch (_) { /* 로그 문자열 조립 실패는 발송 결과에 영향 없다 — 발송·이력은 이미 처리됐다 */ }
}

/**
 * weather_alerts 트리 → 활성 특보 레코드 추출.
 * 실제 구조(empty_tree.json/report_alert_processor 확인): 지역별 중첩 트리.
 *   말단 구역 노드(키=구역명)에 current(발효중)·upcoming(예비/발표예정)이 **객체 또는 null**.
 *   필드: wrnTp(종류 예:'풍랑'), wrnLvl(등급 '주의보'|'경보'|'예비'), tmEf(발효시각·범위형 포함), tmCc(해제예정).
 *   children(연안/평수 자식)도 동일 형태 — 함께 순회하되 device는 메인 구역명만 매칭.
 * ★디스크의 weather_alerts.json 은 맨 위가 `{ updatedAt, …, previous, current }` 감싸개다
 *   (marine_warning_crawler.js _writeWeatherAlertsJson). 예전엔 감싸개째 순회해 'current' 키를
 *   말단 필드로 건너뛰고 **previous(직전 주기) 트리만** 읽었다 → 위치 알림이 약 2주기(약 2분) 전
 *   상황으로 나갔다(2026-10-15 독립 리뷰 발견·재현, 사용자 「진행」). 감싸개면 current 트리만 본다.
 * 예: extractActiveWarnings({previous:{…}, current:{'남해':{'남해동부먼바다':{current:{wrnLvl:'경보'}}}}})
 *     → [{zone:'남해동부먼바다', level:'경보', event:'active', …}]
 */
function extractActiveWarnings(tree) {
    if (tree && typeof tree === 'object' && 'previous' in tree && 'current' in tree) tree = tree.current;
    const out = [];
    const LEAF_KEYS = ['current', 'upcoming', 'history', 'children', 'missingCount'];
    function emit(zoneName, node) {
        const cur = node.current;
        if (cur && typeof cur === 'object') {
            out.push({
                zone: zoneName, warnType: cur.wrnTp || '풍랑', level: cur.wrnLvl || '주의보',
                event: 'active', efTime: cur.tmEf || null, ynTime: cur.tmCc || null,
            });
        }
        const up = node.upcoming;
        if (up && typeof up === 'object') {
            out.push({
                zone: zoneName, warnType: up.wrnTp || '풍랑', level: up.wrnLvl || '예비',
                event: 'publish', efTime: up.tmEf || null, ynTime: up.tmCc || null,
            });
        }
    }
    function walk(node, keyName) {
        if (!node || typeof node !== 'object') return;
        const isZoneNode = ('current' in node) || ('upcoming' in node) || ('history' in node);
        if (isZoneNode && keyName) emit(keyName, node);
        // children 맵(자식 구역)
        if (node.children && typeof node.children === 'object') {
            for (const k of Object.keys(node.children)) walk(node.children[k], k);
        }
        // 그 외 지역 하위 키 재귀(말단 필드 제외)
        for (const k of Object.keys(node)) {
            if (LEAF_KEYS.includes(k)) continue;
            const v = node[k];
            if (v && typeof v === 'object') walk(v, k);
        }
    }
    walk(tree, null);
    return out;
}

// 변화 감지용 — 직전 발송 스냅샷 시그니처(구역:tier:event). 같은 상황이면 재발송/이력 폭주 방지.
const _SIG_FILE = path.join(__dirname, '..', 'data', 'location_alert_last_sig.json');
function _signatureOf(snapshot) {
    const zones = (snapshot && snapshot.zones) || {};
    // event 는 'active' 일 때 스냅샷에서 생략된다 → 기본값을 채워 종전 지문 문자열과 똑같이 만든다
    //   (안 그러면 배포 직후 지문이 달라져 같은 상황을 한 번 더 보낸다).
    return Object.keys(zones).sort().map((z) => z + ':' + zones[z].tier + ':' + (zones[z].event || 'active')).join('|');
}
function _readLastSig() {
    try { return (JSON.parse(fs.readFileSync(_SIG_FILE, 'utf8')) || {}).sig || ''; } catch (_) { return ''; }
}
function _writeLastSig(sig) {
    try { fs.mkdirSync(path.dirname(_SIG_FILE), { recursive: true }); fs.writeFileSync(_SIG_FILE, JSON.stringify({ sig, at: new Date().toISOString() })); } catch (_) { /* 마지막 지문 기록은 중복 발송을 줄이려는 것이다 — 못 써도 발송 자체는 정상으로 진행한다 */ }
}

// 성공 0으로 끝난 상황의 지문(프로세스 메모리). 같은 상황 재시도가 계속 실패해도 0건 이력은 1번만 남긴다.
//   서버를 다시 켜면 비워진다 → 재시작 직후 첫 실패에 0건 이력이 1건 더 남을 수 있다(단순함 우선).
let _lastFailedSig = null;

/** 디스크의 weather_alerts.json 을 읽어 dispatchWake 수행. 크롤러 hook에서 호출(가드됨).
 *  변화 감지: 직전과 동일한 활성 특보 상황이면 재발송하지 않는다(매 주기 중복 방지).
 *  [2026-10-15] 성공 0이면 지문을 저장하지 않는다 → 다음 크롤러 주기(1분)에 다시 보낸다.
 *  opts.tree / readLastSig / writeLastSig 는 테스트 주입용(저장소 data 파일을 건드리지 않게). */
async function dispatchOnLatest(opts = {}) {
    let tree = null;
    if (opts.tree !== undefined) tree = opts.tree;
    else {
        try { tree = JSON.parse(fs.readFileSync(_WEATHER_ALERTS_FILE, 'utf8')); }
        catch (_) { return { sent: 0, reason: 'no_alerts_file' }; }
    }
    const readLastSig = opts.readLastSig || _readLastSig;
    const writeLastSig = opts.writeLastSig || _writeLastSig;
    const active = extractActiveWarnings(tree);
    const sig = _signatureOf(buildSnapshot(active));
    if (sig === readLastSig()) return { sent: 0, reason: 'unchanged' };
    const res = await dispatchWake(active, Object.assign({}, opts, { recordFailure: sig !== _lastFailedSig }));
    // 실제 1건 이상 성공했거나 활성 0건으로 정리됐을 때만 시그니처 갱신. no_targets(동의자 없음)·
    //   성공 0(전원 실패·예외·firebase 미구성)은 갱신하지 않아 다음 주기에 다시 보낸다.
    if ((res && res.sent > 0) || sig === '') { writeLastSig(sig); _lastFailedSig = null; }
    else if (res && res.targets > 0) _lastFailedSig = sig;
    return res;
}

module.exports = {
    buildSnapshot, selectTargetTokens, buildDataMessage,
    dispatchWake, extractActiveWarnings, dispatchOnLatest,
};
