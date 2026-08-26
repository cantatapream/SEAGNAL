// e6_fix.js — §6-E 빈틈 메우기. 본문은 인용하는데 `## 근거 조문` 표에 행이 없는 조문을 채운다.
// 역할(초보자용): 챗봇은 개념 페이지의 "근거 조문" 표에서만 근거를 만든다. 표에 행이 없으면
//   본문에 아무리 잘 적혀 있어도 못 꺼낸다. 그 빠진 행을 법별 사서가 하나씩 확인해 넣는다.
//
// [왜 있나 — 2026-08-24]
//   어선안전조업법 페이지가 2026-08-15 에 제5조·제6조를 본문에 옮겨 놓고도 표에 행이 없어
//   여덟 달 가까이 챗봇이 그 조문을 인용하지 못했다. 그 법 백로그 8건이 전부 이 하나가 원인이었다.
//   있던 검사 둘은 이 빈틈을 구조상 못 본다 — reach_eval.js 는 "표에 있는 행이 뜨는가",
//   citation_table_scan.js 는 "표 칸이 규칙에 맞나"를 볼 뿐이다. body_cite_gap.py 로 새로 셌다.
//
// ★목록은 **확인 목록이지 판정이 아니다.** 기계는 "본문에 제N조가 적혀 있다"만 봤다.
//   반대해석·타법 언급·예시로 든 조문이 섞여 있으므로 전부 넣으면 근거표를 오염시킨다.
//
// [연계] 입력 _dashboard/body_cite_gap.json(by_law) · 묶음 _dashboard/loop/e6_groups.json
//        지침 _dashboard/E6_ROUND_NOTE.md · 도구 _dashboard/loop/cite_row.js
// 안전: 각 사서는 **자기 법 파일만** 쓴다. comparisons/ 는 다른 사서가 동시에 작업 중이라 금지.

