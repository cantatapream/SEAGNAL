/**
 * ============================================================================
 * 파일명: scripts/test_wiki_brief_bulk.js
 * 역할: 「위키 반영 지시문」을 만드는 `services/legal_wiki_brief.js` 가 **큐에 있는 것만** 옮겨
 *       적는지, 없는 것을 지어내지 않는지, 일괄본이 단건본과 어긋나지 않는지 검사한다.
 *       그리고 「지금 스캔」 게이지가 읽는 **진행률 한 줄 파서**(legal_amendment_scanner.js)도 함께 본다.
 * ============================================================================
 *
 * [왜 있나 — 2026-09-10 사용자 요청으로 일괄본을 만들면서 함께 넣었다]
 * 이 글은 **사람이 그대로 복사해 AI 에게 넘기는 작업 지시**다. 여기에 틀린 조문이나 지어낸 문장이
 * 섞이면 그 오류가 위키에 그대로 옮겨 붙는다. 그래서 다음 넷을 기계로 고정한다:
 *   ①개정 전/후 본문은 **큐 값 그대로**여야 한다(손대지 않는다)
 *   ②본문이 없으면 "받지 못했다"고 적어야 한다(빈칸을 그럴듯한 문장으로 채우지 않는다)
 *   ③시행 전이면 시행일 마커를 쓰라고, 이미 시행 중이면 본문을 직접 고치라고 **정반대로** 안내한다
 *   ④목록을 줄였으면 **줄였다고 적어야 한다** — 조용히 자르면 "다 봤다"고 착각하게 된다
 *   ⑤어느 쪽을 보라고 짚을 때 **딴 법의 같은 번호 조문**을 끌고 오지 않는다(2026-09-10 오탐 수정)
 *
 * [연계]
 * - services/legal_wiki_brief.js → buildWikiBrief(단건) · buildBulkWikiBrief(일괄)
 * - services/legal_amendment_scanner.js → applyProgressLine · getScanProgress(게이지 값)
 * - scripts/refactor/verify_all.sh → SUITES 에 등록돼 있다(등록 안 하면 아무도 안 돌린다 — L-…)
 * [로드 순서] 번들 없음(서버 스크립트). `node local_server/scripts/test_wiki_brief_bulk.js`
 * ============================================================================
 */
'use strict';
const W = require('../services/legal_wiki_brief.js');

let pass = 0, fail = 0;
/** 한 항목을 검사하고 결과를 찍는다. @param {string} name @param {boolean} cond @param {string} [extra] */
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const TODAY = '20260910';

/**
 * 검사용 큐 항목 하나를 만든다(실제 큐 스키마와 같은 모양).
 * @param {object} o - {id, law, eff, arts}
 * @returns {object}
 */
function item(o) {
  return {
    id: o.id,
    법령명: o.law,
    layer: o.layer || '법률',
    kind: o.kind || '법률 개정(시행예정)',
    현재: { 시행일자: o.eff, 공포번호: o.no || '20001', 공포일자: '20260801', MST: o.mst || '123456' },
    changed_articles: o.arts || [],
  };
}

/** 조문 하나. 본문을 안 주면 "받지 못한" 상태를 만든다. */
function art(no, title, oldText, newText, isNew) {
  const a = { 조문번호: String(no), 조문가지번호: '0', 조문제목: title };
  if (oldText) a.옛본문 = oldText;
  if (newText) a.새본문 = newText;
  if (isNew) a.신설 = true;
  return a;
}

console.log('\n── 위키 반영 지시문(단건·일괄) ──');

// ── ① 빈 목록은 오류로 돌려준다(빈 글을 만들어 주지 않는다) ───────────────────
{
  const r = W.buildBulkWikiBrief([], TODAY);
  ok('T-bulk-1 묶을 항목이 없으면 ok:false 와 이유를 준다', r.ok === false && !!r.error, JSON.stringify(r).slice(0, 200));
  const r2 = W.buildBulkWikiBrief(null, TODAY);
  ok('T-bulk-2 목록이 배열이 아니어도 던지지 않는다', r2.ok === false, JSON.stringify(r2).slice(0, 200));
}

