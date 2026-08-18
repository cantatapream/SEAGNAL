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
  fnSrc('bylPipeCols'), fnSrc('joinBylCell'), fnSrc('parseBylTable'), fnSrc('bylHasAsciiTable'),
  // 화면 밖 의존 두 가지는 이 스위트에서만 쓰는 최소 대역으로 채운다.
  'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");}',
  'function resolveCiteLaw(nm){ return IDX[String(nm||"").trim()] || null; }',
  'var NRYA_BOX_RE=/[┌┬┐├┼┤└┴┘─│┃]/; var NRYA_BOX_ONLY_RE=/^[\\s┌┬┐├┼┤└┴┘─│┃]*$/;',
  'return { citeHTML: citeHTML, parseBylTable: parseBylTable, joinBylCell: joinBylCell,' +
  '  hasAscii: bylHasAsciiTable };',
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
  !!rows && ((rows[rows.length - 1][1] || {}).text || '').indexOf('이 중 20퍼센트') < 0);

// ── T4. 대화 기억 — 쌓기·6시간 만료·압축 (2026-08-18 사용자 확정) ─────────────────
console.log('\n[T4] 대화 기억 — 쌓기·만료·압축');
const MEM = new Function([
  varSrc('chatTurns'), varSrc('lastTurnAt'), varSrc('CHAT_MEMORY_TTL_MS'),
  varSrc('CHAT_MEMORY_MAX_CHARS'), varSrc('CHAT_MEMORY_KEEP_FULL'), varSrc('CHAT_MEMORY_MAX_TURNS'),
  fnSrc('chatMemoryAlive'), fnSrc('forgetChatMemory'), fnSrc('rememberTurn'),
  fnSrc('firstParagraph'), fnSrc('chatMemoryForSend'),
  'return { remember: rememberTurn, forSend: chatMemoryForSend, forget: forgetChatMemory,' +
  '  first: firstParagraph, age: function (ms) { lastTurnAt -= ms; },' +
  '  ttl: CHAT_MEMORY_TTL_MS, cap: CHAT_MEMORY_MAX_CHARS };',
].join('\n'))();

// 답변은 규칙 6번이 강제하는 "쉽게 말하면 ~" 결론 요약으로 시작한다 — 그게 곧 압축본이다.
const LONG = '쉽게 말하면, 신고제입니다.\n\n' + '자세한 설명 '.repeat(400);
for (let i = 1; i <= 5; i += 1) MEM.remember('질문' + i, LONG);
const sent = MEM.forSend();
ok('T4-1 이어 물은 대화가 순서대로 쌓인다',
  sent.length === 5 && sent[0].q === '질문1' && sent[4].q === '질문5', sent.length);
ok('T4-2 ★최근 2턴은 통째로 남는다',
  sent[3].a.length > 1000 && sent[4].a.length > 1000, sent[3].a.length + '/' + sent[4].a.length);
ok('T4-3 ★오래된 턴은 "쉽게 말하면 ~" 첫 문단만 남는다',
  sent[0].a === '쉽게 말하면, 신고제입니다.', JSON.stringify(sent[0].a));
ok('T4-4 ★줄인 뒤 전체 길이가 상한 안이다',
  sent.reduce((n, t) => n + t.q.length + t.a.length, 0) <= MEM.cap);
ok('T4-5 첫 문단 뽑기 — 빈 줄이 없으면 첫 문장까지',
  MEM.first('쉽게 말하면 신고제입니다. 그리고 또') === '쉽게 말하면 신고제입니다.',
  JSON.stringify(MEM.first('쉽게 말하면 신고제입니다. 그리고 또')));
// ★6시간이 지나면 그 대화는 끝난 것으로 본다(사용자 확정) — 어제 하던 얘기가 오늘 딸려오지 않게.
MEM.age(MEM.ttl + 1000);
ok('T4-6 ★6시간이 지나면 기억이 이어지지 않는다', MEM.forSend() === null);
MEM.remember('새 질문', '쉽게 말하면, 새 답변입니다.');
const after = MEM.forSend();
ok('T4-7 만료 뒤에는 새 대화로 다시 시작한다',
  !!after && after.length === 1 && after[0].q === '새 질문', after && after.length);
