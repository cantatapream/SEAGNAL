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

// ── 라운드 번호 — 뜻이 넷인데 표기가 하나다 (2026-09-23, G-23) ──────────────
ok('라운드 표기의 뜻 넷에 이름이 붙어 있다', Object.keys(C.ROUND_SENSES).length === 4,
    `        ${JSON.stringify(Object.keys(C.ROUND_SENSES || {}))}`);
ok('「항목번호」와 「산문」이 **라운드가 아님**을 사전이 밝힌다',
    /라운드가 아니다/.test(C.ROUND_SENSES.항목번호.뜻) && /라운드가 아니다/.test(C.ROUND_SENSES.산문.뜻));
// ★ANNEX_RULERS 와 같은 판단 — **자를 만들지 않는 것**이 답이다.
//   2026-09-23 에 견주는 자를 만들어 봤더니 74법 중 50법이 "다르다"고 나왔는데,
//   큰 차이는 전부 산문(566라운드)과 항목번호(#289R)였다. 그 자가 곧 허수를 낳는다.
ok('★라운드를 견주는 함수를 두지 않는다 (만들면 허수가 나온다)',
    typeof C.compareRounds === 'undefined' && typeof C.countRounds === 'undefined',
    '        견주는 함수가 생겼다면, 그것이 무엇을 견주는지부터 사전에 적어야 한다.');

// ── 조 머리줄을 가져야 하는 파일 — 범위를 정했다 (2026-09-23, 3-47) ──────────
console.log('\n── ⑨ 「조 머리줄을 가져야 하는 파일」 — 범위에 이름을 붙였다 (3-47) ──');
{
  ok('★범위를 안 주면 **던진다** (뜻이 둘인데 기본값을 두면 그게 허수다)',
    (() => { try { C.countArticleHeadMissing({}); return false; } catch (_) { return true; } })());
  ok('범위가 둘 등재돼 있다', Object.keys(C.ARTICLE_HEAD_SCOPES).length === 2,
    `        ${JSON.stringify(Object.keys(C.ARTICLE_HEAD_SCOPES || {}))}`);
  const 자 = C.countArticleHeadMissing({ scope: '자치법규' });
  const 계 = C.countArticleHeadMissing({ scope: '계층본문' });
  ok('자치법규 ⊆ 계층본문 (좁은 범위가 넓은 범위에 들어 있다)', 자.count <= 계.count,
    `        자치법규 ${자.count} · 계층본문 ${계.count}`);
  ok('★**계층 본문 파일만** 센다 — 별표·고시·OCR·부칙은 안 센다',
    계.rows.every((r) => C.TIER_BODY_FILES.includes(r.파일.split('/').pop())),
    '        하나라도 다른 이름이 섞이면 범위가 샌 것이다');
  ok('안 본다고 정한 폴더가 이름으로 적혀 있다',
    ['별표', '행정규칙', '_이미지', '_원본첨부', '_구판', '_대기'].every((d) => C.HEAD_SKIP_DIRS.has(d)));
  ok('★**아직 안 정한 것**(발췌본·조약)은 결함으로 안 센다',
    계.rows.every((r) => !/_발췌\.txt$/.test(r.파일) && !/^.*\/조약/.test(r.파일)),
    '        안 정한 것을 결함으로 세면 게이트를 아무도 안 듣게 된다(④)');
  ok('범위마다 뜻이 한 줄로 적혀 있다',
    Object.values(C.ARTICLE_HEAD_SCOPES).every((v) => v.뜻));
}

