/**
 * _counting.js — ★**세는 법 사전** (2-6, 2026-09-22). 뿌리 사슬 ⑥의 해법.
 *
 * [왜 있나]
 * 같은 날 같은 저장소에서 **같은 것을 세는 운영 도구 셋이 서로 다른 값**을 냈다(G-10):
 *
 *   citation_table_scan  14,218
 *   reach_eval           17,903
 *   cite_exists          19,161
 *
 * 2026-09-22 에 원인을 끝까지 갈랐고, **두 가지가 겹쳐 있었다**:
 *
 *   ①범위가 다르다 (+3,685)  — 생산 파서 하나로 범위만 바꿔 재면
 *        concepts 만                 14,218
 *        네 갈래(+statutes·annexes·comparisons)  17,894
 *        위키 전체                    17,903
 *     셋 다 **맞는 숫자**다. 다른 물음에 답했을 뿐이다.
 *
 *   ②`cite_exists` 가 **표 머리행을 데이터 행으로 셌다** (+1,248)
 *     구분선(`|---|`)만 건너뛰고 `| 법령명 | 조문 | 시행일 | 요지 |` 는 세고 있었다.
 *     표 개수 1,286 · 머리행 1,284 와 맞아떨어진다. **이건 버그다.**
 *
 * [이 파일이 하는 일]
 * "근거 조문 행"의 뜻을 **두 가지로 못박고**, 범위를 **이름으로** 부르게 한다.
 * 숫자를 말할 때는 **반드시 뜻과 범위를 함께** 말한다 — 그러지 않으면 또 갈린다.
 *
 *   ┌ 뜻 ─────────────────────────────────────────────────────────────┐
 *   │ written  **표에 적힌 데이터 행** — 머리행·구분선 제외.             │
 *   │          "위키에 몇 줄 적혀 있나"를 물을 때.                       │
 *   │ chatbot  **챗봇이 꺼내는 사슬 항목** = `extractCitationChain()`.   │
 *   │          ⚠행 수가 아니다 — **위임 화살표(`→`)가 한 칸을 두 항목**  │
 *   │          **으로 가른다**(`제29조의2 → 시행령 제18조의2`). 그래서   │
 *   │          chatbot 이 written 보다 **69 많다**. 사용자 앞에 실제로   │
 *   │          뜨는 수라 **기본값은 이것이다.**                          │
 *   └──────────────────────────────────────────────────────────────────┘
 *   ┌ 범위 ───────────────────────────────────────────────────────────┐
 *   │ concepts  wiki/concepts 만       (챗봇이 근거를 만드는 곳)        │
 *   │ indexed   concepts+statutes+annexes+comparisons                  │
 *   │ all       wiki/ 전체(하위폴더 포함)                              │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * [2026-09-22 실측 — 여섯 칸이 전부 화해됐다]
 *                written    chatbot
 *   concepts      14,149     14,218
 *   indexed       17,825     17,894
 *   all           17,834     17,903
 *   `cite_exists` 의 19,161 = written(all) + 표 머리행(1,284) + 절 자르기 차이.
 *   **셋 다 맞는 숫자였다. 뜻과 범위를 안 밝혀서 갈렸을 뿐이다.**
 *
 * ⚠**뜻이 다르면 다른 이름으로 부른다.** 같은 이름으로 다른 것을 세는 것이
 *   ⑥의 정체였다. 숫자가 다르다고 누가 틀린 게 아니라, **물음이 달랐다.**
 *
 * [연계] → services/legal_retriever.js(extractCitationChain — 유일한 파서) ·
 *        cite_exists.js · citation_table_scan.js · reach_eval.js ·
 *        local_server/scripts/test_counting_dict.js(이 정의를 고정한다).
 */
const fs = require('fs');
const path = require('path');
const R = require('../../../../services/legal_retriever.js');

const WIKI = path.resolve(__dirname, '../../wiki');

/** 범위 이름 → 그 범위가 무엇인지 사람 말로. 보고할 때 숫자 옆에 이것을 붙인다. */
const SCOPES = {
  concepts: 'wiki/concepts 만',
  indexed: 'concepts+statutes+annexes+comparisons',
  all: 'wiki/ 전체(하위폴더 포함)',
};

/** frontmatter 를 뗀 본문. 파서에 넣기 전 **반드시** 거친다(안 떼면 표가 아닌 줄이 섞인다). */
function stripFrontmatter(text) {
  return String(text == null ? '' : text).replace(/^---[\s\S]*?---\n/, '');
}

/**
 * 그 범위에 드는 위키 `.md` 파일 목록.
 * @param {'concepts'|'indexed'|'all'} scope
 * @param {string} [wikiDir] - 시험용으로 다른 위키를 가리킬 때만
 * @returns {string[]} 절대경로
 */
function wikiFiles(scope, wikiDir) {
  const root = wikiDir || WIKI;
  if (!Object.prototype.hasOwnProperty.call(SCOPES, scope)) {
    throw new Error(`알 수 없는 범위: ${scope} (쓸 수 있는 것: ${Object.keys(SCOPES).join('·')})`);
  }
  const out = [];
  const pushDir = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d)) if (e.endsWith('.md')) out.push(path.join(d, e));
  };
  if (scope === 'concepts') pushDir(path.join(root, 'concepts'));
  else if (scope === 'indexed') {
    for (const k of ['concepts', 'statutes', 'annexes', 'comparisons']) pushDir(path.join(root, k));
  } else {
    (function walk(d) {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.name.endsWith('.md')) out.push(fp);
      }
    })(root);
  }
  return out.sort();
}

/**
 * 한 쪽의 「written」 행 — 표에 적힌 데이터 행. **머리행과 구분선은 뺀다.**
 * ⚠머리행을 빼는 것이 이 함수의 핵심이다. `cite_exists` 가 그걸 세서 1,248행이 부풀었다.
 * ⚠★절을 찾고 칸을 쪼개는 일은 **생산 함수의 것을 그대로 쓴다**(`R.sectionTable`).
 *   처음엔 여기서 따로 만들었는데, 그랬더니 `written`(17,848)이 `chatbot`(17,903)보다
 *   **적게** 나왔다 — 적혀 있는 것보다 꺼낼 수 있는 게 많을 수는 없다. 내 절-자르기가
 *   제목 깊이(생산은 2~3, 나는 2~4)와 여러 표 처리에서 달랐던 것이다.
 *   **사전을 만들면서 내가 ⑥을 다시 저질렀다.** 같은 것을 재려면 같은 자를 써야 한다(L-136).
 * @param {string} body - frontmatter 를 뗀 본문
 * @returns {string[][]} 행마다의 칸 배열
 */
