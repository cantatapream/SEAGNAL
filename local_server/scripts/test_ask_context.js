'use strict';
// ============================================================================
// [2026-08-14 §H-37] 이해확인 · 상황질문(범위좁히기) · 온디바이스 프로필 확인 회귀 테스트
//   실행: node local_server/scripts/test_ask_context.js
//   설계 원문: knowledge/legal/_dashboard/H37_understanding_confirm_design.md
//              (§4 이해확인 · §5 상황질문 · §7 프로필 · §8 note 제거 · §9 대기상태 22행 전수표)
//
//   ★이 파일의 T1~T18은 설계 §9.1 "대기 상태 전수표"의 22행과 **1:1로 대응**한다
//     (CLAUDE.md 결정로그: "대기·보류·유예를 도입하는 설계는 대기 중 상태 변화를 표로 전수 열거하고
//      각 행을 회귀 테스트로 1:1 고정할 것"). 각 테스트 제목의 [#n]이 그 표의 행 번호다.
//   ★서버에는 대기 상태가 **존재하지 않는다** — "대기 중"이란 화면에 버튼 카드가 떠 있다는 뜻일
//     뿐이라, 표의 절반은 **클라이언트 코드의 계약**이다. 그런 행은 `client/js/ai-chat/ai_chat.js`
//     원문에서 그 계약이 실제 코드로 있는지 대조한다(주석이 아니라 동작 코드 문자열).
//   ★T21~T24 는 2026-08-14 적대검증(프로덕션 실키)에서 나온 결함 4건(F1~F4)의 재현이다 —
//     설계 §16. 수정 전 코드로 돌리면 실패하도록 짰다(그래야 진짜 게이트다).
//   ★시각 비의존 — 프로필 `at`은 전부 고정 문자열이다(CLAUDE.md 결정로그).
//   ★Gemini 키 없이 전부 돌아야 한다 — 키가 필요한 판정은 "키 없으면 null"(fail-open) 계약만 본다.
//
//   [연계] services/legal_retriever.js(H-37 §4·5·7 신규 절) · routes/legal.js(POST /api/legal/ask
//          단계 배선·note·스위치) · client/js/ai-chat/ai_chat.js(ctx 왕복·프로필 패널) ·
//          knowledge/legal/_dashboard/vessel_doc_tree.json·zone_tree.json(선택지 라벨의 출처) ·
//          scripts/refactor/verify_all.sh V5 SUITES(여기에 등록돼 있어야 실제로 돌아간다)
// ============================================================================
const fs = require('fs');
const path = require('path');

const SRV = path.join(__dirname, '..');
const RET_PATH = path.join(SRV, 'services', 'legal_retriever.js');
const R = require(RET_PATH);
const ROUTES_SRC = fs.readFileSync(path.join(SRV, 'routes', 'legal.js'), 'utf8');
const RET_SRC = fs.readFileSync(RET_PATH, 'utf8');
const CLIENT_SRC = fs.readFileSync(path.join(SRV, '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');
const VESSEL = JSON.parse(fs.readFileSync(path.join(SRV, 'knowledge', 'legal', '_dashboard', 'vessel_doc_tree.json'), 'utf8'));
const H37_SRC = RET_SRC.slice(RET_SRC.indexOf('H-37 §4·5·7'));   // 신규 절만 본 검사용
// 주석을 걷어낸 소스 — "이 문구가 **화면으로 나가는 값**에서 사라졌는가"를 볼 때 쓴다.
// (설명 주석에 옛 문구를 인용해 두는 것은 정상이고, 그게 검사에 걸리면 안 된다.)
const stripComments = s => s.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const ROUTES_CODE = stripComments(ROUTES_SRC);
const H37_CODE = stripComments(H37_SRC);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); }
};

// 고정 입력(시각 비의존)
const PROFILE = R.normalizeProfile({
  fields: {
    선박용도: { v: '낚시어선', at: '2026-07-30T09:04:00+09:00' },
    '주 조업구역': { v: '특정해역', at: '2026-07-25T10:00:00+09:00' },
    톤수: { v: '9.77톤', at: '2026-07-30T09:04:00+09:00' },
  },
});
const CLARIFY_USE = { needed: true, question: '어떤 배인가요?', options: [{ label: '낚시어선' }, { label: '일반어선' }] };
const CLARIFY_OTHER = { needed: true, question: '어디인가요?', options: [{ label: '바다' }, { label: '하천·호소' }] };
const EMPTY_CTX = R.normalizeAskCtx(null, { fields: {} });

// ── T0. R0(회귀 0) — 스위치 off + ctx/profile 미전송이면 신규 단계가 전부 no-op ──────
console.log('\n[T0] R0 — 스위치 off·맥락 미전송이면 오늘과 동일');
{
  const q = '구명조끼 몇 개 필요해요?';
  ok('ctx 없으면 기본값(rounds 0·scope 0·decided 0)', EMPTY_CTX.uc.rounds === 0 && EMPTY_CTX.uc.state === 'none'
    && EMPTY_CTX.scope.length === 0 && EMPTY_CTX.prof.decided.length === 0);
  ok('profile 없으면 fields 빈 객체', Object.keys(R.normalizeProfile(undefined).fields).length === 0);
  ok('트리 질의 합성 — 붙일 게 없으면 질의가 바이트 동일', R.zoneQueryWithProfile(q, EMPTY_CTX) === q);
  ok('상황질문 off → null', R.scopeNarrowStep(q, [], [{ law: '어선법', score: 9 }, { law: '선박법', score: 9 }], false) === null);
  ok('프로필확인 off → 되묻기 그대로', R.profileConfirmStep(CLARIFY_USE, PROFILE, { decided: [] }, false).mode === 'as-is');
  ok('assumed 아니면 답변이 바이트 동일', R.withAssumedNotice('답변 본문', false) === '답변 본문');
  // [§4-U 2026-08-16] qForSearch 표현식에 갈래가 하나 늘었다(확인된 구어의 뜻 nuMeaning).
  //   검사의 **뜻은 그대로**다 — 붙일 게 없으면 삼항의 else 로 빠져 원 질의 그대로여야 한다.
  ok('검색어 보강도 붙일 게 없으면 원 질의 그대로(routes 계약)',
    /const qForSearch = \(narrowLabels\.length \|\| nuMeaning\)\s*\n\s*\? \[q\]\.concat\(narrowLabels, nuMeaning \? \[nuMeaning\] : \[\]\)\.join\(' '\) : q;/.test(ROUTES_SRC));
}

// ── T1 [#1]. 대기 중 새 질문을 타이핑해 전송 → ctx 전부 초기화 ────────────────────
console.log('\n[T1][#1] 새 질문 타이핑 → ctx 초기화(맥락은 버튼으로만 이어진다)');
{
  ok('doSend 가 ctx 를 (버튼ctx → 예약ctx → 없음) 순으로만 싣는다',
    /var ctx = sendCtx \|\| pendingCtx \|\| null;/.test(CLIENT_SRC));
  ok('한 번 쓴 예약 ctx 는 즉시 비운다', /var ctx = sendCtx \|\| pendingCtx \|\| null;\s*\n\s*pendingCtx = null;/.test(CLIENT_SRC));
  ok('ctx 가 없으면 요청 바디에 ctx 필드를 아예 안 넣는다', /if \(ctx\) ask\.ctx = ctx;/.test(CLIENT_SRC));
}

// ── T2 [#2]. 채팅창을 닫아도 서버엔 상태가 없다 ──────────────────────────────────
console.log('\n[T2][#2] 서버 무상태 — 같은 입력은 몇 번을 불러도 같은 출력');
{
  const a = JSON.stringify(R.profileConfirmStep(CLARIFY_USE, PROFILE, { decided: [] }, true));
  const b = JSON.stringify(R.profileConfirmStep(CLARIFY_USE, PROFILE, { decided: [] }, true));
  ok('프로필 확인 카드가 결정론적', a === b);
  ok('서버가 대기 상태를 모듈 전역에 쌓아두지 않는다', !/_ctxStore|_profileStore|pendingCtx/.test(RET_SRC));
}

