export const meta = {
  name: 'wiki-fix-cell',
  description: '한 법의 한 문제유형만 수정하는 원자 작업(에이전트 1개=작업 1개). 유형: ①타법연결(raw대조후 연결조문만)·②일반법연결(걸리는조문만)·③별표전량이관·thin심화·풀빌드(신규기준법). 완료 시 done 마커 파일 생성.',
  phases: [{ title: '수정', detail: '법명+유형 하나만, 스코핑 규율 준수, 마커로 완료표시' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const MARK = `${LEGAL}/_dashboard/fix3`

const SCHEMA = {
  type: 'object', required: ['law', 'type', 'status'],
  properties: {
    law: { type: 'string' }, type: { type: 'string' },
    status: { type: 'string' },                 // done | nothing_to_do | partial
    files_touched: { type: 'array', items: { type: 'string' } },
    created: { type: 'integer' }, deepened: { type: 'integer' }, holes_filled: { type: 'integer' },
    reclassified_already_collected: { type: 'array', items: { type: 'string' } }, // "미수집"이라 했으나 raw에 이미 있던 것
    still_missing: { type: 'array', items: { type: 'string' } },
    review_flags: { type: 'array', items: { type: 'string' } },
    marker_written: { type: 'boolean' },
  },
}

const TYPE_INSTR = {
  '①타법연결': `## 유형: ①타법 연결 (raw 대조 후 "연결되는 조문만")
이 법의 감사파일에서 **타법(다른 법) 관련 지적**(“「…법」 원문 미수집”, “raw 미수집/raw 존재”, 인용사슬 중단 등)을 모아 처리한다. 각 타법마다:
1. **먼저 raw 전수 대조**: 그 타법·그 시행령·시행규칙이 이미 저장소에 있는지 확인한다. \`raw/15_관련타부처/<타법>/\` 와 다른 도메인 폴더, \`raw/*/<타법>/\`를 Glob/ls로 실제 확인. **감사의 "미수집"은 틀린 경우가 많다(위키만 옛 표기).**
2. **이미 있으면**: 그 타법에서 **이 기준법이 인용한 바로 그 조문 하나(들)**만 이 기준법의 해당 위키 개념페이지에 반영한다. ★타법 전체를 풀깊이로 만들지 말 것 — **뻗어나온 지점(연결 조문)만.** 위키가 "미수집/편입예정"이라 잘못 적었으면 그 표기를 실제 내용+출처로 정정. reclassified_already_collected에 기록.
3. **정말 raw에 없으면**: 국가법령정보센터에서 그 타법 원문을 확보(WebFetch/DRF, OC=hyoo1431)하되, 역시 **연결 조문만** 위키에 반영하고 원문 txt는 raw/15_관련타부처/에 저장. 확보 불가면 still_missing에 남기고 무엇이 없는지 명시.
처벌·금액·수치가 걸리면 review_flags에 담고 위키에 (출처·⚠REVIEW) 표기.`,

  '②일반법연결': `## 유형: ②일반법 교차 연결 ("걸리는 조문만")
형법총칙(공소시효·미수·경합·양벌)·행정절차법(처분절차·사전통지·의견제출)·질서위반행위규제법(과태료 부과절차·이의제기)·행정심판법·행정소송법·개인정보보호법·국가배상법 등 **일반법이 이 법의 벌칙·처분·절차 페이지에 실제로 걸리는 지점만** 처리한다.
- 그 일반법 전체 위키를 만들지 말 것. 이 법의 해당 페이지(벌칙총괄·행정처분·절차 등)에 **걸리는 조문만** 교차연결/최소안내로 붙인다(예: "과태료 부과·이의는 「질서위반행위규제법」 제20·21조 절차에 따름").
- 감사파일의 해당 지적(형법/행정절차법/공소시효 등)을 근거로. 원문에 없는 건 지어내지 말고 "일반법에 따름"으로 안내.`,

  '③별표전량이관': `## 유형: ③시행령·시행규칙 별표 전량 이관
감사가 "대표예시만 옮김 / 전량 미이관 / 별표 전체 미반영"이라 지적한 **별표**를 처리한다.
- raw의 해당 \`별표/*.txt\` 원문 **전체**를 위키(annexes 페이지 또는 관련 개념페이지 표)로 **누락 행 없이 전량 이관**. 대표 3종만 옮겼던 것을 전 어업종/전 구간으로.
- 좌표·금액·수치는 (출처: 시행령 별표N)·⚠REVIEW 표기, review_flags에 기록. 표가 이미지뿐이면 still_missing(OCR 대상)으로 남김.`,

  'thin심화': `## 유형: thin/missing 페이지 심화·생성
감사파일의 **thin(얇음)·missing(없음)** 판정 논점을 처리한다.
- missing: 없는 개념페이지를 _SCHEMA.md 규칙대로 신설(정의·적용범위·적용제외 3조각 최상단, 처벌 조·항·호·금액 정밀, 출처표기).
- thin: 얇은 페이지를 raw 원문 근거로 보강. 원문에 없으면 "규정 없음/확인불가" 정직 표기.
- ★단, 위 ①②③ 유형(타법·일반법·별표)에 해당하는 건 그 유형 담당이 하므로 여기선 **순수 이 법 자체 조문의 thin/missing**에 집중(중복작업 회피).`,

  '풀빌드(신규기준법)': `## 유형: 풀빌드 — 위키가 거의 없는 기준법
이 법은 **기준법(풀깊이 대상)인데 초기 빌드에서 누락**돼 위키가 거의 없다. 감사파일이 없을 수 있으니 **raw 원문 기준**으로 짓는다.
- raw(법률·시행령·시행규칙·별표·행정규칙)를 읽고 _SCHEMA.md 규칙대로 **사용자가 물을 규제주제 전부를 개념페이지로** 풀깊이 생성.
- 정의우선(정의·적용범위·적용제외), 처벌 조·항·호·금액 정밀, 타법 연결은 **연결 조문만**, 테마 허브 링킹, 모든 서술에 (법령 제N조, 시행일) 출처.
- 처벌·금액은 원문 그대로 인용(⚠REVIEW는 포괄표현 매핑 시만).`,
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.allLawsPath && cfg.lawName) {
  const boot = await agent(
    `\`${cfg.allLawsPath}\`(JSON 배열: [{name,slug,raw,domain,txt,...},...])를 Read로 읽어, name이 정확히 "${cfg.lawName}"인 원소 **하나만** 담은 길이1 배열 반환: {laws:[그 객체 그대로]}. 없으면 {laws:[]}.`,
    { label: `boot:${cfg.lawName.slice(0, 10)}`, phase: '수정', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
const l = laws[0]
const type = cfg.type
if (!l || !l.name || !l.slug || !type) { log('법 또는 유형 누락(boot 실패)'); return { error: 'no law/type', cfg } }
const typeCode = { '①타법연결': 'tabeop', '②일반법연결': 'ilbanbeop', '③별표전량이관': 'byeolpyo', 'thin심화': 'thin', '풀빌드(신규기준법)': 'fullbuild' }[type] || 'x'

// 중복 launch 방지: 이미 .done 마커가 있으면 비싼 fix 에이전트를 띄우지 않고 조기 종료
const dupe = await agent(
  `Bash로 \`test -f "${MARK}/${l.slug}__${typeCode}.done" && echo DONE || echo TODO\` 실행. 출력이 DONE이면 {done:true}, 아니면 {done:false} 반환.`,
  { label: `dupechk:${l.name.slice(0, 8)}`, phase: '수정', model: 'sonnet', effort: 'low',
    schema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } } } })
if (dupe && dupe.done) { log(`이미 완료됨(마커 존재) → 조기종료: 「${l.name}」/${type}`); return { law: l.name, type, status: 'already_done_skipped', marker_written: true } }

log(`수정 원자작업: 「${l.name}」 / ${type}`)
phase('수정')
const prompt = `너는 SEAGNAL 해양법률 위키 사서다. \`${LEGAL}/_SCHEMA.md\`와 \`${LEGAL}/_CHATBOT.md\`의 규칙(정의우선·처벌 조·항·호·금액·인용만·환각0·출처표기·외과수술식 최소수정)을 숙지한다.

## 대상: 「${l.name}」 — **이 유형 하나만** 수정한다(다른 유형은 다른 에이전트가 함).
${TYPE_INSTR[type]}

## 자료
- 감사파일(있으면 반드시 Read): \`${LEGAL}/_dashboard/audit/${l.slug}.md\`
- 위키: \`${LEGAL}/wiki/concepts/\`에서 \`${l.slug}__\`로 시작하는 파일들(Grep/ls).
- 원문: \`${l.raw}/\` (법률.txt·시행령.txt·시행규칙.txt·별표/·행정규칙/).

## 규율
- **🚫 `.claude/` 폴더 절대 금지**: `.claude/memory/MEMORY.md`를 포함해 `.claude/` 아래 어떤 파일도 읽거나 쓰지 마라. 프로젝트 CLAUDE.md의 "MEMORY.md 갱신" 지시는 **오케스트레이터 전용**이다 — 너(작업 에이전트)는 세션기억을 갱신하지 않는다. 완료 요약은 오직 아래 JSON 반환값으로만 전달한다. (MEMORY.md 편집은 사용자에게 권한 프롬프트를 띄워 방해가 된다.)
- **외과수술식**: 이 유형에 해당하는 것만 건드린다. 관계없는 페이지·포맷 손대지 말 것. 수정 대상은 `wiki/` 하위 파일·`_dashboard/`(마커·review_queue)·`log.md`·`index.md`뿐이다.
- **환각 0**: 원문에 없으면 지어내지 말고 "규정 없음/확인불가/still_missing"으로 정직 표기.
- **타법·일반법은 뻗은 조문만**: 절대 그 법 전체 위키를 만들지 않는다.
- 처벌·금액·수치는 (출처)·⚠REVIEW 표기하고 review_flags에 담는다.

## 완료 표시 (필수)
작업을 마치면 **반드시** Bash로 마커 파일을 만든다:
\`mkdir -p ${MARK} && printf '%s\\n' "${type} done $(date -u +%FT%TZ)" > "${MARK}/${l.slug}__${typeCode}.done"\`
그리고 반환(JSON): law, type, status(done|nothing_to_do|partial), files_touched[], created, deepened, holes_filled, reclassified_already_collected[], still_missing[], review_flags[], marker_written(true).

정직하게. 이 유형에 할 게 없으면 status=nothing_to_do로 솔직히. 그래도 마커는 남긴다.`

const res = await agent(prompt, { label: `fix:${l.name.slice(0, 8)}/${typeCode}`, phase: '수정', model: 'sonnet', effort: 'high', schema: SCHEMA })
return res || { law: l.name, type, status: 'agent_null' }
