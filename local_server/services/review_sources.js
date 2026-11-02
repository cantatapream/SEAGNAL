/**
 * ============================================================================
 * 파일명: services/review_sources.js
 * 역할  : 관리자 「⚠수치검증」 카드 한 장이 **어떤 법령 원문을 보면 되는지** 찾아 준다.
 *         카드의 「대상 페이지」(위키) → 그 쪽의 「## 근거 조문」 표 → 줄마다 우리 원문이 열리는지와
 *         국가법령정보센터 주소를 붙여 돌려준다. (초보자용: 관리자가 승인·기각을 판단하려면 실제 법령
 *         원문을 봐야 하는데, 카드에는 AI 분석 글과 위키 경로만 있었다 — 이 파일이 그 사이를 잇는다.)
 * ----------------------------------------------------------------------------
 * [왜 「근거 조문」 표인가 — 새로 짜지 않고 이미 있는 길을 쓴다(L-136·L-147)]
 *  - 챗봇 답변의 근거 목록(조문 창)이 **이 표**를 `legal_retriever.extractCitationChain` 으로 읽어
 *    `article_text.loadArticle` 로 원문을 연다. 카드의 대상 페이지도 같은 위키 쪽이므로 같은 두 함수를
 *    그대로 부른다 — 표를 다시 파싱하거나 원문 찾는 법을 새로 적지 않는다.
 *  - 화면도 챗봇의 조문 창(`openArtPop`)·별표 창을 그대로 띄운다(client/js/ai-chat/ai_chat.js).
 * [정직하게 — 못 찾은 것은 못 찾았다고(L-291)]
 *  - 대상 페이지가 안 적혔거나 파일이 없거나 표가 없으면 그 사실을 `pages[].problem` 으로 돌려준다.
 *  - 줄마다 `open` 에 실제로 원문을 열어 본 결과(ok/reason)를 싣는다 — 「누르면 될 것 같다」가 아니다.
 * [연계]
 *  - 사용하는 파일 : services/legal_retriever.js(loadIndex·readPage·extractCitationChain·lookupContact·loadLawAliases)
 *                    services/article_text.js(loadArticle — 조문 창이 쓰는 그 함수)
 *  - 서버 API      : routes/legal.js 의 GET /api/legal/reviews/:id/sources 가 buildReviewSources 를 부른다
 *  - 나를 쓰는 곳  : routes/legal.js · 시험 scripts/test_review_sources.js
 * ============================================================================
 */
'use strict';

const legalRetriever = require('./legal_retriever');
const articleText = require('./article_text');

// 위키 폴더 이름 → index.json 의 kind (legal_retriever.readPage 가 kind 로 폴더를 고른다)
const DIR_KIND = { concepts: 'concept', statutes: 'statute', comparisons: 'comparison', annexes: 'annex', activities: 'activity' };
// 한 카드에서 원문을 열어 볼 줄 수 상한 — 근거 조문 표는 길어야 20여 줄이다(넘으면 뒤는 「안 열어 봄」으로 둔다).
const MAX_OPEN_CHECK = 60;
const LAWGO = 'https://www.law.go.kr';

/**
 * 카드의 「대상 페이지」 칸 값들을 실제 위키 쪽(kind·file)으로 바꾼다.
 * 칸에는 설명이 섞여 있다 — `wiki/concepts/A__B.md (사유가 적힌 자리: 본문 98행 …)`,
 * 법 접두를 줄인 `__C.md`(바로 앞 쪽의 법을 물려받는다), 쉼표로 쪼개져 들어온 설명 조각
 * (`(8R 감사 gap remediation` 등). `.md` 가 없는 조각은 쪽이 아니므로 건너뛴다.
 * 승인 처리(routes/legal.js applyToWikiPages)와 같은 규칙(접두 제거 · `.md` 뒤 설명 자르기 · `__` 상속)에
 * concepts 밖의 폴더(statutes·comparisons·annexes·activities)도 받는다.
 * 예: pageRefsOf(['wiki/concepts/어선법__A.md (신규)', '__B.md'])
 *     → [{kind:'concept', file:'어선법__A', rel:'wiki/concepts/어선법__A.md'}, {kind:'concept', file:'어선법__B', rel:'wiki/concepts/어선법__B.md'}]
 * @param {string[]} targetPages - GET /api/legal/reviews 의 targetPages
 * @returns {Array<{kind:string, file:string, rel:string}>}
 * [연계] ← buildReviewSources.
 */
