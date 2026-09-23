const path = require('path');
// draft_reverify.js — 초안승인(draft) 재검증 v2: 자동승급이 과보수적으로 남긴 draft를 원문 grounding으로 재판정.
// 역할(초보자용): draft 666건 중 대다수는 "처벌 단어가 있다"는 이유로만 draft로 남았는데, 실제론 raw 원문
//   그대로 인용이라 grep으로 검증되면 AI가 승급해도 안전하다. 이 워크플로우는 각 draft를 raw 원문과 대조해:
//   ①원문 그대로면 canonical 승급 ②값이 별표 이미지 OCR에만 있으면 draft 유지+수치검증 카드 생성(사람) ③추론/원문부재면 유지.
// [연계] 입력 wiki/concepts/<slug>__*.md(자기법 draft/review) + raw/(원문 대조) · 출력 status 승급 or review_gen 카드
//        마커 fix3/reverify_<slug>.done. 자기 법 파일만 쓰므로 병렬 안전(⚠경합없음).
// [로드 순서] Workflow. H-12② 이원승급의 '재검증' 강화판. auto_promote보다 엄격한 grounding + 사람카드 자동생성.
export const meta = {
  name: 'maritime-draft-reverify',
  description: 'draft를 raw 원문 grounding으로 재판정: 원문인용은 승급, 별표OCR값만 사람(수치검증 카드 자동생성)',
  phases: [{ title: '초안재검증', detail: '법별 1에이전트: draft마다 raw 대조 → 승급 or 수치카드 or 유지' }],
}
const LEGAL = path.resolve(__dirname, '../..')

const SCHEMA = {
  type: 'object', required: ['law', 'status'],
  properties: {
    law: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'nochange', 'failed'] },
    promoted: { type: 'integer', description: 'raw 원문인용 확인→canonical 승급 수' },
    cards: { type: 'integer', description: '별표 이미지 OCR값 의존→수치검증 카드 생성 수(사람)' },
    kept: { type: 'integer', description: '추론/원문부재로 draft 유지 수' },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 **초안(draft) 재검증 사서**다. 담당 법의 draft 페이지를 **raw 원문과 대조(grounding)** 해서 3가지 중 하나로 처리한다. **자기 법 파일만** 쓴다(.claude·다른 법·graph 금지).

