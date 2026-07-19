// audit_fix_cell.js — 6차(직전) 감사 gap을 입력으로 각 법의 위키를 content+lint 동시 수정한다(H-7 통합수정).
// 역할(초보자용): 감사가 찾아준 구멍 목록을 읽고, 그 법의 위키를 고친다.
//   ① content: raw엔 있는데 위키에 안 실린 수치·조문(wiki_lag)을 본문/annex로 옮긴다.
//   ② lint(연결): 비대칭·허브미연결·타법미인용 등 연결결손을 [[링크]]·역링크·타법연결표로 꿰맨다.
//   진짜 수집구멍(raw 자체 없음)·스코프밖(판례·입법공백)은 건드리지 않고 기록만. ⚠REVIEW 미검증값은 승격 금지.
// [연계] 입력 _dashboard/audit/<slug>.md(직전 감사) + wiki/concepts/<slug>__*(기존) + raw · 규칙 _SCHEMA.md·_CHATBOT.md
// [로드 순서] Workflow/Agent. 감사 완료 후. 자율 트리거가 반복 호출(H-9). 공유허브(graph/glossary/comparisons)는 만지지 않음(단독 lint 단계).
// 안전(필수): 각 에이전트는 **자기 법의 파일만** 쓴다(wiki/concepts/<slug>__*, wiki/statutes/<slug>.md, wiki/annexes/<slug>__*).
//   🚫 절대 금지: graph.json·_glossary·comparisons/·.claude/ (공유·경합위험 → 별도 단독 단계).

