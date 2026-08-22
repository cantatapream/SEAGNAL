/**
 * search_live.js — 고정 문제집에서 `search` 로 찍힌 문항이 **실제 배포 챗봇에서도 실패하는지**를 잰다.
 *
 * [왜 있나 — 2026-08-21]
 * `golden_eval.js`(V5-7)의 `search` 판정은 **첫 검색 한 번**만 본다. 그런데 실제 사용자는 되묻기에
 * 답하고, 그 답이 질의에 붙은 뒤 다시 검색된다 — 그 두 번째 검색에서 맞는 페이지가 오는 경우가 있다.
 * 그래서 계기판의 `search 28건` 은 **사용자가 실제로 겪는 실패보다 클 수 있다.** 얼마나 큰지 모르면
 * 어디를 고칠지 못 정한다(뭉친 숫자로는 손댈 곳을 못 정한다 — `search_gap.js` 와 같은 취지).
 *
 * [어떻게] 사람이 쓰는 경로 그대로 — `ask_live.js` 로 배포 서버에 묻고, 되묻기에는 `link_live.js` 와
 *          **같은 규칙**으로 답한다(기대 근거와 글자가 가장 많이 겹치는 선택지). 판정은 AI 없이
 *          **답변 글자에 기대 조문 표기가 있는지**만 본다.
 *
 * ⚠유료다 — 문항마다 배포 서버가 Gemini 를 여러 번 부른다(문항당 3~5회, 30원 안팎).
 * ⚠AI 답변은 매번 같지 않다. 이 숫자는 "그 시점 표본"이지 회귀 게이트가 아니다.
 *
 * [쓰는 법] node search_live.js --in pinned/search_fail_list.json [--out pinned/search_live_<날짜>.json]
 * [연계] ← pinned/golden_questions.json · ask_live.js → https://seagnal-server.fly.dev/api/legal/ask
 *        ⚠읽기 전용 — 위키·raw 를 고치지 않는다.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const IN = arg('--in') || 'pinned/search_fail_list.json';
const OUT = arg('--out');
const TMP = '/tmp/claude-0/-home-user-SEAGNAL/7dd72c7c-d763-527d-ad04-96a3a3857171/scratchpad';

function askLive(state, args) {
  execFileSync('node', [path.join(HERE, 'ask_live.js'), '--state', state, ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(fs.readFileSync(state, 'utf8'));
}

/**
 * 되묻기 선택 규칙 — **질문 원문만 보고** 고른다.
 *
 * ⚠2026-08-21 전수 검증에서 이 함수가 결과를 망치고 있었다. 원래는 `질문 + 기대조문 + 기대법`
 *   전체와 겹치는 라벨을 골랐는데, **기대 근거를 보고 고르는 것은 답을 알고 고르는 것**이라
 *   두 가지가 동시에 망가진다:
 *     ① 사람이 하지 않을 선택을 한다 — 사용자는 정답 조문을 모르는 채로 고른다
 *     ② 오히려 **엉뚱한 데로 끌고 간다** — 실측: "우수관리인증기관 거짓지정 별표4?" 에서
 *        기대 근거의 글자와 겹친다는 이유로 **"수산물"** 을 골랐고, 챗봇은 정확하게
 *        "우수관리인증기관은 **농산물에만** 적용된다"고 답했는데 기대 조문과 다르다고 실패로
 *        집계됐다. "무인도서 여행 허가?" 도 "특정도서입니다" 를 골라 챗봇의 정답을 실패로 셌다.
 *   실패 24건 중 **22건이 되묻기를 거친 뒤** 실패했다 — 도구가 만든 실패가 섞여 있었다.
 * 그래서 **기대 근거를 빼고 질문 원문하고만** 겹침을 잰다(사용자가 아는 것만 갖고 고른다).
 */
function pickOption(clarify, q) {
  const want = String(q.question).replace(/\s+/g, '');
  const opts = (clarify.options || []);
  let best = -1, bestScore = -1;
  opts.forEach((o, i) => {
    if (o.act === 'unknown' || o.act === 'ask') return;
    const lab = String(o.label || '').replace(/\s+/g, '');
    let sc = 0;
    for (let k = 0; k + 2 <= lab.length; k++) if (want.includes(lab.slice(k, k + 2))) sc++;
    if (sc > bestScore) { bestScore = sc; best = i; }
  });
  return best;
}

