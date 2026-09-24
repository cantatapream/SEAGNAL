/**
 * test_treaty_article — **조약 조문머리(꼴④)** 를 못박는다. (3-51)
 *
 * [왜] 조약 본문 15개 파일에서 `listArticleNumbers` 가 조를 **하나도** 못 돌려주고 있었다.
 *   `target=trty` 가 주는 꼴이 법률(`[제10조]`)·고시(`제10조(제목)`)와 **둘 다 다르다** —
 *   `제1조 일반적 의무` 처럼 **괄호가 없다.** 다시 받아도 같은 꼴이라 수집으로는 못 고친다.
 *
 * [무엇을 못박나] 이 시험이 지키는 것은 **둘**이다:
 *   ①조약 파일에서는 꼴④가 **켜진다** — 조가 나오고 본문도 열린다
 *   ★②조약이 아닌 파일에서는 **꺼진다** — 고시의 개정문(`제1조 중 "…"를 "…"로 한다`)을
 *     조문머리로 읽으면 **없는 조가 목록에 실린다.** 실측으로 확인한 오탐이다
 *     (`(인천지방해양수산청)장안서부근해역항행안전에관한고시`).
 *
 * [연계] ← `local_server/services/article_text.js`(listArticleNumbers·extractArticleBlock)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AT = require(path.join(__dirname, '..', 'services', 'article_text.js'));

const RAW = path.join(__dirname, '..', 'knowledge', 'legal', 'raw');
const R = (p) => fs.readFileSync(path.join(RAW, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); }
};

console.log('\n[① 조약 파일 — 꼴④가 켜진다]');
{
  const t = R('15_관련타부처/1969년선박톤수측정에관한국제협약/조약.txt');
  const jos = AT.listArticleNumbers(t, 'law');
  ok('조 목록이 나온다(옛 코드는 0개였다)', jos.length >= 4, jos.join('·'));
  ok('제1조부터 차례로 나온다', jos[0] === '제1조', jos.slice(0, 4).join('·'));
  const b = AT.extractArticleBlock(t, '제3조', 'law');
  ok('본문도 열린다 — 목록만 뜨고 안 열리면 소용없다', !!b && b.body.length > 100);
  ok('제목을 같은 줄에서 읽는다(`제3조 적용`)', !!b && b.title === '적용', b && b.title);
}
{
  // ★제목이 조사(`이…`)로 시작하는 조 — 처음 자로는 놓쳤다(조사 blacklist 가 과했다)
  const t = R('15_관련타부처/선원의훈련자격증명및당직근무기준에관한국제협약_STCW/조약.txt');
  const b = AT.extractArticleBlock(t, '제1조', 'law');
  ok('제목이 `이`로 시작해도 읽는다(STCW `이 협약상의 일반적 의무`)',
    !!b && b.title.startsWith('이 협약'), b && b.title);
}
{
  // ★제목이 **다음 줄**에 있는 꼴
  const t = R('15_관련타부처/물새서식처로서국제적으로중요한습지에관한협약/조약_발췌.txt');
  const jos = AT.listArticleNumbers(t, 'law');
  ok('제목이 다음 줄인 꼴도 읽는다(람사르협약)', jos.length >= 2, jos.join('·'));
  const b = AT.extractArticleBlock(t, '제2조', 'law');
  ok('그때도 본문이 나온다', !!b && b.body.length > 100);
}
{
  // ★원문이 제목과 본문을 **붙여** 놓은 파일 — 제목을 모르는 편이 본문 0자보다 낫다
  const t = R('15_관련타부처/해양법에관한국제연합협약(UNCLOS)/조약_케이블관선.txt');
  const b = AT.extractArticleBlock(t, '제113조', 'law');
  ok('제목·본문이 붙은 원문도 본문이 비지 않는다', !!b && b.body.length > 100, b && b.body.length);
}

console.log('\n[★② 조약이 아닌 파일 — 꺼진다]');
{
  // 고시의 **개정문**(`제1조 중 "…"`)을 조문머리로 읽으면 없는 조가 목록에 실린다
  const t = R('03_해상교통안전/해상교통안전법/행정규칙/(인천지방해양수산청)장안서부근해역항행안전에관한고시.txt');
  ok('조약 표시가 없는 파일이다', !/조약일련번호|조약번호|target=trty/.test(t.slice(0, 1200)));
  ok('개정문을 조로 읽지 않는다', AT.listArticleNumbers(t, 'law').length === 0,
    AT.listArticleNumbers(t, 'law').join('·'));
}
{
  // 법률 계열 큰 파일 — 꼴④가 기존 결과를 흔들지 않는다
  const t = R('15_관련타부처/폐기물관리법/시행규칙.txt');
  const n = AT.listArticleNumbers(t, 'rule').length;
  ok('법률 계열은 종전대로 ①꼴로 읽는다(폐기물관리법 시행규칙 157조)', n === 157, n);
}

// ── ★부칙 머리줄이 조보다 먼저 와도 조를 잃지 않는다 (2026-09-24) ──────────
//   `[부칙 <제5437호,1997.12.13.>] 제정 부칙 전문` 처럼 **부칙 머리줄이 맨 앞**에 오는 파일이 있다
//   (부칙만 담은 파일·발췌본 — 실측 51개). 종전 `articleRegion()` 은 거기서 **통째로 잘라**
//   한 조도 안 열렸다. 챗봇이 그 법을 짚어도 아무것도 못 꺼냈다.
//   ⚠2026-09-22 에 폐기물관리법 시행규칙이 **같은 병**으로 151,785자가 0조가 됐었다 —
//     그때는 머리말 글을 고쳐서 넘겼고 **읽는 쪽을 안 고쳐** 다른 꼴로 되풀이됐다.
{
  const eq = (t, want, why) => {
    const got = AT.listArticleNumbers(t).length;
    if (want === '>0' ? got > 0 : got === want) { pass++; console.log(`  \u2705 ${why} (조 ${got})`); }
    else { fail++; console.log(`  \u274c FAIL ${why}: 조 ${got} (바란 것 ${want})`); }
  };
  console.log('\n[★부칙 머리줄이 먼저 오는 파일]');
  eq('[부칙 <제5437호,1997.12.13.>] 제정 부칙 전문\n제1조 (시행일) 이 법은 1998년 3월 1일부터 시행한다.\n제2조 (다른 법률의 폐지) 교육법은 이를 폐지한다.\n',
     2, '부칙 머리가 맨 앞이어도 조가 열린다');
  eq('제1조(목적) 이 법은…\n제2조(정의) …\n[부칙 <제1호,2020.1.1.>]\n제1조(시행일) …\n',
     2, '★조가 앞에 있으면 부칙에서 자른다 — 종전 그대로(부칙 조를 본문에 섞지 않는다)');
  eq('[별표 1] 어떤 표\n| a | b |\n', 0, '조가 아예 없으면 0 그대로');
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
