/**
 * ============================================================================
 * 파일명: local_server/services/admin_device.js
 * 역할  : 요청한 기기가 「관리자 센터에 등록된 관리자 기기」인지 판정한다.
 *         연안 안전 브리핑의 「관리자에게만 보이기」 설정이 이 판정을 쓴다.
 *         (예전 특보 예측의 advisory/displayControl.js 안에 있던 함수를 2026-11-03 특보 예측 삭제 때 떼어 옮겼다.)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : config/server_config(DATA_DIR) · data/admin_devices.json(관리자 기기 목록 — routes/admin.js 가 씀)
 *  - 서버 API      : 없음
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : routes/station_briefing.js(노출 판정)
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 */
'use strict';
const fs = require('fs'),
    path = require('path');

let DATA_DIR;
try { ({ DATA_DIR } = require('../config/server_config')); } catch (_) { DATA_DIR = null; }
if (!DATA_DIR) DATA_DIR = path.resolve(__dirname, '..', 'data');
const ADMIN_DEVICES_FILE = path.join(DATA_DIR, 'admin_devices.json');

/**
 * 기기 식별값(FCM 토큰 또는 웹푸시 endpoint)이 등록된 관리자 기기 목록에 있나.
 * 예: isAdminDevice('fcm-token-abc') → true(목록에 {type:'fcm', token:'fcm-token-abc'} 가 있으면)
 * @param {string} deviceId @returns {boolean} 목록을 못 읽으면 false
 * [연계] ← routes/station_briefing.js who() — 「관리자에게만」 노출 판정
 */
function isAdminDevice(deviceId) {
    if (!deviceId) return false;
    try {
        const devices = JSON.parse(fs.readFileSync(ADMIN_DEVICES_FILE, 'utf8'));
        return Array.isArray(devices) && devices.some((d) =>
            d && (d.type === 'fcm' ? d.token === deviceId : (d.subscription && d.subscription.endpoint === deviceId)));
    } catch (_) { return false; }
}

module.exports = { isAdminDevice };
