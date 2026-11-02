/**
 * test_legal_ask_stats.js — 나리야 질문 수 날짜별 집계(services/legal_ask_stats.js)와 /api/legal/ask 연결을 고정한다.
 *
 * 왜 있나: 사용자 확정(2026-11-02) — 「질문 수를 날짜(KST)별로, 1년 보관, 관리자 센터에서. 내용은 저장 안 하고 숫자만」.
 *   ① 집계 칸(전체·관리자/일반·AI별·실패·되묻기) ② KST 자정 경계 ③ 365일 정리 ④ 다시 불러와도 유지
 *   ⑤ 손상 파일 → 빈 상태 ⑥ 라우트 연결 — 되묻기를 거친 질문이 **두 번 세지지 않는가**, 답한 AI 가 맞게 들어가는가.
 *   시각 의존 금지: 모든 시각은 고정값을 주입한다(⑥은 Date.now 를 고정값으로 바꿔 끼운다).
 *   저장 파일은 임시 폴더(LEGAL_ASK_STATS_FILE)로 돌려 운영 data/ 를 안 건드린다 — 끝에 운영 파일이 새로 생겼는지 확인한다.
 *   ⑥은 서버를 띄우지 않고 라우터의 처리 함수를 직접 부른다. 검색·AI 단계는 가짜로 바꿔 끼운다(네트워크 없음).
 *
 * [연계] → services/legal_ask_stats.js · routes/legal.js(POST /api/legal/ask · GET /api/legal/admin/ask-stats)
 *          · services/codex_bridge.js(withRequest — 사슬 요청 범위) · scripts/refactor/verify_all.sh(SUITES)
 * 쓰는 법: node local_server/scripts/test_legal_ask_stats.js
 */
'use strict';
delete process.env.NRYA_CODEX_SECRET;
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROD_FILE = path.join(__dirname, '..', 'data', 'legal_ask_stats.json');
const prodBefore = fs.existsSync(PROD_FILE) ? fs.statSync(PROD_FILE).mtimeMs : null;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'legal_ask_stats_test_'));
const SVC = require.resolve('../services/legal_ask_stats');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
/** 저장 파일을 바꿔 서비스 모듈을 새로 불러온다(재시작 흉내). */
function fresh(file) {
  process.env.LEGAL_ASK_STATS_FILE = file;
  delete require.cache[SVC];
  return require(SVC);
}
const T = (s) => Date.parse(s);   // ISO(+09:00) → ms

