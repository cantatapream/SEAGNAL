/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing_ai.js
 * 역할  : 「연안 안전 브리핑」 관할마다 **AI 분석 문단**(연안·해상 각 3~5문장 — 장소·단계·원인·시간 흐름, 마지막 「따라서 … 필요합니다」)만 AI 에게 맡기는 부분.
 *         결론·근거·권고는 서버가 만든다(station_briefing_rules.buildSummary — 설계서 §11.10·§11.10.4). 서버가 정한 사실(단계·해역·시각·숫자)을 묶어 AI 에게 보내고,
 *         돌아온 글을 관할별로 대조 검사(숫자+단위·한글 수사·배수·지명·단계 말·금지어·안전 단정·결론과 다른 단정·출항 지시·HTML/링크·문장 수·글자 수·마지막 「따라서」, NFKC 정규화)해 통과한 것만 쓴다.
 *         다시 시도(2026-10-17 사용자 *"vm 최대 3번 후 제미나이로 가자."*): 해양경찰서 묶음마다 VM → 검증·호출에 떨어진 관할만 버려진 이유를 지시문에 넣어 VM 으로 다시(관할마다 VM 최대 3번)
 *         → 그래도 실패면 Gemini 한 번(같은 이유 포함) → 그래도 실패면 서버 규칙 분석 문단(source 'template' — 화면 「규칙 분석」, summary.analysis).
 *         묶음 단위(파출소·해양경찰서·지방청)와 「입력이 지난번과 같으면 재사용」을 설정으로 고른다(§11.6-17). 호출마다 시간 제한·실행 데드라인·VM 연속 실패 차단기.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing_rules.js(hash·RULES_VERSION·buildSummary·summaryLines — 서버 결론·근거 숫자를 허용 목록에·SOURCE_LABEL·md·dayWordOf · AI 가 실패하면 summary.analysis 규칙 문단이 보인다)
 *                    · config/zone_group_map.js(ZONE_GROUP_MAP — 기상청 해역 이름 전부: 묶음 이름 + 앞바다·먼바다. 그중 그 관할의 기상청 전망·(기상) 칸에 나온 이름만 해설에 허용 — §11.10.2)
 *  - 서버 API      : 없음 — AI 호출은 넘겨받은 어댑터로만(실제: codex_bridge.callRaw · gemini_client.callGeminiRaw — station_briefing.js 가 만든다)
 *  - 나를 쓰는 곳  : services/station_briefing.js(run) · scripts/test_station_briefing.js(가짜 어댑터)
 *  - 설계 근거     : 구성안 부록 A(입력 묶음·검증 순서) · coastal_risk.design.md §9.2(환각 방지) · handoff_marine_fusion.md 29~33행(직무 지시·해상 배수 금지)
 * [로드 순서] 서버 require 부작용 없음. 네트워크는 어댑터를 통해서만.
 * ============================================================================
 */
'use strict';
const R = require('./station_briefing_rules');

