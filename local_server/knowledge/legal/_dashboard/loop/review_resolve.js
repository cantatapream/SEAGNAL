const path = require('path');
// review_resolve.js — ③ 리뷰큐 자동 트리아지: 미승인 엔트리를 재검증해 resolved/needs_collect/human 판정.
// 역할(초보자용): fable5 분류상 미승인 97건 중 67%는 AI가 처리 가능(공개법령 재수집 or 원문 재대조).
//   이 워크플로우는 각 엔트리를 **원문 근거로 재검증**해서, 근거 인용이 확실하면 resolved(→사람 승인 불필요),
//   raw에 없는 공개법령이 필요하면 needs_collect(→수집 트랙), 진짜 판단이면 human(→사람 큐 유지)으로 가른다.
// [연계] 입력 pending_reviews.json(미승인 파싱본) · raw/·wiki/(읽기전용) · 출력: 판정 배열(공유파일 미접촉)
// [로드 순서] Workflow. ⚠경합없음: 에이전트는 읽기만. 판정 적용(큐 승인·승격)은 메인이 단독 직렬로.
export const meta = {
  name: 'maritime-review-resolve',
  description: '미승인 리뷰를 원문 근거로 재검증해 resolved/needs_collect/human 판정(읽기전용, 자동확정 대상 선별)',
  phases: [{ title: '재검증', detail: '엔트리 5건/에이전트: raw 재대조로 근거 확정 or 수집필요 or 사람판단 분류' }],
}
const SP = '/tmp/claude-0/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/scratchpad'
const LEGAL = path.resolve(__dirname, '../..')

const DEC = {
  type: 'object', required: ['idx', 'id', 'verdict'],
  properties: {
    idx: { type: 'integer' }, id: { type: 'string' },
    verdict: { type: 'string', enum: ['resolved', 'needs_collect', 'human'] },
    evidence: { type: 'string', description: 'resolved면 필수: raw/wiki에서 인용한 EXACT 근거 문장(그 주장이 사실임을 증명)' },
    corrected_value: { type: 'string', description: '값형이고 원본과 다르면 올바른 값(그 외 빈칸)' },
    collect_target: { type: 'string', description: 'needs_collect면: 수집할 공개법령/고시명 + 어느 조문' },
    note: { type: 'string', description: '한 줄 사유' },
  },
}
const SCHEMA = { type: 'object', required: ['decisions'], properties: { decisions: { type: 'array', items: DEC } } }

function prompt(idxs) {
  return `너는 SEAGNAL 해양법률 위키의 **리뷰 자동 트리아지 검증관**이다. 아래 엔트리들을 **원문 근거로 재검증**해서 3가지 중 하나로 판정한다. **아무 파일도 수정하지 마라(읽기 전용).** 판정만 JSON으로 반환.

## 대상 엔트리 (pending_reviews.json의 idx)
- \`${SP}/pending_reviews.json\` 를 Read해서 아래 idx 항목만 처리: [${idxs.join(', ')}]
- 각 항목: {idx, id, title, targetPages[], body}

## 판정 규칙 (엔트리마다 하나)
### ① resolved — AI가 원문 근거로 확정 가능 (사람 불필요)
- 그 엔트리의 주장(연결·산정·부재확인·정의사슬)이 **이미 raw 또는 대상 wiki 페이지에 있는 원문 텍스트로 증명**된다.
- 반드시 \`evidence\`에 **그 원문의 EXACT 인용 문장**(grep/Read로 실제 확인한 것)을 넣어라. 인용 못 하면 resolved 금지.
- 예: "형사소송법 제249조①5호 대조로 공소시효 5년" → raw에서 그 호 원문을 grep해 인용. "제106조①3호가 제40조 위반에 직접 대응" → 그 원문 인용.
- 값형(별표 OCR 수치 등)이고 원본과 다르면 \`corrected_value\`에 올바른 값.

### ② needs_collect — 공개법령/고시가 raw에 없어 보강 필요 (에이전트 수집 트랙, 사람 불필요)
- 언급된 타법·부령·고시·조약이 **law.go.kr 등에서 수집 가능한 공개자료**인데 raw에 없다.
- \`collect_target\`에 무엇을(법령/고시명 + 조문) 수집하면 되는지. **미제정·자치법규(조례)·원문부재는 여기 넣지 말 것**(그건 human 또는 근거로 human).

### ③ human — 진짜 사람 필요
- 법제처 유권해석·판례·입법연혁(의도 vs 누락 판단)·정책 판단처럼 **문언 대조로 안 갈리는** 것.
- 자치법규·미제정으로 원문이 존재하지 않아 확정 불가한 것도 human.

## 규칙
- 🚫 파일 수정 절대 금지(Write/Edit 금지). grep·Read만.
- **보수적으로**: 원문 인용 근거가 조금이라도 불확실하면 resolved 금지(needs_collect 또는 human). 환각 인용 금지 — 실제 파일에 있는 문장만.
- raw 위치: ${LEGAL}/raw/<분류>/<법명>/{법률.txt,시행령.txt,시행규칙.txt,별표/,행정규칙/}. 타법은 ${LEGAL}/raw/15_관련타부처/ 또는 각 법 폴더.

## 반환(JSON): { decisions: [ {idx, id, verdict, evidence, corrected_value, collect_target, note}, ... 대상 전부 ] }`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const groups = cfg.groups || null   // {"0":[idx...],...}
let slices = []
if (groups) slices = Object.keys(groups).map(k => groups[k])
else if (cfg.idxs) slices = [cfg.idxs]
log(`재검증 ${slices.length}그룹 (총 ${slices.reduce((s, a) => s + a.length, 0)}건)`)
phase('재검증')
const res = (await parallel(slices.map((idxs, gi) => () =>
  agent(prompt(idxs), { label: `resolve:g${gi}`, phase: '재검증', model: 'sonnet', effort: 'medium', schema: SCHEMA })
))).filter(Boolean)

const all = res.flatMap(r => r.decisions || [])
const by = { resolved: 0, needs_collect: 0, human: 0 }
for (const d of all) by[d.verdict] = (by[d.verdict] || 0) + 1
// 판정을 파일로 저장(메인이 단독 직렬 적용). 워크플로 스크립트는 fs 불가라 반환만; 메인이 저장.
return { total: all.length, by, decisions: all }
