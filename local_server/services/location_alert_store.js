/**
 * ============================================================================
 * services/location_alert_store.js — 위치기반 특보 경보: 동의 기록 저장소 (④)
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md (§3, §10)
 *
 * "동의 사실"만 서버에 최소 기록(증거용). **위치 좌표는 저장하지 않는다.**
 * 레코드: { token, agreed, version, at, admin? }  (token = FCM 토큰, 기기 식별)
 *   admin (2026-11-19 신설) = 동의를 보낼 때 관리자 기기로 확인됐는가. 노출 범위가 '관리자만'일 때
 *     알림 대상을 거르는 데 쓴다(getTargetConsents). 한번 true 면 계속 true(관리자 로그인은 24시간·30일 뒤
 *     풀리는데, 그때마다 알림이 조용히 끊기면 안 된다). 칸이 없는 옛 레코드는 관리자로 본다 —
 *     그때는 관리자 기기만 켤 수 있었다(location_alert_ui.js 의 관리자 게이트).
 * 파일: data/location_alert_consents.json (배열). 테스트는 env로 경로 override.
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.env.LOCATION_ALERT_CONSENTS_FILE
    || path.join(__dirname, '..', 'data', 'location_alert_consents.json');

function _read() {
    try {
        const raw = fs.readFileSync(FILE, 'utf8');
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
}

function _write(arr) {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(arr, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[LocationAlertStore] write 실패:', e && e.message);
        return false;
    }
}

/**
 * 토큰 기준 upsert. agreed=false 면 동의 철회로 기록(또는 제거).
 * 예: recordConsent({token:'t1', agreed:true, admin:true}) → 레코드에 admin:true
 *     recordConsent({token:'t1', agreed:true}) (그 뒤 관리자 확인 없이 다시) → admin:true 그대로(한번 관리자면 유지)
 * @param {object} o - {token, agreed, version, at, admin} · admin=true 는 "이번 요청이 관리자 기기로 확인됨"
 * @returns {boolean} 저장했으면 true
 * [연계] ← routes/location_alert.js POST /api/location-alert/consent (관리자 확인은 거기서 한다)
 */
function recordConsent({ token, agreed, version, at, admin }) {
    if (!token) return false;
    const arr = _read();
    const idx = arr.findIndex(r => r.token === token);
    const rec = {
        token,
        agreed: !!agreed,
        version: version || null,
        at: at || new Date().toISOString(),
    };
    // 관리자 표시: 이번에 확인됐으면 true, 아니면 종전 값 유지(옛 레코드의 '칸 없음'도 그대로 둔다), 새 기기면 false.
    const adminFlag = admin === true ? true : (idx >= 0 ? arr[idx].admin : false);
    if (adminFlag !== undefined) rec.admin = adminFlag;
    if (idx >= 0) arr[idx] = rec; else arr.push(rec);
    return _write(arr);
}

/** 동의(agreed=true)한 레코드만. */
function getActiveConsents() {
    return _read().filter(r => r && r.agreed && r.token);
}

/**
 * 지금 노출 범위에서 알림(깨우는 신호)을 받을 동의 레코드만 고른다.
 * 예: 노출 'off' → [] · 'admin' → 관리자 기기 레코드만(admin 칸이 false 가 아닌 것) · 'user' → 동의한 전부
 * @param {object} [o] - {exposure} 시험 주입용. 생략하면 저장된 노출 범위를 읽는다.
 * @returns {Array} 동의 레코드 배열
 * [연계] ← location_alert_dispatch.dispatchWake · typhoon_radius_dispatch (보낼 대상) · routes/location_alert.js(대상 수 표시)
 *        → location_alert_exposure.getExposure — "숨겨진 대상에게는 알림도 보내지 않는다"(사용자 확정 2026-11-19)
 */
function getTargetConsents({ exposure } = {}) {
    const mode = exposure || require('./location_alert_exposure').getExposure();
    if (mode === 'off') return [];
    const active = getActiveConsents();
    return mode === 'user' ? active : active.filter(r => r.admin !== false);
}

/**
 * 이 토큰의 기기가 "관리자 기기로 동의해 둔 기기"인가 — 노출 '관리자만'일 때 알림을 받고 있는 기기.
 * 예: isAdminConsent('t1') → true (t1 이 동의 중이고 admin 칸이 false 가 아니면)
 * @param {string} token - FCM 토큰 @returns {boolean}
 * [연계] ← routes/location_alert.js GET /api/location-alert/exposure — 알림을 받는 기기는 설정 카드도 보여야 끌 수 있다
 */
function isAdminConsent(token) {
    if (!token) return false;
    return getActiveConsents().some(r => r.token === token && r.admin !== false);
}

function all() { return _read(); }
function count() { return getActiveConsents().length; }

module.exports = { recordConsent, getActiveConsents, getTargetConsents, isAdminConsent, all, count, _FILE: FILE };
