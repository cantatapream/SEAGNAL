/**
 * ============================================================================
 * 파일명: services/legal_retriever.js
 * 역할: 나리야 법률 챗봇 — 하이브리드 검색(직접매칭+glossary+그래프홉) + Gemini 답변 합성
 * ============================================================================
 *
 * [설명]
 * `_CHATBOT.md` 4절(검색)·3절(인용규율)·5절(답변 경계)의 답변엔진 구현체(Phase E, 1차:
 * 수산업법·어선법·어선안전조업법 3법 파일럿). routes/legal.js의 POST /api/legal/ask가
 * 이 모듈의 search()로 근거 후보를 찾고 synthesizeAnswerStream()으로 실제 문장 답변을 스트리밍 생성한다.
 *
 * [검색 단계]
 *  ① 메타데이터 매칭(법명·주제·파일명·테마) — index.json
 *  ② glossary 구어 매핑(_glossary.md) — "정식 명칭이 아닌 말"을 개념으로 번역
 *  ③ 본문 직접매칭 — 후보 페이지의 실제 마크다운 본문을 읽어 재점수(제목·본문 포함 시 가중)
 *  ④ 그래프 1홉 확장 — 최상위 페이지의 index.json `links` 필드로 관련 개념 보강
 * ※ 의미 임베딩(_CHATBOT.md 4-③)은 이번 파일럿 범위 밖(3법 규모에선 ①②③④로 충분히
 *   커버되는지 먼저 확인 — 필요해지면 topic_embedding.js 패턴을 재사용해 후속 추가).
 *
 * [환각 0] canonicalOnly=true면 concept·comparison은 status:canonical만 근거로 채택(statute는 통과).
 *   실제 답 문장은 항상 [근거자료]로 전달된 위키 원문에서만 만들도록 프롬프트로 강제.
 *
 * [연계 파일]
 * - knowledge/legal/_dashboard/index.json  → 페이지 메타 색인(법·주제·테마·links, comparison 포함 2026-08-01~)
 * - knowledge/legal/wiki/concepts|statutes|comparisons/*.md → 실제 본문(직접매칭·답변 근거)
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
const CONTACTS_JSON = path.join(LEGAL_DIR, '_dashboard', 'contacts_collected.json');
const GLOSSARY_MD = path.join(LEGAL_DIR, 'wiki', '_glossary.md');
const CONCEPTS_DIR = path.join(LEGAL_DIR, 'wiki', 'concepts');
const STATUTES_DIR = path.join(LEGAL_DIR, 'wiki', 'statutes');
const COMPARISONS_DIR = path.join(LEGAL_DIR, 'wiki', 'comparisons');
const ANNEXES_DIR = path.join(LEGAL_DIR, 'wiki', 'annexes');
const ACTIVITIES_DIR = path.join(LEGAL_DIR, 'wiki', 'activities');

// ★모델 확정(2026-07-30, 사용자 확정): pro(gemini-pro-latest, 실제로는 Gemini 3.1 Pro)에서
// gemini-2.5-flash로 전환. 사유=비용(입력 6.7배·출력 4.8배 저렴, ai.google.dev 공식가 기준
// flash $0.30/$2.50 vs 3.1 Pro $2.00/$12.00 per 1M 토큰, ≤200k 구간). 전환 전 3법 파일럿
// 6개 대표질문을 실키로 실행해 각 답변의 조문번호·처벌금액·기관명을 raw 원문·위키와 문장
// 단위로 전수 대조 — 환각 0건 확인 후 확정. 문제 재발 시 'gemini-pro-latest'로 되돌릴 것.
// ('gemini-2.5-pro'는 이 API 키에선 404(신규 사용자 미지원, 실측 확인 2026-07-29)라 pro가
// 필요하면 'gemini-pro-latest' 별칭을 쓴다.)
const ANSWER_MODEL = 'gemini-2.5-flash';
const MAX_BODY_CHARS = 4000;   // 페이지당 컨텍스트 상한(비용·컨텍스트 관리)
// 실측 확정(2026-07-29): 7→10→30페이지로 늘려도 속도 저하 없음(병목은 Gemini 호출 자체,
// 검색 자체는 0.1~0.3초). 다만 30개에서 순위 20위 이후는 관련성이 뚜렷이 떨어지는 노이즈성
// 페이지가 섞이기 시작함(예: "선박안전법 형식승인및검정" 등) — 속도가 아니라 관련성 기준으로
// 10+5=15를 "안전마진은 넉넉하되 노이즈는 덜한" 확정값으로 결정.
const PRIMARY_TOPK = 10;
const HOP_MAX = 5;

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
  if (s.startsWith('comparisons/')) return { kind: 'comparison', file: s.slice('comparisons/'.length) };
  if (s.startsWith('annexes/')) return { kind: 'annex', file: s.slice('annexes/'.length) };
  if (s.startsWith('activities/')) return { kind: 'activity', file: s.slice('activities/'.length) };
  return { kind: 'concept', file: s };
}

const KIND_DIRS = { statute: STATUTES_DIR, comparison: COMPARISONS_DIR, annex: ANNEXES_DIR, activity: ACTIVITIES_DIR };
function pageFilePath(kind, file) {
  return path.join(KIND_DIRS[kind] || CONCEPTS_DIR, file + '.md');
}

// [[링크]] 표기가 'comparisons/'·'annexes/'·'activities/' 접두어 없이 쓰인 기존 위키 문서가
// 많아(허브·별표 페이지 관행이 정착되기 전 작성분), normalizeSlug만으론 kind를 못 맞힐 수
// 있다 — index.json에 실제로 어느 kind로 등록됐는지 byFile에서 확인해 보정한다.
function resolvePage(byFile, raw) {
  const { kind, file } = normalizeSlug(raw);
  const hit = byFile.get(kind + ':' + file);
  if (hit) return hit;
  if (kind === 'concept') {
    for (const alt of ['comparison', 'annex', 'activity']) {
      const p = byFile.get(alt + ':' + file);
      if (p) return p;
    }
  }
  return null;
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

// ============================================================================
// 인용사슬(citation chain) — 위키 "## 근거 조문" 표를 답변카드 UI가 쓸 구조로 뽑는다.
// 화면(client/js/ai-chat/ai_chat.js)이 법률→시행령→시행규칙→고시 위임 흐름을 세로 체인으로
// 그리는 데 필요한 최소 데이터만 만든다. 표에 없는 것은 절대 만들어내지 않는다(환각 0).
// ============================================================================

// ── contacts_collected.json 캐시(mtime 감지): 법 slug → 소관부서·전화번호 ──
let _contactsCache = null, _contactsMtime = 0;
function loadContacts() {
  try {
    const mt = fs.statSync(CONTACTS_JSON).mtimeMs;
    if (_contactsCache && mt === _contactsMtime) return _contactsCache;
    _contactsCache = JSON.parse(fs.readFileSync(CONTACTS_JSON, 'utf8')); _contactsMtime = mt;
  } catch (_) { if (!_contactsCache) _contactsCache = {}; }
  return _contactsCache;
}

/**
 * 법령명 문자열로 위임 단계(tier)를 판정한다. 화면에서 단계별 색 농도(법률 진함 → 고시 옅음)에 쓴다.
 * 예: classifyTier('자연유산법 시행령') → 'decree' · classifyTier('…허용기준작성지침') → 'notice'
 * @param {string} lawName - 근거 조문 표의 법령명 셀
 * @returns {'law'|'decree'|'rule'|'notice'}
 * [연계] → extractCitationChain(각 행의 tier), ai_chat.js의 data-tier 색상.
 */
