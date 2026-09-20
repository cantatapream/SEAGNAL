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
 *   node local_server/scripts/dump_law_unverified.js --orphans
 *   → **법령명으로는 안 잡히는 쪽**(비교표 등 `law` 값이 파일 이름인 쪽)을 전부 보여 준다.
 *
 * [사각지대 — 2026-09-11 `REVIEW-정리-03` 으로 등록, 2026-09-20 보완]
 * 비교표 쪽은 색인의 `law` 값이 법령명이 아니라 **파일 이름**이다(예: `law="수협_감사기구비교"`).
 * 그래서 법령명으로 돌리면 그 법의 비교표가 한 번도 안 잡히고, 그때 이 도구는 그냥 "그런 법의 페이지가 없다"
 * 한 줄만 찍고 끝나 **빠진 줄이 조용히 안 세어졌다.** 이제 이름이 안 맞으면 비슷한 `law` 값을 함께 찍고,
 * `--orphans` 로 사각지대 전체(2026-09-20 실측 35쪽)를 한 번에 볼 수 있다.
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

const PAGES = R.loadIndex().pages || [];

/**
 * 어느 statute 의 `law` 값과도 맞지 않는 비-statute 페이지를 모아 준다.
 * 예시: `수협_감사기구비교` · `안전장구_구명설비` 처럼 **파일 이름이 그대로 `law` 값**으로 들어간 비교표들.
 * @returns {Map<string, object[]>} law 값 → 그 값을 가진 페이지들
 * [연계] 왜 필요하나 — 이 도구는 `law` 값으로 페이지를 고른다. 그런데 비교표 쪽은 `law` 가 법령명이 아니라
 *   파일 이름이라, **법령명으로 돌리면 그 법의 비교표가 한 번도 안 잡힌다**(2026-09-11 `REVIEW-정리-03` 으로 등록된
 *   도구 사각지대). 이름이 안 맞을 때 이 목록을 함께 찍어, 빠진 쪽이 조용히 안 세어지는 일을 막는다.
 */
function orphanLaws() {
  const statuteLaws = new Set(PAGES.filter(p => p.kind === 'statute').map(p => p.law));
  const m = new Map();
  for (const p of PAGES) {
    if (p.kind === 'statute' || statuteLaws.has(p.law)) continue;
    if (!m.has(p.law)) m.set(p.law, []);
    m.get(p.law).push(p);
  }
  return m;
}

if (law === '--orphans') {
  // 사각지대 전체를 한 번에 본다: node dump_law_unverified.js --orphans
  const m = orphanLaws();
  console.log('어느 법령 이름과도 맞지 않는 `law` 값 ' + m.size + '개 (페이지 '
    + [...m.values()].reduce((a, v) => a + v.length, 0) + '쪽) — 법령명으로는 이 쪽들이 안 잡힌다:');
  [...m.keys()].sort().forEach(k => console.log('  · ' + k + ' (' + m.get(k).length + '쪽)'));
  console.log('\n각각을 보려면 그 값을 그대로 넣어 돌린다: node local_server/scripts/dump_law_unverified.js "<위 값>"');
  process.exit(0);
}

const all = PAGES.filter(p => p.kind !== 'statute' && p.law === law);
if (!all.length) {
  console.log('그런 법의 페이지가 없다: ' + law);
  // 이름이 안 맞을 때 **조용히 0쪽으로 끝내지 않는다** — 비슷한 `law` 값을 찍어 준다(REVIEW-정리-03).
  const near = [...new Set(PAGES.filter(p => p.kind !== 'statute' && p.law && p.law.includes(law)).map(p => p.law))];
  if (near.length) console.log('  이런 `law` 값이 있다(비교표는 법령명이 아니라 파일 이름이 들어간다): ' + near.join(' · '));
  console.log('  사각지대 전체를 보려면: node local_server/scripts/dump_law_unverified.js --orphans');
  process.exit(0);
}
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