const SCHEMA = 'station-briefing-input-v2';
// 재사용 해시에 들어가는 판(독립 검토 B10) — 검증 규칙·지시문이 바뀌면 지난 AI 총평을 재사용하지 않는다.
// v3(2026-10-17 §11.10): 해설 1~2문장 · 필수 포함(required) 검사 없앰 · 기상청 해역 이름·「제주도」 허용 · 「두 곳」처럼 곳·개를 세는 한글 수사는 그 수가 허용 숫자에 있을 때만.
// 지시문 v4(§11.10.1): shown 에 (기상)·(물때) 칸이 더해져 「되풀이하지 말고 그 숫자도 옮기지 말라」를 더했다. 검증 규칙은 그대로(v3).
// v4·v5(2026-10-17 독립 검토 6~9 — 설계서 §11.10.2): 결론을 뒤집거나 누그러뜨리는 말(평온·위험하지 않·위험이 낮·가능성 낮·안심)·출항 지시 금지 · 「두세 곳」「세 군데」「세 번」 · 셈말은 문단(육상·해상) 결론·근거에 있는 수만
//   · 기상청 해역 이름은 그 관할에 관련된 것만(기상청 전망 발췌·(기상) 칸 구역·특이사항에 나온 이름, 「제주도」는 제주 관할이거나 그 글에 있을 때) 정확히 같을 때만 · 문장 나누기(「…다.다음」·줄바꿈)·문단 220자 상한.
//   지시문 v5: 해역 이름 목록이 관할마다(stations[].kma_zones)로 바뀌었다.
// v5·v6(2026-10-17 사용자 결정 — 설계서 §11.10.4): 해설 1~2문장 → 분석 문단 3~5문장(장소·단계·원인·시간 흐름, 예보 값은 「예상」), 글자 상한 220 → 420, 마지막 문장 「따라서 … 필요합니다」,
//   「A에는 주의가, B에는 관심이 필요합니다」 나열 꼴의 단계 말도 쉼표로 나뉜 대목의 대상 단계로 검사 · 지시문에 지난 시도가 버려진 이유(retry_feedback).
// v6·v7(2026-10-17 §11.10.5 독립 검토): 단계 아래쪽 검사(마지막 「따라서」 문장·문단 최고 단계 말 = 결론 단계, 평소 수준은 「평소처럼 관심」까지 허용) · 이름 없는 대목은 결론 단계까지(종전 문단 최저)
//   · 입력에 없는 말(경보·태풍·사망·사망자·임박·대규모·「아무 일도 없」·「반드시 사고」) · 나열 꼴 조사 「은·는·를·을」·쉼표 없는 「주의가 B에는」·「요하·상태」 꼴. 지시문 v7: 위 규칙과 이유 글 20자 자름.
const VALIDATOR_VERSION = 'sb-validate-v6', PROMPT_VERSION = 'sb-prompt-v7';
// 기상청 해역 이름(앞바다·먼바다·전해상 묶음) — 저장소에 이미 있는 표(config/zone_group_map.js, 통보문 해석이 쓰는 단일 출처)를 그대로 쓴다.
// 운영 10-17 08:00 판 검증 실패 「place:오후부터제주도남쪽바깥먼바다」(기상청 전망의 해역 이름) · 「place:제주도」 — 사용자 결정 *"위 추천대로 결정."* 으로 허용.
// 「인천·경기북부앞바다」처럼 가운뎃점이 든 이름은 지명 후보가 「경기북부앞바다」로 잘리므로 가운뎃점 뒤 조각도 넣는다.
const KMA_ZONE_NAMES = Object.freeze((() => {
    const { ZONE_GROUP_MAP } = require('../config/zone_group_map'), out = new Set(['제주도']);
    for (const [k, v] of Object.entries(ZONE_GROUP_MAP)) for (const n of [k, ...v]) { out.add(n); if (n.includes('·')) out.add(n.split('·').pop()); }
    return [...out].sort();
})());
// 곳·개를 세는 한글 수사(2026-10-17 결정 — 운영 실패 「number:hangul:두 곳」·「세 곳」). 그 수가 같은 단위로 허용 숫자에 있을 때만(예: 「두 곳」 ← 허용 열쇠 '2|곳').
// 그 밖(두 척·세 시·서른 미터 등)은 종전대로 막는다. 「세 군데」는 곳과 같이 센다. 「두세 곳」「서너 곳」처럼 어림 수사는 대조할 수 없어 늘 막는다(독립 검토 7).
const COUNT_WORD = Object.freeze({ '한': 1, '두': 2, '세': 3, '네': 4, '다섯': 5, '여섯': 6, '일곱': 7, '여덟': 8, '아홉': 9, '열': 10, '열한': 11, '열두': 12, '스무': 20 });
// 쓰지 않는 말 — 직무 지시(handoff_marine_fusion.md:29 — 「경비정 투입」 같은 지시도, 독립 검토 B6)·「안전」 단정(coastal_risk.design.md 「안전합니다」 금지)·확률 표현.
// 대조는 NFKC 정규화 + 공백·제로폭 문자를 지운 꼴끼리(「순 찰」·「순​찰」도 잡는다).
const FORBIDDEN = Object.freeze(['순찰', '배치', '출동', '단속', '통제', '투입', '경비정', '검문', '감시 강화', '집중 감시', '근무', '사고 확률', '확률', '사고가 납니다']);
// 「안전」 단정 — 공백을 지운 글에 건다. 「안전한 상태」·「이상 없음」·「문제없음」·「위험 요소가 없습니다」·「걱정 없」 등(B6). 「위험 요소는 확인되지 않았습니다」(§10.3 허용 문구)는 걸리지 않는다.
const SAFE_RE = /안전(?:합니다|하다|해요|한편|할것|하니|하므로|한상태|한상황|한수준|권|이보장|을보장)|이상(?:이|은|도)?(?:전혀)?없|문제(?:가|는|도)?(?:전혀)?없|위험(?:요소|요인)?(?:가|는|이|은|도)?(?:전혀)?없|걱정(?:이|은|도|할필요가?|할필요는)?(?:전혀)?없|우려(?:가|는|도)?(?:전혀)?없/;
// 서버 결론을 뒤집거나 누그러뜨리는 말(2026-10-17 독립 검토 6) — 공백을 지운 글에 건다. 「위험하지 않」·「위험이 크지 않」·「위험도가 낮」·「사고가 날 가능성은 낮」·「안심」·「출항하셔도 됩니다」.
// 「낮아집니다」(언제 나아지는지 — 지시문이 쓰라고 한 시간 흐름)는 막지 않는다(낮(?!아)).
const SOFTEN_RE = /위험(?:도|성)?(?:가|이|은|는|도)?(?:하지|크지|높지|많지)않|위험(?:도|성)?(?:가|이|은|는)?(?:매우|비교적|다소)?낮(?!아)|가능성(?:은|이|도)?(?:매우|비교적|다소)?낮(?!아)|안심|출항(?:하셔도|해도)(?:됩|괜찮|좋)/;
// 평온·잔잔·양호 서술 — 대비·변화 말(지만·으나·다가·부터·이후…)이 같은 문장에 있으면 시간 흐름 설명(「오전에는 잔잔하지만 오후부터 …」)이라 허용, 없으면 결론과 다른 단정으로 본다.
const CALM_RE = /(?:평온|잔잔|양호)(?:합니다|하겠습니다|해요|하다(?!가)|할것|한편|한상태|한수준|하니|하므로|하여|해서|하고)/, CHANGE_RE = /지만|으나|다가|부터|이후|뒤에|후에|까지는|전까지/;
// 출항 지시(「출항하지 마십시오」·「출항 금지」·「출항을 자제하」) — 지시문 「지시를 쓰지 않는다」의 검사.
const ORDER_RE = /출항(?:을|은)?(?:금지|하지마|하지말|삼가|자제하)/;
// 단계 말 — 「관심/주의/경계」 + 서술(필요·요구·요망·단계·수준·하십시오·해야·바랍니다·기울·태세·강화 등) 모든 꼴(B4).
// 「갯벌·고립 주의」·「떠밀림 주의」·「충돌·접촉 주의」 같은 앱 안내 이름과 「풍랑주의보」·따옴표 「'주의'」는 단계 말이 아니다.
// 「주의를 요합니다」·「경계 상태입니다」(요하·요합·요함·상태)도 단계 말(§11.10.5 독립 검토 5).
const LEVEL_RE = /(관심|주의|경계)\s*(?:이|가|를|을|은|는|의)?\s*(?:필요|요구|요망|요청|요하|요합|요함|상태|단계|수준|등급|하십시오|하세요|하시기|하셔야|해야|하여야|해\s*주십시오|바랍니다|기울|태세|강화)/g, LEVEL_RANK = { '관심': 1, '주의': 2, '경계': 3 }, LEVEL_WORD = ['없음', '관심', '주의', '경계'];
// 나열 꼴 단계 말(§11.10.4 — 분석 문단 마지막 「따라서 돝섬해상유원지에는 주의가, 마산로봇랜드와 실리도에는 관심이 필요합니다」): 「주의가,」처럼 쉼표 앞에서 끊긴 단계 말은
// 같은 문장에 필요·요구·요망이 있을 때 단계 말로 본다(종전 LEVEL_RE 는 「관심이 필요」만 잡아 「주의가,」가 검사를 빠져나갔다).
// §11.10.5 독립 검토 5: 조사가 없거나 은·는·를·을이어도(「금능해수욕장은 주의, 협재해수욕장은 관심이 필요합니다」), 쉼표 없이 「주의가 B에는 …」처럼 이/가 뒤에 띄어 다음 대목이 이어져도 단계 말로 본다.
const LEVEL_LIST_RE = /(관심|주의|경계)\s*(?:(?:이|가|은|는|를|을)?\s*[,，]|(?:이|가)(?=\s))/g, NEED_RE = /필요|요구|요망|요청/;
// 입력에 없는 사실·과장 말(§11.10.5 독립 검토 1b) — 그 관할 입력(서버 사실·결론·근거·기상청 전망 발췌·(기상) 칸)에 같은 말이 있을 때만 허용. 공백을 지운 글에 건다.
// 「풍랑주의보」만 있는데 「풍랑경보」, 없는 「태풍」·「사망자」, 「임박」·「대규모」·「아무 일도 없을 것」·「반드시 사고」. 원인·시제(「높아졌습니다」)·「예상」 표기는 검사하지 못한다(설계서 §11.10.5 남은 빈칸).
const FACT_WORDS = Object.freeze([['경보', /경보/], ['태풍', /태풍/], ['사망자', /사망자/], ['사망', /사망/], ['임박', /임박/], ['대규모', /대규모/], ['아무 일도·문제도 없', /아무(?:일도|문제도)없/], ['반드시 사고', /반드시사고/]]);
// 따옴표로 인용한 공식 단계 이름(예: 공식 사고예보 '주의', 혼잡 예보 '높음')은 서버 사실 문장에 같은 꼴로 있어야 한다.
const LABEL_RE = /'(낮음|보통|주의|경계|높음|매우높음|위험)'/g;
// 숫자 + 단위(B1) — 단위까지 묶어 대조한다(「3m」와 「232-3해구」의 3은 다른 사실). 범위(「12~15m/s」)는 범위 자체가 입력에 있어야 한다.
const UNIT_SRC = 'm\\/s|km|cm|mm|해리|해구|시간|시|분|초|칸|척|건|곳|명|개|배|%|년|월|일|m';
const NUM_RE = new RegExp('(\\d{1,2}):(\\d{2})|(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_SRC + ')?(?:\\s*[~∼〜–-]\\s*(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_SRC + ')?)?', 'g');
// 한글 수사(B2) — 「세 시」·「두 척」·「서른 미터」·「구 미터」·「삼십 m」 등 숫자를 한글로 쓴 꼴은 대조할 수 없으니 막는다(지시문: 숫자는 아라비아 숫자로).
const HNUM_RE = new RegExp('(?:^|[^가-힣])((?:두서너|한두|두세|서너|너덧|네댓|대여섯|예닐곱|열한|열두|하나|둘|셋|넷|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|스물|서른|마흔|쉰|예순|일흔|여든|아흔|[일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구]?백)\\s*(?:미터|m|시간|시|분|초|척|건|곳|명|해리|노트|킬로|칸|개|퍼센트|프로|센티|군데|번(?!째)|차례)|[일이삼사오육칠팔구]\\s*(?:미터|해리|노트|킬로|퍼센트|프로|센티))(?=$|[^가-힣]|에|부터|까지|의|이|가|을|를|은|는|로|으로|쯤|경|께|씩|만|정도|이상|이하|동안|무렵|전|후|째)', 'g');
const HMULT_RE = /(?:^|[^가-힣])((?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|몇|수십|여러)\s*배)(?=$|[^가-힣]|로|나|가량|이상|정도|쯤|씩|만큼|가|는|에)/g;
// 지명(B5) — 접미사로 지명 후보를 찾는다. 한 글자 접미사(항·섬·곶·만·포·도)는 흔한 낱말(정도·운항·오늘만)과 겹쳐 따로 거른다.
const PLACE_SUFFIX = ['해양경찰서', '해수욕장', '연안바다', '앞바다', '먼바다', '파출소', '출장소', '방파제', '갯바위', '해변', '포구', '부두', '등대', '해구', '해협', '항', '섬', '곶', '만', '포', '도'];
const NOT_PLACE = new Set(['운항', '출항', '입항', '귀항', '결항', '회항', '사항', '저항', '항항', '대항', '조항', '반항', '이항', '공항', '어항', '개항', '취항', '기항', '내항', '외항', '본항', '선항', '대해구', '소해구',
    '어느정도', '위험도', '혼잡도', '난이도', '중요도', '정확도', '신뢰도', '만족도', '민감도', '선명도', '투명도', '집중도', '밀집도', '심각도', '가능도', '숙련도', '관심도', '노출도', '기여도', '영향도', '포화도', '분포도']);
const PLACE_TAIL_RE = /(?:에서는|에서도|에서|으로는|으로|까지|부터|보다|처럼|에는|에도|에게|이나|이며|이고|이라|라는|와는|과는|의|에|은|는|이|가|을|를|과|와|로|만|앞|쪽|부근|인근|주변|일대|근처|해역|바다|방면)$/;
const MAN_CONTEXT = /^(?:에서|에서는|에서도|앞|쪽|부근|인근|주변|일대|근처|해역|바다|방면|의|에)$/;
const NEXT_CONTEXT = /^(?:해역|일대|주변|인근|부근|근처|앞|앞바다|연안|해안|쪽|방면|북|남|동|서|갯바위|방파제|포구|해상|바깥|안쪽|입구|부두|등대|섬)/;
const STOP_WORD = new Set(['관할', '인근', '주변', '부근', '해당', '같은', '모든', '각', '일부', '전체', '오늘', '내일', '따라서', '특히', '다만', '또', '및', '등', '해상', '육상', '연안', '이', '그', '저', '이번', '이곳', '그곳', '평소', '현재', '지금', '오전', '오후', '새벽', '밤', '낮', '앞', '뒤', '옆', '안', '밖', '근처', '여러', '주요']);
const PARTICLE_END = /(?:은|는|을|를|에|서|로|과|와|의|만|고|며|면|다|요|게|께|죠)$/;
// 분석 문단 문장 수(2026-10-17 사용자 결정 §11.10.4 — 연안·해상 각 3~5문장, 사용자 예시가 4문장·3문장). §11.10 의 해설은 1~2문장이었다.
const MIN_S = 3, MAX_S = 5;
// 분석 문단 글자 상한(독립 검토 9 — 문장 수 검사를 마침표 없이 이어 쓴 긴 글이 빠져나가지 않게). 사용자 예시 연안 205자(4문장)·해상 151자(3문장, 「지금」 줄 빼고 —
// 2026-10-17 node 로 셈) — 문장당 약 50자. 5문장에 이름이 긴 해역(「비양도 북북서방 1.4해리 해역(232-2해구)」 약 25자)·「(예상)」 표기가 붙어도 들어가고(5 × 84자),
// 예시의 두 배를 넘는 긴 글은 막도록 420자. 종전 1~2문장 해설은 220자.
const MAX_CHARS = 420;
// 관할마다 VM 시도 횟수(사용자 *"vm 최대 3번 후 제미나이로 가자."*) — 그 뒤 Gemini 한 번, 그래도 실패면 규칙 분석 문단.
const VM_ATTEMPTS = 3;

/** NFKC 정규화(전각 숫자·호환 문자 → 보통 꼴, B2). 예: '９９m' → '99m'. @param {string} t @returns {string} [연계] ← 검증 전부 */
function norm(t) { return String(t || '').normalize('NFKC'); }
/** 정규화 + 공백·제로폭 문자 제거(금지어·안전 단정·이름 대조용). 예: '순​ 찰' → '순찰'. @param {string} t @returns {string} [연계] ← validateOverview */
function compact(t) { return norm(t).replace(/[\s​-‍⁠﻿­]/g, ''); }
/** 글에서 숫자를 뽑아 표준 꼴로(앞자리 0·끝 0 무시). 예: '06:12, 1.80배, 232-2' → ['6','12','1.8','232','2']. @param {string} t @returns {string[]} [연계] ← 시험 */
function numbers(t) { return (norm(t).match(/\d+(?:\.\d+)?/g) || []).map((x) => String(Number(x))); }
/**
 * 숫자를 단위·범위째 묶어 뽑는다(B1). 열쇠 꼴: 'n|단위'(단위 없으면 'n|') · 범위 'a~b|단위' · 시각 'h:mm|:'.
 * 예: '15~18시 파고 2.4m·풍속 13m/s, 06:12' → ['15~18|시','2.4|m','13|m/s','6:12|:'] · '232-2해구' → ['232~2|해구']
 * @param {string} t @returns {object[]} [{key,text,range,ends:[열쇠…]}] [연계] ← stationInput(허용 목록)·validateOverview(대조)
 */
function numTokens(t) {
    const out = [];
    for (const m of norm(t).matchAll(NUM_RE)) {
        if (m[1] !== undefined) { out.push({ key: Number(m[1]) + ':' + m[2] + '|:', text: m[0], range: false, ends: [] }); continue; }
        const a = String(Number(m[3])), u1 = m[4] || '';
        if (m[5] === undefined) { out.push({ key: a + '|' + u1, text: m[0].trim(), range: false, unit: u1, ends: [] }); continue; }
        const b = String(Number(m[5])), u = m[6] || u1;
        out.push({ key: a + '~' + b + '|' + u, text: m[0].trim(), range: true, unit: u, ends: [a + '|' + u, b + '|' + u] });
    }
    return out;
}
/** 허용 숫자 열쇠를 사람이 읽는 꼴로. 예: '15~18|시' → '15~18시' · '6:12|:' → '6:12' · '52|' → '52'. @param {string} k @returns {string} [연계] ← stationInput(AI 입력 allowed_numbers) */
function showNum(k) { const [n, u] = k.split('|'); return u === ':' ? n : n + u; }
/**
 * 문장으로 나눈다 — 마침표·물음표·느낌표 뒤 공백, 「다.」「요.」 뒤에 바로 한글이 붙은 것(「셉니다.두번째」), 줄바꿈(독립 검토 9). 「2.4m」·「천둥.번개」는 나누지 않는다.
 * 예: 'A입니다. B입니다.' → 2 · '바람이 셉니다.두번째 문장입니다.세번째입니다.' → 3 · 'A입니다\nB입니다' → 2. @param {string} t @returns {string[]} [연계] ← validateOverview
 */
function sentences(t) { return norm(t).split(/(?<=[.!?。])\s+|(?<=[다요까죠][.!?])(?=[가-힣])|\s*\n+\s*/).map((x) => x.trim()).filter(Boolean); }
/**
 * 글에서 지명 후보를 뽑는다(B5). 낱말(조사 떼고)이 지명 접미사로 끝나면 후보, 접미사만 있는 낱말(「앞바다」)·띄어 쓴 지명(「제주도 서부 앞바다」)은
 * 앞 낱말 한두 개를 붙여 본다(공백으로만 떨어진 이름다운 낱말일 때). 한 글자 접미사: 항은 앞 1글자 이상, 섬·곶·포·도는 2글자 이상, 만은 뒤에 장소 말(에서·앞·해역…)이 올 때만,
 * 도는 조사가 더 붙었거나(「흑산도는」) 다음 낱말이 장소 말일 때만(「바람도 셉니다」의 조사 도와 가른다).
 * 예: '차귀도 앞 갯바위' → [{cands:['차귀도']}] · '제주도 동부 앞바다' → [{cands:['동부앞바다','제주도동부앞바다']}] · '정도·운항·오늘만·바람도 셉니다' → []
 * @param {string} t @returns {object[]} [{text, cands:[공백 없는 후보…]}] [연계] ← validateOverview
 */
function placeCandidates(t) {
    const src = norm(t), words = [...src.matchAll(/[가-힣A-Za-z0-9]+/g)].map((m) => ({ w: m[0], i: m.index, end: m.index + m[0].length })), out = [];
    const nameish = (x) => x && !/\d/.test(x.w) && !STOP_WORD.has(x.w) && !PARTICLE_END.test(x.w);
    words.forEach((x, k) => {
        let w = x.w, tail = '';
        for (let n = 0; n < 2 && !PLACE_SUFFIX.some((sf) => w.endsWith(sf)); n++) { const m = w.match(PLACE_TAIL_RE); if (!m || m[0].length >= w.length) break; tail = m[0] + tail; w = w.slice(0, -m[0].length); }
        if (/[도만]$/.test(w) && PLACE_SUFFIX.some((sf) => w.slice(0, -1).endsWith(sf))) { tail = w.slice(-1) + tail; w = w.slice(0, -1); }   // 「금능해수욕장도」·「한림항만」 — 조사 도·만
        const sf = PLACE_SUFFIX.find((s) => w.endsWith(s)); if (!sf) return;
        const pre = w.slice(0, -sf.length);
        if (pre && /^[\d-]+$/.test(pre)) return;          // 「232-2해구」 — 숫자는 숫자 검사가 본다
        if (NOT_PLACE.has(w) || /(?:정도|속도|온도|파도)$/.test(w)) return;
        if (sf === '항' && pre.length < 1) return;
        if (['섬', '곶', '포', '도', '만'].includes(sf) && pre.length < 2) return;
        const next = words[k + 1] && /^\s+$/.test(src.slice(x.end, words[k + 1].i)) ? words[k + 1].w : '';
        if (sf === '만' && !MAN_CONTEXT.test(tail) && !NEXT_CONTEXT.test(next)) return;
        // 「바람도 셉니다」의 도는 조사 — 뒤에 조사(는·에·의…)가 붙었거나(「흑산도는」) 다음 낱말이 장소 말(앞·해역·북방…)일 때만 지명 후보.
        if (sf === '도' && !tail && !NEXT_CONTEXT.test(next)) return;
        const prev = (j) => { const a = words[j], b = words[j + 1]; return a && b && /^\s+$/.test(src.slice(a.end, b.i)) && nameish(a) ? a.w : null; };
        const p1 = prev(k - 1), p2 = p1 ? prev(k - 2) : null;
        if (!pre && !p1) return;                           // 「앞바다」·「방파제」만 — 일반 낱말
        const cands = [w]; if (p1) cands.push(p1 + w); if (p2) cands.push(p2 + p1 + w);
        out.push({ text: (p2 ? p2 + ' ' : '') + (p1 ? p1 + ' ' : '') + w, cands: pre ? cands : cands.slice(1) });
    });
    return out;
}

/**
 * 브리핑 하나에서 AI 에게 보낼 관할 입력을 만든다(부록 A — 관할 배열의 한 칸). 해설에 쓸 것만 넣는다:
 * 해상은 overviewTop(기상·혼잡 근거가 겹친 해역 — §11.6-17①), 육상은 오늘 바뀐 요소가 있는 곳(overviewTop) + 상시 위험 장소 이름.
 * shown = 화면에 이미 보이는 서버 결론·근거·권고(summary — §11.10) — AI 가 그 수·결론을 되풀이하지 않게 알려 준다.
 * 허용 숫자 = 서버가 만든 사실 문장들(+ 서버 결론·근거 줄) 안의 「숫자+단위」, 허용 지명 = 관할·해역·구역·관광지 이름(+ 이름 줄기: 파출소 이름에서 「파출소」를 뗀 것 등 — 정확히 같을 때만).
 * 단계(levels)는 문단별(sea·land) — 이름 없는 대목의 단계는 그 문단 결론 단계(관할 이름의 단계)까지(§11.10.5 독립 검토 2 — 종전 B4 는 문단 최저). 배수는 문단별(B3 — 해상 = 해제 칸 1.2·1.3, 육상 = 사람 배수).
 * 예: stationInput(한림 브리핑) → {id:'제주해양경찰서|한림파출소', shown:{land:{headline,basis,advice},sea:{…}}, sea:{level:'주의 필요',top:[…]}, land:{…}, allowed_numbers:['15~18시','2.4m',…], allowed_places:[…], levels:{sea:{…},land:{…}}}
 * kma_zones(독립 검토 8) = 이 관할이 쓸 수 있는 기상청 해역 이름 — 기상청 전망 발췌(kma.excerpt)·(기상) 칸 구역·특이사항에 나온 이름만, 「제주도」는 제주 관할이거나 그 글에 있을 때만.
 * count_keys(독립 검토 7) = 문단(육상·해상)별 서버 결론·근거·권고 줄의 곳·개 수 — 「두 곳」은 그 문단 줄에 2곳이 있을 때만.
 * @param {object} b - rules.buildBriefing 결과 @param {object|null} [kma] - 기상청 해상 전망 발췌(station_briefing_inputs.kmaOutlook) @returns {object} [연계] ← batchInput·validateOverview / hash 의 대상
 */
function stationInput(b, kma = null) {
    const sea = b.sea, land = b.land, facts = [], places = new Set([b.station.name, b.station.office, b.station.region].filter(Boolean)), levels = { sea: {}, land: {} }, mult = { sea: new Set(), land: new Set() };
    levels.sea[b.station.name] = sea.overviewLevel.rank; if (land) levels.land[b.station.name] = land.level.rank;
    const seaTop = sea.overviewTop.map((c) => {
        const ev = [c.overview.window + ' ' + c.overview.label, ...c.today.lines.slice(0, 4), c.traits.text];
        facts.push(c.name, ...ev); places.add(c.name); if (c.nameBase) places.add(c.nameBase); if (c.traits.zone?.name) places.add(c.traits.zone.name);
        levels.sea[c.name] = c.overview.rank; if (c.nameBase) levels.sea[c.nameBase] = Math.max(levels.sea[c.nameBase] || 0, c.overview.rank);
        return { name: c.name, level: c.overview.word, window: c.overview.window, evidence: ev };
    });
    // 2026-10-16: 총평에 쓰는 시간 흐름은 총평용 단계(공식 주의·경계는 기상·혼잡 근거가 겹칠 때만)로 — 걸러진 단계를 AI 가 보고 써서 검증 실패하는 일을 막는다
    const timeline = sea.timeBar.filter((s) => (s.overviewRank ?? s.rank) > 0 || s.events.length).map((s) => ({ at: s.label, level: s.overviewWord ?? s.word, events: s.events.map((e) => e.text) }));
    timeline.forEach((s) => facts.push(s.at, ...s.events));
    const special = b.special.map((x) => { facts.push(x.title, ...x.lines); places.add(x.zone); return [x.title, ...x.lines].join(' '); });
    if (b.special.some((x) => x.kind === 'release' || x.kind === 'released')) for (const k of ['1.2|배', '1.3|배', '1.2~1.3|배']) mult.sea.add(k);
    if (sea.weather) facts.push(sea.weather.text);
    const missSea = sea.missing.map((k) => R.SOURCE_LABEL[k] || k);
    // attention_regions = 총평 기준 관심 이상 해역 수(overviewRegions — 총평 단계 level 과 같은 기준, 2단계 검토 B1). 공식 사고예보 단계만 있는 해역은 accident_only_regions 로 따로.
    const oCount = Number.isFinite(sea.overviewRegions) ? sea.overviewRegions : sea.attentionRegions;
    const seaPart = { level: sea.overviewLevel.word, reviewed_cells: sea.reviewedCells, attention_regions: oCount, accident_only_regions: Math.max(0, sea.attentionRegions - oCount), weather: sea.weather ? sea.weather.text : null, top: seaTop, timeline, missing_sources: [...new Set(missSea)] };
    let landPart = null, missLand = [];
    if (land) {
        // source = 단계 출처 꼬리표(결정 2 — 「연안 위험지수 72 '높음'」·「풍랑주의보」): 사실 목록에 넣어 그 숫자·따옴표 단계 이름을 AI 가 옮겨도 통과하게 한다.
        const top = land.overviewTop.map((c) => { facts.push(c.name, ...c.today.changes, c.traits.text, c.sourceLabel || ''); places.add(c.name); levels.land[c.name] = c.rank; for (const t of numTokens(c.today.changes.join(' '))) if (t.unit === '배') mult.land.add(t.key); return { name: c.name, level: c.word, source: c.sourceLabel || null, changes: c.today.changes, traits: c.traits.text }; });
        const constant = land.constant.slice(0, 5).map((c) => { places.add(c.name); facts.push(c.name, c.text || ''); return c.name; });
        missLand = [...new Set(land.missing.map((k) => R.SOURCE_LABEL[k] || k))];
        // changed_spots = 관심 이상 관광지 전체 수(attentionSpots) — 종전엔 카드 상한(10)으로 잘린 cards.length 였다(2026-10-17 §11.10 버그 수정).
        landPart = { level: land.level.word, reviewed_spots: land.reviewedSpots, changed_spots: Number.isFinite(land.attentionSpots) ? land.attentionSpots : land.cards.length, top, constant, missing_sources: missLand };
    }
    const tide = b.tide ? b.tide.text : [];
    facts.push(...tide);
    // 서버 결론·근거·권고 줄(summary — 서버가 서버 값만으로 만든 것)도 사실로 넣는다 — 「관할 해역 52칸」·「해역 3개」·「관광지 30곳」·「12곳」 같은 숫자+단위 꼴이 허용 목록에 들어간다.
    // (종전엔 틀 총평 문단 templateOverview 를 넣었다 — §11.10 으로 없앰.) summary 가 없는 옛 브리핑이면 지금 규칙으로 만든다.
    const summary = b.summary || R.buildSummary(b); facts.push(...R.summaryLines(summary));
    const shown = (x) => x ? { headline: x.headline, basis: x.basis, advice: x.advice } : null;
    facts.push(R.md(b.targetDate)); if (b.generatedAt) facts.push(R.md(b.generatedAt.slice(0, 10)));
    const labels = new Set(); for (const f of facts) for (const m of norm(f).matchAll(LABEL_RE)) labels.add(m[0]);
    const nums = new Set(); for (const f of facts) for (const t of numTokens(f)) { nums.add(t.key); t.ends.forEach((k) => nums.add(k)); }
    // 이름 줄기(정확히 같을 때만 허용): 파출소·해양경찰서 이름에서 꼬리를 뗀 것(「한림」·「제주」), 특보구역에서 방위·바다 꼬리를 뗀 것(「제주도」).
    const stems = new Set([b.station.name.replace(/(?:파출소|출장소)$/, ''), String(b.station.office || '').replace(/해양경찰서$/, '')].filter((x) => x.length >= 2));
    for (const pl of places) { const m = String(pl).match(/^(.+?)(?:북부|남부|동부|서부|중부|북동|북서|남동|남서)?(?:앞바다|먼바다|연안바다|평수구역)/); if (m && m[1].length >= 2) stems.add(m[1]); }
    // 띄어 쓴 허용 이름의 앞 낱말들(「비응항 방파제」 → 「비응항」) — 낱말 단위라 「림항」 같은 조각은 들어가지 않는다.
    for (const pl of places) { const ws = String(pl).split(/\s+/); for (let i = 1; i < ws.length; i++) stems.add(ws.slice(0, i).join('')); }
    // 이 관할에 관련된 기상청 해역 이름만(독립 검토 8 — 종전엔 전국 이름 전부를 끝말 일치로 허용해 「가짜제주도남쪽바깥먼바다」·인천 관할의 「제주도」가 통과했다)
    const zoneText = R.zoneKey([kma && kma.excerpt ? Object.values(kma.excerpt).join(' ') : '', summary.weather ? [summary.weather.zone, ...(summary.weather.notes || [])].join(' ') : ''].join(' '));
    const kmaZones = KMA_ZONE_NAMES.filter((n) => n !== '제주도' && zoneText.includes(R.zoneKey(n)));
    if (/제주/.test(String(b.station.region || '')) || /^(?:제주|서귀포)해양경찰서$/.test(String(b.station.office || '')) || zoneText.includes('제주도')) kmaZones.push('제주도');
    // fact_terms(§11.10.5 독립 검토 1b) = FACT_WORDS 중 이 관할 입력 글(사실 목록·서버 결론·근거·기상청 전망 발췌·(기상) 칸)에 나온 말 — 그 밖의 말은 분석 문단에 쓸 수 없다.
    const termSrc = compact([...facts, kma && kma.excerpt ? Object.values(kma.excerpt).join(' ') : '', summary.weather ? [summary.weather.zone, ...(summary.weather.rows || []).map((r) => r.label + ' ' + r.text), ...(summary.weather.notes || [])].join(' ') : ''].join(' '));
    const factTerms = FACT_WORDS.filter(([, re]) => re.test(termSrc)).map(([w]) => w);
    const countKeys = (x) => x ? [...new Set([x.headline, ...(x.basis || []), x.advice].filter(Boolean).flatMap((l) => numTokens(l).filter((t) => t.unit === '곳' || t.unit === '개').map((t) => t.key)))].sort() : [];
    return {
        id: b.key, name: b.station.name, office: b.station.office, date: b.targetDate, day_word: R.dayWordOf(b),
        // shown.weather = (기상) 칸(단기 해상예보 오전·오후·단기 전망 특이사항) — 되풀이하지 않게 보여 주기만 하고 그 숫자는 허용 목록에 넣지 않는다(summaryLines 가 빼고 모은다 — §11.10.1).
        shown: { weather: summary.weather ? { zone: summary.weather.zone, rows: (summary.weather.rows || []).map((r) => r.label + ' ' + r.text), notes: summary.weather.notes || [] } : null, tide: summary.tide || [], land: shown(summary.land), sea: shown(summary.sea) }, sea: seaPart, land: landPart, special, tide,
        allowed_numbers: [...nums].sort().map(showNum), allowed_number_keys: [...nums].sort(),
        allowed_places: [...places].filter(Boolean).sort(), place_stems: [...stems].sort(), levels,
        allowed_multipliers: { sea: [...mult.sea].sort().map(showNum), land: [...mult.land].sort().map(showNum) }, allowed_multiplier_keys: { sea: [...mult.sea].sort(), land: [...mult.land].sort() },
        kma_zones: kmaZones.sort(), count_keys: { sea: countKeys(summary.sea), land: countKeys(summary.land) },
        allowed_labels: [...labels].sort(), fact_terms: factTerms, fact_sentences: [...new Set([...tide, ...b.special.flatMap((x) => x.lines)])],
        // required(첫 해역·첫 장소·빠진 자료 이름 필수)는 없앴다(§11.10) — 결론·근거(빠진 자료 줄 포함)는 서버 summary 가 화면에 늘 보인다. 운영 실패 「required:missing:swell」의 원인이기도 했다.
    };
}
/**
 * 여러 관할을 한 번에 보낼 묶음을 만든다(부록 A schema). kma_outlook = 기상청 해상 기상 전망(단기 통보문) 원문 발췌 — 원인·흐름 이해용이며
 * 그 안의 숫자는 해설에 쓰지 않는다(허용 목록에 넣지 않는다). 해역 이름은 관할마다의 kma_zones(그 관할에 관련된 기상청 해역 이름 — 독립 검토 8)에 있는 것만 쓸 수 있다.
 * 예: batchInput([한림, 애월], kma) → {schema:'station-briefing-input-v2', stations:[2], kma_outlook:{…}, rules:{…}}
 *     다시 시도: batchInput([한림], kma, Map{한림 → {attempt:2, reasons:['place:하저리해수욕장 — 그 지명은 입력에 없다']}}) → stations[0].retry_feedback
 * @param {object[]} inputs - stationInput 결과들 @param {object|null} kma - {title,publishTime,forecastPeriod,excerpt:{해상,강풍,너울,바다안개}} @param {Map|null} [feedback] - 관할 id → {attempt, reasons}
 * @returns {object} [연계] ← generate / → buildPrompt
 */
function batchInput(inputs, kma, feedback = null) {
    // AI 에게는 사람이 읽는 꼴만 보낸다(대조용 열쇠·사실 문장 목록은 서버 검증에만 쓴다).
    // retry_feedback(§11.10.4) = 지난 시도에서 이 관할 글이 버려진 이유(explainError 로 풀어 쓴 것) — 다시 시도할 때만.
    const strip = (si) => { const { allowed_number_keys: _a, allowed_multiplier_keys: _b, fact_sentences: _c, count_keys: _d, fact_terms: _e, ...rest } = si; const fb = feedback && feedback.get(si.id); return fb ? { ...rest, retry_feedback: fb } : rest; };
    return {
        schema: SCHEMA, stations: inputs.map(strip), kma_outlook: kma || null,
        rules: { sentences_per_paragraph: [MIN_S, MAX_S], max_chars: MAX_CHARS, last_sentence: '따라서 … 필요합니다.', forbidden: FORBIDDEN.concat(['안전합니다', '이상 없음', '문제없음', '평온합니다·위험하지 않습니다·위험이 낮습니다·안심(결론과 다른 단정)', '출항하지 마십시오·출항 금지(지시)', "해상 '사고 N배'", '한글 수사(세 시·두 척 등 — 곳·개를 세는 말은 그 수가 allowed_numbers 에 있을 때만)', 'HTML·링크']), level_words: ['관심 필요', '주의 필요', '경계 필요'] },
    };
}
/** AI 지시문 + 묶음 JSON — 분석 문단 3~5문장(§11.10.4)·예시 두 개·규칙·다시 시도 이유(retry_feedback). 예: buildPrompt(batch) → '너는 …\n\n{"schema":…}'. @param {object} batch @returns {string} [연계] ← generate */
function buildPrompt(batch) {
    return [
        '너는 해양 안전 「연안 안전 브리핑」의 분석 문단 작성자다. 화면에는 관할마다 서버가 만든 결론 한 줄(「오늘 ○○파출소 관할 연안(해상)의 단계는 "주의 필요"입니다.」)이 있고, 그 바로 아래에 네 분석 문단이 놓인다. 근거 목록·권고(각 관할의 shown)는 그 아래 접힌 「분석 근거」 칸에 있다.',
        '아래 JSON 의 stations 마다 연안 분석(land)과 해상 분석(sea)을 쓴다. 각 분석은 3~5문장의 한 문단이다.',
        '내용: 어느 장소(관광지·해역)가 어떤 단계인지, 왜 그런지(원인 — 연안 위험지수·방문객·행사·너울·이안류·바람·파도·특보·혼잡·과거 사고 이력)와 시간 흐름(언제부터 언제까지, 언제 나아지는지)을 쉬운 말로 잇고, 마지막 문장은 「따라서 …에 주의가(관심이·경계가) 필요합니다.」 꼴로 끝낸다.',
        '예보·예측에서 온 값(방문객 배수·연안 위험지수·해구 파고·풍속·너울·해양사고 위험예보·혼잡 예보)은 「방문객이 평소의 2배로 예상」처럼 예상임을 자연스럽게 밝힌다.',
        '연안 예시: 「돝섬해상유원지는 연안 위험지수 \'높음\'으로 주의 필요 수준이고, 방문객이 평소의 2배로 예상됩니다. 위험구역과 과거 익수·표류 사고 이력이 있어 사람이 늘어나는 오늘은 연안 상황 변화에 유의해야 합니다. 마산로봇랜드와 실리도는 관심 필요 수준이며, 실리도에는 과거 연안사고 이력이 있습니다. 따라서 돝섬해상유원지에는 주의가, 마산로봇랜드와 실리도에는 관심이 필요합니다.」',
        '해상 예시: 「대해구 5099 예보의 최대 파고는 0.4m, 풍속은 6.9m/s로 기준보다 낮을 것으로 예상됩니다. 다만 오늘 오후부터 바람이 강해지고 물결이 높아질 수 있다는 기상 전망이 있어 해상 상황의 변화를 살펴야 합니다. 따라서 마산파출소 관할 해상의 바람과 물결 변화에 관심이 필요합니다.」 (예시의 지명·숫자는 꼴만 보인 것 — 실제로는 그 관할의 입력에 있는 것만 쓴다.)',
        'shown 의 결론 문장을 그대로 되풀이하지 않는다. shown.weather 의 숫자는(오전·오후 예보·특이사항) allowed_numbers 에 없으면 옮기지 않는다 — 흐름(「오후부터 바람이 강해질 수 있다」)만 말로 쓴다.',
        '규칙(어기면 그 관할 글은 버려진다):',
        '0) 각 분석은 ' + MAX_CHARS + '자 이내, 3~5문장, 마지막 문장은 「따라서」로 시작해 「필요합니다.」로 끝난다.',
        '1) 숫자는 단위까지 그 관할의 allowed_numbers 에 있는 꼴로만 쓴다(예: 「2.4m」·「15~18시」·「06:12」). 새 숫자·비율·범위를 만들지 않는다. 숫자는 아라비아 숫자로 쓴다 — 한글 수사(세 시·두 척·서른 미터)는 쓰지 않는다. 다만 「두 곳」·「세 개」처럼 곳·개를 세는 말은 그 수가 allowed_numbers 에 「2곳」·「3개」 꼴로 있고 그 분석(연안·해상)의 shown 결론·근거·권고에도 그 수가 있을 때만 쓸 수 있다.',
        '2) 지명(항·포구·해수욕장·앞바다·해구·섬·갯바위·파출소 등)은 allowed_places 이름(또는 place_stems), 그리고 그 관할의 kma_zones 에 있는 기상청 해역 이름(「제주도남쪽바깥먼바다」 등)만 그대로 쓴다.',
        '3) 단계 말(관심·주의·경계 + 필요·요구·단계·수준·하십시오 등 모든 꼴, 「A에는 주의가, B에는 관심이 필요합니다」의 「주의가,」도)은 levels.sea(해상 분석)·levels.land(연안 분석)에 적힌 그 대상의 단계보다 높이지 않는다. 단계 말 바로 앞(같은 문장, 쉼표로 나뉜 같은 대목)에 대상 이름을 쓴다 — 이름이 없으면 그 분석의 결론 단계(shown 결론 문장의 단계)까지만. 낮추지도 않는다: 마지막 「따라서」 문장의 단계 말(여럿이면 가장 높은 것)과 문단에서 가장 높은 단계 말은 그 분석의 결론 단계와 같아야 한다(결론이 「평소 수준」이면 「평소처럼 관심이 필요합니다」). 따옴표로 쓰는 공식 단계 이름(\'주의\'·\'높음\' 등)은 allowed_labels 에 있는 것만.',
        '4) 확인하지 못한 자료(missing_sources)가 있으면 그 자료가 빠졌는데 「평소 수준」·「없습니다」로 단정하지 않는다.',
        '5) 쓰지 않는 말: 순찰·배치·출동·단속·통제·투입·경비정·검문·근무(직무 지시), 「안전합니다」·「이상 없음」·「문제없음」·「위험 요소가 없습니다」(안전 단정), 「평온합니다」·「위험하지 않습니다」·「위험이 낮습니다」·「안심하고」(화면 결론과 다른 단정 — 시간 흐름의 「오전에는 잔잔하지만 오후부터 …」는 된다), 「출항하지 마십시오」·「출항 금지」(지시), 「사고 확률」. 「두세 곳」「세 군데」 같은 어림 수사도 쓰지 않는다. 배수(N배)는 allowed_multipliers.sea(해상)·land(연안)에 있는 것만 — 해상의 「사고 N배」·「두 배」는 쓰지 않는다. 지시(「~하라」)를 쓰지 않는다.',
        '6) land 가 null 인 관할(해상만 제공)은 land 를 null 로 둔다.',
        '7) kma_outlook 은 기상청 해상 기상 전망 원문 발췌다 — 원인(저기압·바람 방향 등)과 흐름을 이해하는 데 쓰고, 그 안의 숫자는 옮기지 않는다(해역 이름은 2)의 kma_zones 에 있는 것만).',
        '8) 입력에 없는 사실을 지어내지 않는다 — 「경보」·「태풍」·「사망」·「사망자」·「임박」·「대규모」·「아무 일도 없」·「반드시 사고」 같은 말은 그 관할 입력에 같은 말이 있을 때만 쓴다(「풍랑주의보」를 「풍랑경보」로 쓰지 않는다). 글은 평문만 — HTML 태그·링크(URL)·마크다운을 쓰지 않는다.',
        '9) retry_feedback 이 있는 관할은 지난 시도의 글이 reasons 의 이유로 버려졌다 — 그 이유를 모두 고쳐 다시 쓴다(같은 지명·숫자·단계 말을 다시 쓰지 않는다).',
        '응답은 JSON 하나만: {"stations":[{"id":"<입력 id 그대로>","land":"…"|null,"sea":"…"}]}',
        '',
        JSON.stringify(batch),
    ].join('\n');
}
/**
 * AI 응답 글에서 관할별 해설(land·sea)을 꺼낸다(앞뒤 ``` 표시 허용). 모양이 틀리면 throw.
 * 예: '{"stations":[{"id":"a","land":null,"sea":"…"}]}' → Map{'a' → {land:null,sea:'…'}}
 * @param {string} text @returns {Map<string,object>} [연계] ← generate
 */
function parseResponse(text) {
    const m = String(text || '').trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i), body = m ? m[1] : String(text || '').trim();
    const j = JSON.parse(body);
    if (!j || !Array.isArray(j.stations)) throw new Error('invalid response');
    const out = new Map();
    for (const s of j.stations) if (s && typeof s.id === 'string' && !out.has(s.id)) out.set(s.id, { land: typeof s.land === 'string' ? s.land.trim() : null, sea: typeof s.sea === 'string' ? s.sea.trim() : '' });
    return out;
}
/**
 * 관할 하나의 AI 해설(육상·해상 각 1~2문장 — §11.10)을 입력과 대조한다(부록 A 검증 순서 + 독립 검토 B1~B6·B13). 하나라도 어기면 ok:false 와 이유 목록. 모든 대조는 NFKC 정규화한 글로.
 *   모양(해설 문장 수 1~2, 해상만 관할은 land 없음) · HTML·링크 금지 · 숫자(「숫자+단위」·범위째 allowed_number_keys)
 *   · 한글 수사 금지(곳·개를 세는 「두 곳」은 같은 단위의 그 수가 허용 숫자에 있을 때만 — 2026-10-17)
 *   · N배(문단별 allowed_multiplier_keys — 해상 「사고 N배」·「두 배」 금지) · 지명(allowed_places·기상청 해역 이름·「제주도」가 후보 끝에 오거나 place_stems 와 같을 때만)
 *   · 단계 말(모든 서술 꼴 — 대목 속 대상의 문단별 단계를 넘으면 실패, 대상 없는 대목은 문단 결론 단계까지 `level-para:`, 「관심」은 늘 허용, 서버 사실 문장 그대로는 제외)
 *   · 단계 아래쪽(§11.10.5 독립 검토 1a — 결론 단계가 관심 이상이면 마지막 「따라서」 문장의 가장 높은 단계 말 `level-last:`·문단의 가장 높은 단계 말 `level-max:` 이 결론 단계와 같아야 한다.
 *     결론이 「평소 수준」·「확인 불가」(단계 0)면 아래쪽 검사 없음 — 「평소처럼 관심」 등 관심까지)
 *   · 입력에 없는 말(FACT_WORDS — 그 관할 fact_terms 에 없으면 `fact:`)
 *   · 금지어(공백·제로폭 무시) · 안전 단정. 필수 포함(required — 첫 해역·첫 장소·빠진 자료 이름) 검사는 없앴다(§11.10 — 서버 결론·근거가 늘 보인다).
 * 예: validateOverview({land:null, sea:'…한림항 순찰…'}, si) → {ok:false, errors:['forbidden:순찰']}
 * @param {object} o - {land,sea} @param {object} si - stationInput @returns {object} {ok,errors}
 * [연계] ← generate · 시험
 */
