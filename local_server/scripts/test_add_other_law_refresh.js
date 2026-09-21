/**
 * ============================================================================
 * 파일명: scripts/test_add_other_law_refresh.js
 * 역할: `add_other_law_article.js --refresh` 가 **raw 원문을 안전하게 갈아 끼우는지**
 *       확인한다. (초보자용: "반쪽만 받아 둔 조문을 새로 받은 글로 바꿔 끼울 때,
 *       옆 조문이나 우리 메모를 망가뜨리지 않는가"를 검사한다.)
 * ============================================================================
 *
 * [왜 있나 — 2026-09-21]
 * 옛 수집기는 목(가·나·다)과 호(1·2·3)를 안 적었다. 그래서 발췌본 8개 파일에
 * `2. 다음 각 목의 시설을 갖출 것` 뒤에 **아무것도 없는** 조문이 남아 있다(V5-16 이 센다).
 * 그런데 `add_other_law_article.js` 는 그 조가 파일에 있기만 하면 **"이미 있음"으로
 * 건너뛰었다** — 있는 것이 반쪽인 줄 모른다. 그래서 `--refresh` 를 만들었는데,
 * **이 기능은 raw 원문을 덮어쓴다.** 덩이 경계를 한 줄만 잘못 잡아도 옆 조문이 날아간다.
 * 그래서 경계 잡기(`article_block.replaceBlock`)를 따로 모듈로 빼고 여기서 기계로 잰다.
 *
 * [무엇을 검사하나]
 *  ① 가운데 조문을 갈아 끼워도 **앞뒤 조문이 그대로**다
 *  ② 우리가 적어 둔 `※` 메모 줄이 **살아남는다**(왜 받았는지가 거기 있다)
 *  ③ 덩이는 **다음 대괄호 머리줄**에서 끊긴다 — 별표·부칙을 삼키지 않는다
 *  ④ 마지막 조문(뒤에 아무것도 없는 것)도 끊어 잡는다
 *  ⑤ `제10조` 로 부르면 `제10조의2` 를 잡지 않는다(가지조 오인 금지)
 *  ⑥ 파일에 없는 조를 부르면 **null** 을 준다(엉뚱한 자리를 고치지 않는다)
 *  ⑦ 목이 빠진 실제 꼴을 넣으면 목이 채워지고 글이 길어진다
 *  ⑧ CLI 쪽 배선 — 글이 줄어드는 교체를 스스로 거부하고, 갈아 끼운 것도 기록에 남긴다
 *  ⑨ `--file` — 한 폴더에 발췌본이 둘 이상일 때(전기사업법) 어느 파일인지 못 박고,
 *     그 법 폴더 밖은 거부한다
 *  ⑪ `hasArticle` — "이미 있나"를 머리줄 꼴에 맞게 묻는다(민짜 파일에서 늘 false 가 나와
 *     같은 조를 하나 더 덧붙이던 것을 막는다)
 *  ⑩ **민짜 머리줄**(`제6조(제목)` — 대괄호가 하나도 없는 발췌본)도 집는다.
 *     실측상 호가 빠진 발췌본 15개 중 7개가 이 꼴이라, 이것 없이는 손도 못 댔다.
 *
 * [연계]
 * - _dashboard/loop/article_block.js → replaceBlock()
 * - _dashboard/loop/add_other_law_article.js → --refresh · --shrink-ok
 * - _dashboard/loop/mok_promise_guard.py (V5-16) → 고친 뒤 기준선을 낮춘다
 * - scripts/refactor/verify_all.sh → SUITES 에 등록
 * [로드 순서] 번들 없음. `node local_server/scripts/test_add_other_law_refresh.js`
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LOOP = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'loop');
const { replaceBlock, hasArticle } = require(path.join(LOOP, 'article_block.js'));

let pass = 0, fail = 0;
/** 한 가지를 확인하고 결과를 찍는다. @param {string} name @param {boolean} ok @param {string} [why] */
function check(name, ok, why) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${why ? ' — ' + why : ''}`); }
}

const FILE = [
  '전기사업법 — 타법연결용 발췌 (전체 아님)',
  '',
  '[제2조] 정의',
  '※ 항만법 G12 — 전기설비 검사 면제 근거 (2026-07-18 조문단위 추가수집)',
  '이 법에서 사용하는 용어의 뜻은 다음과 같다.',
  '   1.  "전기사업"이란 다음 각 목의 사업을 말한다.',
  '',
  '[제10조] 사업의 허가',
  '① 전기사업을 하려는 자는 허가를 받아야 한다.',
  '',
  '[제10조의2] 허가의 결격사유',
  '① 다음 각 호의 어느 하나에 해당하는 자는 허가를 받을 수 없다.',
  '',
  '[별표 1] 과징금의 부과기준',
  '1. 일반기준',
  '',
  '부칙 <제19234호, 2026.3.10>',
  '제1조(시행일) 이 법은 공포 후 6개월이 지난 날부터 시행한다.',
  '',
].join('\n');

const FRESH2 = { text: [
  '이 법에서 사용하는 용어의 뜻은 다음과 같다.',
  '   1.  "전기사업"이란 다음 각 목의 사업을 말한다.',
  '      가. 발전사업',
  '      나. 송전사업',
  '      다. 배전사업',
].join('\n') };

console.log('── 덩이 경계를 바르게 잡는가 ──');
const r2 = replaceBlock(FILE, '제2조', FRESH2);
check('① 갈아 끼운 뒤에도 제10조가 그대로 있다', !!r2 && r2.text.includes('\n[제10조] 사업의 허가\n'));
check('① 갈아 끼운 뒤에도 제10조의2가 그대로 있다', !!r2 && r2.text.includes('[제10조의2] 허가의 결격사유'));
check('① 머리말 첫 줄이 그대로 있다', !!r2 && r2.text.startsWith('전기사업법 — 타법연결용 발췌'));
check('② ※ 메모 줄이 살아남는다',
  !!r2 && r2.text.includes('※ 항만법 G12 — 전기설비 검사 면제 근거 (2026-07-18 조문단위 추가수집)'));
check('② ※ 메모가 머리줄 바로 아래에 온다',
  !!r2 && /\[제2조\] 정의\n※ 항만법 G12/.test(r2.text));
check('③ 별표를 삼키지 않는다', !!r2 && r2.text.includes('[별표 1] 과징금의 부과기준'));
check('③ 부칙을 삼키지 않는다', !!r2 && r2.text.includes('부칙 <제19234호, 2026.3.10>'));
check('⑦ 목이 채워진다', !!r2 && r2.text.includes('      가. 발전사업') && r2.text.includes('      다. 배전사업'));
check('⑦ 글이 길어진다(before < after)', !!r2 && r2.after > r2.before, r2 ? `${r2.before} → ${r2.after}` : '');

console.log('\n── 옆 조문을 잘못 집지 않는가 ──');
const r10 = replaceBlock(FILE, '제10조', { text: '① 전기사업을 하려는 자는 산업통상자원부장관의 허가를 받아야 한다.' });
check('⑤ 제10조 로 불러도 제10조의2 는 건드리지 않는다',
  !!r10 && r10.text.includes('[제10조의2] 허가의 결격사유')
    && r10.text.includes('① 다음 각 호의 어느 하나에 해당하는 자는 허가를 받을 수 없다.'));
check('⑤ 제10조 본문만 바뀐다',
  !!r10 && r10.text.includes('산업통상자원부장관의 허가') );
check('⑥ 없는 조를 부르면 null 이다', replaceBlock(FILE, '제99조', { text: 'x' }) === null);

console.log('\n── 마지막 조문(뒤에 아무것도 없는 것) ──');
const TAILLESS = '[제2조] 정의\n① 가.\n\n[제3조] 적용\n① 이 법은 …\n';
const r3 = replaceBlock(TAILLESS, '제3조', { text: '① 이 법은 모든 전기설비에 적용한다.' });
check('④ 마지막 조문도 잡힌다', !!r3 && r3.text.includes('모든 전기설비에 적용한다'));
check('④ 앞 조문이 그대로다', !!r3 && r3.text.startsWith('[제2조] 정의\n① 가.'));

console.log('\n── 민짜 머리줄 파일(대괄호가 하나도 없는 발췌본) ──');
// 실측: 호가 빠진 발췌본 15개 중 7개가 이 꼴이다(간호법·관광진흥법 시행규칙 등).
const PLAIN = [
  '⚠REVIEW / 출처: 국가법령정보센터 간호법(현행, MST=265413) / 발췌수집',
  '※ 이 파일은 전체 법률이 아니라 위 인용조문(제6조1항)만 발췌한 것이다.',
  '',
  '제6조(간호조무사 자격인정 등)',
  '① 간호조무사가 되려는 사람은 다음 각 호의 어느 하나에 해당하는 사람으로서 …',
  '② 제1항제1호부터 제4호까지에 따른 간호조무사 교육훈련기관은 …',
  '',
  '제8조(국가시험)',
  '① 간호조무사 국가시험은 보건복지부장관이 실시한다.',
  '',
].join('\n');
const rp = replaceBlock(PLAIN, '제6조', { text: [
  '제6조(간호조무사 자격인정 등)',
  '① 간호조무사가 되려는 사람은 다음 각 호의 어느 하나에 해당하는 사람으로서 …',
  '   1. 초·중등교육법령에 따른 특성화고등학교의 간호 관련 학과를 졸업한 사람',
  '   2. 「학점인정 등에 관한 법률」에 따라 학점을 인정받은 사람',
  '② 제1항제1호부터 제4호까지에 따른 간호조무사 교육훈련기관은 …',
].join('\n') });
check('⑩ 민짜 머리줄 파일에서도 덩이를 집는다', !!rp);
check('⑩ 옆 조문(제8조)이 그대로 있다', !!rp && rp.text.includes('제8조(국가시험)')
  && rp.text.includes('① 간호조무사 국가시험은 보건복지부장관이 실시한다.'));
check('⑩ 빠졌던 호가 채워진다', !!rp && rp.text.includes('   1. 초·중등교육법령'));
check('⑩ 머리줄이 두 번 적히지 않는다',
  !!rp && (rp.text.match(/제6조\(간호조무사 자격인정 등\)/g) || []).length === 1);
check('⑩ 머리말(※ 줄)이 그대로 있다', !!rp && rp.text.includes('※ 이 파일은 전체 법률이 아니라'));
check('⑩ 대괄호 파일에서는 민짜 줄을 경계로 쓰지 않는다(덩이가 첫 줄에서 안 끊긴다)',
  !!r2 && r2.text.includes('      다. 배전사업'));

check('⑪ 민짜 파일에서 "이미 있나"를 바로 본다', hasArticle(PLAIN, '제6조') === true
  && hasArticle(PLAIN, '제7조') === false);
check('⑪ 대괄호 파일에서도 바로 본다', hasArticle(FILE, '제10조') === true
  && hasArticle(FILE, '제99조') === false);
check('⑪ 가지조를 본조로 오인하지 않는다', hasArticle(FILE, '제10조의2') === true);

console.log('\n── CLI 쪽 배선 ──');
const cli = fs.readFileSync(path.join(LOOP, 'add_other_law_article.js'), 'utf8');
check('⑧ --refresh 옵션이 있다', /argv\.includes\('--refresh'\)/.test(cli));
check('⑧ 글이 줄어들면 스스로 거부한다(--shrink-ok 로만 넘긴다)',
  /grew < 0 && !SHRINK_OK/.test(cli) && /argv\.includes\('--shrink-ok'\)/.test(cli));
check('⑧ "이미 있음"으로 건너뛸 때 반쪽일 수 있다고 알린다',
  cli.includes('"있다"가 "다 있다"는 뜻은 아니다'));
check('⑧ 갈아 끼운 것도 _meta.json 에 남긴다', /갈아끼움: true/.test(cli));
check('⑧ 교체분을 먼저 파일에 쓴 뒤 덧붙인다(순서가 바뀌면 교체분이 날아간다)',
  cli.indexOf('fs.writeFileSync(file, refreshed)') > 0
    && cli.indexOf('fs.writeFileSync(file, refreshed)') < cli.indexOf('별표·부칙 앞에 끼워 넣었다'));
check('⑧ 덩이 교체는 시험 있는 모듈에서 가져온다',
  /require\('\.\/article_block'\)/.test(cli));
check('⑪ CLI 가 "이미 있나"를 hasArticle 로 묻는다(문자열 includes 아님)',
  /hasArticle\(had, r\.label\)/.test(cli) && !/had\.includes\(`\[\$\{r\.label\}\]`\)/.test(cli));
check('⑨ --file 로 어느 발췌본인지 못 박을 수 있다', /arg\('--file'\)/.test(cli));
check('⑨ --file 은 그 법 폴더 밖을 거부한다',
  /--file 은 이 법의 폴더/.test(cli) && /abs\.startsWith\(path\.resolve\(dir\) \+ path\.sep\)/.test(cli));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
