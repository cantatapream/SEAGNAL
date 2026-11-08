// 표기 통일(c_list) 워크플로우 (Claude Code 「Workflow」 도구로 실행) — HANDOFF_D1 §10-9 순서 5 · §10-10 방법 · _SCHEMA §5-D ⓖ ⓗ
//
// [무엇을 하나 — 쪽마다]
//   ① 정정 담당: c_list 의 C 지적(오타·표기·위치 표현)을 하나씩 — **지금 본문에 그 문구가 아직 있는지 먼저 보고**, 있으면 raw 원문으로
//      확인한 것만 고친다. 이미 고쳐졌으면 already, 원문과 다르면 rejected. 고쳤으면 「## 변경 이력」 한 줄.
//   ② 쪽이 기준 커밋(args.base)과 달라졌으면, 고친 이가 아닌 에이전트가 **바뀐 부분만** 읽고 장부에 적는다(--scope 변경분, §5-D ⓖ).
//      A/B 가 나오면 정정 → 새 읽는 이(최대 READS 번). 그래도 HOLD 면 HOLD_REVERT — post_cfix.py 가 그 쪽을 기준 커밋으로 되돌린다
//      (canonical 쪽을 다른 눈이 통과시키지 않은 채로 두지 않는다 — V5-57).
// 실행: make_cfix.py 가 만든 plan/C1-Rnn.json 을 make_wf.py 로 박아 넣은 사본을 Workflow 로 부른다.
//   args: {repo, round, date, tmp, base, model, effort, pages:[{f, items:[문장…]}]}
// 결과: {pages:[{file, final: NOCHANGE|PASS|HOLD_REVERT|ERROR, fixed, already, rejected, readers}]} → post_cfix.py
export const meta = {
  name: 'nariya-c1-notation',
  description: '표기 통일 — 쪽마다 C 지적 정정(지금 본문에 남은 것만 · 원문 확인) → 다른 에이전트가 바뀐 부분만 읽기(장부 변경분) · 최대 3번',
  phases: [
    { title: '정정', detail: 'C 지적을 지금 본문과 원문으로 확인해 고침' },
    { title: '바뀐 부분 읽기', detail: '고친 이가 아닌 에이전트 · A/B 면 다시 정정 · 3번' },
  ],
}
if (!args.repo) throw new Error('args.repo 가 없다')
const REPO = args.repo
const LEGAL = REPO + '/local_server/knowledge/legal'
const TMP = args.tmp
const RND = args.round
const BASE = args.base
const READS = 3
const RID = RND.replace(/\W/g, '')
const MO = { ...(args.model ? { model: args.model } : {}), ...(args.effort ? { effort: args.effort } : {}) }
const PAGES = args.pages.map(p => ({ file: p.file || p.f, items: p.items || [] }))

const FINDING = { type: 'object', required: ['grade', 'wiki', 'raw', 'what'],
  properties: { grade: { type: 'string', enum: ['A', 'B', 'C'] }, wiki: { type: 'string' }, raw: { type: 'string' }, what: { type: 'string' } } }
const FIX_SCHEMA = { type: 'object', required: ['fixed', 'already', 'rejected', 'changed'],
  properties: { fixed: { type: 'array', items: { type: 'string' } }, already: { type: 'array', items: { type: 'string' } },
    rejected: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, reason: { type: 'string' } } } },
    changed: { type: 'boolean' } } }
const READ_SCHEMA = { type: 'object', required: ['verdict', 'changed_lines', 'findings'],
  properties: { verdict: { type: 'string', enum: ['PASS', 'HOLD'] }, changed_lines: { type: 'integer' }, findings: { type: 'array', items: FINDING },
    compared: { type: 'string' }, ledger_ok: { type: 'boolean' } } }
const CHG_SCHEMA = { type: 'object', required: ['changed'], properties: { changed: { type: 'boolean' } } }

