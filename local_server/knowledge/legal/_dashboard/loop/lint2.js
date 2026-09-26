const path = require('path');
export const meta = {
  name: 'maritime-wiki-lint-round2',
  description: 'lint 2라운드: 백본 정의 허브 신설(영해법 등) + 역링크(비대칭) 보강',
  phases: [
    { title: '정의허브', detail: '피인용 최다 백본 법의 정의 허브 concept 신설' },
    { title: '역링크', detail: '테마허브·정의허브로 향하는 양방향 링크 보강' },
    { title: '비평', detail: '재색인 후 완결성 점검' },
  ],
}
const LEGAL = path.resolve(__dirname, '../..')
const SCHEMA = `${LEGAL}/_SCHEMA.md`

// 피인용 최다 백본 법 — 정의 허브(개념 페이지) 신설/강화
const HUBS = [
  { slug: '영해및접속수역법', law: '영해 및 접속수역법', file: '영해및접속수역법__기선영해접속수역정의',
    terms: '기선(통상·직선)·영해(12해리)·접속수역(24해리)·내수·영해기점', cites: 19,
    why: '19개 법이 영업구역·관할·해리 기준으로 이 법을 인용하는데 정의 concept 페이지가 없어 백링크 착지점이 없음' },
  { slug: '해양환경관리법', law: '해양환경관리법', file: '해양환경관리법__해양오염물질배출정의',
    terms: '해양오염·오염물질·폐기물·기름·유해액체물질·해양시설·배출', cites: 21,
    why: '21개 법이 인용, asym 백링크 수요 1위. 오염/배출/폐기물 정의 허브 필요' },
  { slug: '수산업법', law: '수산업법', file: '수산업법__어업정의허브',
    terms: '어업(면허·허가·신고)·어장·어선·근해/연안/구획어업·마을어업·어업권', cites: 28,
    why: '28개 법이 인용하는 최대 백본. 어업 종류·정의 허브 필요' },
]

function hubPrompt(h) {
  return `너는 SEAGNAL 해양법률 위키의 **lint 사서(정의 허브 신설)**다. \`${SCHEMA}\`의 '정의 우선'·'교차 연결 정합화' 절을 먼저 읽는다.

## 배경
「${h.law}」은 **다른 ${h.cites}개 법이 인용**하는 백본(피인용 허브)인데, ${h.why}. 그래서 이 법의 **핵심 정의를 모은 concept 허브 페이지**를 만든다.

## 절차
1. raw 원문 \`${LEGAL}/raw\`에서 이 법 폴더를 찾아(도메인 하위) 법률.txt의 **제2조(정의) 등**을 읽는다. 정의가 시행령/타법으로 이어지면 그 조문도 읽어 확정(멀티홉).
2. 기존 \`${LEGAL}/wiki/statutes/${h.slug}.md\`와 관련 concept를 읽어 중복을 피하고 링크로 연결.

## 산출물: \`${LEGAL}/wiki/concepts/${h.file}.md\`
- frontmatter(id: concept.${h.slug}.정의허브, status: draft, updated: 2026-07-15, kind: definition-hub, 소관/tier)
- \`# 「${h.law}」 핵심 정의 (백본 허브)\`
- 리드: 이 정의들이 **어느 법들에서 인용되는지**(영업구역·관할·처벌기준 등) 1~2문장.
- **정의 표**: \`| 용어 | 정의(원문 요지) | 근거 조문 | 이 정의를 쓰는 다른 법(예) |\` — 핵심어(${h.terms}) 중심. 각 정의는 출처(제N조) 표기.
- **어떻게 인용되나**: 이 법을 인용하는 대표 법 3~5개가 각각 무엇을 위해 이 정의를 쓰는지(예: "영업구역=영해기선 기준", "오염물질 배출금지 기준") 짧게.
- \`## 관련 개념\`에 statute 허브 [[${h.slug}]]와 관련 테마허브 [[링크]].
- 지어내지 말 것. 원문에 없는 값은 REVIEW.

반환(텍스트): 파일 경로, 정의 항목 수, 인용 관계로 연결한 법 수.`
}

const BACKLINK_PROMPT = `너는 SEAGNAL 위키의 **lint 역링크(양방향 연결) 사서**다. \`${SCHEMA}\`의 '교차 연결 정합화(lint)' 3-(a),(d)를 따른다. 목표: 비대칭 링크를 줄이고, 각 페이지가 자기가 속한 **테마 허브·백본 정의 허브로 되돌아가는 링크**를 갖게 한다.

## 방법 (충돌 방지: 각 파일은 한 번만 편집)
1. \`${LEGAL}/wiki/comparisons/\`의 6개 테마 허브 파일을 각각 읽고, 그 안 '연결된 페이지'의 [[멤버]] 목록을 수집한다. (안전장구·폐기물·야간장비·음주운항·출항통제·검사등록)
2. 각 **멤버 concept/statute 페이지**를 열어, \`## 관련 개념\` 섹션에 자신이 속한 테마 허브 [[comparisons/<테마>]] 링크가 없으면 **한 줄 추가**한다(있으면 skip). 한 페이지가 여러 허브의 멤버면 그 허브들을 **한 번의 편집으로 모두** 추가(같은 파일 중복 편집 금지).
3. 이번에 새로 만든 백본 정의 허브(영해및접속수역법·해양환경관리법·수산업법의 정의허브 concept)가 있으면, 그 법을 인용하는 대표 페이지들의 \`## 타법 연결\` 또는 \`## 관련 개념\`에 정의 허브 [[링크]]를 추가한다(대표 5~10개 페이지로 제한, 과편집 금지).
4. 편집은 링크 한 줄 추가만. 본문 값·처벌 수치는 건드리지 않는다.

반환(텍스트): 편집한 파일 수, 추가한 역링크 수, 테마별 처리 요약.`

// 실행
phase('정의허브')
const hubs = await parallel(HUBS.map(h => () =>
  agent(hubPrompt(h), { label: `defhub:${h.slug}`, phase: '정의허브', effort: 'medium' })))

phase('역링크')
const back = await agent(BACKLINK_PROMPT, { label: 'backlinks', phase: '역링크', effort: 'medium' })

phase('비평')
const critic = await agent(
  `너는 lint 완결성 비평가(2라운드)다. \`${LEGAL}/_dashboard/lint_todo.md\`를 읽고, 이번 2라운드에서 (1)백본 정의 허브 3종 신설 (2)테마허브 역링크 보강이 됐다는 전제로, **아직 남은 과제**를 갱신하라: 신고_허가_면허 3분해, 나머지 백본 법(공유수면·항만법·선박안전법) 정의 허브, 잔여 asym 갭, 행정규칙(고시)·자치법규(조례) 미수집, draft→canonical 승인. \`${LEGAL}/_dashboard/lint_todo.md\`를 갱신(2라운드 반영)하고, 반환으로 남은 상위 5과제를 요약하라. 진단·기록만.`,
  { label: 'critic-r2', phase: '비평', effort: 'medium' })

return { defhubs: hubs.filter(Boolean).length, hub_reports: hubs.filter(Boolean), backlinks: back, critic }
