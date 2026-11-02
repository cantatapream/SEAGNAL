// D1 다시 읽기 워크플로우 (Claude Code 「Workflow」 도구로 실행) — _SCHEMA §5-D ⓖ ⓗ
//
// ⚠ 이 파일은 2026-10-09 세션의 임시 폴더에 있던 reread_wf3.js 를 2026-11-02 에 다시 적은 것이다.
//   (컨테이너가 초기화돼 원본이 사라졌다. 스키마·CHECKS·head·partPrompt 는 원본 글자 그대로(meta 는 원본 v2 → v3 로 이름만 바꿈),
//    readPrompt·fixPrompt·onePage·splitPhase 는 원본의 동작을 기록대로 다시 짰다.)
//   실행 전 이 파일을 한 번 읽고, 저장소 경로(REPO)가 맞는지 확인한다.
//
// 실행: Workflow({ scriptPath: '<이 파일>', args: {round, date, tmp, status, [model], [effort], pages:[{f, v1, g}]} })
//   - round: 묶음 이름(예 'D1-R01'). 읽는 이 이름(r<영숫자만>-<쪽순번>-<회차>)·장부 메모·변경 이력·승격 기록줄에 그대로 박힌다.
//     묶음마다 다르게, 그리고 등록부 번호(3-NN)와 헷갈리지 않게 'D1-R' 꼴을 쓴다. 장부에 이미 있는 3-94~3-100 은 쓰지 않는다.
//   - tmp: 지적 JSON 을 쓸 임시 폴더(세션 scratchpad 아래). 미리 만들어 둔다.
//   - status: 'draft' | 'canonical'
//   - pages[].f: wiki/ 아래 경로(.md 빼고) · v1: 1차 기계 대조 신호(없으면 []) · g: 나눠 읽기 묶음 [[첫 절 제목 앞머리, 끝 절 제목 앞머리], …]
//   make_queue.js 가 이 꼴의 args 파일을 만든다(파일 내용을 그대로 args 에 붙여 넣는다 — 워크플로우는 파일을 못 읽는다).
// 결과: {pages:[{file, final: PASS|PASS_SPLIT|CAP|ERROR, rounds, readers, rawdir, compared, not_compared, c_left, last_findings}]}
//   → post_batch.py 에 넘겨 승격·기록·사람 판단 목록을 처리한다.
// 세션 사용량 한도에 걸리면 에이전트가 ERROR 로 끝난다 → 한도가 풀린 뒤 같은 args 로 resumeFromRunId 를 주어 다시 부르면
//   끝난 에이전트는 캐시로 재생되고 멈춘 곳부터 이어진다(args 가 글자까지 같아야 캐시가 맞는다).
export const meta = {
  name: 'nariya-d1-reread-v3',
  description: '위키 쪽 다시 읽기 — 통째 읽기 최대 4번(C는 판정 밖) → 그래도 HOLD면 절 묶음으로 나눠 새 에이전트들이 읽기(최대 2바퀴) · _SCHEMA §5-D ⓖ ⓗ',
  phases: [
    { title: '통째 읽기', detail: '읽기(장부) → A/B 있으면 원문 확인·정정 → 새 읽는 이 · 4번' },
    { title: '나눠 읽기', detail: '절 묶음마다 새 에이전트 · 남은 묶음만 다시 · 2바퀴' },
  ],
}
const REPO = '/home/user/seagnal'
const LEGAL = REPO + '/local_server/knowledge/legal'
const TMP = args.tmp
const RND = args.round
const CAP = 4
const SPLIT_ROUNDS = 2
const RID = RND.replace(/\W/g, '')
// 모델·노력: args.model / args.effort 를 주면 모든 에이전트에 붙는다(저장소 CLAUDE.md L-12 는 검증류 sonnet·medium — HANDOFF_D1 §7-④)
const MO = { ...(args.model ? { model: args.model } : {}), ...(args.effort ? { effort: args.effort } : {}) }
// 짧은 인자 꼴: {f, v1, g:[[첫 절, 끝 절], …]} — 묶음을 첫·끝 제목으로만 넘긴다
const PAGES = args.pages.map(p => ({ ...p, file: p.file || p.f, status: p.status || args.status || 'draft', v1: p.v1 || [],
  groups: p.groups || (p.g || []).map(([a, b]) => ({ from: a, to: b })) }))

const FINDING = { type: 'object', required: ['grade', 'wiki', 'raw', 'what'],
  properties: { grade: { type: 'string', enum: ['A', 'B', 'C'] }, wiki: { type: 'string' }, raw: { type: 'string' }, what: { type: 'string' } } }
