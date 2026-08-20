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
        unreachable: { type: 'integer' }, // H-41(2026-08-17): 위키엔 있으나 챗봇이 꺼낼 수 없는 자리에 있음. _SCHEMA.md §6-E
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
  // H-38 목표조정(2026-08-16 사용자 확정): 완전소진 확정법=lean(회귀검증만, 신규질문 억지금지),
  // 콘텐츠 풍부법=rich(600 참고선 강조 해제, 더 깊이 파도록 독려). 나머지는 기존 로직 그대로.
  if (l.mode === 'lean') {
    return `너는 SEAGNAL 해양법률 위키의 품질감사관이다. \`${LEGAL}/_SCHEMA.md\`와 \`${LEGAL}/_CHATBOT.md\`를 먼저 읽어 답변 규칙을 숙지한다.

## 🚫 절대 금지
'.claude/' 폴더 아래 어떤 파일도 읽거나 쓰지 마라. 감사 결과는 오직 감사파일(_dashboard/audit/) 저장 + JSON 반환값으로만 전달한다.
**★이 감사를 Agent/Task 도구로 하위 그룹에 또 위임하지 마라(L-28)** — 혼자 Read/Grep/Write만으로 이 턴 안에서 전부 끝내라.

## ★H-38 완전소진 확정법 — 경량 회귀검증 모드(사용자 확정 2026-08-16)
「${l.name}」은 이전 라운드들에서 "신규문항 사실상 0"으로 **완전소진 확정**된 법이다(\`MASTER_PLAN.md\` H-38 참고). 이번 라운드는 새 논점을 억지로 찾지 않는다. 대신:
1. \`${LEGAL}/_dashboard/audit/${l.slug}.md\`(직전 감사 전체)를 Read해 지난 라운드들의 thin/missing/collection_hole 항목을 파악한다.
2. 그 항목들만 **회귀 재확인**한다(위키가 그 이후 반영됐는지, raw가 개정돼 새로 답할 게 생겼는지) — 목표 30~50문항이면 충분, 더 찾아지면 더 해도 되지만 억지로 채우지 않는다.
3. raw(법률·시행령·시행규칙·행정규칙)가 이전 라운드 이후 실제로 개정됐는지 최상단 조문 개정일을 확인해 언급한다(개정 없으면 "개정 없음, 회귀 확인만" 명시).
4. 새로운 논점이 우연히 눈에 띄면 포함하되, 없는데 지어내지 마라(카파시 padding금지).
5. **★회귀 재확인 시 판정 규칙(H-41, \`_SCHEMA.md\` §6-E~6-G) — 경량 모드에도 그대로 적용**:
   - **답을 찾았다고 바로 full을 찍지 마라.** 근거가 \`statutes/\`·\`comparisons/\` 에만 있거나, 개념 페이지의 \`## 근거 조문\` 표에 그 행이 없으면 **full이 아니라 \`unreachable\`**(위키엔 있으나 챗봇이 못 꺼내는 자리)이다. 챗봇의 "근거 법령" 목록은 개념 페이지의 그 표에서만 만들어진다.
   - **별표는 항목 수를 세어 대조하라** — "반영돼 있다"가 아니라 "원문 N개 항목 중 위키에 M개"로 적는다.
   - **변경 이력·\`status: canonical\`·"이미 완전함" 표시를 근거로 삼지 마라.** 항상 raw 원문과 직접 대조한다.

## 대상: 「${l.name}」

## 저장 + 반환
- \`${LEGAL}/_dashboard/audit/${l.slug}.md\`에 **append만**(L-93, 기존 이력 절대 덮어쓰기 금지) — \`---\`구분선 + 이번 라운드(회귀검증) 리포트.
- 완료 마커: \`mkdir -p ${LEGAL}/_dashboard/fix3 && printf 'r${round} done(lean)\\n' > "${LEGAL}/_dashboard/fix3/audit_r${round}_${l.slug}.done"\`
- 반환(JSON): law, total_questions, by_type{}, verdicts{...}(SCHEMA와 동일 필드, 해당없는 건 0), method_compliance{}(해당없으면 전부 'na'), wiki_gaps[], collection_holes[], answer_issues[], audit_file.

정직하게 — 정말 회귀 확인만으로 끝나면 그렇게 보고해라(소진 상태 재확인도 유효한 결과다).`
  }
  const richNote = l.mode === 'rich' ? `

## ★풍부형 법 — 600은 참고선조차 아니다(사용자 확정 2026-08-16)
「${l.name}」은 별표·별지·미착수 고시가 유독 많은 것으로 확인된 법이다. 600문항을 목표로 삼지 말고, **raw(법률·시행령·시행규칙·행정규칙/고시) 전량을 새로 훑어 아직 위키에 없는 별표·별지·고시·조문을 적극적으로 더 찾는다.** 600을 넘겨 800~1000문항 이상 나와도 정상이다 — 다 못 찾았는데 600에서 멈추는 게 오히려 이번 라운드의 실패다.` : ''
  const r3 = round >= 3 ? `${richNote}

## ★★재감사 ${round}라운드 — 약점 집중 + 3페르소나 (사용자 확정 설계)
\`${LEGAL}/_dashboard/audit/${l.slug}.md\`(직전 감사)를 **반드시 Read**한다. 그 리포트의 판정을 이렇게 쓴다:
- **직전 full(✅ 잘 답한) 문항·논점은 제외**한다(다시 묻지 않음 — 이미 통과).
- **직전 thin(⚠)·missing(❌)·collection_hole(📛)로 막혔던 논점은 반드시 재질문**(수정이 실제로 막았는지 회귀 확인).
- 여기에 **수준별 신규 질문**을 더한다. **참고치(절대 상한 아님): 이 법 총 600문항 = (직전에 미흡했던 것 재질문: thin·missing·hole 전부) + (신규 질문)** — 아래 3페르소나 합산(★H-23 사용자 확정 2026-07-21 — 페르소나 개편). **600은 목표가 아니라 "이 정도는 나오는 게 보통"이라는 기준선일 뿐이다. 별표·별지가 큰 법(예: 수산업법 별표8·9처럼 어업 종류×어종×규격이 그물코처럼 다차원 표로 수십 행 있는 경우)은 그 표 각 행마다 질문을 뽑으면 600을 훌쩍 넘는 게 정상이다 — 그럴 땐 상한 없이 계속 뽑는다.**
  - ★**질문 문장에는 우리 내부 표기를 넣지 마라**(2026-08-18 신설, L-117). 문항번호·판정·라운드 표시(\`(감사문항 X002)\`·\`(R22-L3, 감사관 판정 full)\`·\`B31 — …\`)를 질문 안에 섞어 적지 마라. 그런 표기는 **감사파일의 다른 칸**에 적는다. 왜냐면 그 질문 문장이 나중에 **실제 챗봇에 그대로 던져지는데**(라이브 검증), 내부 표기가 검색어로 들어가 점수를 흐려 **우리 시스템이 아니라 우리가 만든 잡음을 재게** 된다 — 실측: 꼬리표를 떼자 양식산업발전법이 "후보에 없음 → 9위"로 올라왔다. 질문은 **사용자가 실제로 칠 문장 그대로**여야 한다.
  - **해양경찰관(단속·처벌 실무)**(약 1/3): 정밀도는 변호사/전문가급이되, **소송에서 다툴 법리가 아니라 현장·조사 단계에서 경찰관이 실제로 확인해야 하는 것** 위주 — 처벌요건 충족여부, 과태료 금액 산정·감경가중 사유, 행정처분(면허취소·정지 등) 재량범위·절차(청문·의견제출), 몰수·양벌규정 적용범위, 소급·공소시효, 조사·증거 요건, 불복(이의신청·행정심판·행정소송) 절차 등. (구 "변호사/전문가" 페르소나를 대체 — 나리야가 해양경찰 실무 지원 목적이라 추상적 법리비교보다 단속·처벌·행정처분 실무질문 비중을 높임)
  - **일반인**(약 1/3): 처음 배 산 사람·초보 낚시인·귀어인의 막연·구어 질문, 오해하기 쉬운 지점.
  - **해양종사자**(약 1/3): 실제 조업·운항·양식 현장의 실무 질문(신고 타이밍·장비·구역·단속 대응 등).
  - **★구체적 역할·상황 부여(사용자 확정 2026-07-27)**: 위 3페르소나 각각, 질문을 추상적으로 뭉뚱그리지 말고 **1인칭 구체적 인물·상황**으로 던진다. 같은 법이라도 역할에 따라 적용되는 조문·의무가 달라지는 지점을 의도적으로 노린다. 예(낚시관리및육성법이면): 해양종사자="나는 5톤 낚시어선을 운영하는 사업자인데 승선정원을 넘겨 태워도 되나?" vs 일반인="낚시어선에 손님으로 탔는데 구명조끼 안 주면 누구 책임이야?"; 해양경찰관="정박 중인 무등록 낚시어선을 단속 중인데 현장에서 뭘 확인해야 압류·고발 요건이 갖춰지나?" vs "사고 신고 받고 출동했는데 선장이 음주 정황이면 조사 절차가 어떻게 되나?". 매 질문마다 이런 구체성을 요구하는 건 아니되(막연한 정의성 질문도 필요), **T4(적용범위/정의 갈림)·T5(예외/조건)·T3(별표 조건) 유형은 특히 역할·상황을 구체화**해 위키의 프로필조건 데이터(톤수·조업형태·지위 등)가 실전에서 실제로 갈라지는지 검증한다.
- **★600은 상한이 아니라 참고선이다 — 위·아래 둘 다 넘을 수 있다(H-21, 2026-08-15 정책 수정, 사용자 확정)**. 매 라운드 **①이 법의 위키 페이지·raw 조문·별표·고시를 전량 다시 훑어 새로운 논점이 남아있는지 실제로 찾아본다**(훑지 않고 "이미 다 물었을 것 같다"고 지레짐작으로 줄이는 것 금지) **②그 결과 정말 새 질문이 안 나오면(=콘텐츠 소진), 억지로 재구성한 재탕 질문으로 숫자를 채우지 말고 그 라운드는 찾은 만큼만 제출**한다 — 카파시 padding금지 원칙("가짜 중복질문 금지")이 600이라는 숫자보다 우선한다. **③반대로 이 법에 큰 별표·별지(다차원 수치표·조건별 기준표 등)가 있으면 600을 넘기는 것을 주저하지 마라** — 목표는 "600문항 달성"이 아니라 "이 법이 규율하는 모든 것에 빈틈없이 답할 수 있는 위키"이고, 별표가 크면 자연히 그만큼 질문도 많아져야 한다. **④몇 문항에서 멈췄든, 감사파일에 "왜 이 라운드는 N개에서 멈췄는지"(어느 페이지·조문·별표까지 훑었고 왜 더 없다고 판단했는지)를 반드시 명시**한다 — 그냥 "소진됨"이라고만 쓰지 말고 근거를 남겨라(다음 라운드가 같은 자리를 또 훑지 않도록, 그리고 오케스트레이터가 "이 법은 정말 다 됐는지 vs 아직 별표를 덜 판 것인지"를 판단할 수 있도록).
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

## ★1.5단계 — 질문 만들기 전에 별표·별지 목록부터 먼저 뽑는다(사용자 확정, 필수)
질문을 바로 만들지 말고, 그 전에 이 법의 raw(법률·시행령·시행규칙·행정규칙/고시)에 있는 **모든 별표(表)·별지(서식) 목록을 먼저 Grep으로 뽑아 명시적으로 나열**한다(예: "별표1(과태료 부과기준) · 별표2(안전장비 기준) · 별지 제3호서식(신청서) · 별지 제5호서식(허가증) ..."). 그다음 **각 별표·별지마다 "이 표/서식에서 뭘 물어야 하는지"를 최소 1줄씩 적어본다**(예: "별표1 → 1~3차 위반 시 금액 차등, 감경·가중 사유" / "별지 제3호서식 → 필수 기재항목, 첨부서류"). 이 목록·메모를 감사파일 1단계 절에 남긴 뒤, 2단계 질문 생성에서 **목록에 있는 별표·별지가 전부 최소 1개 이상의 질문(T3 유형 우선)에 실제로 반영됐는지 스스로 대조**한다 — 본문 조문만 훑고 별표·별지를 빠뜨리는 것이 이 감사의 가장 흔한 사각지대였다(사용자 확정 2026-08-15).
- **★★별표마다 "원문 항목 수 vs 위키 항목 수"를 세어 적는다(H-41, 필수, \`_SCHEMA.md\` §6-F)**: 별표가 위키에 "반영돼 있다"는 확인만으로 넘어가지 마라. **원문의 항목 수(호·목·표의 행)를 세고, 위키에 옮겨진 항목 수를 세어 감사파일에 나란히 적는다.** 숫자가 다르면 **어느 항목이 빠졌는지** 명시한다. 이유: 2026-08-17 별표 전수 보강에서 나온 실패는 대부분 **"인용은 했는데 표의 일부만 옮긴"** 유형이었다(양식산업발전법 시행규칙 별표1 3개 호 중 1·3호 누락, 수산업협동조합법 시행령 별표 15개 호 중 11개만, 유류오염손해배상보장법 시행령 별표1 분담유 16종 중 2종만, 유선및도선사업법 시행규칙 별표4 유형별 세부내용 통째 누락). **질문 방식으로는 구조적으로 못 잡는다** — 그 라운드 질문이 우연히 빠진 호를 안 물으면 full로 통과하기 때문이다.
- **★완료 기록을 근거로 삼지 마라(H-41, \`_SCHEMA.md\` §6-G)**: 위키의 \`## 변경 이력\` 표·\`status: canonical\`·"이미 완전함" 같은 표시는 **다음 라운드의 근거가 되지 못한다.** 실제로 유선및도선사업법 시행규칙 별표4는 변경 이력에 "이미 완전함(2026-08-05)"이라 적혀 있었으나 열어 보니 세부내용이 통째로 빠져 있었다. **항상 raw 원문과 직접 대조**해 판정한다.
- **★행·열이 많은 다차원 수치표는 "표가 있다"는 확인만으로 끝내지 말고 행 단위로 파고든다(사용자 확정, 수산업법 시행령 별표8·9 사례 — 어업종류×어종×그물코규격/어구규모가 12행 이상인 표).** 이런 표를 만나면: ①표의 행 수·분류축(예: 어업종류 12종, 그물코 규격이 어종별로 또 갈리는 하위행)을 세어 감사파일에 적고 ②최소한 대표 행 몇 개(전부가 이상적이나 시간이 부족하면 "그물코 규격이 특이하게 갈리는 행"·"예외 비고가 붙은 행" 등 변별력 있는 행 우선)를 골라 **그 구체 수치로 질문**한다(예: "외끌이대형저인망으로 33밀리미터 이하만 금지면, 34밀리미터는 되나요?" / "근해자망으로 삼치 잡을 때랑 대게 잡을 때 그물코 규격이 왜 다른가요?"). "별표8이 있고 위키에 표로 옮겨져 있다"는 확인만 하고 개별 수치 질문을 안 만드는 것은 이 감사의 목적(구멍 없이 답할 수 있는지 검증)에 미달한다.

## 2단계 — 중복 없는 질문 100개 이상 생성
실제 사용자(어민·낚시인·레저인·사업자)가 물을 법한 질문을, **서로 겹치지 않게** 유형별로 폭넓게. 위 1.5단계에서 뽑은 별표·별지 목록을 빠짐없이 커버할 것. 유형 태그:
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
- 🚧 **unreachable(닿지 않음)**: 위키에 내용은 **정확히 있으나 챗봇이 꺼낼 수 없는 자리**에 있음(\`_SCHEMA.md\` §6-E). **★답을 찾았다고 바로 full을 찍지 마라** — 아래 3가지를 실제로 확인하고, 하나라도 걸리면 full이 아니라 unreachable이다:
  1. 답의 근거가 \`statutes/\`·\`comparisons/\` 에만 있고 **그 법의 개념 페이지(\`concepts/\`)에는 없다** → unreachable
  2. 개념 페이지엔 있으나 그 페이지의 **\`## 근거 조문\` 표에 해당 조문(또는 별표) 행이 없다** → unreachable
  3. 근거 조문 표에 행은 있으나 **법령 칸이 \`시행령\`·\`시행규칙\` 한 낱말**이라 어느 법인지 특정 안 됨 → unreachable
  **왜 중요한가**: 챗봇 답변의 "근거 법령" 목록은 **개념 페이지의 \`## 근거 조문\` 표에서만** 만들어진다(\`legal_retriever.js extractCitationChain\`). 너는 사람처럼 아무 파일이나 열어 답을 찾을 수 있지만 챗봇은 못 한다. 실제로 2026-08-17에 이 차이 때문에, 감사가 R14·R21에서 ✅full로 통과시킨 논점(유·도선 톤수별 풍속·파고)이 사용자 앞에서는 "확인되지 않습니다"로 실패했다. **unreachable은 결함이므로 full율 분모에서 빼지 말고**, wiki_gaps에 \`[unreachable] …\` 태그로 무엇을 어디로 옮겨야 하는지 적는다(ⓐ개념 페이지 본문 이관 ⓑ근거 조문 표 행 추가 ⓒ긴 표면 annexes/ 신설 후 링크).
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
- **★★반드시 이어쓰기(append)만 한다 — 파일 전체를 새로 쓰지 마라(L-93 재발 방지, 필수)**: 이 파일에는 이전 라운드들의 감사 이력이 누적돼 있다. 1단계에서 이미 Read했으니, 그 뒤에 \`---\`구분선 + 이번 라운드 리포트만 **끝에 덧붙인다**(Edit 도구로 파일 끝에 삽입하거나, Bash \`cat >> 파일\`로 append). **Write 도구로 이 파일 전체를 새로 쓰는 것은 절대 금지** — Write는 기존 내용을 통째로 지우고 이번 라운드 것으로 덮어써, 지난 라운드 전체 이력이 영구 소실된다(실제로 이 실수가 여러 번 발생해 다른 세션이 git 이력에서 복구해야 했다). 턴/컨텍스트가 부족해 이번 라운드를 다 못 쓰겠으면, 쓴 만큼만 append하고 "미완성" 표시를 남겨라 — 그래도 Write로 기존 이력을 지우는 것보다 훨씬 낫다.
- ★완료 마커(필수): Bash로 \`mkdir -p ${LEGAL}/_dashboard/fix3 && printf 'r${round} done\\n' > "${LEGAL}/_dashboard/fix3/audit_r${round}_${l.slug}.done"\` 생성(라운드별 커버리지 추적용).
- 반환(JSON): law, total_questions, by_type{T1..T7}, verdicts{...**unreachable 포함**}, **review_pending**(⚠REVIEW 미검증 데이터라 채점 보류한 질문 수), **method_compliance{정의우선,행정처분차수,벌칙항별구간,처벌정밀도,타법연결,프로필조건,점진공개구조,출처표기}**, method_notes[], wiki_gaps[], collection_holes[], review_pending_items[](보류 질문 요지), answer_issues[], audit_file.

정직하게 — 위키가 답 못 하거나 규칙 미반영이면 솔직히 missing/weak로 찍는다. 이 감사의 목적은 구멍을 찾는 것이다.`
}

