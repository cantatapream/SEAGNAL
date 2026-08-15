export const meta = {
  name: 'wiki-qa-audit',
  description: '위키 커버리지 감사(3차+): 법별 600문항(해양경찰관·일반인·해양종사자 3페르소나, 직전 미흡분 재질문+신규)→위키만으로 답변 시도→구멍 분류',
  phases: [{ title: '감사', detail: '법마다 에이전트가 300문항 생성·답변·구멍 분류, 상세는 파일 저장' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const SCHEMA = {
  type: 'object', required: ['law', 'total_questions', 'verdicts', 'method_compliance'],
  properties: {
    law: { type: 'string' },
    total_questions: { type: 'integer' },
    by_type: { type: 'object' },  // T1..T7 개수
    verdicts: {  // 판정별 개수
      type: 'object',
      properties: {
        full: { type: 'integer' }, thin: { type: 'integer' }, missing: { type: 'integer' },
        collection_hole: { type: 'integer' }, awkward: { type: 'integer' },
        scope_out: { type: 'integer' }, // H-21: 원래 이 위키 목적이 아닌 질문(강학상 이론·타법 세부실무·판례해석) — 결함 아님, full율 분모에서 제외. _SCHEMA.md §6-A 기준
        // H-26(2026-07-26, 사용자 확정): 판정 5종 원인 세분화 — _SCHEMA.md §6-B 기준
        thin_wiki_lag: { type: 'integer' },        // thin 중 원문엔 있는데 위키 미반영(재수집 불필요, 즉시 반영 가능)
        thin_content_gap: { type: 'integer' },      // thin 중 원문 자체에도 부족(재수집 필요/원문한계)
        collection_hole_genuine: { type: 'integer' },   // 위임근거는 있으나 하위 고시 자체가 미제정(진짜 원문공백)
        collection_hole_structural: { type: 'integer' },// 관보·타 정부시스템 소관이라 구조적으로 수집 불가(H-22)
        collection_hole_uncollected: { type: 'integer' },// 수집 가능한데 아직 수집 안 함(재수집 트랙 대상)
        scope_out_answered_gracefully: { type: 'integer' }, // scope_out 중 위키가 "범위밖/규정없음, 소관부서 문의" 안내를 실제로 제공할 수 있는 것(=정상동작, success로 재평가)
        collection_hole_answered_gracefully: { type: 'integer' }, // collection_hole (a)/(b) 중 위임체인+경계선언+연락처 3요건 충족해 full로 재평가된 것(H-30, (c)uncollected는 대상 아님)
      },
    },
    // 답변방식 준수 감사 — 우리가 요구한 답변 규칙이 위키에 반영됐나. 각 값 'ok'|'weak'|'missing'|'na'
    method_compliance: {
      type: 'object',
      properties: {
        정의우선: { type: 'string' },        // 정의·적용범위·적용제외 3조각 최상단
        행정처분차수: { type: 'string' },     // 1/2/3/4차 escalation 표(별표대로)
        벌칙항별구간: { type: 'string' },     // 같은 조문 항별 형량 분리
        처벌정밀도: { type: 'string' },       // 조·항·호·금액 정확
        타법연결: { type: 'string' },         // 타법 연결 표(정밀인용/포괄준용/위임)
        프로필조건: { type: 'string' },       // 적용범위·예외에 톤수·조업형태 조건 컬럼
        점진공개구조: { type: 'string' },     // 다차수 처벌을 통상1차→확장으로 나눠 답할 데이터 구조
        출처표기: { type: 'string' },         // 모든 서술에 (법령 제N조, 시행일)
      },
    },
    method_notes: { type: 'array', items: { type: 'string' } },     // 답변방식 미흡 구체 지적
    wiki_gaps: { type: 'array', items: { type: 'string' } },        // 위키에 없는/얇은 주제
    collection_holes: { type: 'array', items: { type: 'string' } }, // 별표·고시 등 원문 수집 구멍
    answer_issues: { type: 'array', items: { type: 'string' } },    // 답변 구조/매끄러움 문제
    audit_file: { type: 'string' },
  },
}

function prompt(l, round) {
  const r3 = round >= 3 ? `

## ★★재감사 ${round}라운드 — 약점 집중 + 3페르소나 (사용자 확정 설계)
\`${LEGAL}/_dashboard/audit/${l.slug}.md\`(직전 감사)를 **반드시 Read**한다. 그 리포트의 판정을 이렇게 쓴다:
- **직전 full(✅ 잘 답한) 문항·논점은 제외**한다(다시 묻지 않음 — 이미 통과).
- **직전 thin(⚠)·missing(❌)·collection_hole(📛)로 막혔던 논점은 반드시 재질문**(수정이 실제로 막았는지 회귀 확인).
- 여기에 **수준별 신규 질문**을 더한다. **목표: 이 법 총 600문항 = (직전에 미흡했던 것 재질문: thin·missing·hole 전부) + (신규 질문)**, 아래 3페르소나 합산(★H-23 사용자 확정 2026-07-21 — 페르소나 개편):
  - **해양경찰관(단속·처벌 실무)**(약 1/3): 정밀도는 변호사/전문가급이되, **소송에서 다툴 법리가 아니라 현장·조사 단계에서 경찰관이 실제로 확인해야 하는 것** 위주 — 처벌요건 충족여부, 과태료 금액 산정·감경가중 사유, 행정처분(면허취소·정지 등) 재량범위·절차(청문·의견제출), 몰수·양벌규정 적용범위, 소급·공소시효, 조사·증거 요건, 불복(이의신청·행정심판·행정소송) 절차 등. (구 "변호사/전문가" 페르소나를 대체 — 나리야가 해양경찰 실무 지원 목적이라 추상적 법리비교보다 단속·처벌·행정처분 실무질문 비중을 높임)
  - **일반인**(약 1/3): 처음 배 산 사람·초보 낚시인·귀어인의 막연·구어 질문, 오해하기 쉬운 지점.
  - **해양종사자**(약 1/3): 실제 조업·운항·양식 현장의 실무 질문(신고 타이밍·장비·구역·단속 대응 등).
  - **★구체적 역할·상황 부여(사용자 확정 2026-07-27)**: 위 3페르소나 각각, 질문을 추상적으로 뭉뚱그리지 말고 **1인칭 구체적 인물·상황**으로 던진다. 같은 법이라도 역할에 따라 적용되는 조문·의무가 달라지는 지점을 의도적으로 노린다. 예(낚시관리및육성법이면): 해양종사자="나는 5톤 낚시어선을 운영하는 사업자인데 승선정원을 넘겨 태워도 되나?" vs 일반인="낚시어선에 손님으로 탔는데 구명조끼 안 주면 누구 책임이야?"; 해양경찰관="정박 중인 무등록 낚시어선을 단속 중인데 현장에서 뭘 확인해야 압류·고발 요건이 갖춰지나?" vs "사고 신고 받고 출동했는데 선장이 음주 정황이면 조사 절차가 어떻게 되나?". 매 질문마다 이런 구체성을 요구하는 건 아니되(막연한 정의성 질문도 필요), **T4(적용범위/정의 갈림)·T5(예외/조건)·T3(별표 조건) 유형은 특히 역할·상황을 구체화**해 위키의 프로필조건 데이터(톤수·조업형태·지위 등)가 실전에서 실제로 갈라지는지 검증한다.
- **★600문항은 매 라운드 하드 목표다(H-21 사용자 확정, 2026-08-15 300→600 상향)**. "누적으로 이미 600 넘었으니 이번엔 적게 내도 된다"는 판단은 틀렸다 — 카파시 padding금지 원칙은 "가짜 중복질문을 지어내지 말라"는 뜻이지 "사용자가 정한 수치목표를 스스로 낮춰도 된다"는 뜻이 아니다. T1~T7×3페르소나 조합으로 이 법 조문·별표·고시를 훑으면 600개는 대개 뽑힌다. 위키 페이지 자체가 1~2개뿐인 극소수 tier2 참고법만 예외(사유를 감사파일에 명시).
- **★scope_out 판정 추가(H-21, \`_SCHEMA.md\` §6-A)**: 질문이 이 법 조문에 없는 강학상 이론비교·타법 세부실무·판례해석 심층분석이면 missing이 아니라 \`scope_out\`으로 판정(결함 아님, 반환 verdicts에 \`scope_out\` 필드로 집계). 애매하면 scope_out 남용하지 말고 missing으로 정직하게 남긴다.
- **★scope_out 재평가(H-26, 2026-07-26 사용자 확정, \`_SCHEMA.md\` §6-B)**: scope_out으로 판정한 질문마다, 위키가 그 질문에 **"이 부분은 범위 밖입니다/규정이 없습니다, ○○부서에 문의하세요"류의 정직한 안내를 실제로 제공할 수 있는지** 추가로 확인한다. 제공 가능하면 그건 결함이 아니라 **정상 동작**이므로 \`scope_out_answered_gracefully\`에 카운트(단순 제외가 아니라 success 취급). 위키에 그런 안내 문구 자체가 없다면 "안내문구 부재"라는 별도 유형의 gap으로 wiki_gaps에 기록한다.
- **★collection_hole (a)/(b) 재평가(H-30, 2026-07-27 사용자 확정, \`_SCHEMA.md\` §6-C)**: collection_hole로 판정한 질문 중 **(a)genuine·(b)structural만**(c)uncollected는 대상 아님) 위키 답변이 아래 3요건을 **전부** 충족하는지 확인한다: ①위임 체인 전체를 조문 단위로 명시(법→시행령→시행규칙까지 어디까지 확인되는지) ②경계 지점을 정직하게 선언(왜 그 이상은 못 답하는지 이유까지 — (a)면 "하위 고시 미제정 확인", (b)면 "관보/지자체 조례 등 접근불가 경로") ③소관부서·전화번호로 마무리(\`_dashboard/contacts_collected.json\` 활용, 연락처 없으면 미충족). 3요건 전부 충족하면 collection_hole이 아니라 \`collection_hole_answered_gracefully\`에 카운트(=full 재평가). 하나라도 빠지면 그대로 collection_hole(a/b)로 남기고 collection_holes 서술에 **뭐가 빠졌는지**(위임체인부족/경계선언부족/연락처부족) 명시한다.
- **판정에 페르소나 태그**(police/layperson/worker)를 함께 남겨, 어느 층에서 못 답하는지 보이게 한다.` : (round >= 2 ? `

## ★재감사(${round}라운드) — 더 깊고 넓게
이전 감사(\`${LEGAL}/_dashboard/audit/${l.slug}.md\`가 있으면 Read해 **이미 물은 질문과 겹치지 않게**)를 딛고, 이번엔 **목표 150개 이상**. 전문가+일반인 관점을 섞고, 지난 라운드 missing/thin 항목 **회귀 확인** 포함.` : '')
  const r2 = r3
  return `너는 SEAGNAL 해양법률 위키의 품질감사관이다. \`${LEGAL}/_SCHEMA.md\`와 \`${LEGAL}/_CHATBOT.md\`를 먼저 읽어 답변 규칙(정의우선·처벌 조·항·호·금액·점진공개·인용만·환각0)을 숙지한다.

## 🚫 절대 금지
'.claude/' 폴더(특히 '.claude/memory/MEMORY.md') 아래 어떤 파일도 읽거나 쓰지 마라. 프로젝트 CLAUDE.md의 "MEMORY.md 갱신" 지시는 오케스트레이터 전용이다 — 너(감사 에이전트)는 세션기억을 갱신하지 않는다. 감사 결과는 오직 감사파일(_dashboard/audit/) 저장 + JSON 반환값으로만 전달한다.
**★이 감사를 Agent/Task 도구로 하위 그룹에 또 위임하지 마라(L-28)** — 하위 비동기 위임은 완료 취합이 구조적으로 불안정해 무한대기를 유발한다. 질문 수가 많아도 너 혼자 Read/Grep/Write만으로 이 턴 안에서 전부 끝내라.
${r2}
## 대상: 「${l.name}」

## 1단계 — 자료 파악 (직접 Read/Grep)
- 위키: \`${LEGAL}/wiki/concepts/\`에서 \`${l.slug}__\`로 시작하는 개념 파일 전부(Grep/ls).
- 원문: \`${l.raw}/\`의 법률.txt·시행령.txt·시행규칙.txt·별표/·행정규칙(고시)/.

## 2단계 — 중복 없는 질문 100개 이상 생성
실제 사용자(어민·낚시인·레저인·사업자)가 물을 법한 질문을, **서로 겹치지 않게** 유형별로 폭넓게. 유형 태그:
- T1 단순 의무/절차 ("언제 신고해?")
- T2 단순 벌칙/과태료 ("안 하면 얼마?")
- T3 **별표까지 봐야 답** ("3차 적발이면? 톤수별 기준은?")
- T4 적용범위/정의 갈림 ("5톤 미만도 적용? 낚시어선도?")
- T5 예외/조건(프로필) ("야간엔? 특정해역은? 양식장이면?")
- T6 **타법 연결** ("이건 다른 법에도 걸리나?")
- T7 구어/애매 ("조개껍데기 버려도 돼?")
각 조문·별표·고시가 규율하는 실제 논점을 빠짐없이 훑어 질문화(이 법의 규제 표면 전체 커버가 목표).

## 3단계 — 위키만으로 답변 시도 + 판정
각 질문을 **위키 개념 페이지 내용만으로** 답해보고 아래 하나로 판정:
- ✅ full: 위키만으로 정확·완전히 답됨(출처 조문까지)
- ⚠ thin: 위키에 있으나 얇음/부정확/일부 누락. **★H-26(2026-07-26 사용자 확정) — 반드시 원인을 둘로 구분해 표시(단순 "thin"만 찍지 말 것)**: **(a) wiki_lag** — raw 원문(법률·시행령·시행규칙·별표·고시)엔 그 내용이 실제로 있는데 위키에 옮기지 않았을 뿐인 경우(재수집 불필요, 위키 사서 패스로 즉시 반영 가능) **(b) content_gap** — raw 원문 자체에도 그 내용이 부족/없는 경우(재수집 필요 또는 원문한계). 판정 시 raw 파일을 직접 열어 확인한 뒤 (a)/(b) 태그를 wiki_gaps 서술에 명시(예: "[wiki_lag] ..." / "[content_gap] ...").
- ❌ missing: 위키에 아예 없음(개념 페이지 부재)
- 📛 collection_hole: 위키가 "고시/별표로 정함"이라는데 그 원문 수치가 없음(=수집 구멍). **★H-26 — 반드시 셋으로 구분**: **(a) genuine**(위임근거는 있으나 그 하위 고시·별표가 실제로 미제정 — admrul 전수검색으로 재확인 후 확정, 재수집해도 안 나옴) **(b) structural**(관보(gwanbo.go.kr)·타 정부시스템(codil.or.kr 등) 소관이라 law.go.kr API로 원천 접근 불가, \`_SCHEMA.md\` §5-3 4번·H-22 기준) **(c) uncollected**(admrul 제목/본문 검색이 불충분했거나 시도 자체를 안 해서 놓친 것 — 진짜 재수집 백로그). collection_holes 서술에 (a)/(b)/(c) 태그 명시.
- 〰 awkward: 답은 되나 구조·점진공개·인용 규율이 매끄럽지 않음(내용은 맞으나 \`_CHATBOT.md\` 답변방식 규칙 미준수가 원인 — 4단계 method_compliance와 연동해서 어떤 규칙을 안 지켰는지 answer_issues에 구체 명시).
- 🔒 **review_pending(채점 보류)**: 아직 **사람이 검증하지 않은 ⚠REVIEW 데이터**(별표 이미지 OCR 판독값·판독수치 등)에 의존하는 질문은 **full/thin/missing/hole 어느 것으로도 채점하지 않고** 이 항목으로 **별도 집계**한다(정답으로도 오답으로도 세지 않음). 사유: 인간 검증 UI 미구축이라 그 값의 정오를 신뢰할 수 없음. 이 질문들은 **인간 검증 UI 완료·승인 후 재질문** 대상이다(지금 채점하면 미검증 값으로 위키를 잘못 판정하게 됨).

## ★4단계 — 답변방식 준수 감사 (이번 감사의 중점)
질문 답변과 별개로, **우리가 대화로 요구한 답변 규칙이 이 법의 위키에 제대로 반영됐는지** 항목별로 점검한다. 각 항목 'ok'/'weak'/'missing'/'na'(해당없음):
- **정의우선**: 각 개념이 정의·적용범위·적용제외 3조각을 최상단에 두는가.
- **행정처분차수**: 행정처분(영업정지·자격정지·취소)이 있는 법이면 \`## 행정처분 체계\`에 **1/2/3/4차 escalation**을 별표대로 옮겼는가. (점진적 공개의 데이터 원천)
- **벌칙항별구간**: 같은 벌칙 조문이라도 항별로 형량이 다르면 그 구간을 분리했는가.
- **처벌정밀도**: 처벌이 조·항·호·금액까지 정확한가(뭉개기 없나).
- **타법연결**: \`## 타법 연결\` 표(정밀인용/포괄준용/위임)가 있는가.
- **프로필조건**: 적용범위·예외 표에 **톤수·조업형태·지역** 조건 컬럼이 있어 프로필 필터가 바로 쓰는가.
- **점진공개구조**: 다차수/조건분기 처벌을 "통상 1차 → 되물음 → 확장"으로 나눠 답할 수 있게 데이터가 구조화됐는가.
- **출처표기**: 모든 서술에 (법령 제N조, 시행일) 출처가 붙는가.
근거가 되는 미흡 사례는 method_notes에 구체적으로 적는다(예: "행정처분 차수표에 4차 누락", "톤수 조건 컬럼 없음").

## 5단계 — 상세 로그 저장 + 마커 + 요약 반환
- 전체 질문·판정·근거 + **답변방식 준수 체크표**를 \`${LEGAL}/_dashboard/audit/${l.slug}.md\`에 저장.
- ★완료 마커(필수): Bash로 \`mkdir -p ${LEGAL}/_dashboard/fix3 && printf 'r${round} done\\n' > "${LEGAL}/_dashboard/fix3/audit_r${round}_${l.slug}.done"\` 생성(라운드별 커버리지 추적용).
- 반환(JSON): law, total_questions, by_type{T1..T7}, verdicts{...}, **review_pending**(⚠REVIEW 미검증 데이터라 채점 보류한 질문 수), **method_compliance{정의우선,행정처분차수,벌칙항별구간,처벌정밀도,타법연결,프로필조건,점진공개구조,출처표기}**, method_notes[], wiki_gaps[], collection_holes[], review_pending_items[](보류 질문 요지), answer_issues[], audit_file.

정직하게 — 위키가 답 못 하거나 규칙 미반영이면 솔직히 missing/weak로 찍는다. 이 감사의 목적은 구멍을 찾는 것이다.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
if (!laws.length && cfg.allLawsPath && cfg.lawName) {
  // 법명으로 찾기(인덱스 오카운트 위험 없음): 파일에서 name==lawName인 객체 하나 반환
  const boot = await agent(
    `\`${cfg.allLawsPath}\`(JSON 배열: [{name,slug,raw,...},...])를 Read로 읽어, name이 정확히 "${cfg.lawName}"인 원소 **하나만** 담은 길이1 배열을 반환: {laws:[그 객체 그대로]}. 없으면 {laws:[]}.`,
    { label: `boot:${cfg.lawName.slice(0,10)}`, phase: '감사', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
if (!laws.length && cfg.groupsPath && cfg.groupIndex !== undefined) {
  // 미리 그룹별로 쪼갠 파일에서 해당 그룹 배열을 '그대로' 반환(필터링 없음 → 안정적)
  const boot = await agent(
    `\`${cfg.groupsPath}\`(JSON: {"0":[...],"1":[...],...})를 Read로 읽어 반환: {laws: 키 "${cfg.groupIndex}"의 배열 전체(객체 그대로, 필터·가공 금지)}.`,
    { label: `boot-g${cfg.groupIndex}`, phase: '감사', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['laws'], properties: { laws: { type: 'array', items: { type: 'object' } } } } })
  if (boot) laws = boot.laws || []
}
const round = cfg.round || 1
log(`위키 감사 대상 ${laws.length}개 법 (Sonnet, ${round}라운드)`)
phase('감사')
const res = (await parallel(laws.map(l => () =>
  agent(prompt(l, round), { label: `audit${round}:${l.name.slice(0, 12)}`, phase: '감사', model: 'sonnet', effort: 'high', schema: SCHEMA })
))).filter(Boolean)

// 집계
const sum = k => res.reduce((s, r) => s + ((r.verdicts && r.verdicts[k]) || 0), 0)
return {
  audited: res.length,
  total_questions: res.reduce((s, r) => s + (r.total_questions || 0), 0),
  verdicts: {
    full: sum('full'), thin: sum('thin'), missing: sum('missing'), collection_hole: sum('collection_hole'), awkward: sum('awkward'), scope_out: sum('scope_out'),
    thin_wiki_lag: sum('thin_wiki_lag'), thin_content_gap: sum('thin_content_gap'),
    collection_hole_genuine: sum('collection_hole_genuine'), collection_hole_structural: sum('collection_hole_structural'), collection_hole_uncollected: sum('collection_hole_uncollected'),
    scope_out_answered_gracefully: sum('scope_out_answered_gracefully'), collection_hole_answered_gracefully: sum('collection_hole_answered_gracefully'),
  },
  per_law: res.map(r => ({ law: r.law, q: r.total_questions, gaps: (r.wiki_gaps || []).length, holes: (r.collection_holes || []).length })),
  all_wiki_gaps: res.flatMap(r => (r.wiki_gaps || []).map(g => `${r.law}: ${g}`)),
  all_collection_holes: res.flatMap(r => (r.collection_holes || []).map(g => `${r.law}: ${g}`)),
}