function pageRefsOf(targetPages) {
  const out = [];
  let lastLaw = '', lastDir = 'concepts';
  for (const raw of targetPages || []) {
    const m = /^(?:wiki\/([a-z]+)\/)?(\S+?)\.md\b/.exec(String(raw || '').trim());
    if (!m) continue;
    const dir = m[1] || lastDir;
    if (!DIR_KIND[dir]) continue;
    let file = m[2];
    if (file.startsWith('__') && lastLaw) file = lastLaw + file;
    else lastLaw = file.split('__')[0];
    lastDir = dir;
    if (/[\\/]|\.\./.test(file)) continue;             // 폴더 밖으로 나가는 이름은 받지 않는다
    if (out.some(p => p.kind === DIR_KIND[dir] && p.file === file)) continue;
    out.push({ kind: DIR_KIND[dir], file, rel: 'wiki/' + dir + '/' + file + '.md' });
  }
  return out;
}

/**
 * 근거 조문 한 줄을 국가법령정보센터에서 여는 주소를 만든다.
 * 정식 법령명임을 약칭표(law_aliases.json)로 **확인한 경우에만** 바로 가는 한글주소
 * (`/법령/<정식명>/제N조`)를 쓴다. 확인하지 못한 이름·고시·조약은 검색 주소로 보낸다 —
 * 한글주소는 이름이 한 글자만 달라도 「해당 한글주소명을 찾을 수 없습니다」 오류 쪽이 뜬다(2026-11-02 curl 확인).
 * 법령 칸이 계층 낱말뿐이면(`시행규칙`·`시행령 별표3`) 그 줄이 실린 쪽의 법(baseLaw)을 앞에 붙인다.
 * 예: lawGoLink({law:'선박안전법', article:'제76조·제76조의2', tier:'law'})
 *     → {url:'https://www.law.go.kr/법령/선박안전법/제76조', direct:true}
 *     lawGoLink({law:'선박평형수 관리 등을 위한 기준', article:'별표12', tier:'notice'})
 *     → {url:'https://www.law.go.kr/admRulSc.do?menuId=5&subMenuId=41&query=…', direct:false}
 * @param {{law:string, article?:string, tier?:string, baseLaw?:string}} row
 * @returns {{url:string, direct:boolean}}
 * [연계] ← buildReviewSources. 행정규칙 검색 주소는 ai_chat.js amendmentCardHTML 과 같은 꼴
 *        (법령 탭 lsSc.do 로 행정규칙을 찾으면 늘 「결과 없음」이다 — 2026-09-10 확인).
 */
function lawGoLink(row) {
  let name = String((row && row.law) || '').replace(/[「」『』]/g, '').trim();
  const bare = /^(시행령|시행규칙)(?:\s*(?:별표|별지|서식)[\s\S]*)?$/.exec(name);
  if (bare) name = row.baseLaw ? String(row.baseLaw).trim() + ' ' + bare[1] : '';
  const notice = row && row.tier === 'notice';
  if (name && !notice) {
    const { alias, kind } = legalRetriever.loadLawAliases();
    const tail = /^(.+?)\s*(시행령|시행규칙)$/.exec(name);
    if (alias.has(name)) name = alias.get(name);
    else if (tail && alias.has(tail[1])) name = alias.get(tail[1]) + ' ' + tail[2];
    const t2 = /^(.+?)\s*(시행령|시행규칙)$/.exec(name);
    const formal = kind && (kind.has(name) || (t2 && kind.has(t2[1])));
    if (formal) {
      // 칸이 `제N조` 로 시작할 때만 그 조까지 붙인다(`제76조·제76조의2` → 제76조).
      // `제44~46조`·`제74·75조`·`별표3` 처럼 조 하나로 시작하지 않으면 법령 첫 화면으로 보낸다.
      const jo = /^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/.exec(String(row.article || '').trim());
      const joPart = jo ? '/' + encodeURIComponent('제' + jo[1] + '조' + (jo[2] ? '의' + jo[2] : '')) : '';
      return { url: LAWGO + '/' + encodeURIComponent('법령') + '/' + encodeURIComponent(name) + joPart, direct: true };
    }
  }
  const q = encodeURIComponent(name || String((row && row.law) || '').trim());
  return notice
    ? { url: LAWGO + '/admRulSc.do?menuId=5&subMenuId=41&query=' + q, direct: false }
    : { url: LAWGO + '/lsSc.do?menuId=1&query=' + q, direct: false };
}

