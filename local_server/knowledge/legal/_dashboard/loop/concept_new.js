// concept_new.js — statutes 허브에만 있어 챗봇이 못 꺼내는 내용을 **개념 페이지로 옮긴다**(결정 ④⑤).
// 역할(초보자용): 어떤 법은 원문 정리(statutes)는 400~500줄로 충실한데 개념 페이지가 1~2개뿐이다.
//   챗봇은 개념 페이지의 `## 근거 조문` 표에서만 근거를 만들므로(_SCHEMA.md §6-E), 그 내용이
//   사용자에게 닿지 않는다. "위키가 모르는" 게 아니라 "위키는 아는데 챗봇이 못 찾는" 상태다.
// [연계] 입력 wiki/statutes/<slug>.md + raw · 출력 wiki/concepts/<slug>__<주제>.md
//        규칙 _SCHEMA.md(§3 고정형식·§6-E·§8-A) · _CHATBOT.md
// 안전: 자기 법 파일만 쓴다. 공유허브(graph·_glossary·comparisons·review_queue)는 읽기만.

export const meta = {
  name: 'maritime-concept-new',
  description: 'statutes 에만 있는 내용을 개념 페이지로 신설(결정 ④⑤). 자기 법 파일만 = 병렬안전.',
  phases: [{ title: '개념신설', detail: '법별 1에이전트: 주제 묶음을 정해 개념 페이지 신설 + 근거 조문 표' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const MANIFEST = {
  type: 'object', required: ['law', 'status', 'created'],
  properties: {
    law: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'nochange', 'failed'] },
    created: { type: 'integer', description: '새로 만든 개념 페이지 수' },
    pages: { type: 'array', items: { type: 'string' }, description: '만든 파일 이름들' },
    rows: { type: 'integer', description: '근거 조문 표에 넣은 행 수(전부 합쳐)' },
    covered: { type: 'integer', description: '이 신설로 챗봇이 닿게 된 statutes 조문 수(대략)' },
    left: { type: 'integer', description: '★아직 statutes 에만 남은 주제 수(정직하게)' },
    left_reason: { type: 'string' },
    important: { type: 'array', items: { type: 'string' }, description: '★사용자 결정이 필요한 것만' },
    note: { type: 'string' },
  },
}

function prompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 **개념 페이지 신설 사서**다. 담당 법: 「${l.name}」 (slug: \`${l.slug}\`)

## 0) 먼저 읽을 것
1. \`${LEGAL}/_SCHEMA.md\` — **§3(개념 페이지 고정형식)**, **§6-E**(챗봇은 개념 페이지의 \`## 근거 조문\` 표에서만 근거를 만든다), **§8-A**(표 작성 체크리스트 ①~③-3)
2. \`${LEGAL}/_CHATBOT.md\` §5(답변경계·정직한 공백·소관부서)
3. **이 법의 현재 상태**: \`${LEGAL}/wiki/statutes/${l.slug}.md\` (원문 정리 허브) + 기존 개념 페이지 \`${LEGAL}/wiki/concepts/${l.slug}__*.md\`

## 1) 왜 하나 (사용자 확정 2026-08-20)
이 법은 **statutes 허브에는 내용이 충실한데 개념 페이지가 ${l.have}개뿐**이다. 챗봇은 개념 페이지의
\`## 근거 조문\` 표에서만 근거를 만들기 때문에, **statutes 에만 있는 내용은 사용자에게 닿지 않는다.**
"위키가 모른다"가 아니라 **"위키는 아는데 챗봇이 못 찾는다"**이다.

사용자 판단: *"수집이 가능하다면 그것은 페이지로 만들어야지 공백으로 놔둘 필요가 있을까?"*
→ 이 법은 자료가 **이미 수집돼 있고 형태도 갖췄다.** 도달만 안 되는 것이니 **페이지를 만든다.**

${l.hint}

## 2) 하는 법
1. \`wiki/statutes/${l.slug}.md\` 를 **끝까지 읽고**, 사용자가 실제로 물을 만한 **주제 묶음**을 뽑는다.
   묶음 기준은 조문 번호 순서가 아니라 **"사용자가 한 번에 묻는 단위"**다(예: "허가받으려면 뭐가 필요한가",
   "위반하면 어떻게 되나", "처분에 불복하려면").
2. 묶음마다 \`wiki/concepts/${l.slug}__<주제>.md\` 를 만든다. **§3 고정형식**을 지킨다 —
   정의 → 적용범위·제외 → 예외 → 의무 → 위반 시 처벌(조·항·호·금액/형량) → 벌칙체계 →
   행정처분 → **## 근거 조문** → ## 타법 연결 → ## 관련 개념 → ## 변경 이력.
3. **\`## 근거 조문\` 표가 이 작업의 핵심이다.** 칸은 넷: **법령명 · 조문 · 시행일 · 요지**.
   - 법령명은 **정식 명칭 전체**. 🚫\`동법\`·\`시행령\`만 쓰기·한 칸에 두 법·화살표(\`→\`)·위키 슬러그 금지.
   - 조문은 **실제 번호**. 🚫\`전체\`·\`전문\`·설명 문장 금지.
   - **★부칙은 반드시 별도 행으로** 뺀다(§8-A ③-3). 일반 조문과 같은 칸에 섞으면 **코드가 그 칸 전체를
     부칙으로 취급해 나머지 조문까지 통째로 근거에서 사라진다.**
   - 시행일은 statutes·raw 에서 확인되면 적고, **확인 안 되면 \`-\`**(지어내지 마라).
4. **내용은 statutes 와 raw 에서만 가져온다.** 새로 지어내지 않는다. statutes 에 있는 서술을 개념 단위로
   재배치하는 일이지 새 지식을 만드는 일이 아니다. 확인 안 되는 것은 안 쓴다.
5. 기존 개념 페이지와 **겹치면 만들지 말고** 그 페이지에 보탠다.
6. 만든 페이지들끼리, 그리고 기존 페이지와 \`[[링크]]\`로 잇는다(\`## 관련 개념\`).
7. frontmatter: \`id\`·\`status\`·\`updated: 2026-08-20\`·\`source_tier\`·\`소관부처\`.
   **status 는 \`draft\` 로 시작한다** — 승격은 별도 절차다(과대 승격 금지).

## 3) 절대 규칙
- 🚫 **자기 법 파일만 쓴다**: \`wiki/concepts/${l.slug}__*.md\` · \`wiki/statutes/${l.slug}.md\` ·
  \`wiki/annexes/${l.slug}__*.md\`. 그 외(다른 법 파일·\`graph.json\`·\`_glossary\`·\`comparisons/\`·
  \`review_queue.md\`·\`_dashboard/\`)는 **읽기만**.
- **환각 0**. raw·statutes 에 없는 수치·조문을 만들지 않는다.
- **statutes 허브를 지우지 않는다.** 개념 페이지는 추가지 이동이 아니다(허브는 그대로 남는다).
- 몇 개를 만들지는 네가 정한다 — **주제가 실제로 갈리는 만큼만**. 억지로 쪼개지 마라.

## 4) 반환(JSON)
law, status, created, pages[], rows, covered, **left**, left_reason, important[], note.
- \`left\` 를 0 으로 적지 마라 — 아직 statutes 에만 남은 주제가 있으면 정직하게 센다.
- \`important[]\` 는 ①시스템·데이터구조 문제 ②사용자 결정이 반드시 필요 ③범위를 넘어선 큰 문제, 이 셋만.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const laws = cfg.laws || []
log(`개념 페이지 신설 대상 ${laws.length}법`)
phase('개념신설')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l), { label: `new:${l.name.slice(0, 10)}`, phase: '개념신설', model: 'sonnet', effort: 'high', schema: MANIFEST })
))).filter(Boolean)
const sum = k => res.reduce((s, r) => s + (r[k] || 0), 0)
return {
  laws: laws.length, created: sum('created'), rows: sum('rows'), left: sum('left'),
  pages: res.flatMap(r => r.pages || []),
  important: res.flatMap(r => (r.important || []).map(i => `${r.law}: ${i}`)),
  per_law: res.map(r => ({ law: r.law, st: r.status, created: r.created, rows: r.rows, left: r.left })),
}
