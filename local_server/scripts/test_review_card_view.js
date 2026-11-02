/**
 * ============================================================================
 * 파일명: scripts/test_review_card_view.js
 * 역할: 관리자 「⚠수치검증」 카드를 사람이 **보고 판단할 수 있게** 만든 것들이 살아 있는지 확인한다.
 *       (초보자용: 카드 맨 위 「한눈에 보기」, 「AI 조사 끝 · 사람 승인만 남음」 표시, 잘린 본문 대신 결론을
 *        먼저 보이기, 그리고 승인 단추를 누르면 카드가 실제로 닫히는지를 검사한다.)
 * ============================================================================
 * [왜 있나 — 2026-11-03 사장님 지시(3-97)]
 *  "이 화면 자체에서 볼 수 없으니 승인, 기각 자체를 할 수 없어. 그리고 내용 자체를 이해하기 쉽게 설명해야
 *   내가 판단이 될 것 같아." — 확인해 보니 REVIEW-선박평형수관리법-806 은 ①9-20 에 조사가 끝났는데 결론이
 *   본문 뒤쪽이라 잘려 안 보였고 ②승인 줄이 둘([x] AI 종결 + [ ] 사람 승인)이라 승인을 눌러도 **첫 줄만 바뀌어
 *   카드가 계속 대기로 남았다**(화면은 마지막 줄을 읽는다).
 * [무엇을 검사하나]
 *  ① 「- 한눈에:」 칸을 항목별로 읽는다(이어진 줄은 앞 항목에 붙는다 · 들여쓰지 않은 줄에서 끝난다)
 *  ② 앞에 [x] 종결 줄, 끝에 [ ] 줄인 카드를 「AI 조사 끝」 으로 읽고 그 결론을 꺼낸다
 *  ③ 승인 줄 교체는 **마지막 줄**을 바꾼다 — 바꾼 뒤 다시 읽으면 승인으로 나온다(되돌리기도 같다)
 *  ④ 승인 줄이 없는 블록은 found:false · 다음 카드의 승인 줄을 건드리지 않는다
 *  ⑤ 실제 review_queue.md 의 -806 카드가 대기·AI 조사 끝·한눈에 7항목으로 읽힌다
 *  ⑥ 화면이 그 칸들을 그린다(easyHTML·aiDoneHTML·배지·전체 기록 펼치기) · 보기 칸이 알약 버튼이다
 * [연계] routes/legal.js parseReviewQueueText·replaceApprovalLine·findAiDone(router.__test) ·
 *        client/js/ai-chat/ai_chat.js reviewCardHTML · scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 번들 없음(서버 스크립트). `node local_server/scripts/test_review_card_view.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
/** 한 가지를 확인하고 결과를 찍는다. @param {string} name @param {boolean} ok @param {string} [why] */
function check(name, ok, why) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${why ? ' — ' + why : ''}`); }
}

const T = require('../routes/legal.js').__test;
const Q = (...b) => b.join('\n') + '\n';

console.log('── ① 「한눈에」 칸 ──');
const e1 = T.parseReviewQueueText(Q(
  '### REVIEW-가법-1: 제목', '- 대상 페이지: wiki/concepts/가법__가.md',
  '- 한눈에:', '  · 무엇을 판단하나: 가를 나로', '    이어지는 줄', '  · 추천: **승인** — 맞다',
  '- 승인: [ ] 대기'))[0];
check('① 항목 둘을 읽는다', e1.easy.length === 2, JSON.stringify(e1.easy));
check('① 들여쓴 이어진 줄은 앞 항목에 붙는다', e1.easy[0].v === '가를 나로 이어지는 줄', e1.easy[0].v);
check('① 들여쓰지 않은 줄(승인)에서 끝나고 승인 판정은 그대로', !e1.approved && e1.easy[1].k === '추천');

console.log('\n── ② AI 조사 끝 · 사람 승인만 남음 ──');
const two = Q('### REVIEW-나법-2: 제목', '- 승인: [x] **2026-09-20 종결 — 원본에 식이 없다.**', '  · ①확인함', '  · ②확인함',
  '- 한눈에:', '  · 추천: 승인', '- 승인: [ ] 대기', '### REVIEW-다법-3: 다른 카드', '- 승인: [ ] 대기');
const e2 = T.parseReviewQueueText(two);
check('② 마지막 줄이 [ ] 이면 대기로 읽는다', e2[0].approved === false);
check('② 앞의 [x] 줄을 AI 결론으로 꺼낸다', e2[0].aiDone && /원본에 식이 없다/.test(e2[0].aiDone.head)
  && e2[0].aiDone.detail === '· ①확인함\n· ②확인함', JSON.stringify(e2[0].aiDone));
check('② 승인 줄이 하나뿐인 카드는 AI 결론이 없다', e2[1].aiDone === null);
check('② 마지막이 [x] 인 카드(이미 승인)는 AI 결론으로 보지 않는다',
  T.findAiDone('- 승인: [ ] 대기\n- 승인: [x] 승인(관리자, 2026-11-03)\n') === null);

console.log('\n── ③④ 승인 줄 교체는 마지막 줄 ──');
const r3 = T.replaceApprovalLine(two, 'REVIEW-나법-2', '- 승인: [x] 승인(관리자, 2026-11-03)');
const a3 = T.parseReviewQueueText(r3.txt);
check('③ 찾았다', r3.found === true);
check('③ 바꾼 뒤 다시 읽으면 승인이다(카드가 실제로 닫힌다)', a3[0].approved === true, JSON.stringify(a3[0].approvedMeta));
check('③ 앞의 AI 종결 줄은 그대로 남는다', /\[x\] \*\*2026-09-20 종결/.test(r3.txt));
check('④ 다음 카드의 승인 줄은 건드리지 않는다', a3[1].approved === false && /### REVIEW-다법-3: 다른 카드\n- 승인: \[ \] 대기/.test(r3.txt));
const u3 = T.replaceApprovalLine(r3.txt, 'REVIEW-나법-2', '- 승인: [ ] 대기(되돌림: 관리자, 2026-11-03)');
check('③ 되돌리기도 마지막 줄을 바꿔 다시 대기가 된다', T.parseReviewQueueText(u3.txt)[0].approved === false);
const one = Q('### REVIEW-라법-4: 하나', '- 승인: [ ] 대기', '### REVIEW-마법-5: 다음', '- 승인: [ ] 대기');
const r4 = T.replaceApprovalLine(one, 'REVIEW-라법-4', '- 승인: [x] 승인(관리자, 2026-11-03)');
check('③ 승인 줄이 하나인 카드는 종전처럼 그 줄을 바꾼다',
  T.parseReviewQueueText(r4.txt)[0].approved === true && T.parseReviewQueueText(r4.txt)[1].approved === false);
const none = Q('### REVIEW-바법-6: 승인줄 없음', '- 대상 페이지: x', '### REVIEW-사법-7: 다음', '- 승인: [ ] 대기');
const r5 = T.replaceApprovalLine(none, 'REVIEW-바법-6', '- 승인: [x] 승인(관리자, 2026-11-03)');
check('④ 자기 블록에 승인 줄이 없으면 found:false — 다음 카드 줄을 덮어쓰지 않는다', r5.found === false && r5.txt === none);
check('③ 바꿀 글의 $ 특수문자가 원장을 망가뜨리지 않는다',
  T.replaceApprovalLine(one, 'REVIEW-라법-4', '- 승인: [x] 승인($&·$1, 2026-11-03)').txt.includes('승인($&·$1, 2026-11-03)'));

console.log('\n── ⑤ 실제 대기열의 -806 카드 ──');
const RQ = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'review_queue.md');
const all = T.parseReviewQueueText(fs.readFileSync(RQ, 'utf8'));
const c806 = all.find((e) => e.id === 'REVIEW-선박평형수(船舶平衡水)관리법-806');
check('⑤ -806 카드가 있다', !!c806);
if (c806) {
  check('⑤ -806 은 아직 대기(사람 승인 전)', c806.approved === false);
  check('⑤ -806 은 「AI 조사 끝」 이고 결론이 「원본에 식이 없다」', c806.aiDone && /원본에 식이 없다/.test(c806.aiDone.head));
  check('⑤ -806 의 「한눈에」 가 7항목이고 추천이 들어 있다',
    c806.easy.length === 7 && c806.easy.some((x) => /^추천/.test(x.k)), JSON.stringify(c806.easy.map((x) => x.k)));
}

console.log('\n── ⑥ 화면 ──');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');
check('⑥ 「한눈에 보기」·「AI 조사 결론」 칸을 카드 본문 맨 앞에 그린다', /easyHTML\(rv\) \+ aiDoneHTML\(rv\) \+\s*\n\s*reviewFieldsHTML\(rv\)/.test(SRC));
check('⑥ AI 조사가 끝난 카드에 「사람 승인만 남음」 배지', SRC.includes('AI 조사 끝 · 사람 승인만 남음'));
check('⑥ 잘린 본문 대신 전체 기록을 펼쳐 볼 수 있다', SRC.includes('카드 전체 기록 펼치기'));
check('⑥ 보기 칸이 옛 <select> 가 아니라 알약 버튼이다', !SRC.includes('<select class="nrya-rv-status"') && SRC.includes('nrya-rv-segbtn'));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