function classifyTier(lawName) {
  const s = String(lawName || '');
  if (s.includes('시행령')) return 'decree';
  if (s.includes('시행규칙')) return 'rule';
  if (/고시|지침|훈령|예규|규정|요령|작성기준|행정규칙|통항규칙/.test(s)) return 'notice';
  return 'law';
}

/** 표 셀의 마크다운 장식([[링크]]·**굵게**)을 걷어내 사람이 읽는 문자열로 만든다. */
function plainCell(s) {
  return String(s || '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*/g, '')
    .trim();
}

/**
 * 페이지 본문에서 `## 근거 조문` 표를 파싱해 위임 사슬 배열을 만든다.
 * ⚠ 이 위키는 여러 세션·에이전트가 몇 달에 걸쳐 써서 표 헤더의 컬럼 순서가 페이지마다 다르다
 * (`법령명|조문|시행일|요지` 도 있고 `단계|법령|조문|시행일|요지` 도 있다) — 그래서 컬럼 위치가
 * 아니라 **헤더 텍스트**로 각 컬럼을 찾는다. 표가 없거나 파싱이 안 되면 예외 없이 []를 반환한다
 * (이 표가 없는 페이지도 많다 — 그런 페이지는 화면이 단순 폴백 카드로 그린다).
 * @param {string} body - 페이지 마크다운 본문(frontmatter 제외)
 * @returns {Array<{law:string,article:string,effectiveDate:string,gist:string,tier:string}>} 원 표 순서 그대로
 * [연계] ← search()가 상위 소스에 붙임 → ai_chat.js 체인 UI.
 */
function extractCitationChain(body) {
  try {
    const txt = String(body || '');
    const hm = /^#{2,3}\s*근거\s*조문[^\n]*$/m.exec(txt);
    if (!hm) return [];
    const lines = txt.slice(hm.index + hm[0].length).split('\n');
    const table = [];
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('|')) { table.push(t); continue; }
      if (table.length) break;          // 표가 끝났다
      if (t.startsWith('#')) break;     // 표를 만나기 전에 다음 절로 넘어갔다
    }
    if (table.length < 3) return [];    // 헤더 + 구분선 + 최소 1행

    // ⚠ 위키 표 셀 안에 [[statutes/해양환경관리법|해양환경관리법]] 처럼 파이프가 든 링크가 그대로
    // 쓰여 있다(마크다운 규칙상 원래는 이스케이프해야 하지만 관행이 그렇다) — 그냥 '|'로 쪼개면
    // 링크가 두 칸으로 찢어져 법령명이 "[[statutes/해양환경관리법"이 된다. 쪼개기 전에 링크 안의
    // 파이프만 잠시 치환해 보호한다.
    const PIPE = ' ';
    const cells = row => row
      .replace(/\[\[[^\]]*\]\]/g, m => m.replace(/\|/g, PIPE))
      .replace(/^\|/, '').replace(/\|$/, '')
      .split('|').map(c => c.split(PIPE).join('|').trim());
    const head = cells(table[0]);
    const col = re => head.findIndex(h => re.test(h));
    const iLaw = col(/법령|법률명/);
    const iArt = col(/조문/);
    const iEff = col(/시행일|발령/);
    const iGist = col(/요지|내용|비고/);
    if (iLaw < 0) return [];

    const out = [];
    for (const row of table.slice(2)) {   // 0=헤더, 1=구분선
      const c = cells(row);
      if (/^-+$/.test((c[0] || '').replace(/:/g, ''))) continue;
      const law = plainCell(c[iLaw]);
      if (!law || law === '—' || law === '-') continue;
      out.push({
        law,
        article: iArt >= 0 ? plainCell(c[iArt]) : '',
        effectiveDate: iEff >= 0 ? plainCell(c[iEff]) : '',
        gist: iGist >= 0 ? plainCell(c[iGist]) : '',
        tier: classifyTier(law),
      });
    }
    return out;
  } catch (_) { return []; }
}

