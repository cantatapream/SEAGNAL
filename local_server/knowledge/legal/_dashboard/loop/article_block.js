/**
 * article_block.js — raw 파일 글 안에서 **조문 한 덩이**를 집고 갈아 끼운다.
 *
 * [왜 따로 뺐나 — 2026-09-21]
 *   `add_other_law_article.js` 는 맨 위에서 바로 실행되는 CLI 라 `require` 로 불러 올 수 없다.
 *   그런데 이 함수는 **raw 원문을 덮어쓴다** — 시험 없이 둘 수 없는 자리다. 그래서 여기로 뺐다.
 *   (시험: `local_server/scripts/test_add_other_law_refresh.js`)
 *
 * [덩이의 경계 — 파일의 머리줄 꼴을 먼저 보고 정한다]
 *   우리 저장소의 조문머리는 **세 꼴**이다(_SCHEMA §0-E · `article_text.js` 도 셋 다 읽는다).
 *   · **대괄호 꼴** `[제10조] 제목` — 파일에 이 꼴이 하나라도 있으면 **그것만** 머리로 본다.
 *     끝은 다음 대괄호 머리줄(`[제…`·`[별표…`·`[부칙…`)이거나 글 끝이다.
 *   · **민짜 꼴** `제10조(제목)` — 대괄호 꼴이 **하나도 없는 파일**에서만 머리로 본다.
 *     ⚠섞어 쓰면 안 된다. 대괄호 파일은 머리 바로 다음 줄이 `제10조(제목)` 인 일이 흔해서,
 *       둘을 함께 경계로 삼으면 **덩이가 첫 줄에서 끊긴다**(실측으로 확인하고 갈랐다).
 *   실측(2026-09-22): 호가 빠진 발췌본 15개 중 **7개가 민짜 꼴**이라 종전 판으로는
 *   손도 못 댔다(간호법·관광진흥법 시행규칙 등).
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
  // ★파일이 대괄호 꼴을 쓰는지 먼저 본다 — 섞어 쓰면 덩이가 첫 줄에서 끊긴다(머리말 참고).
  const bracketFile = /^\[제\d+조/m.test(text);
  // 민짜 덩이의 끝 — 다음 민짜 머리줄이거나 다음 대괄호 머리줄이다.
  const plainRe = new RegExp('^' + esc + '\\([^\\n]*\\n(?:(?!^제\\d+조(?:의\\d+)?\\()(?!^\\[)[^\\n]*\\n?)*', 'm');
  const re = bracketFile
    ? new RegExp('^\\[' + esc + '\\][^\\n]*\\n(?:(?!^\\[)[^\\n]*\\n?)*', 'm')
    : plainRe;
  let m = re.exec(text);
  // ★2026-09-23 (3-8) — **섞어 쓴 파일이 있다.** 대괄호 파일인데 **그 조만 민짜**인 자리가
  //   실측 **9파일 · 16조** 다(`개인정보보호법/법률.txt` 제2조·제6조·제15조 …).
  //   종전에는 대괄호로만 찾아 `null` 을 주었고, 부르는 쪽은 **손대지 않았다** — 안전하지만
  //   **영영 못 고치는 조**가 된다. 그 조에 한해 민짜 꼴로 한 번 더 찾는다.
  //   ⚠파일 전체를 민짜로 보는 게 아니라 **찾는 조 하나**만 민짜로 본다(경계는 위 `plainRe`).
  let plainHit = false;
  if (!m && bracketFile) { m = plainRe.exec(text); plainHit = !!m; }
  if (!m) return null;
  const old = m[0];
  // ★우리가 적어 둔 `※` 줄은 그대로 옮긴다 — **왜 받았는지가 거기 있다.**
  //   덮어쓰면 다음 사람이 "이 조문 왜 여기 있지?" 부터 다시 알아내야 한다.
  const memos = old.split('\n').filter(l => /^\s*※/.test(l));
  // 민짜 꼴은 머리줄 자체가 본문 첫 줄(`제6조(간호조무사 자격인정 등)`)이라 새 글이 그것을
  // 다시 담는다 — 그때는 옛 머리줄을 남기지 않는다(두 번 적히는 것을 막는다).
  //   민짜로 집었으면 머리줄이 곧 본문 첫 줄이라 옛 머리줄을 남기지 않는다(두 번 적힘 방지).
  const head = (bracketFile && !plainHit) ? old.split('\n')[0] : null;
  const body = [...(head ? [head] : []), ...memos, fresh.text, ''].join('\n');
  return {
    text: text.slice(0, m.index) + body + text.slice(m.index + old.length),
    before: old.length,
    after: body.length,
  };
}

/**
 * 그 조가 이 파일에 **머리줄로** 들어 있나. 파일의 머리줄 꼴을 보고 판단한다.
 *
 * ⚠`text.includes('[제6조]')` 로 묻던 종전 방식은 **민짜 꼴 파일에서 늘 false** 라,
 *   이미 있는 조를 "없다"고 보고 **같은 조를 하나 더 덧붙일** 뻔했다(2026-09-22).
 *
 * @param {string} text  파일 전체 글
 * @param {string} label `제10조`·`제10조의2`
 * @returns {boolean}
 */
function hasArticle(text, label) {
  const esc = String(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ★2026-09-23 (3-8) — **둘 중 하나라도 있으면 있는 것이다.**
  //   종전에는 파일 꼴을 먼저 보고 **한 꼴만** 확인했다. 그런데 섞어 쓴 파일에서는
  //   대괄호 파일의 민짜 조가 **「없다」로 나와** 부르는 쪽이 **같은 조를 하나 더 덧붙인다.**
  //   실측(2026-09-23): `개인정보보호법/법률.txt` 의 제2조·제6조·제15조·제22조·제23조·제24조가
  //   파일에 **멀쩡히 있는데** `hasArticle` 이 전부 `false` 를 주고 있었다.
  //   ⚠이 되돌림은 **false → true 방향으로만** 바뀐다 — 틀려도 「안 덧붙인다」 쪽이라 안전하다.
  return new RegExp('^\\[' + esc + '\\]', 'm').test(text)
      || new RegExp('^' + esc + '\\(', 'm').test(text);
}

module.exports = { replaceBlock, hasArticle };
