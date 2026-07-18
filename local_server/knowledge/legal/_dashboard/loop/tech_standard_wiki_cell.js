// tech_standard_wiki_cell.js — 기술기준(설비·구조 고시) 기준법-급 위키 구축 셀
// 역할(초보자용): 선박설비·구명·소방·전기·구조·어선설비/기관 등 "내 배에 뭘 갖춰야 하나"의 실제 답이 되는
//   기술기준 행정규칙을, 기준법과 동일한 깊이(정의→적용범위(선종·톤수)→의무항목(조·별표)→처벌연결→소관부서)의
//   개념 페이지로 만든다. 원문(raw)은 이미 전문 수집돼 있고, 이 셀은 그 원문을 "답할 수 있는 위키"로 정리한다.
// [연계] 원문 raw/**/행정규칙/<기준>.txt · 출력 wiki/concepts/<기준>.md · 규칙 _SCHEMA.md 0-A(기술기준=기준법-급)
//        · 상위 기준법 wiki/statutes/{선박안전법,어선법}.md(상호링크는 호출측이 별도 처리)
// [로드 순서] Workflow 단독 실행(백그라운드). map_scope/collect_fix 이후 단계.
// 사용자 확정(2026-07-18): "행정규칙(기술기준)도 기준이 되는 법과 동일하다고 보면 돼" → 기준법-급 위키 필수.

export const meta = {
  name: 'tech-standard-wiki',
  description: '기술기준(설비·구조 고시)을 기준법-급 개념 위키로 구축',
  phases: [{ title: 'Build', detail: '기준별 개념 페이지 병렬 생성' }],
}

// 12개 주요 기술기준 — (기준명, 상위 기준법). 원문 경로는 에이전트가 find로 스스로 확정(경로 불확실성 흡수).
const STANDARDS = [
  { name: '선박설비기준', parent: '선박안전법', kw: '선박설비기준' },
  { name: '선박구명설비기준', parent: '선박안전법', kw: '선박구명설비기준' },
  { name: '선박소방설비기준', parent: '선박안전법', kw: '선박소방설비기준' },
  { name: '선박전기설비기준', parent: '선박안전법', kw: '선박전기설비기준' },
  { name: '선박만재흘수선기준', parent: '선박안전법', kw: '선박만재흘수선기준' },
  { name: '강선의 구조기준', parent: '선박안전법', kw: '강선의구조기준' },
  { name: '강화플라스틱(FRP)선의 구조기준', parent: '선박안전법', kw: '강화플라스틱' },
  { name: '알루미늄선의 구조기준', parent: '선박안전법', kw: '알루미늄선' },
  { name: '어선구조기준', parent: '어선법', kw: '어선구조기준' },
  { name: '어선설비기준', parent: '어선법', kw: '어선설비기준' },
  { name: '어선기관기준', parent: '어선법', kw: '어선기관기준' },
  { name: '어선복원성 및 만재흘수선 기준', parent: '어선법', kw: '어선복원성' },
]

const ROOT = '/home/user/SEAGNAL/local_server/knowledge/legal'

const SCHEMA = {
  type: 'object',
  required: ['standard', 'page_path', 'status'],
  properties: {
    standard: { type: 'string' },
    page_path: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'failed'] },
    raw_source: { type: 'string' },
    scope_summary: { type: 'string' },      // 적용범위 요약(선종·톤수)
    duty_items: { type: 'number' },         // 의무항목 수
    tables: { type: 'number' },             // 별표 수
    forms: { type: 'number' },              // 서식 수
    penalty_link: { type: 'string' },       // 처벌연결(상위법 벌칙조문)
    dept: { type: 'string' },               // 소관부서·연락처
    still_missing: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
}

