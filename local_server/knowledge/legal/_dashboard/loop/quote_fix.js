// quote_fix.js — "원문 발췌"라고 인용부호를 달아 놓고 다듬어 쓴 문장을 **원문 복붙으로 되돌린다**(L-148).
// 역할(초보자용): 큰따옴표는 "원문이 이렇다"는 약속이다. 그 안이 다듬은 문장이면 거짓말이 된다.
//   제3자 검증이 찾아낸 불일치를 원문 그대로 고치고, 조항·항수 오기도 함께 바로잡는다.
// [연계] 입력 wiki/concepts/<대상> + raw · 규칙 _SCHEMA.md §5 · L-148
// 안전: 자기 법 파일만 쓴다.

export const meta = {
  name: 'maritime-quote-fix',
  description: '인용부호 안을 원문 복붙으로 되돌리고 조항 오기를 고친다(L-148). 자기 법 파일만.',
  phases: [{ title: '인용정정', detail: '법별 1에이전트: 인용문 전수 grep 대조 → 원문 복붙 · 오기 정정' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const MANIFEST = {
  type: 'object', required: ['law', 'fixed', 'left'],
  properties: {
    law: { type: 'string' },
    quotes_checked: { type: 'integer', description: '인용부호 안 문장을 grep 으로 대조한 개수' },
    fixed: { type: 'integer', description: '원문 복붙으로 되돌린 인용문 수' },
    unquoted: { type: 'integer', description: '원문 복붙이 어려워 인용부호를 떼고 "요지:"로 바꾼 수' },
    numbering_fixed: { type: 'integer', description: '조·항·호 번호 오기를 고친 수' },
    left: { type: 'integer', description: '★못 고친 수(정직하게)' },
    left_reason: { type: 'string' },
    still_uncheckable: { type: 'array', items: { type: 'string' }, description: 'raw 에 그 조문이 없어 대조 자체가 불가능한 것' },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 **인용 정정 사서**다. 제3자 검증이 찾아낸 인용 불일치를 **원문 그대로** 고친다.

## 0) 무슨 일이 있었나 (L-148)
다른 에이전트가 개념 페이지를 만들면서 \`## 의무 내용 (원문 발췌)\` 절에 **큰따옴표로 조문을 인용**해
놓고, 실제로는 원문을 **요약·재구성**했다. \`grep\` 하면 0건이다. 뜻은 크게 안 틀려서 더 위험하다 —
읽는 사람은 큰따옴표를 보고 "원문이 이렇구나" 하고 믿는데 그 문장은 원문에 없다.

## 1) 담당: 「${l.name}」 · 원문: \`${l.raw}\`
### 제3자 검증이 지목한 것
${l.findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}

## 2) 하는 법
1. 대상 페이지들의 **큰따옴표(" ")·인용부호 안 문장을 전부** 뽑는다.
2. 각각을 \`${l.raw}\` 원문에서 **grep 으로 실제로 찾는다.** 눈으로 훑지 마라.
3. 판정:
   - **원문에 그대로 있다** → 그대로 둔다.
   - **원문과 다르다** → **원문을 복붙해 교체한다.** 어순·조사·낱말을 매끄럽게 고치지 마라.
     원문이 \`시ㆍ도지사\` 면 \`시·도지사\` 로 바꾸지도 마라(가운뎃점 종류까지 원문 그대로).
   - **너무 길어 다 붙이기 어렵다** → **인용부호를 떼고** \`요지: …\` 로 바꾼다.
     **요약을 인용부호 안에 넣는 것이 이 사고의 원인이다.**
   - **raw 에 그 조문이 아예 없다** → 고치지 말고 \`still_uncheckable\` 에 적는다.
     **대조 불가는 "맞다"가 아니다.**
4. **조·항·호 번호 오기도 함께 고친다.** 위 지목 목록에 있는 것 + 네가 대조하다 발견한 것.
   번호를 고칠 때는 그 번호의 원문을 실제로 열어 내용이 맞는지 확인한다.
5. \`## 근거 조문\` 표의 조문 칸도 같은 기준으로 본다.
6. 고친 페이지의 \`## 변경 이력\` 에 **무엇을 무엇으로 고쳤는지** 한 줄씩 남긴다.

## 3) 절대 규칙
- **원문 복붙이 원칙이다.** 다듬으면 그 순간 발췌가 아니다.
- **없는 것을 지어내지 마라.** raw 에 없으면 없다고 적는다.
- 자기 법 파일만 쓴다(\`wiki/concepts/${l.slug}__*.md\` 등). 그 외는 읽기만.
- \`status\` 는 그대로 둔다 — 승격은 다음 검증자의 일이다.

## 4) 반환(JSON)
law, quotes_checked, fixed, unquoted, numbering_fixed, **left**, left_reason, still_uncheckable[], note.
- \`left\` 를 0 으로 적지 마라. 못 고친 건 못 고쳤다고.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const laws = cfg.laws || []
log(`인용 정정 대상 ${laws.length}법`)
phase('인용정정')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `quote:${l.name.slice(0, 10)}`, phase: '인용정정', model: 'sonnet', effort: 'high', schema: MANIFEST })
))).filter(Boolean)
const sum = k => res.reduce((s, r) => s + (r[k] || 0), 0)
return {
  quotes_checked: sum('quotes_checked'), fixed: sum('fixed'), unquoted: sum('unquoted'),
  numbering_fixed: sum('numbering_fixed'), left: sum('left'),
  still_uncheckable: res.flatMap(r => (r.still_uncheckable || []).map(x => `${r.law}: ${x}`)),
  per_law: res.map(r => ({ law: r.law, fixed: r.fixed, unquoted: r.unquoted, num: r.numbering_fixed, left: r.left })),
}
