/**
 * ============================================================================
 * 파일명: scripts/test_review_replay.js
 * 역할: 관리자 검토 센터에서 누른 「승인」이 **배포 뒤에도 남는지** 확인한다.
 *       (초보자용: "승인을 눌러도 나갔다 들어오면 다시 승인하라고 나온다"가 재발하지 않는지,
 *        그리고 승인 뒤 글이 바뀐 경우엔 사람이 본 적 없는 글을 확정하지 않는지 검사한다.)
 * ============================================================================
 *
 * [왜 있나 — 2026-11-19 사용자 보고]
 * 대기 목록(review_queue.md)과 위키 페이지는 앱 이미지 안이라 배포 때마다 옛 내용으로 돌아가고,
 * 승인 이력(local_server/data/review_approvals.json)만 볼륨에 남는다. 그래서 서버를 켤 때 이력으로
 * 다시 맞춘다(routes/legal.js replayApprovalsLog). 사용자 결정 「다」:
 *   "옛 승인은 손대지 않음: 한 번만 다시 눌러 주시면 그 뒤로는 지문 방식으로 유지됨. 가장 안전함"
 *
 * [무엇을 검사하나]
 *  ① 내용 지문(pageFingerprint)은 승인이 바꾸는 두 군데(status 줄·확정 각인 줄)를 무시하고, 본문 한 글자 변화는 잡는다
 *  ② 실제 승인 처리(POST …/approve)가 이력에 내용 지문(pageHashes)을 남긴다
 *  ③ 배포로 파일이 옛 내용으로 돌아간 상태 → 다시 맞추면 승인·위키 확정이 돌아온다. 두 번 돌려도 그대로(멱등)
 *  ④ 지문 없는 옛 승인 → 손대지 않는다(old)
 *  ⑤ 승인 뒤 위키 글이 바뀌었으면 → 확정하지 않고 대기로 둔다(changed)
 *  ⑥ 마지막 결정이 되돌림이면 → 승인된 파일도 대기로 되돌린다
 *  ⑦ 모듈을 불러오기만 해서는 다시 맞추기가 돌지 않는다(server.js 가 listen 뒤에 부른다)
 *
 * ⚠ 실제 파일(review_queue.md · 대상 위키 페이지 · data/review_approvals.json)을 잠시 바꾸고
 *   끝나면(실패해도) 원래 바이트 그대로 되돌린다. 여러 에이전트가 같은 파일을 쓰는 중에는 돌리지 않는다.
 *
 * [연계]
 * - routes/legal.js → replayApprovalsLog · replayApprovalsOnStart · pageFingerprint · finalizeApproval
 * - server.js → listen 뒤 replayApprovalsOnStart()
 * - scripts/refactor/verify_all.sh → SUITES 에 등록돼 있다
 * [로드 순서] 번들 없음(서버 스크립트). `node local_server/scripts/test_review_replay.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n        ' + extra : '')); }
}

const LEGAL = path.join(__dirname, '..', 'knowledge', 'legal');
const QUEUE = path.join(LEGAL, '_dashboard', 'review_queue.md');
const CONCEPTS = path.join(LEGAL, 'wiki', 'concepts');
const { FILES } = require('../config/server_config');
const LOG = FILES.LEGAL_APPROVALS;

(async () => {
  const adminAuth = require('../services/admin_auth');
  adminAuth.verifyToken = (t) => t === 'good';
  const backups = new Map();   // 경로 → 원래 바이트(없던 파일이면 null)
  const keep = (p) => { if (!backups.has(p)) backups.set(p, fs.existsSync(p) ? fs.readFileSync(p) : null); };
  keep(QUEUE); keep(LOG);
  const restore = () => { for (const [p, b] of backups) { if (b === null) { if (fs.existsSync(p)) fs.unlinkSync(p); } else fs.writeFileSync(p, b); } };
  const restoreExceptLog = () => { for (const [p, b] of backups) if (p !== LOG && b !== null) fs.writeFileSync(p, b); };

  try {
    let replayedOnLoad = false;
    const queueBefore = fs.readFileSync(QUEUE);
    const router = require('../routes/legal');
    replayedOnLoad = !fs.readFileSync(QUEUE).equals(queueBefore);
    const L = router;

    console.log('\n── ① 내용 지문 ──');
    const fp = L._pageFingerprint;
    const a = '---\ntitle: x\nstatus: draft\n---\n본문 한 줄\n';
    const b = '---\ntitle: x\nstatus: canonical\n---\n본문 한 줄\n\n> ✅ 사람검증 확정(관리자, 2026-11-19) · REVIEW-x-01\n';
    ok('status 줄·확정 각인 줄만 다르면 지문이 같다', fp(a) === fp(b), fp(a) + ' vs ' + fp(b));
    ok('본문이 한 글자라도 바뀌면 지문이 다르다', fp(a) !== fp(a.replace('한 줄', '두 줄')));
    ok('줄끝 공백·CRLF 차이는 무시한다', fp(a) === fp(a.replace(/\n/g, ' \r\n')));

    console.log('\n── 대상 카드 고르기 ──');
    const handler = (p, m) => {
      const layer = router.stack.find(l => l.route && l.route.path === p && l.route.methods[m]);
      if (!layer) return null;
      const st = layer.route.stack;
      return st[st.length - 1].handle;
    };
    const call = (h, req) => new Promise((resolve) => {
      const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
      Promise.resolve(h(req, res)).catch(e => resolve({ code: 'throw', body: String(e) }));
    });
    const list = handler('/api/legal/reviews', 'get');
    const approve = handler('/api/legal/reviews/:id/approve', 'post');
    ok('승인·목록 라우트가 있다', !!list && !!approve);
    const all = ((await call(list, { query: { status: 'all' } })).body || {}).reviews || [];
    const counts = all.reduce((m, r) => (m[r.id] = (m[r.id] || 0) + 1, m), {});
    // 대기 중 · 번호가 하나뿐 · 대상 페이지가 실제로 있는 카드
    // 대상 페이지 표기는 「wiki/concepts/<이름>.md (설명…)」 꼴이다 — 설명을 떼고 본다(routes/legal.js wikiTargets 와 같은 규칙)
    const fileOf = (t) => { const m = String(t).trim().match(/^wiki\/concepts\/([^/]+?\.md)\b/); return m ? path.join(CONCEPTS, m[1]) : null; };
    const pick = all.find(r => !r.approved && !r.excluded && counts[r.id] === 1 && Array.isArray(r.targetPages)
      && r.targetPages.length && r.targetPages.every(t => fileOf(t) && fs.existsSync(fileOf(t))));
    ok('시험에 쓸 대기 카드를 찾았다', !!pick, '대기 목록에서 조건(대기·번호 하나·대상 파일 존재)에 맞는 카드가 없다');
    if (!pick) throw new Error('no pick');
    const ID = pick.id;
    const pages = pick.targetPages.map(fileOf);
    pages.forEach(keep);
    console.log('  · ' + ID + ' → ' + pick.targetPages.join(', '));
    const isApproved = async () => {
      const r = (((await call(list, { query: { status: 'all' } })).body || {}).reviews || []).find(x => x.id === ID);
      return !!(r && r.approved);
    };
    const stamped = () => pages.every(p => /^status:\s*canonical/m.test(fs.readFileSync(p, 'utf8'))
      && fs.readFileSync(p, 'utf8').includes('사람검증 확정') && fs.readFileSync(p, 'utf8').includes(ID));

    console.log('\n── ② 실제 승인이 지문을 남긴다 ──');
    fs.writeFileSync(LOG, '[]');
    const r1 = await call(approve, { params: { id: ID }, body: { decision: 'approve', by: '시험' } });
    ok('승인 처리 성공', r1.code === 200 && r1.body && r1.body.ok, JSON.stringify(r1.body).slice(0, 200));
    const log1 = JSON.parse(fs.readFileSync(LOG, 'utf8'));
    const rec = log1[log1.length - 1] || {};
    ok('이력에 내용 지문(pageHashes)이 있다 — 대상 페이지 수만큼', rec.pageHashes && Object.keys(rec.pageHashes).length === pages.length, JSON.stringify(rec.pageHashes));
    ok('지문은 승인 **전** 글로 잰 값이다(= 승인 뒤 글과도 같다)',
      rec.pageHashes && pages.every(p => rec.pageHashes[path.basename(p)] === fp(backups.get(p).toString('utf8'))));
    ok('승인된 위키에 확정 각인이 붙었다', stamped());

    console.log('\n── ③ 배포로 파일이 옛 내용으로 돌아간 상태 → 다시 맞춤 ──');
    restoreExceptLog();
    ok('(준비) 파일이 대기로 돌아갔다', !(await isApproved()));
    const r3 = await L._replayApprovalsLog();
    ok('승인이 돌아왔다', r3.approved.includes(ID) && (await isApproved()), JSON.stringify(r3));
    ok('위키 확정 각인도 돌아왔다', stamped());
    ok('이력에 줄을 더 쌓지 않는다', JSON.parse(fs.readFileSync(LOG, 'utf8')).length === log1.length);
    const q1 = fs.readFileSync(QUEUE), w1 = pages.map(p => fs.readFileSync(p));
    const r3b = await L._replayApprovalsLog();
    ok('두 번 돌려도 그대로(멱등)', !r3b.approved.includes(ID) && fs.readFileSync(QUEUE).equals(q1) && pages.every((p, i) => fs.readFileSync(p).equals(w1[i])));
    const qText = fs.readFileSync(QUEUE, 'utf8');
    const day = rec.at.slice(0, 10);
    ok('승인 날짜는 사람이 누른 날 그대로', new RegExp('###\\s+' + ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':[\\s\\S]*?승인:\\s*\\[x\\][^\\n]*' + day).test(qText));

    console.log('\n── ④ 지문 없는 옛 승인 → 손대지 않음 ──');
    restoreExceptLog();
    const oldRec = Object.assign({}, rec); delete oldRec.pageHashes;
    fs.writeFileSync(LOG, JSON.stringify([oldRec]));
    const r4 = await L._replayApprovalsLog();
    ok('old 로 분류', r4.old.includes(ID) && !r4.approved.includes(ID), JSON.stringify(r4));
    ok('대기 목록·위키 모두 그대로', fs.readFileSync(QUEUE).equals(backups.get(QUEUE)) && pages.every(p => fs.readFileSync(p).equals(backups.get(p))));

    console.log('\n── ⑤ 승인 뒤 글이 바뀜 → 대기로 둠 ──');
    restoreExceptLog();
    fs.writeFileSync(LOG, JSON.stringify([rec]));
    fs.appendFileSync(pages[0], '\n재수집으로 바뀐 줄\n');
    const r5 = await L._replayApprovalsLog();
    ok('changed 로 분류', r5.changed.includes(ID) && !r5.approved.includes(ID), JSON.stringify(r5));
    ok('대기 목록 그대로(카드는 대기)', fs.readFileSync(QUEUE).equals(backups.get(QUEUE)) && !(await isApproved()));
    ok('바뀐 위키는 확정되지 않았다', !fs.readFileSync(pages[0], 'utf8').includes('사람검증 확정(시험'));
    restoreExceptLog();
    fs.unlinkSync(pages[0]);
    const r5b = await L._replayApprovalsLog();
    ok('대상 페이지가 없어져도 확정하지 않는다', r5b.changed.includes(ID) && !(await isApproved()), JSON.stringify(r5b));
    restoreExceptLog();

    console.log('\n── ⑥ 마지막 결정이 되돌림 ──');
    fs.writeFileSync(LOG, JSON.stringify([rec]));
    await L._replayApprovalsLog();                 // 승인된 파일 상태 만들기
    ok('(준비) 승인 상태', await isApproved());
    fs.writeFileSync(LOG, JSON.stringify([rec, { id: ID, decision: 'undo', by: '시험', at: rec.at, targetPages: rec.targetPages }]));
    const r6 = await L._replayApprovalsLog();
    ok('되돌림이 반영된다', r6.reverted.includes(ID) && !(await isApproved()), JSON.stringify(r6));
    // (status 를 draft 로 내리는 것은 손으로 누른 되돌림과 같은 동작 — undoWikiPages. 여기서는 각인이 걷혔는지만 본다)
    ok('위키 확정 각인이 걷힌다', pages.every(p => !fs.readFileSync(p, 'utf8').split('\n').some(l => l.startsWith('> ✅ 사람검증 확정') && l.includes(ID))));

    console.log('\n── ⑦ 불러오기만 해서는 돌지 않음 ──');
    ok('require 만으로 대기 목록이 바뀌지 않았다', !replayedOnLoad);
    ok('server.js 가 listen 뒤에 부른다', /replayApprovalsOnStart\(\)/.test(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')));
    process.env.LEGAL_REPLAY_APPROVALS = 'off';
    ok('LEGAL_REPLAY_APPROVALS=off 이면 돌지 않는다', (await L.replayApprovalsOnStart()) === null);
  } catch (e) {
    if (e.message !== 'no pick') { fail++; console.log('  ✗ 예외: ' + (e.stack || e)); }
  } finally {
    restore();
    const back = [...backups].every(([p, b]) => b === null ? !fs.existsSync(p) : fs.readFileSync(p).equals(b));
    ok('끝난 뒤 실제 파일이 원래 바이트 그대로', back);
  }
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
