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
const code = src.slice(a, b) + '\n;globalThis.__t = { tryInAppUpdate, checkAppUpdate, showUpdateReadyBar, parseUpdateItems };';

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra === undefined ? '' : JSON.stringify(extra)}`); }
}
const ASKED = 'seagnal_inapp_update_asked_at';

/** 가짜 화면·저장소·서버로 checkAppUpdate 를 한 번 돌린다. serverVersion = 서버가 말하는 최신 버전(앱은 1.2.3). */
async function run({ plugin, native = true, store = {}, serverVersion = '9.9.9', fireTimers = false, message = 'm' }) {
    const els = {}, log = [], timers = [];
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
        // 가짜 타이머 — 기본은 걸어만 두고 안 터뜨린다(실제 10초를 기다리지 않게). fireTimers 면 곧바로 터뜨린다.
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); if (fireTimers) Promise.resolve().then(fn); return timers.length; },
        App: { getInfo: async () => ({ version: '1.2.3' }) },
        Browser: { open: async () => { log.push('BROWSER'); } },
        fetch: async () => ({ ok: true, json: async () => ({ latestVersion: serverVersion, updateMessage: message, playStoreUrl: 'u' }) }),
    };
    ctx.window = { Capacitor: { isNativePlatform: () => native, Plugins: plugin ? { SeagnalAppUpdate: plugin } : {} }, addEventListener() { } };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    await ctx.__t.checkAppUpdate();
    return { els, store, log, timers, bar: !!els['app-update-ready-bar'], popup: !!els['app-update-overlay'] };
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
    // 독립 검토 A·B: Play 가 끝내 답하지 않으면(check 가 안 풀리면) 시간 제한 뒤 종전 방식으로 넘어가야 한다.
    p = mkPlugin(AVAIL);
    p.check = () => { p.calls.push('check'); return new Promise(() => { }); };
    r = await run({ plugin: p, fireTimers: true });
    check('check 가 끝내 안 풀림 → 시간 제한 뒤 스토어 팝업, start 안 부름', r.popup && !p.calls.includes('start'), r.log);
    check('check 시간 제한은 10초', r.timers.some((t) => t.ms === 10000), r.timers.map((t) => t.ms));
    p = mkPlugin(AVAIL);
    r = await run({ plugin: p });
    check('check 가 제때 답하면 시간 제한은 영향 없다(start 까지 간다)', p.calls.includes('start') && !r.popup, p.calls);
    // 독립 검토 B: Play 가 "모름"(UNKNOWN)이라고 답하면 "최신"으로 치지 않는다.
    p = mkPlugin({ known: false, updateAvailable: false, flexibleAllowed: false, inProgress: false, downloaded: false });
    r = await run({ plugin: p });
    check('Play 가 "모름"(known:false) → 스토어 팝업(서버 버전 비교로)', r.popup && !p.calls.includes('start'), r.log);
    // 리스너 등록이 비동기로 실패해도 흐름은 그대로(처리 안 된 거절이 남지 않는다).
    p = mkPlugin(AVAIL);
    p.addListener = () => { p.calls.push('listen:installState'); return Promise.reject(new Error('listen fail')); };
    r = await run({ plugin: p });
    await new Promise((z) => setImmediate(z));
    check('리스너 등록이 거절돼도 start 까지 간다 + 경고를 남긴다', p.calls.includes('start') && r.log.some((l) => /리스너 등록 실패/.test(l)), r.log);

    console.log('\n[2] 새 APK — 앱 안 업데이트');
    p = mkPlugin(NONE);
    r = await run({ plugin: p });
    check('Play 기준 최신 → 아무것도 안 뜸(서버 값과 무관), start 안 부름', !r.popup && !r.bar && !p.calls.includes('start'), r.log);
    p = mkPlugin(AVAIL);
    r = await run({ plugin: p });
    check('새 버전 + 유연형 가능 → start(Play 확인 창), 스토어 팝업 없음', p.calls.includes('start') && !r.popup && !r.bar, p.calls);
    check('물은 시각을 남긴다', ASKED in r.store);
    check('상태 리스너를 건다(installState)', p.calls.includes('listen:installState'), p.calls);
    check('리스너를 check 보다 먼저 건다(완료 사건을 놓치지 않게)', p.calls.indexOf('listen:installState') < p.calls.indexOf('check'), p.calls);
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
    for (const k of ['known', 'updateAvailable', 'flexibleAllowed', 'inProgress', 'downloaded']) check(`check 응답 칸 ${k} 를 네이티브가 싣는다`, java.includes(`ret.put("${k}"`));
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

    console.log('\n[6] 음성 비서 삭제(2026-11-19 사용자 지시) — 마이크·음성 모델이 APK·화면에 남아 있지 않은가');
    const root = path.join(__dirname, '..', '..');
    check('매니페스트에 마이크 권한(RECORD_AUDIO)이 없다', !/uses-permission[^>]*RECORD_AUDIO/.test(manifest));
    check('매니페스트에 마이크 전경 서비스 권한이 없다', !/uses-permission[^>]*FOREGROUND_SERVICE_MICROPHONE/.test(manifest));
    check('매니페스트에 음성 모델 내려받기 전경 서비스 권한이 없다', !/uses-permission[^>]*FOREGROUND_SERVICE_DATA_SYNC/.test(manifest));
    check('매니페스트에 음성 서비스 선언이 없다', !/android:name="\.voice\./.test(manifest));
    check('build.gradle 에 Porcupine·Vosk·JNA 의존성이 없다', !/implementation\s+'(ai\.picovoice|com\.alphacephei|net\.java\.dev\.jna)/.test(gradle));
    const voiceDir = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'seagnal', 'app', 'voice');
    check('voice 폴더에는 사용자 기억 플러그인만 남았다', JSON.stringify(fs.readdirSync(voiceDir)) === '["SeagnalAssistantPlugin.java"]', fs.readdirSync(voiceDir));
    const va = fs.readFileSync(path.join(voiceDir, 'SeagnalAssistantPlugin.java'), 'utf8');
    check('플러그인에 마이크 권한 선언이 없다', !/@Permission\(/.test(va) && !/Manifest\.permission/.test(va));
    for (const m of ['enable', 'disable', 'isEnabled', 'getCapabilities', 'requestVoskDownload', 'cancelVoskDownload', 'audioBusy']) check(`플러그인에 음성 메서드 ${m} 가 없다`, !new RegExp('public void ' + m + '\\(').test(va));
    for (const m of ['readUserProfile', 'readStyleDigest', 'readRelevantEpisodes', 'appendEpisode', 'triggerConsolidation', 'migrateLocalStorageOnce']) check(`사용자 기억 메서드 ${m} 는 그대로 있다`, new RegExp('@PluginMethod\\s+public void ' + m + '\\(PluginCall call\\)').test(va));
    check('MainActivity 가 WebView 마이크 권한을 허용하지 않는다', !/RESOURCE_AUDIO_CAPTURE|onPermissionRequest/.test(main));
    const idx = fs.readFileSync(path.join(root, 'client', 'index2.html'), 'utf8');
    check('index2.html 이 음성 오버레이를 불러오지 않는다', !/assistant_overlay\.js/.test(idx));
    const adminJs = fs.readFileSync(path.join(root, 'client', 'js', 'admin', 'admin.js'), 'utf8');
    check('관리자 화면에 마이크·음성 비서 줄이 없다', !/ai-perm-mic|ai-voice-toggle|requestVoskDownload/.test(adminJs));
    check('관리자 화면의 위치 권한 줄은 그대로 있다', /ai-perm-gps/.test(adminJs) && /wire\(Geo, 'location'/.test(adminJs));
    const asJs = fs.readFileSync(path.join(root, 'client', 'js', 'assistant', 'assistant.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    check('AI 비서 페이지 코드에 마이크 입력이 없다', !/getUserMedia|MediaRecorder|SpeechRecognition|requestVoskDownload|api\/assistant\/transcribe/.test(asJs));
    const asRoute = fs.readFileSync(path.join(root, 'local_server', 'routes', 'assistant.js'), 'utf8');
    check('서버에 받아쓰기 주소가 없다', !/router\.post\('\/api\/assistant\/transcribe'/.test(asRoute));
    // 옛 시험용 APK 에 남은 상시 청취 서비스를 끄는 정리 코드 — 새 APK·스토어판에서는 아무 일도 하지 않아야 한다.
    const tail = src.slice(src.indexOf('// [음성 비서 삭제 2026-11-19]'), src.indexOf('// [위치기반 특보 #1]'));
    const runCleanup = (plugins) => { const calls = []; const c = { window: { Capacitor: { Plugins: plugins(calls) } }, console: { warn: (...x) => calls.push('warn:' + x.join(' ')) }, Promise }; vm.createContext(c); vm.runInContext(tail, c); return calls; };
    check('정리 코드 구간을 찾았다', tail.length > 100, tail.length);
    check('옛 시험용 APK(disable 있음) → disable 을 부른다', runCleanup((calls) => ({ SeagnalAssistant: { disable: () => { calls.push('disable'); return Promise.resolve(); } } })).join() === 'disable');
    check('새 APK(disable 없음) → 아무것도 안 한다', runCleanup(() => ({ SeagnalAssistant: { readUserProfile() { } } })).length === 0);
    check('스토어판(플러그인 없음) → 아무것도 안 한다', runCleanup(() => ({})).length === 0);
    check('disable 이 던져도 모듈이 죽지 않는다', runCleanup(() => ({ SeagnalAssistant: { disable: () => { throw new Error('x'); } } })).some((x) => /warn:/.test(x)));

    console.log('[9] 업데이트 안내 창 — 시안 C(사용자 확정 2026-11-20): 바뀐 점 목록 · 버튼 안 「Play 스토어로 이동합니다」 · 「나중에」 24시간');
    const LATER = 'seagnal_update_popup_later_at';
    const MSG = '🔔 알림이 화면 위에 바로 떠요 | 특보·공지를 놓치지 않게\n그냥 한 줄\n<img src=x onerror=alert(1)> | <script>x</script>';
    r = await run({ plugin: null, message: MSG });
    const html = r.popup ? r.els['app-update-overlay']._html : '';
    check('옛 APK → 안내 창이 뜬다', r.popup);
    check('제목은 「새 버전이 나왔어요」, 버전 줄은 v현재 → v최신', /새 버전이 나왔어요/.test(html) && /v1\.2\.3 → <b>v9\.9\.9<\/b>/.test(html));
    check('버튼 안에 「업데이트하러 가기」와 작은 「Play 스토어로 이동합니다」', /id="app-update-btn">업데이트하러 가기<small>Play 스토어로 이동합니다<\/small><\/button>/.test(html));
    check('「나중에」 버튼이 있다', /id="app-update-later-btn">나중에<\/button>/.test(html));
    check('메시지 한 줄 = 목록 한 칸, 이모지는 아이콘, 「|」 뒤는 작은 설명', /update-item-icon">🔔<\/span><span class="update-item-text">알림이 화면 위에 바로 떠요<small>특보·공지를 놓치지 않게<\/small>/.test(html));
    check('이모지 없는 줄은 기본 점(•)', /update-item-icon">•<\/span><span class="update-item-text">그냥 한 줄<\/span>/.test(html));
    check('메시지 속 HTML 은 글자로만 들어간다(태그가 살아나지 않는다)', !/<img src=x|<script>x/.test(html) && /&lt;img src=x/.test(html));
    check('새 아이콘 그림을 쓴다', /src="assets\/app_update_icon\.png"/.test(html));
    r.els['app-update-btn'].listeners.click();
    await new Promise((res) => setTimeout(res, 0));
    check('[업데이트하러 가기] → Play 스토어(Browser.open)', r.log.includes('BROWSER'));
    r.els['app-update-later-btn'].listeners.click();
    const at = Number(r.store[LATER]);
    check('[나중에] → 누른 시각을 남긴다', at > 0 && Math.abs(Date.now() - at) < 5000, r.store[LATER]);
    r = await run({ plugin: null, store: { [LATER]: String(Date.now() - 60 * 60 * 1000) } });
    check('「나중에」 1시간 뒤 → 안 뜬다', !r.popup);
    r = await run({ plugin: null, store: { [LATER]: String(Date.now() - 23.9 * 60 * 60 * 1000) } });
    check('「나중에」 23.9시간 뒤 → 안 뜬다', !r.popup);
    r = await run({ plugin: null, store: { [LATER]: String(Date.now() - 24.1 * 60 * 60 * 1000) } });
    check('「나중에」 24.1시간 뒤 → 다시 뜬다', r.popup);
    r = await run({ plugin: null, store: { [LATER]: String(Date.now() - 60 * 1000) }, serverVersion: '1.2.3' });
    check('서버 버전이 같으면 「나중에」와 상관없이 안 뜬다', !r.popup);
    r = await run({ plugin: null, message: '' });
    check('메시지가 비면 목록 칸 없이 뜬다(창은 그대로)', r.popup && !/class="update-list"/.test(r.els['app-update-overlay']._html));
    // 1.3.0 이후 앱: 앱 안 업데이트가 맡으면 이 창은 뜨지 않는다(종전 동작 유지).
    p = mkPlugin(NONE);
    r = await run({ plugin: p });
    check('새 APK(Play 기준 최신) → 안내 창이 뜨지 않는다', !r.popup);
    const parse = (() => { const c = { console, Date, Number, String, Math, JSON, Promise, window: {}, document: {}, localStorage: {} }; vm.createContext(c); vm.runInContext(code, c); return c.__t.parseUpdateItems; })();
    const items = parse('👨‍👩‍👧 가족 | 조합\n🇰🇷 국기\n\n   \n⬇️ 다음부터는 앱 안에서');
    check('조합 이모지·국기·변형 문자 이모지도 아이콘 하나로 읽고 빈 줄은 건너뛴다', JSON.stringify(items.map((x) => x.icon)) === JSON.stringify(['👨‍👩‍👧', '🇰🇷', '⬇️']) && items[0].sub === '조합', items);
    check('정규식은 new RegExp 로 만든다(옛 WebView 에서 파일 전체가 문법 오류로 멈추지 않게)', /new RegExp\('\^\(\(\?:\\\\p\{Extended_Pictographic\}/.test(src) && !/\/\^\(\(\?:\\p\{Extended_Pictographic\}/.test(src));
    check('관리자 센터 미리 보기용으로 내보낸다', /window\.SeagnalUpdatePopup = \{/.test(src));
    const adminSrc = fs.readFileSync(path.join(root, 'client', 'js', 'admin', 'admin.js'), 'utf8');
    check('관리자 버전 탭에 미리 보기 버튼·입력 안내가 있다', /onclick="previewUpdatePopup\(\)"/.test(adminSrc) && /window\.previewUpdatePopup = function/.test(adminSrc) && /「\|」 뒤 = 작은 설명/.test(adminSrc));
    check('index2.html 이 바뀐 안내 창 코드를 새로 받는다(캐시 번호)', /capacitor-plugins\.js\?v=ZoneSplit2_20261128/.test(fs.readFileSync(path.join(root, 'client', 'index2.html'), 'utf8')));
    check('안내 창 아이콘 그림 파일이 있다', fs.existsSync(path.join(root, 'client', 'assets', 'app_update_icon.png')));

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('테스트 실행 중 예외:', e); console.log(`\n결과: ${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
