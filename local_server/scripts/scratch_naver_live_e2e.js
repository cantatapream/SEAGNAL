'use strict';
// ============================================================================
// [임시·실험용] §4-U 실키 종단 검증 — NAVER_GUEO_PENDING_MERGE.md §5-C "남은 것" ①②④
//   지금까지 §4-U 검증은 전부 mock 이었다. 이 스크립트는 **진짜 네이버 API + 진짜 Gemini**로
//   D1~D4 수정본이 실제로 어떻게 동작하는지 본다. 결과 확인 후 삭제할 것(앱 런타임 아님).
//   실행: GitHub Actions(러너는 외부망 제약 없음) — 이 세션은 ntruss.com 직접 접속 불가.
// ============================================================================
const path = require('path');
const SRV = path.join(__dirname, '..');
const GEMINI_PATH = require.resolve(path.join(SRV, 'services', 'gemini_client.js'));

// D1 검증용: 실제 Gemini 를 그대로 쓰되, 오간 프롬프트만 엿본다(동작은 안 바꾼다).
const prompts = [];
const realGemini = require(GEMINI_PATH);
const origCall = realGemini.callGemini;
realGemini.callGemini = async (o) => {
  prompts.push({ caller: o.caller, text: String(o.contents) });
  return origCall(o);
};

const R = require(path.join(SRV, 'services', 'legal_retriever.js'));
const NU0 = { rounds: 0, state: 'none', term: '', meaning: '' };
let pass = 0, fail = 0, warn = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.log('  ❌', n, extra === undefined ? '' : extra); } };
const note = (n) => { warn++; console.log('  ⚠️ ', n); };

(async () => {
  console.log('=== 환경 ===');
  console.log('  NAVER 키:', !!process.env.NAVER_CLIENT_ID && !!process.env.NAVER_CLIENT_SECRET);
  console.log('  GEMINI 키:', require(GEMINI_PATH).hasAnyKey());
  console.log('  GITHUB_RAW 토큰:', require(path.join(SRV, 'services', 'github_raw.js')).hasToken());

  // ── A. 도메인 판별 품질(§5-C 남은것 ②) — 이게 이번 테스트의 핵심 ──────────────────
  //    "깔때기"는 조리도구 뜻과 어구 뜻이 둘 다 있는 말이다. 우리 정체성 문맥을 준 Gemini 가
  //    어구 쪽을 고르는지, 그리고 해양수산과 무관한 말은 "억지로 고르지 않는지"를 본다.
  console.log('\n=== A. 실제 뜻 판별 품질 ===');
  for (const q of ['깔때기가 뭐죠', '배에서 쓰는 뽀짝이가 뭔가요', '조업할 때 아리랑이 뭔가요',
    '신고한 뒤에 뽀짝이 달아도 되나요']) {
    const t0 = Date.now();
    const r = await R.naverTermStep(q, NU0, true);
    const ms = Date.now() - t0;
    if (!r) { console.log(`  [${q}] → null(모르는 낱말 없음)  ${ms}ms`); continue; }
    if (r.giveup) { console.log(`  [${q}] → 포기  ${ms}ms`); continue; }
    console.log(`  [${q}] → ${ms}ms`);
    console.log('      카드질문:', r.clarify.question);
    console.log('      선택지  :', r.clarify.options.map(o => o.label).join(' / '));
    const meaning = (r.clarify.options[0].ctx.nu || {}).meaning || '';
    if (meaning) {
      ok(`  ↳ 뜻에 조문·형량이 안 섞였다(§4-U 불변식)`, !/제\s*\d+\s*조|과태료|벌금|징역|만원|법률|법령/.test(meaning), meaning);
    }
  }

  // ── B. D4 오탐 — 실제 위키 index 기준 ─────────────────────────────────────────
  console.log('\n=== B. D4 낯선낱말 오탐(실제 위키 index 대조) ===');
  const CLEAN = ['어선 검사 언제 받나요', '안전요원 꼭 태워야 하나요', '낚싯배 승선정원 초과하면 처벌 받나요',
    '과태료 얼마나 나오나요', '우리 배 어디까지 갈 수 있나요', '구명조끼 안 입으면 어떻게 되나요',
    '어구 실명제 신고 방법 알려주세요', '폐기물 바다에 버리면 벌금 얼마인가요'];
  let fp = 0;
  for (const q of CLEAN) { const t = R.unknownTermOf(q); if (t) { fp++; console.log('   오탐:', JSON.stringify(t), '|', q); } }
  ok(`오탐 ${fp}/${CLEAN.length}건`, fp === 0);
  ok('진짜 구어는 계속 잡는다(깔때기)', R.unknownTermOf('깔때기가 뭐죠') === '깔때기');

  // ── C. D2 재질문 흐름 — 실제로 2턴째에 다시 검색하는가 ────────────────────────
  console.log('\n=== C. D2 재질문 → 실제 재검색 ===');
  const t1 = await R.naverTermStep('조업할 때 쓰는 뽀짝이가 뭔가요', NU0, true);
  if (t1 && t1.clarify && t1.clarify.options.length === 1) {
    console.log('  1턴: 재질문 카드 →', t1.clarify.question);
    const t2 = await R.naverTermStep('통발 안쪽으로 좁아지는 입구 부분을 뽀짝이라고 불러요',
      { rounds: R.NAVER_MAX_ROUNDS, state: 'none', term: '', meaning: '' }, true);
    console.log('  2턴 결과:', t2 ? (t2.giveup ? '포기(검색은 실제로 수행됨)' : '카드: ' + t2.clarify.question) : 'null');
    ok('2턴이 곧바로 포기로 끝나지 않고 처리된다', t2 !== null);
  } else if (t1 && t1.clarify) {
    console.log('  1턴에 뜻을 찾음 →', t1.clarify.question);
    note('재질문 갈래를 못 태웠다(그 말의 뜻이 실제로 검색됨) — D2 는 mock 테스트로 이미 고정됨');
  } else { note('1턴이 null/포기 — 이 질의로는 D2 갈래 관찰 불가'); }

  // ── D. D1 — 확인된 뜻이 답변 합성 프롬프트에 실리는가(실제 호출로) ─────────────
  console.log('\n=== D. D1 뜻 누출(실제 searchRawFallback 호출) ===');
  if (!require(path.join(SRV, 'services', 'github_raw.js')).hasToken()) {
    note('GITHUB_RAW_TOKEN 없음 — 2차 조회 자체가 스킵되어 이 항목은 관찰 불가(mock 테스트로는 고정됨)');
  } else {
    prompts.length = 0;
    const HINT = '통발 안쪽으로 좁아지는 입구';
    const res = await R.searchRawFallback('깔때기가 뭐죠', HINT);
    for (const p of prompts) console.log(`   ${p.caller.padEnd(22)} 뜻 포함? ${p.text.includes(HINT)}`);
    const synth = prompts.find(p => p.caller === 'Legal-RawFallback');
    if (synth) {
      ok('★답변 합성 프롬프트에 뜻이 안 실린다', !synth.text.includes(HINT));
      const m = synth.text.match(/질문: "[^"]*"/);
      ok('★답변 합성은 원 질문으로 묻는다', !!m && m[0] === '질문: "깔때기가 뭐죠"', m && m[0]);
    } else { note('합성 단계까지 못 감(후보 법 0건) — 누출 관찰 불가'); }
    console.log('   2차 조회 결과 laws:', JSON.stringify(res.laws), 'answer 있음:', !!res.answer);
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL / ${warn} 관찰불가 ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실행 오류:', e); process.exit(1); });
