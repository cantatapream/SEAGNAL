// review_gen.js — ①절충: 민감 draft의 "AI 제안값 + 출처"를 리뷰큐에 미리 채우는 앞단 생성기.
// 역할(초보자용): 사람이 확정해야 하는 민감값(별표 OCR 수치·처벌 금액·기한)마다, AI가 읽은 제안값과
//   그 근거(원문 조문 + law.go.kr 링크 + 로컬 별표/이미지)를 한 카드로 만든다. 사용자는 리뷰페이지에서
//   원본을 보고 맞으면 승인, 틀리면 실제값을 입력한다(→ 서버 승인엔드포인트가 값 각인 + canonical 승격).
// [연계] 입력 wiki/concepts/<slug>__*.md(민감 draft/review-pending) · raw/(원문·별표·이미지)
//        출력 _dashboard/review_gen/<slug>.md(법별 자기파일만) → 이후 사람이 직렬로 review_queue.md에 병합.
// [로드 순서] Workflow. ⚠경합주의: review_queue.md 직접쓰기 금지(자기 partial만). 병합은 단독 python으로.
export const meta = {
  name: 'maritime-review-gen',
  description: '민감 draft의 AI 제안값+출처(원문/별표/이미지)를 법별 partial 리뷰카드로 생성(공유파일 미접촉)',
  phases: [{ title: '제안값생성', detail: '법별 1에이전트: 확정가능한 민감값마다 제안값+근거 카드를 자기 partial에 기록' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const SCHEMA = {
  type: 'object', required: ['law', 'status'],
  properties: {
    law: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'nochange', 'failed'] },
    generated: { type: 'integer', description: '만든 제안값 카드 수' },
    partial_file: { type: 'string' },
    note: { type: 'string' },
  },
}

function prompt(l, cap) {
  return `너는 SEAGNAL 해양법률 위키의 **제안값 리뷰카드 생성 사서**다. 담당 법의 **민감 draft 개념**에서 사람이 확정해야 할 값(별표 OCR 수치·처벌 금액/기간·기한 일수 등)마다, **AI가 읽은 제안값과 그 출처(원문 조문 + 링크)**를 담은 리뷰카드를 만든다. **자기 partial 파일 1개에만** 쓴다(review_queue.md·다른 법·wiki·.claude 절대 금지).

## 담당 법: 「${l.name}」 (slug: ${l.slug})
- 후보: \`grep -lE "^status: (draft|review)" ${LEGAL}/wiki/concepts/${l.slug}__*.md\` 중 **확정가능한 값이 있는** 페이지
- 원문/별표/이미지: ${LEGAL}/raw 하위(법별 폴더). 별표 텍스트는 \`.../별표/별표N.txt\`, OCR 이미지는 \`.../_이미지/*.png\`.

## 무엇을 카드로 만드나 (민감·확정가능한 값만, 최대 ${cap}개)
**대상**: 별표에서 읽은 수치(과태료·벌금 금액표, 안전기준 수치), 처벌 금액/징역기간, 신청·처리 기한 일수 등 **틀리면 사용자에게 위험한 값**.
**제외**: 순수 정의·절차 서술(값 없음), 이미 canonical, ⚠REVIEW가 "해석"만인 정성 항목(그건 기존 방식).

## 각 값마다 아래 형식 그대로 partial 파일에 append (라벨·순서 정확히)
\`\`\`
### REVIEW-${l.slug}-9NN: <개념페이지 제목> · <값 항목 한 줄>
- 대상 페이지: wiki/concepts/<파일명>.md
- AI 제안값: <AI가 위키/원문에서 읽은 값 그대로. 예: "300만원 이하 과태료" 또는 "10일 이내">
- 확인 필요: <한 줄. 무엇을 무엇과 대조하는지. 예: "별표3 OCR 수치가 '300만원'이 맞는지 원본 이미지와 대조">
- 근거: <어느 조문/별표에서 왔는지 한 줄 요약. 예: "제45조① 및 별표3 제2호">
- 원문 조문: "<raw에서 실제 인용한 조문/별표 텍스트 1~2줄. 지어내지 말 것>"
- 원본: https://www.law.go.kr/법령/${encodeURIComponent(l.name.replace(/\s/g, ''))} · /api/legal/src?p=<raw 상대경로(별표.txt 또는 이미지.png). raw/ 이후 경로만>
- 승인: [ ] 대기
\`\`\`
- 9NN: **901부터** 순번(901,902,...). 숫자로 끝나야 함(법 파싱용).
- \`원본\`의 \`/api/legal/src?p=\`에는 **raw/ 를 뺀 상대경로**를 넣는다(예: \`10_항만물류/항만법/별표/별표3.txt\`). 파일이 실제 존재하는지 \`ls\`로 확인 후 기입. 없으면 그 항목은 빼고 law.go.kr 링크만.
- 별표 OCR 값이면 가능한 한 해당 \`별표N.txt\`(읽을 수 있는 원문)를 링크. 특정 이미지 파일을 값과 매칭 못하면 이미지 링크는 생략(txt만).

## 규칙(외과수술식·환각0)
- 🚫 **자기 partial 파일 \`${LEGAL}/_dashboard/review_gen/${l.slug}.md\` 에만** 쓴다. review_queue.md·wiki·다른 파일 수정 금지.
- 제안값·원문 조문은 **실제 파일에서 읽은 것만**. 추측 금지. 확정가능한 값이 없으면 status:nochange.
- partial 파일은 **덮어쓰기**(> 로 새로 생성). 헤더 없이 카드들만.
- 완료 후 Bash 마커: \`printf 'gen\\n' > ${LEGAL}/_dashboard/fix3/reviewgen_${l.slug}.done\`.

## 반환(JSON): law, status, generated(카드수), partial_file, note.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
const cap = cfg.cap || 5
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON {"0":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '제안값생성', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`제안값 생성 대상 ${laws.length}법 (법별 최대 ${cap}카드)`)
phase('제안값생성')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l, cap), { label: `revgen:${l.name.slice(0, 12)}`, phase: '제안값생성', model: 'sonnet', effort: 'medium', schema: SCHEMA })
))).filter(Boolean)

return {
  laws: res.length,
  generated: res.reduce((s, r) => s + (r.generated || 0), 0),
  per_law: res.map(r => ({ law: r.law, generated: r.generated || 0, status: r.status })),
}
