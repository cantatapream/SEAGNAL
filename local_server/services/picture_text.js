/**
 * picture_text.js — ★그림에서 옮긴 글(판독문)을 **모델에 넘기는 근거에서 뺀다.** (3-75 · Q-19)
 *
 * [왜 있나] 2026-10-03 사장님 결정(Q-19): 그림은 OCR·AI 판독으로 글로 옮겨 보여 주지 않고 **원본 그림을 그대로**
 * 보여 준다(조문 창·별표 창). 이미 옮겨 적은 판독문은 **검색용으로만** 남기고 답에 숫자로 인용하지 않는다.
 * 2026-10-06: 사장님이 직접 옮긴 판독값도 같다(「모두 검색용」). 그런데 판독문이 모델에 가는 길이 둘 있었다:
 *   ⓐ 위키 쪽 본문 — 판독 값을 옮겨 적은 줄·표·절이 그대로 근거자료(답변·되묻기·용어설명)로 들어갔다
 *   ⓑ raw 대체 경로(searchRawFallback) — raw .txt 를 거르지 않고 넣어 `【이미지판독 N】` 블록이 통째로 들어갔다
 * 이 파일이 두 길을 막는 **한 곳**이다. 화면(조문 창)도 같은 함수로 그림만 남긴다(article_text.cleanBody).
 *
 * [무엇을 하나]
 *  · stripRawPictureText(text) — raw 의 `【이미지판독 N】` … `【이미지판독 끝 N】` 을 통째로 「원문 그림」 표시로 바꾼다.
 *      끝 표시는 `_dashboard/loop/ocr_block_end.py` 가 달았다(블록 494개). 끝이 없는 시작 표시는 **그 줄만** 바꾼다
 *      — 어디까지가 판독인지 모르면 법 글을 삼키지 않는다(V5-56 이 끝 없는 블록을 0 으로 잠근다).
 *      `【이미지판독: 위성지도 위에 … 표시】` 처럼 **스스로 닫힌** 한 줄 설명(해경 고시 지도 등)도 같은 표시로 바꾼다.
 *  · stripWikiPictureText(body) — 위키 본문에서 **판독 출처를 밝힌 자리**를 뺀다:
 *      머리줄·표 행·인용 줄 → 그 줄 / 목록 항목(+이어짐)·문단 → 그 덩이 + `picture_wiki_lines.json`(숫자로 가린 줄).
 *      「이미지판독 아님」「블록 없음」처럼 **아니라고** 말하는 줄은 빼지 않는다(WIKI_NEG_RE).
 *      뺀 자리마다 「원문 그림」 안내 한 줄을 남긴다(무엇이 빠졌는지 모델이 안다 → 「원문 그림을 보라」고 답한다).
 *      ⚠출처를 밝히지 않고 옮겨진 값은 **숫자로만** 가린다 — 그 숫자가 그 법의 글 쪽 raw 에도 있으면 남긴다(글로 된 원문 값).
 *
 * 예: stripRawPictureText('… 한다.<img id="9"></img>\n【이미지판독 9】(원본이미지: _이미지/9.png)\n| 2 | 1 |\n【이미지판독 끝 9】\n⑥ …')
 *     → '… 한다.\n〔원문 그림 9 — 그림 안의 글·숫자는 옮기지 않았다〕\n⑥ …'
 *
 * [연계] ← services/legal_retriever.js(search 의 contextPages · searchRawFallback) · services/article_text.js(cleanBody)
 *        ← `_dashboard/loop/ocr_block_end.py`(끝 표시) · `_RULES.md` §5ⓓ · 시험 scripts/test_picture_text.js · 게이트 V5-56
 */
'use strict';

/** 모델에게 보이는 「원문 그림」 표시. 이 낱말을 바꾸면 ANSWER_RULES 의 안내 문장도 함께 바꾼다. */
const RAW_PLACEHOLDER = n => `〔원문 그림 ${n} — 그림 안의 글·숫자는 옮기지 않았다〕`;
const WIKI_PLACEHOLDER = '〔원문 그림에서 옮긴 내용이라 근거에서 뺐다 — 그 값은 원문 그림(별표·조문 창)으로 확인하도록 안내할 것〕';

