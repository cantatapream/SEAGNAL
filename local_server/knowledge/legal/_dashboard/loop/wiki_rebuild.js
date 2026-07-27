// wiki_rebuild.js — 새로 수집된 raw(별표 이미지판독·별표·신규 고시/타법)를 반영해 법별 위키를 재빌드한다.
// 역할(초보자용): 기존 위키(5라운드 감사 정제분)를 참조하며, 현재 raw 전량을 다시 읽어 각 법의 statute 허브+
//   concept 페이지를 최신화한다. 감사로 다듬은 제약(⚠REVIEW·감사지적 반영)은 보존하고, 새 데이터(별표 수치·
//   별표83·신규 고시·타법 발췌)와 새 규칙(별표 이미지 이중처리·최종확인일·국제협약 링크·판례 참고)을 더한다.
// [연계] 입력 raw/**(현재 전량) + wiki/(기존 concept) · 규칙 _SCHEMA.md·_CHATBOT.md · 출력 wiki/{statutes,concepts}
// [로드 순서] Workflow 단독. phase②·이미지OCR·별표 수집 이후. args.only(slug) 파일럿 / args.group 배치.
// 안전: 각 에이전트가 자기 법의 파일만 씀(법별 concept 접두어 slug__) = 병렬 안전. 공유 허브(glossary/graph)는 종합단계 단독.

export const meta = {
  name: 'maritime-wiki-rebuild',
  description: '현재 raw(별표 수치·신규 고시) 반영해 법별 위키 재빌드(감사정제 보존)',
  phases: [{ title: '재빌드', detail: '법별 1에이전트: 기존 concept 참조+현재 raw로 최신화' }],
}

const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const DATA = `${LEGAL}/_dashboard/loop/build_data.json`

const MANIFEST = {
  type: 'object',
  required: ['law', 'status', 'pages_written'],
  properties: {
    law: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'failed'] },
    statute_path: { type: 'string' },
    concepts_updated: { type: 'number' },
    concepts_created: { type: 'number' },
    byl_numbers_added: { type: 'number', description: '별표 이미지판독 수치를 반영한 건수' },
    new_gosi_reflected: { type: 'number' },
    pages_written: { type: 'integer' },
    reviews: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } } } },
    note: { type: 'string' },
  },
}

function rebuildPrompt(law) {
  const hint = law.hint ? `\n## 0-A) 이번에 raw에서 구체적으로 바뀐 부분(우선 확인)\n${law.hint}\n` : ''
  return `너는 SEAGNAL 해양법률 위키의 **재빌드 사서**다. 담당 법의 위키를 현재 raw 기준으로 최신화한다.
${hint}

## 0) 반드시 먼저 읽을 것
1. \`${LEGAL}/_SCHEMA.md\` — 사서 스키마(절대 규칙). 특히 최근 추가된 규칙을 빠짐없이 적용:
   - **별표 이미지 이중처리(0-A)**: raw 조문에 \`【이미지판독 N】\` 블록으로 이미지 속 표·수치가 들어와 있다. 그 **수치를 concept에 반영**한다(예: 공급전압·치수·기준값). 도해(그림)는 원본이미지 경로(_이미지/N.png)를 메타로 남겨 챗봇이 띄우게 한다.
   - **소관부서·연락처** 메타, **서식 다운로드** 메타, **국제협약 근거·링크**(SOLAS 등 언급 시), **판례변동 플래그**(해석 다툼 여지), **최종확인일**: frontmatter \`updated: 2026-07-18\`.
2. \`${LEGAL}/_CHATBOT.md\` 5절(답변 경계·소관부서 마무리·서식·이미지·최종확인일).

## 1) 담당 법
- 법령명: **${law.name}** / slug: ${law.slug} / 소관: ${law.soban} / tier: ${law.tier}
- raw 폴더: \`${law.raw}\` — **하위 전부 다시 읽어라**: 법률.txt·시행령.txt·시행규칙.txt·별표/(별표 텍스트, 【이미지판독】 포함)·행정규칙/(고시)·기타 하위폴더(예: 지정교육기관기준_별표 등 신규 수집분).

## 2) 재빌드 절차 (기존 정제 보존 + 새 데이터 반영)
1. **기존 위키를 먼저 읽는다**: \`ls ${LEGAL}/wiki/concepts/${law.slug}__*.md\` 와 \`${LEGAL}/wiki/statutes/${law.slug}.md\`. 각 파일의 구조·**감사로 다듬어진 제약(⚠REVIEW·"감사 지적 반영"·정직표기)을 보존**한다(지우지 말 것).
2. **현재 raw를 다시 읽어** 각 concept/허브를 최신화한다:
   - 별표 \`【이미지판독】\` 수치가 그 개념의 의무·기준이면 **본문에 수치로 반영**(⚠REVIEW 붙은 값은 그대로 ⚠REVIEW 유지).
   - phase②에서 새로 들어온 **행정규칙(고시)·타법 발췌**를 해당 개념에 연결·반영.
   - 신규 하위 별표(예: 지정교육기관 별표)가 있으면 해당 개념(예: 교육기관 지정)에 인덱스·수치 반영.
3. 개념 페이지 고정 형식(정의→적용범위·제외→예외→의무→위반시처벌(조·항·호·금액/형량 정확)→벌칙체계→행정처분(별표 1~4차)→근거조문→타법연결→관련개념→변경이력) 유지.
4. **누락 개념 생성**: 현재 raw에 사용자 의무가 명백한데 개념이 없으면 새로 만든다(tier1은 적극적으로).
5. 모든 서술에 출처(제N조, 시행일). 출처 없는 문장 금지. frontmatter \`updated: 2026-07-18\`, \`소관부서\`·\`연락처\` 유지·보완.

## 3) 규칙
- **환각 0**: raw에 없는 수치·조문 지어내지 말 것. 【이미지판독】의 (판독불명)은 그대로 표기.
- **외과수술식**: 멀쩡한 정제 서술을 이유 없이 바꾸지 말 것. 새 데이터 반영·형식 보정·수치 갱신에 집중.
- 🚫 **.claude/ 절대 금지.** wiki/·(필요시)draft/ 안에서만. 공유 허브(_glossary·graph.json)는 만지지 말 것(종합 단계에서 단독 처리).
- 방대한 별표를 통째 옮기지 말고 **사용자에게 의미 있는 것**(처벌·설비·구역·서식·수치) 중심 인덱스.

## 4) 반환(JSON)
law, status, statute_path, concepts_updated, concepts_created, byl_numbers_added(별표 수치 반영 건수), new_gosi_reflected, pages_written, reviews[{title,detail}], note.`
}

