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