MEM.forget();
ok('T4-8 "다른 종류의 질문"이면 기억을 버린다', MEM.forSend() === null);
// 턴 수 상한 — 줄이기는 글자만 줄이므로 턴 자체에도 상한이 있어야 끝없이 안 쌓인다.
for (let i = 0; i < 30; i += 1) MEM.remember('질문' + i, '쉽게 말하면, 답입니다.');
ok('T4-9 아주 길게 이어 물어도 턴 수가 상한 안이다', MEM.forSend().length <= 12, MEM.forSend().length);

// ── T5. 서버는 앱이 보낸 기억을 믿지 않는다 ───────────────────────────────────────
console.log('\n[T5] 서버 쪽 정규화 — 앱이 보낸 값을 그대로 믿지 않는다');
const RET = require(path.join(__dirname, '..', 'services', 'legal_retriever.js'));
ok('T5-1 배열이 아니면 빈 배열', RET.normalizeHistory('아무거나').length === 0 &&
  RET.normalizeHistory(null).length === 0 && RET.normalizeHistory({}).length === 0);
ok('T5-2 q·a 가 없는 턴은 버린다',
  RET.normalizeHistory([{ q: '', a: '답' }, { q: '질문' }, { q: '질문', a: '답' }]).length === 1);
ok('T5-3 턴 하나가 아주 길어도 잘라 담는다',
  RET.normalizeHistory([{ q: 'ㄱ'.repeat(9999), a: 'ㄴ'.repeat(9999) }])[0].a.length === 4000);
const many = RET.normalizeHistory(Array.from({ length: 40 }, (_, i) => ({ q: 'q' + i, a: 'ㄱ'.repeat(3000) })));
ok('T5-4 총량이 넘치면 오래된 턴부터 버린다',
  many.reduce((n, t) => n + t.q.length + t.a.length, 0) <= 12000 &&
  many[many.length - 1].q === 'q39', many.length);
// ★R0 — 이어 묻지 않는 질문은 프롬프트가 오늘과 바이트 동일해야 한다.
ok('T5-5 ★기억이 없으면 프롬프트에 아무것도 안 붙는다(R0)',
  RET.historyBlock([]) === '' && RET.historyBlock(null) === '');
ok('T5-6 기억이 있으면 대화 블록이 붙는다',
  /\[방금까지 나눈 대화\]/.test(RET.historyBlock([{ q: '질문', a: '답' }])));
// ★답의 근거는 여전히 근거자료뿐 — 지난 대화의 조문을 근거로 재사용하지 말라고 못 박는다.
ok('T5-7 ★지난 대화의 조문을 근거로 다시 쓰지 말라고 지시한다',
  /답의 근거는 여전히 \[근거자료\]뿐/.test(RET.historyBlock([{ q: '질문', a: '답' }])));

// ── T6. 병합 셀이 있는 표도 표로 그린다 (2026-08-18 사용자 지적) ────────────────────
// "어떤 건 표로 나오고 어떤 건 아스키로 나온다" — 같은 별표 안에서도 갈렸다. 원인은 줄마다 칸 수가
// 다르면(한 칸이 다시 여러 칸으로 갈리는 병합·중첩 표) **표 전체를 포기**하던 것이었다.
// 이제는 포기하지 않고 행을 끊어 이어가고, 칸 자리는 열 위치 대조가 판정한다(못 정하면 ASCII).
console.log('\n[T6] 병합 셀 표 — 포기하지 말고 행을 끊어 이어간다');
// ⚠표본은 **손으로 만들지 않고 실제 원문에서 떼어 온다** — 원문 표는 칸 폭이 열 단위로 딱 맞아야
//   하는데, 손으로 그리면 그 폭이 어긋나 테스트가 진짜 동작을 못 본다(처음에 그렇게 만들었다가
//   실제로는 되는 표가 테스트에서만 실패했다).
function bylChunks(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let buf = [], isT = null;
  const flush = () => {
    if (buf.length && isT && buf.filter(l => /[│┃]/.test(l)).length >= 3) out.push(buf);
    buf = [];
  };
  for (const ln of lines) {
    const t = /[┌┬┐├┼┤└┴┘─│┃]/.test(ln);
    if (isT !== null && t !== isT) flush();
    isT = t; buf.push(ln);
  }
  flush();
  return out;
}
const BYL7 = path.join(__dirname, '..', 'knowledge', 'legal', 'raw',
  '05_수산어업', '수산업법', '별표', '시행령_별표7.txt');
