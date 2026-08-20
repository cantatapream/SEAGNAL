'use strict';
// ============================================================================
// [2026-08-11 §H-36] 해역·항해구역 트리(zone_tree.json) 실서빙 배선 회귀 테스트
//   실행: node local_server/scripts/test_zone_tree_wiring.js
//   설계 원문: knowledge/legal/_dashboard/H36_live_wiring_design.md
//   적대검증:  knowledge/legal/_dashboard/H36_adversarial_review.md (여기서 나온 결함 4건이 T3·T4·T6)
//
//   배경: 이 배선(services/legal_retriever.js 신규 358줄)에는 자동 테스트가 0건이었다. 라이브
//   주행으로만 확인했고 커밋된 것이 없어, 같은 결함이 조용히 재발해도 다음 사람이 돌릴 것이
//   없었다(CLAUDE.md 결정로그 "게이트의 존재와 커버리지는 다른 문제다"). 이 파일이 그 계약을
//   고정한다 — zone_tree.json 이나 배선 코드가 바뀌면 여기서 먼저 깨져야 한다.
//
//   [연계] services/legal_retriever.js(zoneTreeStep·matchZoneTreeTopic·resolveZoneTreePath) ·
//          knowledge/legal/_dashboard/zone_tree.json(자산) · knowledge/legal/raw/**(인용 원문) ·
//          client/js/ai-chat/ai_chat.js pickClarifyOption(버튼 클릭 = 질의에 ' — 라벨' 누적) ·
//          scripts/refactor/verify_all.sh V5 SUITES(여기에 등록돼 있어야 실제로 돌아간다)
//   ※ 시각 비의존 — 실행 시각과 무관하게 같은 결과가 나와야 한다(CLAUDE.md 결정로그).
// ============================================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const RET = path.join(__dirname, '..', 'services', 'legal_retriever.js');
const LEGAL = path.join(__dirname, '..', 'knowledge', 'legal');
const TREE_JSON = path.join(LEGAL, '_dashboard', 'zone_tree.json');
const R = require(RET);
const J = JSON.parse(fs.readFileSync(TREE_JSON, 'utf8'));
const JOINER = ' — ';                       // = CLARIFY_JOINER = ai_chat.js pickClarifyOption 이 붙이는 구분자
// 경계형 답변 뒤 확인("서류·장비 기준도 알려드릴까요?")의 선택지 라벨(legal_retriever.js ZONE_MORE_*).
// ⚠여기 값이 배선 코드와 어긋나면 T4·T7·T8이 통째로 경계형 답변을 보게 되어 즉시 깨진다(의도된 게이트).
const MORE_YES = '네, 서류·장비 기준도 알려주세요';
const MORE_NO = '아니요, 여기까지면 돼요';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : extra); }
};

/** 트리의 모든 노드를 (노드, 부모가 부르는 선택지 label)로 편다. */
function nodesOf(tree) {
  const out = [];
  (function walk(n, parent) {
    const opt = parent ? ((parent.선택지 || []).find(o => o && o.next === n.id) || {}).label : null;
    out.push({ node: n, optLabel: opt, leaf: !(n.children || []).length });
    for (const c of (n.children || [])) walk(c, n);
  })(tree.tree, null);
  return out;
}
const ALL = [].concat(...J.trees.map(t => nodesOf(t).map(x => Object.assign({ tree: t }, x))));

// 되묻기 버튼을 끝까지 눌러 도달한 리프별 (질의·답변·그 리프의 적용항목 전량).
// T1은 "도달했는가"만 보고, T8(§13 표시 규칙)은 그 답변의 **내용**을 봐야 해서 따로 모은다.
// ★2026-08-13(L-84): 리프에 닿으면 먼저 **경계형 짧은 답변 + 확인**이 나오므로, §13 표시 규칙을
//   보는 T8은 그 확인에서 "네"를 누른 뒤의 **확장 답변**을 대상으로 한다(BFS가 두 선택지를 다
//   눌러 보되, 기록은 "아니요" 가지를 뺀 것 = 확장 답변). 확인 단계 자체의 계약은 T9가 본다.
const SEEDS = [
  '우리 배 어디까지 나갈 수 있나요?',
  '배로 영해까지 나가도 되나요?',
  '배로 내수면까지 갈 수 있나요?',
  '어선으로 어디서 조업할 수 있나요?',
  '배로 배타적 경제수역까지 나가도 되나요?',
  '배로 해수면까지 나갈 수 있나요?',
  // sea_area 루트(waters)는 서로 다른 가지의 라벨 2개를 같이 말해야만 되묻기가 뜬다
  // (한쪽만 말하면 ②암시 하강이 곧바로 그 자식으로 내려간다 — 적대검증 §2 부수관찰).
  '배가 영해랑 사유수면 중 어디까지 갈 수 있나요?',
];
function leafAnswers() {
  const out = new Map();
  const queue = SEEDS.slice(); const seen = new Set(queue);
  while (queue.length) {
    const q = queue.shift();
    const tree = R.matchZoneTreeTopic(q); if (!tree) continue;
    const step = R.zoneTreeStep(q); if (!step) continue;
    if (step.clarify) {
      for (const o of step.clarify.options) { const nq = q + JOINER + o.label; if (!seen.has(nq)) { seen.add(nq); queue.push(nq); } }
      continue;
    }
    if (q.endsWith(JOINER + MORE_NO)) continue;      // "아니요" 가지는 경계형 답변이라 §13 대상이 아니다
    const { node, path: p } = R.resolveZoneTreePath(q, tree);
    if (!out.has(node.id)) out.set(node.id, { q, node, answer: step.answer, rules: R.collectZoneRules(tree, p) });
  }
  return out;
}

