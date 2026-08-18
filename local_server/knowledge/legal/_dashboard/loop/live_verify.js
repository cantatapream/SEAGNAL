export const meta = {
  name: 'audit-live-verify',
  description: '감사관이 full로 채점한 논점을 실제 챗봇 API로 다시 물어 대조(법당 1문항) — _SCHEMA.md §6-E 자기판단 보정',
  phases: [{ title: '라이브검증', detail: '법마다 full 문항 1개를 골라 프로덕션 /api/legal/ask 로 재질의·근거 대조' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const API = 'https://seagnal-server.fly.dev/api/legal/ask'

const SCHEMA = {
  type: 'object', required: ['law', 'outcome'],
  properties: {
    law: { type: 'string' },
    question: { type: 'string' },            // 실제로 물어본 문장
    expected: { type: 'string' },            // 감사가 근거로 든 법령명+조문
    outcome: { type: 'string' },             // confirmed | missing_evidence | clarify | no_full | error
    chain: { type: 'array', items: { type: 'string' } },  // 챗봇이 실제로 내놓은 근거 줄(법령명 제N조)
    note: { type: 'string' },
  },
}

function prompt(l, round) {
  return `너는 SEAGNAL 위키 감사의 **라이브 검증관**이다. 감사관이 \`full\`로 채점한 논점이 **실제 챗봇에서도 정말 나오는지** 한 문항만 확인한다.

## 🚫 절대 금지
'.claude/' 폴더 아래 어떤 파일도 읽거나 쓰지 마라. **Agent/Task 도구로 재위임하지 마라(L-28)** — 혼자 Read/Bash만으로 이 턴 안에 끝내라.
**위키·raw 파일을 고치지 마라.** 이 작업은 **읽고 물어보고 보고**만 한다.

## 왜 하나 (\`_SCHEMA.md\` §6-E)
감사관은 위키 **아무 파일이나** 열어 답을 찾을 수 있지만, 챗봇은 **개념 페이지의 \`## 근거 조문\` 표**에서만 근거를 만든다. 이 차이 때문에 2026-08-17에 감사가 R14·R21에서 \`full\`로 통과시킨 논점이 사용자 앞에서는 "확인되지 않습니다"로 실패했다. 지금까지 이 차이를 **아무도 실제로 대조하지 않았다** — 네가 그 자리다.

## 절차
1. \`${LEGAL}/_dashboard/audit/${l.slug}.md\`를 Read해 **이번 라운드(R${round}) 구간**에서 판정이 \`full\`인 문항을 찾는다.
   - 그중 **가장 구체적인 수치·요건을 묻는 것 하나**를 고른다(풍속·파고·톤수·금액·기한처럼 사용자가 실제로 궁금해할 것). 추상적·정의형 질문은 피한다.
   - R${round} 구간에 full이 하나도 없으면 outcome=\`no_full\`로 끝낸다(억지로 다른 라운드에서 고르지 마라).
2. 그 문항의 **감사관이 든 근거**(법령명 + 조문번호)를 기록한다 → \`expected\`.
3. **실제 챗봇에 물어본다**(Bash):
   \`\`\`
   curl -s -X POST ${API} -H 'Content-Type: application/json' \\
     -d '{"query":"<질문 문장>"}' --max-time 120
   \`\`\`
   - 질문은 감사파일의 문장을 **그대로** 쓴다(고쳐 쓰면 무엇을 검증했는지 알 수 없다).
   - 응답은 NDJSON이고 마지막 \`{"type":"done",...}\` 줄이 결과다.
4. 판정:
   - 응답에 \`clarify\`가 있으면(되묻기) → outcome=\`clarify\`. **한 번만** 되묻기의 첫 선택지 라벨을 원 질문 뒤에 \` — <라벨>\`로 붙여 다시 물어보고, 그래도 되물으면 clarify로 끝낸다.
   - 답변이 나왔으면 \`citationChain\`의 각 줄(법령명·조문)을 모아 \`chain\`에 적고, **\`expected\`의 조문이 그 안에 있는지** 본다.
     - 있으면 outcome=\`confirmed\` (감사관 채점이 맞았다)
     - 없으면 outcome=\`missing_evidence\` — **감사관은 full이라 했는데 챗봇은 그 근거를 못 꺼냈다.** note에 챗봇이 대신 내놓은 근거와, 왜 안 나왔을지(개념 페이지에 없나·근거 조문 표에 행이 없나·법령 칸이 한 낱말인가)를 적는다.
   - 네트워크·파싱 실패는 outcome=\`error\`, note에 그대로.
5. \`${LEGAL}/_dashboard/audit/${l.slug}.md\`에 **append만**(L-93) — \`---\` + \`## R${round} 라이브 검증\` 절에 질문·expected·outcome·chain·note를 적는다.

## 대상: 「${l.name}」
비용을 아끼기 위해 **질문은 최대 2회**(원 질문 1회 + 되묻기 후속 1회)만 던진다. 더 던지지 마라.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON: {"0":[...],"1":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로, 필터·가공 금지)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '라이브검증', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
const round = cfg.round || 22
log(`라이브 검증 ${laws.length}개 법 (법당 1문항, R${round})`)
phase('라이브검증')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l, round), { label: `live:${l.name.slice(0, 12)}`, phase: '라이브검증', model: 'sonnet', effort: 'medium', schema: SCHEMA })
))).filter(Boolean)

const by = k => res.filter(r => r.outcome === k).length
return {
  checked: res.length,
  confirmed: by('confirmed'),
  missing_evidence: by('missing_evidence'),   // ★감사관 full ≠ 챗봇 실제 — 이 숫자가 §6-E가 놓친 양이다
  clarify: by('clarify'), no_full: by('no_full'), error: by('error'),
  mismatches: res.filter(r => r.outcome === 'missing_evidence')
    .map(r => `${r.law}: "${r.question}" 기대=${r.expected} / 실제=${(r.chain || []).join(', ') || '(근거 없음)'} — ${r.note || ''}`),
  per_law: res.map(r => ({ law: r.law, outcome: r.outcome })),
}
