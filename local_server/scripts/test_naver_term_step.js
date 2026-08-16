'use strict';
// ============================================================================
// [2026-08-16 §4-U] 모르는 구어 해소(네이버 뜻 확인) 회귀 테스트
//   실행: node local_server/scripts/test_naver_term_step.js
//   설계 원문: knowledge/legal/_dashboard/NAVER_GUEO_PENDING_MERGE.md §4(4-1~4-9)
//
//   ★네이버 API·Gemini 를 **실제로 부르지 않는다** — 둘 다 require.cache 를 선점해 가짜 모듈로
//     갈아끼운다. 이 스위트가 고정하는 것은 "우리 쪽 배선"이다:
//       ⓐ ctx 왕복(카드 → "네" → 확인된 뜻이 검색어로 되돌아옴 → 소진)
//       ⓑ 라운드 회계(§4-6 ①②③ — 되묻기 1회, 그 다음은 정직한 포기)
//       ⓒ 변조·재생 방어(확인 안 된 뜻·조문이 섞인 뜻은 버린다)
//       ⓓ 스위치 off 면 완전한 no-op(R0)
//     네이버 API 자체의 동작(엔드포인트·응답 필드·<수산> 태그)은 2026-08-16 GitHub Actions
//     실키 호출로 이미 검증됐다(NAVER_GUEO_PENDING_MERGE.md §3-1) — 여기서 다시 보지 않는다.
//   ★시각 비의존 — 고정 문자열만 쓴다(CLAUDE.md 결정로그).
//
//   [연계] services/legal_retriever.js(§4-U 절) · services/naver_search.js(가짜로 대체) ·
//          routes/legal.js(스위치·배선·학습후보 적재) ·
//          scripts/refactor/verify_all.sh V5 SUITES(여기에 등록돼 있어야 실제로 돌아간다)
// ============================================================================
const fs = require('fs');
const path = require('path');

const SRV = path.join(__dirname, '..');
const GEMINI_PATH = require.resolve(path.join(SRV, 'services', 'gemini_client.js'));
const NAVER_PATH = require.resolve(path.join(SRV, 'services', 'naver_search.js'));

// ── 가짜 모듈 주입(legal_retriever 를 require 하기 **전에** 캐시를 선점한다) ──────────
let geminiCalls = 0, naverCalls = 0;
let geminiReply = '{"ok":true,"meaning":"통발 안쪽으로 좁아지는 입구"}';
let naverItems = [{ source: 'encyc', title: '<b>깔때기</b>', snippet: '&lt;수산&gt; 저인망이나 통발 속에 설치하는…', score: 8 }];
const fake = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports, children: [], paths: [] }; };
fake(GEMINI_PATH, {
  hasAnyKey: () => true,
  callGemini: async () => { geminiCalls++; return { success: true, text: geminiReply }; },
  callGeminiRaw: async () => ({ success: false }),
});
fake(NAVER_PATH, {
  correctTypo: async (q) => q,
  searchTermMeaning: async () => { naverCalls++; return naverItems; },
  domainScore: () => 0,
});
process.env.NAVER_CLIENT_ID = 'test-id';
process.env.NAVER_CLIENT_SECRET = 'test-secret';

