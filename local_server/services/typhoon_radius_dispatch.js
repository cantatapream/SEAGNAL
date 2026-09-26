/**
 * ============================================================================
 * services/typhoon_radius_dispatch.js — 위치기반 태풍 반경 알림: 깨우는 신호 디스패치
 * ============================================================================
 * 설계 문서: 00_docs/TYPHOON_LOCATION_RADIUS_ENGINE_DESIGN.md (Phase 2a 확정 리파인)
 *
 * 태풍 통보문이 "하루 2회 트리거 윈도(KST 오전 [10,11) / 야간 [22,23))" 안에 발표되면,
 * 동의(활성)한 단말 전체에 **데이터 전용(조용한) FCM "깨우는 신호"** 를 1회 방송한다.
 * 단말은 이 신호를 받아 그 순간 위치 1회 수집 + /api/typhoon 재조회 + 내장 비대칭 반경
 * 수식(typhoon_radius.radiusEntry)으로 직접 판정해, 강풍/폭풍반경에 드는 **각 태풍마다**
 * 별도 로컬 알림을 띄운다. (좌표는 서버로 오지 않음 — 서버는 신호 sig 만 방송)
 *
 * 이 모듈은 services/location_alert_dispatch.js 의 패턴을 미러링한다(직접 수정 안 함):
 *   selectTargetTokens / _defaultSendFn(멀티캐스트) / recordHistory / last-sig 상태파일.
 *
 * dedup 정책(서버가 결정):
 *   - 트리거 윈도: 통보문 발표시각 tmFc(KST) 시(hour) ∈ [10,11) → 'morning', [22,23) → 'night',
 *     그 외(04시/16시 정규 통보 포함) → null(트리거 안 함).
 *   - 하루 슬롯당 1회: (KST-날짜, 슬롯) 키로 dedup. 같은 슬롯/날에 첫 자격 통보문 1건에만 방송.
 *     같은 슬롯에 복수 태풍이 발표돼도 → 방송 1회 → 단말은 위치 1회 수집해 모든 태풍 평가.
 *
 * 순수 헬퍼(slotOfTmFc/kstDateOfTmFc/dedupKey)는 단위테스트로 검증 가능.
 * 실제 전송 sendFn / 동의자 getConsents 는 주입 가능(테스트 시 mock).
 * 완전 방어적 — dispatchTyphoonOnLatest 는 절대 throw 하지 않는다.
 * ============================================================================
 */
'use strict';
const path = require('path');
const fs = require('fs');

const _TYPHOON_FILE = path.join(__dirname, '..', 'data', 'typhoon.json');
const _HISTORY_FILE = path.join(__dirname, '..', 'data', 'custom_push_history.json');
// 직전 방송한 dedupKey 저장(특보의 location_alert_last_sig.json 패턴). 같은 (날,슬롯)이면 재방송 안 함.
const _SIG_FILE = path.join(__dirname, '..', 'data', 'typhoon_radius_last_sig.json');

// ── 순수: tmFc("YYYYMMDDHHmm", KST) 파싱 ────────────────────────────────────
//   KMA 통보문 발표시각은 KST 문자열이므로 문자열 자릿수로 직접 해석한다(타임존 변환 불필요).

/** tmFc 의 KST 시(hour) 정수. 12자리 미만이면 null. */
function _kstHourOfTmFc(tmFc) {
    const s = String(tmFc == null ? '' : tmFc).replace(/[^0-9]/g, '');
    if (s.length < 12) return null;
    const h = parseInt(s.slice(8, 10), 10);
    return Number.isFinite(h) ? h : null;
}

/**
 * 통보문 발표시각 → 트리거 슬롯.
 *   KST 시(hour) ∈ [10,11) → 'morning', [22,23) → 'night', 그 외 → null.
 * @param {string} tmFc "YYYYMMDDHHmm"(KST)
 * @returns {'morning'|'night'|null}
 */
function slotOfTmFc(tmFc) {
    const h = _kstHourOfTmFc(tmFc);
    if (h === null) return null;
    if (h >= 10 && h < 11) return 'morning';
    if (h >= 22 && h < 23) return 'night';
    return null;
}

/** 통보문 발표 KST 날짜("YYYYMMDD"). 12자리 미만이면 null. */
function kstDateOfTmFc(tmFc) {
    const s = String(tmFc == null ? '' : tmFc).replace(/[^0-9]/g, '');
    if (s.length < 12) return null;
    return s.slice(0, 8);
}

/** dedup 키 = "YYYYMMDD-slot". 슬롯 없으면 null(트리거 대상 아님). */
function dedupKey(tmFc) {
    const slot = slotOfTmFc(tmFc);
    if (!slot) return null;
    const date = kstDateOfTmFc(tmFc);
    if (!date) return null;
    return date + '-' + slot;
}

