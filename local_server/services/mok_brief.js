/**
 * ============================================================================
 * 파일명: services/mok_brief.js
 * 역할: 「원문결손」 방의 **대기 전 건**을 AI 작업 세션에 넘길 한 덩어리 인계문으로 만든다. (3-83)
 * ============================================================================
 *
 * [왜 있나 — 2026-10-07 사장님 「원문결손 72건 … 여기에도 개정검토 탭처럼 전체 지시문 복사할 수 있도록」]
 * 개정검토 방에는 「📋 승인분 전체 지시문」 이 있어 글 하나를 복사해 AI 에게 붙이면 일이 넘어간다.
 * 원문결손 방은 카드가 72장인데 그런 길이 없어, 사람이 카드를 하나씩 옮겨 적어야 했다.
 *
 * [개정검토와 다른 점]
 *  · 이 방에는 「승인」 이 없다 — 카드는 대기 → 사람이 「처리완료/해당없음」. 그래서 **대기 전 건**을 묶는다.
 *  · 작업 세션은 운영 서버의 큐를 못 고친다 → 글 끝에서 **건마다 판정표**(처리완료/해당없음 + 근거)를
 *    돌려 달라고 한다. 관리자가 그 표를 보고 화면 버튼을 누른다.
 *  · ⚠「해당없음」 으로 닫아도 다음 점검에서 또 누락으로 나오면 **다시 뜬다**(reopenStillMissing —
 *    처리완료·해당없음 둘 다). 발췌본이 머리말에 「발췌」 선언이 없으면 매주 돌아온다 → 글이 그 사실을 적는다.
 *  · 할 일(actions)은 종류마다 같아서 건마다 되풀이하지 않고 **종류별로 한 번만** 싣는다.
 *  · 「어디가 빈가」 는 카드처럼 10개에서 자르지 않는다(작업에 다 필요하다). 다만 40개를 넘으면 자르고 **잘랐다고 적는다.**
 *  · 큐에 없는 것은 쓰지 않는다 — 지어내는 내용이 없다.
 *
 * [연계] ← routes/legal.js GET /api/legal/mok-audit/brief-all
 *        → client/js/ai-chat/ai_chat.js renderMokCards(「📋 대기 전체 지시문」 버튼 → renderBriefBox)
 *        ← services/mok_audit_scanner.js(toMokEntry · toAnnexEntry 가 만든 큐 항목)
 *        ← scripts/test_mok_brief.js
 * ============================================================================
 */
'use strict';

/** 카드 한 장에서 「어디가 빈가」 를 몇 곳까지 싣나. 넘으면 자르고 그 사실을 적는다. */
const SPOT_CAP = 40;

/** 종류를 보여 줄 순서. 큐에 다른 종류가 있으면 뒤에 붙는다. */
const KIND_ORDER = ['조문 목 누락', '고시 별표 없음', '고시 별표 수가 모자람'];

/**
 * 발췌본일 수 있나 — 파일 자리·이름만 본다(판정이 아니라 **먼저 확인하라는 표시**).
 * 예: excerptSuspect({files:['raw/15_관련타부처/농수산물…/법률_연결조문.txt']}) → '15_관련타부처 · 연결조문'
 * @param {object} it - 큐 항목
 * @returns {string} 까닭(없으면 '')
 */