const R = require(path.join(SRV, 'services', 'legal_retriever.js'));
const ROUTES_SRC = fs.readFileSync(path.join(SRV, 'routes', 'legal.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); }
};
const NU0 = { rounds: 0, state: 'none', term: '', meaning: '' };
const Q = '깔때기가 뭐죠';

// ── T0. R0 — 스위치 off 면 이 단계가 통째로 없는 것과 같다 ──────────────────────────
console.log('\n[T0] R0 — 스위치 off·맥락 미전송이면 오늘과 동일');
(async () => {
  const before = geminiCalls + naverCalls;
  ok('스위치 off → null', await R.naverTermStep(Q, NU0, false) === null);
  ok('off 면 외부 호출이 0회', geminiCalls + naverCalls === before);
  const empty = R.normalizeAskCtx(null, { fields: {} });
  ok('ctx 없으면 nu 기본값', empty.nu.rounds === 0 && empty.nu.state === 'none'
    && empty.nu.term === '' && empty.nu.meaning === '');
  ok('기본 nu 는 ctxNext 에 안 실린다(done JSON 바이트 동일)', R.ctxNextOf(empty) === null);
  ok('nu 가 기본값이면 ctxNext 에 nu 필드 자체가 없다',
    R.ctxNextOf(R.normalizeAskCtx({ uc: { rounds: 1, state: 'none' } }, { fields: {} })).nu === undefined);
  ok('routes 스위치 기본 false', /naverTermLookup: c\.naverTermLookup === true,/.test(ROUTES_SRC));
  ok('routes BOOL_SWITCHES 에 등록', /'profileConfirm', 'naverTermLookup'\]/.test(ROUTES_SRC));

  // ── T1. §4-6 ① 뜻을 찾았다 → 확인 카드 ────────────────────────────────────────
  console.log('\n[T1][§4-6 ①] 뜻을 찾으면 "혹시 이 뜻인가요?" 확인 카드');
  const card = await R.naverTermStep(Q, NU0, true);
  ok('카드가 나온다', !!(card && card.clarify), card);
  ok('confirmKind 가 naverTerm', card.confirmKind === 'naverTerm');
  ok('선택지 2개(네/아니요)', card.clarify.options.length === 2);
  ok('질문에 낱말과 뜻이 모두 보인다',
    card.clarify.question.includes('깔때기') && card.clarify.question.includes('통발 안쪽으로 좁아지는 입구'));
  ok('"네"가 확인 상태를 실어 보낸다', card.clarify.options[0].ctx.nu.state === 'confirmed'
    && card.clarify.options[0].ctx.nu.meaning === '통발 안쪽으로 좁아지는 입구'
    && card.clarify.options[0].ctx.nu.term === '깔때기');
  ok('"아니요"는 뜻을 안 싣고 라운드만 올린다(승인받지 못한 뜻)',
    card.clarify.options[1].ctx.nu.state === 'none' && !card.clarify.options[1].ctx.nu.meaning
    && card.clarify.options[1].ctx.nu.rounds === 1);
  ok('"아니요"는 act:ask — 사용자가 새로 칠 문장 한 번에 라운드가 실린다',
    card.clarify.options[1].act === 'ask');
  ok('답변 문구에 법 이야기가 없다(뜻 확인 단계)', !/제\s*\d+\s*조|과태료|벌금/.test(card.answer));

  // ── T2. ctx 왕복 — "네"를 누른 값이 검색에 쓰일 수 있는 형태로 되돌아온다 ─────────
  console.log('\n[T2] ctx 왕복 — "네" → 정규화 → 확인된 뜻이 살아 돌아온다');
  const back = R.normalizeAskCtx(card.clarify.options[0].ctx, { fields: {} });
  ok('state=confirmed 로 통과', back.nu.state === 'confirmed');
  ok('뜻이 후검사를 통과해 살아남는다', back.nu.meaning === '통발 안쪽으로 좁아지는 입구');
  ok('낱말도 함께 온다(학습후보 적재용)', back.nu.term === '깔때기');
  ok('ctxNext 에 nu 가 실린다(다음 턴까지 전달)', !!R.ctxNextOf(back).nu);
  const beforeConfirmed = geminiCalls + naverCalls;
  ok('확인된 뜻이 있으면 §4-U 는 물러난다(호출부가 검색에 쓴다)',
    await R.naverTermStep(Q, back.nu, true) === null);
  ok('물러날 때 외부 호출 0회', geminiCalls + naverCalls === beforeConfirmed);

  // ── T3. §4-6 ② 뜻을 못 찾았다 → 재질문 1회 ────────────────────────────────────
  console.log('\n[T3][§4-6 ②] 뜻을 못 찾으면 재질문 딱 1회');
  geminiReply = '{"ok":false}';
  const retry = await R.naverTermStep(Q, NU0, true);
  ok('카드가 나온다', !!(retry && retry.clarify));
  ok('선택지는 "다시 설명할게요" 하나뿐', retry.clarify.options.length === 1
    && retry.clarify.options[0].act === 'ask');
  ok('라운드가 1 올라간다', retry.clarify.options[0].ctx.nu.rounds === 1);
  ok('지어내지 않았다고 밝힌다', /지어내지/.test(retry.answer));
  // 검색 결과가 아예 0건이어도 같은 갈래(억지로 고르지 않는다)
  naverItems = [];
  const retry2 = await R.naverTermStep(Q, NU0, true);
  ok('검색결과 0건도 같은 재질문 갈래', !!(retry2 && retry2.clarify) && retry2.clarify.options.length === 1);
  naverItems = [{ source: 'encyc', title: '깔때기', snippet: '&lt;수산&gt; 통발', score: 8 }];
  geminiReply = '{"ok":true,"meaning":"통발 안쪽으로 좁아지는 입구"}';

  // ── T4. §4-6 ③ 라운드 소진 → 정직한 포기(비용 0) ──────────────────────────────
  console.log('\n[T4][§4-6 ③] 라운드 소진 → 정직한 포기, API 는 아예 안 부른다');
  const before3 = geminiCalls + naverCalls;
  const give = await R.naverTermStep(Q, { rounds: R.NAVER_MAX_ROUNDS, state: 'none', term: '', meaning: '' }, true);
  ok('giveup 을 돌려준다', !!(give && give.giveup));
  ok('되묻기 카드를 안 낸다', !give.clarify);
  ok('외부 호출 0회(비용 0)', geminiCalls + naverCalls === before3);
  ok('막다른 길이 아니게 다음 행동을 안내한다', /다시 말씀해|설명해 주시면/.test(give.answer));
  ok('없는 근거를 지어내지 않는다', !/제\s*\d+\s*조|과태료|벌금/.test(give.answer));

  // ── T5. 변조·재생 방어 — 확인 안 된 뜻·조문이 섞인 뜻은 버린다 ──────────────────
  console.log('\n[T5] 변조·재생 방어(ctx 는 클라이언트가 되돌려 보내는 값이다)');
  ok('state 가 confirmed 가 아니면 뜻을 버린다',
    R.normalizeAskCtx({ nu: { rounds: 0, state: 'none', meaning: '아무 뜻' } }, { fields: {} }).nu.meaning === '');
  const tampered = R.normalizeAskCtx(
    { nu: { rounds: 0, state: 'confirmed', term: '깔때기', meaning: '제32조 위반이면 과태료 100만원' } }, { fields: {} });
  ok('조문·형량이 섞인 뜻은 버린다(§4-U 불변식)', tampered.nu.meaning === '');
  ok('뜻이 버려지면 확인 상태도 성립하지 않는다', tampered.nu.state === 'none');
  ok('라운드는 상한으로 clamp 된다',
    R.normalizeAskCtx({ nu: { rounds: 99, state: 'none' } }, { fields: {} }).nu.rounds === R.NAVER_MAX_ROUNDS);
  ok('naverMeaningAllowed — 정상 뜻은 통과', R.naverMeaningAllowed('통발 안쪽으로 좁아지는 입구') !== '');
  ok('naverMeaningAllowed — 문자열이 아니면 ""', R.naverMeaningAllowed({ a: 1 }) === '');

  // ── T6. 모르는 낱말 고르기 — AI 없이 위키·glossary 대조로만 ─────────────────────
  console.log('\n[T6] 모르는 낱말 고르기(순수 대조, AI 호출 0회)');
  ok('조사를 떼고 낱말을 집는다', R.unknownTermOf(Q) === '깔때기');
  ok('위키가 아는 말만 있으면 후보 없음', R.unknownTermOf('어선 검사 언제 받나요') === '');
  const beforeTerm = geminiCalls + naverCalls;
  R.unknownTermOf('알 수 없는 말 뽀짝이');
  ok('낱말 고르기에 외부 호출 0회', geminiCalls + naverCalls === beforeTerm);
  ok('모르는 낱말이 없으면 단계 자체를 안 탄다',
    await R.naverTermStep('어선 검사 언제 받나요', NU0, true) === null);

  // ── T7. routes 배선 계약(소스 대조) ───────────────────────────────────────────
  console.log('\n[T7] routes 배선 계약');
  ok('위키·원문 둘 다 빈손일 때만 개입한다(2차 조회와 똑같은 조건)',
    /if \(needsFallback && !\(raw && raw\.answer\)\) \{/.test(ROUTES_SRC));
  ok('확인된 뜻을 원문 직독 질의에도 얹는다',
    /searchRawFallback\(nuMeaning \? q \+ ' ' \+ nuMeaning : q\)/.test(ROUTES_SRC));
  ok('뜻은 한 번 쓰고 소진한다(같은 말을 계속 되묻지 않게)',
    /ctx\.nu = \{ rounds: legalRetriever\.NAVER_MAX_ROUNDS, state: 'none', term: '', meaning: '' \};/.test(ROUTES_SRC));
  ok('학습후보는 _candidates 큐에 적재한다', /logGlossaryCandidate\(q, nuTerm, nuMeaning\)/.test(ROUTES_SRC)
    && /function logGlossaryCandidate[\s\S]{0,400}appendJsonl\(CANDIDATES_FILE/.test(ROUTES_SRC));
  ok('_glossary.md 를 직접 고치지 않는다(사람 승인 게이트)', !/_glossary\.md['"]/.test(ROUTES_SRC));
  ok('스위치 off 면 확인된 뜻도 안 읽는다',
    /const nuMeaning = cfg\.naverTermLookup \? \(ctx\.nu\.meaning \|\| ''\) : '';/.test(ROUTES_SRC));
  ok('헤더가 이미 나간 뒤에도 카드를 낼 수 있다(§4-U 개입 시점)',
    /const writeConfirm = \(step\) => \{\s*\n\s*if \(!res\.headersSent\) \{/.test(ROUTES_SRC));

  // ── T8. 종단 시나리오 — 되묻기 → "네" → 재검색 → 그래도 실패하면 정직한 포기 ─────
  console.log('\n[T8] 종단 시나리오(카드 → "네" → 재검색 → 소진 → 정직한 포기)');
  const s1 = await R.naverTermStep(Q, NU0, true);
  ok('① 카드가 뜬다', !!(s1 && s1.clarify));
  const s2 = R.normalizeAskCtx(s1.clarify.options[0].ctx, { fields: {} });   // "네, 맞아요"
  ok('② 확인된 뜻이 다음 요청에 실려 온다', s2.nu.state === 'confirmed' && !!s2.nu.meaning);
  // routes 가 하는 일을 그대로 흉내낸다: 검색어에 뜻을 얹고, ctx.nu 를 소진 상태로 갱신한다.
  const nuMeaning = s2.nu.meaning;
  const qForSearch = [Q].concat([], [nuMeaning]).join(' ');
  s2.nu = { rounds: R.NAVER_MAX_ROUNDS, state: 'none', term: '', meaning: '' };
  ok('③ 검색어에 확인된 뜻이 붙는다', qForSearch === Q + ' ' + nuMeaning);
  ok('③ 원 질문 문자열 자체는 안 건드린다(R2)', Q === '깔때기가 뭐죠');
  const s4 = await R.naverTermStep(Q, s2.nu, true);
  ok('④ 그 뜻으로도 못 찾으면 같은 말을 또 묻지 않고 정직하게 포기', !!(s4 && s4.giveup));
  ok('④ 소진 뒤 ctxNext 가 라운드를 계속 나른다', !!R.ctxNextOf(s2).nu);

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
