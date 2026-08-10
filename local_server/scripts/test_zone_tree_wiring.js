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
const { execFileSync } = require('child_process');

const RET = path.join(__dirname, '..', 'services', 'legal_retriever.js');
const LEGAL = path.join(__dirname, '..', 'knowledge', 'legal');
const TREE_JSON = path.join(LEGAL, '_dashboard', 'zone_tree.json');
const R = require(RET);
const J = JSON.parse(fs.readFileSync(TREE_JSON, 'utf8'));
const JOINER = ' — ';                       // = CLARIFY_JOINER = ai_chat.js pickClarifyOption 이 붙이는 구분자

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

// ── T1. 리프 도달성 전수 BFS ────────────────────────────────────────────────
// 클라이언트 버튼 클릭을 그대로 재현한다(질의 + ' — ' + 서버가 내려준 option.label).
// L-77 결함①(근해구역 이상 오하강)·결함②(그 밖의 먼바다 도달 불가)가 이 성질로 표현된다.
console.log('\n[T1] 리프 도달성 — 버튼 클릭 BFS 전수 전개');
{
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
  const ans = segs => (R.zoneTreeStep([base].concat(segs).join(JOINER)) || {}).answer || '';
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
  for (const r of cites) {
    const art = (r.근거조문 || r.조문).match(/제\d+조(?:의\d+)?/)[0];
    const txt = fs.readFileSync(path.join(LEGAL, r.파일), 'utf8');
    const s = txt.search(new RegExp('^\\[' + art + '\\]', 'm'));
    if (s < 0) { cut.push(`조문없음 ${r.파일} ${art}`); continue; }
    const after = txt.slice(s + art.length);
    const e = after.search(/^\[제\d+조/m);
    const flat = (txt.slice(s, s + art.length + (e < 0 ? after.length : e)))
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
  const territorial = R.zoneTreeStep('배로 영해까지 나가도 되나요?');
  ok('영해 리프가 답변을 낸다', !!(territorial && territorial.answer && !territorial.clarify));
  const a = (territorial || {}).answer || '';
  ok('처벌은 "처벌(법정형)"으로 표기', a.includes('처벌(법정형)'));
  ok('선고형이 아님을 명시', a.includes('실제 선고형은 사안에 따라 달라져요'));
  ok('신뢰등급 — 본문 서두', a.includes('사람이 검증한 위키 카드가 아니라'));
  ok('신뢰등급 — 본문 말미(목록의 한계)', a.includes('목록에 없다고 해서 그런 규정이 없다는 뜻은 아닙니다'));
  ok('신뢰등급 — note', ((territorial || {}).note || '').includes('사람 검증 위키 카드가 아니며'));
  ok('영해및접속수역법 제5조② 단서(허가받은 경우)가 화면에 보인다', a.includes('관계 당국의 허가ㆍ승인 또는 동의를 받은 경우에는 그러하지 아니하다'));
  // `주의`·`적용제외`는 조건 없이 언제나 함께 나와야 한다(규약 2).
  const withNote = [];
  for (const { node } of ALL) for (const r of (node.적용 || [])) if (r.주의 || r.적용제외) withNote.push(r);
  ok('주의·적용제외를 가진 항목이 자산에 존재(빈 검사 방지)', withNote.length > 0, withNote.length);
  const smooth = (R.zoneTreeStep('우리 배 어디까지 나갈 수 있나요?' + JOINER + '평수구역') || {}).answer || '';
  ok('평수구역 답변에 적용제외가 실제로 출력된다', smooth.includes('적용제외:'));
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
