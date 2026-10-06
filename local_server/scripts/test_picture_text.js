/**
 * test_picture_text.js — ★그림 판독문이 **모델 근거에서 빠지는지**를 고정한다. (3-75 · Q-19)
 *
 * [왜 있나] 2026-10-06. 사장님 결정(Q-19): 그림은 원본 그림을 그대로 보여 주고, 판독문(AI 든 사람이든)은
 * **검색용으로만** 남긴다 — 답에 숫자로 인용하지 않는다. 판독문이 모델에 가던 길이 둘 있었다
 * (위키 쪽 본문 · raw 대체 경로). `services/picture_text.js` 가 그 둘을 막는 한 곳이다.
 *
 * [무엇을 고정하나]
 *  R1 raw: `【이미지판독 N】`…`【이미지판독 끝 N】` → 「원문 그림」 표시 하나. **앞뒤 법 글은 그대로**
 *  R2 raw: 끝 표시가 없으면 **시작 줄만** 바꾼다 — 다음 줄(법 글일 수 있다)을 지우지 않는다
 *  R3 raw: `【이미지판독: 지도 위에 …】` 한 줄 설명도 바꾼다
 *  R4 트리 자산(줄바꿈 없이 이어 붙인 발췌): 표 칸까지만 빼고 **표 뒤의 법 글은 남긴다** · 「…」로 잘린 칸도 뺀다
 *  W1 위키: 출처를 밝힌 표 행만 빠지고 머리 행·다른 행은 남는다
 *  W2 위키: 머리줄에 「이미지판독」이 있어도 **절을 통째로 빼지 않는다**(그 줄만) — 글로 된 원문 값이 섞여 있다
 *  W3 위키: 「이미지판독 아님」「블록 없음」처럼 아니라고 말하는 줄은 남긴다
 *  W4 위키: 목록 항목 바로 뒤에 붙은 판독 인용 줄은 그 줄만 빠지고 목록 항목은 남는다
 *  W5 위키: `picture_wiki_lines.json` 이 숫자로 가린 줄은 그 쪽 열쇠로 부를 때만 빠진다
 *  C1 화면(cleanBody): 끝 표시가 있으면 판독문을 걷어내고 그림 참조만 남긴다 · 없으면 종전대로
 *  S1 실제 search(): 판독 표가 있는 쪽을 부르는 질문에서 모델 근거(contextPages)에 판독 표시·가린 줄이 0
 *  P1 답변 규칙에 「〔원문 그림〕」을 어떻게 다룰지(규칙 17)가 들어 있다
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES.
 *        → services/picture_text.js · services/legal_retriever.js(search · searchRawFallback · loadZoneTree)
 *          · services/article_text.js(cleanBody) · `_dashboard/loop/ocr_block_end.py` · `picture_wiki_lines.py`
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../services/picture_text.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); } else {
    fail++; console.log(`  ❌ ${name}`); if (extra !== undefined) console.log('     ', JSON.stringify(extra).slice(0, 400));
  }
}

console.log('\n── raw 판독 블록 ──');
{
  const t = '제33조(절연) … 한다.<img id="9"></img>\n【이미지판독 9】(원본이미지: _이미지/9.png)\n[표]\n| 정격전류 | 50미만 |\n| 절연저항 | 2 |\n'
    + '사용자 확인(2026-08-23): 위 값은 …\n【이미지판독 끝 9】\n⑥ 인체가 접촉할 우려가 있는 …';
  const s = P.stripRawPictureText(t);
  ok('R1 블록이 「원문 그림 9」 하나로 바뀐다', s.includes(P.RAW_PLACEHOLDER('9')) && !s.includes('절연저항') && !s.includes('사용자 확인'), s);
  ok('R1 앞뒤 법 글은 그대로', s.startsWith('제33조(절연) … 한다.') && s.endsWith('⑥ 인체가 접촉할 우려가 있는 …'), s);
  ok('R1 판독 표시·끝 표시·img 꼬리표가 남지 않는다', !/【이미지판독|<img/.test(s), s);
}
{
  const t = '… 다음 표와 같다.\n【이미지판독 7】(원본이미지: _이미지/7.png)\n1. 다음 각 호의 법 글';
  const s = P.stripRawPictureText(t);
  ok('R2 끝 표시가 없으면 시작 줄만 바꾼다', s === '… 다음 표와 같다.\n' + P.RAW_PLACEHOLDER('7') + '\n1. 다음 각 호의 법 글', s);
}
{
  const s = P.stripRawPictureText('가. 선유도 해수욕장 【이미지판독: 위성지도 위에 붉은 선으로 20M 표시】 나. 신시도');
  ok('R3 한 줄 설명도 바꾼다', !s.includes('20M') && s.includes('〔원문 그림') && s.startsWith('가. 선유도 해수욕장') && s.endsWith('나. 신시도'), s);
}
{
  const t = '단위면적으로 나누어 얻은 정수 【이미지판독 130345743】(원본이미지: _이미지/130345743.png) [표] | 운항구역 | 단위면적 | |---|---| | 근해구역 이상 | 0.85 | 4. 의자석과 좌석이 공존하는 경우: 정원을 계산한다.';
  const s = P.stripRawPictureText(t);
  ok('R4 표 칸까지만 빼고 뒤 법 글은 남긴다', !s.includes('0.85') && s.includes('4. 의자석과 좌석이 공존하는 경우'), s);
  const u = P.stripRawPictureText('… 한다. 【이미지판독 160750851】(원본이미지: _이미지/160750851.png) [표] | 항해구역 | 좌석 | |---|---| | 연해 | 침대, 좌석 또는 입 …');
  ok('R4 「…」로 잘린 마지막 칸도 뺀다', !u.includes('침대') && u.endsWith(P.RAW_PLACEHOLDER('160750851')), u);
}

console.log('\n── 위키 본문 ──');
{
  const b = ['| 구분 | 값 |', '|---|---|', '| 가 | 36도 34분 (【이미지판독 6163758】) |', '| 나 | 글로 된 값 |'].join('\n');
  const s = P.stripWikiPictureText(b);
  ok('W1 판독 표시가 있는 행만 빠진다', s.includes('| 구분 | 값 |') && s.includes('| 나 | 글로 된 값 |') && !s.includes('36도 34분'), s);
}
{
  const b = ['## 재무건전성 (감독기준 산식·수치 — 별표이미지판독 반영)', '', '- 기준: 지급여력비율 100% 이상 유지(제83조).', '', '## 다음 절', '본문'].join('\n');
  const s = P.stripWikiPictureText(b);
  ok('W2 머리줄만 빠지고 그 절의 글은 남는다', !s.includes('별표이미지판독') && s.includes('지급여력비율 100% 이상') && s.includes('## 다음 절'), s);
}
{
  const b = '### 신규 4개 고시 통제구역 좌표 (원문 텍스트 좌표 — 이미지판독 아님)\n| 1 | 36-40N |';
  ok('W3 「이미지판독 아님」은 남긴다', P.stripWikiPictureText(b) === b);
}
{
  const b = ['- 다) 어구의 투망 또는 양망을 위하여 경사로를 활용할 수 있다.',
    '> **[부도 가-1] 외끌이대형저인망 어구 겨냥도** (2026-08-16 원본이미지 확보·판독) — 좌우 대칭 …'].join('\n');
  const s = P.stripWikiPictureText(b);
  ok('W4 목록 항목은 남고 판독 인용 줄만 빠진다', s.includes('- 다) 어구의 투망') && !s.includes('겨냥도'), s);
}
{
  const J = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'picture_wiki_lines.json');
  const pages = JSON.parse(fs.readFileSync(J, 'utf8')).쪽 || {};
  const key = Object.keys(pages)[0];
  ok('W5 목록 파일에 쪽이 있다', !!key, Object.keys(pages).length);
  if (key) {
    const wf = path.join(__dirname, '..', 'knowledge', 'legal', 'wiki', key);
    let t = fs.readFileSync(wf, 'utf8'); const m = t.match(/^---\n[\s\S]*?\n---\n/); if (m) t = t.slice(m[0].length);
    const keys = new Set(pages[key]);
    const kOf = l => l.replace(/\s/g, '').slice(0, 80);
    const withKey = P.stripWikiPictureText(t, key).split('\n').filter(l => l.trim() && keys.has(kOf(l)));
    const without = P.stripWikiPictureText(t).split('\n').filter(l => l.trim() && keys.has(kOf(l)));
    ok('W5 쪽 열쇠로 부르면 가린 줄이 0', withKey.length === 0, withKey.slice(0, 2));
    ok('W5 열쇠 없이 부르면 그 줄들은 그대로(가림은 열쇠가 있을 때만)', without.length > 0, without.length);
  }
}

console.log('\n── 화면(조문 창) ──');
{
  const A = require('../services/article_text.js');
  const c1 = A.cleanBody('… 있다.<img id="9"></img>\n【이미지판독 9】(원본이미지: _이미지/9.png)\n[표]\n| 2 |\n【이미지판독 끝 9】\n⑥ …');
  ok('C1 끝 표시가 있으면 판독문을 걷어내고 그림 참조만', c1 === '… 있다.【이미지 9】\n⑥ …', c1);
  const c2 = A.cleanBody('… 있다.<img id="9"></img>\n【이미지판독 9】(원본이미지: _이미지/9.png)\n[표]…');
  ok('C1 끝 표시가 없으면 종전대로(판독문을 지우지 않는다)', c2 === '… 있다.【이미지 9】\n[표]…', c2);
}

console.log('\n── 실제 search() · 답변 규칙 ──');
(async () => {
  const R = require('../services/legal_retriever.js');
  const J = path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'picture_wiki_lines.json');
  const listed = new Set([].concat(...Object.values(JSON.parse(fs.readFileSync(J, 'utf8')).쪽 || {})));
  const kOf = l => l.replace(/\s/g, '').slice(0, 80);
  const QS = ['서천갯벌 습지보호지역 경계좌표가 어떻게 되나요', '동해 테트라포드 출입통제구역 좌표 알려줘',
    '항만운송사업법 세칙 경인항 갑문 통과 선박제원', '수협 공제사업 지급여력비율 기준은'];
  let leaks = [], pages = 0;
  for (const q of QS) {
    const { contextPages } = await R.search(q, { canonicalOnly: true });
    for (const cp of contextPages) {
      pages++;
      for (const l of cp.body.split('\n')) {
        if (P.isSignal(l) || (l.trim() && listed.has(kOf(l)))) leaks.push(cp.file + ' | ' + l.slice(0, 80));
      }
    }
  }
  ok(`S1 모델 근거(contextPages ${pages}쪽)에 판독 표시·가린 줄이 0`, pages > 0 && leaks.length === 0, leaks.slice(0, 3));
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'legal_retriever.js'), 'utf8');
  ok('P1 답변 규칙 17(「〔원문 그림〕」을 짐작하지 말고 별표·조문을 열라고 안내)', /17\. ★\*\*\[근거자료\]에 「〔원문 그림/.test(src));
  ok('P1 raw 대체 경로가 판독을 거른다(법률 원문 · 고른 파일 · `_` 폴더 제외)',
    src.includes('lawText: pictureText.stripRawPictureText(lawText)')
    && src.includes('text: pictureText.stripRawPictureText(text)')
    && src.includes("!e.name.startsWith('_')"));
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  ❌ 실행 오류', e && e.stack); console.log(`\n${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
