/**
 * test_location_alert_background.js — 백그라운드 위치 모듈의 순수 헬퍼 검증
 * 실행: node local_server/scripts/test_location_alert_background.js
 * 대상: isStale(rec, nowMs, maxMs) — 낡음 가드 판정의 경계/방어성.
 *   (start/stop 등 네이티브 의존 경로는 단위 테스트 대상이 아님 — 순수 함수만 검증.)
 */
'use strict';

const BG = require('../js/location_alert_background.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

check('STALE_MAX_MS = 12h', BG.STALE_MAX_MS === 12 * 60 * 60 * 1000, String(BG.STALE_MAX_MS));
check('isStale export 됨', typeof BG.isStale === 'function');

const MAX = BG.STALE_MAX_MS;
const now = Date.parse('2026-06-25T12:00:00.000Z');

console.log('\n[1] 방금 저장 → 낡지 않음(false)');
const fresh = { at: new Date(now - 5 * 60 * 1000).toISOString() }; // 5분 전
check('fresh → false', BG.isStale(fresh, now, MAX) === false);

console.log('\n[2] 13시간 전 → 낡음(true)');
const old13 = { at: new Date(now - 13 * 60 * 60 * 1000).toISOString() };
check('13h-old → true', BG.isStale(old13, now, MAX) === true);

console.log('\n[3] 정확히 12시간 경계 직전/직후');
check('12h 직전(11h59m) → false', BG.isStale({ at: new Date(now - (12 * 60 * 60 * 1000 - 1000)).toISOString() }, now, MAX) === false);
check('12h 초과(12h1s) → true', BG.isStale({ at: new Date(now - (12 * 60 * 60 * 1000 + 1000)).toISOString() }, now, MAX) === true);

console.log('\n[4] at 누락 → false(낡지 않음으로 취급)');
check('rec 없음 → false', BG.isStale(null, now, MAX) === false);
check('at 없음 → false', BG.isStale({ lat: 35, lng: 129 }, now, MAX) === false);

console.log('\n[5] at 파싱 불가 → false');
check('unparseable at → false', BG.isStale({ at: 'not-a-date' }, now, MAX) === false);
check('빈 문자열 at → false', BG.isStale({ at: '' }, now, MAX) === false);

console.log('\n[6] 밀리초 단위 경계(>maxMs 엄격) — 12h+1ms → true, 12h-1ms → false');
check('12h+1ms → true', BG.isStale({ at: new Date(now - (MAX + 1)).toISOString() }, now, MAX) === true);
check('12h-1ms → false', BG.isStale({ at: new Date(now - (MAX - 1)).toISOString() }, now, MAX) === false);

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail ? 1 : 0);