export const meta = {
  name: 'maritime-e6-fix',
  description: '§6-E 빈틈(본문엔 있고 근거표엔 없는 조문)을 법별로 확인해 채운다. 자기 법 파일만 = 병렬안전.',
  phases: [{ title: 'E6채움', detail: '법당 사서 1명: 목록 확인 → 오탐 거르고 cite_row.js 로 표 행 추가' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const MANIFEST = {
  type: 'object', required: ['law', 'status', 'checked', 'added', 'rejected'],
  properties: {
    law: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'nochange', 'failed'] },
    checked: { type: 'integer', description: '목록에서 실제로 확인을 끝낸 항목 수' },
    added: { type: 'integer', description: '근거 조문 표에 행을 실제로 추가한 수' },
    rejected: { type: 'integer', description: '★오탐이라 안 넣은 수(반대해석·타법·예시·이미 있음 등)' },
    reject_reasons: { type: 'array', items: { type: 'string' }, description: '오탐 사유를 유형별로. 이게 다음 검사를 다듬는 재료다.' },
    tool_failed: { type: 'integer', description: 'cite_row.js 가 실패해 못 넣은 수' },
    tool_fail_detail: { type: 'string', description: '실패했으면 어떤 명령이 어떻게 실패했나(손으로 쓰지 말고 여기 적을 것)' },
    files_edited: { type: 'integer' },
    remaining: { type: 'integer', description: '★손대지 못하고 남긴 수(정직하게 — 0으로 적지 말 것)' },
    important: { type: 'array', items: { type: 'string' }, description: '사용자 결정이 필요한 것만(엄격)' },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 **§6-E 사서**다. 담당: 「${l.name}」 (slug: \`${l.slug}\`)

## 0) 반드시 먼저 읽을 것
1. \`${LEGAL}/_dashboard/E6_ROUND_NOTE.md\` — **이번 회차 지침. 전문을 읽어라.**
2. \`${LEGAL}/_SCHEMA.md\` §6-E(챗봇이 근거를 만드는 방식) · §8-A ⓪(근거 조문 행은 도구로 만든다)
3. **네 목록**: \`${LEGAL}/_dashboard/body_cite_gap.json\` 의 \`by_law["${l.name}"]\`
   (약 ${l.n}건 · 페이지 ${l.pages || '?'}개)${l.note ? '\n   ※' + l.note : ''}

## 1) 무엇을 하는 일인가
위키 본문은 「제○조」를 인용하는데 그 페이지의 \`## 근거 조문\` 표에 **그 조문 행이 없는** 곳을 채운다.
챗봇은 표에서만 근거를 만든다 — 표에 없으면 본문에 있어도 **사용자에게 "확인되지 않는다"고 답한다.**

## 2) ★목록을 그대로 믿지 마라 — 전부 넣으면 안 된다
기계는 "본문에 제N조가 적혀 있다"만 봤지 **그게 이 페이지의 근거인지**는 못 본다.
**항목마다 본문에서 그 조문이 어떤 맥락으로 쓰였는지 직접 읽고** 아래를 걸러라:
- **반대해석·배제** — "이 경우엔 제3조가 적용되지 **않는다**" 처럼 아니라고 말하려고 든 것.
- **다른 법 조문을 지나가며 언급** — 그 법 담당이 따로 있다. 여기 표에 넣으면 남의 근거를 훔치는 셈.
- **예시·비교로 든 것** — "참고로 ○○법 제5조는…".
- **이미 표에 있는 것** — 표기만 다른 경우가 있다(\`제10조의2\` ↔ \`제10조 의2\`). 표를 먼저 훑어라.
넣을 것: 그 페이지가 설명하는 내용의 **실제 근거**인 조문.

## 3) ★표는 손으로 쓰지 말고 도구로 만든다 (§8-A ⓪)
\`node ${LEGAL}/_dashboard/loop/cite_row.js --page <파일> --law "정식 법령명" --arts "제10조,제11조"\`
확인했으면 \`--apply\`. 이 도구가 ①정식 명칭 채우기 ②**원문에 그 조가 실제로 있는지 확인**
③**챗봇이 그 행을 꺼낼 수 있는지 넣기 전에 증명**까지 해 준다. 손으로 쓰면 이 셋이 전부 빠진다.
- 2026-08-24 에 이 도구의 버그를 고쳤다(같은 폴더에 이름이 접두어 관계인 원문이 둘이면 막히던 것).
  **그래도 막히면 손으로 쓰지 말고** \`tool_failed\` 에 세고 \`tool_fail_detail\` 에 명령과 오류를 적어라.
- 법령 칸엔 **정식 법령명 전체**, **한 칸에 법 하나만**. 부칙은 행을 따로.
- 조문 표기 형식이 계열마다 다르다(L-54): 법률 \`[제10조]\` · 고시 \`제10조(제목)\`. 둘 다 찾아봐라.

## 4) 절대 규칙
- 🚫 **git 명령 금지**(\`git status\` 포함).
- 🚫 **자기 법 파일 밖 쓰기 금지.** 읽기는 자유.
  허용: \`wiki/concepts/${l.slug}__*.md\` · \`wiki/statutes/${l.slug}.md\` · \`wiki/annexes/${l.slug}__*.md\`
  금지: \`comparisons/\`(**지금 다른 사서가 작업 중이다**) · \`graph.json\` · \`_glossary.md\` ·
  \`review_queue.md\` · \`_dashboard/\` · 다른 법의 모든 파일
- **원문에 없는 조문을 지어내지 마라.** 도구가 "원문에 없다"고 하면 넣지 마라.
- **한 것보다 많이 했다고 적지 마라.**
- 고친 페이지 frontmatter \`updated\` 를 오늘 날짜로.

## 5) 반환(JSON)
law, status, checked, **added**, **rejected**, reject_reasons[], tool_failed, tool_fail_detail,
files_edited, **remaining**, important[], note.
★**오탐 비율이 높게 나오는 것은 좋은 결과다.** 숨기지 말고 그대로 보고해라 —
그래야 다음에 이 검사를 더 좁게 다듬을 수 있다. \`reject_reasons\` 를 유형별로 적어라.`
}

// ---- 실행 ----
let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON: {"0":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로, 필터·가공 금지)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: 'E6채움', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`§6-E 채움 대상 ${laws.length}법`)
phase('E6채움')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `e6:${l.name.slice(0, 12)}`, phase: 'E6채움', model: 'sonnet', effort: 'high', schema: MANIFEST })
))).filter(Boolean)

const sum = k => res.reduce((s, r) => s + (r[k] || 0), 0)
return {
  laws: laws.length,
  done: res.filter(r => r.status === 'done' || r.status === 'partial').length,
  checked: sum('checked'), added: sum('added'), rejected: sum('rejected'),
  tool_failed: sum('tool_failed'), files_edited: sum('files_edited'), remaining: sum('remaining'),
  reject_reasons: res.flatMap(r => (r.reject_reasons || []).map(x => `${r.law}: ${x}`)),
  tool_fails: res.filter(r => r.tool_failed).map(r => `${r.law}: ${r.tool_fail_detail || '(사유 없음)'}`),
  important: res.flatMap(r => (r.important || []).map(i => `${r.law}: ${i}`)),
  per_law: res.map(r => ({ law: r.law, st: r.status, ck: r.checked, add: r.added, rej: r.rejected, left: r.remaining })),
}