function writtenRows(body) {
  const table = R.sectionTable(String(body || ''), /^#{2,3}\s*근거\s*조문[^\n]*$/m);
  if (table.length < 3) return [];          // 머리행 + 구분선 + 최소 1행
  const out = [];
  for (const row of table.slice(2)) {       // 0=머리행, 1=구분선 — 둘 다 데이터가 아니다
    const c = R.tableCells(row);
    if (R.isSepRow(c)) continue;
    if (c.length < 2) continue;
    out.push(c);
  }
  return out;
}

/**
 * 「근거 조문 행」을 센다 — **뜻과 범위를 반드시 밝혀서.**
 * @param {Object} [opt]
 * @param {'chatbot'|'written'} [opt.sense='chatbot'] - 위 사전의 뜻
 * @param {'concepts'|'indexed'|'all'} [opt.scope='all'] - 위 사전의 범위
 * @param {string} [opt.wikiDir]
 * @returns {{sense:string, scope:string, scopeLabel:string, files:number, pages:number, rows:number, label:string}}
 */
function countCitationRows(opt) {
  const o = opt || {};
  const sense = o.sense || 'chatbot';
  const scope = o.scope || 'all';
  if (sense !== 'chatbot' && sense !== 'written') throw new Error(`알 수 없는 뜻: ${sense}`);
  const files = wikiFiles(scope, o.wikiDir);
  let rows = 0, pages = 0;
  for (const f of files) {
    const body = stripFrontmatter(fs.readFileSync(f, 'utf8'));
    const n = sense === 'chatbot' ? R.extractCitationChain(body).length : writtenRows(body).length;
    if (n) pages++;
    rows += n;
  }
  const senseLabel = sense === 'chatbot' ? '챗봇이 꺼낼 수 있는 행' : '표에 적힌 데이터 행';
  return {
    sense, scope, scopeLabel: SCOPES[scope], files: files.length, pages, rows,
    label: `근거 조문 행 ${rows.toLocaleString()} (뜻: ${senseLabel} · 범위: ${SCOPES[scope]})`,
  };
}

module.exports = { SCOPES, WIKI, stripFrontmatter, wikiFiles, writtenRows, countCitationRows };

// ============================================================================
// 2-6b ── 「조용히 삼키는 catch」의 뜻과 범위 (2026-09-22)
// ----------------------------------------------------------------------------
// 독립 4벌이 같은 저장소를 보고 **61 / 55 / 133 / 39** 로 갈렸다(G-2). 「근거 조문 행」과
// 똑같은 병이다 — **뜻과 범위를 안 정했다.** 그래서 여기서도 이름을 나눠 붙인다.
//
//   ┌ 뜻 ─────────────────────────────────────────────────────────────┐
//   │ bare    몸통도 주석도 **아무것도 없는** catch — 왜 삼키는지 아무  │
//   │         설명이 없다. **가장 나쁜 것.**                            │
//   │ empty   몸통에 문장이 하나도 없는 catch(주석만 있는 것 포함).      │
//   │         이 저장소는 `catch (_) { /* 까닭 */ }` 를 **일부러** 쓴다. │
//   │ silent  로그도 안 남기고 다시 던지지도 않는 catch. `empty` 를 품는다.│
//   │ all     catch 전부(분모).                                         │
//   └──────────────────────────────────────────────────────────────────┘
//   ┌ 범위 ───────────────────────────────────────────────────────────┐
//   │ server   local_server/routes · services · server.js              │
//   │ client   client/js                                               │
//   │ product  server + client (사용자에게 닿는 코드) ← 기본값          │
//   └──────────────────────────────────────────────────────────────────┘
//
// ⚠**검사 도구·시험은 안 센다.** 도구가 오류를 삼키는 것과 사용자 앞 코드가 삼키는 것은
//   무게가 다르다. 세고 싶으면 범위를 새로 만들어 이름을 붙인다.
// ⚠`acorn` 은 이 저장소의 **전이 의존**이다(package.json 에 없다). 없으면 **조용히 0 을
//   돌려주지 않고** `available:false` 로 알린다 — 0 은 "없다"가 아니라 "못 셌다"이다(G-34).
//
// [연계] → scripts/test_silent_catch.js(정의 고정 + 기준선) · 00_WORKLIST G-14 · 2-6b.
// ============================================================================

const CATCH_SCOPES = {
  server: ['local_server/routes', 'local_server/services', 'local_server/server.js'],
  client: ['client/js'],
  product: ['local_server/routes', 'local_server/services', 'local_server/server.js', 'client/js'],
};
const REPO = path.resolve(__dirname, '../../../../..');
/** 로그·보고로 치는 호출. 넓게 잡는다 — 좁게 잡으면 "조용하다"가 부풀려진다. */
const CATCH_LOG_RE = /console|logger|\blog\b|report|captureException|warn|error|stderr|notify|metric|track/i;

/** ★「로그를 안 남긴다」와 「아무 일도 안 일어난다」는 다른 말이다.
 *  손잡이가 `alert('초기화 실패: '+e.message)` 라면 **사람에게는 분명히 보인다** —
 *  운영자 기록이 없을 뿐이다. 둘을 한 통에 넣고 세면 「삼키는 곳 241」 같은
 *  부풀린 수가 나오고, 정작 **정말 아무 일도 안 일어나는 자리**가 그 안에 묻힌다.
 *  그래서 **세지는 않고, 자리를 낼 때 「겉으로 무엇이 보이나」를 같이 적는다.** */
//  서버 쪽에서 「보인다」는 **부른 쪽이 안다**는 뜻이다 — 오류 응답을 돌려주면 안다.
const CATCH_SHOW_RE = /alert|confirm|innerHTML|textContent|innerText|toast|Swal|showModal|setError|notice|\b_?show[A-Z]\w*|\bres\.(status|json|send|end|write)\b|\bnext\(|\bmessage\s*=\s*['"`]/i;

/** ★세 번째 길 — 이 저장소는 로그도 화면도 아닌 **진단줄**에 남긴다.
 *  `if (diag) diag.push('expand')` 는 "조용히 넘어가지 않겠다"고 2026-08-20 에
 *  일부러 넣은 자리다. 로그가 아니라고 「삼킨다」로 세면 **이미 고쳐 둔 곳을 다시 고치라**고
 *  일감이 나온다. 삼킴의 반대말은 「로그」가 아니라 **「어딘가에 남는다」** 이다. */
const CATCH_TRACE_RE = /\bdiag\b|\btrace\b|\bdebugInfo\b|\b_diag\b|진단/i;

/** ★네 번째 길 — **실패를 값으로 남긴다.** 로그도 화면도 아니지만 **부른 쪽이 실패를 받는다.**
 *  실측하며 꼴이 계속 늘었다. 다섯 가지를 다 본다:
 *    `return { error: e.message }`            (assistant.js)
 *    `lastData = { success:false, aiError:… }` (admin_collect.js — 화면이 이 값을 읽는다)
 *    `results.push({ …, error: itemErr.message })` (admin.js — 결과 줄에 실패가 실린다)
 *    `streamError = e`                         (legal.js — 뒤에서 이 값을 보고 갈린다)
 *    `failCount++`                             (push.js — 실패 **수**로 남는다)
 *  ⚠이렇게 꼴이 늘어난다는 것 자체가 **「조용한가」는 기계가 못 판정한다**는 뜻이다(G-34).
 *    이 자는 **후보를 좁혀 줄 뿐**, 「괜찮다」를 말하지 않는다. */
const CATCH_RETURN_ERR_RE = new RegExp([
  '(return|=)\\s*\\{[^}]*\\b(error|err|ok\\s*:\\s*false|success\\s*:\\s*false|aiError)\\b',
  '\\.push\\(\\s*\\{[^}]*\\b(error|err|aiError)\\b',
  '\\b\\w*(Error|Err)\\s*=\\s*(e|err|e2|_e)\\b',
  '\\b(fail|error|err|bad|skip)\\w*(Count|s|ed)?\\s*(\\+\\+|\\+=)',
].join('|'));

/** acorn 을 쓸 수 있나. 전이 의존이라 없을 수 있다. */
function catchParserAvailable() {
  try { require('acorn'); require('acorn-walk'); return true; } catch (_) { return false; }
}

function _jsFiles(rels) {
  const out = [];
  for (const r of rels) {
    const p = path.join(REPO, r);
    if (!fs.existsSync(p)) continue;
    if (fs.statSync(p).isFile()) { out.push(p); continue; }
    (function w(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'node_modules') w(fp); }
        else if (e.name.endsWith('.js')) out.push(fp);
      }
    })(p);
  }
  return out.sort();
}

/**
 * 한 파일의 catch 를 뜻별로 센다.
 * @param {string} src - 자바스크립트 원문
 * @returns {{all:number, silent:number, empty:number, bare:number}|null} 못 읽으면 null
 */
function catchStats(src) {
  let acorn, walk;
  try { acorn = require('acorn'); walk = require('acorn-walk'); } catch (_) { return null; }
  let ast = null;
  for (const sourceType of ['script', 'module']) {
    try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowReturnOutsideFunction: true }); break; }
    catch (_) { /* 다음 꼴로 다시 */ }
  }
  if (!ast) return null;
  // ★`io` — 「**기다리는 일**(await)을 조용히 삼키는 catch」 (2026-09-23 신설, G-14b)
  //   등록부(G-14b)는 이것을 *"큰 덩이를 통째로 삼키는 catch 50곳"* 이라 적었는데, **두 군데가 틀렸다**:
  //     ① **50 이 어느 뜻으로도 안 나온다** — 오늘 실측: 조용히 삼키는 try **896** 중
  //        `10문장 이상` **69** · `try 안에 await` **241**.
  //     ② ★**스스로 든 실례가 「큰 덩이」가 아니다** — `admin_collect.js:2394` 는 **2문장**이다:
  //            try { const bRes = await fetch(…/api/boards); boards = await bRes.json(); } catch (e) {}
  //   즉 위험한 것은 **크기가 아니라 「기다리는 일을 삼키는 것」**이다. 그 fetch 가 실패하면
  //   `boards` 가 옛 값·빈 값인 채 화면이 그려지고, **아무도 모른다.**
  //   그래서 세는 뜻을 **크기가 아니라 `await` 유무**로 잡는다.
  // ★2026-09-23 (3-44) — **자리를 같이 돌려준다.** 세기만 하면 고치러 갈 수가 없다.
  //   숫자와 자리를 **같은 자**가 내게 해서, 「241」과 「고칠 목록」이 갈리지 않게 한다(⑥).
  const lineOf = (pos) => src.slice(0, pos).split('\n').length;
  // ★`bareSites` 를 2026-09-24 에 더했다 — **세기만 하면 고치러 갈 수가 없다.**
  //   `ioSites` 는 그 까닭으로 이미 있었는데(3-44) `bare` 는 숫자뿐이라,
  //   「110」을 줄이려는 사람이 **어디를 열어야 할지 알 수 없었다**(뿌리 사슬 ③ 의 작은 꼴).
  const r = { all: 0, silent: 0, empty: 0, bare: 0, io: 0, ioSites: [], bareSites: [] };
  walk.simple(ast, {
    // `io` 는 try 덩이를 봐야 하므로 TryStatement 에서 따로 센다.
    TryStatement(node) {
      if (!node.handler) return;
      const hb = node.handler.body.body;
      let logs = false, rethrows = false;
      if (hb.length) {
        walk.simple({ type: 'Program', body: hb, start: node.start, end: node.end }, {
          CallExpression(c) { if (CATCH_LOG_RE.test(src.slice(c.callee.start, c.callee.end))) logs = true; },
          ThrowStatement() { rethrows = true; },
        });
      }
      const silent = hb.length === 0 || (!logs && !rethrows);
      const blockSrc = src.slice(node.block.start, node.block.end);
      if (silent && /\bawait\b/.test(blockSrc)) {
        r.io++;
        const handlerSrc = src.slice(node.handler.start, node.handler.end);
        r.ioSites.push({
          줄: lineOf(node.start),
          손잡이줄: lineOf(node.handler.start),
          빈손잡이: hb.length === 0,
          주석있나: /\/\/|\/\*/.test(handlerSrc),
          // ★까닭은 **손잡이 안에만** 적혀 있지 않다 — `try` 바로 위나 함수 머리말(JSDoc)에
          //   적어 두는 것이 이 저장소의 버릇이다(실측: 12건 중 여러 개가 그랬다).
          //   손잡이 안만 보면 **설명이 있는데 없다고 세게 된다**(L-347 과 같은 덫).
          앞주석: /\/\/|\/\*|\*\s/.test(src.slice(Math.max(0, node.start - 300), node.start)),
          try문장수: node.block.body.length,
          await수: (blockSrc.match(/\bawait\b/g) || []).length,
          // 무엇을 기다리는지 — 고치러 갈 때 제일 먼저 보는 것이다
          부른것: [...new Set((blockSrc.match(/await\s+([A-Za-z_$][\w$.]*)/g) || [])
            .map((x) => x.replace(/^await\s+/, '')))].slice(0, 4),
          // ★겉으로 무엇이 보이나 — `보임`이면 사람은 안다(기록이 없을 뿐).
          //   `없음`이면 **아무 일도 안 일어난다** — 고치러 갈 곳은 여기부터다.
          겉으로: hb.length === 0 ? '없음'
            : (CATCH_SHOW_RE.test(handlerSrc) ? '보임'
              : (CATCH_TRACE_RE.test(handlerSrc) ? '진단줄'
                : (CATCH_RETURN_ERR_RE.test(handlerSrc) ? '값으로 남긴다' : '없음'))),
          손잡이: handlerSrc.replace(/\s+/g, ' ').slice(0, 70),
        });
      }
    },
    CatchClause(node) {
      r.all++;
      const body = node.body.body;
      const text = src.slice(node.body.start, node.body.end);
      if (body.length === 0) {
        r.empty++; r.silent++;
        if (!/\/\/|\/\*/.test(text)) {
          r.bare++;    // 주석조차 없다 = 왜 삼키는지 아무 설명이 없다
          const before = src.slice(Math.max(0, node.start - 260), node.start);
          r.bareSites.push({
            줄: lineOf(node.start),
            // ★까닭이 **손잡이 밖**에 적혀 있을 수 있다 — `try` 바로 위나 함수 머리말이
            //   이 저장소의 버릇이다(ioSites 가 먼저 배운 것, L-347 의 덫).
            앞주석: /\/\/|\/\*|\*\s/.test(before),
            // 무엇을 감싸고 있었나 — 고치러 갈 때 제일 먼저 보는 것
            감싼것: (() => {
              const t = src.slice(0, node.start);
              const i = t.lastIndexOf('try');
              return i < 0 ? '' : t.slice(i, node.start).replace(/\s+/g, ' ').slice(0, 72);
            })(),
          });
        }
        return;
      }
      let logs = false, rethrows = false;
      walk.simple({ type: 'Program', body, start: node.start, end: node.end }, {
        CallExpression(c) { if (CATCH_LOG_RE.test(src.slice(c.callee.start, c.callee.end))) logs = true; },
        ThrowStatement() { rethrows = true; },
      });
      if (!logs && !rethrows) r.silent++;
    },
  });
  return r;
}