// ── T1. 리프 도달성 전수 BFS ────────────────────────────────────────────────
// 클라이언트 버튼 클릭을 그대로 재현한다(질의 + ' — ' + 서버가 내려준 option.label).
// L-77 결함①(근해구역 이상 오하강)·결함②(그 밖의 먼바다 도달 불가)가 이 성질로 표현된다.
console.log('\n[T1] 리프 도달성 — 버튼 클릭 BFS 전수 전개');
{
  const reached = new Set(), answered = new Set(), abandoned = [];
  const queue = SEEDS.slice();
  const seen = new Set(queue);
  while (queue.length) {
    const q = queue.shift();
    const tree = R.matchZoneTreeTopic(q);
    if (!tree) { abandoned.push(q); continue; }
    const { node } = R.resolveZoneTreePath(q, tree);
    reached.add(node.id);
    const step = R.zoneTreeStep(q);
    if (!step) { abandoned.push(q); continue; }
    if (step.clarify) {
      for (const o of step.clarify.options) {
        const nq = q + JOINER + o.label;
        if (!seen.has(nq)) { seen.add(nq); queue.push(nq); }
      }
    } else { answered.add(node.id); }
  }
  const leaves = ALL.filter(x => x.leaf).map(x => x.node.id);
  const missNode = ALL.map(x => x.node.id).filter(id => !reached.has(id));
  const missLeaf = leaves.filter(id => !answered.has(id));
  ok(`노드 ${ALL.length}개 전부 도달`, missNode.length === 0, missNode);
  ok(`리프 ${leaves.length}개 전부 답변 생성`, missLeaf.length === 0, missLeaf);
  ok('클릭 도중 트리 포기 0건', abandoned.length === 0, abandoned);
}

// ── T2. 게이트 발화 — 트리로 들어갈 질문 / 기존 흐름 그대로 둘 질문 ─────────
// 이 배선의 최우선 계약은 "트리와 무관한 질문의 응답이 배선 전과 같다"(설계 §0-3)이다.
console.log('\n[T2] 게이트 발화 · 회귀 대조군');
{
  for (const [q, want] of [
    ['낚싯배로 제주도까지 갈 수 있나요?', 'navigation_zone'],
    ['어선으로 어디서 조업할 수 있나요?', 'fishing_operation_area'],
    ['배로 접속수역까지 나가도 되나요?', 'sea_area'],
  ]) { const t = R.matchZoneTreeTopic(q); ok(`발화 → ${want}: ${q}`, t && t.id === want, t && t.id); }
  for (const q of [
    '구명조끼 몇 개 필요해요?',
    '저희 배(연해구역 항해, 20톤)는 DGPS를 꼭 달아야 하나요?',
    '바다에서 술 마시면 처벌받나요?',
    '영해에서 외국선박이 뭘 못하나요?',
    '행정처분까지 갈 수 있나요?',
    '선박에 인명구조요원이 없으면 영업정지까지 갈 수 있나?',
    '운영해도 되나요?',
  ]) ok(`기존 흐름 유지(null): ${q}`, R.zoneTreeStep(q) === null);
}

// ── T3. 다중어절·괄호 라벨 매칭 (적대검증 §8-①) ────────────────────────────
// 공백이 든 라벨("배타적 경제수역")을 공백 지운 문자열에서 낱말경계로 검사하면 **문장 중간에서
// 100% 탈락**해 엉뚱한 트리로 라우팅됐다. 3개 트리 모든 라벨을 문장 3위치에서 전수 확인한다.
console.log('\n[T3] 라벨 전수 — 문장 앞/중간/조사 뒤에서 그 노드로 내려가는가');
{
  const isDesc = (root, id) => { let f = false; (function w(n) { if (n.id === id) f = true; for (const c of (n.children || [])) w(c); })(root); return f; };
  let miss = 0, n = 0;
  for (const { tree, node, optLabel } of ALL) {
    for (const label of [...new Set([node.라벨, optLabel].filter(Boolean))]) {
      for (const q of [
        `${label}까지 배로 나갈 수 있나요?`,
        `배로 ${label}까지 나갈 수 있나요?`,
        `우리 배가 ${label}에서 조업해도 되나요? 어디까지 갈 수 있나요?`,
      ]) {
        n++;
        const got = R.resolveZoneTreePath(q, tree).node;
        if (got.id !== node.id && !isDesc(node, got.id)) { miss++; console.log(`     ↳ MISS ${node.id} "${label}" → ${got.id}`); }
      }
    }
  }
  ok(`라벨 ${n}회 대조 — 매칭 실패 0건`, miss === 0, miss);
  // 라이브에서 실제로 오라우팅됐던 문장 그대로(적대검증 §8-① 재현 시나리오)
  for (const [q, want] of [
    ['배로 배타적 경제수역까지 나가도 되나요?', 'sea_area'],
    ['배로 공공용 수면까지 갈 수 있나요?', 'sea_area'],
    ['우리 배가 그 밖의 먼바다까지 갑니다 어디까지 갈 수 있나요?', 'sea_area'],
    ['배로 수상(水上)까지 나갈 수 있나요?', 'sea_area'],
  ]) { const t = R.matchZoneTreeTopic(q); ok(`오라우팅 재발 방지: ${q}`, t && t.id === want, t && t.id); }
}

