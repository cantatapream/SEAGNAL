const path = require('path');
export const meta = {
  name: 'wiki-scope-map-cell',
  description: '한 기준법의 원문(법률·시행령·시행규칙)을 직접 훑어 수집해야 할 "가지 전체"를 누락 없이 도출: 내부 위임(시행령/시행규칙/고시/별표) + 타법 인용조문 + 그 조문이 요구하는 별표·고시까지. 각 항목이 raw에 이미 있는지/미수집인지 대조해 수집 대상 매니페스트 생성. 완료 시 마커.',
  phases: [{ title: '범위확정', detail: '법당 1에이전트: 원문 참조사슬 전수추출 + raw 대조 + 매니페스트 저장' }],
}
const LEGAL = path.resolve(__dirname, '../..')
const MARK = `${LEGAL}/_dashboard/fix3`
const SCOPE = `${LEGAL}/_dashboard/scope`

const SCHEMA = {
  type: 'object', required: ['law', 'counts'],
  properties: {
    law: { type: 'string' },
    counts: {  // 얼마나 수집해야 하는가 — 정확한 숫자
      type: 'object',
      properties: {
        시행령조문: { type: 'integer' }, 시행규칙조문: { type: 'integer' },
        별표: { type: 'integer' }, 고시행정규칙: { type: 'integer' },
        타법인용조문: { type: 'integer' },
        미수집_시행령시행규칙: { type: 'integer' }, 미수집_별표: { type: 'integer' },
        미수집_고시: { type: 'integer' }, 미수집_타법: { type: 'integer' },
      },
    },
    missing_items: { type: 'array', items: { type: 'string' } }, // 미수집 항목 구체 목록(수집 지시서)
    have_items: { type: 'array', items: { type: 'string' } },    // 이미 보유(확인만)
    uncollectable: { type: 'array', items: { type: 'string' } }, // 지자체 고시 등 수집곤란(안내 대체 예정)
    manifest_file: { type: 'string' },
    marker_written: { type: 'boolean' },
  },
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.allLawsPath && cfg.lawName) {
  const boot = await agent(
    `\`${cfg.allLawsPath}\`(JSON 배열: [{name,slug,raw,domain,...},...])를 Read로 읽어, name이 정확히 "${cfg.lawName}"인 원소 하나만 담은 길이1 배열 반환: {laws:[그 객체]}. 없으면 {laws:[]}.`,
    { label: `boot:${cfg.lawName.slice(0, 10)}`, phase: '범위확정', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
const l = laws[0]
if (!l || !l.name || !l.slug) { log('법 누락'); return { error: 'no law', cfg } }

const dupe = await agent(
  `Bash로 \`test -f "${MARK}/${l.slug}__scope.done" && echo DONE || echo TODO\`. DONE이면 {done:true} 아니면 {done:false}.`,
  { label: `dupechk:${l.name.slice(0, 8)}`, phase: '범위확정', model: 'sonnet', effort: 'low',
    schema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } } } })
if (dupe && dupe.done) { log(`이미 완료: 「${l.name}」`); return { law: l.name, status: 'already_done_skipped', marker_written: true } }

log(`수집범위 확정: 「${l.name}」`)
phase('범위확정')
const prompt = `너는 SEAGNAL 해양법률 위키의 수집설계자다. 목표: 「${l.name}」이 **수집해야 할 원문 가지 전체**를 원문에서 직접 훑어 **누락 없이** 도출하고, 각 가지가 raw에 이미 있는지/없는지 대조해 **정확한 수집 대상 목록(매니페스트)**를 만든다. 수집은 다음 단계에서 한다 — 여기서는 "얼마나·무엇을" 수집할지를 확정만 한다.

## 대상 raw: \`${l.raw}/\`  (법률.txt·시행령.txt·시행규칙.txt·별표/·행정규칙/·_meta.json)

## 1단계 — 원문 3종을 Read하고 참조를 전수 추출 (가지 타기)
법률.txt·시행령.txt·시행규칙.txt를 **끝까지** 읽고, 아래 참조를 **하나도 빠짐없이** 뽑는다(Grep로 교차검증):
- **내부 위임**: "대통령령으로 정한다/정하는"(→시행령 해당 조문), "해양수산부령·총리령으로 정한다"(→시행규칙), "고시/훈령/예규로 정한다", "장관이 정하여 고시"(→행정규칙), "별표N", "부칙".
- **타법 인용**: 본문에 나오는 모든 「○○법」·「○○에 관한 법률」과 그 **인용 조문(제N조)**. 각 타법은 **그 인용된 조문까지** 타고 가고, **그 조문이 다시 요구하는 별표·고시**가 있으면 그것도 가지에 포함(1-hop + 그 조문의 부속). 타법 전체를 통째로 넣지는 말 것.

## 2단계 — raw 대조 (있나 없나)
각 가지에 대해 \`${l.raw}/\`(및 시행령·시행규칙·별표·행정규칙 폴더)와 \`${LEGAL}/raw/15_관련타부처/\`, \`${LEGAL}/raw/_stub/\`를 Glob/ls로 실제 확인해 **보유/미수집**을 판정한다. (파일명이 달라 놓치는 경우가 많으니 내용까지 확인)

## 3단계 — 수집곤란 표시
각 지자체 홈페이지에만 있는 **지자체 고시**처럼 국가법령정보센터로 수집이 곤란한 것은 uncollectable에 넣는다(다음 단계에서 안내로 대체, _CHATBOT.md 5-3).

## 4단계 — 매니페스트 저장 + 마커
- \`${SCOPE}/${l.slug}.md\`에 저장: 표 형식으로 [가지유형 | 항목(조문/별표/고시/타법조문) | 보유여부 | 미수집시 수집경로(DRF target·검색어)]. 이게 다음 수집단계의 지시서다.
- Bash로 \`mkdir -p ${MARK} ${SCOPE} && printf 'scope done %s\\n' "$(date -u +%FT%TZ)" > "${MARK}/${l.slug}__scope.done"\`.
- 반환(JSON): law, counts{시행령조문,시행규칙조문,별표,고시행정규칙,타법인용조문, 미수집_시행령시행규칙,미수집_별표,미수집_고시,미수집_타법}, missing_items[](구체 수집지시), have_items[], uncollectable[], manifest_file, marker_written(true).

## 규율
- 🚫 **.claude/ 폴더 절대 금지**(MEMORY.md 등). 결과는 JSON 반환·매니페스트 파일로만.
- **정확·누락 0이 최우선.** 추측 금지 — 원문에 실제로 있는 참조만. 애매하면 missing_items에 "확인필요"로 표기.
- 수집·위키수정은 하지 않는다(이 셀은 범위 확정 전용). raw/wiki 원문을 바꾸지 말 것. 오직 \`${SCOPE}/\` 매니페스트와 마커만 쓴다.`

const res = await agent(prompt, { label: `scope:${l.name.slice(0, 10)}`, phase: '범위확정', model: 'sonnet', effort: 'high', schema: SCHEMA })
return res || { law: l.name, status: 'agent_null' }
