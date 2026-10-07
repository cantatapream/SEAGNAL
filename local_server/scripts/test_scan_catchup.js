/**
 * test_scan_catchup.js — ★개정 스캔이 며칠 실패한 뒤에는 그 사이를 따라잡는다. (3-84)
 *
 * [왜 있나] 2026-09-28~10-07 law.go.kr TLS 장애로 매일 스캔이 실패했다. 고친 뒤에도 창은 늘 「최근 7일」 이라
 * 그 사이 공포된 개정(선원법·공유수면 시행규칙·유선도선 시행령·항만재개발법 예고·고시 5건)은 영영 창 밖이었다.
 * 50일로 다시 돌려서야 보였다(L-405). 창을 「마지막 성공 스캔 이후 + 여유」 로 넓힌다.
 *
 * [무엇을 고정하나 — 망 없이]
 *  C1 기록 없음·어제 성공 → 7일(종전과 같다)
 *  C2 마지막 성공 10일 전 → 12일(10 + 여유 2)
 *  C3 실패 기록이 덮어써도 lastOkAt 으로 마지막 성공을 기억한다 · 옛 기록(lastOkAt 없음, ok:false)은 7일
 *  C4 100일 전이면 60일에서 자른다(탐지 시간 제한 30분 안)
 *  C5 runAmendmentScan 이 이 창으로 탐지를 부르고, 상태에 실제 창과 lastOkAt 을 남긴다(정적)
 *  C6 「⏪ 60일 따라잡기」 — 관리자가 days 를 주면 그 창(60 상한)으로 돈다: 라우트 body.days → startAmendmentScan → 화면 버튼
 *     (이미 lastOkAt 없이 실패를 덮어쓴 운영 기록은 자동으로 못 따라잡는다 — 이 버튼이 그 한 번을 메운다)
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES → services/legal_amendment_scanner.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../services/legal_amendment_scanner.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else {
    fail++; console.log(`  ❌ ${name}`); if (extra !== undefined) console.log('     ', JSON.stringify(extra));
  }
}
const NOW = Date.parse('2026-10-07T16:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();

console.log('\n── 창 계산 ──');
ok('C1 기록 없음 → 7일', S.scanWindowDays(null, NOW) === 7, S.scanWindowDays(null, NOW));
ok('C1 어제 성공 → 7일', S.scanWindowDays({ ok: true, startedAt: ago(1) }, NOW) === 7, S.scanWindowDays({ ok: true, startedAt: ago(1) }, NOW));
ok('C2 10일 전 성공 → 12일', S.scanWindowDays({ ok: true, startedAt: ago(10) }, NOW) === 12, S.scanWindowDays({ ok: true, startedAt: ago(10) }, NOW));
ok('C3 실패 기록 위에서도 lastOkAt(10일 전)을 따른다', S.scanWindowDays({ ok: false, startedAt: ago(0), lastOkAt: ago(10) }, NOW) === 12);
ok('C3 lastOkAt: 실패면 lastOkAt, 성공이면 startedAt', S.lastOkAt({ ok: false, lastOkAt: 'X' }) === 'X' && S.lastOkAt({ ok: true, startedAt: 'Y' }) === 'Y' && S.lastOkAt({ ok: false, startedAt: 'Z' }) === null);
ok('C3 옛 실패 기록(lastOkAt 없음) → 7일(추측하지 않는다)', S.scanWindowDays({ ok: false, startedAt: ago(30) }, NOW) === 7);
ok('C4 100일 전 → 60일에서 자른다', S.scanWindowDays({ ok: true, startedAt: ago(100) }, NOW) === 60);

console.log('\n── 쓰는 자리 ──');
const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'legal_amendment_scanner.js'), 'utf8');
const body = src.slice(src.indexOf('async function runAmendmentScan'), src.indexOf('function notifyAdmins'));
ok('C5 runAmendmentScan 이 scanWindowDays 로 탐지를 부른다', /: scanWindowDays\(prevStatus\)/.test(body) && /runDetectScript\(days\)/.test(body) && !/runDetectScript\(DETECT_DAYS\)/.test(body));
ok('C5 상태에 실제 창(days)과 lastOkAt 을 남긴다', /finishedAt: new Date\(\)\.toISOString\(\), days,/.test(body) && /lastOkAt: r\.ok \? startedAt : lastOkAt\(prevStatus\)/.test(body));

ok('C6 runAmendmentScan(opts.days) 가 자동 창보다 먼저, 60 상한으로', /const asked = Math\.floor\(Number\(opts && opts\.days\)\)/.test(body) && /Math\.min\(CATCHUP_MAX_DAYS, asked\)/.test(body) && S.CATCHUP_MAX_DAYS === 60);
ok('C6 startAmendmentScan 이 opts 를 넘긴다', /function startAmendmentScan\(opts\)[\s\S]{0,200}runAmendmentScan\(opts\)/.test(src));
const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'legal.js'), 'utf8');
ok('C6 POST scan-now 가 body.days 를 받는다', /scan-now', adminAuth\.requireAdminToken[\s\S]{0,200}req\.body && req\.body\.days[\s\S]{0,120}startAmendmentScan\(days \? \{ days \} : undefined\)/.test(routes));
const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');
const room = ui.slice(ui.indexOf('function renderAmendCards'), ui.indexOf('var scanPollTimer'));
ok('C6 개정검토 방에 「⏪ 60일 따라잡기」 버튼이 days:60 으로 부른다', /id="nryaAmendCatchupBtn"/.test(room) && /runScan\(\{ days: 60 \}\)/.test(room) && /legalPost\('\/api\/legal\/amendments\/scan-now', body\)/.test(room));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
