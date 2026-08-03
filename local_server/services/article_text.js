/**
 * ============================================================================
 * 파일명: services/article_text.js
 * 역할: 답변카드의 조문을 눌렀을 때 보여줄 **조문 원문 1개**를 raw 원문에서 뽑아
 *       항(①②③…)·호(1. 2. 3.) 단위로 쪼개 주는 모듈
 * ============================================================================
 *
 * [설명]
 * 나리야 답변카드의 근거법령 체인(위임흐름)은 위키 표의 **요지**만 보여준다. 사용자가
 * 그 조문 카드를 누르면 "그 조 전체 원문"을 팝업으로 띄우고 실제로 인용된 항·호를
 * 강조해 주는데, 이 모듈이 그 원문을 만든다.
 *
 * raw(법령 원문)는 서버에 상주시키지 않는다 — 2차 조회(searchRawFallback)와 똑같이
 * `services/github_raw.js`로 **필요할 때만** GitHub에서 읽어온다(MASTER_PLAN F절).
 *
 * [환각 0 — 이 파일의 핵심 계약]
 *  - 원문에서 그 조를 못 찾으면 **문장을 지어내지 않고** {ok:false, reason}을 돌려준다.
 *  - 호(1. 2. 3.) 쪼개기는 번호가 1부터 연속일 때만 인정한다. "제2조의2" 뒤에 "8."이
 *    붙어 "28."로 오검출되는 실제 사례가 있어, 조금이라도 어긋나면 쪼개기를 포기하고
 *    **항을 통째로** 보여준다(잘못 잘린 조문을 보여주는 것보다 안전).
 *
 * [연계 파일]
 * - routes/legal.js                        → GET /api/legal/article-text 가 loadArticle() 호출
 * - services/legal_retriever.js            → rawPathOf()(법명 → raw 폴더 경로) 재사용
 * - services/github_raw.js                 → fetchText()/listDir()(온디맨드 원문 조회)
 * - client/js/ai-chat/ai_chat.js           → 이 응답으로 조문 팝업(.nrya-artpop)을 그린다
 *
 * [원문 형식 — 실제 raw 파일을 열어 확인한 것(추측 아님)]
 *  - 법률/시행령/시행규칙(`법률.txt`·`시행령.txt`·`시행규칙.txt`):
 *      `[제10조] 역사문화환경 보존지역의 보호 (시행 20260624 · 타법개정)` 헤더 줄 뒤에
 *      본문이 이어지고, 다음 `[제N조]` 헤더에서 끝난다. 조 사이에 `제3장 …`/`제1절 …`
 *      같은 편장절 제목 줄이 끼어들 수 있어 블록 끝의 그런 줄은 걷어낸다.
 *  - 행정규칙(`행정규칙/*.txt`): 파일 머리에 `발령일자: … 시행일자: …` 줄이 있고,
 *      조문은 `제18조(국가유산 유형별 검토기준) ① … ② …`처럼 **한 줄에 통째로** 들어있다.
 * [로드 순서] 번들 없음(서버). routes/legal.js가 require 시점에 함께 로드된다.
 * ============================================================================
 */
'use strict';

const githubRaw = require('./github_raw');
const { rawPathOf } = require('./legal_retriever');

// 항 머리기호(원문자) — 인덱스+1 이 항 번호다(①=1항).
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

// tier → 그 법 폴더 안의 고정 파일명(행정규칙만 파일명이 제각각이라 따로 찾는다).
const TIER_FILE = { law: '법률.txt', decree: '시행령.txt', rule: '시행규칙.txt' };

/** 정규식에 그대로 끼워 넣기 위해 특수문자를 이스케이프한다. */
function reEsc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `20260624` → `2026-06-24`. 8자리가 아니면 원문 그대로 돌려준다. */
function fmtDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s || '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : String(s || '');
}

/** 파일명·고시제목 비교용 정규화: 공백·기호를 전부 걷어내고 글자만 남긴다. */
function squash(s) {
  return String(s || '').replace(/\.txt$/i, '').replace(/[^0-9A-Za-z가-힣]/g, '');
}