/**
 * 「조용히 삼키는 catch」를 **뜻과 범위를 밝혀** 센다.
 * @param {Object} [opt]
 * @param {'bare'|'empty'|'silent'|'all'} [opt.sense='bare']
 * @param {'server'|'client'|'product'} [opt.scope='product']
 * @returns {{available:boolean, sense:string, scope:string, files:number, unparsed:number,
 *            counts:{all:number,silent:number,empty:number,bare:number}, rows:number, label:string}}
 */
/**
 * 3-44 — `io` catch 가 **어디에 있는지**를 돌려준다. 세는 자는 `countSilentCatches` 와 **같다**.
 * @param {{scope?: 'server'|'client'|'product'}} [opt]
 */
function listIoCatches(opt) {
  const scope = (opt && opt.scope) || 'product';
  if (!Object.prototype.hasOwnProperty.call(CATCH_SCOPES, scope)) throw new Error(`알 수 없는 범위: ${scope}`);
  if (!catchParserAvailable()) return { available: false, scope, rows: [] };
  const rows = [];
  for (const f of _jsFiles(CATCH_SCOPES[scope])) {
    let st;
    try { st = catchStats(fs.readFileSync(f, 'utf8')); } catch (_) { continue; }
    if (!st) continue;
    for (const site of st.ioSites) rows.push({ 파일: path.relative(REPO, f), ...site });
  }
  return { available: true, scope, rows };
}

function countSilentCatches(opt) {
  const o = opt || {};
  const sense = o.sense || 'bare';
  const scope = o.scope || 'product';
  if (!['bare', 'empty', 'silent', 'all', 'io'].includes(sense)) throw new Error(`알 수 없는 뜻: ${sense}`);
  if (!Object.prototype.hasOwnProperty.call(CATCH_SCOPES, scope)) throw new Error(`알 수 없는 범위: ${scope}`);
  if (!catchParserAvailable()) {
    return { available: false, sense, scope, files: 0, unparsed: 0,
      counts: { all: 0, silent: 0, empty: 0, bare: 0, io: 0 }, rows: 0,
      label: 'catch 를 못 셌다 — acorn 이 없다(전이 의존). **0 이 아니라 「못 셌다」이다.**' };
  }
  const files = _jsFiles(CATCH_SCOPES[scope]);
  const counts = { all: 0, silent: 0, empty: 0, bare: 0, io: 0 };
  // ★자리도 같이 모은다 (2026-09-24) — 숫자만 주면 **고치러 갈 곳을 알 수 없다.**
  //   `ioSites` 는 3-44 에서 그 까닭으로 붙었는데 `bare` 에는 없어, 「110」을 줄이려는 사람이
  //   파일을 하나하나 열어 봐야 했다.
  const bareSites = [];
  let unparsed = 0;
  for (const f of files) {
    const r = catchStats(fs.readFileSync(f, 'utf8'));
    if (!r) { unparsed++; continue; }
    for (const k of Object.keys(counts)) counts[k] += r[k];
    for (const b of (r.bareSites || [])) bareSites.push({ 파일: path.relative(REPO, f), ...b });
  }
  const SENSE_LABEL = { bare: '몸통도 주석도 없는 catch', empty: '문장이 없는 catch(주석만 포함)',
    silent: '로그도 없고 다시 던지지도 않는 catch', all: 'catch 전부',
    io: '★**기다리는 일(await)을 조용히 삼키는** catch — 망·파일이 실패해도 화면은 옛 값으로 그려진다' };
  return { available: true, sense, scope, files: files.length, unparsed, counts, rows: counts[sense], bareSites,
    label: `catch ${counts[sense]} (뜻: ${SENSE_LABEL[sense]} · 범위: ${scope} · 파일 ${files.length}${unparsed ? ` · 못 읽은 파일 ${unparsed}` : ''})` };
}

module.exports.CATCH_SCOPES = CATCH_SCOPES;
module.exports.CATCH_LOG_RE = CATCH_LOG_RE;
module.exports.catchParserAvailable = catchParserAvailable;
module.exports.catchStats = catchStats;
module.exports.countSilentCatches = countSilentCatches;
module.exports.listIoCatches = listIoCatches;

// ════════════════════════════════════════════════════════════════════════════
// 2-6b ③ ★**「§8-B 줄번호 인용」의 뜻과 범위** (2026-09-23)
//
// [왜] 독립 4벌이 같은 것을 **14,622 / 14,917 / 12,996** 으로 적었다(G-2).
//   `_SCHEMA §8-B` 자신은 *"위키 안에 6건 · 백로그 안에 12,992건"* 이라 적고 있어 **넷째 값**이 있었다.
//
// [2026-09-23 전수 재측 — 둘은 **정확히** 재현됐다]
//   12,996 = `_dashboard/backlog/` 만          · 건 수
//   14,622 = `backlog/` + `backlog_p1` + `backlog_p3` · 건 수
//   ⚠**14,917 은 재현하지 못했다.** 자 3종(좁은/넓은/아무파일) × 단위 2종(건/줄) ×
//     범위 31조합을 전부 쓸어도 나오지 않는다. **그 벌의 정의가 저장소에 없다.**
//     추측으로 맞추지 않는다 — 못 맞췄다고 적는다(G-34).
//   ⚠`_SCHEMA` 의 12,992 도 지금은 12,996 이다(그 뒤 백로그가 조금 바뀌었다).
//
//   ┌ 뜻 ─────────────────────────────────────────────────────────────┐
//   │ any       `파일.md:123` 꼴이 나오는 **모든 자리**                  │
//   │ citation  그중 **변경이력·날짜 메모가 아닌 것** — 진짜 인용        │
//   └──────────────────────────────────────────────────────────────────┘
//   ┌ 범위 ───────────────────────────────────────────────────────────┐
//   │ backlog      `_dashboard/backlog/` 만            (§8-B 가 센 것)  │
//   │ backlog_all  + `backlog_p1` · `backlog_p3`                       │
//   │ wiki         `wiki/` 전체  — ★여기가 **챗봇이 읽는 곳**이다       │
//   │ dashboard    `_dashboard/` 에서 백로그를 뺀 것 (작업 문서)         │
//   └──────────────────────────────────────────────────────────────────┘
//
// ★**왜 이 숫자가 커도 급하지 않은지**도 뜻이 말해 준다 — 큰 값은 전부 **작업 기록**이고,
//   챗봇이 읽는 `wiki/` 는 한 자릿수다. §8-B 도 같은 이유로 소급 교체를 하지 않기로 했다.
// `legal/` 뿌리 — 이 파일은 `_dashboard/loop/` 에 있다.
const LEGAL = path.resolve(__dirname, '../..');
const LINE_CITE_RE = /[\w가-힣()\[\]·ㆍ_\-]+\.md:\d+/g;
/** 변경이력·날짜 메모 줄 — 진짜 인용이 아니다. */
const LINE_CITE_MEMO_RE = /변경\s*이력|changelog|메모|주석|\(참고\)|^\s*[-*]\s*\d{4}-\d{2}-\d{2}/;
const LINE_CITE_SCOPES = {
  backlog:     ['_dashboard/backlog'],
  backlog_all: ['_dashboard/backlog', '_dashboard/backlog_p1', '_dashboard/backlog_p3'],
  wiki:        ['wiki'],
  dashboard:   ['_dashboard'],           // 아래에서 백로그를 뺀다
};
const LINE_CITE_SENSES = {
  any:      '`파일.md:123` 꼴이 나오는 모든 자리',
  citation: '그중 변경이력·날짜 메모가 아닌 것(진짜 인용)',
};

function _mdFiles(rels, dropBacklog) {
  const out = [];
  for (const rel of rels) {
    const root = path.join(LEGAL, rel);
    (function walk(dir) {
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!(dropBacklog && /(^|\/)backlog(_p\d)?$/.test(p))) walk(p); }
        else if (e.name.endsWith('.md')) out.push(p);
      }
    })(root);
  }
  return [...new Set(out)].sort();
}

