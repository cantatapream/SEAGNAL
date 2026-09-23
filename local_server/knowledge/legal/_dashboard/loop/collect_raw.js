const path = require('path');
// collect_raw.js — H-12③ 재수집: collect_queue의 "수집 가능" 원문을 DRF로 가져와 raw/에만 저장(위키 편집 X).
// 역할(초보자용): 감사·통합수정이 "raw엔 없지만 수집 가능"으로 표시한 고시·타법조문·별표를 law.go.kr DRF로 내려받아
//   그 법의 raw 폴더에 저장한다. 위키는 건드리지 않는다(다음 통합수정 라운드가 raw→위키 반영). 그래서 린트와 병렬 안전.
// [연계] 입력 _dashboard/collect_queue.json + _SCHEMA.md 0-A(DRF 방식) · 출력 raw/**(신규 원문) + 마커 collect_r7_<slug>.done
// [로드 순서] Workflow. fix 후. 린트와 병렬 안전(raw만 씀, 위키·graph·comparisons 미접촉).

export const meta = {
  name: 'maritime-collect-raw',
  description: 'collect_queue의 수집가능 원문을 DRF로 raw에만 수집(위키 미편집=린트와 병렬 안전)',
  phases: [{ title: '재수집', detail: '법별 1에이전트: DRF로 미수집 원문 raw 저장, 위키 미편집' }],
}
const LEGAL = path.resolve(__dirname, '../..')

const SCHEMA = {
  type: 'object', required: ['law', 'status'],
  properties: {
    law: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'nothing', 'failed'] },
    fetched: { type: 'array', items: { type: 'string' }, description: '새로 raw에 저장한 원문' },
    saved_paths: { type: 'array', items: { type: 'string' } },
    failed: { type: 'array', items: { type: 'string' }, description: '수집 시도했으나 실패(API 무응답 등)' },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 **재수집 에이전트(raw 전용)**다. 담당 법의 "수집 가능한 미수집 원문"을 law.go.kr DRF로 가져와 **raw에만 저장**한다. **위키·graph·comparisons는 절대 건드리지 않는다**(린트가 동시에 위키를 쓰므로 경합 금지).

## 0) 먼저 읽을 것
1. \`${LEGAL}/_SCHEMA.md\` 0-A(수집 방식·DRF target·기술기준=기준법급). 특히 **행정규칙 별표=DRF admrul 상세**: \`https://www.law.go.kr/DRF/lawService.do?OC=hyoo1431&target=admrul&ID=<행정규칙일련번호>&type=JSON\` → 응답 별표단위[]에 인라인 텍스트. 별표 이미지/PDF는 \`flDownload.do?flSeq=<id>\`.
2. \`${LEGAL}/_dashboard/collect_queue.json\`(Read) — "law: 설명" 형식. **담당 법 「${l.name}」 항목만** 골라 처리.

## 1) 담당 법: 「${l.name}」  (slug: ${l.slug} · raw: ${l.raw})

## 2) 수집 (raw 저장만)
- collect_queue에서 이 법 항목 중 **수집 가능** 유형만 시도:
  - **행정규칙·고시(admrul 등재)**: DRF target=admrul로 조회(제목 검색 → ID 확보 → 상세). 본문·별표 인라인 텍스트를 \`${l.raw}/행정규칙/<고시명>.txt\`에 저장.
  - **타법 거쳐간 조문(eflaw)**: DRF target=eflaw로 그 법의 인용 조문만 발췌 저장(\`${l.raw}/../15_관련타부처/<법명>/...\` 또는 이 법 raw 하위 적절 위치).
  - **별표(HWP/이미지)**: 별표서식파일링크(flDownload)로 받아 텍스트 추출(pdftotext/vision) → \`${l.raw}/별표/<별표명>.txt\`.
  - **부칙**: DRF eflaw 재조회로 부칙 섹션 확보 → 저장.
- **curl은 프록시 경유**: \`curl -sS --cacert /root/.ccr/ca-bundle.crt "..."\` (실패 시 /root/.ccr/README.md 참고).
- **미제정·지자체 자치법규·원문 자체 부재**는 시도하지 말 것(스코프/수집곤란) → note에 기록.

## 3) 절대 규칙
- 🚫 **raw/ 아래에만 쓴다.** wiki/·graph.json·comparisons/·_glossary·draft/·.claude/ 절대 미접촉(린트 동시 진행 중).
- 환각 0: 실제 DRF 응답 내용만 저장. 못 받으면 failed에 기록(지어내기 금지).
- 처벌·안전값·⚠REVIEW 걸린 수집분도 raw 저장까지만(위키 승격은 나중, 사람 승인 게이트).
- 완료 후 Bash 마커: \`printf 'r7 collect\\n' > ${LEGAL}/_dashboard/fix3/collect_r7_${l.slug}.done\`.

## 4) 반환(JSON): law, status, fetched[], saved_paths[], failed[], note.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON {"0":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '재수집', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
log(`재수집(raw전용) 대상 ${laws.length}법`)
phase('재수집')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `collect:${l.name.slice(0, 12)}`, phase: '재수집', model: 'sonnet', effort: 'high', schema: SCHEMA })
))).filter(Boolean)

return {
  collected_laws: res.filter(r => r.status === 'done' || r.status === 'partial').length,
  total: laws.length,
  fetched: res.reduce((s, r) => s + (r.fetched || []).length, 0),
  failed: res.flatMap(r => (r.failed || []).map(x => `${r.law}: ${x}`)),
  per_law: res.map(r => ({ law: r.law, status: r.status, fetched: (r.fetched || []).length })),
}
