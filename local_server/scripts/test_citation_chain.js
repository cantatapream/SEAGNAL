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

console.log('── 문서 전체 행 · 부칙 행 (2026-08-19) ──');
{
  // 조문 칸이 `전체(제1~19조)` 인 행: 답변이 그 지침의 **별표**를 인용하면 살아나야 한다.
  // 종전엔 범위 갈래가 먼저 집어 "제1~19조 중 하나가 답변에 있나"만 보고 별표 인용을 버렸다.
  const ans1 = '쉽게 말하면, 사업 전 모니터링의 기본 추가항목은 최소 2회 이상 실시합니다. '
    + '「갯벌복원사업 지침」 별표2 비고에 따라 물리·수질·퇴적물 항목을 최소 2회 이상 실시하도록 정하고 있습니다.';
  const r1 = keptFor('갯벌및그주변지역의지속가능한관리와복원에관한법률__갯벌복원사업시행및계획', ans1,
    '갯벌 및 그 주변지역의 지속가능한 관리와 복원에 관한 법률');
  const g1 = r1.find(r => String(r.law).includes('갯벌복원사업 지침'));
  ok('`전체(제1~19조)` 행이 별표 인용으로 살아난다', !!g1 && g1.citedArticle === '별표2',
    g1 ? String(g1.citedArticle) : r1.map(r => r.law).join(' / ') || '한 줄도 안 남음');

  // 같은 행이 범위 **안의 조문** 인용으로도 종전대로 살아야 한다(살릴 줄만 더한다).
  const r2 = keptFor('갯벌및그주변지역의지속가능한관리와복원에관한법률__갯벌복원사업시행및계획',
    '「갯벌복원사업 지침」 제14조에 따라 복원사업 시행계획을 수립합니다.',
    '갯벌 및 그 주변지역의 지속가능한 관리와 복원에 관한 법률');
  const g2 = r2.find(r => String(r.law).includes('갯벌복원사업 지침'));
  ok('같은 행이 범위 안 조문 인용으로도 살아난다(기존 동작 유지)', !!g2 && g2.citedArticle === '제14조',
    g2 ? String(g2.citedArticle) : '없음');
}
{
  // 부칙 행: 위키 칸(`부칙 … <제20722호,2008.2.29> 제6조`)과 답변 표기가 달라 글자로는 안 맞는다.
  // 부칙 호수로 잡되, **날짜만 같은 다른 부칙**은 딸려오면 안 된다.
  const ans = '쉽게 말하면, 삭제 전 「한국해양수산연수원법 시행령」 제4조는 최소 2개항, 제5조는 최소 3개항으로 '
    + '돼 있었습니다. 「한국해양수산연수원법 시행령」 부칙(국토해양부와 그 소속기관 직제) '
    + '<제20722호, 2008.2.29>에서 그 항수를 확인할 수 있습니다.';
  const rows = keptFor('한국해양수산연수원법__설립과조직운영', ans, '한국해양수산연수원법');
  ok('부칙 행이 호수로 잡힌다',
    rows.some(r => r.citedArticle === '부칙 제20722호'),
    rows.map(r => r.law + ' ' + r.citedArticle).join(' / '));
  ok('날짜만 같은 다른 부칙은 딸려오지 않는다',
    !rows.some(r => /제8852호/.test(String(r.article))),
    rows.map(r => String(r.article).slice(0, 30)).join(' / '));
}

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