// ── 동의 토큰 선택 (특보 dispatch 와 동일 로직) ─────────────────────────────
/** 동의(활성) 레코드 → 중복 제거된 토큰 배열. */
function selectTargetTokens(consents) {
    const seen = new Set();
    const out = [];
    for (const c of (consents || [])) {
        if (c && c.agreed && c.token && !seen.has(c.token)) { seen.add(c.token); out.push(c.token); }
    }
    return out;
}

// ── 데이터 전용 메시지(알림 표시 없음 — 단말이 판정 후 로컬 알림). 값은 문자열. ──
function buildTyphoonWakeMessage(sig) {
    return {
        data: { type: 'typhoon_radius_wake', v: '1', sig: String(sig) },
        android: { priority: 'high' },
    };
}

// ── 기본 전송: firebase-admin 데이터 메시지(멀티캐스트). firebase 미구성/실패는 흡수. ──
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
        console.error('[TyphoonRadiusDispatch] send 실패:', e && e.message);
        return { ok: false, reason: e && e.message };
    }
}

// ── 발송 이력 기록 — 관리자 '태풍 발생/소멸' 탭(tab:'typhoon')에 노출 + 누적 집계. ──
function recordHistory(summary, count) {
    try {
        let history = [];
        try { const a = JSON.parse(fs.readFileSync(_HISTORY_FILE, 'utf8')); if (Array.isArray(a)) history = a; } catch (_) { history = []; }
        const kst = new Date(Date.now() + 9 * 3600 * 1000);
        const timeStr = kst.toISOString().replace('T', ' ').substring(2, 16).replace(/-/g, '.');
        history.unshift({
            id: Date.now() + Math.floor(Math.random() * 1000),
            time: timeStr,
            title: '📍 [위치기반] 태풍 반경 안전 경보 신호 발송',
            content: summary || '활성 태풍 통보문 갱신 — 위치기반 반경 경보 신호 발송',
            target: '', count: count || 0, status: 'sent',
            type: 'auto', tab: 'typhoon', tmRef: '',
        });
        if (history.length > 500) history = history.slice(0, 500);
        fs.mkdirSync(path.dirname(_HISTORY_FILE), { recursive: true });
        fs.writeFileSync(_HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
        try { require('./push_counter').incrementSend(count || 0); } catch (_) { /* 집계 실패 무시 */ }
    } catch (e) {
        console.error('[TyphoonRadiusDispatch] 이력 기록 실패(무시):', e && e.message);
    }
}

// ── 상태(직전 dedupKey) 파일 ───────────────────────────────────────────────
function _readLastKey() {
    try { return (JSON.parse(fs.readFileSync(_SIG_FILE, 'utf8')) || {}).key || ''; } catch (_) { return ''; }
}
function _writeLastKey(key) {
    try {
        fs.mkdirSync(path.dirname(_SIG_FILE), { recursive: true });
        fs.writeFileSync(_SIG_FILE, JSON.stringify({ key: key, at: new Date().toISOString() }));
    } catch (_) { /* 지문 파일을 못 써도 발송은 진행한다 — 다음 회차에 중복 판정만 느슨해진다 */ }
}

/** 활성 태풍 배열에서 active 한 것만(이름 등으로 요약). typhoon.json 의 typhoons 형태 가정. */
function _activeTyphoons(typhoonJson) {
    const arr = (typhoonJson && Array.isArray(typhoonJson.typhoons)) ? typhoonJson.typhoons : [];
    return arr.filter(t => t && t.latestTmFc);
}

function _summaryOf(typhoons, slot) {
    const slotLabel = slot === 'morning' ? '오전' : (slot === 'night' ? '야간' : '');
    const names = typhoons.map(t => String(t.name || t.nameEn || ('제' + t.seq + '호'))).filter(Boolean);
    const head = names.slice(0, 3).join(', ') + (names.length > 3 ? ' 외 ' + (names.length - 3) + '개' : '');
    return (slotLabel ? '[' + slotLabel + '] ' : '') + '활성 태풍 ' + names.length + '개(' + head + ') 반경 경보 신호';
}

/**
 * 활성 태풍 JSON → 트리거 판정 후 깨우는 신호 방송.
 *   트리거: 활성 태풍 중 어느 하나라도 latestTmFc 가 슬롯(slotOfTmFc)에 들고,
 *           그 dedupKey 가 직전 방송 키(상태파일)와 다르면 → 방송 1회.
 * @param {object} typhoonJson data/typhoon.json 파싱 객체
 * @param {object} opts { sendFn, getConsents, now, record, lastKey } (테스트 주입용)
 *   - lastKey: 직전 dedupKey 를 주입(테스트). 미지정 시 상태파일에서 읽고, 방송 성공 시 파일에 기록.
 * @returns {Promise<{sent, slot, dedupKey, reason}>}
 */
async function dispatchTyphoon(typhoonJson, opts = {}) {
    const typhoons = _activeTyphoons(typhoonJson);
    if (typhoons.length === 0) {
        return { sent: 0, slot: null, dedupKey: null, reason: 'no_active' };
    }

    // 트리거 후보: 슬롯이 잡히는(=윈도 안) 통보문을 가진 태풍들 중 첫 dedupKey 채택.
    //   (같은 슬롯/날이면 dedupKey 동일 — 복수 태풍이어도 단일 키로 1회만 방송.)
    let triggerKey = null, triggerSlot = null;
    for (const t of typhoons) {
        const slot = slotOfTmFc(t.latestTmFc);
        if (!slot) continue;
        triggerKey = dedupKey(t.latestTmFc);
        triggerSlot = slot;
        if (triggerKey) break;
    }
    if (!triggerKey) {
        return { sent: 0, slot: null, dedupKey: null, reason: 'no_window' };
    }

    const lastKey = (opts.lastKey != null) ? opts.lastKey : _readLastKey();
    if (triggerKey === lastKey) {
        return { sent: 0, slot: triggerSlot, dedupKey: triggerKey, reason: 'already_sent' };
    }

    const getConsents = opts.getConsents || (() => require('./location_alert_store').getActiveConsents());
    const tokens = selectTargetTokens(getConsents());
    if (tokens.length === 0) {
        // 동의자 없음 → 상태(dedupKey) 갱신하지 않음 → 동의자 생기면 같은 슬롯에서 다음 주기에 방송.
        return { sent: 0, slot: triggerSlot, dedupKey: triggerKey, reason: 'no_targets' };
    }

    const sendFn = opts.sendFn || _defaultSendFn;
    const message = buildTyphoonWakeMessage(triggerKey);
    const result = await sendFn(tokens, message);

    // 방송 성공 시에만 dedupKey 갱신(상태파일). 테스트가 lastKey 를 주입했으면 파일은 건드리지 않는다.
    if (opts.lastKey == null) _writeLastKey(triggerKey);

    if (opts.record !== false) {
        const count = (result && Number.isFinite(result.successCount)) ? result.successCount : tokens.length;
        recordHistory(_summaryOf(typhoons, triggerSlot), count);
    }

    return { sent: tokens.length, slot: triggerSlot, dedupKey: triggerKey, reason: 'sent', result };
}

/**
 * 디스크의 typhoon.json 을 읽어 dispatchTyphoon 수행. 스케줄러 hook 이 호출(가드됨).
 *   - 파일 없음/파싱 실패 → no_file(방송 안 함).
 *   - 부팅/첫 실행으로 상태파일이 비어 있고(lastKey==='') 트리거가 잡히면:
 *       즉시 방송하지 않고 baseline(현재 dedupKey)만 기록한다(특보 dispatchOnLatest 의 sig==='' 처리와 동형).
 *   - 완전 방어적 — 절대 throw 하지 않는다.
 */
async function dispatchTyphoonOnLatest(opts = {}) {
    try {
        let json = null;
        try { json = JSON.parse(fs.readFileSync(_TYPHOON_FILE, 'utf8')); }
        catch (_) { return { sent: 0, reason: 'no_file' }; }

        const typhoons = _activeTyphoons(json);
        if (typhoons.length === 0) return { sent: 0, reason: 'no_active' };

        // 현재 트리거 키 계산(슬롯 안 통보문 우선).
        let curKey = null;
        for (const t of typhoons) {
            const k = dedupKey(t.latestTmFc);
            if (k) { curKey = k; break; }
        }

        const lastKey = _readLastKey();
        // 부팅/첫 실행 baseline: 상태가 비어 있으면 즉시 방송하지 않고 현재 키만 기록(있을 때만).
        if (lastKey === '') {
            if (curKey) _writeLastKey(curKey);
            return { sent: 0, reason: 'baseline', dedupKey: curKey };
        }

        return await dispatchTyphoon(json, opts);
    } catch (e) {
        try { console.error('[TyphoonRadiusDispatch] dispatchTyphoonOnLatest 실패(무시):', e && e.message); } catch (_) { /* 이미 예외 처리 중이다 — 로그 출력마저 막힌 환경이면 더 할 일이 없다 */ }
        return { sent: 0, reason: 'error' };
    }
}

module.exports = {
    slotOfTmFc, kstDateOfTmFc, dedupKey,
    selectTargetTokens, buildTyphoonWakeMessage, _defaultSendFn, recordHistory,
    dispatchTyphoon, dispatchTyphoonOnLatest,
    _SIG_FILE, _TYPHOON_FILE,
};
