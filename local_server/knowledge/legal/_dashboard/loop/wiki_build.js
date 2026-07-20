export const meta = {
  name: 'maritime-wiki-build',
  description: '해양법률 raw → 위키 페이지를 다수 에이전트로 병렬 구축(동일 _SCHEMA.md 지침)',
  phases: [
    { title: '구축', detail: '법령별 1개 에이전트: statute 허브 + 핵심 concept 페이지 작성' },
    { title: '종합', detail: 'glossary 병합·비교표 클러스터·대시보드 인덱스' },
  ],
}

const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const SCHEMA = `${LEGAL}/_SCHEMA.md`

const MANIFEST = {
  type: 'object',
  required: ['law', 'statute_path', 'concepts', 'glossary', 'comparisons', 'reviews', 'pages_written'],
  properties: {
    law: { type: 'string' },
    statute_path: { type: 'string', description: '작성한 statute 허브 페이지 절대경로' },
    concepts: { type: 'array', items: { type: 'object', required: ['path', 'title'],
      properties: { path: { type: 'string' }, title: { type: 'string' }, topic: { type: 'string' } } } },
    glossary: { type: 'array', description: '구어→개념 라우팅 후보',
      items: { type: 'object', required: ['term', 'concept'],
      properties: { term: { type: 'string' }, concept: { type: 'string' }, note: { type: 'string' } } } },
    comparisons: { type: 'array', description: '타법과 같은 주제를 다르게 규정 → 비교표 후보',
      items: { type: 'object', required: ['topic'],
      properties: { topic: { type: 'string' }, reason: { type: 'string' } } } },
    reviews: { type: 'array', description: '처벌 금액/형량·안전장비·톤수 등 사람확인 필요 플래그',
      items: { type: 'object', required: ['title', 'detail'],
      properties: { title: { type: 'string' }, detail: { type: 'string' } } } },
    pages_written: { type: 'integer' },
  },
}

function rawIndexBlock(index) {
  if (!index || !index.length) return ''
  const lines = index.map(x => `- ${x.name} (tier${x.tier}) → \`${x.raw}\``).join('\n')
  return `\n## 0-B) raw에 이미 수집된 법령 목록 (타법 사슬 교차참조용)
아래 법이 담당 법 조문에서 「」로 인용되면, "편입 예정"으로 미루지 말고 **해당 raw 폴더의 조문 txt를 직접 열어 정의·예외를 읽어와** 페이지에 반영한다(멀티홉 정의 사슬, 예: 제주도 본도 누락 방지). 목록에 없는 법만 "편입 예정 [[링크]]" + reviews 기록.
${lines}\n`
}

