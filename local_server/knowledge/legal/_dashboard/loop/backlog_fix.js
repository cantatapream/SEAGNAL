// backlog_fix.js — 법별 **미해소 백로그**(_dashboard/backlog/<법>.md)를 사서가 확인·처리한다(H-43).
// 역할(초보자용): 감사 파일은 한 법에 6,000줄이 넘어 사서가 옛 항목까지 되짚지 못한다.
//   그래서 "아직 안 고쳐진 것만" 뽑아 짧은 목록으로 만들어 뒀다. 이 스크립트는 그 목록을
//   법마다 한 명씩 맡겨, **① 지금 위키를 먼저 확인하고 ② 이미 됐으면 체크만, 안 됐으면 고치게** 한다.
//
// [왜 확인이 먼저인가 — L-142]
//   "이미 고쳐졌는지"를 기계로 가르려다 실패했다(조문 번호·낱말 겹침 둘 다 못 가름).
//   감사 항목은 "무엇이 없는지"를 위키의 말로 적기 때문에 글자 겹침이 근거가 되지 못한다.
//   그래서 이 판단은 사람(사서)이 위키를 읽고 한다 — 그게 이 단계의 절반이다.
//
// [연계] 입력 _dashboard/backlog/<slug>*.md(이 파일을 고쳐서 체크) + wiki/ + raw/
//        규칙 _SCHEMA.md(§6-B-1·§6-E)·_CHATBOT.md
// 안전: 각 에이전트는 **자기 법 파일만** 쓴다(backlog/<slug>*.md · wiki/concepts|statutes|annexes 의 <slug>*).
//   🚫 graph.json·_glossary·comparisons/·review_queue.md·다른 법 파일 = 읽기만(공유·경합위험).

