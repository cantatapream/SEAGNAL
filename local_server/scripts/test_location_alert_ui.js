/**
 * test_location_alert_ui.js — 위치기반 경보 UI 로직(순수 부분) 검증
 * 실행: node local_server/scripts/test_location_alert_ui.js
 * DOM/Capacitor 없이 동작 가능한 부분만: 설정 저장·관리자 게이트·동의 기록·문안.
 */
'use strict';

// 가짜 스토리지(브라우저 localStorage 흉내)
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

const UI = require('../js/location_alert_ui.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

console.log('[1] 관리자 게이트');
check('토큰 없으면 비관리자', UI.isAdminDevice() === false);
global.localStorage.setItem('seagnal_admin_token', 'tkn_test');
check('localStorage 토큰 있으면 관리자', UI.isAdminDevice() === true);
global.localStorage.removeItem('seagnal_admin_token');
global.sessionStorage.setItem('seagnal_admin_token', 'tkn_sess');
check('sessionStorage 토큰만 있어도 관리자', UI.isAdminDevice() === true);
global.sessionStorage.removeItem('seagnal_admin_token');

console.log('\n[2] 설정/동의 저장');
const S = UI.LocationAlertSettings;
S.clear();
check('초기 enabled=false', S.get().enabled === false);
check('초기 consent=null', S.get().consent === null);
S.recordConsent();
const c = S.get().consent;
check('동의 기록 버전 일치', c && c.version === UI.CONSENT_VERSION, c && c.version);
check('동의 기록 시각 ISO', c && /\d{4}-\d{2}-\d{2}T/.test(c.agreedAt), c && c.agreedAt);
S.setEnabled(true);
check('enabled=true 저장', S.get().enabled === true);
// 영속성: 새로 init 해도 유지
S.data = { enabled: false, consent: null };
S.init();
check('재로드 후 enabled 유지', S.get().enabled === true);
check('재로드 후 consent 유지', !!S.get().consent);
S.clear();
check('clear 후 enabled=false', S.get().enabled === false);
check('clear 후 consent=null', S.get().consent === null);

console.log('\n[3] 동의 문안');
const html = UI.consentMessageHtml();
check('문안에 "휴대폰 내부에만 저장" 포함', /휴대폰 내부에만 저장/.test(html));
check('문안에 "백그라운드" 포함', /백그라운드/.test(html));
// 이벤트 기반 전환: 상시(약 15분 주기) 수집 문구 제거 → 발표·변경 시점 1회 수집 문구.
check('문안에 "발표·변경" 포함(이벤트 기반)', /발표·변경/.test(html));
check('문안에 "1회" 포함(상시 수집 아님)', /1회/.test(html));
check('문안에 "서버 등 외부로 전송" 포함', /서버 등 외부로 전송/.test(html));

console.log('\n[4] 푸시 토큰 키 (push_token — 앱 표준)');
global.localStorage.setItem('push_token', 'PT123');
check('getPushToken은 push_token 키를 읽음', UI.getPushToken() === 'PT123', UI.getPushToken());
global.localStorage.removeItem('push_token');
check('토큰 없으면 null', UI.getPushToken() === null);

console.log('\n[5] 버전 게이팅 비교(cmpVersion)');
check('동일 버전 → 0', UI.cmpVersion('1.1.3', '1.1.3') === 0);
check('구버전 < 최소 → -1', UI.cmpVersion('1.1.2', UI.NATIVE_MIN_VERSION) === -1, UI.cmpVersion('1.1.2', UI.NATIVE_MIN_VERSION));
check('상위 버전 → 1', UI.cmpVersion('1.2.0', '1.1.3') === 1);
check('1.1.10 > 1.1.3 (숫자 비교)', UI.cmpVersion('1.1.10', '1.1.3') === 1);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
