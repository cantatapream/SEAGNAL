/**
 * ============================================================================
 * 파일명: services/article_text.js
 * 역할: 답변카드의 조문을 눌렀을 때 보여줄 **조문 원문**(조 하나 · 범위 · 문서 전체)을
 *       raw 원문에서 뽑아 항(①②③…)·호(1. 2. 3. · 가지번호 3의2.)·목(가. 나. 다.) 단위로 쪼개 주고, 본문에 나오는
 *       별표·서식 참조가 "우리에게 실제로 있는지"까지 판정해 주는 모듈
 * ============================================================================
 *
 * [설명]
 * 나리야 답변카드의 근거법령 체인(위임흐름)은 위키 표의 **요지**만 보여준다. 사용자가
 * 그 조문 카드를 누르면 "그 조 전체 원문"을 팝업으로 띄우고 실제로 인용된 항·호를
 * 강조해 주는데, 이 모듈이 그 원문을 만든다.
 *
 * raw(법령 원문)는 서버에 상주시키지 않는다 — 2차 조회(searchRawFallback)와 똑같이
 * `services/github_raw.js`로 **필요할 때만** GitHub에서 읽어온다(MASTER_PLAN F절).
 *
 * [인용 표기 5종 — 위키 표의 `조문` 칸은 조 하나만 가리키지 않는다]
 *  - annex  : `별표10`·`별표2·3`·`별지 제1~3호서식` — 조를 거치지 않고 **별표·서식 자체가 근거**인 행.
 *             조 본문 파싱 없이 그 별표 원문(refs)만 실어 보낸다. 조·`전문` 표기가 섞인 칸은
 *             무엇을 보여줄지 단정할 수 없어 손대지 않는다(그대로 실패).
 *  - single : `제10조④3호` — 조 하나. 인용된 항·호를 강조(hit)한다. 한 항의 호를 여럿 적은
 *             `제53조②5·6·6의2호`도 여기에 들어오며 적힌 호를 **전부** 강조한다(hoList).
 *  - list   : `제53조·제55조`·`제109·110조` — 가운뎃점·쉼표로 나열된 여러 조를 **적힌 순서대로
 *             전부** 나열한다. 원문에서 못 찾은 조는 `missing`으로 정직하게 알린다.
 *             맨숫자 항목(`110`·`6`)은 표기 끝의 '조' 유무로 뜻이 갈린다 — 끝에 '조'가 있으면 별개 조
 *             (`제109·110조`), 없으면 앞 항목의 가지번호를 잇는 표기(`제30조의5·6`)다(parseJoEnum 참고).
 *  - range  : `제1~9조`·`전문(제1조~제10조)` — 그 범위의 조를 **순서대로 전부** 나열한다.
 *  - whole  : `전체`·`전문`, 또는 고시인데 조 번호가 아예 없는 표기(고시 제목만 적힌 행).
 *             그 문서의 조문을 전부 나열한다.
 *   ⚠ list·range·whole 은 **강조(hit)를 하지 않는다** — 여러 조 전체가 근거라 "어디가 진짜
 *     근거인지" 알 수 없고, 억지로 한 곳을 칠하면 지어내는 것과 같다. 대신 클라이언트가
 *     위키 표의 요지(gist)를 그대로 캡션으로 보여준다.
 *   ⚠ 조가 MAX_ARTICLES 개를 넘으면 억지로 다 밀어넣지 않고 {tooLong}으로 정직하게 넘긴다.
 *
 * [별표·서식 참조 판정 — 지어내지 않기 위한 4상태]
 *  본문에 나오는 "별표 1"·"별지 제1호 서식" 표현마다 우리가 실제로 가진 것을 찾아 kind 를 준다.
 *   - text    : 원문 텍스트를 갖고 있다(고시 파일 안 `[별표]` 블록 / `별표/<계층>_별표N.txt`)
 *   - link    : 우리에겐 없고 law.go.kr 다운로드 링크만 있다(PDF·HWP 둘 다 있으면 둘 다 준다)
 *   - image   : 스캔본을 같이 수집해 뒀다(`_이미지/<번호>.png`)
 *   - missing : 위 어디에도 없다 → 클라이언트가 회색 "(원문 미수집)"으로 정직하게 표시
 *  ⚠ law.go.kr 다운로드 링크(hwp/pdf)는 **kind 와 무관하게** 있는 대로 다 실어 보낸다 —
 *    표 원문을 갖고 있어도 원본 파일은 따로 받아볼 수 있어야 한다("보기와 다운로드는 양자택일이 아니다").
 *  ⚠ 참조가 MAX_REFS 를 넘으면 뒤쪽은 **판정 자체를 안 한다** — 그건 "없다"가 아니라 "안 봤다"라서
 *    응답에 `refsTruncated:true`를 함께 보낸다(클라이언트는 그런 참조를 "미수집"으로 단정하지 않고
 *    원문 글자 그대로 둔다).
 *
 * [환각 0 — 이 파일의 핵심 계약]
 *  - 원문에서 그 조를 못 찾으면 **문장을 지어내지 않고** {ok:false, reason}을 돌려준다.
 *  - 호(1. 2. 3.) 쪼개기는 번호가 1부터 차례대로일 때만 인정한다("제2조의2" 뒤에 "8."이 붙어
 *    "28."로 오검출되는 실제 사례가 있다). 개정으로 끼워 넣은 가지번호 호(`3의2.`·`6의2.`)는
 *    **한 덩어리로** 읽어 그 차례에 넣는다(`3.` 다음은 `4.` 또는 `3의2.`). 조금이라도 어긋나면
 *    쪼개기를 포기하고 **항을 통째로** 보여준다(잘못 잘린 조문을 보여주는 것보다 안전).
 *  - 목(가. 나. 다.) 쪼개기도 같은 계약이다 — 줄머리에 `가.`부터 차례대로 있을 때만 쪼갠다.
 *    번호·기호는 **원문에 적힌 것을 그대로** 쓰고 화면에서 다시 매기지 않는다(1,2,3으로 다시
 *    매기면 `6의2호`가 `7.`로 보여 인용과 어긋난다).
 *  - 조 뒤에 붙은 부칙은 **본문에서 떼어내되 버리지 않는다** — `addenda`로 자리만 옮겨 화면이
 *    "부칙 보기"로 따로 펼친다(원문 글자를 잃는 것이 섞여 나오는 것만큼 나쁘다).
 *  - `focused`(그 항·호만 펼쳐도 되는지)는 **인용한 항·호를 원문에서 실제로 찾았을 때만** true.
 *    조금이라도 단정할 수 없으면 false로 물러나 조 전체를 보여준다(loadArticle 의 focused 주석 참고).
 *  - 별표 블록에 번호(`〔별표 1〕` 등)가 안 적혀 있으면 "1번이겠지"라고 넘겨짚지 않고
 *    그 블록을 버린다(번호 없는 `[별표]` 블록이 실제 raw 에 381개 있다).
 *  - 계층 없는 `별표N.txt`는 파일명 번호와 내용 번호가 어긋난 게 41개 있어, 선언줄의 **계층과
 *    번호가 둘 다 맞을 때만** 쓴다(맞지 않으면 다른 별표를 그 번호인 척 보여주게 된다).
 *  - 내용이 `[별표 7] 삭제` 한 줄뿐인 폐지 별표는 "원문 있음"으로 확정하지 않는다(빈 팝업 방지).
 *  - 한 칸에 계층이 둘 이상 섞인 행(`법령='법·시행령'` / `조문='제4조·시행령 제5조'`)은 계층은 뒤쪽 것,
 *    조 번호는 앞쪽 것이 붙어 **인용된 적 없는 조**가 열린다 — 조문 칸이 그 계층을 명시하지 않았으면
 *    열지 않고 실패한다(tierIsCertain). 부칙 조문 표기도 본문 조와 번호가 겹쳐 그대로 실패시킨다.
 *  - 조 나열(`제109·110조`·`제8조·제3~6조`)은 나열된 조를 **전부** 편다(list). 다만 `선박구명설비기준
 *    제98·99조`처럼 조 번호가 다른 글자와 섞여 우리가 단정할 수 없는 표기는 억지로 하나만 골라 열지
 *    않고 bad_request 로 정직하게 실패한다 — 틀린 원문을 보여주는 것보다 안 여는 게 낫다.
 *
 * [연계 파일]
 * - routes/legal.js                        → GET /api/legal/article-text 가 loadArticle() 호출
 *                                            GET /api/legal/src 가 별표 스캔 이미지를 서빙
 * - services/legal_retriever.js            → rawPathOf()(법명 → raw 폴더 경로) 재사용
 * - services/github_raw.js                 → fetchText()/listDir()(온디맨드 원문 조회)
 * - client/js/ai-chat/ai_chat.js           → 이 응답으로 조문 팝업(.nrya-artpop)을 그린다
 *
 * [원문 형식 — 실제 raw 파일을 열어 확인한 것(추측 아님)]
 *  - 법률/시행령/시행규칙(`법률.txt`·`시행령.txt`·`시행규칙.txt`):
 *      `[제10조] 역사문화환경 보존지역의 보호 (시행 20260624 · 타법개정)` 헤더 줄 뒤에
 *      본문이 이어지고, 다음 `[제N조]` 헤더에서 끝난다. 조 사이에 `제3장 …`/`제1절 …`
 *      같은 편장절 제목 줄이 끼어들 수 있어 블록 끝의 그런 줄은 걷어낸다.
 *      별표는 본문에 없고 `별표/시행규칙_별표1.txt`·`별표/시행규칙_서식1.txt`처럼 따로 있으며,
 *      텍스트가 없는 것은 `별표/_links.json`(키 `"시행규칙 서식 1"`)에 다운로드 링크만 있다.
 *  - 행정규칙(`행정규칙/*.txt`): 파일 머리에 `발령일자: … 시행일자: …` 줄이 있고,
 *      조문은 `제18조(국가유산 유형별 검토기준) ① … ② …`처럼 **한 줄에 통째로** 들어있다.
 *      별표는 조문 뒤에 `[별표] 제목` + `〔별표 1〕`/`[별표 1]`/`[별지 제1호서식]` 형태로
 *      이어 붙어 있고, 그게 없는 고시는 `별표/<자유서술>.txt`(예: `해상운송비_별지서식3종.txt`)에
 *      "별지 제1호서식: 제목 / - 서식파일(HWPX): url / - PDF: url" 형식으로 링크만 있다.
 *  - 본문에 `<img id="123">`·`【이미지판독 123】(원본이미지: _이미지/123.png)` 마커가 섞여 있다
 *      (전 raw 에 811개·297개). 태그는 걷어내고 판독 마커는 `【이미지 123】` 참조로 바꾼다.
 * [로드 순서] 번들 없음(서버). routes/legal.js가 require 시점에 함께 로드된다.
 * ============================================================================
 */
'use strict';

const githubRaw = require('./github_raw');
const { rawPathOf } = require('./legal_retriever');

// 항 머리기호(원문자) — 인덱스+1 이 항 번호다(①=1항).
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

// tier → 그 법 폴더 안의 고정 파일명(행정규칙만 파일명이 제각각이라 따로 찾는다).
const TIER_FILE = { law: '법률.txt', decree: '시행령.txt', rule: '시행규칙.txt' };
// ★어느 법의 시행령이 아니라 **그 자체가 대통령령**인 법령이 있다(공무원 여비 규정·보안업무규정·
//   공무원보수규정·정부표창규정·해양수산부와 그 소속기관 직제 등 실측 6개 폴더). 그런 폴더의
//   파일 이름은 `시행령.txt` 가 아니라 `대통령령.txt`(발췌본이면 `대통령령_발췌.txt`)다.
//   2026-08-31에 낫표 때문에 이 법령들이 고시로 잘못 분류되던 것을 고쳤더니, 이번에는
//   `시행령.txt` 를 찾다 실패해 "그 계층 파일이 없음"으로 빠졌다 — 파일은 손에 있는데 못 여는 것이다.
const TIER_FILE_ALT = { decree: '대통령령.txt' };

// tier → `별표/` 안의 파일명·_links.json 키 앞머리(예: rule → `시행규칙_별표1.txt`, `"시행규칙 별표 1"`).
const TIER_BYL_PREFIX = { law: '법률', decree: '시행령', rule: '시행규칙' };

// 한 팝업에 나열하는 조의 상한. 넘으면 억지로 다 싣지 않고 "원문이 깁니다"로 넘긴다(목업 확정).
const MAX_ARTICLES = 15;
// 한 번에 판정할 별표·서식 참조 상한(원문이 긴 문서에서 GitHub 조회가 폭주하지 않게).
const MAX_REFS = 12;
// 본문 안 이미지 참조(`【이미지 N】`)는 이 상한을 따로 쓴다. 별표·서식과 달리 판정에 드는 조회가
// 문서당 목록 조회 **한 번**뿐이라(resolveRefs ①) 개수가 늘어도 비용이 늘지 않는다.
// ⚠ 같이 세면 그림이 많은 조에서 이미지가 12칸을 다 먹어 **별표·서식이 판정도 못 받고 밀린다** —
//   실측 최다는 한 조에 18장(환경보전해역및특별관리해역지정)이라 그 한 조가 상한을 통째로 썼다.
const MAX_IMG_REFS = 24;
// 별표 링크가 상대경로(`/LSW/flDownload.do?flSeq=…`)로 적힌 파일이 있어 붙일 호스트.
const LAWGO_ORIGIN = 'https://www.law.go.kr';
// raw 폴더 경로(law_raw_paths.json 값) → GET /api/legal/src 의 p 파라미터로 바꿀 때 떼는 앞부분.
const RAW_PREFIX = 'local_server/knowledge/legal/raw/';

/** 정규식에 그대로 끼워 넣기 위해 특수문자를 이스케이프한다. */
function reEsc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `20260624` → `2026-06-24`. 8자리가 아니면 원문 그대로 돌려준다. */
function fmtDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s || '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : String(s || '');
}

/** 파일명·고시제목 비교용 정규화: 공백·기호를 전부 걷어내고 글자만 남긴다. */
function squash(s) {
  return String(s || '').replace(/\.txt$/i, '').replace(/[^0-9A-Za-z가-힣]/g, '');
}

// 범위 표기. 실측 두 가지 — `제1조~제10조`(A)와 `제1~9조`(B). 물결은 ~ ～ ∼ 가 섞여 있고
// (`제21∼22조`는 U+223C), `전문(제1~24조)`처럼 괄호에 싸여 있기도 해 부분일치로 찾는다.
const RANGE_A = /제\s*(\d+)\s*조\s*[~～∼\-–—]\s*제\s*(\d+)\s*조/;
const RANGE_B = /제\s*(\d+)\s*[~～∼\-–—]\s*(\d+)\s*조/;

// 나열 표기(list). 실측 표기가 갈린다 — `제53조·제55조`(조마다 '제'·'조' 다 붙음)와
// `제109·110조`(마지막에만 '조'가 붙는 축약형), 가지번호도 `제12조의2`·`17의2` 두 형태다.
// ⚠ **표기 전체가 조 번호 나열일 때만** 인정한다(칸 전체 완전일치) — `제48조·선장병과(제44조②)`나
//   `제43·47조 / 별표4`처럼 다른 글자가 섞이면 우리가 그 의미를 단정할 수 없으므로 손대지 않고
//   기존 처리(단일 인식 또는 실패)로 흘려보낸다.
// ⚠ 항·호 글자도 받는다 — `제28조제4항·제30조제2항`처럼 **조마다 각자 항·호가 붙은 나열**을
//   안 받으면 나열 판정 자체를 포기하고 단일 정규식이 앞의 제28조만 집어, 뒤의 제30조가 경고도
//   없이 사라진다("부분 실패는 정직하게 표시" 계약 위반). 조가 결국 하나뿐이면(`제28조제1항제14호·
//   제28조제4항`) parseJoEnum 이 null 로 물러나 기존 단일 처리로 그대로 흘러간다.
const LIST_ONLY_RE = /^[\s제조의항호0-9·ㆍ・,~～∼]+$/;
// 항목 = 조 하나(`제55조`·`110`·`12조의2`·`17의2`). 실측에 `제19조의2조`처럼 '조'가 덧붙은 오타가
// 있어 꼬리 '조'는 선택으로 둔다. 꼬리에 붙은 항·호(`제28조제4항`)는 조를 가리키는 데 쓰지 않으므로
// 읽고 버린다(나열은 강조를 하지 않는다 — 여러 조 중 어디가 근거인지 단정할 수 없다).
// ⚠ 숫자마다 뒤에 `(?!\d)`를 붙여 **숫자를 중간에서 자르지 못하게** 막는다. 꼬리 항·호 그룹이
//   선택이라, 이게 없으면 `제10호`에서 정규식이 10을 1과 `0호`로 쪼개 **인용된 적 없는 제1조**를
//   지어낸다(`제2조제1호·제10호·제30조` → 제2조·제1조·제30조). 지금 위키엔 이 표기가 없지만
//   생기면 조용히 없는 조를 근거로 보여주게 된다(환각 0 위반). 이제는 못 읽고 parseJoEnum 이
//   null 로 물러나 기존 단일 처리로 흘러간다.
const LIST_ITEM_RE = /^\s*제?\s*(\d+)(?!\d)(?:\s*조?\s*의\s*(\d+)(?!\d))?\s*조?\s*(?:제?\s*\d+(?!\d)\s*항)?\s*(?:제?\s*\d+(?!\d)\s*호)?\s*$/;
// 항목 = 앞 항목의 본조를 물려받는 가지번호만 적힌 표기(`제12조의2·의3`의 `의3`, 실측 1건).
// 이걸 못 읽으면 나열 전체가 null 로 물러나 앞의 `제12조의2` 하나만 열린다(뒤 조가 조용히 사라진다).
const LIST_ITEM_BRANCH_RE = /^\s*의\s*(\d+)\s*$/;
// 항목 = 나열 안의 작은 범위(`46~49`). `제168~173·179조`처럼 범위와 나열이 섞인 실측 표기가 있어
// 함께 받는다 — 안 받으면 범위 정규식이 앞부분만 집고 나머지 조를 조용히 버린다.
// ⚠ 끝에 가지번호가 붙는 표기(`제82~89조의2`)도 받는다 — 안 받으면 나열 전체가 null 로 물러나
//   범위 정규식이 `제82~89조`만 집고 뒤에 나열된 `93·94`를 조용히 버린다(실측 1건). 가지번호
//   자체는 expandRange 가 원문에서 그 구간의 가지번호 조를 주워담아 채운다.
const LIST_ITEM_RANGE_RE = /^\s*제?\s*(\d+)\s*[~～∼]\s*(\d+)\s*(?:조\s*의\s*\d+)?\s*조?\s*$/;