// 이 별표는 표 덩어리가 4개인데, 예전에는 뒤쪽만 표로 그려지고 앞쪽은 아스키로 떨어졌다.
// ⚠첫 덩어리(근해어업, 213줄)는 **지금도 아스키**다 — 한 줄 안에 글자와 중첩 표의 구분선이
//   섞여 있어(`… │목망으로 된   ├────┼────┤`) 줄 단위로는 안전하게 읽을 수 없다.
//   무리해서 읽으면 금지기간·금지구역이 엉뚱한 행에 붙는다 — 그건 보기 불편함보다 훨씬 나쁘다.
const chunks7 = bylChunks(BYL7);
const drawn7 = chunks7.map(function (c) { return !!FULL.parseBylTable(c); });
ok('T6-1 ★뒤쪽 표들은 표로 그려진다', drawn7.filter(Boolean).length >= 3,
  drawn7.map(function (b) { return b ? 'T' : 'F'; }).join(''));
ok('T6-2 ★못 읽는 표는 그대로 아스키로 떨어진다(엉뚱한 행에 붙이지 않는다)',
  drawn7[0] === false);
// 앞쪽 칸이 병합된 표 — 예전 판정은 **맨 끝 칸만** 넓힐 수 있어 이런 표를 통째로 포기했다.
{
  const f = path.join(__dirname, '..', 'knowledge', 'legal', 'raw', '01_해양주권정책',
    '해양조사와해양정보활용에관한법률', '별표', '시행규칙_별표6.txt');
  let lead = 0;
  bylChunks(f).forEach(function (c) {
    const r = FULL.parseBylTable(c);
    if (!r) return;
    r.forEach(function (row) {
      row.forEach(function (cell, i) { if (cell.span > 1 && i < row.length - 1) lead += 1; });
    });
  });
  ok('T6-2b ★앞쪽 칸이 병합된 표도 원문에 그어진 선 그대로 넓혀 그린다', lead > 0, lead);
}
// ★자리를 못 정하는 표는 여전히 ASCII 로 떨어진다 — 엉뚱한 칸에 값이 들어가느니 그 편이 낫다.
ok('T6-3 ★열 자리가 안 맞으면 여전히 표로 그리지 않는다(엉뚱한 칸 방지)',
  FULL.parseBylTable([
    '│가│나│다│',
    '│어긋난칸        │값│',
    '│가│나│다│',
  ]) === null);
// 실제 저장소 원문 — 사용자가 본 그 별표(수산업법 시행령 별표7)가 표로 그려지나.
{
  const drawn = bylChunks(BYL7).filter(c => !!FULL.parseBylTable(c)).length;
  ok('T6-4 ★사용자가 본 별표(수산업법 시행령 별표7)가 표로 그려진다',
    drawn >= 3, drawn + '/' + bylChunks(BYL7).length);
}
// ★2026-08-18(사용자 확정): 표로 못 읽는 표가 섞인 별표는 **원본 이미지를 먼저** 보여준다.
//   "반드시 표를 봐야 하는 경우에는 아스키가 아니라 이미지가 나와야 한다"(사용자 원문).
{
  const asciiChunk = chunks7[0];                       // 근해어업 — 표로 못 읽는 덩어리
  const tableChunk = chunks7[1];                       // 연안어업 — 표로 잘 읽히는 덩어리
  ok('T6-6 ★표로 못 읽는 별표를 가려낸다(이 판정으로 이미지를 먼저 보여준다)',
    FULL.hasAscii(asciiChunk.join('\n')) === true);
  ok('T6-7 표가 다 읽히는 별표는 예전처럼 글자를 먼저 보여준다',
    FULL.hasAscii(tableChunk.join('\n')) === false);
  ok('T6-8 판정이 renderBylText 와 같은 규칙으로 덩어리를 나눈다',
    /renderBylText 와 \*\*같은 방식으로\*\* 덩어리를 나눠/.test(SRC));
  ok('★못 읽는 표 + 원본 이미지가 있으면 이미지를 먼저 그린다',
    /if \(imgs\.length && bylHasAsciiTable\(ref\.body\)\) \{\n\s*renderBylImages\(body, imgs\);/.test(SRC));
  ok('글자를 버리지 않는다 — "글자로 보기"로 펼칠 수 있다',
    /bylHasAsciiTable\(ref\.body\)\)[\s\S]{0,120}appendBylTextToggle\(body, ref\.body\)/.test(SRC));
}

ok('T6-5 표는 가로로 밀어 볼 수 있게 감싼다',
  /nrya-byl-scroll/.test(SRC) && /overflow-x:auto/.test(
    fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'css', 'ai_chat.css'), 'utf8')));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