console.log('── 가운뎃점으로 이어 적은 조·별표 묶음 ──');
{
  // 조문 칸 `별표2·5·6·8·9` 는 종전 토큰 대조가 **별표2 하나만** 뽑아, 답변이 별표5를 인용하면
  // 그 행이 통째로 탈락했다(라이브 검증: 연안관리법 시행지침 별표5 — 답변 본문은 맞는데 근거 목록이 빔).
  ok('별표 묶음을 낱개로 편다',
    JSON.stringify(R.articleEnumTokens('별표2·5·6·8·9'))
      === JSON.stringify(['별표2', '별표5', '별표6', '별표8', '별표9']));
  ok('조와 별표가 섞인 칸도 양쪽 다 편다',
    JSON.stringify(R.articleEnumTokens('제2·3조·별표1·2'))
      === JSON.stringify(['제2조', '제3조', '별표1', '별표2']));
  ok('묶음 안의 범위(18~21)도 편다',
    R.articleEnumTokens('제9·11·12·16·18~21조').join(',') === '제9조,제11조,제12조,제16조,제18조,제19조,제20조,제21조');
  ok('항·호 묶음은 펴지 않는다(조가 하나뿐 — 기존 토큰 대조가 이미 집는다)',
    R.articleEnumTokens('제115조제3·4호').length === 0);
  ok('`제30조의5·6` 은 여기서 손대지 않는다(expandJoEnum 담당)',
    R.articleEnumTokens('제30조의5·6').length === 0);
  ok('가운뎃점 뒤가 숫자가 아니면 펴지 않는다',
    R.articleEnumTokens('제46조제1항제6ㆍ7호, 별표2 아ㆍ자목').length === 0);

  // 실제 위키 행으로 끝까지 확인 — 답변이 별표5를 인용하면 그 지침 행이 살아남아야 한다.
  const ans = '「연안정비 시설물 사후관리 및 효과평가 시행지침」 별표5에 따르면 수중조사는 '
    + '하자보수기간 완료 전 정밀안전점검, 준설 등으로 해저면이 변동된 경우 등에 실시합니다.';
  const rows = keptFor('연안관리법__연안정비시설물사후관리', ans, '연안관리법');
  ok('별표5를 인용한 답변에서 시행지침 행이 살아남는다',
    rows.some(r => String(r.law).includes('시행지침') && String(r.article).includes('별표')),
    rows.map(r => r.law + ' ' + r.article).join(' / ') || '(한 줄도 안 남음)');
}

console.log('── 번호 없는 `별표` 칸 ──');
{
  // 고시·지침에는 별표가 하나뿐이라 번호를 안 붙인 것이 있다(전 위키 36행). 종전 토큰 대조는
  // `별표3` 처럼 숫자가 붙은 것만 뽑아, 답변이 "별표 가목"이라고 쓰면 그 고시 행이 통째로 빠졌다.
  const ans = '불법조업을 신고하면 포상금을 받을 수 있습니다. 「불법어업 신고자 등에 대한 포상금 지급 규정」 '
    + '별표 가목에 따라 벌금형으로 끝난 경우에는 벌금액의 100분의 50(상한 300만원, 하한 50만원)을 지급합니다.';
  const rows = keptFor('수산자원관리법__단속조사및과태료체계', ans, '수산자원관리법');
  ok('번호 없는 별표 행이 이름 근접 인용으로 살아남는다',
    rows.some(r => String(r.law).includes('포상금 지급 규정') && String(r.citedArticle).startsWith('별표')),
    rows.map(r => r.law + ' ' + r.citedArticle).join(' / ') || '(한 줄도 안 남음)');

  // 이름이 답변에 없으면 통과하지 않는다 — 별표라는 낱말만 스쳐도 붙으면 안 된다.
  const loose = '이 경우 별표 가목에 따라 처리합니다.';
  const none = keptFor('수산자원관리법__단속조사및과태료체계', loose, '수산자원관리법');
  ok('법 이름 없이 "별표"만 스치면 붙지 않는다',
    !none.some(r => String(r.law).includes('포상금 지급 규정')),
    none.map(r => r.law).join(' / ') || '(없음)');
}

console.log('── 법령 칸 앞에 붙은 발령기관 괄호 ──');
{
  ok('앞 괄호를 뗀 이름을 후보로 만든다',
    R.lawCellVariants('(국립농산물품질관리원) 수입농산물등 유통이력관리 조사 요령')
      .includes('수입농산물등 유통이력관리 조사 요령'));
  ok('괄호 뒤가 법령 이름이 아니면 후보로 만들지 않는다',
    !R.lawCellVariants('(타법) 처벌(형벌)').includes('처벌(형벌)'));
}