/**
 * 카드 한 장(review_queue.md 항목)의 원문 안내를 만든다.
 * 대상 페이지마다 「## 근거 조문」 표를 읽고, 줄마다 조문 창과 **같은 함수**(loadArticle)로 원문을 열어 본다.
 * 예: await buildReviewSources({id:'REVIEW-…-806', law:'…', targetPages:['wiki/concepts/…__항만국통제.md (…)']})
 *     → {pages:[{rel, title, law, status, problem:'', rows:[{law, article, tier, open:{ok:true}, link:{…}}, …]}]}
 * @param {{law?:string, targetPages?:string[]}} entry - routes/legal.js parseReviewQueue 의 항목 하나
 * @returns {Promise<{pages:Array<object>, lawSearch:{url:string, direct:boolean}}>}
 *   pages[].problem: 'no_file'(쪽 파일이 없다) · 'no_table'(근거 조문 표가 없다) · ''(줄이 있다)
 *   rows[].open: {ok:true} / {ok:false, reason:'law_not_found'|'file_not_found'|'article_not_found'|'bad_request'|'no_source'|'error'|'not_checked'}
 *   lawSearch: 대상 페이지가 하나도 없을 때 화면이 내놓을 「그 법 찾기」 주소(카드의 법 이름으로)
 * [연계] ← routes/legal.js GET /api/legal/reviews/:id/sources. → pageRefsOf · lawGoLink ·
 *        legal_retriever.readPage/extractCitationChain/lookupContact · article_text.loadArticle.
 */
async function buildReviewSources(entry) {
  const refs = pageRefsOf(entry && entry.targetPages);
  const byKey = new Map((legalRetriever.loadIndex().pages || []).map(p => [p.kind + ':' + p.file, p]));
  const pages = [];
  let checked = 0;
  for (const r of refs) {
    const idx = byKey.get(r.kind + ':' + r.file) || null;
    const page = legalRetriever.readPage(r.kind, r.file);
    const out = {
      rel: r.rel, kind: r.kind,
      title: (idx && idx.topic) || r.file.split('__').pop(),
      law: (idx && idx.law) || '',
      status: (idx && idx.status) || (page && page.frontmatter && page.frontmatter.status) || '',
      problem: '', rows: [],
    };
    if (!page) { out.problem = 'no_file'; pages.push(out); continue; }
    const chain = legalRetriever.extractCitationChain(page.body || '');
    if (!chain.length) { out.problem = 'no_table'; pages.push(out); continue; }
    for (const row of chain) {
      const baseLaw = out.law;
      let open = { ok: false, reason: 'not_checked' };
      if (checked < MAX_OPEN_CHECK) {
        checked++;
        try {
          const d = await articleText.loadArticle({ law: row.law, article: row.article, tier: row.tier, baseLaw });
          open = d && d.ok ? { ok: true } : { ok: false, reason: (d && d.reason) || 'error' };
        } catch (e) {
          // 한 줄이 던져도 나머지 줄은 보여 준다(화면에는 「못 엶」으로 뜬다). 던진 까닭은 서버 기록에 남긴다.
          console.warn('[review_sources] 원문 열기 실패:', row.law, row.article, e && e.message);
          open = { ok: false, reason: 'error' };
        }
      }
      out.rows.push({
        law: row.law, article: row.article, tier: row.tier, step: row.step || '', gist: row.gist || '',
        effectiveDate: row.effectiveDate || '', baseLaw,
        contact: legalRetriever.lookupContact(row.law) || null,
        open, link: lawGoLink(Object.assign({}, row, { baseLaw })),
      });
    }
    pages.push(out);
  }
  return { pages, lawSearch: lawGoLink({ law: (entry && entry.law) || '', tier: 'law' }) };
}

module.exports = { pageRefsOf, lawGoLink, buildReviewSources, MAX_OPEN_CHECK };
