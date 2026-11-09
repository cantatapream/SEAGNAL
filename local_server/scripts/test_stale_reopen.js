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
 *  ⑧ 거꾸로 **대기 중인데 이번 점검에서 현행으로 확인된 카드는 자동으로 닫히는지**(2026-11-03 · 3-97,
 *     `closeNowFresh()`). 「확인 못 한 것」(행 없음·응답없음·이름만 같은 문서·사본 중 하나만 새 판)은 닫지 않는다.
 *  ⑨ 제목이 바뀐 카드(이름바뀜의심)는 **원문 파일 경로**로 짝지어 닫는지, 파일이 없어졌거나 낡은 행에 걸리면 안 닫는지,
 *     현행본이 따로 있는 보존본은 감시에서 빠지는지(2026-11-09 · 운영 29장 실측).
 *
 * [연계]
 * - services/admrul_fresh_scanner.js → reopenStillStale() · closeNowFresh()
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

console.log('\n── ⑧ 이제 현행으로 확인된 대기 카드는 점검이 자동으로 닫는가 (2026-11-03 · 3-97) ──');
// 원문을 다시 받아도 사람이 누를 때까지 카드가 남아, 화면 숫자가 「아무도 안 닫은 카드」가 됐었다.
// 기계가 「현행」이라고 확인한 것만 닫고, 「확인 못 한 것」은 절대 닫지 않는지 본다.
const q8 = tmpQueue([
  { id: 'adf_f1', title: '항만부잔교시설 관리규정', tier: '행정규칙', slug: '', status: 'pending' },                // 현행 → 닫힘
  { id: 'adf_f2', title: '수산업법 시행령', tier: '시행령', slug: '수산업법', status: 'pending' },                  // 법령 현행 → 닫힘
  { id: 'adf_f3', title: '목포항 예선운영세칙', tier: '행정규칙', slug: '', status: 'pending' },                    // 아직 구버전 → 그대로
  { id: 'adf_f4', title: '긴급구조지원기관 능력평가에 관한 규정', tier: '행정규칙', slug: '', status: 'pending' },  // same_name_note → 그대로
  { id: 'adf_f5', title: '선박 미수입 사실신고 절차', tier: '행정규칙', slug: '', status: 'pending' },              // 사본 둘 중 하나만 새 판 → 그대로
  { id: 'adf_f6', title: '보고서에 행이 없는 고시', tier: '행정규칙', slug: '', status: 'pending' },               // 행 없음(실패·개명) → 그대로
  { id: 'adf_f7', title: '이미 해당없음으로 닫은 고시', tier: '행정규칙', slug: '', status: 'dismissed' },          // 닫힌 것은 손대지 않음
  { id: 'adf_f8', title: '응답없던 고시', tier: '행정규칙', slug: '', status: 'pending' },                          // 응답없음 → 그대로
  { id: 'adf_f9', title: '부산광역시 수산업 조례', tier: '조례', slug: '부산광역시_수산업조례', status: 'pending' }, // 조례 현행 → 닫힘(시행일 판정)
  { id: 'adf_fa', title: '수산업법 시행령', tier: '시행규칙', slug: '수산업법', status: 'pending' },                // 같은 제목·다른 계층 → 그대로
]);
const rows8 = [
  { title: '항만부잔교시설 관리규정', verdict: '현행', held_ids: ['2100000286894'], current: { serial: '2100000286894' } },
  { title: '수산업법 시행령', tier: '시행령', slug: '수산업법', verdict: '현행', held_ids: ['291000'], current: { serial: '291000' } },
  { title: '목포항 예선운영세칙', verdict: '구버전', held_ids: ['1'], current: { serial: '2' } },
  { title: '긴급구조지원기관 능력평가에 관한 규정', verdict: '현행', held_ids: ['2100000249244'],
    current: { serial: '2100000280102' }, same_name_note: '보유 ID 는 지금도 현행(Y)이다 — 사람이 확인' },
  { title: '선박 미수입 사실신고 절차', verdict: '현행', held_ids: ['2100000287000', '2100000270000'], current: { serial: '2100000287000' } },
  { title: '응답없던 고시', verdict: '응답없음', held_ids: ['9'], current: {} },
  { title: '이미 해당없음으로 닫은 고시', verdict: '현행', held_ids: ['7'], current: { serial: '7' } },
  { title: '부산광역시 수산업 조례', tier: '조례', slug: '부산광역시_수산업조례', verdict: '현행', held_ids: ['100'], current: { serial: '101' } },
];
const closed8 = fresh.closeNowFresh(rows8, q8);
const a8 = new Map(queues.readJsonl(q8).map((e) => [e.id, e]));
const st8 = (id) => (a8.get(id) || {}).status;
check('⑧ 현행으로 확인된 고시 카드가 처리완료로 닫힌다', st8('adf_f1') === 'done', `status=${st8('adf_f1')}`);
check('⑧ 닫은 이유·닫은 주체(점검)가 카드에 남는다',
  (a8.get('adf_f1') || {}).decidedBy === '점검(자동 확인)' && (a8.get('adf_f1') || {}).auto_closed === true
  && /현행 2100000286894/.test((a8.get('adf_f1') || {}).auto_close_reason || ''));