/**
 * `제53조·제55조`·`제109·110조`처럼 **가운뎃점(·ㆍ・)이나 쉼표로 나열된 여러 조**를 조 번호
 * 목록으로 편다. 하나라도 못 읽는 항목이 있으면 통째로 null 을 돌려 기존 처리에 맡긴다
 * (절반만 골라 여는 것이 이 저장소에서 가장 하면 안 되는 일이다 — 사용자는 전부 본 줄 안다).
 *
 * ⚠ 맨숫자 항목(`110`·`6`)을 무엇으로 읽느냐가 이 함수의 핵심이다 — **뒤에 '조'가 붙은 항목이
 *   있는지**로 가른다(실측 542건 전수 확인).
 *   · 뒤에 '조'가 있으면 축약 나열이다 — 맨숫자들이 그 '조'를 나눠 갖는다(`제109·110조`·`제50·50조의2`).
 *     `제13·…·17의2·18·…·28조`처럼 가운데에 가지번호가 섞여도 뒤의 맨숫자는 여전히 **별개 조**다
 *     (실측 8건 전부 그렇다).
 *   · 뒤에 '조'가 하나도 없으면 그 맨숫자를 조 번호로 읽을 근거가 없다 — 바로 앞 항목이 `제N조의M`일
 *     때만 **같은 본조의 다음 가지번호**로 읽는다(`제30조의5·6` → 제30조의5·제30조의6, 실측 2건 모두
 *     이 뜻). 앞 항목이 가지번호도 아니면 단정할 수 없으므로 null 로 물러난다(single 모드로 안전 후퇴).
 *   ↳ 이 구분을 안 하면 `제30조의5·6`(수상구조법 "비밀준수")이 제30조의6 대신 **제6조**(각급 해양수색
 *     구조기술위원회 설치)를 근거인 척 보여준다 — 완전히 다른 조라 "환각 0" 위반이다.
 *
 * 예: parseJoEnum('제53조·제55조')   → {joList:['제53조','제55조'], spans:[]}
 *     parseJoEnum('제109·110조')     → {joList:['제109조','제110조'], spans:[]}
 *     parseJoEnum('제168~173·179조') → {joList:['제168조'…'제173조','제179조'], spans:[[168,173]]}
 *     parseJoEnum('제30조의5·6')     → {joList:['제30조의5','제30조의6'], spans:[]}
 *     parseJoEnum('제43·47조 / 별표4') → null(다른 글자가 섞여 단정 불가)
 * @param {string} s - 조문 표기(화살표 뒷부분은 이미 잘라낸 것)
 * @returns {{joList:string[], spans:Array<[number,number]>}|null}
 *          조 2개 이상이면 목록(등장 순서·중복 제거) + 나열 안에 있던 범위 구간, 아니면 null.
 *          spans 는 expandRange()가 "그 범위 안의 가지번호 조"를 원문에서 주워담는 데 쓴다.
 * [연계] ← parseArticleRef(mode:'list'). → loadArticle 이 range 와 같은 경로로 원문을 나열한다.
 */
function parseJoEnum(s) {
  if (!LIST_ONLY_RE.test(s) || !/[·ㆍ・,]/.test(s) || !/조/.test(s)) return null;
  const toks = s.split(/[·ㆍ・,]/).map(t => t.trim()).filter(Boolean);
  const out = [];
  const spans = [];
  let prevBranchJo = 0;   // 바로 앞 항목이 `제N조의M`이었으면 그 본조 번호 N(아니면 0)
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const rm = LIST_ITEM_RANGE_RE.exec(t);
    if (rm) {
      const from = parseInt(rm[1], 10), to = parseInt(rm[2], 10);
      if (!(from >= 1 && to > from)) return null;
      for (let i = from; i <= to; i++) out.push(`제${i}조`);
      spans.push([from, to]);
      prevBranchJo = 0;
      continue;
    }
    const bm = LIST_ITEM_BRANCH_RE.exec(t);
    if (bm) {
      if (!prevBranchJo) return null;             // 물려받을 본조가 없다 — 단정 불가
      out.push(`제${prevBranchJo}조의${bm[1]}`);
      continue;
    }
    const m = LIST_ITEM_RE.exec(t);
    if (!m) return null;
    if (m[2]) { out.push(`제${m[1]}조의${m[2]}`); prevBranchJo = parseInt(m[1], 10); continue; }
    // 맨숫자 항목 — 뒤쪽 어딘가에 '조'가 적혀 있어야 그 '조'를 나눠 가진 조 번호로 읽을 수 있다.
    if (!/조/.test(t) && !toks.slice(i + 1).some(x => /조/.test(x))) {
      if (prevBranchJo) { out.push(`제${prevBranchJo}조의${m[1]}`); continue; }
      // 앞에 범위 항목(`제82~89조의2`)이 있었으면 그 '조'를 나눠 갖는 조 번호로 읽는다 — 범위는
      // 가지번호가 아니라 조 번호를 세는 표기라, 뒤에 붙은 맨숫자도 조 번호다(실측 1건).
      if (!spans.length) return null;             // 물려받을 본조도, 앞선 범위도 없다 — 단정 불가
    }
    out.push(`제${m[1]}조`);
    prevBranchJo = 0;
  }
  const uniq = [...new Set(out)];
  return uniq.length >= 2 ? { joList: uniq, spans } : null;
}

// 문서 전체 표기(실측: `전체` 19건 · `전문` 9건 · `전 5조` 2건). `전문교육기관`·`전문인력`
// 처럼 "전문"으로 시작만 하는 딴 말이 실제로 있어 **완전일치**로만 인정한다.
const WHOLE_RE = /^(전체|전문|전부|전\s*\d+\s*조)$/;

// 한 항의 호를 가운뎃점으로 이어 적고 '호'를 맨 끝에 한 번만 붙인 표기(`②5·6·6의2호`·`제1항제1·2호`).
// 조 표기 **바로 뒤**에서 시작해야(^) 하고, 항 기호와 숫자·`의`·가운뎃점 말고는 아무 글자도 끼면
// 안 된다 — 그래야 `제48조·선장병과(제44조②)`처럼 뒤에 다른 조를 덧붙인 칸을 건드리지 않는다.
const HO_ENUM_RE = /^\s*(?:[①-⑳]|제\s*\d+\s*항)?\s*제?\s*(\d+(?:\s*의\s*\d+)?(?:\s*[·ㆍ・]\s*제?\s*\d+(?:\s*의\s*\d+)?)+)\s*호/;

// 별표·서식만 가리키는 표기의 머리(`별표10`·`별지 제2호서식`·`서식1`·`별표1의2`).
const ANNEX_HEAD_RE = /(별표|별지|서식)\s*제?\s*(\d+)(?:\s*의\s*(\d+))?/g;
// 그 머리에 이어 붙는 나열(`·3`)·범위(`~5`). ⚠ 쉼표는 이음표로 쓰지 않는다 —
// `별표1의3 제4호, 별표3 제4호`의 `, 제4호`를 이어 읽으면 인용된 적 없는 별표4를 만들어낸다.
const ANNEX_TAIL_RE = /^\s*(?:([·ㆍ・])\s*제?\s*(\d+)(?:\s*의\s*(\d+))?|([~～∼])\s*(\d+)(?:\s*의\s*(\d+))?)/;

/**
 * 조 번호 없이 **별표·서식만** 가리키는 조문 표기에서 참조 열쇠를 뽑는다.
 * 위키 조문 칸에는 `별표10`처럼 조를 거치지 않고 별표 자체가 근거인 행이 실측 228개 있는데,
 * 지금까지는 `제N조` 패턴이 없다는 이유로 전부 bad_request 로 실패했다(우리가 그 별표 원문을
 * 갖고 있어도 아무것도 못 보여줬다).
 *  ⚠ 이어 읽기는 **가운뎃점·물결**로만 한다 — 쉼표·괄호·한글 꼬리(`별표2 가·나·다목`·`별표1(나)`)에서
 *    멈춰야 그 별표의 세부 항목 표기를 다른 별표 번호로 잘못 읽지 않는다.
 *  ⚠ 범위 끝에 가지번호가 붙은 표기(`별표27~29의3`)는 정수 구간과 그 끝 가지번호만 담는다 —
 *    사이의 가지번호(29의2)가 실제로 있는지 여기서는 알 수 없어 넘겨짚지 않는다.
 * 예: parseAnnexRefs('별표10')       → ['별표10']
 *     parseAnnexRefs('별표2·3')      → ['별표2','별표3']
 *     parseAnnexRefs('별표1~3·5')    → ['별표1','별표2','별표3','별표5']
 *     parseAnnexRefs('별표2 가·나·다목') → ['별표2']
 *     parseAnnexRefs('별지 제1~3호서식') → ['서식1','서식2','서식3']
 * @param {string} s - 조문 표기(화살표 뒷부분은 이미 잘라낸 것)
 * @returns {string[]|null} refKey 목록(최대 MAX_REFS), 하나도 못 읽으면 null
 * [연계] ← readArticleRef(mode:'annex'). → loadArticle 이 resolveRefs 로 그 별표 원문을 찾는다.
 */
function parseAnnexRefs(s) {
  const src = String(s || '');
  const out = [];
  const push = k => { if (!out.includes(k)) out.push(k); };
  ANNEX_HEAD_RE.lastIndex = 0;
  let m;
  while ((m = ANNEX_HEAD_RE.exec(src))) {
    const type = m[1] === '별표' ? '별표' : '서식';
    let from = parseInt(m[2], 10);
    push(type + m[2] + (m[3] ? '의' + m[3] : ''));
    let i = ANNEX_HEAD_RE.lastIndex, cm;
    while ((cm = ANNEX_TAIL_RE.exec(src.slice(i)))) {
      if (cm[1]) {                                   // `·3` — 같은 종류의 다음 번호
        push(type + cm[2] + (cm[3] ? '의' + cm[3] : ''));
        from = parseInt(cm[2], 10);
      } else {                                       // `~5` — 구간
        const to = parseInt(cm[5], 10);
        if (!(to > from)) break;
        for (let n = from + 1; n <= to; n++) push(type + n);
        if (cm[6]) push(type + cm[5] + '의' + cm[6]);
        from = to;
      }
      i += cm[0].length;
    }
    ANNEX_HEAD_RE.lastIndex = i;
  }
  return out.length ? out.slice(0, MAX_REFS) : null;
}

// 계층을 가리키는 낱말(legal_retriever.classifyTier 와 같은 낱말을 본다).
const TIER_WORD_RE = /시행규칙|시행령|법률|법/;
// 계층별 표기 — 조문 칸에서 "이 조가 어느 계층 것인지" 읽을 때 쓴다(정규식 조각).
const TIER_TAG_SRC = { law: '법률|법', decree: '시행령', rule: '시행규칙' };

/**
 * 법령 칸이 계층을 **둘 이상** 지목하는가. 위키에는 한 칸에 위임흐름을 통째로 적은 행이 있다 —
 * `법·시행령`·`시행령ㆍ시행규칙`·`이 법·시행규칙`·`동법 → 시행령`·`양식산업발전법·시행령`.
 * 가운뎃점·빗금·화살표로 갈라 **각 조각이 계층 낱말을 갖는지**로 센다(낱말 개수가 아니다) —
 * `수산업ㆍ어촌 발전 기본법 시행령`처럼 법령명 안에 가운뎃점이 있는 표기를 계층 둘로 오해하지
 * 않기 위해서다(조각 `수산업`엔 계층 낱말이 없다).
 * 예: multiTierCell('법·시행령') → true · multiTierCell('해양환경관리법 시행령') → false
 * @param {string} cell - 체인 행의 법령 칸 값
 * @returns {boolean}
 * [연계] ← parseArticleRef(). 계층이 섞인 칸은 조 번호를 어느 계층에 붙일지 단정할 수 없다.
 */
function multiTierCell(cell) {
  return String(cell || '').replace(/[「」『』]/g, '')
    .split(/[·ㆍ・,/]|→|⇒|➔|=>/)
    .filter(seg => TIER_WORD_RE.test(seg)).length >= 2;
}

/**
 * 조문 칸에서 그 계층 이름 **바로 뒤에** 적힌 조 표기를 읽는다. 못 찾으면 ''.
 * 예: tierTaggedJo('제4조·시행령 제5조', 'decree')        → '제5조'
 *     tierTaggedJo('제5ㆍ7ㆍ31조, 시행령 제4~5조', 'decree') → '제4조'(범위의 시작 조)
 *     tierTaggedJo('제30조의11, 시행령 제30조의11제1항', 'decree') → '제30조의11'
 *     tierTaggedJo('제13조 / 제5조', 'decree')            → ''(계층이 안 적혀 있다)
 * @param {string} cell - 체인 행의 조문 칸 값
 * @param {string} tier - law|decree|rule (notice 는 계층 낱말이 없어 항상 '')
 * @returns {string}
 * [연계] ← parseArticleRef(). parseArticleRef 가 고른 조와 같아야 그 조가 이 계층 것이라고 말할 수 있다.
 */
function tierTaggedJo(cell, tier) {
  const w = TIER_TAG_SRC[tier];
  if (!w) return '';
  const m = new RegExp(`(?:${w})\\s*제\\s*(\\d+)(?:\\s*조\\s*의\\s*(\\d+))?`).exec(String(cell || ''));
  return m ? (m[2] ? `제${m[1]}조의${m[2]}` : `제${m[1]}조`) : '';
}

/**
 * 우리가 고른 조가 **이 행의 계층(tier) 것이 맞다고 말할 수 있는지** 확인한다.
 * 계층 판정(classifyTier)은 법령 칸에서 계층을 **우선순위로** 고르고(시행령 > 시행규칙 > 고시 > 법률),
 * 조 번호 판정(parseArticleRef)은 조문 칸에서 **앞에 적힌 것**을 고른다 — 그래서 한 칸에 계층이 둘
 * 이상 섞인 행에서는 "계층은 뒤쪽 것, 조 번호는 앞쪽 것"이 붙어 **인용된 적 없는 엉뚱한 조**가 열린다
 * (실측: `법·시행령`/`제4조·시행령 제5조` → 시행령 제4조(면허신청)가 열림, 근거는 시행령 제5조(시설기준)).
 * 그런 행은 우리가 단정할 수 없으므로 열지 않고 정직하게 실패한다("환각 0" — 틀린 원문을 보여주느니
 * 안 여는 게 낫다).
 *  ⓐ 법령 칸이 계층을 둘 이상 지목하면 — 조문 칸이 우리가 고른 조를 **그 계층으로 명시**했을 때만 연다
 *     (`시행령 제24조, 시행규칙 제9조`·`제28조, 시행령 제28조`는 명시돼 있어 그대로 열린다).
 *  ⓑ 조문 칸이 우리가 고른 조를 **다른 계층으로** 명시했으면 연다고 할 수 없다
 *     (법령='수산업법'(법률)인데 조문='시행규칙 제11조'인 행).
 * 예: tierIsCertain('제4조·시행령 제5조', 'decree', '법·시행령', {joList:['제4조']})   → false
 *     tierIsCertain('시행령 제24조, 시행규칙 제9조', 'decree', '시행령ㆍ시행규칙', {joList:['제24조']}) → true
 *     tierIsCertain('제10조④3호', 'law', '이 법', {joList:['제10조']})                → true(섞인 게 없다)
 * @param {string} article - 체인 행의 조문 칸 값
 * @param {string} tier - law|decree|rule|notice
 * @param {string} lawCell - 체인 행의 법령 칸 값(없으면 ⓐ는 건너뛴다)
 * @param {{joList:string[]}} ref - parseArticleRef 가 읽어낸 결과
 * @returns {boolean}
 * [연계] ← parseArticleRef(). false 면 null → loadArticle 이 bad_request 로 정직하게 실패한다.
 */