/**
 * 위키 표의 조문 표기에서 조·항·호를 뽑는다. 표기는 페이지마다 두 가지가 섞여 있다
 * (`제10조④3호` 형과 `제10조제4항제3호` 형 — 실측으로 둘 다 확인) — 둘 다 받는다.
 * 예: parseArticleRef('제10조④3호')    → {jo:'제10조', mark:'④', ho:3}
 *     parseArticleRef('제5조제1항')     → {jo:'제5조', mark:'①', ho:0}
 *     parseArticleRef('제31조의2①3호')  → {jo:'제31조의2', mark:'①', ho:3}
 * @param {string} article - 체인 행의 조문 표기
 * @returns {{jo:string, mark:string, ho:number}|null} 조 번호를 못 읽으면 null
 * [연계] ← loadArticle(). jo 는 원문에서 조 블록을 찾는 열쇠, mark·ho 는 강조 대상.
 */
function parseArticleRef(article) {
  const s = String(article || '');
  const m = /제(\d+)조(?:의(\d+))?/.exec(s);
  if (!m) return null;
  const jo = m[2] ? `제${m[1]}조의${m[2]}` : `제${m[1]}조`;
  // 조 표기 뒤쪽만 본다. `제48조·선장병과(제44조②)`처럼 다른 조를 덧붙인 표기가 있어
  // 가운뎃점·괄호·쉼표가 나오면 거기서 끊는다(뒤에 딸린 다른 조의 항을 잘못 집지 않게).
  const rest = s.slice(m.index + m[0].length).split(/[·・,(（]/)[0];
  let mark = '';
  const cm = new RegExp(`[${CIRCLED}]`).exec(rest);
  if (cm) mark = cm[0];
  else {
    const hm = /제(\d+)항/.exec(rest);
    if (hm && +hm[1] >= 1 && +hm[1] <= CIRCLED.length) mark = CIRCLED[+hm[1] - 1];
  }
  const ho = /(?:제)?(\d+)\s*호/.exec(rest);
  return { jo, mark, ho: ho ? parseInt(ho[1], 10) : 0 };
}

// 호 머리번호("1." "2." …) 탐지. 앞뒤가 숫자면 제외해 "2.5"·"28."류 오검출을 막는다.
const HO_RE = /(?<!\d)([1-9]\d?)\.(?!\d)/g;

/**
 * 항 하나를 호(1. 2. 3. …)로 쪼갠다. **번호가 1부터 연속일 때만** 쪼개고, 하나라도
 * 어긋나면 null 을 돌려 호출부가 "항 통째로" 보여주게 한다(잘못 자르느니 안 자른다).
 * 예: splitHo('② 다음 각 호와 같다.1. 가나2. 다라') → {lead:'② 다음 각 호와 같다.', items:['가나','다라']}
 *     splitHo('… 7.31.까지 …')                    → null(번호가 1,2,3… 이 아니라 포기)
 * @param {string} hangText - 항 텍스트(머리기호 ①… 포함 가능)
 * @returns {{lead:string, items:string[]}|null} 못 쪼개면 null
 * [연계] ← splitParagraphs(). 결과 items 가 팝업의 `호` 목록이 된다.
 */
function splitHo(hangText) {
  // 항 머리기호(①등, 있으면) 제거 후 검사
  const head = /^[①-⑳]/.test(hangText) ? hangText.slice(0, 1) : '';
  const body = hangText.replace(/^[①-⑳]/, '');
  const idxs = [];
  let m;
  HO_RE.lastIndex = 0;
  while ((m = HO_RE.exec(body))) idxs.push({ pos: m.index, num: parseInt(m[1], 10), len: m[0].length });
  if (!idxs.length) return null;
  const nums = idxs.map(i => i.num);
  const expected = Array.from({ length: nums.length }, (_, i) => i + 1);
  if (JSON.stringify(nums) !== JSON.stringify(expected)) return null; // 1,2,3…연속 아니면 포기 → 항 통째로
  const items = [];
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i].pos + idxs[i].len;
    const end = i + 1 < idxs.length ? idxs[i + 1].pos : body.length;
    items.push(body.slice(start, end).trim());
  }
  return { lead: (head + body.slice(0, idxs[0].pos)).trim(), items };
}

/**
 * 조 본문을 항(①②③…) 단위로 쪼갠다. 항 기호 없이 시작하는 앞부분(제66조 벌칙처럼
 * 항 구분이 없는 조)은 mark 가 빈 첫 조각으로 둔다.
 * 예: splitParagraphs('① 가나\n② 다라') → [{mark:'①',text:'가나',items:null},{mark:'②',…}]
 * @param {string} body - extractArticleBlock 이 뽑은 조 본문
 * @returns {Array<{mark:string, text:string, items:string[]|null}>}
 * [연계] ← extractArticleBlock 결과 → loadArticle 이 hit 표시를 얹어 응답으로 만든다.
 */
