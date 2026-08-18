'use strict';
// ============================================================================
// [2026-08-18] 답변 본문 조문 링크 · 별표 표 줄 잇기 회귀 테스트
//   실행: node local_server/scripts/test_chat_render.js
//
//   ★왜 이 스위트가 따로 있나
//     지금까지 클라이언트(ai_chat.js) 검증은 "소스에 이 문장이 있나"(문자열 대조)뿐이었다.
//     그 방식은 **동작이 틀린 것을 못 잡는다** — 실제로 2026-08-18 사용자 지적으로,
//     "「낚시 관리 및 육성법」 … 같은 법 시행령 제16조제1항"을 누르면 시행령이 아니라
//     **법률 제16조(낚시터업의 등록)**가 열리는 사고가 드러났다(링크 누락보다 나쁜, 엉뚱한
//     원문을 여는 오류). 그래서 이 스위트는 ai_chat.js 의 **함수 원문을 그대로 떼어 내 실행**한다.
//     브라우저 전용 코드라 통째로 require 할 수 없어, 필요한 함수만 이름으로 잘라 온다.
//   ★시각 비의존 — 고정 문자열만 쓴다(CLAUDE.md 결정로그).
//
//   [연계] client/js/ai-chat/ai_chat.js(citeHTML·parseBylTable) ·
//          scripts/refactor/verify_all.sh V5 SUITES(여기 등록돼 있어야 실제로 돌아간다)
// ============================================================================
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); }
};

// ── ai_chat.js 에서 필요한 조각만 이름으로 떼어 온다 ─────────────────────────────
/** `function 이름(` 부터 짝이 맞는 닫는 괄호까지를 통째로 돌려준다. */
function fnSrc(name) {
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('함수를 못 찾음: ' + name);
  let depth = 0, started = false;
  for (let i = at; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return SRC.slice(at, i + 1); }
  }
  throw new Error('함수 끝을 못 찾음: ' + name);
}
/** `var 이름 = …;` 한 줄을 그대로 돌려준다(정규식 리터럴 보존이 목적). */
function varSrc(name) {
  const m = new RegExp('^\\s*var ' + name + ' = .*$', 'm').exec(SRC);
  if (!m) throw new Error('변수를 못 찾음: ' + name);
  return m[0];
}

const parts = [
  varSrc('NRYA_CITE_RE'), varSrc('NRYA_WIDE_RE'),
  fnSrc('baseLawName'), fnSrc('citeHTML'),
  fnSrc('bylPipeCols'), fnSrc('joinBylCell'), fnSrc('parseBylTable'),
  // 화면 밖 의존 두 가지는 이 스위트에서만 쓰는 최소 대역으로 채운다.
  'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");}',
  'function resolveCiteLaw(nm){ return IDX[String(nm||"").trim()] || null; }',
  'var NRYA_BOX_RE=/[┌┬┐├┼┤└┴┘─│┃]/; var NRYA_BOX_ONLY_RE=/^[\\s┌┬┐├┼┤└┴┘─│┃]*$/;',
  'return { citeHTML: citeHTML, parseBylTable: parseBylTable, joinBylCell: joinBylCell };',
];
// IDX 는 "우리가 원문을 가진 법" 표 — resolveCiteLaw 가 이걸 보고 링크 여부를 정한다.
const make = new Function('IDX', parts.join('\n'));

const L = { law: '낚시 관리 및 육성법', tier: 'law', base: '' };
const D = { law: '낚시 관리 및 육성법 시행령', tier: 'decree', base: '낚시 관리 및 육성법' };
const R = { law: '낚시 관리 및 육성법 시행규칙', tier: 'rule', base: '낚시 관리 및 육성법' };
const FULL = make({ '낚시 관리 및 육성법': L, '낚시 관리 및 육성법 시행령': D, '낚시 관리 및 육성법 시행규칙': R });
const LAWONLY = make({ '낚시 관리 및 육성법': L });   // 시행령을 우리가 안 가진 상황