// ── 「인용 정확도」 — 축 넷에 이름을 붙였다 (2026-09-24, G-2 의 마지막 한 자리) ──
//   ★숫자를 고정하지 않는다. 위키는 매일 편집되므로 **개수를 박으면 시험이 거짓말을 한다**
//   (오늘만 세 번 그렇게 만들었다가 고쳤다). 고정하는 것은 **성질**이다.
console.log('\n── ⑩ 「인용 정확도」 — 뜻 × 씻기 × 본 곳 × 맞춤법 (G-2) ──');
{
  ok('축 넷이 전부 이름과 뜻풀이를 갖고 있다',
    [C.CITE_SENSES, C.CITE_WASH, C.CITE_POOL, C.CITE_MATCH]
      .every((ax) => Object.keys(ax).length >= 2 && Object.values(ax).every((v) => typeof v === 'string' && v.length > 5)),
    '        축 하나라도 뜻풀이가 없으면 그 축이 다시 ⑥을 낳는다');
  for (const [axis, bad] of [['sense', '없는뜻'], ['wash', '없는씻기'], ['pool', '없는곳'], ['match', '없는법']]) {
    ok(`★모르는 ${axis} 는 **던진다** (조용히 기본값으로 떨어지면 아무도 못 알아챈다)`,
      (() => { try { C.citeAccuracy({ [axis]: bad, scope: 'comparisons' }); return false; } catch (_) { return true; } })());
  }
  // 뜻이 좁아질수록 잰 것이 줄어든다 — 이것은 정의상 반드시 참이라 숫자와 무관하다
  const 넓 = C.citeQuotes('"해양수산부장관은 기본계획을 수립하여야 한다." 제3조에 따른다. "확인 대조 완료"');
  ok('따옴표 ⊇ 우리말뺌 ⊇ 조문꼴 (뜻이 좁아지면 남는 인용이 준다)',
    넓.filter((q) => C.citeKeep(q, '따옴표')).length >= 넓.filter((q) => C.citeKeep(q, '우리말뺌')).length
    && 넓.filter((q) => C.citeKeep(q, '우리말뺌')).length >= 넓.filter((q) => C.citeKeep(q, '조문꼴')).length,
    `        따옴표 ${넓.filter((q) => C.citeKeep(q, '따옴표')).length} · 우리말뺌 ${넓.filter((q) => C.citeKeep(q, '우리말뺌')).length} · 조문꼴 ${넓.filter((q) => C.citeKeep(q, '조문꼴')).length}`);
  ok('★우리가 쓴 말("확인 대조 완료")은 **원문 인용으로 세지 않는다**',
    넓.filter((q) => C.citeKeep(q, '우리말뺌')).every((q) => !/대조|확인/.test(q.글)));
  ok('인용 뒤 40자에 「제N조」가 있으면 조문표기로 잡는다',
    C.citeQuotes('"해양수산부장관은 기본계획을 수립하여야 한다." 제3조에 따른다.')[0].조문표기붙음 === true);
  ok('씻기 「괄호까지」는 ( ) 안을 지운다 — 어긋남의 2/3 가 괄호 생략이다',
    C.citeWash('갯벌관리구역(이하 "관리구역"이라 한다)으로 지정할 수 있다', '괄호까지')
      === C.citeWash('갯벌관리구역으로 지정할 수 있다', '괄호까지'),
    '        원문에만 있는 괄호를 양쪽에서 같이 지워야 「생략」과 「오기」가 갈린다');
  ok('씻기 「공백만」은 괄호를 남긴다 (두 씻기가 같으면 축이 아니다)',
    C.citeWash('갯벌관리구역(이하 "관리구역"이라 한다)으로', '공백만')
      !== C.citeWash('갯벌관리구역으로', '공백만'));
  {
    // ★한 번 틀렸다 — 짧은 글에 한 군데만 끼어도 창의 절반이 깨진다(20자면 창이 4개뿐).
    //   그래서 「끼어들면 언제나 9할 이상」은 **참이 아니다.** 고정할 성질은 그게 아니라
    //   「통째로 맞으면 창도 반드시 맞다」와 「부분만 있으면 0과 1 사이」다.
    const 글 = '해양수산부장관은해양수산발전기본계획을5년마다수립하여야한다';
    ok('★통째로 맞으면 창9할도 반드시 맞다 (느슨한 자가 엄한 자를 뒤집으면 축이 아니다)',
      C.citeWinRatio(글, [`앞말${글}뒷말`]) === 1);
    const 일부 = C.citeWinRatio(글, ['해양수산부장관은해양수산발전기본계획을']);
    ok('부분만 있으면 0과 1 사이의 눈금이 나온다', 일부 > 0 && 일부 < 1,
      `        ${(100 * 일부).toFixed(0)}%`);
    ok('아무 데도 없으면 0 이다', C.citeWinRatio(글, ['전혀다른글자열']) === 0);
  }
  ok('실측 기록이 **잰 날과 함께** 적혀 있다',
    /^\d{4}-\d{2}-\d{2}$/.test(C.CITE_MEASURED.잰날) && C.CITE_MEASURED.기본.잰것 > 0);
  ok('★재현 못 한 벌은 **못 했다고 적혀 있다** (추측으로 맞추지 않는다)',
    Object.values(C.CITE_MEASURED.재현).some((v) => /재현 불가/.test(v)),
    '        전부 재현됐다고 적혀 있으면 그것이 오히려 의심스럽다');
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
