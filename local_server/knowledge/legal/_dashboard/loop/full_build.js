export const meta = {
  name: 'maritime-full-depth-build',
  description: '풀 깊이 빌드(Sonnet 5): 법당 전 주제 concept 완비(스로틀 제거)',
  phases: [{ title: '풀깊이빌드', detail: '법마다 Sonnet 에이전트가 모든 규제 주제를 concept로' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const SCHEMA = `${LEGAL}/_SCHEMA.md`

const MAN = {
  type: 'object', required: ['law', 'pages', 'concepts'],
  properties: {
    law: { type: 'string' }, pages: { type: 'integer' },
    concepts: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' } } } },
    reviews: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } } } },
    glossary: { type: 'array', items: { type: 'object', properties: { term: { type: 'string' }, concept: { type: 'string' } } } },
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 사서다. \`${SCHEMA}\`를 먼저 읽는다(정의 우선·멀티홉·처벌 3축 정확한 항·호·금액·예외 4출처·완성도 기준). 모르면 지어내지 말고 REVIEW.

## 임무: 「${l.name}」을 **풀 깊이로 완전 분해**한다 (2~4개 상한 없음).
이 법의 **사용자(어민·낚시인·레저인·사업자)가 실제로 물을 모든 규제 주제**를 각각 독립 concept 페이지로 만든다. 정의허브·허가/면허/신고 종류별·주요 의무·금지/제한·구역·처벌체계·검사/절차 등 — 있는 만큼 전부(대개 8~20개).

## 자료 (직접 Read/Grep)
- raw: \`${l.raw}\` 의 ${l.txt.map(t => '`' + t + '`').join(', ')}
- 별표: \`${l.raw}/별표/\` (파일 \`{법률|시행령|시행규칙}_별표N.txt\`)
- **고시**: \`${l.raw}/행정규칙/\` (있으면) — "고시로 정한다" 위임 세부기준·수치를 여기서 채워 구멍 없이 완성
- 인용 타법이 \`${LEGAL}/raw/\` 하위에 있으면 그 조문도 실제로 읽어 정의 확정(멀티홉)

## 산출물
- 각 주제를 \`${LEGAL}/wiki/concepts/${l.slug}__<주제슬러그>.md\`로 (스키마 3절 개념 형식). 파일명 반드시 \`${l.slug}__\` 접두어. 이미 있는 파일이면 더 깊게 갱신.
- 처벌은 정확한 조·항·호·금액(뭉개기 금지). 별표 행정처분은 1/2/3/4차 그대로. 고시 수치 반영.
- 모든 서술에 출처(법령/고시 제N조, 시행일). AI 연결부는 (※) 표기 또는 reviews.

반환: law, pages(작성 파일수), concepts[{path,title}], reviews[{title,detail}], glossary[{term,concept}](구어 있으면).`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (cfg.dataPath) {
  const grp = (cfg.groupIndex !== undefined) ? ` 그리고 group==${cfg.groupIndex}` : ''
  const boot = await agent(
    `\`${cfg.dataPath}\`(JSON {all:[{name,slug,domain,tier,txt,raw,group}]})를 Read로 읽어 반환: {laws: all 중 tier==1${grp}인 것 전부(객체 그대로)}.`,
    { label: `boot-g${cfg.groupIndex ?? '?'}`, phase: '풀깊이빌드', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`풀깊이 빌드 대상 ${laws.length}개 (Sonnet 5)`)
phase('풀깊이빌드')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `build:${l.name.slice(0, 12)}`, phase: '풀깊이빌드', model: 'sonnet', effort: 'high', schema: MAN })
))).filter(Boolean)
return {
  built: res.length, pages: res.reduce((s, m) => s + (m.pages || 0), 0),
  concepts: res.reduce((s, m) => s + (m.concepts || []).length, 0),
  laws: res.map(m => m.law),
}