function splitParagraphs(body) {
  return String(body || '')
    .split(/(?=[①-⑳])/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(chunk => {
      const mark = /^[①-⑳]/.test(chunk) ? chunk[0] : '';
      const ho = splitHo(chunk);
      if (ho) return { mark, text: ho.lead.replace(/^[①-⑳]\s*/, ''), items: ho.items };
      return { mark, text: chunk.replace(/^[①-⑳]\s*/, ''), items: null };
    });
}

/**
 * 원문 텍스트에서 조 하나의 블록(제목·시행일자·본문)을 잘라낸다.
 * 형식은 파일 종류로 갈린다(파일 헤더 주석의 "원문 형식" 참고).
 * 예: extractArticleBlock(법률txt, '제10조', 'law')
 *     → {title:'역사문화환경 보존지역의 보호', effectiveDate:'2026-06-24', body:'① …'}
 * @param {string} text - 파일 전체 원문
 * @param {string} jo - 조 표기(예 '제10조', '제7조의2')
 * @param {string} tier - law|decree|rule|notice
 * @returns {{title:string, effectiveDate:string, body:string}|null} 그 조가 없으면 null
 * [연계] ← loadArticle(). → splitParagraphs()
 */
function extractArticleBlock(text, jo, tier) {
  const src = String(text || '');
  if (tier === 'notice') {
    // `제18조(제목) 본문 …` — 다음 조/장 제목/별표/부칙이 줄머리에 나오면 거기서 끝.
    // ⚠ m 플래그를 쓰면 `$`가 "줄 끝"이 돼 본문이 첫 줄에서 잘린다 — 줄머리는 `(?:^|\n)`로 잡고
    //   m 플래그는 쓰지 않는다(실측으로 확인한 함정).
    const re = new RegExp(
      `(?:^|\\n)${reEsc(jo)}\\(([^)]*)\\)([\\s\\S]*?)(?=\\n제\\d+조(?:의\\d+)?\\(|\\n제\\d+장|\\n\\[별표|\\n부칙|$)`
    );
    const m = re.exec(src);
    if (!m) return null;
    const eff = /시행일자\s*:?\s*(\d{8})/.exec(src) || /발령일자\s*:?\s*(\d{8})/.exec(src);
    return { title: m[1].trim(), effectiveDate: eff ? fmtDate(eff[1]) : '', body: m[2].trim() };
  }
  // `[제10조] 제목 (시행 20260624 · 타법개정)` 헤더 줄 + 다음 `[제N조]` 전까지가 본문.
  const re = new RegExp(`(?:^|\\n)\\[${reEsc(jo)}\\]([^\\n]*)\\n([\\s\\S]*?)(?=\\n\\[제\\d+조|$)`);
  const m = re.exec(src);
  if (!m) return null;
  const head = m[1].trim();
  const eff = /\(시행\s*(\d{8})/.exec(head);
  // 블록 끝에 다음 조 앞의 편장절 제목(`제3장 …`·`제1절 …`)이 딸려 올 수 있어 걷어낸다.
  // 제목 줄 앞에 빈 줄이 끼는 파일도 있어(어선법 등) 빈 줄도 함께 걷어낸다.
  const lines = m[2].split('\n');
  while (lines.length && /^$|^(제\d+[편장절]\s|부칙)/.test(lines[lines.length - 1].trim())) lines.pop();
  return {
    title: head.replace(/\s*\(시행[^)]*\)\s*$/, '').trim(),
    effectiveDate: eff ? fmtDate(eff[1]) : '',
    body: lines.join('\n').trim(),
  };
}

/**
 * 고시(행정규칙)는 파일명이 제목과 딱 맞지 않는다(`국가지정유산_역사문화환경보존지역내_
 * 건축행위등에관한허용기준작성지침.txt` 처럼 언더스코어로 이어붙는다) — 공백·기호를 전부
 * 지운 뒤 서로 부분포함이면 같은 것으로 보고, 가장 길게 겹치는 파일을 고른다.
 * @param {Array<{name:string,type:string}>} entries - listDir('…/행정규칙') 결과
 * @param {string} title - 체인 행의 고시 제목
 * @returns {string|null} 파일명(못 찾으면 null)
 * [연계] ← loadArticle()(tier==='notice').
 */
function pickNoticeFile(entries, title) {
  const want = squash(title);
  if (!want) return null;
  let best = null;
  for (const e of entries || []) {
    if (e.type !== 'file' || !/\.txt$/i.test(e.name)) continue;
    const got = squash(e.name);
    if (!got) continue;
    if (want.includes(got) || got.includes(want)) {
      if (!best || got.length > squash(best).length) best = e.name;
    }
  }
  return best;
}

/**
 * 그 법의 raw 폴더 경로를 찾는다. 체인 행의 법령명이 우선이고(타법 인용 행도 자기 법으로
 * 열리게), 시행령·시행규칙은 본법 폴더 아래에 있으므로 꼬리말을 떼고 한 번 더 찾는다.
 * 고시는 제목만으로는 폴더를 못 찾아 위키 페이지의 소속 법(baseLaw)으로 되돌아간다.
 * @param {string} law - 체인 행의 법령명(고시면 고시 제목)
 * @param {string} baseLaw - 그 위키 페이지의 소속 법명(클라이언트가 함께 보냄)
 * @returns {string|null}
 * [연계] → legal_retriever.rawPathOf(law_raw_paths.json 매핑).
 */
function resolveBase(law, baseLaw) {
  return rawPathOf(law)
    || rawPathOf(String(law || '').replace(/\s*(시행령|시행규칙)\s*$/, ''))
    || rawPathOf(baseLaw)
    || null;
}

/**
 * 조문 카드 하나에 대응하는 원문을 GitHub에서 읽어 항·호로 쪼개 돌려준다.
 * 예: loadArticle({law:'자연유산의 보존 및 활용에 관한 법률', article:'제10조④3호', tier:'law'})
 *     → {ok:true, articleTitle:'제10조(역사문화환경 보존지역의 보호)', paragraphs:[…④에 hit:true…]}
 * @param {{law:string, article:string, tier:string, baseLaw:string}} q
 * @returns {Promise<object>} 성공 {ok:true,…} / 실패 {ok:false, reason}
 * [연계] ← routes/legal.js GET /api/legal/article-text. → github_raw.listDir/fetchText.
 */
async function loadArticle(q) {
  const law = String((q && q.law) || '').trim();
  const tier = TIER_FILE[q && q.tier] ? q.tier : (q && q.tier === 'notice' ? 'notice' : 'law');
  const ref = parseArticleRef((q && q.article) || '');
  if (!law || !ref) return { ok: false, reason: 'bad_request' };
  if (!githubRaw.hasToken()) return { ok: false, reason: 'no_token' };

  const base = resolveBase(law, (q && q.baseLaw) || '');
  if (!base) return { ok: false, reason: 'law_not_found' };

  let filePath;
  if (tier === 'notice') {
    const picked = pickNoticeFile(await githubRaw.listDir(base + '/행정규칙'), law);
    if (!picked) return { ok: false, reason: 'file_not_found' };
    filePath = base + '/행정규칙/' + picked;
  } else {
    filePath = base + '/' + TIER_FILE[tier];
  }

  const text = await githubRaw.fetchText(filePath);
  if (!text) return { ok: false, reason: 'file_not_found' };

  const block = extractArticleBlock(text, ref.jo, tier);
  if (!block) return { ok: false, reason: 'article_not_found' };

  const paragraphs = splitParagraphs(block.body);
  if (!paragraphs.length) return { ok: false, reason: 'article_not_found' };

  // 인용된 항 찾기. 항 기호가 아예 없는 조(벌칙 조문 등)는 조각이 하나뿐이라 그 하나가 인용 대상이다.
  let hitIdx = ref.mark ? paragraphs.findIndex(p => p.mark === ref.mark) : -1;
  if (hitIdx < 0 && paragraphs.length === 1) hitIdx = 0;
  const out = paragraphs.map((p, i) => ({
    mark: p.mark,
    text: p.text,
    hit: i === hitIdx,
    items: p.items
      ? p.items.map((t, j) => ({ text: t, hit: i === hitIdx && ref.ho > 0 && j === ref.ho - 1 }))
      : null,
  }));

  return {
    ok: true,
    law,
    articleTitle: ref.jo + (block.title ? `(${block.title})` : ''),
    effectiveDate: block.effectiveDate,
    tier,
    paragraphs: out,
  };
}

module.exports = { loadArticle, parseArticleRef, splitHo, splitParagraphs, extractArticleBlock, pickNoticeFile };
