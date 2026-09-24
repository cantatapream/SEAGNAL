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
  // ★숫자를 여기 박지 않는다 (2026-09-24 — `=== 15` 라 적어 뒀다가 7자리를 더 채우자 빨간불이 났다).
  //   이 값의 **임자는 `byl_body_census.js`(V5-39)** 다. 시험이 지킬 것은 숫자가 아니라 **성질**이다:
  //   *조례 별표는 하나도 `text` 가 아니다* — 제공처가 조례 별표를 본문 글로 주지 않기 때문이다(전수 실측).
  {
    const ord = walk(path.join(RAW, '_자치법규'), []);
    const kinds = ord.map((p) => AT.bylBodyKind(fs.readFileSync(p, 'utf8')));
    ok(`조례 별표는 하나도 글이 없다 — 전부 주소만이다 (지금 ${ord.length}개)`,
      ord.length > 0 && kinds.every((k) => k === 'linkOnly'),
      JSON.stringify(kinds.reduce((a, k) => (a[k] = (a[k] || 0) + 1, a), {})));
  }
}


// ── 이름 자체가 「…규칙」인 문서 (2026-09-24, 결심 ⓐ) ────────────────────────
//   폴더는 `법률.txt` 로 철해 두는데 위키는 「시행규칙 별표N」이라 부른다. 같은 자리다.
//   ★번호·종류까지 느슨해지면 안 된다 — 아래 마지막 두 줄이 그것을 지킨다.
{
  const ok = (t, p, k, want, why) => {
    const got = AT.bylDeclMatches(t, p, k);
    if (got === want) { pass++; } else { fail++; console.log(`  FAIL ${why}: ${got} (바란 것 ${want})`); }
  };
  const 규칙 = '■ 선박톤수의 측정에 관한 규칙 [별표 1]\n선체주부의 분장점\n┃표┃\n';
  const 저장규칙 = '■ 위험물 선박운송 및 저장규칙 [별표 2]\n내용\n';
  const 보통법 = '■ 항만법 [별표 1]\n내용\n';
  ok(규칙, '시행규칙', { type: '별표', num: '1' }, true,  '이름이 규칙 → 시행규칙으로 불러도 같다');
  ok(규칙, '법률',     { type: '별표', num: '1' }, true,  '이름이 규칙 → 법률(제 자리)로도 같다');
  ok(규칙, '시행령',   { type: '별표', num: '1' }, false, '시행령까지 받아 주면 안 된다');
  ok(규칙, '시행규칙', { type: '별표', num: '2' }, false, '★번호가 다르면 여전히 아니다');
  ok(규칙, '시행규칙', { type: '서식', num: '1' }, false, '★종류가 다르면 여전히 아니다');
  ok(저장규칙, '시행규칙', { type: '별표', num: '2' }, true, '「…저장규칙」도 마찬가지');
  ok(보통법, '시행규칙', { type: '별표', num: '1' }, false, '★보통 법률은 느슨해지지 않는다');
}

// ── ★접힌 메타 줄 (2026-09-24, 하루에 두 번 만든 병) ──────────────────────
//   ①`주의:` 줄 아래에 들여쓴 이어짐 줄을 쓰면 그 줄이 **본문 글로 세어진다.**
//     → 주소만 있는 파일이 「글이 있다」로 통과했다(6개 + 7개).
//   ②그 고침이 곧바로 **새 병**을 만들었다. `bylDeclLine()` 이 빈 문자열을 주는 파일에서
//     `l.trim() !== decl` 가 **빈 줄을 전부 지워** 머리 바로 뒤에 본문이 붙은 꼴이 되고,
//     「접힌 메타」 규칙이 **30KB 진짜 본문을 삼켰다**(`부유식해상구조물…_별표4`).
//   두 방향을 다 박아 둔다 — 한쪽만 재면 반대쪽으로 굴러떨어진다.
{
  const eq = (t, want, why) => {
    const got = AT.bylBodyKind(t);
    if (got === want) { pass++; console.log(`  ✅ ${why}`); }
    else { fail++; console.log(`  FAIL ${why}: ${got} (바란 것 ${want})`); }
  };
  console.log('\n[⑥ 접힌 메타 줄]');
  eq('제목\n출처: 어디\n주의: 첫 줄\n  이어지는 들여쓴 줄\n별표서식파일링크: https://x/y\n',
     'linkOnly', '★들여쓴 이어짐 줄은 본문이 아니다');
  eq('제목\n출처: 어디\n주의: 첫 줄\n\n  빈 줄 뒤의 들여쓴 줄은 본문이다\n별표서식파일링크: https://x/y\n',
     'text', '★빈 줄이 이어짐을 끊는다');
  // ②를 그대로 재현한다 — 선언줄이 없고(빈 문자열), 메타 바로 뒤에 들여쓴 본문이 온다.
  eq('제목\n출처: 어디\n별표서식PDF파일링크: /LSW/flDownload.do?flSeq=1\n\n\n      (1 면)\n  [별표 4]\n  증서번호  제   호\n',
     'text', '★선언줄이 빈 파일에서도 본문을 안 삼킨다(30KB 사고)');
  eq('제목\n출처: 어디\n별표서식파일링크: https://x/y\n', 'linkOnly', '주소만 있으면 linkOnly 그대로');
  eq('제목\n출처: 어디\n', 'none', '아무것도 없으면 none 그대로');
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);