function buildPrompt(law, index) {
  const tierNote = law.tier === 1
    ? '이 법은 **1군 핵심법**(해수부/해경 소관). statute 허브 + 사용자(어민·낚시인·레저인)가 실제로 물을 **핵심 규제 주제 2~4개**를 concept 페이지로 완비한다.'
    : '이 법은 **2군 참조법**. statute 허브(정의·적용범위·이 법이 다른 해양법에 인용되는 지점 중심)만 작성하고, concept은 명백히 사용자 대상 의무가 있을 때만 0~1개.'
  return `너는 SEAGNAL 해양법률 위키의 **사서(Ingest 에이전트)**다. 아래 지침을 그대로 따른다.

## 0) 반드시 먼저 읽을 것 (동일 지침)
1. \`${SCHEMA}\` — 사서 스키마 전문. **이것이 절대 규칙이다.** 특히: 정의 우선(0순위), 정의 사슬 멀티홉(타법 인용은 링크만 걸지 말고 조문 실제로 읽기), 완성도 기준, 처벌 3축(벌칙/과태료/행정처분) 정확한 항·호·금액/형량, 예외 4출처(본문단서/위임/별표/지역), 개념 페이지 고정 형식(정의→적용범위·제외→예외→의무→위반시처벌→벌칙체계4-B→행정처분체계4-C→근거조문→타법연결→관련개념→변경이력).
2. 골드스탠다드 견본(이 수준 이상으로 만든다): \`${LEGAL}/draft/concept_음주운항.md\`(처벌 3축 실증), \`${LEGAL}/draft/concept_어선등록검사.md\`(정의 허브+타법사슬).
${rawIndexBlock(index)}

## 1) 담당 법령
- 법령명: **${law.name}** / 소관: ${law.soban} / tier: ${law.tier} / 별표수: ${law.byl}
- raw 폴더: \`${law.raw}\`
  - 조문 텍스트: ${law.txt.map(t => '`' + t + '`').join(', ')}
  - 별표: \`${law.raw}/별표/\` (파일명 규약: \`{법률|시행령|시행규칙}_별표N.txt\`, 다운로드 링크는 \`별표/_links.json\`)
${tierNote}

## 2) 작업 순서
1. 스키마·견본을 읽는다.
2. 담당 법의 조문 텍스트를 읽어 **정의(제2조 등)·적용범위·적용제외**를 먼저 확정한다.
3. **처벌 조문(벌칙·과태료 조)과 별표(행정처분 세부기준)** 를 찾아 정확한 **조·항·호·금액/형량**을 뽑는다. "(벌칙)"·"과태료 등"처럼 뭉개지 않는다. 같은 벌칙 조문도 항마다 금액이 다르면 해당 항을 명시. 행정처분은 별표에서 1/2/3/4차 escalation 표를 그대로 옮긴다.
4. 조문 속 「」로 인용된 **타법**은 링크만 걸지 말고, 그 법이 raw에 있으면(\`${LEGAL}/raw/\` 하위) 실제 조문을 읽어 정의/예외를 가져온다. 없으면 "편입 예정 [[링크]]"로 남기고 reviews에 기록.
5. 예외는 4출처(본문단서/시행령·시행규칙 위임/별표/지역) 모두 훑어 하나의 "예외 규정" 표로 모은다.

## 3) 산출물 (파일 직접 작성)
- **statute 허브**: \`${LEGAL}/wiki/statutes/${law.slug}.md\`
  - frontmatter(id: statute.${law.slug}, status: draft, updated: 2026-07-14, tier: ${law.tier}, 소관: ${law.soban})
  - 섹션: # 법령명 / ## 정의(핵심 용어 표) / ## 적용범위·제외 / ## 핵심 의무 조문(표) / ## 위반 시 처벌(벌칙) / ## 과태료 / ## 행정처분 체계(별표 기반, 있으면) / ## 별표 인덱스(번호·제목·다운로드링크) / ## 타법 연결 / ## 관련 개념([[링크]]) / ## 변경 이력
- **concept 페이지**(위 tier 지침 개수): \`${LEGAL}/wiki/concepts/${law.slug}__<주제슬러그>.md\`
  - 스키마 3절 "개념 페이지 고정 형식" 그대로. 파일명은 반드시 \`${law.slug}__\` 접두어로 시작(충돌 방지).
- 모든 서술에 출처(법령명 제N조, 시행일) 표기. 출처 없는 문장 금지. AI가 연결·종합한 부분은 문서 안에 (※연결: ...) 또는 reviews에 남긴다.

## 4) 반환(구조화 JSON)
파일을 다 쓴 뒤 manifest를 반환한다: law, statute_path, concepts[{path,title,topic}], glossary[{term,concept,note}](이 법과 관련된 구어·별칭이 있으면), comparisons[{topic,reason}](다른 해양법과 같은 주제를 다르게 규정해 비교표가 필요하면), reviews[{title,detail}](처벌 금액/형량·안전장비·톤수 변경 또는 포괄준용·미확인 타법), pages_written(작성 파일 총수).

주의: 방대한 별표(수십~수백 개)를 전부 옮기지 말고, **사용자에게 의미 있는 별표(처벌기준·설비기준·구역·서식)** 중심으로 인덱스화한다. 정확성 > 분량.`
}

// ---- 실행 ----
let cfg = args || {}
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch (e) { cfg = {} } }
const doSynth = !!cfg.synthesize

let laws = cfg.laws || []
let rawIndex = cfg.rawIndex || []

// 부트스트랩: dataPath가 주어지면 파일에서 목록 로드(스크립트는 파일 못 읽으므로 에이전트로 읽음)
if (cfg.dataPath) {
  const BOOT = {
    type: 'object', required: ['laws', 'rawIndex'],
    properties: {
      laws: { type: 'array', items: { type: 'object' } },
      rawIndex: { type: 'array', items: { type: 'object' } },
    },
  }
  const excl = JSON.stringify(cfg.excludeSlugs || [])
  const grpFilter = (cfg.groupIndex !== undefined && cfg.groupIndex !== null)
    ? ` 그리고 group 필드가 정확히 ${cfg.groupIndex}인 것` : ''
  const boot = await agent(
    `\`${cfg.dataPath}\` 파일(JSON)을 Read로 읽어라. 구조: {all:[{name,slug,domain,tier,soban,byl,txt,raw,group}], rawIndex:[{name,tier,raw}]}.
반환(JSON): { laws: all 중 slug이 ${excl}에 없는 것${grpFilter} 전부(해당 객체를 필드 그대로), rawIndex: 파일의 rawIndex 배열 전체 그대로 }. 가공/요약/생략 없이 객체를 통째로 옮겨라. group 필터가 있으면 반드시 그 group 값만 포함.`,
    { label: `bootstrap-g${cfg.groupIndex ?? 'all'}`, phase: '구축', schema: BOOT, effort: 'low' })
  if (boot) { laws = boot.laws || []; rawIndex = boot.rawIndex || [] }
}
log(`구축 대상 ${laws.length}개 법령 (synthesize=${doSynth}, rawIndex=${rawIndex.length})`)

