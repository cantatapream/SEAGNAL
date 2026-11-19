/**
 * test_inapp_update_flow.js — 앱 안 업데이트(유연형) 화면 흐름 검증
 * 실행: node local_server/scripts/test_inapp_update_flow.js
 *
 * 대상: client/capacitor-plugins.js 의 checkAppUpdate · tryInAppUpdate · showUpdateReadyBar.
 * 사용자 확정(2026-11-19): 앱을 쓰는 동안 뒤에서 내려받고, 다 받으면 「다시 시작」.
 * ★스테이징 없이 본 서버에 바로 올라가므로, "옛 APK·스토어 밖 설치에서 종전 방식이 그대로 도는가"를
 *   가장 먼저 본다 — 이 파일은 모든 버전의 앱이 함께 받아 가는 화면 코드다.
 * 네이티브 플러그인(SeagnalAppUpdate)은 가짜로 넣는다. 실제 Play 동작은 실기기(내부 테스트)에서만 확인된다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'capacitor-plugins.js'), 'utf8');
const a = src.indexOf('// [앱 업데이트 체크]');
const b = src.indexOf('initPushNotifications();\ncheckAppUpdate();');
if (a < 0 || b < 0 || b < a) { console.log('구간을 못 찾았다 — capacitor-plugins.js 구조가 바뀌었다\n결과: 0 PASS / 1 FAIL'); process.exit(1); }
const code = src.slice(a, b) + '\n;globalThis.__t = { tryInAppUpdate, checkAppUpdate, showUpdateReadyBar };';

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra === undefined ? '' : JSON.stringify(extra)}`); }
}
const ASKED = 'seagnal_inapp_update_asked_at';

/** 가짜 화면·저장소·서버로 checkAppUpdate 를 한 번 돌린다. serverVersion = 서버가 말하는 최신 버전(앱은 1.2.3). */
async function run({ plugin, native = true, store = {}, serverVersion = '9.9.9' }) {
    const els = {}, log = [];
    const mkEl = () => ({
        id: '', _html: '',
        set innerHTML(v) {
            this._html = v;
            for (const m of v.matchAll(/id="([^"]+)"/g)) els[m[1]] = { id: m[1], listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, disabled: false, textContent: '' };
        },
        get innerHTML() { return this._html; },
    });
    const ctx = {
        console: { log: (...x) => log.push('L:' + x.join(' ')), warn: (...x) => log.push('W:' + x.join(' ')), error: (...x) => log.push('E:' + x.join(' ')) },
        document: { readyState: 'complete', body: { appendChild(el) { els[el.id] = el; } }, getElementById: (id) => els[id] || null, createElement: () => mkEl() },
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        Date, Number, String, Math, JSON, Promise,
        App: { getInfo: async () => ({ version: '1.2.3' }) },
        Browser: { open: async () => { log.push('BROWSER'); } },
        fetch: async () => ({ ok: true, json: async () => ({ latestVersion: serverVersion, updateMessage: 'm', playStoreUrl: 'u' }) }),
    };
    ctx.window = { Capacitor: { isNativePlatform: () => native, Plugins: plugin ? { SeagnalAppUpdate: plugin } : {} }, addEventListener() { } };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    await ctx.__t.checkAppUpdate();
    return { els, store, log, bar: !!els['app-update-ready-bar'], popup: !!els['app-update-overlay'] };
}
/** 가짜 네이티브 플러그인. info = check() 응답(Error 면 reject), startImpl = start() 동작. */
function mkPlugin(info, startImpl) {
    const calls = []; let lis = null;
    return {
        calls, fire: (s) => lis && lis(s),
        check: async () => { calls.push('check'); if (info instanceof Error) throw info; return info; },
        start: async () => { calls.push('start'); return startImpl ? startImpl() : { started: true, accepted: true }; },
        complete: async () => { calls.push('complete'); },
        addListener: (n, f) => { calls.push('listen:' + n); lis = f; },
    };
}
const AVAIL = { updateAvailable: true, flexibleAllowed: true, inProgress: false, downloaded: false };
const NONE = { updateAvailable: false, flexibleAllowed: false, inProgress: false, downloaded: false };