/** 법령명 비교용 정규화: 괄호주석·공백·가운뎃점·낫표를 걷어낸다. */
function normLawName(s) {
  return String(s || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[「」『』\s·ㆍ・,]/g, '')
    .replace(/(시행령|시행규칙)$/, '')
    .trim();
}

/**
 * 행정규칙(고시·지침) 이름 비교용 정규화. 법령명과 달리 괄호 안을 지우지 않는다 —
 * "고시(선박교통관제에 관한 규정)"처럼 진짜 이름이 괄호 안에 들어있는 표기가 많기 때문이다
 * (괄호를 지우면 "고시"만 남아 아무 규칙에나 걸린다).
 */
function normRuleName(s) {
  return String(s || '').replace(/[「」『』()（）\s·ㆍ・,]/g, '').trim();
}

/** a의 글자가 b에 순서대로 모두 나타나는가(약칭 판정용 부분수열 검사). */
function isSubsequence(a, b) {
  let i = 0;
  for (const ch of b) { if (ch === a[i]) i++; if (i >= a.length) return true; }
  return a.length > 0 && i >= a.length;
}

/** 두 문자열이 앞에서부터 몇 글자나 같은가. */
function sharedPrefixLen(a, b) {
  let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * 근거 조문 표의 법령명에 대응하는 소관부서·전화번호를 `_dashboard/contacts_collected.json`에서 찾는다.
 * 표의 법령명은 "자연유산법"처럼 축약형인 경우가 많고 JSON 키는 정식명 slug("자연유산의보존및
 * 활용에관한법률")라, ①정규화 후 완전일치 ②포함관계 ③약칭 판정(부분수열 + 앞 2글자 이상 일치)
 * 순으로 느슨하게 맞춘다. 못 찾으면 null — 화면은 "확인되지 않음"으로 정직하게 표기한다.
 * 예: lookupContact('자연유산법 시행령') → {부서명:'자연유산정책과', 전화번호:'042-610-7612', 소관부처명:'국가유산청'}
 * @param {string} lawName - 표의 법령명 셀 원문
 * @returns {{부서명:string,전화번호:string,소관부처명:string}|null}
 * [연계] ← search()가 citationChain 각 행에 붙임 → ai_chat.js 의 ☎ 한 줄(tel: 링크).
 */
function lookupContact(lawName) {
  const contacts = loadContacts();
  const keys = Object.keys(contacts);
  if (!keys.length) return null;
  const tier = classifyTier(lawName);

  // 고시·훈령 등 행정규칙은 법이 아니라 규칙 이름으로 등록돼 있다 — 전 법의 행정규칙 목록에서 찾는다.
  if (tier === 'notice') {
    const want = normRuleName(lawName);
    if (want.length < 4) return null;   // "고시"·"지침" 같은 종류 표기만 든 칸은 매칭하지 않는다
    for (const k of keys) {
      const rules = (contacts[k] && contacts[k].행정규칙) || {};
      for (const name of Object.keys(rules)) {
        const n = normRuleName(name);
        if (n.length < 4) continue;
        if (n === want || n.includes(want) || want.includes(n)) {
          const r = rules[name];
          const m = /^(.+?)\((.+)\)$/.exec(r.담당부서기관명 || '');
          return {
            부서명: m ? m[2] : (r.담당부서기관명 || ''),
            전화번호: r.전화번호 || '',
            소관부처명: r.소관부처명 || (m ? m[1] : ''),
          };
        }
      }
    }
    return null;
  }

  // 3글자 미만("법률"·"고시" 같은 단계 표기가 법령명 칸에 잘못 들어온 경우)은 아무 법에나 걸려
  // 엉뚱한 전화번호를 붙일 수 있어 아예 매칭하지 않는다(잘못된 곳에 전화하게 만드느니 미표시).
  const want = normLawName(lawName);
  if (want.length < 3) return null;
  let best = null, bestScore = -1;
  for (const k of keys) {
    const nk = normLawName(k);
    let score = -1;
    if (nk === want) score = 1000;
    else if (nk.includes(want) || want.includes(nk)) score = 500 + sharedPrefixLen(nk, want);
    else if (isSubsequence(want, nk) && sharedPrefixLen(nk, want) >= 2) score = sharedPrefixLen(nk, want);
    if (score > bestScore || (score === bestScore && best && k.length < best.length)) { bestScore = score; best = k; }
  }
  if (!best || bestScore < 0) return null;

  const fam = (contacts[best] && contacts[best].families) || {};
  const wantFam = tier === 'decree' ? '시행령' : (tier === 'rule' ? '시행규칙' : '법률');
  const list = fam[wantFam] || fam['법률'] || fam['시행령'] || fam['시행규칙'];
  if (!list || !list.length) return null;
  const c = list[0];
  return { 부서명: c.부서명 || '', 전화번호: c.전화번호 || '', 소관부처명: c.소관부처명 || '' };
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

/**
 * 본문이 MAX_BODY_CHARS보다 길면(주로 comparisons 허브 — 여러 절을 한 페이지에 모아 다른
 * kind보다 훨씬 길다) 앞부분만 자르지 않고 '## ' 절 단위로 쪼개 질의어와 매칭되는 절 위주로
 * 담는다. 안 그러면 예: 18개 절짜리 허브에서 6번째 절(질문과 정확히 맞는 내용)이 컷오프
 * 이후라 통째로 안 보이는 문제가 생긴다(실측 확인 — 형사절차_일반.md 선고유예 질의 실패).
 */
function sliceRelevant(body, terms, maxChars) {
  if (body.length <= maxChars) return body;
  const parts = body.split(/\n(?=## )/);
  const introIsSection = parts[0].startsWith('## ');
  const intro = introIsSection ? '' : parts[0];
  const sections = introIsSection ? parts : parts.slice(1);
  if (!sections.length) return body.slice(0, maxChars);
  // 페이지 전체가 한 주제(예: "매립면허")를 다루면 그 주제어는 거의 모든 절에 등장해 변별력이
  // 없다 — 이 페이지 안에서 몇 개 절에 등장하는지(절-내 문서빈도)로 역가중해, 소수 절에만 있는
  // 단어(질문의 진짜 변별 지점, 예: "수수료")를 우선한다(실측: 역가중 없인 흔한 주제어에
  // 묻혀 정작 필요한 절이 후순위로 밀림).
  const df = terms.map(t => sections.reduce((n, s) => n + (s.includes(t) ? 1 : 0), 0));
  const scored = sections
    .map(s => ({ s, sc: terms.reduce((n, t, i) => n + (df[i] > 0 && s.includes(t) ? 1 / df[i] : 0), 0) }))
    .filter(x => x.sc > 0)
    .sort((a, b) => b.sc - a.sc);
  if (!scored.length) return body.slice(0, maxChars); // 매칭 절 없으면 기존 방식으로 폴백
  let out = intro.slice(0, maxChars);
  for (const { s } of scored) {
    if (out.length + s.length > maxChars) continue; // 이 절은 예산 초과 — 더 작은 다음 후보 절 시도
    out += s;
  }
  if (out.length <= intro.length) out += scored[0].s.slice(0, maxChars - out.length); // 다 안 들어가면 1위 절이라도 잘라서 넣는다
  return out;
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
  if (canonicalOnly) pages = pages.filter(p => p.kind === 'statute' || p.status === 'canonical');

  const byFile = new Map(pages.map(p => [p.kind + ':' + p.file, p]));
  const terms = termsOf(query);
  const { extraTerms, forcedSlugs } = glossaryExpand(query);
  const allTerms = [...new Set([...terms, ...extraTerms])];

  let scored = pages.map(p => ({ p, s: scoreOne(p, allTerms) })).filter(x => x.s > 0);
  // glossary 강제후보 병합(구어 매핑은 본문에 그 단어가 그대로 없을 수도 있어 별도 신호로 취급)
  for (const raw of forcedSlugs) {
    const p = resolvePage(byFile, raw);
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
      const p = resolvePage(byFile, raw);
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
      body: page ? sliceRelevant(page.body, allTerms, MAX_BODY_CHARS) : '',
    };
  }).filter(cp => cp.body);

  // 인용사슬은 화면 체인 UI가 실제로 그리는 상위 소수 건에만 붙인다(전부 파싱하면 낭비).
  // 본문은 위에서 이미 readPage로 캐시돼 있어 파일을 다시 읽지 않는다.
  const CHAIN_TOPK = 5;
  const sources = finalList.map((x, i) => {
    const s = {
      file: x.p.file, law: x.p.law, topic: x.p.topic, kind: x.p.kind, status: x.p.status || null,
      score: x.s, hop: !!x.hop,
    };
    if (i < CHAIN_TOPK) {
      const page = readPage(x.p.kind, x.p.file);
      s.citationChain = page
        ? extractCitationChain(page.body).map(row => Object.assign({}, row, { contact: lookupContact(row.law) }))
        : [];
    }
    return s;
  });

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
7. 표·이모지는 쓰지 않는다. 강조는 **굵게**만 사용.
8. 처벌·의무의 대상이 [근거자료]에 여러 주체(예: 위반한 본인 + 별도 책임 있는 선장·사업자·안전관리자 등)로 나뉘어 규정돼 있으면, 그중 하나만 말하고 끝내지 말고 **해당하는 관련 주체를 전부** 빠짐없이 언급한다.`;

// 'MINIMAL'은 gemini-pro-latest(3.x)에서 400(지원 안 함)으로 실측 확인(2026-07-29) — 절대 쓰지 말 것.
// pro-latest 확정: LOW+규칙8(6회 반복 26초 평균·완전성 6/6)이 속도·완전성 균형점.
// 2026-07-30 실측 발견: gemini-2.5-flash는 'thinkingLevel' 필드 자체가 400("Thinking level is
// not supported for this model")으로 아예 미지원 — 2.5 계열은 thinkingBudget(정수, -1=dynamic)
// 방식만 받는다. 모델별로 지원 필드가 달라 분기 처리.
const SYNTH_CONFIG = ANSWER_MODEL.startsWith('gemini-2.5')
  ? { temperature: 0.3, thinkingConfig: { thinkingBudget: -1 } }
  : { temperature: 0.3, thinkingConfig: { thinkingLevel: 'LOW' } };

/**
 * Gemini로 실제 답변 문장을 스트리밍으로 합성한다(체감 대기시간 단축 — 실제 생성시간은
 * 그대로지만 화면엔 조각조각 바로 뜬다). 근거 페이지가 없거나 키가 없으면 아무것도
 * yield하지 않고 바로 끝난다(호출부가 "근거없음"·"키없음"으로 구분해 처리).
 * @param {string} query
 * @param {Array} contextPages - search()의 contextPages
 * @yields {string} 답변 텍스트 조각(delta)
 */
async function* synthesizeAnswerStream(query, contextPages) {
  if (!contextPages.length) return;
  if (!gemini.hasAnyKey()) throw new Error('GEMINI_API_KEY 미설정');
  const prompt = `${ANSWER_RULES}\n\n[근거자료]\n${buildContextBlock(contextPages)}\n\n질문: "${query}"\n답:`;
  yield* gemini.callGeminiStream({ model: ANSWER_MODEL, contents: prompt, config: SYNTH_CONFIG, caller: 'Legal-Ask' });
}

module.exports = { loadIndex, search, synthesizeAnswerStream, classifyTier, extractCitationChain, lookupContact };