phase('구축')
const manifests = (await parallel(laws.map(law => () =>
  agent(buildPrompt(law, rawIndex), { label: `build:${law.name.slice(0, 12)}`, phase: '구축', schema: MANIFEST, effort: 'medium' })
))).filter(Boolean)

log(`구축 완료: ${manifests.length}/${laws.length}개 성공`)

let synthOut = null
if (doSynth && manifests.length) {
  phase('종합')
  // glossary/comparison/review 집계
  const gloss = manifests.flatMap(m => (m.glossary || []).map(g => ({ ...g, law: m.law })))
  // 모든 비교표 후보를 (법, 주제, 사유)로 평탄화 — 종합 에이전트가 의미 기반으로 테마 클러스터링
  const allComps = manifests.flatMap(m => (m.comparisons || []).map(c => ({ law: m.law, topic: (c.topic || '').trim(), reason: (c.reason || '').slice(0, 80) })))
  const reviews = manifests.flatMap(m => (m.reviews || []).map(r => ({ ...r, law: m.law })))
  const statutes = manifests.map(m => ({ law: m.law, path: m.statute_path, concepts: m.concepts || [] }))

  const synthPrompt = `너는 SEAGNAL 해양법률 위키의 **종합(synthesis) 사서**다. \`${SCHEMA}\`를 먼저 읽는다.
아래는 ${manifests.length}개 법령을 개별 에이전트가 구축한 결과 집계다. 이걸로 교차 산출물을 만든다.

### A. glossary 병합 → \`${LEGAL}/wiki/_glossary.md\`
기존 파일을 읽고, 아래 구어→개념 후보를 **중복 없이** 표에 추가(이미 있으면 skip). 표 형식 유지.
후보: ${JSON.stringify(gloss).slice(0, 6000)}

### B. ★ 교차 테마 허브 → \`${LEGAL}/wiki/comparisons/<테마슬러그>.md\` (스키마 '교차 테마 허브' 절 필독)
아래는 각 법 에이전트가 던진 **비교표 후보 전체**다. 주제 문구는 제각각이니 **뜻이 같으면 의미 기반으로 하나의 테마로 묶어라**(예: "구명조끼"·"인명안전장비"·"구명설비"는 같은 테마).
**반드시 만들 필수 테마 허브(후보가 적어도 생성)**: ①안전장구·구명설비 ②폐기물·해양오염 ③야간운항 장비 ④음주운항·측정거부 ⑤출항통제·기상특보 ⑥검사·등록 ⑦신고·허가·면허. 그 외 2법 이상 걸린 반복 고리도 허브로 추가.
각 허브: 스키마 4절 비교표(| 법령명 | 조문 | 적용대상(톤수·조업형태) | 요구사항 | 처벌 | 시행일 |) 골격 + 멤버 statute/concept 페이지를 [[링크]]로 모음 + **톤수·조업형태·지역 조건 컬럼**(프로필 필터용). 셀 확정 어려우면 REVIEW 표기. 이미 손으로 만든 야간운항 3법 비교(draft/)가 있으면 그걸 흡수/중복 금지.
비교표 후보 전체: ${JSON.stringify(allComps).slice(0, 9000)}

### C. 대시보드 인덱스 → \`${LEGAL}/_dashboard/build_index.md\`
전체 statute 허브 목록(법령명→경로)과 concept 페이지 수, 그리고 아래 REVIEW 플래그를 스키마 6절 포맷 요약표로 정리.
statutes: ${JSON.stringify(statutes).slice(0, 6000)}
reviews: ${JSON.stringify(reviews).slice(0, 6000)}

반환: 작성/수정한 파일 목록과 각 항목 수(glossary 추가수, 비교표 생성수, review 등록수)를 요약 텍스트로.`
  synthOut = await agent(synthPrompt, { label: 'synthesis', phase: '종합', effort: 'medium' })
}

return {
  built: manifests.length,
  total: laws.length,
  pages: manifests.reduce((s, m) => s + (m.pages_written || 0), 0),
  concepts: manifests.reduce((s, m) => s + (m.concepts || []).length, 0),
  reviews: manifests.reduce((s, m) => s + (m.reviews || []).length, 0),
  laws: manifests.map(m => m.law),
  synthesis: synthOut,
}