console.log('── 범위와 별표가 한 칸에 적힌 행 ──');
{
  // `제8~13조·별표4` 는 범위 갈래가 먼저 집어, 답변이 별표4를 인용하면 조 범위와 안 맞는다는
  // 이유로 아래 토큰 대조까지 못 가고 탈락했다(라이브 검증: 원산지표시법 조사요령 별표4).
  const ans = '과태료 사전통지를 받으면 의견을 낼 수 있습니다. 「수입농산물등 유통이력관리 조사 요령」 '
    + '별표4에 따라 의견제출기간은 발부일 익일부터 20일간(토·공휴일 제외)입니다.';
  const rows = keptFor('농수산물의원산지표시등에관한법률__유통이력관리(수입농산물등)', ans,
    '농수산물의 원산지 표시 등에 관한 법률');
  ok('범위가 안 맞아도 같은 칸의 별표로 살아남는다',
    rows.some(r => String(r.law).includes('조사 요령')),
    rows.map(r => r.law).join(' / ') || '(한 줄도 안 남음)');
}

console.log('── 같은 근거가 이름 표기 차이로 두 줄 뜨던 것 ──');
{
  // 같은 고시라도 개념 페이지는 「…」(고시) 로, 별표 페이지는 낫표·괄호 없이 적는다. 글자 그대로
  // 비교하던 겹침 검사가 이를 다른 법으로 봐서 화면에 같은 근거가 두 번 떴다(2026-08-19 배포 직후 재현).
  const kept = R.dropRedundantChainRows([
    { law: '「불법어업 신고자 등에 대한 포상금 지급 규정」(고시)', article: '제5조·별표', citedArticle: '별표' },
    { law: '불법어업 신고자 등에 대한 포상금 지급 규정', article: '별표', citedArticle: '별표' },
  ]);
  ok('낫표·괄호만 다른 같은 고시는 한 줄만 남는다', kept.length === 1,
    kept.map(r => r.law).join(' / '));
  ok('남는 줄은 위임 조문까지 짚은 쪽이다', kept[0] && kept[0].article === '제5조·별표',
    kept[0] && kept[0].article);

  // ⚠이름 안쪽 글자는 건드리지 않는다 — 시행령·시행규칙이 모법과 합쳐지면 안 된다.
  const both = R.dropRedundantChainRows([
    { law: '수산업법', article: '제100조', citedArticle: '제100조' },
    { law: '수산업법 시행령', article: '제100조', citedArticle: '제100조' },
  ]);
  ok('모법과 시행령은 합쳐지지 않는다', both.length === 2, both.map(r => r.law).join(' / '));
}

console.log('── 답변이 고시 이름만 써도 그 페이지를 잃지 않는다 ──');
{
  // filterSourcesByAnswer 는 답변이 **모법 이름이나 페이지 주제**를 글자 그대로 써야 통과시켰다.
  // 그런데 답변은 그 페이지가 담은 고시·지침 이름만 쓰는 일이 흔하다. 그러면 페이지가 통째로
  // 버려지고 finalSources 가 비어, routes 가 원문 폴백으로 다시 답한다 — 폴백 답변은 맞는데
  // 근거 목록이 통째로 빈다(라이브 7차에서 갯벌·농수산물품질관리법·자연유산·국제항해선박이 그랬다).
  const body = fs.readFileSync(path.join(WIKI,
    '갯벌및그주변지역의지속가능한관리와복원에관한법률__갯벌복원사업시행및계획.md'), 'utf8');
  const src = {
    file: 'x', law: '갯벌 및 그 주변지역의 지속가능한 관리와 복원에 관한 법률',
    topic: '갯벌복원사업시행및계획', kind: 'concept',
    citationChain: R.extractCitationChain(body),
  };
  const ans = '사업 전 모니터링은 최소 2회 이상 실시해야 합니다. 이는 「갯벌복원사업 지침」 제14조 관련 '
    + '[별표 2] "갯벌복원사업 모니터링"에 따른 것입니다.';
  ok('모법 이름을 안 써도 근거 줄이 살아남으면 그 페이지를 남긴다',
    R.filterSourcesByAnswer([src], ans).length === 1);

  // ⚠느슨해지지 않는다 — 줄 단위 대조를 통과하지 못하면 그대로 버린다.
  ok('무관한 답변으로는 살아나지 않는다',
    R.filterSourcesByAnswer([src], '오늘 날씨가 좋습니다. 인용할 법령은 없습니다.').length === 0);
  ok('법 이름 없이 별표만 스쳐도 살아나지 않는다',
    R.filterSourcesByAnswer([src], '별표 2에 따라 최소 2회 이상입니다.').length === 0);
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