function excerptSuspect(it) {
  const why = [];
  for (const f of it.files || []) {
    if (/\/15_관련타부처\//.test('/' + f) && why.indexOf('15_관련타부처') < 0) why.push('15_관련타부처');
    if (/연결조문/.test(f) && why.indexOf('연결조문') < 0) why.push('연결조문');
    if (/발췌/.test(f) && why.indexOf('파일 이름에 발췌') < 0) why.push('파일 이름에 발췌');
  }
  return why.join(' · ');
}

/** 「원본 n개 / 우리 m개 (k개 모자람)」 — 수가 없으면 ''. */
function countText(it) {
  if (it.api_count === '' || it.api_count == null) return '';
  return `원본 ${it.api_count}개 / 우리 ${it.raw_count}개` + (it.missing ? ` (${it.missing}개 모자람)` : '');
}

/** 표 칸 안에 들어갈 글 — 세로줄·줄바꿈을 지운다. */
function cell(s) { return String(s == null ? '' : s).replace(/\|/g, '｜').replace(/\s*\n\s*/g, ' ').trim(); }

/**
 * 원문결손 대기 건들을 한 덩어리 인계문으로.
 * 예: buildMokBrief([{id:'mok_1', title:'도선법 시행령', kind:'조문 목 누락', …}]).text → '# 원문결손 처리 요청 — 대기 1건 …'
 * @param {Array<object>} list - 큐 항목들(순서 그대로 · 종류별로 묶어 싣는다)
 * @returns {{ok:boolean, text:string, count:number, kinds:object, excerpt:number, error?:string}}
 */
function buildMokBrief(list) {
  const rows = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!rows.length) return { ok: false, text: '', count: 0, kinds: {}, excerpt: 0, error: '대기 중인 결손 카드가 없습니다.' };

  const kinds = {};
  for (const it of rows) (kinds[it.kind || '누락'] = kinds[it.kind || '누락'] || []).push(it);
  const order = KIND_ORDER.filter((k) => kinds[k]).concat(Object.keys(kinds).filter((k) => KIND_ORDER.indexOf(k) < 0));
  const ordered = [].concat.apply([], order.map((k) => kinds[k]));
  const nEx = ordered.filter((it) => excerptSuspect(it)).length;

  const L = [];
  L.push(`# 원문결손 처리 요청 — 대기 ${rows.length}건`);
  L.push('');
  L.push('SEAGNAL 해양법령 위키(나리야)의 **원문결손 점검** 결과다. 받아 둔 원문이 **낡았는지가 아니라 안이 비었는지**를 센 것이다 —');
  L.push('①조문의 목(가·나·다)이 원본보다 적다 ②고시의 별표·별지가 원본보다 적다. 관리자가 아직 판정하지 않은 **대기 전 건**이다.');
  L.push('작업 규칙은 저장소의 `local_server/knowledge/legal/_SCHEMA.md` 를 따른다.');
  L.push('');
  L.push('> ⚠ **이 글은 길다. 종류별·건별로 나눠 처리해도 된다** — 한 건 끝낼 때마다 검사를 돌리는 편이 안전하다.');
  L.push('> ⚠ 작업 세션은 운영 서버의 카드를 **닫지 못한다.** 맨 끝 「돌려줄 것」 의 판정표를 채워 주면 관리자가 그 표대로 화면 버튼을 누른다.');
  L.push('');

  L.push('## 0. 한눈에 보기');
  L.push('');
  L.push(`- 대기 ${rows.length}건 — ` + order.map((k) => `${k} ${kinds[k].length}건`).join(' · '));
  if (nEx) L.push(`- ⚠ **발췌본일 수 있는 것 ${nEx}건**(파일이 \`raw/15_관련타부처/\` 아래이거나 이름에 「연결조문」·「발췌」) — 발췌본은 모자란 것이 **정상**이다. 이 건들은 「정말 빠졌나」부터 본다.`);
  L.push('');
  L.push('| # | 문서 | 계층 | 종류 | 원본/우리 | 우리 원문 | 발췌 의심 | 카드 id |');
  L.push('|---|---|---|---|---|---|---|---|');
  ordered.forEach((it, i) => {
    L.push(`| ${i + 1} | ${cell(it.title || '(제목 없음)')} | ${cell(it.tier)} | ${cell(it.kind)} | ${cell(countText(it).replace(/^원본 /, '').replace(' / 우리 ', ' / ')) || '—'} | ${(it.files || []).map((f) => '`' + cell(f) + '`').join('<br>') || '—'} | ${cell(excerptSuspect(it)) || '—'} | \`${cell(it.id)}\` |`);
  });
  L.push('');

  L.push('## 1. 건별 — 어디가 비었나');
  L.push('');
  ordered.forEach((it, i) => {
    L.push(`### ${i + 1}) ${it.title || '(제목 없음)'}${it.tier ? ' ' + it.tier : ''} — ${it.kind || '누락'}`);
    L.push('');
    const c = countText(it);
    if (c) L.push(`- ${c}`);
    if (it.mst) L.push(`- MST: ${it.mst}`);
    for (const f of it.files || []) L.push(`- 우리 원문: \`${f}\``);
    const ex = excerptSuspect(it);
    if (ex) L.push(`- ⚠ 발췌본일 수 있다(${ex}) — 파일 머리말이 스스로 「발췌」라고 밝히는지 먼저 본다.`);
    if (it.reopen_reason) L.push(`- ↩ ${it.reopen_reason}`);
    L.push(`- 카드 id: \`${it.id}\``);
    const spots = it.spots || [];
    if (spots.length) {
      L.push('');
      L.push('어디가 빈가:');
      for (const s of spots.slice(0, SPOT_CAP)) L.push(`  - ${s}`);
      if (spots.length > SPOT_CAP) L.push(`  - …그리고 ${spots.length - SPOT_CAP}곳 더 — 글이 너무 길어져 앞 ${SPOT_CAP}곳만 적었다. **전부는 다시 받은 뒤 \`mok_audit.py\` 가 다시 센다.**`);
    }
    L.push('');
  });

  L.push('## 2. 해야 할 일 (종류별 — 카드에 적힌 것과 같다)');
  L.push('');
  for (const k of order) {
    const acts = (kinds[k].find((it) => (it.actions || []).length) || {}).actions || [];
    L.push(`### ${k} ${kinds[k].length}건`);
    L.push('');
    if (!acts.length) L.push('- (이 종류의 카드에는 할 일이 적혀 있지 않다 — 위 건별 내용을 보고 판단한다.)');
    acts.forEach((a) => L.push(`- ${a}`));
    L.push('');
  }
  L.push('### 공통');
  L.push('');
  L.push('1. **발췌본은 고치지 않는다.** 머리말이 「발췌」라고 밝히면 「해당없음」. 발췌인데 **선언이 없으면** 판정표에 「발췌·선언 없음」 으로 적는다 —');
  L.push('   ⚠ 이 경우 「해당없음」 으로 닫아도 **다음 점검에서 또 누락으로 나와 카드가 다시 뜬다**(닫힌 카드도 아직 빠져 있으면 대기로 되돌린다).');
  L.push('   머리말에 선언을 넣을지(raw 를 고치는 일)는 **사람이 정한다** — 이 작업에서 넣지 않는다.');
  L.push('2. 전문인데 정말 빠졌으면 위 종류별 도구로 **다시 받는다**. 받은 뒤 그 점검(`mok_audit.py` · `admrul_annex_survey.py`)을 다시 돌려 그 건이 0 이 되는지 본다.');
  L.push('3. 새로 들어온 목·별표를 짚는 위키가 있으면 서술을 맞춘다(원문 발췌는 복붙).');
  L.push('4. **검사**를 돌린다(저장소 루트): `bash scripts/refactor/verify_all.sh` — 기준선 대비 나빠진 문항이 0 이어야 한다.');
  L.push('5. 고친 파일 경로를 **개별 지정해** 커밋한다(`git add -A` 금지).');
  L.push('');

  L.push('## 3. 돌려줄 것 — 건마다 판정표');
  L.push('');
  L.push('작업이 끝나면 아래 표를 채워 답한다. **처리완료** = 실제로 다시 받아 그 점검이 0 이 됐다 · **해당없음** = 발췌본 등 모자란 것이 정상이다.');
  L.push('받지 못했거나 판단이 안 서면 판정 칸을 비우고 까닭을 적는다(추측으로 채우지 않는다).');
  L.push('');
  L.push('| # | 카드 id | 문서 | 판정(처리완료/해당없음) | 근거 한 줄 |');
  L.push('|---|---|---|---|---|');
  ordered.forEach((it, i) => L.push(`| ${i + 1} | \`${cell(it.id)}\` | ${cell(it.title)} ${cell(it.tier)} |  |  |`));
  L.push('');
  L.push('## 4. 지키는 규칙');
  L.push('');
  L.push('- **추측 금지.** 원본에 정말 그 목·별표가 있는지는 law.go.kr 응답으로 확인한다. 못 확인했으면 "못 확인했다"고 적는다.');
  L.push('- **발췌본을 전문으로 바꾸지 않는다** — 그것은 따로 정할 일이다.');
  L.push('- 원문이 정하지 않은 것(해석 다툼)은 단정하지 말고 `⚠REVIEW` 로 남긴다.');

  const kc = {};
  order.forEach((k) => { kc[k] = kinds[k].length; });
  return { ok: true, text: L.join('\n'), count: rows.length, kinds: kc, excerpt: nEx };
}

module.exports = { buildMokBrief, excerptSuspect, SPOT_CAP };