// ── T3 [#3]. 새로고침 — 대기는 소멸, 프로필은 남는다 ─────────────────────────────
console.log('\n[T3][#3] 새로고침 — ctx 는 메모리에만(소멸), 프로필은 localStorage(유지)');
{
  ok('pendingCtx 는 메모리 변수(저장 안 함)', /var pendingCtx = null;/.test(CLIENT_SRC) && !/setItem\([^)]*pendingCtx/.test(CLIENT_SRC));
  ok('프로필만 localStorage 에 저장된다', /localStorage\.setItem\(LS_PROFILE/.test(CLIENT_SRC));
  ok('프로필 키가 대화기록과 별개', /var LS_PROFILE = 'nariya_profile_v1';/.test(CLIENT_SRC));
}

// ── T4 [#4·#5]. 연타·다른 선택지 연속 클릭 → 1회만 전송 ─────────────────────────
console.log('\n[T4][#4·#5] 카드 단위 nrya-done 가드');
{
  ok('이미 처리된 카드는 즉시 반환', /if \(!box \|\| box\.classList\.contains\('nrya-done'\)\) return;/.test(CLIENT_SRC));
  ok('클릭 즉시 카드 전체를 비활성화', /box\.classList\.add\('nrya-done'\);/.test(CLIENT_SRC));
}

// ── T5 [#6]. 스크롤 위의 옛 대기 카드를 나중에 눌러도 그 시점 맥락으로 간다 ─────────
console.log('\n[T5][#6] 옛 카드 — 카드에 박힌 data-q·data-ctx 로 전송');
{
  ok('선택지 버튼에 그 시점 ctx 가 박힌다', /data-ctx="' \+ esc\(JSON\.stringify\(o\.ctx\)\)/.test(CLIENT_SRC));
  ok('원 질문은 카드의 data-q 에서 읽는다', /var q = box\.getAttribute\('data-q'\) \|\| '';/.test(CLIENT_SRC));
  ok('ctx 를 든 선택지는 질의에 라벨을 붙이지 않는다',
    /input\.value = q;\s*\n\s*doSend\(mergeCtx\(lastCtx, ctx\), box(?:, true)?\);/.test(CLIENT_SRC));
}

// ── T6 [#7]. 기록에서 복원한 답변에는 되묻기 버튼이 안 생긴다 ─────────────────────
console.log('\n[T6][#7] 기록 복원 답변 — clarify 가 없어 버튼이 안 붙는다');
{
  const OPEN_HIST_ENTRY = CLIENT_SRC.slice(CLIENT_SRC.indexOf('function openHistoryEntry'));
  const RESTORE_CALL = OPEN_HIST_ENTRY.slice(0, OPEN_HIST_ENTRY.indexOf('renderRestoredAnswer(') + 400);
  ok('복원 렌더에 clarify 를 넘기지 않는다', !/clarify/.test(RESTORE_CALL.split('renderRestoredAnswer(')[1]));
  ok('기록 복원은 근거법령·서식도 함께 되살린다(2026-08-18 사용자 확정)',
    /citationChain: hit\.chain \|\| \[\], forms: hit\.forms \|\| \[\]/.test(CLIENT_SRC));
  const PUSH_HIST = CLIENT_SRC.slice(CLIENT_SRC.indexOf('function pushHistory'), CLIENT_SRC.indexOf('function pushHistory') + 700);
  ok('기록은 질문·답변·note·근거법령·서식까지 저장한다(2026-08-18 확장)',
    /sources: \(data && data\.sources\) \|\| \[\], chain: \(data && data\.citationChain\) \|\| \[\], forms: \(data && data\.forms\) \|\| \[\]/.test(PUSH_HIST));
  ok('그래도 ctx·프로필은 기록에 저장하지 않는다(온디바이스 일회성 유지)',
    !/ctx:|profile:/.test(PUSH_HIST));
}

// ── T7 [#8]. R1 — ctx·profile 은 로그·임시보관 어디에도 안 쓴다 ─────────────────
console.log('\n[T7][#8] R1 — 프로필이 서버 파일에 남지 않는다');
{
  ok('pendingAnswers.store 인자에 ctx·profile 없음',
    /pendingAnswers\.store\(q, answer, sourcesOut, note, citationChain, forms, citeLaws\)/.test(ROUTES_SRC));
  ok('새 지식 후보 로그도 질의·원문만 넘긴다', /logKnowledgeCandidate\(q, raw\)/.test(ROUTES_SRC));
  ok('신규 절이 파일을 쓰지 않는다(읽기 전용)', !/writeFile|appendFile/.test(H37_CODE));
  ok('신규 절이 콘솔로도 안 흘린다', !/console\.(log|error|warn)/.test(H37_CODE));
}

// ── T8 [#9]. 전송 실패 시 되묻기 버튼을 다시 누를 수 있다 ────────────────────────
console.log('\n[T8][#9] 네트워크 실패 → nrya-done 되돌리기(재시도 가능)');
{
  ok('실패 응답이면 카드 비활성을 해제한다',
    /if \(failBox && data && data\._neterr\) failBox\.classList\.remove\('nrya-done'\);/.test(CLIENT_SRC));
  ok('버튼 클릭 경로가 실패 대상 카드를 넘긴다', /doSend\(lastCtx, box(?:, true)?\);/.test(CLIENT_SRC) && /doSend\(mergeCtx\(lastCtx, ctx\), box(?:, true)?\);/.test(CLIENT_SRC));
  ok('실패했을 땐 이어받을 맥락을 지우지 않는다(재시도 가능)',
    /if \(!\(data && data\._neterr\)\) lastCtx = \(data && data\.ctxNext\) \|\| null;/.test(CLIENT_SRC));
}

// ── T9 [#10]. 대기 중 스위치 off 전환 → 그 단계가 없는 것처럼 처리 ────────────────
console.log('\n[T9][#10] 대기 중 스위치 off — ctx 가 있어도 기존 흐름으로');
{
  const ctx = R.normalizeAskCtx({ uc: { rounds: 1, state: 'none' }, scope: [{ axis: 'ship', label: '어선' }],
    prof: { decided: [{ axis: '선박용도', label: '낚시어선', use: 'accepted' }] } }, PROFILE);
  ok('상황질문 off → null', R.scopeNarrowStep('구명조끼 몇 개 필요해요?', ctx.scope,
    [{ law: '어선법', score: 9 }, { law: '선박법', score: 9 }], false) === null);
  ok('프로필확인 off → 되묻기 그대로', R.profileConfirmStep(CLARIFY_USE, PROFILE, ctx.prof, false).mode === 'as-is');
  ok('스위치 3개가 전부 "true 일 때만 켜짐"(기본 false)',
    /understandConfirm: c\.understandConfirm === true/.test(ROUTES_SRC)
    && /scopeNarrow: c\.scopeNarrow === true/.test(ROUTES_SRC)
    && /profileConfirm: c\.profileConfirm === true/.test(ROUTES_SRC));
}

// ── T10 [#11·#12]. 대기 중 프로필 수정·초기화 → 그 축의 결정만 무효화 ────────────
console.log('\n[T10][#11·#12] 프로필 수정·초기화 → 축별 무효화(다른 축 결정은 살린다)');
{
  const decided = { decided: [
    { axis: '선박용도', label: '낚시어선', use: 'accepted' },
    { axis: '주 조업구역', label: '특정해역', use: 'accepted' },
  ] };
  const edited = R.normalizeProfile({ fields: {
    선박용도: { v: '일반어선', at: '2026-08-01T09:00:00+09:00' },        // 값이 바뀌었다
    '주 조업구역': { v: '특정해역', at: '2026-07-25T10:00:00+09:00' },
  } });
  const ctx = R.normalizeAskCtx({ prof: decided }, edited);
  ok('값이 바뀐 축의 결정만 버린다', ctx.prof.decided.length === 1 && ctx.prof.decided[0].axis === '주 조업구역');
  ok('전체 초기화 → 결정 전부 무효', R.normalizeAskCtx({ prof: decided }, R.normalizeProfile({ fields: {} })).prof.decided.length === 0);
}

// ── T11 [#13]. 탭 2개 동시 사용 — 서로 간섭 없음 ────────────────────────────────
console.log('\n[T11][#13] 탭 2개 — 서로 다른 ctx 가 서로를 오염시키지 않는다');
{
  const tabA = R.normalizeAskCtx({ prof: { decided: [{ axis: '선박용도', label: '낚시어선', use: 'accepted' }] } }, PROFILE);
  const tabB = R.normalizeAskCtx({ uc: { rounds: 2, state: 'none' } }, PROFILE);
  ok('A 탭 결정이 B 탭 ctx 에 안 보인다', tabB.prof.decided.length === 0 && tabA.prof.decided.length === 1);
  ok('B 탭 라운드가 A 탭에 안 보인다', tabA.uc.rounds === 0 && tabB.uc.rounds === 2);
}

// ── T12 [#14]. 버튼 대신 "네"를 타이핑하면 그건 언제나 새 질문 ───────────────────
console.log('\n[T12][#14] 자유 입력은 언제나 새 질문 — 안내 문구만 바꾼다');
{
  ok('대기 중 입력창 안내문을 바꾼다', /setChatPlaceholder\(true\);/.test(CLIENT_SRC));
  ok('전송하면 안내문을 되돌린다', /setChatPlaceholder\(false\);/.test(CLIENT_SRC));
  ok('동작은 안 바꾼다(문구만 교체)',
    /el\.placeholder = waiting \? '어떤 상황인지 조금 더 구체적으로 적어주세요' : '메시지 입력';/.test(CLIENT_SRC));
}

// ── T13 [#15]. 서버 재배포·재시작이 무해하다 ───────────────────────────────────
console.log('\n[T13][#15] 서버 재시작 — 모듈을 다시 읽어도 같은 결과');
{
  const before = JSON.stringify(R.profileConfirmStep(CLARIFY_USE, PROFILE, { decided: [] }, true));
  delete require.cache[require.resolve(RET_PATH)];
  const R2 = require(RET_PATH);
  const after = JSON.stringify(R2.profileConfirmStep(CLARIFY_USE,
    R2.normalizeProfile({ fields: { 선박용도: { v: '낚시어선', at: '2026-07-30T09:04:00+09:00' } } }), { decided: [] }, true));
  ok('재시작 전후 확인 카드가 같다', before === after, before + ' vs ' + after);
}

// ── T14 [#16]. 중복 전송 — 라운드가 저절로 오르지 않는다 + 라운드 계산 불변 ────────
console.log('\n[T14][#16] 중복 전송 — 서버는 rounds 를 올리지 않는다(성공기준5 포함)');
{
  const c1 = R.normalizeAskCtx({ uc: { rounds: 1, state: 'none' } }, PROFILE);
  const c2 = R.normalizeAskCtx({ uc: { rounds: 1, state: 'none' } }, PROFILE);
  ok('같은 ctx → 같은 rounds', c1.uc.rounds === 1 && c2.uc.rounds === 1);
  ok('라운드는 클라이언트가 올린다(서버 코드에 증가 연산 없음)', !/uc\.rounds\s*(\+\+|\+=)/.test(H37_CODE));
  const q = '우리 배 정박신고 해야 하나요?';
  const ctx = R.normalizeAskCtx({ scope: [{ axis: 'ship', label: '어선' }],
    prof: { decided: [{ axis: '선박용도', label: '낚시어선', use: 'accepted' }] } }, PROFILE);
  ok('ctx 가 차 있어도 질의의 되묻기 라운드 수가 0 그대로',
    q.split(' — ').length - 1 === 0 && R.zoneQueryWithProfile(q, ctx) === q);
}

// ── T15 [#17]. 변조된 ctx — clamp·열거값·자산 대조 ────────────────────────────
console.log('\n[T15][#17] 변조 ctx — rounds clamp · state 열거 · scope 자산 대조 · prof 축당 1개');
{
  const bad = R.normalizeAskCtx({
    uc: { rounds: 99, state: '해킹' },
    scope: [{ axis: 'ship', label: '있지도 않은 배' }],
    prof: { decided: [
      { axis: '선박용도', label: '낚시어선', use: 'accepted' },
      { axis: '선박용도', label: '낚시어선', use: 'rejected' },   // 같은 축 2개
      { axis: '없는축', label: 'x', use: 'accepted' },
      { axis: '톤수', label: '거짓값', use: 'accepted' },          // 프로필 값과 불일치
    ] },
  }, PROFILE);
  ok('rounds 는 0..3 으로 clamp', bad.uc.rounds === 3);
  ok('state 는 열거값만', bad.uc.state === 'none');
  ok('자산에 없는 scope 라벨은 통째로 버린다', bad.scope.length === 0);
  ok('축당 1개만 남는다', bad.prof.decided.filter(d => d.axis === '선박용도').length === 1);
  ok('모르는 축·값 불일치 항목은 버린다', bad.prof.decided.length === 1);
  ok('scope 깊이는 자산 트리 깊이를 못 넘는다',
    R.normalizeAskCtx({ scope: new Array(20).fill({ axis: 'ship', label: '어선' }) }, PROFILE).scope.length <= R.vesselTreeDepth());
  ok('scope 경로가 자산과 어긋나면(순서 위조) 버린다',
    R.normalizeAskCtx({ scope: [{ axis: 'ship', label: '낚시어선' }] }, PROFILE).scope.length === 0);
}

// ── T16 [#18·#22]. 한 요청은 확인 카드를 최대 하나만 낸다 ──────────────────────
console.log('\n[T16][#18·#22] 확인 겹침 불가 — 한 요청에 confirm 은 최대 1개');
{
  const calls = (ROUTES_CODE.match(/writeConfirm\(/g) || []).length;
  const returns = (ROUTES_CODE.match(/return writeConfirm\(/g) || []).length;
  ok(`확인 카드를 내는 ${calls}개 지점이 전부 return 과 함께다`, calls > 0 && calls === returns, `calls=${calls} returns=${returns}`);
  ok('확인 응답은 done 한 줄로 즉시 끝난다(res.end)', /const writeConfirm = \(step\) => \{[\s\S]{0,900}?res\.end\(\);/.test(ROUTES_SRC));
  ok('트리 확인이 위키 확인보다 먼저다(설계 §3.4 순서)',
    ROUTES_SRC.indexOf('zoneTreeStep(legalRetriever.zoneQueryWithProfile') < ROUTES_SRC.indexOf('decideClarify(q, contextPages'));
  ok('이해확인이 트리 게이트보다 먼저다(사용자 확정 (가))',
    ROUTES_SRC.indexOf('understandConfirmStep(q, ctx.uc') < ROUTES_SRC.indexOf('zoneTreeStep(legalRetriever.zoneQueryWithProfile'));
  ok('상황질문은 트리가 null 일 때만 — search 뒤에 있다(설계 §5.3 R2)',
    ROUTES_SRC.indexOf('legalRetriever.search(qForSearch') < ROUTES_SRC.indexOf('scopeNarrowStep(q, ctx.scope'));
}

// ── T18 [#21]. accepted 한 축을 또 물으면 그 되묻기를 폐기한다 ────────────────────
console.log('\n[T18][#21] 축 단위 확인 — 같은 축 재질문은 폐기, 다른 축은 계속 묻는다');
{
  const none = { decided: [] };
  const accepted = { decided: [{ axis: '선박용도', label: '낚시어선', use: 'accepted' }] };
  const rejected = { decided: [{ axis: '선박용도', label: '낚시어선', use: 'rejected' }] };
  ok('미확정 축 → 확인 카드로 치환', R.profileConfirmStep(CLARIFY_USE, PROFILE, none, true).mode === 'confirm');
  ok('확정("네")한 축을 또 물으면 폐기', R.profileConfirmStep(CLARIFY_USE, PROFILE, accepted, true).mode === 'drop');
  ok('"아니요"한 축은 이번엔 평소대로 되묻는다', R.profileConfirmStep(CLARIFY_USE, PROFILE, rejected, true).mode === 'as-is');
  // ★사용자 확정 (자): 한 번의 "네"가 **다른 축**까지 확정시키면 안 된다(초판 설계의 결함).
  ok('다른 축(프로필이 모르는 축)은 여전히 되묻는다(§7.4.3)',
    R.profileConfirmStep(CLARIFY_OTHER, PROFILE, accepted, true).mode === 'as-is');
  const card = R.profileConfirmStep(CLARIFY_USE, PROFILE, none, true).step;
  ok('확인 카드에 저장 날짜(신선도)가 붙는다', card.clarify.question.includes('(2026-07-30 저장)'));
  ok('되묻기 질문에 마크다운 별표를 쓰지 않는다(화면은 esc 로만 그린다)', !card.clarify.question.includes('**'));
  ok('확인 카드는 UI 상태 note 를 쓴다(등급 아님)', card.note === '저장된 정보를 확인하고 있어요');
  ok('"네"는 그 축만 accepted 로 누적', JSON.stringify(card.clarify.options[0].ctx.prof.decided) ===
    JSON.stringify([{ axis: '선박용도', label: '낚시어선', use: 'accepted' }]));
  ok('"아니요"는 그 축만 rejected(프로필 자체는 안 고친다)',
    card.clarify.options[1].ctx.prof.decided[0].use === 'rejected' && !/localStorage|저장된 정보를 지/.test(JSON.stringify(card)));
  ok('선택지가 2개(기존 렌더러 그대로, CLARIFY_OPTION_MAX 이내)', card.clarify.options.length === 2);
}

// ── T19. 상황질문(§5) — 자산 라벨 그대로, 법 이름은 한 글자도 안 보인다 ──────────
console.log('\n[T19] 상황질문 — 선택지는 자산에서 그대로, 화면에 법 이름 0건');
{
  const sources = [{ law: '어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률', score: 12 },
    { law: '선박구명설비기준', score: 11 }, { law: '유선 및 도선 사업법', score: 11 },
    { law: '선박안전법', score: 10 }];
  const step = R.scopeNarrowStep('구명조끼 몇 개 필요해요?', [], sources, true);
  ok('설계 §5.6 시나리오가 그대로 발화한다', !!(step && step.clarify));
  const labels = (step ? step.clarify.options : []).map(o => o.label);
  ok('질문 문구가 자산 원본 그대로', step && step.clarify.question === VESSEL.tree.질문);
  ok('선택지 라벨이 자산 원본 그대로', JSON.stringify(labels) === JSON.stringify(VESSEL.tree.선택지.map(o => o.label)));
  const shown = JSON.stringify(step);
  ok('화면 문구에 법 이름이 안 나온다(사용자 확정 (마))',
    !/법률|어선법|수상레저안전법|선박법/.test(step.clarify.question) && !labels.some(l => /법$/.test(l)));
  ok('선택지 hint 에만 근거 조문이 남는다(자산 hint 그대로)', /어선법 제2조제1호/.test(shown));
  ok('선택지 ctx 가 다음 단계 경로를 누적한다',
    step.clarify.options[0].ctx.scope.length === 1 && step.clarify.options[0].ctx.scope[0].axis === VESSEL.tree.id);
  ok('질문이 이미 그 갈래를 말했으면 안 묻는다',
    R.scopeNarrowStep('어선인데 구명조끼 몇 개 필요해요?', [], sources, true) === null);
  ok('검색 후보가 한 갈래로 확정돼 있으면 안 묻는다',
    R.scopeNarrowStep('구명조끼 몇 개 필요해요?', [], [{ law: '수상레저안전법', score: 9 },
      { law: '수상레저기구의 등록 및 검사에 관한 법률', score: 9 }], true) === null);
  ok('경계형 트리 질문에는 안 끼어든다(트리 경로 보호)',
    R.scopeNarrowStep('우리 배 어디까지 나갈 수 있나요?', [], sources, true) === null);
}

// ── T20 [§8]. 신뢰등급 꼬리표가 코드에서 사라졌다 ────────────────────────────────
console.log('\n[T20][§8] 등급 꼬리표 제거 — 남은 note 는 UI 상태·오류 상태뿐');
{
  ok("'위키 근거 기반 AI 답변' 0건", !ROUTES_CODE.includes('위키 근거 기반 AI 답변'));
  ok("'검증(canonical) 근거만 반영' 0건", !ROUTES_CODE.includes('검증(canonical) 근거만 반영'));
  ok("'⚠미검증 참고' 꼬리표 0건", !ROUTES_CODE.includes('⚠미검증 참고'));
  ok('정상 답변의 note 는 빈 문자열', /note = usedGemini\s*\n?\s*\? ''/.test(ROUTES_CODE));
  ok('해역트리 등급 꼬리표 상수가 빈 문자열', /const ZONE_ANSWER_NOTE = '';/.test(RET_SRC));
  ok("트리 답변 본문의 등급 문장 0건", !RET_SRC.includes('사람이 검증한 위키 카드가 아니라, ${laws}'));
  ok("UI 상태 note '추가 정보가 필요해요'는 유지", ROUTES_SRC.includes("note: '추가 정보가 필요해요'"));
  ok('오류·결과 상태 note 는 유지', ROUTES_SRC.includes('답변 생성 실패') && ROUTES_SRC.includes('이 질문에 맞는 근거를 위키에서 찾지 못했습니다.'));
  ok('내부 프롬프트 지침(RAW_ANSWER_RULES 규칙10)은 유지(화면 꼬리표가 아니다)',
    RET_SRC.includes('10. ★이 답변은 "미검증 참고"다.'));
}

// ============================================================================
// [2026-08-14] 적대검증(프로덕션 실키 라이브) 결함 4건의 재현 테스트 — T21~T24
//   각 블록은 **수정 전 코드로 돌리면 실패**하도록 짰다(그래야 진짜 게이트다).
//   원 리포트: HANDOFF.md "H-37 적대검증 완료(프로덕션 실키 포함)" 항목.
// ============================================================================

// ── T21 [F1]. 스위치 설정 파일이 fly 볼륨 하위에 있다(재시작·멀티머신 지속) ─────────
console.log('\n[T21][F1] 스위치 저장 위치 — fly 볼륨 하위여야 재시작해도 남는다');
{
  const { DATA_DIR } = require(path.join(SRV, 'config', 'server_config'));
  const ROOT = path.join(SRV, '..');
  const cfgPath = path.join(DATA_DIR, 'nariya_config.json');
  const FLY = fs.readFileSync(path.join(ROOT, 'fly.toml'), 'utf8');
  const dest = (FLY.match(/destination\s*=\s*'([^']+)'/) || [])[1] || '';
  ok('fly.toml 의 볼륨 마운트 경로를 읽었다', dest === '/app/local_server/data', dest);
  ok('설정 파일 경로가 그 볼륨 하위다',
    cfgPath.indexOf(DATA_DIR + path.sep) === 0
    && path.relative(ROOT, cfgPath).split(path.sep).join('/') === dest.replace('/app/', '') + '/nariya_config.json');
  ok('routes 가 DATA_DIR 하위에 쓴다', /const CONFIG_FILE = path\.join\(DATA_DIR, 'nariya_config\.json'\);/.test(ROUTES_SRC));
  ok('이미지 내부(구경로)를 저장 위치로 쓰지 않는다',
    !/const CONFIG_FILE = path\.join\(LEGAL_DIR, '_dashboard', 'nariya_config\.json'\);/.test(ROUTES_SRC));
  ok('구경로 값은 최초 1회만 신경로로 옮긴다(값 리셋 방지)',
    /const CONFIG_FILE_LEGACY = path\.join\(LEGAL_DIR, '_dashboard', 'nariya_config\.json'\);/.test(ROUTES_SRC)
    && /if \(!configMigrated\)/.test(ROUTES_CODE));
  ok('구경로에는 절대 쓰지 않는다(git 추적 파일)', !/writeFileAtomic\(CONFIG_FILE_LEGACY/.test(ROUTES_SRC));
  ok('런타임 설정 파일은 git 추적 대상이 아니다(볼륨 전용)',
    fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').includes('local_server/data/nariya_config.json'));
}

// ── T22 [F2]. ctx 없는 버튼을 눌러도 직전 맥락을 이어받는다(무한루프 재현 고정) ──────
console.log('\n[T22][F2] ctxNext 이어받기 — 프로필 확인 무한루프 재현 방지');
{
  // ⓐ 서버 — 확정된 맥락이 있을 때만 done 에 ctxNext 를 싣는다(비면 필드 자체가 없다 = R0).
  ok('빈 ctx → ctxNext 없음(R0 유지)', R.ctxNextOf(EMPTY_CTX) === null);
  ok('ctx 자체가 없으면 null', R.ctxNextOf(null) === null);
  const acceptedCtx = R.normalizeAskCtx(
    { prof: { decided: [{ axis: '선박용도', label: '낚시어선', use: 'accepted' }] } }, PROFILE);
  ok('확정된 축이 있으면 ctxNext 에 실린다', !!R.ctxNextOf(acceptedCtx)
    && R.ctxNextOf(acceptedCtx).prof.decided[0].use === 'accepted');
  ok('이해확인 라운드만 올라가 있어도 실린다',
    !!R.ctxNextOf(R.normalizeAskCtx({ uc: { rounds: 1, state: 'none' } }, PROFILE)));
  // [§4-U 2026-08-16] 5번째 done 이 생겼다 — §4-U ③정직한 포기 응답. 이것도 ctxNext 를 붙여야
  //   "이미 한 번 물어봤다"(nu.rounds)가 다음 턴까지 살아 같은 말을 또 묻지 않는다.
  ok('done 응답 전부(확인카드·트리·되묻기·최종답변·§4-U포기)에 ctxNext 를 붙인다',
    (ROUTES_CODE.match(/withCtxNext\(/g) || []).length === 5,
    (ROUTES_CODE.match(/withCtxNext\(/g) || []).length);

  // ⓑ 라이브에서 재현된 무한루프 시나리오를 그대로 고정한다.
  //    프로필확인 "네" → 트리 답변 + **ctx 없는 버튼** → 그 버튼 클릭 → 같은 축을 또 묻는가?
  const card = R.profileConfirmStep(CLARIFY_USE, PROFILE, { decided: [] }, true);
  ok('① 프로필 확인 카드가 뜬다', card.mode === 'confirm');
  const afterYes = R.normalizeAskCtx(card.step.clarify.options[0].ctx, PROFILE);   // "네, 그 조건으로"
  const carried = R.ctxNextOf(afterYes);                       // 서버가 그다음 응답에 실어 보내는 맥락
  ok('② "네" 뒤의 맥락이 ctxNext 로 이어진다', !!carried && carried.prof.decided.length === 1);
  const afterCtxlessClick = R.normalizeAskCtx(carried, PROFILE);   // ctx 없는 버튼이 그대로 되돌려 보냄
  ok('③ ctx 없는 버튼을 눌러도 그 축은 확정 상태 그대로 → 다시 묻지 않는다',
    R.profileConfirmStep(CLARIFY_USE, PROFILE, afterCtxlessClick.prof, true).mode === 'drop');
  ok('★맥락을 버리면 같은 축을 또 묻는다(= 이 테스트가 잡는 결함)',
    R.profileConfirmStep(CLARIFY_USE, PROFILE, { decided: [] }, true).mode === 'confirm');

  // ⓒ 클라이언트 계약 — 맥락은 버튼이 아니라 **대화**가 들고 있는다.
  ok('ctx 없는 선택지도 직전 맥락을 이어 보낸다', /doSend\(lastCtx, box(?:, true)?\);/.test(CLIENT_SRC));
  ok('버튼 ctx 는 직전 맥락 **위에** 축 단위로 얹는다',
    /doSend\(mergeCtx\(lastCtx, ctx\), box(?:, true)?\);/.test(CLIENT_SRC));
  ok('서버가 준 ctxNext 를 다음 요청까지 보관한다', /lastCtx = \(data && data\.ctxNext\) \|\| null;/.test(CLIENT_SRC));
  ok('사용자가 새로 타이핑한 질문에서는 맥락을 비운다(§9.1 #1)', /if \(!sendCtx\) lastCtx = null;/.test(CLIENT_SRC));
  ok('lastCtx 도 메모리에만 둔다(새로고침하면 소멸 — §9.1 #3)',
    /var lastCtx = null;/.test(CLIENT_SRC) && !/setItem\([^)]*lastCtx/.test(CLIENT_SRC));

  // mergeCtx 는 정규식이 아니라 **실제로 돌려서** 검사한다(소스에서 그대로 꺼낸다).
  const mSrc = (CLIENT_SRC.match(/function mergeCtx\(base, extra\) \{[\s\S]*?\n {2}\}/) || [])[0];
  const mergeCtx = mSrc ? new Function('return (' + mSrc + ');')() : null;
  ok('mergeCtx 를 클라이언트 소스에서 꺼냈다', typeof mergeCtx === 'function');
  if (typeof mergeCtx === 'function') {
    const merged = mergeCtx({ prof: { decided: [{ axis: '선박용도' }] }, uc: { rounds: 0, state: 'none' } },
      { uc: { rounds: 1, state: 'confirmed' } });
    ok('같은 축은 새 값이 이기고, 다른 축의 결정은 살아남는다',
      merged.uc.state === 'confirmed' && merged.prof.decided.length === 1);
    ok('이어받을 게 없으면 버튼 ctx 그대로',
      JSON.stringify(mergeCtx(null, { uc: { rounds: 1 } })) === '{"uc":{"rounds":1}}');
    ok('버튼 ctx 가 없으면 직전 맥락 그대로', JSON.stringify(mergeCtx({ scope: [] }, null)) === '{"scope":[]}');
  }
}

// ── T23 [F4]. 프로필 축 대조는 완전일치만 — 부분일치 오탐 재현 고정 ─────────────────
console.log('\n[T23][F4] 축 대조 완전일치 — 실사용 값으로 재현된 오탐');
{
  const AT = '2026-07-30T09:04:00+09:00';
  const night = R.normalizeProfile({ fields: { 야간조업: { v: '예', at: AT } } });
  const tug = { needed: true, question: '어떤 배인가요?', options: [{ label: '예인선·부선' }, { label: '그 밖의 선박' }] };
  ok('야간조업 "예" × 선택지 "예인선·부선" → 오탐 없음(평소 되묻기)',
    R.profileConfirmStep(tug, night, { decided: [] }, true).mode === 'as-is');
  const general = R.normalizeProfile({ fields: { 선박용도: { v: '일반', at: AT } } });
  const zone = { needed: true, question: '어디인가요?', options: [{ label: '일반해역' }, { label: '특정해역' }] };
  ok('선박용도 "일반" × 선택지 "일반해역" → 오탐 없음',
    R.profileConfirmStep(zone, general, { decided: [] }, true).mode === 'as-is');
  ok('반대 방향 부분일치(라벨이 프로필 값에 포함)도 인정하지 않는다',
    R.profileConfirmStep({ needed: true, options: [{ label: '어선' }, { label: '레저' }] },
      R.normalizeProfile({ fields: { 선박용도: { v: '낚시어선', at: AT } } }), { decided: [] }, true).mode === 'as-is');
  ok('완전일치는 그대로 발동한다(기능은 살아 있다)',
    R.profileConfirmStep(CLARIFY_USE, PROFILE, { decided: [] }, true).mode === 'confirm');
  ok('코드에 포함(부분일치) 대조가 남아 있지 않다',
    !/o\.label\.includes\(v\)|v\.includes\(o\.label\)/.test(H37_CODE));
}

// ── T24 [F3]. 이해확인 프롬프트 — 기준2와 기준4의 상충 제거 ────────────────────────
console.log('\n[T24][F3] 이해확인 판정 기준 — "애매하면 통과"가 기준2를 무력화하지 않는다');
{
  ok('"조금이라도 애매하면 clear:true 로 물러나라" 문장이 사라졌다',
    !RET_SRC.includes('조금이라도 애매하면 clear:true 로 물러나라'));
  ok('기준4가 재진술 가능성으로 갈린다(순서가 명시돼 있다)',
    /뜻을 하나로 좁힐 수 있으면 clear:false/.test(RET_SRC)
    && /뜻이 둘 이상 남아[\s\S]{0,60}clear:true/.test(RET_SRC));
  ok('기준2는 그대로다(뜻이 둘 이상으로 갈리면 clear:false)',
    /뜻이 둘 이상으로 갈리면 clear:false/.test(RET_SRC));
  const DESIGN = fs.readFileSync(path.join(SRV, 'knowledge', 'legal', '_dashboard',
    'H37_understanding_confirm_design.md'), 'utf8');
  ok('설계문서 §4.2 도 같은 문구로 갱신됐다(문서와 코드가 어긋나지 않는다)',
    DESIGN.includes('뜻을 하나로 좁힐 수 있으면 clear:false')
    && !DESIGN.includes('조금이라도 애매하면 clear:true 로 물러나라'));
}

// ── T25. 이해확인 재진술 품질 — "정보 이득이 없으면 개입하지 않는다"(설계 §4.2) ────────────
//   3·4차 프로덕션 재검증 실측 4가지를 한 원칙으로 고정한다.
//    ③ 지시어는 앞 절 명사구로 **반드시** 풀어쓴다(4/7 → 프롬프트 강화).
//    ② 못 풀면 need 카드가 아니라 **그냥 통과**(off일 때 되묻기가 더 낫다는 실측).
//    ① 의문사만 끼워 넣은 빈칸형("무엇을 신고해야 하는지")도 **그냥 통과**.
//    ④ 카드 문구의 조사는 받침으로 고른다(고정 문자열이면 「그건」가 처럼 비문).
//   ⚠2026-08-15 이전 T25와 의미가 바뀐 항목: need 갈래 관련 4건은 **그 갈래를 없앴으므로**
//     "need 가 없어야 한다"는 검사로 뒤집었다(설계 §4.2 재설계 절에 근거를 적었다).
//   ⚠Gemini 키가 없는 환경이라 **판정 호출 자체는 못 돌린다** — 프롬프트 문구·후검사·설계문서
//     정합만 고정한다. 실제 재진술 품질은 다음 프로덕션 재검증에서 확인해야 한다.
console.log('\n[T25] 이해확인 재진술 품질 — 정보 이득이 없으면 개입하지 않는다');
{
  const D = fs.readFileSync(path.join(SRV, 'knowledge', 'legal', '_dashboard',
    'H37_understanding_confirm_design.md'), 'utf8');
  // (1) 프롬프트에 기준5가 있고, 기준4와의 순서가 **양쪽에** 적혀 있다(F3 같은 상충을 안 만든다)
  ok('프롬프트에 기준5(지시어)가 있다', /5\. ★기준4보다 \*\*먼저\*\* 본다/.test(RET_SRC));
  ok('기준4 쪽에도 "지시어면 기준5로" 라는 역방향 순서가 적혀 있다',
    /이유가 아래 기준5의 지시어 때문이라면 여기가 아니라 기준5다/.test(RET_SRC));
  ok('기준1과의 범위 분리가 명시돼 있다(이미 clear:true 인 질문은 기준5로 안 온다)',
    /기준1로 이미 clear:true 인 질문은 여기 오지 않는다/.test(RET_SRC));
  ok('기준3과의 조화가 명시돼 있다(풀어써도 법령·조문·수치 금지)',
    /풀어쓸 때도 기준3은 그대로다/.test(RET_SRC));
  ok('기준2는 그대로 유지된다(판정값을 뒤집지 않는다)',
    /뜻이 둘 이상으로 갈리면 clear:false/.test(RET_SRC));
  // (2) ③풀어쓰기 강화 — "반드시" + 명사구 지시 + 예시 4개
  ok('가리키는 것이 질문 안에 있으면 **반드시** 풀어쓰라고 지시한다',
    /\*\*반드시\*\* 그 이름으로 \*\*풀어써서\*\* restate 에 담아라/.test(RET_SRC));
  ok('앞 절에 명사구가 있으면 물러나지 말라고 못박았다(4/7 불안정 대응)',
    RET_SRC.includes('앞 절에 명사구가 있는데도 "확실하지 않다"며 물러나지 마라'));
  ok('후보가 둘 이상일 때 고르는 규칙이 있다(모델이 고민하다 물러나지 않게)',
    /지시어에 가장 가까운 명사구\*\*를 고른다/.test(RET_SRC));
  ok('풀어쓰기 예시가 4개 박혀 있다',
    ['예1 "구명조끼', '예2 "안전점검', '예3 "어선검사', '예4 "위판장에서'].every(s => RET_SRC.includes(s)));
  ok('실측된 얕은 재진술이 금지 예시로 박혀 있다',
    RET_SRC.includes('"그것을 언제까지 해야 하는지 알려주세요" 같은 문장'));
  // (3) ①②통합 — 대원칙 한 줄 + need 갈래 소멸
  ok('프롬프트 맨 앞에 "얻는 게 없으면 clear:true" 대원칙이 있다',
    RET_SRC.includes('**확인해서 얻는 게 없으면 clear:true 로 넘어가라.**'));
  ok('지시어를 못 풀면 need 가 아니라 clear:true 로 넘어가라고 지시한다',
    /짐작해서 지어내지 말고\*\*\n?\s*그냥 clear:true 로 넘어가라/.test(RET_SRC));
  ok('출력 JSON 스펙에서 need 갈래가 사라졌다', !/"clear":false,"need"/.test(RET_SRC));
  ok('need 카드 문구·상수가 코드에서 사라졌다(발동 경로만 없애고 남겨 두지 않는다)',
    !RET_SRC.includes('UNDERSTAND_TELL') && !RET_SRC.includes('가 무엇을 말씀하시는지'));
  ok('확인 카드는 한 종류뿐이다(confirmKind:understand 1곳)',
    (H37_CODE.match(/confirmKind: 'understand'/g) || []).length === 1);
  ok('빈칸형 금지(기준6)가 프롬프트에 있다', /6\. ★"빈칸형" 재진술 금지/.test(RET_SRC));
  ok('실측된 빈칸형이 금지 예시로 박혀 있다',
    RET_SRC.includes('금지 예 "신고해야 하나요?" → "무엇을 신고해야 하는지 알고 싶다"'));
  // (4) 서버 후검사 — 프롬프트만 믿지 않는다
  ok('지시어가 남은 재진술을 잡는 후검사가 있다', typeof R.RESTATE_DEICTIC !== 'undefined');
  ok('실측 사례 ①을 잡는다', R.RESTATE_DEICTIC.test('그것을 언제까지 해야 하는지 알려주세요'));
  ok('실측 사례 ②를 잡는다', R.RESTATE_DEICTIC.test('그것을 처리하지 않으면 어떤 결과가 발생하는지 궁금하신가요'));
  ok('제대로 풀어쓴 재진술은 통과시킨다',
    !R.RESTATE_DEICTIC.test('구명조끼 비치를 언제까지 해야 하는지 알고 싶다'));
  // ⚠2026-08-15 §17: 후검사 3종은 restateAllowed() 한 군데로 모았다(사용자가 "네"를 눌러 되돌아온
  //   재진술도 **같은 기준**으로 다시 걸러야 하기 때문). 소스 문자열 대조 대신 **동작**으로 고정한다.
  ok('그 후검사가 실제로 판정 폐기에 쓰인다(동작)', R.restateAllowed('그것을 언제까지 해야 하는지 알려주세요') === '');
  ok('빈칸형을 잡는 후검사가 있다', typeof R.RESTATE_BLANK !== 'undefined');
  ok('실측 빈칸형을 잡는다', R.RESTATE_BLANK.test('무엇을 신고해야 하는지 알고 싶다'));
  ok('의문사 목록 전체를 잡는다',
    ['무엇', '무슨', '어떤', '어느', '누구', '얼마나'].every(w => R.RESTATE_BLANK.test(w + ' 해야 하는지')));
  ok('프롬프트의 풀어쓰기 예시 4개는 이 후검사에 안 걸린다(자기모순이 없다)',
    ['구명조끼 비치를 언제까지 해야 하는지 알고 싶다',
      '안전점검을 받지 않으면 어떻게 되는지 알고 싶다',
      '어선 정기검사를 언제 받아야 하는지 알고 싶다',
      '위판장 신고를 온라인으로 할 수 있는지 알고 싶다']
      .every(s => !R.RESTATE_BLANK.test(s) && !R.RESTATE_DEICTIC.test(s)));
  ok('그 후검사가 실제로 판정 폐기에 쓰인다(동작)', R.restateAllowed('무엇을 신고해야 하는지 알고 싶다') === '');
  ok('RESTATE_BAN 후검사는 그대로 살아 있다(셋 다 건다)',
    R.restateAllowed('제32조 위반이면 과태료 100만원') === ''
    && /RESTATE_BAN\.test\(t\)/.test(H37_CODE)
    && /const restate = restateAllowed\(obj\.restate\);/.test(H37_CODE));
  // (5) ④조사 — 받침으로 고른다
  ok('조사 헬퍼가 있다', typeof R.josaEuro === 'function');
  ok('받침 없음 → 로', R.josaEuro('알고 싶다') === '로');
  ok('ㄹ 받침 → 로(예외)', R.josaEuro('신고할 수 있을') === '로');
  ok('그 밖의 받침 → 으로', R.josaEuro('궁금함') === '으로' && R.josaEuro('여부 확인') === '으로');
  ok('한글이 아니면 로(읽는 법을 지어내지 않는다)', R.josaEuro('IMO') === '로' && R.josaEuro('') === '로');
  ok('카드 문구가 고정 조사를 안 쓴다', /「\$\{restate\}」\$\{josaEuro\(restate\)\} 이해했는데/.test(H37_CODE));
  // (6) 설계문서와 코드가 어긋나지 않는다(T24와 같은 대조)
  ok('설계문서 §4.2 에도 기준5·기준6이 같은 취지로 적혀 있다',
    D.includes('★기준4보다 먼저 본다') && D.includes('6. ★"빈칸형" 재진술 금지'));
  ok('설계문서에서 need 카드 모양이 사라지고 폐지 근거가 적혀 있다',
    !D.includes('「<need>」가 무엇을 말씀하시는지 알려주시겠어요?')
    && D.includes('`need` 갈래를 없애고 2갈래로 정리'));
  ok('설계문서에 후검사 3종(BAN·DEICTIC·BLANK)과 오탐 비용이 적혀 있다',
    D.includes('RESTATE_DEICTIC') && D.includes('RESTATE_BLANK')
    && D.includes('정당한 재진술도 일부 버린다'));
  ok('설계문서 §9.1 에 표 변화 없음이 명시돼 있다', D.includes('이 표는 그대로다(행 추가·삭제 없음)'));
}

// ── T26 [§17]. 확인된 재진술이 실제로 하류(검색·되묻기)에 도달한다 ────────────────────
//   5차 프로덕션 재검증의 마지막 발견: 재진술에 "네"를 눌러도 **스위치 off 와 똑같은 답**이 나왔다
//   (재진술이 query 에도 검색에도 전혀 안 실렸기 때문). 이 절이 그 경로를 고정한다.
//   ★고정하는 것 3가지: ①재진술이 ctx 로 왕복하되 **신뢰 규약(후검사)을 다시 통과**해야 산다
//     ②재진술은 **질의확장·되묻기판단 프롬프트**로만 들어가고 낱말을 직접 얹지 않는다(실측 근거는
//     설계 §17) ③재진술이 없으면 두 프롬프트가 **바이트 동일**하다(R0).
//   ⚠Gemini 호출은 stub 으로 가로챈다 — 키 없이 결정론적으로 돌아야 하기 때문(이 파일의 규약).
(async () => {
  console.log('\n[T26][§17] 확인된 재진술 → 검색·되묻기 도달');
  const gemini = require(path.join(SRV, 'services', 'gemini_client.js'));
  const realHas = gemini.hasAnyKey, realCall = gemini.callGemini;
  const RE = '안전검사를 받지 않으면 어떻게 되는지 알고 싶다';
  const Q = '안전검사 통지 받았는데 그거 안 받으면 어떻게 되나요?';
  let seen = [];
  gemini.hasAnyKey = () => true;
  gemini.callGemini = async ({ contents, caller }) => {
    seen.push({ caller, prompt: contents });
    if (caller === 'Legal-QueryExpand') return { success: true, text: '["안전검사","정기검사"]' };
    if (caller === 'Legal-Understand') return { success: true, text: JSON.stringify({ clear: false, restate: RE }) };
    if (caller === 'Legal-Clarify') return {
      success: true, text: JSON.stringify({
        needed: true, intro: '선박 종류에 따라 처벌이 달라집니다.', question: '어떤 종류의 선박인가요?',
        options: [{ label: '어선', hint: '어선법 적용' }, { label: '그 밖의 선박', hint: '선박안전법 적용' }],
      }),
    };
    return { success: false };
  };
  try {
    // (1) ctx 스키마 — 확인된 재진술만 산다
    const conf = R.normalizeAskCtx({ uc: { rounds: 1, state: 'confirmed', restate: RE } }, { fields: {} });
    ok('"네"를 받은 재진술은 ctx 로 이어진다', conf.uc.restate === RE);
    ok('확인 전(state:none)이면 값이 있어도 버린다',
      R.normalizeAskCtx({ uc: { state: 'none', restate: RE } }, { fields: {} }).uc.restate === '');
    ok('ctxNext 가 재진술을 다음 라운드로 실어 나른다', R.ctxNextOf(conf).uc.restate === RE);
    ok('빈 ctx 는 여전히 null 이다(R0 — 필드 자체를 안 싣는다)',
      R.ctxNextOf(R.normalizeAskCtx(null, { fields: {} })) === null);
    // (2) 위조 방어 — 되돌아온 값도 생성 때와 같은 후검사를 다시 통과해야 한다
    const forged = s => R.normalizeAskCtx({ uc: { state: 'confirmed', restate: s } }, { fields: {} }).uc.restate;
    ok('조문·형량을 끼워 넣은 위조 재진술은 버린다', forged('제32조 위반이면 과태료 100만원이다') === '');
    ok('지시어가 남은 위조 재진술은 버린다', forged('그것을 언제까지 해야 하는지') === '');
    ok('빈칸형 위조 재진술은 버린다', forged('무엇을 신고해야 하는지 알고 싶다') === '');
    ok('길이 상한이 걸린다(프롬프트·화면에 그대로 실리는 값)', forged('가'.repeat(500)).length === 120);
    ok('문자열이 아니면 무시한다', forged({ a: 1 }) === '' && forged(null) === '');
    // (3) 확인 카드의 "네" 버튼이 재진술을 싣는다 / "아니요"는 안 싣는다
    seen = [];
    const card = await R.understandConfirmStep(Q, { rounds: 0, state: 'none' }, true);
    const yes = card && card.clarify.options[0], no = card && card.clarify.options[1];
    ok('확인 카드가 나온다(stub 판정)', !!(card && card.clarify));
    ok('"네" 버튼의 ctx 에 재진술 원문이 실린다', yes.ctx.uc.state === 'confirmed' && yes.ctx.uc.restate === RE);
    ok('"아니요" 버튼에는 안 실린다(승인받지 못한 뜻이다)', !no.ctx.uc.restate);
    ok('카드 문구와 실어 보내는 값이 같은 문장이다', card.clarify.question.includes(yes.ctx.uc.restate));
    // (4) 질의확장 프롬프트 — 재진술이 들어가고, 없으면 바이트 동일(R0)
    seen = []; await R.expandQueryTerms(Q);
    const eNone = seen[0].prompt;
    seen = []; await R.expandQueryTerms(Q, RE);
    const eWith = seen[0].prompt;
    seen = []; await R.expandQueryTerms(Q, '제32조 위반이면 과태료 100만원이다');
    const eBan = seen[0].prompt;
    ok('재진술이 질의확장 프롬프트에 실린다', eWith.includes(RE));
    ok('재진술 없으면 프롬프트가 오늘과 바이트 동일하다(R0)', eNone === eBan && !eNone.includes('확인해 줬다'));
    // (5) 되묻기 판단 프롬프트 — 같은 규약
    const CP = [{ law: '선박안전법', topic: '검사', body: '정기검사를 받지 아니한 자는 …' }];
    seen = []; await R.decideClarify(Q, CP);
    const cNone = seen[0].prompt;
    seen = []; await R.decideClarify(Q, CP, RE);
    const cWith = seen[0].prompt;
    ok('재진술이 되묻기 판단 프롬프트에 실린다',
      cWith.includes(RE) && cWith.includes('이미 정해 준 조건은 **다시 묻지 마라**'));
    ok('재진술 없으면 질문 블록이 오늘과 바이트 동일하다(R0)',
      cNone.includes('[질문]\n"' + Q + '"\n\n[근거자료]') && !cNone.includes('확인해 준 질문의 뜻'));
    ok('되묻기 라운드 계산은 그대로다(재진술은 query 에 안 붙는다)',
      Q.split(' — ').length - 1 === 0);
    // (5b) D-트리(scopeNarrowStep) 확정 조건 — narrowLabels 도 restate와 같은 자리에 낀다(2026-08-15)
    seen = []; await R.decideClarify(Q, CP, '', ['그 밖의 선박']);
    const cNarrow = seen[0].prompt;
    ok('narrowLabels가 되묻기 판단 프롬프트에 실린다',
      cNarrow.includes('그 밖의 선박') && cNarrow.includes('[이미 확정된 조건]') && cNarrow.includes('다시 묻지 마라'));
    ok('narrowLabels 없으면 프롬프트에 그 블록이 없다(R0)', !cNone.includes('이미 확정된 조건'));
    // ★라이브 재현 버그: scopeNarrowStep 이 "그 밖의 선박"으로 확정해도 decideClarify 가 같은 축을
    //   중복으로 되물었다 — narrowLabels 가 옵션 라벨과 완전일치하면 결정론적으로 버려야 한다.
    const dup = await R.decideClarify(Q, CP, '', ['그 밖의 선박']);
    ok('이미 확정된 라벨과 같은 선택지가 나오면 되묻기를 버린다', dup.needed === false);
    const fresh = await R.decideClarify(Q, CP, '', ['수상레저기구']);
    // [2026-08-17 H-40 B7] 되묻기 선택지 맨 끝에 "잘 모르겠어요"가 **항상** 붙는다 —
    //   아래 기대 개수는 전부 그만큼(+1) 커졌다. 개수만 세면 그 버튼이 딴 자리에 붙어도 통과하므로
    //   **맨 끝 항목이 act:'unknown' 인지**까지 함께 못박는다.
    const lastIsUnknown = r => r.options[r.options.length - 1].act === 'unknown';
    ok('겹치지 않는 narrowLabels는 되묻기를 막지 않는다', fresh.needed === true && fresh.options.length === 3);
    ok('그 되묻기 맨 끝이 "잘 모르겠어요"다(H-40 B7)', lastIsUnknown(fresh));
    // (5c) 최소 절충안(2026-08-15) — 직전 질문(lastTopic)을 "확인 후보"로 하나 더 얹는다.
    //   §9.1 #1(타이핑한 새 질문은 맥락을 비운다)은 그대로 두고, decideClarify가 이미 애매해서
    //   되물을 때만(needed:true) 여지가 있으면(칸이 남고 아직 안 겹치면) 얹는다.
    const PREV = '안전검사 안 받으면 어떻게 되나요?';
    const withPrev = await R.decideClarify(Q, CP, '', [], PREV);
    ok('직전 질문이 확인 후보로 추가된다(옵션 3개 + 잘모르겠어요)',
      withPrev.needed === true && withPrev.options.length === 4 && lastIsUnknown(withPrev));
    ok('추가된 후보의 라벨·힌트가 직전 질문을 그대로 담는다',
      withPrev.options[2].label === PREV && withPrev.options[2].hint.includes('이어지는'));
    const noPrev = await R.decideClarify(Q, CP, '', []);
    ok('직전 질문이 없으면 종전과 동일하다(옵션 2개 + 잘모르겠어요)',
      noPrev.needed === true && noPrev.options.length === 3 && lastIsUnknown(noPrev));
    const alreadyIn = await R.decideClarify(PREV + ' 처벌은요?', CP, '', [], PREV);
    ok('직전 질문이 이미 이번 질문에 들어 있으면 중복 추가하지 않는다',
      alreadyIn.options.length === 3 && lastIsUnknown(alreadyIn));
    // (6) 재진술 낱말을 검색어로 직접 얹지 않는다(§17 실측 — 얹으면 검색이 뒤집혔다)
    const s1 = await R.search(Q, { canonicalOnly: true });
    const s2 = await R.search(Q, { canonicalOnly: true, restate: RE });
    ok('같은 확장어면 검색 결과가 완전히 같다(= 낱말 직접 얹기 없음)',
      JSON.stringify(s1.sources.map(x => [x.file, x.score])) === JSON.stringify(s2.sources.map(x => [x.file, x.score])));
    // (7) 배선 — routes 가 스위치와 함께 넘긴다, query 에는 절대 안 섞는다
    ok('스위치 off 면 재진술을 하류로 안 넘긴다(§9.1 #10)',
      /const ucRestate = cfg\.understandConfirm \? \(ctx\.uc\.restate \|\| ''\) : '';/.test(ROUTES_CODE));
    ok('검색에 넘긴다', /search\(qForSearch,\s*[\s\S]{0,80}restate: ucRestate/.test(ROUTES_CODE));
    ok('되묻기 판단에도 넘긴다', /decideClarify\(q, contextPages, ucRestate, narrowLabels, lastQuestion(?:, ctx\.cl)?\)/.test(ROUTES_CODE));
    ok('질의 문자열에는 어디서도 안 합친다(R2)',
      !/q \+[^\n]*restate/i.test(ROUTES_CODE) && !/restate[^\n]*\+ q\b/i.test(ROUTES_CODE));
    // (8) 설계문서와 코드가 어긋나지 않는다(T24·T25와 같은 대조)
    const D26 = fs.readFileSync(path.join(SRV, 'knowledge', 'legal', '_dashboard',
      'H37_understanding_confirm_design.md'), 'utf8');
    ok('설계문서에 §17(재진술 하류 반영)이 있다', /## 17\./.test(D26));
    ok('설계문서에 "낱말 직접 얹기 미채택" 실측 근거가 적혀 있다',
      D26.includes('위험물반입및하역') && D26.includes('낱말을 직접 얹는 방식은 채택하지 않았다'));
  } finally {
    gemini.hasAnyKey = realHas; gemini.callGemini = realCall;
  }
})().then(() => {

// ── T17 [#20]. 3회 백스톱(비동기 — 마지막에 돌린다) ───────────────────────────
(async () => {
  console.log('\n[T17][#20] 3회 백스톱 — 확인 없이 통과 + 답변 첫 줄에 고정 고지문');
  const at3 = await R.understandConfirmStep('그거요?', { rounds: 3, state: 'none' }, true);
  ok('rounds 3 → 확인 카드 없이 assumed', !!(at3 && at3.assumed && !at3.clarify));
  ok('스위치 off → null(단계 자체가 없다)', (await R.understandConfirmStep('그거요?', { rounds: 0, state: 'none' }, false)) === null);
  ok('이미 "네"를 받았으면 다시 묻지 않는다', (await R.understandConfirmStep('그거요?', { rounds: 1, state: 'confirmed' }, true)) === null);
  const noKey = await R.understandConfirmStep('그거요?', { rounds: 0, state: 'none' }, true);
  ok('키 없음 = 그냥 통과(fail-open)', noKey === null || !!(noKey && noKey.clarify));
  ok('assumed 상태로 온 ctx 도 확인을 다시 내지 않는다',
    !!((await R.understandConfirmStep('그거요?', { rounds: 0, state: 'assumed' }, true)) || {}).assumed);
  const body = R.withAssumedNotice('본문', true);
  ok('고지문이 답변 맨 앞에 붙는다', body.indexOf(R.ASSUMED_NOTICE) === 0 && body.endsWith('본문'));
  ok('고지 문구가 설계 확정 문구와 문자 그대로 같다',
    R.ASSUMED_NOTICE === '질문을 정확히 이해하지 못한 채 제가 추정해서 답변드려요 — 아래 내용이 물으신 것과 다르면 다시 말씀해 주세요.');
  ok('스트림 선두에도 같은 문자열을 쓴다(화면 = done.answer)', /full = legalRetriever\.ASSUMED_NOTICE \+ '\\n\\n';/.test(ROUTES_SRC));
  ok('2차 조회 답변에도 붙인다', /withAssumedNotice\(raw\.answer, assumed\)/.test(ROUTES_SRC));
  ok('고지문은 usedGemini 판정에 안 섞인다(스트림 실패를 성공으로 오판하지 않는다)',
    /const usedGemini = synth\.trim\(\)\.length > 0;/.test(ROUTES_SRC));
  ok('이해확인 재진술에 법 이야기가 섞이면 그 판정을 버린다(§4.2 후검사)',
    /const RESTATE_BAN = \/제\\s\*\\d\+\\s\*조\|법률\|법령\|벌금\|과태료\|징역\|「\|」\|만원\//.test(RET_SRC));
  ok('이해확인 라운드는 CLARIFY_MAX_ROUNDS 와 분리돼 있다(사용자 확정 (다))',
    /const UNDERSTAND_MAX_ROUNDS = 3;/.test(RET_SRC) && !/CLARIFY_MAX_ROUNDS/.test(H37_CODE));

  // ── T27 [H-40]. 챗봇 답변화면·근거표출 개선 회귀 (2026-08-17) ──────────────────
  //   설계·배경: MASTER_PLAN.md H-40 · 표출규칙: _CHATBOT.md 6절 · 원인: _LESSONS.md L-101
  //   ★여기 고정하는 것은 "사용자가 눈으로 확인한 결함이 되돌아오지 않는가"다.
  console.log('\n[T27][H-40] 근거 흐름·조문 팝업·되묻기 표출');
  {
    // (1) L-101 — 묶음 조문표기를 푼다(이게 안 되면 근거가 통째로 사라진다)
    ok('묶음+범위 혼합 표기를 조 단위로 푼다',
      JSON.stringify(R.expandJoEnum('제52~55·57조')) ===
      JSON.stringify(['제52조', '제53조', '제54조', '제55조', '제57조']));
    ok('가지번호 나열은 가지번호로 푼다(제109·110조와 구분)',
      JSON.stringify(R.expandJoEnum('제30조의5·6')) === JSON.stringify(['제30조의5', '제30조의6']));
    ok('묶음이 아닌 칸은 건드리지 않는다(단정 불가 → null)',
      R.expandJoEnum('제58조 / 시행령 별표5') === null && R.expandJoEnum('제3조제2항') === null);

    // (1-b) 별표 외 표기(별도N·별지 서식)와 띄어쓴 표기도 인정한다(B-1 실측 지적)
    ok('별도N·별지 제N호서식도 근거로 살아남는다',
      R.filterCitationChainByAnswer(
        [{ law: '수산자원관리법 시행령', article: '별도2' }, { law: '선박법 시행규칙', article: '별지 제1호서식' }],
        '「수산자원관리법 시행령」 별도 2와 「선박법 시행규칙」 별지 제1호 서식에 따라', '수산자원관리법').length === 2);
    ok('답변이 `별표 3`처럼 띄어 써도 대조된다',
      R.filterCitationChainByAnswer([{ law: '수산업법', article: '별표3' }], '「수산업법」 별표 3에 따라', '수산업법').length === 1);
    ok('공백 흡수가 오탐으로 번지지 않는다(인용 안 된 조는 여전히 탈락)',
      R.filterCitationChainByAnswer([{ law: '수산업법', article: '제41조' }], '「수산업법」 제40조에 따라', '수산업법').length === 0);

    // (2) 계약1 citedArticle — 답변에 **문자 그대로 있는 표기만** 떼어 온다(환각 0)
    const ANS = '「어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률」 제58조제5항제7호에 따라 ' +
      '과태료가 부과되고, 제53조 제1호에 따라 5년 이하의 징역에 처해질 수 있습니다.';
    ok('항·호까지 붙은 표기를 그대로 떼어 온다', R.citedArticleIn(ANS, '제58조') === '제58조제5항제7호');
    ok('띄어쓴 표기도 원문 그대로 보존한다(공백을 지우지 않는다)',
      R.citedArticleIn(ANS, '제53조') === '제53조 제1호');
    ok('인용된 적 없는 조는 빈 문자열(제5조로 제5조의2를 집지 않는다)',
      R.citedArticleIn('… 제5조의2 …', '제5조') === '');

    // (3) 되묻기 상한 10(사용자 확정) — 같은 조건 재질문 차단이 실질 방어선이 된다
    ok('되묻기 상한이 10이다', /const CLARIFY_MAX_ROUNDS = 10;/.test(RET_SRC));
    ok('질문 문장·선택지 집합이 같으면 차단한다(표현만 바꾼 재질문)',
      /function sameClarifyAsLast\(/.test(RET_SRC) && /sameClarifyAsLast\(question, options, prevClarify\)/.test(RET_SRC));

    // (4) R16 — 말풍선만 숨기고 **서버로 가는 누적 문자열은 그대로 유지**(이게 깨지면 되묻기가 무한루프)
    ok('버튼 선택은 종전대로 질의에 누적된다', /input\.value = q \? q \+ ' — ' \+ label : label;/.test(CLIENT_SRC));
    ok('말풍선 표시 여부는 별도 인자로만 끈다(전송값 불변)', /function doSend\(sendCtx, failBox, hideMe\)/.test(CLIENT_SRC));

    // (5) R19 — 되묻기 응답에는 면책 문구가 없다
    ok('되묻기면 note 만, 최종 답변에만 면책 문구',
      /if \(data\.clarify\) \{[\s\S]{0,200}?nrya-disc[\s\S]{0,80}?esc\(data\.note\)/.test(CLIENT_SRC));

    // (6) R20 — 법을 특정 못 하면 본문 조문에 링크를 걸지 않는다(엉뚱한 원문 방지)
    ok('같은 법명에 tier·base 가 갈리면 모호로 보고 링크 안 함',
      /hit\.ambiguous = true;/.test(CLIENT_SRC) && /\(hit && !hit\.ambiguous\)/.test(CLIENT_SRC));

    // (7) R23 — 전화번호는 표시만 나누고 거는 번호는 통번호
    ok('tel: 링크는 통번호(dial) 그대로', /href="tel:' \+ esc\(dial\)/.test(CLIENT_SRC));

    // (9) P0 선행 실측 후속 — `…기준` 고시가 '법률' 배지로 뜨던 것(classifyTier)
    ok('`…기준` 이름은 고시로 분류한다',
      R.classifyTier('선박구명설비기준') === 'notice' && R.classifyTier('어선설비기준') === 'notice'
      && R.classifyTier('어선원 안전ㆍ보건 및 재해예방 기준') === 'notice');
    ok('법률·시행령·시행규칙 분류는 그대로다(오탐 없음)',
      R.classifyTier('해사안전기본법') === 'law' && R.classifyTier('수산업법') === 'law'
      && R.classifyTier('해양환경관리법 시행령') === 'decree'
      && R.classifyTier('농수산물품질관리법 시행규칙') === 'rule');

    // (9-b) 이름이 `…규정`인 **대통령령**이 고시로 분류되던 것(A-1 실측 지적)
    ok('대통령령은 이름이 `…규정`이어도 시행령 계층으로 분류한다',
      R.classifyTier('공무원보수규정') === 'decree' && R.classifyTier('보안업무규정') === 'decree');
    ok('약칭표에 없는 이름은 종전 키워드 규칙 그대로다(R0)',
      R.classifyTier('해양경찰위원회 규정') === 'notice');

    // (9-c) 이름에 고시·지침 같은 낱말이 없는 행정규칙(A-3 실측 10건) — raw 수집 파일로 판정
    ok('이름에 키워드가 없어도 우리가 원문을 가진 행정규칙이면 고시로 분류한다',
      R.classifyTier('패류채취어업 중 잠수기 사용지역 및 패류의 종류') === 'notice'
      && R.classifyTier('한국해양교통안전공단 정관') === 'notice'
      && R.classifyTier('환경보전해역 및 특별관리해역 지정') === 'notice');

    // (10) 총괄 행 + 항·호 행이 함께 살아남아 같은 조문이 두 번 뜨던 것
    {
      const dup = [
        { law: 'A', article: '제58조', citedArticle: '제58조제5항제7호', gist: '최고 3천만원' },
        { law: 'A', article: '제58조제5항제7호', citedArticle: '제58조제5항제7호', gist: '5/10/15만원' },
        { law: 'A', article: '제53조', citedArticle: '' },
        { law: 'B', article: '제3조', citedArticle: '제3조' }];
      const kept = R.dropRedundantChainRows(dup).map(r => r.article);
      ok('같은 인용을 가리키면 더 좁게 짚은 줄만 남는다',
        JSON.stringify(kept) === JSON.stringify(['제58조제5항제7호', '제53조', '제3조']));
      ok('근거(citedArticle)가 없는 줄은 하나도 버리지 않는다(누락 0)',
        R.dropRedundantChainRows([{ law: 'A', article: '제1조', citedArticle: '' },
          { law: 'A', article: '제2조', citedArticle: '' }]).length === 2);
      ok('조문도 별표도 없는 줄(근거 불명확)은 겹쳐 보여도 하나도 버리지 않는다',
        R.dropRedundantChainRows([{ law: 'A', article: '', citedArticle: '' },
          { law: 'A', article: '', citedArticle: '' }]).length === 2);
      // (10-b) 2026-08-17 실측 — 조 번호 없이 **별표만** 가리킨 인용은 citedArticle 이 늘 빈 문자열이라
      //   겹침 검사를 통째로 건너뛰고 같은 별표가 화면에 두 번 떴다(낚시어선업신고 + 낚시어선업).
      const byl = [
        { law: '낚시 관리 및 육성법 시행령', article: '별표4', citedArticle: '', gist: '구명조끼·구명뗏목·AIS 등' },
        { law: '낚시 관리 및 육성법 시행령', article: '별표4', citedArticle: '', gist: '구명조끼·소화기·통신기기 등' }];
      ok('같은 별표를 가리키는 두 줄은 하나만 남는다(먼저 나온 줄)',
        JSON.stringify(R.dropRedundantChainRows(byl).map(r => r.gist)) === JSON.stringify(['구명조끼·구명뗏목·AIS 등']));
      ok('별표 번호가 다르거나 법이 다르면 둘 다 남는다',
        R.dropRedundantChainRows([
          { law: '낚시 관리 및 육성법 시행령', article: '별표4', citedArticle: '' },
          { law: '낚시 관리 및 육성법 시행령', article: '별표5', citedArticle: '' },
          { law: '낚시 관리 및 육성법 시행규칙', article: '별표4', citedArticle: '' }]).length === 3);
    }

    // (11) 위키가 법 이름을 정확히 적어둘수록 행이 죽던 역설(G1·G2 지적) — 두 표기 모두 살아야 한다
    {
      const FORMAL = '어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률';
      const rows = [{ law: FORMAL + ' 시행규칙', article: '제20조' }, { law: '시행규칙', article: '제20조' }];
      ok('법령 칸이 정식명+시행규칙이어도 살아남는다',
        R.filterCitationChainByAnswer(rows, '「' + FORMAL + '」 제33조와 같은 법 시행규칙 제20조에 따라', FORMAL).length === 2);
      ok('답변이 약칭으로 써도 살아남는다',
        R.filterCitationChainByAnswer(rows, '어선안전조업법 시행규칙 제20조에 따라', FORMAL).length === 2);
      ok('법 이름이 답변에 전혀 없으면 정식명 행은 통과시키지 않는다(느슨해지지 않음)',
        R.filterCitationChainByAnswer([rows[0]], '시행규칙 제20조에 따라', FORMAL).length === 0);
    }

    // (12) 2026-08-17 실기기 실측 — 말만 바꾼 같은 축 재질문이 세 번 반복되던 것
    {
      const prev = { q: '어떤 종류의 어선에서 음주운항을 하셨나요?', labels: ['낚시어선', '일반 어선', '잘 모르겠어요'] };
      const again = [{ label: '낚시어선업 신고 어선' }, { label: '일반 어선 (낚시어선업 신고 제외)' },
        { label: '잘 모르겠어요', act: 'unknown' }];
      ok('표현만 바꾼 같은 축 재질문은 버린다', R.sameClarifyAsLast('어떤 종류의 어선인지 알려주세요.', again, prev) === true);
      const again2 = [{ label: '낚시어선업 신고를 한 낚시어선' }, { label: '그 외 일반 어선' },
        { label: '잘 모르겠어요', act: 'unknown' }];
      ok('세 번째 변형도 버린다', R.sameClarifyAsLast('어떤 종류의 선박에서 음주운항을 하셨나요?', again2, prev) === true);
      // ⚠정상적인 좁히기는 죽이지 않는다: 상위 라벨(`어선`)은 2글자라 대조에서 빠진다
      const narrowOk = { q: '어떤 배에서 술을 마셨나요?', labels: ['어선', '수상레저기구', '그 외 선박'] };
      ok('상위 갈래 → 하위 갈래 좁히기는 그대로 진행한다',
        R.sameClarifyAsLast('어떤 종류의 어선인가요?', [{ label: '낚시어선' }, { label: '일반 어선' }], narrowOk) === false);
      ok('직전 되묻기가 없으면 아무것도 막지 않는다(R0)',
        R.sameClarifyAsLast('어떤 배인가요?', [{ label: '어선' }, { label: '레저기구' }], null) === false);
      // (12-b) 2026-08-17 실측 — 서술형 라벨을 **대답형**("네, …입니다.")으로만 바꿔 같은 갈림을 또 물었다.
      //   정규화만으론 `네관리선입니다` vs `관리선으로지정된어선`이라 포함관계가 안 잡혔다.
      const prevA = { q: '어떤 어선인지 알려주세요.',
        labels: ['어업허가를 받은 어선', '관리선으로 지정된 어선', '잘 모르겠어요'] };
      const yesNo = [{ label: '네, 관리선입니다.' }, { label: '아니요, 어업허가를 받은 어선입니다.' },
        { label: '잘 모르겠어요', act: 'unknown' }];
      ok('대답투("네/아니요 … 입니다")로만 바꾼 같은 축 재질문도 버린다',
        R.sameClarifyAsLast('관리선인가요?', yesNo, prevA) === true);
      // ⚠대답투여도 **다른 축**이면 막지 않는다(정상 좁히기를 죽이지 않는다)
      const prevB = { q: '어떤 배인가요?', labels: ['총톤수 10톤 미만 동력어선', '그 외 어선'] };
      ok('대답투여도 직전과 다른 축이면 그대로 진행한다',
        R.sameClarifyAsLast('전문교육을 이수하셨나요?',
          [{ label: '네, 이수했습니다.' }, { label: '아니요, 아직입니다.' }], prevB) === false);
    }

    // (8) 계약2·3 — 라우트는 조문 표기를 깎지 않고, 응답도 통째로 통과시킨다
    ok('약칭표 엔드포인트가 있다', /router\.get\('\/api\/legal\/aliases'/.test(ROUTES_SRC));
    ok('article 파라미터를 그대로 넘긴다(항·호를 잘라내지 않는다)',
      !/article[^\n]*\.replace\(/.test(ROUTES_CODE.split("'/api/legal/article-text'")[1] || ''));
  }

  // ── T28 [B11]. 답변 인용 기반 근거 카드 폴백 (2026-08-17 실기기 실측) ─────────────
  //   재현한 결함: "풍랑주의보여도 도선이 운항 가능한 조건" 질문에 답변은 「유선 및 도선 사업법
  //   시행규칙」 제7조·별표1, 같은 법 시행령 제9조제1항·별표2를 정확히 인용했는데, 최상위 근거가
  //   `wiki/statutes/유선및도선사업법.md`였고 statutes 74개 파일 전부에 `## 근거 조문` 표가 없어
  //   **근거 아코디언이 통째로 사라졌다**(연쇄로 본문 조문 팝업·시행일자도 사라짐).
  //   ★여기서 고정하는 것은 두 가지다: ①표가 없어도 답변 인용에서 후보를 뽑아낸다
  //   ②원문 확인 없이는 절대 카드가 되지 않는다(환각 0 — 카드 생성은 라우트가 loadArticle 로 한다).
  //   ⚠ 원문 조회 자체는 GITHUB_RAW_TOKEN 이 필요해 이 스위트에서 돌리지 않는다(키 없이 도는 것이
  //     이 파일의 계약) — 라우트가 그 확인을 실제로 거는지는 소스 대조로 고정한다.
  console.log('\n[T28][B11] 답변 인용 기반 근거 카드 폴백');
  {
    const FORMAL_ESAJ = '어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률';
    const ANS = '쉽게 말하면, 풍랑주의보가 발효 중이어도 「유선 및 도선 사업법 시행규칙」 제7조 및 ' +
      '별표 1에서 정한 기준을 갖추면 운항할 수 있습니다. 운항할 수 있는 해수면의 범위는 ' +
      '「유선 및 도선 사업법 시행령」 제9조제1항 및 별표 2에 따릅니다.';

    // (1) 실기기 사례 재현 — 위키 표가 0줄이어도 네 인용을 전부 뽑아낸다
    const got = R.extractAnswerCitations(ANS);
    ok('실기기 사례의 인용 4건을 뽑는다(제7조·별표 1·제9조제1항·별표 2)',
      JSON.stringify(got.map(c => c.law + ' ' + c.article)) === JSON.stringify([
        '유선 및 도선 사업법 시행규칙 제7조', '유선 및 도선 사업법 시행규칙 별표 1',
        '유선 및 도선 사업법 시행령 제9조제1항', '유선 및 도선 사업법 시행령 별표 2']),
      JSON.stringify(got.map(c => c.law + ' ' + c.article)));
    ok('tier 는 classifyTier 그대로(시행규칙=rule · 시행령=decree)',
      got.length === 4 && got[0].tier === 'rule' && got[2].tier === 'decree');
    ok('baseLaw 는 모법으로 편다(원문 폴더를 찾는 열쇠)',
      got.every(c => c.baseLaw === '유선 및 도선 사업법'));

    // (2) 환각 0 — 답변에 **문자 그대로 있는 표기만**, 조립하지 않는다
    ok('띄어쓴 표기를 그대로 보존한다(제58조 제5항 제7호)',
      (R.extractAnswerCitations('「선박안전법」 제58조 제5항 제7호에 따라')[0] || {}).article === '제58조 제5항 제7호');
    ok('법령명과 떨어져 있는 조문은 뽑지 않는다(어느 법인지 단정 불가)',
      R.extractAnswerCitations('「해운법」에 따라 여객선은 제10조의 신고가 필요합니다.').length === 0);
    ok('낫표가 없는 조문 인용은 뽑지 않는다',
      R.extractAnswerCitations('시행규칙 제20조에 따라 조치해야 합니다.').length === 0);

    // (3) 법 특정 — 약칭은 표로 바꾸고, 모르는 이름·고시는 버린다(모호하면 안 쓴다)
    ok('약칭을 정식명으로 바꾼다', (R.resolveAnswerLaw('어선안전조업법') || {}).law === FORMAL_ESAJ);
    ok('약칭 + 시행규칙도 편다', (R.resolveAnswerLaw('어선안전조업법 시행규칙') || {}).law === FORMAL_ESAJ + ' 시행규칙');
    ok('우리가 원문을 가진 법이 아니면 버린다', R.resolveAnswerLaw('없는이름법') === null);
    ok('고시·기준 이름은 버린다(어느 법 폴더인지 단정 불가)',
      R.resolveAnswerLaw('어선원 안전ㆍ보건 및 재해예방 기준') === null);

    // (4) 발동 조건 — 이미 목록에 있는 (법, 조)는 다시 보태지 않는다
    ok('목록이 비면 뽑힌 인용이 전부 후보다', R.missingAnswerCitations(ANS, []).length === 4);
    ok('같은 조를 가리키는 위키 줄이 있으면 뺀다(법령 칸이 `시행규칙`뿐이어도)',
      R.missingAnswerCitations(ANS, [{ law: '시행규칙', baseLaw: '유선 및 도선 사업법', article: '제7조' }])
        .some(c => c.article === '제7조') === false);
    ok('위키 줄이 항까지만 짚어도 같은 조면 뺀다',
      R.missingAnswerCitations(ANS, [{ law: '유선 및 도선 사업법 시행령', article: '제9조', citedArticle: '제9조제1항' }])
        .some(c => c.article === '제9조제1항') === false);
    ok('범위 행(`제1~9조`)이 덮는 조는 보태지 않는다',
      R.missingAnswerCitations('「어선법」 제5조에 따라', [{ law: '어선법', article: '제1~9조' }]).length === 0);
    ok('묶음 행(`제52~55·57조`)이 덮는 조도 보태지 않는다',
      R.missingAnswerCitations('「어선법」 제53조에 따라', [{ law: '어선법', article: '제52~55·57조' }]).length === 0);
    ok('법이 다르면 같은 조 번호라도 후보로 남는다',
      R.missingAnswerCitations('「어선법」 제5조에 따라', [{ law: '선박법', article: '제5조' }]).length === 1);
    ok('한 법 뒤에서 이어 읽는 표기는 4건까지만 본다(끝없이 이어지는 나열 방지)',
      R.extractAnswerCitations('「어선법」 제1조 제2조 제3조 제4조 제5조 제6조').length === 4);
    ok('후보 상한은 6건이다(원문 조회 횟수 = 답변 지연)',
      R.SYNTH_CANDIDATE_MAX === 6 &&
      R.missingAnswerCitations('「어선법」 제1조 제2조 제3조 제4조 「선박법」 제1조 제2조 제3조 제4조', []).length === 6);

    // (5) ★환각 0의 마지막 관문 — 카드는 **원문 확인을 통과한 것만** 만든다(라우트 소스 대조)
    const SYN = ROUTES_CODE.split('async function synthesizeChainRows')[1] || '';
    ok('폴백이 라우트에 배선돼 있다(위키 줄을 합친 뒤, 정렬 전에)',
      /synthRows = await synthesizeChainRows\(full, wikiRows\)/.test(ROUTES_CODE));
    ok('보탠 줄은 위키 줄 **뒤**에 붙고 기존 정리·정렬을 그대로 통과한다',
      /dropRedundantChainRows\(wikiRows\.concat\(synthRows\)\)/.test(ROUTES_CODE));
    ok('실패해도 기존 답변 흐름이 그대로 나간다(try/catch 로 감쌌다)',
      /try \{ synthRows = await synthesizeChainRows\(full, wikiRows\); \}\s*\n\s*catch/.test(ROUTES_SRC));
    ok('원문 조회(loadArticle)로 실재를 확인한다', /articleText\.loadArticle\(\{/.test(SYN));
    ok('조회 실패(ok:false)면 카드를 만들지 않는다', /if \(!res \|\| res\.ok !== true\) continue;/.test(SYN));
    ok('조 하나(single)·별표(annex) 외의 결과는 쓰지 않는다',
      /res\.mode !== 'single' && res\.mode !== 'annex'/.test(SYN));
    ok('별표는 원문을 못 찾은 참조(missing)가 하나라도 있으면 버린다',
      /refs\.some\(r => r && r\.kind === 'missing'\)/.test(SYN));
    ok('요지(gist)는 지어내지 않고 빈 문자열이다', /gist: '',/.test(SYN));
    ok('시행일자는 원문 조회 결과에서 온다', /effectiveDate: res\.effectiveDate \|\| '',/.test(SYN));
    ok('연락처는 lookupContact 를 재사용한다', /legalRetriever\.lookupContact\(c\.law\)/.test(SYN));
    ok('출처 구분 표시(synthesized)를 남긴다', /synthesized: true,/.test(SYN));
    ok('원문 조회 동시 상한이 4건 이하다', /const SYNTH_MAX_CONCURRENCY = 4;/.test(ROUTES_CODE));
    ok('보탠 줄은 발췌 단계에서 원문을 다시 읽지 않는다',
      /filter\(r => !\(r && r\.synthesized\)\)\.slice\(0, MAX_EXCERPT_ROWS\)/.test(ROUTES_CODE));
  }

  // ── 근거 목록 근접성 검사 (2026-08-18) — 무관한 줄은 걸러내되 누락은 만들지 않는다 ──────
  {
    const ANS = '「낚시 관리 및 육성법」 제25조제1항에 따라 신고합니다. 「선박직원법」 제2조제1호가목에 '
      + '따라 면허가 필요합니다. 위반하면 같은 법 제53조제2항제4호에 따라 처벌됩니다.';
    const row = (law, article, tier) => ({ law, article, tier });
    const pass = (law, article, tier) => R.filterCitationChainByAnswer(
      [row(law, article, tier)], ANS, '낚시 관리 및 육성법').length > 0;
    // 답변엔 「선박직원법」 제2조만 있고 낚시법 제2조는 없다 — 조문번호만 우연히 겹친 무관한 줄.
    ok('다른 법의 조문번호와 우연히 겹친 줄은 걸러낸다', !pass('낚시 관리 및 육성법', '제2조', 'law'));
    ok('그 조문의 진짜 주인은 남긴다', pass('선박직원법', '제2조', 'law'));
    ok('「법령명」과 붙어 인용된 줄은 남긴다', pass('낚시 관리 및 육성법', '제25조', 'law'));
    // ★누락 0: 아래 두 표기는 법 이름이 조문에 붙어 있지 않아 주인을 단정할 수 없다 — 버리지 않는다.
    ok('"같은 법 제N조" 이어쓰기는 버리지 않는다(주인 단정 불가)', pass('낚시 관리 및 육성법', '제53조', 'law'));
    ok('확정 인용이 없는 조문은 판정하지 않는다',
      R.filterCitationChainByAnswer([row('낚시 관리 및 육성법 시행령', '제16조', 'decree')],
        '「낚시 관리 및 육성법」 제25조에 따라 신고하고, 같은 법 시행령 제16조에서 요건을 정합니다.',
        '낚시 관리 및 육성법').length > 0);
    ok('「」로 인용된 적 없는 법의 줄은 판정하지 않는다(평문 언급만 있는 법)',
      R.filterCitationChainByAnswer([row('선박직원법', '제2조', 'law')],
        '「낚시 관리 및 육성법」 제25조에 따라 신고합니다. 선박직원법 제2조에 따른 면허도 필요합니다.',
        '낚시 관리 및 육성법').length > 0);
  }

  // ── 근거 아코디언 제거 · 시행일자/연락처 재배치 (2026-08-18 사용자 확정) ────────────────
  {
    ok('답변에 근거 법령 아코디언을 더 이상 그리지 않는다',
      !/근거 법령 \(펼쳐서 보기\)/.test(CLIENT_SRC));
    ok('citationChain 데이터 자체는 계속 받는다(본문 링크·서식의 재료)',
      /var chain = data\.citationChain \|\| \[\];/.test(CLIENT_SRC));
    ok('시행일자·소관부서는 답변 맨 끝 요약으로 남긴다',
      /if \(!data\.clarify\) html \+= sourceMetaHTML\(chain\);/.test(CLIENT_SRC));
    ok('요약은 지어내지 않는다 — 적을 것이 없는 법은 줄을 만들지 않는다',
      /if \(!tel && !eff\) return;/.test(CLIENT_SRC));
    ok('조문 팝업에도 그 조문의 소관부서를 보여준다',
      /telHost\.innerHTML = contactLineHTML\(\{/.test(CLIENT_SRC));
    ok('팝업이 쓸 연락처는 본문 링크에 data-* 로 심어 둔다(서버 재조회 없음)',
      /data-tel="' \+ esc\(ct\.전화번호 \|\| ''\)/.test(CLIENT_SRC));
    ok('폴백 경로(citeLaws)에도 연락처를 실어 보낸다',
      /contact: legalRetriever\.lookupContact\(c\.law\) \|\| null/.test(ROUTES_SRC));
  }

  // ── 하이브리드 본문 링크 (2026-08-18) — 근거 목록 우선, 답변 주소는 폴백 ────────────────
  {
    ok('서버가 답변 주소에서 뽑은 법 목록을 done 에 싣는다',
      /citationChain, forms, citeLaws, note/.test(ROUTES_SRC));
    ok('그 목록은 extractAnswerCitations(원문 확인을 거친 추출기)에서 온다',
      /function answerCiteLaws[\s\S]{0,400}legalRetriever\.extractAnswerCitations/.test(ROUTES_SRC));
    ok('화면은 폴백을 먼저 깔고 근거 목록으로 덮어쓴다(검증값 우선)',
      /\(citeLaws \|\| \[\]\)\.forEach[\s\S]{0,400}\(chain \|\| \[\]\)\.forEach/.test(CLIENT_SRC));
    ok('근거 목록 줄은 폴백 값을 덮어쓴다',
      /if \(hit && !hit\.fromChain\) \{ idx\[nm\] = made; return; \}/.test(CLIENT_SRC));
    ok('푸시 복원·기록 복원에도 함께 실린다',
      /citeLaws: entry\.citeLaws \|\| \[\]/.test(ROUTES_SRC) && /citeLaws: hit\.citeLaws \|\| \[\]/.test(CLIENT_SRC));
  }

  // ── 본문 조문 링크: baseLaw 차이만으로 링크를 죽이지 않는다 (2026-08-18 회귀 잠금) ──────
  //   근거 목록은 여러 위키 페이지의 줄을 합친 것이라 같은 법이라도 baseLaw(그 줄이 실려 있던
  //   페이지)가 다르다 — 특히 comparisons/ 페이지는 baseLaw 가 파일명이다. 예전엔 그 차이만으로
  //   ambiguous 를 세워 「낚시 관리 및 육성법」 같은 정상 법률 링크가 통째로 안 걸렸다(실사용 재현).
  {
    const IDX = CLIENT_SRC.slice(CLIENT_SRC.indexOf('function buildCiteIndex'),
      CLIENT_SRC.indexOf('function buildCiteIndex') + 2600);
    ok('tier 가 다르면 여전히 모호로 본다(엉뚱한 계층 원문을 열지 않는다)',
      /if \(hit\.tier !== tier\) \{ hit\.ambiguous = true; return; \}/.test(IDX));
    ok('baseLaw 차이는 **그 값이 실제로 쓰일 때만** 모호로 본다',
      /if \(hit\.base !== base && _baseMatters\(nm, tier\)\) hit\.ambiguous = true;/.test(IDX));
    ok('_baseMatters 는 고시·자기참조(이 법·시행령)에서만 true 다(서버 resolveBase 와 같은 규칙)',
      /function _baseMatters\(name, tier\) \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(tier === 'notice'\) return true;/.test(CLIENT_SRC));
    // ⚠ `시행령 별표1`(위키에 실제로 있는 표기)을 자기참조로 못 잡으면 서로 다른 법의 별표를
    //   같은 것으로 보아 엉뚱한 원문을 열 수 있다 — 서버 isSelfRef 와 같이 꼬리를 먼저 뗀다.
    ok('_baseMatters 가 별표·별지·서식 꼬리를 떼고 판정한다(서버 isSelfRef 와 동일)',
      /replace\(\/\\s\*\(\?:별표\|별지\|서식\)\[\^가-힣\]\*\$\/, ''\)/.test(CLIENT_SRC));
  }

  // ── sliceRelevant 회귀 잠금 (2026-08-17) — 이 로직에서 회귀가 두 번 재발했다:
  //    ①근거 조문이 뒤 순서라 예산 밀림 ②그 밀림을 고치다 rest 순서가 바뀌어 형사절차_일반.md
  //    "선고유예" 케이스가 다시 깨짐. 둘 다 실제 위키 파일로 재현한 케이스라 그대로 고정한다.
  {
    const WIKI = path.join(SRV, 'knowledge', 'legal', 'wiki');
    const bodyOf = p => fs.readFileSync(p, 'utf8').replace(/^---[\s\S]*?---\n/, '');

    const p1 = path.join(WIKI, 'concepts', '낚시관리및육성법__낚시어선업.md');
    const out1 = R.sliceRelevant(bodyOf(p1), ['구명뗏목', 'EPIRB', '비상탈출구'], 4000);
    ok('근거 조문은 다른 항상포함 절보다 우선순위가 높아 예산 경쟁에서 먼저 살아남는다',
      out1.includes('## 근거 조문'));

    const p2 = path.join(WIKI, 'comparisons', '형사절차_일반.md');
    const out2 = R.sliceRelevant(bodyOf(p2), ['선고유예'], 4000);
    ok('근거 조문 우선순위를 올려도 rest 순서(문서 등장 순)는 그대로라 질의 관련 절이 밀리지 않는다',
      out2.split('\n').some(l => l.startsWith('## 6.') && l.includes('선고유예')));
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();

});   // ← T26(§17) 이 끝난 뒤 T17 을 돌린다(Gemini stub 이 T17 의 "키 없음" 검사와 겹치지 않게)
