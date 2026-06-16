/**
 * ============================================================================
 * services/location_alert_store.js — 위치기반 특보 경보: 동의 기록 저장소 (④)
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md (§3, §10)
 *
 * "동의 사실"만 서버에 최소 기록(증거용). **위치 좌표는 저장하지 않는다.**
 * 레코드: { token, agreed, version, at }  (token = FCM 토큰, 기기 식별)
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

/** 토큰 기준 upsert. agreed=false 면 동의 철회로 기록(또는 제거). */
function recordConsent({ token, agreed, version, at }) {
    if (!token) return false;
    const arr = _read();
    const idx = arr.findIndex(r => r.token === token);
    const rec = {
        token,
        agreed: !!agreed,
        version: version || null,
        at: at || new Date().toISOString(),
    };
    if (idx >= 0) arr[idx] = rec; else arr.push(rec);
    return _write(arr);
}

/** 동의(agreed=true)한 레코드만. */
function getActiveConsents() {
    return _read().filter(r => r && r.agreed && r.token);
}

function all() { return _read(); }
function count() { return getActiveConsents().length; }

module.exports = { recordConsent, getActiveConsents, all, count, _FILE: FILE };
