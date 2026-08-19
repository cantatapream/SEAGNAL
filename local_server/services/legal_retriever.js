/**
 * ============================================================================
 * 파일명: services/legal_retriever.js
 * 역할: 나리야 법률 챗봇 — 하이브리드 검색(직접매칭+glossary+그래프홉) + Gemini 답변 합성
 * ============================================================================
 *
 * [설명]
 * `_CHATBOT.md` 4절(검색)·3절(인용규율)·5절(답변 경계)·1-B절(되묻기)의 답변엔진 구현체(Phase E,
 * 1차: 수산업법·어선법·어선안전조업법 3법 파일럿). routes/legal.js의 POST /api/legal/ask가
 * 이 모듈의 search()로 근거 후보를 찾고, decideClarify()로 "되물어야 하는 질문인지" 한 번 걸러낸 뒤,
 * 되물을 게 없을 때만 synthesizeAnswerStream()으로 실제 문장 답변을 스트리밍 생성한다.
 *
 * [검색 단계]
 *  ① 메타데이터 매칭(법명·주제·파일명·테마) — index.json
 *  ② glossary 구어 매핑(_glossary.md) — "정식 명칭이 아닌 말"을 개념으로 번역
 *  ③ 본문 직접매칭 — 후보 페이지의 실제 마크다운 본문을 읽어 재점수(제목·본문 포함 시 가중)
 *  ④ 그래프 1홉 확장 — 최상위 페이지의 index.json `links` 로 이어진 페이지를 **같은 관련도 문턱
 *     (MIN_KEEP_SCORE)으로 다시 채점해** 통과한 것만 덧붙인다. 문턱을 씌운 뒤로는 ③에서 이미 점수를
 *     받았던 페이지(개수 컷 PRIMARY_TOPK 에 밀린 11위 이하)만 들어올 수 있어, "키워드로는 안 잡히는
 *     페이지를 그래프로 건져온다"는 원래의 추가 리콜 효과는 사실상 없다(실측: 위키 topic 400개 +
 *     대표질문 68개 전수 질의에서 홉이 상위 5위 인용사슬에 든 사례 0건). 무관한 페이지가 근거로
 *     딸려오는 것을 막는 쪽을 택한 트레이드오프다 — search() 안 주석 참고.
 * ※ 의미 임베딩(_CHATBOT.md 4-③)은 이번 파일럿 범위 밖(3법 규모에선 ①②③④로 충분히
 *   커버되는지 먼저 확인 — 필요해지면 topic_embedding.js 패턴을 재사용해 후속 추가).
 *
 * [되묻기] 조건에 따라 답이 완전히 갈리는 질문(예: "낚싯배에서 술 마시면 처벌?" — 바다냐 하천이냐,
 *   조타 담당이냐 승객이냐)은 모든 경우를 나열하는 대신 decideClarify()가 질문+선택지(최대 10개)를 만들어
 *   화면에 버튼으로 내려준다. 선택지는 그 순간 검색된 근거 조문에 **실제로 있는 구분**에서만 만든다.
 *
 * [환각 0] canonicalOnly=true면 concept·comparison은 status:canonical만 근거로 채택(statute는 통과).
 *   실제 답 문장은 항상 [근거자료]로 전달된 위키 원문에서만 만들도록 프롬프트로 강제.
 *
 * [연계 파일]
 * - knowledge/legal/_dashboard/index.json  → 페이지 메타 색인(법·주제·테마·links, comparison 포함 2026-08-01~)
 * - knowledge/legal/wiki/concepts|statutes|comparisons/*.md → 실제 본문(직접매칭·답변 근거)
 * - knowledge/legal/wiki/_glossary.md       → 구어→개념 매핑표
 * - knowledge/legal/_dashboard/law_raw_paths.json → 법명 → raw 폴더 경로(2차 "미검증 참고" 조회용)
 * - services/gemini_client.js               → 답변 합성 LLM 호출
 * - services/github_raw.js                  → 2차 조회가 읽는 법령 원문(GitHub 온디맨드)
 * - routes/legal.js                         → POST /api/legal/ask 가 이 모듈을 호출
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const gemini = require('./gemini_client');
const githubRaw = require('./github_raw');

const LEGAL_DIR = path.join(__dirname, '..', 'knowledge', 'legal');
const INDEX_JSON = path.join(LEGAL_DIR, '_dashboard', 'index.json');
const LAW_RAW_PATHS_JSON = path.join(LEGAL_DIR, '_dashboard', 'law_raw_paths.json');
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
// 페이지당 컨텍스트 상한(비용·컨텍스트 관리).
// ★4000 → 10000 (2026-08-18 사용자 확정). 4000은 2026-07-29 파일럿 시절 기본값이 그대로 굳은
//   것인데, 그 뒤 위키가 20배 넘게 커지는 동안 한 번도 재검토되지 않았다. 실측 근거:
//   · 위키 1,254개 중 4000자 이하는 **14.4%뿐**(중앙값 8,921자)이라 대부분의 페이지가 잘려 나갔다.
//     10000자면 **56.8%**가 통째로 들어간다.
//   · 실사용 실패가 이 한도에서 났다 — 낚시어선업 신고(9,375자)에서 신청서류(어선검사증서 등)가
//     4000에선 빠지고 10000에선 들어온다(직접 재현 확인).
//   · 비용: 질문 4개 실측으로 한 질문당 보내는 글자가 약 49,500 → 110,000자(2.2배).
//     gemini-2.5-flash 입력 단가 기준 질문당 약 21원 → 46원(+25원). 되묻기 판단은 별도 상한
//     (CLARIFY_BODY_CHARS=1500)이라 이 인상과 무관하다.
//   · 남는 비용은 **속도** — 넣는 양이 2배면 답변 생성이 그만큼 느려진다(사용자도 인지·수용).
const MAX_BODY_CHARS = 10000;
// ★순위에 따라 본문 예산을 달리 준다(2026-08-19). 종전에는 후보 12~15개 **전부**에 10,000자를
//   똑같이 줘서 한 질문에 평균 11만 자(≈3만 토큰)를 모델에 밀어넣었다. 고정 문항 25개로 재보니
//   **답에 실제로 필요한 문장은 24건이 1~3위 페이지 안에** 있었고(21건은 1위), 4위 이하 페이지가
//   그 문장을 담은 경우는 한 건도 없었다. 그런데도 4위 이하가 페이지당 8,500자씩 자리를 차지했다.
//   ⚠뒤 순위를 **버리지 않는다** — 예산만 줄인다. sliceRelevant 가 질문과 가까운 절부터 담으므로
//     예산이 줄면 덜 관련된 절부터 빠진다(뚝 끊기지 않는다). 배경설명용으로 뒤 페이지가 필요한
//     질문도 있어 통째로 빼는 것은 위험하다("누락 0").
//   ⚠근거 조문 표(citationChain)는 이 예산과 **무관하다** — 아래 sources 는 잘리지 않은 본문에서
//     뽑으므로, 예산을 줄여도 근거 목록에서 줄이 사라지지 않는다.
const TOP_FULL_RANK = 3;        // 1~3위 — 예산 그대로
const MID_LAST_RANK = 6;        // 4~6위
const MID_BODY_CHARS = 5000;
const TAIL_BODY_CHARS = 3000;   // 7위 이하
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
    // ⚠셀을 직접 정규식으로 쪼개지 마라 — 이 표의 목적지 칸에는 `[[대상|라벨]]` 처럼 **링크 안에
    //   파이프가 든** 표기가 흔한데(실측 396행 중 63행, 15.9%), `[^|]+` 로 칸을 잡으면 그 줄이
    //   통째로 매치 실패해 조용히 버려진다. 금어기·금지체장·TAC·조개껍데기·어업인·국가어항 같은
    //   실사용 빈도가 높은 구어가 그렇게 22라운드 동안 런타임 캐시에서 빠져 있었다(2026-08-18
    //   횡단 감사관 발견, 재현 확인). 문서·xref_check 는 정상이라 코드만 실패했다.
    //   → 아래 tableCells() 는 링크 안 파이프를 보호해 쪼개므로 그걸 그대로 쓴다(같은 표 파싱
    //     로직을 두 벌 두지 않는다 — 한쪽만 고쳐지는 어긋남 방지).
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('|')) continue;
      const c = tableCells(t);
      if (c.length < 2 || isSepRow(c) || c[0] === '구어·별칭') continue;
      const terms = c[0].split(/[,，]/).map(s => s.trim()).filter(Boolean);
      const slugs = [];
      const linkRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      let lm; while ((lm = linkRe.exec(c[1])) !== null) slugs.push(lm[1].trim());
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

// ── 법령 약칭표 캐시(mtime 감지) — B8 ─────────────────────────────────────
// `_dashboard/law_aliases.json` 은 law.go.kr DRF 검색 API 의 `법령약칭명` 필드를 그대로 모은 표다
// ({항목:[{정식명,약칭,…}], 충돌:{같은약칭_다른법:[…], 약칭이_다른법_정식명:[…]}}).
// 사용자는 「어선안전조업법」처럼 약칭으로 묻는데 위키·index.json 은 정식 명칭으로 돼 있어,
// 약칭만으로는 그 법 페이지가 검색에 안 걸린다 — 질의어 확장 단계에서 정식명을 얹어 준다.
// ⚠ **모호하지 않은(후보가 유일한) 약칭만** 쓴다: ⓐ표의 `충돌` 목록에 이름이 오른 약칭 ⓑ한 약칭이
//   서로 다른 정식명 둘 이상에 붙은 경우 ⓒ약칭이 다른 법의 정식명과 같은 경우 — 전부 뺀다.
//   모호한 약칭을 쓰면 엉뚱한 법이 근거로 딸려 올라온다("무관한 줄이 붙는 게 더 나쁘다").
// ⚠ 파일이 없거나 깨져 있으면 **없는 셈 치고** 빈 표를 쓴다(기존 동작 그대로 — R0).
const LAW_ALIASES_JSON = path.join(LEGAL_DIR, '_dashboard', 'law_aliases.json');
let _aliasCache = null, _aliasMtime = 0;

/** 중첩된 값 안의 문자열을 전부 그러모은다(`충돌` 항목 모양이 표마다 달라 형태를 단정하지 않는다). */
function collectStrings(v, out) {
  if (typeof v === 'string') { const s = v.trim(); if (s) out.add(s); return out; }
  if (Array.isArray(v)) { for (const x of v) collectStrings(x, out); return out; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) collectStrings(v[k], out); return out; }
  return out;
}

/**
 * 약칭표를 읽어 **모호하지 않은** 약칭↔정식명 대응만 만든다.
 * @returns {{alias:Map<string,string>, byFormal:Map<string,string[]>}} 파일이 없으면 빈 Map 두 개
 * [연계] ← aliasExpand(검색어 확장) · lawMentionedInAnswer(B3) · routes/legal.js GET /api/legal/aliases(계약4).
 */
function loadLawAliases() {
  try {
    const mt = fs.statSync(LAW_ALIASES_JSON).mtimeMs;
    if (_aliasCache && mt === _aliasMtime) return _aliasCache;
    const obj = JSON.parse(fs.readFileSync(LAW_ALIASES_JSON, 'utf8'));
    const items = Array.isArray(obj.항목) ? obj.항목 : [];
    const banned = collectStrings(obj.충돌, new Set());
    const formals = new Set(items.map(it => String((it && it.정식명) || '').trim()).filter(Boolean));
    const seen = new Map();                       // 약칭 → 붙은 정식명 집합
    for (const it of items) {
      const a = String((it && it.약칭) || '').trim();
      const f = String((it && it.정식명) || '').trim();
      if (!a || !f) continue;
      if (!seen.has(a)) seen.set(a, new Set());
      seen.get(a).add(f);
    }
    const alias = new Map(), byFormal = new Map();
    for (const [a, fs2] of seen) {
      if (fs2.size !== 1 || banned.has(a) || formals.has(a)) continue;   // 모호 — 쓰지 않는다
      const f = [...fs2][0];
      alias.set(a, f);
      if (!byFormal.has(f)) byFormal.set(f, []);
      byFormal.get(f).push(a);
    }
    // [2026-08-17] 정식명 → 법령 구분(법률·대통령령·해양수산부령…). classifyTier 가 이름만 보고
    //   틀리는 경우(대통령령인데 이름이 `…규정`이라 고시로 분류)를 실제 값으로 바로잡는다.
    const kind = new Map();
    for (const it of items) {
      const f = String((it && it.정식명) || '').trim();
      const k = String((it && it.구분) || '').trim();
      if (f && k && !kind.has(f)) kind.set(f, k);
    }
    _aliasCache = { alias, byFormal, kind }; _aliasMtime = mt;
  } catch (_) {
    if (!_aliasCache) _aliasCache = { alias: new Map(), byFormal: new Map(), kind: new Map() };
  }
  return _aliasCache;
}

/** 정식명 → 그 법의 모호하지 않은 약칭 목록(없으면 []). [연계] ← lawMentionedInAnswer(B3). */
function aliasesOfFormalName(formal) {
  return loadLawAliases().byFormal.get(String(formal || '').trim()) || [];
}

/**
 * 질문에 약칭이 들어 있으면 그 **정식 명칭**을 검색어로 얹는다(glossaryExpand 와 같은 규약 —
 * 띄어쓰기 무시 비교, 질의 문자열 자체는 건드리지 않고 추가 검색어만 돌려준다).
 * 예: aliasExpand('어선안전조업법상 정박신고는?')
 *     → ['어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률', '어선안전조업', …]
 * ⚠ 2글자 약칭은 우연 일치가 잦아(예: 흔한 낱말과 겹침) 3글자 이상만 본다.
 * ⚠ 정식명을 쪼갠 낱말도 **3글자 이상만** 얹는다 — `등에`·`대한`·`관한`·`법률`은 거의 모든 법 페이지
 *   본문에 있어(scoreOne 이 본문 매칭에 +2를 준다) 순위를 통째로 평평하게 만든다. 검색의 진짜
 *   신호는 정식명 전체(법령명 칸 완전일치)이고, 쪼갠 낱말은 띄어쓰기가 다른 표기를 위한 보조다.
 * @param {string} query
 * @returns {string[]} 추가 검색어(중복 제거). 표가 없으면 []
 * [연계] ← search(). scoreOne 이 law/topic/본문에 이 낱말이 있는지로 점수를 매긴다.
 */
function aliasExpand(query) {
  const qFlat = String(query || '').replace(/\s+/g, '');
  const out = [];
  for (const [a, formal] of loadLawAliases().alias) {
    if (a.length < 3 || !qFlat.includes(a.replace(/\s+/g, ''))) continue;
    out.push(formal);
    for (const w of formal.split(/[\s·ㆍ・]+/)) if (w.length >= 3) out.push(w);
  }
  return [...new Set(out)];
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
// ── 행정규칙(고시) 이름 사전 — raw 에 실제로 수집된 파일명으로 만든다(2026-08-17, A-3 실측) ──
// `패류채취어업 중 잠수기 사용지역 및 패류의 종류`·`한국해양교통안전공단 정관`처럼 **이름에
// 고시·지침·규정 같은 낱말이 하나도 없는 행정규칙**이 실제로 있다. 키워드 규칙만으로는 '법률'로
// 떨어져 근거 카드 배지와 원문 링크가 틀렸다(A-3이 10건 보고). 목록을 손으로 적는 대신
// `raw/*/*/행정규칙/*.txt` 파일명을 그대로 사전으로 쓴다 — 수집이 늘면 사전도 저절로 늘고,
// 우리가 원문을 가진 것만 인정하므로 지어낼 여지가 없다.
let _admrulNames = null;
function admrulNameSet() {
  if (_admrulNames) return _admrulNames;
  const out = new Set();
  try {
    const rawRoot = path.join(LEGAL_DIR, 'raw');
    for (const dom of fs.readdirSync(rawRoot)) {
      const domDir = path.join(rawRoot, dom);
      if (!fs.statSync(domDir).isDirectory()) continue;
      for (const law of fs.readdirSync(domDir)) {
        const dir = path.join(domDir, law, '행정규칙');
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
          if (f.endsWith('.txt')) out.add(flatName(f.slice(0, -4)));
        }
      }
    }
  } catch (_) { /* raw 가 없으면 빈 사전 — 종전 규칙대로 동작한다 */ }
  _admrulNames = out;
  return out;
}

/** 이름 비교용 정규화 — 공백·가운뎃점·괄호·붙임표만 지운다(글자 자체는 안 바꾼다). */
function flatName(s) {
  return String(s || '').replace(/[\s·ㆍ\-_()（）「」]/g, '');
}

function classifyTier(lawName) {
  const s = String(lawName || '');
  if (s.includes('시행령')) return 'decree';
  if (s.includes('시행규칙')) return 'rule';
  // ★이름만 보고 정하기 전에 **실제 법령 구분**을 먼저 본다(2026-08-17, A-1 실측 지적).
  //   `해양경찰위원회 규정`·`공무원보수규정`처럼 **대통령령인데 이름이 `…규정`으로 끝나는** 법령이
  //   아래 키워드 규칙에 걸려 고시(notice)로 분류됐다 — 배지가 틀리고 원문 링크도 행정규칙 쪽으로 갔다.
  //   약칭표(`law_aliases.json`)에 그 법의 `구분`(법률/대통령령/○○부령)이 API 값 그대로 들어 있으므로
  //   **정식명 완전일치일 때만** 그 값을 쓴다(부분일치·추측 금지). 표에 없는 이름은 종전 규칙대로.
  // 우리가 원문을 가진 행정규칙 이름이면 곧바로 고시다(이름에 키워드가 없어도).
  if (admrulNameSet().has(flatName(s))) return 'notice';
  const kindMap = loadLawAliases().kind;
  const kind = kindMap && kindMap.get(s.trim());
  if (kind) {
    if (kind === '법률' || kind === '헌법') return 'law';
    if (kind === '대통령령') return 'decree';
    if (/령$|규칙$/.test(kind)) return 'rule';        // ○○부령·총리령·대법원규칙
  }
  if (/고시|지침|훈령|예규|규정|요령|행정규칙|통항규칙/.test(s)) return 'notice';
  // `…기준`으로 끝나는 이름은 거의 전부 고시다(P0 선행 실측: 위키 근거조문 표에 쓰인 '기준' 포함
  // 법령명 92종 중 선박구명설비기준·어선설비기준·선박기관기준·선박소방설비기준·선박복원성기준·
  // 위험물 선박운송 기준·어선원 안전ㆍ보건 및 재해예방 기준 등이 전부 'law'로 잘못 분류돼
  // 배지가 '법률'로 떴다). 종전 목록의 `작성기준`도 이 규칙에 포함된다.
  // ⚠ 이름이 `…법`·`…법률`로 끝나면 법률이다 — 그쪽이 우선이라 여기서 가로채지 않는다.
  //   (시행령·시행규칙은 위에서 이미 걸러졌다.)
  if (/기준/.test(s) && !/(법|법률)\s*$/.test(s)) return 'notice';
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
 * `## <제목>` 절 바로 아래에 붙은 마크다운 표의 줄만 잘라낸다(헤더 + 구분선 + 행들).
 * 표가 없거나 표를 만나기 전에 다음 절로 넘어가면 [].
 * @param {string} txt - 페이지 마크다운 본문
 * @param {RegExp} headRe - 절 제목 정규식(m 플래그 필요)
 * @returns {string[]} 표 줄들(원문 그대로, 앞뒤 공백만 제거)
 * [연계] ← extractCitationChain(근거 조문 표) · extractGapNotices(타법 연결 표). 둘이 같은 방식으로
 *   표를 찾아야 해서 한 군데에 둔다(중복 파싱 로직 금지 — 한쪽만 고쳐지는 어긋남 방지).
 */
function sectionTable(txt, headRe) {
  const hm = headRe.exec(String(txt || ''));
  if (!hm) return [];
  const lines = String(txt).slice(hm.index + hm[0].length).split('\n');
  const table = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('|')) { table.push(t); continue; }
    if (table.length) break;          // 표가 끝났다
    if (t.startsWith('#')) break;     // 표를 만나기 전에 다음 절로 넘어갔다
  }
  return table;
}

// ⚠ 위키 표 셀 안에 [[statutes/해양환경관리법|해양환경관리법]] 처럼 파이프가 든 링크가 그대로
// 쓰여 있다(마크다운 규칙상 원래는 이스케이프해야 하지만 관행이 그렇다) — 그냥 '|'로 쪼개면
// 링크가 두 칸으로 찢어져 법령명이 "[[statutes/해양환경관리법"이 된다. 쪼개기 전에 링크 안의
// 파이프만 잠시 치환해 보호한다.
const CELL_PIPE = '\u0000';
/** 표 한 줄을 셀 배열로 쪼갠다(링크 안 파이프 보호 + 앞뒤 파이프 제거). */
function tableCells(row) {
  return String(row)
    .replace(/\[\[[^\]]*\]\]/g, m => m.replace(/\|/g, CELL_PIPE))
    .replace(/^\|/, '').replace(/\|$/, '')
    .split('|').map(c => c.split(CELL_PIPE).join('|').trim());
}

/** 마크다운 표의 구분선(`|---|---|`) 행인가. */
function isSepRow(cells) {
  return /^-+$/.test((cells[0] || '').replace(/:/g, ''));
}

/**
 * 페이지 본문에서 `## 근거 조문` 표를 파싱해 위임 사슬 배열을 만든다.
 * ⚠ 이 위키는 여러 세션·에이전트가 몇 달에 걸쳐 써서 표 헤더의 컬럼 순서가 페이지마다 다르다
 * (`법령명|조문|시행일|요지` 도 있고 `단계|법령|조문|시행일|요지` 도 있다) — 그래서 컬럼 위치가
 * 아니라 **헤더 텍스트**로 각 컬럼을 찾는다. 표가 없거나 파싱이 안 되면 예외 없이 []를 반환한다
 * (이 표가 없는 페이지도 많다 — 그런 페이지는 화면이 단순 폴백 카드로 그린다).
 * ⚠ 법령 칸의 `〃`(반복기호, 실측 82행)는 여기서 편다 — 표 안에서만 뜻이 통하는 약식 표기라
 *   그대로 내보내면 화면 카드에 "〃 제32조"라는 뜻 모를 이름이 뜨고, 조문 원문 조회도 법을 못 찾아
 *   실패한다. 뜻은 "바로 윗 행의 법령 칸과 같다" 하나뿐이라 해석의 여지가 없다.
 * ⚠ `단계` 칸(`① 금지·정의·측정`·`② 형벌(5톤 이상)` 처럼 그 행이 사슬의 어느 마디인지 적어둔 칸,
 *   실측 358개 표)도 함께 싣는다 — 예전엔 통째로 버렸는데, **처벌 여부 신호가 요지가 아니라 이 칸에만
 *   있는 행**이 실제로 있다(해상교통안전법 제113조: 단계 `② 형벌(5톤 이상)` / 요지 `구간·재범·측정거부
 *   형량` — 요지만 보면 처벌 낱말이 없어 화면 배지가 '벌칙'이 아닌 '법률'로 떴다. 라이브 실측).
 *   헤더가 `단계`인 칸만 받는다 — 첫 칸 이름이 `적용대상`인 표가 더 흔한데(실측 650행) 그건 "누구에게
 *   적용되나"라 뜻이 전혀 다르다. 근거 조문 표의 첫 칸 이름을 전수 조사한 결과 사슬 마디를 뜻하는
 *   이름은 `단계` 하나뿐이었다(`구분`·`항목`은 근거 조문 표에 쓰인 적이 없다).
 * @param {string} body - 페이지 마크다운 본문(frontmatter 제외)
 * @returns {Array<{law:string,article:string,effectiveDate:string,gist:string,tier:string,step:string}>}
 *          원 표 순서 그대로(step은 `단계` 칸이 없는 표에서는 '')
 * [연계] ← search()가 상위 소스에 붙임 → ai_chat.js 체인 UI(step은 isPenaltyRow 판정에 함께 쓰인다).
 */
function extractCitationChain(body) {
  try {
    const table = sectionTable(body, /^#{2,3}\s*근거\s*조문[^\n]*$/m);
    if (table.length < 3) return [];    // 헤더 + 구분선 + 최소 1행
    const head = tableCells(table[0]);
    const col = re => head.findIndex(h => re.test(h));
    const iLaw = col(/법령|법률명/);
    const iArt = col(/조문/);
    const iEff = col(/시행일|발령/);
    const iGist = col(/요지|내용|비고/);
    // 헤더 완전일치로만 잡는다(부분일치로 열면 `적용대상`·`처리단계` 같은 다른 뜻의 칸이 딸려온다).
    const iStep = col(/^단계$/);
    if (iLaw < 0) return [];

    const out = [];
    let prevLaw = '';                     // 바로 윗 행의 법령 칸(〃가 물려받는다)
    for (const row of table.slice(2)) {   // 0=헤더, 1=구분선
      const c = tableCells(row);
      if (isSepRow(c)) continue;
      let law = plainCell(c[iLaw]);
      if (!law || law === '—' || law === '-') continue;
      if (/^[〃″"]+$/.test(law.replace(/\s+/g, '')) && prevLaw) law = prevLaw;
      prevLaw = law;
      out.push({
        law,
        article: iArt >= 0 ? plainCell(c[iArt]) : '',
        effectiveDate: iEff >= 0 ? plainCell(c[iEff]) : '',
        gist: iGist >= 0 ? plainCell(c[iGist]) : '',
        step: iStep >= 0 ? plainCell(c[iStep]) : '',
        tier: classifyTier(law),
      });
    }
    return out;
  } catch (_) { return []; }
}

/**
 * 페이지 본문의 `## 타법 연결` 표에서 **관계 칸이 "수집곤란"인 행만** 뽑는다.
 * 이 위키에는 "시·군·구가 개별 고시로 정해 국가법령정보센터에 안 올라오는 사항"처럼 우리가
 * 원문을 가질 수 없는 공백이 사람 손으로 정직하게 적혀 있는데(실측 2행), `extractCitationChain`은
 * `## 근거 조문` 표만 보므로 이 안내가 답변 화면에 전혀 실리지 않았다 — 그 결과 "관할 지자체에
 * 물어보세요"라는 꼭 필요한 안내가 사용자에게 안 보였다.
 * ⚠ 관계 칸을 **컬럼으로** 확인한다(L-52와 같은 원칙 — 위치가 아니라 헤더 텍스트로 컬럼을 찾는다).
 *   행 전체 텍스트에 "수집곤란" 글자가 있는지로 보면, 관계가 `정밀인용`인 국제조약 행(SOLAS·나고야
 *   의정서 — 설명 문장 안에 "수집곤란"이라고 적혀 있을 뿐이다)까지 딸려 나와 위키에 없는 안내가
 *   상시 노출된다(실측 2행). 그건 "환각 0" 위반이다.
 * ⚠ 문구는 **위키에 적힌 그대로** 옮긴다(요약·재작성·생성 금지 — 이 저장소의 환각 0 원칙).
 * 예: extractGapNotices(낚시어선안전조치와승객준수사항.md 본문)
 *     → [{title:'시·군·구별 낚시어선 승객 준수사항 고시(제35조②)',
 *         note:'수집곤란 — 시장·군수·구청장이 개별적으로 정하여 고시 … 관할 지자체 소관 부서로 확인하시는 것이 정확합니다.'}]
 * @param {string} body - 페이지 마크다운 본문(frontmatter 제외)
 * @returns {Array<{title:string, note:string}>} 없으면 []
 * [연계] ← search()가 상위 소스에 붙임 → routes/legal.js sourcesOut → ai_chat.js 의 ⚠칩.
 */
function extractGapNotices(body) {
  try {
    const table = sectionTable(body, /^#{2,3}\s*타법\s*연결[^\n]*$/m);
    if (table.length < 3) return [];    // 헤더 + 구분선 + 최소 1행
    const head = tableCells(table[0]);
    const iTitle = head.findIndex(h => /인용|법령|조문|대상/.test(h));
    const iRel = head.findIndex(h => /^관계/.test(h));
    if (iTitle < 0 || iRel < 0) return [];
    const out = [];
    for (const row of table.slice(2)) { // 0=헤더, 1=구분선
      const c = tableCells(row);
      if (isSepRow(c)) continue;
      if (!/^수집\s*곤란$/.test(plainCell(c[iRel]))) continue;
      const title = plainCell(c[iTitle]);
      const note = c.filter((_, i) => i !== iTitle).map(plainCell).filter(Boolean).join(' — ');
      if (title && note) out.push({ title, note });
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
function scoreOne(p, terms, weights) {
  const w = t => (weights && weights.get(t)) || 1;
  const hay = (p.law || '') + ' ' + (p.topic || '') + ' ' + (p.file || '') + ' ' + (p.themes || []).join(' ');
  let s = 0;
  for (const t of terms) if (hay.includes(t)) s += ((p.law && p.law.includes(t)) ? 2 : 1) * w(t);
  const page = readPage(p.kind, p.file);
  if (page) {
    const title = p.topic || p.law || '';
    for (const t of terms) {
      if (title.includes(t)) s += 3 * w(t);
      else if (page.body.includes(t)) s += 2 * w(t);
    }
  }
  return s;
}

/**
 * 검색어마다 **흔한 정도에 따른 무게**를 매긴다(흔할수록 가볍게).
 * ★왜(2026-08-18 라이브 검증 B유형, 오프라인 재현): 지금까지는 모든 낱말이 같은 무게였다.
 *   그래서 질문이 길어질수록 `신고`·`기준`·`정확히` 같은 **흔한 말이 점수를 지배**해, 그 말들을
 *   두루 가진 엉뚱한 법이 정작 핵심어를 가진 법을 밀어냈다. 실측 —
 *     "양식장 휴업 과태료"                                        → 양식산업발전법 2위
 *     "양식장 무단 휴업 신고 안 하면 과태료가 얼마인지, 별표3 기준으로…"  → **후보에도 못 듦**
 *   같은 뜻인데 흔한 말 몇 개가 붙었다고 답에 못 닿는 것은 사용자가 길게 물을수록 나빠진다는 뜻이다.
 * 무게는 `log(1 + 전체페이지수 / 그 낱말이 걸린 페이지수)` — 흔할수록 1에 가까워지고 드물수록 커진다.
 *   ⚠임의의 문턱(몇 % 넘으면 버림)을 두지 않는다. 문턱은 그 언저리에서 결과가 뚝 끊겨 예측이 안 된다.
 *   ⚠낱말을 **버리지 않는다** — 무게만 낮춘다. 흔한 말도 여전히 점수에 기여한다(누락 0 원칙).
 * 예: 1,254개 페이지 중 `신고`가 900개에 있으면 무게 ≈ 0.9, `양식장`이 20개면 ≈ 4.2.
 * @param {Array} pages - index.json 의 페이지 목록
 * @param {string[]} terms - 이번 질의의 검색어 전부
 * @returns {Map<string,number>} 낱말 → 무게
 * [연계] → scoreOne(무게를 곱해 점수를 낸다). ← search().
 *        검증: `_dashboard/loop/search_eval.js`(고정 질문 65개로 전후 대조, AI 안 씀).
 */
function termWeights(pages, terms) {
  // A/B 측정용 스위치 — `NRYA_IDF=off` 면 모든 낱말 무게가 1이라 **이 기능을 넣기 전과 문자 그대로
  // 같은 점수**가 나온다(R0). 위키가 계속 바뀌는 중에도 같은 시점에서 켜고/끄고 재려고 둔다.
  // 운영에서는 켠 채로 쓴다(끄는 값을 설정하지 않는다).
  if (process.env.NRYA_IDF === 'off') return null;
  const df = new Map(terms.map(t => [t, 0]));
  for (const p of pages) {
    const hay = (p.law || '') + ' ' + (p.topic || '') + ' ' + (p.file || '') + ' ' + (p.themes || []).join(' ');
    const page = readPage(p.kind, p.file);
    const body = page ? page.body : '';
    for (const t of terms) if (hay.includes(t) || body.includes(t)) df.set(t, df.get(t) + 1);
  }
  const N = pages.length || 1;
  return new Map(terms.map(t => [t, Math.log(1 + N / Math.max(1, df.get(t) || 0))]));
}

// ── 컨텍스트 발췌(sliceRelevant) 보조 상수 ───────────────────────────────────
// [A] 질의어 관련도와 **무관하게 통째로 먼저** 싣는 소제목. 근거·처벌·서식은 "관련 있어 보이는
//   절"이 아니라 답 그 자체라, 점수 경쟁에서 밀려 빠지면 AI가 위키에 뻔히 있는 처벌 근거를
//   "확인되지 않습니다"라고 답한다(2026-08-17 실측 — 낚시어선업 신고 질의에서 `## 근거 조문`
//   `## 위반 시 처벌` `## 제출 서식`이 통째로 안 실렸다).
// ⚠ **시작 문자열**로만 맞춘다 — 실제 위키에 `## 제출 서식 (다운로드)`처럼 꼬리가 붙은 변형이 있다.
// ⚠ 서식은 `다운로드`가 붙은 표기만 넣는다 — `## 서식 목록`·`## 서식 필드 구성`·`## 서식(별지) 인덱스`는
//   전체 서식 이름을 나열한 큰 색인이라 어느 질문에서든 통째로 실으면 예산을 그것만으로 다 쓴다.
//   (실제 표기는 `grep -rh "^## " wiki/ | sort -u` 로 전수 확인해 맞췄다.)
const MUST_SECTIONS = ['## 근거 조문', '## 위반 시 처벌', '## 벌칙 체계', '## 행정처분 체계',
  '## 제출 서식', '## 서식 다운로드', '## 서식(별지) 다운로드', '## 서식(다운로드)'];
// [A] 그 "항상 포함"이 예산을 통째로 먹어버리면 **정작 질문에 맞는 절**이 밀려난다 — 실측으로
//   재현했다: 형사절차_일반.md "선고유예" 질의에서 `## 근거 조문`(2,850자)이 먼저 들어가자
//   정답 절인 `## 6. 선고유예·집행유예와 전과기록`이 통째로 빠졌다. 4,000자 넘는 위키 1,073개 중
//   138개는 항상포함 절 합계만 4,000자를 넘어(최대 12,946자) 그대로 두면 그 138개는 발췌가 아예
//   안 돌아간다. 그래서 항상포함에 쓸 수 있는 예산을 **절반까지**로 묶고, 넘치는 절은 버리지 않고
//   아래 점수 경쟁으로 내린다(질문과 관련 있으면 거기서 다시 뽑힌다).
const MUST_BUDGET_RATIO = 0.5;
// [B-1] 절 하나가 이보다 크면 절 안을 한 번 더 쪼개 조각끼리 점수를 매긴다. 4,000자 예산에서
//   2,000자짜리 절은 한 입에 예산 절반을 먹어 "통째로 들어가거나 통째로 밀리거나" 둘뿐이다
//   (실측: 공유수면관리및매립에관한법률__매립면허.md 의 `## 의무 내용` 한 절이 9,487자).
//   ⚠ 표(`| … |`)만으로 된 절은 불릿·빈 줄 경계가 없어 자연히 안 쪼개진다 — 표는 통째로 남는다.
const SUBSPLIT_MIN_CHARS = 2000;
const SUBCHUNK_MIN_CHARS = 500;      // 조각 최소 크기(불릿 하나마다 쪼개 조각이 수백 개 되는 것 방지)
// [C] 절이 사실상 없는 초대형 문서 — 발췌할 단위 자체가 없어 어떤 로직도 손 쓸 방법이 없다.
//   ★임계값 근거(전수 실측): 위키 1,254개 중 30,000자 초과가 68개인데 그중 `## ` 절이 2개 이하인 것은
//   **단 1개**(선박교통관제에관한법률__고시_별표1_구역좌표및관제통신제원.md, 144,064자·절 2개)다.
//   즉 이 조건은 정상적인 중간 크기 문서를 하나도 건드리지 않고 문제 문서만 정확히 집는다.
const HUGE_BODY_CHARS = 30000;
const HUGE_MAX_SECTIONS = 2;
const HUGE_PREVIEW_CHARS = 500;
// [B-2] ★환각 0: 조용히 자르지 않는다. 잘렸다는 사실을 AI에게 알려 "여기 없는 것"을 "없는 것"으로
//   단정하지 않게 한다(이 파일의 다른 프롬프트가 쓰는 "확인되지 않습니다" 관례와 같은 톤).
const PARTIAL_NOTE = '\n\n> (발췌 안내) 이 문서는 원문이 더 깁니다 — 질문과 관련 있는 부분만 실었으므로 ' +
  '여기 없는 내용이 있을 수 있습니다. 위 발췌에서 근거를 못 찾은 사항은 "확인되지 않습니다"라고 답하고, ' +
  '규정이 없다고 단정하지 마세요.';
const HUGE_NOTE = '> (발췌 안내) 이 문서는 원문이 방대하고 소제목으로 나뉘어 있지 않아 본문을 싣지 않았습니다. ' +
  '아래는 맨 앞부분 미리보기뿐입니다 — 여기 없는 내용은 "확인되지 않습니다"라고 답하고, 원문 전체는 ' +
  '별표·서식 다운로드 버튼으로 안내하세요.';

/** 이 절이 [A] "관련도와 무관하게 항상 싣는" 소제목으로 시작하는가. */
function isMustSection(sec) {
  return MUST_SECTIONS.some(h => sec.startsWith(h));
}

/**
 * 절 하나가 너무 커서 "통째로 들어가거나 통째로 밀리거나"밖에 안 되면(SUBSPLIT_MIN_CHARS 이상)
 * 절 안을 불릿(`- `)·빈 줄 경계로 한 번 더 쪼개 작은 후보로 만든다([B-1]).
 * 조각마다 **소제목 줄을 다시 붙인다** — 안 붙이면 조각이 어느 절 내용인지 AI가 알 수 없다
 * (본문에 없는 말을 만드는 게 아니라 그 절의 제목 줄을 그대로 복사할 뿐이다 — 환각 0 유지).
 * 예: splitSection('## 의무 내용\n- 가...\n- 나...')  // SUBSPLIT_MIN_CHARS 미만이면 그대로 [sec]
 * @param {string} sec - '## '로 시작하는 절 하나
 * @returns {string[]} 조각들(쪼갤 필요가 없으면 [sec] 그대로)
 * [연계] ← sliceRelevant.
 */
function splitSection(sec) {
  if (sec.length < SUBSPLIT_MIN_CHARS) return [sec];
  const lines = sec.split('\n');
  const head = lines[0];
  const chunks = [];
  // 둘째 조각부터는 소제목에 `(이어짐)`을 붙인다 — 같은 소제목이 여러 번 나오면 AI가 서로 다른 절로
  // 오해할 수 있다. 원문 내용에 손대는 게 아니라 조각임을 알리는 표시일 뿐이다.
  const headOf = () => (chunks.length ? head + ' (이어짐)' : head);
  let cur = '';
  for (const line of lines.slice(1)) {
    const boundary = /^\s*-\s/.test(line) || !line.trim();
    if (cur.length >= SUBCHUNK_MIN_CHARS && boundary) { chunks.push(headOf() + '\n' + cur); cur = ''; }
    cur += (cur ? '\n' : '') + line;
  }
  if (cur.trim()) chunks.push(headOf() + '\n' + cur);
  return chunks.length ? chunks : [sec];
}

/**
 * 본문이 MAX_BODY_CHARS보다 길면(주로 comparisons 허브 — 여러 절을 한 페이지에 모아 다른
 * kind보다 훨씬 길다) 앞부분만 자르지 않고 '## ' 절 단위로 쪼개 질의어와 매칭되는 절 위주로
 * 담는다. 안 그러면 예: 18개 절짜리 허브에서 6번째 절(질문과 정확히 맞는 내용)이 컷오프
 * 이후라 통째로 안 보이는 문제가 생긴다(실측 확인 — 형사절차_일반.md 선고유예 질의 실패).
 * 2026-08-17 확장(실측 사고: 위키의 87%가 어떤 질문에서든 일부가 잘려 나갔다) — 위 상수 주석 참고:
 *   [A] 근거·처벌·서식 절은 점수와 무관하게 먼저 통째로 싣는다
 *   [B-1] 그래도 남는 예산은 절(큰 절은 조각) 단위 점수순으로 채운다
 *   [B-2] 잘린 사실을 컨텍스트 끝에 정직하게 붙인다
 *   [C] 절이 사실상 없는 초대형 문서는 본문 대신 안내 + 앞부분 미리보기만 준다
 * @param {string} body - 위키 페이지 본문(frontmatter 제외)
 * @param {string[]} terms - 질의 확장어
 * @param {number} maxChars - 이 페이지에 허용된 컨텍스트 예산(MAX_BODY_CHARS)
 * @returns {string} AI에게 줄 발췌(원문보다 짧으면 끝에 발췌 안내가 붙는다)
 */
function sliceRelevant(body, terms, maxChars) {
  if (body.length <= maxChars) return body;
  const parts = body.split(/\n(?=## )/);
  const introIsSection = parts[0].startsWith('## ');
  const intro = introIsSection ? '' : parts[0];
  const sections = introIsSection ? parts : parts.slice(1);
  // [C] 절이 사실상 없는 초대형 문서 — 발췌할 단위가 없다.
  if (body.length > HUGE_BODY_CHARS && sections.length <= HUGE_MAX_SECTIONS) {
    return HUGE_NOTE + '\n\n' + body.slice(0, HUGE_PREVIEW_CHARS);
  }
  if (!sections.length) return body.slice(0, maxChars) + PARTIAL_NOTE;
  // 페이지 전체가 한 주제(예: "매립면허")를 다루면 그 주제어는 거의 모든 절에 등장해 변별력이
  // 없다 — 이 페이지 안에서 몇 개 절에 등장하는지(절-내 문서빈도)로 역가중해, 소수 절에만 있는
  // 단어(질문의 진짜 변별 지점, 예: "수수료")를 우선한다(실측: 역가중 없인 흔한 주제어에
  // 묻혀 정작 필요한 절이 후순위로 밀림). df는 조각이 아니라 **절** 기준으로 센다(기존 그대로).
  const df = terms.map(t => sections.reduce((n, s) => n + (s.includes(t) ? 1 : 0), 0));
  const scoreOf = s => terms.reduce((n, t, i) => n + (df[i] > 0 && s.includes(t) ? 1 / df[i] : 0), 0);
  let out = intro.slice(0, maxChars);
  // 절끼리 그냥 이어붙이면 `…앞줄## 다음절`이 되어 소제목이 소제목으로 안 읽힌다 — 줄바꿈으로 잇는다.
  const add = (s) => {
    const sep = (out && !out.endsWith('\n')) ? '\n' : '';
    if (out.length + sep.length + s.length > maxChars) return false;
    out += sep + s;
    return true;
  };
  // [A] 항상 포함 절 — 점수와 무관하게 먼저(단 예산 절반까지). 못 들어간 절은 조용히 버리지 않고
  //     아래 점수 경쟁으로 내려 **조각으로라도** 살린다.
  // ⚠ "어떤 절이 예산을 받는가"는 MUST_SECTIONS 우선순위 순서로 정한다 — `_SCHEMA.md` 표준 절
  //   순서상 "근거 조문"이 항상 맨 마지막이라, 문서 순서대로 채우면 앞의 처벌·벌칙·행정처분
  //   절이 예산을 먼저 다 써버려 정작 "근거 법령" 아코디언의 유일한 재료인 근거 조문이 밀려난다
  //   (2026-08-17 실측 재현: 낚시관리및육성법__낚시어선업.md, must-section 총 2,933건 중 459건이
  //   밀리고 그중 230건이 근거 조문).
  // ⚠ 그러나 **`rest` 배열 자체의 순서는 반드시 문서 등장 순서 그대로 유지한다** — [B-1] 점수
  //   경쟁에서 동점 절은 배열에 먼저 놓인 쪽이 이긴다(안정 정렬). rest를 "예산 못 받은 절 먼저,
  //   나머지 절 나중"으로 재배열하면, 예산을 못 받은 큰 절(예: 근거 조문 통짜)의 조각이 동점
  //   경쟁에서 원래 뒤에 있던 질의 관련 절(예: 형사절차_일반.md "## 6. 선고유예")보다 먼저
  //   채택되어 정작 질문과 맞는 절이 밀리는 **다른 회귀**가 생긴다(직접 재현·확인함).
  const mustBudget = Math.floor(maxChars * MUST_BUDGET_RATIO);
  const rest = [];
  let mustUsed = 0;
  const priorityOrder = sections.filter(isMustSection)
    .sort((a, b) => MUST_SECTIONS.findIndex(h => a.startsWith(h)) - MUST_SECTIONS.findIndex(h => b.startsWith(h)));
  const willFit = new Set();
  for (const s of priorityOrder) {
    if (mustUsed + s.length > mustBudget) continue;
    mustUsed += s.length;
    willFit.add(s);
  }
  for (const s of sections) {
    if (willFit.has(s) && add(s)) continue;
    rest.push(s);
  }
  // [B-1] 남은 절 — 큰 절은 조각으로 쪼개 조각끼리 점수를 매긴다.
  const scored = [];
  for (const s of rest) for (const c of splitSection(s)) scored.push({ s: c, sc: scoreOf(c) });
  const hits = scored.filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc);
  if (!hits.length && out.length <= intro.length) return body.slice(0, maxChars) + PARTIAL_NOTE; // 매칭 절 없으면 기존 방식으로 폴백
  for (const { s } of hits) add(s);                 // 예산 초과 조각은 건너뛰고 더 작은 다음 후보로
  if (out.length <= intro.length && hits.length) {  // 다 안 들어가면 1위 조각이라도 잘라서 넣는다
    out += hits[0].s.slice(0, maxChars - out.length);
  }
  return out + PARTIAL_NOTE;                        // [B-2] 잘렸다는 사실을 숨기지 않는다
}

/**
 * L-15/L-67 페이지 단위 draft 게이트의 저비용 완화책(`_SCHEMA.md` §"인라인 REVIEW 마커" —
 * 마커 부착까지만 해두고 미룬 실제 필터 로직, 2026-08-05 사용자 지시로 구현). 지금까지 draft
 * 페이지는 REVIEW 마커 없는 부분까지 통째로 인용에서 제외됐다 — 이 함수는 본문을 줄 단위로
 * 훑어 "REVIEW"라는 단어가 들어간 줄만 빼고 나머지(검증된 부분)는 그대로 남긴다.
 * ⚠ 표시 없는 단어 하나만 기준으로 삼는 이유: 실제 위키를 전수 조사한 결과 REVIEW 마커
 * 표기가 `⚠REVIEW-XX`(붙여쓰기)·`⚠ REVIEW`(띄어쓰기)·`(REVIEW)`/`REVIEW 대상`(⚠ 없이 맨 단어만)
 * 세 가지 형태로 뒤섞여 있었다(예: `선박교통관제에관한법률__관제사지시위반.md` 40행은
 * `→ REVIEW: "정당한 사유" 해석은 사안별 판단`처럼 ⚠ 기호가 아예 없다) — `⚠REVIEW`만 찾으면
 * 이런 페이지의 미해소 판단이 그대로 새어나간다. 대문자 "REVIEW" 단어 자체를 기준으로 잡는
 * 게 과하게 넓어 보여도(변경이력의 이미 해소된 "REVIEW-XX 해소" 언급도 함께 빠짐) 안전한
 * 방향의 오차다 — 놓쳐서 미검증 주장이 새는 것보다 과하게 걸러 일부 무해한 줄이 같이
 * 빠지는 편이 낫다.
 * ⚠ 전제: 이 저장소의 위키 본문은 불릿/문단이 줄바꿈 없이 한 줄로 통짜 작성되는 관례라(전수
 * 확인) 줄 단위 제거로 충분하다 — 향후 문단이 여러 줄로 줄바꿈되는 관례로 바뀌면 이 전제가
 * 깨진다.
 * @param {string} body - 페이지 마크다운 본문(원문)
 * @returns {string} "REVIEW" 단어가 포함된 줄을 제거한 본문
 */
function stripUnresolvedReview(body) {
  if (!body) return body;
  return body.split('\n').filter(line => !/\bREVIEW\b/.test(line)).join('\n');
}

/**
 * canonicalOnly 모드에서 draft(비-statute) 페이지가 실제로 인용에 쓸 수 있는 본문을 만든다.
 * statute·canonical 페이지는 그대로(REVIEW 잔존이 있어선 안 되는 상태이므로 손대지 않음),
 * draft인 concept·comparison 페이지만 stripUnresolvedReview로 걸러 "검증된 부분만" 남긴다.
 * @param {{kind:string,status?:string,file:string}} p - 인덱스 페이지 메타
 * @param {boolean} canonicalOnly
 * @returns {string} 인용 가능한 본문(비-canonicalOnly거나 canonical/statute면 원문 그대로)
 */
function citableBody(p, canonicalOnly) {
  const page = readPage(p.kind, p.file);
  const body = page ? page.body : '';
  if (canonicalOnly && p.kind !== 'statute' && p.status !== 'canonical') {
    return stripUnresolvedReview(body);
  }
  return body;
}

// 서버 기동 직후 본문 캐시를 미리 데워 첫 사용자 질문이 콜드 디스크읽기(전체 corpus 수 초)를
// 기다리지 않게 한다. 실패해도 조용히 무시 — 어차피 각 페이지는 처음 필요할 때 다시 읽힌다.
function warmup() {
  try {
    for (const p of (loadIndex().pages || [])) readPage(p.kind, p.file);
  } catch (_) { /* 무시 — on-demand 읽기로 폴백 */ }
}
setImmediate(warmup);

// 질문의도 분석 전용(짧게·빠르게) — 모델은 답변합성과 같은 ANSWER_MODEL을 쓰되 설정은 다르다.
// 이 호출은 사용자 질문마다 검색 *앞단에서 동기로* 끼어들어 그대로 체감 대기시간이 되므로:
//  - thinkingBudget:0 (사고 끔) — 키워드 몇 개 뽑는 데 사고가 필요 없고, -1(dynamic)로 두면
//    응답이 수 초로 늘어 아래 타임아웃에 걸려 확장이 조용히 무력화될 수 있다.
//    (2.5 계열은 thinkingLevel 미지원·thinkingBudget 정수만 받음 — 위 SYNTH_CONFIG 주석 참고.)
//  - responseMimeType:'application/json' — 이 저장소의 다른 Gemini JSON 호출과 같은 관례
//    (assistant.js·marine_forecast_processor.js 등). 군더더기 문장 없이 배열만 받는다.
//  - httpOptions.timeout — 타임아웃을 Promise.race로 감싸면 우리 쪽만 포기하고 HTTP 요청은
//    백그라운드에서 계속 돈다. 이 옵션은 SDK가 AbortController로 요청을 실제로 끊는다(@google/genai
//    1.47.0 dist 확인). 실패·타임아웃 시 callGemini가 {success:false}를 주고 우리는 []로 폴백한다.
//  ★실측 발견(2026-08-03): 4000(4초)으로 두면 Gemini API가 매 호출 400(Manually set deadline 4s
//    is too short. Minimum allowed deadline is 10s.)으로 거부해 이 호출이 배포 이후 한 번도
//    성공한 적이 없었다(프로덕션 로그로 확인, caller=Legal-QueryExpand·Legal-RawLawPick 둘 다
//    영향받음 — 둘 다 이 상수를 공유). API가 요구하는 최소값(10초)으로 올린다.
const QUERY_EXPAND_TIMEOUT_MS = 10000;
// ★온도 0 — 같은 질문에 **같은 답**이 나오게 한다(2026-08-19 실측으로 결정).
//   폐기물관리법 질문 하나를 첫 턴만 6회 반복했더니 **3회는 바로 답하고 3회는 되물었다.**
//   되묻기 문장도 두 가지로 갈렸고(`…알려주세요` / `…받으시나요?`), 바로 답한 3회의 근거 수도
//   1건·2건·1건으로 달랐다 — 되묻기 판단과 검색어 확장이 **둘 다** 흔들린다는 뜻이다.
//   측정에 잡음이 섞이는 것보다 나쁜 것은 **사용자가 같은 질문을 두 번 하면 다른 답을 받는다**는
//   점이다(라이브 검증에서 같은 질문이 "정확 → 빈 답변 → 다시 정확"으로 갈린 것도 이 때문).
//   ⚠온도를 0으로 둔다고 완전히 같아지지는 않는다(모델·서버 쪽 요인이 남는다). 편차를 줄이는
//     것이 목적이며, 실제로 줄었는지는 같은 반복 실험(repeat_probe.js)으로 확인한다.
const QUERY_EXPAND_CONFIG = {
  temperature: 0,
  thinkingConfig: { thinkingBudget: 0 },
  responseMimeType: 'application/json',
  httpOptions: { timeout: QUERY_EXPAND_TIMEOUT_MS },
};

/**
 * L-57(2026-08-01): termsOf()는 기계적 토큰화라 1글자 명사("배"등)를 버리고 사전에 없는
 * 유의어(흡연↔화기)도 못 잇는다 — 검색 직전 Gemini에게 "이 질문과 관련될 만한 법률
 * 키워드"를 짧게 물어 allTerms에 보태 보완한다. 실패해도(키 없음·타임아웃·파싱 실패)
 * 조용히 빈 배열로 폴백 — 이 단계가 죽어도 기존 키워드 검색만으로 계속 동작해야 한다.
 * ★[H-37 §17] 사용자가 이해확인에서 "네, 맞아요"로 승인한 재진술이 있으면 **그 문장도 함께 보여준다**
 *   — 지시어("그거·그건")가 무엇을 가리키는지 아는 채로 확장해야 쓸모 있는 용어가 나온다("그거 안
 *   받으면?"만 보면 확장할 것이 없다). 재진술이 없으면 프롬프트가 **오늘과 문자 그대로 같다**(R0).
 * @param {string} query
 * @param {string} [restate] - 확인된 재진술(ctx.uc.restate). 없거나 규약 위반이면 무시된다.
 * @returns {Promise<string[]>} AI가 제안한 추가 검색어(실패 시 [])
 */
async function expandQueryTerms(query, restate) {
  if (!gemini.hasAnyKey()) return [];
  const confirmed = restateAllowed(restate);
  const prompt = `사용자가 한국 해양수산 법령 챗봇에 다음 질문을 했다: "${query}"\n` +
    (confirmed ? `사용자는 이 질문의 뜻이 "${confirmed}" 라는 것을 직접 확인해 줬다 — ` +
      `지시어("그거"·"그건" 등)가 무엇을 가리키는지는 이 문장을 따르고, 이 뜻에 맞는 용어를 뽑아라.\n` : '') +
    `이 질문과 관련될 수 있는 한국 법률 용어·개념을 한국어 명사로 최대 8개까지 뽑아라. ` +
    `질문에 그 글자가 그대로 없어도 관련 있을 만한 법률 용어를 포함해라 ` +
    `(예: "배 위에서 흡연"→선박,흡연,화기,금연,선내). 다른 설명 없이 JSON 배열로만 답하라. ` +
    `예: ["선박","흡연","화기"]`;
  try {
    const result = await gemini.callGemini({
      model: ANSWER_MODEL, contents: prompt, config: QUERY_EXPAND_CONFIG, caller: 'Legal-QueryExpand',
    });
    if (!result.success || !result.text) return [];
    // JSON 모드라 보통은 배열 그대로 오지만, 모델이 코드블록·설명을 붙이는 경우까지 견디도록
    // 첫 '['~마지막 ']'만 떼어 파싱한다(파싱 실패는 아래 catch에서 [] 폴백).
    const m = result.text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr.filter(t => typeof t === 'string' && t.trim()).map(t => t.trim()).slice(0, 8);
  } catch (_) {
    return [];
  }
}

// ── 되묻기(명확화) 판단 전용 설정 ──
// expandQueryTerms()·pickCandidateLaws()와 같은 "짧고 빠른 판단 호출" 패턴: 사고 끄고, JSON만
// 받고, 실패하면 조용히 폴백. 다만 이 호출은 근거자료 본문까지 읽히므로 타임아웃은 질의확장(10초)
// 보다 여유를 준다(pickRawFiles와 같은 15초).
const CLARIFY_TOPK = 6;            // 판단에 쓸 상위 근거 페이지 수(전부 넣으면 프롬프트가 폭주)
const CLARIFY_BODY_CHARS = 1500;   // 페이지당 발췌 상한
// 선택지 상한(버튼). ⚠ 상한일 뿐 목표가 아니다 — 프롬프트는 "필요한 만큼만, 최대 10개"라고
// 지시하며, 실제로는 2~3개가 대부분이다. 3→10 상향(2026-08-15 사용자 지시): 후보가 4개 이상인
// 자산(weather_warning_tree 특보 선택지 최대 6개·tonnage_facet 구간 최대 9개)을 억지로 묶지
// 않고 그대로 물을 수 있게 하려는 것. 클라이언트 버튼은 flex-wrap 이라 개수가 늘어도 줄바꿈된다.
const CLARIFY_OPTION_MAX = 10;
// 모듈 레벨 공유 참조라 호출자가 실수로 고치면 이후 모든 폴백이 오염된다 — 얼려서 막는다.
const CLARIFY_NONE = Object.freeze({ needed: false });

// ── 되묻기 선택지 보정 — "어떤 법이냐"고 물으면서 정작 1순위 법을 안 보여주던 것 ──────────
// ★왜(2026-08-19 라이브 실측): "단지관리계획은 언제까지 세워서 승인받아야 하나요?" 질문에서
//   검색은 「배타적 경제수역 및 대륙붕에 관한 법률」을 1위로 올렸는데, 되묻기 선택지는
//   `항만법 / 마리나항만법 / 잘 모르겠어요` 로 나왔다. **사용자가 정답을 고를 방법이 없다.**
//   무엇을 고르든 답에 닿지 못하고, 직접 타이핑해도 원문 폴백으로 새어 "확인되지 않습니다"로 끝났다.
// ⚠고치는 방향은 **더하기만** 한다 — 모델이 낸 선택지를 지우지 않는다. 지우면 정상 되묻기를
//   죽일 위험이 있고(누락 0), 여기서 필요한 것은 "고를 수 있게 해주는 것"뿐이다.
const LAW_TAIL_RE = /(법률|법|령|규칙|고시|지침|조례|규정|세칙|훈령|예규)$/;
const lawCore = (s) => String(s || '').replace(/[「」『』\s·ㆍ()（）]/g, '').replace(LAW_TAIL_RE, '');
// 라벨이 그 법을 가리키는가. 줄임말(`선박입출항법` ↔ 「선박의 입항 및 출항 등에 관한 법률」)까지
// 받도록 **글자 순서만 지키면 통과**시킨다(부분수열) — 같은 법을 두 번 넣지 않기 위해서다.
function labelMatchesLaw(label, law) {
  const a = lawCore(label), b = lawCore(law);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  if (a.length < 2) return false;
  let i = 0;
  for (const ch of b) if (ch === a[i]) i++;
  return i >= a.length;
}
/**
 * 되묻기가 **적용 법령을 고르라고** 물었는데 검색 1순위 법이 선택지에 없으면 맨 앞에 넣어준다.
 * 예: ensureTopLawOption('어떤 법률에 따른 단지관리계획을 말씀하시나요?',
 *       [{label:'항만법'},{label:'마리나항만법'}], ['배타적 경제수역 및 대륙붕에 관한 법률'])
 *     → 맨 앞에 「배타적 경제수역 및 대륙붕에 관한 법률」 선택지가 생긴다.
 * @param {string} question - 모델이 만든 되묻기 문장
 * @param {Array<{label:string,hint:string}>} options - 모델이 만든 선택지
 * @param {string[]} laws - 검색 후보 법 이름(점수순). laws[0] 이 1순위다.
 * @returns {Array} 보정된 선택지(원본을 바꾸지 않는다)
 * [연계] ← decideClarify(선택지 후처리 마지막 단계). 검증: scripts/test_clarify_options.js
 */
function ensureTopLawOption(question, options, laws) {
  const opts = Array.isArray(options) ? options : [];
  const top = String((laws || [])[0] || '').trim();
  if (!top || !opts.length) return opts;
  // ⓐ "어떤 법이냐"를 묻는 되묻기일 때만 손댄다.
  if (!/어떤\s*법|법률|법령/.test(String(question || ''))) return opts;
  // ⓑ 선택지 절반 이상이 법령 이름 꼴이어야 한다(톤수·행위 선택지에는 법 이름을 끼워넣지 않는다).
  const lawish = opts.filter(o => LAW_TAIL_RE.test(String((o && o.label) || '').trim()));
  if (lawish.length * 2 < opts.length) return opts;
  // ⓒ 이미 1순위 법을 가리키는 선택지가 있으면 그대로 둔다.
  if (opts.some(o => labelMatchesLaw((o && o.label) || '', top))) return opts;
  return [{ label: top, hint: '' }].concat(opts);
}

// 클라이언트가 "원래질문 + 고른 선택지"를 합칠 때 쓰는 구분자(ai_chat.js pickClarifyOption:
// `q + ' — ' + label`, em dash U+2014 앞뒤 공백). ⚠ 한쪽만 바꾸면 재되묻기 차단이 뚫린다.
const CLARIFY_JOINER = ' — ';
// 되묻기를 이어서 할 수 있는 최대 라운드 수(질의에 붙은 CLARIFY_JOINER 개수 = 이미 지나온 라운드 수).
// ⚠ 1이 아니라 2인 이유: 한 번 좁혀도 여전히 답이 갈리는 질문이 실제로 있다 — "낚시어선에서 술
//   마시면?"은 ①선장·선원이냐 승객이냐 를 물은 뒤에도, 그 답에 따라 ②하천·호소냐 바다냐(적용
//   법령·처벌이 아예 다르다)를 한 번 더 물어야 제대로 답이 나온다. 1로 묶어두면 두 번째 갈래를
//   영영 못 묻는다.
// ⚠ 그래도 상한 자체는 남긴다 — 무한루프 차단은 프롬프트가 아니라 **코드**로 한다(아래 decideClarify
//   주석 참고). 상한을 없애면 모델이 기준3을 어길 때 버튼→되묻기→버튼이 끝나지 않는다.
// (2026-08-10 사용자 확정: H-36 계층트리 경로는 트리 깊이가 유한해 상한을 안 두기로 했지만, 이
//  AI 즉석판단형 되묻기는 여전히 안전장치가 필요 — 대신 2는 너무 타이트하다는 지적으로 4로 상향.)
// (2026-08-17 사용자 확정: 4 → 10. "같은 것만 다시 안 물으면 계속 되물어도 된다" — 라운드 수를
//  묶어 막는 대신 **같은 질문을 다시 묻는 것**을 막는 쪽으로 무게를 옮겼다. 아래 sameClarifyAsLast
//  (직전 라운드의 질문·선택지 집합 대조)가 실제 방어선이고, 이 숫자는 그게 다 뚫렸을 때의 천장이다.)
const CLARIFY_MAX_ROUNDS = 10;
const CLARIFY_CONFIG = {
  temperature: 0,          // ★위 QUERY_EXPAND_CONFIG 주석 참고 — 같은 질문에 같은 답이 나오게 한다

  thinkingConfig: { thinkingBudget: 0 },
  responseMimeType: 'application/json',
  httpOptions: { timeout: 15000 },
};

/** 되묻기 응답 문자열 정리(앞뒤 공백 제거 + 길이 상한). 빈 문자열이면 ''. */
function clarifyStr(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// ── 같은 되묻기 반복 차단(B6) ─────────────────────────────────────────────
// 지금까지의 방어선은 ①라운드 수 상한 ②선택지 라벨이 질의에 **문자 그대로** 있으면 버림 — 둘뿐이라,
// 모델이 표현만 바꿔 같은 걸 다시 물으면("어선 종류가?" → "어떤 배인가요?") 하나도 안 걸린다.
// 라운드 상한을 10으로 올린 이상(사용자 확정 "같은 것만 다시 안 물으면 계속 되물어도 된다") 이
// 구멍이 실제 무한루프가 되므로, 직전 라운드의 **질문 문장**과 **선택지 라벨 집합**을 함께 대조한다.
// ⚠ 형태소 분석 같은 무거운 것은 쓰지 않는다 — 이 저장소 관례대로 결정론적·단순하게(공백·기호를
//   걷어낸 완전일치)만 본다. 부분일치·유사도는 오탐으로 정상 되묻기를 죽인다.
// ⚠ 직전 라운드 질문은 서버에 저장하지 않는다 — 이미 있는 `ctx` 채널(클라이언트가 done.ctxNext 를
//   들고 있다가 다음 요청에 되돌려 보내는 값)에 `cl` 축으로 얹어 나른다(새 저장소를 만들지 않는다).
const CLARIFY_LAST_LABELS_MAX = 12;   // ctx.cl.labels 정규화 상한(요청 바디 방어)

/** 되묻기 문장·라벨 비교용 정규화: 글자와 숫자만 남긴다(공백·조사기호·문장부호 제거). */
function clarifyKey(s) {
  return String(s || '').replace(/[^0-9A-Za-z가-힣]/g, '');
}

/**
 * 선택지 라벨에서 **대답투 껍데기**(앞의 `네/아니요`, 뒤의 `입니다/인가요`)만 벗긴다.
 * 아래 ⓒ 포함관계 검사 **전용** 전처리다 — 라벨의 뜻(핵심 낱말)은 그대로 두고 말투만 걷어낸다.
 * ★왜 필요한가(2026-08-17 라이브 실측): 같은 갈림을 모델이 서술형 → 대답형으로 바꿔 다시 물으면
 *   ⓒ가 뚫렸다. 직전 라벨 `관리선으로 지정된 어선` / 이번 라벨 `네, 관리선입니다.` 는
 *   정규화하면 `관리선으로지정된어선` vs `네관리선입니다` 라 서로 포함되지 않는다(겹치는 건
 *   `관리선` 세 글자뿐). 껍데기를 벗기면 `관리선` 이 되어 포함관계가 성립한다.
 * ⚠ ⓐ(질문 문장 완전일치)·ⓑ(라벨 집합 완전일치)에는 쓰지 않는다 — 그 둘은 "글자 그대로 같은가"를
 *   보는 검사라, 말투를 지우면 판정 기준이 달라진다.
 * 예: stripFraming('네, 관리선입니다.') → '관리선'
 *     stripFraming('아니요, 어업허가를 받은 어선입니다.') → '어업허가를 받은 어선'
 * @param {string} s - 선택지 라벨 원문
 * @returns {string} 대답투 접두·접미를 뗀 라벨(없으면 원문 그대로)
 * [연계] ← sameClarifyAsLast ⓒ. → clarifyKey.
 */
function stripFraming(s) {
  return String(s || '')
    .replace(/^(네|예|아니요|아니오)[,，]?\s*/, '')
    .replace(/(입니다|이에요|예요|인가요|죠)\.?\??$/, '')
    .trim();
}

/**
 * 이번 되묻기가 **직전 라운드와 사실상 같은 것**인가.
 * 둘 중 하나면 같은 것으로 본다: ⓐ질문 문장이 같다 ⓑ선택지 라벨 집합이 통째로 같다.
 * ⓑ가 있어야 표현만 바꾼 재질문("어선 종류가?" → "어떤 배인가요?")을 잡는다 — 고르는 갈래가
 * 그대로면 사용자에겐 같은 질문이다.
 * 예: sameClarifyAsLast('어떤 배인가요?', [{label:'어선'},{label:'낚시어선'}],
 *       {q:'어선 종류가 무엇인가요?', labels:['어선','낚시어선']}) → true
 * @param {string} question - 이번 라운드 질문
 * @param {Array<{label:string}>} options - 이번 라운드 선택지
 * @param {{q:string, labels:string[]}} prev - 직전 라운드(ctx.cl). 없으면 false
 * @param {string} [chosen] - 사용자가 직전 라운드에서 고른 라벨(질의 끝에 붙은 값)
 * @returns {boolean}
 * [연계] ← decideClarify. ← routes/legal.js 가 ctx.cl 로 넘긴다.
 */
function sameClarifyAsLast(question, options, prev, chosen) {
  if (!prev || !prev.q) return false;
  if (clarifyKey(question) && clarifyKey(question) === clarifyKey(prev.q)) return true;
  const now = (options || []).map(o => clarifyKey(o && o.label)).filter(Boolean).sort();
  const was = (prev.labels || []).map(clarifyKey).filter(Boolean).sort();
  if (now.length >= 2 && now.length === was.length && now.every((v, i) => v === was[i])) return true;
  // ★말만 바꾼 같은 축 재질문 차단(2026-08-17 라이브 실측): 완전일치만 보던 위 두 검사는
  //   같은 갈림을 표현만 바꿔 세 번 물어도 뚫렸다 —
  //     1라운드 "어떤 종류의 어선에서…" [낚시어선 / 일반 어선]
  //     2라운드 "어떤 종류의 어선인지…"  [낚시어선업 신고 어선 / 일반 어선 (낚시어선업 신고 제외)]
  //     3라운드 "어떤 종류의 선박에서…"  [낚시어선업 신고를 한 낚시어선 / 그 외 일반 어선]
  //   질문 문장도 라벨도 매번 달라 아무것도 안 걸린다. 그래서 **선택지 집합끼리 포함관계**로 본다:
  //   이번 선택지가 **하나도 빠짐없이** 직전 선택지 중 하나를 품거나 그 안에 품히면 같은 축이다.
  //   ⚠ 3글자 미만 라벨(`어선`)은 대조에서 뺀다 — 두 글자짜리 상위 낱말은 하위 갈림
  //     (`어선` → `낚시어선`/`일반 어선`)에도 늘 들어 있어, 정상적인 좁히기를 죽인다.
  //   ⚠ "잘 모르겠어요"(act:'unknown')는 매 라운드 붙는 고정 선택지라 대조에서 뺀다.
  //   ⚠ 대조 직전에 stripFraming 으로 **대답투 껍데기**(`네, …입니다.`)를 벗긴다 — 안 벗기면
  //     서술형 → 대답형으로 말투만 바꾼 재질문이 그대로 통과한다(위 함수 주석의 실측 사례).
  const real = (options || []).filter(o => o && o.act !== 'unknown').map(o => clarifyKey(stripFraming(o.label))).filter(Boolean);
  const prevKeys = (prev.labels || []).map(l => clarifyKey(stripFraming(l))).filter(k => k && k.length >= 3);
  if (real.length >= 2 && prevKeys.length
    && real.every(k => prevKeys.some(p => (k.length >= 3 && (k.includes(p) || p.includes(k)))))) return true;
  // ★ⓓ **사용자가 이미 고르지 않은 갈래를 그대로 다시 내미는 경우**(2026-08-18 라이브 실측).
  //   위 ⓒ는 이번 선택지가 **하나도 빠짐없이** 직전 것과 겹쳐야 걸리는데, 한 낱말만 바뀌면 뚫린다 —
  //     1라운드 "어떤 방식으로 참조기를 포획하시나요?" [근해자망어업 중 유자망 / 그 외의 방식]
  //     → 사용자가 `그 외의 방식` 선택
  //     2라운드 "어떤 어업에 대해 금어기를 알려드릴까요?" [근해자망어업 중 유자망 / 그 외의 어업]
  //   `그외의방식` 과 `그외의어업` 은 서로 품지 않아 ⓒ가 false 를 낸다(실측). 그래서 4회를 물어도
  //   답에 못 갔다.
  //   판정 기준은 유사도가 아니라 **글자 그대로**다: 사용자가 **고르지 않은** 직전 라벨이 이번
  //   선택지에 그대로 다시 나오면, 사용자가 이미 지나간 갈림을 다시 내미는 것이다.
  //   ⚠유사도·부분일치를 새로 들이지 않는다 — 그건 정상적인 좁히기를 죽인다(위 주석의 실측 이력).
  //   ⚠고른 라벨을 모르면(질의에 안 붙어 있으면) 이 검사는 하지 않는다.
  const pick = clarifyKey(stripFraming(chosen));
  if (pick) {
    const notChosen = (prev.labels || [])
      .filter(l => l && !/^(잘\s*모르겠어요)$/.test(String(l).trim()))
      .map(l => clarifyKey(stripFraming(l)))
      .filter(k => k && k.length >= 3 && k !== pick);
    const nowExact = (options || []).filter(o => o && o.act !== 'unknown')
      .map(o => clarifyKey(stripFraming(o && o.label))).filter(Boolean);
    if (notChosen.some(k => nowExact.includes(k))) return true;
  }
  return false;
}

// ── "잘 모르겠어요" 선택지(B7, 계약5) ──────────────────────────────────────
// 되묻기를 내보낼 때 **항상** 맨 끝에 붙인다(2라운드·3라운드에도 계속). 사용자가 누르면 클라이언트는
// 질의를 그대로 두고 ctx 만 실어 재요청하고(ai_chat.js pickClarifyOption 의 data-ctx 경로 — act 가
// 'ask'가 아니면 `input.value = q` 그대로 재전송한다), 서버는 ctx.unk 를 보고 ①그 되묻기가 쓴
// 전문용어 풀이 ②각 갈래 한 줄 요약을 붙인 뒤 **같은 선택지를 다시** 낸다.
// ⚠ ctx.unk 는 **버튼의 data-ctx 로만** 들어온다 — done.ctxNext 에는 절대 싣지 않는다. 싣으면 그
//   다음에 사용자가 평범한 선택지를 눌렀을 때(그 버튼엔 ctx 가 없어 클라가 직전 ctx 를 그대로 보낸다)
//   서버가 또 "잘 모르겠어요"로 오해해 답변 대신 용어풀이를 반복한다.
const UNKNOWN_LABEL = '잘 모르겠어요';
const UNKNOWN_ACT = 'unknown';
// 같은 되묻기에 대해 용어풀이를 몇 번까지 다시 해 줄지. 같은 설명을 세 번 반복해 봐야 사용자에게
// 새로 알려주는 게 없고, 한 번 누를 때마다 AI 호출이 한 번 더 붙는다.
const UNKNOWN_MAX_ROUNDS = 2;
const UNKNOWN_HINT = '이 질문에 나온 말이 무슨 뜻인지부터 알려드릴게요';

/**
 * 되묻기 선택지 맨 끝에 붙일 `잘 모르겠어요` 버튼을 만든다(계약5).
 * 버튼의 ctx 에 그 되묻기를 **그대로 다시 낼 수 있는 최소 정보**(질문·선택지·라운드)를 담는다 —
 * 서버는 대화 이력을 저장하지 않으므로 이 값이 유일한 운반로다.
 * @param {string} question @param {Array<{label:string,hint:string}>} options @param {number} round
 * @returns {{label:string, hint:string, act:string, ctx:object}}
 * [연계] → ai_chat.js clarifyHTML(data-ctx·data-act) → explainClarifyStep.
 */
function unknownOption(question, options, round) {
  return {
    label: UNKNOWN_LABEL, hint: UNKNOWN_HINT, act: UNKNOWN_ACT,
    ctx: { unk: { r: round, q: question, o: options.map(o => ({ label: o.label, hint: o.hint || '' })) } },
  };
}

/** 되묻기 응답에 `잘 모르겠어요`를 (상한 안에서) 얹어 돌려준다. 상한을 넘었으면 그대로 둔다. */
function withUnknownOption(question, options, round) {
  return round >= UNKNOWN_MAX_ROUNDS ? options : options.concat([unknownOption(question, options, round + 1)]);
}

/**
 * 이 질문에 바로 답하지 말고 **사용자에게 조건을 되물어야 하는지**만 짧게 판단한다.
 * 예: "낚싯배 위에서 술 마시면 처벌?"은 (바다/하천, 조타담당/승객)에 따라 적용 법령·처벌이
 * 완전히 달라져 한 번에 다 나열하면 답이 길고 산만해진다 — 그럴 때 질문 + 선택지(필요한 만큼, 최대 10개)를
 * 돌려주면 화면이 버튼으로 그리고, 사용자가 고른 값을 원래 질문에 합쳐 다시 물어본다.
 *
 * ★환각 0: 선택지는 **[근거자료]에 실제로 적힌 구분**에서만 만들게 프롬프트로 강제한다(예:
 *   "조타기를 조작하거나 그 조작을 지시하는 자"라는 조문 문구가 있어야 "조타 담당자냐 승객이냐"를
 *   물을 수 있다). 근거가 없으면 needed:false로 물러난다.
 * ★재되묻기 방지: 되묻기는 **최대 CLARIFY_MAX_ROUNDS 라운드**까지만 이어진다 — 이미 지나온 라운드
 *   수는 질의에 붙은 CLARIFY_JOINER 개수로 세고, 상한에 닿으면 프롬프트(기준3)에 앞서
 *   **Gemini를 부르지도 않고** 물러난다. 모델이 기준3을 어기면 버튼→되묻기→버튼 무한루프가 되므로
 *   천장은 결정론적으로 막되, 한 번 좁혀도 갈래가 남는 질문(선원/승객 → 하천/바다)은 통과시킨다.
 * ★같은 조건 재질문 차단: 라운드 수와 별개로, 이번 선택지의 라벨이 이미 질의에 붙어 있으면(=앞
 *   라운드에서 사용자가 고른 값) 그 되묻기는 버린다 — 프롬프트 기준3만 믿었더니 2라운드가 1라운드와
 *   똑같은 질문·똑같은 선택지를 그대로 다시 물은 사례가 라이브에서 재현됐다(아래 코드 주석 참고).
 * ★hint 검증: 모델이 근거자료에 없는 조문번호를 hint에 지어넣을 수 있어, 파싱 후 hint의
 *   조문번호 토큰을 [근거자료] 원문과 대조해 없으면 그 hint만 비운다(선택지는 유지).
 * 실패(키 없음·근거 없음·타임아웃·파싱 실패·스키마 불충족)는 예외 없이 {needed:false} —
 * 이 단계가 죽어도 기존 답변 흐름이 그대로 돌아가야 한다(pickCandidateLaws와 같은 폴백 규약).
 *
 * ★[H-37 §17] 사용자가 이해확인에서 승인한 재진술이 있으면 그 문장도 함께 보여준다 — 지시어가
 *   풀린 문장을 읽어야 "이미 정해진 조건을 또 묻는" 되묻기를 피할 수 있다(기준3의 확장). 재진술이
 *   없으면 프롬프트가 **오늘과 문자 그대로 같다**(R0). 재진술은 조문·수치가 섞이면 이미 버려진 값이라
 *   (RESTATE_BAN) 이 프롬프트에 법 이야기를 새로 들여오지 않는다.
 * ★(2026-08-15) `scopeNarrowStep`(D-트리 상황질문)이 확정한 조건도 같은 방식으로 넘긴다 —
 *   D-트리는 `ctx.scope`로만 확정 사실을 들고 있고 그게 `query` 문자열엔 절대 안 섞이므로(R2),
 *   여기 넘기지 않으면 이 함수는 그 확정을 전혀 모른다. 라이브 재현: "안전검사 안 받으면?" →
 *   D-트리가 "그 밖의 선박"으로 좁혀도, 이 함수가 곧바로 "어선/수상레저기구/그 밖의 선박"을 또
 *   물었다(같은 축 중복 되묻기). restate와 마찬가지로 프롬프트에 "다시 묻지 마라" 지시를 더하고,
 *   모델이 그래도 어기면(라벨이 그대로 다시 나오면) 결정론적으로 버린다(아래 코드 참고).
 * ★(2026-08-15, 최소 절충안) 직전 질문(`lastTopic`)이 있으면, **이 함수가 어차피 needed:true로
 *   되물을 때만** 선택지 맨 끝에 하나 더 얹는다 — "방금 물어본 그거예요?" 확인용. 라이브 재현:
 *   "안전검사 안 받으면?"(scopeNarrow로 "그 밖의 선박"까지 확정) 뒤에 **사용자가 입력창에 새로
 *   타이핑한** "그럼 처벌은 얼마예요?"는 클라이언트가 맥락을 통째로 비우고 보내(§9.1 #1, 의도적
 *   정책 — 안 바꿨다) 서버가 "안전검사" 얘기였다는 걸 전혀 모른 채 무관한 법 6개를 늘어놓았다.
 *   이 함수는 **주제를 대신 추측해 답하지 않는다** — 확정된 조건이 아니라 "확인 후보"로만 하나
 *   보태고, 사용자가 그 선택지를 누르면(기존 되묻기 버튼과 완전히 같은 경로로 "새질문 — 직전질문"
 *   재질의가 되어) 그제서야 두 질문이 합쳐져 검색된다. 안 누르면 오늘과 똑같이 동작한다(R0).
 * @param {string} query - 사용자 질문
 * @param {Array} contextPages - search()의 contextPages(위키 원문 body 포함)
 * @param {string} [restate] - 확인된 재진술(ctx.uc.restate). 없거나 규약 위반이면 무시된다.
 * @param {string[]} [narrowLabels] - 이미 확정된 조건 라벨(ctx.scope·프로필). 없으면 프롬프트·판정 모두 오늘과 동일(R0).
 * @param {string} [lastTopic] - 직전 질문 원문(클라이언트가 매 요청에 항상 실어 보낸다, ctx와 무관한
 *   별도 채널). 없으면 이 함수는 오늘과 완전히 같다(R0).
 * @param {{q:string,labels:string[]}} [prevClarify] - 직전 라운드의 되묻기(ctx.cl). 표현만 바꾼
 *   같은 되묻기를 결정론적으로 차단하는 데만 쓴다(B6, sameClarifyAsLast). 없으면 오늘과 동일(R0).
 * @returns {Promise<{needed:boolean, intro?:string, question?:string, options?:Array<{label:string,hint:string,act?:string,ctx?:object}>}>}
 * [연계] ← routes/legal.js POST /api/legal/ask 가 synthesizeAnswerStream() **전에** 호출한다.
 *          needed:true면 종합답변을 아예 만들지 않고 done 이벤트의 clarify 필드로 내려보낸다.
 *        → client/js/ai-chat/ai_chat.js clarifyHTML(선택지 버튼) → 버튼 클릭 시 "원래질문 — 라벨"로 재질의.
 */
async function decideClarify(query, contextPages, restate, narrowLabels, lastTopic, prevClarify, topic, history) {
  if (!gemini.hasAnyKey() || !contextPages || !contextPages.length) return CLARIFY_NONE;
  // ★재되묻기 무한루프 차단(프롬프트 기준3의 결정론적 백스톱): 선택지 버튼으로 되돌아온 질의는
  // 반드시 CLARIFY_JOINER 를 달고 오므로, 그 개수가 곧 **이미 지나온 되묻기 라운드 수**다.
  // 상한(CLARIFY_MAX_ROUNDS)에 닿았으면 모델 판단에 맡기지 않고 여기서 곧바로 물러난다.
  // (모델이 기준3을 어기면 버튼→되묻기→버튼 무한루프가 된다.) 사용자가 직접 " — "를 타이핑한
  // 드문 경우도 되묻기를 건너뛸 뿐이라 안전한 쪽으로 틀린다.
  const rounds = String(query || '').split(CLARIFY_JOINER).length - 1;
  if (rounds >= CLARIFY_MAX_ROUNDS) return CLARIFY_NONE;
  // 머리 모양은 buildContextBlock 과 **같은 이유로** 같은 형태를 쓴다(그 주석 참고) — 모델이
  // 되묻기 문구에 이 이름을 그대로 옮겨 적으면 사용자에게 뜻이 통하지 않는다.
  const block = contextPages.slice(0, CLARIFY_TOPK).map((cp, i) => {
    const about = cp.topic ? ` (이 자료가 다루는 것: ${cp.topic})` : '';
    return `--- 근거${i + 1}: 「${cp.law}」${about} ---\n${String(cp.body || '').slice(0, CLARIFY_BODY_CHARS)}`;
  }).join('\n\n');
  // [H-37 §17] 확인된 재진술이 있으면 질문 바로 뒤에 한 블록 끼운다. 없으면 빈 문자열이라
  //   프롬프트가 오늘과 바이트 동일하다(R0) — 줄바꿈까지 이 블록 안에 넣어 둔 이유가 그것이다.
  const confirmed = restateAllowed(restate);
  const confirmedBlock = confirmed ? `\n\n[사용자가 확인해 준 질문의 뜻]\n"${confirmed}"\n` +
    `- 질문의 지시어("그거"·"그건" 등)가 가리키는 것은 이 문장을 따른다.\n` +
    `- 이 문장이 이미 정해 준 조건은 **다시 묻지 마라**(기준3과 같은 취지).` : '';
  // (2026-08-15) D-트리 상황질문(scopeNarrowStep)이 이미 확정한 조건 — restate와 같은 자리에 낀다.
  const narrow = (narrowLabels || []).filter(Boolean);
  const narrowBlock = narrow.length ? `\n\n[이미 확정된 조건]\n${narrow.join(', ')}\n` +
    `- 이 조건은 이미 답이 정해졌다. **같은 구분을 다시 묻지 마라**(기준3과 같은 취지).` : '';
  // ★[이어서 질문] 직전 답변의 주제(2026-08-18 사용자 재현으로 추가). 예전에는 이 판단기에 주제를
  //   **아예 안 넘겼다** — 그래서 낚시어선업 이야기를 하다 "허가는 받았는데 신고 안 하고 영업하면?"
  //   이라 물었을 때, 검색이 끌어온 수산부산물·폐기물 처리업까지 그대로 선택지가 됐다.
  //   값이 없으면 빈 문자열이라 프롬프트가 오늘과 바이트 동일하다(R0).
  // ★[대화 기억] 직전까지의 대화를 통째로 보여준다(2026-08-18 사용자 확정). 주제 낱말 하나만으로는
  //   모델이 확신하지 못해 방금 한 얘기를 또 되물었다(사용자 재현: 낚시어선업 이야기 뒤 "신고 안
  //   하면?"에 "무슨 영업이신가요?"). 없으면 빈 문자열이라 프롬프트가 오늘과 바이트 동일하다(R0).
  //   ⚠되묻기를 **아예 막지는 않는다** — "이미 정해진 것"만 막고, 아직 안 정해졌는데 답이 진짜
  //     갈리는 조건(예: 바다냐 내수면이냐)은 그대로 물어야 한다. 안 물으면 한쪽으로 단정한 틀린
  //     답이 나가고, 그건 되묻는 불편보다 훨씬 나쁘다(사용자 확정).
  const histBlock = (history && history.length) ? historyBlock(history) +
    `\n- ★위 대화에서 **이미 정해진 것은 다시 묻지 마라**(기준3과 같은 취지). 사용자가 어떤 업종·상황을 ` +
    `말하고 있는지 위 대화로 이미 알 수 있으면, 그것을 고르라는 선택지를 내지 말고 needed:false 로 물러나라.\n` +
    `- 다만 위 대화에서 **아직 정해지지 않았고** 답이 실제로 크게 갈리는 조건은 그대로 물어도 된다.` : '';
  const topicBlock = clarifyStr(topic, 60) ? `\n\n[이어서 묻는 주제]\n"${clarifyStr(topic, 60)}"\n` +
    `- 사용자는 방금 이 주제로 답을 받고 **이어서** 묻는 중이다.\n` +
    `- 이 주제와 **다른 업종·다른 분야**를 고르라는 선택지는 내지 마라. 근거자료에 그런 법이 섞여 ` +
    `있으면 검색이 잘못 끌어온 것이지 사용자가 헷갈리는 지점이 아니다 — 그럴 때는 needed:false 로 물러나라.` : '';
  const prompt = `너는 대한민국 해양수산 법령 챗봇의 "되묻기 판단기"다. 질문에 답하지 말고, 사용자에게 조건을 되물어야 하는지만 판단하라.

[질문]
"${query}"${confirmedBlock}${narrowBlock}${histBlock}${topicBlock}

[근거자료]
${block}

[판단 기준]
1. 근거자료를 보면 이 질문의 답(적용 법령·처벌·의무)이 어떤 구분에 따라 크게 달라지고, **그 구분이 근거자료 문구에 실제로 적혀 있으면** needed:true. 예: 근거자료에 "조타기를 조작하거나 그 조작을 지시하는 자"라고 적혀 있으면 "조타를 맡은 사람인지 일반 승객인지"는 근거가 있는 구분이다.
2. ★근거자료에 없는 구분은 지어내지 마라. 선택지의 근거가 되는 표현을 근거자료에서 찾을 수 없으면 needed:false.
3. ★질문 문구에 이미 그 조건이 적혀 있으면 그 조건을 다시 묻지 마라. 예: "낚싯배 위에서 술 마시면 처벌? — 바다에서 운항 중, 조타 담당자 기준"처럼 조건이 이미 붙어 있으면 needed:false.
4. 조금이라도 애매하면 needed:false로 물러나라(되묻지 않고 답해도 되는 질문을 굳이 되묻지 않는다).
5. 되물을 조건은 **한 가지만** 고른다(답이 가장 크게 갈리는 것). 선택지는 근거자료에 실제로 적힌 구분만큼 **필요한 만큼만** 만들어라 — 최대 10개까지 낼 수 있지만, 개수를 채우려고 근거 없는 선택지를 보태지 마라(대개 2~3개면 충분하다).
6. ★**근거자료에 서로 다른 법이 서로 다른 "행위·신분"을 규율하고 있으면, 배의 종류·톤수보다 그 갈림을 먼저 물어라.** 적용 법률 자체가 갈리는 지점이라 답이 가장 크게 달라진다. 예: 같은 "배에서 술" 질문이라도 근거자료가 ①「해상교통안전법」의 *조타기를 조작하거나 그 조작을 지시하는 자*(음주운항)와 ②「어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률」·그 고시의 *어로작업 및 당직근무 중인 어선원*을 함께 담고 있으면, "조타를 맡으셨나요, 어로작업·당직근무 중이셨나요"를 먼저 묻는다(톤수·선박 종류는 그 다음이다). 근거자료에 한쪽 축만 있으면 이 기준은 적용하지 않는다(없는 구분을 지어내지 마라).

다른 설명 없이 아래 JSON만 출력하라.
{"needed":true,"intro":"…","question":"…","options":[{"label":"…","hint":"…"}]}
또는 {"needed":false}
- intro: 왜 조건에 따라 답이 갈리는지 알려주는 존댓말 한 문장.
- question: 사용자에게 물을 한 문장.
- options[].label: 버튼에 들어갈 짧은 문구(15자 이내). options[].hint: 그 선택지가 무슨 뜻인지 짧은 설명.`;
  try {
    const result = await gemini.callGemini({
      model: ANSWER_MODEL, contents: prompt, config: CLARIFY_CONFIG, caller: 'Legal-Clarify',
    });
    if (!result.success || !result.text) return CLARIFY_NONE;
    // JSON 모드라 보통은 객체 그대로 오지만, 모델이 코드블록·설명을 붙이는 경우까지 견디도록
    // 첫 '{'~마지막 '}'만 떼어 파싱한다(파싱 실패는 아래 catch에서 폴백).
    const m = result.text.match(/\{[\s\S]*\}/);
    if (!m) return CLARIFY_NONE;
    const obj = JSON.parse(m[0]);
    if (!obj || obj.needed !== true) return CLARIFY_NONE;
    const question = clarifyStr(obj.question, 200);
    const options = (Array.isArray(obj.options) ? obj.options : [])
      .map(o => ({ label: clarifyStr(o && o.label, 40), hint: clarifyStr(o && o.hint, 120) }))
      .filter(o => o.label)
      .slice(0, CLARIFY_OPTION_MAX)
      // ★환각 0: hint가 근거자료에 없는 조문번호("제9999조")를 지어내면 버튼 툴팁으로 그대로
      // 노출된다 — 조문번호 토큰만 좁게 대조해, 하나라도 block에 문자 그대로 없으면 그 hint를
      // 비운다(선택지 자체는 남긴다 — 라벨은 사용자가 고를 조건이라 지우면 되묻기가 망가진다).
      // 질문·라벨 전체 문자열 대조는 하지 않는다(패러프레이즈 오탐이 커서 정상 되묻기를 죽인다).
      .map(o => (o.hint && (o.hint.match(/제\d+조(?:의\d+)?/g) || []).some(a => !block.includes(a))
        ? { label: o.label, hint: '' } : o));
    // ★적용 법령을 고르라는 되묻기인데 검색 1순위 법이 선택지에 없으면 넣어준다(위 주석 참고).
    const fixed = ensureTopLawOption(question, options, contextPages.map(cp => cp.law));
    // 물음 없이, 또는 고를 게 하나뿐인 되묻기는 사용자를 막기만 하고 좁혀주지 못한다 — 그냥 답하게 둔다.
    if (!question || fixed.length < 2) return CLARIFY_NONE;
    // ★같은 조건 재질문 차단(결정론적): 질의에는 앞선 라운드에서 고른 값이 "질문 — 라벨" 꼴로 이미
    // 붙어 있다. 이번 선택지의 라벨 중 하나라도 질의에 **문자 그대로** 들어 있으면, 그건 이미 한 번
    // 고른 조건을 그대로 다시 묻는 것이다 — 그 되묻기는 버리고 답변으로 넘어간다.
    // ⚠ 프롬프트 기준3("질문 문구에 이미 그 조건이 적혀 있으면 다시 묻지 않는다")만으로는 못 막는다 —
    //   라이브 재현: 2라운드에서 **1라운드와 완전히 똑같은 질문 + 똑같은 선택지 2개**가 그대로 다시
    //   떴다. CLARIFY_MAX_ROUNDS 상한은 라운드 **수**만 세므로 이 실패 모드를 걸러내지 못한다.
    //   이 저장소의 관례대로(위 CLARIFY_JOINER 라운드 계산과 같은 취지) 루프 차단은 모델의 지시이행이
    //   아니라 코드로 한다. 라벨은 사용자가 실제로 눌러 질의에 그대로 붙은 문자열이라 완전일치 대조가
    //   성립한다(패러프레이즈 대조가 아니라 오탐이 없다).
    if (options.some(o => String(query || '').includes(o.label))) return CLARIFY_NONE;
    // ★(2026-08-15) 위와 같은 결정론적 백스톱을 narrowLabels 에도 건다 — narrowBlock(프롬프트
    //   지시)만 믿으면 restate 때와 같은 실패모드(모델이 지시를 어긴다)가 그대로 반복될 수 있다.
    //   narrowLabels 는 사용자가 D-트리 버튼을 실제로 눌러 ctx.scope 에 그대로 박힌 문자열이라
    //   완전일치 대조가 성립한다(위 라벨과 같은 근거).
    if (narrow.some(nl => options.some(o => o.label === nl))) return CLARIFY_NONE;
    // ★(2026-08-15, 최소 절충안) 직전 질문을 "확인 후보"로 하나 더 얹는다 — 이 함수가 어차피
    //   needed:true(=이미 애매해서 되묻는 중)일 때만, 그리고 여지가 있을 때만(칸이 남아 있고,
    //   직전 질문이 이번 질문에 이미 그대로 안 들어 있을 때). 답을 대신 짓지 않고 "이거 맞아요?"만
    //   묻는 선택지라 틀려도 사용자가 그냥 무시하면 그만이다(오답 위험 0).
    // ★(2026-08-18) **직전 질문 원문을 통째로 얹던 것을 없앴다.** 그 선택지를 누르면 질의가
    //   "신고 안 하면? — 낚시어선업 절차와 방법 요건같은거"로 합쳐져, ①이해확인이 "절차·방법·요건도
    //   알고 싶다"로 읽어 **이미 답한 것을 또** 설명하려 하고 ②검색어가 일반어로 오염돼 무관한
    //   선택지가 딸려 나왔다(실사용 재현). 이제 맥락은 질의를 건드리지 않는 `ctx.topic`(검색
    //   확장어 전용)으로 잇는다 — routes/legal.js 의 topic 설정과 search(opts.topic) 참고.
    //   ⚠ lastTopic 인자는 아래 "같은 주제로 이미 좁혀져 있다" 판단에만 남는다(질의 오염 없음).
    // ★(2026-08-17) 표현만 바꾼 재질문 차단(B6) — 위 라벨 완전일치 대조는 "사용자가 고른 값이
    //   질의에 붙어 있는가"만 보므로, 모델이 같은 갈래를 다른 말로 다시 물으면 못 막는다. 직전
    //   라운드의 질문·선택지 집합과 대조해 사실상 같으면 되묻기를 버리고 답변으로 넘어간다.
    // 사용자가 직전 라운드에서 고른 값은 질의 끝에 ' — 라벨' 로 붙어 온다(ai_chat.js pickClarifyOption).
    const chosenLabel = String(query || '').split(CLARIFY_JOINER).pop().trim();
    if (sameClarifyAsLast(question, options, prevClarify, chosenLabel)) return CLARIFY_NONE;
    // ★(2026-08-17 사용자 확정) 되묻기를 낼 때는 **항상** 맨 끝에 "잘 모르겠어요"를 붙인다(B7).
    // ⚠아래 재질문 차단 검사들은 **모델이 낸 원본 options** 로 그대로 판단한다(우리가 보탠 줄이
    //   루프 차단을 건드리지 않게). 화면에 나가는 것만 보정본(fixed)이다.
    return { needed: true, intro: clarifyStr(obj.intro, 200), question, options: withUnknownOption(question, fixed, 0) };
  } catch (_) {
    return CLARIFY_NONE;
  }
}

// ── "잘 모르겠어요" 응답 — 용어 풀이 + 갈래 한 줄 요약 후 같은 선택지 재제시(B7) ──────
const UNKNOWN_CONFIG = {
  temperature: 0.1,
  thinkingConfig: { thinkingBudget: 0 },
  responseMimeType: 'application/json',
  httpOptions: { timeout: 15000 },
};

/**
 * 사용자가 되묻기에서 `잘 모르겠어요`를 눌렀을 때, **같은 되묻기를 그대로 다시 내되** 그 앞에
 * ①그 되묻기가 쓴 전문용어를 2~3줄로 쉽게 풀어주고 ②각 갈래를 한 줄씩 요약해 붙인다.
 * ★환각 0: 풀이·요약은 [근거자료]에 있는 내용으로만 만들게 프롬프트로 강제하고, 모델이 근거자료에
 *   없는 조문번호를 지어 넣으면(hint 검증과 같은 실패모드) 그 설명을 통째로 버린다.
 * ★점진 공개: 갈래 설명은 한 줄씩만 — 여기서 다 쏟으면 되묻기의 의미가 없다(_CHATBOT.md 2절).
 * ★비용: 근거자료를 통째로 다시 밀어넣지 않는다 — decideClarify 와 같은 CLARIFY_TOPK·
 *   CLARIFY_BODY_CHARS 관례를 그대로 따라 호출 1회분이다.
 * 실패(키 없음·타임아웃·파싱 실패)는 조용히 **원래 되묻기를 그대로** 다시 낸다(기존 폴백 규약).
 * @param {Array} contextPages - search()의 contextPages(이번 질의는 직전과 같은 문장이라 같은 근거다)
 * @param {{r:number,q:string,o:Array<{label:string,hint:string}>}} unk - normalizeAskCtx가 정규화한 ctx.unk
 * @returns {Promise<null|{answer:string, note:string, clarify:object, confirmKind:string}>}
 *          ctx.unk 가 없으면 null(호출부는 오늘과 똑같이 진행 — R0)
 * [연계] ← routes/legal.js POST /api/legal/ask(decideClarify 직전). → writeConfirm(기존 clarify 스키마 그대로).
 */
async function explainClarifyStep(contextPages, unk) {
  if (!unk || !unk.q || !(unk.o || []).length) return null;
  const options = unk.o;
  const fallback = {
    answer: '', note: '추가 정보가 필요해요',
    clarify: { question: unk.q, options: withUnknownOption(unk.q, options, unk.r || 1) },
    confirmKind: UNKNOWN_ACT,
  };
  if (!gemini.hasAnyKey() || !contextPages || !contextPages.length) return fallback;
  // 머리 모양은 buildContextBlock 과 **같은 이유로** 같은 형태를 쓴다(그 주석 참고) — 모델이
  // 되묻기 문구에 이 이름을 그대로 옮겨 적으면 사용자에게 뜻이 통하지 않는다.
  const block = contextPages.slice(0, CLARIFY_TOPK).map((cp, i) => {
    const about = cp.topic ? ` (이 자료가 다루는 것: ${cp.topic})` : '';
    return `--- 근거${i + 1}: 「${cp.law}」${about} ---\n${String(cp.body || '').slice(0, CLARIFY_BODY_CHARS)}`;
  }).join('\n\n');
  const prompt = `너는 대한민국 해양수산 법령 챗봇이다. 사용자가 아래 되묻기 질문에 "잘 모르겠어요"를 눌렀다.
답을 대신 정해주지 말고, 사용자가 **스스로 고를 수 있게** 말뜻만 쉽게 풀어줘라.

[되묻기 질문]
"${unk.q}"

[선택지]
${options.map((o, i) => `${i + 1}. ${o.label}${o.hint ? ` (${o.hint})` : ''}`).join('\n')}

[근거자료]
${block}

[지시]
1. terms: 이 질문·선택지에 나온 **전문용어의 뜻**을 비전문가에게 2~3줄로 쉽게 풀어라. 반드시 [근거자료]에 적힌 내용으로만 쓰고, 근거자료에서 뜻을 찾을 수 없으면 "확인되지 않습니다"라고 정직하게 적어라.
2. lines: 각 선택지가 어떤 경우인지 **한 줄씩만** 요약하라(길게 쓰지 마라 — 여기서 답을 다 말하면 안 된다). 선택지 순서와 개수를 그대로 지켜라.
3. [근거자료]에 없는 조문번호·금액·기관명을 지어내지 마라.

다른 설명 없이 아래 JSON만 출력하라.
{"terms":"…","lines":["…","…"]}`;
  try {
    const result = await gemini.callGemini({
      model: ANSWER_MODEL, contents: prompt, config: UNKNOWN_CONFIG, caller: 'Legal-ClarifyExplain',
    });
    if (!result.success || !result.text) return fallback;
    const m = result.text.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const obj = JSON.parse(m[0]);
    const terms = clarifyStr(obj && obj.terms, 400);
    const lines = (Array.isArray(obj && obj.lines) ? obj.lines : [])
      .map(v => clarifyStr(v, 120)).filter(Boolean).slice(0, options.length);
    if (!terms && !lines.length) return fallback;
    // ★환각 0(decideClarify 의 hint 검증과 같은 규약): 근거자료에 없는 조문번호가 하나라도 섞이면
    //   그 설명은 통째로 버리고 원래 되묻기만 다시 낸다.
    const body = terms + '\n' + lines.join('\n');
    if ((body.match(/제\d+조(?:의\d+)?/g) || []).some(a => !block.includes(a))) return fallback;
    const answer = [terms, lines.map((v, i) => `- **${options[i].label}**: ${v}`).join('\n')]
      .filter(Boolean).join('\n\n');
    return Object.assign({}, fallback, { answer });
  } catch (_) {
    return fallback;
  }
}

/**
 * 하이브리드 검색: canonicalOnly 필터 → 메타점수(+AI 질의확장) → glossary 강제후보 병합
 * → 본문 직접매칭 재점수 → 관련도 낮은 꼬리 컷 → 상위 페이지 그래프 1홉 확장. 클라
 * 아코디언용 sources와 답변합성용 contextPages를 함께 반환.
 * @param {string} query
 * @param {{canonicalOnly?:boolean, restate?:string}} opts
 *   - restate: [H-37 §17] 사용자가 "네, 맞아요"로 확인한 **이해확인 재진술 문장**. 있으면 질의확장
 *     LLM 이 그 뜻까지 보고 검색어를 뽑는다(query 문자열은 어디서도 안 바꾼다 — 설계 §3.3 R2).
 * @returns {Promise<{sources:Array, contextPages:Array}>}
 */
async function search(query, opts) {
  const canonicalOnly = !!(opts && opts.canonicalOnly);
  const idx = loadIndex();
  const pages = idx.pages || [];
  // (2026-08-05) 이전엔 여기서 draft(비-statute) 페이지를 통째로 제외했다. 이제는 페이지 자체는
  // 점수 매기기 후보에 남겨두고, 아래 citableBody()가 draft 페이지의 REVIEW 마커 없는 부분만
  // 골라 인용에 쓴다 — 전부 REVIEW로 덮여있던 페이지는 citableBody가 빈 문자열을 돌려주므로
  // finalWithBody 단계에서 자연히 걸러진다.

  const byFile = new Map(pages.map(p => [p.kind + ':' + p.file, p]));
  const terms = termsOf(query);
  const { extraTerms, forcedSlugs } = glossaryExpand(query);
  // [H-37 §17] 확인된 재진술은 **여기 한 갈래로만** 검색에 들어온다 — 질의확장 LLM 이 그 문장을 보고
  //   뽑은 용어가 aiTerms 로 합류한다(재진술 낱말을 그대로 얹지 않는 이유는 §17 실측 기록 참고).
  //   재진술이 없으면 호출도 프롬프트도 오늘과 같아 allTerms 가 문자 그대로 동일하다(R0).
  const aiTerms = await expandQueryTerms(query, opts && opts.restate);
  // [B8] 약칭(「어선안전조업법」)으로 물어도 정식 명칭 페이지가 잡히게 정식명을 검색어로 얹는다.
  //   표가 없거나 약칭이 안 걸리면 빈 배열이라 allTerms 가 오늘과 문자 그대로 같다(R0).
  const aliasTerms = aliasExpand(query);
  // ★[이어서 질문] 직전 답변의 주제를 **검색 확장어로만** 얹는다(2026-08-18 사용자 확정).
  //   restate 와 완전히 같은 규약이다 — 질의 문자열에는 절대 합치지 않는다(§2.1 세 오염 방지).
  //   왜 필요한가: "🔁 이어서"의 옛 방식은 **직전 질문 원문을 통째로** 새 질문 뒤에 이어붙여
  //   "신고 안 하면? — 낚시어선업 절차와 방법 요건같은거"가 됐다. 그러면 ①이해확인이 "문제점과
  //   절차·방법·요건을 알고 싶다"로 읽어 **이미 답한 절차를 또** 설명하려 하고 ②검색어가
  //   "절차·방법·요건" 같은 일반어로 오염돼 폐기물 투기·공유수면 매립 같은 무관한 선택지가
  //   딸려 나왔다(실사용 재현). 필요한 건 직전 질문 전체가 아니라 **주제 하나**뿐이다.
  const topicTerms = termsOf(String((opts && opts.topic) || '')).slice(0, 6);
  // 주제가 정확히 일치하는 페이지에 주는 가산점. L-57 의 컷라인(1위의 30%)을 넘길 만큼은 되어야
  // 하고, 그렇다고 질문 자체를 덮을 만큼 커서도 안 된다 — glossary 강제후보(+4)와 같은 눈금을 쓴다.
  const TOPIC_BONUS = 4;
  const allTerms = [...new Set([...terms, ...extraTerms, ...aiTerms, ...aliasTerms, ...topicTerms])];

  // 흔한 낱말이 점수를 지배하지 못하게 무게를 매긴다(termWeights 주석의 실측 사례 참고).
  const weights = termWeights(pages, allTerms);
  let scored = pages.map(p => ({ p, s: scoreOne(p, allTerms, weights) })).filter(x => x.s > 0);
  // ★[이어서 질문] 확장어만으로는 약했다(2026-08-18 사용자 재현: 낚시어선업 이야기를 하다
  //   "허가 받았는데 신고 안 하고 영업하면?"이라 물으니 수산부산물·폐기물 처리업이 선택지로 떴다).
  //   `topic` 은 **위키 페이지의 주제 칸에서 그대로 가져온 값**이라, 같은 칸끼리 맞대보면 정확히
  //   같은 페이지를 집을 수 있다 — 낱말이 우연히 겹치는 것과는 신뢰도가 다르므로 가산점을 준다.
  //   ⚠순위만 올릴 뿐 **후보를 새로 만들지 않는다**(이미 점수가 0보다 큰 페이지에만 더한다) —
  //     주제가 낡았을 때 무관한 페이지를 억지로 끌어오지 않게 한다.
  const flat = v => String(v || '').replace(/\s+/g, '');
  const wantTopic = flat((opts && opts.topic) || '');
  if (wantTopic) {
    for (const x of scored) if (flat(x.p.topic) === wantTopic) x.s += TOPIC_BONUS;
  }
  // glossary 강제후보 병합(구어 매핑은 본문에 그 단어가 그대로 없을 수도 있어 별도 신호로 취급)
  for (const raw of forcedSlugs) {
    const p = resolvePage(byFile, raw);
    if (!p) continue;
    const hit = scored.find(x => x.p === p);
    if (hit) hit.s += 4; else scored.push({ p, s: 4 });
  }
  scored.sort((a, b) => b.s - a.s);

  // L-57: 관련도 최소 기준선 — 1위 점수 대비 너무 낮은(우연한 키워드 1개 겹침 수준) 꼬리는
  // 아예 후보에서 뺀다. 안 그러면 진짜 좋은 매칭이 없을 때도 PRIMARY_TOPK를 억지로 채워
  // 무관한 법이 "근거"로 뜬다(예: "배 위 흡연" 질문에 폐기물관리법 등이 낀 사례).
  const topScore = scored.length ? scored[0].s : 0;
  const MIN_KEEP_SCORE = Math.max(2, topScore * 0.3);
  scored = scored.filter(x => x.s >= MIN_KEEP_SCORE);
  const primary = scored.slice(0, PRIMARY_TOPK);

  // 그래프 1홉: 최상위 페이지의 links로 관련 개념 보강(이미 뽑힌 페이지는 제외).
  // 1위 매칭 자체가 약하면(topScore 낮음) 거기서 이어진 링크도 신뢰할 수 없어 홉을 아예 건너뛴다.
  // ⚠ "링크로 이어져 있다"는 것만으로 무조건 통과시키지는 않는다 — 그러면 질문과 아무 상관없는
  //   페이지가 근거 목록에 얹히고 그 페이지의 "근거 조문" 표까지 통째로 딸려 붙는다(실측: "낚시배
  //   음주" 질문에 음주와 무관한 페이지가 홉으로 들어와 그 조문이 근거로 뜸). 그래서 홉 후보도
  //   같은 질의어로 다시 채점(scoreOne)해 **본선과 같은 관련도 문턱**(MIN_KEEP_SCORE)을 넘는
  //   것만 받는다. 홉이 건져야 할 것은 "관련은 있는데 PRIMARY_TOPK 개수 컷에 밀린 페이지"이지
  //   "관련도 문턱에 못 미쳐 걸러진 페이지"가 아니다 — 후자는 본선에서 뺀 이유가 그대로 유효하다.
  //   ⚠ 이 문턱은 topScore 만의 함수라 **본선 후보가 몇 개인지와는 무관하다** — 본선이 적다고 문턱이
  //     저절로 높아지지 않는다(실측 반례: "스킨스쿠버" 본선 2건·"어군탐지기" 본선 3건 모두 문턱이
  //     바닥값 2.0). 본선이 적을 때 홉이 인용사슬까지 달고 나오는 위험 자체는 남아 있고, 이 문턱은
  //     "질문과 관련 없는 페이지"만 걸러줄 뿐이다(줄 단위 거름은 filterCitationChainByAnswer가 한다).
  const picked = new Set(primary.map(x => x.p));
  const hop = [];
  if (topScore >= 4) {
    for (const top of primary.slice(0, 2)) {
      if (hop.length >= HOP_MAX) break;
      for (const raw of (top.p.links || [])) {
        if (hop.length >= HOP_MAX) break;
        const p = resolvePage(byFile, raw);
        if (!p || picked.has(p)) continue;
        const hs = scoreOne(p, allTerms, weights);
        if (hs < MIN_KEEP_SCORE) continue;
        picked.add(p); hop.push({ p, s: hs, hop: true });
      }
    }
  }

  // (2026-08-05) canonicalOnly일 때 draft(비-statute) 페이지는 citableBody()가 REVIEW 마커
  // 없는 부분만 남긴 본문을 준다 — 전부 REVIEW로 덮여있던 페이지는 빈 문자열이 되어 여기서
  // 자연히 빠진다(page-level 제외 대신 content-level 제외). contextPages·sources 양쪽에서
  // 같은 본문을 다시 계산하지 않도록 한 번만 구해 재사용한다.
  const finalList = [...primary, ...hop]
    .map(x => ({ x, body: citableBody(x.p, canonicalOnly) }))
    .filter(e => e.body);

  const contextPages = finalList.map(({ x, body }, rank) => {
    const page = readPage(x.p.kind, x.p.file);
    const budget = rank < TOP_FULL_RANK ? MAX_BODY_CHARS
      : rank < MID_LAST_RANK ? MID_BODY_CHARS : TAIL_BODY_CHARS;
    return {
      law: x.p.law, topic: x.p.topic, file: x.p.file, kind: x.p.kind, status: x.p.status || null,
      hop: !!x.hop,
      frontmatter: page ? page.frontmatter : {},
      body: sliceRelevant(body, allTerms, budget),
    };
  }).filter(cp => cp.body);

  // 인용사슬은 매칭된 모든 소스에서 뽑는다(상위 소수 건으로 자르면, 정작 답변과 정확히
  // 일치하는 표를 가진 페이지가 점수 커트라인 밖으로 밀려 화면에 아예 안 뜨는 사례가 실측됨
  // — "낚싯대 음주" 질문에서 정확한 표가 있는 "해기사음주행정처분" 페이지 대신 배경설명용
  // 표만 있는 "정의와적용범위" 페이지가 상위 5등을 차지해 그 표가 뜬 사례). 뒤이어
  // filterCitationChainByAnswer(routes/legal.js)가 답변 문장과 대조해 줄 단위로 거른다.
  // extractCitationChain·extractGapNotices는 citableBody가 이미 걸러낸 본문에서 뽑으므로,
  // draft 페이지의 "## 근거 조문" 표에 REVIEW 붙은 행이 있었다면 그 행은 인용사슬에도 안 실린다.
  const sources = finalList.map(({ x, body }) => {
    const s = {
      file: x.p.file, law: x.p.law, topic: x.p.topic, kind: x.p.kind, status: x.p.status || null,
      score: x.s, hop: !!x.hop, cited: x.p.cited || [],
    };
    s.citationChain = extractCitationChain(body).map(row => Object.assign({}, row, { contact: lookupContact(row.law) }));
    // 이 페이지가 "우리가 원문을 가질 수 없는 공백"(시군구 개별고시 등)을 적어뒀으면 함께 싣는다.
    s.gapNotices = extractGapNotices(body);
    return s;
  });

  return { sources, contextPages };
}

/**
 * L-57 조치③: search()가 찾은 후보는 답변에 실제로 쓰였다는 보장이 없다 — 본선이든 그래프
 * 1홉 확장분(hop:true)이든 **관련도 문턱(MIN_KEEP_SCORE)만 넘으면** 후보로 들어오고, 문턱을
 * 넘었다는 것이 "답변이 실제로 그 법을 썼다"는 뜻은 아니다(search() 주석 참고).
 * answer(AI 답변 문장)와 sourcesOut(근거법령 목록)이 서로 다른 파이프라인이라, "확인되지
 * 않습니다"처럼 결론을 못 낸 질문에서도 화면엔 무관한 근거가 그대로 뜨는 게 실측 확인됨(_LESSONS.md
 * L-57). 이 함수는 답변 본문에 그 소스의 법령명·주제(비교표·활동 페이지처럼 law가 합성 슬러그라
 * 매칭 불가능한 kind는 인용 타법명)가 실제로 등장하는 소스만 남겨,
 * hop 여부와 무관하게 "답변에 실제로 쓰였는가"라는 동일 기준으로 근거목록을 좁힌다. 아무것도
 * 인용되지 않았으면(=전형적으로 "확인되지 않습니다" 결론) 빈 배열을 반환한다.
 * 예: answerText="…「해운법」에 따라 100만원 이하 과태료…" → law가 '해운법'인 소스만 남고,
 *     무관하게 딸려온 해수욕장법·폐기물관리법 등은 제외된다.
 * @param {Array} sources - search()가 반환한 sources(law·topic·cited 포함)
 * @param {string} answerText - synthesizeAnswerStream()이 만든 전체 답변 문장
 * @returns {Array} 답변에 실제로 인용된 소스만(원 순서 유지)
 * [연계] ← routes/legal.js가 스트리밍 완료 후(전체 답변 확보 시점) sourcesOut 구성 직전에 호출.
 */
function filterSourcesByAnswer(sources, answerText) {
  const text = String(answerText || '');
  if (!text) return [];
  return sources.filter(s => {
    if (s.law && s.law.length >= 2 && text.includes(s.law)) return true;
    if (s.topic && s.topic.length >= 2 && text.includes(s.topic)) return true;
    // cited 매치는 비교표(kind==='comparison') 페이지에만 적용한다. cited는 "그 페이지가 근거로
    // 삼은 법"이 아니라 "본문 어디서든 「」로 언급된 모든 법"이라(lint_index.py) 흔한 법 하나만
    // 답변에 나와도 그 법을 스치듯 언급한 무관 페이지 수십~수백 건이 통째로 통과한다(실측: "낚싯배
    // 흡연" 답변이 「낚시 관리 및 육성법」을 말했다는 이유로 국제항해선박보안법 항만시설이용자의무
    // 페이지가 근거로 뜸). 그렇다고 지워버릴 수도 없다 — 비교표 페이지는 law가 진짜 법령명이
    // 아니라 표 제목(예: '음주운항_측정거부')이고 topic도 비어 있어 위 두 분기로는 영영 안 걸리고,
    // 오직 이 cited 분기로만 살아남는다. 그래서 이 우회가 원래 필요했던 비교표에만 남긴다.
    // 활동(kind==='activity') 페이지도 구조가 똑같아(law='activity_해루질' 같은 합성 슬러그, topic 빈 값)
    // 같은 이유로 함께 예외를 둔다 — 안 두면 "해루질 신고" 질문에서 1순위로 뽑힌 페이지가 근거목록에서 사라진다.
    if (s.kind !== 'comparison' && s.kind !== 'activity') return false;
    return (s.cited || []).some(c => c && c.length >= 3 && text.includes(c));
  });
}

// ── 묶음 조문표기(`제52~55·57조`) 풀기 — B1 ────────────────────────────────
// 위키 `## 근거 조문` 표의 조문 칸은 조 하나만 가리키지 않는다. 여러 조를 가운뎃점으로 묶고
// 범위를 섞어 적는 표기가 흔하다(실측: 어선원안전보건재해예방 페이지의 `제28·31·32·37·40·43조`,
// `제52~55·57조`, `제18·19·24·28조`). 아래 filterCitationChainByAnswer 의 옛 토큰 정규식은
// `제\d+조…` 꼴만 인식해 이런 칸에서 **조 번호를 하나도 못 뽑고 그 줄을 통째로 버렸다** —
// 라이브 실측: "배에서 술 마시면?" 답변이 벌칙 제53조·의무 제31/33조·고시를 전부 인용했는데
// 근거 목록엔 형식이 맞은 `제58조 / 시행령 별표5` 한 줄(과태료)만 떴다.
// ⚠ services/article_text.js 의 parseJoEnum 과 **같은 해석**을 해야 조문 팝업과 어긋나지 않는다.
//   그 파일을 require 하지는 않는다 — article_text.js 가 이미 이 모듈의 rawPathOf 를 require 하고
//   있어 역방향 require 는 순환 참조가 된다. 그래서 같은 규칙의 최소 파서만 여기 둔다.
// ⚠ 맨숫자 항목의 뜻은 표기 끝의 '조' 유무로 갈린다(article_text.js 파일머리 주석의 실측 542건):
//   `제109·110조`는 별개 조(109조·110조), `제30조의5·6`은 앞 항목의 가지번호(30조의5·30조의6).
//   이 구분을 안 하면 제30조의6 대신 **인용된 적 없는 제6조**를 근거인 척 보여주게 된다.
const CHAIN_ENUM_ONLY_RE = /^[\s제조의항호0-9·ㆍ・,~～∼]+$/;
const CHAIN_ITEM_RE = /^\s*제?\s*(\d+)(?!\d)(?:\s*조?\s*의\s*(\d+)(?!\d))?\s*조?\s*(?:제?\s*\d+(?!\d)\s*항)?\s*(?:제?\s*\d+(?!\d)\s*호)?\s*$/;
const CHAIN_BRANCH_RE = /^\s*의\s*(\d+)\s*$/;
const CHAIN_RANGE_RE = /^\s*제?\s*(\d+)\s*[~～∼]\s*(\d+)\s*(?:조\s*의\s*\d+)?\s*조?\s*$/;

/**
 * `제52~55·57조`처럼 **가운뎃점으로 묶고 범위를 섞어 적은 조문 칸**을 조 번호 목록으로 편다.
 * 하나라도 못 읽는 항목이 있으면 통째로 null 을 돌려 기존 처리(범위·단일 토큰 대조)에 맡긴다 —
 * 절반만 풀어 그중 하나를 근거로 보여주는 것이 이 저장소에서 가장 하면 안 되는 일이다(환각 0).
 * 예: expandJoEnum('제52~55·57조')          → ['제52조','제53조','제54조','제55조','제57조']
 *     expandJoEnum('제28·31·32·37·40·43조') → ['제28조','제31조','제32조','제37조','제40조','제43조']
 *     expandJoEnum('제30조의5·6')           → ['제30조의5','제30조의6']
 *     expandJoEnum('제58조 / 시행령 별표5')  → null(다른 글자가 섞여 단정 불가)
 *     expandJoEnum('제3조제2항')            → null(가운뎃점이 없다 — 묶음이 아니다)
 * @param {string} article - 근거 조문 표의 조문 칸 값
 * @returns {string[]|null} 조 2개 이상이면 목록(등장 순서·중복 제거), 아니면 null
 * [연계] ← filterCitationChainByAnswer. 같은 규칙: services/article_text.js parseJoEnum(수정 금지).
 */
function expandJoEnum(article) {
  const s = String(article || '');
  if (!CHAIN_ENUM_ONLY_RE.test(s) || !/[·ㆍ・,]/.test(s) || !/조/.test(s)) return null;
  const toks = s.split(/[·ㆍ・,]/).map(t => t.trim()).filter(Boolean);
  const out = [];
  let sawRange = false;
  let prevBranchJo = 0;      // 바로 앞 항목이 `제N조의M`이었으면 그 본조 번호 N(아니면 0)
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const rm = CHAIN_RANGE_RE.exec(t);
    if (rm) {
      const from = parseInt(rm[1], 10), to = parseInt(rm[2], 10);
      if (!(from >= 1 && to > from)) return null;
      for (let n = from; n <= to; n++) out.push(`제${n}조`);
      sawRange = true; prevBranchJo = 0;
      continue;
    }
    const bm = CHAIN_BRANCH_RE.exec(t);
    if (bm) {
      if (!prevBranchJo) return null;          // 물려받을 본조가 없다 — 단정 불가
      out.push(`제${prevBranchJo}조의${bm[1]}`);
      continue;
    }
    const m = CHAIN_ITEM_RE.exec(t);
    if (!m) return null;
    if (m[2]) { out.push(`제${m[1]}조의${m[2]}`); prevBranchJo = parseInt(m[1], 10); continue; }
    // 맨숫자 항목 — 이 항목이나 뒤쪽 어딘가에 '조'가 적혀 있어야 그 '조'를 나눠 가진 별개 조로 읽는다.
    if (!/조/.test(t) && !toks.slice(i + 1).some(x => /조/.test(x))) {
      if (prevBranchJo) { out.push(`제${prevBranchJo}조의${m[1]}`); continue; }
      if (!sawRange) return null;              // 물려받을 본조도, 앞선 범위도 없다 — 단정 불가
    }
    out.push(`제${m[1]}조`);
    prevBranchJo = 0;
  }
  const uniq = [...new Set(out)];
  return uniq.length >= 2 ? uniq : null;
}

/**
 * 조문 칸에 **가운뎃점으로 이어 적은 조·별표 번호**를 낱개 표기로 편다.
 * `expandJoEnum` 은 칸 **전체**가 조 묶음일 때만 쓴다. 여기는 `제2·3조·별표1·2` 처럼 다른 글자가
 * 섞여 그쪽이 못 받는 칸에서, 아래 토큰 대조가 **맨 앞 항목 하나만 뽑고 나머지를 통째로 잃던 것**을
 * 막는다(전 위키 90행). 라이브 검증에서 연안관리법 시행지침 `별표2·5·6·8·9` 행이 별표2 만 뽑혀
 * 답변이 인용한 별표5 와 안 맞아 통째로 탈락했다 — 답변 본문은 별표5 내용을 정확히 옮겼는데도다.
 * ★칸에 **적혀 있는 번호만** 편다 — 없는 번호를 만들어내지 않는다(환각 0). 한 항목이라도 못 읽으면
 *   통째로 빈 배열을 돌려 기존 처리에 맡긴다(절반만 펴서 그중 하나를 근거로 보여주지 않는다).
 * 예: articleEnumTokens('제2·3조·별표1·2')   → ['제2조','제3조','별표1','별표2']
 *     articleEnumTokens('제9·11·18~21조')    → ['제9조','제11조','제18조','제19조','제20조','제21조']
 *     articleEnumTokens('제115조제3·4호')    → [](조가 하나뿐 — 아래 토큰 대조가 이미 집는다)
 * @param {string} article - 근거 조문 표의 조문 칸 값
 * @returns {string[]} 편 낱개 표기(펼 것이 없으면 빈 배열)
 * [연계] ← filterCitationChainByAnswer(토큰 대조 갈래).
 */
function articleEnumTokens(article) {
  const s = String(article || '');
  const out = [];
  let m;
  // 조 묶음: `제2·3조` · `제9·11·12·16·18~21조`(범위 섞임)
  const joRun = /제\s*(\d+(?:\s*[·ㆍ・~∼]\s*\d+)+)\s*조(?!의)/g;
  while ((m = joRun.exec(s)) !== null) {
    for (const part of m[1].split(/[·ㆍ・]/)) {
      const rg = /^\s*(\d+)\s*[~∼]\s*(\d+)\s*$/.exec(part);
      if (rg) {
        const from = parseInt(rg[1], 10), to = parseInt(rg[2], 10);
        if (!(from >= 1 && to > from && to - from <= 100)) return [];
        for (let n = from; n <= to; n++) out.push(`제${n}조`);
        continue;
      }
      const n = parseInt(part.trim(), 10);
      if (!(n >= 1)) return [];
      out.push(`제${n}조`);
    }
  }
  // 별표·별도 묶음: `별표1·2` · `별표2·5·6·8·9`
  const annexRun = /(별표|별도)\s*(\d+(?:의\d+)?(?:\s*[·ㆍ・]\s*\d+(?:의\d+)?)+)/g;
  while ((m = annexRun.exec(s)) !== null) {
    for (const part of m[2].split(/[·ㆍ・]/)) {
      const t = part.trim();
      if (!/^\d+(?:의\d+)?$/.test(t)) return [];
      out.push(m[1] + t);
    }
  }
  return [...new Set(out)];
}

/**
 * 답변 문장이 그 조를 인용할 때 **실제로 쓴 표기 전체**(항·호 포함)를 답변에서 그대로 떼어 온다.
 * ★환각 0: 답변 문장에 **문자 그대로 있는 표기만** 돌려준다 — 조·항·호를 조립해 만들지 않는다.
 * 예: citedArticleIn('…「어선안전조업법」 제58조제5항제7호에 따라…', '제58조') → '제58조제5항제7호'
 *     citedArticleIn('… 제9조제1항 … 제9조제3항 …', '제9조', '제9조제3항')     → '제9조제3항'
 *     citedArticleIn('… 제5조의2 …', '제5조')                                 → ''(제5조는 인용된 적 없다)
 * @param {string} text - 답변 전체 문장
 * @param {string} jo - 조 표기(`제53조`·`제30조의5`)
 * @param {string} [prefer] - 위키 칸이 항·호까지 짚었을 때 그 표기(같은 조의 다른 항을 집지 않게)
 * @returns {string} 답변에 없으면 ''
 * [연계] → citationChain[].citedArticle(계약1) → routes/legal.js attachChainExcerpts(발췌를 그 항·호로 좁힘)
 *          · client/js/ai-chat/ai_chat.js(본문 조문 링크).
 */
function citedArticleIn(text, jo, prefer) {
  if (!jo) return '';
  // jo 는 이 파일이 만든 값이라 정규식 특수문자가 없다(숫자와 제·조·의뿐) — 이스케이프 불필요.
  // `(?!의\d)`: '제5조'로 '제5조의2'의 앞부분을 집으면 인용된 적 없는 제5조가 근거가 된다.
  const re = new RegExp(jo + '(?!의\\s*\\d)(?:\\s*(?:제\\s*\\d+\\s*항|[①-⑳]))?(?:\\s*제?\\s*\\d+(?:의\\d+)?\\s*호)?', 'g');
  const all = String(text || '').match(re) || [];
  if (!all.length) return '';
  const narrowed = (prefer && prefer !== jo) ? all.filter(c => c.startsWith(prefer)) : [];
  const pool = narrowed.length ? narrowed : all;
  return pool.reduce((a, b) => (b.length > a.length ? b : a), pool[0]);
}

// 법령 칸이 법 이름 없이 계층 낱말만 적힌 행(`시행령`·`시행규칙`)의 판정용 — B3.
const BARE_TIER_CELL_RE = /^(시행령|시행규칙)$/;

/**
 * 그 줄의 법령이 답변 문장에 실제로 언급됐는가.
 * 위키 표에는 법령 칸이 `시행규칙`처럼 **계층 낱말만** 적힌 행이 흔하다 — 그 줄이 실린 페이지의
 * 법(baseLaw)을 알고 있으므로 `<baseLaw> 시행규칙` 꼴로도 대조한다(B3).
 * ⚠ 기존의 낱말 그대로 대조(`text.includes('시행규칙')`)는 **그대로 남긴다** — 답변이 법 이름 없이
 *   "시행규칙 제18조에 따라"라고만 쓰는 일이 흔해, 이걸 빼면 정상 줄이 대거 사라진다. 즉 이 함수는
 *   오늘 통과하던 줄을 떨어뜨리지 않고 **살릴 줄만 더한다**(무관한 줄이 붙는 것이 더 나쁘다는 원칙과
 *   충돌하지 않게, 새로 더하는 경로는 baseLaw 로 법을 특정한 경우뿐이다).
 * @param {string} law - 근거 조문 표의 법령 칸
 * @param {string} baseLaw - 그 줄이 실려 있던 위키 페이지의 법
 * @param {string} text - 답변 전체 문장
 * @returns {boolean}
 * [연계] ← filterCitationChainByAnswer.
 */
function lawMentionedInAnswer(law, baseLaw, text) {
  for (const v of lawCellVariants(law)) {
    if (lawMentionedOnce(v, baseLaw, text)) return true;
  }
  return false;
}

/**
 * 법령 칸에 붙은 **괄호 주석**을 떼어 대조용 후보 이름들을 만든다(원문 칸도 항상 첫 후보로 남긴다).
 * ⚠왜(2026-08-18 라이브 검증 실측): 위키 칸은 출처를 친절히 밝히려고 괄호를 덧붙인다 —
 *   `서해 5도 해상운송비 지원 지침(고시)` · `낚시터의 시설 및 장비 세부기준(해양수산부고시 제2026-91호)` ·
 *   `고시(연안정비 시설물 사후관리 및 효과평가 시행지침)` · `섬 발전 촉진법(구 도서개발 촉진법)`.
 *   그런데 답변은 「서해 5도 해상운송비 지원 지침」처럼 **이름만** 쓴다. 칸 문자열을 통째로 찾던
 *   기존 대조는 이런 행(전 위키 10,274행 중 288행, 2.8%)을 **한 줄도 통과시키지 못했고**, 그래서
 *   답변 본문은 그 고시의 수치를 정확히 쓰는데 근거 목록에는 그 고시가 아예 안 뜨거나 같은 조번호의
 *   모법이 대신 실렸다(서해5도·연안관리법·해운법 등 라이브 검증 13건의 공통 원인).
 * ⚠느슨해지지 않는다: 후보는 **여전히 온전한 법령 이름**이라 답변에서 그 이름을 찾는 검사 자체는
 *   그대로 엄격하다. 조문 주인 판정(ownedByThisLaw)도 그대로 걸린다. 두 글자 이하로 줄어드는
 *   후보(`고시`·`훈령` 같은 계층 낱말만 남는 경우)는 버린다 — 아무 답변에나 걸려 무관한 줄이 붙는다.
 * 예: lawCellVariants('서해 5도 해상운송비 지원 지침(고시)')
 *     → ['서해 5도 해상운송비 지원 지침(고시)', '서해 5도 해상운송비 지원 지침']
 * @param {string} law - 근거 조문 표의 법령 칸
 * @returns {string[]} 대조에 쓸 후보 이름들(원문이 항상 첫 번째)
 * [연계] ← lawMentionedInAnswer.
 */
const TIER_WRAP_RE = /^(?:고시|훈령|예규|지침|규정|요령|세칙|행정규칙|운영규칙)\s*\((.+)\)$/;
// 이름이 아니라 **갈래 이름**뿐인 후보 — 답변의 "행정규칙에 따라"·"고시로 정한다" 같은 평범한 문장에
// 걸려 무관한 줄을 끌고 오므로 후보에서 뺀다(실측: 892개 법령 칸 중 7개가 이런 꼴이었다).
// ⚠원문 칸 자체는 후보에서 빼지 않는다 — 지금까지 통과하던 줄을 떨어뜨리지 않기 위해서다.
const GENERIC_LAW_NAME_RE = /^(?:행정규칙|고시|훈령|예규|지침|규정|요령|세칙|운영규칙|세칙\/규정|법|법률|시행령|시행규칙)$/;
function lawCellVariants(law) {
  const s = String(law || '').trim();
  if (!s) return [];
  const out = [s];
  const add = v => {
    const t = String(v || '').trim();
    if (t.length > 2 && !GENERIC_LAW_NAME_RE.test(t) && !out.includes(t)) out.push(t);
  };
  // ⓐ `고시(<이름>)` 처럼 **계층 낱말이 이름을 감싼** 꼴 — 괄호 안이 진짜 이름이다.
  const w = TIER_WRAP_RE.exec(s);
  if (w) add(w[1]);
  // ⓑ 이름 뒤에 괄호 주석이 붙은 꼴 — 괄호 앞이 이름이다.
  else if (/\)$/.test(s)) add(s.slice(0, s.lastIndexOf('(')));
  // ⓒ 이름 **앞**에 발령기관을 괄호로 밝힌 꼴 — 괄호 뒤가 이름이다(전 위키 31행).
  //   위키는 출처를 분명히 하려고 `(국립농산물품질관리원) 수입농산물등 유통이력관리 조사 요령`
  //   처럼 적는데, 답변은 「수입농산물등 유통이력관리 조사 요령」 이라고만 쓴다. ⓑ가 뒤쪽 괄호만
  //   봐서 이런 행은 한 줄도 통과하지 못했다(라이브 검증: 원산지표시법 조사요령 별표4).
  //   ⚠괄호를 뗀 나머지가 **법령 갈래 낱말로 끝날 때만** 이름으로 인정한다 — `(타법) 처벌(형벌)`
  //     처럼 이름이 아닌 칸까지 후보로 만들지 않기 위해서다.
  const lead = /^\(([^)]{2,40})\)\s*(.+)$/.exec(s);
  if (lead && /(법|령|규칙|고시|지침|요령|규정|세칙|조례|기준|공고|예규|훈령|정관)$/.test(lead[2].trim())) add(lead[2]);
  return out;
}

/** lawMentionedInAnswer 의 원래 판정(후보 이름 하나에 대해). 기존 규칙을 그대로 둔다. */
function lawMentionedOnce(law, baseLaw, text) {
  const s = String(law || '').trim();
  if (!s || s.length < 2) return false;
  if (text.includes(s)) return true;
  // ⓐ 계층 낱말만 적힌 칸(`시행령`·`시행규칙`) — 그 줄이 실린 페이지의 법(baseLaw)으로 편다.
  if (BARE_TIER_CELL_RE.test(s.replace(/\s+/g, ''))) {
    const base = String(baseLaw || '').trim();
    if (!base) return false;
    return [base].concat(aliasesOfFormalName(base)).some(n => n && text.includes(n + ' ' + s));
  }
  // ⓑ `<법 이름> 시행령/시행규칙` 꼴 — 답변은 같은 하위법령을 **다른 문자열로** 쓴다:
  //    정식명 전체(「어선안전조업 및 어선원의 안전ㆍ보건 증진 등에 관한 법률」 시행규칙)를 그대로
  //    쓰기도 하고, 약칭(어선안전조업법 시행규칙)이나 계층 낱말만(시행규칙 제18조) 쓰기도 한다.
  //    ⓐ와 대칭이 안 맞으면 **위키가 법 이름을 정확히 적어둘수록 행이 죽는** 역설이 생긴다
  //    (G2·G1 두 그룹이 같은 함정을 지적 — 한쪽은 그래서 정식명 채우기를 보류했고 다른 쪽은
  //    채웠다. 데이터를 어느 쪽으로 통일하든 코드가 둘 다 받아야 이 선택이 무해해진다).
  //    ★느슨해지지 않는다: 계층 낱말이 답변에 있고 **그 법의 이름(정식명 또는 약칭)도** 답변에
  //    있을 때만 통과한다 — ⓐ의 기존 판정(계층 낱말만 대조)보다 오히려 좁다.
  const m = /^(.+?)\s*(시행령|시행규칙)$/.exec(s);
  if (m) {
    const name = m[1].trim(), tier = m[2];
    if (!name || !text.includes(tier)) return false;
    return [name].concat(aliasesOfFormalName(name)).some(n => n && text.includes(n));
  }
  return false;
}

// 답변이 주체별로 나뉠 때 쓰는 소제목 — 답변 원칙 8이 지시한 "1. → 가." 위계의 첫 단계에
// **굵게** 라벨이 붙은 꼴만 인정한다(예: `1. **어선원 본인**`). 라벨이 없거나 굵게가 아니면
// 주체 구분으로 단정할 수 없다.
const SUBJECT_HEAD_RE = /^[ \t]*(\d+)\.[ \t]*\*\*([^*\n]{1,30})\*\*/gm;

/**
 * 답변 문장을 주체별 구간으로 나눈다(B4 하이브리드 1단계 — **답변 문장에 실제로 적힌 소제목**만).
 * ⚠ 위키에는 주체 정보가 없다 — 답변 문장 밖에서 추측하지 않는다.
 * ⚠ 소제목이 하나뿐이면 나눌 게 없으므로 [](=구분 없음)을 돌려준다.
 * 예: answerSubjects('… 1. **어선원 본인**\n… 제33조 … 2. **어선소유자**\n… 제31조 …')
 *     → [{label:'어선원 본인', body:'1. **어선원 본인**\n… 제33조 …'}, {label:'어선소유자', …}]
 * @param {string} text - 답변 전체 문장
 * @returns {Array<{label:string, body:string}>}
 * [연계] → subjectOfCitation → citationChain[].subject(계약1b) → ai_chat.js(주체별 묶어 그리기).
 */
function answerSubjects(text) {
  const heads = [];
  SUBJECT_HEAD_RE.lastIndex = 0;
  let m;
  while ((m = SUBJECT_HEAD_RE.exec(text)) !== null) heads.push({ label: m[2].trim(), at: m.index });
  if (heads.length < 2) return [];
  return heads.map((h, i) => ({
    label: h.label,
    body: text.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : text.length),
  }));
}

/**
 * 그 인용 표기가 **어느 주체 구간에만** 나오는지 판정한다. 두 구간에 걸치거나 어디에도 없으면 ''.
 * ★틀리게 나누느니 안 나눈다 — ''이면 화면은 지금처럼 한 줄기로 그린다.
 * @param {Array} sections - answerSubjects()의 결과
 * @param {string} cited - 답변이 쓴 인용 표기(citedArticleIn 결과)
 * @returns {string} 주체 라벨(없으면 '')
 */
function subjectOfCitation(sections, cited) {
  if (!sections.length || !cited) return '';
  const hit = sections.filter(s => s.body.includes(cited));
  return hit.length === 1 ? hit[0].label : '';
}

/**
 * filterSourcesByAnswer가 소스 페이지 단위로 걸러도, 그 페이지 안 citationChain 표는 줄 단위로
 * 한 번도 답변과 대조되지 않아 무관한 줄이 그대로 섞여 나온다(실측: "낚싯대 음주" 질문에서
 * "선박직원법·정의와적용범위" 페이지의 배경설명용 표 9줄 — 목적·정의·국가간협력·외국사무 등 — 이
 * 답변 어디에도 없는데 근거 목록에 통째로 뜸). 이 함수는 그 줄들을 답변 문장과 대조해, 법령명과
 * 조문번호(또는 별표번호)가 둘 다 실제로 언급됐을 때만 남긴다.
 * ⚠ 범위·나열 인용(예: "제1∼3조", "시행령 제2조·제3조")은 각 조 번호를 개별 추출해 대조한다.
 *   추출 자체가 안 되는 표기(요지만 있고 조 번호가 없는 등)는 검증할 수 없으므로 뺀다(환각 0).
 * ⚠ 조 번호만 떼어 대조하면 오탐이 난다 — 같은 조 안에 서로 다른 항이 나열된 표(예: 선박직원법
 *   제9조는 ①일반 취소사유·③음주 처분이 따로 있다)에서, 답변이 "제9조제1항"만 말했는데 "제9조제3항"
 *   행까지 살아남는 사례가 실측됨. 그래서 항·호까지 표기에 있으면 그것까지 붙여 하나의 토큰으로
 *   본다("제9조제3항"을 통째로 대조 — "제9조"만 대조하지 않는다).
 * ⚠ 묶음 표기(`제52~55·57조`)는 expandJoEnum 으로 풀어 **답변이 실제로 인용한 조만 각자 자기 줄로**
 *   쪼갠다(B2) — 원본 줄의 law·tier·effectiveDate·contact·step 은 그대로 물려주고 article 만 그 조로
 *   좁힌다. 요지(gist)는 묶음 행의 것이라 여러 줄에 같은 값이 붙는데, 위키 원문 그대로라 무방하다.
 *   ★환각 0: 표기를 푼 결과 안에 있고 **답변 문장에도 문자 그대로 있는** 조만 줄로 만든다.
 * ⚠ 살아남은 줄마다 `citedArticle`(답변이 쓴 인용 표기 전체, 항·호 포함 — 계약1)과 `subject`
 *   (주체 라벨 — 계약1b)를 채운다. 근거 없으면 둘 다 ''.
 * 예: filterCitationChainByAnswer([{law:'선박직원법',article:'제9조제3항',…}, {law:'선박직원법',article:'제9조제1항',…}],
 *     '…「선박직원법」 제9조제3항에 따라…') → 제9조제3항 줄만 남고 제9조제1항 줄은 빠진다.
 * @param {Array} chain - source.citationChain(law·article 포함)
 * @param {string} answerText - synthesizeAnswerStream()이 만든 전체 답변 문장
 * @param {string} [baseLaw] - 그 줄이 실려 있던 위키 페이지의 법(법령 칸이 `시행규칙`뿐인 행의 해석용)
 * @returns {Array} 답변에 실제로 인용된 줄만(원 순서 유지, 묶음 행은 인용된 조 수만큼 쪼개짐)
 * [연계] ← routes/legal.js가 filterSourcesByAnswer 직후, finalSources 각 소스에 적용(baseLaw = s.law).
 */
/** 조문·별표 표기를 **조 단위 열쇠**로 줄인다(공백 제거 + 항·호 잘라내기).
 * 위키 칸은 `제25조`인데 답변은 `제25조제1항`이라 원문 그대로는 안 맞아, 둘을 같은 자리로 본다.
 * 별표·별지·별도는 항·호가 없어 통째로 열쇠가 된다.
 * 예: joKeyOf('제25조제1항') → '제25조' · joKeyOf('별표 4') → '별표4'
 * @param {string} t @returns {string}
 * [연계] ← citationOwners · ownedByThisLaw. */
function joKeyOf(t) {
  const f = String(t || '').replace(/\s+/g, '');
  const m = /^제\d+조(?:의\d+)?/.exec(f);
  return m ? m[0] : f;
}

/** 법령명에서 계층 꼬리(시행령·시행규칙)를 떼어 **모법 이름**만 남긴다(약칭은 정식명으로).
 * 시행령·시행규칙과 모법을 같은 소속으로 묶으려고 쓴다 — "같은 법 시행령 제16조"처럼 답변이
 * 모법을 앞에 쓰고 하위법령 조문을 이어 쓰는 표기를 살리기 위해서다.
 * 예: baseNameOf('낚시 관리 및 육성법 시행령') → '낚시 관리 및 육성법'
 * @param {string} name @param {string} [baseLaw] - 계층 낱말뿐인 칸을 펼 때 쓸 페이지의 법
 * @returns {string} 못 정하면 ''
 * [연계] ← citationOwners · ownedByThisLaw. → lawKeyOf(약칭 → 정식명). */
function baseNameOf(name, baseLaw) {
  const k = lawKeyOf(name, baseLaw);
  if (!k) return '';
  return k.replace(/(?:\s*[·ㆍ・,/]?\s*(?:시행령|시행규칙))+\s*$/, '').replace(/[\s·ㆍ・,/]+$/, '').trim();
}

/**
 * 답변에서 **법 이름과 조문이 붙어 나온 인용**만 모아 "이 조문은 어느 법의 것인가"를 기록한다.
 * 근거 줄이 진짜 그 법의 조문으로 인용됐는지 보려는 것이다(근접성).
 * 예: citationOwners('「선박직원법」 제2조제1호에 따라') → Map{'제2조' → Set{'선박직원법'}}
 * ⚠기록에 없는 조문은 **판정하지 않는다**(호출부가 통과시킨다) — "같은 법 제53조"처럼 이어 쓰거나
 *   법 이름을 평문으로 쓴 자리는 주인을 단정할 수 없고, 여기서 단정하면 정당한 근거가 사라진다.
 * @param {string} text - 답변 전체 문장
 * @returns {Map<string, Set<string>>} 조 단위 열쇠 → 그 조문을 인용한 법들의 모법 이름
 * [연계] ← filterCitationChainByAnswer. → extractAnswerCitations(같은 추출기 재사용) · ownedByThisLaw.
 */
function citationOwners(text) {
  const owners = new Map();
  // ★"확정 인용"만 주인으로 인정한다 — extractAnswerCitations 는 `「법령명」 제N조` 처럼 **법 이름과
  //   조문이 실제로 붙어 나온 것만** 뽑고, 우리가 원문을 가진 법인지까지 확인한다(환각 0 경로에서
  //   이미 쓰는 함수 재사용). 문맥을 이어 추측하지 않으므로 판정이 보수적이다.
  //   ⚠직접 스캔해 "직전 「」를 그 뒤 모든 조문의 주인으로" 잇는 방식도 만들어 봤으나, 위키 전 페이지
  //     대조에서 정당한 줄까지 28.5%가 탈락했다(법 이름을 「」 없이 평문·링크로 쓰는 자리가 많고,
  //     "같은 법"이 앞쪽 문맥을 가리키기도 한다). **누락이 오탐보다 나쁘다**는 이 저장소 원칙에 따라
  //     추측하는 방식은 버리고, 붙어 나온 것만 세는 이 방식으로 좁혔다.
  // anyLaws = 답변에서 `「법령명」 제N조` 꼴로 **한 번이라도 확정 인용된** 법들의 모법.
  //   이 목록에 없는 법은 판정 대상에서 빼려고 함께 담는다(ownedByThisLaw 주석 참고).
  owners.anyLaws = new Set();
  // ★고시·지침·조례는 위 확정 인용에 못 담긴다 — extractAnswerCitations 는 **우리가 원문을 가진
  //   법**만 주인으로 인정하기 때문이다(resolveAnswerLaw 의 rawPathOf 관문). 그래서 답변이
  //   「내항해운에관한업무지침」 제14조제2항이라고 분명히 써도 제14조의 주인이 비어, 같은 조번호를
  //   가진 **다른 페이지의 모법 행**이 근거 목록에 딸려 붙었다(실측: 「해운법」 제14조제2항 — 그
  //   조문에는 제2항 자체가 없다). 원문 보유 여부와 무관하게 **답변이 「」로 이름을 붙여 쓴 자리**를
  //   따로 기록해 두고, 확정 인용이 없을 때만 그 기록으로 판정한다.
  // ⚠이건 "직전 「」가 뒤 모든 조문의 주인"이라는 방식이 아니다(그건 정당한 줄 28.5%를 죽였다).
  //   이름과 조문이 **바로 붙어 있는 자리만** 센다.
  owners.named = new Map();
  NAMED_CITE_RE.lastIndex = 0;
  let nm;
  while ((nm = NAMED_CITE_RE.exec(text)) !== null) {
    const k = joKeyOf(nm[2]);
    if (!owners.named.has(k)) owners.named.set(k, new Set());
    owners.named.get(k).add(flatLawName(nm[1]));
  }
  for (const c of extractAnswerCitations(text)) {
    const k = joKeyOf(c.article);
    const b = baseNameOf(c.law);
    if (!owners.has(k)) owners.set(k, new Set());
    owners.get(k).add(b);
    if (b) owners.anyLaws.add(b);
  }
  return owners;
}

// 답변에서 **이름과 조문이 바로 붙어 나온** 자리(`「법령명」 제N조`) — 사이에는 공백 정도만 허용한다.
const NAMED_CITE_RE = /「([^」\n]{2,60})」\s*(제\s*\d+\s*조(?:의\d+)?)/g;

/** 법령 이름을 비교용으로 납작하게 만든다(공백·낫표·괄호주석·계층 꼬리 제거).
 * 위키 칸(`서해 5도 해상운송비 지원 지침(고시)`)과 답변 표기(`「서해 5도 해상운송비 지원 지침」`)를
 * 같은 자리로 보려는 것이다.
 * 예: flatLawName('「해운법 시행규칙」') → '해운법'
 * @param {string} v @returns {string}
 * [연계] ← citationOwners · ownedByThisLaw. */
function flatLawName(v) {
  let t = String(v || '').replace(/[「」『』]/g, '').trim();
  const w = TIER_WRAP_RE.exec(t);
  if (w) t = w[1].trim();
  else if (/\)$/.test(t) && t.includes('(')) t = t.slice(0, t.lastIndexOf('(')).trim();
  return t.replace(/(?:\s*[·ㆍ・,/]?\s*(?:시행령|시행규칙))+\s*$/, '').replace(/\s+/g, '');
}

/** 이 근거 줄의 법이, 답변에서 그 조문의 주인으로 실제로 나온 적이 있는가.
 * 기록이 아예 없는 조문이면 **통과**시킨다(누락 0 우선 — citationOwners 주석 참고).
 * @param {Map<string,Set<string>>} owners - citationOwners 결과
 * @param {string} hit - 위키 칸에서 답변과 맞은 조문 표기
 * @param {string} law - 그 줄의 법령 칸 @param {string} [baseLaw] - 그 줄이 실린 페이지의 법
 * @returns {boolean}
 * [연계] ← filterCitationChainByAnswer.
 */
function ownedByThisLaw(owners, hit, law, baseLaw) {
  const set = owners.get(joKeyOf(hit));
  if (!set || !set.size) {
    // 확정 인용은 없지만, 답변이 그 조문에 **이름을 붙여 쓴 자리**가 있으면 그걸로 판정한다
    // (고시·지침·조례처럼 우리가 원문을 안 가진 법이 여기 걸린다).
    const named = owners.named && owners.named.get(joKeyOf(hit));
    if (!named || !named.size) return true;   // 그런 자리도 없으면 판정 안 함(버리지 않는다)
    return lawCellVariants(law).concat(baseLaw ? [baseLaw] : [])
      .some(v => named.has(flatLawName(v)));
  }
  const mine = baseNameOf(law, baseLaw);
  if (!mine) return true;                     // 모법을 못 정해도 버리지 않는다
  // ⚠이 법 자체가 답변에서 **한 번도 `「법령명」 제N조` 꼴로 인용되지 않았다면** 판정하지 않는다.
  //   그 법은 평문·약칭으로만 언급됐다는 뜻이라 "이 조문은 저 법 것"이라고 단정할 근거가 약하다
  //   (실측: 이 안전장치가 없으면 위키 전 페이지 대조에서 정당해 보이는 줄까지 5.6%가 탈락했다).
  if (!owners.anyLaws || !owners.anyLaws.has(mine)) return true;
  return set.has(mine);
}

/**
 * 답변에서 **그 법 이름 바로 뒤에** 붙어 나온 조문·별표 표기를 찾는다(근접성 대조).
 * 조문 칸이 `전체`라 짚을 조문이 없는 행을, 답변이 실제로 그 법의 조문을 인용했을 때만 살리려는 것이다.
 * 이름과 조문 사이에는 조사·따옴표 정도만 끼는 것을 허용한다(넉넉히 잡으면 남의 조문을 물어온다).
 * 예: citationNearLawName('「연안정비 시설물 사후관리 및 효과평가 시행지침」 별표5에 따르면', ['연안정비 시설물 사후관리 및 효과평가 시행지침'])
 *     → '별표5'
 * @param {string} text - 답변 전체 문장
 * @param {string[]} names - 그 줄의 법령 칸에서 만든 후보 이름들(lawCellVariants)
 * @returns {string} 찾은 조문·별표 표기(없으면 '')
 * [연계] ← filterCitationChainByAnswer(조문 칸이 `전체`인 행).
 */
// 조문 칸이 "그 문서 전부가 근거"라는 뜻인 표기. `전체` 뿐 아니라 `전체(제1~19조)` 처럼
// 괄호로 범위를 덧붙인 꼴도 같은 뜻이다(전 위키 실측 표기 두 가지).
const WHOLE_DOC_RE = /^(?:전체|전문|전조문)(?:\s*\([^)]*\))?$/;
const NEAR_CITE_RE = /^[」』\s의는은이가에서·,]{0,12}(제\s*\d+조(?:의\d+)?(?:\s*제\s*\d+항)?(?:\s*제\s*\d+호)?|별표(?:\s*\d+(?:의\d+)?)?|별지\s*제\s*\d+호(?:의\d+)?\s*서식|부칙(?:\s*[<(][^)>]{0,30}[)>])?)/;
function citationNearLawName(text, names) {
  const t = String(text || '');
  for (const nm of (names || [])) {
    if (!nm || nm.length < 3) continue;
    let from = 0;
    for (;;) {
      const at = t.indexOf(nm, from);
      if (at < 0) break;
      const m = NEAR_CITE_RE.exec(t.slice(at + nm.length, at + nm.length + 40));
      if (m) return m[1].replace(/\s+/g, '');
      from = at + nm.length;
    }
  }
  return '';
}

function filterCitationChainByAnswer(chain, answerText, baseLaw) {
  const text = String(answerText || '');
  if (!text) return [];
  const subjects = answerSubjects(text);
  const owners = citationOwners(text);
  const out = [];
  for (const row of (chain || [])) {
    if (!lawMentionedInAnswer(row.law, baseLaw, text)) continue;
    const article = String(row.article || '');

    // ★조문 칸이 **"문서 전체"**를 뜻하는 행(`전체`·`전문`·`전체(제1~19조)`).
    //   조문 토큰이 없어 아래 대조로는 한 줄도 살아남지 못한다 — 라이브 검증에서 연안관리법
    //   시행지침 별표5·갯벌복원사업 지침 별표2가 이 이유로 근거 목록에서 통째로 사라졌다
    //   (답변 본문은 그 별표 내용을 정확히 옮겼는데도).
    //   ⚠2026-08-19 실측 보강: `전체(제1~19조)` 처럼 **괄호로 조문 범위를 덧붙인 칸**은
    //     아래 범위 갈래가 먼저 집어 "제1~19조 중 하나가 답변에 있나"만 보고, 답변이 인용한
    //     것이 별표면 그대로 탈락시켰다. 그래서 괄호가 붙은 꼴도 여기서 먼저 받는다.
    //   ⚠법 이름만 맞으면 통과시키지는 않는다("무관한 줄이 붙는 게 더 나쁘다"). 답변에서
    //     **그 법 이름 바로 뒤에** 조문·별표·별지가 붙어 나온 자리가 있을 때만 통과한다.
    //   ⚠여기서 못 찾아도 **버리지 않는다** — 괄호 안에 조문 범위가 있으면 아래 범위 갈래가
    //     이어서 본다(살릴 줄만 더하고, 지금 통과하던 줄은 떨어뜨리지 않는다).
    if (WHOLE_DOC_RE.test(article.trim())) {
      const near = citationNearLawName(text, lawCellVariants(row.law));
      if (near) {
        out.push(Object.assign({}, row, {
          citedArticle: near, subject: subjectOfCitation(subjects, near),
        }));
        continue;
      }
      if (!/[~∼]/.test(article)) continue;   // 괄호에 범위조차 없으면 더 볼 것이 없다
    }

    // [B1·B2] 묶음 표기 — 푼 조 중 답변이 인용한 것만 각자 자기 줄로.
    const jos = expandJoEnum(article);
    if (jos) {
      for (const jo of jos) {
        const cited = citedArticleIn(text, jo);
        if (!cited) continue;
        // ★주인 확인은 여기에도 걸어야 한다(2026-08-18 실측). 아래 낱개 갈래에만 걸어 뒀더니,
        //   `제10~14조` 같은 묶음 행이 **다른 페이지에서** 딸려와 답변의 「내항해운에관한업무지침」
        //   제14조제2항 때문에 「해운법」 제14조제2항으로 근거 목록에 실렸다 — 해운법 제14조에는
        //   제2항 자체가 없다. 사용자가 그 줄을 누르면 없는 조문을 여는 셈이다.
        if (!ownedByThisLaw(owners, jo, row.law, baseLaw)) continue;
        out.push(Object.assign({}, row, {
          article: jo, citedArticle: cited, subject: subjectOfCitation(subjects, cited),
        }));
      }
      continue;
    }

    // ⚠ 범위 인용("제1~4조")은 조 번호를 낱개로 못 뽑아 위 토큰 방식으로는 항상 걸러졌다 — 그런데
    //   이런 배경설명용 표(목적·정의·적용범위 허브 페이지에 흔함)가 실제로는 답변이 그 범위 **안**의
    //   조문(예: "제3조제1항")을 정확히 인용한 경우가 실측됨("해상교통안전법 적용범위" 질문에서
    //   근거 법령 아코디언이 통째로 사라짐 — 답변엔 제3조제1항이 정확히 인용돼 있는데도). 범위 표기는
    //   [from,to]로 풀어, 답변에 언급된 조 번호가 그 구간 안에 들면 통과시킨다.
    //   (범위만 적힌 칸은 예전처럼 **한 줄 그대로** 남긴다 — 여러 조 전체가 근거라 어느 조 하나로
    //    좁히면 배경설명 표의 뜻이 바뀐다. 쪼개기는 묶음 표기에만 적용한다.)
    const range = /제(\d+)\s*[~∼]\s*(\d+)조/.exec(article);
    if (range) {
      const from = parseInt(range[1], 10), to = parseInt(range[2], 10);
      const inRange = (text.match(/제\d+조/g) || [])
        .find(c => { const n = parseInt(c.replace(/\D/g, ''), 10); return n >= from && n <= to; });
      // ⚠범위가 안 맞아도 **여기서 버리지 않는다**(2026-08-19 실측). `제8~13조·별표4` 처럼 범위와
      //   별표가 같은 칸에 적힌 행이 있는데, 답변이 별표4를 인용하면 위 조 범위와 안 맞는다는
      //   이유로 아래 토큰 대조까지 가보지도 못하고 탈락했다(원산지표시법 조사요령 별표4 —
      //   답변 본문은 그 별표의 의견제출기간 20일을 정확히 옮겼는데도 근거 목록에서 사라졌다).
      //   범위 갈래는 **살릴 줄만 더하고**, 못 살리면 아래 대조에 넘긴다.
      if (inRange && ownedByThisLaw(owners, inRange, row.law, baseLaw)) {
        row.citedArticle = citedArticleIn(text, inRange);
        row.subject = subjectOfCitation(subjects, row.citedArticle);
        out.push(row);
        continue;
      }
    }
    // ★조문 칸이 `전체`(그 고시·지침 전부가 근거)인 행 — 전 위키 57행. 조문 토큰이 없어 아래 대조로는
    //   **한 줄도 살아남지 못했다**(라이브 검증에서 연안관리법 시행지침 별표5가 이 이유로 근거 목록에서
    //   통째로 사라졌다 — 답변 본문은 별표5의 4개 조건을 정확히 옮겼는데도).
    //   ⚠그렇다고 법 이름만 맞으면 통과시키지는 않는다("무관한 줄이 붙는 게 더 나쁘다"). 답변에서
    //     **그 법 이름 바로 뒤에 조문·별표가 붙어 나온 자리**가 있을 때만, 그 조문을 이 줄의 인용으로
    //     삼아 통과시킨다(근접성 — 이름과 조문이 떨어져 있으면 주인을 단정할 수 없다).
    // ⚠`별표N` 외에 **`별도N`(도면·구역도)·`별지 제N호서식`** 도 인정한다(2026-08-17, B-1 실측).
    //   종전 정규식은 이 둘을 토큰으로 못 뽑아, 답변이 「수산자원관리법 시행령」 별도2(왕돌초 주변해역)나
    //   별지 서식을 정확히 인용해도 그 줄이 통째로 탈락했다 — 근거가 조용히 사라지는 L-101과 같은 뿌리다.
    //   ★공백 표기(`별지 제1호 서식`)까지 받되, 없는 표기를 만들어내지는 않는다(대조는 answerText 원문 그대로).
    // ★부칙 행(전 위키 51행) — 위키 칸은 `부칙(정부조직법) <제8852호,2008.2.29> 제6조` 처럼 적고
    //   답변은 "2008.2.29 부칙" 이나 "부칙 제20722호" 처럼 쓴다. **글자 그대로는 절대 안 맞아**
    //   부칙이 근거인 답변은 근거 목록이 통째로 비었다(라이브 검증: 한국해양수산연수원법 —
    //   답변은 "시행령 제4조 최소 2개항"을 정확히 말하는데 그 부칙이 목록에 없음).
    //   두 쪽에 **공통으로 나타나는 열쇠**로 잰다: 부칙 호수(`제20722호`)와 공포일(`2008.2.29`).
    //   둘 다 다섯 자리 안팎의 고유값이라 우연히 겹치지 않는다(짧은 호수는 제외해 오탐을 막는다).
    if (/부칙/.test(article)) {
      const flat = text.replace(/\s+/g, '');
      //   ⚠공포일은 **호수가 없을 때만** 쓴다(2026-08-19 실측): 2008.2.29 처럼 정부조직 대개정일에는
      //     여러 법의 부칙이 같은 날짜를 달고 있어, 날짜만으로 재면 답변이 말하지도 않은 다른 부칙이
      //     함께 딸려 붙는다(「한국해양수산연수원법」 부칙 제8852호가 시행령 부칙 제20722호 때문에
      //     통과하던 것을 잡았다). 호수는 고유하므로 있으면 그것만 본다.
      const keys = [];
      const ho = /제\s*(\d{3,6})\s*호/.exec(article);
      if (ho) keys.push('제' + ho[1] + '호');
      else {
        const day = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/.exec(article);
        if (day) keys.push(day[1] + '.' + Number(day[2]) + '.' + Number(day[3]));
      }
      const key = keys.find(k => flat.includes(k.replace(/\s+/g, '')));
      if (key) {
        out.push(Object.assign({}, row, {
          citedArticle: '부칙 ' + key, subject: subjectOfCitation(subjects, key),
        }));
      }
      continue;   // 열쇠가 안 맞으면 이 행은 근거가 아니다(아래 토큰 대조로 넘기지 않는다)
    }
    const tokens = (article.match(/제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?|별표\s*\d+(?:의\d+)?|별도\s*\d+(?:의\d+)?|별지\s*제\s*\d+호(?:의\d+)?\s*서식/g) || [])
      // ⚠가운뎃점으로 이어 적은 나머지 번호까지 펴서 함께 본다(articleEnumTokens 주석 참고).
      .concat(articleEnumTokens(article));
    // ⚠답변은 `별표 3`처럼 **띄어 쓰기도** 한다 — 위키 칸은 `별표3`이라 글자 그대로는 안 맞는다.
    //   공백만 지운 형태로도 대조한다(글자 자체를 바꾸는 게 아니라 공백 차이만 흡수 — 환각 0 유지).
    const flatText = text.replace(/\s+/g, '');
    const hit = tokens.find(t => text.includes(t) || flatText.includes(t.replace(/\s+/g, '')));
    if (!hit) {
      // ★번호 없는 `별표` 칸(전 위키 36행) — 고시·지침에는 별표가 하나뿐이라 번호를 안 붙인 것이 있다.
      //   위 토큰 대조는 `별표3` 처럼 **숫자가 붙은 것만** 뽑아 이런 칸을 한 줄도 통과시키지 못했다
      //   (라이브 검증: 수산자원관리법 포상금 고시 행 `제5조·별표` — 답변은 「…포상금 지급 규정」
      //    별표 가목이라고만 써서 제5조 토큰과 안 맞았고, 근거 목록에서 그 고시가 통째로 사라졌다).
      //   ⚠느슨해지지 않게, 답변에서 **그 법 이름 바로 뒤에 별표가 붙어 나온 자리**가 있을 때만
      //     통과시킨다("무관한 줄이 붙는 게 더 나쁘다"). 이름과 떨어져 있으면 주인을 단정할 수 없다.
      if (!/별표(?!\s*\d)/.test(article)) continue;
      const nearAnnex = citationNearLawName(text, lawCellVariants(row.law));
      if (!nearAnnex || !/^별표/.test(nearAnnex)) continue;
      out.push(Object.assign({}, row, {
        citedArticle: nearAnnex, subject: subjectOfCitation(subjects, nearAnnex),
      }));
      continue;
    }
    // ★근접성 검사(2026-08-18 실사용 지적 "근거 목록에 무관한 법이 섞인다"): 위 두 조건은
    //   ⓐ법 이름이 답변 어딘가에 있나 ⓑ조문번호가 답변 어딘가에 있나 를 **따로** 볼 뿐,
    //   둘이 같은 자리에 붙어 있는지는 안 본다. 그래서 답변의 「선박직원법」 제2조제1호 때문에
    //   "제2조"가 존재하면, 비교 페이지에서 온 「낚시 관리 및 육성법」 제2조 행까지 통과했다
    //   (실제 재현). 답변에서 그 조문 앞에 나온 **가장 가까운 법**의 모법이 이 줄의 모법과
    //   다르면 버린다.
    //   ★누락 0 우선: 주인을 못 정한 조문(앞에 「법령명」이 없던 자리)은 그대로 통과시킨다 —
    //     "같은 법 제53조"처럼 이어 쓰는 표기를 죽이지 않기 위해서다(citationOwners 주석 참고).
    if (!ownedByThisLaw(owners, hit, row.law, baseLaw)) continue;
    // 위키 칸이 짚은 조(`제58조`)로 답변을 다시 훑어 **항·호까지 붙은 표기**를 가져온다 — 위키 칸엔
    // 항·호가 없어도 답변은 "제58조제5항제7호"라고 쓰는 일이 흔하다(그 항·호가 발췌 대상이다, B10).
    const joOnly = /^제\d+조(?:의\d+)?/.exec(hit);
    row.citedArticle = joOnly ? citedArticleIn(text, joOnly[0], hit) : '';
    row.subject = subjectOfCitation(subjects, row.citedArticle || hit);
    out.push(row);
  }
  return out;
}

/**
 * 같은 조문을 가리키게 된 줄이 둘 이상이면 **가장 좁게 짚은 줄만** 남긴다.
 * 위키 표에는 총괄 행(`제58조` — 요지 "최고 3천만원")과 항·호를 짚은 행(`제58조제5항제7호` —
 * 요지 "5/10/15만원")이 함께 있는 경우가 있는데, 답변이 `제58조제5항제7호`를 인용하면 **두 줄 다**
 * 살아남아 화면에 같은 조문이 금액만 다른 요지로 두 번 뜬다(P0 선행에서 실측된 부작용 — 사용자가
 * 어느 금액이 맞는지 오해할 수 있다).
 * ★환각 0의 반대편(누락 0)을 지키기 위해 **버리는 기준을 아주 좁게** 잡는다 — `law`와 겹침열쇠가
 *   **둘 다 같고 그 열쇠가 비어 있지 않을 때만** 겹친 것으로 보고, 그 중 위키 칸(article)이 항·호를
 *   더 짚은 줄을 남긴다. 겹침열쇠는 `citedArticle`(조문 인용)이고, 조 번호 없이 별표만 가리켜
 *   citedArticle 이 빈 줄은 위키 칸(`article`, 예: `별표4`)을 대신 쓴다(아래 dedupeKeyOf 주석).
 *   둘 다 없는 줄(근거 자체가 불명확한 줄)은 하나도 버리지 않는다.
 * ⚠ 위키에서 총괄 행을 지우는 방식은 쓰지 않는다 — 그 행은 다른 질문("과태료 최고 얼마?")의 근거라
 *   지우면 그쪽 답변이 근거를 잃는다. 화면에 함께 뜨는 것만 막는 것이 맞다.
 * 예: dropRedundantChainRows([{law:'A',article:'제58조',citedArticle:'제58조제5항제7호'},
 *      {law:'A',article:'제58조제5항제7호',citedArticle:'제58조제5항제7호'}])
 *     → 뒤의 줄 하나만 남는다.
 * @param {Array} rows - mergeCitationChains 로 합친 줄들
 * @returns {Array} 겹친 줄을 정리한 새 배열(원 순서 유지)
 * [연계] ← routes/legal.js POST /api/legal/ask(groupCitationChainByFlow 직전).
 */
function dropRedundantChainRows(rows) {
  const list = rows || [];
  // 얼마나 좁게 짚었는지 — 항·호가 적혀 있을수록 크다(같으면 글자 수로 뒤를 가른다).
  const depth = (r) => {
    const a = String((r && r.article) || '');
    return (/제\s*\d+\s*항|[①-⑳]/.test(a) ? 2 : 0) + (/\d+\s*호/.test(a) ? 1 : 0) + a.length / 1000;
  };
  // 겹침 판정 열쇠. 조문 인용은 예전처럼 citedArticle(항·호까지)로, **별표만 가리킨 인용**은
  // 위키 칸(article, 예: `별표4`)의 공백을 지운 값으로 잡는다.
  // ★왜(2026-08-17 실측): filterCitationChainByAnswer 는 인용이 `별표4`처럼 조 번호가 없으면
  //   citedArticle 을 **항상 빈 문자열**로 채운다(`/^제\d+조/` 가 안 맞으면 ''). 그래서 서로 다른
  //   위키 두 곳이 같은 `시행령 별표4`를 근거로 갖고 있으면 두 줄 다 열쇠가 없어 겹침 검사를
  //   통째로 건너뛰고, 화면에 같은 별표가 요지만 다른 채로 두 번 떴다(낚시관리및육성법__낚시어선업신고
  //   "구명조끼·구명뗏목·AIS 등" + 낚시관리및육성법__낚시어선업 "구명조끼·소화기·통신기기 등").
  // ⚠ 조문도 별표도 없는 줄(근거 자체가 불명확한 줄)은 지금까지처럼 하나도 버리지 않는다.
  // ⚠ depth() 는 손대지 않는다 — 별표끼리는 항·호가 없어 늘 동점이라 **먼저 나온 줄**이 남는다.
  const dedupeKeyOf = (r) => {
    const cited = String((r && r.citedArticle) || '');
    return cited || String((r && r.article) || '').replace(/\s+/g, '');
  };
  // ★법령 이름은 **표기 차이를 지우고** 비교한다(2026-08-19 실측). 같은 고시라도 개념 페이지는
  //   `「불법어업 신고자 등에 대한 포상금 지급 규정」(고시)` 로, 별표 페이지는 괄호·낫표 없이
  //   `불법어업 신고자 등에 대한 포상금 지급 규정` 으로 적는다. 글자 그대로 비교하면 다른 법으로
  //   보여 겹침 검사를 그냥 지나치고, 화면에 **같은 근거가 두 줄** 뜬다(배포 직후 실제 재현).
  //   전 위키에서 이렇게 갈라 적힌 이름이 122가지다.
  //   ⚠낫표와 **맨 뒤 괄호 주석 하나만** 지운다 — `수산업법 시행령` 과 `수산업법` 처럼 실제로 다른
  //     법령이 하나로 합쳐지지 않게, 이름 안쪽 글자는 건드리지 않는다.
  const lawKeyOf = (r) => String((r && r.law) || '')
    .replace(/[「」『』]/g, '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, '').trim();
  const best = new Map();                       // law dedupeKey → 가장 좁게 짚은 줄
  for (const r of list) {
    const dedupeKey = dedupeKeyOf(r);
    if (!dedupeKey) continue;                   // 근거 없는 줄은 겹침 판정 대상이 아니다(하나도 안 버린다)
    const key = lawKeyOf(r) + ' ' + dedupeKey;
    const cur = best.get(key);
    if (!cur || depth(r) > depth(cur)) best.set(key, r);
  }
  return list.filter((r) => {
    const dedupeKey = dedupeKeyOf(r);
    if (!dedupeKey) return true;
    return best.get(lawKeyOf(r) + ' ' + dedupeKey) === r;
  });
}

// 위임 흐름의 고정 순서(넓은 것 → 좁은 것). classifyTier가 붙여둔 tier 값과 같은 낱말이라야 한다.
const FLOW_TIER_ORDER = { law: 0, decree: 1, rule: 2, notice: 3 };

/**
 * 살아남은 인용사슬 줄을 **"답변이 실제로 밟은 추론 경로"** 처럼 읽히게 재배열한다:
 * 법 하나를 법률→시행령→시행규칙→고시 순으로 끝까지 보여준 뒤, 다음 법으로 넘어간다.
 * (예: 금지는 A법, 처벌은 B법인 페이지에서 A법 줄과 B법 줄이 뒤섞여 나오던 것을 A법 묶음 → B법
 *  묶음으로 정리한다.)
 * ⚠ 법의 순서는 **답변 문장에서 그 법 이름이 처음 나오는 위치**(answerText.indexOf)로 정한다 —
 *   예전엔 들어온 배열 순서(=위키 `## 근거 조문` 표에 적힌 순서)를 썼는데, 표 순서와 답변이 실제로
 *   짚은 순서가 어긋나는 사례가 라이브에서 재현됐다: 답변은 「낚시 관리 및 육성법」의 금지부터 말하고
 *   해상교통안전법은 정의 인용으로 뒤에 붙였는데, 표 순서로는 해상교통안전법이 먼저라 화면 체인이
 *   답변의 논리 순서와 반대로 그려졌다. 표 순서는 그 위키를 쓴 사람의 편집 순서일 뿐이고, 이 함수가
 *   맞추려는 것은 **답변의 추론 경로**라 답변 문장 쪽이 정답에 가깝다. 법 이름은 **문자열 완전일치**로만 묶는다(같은 법의
 *   시행령·시행규칙은 이름이 달라 별도 그룹처럼 보이지만, 위키 표가 관행상 법률 바로 뒤에 그
 *   시행령을 적어두므로 first-occurrence 순서가 곧 위임 순서가 된다 — 이름에서 "시행령"을 떼어
 *   모법으로 합치는 추측은 하지 않는다. 약칭·개정명까지 얽혀 틀리면 없는 위임을 지어내는 셈이다).
 * ⚠ MVP 범위: 이 함수는 **이미 있는 tier·law 필드로 정렬만** 한다 — `제N조 위임 → 제M조` 링크를
 *   law.go.kr에서 그때그때 추적해 진짜 위임 사슬을 그리는 건 답변 1건마다 API 조회가 붙는 별개
 *   과제라 여기 범위 밖이다(사용자 확인). 그래서 결과는 "검증된 위임 사슬"이 아니라 "관행상
 *   위임 순서에 가깝게 정돈된 목록"이다.
 * ★환각 0: 줄을 새로 만들거나 지우거나 합치지 않는다 — 들어온 줄 그대로, 순서만 바꾼다
 *   (입력 길이 = 출력 길이).
 * 예: groupCitationChainByFlow([{law:'해상교통안전법',tier:'law'}, {law:'낚시 관리 및 육성법',tier:'law'}],
 *     '「낚시 관리 및 육성법」 제30조는 … 「해상교통안전법」 제39조④의 기준을 …')
 *     → 표에는 해상교통안전법이 먼저 있어도, 답변이 먼저 말한 낚시 관리 및 육성법 줄이 앞에 온다.
 * @param {Array} chain - filterCitationChainByAnswer를 통과한 줄들(law·tier 포함)
 * @param {string} answerText - synthesizeAnswerStream()이 만든 전체 답변 문장(법 묶음 순서의 기준)
 * @returns {Array} 법별로 묶고(답변에 먼저 나온 법이 앞) 각 묶음 안을 tier 순(law→decree→rule→notice)으로
 *                  정렬한 새 배열 (같은 tier끼리는 원래 순서 유지 — 안정 정렬)
 * [연계] ← routes/legal.js가 filterCitationChainByAnswer 직후, **여러 소스에서 합친 하나의 배열**에
 *          한 번 적용한다(소스마다 따로 적용하면 소스 하나만 화면에 남던 문제 — 아래 [연계] 참고).
 *        → ai_chat.js chainHTML(이 순서대로 체인을 그린다. 처벌 줄을 별도 체인으로 빼는
 *          isPenaltyRow 분리는 순서와 무관하게 그대로 동작한다).
 */
function groupCitationChainByFlow(chain, answerText) {
  const rows = chain || [];
  const text = String(answerText || '');
  const groups = new Map();             // law → 그 법의 줄들
  rows.forEach((row) => {
    const key = (row && row.law) || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  // 답변에서 먼저 언급된 법이 앞. 답변에 이름이 없는 법(거르기를 통과했다면 없어야 하지만
  // 방어적으로)은 맨 뒤로 — 줄을 버리지는 않는다(누락 0).
  const at = law => { const i = text.indexOf(law); return i < 0 ? Infinity : i; };
  const ordered = [...groups.keys()].sort((a, b) => at(a) - at(b));
  const out = [];
  ordered.map(k => groups.get(k)).forEach((g) => {
    // Array#sort는 Node 11+에서 안정 정렬이라 같은 tier 줄의 원래 순서가 유지된다.
    // 모르는 tier 값은 맨 뒤로 보낸다(줄을 버리지는 않는다 — 환각 0의 반대편, 누락 0).
    const ord = r => (FLOW_TIER_ORDER[r && r.tier] !== undefined ? FLOW_TIER_ORDER[r.tier] : 99);
    g.slice().sort((a, b) => ord(a) - ord(b)).forEach(r => out.push(r));
  });
  return out;
}

// ── 답변 인용 기반 근거 카드 폴백 — B11(2026-08-17 실기기 실측) ──────────────────
// 화면의 근거 목록은 위키 페이지의 `## 근거 조문` 표에서**만** 만들어진다. 그래서 그 표가 없는
// 페이지가 최상위 근거가 되면 **근거 아코디언이 통째로 사라지고**, 연쇄로 본문 조문 팝업(링크를
// 근거 줄의 법 정보로 건다)·시행일자 표기까지 함께 사라진다.
//   실측(2026-08-17, 사용자 실기기): "풍랑주의보여도 도선이 운항 가능한 조건" 질문에 답변은
//   「유선 및 도선 사업법 시행규칙」 제7조·별표1, 같은 법 시행령 제9조제1항·별표2를 정확히
//   인용했는데, 최상위 근거가 `wiki/statutes/유선및도선사업법.md`였고 **statutes 74개 파일 전부에
//   `## 근거 조문` 표가 없어** 근거가 0줄이 됐다.
// 아래 두 함수는 그 구멍을 **데이터가 아니라 코드로** 막는다 — 답변 문장이 법령명과 함께 밝힌
// 조문을 뽑아, 라우터가 원문(article_text.loadArticle)으로 **실재를 확인한 것만** 카드로 보탠다.
// ★환각 0: 여기서는 카드를 만들지 않는다 — "답변에 이런 표기가 있다"는 후보만 돌려준다. 원문
//   확인은 routes/legal.js synthesizeChainRows 가 하고, 확인에 실패하면 카드 자체가 안 생긴다.
//   (지어낸 근거가 화면에 뜨는 것이 근거가 안 뜨는 것보다 훨씬 나쁘다.)

// 답변 본문의 법령명 표기(`「어선법 시행규칙」`). 답변 원칙 7이 "법령명은 정식 명칭 그대로"를
// 지시하고 화면의 본문 조문 링크(B9)도 이 표기를 기준으로 법을 특정한다 — 같은 표기만 본다.
const ANSWER_LAW_RE = /[「『]([^」』\n]{2,60})[」』]/g;
// 그 법령명 **바로 뒤에** 이어 붙은 조문·별표 표기. 앞의 이음말(및·와·과·가운뎃점·쉼표)까지만
// 건너뛰고, 다른 글자가 하나라도 끼면 멈춘다 — "「A법」에 따라 … 제3조" 처럼 떨어져 있는 조문은
// 그 법의 것이라고 단정할 수 없으므로 아예 뽑지 않는다(느슨하게 잡느니 놓친다).
// ★sticky(y) — 자르지 않고 위치만 옮겨 대조한다(슬라이스로 자르면 `제58조 제5항 제7호`가 중간에서
//   끊겨 항·호를 잃는다).
const ANSWER_CITE_RE = /\s*(?:및|와|과|[·ㆍ・,])?\s*(제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*(?:제\s*\d+\s*항|[①-⑳]))?(?:\s*제\s*\d+\s*호(?:\s*의\s*\d+)?)?|별표\s*\d+(?:\s*의\s*\d+)?)/y;
// 한 법령명 뒤에 이어 읽는 표기 수 상한(`제7조·별표1·별표2·…`가 끝없이 이어지는 것 방지).
const ANSWER_CITE_MAX_PER_LAW = 4;
// 보탤 후보 상한(원문 조회 1건 = GitHub 파일 읽기 1회 — 답변 대기시간이 늘지 않게 좁게 잡는다).
const SYNTH_CANDIDATE_MAX = 6;

/**
 * 인용사슬 줄과 답변 인용의 법 이름을 **같은 잣대의 열쇠**로 만든다.
 * ①법령 칸이 계층 낱말뿐이면(`시행규칙`) 그 줄이 실린 페이지의 법(baseLaw)으로 펴고 ②약칭이면
 * 정식명으로 바꾼 뒤(loadLawAliases — 모호한 약칭은 표에서 이미 빠져 있다) ③낫표·공백·가운뎃점을
 * 지운다. `시행령`·`시행규칙` 꼬리는 **남긴다** — 지우면 법률과 시행령이 같은 열쇠가 돼
 * "이미 있는 근거"로 잘못 판정된다.
 * 예: lawKeyOf('시행규칙', '어선법') → '어선법시행규칙'
 *     lawKeyOf('「유선 및 도선 사업법 시행규칙」') → '유선및도선사업법시행규칙'
 * @param {string} law - 근거 조문 표의 법령 칸 또는 답변이 쓴 법령명
 * @param {string} [baseLaw] - 그 줄이 실려 있던 위키 페이지의 법
 * @returns {string} 판정할 수 없으면 ''
 * [연계] ← missingAnswerCitations(위키 줄과 답변 인용을 맞대보는 열쇠).
 */
function lawKeyOf(law, baseLaw) {
  let s = String(law || '').replace(/[「」『』]/g, '').trim();
  if (!s) return '';
  const bare = /^(시행령|시행규칙)$/.exec(s.replace(/\s+/g, ''));
  if (bare) {
    const b = String(baseLaw || '').trim();
    if (!b) return '';
    s = b + ' ' + bare[1];
  }
  const alias = loadLawAliases().alias;
  if (alias.has(s)) s = alias.get(s);
  else {
    const m = /^(.+?)\s*(시행령|시행규칙)$/.exec(s);
    if (m && alias.has(m[1])) s = alias.get(m[1]) + ' ' + m[2];
  }
  return s.replace(/[\s·ㆍ・,]/g, '');
}

/**
 * 답변이 쓴 법령명을 **우리가 원문을 가진 법**으로 특정한다. 약칭이면 정식명으로 바꾸고,
 * `시행령`·`시행규칙` 꼬리는 그대로 둔 채 모법으로 raw 폴더가 있는지 확인한다.
 * ★모호하면 버린다: 약칭표에 없고 `law_raw_paths.json`에도 없는 이름은 아무것도 돌려주지 않는다
 *   (모호한 약칭은 loadLawAliases 가 이미 표에서 빼 둔다 — 같은 약칭이 두 법에 걸리는 경우 등).
 * ⚠ 고시·훈령(「어선원 안전ㆍ보건 및 재해예방 기준」 등)은 여기서 항상 null 이다 — 행정규칙은
 *   law_raw_paths.json 에 없고, 어느 법 폴더의 고시인지는 답변 문장만으로 단정할 수 없다.
 *   위키 표가 있는 경로에서는 종전대로 나오므로 잃는 것은 "표가 없는 페이지의 고시 카드"뿐이다.
 * 예: resolveAnswerLaw('유선 및 도선 사업법 시행규칙') → {law:'유선 및 도선 사업법 시행규칙', baseLaw:'유선 및 도선 사업법'}
 *     resolveAnswerLaw('어선안전조업법')  → {law:'<정식명>', baseLaw:'<정식명>'}(약칭표에 있을 때)
 *     resolveAnswerLaw('없는법')          → null
 * @param {string} raw - 답변의 「」 안 문자열
 * @returns {{law:string, baseLaw:string}|null}
 * [연계] ← extractAnswerCitations. → routes/legal.js 가 그대로 article_text.loadArticle 에 넘긴다.
 */
function resolveAnswerLaw(raw) {
  const name = String(raw || '').trim();
  if (name.length < 2) return null;
  const alias = loadLawAliases().alias;
  let formal = alias.get(name) || '';
  if (!formal) {
    const m = /^(.+?)\s*(시행령|시행규칙)$/.exec(name);
    if (m && alias.has(m[1])) formal = alias.get(m[1]) + ' ' + m[2];
  }
  if (!formal) formal = name;
  const m2 = /^(.+?)\s*(시행령|시행규칙)$/.exec(formal);
  const base = (m2 ? m2[1] : formal).trim();
  if (!base || !rawPathOf(base)) return null;   // 우리가 원문을 가진 법이 아니다 — 단정하지 않는다
  return { law: formal, baseLaw: base };
}

/**
 * 답변 문장에서 `「법령명」 제N조…`·`「법령명」 별표N` 인용을 **문자 그대로** 뽑는다.
 * ★환각 0: 조·항·호를 조립하지 않는다 — 답변에 있는 글자를 그대로 잘라 `article`에 담는다
 *   (`제58조 제5항 제7호`처럼 띄어쓴 표기도 그 모양 그대로).
 * 예: extractAnswerCitations('「유선 및 도선 사업법 시행규칙」 제7조 및 별표 1에 따라 …')
 *     → [{law:'유선 및 도선 사업법 시행규칙', baseLaw:'유선 및 도선 사업법', tier:'rule', article:'제7조'},
 *        {… article:'별표 1'}]
 * @param {string} answerText - 답변 전체 문장
 * @returns {Array<{law:string, baseLaw:string, tier:string, article:string}>} 등장 순서(중복 제거)
 * [연계] ← missingAnswerCitations. tier 는 classifyTier 재사용(`…기준` 고시 보정 포함).
 */
function extractAnswerCitations(answerText) {
  const text = String(answerText || '');
  const out = [];
  const seen = new Set();
  ANSWER_LAW_RE.lastIndex = 0;
  let m;
  while ((m = ANSWER_LAW_RE.exec(text)) !== null) {
    const law = resolveAnswerLaw(m[1]);
    if (!law) continue;
    let pos = m.index + m[0].length;
    for (let n = 0; n < ANSWER_CITE_MAX_PER_LAW; n++) {
      ANSWER_CITE_RE.lastIndex = pos;
      const cm = ANSWER_CITE_RE.exec(text);
      if (!cm) break;
      pos = ANSWER_CITE_RE.lastIndex;
      const article = cm[1].trim();
      const key = lawKeyOf(law.law) + '|' + article.replace(/\s+/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ law: law.law, baseLaw: law.baseLaw, tier: classifyTier(law.law), article });
    }
  }
  return out;
}

/**
 * 인용사슬 줄이 **이미 가리키고 있는** (법, 조/별표)를 열쇠 집합으로 만든다.
 * 조 단위로 본다 — 위키 줄이 `제9조`이고 답변이 `제9조제1항`이면 같은 조라 이미 있는 근거다.
 * 묶음(`제52~55·57조`)·범위(`제1~9조`) 표기는 풀어서 그 안의 조를 전부 담는다.
 * @param {Array} rows - mergeCitationChains 를 지난 줄들(baseLaw 포함)
 * @returns {Set<string>} `<법열쇠>|제N조` · `<법열쇠>|별표N`
 * [연계] ← missingAnswerCitations.
 */
function chainCoverKeys(rows) {
  const set = new Set();
  for (const r of rows || []) {
    const k = lawKeyOf(r && r.law, r && r.baseLaw);
    if (!k) continue;
    const article = String((r && r.article) || '');
    const both = article + ' ' + String((r && r.citedArticle) || '');
    const jos = expandJoEnum(article) || [];
    (both.match(/제\s*\d+\s*조(?:\s*의\s*\d+)?/g) || []).forEach(t => jos.push(t.replace(/\s+/g, '')));
    const rg = /제\s*(\d+)\s*[~∼～]\s*(\d+)\s*조/.exec(both);
    if (rg) { for (let n = parseInt(rg[1], 10); n <= parseInt(rg[2], 10); n++) jos.push('제' + n + '조'); }
    jos.forEach(j => set.add(k + '|' + j));
    (both.match(/별표\s*\d+(?:\s*의\s*\d+)?/g) || []).forEach(t => set.add(k + '|' + t.replace(/\s+/g, '')));
  }
  return set;
}

/**
 * 답변이 인용했는데 **인용사슬 목록에는 없는** (법, 조/별표)만 골라낸다(카드로 보탤 후보).
 * 목록이 비어 있으면(위키에 `## 근거 조문` 표가 없는 페이지가 근거인 경우) 뽑힌 인용이 전부 후보다.
 * 예: missingAnswerCitations('「유선 및 도선 사업법 시행규칙」 제7조 …', [])
 *     → [{law:'유선 및 도선 사업법 시행규칙', article:'제7조', tier:'rule', baseLaw:'유선 및 도선 사업법'}]
 * @param {string} answerText - 답변 전체 문장
 * @param {Array} rows - mergeCitationChains 를 지난 위키 기반 줄들
 * @returns {Array} 후보(최대 SYNTH_CANDIDATE_MAX 건, 답변 등장 순서)
 * [연계] → routes/legal.js synthesizeChainRows(원문 실재 확인 후에야 카드가 된다).
 */
function missingAnswerCitations(answerText, rows) {
  const covered = chainCoverKeys(rows);
  const out = [];
  for (const c of extractAnswerCitations(answerText)) {
    const flat = c.article.replace(/\s+/g, '');
    const jo = /^제\d+조(?:의\d+)?/.exec(flat);
    const key = lawKeyOf(c.law) + '|' + (jo ? jo[0] : flat);
    if (covered.has(key)) continue;
    covered.add(key);                       // 후보끼리도 같은 조를 두 번 담지 않는다
    out.push(c);
    if (out.length >= SYNTH_CANDIDATE_MAX) break;
  }
  return out;
}

/**
 * 그 자료에 **실제로 실린 법령 이름들**을 자료의 `## 근거 조문` 표에서 뽑는다(대표 법령이 맨 앞).
 * 프롬프트 머리에 "이 자료에는 이런 법령들이 섞여 있다"고 알려 주려는 것이다 — 모델이 조문번호만
 * 적힌 자리를 대표 법령 것으로 단정해 엉뚱한 출처를 붙이는 것을 막는다.
 * ⚠표가 발췌에 안 실렸거나 법령이 한 종류뿐이면 빈 배열/한 개를 돌려준다(호출부가 안내를 생략한다).
 * 예: pageLawNames('… ## 근거 조문 | 해운법 | 제15조 … | 「내항해운에관한업무지침」 | 제9~15조 …', '해운법')
 *     → ['해운법', '「내항해운에관한업무지침」']
 * @param {string} body - 프롬프트에 실릴 자료 본문(이미 잘린 상태)
 * @param {string} pageLaw - 그 자료의 대표 법령
 * @returns {string[]} 중복 없는 법령 이름(최대 8개 — 머리가 길어지지 않게)
 * [연계] ← buildContextBlock. → extractCitationChain(같은 표 파서를 쓴다).
 */
function pageLawNames(body, pageLaw) {
  const out = [];
  const add = v => {
    const t = String(v || '').trim();
    if (t && t !== '—' && t !== '-' && !out.includes(t) && out.length < 8) out.push(t);
  };
  add(pageLaw);
  for (const r of extractCitationChain(body)) add(r.law);
  return out;
}

/** contextPages를 프롬프트용 [근거자료] 블록 문자열로 직렬화. */
function buildContextBlock(contextPages) {
  return contextPages.map((cp, i) => {
    // ★2026-08-18(사용자 지적): 예전 머리는 `[수산업법 — 허가어업]` 이었고, 모델이 그걸 통째로
    //   베껴 답변에 `[수산업법 — 허가어업]의 "★ 정의부터" 표`처럼 적었다. 그건 **우리가 자료를
    //   정리하려고 붙인 이름**이라 사용자에게 뜻이 통하지 않고 눌러볼 수도 없다.
    //   규칙12로 금지하는 것과 별개로, **베끼기 쉬운 자리에 놓인 글자 자체를 바꾼다** — 법령명은
    //   답변에 그대로 써도 되는 「낫표」 형태로 두고, 주제는 인용처럼 보이지 않는 설명문으로 돌린다.
    const meta = `상태:${cp.status || '(법령원문)'} · 기준일:${cp.frontmatter.updated || cp.frontmatter.시행일 || '미상'}` +
      (cp.hop ? ' · (관련개념 보강)' : '');
    const about = cp.topic ? `이 자료가 다루는 것: ${cp.topic} · ` : '';
    // ★2026-08-18(라이브 검증 실측): 머리에 법령명을 하나만 달아 두니 모델이 **자료 안의 모든
    //   조문을 그 법 것으로** 읽었다. 위키 본문은 `(제14조②)` 처럼 조문번호만 적는 자리가 흔한데,
    //   그게 실제로는 고시·지침의 조문인 경우가 있다 — 「내항해운에관한업무지침」 제14조②(운항결손액
    //   8항목)를 모델이 「해운법 시행규칙」 제14조제2항이라고 적었고(그 조문엔 제2항 자체가 없다),
    //   화면은 그 표기를 눌러 **엉뚱한 원문**을 여는 자리로 바꾼다. 그래서 그 자료에 실제로 실린
    //   법령 목록을 **자료에서 뽑아** 함께 알려 준다(우리가 지어내는 정보가 아니라 표에 적힌 그대로다).
    const laws = pageLawNames(cp.body, cp.law);
    const also = laws.length > 1
      ? `\n※ 이 자료에는 다음 법령의 조문이 함께 실려 있다 — ${laws.join(' / ')}. `
        + `조문번호만 적힌 자리를 대표 법령(${cp.law}) 것으로 단정하지 마라.`
      : '';
    return `--- 근거${i + 1}: 「${cp.law}」 관련 자료 (${about}${meta}) ---${also}\n${cp.body}`;
  }).join('\n\n');
}

// 답변 원칙 1~9는 1차(위키 근거)·2차(원문 미검증 참고) 답변이 똑같이 지켜야 하는 공통 규칙이라
// 별도 상수로 떼어 두 프롬프트가 함께 쓴다(서두 한 문장만 근거의 성격에 따라 달라진다).
// ⚠ 규칙7(각주 생략)이 기대는 "화면이 대신 보여준다"의 실제 범위는 이렇다(ai_chat.js answerHTML 실측):
//   · 근거 법령 목록은 **접힌 아코디언**이라 사용자가 눌러야 보인다(답변 밑에 펼쳐져 있지 않다).
//   · 그 안에는 **답변이 실제로 인용한 조문 줄만** 뜬다(소스 여러 곳의 줄을 합친 하나의 목록 —
//     routes/legal.js mergeCitationChains). 이름만 있는 소스 카드는 정보가 없어 그리지 않는다.
//   그래서 규칙7은 "완전히 중복되니 빼라"가 아니라 "본문에서 법령·조문은 밝히되 소관부서·연락처·기준일
//   각주만 생략한다"는 뜻이다 — 각주를 되살릴지는 화면 UX와 함께 판단할 일이지 이 주석이 단정할 게 아니다.
// ★규칙1(범위 준수) 신설(2026-08-16, A/B 실측 근거): 실제 위키 페이지(절이 20개 이상인 허브성 concept
//   3종)에서 뽑은 질문 6개로 baseline vs 이 규칙 추가본을 Gemini에 직접 비교했다. baseline은 6건 중
//   1건("선박 개조했는데 임시검사 받아야 하나요")에서 안 물어본 "위반 시 처벌(과태료)" 절까지 답변에
//   끌고 왔고, 이 규칙(질문 범위를 맨 앞에서 못박기)을 추가하니 그 누출이 사라졌다(추가 AI 호출 없이,
//   프롬프트만으로 해소 — 후처리 재검토안도 같은 결함을 잡았으나 정상적인 규칙3 마무리 문구까지
//   같이 잘라내는 부작용이 있어 채택 안 함). 나머지 5문항은 baseline도 이미 범위 안이었다.
// ★규칙7에 "정식 명칭 그대로" 한 문장 추가(2026-08-17, B9): 화면이 답변 본문의 조문에 링크를 걸려면
//   그 조문이 **어느 법의 것인지**를 문장에서 특정할 수 있어야 하는데, 모델이 「어선안전조업법」처럼
//   약칭으로 쓰면 위키·index.json 의 정식 명칭과 문자열이 안 맞아 법을 못 고른다. 기존 규칙 번호·문장은
//   그대로 두고 한 문장만 끼워 넣었다(이 프롬프트는 A/B 실측으로 다듬은 것이라 재작성하지 않는다).
const ANSWER_RULES_BODY = `[답변 원칙 — 반드시 지킬 것]
1. ★질문한 것만 답한다. 사용자가 구체적으로 하나의 조건·위반유형·절차를 물었으면, [근거자료]에 다른 조건·다른 위반유형·다른 절차·다른 검사종류·다른 처벌조문이 나란히 있어도 언급하지 않는다. "참고로 알려드리면"·"추가로"처럼 요청받지 않은 정보를 덧붙이지 않는다.
2. 답의 근거는 오직 [근거자료]뿐이다. [근거자료]에 없는 내용은 지어내지 말고 "확인되지 않습니다"라고 정직하게 말한다.
3. 처벌(징역·벌금·과태료)은 조·항·호·금액을 [근거자료] 그대로 인용한다. 뭉개어 말하지 않는다. ★**[근거자료]에 1차·2차·3차 같은 위반 횟수별 구간이 실제로 적혀 있을 때에만** 가장 흔한 경우(통상 1차)만 먼저 답하고 "2차 이후도 궁금하시면 다시 물어보세요"로 마무리한다(한 번에 전부 나열하지 않는다). **횟수 구분이 근거자료에 없으면(징역·벌금처럼 형벌 하나로 끝나는 조문) 그 마무리 문구를 절대 붙이지 마라** — 없는 단계가 있는 것처럼 오해하게 만든다.
4. 여기서는 사용자에게 되묻지 않는다 — 되물어야 하는 질문은 이 답변 **앞 단계(되묻기 판단)** 에서 이미 걸러진다. 조건(선박 톤수·어업 종류·조업구역 등)이 질문에 없어도 되묻지 말고 [근거자료]에 있는 정보로 최선을 다해 답하되, 조건에 따라 갈리면 핵심 갈래만 짧게 구분해 밝힌다(모든 경우를 장황하게 전수 나열하지 않는다).
5. 판례·법리 해석·다툼의 여지가 있는 논점은 답하지 않는다(스코프 밖). 명확한 조문까지만 안내하고 "이 부분은 개별 사안에 따라 달라져 관할 소관부서에 확인하시는 것이 정확합니다"로 마무리한다.
6. 딱딱한 조문 나열 금지. 결론 먼저 → 필요한 근거. **본문 첫 문장을 "쉽게 말하면 ~"으로 열어** 결론을 일상어로 짧게 요약한 뒤, 조문·처벌 같은 정확한 근거를 그다음에 이어 붙인다 — 이 쉬운 요약을 답변 맨 끝에 마무리 말로 붙이지 않는다. 과잉 설명은 하지 않는다.
7. 근거로 삼은 법령명·조문번호는 답변 문장 안에서 자연스럽게 밝힌다(예: "「낚시 관리 및 육성법」 제35조에 따라 …"). 법령명은 **정식 명칭 그대로** 쓴다(약칭·줄임말로 쓰지 않는다). ★**"같은 법"·"동법"·"같은 조"·"이 법" 같은 가리키는 말은 쓰지 마라 — 조문번호를 쓸 때마다 「정식 법령명」을 앞에 다시 붙인다.** 시행령·시행규칙도 마찬가지로 「낚시 관리 및 육성법 시행령」처럼 괄호낫표 안에 계층까지 넣어 통째로 쓴다(「낚시 관리 및 육성법」 시행령 제16조처럼 낫표 밖에 계층을 떼어 놓지 마라). 문장이 길어져도 이렇게 쓴다 — 화면이 이 표기를 눌러 원문을 여는 자리로 바꾸는데, 가리키는 말로 쓰면 어느 법인지 확정하지 못해 그 근거는 사용자가 확인할 수 없게 된다. ★**법령명과 조문번호를 붙여 쓴 이 표기가 사용자가 원문을 열어볼 수 있는 유일한 통로다**(화면이 그 자리를 눌러 원문 팝업으로 잇는다) — 2026-08-18 이전에는 답변 아래에 "근거 법령" 목록이 따로 붙었지만 지금은 없앴다. 그러니 법령명만 쓰고 조문번호를 빼거나, 조문번호만 쓰고 법령명을 빼면 **그 근거는 사용자가 확인할 길이 사라진다.** 다만 소관부서·연락처·근거자료의 기준일을 답변 마지막에 각주로 따로 붙이지는 않는다(화면이 답변 끝에 따로 붙인다). ("참고용입니다" 면책 문구도 화면이 별도로 붙이니 답변에 넣지 않는다.)
8. 표·이모지는 쓰지 않는다. 강조는 **굵게**만 사용. 갈래·조건별로 나뉘는 설명은 "*" 같은 밋밋한 기호 하나로 뭉뚱그리지 말고, 단계(갈래→항목→세부조건)에 따라 "1. → 가. → 1)" 순서로 번호를 매겨 위계를 드러낸다(더 깊어지면 "가)→(1)→(가)" 순으로 이어간다). 예: "1. 바다에서 조종한 경우" 아래 "가. 형벌" 아래 "1) 총톤수 5톤 이상 선박은…".
9. 처벌·의무의 대상이 [근거자료]에 여러 주체(예: 위반한 본인 + 별도 책임 있는 선장·사업자·안전관리자 등)로 나뉘어 규정돼 있으면, 그중 하나만 말하고 끝내지 말고 **해당하는 관련 주체를 전부** 빠짐없이 언급한다.
10. 시행령·시행규칙의 세부 요건·항목을 조문번호와 함께 나열하기 전에, 그 요건들을 위임한 **모법(법률) 조문번호도 답변 어딘가에서 반드시 한 번 밝힌다**(예: "「낚시 관리 및 육성법」 제25조에 따라 신고해야 하며, 신고요건은 「낚시 관리 및 육성법 시행령」 제16조에서…"). 세부 요건만 나열하고 그 뿌리가 되는 법 조문 자체를 안 밝히면 안 된다.
11. ★**근거는 "묶음 단위"로 한 번만 적는다.** "1. 신고요건 / 2. 신고 절차"처럼 묶어서 답할 때는, **그 묶음 전체를 덮는 조문 하나를 묶음 제목 옆에 적고, 묶음 안의 항목에는 조문을 적지 마라.**
    - 올바른 예: "**1. 신고요건**(「낚시 관리 및 육성법 시행령」 제16조제1항)" 아래에 "1. 어업허가를 받은 총톤수 10톤 미만의 동력어선 / 2. 선령이 …" — 각 항목에는 제1호·제2호를 **붙이지 않는다.**
    - 잘못된 예: 항목마다 "…(「낚시 관리 및 육성법 시행령」 제16조제1항제1호)", "…(제2호)"를 반복하는 것. 화면이 그 조문 표기를 전부 눌러볼 수 있는 링크로 바꾸므로, 같은 조항을 가리키는 링크가 예닐곱 개씩 늘어서기만 하고 새로 알려주는 것이 없다. 묶음 제목의 링크 하나를 누르면 그 조문 전체(각 호가 다 들어 있다)가 열린다.
    - **예외는 하나뿐이다**: 어떤 항목이 그 묶음의 조문이 아니라 **다른 법·다른 조**에서 나왔으면, 그 항목에만 따로 적는다(그건 새로 알려주는 정보다).
    - 묶지 않고 문장으로 풀어 쓸 때는 종전대로 그 문장에 근거를 적는다. 근거 자체를 빼먹으면 안 된다(빼먹으면 사용자가 원문을 확인할 길이 없다).
    - 묶음 전체를 덮는 조문이 근거자료에서 확정되지 않으면 **지어내지 말고** 확인되는 범위(조 또는 항)까지만 적는다.
    - ★**"근거:" 같은 각주 줄을 따로 만들지 마라.** 문단 끝에 "* 근거: 「수산업법」 제40조제1항, 「수산업법」 제44조 …"처럼 조문을 다시 모아 적으면, 바로 위 문장에서 이미 밝힌 것을 한 번 더 늘어놓는 것일 뿐이다. 조문은 **그것을 설명하는 문장 안**이나 **묶음 제목 옆**, 둘 중 한 자리에만 적는다.
12. ★**[근거자료]의 문서 이름·표 제목·절 제목을 답변에 쓰지 마라.** 근거자료 머리에 붙은 "[수산업법 — 허가어업]" 같은 이름이나 그 안의 "★ 정의부터"·"근해어업 조업구역·허가정수"·"⑤ 허가조건" 같은 소제목은 **우리가 자료를 정리하려고 붙인 이름**이지 법령에 있는 말이 아니다. 사용자에게는 뜻이 통하지 않고, 눌러서 찾아볼 수도 없다. 출처를 밝힐 때는 **법령명과 조문번호(필요하면 별표·별지 번호)로만** 적는다.
13. ★**표(별표·별지 포함)에서 답이 나오면, 그 표에서 질문에 해당하는 칸의 값을 그대로 말한다.** "「…」 별표 4를 참고하세요"로 넘기지 마라 — 사용자가 궁금한 것은 표 전체가 아니라 **자기 경우에 해당하는 한 줄**이다.
    - 예: "선망어선의 조업구역"을 물으면 그 표에서 그 어업 종류의 행을 찾아 "전국 근해"라고 **값을 그대로** 적는다(어느 별표인지는 규칙11대로 한 번만 밝힌다).
    - 조건에 따라 값이 갈리면(톤수·해역·시기 등) **질문에 해당하는 갈래만** 답한다(규칙1과 같은 취지).
    - 근거자료의 표에서 그 칸을 못 찾으면 **지어내지 말고** "그 표에서는 확인되지 않습니다"라고 정직하게 말한다. 정말로 표 전체를 봐야 하는 경우에만 그 별표를 가리킨다(화면이 원본 표 이미지를 보여준다).
14. ★**조문번호만 적힌 자리를 자료 대표 법령 것으로 단정하지 마라.** [근거자료]의 머리에 「○○법」이 적혀 있어도, 그 자료 안에는 시행령·시행규칙·고시·지침·조례의 조문이 **함께** 실려 있다(머리의 "※ 이 자료에는 다음 법령의 조문이 함께 실려 있다" 줄을 보라). 본문이 "(제14조②)" 처럼 번호만 적어 둔 자리는, 그 절의 제목이나 바로 위 문장, 또는 '근거 조문' 표에서 **어느 법령의 조문인지 확인한 뒤** 그 법령명을 붙여 쓴다.
    - 확인이 안 되면 **그 조문번호를 쓰지 마라.** 법령명까지만 밝히거나(예: "「내항해운에관한업무지침」에 따르면"), 확실한 상위 위임 조문만 밝힌다.
    - 틀린 조문번호는 빈칸보다 나쁘다 — 화면이 그 표기를 눌러 원문을 여는 자리로 바꾸므로, 사용자는 **엉뚱한 법의 엉뚱한 조문**을 근거로 믿게 된다(실측: 「내항해운에관한업무지침」 제14조②의 비용 8항목이 「해운법 시행규칙」 제14조제2항으로 인용됐는데, 그 조문에는 제2항 자체가 없다).`;

const ANSWER_RULES = `너는 "나리야" — 대한민국 해양수산 법령을 안내하는 AI 챗봇이다. 아래 [근거자료]는 검증 절차를 거친 법령 위키에서 그대로 발췌한 원문이다.

${ANSWER_RULES_BODY}`;

// 'MINIMAL'은 gemini-pro-latest(3.x)에서 400(지원 안 함)으로 실측 확인(2026-07-29) — 절대 쓰지 말 것.
// pro-latest 확정: LOW+규칙9(6회 반복 26초 평균·완전성 6/6)이 속도·완전성 균형점.
// 2026-07-30 실측 발견: gemini-2.5-flash는 'thinkingLevel' 필드 자체가 400("Thinking level is
// not supported for this model")으로 아예 미지원 — 2.5 계열은 thinkingBudget(정수, -1=dynamic)
// 방식만 받는다. 모델별로 지원 필드가 달라 분기 처리.
const SYNTH_CONFIG = ANSWER_MODEL.startsWith('gemini-2.5')
  ? { temperature: 0.3, thinkingConfig: { thinkingBudget: -1 } }
  : { temperature: 0.3, thinkingConfig: { thinkingLevel: 'LOW' } };

// ── 대화 기억(2026-08-18 사용자 확정) ─────────────────────────────────────────────
// "🔁 관련해서 더 궁금해요"로 이어 물을 때 앱이 실어 보내는 직전까지의 대화([{q,a}, …]).
// ⚠**질의 문자열에 절대 합치지 않는다**(§2.1 R2) — 되묻기 판단·답변 합성에 참고 자료로만 간다.
// ⚠**어떤 파일에도 쓰지 않는다**(§3.3 R1) — ctx·profile 과 같은 규약.
const HISTORY_MAX_TURNS = 12;        // 앱이 이미 줄여 보내지만 서버도 제 상한을 갖는다
const HISTORY_MAX_CHARS = 12000;     // 앱 상한(8,000자)보다 넉넉히 — 넘치면 오래된 턴부터 버린다

/**
 * 앱이 보낸 대화 기억을 **믿지 않고** 우리 규격으로 다시 만든다(길이·개수·자료형 모두 강제).
 * 예: normalizeHistory([{q:'신고 요건?', a:'쉽게 말하면…'}]) → [{q:'신고 요건?', a:'쉽게 말하면…'}]
 * @param {*} raw - 요청 본문의 history(무엇이 와도 안전해야 한다)
 * @returns {Array<{q:string,a:string}>} 쓸 것이 없으면 빈 배열
 * [연계] ← routes/legal.js POST /api/legal/ask. → historyBlock().
 */
function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw.slice(-HISTORY_MAX_TURNS)) {
    if (!t || typeof t !== 'object') continue;
    const q = String(t.q || '').trim();
    const a = String(t.a || '').trim();
    if (!q || !a) continue;
    out.push({ q: q.slice(0, 500), a: a.slice(0, 4000) });
  }
  // 총량 상한 — 넘치면 **오래된 턴부터** 버린다(가까운 대화가 지금 질문에 더 가깝다).
  let total = out.reduce((n, t) => n + t.q.length + t.a.length, 0);
  while (out.length > 1 && total > HISTORY_MAX_CHARS) {
    const drop = out.shift();
    total -= drop.q.length + drop.a.length;
  }
  return out;
}

/**
 * 대화 기억을 프롬프트에 끼울 블록으로 만든다. 비어 있으면 **빈 문자열**이라 프롬프트가
 * 오늘과 바이트 동일하다(R0 — 이어 묻지 않는 질문은 아무것도 달라지지 않는다).
 * 예: historyBlock([{q:'신고 요건?',a:'쉽게 말하면…'}])
 *     → '\n\n[방금까지 나눈 대화]\n(1) 사용자: 신고 요건?\n    나리야: 쉽게 말하면…\n…'
 * @param {Array<{q:string,a:string}>} turns
 * @returns {string}
 * [연계] ← synthesizeAnswerStream · decideClarify.
 */
function historyBlock(turns) {
  if (!turns || !turns.length) return '';
  const lines = turns.map((t, i) => `(${i + 1}) 사용자: ${t.q}\n    나리야: ${t.a}`).join('\n\n');
  return `\n\n[방금까지 나눈 대화]\n${lines}\n` +
    `- 사용자는 위 대화에 **이어서** 지금 질문을 하고 있다. 지시어("그거"·"그럼"·"안 하면")가 가리키는 것과, ` +
    `말하지 않고 넘어간 조건(업종·상황 등)은 위 대화를 따른다.\n` +
    `- 위 대화에서 **이미 답한 것을 다시 설명하지 마라.** 지금 질문에만 답한다.\n` +
    `- ⚠위 대화는 흐름을 잡는 참고일 뿐이다. **답의 근거는 여전히 [근거자료]뿐**이고, 위 대화에 적힌 ` +
    `조문·숫자를 근거로 다시 쓰지 마라(그때 쓴 근거가 지금 질문에도 맞는지는 [근거자료]로 확인해야 한다).`;
}

/**
 * Gemini로 실제 답변 문장을 스트리밍으로 합성한다(체감 대기시간 단축 — 실제 생성시간은
 * 그대로지만 화면엔 조각조각 바로 뜬다). 근거 페이지가 없거나 키가 없으면 아무것도
 * yield하지 않고 바로 끝난다(호출부가 "근거없음"·"키없음"으로 구분해 처리).
 * @param {string} query
 * @param {Array} contextPages - search()의 contextPages
 * @yields {string} 답변 텍스트 조각(delta)
 */
async function* synthesizeAnswerStream(query, contextPages, history) {
  if (!contextPages.length) return;
  if (!gemini.hasAnyKey()) throw new Error('GEMINI_API_KEY 미설정');
  const prompt = `${ANSWER_RULES}\n\n[근거자료]\n${buildContextBlock(contextPages)}${historyBlock(history)}\n\n질문: "${query}"\n답:`;
  yield* gemini.callGeminiStream({ model: ANSWER_MODEL, contents: prompt, config: SYNTH_CONFIG, caller: 'Legal-Ask' });
}

// ============================================================================
// 2차 조회 — "미검증 참고" 답변 (MASTER_PLAN F절 ★★위키 밖 질문 2단계 답변 체계)
// 1차(위키 카드)에서 근거를 하나도 못 찾았을 때만 발동한다. 좁혀진 법의 raw 원문을
// GitHub에서 그때그때 읽어(서버에 상주시키지 않음) 답을 한 번 더 시도하되, 사람이 검증한
// 위키 카드가 아니라는 사실을 답변 안에 명시하게 한다.
//   ①동시조회(법률.txt + 폴더 목차) → ②AI 파일선택 → ③병렬조회 → ④AI 답변합성
// 어느 단계가 실패하든(토큰없음·GitHub실패·AI실패·후보없음) 예외 없이 "결과 없음"을 반환한다.
// ============================================================================

const RAW_LAW_MAX = 2;        // 후보 법 상한(MASTER_PLAN "가장 가까운 법 1~2개")
const RAW_FILE_MAX = 4;       // ②AI가 지목할 수 있는 추가 파일 상한(프롬프트·지연 관리)
// 원문 파일은 위키 카드와 달리 통째로 길다(핵심 73법 중 법률.txt 최대 ≈257KB — 해양환경관리법).
// 프롬프트 비용·지연이 폭주하지 않게 파일당 상한만 둔다(잘라도 앞부분에 목적·정의·주요 의무가 온다).
const RAW_MAX_CHARS = 50000;

// ── law_raw_paths.json 캐시(mtime 감지): 법명(공백 제거) → raw 폴더 상대경로 ──
// index.json의 law는 "공유수면 관리 및 매립에 관한 법률"처럼 띄어쓰기가 있고 매핑표 키는
// 붙여쓰기("공유수면관리및매립에관한법률")라, 공백을 지운 형태를 키로 삼아야 74법 전부 맞는다(실측 확인).
let _rawPathsCache = null, _rawPathsMtime = 0;
function loadRawPaths() {
  try {
    const mt = fs.statSync(LAW_RAW_PATHS_JSON).mtimeMs;
    if (_rawPathsCache && mt === _rawPathsMtime) return _rawPathsCache;
    const obj = JSON.parse(fs.readFileSync(LAW_RAW_PATHS_JSON, 'utf8'));
    const map = new Map();
    for (const k of Object.keys(obj)) map.set(k.replace(/\s+/g, ''), obj[k]);
    _rawPathsCache = map; _rawPathsMtime = mt;
  } catch (_) { if (!_rawPathsCache) _rawPathsCache = new Map(); }
  return _rawPathsCache;
}

/**
 * 법명으로 그 법의 raw 폴더 경로(저장소 루트 기준 상대경로)를 찾는다. 없으면 null.
 * 예: rawPathOf('어선법') → 'local_server/knowledge/legal/raw/04_선박해운/어선법'
 * @param {string} lawName
 * @returns {string|null}
 * [연계] → github_raw.listDir/fetchText에 그대로 넘기는 GitHub Contents API 경로.
 */
function rawPathOf(lawName) {
  return loadRawPaths().get(String(lawName || '').replace(/\s+/g, '')) || null;
}

/**
 * ①단계 앞: 질문과 가장 가까운 법을 AI에게 1~2개만 고르게 한다(판단 1회).
 * expandQueryTerms()와 같은 "짧고 빠른 판단 호출" 패턴 — 사고 끄고, JSON만 받고,
 * 실패(키 없음·타임아웃·파싱 실패)하면 조용히 []를 돌려 2차 조회 자체를 스킵시킨다.
 * 예: pickCandidateLaws('어선 길이 늘리려면 허가 받아야 하나요', ['어선법', …]) → ['어선법']
 * @param {string} query - 사용자 질문
 * @param {string[]} lawNames - 후보가 될 수 있는 법 목록(index.json statute 페이지의 law)
 * @returns {Promise<string[]>} 목록 안에 실제로 있는 법명만(최대 RAW_LAW_MAX), 실패 시 []
 * [연계] ← searchRawFallback() 1단계 → rawPathOf()로 raw 폴더 경로 변환.
 */
async function pickCandidateLaws(query, lawNames) {
  if (!gemini.hasAnyKey() || !lawNames.length) return [];
  const prompt = `아래는 대한민국 해양수산 법령 목록이다.\n${lawNames.join('\n')}\n\n` +
    `사용자 질문: "${query}"\n\n` +
    `이 질문에 답하려면 어떤 법의 원문을 읽어야 하는가? 위 목록에 있는 법명만 골라 ` +
    `가장 가까운 순서로 최대 ${RAW_LAW_MAX}개까지 JSON 배열로만 답하라. 관련 있는 법이 없으면 [] 로 답하라. ` +
    `예: ["어선법"]`;
  try {
    const result = await gemini.callGemini({
      model: ANSWER_MODEL, contents: prompt, config: QUERY_EXPAND_CONFIG, caller: 'Legal-RawLawPick',
    });
    if (!result.success || !result.text) return [];
    const m = result.text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    // 모델이 목록에 없는 법명을 지어낼 수 있어(환각) 실제 목록에 있는 것만 통과시킨다.
    const known = new Set(lawNames);
    return arr.filter(x => typeof x === 'string' && known.has(x.trim())).map(x => x.trim()).slice(0, RAW_LAW_MAX);
  } catch (_) {
    return [];
  }
}

/**
 * ①동시조회: 한 법의 `법률.txt` 본문 + 그 법 폴더의 파일 목차를 함께 받아온다.
 * 목차는 최상위 1단계 + 그 아래 하위폴더(행정규칙/·별표/·타법인용/) 1단계까지 본다 —
 * 고시 파일명이 보여야 ②단계가 "행정규칙/어선구조기준.txt"처럼 콕 집을 수 있기 때문이다.
 * 내용은 안 받고 **이름만** 받으므로 가볍다.
 * 예: loadLawBundle('어선법') → {law:'어선법', base:'…/어선법', lawText:'어선법\n[시행…', files:['시행령.txt','행정규칙/어선구조기준.txt', …]}
 * @param {string} law - 법명
 * @returns {Promise<{law:string,base:string,lawText:string,files:string[]}|null>} 법률.txt를 못 받으면 null
 * [연계] ← searchRawFallback() 2단계. → github_raw.listDir/fetchText.
 */
async function loadLawBundle(law) {
  const base = rawPathOf(law);
  if (!base) return null;
  const [lawText, top] = await Promise.all([
    githubRaw.fetchText(base + '/법률.txt'),
    githubRaw.listDir(base),
  ]);
  if (!lawText) return null;
  const isText = n => /\.(txt|md)$/i.test(n);
  const files = top.filter(e => e.type === 'file' && isText(e.name) && e.name !== '법률.txt').map(e => e.name);
  const dirs = top.filter(e => e.type === 'dir').map(e => e.name);
  const subs = await Promise.all(dirs.map(d => githubRaw.listDir(base + '/' + d)));
  dirs.forEach((d, i) => {
    for (const e of subs[i]) if (e.type === 'file' && isText(e.name)) files.push(d + '/' + e.name);
  });
  return { law, base, lawText, files };
}

// ②파일 선택 호출은 법률.txt 전문(최대 RAW_MAX_CHARS)까지 읽히므로 질의확장(10초)보다 여유가 필요하다.
// 사고는 켜지 않는다 — "목차에서 필요한 파일 고르기"는 판단이지 추론이 아니다.
const RAW_PICK_CONFIG = {
  temperature: 0.1,
  thinkingConfig: { thinkingBudget: 0 },
  responseMimeType: 'application/json',
  httpOptions: { timeout: 15000 },
};

/**
 * ②AI 판단(1회): 법률.txt 본문 + 폴더 목차를 보여주고, 답하는 데 더 필요한 파일만 고르게 한다.
 * 목차에 실제로 있는 파일명만 통과시켜(환각 경로 차단) 최대 RAW_FILE_MAX개를 반환한다.
 * 법률.txt만으로 충분하다고 판단되면 빈 배열이 정상이다.
 * @param {string} query - 사용자 질문
 * @param {Array<{law:string,base:string,lawText:string,files:string[]}>} bundles - loadLawBundle() 결과들
 * @returns {Promise<Array<{law:string,base:string,file:string}>>} 추가로 읽을 파일들(실패 시 [])
 * [연계] ← searchRawFallback() 3단계 → ③병렬조회(github_raw.fetchText).
 */
async function pickRawFiles(query, bundles) {
  if (!gemini.hasAnyKey()) return [];
  const block = bundles.map(b =>
    `### ${b.law}\n[법률 원문]\n${b.lawText.slice(0, RAW_MAX_CHARS)}\n[이 법 폴더의 파일 목록]\n${b.files.join('\n')}`
  ).join('\n\n');
  const prompt = `사용자 질문: "${query}"\n\n${block}\n\n` +
    `위 법률 원문이 시행령·시행규칙·별표·고시에 위임한 내용 중, 이 질문에 답하려면 추가로 읽어야 할 파일을 ` +
    `**파일 목록에 있는 경로 그대로** 최대 ${RAW_FILE_MAX}개까지 고르라. 법률 원문만으로 충분하면 [] 로 답하라. ` +
    `다른 설명 없이 JSON 배열로만 답하라. 예: [{"law":"어선법","file":"시행규칙.txt"},{"law":"어선법","file":"행정규칙/어선구조기준.txt"}]`;
  try {
    const result = await gemini.callGemini({
      model: ANSWER_MODEL, contents: prompt, config: RAW_PICK_CONFIG, caller: 'Legal-RawFilePick',
    });
    if (!result.success || !result.text) return [];
    const m = result.text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const it of arr) {
      if (!it || typeof it.file !== 'string') continue;
      const b = bundles.find(x => x.law === it.law) || (bundles.length === 1 ? bundles[0] : null);
      if (!b || !b.files.includes(it.file)) continue;   // 목차에 없는 경로는 환각 — 버린다
      if (out.some(o => o.base === b.base && o.file === it.file)) continue;
      out.push({ law: b.law, base: b.base, file: it.file });
      if (out.length >= RAW_FILE_MAX) break;
    }
    return out;
  } catch (_) {
    return [];
  }
}

const RAW_ANSWER_RULES = `너는 "나리야" — 대한민국 해양수산 법령을 안내하는 AI 챗봇이다. 아래 [근거자료]는 사람이 검증한 법령 위키 카드가 아니라, 질문에 맞는 카드가 없어 **법령 원문을 방금 그대로 읽어온 것**이다.

${ANSWER_RULES_BODY}
10. ★이 답변은 "미검증 참고"다. 답변 서두에 사람이 검증한 정식 답변이 아니라 원문을 방금 훑어본 참고 정보라는 사실을 한 문장으로 밝히고, 마지막은 반드시 "정확한 확인은 소관부서에 문의하세요"로 마무리한다. 원문에서 근거를 못 찾았으면 억지로 답하지 말고 "확인되지 않습니다"라고 말한다.
11. ★이 답변에는 위키 카드가 없어 화면 아래 "근거 법령" 목록이 붙지 않는다(규칙7이 각주를 생략시키는 근거가 여기엔 없다) — 그러니 근거로 삼은 법령·조문과 그 기준일(시행일)이 원문에 있으면 답변 마지막에 한 줄로 밝힌다.`;

/**
 * 2차 조회(미검증 참고): 위키에서 근거를 못 찾은 질문을 법령 원문으로 한 번 더 시도한다.
 * ①후보 법 좁히기(AI) → ②법률.txt+목차 동시조회 → ③필요 파일 선택(AI) → ④파일 병렬조회 →
 * ⑤답변 합성(AI). 토큰·키가 없거나 어느 단계든 실패하면 예외 없이 answer:null을 반환하므로,
 * 호출부(routes/legal.js)는 기존대로 "근거를 찾지 못했습니다"로 끝내면 된다.
 * 예: searchRawFallback('어선 길이를 늘리려면 허가가 필요한가요')
 *     → {answer:'이 답변은 검증된 카드가 아니라…', laws:['어선법'], files:['어선법/시행규칙.txt']}
 * @param {string} query - 사용자 질문(**답변 합성에는 이 문장만 쓴다**)
 * @param {string} [hint] - 검색 보조어(§4-U 가 확인받은 구어의 뜻 등). ★어느 법·어느 파일을 읽을지
 *   **고르는 두 호출에만** 쓰고, 답변을 쓰는 프롬프트에는 절대 싣지 않는다 — 2026-08-16 적대검증
 *   D1: 호출부가 `q + ' ' + 뜻` 을 통째로 넘기던 탓에 웹에서 온 문장이 답변 합성 프롬프트의
 *   "질문:" 자리에 그대로 실렸고, 이 저장소가 H-37 이래 지켜온 **"답변 합성에는 사용자가 실제로
 *   친 문장을 그대로 넘긴다"**(routes/legal.js §5.5·§7.4 주석) 규약이 처음으로 깨졌다.
 *   보조어는 검색 확장에만 쓴다는 그 규약을 여기서도 같은 모양으로 지킨다.
 * @returns {Promise<{answer:string|null, laws:string[], files:string[]}>} 못 만들면 answer:null
 * [연계] ← routes/legal.js POST /api/legal/ask 의 `needsFallback`(1차 답변 후 최종 근거 0건) 분기.
 *        → services/github_raw.js(원문 조회) · gemini_client(3회 호출: 법선택·파일선택·답변합성).
 */
async function searchRawFallback(query, hint) {
  const EMPTY = { answer: null, laws: [], files: [] };
  if (!githubRaw.hasToken() || !gemini.hasAnyKey()) return EMPTY;
  try {
    // 보조어는 **고르기 단계에만** 합친다(위 @param hint 참고). hint 가 없으면 qPick === query 라
    // 이 함수의 동작이 보조어 도입 전과 문자 그대로 같다(R0).
    const h = clarifyStr(hint, NAVER_MEANING_MAX);
    const qPick = h ? query + ' ' + h : query;
    const lawNames = [...new Set((loadIndex().pages || [])
      .filter(p => p.kind === 'statute' && p.law).map(p => p.law))];
    const laws = (await pickCandidateLaws(qPick, lawNames)).filter(rawPathOf);
    if (!laws.length) return EMPTY;

    const bundles = (await Promise.all(laws.map(loadLawBundle))).filter(Boolean);
    if (!bundles.length) return EMPTY;

    const picks = await pickRawFiles(qPick, bundles);
    const extras = (await Promise.all(picks.map(async p => {
      const text = await githubRaw.fetchText(p.base + '/' + p.file);
      return text ? { law: p.law, file: p.file, text } : null;
    }))).filter(Boolean);

    const blocks = bundles.map(b => `--- [${b.law}] 법률 원문 ---\n${b.lawText.slice(0, RAW_MAX_CHARS)}`)
      .concat(extras.map(x => `--- [${x.law}] ${x.file} ---\n${x.text.slice(0, RAW_MAX_CHARS)}`));
    const prompt = `${RAW_ANSWER_RULES}\n\n[근거자료]\n${blocks.join('\n\n')}\n\n질문: "${query}"\n답:`;
    const result = await gemini.callGemini({
      model: ANSWER_MODEL, contents: prompt, config: SYNTH_CONFIG, caller: 'Legal-RawFallback',
    });
    if (!result.success || !result.text || !result.text.trim()) return EMPTY;
    return {
      answer: result.text.trim(),
      laws: bundles.map(b => b.law),
      files: extras.map(x => `${x.law}/${x.file}`),
    };
  } catch (_) {
    return EMPTY;
  }
}

// ============================================================================
// H-36 실서빙 배선 파일럿 — 해역·항해구역 계층 트리(zone_tree.json) 되묻기
// ----------------------------------------------------------------------------
// 지금까지 "하천이냐 바다냐" 같은 갈림길은 decideClarify()가 질문마다 Gemini를 불러 즉석으로
// 만들었다(매번 문구가 달라지고, 근거자료 top-6에 그 구분이 안 뜨면 아예 못 묻는다). 이 절은
// 미리 raw 74법을 전수 스캔해 만들어 둔 `_dashboard/zone_tree.json`(트리 3개·노드 22·리프 14·
// 적용항목 79건, 빌드게이트+독립재대조+사람 전량정독 3단 검증)을 그대로 타고 내려가 **LLM 호출
// 0회**로 같은 되묻기를 낸다. 리프에 닿으면 그 구역에 적용되는 규정 목록을 데이터에서 꺼내 답한다.
//
// ★설계 전문: `knowledge/legal/_dashboard/H36_live_wiring_design.md`
// ★이 절의 함수는 전부 신규다 — 위쪽 기존 함수(decideClarify·search 등)는 한 줄도 고치지 않았다.
//   CLARIFY_JOINER·CLARIFY_OPTION_MAX만 재사용한다(되묻기 규약을 두 벌로 만들지 않기 위해).
// ★안전 규약: zoneTreeStep()은 어떤 경우에도 예외를 던지지 않는다(파일 없음·JSON 깨짐·스키마
//   이상·매칭 실패 전부 null) — null이면 호출부는 배선 전과 100% 같은 기존 흐름을 탄다.
// ============================================================================

const ZONE_TREE_JSON = path.join(LEGAL_DIR, '_dashboard', 'zone_tree.json');

// 트리 선택 우선순위(H32_zone_tree_design.md §9.2 "해역 > 조업해역 > 항해구역").
const ZONE_TREE_ORDER = ['sea_area', 'fishing_operation_area', 'navigation_zone'];

// ① "구역 축 자체를 묻고 있는가" — 어미까지 붙은 구(句)라 낱말 경계 검사를 하면 안 된다
//    ("제주도까지 갈 수 있"의 '까지'는 앞 낱말에 붙어 있다).
const ZONE_ASK = [
  '어디까지 갈', '어디까지 나갈', '어디까지 나가', '어디까지 항해', '어디까지 운항',
  '어디까지 다닐', '어디까지 조업', '어디까지 출항',
  '까지 갈 수 있', '까지 나갈 수 있', '까지 나가도', '까지 항해할 수', '까지 운항할 수', '까지 조업할 수',
  '어느 해역', '어느 수역', '무슨 해역', '어느 구역', '어느 바다', '어디서 조업', '어디에서 조업',
];
// ② 배·조업 이야기인가(낱말 — 조사가 붙으므로 "토큰이 이 낱말로 시작하는가"로 본다).
const ZONE_SUBJECT = ['배', '선박', '어선', '낚싯배', '낚시배', '요트', '보트', '유선', '도선', '항해', '운항', '조업', '출어'];
// 트리 라벨이 하나도 없을 때 조업해역 트리로 보내는 신호.
const ZONE_FISHING_HINT = ['조업', '어선', '출어'];
// ★관용구 제외: 한국어에서 "행정처분까지 갈 수 있나요"·"감옥까지 갈 수 있나요"는 "어디까지
//   가느냐"가 아니라 "그 지경까지 이르느냐"다. 실제 사용자형 질문 43,956건(_dashboard/audit/*.md)
//   전수 측정에서 이 한 갈래가 오탐의 절반이었다 — '까지…'로 시작하는 구 앞 6글자만 좁게 본다.
const ZONE_ASK_IDIOM = /처분|정지|취소|감옥|압류|몰수|벌금|과태료|징역|형사/;

// 적용항목 `유형`(7종)을 답변에 싣는 순서. 데이터에 없는 유형은 뒤에 원래 순서로 붙는다.
const ZONE_KIND_ORDER = ['적용법령', '허가·신고', '의무', '제한', '완화', '관할', '처벌'];

// ── zone_tree.json 캐시(mtime 감지) ──
let _zoneCache = null, _zoneMtime = 0;
/**
 * 해역·항해구역 트리 자산을 읽어 캐시한다(index.json·glossary와 같은 mtime 감지 방식).
 * 파일이 없거나 JSON이 깨졌으면 조용히 빈 트리를 돌려준다 — 이 자산이 없다고 챗봇이 죽으면 안 된다.
 * @returns {{trees:Array}} 실패 시 {trees:[]}
 * [연계] ← matchZoneTreeTopic()/zoneTreeStep(). ← knowledge/legal/_dashboard/zone_tree.json.
 */
function loadZoneTree() {
  try {
    const mt = fs.statSync(ZONE_TREE_JSON).mtimeMs;
    if (_zoneCache && mt === _zoneMtime) return _zoneCache;
    _zoneCache = JSON.parse(fs.readFileSync(ZONE_TREE_JSON, 'utf8')); _zoneMtime = mt;
  } catch (_) { if (!_zoneCache) _zoneCache = { trees: [] }; }
  return _zoneCache;
}

/** 공백을 모두 지운 비교용 문자열(법률 용어는 띄어쓰기가 자료마다 달라 그대로 비교하면 어긋난다). */
function zoneFlat(s) { return String(s || '').replace(/\s+/g, ''); }

/**
 * 질의에 이 **낱말**이 들어 있는가. 한국어는 조사가 붙으므로(영해→영해에서) 완전일치로는 못 잡고,
 * 그냥 부분문자열로 보면 "운**영해**도"·"경**영해**"가 걸린다(실측: 43,956건에서 '영해' 오탐 188건).
 * 그래서 ①한글·영숫자로만 된 한 어절 낱말은 **토큰이 그 낱말로 시작하는지** ②띄어쓰기나 괄호·가운뎃점이
 * 든 용어("배타적 경제수역"·"수상(水上)"·"어선의 조업·항행 해역")는 **공백만 지운 부분문자열**로 보되
 * 낱말 경계를 **원문 위치로** 확인한다.
 * ★②의 경계 검사를 공백 지운 문자열에서 하면 안 된다 — 경계였던 그 공백이 사라져 앞 글자가 늘 한글이
 *   되므로, **문장 중간의 다중어절 라벨은 100% 탈락한다**("배로 배타적 경제수역까지 나가도 되나요?"가
 *   해역 트리를 못 찾아 항해구역 트리로 오라우팅됐다 — 적대검증 §8-①, 라이브 재현). 그래서 공백 제거
 *   인덱스를 원문 인덱스로 되돌려, **원문에서** 바로 앞 글자가 한글·영숫자가 아닐 때만 인정한다.
 * 예: zoneWordHit('우리 배 어디까지 나갈 수 있나요?', '배') → true · zoneWordHit('운영해도 되나요?', '영해') → false
 *     zoneWordHit('배로 배타적 경제수역까지 나가도 되나요?', '배타적 경제수역') → true
 * @param {string} query @param {string} word
 * @returns {boolean}
 * [연계] ← matchZoneTreeTopic(주제 어휘)·resolveZoneTreePath(②암시 하강의 라벨 대조).
 */
function zoneWordHit(query, word) {
  const w = String(word || '').trim();
  if (!w) return false;
  if (/^[가-힣A-Za-z0-9]+$/.test(w)) {
    return String(query || '').split(/[^가-힣A-Za-z0-9]+/).some(t => t && t.startsWith(w));
  }
  const q = String(query || '');
  let nq = ''; const at = [];              // 공백 지운 문자열의 i번째 → 원문 인덱스
  for (let i = 0; i < q.length; i++) if (!/\s/.test(q[i])) { nq += q[i]; at.push(i); }
  const nw = zoneFlat(w);
  if (!nw) return false;
  for (let i = nq.indexOf(nw); i >= 0; i = nq.indexOf(nw, i + 1)) {
    const p = at[i] - 1;                   // 원문에서 라벨 바로 앞 글자
    if (p < 0 || !/[가-힣A-Za-z0-9]/.test(q[p])) return true;
  }
  return false;
}

/**
 * 질의에 이 **어미구**가 들어 있는가(공백 무시 부분문자열). 낱말과 달리 앞 경계를 보지 않는다 —
 * "제주도까지 갈 수 있나요"의 '까지'는 앞 낱말에 그대로 붙어 있기 때문이다.
 * 단, '까지…'로 시작하는 구는 위 ZONE_ASK_IDIOM 관용구("행정처분까지 갈 수 있나")를 제외한다.
 * @param {string} query @param {string} phrase
 * @returns {boolean}
 * [연계] ← matchZoneTreeTopic(ZONE_ASK 대조).
 */
function zonePhraseHit(query, phrase) {
  const nq = zoneFlat(query), np = zoneFlat(phrase);
  if (!np) return false;
  for (let i = nq.indexOf(np); i >= 0; i = nq.indexOf(np, i + 1)) {
    if (!np.startsWith('까지') || !ZONE_ASK_IDIOM.test(nq.slice(Math.max(0, i - 6), i))) return true;
  }
  return false;
}

/**
 * 노드와 그 아래 모든 자손의 `라벨` + `선택지[].label`을 모은다(중복 제거).
 * @param {object} node
 * @param {string} [parentLabel] - 부모가 이 노드를 부르는 선택지 label. ⚠꼭 넘겨야 하는 경우가 있다 —
 *   `far_sea` 노드의 `라벨`은 '그 밖의 먼바다(공해·해외수역)'인데 사용자에게 보이고 질의에 붙는 이름은
 *   부모(sea_surface)의 선택지 label '그 밖의 먼바다'다. 이걸 빼면 그 노드는 질의로 영영 못 찾는다.
 */
function zoneLabelsOf(node, parentLabel) {
  const out = parentLabel ? [parentLabel] : [];
  (function walk(n) {
    if (!n) return;
    if (n.라벨) out.push(n.라벨);
    for (const o of (n.선택지 || [])) if (o && o.label) out.push(o.label);
    for (const c of (n.children || [])) walk(c);
  })(node);
  return [...new Set(out)];
}

/**
 * 이 질문이 해역·항해구역 트리가 다룰 주제인지 판정한다(LLM 0회).
 * ★"구역을 **언급한** 질문"이 아니라 "구역 **자체를 묻는** 질문"에만 들어간다 — 트리 리프가 주는
 *   것은 "그 구역에서 무엇이 달라지는가"의 목록이라, 예컨대 *"저희 배(연해구역 항해, 20톤)는
 *   DGPS를 달아야 하나요?"* 에 끼어들면 원래 맞았을 답을 구역 규정 목록으로 바꿔버린다(실측 근거는
 *   H36_live_wiring_design.md §1.1). 그래서 ①구역 축을 묻는 어미구 ②배·조업 어휘 **둘 다** 요구한다.
 * ★판정은 **원 질문**(CLARIFY_JOINER 앞부분)으로만 한다 — 앞 라운드에서 AI 되묻기가 붙인 라벨
 *   때문에 2라운드에서 갑자기 트리가 가로채는 것을 막는다(무상태로 매 요청 같은 답이 나온다).
 * 예: matchZoneTreeTopic('낚싯배로 제주도까지 갈 수 있나요?') → navigation_zone 트리
 *     matchZoneTreeTopic('구명조끼 몇 개 필요해요?') → null(기존 흐름)
 * @param {string} query - 사용자 질의(되묻기 라벨이 누적된 상태일 수 있다)
 * @returns {object|null} zone_tree.json 의 trees[] 원소, 아니면 null
 * [연계] ← zoneTreeStep(). → resolveZoneTreePath()가 그 트리 안에서 위치를 잡는다.
 */
function matchZoneTreeTopic(query) {
  const q0 = String(query || '').split(CLARIFY_JOINER)[0];
  if (!ZONE_ASK.some(p => zonePhraseHit(q0, p))) return null;
  if (!ZONE_SUBJECT.some(w => zoneWordHit(q0, w))) return null;
  const trees = loadZoneTree().trees || [];
  // ⓐ 질문이 이미 어느 구역 이름을 말했으면 그 트리(축이 확정된다).
  for (const id of ZONE_TREE_ORDER) {
    const t = trees.find(x => x && x.id === id);
    if (t && t.tree && zoneLabelsOf(t.tree).some(l => zoneWordHit(q0, l))) return t;
  }
  // ⓑ 조업 이야기면 조업해역 트리, ⓒ 그 밖에는 항해구역 트리("그 배가 어디까지 나갈 수 있느냐").
  const want = ZONE_FISHING_HINT.some(w => zoneWordHit(q0, w)) ? 'fishing_operation_area' : 'navigation_zone';
  return trees.find(x => x && x.id === want) || null;
}

/**
 * 누적된 질의 문자열 하나만 보고 트리의 **현재 위치**를 복원한다(서버는 세션·DB를 들지 않는다).
 *  ① 명시 경로: `' — 라벨'`로 붙은 조각을 그 노드의 **선택지 label**과 공백무시 완전일치로 대조해
 *     `next`(자식 id)로 내려간다. ⚠라벨(`라벨`)이 아니라 **선택지 label**이 계약이다 — 실제 데이터에
 *     둘이 다른 노드가 있다(sea_surface 선택지 '그 밖의 먼바다' vs 자식 라벨 '그 밖의 먼바다(공해·해외수역)').
 *     클라이언트(ai_chat.js pickClarifyOption)가 질의에 붙이는 것은 선택지 label 쪽이다.
 *  ② 암시 하강: 더 못 내려가면 질의에서 자식 서브트리의 라벨을 찾아, **정확히 하나**일 때만
 *     내려간다("우리 배 근해구역인데 어디까지 갈 수 있나요?"는 되묻지 않고 바로 그 노드로). 0개거나
 *     2개 이상이면 멈춘다(애매하면 되묻는 쪽이 안전하다).
 *     ⚠②가 보는 것은 **①이 안 쓴 부분**이다(원 질문 + 아직 안 쓰인 조각). ①이 소비한 조각까지 보면,
 *     사용자가 고른 `근해구역 이상`(= 근해 또는 원양, 아직 안 고른 상태) 안의 '근해구역'이 자식 라벨로
 *     걸려 **되묻지 않고 근해구역 리프로 내려가 버린다**(라이브 실측으로 재현한 결함).
 * @param {string} query - 사용자 질의(원 질문 + 누적 라벨)
 * @param {object} tree - trees[] 원소({id, 축, tree})
 * @returns {{node:object, path:Array<object>, rest:string}} 현재 노드·루트→현재 경로와
 *          "①이 아직 안 쓴 질의"(되묻기 백스톱이 같은 기준으로 판정하도록 함께 돌려준다)
 * [연계] ← zoneTreeStep(). → clarifyFromZoneTree(비-리프) 또는 collectZoneRules(리프).
 */
function resolveZoneTreePath(query, tree) {
  const segs = String(query || '').split(CLARIFY_JOINER).slice(1).map(s => s.trim());
  const used = new Set();
  const path = [tree.tree];
  let node = tree.tree;
  for (;;) {                                     // ① 사용자가 실제로 고른 값
    let next = null;
    for (let i = 0; i < segs.length && !next; i++) {
      if (used.has(i)) continue;
      const opt = (node.선택지 || []).find(o => o && zoneFlat(o.label) === zoneFlat(segs[i]));
      if (!opt) continue;
      const child = (node.children || []).find(c => c && c.id === opt.next);
      if (child) { used.add(i); next = child; }
    }
    if (!next) break;
    node = next; path.push(node);
  }
  const rest = [String(query || '').split(CLARIFY_JOINER)[0]]
    .concat(segs.filter((_, i) => !used.has(i))).join(CLARIFY_JOINER);
  for (;;) {                                     // ② 질문이 이미 말해둔 구역(①이 안 쓴 부분만)
    const kids = node.children || [];
    if (!kids.length) break;
    const optOf = c => ((node.선택지 || []).find(o => o && o.next === c.id) || {}).label;
    const hit = kids.filter(c => zoneLabelsOf(c, optOf(c)).some(l => zoneWordHit(rest, l)));
    if (hit.length !== 1) break;
    node = hit[0]; path.push(node);
  }
  return { node, path, rest };
}

/**
 * 이 항목의 `구역범위`가 이 리프(서열 rank)를 포함하는가.
 * `구역범위`는 "이 구역만 / 이 구역 이상 / 이 구역 이하" 3값이고, 뒤 둘은 그 항목이 걸린 노드의
 * `서열`을 기준으로 범위를 정한다(zone_tree.json semantics.구역범위).
 * ★경로 상속에도 이 검사가 필요하다 — 조상 노드에 "이 구역 이하"로 걸린 항목이 그보다 깊은(서열이
 *   높은) 리프까지 그대로 따라가면, **자기 데이터가 "이 구역은 대상이 아니다"라고 말하는 항목이 그
 *   구역의 의무로 표시된다**(적대검증 §8-② 원양구역 건강진단). 서열이 없는 트리(해역·조업해역)는
 *   항상 "이 구역만"이라 이 검사가 아무것도 거르지 않는다.
 * 예: zoneRangeIncludes({구역범위:'이 구역 이하'}, {서열:4}, 5) → false (근해 이하 규정은 원양에 안 붙는다)
 * @param {object} rule - 적용항목 @param {object} node - 그 항목이 실려 있는 노드 @param {number|null} rank - 리프 `서열`
 * @returns {boolean}
 * [연계] ← collectZoneRules(경로 상속).
 */
function zoneRangeIncludes(rule, node, rank) {
  if (rank == null || node.서열 == null) return true;
  if (rule.구역범위 === '이 구역 이상') return node.서열 <= rank;
  if (rule.구역범위 === '이 구역 이하') return node.서열 >= rank;
  return true;
}

/**
 * 이 구역에 적용되는 규정을 모은다.
 *  ⓐ **경로 상속**(zone_tree.json semantics.적용_상속): 루트→리프 경로상 모든 노드의 `적용` 합집합.
 *     단 `구역범위`가 서열로 범위를 좁혀둔 항목은 그 범위 밖 리프에 딸려가지 않는다(zoneRangeIncludes).
 *  ⓑ **서열·구역범위 규약**(항해구역 트리 전용, 같은 파일 semantics.구역범위): 리프 `서열`이 s일 때
 *     다른 노드(서열 t)의 항목 중 `구역범위`가 "이 구역 이상"이고 t≤s면, "이 구역 이하"이고 t≥s면 포함.
 *     ⚠이게 없으면 **답이 틀린다** — 원양구역(서열5)은 연해구역(서열3)에 달린 "연해구역 이상" 2건을
 *     상속해야 하는데 둘은 형제라 경로 상속만으로는 안 딸려온다(H32_zone_tree_design.md §2.5).
 * 같은 규정이 여러 노드에 실려 있으면 (법령·계층·조문·제목)으로 한 번만 싣는다.
 * @param {object} tree - trees[] 원소
 * @param {Array<object>} path - resolveZoneTreePath()의 path
 * @returns {Array<{rule:object, from:string}>} from = 그 항목이 실려 있던 노드 라벨
 * [연계] ← zoneTreeStep(). → renderZoneAnswer().
 */
function collectZoneRules(tree, path) {
  const out = []; const seen = new Set();
  const push = (r, from) => {
    if (!r) return;
    const k = [r.근거법령_slug, r.계층, r.근거조문, r.제목].join('|');
    if (seen.has(k)) return;
    seen.add(k); out.push({ rule: r, from });
  };
  const rank = path[path.length - 1].서열;
  for (const n of path) for (const r of (n.적용 || [])) if (zoneRangeIncludes(r, n, rank)) push(r, n.라벨);
  if (rank != null) {
    (function walk(n) {
      if (!n) return;
      if (n.서열 != null && path.indexOf(n) < 0) {
        for (const r of (n.적용 || [])) {
          if (r.구역범위 === '이 구역 이상' && n.서열 <= rank) push(r, n.라벨 + ' 이상');
          if (r.구역범위 === '이 구역 이하' && n.서열 >= rank) push(r, n.라벨 + ' 이하');
        }
      }
      for (const c of (n.children || [])) walk(c);
    })(tree.tree);
  }
  return out;
}

/**
 * 트리 노드에서 되묻기 JSON을 조립한다 — 문구를 즉석 생성하지 않고 **데이터에서 그대로 꺼낸다**.
 * 반환 스키마는 기존 decideClarify()와 **완전히 동일**해서 routes/legal.js·ai_chat.js가 무변경이다.
 * @param {object} tree - trees[] 원소(intro 문장에 `축`을 쓴다)
 * @param {object} node - 비-리프 노드(`질문`·`선택지` 필수 — 빌더가 강제해 둔 불변식)
 * @returns {{needed:boolean, intro:string, question:string, options:Array<{label:string,hint:string}>}}
 * [연계] ← zoneTreeStep(). → routes/legal.js done.clarify → ai_chat.js clarifyHTML(버튼).
 */
function clarifyFromZoneTree(tree, node) {
  const options = (node.선택지 || [])
    .map(o => ({ label: clarifyStr(o && o.label, 40), hint: clarifyStr(o && o.hint, 120) }))
    .filter(o => o.label)
    .slice(0, CLARIFY_OPTION_MAX);
  return {
    needed: !!(node.질문 && options.length >= 2),
    intro: `${tree.축}에 따라 적용되는 법령·의무가 달라져서, 하나만 여쭤볼게요.`,
    question: clarifyStr(node.질문, 200),
    options,
  };
}

// ── 표시 규칙 상한(H37 §13.2) ────────────────────────────────────────────────
// ★상한은 **항목 개수**로만 건다 — 문자 수로 자르면 인용문이 항목 중간에서 잘려 화면의 큰따옴표
//   안이 원문보다 짧아지고, 그게 환각과 구분이 안 된다(H36_adversarial_review §5-A와 같은 계열).
// ★상한에 걸린 항목은 **버리지 않고 제목 줄만** 남긴다 — 트리의 가치는 "그 구역에서 달라지는
//   것의 목록"이라, 사용자가 안 물었다고 규정이 사라지면 안 된다.
const ZONE_EXPAND_RELEVANT_MAX = 8;   // 질문어가 걸린 항목 중 펼칠 최대 개수
const ZONE_EXPAND_PER_KIND = 3;       // 질문어가 하나도 안 걸릴 때 유형별로 펼치는 개수
// 이 개수 이하인 리프는 **아무것도 접지 않는다** — 접기는 고시 확장으로 55~66건이 된 항해구역
// 리프의 1.5만~1.8만 자 폭증(L-81)을 막으려는 것이지, 원래 읽을 만하던 리프(항목 5~16건·
// 1.6천~4.4천 자)의 내용을 줄이려는 것이 아니다. 없어도 되는 곳에서 접으면 그냥 손실이다.
const ZONE_FOLD_MIN = 20;

// 계층 값(법률·시행령·시행규칙·고시)을 화면에 풀어 쓰는 말. **표기만** 바꾸는 사전이라
// "무엇이 들어 있다"는 단언이 아니다(그 판단은 전부 자산에서 센다 — zoneCoverageNote 참조).
const ZONE_TIER_LABEL = { 고시: '고시(행정규칙)' };

/**
 * 적용항목 하나에서 질문어를 찾을 대상 문자열을 만든다(H37 §13.2 `hay(rule)`).
 * @param {object} r - 적용항목
 * @returns {string}
 * [연계] ← rankZoneRules().
 */
function zoneRuleHay(r) {
  return [r.제목, r.인용, r.대상, r.조건, r.적용제외, r.주의, r.근거법령].filter(Boolean).join(' ');
}

/**
 * 리프에 상속된 적용항목을 **원 질문어와의 관련도**로 채점한다(H37 §13.2).
 * 고시 확장(L-81)으로 한 리프에 55~66건이 실리게 되면서, `유형` 순서대로 전부 펼치면 1.8만 자가
 * 쏟아진다 — 자르기 전에 **정렬이 먼저**다(단순 상위 N건은 질문과 무관한 항목만 남길 수 있다).
 * ★`termsOf()`를 그대로 재사용하고, `sliceRelevant()`의 **절-내 문서빈도 역가중**을 항목 단위로
 *   옮겼다 — 이 자산에서 `선박`·`구역` 같은 낱말은 거의 모든 항목에 있어 변별력이 0이라,
 *   역가중이 없으면 순위가 뭉개진다. `scoreOne()`은 index.json 페이지 객체 전제라 못 쓴다.
 * ★채점은 **원 질문**(CLARIFY_JOINER 앞)으로만 한다 — 되묻기로 붙은 라벨('평수구역')을 넣으면
 *   그 낱말이 거의 모든 항목에 있어 순위가 무의미해진다.
 * 예: rankZoneRules(rules, '구명조끼 싣고 어디까지 나갈 수 있나요? — 평수구역')
 *     → 구명설비 항목의 score가 가장 높다
 * @param {Array<{rule:object, from:string}>} rules - collectZoneRules()의 결과
 * @param {string} query - 사용자 질의(되묻기 라벨이 누적된 상태일 수 있다)
 * @returns {Array<{rule:object, from:string, score:number, idx:number}>} 입력 순서 그대로(정렬 안 함)
 * [연계] ← renderZoneAnswer(). → pickZoneExpanded()가 이 점수로 펼칠 항목을 고른다.
 */
function rankZoneRules(rules, query) {
  const terms = termsOf(String(query || '').split(CLARIFY_JOINER)[0]);
  const hays = rules.map(e => zoneRuleHay(e.rule));
  const df = terms.map(t => hays.reduce((n, h) => n + (h.includes(t) ? 1 : 0), 0));
  return rules.map((e, i) => {
    let s = 0;
    terms.forEach((t, ti) => {
      if (df[ti] <= 0 || !hays[i].includes(t)) return;
      s += (String(e.rule.제목 || '').includes(t) ? 3 : 1) / df[ti];   // 제목 가중 3 = scoreOne과 같은 취지
    });
    return Object.assign({ score: s, idx: i }, e);
  });
}

/**
 * 채점 결과에서 **펼칠 항목**을 고른다(나머지는 제목 줄만 남는다, H37 §13.2 표시규칙).
 *  ⓪ 항목이 ZONE_FOLD_MIN건 이하인 리프는 **전부 펼친다**(접을 이유가 없다).
 *  ⓐ `주의`·`적용제외`가 있는 항목은 **점수와 무관하게 언제나 펼친다** — 배선 전 필수 규약②
 *     (MASTER_PLAN H-36 "`주의`·`적용제외`는 언제나 함께 노출")를 접기가 무력화하면 회귀다.
 *  ⓑ 질문어가 걸린 항목(score>0)은 점수 높은 순으로 최대 ZONE_EXPAND_RELEVANT_MAX건.
 *  ⓒ 질문어가 **하나도 안 걸리면**(트리 되묻기의 정상 경로 — "우리 배 어디까지 나갈 수 있나요?")
 *     정렬이 무의미하므로 순서를 건드리지 않고 **유형별 상위 ZONE_EXPAND_PER_KIND건**만 펼친다.
 * @param {Array<{rule:object, score:number, idx:number}>} scored - rankZoneRules()의 결과
 * @returns {Set<number>} 펼칠 항목의 idx 집합
 * [연계] ← renderZoneAnswer().
 */
function pickZoneExpanded(scored) {
  const keep = new Set();
  if (scored.length <= ZONE_FOLD_MIN) { for (const e of scored) keep.add(e.idx); return keep; }
  for (const e of scored) if (e.rule.주의 || e.rule.적용제외) keep.add(e.idx);            // ⓐ
  const hit = scored.filter(e => e.score > 0).sort((a, b) => b.score - a.score || a.idx - b.idx);
  for (const e of hit.slice(0, ZONE_EXPAND_RELEVANT_MAX)) keep.add(e.idx);                // ⓑ
  if (!hit.length) {                                                                      // ⓒ
    const per = new Map();
    for (const e of scored) {
      const n = per.get(e.rule.유형) || 0;
      if (n >= ZONE_EXPAND_PER_KIND) continue;
      keep.add(e.idx); per.set(e.rule.유형, n + 1);
    }
  }
  return keep;
}

/**
 * 답변 말미의 **"이 목록의 한계"** 문구를 자산의 실제 커버리지에서 조립한다(H37 §13.3, L-81 교훈③).
 * ★불변식: *"코드가 자산의 내용을 산문으로 단언하지 않는다."* 예전에는 "고시의 구역별 설비·수량
 *   기준은 여기 들어 있지 않아요"가 하드코딩돼 있었는데, 2026-08-11 확장으로 고시 107건이 들어오자
 *   **사용자에게 보이는 거짓 문장**이 됐다. 이제 무엇이 들어 있는지는 **이 답변에 실린 항목들의
 *   `계층`을 세어서**, 무엇이 빠져 있는지는 **자산 `unmapped`의 표시 라벨에서** 가져온다 —
 *   자산이 또 바뀌면 문구가 자동으로 따라간다.
 * 예: 평수구역(고시 46건·법률 17건…) → "…(이 구역은 고시(행정규칙) 46건 · 법률 17건 …)"
 * @param {Array<{rule:object}>} rules - 이 리프에 실린 적용항목 전량(접힌 것 포함)
 * @returns {string} 답변 말미 한 문단
 * [연계] ← renderZoneAnswer(). ← zone_tree.json(summary.laws_in_scope · unmapped.유형_단위[].표시 ·
 *        unmapped.스캔밖_표시.값 · 적용[].별표.값).
 */
function zoneCoverageNote(rules) {
  const asset = loadZoneTree();
  const um = asset.unmapped || {};
  const byTier = new Map();
  for (const e of rules) byTier.set(e.rule.계층, (byTier.get(e.rule.계층) || 0) + 1);
  const tiers = [...byTier.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${ZONE_TIER_LABEL[k] || k} ${n}건`).join(' · ');
  const laws = ((asset.summary || {}).laws_in_scope) || null;
  const off = (um.유형_단위 || []).map(u => u && u.표시).filter(Boolean);
  const outside = ((um.스캔밖_표시 || {}).값) || [];
  const missing = rules.filter(e => e.rule.별표 && e.rule.별표.값 == null).length;

  const parts = [`**이 목록의 한계**: ${laws ? laws + '개 ' : ''}해양수산 법령의 원문에 ` +
    `"구역에 따라 달라진다"고 문장으로 적혀 있는 것만 모은 목록이에요` + (tiers ? `(이 구역은 ${tiers}).` : '.')];
  if (off.length) parts.push(`같은 자료 안에 있어도 이 축(구역에 따라 무엇이 달라지나)이 아니라서 뺀 것: ${off.join(' · ')}.`);
  if (outside.length) parts.push(`애초에 이번 스캔 대상이 아닌 것: ${outside.join(' · ')}.`);
  if (missing) parts.push(`수량이 별표에 있는데 그 별표를 아직 못 모아 값을 비워 둔 항목이 ${missing}건 있어요.`);
  parts.push('목록에 없다고 해서 그런 규정이 없다는 뜻은 아닙니다. 정확한 확인은 소관부서에 문의하세요.');
  return parts.join(' ');
}

/** 적용항목 한 건을 답변 줄로 편다(원문 인용·주의는 가공 없이 그대로 — 환각 0). */
function zoneRuleLines(entry, idx) {
  const r = entry.rule;
  const L = [`${'가나다라마바사아자차카타파하'[idx] || String(idx + 1)}. ${r.제목}`];
  L.push(`1) 근거: 「${r.근거법령}」(${r.계층}) ${r.근거조문}`);
  L.push(`2) 원문: "${r.인용}"`);
  let n = 3;
  if (r.대상) L.push(`${n++}) 대상: ${r.대상}`);
  if (r.조건) L.push(`${n++}) 조건: ${r.조건}`);
  if (r.적용제외) L.push(`${n++}) 적용제외: ${r.적용제외}`);
  if (r.위임 && r.위임.length) L.push(`${n++}) 위임: ${r.위임.map(w => `「${w.법령}」(${w.계층}) ${w.조문}`).join(' · ')}`);
  if (r.주의) L.push(`${n++}) ⚠주의: ${r.주의}`);
  return L.join('\n');
}

/** 접힌 적용항목 한 건 — 제목과 근거만 남긴다(버리지 않는다는 뜻이지 인용까진 안 편다). */
function zoneRuleFoldedLine(entry) {
  const r = entry.rule;
  return `· ${r.제목} — 「${r.근거법령}」(${r.계층}) ${r.근거조문}`;
}

/**
 * 리프에서 최종 답변 문장을 만든다 — **LLM을 부르지 않고 데이터 그대로** 편다.
 * ★신뢰 등급(H36_live_wiring_design.md §4.4): 사람이 검증한 위키 카드(확답)도, 즉석 조회한
 *   "미검증 참고"도 아닌 **그 사이 등급**이다. 인용문 하나하나는 raw 원문 축자 인용이라 위키보다
 *   원본에 가깝지만(빌드게이트+독립재대조+사람 전량정독 3단 검증), **목록이 그 구역 규정의 전부는
 *   아니다**(고시 수치·자치법규·별표 제외, 스캔 사각지대 존재). 그래서 서두와 말미에 그 성격을
 *   반드시 밝히고, "그런 규정 없음"이라고 단정하지 않는다.
 * ★배선 전 필수 규약(MASTER_PLAN H-36) 반영: ①`유형:처벌` 항목은 **"처벌(법정형)"** 로 표기하고
 *   선고형이 아님을 명시 ②항목의 `주의`·`적용제외`는 언제나 함께 노출 ③리프의 `추가확인`(트리로
 *   쪼개지 않은 잔여 축)은 되묻지 않고 본문에 병기.
 * ★2026-08-12(H37 §13): 고시 확장으로 한 리프가 55~66건이 되면서 전량 펼치기가 1.8만 자로
 *   쏟아졌다(L-81). 이제 **질문어와의 관련도**(rankZoneRules)로 정렬해 상위만 펼치고 나머지는
 *   **제목 줄로 접는다** — 항목은 하나도 버리지 않는다(펼침 + 접힘 = 전체). 말미 면책 문구도
 *   하드코딩을 걷어내고 자산에서 조립한다(zoneCoverageNote).
 * @param {object} tree @param {Array<object>} path @param {Array<{rule:object,from:string}>} rules
 * @param {string} [query] - 사용자 질의(관련도 정렬용 — 없으면 전부 score 0이라 기존 순서 그대로)
 * @returns {string} 답변 본문(클라이언트 answerBodyHTML이 지원하는 `**굵게**`·줄바꿈만 사용)
 * [연계] ← zoneTreeStep(). → routes/legal.js done.answer → ai_chat.js answerBodyHTML.
 */
function renderZoneAnswer(tree, path, rules, query) {
  const leaf = path[path.length - 1];
  const scored = rankZoneRules(rules, query);
  const keep = pickZoneExpanded(scored);
  const out = [];
  // ★2026-08-14(H-37 §8): 뒤에 붙어 있던 등급 문장("사람이 검증한 위키 카드가 아니라 …")을 지웠다
  //   (사용자 확정 — 본문 안의 등급 언급도 함께 제거). 이 목록이 어디서 왔고 무엇이 빠졌는지는
  //   말미 zoneCoverageNote()가 자산에서 조립해 말한다(등급이 아니라 커버리지 고지다).
  out.push(`쉽게 말하면, **${leaf.라벨}**에 대해 법령 원문에서 확인된 규정은 아래 ${rules.length}건이에요.`);
  out.push(`**확인한 구역**: ${path.map(n => n.라벨).join(' → ')} (${tree.축})`);
  if (leaf.정의) out.push(`**${leaf.라벨}란**: ${leaf.정의}`);
  if (keep.size < rules.length) {
    // ★질문어가 하나도 안 걸렸는데 "질문과 관련 있는 것부터"라고 쓰면 **거짓말**이다(그때는 유형별
    //   앞에서부터 펼친 것뿐이다). 실제로 한 일을 그대로 적는다.
    const hit = scored.some(e => e.score > 0);
    out.push(`※ 항목이 많아 ${hit ? '**질문에 나온 말이 들어 있는 것부터**' : '**유형별로 앞에서부터**'} ${keep.size}건을 펼치고, ` +
      `나머지 ${rules.length - keep.size}건은 제목·근거만 적었어요. ⚠주의나 적용제외가 붙은 항목은 순서와 상관없이 모두 펼칩니다.`);
  }

  const kinds = [...new Set(rules.map(e => e.rule.유형))]
    .sort((a, b) => (ZONE_KIND_ORDER.indexOf(a) + 1 || 99) - (ZONE_KIND_ORDER.indexOf(b) + 1 || 99));
  kinds.forEach((kind, ki) => {
    // 관련도 내림차순(동점은 자산 순서 — Array.sort가 안정정렬이라 **전원 0점이면 원래 순서 그대로**다).
    const list = scored.filter(e => e.rule.유형 === kind).sort((a, b) => b.score - a.score);
    const open = list.filter(e => keep.has(e.idx));
    const fold = list.filter(e => !keep.has(e.idx));
    out.push(`**${ki + 1}. ${kind === '처벌' ? '처벌(법정형)' : kind}** (${list.length}건` +
      (fold.length ? ` — ${open.length}건 펼침 · ${fold.length}건 제목만` : '') + ')' +
      (kind === '처벌' ? '\n※ 법에 정해진 형(법정형)이에요 — 실제 선고형은 사안에 따라 달라져요.' : ''));
    open.forEach((e, i) => out.push(zoneRuleLines(e, i)));
    if (fold.length) out.push(fold.map(zoneRuleFoldedLine).join('\n'));
  });

  for (const ax of (leaf.추가확인 || [])) {
    out.push(`**추가로 갈리는 조건 — ${ax.축}**\n${ax.질문 || ''}\n` +
      `선택지: ${(ax.선택지 || []).map(o => o.label).join(' / ')}\n` +
      `이 조건에 따라 달라지는 항목: ${(ax.영향 || []).join(' · ')}`);
  }
  if (leaf.주의) out.push(`**⚠이 구역에서 주의할 점**: ${leaf.주의}`);
  if (leaf.메모) out.push(`**참고**: ${leaf.메모}`);

  out.push(zoneCoverageNote(rules));
  return out.join('\n\n');
}

// ── 질문 유형(경계형 vs 요건형) — L-84 "물어본 것에만 답한다" ────────────────
// 사용자 지적(2026-08-12): *"어디까지 갈 수 있냐고 물었는데... 물어보지도 않은 것에 대해서
// 대답할 필요는 없는 거야."* 되묻기로 구역을 좁힌 뒤 그 구역에 걸리는 서류·장비·의무 규정을
// 통째로(§13 필터링 후에도 1만 자) 쏟아내던 것을, **경계형 질문에는 경계(그 구역의 정의·범위)와
// 규정 건수만** 답하고 요건은 확인을 거쳐서만 펼치도록 나눈다.
// ★§13(관련도 필터·접기·면책문구 조립)은 **요건형 답변 안에서 그대로** 쓰인다 — 재구현하지 않는다.
//
// ★판정 방법과 그 근거(지어낸 어휘 목록이 아니다):
//  ⓐ **경계형의 정의는 이미 코드에 있다** — 트리 진입 게이트 `ZONE_ASK`(구역 축을 묻는 어미구)가
//     그것이라, zoneTreeStep 에 들어온 질문은 **전부 경계형 어미**를 갖고 있다.
//  ⓑ 그런데 그것만으로는 안 갈린다 — "우리 배에 **구명조끼** 싣고 어디까지 나갈 수 있나요?"처럼
//     경계형 어미 + 요건 어휘가 섞인 질문이 실제로 있다(회귀 스위트 T8이 쓰는 질의가 바로 그것).
//     그래서 **원 질문이 구역 축 어휘 말고 다른 것을 지목했고, 그 말이 이 구역 규정 본문에 실제로
//     나올 때만** 요건형으로 본다. 지목한 말이 규정에 없으면("제주도까지"·"20톤") 경계형이다.
//  ⓒ "구명조끼 몇 개 필요해요?" 같은 **순수 요건형**은 애초에 게이트에 안 걸려 트리로 들어오지도
//     않는다 — 기존대로 위키 검색 흐름으로 간다(이 절이 손대는 것이 없다).
const ZONE_MORE_QUESTION = '이 구역에서 필요한 서류·장비 기준도 알려드릴까요?';
// ⚠라벨은 트리 22개 노드의 `라벨`·`선택지[].label` 어느 것과도 겹치지 않아야 한다(L-77: 화면
//   라벨과 데이터 라벨이 1:1이 아닌 지점에서 결함이 났다). 구역 이름을 한 글자도 포함하지 않는
//   문장으로 두어, 누적된 질의에 붙어도 resolveZoneTreePath 의 경로 복원·암시 하강에 안 걸린다.
const ZONE_MORE_YES = '네, 서류·장비 기준도 알려주세요';
const ZONE_MORE_NO = '아니요, 여기까지면 돼요';

// ── 구역 축 어휘 캐시(질문이 "축 말고 다른 것"을 지목했는지 보는 기준) ──
let _zoneAxisCache = null, _zoneAxisAt = -1;
/**
 * "이 질문은 구역 축 이야기만 하고 있다"를 판정할 때 걸러낼 어휘 목록.
 * **새로 지어내지 않는다** — 게이트가 이미 쓰는 `ZONE_SUBJECT`·`ZONE_ASK`의 낱말과, 자산이 가진
 * 트리 라벨(및 그 라벨을 이루는 낱말)이 전부다.
 * ★`ZONE_ASK`는 어미까지 붙은 **구(句)**라 쪼개면 '수'·'갈'·'있' 같은 한 글자 조각이 나온다 —
 *   그건 뺀다(두면 '수량'·'수산물'처럼 무관한 낱말까지 축 어휘로 잡아먹는다). 반대로 낱말 목록인
 *   `ZONE_SUBJECT`의 '배'는 **그대로 둔다**(빼면 '배로'·'배가'가 요건 지목으로 잘못 잡힌다).
 * @returns {Array<string>} 축 어휘(중복 제거)
 * [연계] ← zoneAskedRequirement(). ← ZONE_SUBJECT·ZONE_ASK·zone_tree.json 라벨.
 */
function zoneAxisWords() {
  const asset = loadZoneTree();
  if (_zoneAxisCache && _zoneAxisAt === _zoneMtime) return _zoneAxisCache;
  const words = ZONE_SUBJECT.concat(ZONE_ASK.join(' ').split(/\s+/).filter(w => w.length >= 2));
  for (const t of (asset.trees || [])) {
    if (!t || !t.tree) continue;
    for (const l of zoneLabelsOf(t.tree)) words.push(l, ...l.split(/[\s·()]+/).filter(Boolean));
  }
  _zoneAxisCache = [...new Set(words)];
  _zoneAxisAt = _zoneMtime;
  return _zoneAxisCache;
}

/**
 * 이 질문이 **요건형**(이 구역에서 무엇을 갖춰야 하나)인가 — 아니면 **경계형**(어디까지 갈 수
 * 있나)인가. 위 ⓑ 그대로: 원 질문에서 구역 축 어휘를 뺀 낱말이 남고, 그 낱말이 이 구역 규정
 * 본문(`zoneRuleHay`)에 실제로 나오면 요건형이다.
 * 예: zoneAskedRequirement(rules, '우리 배 어디까지 갈 수 있나요? — 근해구역') → false(경계형)
 *     zoneAskedRequirement(rules, '구명조끼 싣고 어디까지 나갈 수 있나요? — 평수구역') → true
 *     zoneAskedRequirement(rules, '낚싯배로 제주도까지 갈 수 있나요? — 연해구역') → false('제주도'는 규정에 없다)
 * @param {Array<{rule:object}>} rules - collectZoneRules()의 결과(이 리프에 실린 규정 전량)
 * @param {string} query - 사용자 질의(되묻기 라벨이 누적된 상태일 수 있다 — 원 질문만 본다)
 * @returns {boolean} true면 요건형(바로 §13 전체 답변), false면 경계형(짧은 경계 답변)
 * [연계] ← zoneTreeStep(). ← termsOf()·zoneRuleHay()(§13과 같은 토큰화·같은 검색 대상 문자열).
 */
function zoneAskedRequirement(rules, query) {
  const axis = zoneAxisWords();
  const terms = termsOf(String(query || '').split(CLARIFY_JOINER)[0])
    // ★수치+단위("20톤"·"12미터")는 요건 지목이 아니라 **자기 배를 설명한 조건값**이다 — 게다가
    //   톤수·길이는 이 트리(구역 축)가 아니라 별개 축(E 톤수, L-82)이다. 규정 본문에 그 숫자가
    //   있다고 요건형으로 보면 "20톤 어선인데 어디까지 갈 수 있나요?"가 다시 규정 65건을 받는다.
    .filter(t => !/^\d+(\.\d+)?[가-힣a-zA-Z]{0,3}$/.test(t))
    .filter(t => !axis.some(w => t.startsWith(w) || w.startsWith(t)));
  if (!terms.length) return false;
  const hays = rules.map(e => zoneRuleHay(e.rule));
  return terms.some(t => hays.some(h => h.includes(t)));
}

/**
 * 경계형 답변 뒤에 붙인 확인("서류·장비 기준도 알려드릴까요?")에 사용자가 뭐라 답했는가.
 * 상태는 서버가 들지 않는다 — 기존 되묻기와 **똑같이** 질의 문자열에 누적된 `' — 라벨'` 조각을
 * 본다(새 규약을 만들지 않는다). 대조는 조각 **전체 일치**라, 라벨이 다른 선택지의 부분문자열로
 * 걸리는 L-77류 사고가 생기지 않는다.
 * @param {string} query
 * @returns {'yes'|'no'|null} 아직 안 물었으면 null
 * [연계] ← zoneTreeStep(). ← ai_chat.js pickClarifyOption(`q + ' — ' + label`).
 */
function zoneMoreChoice(query) {
  const segs = String(query || '').split(CLARIFY_JOINER).slice(1).map(s => zoneFlat(s));
  if (segs.includes(zoneFlat(ZONE_MORE_YES))) return 'yes';
  if (segs.includes(zoneFlat(ZONE_MORE_NO))) return 'no';
  return null;
}

/**
 * 경계형 질문에 대한 **짧은 답변** — 물어본 것(그 구역이 어디까지인가)만 답한다.
 * 싣는 것은 셋뿐이다: ①확인한 구역 경로 ②그 구역의 정의(=경계) ③그 구역에 걸리는 규정 **건수**.
 * 규정의 내용(제목·인용·의무)은 **한 건도 싣지 않는다** — 사용자가 "네"를 눌러야 renderZoneAnswer()가
 * 편다. 구역 자체에 붙은 `주의`·`메모`는 경계의 성질을 말하는 것이라 여기 남긴다(예: 먼바다 노드의
 * "해외수역의 범위가 우리 EEZ 바깥 전부와 같지는 않다").
 * ★말미 면책 문구는 renderZoneAnswer()와 **같은 함수**(zoneCoverageNote)를 쓴다 — 건수만 말해도
 *   "그 건수가 전부는 아니다"는 같은 한계가 그대로 적용되고, 문구를 두 벌로 만들면 자산이 바뀔 때
 *   한쪽만 따라간다(L-81 교훈③).
 * ★`offer`로 마지막 한 줄을 가른다 — 확인을 안 낼 때(사용자가 "아니요"를 고른 뒤) "아래에서
 *   눌러 주세요"라고 쓰면 그 자체가 거짓말이 된다(L-83: 렌더러가 자기 동작을 설명하는 문장은
 *   실제 실행된 가지와 1:1이어야 한다).
 * @param {object} tree - trees[] 원소 @param {Array<object>} path - resolveZoneTreePath()의 path
 * @param {Array<{rule:object}>} rules - collectZoneRules()의 결과
 * @param {boolean} offer - 아래에 "서류·장비도 볼까요?" 확인 버튼이 붙는가
 * @returns {string} 답변 본문
 * [연계] ← zoneTreeStep(). → routes/legal.js done.answer → ai_chat.js answerBodyHTML.
 */
function renderZoneBoundaryAnswer(tree, path, rules, offer) {
  const leaf = path[path.length - 1];
  const laws = ((loadZoneTree().summary || {}).laws_in_scope) || 74;
  const byKind = new Map();
  for (const e of rules) byKind.set(e.rule.유형, (byKind.get(e.rule.유형) || 0) + 1);
  const kinds = [...byKind.entries()]
    .sort((a, b) => (ZONE_KIND_ORDER.indexOf(a[0]) + 1 || 99) - (ZONE_KIND_ORDER.indexOf(b[0]) + 1 || 99))
    .map(([k, n]) => `${k === '처벌' ? '처벌(법정형)' : k} ${n}건`).join(' · ');

  // ⚠ 라벨 뒤에 조사를 붙이지 않는다 — 받침 유무로 '이에요/예요'가 갈리는데 라벨은 데이터에서
  //   오고(괄호로 끝나는 것도 있다) 그걸 코드가 맞추려 들면 매번 어색해진다.
  const out = [`쉽게 말하면, 여쭤보신 구역은 **${leaf.라벨}**, 그 범위는 이래요.`];
  out.push(`**확인한 구역**: ${path.map(n => n.라벨).join(' → ')} (${tree.축})`);
  if (leaf.정의) out.push(`**${leaf.라벨}의 범위**: ${leaf.정의}`);
  if (leaf.주의) out.push(`**⚠이 구역에서 주의할 점**: ${leaf.주의}`);
  if (leaf.메모) out.push(`**참고**: ${leaf.메모}`);
  out.push(`이 구역에서 달라지는 규정은 ${laws}개 해양수산 법령 원문에서 확인된 것만 **${rules.length}건**이에요` +
    (kinds ? ` (${kinds}).` : '.') +
    (offer ? ' 여기서는 건수만 알려드렸어요 — 그 내용이 필요하시면 아래에서 골라 주세요.' : ''));
  out.push(zoneCoverageNote(rules));
  return out.join('\n\n');
}

// ★2026-08-14(H-37 §8, 사용자 확정 (사)): 답변 하단의 **신뢰등급 꼬리표를 없앤다.** 화면에는 항상
//   "참고용입니다. 최종 확인은 공식 출처를 확인하세요."가 붙고, 이 트리 답변의 한계(목록이 전부가
//   아니다)는 본문 말미 `zoneCoverageNote()`가 자산에서 조립해 이미 말하고 있다. 빈 문자열이면
//   ai_chat.js:2590이 ' · ' 자체를 안 붙이므로 클라이언트는 한 줄도 안 고친다.
//   ⚠되묻기 중임을 알리는 ZONE_CLARIFY_NOTE 는 **등급이 아니라 UI 상태 표시**라 그대로 둔다.
const ZONE_ANSWER_NOTE = '';
const ZONE_CLARIFY_NOTE = '추가 정보가 필요해요';

/**
 * 이 질문을 해역·항해구역 트리로 처리할 수 있으면 되묻기 또는 최종 답변을 만든다(LLM 0회).
 * **null이면 호출부는 배선 전과 100% 같은 기존 흐름을 탄다** — 이 함수의 가장 중요한 계약이다.
 * 어떤 예외도 밖으로 내보내지 않는다(expandQueryTerms·pickCandidateLaws와 같은 안전폴백 규약).
 * ★2026-08-13(L-84): 리프에 닿았을 때 무엇을 답할지가 **질문 유형**에 따라 갈린다 —
 *   경계형이면 짧은 경계 답변 + "서류·장비 기준도 알려드릴까요?" 확인(zoneAskedRequirement·
 *   renderZoneBoundaryAnswer), 요건형이거나 그 확인에 "네"면 §13 전체 답변(renderZoneAnswer).
 * 예: zoneTreeStep('낚싯배로 제주도까지 갈 수 있나요?')
 *     → {answer:'조건에 따라…', note:'추가 정보가 필요해요', clarify:{question:'그 배의 선박검사증서에 적힌 항해구역이…', options:[…3개]}}
 *     zoneTreeStep('… — 연해구역') → {answer:'쉽게 말하면, 여쭤보신 범위는 **연해구역**이에요…', clarify:{options:[네…/아니요…]}}
 *     zoneTreeStep('… — 연해구역 — 네, 서류·장비 기준도 알려주세요') → {answer:'…규정은 아래 66건이에요…'}
 *     zoneTreeStep('구명조끼 몇 개 필요해요?') → null
 * @param {string} query - 사용자 질의(되묻기 라벨이 누적된 상태일 수 있다)
 * @returns {{answer:string|null, note:string, clarify?:{question:string,options:Array}}|null}
 * [연계] ← routes/legal.js POST /api/legal/ask 의 맨 앞 게이트(search()보다 앞).
 *        → ai_chat.js는 기존 되묻기·답변과 같은 필드만 보므로 클라이언트 변경이 없다.
 */
function zoneTreeStep(query) {
  try {
    const tree = matchZoneTreeTopic(query);
    if (!tree || !tree.tree) return null;
    const { node, path, rest } = resolveZoneTreePath(query, tree);
    if (node.children && node.children.length) {
      const c = clarifyFromZoneTree(tree, node);
      if (!c.needed) return null;
      // ★무한 되묻기 백스톱(결정론적, decideClarify의 "같은 조건 재질문 차단"과 같은 장치):
      //   낼 선택지 라벨이 이미 질의에 있으면 사용자는 그걸 고른 뒤인데 경로 복원이 안 된 것이다 —
      //   같은 질문을 또 던지지 말고 트리를 포기하고 기존 흐름에 넘긴다. 대조 대상은 질의 전체가
      //   아니라 **경로 복원이 안 쓴 부분**(rest)이다 — 방금 고른 '근해구역 이상' 안의 '근해구역'을
      //   "이미 고른 값"으로 오인해 정상 되묻기를 죽이지 않기 위해서다.
      if (c.options.some(o => rest.includes(o.label))) return null;
      return { answer: c.intro, note: ZONE_CLARIFY_NOTE, clarify: { question: c.question, options: c.options } };
    }
    const rules = collectZoneRules(tree, path);
    if (!rules.length) return null;              // 담을 게 없으면 트리가 답할 것이 없다
    // ★L-84 "물어본 것에만 답한다": 경계형 질문("어디까지 갈 수 있나요?")에는 경계만 답하고,
    //   서류·장비 요건은 사용자가 "네"를 눌렀을 때만 편다. 요건형(질문이 규정 내용을 지목한 경우)은
    //   확인 없이 종전대로 바로 편다 — 그때 나오는 답변은 §13 그대로다(바이트 동일).
    const choice = zoneMoreChoice(query);
    if (choice === 'yes' || zoneAskedRequirement(rules, query)) {
      return { answer: renderZoneAnswer(tree, path, rules, query), note: ZONE_ANSWER_NOTE };
    }
    const offer = choice !== 'no';               // "아니요"를 고른 뒤엔 같은 확인을 다시 내지 않는다
    const step = { answer: renderZoneBoundaryAnswer(tree, path, rules, offer), note: ZONE_ANSWER_NOTE };
    if (offer) {
      step.clarify = {
        question: ZONE_MORE_QUESTION,
        options: [
          { label: ZONE_MORE_YES, hint: '이 구역에 걸리는 의무·완화·허가 규정을 근거 조문과 함께 펼쳐 드려요' },
          { label: ZONE_MORE_NO, hint: '' },
        ],
      };
    }
    return step;
  } catch (_) {
    return null;
  }
}

// ============================================================================
// H-37 §4·5·7 — 이해확인 · 상황질문(범위좁히기) · 온디바이스 프로필 확인
// ----------------------------------------------------------------------------
// 설계 전문: `knowledge/legal/_dashboard/H37_understanding_confirm_design.md`
//
// ★이 절의 함수는 전부 신규다 — 위쪽 기존 함수(decideClarify·search·zoneTreeStep 등)는 한 줄도
//   고치지 않았다. 재사용하는 것은 CLARIFY_JOINER·CLARIFY_OPTION_MAX·termsOf·clarifyStr 뿐이다.
// ★맥락은 **질의 문자열이 아니라 요청 바디의 별도 필드**(ctx·profile)로 나른다(설계 §3.1 D안).
//   그래서 `query`가 오늘과 바이트 동일이라 ①decideClarify 라운드 카운트(:703) ②matchZoneTreeTopic
//   의 q0(:1427) ③resolveZoneTreePath 의 rest(:1476) 세 가지가 **원리적으로** 안 오염된다.
// ★서버는 ctx·profile 을 **어떤 파일에도 쓰지 않는다**(설계 §3.3 R1) — 이 요청을 처리하는 동안
//   메모리에서만 읽고 버린다. 프로필은 온디바이스 저장이 계약이다(사용자 확정 (바)).
// ★안전 규약(§3.3 R4): 이 절의 함수는 어떤 예외도 밖으로 내보내지 않는다 — 실패는 "그 단계 없음"
//   (null)이고, 그러면 호출부는 배선 전과 100% 같은 기존 흐름을 탄다.
// ★스위치 3개(understandConfirm·scopeNarrow·profileConfirm)는 **기본 전부 off**로 배포한다
//   (routes/legal.js normConfig). off면 이 절의 모든 함수가 즉시 null/no-op 이다.
// ============================================================================

// ── 프로필 필드(=축) 어휘: `_CHATBOT.md` §1의 기존 필드를 그대로 쓴다(새 어휘를 만들지 않는다) ──
// `길이`만 신규(설계 §7.1) — tonnage_facet.json이 이미 길이 임계값을 갖고 있어 쓰임이 있다.
const PROFILE_FIELDS = ['직군', '선박용도', '톤수', '길이', '어업종류', '면허·자격', '주 조업구역', '야간조업', '관심분야'];
const PROFILE_VALUE_MAX = 40;      // 값 길이 상한(변조 방어 — 프롬프트·화면에 그대로 실린다)
const PROFILE_DECIDED_MAX = PROFILE_FIELDS.length;   // 축 수만큼만(축당 1개)

// ── 이해확인 ──
const UNDERSTAND_MAX_ROUNDS = 3;   // 사용자 확정 (라) "3회 이해 못하면 자체 판단으로 진행"
const UNDERSTAND_STATES = ['none', 'confirmed', 'assumed'];
// ★고정 문구(변형 금지, 설계 §4.4): 프롬프트로 시키지 않고 **서버가 문자열로 붙인다** — 모델이
//   지시를 어길 수 있다는 것은 decideClarify 기준3에서 이미 라이브로 재현됐다.
const ASSUMED_NOTICE = '질문을 정확히 이해하지 못한 채 제가 추정해서 답변드려요 — 아래 내용이 물으신 것과 다르면 다시 말씀해 주세요.';
const UNDERSTAND_NOTE = '질문을 확인하고 있어요';
const PROFILE_NOTE = '저장된 정보를 확인하고 있어요';
const SCOPE_NOTE = '추가 정보가 필요해요';                 // 기존 되묻기와 같은 UI 상태 표시
const UNDERSTAND_YES = '네, 맞아요';
const UNDERSTAND_NO = '아니요, 다시 설명할게요';
const PROFILE_YES = '네, 그 조건으로';
const PROFILE_NO = '아니요, 이번엔 다른 조건이에요';
// 재진술에 법 이야기가 섞였는지 보는 후검사(§4.2) — 근거자료를 아직 안 읽은 단계라 여기서 조문·
// 형량이 나오면 그건 환각이다. 하나라도 걸리면 그 판정을 **버린다**(= 확인하지 않고 통과).
const RESTATE_BAN = /제\s*\d+\s*조|법률|법령|벌금|과태료|징역|「|」|만원/;
// ★실측 발견(2026-08-14, 프로덕션 최종재검증): 발동은 정상인데 재진술이 **대명사를 그대로 둔 채
//   어미만 바꾼** 수준이었다 — "그거 언제까지 해야 돼?" → "그것을 언제까지 해야 하는지 알려주세요."
//   이러면 "네"를 눌러도 스위치 off일 때와 똑같은 흐름이라, 왕복 1회+Gemini 1회만 늘고 얻는 게 없다.
//   프롬프트 기준5로 금지하고, 그래도 지시어가 남아 오면 그 판정을 **버린다**(= 확인 안 하고 통과).
//   ⚠오탐 방향은 안전하다 — '먹이거나'처럼 지시어가 아닌 글자에 걸려도 결과는 "확인을 안 한다"(오늘과 같음).
const RESTATE_DEICTIC = /그것|그거|이것|이거|저것|저거|그걸|이걸|그건|이건/;
// ★실측 발견(2026-08-15, 4차 프로덕션 재검증): 지시어가 아예 없는 "빈칸형" 애매질문도 얕은
//   재진술로 돌아왔다 — "신고해야 하나요?" → "무엇을 신고해야 하는지 알고 싶다". 원 문장에
//   의문사만 끼워 넣은 것이라 사용자가 "네"를 눌러도 얻는 정보가 0이다(RESTATE_DEICTIC과 같은
//   병, 원인만 지시어→빈칸으로 다르다). 프롬프트 기준6으로 금지하고, 그래도 오면 판정을 **버린다**.
// ⚠비용을 정직하게: 이 후검사는 **정당한 재진술도 일부 버린다**(예: "낚시어선에 어떤 서류가
//   필요한지 알고 싶다"는 지시어를 잘 푼 문장인데도 "어떤"에 걸린다). 정확히 가르려면 원 질문과
//   대조해 "새로 들어온 말"이 있는지 봐야 하는데 그건 이번 범위 밖이고, **물러나는 방향은
//   안전하다** — 버리면 오늘과 같은 흐름(기존 되묻기)으로 간다. 발화율은 그만큼 더 낮아진다.
const RESTATE_BLANK = /무엇|무슨|어떤|어느|누구|얼마나/;
// 재진술 원문의 길이 상한 — 카드 문구로 화면에 찍히고, 확인 뒤에는 검색어의 재료가 된다(§17).
// 클라이언트가 되돌려 보내는 값이라 변조가 가능하다는 전제로 길이를 먼저 자른다.
const RESTATE_MAX = 120;

/**
 * 재진술 문자열이 이 단계의 신뢰 규약(§4.2 서버측 후검사 3종)을 지키는지 한 군데서 판정한다.
 * ★한 군데로 모은 이유(2026-08-15 §17): 재진술은 이제 **두 번** 들어온다 — ①모델이 만든 직후
 *   ②사용자가 "네"를 누른 뒤 `ctx.uc.restate`로 되돌아올 때. ②는 클라이언트를 거치므로 변조·재생이
 *   가능하고(설계 §9.1 #17), 그때도 ①과 **같은 기준**으로 다시 걸러야 신뢰 규약이 유지된다(L-77 정신).
 * 예: restateAllowed('구명조끼 비치를 언제까지 해야 하는지 알고 싶다') → 그 문장 그대로
 *     restateAllowed('제32조 위반이면 과태료다') → ''(RESTATE_BAN)
 * @param {*} s - 검사할 값(문자열이 아니면 '')
 * @returns {string} 통과하면 정리된 문자열, 아니면 ''
 * [연계] ← understandConfirmStep(생성 직후) · normalizeAskCtx(되돌아온 값) ·
 *         expandQueryTerms·decideClarify(프롬프트에 싣기 직전 마지막 관문).
 */
function restateAllowed(s) {
  const t = clarifyStr(s, RESTATE_MAX);
  if (!t) return '';
  if (RESTATE_BAN.test(t) || RESTATE_DEICTIC.test(t) || RESTATE_BLANK.test(t)) return '';
  return t;
}

// ★§17 실측 기록 — 재진술 **낱말을 그대로** allTerms 에 얹는 안은 **채택하지 않았다**(왜 그런지를
//   남겨 두지 않으면 다음 사람이 "쉬운 방법이 있는데 왜 안 썼지?" 하고 되풀이한다):
//   ① 재진술은 프롬프트 기준5가 **"질문에 나온 말로만 풀어써라"** 라고 강제한다 → 낱말 관점에서
//      **새 정보가 원리적으로 0**이다. 실측(대표 4건)에서 재진술이 추가한 낱말은 전부 조사 변형
//      (`안전검사를`·`가입을`·`비치를`)이거나 상투어(`알고`·`싶다`·`하는지`)뿐이었다.
//   ② 그런데도 얹으면 termsOf 의 어미절단이 `신고`(위키 1,174쪽 중 51.5%)·`제출`(51.8%) 같은
//      2글자 조각을 만들어 **코퍼스 절반의 점수를 함께 올린다** — `위험물 신고서 … 어디에 내요?`
//      실측에서 상위 15건 중 11건이 교체되고 정작 `위험물 반입 및 하역`이 목록에서 **사라졌다**.
//   ⇒ 재진술이 실제로 가진 정보는 "어느 낱말이 무엇을 가리키는가"라는 **문장 수준**의 것이라,
//     낱말 자루(bag-of-words) 검색이 아니라 **문장을 읽는 두 LLM 호출**에 넘긴다:
//     ⓐ expandQueryTerms(질의확장) — 지시어가 풀린 문장을 보고 **새 법률 용어**를 뽑는다. 그 결과는
//        기존 그대로 allTerms 에 합류하므로 "확장어 합류 지점 한 갈래 추가"라는 목표는 그대로 지킨다.
//     ⓑ decideClarify(되묻기 판단) — 이미 정해진 조건을 다시 묻지 않게 한다.
//   ⚠키 의존이 새로 생기는 것은 아니다: 이해확인 자체가 키 없으면 발동하지 않으므로(fail-open null),
//     `restate` 가 존재한다는 것은 곧 키가 있다는 뜻이다.
// ★실측 발견(2026-08-14, H-37 F3): 8000(8초)으로 두면 QUERY_EXPAND_TIMEOUT_MS(:590 주석)와
//   같은 유형으로 Gemini API가 매 호출 400(Manually set deadline 8s is too short. Minimum
//   allowed deadline is 10s.)으로 거부해 이해확인이 프로덕션에서 한 번도 발동한 적이 없었다
//   (23/23건 확인). API 최소값(10초)에 여유를 둔 12000으로 올린다.
const UNDERSTAND_CONFIG = {
  temperature: 0.1,
  thinkingConfig: { thinkingBudget: 0 },
  responseMimeType: 'application/json',
  httpOptions: { timeout: 12000 },
};

/**
 * 한글 마지막 글자의 **받침(종성) 번호**를 돌려준다(0 = 받침 없음, 8 = ㄹ). 한글이 아니면 -1.
 * 예: hangulFinalIndex('신고') → 0 · hangulFinalIndex('점검') → 16(ㅁ) · hangulFinalIndex('abc') → -1
 * @param {string} s - 검사할 문자열(마지막 글자만 본다)
 * @returns {number} 0..27 이면 한글, -1 이면 한글 아님
 * [연계] → josaEuro. 다른 조사(이/가·은/는)가 필요해지면 같은 값으로 고르면 된다.
 */
function hangulFinalIndex(s) {
  const ch = String(s || '').trim().slice(-1);
  if (!ch) return -1;
  const code = ch.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return -1;
  return (code - 0xAC00) % 28;
}

/**
 * `…로` / `…으로` 를 앞 글자의 받침으로 고른다(받침 없음·ㄹ 받침이면 `로`).
 * ★왜(2026-08-15 4차 재검증 ④): 확인 카드 문구의 조사가 **고정 문자열**이라 재진술 끝 글자에 따라
 *   비문이 났다. 한글이 아니면(숫자·영문으로 끝나면) `로`로 둔다 — 읽는 법을 지어내지 않는다.
 * 예: josaEuro('알고 싶다') → '로' · josaEuro('궁금함') → '으로' · josaEuro('신고할 수 있을') → '로'
 * @param {string} word - 조사 앞에 오는 말
 * @returns {'로'|'으로'}
 * [연계] ← understandConfirmStep(확인 카드 질문 문구).
 */
function josaEuro(word) {
  const f = hangulFinalIndex(word);
  return (f <= 0 || f === 8) ? '로' : '으로';
}

/**
 * 요청 바디의 `ctx`(대기 상태)를 **신뢰하지 않고** 정규화한다 — 클라이언트가 그대로 되돌려 보내는
 * 값이라 변조·재생·구버전이 섞여 올 수 있다(설계 §9.1 #17).
 *  - `uc.rounds`는 0..UNDERSTAND_MAX_ROUNDS 로 clamp, `uc.state`는 열거값만.
 *  - `uc.restate`(§17 신규)는 **`state==='confirmed'`일 때만** 살린다 — 확인받지 않은 재진술을
 *    검색에 쓰면 "사용자가 승인한 뜻"이라는 이 값의 근거가 사라진다. 값 자체도 생성 시점과 **같은
 *    후검사**(restateAllowed: 조문·지시어·빈칸형)를 다시 통과해야 한다(변조·재생 방어).
 *  - `scope`는 **자산(vessel_doc_tree.json)에 실재하는 라벨**만, 깊이는 트리 깊이까지. 하나라도
 *    어긋나면 scope 를 통째로 버린다(지어낸 경로로 검색어를 만들지 않는다).
 *  - `prof.decided[]`는 축당 1개·`axis`는 프로필 필드명만·`use`는 accepted|rejected 만.
 *    `label`이 지금 프로필 값과 다르면 **그 항목만** 버린다(대기 중 프로필 수정 — §9.1 #11·#12).
 * 예: normalizeAskCtx({uc:{rounds:99}}) → {uc:{rounds:3,state:'none',restate:''}, scope:[], prof:{decided:[]}}
 * @param {object} raw - req.body.ctx (없어도 된다)
 * @param {object} profile - normalizeProfile()의 결과(라벨 대조용)
 * @returns {{uc:{rounds:number,state:string}, scope:Array<{axis:string,label:string}>, prof:{decided:Array}}}
 * [연계] ← routes/legal.js POST /api/legal/ask. → understandConfirmStep·scopeNarrowStep·profileConfirmStep.
 */
function normalizeAskCtx(raw, profile) {
  const emptyNu = { rounds: 0, state: 'none', term: '', meaning: '' };
  const empty = { uc: { rounds: 0, state: 'none', restate: '' }, scope: [], prof: { decided: [] }, nu: emptyNu,
    cl: { q: '', labels: [] }, unk: null, topic: '' };
  try {
    const c = (raw && typeof raw === 'object') ? raw : {};
    const uc = (c.uc && typeof c.uc === 'object') ? c.uc : {};
    const rounds = Math.min(UNDERSTAND_MAX_ROUNDS, Math.max(0, parseInt(uc.rounds, 10) || 0));
    const state = UNDERSTAND_STATES.includes(uc.state) ? uc.state : 'none';
    // [§17] 확인된 재진술만 나른다 — 확인 전(state!=='confirmed')이면 값이 있어도 버린다.
    const restate = state === 'confirmed' ? restateAllowed(uc.restate) : '';

    // scope: 자산 라벨과 깊이 검사(상한이 아니라 **데이터 정합성 검사** — 설계 §5.4)
    let scope = Array.isArray(c.scope) ? c.scope.slice(0, vesselTreeDepth()) : [];
    scope = scope.map(s => ({
      axis: clarifyStr(s && s.axis, 40),
      label: clarifyStr(s && s.label, 40),
    })).filter(s => s.axis && s.label);
    if (!vesselScopeValid(scope)) scope = [];

    // prof.decided: 축당 1개 + 지금 프로필 값과 일치하는 것만
    const fields = (profile && profile.fields) || {};
    const seen = new Set();
    const decided = (Array.isArray((c.prof || {}).decided) ? c.prof.decided : [])
      .slice(0, PROFILE_DECIDED_MAX)
      .map(d => ({
        axis: clarifyStr(d && d.axis, 40),
        label: clarifyStr(d && d.label, PROFILE_VALUE_MAX),
        use: (d && (d.use === 'accepted' || d.use === 'rejected')) ? d.use : null,
      }))
      .filter(d => {
        if (!PROFILE_FIELDS.includes(d.axis) || !d.use || seen.has(d.axis)) return false;
        if (!fields[d.axis] || fields[d.axis].v !== d.label) return false;   // 대기 중 프로필이 바뀌었다
        seen.add(d.axis);
        return true;
      });

    // [§4-U] nu(네이버 뜻 확인) 축 — uc 와 **같은 규약**이다: 라운드는 clamp, 상태는 열거값만,
    //   `term`·`meaning` 은 **state==='confirmed' 일 때만** 살린다(확인받지 않은 뜻을 검색에 쓰면
    //   "사용자가 승인한 뜻"이라는 이 값의 근거가 사라진다 — uc.restate 와 같은 이유).
    //   meaning 은 생성 시점과 같은 후검사(naverMeaningAllowed)를 다시 통과해야 한다(변조·재생 방어).
    const nuRaw = (c.nu && typeof c.nu === 'object') ? c.nu : {};
    const nuState = NAVER_STATES.includes(nuRaw.state) ? nuRaw.state : 'none';
    const nuMeaning = nuState === 'confirmed' ? naverMeaningAllowed(nuRaw.meaning) : '';
    const nu = {
      // ★clamp 상한은 NAVER_MAX_ROUNDS 가 아니라 소진값이다(D2): 상한이 재질문 횟수와 같으면
      //   routes 가 찍은 "이 뜻으로도 못 찾았다" 소진 표시가 되돌아올 때 깎여, 같은 말을 또 묻는다.
      rounds: Math.min(NAVER_ROUNDS_SPENT, Math.max(0, parseInt(nuRaw.rounds, 10) || 0)),
      // 뜻이 후검사에서 버려졌으면 확인 상태도 성립하지 않는다(뜻 없는 'confirmed'는 무의미).
      state: nuMeaning ? 'confirmed' : 'none',
      term: nuMeaning ? clarifyStr(nuRaw.term, NAVER_TERM_MAX) : '',
      meaning: nuMeaning,
    };
    // [B6] cl(직전 라운드의 되묻기) — 같은 되묻기를 표현만 바꿔 다시 묻는 것을 막는 데만 쓴다.
    //   서버는 대화 이력을 저장하지 않으므로 이 ctx 채널이 유일한 운반로다(새 저장소를 만들지 않는다).
    const clRaw = (c.cl && typeof c.cl === 'object') ? c.cl : {};
    const cl = {
      q: clarifyStr(clRaw.q, 200),
      labels: (Array.isArray(clRaw.labels) ? clRaw.labels : [])
        .slice(0, CLARIFY_LAST_LABELS_MAX).map(v => clarifyStr(v, 40)).filter(Boolean),
    };
    // [B7] unk(잘 모르겠어요) — **버튼의 data-ctx 로만** 들어온다(ctxNextOf 는 이 축을 안 내보낸다).
    const unkRaw = (c.unk && typeof c.unk === 'object') ? c.unk : {};
    const unkQ = clarifyStr(unkRaw.q, 200);
    const unkO = (Array.isArray(unkRaw.o) ? unkRaw.o : [])
      // +1: decideClarify 가 "방금 물어보신 질문" 확인 후보를 하나 더 얹을 수 있어(최대 11개),
      //     상한을 10으로 두면 그 선택지가 재제시에서 조용히 사라진다.
      .slice(0, CLARIFY_OPTION_MAX + 1)
      .map(o => ({ label: clarifyStr(o && o.label, 40), hint: clarifyStr(o && o.hint, 120) }))
      .filter(o => o.label);
    const unk = (unkQ && unkO.length >= 2)
      ? { r: Math.min(UNKNOWN_MAX_ROUNDS, Math.max(1, parseInt(unkRaw.r, 10) || 1)), q: unkQ, o: unkO }
      : null;

    // [이어서 질문] 직전 답변의 주제(검색 확장어로만 쓴다 — 질의 문자열엔 절대 안 합친다).
    const topic = clarifyStr(c.topic, 60);
    return { uc: { rounds, state, restate }, scope, prof: { decided }, nu, cl, unk, topic };
  } catch (_) {
    return empty;
  }
}

/**
 * 다음 라운드가 이어받을 맥락(`done.ctxNext`, 설계 §3.2)을 만든다 — **정규화를 마친 ctx 그대로**다.
 * ★왜 필요한가(2026-08-14 적대검증 F2): 맥락을 버튼의 `data-ctx`에만 실었더니, 그 뒤에 나온
 *   **ctx 없는 버튼**(기존 되묻기·트리 되묻기)을 누르는 순간 직전 맥락이 통째로 사라졌다 —
 *   프로필로 "네"를 눌러 확정한 축이 지워져 서버가 같은 축을 또 묻는 무한루프가 라이브에서 재현됐다.
 *   응답마다 "지금까지 확정된 맥락"을 함께 보내면, 클라이언트가 그것을 들고 다음 요청에 붙인다.
 * ★비어 있으면 **null** — 호출부가 필드 자체를 안 싣게 해서, ctx·profile 미전송 요청의 done JSON이
 *   오늘과 바이트 동일하다(R0).
 * 예: ctxNextOf({uc:{rounds:0,state:'none'},scope:[],prof:{decided:[]}}) → null
 * @param {object} ctx - normalizeAskCtx()의 결과
 * @returns {null|{uc:object,scope:Array,prof:object}}
 * [연계] ← routes/legal.js(모든 done 응답). → ai_chat.js doSend(lastCtx 로 보관해 다음 요청에 첨부).
 */
function ctxNextOf(ctx) {
  if (!ctx) return null;
  const uc = ctx.uc || { rounds: 0, state: 'none', restate: '' };
  const scope = ctx.scope || [];
  const prof = ctx.prof || { decided: [] };
  // [§4-U] nu 도 같은 규약으로 실어 나른다. 기본값(rounds 0·state none)이면 **필드 자체를 안 넣는다** —
  //   스위치 off 인 오늘의 done JSON 이 바이트 동일해야 하기 때문이다(R0).
  const nu = ctx.nu || { rounds: 0, state: 'none', term: '', meaning: '' };
  const hasNu = nu.rounds > 0 || nu.state !== 'none';
  // [B6] cl(직전 라운드 되묻기)도 같은 규약 — 값이 있을 때만 싣는다(없으면 done JSON 이 오늘과 동일).
  //   ⚠ ctx.unk 는 **여기 절대 싣지 않는다**: ctxNext 로 되돌아오면, 그 다음에 사용자가 평범한
  //     선택지를 눌렀을 때(그 버튼엔 ctx 가 없어 클라가 직전 ctx 를 그대로 보낸다) 서버가 또
  //     "잘 모르겠어요"로 오해해 답변 대신 용어풀이를 반복한다.
  const cl = ctx.cl || { q: '', labels: [] };
  const hasCl = !!cl.q;
  // [이어서 질문] 직전 답변의 주제. 있을 때만 싣는다(없으면 done JSON 이 오늘과 바이트 동일).
  const topic = clarifyStr(ctx.topic, 60);
  const has = uc.rounds > 0 || uc.state !== 'none' || scope.length > 0 || prof.decided.length > 0 || hasNu || hasCl || !!topic;
  if (!has) return null;
  const out = { uc, scope, prof };
  if (hasNu) out.nu = nu;
  if (hasCl) out.cl = cl;
  if (topic) out.topic = topic;
  return out;
}

/**
 * 요청 바디의 `profile`(온디바이스 스냅샷)을 정규화한다. 알려진 필드만, 값·시각은 길이 상한.
 * ★서버는 이 값을 **읽기만** 한다 — 파일·로그·pendingAnswers 어디에도 쓰지 않는다(§3.3 R1).
 * @param {object} raw - req.body.profile
 * @returns {{fields:Object<string,{v:string,at:string}>}} 없으면 {fields:{}}
 * [연계] ← routes/legal.js. → profileConfirmStep(축 대조)·normalizeAskCtx(라벨 대조).
 */
function normalizeProfile(raw) {
  const out = { fields: {} };
  try {
    const f = (raw && raw.fields && typeof raw.fields === 'object') ? raw.fields : {};
    for (const k of PROFILE_FIELDS) {
      const v = clarifyStr(f[k] && f[k].v, PROFILE_VALUE_MAX);
      if (!v) continue;
      out.fields[k] = { v, at: clarifyStr(f[k] && f[k].at, 40) };
    }
  } catch (_) { /* 깨진 프로필은 없는 것으로 — 이 단계가 죽어도 답변은 나가야 한다 */ }
  return out;
}

/**
 * 이 요청에서 "프로필로 이미 확정된" 축의 값 목록(accepted 만).
 * @param {object} ctx - normalizeAskCtx()의 결과
 * @returns {Array<{axis:string,label:string}>}
 * [연계] ← routes/legal.js(검색어 보강·트리 질의 합성).
 */
function profileAcceptedLabels(ctx) {
  return ((ctx && ctx.prof && ctx.prof.decided) || []).filter(d => d.use === 'accepted')
    .map(d => ({ axis: d.axis, label: d.label }));
}

/** zone_tree.json 전 트리의 라벨 집합(트리 질의에 합성해도 되는 값인지 판정용). */
function zoneAllLabels() {
  const out = new Set();
  for (const t of (loadZoneTree().trees || [])) {
    if (!t || !t.tree) continue;
    for (const l of zoneLabelsOf(t.tree)) out.add(zoneFlat(l));
  }
  return out;
}

/**
 * 프로필로 확정된 값 중 **해역 트리가 아는 라벨만** 골라 트리 질의에 합성한다(설계 §7.5-1).
 * 트리는 `query`의 `' — 라벨'` 누적으로만 위치를 복원하므로(resolveZoneTreePath) 다른 운반로가 없다.
 * ⚠요청 바디의 `query`는 그대로 두고 **zoneTreeStep()에 넘기는 지역 변수에서만** 합성한다.
 * ⚠자산에 없는 값(예: 톤수 '9.77톤')은 절대 안 붙인다 — 붙이면 `rest`가 오염돼 암시 하강이 엉뚱한
 *   리프로 내려간다(L-77 계열 사고).
 * 예: zoneQueryWithProfile('어선으로 어디서 조업할 수 있나요?', ctx) → '… — 특정해역'
 * @param {string} query @param {object} ctx - normalizeAskCtx()의 결과
 * @returns {string} 합성할 게 없으면 query 와 **바이트 동일**(R0)
 * [연계] ← routes/legal.js(zoneTreeStep 호출 직전).
 */
function zoneQueryWithProfile(query, ctx) {
  try {
    const labels = zoneAllLabels();
    const add = profileAcceptedLabels(ctx).map(d => d.label).filter(l => labels.has(zoneFlat(l)));
    if (!add.length) return query;
    const have = String(query || '').split(CLARIFY_JOINER).map(zoneFlat);
    const fresh = add.filter(l => !have.includes(zoneFlat(l)));
    return fresh.length ? query + fresh.map(l => CLARIFY_JOINER + l).join('') : query;
  } catch (_) {
    return query;
  }
}

/**
 * ★①이해확인 — 질문이 들어오면 **가장 먼저** 실행한다(사용자 확정 (가)).
 * AI가 **자기 말로 다시 진술**해 맞는지 확인한다(사용자 확정 (나): 원문을 그대로 되풀이하지 않는다).
 * ★이 단계는 기존 되묻기 라운드(`CLARIFY_MAX_ROUNDS`)를 **쓰지 않는다** — 상태를 `query`가 아니라
 *   `ctx.uc`로 나르므로 `query.split(CLARIFY_JOINER).length-1`이 정의상 안 변한다(사용자 확정 (다)).
 * ★3회 백스톱(사용자 확정 (라)): `uc.rounds >= 3`이면 **판정 호출조차 하지 않고**(비용·지연 0)
 *   `{assumed:true}`로 통과시킨다 — 호출부가 최종 답변 첫 줄에 ASSUMED_NOTICE 를 직접 붙인다.
 * ★"물어보지 않은 것에 답하지 않는다"(L-84): 재진술은 **질문의 뜻만** 바꿔 말한다 — 답·조문·수치를
 *   미리 얹으면 그 자체가 환각이다(근거자료를 아직 읽지 않은 단계). 프롬프트로 금지하고, 그래도
 *   섞여 오면 서버가 그 판정을 버린다(RESTATE_BAN).
 * ★대원칙 "정보 이득이 없으면 개입하지 않는다"(2026-08-15, §4.2 재설계): 이 단계는 **실제로
 *   풀어쓴 재진술**을 낼 때만 카드를 낸다. 지시어를 못 풀었거나("그것을 언제까지…"), 원 문장에
 *   의문사만 끼워 넣은 빈칸형이면("무엇을 신고해야 하는지…") 확인해도 얻는 게 0이므로 **통과**한다
 *   (= null). 그러면 뒤 단계의 기존 되묻기(decideClarify·해역트리)가 구체적인 선택지를 주며
 *   되묻는데, 4차 프로덕션 재검증 실측상 그쪽이 이 단계의 되묻기보다 낫다.
 * 예: understandConfirmStep('구명조끼 비치하라던데 그거 언제까지 해야 돼?', {rounds:0,state:'none'}, true)
 *     → {clarify:{question:'저는 「…」로 이해했는데, 맞나요?', options:[네…/아니요…]}, confirmKind:'understand'}
 *     ('그거 얼마야?'처럼 풀어쓸 거리가 없는 질문은 null — 확인하지 않고 기존 흐름으로 보낸다)
 * @param {string} query - 사용자 질문(원문 그대로)
 * @param {{rounds:number,state:string}} uc - normalizeAskCtx().uc
 * @param {boolean} enabled - nariya_config.understandConfirm
 * @returns {Promise<null|{assumed:true}|{answer:string,note:string,clarify:object,confirmKind:string}>}
 * [연계] ← routes/legal.js POST /api/legal/ask 의 **첫 단계**(zoneTreeStep보다 앞).
 *        → ai_chat.js clarifyHTML(기존 버튼 렌더 그대로 — 새 UI 타입을 만들지 않는다).
 */
async function understandConfirmStep(query, uc, enabled) {
  try {
    if (!enabled) return null;
    if (!uc || uc.state === 'confirmed') return null;
    if (uc.state === 'assumed' || uc.rounds >= UNDERSTAND_MAX_ROUNDS) return { assumed: true };
    if (!gemini.hasAnyKey()) return null;                 // 키 없음 = 그냥 통과(fail-open)
    const prompt = `너는 대한민국 해양수산 법령 챗봇의 "질문 이해 판정기"다. 질문에 **답하지 마라.**

[질문]
"${query}"

[대원칙] **확인해서 얻는 게 없으면 clear:true 로 넘어가라.** 이 단계가 물러나도 뒤 단계가 구체적인
선택지를 주며 되묻는다 — 어정쩡한 재진술로 확인하는 것보다 그편이 사용자에게 낫다.

[판단 기준]
1. 이 문장이 무엇을 묻는지 한 가지 뜻으로 읽히면 clear:true.
2. 주어(누가)·대상(무엇을)·행위 중 하나가 빠져 뜻이 둘 이상으로 갈리면 clear:false.
3. ★재진술(restate)에는 법령·조문·수치·결론을 **절대 넣지 마라.** 질문의 뜻만 바꿔 말한다.
   (근거자료를 아직 읽지 않은 단계다 — 여기서 법 이야기를 하면 그게 곧 환각이다)
4. 기준2에 걸렸을 때만 이 기준을 본다(순서가 중요하다).
   - **한 문장으로 다시 말해 뜻을 하나로 좁힐 수 있으면 clear:false** — 그 문장을 restate 에 담아 확인한다.
   - **다시 말해 봐도 뜻이 둘 이상 남아 무엇을 물었는지 고를 수 없으면 clear:true** — 확인해도 얻을 게
     없으니 그냥 넘어간다. (단 "고를 수 없는" 이유가 아래 기준5의 지시어 때문이라면 여기가 아니라 기준5다.
     기준5·기준6이 clear:true 로 보내는 경우도 결국 이 갈래와 같은 뜻이다 — 대원칙 그대로다)
   "애매하니까 일단 clear:true"가 아니다(애매한지는 기준2가 이미 판정했다). 판단 기준은
   **재진술로 뜻이 하나로 정해지는가** 하나뿐이다.
5. ★기준4보다 **먼저** 본다 — 질문에 지시어("그거·그것·이거·이것·저거·그건·이건" 같은 말)가 있으면
   기준4의 두 갈래 대신 이 기준으로 판정한다(기준1로 이미 clear:true 인 질문은 여기 오지 않는다).
   기준4의 "뜻을 하나로 좁혔다"는 **그 지시어가 가리키는 것을 실제 이름으로 바꿔 쓴 경우만** 해당한다.
   - ★가리키는 것이 **질문 문장 안에** 있으면(앞 절에 이미 나왔거나, " — " 뒤에 이전 선택 항목이
     붙어 있으면) **반드시** 그 이름으로 **풀어써서** restate 에 담아라 → clear:false.
     **앞 절에 명사구가 있는데도 "확실하지 않다"며 물러나지 마라 — 앞 절의 그 명사구가 곧 답이다.**
     후보가 둘 이상이면 **지시어에 가장 가까운 명사구**를 고른다(고민하지 말고 그렇게 정한다).
     예1 "구명조끼 비치하라던데 그거 언제까지 해야 돼?"
       → restate "구명조끼 비치를 언제까지 해야 하는지 알고 싶다"
     예2 "안전점검 받으라고 문자 왔는데 그거 안 하면 어떻게 돼요?"
       → restate "안전점검을 받지 않으면 어떻게 되는지 알고 싶다"
     예3 "어선검사 — 정기검사 그건 언제 받아야 해요?"
       → restate "어선 정기검사를 언제 받아야 하는지 알고 싶다"
     예4 "위판장에서 신고하라던데 이거 온라인으로도 돼요?"
       → restate "위판장 신고를 온라인으로 할 수 있는지 알고 싶다"
   - 질문 안에 가리키는 것이 **정말로 없으면**(앞 절에 명사구가 하나도 없다) **짐작해서 지어내지 말고**
     그냥 clear:true 로 넘어가라. 예: "그거 얼마예요?" → {"clear":true}
   - ★지시어를 **그대로 둔 채** 어미·문장 구조만 바꾼 문장은 restate 로 쓰지 마라
     ("그것을 언제까지 해야 하는지 알려주세요" 같은 문장) — 뜻이 하나도 안 좁혀져 확인할 값이 없다.
     그런 문장밖에 안 나오면 restate 를 쓰지 말고 clear:true 다.
   - 풀어쓸 때도 기준3은 그대로다: **질문에 나온 말로만** 풀어쓰고 법령 이름·조문·수치를 새로 끌어오지 마라.
6. ★"빈칸형" 재진술 금지(기준4·기준5의 clear:true 갈래와 같은 결론이다) — 원 질문에 의문사
   ("무엇을·무슨·어떤·어느·누구의·얼마나")만 끼워 넣은 문장은 restate 로 쓰지 마라. 원문에 없던
   정보가 하나도 안 늘어 확인할 값이 없다. 그런 문장밖에 안 나오면 clear:true 다.
     금지 예 "신고해야 하나요?" → "무엇을 신고해야 하는지 알고 싶다" (❌ 이건 clear:true 로 낸다)
     금지 예 "허가 받아야 돼요?" → "어떤 허가를 받아야 하는지 알고 싶다" (❌ 마찬가지)
   restate 는 **질문에 이미 적혀 있던 말**을 써서 뜻을 좁힌 문장이어야 한다(기준5의 예1~4처럼).

다른 설명 없이 아래 JSON만 출력하라.
{"clear":true} 또는 {"clear":false,"restate":"…(60자 이내, 평서문)"}`;
    const result = await gemini.callGemini({
      model: ANSWER_MODEL, contents: prompt, config: UNDERSTAND_CONFIG, caller: 'Legal-Understand',
    });
    if (!result.success || !result.text) return null;
    const m = result.text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    if (!obj || obj.clear !== false) return null;
    // 서버측 후검사 3종(§4.2) — 조문·형량이 섞였거나(RESTATE_BAN), 지시어를 그대로 둔 채 어미만
    // 바꿨거나(RESTATE_DEICTIC, 기준5), 의문사만 끼워 넣은 빈칸형(RESTATE_BLANK, 기준6)이면 그
    // 판정을 **버린다**(= 확인하지 않고 기존 흐름으로 통과). 한 군데(restateAllowed)로 모아 둔 이유는
    // 사용자가 "네"를 눌러 되돌아온 값도 §17에서 **같은 기준**으로 다시 걸러야 하기 때문이다.
    const restate = restateAllowed(obj.restate);
    if (!restate) return null;
    // 원 질문을 그대로 되풀이하면 확인의 의미가 없다(사용자 확정 (나)) — 같은 문장이면 물러난다.
    if (zoneFlat(restate) === zoneFlat(query)) return null;
    // ctx: 클라이언트가 **질의에 아무것도 붙이지 않고** 이 값만 되돌려 보낸다(§3.2 ctxNext).
    // [§17] "네"에는 재진술 원문을 함께 싣는다 — 사용자가 승인한 그 문장이 다음 요청에서 검색
    //   확장어가 된다(`search(opts.restate)`). "아니요"에는 싣지 않는다(승인받지 못한 뜻이다).
    const yes = { label: UNDERSTAND_YES, hint: '이 뜻이 맞으면 그대로 답변을 만들어 드려요',
      ctx: { uc: { rounds: uc.rounds, state: 'confirmed', restate } } };
    const no = { label: UNDERSTAND_NO, hint: '어떤 상황인지 조금 더 구체적으로 적어 주세요',
      ctx: { uc: { rounds: uc.rounds + 1, state: 'none' } }, act: 'ask' };
    return {
      answer: '제가 이해한 게 맞는지 먼저 확인할게요.',
      note: UNDERSTAND_NOTE,
      confirmKind: 'understand',
      clarify: {
        // 조사는 재진술 끝 글자의 받침으로 고른다(2026-08-15 ④ — 고정 문자열이면 비문이 난다).
        question: `저는 「${restate}」${josaEuro(restate)} 이해했는데, 맞나요?`,
        options: [yes, no],
      },
    };
  } catch (_) {
    return null;
  }
}

// ── ②상황질문(범위좁히기) — 선택지는 **기존 계층자산의 분기 노드**에서 그대로 꺼낸다(설계 §5.2 S1) ──
// ★법 이름을 묻지 않는다(사용자 확정 (마)): 묻는 것은 사용자가 아는 상황("어떤 배에 관한 것인가요?")
//   이고, 그 답으로 어느 법을 볼지는 서버가 정한다.
// ★발화 판정은 **검색 뒤**(사용자 확정 (카), R2) — 검색 결과가 실제로 여러 갈래에 걸릴 때만 묻는다.
//   검색은 사용자에게 아무것도 보여주지 않는 내부 계산이라, 화면상으로는 여전히 "맨 앞에서 상황을
//   묻는" 동작이다.
const VESSEL_TREE_JSON = path.join(LEGAL_DIR, '_dashboard', 'vessel_doc_tree.json');
// 임계값은 **지어내지 않고 실측으로 정했다**(설계 §5.3 "구현 착수 시 실측해 정한다"):
// 감사 문항 코퍼스(_dashboard/audit/*.md 인용 질문 6,543건) 중 800건 표본으로 격자 측정 —
// 대조 대상(항목 전문/이름 필드) × 토큰 최소길이(2/3/4) × K(3/5/8) × 접전비율(0.3/0.5/0.7).
// 채택값의 발화율 1.63%(13/800), 설계 §5.6의 대표 시나리오("구명조끼 몇 개 필요해요?")는 그대로 발화.
const SCOPE_TOPK = 5;              // 분포를 볼 상위 검색결과 수
const SCOPE_SCORE_RATIO = 0.5;     // 1위 대비 이 비율 이상인 후보만 "접전"으로 본다
const SCOPE_TERM_MIN = 3;          // 분기 대조에 쓸 질문 토큰의 최소 글자수
let _vesselCache = null, _vesselMtime = 0;
const INSPECTION_TABLE_JSON = path.join(LEGAL_DIR, '_dashboard', 'inspection_cycle_table.json');
let _inspCache = null, _inspMtime = 0;

/**
 * inspection_cycle_table.json(F) 을 읽어 캐시한다(vessel_doc_tree 와 같은 mtime 감지·안전폴백).
 * `vesselHayOf`가 ⓑ 게이트 어휘원에 F의 검사종류·증서 이름을 얹기 위해 쓴다
 * (설계 H32_vessel_doc_tree_design.md §14 — D 이름 필드만으론 "안전검사" 계열 질문이 안 걸리던 문제).
 */
function loadInspectionTable() {
  try {
    const mt = fs.statSync(INSPECTION_TABLE_JSON).mtimeMs;
    if (_inspCache && mt === _inspMtime) return _inspCache;
    const raw = JSON.parse(fs.readFileSync(INSPECTION_TABLE_JSON, 'utf8'));
    raw._certById = new Map((raw.증서 || []).map(c => [c.id, c.증서명]));
    _inspCache = raw; _inspMtime = mt;
  } catch (_) { if (!_inspCache) _inspCache = { 검사종류: [], 증서: [], _certById: new Map() }; }
  return _inspCache;
}

/** vessel_doc_tree.json 을 읽어 캐시한다(zone_tree 와 같은 mtime 감지·안전폴백). */
function loadVesselTree() {
  try {
    const mt = fs.statSync(VESSEL_TREE_JSON).mtimeMs;
    if (_vesselCache && mt === _vesselMtime) return _vesselCache;
    _vesselCache = JSON.parse(fs.readFileSync(VESSEL_TREE_JSON, 'utf8')); _vesselMtime = mt;
  } catch (_) { if (!_vesselCache) _vesselCache = { tree: null }; }
  return _vesselCache;
}

/** 자산 트리의 최대 깊이(=`ctx.scope` 배열이 가질 수 있는 최대 길이). */
function vesselTreeDepth() {
  const root = loadVesselTree().tree;
  return root ? (function d(n) {
    return 1 + Math.max(0, ...(n.children || []).map(d));
  })(root) - 1 : 0;
}

/**
 * `ctx.scope` 경로를 자산 트리로 따라 내려가 지금 노드를 잡는다.
 * @param {Array<{axis:string,label:string}>} scope
 * @returns {object|null} 경로가 자산과 안 맞으면 null(= 그 scope 는 무효)
 */
function vesselNodeAt(scope) {
  let node = loadVesselTree().tree;
  if (!node) return null;
  for (const s of (scope || [])) {
    const opt = (node.선택지 || []).find(o => o && o.label === s.label);
    const child = opt && (node.children || []).find(c => c && c.id === opt.next);
    if (!child || node.id !== s.axis) return null;
    node = child;
  }
  return node;
}

/** `ctx.scope`가 자산에 실재하는 경로인가(변조 방어 — normalizeAskCtx에서 쓴다). */
function vesselScopeValid(scope) {
  return !scope.length || !!vesselNodeAt(scope);
}

/** 이 노드의 서브트리가 근거로 삼는 법령 이름 집합(서류·장비·보험·provenance 전부). */
function vesselLawsOf(node) {
  const out = new Set();
  (function walk(n) {
    if (!n) return;
    for (const key of ['서류', '장비', '보험']) for (const e of (n[key] || [])) if (e && e.근거법령) out.add(e.근거법령);
    for (const p of (n.provenance || [])) if (p && p.법령) out.add(p.법령);
    for (const c of (n.children || [])) walk(c);
  })(node);
  return out;
}

/**
 * 이 노드의 서브트리에서 **질문어를 찾을 대상 문자열** — 항목의 **이름 필드만** 모은다
 * (§13 `zoneRuleHay`와 같은 성격이되 대상이 훨씬 좁다).
 * ★인용·조건 원문까지 넣으면 안 된다(실측): 그 블록이 워낙 커서 '검사'·'허가' 같은 흔한 낱말이
 *   세 분기 모두에 들어 있고, 그러면 배 종류와 아무 상관없는 질문(농산물 검사수수료·해적 보험)까지
 *   전부 "분기마다 다르다"고 잡힌다 — 표본 800건 발화율 17.1%(전문) → 1.6%(이름 필드).
 *   ★"구명조끼 몇 개 필요해요?"는 이름 필드만으로도 세 분기에 전부 걸린다(설계 §5.6 시나리오 보존).
 * ★F(`inspection_cycle_table.json`)의 검사종류·증서 이름도 더한다(설계 §14) — "안전검사 안 받으면
 *   어떻게 되나요?" 같은 질문은 D(서류·장비·보험 이름)엔 안 걸리지만 F엔 "안전검사"가 리터럴로
 *   있다. `대상_트리노드`가 이 노드 id와 같은 항목만 더하고, `검사군`의 끝에 붙은 법령명 괄호는
 *   반드시 뗀다 — 안 떼면 검사와 무관한데 법 이름만 겹치는 질문이 오발화한다(실측 3건, 예: "국제
 *   항해선박 해적피해예방법 … 벌칙" ← `국제항해선박`이 선박보안심사 검사군에 들어 있었음).
 * @param {object} node @returns {string}
 * [연계] ← scopeNarrowStep(발화 판정 ⓑ). ← loadInspectionTable(F).
 */
function vesselHayOf(node) {
  const parts = [];
  const insp = loadInspectionTable();
  (function walk(n) {
    if (!n) return;
    for (const e of (n.서류 || [])) parts.push(e.서류명 || '');
    for (const e of (n.장비 || [])) parts.push(e.장비명 || '');
    for (const e of (n.보험 || [])) parts.push(e.보험명 || e.종류 || e.보험종류 || '');
    for (const c of (insp.검사종류 || [])) {
      if (c.대상_트리노드 !== n.id) continue;
      parts.push(c.검사종류 || '');
      parts.push(String(c.검사군 || '').replace(/\s*\([^)]*\)\s*$/, ''));
      if (c.증서id) parts.push(insp._certById.get(c.증서id) || '');
    }
    for (const c of (n.children || [])) walk(c);
  })(node);
  return parts.filter(Boolean).join(' ');
}

/**
 * ★②상황질문 — 검색 결과가 여러 갈래(선박 종류)에 걸칠 때, **법 이름이 아니라 상황**을 묻는다.
 * 발화 조건(전부 결정론적 — AI 호출 0회):
 *  ⓐ 지금 노드에 `질문`+`선택지`가 2개 이상 있다(자산이 정한 갈림길).
 *  ⓑ ★**질문이 지목한 말이 서로 다른 분기 2개 이상의 항목에 실제로 있다** — `termsOf()`로 원 질문을
 *     토큰화해 각 분기의 항목 본문(`vesselHayOf`)과 대조한다(§13·§14가 쓰는 바로 그 방법의 재사용).
 *  ⓒ 검색 상위 SCOPE_TOPK건 중 1위 대비 SCOPE_SCORE_RATIO 이상인 "접전" 후보의 법이 **서로 다른
 *     선택지 2개 이상**을 가리킨다(설계 §5.3 R2). 두 개 이상의 선택지가 함께 쓰는 법은 **변별력이
 *     0이라 세지 않는다** — "각 선택지에 매핑된 법 집합이 서로 겹치지 않을 때"를 이렇게 구현했다.
 *  ⓓ 질문이 이미 그 갈래를 말했으면(라벨이 질의에 문자 그대로 있으면) 묻지 않는다 —
 *     `decideClarify:763`·`zoneTreeStep`의 "같은 조건 재질문 차단"과 같은 결정론적 장치.
 * 하나라도 아니면 null → 호출부는 기존 흐름(되묻기 판단 → 답변) 그대로.
 * ★ⓑ를 설계(§5.3 R2)에 **추가**한 이유(실측): ⓒ만으로는 감사 문항 표본 800건에서 발화율이
 *   8.6~36.9%였고, 표본을 읽어 보니 대부분 *"검색이 두 계열의 법을 함께 물어왔을 뿐, 답이 배 종류에
 *   따라 갈리지는 않는"* 질문이었다(예: "해적한테 짐 뺏기면 보험으로 다 돌려받아요?"). 상황질문은
 *   답이 실제로 갈릴 때만 물어야 한다(L-84 "물어보지 않은 것에 답하지 않는다"의 역방향 — 물을
 *   자격이 없으면 묻지도 않는다). ⓑ를 더한 뒤 같은 표본에서 발화율은 §5.3 표 참조.
 * ★깊이 상한을 인위로 두지 않는다 — 자산 트리 깊이가 곧 유한한 상한이다(설계 §5.4).
 * 예: scopeNarrowStep('구명조끼 몇 개 필요해요?', [], sources, true)
 *     → {clarify:{question:'어떤 배에 관한 것인가요?', options:[어선/수상레저기구/그 밖의 선박]}}
 * @param {string} query - 사용자 질문(이 함수는 질의를 **고치지 않는다**)
 * @param {Array<{axis:string,label:string}>} scope - ctx.scope(이미 고른 갈래)
 * @param {Array<{law:string,score:number}>} sources - search()의 sources
 * @param {boolean} enabled - nariya_config.scopeNarrow
 * @returns {null|{answer:string,note:string,clarify:object,confirmKind:string}}
 * [연계] ← routes/legal.js(zoneTreeStep이 null이고 search() 직후). → ai_chat.js clarifyHTML.
 */
function scopeNarrowStep(query, scope, sources, enabled) {
  try {
    if (!enabled) return null;
    const node = vesselNodeAt(scope || []);
    if (!node || !node.질문) return null;
    const opts = (node.선택지 || []).filter(o => o && o.label).slice(0, CLARIFY_OPTION_MAX);
    if (opts.length < 2) return null;
    const q0 = String(query || '').split(CLARIFY_JOINER)[0];
    const kids = opts.map(o => (node.children || []).find(c => c && c.id === o.next) || null);
    if (kids.some(c => !c)) return null;
    if (opts.some(o => q0.includes(o.label))) return null;                       // ⓓ 이미 말했다

    // ⓑ 질문이 지목한 말이 서로 다른 분기 2개 이상의 항목에 실제로 있는가.
    //   ★두 글자 토큰은 뺀다(실측 발화율 7.9% → 1.6%) — '보험'·'검사'처럼 어디에나 있는 낱말이
    //     세 분기에 다 걸려 배 종류와 무관한 질문까지 잡는다. 세 글자면 '소화기'·'구명줄'은 남는다.
    const terms = termsOf(q0).filter(t => t.length >= SCOPE_TERM_MIN);
    if (!terms.length) return null;
    const hays = kids.map(vesselHayOf);
    const said = new Set();
    hays.forEach((h, i) => { if (terms.some(t => h.includes(t))) said.add(i); });
    if (said.size < 2) return null;

    // ⓒ 검색 결과의 분포(설계 §5.3 R2): 상위 접전 후보가 **서로 다른 법 2개 이상**이어야 하고,
    //    그 후보들이 **이미 한 갈래로 확정돼 있으면 묻지 않는다**.
    const list = (sources || []).filter(s => s && s.law);
    if (!list.length) return null;
    const top = list[0].score || 0;
    const laws = new Set(list.slice(0, SCOPE_TOPK)
      .filter(s => !top || (s.score || 0) >= top * SCOPE_SCORE_RATIO).map(s => s.law));
    if (laws.size < 2) return null;
    // 각 법이 어느 선택지에 속하는지 — 두 곳 이상에 속하는 법(-1)은 변별력이 없다.
    const owner = new Map();
    kids.forEach((child, i) => {
      for (const law of vesselLawsOf(child)) owner.set(law, owner.has(law) ? -1 : i);
    });
    const pinned = new Set(); let unknown = 0;
    for (const law of laws) { const i = owner.get(law); if (i >= 0) pinned.add(i); else if (i === undefined) unknown++; }
    if (pinned.size === 1 && !unknown) return null;   // 검색이 이미 한 갈래를 지목했다 → 물을 게 없다

    const scopeNext = (scope || []).concat();
    return {
      answer: (scope && scope.length) ? '조금만 더 좁혀 볼게요.' : '어느 쪽인지에 따라 답이 갈려서, 하나만 여쭤볼게요.',
      note: SCOPE_NOTE,
      confirmKind: 'scope',
      clarify: {
        question: clarifyStr(node.질문, 200),
        options: opts.map(o => ({
          label: clarifyStr(o.label, 40), hint: clarifyStr(o.hint, 120),
          ctx: { scope: scopeNext.concat([{ axis: node.id, label: o.label }]) },
        })),
      },
    };
  } catch (_) {
    return null;
  }
}

/**
 * ★③프로필 확인 — 저장된 프로필이 이 되묻기의 축을 이미 알고 있으면, 되묻는 대신 **그 조건으로
 * 답해도 되는지**를 먼저 확인한다(사용자 확정 (아)). 새 판단기를 만들지 않고 **되묻기 결과를
 * 가로채는 후처리**라, `decideClarify()`(위키)와 `clarifyFromZoneTree()`(트리)의 반환 스키마가
 * 같아서 **양쪽 경로에 같은 함수 하나로** 걸린다(사용자 확정 (차), 설계 §7.5).
 * ★확인은 **축(조건) 단위**다(사용자 확정 (자) *"3번은 따로 확인해야해"*) — 한 번의 "네"가 그
 *   질문의 다른 미확정 조건까지 확정시키지 않는다. 그래서 반환값이 축 하나에 대한 결정뿐이다.
 * ★일치 판정은 **완전일치/포함만** 쓴다(의미 유사도·AI 판정 금지) — 오탐이 나면 *사용자가 말하지
 *   않은 조건으로 답이 확정된다*(되돌릴 수 없는 방향의 오류).
 * 반환 mode:
 *   'as-is'   기존 되묻기를 그대로 낸다(프로필이 모르는 축이거나, 이번엔 프로필을 쓰지 말라고 했다)
 *   'confirm' 되묻기를 **확인 카드로 치환**한다(step)
 *   'drop'    이미 "네"로 확정한 축을 또 묻고 있다 → 그 되묻기를 버리고 답변으로 간다(§9.1 #21 백스톱)
 * 예: profileConfirmStep({needed:true,options:[{label:'낚시어선'},{label:'일반어선'}]},
 *       {fields:{선박용도:{v:'낚시어선',at:'2026-07-30T09:04:00+09:00'}}}, {decided:[]}, true)
 *     → {mode:'confirm', step:{clarify:{question:'저장된 정보로는 **낚시어선**이신 것 같아요(2026-07-30 저장). …'}}}
 * @param {{needed:boolean,options?:Array<{label:string}>}} clarify - decideClarify/clarifyFromZoneTree 결과
 * @param {object} profile - normalizeProfile()의 결과
 * @param {{decided:Array}} prof - normalizeAskCtx().prof
 * @param {boolean} enabled - nariya_config.profileConfirm
 * @returns {{mode:'as-is'}|{mode:'drop'}|{mode:'confirm', step:object}}
 * [연계] ← routes/legal.js(위키 되묻기·트리 되묻기 **양쪽**). → ai_chat.js clarifyHTML.
 */
function profileConfirmStep(clarify, profile, prof, enabled) {
  const asIs = { mode: 'as-is' };
  try {
    if (!enabled || !clarify || !clarify.needed) return asIs;
    const fields = (profile && profile.fields) || {};
    const options = (clarify.options || []).filter(o => o && o.label);
    if (!options.length) return asIs;
    // 축 판정: 프로필 값이 선택지 라벨과 **완전일치**하는 필드.
    // ★2026-08-14(적대검증 F4) 부분일치(포함)를 걷어냈다 — 실사용 값으로 오탐이 재현됐다:
    //   야간조업 "예" × 선택지 '예인선·부선' / 선박용도 "일반" × 선택지 '일반해역'.
    //   둘 다 *사용자가 말하지 않은 조건으로 답이 확정되는* 방향의 오류라(되돌릴 수 없다) 최소
    //   길이 제한으로는 부족하다("일반"은 2자인데도 '일반해역'에 걸린다).
    //   ⚠대가(정직 기록): 값이 라벨과 글자까지 같아야 하므로 톤수·길이처럼 자유 입력 축은 사실상
    //     발동하지 않는다. 안 물어보는 쪽이 아니라 **평소대로 되묻는 쪽**으로 물러나는 것이라 안전하다.
    let axis = null, value = null;
    for (const k of PROFILE_FIELDS) {
      const v = fields[k] && fields[k].v;
      if (!v) continue;
      if (options.some(o => o.label === v)) { axis = k; value = v; break; }
    }
    if (!axis) return asIs;
    const decided = ((prof && prof.decided) || []).find(d => d.axis === axis);
    if (decided && decided.use === 'rejected') return asIs;       // 이번엔 프로필 무시
    if (decided && decided.use === 'accepted') return { mode: 'drop' };  // 확정한 축을 또 묻는다 → 폐기
    const at = String((fields[axis] || {}).at || '').slice(0, 10);
    const keep = ((prof && prof.decided) || []).map(d => ({ axis: d.axis, label: d.label, use: d.use }));
    return {
      mode: 'confirm',
      step: {
        answer: '저장해두신 정보가 있어서 먼저 확인할게요.',
        note: PROFILE_NOTE,
        confirmKind: 'profile',
        clarify: {
          // ⚠`**굵게**`를 쓰지 않는다 — 되묻기 질문은 클라이언트가 `esc()`로만 그린다(answerBodyHTML을
          //   안 거친다) 라 별표가 화면에 그대로 찍힌다(설계 §7.4.2 예시 문구 대비 변경점, 사람 정독에서 발견).
          question: `저장된 정보로는 "${value}"이신 것 같아요${at ? `(${at} 저장)` : ''}. 이 조건으로 답변드릴까요?`,
          options: [
            { label: PROFILE_YES, hint: '저장된 조건으로 답변을 만들어 드려요',
              ctx: { prof: { decided: keep.concat([{ axis, label: value, use: 'accepted' }]) } } },
            { label: PROFILE_NO, hint: '이번 질문에서만 저장된 정보를 쓰지 않아요(저장된 정보는 그대로 둡니다)',
              ctx: { prof: { decided: keep.concat([{ axis, label: value, use: 'rejected' }]) } } },
          ],
        },
      },
    };
  } catch (_) {
    return asIs;
  }
}

// ============================================================================
// §4-U 모르는 구어 해소 — 네이버 검색으로 "이 말이 무슨 뜻인지"만 확인한다
// ----------------------------------------------------------------------------
// ★설계 전문: `knowledge/legal/_dashboard/NAVER_GUEO_PENDING_MERGE.md` §4(4-1~4-9).
// ★불변식(`_CHATBOT.md` §4-U): 웹 검색 결과는 **뜻 확인용**이다 — 조문·처벌·금액을 여기서
//   가져오지 않는다(그건 언제나 위키/raw 원문 몫). 그래서 이 절이 밖으로 내보내는 값은
//   "사용자가 맞다고 확인해 준 낱말의 뜻" 한 조각뿐이고, 그 조각은 답변에 인용되지 않고
//   **검색어를 보강하는 데만** 쓰인다(routes/legal.js 의 qForSearch·searchRawFallback 질의).
// ★발동 지점: 위키 검색(1차)도 원문 직독(2차 searchRawFallback)도 전부 빈손일 때 — 지금까지
//   "이 질문에 맞는 근거를 위키에서 찾지 못했습니다"로 끝나던 바로 그 자리 하나뿐이다.
//   (searchRawFallback 이 빈손이 되는 실제 원인의 대부분이 pickCandidateLaws 의 빈 배열이다 —
//    AI가 낱말 자체를 못 알아들으니 읽을 법도 못 고른다.)
// ★안전 규약(§3.3 R4 그대로): 이 절의 함수는 어떤 예외도 밖으로 내보내지 않는다 — 실패는
//   "그 단계 없음"(null)이고, 그러면 호출부는 배선 전과 100% 같은 기존 흐름을 탄다.
// ★스위치: `nariya_config.naverTermLookup`, **2026-08-16부터 기본 true**(사용자 확정, 관리자가
//   명시적으로 false를 보내야 꺼짐 — 킬스위치는 유지). routes/legal.js normConfig 참고.
// ============================================================================

// §4-6 ② "재질문 딱 1회". ★이 값의 뜻은 **"사용자에게 더 설명해 달라고 되묻는 횟수의 상한"**이지
//   "검색 시도 횟수"가 아니다 — 2026-08-16 적대검증 D2에서 이 둘을 혼동한 탓에 재질문 카드를 띄운
//   바로 다음 턴(rounds=1)이 곧장 ③포기로 떨어져, **사용자가 애써 쓴 설명으로 다시 찾아보는 일이
//   한 번도 일어나지 않았다.** 그래서 "검색은 rounds ≤ 상한인 동안 한다 / 포기는 상한을 넘었을 때
//   또는 상한 회차의 검색까지 실패했을 때"로 판정을 갈랐다(naverTermStep 참고).
const NAVER_MAX_ROUNDS = 1;
// 라운드 축의 실제 상한값(=소진 표시). routes 가 "확인된 뜻으로도 못 찾았다"를 표시할 때, 그리고
// naverTermStep 이 마지막 검색까지 실패했을 때 이 값이 된다 — 이 값이면 검색 없이 곧장 포기다.
// ctx clamp(normalizeAskCtx)도 이 값까지 허용해야 소진 표시가 되돌아올 때 살아남는다(D2 수정 일부).
const NAVER_ROUNDS_SPENT = NAVER_MAX_ROUNDS + 1;
const NAVER_STATES = ['none', 'confirmed'];
const NAVER_TERM_MAX = 20;         // ctx로 왕복하는 낱말 길이 상한(변조 방어)
const NAVER_MEANING_MAX = 40;      // 확인받은 뜻(검색어 재료가 된다) 길이 상한
const NAVER_CAND_MAX = 12;         // Gemini에 보여줄 검색결과 후보 수
const NAVER_NOTE = '모르는 말을 확인하고 있어요';
const NAVER_YES = '네, 맞아요';
const NAVER_NO = '아니요, 다시 설명할게요';
const NAVER_RETRY = '다시 설명할게요';
// ③ 막다른 길로 끝내지 않는다(§4-6 ③) — "왜 못 찾았는지 + 다음에 무엇을 하면 되는지".
const NAVER_GIVEUP = '말씀하신 표현이 무엇을 뜻하는지 끝내 확인하지 못해, 지어내지 않고 여기서 멈춥니다. 다른 이름(정식 명칭·비슷한 말)으로 다시 말씀해 주시거나, 어떤 상황·장비에서 쓰는 말인지 설명해 주시면 다시 찾아보겠습니다.';
// ★2026-08-16 적대검증 D4 수정 — **조사와 어미를 갈랐다**(이게 오탐의 진짜 원인이었다).
//   실제 질문 10개 중 6개가 오탐이었는데("초과하면"·"입으면"·"어디까지"·"알려주세요"·"얼마나"·
//   "얼마인가요"), 전부 한 갈래로 설명된다: **우리가 찾는 "모르는 구어"는 언제나 명사이고 명사에는
//   조사가 붙는다("깔때기가"·"뽀짝이가"). 어미가 붙은 말은 동사·형용사라 애초에 찾을 대상이 아니다.**
//   예전에는 둘을 한 목록에 섞어 두고 "떼고 남은 줄기가 1글자면 동사"라는 간접 신호로 걸렀는데,
//   줄기가 2글자인 동사("초과하면"→초과, "나오나요"→나오)는 그 그물을 그대로 빠져나갔다.
//   그래서 어미는 **떼지 말고 그 토큰을 통째로 버린다**(아래 unknownTermOf).
// ⚠ 긴 것을 먼저 적어야 한다(JS 정규식 교체는 왼쪽부터 시도한다 — "주세요"가 "려주세요"보다
//   앞에 있으면 "알려주세요"가 "알려"까지밖에 안 줄어든다).
// ⚠ 어미 목록에 홑 "면"은 일부러 넣지 않았다 — "수면"·"해면"처럼 **면으로 끝나는 진짜 명사**가
//   통째로 버려진다. "하면"·"으면"은 명사 어미로 쓰이지 않아 안전하다.
// ⚠ "여야"는 일부러 뺐다 — 어미로도 쓰이지만 그 자체가 명사이기도 하다(같은 이유로 홑 "면"도 뺐다).
const NAVER_EOMI_TAIL = /(려주세요|여주세요|어주세요|아주세요|해주세요|주세요|하나요|인가요|던가요|되나요|습니까|합니까|습니다|합니다|나요|까요|해요|세요|어요|아요|하면|으면|해야|어야|아야)$/;
// ★D6(2026-08-16 실키 종단 검증에서 발견) — "조업하다"처럼 **명사+하다**로 만들어진 용언의 활용형.
//   실측 사고: "조업할 때 아리랑이 뭔가요"에서 정작 모르는 말인 "아리랑" 대신 **"조업할"**이 뽑혔다
//   (둘 다 세 글자라 "가장 긴 후보" 규칙이 먼저 나온 쪽을 집었고, "조업할"은 어미 목록에도 없어
//   그대로 통과했다). 이런 말은 **버리지 말고 떼야** 한다 — "조업할"→"조업"은 위키가 이미 아는
//   말이라 그 순간 후보에서 자연히 빠지고, 진짜 모르는 낱말만 남는다.
// ⚠ 세 글자 이상일 때만 뗀다 — "관할"·"역할"·"분할"처럼 **할로 끝나는 두 글자 명사**를 지키기 위해서다
//   (홑 "면"을 어미 목록에서 뺀 것과 같은 이유).
// ⚠ 긴 것 먼저(정규식 교체는 왼쪽부터) — "하다"가 "하다가"보다 앞이면 "조업하다가"가 안 줄어든다.
const NAVER_HADA_TAIL = /(했는데|하는데|하다가|하면서|하려고|했던|하는|하던|하여|하고|하며|하지|하게|하려|하러|해서|해도|하다|한다|했다|한|할|해|함|했)$/;
// 명사 뒤에 붙는 조사(이건 떼고 남은 명사를 후보로 삼는다). "깔때기가"→"깔때기".
// ⚠완전하지 않다(§4-8 termsOf 한계와 같은 뿌리) — 못 떼면 검색어가 조금 나빠질 뿐, 지어내지는 않는다.
// ★2026-08-16 §5-D "남은 것③" 후속 — 목록에 없던 조사(한테·께서·밖에·조차·마저·치고·커녕·뿐만·더러·이며)
//   가 붙으면 "선장한테"·"허가증밖에"처럼 위키가 이미 아는 말도 안 떼져 오탐이 났다(실측 확인).
//   "밖에"·"뿐만"은 뒤의 단일문자 "에"·"만"보다 **먼저** 와야 한다(JS 정규식 교체는 왼쪽 대안부터
//   시도해 먼저 매치되는 쪽을 쓴다 — 뒤에 있으면 "밖에"가 "에"에 가려 한 글자만 떨어진다).
const NAVER_JOSA_TAIL = /(이라는|이라고|이란|라는|라고|에서|에게|으로|이라|이면|한테|께서|밖에|조차|마저|치고|커녕|뿐만|더러|이며|은지|는지|까지|부터|처럼|보다|마다|가|은|는|을|를|의|에|로|도|만|과|와|랑|이)$/;
// 뜻을 물어보는 상투어 자체는 찾아볼 낱말이 아니다(STOPWORDS 는 검색 점수용이라 건드리지 않는다).
// ★D4 보강: 수량·시점을 묻는 의문사도 여기 넣는다("얼마나"·"얼마"는 STOPWORDS 에 없어 새어나갔다).
const NAVER_STOP = new Set(['뭐죠', '뭐야', '뭐지', '뭔가', '뭔지', '뭡니까', '말인가', '말인지',
  '얼마', '얼마나', '몇', '언제', '어디', '어떤', '어느', '무슨', '무엇', '왜', '누가']);
// 네이버 응답의 <b> 강조 태그·HTML 엔티티(실측: description 에 `&lt;수산&gt;` 형태로 온다).
const NAVER_TAG_RE = /<[^>]*>/g;

// 뜻 후보를 고르는 판단 호출(pickCandidateLaws 와 같은 "짧고 빠른 판단" 규약 — 사고 끄고 JSON만).
// 타임아웃은 API 최소값(10초) 위로 둔다(:2124 실측 기록 참고 — 8초로 두면 매 호출 400이다).
const NAVER_PICK_CONFIG = {
  temperature: 0.1,
  thinkingConfig: { thinkingBudget: 0 },
  responseMimeType: 'application/json',
  httpOptions: { timeout: 12000 },
};

/**
 * 네이버 스니펫의 HTML 태그·엔티티를 걷어 사람이 읽는 문장으로 되돌린다.
 * 예: naverPlain('&lt;수산&gt; <b>깔때기</b>') → '<수산> 깔때기'
 * @param {string} s @returns {string}
 * [연계] ← naverTermStep(프롬프트에 싣기 전).
 */
function naverPlain(s) {
  return String(s || '').replace(NAVER_TAG_RE, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

/**
 * 확인받을 "뜻" 문자열이 §4-U 불변식을 지키는지 한 군데서 판정한다(restateAllowed 와 같은 역할).
 * ★왜 필요한가: 이 값은 ①모델이 만든 직후 ②사용자가 "네"를 눌러 `ctx.nu.meaning` 으로 되돌아올 때
 *   **두 번** 들어오고, ②는 클라이언트를 거치므로 변조·재생이 가능하다. 그리고 무엇보다 여기에
 *   조문·형량이 섞이면 그 순간 "웹 내용을 법적 근거로 쓰지 않는다"는 §4-U 불변식이 깨진다.
 * 예: naverMeaningAllowed('통발 안쪽으로 좁아지는 입구 부분') → 그 문장 그대로
 *     naverMeaningAllowed('제32조 위반이면 과태료 100만원') → ''(RESTATE_BAN)
 * @param {*} s @returns {string} 통과하면 정리된 문자열, 아니면 ''
 * [연계] ← naverTermStep(생성 직후) · normalizeAskCtx(되돌아온 값).
 */
function naverMeaningAllowed(s) {
  const t = clarifyStr(s, NAVER_MEANING_MAX);
  if (!t) return '';
  if (RESTATE_BAN.test(t)) return '';
  return t;
}

/**
 * 질문에서 "우리가 모르는 낱말" 하나를 고른다 — **AI를 쓰지 않는 순수 대조**다.
 * index.json 메타(법명·주제·파일명·테마)에도 없고 `_glossary.md` 구어표에도 없는 낱말만 남기고,
 * 그중 가장 긴 것을 고른다(가장 구체적인 말일 확률이 높다).
 * 예: unknownTermOf('깔때기가 뭐죠') → '깔때기'   ·   unknownTermOf('어선 검사 언제 받나요') → ''
 * @param {string} query - 사용자 질문
 * @returns {string} 후보가 없으면 ''(그러면 §4-U 자체를 발동하지 않는다)
 * [연계] ← naverTermStep 1단계. → naver_search.correctTypo/searchTermMeaning 의 검색어.
 */
/**
 * 이 낱말을 위키가 **본문에서라도** 다루고 있는가. `readPage` 캐시(서버 기동 시 warmup 으로
 * 미리 데워진다)를 그대로 쓰므로 디스크를 다시 읽지 않는다.
 * ★왜 필요한가(2026-08-16 실키 검증 후속): 예전엔 index.json 메타(법명·주제·파일명·테마)만 봐서,
 *   본문에 96개 페이지나 나오는 흔한 말("분실")도 "우리가 모르는 낱말"로 잡혔다. §4-U 설계 §4-1의
 *   1단계가 **"먼저 우리 DB(위키·glossary) 재확인"** 인데 그 재확인이 메타에서 멈춰 있었던 것이다.
 * ⚠ 이 검사를 넣으면 위키 본문에 이미 있는 말은 §4-U 를 안 탄다 — 그런 질문이 답을 못 냈다면
 *   그건 어휘 공백이 아니라 **검색이 그 페이지를 못 찾은 것**이라 §4-U 가 고칠 문제가 아니다.
 * @param {string} t - 후보 낱말
 * @returns {boolean}
 * [연계] ← unknownTermOf(마지막 관문). → readPage 캐시.
 */
function wikiBodyHasTerm(t) {
  for (const p of (loadIndex().pages || [])) {
    const page = readPage(p.kind, p.file);
    if (page && page.body.includes(t)) return true;
  }
  return false;
}

function unknownTermOf(query) {
  const hay = (loadIndex().pages || [])
    .map(p => `${p.law || ''} ${p.topic || ''} ${p.file || ''} ${(p.themes || []).join(' ')}`).join('\n');
  const gloss = loadGlossary().flatMap(r => r.terms).map(t => t.replace(/\s+/g, ''));
  const seen = new Set();
  const cands = [];
  for (const tok of String(query).replace(/[^가-힣a-zA-Z0-9\s]/g, ' ').split(/\s+/)) {
    if (tok.length < 2 || STOPWORDS.has(tok) || NAVER_STOP.has(tok)) continue;
    // ★D4 ①어미가 붙었으면 그 토큰은 동사·형용사다 — 떼서 후보로 삼지 말고 **통째로 버린다**
    //   ("초과하면"·"나오나요"·"입으면"·"알려주세요"). 우리가 찾는 것은 조사가 붙는 명사뿐이다.
    if (NAVER_EOMI_TAIL.test(tok)) continue;
    // ★D4 ①-보충: "버리면"처럼 어미 목록으로 못 잡는 -면 활용형. 면으로 끝나는 **명사**는 실제로
    //   두 글자 한자어가 대부분이고(수면·지면·해면·표면·단면), 세 글자 이상이면서 면으로 끝나면
    //   거의 활용형이다("버리면"·"걸리면"·"들어가면"). 단 "어선이면"처럼 명사+이면은 조사라서 뺀다.
    if (tok.length >= 3 && tok.endsWith('면') && !tok.endsWith('이면')) continue;
    // ★D6: 명사+하다 활용형은 **떼서** 원래 명사로 되돌린다("조업할"→"조업"). 세 글자 이상만
    //   건드려 "관할"·"역할" 같은 두 글자 명사를 지킨다(위 NAVER_HADA_TAIL 주석 참고).
    const base = tok.length >= 3 ? tok.replace(NAVER_HADA_TAIL, '') : tok;
    // 떼고 나니 아무것도 안 남았다 = 그 토큰이 **통째로 활용 어미**였다는 뜻이다("하는데"·"하려고").
    // 명사가 아니므로 후보에서 뺀다(실측: "신고하려고 하는데 서류가 뭔가요"의 "하는데").
    if (tok.length >= 3 && base.length < 2) continue;
    const t = base.replace(NAVER_JOSA_TAIL, '');
    // 떼고 남은 줄기가 1글자 = 명사가 아니라 동사·어미 조각이다 → 후보에서 뺀다(어미 목록이
    // 놓친 활용형을 잡는 그물, 그대로 유지).
    if (t.length < 2 || t.length > NAVER_TERM_MAX || seen.has(t)) continue;
    // ★D4 ②조사를 뗀 **줄기에도** 불용어 검사를 다시 건다 — 위 검사는 원형("어디까지")에만 걸려
    //   조사가 붙은 의문사가 그대로 통과했다("어디까지"→"어디"는 STOPWORDS 에 있는데도 후보가 됐다).
    if (STOPWORDS.has(t) || NAVER_STOP.has(t)) continue;
    seen.add(t);
    if (hay.includes(t)) continue;                 // 위키 메타가 이미 아는 말
    if (gloss.some(g => g.includes(t))) continue;  // glossary 가 이미 아는 구어
    if (wikiBodyHasTerm(t)) continue;              // 위키 **본문**이 이미 다루는 말(위 함수 주석 참고)
    cands.push(t);
  }
  cands.sort((a, b) => b.length - a.length);
  return cands[0] || '';
}

/**
 * §4-4 3단계 — 걸러진 검색 후보를 **우리 정체성 문맥과 함께** Gemini에 넘겨 뜻 하나를 고르게 한다.
 * 후보 목록에 없는 뜻을 지어내면 안 되므로, 프롬프트로 강제하고 서버가 다시 후검사한다.
 * @param {string} term - 모르는 낱말(예: '깔때기')
 * @param {Array<{source:string,title:string,snippet:string}>} cands - naver_search.searchTermMeaning 결과
 * @returns {Promise<string>} 뜻 한 조각(실패·불확실이면 '')
 * [연계] ← naverTermStep 3단계. → gemini_client.callGemini(caller:'Legal-NaverTerm').
 */
async function pickTermMeaning(term, cands) {
  const block = cands.slice(0, NAVER_CAND_MAX)
    .map((c, i) => `${i + 1}. [${c.source}] ${naverPlain(c.title)} — ${naverPlain(c.snippet)}`).join('\n');
  const prompt = `너는 "나리야" — 대한민국 **해양수산**(어업·어선·항만·해양안전) 법령을 안내하는 AI 챗봇이다.
사용자가 "${term}"이라는 말을 썼는데 우리 법령 위키에 없는 말이라, 아래 웹 검색 결과로 **뜻만** 파악하려 한다.

[검색 결과]
${block}

[규칙]
1. 위 결과 중 **해양수산 현장에서 쓰는 뜻**으로 읽히는 항목이 있으면 그 뜻을 한 조각(명사구, 25자 이내)으로 적는다.
2. 해양수산과 무관한 뜻(조리도구·일반 생활용어 등)뿐이면 ok:false 로 답한다. **억지로 고르지 마라.**
3. ★법 조문·처벌·금액·법령 이름을 쓰지 마라. 여기서 정하는 것은 **낱말의 뜻**뿐이다.
4. 검색 결과에 없는 뜻을 지어내지 마라.
5. ★검색 결과가 **"${term}"이 아니라 다른 낱말**을 설명하고 있으면 ok:false 다. 검색엔진이 비슷한
   철자의 다른 말을 끌어온 것뿐이며, 그 뜻은 "${term}"의 뜻이 아니다. (실측 사고: "아릿대"를
   물었는데 검색이 "솟대"를 끌어왔고 그걸 뜻으로 골라 엉뚱한 확인 카드가 떴다.)
6. ★어업·어구·어선·항만·해양안전 현장의 말이라는 근거가 검색 결과에 **직접 보일 때만** ok:true 다.
   민속·의례·조리·컴퓨터·일반생활 쪽 설명뿐이면, 바다와 어렴풋이 이어 붙일 수 있어 보여도 ok:false 다.

다른 설명 없이 아래 JSON만 출력하라.
{"ok":true,"meaning":"…"} 또는 {"ok":false}`;
  const result = await gemini.callGemini({
    model: ANSWER_MODEL, contents: prompt, config: NAVER_PICK_CONFIG, caller: 'Legal-NaverTerm',
  });
  if (!result.success || !result.text) return '';
  const m = result.text.match(/\{[\s\S]*\}/);
  if (!m) return '';
  const obj = JSON.parse(m[0]);
  if (!obj || obj.ok !== true) return '';
  return naverMeaningAllowed(obj.meaning);
}

/**
 * ★§4-U 본체 — 위키도 원문도 빈손일 때 "이 말이 무슨 뜻인지"만 확인하고 되묻는다(§4-6 ①~③).
 *  ① 뜻을 찾았다 → "혹시 이 뜻인가요?" 확인 카드([네]/[아니요]). "네"의 ctx가 다음 턴에 뜻을 실어온다.
 *  ② 못 찾았다 → "조금 더 설명해 주세요" 재질문 카드 **딱 1회**(ctx.nu.rounds 로 센다).
 *  ③ 라운드 소진 → API를 아예 부르지 않고(비용 0) 정직하게 포기 + 다음 행동 안내.
 * ★키·스위치·후보가 하나라도 없으면 조용히 null — 호출부는 기존 "찾지 못했습니다"로 끝낸다.
 * 예: naverTermStep('깔때기가 뭐죠', {rounds:0,state:'none'}, true)
 *     → {clarify:{question:'「깔때기」 — 혹시 「…」 말씀이신가요?', options:[네…/아니요…]}, confirmKind:'naverTerm'}
 * @param {string} query - 사용자 질문(원문 그대로)
 * @param {{rounds:number,state:string,term:string,meaning:string}} nu - normalizeAskCtx().nu
 * @param {boolean} enabled - nariya_config.naverTermLookup
 * @returns {Promise<null|{giveup:true,answer:string}|{answer:string,note:string,clarify:object,confirmKind:string}>}
 * [연계] ← routes/legal.js POST /api/legal/ask 의 2차 조회(searchRawFallback) 실패 분기.
 *        → services/naver_search.js(correctTypo·searchTermMeaning) · gemini(pickTermMeaning).
 *        → ai_chat.js clarifyHTML(기존 버튼 렌더 그대로 — 새 UI 타입을 만들지 않는다).
 */
async function naverTermStep(query, nu, enabled) {
  try {
    if (!enabled) return null;
    if (!nu || nu.state === 'confirmed') return null;   // 확인된 뜻은 호출부가 이미 검색에 썼다
    if (!gemini.hasAnyKey()) return null;
    if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) return null;
    const term0 = unknownTermOf(query);
    if (!term0) return null;                            // 모르는 낱말이 안 잡히면 이 단계가 할 일이 없다
    // ③ 라운드 소진 — ★이 판정은 반드시 **키 확인·낱말 추출 뒤**에 온다(2026-08-16 적대검증 D3).
    //   예전엔 이 줄이 맨 위에 있어서, 모르는 낱말이 하나도 없는 멀쩡한 질문("어선 검사 언제
    //   받나요")이나 네이버 키가 없는 환경에서도 rounds 만 차 있으면 "뜻을 확인 못했습니다"라는
    //   **사실과 다른 포기 문구**가 떴고, 그 바람에 1차에서 정직하게 만들어둔 답변까지 버려졌다.
    //   여기로 내리면 "정말로 모르는 낱말이 있고, 찾아볼 수단도 있는데, 기회를 다 썼다"일 때만 뜬다.
    if (nu.rounds >= NAVER_ROUNDS_SPENT) return { giveup: true, answer: NAVER_GIVEUP };
    const naver = require('./naver_search');
    // §4-2 오타 변환 — ★한/영 **자판 오입력**일 때만 태운다(2026-08-16 실키 검증 D7).
    //   이 API 의 용도는 "rlarlgus"(한글 모드로 바꾸지 않고 친 글자)를 되돌리는 것인데, 실측해
    //   보니 **이미 한글로 제대로 친 말까지 비슷한 다른 말로 바꿔 놓는다** — "아릿대"를 "오릿대"로
    //   교정해 버려, 사용자가 묻지도 않은 낱말로 되묻는 카드가 떴다. 사용자가 실제로 친 말을
    //   우리가 임의로 바꾸면 그 순간 이 단계의 전제("이 말이 무슨 뜻인지 확인한다")가 깨진다.
    //   그래서 로마자가 섞인 토큰(=진짜 자판 오입력)일 때만 교정을 받아들인다. 순한글이면 호출
    //   자체를 안 해 쿼터도 아낀다.
    const term = /[A-Za-z]/.test(term0) ? await naver.correctTypo(term0).catch(() => term0) : term0;
    const cands = await naver.searchTermMeaning(term).catch(() => []);
    const meaning = cands.length ? await pickTermMeaning(term, cands).catch(() => '') : '';
    if (!meaning) {
      // ★D2: 여기까지 왔다는 건 **이번 턴에 실제로 검색을 했고 실패했다**는 뜻이다. 상한 회차의
      //   검색까지 실패했으면 같은 부탁을 또 하지 않고 그 자리에서 ③정직한 포기로 끝낸다.
      //   (예전에는 재질문 카드를 낸 다음 턴이 무조건 포기라, 사용자가 쓴 설명으로 다시 찾아보는
      //    일이 아예 없었다 — 물어놓고 답을 안 듣는 셈이었다.)
      if (nu.rounds >= NAVER_MAX_ROUNDS) return { giveup: true, answer: NAVER_GIVEUP };
      // ② 검색 실패 → 재질문 1회. 버튼의 act:'ask' 로 **사용자가 새로 칠 문장 한 번**에 라운드를
      //    실어 보낸다(새로 타이핑한 질문은 맥락을 비우는 게 규칙이라, 이 통로 말고는 셀 방법이 없다).
      return {
        answer: `「${term}」이 무슨 뜻인지 확인하지 못했어요. 지어내지 않고 여쭤볼게요.`,
        note: NAVER_NOTE,
        confirmKind: 'naverTerm',
        clarify: {
          question: '어떤 상황·장비에서 쓰는 말인지 조금만 더 설명해 주시겠어요?',
          options: [{ label: NAVER_RETRY, hint: '설명해 주시면 그 내용으로 다시 찾아볼게요',
            ctx: { nu: { rounds: nu.rounds + 1, state: 'none' } }, act: 'ask' }],
        },
      };
    }
    // ① 뜻을 찾았다 → 사용자 확인. 조사 없는 문장으로 물어 받침 판정 자체를 없앤다(:2159 josaEuro 배경).
    return {
      answer: '위키에 없는 말이라, 뜻부터 확인할게요.',
      note: NAVER_NOTE,
      confirmKind: 'naverTerm',
      clarify: {
        question: `「${term}」 — 혹시 「${meaning}」 말씀이신가요?`,
        options: [
          { label: NAVER_YES, hint: '그 뜻으로 다시 찾아볼게요',
            ctx: { nu: { rounds: nu.rounds, state: 'confirmed', term, meaning } } },
          { label: NAVER_NO, hint: '어떤 상황·장비에서 쓰는 말인지 적어 주세요',
            ctx: { nu: { rounds: nu.rounds + 1, state: 'none' } }, act: 'ask' },
        ],
      },
    };
  } catch (_) {
    return null;
  }
}

/**
 * 3회 백스톱으로 "추정해서 답한다"가 된 답변 맨 앞에 고정 고지문을 붙인다(§4.4).
 * @param {string} answer @param {boolean} assumed
 * @returns {string} assumed 가 아니면 answer 그대로(바이트 동일)
 * [연계] ← routes/legal.js(스트림 선두 delta · 2차 조회 답변 · 트리 답변).
 */
function withAssumedNotice(answer, assumed) {
  if (!assumed || !answer) return answer;
  return ASSUMED_NOTICE + '\n\n' + answer;
}

module.exports = { CLARIFY_TOPK, loadIndex, loadGlossary, glossaryExpand, lawCellVariants, citationNearLawName, pageLawNames, buildContextBlock, termWeights, scoreOne, search, decideClarify, synthesizeAnswerStream, normalizeHistory, historyBlock, searchRawFallback, classifyTier, extractCitationChain, extractGapNotices, lookupContact, filterSourcesByAnswer, filterCitationChainByAnswer, groupCitationChainByFlow, rawPathOf, zoneTreeStep, matchZoneTreeTopic, resolveZoneTreePath, collectZoneRules, rankZoneRules, zoneAskedRequirement,
  // H-37 §4·5·7(기본 off 스위치로 잠긴 신규 단계 — 설계 §3.3 R3)
  PROFILE_FIELDS, UNDERSTAND_MAX_ROUNDS, ASSUMED_NOTICE, RESTATE_DEICTIC, RESTATE_BLANK, josaEuro,
  restateAllowed, termsOf, expandQueryTerms,   // §17 재진술 → 검색 확장어
  normalizeAskCtx, ctxNextOf, normalizeProfile,
  profileAcceptedLabels, zoneQueryWithProfile, understandConfirmStep, scopeNarrowStep,
  profileConfirmStep, withAssumedNotice, loadVesselTree, vesselNodeAt, vesselTreeDepth,
  // §4-U 모르는 구어 해소(naverTermLookup 스위치로 잠긴 신규 단계)
  naverTermStep, unknownTermOf, naverMeaningAllowed, NAVER_MAX_ROUNDS, NAVER_ROUNDS_SPENT,
  // 2026-08-17: 인용사슬 묶음표기 풀기(B1·B2) · "잘 모르겠어요"(B7) · 약칭표(B8, 계약4)
  expandJoEnum, articleEnumTokens, ensureTopLawOption, citedArticleIn, explainClarifyStep, loadLawAliases, dropRedundantChainRows, sameClarifyAsLast,
  // 2026-08-17: 답변 인용 기반 근거 카드 폴백(B11 — 위키 `## 근거 조문` 표가 없는 페이지의 구멍 메우기)
  extractAnswerCitations, missingAnswerCitations, resolveAnswerLaw, lawKeyOf, SYNTH_CANDIDATE_MAX,
  // 2026-08-17: 4천자 컨텍스트 발췌(회귀 테스트 대상 — 이 로직에서 회귀가 두 번 재발했다)
  sliceRelevant, isMustSection, MUST_SECTIONS };
