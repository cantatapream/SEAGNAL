/**
 * test_mok_bulk.js — ★원문결손 방: 해소된 카드 자동 닫기 · 「✓ 전체 처리」 · 지시문 .md 받기 · 버튼 잘림 (3-88)
 *
 * [왜 있나] 2026-10-08 사장님 — ①「72장을 하나씩 누를 필요가 있겠어? 전체승인 버튼있으면 좋지않아?」
 *   ②「지시문 전체를 텍스트가 아닌 마크다운 파일로 받을 수 있도록」 ③캡처에서 「📋 대기 전체 지시문」 이 화면 밖으로 잘림.
 *   점검 규칙을 고쳐(3-85) 65건이 더는 누락이 아닌데도 카드는 사람이 누를 때까지 대기로 남았다 —
 *   다시 띄우는 쪽(reopenStillMissing)만 있고 닫는 쪽이 없었다.
 *
 * [무엇을 고정하나]
 *  B1 autoResolveCleared(임시 큐 파일로 실제로 돌린다):
 *     이번 점검에 안 나온 대기 카드는 닫힌다 · 아직 나온 것은 그대로 · 원본을 못 받은 계열은 그대로(「모른다」≠「해소」)
 *     · 그쪽 점검이 실패했으면 아무것도 안 닫는다 · 발췌본이면 까닭을 적는다 · 이미 닫힌 카드는 건드리지 않는다
 *  B2 스캐너가 점검 끝에 그것을 부르고 결과(resolved)를 상태에 남긴다(정적)
 *  B3 POST /api/legal/mok-audit/decide-all — 관리자 · 대기만 · done|dismissed 만(정적)
 *  B4 지시문 .md — POST 는 관리자, GET 은 1회용 난수 토큰 · 5분 · text/markdown 첨부(정적)
 *  B5 화면 — 원문결손 머리 줄이 접힌다(잘림 고침) · 「✓ 전체 처리」 두 번 눌러 실행 · 지시문 상자 셋 모두에 「⬇ .md 파일」
 *     · 앱(웹뷰)은 서버 중계 + 시스템 브라우저로 받는다
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → services/mok_audit_scanner.js · routes/legal.js · client/js/ai-chat/ai_chat.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../services/mok_audit_scanner.js');
const Q = require('../services/legal_admin_queues.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else {
    fail++; console.log(`  ❌ ${name}`); if (extra !== undefined) console.log('     ', JSON.stringify(extra).slice(0, 600));
  }
}

console.log('\n── B1 해소된 카드 자동 닫기 ──');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mok-bulk-'));
function freshQueue() {
  const f = path.join(TMP, 'q' + Math.random().toString(36).slice(2) + '.jsonl');
  const rows = [
    { id: 'm_gone', kind: '조문 목 누락', title: '항만운송사업법 시행령', files: ['raw/10/항만운송사업법/시행령.txt'], status: 'pending' },
    { id: 'm_still', kind: '조문 목 누락', title: '하천법 시행령', files: ['raw/15/하천법/시행령.txt'], status: 'pending' },
    { id: 'm_unknown', kind: '조문 목 누락', title: '산지관리법 법률', files: ['raw/15/산지관리법/법률.txt'], status: 'pending' },
    { id: 'm_excerpt', kind: '조문 목 누락', title: '협동조합기본법 법률(법률_제2조(연결조문))', files: ['raw/15/협동조합기본법/법률_제2조(연결조문).txt'], status: 'pending' },
    { id: 'm_old', kind: '조문 목 누락', title: '도로교통법 법률', files: ['raw/15/도로교통법/법률.txt'], status: 'pending' },
    { id: 'm_closed', kind: '조문 목 누락', title: '닫힌 법 법률', files: ['x'], status: 'dismissed' },
    { id: 'a_gone', kind: '고시 별표 없음', title: '부산항 고시', files: [], status: 'pending' },
    { id: 'a_fail', kind: '고시 별표 없음', title: '조회실패 고시', files: [], status: 'pending' },
  ];
  for (const r of rows) Q.appendJsonl(f, r);
  return f;
}
const ENTRIES = [
  { id: 'm_still', kind: '조문 목 누락', title: '하천법 시행령' },
  { id: 'm_new', kind: '조문 목 누락', title: '도로교통법 법률' },   // 같은 자리 · 빠진 수가 달라져 새 id
];
const CTX = {
  mokOk: true, annexOk: true,
  noAnswer: ['산지관리법 법률 (MST=289913)'],
  annexFailed: ['조회실패 고시'],
  excerpt: [{ file: 'raw/15/협동조합기본법/법률_제2조(연결조문).txt', excerpt_why: '파일 이름' }],
};
let f = freshQueue();
const closed = S.autoResolveCleared(ENTRIES, CTX, f);
const by = Object.fromEntries(Q.readJsonl(f).map((e) => [e.id, e]));
ok('B1 이번 점검에 안 나온 대기 카드는 닫힌다(처리완료 · 자동 표시)', by.m_gone.status === 'done' && by.m_gone.auto_resolved === true && by.m_gone.decidedBy === '자동(점검)', by.m_gone);
ok('B1 아직 누락으로 나온 카드는 그대로 대기', by.m_still.status === 'pending');
ok('B1 원본을 못 받은 계열(no_answer)은 닫지 않는다 — 「모른다」 를 「해소」 로 읽지 않는다', by.m_unknown.status === 'pending');
ok('B1 발췌본으로 판정된 카드는 까닭을 적고 닫는다', by.m_excerpt.status === 'done' && /발췌본으로 판정됐다\(파일 이름\)/.test(by.m_excerpt.resolve_reason || ''), by.m_excerpt);
ok('B1 같은 자리가 새 카드로 다시 올라오면 옛 카드는 그 까닭으로 닫힌다', by.m_old.status === 'done' && /새 카드로 다시 올라왔다/.test(by.m_old.resolve_reason || ''));
ok('B1 이미 닫힌 카드는 건드리지 않는다', by.m_closed.status === 'dismissed' && !by.m_closed.auto_resolved);
ok('B1 고시 별표: 안 나온 카드는 닫고, 조회 실패한 고시는 그대로', by.a_gone.status === 'done' && by.a_fail.status === 'pending');
ok('B1 닫은 수를 돌려준다(4)', closed.length === 4, closed);

f = freshQueue();
const none = S.autoResolveCleared([], { mokOk: false, annexOk: false }, f);
ok('B1 그쪽 점검이 실패했으면 아무것도 닫지 않는다', none.length === 0 && Q.readJsonl(f).filter((e) => e.status === 'pending').length === 7, none);
f = freshQueue();
const onlyAnnex = S.autoResolveCleared([], { mokOk: false, annexOk: true, annexFailed: ['조회실패 고시'] }, f);
ok('B1 목 점검만 실패하면 목 카드는 그대로, 고시 카드만 판정', onlyAnnex.length === 1 && onlyAnnex[0] === 'a_gone', onlyAnnex);
fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n── B2 스캐너가 부른다 ──');
const scan = fs.readFileSync(path.join(__dirname, '..', 'services', 'mok_audit_scanner.js'), 'utf8');
ok('B2 점검 끝에 autoResolveCleared 를 부르고, 실패한 쪽은 mokOk/annexOk=false 로 넘긴다',
  /const resolved = autoResolveCleared\(entries, \{/.test(scan) && /mokOk: !!rep && !errors\.some/.test(scan) && /annexOk: !!arep && !errors\.some/.test(scan));
ok('B2 상태에 resolved 수를 남긴다', /resolved: resolved\.length/.test(scan));

console.log('\n── B3·B4 라우트 ──');
const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'legal.js'), 'utf8');
const da = routes.slice(routes.indexOf("router.post('/api/legal/mok-audit/decide-all'"), routes.indexOf("router.post('/api/legal/mok-audit/scan-now'"));
ok('B3 decide-all 은 관리자 전용 · done|dismissed 만 · 대기 카드만 닫는다',
  /adminAuth\.requireAdminToken/.test(da) && /decision !== 'done' && decision !== 'dismissed'/.test(da) && /\(e\.status \|\| 'pending'\) !== 'pending'/.test(da));
const bf = routes.slice(routes.indexOf('const _briefFileStore'), routes.indexOf("// POST /api/legal/mok-audit/decide-all"));
ok('B4 POST brief-file 은 관리자 전용 · 난수 토큰(crypto) · 5분', /router\.post\('\/api\/legal\/brief-file', adminAuth\.requireAdminToken/.test(bf) && /randomBytes\(18\)/.test(bf) && /5 \* 60 \* 1000/.test(bf));
ok('B4 GET brief-file/:token 은 한 번 내려받으면 지우고 text/markdown 첨부로 준다',
  /_briefFileStore\.delete\(req\.params\.token\);\s*\n\s*res\.setHeader\('Content-Type', 'text\/markdown; charset=utf-8'\)/.test(bf) && /attachment; filename=/.test(bf));

console.log('\n── B5 화면 ──');
const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');
const mok = ui.slice(ui.indexOf('function renderMokCards'), ui.indexOf('function loadMokList'));
ok('B5 원문결손 머리 줄이 접힌다(flex-wrap) — 「대기 전체 지시문」 이 화면 밖으로 잘리지 않는다',
  /class="nrya-rv-actions" style="[^"]*flex-wrap:wrap"><button class="nrya-btn-ok" id="nryaMokScanBtn" style="flex:1 1 auto/.test(mok) && /id="nryaMokBriefBtn" style="flex:1 1 auto/.test(mok));
ok('B5 「✓ 전체 처리」: 첫 클릭은 대기 건수를 묻고 확인 문구로, 두 번째 클릭에서 decide-all',
  /id="nryaMokAllBtn"/.test(mok) && /legalGet\('\/api\/legal\/mok-audit\?status=pending'\)/.test(mok) && /한 번 더 누르면 실행/.test(mok) && /legalPost\('\/api\/legal\/mok-audit\/decide-all', \{ decision: 'done' \}\)/.test(mok));
const box = ui.slice(ui.indexOf('function renderBriefBox'), ui.indexOf('function bindAmendBulk'));
ok('B5 지시문 상자에 「⬇ .md 파일」', /class="nrya-btn-md">⬇ \.md 파일</.test(box) && /downloadBriefMd\(ta\.value, fileName\)/.test(box));
const dl = ui.slice(ui.indexOf('function downloadBriefMd'), ui.indexOf('function renderBriefBox'));
ok('B5 앱(웹뷰)은 서버에 맡기고 시스템 브라우저로 받는다 · 웹은 blob',
  /isNativePlatform/.test(dl) && /legalPost\('\/api\/legal\/brief-file'/.test(dl) && /Browser\.open\(\{ url: furl \}\)/.test(dl) && /new Blob\(\[text\], \{ type: 'text\/markdown/.test(dl));
ok('B5 지시문 상자 세 곳이 각자 파일 이름을 준다', ["'개정검토_지시문'", "'개정검토_승인분_전체지시문'", "'원문결손_대기_전체지시문'"].every((n) => (ui.match(new RegExp(n, 'g')) || []).length >= 1));

console.log('\n── B6 (3-90) 도는 점검을 알린다 — 지난 점검의 실패가 지금 일로 읽히지 않게 ──');
const scanMod = require('../services/mok_audit_scanner.js');
ok('B6 점검이 안 돌면 scanState() 는 null', typeof scanMod.scanState === 'function' && scanMod.scanState() === null);
const scanSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'mok_audit_scanner.js'), 'utf8');
ok('B6 점검 단계(조문 목 → 고시 별표)를 적고, 끝나면(finally) 지운다',
  /_scanState = \{ startedAt, phase: '조문 목' \}/.test(scanSrc) && /_scanState = \{ startedAt, phase: '고시 별표' \}/.test(scanSrc) && /finally \{\s*_scanning = false;\s*_scanState = null;/.test(scanSrc));
ok('B6 GET /api/legal/mok-audit 가 running 을 함께 준다', /running: mokScanner\.scanState\(\)/.test(routes));
const last = ui.slice(ui.indexOf('function mokRunningHTML'), ui.indexOf('function mokCardHTML'));
ok('B6 화면: 도는 중이면 「지금 점검이 돌고 있습니다 · 아래는 지난 점검 결과」 를 먼저 띄운다',
  /지금 점검이 돌고 있습니다/.test(last) && /아래는 지난 점검 결과/.test(last) && /mokLastHTML\(data\.last, data\.running\)/.test(ui));
ok('B6 화면: 실패 문구에 언제 점검의 것인지(끝난 시각)를 붙인다',
  /\(running \? '지난 점검' : '마지막 점검'\) \+ '\(' \+ esc\(shortTs\(last\.finishedAt\)\) \+ '\)에서 일부가 실패했습니다/.test(last));
ok('B6 「지금 점검」 을 누르면 목록을 다시 불러 도는 중 표시를 바로 띄운다', /loadMokList\(\);\s*\n\s*\}\)\.catch\(function \(e\) \{ scanBtn\.disabled = false/.test(ui));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
