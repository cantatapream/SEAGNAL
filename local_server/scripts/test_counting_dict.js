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

console.log('\n── ⑥ §8-B 줄번호 인용 — 4벌이 갈린 값을 뜻·범위로 화해시킨다 (2-6b) ──');
{
  // ★2026-09-23 재측: 네 값 중 **둘은 정확히 재현**됐다. 이 두 줄이 그것을 고정한다.
  const a = C.countLineCitations({ sense: 'any', scope: 'backlog' });
  ok('12,996 = backlog/ 만 · 모든 자리', a.counts.any === 12996, String(a.counts.any));
  const b = C.countLineCitations({ sense: 'any', scope: 'backlog_all' });
  ok('14,622 = backlog + _p1 + _p3 · 모든 자리', b.counts.any === 14622, String(b.counts.any));

  // ★가장 중요한 것 — **챗봇이 읽는 곳은 한 자릿수**다. 큰 값은 전부 작업 기록이다.
  const w = C.countLineCitations({ sense: 'citation', scope: 'wiki' });
  ok('★챗봇이 읽는 wiki/ 는 한 자릿수다', w.counts.citation < 10,
    `wiki citation ${w.counts.citation} — 여기가 커지면 그때는 진짜 문제다`);
  ok('wiki 가 backlog 보다 훨씬 작다', w.counts.citation * 100 < a.counts.any,
    '§8-B 가 소급 교체를 안 하기로 한 근거가 이것이다');

  ok('any 는 citation 보다 작지 않다', a.counts.any >= a.counts.citation);
  ok('any = citation + 메모', a.counts.any === a.counts.citation + a.counts.memo,
    `${a.counts.citation} + ${a.counts.memo} ≠ ${a.counts.any}`);
  ok('보고 문구에 뜻과 범위가 들어 있다', /뜻: .+ · 범위: .+/.test(a.label), a.label);
  ok('표본을 함께 준다(2-1)', Array.isArray(a.samples) && a.samples.length > 0,
    '숫자만 주면 확인할 수 없다');

  let threw = 0;
  try { C.countLineCitations({ sense: '없는뜻' }); } catch (_) { threw++; }
  try { C.countLineCitations({ scope: '없는범위' }); } catch (_) { threw++; }
  ok('모르는 뜻·범위는 조용히 넘어가지 않고 던진다', threw === 2, '던진 횟수 ' + threw);
}

console.log('\n── ⑦ _LESSONS 재발률 — 판단이 아니라 기계로 센다 (2-6b · L-133) ──');
{
  const d = C.countLessonRecurrence({ sense: 'declared' });
  const l = C.countLessonRecurrence({ sense: 'linked' });
  const e = C.countLessonRecurrence({ sense: 'either' });
  const b = C.countLessonRecurrence({ sense: 'both' });
  ok('교훈을 실제로 읽어 센다', d.total > 300, '교훈 ' + d.total);
  ok('either 는 declared·linked 보다 작지 않다', e.rows >= d.rows && e.rows >= l.rows);
  ok('both 는 declared·linked 보다 크지 않다', b.rows <= d.rows && b.rows <= l.rows);
  ok('결번을 숨기지 않고 함께 말한다', d.missing.length > 0 && /결번/.test(d.label), d.label);
  ok('보고 문구에 뜻과 범위가 들어 있다', /뜻: .+ · 범위: .+/.test(d.label), d.label);
  ok('모르는 뜻은 던진다', (() => { try { C.countLessonRecurrence({ sense: 'x' }); return false; } catch (_) { return true; } })());
  console.log(`     ${d.label}`);
  console.log(`     ${l.label}`);
}

console.log('\n── ⑧ 「위키가 안 꺼낸 별표」 — 자를 늘리지 않는다 (2-6b) ──');
{
  ok('★이 이름으로 세는 함수를 만들지 않았다', typeof C.countUnsurfacedAnnexes === 'undefined',
    '여섯 번째 수를 만들면 그게 ⑥을 다시 저지르는 일이다');
  ok('대신 이미 있는 자 둘을 이름으로 가리킨다',
    C.ANNEX_RULERS && C.ANNEX_RULERS['V5-11'] && C.ANNEX_RULERS['V5-21a']);
  ok('둘의 단위가 다르다는 것을 적어 둔다',
    C.ANNEX_RULERS['V5-11'].단위 !== C.ANNEX_RULERS['V5-21a'].단위,
    '하나는 줄, 하나는 파일 — 다른 물음이다');
  ok('각 자가 무엇을 묻는지 한 줄로 적혀 있다',
    Object.values(C.ANNEX_RULERS).every((r) => r.물음 && r.도구));
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