## 담당 법: 「${l.name}」 (slug: ${l.slug})
- 대상: \`grep -lE "^status: (draft|review)" ${LEGAL}/wiki/concepts/${l.slug}__*.md ${LEGAL}/wiki/statutes/${l.slug}.md ${LEGAL}/wiki/comparisons/${l.slug}__*.md ${LEGAL}/wiki/annexes/${l.slug}__*.md 2>/dev/null\` — concepts뿐 아니라 statutes·comparisons·annexes 중 **자기 법 slug로 시작하는 파일**도 전부 포함(다른 법과 공유하는 범용 comparisons 허브는 slug 접두어가 없으므로 자동 제외됨, 손대지 말 것).
- 원문: ${LEGAL}/raw/<분류>/${l.name} 또는 slug 폴더의 {법률.txt,시행령.txt,시행규칙.txt,별표/,행정규칙/}. 타법은 raw/15_관련타부처/.

## 각 draft 페이지마다 판정 (핵심)
### ① promote — raw 원문 그대로 인용/요약 (사람 불필요)
- 페이지의 **처벌 조문·수치·정의·절차가 raw 원문 텍스트에 그대로 있다**(grep로 EXACT 확인). 처벌 금액·형량도 **원문 조문의 정확 인용**이면 기계검증 가능 → 승급 OK.
- **★H-34 기계적연역도 승급 대상(2026-08-01 사용자 확정, \`_SCHEMA.md\` §5)**: 조문 2개 이상을 조합해야 하는 REVIEW라도, **텍스트만으로 결론이 하나로 수렴하면**("해석"이 아니라 "읽기") 승급 가능 — ⓐ완전열거(exhaustive list)와의 포함·불포함 대조(예: "위임 대상은 N개 항목뿐"이라 시행령이 완결적으로 열거) ⓑ정의조문 간 명시적 상호참조 ⓒ배타적 범주(예/아니오로 갈리는 것) 대조 ⓓ원문에 판단기준 자체가 없다는 **부재(negative) 확인**(해석이 아니라 부재 확인이라 사람 불필요). **진짜 승급 금지 대상은 조합 후에도 두 가지 이상 합리적 결론이 실제로 경합하는 경우뿐**(예: 무생물 예시를 생물에 유추할지) — 그것만 ③으로.
- 처리: frontmatter \`status: draft\`(또는 review) → \`status: canonical\` (이 한 줄). 맨 아래 한 줄 추가:
  \`> AI 재검증 승급(원문 grounding, 2026-07-20): <근거 조문/파일 EXACT 인용 한 조각>.\` (H-34 기계적연역 사유면 "H-34 기계적연역(완전열거 대조)"처럼 사유도 한 마디 적기)
- ⚠REVIEW 표기가 있어도 그 내용이 **원문 인용으로 해소**되거나 **위 H-34 기준을 통과**하면 승급하고 ⚠REVIEW 줄은 남겨둬도 됨(본문 변경 최소, 필요하면 "REVIEW" 단어만 지우고 결론 문장으로 교체).

### ② card — 값이 별표 이미지 OCR에만 있어 텍스트로 검증 불가 (진짜 사람)
- 수치가 **별표 스캔 이미지(_이미지/*.png)나 OCR 박스표에서 읽은 것**이라 원문 텍스트로 확증 못 한다.
- 처리: **draft 유지**(승급 금지). 그리고 자기 partial \`${LEGAL}/_dashboard/review_gen/${l.slug}.md\`에 아래 카드 append(있으면 이어붙임):
\`\`\`
### REVIEW-${l.slug}-8NN: <개념 제목> · <값 항목>
- 대상 페이지: wiki/concepts/<파일명>.md
- AI 제안값: <AI가 읽은 값 그대로>
- 확인 필요: <별표N OCR 수치가 "<값>"이 맞는지 원본 대조>
- 근거: <어느 별표/조문>
- 원문 조문: "<raw 별표 텍스트 인용>"
- 원본: /api/legal/src?p=<raw 상대경로(별표.txt 또는 _이미지/*.png)>
- 승인: [ ] 대기
\`\`\`
  8NN은 801부터. 숫자로 끝나게.

### ③ keep — 진짜 해석다툼·원문부재 (그대로 draft 유지)
- **조합 후에도 두 가지 이상 합리적 결론이 실제로 경합**하거나(위 H-34 기준 통과 못함), 원문이 raw에 아예 없어 확인 불가. 승급도 카드생성도 하지 말고 draft 유지.

## 규칙(외과수술식·환각0)
- 🚫 승급 시 **status 줄 + 승급주석 1줄만** 손댄다. 본문 수치·링크 변경 금지. 환각 인용 금지 — grep로 실제 확인한 것만.
- **보수적**: 원문 EXACT 인용을 못 찾으면 promote 금지. 애매하면 keep 또는 card.
- card의 \`/api/legal/src?p=\`에는 raw/ 뺀 상대경로, 파일 존재를 ls로 확인 후 기입.
- 완료 후 Bash 마커: \`printf 'rv\\n' > ${LEGAL}/_dashboard/fix3/reverify_${l.slug}.done\`.

## 반환(JSON): law, status, promoted, cards, kept, note.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON {"0":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '초안재검증', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`초안 재검증 대상 ${laws.length}법`)
phase('초안재검증')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `reverify:${l.name.slice(0, 12)}`, phase: '초안재검증', model: 'sonnet', effort: 'medium', schema: SCHEMA })
))).filter(Boolean)

return {
  laws: res.length,
  promoted: res.reduce((s, r) => s + (r.promoted || 0), 0),
  cards: res.reduce((s, r) => s + (r.cards || 0), 0),
  kept: res.reduce((s, r) => s + (r.kept || 0), 0),
  per_law: res.map(r => ({ law: r.law, promoted: r.promoted || 0, cards: r.cards || 0, kept: r.kept || 0 })),
}
