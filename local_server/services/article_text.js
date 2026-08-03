/**
 * ============================================================================
 * 파일명: services/article_text.js
 * 역할: 답변카드의 조문을 눌렀을 때 보여줄 **조문 원문**(조 하나 · 범위 · 문서 전체)을
 *       raw 원문에서 뽑아 항(①②③…)·호(1. 2. 3.) 단위로 쪼개 주고, 본문에 나오는
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
 * [인용 표기 3종 — 위키 표의 `조문` 칸은 조 하나만 가리키지 않는다]
 *  - single : `제10조④3호` — 조 하나. 인용된 항·호를 강조(hit)한다.
 *  - range  : `제1~9조`·`전문(제1조~제10조)` — 그 범위의 조를 **순서대로 전부** 나열한다.
 *  - whole  : `전체`·`전문`, 또는 고시인데 조 번호가 아예 없는 표기(고시 제목만 적힌 행).
 *             그 문서의 조문을 전부 나열한다.
 *   ⚠ range·whole 은 **강조(hit)를 하지 않는다** — 여러 조 전체가 근거라 "어디가 진짜
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
 *  ⚠ 참조가 MAX_REFS 를 넘으면 뒤쪽은 **판정 자체를 안 한다** — 그건 "없다"가 아니라 "안 봤다"라서
 *    응답에 `refsTruncated:true`를 함께 보낸다(클라이언트는 그런 참조를 "미수집"으로 단정하지 않고
 *    원문 글자 그대로 둔다).
 *
 * [환각 0 — 이 파일의 핵심 계약]
 *  - 원문에서 그 조를 못 찾으면 **문장을 지어내지 않고** {ok:false, reason}을 돌려준다.
 *  - 호(1. 2. 3.) 쪼개기는 번호가 1부터 연속일 때만 인정한다. "제2조의2" 뒤에 "8."이
 *    붙어 "28."로 오검출되는 실제 사례가 있어, 조금이라도 어긋나면 쪼개기를 포기하고
 *    **항을 통째로** 보여준다(잘못 잘린 조문을 보여주는 것보다 안전).
 *  - 별표 블록에 번호(`〔별표 1〕` 등)가 안 적혀 있으면 "1번이겠지"라고 넘겨짚지 않고
 *    그 블록을 버린다(번호 없는 `[별표]` 블록이 실제 raw 에 381개 있다).
 *  - 계층 없는 `별표N.txt`는 파일명 번호와 내용 번호가 어긋난 게 41개 있어, 선언줄의 **계층과
 *    번호가 둘 다 맞을 때만** 쓴다(맞지 않으면 다른 별표를 그 번호인 척 보여주게 된다).
 *  - 내용이 `[별표 7] 삭제` 한 줄뿐인 폐지 별표는 "원문 있음"으로 확정하지 않는다(빈 팝업 방지).
 *  - 우리가 못 읽는 인용 표기(`제109·110조` 같은 열거, `제8조·제3~6조` 같은 혼합)는 억지로 하나만
 *    골라 열지 않고 bad_request 로 정직하게 실패한다 — 틀린 원문을 보여주는 것보다 안 여는 게 낫다.
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

// tier → `별표/` 안의 파일명·_links.json 키 앞머리(예: rule → `시행규칙_별표1.txt`, `"시행규칙 별표 1"`).
const TIER_BYL_PREFIX = { law: '법률', decree: '시행령', rule: '시행규칙' };

// 한 팝업에 나열하는 조의 상한. 넘으면 억지로 다 싣지 않고 "원문이 깁니다"로 넘긴다(목업 확정).
const MAX_ARTICLES = 15;
// 한 번에 판정할 별표·서식 참조 상한(원문이 긴 문서에서 GitHub 조회가 폭주하지 않게).
const MAX_REFS = 12;
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
// 문서 전체 표기(실측: `전체` 19건 · `전문` 9건 · `전 5조` 2건). `전문교육기관`·`전문인력`
// 처럼 "전문"으로 시작만 하는 딴 말이 실제로 있어 **완전일치**로만 인정한다.
const WHOLE_RE = /^(전체|전문|전부|전\s*\d+\s*조)$/;

/**
 * 위키 표의 조문 표기에서 인용 형태(single·range·whole)와 조·항·호를 뽑는다. 표기는
 * 페이지마다 여러 가지가 섞여 있다(실측) — 조 하나(`제10조④3호`/`제10조제4항제3호`),
 * 범위(`제1~9조`), 문서 전체(`전체`·`전문`), 그리고 고시엔 조 번호 없이 제목만 적힌 행도 있다.
 * 예: parseArticleRef('제10조④3호')       → {mode:'single', jo:'제10조', mark:'④', ho:3}
 *     parseArticleRef('제5조제1항')        → {mode:'single', jo:'제5조', mark:'①', ho:0}
 *     parseArticleRef('전문(제1~24조)')     → {mode:'range', joList:['제1조'…'제24조'], label:'제1조~제24조'}
 *     parseArticleRef('전체')              → {mode:'whole', joList:[], label:'전체'}
 *     parseArticleRef('위험물선박운송기준', 'notice') → {mode:'whole', …}(고시 제목만 적힌 행)
 * @param {string} article - 체인 행의 조문 표기
 * @param {string} [tier] - law|decree|rule|notice. 고시일 때만 "조 번호 없음 → 문서 전체"로 본다
 * @returns {{mode:string, jo:string, joList:string[], from:number, to:number, mark:string, ho:number, label:string}|null}
 *          어느 형태로도 못 읽으면 null(from·to 는 range 일 때만 있다)
 * [연계] ← loadArticle(). jo·joList 는 원문에서 조 블록을 찾는 열쇠, mark·ho 는 강조 대상(single 전용).
 */
