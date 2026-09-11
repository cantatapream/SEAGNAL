/**
 * ============================================================================
 * 파일명: scripts/dump_law_unverified.js
 * 역할: 한 법의 위키에서 **챗봇이 [미확인]으로 밀어내는 줄**을 전부 뽑아 보여준다.
 *       사람이 "이 법에서 아직 확인 안 끝난 것이 무엇인가"를 한눈에 보려고 쓴다.
 * ============================================================================
 *
 * [왜 있나 — 2026-09-10 항만법 담당이 사각지대를 찾아내 만들었다]
 * 그전까지 쓰던 임시 도구는 `status === 'draft'` 인 페이지만 훑었다. 그런데 운영 코드
 * `legal_retriever.js` `citableBody()` 는 2026-09-07부터 **status 와 무관하게** 비-statute
 * 페이지를 전부 거른다 — 즉 **canonical 페이지의 줄도 실제 답변에서는 똑같이 밀린다.**
 * 전 위키 실측(2026-09-10): canonical **1,587줄** · draft 710줄 · review-pending 5줄.
 * 초안만 보고 "다 정리했다"고 하면 **3분의 2를 못 본 것**이 된다.
 *
 * [쓰는 법]  node local_server/scripts/dump_law_unverified.js "<법령명>"
 *   법령명은 `_dashboard/index.json` 의 `law` 값 그대로(띄어쓰기·가운뎃점 포함).
 *
 * [연계]
 * - services/legal_retriever.js → loadIndex · readPage · markUnresolvedReview(운영 코드 그대로 부른다)
 * - _dashboard/review_queue.md → 여기 나온 줄 중 사람 판단이 필요한 것은 그쪽에 등록한다
 * [로드 순서] 번들 없음(서버 스크립트).
 * ============================================================================
 */
'use strict';
const R = require('../services/legal_retriever.js');
const MARK = '[미확인 — 아래는 사람 검토가 끝나지 않은 내용이다.';
const law = process.argv[2];
if (!law) { console.log('쓰는 법: node local_server/scripts/dump_law_unverified.js "<법령명>"'); process.exit(1); }

/** 색인의 kind 를 실제 폴더 이름으로 되돌린다(사람이 경로를 바로 열 수 있게). */
const KIND_DIR = { concept: 'concepts', comparison: 'comparisons', annex: 'annexes', activity: 'activities' };

const all = (R.loadIndex().pages || []).filter(p => p.kind !== 'statute' && p.law === law);
if (!all.length) { console.log('그런 법의 페이지가 없다: ' + law); process.exit(0); }
let n = 0, pages = 0;
for (const p of all) {
  const page = R.readPage(p.kind, p.file); if (!page) continue;
  const out = R.markUnresolvedReview(page.body || '');
  const i = out.indexOf(MARK);
  const un = i < 0 ? [] : out.slice(i).split('\n').slice(1).map(l => l.trim()).filter(Boolean);
  if (!un.length) continue;
  pages++;
  console.log('\n##### wiki/' + (KIND_DIR[p.kind] || p.kind) + '/' + p.file + '.md  [status: ' + (p.status||'?') + ']  (' + un.length + '줄)');
  un.forEach(l => console.log(String(++n).padStart(3) + '. ' + l));
}
console.log('\n합계 ' + n + '줄 / ' + pages + '쪽 (이 법의 비-statute 페이지 ' + all.length + '쪽 중)');
