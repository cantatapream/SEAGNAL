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
const CONTACTS_FILE = `${LEGAL}/_dashboard/contacts_collected.json`
const REVIEW_QUEUE = `${LEGAL}/_dashboard/review_queue.md`

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
    collectable_holes: { type: 'array', items: { type: 'string' }, description: 'H-12③/H-26(c) 재수집 큐 대상: collection_hole 중 **수집 가능한데 아직 안 한 것**(admrul 등재 고시·타법 거쳐간 조문·별표). 미제정·구조적수집불가·자치법규는 제외(그건 left_alone).' },
    promoted_canonical: { type: 'integer', description: 'H-12② canonical로 승격한 페이지 수' },
    meta_review_flagged: { type: 'integer', description: 'H-12① 출처미확인으로 ⚠REVIEW 부착한 메타 필드 수' },
    // H-26(2026-07-26 사용자 확정) 추가 필드
    thin_reclassified: { type: 'integer', description: 'thin 중 wiki_lag/content_gap으로 원인 재분류·기록한 건수' },
    collection_hole_reclassified: { type: 'integer', description: 'collection_hole 중 genuine/structural/uncollected로 재분류한 건수' },
    awkward_fixed: { type: 'integer', description: '답변방식(점진공개·출처표기 등) 형식 위반 수정 건수' },
    scope_out_disclaimers_added: { type: 'integer', description: 'scope_out 질문에 "범위 밖/규정없음, 소관부서 문의" 안내문구를 새로 추가한 건수' },
    review_markers_added: { type: 'integer', description: 'review_queue.md 위치정보를 위키 본문 해당 문장 옆 인라인 ⚠REVIEW-XX 마커로 옮겨 단 건수' },
    contacts_added: { type: 'integer', description: '자동수집된 소관부서·전화번호를 프론트매터/타법연결 절에 반영한 건수' },
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

## 2-C) ★H-26(2026-07-26 사용자 확정) 판정 5종 재분류 — 이번 패스의 핵심 추가 임무
직전 감사 리포트(\`${LEGAL}/_dashboard/audit/${l.slug}.md\`)의 thin/collection_hole/awkward/scope_out을 **단순 카운트로 넘기지 말고** 원인을 재확인해 아래대로 처리한다:
- **thin 재분류**: 각 thin 건마다 \`${l.raw}\` 원문을 다시 열어 대조한다. **(a) wiki_lag**(원문엔 있는데 위키가 안 옮김) → 지금 바로 본문에 반영해 full로 승격(2번 항목과 동일 작업). **(b) content_gap**(원문 자체에도 부족) → 손대지 말고 left_alone에 "[content_gap] ..."로 기록. thin_reclassified에 재확인한 총 건수를 반환.
- **collection_hole 3분류**: 각 건을 **(a) genuine**(위임근거는 있으나 하위 고시 자체가 미제정 — admrul 재검색으로 재확인) **(b) structural**(관보·타 정부시스템 소관이라 law.go.kr API로 원천 접근 불가, \`_SCHEMA.md\` §5-3 4번·H-22 기준) **(c) uncollected**(admrul 검색이 불충분했던 것 — **지금 다시 검색해서 실제로 찾을 수 있으면 그 자리에서 반영**, 못 찾으면 collectable_holes에 등재)로 분류한다. (a)(b)는 left_alone에 사유와 함께 기록(재수집 시도 안 함). collection_hole_reclassified에 재확인한 총 건수를 반환.
- **awkward 수정**: 내용은 맞으나 \`${LEGAL}/_CHATBOT.md\` 답변방식(점진공개·출처표기·정의우선 등) 위반이 원인이다. 위반 형식만 그 자리에서 고친다(예: 다차수 처벌을 "통상 1차 먼저" 구조로 재배열, 누락된 조문 출처 추가). awkward_fixed에 수정 건수 반환.
- **scope_out 재검토**: 감사가 scope_out으로 판정한 질문마다, 해당 concept 페이지에 "이 부분은 범위 밖입니다/규정이 없습니다, ○○부서에 문의하세요"류 정직한 안내 문구가 **이미 있는지** 확인한다. 없으면 \`_CHATBOT.md\` §5-3 안내 형식대로 **그 자리에서 추가**한다(관보/타정부시스템 소관이면 §5-3 4번 문구, 미제정이면 1~3번 문구). scope_out_disclaimers_added에 추가한 건수 반환.

## 2-D) 인라인 ⚠REVIEW 마커 부착 (L-15 "페이지 단위" 문제 완화책, H-26)
\`${REVIEW_QUEUE}\`에서 이 법(\`REVIEW-${l.slug}-NN\` 형식, slug와 정확히 일치하는 것만) 관련 항목을 찾는다. 각 항목의 "대상 페이지"와 "AI 연결·판단 내용"에 적힌 **구체적 위치**(어느 절·어느 문장)를 그 위키 페이지 본문 **해당 문장 바로 옆**에 \`⚠REVIEW-XX\`(XX=그 REVIEW 번호) 인라인 마커로 표시한다(문장 끝에 짧게 추가, 문장 자체는 건드리지 않음). 이미 마커가 있으면 중복 부착하지 않는다. review_markers_added에 새로 부착한 마커 수 반환.

## 2-E) 소관부서·전화번호 반영 (자동수집 완료분, H-26)
\`${CONTACTS_FILE}\`를 Read해 이 법(slug="${l.slug}") 항목을 찾는다. \`families\`(법률/시행령/시행규칙 등)의 부서 정보를 이 법 statute 페이지(\`wiki/statutes/${l.slug}.md\`)의 소관부서·연락처 절에 반영한다(부서가 여러 개면 전부 나열, 각각 "부서명 — 담당업무 — 전화번호"). 부서명에 "이 업무 담당"이라는 구체 표기가 있으면(예: "항만정책과 - 항만제도 일반") 관련 concept 페이지의 타법연결/문의처 절에도 해당 부서를 연결한다. 이미 값이 있으면 덮어쓰지 말고 출처를 "law.go.kr DRF API 연락부서(2026-07-26 자동수집)"로 명시해 갱신. contacts_added에 반영 건수 반환. **주의**: 개인 이름(담당자명)은 절대 위키에 넣지 않는다(부서명·전화번호만).

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
  thin_reclassified: res.reduce((s, r) => s + (r.thin_reclassified || 0), 0),
  collection_hole_reclassified: res.reduce((s, r) => s + (r.collection_hole_reclassified || 0), 0),
  awkward_fixed: res.reduce((s, r) => s + (r.awkward_fixed || 0), 0),
  scope_out_disclaimers_added: res.reduce((s, r) => s + (r.scope_out_disclaimers_added || 0), 0),
  review_markers_added: res.reduce((s, r) => s + (r.review_markers_added || 0), 0),
  contacts_added: res.reduce((s, r) => s + (r.contacts_added || 0), 0),
  meta_review_flagged: res.reduce((s, r) => s + (r.meta_review_flagged || 0), 0),
  important: res.flatMap(r => (r.important || []).map(i => `${r.law}: ${i}`)),
  per_law: res.map(r => ({ law: r.law, status: r.status, edits: r.edits, lag: r.wiki_lag_fixed, links: r.links_added })),
}
