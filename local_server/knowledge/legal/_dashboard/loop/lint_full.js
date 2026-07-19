// lint_full.js — 전수 린트: 각 법의 페이지에서 비대칭 역링크·허브 링크·dangling을 자기 법 파일 안에서 완성한다.
// 역할(초보자용): 신경망을 촘촘하게. 각 에이전트가 "내 법을 인용하는 다른 법"을 찾아 내 페이지에 역링크를 걸고,
//   내 법이 속한 비교허브로 링크하고, 깨진 [[링크]]를 정리한다. **자기 법 파일만** 쓰므로 병렬 안전.
// [연계] 입력 wiki/**(전체, 읽기) + wiki/comparisons/(허브 목록) · 출력 자기 법 concept/statute의 링크 절
// [로드 순서] Workflow. 허브 신설(synth_lint) 후. graph.json/comparisons 신규생성은 안 함(읽기만) → 병렬 안전.

export const meta = {
  name: 'maritime-lint-full',
  description: '전수 린트: 법별 비대칭 역링크·허브링크·dangling 정리(자기 법 파일만=병렬안전)',
  phases: [{ title: '전수린트', detail: '법별 1에이전트: 내 법 인용자 역링크+허브링크+dangling 정리' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const SCHEMA = {
  type: 'object', required: ['law', 'status'],
  properties: {
    law: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'nochange', 'failed'] },
    backlinks_added: { type: 'integer', description: '내 법을 인용하는 법으로의 역링크(양방향) 추가' },
    hub_links_added: { type: 'integer', description: '내 법이 속한 비교허브로의 링크 추가' },
    dangling_fixed: { type: 'integer', description: '깨진 [[링크]] 정리(대상 존재 확인·수정·제거표기)' },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 **전수 린트 사서**다. 담당 법의 신경망(링크)을 촘촘하게 완성한다. **자기 법 파일만** 쓴다(다른 법·graph.json·comparisons 신규생성·.claude 금지 — 읽기만).

## 담당 법: 「${l.name}」 (slug: ${l.slug})
- 내 법 페이지: \`ls ${LEGAL}/wiki/concepts/${l.slug}__*.md\` + \`${LEGAL}/wiki/statutes/${l.slug}.md\`

## 1) 비대칭 역링크 보강 (핵심)
- **내 법을 인용하는 다른 법 찾기**: \`grep -rl "${l.name}\\|${l.slug}" ${LEGAL}/wiki/concepts/ ${LEGAL}/wiki/comparisons/\` (내 법 제외). 다른 법 페이지가 내 법을 \`[[링크]]\`·타법연결·비교표에 넣었는데, **내 법 페이지엔 그쪽으로 가는 역링크가 없으면** 내 페이지 \`## 관련 개념\`에 \`[[그 법__개념]]\` 역링크를 추가(양방향 완성). raw 근거 없는 내용 서술은 금지, 링크만.

## 2) 비교허브 링크
- \`ls ${LEGAL}/wiki/comparisons/\` 로 허브 목록 확인. **내 법이 회원인 허브**(그 허브가 내 법을 언급/비교)가 있으면, 내 관련 개념 페이지 \`## 관련 개념\`에 그 허브로 \`[[comparisons/<허브>]]\` 링크를 추가.

## 3) dangling(깨진 링크) 정리
- 내 법 페이지의 \`[[링크]]\` 중 **대상 파일이 실제로 없는 것**을 찾아(\`ls\`로 확인): 대상이 다른 이름으로 존재하면 고치고, 아직 미생성 개념이면 \`[[링크]](편입예정)\`으로 표기(지우지 말 것 — 다음 수집 대상 신호).

## 4) 규칙
- 🚫 **자기 법 파일만 쓴다.** 다른 법 파일·wiki/comparisons/ 신규생성·graph.json·_glossary·.claude/ 금지(읽기만). 허브 자체 신설이 필요하면 만들지 말고 note에 적어라(단독 단계 대상).
- 링크만 손대고 본문 서술은 바꾸지 말 것(외과수술식). 환각 0.
- 완료 후 Bash 마커: \`printf 'r7 lintfull\\n' > ${LEGAL}/_dashboard/fix3/lintfull_r7_${l.slug}.done\`.

## 5) 반환(JSON): law, status, backlinks_added, hub_links_added, dangling_fixed, note.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON {"0":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '전수린트', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`전수린트 대상 ${laws.length}법`)
phase('전수린트')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `lintfull:${l.name.slice(0, 12)}`, phase: '전수린트', model: 'sonnet', effort: 'medium', schema: SCHEMA })
))).filter(Boolean)

return {
  linted: res.filter(r => r.status === 'done' || r.status === 'partial').length,
  total: laws.length,
  backlinks: res.reduce((s, r) => s + (r.backlinks_added || 0), 0),
  hub_links: res.reduce((s, r) => s + (r.hub_links_added || 0), 0),
  dangling: res.reduce((s, r) => s + (r.dangling_fixed || 0), 0),
  hub_notes: res.filter(r => r.note && r.note.includes('허브')).map(r => `${r.law}: ${r.note}`),
}