const RULES = `규칙:
 - 이 쪽 파일 하나만 고친다. 고칠 자리 말고 다른 문장은 건드리지 않는다. 원문에 없는 것을 새로 지어 넣지 않는다. 뜻(결론·범위)을 바꾸지 않는다 — 표기만 바로잡는다.
 - 새로 쓰는 글에 REVIEW · 판독 · OCR · 출처미확인 · 출처 미확인 · 원본이미지 · [미확인] 을 쓰지 않는다.
 - ⚠Q-19: 그림 안 글자를 읽어 위키에 옮겨 적지 않는다. 지적이 「그림 속 값을 적어 넣으라」는 꼴이면 rejected.
 - 「## 변경 이력」 표의 옛 줄은 고치지 않는다(새 줄만 끝에 더한다). frontmatter 는 건드리지 않는다.
 - 장부를 쓰지 않는다. git 으로 아무것도 바꾸지 않는다(diff·show 만). 서버·verify_all 을 돌리지 않는다.`

function short(p) { return p.file.split('/').pop().slice(0, 40) }

function fixPrompt(p, items, tag) {
  const list = items.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return `너는 SEAGNAL 해양법령 위키의 **표기 정정 담당**이다. 보고는 한국어로. 추측 금지 — 원문 grep 으로 확인한 것만.
쪽: ${LEGAL}/wiki/${p.file}.md · raw 원문: ${LEGAL}/raw/<도메인>/<법slug>/ (법률·시행령·시행규칙·별표/·행정규칙/·_대기/). 먼저 ${LEGAL}/_SCHEMA.md §5-D ⓕ ⓗ 를 읽는다.
아래는 ${tag}. 대부분 뜻에는 영향이 없는 C 등급(오타·표기·위치 표현·시행일 표기·인용 글자 누락)이다.
${list || '(지적 없음 — 이 쪽은 표준 절 제목만 맞췄다. 고칠 것이 없으면 changed=false 로 돌려준다)'}
할 일 — 지적마다:
 1. **지금 본문에 그 문구가 아직 있는가** 먼저 본다(지적은 여러 날에 걸쳐 모였다 — 다른 작업이 이미 고쳤을 수 있다). 없거나 이미 원문대로면 already.
 2. 남아 있으면 raw 원문을 직접 열어 지적이 맞는지 확인한다(다른 눈도 틀린다). 맞으면 고치고 fixed 에 요지를 적는다. 원문과 다르거나 고치면 뜻이 바뀌면 고치지 않고 rejected 에 이유와 원문 행을 적는다.
 3. 시행일 표기는 지금 raw 파일의 그 조문 머리말(「[제N조] … (시행 YYYYMMDD」)과 맞춘다.
 4. 하나라도 고쳤으면 「## 변경 이력」 표 끝에 한 줄을 더한다: | ${args.date} | ${RND} 표기 통일 — (고친 것 요지·근거 조문) | (raw 경로·조문) |
${RULES}
돌려줄 것: fixed(고친 것 요지 목록) · already(이미 고쳐져 있던 것) · rejected([{item, reason}]) · changed(파일을 고쳤나).`
}

function readPrompt(p, label, fixer, round) {
  return `너는 SEAGNAL 해양법령 위키의 **다른 눈의 읽기(바뀐 부분만)** 담당이다. 이 쪽을 고치지 않았다. 보고는 한국어로. 추측 금지 — 원문 grep 으로 확인한 것만.
쪽: ${LEGAL}/wiki/${p.file}.md · raw: ${LEGAL}/raw/. 먼저 ${LEGAL}/_SCHEMA.md §5-D ⓗ 를 읽는다.
이 쪽은 표기 통일로 고쳐졌다(${round}번째 읽기). 바뀐 줄은 저장소 루트에서 \`git diff ${BASE} -- "local_server/knowledge/legal/wiki/${p.file}.md"\` 로 본다(작업 트리와 비교).
할 일: 「## 변경 이력」 칸 밖의 **바뀐 줄 하나하나**를 raw 원문과 대조한다 — 숫자·조항호·이상/이하·재량/의무·주체·시행일·인용 글자. 고치면서 뜻이 바뀌었나(범위가 넓어지거나 좁아짐, 결론이 틀림), 새로 원문과 어긋나는 것이 생겼나를 본다. 제목 줄이 표준 이름으로 바뀌고 꼬리 글이 바로 아래 인용 줄로 옮겨진 것은 뜻이 같으면 문제 없다.
지적 등급: A(결론이 틀림) · B(범위가 넓어지거나 좁아짐) · C(오타·표기). A 나 B 가 하나라도 있으면 HOLD, C 만이면 PASS. 원문을 열어 보지 않은 지적은 적지 않는다.
파일을 하나도 고치지 않는다. git 으로 아무것도 바꾸지 않는다.
판정을 장부에 적는다(이것만은 한다):
 ① 지적 목록을 JSON 배열로 ${TMP}/${label}.json 에 쓴다: [{"등급":"A|B|C","확인":false,"내용":"위키: … / 원문(파일·조문): … / 무엇이 다른가"}] (없으면 []).
 ② 저장소 루트에서: node local_server/knowledge/legal/_dashboard/loop/reread_ledger.js add --page ${p.file}.md --reader ${label} --fixer ${fixer} --verdict <PASS|HOLD> --scope 변경분 --findings ${TMP}/${label}.json --note "${RND} 표기 통일"
 장부 명령이 성공했으면 ledger_ok=true.
돌려줄 것: verdict · changed_lines(바뀐 본문 줄 수) · findings(grade·wiki·raw·what) · compared(한 줄, | 없이) · ledger_ok.`
}