function tierIsCertain(article, tier, lawCell, ref) {
  // 별표 전용 인용은 조 번호가 없어 조문 칸으로 계층을 확인할 길이 없다 — 법령 칸이 계층을 둘 이상
  // 지목하면(`법·시행령`) 그 별표가 어느 계층 것인지 단정할 수 없으므로 열지 않는다.
  if (ref.mode === 'annex') return !multiTierCell(lawCell);
  // readArticleRef 가 읽은 것과 **같은 구간**만 본다 — `제2조제4항 → 시행령 제2조`처럼 화살표 뒤에
  // 다음 단계 조가 적힌 행에서, 뒤쪽 `시행령 제2조`를 앞쪽 조의 계층표시로 오해하면 안 된다.
  const s = String(article || '').split(/→|⇒|➔|=>/)[0];
  const jo = (ref.joList || [])[0] || '';
  if (multiTierCell(lawCell) && tierTaggedJo(s, tier) !== jo) return false;
  for (const t of Object.keys(TIER_TAG_SRC)) {
    if (t !== tier && jo && tierTaggedJo(s, t) === jo) return false;
  }
  return true;
}

/**
 * 위키 표의 조문 표기에서 인용 형태(single·list·range·whole)와 조·항·호를 뽑는다. 표기는
 * 페이지마다 여러 가지가 섞여 있다(실측) — 조 하나(`제10조④3호`/`제10조제4항제3호`),
 * 나열(`제53조·제55조`), 범위(`제1~9조`), 문서 전체(`전체`·`전문`), 그리고 고시엔 조 번호 없이
 * 제목만 적힌 행도 있다.
 * 예: parseArticleRef('제10조④3호')       → {mode:'single', jo:'제10조', mark:'④', ho:3}
 *     parseArticleRef('제5조제1항')        → {mode:'single', jo:'제5조', mark:'①', ho:0, hoList:[]}
 *     parseArticleRef('제53조②5·6·6의2호') → {mode:'single', jo:'제53조', mark:'②', ho:5, hoList:['5','6','6의2']}
 *     parseArticleRef('제53조·제55조')      → {mode:'list', joList:['제53조','제55조'], label:'제53조·제55조'}
 *     parseArticleRef('전문(제1~24조)')     → {mode:'range', joList:['제1조'…'제24조'], label:'제1조~제24조'}
 *     parseArticleRef('전체')              → {mode:'whole', joList:[], label:'전체'}
 *     parseArticleRef('위험물선박운송기준', 'notice') → {mode:'whole', …}(고시 제목만 적힌 행)
 * @param {string} article - 체인 행의 조문 표기
 * @param {string} [tier] - law|decree|rule|notice. 고시일 때만 "조 번호 없음 → 문서 전체"로 본다
 * @param {string} [lawCell] - 체인 행의 법령 칸 값. 조문 칸이 번호 없이 `별표`라고만 적힌 행에서
 *                             그 번호를 읽는 데만 쓴다(`법령='시행규칙 별표2·3' / 조문='별표'`)
 * @returns {{mode:string, jo:string, joList:string[], from:number, to:number, mark:string, ho:number, hoList:string[], label:string}|null}
 *          어느 형태로도 못 읽으면 null(from·to 는 range 일 때만, refKeys 는 annex 일 때만 있다)
 *          hoList 는 강조할 호 번호를 **원문에 적힌 모양 그대로** 담는다(`['5','6','6의2']`) —
 *          splitHo 가 붙이는 item.label 과 같은 표기라 그대로 대조하면 된다.
 * [연계] ← parseArticleRef(). jo·joList 는 원문에서 조 블록을 찾는 열쇠, mark·hoList 는 강조 대상(single 전용).
 */
function readArticleRef(article, tier, lawCell) {
  // `제69조 → 시행령 제42~45조`처럼 위임흐름을 한 칸에 적은 표기가 있다 — 이 행의 법령은 앞쪽
  //  것이므로 화살표 뒤(다른 계층의 조)는 잘라낸다. 안 자르면 법률 카드가 시행령 조를 연다.
  const s = String(article || '').split(/→|⇒|➔|=>/)[0].trim();
  if (!s) return null;

  // ⚠ 부칙 조문(`부칙(제30106호) 제2조`)은 본문 조와 번호가 겹친다 — 그대로 읽으면 부칙 제2조 대신
  //   **본문 제2조**가 근거인 척 열린다(실측 3행). 부칙 전용 파싱은 아직 없으므로 정직하게 실패한다.
  if (/부칙/.test(s)) return null;

  // ⓪ 나열 — `제53조·제55조`는 단일 정규식이 앞의 `제53조`만 집어 **절반만** 보여주고(팝업 제목엔
  //    두 조가 다 떠서 전부 본 줄 안다), `제168~173·179조`는 범위 정규식이 앞 범위만 집어 마지막
  //    조를 조용히 버린다 — 그래서 범위·단일보다 **먼저** 본다.
  const enumRef = parseJoEnum(s);
  if (enumRef) {
    return {
      mode: 'list', jo: '', joList: enumRef.joList, spans: enumRef.spans,
      mark: '', ho: 0, label: enumRef.joList.join('·'),
    };
  }

  // ① 범위 — 단일 정규식(`제(\d+)조`)이 `제1조~제10조`의 앞부분만 집어 "제1조 하나"로 오인하므로
  //    반드시 단일보다 **먼저** 본다. 시작과 끝이 같으면(`제21조∼제21조의3`) 범위가 아니라
  //    조 하나를 가리키는 표기이므로 아래 단일 처리로 넘긴다.
  const rm = RANGE_A.exec(s) || RANGE_B.exec(s);
  if (rm) {
    const from = parseInt(rm[1], 10), to = parseInt(rm[2], 10);
    if (from >= 1 && to > from) {
      // ⚠ 범위 정규식은 부분일치라 `제8조·제3~6조`처럼 **범위 밖에 또 다른 조**가 나열된 칸에서
      //   앞의 `제8조`를 조용히 버린다. 게다가 `법령='시행령·시행규칙'`처럼 계층이 섞인 칸에서는
      //   다른 계층의 조번호를 지금 tier 에 적용해 엉뚱한 원문을 보여준다(화살표 뒤를 잘라낸 것과
      //   같은 종류의 사고). 열거 표기는 지원 범위 밖이므로 하나만 골라 쓰지 말고 정직하게 실패한다.
      const outside = s.slice(0, rm.index) + s.slice(rm.index + rm[0].length);
      if (/제\s*\d+\s*조/.test(outside)) return null;
      const joList = [];
      for (let i = from; i <= to; i++) joList.push(`제${i}조`);
      return { mode: 'range', jo: '', joList, from, to, mark: '', ho: 0, label: `제${from}조~제${to}조` };
    }
  }

  // ② 문서 전체
  if (WHOLE_RE.test(s)) return { mode: 'whole', jo: '', joList: [], mark: '', ho: 0, label: '전체' };

  const m = /제(\d+)조(?:의(\d+))?/.exec(s);
  if (!m) {
    // ③ 별표 전용 — 조를 거치지 않고 **별표·서식 자체가 근거**인 행(`별표10`·`별표2·3`, 실측 228행).
    //    조 본문 파싱을 건너뛰고 그 별표 원문을 바로 찾아 보여준다(loadArticle 의 annex 갈래).
    //    ⚠ `조`·`전문`이 섞인 칸(`제33·34조, 별표5`·`전문·별표1`)은 손대지 않는다 — 조와 별표 중
    //      무엇을 보여줘야 하는지 우리가 단정할 수 없어, 별표만 열면 인용된 조를 조용히 감추게 된다.
    if (/별표|별지|서식/.test(s) && !/조|전문|전체|전부/.test(s)) {
      // 조문 칸이 번호 없이 `별표`라고만 적힌 행이 있다 — 그 번호는 법령 칸에 적혀 있다
      // (`법령='시행규칙 별표2·3' / 조문='별표'`, 실측 3행). 조문 칸에 숫자가 있는데도 못 읽은
      // 경우엔 법령 칸으로 넘어가지 않는다(엉뚱한 번호를 끌어오지 않게).
      const keys = parseAnnexRefs(s) || (/\d/.test(s) ? null : parseAnnexRefs(lawCell));
      if (keys) {
        return { mode: 'annex', jo: '', joList: [], refKeys: keys, mark: '', ho: 0, label: keys.join('·') };
      }
    }
    // ③ 조 번호가 아예 없다 — 고시는 짧아서 위키가 "제목만 적고 문서 전체"를 가리키는 행이 흔하다
    //    (실측: `위험물선박운송기준`·`「수산물 표준규격」` 등). 다만 별표만 가리키는 행이나
    //    날짜가 잘못 들어온 행까지 문서 전체로 열면 엉뚱하므로 그런 표기는 제외한다.
    // ⚠ 순수한 조 나열(`제109·110조`)은 위 ⓪에서 이미 처리했지만, `제1~2호`나 `선박구명설비기준
    //   제98·99조`처럼 조 번호가 다른 글자와 섞여 우리가 단정할 수 없는 표기는 여기까지 내려온다.
    //   이걸 제목행으로 보면 사용자가 요청한 조 대신 문서 전체가 열려 **틀린 원문을 맞다고 보여주게**
    //   된다. 조·항·호·편 번호가 하나라도 있으면 "제목"이 아니라 "우리가 못 읽는 인용 표기"이므로
    //   정직하게 실패시킨다.
    //   단 `…(해수부고시 제804호)` 같은 **발령번호**는 인용이 아니므로 세기 전에 걷어낸다.
    const noIssueNo = s.replace(/(고시|훈령|예규|공고)\s*제\s*\d+\s*호/g, '');
    const looksLikeTitle = tier === 'notice' &&
      !/별표|별지|서식/.test(s) && !/\d{4}[-.]\d{1,2}/.test(s) && !/^[—\-–~]+$/.test(s) &&
      !/\d\s*[조항호편]/.test(noIssueNo);
    return looksLikeTitle ? { mode: 'whole', jo: '', joList: [], mark: '', ho: 0, label: '전체' } : null;
  }
  const jo = m[2] ? `제${m[1]}조의${m[2]}` : `제${m[1]}조`;
  // 조 표기 뒤쪽만 본다. `제48조·선장병과(제44조②)`처럼 다른 조를 덧붙인 표기가 있어
  // 가운뎃점·괄호·쉼표가 나오면 거기서 끊는다(뒤에 딸린 다른 조의 항을 잘못 집지 않게).
  const tail = s.slice(m.index + m[0].length);
  const rest = tail.split(/[·・,(（]/)[0];
  let mark = '';
  const cm = new RegExp(`[${CIRCLED}]`).exec(rest);
  if (cm) mark = cm[0];
  else {
    // ⚠ `제 5 항`처럼 **낱말 안에 공백이 낀 표기**도 같은 뜻으로 읽는다 — 이 조문 표기는 이제 위키
    //   표뿐 아니라 **답변 본문의 인용 문장**(`제58조 제5항 제7호`)에서도 들어오는데, 답변 문장은
    //   띄어쓰기를 넣어 쓰는 경우가 있어 공백을 안 받으면 항을 못 읽고 focused 가 false 로 떨어져
    //   조문 전체가 다시 펼쳐진다. 공백만 다른 표기를 같게 볼 뿐, 표기 자체가 다른 것(`제58조5항`)은
    //   여전히 안 읽는다(확신 없는 변종은 종전대로 물러난다).
    const hm = /제\s*(\d+)\s*항/.exec(rest);
    if (hm && +hm[1] >= 1 && +hm[1] <= CIRCLED.length) mark = CIRCLED[+hm[1] - 1];
  }
  // ⚠ 한 항의 호를 여러 개 적을 때 위키는 `제53조②5·6·6의2호`처럼 **가운뎃점으로 잇고 '호'를
  //   맨 끝에 한 번만** 붙인다(실측 40여 행). 위 rest 는 첫 가운뎃점에서 끊기므로 `②5`만 남고
  //   '호' 글자까지 사라져 아래 hoRe 가 0을 돌려주고, 그 결과 **어느 호도 강조되지 않았다**
  //   (사용자가 5·6·6의2호를 눌러도 항만 칠해졌다). 그렇다고 rest 의 끊기를 없애면
  //   `제48조·선장병과(제44조②)`처럼 **다른 조를 덧붙인 칸**의 뒤쪽 항·호를 이 조 것으로 잘못
  //   읽는다 — 그래서 끊기는 그대로 두고, 조 표기 바로 뒤가 (항 기호 다음) **숫자·`의`·가운뎃점만으로
  //   이어지다 '호'로 끝나는 모양**일 때만 따로 전부 읽는다. 다른 글자가 하나라도 끼면 매치되지
  //   않아 기존 처리로 그대로 흘러간다(`제27조①2~5호·6호`처럼 물결이 섞인 표기 등).
  const enumHo = HO_ENUM_RE.exec(tail);
  // 호도 같은 이유로 `제 7 호`까지 받는다(위 항 주석 참고). '제'는 원래부터 선택이다(`②7호`).
  const hoRe = /제?\s*(\d+)\s*호/.exec(rest);
  const hoList = enumHo
    ? enumHo[1].split(/[·ㆍ・]/).map(t => t.replace(/[제\s]/g, ''))
    : (hoRe ? [String(parseInt(hoRe[1], 10))] : []);
  return {
    mode: 'single', jo, joList: [jo], mark,
    // ho 는 예전부터 쓰던 "첫 호" 값(호가 하나뿐인 표기에서는 값이 예전과 똑같다).
    ho: hoList.length ? parseInt(hoList[0], 10) : 0,
    hoList, label: jo,
  };
}

/**
 * readArticleRef 로 조문 표기를 읽되, **그 조가 이 행의 계층 것이 맞을 때만** 돌려준다.
 * 계층이 섞인 행(`법·시행령` 같은 법령 칸)에서 조 번호를 엉뚱한 계층 원문에 갖다 대는 사고를
 * 막는 마지막 관문이다 — 자세한 이유는 tierIsCertain 주석 참고.
 * 예: parseArticleRef('제10조④3호', 'law', '이 법')        → {mode:'single', jo:'제10조', …}
 *     parseArticleRef('제4조·시행령 제5조', 'decree', '법·시행령') → null(어느 계층 조인지 단정 불가)
 * @param {string} article - 체인 행의 조문 표기
 * @param {string} [tier] - law|decree|rule|notice
 * @param {string} [lawCell] - 체인 행의 법령 칸 값(없으면 계층 혼합 판정을 건너뛴다)
 * @returns {object|null} readArticleRef 와 같은 형태, 못 읽거나 단정할 수 없으면 null
 * [연계] ← loadArticle(). → readArticleRef()·tierIsCertain()
 */
function parseArticleRef(article, tier, lawCell) {
  const ref = readArticleRef(article, tier, lawCell);
  if (!ref || !tierIsCertain(article, tier, lawCell, ref)) return null;
  return ref;
}

// 호 머리번호("1." "2." … 와 가지번호 "3의2." "6의2.") 탐지. 앞뒤가 숫자면 제외해 "2.5"·"28."류 오검출을 막는다.
// ⚠ 가지번호(`N의M.`)를 **한 덩어리로** 읽는 것이 이 정규식의 핵심이다. 예전에는 `(?<!\d)([1-9]\d?)\.`
//   뿐이라 `6의2.` 의 꼬리 `2.` 가 "새 1단계 호 2번"으로 잡혀 번호열이 1,2,3,2,4,…처럼 어그러졌고,
//   아래 연속성 검사가 통째로 실패해 **그 항 전체가 호로 안 쪼개진 글덩어리**로 보였다
//   (낚시관리및육성법 제53조② 실측 — 1,2,3,3의2,4,5,6,6의2,6의3,7,8,9). 앞의 `6`부터 매칭돼
//   `의2`까지 한 번에 소비하므로 꼬리 숫자가 다시 잡히지 않는다.
const HO_RE = /(?<!\d)([1-9]\d?)(?:의(\d+))?\.(?!\d)/g;

// 목 머리기호("가." "나." …) 탐지 — 호 하나 안의 세부 항목. 한글 낱자라 본문 글자와 헷갈리기 쉬워
// **줄머리(들여쓰기 허용)에서만** 인정한다. 안 그러면 `…제3호.`·`별표.` 같은 꼬리를 목으로 오인한다.
// (행정규칙처럼 조문이 한 줄에 통째로 들어있는 파일에는 줄머리가 없어 목 쪼개기가 안 걸린다 — 안전측.)
const MOK_RE = /(?:^|\n)[ \t]*([가-힣])\.(?=\s|$)/g;
// 목 머리기호의 정해진 차례(법제처 표기 순서). 실측 raw 에는 `허`까지 나온다.
const MOK_SEQ = '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허';

/**
 * 호 머리번호 목록이 **법령 번호매김 차례대로인지** 본다. 통상 1., 2., 3. 으로 이어지되,
 * 개정으로 사이에 끼워 넣은 호는 앞 호의 가지번호(`3의2.`)로 붙고 그 다음은 `3의3.` 또는 `4.` 다.
 * 예: hoSeqOk([1,2,3,3의2,4]) → true · hoSeqOk([1,2,3,2,4]) → false(가지번호를 잘못 읽은 흔적)
 * @param {Array<{num:number, sub:number}>} idxs - HO_RE 로 찾은 머리번호(sub 0 이면 가지번호 없음)
 * @returns {boolean}
 * [연계] ← splitHo(). false 면 쪼개기를 포기하고 항을 통째로 보여준다.
 */
function hoSeqOk(idxs) {
  let main = 0, sub = 0;
  for (const it of idxs) {
    if (!it.sub) {
      if (it.num !== main + 1) return false;
      main = it.num; sub = 0;
    } else {
      // 가지번호는 본조 번호를 그대로 물려받고 `의2`부터 시작한다(`3.` 다음은 `3의2.`, 그 다음 `3의3.`).
      if (it.num !== main || it.sub !== (sub ? sub + 1 : 2)) return false;
      sub = it.sub;
    }
  }
  return true;
}

/**
 * 호 하나를 목(가. 나. 다. …)으로 쪼갠다. **차례가 가.부터 연속일 때만** 쪼개고, 어긋나면
 * null 을 돌려 호출부가 "호 통째로" 보여주게 한다(호 쪼개기와 같은 계약 — 잘못 자르느니 안 자른다).
 * 예: splitMok('다음 각 목의 시설\n      가.  계류시설\n      나.  항행 보조시설')
 *     → {lead:'다음 각 목의 시설', subs:[{label:'가',text:'계류시설'},{label:'나',text:'항행 보조시설'}]}
 * @param {string} hoText - 호 텍스트(머리번호는 이미 떼어낸 것)
 * @returns {{lead:string, subs:Array<{label:string,text:string}>}|null} 못 쪼개면 null
 * [연계] ← splitHo(). 결과 subs 가 팝업의 `목` 목록이 된다(원문에 있는 가·나·다를 그대로 쓴다).
 */
function splitMok(hoText) {
  const body = String(hoText || '');
  const hits = [];
  let m;
  MOK_RE.lastIndex = 0;
  while ((m = MOK_RE.exec(body))) {
    // m[0] 앞머리의 줄바꿈·들여쓰기는 잘라낼 자리 계산에서 빼야 lead 끝에 공백만 남는다.
    const at = m.index + m[0].length - m[1].length - 1;
    hits.push({ pos: at, label: m[1], len: m[1].length + 1 });
  }
  if (hits.length < 2) return null;                      // 목이 하나뿐이면 쪼갤 이유가 없다
  for (let i = 0; i < hits.length; i++) {
    if (hits[i].label !== MOK_SEQ[i]) return null;       // 가·나·다… 차례가 아니면 목이 아니다
  }
  const subs = hits.map((h, i) => ({
    label: h.label,
    text: body.slice(h.pos + h.len, i + 1 < hits.length ? hits[i + 1].pos : body.length).trim(),
  }));
  return { lead: body.slice(0, hits[0].pos).trim(), subs };
}

/**
 * 항 하나를 호(1. 2. 3. … · 가지번호 3의2.)로 쪼개고, 각 호 안에 목(가. 나. …)이 있으면 한 단계 더 쪼갠다.
 * **번호가 1부터 차례대로일 때만** 쪼개고, 하나라도 어긋나면 null 을 돌려 호출부가 "항 통째로"
 * 보여주게 한다(잘못 자르느니 안 자른다).
 * 예: splitHo('② 다음 각 호와 같다.1. 가나2. 다라')
 *     → {lead:'② 다음 각 호와 같다.', items:[{label:'1',text:'가나',subs:null},{label:'2',…}]}
 *     splitHo('② …1. 가2. 나3. 다3의2. 라4. 마') → items 의 label 이 '1','2','3','3의2','4'
 *     splitHo('… 7.31.까지 …')                  → null(번호가 1,2,3… 차례가 아니라 포기)
 * @param {string} hangText - 항 텍스트(머리기호 ①… 포함 가능)
 * @returns {{lead:string, items:Array<{label:string, text:string, subs:Array<{label:string,text:string}>|null}>}|null}
 *          못 쪼개면 null. label 은 **원문에 적힌 번호 그대로**다(`6의2`) — 화면 표시와 호 강조(hit) 판정에 함께 쓴다.
 * [연계] ← splitParagraphs(). 결과 items 가 팝업의 `호` 목록이 된다.
 */
function splitHo(hangText) {
  // 항 머리기호(①등, 있으면) 제거 후 검사
  const head = /^[①-⑳]/.test(hangText) ? hangText.slice(0, 1) : '';
  const body = hangText.replace(/^[①-⑳]/, '');
  const idxs = [];
  let m;
  HO_RE.lastIndex = 0;
  while ((m = HO_RE.exec(body))) {
    idxs.push({ pos: m.index, num: parseInt(m[1], 10), sub: m[2] ? parseInt(m[2], 10) : 0, len: m[0].length });
  }
  if (!idxs.length) return null;
  if (!hoSeqOk(idxs)) return null;                       // 차례가 어긋나면 포기 → 항 통째로
  const items = [];
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i].pos + idxs[i].len;
    const end = i + 1 < idxs.length ? idxs[i + 1].pos : body.length;
    const raw = body.slice(start, end).trim();
    const mok = splitMok(raw);
    items.push({
      label: idxs[i].sub ? `${idxs[i].num}의${idxs[i].sub}` : String(idxs[i].num),
      text: mok ? mok.lead : raw,
      subs: mok ? mok.subs : null,
    });
  }
  return { lead: (head + body.slice(0, idxs[0].pos)).trim(), items };
}

