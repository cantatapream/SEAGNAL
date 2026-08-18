/**
 * test_citation_chain.js — 근거 목록(citationChain)이 고시·지침·조례를 잃지 않는가.
 *
 * [왜 있나] 2026-08-18 라이브 검증(감사관이 full로 채점한 논점을 실제 챗봇에 되물어 대조)에서
 * 58법 중 30법이 불일치였고, 그 중 13건이 **"답변 본문은 맞는데 근거 목록에는 그 고시가 없다"**는
 * 같은 모양이었다. 원인은 두 가지였다.
 *   D1. 법령 칸에 붙은 괄호 주석 — 위키는 `서해 5도 해상운송비 지원 지침(고시)` 처럼 출처를 밝히려고
 *       괄호를 덧붙이는데, 답변은 「서해 5도 해상운송비 지원 지침」 이라고만 쓴다. 칸 문자열을 통째로
 *       찾던 대조는 이런 행(전 위키 288행)을 한 줄도 통과시키지 못했다.
 *   D2. 조문 칸이 `전체`인 행(전 위키 57행) — 짚을 조문 토큰이 없어 대조에서 늘 탈락했다.
 *
 * [무엇을 고정하나] ①괄호 주석이 붙은 고시 행이 살아남는다 ②`전체` 행이 답변의 근접 인용으로 살아난다
 * ③그렇다고 느슨해지지 않는다 — 이름만 스치면 통과하지 않고, 갈래 이름(`행정규칙`·`고시`)은 후보가 안 된다.
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES. → services/legal_retriever.js
 *        lawCellVariants·citationNearLawName·filterCitationChainByAnswer.
 */
const fs = require('fs');
const path = require('path');
const R = require('../services/legal_retriever.js');

const WIKI = path.join(__dirname, '..', 'knowledge', 'legal', 'wiki', 'concepts');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}
function keptFor(page, answer, baseLaw) {
  const body = fs.readFileSync(path.join(WIKI, page + '.md'), 'utf8');
  return R.filterCitationChainByAnswer(R.extractCitationChain(body), answer, baseLaw);
}
const hasLaw = (rows, needle) => rows.some(r => String(r.law || '').includes(needle));

console.log('── D1 법령 칸의 괄호 주석 ──');

ok('괄호 주석을 뗀 이름을 후보로 만든다',
  R.lawCellVariants('서해 5도 해상운송비 지원 지침(고시)').includes('서해 5도 해상운송비 지원 지침'));
ok('`고시(<이름>)` 꼴은 괄호 **안**이 이름이다',
  R.lawCellVariants('고시(연안정비 시설물 사후관리 및 효과평가 시행지침)')
    .includes('연안정비 시설물 사후관리 및 효과평가 시행지침'));
ok('원문 칸은 언제나 첫 후보로 남는다(지금까지 통과하던 줄을 안 떨어뜨린다)',
  R.lawCellVariants('해운법')[0] === '해운법');
ok('갈래 이름만 남는 후보는 만들지 않는다(`행정규칙(고시)` → 후보 1개)',
  R.lawCellVariants('행정규칙(고시)').length === 1,
  JSON.stringify(R.lawCellVariants('행정규칙(고시)')));
ok('갈래 이름을 감싼 진짜 이름은 살린다(`운영규칙(선박교통관제 운영규칙)`)',
  R.lawCellVariants('운영규칙(선박교통관제 운영규칙)').includes('선박교통관제 운영규칙'));

{
  const answer = '쉽게 말하면, 교부결정 통지서는 옹진군수가 발급하는 서식입니다. '
    + '「서해 5도 해상운송비 지원 지침」 제5조제4항에 따라 옹진군수가 별지 제3호서식으로 통지합니다.';
  const rows = keptFor('서해5도지원특별법__생활필수품해상운송비지원', answer, '서해 5도 지원 특별법');
  ok('실제 위키: 「…지원 지침(고시)」 행이 근거 목록에 남는다', hasLaw(rows, '해상운송비 지원 지침'),
    rows.map(r => r.law).join(' / ') || '한 줄도 안 남음');
  const g = rows.find(r => String(r.law).includes('해상운송비 지원 지침'));
  ok('그 행이 답변이 실제로 인용한 조문을 가리킨다', !!g && g.citedArticle === '제5조제4항',
    g ? String(g.citedArticle) : '-');
}

console.log('── D2 조문 칸이 `전체`인 행 ──');

// ⚠여기서는 **합성 자료**를 쓴다. 처음에는 실제 위키 페이지(연안관리법)를 썼는데, 통합수정이
//   그 페이지를 의도대로 고치자(조문 칸 `전체` → 구체 조문) 테스트가 깨졌다 — 코드 동작을 재는
//   테스트가 **우리가 고치는 중인 데이터**에 매여 있으면 개선이 실패로 보인다. 코드가 그 모양을
//   만나면 어떻게 하는지는 자료를 직접 만들어 재는 것이 맞다.
const SYNTH = [
  '## 근거 조문',
  '',
  '| 법령 | 조문 | 시행일 | 요지 |',
  '|---|---|---|---|',
  '| 연안관리법 | 제29조 | 2025-10-01 | 사후관리 의무 |',
  '| 고시(연안정비 시설물 사후관리 및 효과평가 시행지침) | 전체 | 2025-10-22 | 점검 종류·주기·과업 |',
  '',
].join('\n');

