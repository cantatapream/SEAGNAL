/**
 * link_live.js — 실제 배포 챗봇에 물어, **답변 본문의 조문 링크가 걸리는지·눌러서 원문이 열리는지**를 잰다.
 *
 * [왜 있나 — 2026-08-21, 사용자 지시 "2단계"]
 * 2026-08-18 확정으로 답변 아래 "근거 법령" 카드 목록을 없앴다. 지금 사용자가 근거에 닿는 길은
 * **답변 본문의 조문 하이퍼링크** 하나뿐이다. 그런데 우리 검사는 전부 위키 파일만 봤고,
 * "그 링크가 실제로 걸리는가"는 답변을 만들어 봐야 알 수 있어 아무도 재지 않았다(L-152).
 * `link_ready.js`(V5-8)가 재는 것은 **전제 조건**(원문 파일이 정해지고 그 조가 있나)이고,
 * 이 도구가 재는 것은 **실제로 일어나는 일**이다.
 *
 * [어떻게 — 사람이 쓰는 것과 같은 경로로만]
 *   ① `ask_live.js` 로 배포 서버(`/api/legal/ask`)에 묻는다(되묻기 규약도 그 도구가 지킨다).
 *   ② 화면이 링크를 거는 코드를 **`client/js/ai-chat/ai_chat.js` 원문에서 그대로 떼어 실행**한다
 *      (`buildCiteIndex` → `citeHTML`). 재구현하지 않는다 — 그러면 검사와 화면이 어긋난다(L-136).
 *      떼어 오는 방식은 `scripts/test_chat_render.js` 가 쓰던 것과 같다.
 *   ③ 걸린 링크마다 배포 서버의 `/api/legal/article-text` 를 **화면이 보내는 값 그대로** 불러
 *      원문이 실제로 열리는지 본다.
 *
 * [무엇을 세나]
 *   · 답변에 나온 조문 표기 수 대비 **링크가 걸린 수**(안 걸리면 사용자는 근거에 못 닿는다)
 *   · 링크마다 **원문이 열리는가**(ok=true) — 열려야 근거 확인이 끝난다
 *   · 골든 문항의 **기대 근거가 답변에 실제로 인용됐나**
 *
 * ⚠유료다 — 질문마다 배포 서버가 Gemini 를 부른다(실측 컨텍스트 약 6만 자, 질문당 10원 안팎).
 * ⚠AI 답변은 매번 같지 않다. 이 숫자는 "그 시점 표본"이지 회귀 게이트가 아니다(게이트는 V5-8).
 *
 * [쓰는 법]
 *   node link_live.js --laws 20 --out pinned/link_live_<날짜>.json [--only <법이름>]
 * [연계] ← pinned/golden_questions.json(문항·기대근거) · ask_live.js(질문 규약)
 *        ← client/js/ai-chat/ai_chat.js(링크 판정 원문) → 배포 서버 두 API.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const N = Number(arg('--laws') || 20);
const ONLY = arg('--only');
const OUT = arg('--out');
const API = 'https://seagnal-server.fly.dev/api/legal/article-text';
const TMP = '/tmp/claude-0/-home-user-SEAGNAL/7dd72c7c-d763-527d-ad04-96a3a3857171/scratchpad';

/* ── 화면이 링크를 거는 코드를 ai_chat.js 원문에서 그대로 떼어 온다 ─────────────── */
const SRC = fs.readFileSync(path.resolve(HERE, '../../../../../client/js/ai-chat/ai_chat.js'), 'utf8');
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
  const m = new RegExp('^\\s*var ' + name + ' = .*$', 'm').exec(SRC);
  if (!m) throw new Error('변수를 못 찾음: ' + name);
  return m[0];
}
const screen = new Function([
  varSrc('NRYA_CITE_RE'), varSrc('NRYA_WIDE_RE'),
  fnSrc('_baseMatters'), fnSrc('_flatLawKey'), fnSrc('buildCiteIndex'),
  fnSrc('resolveCiteLaw'), fnSrc('baseLawName'), fnSrc('citeHTML'),
  // 화면 밖 의존 — 이 검사에서만 쓰는 최소 대역(약칭표는 안 쓴다: 없으면 링크를 포기하는 쪽이 안전).
  'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");}',
  'var aliasMap = null;',
  'var NRYA_BOX_RE=/[┌┬┐├┼┤└┴┘─│┃]/; var NRYA_BOX_ONLY_RE=/^[\\s┌┬┐├┼┤└┴┘─│┃]*$/;',
  'return { buildCiteIndex: buildCiteIndex, citeHTML: citeHTML, CITE_RE: NRYA_CITE_RE };',
].join('\n'))();

