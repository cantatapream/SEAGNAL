#!/usr/bin/env node
/**
 * 3-72 — 골든 문항에 「정답 문장 표식」(evidence) 초안을 만든다 — **사람이 확정한다** (2026-09-28)
 *
 * [왜] 검색·발췌를 바꿀 때 「정답이 근거자료에 실리나」를 잴 수 있는 문항이 **25개뿐**이다
 *   (`page_labels.json` 의 evidence). 골든 291문항에는 정답 법·조(`expect_law`·`expect_article`)는 있지만
 *   정답 **문장**이 없다. 그래서 3-72(절 안의 큰 표)처럼 289문항을 바꾸는 수정을 보증할 수 없었다.
 *
 * [만드는 법 — 원문 글자만 쓴다(환각 0)]
 *   ① 정답 법·조의 **raw 원문 조문**을 운영 함수로 꺼낸다(`rawPathOf` → 계층 파일 → `buildArticles` · L-136).
 *   ② 그 법의 위키 쪽들에서 **원문과 글자 그대로 겹치는 가장 긴 조각**을 찾는다(빈칸만 한 칸으로 맞춘다).
 *   ③ 조각이 20자 이상이면 초안으로 낸다: {질문, 쪽, 표식}. 표식은 원문에도 위키에도 그대로 있는 글자다.
 *   ⚠이것은 **초안**이다. 조문 전체 중 어느 조각이 「정답」인지는 질문에 달렸다 — 기계가 고르지 않는다(G-34).
 *     사람이 맞다·아니다를 고른 것만 `page_labels.json` 으로 옮긴다.
 *
 * 사용법
 *   node golden_evidence_draft.js                 통계만
 *   node golden_evidence_draft.js --json <파일>   초안 전부를 파일로(검토장의 재료)
 *
 * [연계] ← pinned/golden_questions.json · services/article_text.js(buildArticles) · services/legal_retriever.js(rawPathOf)
 *        → 검토장 `_dashboard/review_html/사장님_할일.html` · pinned/page_labels.json(사람이 확정한 것만) · WORKLIST 3-72
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const LEGAL = path.dirname(path.dirname(HERE));
const REPO = path.resolve(LEGAL, '..', '..', '..');
const WIKI = path.join(LEGAL, 'wiki');
const AT = require(path.resolve(LEGAL, '../../services/article_text.js'));
const R = require(path.resolve(LEGAL, '../../services/legal_retriever.js'));

const 창 = 12;          // 겹침을 찾는 창 크기(글자)
const 최소 = 15;        // 이보다 짧은 겹침은 표식으로 안 쓴다 — 20 이었더니 `1 정관 또는…`(원문)과 `1. 정관 또는…`(위키)처럼 호 번호 뒤에서 끊겨 18자인 좋은 표식을 버렸다
const 최대 = 60;        // 표식 길이 상한 — 근거자료에서 그대로 찾을 짧은 글자여야 한다

const 편 = (t) => String(t || '').replace(/<\s*(?:개정|신설|삭제|본조신설|전문개정|제목개정)[^>]*>/g, '')
  .replace(/\*\*|`|\[\[|\]\]|<br>/g, '').replace(/\s+/g, ' ').trim();

function 글모음(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => 글모음(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => 글모음(x, out));
  return out;
}

/** 계층 이름 → [파일 머리, buildArticles 계층] */
const 계층표 = { 법률: ['법률', 'law'], 시행령: ['시행령', 'decree'], 시행규칙: ['시행규칙', 'rule'] };

/** 「A 시행령」 → {법:'A', 계층:'시행령'} */
function 법가르기(이름) {
  const m = String(이름).replace(/[「」『』]/g, '').trim().match(/^(.*?)\s*(시행규칙|시행령)?$/);
  return { 법: m[1].replace(/\s+/g, ''), 계층: m[2] || '법률' };
}

/**
 * 정답 법·조에 적힌 **여러 꼴**을 하나씩 가른다(2026-09-28 — 처음엔 통째로 넘겨 118문항을 못 꺼냈다).
 *   `제16조·제10조` · `제35조②·③` · `별표7·제50조` · `제2조제3호` · `시행령 제2조의2` · `별표1의2`
 *   법도 `내수면어업법·양식산업발전법` 처럼 둘일 수 있다.
 * @returns {Array<{법, 계층, 조?:string, 별표?:string}>}
 */
