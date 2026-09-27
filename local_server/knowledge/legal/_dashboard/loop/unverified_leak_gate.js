#!/usr/bin/env node
/**
 * V5-49 — **[미확인] 머리표 없이 근거로 나가는 REVIEW 줄이 있나** (2026-09-26 신설, N-2)
 *
 * [왜 있나 — N-2 의 진짜 남은 몫]
 *   N-2 는 *"신뢰도 단위를 쪽 → 절로 쪼갠다"* 였고, 사장님이 **ⓐ(문턱을 낮춘다)** 로 확정하셨다.
 *   ★그런데 착수 전 위험검토에서 **그 문턱이 이미 없다는 것**을 실측으로 찾았다:
 *     · 2026-08-05 — `page-level 제외`가 **content-level 제외**로 바뀌었다(`search()` 주석).
 *     · 2026-09-07 — `citableBody()` 가 **상태와 무관하게** `markUnresolvedReview` 를 태운다.
 *     · 그 자는 **줄 단위**다(절보다 잘다).
 *   생산 입구 `search({canonicalOnly:true})` 로 골든 40문항을 재니 근거로 실린 1,326쪽 가운데
 *   **`concept/draft` 285 · `comparison/draft` 3 · `annex/draft` 1** 이 실제로 실렸고
 *   본문도 1,993자·1,982자·2,209자처럼 온전했다. ⇒ **ⓐ는 이미 돌고 있다.**
 *   ⚠내 옛 검토문(`16_N2_SECTION_TRUST_REVIEW.md` §2)은 「161쪽이 통째로 빠진다」고 적었는데
 *     그것은 **코드가 아니라 파일 머리의 낡은 주석을 옮겨 적은 것**이었다(L-382 — 이름·글을
 *     보고 짐작했다). 지우지 않고 그 문서에 정정을 붙였다.
 *
 * [그래서 없는 것은 「잠그는 자」다]
 *   문턱이 낮은 채로 도는 것이 **되돌아가지 않게** 하려면, 그리고 낮은 문턱이 **환각을 만들지
 *   않게** 하려면 한 가지가 0이어야 한다 —
 *   **`[미확인]` 머리표 없이 REVIEW 줄이 근거로 나가는 일이 없어야 한다.**
 *   (검토문 §5-4 가 약속한 검사가 바로 이것이다. 그때 만들지 않았다.)
 *
 * [무엇을 재나 — 판정은 생산 함수가 한다(L-136)]
 *   모든 위키 쪽의 본문을 `markUnresolvedReview()`(생산 함수, 운영이 쓰는 그 자)에 태워
 *   ①`REVIEW` 가 든 줄이 남아 있는데 ②그 줄이 `UNVERIFIED_HEAD` **뒤에 있지 않으면** 샌 것이다.
 *   ⚠`statute`(법령 원문 쪽)는 **원문 그대로여야 하므로** 이 자가 안 태운다 — 세지 않는다.
 *   ⚠배너 줄(`draft — 미승인`·용어 설명)은 생산 함수가 **일부러 남기는 것**이라 뺀다
 *     (2026-09-10 사용자 확정 — 그 줄은 판단이 아니라 상태 표시다).
 *
 * [쓰는 법] node unverified_leak_gate.js           사람이 보는 표
 *           node unverified_leak_gate.js --gate    0 이 아니면 exit 1
 * [연계] `scripts/refactor/verify_all.sh` V5-49 · `services/legal_retriever.js`
 *        `markUnresolvedReview` · 등록표 `N-2`
 */
'use strict';
const R = require('../../../../services/legal_retriever.js');

const GATE = process.argv.includes('--gate');
// 생산 함수가 붙이는 머리표. **여기 글자를 다시 적지 않는다** — 함수에 태워 얻는다(L-136).
const HEAD = (() => {
  const out = R.markUnresolvedReview('> ⚠ REVIEW: 표본');
  const i = out.indexOf('[미확인');
  return i >= 0 ? out.slice(i, out.indexOf('\n', i)) : '[미확인';
})();