const READ_SCHEMA = { type: 'object', required: ['verdict', 'values_checked', 'findings'],
  properties: { verdict: { type: 'string', enum: ['PASS', 'HOLD'] }, values_checked: { type: 'integer' }, findings: { type: 'array', items: FINDING },
    rawdir: { type: 'string' }, compared: { type: 'string' }, not_compared: { type: 'string' }, ledger_ok: { type: 'boolean' } } }
const FIX_SCHEMA = { type: 'object', required: ['confirmed', 'rejected', 'changed'],
  properties: { confirmed: { type: 'array', items: { type: 'string' } }, rejected: { type: 'array', items: { type: 'object', properties: { finding: { type: 'string' }, reason: { type: 'string' } } } }, changed: { type: 'boolean' } } }

const CHECKS = `대조 항목(값마다 grep 으로 그 조·항·호를 연다 — 눈대중 금지):
 1. 숫자로 된 법적 효과(징역·벌금·과태료·과징금, 기간·일수, 수량·규격·비율, 감경 비율, 횟수)가 맞는 조·항·호에 붙었나.
 2. 이상/이하/미만/초과·「까지」·「이내」·병과(또는/및)·「할 수 있다」(재량)/「하여야 한다」(의무).
 3. 의무 주체·차수(1/2/3차)·계층(법률/시행령/시행규칙/별표/고시).
 4. 「각 호 N개」는 §5-D ⓕ 로 센다(가지번호 셈, 삭제 호 뺌, 마지막 번호와 다르면 둘 다 적었나).
 5. 원문에 없는 것을 단정한 문장(추론), 원문에 규정이 있는데 「없다/확인불가」라 한 문장, 원문·수집 연락처(_dashboard/contacts_collected.json)에 없는 전화번호.
 6. 「원문 그대로/인용」 이라 내건 문장이 원문과 글자까지 같은가(띄어쓰기 제외) — 조건·단서·「등」이 빠졌나.
 7. 시행일·조문 제목 표기가 raw 머리말과 같은가.
 8. 그림·별표 이미지에서 옮겨 적은 값이 본문에 남아 있나(§5-D ⓐ-2: 값을 빼고 원문 별표 안내로 바꿔야 한다 — 남아 있으면 B).
지적 등급(§5-D ⓗ): A(결론이 틀림) · B(범위가 넓어지거나 좁아짐) · C(오타·표기·위치 표현). A 나 B 가 하나라도 있으면 HOLD, C 만이면 PASS(C 는 findings 에 적는다). 원문을 열어 보지 않은 지적은 적지 않는다.
규칙: 파일을 하나도 고치지 않는다. git 으로 아무것도 바꾸지 않는다. 서버·verify_all 을 돌리지 않는다.`

function short(p) { return p.file.split('/').pop().slice(0, 40) }

function head(p) {
  return `너는 SEAGNAL 해양법령 위키의 **다른 눈의 읽기(2차 재점검)** 담당이다. 이 쪽을 만들지도 고치지도 않았다. 보고는 한국어로.
저장소: ${REPO}. 읽을 쪽: ${LEGAL}/wiki/${p.file}.md (지금 status: ${p.status}). raw 원문: ${LEGAL}/raw/<도메인>/<법slug>/ (법률·시행령·시행규칙·별표/·행정규칙/·_대기/). 법 이름으로 폴더를 찾으려면 ls ${LEGAL}/raw/*/ 를 본다.
먼저 ${LEGAL}/_SCHEMA.md 의 §5-D ⓐ ⓑ ⓕ ⓖ ⓗ 를 읽는다.
이 쪽이 「」로 이름을 댄 다른 법: ${(p.cited || []).join(', ') || '(쪽에서 「」 이름을 찾아라)'}
1차 기계 대조가 남긴 것(기계의 오탐일 수도 있다 — 하나씩 확인): ${(p.v1 || []).join(' / ') || '없음'}`
}

