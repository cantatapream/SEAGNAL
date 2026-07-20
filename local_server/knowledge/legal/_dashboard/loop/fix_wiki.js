export const meta = {
  name: 'wiki-fix',
  description: '감사 리포트 기반 위키 수정·보완: 없는 페이지 생성·얇은 페이지 심화·수집구멍 원문반영·답변방식 준수',
  phases: [{ title: '수정보완', detail: '법마다 에이전트가 audit 리포트대로 위키를 고침' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const SCHEMA = {
  type: 'object', required: ['law', 'fixed'],
  properties: {
    law: { type: 'string' },
    fixed: { type: 'integer' },                                    // 손본 파일 수
    created_pages: { type: 'array', items: { type: 'string' } },   // 새로 만든 개념
    deepened_pages: { type: 'array', items: { type: 'string' } },  // 심화한 개념
    holes_filled: { type: 'array', items: { type: 'string' } },    // 반영한 별표·고시 수치
    still_missing: { type: 'array', items: { type: 'string' } },   // 원문 자체가 없어 재수집 필요
    method_fixes: { type: 'array', items: { type: 'string' } },    // 답변방식(차수표·프로필컬럼 등) 보정
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 사서다. \`${LEGAL}/_SCHEMA.md\`와 \`${LEGAL}/_CHATBOT.md\`를 먼저 읽어 형식·규칙(정의우선·처벌 조·항·호·금액·행정처분 1~4차·타법연결·프로필 조건컬럼·출처)을 숙지한다.

## 임무: 「${l.name}」의 위키를 **감사 리포트대로 수정·보완**한다.

## 1) 감사 리포트 읽기 (필수)
\`${LEGAL}/_dashboard/audit/${l.slug}.md\`를 Read로 정독한다. 여기에 이 법의 구멍이 판정별(❌missing/⚠thin/📛collection_hole/〰awkward)로, 그리고 답변방식 준수 미흡(method_notes)이 적혀 있다. 이걸 작업 목록으로 삼는다.

## 2) 자료 (직접 Read/Grep)
- 위키: \`${LEGAL}/wiki/concepts/${l.slug}__*.md\`
- 원문: \`${l.raw}/\` 의 법률.txt·시행령.txt·시행규칙.txt·별표/(파일 \`{법률|시행령|시행규칙}_별표N.txt\`)·행정규칙(고시)/

## 3) 수정 규칙 (감사 판정별)
- **❌ missing (페이지 없음)**: 해당 조문·주제를 읽고 개념 페이지를 **새로 만든다**(스키마 3절 형식, 파일명 \`${l.slug}__<주제>.md\`).
- **⚠ thin (얇음/부정확)**: 그 페이지를 **원문으로 다시 채워 깊게** 만든다.
- **📛 collection_hole (원문 수치 미반영)**: 별표·고시 txt가 raw에 **있으면** 그 수치를 해당 개념에 **그대로 인용해 채운다**. raw에 **없으면**(진짜 미수집) 고치지 말고 \`still_missing\`에 "무엇을 어디서 수집해야 하는지" 적는다.
- **〰 awkward (깨진 링크·구조)**: 깨진 \`[[링크]]\` 대상이 없으면 만들거나 올바른 대상으로 고친다.
- **답변방식 미흡(method_notes)**: 행정처분 차수표(1~4차) 누락→별표에서 채움, 프로필 조건컬럼(톤수·조업형태) 누락→적용범위 표에 추가, 벌칙 항별 구간 분리, 출처(제N조·시행일) 보강.

## 4) 원칙 (카파시)
- 감사가 지적한 것만 고친다(외과수술식). 멀쩡한 페이지는 건드리지 않는다.
- 지어내지 않는다. 원문에 없으면 still_missing으로 남기고 REVIEW.
- 처벌은 조·항·호·금액 그대로.

반환(JSON): law, fixed(손본 파일수), created_pages[], deepened_pages[], holes_filled[], still_missing[], method_fixes[].`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.listPath && cfg.idx !== undefined) {
  const boot = await agent(
    `\`${cfg.listPath}\`(JSON: {"laws":[...]})를 Read로 읽어 반환: {laws: 그 배열의 인덱스 ${cfg.idx}번 원소 **하나만** 담은 길이1 배열(객체 그대로, 가공 금지)}.`,
    { label: `boot-${cfg.idx}`, phase: '수정보완', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON: {"0":[...],"1":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로, 필터·가공 금지)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '수정보완', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`수정·보완 대상 ${laws.length}개 법 (Sonnet)`)
phase('수정보완')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `fix:${l.name.slice(0, 12)}`, phase: '수정보완', model: 'sonnet', effort: 'high', schema: SCHEMA })
))).filter(Boolean)
return {
  fixed_laws: res.length,
  files_touched: res.reduce((s, r) => s + (r.fixed || 0), 0),
  created: res.reduce((s, r) => s + (r.created_pages || []).length, 0),
  deepened: res.reduce((s, r) => s + (r.deepened_pages || []).length, 0),
  holes_filled: res.reduce((s, r) => s + (r.holes_filled || []).length, 0),
  still_missing: res.flatMap(r => (r.still_missing || []).map(m => `${r.law}: ${m}`)),
}