const BLOCK_RE = /【이미지판독\s*(\d+)】[\s\S]*?【이미지판독 끝\s*\1】/g;
// 끝 표시가 없는 시작 — 같은 줄에서 「(원본이미지: …)」·「[표]」·이어지는 표 칸(`| … |`)까지만 뺀다.
//   ★줄 끝까지 지우면 안 된다: 트리 자산처럼 줄바꿈 없이 이어 붙인 발췌는 표 **뒤에 법 글이 이어진다**
//   (실측: zone_tree 「… 0.45 | 4. 의자석과 좌석이 공존하는 경우: …」).
//   발췌가 표 칸 한가운데서 「…」로 잘려 끝나면 그 잘린 칸까지 뺀다.
const OPEN_LINE_RE = /【이미지판독\s*(\d+)】(?:[ \t]*\(원본이미지:[^)\n]*\))?(?:[ \t]*\[표\])?(?:[ \t]*(?:\|[^|\n]{0,160})*(?:\|[^|\n]{0,160}…[ \t]*$|\|))?/g;
const INLINE_RE = /【이미지판독\s*[:：—–-][^】]*】/g;          // 「【이미지판독: 위성지도 위에 … 표시】」 꼴(스스로 닫힌다)
const STRAY_END_RE = /^[ \t]*【이미지판독 끝\s*\d+】[ \t]*\n?/gm;
const IMG_TAG_RE = /<img\s+id="\d+"[^>]*>(?:\s*<\/img>)?/g;    // 그림 자리 꼬리표 — 모델에게는 잡음이다

/**
 * raw 원문에서 판독 블록을 「원문 그림」 표시로 바꾼다.
 * @param {string} text - raw .txt 원문
 * @returns {string}
 */
function stripRawPictureText(text) {
  if (!text || text.indexOf('【이미지판독') < 0) return text || '';
  return String(text)
    .replace(BLOCK_RE, (m, n) => RAW_PLACEHOLDER(n))
    .replace(OPEN_LINE_RE, (m, n) => RAW_PLACEHOLDER(n))             // 끝 표시가 없는 시작 줄 — 그 줄만
    .replace(INLINE_RE, RAW_PLACEHOLDER('').replace('그림  —', '그림 —'))
    .replace(STRAY_END_RE, '')
    .replace(IMG_TAG_RE, '');
}

/** 위키 줄이 그림 판독에서 왔다고 **스스로 밝히는가**. */
const WIKI_SIGNAL_RE = /이미지판독|원본이미지|_이미지\/|비전\s?판독|\bOCR\b|판독\s?불명|판독\s?불가|도안\s?전사|전사본|원본\s?스캔\s?대조|그림-표 대조/;
/** 「이미지판독 아님」「【이미지판독】 블록 없음」「반영분 0건」처럼 **아니라고** 말하는 줄은 판독에서 온 줄이 아니다. */
const WIKI_NEG_RE = /(이미지판독|판독|OCR)[^,.;:\n]{0,12}?(아님|아니다|아니며|없음|없다|없어|불필요|0건)/;
const isSignal = s => WIKI_SIGNAL_RE.test(s) && !WIKI_NEG_RE.test(s);

/**
 * 위키 본문에서 판독 출처를 밝힌 자리를 뺀다(절·표 행·덩이 단위).
 * @param {string} body - readPage().body(머리말 제외 본문)
 * @returns {string}
 */
