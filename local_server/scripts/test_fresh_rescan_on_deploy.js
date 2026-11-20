/**
 * ============================================================================
 * 파일명: scripts/test_fresh_rescan_on_deploy.js
 * 역할: 고친 원문이 배포되면 서버가 **원문신선도 점검을 스스로 한 번** 돌리는지 확인한다.
 *       (초보자용: "자동 반영으로 고친 원문이 서버에 올라오면, 사람이 「지금 점검」을 누르지 않아도
 *        카드가 닫히는가"를 검사한다. 실제 law.go.kr 은 부르지 않고 가짜 점검으로 바꿔 끼운다.)
 * ============================================================================
 *
 * [왜 있나 — 2026-11-20 사장님 요청]
 * 「지금점검도 자동으로 하는 로직을 만들면 좋겠는데?」. 그 전에는 PR 이 머지·배포돼도 카드가
 * 3일 뒤 차례나 사람이 누를 때까지 「처리 대기」로 남았다. 설계: services/nariya_autorun.design.md §8.11.
 *
 * [무엇을 검사하나]
 *  ① 카드의 raw 파일에 기다리는 새 판 번호가 있으면 고른다 · 없으면(아직 옛 판) 안 고른다
 *  ② 같은 폴더 `_admrul.json`·`_meta.json` 에만 적혀 있어도 고른다
 *  ③ 법령 카드의 `raw/*` 경로를 펼쳐서 본다
 *  ④ 이름바뀜의심 카드는 후보 번호로 본다
 *  ⑤ 파일이 둘인 카드는 둘 다 새 판이어야 고른다 · 파일이 없거나 번호가 없는 카드·닫힌 카드는 안 고른다
 *  ⑥ 운영이 아니면 아무것도 안 한다(점검·푸시 없음)
 *  ⑦ 고른 카드가 있으면 점검을 1회 돌리고, 닫힌 수·남은 수를 푸시한다
 *  ⑧ 점검이 실패하면 기록하지 않아 다음 시작 때 다시 돈다 · 성공하면 같은 카드로는 다시 안 돈다
 *  ⑨ 고른 카드가 없으면 점검도 푸시도 없다
 *  ⑩ server.js 가 켜질 때 부르는 배선이 살아 있다
 *
 * [연계]
 * - services/admrul_fresh_scanner.js → fixedOnDisk() · rescanIfFixesDeployed()
 * - server.js → app.listen 뒤 setImmediate 안에서 rescanIfFixesDeployed()
 * - scripts/refactor/verify_all.sh → SUITES 에 등록돼 있다
 * [로드 순서] 번들 없음(서버 스크립트). `node local_server/scripts/test_fresh_rescan_on_deploy.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const fresh = require('../services/admrul_fresh_scanner.js');
const queues = require('../services/legal_admin_queues.js');

let pass = 0, fail = 0;
/** 한 가지를 확인하고 결과를 찍는다. @param {string} name @param {boolean} ok @param {string} [why] */
function check(name, ok, why) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${why ? ' — ' + why : ''}`); }
}

/** 임시 지식 폴더에 파일을 쓴다. @param {string} root @param {string} rel @param {string} text */
function put(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

/** 시험용 큐 파일. @param {string} dir @param {object[]} rows @returns {string} */
function queue(dir, rows) {
  const f = path.join(dir, 'q.jsonl');
  fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return f;
}

const card = (id, serial, files, extra) => Object.assign({ id, title: id, status: 'pending', current: { serial }, files }, extra || {});

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rescan-'));
  const root = path.join(dir, 'legal');
  put(root, 'raw/10_a/법A/행정규칙/새판.txt', '[고시] 새판\nID:2100000999001\n본문');
  put(root, 'raw/10_a/법A/행정규칙/옛판.txt', '[고시] 옛판\nID:2100000111111\n본문');
  put(root, 'raw/10_a/법B/행정규칙/꼬리표.txt', '[고시] 번호 줄 없음\n본문');
  put(root, 'raw/10_a/법B/행정규칙/_admrul.json', '{"꼬리표.txt": {"id": "2100000999002"}}');
  put(root, 'raw/05_b/수산법/법률.txt', '제1조 본문');
  put(root, 'raw/05_b/수산법/_meta.json', '{"families": {"법률": {"mst": "291999"}}}');
  put(root, 'raw/10_a/법C/행정규칙/이름바뀜.txt', '[고시] 새 이름\nID:2100000999003\n');

  const q = queue(dir, [
    card('a_new', '2100000999001', ['raw/10_a/법A/행정규칙/새판.txt']),
    card('a_old', '2100000999009', ['raw/10_a/법A/행정규칙/옛판.txt']),
    card('b_tag', '2100000999002', ['raw/10_a/법B/행정규칙/꼬리표.txt']),
    card('c_law', '291999', ['raw/*/수산법/법률.txt'], { tier: '법률' }),
    card('d_ren', '', ['raw/10_a/법C/행정규칙/이름바뀜.txt'], { rename_candidates: [{ serial: '2100000999003' }] }),
    card('e_two', '2100000999001', ['raw/10_a/법A/행정규칙/새판.txt', 'raw/10_a/법A/행정규칙/옛판.txt']),
    card('f_gone', '2100000999001', ['raw/10_a/법A/행정규칙/없는파일.txt']),
    card('g_noser', '', ['raw/10_a/법A/행정규칙/새판.txt']),
    card('h_done', '2100000999001', ['raw/10_a/법A/행정규칙/새판.txt'], { status: 'done' }),
  ]);
  const got = new Set(fresh.fixedOnDisk(q, root));
  check('① 새 판 번호가 파일에 있으면 고른다', got.has('a_new'));
  check('① 아직 옛 판이면 안 고른다', !got.has('a_old'));
  check('② 같은 폴더 _admrul.json 에만 있어도 고른다', got.has('b_tag'));
  check('③ 법령 카드의 raw/* 경로를 펼쳐 _meta.json 으로 고른다', got.has('c_law'));
  check('④ 이름바뀜의심 카드는 후보 번호로 고른다', got.has('d_ren'));
  check('⑤ 파일 둘 중 하나만 새 판이면 안 고른다', !got.has('e_two'));
  check('⑤ 파일이 없는 카드는 안 고른다', !got.has('f_gone'));
  check('⑤ 기다리는 번호가 없는 카드는 안 고른다', !got.has('g_noser'));
  check('⑤ 이미 닫힌 카드는 안 고른다', !got.has('h_done'));

  // ⑥~⑨ rescanIfFixesDeployed — 가짜 점검·가짜 푸시로 바꿔 끼운다
  const stateFile = path.join(dir, 'rescan.json');
  let scans = 0; const pushes = [];
  const push = async (t, b, d) => { pushes.push({ t, b, d }); };
  const closeA = async () => { scans++; queues.updateJsonlById(q, 'a_new', { status: 'done', auto_closed: true }); return { ok: true }; };

  let r = await fresh.rescanIfFixesDeployed({ queueFile: q, root, stateFile, prod: false, scan: closeA, push });
  check('⑥ 운영이 아니면 점검도 푸시도 없다', !r.started && scans === 0 && pushes.length === 0, JSON.stringify(r));

  r = await fresh.rescanIfFixesDeployed({ queueFile: q, root, stateFile, prod: true, scan: async () => { scans++; return { ok: false, error: '응답없음' }; }, push });
  check('⑧ 점검이 실패하면 기록하지 않는다', r.started && r.ok === false && !fs.existsSync(stateFile) && pushes.length === 0, JSON.stringify(r));

  r = await fresh.rescanIfFixesDeployed({ queueFile: q, root, stateFile, prod: true, scan: closeA, push });
  check('⑦ 고른 카드가 있으면 점검을 1회 돌린다', r.started && r.ok && scans === 2, JSON.stringify(r));
  check('⑦ 닫힌 수·남은 수를 센다(a_new 만 닫힘 → 닫힘 1 · 남음 3)', r.closed === 1 && r.left === 3, JSON.stringify(r));
  check('⑦ 결과를 관리자 푸시로 알린다', pushes.length === 1 && /닫힘 1건/.test(pushes[0].b) && /아직 대기 3건/.test(pushes[0].b)
    && pushes[0].d.type === 'admrul_fresh_rescan', JSON.stringify(pushes));

  r = await fresh.rescanIfFixesDeployed({ queueFile: q, root, stateFile, prod: true, scan: closeA, push });
  check('⑧ 성공한 뒤에는 같은 카드로 다시 돌리지 않는다', !r.started && scans === 2 && pushes.length === 1, JSON.stringify(r));

  const q2 = queue(fs.mkdtempSync(path.join(os.tmpdir(), 'rescan2-')), [card('x_old', '2100000999009', ['raw/10_a/법A/행정규칙/옛판.txt'])]);
  r = await fresh.rescanIfFixesDeployed({ queueFile: q2, root, stateFile: path.join(dir, 's2.json'), prod: true, scan: closeA, push });
  check('⑨ 고른 카드가 없으면 점검도 푸시도 없다', !r.started && scans === 2 && pushes.length === 1, JSON.stringify(r));

  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('⑩ server.js 가 켜질 때 rescanIfFixesDeployed() 를 부른다', /admrul_fresh_scanner'\)\.rescanIfFixesDeployed\(\)/.test(server));

  console.log(`\n${fail ? '❌' : '✅'} test_fresh_rescan_on_deploy — ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('❌ test_fresh_rescan_on_deploy 오류:', e); process.exit(1); });