/**
 * §8-B 줄번호 인용을 센다. **뜻과 범위를 반드시 함께** 말한다.
 * @param {{sense?: 'any'|'citation', scope?: keyof LINE_CITE_SCOPES}} opt
 */
function countLineCitations(opt) {
  const sense = (opt && opt.sense) || 'citation';
  const scope = (opt && opt.scope) || 'backlog_all';
  if (!Object.prototype.hasOwnProperty.call(LINE_CITE_SENSES, sense)) throw new Error(`알 수 없는 뜻: ${sense}`);
  if (!Object.prototype.hasOwnProperty.call(LINE_CITE_SCOPES, scope)) throw new Error(`알 수 없는 범위: ${scope}`);
  const files = _mdFiles(LINE_CITE_SCOPES[scope], scope === 'dashboard');
  let any = 0, memo = 0;
  const samples = [];
  for (const f of files) {
    let lines;
    try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch (_) { continue; }
    for (let i = 0; i < lines.length; i++) {
      const ms = lines[i].match(LINE_CITE_RE);
      if (!ms) continue;
      any += ms.length;
      if (LINE_CITE_MEMO_RE.test(lines[i])) memo += ms.length;
      else if (samples.length < 5) samples.push(`${path.relative(LEGAL, f)}:${i + 1}  ${lines[i].trim().slice(0, 90)}`);
    }
  }
  const counts = { any, citation: any - memo, memo };
  return {
    sense, scope, files: files.length, counts, rows: counts[sense], samples,
    label: `줄번호 인용 ${counts[sense].toLocaleString()} (뜻: ${LINE_CITE_SENSES[sense]} · 범위: ${scope} · 파일 ${files.length})`,
  };
}

module.exports.LINE_CITE_RE = LINE_CITE_RE;
module.exports.LINE_CITE_SCOPES = LINE_CITE_SCOPES;
module.exports.LINE_CITE_SENSES = LINE_CITE_SENSES;
module.exports.countLineCitations = countLineCitations;

// ════════════════════════════════════════════════════════════════════════════
// 2-6b ④ ★**「_LESSONS 재발률」의 뜻** (2026-09-23)
//
// [왜] 독립 4벌이 **42% / 38.4% / 23.5%** 로 갈렸다(G-2).
//
// [★결론 — 이 항목은 「뜻을 안 정해서」가 아니라 「사람이 판단해서」 갈렸다]
//   재발률은 *"이 교훈이 앞의 것과 **같은 실수**인가"* 를 묻는다. 그건 **읽고 판단**해야 한다.
//   저장소가 이미 같은 병을 진단해 뒀다 — **L-133**:
//     *"채점자가 AI면 측정의 절반이 채점자 흔들림이다. 62문항 중 26건(42%)이 판정이 뒤집혔다."*
//   그때 해법은 **판단을 기계 규칙으로 바꾸는 것**이었다(`regrade.js` → 흔들림 42%→29%).
//   재발률도 똑같이 한다 — **기계가 셀 수 있는 뜻만 남기고, 판단으로 낸 수치는 숫자로 쓰지 않는다.**
//   ⚠42 / 38.4 / 23.5 는 **재현하지 못했다.** 그 벌들의 판단 기준이 저장소에 없고,
//     있었더라도 L-133 대로 흔들렸을 값이다. 추측으로 맞추지 않는다(G-34).
//
//   ┌ 뜻 ─────────────────────────────────────────────────────────────┐
//   │ declared  교훈이 **스스로 재발이라 밝힌 것** — 「재발」「또 했다」  │
//   │           「같은 실수/모양」「세 번째」 같은 말이 본문에 있다.       │
//   │ linked    **앞 교훈 번호(L-N)를 짚은 것** (자기 번호는 뺀다)       │
//   │ either    둘 중 하나라도                                          │
//   │ both      둘 다                                                  │
//   └──────────────────────────────────────────────────────────────────┘
//   ⚠**이 넷은 「같은 실수인가」가 아니라 「그렇게 적혀 있나」를 센다.** 뜻이 다르므로
//     4벌의 값과 견주면 안 된다 — 견주는 순간 ⑥이 다시 시작된다.
const LESSONS_MD = path.join(LEGAL, '_LESSONS.md');
const RECUR_DECLARED_RE = /재발|또 (했|걸|틀|같은)|다시 (걸|틀|했)|같은 (실수|모양|병|자리)|되풀이|세 번째|두 번째/;
const RECUR_SENSES = {
  declared: '교훈이 스스로 재발이라 밝힌 것',
  linked:   '앞 교훈 번호(L-N)를 짚은 것',
  either:   '둘 중 하나라도',
  both:     '둘 다',
};

/** `_LESSONS.md` 를 교훈 단위로 자른다. @returns {{no:number, body:string}[]} */
function lessonBlocks() {
  let t;
  try { t = fs.readFileSync(LESSONS_MD, 'utf8'); } catch (_) { return []; }
  const out = [];
  for (const b of t.split(/\n(?=## L-\d+)/)) {
    const m = /^## L-(\d+)/.exec(b);
    if (m) out.push({ no: Number(m[1]), body: b });
  }
  return out;
}

/**
 * 재발률을 **기계로 셀 수 있는 뜻**으로만 센다.
 * ⚠"같은 실수인가"를 판단하지 않는다 — 그건 사람이 읽을 일이고, 숫자로 쓰면 흔들린다(L-133).
 */
function countLessonRecurrence(opt) {
  const sense = (opt && opt.sense) || 'declared';
  if (!Object.prototype.hasOwnProperty.call(RECUR_SENSES, sense)) throw new Error(`알 수 없는 뜻: ${sense}`);
  const blocks = lessonBlocks();
  const nums = blocks.map((b) => b.no);
  const hit = { declared: [], linked: [], either: [], both: [] };
  for (const { no, body } of blocks) {
    const d = RECUR_DECLARED_RE.test(body);
    const l = (body.match(/L-(\d+)/g) || []).some((x) => Number(x.slice(2)) !== no);
    if (d) hit.declared.push(no);
    if (l) hit.linked.push(no);
    if (d || l) hit.either.push(no);
    if (d && l) hit.both.push(no);
  }
  const total = blocks.length;
  const rows = hit[sense].length;
  const missing = total ? [...Array(Math.max(...nums) - Math.min(...nums) + 1)]
      .map((_, i) => Math.min(...nums) + i).filter((x) => !nums.includes(x)) : [];
  return {
    sense, total, rows, missing,
    pct: total ? Math.round((rows / total) * 1000) / 10 : 0,
    samples: hit[sense].slice(0, 5).map((n) => 'L-' + n),
    label: `재발 ${rows} / 교훈 ${total} = ${total ? ((rows / total) * 100).toFixed(1) : '0.0'}% `
         + `(뜻: ${RECUR_SENSES[sense]} · 범위: _LESSONS.md 전체`
         + `${missing.length ? ` · 결번 ${missing.join('·')}` : ''})`,
  };
}

module.exports.RECUR_SENSES = RECUR_SENSES;
module.exports.lessonBlocks = lessonBlocks;
module.exports.countLessonRecurrence = countLessonRecurrence;

// ════════════════════════════════════════════════════════════════════════════
// 2-6b ⑤ ★**「위키가 안 꺼낸 별표」— 자를 하나 더 만들지 않는다** (2026-09-23)
//
// [왜] 독립 3벌이 **57~316 / 1,953 / 5(기준법)·162(타부처)** 로 갈렸다(G-2).
//
// [★재현 시도와 결과 — 정직하게]
//   범위를 다섯 가지로 갈라 전수를 다시 쟀다(2026-09-23):
//     별표 폴더 아래 전부        7,471 중 안 꺼냄 3,729
//     별표 폴더 · 「별표」만      2,703 중 안 꺼냄 1,440
//     별표 폴더 · 서식/별지 제외  2,716 중 안 꺼냄 1,446
//     기준법(15_·자치 제외)      4,684 중 안 꺼냄 2,659
//     15_관련타부처              2,787 중 안 꺼냄 1,070
//   **세 값 중 어느 것도 나오지 않았다.** 그 벌들의 정의가 저장소에 없다.
//   ⚠추측으로 맞추지 않는다(G-34).
//
// [★그래서 자를 하나 더 만들지 않는다]
//   여기서 여섯 번째 수를 만들면 **그게 바로 ⑥을 다시 저지르는 일**이다.
//   이 저장소에는 이미 **뜻이 분명한 자가 둘** 있고, 게이트가 매번 돌린다:
//
//   ┌ 이미 있는 자 ───────────────────────────────────────────────────┐
//   │ V5-11  `annex_ready.js`     **위키 근거 줄이 짚은 고시 별표를**    │
//   │        (별표 도달성)         **눌러 열 수 있나** — 줄 단위.        │
//   │        실측 328줄 중 열림 321 · 그 별표가 없다 2 · 고시 못 고름 5   │
//   │ V5-21a `byl_bare_ready.js`  **계층 접두 없는 별표 파일이 열리나**  │
//   │        (파일 도달성)         — 파일 단위.                          │
//   │        실측 2,032개 중 열린다 1,657 · 번호어긋남 178 · 선언못읽음 29│
//   └──────────────────────────────────────────────────────────────────┘
//   **둘은 다른 물음이다** — 하나는 「위키가 짚은 것이 열리나」(줄), 하나는
//   「파일이 열쇠를 갖췄나」(파일). 「안 꺼낸 별표」라는 한 이름이 이 둘과, 그리고
//   위 다섯 범위와 뒤섞여 세 값이 나온 것이다.
//
// ⚠**「위키가 안 꺼낸 별표」라는 이름은 이제 쓰지 않는다.** 물음을 둘 중 하나로 부른다:
//     "위키가 짚은 별표가 열리나"  → V5-11
//     "별표 파일이 열쇠를 갖췄나"  → V5-21a
//   ★이름 하나에 자가 여럿이면 **자를 늘리지 말고 이미 있는 자에 이름을 붙인다.**
const ANNEX_RULERS = {
  'V5-11': { 도구: 'annex_ready.js',     물음: '위키 근거 줄이 짚은 고시 별표를 눌러 열 수 있나', 단위: '줄' },
  'V5-21a': { 도구: 'byl_bare_ready.js', 물음: '계층 접두 없는 별표 파일이 열쇠를 갖췄나',       단위: '파일' },
};
module.exports.ANNEX_RULERS = ANNEX_RULERS;

// ════════════════════════════════════════════════════════════════════════════
// 「사람이 봐야 한다」 표시 — 행정규칙의 `⚠REVIEW` (2026-09-23 신설, G-24 · 2-19)
//
// [왜 여기에 적나] 등록부(G-24)는 *"「원문 대조 필요」 표시가 **147개** 행정규칙에
//   남아 있고 그중 **131개**를 위키가 인용한다"* 고 적어 두었다. 오늘 재 보니
//   **그 두 숫자를 어떤 자로도 재현할 수 없었다.** 「원문 대조 필요」라는 문구가
//   든 파일은 928개 중 **6개**뿐이다.
//
//   ★재현된 것은 **범위 하나**였다 — `행정규칙` 폴더 **바로 아래** `.txt`,
//   하위폴더 제외 = **928개**(정확히 일치). 범위를 안 적어 두면 같은 이름으로
//   2,285(하위폴더 포함) 도, 739(도메인 01~14) 도 나온다.
//
// [★뜻에 따라 값이 갈린다 — 그래서 뜻마다 이름을 준다] 2026-09-23 실측:
//     anywhere  파일 어디든 `⚠REVIEW`        234 / 928
//     head5     머리 5줄 안에 `⚠REVIEW`      178
//     first     첫 줄에 `⚠REVIEW`             36
//     phrase    「원문 대조 필요」 문구          6
//   **어느 하나가 옳은 것이 아니다.** 물음이 다르면 값이 다른 것이 정상이고,
//   물음을 안 적는 것이 병이다(뿌리 사슬 ⑥).
//
// [★진짜 발견 — 표시가 까닭을 안 적는다] 괄호로 묶인 표시 덩어리 **875개** 중
//   **812개(93%)가 맨 `(⚠REVIEW)`** 이고, 그 812개가 **파일 54개**에 몰려 있다.
//   "사람이 봐야 한다"고만 적고 **무엇을 봐야 하는지는 안 적은** 것이다.
//   까닭이 없으면 사람도 무엇을 대조해야 할지 모르고, 세어도 줄일 수가 없다.
// ════════════════════════════════════════════════════════════════════════════
const ADMRUL_SCOPE = {
  뜻: '행정규칙 폴더 **바로 아래** .txt (하위폴더 제외)',
  실측: 928,
  잰날: '2026-09-23',
};
const REVIEW_MARK = '⚠REVIEW';
// 괄호/대괄호로 묶인 표시 한 덩어리. 괄호 안에 또 괄호가 없는 것만 본다.
const REVIEW_CHUNK_RE = /[([][^()[\]]{0,200}?⚠REVIEW[^()[\]]{0,200}?[)\]]/g;
const REVIEW_SENSES = {
  anywhere: '파일 어디든 ⚠REVIEW 가 있다',
  head5:    '머리 5줄 안에 ⚠REVIEW 가 있다',
  first:    '첫 줄에 ⚠REVIEW 가 있다',
  phrase:   '「원문 대조 필요」 라는 문구가 있다',
  // ★2026-09-24 (3-28 / G-24) 에 더한 뜻 — **`anywhere` 가 더는 내려갈 수 없게 됐기 때문**이다.
  //   대조를 마치면 표시를 **지우지 않고** 「대조 기록」으로 바꿔 적고 옛 표시를 괄호 안에 남긴다
  //   (`✅원문 대조 완료(…) (옛 표시는 지우지 않는다 — ⚠REVIEW: …)`). 규약이 그렇다(옛 서술 보존).
  //   그러면 `anywhere` 는 **확인을 끝낸 파일에서도 계속 1로 센다** — 줄어드는 것을 볼 수 없다.
  //   ⇒ **확인이 남았는지**를 따로 센다: 그 파일에 대조 기록(✅·🟡·⚠)이 **하나도 없을 때만** 센다.
  남음:     '⚠REVIEW 가 있는데 **대조 기록이 하나도 없다**(확인이 남았다)',
};
/** 대조를 해 본 흔적 — 이 셋 중 하나가 있으면 「기계가 이미 들여다본 파일」이다. */
const REVIEW_DONE_RE = /(✅원문 대조 완료|🟡기계 대조 \d+%|⚠이 길로는 대조 불가)/;

/** 행정규칙 본문 파일 목록 — ADMRUL_SCOPE 의 뜻 그대로. */
function admrulFiles() {
  const out = [];
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (path.basename(dir) === '행정규칙' && e.name.endsWith('.txt')) out.push(p);
    }
  };
  walk(path.join(LEGAL, 'raw'));
  return out;
}

