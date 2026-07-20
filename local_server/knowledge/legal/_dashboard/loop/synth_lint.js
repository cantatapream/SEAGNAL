// synth_lint.js — 통합수정 후 공유허브(신경망)를 단독으로 재봉합한다(H-9 lint). ⚠경합위험이라 반드시 단독.
// 역할(초보자용): 각 법 통합수정이 "필요하다"고 모아둔 hub_needs(비교허브·정의허브)를 실제로 만들고,
//   회원 개념 페이지에서 그 허브로 역링크를 걸어 비대칭을 해소한다. graph.json은 별도 파이썬으로 재생성.
// [연계] 입력 _dashboard/hub_needs_r7.json + wiki/concepts/** · 출력 wiki/comparisons/**(신규) + 역링크
// [로드 순서] Workflow 단독(동시 1). fix 70/70 후. 공유파일(comparisons/·_glossary) 쓰기라 절대 병렬 금지.

export const meta = {
  name: 'maritime-lint-hubs',
  description: '통합수정 후 공유 비교허브 신설+역링크(신경망 재봉합, 단독)',
  phases: [{ title: '린트', detail: 'hub_needs로 comparisons 허브 신설·역링크·비대칭 해소' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const SCHEMA = {
  type: 'object', required: ['hubs_created'],
  properties: {
    hubs_created: { type: 'integer' },
    hub_files: { type: 'array', items: { type: 'string' } },
    backlinks_added: { type: 'integer' },
    note: { type: 'string' },
  },
}

const prompt = `너는 SEAGNAL 해양법률 위키의 **린트 사서(단독)**다. 통합수정이 모아둔 hub_needs를 실제 공유 비교허브로 만들어 신경망을 꿰맨다.

## 0) 먼저 읽을 것
1. \`${LEGAL}/_SCHEMA.md\` 3·5·6절(비교허브 형식·정의허브·톤수/조업형태/지역 조건 컬럼·status).
2. \`${LEGAL}/_dashboard/hub_needs_r7.json\` — 각 법 통합수정이 "필요"라고 남긴 공유허브 목록(14건). Read해서 **중복·유사한 것을 묶어** 실제 허브 후보로 정리한다.

## 1) 비교허브 신설 (핵심)
- hub_needs에서 **여러 법이 공통으로 요청하거나 규모 큰 테마**부터 \`${LEGAL}/wiki/comparisons/<테마>.md\`로 만든다(가능한 만큼, 최소 상위 6개).
  - 예상 최우선: 신고_허가_면허(행정행위 강도 3분해)·위판장_도매시장_공판장·형사절차_일반(공소시효·미수·경합범)·CCTV_개인정보·항만개발_환경규제경합·검사_등록.
- **허브 형식(SCHEMA 3·6절)**: 각 법의 해당 개념 페이지를 \`[[링크]]\`로 모으고, **톤수·조업형태·지역·요건 조건 컬럼**을 둔 비교표. 출처(제N조) 필수. 방대하게 만들지 말고 사용자에게 의미있는 축으로.
- 만든 비교허브의 status: 처벌·안전수치 없는 순수 비교표면 \`canonical\`, 아니면 \`draft\`(H-12② 이원화).

## 2) 역링크(비대칭 해소)
- 새 허브의 회원이 되는 각 법 concept 페이지 하단 \`## 관련 개념\`에 그 허브로 \`[[링크]]\`를 추가(A↔허브 양방향). raw 근거 없는 내용은 넣지 말고 링크만.

## 3) 규칙
- 🚫 이 작업은 **단독**이다(다른 fix/감사와 동시 아님 — 이미 보장됨). \`.claude/\` 금지.
- **환각 0**: 비교표 셀 값은 각 법 원문/기존 위키에 있는 것만. 모르면 "확인필요" 표기.
- graph.json은 만지지 마라(별도 파이썬 재생성).
- 완료 후 Bash로 마커: \`printf 'r7 lint done\\n' > ${LEGAL}/_dashboard/fix3/_wiki_lint7.done\`.

## 4) 반환(JSON): hubs_created, hub_files[], backlinks_added, note.`

phase('린트')
const res = await agent(prompt, { label: 'lint-hubs', phase: '린트', model: 'sonnet', effort: 'high', schema: SCHEMA })
return res || { hubs_created: 0, note: 'agent null' }