const list = JSON.parse(fs.readFileSync(path.resolve(HERE, IN), 'utf8'));
const rows = [];
// 조문 표기 정규화 — 같은 조문을 사람마다 다르게 적는다("제7조2호" vs "제7조제2호",
// "①" vs "제1항", "별표4" vs "별표 4"). 이 차이 때문에 글자대조가 헛발질하면
// 챗봇이 맞게 답했는데도 틀린 것으로 집계된다(2026-08-21 1차 라이브에서 4건 확인).
// 예: normArt('제8조4호') === normArt('제8조제4호') === '제8조제4호'
const _CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮';
function normArt(s) {
  return String(s || '')
    .replace(/[①-⑮]/g, m => `제${_CIRCLED.indexOf(m) + 1}항`)
    .replace(/\([^)]*\)/g, '')   // 조문 제목·개정번호 괄호는 표기 흔들림이 커서 뺀다
    .replace(/\s+/g, '')
    .replace(/조(\d+)항/g, '조제$1항')
    .replace(/조(\d+)호/g, '조제$1호')
    .replace(/항(\d+)호/g, '항제$1호');
}
// 라벨은 "시행령 제3조②"처럼 법령명이 앞에 붙기도 한다. 법령명은 문항에 이미 고정돼 있으므로
// 조문 부분만 떼어 답변 본문과 맞춘다. 예: artKey('시행령 제3조②') === '제3조제2항'
function artKey(s) {
  const t = normArt(s);
  const m = t.match(/(제\d+조.*|별표\d+.*|부칙.*)$/);
  return m ? m[1] : t;
}

(async () => {
  for (let i = 0; i < list.length; i++) {
    const q = list[i];
    const state = path.join(TMP, 'slive_' + i + '.json');
    try { fs.unlinkSync(state); } catch (_) {}
    let s;
    try {
      s = askLive(state, ['start', q.question]);
      for (let round = 0; round < 6 && s.last && s.last.clarify; round++) {
        const pick = pickOption(s.last.clarify, q);
        if (pick < 0) break;
        s = askLive(state, ['pick', String(pick)]);
      }
    } catch (e) {
      rows.push({ ...q, error: String(e.message || e).slice(0, 160) });
      console.log(`✖ ${q.law} — 질문 실패`);
      continue;
    }
    const d = s.lastDone || {};
    if (!d.answer || d.clarify) {
      rows.push({ ...q, stuck: true, calls: s.calls });
      console.log(`⚠ ${q.law} — 되묻기에서 못 빠져나옴(${s.calls}회)`);
      continue;
    }
    // 기대 조문이 답변 글자에 실제로 있나 — AI 판단 없이 글자 대조만 한다.
    const flat = normArt(d.answer);
    const wantArts = String(q.expect_article || '').split(/[·,]/).map(artKey).filter(Boolean);
    const cited = wantArts.some(a => flat.includes(a));
    // 인용사슬(화면 링크가 걸리는 재료)에도 들어왔나 — 답변 글자와 별개 축이다.
    const chain = (d.citationChain || []).map(c => normArt(`${c.law || ''} ${c.citedArticle || c.article || ''}`));
    const inChain = wantArts.some(a => chain.some(c => c.includes(a)));
    // 답변 원문을 같이 남긴다 — 채점 규칙을 고쳤을 때 서버에 다시 묻지 않고 재채점할 수 있어야 한다.
    rows.push({ ...q, calls: s.calls, cited, inChain, answer: String(d.answer) });
    console.log(`${cited ? '✅' : '❌'} ${q.law} — 기대근거 ${cited ? '인용됨' : '없음'}${inChain ? ' · 사슬O' : ''} · ${s.calls}회 | ${q.question.slice(0, 34)}`);
  }
  const done = rows.filter(r => !r.error && !r.stuck);
  console.log(`\n── ${rows.length}문항 (답변까지 간 것 ${done.length}) ──`);
  console.log(`  기대 근거를 실제로 인용   ${done.filter(r => r.cited).length}`);
  console.log(`  인용은 못 했으나 사슬엔   ${done.filter(r => !r.cited && r.inChain).length}`);
  console.log(`  진짜 실패                ${done.filter(r => !r.cited && !r.inChain).length}`);
  console.log(`  되묻기에서 못 빠져나옴    ${rows.filter(r => r.stuck).length} · 호출 실패 ${rows.filter(r => r.error).length}`);
  if (OUT) { fs.writeFileSync(path.resolve(HERE, OUT), JSON.stringify({ rows }, null, 1)); console.log(`\n저장: ${OUT}`); }
})();