// ── ② 조문이 있는 건과 없는 건을 갈라 센다 ───────────────────────────────────
{
  const list = [
    item({ id: 'a1', law: '어선법', eff: '20261201', arts: [art(10, '어선의 등록', '옛 본문 AAA', '새 본문 BBB')] }),
    item({ id: 'a2', law: '해운법', eff: '20260101', arts: [] }),                       // 조문 정보 없음
    item({ id: 'a3', law: '항만법', eff: '20260101', kind: '신규 행정규칙(고시) 발견', layer: '행정규칙' }),
  ];
  const r = W.buildBulkWikiBrief(list, TODAY);
  ok('T-bulk-3 전체 건수·상세 건수·목록만 건수를 따로 센다',
    r.ok && r.count === 3 && r.detailed === 1 && r.listed === 2,
    `count=${r.count} detailed=${r.detailed} listed=${r.listed}`);
  ok('T-bulk-4 「한눈에 보기」 표에 상세 건이 한 줄로 들어간다',
    r.text.includes('| 1 | 어선법 | 법률 |') && r.text.includes('`a1`'), r.text.slice(0, 400));
  ok('T-bulk-5 조문 정보가 없는 건은 상세 절을 만들지 않고 목록으로만 담는다',
    !r.text.includes('### 2) 해운법') && r.text.includes('| 1 | 해운법 |') && r.text.includes('| 2 | 항만법 |'),
    '해운법이 상세 절로 들어갔거나 목록에서 빠졌다');
}

// ── ③ 개정 전/후 본문은 **큐 값 그대로** 옮긴다(손대지 않는다) ───────────────
{
  const OLD = '제10조(어선의 등록) ① 어선의 소유자는 옛 방식으로 등록하여야 한다.';
  const NEW = '제10조(어선의 등록) ① 어선의 소유자는 새 방식으로 등록하여야 한다. ② 새로 붙은 항이다.';
  const r = W.buildBulkWikiBrief([item({ id: 'b1', law: '어선법', eff: '20261201', arts: [art(10, '어선의 등록', OLD, NEW)] })], TODAY);
  ok('T-bulk-6 개정 전 본문이 원문 그대로 실린다', r.text.includes(OLD), r.text.slice(0, 600));
  ok('T-bulk-7 개정 후 본문이 원문 그대로 실린다', r.text.includes(NEW));
  ok('T-bulk-8 조문 제목과 번호가 제목 줄에 그대로 나온다', r.text.includes('제10조(어선의 등록)'));
}

// ── ④ 없는 것을 지어내지 않는다 ──────────────────────────────────────────────
{
  const r = W.buildBulkWikiBrief([item({ id: 'c1', law: '어선법', eff: '20261201', arts: [art(11, '없는 본문', null, null)] })], TODAY);
  ok('T-bulk-9 본문이 없으면 「받지 못했다」고 적는다', r.text.includes('새 본문을 받지 못했다'), r.text.slice(0, 800));
  ok('T-bulk-10 「한눈에 보기」가 본문 없음을 굵게 표시한다', r.text.includes('| **없음** |'));
  ok('T-bulk-11 본문 없는 건이 있으면 「지금 스캔」을 다시 돌리라고 안내한다', r.text.includes('「지금 스캔」을 다시 돌린'));

  const rNew = W.buildBulkWikiBrief([item({ id: 'c2', law: '어선법', eff: '20261201', arts: [art(12, '신설조', null, '새 조문 본문', true)] })], TODAY);
  ok('T-bulk-12 신설 조는 「신설」로 표시한다', rNew.text.includes('— **신설**'), rNew.text.slice(0, 700));
  ok('T-bulk-13 신설 조의 개정 전 칸은 「우리 원문에 없다」로 적는다(빈칸을 지어내지 않는다)',
    rNew.text.includes('우리가 가진 원문에 이 조가 없다'));
}