/** 만들어진 HTML 에서 링크된 조문만 뽑는다(화면이 실제로 심는 data-* 그대로). */
function linksOf(html) {
  const out = [];
  const re = /<span class="nrya-cite" data-law="([^"]*)" data-article="([^"]*)" data-tier="([^"]*)" data-base="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ law: m[1], article: m[2], tier: m[3], base: m[4] });
  return out;
}
/**
 * 답변에 나온 **조문 표기**(링크 여부와 무관) — 분모다.
 * ⚠`NRYA_CITE_RE` 를 그대로 쓰면 안 된다. 그건 citeHTML 의 상태기계가 쓰는 **토크나이저**라
 *   문장부호(`.`)·줄바꿈·법령명(`「해운법」`)까지 잡는다. 처음에 그걸 분모로 삼아 "링크율 18.8%"
 *   라는 가짜 숫자가 나왔다 — 실제로는 조문 인용 3개가 전부 링크돼 있었다(2026-08-21, 보고 전에
 *   답변 문장을 눈으로 훑어 잡음). 조문·별표·별지 표기만 센다.
 */
const ART_TOKEN_RE = /제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제?\s*\d+\s*항)?(?:\s*제?\s*\d+\s*호(?:의\s*\d+)?)?|별표\s*\d+(?:의\s*\d+)?|별지\s*제\s*\d+\s*호(?:서식)?/g;
function citeMentions(text) {
  const re = new RegExp(ART_TOKEN_RE.source, 'g');
  const out = [];
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out.push(m[0]);
  return out;
}