/**
 * 항 하나(호·목 포함)의 글자를 전부 이어붙인다. 별표·서식 참조를 훑을 때 쓴다 —
 * 호·목으로 쪼개진 글을 빼먹으면 그 안의 `별표 1` 참조가 통째로 사라진다.
 * 예: paraPlainText({text:'…', items:[{text:'가', subs:[{text:'나'}]}]}) → '… 가 나'
 * @param {{text:string, items:Array|null}} p - splitParagraphs() 가 만든 항 하나
 * @returns {string}
 * [연계] ← loadArticle(). → collectRefs()
 */
function paraPlainText(p) {
  const items = (p.items || []).map(it => it.text + (it.subs || []).map(s => ' ' + s.text).join(''));
  return p.text + items.map(t => ' ' + t).join('');
}

/**
 * 조 본문을 항(①②③…) 단위로 쪼갠다. 항 기호 없이 시작하는 앞부분(제66조 벌칙처럼
 * 항 구분이 없는 조)은 mark 가 빈 첫 조각으로 둔다.
 * 예: splitParagraphs('① 가나\n② 다라') → [{mark:'①',text:'가나',items:null},{mark:'②',…}]
 * @param {string} body - extractArticleBlock 이 뽑은 조 본문
 * @returns {Array<{mark:string, text:string, items:Array<{label:string,text:string,subs:Array|null}>|null}>}
 * [연계] ← extractArticleBlock 결과 → loadArticle 이 hit 표시를 얹어 응답으로 만든다.
 */
function splitParagraphs(body) {
  return String(body || '')
    .split(/(?=[①-⑳])/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(chunk => {
      const mark = /^[①-⑳]/.test(chunk) ? chunk[0] : '';
      const ho = splitHo(chunk);
      if (ho) return { mark, text: ho.lead.replace(/^[①-⑳]\s*/, ''), items: ho.items };
      return { mark, text: chunk.replace(/^[①-⑳]\s*/, ''), items: null };
    });
}

/**
 * 원문 텍스트에서 조 하나의 블록(제목·시행일자·본문)을 잘라낸다.
 * 형식은 파일 종류로 갈린다(파일 헤더 주석의 "원문 형식" 참고).
 * 예: extractArticleBlock(법률txt, '제10조', 'law')
 *     → {title:'역사문화환경 보존지역의 보호', effectiveDate:'2026-06-24', body:'① …'}
 * @param {string} text - 파일 전체 원문
 * @param {string} jo - 조 표기(예 '제10조', '제7조의2')
 * @param {string} tier - law|decree|rule|notice
 * @returns {{title:string, effectiveDate:string, body:string, addenda:string}|null} 그 조가 없으면 null
 *          addenda 는 이 조 **바로 뒤에 부칙이 붙어 있을 때만** 그 부칙 원문(문서의 마지막 조에서만
 *          생긴다). 본문(body)에는 절대 섞이지 않는다 — 자세한 이유는 addendaAfter() 주석 참고.
 * [연계] ← loadArticle(). → splitParagraphs()·addendaAfter()
 */
function extractArticleBlock(text, jo, tier) {
  const src = String(text || '');
  if (tier === 'notice') {
    // `제18조(제목) 본문 …` — 다음 조/장 제목/별표/부칙이 줄머리에 나오면 거기서 끝.
    // ⚠ m 플래그를 쓰면 `$`가 "줄 끝"이 돼 본문이 첫 줄에서 잘린다 — 줄머리는 `(?:^|\n)`로 잡고
    //   m 플래그는 쓰지 않는다(실측으로 확인한 함정).
    // ⚠ 부칙·별표 경계는 DOC_TAIL_SRC 하나만 쓴다(따로 좁은 패턴을 두면 마지막 조에 부칙·별표가
    //   통째로 딸려 들어가 인용하지도 않은 별표 링크가 붙는다 — leak 재발 방지).
    const re = new RegExp(
      `(?:^|\\n)${reEsc(jo)}\\(([^)]*)\\)([\\s\\S]*?)(?=\\n제\\d+조(?:의\\d+)?\\(|\\n제\\d+장|${DOC_TAIL_SRC}|$)`
    );
    const m = re.exec(src);
    if (!m) return null;
    const eff = /시행일자\s*:?\s*(\d{8})/.exec(src) || /발령일자\s*:?\s*(\d{8})/.exec(src);
    return {
      title: m[1].trim(), effectiveDate: eff ? fmtDate(eff[1]) : '', body: m[2].trim(),
      addenda: addendaAfter(src, m.index + m[0].length),
    };
  }
  // `[제10조] 제목 (시행 20260624 · 타법개정)` 헤더 줄 + 다음 `[제N조]` 전까지가 본문.
  // ⚠ 마지막 조 뒤엔 다음 `[제N조]`가 없어 lookahead가 파일 끝(`$`)까지 먹는데, 그러면 뒤에
  //   오는 부칙 전체(다른 법률의 개정 등)까지 그 조 본문으로 딸려 들어간다(실측으로 확인한
  //   함정 — notice 분기엔 `\n부칙`이 이미 있었는데 이쪽엔 빠져 있었다). 부칙도 경계로 끊는다.
  // ⚠ 그 부칙 경계는 예전에 `\n부칙`(맨 글자)뿐이라 **`[부칙 <제…호,…>]`(대괄호 표기, 41개 파일)를
  //   못 끊었다** — 어선안전조업법 제58조 팝업에서 ⑦항 뒤에 부칙 전문이 조문인 척 붙어 나온
  //   실제 사고의 원인이다. 이제 세 표기를 다 받는 ADDENDA_HEAD_SRC 하나로 끊는다.
  const re = new RegExp(`(?:^|\\n)\\[${reEsc(jo)}\\]([^\\n]*)\\n([\\s\\S]*?)(?=\\n\\[제\\d+조|\\n${ADDENDA_HEAD_SRC}|$)`);
  const m = re.exec(src);
  if (!m) return null;
  const head = m[1].trim();
  const eff = /\(시행\s*(\d{8})/.exec(head);
  // 블록 끝에 다음 조 앞의 편장절 제목(`제3장 …`·`제1절 …`)이 딸려 올 수 있어 걷어낸다.
  // 제목 줄 앞에 빈 줄이 끼는 파일도 있어(어선법 등) 빈 줄도 함께 걷어낸다.
  const lines = m[2].split('\n');
  while (lines.length && /^$|^(제\d+[편장절]\s|부칙)/.test(lines[lines.length - 1].trim())) lines.pop();
  return {
    title: head.replace(/\s*\(시행[^)]*\)\s*$/, '').trim(),
    effectiveDate: eff ? fmtDate(eff[1]) : '',
    body: lines.join('\n').trim(),
    addenda: addendaAfter(src, m.index + m[0].length),
  };
}

/**
 * 원문에 섞여 있는 이미지 마커를 정리해 **그림이 있던 자리**에 `【이미지 N】` 참조를 남긴다.
 * 원문에는 두 가지 표기가 섞여 있다(전 raw 실측):
 *   - `<img id="123">` 860개 — law.go.kr 본문에 그림이 끼어 있던 자리
 *   - `【이미지판독 123】(원본이미지: _이미지/123.png)` 328개 — 우리가 그 그림을 스캔해 받아둔 표시
 * 325개는 둘이 짝으로 붙어 있어(같은 번호) 하나로 합친다. 짝이 없는 `<img id>` 도 참조로 바꾼다 —
 * ★2026-08-18: 예전에는 태그를 **통째로 지웠고**, 그래서 우리가 `_이미지/N.png` 를 갖고 있는데도
 *   화면에서 그림이 흔적 없이 사라지는 자리가 85개(18개 파일) 있었다. 예: 항만건설장비 고시
 *   제18조 "다음 표에 따른 기준에 적합하여야 한다.<img id=…>" — 정작 그 '다음 표'가 그림이라
 *   문장만 남고 표가 없어졌다. 이제는 참조로 남겨 화면이 그 자리에 그림을 그대로 띄운다.
 * ⚠ 우리가 파일을 갖고 있지 않은 번호(실측 446개)도 여기서는 참조로 남지만, resolveRefs()가
 *   kind='missing' 으로 판정하고 화면(appendText)이 **흔적 없이 지운다** — 예전과 같은 결과다.
 * `<img src="http://www.law.go.kr/…">` 같은 나머지 태그는 여전히 걷어낸다(가리킬 파일이 없다).
 * 예: cleanBody('… 있다.<img id="9"></img>\n【이미지판독 9】(원본이미지: _이미지/9.png)\n[표]…')
 *     → '… 있다.\n【이미지 9】\n[표]…'
 * @param {string} s - 조 본문
 * @returns {string}
 * [연계] → collectRefs()가 `【이미지 N】`을 참조로 잡고, resolveRefs()가 실제 파일 유무를 확인한다.
 */
function cleanBody(s) {
  return String(s || '')
    // ① 태그와 판독 마커가 같은 번호로 붙어 있는 짝(325개) — 같은 그림이니 참조 하나로 합친다.
    .replace(/<img id="(\d+)"[^>]*>(?:\s*<\/img>)?\s*【이미지판독\s*\1】\s*\([^)]*\)/g, '【이미지 $1】')
    // ② 짝이 없는 판독 마커
    .replace(/【이미지판독\s*(\d+)】\s*\(원본이미지:[^)]*\)/g, '【이미지 $1】')
    // ③ 짝이 없는 id 태그 — 자리를 남긴다(파일이 없으면 화면이 지운다)
    .replace(/<img id="(\d+)"[^>]*>/gi, '【이미지 $1】')
    // ④ 나머지 img 찌꺼기(닫는 태그·외부 주소 태그)는 가리킬 파일이 없어 그대로 걷어낸다.
    .replace(/<\/?img\b[^>]*>/gi, '');
}

