export const meta = {
  name: 'maritime-wiki-topicmap',
  description: '풀 깊이 사이징: 핵심법 65개 각각의 전체 개념 주제 목록을 추출(스로틀 제거)',
  phases: [{ title: '주제지도', detail: '법마다 필요한 전 주제를 열거(현재 있는 것/없는 것 표시)' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const SCHEMA = `${LEGAL}/_SCHEMA.md`

const TMAP = {
  type: 'object', required: ['law', 'topics', 'total'],
  properties: {
    law: { type: 'string' },
    total: { type: 'integer', description: '이 법이 풀 깊이로 가질 개념 페이지 총수' },
    have: { type: 'integer', description: '현재 이미 있는 수' },
    topics: {
      type: 'array',
      items: {
        type: 'object', required: ['title', 'jo', 'exists'],
        properties: {
          title: { type: 'string', description: '개념 페이지 제목(사용자가 물을 규제 주제)' },
          jo: { type: 'string', description: '근거 조문(대표)' },
          kind: { type: 'string', description: '정의허브|의무|허가신고|금지|안전장비|처벌|구역|절차 등' },
          exists: { type: 'boolean', description: '현재 위키에 이미 있는지' },
        },
      },
    },
  },
}

function prompt(law) {
  return `너는 SEAGNAL 해양법률 위키의 **주제 설계 사서**다. \`${SCHEMA}\`의 '완성도 기준'을 읽는다(핵심: 답 조각이 미리 다 연결돼 쌓여 있어야 함 — 얕게 요약 금지).

## 임무: 「${law.name}」을 **풀 깊이로 분해했을 때 필요한 개념 페이지 전체 목록**을 뽑아라.
지금 이 법은 개념 페이지가 ${law.cur_concepts}개뿐이다(1차 골격, 의도적으로 얕게 잡음). 이제 **상한 없이**, 사용자(어민·낚시인·레저인·사업자)가 실제로 물을 **모든 규제 주제**를 열거한다.

## 방법
1. raw 원문을 읽는다: \`${law.raw}\`의 ${law.txt.map(t => '`' + t + '`').join(', ')} + 별표 목록 \`${law.raw}/별표/_links.json\`.
2. 법 전체를 훑어 **독립된 개념 페이지로 만들 가치가 있는 규제 주제**를 모두 찾는다. 기준:
   - 정의 허브(제2조 핵심 용어), 각 **허가/면허/신고/등록** 종류별, 주요 **의무**(안전·설비·보고·표시), **금지·제한 행위**, **구역/해역**(좌표·지정), **처벌 체계**(별도 페이지 가치 있으면), **절차**(검사·청문·과징금) 등.
   - 하나의 주제가 톤수·조업형태·지역으로 갈리면 그 자체가 개념 페이지의 예외 표로 들어가므로 **주제 단위로만** 센다(너무 잘게 쪼개지 말 것).
3. 이미 있는 페이지(현재 ${law.cur_concepts}개)는 \`${LEGAL}/wiki/concepts/${law.slug}__*\`를 Grep으로 확인해 exists=true로 표시.

## 반환(구조화)
law, total(풀 깊이 총 페이지 추정), have(현재 수), topics[{title, jo(근거조문), kind, exists}]. 페이지를 **생성하지 말고 목록만** 반환한다. 지어내지 말고 실제 조문에 근거한 주제만.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (cfg.dataPath) {
  const boot = await agent(
    `\`${cfg.dataPath}\` (JSON 배열: [{name,slug,raw,txt,tier,cur_concepts}])을 Read로 읽어 그대로 반환하라. 가공·요약 없이 배열을 통째로.`,
    { label: 'bootstrap', phase: '주제지도', schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } }, effort: 'low' })
  if (boot) laws = boot.laws || []
}
phase('주제지도')
const maps = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `map:${l.name.slice(0, 12)}`, phase: '주제지도', schema: TMAP, effort: 'low' })
))).filter(Boolean)

const grand = maps.reduce((s, m) => s + (m.total || 0), 0)
const have = maps.reduce((s, m) => s + (m.have || 0), 0)
return {
  laws: maps.length,
  current_pages: have,
  full_depth_total: grand,
  new_pages_needed: grand - have,
  per_law: maps.map(m => ({ law: m.law, have: m.have, total: m.total, new: (m.total || 0) - (m.have || 0) })).sort((a, b) => b.new - a.new),
}