// ── T4. 경로 상속의 `구역범위` 준수 (적대검증 §8-②) ─────────────────────────
// 조상 노드에 "이 구역 이하"로 걸린 항목이 그보다 깊은 리프까지 따라가면, 자기 데이터가
// "이 구역은 대상이 아니다"라고 말하는 항목이 그 구역의 의무로 표시된다.
console.log('\n[T4] 상속 범위 — 서열 밖 규정이 리프에 딸려가지 않는가');
{
  const base = '우리 배 어디까지 나갈 수 있나요?';
  // ★상속 결과는 **확장 답변**에서만 항목으로 보인다(L-84 이후 경계형 답변엔 건수만 실린다) —
  //   그래서 확인에서 "네"를 누른 뒤의 답변을 본다. 상속 로직 자체는 이 변경과 무관하다.
  const ans = segs => (R.zoneTreeStep([base].concat(segs).concat([MORE_YES]).join(JOINER)) || {}).answer || '';
  ok('평수구역 — 근해 이하 규정(승무 전 건강진단) 포함', ans(['평수구역']).includes('승무 전 일반건강진단'));
  ok('연해구역 — 포함', ans(['연해구역']).includes('승무 전 일반건강진단'));
  ok('근해구역 — 포함', ans(['근해구역 이상', '근해구역']).includes('승무 전 일반건강진단'));
  ok('원양구역 — 미포함(원문이 원양을 열거하지 않는다)', !ans(['근해구역 이상', '원양구역']).includes('승무 전 일반건강진단'));
  // 일반 불변식: 리프에 실린 어떤 항목도 그 리프의 서열 밖 `구역범위`를 갖지 않는다.
  let bad = [];
  for (const { tree, node, leaf } of ALL) {
    if (!leaf || node.서열 == null) continue;
    const p = [];
    (function findPath(n, acc) { const a = acc.concat([n]); if (n.id === node.id) { p.push(...a); return; } for (const c of (n.children || [])) findPath(c, a); })(tree.tree, []);
    for (const n of p) for (const r of (n.적용 || [])) {
      if (n.서열 == null) continue;
      if (r.구역범위 === '이 구역 이상' && n.서열 > node.서열) bad.push(`${node.라벨}←${n.라벨}:${r.제목}`);
      if (r.구역범위 === '이 구역 이하' && n.서열 < node.서열) bad.push(`${node.라벨}←${n.라벨}:${r.제목}`);
    }
  }
  ok('경로상 서열 밖 항목 0건', bad.length === 0, bad);
}

// ── T5. 자산이 없거나 깨져도 예외 없이 null (설계 §0-4 안전폴백) ────────────
console.log('\n[T5] 자산 고장 — 예외 없이 기존 흐름 폴백');
{
  // fs 를 스텁한 **별도 프로세스**에서 확인한다(저장소 파일은 건드리지 않는다).
  // 모듈 로드 시 다른 로그가 stdout 으로 나오므로 표식을 붙여 그 줄만 본다.
  const probe = (stub) => {
    const code = `const fs=require('fs');${stub};const R=require(${JSON.stringify(RET)});` +
      `process.stdout.write('\\nZONE_RESULT:'+String(R.zoneTreeStep('낚싯배로 제주도까지 갈 수 있나요?')));`;
    const out = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return (out.match(/ZONE_RESULT:(.*)$/m) || [])[1];
  };
  const isZone = `String(p).endsWith('zone_tree.json')`;
  ok('파일 없음(ENOENT) → null',
    probe(`const s=fs.statSync;fs.statSync=(p,...a)=>{if(${isZone}){const e=new Error('ENOENT');e.code='ENOENT';throw e;}return s(p,...a);}`) === 'null');
  ok('JSON 깨짐 → null',
    probe(`const r=fs.readFileSync;fs.readFileSync=(p,...a)=>${isZone}?'{ trees: [ BROKEN':r(p,...a)`) === 'null');
  ok('스키마 이상(tree 없음) → null',
    probe(`const r=fs.readFileSync;fs.readFileSync=(p,...a)=>${isZone}?'{"trees":[{"id":"navigation_zone"}]}':r(p,...a)`) === 'null');
}

