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
 * 스냅샷: { generatedAt, zones: { [구역명]: {warnType, level, event, efTime, ynTime, tier} } }
 *   - 단말은 자기 구역명으로 조회 + 전체 맵으로 '최근접 무특보/주의보 구역' tier 판정.
 *   - 구역명에 없는 구역 = 무특보.
 *
 * 순수 부분(buildSnapshot/selectTargetTokens/buildDataMessage)은 테스트로 검증.
 * 실제 전송 sendFn / 동의자 getConsents 는 주입 가능(테스트 시 mock).
 * ============================================================================
 */
'use strict';
const path = require('path');
const fs = require('fs');
const core = require('../js/location_alert_core.js'); // classifyTier 재사용

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
        return z + '(' + (s.warnType || '') + tierLabel(s.tier) + ')';
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
        zones[z] = {
            warnType: rep.warnType || '풍랑',
            level: rep.level || '',
            event: rep.event || 'active',
            efTime: rep.efTime || null,
            ynTime: rep.ynTime || null,
            tier,
        };
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
        zones[z].forecast = fc || null;
    }
    return { generatedAt: (now ? new Date(now) : new Date()).toISOString(), zones };
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
 *  단말은 항상 진짜 백그라운드 GPS(POS_KEY)로 판정한다. */
// FCM 데이터 메시지 페이로드 한도(약 4KB). 안전 여유를 두고 경고 임계값을 3.8KB 로 둔다.
const _FCM_DATA_WARN_BYTES = 3800;

function buildDataMessage(snapshot) {
    const snapStr = JSON.stringify(snapshot);
    // [LIGHT C] FCM 4KB data 한도 근접/초과 안전 경고. 특보 구역이 많으면(전해상 광역 특보)
    //   스냅샷이 4KB 를 넘을 수 있다. 여기서는 로그만 남기고 절대 구역을 드롭하지 않는다
    //   (구역 누락은 warned zone 을 무특보로 오판정하는 BUG A 를 재유발하므로 금지).
    try {
        const bytes = Buffer.byteLength(snapStr, 'utf8');
        if (bytes > _FCM_DATA_WARN_BYTES) {
            const zoneCount = snapshot && snapshot.zones ? Object.keys(snapshot.zones).length : 0;
            console.warn('[LocationAlertDispatch] ⚠ FCM data snapshot 크기 ' + bytes
                + 'B (구역 ' + zoneCount + '개) — FCM 4KB 한도 근접/초과 가능. '
                + '구역 드롭 금지(BUG A 재유발); 향후 페이로드 축약/청크 검토 필요.');
        }
    } catch (_) { /* 크기 측정 실패는 무시 */ }
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

/** 기본 전송: firebase-admin 데이터 메시지(멀티캐스트). firebase 미구성/실패는 흡수. */
async function _defaultSendFn(tokens, message) {
    try {
        const { getAdmin } = require('./firebase_admin_lazy');
        const admin = getAdmin();
        if (!admin || !admin.apps || admin.apps.length === 0) return { ok: false, reason: 'no_admin' };
        const res = await admin.messaging().sendEachForMulticast({
            tokens,
            data: message.data,
            android: message.android,
        });
        return { ok: true, successCount: res.successCount, failureCount: res.failureCount };
    } catch (e) {
        console.error('[LocationAlertDispatch] send 실패:', e && e.message);
        return { ok: false, reason: e && e.message };
    }
}

/**
 * 활성 특보 → 동의 단말에 깨우는 신호 전송.
 * @param activeWarnings 위 buildSnapshot 입력 형식
 * @param opts { sendFn, getConsents, now } (테스트 주입용)
 */
async function dispatchWake(activeWarnings, opts = {}) {
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
    // 발송 이력 + 누적 집계 기록(관리자 '실시간 특보 알림 관리'). 테스트는 opts.record===false 로 생략.
    if (opts.record !== false) {
        const count = (result && Number.isFinite(result.successCount)) ? result.successCount : tokens.length;
        recordHistory(snapshot, count);
    }
    return { sent: tokens.length, targets: tokens.length, snapshot, result };
}

/**
 * weather_alerts 트리 → 활성 특보 레코드 추출.
 * 실제 구조(empty_tree.json/report_alert_processor 확인): 지역별 중첩 트리.
 *   말단 구역 노드(키=구역명)에 current(발효중)·upcoming(예비/발표예정)이 **객체 또는 null**.
 *   필드: wrnTp(종류 예:'풍랑'), wrnLvl(등급 '주의보'|'경보'|'예비'), tmEf(발효시각·범위형 포함), tmCc(해제예정).
 *   children(연안/평수 자식)도 동일 형태 — 함께 순회하되 device는 메인 구역명만 매칭.
 */
function extractActiveWarnings(tree) {
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
    return Object.keys(zones).sort().map((z) => z + ':' + zones[z].tier + ':' + zones[z].event).join('|');
}
function _readLastSig() {
    try { return (JSON.parse(fs.readFileSync(_SIG_FILE, 'utf8')) || {}).sig || ''; } catch (_) { return ''; }
}
function _writeLastSig(sig) {
    try { fs.mkdirSync(path.dirname(_SIG_FILE), { recursive: true }); fs.writeFileSync(_SIG_FILE, JSON.stringify({ sig, at: new Date().toISOString() })); } catch (_) { }
}

/** 디스크의 weather_alerts.json 을 읽어 dispatchWake 수행. 크롤러 hook에서 호출(가드됨).
 *  변화 감지: 직전과 동일한 활성 특보 상황이면 재발송하지 않는다(매 주기 중복 방지). */
async function dispatchOnLatest(opts = {}) {
    let tree = null;
    try { tree = JSON.parse(fs.readFileSync(_WEATHER_ALERTS_FILE, 'utf8')); }
    catch (_) { return { sent: 0, reason: 'no_alerts_file' }; }
    const active = extractActiveWarnings(tree);
    const sig = _signatureOf(buildSnapshot(active));
    if (sig === _readLastSig()) return { sent: 0, reason: 'unchanged' };
    const res = await dispatchWake(active, opts);
    // 실제 발송됐거나(중복방지) 활성 0건으로 정리됐을 때 시그니처 갱신. no_targets(동의자 없음)는
    //   갱신하지 않아 동의자 생기면 다음 주기에 발송되도록 한다.
    if ((res && res.sent > 0) || sig === '') _writeLastSig(sig);
    return res;
}

module.exports = {
    buildSnapshot, selectTargetTokens, buildDataMessage,
    dispatchWake, extractActiveWarnings, dispatchOnLatest,
};