function validateOverview(o, si) {
    const errors = [], allowedN = new Set(si.allowed_number_keys || []), mk = si.allowed_multiplier_keys || { sea: [], land: [] };
    // 허용 지명은 끝말 일치(「한림 협재해수욕장」 같은 앞 낱말 붙은 후보), 기상청 해역 이름은 그 관할 kma_zones 와 정확히 같을 때만(독립 검토 8).
    const names = (si.allowed_places || []).map(compact).filter((x) => x.length >= 2), kz = new Set((si.kma_zones || []).map(compact)), stems = new Set((si.place_stems || []).map(compact));
    const factS = (si.fact_sentences || []).map(compact).filter(Boolean);
    const paras = [['sea', o?.sea], ['land', o?.land]];
    if (!si.land && o?.land) errors.push('shape:land-not-allowed');
    if (si.land && !o?.land) errors.push('shape:land-missing');
    if (!o?.sea) errors.push('shape:sea-missing');
    for (const [k, raw] of paras) {
        if (!raw) continue;
        const t = norm(raw), c = compact(raw), ss = sentences(t);
        if (ss.length < MIN_S || ss.length > MAX_S) errors.push('shape:' + k + '-sentences-' + ss.length);
        if (t.length > MAX_CHARS) errors.push('shape:' + k + '-too-long-' + t.length);
        // 마지막 문장 「따라서 … 필요합니다.」(§11.10.4 — 화면 결론 아래 문단이 권고로 끝나게)
        const last = compact(ss[ss.length - 1] || '');
        if (!/^따라서/.test(last) || !/필요합니다[.!]?$/.test(last)) errors.push('shape:' + k + '-no-conclusion');
        if (/[<>]|https?:|www\.|javascript:|&[a-z]+;|\]\(/i.test(t)) errors.push('markup');
        const multSet = new Set(mk[k] || []);
        for (const n of numTokens(t)) {
            if (n.unit === '배') { if (!multSet.has(n.key)) errors.push('multiplier:' + n.text); continue; }
            if (!allowedN.has(n.key)) errors.push('number:' + n.text);
        }
        const paraCount = si.count_keys ? new Set(si.count_keys[k] || []) : allowedN;   // 셈말은 그 문단 결론·근거에 있는 수만(독립 검토 7)
        for (const m of t.matchAll(HNUM_RE)) { const w = m[1].replace(/\s+/g, ' '); if (!countWordOk(w, allowedN, paraCount)) errors.push('number:hangul:' + w); }
        for (const m of t.matchAll(HMULT_RE)) errors.push('multiplier:' + m[1].replace(/\s+/g, ' '));
        for (const pc of placeCandidates(t)) if (!pc.cands.some((x) => stems.has(x) || kz.has(x) || names.some((a) => x.endsWith(a)))) errors.push('place:' + pc.cands[pc.cands.length - 1]);
        for (const w of FORBIDDEN) if (c.includes(compact(w))) errors.push('forbidden:' + w);
        for (const lm of t.matchAll(LABEL_RE)) if (!(si.allowed_labels || []).includes(lm[0])) errors.push('label:' + lm[0]);
        if (SAFE_RE.test(c)) errors.push('forbidden:안전 단정');
        if (SOFTEN_RE.test(c) || ss.some((x) => CALM_RE.test(compact(x)) && !CHANGE_RE.test(compact(x)))) errors.push('forbidden:결론과 다른 단정');
        if (ORDER_RE.test(c)) errors.push('forbidden:출항 지시');
        for (const [w, re] of FACT_WORDS) if (re.test(c) && !(si.fact_terms || []).includes(w)) errors.push('fact:' + w);
        // 단계 말 검사. head = 그 문단 결론 단계(관할 이름의 단계 — 화면 결론 「… 단계는 "주의 필요"」와 같은 값).
        const lv = (si.levels && si.levels[k]) || {}, head = Number.isFinite(lv[si.name]) ? lv[si.name] : Math.max(0, ...Object.values(lv));
        const namedIn = (x) => { const cx = compact(x); return Object.entries(lv).filter(([name]) => cx.includes(compact(name))).map(([, r]) => r); };
        let paraMax = 0, lastMax = 0;
        ss.forEach((s, si2) => {
            const cs = compact(s);
            if (cs.length >= 12 && factS.some((f) => f.includes(cs))) return;   // 서버 사실 문장(조석·해제 안내)을 그대로 옮긴 것
            const named = namedIn(s), cap = Math.max(1, named.length ? Math.max(...named) : head);
            // 단계 말마다 대상 대목: ①앞 쉼표(또는 앞 단계 말 끝) ~ 그 단계 말 ②없으면 그 단계 말 ~ 다음 쉼표(또는 다음 단계 말) ③없으면 문장 전체 — 「A에는 주의가, B에는 관심이」·「A에는 주의가 B에는 관심이」
            const all = [...s.matchAll(LEVEL_RE)].map((m) => ({ w: m[1], i: m.index, e: m.index + m[0].length })).concat(NEED_RE.test(s) ? [...s.matchAll(LEVEL_LIST_RE)].map((m) => ({ w: m[1], i: m.index, e: m.index + m[0].length })) : []);
            const hits = [...new Map(all.sort((a, b) => a.i - b.i || b.e - a.e).map((h) => [h.i, h])).values()];
            hits.forEach((h, j) => {
                const comma = Math.max(s.lastIndexOf(',', h.i), s.lastIndexOf('，', h.i)) + 1, a = Math.max(comma, j ? hits[j - 1].e : 0);
                const z0 = s.slice(h.e).search(/[,，]/), z = Math.min(z0 < 0 ? s.length : h.e + z0, hits[j + 1] ? hits[j + 1].i : s.length);
                const before = namedIn(s.slice(a, h.e)), after = before.length ? [] : namedIn(s.slice(h.e, z)), cn = before.length ? before : after;
                const c2 = cn.length ? Math.max(1, ...cn) : cap;
                if (LEVEL_RANK[h.w] > c2) errors.push((cn.length || named.length ? 'level:' : 'level-para:') + h.w + '>' + c2);
                paraMax = Math.max(paraMax, LEVEL_RANK[h.w]); if (si2 === ss.length - 1) lastMax = Math.max(lastMax, LEVEL_RANK[h.w]);
            });
        });
        // 아래쪽(§11.10.5 독립 검토 1a): 결론이 관심 이상이면 마지막 「따라서」 문장·문단의 가장 높은 단계 말이 결론 단계와 같아야 한다(「주의」 결론인데 「관심이 필요합니다」로 끝내면 실패).
        if (head >= 1) {
            if (lastMax !== head) errors.push('level-last:' + LEVEL_WORD[lastMax] + '≠' + head);
            else if (paraMax !== head) errors.push('level-max:' + LEVEL_WORD[paraMax] + '≠' + head);
        }
    }
    return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

/**
 * 곳·개를 세는 한글 수사가 허용 숫자와 맞는지(2026-10-17 결정). 「군데」는 곳으로 센다. 어림 수사(두세·서너…)는 표에 없어 늘 거짓(독립 검토 7).
 * 예: ('두 곳', Set{'2|곳'}, Set{'2|곳'}) → true · ('세 곳', Set{'2|곳'}) → false · ('세 군데', Set{'3|곳'}, Set{'3|곳'}) → true · ('두세 곳', …) → false · ('두 척', …) → false(곳·개만)
 * @param {string} w - HNUM_RE 가 잡은 글(공백 하나로 정리) @param {Set<string>} allowedN - allowed_number_keys @param {Set<string>} [para] - 그 문단 count_keys(없으면 allowedN) @returns {boolean} [연계] ← validateOverview
 */
function countWordOk(w, allowedN, para = allowedN) { const m = /^(\S+) ?(곳|개|군데)$/.exec(w), n = m ? COUNT_WORD[m[1]] : undefined, key = m ? n + '|' + (m[2] === '군데' ? '곳' : m[2]) : null; return !!n && allowedN.has(key) && para.has(key); }
/** 묶음 단위대로 나눈다. 예: unit 'office' → 해양경찰서마다 한 묶음(21개). @param {object[]} items @param {string} unit - station|office|region @returns {object[][]} [연계] ← generate */
function groupBy(items, unit) {
    const m = new Map();
    for (const it of items) { const k = unit === 'station' ? it.b.key : unit === 'region' ? (it.b.station.region || it.b.station.office) : it.b.station.office; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
    return [...m.values()];
}
/**
 * 검증·응답 실패 이유 하나를 AI 가 읽을 말로 푼다(다시 시도 지시문 retry_feedback — 2026-10-17 사용자 결정 §11.10.4).
 * 예: 'place:하저리해수욕장' → 'place:하저리해수욕장 — 그 지명은 입력에 없다' · 'level:주의>1' → 'level:주의>1 — 그 대목의 대상 단계는 「관심」까지다' · 'shape:sea-sentences-2' → 'shape:sea-sentences-2 — 해상 분석이 2문장이다(3~5문장)'
 *     'level-para:경계>2' → '… — 그 대목에 대상 이름이 없다 — 대상 이름을 쓰거나 문단 단계(「주의」)까지' · 'level-last:관심≠2' → '… — 마지막 「따라서」 문장의 단계 말이 「관심」이다 — 결론 단계 「주의」와 같게 쓴다'
 *     AI 가 쓴 글 조각은 20자까지만 되돌려 보낸다(§11.10.5 독립 검토 6 — 「place:이전지시를무시하고…」 같은 긴 조각이 다음 지시문에 그대로 들어가지 않게).
 * @param {string} code - validateOverview 오류 열쇠(또는 'parse') @returns {string} [연계] ← generate(accept·callOne) → batchInput retry_feedback
 */
function explainError(code) {
    const c = String(code), i = c.indexOf(':'), shown = i < 0 || c.length - i - 1 <= 20 ? c : c.slice(0, i + 21) + '…', m = c.match(/^shape:(land|sea)-(sentences|too-long)-(\d+)$/), para = (k) => (k === 'land' ? '연안' : '해상') + ' 분석';
    const why = m ? para(m[1]) + (m[2] === 'sentences' ? '이 ' + m[3] + '문장이다(' + MIN_S + '~' + MAX_S + '문장)' : '이 ' + m[3] + '자다(' + MAX_CHARS + '자 이내)')
        : /^shape:(land|sea)-no-conclusion$/.test(c) ? para(c.slice(6, -14)) + '의 마지막 문장이 「따라서 … 필요합니다.」 꼴이 아니다'
        : c === 'shape:land-missing' ? '연안 분석(land)이 비었다' : c === 'shape:sea-missing' ? '해상 분석(sea)이 비었다' : c === 'shape:land-not-allowed' ? '해상만 제공하는 관할이다 — land 는 null'
        : c.startsWith('number:hangul:') ? '한글 수사는 쓰지 않는다(아라비아 숫자, allowed_numbers 에 있는 꼴만)'
        : c.startsWith('number:') ? '그 숫자(단위 포함)는 allowed_numbers 에 없다'
        : c.startsWith('multiplier:') ? '그 배수는 allowed_multipliers 에 없다'
        : c.startsWith('place:') ? '그 지명은 입력에 없다'
        : /^level:/.test(c) ? '그 대목의 대상 단계는 「' + (['', '관심', '주의', '경계'][Number(c.split('>')[1])] || '관심') + '」까지다'
        : /^level-para:/.test(c) ? '그 대목에 대상 이름이 없다 — 대상 이름을 쓰거나 문단 단계(「' + (['', '관심', '주의', '경계'][Number(c.split('>')[1])] || '관심') + '」)까지'
        : /^level-(?:last|max):/.test(c) ? (c.startsWith('level-last:') ? '마지막 「따라서」 문장' : '문단') + '의 가장 높은 단계 말이 「' + c.slice(c.indexOf(':') + 1, c.indexOf('≠')) + '」이다 — 결론 단계 「' + (['', '관심', '주의', '경계'][Number(c.split('≠')[1])] || '관심') + '」와 같게 쓴다'
        : c.startsWith('fact:') ? '그 말은 이 관할 입력에 없다 — 입력에 없는 사실·과장을 쓰지 않는다'
        : c.startsWith('label:') ? '따옴표 단계 이름은 allowed_labels 에 있는 것만 쓴다'
        : c.startsWith('forbidden:') ? '쓰지 않는 말이다'
        : c === 'markup' ? 'HTML·링크·마크다운을 썼다'
        : c === 'missing:station' ? '응답에 이 관할(id)이 없었다'
        : c === 'parse' ? '응답이 정해진 JSON 꼴이 아니었다' : '규칙에 어긋났다';
    return shown + ' — ' + why;
}
// 호출 시간 제한 기본값(B7) — VM 은 codex_bridge 자체 300초 뒤 조금 더, Gemini 는 어댑터 90초 뒤 조금 더(어댑터가 먼저 끊는다). VM 이 이 횟수만큼 잇달아 실패하면 그 실행 동안 VM 을 건너뛴다.
const DEFAULT_TIMEOUTS = Object.freeze({ vm: 320000, gemini: 100000 }), VM_FAIL_LIMIT = 3;
/**
 * 관할 브리핑들의 AI 분석 문단을 만든다(AI 또는 규칙 분석). 재사용 → 해양경찰서 묶음마다 다시 시도 사슬 → 규칙 분석.
 * 다시 시도(2026-10-17 사용자 *"vm 최대 3번 후 제미나이로 가자."* — 설계서 §11.10.4):
 *   ① VM(그 묶음 전부) → 검증·호출·해석에 떨어진 관할만 VM 으로 다시(지시문에 버려진 이유 retry_feedback) — 관할마다 VM 최대 vmAttempts(3)번
 *   ② 그래도 실패면 Gemini 한 번(같은 이유 포함) — VM 이 꺼져 있거나 차단기로 VM 을 한 번도 못 부른 관할은 Gemini 두 번(종전 「VM 꺼짐 → Gemini → 실패 관할 1회 재시도」와 같은 횟수)
 *   ③ 그래도 실패면 규칙 분석(source 'template' — 글은 서버 summary.analysis, 화면 「규칙 분석」). 방식 'gemini' 는 Gemini 두 번 → 규칙 분석.
 *   순서(§11.10.5 독립 검토 3): 한 바퀴마다 모든 묶음이 한 걸음씩(모든 묶음 첫 시도 → 떨어진 관할 2번째 → 3번째 → Gemini) — 데드라인에 뒤쪽 묶음이 굶지 않게.
 *   시도마다 오류를 errors 에 attempt(몇 번째)와 함께 남긴다. VM 연속 실패 차단기(vmFailLimit — 호출·시간초과·해석 실패가 잇달아 3번이면 그 실행 동안 VM 건너뜀)·데드라인(deadline — 넘으면 남은 관할은 규칙 분석)은 종전 그대로.
 * 재사용(B10): 해시 = 관할 입력 + 규칙·검증·지시문 판 + 방식 + 모델(ChatGPT·Gemini 둘 다 — VM 이 꺼지면 Gemini 로 가므로) + 기상청 전망.
 *   같은 해시라도 지난 글의 출처가 고른 방식의 첫 공급자가 아니면(ChatGPT 방식인데 Gemini 가 쓴 글) VM 이 지금 살아 있으면 다시 만든다.
 * 예: await generate({briefings:[…97], config:{method:'chatgpt',chatgptModel:'gpt-6-luna',geminiModel:'gemini-2.5-flash',batchUnit:'office',onlyChanged:true}, previous, adapters, kma})
 *     → {overviews:{key:{land,sea,source:'chatgpt'|'gemini'|'template',model,hash,attempts,reused?}}, stats:{calls,reused,ai,template,retried,deadline,gemini}, errors:[{…,attempt}]}
 * @param {object} o - briefings·config·previous(key→지난 브리핑)·adapters{vm,gemini}·kma·now·timer·deadline·timeouts·vmFailLimit·vmAttempts
 * @returns {Promise<object>} [연계] ← station_briefing.run / → stationInput·batchInput·buildPrompt·parseResponse·validateOverview·explainError
 */
async function generate({ briefings, config, previous = {}, adapters = {}, kma = null, now = Date.now(), timer = Date.now, deadline = Infinity, timeouts = DEFAULT_TIMEOUTS, vmFailLimit = VM_FAIL_LIMIT, vmAttempts = VM_ATTEMPTS }) {
    const method = config.method || 'template', overviews = {}, errors = [], stats = { calls: 0, reused: 0, ai: 0, template: 0, retried: 0, deadline: 0, gemini: 0 };
    const at = R.isoKst(now), preferred = method === 'chatgpt' ? 'chatgpt' : 'gemini';
    const up = (a) => !!a && (typeof a.available !== 'function' || a.available());
    let vmFails = 0, vmBroken = false;
    const vmUp = method === 'chatgpt' && up(adapters.vm);
    const items = briefings.map((b) => { const si = stationInput(b, kma); return { b, si, hash: R.hash({ si, rules: R.RULES_VERSION, validator: VALIDATOR_VERSION, prompt: PROMPT_VERSION, method, chatgptModel: method === 'chatgpt' ? config.chatgptModel : null, geminiModel: method !== 'template' ? config.geminiModel : null, kma: kma ? R.hash(kma) : null }) }; });
    // AI 가 못 쓰면(틀 방식·실패·데드라인) AI 분석 없음 — 화면은 서버 규칙 분석 문단(summary.analysis)을 「규칙 분석」으로 보인다(§11.10.4).
    const template = (it) => { overviews[it.b.key] = { land: null, sea: null, source: 'template', model: null, hash: it.hash }; stats.template++; };
    const pending = [];
    for (const it of items) {
        const prev = previous[it.b.key]?.overview;
        if (method === 'template') { template(it); continue; }
        const sameSource = prev && (prev.source === preferred || (prev.source === 'gemini' && method === 'chatgpt' && !vmUp));
        if (config.onlyChanged !== false && prev && prev.hash === it.hash && sameSource) { overviews[it.b.key] = { ...prev, reused: true }; stats.reused++; continue; }
        pending.push(it);
    }
    const feedback = new Map(), retried = new Set();
    /**
     * 공급자 하나로 한 번 부른다(그 묶음의 남은 관할). 꺼짐·차단이면 {skip}, 데드라인이 지났으면 {late}, 호출·해석 실패면 {res:null}(시도로 셈), 성공이면 {res}.
     * @param {string} p - vm|gemini @param {object[]} group @param {number} attempt - 몇 번째 시도 @returns {Promise<object>}
     */
    async function callOne(p, group, attempt) {
        const keys = group.map((it) => it.b.key), a = adapters[p];
        if (p === 'vm' && vmBroken) { errors.push({ at, stage: 'call', provider: p, stations: keys, attempt, reason: 'VM 연속 실패 ' + vmFails + '회 — 이번 실행은 건너뜀' }); return { skip: true }; }
        if (!up(a)) { errors.push({ at, stage: 'call', provider: p, stations: keys, attempt, reason: p === 'vm' ? 'VM 작업자 연결 없음' : '사용 불가' }); return { skip: true }; }
        const left = deadline - timer();
        if (left <= 0) return { late: true };
        const fb = new Map(group.filter((it) => feedback.has(it.b.key)).map((it) => [it.b.key, { attempt, reasons: feedback.get(it.b.key) }]));
        const prompt = buildPrompt(batchInput(group.map((it) => it.si), kma, fb.size ? fb : null));
        const model = p === 'vm' ? config.chatgptModel : config.geminiModel, ms = Math.max(1, Math.min(timeouts[p] || DEFAULT_TIMEOUTS.gemini, left)), ac = new AbortController();
        let tid = null, timedOut = false;
        try {
            stats.calls++; if (p === 'gemini') stats.gemini++;
            const text = await Promise.race([a.call({ prompt, model, signal: ac.signal }), new Promise((_, rej) => { tid = setTimeout(() => { timedOut = true; ac.abort(); rej(new Error(p + ' 시간초과(' + Math.round(ms / 1000) + '초)')); }, ms); })]);
            const map = parseResponse(text);
            if (p === 'vm') vmFails = 0;
            return { res: { provider: p === 'vm' ? 'chatgpt' : 'gemini', model, map } };
        } catch (e) {
            const parse = e.message === 'invalid response' || e instanceof SyntaxError;
            errors.push({ at, stage: parse ? 'parse' : 'call', provider: p, stations: keys, attempt, reason: String(e.message || e).slice(0, 120) });
            if (parse) for (const k of keys) feedback.set(k, [explainError('parse')]);
            // 데드라인까지 남은 시간이 1초도 안 돼(설정한 호출 시간 제한보다 짧게) 끊긴 시간초과는 VM 고장이 아니다 — 차단기에 세지 않는다(§11.10.5 독립 검토 7).
            const budgetCut = timedOut && ms < 1000 && left < (timeouts[p] || DEFAULT_TIMEOUTS.gemini);
            if (p === 'vm' && !budgetCut && ++vmFails >= vmFailLimit) vmBroken = true;
            return { res: null };
        } finally { clearTimeout(tid); }
    }
    /** 한 번 결과를 관할별로 검증해 통과는 받아들이고 실패 목록을 돌려준다(실패 이유는 다음 시도 retry_feedback 으로). @returns {object[]} 실패 항목 */
    function accept(group, res, attempt) {
        const failed = [];
        for (const it of group) {
            if (!res) { failed.push(it); continue; }
            const o = res.map.get(it.b.key), v = o ? validateOverview(o, it.si) : { ok: false, errors: ['missing:station'] };
            if (v.ok) { overviews[it.b.key] = { land: o.land || null, sea: o.sea, source: res.provider, model: res.model, hash: it.hash, attempts: attempt }; stats.ai++; feedback.delete(it.b.key); }
            else { errors.push({ at, stage: 'validate', provider: res.provider, stations: [it.b.key], attempt, reason: v.errors.slice(0, 6).join(',') }); feedback.set(it.b.key, v.errors.slice(0, 8).map(explainError)); failed.push(it); }
        }
        return failed;
    }
    const past = () => timer() >= deadline;
    // 묶음마다 상태 — 시도 사슬(VM 최대 vmAttempts 번 → Gemini 1번, VM 을 한 번도 못 불렀으면 Gemini 2번)은 종전 그대로.
    // 순서만 바꿨다(§11.10.5 독립 검토 3): 종전엔 앞 묶음이 다시 시도를 다 쓴 뒤에야 다음 묶음의 첫 시도를 해, 데드라인에 뒤쪽 해양경찰서들이 첫 시도도 못 하고 규칙 분석이 됐다.
    // 이제 한 바퀴마다 모든 묶음이 한 걸음씩 — ①모든 묶음 첫 시도 ②떨어진 관할 2번째 ③3번째 ④Gemini … (묶음 안의 시도 번호·통계·차단기는 같다).
    const states = groupBy(pending, config.batchUnit || 'office').map((g) => ({ left: g, attempt: 0, vmTried: false, late: false, p: method === 'chatgpt' ? 'vm' : 'gemini', n: method === 'chatgpt' ? vmAttempts : 2 }));
    /** 묶음 g 를 한 걸음(호출 한 번) 진행한다. 공급자를 건너뛰면(꺼짐·차단) 같은 걸음에서 다음 공급자로. @param {object} g @returns {Promise<void>} */
    const step = async (g) => {
        while (g.p !== 'done') {
            if (!g.left.length) { g.p = 'done'; return; }
            if (g.n <= 0) { if (g.p === 'vm') { g.p = 'gemini'; g.n = g.vmTried ? 1 : 2; continue; } g.p = 'done'; return; }
            if (past()) { g.late = true; g.p = 'done'; return; }
            const r = await callOne(g.p, g.left, g.attempt + 1);
            if (r.late) { g.late = true; g.p = 'done'; return; }
            if (r.skip) { g.n = 0; continue; }
            g.n--; g.attempt++; if (g.p === 'vm') g.vmTried = true;
            if (g.attempt > 1) for (const it of g.left) retried.add(it.b.key);
            g.left = accept(g.left, r.res, g.attempt);
            return;
        }
    };
    while (states.some((g) => g.p !== 'done')) for (const g of states) if (g.p !== 'done') await step(g);
    // 데드라인 때문에 시도가 남은 채 멈춘 관할만 deadline 으로 센다. 시도를 다 쓰고 실패한 관할은 마지막 시도 뒤 시계가 데드라인을 넘었어도 규칙 분석(template)만(§11.10.5 독립 검토 8).
    const lateKeys = states.filter((g) => g.late && g.left.length).flatMap((g) => g.left.map((it) => it.b.key));
    if (lateKeys.length) { errors.push({ at, stage: 'deadline', provider: null, stations: lateKeys, reason: '실행 데드라인 넘음 — ' + lateKeys.length + '곳은 규칙 분석(AI 분석 없음)' }); stats.deadline += lateKeys.length; }
    for (const g of states) for (const it of g.left) template(it);
    stats.retried = retried.size;
    return { overviews, stats, errors };
}

module.exports = { SCHEMA, VALIDATOR_VERSION, PROMPT_VERSION, FORBIDDEN, KMA_ZONE_NAMES, MIN_S, MAX_S, MAX_CHARS, VM_ATTEMPTS, DEFAULT_TIMEOUTS, VM_FAIL_LIMIT, explainError, stationInput, batchInput, buildPrompt, parseResponse, validateOverview, generate, numbers, numTokens, placeCandidates, sentences, groupBy, norm, compact };