// ── T6. 인용문이 "다만" 단서를 절단표시 없이 버리지 않는가 (적대검증 §5-A) ──
// 본문 끝점이 "…한다."라서 바로 뒤 "다만, …인 경우에는 그러하지 아니하다"가 통째로 사라지면,
// 화면의 큰따옴표 안 "원문"이 **예외 없는 규정**으로 보인다(원문보다 엄격해지는 쪽이라 위험).
console.log('\n[T6] 인용 — 바로 뒤에 붙은 "다만" 단서를 말없이 버리지 않는가');
{
  const cites = [];
  for (const t of J.trees) for (const { node } of nodesOf(t)) {
    for (const r of (node.적용 || [])) cites.push(r);
    for (const r of (node.provenance || [])) cites.push(r);
  }
  const cut = [];
  // ★고시(행정규칙) 계열은 조문 머리 형식이 다르다(L-54) — 대괄호가 없고(`제7조(제목) ①…`),
  //   별표는 본문 뒤에 `[별표 N]` 줄로 이어 붙는다. 2026-08-11 확장으로 이 계열 인용이 들어와,
  //   법률계열 정규식 하나로만 찾으면 107건이 통째로 "조문없음"이 된다.
  const unitSpan = (txt, file, unit) => {
    if (!/\/행정규칙\//.test(file)) {
      const art = (unit.match(/제\d+조(?:의\d+)?/) || [])[0];
      if (!art) return null;
      const s = txt.search(new RegExp('^\\[' + art + '\\]', 'm'));
      if (s < 0) return null;
      const after = txt.slice(s + art.length);
      const e = after.search(/^\[제\d+조/m);
      return [s, s + art.length + (e < 0 ? after.length : e)];
    }
    const heads = [];
    let off = 0;
    for (const line of txt.split('\n')) {
      const t = line.trim();
      const m = t.match(/^제(\d+)조(?:의(\d+))?\s*\(/);
      const b = t.match(/\[별표\s?(\d+)\]\s*$/);
      if (m) heads.push(['제' + m[1] + '조' + (m[2] ? '의' + m[2] : ''), off]);
      else if (b) heads.push(['별표 ' + b[1], off]);
      off += line.length + 1;
    }
    const i = heads.findIndex(h => h[0] === unit);
    if (i < 0) return null;
    return [heads[i][1], i + 1 < heads.length ? heads[i + 1][1] : txt.length];
  };
  for (const r of cites) {
    const art = r.근거조문 || r.조문;
    const txt = fs.readFileSync(path.join(LEGAL, r.파일), 'utf8');
    const span = unitSpan(txt, r.파일, art);
    if (!span) { cut.push(`조문없음 ${r.파일} ${art}`); continue; }
    const flat = txt.slice(span[0], span[1])
      .replace(/<img[^>]*>|<\/img>/g, ' ').replace(/\s+/g, ' ').trim();
    let q = r.인용.startsWith('… ') ? r.인용.slice(2) : r.인용;
    if (q.endsWith('…')) continue;                       // 절단표시가 있으면 정직하게 잘린 것
    const i = flat.indexOf(q);
    if (i < 0) { cut.push(`원문불일치 ${r.파일} ${art}`); continue; }
    if (flat.slice(i + q.length).trimStart().startsWith('다만')) cut.push(`${r.파일} ${art} — ${r.제목 || '(provenance)'}`);
  }
  ok(`인용 ${cites.length}건 — 단서 무단 절단 0건`, cut.length === 0, cut);
}

// ── T7. 배선 전 필수 규약(MASTER_PLAN H-36) ────────────────────────────────
console.log('\n[T7] 필수 규약 — 처벌 표기·주의 노출·신뢰등급');
{
  // 규약 ①③(처벌 표기·주의 노출)은 규정 항목이 실제로 펼쳐진 **확장 답변**의 계약이다 —
  // 경계형 짧은 답변에는 항목이 한 건도 실리지 않으므로(L-84) "네"를 누른 뒤를 본다.
  const territorial = R.zoneTreeStep('배로 영해까지 나가도 되나요?' + JOINER + MORE_YES);
  ok('영해 리프가 답변을 낸다', !!(territorial && territorial.answer && !territorial.clarify));
  const a = (territorial || {}).answer || '';
  ok('처벌은 "처벌(법정형)"으로 표기', a.includes('처벌(법정형)'));
  ok('선고형이 아님을 명시', a.includes('실제 선고형은 사안에 따라 달라져요'));
  // ★2026-08-14(H-37 §8, 사용자 확정): 신뢰등급 **꼬리표를 없앴다** — 예전엔 본문 서두 한 문장과
  //   note 한 줄이 등급을 말했다. 이제 둘 다 없고, "이 목록이 전부는 아니다"라는 커버리지 고지만
  //   말미에 남는다(그건 등급이 아니라 자산에서 조립한 한계 설명이다).
  ok('등급 문장 제거 — 본문 서두', !a.includes('사람이 검증한 위키 카드가 아니라'));
  ok('커버리지 고지는 유지 — 본문 말미(목록의 한계)', a.includes('목록에 없다고 해서 그런 규정이 없다는 뜻은 아닙니다'));
  ok('등급 꼬리표 제거 — note 가 비어 있다', ((territorial || {}).note || '') === '');
  ok('되묻기 note(UI 상태)는 유지', (R.zoneTreeStep('낚싯배로 제주도까지 갈 수 있나요?') || {}).note === '추가 정보가 필요해요');
  ok('영해및접속수역법 제5조② 단서(허가받은 경우)가 화면에 보인다', a.includes('관계 당국의 허가ㆍ승인 또는 동의를 받은 경우에는 그러하지 아니하다'));
  // `주의`·`적용제외`는 조건 없이 언제나 함께 나와야 한다(규약 2).
  const withNote = [];
  for (const { node } of ALL) for (const r of (node.적용 || [])) if (r.주의 || r.적용제외) withNote.push(r);
  ok('주의·적용제외를 가진 항목이 자산에 존재(빈 검사 방지)', withNote.length > 0, withNote.length);
  const smooth = (R.zoneTreeStep('우리 배 어디까지 나갈 수 있나요?' + JOINER + '평수구역' + JOINER + MORE_YES) || {}).answer || '';
  ok('평수구역 답변에 적용제외가 실제로 출력된다', smooth.includes('적용제외:'));
}

// ── T8. §13 표시 규칙 — 관련도 필터·접기·면책 문구 데이터화 (L-81 근본해법) ──
// 고시 확장(자산 79→186건)으로 배선 코드를 한 줄도 안 고쳤는데 리프 답변이 1.5만~1.8만 자로
// 폭증하고, 하드코딩된 면책 문구("고시의 구역별 설비·수량 기준은 여기 들어 있지 않아요")가
// **거짓**이 됐다(L-81). 여기서 고정하는 계약은 넷이다 — ①분량 ②데이터 유실 0 ③주의·적용제외
// 전수 노출 ④면책 문구가 자산을 따라간다(코드가 산문으로 단언하지 않는다).
console.log('\n[T8] §13 표시 규칙 — 관련도 정렬 · 접기 · 면책 문구');
{
  const leaves = leafAnswers();
  ok(`리프 ${leaves.size}개 답변 수집`, leaves.size === ALL.filter(x => x.leaf).length, leaves.size);

  // ① 분량 — 상한은 문자 수로 자르는 것이 아니라 **항목 개수 상한의 결과**다(설계 §13.2-5).
  //    수정 전 최대 18,101자 → 수정 후 최대 11,456자(실측). 상한은 그 위에 여유를 둔 값이다.
  const LIMIT = 13000;
  const tooLong = [...leaves.values()].filter(x => x.answer.length > LIMIT).map(x => x.node.id + ':' + x.answer.length);
  ok(`리프 전수 본문 ${LIMIT}자 이하`, tooLong.length === 0, tooLong);

  // ② 데이터 유실 0 — 항목 하나하나가 **펼침(가. 제목)이든 접힘(· 제목 — 「법령」)이든** 화면에 있다.
  //    (항목 번호는 15번째부터 '가나다…' 대신 숫자라 두 형태를 다 본다.)
  const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openAt = (a, t) => { const m = a.match(new RegExp('(?:^|\\n)(?:[가-하]|\\d+)\\. ' + esc(t) + '\\n')); return m ? m.index : -1; };
  const foldAt = (a, t) => a.indexOf('\n· ' + t + ' — 「');
  const lost = [];
  for (const [id, x] of leaves) {
    let opened = 0, folded = 0;
    for (const e of x.rules) {
      if (openAt(x.answer, e.rule.제목) >= 0) opened++;
      else if (foldAt(x.answer, e.rule.제목) >= 0) folded++;
      else lost.push(`${id}: 화면에 없음 — ${e.rule.제목}`);
    }
    if (opened + folded !== x.rules.length) lost.push(`${id}: 펼침${opened}+접힘${folded} ≠ ${x.rules.length}`);
  }
  ok('펼침 + 접힘 = 전체(항목 소실 0)', lost.length === 0, lost.slice(0, 5));

  // ③ 배선 전 필수 규약② — `주의`·`적용제외`는 점수와 무관하게 **언제나 펼쳐서** 노출.
  const hidden = [];
  for (const [id, x] of leaves) {
    for (const e of x.rules) {
      if (e.rule.주의 && !x.answer.includes(`⚠주의: ${e.rule.주의}`)) hidden.push(`${id}: 주의 미노출 — ${e.rule.제목}`);
      if (e.rule.적용제외 && !x.answer.includes(`적용제외: ${e.rule.적용제외}`)) hidden.push(`${id}: 적용제외 미노출 — ${e.rule.제목}`);
    }
  }
  ok('주의·적용제외 전수 노출(접기가 무력화하지 않는다)', hidden.length === 0, hidden.slice(0, 5));

  // ④ 관련도 정렬이 실제로 작동 — 질문어가 든 항목이 접히지 않고 펼쳐진다(설계 §13.5-T2).
  const relev = (q, title) => {
    const a = (R.zoneTreeStep(q) || {}).answer || '';
    return a.includes(`. ${title}`) && !a.includes(`· ${title}`);   // '가. 제목'(펼침) vs '· 제목'(접힘)
  };
  ok('무선설비 질의 — 무선설비 항목이 펼쳐진다',
    relev('무선설비 없는 배로 어디까지 나갈 수 있나요?' + JOINER + '근해구역 이상' + JOINER + '근해구역',
      '무선설비를 비치해야 하고, 연해구역 이상이면 한 종류를 더 갖춰야 한다'));
  ok('구명조끼 질의 — 구명조끼 항목이 펼쳐진다',
    relev('우리 배에 구명조끼 싣고 어디까지 나갈 수 있나요?' + JOINER + '평수구역',
      '공기부양정(여객선 제외)은 구명부환 2개와 최대승선인원 수의 구명조끼만 비치하면 된다'));

  // ⑤ 점수가 전원 0인 정상 경로(트리 되묻기의 기본 경로)에서 **순서 회귀 0**(설계 §13.5-T5).
  //    정렬이 안정정렬이라 동점이면 자산 순서가 그대로 유지된다. 단 접힌 항목은 유형 블록 끝에
  //    모이므로, 검사 대상은 **펼친 것끼리 / 접힌 것끼리의 상대 순서**다(접기 자체가 이번 변경의
  //    목적이라 "펼침 다음 접힘"은 회귀가 아니다 — 관련도 때문에 항목이 뒤섞이는 것만 회귀다).
  {
    const bad = [];
    let checked = 0;
    for (const [id, x] of leaves) {
      if (R.rankZoneRules(x.rules, x.q).some(e => e.score > 0)) continue;   // 질문어가 걸린 리프는 정렬이 목적
      checked++;
      const byKind = new Map();
      for (const e of x.rules) byKind.set(e.rule.유형, (byKind.get(e.rule.유형) || []).concat(e.rule.제목));
      for (const [kind, titles] of byKind) {
        for (const at of [openAt, foldAt]) {
          const pos = titles.map(t => at(x.answer, t)).filter(i => i >= 0);
          for (let i = 1; i < pos.length; i++) if (pos[i] < pos[i - 1]) bad.push(`${id}/${kind}: ${titles[i]}`);
        }
      }
    }
    ok(`score 전원 0인 리프 ${checked}개 — 유형 안 항목 순서가 자산 순서 그대로`, bad.length === 0 && checked > 0, bad.slice(0, 5));
  }

  // ⑥ 면책 문구가 **자산에서 조립**된다 — 하드코딩 잔존 0 + 자산을 바꾸면 문구가 따라 바뀐다.
  {
    const a = leaves.get('smooth_water_area').answer;
    ok('거짓이 된 하드코딩 문구가 사라졌다',
      !a.includes('고시(행정규칙)의 구역별 설비·수량 기준, 지자체 자치법규, 별표의 수치 기준은 여기 들어 있지 않아요'));
    ok('불변 문장은 남아 있다', a.includes('목록에 없다고 해서 그런 규정이 없다는 뜻은 아닙니다'));
    const labels = (J.unmapped.유형_단위 || []).map(u => u.표시).filter(Boolean);
    ok(`unmapped 표시 라벨 ${labels.length}개가 문구에 그대로`, labels.every(l => a.includes(l)),
      labels.filter(l => !a.includes(l)));
    ok('스캔 밖 라벨이 문구에 그대로', (J.unmapped.스캔밖_표시.값 || []).every(l => a.includes(l)));
    ok('이 리프에 실린 계층이 문구에 숫자와 함께', a.includes('고시(행정규칙)') && /고시\(행정규칙\) \d+건/.test(a));
    // 자산을 **바꿔서** 문구가 따라 바뀌는지 별도 프로세스로 확인한다(저장소 파일은 안 건드린다).
    const stubbed = (() => {
      const j = JSON.parse(JSON.stringify(J));
      j.unmapped.유형_단위 = [{ 유형: 'x', 표시: '테스트용_빠진항목' }];
      j.unmapped.스캔밖_표시 = { 값: ['테스트용_스캔밖'] };
      j.summary.laws_in_scope = 999;
      // 자산 본문은 커서 명령줄로 못 넘긴다(E2BIG) — 임시 파일에 써서 자식이 읽게 한다.
      const tmp = path.join(os.tmpdir(), 'zone_tree_stub_' + process.pid + '.json');
      fs.writeFileSync(tmp, JSON.stringify(j));
      const code = `const fs=require('fs');const r=fs.readFileSync;const J=r(${JSON.stringify(tmp)},'utf8');` +
        `fs.readFileSync=(p,...a)=>String(p).endsWith('zone_tree.json')?J:r(p,...a);` +
        `const R=require(${JSON.stringify(RET)});` +
        `process.stdout.write('\\nZONE_RESULT:'+JSON.stringify((R.zoneTreeStep('우리 배 어디까지 나갈 수 있나요?${JOINER}평수구역')||{}).answer||''));`;
      const out = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      fs.unlinkSync(tmp);
      return JSON.parse((out.match(/ZONE_RESULT:(.*)$/m) || [])[1]);
    })();
    ok('자산을 바꾸면 면책 문구가 따라 바뀐다(하드코딩 0)',
      stubbed.includes('테스트용_빠진항목') && stubbed.includes('테스트용_스캔밖') && stubbed.includes('999개 해양수산 법령') &&
      !stubbed.includes('선체 구조기준(치수·강도)'));
  }
}

// ── T9. 질문 유형 구분 — 경계형엔 경계만, 요건은 확인 뒤에 (L-84) ────────────
// "우리 배 어디까지 갈 수 있나요?"(경계형)에 서류·장비 규정 57건을 통째로 얹던 것을 고쳤다.
// 여기서 고정하는 계약은 여섯이다 — ①경계형 답변엔 규정 항목이 **한 건도** 없다 ②그 대신
// 경로·정의·건수와 확인 선택지 2개가 있다 ③"네"면 §13 확장 답변이 그대로 나온다(확인 조각이
// 답변을 바꾸지 않는다) ④"아니요"면 같은 짧은 답변에 확인이 안 붙는다(같은 질문 반복 0)
// ⑤요건형은 확인 없이 바로 확장된다 ⑥새 라벨이 트리 22개 노드의 라벨과 충돌하지 않는다(L-77).
console.log('\n[T9] 질문 유형 — 경계형(짧게) vs 요건형(바로 확장) · 확인 단계');
{
  const BOUNDARY = [
    ['우리 배 어디까지 나갈 수 있나요?', ['평수구역']],
    ['우리 배 어디까지 갈 수 있나요?', ['근해구역 이상', '근해구역']],
    ['배로 영해까지 나가도 되나요?', []],
    ['어선으로 어디서 조업할 수 있나요?', ['특정해역']],
  ];
  for (const [seed, segs] of BOUNDARY) {
    const q = [seed].concat(segs).join(JOINER);
    const tree = R.matchZoneTreeTopic(q);
    const { node, path: p } = R.resolveZoneTreePath(q, tree);
    const rules = R.collectZoneRules(tree, p);
    const step = R.zoneTreeStep(q) || {};
    const a = step.answer || '';

    // ① 규정 내용이 한 건도 실리지 않는다(펼침 '가. 제목'도, 접힘 '· 제목 — 「법령」'도 없다).
    const leaked = rules.filter(e => a.includes(e.rule.제목));
    ok(`경계형 — ${node.라벨}: 규정 제목 0건`, leaked.length === 0, leaked.slice(0, 3).map(e => e.rule.제목));
    ok(`경계형 — ${node.라벨}: 인용문("원문:") 0건`, !a.includes('2) 원문:'));
    // ② 물어본 것(경로·정의·건수)은 있다.
    ok(`경계형 — ${node.라벨}: 확인한 구역 경로`, a.includes('**확인한 구역**: ' + p.map(n => n.라벨).join(' → ')));
    ok(`경계형 — ${node.라벨}: 그 구역의 정의(경계)`, !node.정의 || a.includes(node.정의));
    ok(`경계형 — ${node.라벨}: 규정 건수 ${rules.length}건`, a.includes(`**${rules.length}건**`));
    // ③ 확인 선택지 2개.
    const opts = ((step.clarify || {}).options || []).map(o => o.label);
    ok(`경계형 — ${node.라벨}: 확인 선택지 [네/아니요]`,
      (step.clarify || {}).question === '이 구역에서 필요한 서류·장비 기준도 알려드릴까요?' &&
      opts.length === 2 && opts[0] === MORE_YES && opts[1] === MORE_NO, opts);
    // ④ 분량 — 확장 답변보다 확실히 짧다(줄이는 게 목적이 아니라 결과다: 요건을 안 실었으니 짧다).
    const full = (R.zoneTreeStep(q + JOINER + MORE_YES) || {}).answer || '';
    ok(`경계형 — ${node.라벨}: ${a.length}자 (확장 ${full.length}자의 절반 이하)`, a.length * 2 <= full.length);
    // ⑤ "네" → §13 확장 답변. 확인 조각이 관련도 정렬에 섞이지 않는다(원 질문으로만 채점).
    ok(`"네" → 확장 — ${node.라벨}: 규정 전량이 화면에`,
      rules.every(e => full.includes(e.rule.제목)) && !((R.zoneTreeStep(q + JOINER + MORE_YES) || {}).clarify));
    // ⑥ "아니요" → 같은 경계 답변, 확인은 다시 안 낸다(무한 재질문 0).
    const no = R.zoneTreeStep(q + JOINER + MORE_NO) || {};
    ok(`"아니요" → 확인 반복 0 — ${node.라벨}`, !no.clarify && !!no.answer && no.answer.length < full.length);
    ok(`"아니요" 답변 = 경계 답변(안내 한 줄만 빠짐) — ${node.라벨}`,
      a.replace(' 여기서는 건수만 알려드렸어요 — 그 내용이 필요하시면 아래에서 골라 주세요.', '') === no.answer);
  }

  // ⑦ 확인 조각은 확장 답변을 바꾸지 않는다 — 요건형 질의에 붙여도 답변이 **바이트 동일**하다.
  //    (경계형에서 "네"로 온 확장 답변이 §13 답변 그대로임을 이 성질이 보증한다.)
  for (const q of [
    '우리 배에 구명조끼 싣고 어디까지 나갈 수 있나요?' + JOINER + '평수구역',
    '무선설비 없는 배로 어디까지 나갈 수 있나요?' + JOINER + '근해구역 이상' + JOINER + '근해구역',
  ]) {
    const bare = (R.zoneTreeStep(q) || {}).answer;
    const withYes = (R.zoneTreeStep(q + JOINER + MORE_YES) || {}).answer;
    ok('요건형 — 확인 없이 바로 확장', !!bare && !(R.zoneTreeStep(q) || {}).clarify && bare.includes('2) 원문:'));
    ok('요건형 — 확인 조각을 붙여도 답변 바이트 동일', bare === withYes);
  }

  // ⑧ 유형 판정 자체 — 축 어휘만 말한 질문은 경계형, 규정에 실재하는 낱말을 지목하면 요건형.
  {
    const tree = R.matchZoneTreeTopic('우리 배 어디까지 나갈 수 있나요?');
    const { path: p } = R.resolveZoneTreePath('우리 배 어디까지 나갈 수 있나요?' + JOINER + '평수구역', tree);
    const rules = R.collectZoneRules(tree, p);
    for (const [q, want] of [
      ['우리 배 어디까지 나갈 수 있나요?', false],
      ['낚싯배로 제주도까지 갈 수 있나요?', false],          // 지목한 말이 규정에 없다 → 경계형
      ['20톤 어선인데 어디까지 갈 수 있나요?', false],
      ['배로 영해까지 나가도 되나요?', false],               // 구역 이름은 축 어휘라 요건 지목이 아니다
      ['우리 배에 구명조끼 싣고 어디까지 나갈 수 있나요?', true],
      ['무선설비 없는 배로 어디까지 나갈 수 있나요?', true],
    ]) ok(`유형 판정 ${want ? '요건형' : '경계형'}: ${q}`, R.zoneAskedRequirement(rules, q) === want);
  }

  // ⑨ L-77 재발 방지 — 새 라벨이 트리 라벨과 충돌하지 않고, 질의에 붙어도 경로 판정을 안 바꾼다.
  {
    const treeLabels = [...new Set([].concat(...ALL.map(x => [x.node.라벨, x.optLabel].filter(Boolean))))];
    const clash = [];
    for (const L of [MORE_YES, MORE_NO]) for (const t of treeLabels) {
      if (L.includes(t) || t.includes(L)) clash.push(`${L} ↔ ${t}`);
    }
    ok(`새 라벨 2개 × 트리 라벨 ${treeLabels.length}개 — 부분문자열 충돌 0건`, clash.length === 0, clash);
    const moved = [];
    for (const { tree, node, optLabel } of ALL) {
      for (const label of [...new Set([node.라벨, optLabel].filter(Boolean))]) {
        const q = `배로 ${label}까지 나갈 수 있나요?`;
        const at = R.resolveZoneTreePath(q, tree).node.id;
        for (const L of [MORE_YES, MORE_NO]) {
          if (R.resolveZoneTreePath(q + JOINER + L, tree).node.id !== at) moved.push(`${label} + ${L}`);
        }
      }
    }
    ok('확인 라벨을 붙여도 트리 위치가 안 바뀐다', moved.length === 0, moved.slice(0, 5));
    // ⑩ 확인 단계가 되묻기 라운드 예산(CLARIFY_MAX_ROUNDS=4)을 넘기지 않는다.
    const deepest = Math.max(...[...leafAnswers().keys()].map(id => {
      const x = leafAnswers().get(id); return x.q.split(JOINER).length - 1;
    }));
    ok(`가장 깊은 경로 + 확인 = ${deepest}라운드 ≤ 4`, deepest <= 4, deepest);
  }
}

console.log('── 같은 상황질문을 두 번 묻지 않는다 (2026-08-20) ──');
{
  // 라이브 실측: 천연기념물 재반입 서식 질문에 "어떤 배에 관한 것인가요?"가 반복됐고,
  // "배가 아니라 …"라고 직접 입력해도 같은 질문이 다시 나와 빠져나올 길이 없었다.
  // 선택지 버튼을 누르면 트리가 내려가 질문이 달라지지만, 직접 입력은 트리를 못 내려간다.
  const RET_SRC = fs.readFileSync(RET, 'utf8');
  const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'routes', 'legal.js'), 'utf8');
  ok('상황질문이 직전 되묻기(prevCl)를 받는다',
    /function scopeNarrowStep\(query, scope, sources, enabled, prevCl\)/.test(RET_SRC));
  ok('직전에 같은 질문을 냈으면 다시 묻지 않는다',
    /prevCl && prevCl\.q && String\(prevCl\.q\)\.trim\(\) === String\(node\.질문\)\.trim\(\)/.test(RET_SRC));
  ok('routes 가 ctx.cl 을 넘긴다',
    /scopeNarrowStep\(q, ctx\.scope, sources, cfg\.scopeNarrow, ctx\.cl\)/.test(ROUTES));
  ok('routes 가 이번 상황질문을 ctx.cl 에 남긴다',
    /ctx\.cl = \{ q: scope\.clarify\.question/.test(ROUTES));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