export const meta = {
  name: 'maritime-audit-fix',
  description: '직전 감사 gap으로 법별 위키 content+lint 동시수정(H-7). 자기 법 파일만=병렬안전.',
  phases: [{ title: '통합수정', detail: '법별 1에이전트: 감사gap→wiki_lag 반영+연결결손 링크/허브/타법표 수정' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const MANIFEST = {
  type: 'object', required: ['law', 'status', 'edits'],
  properties: {
    law: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'nochange', 'failed'] },
    edits: { type: 'integer', description: '수정한 파일 수' },
    wiki_lag_fixed: { type: 'integer', description: 'raw→위키 반영(수치·조문 옮김) 건수' },
    links_added: { type: 'integer', description: '[[링크]]·타법연결·역링크 추가 건수' },
    concepts_created: { type: 'integer' },
    hub_needs: { type: 'array', items: { type: 'string' }, description: '공유허브(comparisons/정의허브) 신설 필요 목록 → 단독 lint 단계로 넘김' },
    collectable_holes: { type: 'array', items: { type: 'string' }, description: 'H-12③ 재수집 큐 대상: raw 미수집이나 **수집 가능**한 것(admrul 등재 고시·타법 거쳐간 조문·별표). 미제정·자치법규·원문자체부재는 제외(그건 left_alone).' },
    promoted_canonical: { type: 'integer', description: 'H-12② canonical로 승격한 페이지 수' },
    meta_review_flagged: { type: 'integer', description: 'H-12① 출처미확인으로 ⚠REVIEW 부착한 메타 필드 수' },
    left_alone: { type: 'array', items: { type: 'string' }, description: '손대지 않은 것(미제정·자치법규·원문부재 수집구멍·스코프밖·⚠REVIEW)과 사유' },
    important: { type: 'array', items: { type: 'string' }, description: '★사용자 에스컬레이션 대상만(엄격): ①시스템/아키텍처·데이터구조에 영향 ②사용자 결정이 반드시 필요(자동 판단 불가) ③수정·보완 범위를 넘어선 큰 문제. 일상적 gap(wiki_lag·연결·수집구멍·스코프밖)은 절대 넣지 말 것(로그만).' },
    note: { type: 'string' },
  },
}

function prompt(l, round) {
  return `너는 SEAGNAL 해양법률 위키의 **통합수정 사서**다. 직전 감사가 찾은 구멍을 content와 연결(lint)을 **동시에** 고쳐 메운다.

## 0) 반드시 먼저 읽을 것
1. \`${LEGAL}/_SCHEMA.md\`(사서 스키마·절대규칙: 정의우선·처벌 조항호금액·멀티홉 링크·환각0·별표 이미지 이중처리·⚠REVIEW·출처표기)
2. \`${LEGAL}/_CHATBOT.md\` 5절(답변경계·소관부서·서식·이미지·최종확인일)
3. **직전 감사 리포트**: \`${LEGAL}/_dashboard/audit/${l.slug}.md\` — 이 법의 gap·collection_hole·method_notes를 **전부 읽고** 유형분기한다.

## 1) 담당 법: 「${l.name}」  (slug: ${l.slug} · raw: ${l.raw})

## 2) 감사 gap 유형분기 → 고치기 (핵심)
감사 리포트의 각 gap을 아래로 분류해 처리:
- **wiki_lag(raw엔 있는데 위키 미반영)** → \`${l.raw}\` 원문(법률·시행령·시행규칙·별표·행정규칙)에서 그 수치·조문·별표를 찾아 **해당 concept 본문/annex에 정확히 옮긴다**(출처 제N조·시행일 필수). ⇒ content 수정.
- **연결결손(비대칭·허브미연결·타법미인용·정의사슬 미완)** → 해당 concept에 **\`[[링크]]\`·\`## 타법 연결\` 표 행·역링크(backlink)**를 추가한다. 타법 인용이면 그 조문을 실제로 읽어 내용까지 반영. ⇒ lint(연결) 수정.
- **누락 개념** → 사용자 의무가 명백한데 concept가 없으면 \`wiki/concepts/${l.slug}__<개념>.md\`를 **새로 만든다**(고정형식: 정의→적용범위·제외→예외→의무→위반시처벌(조·항·호·금액/형량)→벌칙체계→행정처분(별표 1~4차)→근거조문→타법연결→관련개념→변경이력).
- **진짜 수집구멍(raw 자체 없음)** → **건드리지 말고** left_alone에 기록(재수집 파이프라인 대상).
- **스코프밖(판례·법리·입법공백)** → left_alone에 기록.
- **⚠REVIEW 미검증값**(별표 이미지 OCR 판독 등) → canonical로 승격 금지. 그대로 ⚠REVIEW 유지. left_alone에 기록.

## 2-A) 메타 출처 검증 (H-12 ①, 필수)
- 담당 법 concept/statute의 frontmatter \`소관부서\`·\`연락처\`(부서명·전화번호)가 있으면, **raw(\`${l.raw}/_meta.json\`·법률/시행령/시행규칙.txt)에 그 값의 근거가 있는지 grep으로 대조**한다.
- **출처가 없으면 삭제하지 말고** 그 필드에 \`⚠REVIEW(출처미확인)\`를 부착한다(사람 검증 UI 대상). raw에 소관부처(예: 해양수산부)만 있고 부서명·전화번호가 없으면 그 세부값은 미확인이다. (재빌드 배치가 환각 주입한 정황 있음 — 스키마 9절 출처원칙 준수)

## 2-B) draft→canonical 승인 이원화 (H-12 ②, 필수)
- 담당 법의 concept 페이지 status를 다음 규칙으로 처리:
  - **처벌·과태료·형량·금액·안전수치·⚠REVIEW를 포함하는 페이지 = \`status: draft\` 유지**(반드시 사람 승인 — 건드리지 말 것).
  - **그 외 순수 정의·절차·서술 페이지 = 이번 통합수정으로 gap이 메워지고 출처가 갖춰졌으면 \`status: canonical\`로 승격**(변경이력에 "6R 검증·통합수정 통과로 canonical 승격" 근거 남김).
  - 애매하면 draft 유지(과대 승격 금지).

## 3) 절대 규칙
- 🚫 **자기 법 파일만 쓴다**: \`wiki/concepts/${l.slug}__*.md\`·\`wiki/statutes/${l.slug}.md\`·\`wiki/annexes/${l.slug}__*.md\`. 그 외(다른 법 파일·graph.json·_glossary·comparisons/·draft/·.claude/)는 **읽기만, 쓰기 금지**.
- **공유허브(comparisons 비교표·정의허브)가 필요하면 직접 만들지 말고 hub_needs에 기록** → 단독 lint 단계가 처리(경합위험).
- **환각 0**: raw에 없는 수치·조문 지어내지 말 것. 애매하면 ⚠REVIEW.
- **외과수술식**: 감사가 지목한 것만 고친다. 멀쩡한 서술 이유없이 바꾸지 말 것. 기존 정제·⚠REVIEW 유지.
- frontmatter \`updated: 2026-07-19\` 갱신.

## 4) 완료 마커 + 반환
- ★완료 마커(필수): Bash로 \`mkdir -p ${LEGAL}/_dashboard/fix3 && printf 'r${round} fixed\\n' > "${LEGAL}/_dashboard/fix3/fix_r${round}_${l.slug}.done"\` (자율 루프 상태추적용).
- 반환(JSON): law, status, edits, wiki_lag_fixed, links_added, concepts_created, hub_needs[], **collectable_holes[]**(H-12③ 수집가능한 미수집 원문), **promoted_canonical**(H-12② 승격 페이지수), **meta_review_flagged**(H-12① 출처미확인 REVIEW 부착수), left_alone[], important[], note.
  - **important[] 판단(엄격)**: 아래 3가지에만 넣는다. 그 외는 전부 빈배열(로그만, 사용자 안 알림):
    ①**시스템/아키텍처·데이터구조에 영향**(예: 스키마 자체가 틀림, 대량 파일 구조 재편 필요, 파이프라인 결함).
    ②**사용자 결정이 반드시 필요**(자동으로 못 정하는 정책 갈림 — 예: 상충하는 두 처벌 수치 중 무엇이 맞는지 원문으로 확정 불가, 안전값 모순).
    ③**수정·보완 범위를 넘어선 큰 문제**(단순 gap 메우기로 해결 안 되는 것).
    → wiki_lag·연결결손·수집구멍·스코프밖·⚠REVIEW 같은 **일상적 gap은 절대 important에 넣지 않는다**(left_alone/note로만).
정직하게 — 못 고친 건 left_alone에. 이 단계의 목적은 "고칠 수 있는 in-scope 구멍(wiki_lag·연결결손)"을 실제로 메우는 것이다.`
}

// ---- 실행 ----
let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const round = cfg.round || 7
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON: {"0":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '통합수정', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`통합수정 대상 ${laws.length}법 (round ${round})`)
phase('통합수정')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l, round), { label: `fix:${l.name.slice(0, 12)}`, phase: '통합수정', model: 'sonnet', effort: 'high', schema: MANIFEST })
))).filter(Boolean)

return {
  fixed: res.filter(r => r.status === 'done' || r.status === 'partial').length,
  total: laws.length,
  edits: res.reduce((s, r) => s + (r.edits || 0), 0),
  wiki_lag_fixed: res.reduce((s, r) => s + (r.wiki_lag_fixed || 0), 0),
  links_added: res.reduce((s, r) => s + (r.links_added || 0), 0),
  concepts_created: res.reduce((s, r) => s + (r.concepts_created || 0), 0),
  hub_needs: res.flatMap(r => (r.hub_needs || []).map(h => `${r.law}: ${h}`)),
  collectable_holes: res.flatMap(r => (r.collectable_holes || []).map(h => `${r.law}: ${h}`)),
  promoted_canonical: res.reduce((s, r) => s + (r.promoted_canonical || 0), 0),
  meta_review_flagged: res.reduce((s, r) => s + (r.meta_review_flagged || 0), 0),
  important: res.flatMap(r => (r.important || []).map(i => `${r.law}: ${i}`)),
  per_law: res.map(r => ({ law: r.law, status: r.status, edits: r.edits, lag: r.wiki_lag_fixed, links: r.links_added })),
}
