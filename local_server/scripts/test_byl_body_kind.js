/**
 * test_byl_body_kind — 별표 파일의 **속이 무엇인가**를 세 갈래로 가르는 자를 못박는다. (3-49)
 *
 * [왜] `hasBylBody()` 가 `출처:`·`별표서식파일링크:` 같은 **머리 메타 줄을 본문으로** 세고 있었다.
 *   그래서 **내려받기 주소만 있는 파일이 「원문이 있다」로 통과**했다 — 실측 **284개 파일**.
 *   챗봇은 그 자리에서 **빈 팝업**을 띄우고 다음 단계(내려받기 링크)를 건너뛰었다.
 *   ★그 상태로 3-49(조례 별표 첨부 주소)를 채우면 게이트의 「없다 22」가 0으로 떨어지면서
 *     원문은 하나도 없는 **거짓 초록불**이 된다. 그래서 **세는 법을 먼저** 고쳤다.
 *
 * [무엇을 못박나]
 *   ① 세 갈래가 갈린다 — `text` / `linkOnly` / `none`
 *   ② `hasBylBody()` 는 `text` 일 때만 참이다(옛 소비자들이 그대로 쓴다)
 *   ★③ 메타 줄 이름 뒤에 **숫자 꼬리**가 붙어도 메타로 본다(`주의2:` — 실측으로 잡힌 함정)
 *   ★④ 주소만 있는 파일에서도 **내려받기 주소는 여전히 뽑힌다**(사용자는 원문을 볼 수 있다)
 *
 * [연계] ← `local_server/services/article_text.js`(bylBodyKind·hasBylBody·parseBylFile)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AT = require(path.join(__dirname, '..', 'services', 'article_text.js'));
const RAW = path.join(__dirname, '..', 'knowledge', 'legal', 'raw');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); }
};

console.log('\n[① 세 갈래가 갈린다]');
ok('글이 있으면 text', AT.bylBodyKind('[별표 1] 요금표\n출처: x\n| 구분 | 금액 |\n| 갑 | 100 |') === 'text');
ok('주소만 있으면 linkOnly',
  AT.bylBodyKind('[별표 1] 요금표\n출처: y\n별표서식파일링크: /LSW/flDownload.do?flSeq=1') === 'linkOnly');
ok('선언줄뿐이면 none', AT.bylBodyKind('■ 도선법 시행규칙 [별표 7] 삭제') === 'none');
ok('빈 파일도 none', AT.bylBodyKind('') === 'none');

console.log('\n[② hasBylBody 는 text 일 때만 참]');
ok('text → 참', AT.hasBylBody('[별표 1] x\n| 가 | 나 |') === true);
ok('★linkOnly → 거짓 (원문이 있는 척하지 않는다)',
  AT.hasBylBody('[별표 1] x\n출처: y\n별표서식파일링크: /LSW/flDownload.do?flSeq=1') === false);
ok('none → 거짓', AT.hasBylBody('■ [별표 7] 삭제') === false);

console.log('\n[★③ 메타 줄 이름 뒤 숫자 꼬리 — 실측으로 잡힌 함정]');
ok('`주의2:` 도 메타로 본다(본문으로 세면 linkOnly 가 text 가 된다)',
  AT.bylBodyKind('[별표 1] x\n주의: a\n주의2: b\n별표서식파일링크: /LSW/flDownload.do?flSeq=1') === 'linkOnly');

console.log('\n[★④ 주소만 있는 파일에서도 내려받기 주소는 뽑힌다]');
{
  const p = path.join(RAW, '_자치법규/전남광주통합특별시/해남군해수욕장운영관리조례/별표/법률_별표1.txt');
  ok('3-49 가 만든 파일이 있다', fs.existsSync(p));
  if (fs.existsSync(p)) {
    const t = fs.readFileSync(p, 'utf8');
    ok('그 파일은 linkOnly 다', AT.bylBodyKind(t) === 'linkOnly', AT.bylBodyKind(t));
    const r = AT.parseBylFile(t);
    ok('내려받기 주소가 뽑힌다 — 사용자는 원문을 볼 수 있다',
      r.entries.some((e) => /flDownload\.do/.test(e.hwp || '') || /flDownload\.do/.test(e.pdf || '')),
      JSON.stringify(r.entries.map((e) => e.key)));
  }
}

console.log('\n[⑤ 실제 raw 전수 — 갈래가 섞이지 않는다]');
{
  const walk = (d, out) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '_대기') walk(p, out); }
      else if (e.name.endsWith('.txt') && /(^|\/)별표\//.test(path.relative(RAW, p).split(path.sep).join('/'))) out.push(p);
    }
    return out;
  };
  const c = { text: 0, linkOnly: 0, none: 0 };
  for (const p of walk(RAW, [])) c[AT.bylBodyKind(fs.readFileSync(p, 'utf8'))]++;
  ok('세 갈래가 다 나온다(하나로 쏠리면 자가 고장 난 것이다)',
    c.text > 1000 && c.linkOnly > 0 && c.none > 0, JSON.stringify(c));
  ok('조례 별표 15개는 전부 linkOnly 다(3-49)',
    walk(path.join(RAW, '_자치법규'), []).filter((p) => AT.bylBodyKind(fs.readFileSync(p, 'utf8')) === 'linkOnly').length === 15);
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