/* ── 배포 서버 호출 ─────────────────────────────────────────────────────────── */
function curlJSON(url) {
  const txt = execFileSync('curl', ['-sS', '--max-time', '60', url], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(txt);
}
function askLive(state, args) {
  execFileSync('node', [path.join(HERE, 'ask_live.js'), '--state', state, ...args],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(fs.readFileSync(state, 'utf8'));
}

/** 되묻기 선택지 고르기 — 사람의 판단 대신 **글자 겹침**으로 정한다(재현 가능해야 한다). */
function pickOption(clarify, q) {
  const want = (q.question + ' ' + (q.expect_article || '') + ' ' + (q.expect_law || '')).replace(/\s+/g, '');
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

/* ── 본체 ──────────────────────────────────────────────────────────────────── */
const qs = JSON.parse(fs.readFileSync(path.join(HERE, 'pinned', 'golden_questions.json'), 'utf8')).questions
  .filter(q => q.verified && !q.skip);
const byLaw = new Map();
for (const q of qs) if (!byLaw.has(q.law)) byLaw.set(q.law, q);
let laws = [...byLaw.keys()].sort();
if (ONLY) laws = laws.filter(l => l.includes(ONLY));
else {
  const step = laws.length / N;                      // 이름순으로 고르게 흩어 뽑는다(분야 편중 방지)
  laws = Array.from({ length: Math.min(N, laws.length) }, (_, i) => laws[Math.floor(i * step)]);
}

const rows = [];
(async () => {
  for (const law of laws) {
    const q = byLaw.get(law);
    const state = path.join(TMP, 'live_' + law.slice(0, 12).replace(/[^가-힣A-Za-z0-9]/g, '') + '.json');
    try { fs.unlinkSync(state); } catch (_) {}
    let s;
    try {
      s = askLive(state, ['start', q.question]);
      for (let round = 0; round < 3 && s.last && s.last.clarify; round++) {
        const pick = pickOption(s.last.clarify, q);
        if (pick < 0) break;
        s = askLive(state, ['pick', String(pick)]);
      }
    } catch (e) {
      rows.push({ law, error: String(e.message || e).slice(0, 200) });
      console.log(`✖ ${law} — 질문 실패`);
      continue;
    }
    const d = s.lastDone || {};
    if (!d.answer || d.clarify) {
      rows.push({ law, q: q.question, clarifyStuck: true, calls: s.calls });
      console.log(`⚠ ${law} — 되묻기에서 못 빠져나옴(${s.calls}회)`);
      continue;
    }
    // ⚠citeHTML 의 2번째 인자는 **buildCiteIndex 결과**다(체인이 아니다 — answerBodyHTML 원문 참고).
    //   처음에 체인을 그대로 넘겨 "링크 0%" 라는 가짜 숫자가 나왔다(2026-08-21, 보고 전에 잡음).
    const idx = screen.buildCiteIndex(d.citationChain || [], d.citeLaws || []);
    const html = screen.citeHTML(d.answer, idx);
    const links = linksOf(html);
    const mentions = citeMentions(d.answer);
    // 링크마다 원문이 실제로 열리는지 — 화면이 보내는 값 그대로 배포 서버에 묻는다.
    const opened = [];
    for (const l of links) {
      const url = `${API}?law=${encodeURIComponent(l.law)}&article=${encodeURIComponent(l.article)}` +
        `&tier=${encodeURIComponent(l.tier)}&baseLaw=${encodeURIComponent(l.base)}`;
      let r = null;
      try { r = curlJSON(url); } catch (e) { r = { ok: false, reason: 'call_failed' }; }
      opened.push({ ...l, ok: r && r.ok === true, reason: (r && r.reason) || '', mode: (r && r.mode) || '' });
    }
    // 기대 근거가 답변에 실제로 인용됐나 — 조문 표기를 글자로 대조한다(AI 판단 없음).
    const flat = String(d.answer).replace(/\s+/g, '');
    const wantArts = String(q.expect_article || '').split(/[·,]/).map(x => x.replace(/\s+/g, '')).filter(Boolean);
    const wantHit = wantArts.some(a => flat.includes(a));
    rows.push({
      law, q: q.question, calls: s.calls,
      expect: `${q.expect_law} ${q.expect_article}`, expectCited: wantHit,
      mentions: mentions.length, linked: links.length,
      openOk: opened.filter(o => o.ok).length, openFail: opened.filter(o => !o.ok).length,
      failDetail: opened.filter(o => !o.ok).map(o => `${o.law} ${o.article}(${o.tier}) ← ${o.reason}`),
      forms: (d.forms || []).length, chain: (d.citationChain || []).length,
    });
    const r = rows[rows.length - 1];
    console.log(`✓ ${law} — 조문표기 ${r.mentions} / 링크 ${r.linked} / 원문열림 ${r.openOk}` +
      `${r.openFail ? ' (실패 ' + r.openFail + ')' : ''} · 기대근거 인용 ${wantHit ? 'O' : 'X'} · ${s.calls}회`);
  }

  const done = rows.filter(r => !r.error && !r.clarifyStuck);
  const sum = k => done.reduce((s, r) => s + (r[k] || 0), 0);
  console.log(`\n── 라이브 표본 ${rows.length}법 (답변까지 간 것 ${done.length}법) ──`);
  console.log(`  답변에 나온 조문 표기   ${sum('mentions')}`);
  console.log(`  그중 링크가 걸린 것     ${sum('linked')}` +
    (sum('mentions') ? `  (${(sum('linked') * 100 / sum('mentions')).toFixed(1)}%)` : ''));
  console.log(`  눌러서 원문이 열린 것   ${sum('openOk')}` +
    (sum('linked') ? `  (${(sum('openOk') * 100 / sum('linked')).toFixed(1)}%)` : ''));
  console.log(`  기대 근거를 인용한 법   ${done.filter(r => r.expectCited).length} / ${done.length}`);
  console.log(`  되묻기에서 못 빠져나옴  ${rows.filter(r => r.clarifyStuck).length}`);
  console.log(`  호출 실패              ${rows.filter(r => r.error).length}`);
  if (OUT) { fs.writeFileSync(path.resolve(HERE, OUT), JSON.stringify({ rows }, null, 1)); console.log(`\n저장: ${OUT}`); }
})();
