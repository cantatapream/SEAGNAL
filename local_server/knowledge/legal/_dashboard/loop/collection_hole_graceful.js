const path = require('path');
// collection_hole_graceful.js — 재확인된 a_genuine/b_structural collection_hole에 H-30 3요건(위임체인+경계선언+소관부서 연락처)을 붙여 "정직한 답변"으로 완성
// 역할(초보자용): collection_hole_reclass_report_g<N>.md가 "진짜 원문공백(a)"·"구조적 접근불가(b)"로
//   재확인한 항목이 위키 페이지에서 그냥 "확인 안 됨"으로 끝나 있으면, H-30 기준(_SCHEMA.md §6-C) —
//   ①위임체인 조문까지 명시 ②왜 그 이상 못 답하는지 정직 선언 ③소관부서·전화번호 — 를 채워
//   사용자가 "정보 없음"이 아니라 "정보 없음 + 어디에 물어보면 되는지"까지 받을 수 있게 한다.
// [연계] 입력 _dashboard/collection_hole_reclass_report_g<N>.md(그룹별) + _dashboard/contacts_collected.json
//   출력 wiki/concepts|annexes/<slug>__*.md (해당 항목 서술에 3요건 보강, 3요건 이미 있으면 손대지 않음)
// [로드 순서] Workflow. collection_hole_recollect.js(재수집) 완료 후, 사용자 지시로 실행.
export const meta = {
  name: 'collection-hole-graceful',
  description: 'a_genuine/b_structural collection_hole에 H-30 3요건(위임체인·경계선언·소관부서) 보강(그룹별, 자기 법 파일만=병렬안전)',
  phases: [{ title: '정직답변보강', detail: '그룹 리포트의 a_genuine·b_structural 절을 읽고 위키에 3요건 확인·보강' }],
}

const LEGAL = path.resolve(__dirname, '../..')

const SCHEMA = {
  type: 'object',
  required: ['group', 'checked', 'items'],
  properties: {
    group: { type: 'string' },
    checked: { type: 'integer' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['law', 'item', 'status'],
        properties: {
          law: { type: 'string' },
          item: { type: 'string' },
          status: { type: 'string', enum: ['already_complete', 'added_missing_parts', 'skipped_no_wiki_link'] },
          note: { type: 'string' },
        },
      },
    },
  },
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const groupIndex = cfg.groupIndex

phase('정직답변보강')
const result = await agent(`
너는 SEAGNAL 해양법률 위키의 "정직한 답변" 완성 사서다. H-30 기준(_SCHEMA.md §6-C)을 적용한다.

## 담당 리포트
${LEGAL}/_dashboard/collection_hole_reclass_report_g${groupIndex}.md

## 할 일
1. 리포트에서 **tag=a_genuine** 또는 **tag=b_structural**인 항목을 전부 찾아라(§5 법별 상세 절 또는 표를 참고).
2. 항목마다, 그 항목이 연결된 위키 개념/annex 페이지를 찾아 해당 서술을 확인해라. **H-30 3요건**이 이미 다 있으면(①위임체인 조문까지 명시 ②왜 이 이상은 답 못 하는지 정직한 문장 ③소관부서명+전화번호) status=already_complete로 넘어가라(손대지 마라).
3. 3요건 중 빠진 게 있으면 채워라:
   - **위임체인**: 감사·재검증 리포트에 이미 적혀 있는 조문(법→시행령→시행규칙→고시)을 그대로 옮기면 된다(지어내지 마라).
   - **경계선언**: a_genuine이면 "○○ 조문이 위임하는 하위 고시가 실제로 제정되지 않아 확인되지 않습니다"류, b_structural이면 "이 정보는 관보/지자체 조례 등 별도 시스템 소관이라 이 위키가 직접 확인할 수 없습니다"류로 **정직하게** — 없는 걸 지어내지 않는다.
   - **소관부서 연락처**: \`${LEGAL}/_dashboard/contacts_collected.json\`을 Read해 그 법의 families(법률/시행령/시행규칙) 또는 행정규칙 키에서 관련 부서명·전화번호를 찾아 "자세한 사항은 ○○부(○○과, 전화번호)에 문의하세요"로 붙인다. 그 법의 키가 없거나 관련 부서를 못 찾으면 억지로 지어내지 말고 note에 "연락처 미확보"라고 정직 기록(그 부분만 빼고 나머지 2요건은 채운다).
4. 3요건이 다 채워지면(H-30 기준 충족), 그 서술이 이제 "확인 안 됨"이 아니라 정상 답변임을 나타내도록 자연스럽게 다듬어라(예: "⚠확인불가"류 배너를 "○○ 사유로 원문에 없음(소관부서: XX, 전화 XX-XXX-XXXX)"로 정리). status 필드(canonical/draft)는 그대로 두되, 이 항목 자체는 이제 사용자에게 완전한 답이 되므로 draft 사유가 이 항목 하나뿐이었다면 canonical 승격을 고려해도 된다(다른 draft 사유가 남아있으면 그대로 draft 유지).
5. 그 항목이 어느 위키 페이지에도 연결돼 있지 않으면(감사가 구체 위치를 특정 못한 경우) status=skipped_no_wiki_link로 정직 기록, 억지로 새 페이지를 만들지 마라.
6. **자기 법 파일만 쓴다** — comparisons/·graph.json·.claude/ 금지(읽기만).

정직하게 — 연락처를 못 찾으면 지어내지 말고 note에 남겨라. 위임체인도 리포트에 없는 조문을 지어내지 마라.

반환(JSON): {group, checked(확인한 항목 수), items:[{law, item(간결 요약), status, note}]}
`, { schema: SCHEMA, phase: '정직답변보강', label: `graceful:g${groupIndex}`, effort: 'high' })

return result
