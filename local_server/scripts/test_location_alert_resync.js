/**
 * test_location_alert_resync.js — 앱 실행 시 재동기화(B/C) 검증
 * 실행: node local_server/scripts/test_location_alert_resync.js
 *
 * [B] resyncNativeFlags   — 네이티브 게이팅 플래그(Preferences) 재미러:
 *       "현재 저장 상태"만 미러하고, 절대 OFF→ON 으로 뒤집지 않는다.
 * [C] resyncConsentToServer — 활성+동의+push_token+네이티브일 때만
 *       POST /api/location-alert/consent {token, agreed:true, version}. 그 외 no-op.
 */
'use strict';

// ── 가짜 전역(기존 test_location_alert_ui.js 패턴) ───────────────────────────
function fakeStore() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        _map: m,
    };
}
global.localStorage = fakeStore();
global.sessionStorage = fakeStore();

const prefsMirror = new Map();
global.LocationAlertBackground = { Mirror: { set: (k, v) => prefsMirror.set(k, String(v)) } };

// 네이티브 플랫폼 + fetch 스파이 (syncConsentToServer 가 둘 다 요구)
let isNative = true;
global.Capacitor = { isNativePlatform: () => isNative, Plugins: {} };
const fetchCalls = [];
global.fetch = (url, opts) => { fetchCalls.push({ url, opts }); return Promise.resolve({ ok: true }); };

const UI = require('../js/location_alert_ui.js');
const S = UI.LocationAlertSettings;

const STORAGE_KEY = 'locationAlertSettings_v1';
const ACTIVE = 'location_alert_active';
const CONSENT = 'location_alert_consent';

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

console.log('[1] resyncNativeFlags — 저장 상태 없음 → false 미러(절대 ON 발명 금지)');
prefsMirror.clear();
UI.resyncNativeFlags();
check('active 미러 = "false"', prefsMirror.get(ACTIVE) === 'false', prefsMirror.get(ACTIVE));
check('consent 미러 = "false"', prefsMirror.get(CONSENT) === 'false', prefsMirror.get(CONSENT));
check('sub_alert 미러 = "true"(기본 ON)', prefsMirror.get('location_alert_sub_alert') === 'true');
check('sub_typhoon 미러 = "true"(기본 ON)', prefsMirror.get('location_alert_sub_typhoon') === 'true');

console.log('\n[2] resyncNativeFlags — 저장 상태 OFF 를 미러(메모리 잔재가 ON 이어도)');
// 메모리상 잔재 ON + 디스크(localStorage)는 OFF — 반드시 "저장 상태"(OFF)를 미러해야 한다.
S.data.enabled = true;
S.data.consent = { version: 'x', agreedAt: 'y' };
global.localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: false, consent: null, subAlert: true, subTyphoon: true }));
prefsMirror.clear();
UI.resyncNativeFlags();
check('저장 OFF → active 미러 "false"', prefsMirror.get(ACTIVE) === 'false', prefsMirror.get(ACTIVE));
check('저장 미동의 → consent 미러 "false"', prefsMirror.get(CONSENT) === 'false', prefsMirror.get(CONSENT));
check('메모리 상태도 저장값으로 교정', S.get().enabled === false && S.get().consent === null);

console.log('\n[3] resyncNativeFlags — 저장 상태 ON(활성+동의) → true 미러');
S.recordConsent();
S.setEnabled(true); // 실제 토글 흐름과 동일하게 저장(save→미러 포함)
prefsMirror.clear(); // 재실행 시(미러 유실 시나리오) 재미러 확인
check('resyncNativeFlags → true(성공 신호)', UI.resyncNativeFlags() === true);
check('active 미러 = "true"', prefsMirror.get(ACTIVE) === 'true', prefsMirror.get(ACTIVE));
check('consent 미러 = "true"', prefsMirror.get(CONSENT) === 'true', prefsMirror.get(CONSENT));
// 하위 토글 선호 보존: subAlert/subTyphoon=false 저장 후에도 재미러가 값 유지.
S.setSub('subAlert', false);
S.setSub('subTyphoon', false);
prefsMirror.clear();
UI.resyncNativeFlags();
check('sub_alert=false 선호 보존 미러', prefsMirror.get('location_alert_sub_alert') === 'false');
check('sub_typhoon=false 선호 보존 미러', prefsMirror.get('location_alert_sub_typhoon') === 'false');
S.setSub('subAlert', true);
S.setSub('subTyphoon', true);

console.log('\n[4] resyncConsentToServer — 활성+동의여도 push_token 없으면 no-op');
fetchCalls.length = 0;
global.localStorage.removeItem('push_token');
check('토큰 없음 → false 반환(POST 시도 안 함)', UI.resyncConsentToServer() === false);
check('fetch 호출 없음', fetchCalls.length === 0, String(fetchCalls.length));

console.log('\n[5] resyncConsentToServer — 활성+동의+토큰 → consent POST 1건');
fetchCalls.length = 0;
global.localStorage.setItem('push_token', 'PT_RESYNC_1');
check('활성+동의+토큰 → true 반환(POST 시도)', UI.resyncConsentToServer() === true);
check('fetch 1회 호출', fetchCalls.length === 1, String(fetchCalls.length));
const call = fetchCalls[0] || {};
check('URL = /api/location-alert/consent', call.url === '/api/location-alert/consent', call.url);
check('method = POST', call.opts && call.opts.method === 'POST');
let body = null;
try { body = JSON.parse(call.opts.body); } catch (_) { }
check('body.token = 저장된 push_token', body && body.token === 'PT_RESYNC_1', body && body.token);
check('body.agreed = true', body && body.agreed === true);
check('body.version = CONSENT_VERSION', body && body.version === UI.CONSENT_VERSION, body && body.version);
// 멱등: 반복 호출해도 같은 POST 반복(서버 recordConsent 는 토큰 기준 upsert → 무해).
UI.resyncConsentToServer();
check('반복 호출 → POST 2회(멱등 upsert 전제)', fetchCalls.length === 2, String(fetchCalls.length));

console.log('\n[6] resyncConsentToServer — 비활성/미동의면 토큰 있어도 no-op');
S.clear(); // enabled=false, consent=null 저장
fetchCalls.length = 0;
prefsMirror.clear();
check('OFF → false 반환', UI.resyncConsentToServer() === false);
check('fetch 호출 없음', fetchCalls.length === 0, String(fetchCalls.length));
check('부수효과로도 플래그 ON 발명 안 함', prefsMirror.get(ACTIVE) === 'false' && prefsMirror.get(CONSENT) === 'false',
    prefsMirror.get(ACTIVE) + '/' + prefsMirror.get(CONSENT));

console.log('\n[7] resyncConsentToServer — 웹(비네이티브)이면 no-op');
S.recordConsent();
S.setEnabled(true);
isNative = false;
fetchCalls.length = 0;
UI.resyncConsentToServer();
check('비네이티브 → fetch 호출 없음', fetchCalls.length === 0, String(fetchCalls.length));
isNative = true;

console.log('\n[8] 예외 내성 — fetch 부재/스토리지 예외에도 throw 없음');
const savedFetch = global.fetch;
delete global.fetch;
let threw = false;
try { UI.resyncConsentToServer(); UI.resyncNativeFlags(); } catch (_) { threw = true; }
global.fetch = savedFetch;
check('fetch 없어도 throw 없음(no-op)', threw === false);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
