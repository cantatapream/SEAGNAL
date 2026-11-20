/**
 * ============================================================================
 * 파일명: local_server/services/app_version_store.js
 * 역할  : 앱 최신 버전 정보(latestVersion · versionCode · 업데이트 메시지)를 읽고 쓴다.
 *         관리자 센터 버전 탭의 [적용]이 여기에 쓰고, 앱이 켤 때 부르는 /api/app-version 이 여기서 읽는다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : local_server/data/app_version.json (지워지지 않는 저장 공간 — Fly.io 볼륨)
 *                    client/app_version.json (처음 값 — 위 파일이 아직 없을 때만 읽는다)
 *  - 서버 API      : 없음 (routes/version.js GET /api/app-version · routes/admin.js POST /api/admin/app-version 이 부른다)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : routes/version.js · routes/admin.js · scripts/test_app_version_store.js
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 * [왜 따로 두나 — 사용자 확정 2026-11-20]
 *   종전에는 관리자 [적용]이 client/app_version.json 에 썼다. 그 파일은 서버를 새로 올릴 때(main 에 무엇이든 머지하면 자동 배포)
 *   저장소의 값으로 덮여, 적용한 값이 조용히 사라졌다. local_server/data 만 배포 뒤에도 남는다(fly.toml [[mounts]] · .dockerignore).
 *   사용자 원문: 「적용만으로 끝나게 고쳐놓고 진행하자. 그래야 만약에 문제있어서 1.1.1 버전 3으로 적용만 하면 바로 적용되는거잖아.」
 * [읽는 순서]
 *   ① data/app_version.json 이 있으면 그것(관리자가 한 번이라도 [적용]했다)
 *   ② 없으면 client/app_version.json(저장소에 든 처음 값)
 *   ①이 깨져 있으면 ②로 보되 서버 로그에 경고를 남긴다(조용히 넘기지 않는다).
 *   ★한 번 [적용]한 뒤에는 저장소의 client/app_version.json 을 고쳐도 반영되지 않는다 — 관리자 센터가 유일한 원본이다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

const FILE = process.env.APP_VERSION_FILE || path.join(DATA_DIR, 'app_version.json');
const SEED_FILE = process.env.APP_VERSION_SEED_FILE || path.join(__dirname, '..', '..', 'client', 'app_version.json');

/** JSON 파일을 읽는다. 없으면 null, 깨졌으면 'broken'. */
function readJson(file) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return null; } // 파일 없음
    try {
        const v = JSON.parse(raw);
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : 'broken';
    } catch (_) {
        return 'broken';
    }
}

/**
 * 지금 버전 정보를 읽는다.
 * 예: read() → { latestVersion:'1.3.0', latestVersionCode:17, updateMessage:'…', playStoreUrl:'…', minVersion:'1.0.0' }
 * @returns {object|null} 둘 다 없거나 깨졌으면 null
 * [연계] ← routes/version.js GET /api/app-version(앱이 켤 때마다) · write(기존 값에 덮어쓰기)
 */
function read() {
    const saved = readJson(FILE);
    if (saved && saved !== 'broken') return saved;
    if (saved === 'broken') {
        console.warn('[AppVersion] ⚠저장된 버전 파일을 못 읽어 처음 값(client/app_version.json)으로 본다 — 관리자 센터 버전 탭에서 다시 [적용]할 것: ' + FILE);
    }
    const seed = readJson(SEED_FILE);
    if (seed && seed !== 'broken') return seed;
    if (seed === 'broken') console.warn('[AppVersion] ⚠처음 값 파일도 못 읽는다: ' + SEED_FILE);
    return null;
}

/**
 * 관리자 [적용] — 기존 값(playStoreUrl·minVersion 등)은 두고 받은 칸만 바꿔 저장한다.
 * 예: write({ latestVersion:'1.3.0', latestVersionCode:17, updateMessage:'…' }) → 저장된 전체 값
 * @param {{latestVersion:string, latestVersionCode:number, updateMessage?:string}} patch
 * @returns {object} 저장한 전체 값
 * [연계] ← routes/admin.js POST /api/admin/app-version. 쓰기 실패는 던진다(라우트가 500 으로 알린다).
 */
function write(patch) {
    const next = Object.assign({}, read() || {});
    next.latestVersion = patch.latestVersion;
    next.latestVersionCode = patch.latestVersionCode;
    if (typeof patch.updateMessage === 'string') next.updateMessage = patch.updateMessage;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    // 임시 파일에 쓰고 이름을 바꾼다 — 쓰는 도중 서버가 죽어도 반쯤 쓰인 파일이 남지 않는다(location_alert_exposure 와 같은 방식).
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(FILE + '.tmp', FILE);
    return next;
}

module.exports = { read, write, _FILE: FILE, _SEED_FILE: SEED_FILE };
