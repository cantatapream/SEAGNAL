/**
 * test_split_law_ask.js — **쪼개진 법을 옛 이름으로 물었을 때 되묻는가** (2026-09-26 신설, 4-6)
 *
 * [왜 있나] 2024년에 「해사안전법」이 **해사안전기본법 + 해상교통안전법** 으로 쪼개졌다.
 *   옛 이름으로 물으면 둘 다 후보에 들지만 **두께가 12배** 다르다(1위 10,110자 ↔ 12위 819자).
 *   사장님 확정 2026-09-26: **ⓐ 되묻는다.**
 *
 * [★좁게 발동해야 한다 — 이 스위트의 핵심]
 *   되묻기가 늘면 답까지 가는 걸음이 늘어난다. 그래서 **잘못 발동하지 않는 것**을 함께 못박는다:
 *   · 새 이름을 이미 썼다 → 되묻지 않는다(사용자가 이미 골랐다)
 *   · 글로서리에서 「법 둘 이상을 가리키는」 다른 행(「기름통 버림」·「물양장」)은 **둘 다 답인
 *     경우**다 → 되묻지 않는다. 이 둘을 여기 넣어 두는 까닭은 「법 둘을 가리키면 되묻는다」로
 *     넓혔다가 퇴보하는 것을 막기 위해서다.
 *
 * [판정은 생산 함수가 한다] `legal_retriever.splitLawStep` 을 그대로 부른다(L-136).
 * [연계] `_dashboard/split_laws.json`(선언) · `routes/legal.js`(zoneTreeStep 바로 뒤) · 등록표 `4-6`
 */
'use strict';
const R = require('../services/legal_retriever.js');

const 표본 = [
  ['해사안전법이 뭐야',            true,  '옛 이름을 홀로 썼다 — 되묻는다'],
  ['해사안전법 음주운항 처벌',      true,  '옛 이름 + 딴 낱말 — 그래도 어느 법인지 모른다'],
  ['해사안전법상 충돌예방 규정',     true,  '옛 이름을 조사와 붙여 썼다'],
  ['해상교통안전법 음주운항 처벌은', false, '새 이름을 이미 썼다'],
  ['해사안전기본법 제3조',          false, '새 이름을 이미 썼다'],
  ['기름통 버림 처벌',             false, '★법 둘을 가리키지만 둘 다 답이다 — 되물으면 퇴보'],
  ['물양장 접안료',                false, '★법 둘을 가리키지만 둘 다 답이다 — 되물으면 퇴보'],
  ['낚시어선 음주운항',            false, '쪼개진 법과 무관하다'],
  ['',                            false, '빈 물음'],
];

let 맞음 = 0;
for (const [q, 기대, 왜] of 표본) {
  const r = R.splitLawStep(q);
  const 실제 = !!r;
  const ok = 실제 === 기대;
  if (ok) 맞음++;
  console.log(`  ${ok ? '✅' : '❌'} ${왜}`);
  if (!ok) console.log(`       물음 ${JSON.stringify(q)} — 기대 ${기대} 실제 ${실제}`);
  // 되묻는 경우에는 **선택지가 새 이름 둘**이어야 한다(라벨이 곧 좁히는 말이다).
  if (ok && 기대) {
    const labels = (r.clarify.options || []).map((o) => o.label);
    const 좋다 = labels.length === 2 && labels.every((l) => /해사안전기본법|해상교통안전법/.test(l));
    if (!좋다) { 맞음--; console.log(`       ★선택지가 새 이름 둘이 아니다: ${JSON.stringify(labels)}`); }
  }
}
// 결과줄 꼴은 러너의 규약이다(`verify_all.sh` 가 `N PASS / N FAIL` 을 grep 한다).
console.log(`\ntest_split_law_ask — ${맞음} PASS / ${표본.length - 맞음} FAIL`);
