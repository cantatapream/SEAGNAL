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
  // 2026-09-10 사용자 확정("고치자")으로 **동작이 바뀌었다.** 종전에는 "이미 해소됐다"로 읽히면
  // 그 줄을 통째로 버렸는데, 실측 결과 379줄이 그렇게 사라지고 있었고 그중 100줄에는 ⚠REVIEW
  // 표시가 붙어 있었다(경고만 없어지고 단정적인 문장은 남는 꼴). 이제는 버리지 않고 옮긴다.
  const body = '- REVIEW-03 은 2026-08-05 사람 승인으로 해소됐다.';
  const out = R.markUnresolvedReview(body);
  ok('T-drop-1 "이미 해소됐다"는 언급도 버리지 않고 [미확인]으로 옮긴다', out.includes(HEAD) && out.includes('REVIEW-03'));

  // 실제로 사라지던 유형 — 끝났다는 말이 붙어 있지만 **답 자체가 담긴 줄**
  const real = '> ✅ **REVIEW-364 해제**: 서핑보드는 이 법상 선박이 아니다(선박법 제1조의2 3구분 전수 대조).';
  const out2 = R.markUnresolvedReview(real);
  ok('T-drop-2 확정 답변이 담긴 줄이 사라지지 않는다', out2.includes('서핑보드는 이 법상 선박이 아니다'));

  // 수치가 담긴 줄도 마찬가지
  const num = '- (REVIEW-02 정정 완료) 아라서해갑문 최대폭 28.5m · 통과허용 선박폭 26m.';
  ok('T-drop-3 수치가 담긴 줄이 사라지지 않는다', R.markUnresolvedReview(num).includes('28.5m'));
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

  // 배너 뒷말이 여러 가지다(전 위키 실측): `미승인` 말고 `draft로 환원`·`draft 유지`·`사람 승인 대기` 도 있다.
  for (const head of ['> ⚠ **draft로 환원(2026-07-21, L-15 패턴)** — 본문에 AI 법리추론형 REVIEW 가 남아 있다.',
    '> ⚠ **draft 유지(H-34 재트리아지, 2026-08-05)** — REVIEW 두 건 중 하나만 해소됐다.',
    '> ⚠ **draft — 사람 승인 대기.** 이 페이지는 원래 다른 쪽에 있던 REVIEW 를 분리한 것이다.']) {
    const o = R.markUnresolvedReview(head + '\n- 제5조: 어선을 소유한 자는 등록하여야 한다.');
    const h = o.indexOf(HEAD);
    ok('T-banner-6 배너 변형도 본문에 남는다 — ' + head.slice(0, 24), (h < 0 ? o : o.slice(0, h)).indexOf(head) >= 0);
  }
}

console.log('── 용어 설명 배너는 본문에 남는다(ⓞ-2) ──');
{
  // 2026-09-11: `> ℹ️ **이 페이지에 "REVIEW"·"still_missing"이라고 적힌 자리는 무슨 뜻인가 …**` 배너는
  // 판단이 아니라 독자에게 표시의 뜻을 알려주는 글인데, 그 뜻을 설명하느라 `REVIEW` 라는 낱말을
  // 담고 있어서 **자기 설명 때문에 자기가 숨고** 있었다(실측: 이 배너를 둔 4쪽에서 전부 밀렸다).
  // ⚠머리 기호를 문자 클래스로 거르면 안 된다 — `ℹ`(U+2139)는 유니코드상 문자(\p{L})로 분류된다.
  const variants = [
    '> \u2139\uFE0F **이 페이지에 "REVIEW"·"still_missing"이라고 적힌 자리는 무슨 뜻인가**: 지어내지 않고 그대로 드러낸 표시다.',
    '> **이 페이지에 "REVIEW"·"still_missing"이라고 적힌 자리는 무슨 뜻인가**: 같은 뜻이다.',
    '\u2139\uFE0F **이 페이지에 "REVIEW"라고 적힌 자리는 무슨 뜻인가**: 인용부호 없이도 남아야 한다.',
  ];
  for (const banner of variants) {
    const body = banner + '\n\n제3조: 공단의 임직원은 비밀을 지켜야 한다.\n';
    const o = R.markUnresolvedReview(body);
    const h = o.indexOf('[미확인');
    const kept = h < 0 ? o : o.slice(0, h);
    ok('T-term-banner 용어 설명 배너가 본문에 남는다 — ' + banner.slice(0, 26), kept.indexOf(banner) >= 0);
  }
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
