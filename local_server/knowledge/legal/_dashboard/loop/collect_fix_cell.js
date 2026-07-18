export const meta = {
  name: 'wiki-collect-fix-cell',
  description: '한 법의 scope 매니페스트(_dashboard/scope/<slug>.md)를 체크리스트로 삼아 "미수집" 항목을 하나하나 law.go.kr DRF로 수집→raw 저장→위키 연결·소관부서 연락처 추가하고, 각 항목이 실제로 수집됐는지 대조검증. 지자체 고시/조례는 안내 대체, 판례·법리·다툼은 스코프 밖 정직표기. 완료 시 done 마커.',
  phases: [{ title: '수집검증', detail: '법당 1에이전트: 매니페스트 체크리스트대로 DRF 수집 + 위키 연결 + 소관부서 + 항목별 대조 + 마커' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const MARK = `${LEGAL}/_dashboard/fix3`
const SCOPE = `${LEGAL}/_dashboard/scope`

const SCHEMA = {
  type: 'object', required: ['law', 'status'],
  properties: {
    law: { type: 'string' }, status: { type: 'string' },      // done | partial | nothing_to_do | no_manifest
    manifest_items_total: { type: 'integer' },                 // 매니페스트가 지시한 미수집 항목 수(체크리스트 길이)
    checklist: {                                               // 항목별 대조검증 결과(리스트 하나하나 확인)
      type: 'array',
      items: {
        type: 'object', required: ['item', 'result'],
        properties: {
          item: { type: 'string' },                           // 매니페스트의 미수집 항목
          result: { type: 'string' },                         // collected | already_present | failed | uncollectable | out_of_scope
          saved_to: { type: 'string' },                       // 저장 경로(수집 성공 시)
          note: { type: 'string' },                           // 실패사유·안내대체 등
        },
      },
    },
    collected: { type: 'array', items: { type: 'string' } },   // 새로 수집한 원문(고시/시행령/별표/타법조문)
    wiki_linked: { type: 'array', items: { type: 'string' } }, // 위키에 연결·반영한 지점
    contact_added: { type: 'boolean' },                        // 소관부서·연락처 메타 추가 여부
    guided_uncollectable: { type: 'array', items: { type: 'string' } }, // 지자체고시 등 안내대체 처리
    out_of_scope: { type: 'array', items: { type: 'string' } },         // 판례·법리·다툼·원문공백(손 안 댐)
    still_missing: { type: 'array', items: { type: 'string' } },
    files_touched: { type: 'array', items: { type: 'string' } },
    marker_written: { type: 'boolean' },
  },
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.allLawsPath && cfg.lawName) {
  const boot = await agent(
    `\`${cfg.allLawsPath}\`(JSON 배열: [{name,slug,raw,domain,...},...])를 Read로 읽어, name이 정확히 "${cfg.lawName}"인 원소 **하나만** 담은 길이1 배열 반환: {laws:[그 객체 그대로]}. 없으면 {laws:[]}.`,
    { label: `boot:${cfg.lawName.slice(0, 10)}`, phase: '수집수정', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
const l = laws[0]
if (!l || !l.name || !l.slug) { log('법 누락(boot 실패)'); return { error: 'no law', cfg } }

const dupe = await agent(
  `Bash로 \`test -f "${MARK}/${l.slug}__collect6.done" && echo DONE || echo TODO\` 실행. DONE이면 {done:true}, 아니면 {done:false}.`,
  { label: `dupechk:${l.name.slice(0, 8)}`, phase: '수집검증', model: 'sonnet', effort: 'low',
    schema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } } } })
if (dupe && dupe.done) { log(`이미 완료: 「${l.name}」`); return { law: l.name, status: 'already_done_skipped', marker_written: true } }

log(`수집검증: 「${l.name}」`)
phase('수집검증')
const prompt = `너는 SEAGNAL 해양법률 위키 사서다. \`${LEGAL}/_SCHEMA.md\`(특히 0-A 수집 완결 규칙)와 \`${LEGAL}/_CHATBOT.md\`(특히 5절 답변 경계·소관부서 마무리)를 먼저 읽고 그 규칙을 그대로 따른다.

## 대상: 「${l.name}」 (raw: \`${l.raw}/\`, 위키 slug: \`${l.slug}__\`)

## 0단계 — 체크리스트(매니페스트)를 읽는다 = 이번 작업의 지시서
\`${SCOPE}/${l.slug}.md\`를 **반드시 Read**한다. 이 매니페스트의 표에서 **보유여부가 "미수집"인 모든 행**이 네가 수집해야 할 체크리스트다(각 행에 "수집경로: DRF target·검색어"가 적혀 있다). 매니페스트가 없으면 status="no_manifest"로 반환하고 종료.
- 각 미수집 항목을 하나씩 처리하고, 처리 결과를 **checklist[]에 항목별로** 기록한다(item + result: collected|already_present|failed|uncollectable|out_of_scope + saved_to + note). **누락 없이 매니페스트 미수집 행 수만큼** 기록한다.

## 1단계 — 각 미수집 항목을 law.go.kr DRF로 실제 수집 (OC=hyoo1431)
먼저 대상 경로에 **이미 파일이 있는지 확인**(다른 셀이 먼저 수집했을 수 있음 — 특히 \`raw/15_관련타부처/\` 공용 타법). 있으면 그 조문이 실제 들어있는지 grep으로 확인 후 result="already_present". 없으면 Bash \`curl\`로 국가법령정보센터 Open API 수집:
- **법령 본문**(시행령·시행규칙·타법): \`lawSearch.do?OC=hyoo1431&target=law&type=JSON&query=<법령명>\` → MST → \`lawService.do?OC=hyoo1431&target=law&MST=<MST>&type=JSON\` (조문 전문). 타법은 **인용된 그 조문만 발췌** 저장(전체 개념화 금지).
- **행정규칙(고시·훈령·예규)**: \`lawSearch.do?OC=hyoo1431&target=admrul&type=JSON&query=<고시명>\` → LID/일련번호 → \`admRulService.do?OC=hyoo1431&target=admrul&LID=<id>&type=JSON\`. **구 고시가 폐지·대체됐으면 현행본**을 받는다.
- **별표(텍스트)**: 응답의 별표 텍스트 그대로. **이미지뿐이면**: \`admRulJoListTreeRInc.do?admRulSeq=<ID>&section=By\`로 bylSeq → \`admRulBylContentsInfoR.do?bylSeq=<bylSeq>\`의 \`flDownload.do?flSeq=<id>\` 이미지를 받아 **너의 비전으로 OCR** 전사(수치·표 정확히).
- 받은 원문은 매니페스트가 지정한 경로(예 \`${l.raw}/행정규칙/<고시명>.txt\`, \`raw/15_관련타부처/<법명>/법률_발췌.txt\`)로 저장(⚠REVIEW 헤더, 원문 불변). 타법 발췌는 **기존 발췌 파일이 있으면 이어붙이고 기존 인용출처는 지우지 말 것**.

## 2단계 — 위키에 반영 (실제 수정)
수집한 내용을 이 법의 \`wiki/concepts/${l.slug}__*.md\`에 **연결·반영**(출처: 법령 제N조/고시명, 시행일). 처벌·금액·수치는 (출처)·⚠REVIEW 표기. 타법은 **실제 타고 들어간 그 조문까지만** 연결.

## 3단계 — 소관부서·연락처 (답변 마무리용, _CHATBOT.md 5-4)
DRF 응답의 **소관부처명**(연락처가 있으면 전화번호)을 이 법 statute 또는 대표 concept 상단 메타에 \`소관부서:\`·\`연락처:\`로 추가(전화 미상이면 "소관부서명만, 전화 확인불가"로 정직 표기).

## 4단계 — 수집 곤란/스코프 밖 처리 (매니페스트 uncollectable + 발견분)
- **지자체 고시·조례 등 수집 곤란**: 억지 수집 금지. 위키에 "각 지자체 고시·조례에 따름 · 세부는 관할 지자체 소관부서로 확인 권장" 안내를 넣고 checklist result="uncollectable", guided_uncollectable[]에 기록.
- **판례·법리·다툼·순수 원문공백**: 손대지 않음(스코프 밖). checklist result="out_of_scope", out_of_scope[]에 기록.

## 규율
- 🚫 **.claude/ 폴더 절대 금지**: 어떤 .claude/ 파일도 읽거나 쓰지 마라. 결과는 아래 JSON 반환값으로만.
- **환각 0**: DRF로 실제 받은 원문만 반영. 못 받았으면 지어내지 말고 checklist result="failed"(note에 사유).
- **외과수술식**: 이 법 관련 파일(raw/<이 법>, 공용 타법 raw/15_관련타부처/<법명>, wiki/${l.slug}__*, log.md, index.md)만. 무관 파일 금지.
- 네트워크가 막히면(프록시 502/거부) 그 항목 result="failed", note="DRF 접속실패".

## 완료 표시 (필수)
Bash로 \`mkdir -p ${MARK} && printf '%s\\n' "collect6 done $(date -u +%FT%TZ)" > "${MARK}/${l.slug}__collect6.done"\`.
반환(JSON): law, status(done|partial|nothing_to_do|no_manifest), manifest_items_total(int), checklist[](항목별 대조검증 — 누락 없이), collected[], wiki_linked[], contact_added(bool), guided_uncollectable[], out_of_scope[], still_missing[], files_touched[], marker_written(true).

정직하게. 매니페스트 체크리스트를 하나하나 밟아 수집·반영하고, 각 항목이 실제로 됐는지 checklist에 대조 기록한다.`

const res = await agent(prompt, { label: `collect:${l.name.slice(0, 10)}`, phase: '수집검증', model: 'sonnet', effort: 'high', schema: SCHEMA })
return res || { law: l.name, status: 'agent_null' }
