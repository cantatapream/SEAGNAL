export const meta = {
  name: 'audit-live-verify',
  description: '감사관이 full로 채점한 논점을 실제 챗봇 API로 다시 물어 대조(법당 1문항) — _SCHEMA.md §6-E 자기판단 보정',
  phases: [{ title: '라이브검증', detail: '법마다 full 문항 1개를 골라 프로덕션 /api/legal/ask 로 재질의·근거 대조' }],
}
// ★재검증(전후 대조) 쓰는 법: laws 각 항목에 `question`(지난번에 실제로 물은 문장)·`expected`·`prev`
//   를 넣어 넘기면, 검증관은 **문항을 고르지 않고 그 질문을 글자 그대로 다시 묻는다**. 결과에
//   transitions/recovered/regressed 가 함께 나와 "같은 질문이 고쳐졌나"를 바로 볼 수 있다.
//   ⚠질문을 매번 새로 고르면 고치기 전후를 비교할 수 없다 — 돈만 쓰고 답을 못 얻는다(2026-08-18).
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const API = 'https://seagnal-server.fly.dev/api/legal/ask'

const SCHEMA = {
  type: 'object', required: ['law', 'outcome'],
  properties: {
    law: { type: 'string' },
    question: { type: 'string' },            // 실제로 물어본 문장
    expected: { type: 'string' },            // 감사가 근거로 든 법령명+조문
    outcome: { type: 'string' },             // confirmed | missing_evidence | clarify | no_full | error
    prev: { type: 'string' },                // 지난 라운드 결과(질문이 고정된 재검증일 때만) — 전후 대조용
    chain: { type: 'array', items: { type: 'string' } },  // 챗봇이 실제로 내놓은 근거 줄(법령명 제N조)
    note: { type: 'string' },
  },
}