function 조가르기(expectLaw, expectArticle) {
  const 법들 = String(expectLaw || '').split(/[·,、]/).map((x) => 법가르기(x)).filter((x) => x.법);
  const out = [];
  for (const 토막 of String(expectArticle || '').split(/[·,、]/)) {
    const 계층바꿈 = (토막.match(/(시행규칙|시행령)/) || [])[1];
    const 조 = (토막.match(/제\d+조(?:의\d+)?/) || [])[0];
    const 별표 = (토막.match(/별표\s*\d+(?:의\d+)?/) || [])[0];
    for (const 법 of 법들) {
      const 계층 = 계층바꿈 || 법.계층;
      if (조) out.push({ 법: 법.법, 계층, 조 });
      if (별표) out.push({ 법: 법.법, 계층, 별표: 별표.replace(/\s+/g, '') });
    }
  }
  return out;
}

function 조문(expectLaw, jo) {
  const 토막들 = 조가르기(expectLaw, jo);
  if (!토막들.length) return { 까닭: '정답 조를 읽을 수 없다' };
  const 글들 = [], 파일들 = [], 법들 = new Set();
  let 폴더찾음 = false;
  for (const t of 토막들) {
    법들.add(t.법);
    const 폴더 = R.rawPathOf(t.법);
    if (!폴더) continue;
    폴더찾음 = true;
    const [머리, tier] = 계층표[t.계층];
    if (t.조) {
      for (const f of [머리 + '.txt', 머리 + '_발췌.txt']) {
        const p = path.join(REPO, 폴더, f);
        if (!fs.existsSync(p)) continue;
        const arts = AT.buildArticles(fs.readFileSync(p, 'utf8'), tier, [t.조]);
        if (arts.length) { 글들.push(편(글모음(arts[0].paragraphs).join(' '))); 파일들.push(path.relative(LEGAL, p)); break; }
      }
    } else {
      const bd = path.join(REPO, 폴더, '별표');
      if (!fs.existsSync(bd)) continue;
      const 이름 = 머리 === '법률' ? t.별표 + '.txt' : 머리 + '_' + t.별표 + '.txt';
      const p = path.join(bd, 이름);
      if (fs.existsSync(p)) { 글들.push(편(fs.readFileSync(p, 'utf8'))); 파일들.push(path.relative(LEGAL, p)); }
    }
  }
  if (!폴더찾음) return { 까닭: '법 폴더를 못 찾음(고시·지침 등 행정규칙일 수 있다)' };
  if (!글들.length) return { 법들: [...법들], 까닭: '그 조·별표를 원문에서 못 꺼냄' };
  return { 법들: [...법들], 파일: 파일들.join(' · '), 글: 글들.join(' ¶ ') };
}

// 위키 쪽 목록(한 번만 읽는다)
const 쪽들 = [];
(function 걷(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { 걷(p); continue; }
    if (e.name.endsWith('.md')) 쪽들.push({ 이름: e.name.replace(/\.md$/, ''), 글: 편(fs.readFileSync(p, 'utf8')) });
  }
})(WIKI);

/** 원문 a 와 쪽 글 b 사이의 **겹치는 조각 전부**(창 단위로 이어 본다 · 20자 이상) */
function 겹침들(a, b) {
  const out = [];
  let i = 0;
  while (i + 창 <= a.length) {
    if (!b.includes(a.slice(i, i + 창))) { i++; continue; }
    let j = i + 창;
    while (j < a.length && b.includes(a.slice(i, j + 1))) j++;
    if (j - i >= 최소) out.push(a.slice(i, j));
    i = j;
  }
  return out;
}

/** 긴 조각을 표식 길이로 줄일 때 **질문 낱말이 가장 많이 든 자리**를 남긴다 */
function 줄이기(s, 낱말) {
  s = s.trim();
  if (s.length <= 최대) return s;
  let best = s.slice(0, 최대), bs = -1;
  for (let k = 0; k + 최대 <= s.length; k += 5) {
    const w = s.slice(k, k + 최대);
    const sc = 낱말.filter((t) => w.includes(t)).length;
    if (sc > bs) { bs = sc; best = w; }
  }
  return best.replace(/^\S*\s/, '').replace(/\s\S*$/, '').trim();
}

