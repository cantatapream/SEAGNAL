'use strict';
// ============================================================================
// [앱에서 끈 알림이 다시 켜지지 않는다] 시험 — node scripts/test_push_master_keep.js
//   2026-11-18: 폰 알림 권한이 허용돼 있으면 앱을 켤 때마다 "푸시 알림 받기"(master)를
//   켬으로 덮어써, 사용자가 앱에서 끈 설정이 다음 실행 때 풀리고 서버에도 켬으로 갔다.
//   고침: 설정에서 직접 끄면 표시(push_master_user_off)를 남기고, 앱 실행 때 표시가 있으면 안 켠다.
//   두 함수를 실제 소스에서 꺼내 가짜 저장소(localStorage)로 돌린다 — 브라우저·시각 의존 없음.
//   아래 [표] 의 각 행이 문항 하나다.
// ============================================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };

const client = path.join(__dirname, '..', '..', 'client');
const capSrc = fs.readFileSync(path.join(client, 'capacitor-plugins.js'), 'utf8');
const setSrc = fs.readFileSync(path.join(client, 'js', 'settings', 'settings.js'), 'utf8');
/** 소스에서 `function 이름(` 부터 줄 처음의 `}` 까지 꺼낸다. */
const grab = (src, name) => { const m = src.match(new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm')); return m ? m[0] : null; };
const fnAuto = grab(capSrc, 'autoEnableMasterOnGrant');
const fnMark = grab(setSrc, 'markPushMasterUserOff');
ok('두 함수를 소스에서 찾았다', !!fnAuto && !!fnMark);

const KEY = 'notificationSettings_v1', FLAG = 'push_master_user_off';
/** 폰 한 대를 흉내 낸다: 저장소 + 앱 실행(권한 허용 시 자동 켬) + 설정 저장. */
function phone() {
    const store = {};
    const ctx = {
        console: { error() { } },
        document: { getElementById: () => null },
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }
    };
    vm.createContext(ctx);
    vm.runInContext(fnAuto + '\n' + fnMark, ctx);
    const master = () => (store[KEY] ? JSON.parse(store[KEY]).master : undefined);
    return {
        store, master,
        launch(granted) { if (granted) ctx.autoEnableMasterOnGrant(); },          // initPushNotifications 의 그 자리
        save(nowOn) {                                                              // saveNotificationUI 와 같은 순서
            ctx.markPushMasterUserOff(!!master(), nowOn);
            store[KEY] = JSON.stringify(Object.assign(store[KEY] ? JSON.parse(store[KEY]) : {}, { master: nowOn }));
        }
    };
}

console.log('\n[표] 앱 실행·설정 저장 순서별 결과');
let p = phone(); p.launch(true);
ok('① 새로 설치해 권한 허용 → 켜짐', p.master() === true && !(FLAG in p.store));

p = phone(); p.launch(true); p.save(false); p.launch(true); p.launch(true);
ok('② 앱에서 끔 → 앱을 두 번 다시 켜도 그대로 끔 (고친 문제)', p.master() === false && p.store[FLAG] === '1', p.store);

p = phone(); p.launch(true); p.save(false); p.save(true); p.launch(true);
ok('③ 껐다가 다시 켬 → 표시 지워지고 켜짐 유지', p.master() === true && !(FLAG in p.store), p.store);

p = phone(); p.launch(false); p.save(false);
ok('④-1 권한 거절 상태(한 번도 켠 적 없음)에서 다른 설정 저장 → 표시 안 남김', !(FLAG in p.store), p.store);
p.launch(true);
ok('④-2 그 뒤 폰에서 권한 허용 → 자동으로 켜짐(원래 의도 유지)', p.master() === true);

p = phone(); p.launch(true); p.save(false); p.launch(false); p.launch(true);
ok('⑤ 앱에서 끈 뒤 폰 권한을 껐다 켜도 → 그대로 끔(직접 끈 것이 우선)', p.master() === false);

p = phone(); p.launch(true); p.save(false); p.save(false); p.launch(true);
ok('⑥ 끈 채로 설정을 다시 저장해도 표시 유지 → 그대로 끔', p.master() === false && p.store[FLAG] === '1');

p = phone(); p.launch(true); p.save(false);
Object.keys(p.store).forEach(k => delete p.store[k]); p.launch(true);
ok('⑦ 앱을 지웠다 다시 설치(저장소 비워짐) → 새 설치처럼 켜짐', p.master() === true);

p = phone(); p.store[KEY] = JSON.stringify({ master: true, typhoon: true, night: false }); p.launch(true);
ok('⑧ 자동 켬이 다른 설정을 지우지 않는다', JSON.parse(p.store[KEY]).typhoon === true && JSON.parse(p.store[KEY]).night === false);

console.log('\n[연결] 실제 코드가 두 함수를 그 자리에서 부른다');
ok('앱 실행: 권한 허용 확인 뒤 autoEnableMasterOnGrant() 호출', /if \(permStatus\.receive === 'granted'\) \{\s*await PushNotifications\.register\(\);\s*(\/\/[^\n]*\n\s*)*autoEnableMasterOnGrant\(\);/.test(capSrc));
ok('앱 실행 코드에 표시 확인 없는 master=true 덮어쓰기가 따로 남아 있지 않다', (capSrc.match(/\.master = true/g) || []).length === 1);
ok('설정 저장: NotificationSettings.set 보다 먼저 markPushMasterUserOff 호출', /markPushMasterUserOff\(wasOn, master\.checked\);\s*NotificationSettings\.set\(\{/.test(setSrc));
ok('저장 전 값(wasOn)은 메모리가 아니라 저장소에서 읽는다', /wasOn = !!JSON\.parse\(localStorage\.getItem\(NotificationSettings\.STORAGE_KEY\)/.test(setSrc) && !/markPushMasterUserOff\(!!NotificationSettings\.get\(\)/.test(setSrc));

console.log('\n[낡은 메모리] 실제 NotificationSettings 로 — 저장소만 바뀐 뒤의 저장');
{
    const store = {};
    const ctx = { console: { error() { } }, document: { getElementById: () => null }, window: {},
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
    vm.createContext(ctx);
    const nsSrc = setSrc.match(/^const NotificationSettings = \{[\s\S]*?^\};/m)[0].replace('const NotificationSettings', 'var NotificationSettings');
    vm.runInContext(nsSrc + '\nNotificationSettings.init();\n' + fnAuto, ctx);          // 앱 로드: 메모리 master=false
    ctx.autoEnableMasterOnGrant();                                                        // 저장소만 master=true
    ok('준비: 메모리는 끔, 저장소는 켬(어긋난 상태)', ctx.NotificationSettings.settings.master === false && JSON.parse(store[KEY]).master === true);
    vm.runInContext('NotificationSettings.set({ aiAnswer: true });', ctx);                // ai_chat [허용] 과 같은 호출
    ok('다른 설정만 저장해도 master 가 낡은 끔으로 덮이지 않는다', JSON.parse(store[KEY]).master === true && JSON.parse(store[KEY]).aiAnswer === true, store[KEY]);
}

console.log('\n[폰 권한 보고] subscribeUser 가 서버로 보내는 값 (실제 소스 실행)');
(async () => {
    const subSrc = capSrc.match(/^window\.subscribeUser = async[\s\S]*?^};/m)[0];
    const run = async (perm, opts) => {
        const store = Object.assign({ push_token: 'tok1', notificationSettings_v1: JSON.stringify({ master: true }) }, (opts && opts.store) || {});
        const sent = [];
        const ctx = { console: { log() { }, error() { } }, JSON,
            localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
            fetch: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return {}; } };
        ctx.window = { Capacitor: { Plugins: { PushNotifications: { checkPermissions: async () => { if (perm === 'throw') throw new Error('x'); return { receive: perm }; } } } } };
        vm.createContext(ctx);
        vm.runInContext(subSrc, ctx);
        await ctx.window.subscribeUser();
        return sent;
    };
    let s = await run('denied');
    ok('권한 꺼짐 → osPermission:"denied" 를 함께 보낸다', s.length === 1 && s[0].url === '/api/subscribe' && s[0].body.osPermission === 'denied' && s[0].body.token === 'tok1', s);
    ok('앱 안 설정(master)은 그대로 보낸다 — 권한 보고가 설정을 바꾸지 않는다', s[0].body.options.master === true);
    s = await run('granted');
    ok('권한 허용 → osPermission:"granted"', s[0].body.osPermission === 'granted');
    s = await run('throw');
    ok('권한 확인이 실패해도 구독 전송은 한다(권한 값만 비움)', s.length === 1 && s[0].body.osPermission === undefined, s);
    s = await run('denied', { store: { push_token: undefined } });
    ok('등록된 적 없는 기기(토큰 없음) → 아무것도 보내지 않는다', s.length === 0, s);
    ok('앱 실행: 권한이 꺼져 있고 토큰이 있으면 그 자리에서 알린다', /\} else if \(localStorage\.getItem\('push_token'\)\) \{[\s\S]{0,400}?window\.subscribeUser\(\);\s*\}\s*\};/.test(capSrc));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
})();
