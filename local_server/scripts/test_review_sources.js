// ============================================================================
// test_review_sources.js — ★⚠수치검증 카드의 「원문 보기」를 못박는다. (2026-11-02 사용자 요청)
//
//   [왜 있나] 사용자 원문: "수치검증에 있는 이것에서 내가 검증하기 위해서는 해당 실제 원문을 보아야
//     하는데 원문을 볼 수있는 링크 또는 원문을 직접 해당 화면에서 볼 수 있도록 해주면 좋겠어."
//     카드 → 대상 페이지 「근거 조문」 표 → 줄마다 원문(조문 창) + 국가법령정보센터 주소.
//     관리자 화면은 **아무도 비명을 안 지르는 자리**라(_RULES §3ⓒ) 깨져도 모른다 — 그래서 못박는다.
//
//   [무엇을 못박나]
//    ① 대상 페이지 칸 읽기(pageRefsOf) — 설명이 섞인 칸 · `__` 줄임 · concepts 밖 폴더 · 폴더 밖 이름 거절
//    ② 법령정보센터 주소(lawGoLink) — 정식명일 때만 바로 가는 한글주소, 아니면 검색 · 고시는 행정규칙 검색
//    ③ ★실제 카드(review_queue.md 의 `REVIEW-선박평형수(船舶平衡水)관리법-806`)로 **라우트 처리 함수를 그대로**
//       불러 원문이 열리는지 — 서버를 띄우지 않고 routes/legal.js 의 처리 함수를 직접 부른다(test_llm_chain 과 같은 방식)
//    ④ `files` 표시 — 관리자 창에서만 고시 별표에 원본 PDF 주소가 붙고, 표시가 없으면 **지금과 같다**(챗봇 쪽 불변)
//    ⑤ 화면 HTML(reviewSourcesHTML) — 열쇠 data-* · 못 연 줄은 이유를 적고 단추 없음 · 빈 경우를 정직하게 · 이스케이프
//    ⑥ 관리자 창(z-index 10000) 위로 뜨는가 — CSS 값을 두 파일에서 읽어 비교한다
//
//   ⚠시각 비의존. 운영 파일에 쓰지 않는다(읽기 전용 경로만 부른다).
//   [연계] services/review_sources.js · routes/legal.js(GET /api/legal/reviews/:id/sources) ·
//          services/article_text.js(resolveRefs ⑤ wantFiles) · client/js/ai-chat/ai_chat.js(reviewSourcesHTML 등) ·
//          client/css/ai_chat.css(nrya-admin-layer) · scripts/refactor/verify_all.sh SUITES
// ============================================================================
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); }
};

const RS = require('../services/review_sources');
const REAL_ID = 'REVIEW-선박평형수(船舶平衡水)관리법-806';
const REAL_PAGE = 'wiki/concepts/선박평형수(船舶平衡水)관리법__항만국통제.md';

