// lint_xref.js — 보강 린트: 타법연결 표의 "평문 우리70법 인용"을 [[링크]]로 전환 + 잔여 dangling 수리.
// 역할(초보자용): 위키의 가장 조문-밀도 높은 자산인 "## 타법 연결" 표는 다른 법을 「법명」 텍스트로만 적어
//   신경망(그래프)에 안 들어가 있다. 각 법이 **자기 페이지의 타법연결 표에서 우리 70법 인용을 [[링크]]로 바꾸고**,
//   자기 페이지의 깨진 링크(형식오류·약칭·접두누락·외부법 미태그)를 고친다. 자기 파일만 쓰므로 병렬 안전.
// [연계] 입력 wiki/**(자기법, 읽기) + all_laws.json(70법명) + lint_verify.json(dangling 목록) · 출력 자기법 페이지 링크
// [로드 순서] Workflow. 전수린트(lint_full) 후, 7차 감사 전. graph.json은 별도 파이썬 재생성.

export const meta = {
  name: 'maritime-lint-xref',
  description: '보강 린트: 타법연결 표 평문인용을 [[링크]]로 전환 + 잔여 dangling 수리(자기 법 파일만=병렬안전)',
  phases: [{ title: '보강린트', detail: '법별 1에이전트: 타법연결 표 링크화 + dangling 수리' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const ALL = '/tmp/claude-0/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/scratchpad/all_laws.json'

const SCHEMA = {
  type: 'object', required: ['law', 'status'],
  properties: {
    law: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'nochange', 'failed'] },
    xref_links_added: { type: 'integer', description: '타법연결 표 평문→[[링크]] 전환 수' },
    dangling_fixed: { type: 'integer', description: '깨진 링크 수리(형식·약칭·접두·편입예정 태그)' },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 **보강 린트 사서**다. 담당 법의 "타법연결 표"에 텍스트로만 있는 우리 위키 법 인용을 [[링크]]로 바꿔 신경망에 편입하고, 자기 페이지의 깨진 링크를 고친다. **자기 법 파일만** 쓴다(다른 법·graph.json·comparisons 신규생성·.claude 금지 — 읽기만).

## 담당 법: 「${l.name}」 (slug: ${l.slug})
- 내 법 페이지: \`ls ${LEGAL}/wiki/concepts/${l.slug}__*.md\` + \`${LEGAL}/wiki/statutes/${l.slug}.md\`

## 0) 먼저 읽을 것
- \`${ALL}\`(Read) — 우리 위키 70개 법의 {name, slug} 목록. **여기 있는 법명만 "우리 법"**이고 [[링크]] 대상이다. 목록에 없는 법(민법·형법·국토기본법 등 외부법)은 [[링크]] 대상 아님.

## 1) 타법연결 표 링크화 (핵심 — 조문별 신경망 편입)
- 내 법 페이지의 \`## 타법 연결\` 표(및 \`관련 개념\`/본문의 명확한 조문 교차참조)에서 **「우리70법명」이 평문으로만** 적혀 있고 그 법으로의 [[링크]]가 그 행/문장에 없으면, 법명을 [[링크]]로 전환한다.
  - **착지점 선택(환각 금지, ls로 실존 확인)**: 그 법의 **정의허브/정의및적용범위 개념**이 있으면 그리로(\`[[대상slug__정의및적용범위]]\` 등), 없으면 **항상 존재하는** \`[[statutes/대상slug]]\`(=법 전체 페이지)로. **특정 개념 페이지명을 지어내지 말 것** — 조문이 명확히 어떤 개념을 가리키면 그 개념 페이지가 실재할 때만 그리로, 애매하면 statutes/로.
  - 표 셀의 조문 텍스트(제N조)·준용유형·서술은 **그대로 두고**, 법명 부분만 [[링크]]로 감싼다(외과수술식). 예: \`「선박안전법」 제6조\` → \`[[statutes/선박안전법|선박안전법]] 제6조\`.
- 🚫 **변경이력(로그) 표의 과거 기록**과 순수 서술 프로즈의 스치는 언급은 링크화하지 말 것(과잉연결 방지 — 카파시 단순함). **타법연결 표·정밀 조문 교차참조만** 대상.

## 2) 잔여 dangling 수리 (자기 페이지)
- \`grep -o '\\[\\[[^]]*\\]\\]' 내파일\`로 링크를 뽑아 대상 실존을 ls로 확인. 유형별 처리:
  - **형식오류** \`[[statute.법명]]\`·\`[[statute.법명|별칭]]\` → 대상이 실존하면 \`[[statutes/법명|별칭]]\`로 정정.
  - **약칭·오탈자**(예: [[농수산물의원산지표시법]]) → 정식 파일명으로 정정(ls로 확인).
  - **접두 누락**(bare 개념명, 예: [[실태조사]]) → 실존하면 \`[[대상slug__개념]]\` 풀네임으로.
  - **외부법·미생성 대상**(우리70법 아님, 파일 없음) → 지우지 말고 \`[[대상]](편입예정)\` 표기.
- annexes/·draft/·activities/ 폴더에 실존하는 별표·활동 링크는 dangling 아님(손대지 말 것).

## 3) 규칙
- 🚫 **자기 법 파일만 쓴다.** 다른 법 파일·comparisons/·graph.json·_glossary·.claude/ 금지(읽기만).
- 환각 0: 실존 확인된 파일로만 링크. 애매하면 statutes/ 또는 (편입예정). 본문 서술 불변.
- 완료 후 Bash 마커: \`printf 'r7 xref\\n' > ${LEGAL}/_dashboard/fix3/xref_r7_${l.slug}.done\`.

## 4) 반환(JSON): law, status, xref_links_added, dangling_fixed, note.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON {"0":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '보강린트', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`보강린트(타법연결 링크화) 대상 ${laws.length}법`)
phase('보강린트')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `xref:${l.name.slice(0, 12)}`, phase: '보강린트', model: 'sonnet', effort: 'medium', schema: SCHEMA })
))).filter(Boolean)

return {
  linted: res.filter(r => r.status === 'done' || r.status === 'partial').length,
  total: laws.length,
  xref_links: res.reduce((s, r) => s + (r.xref_links_added || 0), 0),
  dangling: res.reduce((s, r) => s + (r.dangling_fixed || 0), 0),
  notes: res.filter(r => r.note).map(r => `${r.law}: ${r.note}`).slice(0, 10),
}