/**
 * 횡단 감사관 프롬프트 — 어느 법에도 안 속하는 위키 파일 담당(`_SCHEMA.md` §6-H).
 * 법별 감사관과 **담당 파일이 겹치지 않아** 같이 돌려도 안전하다(공유 파일 동시쓰기 없음).
 */
function crossPrompt(round) {
  return `너는 SEAGNAL 해양법률 위키의 **횡단 감사관**이다. \`${LEGAL}/_SCHEMA.md\`(특히 §6-E~§6-H)와 \`${LEGAL}/_CHATBOT.md\`를 먼저 읽어라.

## 🚫 절대 금지
'.claude/' 폴더 아래 어떤 파일도 읽거나 쓰지 마라. **★Agent/Task 도구로 재위임하지 마라(L-28)** — 혼자 Read/Grep/Write만으로 이 턴 안에 끝내라.

## 왜 네가 있나 (§6-H)
감사는 74개 법에 1명씩 붙는 **법별 구조**라, **어느 법의 소유도 아닌 파일은 담당자가 없었다.** 그래서 \`wiki/_glossary.md\`(사용자 일상어 → 법 개념으로 가는 이정표)의 깨진 링크 116건이 **21라운드를 그대로 살아남았다.** 위키가 아무리 좋아도 이정표가 끊기면 챗봇이 그 문서를 못 편다.

## 담당 (이 4가지만 본다 — 법별 감사관 담당과 겹치지 않는다)
1. \`${LEGAL}/wiki/_glossary.md\` — 일상어 → 법 개념 이정표
2. \`${LEGAL}/wiki/_backbone.md\` — 전체 뼈대
3. \`${LEGAL}/wiki/comparisons/\` — 여러 법이 공유하는 비교 허브
4. \`${LEGAL}/wiki/activities/\` — 활동 단위 페이지

## 무엇을 보나
사람이 실제로 쓸 법한 **일상어 질문 40~80개**를 만들어(예: "배에서 술 마셔도 되나요", "낚싯배 하려면", "면허 뭐 따야 하나요") 이 4가지만으로 목적지 개념 페이지까지 **닿는지** 확인한다. 그리고:
- **이정표가 맞나**: \`_glossary.md\`의 일상어 항목이 실제로 맞는 개념 페이지를 가리키나. 사람들이 쓰는 말인데 아예 없는 항목은?
- **허브가 낡지 않았나**: \`comparisons/\`의 비교표가 지금 raw·개념 페이지와 어긋나지 않나(어긋나면 **raw 원문과 직접 대조**해 어느 쪽이 맞는지 밝힌다).
- **§6-E unreachable 적용**: 답이 \`comparisons/\`에**만** 있고 그 법의 개념 페이지엔 없으면 **full이 아니라 unreachable**이다. 챗봇의 근거 목록은 개념 페이지의 \`## 근거 조문\` 표에서만 만들어진다.
- **§6-G 적용**: \`status: canonical\`·"이미 완전함" 표시를 근거로 삼지 마라. 항상 raw 원문·실제 파일과 직접 대조한다.
- ⚠깨진 링크 **자체**는 세지 마라 — \`xref_check.py\`가 이미 게이트로 막고 있다(L-106). 너는 **내용**을 본다(링크는 살아 있는데 엉뚱한 데로 가는 경우는 네 몫이다).

## 저장 + 반환
- \`${LEGAL}/_dashboard/audit/_횡단.md\`에 **append만**(L-93, 기존 이력 절대 덮어쓰기 금지) — \`---\` 구분선 + \`## R${round} 횡단 감사\` 리포트.
- 완료 마커: \`mkdir -p ${LEGAL}/_dashboard/fix3 && printf 'r${round} done(cross)\\n' > "${LEGAL}/_dashboard/fix3/audit_r${round}__횡단.done"\`
- 반환(JSON): law는 \`"_횡단"\`, 나머지는 SCHEMA 그대로(해당 없는 필드는 0/빈배열). wiki_gaps에는 **무엇을 어디로 옮겨야 하는지**를 적는다.`
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
// ★§6-H 횡단 감사관(H-41 사용자 확정 2026-08-17, 2026-08-18 실제 배선).
//   감사는 법별로 1명씩 붙는 구조라 **어느 법의 소유도 아닌 파일은 담당자가 없다** — 그래서
//   `wiki/_glossary.md` 깨진 링크 116건이 21라운드를 그대로 살아남았다. 매 라운드 1명을 배정한다.
//   ⚠라운드는 그룹별 Workflow 호출 여러 개로 쪼개 디스패치하므로, **그룹 0에서만** 돈다
//   (안 그러면 그룹 수만큼 중복). 필요하면 cfg.crossCut 으로 켜고 끌 수 있다.
const doCross = cfg.crossCut !== undefined
  ? !!cfg.crossCut
  : String(cfg.groupIndex) === '0'
log(`위키 감사 대상 ${laws.length}개 법 (Sonnet, ${round}라운드)${doCross ? ' + 횡단 감사관 1명' : ''}`)
phase('감사')
const jobs = laws.map(l => () =>
  agent(prompt(l, round), { label: `audit${round}:${l.name.slice(0, 12)}`, phase: '감사', model: 'sonnet', effort: 'high', schema: SCHEMA })
)
if (doCross) jobs.push(() =>
  agent(crossPrompt(round), { label: `audit${round}:횡단`, phase: '감사', model: 'sonnet', effort: 'high', schema: SCHEMA }))
const res = (await parallel(jobs)).filter(Boolean)

// 집계
const sum = k => res.reduce((s, r) => s + ((r.verdicts && r.verdicts[k]) || 0), 0)
return {
  audited: res.length,
  total_questions: res.reduce((s, r) => s + (r.total_questions || 0), 0),
  verdicts: {
    full: sum('full'), thin: sum('thin'), missing: sum('missing'), collection_hole: sum('collection_hole'), awkward: sum('awkward'), scope_out: sum('scope_out'), unreachable: sum('unreachable'),
    thin_wiki_lag: sum('thin_wiki_lag'), thin_content_gap: sum('thin_content_gap'),
    collection_hole_genuine: sum('collection_hole_genuine'), collection_hole_structural: sum('collection_hole_structural'), collection_hole_uncollected: sum('collection_hole_uncollected'),
    scope_out_answered_gracefully: sum('scope_out_answered_gracefully'), collection_hole_answered_gracefully: sum('collection_hole_answered_gracefully'),
  },
  per_law: res.map(r => ({ law: r.law, q: r.total_questions, gaps: (r.wiki_gaps || []).length, holes: (r.collection_holes || []).length })),
  all_wiki_gaps: res.flatMap(r => (r.wiki_gaps || []).map(g => `${r.law}: ${g}`)),
  all_collection_holes: res.flatMap(r => (r.collection_holes || []).map(g => `${r.law}: ${g}`)),
}