(async () => {
  console.log('── ①~② 집계 · KST 자정 경계 ──');
  const FA = path.join(DIR, 'a.json');
  let S = fresh(FA);
  ok('저장 파일 경로가 임시 폴더', S.FILE === FA, S.FILE);
  const DAY1 = '2026-11-01T23:59:59+09:00';   // = 14:59:59Z → KST 11-01
  const DAY2 = '2026-11-02T00:00:00+09:00';   // = 15:00:00Z(11-01 UTC) → KST 11-02
  S.record({ admin: false, outcome: 'answered', ai: 'claude2', now: T(DAY1) });
  S.record({ admin: true, outcome: 'answered', ai: 'gemini', now: T(DAY2) });
  S.record({ admin: false, outcome: 'failed', now: T(DAY2) });
  S.record({ admin: false, outcome: 'clarify', now: T(DAY2) });
  S.record({ admin: false, outcome: 'answered', ai: 'rule', now: T(DAY2) });
  const NOW = T('2026-11-02T12:00:00+09:00');
  let sm = S.summary(NOW);
  const d1 = sm.days.find(d => d.date === '2026-11-01'), d2 = sm.days.find(d => d.date === '2026-11-02');
  ok('KST 23:59:59 는 그날(11-01)', d1 && d1.total === 1 && d1.user === 1 && d1.ai.claude2 === 1, JSON.stringify(d1));
  ok('KST 00:00:00 은 다음 날(11-02) — UTC 날짜(11-01)가 아니다', d2 && d2.total === 3, JSON.stringify(d2));
  ok('칸: 관리자 1·일반 2·실패 1·gemini 1·rule 1', d2.admin === 1 && d2.user === 2 && d2.failed === 1 && d2.ai.gemini === 1 && d2.ai.rule === 1, JSON.stringify(d2));
  ok('되묻기는 clarify 칸에만(전체에 안 더함)', d2.clarify === 1 && d2.total === 3, JSON.stringify(d2));
  ok('total = admin + user = failed + AI 합', d2.total === d2.admin + d2.user && d2.total === d2.failed + Object.values(d2.ai).reduce((a, b) => a + b, 0));
  ok('날짜별 목록은 최신 먼저', sm.days[0].date === '2026-11-02' && sm.days[1].date === '2026-11-01');
  ok('오늘 합계 = 11-02, 어제 = 11-01', sm.today === '2026-11-02' && sm.sums.today.total === 3 && sm.sums.yesterday.total === 1, JSON.stringify(sm.sums));
  S.record({ admin: false, outcome: 'answered', ai: 'upstage', now: T('2026-10-27T10:00:00+09:00') });   // 6일 전 → 7일 안
  S.record({ admin: false, outcome: 'answered', ai: 'upstage', now: T('2026-10-26T10:00:00+09:00') });   // 7일 전 → 7일 밖·30일 안
  S.record({ admin: false, outcome: 'answered', ai: 'chatgpt', now: T('2026-10-03T23:00:00+09:00') });   // 30일 전 → 30일 밖
  sm = S.summary(NOW);
  ok('7일 = 오늘 포함 7일(10-27 들어감·10-26 빠짐)', sm.sums.d7.total === 5 && sm.sums.d7.ai.upstage === 1, JSON.stringify(sm.sums.d7));
  ok('30일 = 오늘 포함 30일(10-26 들어감·10-03 빠짐)', sm.sums.d30.total === 6 && sm.sums.d30.ai.chatgpt === 0, JSON.stringify(sm.sums.d30));
  ok('모르는 AI 이름은 AI 칸에 안 들어감(전체는 셈)', (() => { S.record({ admin: false, outcome: 'answered', ai: 'zzz', now: T('2026-09-01T10:00:00+09:00') }); const x = S.summary(NOW).days.find(d => d.date === '2026-09-01'); return x.total === 1 && !('zzz' in x.ai); })());
  sm = S.summary(NOW);
  ok('총계(all) = 보관 중 모든 날짜의 합 — 30일 밖(10-03·09-01)도 들어감(8건)', sm.sums.all.total === 8 && sm.sums.all.total === sm.days.reduce((n, d) => n + d.total, 0) && sm.sums.all.ai.chatgpt === 1 && sm.sums.all.clarify === 1, JSON.stringify(sm.sums.all));
  ok('질문 내용을 담는 칸이 없다(파일에 숫자만)', !/"(q|query|text|answer)"/.test(fs.readFileSync(FA, 'utf8')));

  console.log('\n── ③ 365일 정리 ──');
  const FP = path.join(DIR, 'p.json');
  S = fresh(FP);
  S.record({ admin: false, outcome: 'answered', ai: 'gemini', now: T('2025-11-02T23:59:00+09:00') });   // 365일 전 → 지움
  S.record({ admin: false, outcome: 'answered', ai: 'gemini', now: T('2025-11-03T00:00:00+09:00') });   // 364일 전 → 남김
  const P_NOW = T('2026-11-02T08:00:00+09:00');
  sm = S.summary(P_NOW);
  ok('오늘 − 364일(2025-11-03)은 남고 그 전날(2025-11-02)은 지운다', sm.days.map(d => d.date).join() === '2025-11-03', JSON.stringify(sm.days.map(d => d.date)));
  S.record({ admin: false, outcome: 'answered', ai: 'gemini', now: P_NOW });
  const onDisk = JSON.parse(fs.readFileSync(FP, 'utf8'));
  ok('정리 결과가 파일에도 남는다(지운 날짜 없음)', !('2025-11-02' in onDisk.days) && '2025-11-03' in onDisk.days && '2026-11-02' in onDisk.days, JSON.stringify(Object.keys(onDisk.days)));

  console.log('\n── ④ 다시 불러오기 · ⑤ 손상 파일 ──');
  S = fresh(FA);
  const re = S.summary(NOW).days.find(d => d.date === '2026-11-02');
  ok('다시 불러와도 숫자 유지(11-02 전체 3·되묻기 1)', re && re.total === 3 && re.clarify === 1 && re.ai.rule === 1, JSON.stringify(re));
  const errs = [];
  const realErr = console.error;
  console.error = (...a) => { errs.push(a.join(' ')); };
  fs.writeFileSync(FA, '{"version":1,"days":{"2026-11-02":');   // 반쯤 쓰다 만 파일
  S = fresh(FA);
  const broken = S.summary(NOW);
  ok('손상 파일 → 빈 상태 + 로그', broken.days.length === 0 && broken.sums.d30.total === 0 && errs.some(e => /저장 파일 읽기 실패/.test(e)), JSON.stringify(errs));
  S.record({ admin: false, outcome: 'answered', ai: 'gemini', now: NOW });
  ok('손상 뒤 새로 세면 정상 JSON 으로 다시 쓴다', JSON.parse(fs.readFileSync(FA, 'utf8')).days['2026-11-02'].total === 1);
  fs.writeFileSync(FA, '[]');
  errs.length = 0;
  ok('JSON 이지만 엉뚱한 모양([]) → 빈 상태 + 로그', fresh(FA).summary(NOW).days.length === 0 && errs.some(e => /모양이 틀림/.test(e)), JSON.stringify(errs));
  fs.writeFileSync(FA, JSON.stringify({ days: { '2026-11-02': { total: -3, admin: 'x', ai: { gemini: 2.5, claude1: 4 } }, 'bad-key': { total: 9 } } }));
  const odd = fresh(FA).summary(NOW);
  ok('모양 틀린 숫자는 0, 날짜 꼴 아닌 키는 버림', odd.days.length === 1 && odd.days[0].total === 0 && odd.days[0].ai.gemini === 0 && odd.days[0].ai.claude1 === 4, JSON.stringify(odd.days));
  console.error = realErr;

  console.log('\n── ⑥ 라우트 연결(POST /api/legal/ask · GET /api/legal/admin/ask-stats) ──');
  const FR = path.join(DIR, 'r.json');
  S = fresh(FR);                                   // 라우터가 이 인스턴스를 물도록 먼저 불러 둔다
  const adminAuth = require('../services/admin_auth');
  adminAuth.verifyToken = (t) => t === 'good';
  const bridge = require('../services/codex_bridge');
  const R = require('../services/legal_retriever');
  const router = require('../routes/legal');
  ok('라우터가 같은 집계 인스턴스(임시 파일)를 쓴다', require(SVC) === S && S.FILE === FR);
  const askRoute = router.stack.find(l => l.route && l.route.path === '/api/legal/ask' && l.route.methods.post).route;
  const handle = askRoute.stack[askRoute.stack.length - 1].handle;

  // 가짜 검색·AI 단계(네트워크·파일 쓰기 없음). 기본: 되묻기 없음 · 근거 1건 · 답변 한 조각.
  const plan = {};
  const reset = () => Object.assign(plan, {
    zone: null, clarify: { needed: false }, ctxPages: [{ file: 'x', law: '가짜법', body: '가짜' }],
    stream: ['가짜 답변'], usedBy: null, searchThrows: false,
  });
  R.understandConfirmStep = async () => null;
  R.zoneTreeStep = () => plan.zone;
  R.splitLawStep = () => null;
  R.search = async () => { if (plan.searchThrows) throw new Error('가짜 검색 오류'); return { sources: [], contextPages: plan.ctxPages }; };
  R.scopeNarrowStep = () => null;
  R.explainClarifyStep = async () => null;
  R.decideClarify = async () => plan.clarify;
  R.profileConfirmStep = () => ({ mode: 'none' });
  R.synthesizeAnswerStream = async function* () {
    const s = bridge.store();
    for (const t of plan.stream) { if (s && s.chain && plan.usedBy) s.used = plan.usedBy; yield t; }
  };
  R.searchRawFallback = async () => null;
  R.naverTermStep = async () => null;

  const mkRes = () => ({
    headersSent: false, code: 200, out: [], headers: {},
    setHeader(k, v) { this.headers[k] = v; }, flushHeaders() { this.headersSent = true; },
    write(s) { this.headersSent = true; this.out.push(s); }, end() { this.ended = true; },
    status(c) { this.code = c; return this; }, json(o) { this.body = o; this.ended = true; },
  });
  // cfg 는 codex_bridge.withRequest 에 넘기는 관리자 센터 설정 — codexForUsers:true 면 사슬 요청 범위가 열린다.
  const ask = async (body, token, cfg) => {
    const req = { body, get: (h) => (h === 'X-Admin-Token' ? token : undefined) };
    const res = mkRes();
    await bridge.withRequest(req, res, () => handle(req, res), cfg || {});
    return res;
  };
  const FIXED = T('2026-11-02T09:00:00+09:00');
  const realNow = Date.now;
  Date.now = () => FIXED;
  const today = () => S.summary(FIXED).sums.today;
  try {
    reset();
    let r = await ask({ query: '' });
    ok('빈 질의(400)는 안 센다', r.code === 400 && today().total === 0 && today().clarify === 0, JSON.stringify(today()));

    plan.clarify = { needed: true, question: '어떤 배인가요?', options: [{ label: '낚시어선' }, { label: '여객선' }] };
    r = await ask({ query: '음주 처벌' });
    const c1 = today();
    ok('AI 되묻기로 끝난 요청 → clarify 1 · 전체 0', /"clarify"/.test(r.out.join('')) && c1.clarify === 1 && c1.total === 0, JSON.stringify(c1));
    plan.clarify = { needed: false };
    r = await ask({ query: '음주 처벌 — 낚시어선', ctx: { cl: { q: '어떤 배인가요?', labels: ['낚시어선', '여객선'], n: 1 } } });
    const c2 = today();
    ok('되묻기에 답해 온 같은 질문 → 전체 1(두 번 안 셈)·일반 1·gemini 1', c2.total === 1 && c2.user === 1 && c2.ai.gemini === 1 && c2.clarify === 1, JSON.stringify(c2));
    ok('답변 끝 표시줄도 Gemini(같은 판정)', /Gemini/.test(r.out.join('')));

    plan.usedBy = 'claude2';
    r = await ask({ query: '낚시어선 신고' }, 'good');
    const c3 = today();
    ok('관리자 + 사슬 요청 → 관리자 1 · claude2 1(마지막에 답한 AI)', c3.admin === 1 && c3.ai.claude2 === 1 && c3.total === 2, JSON.stringify(c3));
    ok('답변 끝 표시줄과 같은 AI(Claude)', /Claude Sonnet/.test(r.out.join('')));

    plan.usedBy = 'upstage';
    await ask({ query: '어선 등록' }, undefined, { codexForUsers: true });
    ok('일반 사용자 + codexForUsers 켜짐(사슬) → upstage 1', today().ai.upstage === 1 && today().user === 2, JSON.stringify(today()));

    reset();
    plan.ctxPages = [];
    r = await ask({ query: '근거 없는 질문' });
    ok('근거 0건 → 답 없음 → 실패 1', today().failed === 1 && today().total === 4 && /찾지 못했습니다/.test(r.out.join('')), JSON.stringify(today()));

    reset();
    plan.stream = [];
    await ask({ query: '생성 실패 질문' });
    ok('근거는 있는데 답 생성이 빈손 → 실패 2', today().failed === 2 && today().total === 5, JSON.stringify(today()));

    reset();
    plan.searchThrows = true;
    r = await ask({ query: '오류 질문' });
    ok('처리 중 오류(500) → 실패 3, 한 번만', r.code === 500 && today().failed === 3 && today().total === 6, JSON.stringify(today()));

    reset();
    plan.zone = { answer: '트리 답', note: '' };
    await ask({ query: '우리 배 어디까지' });
    ok('해역 트리 답(AI 없음) → rule 1', today().ai.rule === 1 && today().total === 7, JSON.stringify(today()));
    plan.zone = { answer: '어느 쪽?', note: '', clarify: { question: '어디?', options: [{ label: 'A' }] } };
    await ask({ query: '우리 배 어디까지' });
    ok('해역 트리 되묻기 → clarify 2 · 전체 그대로 7', today().clarify === 2 && today().total === 7, JSON.stringify(today()));

    const t = today();
    ok('합 맞음: total = admin + user = failed + AI 합', t.total === t.admin + t.user && t.total === t.failed + Object.values(t.ai).reduce((a, b) => a + b, 0), JSON.stringify(t));

    const getRoute = router.stack.find(l => l.route && l.route.path === '/api/legal/admin/ask-stats' && l.route.methods.get).route;
    ok('조회 API 는 관리자 토큰 검사(requireAdminToken)를 앞에 둔다', getRoute.stack.length === 2 && getRoute.stack[0].handle === adminAuth.requireAdminToken);
    const g = mkRes();
    getRoute.stack[getRoute.stack.length - 1].handle({ get: () => undefined }, g, () => {});
    ok('GET /api/legal/admin/ask-stats → ok · 일별 목록 · 오늘/어제/7일/30일', g.body && g.body.ok && Array.isArray(g.body.days) && g.body.sums.today.total === 7 && 'yesterday' in g.body.sums && 'd7' in g.body.sums && g.body.sums.d30.total === 7, JSON.stringify(g.body && g.body.sums));
    ok('GET 응답에 총계 sums.all(「총 N건」) — 이 파일엔 오늘만 있어 7', g.body && g.body.sums && g.body.sums.all && g.body.sums.all.total === 7, JSON.stringify(g.body && g.body.sums && g.body.sums.all));
    ok('라우트가 쓴 숫자가 임시 파일에 남는다', JSON.parse(fs.readFileSync(FR, 'utf8')).days['2026-11-02'].total === 7);
  } finally {
    Date.now = realNow;
  }

  const prodAfter = fs.existsSync(PROD_FILE) ? fs.statSync(PROD_FILE).mtimeMs : null;
  ok('운영 data/legal_ask_stats.json 을 건드리지 않았다', prodAfter === prodBefore, `전 ${prodBefore} 후 ${prodAfter}`);
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n  ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n  ${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