function changedPrompt(p) {
  return `저장소 ${REPO} 루트에서 \`git diff --quiet ${BASE} -- "local_server/knowledge/legal/wiki/${p.file}.md"; echo $?\` 를 돌려, 0 이면 changed=false, 1 이면 changed=true 로 돌려준다. 다른 일은 하지 않는다.`
}

async function onePage(p, idx) {
  const fix = await agent(fixPrompt(p, p.items, 'c_list 에 모인 C 지적'), { label: `정정 · ${short(p)}`, phase: '정정', schema: FIX_SCHEMA, ...MO })
  if (!fix) return { file: p.file, final: 'ERROR', note: '정정 에이전트 실패' }
  const base = { file: p.file, fixed: fix.fixed || [], already: fix.already || [], rejected: fix.rejected || [], readers: [] }
  // 제목만 맞춘 쪽은 정정 에이전트가 안 고쳐도 기준 커밋과 다르다 — 실제 diff 로 판단한다
  const ch = fix.changed ? { changed: true } : await agent(changedPrompt(p), { label: `바뀜? · ${short(p)}`, phase: '정정', schema: CHG_SCHEMA, ...MO })
  if (!ch) return { ...base, final: 'ERROR', note: '변경 확인 실패' }
  if (!ch.changed) return { ...base, final: 'NOCHANGE' }
  let fixer = `f${RID}-${idx}-0`
  for (let r = 1; r <= READS; r++) {
    const rl = `c${RID}-${idx}-${r}`
    const rd = await agent(readPrompt(p, rl, fixer, r), { label: `읽기 ${r} · ${short(p)}`, phase: '바뀐 부분 읽기', schema: READ_SCHEMA, ...MO })
    if (!rd) return { ...base, final: 'ERROR', note: '읽기 에이전트 실패' }
    base.readers.push(rl)
    const ab = (rd.findings || []).filter(f => f.grade !== 'C')
    if (!ab.length && (rd.verdict !== 'PASS' || rd.ledger_ok === false)) return { ...base, final: 'ERROR', note: '판정/장부 불일치' }
    if (!ab.length) return { ...base, final: 'PASS', reader: rl, c_left: (rd.findings || []).filter(f => f.grade === 'C') }
    if (r === READS) return { ...base, final: 'HOLD_REVERT', last_findings: ab }
    const items = ab.map(f => `[${f.grade}] 위키: ${f.wiki} / 원문: ${f.raw} / ${f.what}`)
    const fx = await agent(fixPrompt(p, items, `바뀐 부분 ${r}번째 읽기의 지적(A/B — 앞 정정이 만든 어긋남일 수 있다)`), { label: `재정정 ${r} · ${short(p)}`, phase: '바뀐 부분 읽기', schema: FIX_SCHEMA, ...MO })
    if (!fx) return { ...base, final: 'ERROR', note: '재정정 실패' }
    fixer = `f${RID}-${idx}-${r}`
  }
}

log(`${RND}: ${PAGES.length}쪽 · 기준 ${BASE.slice(0, 8)}`)
const out = await pipeline(PAGES, (p, _o, i) => onePage(p, i))
const summary = {}
for (const r of out) { const k = r ? r.final : 'ERROR'; summary[k] = (summary[k] || 0) + 1 }
return { pages: out, summary }