// ★배너인지 아닌지를 **내가 판정하지 않는다** — 그 줄 하나만 생산 함수에 다시 태워 묻는다(L-136).
//   · 되돌아온 것이 그대로면  → 생산 함수가 **일부러 남기는 줄**(상태 배너 등)이다. 샌 것이 아니다.
//   · 머리표가 붙어 오면      → 생산 함수는 **옮겨야 한다고 본다.** 그런데 본문에서는 안 옮겼다 ⇒ **샌 것이다.**
//   · 빈 문자열이 오면        → 버리는 줄(변경이력 표 행)이다. 샌 것이 아니다.
//   ⚠이 저장소에서 배너 정규식을 **베껴 적었다가 67건을 거짓 실패로 셌다**(2026-09-26). 규칙은 한 곳에 둔다.
function 샌줄인가(line) {
  let out;
  try { out = R.markUnresolvedReview(line); } catch (_) { return false; }
  if (out === line) return false;                 // 일부러 남긴다
  if (!out || !out.trim()) return false;          // 버린다
  return out.split('\n').some((l) => l.startsWith(HEAD));   // 옮기려 한다 ⇒ 샌 것
}

const idx = R.loadIndex();
const 샌쪽 = [];
let 쪽수 = 0, 태운쪽 = 0, 밀린줄 = 0, 밀린쪽 = 0;
for (const p of (idx.pages || [])) {
  쪽수++;
  if (p.kind === 'statute') continue;            // 원문 그대로여야 한다 — 이 자가 안 태운다
  const page = R.readPage(p.kind, p.file);
  const body = page ? page.body : '';
  if (!body) continue;
  태운쪽++;
  const out = R.markUnresolvedReview(body);
  const lines = out.split('\n');
  const at = lines.findIndex((l) => l.startsWith(HEAD));   // ★줄 단위로 찾는다 — 본문에 적힌
  //   「[미확인] 줄 처리」 같은 메모를 머리표로 착각하지 않으려는 것이다(2026-09-26 실측으로 겪었다).
  if (at >= 0) { 밀린쪽++; 밀린줄 += lines.length - at - 1; }
  const 앞 = (at >= 0 ? lines.slice(0, at) : lines);        // 머리표 앞 = 근거로 그대로 나가는 부분
  const 샌줄 = 앞.filter((l) => /\bREVIEW\b/.test(l) && 샌줄인가(l));
  if (샌줄.length) 샌쪽.push({ 쪽: `${p.kind}/${p.file}`, 줄수: 샌줄.length, 보기: 샌줄[0].slice(0, 110) });
}
const 샌줄합 = 샌쪽.reduce((a, b) => a + b.줄수, 0);

console.log(`\n── V5-49 [미확인] 없이 나가는 REVIEW 줄 ──`);
console.log(`  인덱스 쪽 ${쪽수} · 이 자가 태운 쪽 ${태운쪽}(statute 는 원문 그대로라 뺀다)`);
console.log(`  [미확인] 뒤로 옮겨진 줄 ${밀린줄.toLocaleString()} (쪽 ${밀린쪽}) — D-1 이 0 으로 만든 값이다`);
console.log(`  ${샌줄합 === 0 ? '✅' : '❌'} 머리표 없이 나가는 REVIEW 줄 ${샌줄합} (쪽 ${샌쪽.length})`);
for (const s of 샌쪽.slice(0, 10)) console.log(`     · ${s.쪽} — ${s.줄수}줄 · ${s.보기}`);
if (샌쪽.length > 10) console.log(`     … 그리고 ${샌쪽.length - 10}쪽 더`);

if (GATE && 샌줄합 !== 0) {
  console.error('  ★미확인 판단이 머리표 없이 근거로 나간다 — 낮은 문턱이 환각을 만드는 자리다.');
  console.error('    고치는 법: `markUnresolvedReview` 가 그 줄을 왜 안 옮겼는지 연다. 기준선을 올리지 않는다(G-49).');
  process.exit(1);
}
