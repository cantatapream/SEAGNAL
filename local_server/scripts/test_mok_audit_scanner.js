/**
 * ============================================================================
 * 파일명: scripts/test_mok_audit_scanner.js
 * 역할: 「원문결손」 스캐너(조문 목 누락 · 고시 별표 누락)의 배선이 **살아 있는지** 확인한다.
 *       (초보자용: 주마다 도는 점검이 빠진 조문을 찾았을 때, 그것이 관리자 화면까지
 *        제대로 흘러가는지 — 그리고 "확인 못 했다"를 "이상 없다"로 바꿔 말하지 않는지.)
 * ============================================================================
 *
 * [왜 있나 — 2026-09-21, C-2 이행과 함께]
 *  이 점검을 만든 이유 자체가 **아무도 안 부르는 도구가 있었기 때문**이다
 *  (`mok_audit.py`·`admrul_annex_survey.py` 는 한 번 돌리고 끝난 검사였다).
 *  그런데 스캐너를 새로 붙여 놓고 배선이 끊기면 **같은 일이 반복된다** — 크론은 도는데
 *  화면에는 아무것도 안 뜨고, 아무도 그 사실을 모른다. 그래서 기계가 매번 확인한다.
 *
 * [무엇을 검사하나]
 *  ① 닫아 둔 카드가 아직 빠져 있으면 대기로 돌아오고 재등장 횟수가 붙는다
 *  ② 이미 대기 중인 카드·큐에 없는 id 는 건드리지 않는다
 *  ③ 카드가 **무엇을 해야 하는지**를 담는다(할 일이 비면 관리자는 손을 못 댄다)
 *  ④ ★첫 할 일이 **"정말 빠진 것인지 먼저 확인한다"** 이다 — 발췌본은 모자란 것이 정상이라,
 *     이 문구가 없으면 멀쩡한 발췌본을 "재수집"하게 된다(2026-09-21 A-2 무효 사고의 교훈)
 *  ⑤ 서버 라우트 3개와 관리자 통계 칸이 배선돼 있다
 *  ⑥ 화면에 방이 등록돼 있고, **"점검 실패"와 "빠진 것 없음"을 가르는 문구**가 있다
 *  ⑦ 크론이 **수요일**에 걸려 있다 — 같은 law.go.kr 을 두드리는 작업(개정감지 매일 01:00,
 *     신선도 일요일 03:00)과 겹치면 서로 느려져 전수 점검이 중간에 멈춘다(2026-09-20 실측)
 *  ⑧ 새 카드가 없어도 **다시 뜬 카드만으로** 관리자 푸시가 나간다
 *
 * [연계]
 * - services/mok_audit_scanner.js → reopenStillMissing() · toMokEntry() · toAnnexEntry()
 * - routes/legal.js → GET/POST /api/legal/mok-audit …
 * - client/js/ai-chat/ai_chat.js → 「원문결손」 방(renderMokCards)
 * - server.js → cron 수요일 03:00 KST
 * - scripts/refactor/verify_all.sh → SUITES 에 등록돼 있다
 * [로드 순서] 번들 없음(서버 스크립트). `node local_server/scripts/test_mok_audit_scanner.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const mok = require('../services/mok_audit_scanner.js');
const queues = require('../services/legal_admin_queues.js');

let pass = 0, fail = 0;
/** 한 가지를 확인하고 결과를 찍는다. @param {string} name @param {boolean} ok @param {string} [why] */
function check(name, ok, why) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${why ? ' — ' + why : ''}`); }
}

/** 시험용 큐 파일. @param {object[]} rows @returns {string} 파일 경로 */
function tmpQueue(rows) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mokq-')), 'q.jsonl');
  fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return f;
}

console.log('── 닫아 둔 카드가 아직 빠져 있으면 다시 뜨는가 ──');
const file = tmpQueue([
  { id: 'mok_aaaa1111', title: '도선법 시행령', status: 'dismissed' },
  { id: 'mok_bbbb2222', title: '문화유산법 시행규칙', status: 'done', reopen_count: 1 },
  { id: 'mok_cccc3333', title: '순환경제법 시행규칙', status: 'pending' },
]);
const missing = [{ id: 'mok_aaaa1111' }, { id: 'mok_bbbb2222' }, { id: 'mok_cccc3333' }, { id: 'mok_dddd4444' }];
const back = mok.reopenStillMissing(missing, file);
const after = new Map(queues.readJsonl(file).map((e) => [e.id, e]));

const a = after.get('mok_aaaa1111') || {};
check('① 해당없음으로 닫은 카드가 대기로 돌아온다', a.status === 'pending', `status=${a.status}`);
check('① 재등장 횟수가 1 로 붙는다', a.reopen_count === 1, `reopen_count=${a.reopen_count}`);
check('① 왜 다시 떴는지 설명이 붙는다',
  typeof a.reopen_reason === 'string' && a.reopen_reason.includes('해당없음'), `reason=${a.reopen_reason}`);
const b = after.get('mok_bbbb2222') || {};
check('① 처리완료로 닫은 카드도 돌아오고 횟수가 이어진다',
  b.status === 'pending' && b.reopen_count === 2, `status=${b.status} count=${b.reopen_count}`);
const c = after.get('mok_cccc3333') || {};
check('② 이미 대기 중인 카드는 건드리지 않는다',
  c.status === 'pending' && c.reopen_count === undefined, `count=${c.reopen_count}`);
check('② 큐에 없는 id 는 무시한다', !after.has('mok_dddd4444') && !back.includes('mok_dddd4444'));
check('② 되돌린 id 만 돌려준다', back.length === 2, `back=${JSON.stringify(back)}`);

console.log('\n── 카드가 관리자에게 무엇을 해야 하는지 말해 주는가 ──');
const e1 = mok.toMokEntry({ law: '도선법', kind: '시행령', mst: '243569',
  file: 'raw/04_선박해운/도선법/시행령.txt', api_mok: 4, raw_mok: 2, missing: 2, spots: ['제1조의2 1. …'] });
check('③ 제목·계층·빠진 수가 담긴다',
  e1.title === '도선법 시행령' && e1.missing === 2 && e1.api_count === 4, JSON.stringify(e1).slice(0, 140));
check('③ 할 일이 비어 있지 않다', Array.isArray(e1.actions) && e1.actions.length >= 3, `actions=${(e1.actions || []).length}`);
check('④ ★첫 할 일이 "정말 빠진 것인지 먼저 확인한다" 이다(발췌본은 모자란 것이 정상)',
  /정말 빠진 것인지 먼저 확인/.test(e1.actions[0]), e1.actions[0]);
check('④ 발췌본 경로(15_관련타부처)를 그 문구가 짚어 준다', /15_관련타부처/.test(e1.actions[0]));
const e2 = mok.toAnnexEntry({ name: '부산항 도선구 도선안전절차', api: 1, raw: 0 }, '빠짐');
check('③ 별표 카드도 같은 모양으로 만들어진다',
  e2.tier === '행정규칙' && e2.kind === '고시 별표 없음' && (e2.actions || []).length >= 3, JSON.stringify(e2).slice(0, 120));
check('③ 같은 자리·같은 수면 같은 id(중복 적재 방지)',
  mok.toMokEntry({ law: '도선법', kind: '시행령', file: 'raw/04_선박해운/도선법/시행령.txt', missing: 2 }).id === e1.id);
check('③ 빠진 수가 달라지면 다른 id(상황이 변한 것이므로 새 카드)',
  mok.toMokEntry({ law: '도선법', kind: '시행령', file: 'raw/04_선박해운/도선법/시행령.txt', missing: 3 }).id !== e1.id);

console.log('\n── 서버 배선 ──');
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'legal.js'), 'utf8');
check('⑤ GET /api/legal/mok-audit 가 있다', /'\/api\/legal\/mok-audit'/.test(routeSrc));
check('⑤ 결정(처리완료/해당없음) 라우트가 있다', /'\/api\/legal\/mok-audit\/:id\/decide'/.test(routeSrc));
check('⑤ 지금 점검 라우트가 있다', /'\/api\/legal\/mok-audit\/scan-now'/.test(routeSrc));
check('⑤ 목록에 마지막 점검 상태(last)를 함께 준다', /last: mokScanner\.readStatus\(\)/.test(routeSrc));
check('⑤ 관리자 통계에 mokAudit 칸이 있다', /mokAudit: adminQueues\.countPending\(mokScanner\.QUEUE_FILE\)/.test(routeSrc));

console.log('\n── 화면 배선 ──');
const clientSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');
check('⑥ 「원문결손」 방이 목록에 등록돼 있다', /'원문결손'/.test(clientSrc) && /원문결손: 'mokAudit'/.test(clientSrc));
check('⑥ 방을 그리는 함수가 있다', /function renderMokCards\(/.test(clientSrc));
check('⑥ 카드를 그리는 함수가 있다', /function mokCardHTML\(/.test(clientSrc));
check('⑥ ★점검이 실패하면 "빠진 것이 없다는 뜻이 아니다"를 말한다',
  clientSrc.includes('"빠진 것이 없다는 뜻이 아닙니다"'));
check('⑥ 판정불가를 "이상 없음"과 섞지 않는다', /확인하지 못한 것[\s\S]{0,80}"이상 없음"이 아닙니다/.test(clientSrc));

console.log('\n── 정기작업 ──');
const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('⑦ 크론이 수요일 03:00 에 걸려 있다', /cron\.schedule\('0 3 \* \* 3'/.test(serverSrc));
check('⑦ 시간대를 KST 로 명시했다',
  /cron\.schedule\('0 3 \* \* 3'[\s\S]{0,1400}?timezone: 'Asia\/Seoul'/.test(serverSrc));
check('⑦ 스캐너를 부른다', /mok_audit_scanner'\)\.runMokAuditScan\(\)/.test(serverSrc));
const scannerSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'mok_audit_scanner.js'), 'utf8');
check('⑧ 새 카드가 없어도 다시 뜬 카드만으로 푸시를 보낸다',
  /if \(fresh\.length \|\| reopened\.length\)/.test(scannerSrc));
check('⑧ 산출물을 볼륨(local_server/data)에 쓴다 — 재배포해도 안 지워지게',
  /const DATA = path\.join\(__dirname, '\.\.', 'data'\)/.test(scannerSrc));
check('⑧ 두 점검을 잇달아(동시가 아니라) 돌린다',
  scannerSrc.indexOf('await runScript(MOK_SCRIPT') < scannerSrc.indexOf('await runScript(ANNEX_SCRIPT')
  && !/Promise\.all\(/.test(scannerSrc));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
