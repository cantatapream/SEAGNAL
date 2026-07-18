export const meta = {
  name: 'wiki-collect-fix-cell',
  description: '한 법의 미수집 원문(고시·행정규칙·시행령·시행규칙·별표·부칙·타법 거쳐가는 조문)을 law.go.kr DRF로 수집→raw 저장→위키 연결·소관부서 연락처 추가. 지자체 고시 등 수집곤란은 안내 대체, 판례·법리·다툼은 스코프 밖 정직표기. 완료 시 done 마커.',
  phases: [{ title: '수집수정', detail: '법당 1에이전트: DRF 수집 + 위키 연결 + 소관부서 + 마커' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const MARK = `${LEGAL}/_dashboard/fix3`

const SCHEMA = {
  type: 'object', required: ['law', 'status'],
  properties: {
    law: { type: 'string' }, status: { type: 'string' },      // done | partial | nothing_to_do
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
  `Bash로 \`test -f "${MARK}/${l.slug}__collect5.done" && echo DONE || echo TODO\` 실행. DONE이면 {done:true}, 아니면 {done:false}.`,
  { label: `dupechk:${l.name.slice(0, 8)}`, phase: '수집수정', model: 'sonnet', effort: 'low',
    schema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } } } })
if (dupe && dupe.done) { log(`이미 완료: 「${l.name}」`); return { law: l.name, status: 'already_done_skipped', marker_written: true } }

log(`수집+수정: 「${l.name}」`)
phase('수집수정')
const prompt = `너는 SEAGNAL 해양법률 위키 사서다. \`${LEGAL}/_SCHEMA.md\`(특히 0-A 수집 완결 규칙)와 \`${LEGAL}/_CHATBOT.md\`(특히 5절 답변 경계·소관부서 마무리)를 먼저 읽고 그 규칙을 그대로 따른다.

## 대상: 「${l.name}」 (raw: \`${l.raw}/\`, 위키 slug: \`${l.slug}__\`)

## 1단계 — 이 법의 감사파일에서 "수집 구멍/미반영"을 모은다
\`${LEGAL}/_dashboard/audit/${l.slug}.md\`를 Read. 가장 최근(5라운드) 섹션의 **collection_holes**와 **wiki_gaps** 중 "raw 미수집/미확보/미반영/재수집" 성격을 뽑는다.

## 2단계 — 수집 가능한 것은 law.go.kr DRF로 실제 수집 (OC=hyoo1431)
Bash \`curl\`로 국가법령정보센터 Open API를 쓴다. 핵심 레시피:
- **법령 본문**(시행령·시행규칙·타법): \`lawSearch.do?OC=hyoo1431&target=law&type=JSON&query=<법령명>\` → 결과의 MST → \`lawService.do?OC=hyoo1431&target=law&MST=<MST>&type=JSON\` (조문 전문).
- **행정규칙(고시·훈령·예규)**: \`lawSearch.do?OC=hyoo1431&target=admrul&type=JSON&query=<고시명>\` → LID/일련번호 → \`admRulService.do?OC=hyoo1431&target=admrul&LID=<id>&type=JSON\`.
- **별표(텍스트)**: 위 응답의 별표 텍스트를 그대로. **별표가 이미지뿐이면**: \`admRulJoListTreeRInc.do?admRulSeq=<ID>&section=By\`로 bylSeq 목록 → \`admRulBylContentsInfoR.do?bylSeq=<bylSeq>\`가 주는 \`flDownload.do?flSeq=<id>\` 이미지를 받아 **너의 비전으로 OCR** 전사(수치·표 정확히).
- 받은 원문은 \`${l.raw}/\` 아래 알맞은 파일(예 \`행정규칙_<고시명>.txt\`, \`시행령.txt\`, \`별표/<이름>.txt\`)로 저장(⚠REVIEW 헤더 붙임, 원문 불변).
- **타법 라인**: 기준법(또는 그 시행령·시행규칙)이 위임·인용해 타고 나간 다른 법은 → 그 타법 원문 확보하되 위키는 **실제 타고 들어간 그 조문까지만** 연결하고, 그 조문이 다시 요구하는 별표·고시가 있으면 거기까지 수집. 타법 전체를 개념화하지 말 것.

## 3단계 — 위키에 반영 (실제 수정)
수집한 내용을 이 법의 해당 \`wiki/concepts/${l.slug}__*.md\` 페이지에 **연결·반영**(출처: 법령 제N조/고시명, 시행일). 처벌·금액·수치는 (출처)·⚠REVIEW 표기.

## 4단계 — 소관부서·연락처 (답변 마무리용, _CHATBOT.md 5-4)
DRF 응답의 **소관부처명**(및 법령정보센터/원문에 연락처가 있으면 전화번호)을 이 법 statute 또는 대표 concept 페이지 상단 메타에 \`소관부서:\`·\`연락처:\`로 추가(연락처 미상이면 "소관부서명만, 전화는 확인불가"로 정직 표기).

## 5단계 — 수집 곤란/스코프 밖 처리
- **지자체 고시 등 수집 곤란**: 억지로 수집하지 말 것. 위키에 "각 지자체 고시에 따름 · 세부는 관할 지자체 소관부서로 확인 권장"으로 안내 문구를 넣고 still_missing에 "수집곤란(지자체고시)"로 표기.
- **판례·법리·다툼의 여지·순수 원문공백**: 손대지 않는다(스코프 밖). out_of_scope에 적는다. 위키엔 이미 "규정없음/확인불가"면 그대로 둔다.

## 규율
- 🚫 **.claude/ 폴더 절대 금지**: '.claude/memory/MEMORY.md' 등 어떤 .claude/ 파일도 읽거나 쓰지 마라. 세션기억은 오케스트레이터 전용. 결과는 아래 JSON 반환값으로만.
- **환각 0**: DRF로 실제 받은 원문만 반영. 못 받았으면 지어내지 말고 still_missing.
- **외과수술식**: 이 법 관련 파일(raw/<이 법>, wiki/${l.slug}__*, log.md, index.md)만. 무관 파일 금지.
- 네트워크가 막히면(프록시 502/거부) 그 항목은 still_missing에 "DRF 접속실패"로 정직 표기하고 넘어간다.

## 완료 표시 (필수)
Bash로 \`mkdir -p ${MARK} && printf '%s\\n' "collect5 done $(date -u +%FT%TZ)" > "${MARK}/${l.slug}__collect5.done"\`.
반환(JSON): law, status(done|partial|nothing_to_do), collected[], wiki_linked[], contact_added(bool), guided_uncollectable[], out_of_scope[], still_missing[], files_touched[], marker_written(true).

정직하게. 수집 가능한 건 실제로 받아서 위키에 반영하고, 불가능한 건 안내로 대체, 스코프 밖은 손대지 않는다.`

const res = await agent(prompt, { label: `collect:${l.name.slice(0, 10)}`, phase: '수집수정', model: 'sonnet', effort: 'high', schema: SCHEMA })
return res || { law: l.name, status: 'agent_null' }
