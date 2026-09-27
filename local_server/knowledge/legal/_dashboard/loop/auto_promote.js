const path = require('path');
// auto_promote.js — ① 비민감 draft 자동 승급: 각 법의 draft 개념 중 사람검증 불필요한 것만 canonical로.
// 역할(초보자용): 위키의 86%가 draft(미승인)라 챗봇이 못 씀. 그중 **원문 그대로 인용·순수 정의/절차**처럼
//   기계로 검증 가능한 비민감 페이지만 canonical로 올린다. 처벌·안전수치·OCR판독·⚠REVIEW는 손대지 않고
//   draft/review-pending으로 남겨 사람(B안) 검증 대상으로 둔다. 자기 법 파일만 쓰므로 병렬 안전.
// [연계] 입력 wiki/concepts/<slug>__*.md(자기법 draft) · 출력 status 승격 + 승급주석 · 마커 promote_<slug>.done
// [로드 순서] Workflow. H-12② 이원승급의 AI 자동승격 축. B안(사람)과 다른 페이지 집합이라 병렬 무충돌.

export const meta = {
  name: 'maritime-auto-promote',
  description: '비민감 draft 개념을 canonical로 자동 승급(민감·⚠REVIEW·OCR판독은 draft 유지=B안)',
  phases: [{ title: '자동승급', detail: '법별 1에이전트: draft 중 비민감만 canonical, 애매하면 draft 유지' }],
}
const LEGAL = path.resolve(__dirname, '../..')

const SCHEMA = {
  type: 'object', required: ['law', 'status'],
  properties: {
    law: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'nochange', 'failed'] },
    promoted: { type: 'integer', description: 'canonical로 올린 draft 수' },
    kept_draft: { type: 'integer', description: '민감/애매로 draft 유지(=B안 대상)' },
    promoted_files: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 **자동 승급 사서**다. 담당 법의 draft 개념 페이지 중 **사람 검증이 필요 없는 비민감 페이지만** canonical로 올린다. **자기 법 파일만** 쓴다(.claude·다른 법·graph 금지).

## 담당 법: 「${l.name}」 (slug: ${l.slug})
- 대상: \`grep -l "^status: draft" ${LEGAL}/wiki/concepts/${l.slug}__*.md\` (draft인 것만)

## 승급 판정(각 draft 페이지마다)
각 페이지를 Read해서 **아래 '민감/불확실 신호'가 하나라도 있으면 그대로 draft로 둔다(=사람 검증 B안 대상, 절대 승급 금지):**
- \`⚠REVIEW\` / \`출처미확인\` / \`판독\`(OCR 이미지 판독값) / \`REVIEW-\` 표기
- **별표 이미지에서 읽은 수치**(HWP/이미지 OCR 의존값), 손글씨·도면 판독
- **불확실한 처벌 매핑**(원문에 명시 안 된 포괄표현을 AI가 추론해 형량 매핑한 것)
- 본문에 "확인 필요/추정/불명/사람 검증" 류 자기신고

**위 신호가 전혀 없고**, 내용이 **원문(법·시행령·시행규칙 조문)을 그대로 인용·요약한 순수 정의/절차/구조 서술**이며 **출처(제N조)가 붙어 있으면 → 승급 대상**:
- frontmatter \`status: draft\` → \`status: canonical\` 로 바꾼다(딱 이 한 줄).
- 페이지 맨 아래 한 줄 추가: \`> AI 자동승급(비민감·원문대조, 2026-07-20): 처벌·안전·판독값 없음 확인.\`
- **처벌 조문이 있어도** 그것이 **원문 그대로의 정확 인용(조·항·호·금액)** 이고 ⚠REVIEW/판독 신호가 없으면 승급 가능(원문 그대로는 기계검증 가능). 단 조금이라도 애매하면 **draft 유지**(보수적: 잘못 올리느니 남긴다).

## 규칙
- 🚫 status 줄과 승급주석 1줄만 손댄다. 본문 내용·수치·링크는 **변경 금지**(외과수술식). 환각 0.
- 애매하면 **무조건 draft 유지**. 과승급 절대 금지.
- 완료 후 Bash 마커: \`printf 'promote\\n' > ${LEGAL}/_dashboard/fix3/promote_${l.slug}.done\`.

## 반환(JSON): law, status, promoted, kept_draft, promoted_files[], note.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON {"0":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '자동승급', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`자동승급 대상 ${laws.length}법`)
phase('자동승급')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `promote:${l.name.slice(0, 12)}`, phase: '자동승급', model: 'sonnet', effort: 'medium', schema: SCHEMA })
))).filter(Boolean)

return {
  laws: res.length,
  promoted: res.reduce((s, r) => s + (r.promoted || 0), 0),
  kept_draft: res.reduce((s, r) => s + (r.kept_draft || 0), 0),
  per_law: res.map(r => ({ law: r.law, promoted: r.promoted || 0, kept: r.kept_draft || 0 })),
}
