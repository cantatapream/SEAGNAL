/**
 * article_block.js — raw 파일 글 안에서 **조문 한 덩이**를 집고 갈아 끼운다.
 *
 * [왜 따로 뺐나 — 2026-09-21]
 *   `add_other_law_article.js` 는 맨 위에서 바로 실행되는 CLI 라 `require` 로 불러 올 수 없다.
 *   그런데 이 함수는 **raw 원문을 덮어쓴다** — 시험 없이 둘 수 없는 자리다. 그래서 여기로 뺐다.
 *   (시험: `local_server/scripts/test_add_other_law_refresh.js`)
 *
 * [덩이의 경계]
 *   머리줄 `[제10조] …` 부터 **다음 대괄호 머리줄**(`[제…`·`[별표…`·`[부칙…`) 직전까지,
 *   없으면 글 끝까지. 우리 저장소는 머리줄을 늘 줄 첫 칸의 `[` 로 적는다(_SCHEMA §0-E).
 *
 * ⚠**항 단위 머리줄**(`[제29조①]`)은 이 함수가 못 집는다 — `[제29조]` 와 다른 글자다.
 *   일부러 그렇게 뒀다. 못 집으면 `null` 을 주고 부르는 쪽이 **손대지 않는다**(엉뚱한 자리를
 *   고치는 것보다 낫다). 실측상 `15_관련타부처` 에서 그 꼴을 쓰는 파일은 2개뿐이고
 *   둘 다 `_구판/`·`_구판` 보존본이라 이 도구가 쓰지 않는다(2026-09-21 전수 확인).
 *
 * [연계] ← add_other_law_article.js --refresh
 * [로드 순서] 순수 함수 모듈. 파일·네트워크를 안 만진다.
 */

/**
 * @param {string} text   파일 전체 글
 * @param {string} label  `제10조`·`제10조의2` 처럼 **대괄호 없는** 조 이름
 * @param {{text:string}} fresh  새로 받아 편 글(머리줄은 빼고 본문만)
 * @returns {{text:string, before:number, after:number}|null}  못 찾으면 null
 */
function replaceBlock(text, label, fresh) {
  const esc = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^\\[' + esc + '\\][^\\n]*\\n(?:(?!^\\[)[^\\n]*\\n?)*', 'm');
  const m = re.exec(text);
  if (!m) return null;
  const old = m[0];
  // ★우리가 적어 둔 `※` 줄은 그대로 옮긴다 — **왜 받았는지가 거기 있다.**
  //   덮어쓰면 다음 사람이 "이 조문 왜 여기 있지?" 부터 다시 알아내야 한다.
  const memos = old.split('\n').filter(l => /^\s*※/.test(l));
  const head = old.split('\n')[0];
  const body = [head, ...memos, fresh.text, ''].join('\n');
  return {
    text: text.slice(0, m.index) + body + text.slice(m.index + old.length),
    before: old.length,
    after: body.length,
  };
}

module.exports = { replaceBlock };