// ── ⑤ 시행 전/시행 중을 **정반대로** 안내한다 ────────────────────────────────
{
  const future = W.buildBulkWikiBrief([item({ id: 'd1', law: '어선법', eff: '20271231', arts: [art(10, '가', '옛', '새')] })], TODAY);
  ok('T-bulk-14 시행 전 건이 있으면 시행일 마커를 쓰라고 안내한다',
    future.text.includes('시행일 마커를 쓴다') && future.text.includes('<!--시행전'), future.text.slice(-1200));
  ok('T-bulk-15 시행 전 건은 표에 「(시행 전)」이 붙는다', future.text.includes('(시행 전)'));

  const past = W.buildBulkWikiBrief([item({ id: 'd2', law: '어선법', eff: '20260101', arts: [art(10, '가', '옛', '새')] })], TODAY);
  ok('T-bulk-16 전부 시행 중이면 마커를 쓰지 말고 본문을 직접 고치라고 안내한다',
    past.text.includes('마커를 쓰지 않는다') && !past.text.includes('<!--시행전'), past.text.slice(-1200));
}

// ── ⑥ 재수집 명령은 수집 목록을 읽는 한 줄이다 (3-82) ──────────────────────
{
  const r = W.buildBulkWikiBrief([item({ id: 'e1', law: '어선법', eff: '20261201', arts: [art(10, '가', '옛', '새')] })], TODAY);
  ok('T-bulk-17 일괄본은 collect_approved.py --from-brief 로 법령·행정규칙을 한 번에 받으라고 적는다(3-82)',
    r.text.includes('collect_approved.py --from-brief') && !r.text.includes('collect_pending_law.py --all-approved'), r.text.slice(-1600));
  ok('T-bulk-18 보류·실패는 받지 않은 것이라고, 관련 법이 여럿인 새 고시는 --place 로 정한다고 적는다',
    r.text.includes('받지 않은 것이다') && r.text.includes('--place <큐id>=<법slug>'));
  ok('T-bulk-19 검사(verify_all.sh)와 「나빠진 문항 0」 기준을 적는다',
    r.text.includes('verify_all.sh') && r.text.includes('나빠진 문항이 0'));
  ok('T-bulk-20 커밋 규칙(git add -A 금지)을 적는다', r.text.includes('`git add -A` 금지'));
}

// ── ⑦ 단건본은 종전 그대로다(일괄을 만들며 깨지지 않았는지) ──────────────────
{
  const one = W.buildWikiBrief(item({ id: 'f1', law: '어선법', eff: '20261201', arts: [art(10, '어선의 등록', '옛 본문', '새 본문') ] }), TODAY);
  ok('T-brief-1 단건본은 「위키 반영 요청 — <법령명>」으로 시작한다',
    one.ok && one.text.startsWith('# 위키 반영 요청 — 어선법 법률 (시행 2026-12-01)'), one.text.slice(0, 120));
  ok('T-brief-2 단건본에도 개정 전/후가 그대로 실린다', one.text.includes('옛 본문') && one.text.includes('새 본문'));
  ok('T-brief-3 단건본도 끝에 그 건 하나의 수집 목록을 싣고 collect_approved.py 로 받으라고 적는다(3-82)',
    one.text.includes('collect_approved.py --from-brief') && /"id":"f1"/.test(one.text), one.text.slice(-1200));
  ok('T-brief-4 단건본은 pages 배열을 함께 돌려준다', Array.isArray(one.pages));
  const none = W.buildWikiBrief(null, TODAY);
  ok('T-brief-5 항목이 없으면 던지지 않고 ok:false 를 준다', none.ok === false);
}

