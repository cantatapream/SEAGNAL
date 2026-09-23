const path = require('path');
// collection_hole_reverify.js — H-26 기준(_SCHEMA.md §6-B) collection_hole a/b/c 재분류·재검증
// 역할(초보자용): 감사가 📛collection_hole로 찍은 항목이 (a)진짜원문공백 (b)구조적접근불가 (c)검색부실/미시도(재수집백로그)
//   중 어디인지, 법별로 MST 위임조회 API(lsDelegated)와 raw/_admrul.json 대조로 재검증한다.
// [연계] 입력 _dashboard/audit/<slug>.md + raw/<domain>/<slug>/_meta.json·행정규칙/_admrul.json
//   출력 _dashboard/collection_hole_reclass_report_g<N>.md (그룹별, groupsPath+groupIndex 사용 시)
//   또는 _dashboard/collection_hole_reclass_report.md (args.laws 직접 지정 시)
// [로드 순서] Workflow. groupsPath+groupIndex(10그룹 병렬) 또는 args.laws 직접 지정, 사용자 지시로 실행.
//   2026-08-16: 사용자 지시로 model:opus·effort:high 적용(정밀 재검증), 그룹별 병렬 디스패치 지원 추가.
export const meta = {
  name: 'collection-hole-reverify',
  description: 'H-26 기준 collection_hole a/b/c 재분류·재검증 후 통합 리포트',
  phases: [
    { title: '재검증', detail: '법별로 감사파일의 collection_hole 항목을 MST 위임조회 API로 재검증(각자 자기 폴더만 읽음 — 병렬 안전)' },
    { title: '통합리포트', detail: '결과를 하나의 리포트로 합쳐 저장(공유 파일 — 직렬 1회)' },
  ],
}

const LEGAL = path.resolve(__dirname, '../..')

const HOLE_SCHEMA = {
  type: 'object',
  required: ['law', 'holes'],
  properties: {
    law: { type: 'string' },
    holes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['item', 'tag', 'evidence', 'action'],
        properties: {
          item: { type: 'string' },
          tag: { type: 'string', enum: ['a_genuine', 'b_structural', 'c_uncollected', 'resolved', 'unclear'] },
          evidence: { type: 'string' },
          action: { type: 'string', enum: ['none', 'recollect', 'wiki_sync', 'reclassify_note'] },
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
감사 리포트: ${LEGAL}/_dashboard/audit/${law.slug}.md
법 메타(MST 위치: families.<가족>.MST): ${law.raw}/_meta.json
행정규칙 기수집 결과: ${law.raw}/행정규칙/_admrul.json (없거나 {}이면 위임 행정규칙 미조회 상태일 수 있음)

## 할 일
1. 감사 리포트를 Read해서 📛(collection_hole) 표시된 모든 항목을 찾아라. 같은 항목이 여러 라운드에 걸쳐 반복 언급됐으면 **가장 최신(마지막) 판정만** 채택하고, 이미 ✅full로 해소됐다고 나온 항목은 tag=resolved로 표시만 하고 넘어가라.
2. 이미 (a)/(b)/(c) 태그(또는 genuine/structural/uncollected 서술)가 명시돼 있으면 그 근거 문장을 evidence에 그대로 옮겨 적어라.
3. 태그가 없거나 애매한 항목은 직접 재검증해라:
   - _meta.json을 Read해서 MST를 찾아라.
   - Bash로 다음을 실행해 이 법이 실제 위임한 행정규칙(고시) 목록을 조회해라(타임아웃 시 1회 재시도):
     python3 -c "import urllib.request,json; d=json.load(urllib.request.urlopen('https://www.law.go.kr/DRF/lawService.do?OC=hyoo1431&target=lsDelegated&type=JSON&MST=<MST여기>',timeout=20)); print(json.dumps(d,ensure_ascii=False)[:4000])"
   - 그 응답(lsDelegated.법령.위임조문정보)에 감사가 지적한 조문과 매칭되는 위임행정규칙이 있는데 raw/.../행정규칙/ 폴더에 없으면 → **(c)uncollected**, action=recollect.
   - 위임 자체가 API 응답에 없으면(위임조문 자체가 없거나 위임행정규칙조문정보가 비어있음) → **(a)genuine**, action=none(단, 원문 재확인 사유를 evidence에 남김).
   - 관보(gwanbo.go.kr)·타 정부시스템(codil.or.kr 등) 소관이라 애초에 law.go.kr API로 접근 불가한 사안이면 → **(b)structural**, action=none.
   - _admrul.json에 이미 수집된 내용이 있는데 위키 페이지에 반영이 안 된 것으로 보이면 → tag=resolved 아님, action=wiki_sync(재수집 불필요, 위키만 갱신하면 됨)로 표시.
4. 각 항목을 {item(간결 요약), tag, evidence(검증 근거), action} 구조로 반환해라.

★API 응답만으로 판단이 안 서면(위임조문 자체가 애매하거나 응답이 비어있는데 원문상 정말 없는지 확신이 안 서면), WebSearch로 "law.go.kr <법령명/고시명>"류 검색을 1~2회 추가로 시도해 국가법령정보센터에 실제로 등재돼 있는지 교차 확인해라 — lsDelegated API 하나만으로 최종 판단하지 말고, 가능한 다른 경로(법령명 직접 검색·행정규칙 목록 검색)도 시도한 뒤에 tag를 확정해라.
정직하게 — 그래도 판단이 애매하면 tag=unclear로 솔직히 남겨라(추측으로 a/b/c 확정하지 마라).
`, { schema: HOLE_SCHEMA, phase: '재검증', label: `hole:${law.slug}`, model: 'opus', effort: 'high' })
  .then(r => ({ ...r, slug: law.slug }))
  .catch(() => null)
))

const valid = results.filter(Boolean)
log(`${valid.length}/${laws.length}법 재검증 완료`)

phase('통합리포트')
const reportPath = cfg.groupIndex !== undefined
  ? `${LEGAL}/_dashboard/collection_hole_reclass_report_g${cfg.groupIndex}.md`
  : `${LEGAL}/_dashboard/collection_hole_reclass_report.md`
const report = await agent(`
아래는 ${valid.length}개 법의 collection_hole 재검증 결과(JSON 배열, 각 원소는 {law, slug, holes:[{item,tag,evidence,action}]})다.
이 데이터를 바탕으로 리포트를 작성해 ${reportPath} 에 Write 도구로 저장해라(그룹별 별도 파일 — 공유 파일 아님, 병렬 안전).

## 리포트 구조
# collection_hole 재분류 리포트 (H-26 기준, _SCHEMA.md §6-B)

## 0. 요약
- 재검증 대상 법 수, 총 항목 수
- tag별 건수(a_genuine / b_structural / c_uncollected / resolved / unclear)
- action별 건수(none / recollect / wiki_sync / reclassify_note)

## 1. action=recollect (진짜 재수집 필요 — 백로그)
법명별로 항목·근거를 표로.

## 2. action=wiki_sync (이미 수집돼 있는데 위키 미반영)
법명별로 항목·근거를 표로.

## 3. action=reclassify_note (기존 태그가 틀렸던 경우 — 태그만 정정)
## 4. tag=unclear (재검증으로도 판단 못한 항목 — 사람 확인 필요)
## 5. 법별 전체 상세 (참고용, 접어서)

데이터:
${JSON.stringify(valid)}

작성만 해라. git add/commit/push는 하지 마라(오케스트레이터가 처리한다).
`, { phase: '통합리포트', label: 'synth-report', model: 'opus' })

return { valid_count: valid.length, total: laws.length, report_summary: report }
