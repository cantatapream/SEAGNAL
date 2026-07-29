/**
 * ============================================================================
 * 파일명: services/legal_retriever.js
 * 역할: 나리야 법률 챗봇 — 하이브리드 검색(직접매칭+glossary+그래프홉) + Gemini 답변 합성
 * ============================================================================
 *
 * [설명]
 * `_CHATBOT.md` 4절(검색)·3절(인용규율)·5절(답변 경계)의 답변엔진 구현체(Phase E, 1차:
 * 수산업법·어선법·어선안전조업법 3법 파일럿). routes/legal.js의 POST /api/legal/ask가
 * 이 모듈의 search()로 근거 후보를 찾고 synthesizeAnswer()로 실제 문장 답변을 만든다.
 *
 * [검색 단계]
 *  ① 메타데이터 매칭(법명·주제·파일명·테마) — index.json
 *  ② glossary 구어 매핑(_glossary.md) — "정식 명칭이 아닌 말"을 개념으로 번역
 *  ③ 본문 직접매칭 — 후보 페이지의 실제 마크다운 본문을 읽어 재점수(제목·본문 포함 시 가중)
 *  ④ 그래프 1홉 확장 — 최상위 페이지의 index.json `links` 필드로 관련 개념 보강
 * ※ 의미 임베딩(_CHATBOT.md 4-③)은 이번 파일럿 범위 밖(3법 규모에선 ①②③④로 충분히
 *   커버되는지 먼저 확인 — 필요해지면 topic_embedding.js 패턴을 재사용해 후속 추가).
 *
 * [환각 0] canonicalOnly=true면 concept는 status:canonical만 근거로 채택(statute는 통과).
 *   실제 답 문장은 항상 [근거자료]로 전달된 위키 원문에서만 만들도록 프롬프트로 강제.
 *
 * [연계 파일]
 * - knowledge/legal/_dashboard/index.json  → 페이지 메타 색인(법·주제·테마·links)
 * - knowledge/legal/wiki/concepts|statutes/*.md → 실제 본문(직접매칭·답변 근거)
 * - knowledge/legal/wiki/_glossary.md       → 구어→개념 매핑표
 * - services/gemini_client.js               → 답변 합성 LLM 호출
 * - routes/legal.js                         → POST /api/legal/ask 가 이 모듈을 호출
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gemini = require('./gemini_client');

const LEGAL_DIR = path.join(__dirname, '..', 'knowledge', 'legal');
const INDEX_JSON = path.join(LEGAL_DIR, '_dashboard', 'index.json');
const GLOSSARY_MD = path.join(LEGAL_DIR, 'wiki', '_glossary.md');
const CONCEPTS_DIR = path.join(LEGAL_DIR, 'wiki', 'concepts');
const STATUTES_DIR = path.join(LEGAL_DIR, 'wiki', 'statutes');

// 법률 답변은 이 프로젝트의 최우선 불변식(환각 0)이 걸린 영역이라, 날씨비서(assistant.js
// BRAIN_MODEL=flash-lite)와 달리 지시준수·그라운딩 정확도가 가장 중요 — pro 사용(사용자 확정).
const ANSWER_MODEL = 'gemini-2.5-pro';
const MAX_BODY_CHARS = 4000;   // 페이지당 컨텍스트 상한(비용·컨텍스트 관리)
const PRIMARY_TOPK = 5;
const HOP_MAX = 2;

// ── index.json 캐시(mtime 감지) ──
let _idxCache = null, _idxMtime = 0;
function loadIndex() {
  try {
    const mt = fs.statSync(INDEX_JSON).mtimeMs;
    if (_idxCache && mt === _idxMtime) return _idxCache;
    _idxCache = JSON.parse(fs.readFileSync(INDEX_JSON, 'utf8')); _idxMtime = mt;
  } catch (_) { if (!_idxCache) _idxCache = { pages: [] }; }
  return _idxCache;
}

// ── glossary 캐시(mtime 감지): 구어 → [[개념링크]] 매핑표 파싱 ──
let _glosCache = null, _glosMtime = 0;
function loadGlossary() {
  try {
    const mt = fs.statSync(GLOSSARY_MD).mtimeMs;
    if (_glosCache && mt === _glosMtime) return _glosCache;
    const txt = fs.readFileSync(GLOSSARY_MD, 'utf8');
    const rows = [];
    for (const line of txt.split('\n')) {
      const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*[^|]*\|\s*$/);
      if (!m || /^-+$/.test(m[1].trim()) || m[1].trim() === '구어·별칭') continue;
      const terms = m[1].split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const slugs = [];
      const linkRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      let lm; while ((lm = linkRe.exec(m[2])) !== null) slugs.push(lm[1].trim());
      if (terms.length && slugs.length) rows.push({ terms, slugs });
    }
    _glosCache = rows; _glosMtime = mt;
  } catch (_) { if (!_glosCache) _glosCache = []; }
  return _glosCache;
}

/** 질문에 포함된 glossary 구어를 찾아 추가 검색어 + 강제후보 slug를 반환(띄어쓰기 무시 비교). */
function glossaryExpand(query) {
  const qFlat = query.replace(/\s+/g, '');
  const extraTerms = []; const forcedSlugs = [];
  for (const row of loadGlossary()) {
    for (const t of row.terms) {
      if (t && qFlat.includes(t.replace(/\s+/g, ''))) {
        forcedSlugs.push(...row.slugs);
        for (const s of row.slugs) extraTerms.push(...s.split(/[_·]/).filter(w => w.length >= 2));
        break;
      }
    }
  }
  return { extraTerms: [...new Set(extraTerms)], forcedSlugs: [...new Set(forcedSlugs)] };
}