export const meta = {
  name: 'maritime-backlog-fix',
  description: '법별 미해소 백로그를 확인·처리(H-43). 자기 법 파일만 = 병렬안전.',
  phases: [{ title: '백로그처리', detail: '법별 1에이전트: 위키 현재상태 확인 → 해소면 체크, 미해소면 수정·재분류' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const MANIFEST = {
  type: 'object', required: ['law', 'status', 'checked'],
  properties: {
    law: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'nochange', 'failed'] },
    checked: { type: 'integer', description: '위키와 대조해 판정을 끝낸 항목 수(체크박스를 [x]로 바꾼 수)' },
    already_resolved: { type: 'integer', description: '그중 **이미 고쳐져 있어** 손댈 게 없던 수' },
    fixed_now: { type: 'integer', description: '그중 이번에 실제로 위키를 고쳐 해소한 수' },
    reclassified: { type: 'integer', description: '미분류 → 유형(원문공백·스코프경계·collection_hole 등)으로 갈라 적은 수' },
    files_edited: { type: 'integer' },
    remaining: { type: 'integer', description: '★손대지 못하고 남긴 항목 수(정직하게 — 0으로 적지 말 것)' },
    remaining_reason: { type: 'string', description: '왜 남겼나(분량·판단불가 등). remaining>0이면 필수.' },
    collectable_holes: { type: 'array', items: { type: 'string' }, description: '재수집 가능한데 못 받은 것 — 시도한 방법과 결과를 함께' },
    important: { type: 'array', items: { type: 'string' }, description: '★사용자 결정이 필요한 것만(엄격). 일상 gap은 넣지 말 것.' },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 **백로그 처리 사서**다. 담당 법: 「${l.name}」 (slug: \`${l.slug}\`)

## 0) 반드시 먼저 읽을 것
1. \`${LEGAL}/_SCHEMA.md\` — 특히 **§6-B-1**(규정없음 판정에 조회 기록 필수·스코프 안내는 개념 페이지에)과 **§6-E**(챗봇은 개념 페이지의 \`## 근거 조문\` 표에서만 근거를 만든다)
2. \`${LEGAL}/_CHATBOT.md\` 5절(답변경계·소관부서·정직한 공백 안내 형식)
3. **네 백로그 파일**: \`${LEGAL}/_dashboard/backlog/${l.slug}.md\` — 같은 slug로 시작하는 파일이 더 있으면(\`${l.slug}_*.md\`) 그것도 전부.

## 1) 이 단계가 무엇인가
백로그는 **아직 안 고쳐진 thin·missing 만** 기계로 뽑은 목록이다. 그런데 기계는 "이미 고쳐졌는지"를
가르지 못한다(시도했다 실패 — 조문 번호도 낱말 겹침도 근거가 안 됐다). **그래서 그 판단이 네 일이다.**

각 항목마다 **반드시 이 순서로** 한다:
1. **지금 위키를 먼저 확인한다.** 그 항목이 지적한 내용이 \`wiki/concepts/${l.slug}__*.md\`·\`wiki/statutes/${l.slug}.md\`·\`wiki/annexes/${l.slug}__*.md\` 에 **이미 서술돼 있는지** Grep/Read 로 실제로 본다. 추측 금지.
2. **이미 있으면** — 고치지 말고 백로그 파일의 그 줄을 \`- [ ]\` → \`- [x]\` 로 바꾸고, 줄 끝에 \`(확인: <파일이름>:<줄번호>)\` 를 덧붙인다. **근거 없이 [x] 로 바꾸지 마라.**
   ⚠단, **§6-E**를 잊지 마라: 본문에 서술돼 있어도 그 개념 페이지의 \`## 근거 조문\` 표에 해당 행이 없으면 **챗봇은 그 근거를 못 꺼낸다.** 본문만 있고 표에 행이 없으면 "이미 있음"이 아니다 — 표에 행을 추가한 뒤 \`[x] (표 행 추가로 해소)\` 로 적는다.
3. **없으면** 아래 유형으로 갈라 처리한다:
   - **wiki_lag**(raw 원문엔 있는데 위키가 안 옮김) → \`${l.raw}\` 원문에서 그 수치·조문·별표를 찾아 해당 개념 페이지 본문에 정확히 옮기고 \`## 근거 조문\` 표에도 행을 추가한다. \`- [x] (반영: <파일>)\` 로 적는다.
   - **원문 자체에 없음** → §6-B-1 ⓑ 대로 **law.go.kr 에서 실제로 찾아본 기록**(무엇을 어떤 말로 찾았는지·몇 건 나왔는지·언제)을 남기고, 개념 페이지에 정직한 공백 안내를 넣은 뒤 \`- [x] (원문공백, 조회기록 첨부)\` 로 적는다. **"없다"를 확인 없이 쓰지 마라.**
     · 조회는 프록시 플래그가 필요하다(L-141): \`curl --proxy "$HTTPS_PROXY" --cacert /root/.ccr/ca-bundle.crt "..."\`. \`HTTP 000\` 은 차단이 아니라 플래그 누락이다.
   - **이 법 소관이 아님(스코프경계)** → §6-B-1 ⓐ 대로 **개념 페이지에** "이 부분은 「○○법」 소관입니다 / ○○부서에 문의" 안내가 있는지 보고, 없으면 넣는다. statutes 페이지에만 있으면 챗봇이 못 꺼낸다. \`- [x] (스코프 안내 추가)\`.
   - **자치법규(조례·규칙)** → §6-B-1 ⓒ: 국가법령정보센터 등재 여부가 기준이다. 미등재면 "수집 불가, 해당 지자체에 문의" 안내가 정답이다 — 결함이 아니다.
   - **사람 판단이 필요(REVIEW)** → 고치지 말고 그대로 둔다(\`- [ ]\` 유지). 줄 끝에 왜 사람 판단이 필요한지 한 줄.

## 2) 처리 순서 (분량이 많다 — 이 순서를 지켜라)
1. **\`⟨짚은 조문이 위키에 없음 — 확실히 미해소⟩\` 표시가 붙은 항목 전부** — 확인 없이도 미해소가 확실하다.
2. **\`## wiki_lag\` 절 전부** — 원문에 있으니 고칠 수 있다. 이 단계의 본체다.
3. **\`## 미분류\` 절** — 위에서부터 최소 40건은 유형을 갈라 위 규칙대로 처리한다.
4. 시간이 남으면 \`## 원문공백\`·\`## 스코프경계\` 절.

**전부 못 해도 된다. 다만 정직해라** — 손 못 댄 수를 \`remaining\` 에 정확히 적고 이유를 \`remaining_reason\` 에 쓴다. 한 것보다 많이 했다고 적는 것이 이 단계에서 가장 나쁜 일이다.

## 3) 절대 규칙
- 🚫 **자기 법 파일만 쓴다**: \`_dashboard/backlog/${l.slug}*.md\` · \`wiki/concepts/${l.slug}__*.md\` · \`wiki/statutes/${l.slug}.md\` · \`wiki/annexes/${l.slug}__*.md\`. 그 외(다른 법 파일·\`graph.json\`·\`_glossary\`·\`comparisons/\`·\`review_queue.md\`·\`_dashboard/audit/\`)는 **읽기만, 쓰기 금지**.
- **환각 0**: raw 원문에 없는 수치·조문을 지어내지 않는다. 확인 안 되면 남긴다.
- **외과수술식**: 백로그가 짚은 것만 고친다. 멀쩡한 서술을 이유 없이 다시 쓰지 않는다.
- **근거 조문 표를 손볼 때**: 법령 칸에 계층 낱말(\`시행령\`)이나 가리키는 말(\`동법\`)만 적지 마라 — 정식 명칭으로. 한 칸에 두 법을 넣지 마라(행을 나눈다). 화살표(\`→\`)로 잇지 마라.
- 고친 페이지의 frontmatter \`updated\` 를 오늘 날짜로.

## 4) 반환(JSON)
law, status, checked, already_resolved, fixed_now, reclassified, files_edited, **remaining**, remaining_reason, collectable_holes[], important[], note.
- \`already_resolved\` 가 크게 나오는 것은 좋은 결과다(목록이 낡았다는 뜻). 숨기지 말고 그대로 보고해라.
- \`important[]\` 는 ①시스템·데이터구조 문제 ②사용자 결정이 반드시 필요 ③수정 범위를 넘어선 큰 문제 — 이 셋만. 일상 gap은 절대 넣지 마라.`
}

// ---- 실행 ----
let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON: {"0":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로, 필터·가공 금지)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '백로그처리', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`백로그 처리 대상 ${laws.length}법`)
phase('백로그처리')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `bl:${l.name.slice(0, 12)}`, phase: '백로그처리', model: 'sonnet', effort: 'high', schema: MANIFEST })
))).filter(Boolean)

const sum = k => res.reduce((s, r) => s + (r[k] || 0), 0)
return {
  laws: laws.length,
  done: res.filter(r => r.status === 'done' || r.status === 'partial').length,
  checked: sum('checked'),
  already_resolved: sum('already_resolved'),
  fixed_now: sum('fixed_now'),
  reclassified: sum('reclassified'),
  files_edited: sum('files_edited'),
  remaining: sum('remaining'),
  collectable_holes: res.flatMap(r => (r.collectable_holes || []).map(h => `${r.law}: ${h}`)),
  important: res.flatMap(r => (r.important || []).map(i => `${r.law}: ${i}`)),
  per_law: res.map(r => ({ law: r.law, st: r.status, ck: r.checked, already: r.already_resolved, fixed: r.fixed_now, left: r.remaining })),
}
