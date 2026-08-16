// collection_hole_recollect.js — collection_hole_reverify.js가 확정한 action=recollect 백로그를 실제로 수집·위키 반영
// 역할(초보자용): collection_hole_reclass_report_g<N>.md의 "1. action=recollect" 절에 적힌 항목을
//   그 절이 이미 알려준 구체 방법(DRF API 대상·ID·MST, ordin/eflaw/admrul 구분, hwp5html 경유 등)대로
//   실제로 수집해 raw/에 저장하고, 해당 위키 페이지의 collection_hole 서술을 실제 내용으로 교체한다.
// [연계] 입력 _dashboard/collection_hole_reclass_report_g<N>.md(그룹별, 병렬 안전 — 그룹마다 다른 법)
//   출력 raw/<domain>/<slug>/... + wiki/concepts|annexes/<slug>__*.md
// [로드 순서] Workflow. collection_hole_reverify.js(10그룹) 완료 후, 사용자 지시로 실행.
export const meta = {
  name: 'collection-hole-recollect',
  description: 'collection_hole 재검증이 확정한 action=recollect 백로그를 실제 수집·위키 반영(그룹별, 자기 법 파일만=병렬안전)',
  phases: [{ title: '재수집', detail: '그룹 리포트의 recollect 절을 읽고 실제 API/HWP 변환으로 수집 후 raw·wiki 반영' }],
}

const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const SCHEMA = {
  type: 'object',
  required: ['group', 'attempted', 'succeeded', 'items'],
  properties: {
    group: { type: 'string' },
    attempted: { type: 'integer' },
    succeeded: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['law', 'item', 'status'],
        properties: {
          law: { type: 'string' },
          item: { type: 'string' },
          status: { type: 'string', enum: ['collected_and_synced', 'collected_only', 'still_blocked', 'skipped'] },
          note: { type: 'string' },
        },
      },
    },
  },
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const groupIndex = cfg.groupIndex

phase('재수집')
const result = await agent(`
너는 SEAGNAL 해양법률 위키의 재수집 사서다. 아래 리포트의 **"1. action=recollect"** 절에 적힌 항목을 실제로 처리한다.

## 담당 리포트
${LEGAL}/_dashboard/collection_hole_reclass_report_g${groupIndex}.md

## 할 일 (recollect 항목 하나마다)
1. 리포트의 "재수집 경로" 칸에 이미 구체 방법(DRF API target=admrul/eflaw/ordin, MST/ID, hwp5html 경유 등)이 적혀 있다 — 그대로 실행해라. 예:
   - \`python3 -c "import urllib.request,json; d=json.load(urllib.request.urlopen('https://www.law.go.kr/DRF/lawService.do?OC=hyoo1431&target=admrul&ID=<ID>&type=JSON',timeout=20)); print(json.dumps(d,ensure_ascii=False))"\`
   - 자치법규(ordin)는 ID 직접조회가 안 되는 경우가 많다 — \`target=ordin&query=<검색어>\`(lawSearch)로 먼저 자치법규일련번호(MST)를 찾은 뒤 \`target=ordin&MST=<MST>\`로 본문 조회.
   - HWP 첨부는 \`flDownload.do?flSeq=<flSeq>\`로 원본을 받아(curl) \`pip install pyhwp\`(이미 설치돼 있을 수 있음, 확인 먼저) 후 \`hwp5html --output <dir> <file>\`로 변환 → index.xhtml에서 태그 제거해 텍스트 추출(**hwp5txt는 표를 못 읽는다 — 반드시 hwp5html 경유**).
2. 수집에 성공하면:
   - raw 저장: 해당 법의 \`raw/<domain>/<slug>/행정규칙/\` 또는 \`_자치법규/\`(신설 가능) 등 적절한 위치에 원문 텍스트를 저장(파일명은 기존 관례를 따라 고시명.txt 등).
   - 위키 반영: 리포트가 가리키는 개념 페이지(annex 포함)를 Read해, 그 collection_hole 서술을 방금 수집한 원문 EXACT 인용으로 교체·보강한다. 인용은 조문/고시명·발령번호까지 명시. 값이 원문 그대로 인용/명확 확인이면 canonical 승격 가능(H-34 기준), 해석 여지가 있으면 draft 유지.
   - 완료 마커: 필요 없음(이 스크립트는 완료 마커를 쓰지 않는다 — 오케스트레이터가 git diff로 확인).
3. 수집 시도했으나 이번에도 실패하면(API가 진짜로 없음을 재확인·HWP 변환 재실패 등) status=still_blocked로 정직 기록, 원문에 없다는 확정 서술을 위키에 추가하지 마라(추측 금지).
4. **자기 법 파일만 쓴다** — 이 그룹 리포트에 나온 법들 외에는 건드리지 마라. comparisons/·graph.json·.claude/ 금지(읽기만).
5. 리포트에 recollect 항목이 0건이면 즉시 {group, attempted:0, succeeded:0, items:[]}를 반환해라(불필요한 작업 금지).

정직하게 — 억지로 채우지 말고, 원문에 정말 없으면 없다고 남겨라.

반환(JSON): {group, attempted(시도 건수), succeeded(raw+wiki 둘 다 반영 성공 건수), items:[{law, item(간결 요약), status, note}]}
`, { schema: SCHEMA, phase: '재수집', label: `recollect:g${groupIndex}`, effort: 'high' })

return result