function parseArticleRef(article, tier) {
  // `제69조 → 시행령 제42~45조`처럼 위임흐름을 한 칸에 적은 표기가 있다 — 이 행의 법령은 앞쪽
  //  것이므로 화살표 뒤(다른 계층의 조)는 잘라낸다. 안 자르면 법률 카드가 시행령 조를 연다.
  const s = String(article || '').split(/→|⇒|➔|=>/)[0].trim();
  if (!s) return null;

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
    // ③ 조 번호가 아예 없다 — 고시는 짧아서 위키가 "제목만 적고 문서 전체"를 가리키는 행이 흔하다
    //    (실측: `위험물선박운송기준`·`「수산물 표준규격」` 등). 다만 별표만 가리키는 행이나
    //    날짜가 잘못 들어온 행까지 문서 전체로 열면 엉뚱하므로 그런 표기는 제외한다.
    // ⚠ `제109·110조`·`제5ㆍ7ㆍ8조`·`제1~2호`처럼 **가운뎃점으로 나열된 인용**은 위 단일·범위
    //   패턴 어디에도 안 걸리는데(실측 29건), 이걸 제목행으로 보면 사용자가 요청한 조 대신 문서
    //   전체가 열려 **틀린 원문을 맞다고 보여주게** 된다. 조·항·호·편 번호가 하나라도 있으면
    //   "제목"이 아니라 "우리가 못 읽는 인용 표기"이므로 정직하게 실패시킨다(열거 표기 파싱은 범위 밖).
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
  const rest = s.slice(m.index + m[0].length).split(/[·・,(（]/)[0];
  let mark = '';
  const cm = new RegExp(`[${CIRCLED}]`).exec(rest);
  if (cm) mark = cm[0];
  else {
    const hm = /제(\d+)항/.exec(rest);
    if (hm && +hm[1] >= 1 && +hm[1] <= CIRCLED.length) mark = CIRCLED[+hm[1] - 1];
  }
  const ho = /(?:제)?(\d+)\s*호/.exec(rest);
  return { mode: 'single', jo, joList: [jo], mark, ho: ho ? parseInt(ho[1], 10) : 0, label: jo };
}

// 호 머리번호("1." "2." …) 탐지. 앞뒤가 숫자면 제외해 "2.5"·"28."류 오검출을 막는다.
const HO_RE = /(?<!\d)([1-9]\d?)\.(?!\d)/g;

/**
 * 항 하나를 호(1. 2. 3. …)로 쪼갠다. **번호가 1부터 연속일 때만** 쪼개고, 하나라도
 * 어긋나면 null 을 돌려 호출부가 "항 통째로" 보여주게 한다(잘못 자르느니 안 자른다).
 * 예: splitHo('② 다음 각 호와 같다.1. 가나2. 다라') → {lead:'② 다음 각 호와 같다.', items:['가나','다라']}
 *     splitHo('… 7.31.까지 …')                    → null(번호가 1,2,3… 이 아니라 포기)
 * @param {string} hangText - 항 텍스트(머리기호 ①… 포함 가능)
 * @returns {{lead:string, items:string[]}|null} 못 쪼개면 null
 * [연계] ← splitParagraphs(). 결과 items 가 팝업의 `호` 목록이 된다.
 */
function splitHo(hangText) {
  // 항 머리기호(①등, 있으면) 제거 후 검사
  const head = /^[①-⑳]/.test(hangText) ? hangText.slice(0, 1) : '';
  const body = hangText.replace(/^[①-⑳]/, '');
  const idxs = [];
  let m;
  HO_RE.lastIndex = 0;
  while ((m = HO_RE.exec(body))) idxs.push({ pos: m.index, num: parseInt(m[1], 10), len: m[0].length });
  if (!idxs.length) return null;
  const nums = idxs.map(i => i.num);
  const expected = Array.from({ length: nums.length }, (_, i) => i + 1);
  if (JSON.stringify(nums) !== JSON.stringify(expected)) return null; // 1,2,3…연속 아니면 포기 → 항 통째로
  const items = [];
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i].pos + idxs[i].len;
    const end = i + 1 < idxs.length ? idxs[i + 1].pos : body.length;
    items.push(body.slice(start, end).trim());
  }
  return { lead: (head + body.slice(0, idxs[0].pos)).trim(), items };
}

