/**
 * ============================================================================
 * 파일명: local_server/services/location_alert_exposure.js
 * 역할  : 설정 화면의 「위치 기반 기상 정보 제공」을 누구에게 보여 줄지(노출 범위)를 저장하고 읽는다.
 *         관리자 센터 「위치 기반」 탭의 버튼 3개 — 일반 공개 / 관리자만 노출 / 모두 비노출 — 이 이 값을 바꾼다.
 *         숨겨진 대상에게는 깨우는 신호(알림)도 보내지 않는다(location_alert_store.getTargetConsents).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음 (data/location_alert_exposure.json 만 읽고 쓴다)
 *  - 서버 API      : 없음 (routes/location_alert.js 가 이 모듈을 불러 API 로 내보낸다)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : routes/location_alert.js(노출 판정·관리자 설정) · services/location_alert_store.js(알림 대상 거르기)
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 * 값(활동지점 안전 브리핑의 노출 범위와 같은 이름 — services/station_briefing.js decideExposure):
 *   'user'  = 일반 공개      — 모든 사용자에게 보이고, 동의한 모든 기기에 알림을 보낸다.
 *   'admin' = 관리자만 노출  — 관리자 기기에만 보이고, 관리자 기기에만 알림을 보낸다. ★기본값
 *   'off'   = 모두 비노출    — 아무에게도 안 보이고, 아무에게도 알림을 보내지 않는다.
 * 파일이 없으면 기본값 'admin' — 이 기능은 처음부터 관리자 전용이었다(배포 직후 동작이 종전과 같다).
 * 파일이 있는데 깨졌으면 기본값으로 보되 서버 로그에 경고를 남긴다(조용히 넘기지 않는다).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.env.LOCATION_ALERT_EXPOSURE_FILE
    || path.join(__dirname, '..', 'data', 'location_alert_exposure.json');
const MODES = ['user', 'admin', 'off'];
const DEFAULT_MODE = 'admin';

/**
 * 지금 노출 범위를 읽는다.
 * 예: getExposure() → 'admin' (파일이 없을 때 — 기본값)
 * @returns {string} 'user' | 'admin' | 'off'
 * [연계] ← routes/location_alert.js(노출 판정) · location_alert_store.getTargetConsents(알림 대상 거르기)
 */
function getExposure() {
    let raw;
    try { raw = fs.readFileSync(FILE, 'utf8'); } catch (_) { return DEFAULT_MODE; } // 파일 없음 = 아직 안 바꿨다 → 기본값
    try {
        const mode = JSON.parse(raw).exposure;
        if (MODES.includes(mode)) return mode;
    } catch (_) { /* 아래에서 알린다 */ }
    // 파일은 있는데 못 읽는다 — 조용히 기본값으로 떨어지면 「일반 공개」였던 것이 말없이 「관리자만」이 된다(독립 검토 C).
    console.warn('[LocationAlertExposure] ⚠노출 범위 파일을 못 읽어 기본값(' + DEFAULT_MODE + ')으로 본다 — 관리자 센터 「위치 기반」에서 다시 골라 저장할 것: ' + FILE);
    return DEFAULT_MODE;
}

/**
 * 노출 범위를 저장한다.
 * 예: setExposure('user') → true · setExposure('아무값') → false(저장 안 함)
 * @param {string} mode - 'user' | 'admin' | 'off'
 * @returns {boolean} 저장했으면 true
 * [연계] ← routes/location_alert.js POST /api/admin/location-alert/exposure (관리자 센터 버튼)
 */
function setExposure(mode) {
    if (!MODES.includes(mode)) return false;
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        // 임시 파일에 쓰고 이름을 바꾼다 — 쓰는 도중 서버가 죽어도 파일이 반쯤 쓰인 채 남지 않는다(admin_auth 와 같은 방식).
        fs.writeFileSync(FILE + '.tmp', JSON.stringify({ exposure: mode, at: new Date().toISOString() }, null, 2), 'utf8');
        fs.renameSync(FILE + '.tmp', FILE);
        return true;
    } catch (e) {
        console.error('[LocationAlertExposure] 저장 실패:', e && e.message);
        return false;
    }
}

module.exports = { getExposure, setExposure, MODES, DEFAULT_MODE, _FILE: FILE };
