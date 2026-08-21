// golden_verify.js — 골든 문항의 **라벨을 사서가 확인**한다(H-47 ①). 라벨이 틀리면 채점판이 틀린다.
// 역할(초보자용): 기계가 감사 파일에서 뽑은 문항 초안은 "이 질문의 정답 근거는 이 조문"이라고
//   적어 놨지만 확인된 게 아니다. 사서가 원문·위키를 열어 맞는지 보고 고친다.
// [왜 중요한가 — L-125] 예전에 라벨을 대충 붙였다가 채점판이 틀렸고, **멀쩡한 것을 병목이라고
//   보고해** 엉뚱한 개선에 착수할 뻔했다. 틀린 이유 셋: ①정답을 하나만 인정 ②법 단위로 붙임
//   ③되묻기가 정답인 문항까지 실패로 셈. 이 셋을 이번에 막는다.
// 안전: 각 사서는 **자기 법 결과 파일만** 쓴다(pinned/golden_verify/<slug>.json). 공유 JSON 은 읽기만.

export const meta = {
  name: 'maritime-golden-verify',
  description: '골든 문항 라벨을 사서가 원문·위키로 확인(H-47 ①). 자기 결과 파일만 = 병렬안전.',
  phases: [{ title: '라벨확인', detail: '법별 1에이전트: 문항·기대근거를 원문/위키로 대조해 확정·정정·제외' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const QFILE = `${LEGAL}/_dashboard/loop/pinned/golden_questions.json`
const ODIR = `${LEGAL}/_dashboard/loop/pinned/golden_verify`

const MANIFEST = {
  type: 'object', required: ['law', 'checked', 'ok', 'fixed', 'skipped', 'dropped'],
  properties: {
    law: { type: 'string' },
    checked: { type: 'integer', description: '확인한 문항 수' },
    ok: { type: 'integer', description: '초안 그대로 맞았던 수' },
    fixed: { type: 'integer', description: '기대 근거를 고친 수(추가 포함)' },
    skipped: { type: 'integer', description: '되묻기가 정답이라 채점에서 뺀 수' },
    dropped: { type: 'integer', description: '문항 자체가 못 쓸 것이라 버린 수' },
    notes: { type: 'array', items: { type: 'string' }, description: '판단이 갈린 문항과 사유' },
    important: { type: 'array', items: { type: 'string' } },
  },
}

function prompt(l) {
  return `너는 **골든 문항 라벨 확인자**다. 담당 법: 「${l.name}」 (slug: \`${l.slug}\`)

## 0) 무엇을 하는 일인가
챗봇이 얼마나 잘 답하는지 재려면 **"이 질문의 정답 근거는 이 조문"** 이라는 문제집이 있어야 한다.
기계가 감사 파일에서 초안을 뽑아 놨는데 **확인된 게 아니다.** 네가 원문과 위키를 열어 확인한다.

**이 일이 왜 중요한가**: 예전에 라벨을 대충 붙였다가 채점판이 틀렸고, **멀쩡한 것을 병목이라고
보고해** 엉뚱한 개선에 착수할 뻔했다(L-125). 그때 틀린 이유가 셋인데 **이번에 그 셋을 막는 것이 네 임무다.**

## 1) 대상
\`${QFILE}\` 를 Read 해서 \`questions\` 중 **\`law\` 가 정확히 \`${l.slug}\` 인 것만** 골라라(보통 3개).
각 항목은 \`{law, question, expect_law, expect_article, evidence_cell, verified:false}\` 꼴이다.

## 2) 문항마다 확인할 것
### ⓐ 이게 진짜 사용자 질문인가
감사 표에서 기계로 뽑은 것이라 **질문이 아닌 것**(감사 메모·집계행 조각)이 섞일 수 있다.
사람이 물을 만한 질문이 아니면 \`drop: true\` 로 버린다.

### ⓑ 기대 근거가 맞나 — **원문으로 확인한다**
\`${l.raw}\` 원문(법률·시행령·시행규칙·별표·행정규칙)에서 \`expect_article\` 을 실제로 찾아
**그 조문이 이 질문의 답을 담고 있는지** 읽어라. 아니면 **맞는 조문으로 고친다.**
- **조문의 주인을 확인하라.** 조문 번호는 맞는데 **다른 법 것**인 경우가 이 저장소에서 반복해 났다.
  \`expect_law\` 가 틀렸으면 고친다(계층까지: \`「○○법 시행령」\`).
- 원문에 그 답이 아예 없으면(진짜 공백) → \`drop: true\`. 골든 문항으로 못 쓴다.

### ⓒ ★정답을 하나만 인정하지 마라 (L-125 ①)
질문이 두 조문에 걸쳐 있으면 **둘 다 적는다** — \`expect_article\` 에 가운뎃점으로 잇는다
(예: \`제7조·제4조\`). 하나만 적으면, 챗봇이 다른 쪽을 근거로 잘 답해도 **틀렸다고 세게 된다.**

### ⓓ ★되묻기가 정답인 문항은 빼라 (L-125 ③)
질문에 **법·주제를 특정할 단서가 없으면**(예: "조사 나온 공무원이 증표를 안 보여주면 거부해도 되나요?"
— 어느 법이든 증표 제시 의무가 있다) 한 법을 골라 답하는 것은 맞히는 게 아니라 **찍는 것**이다.
이런 문항은 \`skip: true\` 로 채점에서 뺀다.

### ⓔ 위키에 그 근거 행이 있는지도 본다(참고)
\`${LEGAL}/wiki/concepts/${l.slug}__*.md\` 의 \`## 근거 조문\` 표에 그 (법령, 조문) 행이 있나 확인해
\`in_wiki: true/false\` 로 적어라. **없다고 문항을 버리지 마라** — 그게 바로 채점판이 잡아야 할 결함이다.

## 3) 결과 쓰기
\`${ODIR}/${l.slug}.json\` 에 아래 꼴로 **네 법 것만** 쓴다(다른 파일은 절대 건드리지 마라):
\`\`\`json
{ "law": "${l.slug}",
  "questions": [
    { "law":"${l.slug}", "question":"…", "expect_law":"…", "expect_article":"제7조·제4조",
      "in_wiki": true, "verified": true, "note":"원문 제7조① 확인" },
    { "law":"${l.slug}", "question":"…", "skip": true, "note":"법 특정 단서 없음 — 되묻기가 정답" },
    { "law":"${l.slug}", "question":"…", "drop": true, "note":"질문이 아니라 감사 메모 조각" }
  ] }
\`\`\`

## 4) 절대 규칙
- **원문을 실제로 열어 확인한다.** \`grep\` 결과가 근거지 기억이 근거가 아니다. 짐작으로 \`verified:true\` 를 달지 마라.
- **확인이 안 되면 \`verified:false\` 로 남기고 사유를 \`note\` 에 적는다.** 억지로 확정하지 마라.
- 자기 결과 파일만 쓴다. \`golden_questions.json\` 은 **읽기만**.

## 5) 반환(JSON)
law, checked, ok, fixed, skipped, dropped, notes[], important[].`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const laws = cfg.laws || []
log(`라벨 확인 대상 ${laws.length}법`)
phase('라벨확인')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `gv:${l.name.slice(0, 10)}`, phase: '라벨확인', model: 'sonnet', effort: 'high', schema: MANIFEST })
))).filter(Boolean)
const sum = k => res.reduce((s, r) => s + (r[k] || 0), 0)
return {
  laws: laws.length, checked: sum('checked'), ok: sum('ok'), fixed: sum('fixed'),
  skipped: sum('skipped'), dropped: sum('dropped'),
  notes: res.flatMap(r => (r.notes || []).map(n => `${r.law}: ${n}`)).slice(0, 40),
  important: res.flatMap(r => (r.important || []).map(i => `${r.law}: ${i}`)),
}