// ---- 실행 ----
let cfg = args || {}
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch (e) { cfg = {} } }

// 법 목록 로드(에이전트가 build_data.json 읽음 — 스크립트는 파일 못 읽음)
const onlySlug = cfg.only || null
const groupIdx = (cfg.group !== undefined && cfg.group !== null) ? cfg.group : null
const slugsArg = Array.isArray(cfg.slugs) ? cfg.slugs : null
const BOOT = { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } }
const filt = slugsArg ? `slug이 다음 목록에 있는 것 전부: ${JSON.stringify(slugsArg)}`
  : onlySlug ? `slug이 "${onlySlug}"인 것 1개만`
  : (groupIdx !== null ? `group 필드가 정확히 ${groupIdx}인 것 전부` : '전부')
const boot = await agent(
  `\`${DATA}\` 파일(JSON)을 Read로 읽어라. 구조 {all:[{name,slug,domain,tier,soban,byl,txt,raw,group}], ...}.
반환(JSON): { laws: all 중 ${filt}(해당 객체를 필드 그대로, 가공·요약·생략 없이) }.`,
  { label: `boot`, phase: '재빌드', schema: BOOT, effort: 'low' })
let laws = (boot && boot.laws) || []
if (cfg.hints) {
  laws = laws.map(law => ({ ...law, hint: cfg.hints[law.slug] || null }))
}
log(`재빌드 대상 ${laws.length}개 법 (only=${onlySlug}, group=${groupIdx}, slugs=${slugsArg ? slugsArg.length : null})`)

phase('재빌드')
const manifests = (await parallel(laws.map(law => () =>
  agent(rebuildPrompt(law), { label: `rebuild:${law.name.slice(0, 12)}`, phase: '재빌드', schema: MANIFEST, effort: 'medium' })
))).filter(Boolean)

return {
  rebuilt: manifests.filter(m => m.status === 'done').length,
  partial: manifests.filter(m => m.status === 'partial').length,
  total: laws.length,
  pages: manifests.reduce((s, m) => s + (m.pages_written || 0), 0),
  byl_numbers: manifests.reduce((s, m) => s + (m.byl_numbers_added || 0), 0),
  detail: manifests.map(m => ({ law: m.law, status: m.status, upd: m.concepts_updated, new: m.concepts_created, byl: m.byl_numbers_added })),
}
