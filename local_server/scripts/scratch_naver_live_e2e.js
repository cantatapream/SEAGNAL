'use strict';
// ============================================================================
// [임시·실험용] §4-U 실키 종단 검증 — 다양한 질문 유형으로 넓게 훑는다.
//   지금까지 §4-U 검증은 mock 이거나 표본이 좁았다(그래서 D6 를 실키에서야 발견했다).
//   이 스크립트는 **진짜 네이버 API + 진짜 Gemini**로 5개 유형을 한 번에 본다.
//   결과 확인 후 삭제할 것(앱 런타임 아님). 실행: GitHub Actions(러너는 외부망 제약 없음).
// ============================================================================
const path = require('path');
const SRV = path.join(__dirname, '..');
const GEMINI_PATH = require.resolve(path.join(SRV, 'services', 'gemini_client.js'));

// D1 검증용: 실제 Gemini 를 그대로 쓰되 오간 프롬프트만 엿본다(동작은 안 바꾼다).
const prompts = [];
const realGemini = require(GEMINI_PATH);
const origCall = realGemini.callGemini;
realGemini.callGemini = async (o) => { prompts.push({ caller: o.caller, text: String(o.contents) }); return origCall(o); };

const R = require(path.join(SRV, 'services', 'legal_retriever.js'));
const NU0 = { rounds: 0, state: 'none', term: '', meaning: '' };
let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('    ✅', n); } else { fail++; console.log('    ❌', n, extra === undefined ? '' : extra); } };

// expect: 'skip'   = §4-U 가 아예 안 떠야 한다(정상 법률 질문)
//         '<낱말>' = 그 낱말을 집어야 한다(뜻을 찾든 재질문이든 무관)
const CASES = [
  // ── ① 정상 법률 질문 — §4-U 가 뜨면 안 된다(오탐 검사) ────────────────────────
  ['①정상', '어선 검사 언제 받나요', 'skip'],
  ['①정상', '깔때기 그물코 규격이 어떻게 되나요', 'skip'],   // ★위키 본문이 이미 아는 말
  ['①정상', '조업하다가 사고나면 보상받나요', 'skip'],
  ['①정상', '신고하려고 하는데 서류가 뭔가요', 'skip'],
  ['①정상', '낚싯배 승선정원 초과하면 처벌 받나요', 'skip'],
  ['①정상', '구명조끼 안 입으면 어떻게 되나요', 'skip'],
  ['①정상', '어구 실명제 신고 방법 알려주세요', 'skip'],
  ['①정상', '폐기물 바다에 버리면 벌금 얼마인가요', 'skip'],
  ['①정상', '관할 관청이 어디인가요', 'skip'],
  ['①정상', '무허가로 조업하다 걸리면 배도 몰수되나요', 'skip'],
  ['①정상', '선박검사증서를 분실했는데 어떻게 재발급받나요', 'skip'],
  ['①정상', '어선원 재해보험 가입은 의무인가요', 'skip'],
  ['①정상', '야간에 낚시어선 영업할 수 있나요', 'skip'],

  // ── ② 진짜 모르는 구어 — 그 낱말을 정확히 집어야 한다 ──────────────────────────
  ['②구어', '아릿대가 뭐죠', '아릿대'],
  ['②구어', '배에서 쓰는 뽀짝이가 뭔가요', '뽀짝이'],
  ['②구어', '조업할 때 아리랑이 뭔가요', '아리랑'],          // ★D6 재현 케이스
  // "뽀짝이"의 끝 "이"는 주격조사인지 낱말의 일부인지 우리가 알 수 없다 — 조사로 보고 떼는 쪽이
  // 기본이라 여기선 "뽀짝"이 정상이다(위 "뽀짝이가"는 "가"만 떼어 "뽀짝이"가 된다).
  ['②구어', '신고한 뒤에 뽀짝이 달아도 되나요', '뽀짝'],      // ★D6 같은 갈래
  ['②구어', '통발에 붙이는 아릿대가 뭔지 알려주세요', '아릿대'],
  ['②구어', '조업할 때 아릿대 쓰나요', '아릿대'],

  // ── ③ 활용형이 많이 섞인 문장 — 엉뚱한 낱말을 집으면 안 된다(D4·D6 축) ────────
  ['③활용형', '조업하는 중에 뽀짝이 쓰나요', '뽀짝'],
  ['③활용형', '어업허가 받아야 하나요', 'skip'],
  ['③활용형', '입항신고 안 하면 어떻게 되나요', 'skip'],

  // ── ④ 해양수산과 무관한 말 — 뜻을 억지로 만들지 않아야 한다(ok:false 기대) ────
  ['④무관', '배에서 마우스 써도 되나요', null],   // null = 무엇을 집든 상관없되 결과만 관찰
];