/**
 * 뜻(sense)마다 「표시가 달린 행정규칙」을 센다.
 * ⚠sense 를 안 주면 던진다 — 뜻을 안 정한 채 세는 것이 ⑥ 그 자체다.
 */
function countAdmrulReview(sense) {
  if (!REVIEW_SENSES[sense]) {
    throw new Error(`뜻을 정해야 센다(⑥). 쓸 수 있는 뜻: ${Object.keys(REVIEW_SENSES).join(' · ')}`);
  }
  const files = admrulFiles();
  const hit = [];
  for (const p of files) {
    let t;
    try { t = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
    const lines = t.split('\n');
    const ok = sense === 'anywhere' ? t.includes(REVIEW_MARK)
             : sense === 'head5'    ? lines.slice(0, 5).join('\n').includes(REVIEW_MARK)
             : sense === 'first'    ? (lines[0] || '').includes(REVIEW_MARK)
             : sense === '남음'      ? (t.includes(REVIEW_MARK) && !REVIEW_DONE_RE.test(t))
             :                        t.includes('원문 대조 필요');
    if (ok) hit.push(p);
  }
  return { sense, 뜻: REVIEW_SENSES[sense], 전체: files.length, 걸린파일: hit.length, files: hit };
}

/** 표시 덩어리를 까닭이 적힌 것과 **맨 `(⚠REVIEW)`** 로 가른다. */
function admrulReviewReasons() {
  let withWhy = 0, bare = 0;
  const bareFiles = new Set();
  for (const p of admrulFiles()) {
    let t;
    try { t = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
    const ms = t.match(REVIEW_CHUNK_RE);
    if (!ms) continue;
    for (const m of ms) {
      // 표시 말고 남는 글자가 있나 — 괄호·표시·공백·쉼표를 걷어 낸다
      const rest = m.replace(/[()[\]]/g, '').replace(REVIEW_MARK, '').replace(/[\s:：,·]/g, '');
      if (rest) withWhy++; else { bare++; bareFiles.add(p); }
    }
  }
  return { 덩어리: withWhy + bare, 까닭있음: withWhy, 맨표시: bare, 맨표시파일: bareFiles.size };
}

module.exports.ADMRUL_SCOPE = ADMRUL_SCOPE;
module.exports.REVIEW_SENSES = REVIEW_SENSES;
module.exports.countAdmrulReview = countAdmrulReview;
module.exports.admrulReviewReasons = admrulReviewReasons;

// ════════════════════════════════════════════════════════════════════════════
// §5-D ⓕ 「각 호 N개」를 세는 법 (2026-09-23 신설, G-7)
//
// [규약] `_SCHEMA §5-D ⓕ`(사용자 확정 2026-09-19) — *"2026-09-19 2차 재점검에서 나온
//   **틀린 값 중 가장 많은 유형이 「각 호 N개」 오산**이었다."* 셋이 섞여서 그렇다:
//     · 가지번호(`2의2`·`3의2`)   → **한 개로 센다** (원문에서 독립된 호다)
//     · `삭제 <연월일>` 인 호      → **세지 않는다** (안내할 내용이 없다)
//     · 마지막 호의 번호           → **개수와 같지 않을 수 있다**
//
// [왜 여기에] 이 규약을 읽는 코드가 **0** 이었다(G-7). 그런데 §6-F(G-5)와 달리
//   이것은 **기계가 정확히 잴 수 있다** — 규칙이 글이 아니라 셈이기 때문이다.
//   ★게다가 규약이 **맞춰 볼 실례 둘을 직접 적어 두었다**(아래 HO_FIXTURES).
//   규약이 자기 시험을 들고 온 셈이라, 자를 만들자마자 맞는지 확인할 수 있었다.
//
// ⚠**목(가.·나.·다.)은 호가 아니다** — 들여쓰기가 더 깊고 한글이라 숫자 패턴에 안 걸린다.
// ════════════════════════════════════════════════════════════════════════════
const HANG_MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
// 호 머리: 들여쓴 `N.` 또는 `N의M.` — 뒤에 공백이 와야 한다(`제2호의2` 같은 인용과 구별)
const HO_HEAD_RE = /^[ \t]+(\d+(?:의\d+)?)\.[ \t]/;

/** 규약이 직접 적어 둔 맞춤 실례. 자가 이 둘을 못 맞히면 그 자가 틀린 것이다. */
const HO_FIXTURES = [
    { 파일: '04_선박해운/선박직원법/법률.txt', 조: '제9조', 항: 1,
      기대: { 살아있는: 7, 마지막번호: '8', 삭제: 1 },
      근거: '§5-D ⓕ — "살아 있는 호는 7개, 마지막 번호는 8"' },
    { 파일: '04_선박해운/선박직원법/시행령.txt', 조: '제2조', 항: null,
      기대: { 가지번호: ['2의2', '2의3'] },
      근거: '§5-D ⓕ — "원문 목록은 2의2·2의3 으로 찍힌다"' },
];

/**
 * 조 본문 하나를 받아 항(①②③)마다 호를 센다.
 * 항 표시가 없으면(=조 전체가 한 덩이) `항: 0` 하나로 돌려준다.
 * @returns [{ 항, 번호들, 살아있는, 삭제, 마지막번호, 가지번호 }]
 */
function countHo(articleText) {
    const lines = String(articleText || '').split('\n');
    const groups = [];
    let cur = { 항: 0, 번호들: [], 삭제: 0, 가지번호: [] };
    for (const line of lines) {
        const first = line.trimStart()[0];
        if (first && HANG_MARKS.includes(first)) {
            if (cur.번호들.length || groups.length === 0) groups.push(cur);
            cur = { 항: HANG_MARKS.indexOf(first) + 1, 번호들: [], 삭제: 0, 가지번호: [] };
            continue;
        }
        const m = HO_HEAD_RE.exec(line);
        if (!m) continue;
        const no = m[1];
        const body = line.slice(m[0].length).trim();
        if (/^삭제/.test(body)) { cur.삭제++; continue; }    // ⚠삭제는 세지 않는다
        cur.번호들.push(no);
        if (no.includes('의')) cur.가지번호.push(no);
    }
    groups.push(cur);
    return groups
        .filter((g) => g.번호들.length || g.삭제)
        .map((g) => ({
            항: g.항,
            번호들: g.번호들,
            살아있는: g.번호들.length,              // ★이것이 "각 호 N개" 의 N 이다
            삭제: g.삭제,
            // 마지막 번호는 삭제된 것을 포함해 **원문에 찍힌 마지막**이다
            마지막번호: g.번호들.length ? g.번호들[g.번호들.length - 1] : null,
            가지번호: g.가지번호,
        }));
}

/** raw 파일에서 `[제N조]` 한 덩이를 떼어 온다. */
function articleBlock(file, 조) {
    let t;
    try { t = fs.readFileSync(path.join(LEGAL, 'raw', file), 'utf8'); } catch (_) { return null; }
    const i = t.indexOf('[' + 조 + ']');
    if (i < 0) return null;
    const j = t.indexOf('\n[제', i + 1);
    return t.slice(i, j < 0 ? undefined : j);
}

module.exports.HO_FIXTURES = HO_FIXTURES;
module.exports.countHo = countHo;
module.exports.articleBlock = articleBlock;

// ════════════════════════════════════════════════════════════════════════════
// 「라운드 번호」 — **한 표기에 뜻이 넷이다. 견주지 않는다** (2026-09-23 신설, G-23)
//
// [무엇이 문제였나] `12R`·`12라운드` 라는 **같은 표기**가 자리마다 다른 것을 가리킨다.
//   어디에도 그 구분이 안 적혀 있어, 조사자가 둘을 견주고 **「16법 어긋남」이라는 허수**를 냈다.
//
// [★오늘 나도 똑같이 당했다 — 그래서 이 항목을 만든다] 2026-09-23 에 "정말 두 체계인가"를
//   재려고 감사파일의 최대 라운드와 위키의 최대 라운드를 견줬더니 74법 중 **50법이 다르다**고
//   나왔다. 큰 차이를 열어 보니:
//     감사 566  ← 산문이다:  "정독만으로는 **566라운드**까지도 …"
//     위키 289  ← 항목 번호다: "#228·#233·#235·**#289R**) 반영"
//   **등록부가 경고한 바로 그 실패를 재려다가 그대로 재현했다.**
//
// [그래서 무엇을 하나 — 비교기를 만들지 않는다]
//   `ANNEX_RULERS`(2-6b⑤) 때와 같은 판단이다. **뜻이 갈리는데 표기가 하나면, 자를 만드는 것이
//   아니라 뜻에 이름을 붙이고 「견주지 말라」고 적는다.** 자를 만들면 그 자가 곧 허수를 낳는다.
// ════════════════════════════════════════════════════════════════════════════
const ROUND_SENSES = {
  오케스트레이터: { 어디: '위키 본문·변경 이력의 `rN`·`NR` 마커',
                    뜻: '그 시점의 **전체 사이클** 번호 — 법마다 같은 날 같은 값이다' },
  법자신:        { 어디: '`_dashboard/audit/<법>.md` 의 `# 품질감사 — … (N라운드…)`',
                    뜻: '**그 법이 몇 번째로 감사받았나** — 법마다 값이 다르다' },
  항목번호:      { 어디: '`#289R` 처럼 `#` 뒤에 붙은 것',
                    뜻: '**라운드가 아니다.** 백로그·감사 항목의 일련번호다' },
  산문:          { 어디: '문장 속 수사',
                    뜻: '**라운드가 아니다.** 예) "정독만으로는 566라운드까지도"' },
};

// ⚠★**견주는 함수를 두지 않는다.** 위 넷은 **같은 표기**를 쓰고, 글만 보고는 갈라낼 수 없다.
//   비교가 필요하면 **사람이 그 자리를 열어 어느 뜻인지 먼저 정한 뒤** 견준다.
//   (`test_counting_dict.js` 가 이 함수가 **없다는 것**을 시험으로 못박는다 — ANNEX_RULERS 와 같다.)
module.exports.ROUND_SENSES = ROUND_SENSES;

// ════════════════════════════════════════════════════════════════════════════
// 3-47 — ★**어떤 파일이 `[제N조]` 머리줄을 가져야 하는가** (2026-09-23)
//
// [왜 여기에 적나] V5-31(`article_head_missing_gate.js`)은 지금 `raw/_자치법규` 본문만 본다.
//   넓히려다 **두 번 틀렸다** — `raw/` 전체를 쓸면 수천 개가 나오는데 그 대부분은
//   **애초에 조 머리줄을 가질 자리가 아니다**. 범위를 안 정하고 넓히면 게이트가 수천 개를
//   결함이라 외치고 **아무도 안 듣게 된다**(뿌리 사슬 ④).
//   그래서 「세는 법」을 여기 **한 곳**에 적는다(⑥).
//
// [실측 — 2026-09-23, `raw/` 전수]
//   머리줄이 없고 평문 `제N조` 가 2회 이상인 `.txt` **5,502개**를 이름·자리로 갈랐다:
//     별표 폴더        4,434   별표·서식 본문이다. 조 머리줄을 **가지면 안 된다**
//     행정규칙           902   고시는 `제N조(` **줄머리 꼴**이다(L-54). V5-11 소관
//     그 밖(도메인 본문)   94   ← **여기만이 물음이다**
//     _이미지(OCR)        43   OCR 글. 머리줄이 없는 게 당연하다
//     부칙 파일            26   부칙은 `[제N조]` 로 안 적는다
//     _자치법규 본문         3   전부 `…_별표N_…발췌.txt` — 별표 발췌다
//   ⚠전에 적어 둔 **2,612** 는 이것과 다른 자다(그때는 제외 목록을 달리 썼다).
//     **두 값을 견주지 않는다** — 같은 것을 잰 것이 아니다(⑥).
//
// [94 를 다시 갈랐다 — 파일 이름이 근거다]
//     *_발췌.txt              51   **발췌본**. 조 머리줄을 가져야 하는지는 **3-3 과 함께 정한다**
//     조약*.txt               ~15  조약은 조 구조가 다르다 → **3-45**
//     계층 본문(법률/시행령/    12   ★**이것이 결함이다.** 아래 TIER_BODY_SCOPE
//       시행규칙/대통령령).txt
//     단편 파일                 ~16 `조문_제20조_…` 처럼 조 하나만 떼어 둔 것
//
// [그래서 규약]
//   **가져야 한다**  : `raw/<도메인>/<법>/` 바로 아래의 **계층 본문 파일**
//                     (`법률.txt` · `시행령.txt` · `시행규칙.txt` · `대통령령.txt`)
//                     그리고 `raw/_자치법규/<시도>/<조례>/` 바로 아래의 같은 이름들
//   **가지면 안 된다**: `별표/` · `행정규칙/` · `_이미지/` · `_원본첨부/` · `_구판/` · `_대기/` · `부칙*.txt`
//   **아직 안 정했다**: `*_발췌.txt`(3-3) · `조약*.txt`(3-45) · 조 하나만 떼어 둔 단편
//     ⚠**안 정한 것을 결함으로 세지 않는다.** 정하는 것은 사람 몫이다(G-34).
// ════════════════════════════════════════════════════════════════════════════
const TIER_BODY_FILES = ['법률.txt', '시행령.txt', '시행규칙.txt', '대통령령.txt'];
const HEAD_SKIP_DIRS = new Set(['별표', '행정규칙', '_이미지', '_원본첨부', '_구판', '_대기']);

const ARTICLE_HEAD_SCOPES = {
  자치법규: { 뜻: '`raw/_자치법규/<시도>/<조례>/` 바로 아래 계층 본문', 실측_20260923: 0 },
  계층본문: { 뜻: '`raw/**/<법>/` 바로 아래 계층 본문 전부(자치법규 포함)', 실측_20260923: 12 },
};

/**
 * 조 머리줄을 **가져야 하는데 없는** 파일을 센다.
 * @param {{scope?: keyof ARTICLE_HEAD_SCOPES}} opt
 */
function countArticleHeadMissing(opt) {
  const scope = (opt && opt.scope) || null;
  if (!scope) throw new Error(`범위를 정해야 한다 (쓸 수 있는 것: ${Object.keys(ARTICLE_HEAD_SCOPES).join('·')})`);
  if (!Object.prototype.hasOwnProperty.call(ARTICLE_HEAD_SCOPES, scope)) {
    throw new Error(`알 수 없는 범위: ${scope}`);
  }
  const RAWDIR = path.join(LEGAL, 'raw');
  const root = scope === '자치법규' ? path.join(RAWDIR, '_자치법규') : RAWDIR;
  const HEAD = /(?:^|\n)\[제\d+조/;
  const PLAIN = /제\d+조/g;
  const out = [];
  const walk = (dir) => {
    if (HEAD_SKIP_DIRS.has(path.basename(dir))) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!TIER_BODY_FILES.includes(e.name)) continue;          // ★계층 본문만 본다
      let t;
      try { t = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
      if (HEAD.test(t)) continue;
      const plain = (t.match(PLAIN) || []).length;
      if (plain < 2) continue;
      out.push({ 파일: path.relative(RAWDIR, p), 평문조: plain, 깨짐: /0{6,}/.test(t) });
    }
  };
  walk(root);
  return { scope, scopeLabel: ARTICLE_HEAD_SCOPES[scope].뜻, rows: out, count: out.length };
}

module.exports.TIER_BODY_FILES = TIER_BODY_FILES;
module.exports.HEAD_SKIP_DIRS = HEAD_SKIP_DIRS;
module.exports.ARTICLE_HEAD_SCOPES = ARTICLE_HEAD_SCOPES;
module.exports.countArticleHeadMissing = countArticleHeadMissing;

// ════════════════════════════════════════════════════════════════════════════
// 2-6b ⑥ ★**「인용 정확도」** — G-2 의 마지막 한 자리 (2026-09-24 신설)
//
// [왜 여기까지 남아 있었나] G-2 는 세 가지를 들었다 — 「인용 정확도」·「catch」·「재발률」.
//   뒤의 둘은 2026-09-23(2-6b)에 닫혔는데, **「인용 정확도」만 뜻이 안 정해진 채 남았다.**
//   등록부 G-2 칸이 계속 🟡였던 까닭이 이것이다.
//
// [★다섯 벌이 낸 다섯 값 — 그런데 이번엔 정의가 적혀 있었다] `13_ROUND2_SYNTHESIS §1`:
//     F  854 (자기 법 완결문만)          91.1%
//     G  2,579 (절 한정 + 조문꼴 어미)    78.3%
//     D  1,672                          76.9%
//     나 1,654                          78.4%
//     E  1,801 (인용 뒤 40자에 조문표기)  61.5%
//   ★**데이터가 흔들린 게 아니라 자가 다섯 벌이다.** 갈리는 자리는 딱 둘이었다:
//     ① 무엇을 「인용」으로 볼 것인가 (따옴표만? 완결문만? 조문표기가 붙은 것만?)
//     ② 무엇까지 씻고 볼 것인가 — `(이하 "…"라 한다)` 는? 한자 `(吃水)` 는? `<개정 …>` 는?
//   `_SCHEMA §0-E 규칙 3` 은 *"정규화 없이 비교하지 않는다"* 고만 적고 **무엇을 씻으라고는
//   안 적었다.** 그래서 다섯이 각자 정했다. 여기서 그 둘을 **이름 있는 축**으로 못박는다.
//
// [세는 법 — 뜻(무엇을 인용으로 보나) × 씻기(무엇을 지우고 보나) × 범위]
const CITE_SENSES = {
  따옴표:   '큰따옴표 안 8자 이상. 가장 넓다 — 우리 편집어까지 들어온다',
  우리말뺌: '따옴표 중 **우리가 쓴 말**(대조·확인·미인덱스·[제N조] 등)을 뺀 것. 기본값',
  조문꼴:   '우리말뺌 + **조문 어미로 끝나는 완결문**만(…한다/하여야 한다/할 수 있다/없다)',
  조문표기: '우리말뺌 + 인용 **뒤 40자 안에 「제N조」** 가 붙은 것만',
};
const CITE_WASH = {
  공백만:   '공백·줄바꿈만 지운다. 원문은 줄을 접어 두는 자리가 많다',
  괄호까지: '공백 + **( ) 안**을 통째로 지운다 — 어긋남의 2/3 가 괄호·단서 생략이다',
};
// [★이 자가 답하는 물음] "위키가 큰따옴표로 인용한 법 문장이, 그 법의 raw 안에 **글자 그대로
//   있는가**". ⚠**「위키가 틀렸다」는 뜻이 아니다** — 못 찾은 것 중엔 표로 쪼개진 원문,
//   타법 인용, 우리 작문이 섞여 있다(2라운드 갈래표 참조). 그래서 이 값은 **후보의 크기**다.
//   갈래를 가르는 일은 3-41 이 한다.
const CITE_ART_END = /(한다|하여야\s*한다|해야\s*한다|할\s*수\s*있다|할\s*수\s*없다|하지\s*아니한다|본다|말한다|된다|아니한다)[.。]?\s*$/;
const CITE_OURS    = /(감사|H-\d|raw\/|대조|확인|미인덱스|승격|승급|불가\b|\[제\d+조\]|wiki|판단할 수 없다|권장|검수|아니다|없다$|이다$|미반영|본 위키|이 쪽)/;
const CITE_BOX     = '─│┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋';

function citeWash(s, wash) {
  let t = String(s == null ? '' : s).normalize('NFC');
  t = t.replace(/\*\*|~~|`|<[^>]{0,40}>/g, '');
  if (wash === '괄호까지') t = t.replace(/[(（][^)）]{0,80}[)）]/g, '');
  t = [...t].filter((ch) => !CITE_BOX.includes(ch) && !'“”"\''.includes(ch)).join('');
  return t.replace(/\s+/g, '');
}

/** 한 쪽이 인용한 것들 → [{글, 조문표기붙음}] (뜻 거르기 전) */
function citeQuotes(body) {
  const out = [];
  for (const re of [/“([^“”]{8,})”/g, /"([^"]{8,})"/g]) {
    let m;
    while ((m = re.exec(body))) {
      const tail = body.slice(m.index + m[0].length, m.index + m[0].length + 40);
      out.push({ 글: m[1], 조문표기붙음: /제\s*\d+\s*조/.test(tail) });
    }
  }
  return out;
}

function citeKeep(q, sense) {
  if (sense === '따옴표') return true;
  if (CITE_OURS.test(q.글)) return false;
  if (sense === '우리말뺌') return true;
  if (sense === '조문표기') return q.조문표기붙음;
  if (sense === '조문꼴') return CITE_ART_END.test(q.글.trim());
  throw new Error(`알 수 없는 뜻: ${sense} (쓸 수 있는 것: ${Object.keys(CITE_SENSES).join('·')})`);
}

/** 그 쪽이 말하는 법의 raw 본문들 (씻어서 캐시한다) */
function citeRawBodies(page, wash, cache) {
  const slug = path.basename(page).split('__')[0];
  const key = `${slug}|${wash}`;
  if (cache.has(key)) return cache.get(key);
  const map = cache.get('_map') || (() => {
    let m = {};
    try { m = JSON.parse(fs.readFileSync(path.resolve(WIKI, '..', '_dashboard', 'law_raw_paths.json'), 'utf8')); } catch (_e) { /* 지도가 없으면 잴 수 없음으로 떨어진다 */ }
    cache.set('_map', m); return m;
  })();
  const rel = map[slug];
  let out = [];
  if (rel) {
    const REPO_ROOT = path.resolve(WIKI, '..', '..', '..', '..');
    let base = path.resolve(REPO_ROOT, rel);
    if (!fs.existsSync(base)) base = '';
    else if (!fs.statSync(base).isDirectory()) base = path.dirname(base);
    if (base) {
      (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const fp = path.join(d, e.name);
          if (e.isDirectory()) walk(fp);
          else if (e.name.endsWith('.txt')) {
            try { out.push(citeWash(fs.readFileSync(fp, 'utf8'), wash)); } catch (_e) { /* 못 읽는 파일은 없는 셈 친다 */ }
          }
        }
      })(base);
    }
  }
  cache.set(key, out);
  return out;
}

/**
 * ★「인용 정확도」 — 뜻 × 씻기 × 범위를 **반드시 함께** 말한다.
 * @param {{sense?:string, wash?:string, scope?:string, wikiDir?:string}} [opt]
 * @returns {{뜻, 씻기, 범위, 잰것, 찾음, 못찾음, 잴수없음, 정확도, 못찾은것:Array}}
 */
function citeAccuracy(opt) {
  const o = opt || {};
  const sense = o.sense || '조문꼴';
  const wash = o.wash || '공백만';
  const scope = o.scope || 'all';
  const pool = o.pool || '제법만';
  const match = o.match || '통째로';
  if (!CITE_SENSES[sense]) throw new Error(`알 수 없는 뜻: ${sense} (쓸 수 있는 것: ${Object.keys(CITE_SENSES).join('·')})`);
  if (!CITE_WASH[wash]) throw new Error(`알 수 없는 씻기: ${wash} (쓸 수 있는 것: ${Object.keys(CITE_WASH).join('·')})`);
  if (!CITE_POOL[pool]) throw new Error(`알 수 없는 본 곳: ${pool} (쓸 수 있는 것: ${Object.keys(CITE_POOL).join('·')})`);
  if (!CITE_MATCH[match]) throw new Error(`알 수 없는 맞춤법: ${match} (쓸 수 있는 것: ${Object.keys(CITE_MATCH).join('·')})`);
  const cache = new Map();
  let 찾음 = 0, 못찾음 = 0, 잴수없음 = 0;
  const 못찾은것 = [];
  for (const f of wikiFiles(scope, o.wikiDir)) {
    const body = stripFrontmatter(fs.readFileSync(f, 'utf8'));
    const qs = citeQuotes(body).filter((q) => citeKeep(q, sense));
    if (!qs.length) continue;
    const own = citeRawBodies(f, wash, cache);
    const bodies = pool === '모든raw' ? own.concat(citeWideBodies(wash)) : own;
    if (!bodies.length) { 잴수없음 += qs.length; continue; }
    for (const q of qs) {
      const parts = String(q.글).split(/…+|\.{3,}/).map((x) => citeWash(x, wash)).filter(Boolean);
      if (!parts.length) { 잴수없음 += 1; continue; }
      let hit = bodies.some((b) => parts.every((pt) => b.includes(pt)));
      if (!hit && match === '창9할') hit = Math.min(...parts.map((pt) => citeWinRatio(pt, bodies))) >= 0.9;
      if (hit) 찾음 += 1;
      else { 못찾음 += 1; if (못찾은것.length < 40) 못찾은것.push({ 쪽: path.relative(WIKI, f), 글: q.글.slice(0, 90) }); }
    }
  }
  const 잰것 = 찾음 + 못찾음;
  return { 뜻: sense, 씻기: wash, 범위: scope, 본곳: pool, 맞춤법: match, 잰것, 찾음, 못찾음, 잴수없음,
           정확도: 잰것 ? +(100 * 찾음 / 잰것).toFixed(1) : 0, 못찾은것 };
}

module.exports.CITE_SENSES = CITE_SENSES;
module.exports.CITE_WASH = CITE_WASH;
module.exports.citeQuotes = citeQuotes;
module.exports.citeKeep = citeKeep;
module.exports.citeWash = citeWash;
module.exports.citeAccuracy = citeAccuracy;

/**
 * ★뜻 × 씻기 × 범위 표를 **한 번 훑어서** 낸다 (칸마다 다시 훑으면 20분이 걸린다).
 * @returns {{[뜻]: {[씻기]: {[범위]: {잰것, 찾음, 정확도}}}}}
 */
function citeAccuracyGrid(opt) {
  const o = opt || {};
  const senses = o.senses || Object.keys(CITE_SENSES);
  const washes = o.washes || Object.keys(CITE_WASH);
  const scopes = o.scopes || ['concepts', 'indexed', 'all'];
  const inScope = { concepts: ['concepts'], indexed: ['concepts', 'statutes', 'annexes', 'comparisons'], all: null };
  const cache = new Map();
  const cell = {};
  for (const s of senses) { cell[s] = {}; for (const w of washes) { cell[s][w] = {}; for (const sc of scopes) cell[s][w][sc] = { 잰것: 0, 찾음: 0 }; } }
  for (const f of wikiFiles('all', o.wikiDir)) {
    const top = path.relative(o.wikiDir || WIKI, f).split(path.sep)[0];
    const mine = scopes.filter((sc) => inScope[sc] === null || inScope[sc].includes(top));
    if (!mine.length) continue;
    const qs = citeQuotes(stripFrontmatter(fs.readFileSync(f, 'utf8')));
    if (!qs.length) continue;
    const bodies = {};
    for (const w of washes) bodies[w] = citeRawBodies(f, w, cache);
    for (const q of qs) {
      const keeps = senses.filter((s) => citeKeep(q, s));
      if (!keeps.length) continue;
      for (const w of washes) {
        if (!bodies[w].length) continue;
        const parts = String(q.글).split(/…+|\.{3,}/).map((x) => citeWash(x, w)).filter(Boolean);
        if (!parts.length) continue;
        const hit = bodies[w].some((b) => parts.every((pt) => b.includes(pt)));
        for (const s of keeps) for (const sc of mine) { cell[s][w][sc].잰것 += 1; if (hit) cell[s][w][sc].찾음 += 1; }
      }
    }
  }
  for (const s of senses) for (const w of washes) for (const sc of scopes) {
    const c = cell[s][w][sc];
    c.정확도 = c.잰것 ? +(100 * c.찾음 / c.잰것).toFixed(1) : 0;
  }
  return cell;
}
module.exports.citeAccuracyGrid = citeAccuracyGrid;

// [★세 번째 축 — 「무엇을 맞았다고 볼 것인가」] 뜻·씻기를 못박아도 값이 또 갈린다.
//   원문이 표로 쪼개져 있거나 `<개정>` 이 끼면 **통째로는 절대 안 맞는다**.
//   그래서 생산 도구(`exact_claim_recheck.win_ratio`)가 쓰는 창(窓) 방식을 같은 이름으로 둔다.
const CITE_MATCH = {
  통째로: '씻은 인용이 raw 안에 **그대로** 들어 있어야 맞음',
  창9할:  '인용을 8자 창으로 잘라 4자씩 밀며 본다. 창의 **9할 이상**이 raw 에 있으면 맞음',
};
function citeWinRatio(q, bodies, w = 8, step = 4) {
  if (q.length <= w) return bodies.some((b) => b.includes(q)) ? 1 : 0;
  let hit = 0, n = 0;
  for (let i = 0; i + w <= q.length; i += step) {
    n += 1;
    const seg = q.slice(i, i + w);
    if (bodies.some((b) => b.includes(seg))) hit += 1;
  }
  return n ? hit / n : 0;
}
module.exports.CITE_MATCH = CITE_MATCH;
module.exports.citeWinRatio = citeWinRatio;

// [★네 번째 축 — 「어디를 뒤질 것인가」] 개념 쪽은 **다른 법을 인용**하는 일이 잦다.
//   제 법에서 안 나왔다고 「원문에 없다」고 적으면 그건 **내 자가 좁은 것**이다
//   (`exact_claim_recheck.wide_pool` 이 같은 까닭으로 있다).
const CITE_POOL = {
  제법만:  '쪽 이름이 가리키는 법 폴더의 .txt 만. 기본값',
  모든raw: 'raw/ 아래 .txt 전부 — 타법 인용을 「없다」로 세지 않는다',
};
let _WIDE = null;
function citeWideBodies(wash) {
  if (_WIDE && _WIDE.wash === wash) return _WIDE.bodies;
  const RAW = path.resolve(WIKI, '..', 'raw');
  const bodies = []; let cur = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.endsWith('.txt')) {
        try { cur.push(citeWash(fs.readFileSync(fp, 'utf8'), wash)); } catch (_e) { /* 못 읽는 파일은 없는 셈 */ }
        if (cur.length >= 200) { bodies.push(cur.join('\u0000')); cur = []; }
      }
    }
  })(RAW);
  if (cur.length) bodies.push(cur.join('\u0000'));
  _WIDE = { wash, bodies };
  return bodies;
}
module.exports.CITE_POOL = CITE_POOL;
module.exports.citeWideBodies = citeWideBodies;

// ════════════════════════════════════════════════════════════════════════════
// ★「인용 정확도」 2026-09-24 실측 — **축 넷을 밝히면 8배 차이가 설명된다**
//
//   뜻 × 씻기 (범위 all · 제법만 · 통째로)
//     따옴표    공백만   6.6% (3,988/60,148)   괄호까지  7.3%
//     우리말뺌  공백만  11.8% (3,920/33,117)   괄호까지 13.1%
//     조문꼴    공백만  64.9% (1,107/1,705)    괄호까지 60.4%
//     조문표기  공백만  19.5% (1,481/7,596)    괄호까지 20.1%
//
//   본 곳 × 맞춤법 (뜻=조문꼴 · 씻기=공백만 · 범위=all)   ★가장 크게 움직이는 축은 「본 곳」이다
//     제법만 · 통째로   65.0% (1,108/1,705)
//     제법만 · 창9할    67.9% (1,157/1,705)
//     모든raw · 통째로  74.5% (1,271/1,705)   ← +9.5%p. 2라운드가 말한 「타법 인용 7~13%」가 이것이다
//     모든raw · 창9할   79.9% (1,363/1,705)
//
// [★다섯 벌과 견주기 — 정직하게]
//   · **세 벌이 모인 자리(D 76.9 · G 78.3 · 나 78.4, 인용 1,654~1,672건)** 는
//     `조문꼴 · 공백만 · 모든raw · 창9할` = **79.9% (1,705건)** 과 **같은 모퉁이**다.
//     건수도 1,705 ↔ 1,654~1,672 로 가깝다. ⚠그래도 **「재현했다」고 쓰지 않는다** —
//     값이 정확히 같지 않고, 그 벌들이 무엇을 더 걸렀는지는 저장소에 없다.
//   · **F 91.1% (854건)** — "자기 법 완결문만". 같은 뜻으로 재면 1,705건이다. **절반을 더 걸렀다**
//     는 뜻인데 그 거름이 적혀 있지 않다. 재현 불가.
//   · **E 61.5% (1,801건)** — "인용 뒤 40자에 조문표기". 같은 뜻(`조문표기`)으로 재면 **7,596건**.
//     네 배 넘게 차이 난다. 그 벌의 거름이 저장소에 없다. 재현 불가.
//   ⚠**추측으로 맞추지 않는다**(2-6b 와 같은 원칙). 못 맞춘 둘은 **못 맞췄다고 적는다.**
//
// [★이 값을 무엇이라 부를 것인가 — 기본 이름]
//   `인용 정확도[조문꼴·공백만·제법만·통째로·all] = 65.0%` 를 **기본값**으로 둔다.
//   가장 좁고 가장 엄한 자다. 느슨하게 재고 싶으면 **축을 바꿔 적어** 말한다.
//   ⚠**이 값은 「위키가 35% 틀렸다」는 뜻이 아니다.** 못 찾은 597건 안에는
//   타법 인용(모든raw 로 바꾸면 163건이 살아난다)·표로 쪼개진 원문(창9할 49건)·
//   우리 작문이 섞여 있다. **후보의 크기**이지 오류의 수가 아니다 — 가르는 일은 3-41 이 한다.
const CITE_MEASURED = {
  잰날: '2026-09-24',
  기본: { 뜻: '조문꼴', 씻기: '공백만', 본곳: '제법만', 맞춤법: '통째로', 범위: 'all',
          잰것: 1705, 찾음: 1108, 정확도: 65.0 },
  축이바꾸는폭: { 본곳: '+9.5%p', 맞춤법: '+2.9%p', 씻기: '-4.6%p', 뜻: '6.6%~64.9%' },
  재현: { '세 벌(76.9·78.3·78.4)': '같은 모퉁이(79.9%)까지 간다 — 같다고는 쓰지 않는다',
          'F 91.1%': '재현 불가 — 거름이 적혀 있지 않다',
          'E 61.5%': '재현 불가 — 같은 뜻으로 재면 건수가 4배다' },
};
module.exports.CITE_MEASURED = CITE_MEASURED;