function prompt(l, round, pass) {
  return `너는 SEAGNAL 위키 감사의 **라이브 검증관**이다. 감사관이 \`full\`로 채점한 논점이 **실제 챗봇에서도 정말 나오는지** 한 문항만 확인한다.

## 🚫 절대 금지
'.claude/' 폴더 아래 어떤 파일도 읽거나 쓰지 마라. **Agent/Task 도구로 재위임하지 마라(L-28)** — 혼자 Read/Bash만으로 이 턴 안에 끝내라.
**위키·raw 파일을 고치지 마라.** 이 작업은 **읽고 물어보고 보고**만 한다.

## 왜 하나 (\`_SCHEMA.md\` §6-E)
감사관은 위키 **아무 파일이나** 열어 답을 찾을 수 있지만, 챗봇은 **개념 페이지의 \`## 근거 조문\` 표**에서만 근거를 만든다. 이 차이 때문에 2026-08-17에 감사가 R14·R21에서 \`full\`로 통과시킨 논점이 사용자 앞에서는 "확인되지 않습니다"로 실패했다. 지금까지 이 차이를 **아무도 실제로 대조하지 않았다** — 네가 그 자리다.

## 절차
${l.question ? `1. ★**질문이 이미 정해져 있다. 고르지 마라.** 아래 문장을 **글자 하나 바꾸지 말고** 그대로 쓴다.
   - 물어볼 질문: \`${l.question}\`
   - 감사관이 든 근거(expected): \`${l.expected || '(기록 없음 — 감사파일에서 이 질문의 근거를 찾아 채운다)'}\`
   - 지난 라운드 결과: \`${l.prev || '?'}\`
2. 이 질문·근거를 그대로 \`question\`·\`expected\` 에 담는다. **다른 문항으로 바꾸면 이번 검증은 무의미해진다** — 고치기 전후를 같은 자로 재는 것이 이 실행의 목적이다.
   ⚠\`no_full\` 로 끝내지 마라(질문이 이미 주어졌다).` : `1. \`${LEGAL}/_dashboard/audit/${l.slug}.md\`를 Read해 **이번 라운드(R${round}) 구간**에서 판정이 \`full\`인 문항을 찾는다.
   - 그중 **가장 구체적인 수치·요건을 묻는 것 하나**를 고른다(풍속·파고·톤수·금액·기한처럼 사용자가 실제로 궁금해할 것). 추상적·정의형 질문은 피한다.
   - R${round} 구간에 full이 하나도 없으면 outcome=\`no_full\`로 끝낸다(억지로 다른 라운드에서 고르지 마라).
2. 그 문항의 **감사관이 든 근거**(법령명 + 조문번호)를 기록한다 → \`expected\`.`}
3. **실제 챗봇에 물어본다** — 반드시 아래 도구를 쓴다(직접 curl 금지).
   \`\`\`bash
   S=/tmp/lv_${round}_${l.slug}.json
   node ${LEGAL}/_dashboard/loop/ask_live.js --state $S start "<질문 문장>"
   node ${LEGAL}/_dashboard/loop/ask_live.js --state $S pick <선택지번호>
   \`\`\`
   - 질문은 감사파일의 문장을 **그대로** 쓴다(고쳐 쓰면 무엇을 검증했는지 알 수 없다).
   - 출력에 \`되묻기\`와 \`선택지\`가 있으면 **끝난 게 아니다.** 감사 문항의 상황에 맞는 선택지 번호를 골라 \`pick\` 을 이어서 부른다.
     - "네, 맞아요"처럼 이해를 확인하는 되묻기는 그냥 그 번호를 고른다.
     - 상황을 묻는 되묻기는 **감사 문항이 전제한 상황**에 맞는 것을 고른다(문항이 "60톤 미만 근해안강망"이면 그 어업 종류를 고른다). 맞는 게 없으면 \`etc "<한 줄>"\` 로 적어 보낸다.
     - \`act=ask\`("다시 설명할게요")는 고르지 마라.
   - 되묻기가 사라지고 \`citationChain\` 이 채워지면 그게 최종 답변이다.
   - ⚠**이 도구가 실제 앱과 같은 규약**(ctx 얹기 / 질의 누적)을 쓴다. 2026-08-18 1차 검증에서 라벨을 텍스트로만 이어붙였다가 74법 중 47법이 답변에 못 닿고 끝난 사고가 있었다 — 그래서 도구로 고정했다.
4. 판정:
   - 답변에 도달했으면 \`citationChain\` 의 각 줄을 \`chain\` 에 적고, **\`expected\` 의 조문이 그 안에 있는지** 본다.
     - 있으면 outcome=\`confirmed\` (감사관 채점이 맞았다)
     - 없으면 outcome=\`missing_evidence\` — **감사관은 full이라 했는데 챗봇은 그 근거를 못 꺼냈다.** note에 챗봇이 대신 내놓은 근거와, 왜 안 나왔을지(개념 페이지에 없나·근거 조문 표에 행이 없나·법령 칸이 한 낱말인가·검색이 엉뚱한 법으로 갔나)를 적는다.
     - ★**답변 본문에는 맞는 내용이 있는데 \`citationChain\` 에만 없으면 그것도 \`missing_evidence\`** 다 — note에 "본문 O / 체인 X"라고 분명히 적어라. 1차 검증에서 이 패턴이 여러 법에서 나왔다.
   - 예산(요청 4회)을 다 쓰고도 되묻기만 계속되면 outcome=\`clarify\`, note에 마지막 되묻기 질문과 몇 번째였는지를 적는다.
   - 네트워크·파싱 실패는 outcome=\`error\`, note에 그대로.
${l.prev ? `5-0. \`prev\` 필드에 \`${l.prev}\` 를 그대로 담아 돌려준다(전후 대조표를 만드는 데 쓴다).
` : ''}5. \`${LEGAL}/_dashboard/audit/${l.slug}.md\`에 **append만**(L-93) — \`---\` + \`## R${round} 라이브 검증${pass ? ' — ' + pass + '차' : ''}\` 절에 질문·expected·outcome·chain·note를 적는다.

## 대상: 「${l.name}」
비용을 아끼기 위해 **요청은 최대 4회**(\`start\` 1회 + \`pick\`/\`etc\` 3회)만 던진다. 더 던지지 마라.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
// 재검증처럼 "법 목록을 통째로" 넘길 때는 파일로 준다(도구 인자에 큰 JSON 을 싣지 않기 위해).
if (!laws.length && cfg.lawsPath) {
  const boot = await agent(
    `\`${cfg.lawsPath}\`(JSON: {laws:[...]})를 Read로 읽어 그대로 반환: {laws: 그 배열 전체(객체 그대로, 필터·가공 금지)}.`,
    { label: 'boot-laws', phase: '라이브검증', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
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
  agent(prompt(l, round, cfg.pass), { label: `live:${l.name.slice(0, 12)}`, phase: '라이브검증', model: 'sonnet', effort: 'medium', schema: SCHEMA })
))).filter(Boolean)

const by = k => res.filter(r => r.outcome === k).length
return {
  checked: res.length,
  confirmed: by('confirmed'),
  missing_evidence: by('missing_evidence'),   // ★감사관 full ≠ 챗봇 실제 — 이 숫자가 §6-E가 놓친 양이다
  clarify: by('clarify'), no_full: by('no_full'), error: by('error'),
  mismatches: res.filter(r => r.outcome === 'missing_evidence')
    .map(r => `${r.law}: "${r.question}" 기대=${r.expected} / 실제=${(r.chain || []).join(', ') || '(근거 없음)'} — ${r.note || ''}`),
  per_law: res.map(r => ({ law: r.law, outcome: r.outcome, prev: r.prev || '' })),
  // 질문을 고정해 다시 물은 재검증일 때만 뜻이 있다 — 같은 질문의 전후 변화.
  transitions: res.filter(r => r.prev).reduce((m, r) => {
    const k = `${r.prev} → ${r.outcome}`; m[k] = (m[k] || 0) + 1; return m
  }, {}),
  recovered: res.filter(r => r.prev === 'missing_evidence' && r.outcome === 'confirmed').map(r => r.law),
  regressed: res.filter(r => r.prev === 'confirmed' && r.outcome !== 'confirmed')
    .map(r => `${r.law}: confirmed → ${r.outcome}`),
}