(async () => {
  console.log('\n── ① 대상 페이지 칸 읽기 ──');
  {
    const r = RS.pageRefsOf([REAL_PAGE + ' (사유가 적힌 자리: 본문 98행 — 머리말 review_reason 필드에서 온 경우 1행)']);
    ok('설명이 붙은 칸 → 쪽 하나', r.length === 1 && r[0].kind === 'concept' && r[0].file === '선박평형수(船舶平衡水)관리법__항만국통제', JSON.stringify(r));
    const r2 = RS.pageRefsOf(['wiki/concepts/어선법__A.md', '__B.md', '(8R 감사 gap remediation', '2026-07-21 발견)']);
    ok('`__B.md` 는 앞 쪽의 법을 물려받고, `.md` 없는 설명 조각은 버린다',
      r2.length === 2 && r2[1].file === '어선법__B' && r2[1].rel === 'wiki/concepts/어선법__B.md', JSON.stringify(r2));
    const r3 = RS.pageRefsOf(['wiki/statutes/물환경보전법.md (본문 인라인 마커 부착 완료)', 'wiki/comparisons/X__Y.md']);
    ok('concepts 밖 폴더(statutes·comparisons)도 받는다', r3.length === 2 && r3[0].kind === 'statute' && r3[1].kind === 'comparison', JSON.stringify(r3));
    const r4 = RS.pageRefsOf(['wiki/concepts/../../_dashboard/x.md', 'wiki/secret/a.md', '../a.md']);
    ok('★폴더 밖으로 나가는 이름·모르는 폴더는 받지 않는다', r4.length === 0, JSON.stringify(r4));
    ok('빈 값 → 빈 목록', RS.pageRefsOf(undefined).length === 0 && RS.pageRefsOf([]).length === 0);
  }

  console.log('\n── ② 법령정보센터 주소 ──');
  {
    const a = RS.lawGoLink({ law: '선박안전법', article: '제76조·제76조의2', tier: 'law' });
    ok('정식명 + 조 → 바로 가는 한글주소(첫 조)', a.direct && decodeURIComponent(a.url) === 'https://www.law.go.kr/법령/선박안전법/제76조', a.url);
    const b = RS.lawGoLink({ law: '시행규칙', article: '제18조의2', tier: 'rule', baseLaw: '선박평형수(船舶平衡水) 관리법' });
    ok('계층 낱말뿐인 칸은 쪽의 법을 붙인다 + `의N` 조', b.direct &&
      decodeURIComponent(b.url) === 'https://www.law.go.kr/법령/선박평형수(船舶平衡水) 관리법 시행규칙/제18조의2', b.url);
    const c = RS.lawGoLink({ law: '선박평형수(船舶平衡水) 관리법 시행규칙', article: '제44~46조', tier: 'rule' });
    ok('`제44~46조` 처럼 조 하나로 시작하지 않으면 법령 첫 화면', c.direct &&
      decodeURIComponent(c.url) === 'https://www.law.go.kr/법령/선박평형수(船舶平衡水) 관리법 시행규칙', c.url);
    const d = RS.lawGoLink({ law: '선박평형수 관리 등을 위한 기준', article: '별표12', tier: 'notice' });
    ok('고시 → 행정규칙 검색(법령 탭 검색은 행정규칙을 못 찾는다)', !d.direct && /admRulSc\.do\?menuId=5&subMenuId=41&query=/.test(d.url), d.url);
    const e = RS.lawGoLink({ law: '없는법이름테스트법', article: '제1조', tier: 'law' });
    ok('★정식명을 확인 못 한 이름은 한글주소 대신 검색(틀린 주소는 오류 쪽이 뜬다)', !e.direct && /lsSc\.do\?menuId=1&query=/.test(e.url), e.url);
    const f = RS.lawGoLink({ law: '「행정기본법」', article: '제36조', tier: 'law' });
    ok('낫표를 떼고 본다', f.direct && decodeURIComponent(f.url) === 'https://www.law.go.kr/법령/행정기본법/제36조', f.url);
  }

  console.log('\n── ③ 실제 카드로 라우트 처리 함수를 그대로 부른다 ──');
  const adminAuth = require('../services/admin_auth');
  adminAuth.verifyToken = (t) => t === 'good';
  const router = require('../routes/legal');
  const handler = (p) => {
    const layer = router.stack.find(l => l.route && l.route.path === p && l.route.methods.get);
    if (!layer) return null;
    const st = layer.route.stack;
    return st[st.length - 1].handle;
  };
  const call = (h, req) => new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, body: o }); } };
    Promise.resolve(h(req, res)).catch(e => resolve({ code: 'throw', body: String(e) }));
  });
  const list = handler('/api/legal/reviews');
  const src = handler('/api/legal/reviews/:id/sources');
  ok('라우트 GET /api/legal/reviews/:id/sources 가 있다', !!src);
  // 관리자 토큰 검사(router.use)는 이 라우트에도 걸리는가 — 등록 순서상 처리 함수보다 앞이어야 한다.
  {
    const gate = router.stack.findIndex(l => !l.route && l.regexp && l.regexp.test('/api/legal/reviews/x/sources'));
    const at = router.stack.findIndex(l => l.route && l.route.path === '/api/legal/reviews/:id/sources');
    ok('★관리자 토큰 검사가 이 라우트보다 먼저 걸린다', gate >= 0 && at > gate, `gate=${gate} route=${at}`);
  }
  let real = null;
  if (list && src) {
    const all = await call(list, { query: { status: 'all' } });
    real = ((all.body && all.body.reviews) || []).find(r => r.id === REAL_ID) || null;
    ok(`실제 카드 ${REAL_ID} 가 대기열에 있다`, !!real, '        review_queue.md 에서 이 카드가 사라졌으면 다른 실제 카드로 바꿔 적는다');
    const out = await call(src, { params: { id: REAL_ID } });
    const b = out.body || {};
    const pg = (b.pages || [])[0] || {};
    ok('그 카드의 대상 페이지를 찾았다', b.ok && pg.rel === REAL_PAGE && !pg.problem, JSON.stringify({ ok: b.ok, rel: pg.rel, problem: pg.problem }));
    const rows = pg.rows || [];
    ok('「근거 조문」 표의 줄을 다 실었다(19줄 — 2026-11-02 표 실측)', rows.length === 19, 'rows=' + rows.length);
    const bad = rows.filter(r => !(r.open && r.open.ok));
    ok('★줄마다 우리 원문이 실제로 열린다(조문 창과 같은 loadArticle)', rows.length > 0 && bad.length === 0,
      bad.map(r => r.law + ' ' + r.article + ' → ' + (r.open && r.open.reason)).join(' / '));
    const byl = rows.find(r => r.law === '선박평형수 관리 등을 위한 기준');
    ok('카드가 말하는 고시 별표12 줄이 있고 열린다', !!byl && byl.tier === 'notice' && /별표12/.test(byl.article) && byl.open.ok, JSON.stringify(byl && byl.open));
    ok('줄마다 쪽의 법(baseLaw)·법령정보센터 주소가 붙는다', rows.every(r => r.baseLaw && r.link && /^https:\/\/www\.law\.go\.kr\//.test(r.link.url)));
    const nf = await call(src, { params: { id: 'REVIEW-없는카드-0' } });
    ok('없는 카드 번호 → 404 + 이유', nf.code === 404 && nf.body && nf.body.ok === false && !!nf.body.error, JSON.stringify(nf));
  }
  {
    // 카드의 law 는 카드 번호에서 떼어 낸 이름(띄어쓰기 없음)이라 정식명이 아닐 수 있다 → 검색 주소.
    const none = await RS.buildReviewSources({ law: '선박평형수(船舶平衡水)관리법', targetPages: [] });
    ok('대상 페이지가 없는 카드 → 쪽 0 + 그 법 찾기 주소', none.pages.length === 0 && /lsSc\.do\?menuId=1&query=/.test(none.lawSearch.url), JSON.stringify(none.lawSearch));
    const gone = await RS.buildReviewSources({ law: '어선법', targetPages: ['wiki/concepts/어선법__없는쪽이름테스트.md'] });
    ok('쪽 파일이 없으면 problem=no_file(빈 목록으로 숨기지 않는다)', gone.pages.length === 1 && gone.pages[0].problem === 'no_file', JSON.stringify(gone.pages));
  }

  console.log('\n── ④ files 표시 — 관리자 창에서만 원본 PDF 주소 ──');
  {
    const A = require('../services/article_text');
    const q = { law: '선박평형수 관리 등을 위한 기준', article: '별표12(제11조)', tier: 'notice', baseLaw: '선박평형수(船舶平衡水)관리법' };
    const plain = await A.loadArticle(q);
    const withF = await A.loadArticle(Object.assign({ files: true }, q));
    const r0 = (plain.refs || []).find(r => r.key === '별표12') || {};
    const r1 = (withF.refs || []).find(r => r.key === '별표12') || {};
    ok('표시 없음(챗봇) — 지금과 같다: 별표 글은 있고 원본 주소는 안 찾는다', r0.kind === 'text' && !r0.pdf && !r0.hwp, JSON.stringify({ kind: r0.kind, pdf: r0.pdf }));
    ok('★files:true(관리자) — 같은 별표 글 + 원본 PDF 주소', r1.kind === 'text' && r1.body === r0.body && /flDownload\.do\?flSeq=148633769/.test(r1.pdf || ''), JSON.stringify({ kind: r1.kind, pdf: r1.pdf }));
  }

  console.log('\n── ⑤ 화면 HTML ──');
  const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'ai-chat', 'ai_chat.js'), 'utf8');
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
  function varSrc(name) {
    const at = SRC.indexOf('var ' + name + ' = {');
    if (at < 0) throw new Error('변수를 못 찾음: ' + name);
    return SRC.slice(at, SRC.indexOf('};', at) + 2);
  }
  let H = null;
  try {
    H = new Function([
      'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}',
      varSrc('REVIEW_OPEN_WHY'), fnSrc('tierLabel'), fnSrc('displayLawName'), fnSrc('reviewSourcesHTML'),
      'return { reviewSourcesHTML: reviewSourcesHTML };',
    ].join('\n'))();
  } catch (e) { ok('화면 함수를 떼어 온다', false, e && e.message); }
  if (H) {
    const XSS = '<script>alert(1)</script>';
    const html = H.reviewSourcesHTML({ pages: [{ rel: 'wiki/concepts/A__B.md', problem: '', rows: [
      { law: '시행규칙', article: '제3조', tier: 'rule', baseLaw: '어선법', step: '① 신고', gist: XSS,
        contact: { 소관부처명: '해양수산부', 부서명: '어선정책과', 전화번호: '044-200-0000' },
        open: { ok: true }, link: { url: 'https://www.law.go.kr/x', direct: true } },
      { law: '어딘가 고시', article: '별표9', tier: 'notice', baseLaw: '어선법', open: { ok: false, reason: 'file_not_found' },
        link: { url: 'https://www.law.go.kr/admRulSc.do?q', direct: false } },
    ] }] });
    ok('열리는 줄 → 조문 창 열쇠(data-law·article·tier·base) + data-files="1"',
      /class="nrya-rv-open" data-law="시행규칙" data-lawshow="어선법 시행규칙" data-article="제3조" data-tier="rule" data-base="어선법"/.test(html) && /data-files="1"/.test(html), html.slice(0, 400));
    ok('연락처도 조문 창에 넘긴다(data-min·dept·tel)', /data-min="해양수산부" data-dept="어선정책과" data-tel="044-200-0000"/.test(html));
    ok('★못 연 줄 → 단추 없이 이유를 적는다', /못 열어요 — 이 고시·계층의 원문 파일을 찾지 못했어요/.test(html) && (html.match(/class="nrya-rv-open"/g) || []).length === 1);
    ok('바로 가는 주소는 「열기」, 검색 주소는 「찾기」', /법령정보센터에서 열기/.test(html) && /법령정보센터에서 찾기/.test(html));
    ok('★위키 글은 이스케이프된다', html.indexOf('<script>') < 0 && html.indexOf('&lt;script&gt;') >= 0);
    const nc = H.reviewSourcesHTML({ pages: [{ rel: 'x.md', problem: '', rows: [{ law: '어선법', article: '제1조', tier: 'law', open: { ok: false, reason: 'not_checked' }, link: null }] }] });
    ok('미리 열어 보지 않은 줄 → 단추는 주되 「미리 확인하지 않은 줄」이라 적는다', /class="nrya-rv-open"/.test(nc) && /미리 확인하지 않은 줄/.test(nc));
    const empty = H.reviewSourcesHTML({ pages: [], lawSearch: { url: 'https://www.law.go.kr/lsSc.do?menuId=1&query=x', direct: false } });
    ok('대상 페이지가 없으면 그렇다고 적고 「이 법 찾기」를 준다', /대상 페이지가 적혀 있지 않아/.test(empty) && /이 법 찾기/.test(empty));
    const nt = H.reviewSourcesHTML({ pages: [{ rel: 'wiki/concepts/X.md', problem: 'no_table', rows: [] }, { rel: 'wiki/concepts/Y.md', problem: 'no_file', rows: [] }], lawSearch: { url: 'u' } });
    ok('표 없음·파일 없음을 각각 적는다', /「근거 조문」 표가 없어/.test(nt) && /파일을 찾지 못했어요/.test(nt) && /이 법 찾기/.test(nt));
  }
  {
    const card = fnSrc('reviewCardHTML');
    ok('카드(대기·승인 둘 다)에 「원문 보기」 단추와 펼칠 자리가 있다', (card.match(/class="nrya-btn-src"/g) || []).length === 2 && (card.match(/nrya-rv-srcbox/g) || []).length === 2);
    ok('bindReviewCard 가 단추를 toggleReviewSources 에 잇는다', /\.nrya-btn-src[\s\S]{0,200}toggleReviewSources\(id, srcBtn, srcBox\)/.test(fnSrc('bindReviewCard')));
    const tg = fnSrc('toggleReviewSources');
    ok('펼친 목록의 [원문 펼치기] → 관리자 층 표시 + openArtPop', /nrya-admin-layer[\s\S]{0,80}openArtPop\(b\)/.test(tg) && /\/sources'/.test(tg));
    ok('openArtPop 이 data-files="1" 을 files=1 로 넘긴다', /data-files'\) === '1' \? '&files=1'/.test(fnSrc('openArtPop')));
    ok('closeArtPop 이 관리자 층 표시를 뗀다', /classList\.remove\('nrya-admin-layer'\)/.test(fnSrc('closeArtPop')));
  }

  console.log('\n── ⑥ 관리자 창 위로 뜨는가 ──');
  {
    const css = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'css', 'ai_chat.css'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'style.css'), 'utf8');
    const modal = /#unified-admin-modal\s*\{[^}]*z-index:\s*(\d+)/.exec(main);
    const zOf = (sel) => { const m = new RegExp('#nrya-overlays\\.nrya-admin-layer \\.' + sel + '\\{z-index:(\\d+)\\}').exec(css); return m ? Number(m[1]) : -1; };
    const zs = ['nrya-artpop-veil', 'nrya-artpop', 'nrya-bylpop-veil', 'nrya-bylpop'].map(zOf);
    ok('★조문 창·별표 창이 관리자 창(z-index ' + (modal && modal[1]) + ')보다 위', !!modal && zs.every(z => z > Number(modal[1])) && zs[0] < zs[1] && zs[1] < zs[2] && zs[2] < zs[3], JSON.stringify(zs));
  }

  console.log(`\n  ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  ❌ FAIL: 시험이 던졌다 —', e && e.stack); console.log(`\n  ${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
