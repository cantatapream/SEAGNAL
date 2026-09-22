/**
 * test_counting_dict.js — ★**세는 법 사전**(2-6)이 정한 뜻과 범위를 고정한다.
 *
 * [왜 있나] 2026-09-22. 같은 것을 세는 운영 도구 셋이 **14,218 / 17,903 / 19,161** 로 갈렸다(G-10).
 * 원인을 끝까지 갈라 보니 셋 다 **맞는 숫자**였고, **뜻과 범위를 안 밝힌 것**이 문제였다.
 * 뿌리 사슬 ⑥(「세는 법을 안 정하면 같은 것을 재도 답이 다르다」)의 해법이라,
 * 사전이 말로만 있으면 또 죽는다 — **코드가 읽고 검사가 지킨다.**
 *
 * [무엇을 고정하나]
 *  ① 뜻 두 가지가 **서로 다른 수**를 낸다 — 같아지면 구분이 죽은 것이다
 *  ② `chatbot` ≥ `written` — 위임 화살표가 한 행을 두 항목으로 가르므로
 *  ③ 범위가 넓어지면 수도 **줄지 않는다**(concepts ⊆ indexed ⊆ all)
 *  ④ ★**표 머리행은 절대 세지 않는다** — `cite_exists` 가 그걸 세서 1,248행이 부풀었다
 *  ⑤ 절 찾기·칸 쪼개기는 **생산 함수의 것을 그대로** 쓴다(따로 만들면 ⑥이 재발한다)
 *  ⑥ 모르는 뜻·범위를 주면 **조용히 넘어가지 않고 던진다**
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES.
 *        → _dashboard/loop/_counting.js · services/legal_retriever.js(extractCitationChain 외).
 */
const C = require('../knowledge/legal/_dashboard/loop/_counting.js');
const R = require('../services/legal_retriever.js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('── ① 생산 함수의 자를 그대로 쓴다 (따로 만들지 않는다) ──');
ok('sectionTable 이 내보내져 있다', typeof R.sectionTable === 'function');
ok('tableCells 가 내보내져 있다', typeof R.tableCells === 'function');
ok('isSepRow 가 내보내져 있다', typeof R.isSepRow === 'function');

console.log('\n── ② 표 머리행은 데이터가 아니다 (cite_exists 가 1,248행 부풀린 그 버그) ──');
{
  const body = [
    '## 근거 조문', '',
    '| 법령명 | 조문 | 시행일 | 요지 |',
    '|---|---|---|---|',
    '| 「선박안전법」 | 제26조 | 2026-01-01 | 선박시설기준 |',
    '| 「선박안전법」 | 제27조 | 2026-01-01 | 검사 |', '',
  ].join('\n');
  const w = C.writtenRows(body);
  ok('데이터 행 2개만 센다(머리행·구분선 제외)', w.length === 2, '센 것 ' + w.length);
  ok('머리행의 글자가 결과에 없다',
    !JSON.stringify(w).includes('법령명'), JSON.stringify(w).slice(0, 80));
  ok('생산 사슬도 2개', R.extractCitationChain(body).length === 2);
}
{
  const noSep = ['## 근거 조문', '', '| 법령명 | 조문 |', '| 「선박안전법」 | 제26조 |', ''].join('\n');
  ok('구분선이 없으면 표로 보지 않는다(머리행만 세지 않는다)', C.writtenRows(noSep).length === 0);
  ok('근거 조문 절이 없으면 0', C.writtenRows('## 다른 절\n본문').length === 0);
  ok('빈 본문도 죽지 않는다', C.writtenRows('').length === 0 && C.writtenRows(null).length === 0);
}

console.log('\n── ③ 위임 화살표는 한 행을 두 사슬 항목으로 가른다 ──');
{
  const body = [
    '## 근거 조문', '',
    '| 법령명 | 조문 | 시행일 | 요지 |',
    '|---|---|---|---|',
    '| 「낚시 관리 및 육성법」 | 제29조의2 → 시행령 제18조의2 | 2026-01-01 | 위임 |', '',
  ].join('\n');
  ok('적힌 행은 1', C.writtenRows(body).length === 1);
  ok('★사슬 항목은 2 — 그래서 chatbot 이 written 보다 많다',
    R.extractCitationChain(body).length === 2, '사슬 ' + R.extractCitationChain(body).length);
}

console.log('\n── ④ 범위·뜻을 밝혀서 센다 (위키 실물) ──');
{
  const g = (sense, scope) => C.countCitationRows({ sense, scope });
  const cw = g('written', 'concepts'), cc = g('chatbot', 'concepts');
  const iw = g('written', 'indexed'), ic = g('chatbot', 'indexed');
  const aw = g('written', 'all'), ac = g('chatbot', 'all');
  console.log(`  ·           written   chatbot`);
  console.log(`  · concepts  ${String(cw.rows).padStart(7)}  ${String(cc.rows).padStart(7)}`);
  console.log(`  · indexed   ${String(iw.rows).padStart(7)}  ${String(ic.rows).padStart(7)}`);
  console.log(`  · all       ${String(aw.rows).padStart(7)}  ${String(ac.rows).padStart(7)}`);
  ok('범위가 넓어지면 줄지 않는다 (written)', cw.rows <= iw.rows && iw.rows <= aw.rows);
  ok('범위가 넓어지면 줄지 않는다 (chatbot)', cc.rows <= ic.rows && ic.rows <= ac.rows);
  ok('★chatbot ≥ written (화살표가 가르므로)', ac.rows >= aw.rows, `${ac.rows} vs ${aw.rows}`);
  ok('두 뜻이 실제로 다른 수다(구분이 살아 있다)', ac.rows !== aw.rows);
  ok('파일 수가 범위대로 는다', cw.files < iw.files && iw.files <= aw.files);
  ok('보고 문구에 뜻과 범위가 함께 들어간다',
    /뜻: .+ · 범위: .+/.test(ac.label), ac.label);
}

console.log('\n── ⑤ 모르는 뜻·범위는 조용히 넘어가지 않는다 ──');
{
  let threw = 0;
  try { C.wikiFiles('없는범위'); } catch (_) { threw++; }
  try { C.countCitationRows({ sense: '없는뜻' }); } catch (_) { threw++; }
  ok('둘 다 던진다', threw === 2, '던진 횟수 ' + threw);
  ok('쓸 수 있는 범위 이름이 사전에 적혀 있다',
    Object.keys(C.SCOPES).join(',') === 'concepts,indexed,all', Object.keys(C.SCOPES).join(','));
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