// ★고르는 법(2026-09-28 · 두 번째) — 처음엔 **가장 긴** 겹침을 골랐다. 그러면 질문과 무관한 조각이 뽑혔다
//   (「나무를 베면 처벌?」에 같은 조의 다른 호 「승인 없이 개발한 자」, 벌칙 문구처럼 13쪽에 나오는 흔한 글).
//   ⇒ 조각마다 **질문 낱말을 몇 개 담았나**로 먼저 고르고, 같으면 **덜 흔한**(적은 쪽에 나오는) 조각, 그다음 긴 조각.
function 초안(q) {
  const c = 조문(q.expect_law, q.expect_article);
  if (!c.글) return { 까닭: c.까닭 };
  const 법들 = new Set([...c.법들, String(q.law || '').replace(/\s+/g, '')]);
  const 후보 = 쪽들.filter((p) => [...법들].some((법) => p.이름 === 법 || p.이름.startsWith(법 + '__')));
  const 낱말 = R.termsOf(q.question).filter((t) => t.length >= 2);
  const 모두 = [];
  for (const p of 후보) for (const s of 겹침들(c.글, p.글)) {
    // 끝에 붙은 호 번호(`… 있다. 1`)는 원문을 펴면서 생긴 꼬리라 뗀다
    const 표식 = 줄이기(s, 낱말).replace(/\s+\d{1,2}\.?$/, '').trim();
    if (표식.length < 최소) continue;
    모두.push({ 쪽: p.이름, 표식, 겹침길이: s.length, 맞춤: 낱말.filter((t) => s.includes(t)).length });
  }
  if (!모두.length) return { 까닭: `그 법 위키 쪽 ${후보.length}개에 원문과 ${최소}자 넘게 겹치는 글이 없다`, 원문: c.파일 };
  // 같은 조각이 여러 쪽에서 나오면 한 번만 후보로 낸다(검토장에 같은 후보가 두 번 보였다)
  const 본 = new Set();
  for (let i = 모두.length - 1; i >= 0; i--) { if (본.has(모두[i].표식)) 모두.splice(i, 1); else 본.add(모두[i].표식); }
  for (const x of 모두) x.흔함 = 쪽들.filter((p) => p.글.includes(x.표식)).length;
  모두.sort((a, b) => b.맞춤 - a.맞춤 || a.흔함 - b.흔함 || b.겹침길이 - a.겹침길이);
  const best = 모두[0];
  return { ...best, 원문: c.파일, 다른후보: 모두.slice(1, 3).map((x) => ({ 쪽: x.쪽, 표식: x.표식 })) };
}

if (require.main === module) {
  const qs = JSON.parse(fs.readFileSync(path.join(HERE, 'pinned', 'golden_questions.json'), 'utf8'));
  const list = Array.isArray(qs) ? qs : qs.questions;
  const out = list.map((q, i) => ({ 번호: i + 1, 질문: q.question, 법: q.law, 정답법: q.expect_law, 정답조: q.expect_article, ...초안(q) }));
  const ok = out.filter((x) => x.표식);
  console.log(`골든 ${out.length}문항 · 초안이 나온 것 ${ok.length}`);
  const 갈래 = {};
  for (const x of out.filter((x) => !x.표식)) { const k = x.까닭.replace(/\d+개/, 'N개'); 갈래[k] = (갈래[k] || 0) + 1; }
  for (const [k, n] of Object.entries(갈래)) console.log(`  ⬜ ${String(n).padStart(3)}  ${k}`);
  console.log(`  표식이 한 쪽에만 있는 것(가려내는 힘이 크다) ${ok.filter((x) => x.흔함 === 1).length} · 2~3쪽 ${ok.filter((x) => x.흔함 >= 2 && x.흔함 <= 3).length} · 4쪽 이상 ${ok.filter((x) => x.흔함 > 3).length}`);
  const ji = process.argv.indexOf('--json');
  if (ji > 0) { fs.writeFileSync(process.argv[ji + 1], JSON.stringify(out, null, 1) + '\n'); console.log(`초안 → ${process.argv[ji + 1]}`); }
  process.exit(0);
}
module.exports = { 초안, 조문, 조가르기 };