/** 만들어진 HTML 에서 (링크된 글자 → 그 링크가 여는 법령) 짝만 뽑는다. */
function links(html) {
  const out = [];
  const re = /<span class="nrya-cite" data-law="([^"]*)" data-article="([^"]*)"/g;
  let m; while ((m = re.exec(html))) out.push(m[2] + ' → ' + m[1]);
  return out;
}

// ── T1. 계층(시행령·시행규칙)을 무시해 엉뚱한 원문을 열던 사고 ─────────────────────
console.log('\n[T1] 계층 표기 — 시행령 조문이 법률로 열리면 안 된다');
// ★사용자 재현 문장 그대로. 예전에는 제16조제1항이 **법률**로 링크돼 제16조(낚시터업의 등록)가 열렸다.
const t1 = FULL.citeHTML(
  '「낚시 관리 및 육성법」 제25조제1항에 따라 신고해야 하며, 같은 법 시행령 제16조제1항에서 정한다.', null);
ok('T1-1 ★같은 법 시행령 제N조는 시행령으로 열린다',
  links(t1).indexOf('제16조제1항 → 낚시 관리 및 육성법 시행령') >= 0, links(t1).join(' / '));
ok('T1-2 앞의 법률 조문은 그대로 법률로 열린다',
  links(t1).indexOf('제25조제1항 → 낚시 관리 및 육성법') >= 0, links(t1).join(' / '));
const t2 = FULL.citeHTML('「낚시 관리 및 육성법」 제47조제3항, 같은 법 시행규칙 제25조제2항에 따른다.', null);
ok('T1-3 ★같은 법 시행규칙 제N조는 시행규칙으로 열린다',
  links(t2).indexOf('제25조제2항 → 낚시 관리 및 육성법 시행규칙') >= 0, links(t2).join(' / '));
// ★가장 중요한 안전장치: 우리가 그 시행령을 안 가졌으면 **모법으로 대신 열지 않는다**.
const t3 = LAWONLY.citeHTML('「낚시 관리 및 육성법」 제25조제1항 및 같은 법 시행령 제16조제1항.', null);
ok('T1-4 ★시행령 원문이 없으면 링크를 포기한다(모법으로 대신 열지 않는다)',
  links(t3).join(',').indexOf('제16조제1항') < 0, links(t3).join(' / '));

// ── T2. 문장 경계·일반 문구에서 잘못 걸리지 않기 ────────────────────────────────
console.log('\n[T2] 계층 전환이 과하게 걸리지 않는다');
const t4 = FULL.citeHTML('「낚시 관리 및 육성법」 제25조제1항은 대통령령으로 정하는 요건을 말한다. 제9조도 본다.', null);
ok('T2-1 문장이 끝나면 법 맥락을 버린다(제9조는 링크 없음)',
  links(t4).length === 1 && links(t4)[0].indexOf('제25조제1항') === 0, links(t4).join(' / '));
const t5 = FULL.citeHTML('「낚시 관리 및 육성법」 시행령에서 정하는 바에 따라 제25조제1항을 적용한다.', null);
// "시행령에서" 뒤에는 조문 표기가 바로 오지 않으므로 계층 전환으로 읽지 않는다 → 법률 그대로.
ok('T2-2 뒤에 조문이 안 붙은 "시행령"은 계층 전환으로 읽지 않는다',
  links(t5).indexOf('제25조제1항 → 낚시 관리 및 육성법') >= 0, links(t5).join(' / '));
const t6 = FULL.citeHTML('같은 법 시행령 제16조제1항에서 정한다.', null);
ok('T2-3 앞에 밝힌 법이 하나도 없으면 링크하지 않는다', links(t6).length === 0, links(t6).join(' / '));
const t7 = FULL.citeHTML('「낚시 관리 및 육성법 시행령」 제16조제1항 및 별표 4에 따른다.', null);
ok('T2-4 낫표 안에 계층까지 넣은 표기는 예전처럼 그대로 열린다',
  links(t7).indexOf('제16조제1항 → 낚시 관리 및 육성법 시행령') >= 0, links(t7).join(' / '));
ok('T2-5 별표도 같은 법령으로 열린다',
  links(t7).join(' / ').indexOf('별표 4 → 낚시 관리 및 육성법 시행령') >= 0, links(t7).join(' / '));

// ── T3. 별표 표 — 원문 줄바꿈을 **함부로 잇지 않는다**(2026-08-18 재검토) ─────────────
// 사용자 지적("한 줄짜리 내용이 끊겨 보인다")을 받아 자동으로 잇는 규칙을 만들어 봤으나, 전수
// 측정에서 **낱말 가운데서 끊긴 줄과 낱말 사이에서 끊긴 줄이 같은 값으로 나와** 가를 수 없었다.
// 잘못 이으면 법령 원문의 낱말이 붙거나 갈라진다 → 잇지 않는 쪽으로 확정하고 여기에 못 박는다.
console.log('\n[T3] 별표 칸 — 원문 줄바꿈을 함부로 잇지 않는다');
ok('T3-1 ★칸이 여러 줄이면 원문 줄바꿈을 그대로 살린다',
  FULL.joinBylCell('1. 국가관리무역항', '(14개)') === '1. 국가관리무역항\n(14개)');
ok('T3-2 한쪽이 비면 있는 쪽만 남긴다',
  FULL.joinBylCell('', '나중 줄') === '나중 줄' && FULL.joinBylCell('앞 줄', '') === '앞 줄');
const TBL = [
  '┌──────┬────────────────────────────────┐',
  '│구분        │설비                                                            │',
  '├──────┼────────────────────────────────┤',
  '│1. 안전·구 │가. 최대승선인원의 120퍼센트 이상에 해당하는 수의 구명조끼. 이  │',
  '│명설비      │중 20퍼센트 이상은 어린이용으로 하여야 한다.                    │',
  '└──────┴────────────────────────────────┘',
];
const rows = FULL.parseBylTable(TBL);
ok('T3-3 표는 그대로 읽힌다', !!rows && rows.length >= 2, rows && rows.length);
ok('T3-4 ★원문에 없던 띄어쓰기를 만들지 않는다',
  !!rows && (rows[rows.length - 1][1] || '').indexOf('이 중 20퍼센트') < 0);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