check('⑧ 법령 계층 카드도 계층·폴더가 맞으면 닫힌다', st8('adf_f2') === 'done', `status=${st8('adf_f2')}`);
check('⑧ 조례는 시행일 판정을 믿고 닫는다(번호가 달라도)', st8('adf_f9') === 'done', `status=${st8('adf_f9')}`);
check('⑧ 아직 구버전이면 닫지 않는다', st8('adf_f3') === 'pending');
check('⑧ 「이름만 같은 다른 문서」 메모가 붙은 현행은 닫지 않는다(사람 확인)', st8('adf_f4') === 'pending');
check('⑧ 같은 제목 사본 중 하나만 새 판이면 닫지 않는다', st8('adf_f5') === 'pending');
check('⑧ 보고서에 행이 없으면(점검 실패·이름 바뀜) 닫지 않는다', st8('adf_f6') === 'pending');
check('⑧ 응답없음은 「현행」이 아니다 — 닫지 않는다', st8('adf_f8') === 'pending');
check('⑧ 이미 닫힌 카드는 손대지 않는다', st8('adf_f7') === 'dismissed' && !(a8.get('adf_f7') || {}).auto_closed);
check('⑧ 같은 제목이라도 계층이 다르면 닫지 않는다', st8('adf_fa') === 'pending');
check('⑧ 돌려준 목록이 실제로 닫은 것과 같다',
  JSON.stringify(closed8.slice().sort()) === JSON.stringify(['adf_f1', 'adf_f2', 'adf_f9']), JSON.stringify(closed8));
// 닫은 뒤 다시 낡게 나오면 기존 규칙대로 다시 뜬다(자동 닫기가 「다시 띄우기」를 막지 않는다).
const back8 = fresh.reopenStillStale([{ id: 'adf_f1' }], q8);
// 검토 A-1 · C-1(2026-11-03): 조례의 「시행예정 판뿐」 행은 확인 못 한 것 · 같은 id 줄 두 개는 한 번만 센다.
const q8b = tmpQueue([
  { id: 'adf_o1', title: '경상남도 낚시 조례', tier: '조례', slug: '경상남도_낚시조례', status: 'pending' },
  { id: 'adf_d1', title: '항만부잔교시설 관리규정', tier: '행정규칙', slug: '', status: 'pending' },
  { id: 'adf_d1', title: '항만부잔교시설 관리규정', tier: '행정규칙', slug: '', status: 'pending' },
]);
const closed8b = fresh.closeNowFresh([
  { title: '경상남도 낚시 조례', tier: '조례', slug: '경상남도_낚시조례', verdict: '현행', held_ids: ['5'], current: null,
    pending: [{ serial: '6', issued: '20271201' }], note: '현행 목록의 판이 시행예정이다 — 지금 시행 중인 판과는 따로 견주지 못했다.' },
  rows8[0],
], q8b);
check('⑧ 조례라도 시행예정 판뿐(현행 판 없음)이면 닫지 않는다', !closed8b.includes('adf_o1')
  && (new Map(queues.readJsonl(q8b).map((e) => [e.id, e])).get('adf_o1') || {}).status === 'pending', JSON.stringify(closed8b));