/**
 * 조 본문을 항(①②③…) 단위로 쪼갠다. 항 기호 없이 시작하는 앞부분(제66조 벌칙처럼
 * 항 구분이 없는 조)은 mark 가 빈 첫 조각으로 둔다.
 * 예: splitParagraphs('① 가나\n② 다라') → [{mark:'①',text:'가나',items:null},{mark:'②',…}]
 * @param {string} body - extractArticleBlock 이 뽑은 조 본문
 * @returns {Array<{mark:string, text:string, items:string[]|null}>}
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
 * @returns {{title:string, effectiveDate:string, body:string}|null} 그 조가 없으면 null
 * [연계] ← loadArticle(). → splitParagraphs()
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
    return { title: m[1].trim(), effectiveDate: eff ? fmtDate(eff[1]) : '', body: m[2].trim() };
  }
  // `[제10조] 제목 (시행 20260624 · 타법개정)` 헤더 줄 + 다음 `[제N조]` 전까지가 본문.
  // ⚠ 마지막 조 뒤엔 다음 `[제N조]`가 없어 lookahead가 파일 끝(`$`)까지 먹는데, 그러면 뒤에
  //   오는 부칙 전체(다른 법률의 개정 등)까지 그 조 본문으로 딸려 들어간다(실측으로 확인한
  //   함정 — notice 분기엔 `\n부칙`이 이미 있었는데 이쪽엔 빠져 있었다). 부칙도 경계로 끊는다.
  const re = new RegExp(`(?:^|\\n)\\[${reEsc(jo)}\\]([^\\n]*)\\n([\\s\\S]*?)(?=\\n\\[제\\d+조|\\n부칙|$)`);
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
  };
}

/**
 * 원문에 섞여 있는 이미지 마커를 정리한다. `<img id="123">`(전 raw 811개)·
 * `<img src="http://www.law.go.kr/…">`(47개)는 화면에 그대로 노출되면 안 되는 찌꺼기라 걷어내고,
 * `【이미지판독 123】(원본이미지: _이미지/123.png)`(297개)는 우리가 스캔본을 갖고 있다는 뜻이라
 * `【이미지 123】` 참조로 줄여 둔다(클라이언트가 눌러서 볼 수 있게).
 * 예: cleanBody('… 있다.<img id="9">\n【이미지판독 9】(원본이미지: _이미지/9.png)\n[표]…')
 *     → '… 있다.\n【이미지 9】\n[표]…'
 * @param {string} s - 조 본문
 * @returns {string}
 * [연계] → collectRefs()가 `【이미지 N】`을 참조로 잡고, resolveRefs()가 실제 파일 유무를 확인한다.
 */