// ── ⑧ 목록을 줄였으면 **줄였다고 적는다**(조용히 자르지 않는다) ──────────────
//    실제 위키에서 인용 페이지가 20쪽을 넘는 법을 쓴다. 넘지 않으면 이 검사는 건너뛴다
//    (위키 상태에 따라 달라지는 값이라 "몇 쪽"을 못박지 않는다).
{
  const r = W.buildBulkWikiBrief([item({ id: 'g1', law: '해양환경관리법', eff: '20261201', arts: [art(2, '정의', '옛', '새')] })], TODAY);
  const capped = /…그리고 \d+쪽 더 — 글이 너무 길어져 여기서는 앞 20쪽만 적었다/.test(r.text);
  const many = /\*\*그 법을 타법으로 인용하는 페이지 (\d+)쪽\*\*/.exec(r.text);
  const n = many ? Number(many[1]) : 0;
  if (n > 20) {
    ok('T-bulk-21 인용 목록을 줄였으면 몇 쪽을 줄였는지 적는다', capped, r.text.slice(0, 200));
    ok('T-bulk-22 줄인 목록 전부를 보는 방법(개별 지시문)을 함께 적는다',
      r.text.includes('「위키 반영 지시문 만들기」(개별)'));
    const one = W.buildWikiBrief(item({ id: 'g2', law: '해양환경관리법', eff: '20261201', arts: [art(2, '정의', '옛', '새')] }), TODAY);
    ok('T-bulk-23 단건본에는 상한을 걸지 않는다(전부 적는다)', !/…그리고 \d+쪽 더/.test(one.text));
  } else {
    console.log(`  ⏭️ T-bulk-21~23 건너뜀 — 이 위키에서 해양환경관리법 인용 페이지가 ${n}쪽이라 상한(20)에 안 걸린다`);
  }
}

// ── ⑨ 어느 쪽이 걸렸나 — 지시문이 **딴 법 조문을 끌고 오지 않는가**(2026-09-10 오탐 수정) ──
{
  console.log('\n── 바뀐 조문이 적힌 쪽 고르기(오탐) ──');
  const 어촌 = '어촌ㆍ어항법';

  // ①`제6조` 로 찾다가 `제6조의2` 를 잡으면 안 된다 — 다른 조다.
  ok('T-hit-1 표 칸 `제6조의2` 는 `제6조` 가 아니다', W.articleCellHas('제6조의2', '6', '') === false);
  ok('T-hit-2 표 칸 `제6조의2` 는 `제6조의2` 다', W.articleCellHas('제6조의2', '6', '2') === true);
  ok('T-hit-3 표 칸 범위 `제5~9조` 는 `제6조` 를 담는다', W.articleCellHas('제5~9조', '6', '') === true);

  // ②남의 법 페이지에서는 **법 이름 바로 뒤**일 때만 인정한다.
  ok('T-hit-4 법 이름 바로 뒤면 인정', W.bodyMentions('「어촌ㆍ어항법」 제27조에 따라', 어촌, '제27조', false) === true);
  ok('T-hit-5 딴 법 이름 뒤의 같은 번호는 아니다',
    W.bodyMentions('「하수도법」 제27조 배수설비 설치신고', 어촌, '제27조', false) === false);
  ok('T-hit-6 200자 안에 있어도 딴 법 조문이면 아니다(옛 규칙이 잡던 자리)',
    W.bodyMentions('「어촌ㆍ어항법」 제45조에 따른 준공검사, 「하천법」 제30조 제7항, 「건축법」 제22조 제2항. 즉 건축허가 제8조 11호는',
      어촌, '제8조', false) === false);
  ok('T-hit-7 위키 링크로 적힌 법 이름도 법 이름으로 본다',
    W.bodyMentions('[[어촌ㆍ어항법__어항개발사업|어항개발사업]]제27조 제1항', 어촌, '제27조', false) === true);

  // ③그 법 자신의 페이지에서는 법 이름을 다시 안 적는다 — 맨 조문도 인정하되 하위법령은 뺀다.
  ok('T-hit-8 그 법 자신의 쪽에서는 맨 조문도 인정',
    W.bodyMentions('- 제21조: "어촌계나 지구별수협이 가지고 있는 어업권은 담보로 제공할 수 없다"', 어촌, '제21조', true) === true);
  ok('T-hit-9 그 법 자신의 쪽이라도 **시행규칙 제11조**는 그 법의 조가 아니다',
    W.bodyMentions('같은 규칙 제11조 ①~③은 신청서 첨부서류를', 어촌, '제11조', true) === false);
  ok('T-hit-10 남의 법 쪽에서는 맨 조문을 인정하지 않는다',
    W.bodyMentions('- 제21조: 담보로 제공할 수 없다', 어촌, '제21조', false) === false);
  ok('T-hit-11 개정된 것이 **시행규칙 자신**이면 하위법령 걸림돌을 걸지 않는다',
    W.bodyMentions('같은 규칙 제11조 ①~③은', '어선안전조업법 시행규칙', '제11조', true) === true);
}