{
  const answer = '쉽게 말하면, 수중조사는 네 경우에 실시합니다. '
    + '「연안정비 시설물 사후관리 및 효과평가 시행지침」 별표5에 따라 하자보수기간 완료 전 또는 10년마다 실시합니다. '
    + '이는 「연안관리법」 제29조의 사후관리 의무에 따른 것입니다.';
  const rows = R.filterCitationChainByAnswer(R.extractCitationChain(SYNTH), answer, '연안관리법');
  const g = rows.find(r => String(r.law).includes('시행지침'));
  ok('조문 칸이 `전체`인 고시 행이 살아난다', !!g,
    rows.map(r => r.law).join(' / ') || '한 줄도 안 남음');
  ok('그 행이 답변의 근접 인용(별표5)을 가리킨다', !!g && g.citedArticle === '별표5',
    g ? String(g.citedArticle) : '-');
  ok('모법 행도 그대로 남는다(기존 동작 유지)', hasLaw(rows, '연안관리법'));
}

{
  // 이름만 스쳐 지나가고 조문이 붙어 나오지 않으면 통과시키지 않는다.
  const answer = '「연안정비 시설물 사후관리 및 효과평가 시행지침」이 따로 있으나 여기서는 다루지 않습니다. '
    + '수중조사 여부는 「연안관리법」 제29조로 판단합니다.';
  const rows = R.filterCitationChainByAnswer(R.extractCitationChain(SYNTH), answer, '연안관리법');
  ok('이름만 언급되고 조문이 안 붙으면 `전체` 행은 통과하지 않는다',
    !rows.some(r => String(r.law).includes('시행지침')),
    rows.map(r => r.law).join(' / '));
}

console.log('── 근접성 대조 자체 ──');
ok('이름 바로 뒤 별표를 잡는다',
  R.citationNearLawName('「어떤 지침」 별표5에 따르면', ['어떤 지침']) === '별표5');
ok('이름 바로 뒤 조·항·호를 잡는다',
  R.citationNearLawName('「어떤 지침」 제5조제4항에 따라', ['어떤 지침']) === '제5조제4항');
ok('이름과 조문이 멀리 떨어져 있으면 잡지 않는다',
  R.citationNearLawName('「어떤 지침」은 참고자료일 뿐이고 실제 판단은 다른 자료의 제5조로 한다', ['어떤 지침']) === '');
ok('이름이 아예 없으면 잡지 않는다',
  R.citationNearLawName('제5조에 따라', ['어떤 지침']) === '');

console.log('── 조문의 주인 확인(고시·지침까지) ──');
{
  // 답변이 「내항해운에관한업무지침」 제14조제2항이라고 분명히 썼으면, **다른 페이지의**
  // 「해운법」 제10~14조 묶음 행이 그 조문을 물고 들어오면 안 된다(해운법 제14조엔 제2항이 없다).
  const ans = '쉽게 말하면, 인정되는 비용은 8가지입니다. 「내항해운에관한업무지침」 제14조제2항에 따라 '
    + '선원인건비·유류비 등이 인정됩니다. 이 8가지 항목은 「해운법」 제16조제1항에도 적용됩니다.';
  const other = keptFor('해운법__여객운송사업계획변경및운항의무', ans, '해운법');
  ok('묶음 표기 행이 남의 조문을 물고 오지 않는다',
    !other.some(r => String(r.citedArticle || '').startsWith('제14조')),
    other.map(r => r.law + ' ' + r.citedArticle).join(' / '));
  ok('정당하게 인용된 조문은 그대로 남는다',
    other.some(r => r.citedArticle === '제16조제1항'),
    other.map(r => r.law + ' ' + r.citedArticle).join(' / '));

  const own = keptFor('해운법__보조항로지정및도서민해상교통지원', ans, '해운법');
  ok('진짜 주인인 고시 행은 살아남는다',
    own.some(r => String(r.law).includes('내항해운에관한업무지침') && r.citedArticle === '제14조제2항'),
    own.map(r => r.law + ' ' + r.citedArticle).join(' / '));
}

console.log('── 자료 머리의 법령 안내 ──');
{
  const body = fs.readFileSync(path.join(WIKI, '해운법__보조항로지정및도서민해상교통지원.md'), 'utf8');
  const names = R.pageLawNames(body, '해운법');
  ok('대표 법령이 맨 앞이다', names[0] === '해운법', names.join(' / '));
  ok('자료에 함께 실린 고시·지침 이름을 뽑는다',
    names.some(n => n.includes('내항해운에관한업무지침')), names.join(' / '));

  const cp = { law: '해운법', topic: '보조항로', status: 'canonical', frontmatter: { updated: '2026-08-17' }, body };
  const blk = R.buildContextBlock([cp]);
  ok('머리에 "함께 실려 있다" 안내가 붙는다', blk.includes('함께 실려 있다'));
  ok('그 안내가 고시 이름을 담는다', blk.includes('내항해운에관한업무지침'));
}
{
  // 법령이 한 종류뿐인 자료에는 안내를 붙이지 않는다(쓸데없는 줄을 늘리지 않는다).
  const only = { law: '해운법', topic: '', status: 'canonical', frontmatter: {}, body: '본문만 있고 근거 조문 표가 없다.' };
  ok('법령이 하나뿐이면 안내를 붙이지 않는다', !R.buildContextBlock([only]).includes('함께 실려 있다'));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