function cleanBody(s) {
  return String(s || '')
    .replace(/<\/?img\b[^>]*>/gi, '')
    .replace(/【이미지판독\s*(\d+)】\s*\(원본이미지:[^)]*\)/g, '【이미지 $1】');
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
// 조문 구간이 끝나는 자리 — 부칙, `[별표] 제목` 묶음머리, 또는 번호 붙은 별표 블록 중 먼저 나오는 곳.
// ⚠ 원문에 `부\n칙<2012. 5. 31.>`처럼 **줄바꿈이 낀 "부칙"**이 실측 88개 파일에 있어 `\n부칙`만으론
//   못 끊는다 — 안 끊으면 조 본문에 부칙+별표가 통째로 딸려 들어간다(인천항·경인항선박통항규칙
//   제32조에서 11,350자 실측). 그래서 부·칙 사이 공백/줄바꿈을 허용한다.
// ⚠ 이 패턴은 extractArticleBlock(고시)·articleRegion·extractAttachments 가 **함께** 쓴다.
//   따로 좁은 정규식을 두면 "조 본문은 안 끊겼는데 별표는 끊긴" 어긋남이 생긴다(중복 로직 금지).
const DOC_TAIL_SRC = '\\n\\[별표\\]|\\n\\[별지\\]|\\n부\\s*칙|\\n[ \\t]*(?:■[^\\n[〔【(「]*)?[[〔【(「]\\s*(?:별표|별지|서식)\\s*제?\\s*\\d';
const DOC_TAIL_RE = new RegExp(DOC_TAIL_SRC);

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
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(String(text || '')))) {
    const key = refKeyOf(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, text: m[0] });
    if (out.length >= MAX_REFS) break;
  }
  return out;
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
 * 그 법의 raw 폴더 경로를 찾는다. 체인 행의 법령명(시행령·시행규칙 꼬리말 떼고 재시도 포함)이
 * 우선이다. **baseLaw 폴백은 고시(tier==='notice')에만 쓴다** — 고시는 제목만으로 폴더를 못
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
  const direct = rawPathOf(law) || rawPathOf(String(law || '').replace(/\s*(시행령|시행규칙)\s*$/, ''));
  if (direct) return direct;
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
 * 예: expandRange(시행규칙txt, 'rule', {from:36, to:46, joList:['제36조'…'제46조']})
 *     → ['제36조','제36조의2',…,'제46조','제46조의2']
 * @param {string} text - 파일 전체 원문
 * @param {string} tier - law|decree|rule|notice
 * @param {object} ref - parseArticleRef 결과(mode==='range')
 * @returns {string[]} 조 번호 순으로 정렬된 목록
 * [연계] ← loadArticle()(mode==='range'). → listArticleNumbers()·buildArticles()
 */
function expandRange(text, tier, ref) {
  if (!ref.from) return ref.joList;
  const set = new Set(ref.joList);
  for (const jo of listArticleNumbers(text, tier)) {
    const n = joOrder(jo)[0];
    if (n >= ref.from && n <= ref.to) set.add(jo);
  }
  return [...set].sort((a, b) => joOrder(a)[0] - joOrder(b)[0] || joOrder(a)[1] - joOrder(b)[1]);
}

/**
 * 조 번호 목록을 받아 각 조의 원문 블록을 순서대로 뽑아 항·호로 쪼갠다(범위·전체 인용용).
 * 원문에 없는 조는 조용히 건너뛴다(범위 표기가 실제 조문보다 넓게 잡힌 경우가 있다).
 * 예: buildArticles(지침txt, 'notice', ['제1조','제2조']) → [{jo:'제1조', title:'목적', eff:'', paragraphs:[…]}, …]
 * @param {string} text - 파일 전체 원문
 * @param {string} tier - law|decree|rule|notice
 * @param {string[]} joList - 뽑을 조 번호
 * @returns {Array<{jo:string, title:string, eff:string, paragraphs:Array}>}
 *          eff 는 법률 계열의 조별 시행일자(`[제10조] … (시행 20260624 …)`) — 팝업 머리 날짜에 쓴다
 * [연계] ← loadArticle()(range·whole). → extractArticleBlock()·splitParagraphs()
 */
