/**
 * gap6e_fix.js — 고정 문제집이 "위키에 근거 행이 없다(§6-E)"고 찍은 문항을 법마다 한 명씩 고친다.
 *
 * 무엇을 하나: pinned/golden_gaps.md 의 §6-E 목록을 법 단위로 묶어, 법마다 사서 에이전트 1명에게
 * "그 조문의 근거 행을 알맞은 개념 페이지의 '## 근거 조문' 표에 넣어라"고 시킨다.
 * ⚠병렬안전: 에이전트는 **자기 법 이름으로 시작하는 위키 파일만** 고친다(공유 파일 쓰기 없음).
 *
 * [연계]
 *   ← pinned/golden_gaps.md (golden_eval.js 스냅샷에서 뽑은 안 닿는 문항 명단)
 *   → wiki/concepts/<법>__*.md 의 '## 근거 조문' 표
 *   → golden_eval.js(V5-7)·reach_eval.js(V5-5)로 결과 확인
 * [로드 순서] Workflow 도구가 이 파일을 스크립트로 실행한다.
 */
export const meta = {
  name: 'gap6e-fix',
  description: '고정 문제집이 §6-E(위키에 근거 행 없음)로 찍은 10건을 법마다 한 명씩 보강',
  phases: [{ title: '보강', detail: '법마다 사서 1명 — 자기 법 페이지만 수정' }],
};

const LAWS = args.laws;

const SCHEMA = {
  type: 'object',
  required: ['law', 'items'],
  properties: {
    law: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['expect', 'action', 'file', 'detail'],
        properties: {
          expect: { type: 'string', description: '기대 근거(법령 조문)' },
          action: { type: 'string', enum: ['행추가', '이미있음', '못함'],
                    description: '행추가=표에 넣음 / 이미있음=이미 있어 안 건드림 / 못함=근거가 원문에 없거나 다른 법 소관' },
          file: { type: 'string', description: '고친(또는 확인한) 위키 파일 경로' },
          detail: { type: 'string', description: '무엇을 어떻게 했는지 — 넣은 행 원문 그대로 포함' },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

phase('보강');
const out = await parallel(LAWS.map(L => () => agent(
  '당신은 나리야(해양수산 법률 챗봇) 위키의 사서다. 담당 법: **' + L.name + '**\n' +
  '\n# 배경 — 먼저 읽어라\n' +
  '- <저장소뿌리>/CLAUDE.md\n' +
  '- <저장소뿌리>/local_server/knowledge/legal/_SCHEMA.md 의 §6-E 와 §8-A (근거 조문 표 규격)\n' +
  '- <저장소뿌리>/local_server/knowledge/legal/_LESSONS.md (같은 실수 반복 금지)\n' +
  '\n# 왜 이 일을 하나\n' +
  '고정 문제집(golden set)을 돌렸더니, 아래 문항의 **기대 근거 조문이 위키의 어느 "## 근거 조문" 표에도\n' +
  '행으로 없어서** 챗봇이 근거를 못 댄다. 이 표가 챗봇 답변의 "근거 법령" 목록을 만드는 재료다\n' +
  '(services/legal_retriever.js 의 extractCitationChain). 내용이 본문 산문에 있어도 **표에 행이 없으면\n' +
  '근거로 안 나간다.**\n' +
  '\n# 담당 문항 (' + L.items.length + '건)\n' +
  L.items.map((it, i) => (i + 1) + '. 질문: ' + it.q + '\n   기대 근거: ' + it.want).join('\n') + '\n' +
  '\n# 할 일 (문항마다)\n' +
  '1. **원문을 먼저 읽어라.** raw 폴더: ' + L.raw + '\n' +
  '   그 조문이 **실제로 존재하고 그 질문에 답하는지** 본문을 읽고 확인한다. grep 결과나 기억으로 판단하지 마라.\n' +
  '   - 원문에 그 조문이 없거나, 그 조문이 질문과 무관하거나, 실은 **다른 법 소관**이면\n' +
  '     → 표에 넣지 말고 action="못함" 으로 그 사실을 정확히 보고하라. **지어내지 마라.**\n' +
  '2. **그 근거가 들어갈 개념 페이지를 찾아라.** wiki/concepts/ 에서 "' + L.slug + '__*.md" 를 훑어\n' +
  '   주제가 가장 맞는 페이지를 고른다. 이미 그 (법령, 조문) 행이 있으면 action="이미있음" 으로 보고하고 끝낸다.\n' +
  '   - 알맞은 개념 페이지가 아예 없으면, 새 페이지를 만들지 말고 action="못함" 으로 그 사정을 보고하라\n' +
  '     (페이지 신설은 이번 작업 범위 밖이다).\n' +
  '3. **"## 근거 조문" 표에 행을 추가하라.** 규격(_SCHEMA §5·§8-A):\n' +
  '   - 칸: | 법령명 | 조문 | 시행일 | 요지 |  — 그 페이지의 기존 표 칸 수·순서에 맞춘다.\n' +
  '   - **법령명 칸은 정식 명칭 전체**를 쓴다("시행규칙" 한 낱말 금지 — 어느 법인지 특정 안 돼 탈락한다).\n' +
  '     계층까지 정확히: 법률이면 법 이름, 시행령이면 "○○법 시행령", 행정규칙이면 그 규칙 이름.\n' +
  '   - **조문 칸에는 조문 표기만** 쓴다(제6조 / 제8조의2제2항 같은 꼴). 설명이나 "일반원칙" 같은 말을 넣으면\n' +
  '     그 행은 인용 후보가 될 수 없다(V5-5 게이트가 잡는다).\n' +
  '   - 시행일은 raw 에서 확인한 날짜를 쓴다. 모르면 — 로 둔다(지어내지 마라).\n' +
  '   - 요지는 원문에서 확인한 내용을 한 줄로. **원문 발췌를 쓸 때는 복붙이다 — 다듬지 마라**(L-148).\n' +
  '4. 본문에 그 내용 서술이 없으면 짧게 한 줄 덧붙여도 좋다. **다만 원문에 있는 것만.**\n' +
  '\n# 반드시 지킬 것\n' +
  '- ⚠**"' + L.slug + '" 로 시작하는 위키 파일만 고쳐라.** 다른 법 파일·공유 파일은 절대 건드리지 마라\n' +
  '  (여러 에이전트가 동시에 돌고 있다 — 병렬 경합으로 데이터가 날아간다).\n' +
  '- golden_questions.json · golden_gaps.md 등 pinned/ 파일은 **읽기만** 하라.\n' +
  '- 확인 못 한 것을 확인했다고 하지 마라. 못 찾았으면 못 찾았다고 보고하라.\n' +
  '- 끝나면 넣은 행을 **원문 그대로** detail 에 담아 보고하라(내가 검산한다).\n',
  { label: '6e:' + L.slug.slice(0, 12), phase: '보강', schema: SCHEMA })));

const rows = out.filter(Boolean);
const all = rows.flatMap(r => (r.items || []).map(i => Object.assign({ law: r.law }, i)));
return {
  laws: rows.length,
  items: all.length,
  added: all.filter(i => i.action === '행추가').length,
  already: all.filter(i => i.action === '이미있음').length,
  failed: all.filter(i => i.action === '못함').length,
  detail: all.map(i => i.law + ' · ' + i.expect + ' · ' + i.action + ' · ' + i.file + ' — ' + i.detail),
  notes: rows.flatMap(r => r.notes || []),
};
