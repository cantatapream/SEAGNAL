// xref_fix.js — `## 타법 연결` 표에만 있는 근거를 `## 근거 조문` 표로 옮긴다(결정 ①ⓐ, 2026-08-20).
// 역할(초보자용): 위키는 법과 법을 이어 놨는데, 챗봇은 그 연결표를 안 읽는다. 그래서 이어 놓은
//   3,391행이 사용자에게 안 닿는다. 법별 사서 한 명이 자기 법의 그 행들을 근거 표로 옮긴다.
// [연계] 입력 _dashboard/xref_todo/<slug>.md(이 파일을 고쳐서 체크) + wiki/concepts/<slug>__*.md + raw
//        규칙 _SCHEMA.md §6-E · _CHATBOT.md
// 안전: 자기 법 파일만 쓴다(xref_todo/<slug>.md · wiki/concepts|statutes|annexes 의 <slug>*). 공유허브는 읽기만.

export const meta = {
  name: 'maritime-xref-fix',
  description: '타법 연결 표의 근거를 근거 조문 표로 이관(결정 ①ⓐ). 자기 법 파일만 = 병렬안전.',
  phases: [{ title: '이관', detail: '법별 1에이전트: 타법연결 행 → 근거 조문 표 행으로 옮기고 승격 판단' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const MANIFEST = {
  type: 'object', required: ['law', 'status', 'moved'],
  properties: {
    law: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'nochange', 'failed'] },
    moved: { type: 'integer', description: '근거 조문 표에 실제로 추가한 행 수' },
    already: { type: 'integer', description: '확인해 보니 이미 표에 있던 행 수' },
    skipped: { type: 'integer', description: '조문·법령명이 확정되지 않아 넘긴 행 수' },
    promoted: { type: 'integer', description: 'REVIEW 없고 원문 대조가 끝나 canonical 로 승격한 페이지 수' },
    files_edited: { type: 'integer' }, remaining: { type: 'integer', description: '★손 못 댄 행 수(정직하게)' },
    remaining_reason: { type: 'string' },
    important: { type: 'array', items: { type: 'string' }, description: '★사용자 결정이 필요한 것만(엄격)' },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 **근거 이관 사서**다. 담당 법: 「${l.name}」 (slug: \`${l.slug}\`)

## 0) 먼저 읽을 것
1. \`${LEGAL}/_SCHEMA.md\` **§6-E** — 챗봇은 개념 페이지의 \`## 근거 조문\` 표에서만 근거를 만든다.
2. **네 작업목록**: \`${LEGAL}/_dashboard/xref_todo/${l.slug}.md\`

## 1) 왜 하나
위키는 \`## 타법 연결\` 표로 법과 법을 이어 놨다. 그런데 **챗봇은 그 표를 읽지 않는다** — 관계 칸이
\`수집곤란\`인 행만 따로 읽을 뿐이다(\`services/legal_retriever.js\`). 그래서 **이어 놓은 3,391행이
사용자에게 닿지 않는다.** 이걸 \`## 근거 조문\` 표로 옮기는 것이 이번 일이다.

**답변이 지저분해질 걱정은 안 해도 된다**: 근거 조문 표의 행은 답변이 그 법을 실제로 언급했을 때만
근거로 뜬다. 관련 없는 답변에는 안 나온다.

## 2) 하는 법 — 목록의 각 행마다
1. 그 개념 페이지의 \`## 근거 조문\` 표를 연다. **정말 없는지 먼저 확인한다**(기계가 놓쳤을 수 있다).
   이미 있으면 고치지 말고 \`- [x] (이미 있음: <표의 그 행>)\` 로 적는다.
2. 없으면 표에 행을 추가한다. 칸은 넷이다: **법령명 · 조문 · 시행일 · 요지**.
   - **법령명**: 반드시 **정식 명칭 전체**. 🚫\`[[슬러그]]\`·\`동법\`·\`시행령\`만 쓰기·한 칸에 두 법 넣기·화살표(\`→\`)로 잇기 금지.
     하위 법령이면 계층까지 붙인다(\`「수산업법 시행령」\`).
   - **조문**: 실제 조문 번호. 한 행에 여러 조문이면 \`제10조·제13조\` 처럼 가운뎃점으로 잇되,
     **범위(\`제1~5조\`)·묶음은 원본에 그렇게 적혀 있을 때만** 쓴다. 🚫\`전체\`·\`전문\`·설명 문장 금지.
   - **시행일**: 타법 연결 행이나 raw 에서 확인되면 적고, **확인 안 되면 \`-\`** 로 둔다(지어내지 마라).
   - **요지**: 타법 연결 행의 설명을 한 줄로 줄인다.
3. 옮긴 뒤 \`- [x] (이관: <페이지>)\` 로 적는다. 조문번호나 법령명이 원본에서 확정되지 않으면
   **추가하지 말고** \`- [ ] (건너뜀: 이유)\` 로 남긴다 — 지어내는 것이 안 하는 것보다 나쁘다.
4. **타법 연결 표의 그 행은 지우지 않는다.** 두 표는 쓰임이 다르다(연결표는 사람이 관계를 보는 자리).

## 3) 겸사겸사 — 승격 판단(결정 ③-2)
이 법의 개념 페이지 중 \`status\` 가 \`canonical\` 이 아니면서 **⚠REVIEW 가 하나도 없는** 페이지가 있으면,
\`_SCHEMA.md\` §5 "이원화 재정제" 기준으로 승격을 판단한다:
- 처벌·수치가 있어도 **raw 원문과 글자 그대로 일치하는 인용**이면 승격 가능(변경이력에 대조 근거를 남긴다).
- **별표 스캔 이미지에서 읽은 수치**나 **원문에 없는 것을 추론한 매핑**이 있으면 승격하지 말 것.
- 애매하면 그대로 둔다(과대 승격 금지). 승격한 페이지 수를 \`promoted\` 에 반환.

## 4) 절대 규칙
- 🚫 **자기 법 파일만 쓴다**: \`_dashboard/xref_todo/${l.slug}.md\` · \`wiki/concepts/${l.slug}__*.md\` ·
  \`wiki/statutes/${l.slug}.md\` · \`wiki/annexes/${l.slug}__*.md\`. 그 외(다른 법 파일·\`graph.json\`·
  \`_glossary\`·\`comparisons/\`·\`review_queue.md\`)는 **읽기만**.
- **환각 0**. 확인 안 되면 건너뛰고 기록한다.
- **외과수술식**: 목록이 짚은 행만 손댄다. 멀쩡한 서술을 다시 쓰지 않는다.
- 고친 페이지의 frontmatter \`updated\` 를 오늘 날짜로.

## 5) 반환(JSON)
law, status, moved, already, skipped, promoted, files_edited, **remaining**, remaining_reason, important[], note.
- \`remaining\` 을 0 으로 적지 마라 — 못 한 것은 못 했다고 적는다.
- \`important[]\` 는 ①시스템·데이터구조 문제 ②사용자 결정이 반드시 필요 ③수정 범위를 넘어선 큰 문제, 이 셋만.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON: {"0":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로, 필터·가공 금지)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '이관', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`근거 이관 대상 ${laws.length}법`)
phase('이관')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `xref:${l.name.slice(0, 12)}`, phase: '이관', model: 'sonnet', effort: 'high', schema: MANIFEST })
))).filter(Boolean)
const sum = k => res.reduce((s, r) => s + (r[k] || 0), 0)
return {
  laws: laws.length, done: res.filter(r => r.status === 'done' || r.status === 'partial').length,
  moved: sum('moved'), already: sum('already'), skipped: sum('skipped'), promoted: sum('promoted'),
  files_edited: sum('files_edited'), remaining: sum('remaining'),
  important: res.flatMap(r => (r.important || []).map(i => `${r.law}: ${i}`)),
  per_law: res.map(r => ({ law: r.law, st: r.status, moved: r.moved, already: r.already, left: r.remaining })),
}