function promptFor(s) {
  return `너는 한국 해사법률 위키 사서다. 기술기준 행정규칙 「${s.name}」을 **기준법과 동일한 깊이의 개념 페이지**로 만든다.
사용자 확정 규칙: 이 기술기준은 상위 기준법(${s.parent})과 동일한 수준으로 취급한다("내 배에 뭘 갖춰야 하나"의 실제 답).

작업 루트: ${ROOT}

## 1) 원문 찾기·읽기
- \`find raw -path '*행정규칙*' -iname '*${s.kw}*.txt'\` 로 원문 파일을 찾는다(여러 개면 가장 큰=가장 완전한 현행본 선택, 경로를 raw_source에 기록).
- 파일이 크면 먼저 \`grep -n '^제.*조\\|^제.*장\\|^\\[별표\\|^\\[별지\\|^\\[서식'\` 로 목차(장·절·조·별표·서식)를 뽑아 구조부터 파악하고, 필요한 구간만 Read로 정독한다. **전문을 그대로 옮겨 적지 말 것** — 원문은 이미 raw에 있다. 이 페이지는 "찾아 답하는 항해도"다.
- 상위 기준법 위임근거: \`grep -n '${s.kw}\\|위임\\|고시' raw/**/${s.parent}/*.txt\` 및 위키 \`wiki/statutes/${s.parent}.md\`, \`wiki/concepts/${s.parent}__*.md\` 에서 이 기준을 위임한 조문(예: 선박안전법 제26조, 어선법 제3조 등)과 **위반 시 벌칙 조문**을 찾는다.
- 소관부서·연락처: 원문 파일 상단 메타 또는 같은 폴더 _meta.json, 없으면 상위 기준법 statutes 페이지의 소관부서를 쓴다.

## 2) 페이지 작성 — 정확히 이 포맷 (기존 기준법 개념과 동일)
경로: \`wiki/concepts/${s.name.replace(/[()\\/ ]/g, '')}.md\` (파일명에 공백·괄호·슬래시 제거)

\`\`\`
---
id: concept.${s.parent}_${s.kw}
status: canonical
updated: 2026-07-18
source_tier: 2
소관부처: <소관부처>
소관부서: <소관부서>
연락처: <연락처>
상위기준법: ${s.parent}
---

# 「${s.name}」 — <한 줄 성격>

> **기준법-급 기술기준.** "내 배(<선종>)에 <설비/구조>가 의무인가"에 답하는 근거. 상위 「${s.parent}」 제N조 위임. (원문 전량: raw/.../${s.kw}.txt)

## ★ 적용범위 (내 배에 적용되나) — 가장 중요
| 적용대상(선종·톤수·항행구역·용도) | 제외 | 근거 조문 |
|---|---|---|
| … | … | 제N조 |
(이 기준이 어떤 배에 적용되고 어떤 배는 빠지는지를 톤수·선종·항행구역별로 표로. 이게 이 페이지의 핵심.)

## ★ 정의부터
| 용어 | 정의 | 근거 |
|---|---|---|
(기준 이해에 필요한 핵심 용어만)

## 핵심 의무 항목 (설비/구조 유형별 — 조·별표 인덱스)
설비/구조 유형별로 "무엇을 어떻게 갖춰야 하는가"를 **조문·별표 번호와 함께** 인덱싱. 수치·규격은 원문 그대로. 예:
- **구명뗏목**: 제N조 — <요건 요약> (상세 수치: [별표 N])
- **소화장치**: 제M조 — … ([별표 M])
※ 별표에 규격표가 있으면 "상세: [별표 N] (raw 보유)"로 가리키되 핵심 수치는 발췌.

## 관련 별표·서식
- 별표: [별표 N] <제목> — <무엇을 규정>
- **서식(있으면)**: 「<서식명>」 [⬇ 다운로드] — raw 원본 보존(_SCHEMA 0-A: 서식 원버튼 다운로드 대상)

## 위반 시 (처벌 연결)
이 기준 위반이 상위 기준법의 어느 벌칙으로 가는지 **조·항·호·금액 그대로**. (기술기준 자체엔 벌칙 없음 → 상위법 검사불합격·항행정지·벌칙 조문으로 연결)

## 소관부서 (답변 마무리)
<소관부서> (☎ <연락처>) — _CHATBOT.md 5-4.
\`\`\`

## 3) 규칙 (필수)
- **환각 0**: 조문·별표 번호, 수치·규격은 원문에 있는 것만. 못 찾으면 still_missing에 적고 지어내지 말 것.
- **적용범위 표를 최우선**으로 채운다(사용자가 "내 배에 적용되나"를 여기서 판정).
- 처벌은 상위 기준법 원문 대조로 정확히. 애매하면 still_missing.
- 🚫 **.claude/ 디렉터리는 절대 건드리지 말 것.** raw/·wiki/ 안에서만 작업.
- 기존에 같은 파일이 있으면 덮어쓰지 말고 내용 비교 후 보강(대개 없음).

작업 후 스키마대로 결과를 반환한다(page_path는 ROOT 기준 상대경로).`
}

// args.only(단일 kw) 지정 시 그 기준만 빌드 → 각 기준을 별도 최상위 워크플로로 띄워 진짜 병렬(35파도식) 가능.
// args가 객체/문자열 어느 쪽으로 와도 견디게 파싱(문자열이면 JSON.parse, 그래도 안되면 그 자체를 kw로).
let parsedArgs = args
if (typeof args === 'string') {
  try { parsedArgs = JSON.parse(args) } catch (e) { parsedArgs = { only: args } }
}
const onlyKw = parsedArgs && parsedArgs.only
log(`tech-standard-wiki: onlyKw=${onlyKw || '(전체)'} · argsType=${typeof args}`)
const TARGETS = onlyKw ? STANDARDS.filter((s) => s.kw === onlyKw) : STANDARDS

phase('Build')
const results = await parallel(
  TARGETS.map((s) => () =>
    agent(promptFor(s), {
      label: `tech:${s.kw}`,
      phase: 'Build',
      model: 'claude-sonnet-5',
      schema: SCHEMA,
    })
  )
)

const ok = results.filter(Boolean)
return {
  built: ok.filter((r) => r.status === 'done').length,
  partial: ok.filter((r) => r.status === 'partial').length,
  failed: ok.filter((r) => r.status === 'failed').length,
  total: STANDARDS.length,
  pages: ok.map((r) => ({ standard: r.standard, path: r.page_path, status: r.status, missing: r.still_missing || [] })),
}