// 질문에서 흔히 등장하지만 법령 내용과 무관한 의문·연결어(형태소 분석기 없이 저렴하게 거른다).
// 이런 단어를 검색어로 쓰면 거의 모든 페이지 본문에 우연히 걸려 진짜 법률 용어(예: "출항")를
// 점수로 압도해 버린다(실측: "출항신고" 질문이 "어떻게"·"되나요" 때문에 엉뚱한 법이 1위로 뜸).
const STOPWORDS = new Set([
  '하면', '하나요', '하나', '합니까', '합니다', '됩니까', '됩니다', '되나요', '되나', '되는지',
  '되어요', '돼요', '인가요', '인가', '입니까', '입니다', '있나요', '있어요', '있습니까',
  '없나요', '없어요', '어떻게', '무엇', '무슨', '어디', '언제', '누구', '그리고', '그런데',
  '그러면', '그래서', '혹시', '혹은', '또는', '때문에', '경우', '같아요', '같습니다', '제가',
  '저는', '우리', '이런', '저런', '그런', '않으면', '않나요', '않아요', '습니다',
]);

/**
 * 질의를 검색어로 쪼갠다. 한국어는 조사·어미가 명사에 그대로 붙어("조업하면"=조업+하면)
 * 완전일치만으로는 놓치는 경우가 많아, 형태소 분석기 없이 저렴하게 보완한다:
 * 4음절 이상 토큰은 끝 1·2글자를 뗀 접두어("조업하면"→"조업하"·"조업")도 후보에 더한다.
 * 의문·연결어(STOPWORDS)는 애초에 후보에서 뺀다(노이즈 방지).
 */
function termsOf(query) {
  const tokens = query.replace(/[^가-힣a-zA-Z0-9\s]/g, ' ').split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
  const out = new Set(tokens);
  for (const t of tokens) {
    if (t.length >= 4) { out.add(t.slice(0, t.length - 1)); out.add(t.slice(0, t.length - 2)); }
  }
  return [...out];
}

/** slug(index.json 표기, 'statutes/xxx|표시' 포함 가능)를 {kind,file} 로 정규화. */
function normalizeSlug(raw) {
  let s = String(raw).split('|')[0].trim();
  if (s.startsWith('statutes/')) return { kind: 'statute', file: s.slice('statutes/'.length) };
  return { kind: 'concept', file: s };
}

function pageFilePath(kind, file) {
  return path.join(kind === 'statute' ? STATUTES_DIR : CONCEPTS_DIR, file + '.md');
}

