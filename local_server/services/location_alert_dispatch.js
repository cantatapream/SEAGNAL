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
const RANK = { none: 0, prelim: 1, advisory: 2, severe: 3 };

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

/** FCM 데이터 전용 메시지(알림 표시 없음 — 단말이 판정 후 로컬 알림). 값은 문자열. */
function buildDataMessage(snapshot) {
    return {
        data: {
            type: 'location_alert_wake',
            v: '1',
            snapshot: JSON.stringify(snapshot),
        },
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
    return { sent: tokens.length, targets: tokens.length, snapshot, result };
}

/**
 * weather_alerts 트리 → 활성 특보 레코드 추출(방어적).
 * ⚠️ 실제 weather_alerts.json 구조에 대한 최종 검증 필요(개발환경에 파일 없음).
 *    노드를 재귀 순회하며 current(발효)/upcoming(예비) 배열 항목을 수집.
 *    항목 형식 가정: { zones:[구역명], type, level, tmEf, tmCc }
 */
function extractActiveWarnings(tree) {
    const out = [];
    const strip = (t) => String(t || '').replace('주의보', '').replace('경보', '').replace('예비특보', '').replace('특보', '').trim() || '풍랑';
    function pushItems(items, event) {
        for (const it of (Array.isArray(items) ? items : [])) {
            if (!it) continue;
            const level = event === 'publish' ? '예비'
                : (/경보/.test(it.type || '') ? '경보' : (/주의보/.test(it.type || '') ? '주의보' : (it.level || '주의보')));
            const warnType = strip(it.type);
            for (const z of (Array.isArray(it.zones) ? it.zones : (it.zone ? [it.zone] : []))) {
                if (z) out.push({ zone: z, warnType, level, event, efTime: it.tmEf || null, ynTime: it.tmCc || null });
            }
        }
    }
    function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node.current) pushItems(node.current, 'active');
        if (node.upcoming) pushItems(node.upcoming, 'publish');
        if (node.children) walk(node.children);
        // 일반 객체의 하위도 탐색(트리 형태 다양성 방어)
        for (const k of Object.keys(node)) {
            const v = node[k];
            if (v && typeof v === 'object' && k !== 'current' && k !== 'upcoming' && k !== 'children') walk(v);
        }
    }
    walk(tree);
    return out;
}

/** 디스크의 weather_alerts.json 을 읽어 dispatchWake 수행. 크롤러 hook에서 호출(가드됨). */
async function dispatchOnLatest(opts = {}) {
    let tree = null;
    try { tree = JSON.parse(fs.readFileSync(_WEATHER_ALERTS_FILE, 'utf8')); }
    catch (_) { return { sent: 0, reason: 'no_alerts_file' }; }
    const active = extractActiveWarnings(tree);
    return dispatchWake(active, opts);
}

module.exports = {
    buildSnapshot, selectTargetTokens, buildDataMessage,
    dispatchWake, extractActiveWarnings, dispatchOnLatest,
};