// 본문 안의 별표·서식·이미지 참조 표현. 실측 표기가 `별표 1`·`별표1의2`·`별지 제1호서식`·
// `별지 제1호 서식` 로 갈려 있어 공백을 전부 선택적으로 둔다. ⚠ 클라이언트(ai_chat.js)의
// NRYA_REF_RE 와 **같은 표현이어야** 서버 판정과 화면 링크가 어긋나지 않는다.
const REF_RE = /별지\s*제\s*(\d+(?:의\d+)?)\s*호(?:\s*서식)?|별표\s*제?\s*(\d+(?:의\d+)?)|【이미지\s*(\d+)】/g;
// 고시 파일 뒤에 이어붙은 별표 블록의 머리 표기. 실측 10여 종이 섞여 있다 —
// `〔별표 1〕`·`[별표1]`·`(별표 1)`·`【별표 1】`·`[별지 제2호서식]`·`[별지 1]`·`「별지 1호」`·
// `[서식1]`·`[별표 1의4]`, 그리고 `■ 동력수상레저기구 안전검사 기준 [별표 1]`처럼 앞에 제목이 붙기도 한다.
// ⚠ 줄머리에서만 찾는다(본문 안 "별표 1"은 참조일 뿐 블록 시작이 아니다). 다만 머리줄이 공백으로
//   들여쓰여 있는 파일이 실측 35개 있어(`  ■ … [별지 제1호서식]`) 줄머리 공백은 허용한다 —
//   안 그러면 그 블록 93개를 못 잘라 앞 별표에 딸려 들어가고, 정작 그 번호는 "미수집"으로 보인다.
const ATT_HEAD_RE = /(?:^|\n)[ \t]*(?:■[^\n[〔【(「]*)?[[〔【(「]\s*(별표|별지|서식)\s*제?\s*(\d+(?:의\d+)?)\s*호?\s*(?:서식)?\s*[\]〕】)」]([^\n]*)/g;
// 별표 구간이 시작되는 자리 — `[별표] 제목` 묶음머리, 또는 번호 붙은 별표 블록.
const ANNEX_BLOCK_SRC = '\\n\\[별표\\]|\\n\\[별지\\]|\\n[ \\t]*(?:■[^\\n[〔【(「]*)?[[〔【(「]\\s*(?:별표|별지|서식)\\s*제?\\s*\\d';
const ANNEX_BLOCK_RE = new RegExp(ANNEX_BLOCK_SRC);
// 부칙 머리줄 — 줄머리(`\n`)에 이어 붙여 쓴다. 실측 표기 3종을 모두 받는다(전 raw 전수 집계):
//   `부칙<2012. 5. 31.>`(3,534줄) · `[부칙 <제16569호,2019.8.27>]`(249줄) · 들여쓴 `  부칙`(18줄).
// ⚠ 예전에는 `\n부\s*칙` 하나뿐이라 **대괄호를 두른 표기(`[부칙 …]`)를 못 끊었다** — 그 결과 파일
//   마지막 조(어선안전조업법 제58조 등 41개 파일)에 부칙 전문이 통째로 딸려 들어가, 팝업 마지막
//   항 뒤에 개정이력이 조문인 척 붙어 나왔다(사용자 스크린샷으로 확인한 실제 사고).
// ⚠ 원문에 `부\n칙<2012. 5. 31.>`처럼 **줄바꿈이 낀 "부칙"**도 실측 88개 파일에 있어 부·칙 사이
//   공백/줄바꿈을 허용한다(안 끊으면 인천항·경인항선박통항규칙 제32조에서 11,350자가 딸려 들어감).
const ADDENDA_HEAD_SRC = '[ \\t]*\\[?\\s*부\\s*칙';
// 조문 구간이 끝나는 자리 — 부칙과 별표 중 먼저 나오는 곳.
// ⚠ 이 패턴은 extractArticleBlock(고시)·articleRegion·extractAttachments 가 **함께** 쓴다.
//   따로 좁은 정규식을 두면 "조 본문은 안 끊겼는데 별표는 끊긴" 어긋남이 생긴다(중복 로직 금지).
const DOC_TAIL_SRC = `${ANNEX_BLOCK_SRC}|\\n${ADDENDA_HEAD_SRC}`;
const DOC_TAIL_RE = new RegExp(DOC_TAIL_SRC);
// 조 본문이 끝난 자리가 **부칙 머리줄인지** 보는 패턴(addendaAfter 전용).
const ADDENDA_AT_RE = new RegExp(`^\\n${ADDENDA_HEAD_SRC}`);

/**
 * 조 본문이 끝난 바로 그 자리가 부칙이면 그 부칙 덩어리를 돌려준다(아니면 빈 문자열).
 * 조 본문에서 부칙을 끊어내기만 하면 **원문 글자가 화면에서 사라진다** — 버리지 않고 자리만 옮겨
 * 응답의 `addenda`로 실어 보내고, 화면이 "부칙 보기"로 따로 펼치게 한다.
 * 부칙 뒤에 별표 블록이 이어지는 파일이 있어 별표 머리에서 끊는다(별표는 refs 갈래가 따로 다룬다).
 * 예: addendaAfter('…부과한다.\n\n[부칙 <제16569호,2019.8.27>]\n제1조(시행일) …', 8)
 *     → '[부칙 <제16569호,2019.8.27>]\n제1조(시행일) …'
 * @param {string} src - 파일 전체 원문
 * @param {number} at - 조 본문이 끝난 위치(extractArticleBlock 의 매치 끝)
 * @returns {string} 부칙 원문(앞뒤 공백 제거), 그 자리가 부칙이 아니면 ''
 * [연계] ← extractArticleBlock(). → loadArticle 응답의 `addenda`(클라이언트 "부칙 보기").
 */
function addendaAfter(src, at) {
  const rest = String(src || '').slice(at);
  if (!ADDENDA_AT_RE.test(rest)) return '';
  const i = rest.search(ANNEX_BLOCK_RE);
  return (i >= 0 ? rest.slice(0, i) : rest).trim();
}

/** 참조 정규식 매치 하나를 비교용 열쇠로 바꾼다(`별표1`·`서식1`·`이미지123`). */
function refKeyOf(m) {
  if (m[1] != null) return '서식' + m[1];
  if (m[2] != null) return '별표' + m[2];
  return '이미지' + m[3];
}

/** 열쇠(`별표1`·`서식2의3`·`이미지9`)를 종류와 번호로 되돌린다. */
function splitRefKey(key) {
  const m = /^(별표|서식|이미지)(.+)$/.exec(String(key || ''));
  return m ? { type: m[1], num: m[2] } : null;
}

/**
 * 별표·서식 원문 파일 첫 줄에서 **번호 꼬리표**(`별표4 — `)까지 걷어내 사람이 읽는 이름만 남긴다.
 * ★왜(2026-08-17 실측): 계층 접두 파일의 첫 줄은 `[시행령] 별표4 — 낚시어선이 갖추어야 하는 설비(…)`
 *   형식이라(2,000개 표본 중 1,982개), 대괄호만 벗기면 제목이 `별표4 — 설비…`로 남는다. 화면
 *   (ai_chat.js openBylPop)은 `ref.text`(`별표4`) + ' · ' + `ref.title` 을 이어붙이므로
 *   `별표4 · 별표4 — 설비…`처럼 번호가 두 번 찍혔다.
 * ⚠ 정규식은 routes/legal.js `formTitleOf()` 와 **같은 패턴**이어야 한다 — 서식 다운로드 목록이
 *   같은 꼬리표를 떼고 있어, 둘이 어긋나면 같은 제목이 화면마다 달라진다.
 *   (formTitleOf 는 이 함수가 이미 뗀 제목을 다시 받아도 그대로 통과한다 — 뗄 게 없으면 무변화)
 * 예: stripBylTitlePrefix('[시행령] 별표4 — 낚시어선이 갖추어야 하는 설비(제16조제1항제3호 관련)')
 *     → '낚시어선이 갖추어야 하는 설비(제16조제1항제3호 관련)'
 * @param {string} line - 원문 파일의 첫 줄
 * @returns {string} 대괄호 태그와 번호 꼬리표를 뗀 제목
 * [연계] ← resolveRefs ③. ↔ routes/legal.js formTitleOf(같은 정규식).
 */
function stripBylTitlePrefix(line) {
  return String(line || '')
    .replace(/^\[[^\]]*\]\s*/, '')
    .replace(/^(?:서식|별표)\s*\d+(?:의\d+)?\s*[—–-]\s*/, '')
    .trim();
}

/**
 * 본문에서 별표·서식·이미지 참조 표현을 등장 순서대로(중복 제거) 뽑는다.
 * 예: collectRefs('… 검사수수료는 별표 1과 같다. … 별지 제1호서식에 따라 …')
 *     → [{key:'별표1', text:'별표 1'}, {key:'서식1', text:'별지 제1호서식'}]
 * @param {string} text - 조 본문(여러 조면 이어붙인 것)
 * @returns {Array<{key:string, text:string}>} 최대 MAX_REFS 개
 * [연계] → resolveRefs()가 이 열쇠들이 우리에게 실제로 있는지 판정한다.
 */
function collectRefs(text) {
  const out = [];
  const seen = new Set();
  let byl = 0, img = 0;
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(String(text || '')))) {
    const key = refKeyOf(m);
    if (seen.has(key)) continue;
    seen.add(key);
    // 별표·서식과 이미지는 상한이 따로다(MAX_IMG_REFS 주석 참고). 별표 상한에 걸려도 스캔을
    // 멈추지 않는다 — 뒤쪽에 남은 이미지는 아직 받을 자리가 있다.
    if (key.indexOf('이미지') === 0) {
      if (img >= MAX_IMG_REFS) continue;
      img += 1;
    } else {
      if (byl >= MAX_REFS) continue;
      byl += 1;
    }
    out.push({ key, text: m[0] });
    if (byl >= MAX_REFS && img >= MAX_IMG_REFS) break;
  }
  return out;
}

/**
 * 참조 목록에서 **별표·서식만** 센다(이미지는 상한이 따로라 같이 세면 안 된다).
 * 예: bylCount([{key:'별표1'},{key:'이미지9'}]) → 1
 * @param {Array<{key:string}>} found
 * @returns {number}
 * [연계] ← loadArticle()의 refsTruncated 판정·withAtts(). MAX_REFS 와 짝이다.
 */
function bylCount(found) {
  return (found || []).filter(f => String((f && f.key) || '').indexOf('이미지') !== 0).length;
}

/**
 * 고시 파일 뒤에 이어붙은 별표 블록(`〔별표 1〕` + 표)을 번호별로 잘라낸다.
 * 실측상 고시 파일은 두 갈래다 — `[별표] 제목` 묶음머리를 두고 그 아래 번호 블록이 오는 것(81개
 * 파일)과, 묶음머리 없이 `[별표 1]`부터 바로 시작하는 것(97개 파일). 둘 다 **번호 붙은 줄머리**를
 * 블록 시작으로 보면 한 가지 규칙으로 처리된다.
 * ⚠ **번호를 못 읽은 블록은 버린다** — 번호 없는 `[별표]` 블록이 실제 raw 에 381개 있어
 *   "하나뿐이니 별표 1이겠지"라고 넘겨짚으면 엉뚱한 표를 보여주게 된다(환각 0 원칙).
 * 예: extractAttachments(검사수수료txt) → [{key:'별표1', title:'항로표지 장비·용품 검사수수료…', body:'…'}]
 * @param {string} text - 고시 파일 전체 원문
 * @returns {Array<{key:string, title:string, body:string}>}
 * [연계] ← loadArticle()(tier==='notice'). → resolveRefs()의 첫 번째 판정 근거.
 */
function extractAttachments(text) {
  const src = String(text || '');
  const i = src.search(DOC_TAIL_RE);
  if (i < 0) return [];
  const tail = src.slice(i);
  const heads = [];
  let m;
  ATT_HEAD_RE.lastIndex = 0;
  while ((m = ATT_HEAD_RE.exec(tail))) {
    heads.push({
      start: m.index,
      bodyAt: ATT_HEAD_RE.lastIndex,
      key: (m[1] === '별표' ? '별표' : '서식') + m[2],
      sameLine: (m[3] || '').trim(),
    });
  }
  const out = [];
  for (let j = 0; j < heads.length; j++) {
    const h = heads[j];
    if (out.some(a => a.key === h.key)) continue;   // 같은 번호가 또 나오면 처음 것만 쓴다
    const body = tail.slice(h.bodyAt, j + 1 < heads.length ? heads[j + 1].start : tail.length).trim();
    // 제목은 머리 줄 뒤에 붙어 있기도 하고(`[별표 1] 시설물별 …`), 그 다음 줄에 따로 오기도 한다.
    // 표가 곧바로 시작하는 별표도 있어 괘선(┏━│…)뿐인 줄은 제목으로 쓰지 않는다.
    const title = h.sameLine ||
      (body.split('\n').find(l => /[0-9A-Za-z가-힣]/.test(l) && !/^[\s─━│┃┏┓┗┛┠┨┯┷┿╋┼├┤┌┐└┘─]+$/.test(l)) || '').trim();
    // 내용이 통째로 머리 줄에 적힌 별표가 있다(`[별표 1] 갯벌복원 사업추진 절차(…) — 원문은 …`).
    // 그런 블록은 body 가 비는데, 빈 채로 kind='text' 를 주면 눌러도 빈 팝업이 뜬다 —
    // 우리가 실제로 가진 그 줄을 본문으로 준다(없으면 아래 resolveRefs 가 미수집으로 넘긴다).
    out.push({ key: h.key, title, body: body || h.sameLine });
  }
  return out;
}

