export const meta = {
  name: 'maritime-wiki-lint-hubs',
  description: '교차 연결 정합화(lint 3단계): 테마 허브 생성 + glossary 병합 + 완결성 비평',
  phases: [
    { title: '테마허브', detail: '법 넘나드는 공통 고리를 비교표 허브로' },
    { title: '병합·비평', detail: 'glossary 병합 + 완결성 비평' },
  ],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const SCHEMA = `${LEGAL}/_SCHEMA.md`

const THEMES = [
  { slug: '안전장구_구명설비', title: '안전장구·구명설비', terms: '구명조끼·구명동의·인명안전장비·구명부환·자기점화등·구명줄', hint: '어선안전조업법·낚시관리법·수상레저안전법·유선및도선사업법·수상레저기구등록법 등에서 대상(톤수·조업형태)별로 요구 장비가 다름' },
  { slug: '폐기물_해양오염', title: '폐기물·해양오염 투기/배출', terms: '폐기물·해양오염·오염물질·배출·투기·수산부산물·기름·분뇨', hint: '정의(생활/사업장, 선박/육상)가 처벌을 가름. 해양환경관리법·해양폐기물및해양오염퇴적물관리법·폐기물관리법·수산부산물재활용법. 기존 draft(사업장폐기물·어촌계·바다폐기물투기) 흡수' },
  { slug: '야간운항_장비', title: '야간운항 장비', terms: '야간·일몰·일출·항해등·조도·등화', hint: '낚시관리법·수상레저안전법·유선및도선사업법. 기존 draft(낚시어선야간설비·수상레저야간운항·유도선야간운항) 흡수' },
  { slug: '음주운항_측정거부', title: '음주운항·측정거부', terms: '음주·혈중알코올·주취·측정거부', hint: '해상교통안전법(형벌)·선박직원법(면허 별표2)·도선법·유선도선법·수상레저안전법·낚시관리법. 형벌+행정처분 3축' },
  { slug: '출항통제_기상특보', title: '출항통제·기상특보', terms: '출항통제·기상특보·풍랑·출항제한·조업제한', hint: '해상교통안전법·어선안전조업법·연안사고예방법·유선도선법·수상레저안전법. 톤수·기상 구간별' },
  { slug: '검사_등록', title: '선박 검사·등록', terms: '선박검사·어선검사·등록·검정·안전검사·검사증서', hint: '선박안전법·어선법·수상레저기구의등록및검사법. 대상 선박(톤수·용도)별 검사 종류·주기' },
]

function hubPrompt(t) {
  return `너는 SEAGNAL 해양법률 위키의 **교차 연결(lint) 사서**다. \`${SCHEMA}\`의 '교차 테마 허브'와 '교차 연결 정합화(lint)' 절을 먼저 읽는다.

## 임무: "${t.title}" 교차 테마 허브 1개 작성
여러 법에 흩어진 **같은 성격의 규정("${t.title}")을 한 페이지로 묶어**, 사용자가 이 테마로 물으면 즉답이 되게 한다.

## 절차
1. \`${LEGAL}/wiki/statutes\` 와 \`${LEGAL}/wiki/concepts\` 에서 이 테마 관련 페이지를 **Grep으로 찾는다**(핵심어: ${t.terms}). 힌트: ${t.hint}.
2. 찾은 페이지들을 실제로 **읽어**, 이 테마의 **실질 의무/기준을 규정한 법만** 고른다(스치듯 언급한 법은 제외).
3. \`${LEGAL}/draft\` 에 관련 손작업 견본이 있으면 읽어 내용을 흡수(중복 생성 금지, 링크로 연결).

## 산출물: \`${LEGAL}/wiki/comparisons/${t.slug}.md\`
- frontmatter(id: comparison.${t.slug}, status: draft, updated: 2026-07-15, kind: theme-hub)
- \`# ${t.title} — 법별 비교 (교차 허브)\`
- 리드: 이 테마가 어느 법들에 걸치는지 1~2문장 + "정의가 결과를 가른다"면 그 점 명시
- **핵심 비교표**: \`| 법령 | 조문 | 적용대상(톤수·조업형태·지역) | 요구사항/기준 | 처벌(정확한 조·항·금액) | 시행일 |\` — 각 행은 실제 페이지에서 확인한 값. 확정 어려운 셀은 \`REVIEW\`.
- **연결된 페이지**: 각 멤버 statute/concept를 \`[[파일명]]\`(확장자 없이)으로 나열 — 양방향 탐색용.
- **프로필 필터 가이드**: 톤수·조업형태·지역별로 어떤 법/기준이 적용되는지 짧게(챗봇이 프로필로 바로 필터).
- 모든 수치·처벌은 출처(법령 제N조) 표기. 없는 값 지어내지 말고 REVIEW.

반환(텍스트): 만든 파일 경로, 포함한 법 수, 비교표 행 수, REVIEW 셀 수.`
}

// 실행
phase('테마허브')
const hubs = await parallel(THEMES.map(t => () =>
  agent(hubPrompt(t), { label: `hub:${t.slug}`, phase: '테마허브', effort: 'medium' })
))

phase('병합·비평')
const glossPath = '/tmp/claude-0/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/scratchpad/gloss_cands.json'
const results = await parallel([
  () => agent(`너는 lint 사서다. \`${glossPath}\`(JSON: [{term,concept,law}])를 Read로 읽고, \`${LEGAL}/wiki/_glossary.md\`를 읽어, 구어·별칭→개념 라우팅 항목을 **중복 없이** 표에 추가한다(이미 있으면 skip, 표 형식 유지). 335개 후보 중 의미 있는 구어/별칭만(법령 정식명칭 중복은 제외). 반환: 추가한 항목 수.`,
    { label: 'glossary-merge', phase: '병합·비평', effort: 'low' }),
  () => agent(`너는 lint **완결성 비평가**다. \`${LEGAL}/_dashboard/build_index.md\`와 \`${LEGAL}/_dashboard/lint_report.json\`을 읽고, \`${LEGAL}/wiki/comparisons\`(방금 생성된 테마 허브 포함)를 훑어라. 질문: (1) 2법 이상 걸리는데 허브가 없는 교집합 테마가 남았나? (2) 공통 인용 타법(수산업법·선박안전법 등) 중 정의 허브 페이지가 약한 곳은? (3) 비대칭 링크갭 408건 중 우선 보강할 상위 테마는? 발견을 \`${LEGAL}/_dashboard/lint_todo.md\`에 '다음 lint 라운드 과제'로 6절 형식으로 기록하고, 반환으로 상위 5개 과제를 요약하라. 파일을 새로 대량 생성하진 말고 진단·기록만.`,
    { label: 'completeness-critic', phase: '병합·비평', effort: 'medium' }),
])

return {
  hubs: hubs.filter(Boolean).length,
  hub_reports: hubs.filter(Boolean),
  glossary: results[0],
  critic: results[1],
}