function readPrompt(p, label, prevFixer, round) {
  return `${head(p)}
이 쪽의 ${round}번째 통째 읽기다${round > 1 ? ` (앞 읽기의 지적을 ${prevFixer} 가 고친 뒤)` : ''}. 「## 변경 이력」 과 frontmatter 를 뺀 **본문 전체의 모든 줄**을 raw 원문과 대조한다.
${CHECKS}
다 읽었으면 판정을 장부에 적는다(이것만은 한다):
 ① 지적 목록을 JSON 배열로 ${TMP}/${label}.json 에 쓴다: [{"등급":"A|B|C","확인":false,"내용":"위키: … / 원문(파일·조문): … / 무엇이 다른가"}] (없으면 []).
 ② 저장소 루트에서: node local_server/knowledge/legal/_dashboard/loop/reread_ledger.js add --page ${p.file}.md --reader ${label}${prevFixer ? ' --fixer ' + prevFixer : ''} --verdict <PASS|HOLD> --scope 전체 --findings ${TMP}/${label}.json --note "${RND}"
 장부 명령이 성공했으면 ledger_ok=true.
돌려줄 것: verdict · values_checked · findings(grade·wiki·raw·what) · rawdir · compared(한 줄, | 없이 — 대조한 조문·값) · not_compared(없으면 "없음", | 없이) · ledger_ok.`
}