function buildArticles(text, tier, joList) {
  const out = [];
  for (const jo of joList) {
    const block = extractArticleBlock(text, jo, tier);
    if (!block) continue;
    const paragraphs = splitParagraphs(cleanBody(block.body));
    if (!paragraphs.length) continue;
    out.push({ jo, title: block.title, eff: block.effectiveDate, paragraphs });
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
      r.title = (t.split('\n')[0] || '').replace(/^\[[^\]]*\]\s*/, '').trim();
      r.body = bylBody(t);
    });
  }

  // ④ 법률계열 — 텍스트가 없는 별표는 `_links.json`에 다운로드 링크만 있다.
  if (prefix && rest().length) {
    let links = null;
    try { links = JSON.parse(await githubRaw.fetchText(`${ctx.base}/별표/_links.json`) || 'null'); } catch (_) { links = null; }
    if (links && typeof links === 'object') {
      for (const r of rest()) {
        const k = splitRefKey(r.key);
        const v = k && links[`${prefix} ${k.type} ${k.num}`];
        if (!v || typeof v !== 'object') continue;
        r.kind = 'link';
        r.title = String(v.제목 || '');
        // `PDF` 키는 수집 스크립트가 아직 안 채우고 있다(_LESSONS L-55) — 채워지면 그대로 뜬다.
        r.hwp = absUrl(v.HWP);
        r.pdf = absUrl(v.PDF);
      }
    }
  }

  // ⑤ 고시 — 별표를 `별표/` 폴더에 따로 모아둔 경우(형식이 자유서술이라 머리말로 임자를 확인한다).
  if (ctx.tier === 'notice' && rest().length) {
    // 위키 표의 고시 이름엔 `…지침(고시)`·`「…」(국립수산물품질관리원, 2026-02-11 발령)`처럼
    // 꼬리표가 붙어 있어 그대로 비교하면 별표 파일의 머리말과 안 맞는다 — 괄호 주석을 걷어낸다.
    const want = squash(String(ctx.docTitle || '').replace(/[（(][^)）]*[)）]/g, '')) || squash(ctx.docTitle);
    const cand = (await githubRaw.listDir(ctx.base + '/별표'))
      .filter(e => e.type === 'file' && /\.txt$/i.test(e.name) && !/^(법률|시행령|시행규칙)_/.test(e.name))
      .slice(0, 8);
    for (const e of cand) {
      if (!rest().length) break;
      const t = await githubRaw.fetchText(ctx.base + '/별표/' + e.name);
      if (!t) continue;
      const parsed = parseBylFile(t);
      // 그 고시 것이 맞는지 — 머리말(제목·출처 줄)에 고시 이름이 들어 있어야 인정한다.
      if (!want || !squash(parsed.owner).includes(want)) continue;
      for (const r of rest()) {
        const en = parsed.entries.find(x => x.key === r.key);
        if (!en) continue;
        r.title = en.title;
        if (en.body && en.body.length > 40) { r.kind = 'text'; r.body = en.body; }
        else if (en.hwp || en.pdf) { r.kind = 'link'; r.hwp = en.hwp; r.pdf = en.pdf; }
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
 * 인용 표기에 따라 세 가지로 갈린다(parseArticleRef 참고).
 *  - single: 그 조 하나 → `paragraphs`(인용된 항·호에 hit:true)
 *  - range · whole: 여러 조 → `articles`(강조 없음). 조가 MAX_ARTICLES 를 넘으면
 *    억지로 싣지 않고 `tooLong`만 돌려준다(클라이언트가 "원문이 깁니다"로 안내).
 * 어느 경우든 본문에 나온 별표·서식 참조는 `refs`로 실재 여부까지 판정해 함께 준다.
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
  const ref = parseArticleRef((q && q.article) || '', tier);
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

  const text = await githubRaw.fetchText(filePath);
  if (!text) return { ok: false, reason: 'file_not_found' };

  const head = { ok: true, law, tier, mode: ref.mode };
  const refCtx = {
    base, tier, docText: text, docTitle: law,
    docDir: filePath.slice(0, filePath.lastIndexOf('/')),
  };

  // ── 범위·전체 인용: 여러 조를 순서대로 나열한다(강조 없음 — 어디가 근거인지 단정할 수 없다) ──
  if (ref.mode !== 'single') {
    const joList = ref.mode === 'whole' ? listArticleNumbers(text, tier) : expandRange(text, tier, ref);
    if (!joList.length) return { ok: false, reason: 'article_not_found' };
    const attachments = tier === 'notice'
      ? extractAttachments(text).map(a => ({ key: a.key, title: a.title })) : [];
    // 본문에서 인용되지 않은 별표도 팝업 아래 목록에서 열 수 있게 판정 대상에 함께 넣는다
    // (안 넣으면 원문이 있는데도 "미수집"처럼 회색으로 보인다).
    const withAtts = (found) => {
      for (const a of attachments) {
        if (found.length >= MAX_REFS) break;
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
        refsTruncated: found.length >= MAX_REFS,
      });
    }
    const articles = buildArticles(text, tier, joList);
    if (!articles.length) return { ok: false, reason: 'article_not_found' };
    const bodyText = articles.map(a => a.paragraphs.map(p => p.text + (p.items || []).join(' ')).join('\n')).join('\n');
    const found = withAtts(collectRefs(bodyText));
    return Object.assign(head, {
      articleTitle: ref.label,
      // 법률 계열은 조마다 시행일자가 붙어 있어 그 첫 값을, 고시는 파일 머리 발령일자를 쓴다.
      effectiveDate: (articles.find(a => a.eff) || {}).eff || docDate(text),
      articles,
      attachments,
      refs: await resolveRefs(found, refCtx),
      refsTruncated: found.length >= MAX_REFS,
    });
  }

  // ── 조 하나 인용(기존 동작 그대로): 인용된 항·호를 강조한다 ──
  const block = extractArticleBlock(text, ref.jo, tier);
  if (!block) return { ok: false, reason: 'article_not_found' };

  const paragraphs = splitParagraphs(cleanBody(block.body));
  if (!paragraphs.length) return { ok: false, reason: 'article_not_found' };

  // 인용된 항 찾기. 항 기호가 아예 없는 조(벌칙 조문 등)는 조각이 하나뿐이라 그 하나가 인용 대상이다.
  let hitIdx = ref.mark ? paragraphs.findIndex(p => p.mark === ref.mark) : -1;
  if (hitIdx < 0 && paragraphs.length === 1) hitIdx = 0;
  const out = paragraphs.map((p, i) => ({
    mark: p.mark,
    text: p.text,
    hit: i === hitIdx,
    items: p.items
      ? p.items.map((t, j) => ({ text: t, hit: i === hitIdx && ref.ho > 0 && j === ref.ho - 1 }))
      : null,
  }));

  const found = collectRefs(paragraphs.map(p => p.text + (p.items || []).join(' ')).join('\n'));
  return Object.assign(head, {
    articleTitle: ref.jo + (block.title ? `(${block.title})` : ''),
    effectiveDate: block.effectiveDate,
    paragraphs: out,
    refs: await resolveRefs(found, refCtx),
    // 참조가 MAX_REFS 를 넘어 뒤쪽을 아예 판정하지 않았다는 신호(클라이언트가 "미수집"으로
    // 단정하지 않게 한다 — 판정 안 한 것과 실제로 없는 것은 다르다).
    refsTruncated: found.length >= MAX_REFS,
  });
}

module.exports = {
  loadArticle, parseArticleRef, splitHo, splitParagraphs, extractArticleBlock, pickNoticeFile,
  cleanBody, collectRefs, extractAttachments, parseBylFile, listArticleNumbers, buildArticles, resolveRefs,
};