(async () => {
  const gh = require(path.join(SRV, 'services', 'github_raw.js'));
  console.log('=== 환경 ===  NAVER:', !!process.env.NAVER_CLIENT_ID,
    '| GEMINI:', realGemini.hasAnyKey(), '| GITHUB_RAW:', gh.hasToken());

  console.log('\n═══ 유형별 실키 검증 ═══');
  let picked = 0, meaningFound = 0, retried = 0;
  for (const [cat, q, expect] of CASES) {
    const term = R.unknownTermOf(q);
    const t0 = Date.now();
    const r = await R.naverTermStep(q, NU0, true);
    const ms = Date.now() - t0;
    const kind = !r ? '미발동' : (r.giveup ? '포기' : (r.clarify.options.length === 1 ? '재질문' : '뜻확인'));
    console.log(`\n  [${cat}] ${q}`);
    console.log(`     낱말="${term}"  결과=${kind}  ${ms}ms`);
    if (r && r.clarify) console.log(`     카드: ${r.clarify.question}`);
    if (expect === 'skip') {
      ok('§4-U 가 안 뜬다(정상 질문)', r === null, `낱말="${term}" ${kind}`);
    } else if (expect) {
      picked += (term === expect) ? 1 : 0;
      ok(`모르는 낱말을 정확히 집는다(기대 "${expect}")`, term === expect, `실제 "${term}"`);
    }
    if (r && r.clarify) {
      // ★D7: 사용자가 실제로 친 낱말이 카드에 그대로 보여야 한다(오타변환이 딴 말로 바꾸면 안 됨).
      if (term) ok('카드에 사용자가 쓴 낱말이 그대로 보인다',
        r.clarify.question.includes(term) || r.clarify.options.length === 1, r.clarify.question);
    }
    if (r && r.clarify && r.clarify.options.length === 2) {
      meaningFound++;
      const meaning = (r.clarify.options[0].ctx.nu || {}).meaning || '';
      ok('뜻에 조문·형량·법령이 안 섞였다(§4-U 불변식)',
        !/제\s*\d+\s*조|과태료|벌금|징역|만원|법률|법령/.test(meaning), meaning);
    }
    if (r && r.clarify && r.clarify.options.length === 1) retried++;
  }
  console.log(`\n  ── 요약: 뜻확인 카드 ${meaningFound}건 · 재질문 ${retried}건 ──`);

  // ── D1 실호출 재확인 ─────────────────────────────────────────────────────────
  console.log('\n═══ D1 뜻 누출(실제 searchRawFallback) ═══');
  if (!gh.hasToken()) { console.log('  GITHUB_RAW_TOKEN 없음 — 관찰 불가'); }
  else {
    prompts.length = 0;
    const HINT = '통발 안쪽으로 좁아지는 입구';
    const res = await R.searchRawFallback('아릿대가 뭐죠', HINT);
    for (const p of prompts) console.log(`   ${p.caller.padEnd(22)} 뜻 포함? ${p.text.includes(HINT)}`);
    const synth = prompts.find(p => p.caller === 'Legal-RawFallback');
    if (synth) {
      ok('★답변 합성 프롬프트에 뜻이 안 실린다', !synth.text.includes(HINT));
      ok('★답변 합성은 원 질문으로 묻는다', synth.text.includes('질문: "아릿대가 뭐죠"'));
    } else console.log('   합성 단계 미도달(후보 법 0건)');
    console.log('   2차 조회 laws:', JSON.stringify(res.laws), '| answer 있음:', !!res.answer);
  }

  console.log(`\n═══ ${pass} PASS / ${fail} FAIL ═══`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실행 오류:', e); process.exit(1); });