// 숫자로 가린 목록(`_dashboard/loop/picture_wiki_lines.py` 가 만든다) — 출처를 밝히지 않고 옮겨진 판독 값.
const fs = require('fs');
const path = require('path');
const LINES_JSON = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'picture_wiki_lines.json');
let _lines = { mtime: -1, pages: {} };
function listedKeys(wikiKey) {
  if (!wikiKey) return null;
  let mt = -1;
  try { mt = fs.statSync(LINES_JSON).mtimeMs; } catch (_) { return null; }
  if (mt !== _lines.mtime) {
    try { _lines = { mtime: mt, pages: JSON.parse(fs.readFileSync(LINES_JSON, 'utf8')).쪽 || {} }; }
    catch (_) { _lines = { mtime: mt, pages: {} }; }
  }
  const arr = _lines.pages[wikiKey];
  return arr && arr.length ? new Set(arr) : null;
}
/** 줄 열쇠 — picture_wiki_lines.py 의 key_of 와 같다(빈칸을 뺀 앞 80자). */
const keyOf = s => String(s).replace(/\s/g, '').slice(0, 80);

/**
 * 위키 본문에서 판독에서 온 자리를 뺀다.
 *  ⓐ 출처를 밝힌 줄(머리줄은 **그 줄만** · 표 행 · 인용 줄) / 출처를 밝힌 목록 항목(+이어짐)·문단 덩이
 *  ⓑ `picture_wiki_lines.json` 이 숫자로 가린 줄(이 쪽 열쇠가 있을 때)
 * ★머리줄에 「이미지판독」이 있어도 **절을 통째로 빼지 않는다** — 그 절에 글로 된 원문 값이 섞여 있다
 *   (실측: 「수협 공제사업」 지급여력비율 절 · 「어선표지」 재질·색상 — 「평문 원문 확인 · 판독값 아님」).
 *   그 절의 판독 값은 ⓑ가 숫자로 가린다.
 * @param {string} body - readPage().body
 * @param {string} [wikiKey] - 위키 상대경로(예 'concepts/항만법__안전점검및건설장비조종자격.md')
 * @returns {string}
 */
function stripWikiPictureText(body, wikiKey) {
  const src = String(body || '');
  const listed = listedKeys(wikiKey);
  if (!listed && !WIKI_SIGNAL_RE.test(src)) return src;
  const lines = src.split('\n');
  const out = [];
  let dropping = false;                       // 직전 줄을 뺐나(안내 한 줄만 남기려고)
  const drop = () => { if (!dropping) out.push(WIKI_PLACEHOLDER); dropping = true; };
  const keep = arr => { out.push(...arr); dropping = false; };
  const isListed = l => !!(listed && l.trim() && listed.has(keyOf(l)));
  const bad = l => isSignal(l) || isListed(l);
  const isHead = s => /^(#{1,6})\s/.test(s);
  const isTable = s => /^\s*\|/.test(s);
  // 줄의 갈래 — 덩이는 **같은 갈래끼리만** 묶는다(목록 항목 바로 뒤에 붙은 인용 줄을 함께 지우지 않으려고).
  //   q 인용 · i 목록 항목 · c 들여 쓴 이어짐 · t 보통 문단
  const kindOf = s => (/^\s*>/.test(s) ? 'q'
    : (/^\s*([-*+]|\d+[.)])\s/.test(s) && !/^\s{2,}/.test(s)) ? 'i'
    : /^\s{2,}\S/.test(s) ? 'c' : 't');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { keep([l]); i++; continue; }
    const k0 = kindOf(l);
    if (isHead(l) || isTable(l) || k0 === 'q') {   // 머리줄·표 행·인용 줄 → 그 줄만
      if (bad(l)) drop(); else keep([l]);
      i++; continue;
    }
    // 목록 항목(+들여 쓴 이어짐) · 보통 문단 한 덩이
    let j = i + 1;
    while (j < lines.length && lines[j].trim() && !isHead(lines[j]) && !isTable(lines[j])) {
      const k = kindOf(lines[j]);
      if (k0 === 'i' ? k !== 'c' : (k === 'q' || k === 'i')) break;
      j++;
    }
    const chunk = lines.slice(i, j);
    if (chunk.some(bad)) drop(); else keep(chunk);
    i = j;
  }
  return out.join('\n');
}

module.exports = { stripRawPictureText, stripWikiPictureText, isSignal, RAW_PLACEHOLDER, WIKI_PLACEHOLDER, WIKI_SIGNAL_RE };
