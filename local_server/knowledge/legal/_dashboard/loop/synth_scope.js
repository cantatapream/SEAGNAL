// synth_scope.js — 6차 감사 리포트를 읽어 각 법의 '스코프-밖 질문 수'를 판정해 스코프-내 full률을 산출한다.
// 역할(초보자용): DoD는 "스코프-내 full률 ≥90%". 스코프-밖(판례·법리·입법공백·미제정고시·자치법규·⚠REVIEW미검증)
//   질문은 위키가 원천적으로 답할 수 없으므로 분모에서 뺀다. 각 에이전트가 담당 법의 감사 리포트를 읽고
//   out_scope 질문 수를 센다. 스코프-내 full률 = Σfull / (Σtotal - Σout_scope).
// [연계] 입력 _dashboard/audit/<slug>.md(6차 감사 리포트) + audit6_final_raw.json(원점수) · 출력 반환 JSON(집계)
// [로드 순서] Workflow 단독. 6차 감사 70/70 완료 후 1회.

export const meta = {
  name: 'audit6-scope-synth',
  description: '6차 감사 리포트로 스코프-내 full률 산출(스코프밖 질문 분모 제외)',
  phases: [{ title: '스코프분류', detail: '법별 에이전트가 감사리포트 읽고 out_scope 질문수 판정' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const SCHEMA = {
  type: 'object', required: ['law', 'total_q', 'full', 'out_scope_q'],
  properties: {
    law: { type: 'string' },
    total_q: { type: 'integer' },
    full: { type: 'integer' },
    out_scope_q: { type: 'integer', description: '스코프-밖(위키로 원천 답변불가) 질문 수' },
    out_breakdown: { type: 'object', description: '{판례법리, 입법공백_원문없음, 미제정고시, 자치법규, review_pending_미검증}' },
    in_scope_full_rate_pct: { type: 'number' },
    note: { type: 'string' },
  },
}

function prompt(law) {
  return `너는 SEAGNAL 해양법률 위키의 감사 집계관이다. 담당 법의 6차 감사 리포트를 읽고 **스코프-밖 질문 수**를 센다.

## 담당 법: 「${law.name}」  (slug: ${law.slug})
- 6차 감사 리포트: \`${LEGAL}/_dashboard/audit/${law.slug}.md\` — **Read로 전문을 읽어라.**
- 이 법의 6차 원점수: 총 ${law.q}문항, full ${law.full}, thin ${law.thin}, missing ${law.missing}, hole ${law.collection_hole}, awkward ${law.awkward}.

## 스코프 정의 (DoD: 스코프-내 full률 ≥90%)
**스코프-밖(out_scope) = 위키가 원천적으로 답할 수 없는 질문** — 아래에 해당하면 분모에서 제외한다:
1. **판례·법리·해석다툼**: 강행/훈시규정 판단, 처분성, 위임입법 한계, 조문충돌 해석, 법리적 다툼(위키는 조문을 옮길 뿐 법리판단 안 함).
2. **입법공백(원문 자체 없음)**: raw 원문·법령에 그 규정 자체가 없음(부칙 미존재, 특정 절차 조문 부재 등 "원문 자체 공백"으로 명시된 것).
3. **미제정 고시**: 위임은 있으나 admrul 미등재·미제정으로 확정된 것(국가법령정보센터에 없음).
4. **자치법규(지자체 조례·고시)**: 지자체 개별 조례·고시(안내대체 대상).
5. **⚠REVIEW 미검증 데이터**: 사람이 아직 검증 안 한 별표 이미지 OCR 판독값 등(review_pending).
6. **타법 스코프-밖**: 우리 수집범위(2/3군) 밖 일반법 조문(형법·민법 총칙 등 거쳐가지 않은 부분).

**스코프-내(분모 포함)** = 위 6종이 아닌 것 = **위키가 답할 수 있어야 하는 질문**. 특히 "raw엔 있는데 위키 미반영(wiki_lag)"·"링크/허브 결손"·"별표 수치 미반영"은 **전부 스코프-내**(고칠 수 있으므로).

## 판정 방법
1. 리포트의 질문·판정·gap·collection_hole 서술을 근거로, 이 법의 **총 ${law.q}문항 중 몇 개가 스코프-밖(out_scope)인지** 추정한다. 리포트가 "원문 자체 공백"·"판례법리"·"admrul 미제정"·"자치법규"·"스코프밖"·"⚠REVIEW"로 명시한 것을 센다.
2. full ${law.full}개는 정의상 전부 스코프-내다(스코프밖은 full일 수 없음). out_scope는 thin/missing/hole/awkward 중에서만 나온다.
3. out_scope_q ≤ (총 - full) 이어야 한다.
4. 계산: in_scope_q = ${law.q} - out_scope_q,  in_scope_full_rate = full / in_scope_q * 100.

## 반환(JSON)
law, total_q(${law.q}), full(${law.full}), out_scope_q, out_breakdown{판례법리, 입법공백_원문없음, 미제정고시, 자치법규, review_pending_미검증}, in_scope_full_rate_pct, note(판정근거 1~2줄).
정직하게 — 애매하면 스코프-내로 본다(과대 제외 금지). 목적은 "위키가 답해야 하는데 못 답한" 진짜 커버리지를 재는 것.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
// 법 목록: 에이전트가 raw json 읽음
const BOOT = { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } }
const grp = (cfg.group !== undefined && cfg.group !== null) ? cfg.group : null
const ng = cfg.ngroups || 10
const filt = grp !== null ? `단, 법명을 가나다순 정렬 후 인덱스 i에 대해 i%${ng}==${grp}인 것만` : ''
const boot = await agent(
  `\`${cfg.rawPath}\`(JSON: {법명: {q,full,thin,missing,collection_hole,awkward}, ...})와 \`${cfg.allLawsPath}\`(JSON 배열 [{name,slug},...])를 Read로 읽어라.
반환(JSON): { laws: 두 파일을 조인해 [{name, slug, q, full, thin, missing, collection_hole, awkward}] 배열(rawPath의 각 법명을 allLawsPath에서 slug 매칭). ${filt} }.`,
  { label: `boot-g${grp}`, phase: '스코프분류', schema: BOOT, effort: 'low' })
const laws = (boot && boot.laws) || []
log(`스코프분류 대상 ${laws.length}법`)

phase('스코프분류')
const res = (await parallel(laws.map(law => () =>
  agent(prompt(law), { label: `scope:${law.name.slice(0, 10)}`, phase: '스코프분류', model: 'sonnet', effort: 'medium', schema: SCHEMA })
))).filter(Boolean)

const sum = k => res.reduce((s, r) => s + (r[k] || 0), 0)
const totalQ = sum('total_q'), totalFull = sum('full'), totalOut = sum('out_scope_q')
const inScopeQ = totalQ - totalOut
return {
  laws_synth: res.length,
  total_q: totalQ, total_full: totalFull, total_out_scope: totalOut, in_scope_q: inScopeQ,
  raw_full_rate_pct: +(100 * totalFull / totalQ).toFixed(1),
  scope_in_full_rate_pct: +(100 * totalFull / inScopeQ).toFixed(1),
  out_scope_share_pct: +(100 * totalOut / totalQ).toFixed(1),
  per_law: res.map(r => ({ law: r.law, q: r.total_q, full: r.full, out: r.out_scope_q, in_rate: r.in_scope_full_rate_pct })),
}
