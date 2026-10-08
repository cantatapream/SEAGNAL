const path = require('path');
// promote_verify.js — 새로 만든 개념 페이지의 수치를 **raw 원문과 대조해** 승격 여부를 정한다(_SCHEMA §5).
// 역할(초보자용): 페이지를 만든 사람이 자기 페이지를 검증하면, 만들 때의 가정을 그대로 갖고 보게 된다.
//   그래서 **만들지 않은 다른 에이전트**가 원문과 한 줄씩 대조해 승격 여부를 정한다.
// [연계] 입력 wiki/concepts/<대상 파일> + raw · 규칙 _SCHEMA.md §5(이원화·재정제)
// 안전: status 줄과 변경이력만 고친다. 본문 내용은 안 바꾼다(틀린 게 있으면 보고만).

export const meta = {
  name: 'maritime-promote-verify',
  description: '새 개념 페이지 수치를 raw 와 대조해 canonical 승격 판정(_SCHEMA §5). 만든 에이전트가 아닌 제3자.',
  phases: [{ title: '승격검증', detail: '법별 1에이전트: 페이지의 수치·조문을 raw 로 전수 대조 후 승격/보류' }],
}

// ★2026-10-08 폐기(1단계 1-6 · 사장님 결정 D2·D3) — **이 워크플로우로 승격하지 않는다.**
//   한 번의 읽기로 status 를 canonical 로 바꾸고 끝나서, 「고친 이가 아닌 에이전트가 바로 그 본문을 읽고 PASS」
//   기록(`_dashboard/reread/verdicts.jsonl`)도 · 읽기 상한(4번)도 · 지적의 원문 확인도 남지 않는다.
//   승격 경로는 이제 `draft_verify1.py`(1차) → 다른 에이전트 읽기 + `reread_ledger.js add`(2차) →
//   `promote_page.py`(PASS 와 본문해시가 맞을 때만 올림) 하나다(_SCHEMA.md §5-D ⓔ ⓖ ⓗ).
//   실수로 돌려도 아무것도 바꾸지 못하게 맨 앞에서 멈춘다.
throw new Error('promote_verify.js 는 폐기됐다(2026-10-08) — §5-D ⓔ 의 승격 경로(draft_verify1 → 다른 눈 읽기 + reread_ledger → promote_page)를 쓴다');
const LEGAL = path.resolve(__dirname, '../..')

const MANIFEST = {
  type: 'object', required: ['law', 'checked', 'promoted', 'held'],
  properties: {
    law: { type: 'string' },
    checked: { type: 'integer', description: '대조한 페이지 수' },
    promoted: { type: 'integer', description: 'canonical 로 승격한 페이지 수' },
    held: { type: 'integer', description: 'draft 로 남긴 페이지 수' },
    values_checked: { type: 'integer', description: 'raw 와 대조한 수치·조문 개수' },
    mismatches: { type: 'array', items: { type: 'string' }, description: '★원문과 안 맞은 것 — 페이지·무엇이·원문은 무엇인지' },
    hold_reasons: { type: 'array', items: { type: 'string' }, description: '보류한 페이지와 사유' },
    important: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 **승격 검증자**다. 다른 에이전트가 방금 만든 개념 페이지를 **네가 원문과 대조해** canonical 승격 여부를 정한다.

## 0) 왜 네가 하나
페이지를 만든 에이전트가 자기 페이지를 검증하면 **만들 때의 가정을 그대로 갖고 본다.** 그래서 만들지 않은
네가 본다. 이 저장소는 이 방식으로 실제 결함을 여러 번 잡았다(CLAUDE.md 결정로그).

## 1) 먼저 읽을 것
1. \`${LEGAL}/_SCHEMA.md\` **§5**("이원화 재정제" 포함) — 무엇이 AI 승격 가능이고 무엇이 사람 승인 필수인지
2. 대상 페이지들: ${l.pages.map(p => '`' + p + '`').join(' · ')}
3. 원문: \`${l.raw}\` (법률·시행령·시행규칙·별표·행정규칙 txt 전부)

## 2) 하는 법 — 페이지마다
1. 페이지 본문의 **모든 수치·조문번호**를 뽑는다 — 징역 연수, 벌금·과태료 금액, 조·항·호 번호,
   기간(일·개월·년), 규모·수량 기준, 별표 번호.
2. 각각을 \`${l.raw}\` 원문에서 **grep 으로 실제로 찾아** 대조한다. **눈으로 훑지 말고 명령으로 확인하라.**
3. 판정:
   - **전부 원문과 글자 그대로 일치** → \`status: canonical\` 로 바꾸고, 변경 이력에
     "제3자 원문 대조로 승격(대조한 값 N개)"를 근거와 함께 적는다.
   - **하나라도 원문에 없거나 다르다** → \`draft\` 유지. \`mismatches\` 에 **페이지·무엇이·원문은 무엇인지**를
     적는다. **본문을 네가 고치지 마라** — 보고만 한다(고치는 것은 다음 단계 일이다).
   - **별표 스캔 이미지에서 읽은 수치**나 **원문에 없는 것을 추론한 매핑·법리 판단**이 있으면 → \`draft\` 유지.
   - \`REVIEW\` 글자가 하나라도 있으면 → \`draft\` 유지(⚠ 없는 \`(REVIEW)\` 형태도 포함. 2026-08-20 §5 보강).
4. \`## 근거 조문\` 표도 함께 본다 — 법령 칸이 정식 명칭인지, 조문 칸이 실제 번호인지,
   **부칙이 일반 조문과 같은 칸에 섞이지 않았는지**(§8-A ③-3).

## 3) 절대 규칙
- **본문 내용을 바꾸지 마라.** 네가 고칠 수 있는 것은 frontmatter 의 \`status\` 줄과 \`## 변경 이력\` 뿐이다.
- **애매하면 draft 로 남긴다.** 과대 승격이 과소 승격보다 훨씬 나쁘다 — 승격은 "사람이 확인했다"는 뜻이다.
- **추측 금지.** "맞을 것 같다"로 승격하지 마라. grep 결과가 근거다.
- 자기 법 파일만 쓴다.

## 4) 반환(JSON)
law, checked, promoted, held, values_checked, mismatches[], hold_reasons[], important[], note.
- \`mismatches\` 가 비어 있으면 "안 맞은 게 없다"는 뜻이다. **못 찾았으면 못 찾았다고 정직하게.**`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const laws = cfg.laws || []
log(`승격 검증 대상 ${laws.length}법`)
phase('승격검증')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `verify:${l.name.slice(0, 10)}`, phase: '승격검증', model: 'sonnet', effort: 'high', schema: MANIFEST })
))).filter(Boolean)
const sum = k => res.reduce((s, r) => s + (r[k] || 0), 0)
return {
  checked: sum('checked'), promoted: sum('promoted'), held: sum('held'), values_checked: sum('values_checked'),
  mismatches: res.flatMap(r => (r.mismatches || []).map(m => `${r.law}: ${m}`)),
  hold_reasons: res.flatMap(r => (r.hold_reasons || []).map(m => `${r.law}: ${m}`)),
  important: res.flatMap(r => (r.important || []).map(i => `${r.law}: ${i}`)),
  per_law: res.map(r => ({ law: r.law, promoted: r.promoted, held: r.held, values: r.values_checked })),
}
