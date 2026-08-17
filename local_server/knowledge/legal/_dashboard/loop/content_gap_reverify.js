// content_gap_reverify.js — thin(content_gap) 판정이 정말 "원문 자체에 없는 것"인지 raw 재대조로 전수 재검증
// 역할(초보자용): 감사가 thin(content_gap)으로 찍은 항목(위키만이 아니라 원문에도 없다고 판정한 것)을
//   raw 원문(법률/시행령/시행규칙/행정규칙/별표)에 다시 grep·정독해, 실은 raw에 있는데 위키만 안 옮긴
//   것(=wiki_lag 오분류)은 아닌지 확인한다. collection_hole_reverify.js의 content_gap판 자매 스크립트.
// [연계] 입력 _dashboard/audit/<slug>.md(누적, append-only라 전체 라운드 이력 포함) + raw/<domain>/<slug>/
//   출력 _dashboard/content_gap_reverify_report_g<N>.md(그룹별)
// [로드 순서] Workflow. groupsPath+groupIndex(10그룹 병렬), 사용자 지시로 실행. H-39(collection_hole 즉시수집)의
//   content_gap판 짝 — 2026-08-17 사용자 지시로 신설.
export const meta = {
  name: 'content-gap-reverify',
  description: 'thin(content_gap) 판정이 정말 원문에도 없는 것인지 raw 재대조로 전수 재검증 후 통합 리포트',
  phases: [
    { title: '재검증', detail: '법별로 감사파일의 content_gap 항목을 raw 재grep으로 재확인(자기 폴더만 읽음 — 병렬 안전)' },
    { title: '통합리포트', detail: '결과를 하나의 리포트로 합쳐 저장(그룹별 — 직렬 아님, 병렬 안전)' },
  ],
}

const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const GAP_SCHEMA = {
  type: 'object',
  required: ['law', 'items'],
  properties: {
    law: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['item', 'tag', 'evidence', 'action'],
        properties: {
          item: { type: 'string' },
          tag: { type: 'string', enum: ['confirmed_gap', 'misclassified_wiki_lag', 'resolved', 'unclear'] },
          evidence: { type: 'string' },
          action: { type: 'string', enum: ['none', 'wiki_fix', 'reclassify_note'] },
        },
      },
    },
  },
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON: {"0":[...],"1":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로, 필터·가공 금지)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '재검증', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}

phase('재검증')
const results = await parallel(laws.map(law => () => agent(`
법: ${law.name} (slug: ${law.slug})
감사 리포트(누적, 전체 라운드 이력 포함): ${LEGAL}/_dashboard/audit/${law.slug}.md
raw 원문 폴더: ${law.raw}

## 할 일
1. 감사 리포트를 Read해서 **thin(content_gap)** 또는 "[content_gap]"·"원문 자체 공백"·"genuine gap"류로 표시된 모든 항목을 찾아라(collection_hole은 대상 아님 — 그건 별도 스크립트가 처리 중이니 건드리지 마라). 같은 항목이 여러 라운드에 걸쳐 반복 언급됐으면 **가장 최신(마지막) 판정만** 채택하고, 이미 위키에 반영돼 full로 해소됐다고 최신 라운드에 적힌 항목은 tag=resolved로 표시만 하고 넘어가라.
2. 남은 항목마다: 그 항목이 인용하는 조문(예: "법 제N조", "시행규칙 제N조", "별표N")을 **raw/(법률.txt·시행령.txt·시행규칙.txt·행정규칙/*.txt·별표/*.txt 등)에서 다시 grep으로 찾아 직접 읽어라.** 감사가 예전에 "raw에도 없다"고 판정했더라도 그 판정 자체를 그대로 믿지 말고 네가 직접 raw 파일을 열어 재확인해라(재수집 이후 raw가 갱신됐을 수도 있고, 예전 grep이 표현을 놓쳤을 수도 있다).
3. 재확인 결과:
   - raw를 다시 봐도 정말 그 내용이 없으면(조문 자체가 침묵) → **tag=confirmed_gap**, action=none. evidence에 "raw의 어느 파일 어느 조문까지 확인했는데 없었다"를 구체적으로 남겨라(다음 라운드가 또 같은 헛수고를 안 하도록).
   - raw엔 실제로 있는데 위키에만 안 옮겨진 것이었으면(=예전 감사의 오분류) → **tag=misclassified_wiki_lag**, action=wiki_fix. evidence에 raw의 정확한 위치(파일·조문)를 남겨라 — 이후 H-9①통합수정 패스가 이걸 그대로 옮길 수 있게.
   - 판단이 애매하면(예: raw가 이 법의 것이 아니라 인용된 타법 raw라서 접근 범위 밖인 경우) → tag=unclear, action=none으로 솔직히 남기고 사유를 적어라.
4. 각 항목을 {item(간결 요약), tag, evidence, action} 구조로 반환해라. **읽기만 하고 위키 파일은 이 패스에서 수정하지 마라** — 재검증 결과만 보고하면 오케스트레이터/다음 H-9①통합수정 패스가 misclassified_wiki_lag 항목을 실제로 반영한다.

정직하게 — 애매하면 unclear로 남겨라(추측으로 확정하지 마라). 이미 collection_hole로 분류된 항목(별표 이미지·행정규칙 고시 미제정 등)은 건드리지 마라(다른 스크립트 담당).
`, { schema: GAP_SCHEMA, phase: '재검증', label: `gap:${law.slug}`, model: 'opus', effort: 'high' })
  .then(r => ({ ...r, slug: law.slug }))
  .catch(() => null)
))

const valid = results.filter(Boolean)
log(`${valid.length}/${laws.length}법 재검증 완료`)

phase('통합리포트')
const reportPath = cfg.groupIndex !== undefined
  ? `${LEGAL}/_dashboard/content_gap_reverify_report_g${cfg.groupIndex}.md`
  : `${LEGAL}/_dashboard/content_gap_reverify_report.md`
const report = await agent(`
아래는 ${valid.length}개 법의 content_gap 재검증 결과(JSON 배열, 각 원소는 {law, slug, items:[{item,tag,evidence,action}]})다.
이 데이터를 바탕으로 리포트를 작성해 ${reportPath} 에 Write 도구로 저장해라(그룹별 별도 파일 — 공유 파일 아님, 병렬 안전).

## 리포트 구조
# content_gap 재검증 리포트 (thin/content_gap 전수 재대조)

## 0. 요약
- 재검증 대상 법 수, 총 항목 수
- tag별 건수(confirmed_gap / misclassified_wiki_lag / resolved / unclear)

## 1. action=wiki_fix (오분류 확인됨 — raw엔 있는데 위키만 안 옮겨짐, 다음 통합수정 최우선 반영 대상)
법명별로 항목·raw 근거 위치를 표로.

## 2. tag=unclear (재검증으로도 판단 못한 항목 — 사람 확인 필요)
## 3. tag=confirmed_gap (재확인 결과 진짜 원문공백 — 정상, 조치 불요, 참고용 접어서)
## 4. 법별 전체 상세 (참고용, 접어서)

데이터:
${JSON.stringify(valid)}

작성만 해라. git add/commit/push는 하지 마라(오케스트레이터가 처리한다).
`, { label: 'report', phase: '통합리포트', model: 'sonnet', effort: 'low' })

return { reportPath, laws_checked: valid.length }
