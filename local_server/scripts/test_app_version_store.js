/**
 * test_app_version_store.js — 앱 최신 버전 정보가 「관리자 [적용]만으로」 바뀌고, 배포 뒤에도 남는지 검증
 * 실행: node local_server/scripts/test_app_version_store.js
 *
 * 대상: local_server/services/app_version_store.js · routes/version.js(GET /api/app-version) · routes/admin.js(POST 가 store 를 쓰는지)
 * 사용자 확정(2026-11-20): 「적용만으로 끝나게 고쳐놓고 진행하자. 그래야 만약에 문제있어서 1.1.1 버전 3으로 적용만 하면 바로 적용되는거잖아.」
 * 종전에는 [적용]이 client/app_version.json 에 써서, main 에 무엇이든 머지해 서버가 다시 배포되면 저장소 값으로 덮였다.
 * 실제 파일을 건드리지 않게 임시 폴더를 쓴다(APP_VERSION_FILE · APP_VERSION_SEED_FILE).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra === undefined ? '' : JSON.stringify(extra)}`); }
}

const root = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'appver-'));
const SAVED = path.join(tmp, 'data', 'app_version.json');
const SEED = path.join(tmp, 'seed.json');
fs.writeFileSync(SEED, JSON.stringify({ latestVersion: '1.1.1', latestVersionCode: 3, minVersion: '1.0.0', updateMessage: '처음 메시지', playStoreUrl: 'https://play.google.com/store/apps/details?id=com.seagnal.app' }));
process.env.APP_VERSION_FILE = SAVED;
process.env.APP_VERSION_SEED_FILE = SEED;

const warns = [];
const origWarn = console.warn;
console.warn = (...x) => warns.push(x.join(' '));
const store = require('../services/app_version_store');

/** routes/version.js 만 붙인 작은 서버로 GET /api/app-version 을 한 번 부른다. */
async function getApi() {
    const express = require('express');
    const app = express();
    app.use(require('../routes/version'));
    const srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    const port = srv.address().port;
    const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/api/app-version`, (r) => {
            let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => resolve({ status: r.statusCode, cache: r.headers['cache-control'], body: b ? JSON.parse(b) : null }));
        }).on('error', reject);
    });
    srv.close();
    return res;
}

(async () => {
    console.log('[1] 아직 한 번도 [적용]하지 않았다 — 저장소의 처음 값(client/app_version.json)을 준다');
    check('저장 경로는 바꿔 끼운 임시 경로', store._FILE === SAVED && store._SEED_FILE === SEED);
    let v = store.read();
    check('처음 값 1.1.1 / 3', v && v.latestVersion === '1.1.1' && v.latestVersionCode === 3, v);
    let r = await getApi();
    check('GET /api/app-version → 200 · 처음 값', r.status === 200 && r.body.latestVersion === '1.1.1', r);
    check('캐시하지 말라고 알린다(적용이 바로 보이게)', r.cache === 'no-store', r.cache);

    console.log('[2] 관리자 [적용] 1.3.0 / 17 — 저장 즉시 API 가 새 값을 준다');
    const msg = '🔔 알림이 화면 위에 바로 떠요 | 특보·공지를 놓치지 않게\n⬇️ 다음부터는 앱 안에서 바로 업데이트 | 스토어에 가지 않아도 돼요';
    const saved = store.write({ latestVersion: '1.3.0', latestVersionCode: 17, updateMessage: msg });
    check('저장한 값을 돌려준다', saved.latestVersion === '1.3.0' && saved.latestVersionCode === 17 && saved.updateMessage === msg);
    check('지워지지 않는 곳(data)에 파일이 생겼다', fs.existsSync(SAVED));
    check('임시 파일이 남지 않는다', !fs.existsSync(SAVED + '.tmp'));
    check('스토어 주소·최소 버전 같은 다른 칸은 그대로 남는다', saved.playStoreUrl === 'https://play.google.com/store/apps/details?id=com.seagnal.app' && saved.minVersion === '1.0.0', saved);
    r = await getApi();
    check('GET /api/app-version → 1.3.0 / 17 / 메시지', r.body.latestVersion === '1.3.0' && r.body.latestVersionCode === 17 && r.body.updateMessage === msg, r.body);

    console.log('[3] 배포 = 저장소 파일(client/app_version.json)만 새로 깔린다 — 적용한 값이 남는다');
    fs.writeFileSync(SEED, JSON.stringify({ latestVersion: '1.1.1', latestVersionCode: 3, updateMessage: '배포로 다시 깔린 처음 값' }));
    r = await getApi();
    check('배포 뒤에도 1.3.0 그대로(저장소 값으로 덮이지 않는다)', r.body.latestVersion === '1.3.0' && r.body.latestVersionCode === 17, r.body);

    console.log('[4] 문제가 생겨 되돌리기 — [적용] 1.1.1 / 3 한 번이면 바로 바뀐다');
    store.write({ latestVersion: '1.1.1', latestVersionCode: 3, updateMessage: msg });
    r = await getApi();
    check('GET /api/app-version → 1.1.1 / 3', r.body.latestVersion === '1.1.1' && r.body.latestVersionCode === 3, r.body);
    check('메시지 칸을 안 보내면 기존 메시지를 지우지 않는다', store.write({ latestVersion: '1.1.1', latestVersionCode: 3 }).updateMessage === msg);

    console.log('[5] 저장 파일이 깨졌다 — 처음 값으로 보되 조용히 넘기지 않는다');
    fs.writeFileSync(SAVED, '{깨진 json');
    warns.length = 0;
    v = store.read();
    check('처음 값으로 본다', v && v.updateMessage === '배포로 다시 깔린 처음 값', v);
    check('서버 로그에 경고를 남긴다', warns.some((w) => /저장된 버전 파일을 못 읽어/.test(w)), warns);
    const after = store.write({ latestVersion: '1.3.0', latestVersionCode: 17 });
    check('다시 [적용]하면 고쳐진다', after.latestVersion === '1.3.0' && JSON.parse(fs.readFileSync(SAVED, 'utf8')).latestVersionCode === 17);

    console.log('[6] 둘 다 없다 — 404(앱은 조용히 넘어간다)');
    fs.rmSync(SAVED); fs.rmSync(SEED);
    r = await getApi();
    check('GET /api/app-version → 404', r.status === 404, r.status);

    console.log('[7] 연결 — 관리자 [적용]이 이 저장소를 쓴다(옛 client 파일에 쓰지 않는다)');
    const adminSrc = fs.readFileSync(path.join(root, 'local_server', 'routes', 'admin.js'), 'utf8');
    check('admin.js POST /api/admin/app-version 이 appVersionStore.write 를 부른다', /router\.post\('\/api\/admin\/app-version'[\s\S]{0,600}appVersionStore\.write\(/.test(adminSrc));
    check('admin.js 가 client/app_version.json 에 직접 쓰지 않는다', !/APP_VERSION_FILE/.test(adminSrc) && !/'client', 'app_version\.json'/.test(adminSrc));
    const verSrc = fs.readFileSync(path.join(root, 'local_server', 'routes', 'version.js'), 'utf8');
    check('version.js 가 appVersionStore.read 로 읽는다', /appVersionStore\.read\(\)/.test(verSrc) && !/staticRoot/.test(verSrc));
    const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
    const flyToml = fs.readFileSync(path.join(root, 'fly.toml'), 'utf8');
    check('local_server/data 는 배포 이미지에 안 들어가고(볼륨) — 그래서 배포 뒤에도 남는다', /^local_server\/data$/m.test(dockerignore) && /destination = '\/app\/local_server\/data'/.test(flyToml));
    check('저장 파일은 저장소에 올리지 않는다(.gitignore)', /^local_server\/data\/app_version\.json$/m.test(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')));

    console.warn = origWarn;
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.warn = origWarn; console.error('테스트 실행 중 예외:', e); console.log(`\n결과: ${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