check('⑧ 같은 id 줄이 둘이어도 닫은 수는 한 번만 센다', JSON.stringify(closed8b) === JSON.stringify(['adf_d1']), JSON.stringify(closed8b));
check('⑧ 자동으로 닫은 카드도 또 낡게 나오면 다시 뜬다', back8.length === 1
  && (new Map(queues.readJsonl(q8).map((e) => [e.id, e])).get('adf_f1') || {}).status === 'pending');
check('⑧ 점검이 성공한 쪽 행(allRows)으로 자동 닫기를 부르고 그 수를 상태에 적는다',
  /closeNowFresh\(allRows\)/.test(scannerSrc) && /autoClosed: autoClosed\.length/.test(scannerSrc));
check('⑧ 화면 상태줄이 자동으로 닫은 수를 보여 준다', /last\.autoClosed/.test(clientSrc));

console.log('\n── ⑨ 제목이 바뀐 카드는 원문 파일 경로로 짝지어 닫는가 (2026-11-09) ──');
// 운영 29장 실측: 이름바뀜의심 카드는 옛 이름으로 적혀 있어, 원문을 새 이름 현행판으로 받아도 제목 열쇠로는 안 닫혔다.
const P1 = 'raw/15_관련타부처/출입국관리법/행정규칙/외국인자동출입국심사이용대상자등록요건및절차.txt';
const P2 = 'raw/04_선박해운/항로표지법/행정규칙/항로표지장비및용품의표준화규정.txt';   // 지금은 없는 파일(대체됨)
const P3 = 'raw/03_해상교통안전/선박의입항및출항등에관한법률/행정규칙/목포항예선운영세칙.txt';
const q9 = tmpQueue([
  { id: 'adf_r1', title: '외국인 자동출입국심사 이용대상자 등록 요건 및 절차', tier: '행정규칙', slug: '', status: 'pending', files: [P1] },
  { id: 'adf_r2', title: '항로표지 장비 및 용품의 표준화 규정', tier: '행정규칙', slug: '', status: 'pending', files: [P2] },
  { id: 'adf_r3', title: '옛 이름 두 사본 고시', tier: '행정규칙', slug: '', status: 'pending', files: [P1, P3] },
  { id: 'adf_r4', title: '파일 칸이 빈 옛 카드', tier: '행정규칙', slug: '', status: 'pending', files: [] },
]);
const rows9 = [
  { title: '외국인의 자동출입국심사 이용대상자 등록 요건 및 절차', verdict: '현행', held_ids: ['2100000286852'],
    current: { serial: '2100000286852' }, files: [P1] },
  { title: '목포항 예선운영세칙', verdict: '구버전', held_ids: ['1'], current: { serial: '2' }, files: [P3] },
];
const closed9 = fresh.closeNowFresh(rows9, q9);
const a9 = new Map(queues.readJsonl(q9).map((e) => [e.id, e]));
check('⑨ 제목이 바뀌었어도 카드 파일이 이번에 현행으로 확인되면 닫는다', (a9.get('adf_r1') || {}).status === 'done',
  JSON.stringify(closed9));
check('⑨ 경로로 짝지었다는 사실과 지금 제목이 닫은 이유에 남는다',
  /원문 파일 경로로 짝지었습니다/.test((a9.get('adf_r1') || {}).auto_close_reason || '')
  && /외국인의 자동출입국심사/.test((a9.get('adf_r1') || {}).auto_close_reason || ''));
check('⑨ 카드 파일이 이번 점검에 없으면(대체·삭제) 닫지 않는다 — 수집 누락을 덮지 않는다', (a9.get('adf_r2') || {}).status === 'pending');
check('⑨ 카드 파일 중 하나라도 아직 낡은 행에 걸리면 닫지 않는다', (a9.get('adf_r3') || {}).status === 'pending');
check('⑨ 파일 칸이 빈 카드는 경로로 짝짓지 않는다', (a9.get('adf_r4') || {}).status === 'pending');
const afSrc = fs.readFileSync(path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'loop', 'admrul_fresh.py'), 'utf8');
check('⑨ 같은 제목에 현행본이 있으면 보존본은 감시에서 뺀다(보존본 옛 번호가 held_ids 에 섞여 영영 안 닫히던 것)',
  /live = \[f for f in fs_ if not is_archive\(t, f\['path'\]\)\]/.test(afSrc));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
