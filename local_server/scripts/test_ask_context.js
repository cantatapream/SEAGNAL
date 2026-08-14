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
  ok('검색어 보강도 붙일 게 없으면 원 질의 그대로(routes 계약)',
    /const qForSearch = narrowLabels\.length \? q \+ ' ' \+ narrowLabels\.join\(' '\) : q;/.test(ROUTES_SRC));
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
    /input\.value = q;\s*\n\s*doSend\(mergeCtx\(lastCtx, ctx\), box\);/.test(CLIENT_SRC));
}

// ── T6 [#7]. 기록에서 복원한 답변에는 되묻기 버튼이 안 생긴다 ─────────────────────
console.log('\n[T6][#7] 기록 복원 답변 — clarify 가 없어 버튼이 안 붙는다');
{
  ok('복원 렌더에 clarify 를 넘기지 않는다',
    /renderRestoredAnswer\(\{ ok: true, query: hit\.q, answer: hit\.a, sources: \[\], note: hit\.note \}\)/.test(CLIENT_SRC));
  ok('기록에는 질문·답변·note 만 저장(ctx·프로필 미저장)',
    /arr\.push\(\{ q: String\(q \|\| ''\), a: String\(\(data && data\.answer\) \|\| ''\), note:/.test(CLIENT_SRC));
}

// ── T7 [#8]. R1 — ctx·profile 은 로그·임시보관 어디에도 안 쓴다 ─────────────────
console.log('\n[T7][#8] R1 — 프로필이 서버 파일에 남지 않는다');
{
  ok('pendingAnswers.store 인자에 ctx·profile 없음',
    /pendingAnswers\.store\(q, answer, sourcesOut, note, citationChain\)/.test(ROUTES_SRC));
  ok('새 지식 후보 로그도 질의·원문만 넘긴다', /logKnowledgeCandidate\(q, raw\)/.test(ROUTES_SRC));
  ok('신규 절이 파일을 쓰지 않는다(읽기 전용)', !/writeFile|appendFile/.test(H37_CODE));
  ok('신규 절이 콘솔로도 안 흘린다', !/console\.(log|error|warn)/.test(H37_CODE));
}

// ── T8 [#9]. 전송 실패 시 되묻기 버튼을 다시 누를 수 있다 ────────────────────────
console.log('\n[T8][#9] 네트워크 실패 → nrya-done 되돌리기(재시도 가능)');
{
  ok('실패 응답이면 카드 비활성을 해제한다',
    /if \(failBox && data && data\._neterr\) failBox\.classList\.remove\('nrya-done'\);/.test(CLIENT_SRC));
  ok('버튼 클릭 경로가 실패 대상 카드를 넘긴다', /doSend\(lastCtx, box\);/.test(CLIENT_SRC) && /doSend\(mergeCtx\(lastCtx, ctx\), box\);/.test(CLIENT_SRC));
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
    ROUTES_SRC.indexOf('zoneTreeStep(legalRetriever.zoneQueryWithProfile') < ROUTES_SRC.indexOf('decideClarify(q, contextPages)'));
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
  ok('내부 프롬프트 지침(RAW_ANSWER_RULES 규칙9)은 유지(화면 꼬리표가 아니다)',
    RET_SRC.includes('9. ★이 답변은 "미검증 참고"다.'));
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
  ok('done 응답 전부(확인카드·트리·되묻기·최종답변)에 ctxNext 를 붙인다',
    (ROUTES_CODE.match(/withCtxNext\(/g) || []).length === 4,
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
  ok('ctx 없는 선택지도 직전 맥락을 이어 보낸다', /doSend\(lastCtx, box\);/.test(CLIENT_SRC));
  ok('버튼 ctx 는 직전 맥락 **위에** 축 단위로 얹는다',
    /doSend\(mergeCtx\(lastCtx, ctx\), box\);/.test(CLIENT_SRC));
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

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