// ── 페이지 본문 캐시(mtime 감지): frontmatter + body 분리 ──
const _bodyCache = new Map(); // key: fp → { mtime, frontmatter, body }
function readPage(kind, file) {
  const fp = pageFilePath(kind, file);
  let mt;
  try { mt = fs.statSync(fp).mtimeMs; } catch (_) { return null; }
  const cached = _bodyCache.get(fp);
  if (cached && cached.mtime === mt) return cached;
  const raw = fs.readFileSync(fp, 'utf8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const frontmatter = {};
  let body = raw;
  if (fmMatch) {
    body = fmMatch[2];
    for (const line of fmMatch[1].split('\n')) {
      const kv = line.match(/^([^:]+):\s*(.*)$/);
      if (kv) frontmatter[kv[1].trim()] = kv[2].trim();
    }
  }
  const entry = { mtime: mt, frontmatter, body };
  _bodyCache.set(fp, entry);
  return entry;
}

/**
 * 페이지 하나에 메타(법명·주제·파일명·테마) 점수 + 본문 직접매칭 점수(_CHATBOT.md ① 직접 매칭)를
 * 함께 매긴다. 메타로 안 걸려도 본문에 실제로 있으면 잡히도록 항상 본문까지 본다 — 그래야
 * "무허가로 조업하면" 같은 질문이 topic 필드엔 없지만 본문 '위반 시 처벌' 표에만 있는 페이지도 찾는다.
 */
function scoreOne(p, terms) {
  const hay = (p.law || '') + ' ' + (p.topic || '') + ' ' + (p.file || '') + ' ' + (p.themes || []).join(' ');
  let s = 0;
  for (const t of terms) if (hay.includes(t)) s += (p.law && p.law.includes(t)) ? 2 : 1;
  const page = readPage(p.kind, p.file);
  if (page) {
    const title = p.topic || p.law || '';
    for (const t of terms) {
      if (title.includes(t)) s += 3;
      else if (page.body.includes(t)) s += 2;
    }
  }
  return s;
}

// 서버 기동 직후 본문 캐시를 미리 데워 첫 사용자 질문이 콜드 디스크읽기(전체 corpus 수 초)를
// 기다리지 않게 한다. 실패해도 조용히 무시 — 어차피 각 페이지는 처음 필요할 때 다시 읽힌다.
function warmup() {
  try {
    for (const p of (loadIndex().pages || [])) readPage(p.kind, p.file);
  } catch (_) { /* 무시 — on-demand 읽기로 폴백 */ }
}
setImmediate(warmup);

/**
 * 하이브리드 검색: canonicalOnly 필터 → 메타점수 → glossary 강제후보 병합 → 본문 직접매칭 재점수
 * → 상위 페이지 그래프 1홉 확장. 클라 아코디언용 sources와 답변합성용 contextPages를 함께 반환.
 * @param {string} query
 * @param {{canonicalOnly?:boolean}} opts
 * @returns {{sources:Array, contextPages:Array}}
 */
function search(query, opts) {
  const canonicalOnly = !!(opts && opts.canonicalOnly);
  const idx = loadIndex();
  let pages = idx.pages || [];
  if (canonicalOnly) pages = pages.filter(p => p.kind !== 'concept' || p.status === 'canonical');

  const byFile = new Map(pages.map(p => [p.kind + ':' + p.file, p]));
  const terms = termsOf(query);
  const { extraTerms, forcedSlugs } = glossaryExpand(query);
  const allTerms = [...new Set([...terms, ...extraTerms])];

  let scored = pages.map(p => ({ p, s: scoreOne(p, allTerms) })).filter(x => x.s > 0);
  // glossary 강제후보 병합(구어 매핑은 본문에 그 단어가 그대로 없을 수도 있어 별도 신호로 취급)
  for (const raw of forcedSlugs) {
    const { kind, file } = normalizeSlug(raw);
    const p = byFile.get(kind + ':' + file);
    if (!p) continue;
    const hit = scored.find(x => x.p === p);
    if (hit) hit.s += 4; else scored.push({ p, s: 4 });
  }
  scored.sort((a, b) => b.s - a.s);
  const primary = scored.slice(0, PRIMARY_TOPK);

  // 그래프 1홉: 최상위 페이지의 links로 관련 개념 보강(이미 뽑힌 페이지는 제외)
  const picked = new Set(primary.map(x => x.p));
  const hop = [];
  for (const top of primary.slice(0, 2)) {
    if (hop.length >= HOP_MAX) break;
    for (const raw of (top.p.links || [])) {
      if (hop.length >= HOP_MAX) break;
      const { kind, file } = normalizeSlug(raw);
      const p = byFile.get(kind + ':' + file);
      if (!p || picked.has(p)) continue;
      picked.add(p); hop.push({ p, s: 0, hop: true });
    }
  }

  const finalList = [...primary, ...hop];
  const contextPages = finalList.map(x => {
    const page = readPage(x.p.kind, x.p.file);
    return {
      law: x.p.law, topic: x.p.topic, file: x.p.file, kind: x.p.kind, status: x.p.status || null,
      hop: !!x.hop,
      frontmatter: page ? page.frontmatter : {},
      body: page ? page.body.slice(0, MAX_BODY_CHARS) : '',
    };
  }).filter(cp => cp.body);

  const sources = finalList.map(x => ({
    file: x.p.file, law: x.p.law, topic: x.p.topic, kind: x.p.kind, status: x.p.status || null,
    score: x.s, hop: !!x.hop,
  }));

  return { sources, contextPages };
}

/** contextPages를 프롬프트용 [근거자료] 블록 문자열로 직렬화. */
function buildContextBlock(contextPages) {
  return contextPages.map((cp, i) => {
    const title = cp.topic ? `${cp.law} — ${cp.topic}` : cp.law;
    const meta = `상태:${cp.status || '(법령원문)'} · 기준일:${cp.frontmatter.updated || cp.frontmatter.시행일 || '미상'}` +
      (cp.hop ? ' · (관련개념 보강)' : '');
    return `--- 근거${i + 1}: [${title}] (${meta}) ---\n${cp.body}`;
  }).join('\n\n');
}

const ANSWER_RULES = `너는 "나리야" — 대한민국 해양수산 법령을 안내하는 AI 챗봇이다. 아래 [근거자료]는 검증 절차를 거친 법령 위키에서 그대로 발췌한 원문이다.

[답변 원칙 — 반드시 지킬 것]
1. 답의 근거는 오직 [근거자료]뿐이다. [근거자료]에 없는 내용은 지어내지 말고 "확인되지 않습니다"라고 정직하게 말한다.
2. 처벌(징역·벌금·과태료)은 조·항·호·금액을 [근거자료] 그대로 인용한다. 뭉개어 말하지 않는다. 처벌이 위반 횟수(1차/2차/3차…)에 따라 달라지면 가장 흔한 경우(통상 1차)만 먼저 답하고 "2차 이후도 궁금하시면 다시 물어보세요"로 마무리한다(한 번에 전부 나열하지 않는다).
3. 조건(선박 톤수·어업 종류·조업구역 등)에 따라 답이 갈리는데 질문에 그 조건이 없으면, 장황하게 다 나열하지 말고 필요한 조건 한 가지만 되물어라(예: "배가 몇 톤이세요?"). 지금은 단발 질문-답변이라 이전 대화를 기억하지 못하니, 되물을 땐 그 사실을 티내지 말고 자연스럽게 묻는다.
4. 판례·법리 해석·다툼의 여지가 있는 논점은 답하지 않는다(스코프 밖). 명확한 조문까지만 안내하고 "이 부분은 개별 사안에 따라 달라져 관할 소관부서에 확인하시는 것이 정확합니다"로 마무리한다.
5. 딱딱한 조문 나열 금지. 결론 먼저 → 필요한 근거. 이해가 어려운 부분만 "쉽게 말하면~"으로 한 번 더 풀어준다. 과잉 설명은 하지 않는다.
6. 답변 마지막에 반드시 이 순서로 붙인다: (a) 근거 법령·조문, (b) [근거자료]에 소관부서·연락처가 있으면 그것, (c) 근거자료의 기준일("「○○법」 YYYY-MM-DD 기준"). ("참고용입니다" 면책 문구는 화면이 별도로 붙이니 답변에 넣지 않는다.)
7. 표·이모지는 쓰지 않는다. 강조는 **굵게**만 사용.`;

/**
 * Gemini로 실제 답변 문장을 합성한다. 근거 페이지가 없으면 호출하지 않는다(비용·환각 방지).
 * @param {string} query
 * @param {Array} contextPages - search()의 contextPages
 * @returns {Promise<{answer:string|null, usedGemini:boolean, error:string|null}>}
 */
async function synthesizeAnswer(query, contextPages) {
  if (!contextPages.length) return { answer: null, usedGemini: false, error: '근거 없음' };
  if (!gemini.hasAnyKey()) return { answer: null, usedGemini: false, error: 'GEMINI_API_KEY 미설정' };
  const prompt = `${ANSWER_RULES}\n\n[근거자료]\n${buildContextBlock(contextPages)}\n\n질문: "${query}"\n답:`;
  const r = await gemini.callGemini({ model: ANSWER_MODEL, contents: prompt, config: { temperature: 0.3 }, caller: 'Legal-Ask' });
  if (!r.success || !r.text) return { answer: null, usedGemini: false, error: r.error || '응답 없음' };
  return { answer: r.text.trim(), usedGemini: true, error: null };
}

module.exports = { loadIndex, search, synthesizeAnswer };