function partPrompt(p, label, group, gi, gn, round) {
  return `${head(p)}
이 쪽은 통째 읽기를 여러 번 거쳤는데도 매번 새 지적이 나와 **나눠 읽기**를 한다(§5-D ⓗ). 너는 ${gn}개 묶음 중 ${gi + 1}번째 묶음만 맡는다${round > 1 ? ` — 이 묶음의 ${round}번째 읽기다(앞 사람이 고친 뒤)` : ''}.
맡은 절(「## 」 제목): ${Array.isArray(group) ? group.map(s => `「${s}」`).join(' · ') : `「${group.from}」부터 「${group.to}」까지(두 절 사이의 「## 」 절 모두, 앞머리만 적었으면 그 글자로 시작하는 제목)`}
그 절들의 **모든 줄**을 raw 원문과 대조한다(다른 절은 보지 않아도 된다 — 다른 에이전트가 맡았다).
${CHECKS}
장부에는 적지 않는다(나눠 읽기 결과는 묶은 뒤 한 번에 적는다).
돌려줄 것: verdict · values_checked · findings(grade·wiki·raw·what) · rawdir · compared(한 줄, | 없이) · not_compared(없으면 "없음", | 없이).`
}

function fixPrompt(p, findings, tag, file) {
  const list = (findings.length ? findings.map((f, i) => `${i + 1}. [${f.grade}] 위키: ${f.wiki} / 원문: ${f.raw} / ${f.what}`).join('\n') : '')
    + (file ? `\n(지적 목록 파일 — 먼저 읽는다: ${file} · 각 항목 grade/wiki/raw/what)` : '')
  return `너는 SEAGNAL 해양법령 위키의 **정정 담당**이다. 다른 에이전트가 아래 쪽을 raw 원문과 대조해 지적을 남겼다. 보고는 한국어로.
쪽: ${LEGAL}/wiki/${p.file}.md · raw: ${LEGAL}/raw/ · 먼저 ${LEGAL}/_SCHEMA.md §5-D 를 읽는다.
지적(${tag}):
${list}
할 일:
 1. 지적마다 raw 원문을 직접 grep 으로 열어 확인한다. 원문으로 확인된 지적만 고친다(§5-D ⓗ — 다른 눈도 틀린다, L-413). 원문과 다르면 고치지 않고 rejected 에 이유와 원문 행을 적는다.
 2. 고칠 때는 이 쪽 파일만 고친다. 고친 자리 말고 다른 문장은 건드리지 않는다. 원문에 없는 것을 새로 지어 넣지 않는다.
 3. 새로 쓰는 글에는 REVIEW · 판독 · OCR · 출처미확인 · 출처 미확인 · 원본이미지 · [미확인] 을 쓰지 않는다(그림 값은 「원문 별표 안내」로 바꾼다 — §5-D ⓐ-2).
 4. 고쳤으면 「## 변경 이력」 표 끝에 한 줄을 더한다: | ${args.date} | ${RND} — 다른 눈의 읽기 지적 정정(${tag}): (고친 것 요지·근거 조문) |
 5. 지적이 틀렸다고 판단한 것(rejected)은 그 근거(원문 파일·행)를 이 쪽 본문의 해당 자리 가까이에 짧게 적어 다음 읽는 이가 같은 자리를 다시 지적하지 않게 한다(§5-D ⓗ).
 6. 장부는 쓰지 않는다. git 으로 아무것도 하지 않는다. 서버·verify_all 을 돌리지 않는다.
돌려줄 것: confirmed(고친 지적 요지 목록) · rejected([{finding, reason}]) · changed(파일을 고쳤나).`
}

async function splitPhase(p, idx, pending, wholeReaders) {
  const groups = p.groups && p.groups.length ? p.groups : [{ from: '(첫 절)', to: '(끝 절)' }]
  const readers = [...(wholeReaders || [])]
  let todo = groups.map((_, i) => i)
  let cLeft = [], compared = [], notCompared = [], rawdir = ''
  for (let r = 1; r <= SPLIT_ROUNDS; r++) {
    if (pending.length || (r === 1 && p.findingsFile)) {
      const fix = await agent(fixPrompt(p, pending, r === 1 ? '통째 읽기 마지막 회차' : `나눠 읽기 ${r - 1}바퀴`, r === 1 ? p.findingsFile : ''), { label: `정정 · ${short(p)}`, phase: '나눠 읽기', schema: FIX_SCHEMA, ...MO })
      if (!fix) return { file: p.file, final: 'ERROR', rounds: CAP, readers }
    }
    const res = await parallel(todo.map(gi => () => agent(partPrompt(p, `s${RID}-${idx}-${r}-${gi}`, groups[gi], gi, groups.length, r),
      { label: `나눠 ${r}-${gi + 1}/${groups.length} · ${short(p)}`, phase: '나눠 읽기', schema: READ_SCHEMA, ...MO }).then(x => ({ gi, x }))))
    if (res.some(o => !o || !o.x)) return { file: p.file, final: 'ERROR', rounds: CAP, readers }
    pending = []; const failed = []
    for (const o of res) {
      readers.push(`s${RID}-${idx}-${r}-${o.gi}`)
      const ab = (o.x.findings || []).filter(f => f.grade !== 'C')
      cLeft.push(...(o.x.findings || []).filter(f => f.grade === 'C'))
      if (o.x.compared) compared.push(o.x.compared)
      if (o.x.not_compared && o.x.not_compared !== '없음') notCompared.push(o.x.not_compared)
      if (o.x.rawdir) rawdir = o.x.rawdir
      if (ab.length) { failed.push(o.gi); pending.push(...ab) }
    }
    if (!failed.length) return { file: p.file, final: 'PASS_SPLIT', readers, rawdir, compared: compared.join(' / '), not_compared: notCompared.join(' / ') || '없음', c_left: cLeft }
    todo = failed
  }
  return { file: p.file, final: 'CAP', readers, rawdir, last_findings: pending, c_left: cLeft }
}

async function onePage(p, idx) {
  if (p.startSplit) return splitPhase(p, idx, p.last_findings || [], [])
  let prevFixer = '', last = []
  const readers = []
  for (let round = 1; round <= CAP; round++) {
    const rl = `r${RID}-${idx}-${round}`
    const read = await agent(readPrompt(p, rl, prevFixer, round), { label: `읽기 ${round} · ${short(p)}`, phase: '통째 읽기', schema: READ_SCHEMA, ...MO })
    if (!read) return { file: p.file, final: 'ERROR', rounds: round, readers }
    readers.push(rl)
    const ab = (read.findings || []).filter(f => f.grade !== 'C')
    const c = (read.findings || []).filter(f => f.grade === 'C')
    // 통과는 A/B 지적이 없고, 읽는 이 판정도 PASS 이고, 장부 줄도 적혔을 때만(장부와 결과가 어긋나면 승격·기록이 막힌다)
    if (!ab.length && (read.verdict !== 'PASS' || read.ledger_ok === false)) return { file: p.file, final: 'ERROR', rounds: round, readers, note: '판정/장부 불일치 — 다시 읽힌다' }
    if (!ab.length) return { file: p.file, final: 'PASS', rounds: round, reader: rl, readers, rawdir: read.rawdir, compared: read.compared, not_compared: read.not_compared, values: read.values_checked, c_left: c }
    last = ab
    if (round === CAP) break
    const fix = await agent(fixPrompt(p, ab, `${round}번째 읽기`), { label: `정정 ${round} · ${short(p)}`, phase: '통째 읽기', schema: FIX_SCHEMA, ...MO })
    if (!fix) return { file: p.file, final: 'ERROR', rounds: round, readers }
    prevFixer = `f${RID}-${idx}-${round}`
  }
  return splitPhase(p, idx, last, readers)
}

log(`${RND}: ${PAGES.length}쪽`)
const out = await pipeline(PAGES, (p, _o, i) => onePage(p, i))
const summary = {}
for (const r of out) { const k = r ? r.final : 'ERROR'; summary[k] = (summary[k] || 0) + 1 }
return { pages: out, summary }