// 별표 파일 안의 선언줄(`■ 항만법 시행령 [별표 6]`·`■ 항만운송사업법 시행규칙 [별지 제16호의2서식]`).
// 계층(시행령/시행규칙)과 **번호**를 함께 읽는다 — 실측 표기가 `[별표 5의2]`·`[별지 제2호의2 서식]`·
// `[별지 23호서식]`·`[별지제41호서식]`·`[별표1]`처럼 갈려 있어 공백·`제`·`호`를 전부 선택적으로 둔다.
const BYL_DECL_RE = /■[^\n[〔【]*?(시행규칙|시행령)\s*[[〔【]\s*(?:(별표)\s*제?\s*(\d+(?:의\d+)?)|(?:별지|서식)\s*제?\s*(\d+)\s*호(?:\s*의\s*(\d+))?)/;

/**
 * 계층 접두가 없는 별표 파일(`별표/별표1.txt`)이 **정말 그 계층의 그 번호**인지 선언줄로 확인한다.
 * ⚠ 계층만 보고 번호를 안 보면 사고가 난다 — 수집 시 순번으로 이름 붙은 탓에 파일명 번호와 실제
 *   내용 번호가 어긋난 파일이 실측 41개 있고(예: `별표1.txt` 안이 `[별표 1의2]`), 그 중 20건은
 *   본문이 실제로 그 번호를 인용해 **다른 별표를 그 번호인 것처럼** 보여주게 된다(환각 0 위반).
 * 예: bylDeclMatches('■ 항만법 시행령 [별표 6]…', '시행령', {type:'별표', num:'6'}) → true
 *     bylDeclMatches('■ … 시행령 [별표 1의2]…',  '시행령', {type:'별표', num:'1'}) → false
 * @param {string} text - 별표 파일 전체
 * @param {string} prefix - 지금 tier 의 계층 이름(시행령·시행규칙)
 * @param {{type:string, num:string}} k - 요청한 참조(splitRefKey 결과)
 * @returns {boolean}
 * [연계] ← resolveRefs() ③.
 */
function bylDeclMatches(text, prefix, k) {
  const m = BYL_DECL_RE.exec(String(text || ''));
  if (!m || m[1] !== prefix) return false;
  const type = m[2] ? '별표' : '서식';
  const num = m[2] ? m[3] : (m[4] + (m[5] ? '의' + m[5] : ''));
  return type === k.type && num === k.num;
}

/** 별표 파일은 첫 줄이 제목, 그 아래가 본문(표)이다. */
function bylBody(text) {
  return String(text || '').split('\n').slice(1).join('\n').trim();
}

/**
 * 그 별표 파일이 **원문을 실제로 담고 있는지**. `■ 도선법 시행규칙 [별표 7] 삭제` 선언 한 줄뿐인
 * 폐지·이동 별표 파일이 실측 178개 있는데, 이걸 kind='text' 로 확정하면 눌러도 빈 팝업이 뜨고
 * 다음 단계(④ `_links.json` 다운로드 링크)까지 건너뛴다 — 원문이 있는 척하지 않는다.
 * @param {string} text - 별표 파일 전체
 * @returns {boolean}
 * [연계] ← resolveRefs() ③.
 */
function hasBylBody(text) {
  return !!bylBody(text).replace(/^■[^\n]*/, '').trim();
}

/** 별표 링크가 `/LSW/flDownload.do?flSeq=…` 상대경로로 적힌 파일이 있어 절대 URL로 만든다. http(s)만 통과. */
function absUrl(u) {
  const s = String(u || '').trim();
  const full = /^https?:\/\//i.test(s) ? s : (s.startsWith('/') ? LAWGO_ORIGIN + s : '');
  return /^https?:\/\//i.test(full) ? full : '';
}

/**
 * 고시급 별표를 따로 모아둔 `별표/<자유서술>.txt`를 판다. 실측으로 두 형식이 있다.
 *  ①여러 서식의 링크 목록(`해상운송비_별지서식3종.txt`):
 *      `별지 제1호서식: 해상운송사업계획서` / `- 서식파일(HWPX): /LSW/…` / `- PDF: /LSW/…`
 *  ②별표 하나에 본문(표)이 들어있는 파일(`정주생활지원금_별지1호_지급신청서.txt`,
 *    `행정규칙_선박구명설비기준_별표14.txt`, `연안정비…_별표1.txt`):
 *      첫 줄 `[…별표14(…)]`/`[별표 1] 제목` 에 번호가 있고, `출처:`·`고시명:`·`별표서식파일링크:` 메타 뒤가 표다.
 * @param {string} text - 별표 파일 전체
 * @returns {{owner:string, entries:Array<{key:string,title:string,body:string,hwp:string,pdf:string}>}}
 *          owner 는 이 파일이 어느 고시 것인지 판별할 머리말(제목·출처 줄)
 * [연계] ← resolveRefs()(tier==='notice' 이고 고시 파일 안에서 못 찾았을 때).
 */
function parseBylFile(text) {
  const lines = String(text || '').split('\n');
  const owner = lines.slice(0, 4).join(' ');
  const entries = [];

  // 형식 ① — 한 줄에 "별지 제N호서식: 제목", 그 아래 들여쓴 링크 줄들
  const listRe = /^(별표|별지)\s*제?\s*(\d+(?:의\d+)?)\s*호?\s*(?:서식)?\s*:\s*(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const lm = listRe.exec(lines[i].trim());
    if (!lm) continue;
    const e = { key: (lm[1] === '별표' ? '별표' : '서식') + lm[2], title: lm[3].trim(), body: '', hwp: '', pdf: '' };
    for (let j = i + 1; j < lines.length && lines[j].trim(); j++) {
      const hw = /^-\s*서식파일[^:]*:\s*(\S+)/.exec(lines[j].trim());
      const pd = /^-\s*PDF\s*:\s*(\S+)/i.exec(lines[j].trim());
      if (hw) e.hwp = absUrl(hw[1]);
      else if (pd) e.pdf = absUrl(pd[1]);
    }
    entries.push(e);
  }
  if (entries.length) return { owner, entries };

  // 형식 ② — 첫 줄에서 번호를 읽는다. `별표1·2·3`처럼 한 파일이 여러 번호를 담기도 한다.
  const head = lines[0] || '';
  const numRe = /(별표|별지|서식)\s*제?\s*(\d+(?:의\d+)?)((?:\s*[·ㆍ,]\s*\d+)*)/g;
  const keys = [];
  let hm;
  while ((hm = numRe.exec(head))) {
    const kind = hm[1] === '별표' ? '별표' : '서식';
    keys.push(kind + hm[2]);
    for (const extra of (hm[3] || '').split(/[·ㆍ,]/)) {
      if (/^\s*\d+\s*$/.test(extra)) keys.push(kind + extra.trim());
    }
  }
  if (!keys.length) return { owner, entries };
  const hwp = absUrl((/별표서식파일링크\s*:\s*(\S+)/.exec(text) || [])[1]);
  const pdf = absUrl((/별표서식PDF파일링크\s*:\s*(\S+)/.exec(text) || [])[1]);
  // 메타 줄(출처·고시명·소관·비고·링크)을 걷어낸 나머지가 실제 표다.
  const body = lines.slice(1)
    .filter(l => !/^\s*(출처|고시명|소관|비고|전화|별표서식(PDF)?파일링크)\s*:/.test(l))
    .join('\n').trim();
  const title = head.replace(/^\[[^\]]*\]\s*/, '').trim() || head.trim();
  for (const key of keys) entries.push({ key, title, body, hwp, pdf });
  return { owner, entries };
}

/**
 * 고시(행정규칙)는 파일명이 제목과 딱 맞지 않는다(`국가지정유산_역사문화환경보존지역내_
 * 건축행위등에관한허용기준작성지침.txt` 처럼 언더스코어로 이어붙는다) — 공백·기호를 전부
 * 지운 뒤 서로 부분포함이면 같은 것으로 보고, 가장 길게 겹치는 파일을 고른다.
 * @param {Array<{name:string,type:string}>} entries - listDir('…/행정규칙') 결과
 * @param {string} title - 체인 행의 고시 제목
 * @returns {string|null} 파일명(못 찾으면 null)
 * [연계] ← loadArticle()(tier==='notice').
 */
function pickNoticeFile(entries, title) {
  const want = squash(title);
  if (!want) return null;
  let best = null;
  for (const e of entries || []) {
    if (e.type !== 'file' || !/\.txt$/i.test(e.name)) continue;
    const got = squash(e.name);
    if (!got) continue;
    if (want.includes(got) || got.includes(want)) {
      if (!best || got.length > squash(best).length) best = e.name;
    }
  }
  return best;
}

/**
 * 법령 셀에서 낫표(「」『』)와 계층 꼬리말(`ㆍ시행령·시행규칙`)을 걷어내 **법령명 부분**만 남긴다.
 * 위키는 같은 법을 `「행정절차법」`·`수상구조법ㆍ시행령`·`해양생태계법 시행령·시행규칙`처럼 여러
 * 모양으로 적는다 — 이 꼬리만 떼면 정식명과 **완전일치**로 대조할 수 있다(느슨한 포함관계 매칭은
 * 절대 쓰지 않는다. `마리나항만법`이 `항만법`에 붙는 오매칭이 실측으로 확인됐다).
 * 예: lawNameOnly('「낚시 관리 및 육성법」') → '낚시 관리 및 육성법'
 *     lawNameOnly('수상구조법ㆍ시행령')      → '수상구조법'
 * @param {string} cell - 체인 행의 법령 칸 값
 * @returns {string}
 * [연계] ← resolveBase(). → legal_retriever.rawPathOf(공백 무시 완전일치).
 */
function lawNameOnly(cell) {
  return String(cell || '')
    .replace(/[「」『』]/g, '')
    .replace(/(?:\s*[·ㆍ・,/]?\s*(?:시행령|시행규칙))+\s*$/, '')
    .replace(/[\s·ㆍ・,/]+$/, '')
    .trim();
}

// 법령 셀이 **법령명 없이 계층 단어·대명사만** 적힌 표기인가 — 그 행이 실린 위키 페이지의 소속
// 법(baseLaw)을 가리킨다. 실측: `시행령`·`시행규칙`·`법`·`법률`(852행) · `이 법`·`동법`(+계층, 439행)
// · `법·시행령`·`시행령ㆍ시행규칙`(D형 일부). 계층(tier)은 이미 classifyTier가 이 셀에서 읽는다.
// ⚠ `같은 법`은 제외한다 — 법령 표기 관행상 "바로 앞에서 말한 그 법"이고, 실제로 앞 행이 타법인
//   사례가 있다(도선법 페이지의 `같은 법 시행령` = 「비상사태등에…법률」 시행령. baseLaw로 읽으면
//   도선법 시행령 제15조라는 **전혀 다른 조문**이 열린다). 앞 행을 볼 수 없는 이 함수에서는 단정할
//   수 없으므로 손대지 않고 정직하게 law_not_found로 실패시킨다.
//   `이 법`·`동법`은 위키 실측에서 전부 그 페이지의 소속 법을 뜻했다(앞 행이 타법인 위험 11건을
//   원문 대조로 전수 확인 — `같은 법` 1건만 예외였다).
const SELF_REF_TOKEN_RE = /(법률|법령|법|시행령|시행규칙|[·ㆍ・,/]|→)/g;

/**
 * 법령 셀이 계층 단어·대명사만 적힌 "이 페이지의 법" 표기인가.
 * 꼬리에 별표 번호를 적어 둔 셀(`시행규칙 별표2·3` — 조문 칸은 `별표`뿐, 실측 3행)도 계층 표기로
 * 읽는다. 별표 번호는 법령명이 아니라 인용 대상이라 떼어내야 이 페이지의 법을 찾을 수 있다.
 */
function isSelfRef(cell) {
  const s = String(cell || '').replace(/[「」『』]/g, '')
    .replace(/\s*(?:별표|별지|서식)[^가-힣]*$/, '').replace(/\s+/g, '');
  if (!s || /^같은/.test(s)) return false;
  return s.replace(/^(이|동|본)/, '').replace(SELF_REF_TOKEN_RE, '') === '' && /(법|시행령|시행규칙)/.test(s);
}

/**
 * 법령 셀이 **부칙**을 가리키는가. 예: `한국해양교통안전공단법 부칙` · `○○법 시행령 부칙`.
 * @param {string} law
 * @returns {boolean}
 * [연계] → addendaLawName() · loadArticle()(부칙 구간만 보게 한다).
 */
function isAddendaCell(law) { return /부\s*칙/.test(String(law || '')); }

/**
 * 부칙 셀에서 **법령명만** 남긴다(못 남기면 빈 문자열).
 * 예: addendaLawName('선박교통관제에 관한 법률 부칙(2019.12.3)') → '선박교통관제에 관한 법률'
 *     addendaLawName('한국해양교통안전공단법 시행령 부칙')       → '한국해양교통안전공단법 시행령'
 * ⚠`법률 제19807호 부칙`처럼 **법령명 자체가 없는 셀**은 빈 문자열을 돌려준다 — 무엇의 부칙인지
 *   단정할 수 없으므로 지어내지 않고 그대로 실패시킨다.
 * @param {string} law
 * @returns {string}
 */
function addendaLawName(law) {
  let s = String(law || '').replace(/[「」『』]/g, '');
  s = s.replace(/<[^>]*>/g, ' ');                       // <제11080호,2011.11.14>
  s = s.replace(/부\s*칙\s*\([^)]*\)/g, ' ');           // 부칙(2019.12.3)
  s = s.replace(/부\s*칙/g, ' ');                        // 남은 "부칙"
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || /^(법률|대통령령|총리령|부령)\s*제?\s*\d/.test(s)) return '';   // "법률 제19807호"뿐이면 포기
  return s;
}

/**
 * 그 법의 raw 폴더 경로를 찾는다. 체인 행의 법령명(낫표·계층 꼬리말 떼고 재시도 포함)이 우선이고,
 * 그 셀이 법령명 없이 계층·대명사만 적힌 표기(`시행령`·`이 법`)면 그 페이지의 소속 법으로 읽는다.
 * **그 밖의 baseLaw 폴백은 고시(tier==='notice')에만 쓴다** — 고시는 제목만으로 폴더를 못
 * 찾아 위키 페이지의 소속 법으로 되돌아가는 게 맞지만, law/decree/rule에 이 폴백을 쓰면 타법
 * 인용 행(법령명 표기가 law_raw_paths.json과 안 맞는 경우)이 조용히 baseLaw의 **같은 번호
 * 조**(제2조 등 흔한 번호라 우연히 존재하는 경우가 많음)를 열어, 카드 이름과 다른 엉뚱한 법의
 * 원문을 보여주는 사고가 난다(실측 146건 확인 — "환각 0" 원칙 위반). 그 경우엔 폴백하지 않고
 * 정직하게 law_not_found로 실패한다.
 * @param {string} law - 체인 행의 법령명(고시면 고시 제목)
 * @param {string} baseLaw - 그 위키 페이지의 소속 법명(클라이언트가 함께 보냄)
 * @param {string} tier - law|decree|rule|notice
 * @returns {string|null}
 * [연계] → legal_retriever.rawPathOf(law_raw_paths.json 매핑).
 */
function resolveBase(law, baseLaw, tier) {
  const direct = rawPathOf(law) || rawPathOf(lawNameOnly(law));
  if (direct) return direct;
  // ★부칙 표기(2026-08-28) — `한국해양교통안전공단법 부칙`·`선박교통관제에 관한 법률 부칙(2019.12.3)`
  //   처럼 이름 끝에 "부칙"이 붙은 셀은 **그 법의 폴더**를 가리킨다. 부칙은 별도 폴더가 아니라
  //   그 법 파일(법률.txt 등) 뒤에 붙어 있기 때문이다. 실측 23행이 이 이유로 죽어 있었다.
  //   꾸밈(`(2019.12.3)`·`<제11080호,2011.11.14>`·`법률 제19807호`)을 떼고 다시 찾는다.
  const stripped = addendaLawName(law);
  if (stripped) {
    const byAddenda = rawPathOf(stripped) || rawPathOf(lawNameOnly(stripped));
    if (byAddenda) return byAddenda;
  }
  if (isSelfRef(law)) return rawPathOf(baseLaw) || rawPathOf(lawNameOnly(baseLaw)) || null;
  // ★이름 끝의 공포번호 괄호를 떼고 한 번 더 찾는다(2026-08-29) —
  //   `옹진군 지방보조금 관리 조례(옹진군 조례 제2624호)` 처럼 조례·규칙은 이름 뒤에
  //   공포번호를 달고 인용되는 관행이 있는데, 경로표의 열쇠에는 그 괄호가 없다.
  //   실측 23행이 이 이유만으로 죽어 있었다(옹진군 조례 3종).
  //   ⚠**맨 마지막에** 둔다 — 괄호까지 포함해 정확히 일치하는 이름이 있으면 그쪽이 이긴다.
  //   그리고 괄호 안이 다른 법을 가리키는 경우는 없다(괄호 안은 공포번호·시행일 표기다).
  const noParen = String(law || '').replace(/\s*[（(][^)）]*[)）]\s*$/, '').trim();
  if (noParen && noParen !== String(law || '').trim()) {
    const byParen = rawPathOf(noParen) || rawPathOf(lawNameOnly(noParen));
    if (byParen) return byParen;
  }
  return tier === 'notice' ? (rawPathOf(baseLaw) || null) : null;
}

/**
 * 조문 본문 구간만 남긴다 — 뒤에 붙은 부칙·별표는 잘라낸다. 부칙에도 `제1조(시행일)`이 있어
 * 이걸 안 자르면 "문서 전체" 나열에 부칙 조문이 본문 조로 섞여 들어간다.
 * @param {string} text - 파일 전체 원문
 * @returns {string}
 * [연계] ← listArticleNumbers()(whole 모드).
 */
function articleRegion(text) {
  const src = String(text || '');
  const i = src.search(DOC_TAIL_RE);
  return i >= 0 ? src.slice(0, i) : src;
}

/**
 * 문서에 실제로 있는 조 번호를 등장 순서대로 뽑는다(문서 전체 인용용). 조 마커 형식이
 * 법률 계열(`[제10조]`)과 고시 계열(`제10조(제목)`)에서 아예 다르다(_LESSONS L-54).
 * 예: listArticleNumbers(서해5도지침txt, 'notice') → ['제1조','제2조',…,'제9조']
 * @param {string} text - 파일 전체 원문
 * @param {string} tier - law|decree|rule|notice
 * @returns {string[]} 중복 없이 등장 순서대로
 * [연계] ← loadArticle()(mode==='whole'). → buildArticles()
 */
function listArticleNumbers(text, tier) {
  const src = articleRegion(text);
  const re = tier === 'notice'
    ? /(?:^|\n)제(\d+)조(?:의(\d+))?\(/g
    : /(?:^|\n)\[제(\d+)조(?:의(\d+))?\]/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const jo = m[2] ? `제${m[1]}조의${m[2]}` : `제${m[1]}조`;
    if (!out.includes(jo)) out.push(jo);
  }
  return out;
}

/** 조 표기를 정렬용 숫자쌍으로 바꾼다(`제7조의2` → [7,2], `제7조` → [7,0]). */
function joOrder(jo) {
  const m = /^제(\d+)조(?:의(\d+))?$/.exec(String(jo || ''));
  return m ? [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0] : [0, 0];
}