(async () => {
    let r, p;
    console.log('[1] 옛 APK·못 쓰는 경우 — 종전 방식(서버 버전 비교 → 스토어 팝업)이 그대로 돈다');
    r = await run({ plugin: null });
    check('플러그인 없음(옛 APK) + 서버가 새 버전 → 스토어 팝업', r.popup && !r.bar, r.log);
    r = await run({ plugin: null, serverVersion: '1.2.3' });
    check('플러그인 없음 + 서버도 최신 → 아무것도 안 뜸', !r.popup && !r.bar, r.log);
    r = await run({ plugin: mkPlugin(new Error('not owned')) });
    check('check 실패(스토어 밖 설치 등) → 스토어 팝업', r.popup && !r.bar, r.log);
    r = await run({ plugin: { check: async () => null, addListener() { }, start: async () => ({}) } });
    check('check 가 빈 값 → 스토어 팝업', r.popup, r.log);
    r = await run({ plugin: { check: 'x' } });
    check('플러그인 모양이 이상함(check 가 함수 아님) → 스토어 팝업', r.popup, r.log);
    p = mkPlugin({ updateAvailable: true, flexibleAllowed: false, inProgress: false, downloaded: false });
    r = await run({ plugin: p });
    check('새 버전은 있는데 유연형 불가 → 스토어 팝업, start 안 부름', r.popup && !p.calls.includes('start'), r.log);
    p = mkPlugin(AVAIL, () => { throw new Error('boom'); });
    r = await run({ plugin: p });
    check('start 실패 → 스토어 팝업 + 물은 기록 지움', r.popup && !(ASKED in r.store), [r.log, r.store]);
    r = await run({ plugin: mkPlugin(AVAIL), native: false });
    check('웹(네이티브 아님) → 아무것도 안 함', !r.popup && !r.bar);

    console.log('\n[2] 새 APK — 앱 안 업데이트');
    p = mkPlugin(NONE);
    r = await run({ plugin: p });
    check('Play 기준 최신 → 아무것도 안 뜸(서버 값과 무관), start 안 부름', !r.popup && !r.bar && !p.calls.includes('start'), r.log);
    p = mkPlugin(AVAIL);
    r = await run({ plugin: p });
    check('새 버전 + 유연형 가능 → start(Play 확인 창), 스토어 팝업 없음', p.calls.includes('start') && !r.popup && !r.bar, p.calls);
    check('물은 시각을 남긴다', ASKED in r.store);
    check('상태 리스너를 건다(installState)', p.calls.includes('listen:installState'), p.calls);
    p.fire({ status: 'pending', downloaded: false });
    check('내려받기 대기 사건으로는 띠가 안 뜬다', !r.els['app-update-ready-bar']);
    p.fire({ status: 'downloaded', downloaded: true });
    check('내려받기 완료 사건 → 「다시 시작」 띠', !!r.els['app-update-ready-bar']);
    p.fire({ status: 'downloaded', downloaded: true });
    check('완료 사건이 또 와도 띠는 하나(중복 생성 안 함)', !!r.els['app-update-ready-bar']);
    r.els['app-update-restart-btn'].listeners.click();
    await new Promise((z) => setTimeout(z, 5));
    check('[다시 시작] → complete 호출', p.calls.includes('complete'), p.calls);
    check('누르면 버튼이 잠긴다(두 번 누름 방지)', r.els['app-update-restart-btn'].disabled === true);

    p = mkPlugin(AVAIL);
    p.complete = async () => { p.calls.push('complete'); throw new Error('install failed'); };
    r = await run({ plugin: p });
    p.fire({ status: 'downloaded', downloaded: true });
    r.els['app-update-restart-btn'].listeners.click();
    await new Promise((z) => setTimeout(z, 5));
    check('complete 실패 → 버튼을 되살린다', r.els['app-update-restart-btn'].disabled === false && r.els['app-update-restart-btn'].textContent === '다시 시작');

    p = mkPlugin({ updateAvailable: false, flexibleAllowed: false, inProgress: false, downloaded: true });
    r = await run({ plugin: p });
    check('앱을 켰는데 이미 받아 둠 → 바로 띠, start 안 부름', r.bar && !r.popup && !p.calls.includes('start'), p.calls);
    p = mkPlugin({ updateAvailable: false, flexibleAllowed: false, inProgress: true, downloaded: false });
    r = await run({ plugin: p });
    check('내려받는 중 → 아무것도 안 띄우고 리스너만', !r.bar && !r.popup && !p.calls.includes('start') && p.calls.includes('listen:installState'), p.calls);

    console.log('\n[3] 다시 묻는 간격(하루)');
    p = mkPlugin(AVAIL);
    r = await run({ plugin: p, store: { [ASKED]: String(Date.now() - 3600e3) } });
    check('1시간 전에 물었으면 다시 안 묻는다(스토어 팝업도 없음)', !p.calls.includes('start') && !r.popup, p.calls);
    p = mkPlugin(AVAIL);
    r = await run({ plugin: p, store: { [ASKED]: String(Date.now() - 25 * 3600e3) } });
    check('25시간 전에 물었으면 다시 묻는다', p.calls.includes('start'), p.calls);
    p = mkPlugin(AVAIL);
    r = await run({ plugin: p, store: { [ASKED]: '깨진값' } });
    check('기록이 깨졌으면 묻는다', p.calls.includes('start'), p.calls);
    p = mkPlugin(AVAIL, () => ({ started: true, accepted: false }));
    r = await run({ plugin: p });
    check('[나중에]를 눌러도 스토어 팝업은 안 뜬다', !r.popup && ASKED in r.store, r.log);
    p = mkPlugin(AVAIL);
    r = await run({ plugin: p });
    p.fire({ status: 'failed', downloaded: false });
    check('내려받기 실패 사건 → 물은 기록을 지운다(다음 실행 때 다시 묻는다)', !(ASKED in r.store), r.store);
    p = mkPlugin(AVAIL);
    r = await run({ plugin: p });
    p.fire({ status: 'canceled', downloaded: false });
    check('내려받기 취소 사건 → 물은 기록을 지운다', !(ASKED in r.store), r.store);
    p = mkPlugin({ updateAvailable: false, flexibleAllowed: false, inProgress: false, downloaded: true });
    r = await run({ plugin: p, store: { [ASKED]: String(Date.now()) } });
    check('받아 둔 것이 있으면 간격과 무관하게 띠를 띄운다', r.bar);

    console.log('\n[4] 네이티브 쪽 약속(문자열 대조 — 이름이 어긋나면 조용히 종전 방식으로 떨어진다)');
    const java = fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'seagnal', 'app', 'update', 'AppUpdatePlugin.java'), 'utf8');
    check('플러그인 이름 SeagnalAppUpdate 가 양쪽에서 같다', /@CapacitorPlugin\(name = "SeagnalAppUpdate"\)/.test(java) && /Plugins\.SeagnalAppUpdate/.test(src));
    for (const m of ['check', 'start', 'complete']) check(`네이티브 메서드 ${m} 가 있다`, new RegExp('@PluginMethod\\s+public void ' + m + '\\(PluginCall call\\)').test(java));
    for (const k of ['updateAvailable', 'flexibleAllowed', 'inProgress', 'downloaded']) check(`check 응답 칸 ${k} 를 네이티브가 싣는다`, java.includes(`ret.put("${k}"`));
    check('사건 이름 installState 가 양쪽에서 같다', java.includes('notifyListeners("installState"') && src.includes("addListener('installState'"));
    check('사건에 status·downloaded 를 싣는다', java.includes('o.put("status"') && java.includes('o.put("downloaded"'));
    const main = fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'seagnal', 'app', 'MainActivity.java'), 'utf8');
    check('MainActivity 가 플러그인을 등록한다', /registerPlugin\(AppUpdatePlugin\.class\)/.test(main));
    const gradle = fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'build.gradle'), 'utf8');
    check('build.gradle 에 Play app-update 의존성이 있다', /com\.google\.android\.play:app-update:/.test(gradle));

    console.log('\n[5] 헤드업 알림 채널 — 매니페스트 값과 코드 값이 같은가');
    const manifest = fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
    const appJava = fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'java', 'com', 'seagnal', 'app', 'SeagnalApplication.java'), 'utf8');
    const metaM = manifest.match(/android:name="com\.google\.firebase\.messaging\.default_notification_channel_id"\s+android:value="([^"]+)"/);
    const idM = appJava.match(/PUSH_CHANNEL_ID = "([^"]+)"/);
    check('매니페스트에 기본 알림 채널 meta-data 가 있다', !!metaM);
    check('채널 id 가 매니페스트와 코드에서 같다', !!metaM && !!idM && metaM[1] === idM[1], [metaM && metaM[1], idM && idM[1]]);
    check('채널 중요도 = 높음(IMPORTANCE_HIGH)', /new NotificationChannel\(\s*PUSH_CHANNEL_ID, PUSH_CHANNEL_NAME, NotificationManager\.IMPORTANCE_HIGH\)/.test(appJava));
    check('매니페스트가 Application 클래스를 가리킨다', /<application\s+android:name="\.SeagnalApplication"/.test(manifest));
    check('채널 만들기가 try/catch 안에 있다(실패해도 앱은 뜬다)', /private void ensurePushChannel\(\) \{\s*try \{/.test(appJava));

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 실행 중 예외:', e); console.log(`\n결과: ${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
