/**
 * ============================================================================
 * 파일명: scripts/test_stale_reopen.js
 * 역할: 관리자가 닫아 둔 「원문신선도」 카드라도 **원문이 아직 낡아 있으면 다시 대기로
 *       돌아오는지**를 확인한다. (초보자용: "처리완료·해당없음을 눌러 놓고 실제로는
 *       원문을 안 받았을 때, 다음 점검에서 그 사실이 다시 눈에 띄는가"를 검사한다.)
 * ============================================================================
 *
 * [왜 있나 — 2026-09-20 실측 사고]
 * 관리자 화면의 「개정검토」·「원문신선도」 방이 둘 다 0건인데, 실제로는 우리 원문 6개 계층이
 * 낡아 있었다(어선원 및 어선 재해보상보험법 시행령·시행규칙, 출입국관리법 시행령·시행규칙,
 * 신항만건설 촉진법 시행령, 폐기물관리법 시행규칙). 원인은 `admrul_fresh_scanner.js` 가
 * **큐에 이미 있는 id 를 통째로 걸러낸 것**이었다 — 한 번 닫으면 그 판에 대해서는 영영 다시
 * 뜨지 않았고, 원문이 낡은 채로 남아도 화면은 계속 0 이었다.
 * 고친 뒤에도 같은 사고가 되풀이되지 않도록 기계가 매번 확인한다.
 *
 * [무엇을 검사하나]
 *  ① 닫아 둔 카드(해당없음)가 아직 낡으면 → 대기로 돌아오고 재등장 횟수가 1 이 된다
 *  ② 처리완료로 닫은 카드도 마찬가지로 돌아온다
 *  ③ 이미 대기 중인 카드는 건드리지 않는다(재등장 횟수가 붙지 않는다)
 *  ④ 큐에 없는 id 는 무시한다(새 카드 적재는 호출측이 따로 한다)
 *  ⑤ 두 번 연달아 낡게 나오면 재등장 횟수가 2 로 늘어난다
 *  ⑥ 「개정검토」 방이 "스캔 실패"와 "개정 없음"을 구별할 수 있게, 마지막 스캔 결과를
 *     읽는 통로(`readScanStatus`)와 API 응답의 `lastScan` 배선이 살아 있는지 본다
 *  ⑦ **다시 뜬 카드도 관리자 푸시로 알리는지** — 화면을 열어 봐야만 보이면 "다시 뜨게" 한 뜻이
 *     절반만 산다. 새로 나온 카드가 없어도 다시 뜬 것만으로 푸시가 나가야 한다(2026-09-20 보완).
 *
 * [연계]
 * - services/admrul_fresh_scanner.js → reopenStillStale()
 * - services/legal_amendment_scanner.js → readScanStatus()
 * - routes/legal.js → GET /api/legal/amendments 의 lastScan
 * - client/js/ai-chat/ai_chat.js → 원문신선도 카드의 "🔁 다시 뜬 카드" · 개정검토 방의 amendLastHTML()
 * - scripts/refactor/verify_all.sh → SUITES 에 등록돼 있다
 * [로드 순서] 번들 없음(서버 스크립트). `node local_server/scripts/test_stale_reopen.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const fresh = require('../services/admrul_fresh_scanner.js');
const amend = require('../services/legal_amendment_scanner.js');
const queues = require('../services/legal_admin_queues.js');

let pass = 0, fail = 0;
/** 한 가지를 확인하고 결과를 찍는다. @param {string} name @param {boolean} ok @param {string} [why] */
function check(name, ok, why) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${why ? ' — ' + why : ''}`); }
}

/** 시험용 큐 파일을 만든다. @param {object[]} rows @returns {string} 파일 경로 */
function tmpQueue(rows) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reopen-')), 'q.jsonl');
  fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return f;
}

console.log('── 닫아 둔 카드가 아직 낡으면 다시 뜨는가 ──');

const file = tmpQueue([
  { id: 'adf_aaaa1111', title: '어선원 및 어선 재해보상보험법 시행규칙', status: 'dismissed' },
  { id: 'adf_bbbb2222', title: '출입국관리법 시행령', status: 'done', reopen_count: 1 },
  { id: 'adf_cccc3333', title: '신항만건설 촉진법 시행령', status: 'pending' },
]);
// 이번 점검이 "아직 낡다"고 말한 행들(큐에 이미 있는 것 + 큐에 없는 것 하나)
const stale = [
  { id: 'adf_aaaa1111' }, { id: 'adf_bbbb2222' }, { id: 'adf_cccc3333' }, { id: 'adf_dddd4444' },
];

const back = fresh.reopenStillStale(stale, file);
const after = new Map(queues.readJsonl(file).map((e) => [e.id, e]));

const a = after.get('adf_aaaa1111') || {};
check('① 해당없음으로 닫은 카드가 대기로 돌아온다', a.status === 'pending', `status=${a.status}`);
check('① 재등장 횟수가 1 로 붙는다', a.reopen_count === 1, `reopen_count=${a.reopen_count}`);
check('① 왜 다시 떴는지 설명이 붙는다', typeof a.reopen_reason === 'string' && a.reopen_reason.includes('해당없음'),
  `reopen_reason=${a.reopen_reason}`);

const b = after.get('adf_bbbb2222') || {};
check('② 처리완료로 닫은 카드도 돌아온다', b.status === 'pending', `status=${b.status}`);
check('② 재등장 횟수가 이어서 2 가 된다', b.reopen_count === 2, `reopen_count=${b.reopen_count}`);

const c = after.get('adf_cccc3333') || {};
check('③ 이미 대기 중인 카드는 건드리지 않는다', c.status === 'pending' && c.reopen_count === undefined,
  `status=${c.status} reopen_count=${c.reopen_count}`);

check('④ 큐에 없는 id 는 무시한다', !after.has('adf_dddd4444') && !back.includes('adf_dddd4444'));
check('④ 되돌린 id 만 돌려준다', back.length === 2 && back.includes('adf_aaaa1111') && back.includes('adf_bbbb2222'),
  `back=${JSON.stringify(back)}`);

// ⑤ 같은 점검을 한 번 더 돌리면, 방금 대기로 돌아온 것은 다시 세지 않는다(대기는 그대로 둔다).
const back2 = fresh.reopenStillStale(stale, file);
const after2 = new Map(queues.readJsonl(file).map((e) => [e.id, e]));
check('⑤ 연달아 돌려도 대기 중인 것은 횟수가 더 늘지 않는다',
  back2.length === 0 && (after2.get('adf_aaaa1111') || {}).reopen_count === 1,
  `back2=${JSON.stringify(back2)} count=${(after2.get('adf_aaaa1111') || {}).reopen_count}`);

console.log('\n── 다시 뜬 카드도 관리자에게 알리는가 ──');
// 화면을 열어 봐야만 보이면 "다시 뜨게" 한 뜻이 절반만 산다 — 푸시 조건에 reopened 가 들어가야 한다.
const scannerSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'admrul_fresh_scanner.js'), 'utf8');
check('⑦ 새 카드가 없어도 다시 뜬 카드만으로 푸시를 보낸다',
  /if \(fresh\.length \|\| reopened\.length\)/.test(scannerSrc));
check('⑦ 다시 뜬 건수를 푸시 본문·데이터에 싣는다',
  /reopened: String\(reopened\.length\)/.test(scannerSrc)
  && /닫은 카드 \$\{reopened\.length\}건이 아직 낡았습니다/.test(scannerSrc));

console.log('\n── "스캔 실패"와 "개정 없음"을 가르는 배선 ──');
check('⑥ 개정감지 스캐너가 마지막 스캔 결과를 내주는 통로를 갖는다', typeof amend.readScanStatus === 'function');
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'legal.js'), 'utf8');
check('⑥ GET /api/legal/amendments 가 lastScan 을 함께 준다',
  /amendments: list, lastScan: amendmentScanner\.readScanStatus\(\)/.test(routeSrc));
const clientSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');
check('⑥ 화면이 마지막 스캔 줄을 그린다(amendLastHTML)', /function amendLastHTML\(/.test(clientSrc));
check('⑥ 스캔이 실패했을 때 "개정이 없다는 뜻이 아니다"를 말한다',
  clientSrc.includes('"개정이 없다는 뜻이 아닙니다"'));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