/**
 * 범위 인용(`제7조~제15조`)의 조 목록에 **문서에 실제로 있는 가지번호 조**(`제7조의2`)를 끼워 넣는다.
 * 범위 표기엔 정수 번호만 적혀 있어 그대로 나열하면 사이의 가지번호 조가 통째로 빠지고, 팝업 라벨의
 * "N개조"가 실제 나열 개수와 어긋난다(실측 194건 중 7건).
 * ⚠ 나열 안에 낀 범위(`제10~14조, 제17·18조`의 `10~14`)도 **같은 방식으로** 편다 — parseJoEnum 이
 *   from..to 정수만 찍어 두고 여기서 안 보태면 그 사이의 가지번호 조가 조용히 사라진다(실측: 해운법
 *   제10~14조 구간의 제11조의2·제11조의3). 그래서 range 의 from/to 와 list 의 spans 를 함께 본다.
 * 물려받은 순서는 그대로 두고 가지번호 조를 **제 본조 바로 뒤에** 끼워 넣는다(나열은 "적힌 순서대로"가
 * 약속이고, 범위는 원래 오름차순이라 결과가 정렬과 같다).
 * 예: expandRange(시행규칙txt, 'rule', {from:36, to:46, joList:['제36조'…'제46조']})
 *     → ['제36조','제36조의2',…,'제46조','제46조의2']
 * @param {string} text - 파일 전체 원문
 * @param {string} tier - law|decree|rule|notice
 * @param {object} ref - parseArticleRef 결과(mode==='range' 이면 from/to, mode==='list' 면 spans)
 * @returns {string[]} 조 번호 목록(범위 밖 항목의 순서는 적힌 그대로)
 * [연계] ← loadArticle()(mode==='range'·'list'). → listArticleNumbers()·buildArticles()
 */
function expandRange(text, tier, ref) {
  const spans = ref.from ? [[ref.from, ref.to]] : (ref.spans || []);
  if (!spans.length) return ref.joList;
  // 범위 안에 실제로 있는 가지번호 조를 본조 번호별로 모은다(원문 등장 순서 유지).
  const branches = new Map();
  for (const jo of listArticleNumbers(text, tier)) {
    const [n, b] = joOrder(jo);
    if (!b || !spans.some(sp => n >= sp[0] && n <= sp[1])) continue;
    if (!branches.has(n)) branches.set(n, []);
    branches.get(n).push(jo);
  }
  const out = [];
  const push = jo => { if (!out.includes(jo)) out.push(jo); };
  for (const jo of ref.joList) {
    push(jo);
    for (const b of branches.get(joOrder(jo)[0]) || []) push(b);
  }
  return out;
}

/**
 * 조 번호 목록을 받아 각 조의 원문 블록을 순서대로 뽑아 항·호로 쪼갠다(범위·전체 인용용).
 * 원문에 없는 조는 조용히 건너뛴다(범위 표기가 실제 조문보다 넓게 잡힌 경우가 있다).
 * 예: buildArticles(지침txt, 'notice', ['제1조','제2조']) → [{jo:'제1조', title:'목적', eff:'', paragraphs:[…]}, …]
 * @param {string} text - 파일 전체 원문
 * @param {string} tier - law|decree|rule|notice
 * @param {string[]} joList - 뽑을 조 번호
 * @returns {Array<{jo:string, title:string, eff:string, paragraphs:Array, addenda:string}>}
 *          eff 는 법률 계열의 조별 시행일자(`[제10조] … (시행 20260624 …)`) — 팝업 머리 날짜에 쓴다
 *          addenda 는 그 조 뒤에 부칙이 붙어 있을 때만 채워진다(문서의 마지막 조 하나뿐)
 * [연계] ← loadArticle()(range·whole). → extractArticleBlock()·splitParagraphs()
 */
function buildArticles(text, tier, joList) {
  const out = [];
  for (const jo of joList) {
    const block = extractArticleBlock(text, jo, tier);
    if (!block) continue;
    const paragraphs = splitParagraphs(cleanBody(block.body));
    if (!paragraphs.length) continue;
    out.push({ jo, title: block.title, eff: block.effectiveDate, paragraphs, addenda: block.addenda || '' });
  }
  return out;
}

/**
 * 본문에서 찾은 별표·서식·이미지 참조가 우리에게 **실제로** 있는지 판정한다.
 * 판정 우선순위(먼저 맞는 것을 쓴다 — 앞쪽일수록 "우리가 원문을 갖고 있는" 상태다):
 *   ①이미지: `_이미지/<번호>.png`가 그 문서 폴더에 실제로 있으면 kind='image'(앱 안에서 바로 표시)
 *   ②고시: 그 고시 파일 뒤에 이어붙은 `[별표]` 블록 → kind='text'
 *   ③법률계열: `별표/<계층>_별표N.txt`·`_서식N.txt` → kind='text'
 *   ④법률계열: `별표/_links.json` 의 다운로드 링크 → kind='link'(PDF·HWP 있는 대로 다 준다)
 *   ⑤고시: `별표/<자유서술>.txt`(그 고시 것이 맞는지 머리말로 확인) → 본문 있으면 text, 링크만 있으면 link
 *   ⑥아무 데도 없으면 kind='missing' — **지어내지 않고** 회색 "(원문 미수집)"으로 넘긴다
 * @param {Array<{key:string,text:string}>} found - collectRefs() 결과
 * @param {{base:string, tier:string, docText:string, docTitle:string, docDir:string}} ctx
 * @returns {Promise<Array<object>>} [{key,text,kind,title,body,pdf,hwp,image}]
 * [연계] ← loadArticle(). → github_raw.fetchText/listDir · client/js/ai-chat/ai_chat.js 의 별표 팝업.
 */
async function resolveRefs(found, ctx) {
  const refs = found.map(f => ({ key: f.key, text: f.text, kind: 'missing' }));
  // 아직 못 찾은 별표·서식만 다음 단계로 넘긴다(이미지는 ①에서만 판정한다 — 별표 파일로 찾을 게 없다).
  const rest = () => refs.filter(r => r.kind === 'missing' && r.key.indexOf('이미지') !== 0);

  // ① 스캔 이미지 — 마커에 경로(`_이미지/<번호>.png`)가 적혀 있지만 실재 여부는 목록으로 확인한다.
  const imgRefs = refs.filter(r => splitRefKey(r.key) && splitRefKey(r.key).type === '이미지');
  if (imgRefs.length && ctx.docDir) {
    const names = new Set((await githubRaw.listDir(ctx.docDir + '/_이미지')).map(e => e.name));
    for (const r of imgRefs) {
      const num = splitRefKey(r.key).num;
      if (!names.has(num + '.png')) continue;
      r.kind = 'image';
      r.title = '원본 이미지 ' + num;
      // 브라우저가 직접 받아가는 우리 서버 경로(GET /api/legal/src). raw/ 아래로만 열린다.
      r.image = '/api/legal/src?p=' + encodeURIComponent(
        ctx.docDir.replace(RAW_PREFIX, '') + '/_이미지/' + num + '.png');
    }
  }

  // ② 고시 파일 안에 이어붙은 별표 블록
  if (ctx.tier === 'notice') {
    const atts = extractAttachments(ctx.docText);
    for (const r of rest()) {
      const a = atts.find(x => x.key === r.key);
      // 본문이 빈 블록은 "원문을 갖고 있다"고 확정하지 않는다 — 아래 ⑤(별표 폴더)로 넘긴다.
      if (a && a.body) { r.kind = 'text'; r.title = a.title; r.body = a.body; }
    }
  }

  const prefix = TIER_BYL_PREFIX[ctx.tier];
  // ③ 법률계열 — 번호별 별표 파일이 따로 저장돼 있다. 파일명이 두 갈래다(실측):
  //    `시행규칙_별표1.txt`처럼 계층이 붙은 것과, `별표1.txt`처럼 안 붙은 것(해운법·항만법 등).
  //    ⚠ 계층 없는 파일은 법마다 임자가 다르다(어장관리법=시행규칙, 항만법=시행령) — 그래서
  //      파일 안의 `■ 해운법 시행령 [별표 1]` 선언줄을 읽어 **계층도 번호도 같을 때만** 쓴다
  //      (bylDeclMatches). 선언이 없거나 어긋나면 넘겨짚지 않고 미수집으로 둔다.
  //      계층 접두 파일(`시행령_별표1.txt`)은 파일명에 계층·번호가 다 들어 있고 실측 2,676개 전부
  //      선언줄과 일치해(불일치 0) 추가 검증 없이 그대로 쓴다.
  //    ⚠ 내용이 `[별표 7] 삭제` 한 줄뿐인 폐지 별표는 원문이 있는 게 아니므로 여기서 확정하지 않고
  //      ④(_links.json)로 넘긴다.
  if (prefix && rest().length) {
    const want = rest();
    const texts = await Promise.all(want.map(async r => {
      const k = splitRefKey(r.key);
      if (!k) return null;
      const owned = await githubRaw.fetchText(`${ctx.base}/별표/${prefix}_${k.type}${k.num}.txt`);
      if (owned) return hasBylBody(owned) ? owned : null;
      const bare = await githubRaw.fetchText(`${ctx.base}/별표/${k.type}${k.num}.txt`);
      if (!bare || !bylDeclMatches(bare, prefix, k) || !hasBylBody(bare)) return null;
      return bare;
    }));
    want.forEach((r, i) => {
      const t = texts[i];
      if (!t) return;
      r.kind = 'text';
      r.title = stripBylTitlePrefix(t.split('\n')[0] || '');
      r.body = bylBody(t);
    });
  }

  // ④ 법률계열 — `_links.json` 의 law.go.kr 다운로드 링크.
  //    ⚠ **kind 와 무관하게** 채운다 — 우리가 표 원문을 갖고 있어도(kind='text') 원본 HWP/PDF 는
  //      따로 받아볼 수 있어야 한다("보기와 다운로드는 양자택일이 아니다"). 예전에는 아직 못 찾은
  //      참조(rest())만 여기까지 와서, 원문이 있는 별표는 다운로드 버튼이 아예 안 떴다.
  //      다만 앞 단계에서 확정된 kind·title·body 는 덮어쓰지 않는다(다운로드 필드만 보탠다).
  const bylRefs = refs.filter(r => r.key.indexOf('이미지') !== 0);
  if (prefix && bylRefs.length) {
    let links = null;
    try { links = JSON.parse(await githubRaw.fetchText(`${ctx.base}/별표/_links.json`) || 'null'); } catch (_) { links = null; }
    if (links && typeof links === 'object') {
      for (const r of bylRefs) {
        const k = splitRefKey(r.key);
        const v = k && links[`${prefix} ${k.type} ${k.num}`];
        if (!v || typeof v !== 'object') continue;
        // `PDF` 키는 수집 스크립트가 아직 안 채우고 있다(_LESSONS L-55) — 채워지면 그대로 뜬다.
        r.hwp = absUrl(v.HWP);
        r.pdf = absUrl(v.PDF);
        // ★2026-08-18: `이미지` 배열(law.go.kr 스캔본 주소)도 함께 싣는다 — 지금까지 수집만 해두고
        //   한 번도 안 읽었다. 실측: 별표·별지 2,719건 중 2,679건(98.5%)에 이미지가 있고, 서식(별지)만
        //   보면 1,988건 중 1,980건(99.6%)이다. **PDF만 있고 이미지가 없는 건은 0건**이라
        //   "PDF뿐이면 어렵다"고 걱정한 경우는 실제로 없다. 주소를 그대로 열면 image/gif 가
        //   내려온다(실측 확인) — 화면이 <img> 로 바로 띄운다.
        //   ⚠ kind 는 건드리지 않는다(④의 기존 규약) — 표 원문이 있으면 text 그대로 두고,
        //     이미지를 **볼 수 있다는 사실만** 보탠다. 무엇을 먼저 보여줄지는 화면이 정한다.
        const imgs = Array.isArray(v.이미지) ? v.이미지.map(absUrl).filter(Boolean) : [];
        if (imgs.length) r.images = imgs;
        if (r.kind !== 'missing') continue;   // 원문(text)·스캔본(image) 판정은 그대로 둔다
        r.kind = 'link';
        r.title = String(v.제목 || '');
      }
    }
  }

  // ⑤ 고시 — 별표를 `별표/` 폴더에 따로 모아둔 경우(형식이 자유서술이라 머리말로 임자를 확인한다).
  // 고시는 TIER_BYL_PREFIX에 없어 ③·④를 못 타 hwp/pdf가 여기서만 채워질 수 있으므로, 미해결
  // 참조(missing)가 없으면(=②에서 이미 전부 text로 풀렸으면) 돌 필요가 없다 — 안 그러면 이미
  // 해결된 팝업에서도 매번 GitHub 조회가 돌아 불필요하게 느려진다(실측: 최악 케이스 2회→11회).
  if (ctx.tier === 'notice' && bylRefs.some(r => r.kind === 'missing')) {
    // 위키 표의 고시 이름엔 `…지침(고시)`·`「…」(국립수산물품질관리원, 2026-02-11 발령)`처럼
    // 꼬리표가 붙어 있어 그대로 비교하면 별표 파일의 머리말과 안 맞는다 — 괄호 주석을 걷어낸다.
    const want0 = squash(String(ctx.docTitle || '').replace(/[（(][^)）]*[)）]/g, '')) || squash(ctx.docTitle);
    // ★위키 법령 칸이 `고시「부산항 도선구 도선안전절차」` 처럼 **종류 이름표를 앞에 달고** 적힌
    //   경우가 있다(실측 80행). 그러면 별표 파일 머리말("[부산항 도선구 도선안전절차 별표1] …")에
    //   그 이름표가 없어 임자 확인이 실패한다 — 파일이 손에 있는데도 못 연다(2026-08-31 실측).
    //   이름표를 뗀 꼴도 함께 본다. 이름표가 없으면 종전과 똑같다.
    const wants = [want0, want0.replace(/^(고시|훈령|예규|행정규칙)/, '')].filter((v, i, a) => v && a.indexOf(v) === i);
    const want = want0;
    const all = (await githubRaw.listDir(ctx.base + '/별표'))
      .filter(e => e.type === 'file' && /\.txt$/i.test(e.name) && !/^(법률|시행령|시행규칙)_/.test(e.name));
    // ★이름이 이 고시 것으로 보이는 파일을 앞으로 당긴다(2026-08-31).
    //   종전에는 그냥 `.slice(0, 8)` 이었다. 고시 별표를 `별표/` 에 채워 넣자
    //   한 폴더에 고시급 파일이 70~140개인 법이 여럿 생겼고(산업안전보건법 140·항만법 88 …),
    //   그러면 정작 찾는 고시의 파일이 앞 8개 밖으로 밀려 **파일이 있는데도 못 연다.**
    //   파일명이 `<고시명>_별표N.txt` 규칙이므로 이름으로 먼저 고를 수 있다.
    //   이름으로 하나도 못 고르면 종전과 똑같이 앞 8개를 본다(동작을 좁히지 않는다).
    const mine = want ? all.filter(e => squash(e.name).startsWith(want)) : [];
    // ★한 고시가 별표를 수십 개 가진 경우가 있다(지정교육기관기준 83개) — 이름으로 좁혀도
    //   앞 8개는 `별표1·별표10·별표10의2·별표11…` 로 채워져 정작 찾는 `별표2` 가 잘린다
    //   (2026-08-31 실측, V5-11 게이트가 잡아냈다). **찾는 번호가 파일명에 든 것을 맨 앞으로** 보낸다.
    const need = bylRefs.filter(r => r.kind === 'missing').map(r => String(r.key || '')).filter(Boolean);
    const hasKey = e => need.some(k => new RegExp('(^|[^0-9A-Za-z가-힣])' + k + '([^0-9]|$)').test(e.name));
    const pool = mine.length ? mine : all;
    const cand = pool.slice().sort((a, b) => (hasKey(b) ? 1 : 0) - (hasKey(a) ? 1 : 0)).slice(0, 8);
    for (const e of cand) {
      if (!bylRefs.some(r => r.kind === 'missing')) break;
      const t = await githubRaw.fetchText(ctx.base + '/별표/' + e.name);
      if (!t) continue;
      const parsed = parseBylFile(t);
      // 그 고시 것이 맞는지 — 머리말(제목·출처 줄)에 고시 이름이 들어 있어야 인정한다.
      if (want && !wants.some(w => squash(parsed.owner).includes(w))) continue;
      for (const r of bylRefs) {
        const en = parsed.entries.find(x => x.key === r.key);
        if (!en) continue;
        if (!r.title) r.title = en.title;
        if (en.hwp && !r.hwp) r.hwp = en.hwp;
        if (en.pdf && !r.pdf) r.pdf = en.pdf;
        if (r.kind !== 'missing') continue;   // 앞 단계(② 고시 본문 블록)의 판정을 덮어쓰지 않는다
        if (en.body && en.body.length > 40) { r.kind = 'text'; r.body = en.body; }
        else if (en.hwp || en.pdf) { r.kind = 'link'; }
      }
    }
  }
  return refs;
}

/** 파일 머리에서 시행일자(고시는 발령일자)를 읽는다. 없으면 빈 문자열. */
function docDate(text) {
  const m = /시행일자\s*:?\s*(\d{8})/.exec(text) || /발령일자\s*:?\s*(\d{8})/.exec(text) ||
    /\((\d{8})\)/.exec(String(text).slice(0, 400));
  return m ? fmtDate(m[1]) : '';
}

