/**
 * test_unverified_review.js — 미검증(⚠REVIEW) 내용을 **지우지 않고 표시해 보내는지** 고정한다.
 *
 * [왜 있나] 2026-08-20 실측: 종전 `stripUnresolvedReview` 는 "REVIEW" 단어가 든 줄을 통째로
 * 지웠는데, 지워지는 줄에 담긴 것이 바로 우리가 정직하게 적어 둔 **"확정 불가" 판단**이었다.
 * 지우고 나면 주의 문구는 사라지고 단정하기 좋은 문장만 남아, 챗봇이 위키가 "모른다"고 적어 둔
 * 것을 "적용받습니다"로 단정했다(섬 발전 촉진법 Q51). **안전장치가 환각을 만들고 있었다.**
 *
 * [고정하는 것] ①진짜 미확인 판단은 살아남고 ②변경이력·이미 해소된 언급은 계속 버려지고
 * ③표가 끊기지 않고 ④미확인 내용이 근거 목록(citationChain)에 섞이지 않고 ⑤답변 규칙에
 * "단정하지 마라"가 들어 있는지.
 *
 * [연계] ← services/legal_retriever.js(markUnresolvedReview·ANSWER_RULES_BODY·extractCitationChain)
 *        ← scripts/refactor/verify_all.sh SUITES
 */
const R = require('../services/legal_retriever.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

const HEAD = '[미확인';

console.log('── 진짜 미확인 판단은 살아남는다 ──');
{
  const body = [
    '## 타법 연결',
    '| 인용 법령 | 관계 | 무엇을 위해 |',
    '|---|---|---|',
    '| 「선박안전법」 제3조제1항 | 정밀인용 | 원문은 "국민" 또는 "정부"로만 규정하며 지방자치단체를 명시적으로 포함하지도 제외하지도 않는다 `⚠REVIEW`(확정 불가) |',
    '| 「선원법」 제2조 | 정밀인용 | 선원 정의 |',
  ].join('\n');
  const out = R.markUnresolvedReview(body);
  ok('"확정 불가" 판단이 본문에 남는다', /명시적으로 포함하지도/.test(out));
  ok('미확인 머리표가 붙는다', out.includes(HEAD));
  ok('머리표는 본문 끝에 온다(표 한가운데를 끊지 않는다)',
    out.indexOf(HEAD) > out.indexOf('「선원법」 제2조'));
}

console.log('── 표가 끊기지 않는다 ──');
{
  const body = [
    '## 근거 조문',
    '| 법령 | 조문 | 요지 |',
    '|---|---|---|',
    '| 선박안전법 | 제3조 | 적용범위 |',
    '| 선박안전법 | 제7조 | 이 부분은 확정 불가 REVIEW |',
    '| 선박안전법 | 제9조 | 검사 |',
  ].join('\n');
  const out = R.markUnresolvedReview(body);
  const chain = R.extractCitationChain(out);
  ok('REVIEW 행 뒤의 행도 살아남는다(표 절단 없음)',
    chain.some(r => r.article === '제9조'));
  ok('REVIEW 행 자체는 근거 목록에 안 들어간다',
    !chain.some(r => r.article === '제7조'));
  ok('미확인 머리표 아래 줄이 근거 목록에 섞이지 않는다',
    chain.every(r => !/미확인/.test(String(r.law || '') + String(r.article || ''))));
}

console.log('── 쓸모없는 REVIEW 언급은 계속 버린다 ──');
{
  const body = [
    '본문 서술.',
    '## 변경 이력',
    '| 2026-08-17 | REVIEW-01 해소 확인 | 출처 |',
  ].join('\n');
  ok('변경이력 절의 REVIEW 줄은 버린다', !R.markUnresolvedReview(body).includes(HEAD));
}
{
  const body = '| 2026-08-01 | REVIEW-02 를 정정했다 | 근거 |';
  ok('날짜로 시작하는 표 행의 REVIEW 도 버린다', !R.markUnresolvedReview(body).includes(HEAD));
}
{
  const body = '- REVIEW-03 은 2026-08-05 사람 승인으로 해소됐다.';
  ok('"이미 해소됐다"는 언급은 버린다', !R.markUnresolvedReview(body).includes(HEAD));
}
{
  const body = '- REVIEW-04 는 아직 미해소 상태다(사람 승인 대기).';
  ok('"미해소"가 붙으면 버리지 않는다', R.markUnresolvedReview(body).includes(HEAD));
}

console.log('── REVIEW 가 없으면 본문을 건드리지 않는다 ──');
{
  const body = '## 근거 조문\n| 법령 | 조문 |\n|---|---|\n| 선박안전법 | 제3조 |';
  ok('머리표를 붙이지 않는다', R.markUnresolvedReview(body) === body);
}

console.log('── 페이지 상태 안내줄(draft — 미승인)은 밀려나지 않는다 ──');
{
  // 2026-09-10 사용자 확정("빼자"). 안내줄 뒤에 그 페이지 본문이 이어 붙는 관례라,
  // 상태 표시 하나 때문에 멀쩡한 서술까지 [미확인]으로 빠지고 있었다(전 위키 실측 125줄).
  const body = [
    '> ⚠ **draft — 미승인(2026-07-21 환원).** 본문에 AI 법리추론형 REVIEW 가 남아 draft 유지 대상.'
      + ' 이 페이지는 어선 등록 절차를 다룬다.',
    '- 제5조: 어선을 소유한 자는 등록하여야 한다.',
    '- ⚠REVIEW: "소유"에 임차가 포함되는지는 원문이 정하지 않는다.',
  ].join('\n');
  const out = R.markUnresolvedReview(body);
  const head = out.indexOf(HEAD);
  const kept = head < 0 ? out : out.slice(0, head);
  const moved = head < 0 ? '' : out.slice(head);
  ok('T-banner-1 상태 안내줄은 본문에 그대로 남는다', /draft — 미승인/.test(kept));
  ok('T-banner-2 안내줄 뒤에 이어 붙은 서술도 함께 남는다', /어선 등록 절차를 다룬다/.test(kept));
  ok('T-banner-3 안내줄이 [미확인]으로 옮겨지지 않는다', !/draft — 미승인/.test(moved));
  ok('T-banner-4 진짜 판단 줄은 여전히 [미확인]으로 옮겨진다', /"소유"에 임차가 포함/.test(moved));
  ok('T-banner-5 REVIEW 없는 줄은 그대로 남는다', /제5조: 어선을 소유한 자/.test(kept));
}

console.log('── 답변 규칙에 "단정하지 마라"가 있다 ──');
{
  const rules = R.ANSWER_RULES_BODY || '';
  ok('규칙에 미확인 머리표 처리가 들어 있다', /미확인/.test(rules));
  ok('규칙이 단정을 금지한다', /단정하면 안 된다|단정하지/.test(rules));
  ok('규칙이 미확인 내용을 근거로 인용하지 말라고 한다', /조문번호를 근거로 인용하지 마라/.test(rules));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