// ── ⑨ 「지금 스캔」 진행률 — 탐지 스크립트가 찍는 한 줄을 제대로 읽나 ────────────────
//    이 파서가 잘못되면 게이지가 **엉뚱한 숫자로 차오르거나 멈춘 것처럼 보인다.** 화면이 그대로
//    믿는 값이라 여기서 고정한다. 실제 스캔(외부 API·3~4분)은 돌리지 않는다 — 파서만 먹여 본다.
{
  const S = require('../services/legal_amendment_scanner.js');
  console.log('\n── 「지금 스캔」 진행률 파서 ──');

  S.applyProgressLine('@@PROG {"phase":"법령","done":4,"total":10,"label":"W3 해양수산부"}');
  let g = S.getScanProgress();
  ok('T-prog-1 1단계 값을 그대로 읽는다', g.phase === '법령' && g.done === 4 && g.total === 10 && g.label === 'W3 해양수산부',
    JSON.stringify(g));
  ok('T-prog-2 1단계 퍼센트는 done/total 이다', g.percent === 40, `percent=${g.percent}`);

  // 2단계는 1단계 총량 뒤를 이어 차오른다(막대가 중간에 되돌아가면 안 된다).
  S.applyProgressLine('@@PROG {"phase":"행정규칙","done":3,"total":8,"label":"해양경찰청","detail":12}');
  const g2 = S.getScanProgress();
  ok('T-prog-3 2단계는 1단계 총량 뒤를 이어 센다(3+10)/(8+10)',
    g2.done === 13 && g2.total === 18 && g2.percent === 72, JSON.stringify(g2));
  ok('T-prog-4 고시 상세 확인 횟수를 함께 읽는다', g2.detail === 12, JSON.stringify(g2));
  ok('T-prog-5 막대는 뒤로 가지 않는다(1단계 40% → 2단계 72%)', g2.percent >= g.percent);

  // 사람이 읽는 print 줄·깨진 줄은 흘려보낸다(진행률 때문에 스캔이 죽으면 안 된다).
  const before = JSON.stringify(S.getScanProgress());
  S.applyProgressLine('baseline 74법 · 법령ID 300 · 고시 500 — 최근 7일 스캔 시작');
  S.applyProgressLine('@@PROG {깨진 JSON');
  S.applyProgressLine('');
  S.applyProgressLine(null);
  ok('T-prog-6 사람이 읽는 줄·깨진 줄·빈 줄은 무시한다(값이 안 바뀐다)',
    JSON.stringify(S.getScanProgress()) === before, S.getScanProgress().phase);

  ok('T-prog-7 스캔이 안 돌 때는 running:false 다', S.getScanProgress().running === false);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