/**
 * 조문 카드 하나에 대응하는 원문을 GitHub에서 읽어 항·호로 쪼개 돌려준다.
 * 인용 표기에 따라 네 가지로 갈린다(parseArticleRef 참고).
 *  - annex: 조 없이 별표만 가리킨 인용 → 조 본문 없이 `refs`만(못 찾은 것은 `missing`)
 *  - single: 그 조 하나 → `paragraphs`(인용된 항·호에 hit:true). 인용이 항(또는 항+호)을 특정했고
 *    그 항·호를 원문에서 실제로 찾았을 때만 `focused:true` — 화면은 그때만 나머지를 접는다.
 *  - range · whole: 여러 조 → `articles`(강조 없음). 조가 MAX_ARTICLES 를 넘으면
 *    억지로 싣지 않고 `tooLong`만 돌려준다(클라이언트가 "원문이 깁니다"로 안내).
 * 어느 경우든 본문에 나온 별표·서식 참조는 `refs`로 실재 여부까지 판정해 함께 준다.
 * 조 뒤에 붙어 있던 부칙은 본문에서 떼어내 `addenda`로 따로 싣는다(버리지 않고 자리만 옮긴다).
 * 예: loadArticle({law:'자연유산의 보존 및 활용에 관한 법률', article:'제10조④3호', tier:'law'})
 *     → {ok:true, mode:'single', articleTitle:'제10조(역사문화환경 보존지역의 보호)', paragraphs:[…④에 hit:true…]}
 *     loadArticle({law:'서해 5도 해상운송비 지원 지침', article:'제1~9조', tier:'notice', baseLaw:'서해5도지원특별법'})
 *     → {ok:true, mode:'range', articleTitle:'제1조~제9조', articles:[9개], refs:[{key:'서식1',kind:'link',…}]}
 * @param {{law:string, article:string, tier:string, baseLaw:string}} q
 * @returns {Promise<object>} 성공 {ok:true,…} / 실패 {ok:false, reason}
 * [연계] ← routes/legal.js GET /api/legal/article-text. → github_raw.listDir/fetchText.
 */
async function loadArticle(q) {
  const law = String((q && q.law) || '').trim();
  const qTier = q && q.tier;
  const tier = Object.prototype.hasOwnProperty.call(TIER_FILE, qTier) ? qTier : (qTier === 'notice' ? 'notice' : 'law');
  const ref = parseArticleRef((q && q.article) || '', tier, law);
  if (!law || !ref) return { ok: false, reason: 'bad_request' };
  if (!githubRaw.hasToken()) return { ok: false, reason: 'no_token' };

  const base = resolveBase(law, (q && q.baseLaw) || '', tier);
  if (!base) return { ok: false, reason: 'law_not_found' };

  let filePath;
  if (tier === 'notice') {
    const picked = pickNoticeFile(await githubRaw.listDir(base + '/행정규칙'), law);
    if (!picked) return { ok: false, reason: 'file_not_found' };
    filePath = base + '/행정규칙/' + picked;
  } else {
    filePath = base + '/' + TIER_FILE[tier];
  }

  let text = await githubRaw.fetchText(filePath);
  // ★발췌본 폴백(2026-08-28) — 타법은 **법 전체가 아니라 인용한 조문만** 받아 두는 것이 확정 방침이라
  //   그 파일 이름이 `법률_발췌.txt` 다(`add_other_law_article.js`). 그런데 여기는 `법률.txt` 만
  //   찾고 있어서, **원문이 우리 손에 있는데도 "파일 없음"으로 실패**하고 있었다.
  //   실측(2026-08-28): `raw/15_관련타부처` 폴더 491개 중 **224개가 발췌본만** 가지고 있다 —
  //   그 224개 법의 인용은 지금까지 하나도 안 열렸다.
  //   ⚠순서를 지킨다: 정식 파일이 있으면 그것이 우선이고, 없을 때만 발췌본을 본다.
  //     발췌본에 그 조가 없으면 아래에서 "그 조 없음"으로 정직하게 갈린다(없는 것을 지어내지 않는다).
  if (!text && tier !== 'notice') {
    const alt = base + '/' + TIER_FILE[tier].replace('.txt', '_발췌.txt');
    const t2 = await githubRaw.fetchText(alt);
    if (t2) { text = t2; filePath = alt; }
  }
  // ★그 자체가 대통령령인 법령은 파일 이름이 `대통령령.txt`(발췌본이면 `대통령령_발췌.txt`)다.
  //   위 두 이름으로 못 찾았을 때만 본다 — 시행령이 있으면 그쪽이 먼저다.
  if (!text && TIER_FILE_ALT[tier]) {
    for (const n of [TIER_FILE_ALT[tier], TIER_FILE_ALT[tier].replace('.txt', '_발췌.txt')]) {
      const t3 = await githubRaw.fetchText(base + '/' + n);
      if (t3) { text = t3; filePath = base + '/' + n; break; }
    }
  }
  if (!text) return { ok: false, reason: 'file_not_found' };

  // ★부칙 인용(2026-08-28) — 부칙은 그 법 파일 **뒤쪽**에 붙어 있고, 표기가 법률 본문(`[제10조]`)이
  //   아니라 고시와 같은 줄머리 `제10조(제목)` 꼴이다. 그래서 ⑴본문 구간을 잘라내고 부칙 구간만
  //   남기고 ⑵파싱만 고시 규칙으로 한다. `head.tier` 는 손대지 않는다 — 화면 배지는 그 법의
  //   계층 그대로여야 사용자에게 정직하다.
  //   ⚠부칙 셀일 때만 들어온다. 본문의 같은 번호 조(제2조 등)와 섞일 일이 없다.
  let parseTier = tier;
  if (isAddendaCell(law)) {
    const cut = text.search(DOC_TAIL_RE);
    if (cut < 0) return { ok: false, reason: 'article_not_found' };   // 부칙이 없는 파일이다
    text = text.slice(cut);
    parseTier = 'notice';
  }

  // focused 는 single 갈래에서만 true 가 될 수 있다(아래 "조 하나 인용" 참고) — 나머지 갈래는
  // 강조 자체를 하지 않으므로 여기서 false 로 못박아 클라이언트가 undefined 를 만나지 않게 한다.
  const head = { ok: true, law, tier, mode: ref.mode, focused: false, addenda: '' };
  const refCtx = {
    base, tier, docText: text, docTitle: law,
    docDir: filePath.slice(0, filePath.lastIndexOf('/')),
  };

  // ── 별표 전용 인용: 조 본문을 거치지 않고 그 별표 원문을 바로 판정해 돌려준다 ──
  // (조문 칸이 `별표10`처럼 조 번호 없이 별표만 가리키는 행. 조 블록 파싱은 할 것이 없다.)
  if (ref.mode === 'annex') {
    const found = ref.refKeys.map(k => ({ key: k, text: k }));
    const refs = await resolveRefs(found, refCtx);
    return Object.assign(head, {
      articleTitle: ref.label,
      effectiveDate: docDate(text),
      refs,
      // 여러 별표를 가리킨 인용에서 못 찾은 것은 조용히 빼지 않고 그대로 알린다.
      missing: refs.filter(r => r.kind === 'missing').map(r => r.key),
      refsTruncated: bylCount(found) >= MAX_REFS,
    });
  }

  // ── 범위·전체 인용: 여러 조를 순서대로 나열한다(강조 없음 — 어디가 근거인지 단정할 수 없다) ──
  if (ref.mode !== 'single') {
    const joList = ref.mode === 'whole' ? listArticleNumbers(text, parseTier) : expandRange(text, parseTier, ref);
    if (!joList.length) return { ok: false, reason: 'article_not_found' };
    const attachments = tier === 'notice'
      ? extractAttachments(text).map(a => ({ key: a.key, title: a.title })) : [];
    // 본문에서 인용되지 않은 별표도 팝업 아래 목록에서 열 수 있게 판정 대상에 함께 넣는다
    // (안 넣으면 원문이 있는데도 "미수집"처럼 회색으로 보인다).
    const withAtts = (found) => {
      for (const a of attachments) {
        if (bylCount(found) >= MAX_REFS) break;
        if (!found.some(f => f.key === a.key)) found.push({ key: a.key, text: a.key });
      }
      return found;
    };
    if (joList.length > MAX_ARTICLES) {
      const found = withAtts([]);
      return Object.assign(head, {
        articleTitle: ref.label,
        effectiveDate: docDate(text),
        attachments,
        tooLong: { articleCount: joList.length, limit: MAX_ARTICLES },
        refs: await resolveRefs(found, refCtx),
        refsTruncated: bylCount(found) >= MAX_REFS,
      });
    }
    const articles = buildArticles(text, parseTier, joList);
    if (!articles.length) return { ok: false, reason: 'article_not_found' };
    const bodyText = articles.map(a => a.paragraphs.map(paraPlainText).join('\n')).join('\n');
    const found = withAtts(collectRefs(bodyText));
    // 나열 인용은 "적힌 조를 전부 보여주겠다"는 약속이라, 원문에서 못 찾은 조를 조용히 빼면
    // 사용자가 절반만 보고도 전부 본 줄 안다 — 못 찾은 조 번호를 그대로 실어 화면이 알리게 한다
    // (지어내지 않고, 찾은 것만 있는데 전부인 척하지도 않는다).
    const missing = ref.mode === 'list' ? joList.filter(jo => !articles.some(a => a.jo === jo)) : [];
    return Object.assign(head, {
      articleTitle: ref.label,
      missing,
      // 법률 계열은 조마다 시행일자가 붙어 있어 그 첫 값을, 고시는 파일 머리 발령일자를 쓴다.
      effectiveDate: (articles.find(a => a.eff) || {}).eff || docDate(text),
      articles,
      attachments,
      // 문서의 마지막 조가 나열에 포함됐으면 그 뒤의 부칙이 딸려 있다 — 본문에서 떼어낸 것을 그대로 싣는다.
      addenda: (articles.find(a => a.addenda) || {}).addenda || '',
      refs: await resolveRefs(found, refCtx),
      refsTruncated: bylCount(found) >= MAX_REFS,
    });
  }

  // ── 조 하나 인용(기존 동작 그대로): 인용된 항·호를 강조한다 ──
  const block = extractArticleBlock(text, ref.jo, parseTier);
  if (!block) return { ok: false, reason: 'article_not_found' };

  const paragraphs = splitParagraphs(cleanBody(block.body));
  if (!paragraphs.length) return { ok: false, reason: 'article_not_found' };

  // 인용된 항 찾기. 항 기호가 아예 없는 조(벌칙 조문 등)는 조각이 하나뿐이라 그 하나가 인용 대상이다.
  let hitIdx = ref.mark ? paragraphs.findIndex(p => p.mark === ref.mark) : -1;
  if (hitIdx < 0 && paragraphs.length === 1) hitIdx = 0;
  // 인용된 호 찾기. ⚠ 예전엔 "몇 번째 항목인가"(j === ref.ho - 1)로 셌는데, 가지번호 호(`6의2`)가
  //   섞이면 순번과 호 번호가 어긋나 엉뚱한 호가 칠해진다(제53조②의 7번째 항목은 6호가 아니라 6의2호다).
  //   그래서 순번이 아니라 **원문에 적힌 호 번호(label)** 로 대조한다.
  const hoList = ref.hoList || [];
  const out = paragraphs.map((p, i) => ({
    mark: p.mark,
    text: p.text,
    hit: i === hitIdx,
    items: p.items
      ? p.items.map(it => ({
        label: it.label,
        text: it.text,
        hit: i === hitIdx && hoList.indexOf(it.label) >= 0,
        subs: it.subs,
      }))
      : null,
  }));

  // ── focused — "인용이 항(또는 항+호)을 특정했고, 그 항·호를 원문에서 실제로 찾았다"는 신호 ──
  // 클라이언트는 focused:true 일 때 **hit 항의 머리문장 + hit 호만** 펼치고 나머지는 "조문 전체 보기"로
  // 접는다. 접는 판단의 근거가 이 값이라 틀리면 사용자가 **엉뚱한 조문만** 보게 된다 — 그래서 조금이라도
  // 어긋나면 false 로 물러난다(이 파일의 "애매하면 쪼개기를 포기하고 항 통째로" 계약과 같은 태도).
  // false 여도 잃는 것은 없다 — 화면이 지금까지처럼 조 전체를 그대로 보여줄 뿐이다. 다음을 다 만족할 때만 true:
  //  ⓐ 인용이 지목한 항 기호(`④`·`제4항`)가 원문에 **실제로 있어** 그 항에 hit 가 달렸다(markFound).
  //     ⚠ 위 hitIdx 폴백("항 기호가 없는 조는 조각이 하나뿐이니 그 하나가 인용 대상")은 인용이 항을
  //       지목했는데 **못 찾은** 경우에도 0이 된다 — 그 폴백만으로 focused 를 주면 지목한 항과 다른
  //       조각을 "그 항"이라고 단정하게 되므로 인정하지 않는다.
  //  ⓑ 항을 안 지목한 인용(`제57조제1호`)은 조각이 하나뿐일 때만 인정한다(그때는 어느 항인지 다툼이 없다).
  //     그마저도 호를 지목했을 때만 — 아무것도 안 지목한 `제57조`를 focused 로 주면 접을 것이 없다.
  //  ⓒ 그 항 기호가 조 안에 **하나뿐**이다. 수집이 덜 된 타법 파일에는 한 조 블록 안에 다른 조의
  //     조각까지 섞여 들어가 ①이 두세 번 나오는 블록이 실측 41개 있다(전체 25,919 블록 중).
  //     그런 조는 findIndex 가 앞의 ①을 집는데 인용이 가리킨 것은 뒤의 ①이라 **엉뚱한 항만 펼쳐진다**
  //     (부가가치세법 제37조 실측). 어느 쪽인지 단정할 수 없으므로 조 전체를 보여준다.
  //  ⓓ 호를 지목했으면 **지목한 호가 전부** 그 항에서 발견돼 hit 가 달렸다. 하나라도 못 찾으면 화면이
  //     나머지를 접어 인용된 호를 조용히 감춘다("부분 실패는 정직하게 표시" 계약 위반).
  //  ⓔ 호를 안 지목했는데 그 항이 호로 쪼개져 있으면 false — 접으면 각 호가 통째로 사라져
  //     "다음 각 호의 어느 하나에 해당하는 자에게는 …" 머리문장만 남는다(항만 지목한 인용은 조 전체를 준다).
  const hitPara = hitIdx >= 0 ? out[hitIdx] : null;
  const markFound = !!ref.mark && paragraphs.filter(p => p.mark === ref.mark).length === 1;
  const focused = !!hitPara &&
    (markFound || (!ref.mark && hoList.length > 0 && paragraphs.length === 1)) &&
    (hoList.length > 0
      ? !!hitPara.items && hoList.every(h => hitPara.items.some(it => it.label === h && it.hit))
      : !hitPara.items);

  const found = collectRefs(paragraphs.map(paraPlainText).join('\n'));
  return Object.assign(head, {
    articleTitle: ref.jo + (block.title ? `(${block.title})` : ''),
    effectiveDate: block.effectiveDate,
    paragraphs: out,
    focused,
    // 이 조 뒤에 붙어 있던 부칙(문서의 마지막 조에만 생긴다). 본문에서 떼어낸 원문 그대로다.
    addenda: block.addenda || '',
    refs: await resolveRefs(found, refCtx),
    // 참조가 MAX_REFS 를 넘어 뒤쪽을 아예 판정하지 않았다는 신호(클라이언트가 "미수집"으로
    // 단정하지 않게 한다 — 판정 안 한 것과 실제로 없는 것은 다르다).
    refsTruncated: bylCount(found) >= MAX_REFS,
  });
}

module.exports = {
  loadArticle, parseArticleRef, splitHo, splitParagraphs, extractArticleBlock, pickNoticeFile,
  cleanBody, collectRefs, extractAttachments, parseBylFile, listArticleNumbers, buildArticles, resolveRefs,
  // resolveBase 는 순수 함수다(네트워크 없음). 위키 검사 도구(_dashboard/loop/link_ready.js)가
  // "이 근거 줄을 누르면 어느 원문 파일을 여는가"를 **생산과 똑같이** 계산하려고 쓴다 —
  // 따로 구현하면 검사와 코드가 어긋난다(L-136).
  resolveBase,
  // isAddendaCell 도 같은 이유로 내보낸다(L-136) — `○○법 부칙 제2조` 인용을 게이트가
  // 생산과 똑같이 "부칙 구간에서 찾는다"고 판단해야 숫자가 어긋나지 않는다.
  isAddendaCell, addendaLawName,
};
