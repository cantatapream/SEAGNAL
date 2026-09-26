// 표준 절 이름의 세 갈래 — 「없다」 / 「꼬리표」 / ★「이름다름(뜻은 같다)」
//
// [왜 이 스위트가 있나] 2026-09-26, 3-6 을 하다 겪었다. 세는 자(`section_ready.js`)는
//   `startsWith` 로만 봐서 `## ★ 적용범위 (내 배에 적용되나) — 가장 중요` 를 **「없다」로 셌다.**
//   51자리 중 **17자리가 그것**이었다 — 내용은 이미 있었다. 그것을 「없다」로 믿고 원문을 새로
//   넣으면 **같은 뜻의 절이 두 개**가 되고, 사람이 정리한 표 옆에 PDF 원문이 붙는다.
//   그래서 제3의 갈래를 만들었는데, ★**0만 찍는 게이트는 죽은 게이트**다. 이 자가 진짜
//   잡는지·엉뚱한 것을 안 잡는지를 여기서 고정 문장으로 못박는다.
//
// [무엇을 재나] 뜻 사전은 `_dashboard/section_rules.json` 의 `이름_다르지만_같은_뜻` 이다
//   (코드에 박지 않는다 — L-386). 이 스위트는 **그 파일을 읽어서** 판정한다.
//   ⚠낱말 하나로 맞히면 `## 청문 대상 (제51조)`·`## 위반 시 (처벌 연결)` 같은 **벌칙 절**까지
//     걸린다(2026-09-26 실측 — 처음에 그렇게 틀렸다). 그래서 **구(句)** 로 맞힌다.
const fs = require('fs');
const path = require('path');

const RULES = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'section_rules.json'), 'utf8'));
const 뜻사전 = RULES['이름_다르지만_같은_뜻'] || {};

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
};

console.log('── 뜻 사전이 규약 파일에 있다 ──');
ok('`이름_다르지만_같은_뜻` 이 section_rules.json 에 있다', Object.keys(뜻사전).length > 0);
for (const want of ['## 적용범위·제외', '## 타법 연결']) {
  ok(`${want} 의 구(句) 목록이 있다`, Array.isArray(뜻사전[want]) && 뜻사전[want].length >= 3,
    JSON.stringify(뜻사전[want]));
}
ok('세는 자가 그 파일을 읽는다(코드에 박지 않았다)',
  fs.readFileSync(path.join(__dirname, '..', 'knowledge', 'legal', '_dashboard', 'loop', 'section_ready.js'), 'utf8')
    .includes("RULES['이름_다르지만_같은_뜻']"));

const 맞히나 = (want, head) => new RegExp((뜻사전[want] || ['$^']).join('|')).test(head);

console.log('── 이름이 달라도 뜻이 같은 절은 잡는다 (실물에서 온 문장) ──');
[
  ['## 적용범위·제외', '## ★ 적용범위 (내 배에 적용되나) — 가장 중요'],   // 고시 12쪽
  ['## 적용범위·제외', '## 적용범위 — 이 법이 적용되는 6종 수면 (법 제3조)'],  // 낚시관리법
  ['## 적용범위·제외', '## 이 법의 적용범위 — 제3조 (통법 단위)'],          // 수산업법 어업정의허브
  ['## 타법 연결', '## 일반법 교차 연결 (걸리는 조문만)'],                  // 선원법 벌칙총람
  ['## 타법 연결', '## 12. 타법 연결(일반법 — 최소안내)'],                  // 수산업법 벌칙총괄
].forEach(([w, h]) => ok(`잡는다 — ${h.slice(0, 40)}`, 맞히나(w, h)));

console.log('── 뜻이 다른 절은 잡지 않는다 (처음에 여기서 틀렸다) ──');
[
  ['## 적용범위·제외', '## 청문 대상 (제51조)'],                            // 「대상」만 겹친다
  ['## 적용범위·제외', '## 2. 벌칙(형벌) — 법 제84조제1항 (대상: 선박소유자·선장)'],
  ['## 적용범위·제외', '## 5-F. 즉결심판 대상 여부 — 스코프 밖'],
  ['## 타법 연결', '## 위반 시 (처벌 연결)'],                               // 「연결」만 겹친다
  ['## 타법 연결', '## 관련 개념'],
  ['## 타법 연결', '## 근거 조문'],
].forEach(([w, h]) => ok(`안 잡는다 — ${h.slice(0, 40)}`, !맞히나(w, h)));

console.log('── 표준 이름 자체는 이 갈래가 아니다(앞가지로 이미 걸린다) ──');
ok('`## 적용범위·제외` 는 startsWith 로 걸리므로 이 갈래에 오지 않는다',
  '## 적용범위·제외'.startsWith('## 적용범위·제외'));

console.log('');
console.log(`${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
