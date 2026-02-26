const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

const ZONE_GROUP_MAP = {
    // 전해상: 해당 해역의 모든 하위 해역 (앞바다 + 먼바다 전체)
    "동해중부전해상": ["강원북부앞바다", "강원중부앞바다", "강원남부앞바다", "동해중부안쪽먼바다", "동해중부바깥먼바다"],
    "동해남부전해상": ["울산앞바다", "경북남부앞바다", "경북북부앞바다", "동해남부남쪽안쪽먼바다", "동해남부남쪽바깥먼바다", "동해남부북쪽안쪽먼바다", "동해남부북쪽바깥먼바다"],
    "서해중부전해상": ["인천·경기북부앞바다", "인천·경기남부앞바다", "충남북부앞바다", "충남남부앞바다", "서해중부안쪽먼바다", "서해중부바깥먼바다"],
    "서해남부전해상": ["전북북부앞바다", "전북남부앞바다", "전남북부서해앞바다", "전남중부서해앞바다", "전남남부서해앞바다", "서해남부북쪽안쪽먼바다", "서해남부북쪽바깥먼바다", "서해남부남쪽안쪽먼바다", "서해남부남쪽바깥먼바다"],
    "남해동부전해상": ["부산앞바다", "경남서부남해앞바다", "경남중부남해앞바다", "거제시동부앞바다", "남해동부안쪽먼바다", "남해동부바깥먼바다"],
    "남해서부전해상": ["전남서부남해앞바다", "전남동부남해앞바다", "남해서부서쪽먼바다", "남해서부동쪽먼바다"],
    "제주도전해상": ["제주도북부앞바다", "제주도동부앞바다", "제주도남부앞바다", "제주도서부앞바다", "제주도남쪽바깥먼바다", "제주도남동쪽안쪽먼바다", "제주도남서쪽안쪽먼바다"],
    // 앞바다/먼바다 그룹
    "동해남부앞바다": ["울산앞바다", "경북남부앞바다", "경북북부앞바다"],
    "동해남부먼바다": ["동해남부남쪽안쪽먼바다", "동해남부남쪽바깥먼바다", "동해남부북쪽안쪽먼바다", "동해남부북쪽바깥먼바다"],
    "동해중부앞바다": ["강원북부앞바다", "강원중부앞바다", "강원남부앞바다"],
    "동해중부먼바다": ["동해중부안쪽먼바다", "동해중부바깥먼바다"],
    "서해남부앞바다": ["전북북부앞바다", "전북남부앞바다", "전남북부서해앞바다", "전남중부서해앞바다", "전남남부서해앞바다"],
    "서해남부먼바다": ["서해남부북쪽안쪽먼바다", "서해남부북쪽바깥먼바다", "서해남부남쪽안쪽먼바다", "서해남부남쪽바깥먼바다"],
    "서해중부앞바다": ["인천·경기북부앞바다", "인천·경기남부앞바다", "충남북부앞바다", "충남남부앞바다"],
    "서해중부먼바다": ["서해중부안쪽먼바다", "서해중부바깥먼바다"],
    "남해동부앞바다": ["부산앞바다", "경남서부남해앞바다", "경남중부남해앞바다", "거제시동부앞바다"],
    "남해동부먼바다": ["남해동부안쪽먼바다", "남해동부바깥먼바다"],
    "남해서부앞바다": ["전남서부남해앞바다", "전남동부남해앞바다"],
    "남해서부먼바다": ["남해서부서쪽먼바다", "남해서부동쪽먼바다"],
    "제주도앞바다": ["제주도북부앞바다", "제주도동부앞바다", "제주도남부앞바다", "제주도서부앞바다"],
    "제주도먼바다": ["제주도남쪽바깥먼바다", "제주도남동쪽안쪽먼바다", "제주도남서쪽안쪽먼바다"]
};

const SYSTEM_INSTRUCTION = `
너는 대한민국 기상청 통보문 전문 분석가이다.
주어진 통보문 텍스트에서 '풍랑', '태풍', '지진해일', '폭풍해일' 관련 특보 상황을 추출하여 정형화된 JSON 배열로 반환해야 한다.

### 1. 해역 계층 구조 (ZONE_GROUP_MAP)
아래는 부모 해역과 그에 속한 자식 해역들의 목록이다:
${JSON.stringify(ZONE_GROUP_MAP, null, 2)}

### 2. 구역 추출 규칙 (매우 중요)
- **전해상 패턴**: 통보문에 "서해중부전해상", "제주도전해상" 등 "XX전해상"이라는 표현이 있으면, 이는 해당 해역의 **모든** 하위 해역(앞바다 + 먼바다 전체)에 특보가 적용된다는 의미이다. ZONE_GROUP_MAP에서 해당 "전해상" 키의 자식 해역 전체를 zones에 넣어라.
  예시: "서해중부전해상" → ZONE_GROUP_MAP["서해중부전해상"]의 모든 해역 추출
- **전체 포함**: 통보문에 부모 해역 이름(예: 제주도먼바다)만 있고 뒤에 괄호가 없다면, 해당 부모에 속한 모든 자식 해역을 리스트에 넣어라.
- **부분 제한 (한정)**: 부모 해역 뒤에 괄호가 있고 그 안에 특정 해역이 명시되어 있다면(예: 제주도먼바다(제주도남쪽바깥먼바다)), 오직 괄호 안에 명시된 해역들**만** 추출해라. 이는 "이 해역들만 해당"이라는 한정(限定) 의미이다.
  예시: "제주도앞바다(제주도동부앞바다)" → zones에는 오직 ["제주도동부앞바다"]만 넣어라. 절대로 나머지(북부, 남부, 서부)를 넣으면 안 된다.
- **복수 명시**: 괄호 안에 여러 해역이 콤마로 구분되어 있다면(예: 서해남부먼바다(서해남부북쪽안쪽먼바다, 서해남부북쪽바깥먼바다)), 그 해역들을 모두 추출해라.
- **"제외" 표현과의 구별 (매우 중요)**:
  - 괄호 안에 "제외"라는 단어가 **있는** 경우: 제외 대상이다. 예: "제주도(제주도동부 제외)" → 동부를 제외한 나머지.
  - 괄호 안에 "제외"라는 단어가 **없는** 경우: 한정(only) 대상이다. 예: "제주도앞바다(제주도동부앞바다)" → 동부**만** 해당.
  - 이 두 가지를 **절대 혼동하지 마라**. "제외"가 없으면 반드시 괄호 안 해역**만** 추출해야 한다.
- **육상 특보 구역 무시**: 강풍, 대설, 한파 등 육상 특보 항목에 등장하는 구역(예: 제주도(제주도동부 제외))은 해상 특보 해역 추출과 무관하다. 육상 특보의 "제외" 표현이 해상 특보의 괄호 해석에 영향을 주어서는 안 된다.
- **주의**: 해역 이름이 ZONE_GROUP_MAP에 존재하지 않는 육상 지역(예: 서해5도, 전라남도 등)은 무시하고, 해역만 추출해라.

### 3. 상태(command) 및 시각 추출 규칙
- **command 종류**: '발표', '발효', '해제', '예비', '변경', '보강', '연장' 중 하나로 분류한다.
- **예비특보 처리**: '예비특보'가 포함된 항목은 command를 반드시 '예비'로 설정한다.
- **tmEf (발효시각)**: 해당 특보가 효력을 발생하는(또는 발생 예정인) 시각이다.
  - 정확한 시각이 명시된 경우: 'YYYY년 MM월 DD일 HH시 mm분' 형식으로 추출한다.
    예시: "02월 15일 12시" → "2026년 02월 15일 12시 00분"
  - **시간 범위**가 주어진 경우(예: "오전(06시~12시)", "오후(12시~18시)", "밤(18시~24시)"): 범위를 그대로 보존하여 'YYYY년 MM월 DD일 오전(06시~12시)' 형식으로 추출한다.
    예시: "02월 15일 오전(06시~12시)" → "2026년 02월 15일 오전(06시~12시)"
  - '해제'의 경우 해제 시각을, '발효'나 '예비'의 경우 발효 예정 시각을 정확히 매칭해야 한다.
- **tmCc (해제시각/해제 예고)**: 해당 특보의 해제 시각 또는 해제 예고 시각이다.
  - □ 내용 섹션에 "○ 해제 예고:" 또는 "해제예고:"가 있으면, 그 뒤의 날짜·시간을 tmCc로 추출한다.
  - 이는 command가 '변경', '발효', '보강' 등 '해제'가 아닌 경우에도 동일하게 적용된다.
  - 형식은 tmEf와 동일하다 (범위형 포함).
    예시: "해제 예고: 23일 늦은 오후(15시~18시)" → tmCc = "2026년 02월 23일 늦은 오후(15시~18시)"
    예시: "해제 예고: 15일 밤(21시~24시)" → tmCc = "2026년 02월 15일 밤(21시~24시)"
  - 해제 예고가 없으면 빈 문자열("")로 설정한다.

### 4. 출력 형식
반드시 아래와 같은 JSON 배열 형식으로만 응답해야 한다. 추가적인 설명은 생략한다.
[
  {
    "type": "풍랑예비특보 | 풍랑주의보 | 풍랑경보 | 태풍예비특보 | 태풍주의보 | 태풍경보 | 지진해일주의보 | 지진해일경보 | 폭풍해일예비특보 | 폭풍해일주의보 | 폭풍해일경보",
    "command": "예비",
    "tmEf": "2024년 08월 30일 오전(06시~12시)",
    "zones": ["서해중부안쪽먼바다", "서해중부바깥먼바다"],
    "tmCc": ""
  }
]

### 5. 중요 참고사항
- 통보문에 '□ 내용' 섹션과 '< 참고사항 >' 섹션이 있을 수 있다. **반드시 '□ 내용' 섹션만 분석**하고 '< 참고사항 >'은 무시한다 (참고사항은 이전 통보문 대비 변경점이므로 중복).
- 해상 특보(풍랑, 태풍, 지진해일, 폭풍해일)만 추출한다. 강풍, 대설, 한파 등 육상 특보는 무시한다.
- 해역이 없는 항목(육상 지역만 언급된 항목)은 결과에 포함하지 않는다.

### 6. 이벤트 구분 블록 처리 (중요)
통보문이 "--- 이벤트 N/M ---" 형식의 구분자로 분리되어 제공될 수 있다.
이 경우:
- 각 "--- 이벤트 N/M ---" 블록은 **완전히 독립된 이벤트**이다.
- 각 블록의 □ 해당구역에 명시된 구역만 해당 이벤트의 zones에 포함하라.
- 다른 블록의 구역을 현재 블록에 절대 혼합하지 마라.
- 각 블록마다 하나의 JSON 객체를 생성하라.
- 총 M개의 블록이 있으면 반드시 M개의 JSON 객체가 반환되어야 한다.

### 7. 최종 검증 (반드시 수행)
JSON 배열을 출력하기 전에, 아래 검증을 반드시 수행하라:
- 각 항목의 zones에 포함된 모든 해역이 통보문 원문에 **실제로 명시**되어 있는지 원문과 1:1 대조하라.
- 부모 해역 뒤에 괄호가 있어 특정 해역만 명시된 경우(예: "서해중부앞바다(충남북부앞바다, 충남남부앞바다)"), 괄호 안에 명시된 해역만 남기고 **원문에 없는 해역은 zones에서 제거**하라.
- 원문에 근거 없이 추론하거나 확장한 해역이 있으면 반드시 제거하라.
- 이벤트 구분 블록이 있는 경우, 각 블록의 구역이 다른 블록과 섞이지 않았는지 반드시 확인하라.
`;

/**
 * [코드레벨 검증] 통보문 원문의 "부모해역(자식해역)" 괄호 한정 패턴과 AI 결과를 대조하여,
 * AI가 괄호 안 해역이 아닌 보완(complement) 해역을 반환한 경우 교정한다.
 *
 * 예: 원문 "제주도앞바다(제주도동부앞바다)" + AI zones ["제주도북부앞바다","제주도남부앞바다","제주도서부앞바다"]
 *   → 교정: zones = ["제주도동부앞바다"]
 *
 * @param {Array} parsed - AI 분석 결과 배열
 * @param {string} noticeText - 통보문 원문 텍스트
 */
function validateParenthesisZones(parsed, noticeText) {
    if (!parsed || !noticeText) return;

    // 통보문에서 해상 특보 관련 "부모해역(자식해역1, 자식해역2)" 패턴 추출
    // "제외" 포함 괄호는 건너뜀 (육상 특보의 제외 패턴)
    const parenthesisPattern = /([\uAC00-\uD7A3·]+(?:앞바다|먼바다|전해상))\(([^)]+)\)/g;
    // [Fix] 같은 부모해역이 다른 이벤트에서 다른 자식 제한으로 등장할 때
    // 별도 규칙으로 만들면 뒤 규칙이 앞 규칙의 정상 결과를 오교정함
    // → 같은 부모는 specifiedChildren을 병합하여 단일 규칙으로 통합
    const ruleMap = {}; // parent → { parent, allChildren, specifiedChildren }

    let match;
    while ((match = parenthesisPattern.exec(noticeText)) !== null) {
        const parent = match[1].trim();
        const inner = match[2].trim();

        // "제외" 키워드가 포함되면 한정이 아닌 제외 패턴 → 건너뜀
        if (inner.includes('제외')) continue;

        // ZONE_GROUP_MAP에서 부모의 자식 해역 확인
        const childrenOfParent = ZONE_GROUP_MAP[parent];
        if (!childrenOfParent) continue;

        // 같은 부모가 처음 등장하면 규칙 생성
        if (!ruleMap[parent]) {
            ruleMap[parent] = { parent, allChildren: new Set(childrenOfParent), specifiedChildren: new Set() };
        }

        // 괄호 안 해역들을 병합 추가
        inner.split(/[,，]/).forEach(z => {
            const trimmed = z.trim();
            if (childrenOfParent.includes(trimmed)) {
                ruleMap[parent].specifiedChildren.add(trimmed);
            }
        });
    }

    const parenthesisRules = Object.values(ruleMap).filter(r => r.specifiedChildren.size > 0);
    if (parenthesisRules.length === 0) return;

    // 각 AI 결과 항목의 zones를 검증
    for (const item of parsed) {
        if (!item.zones || !Array.isArray(item.zones)) continue;

        for (const rule of parenthesisRules) {
            const zonesInParent = item.zones.filter(z => rule.allChildren.has(z));
            if (zonesInParent.length === 0) continue;

            // AI가 반환한 해역이 괄호에 명시된 해역과 정확히 일치하면 OK
            const specifiedInResult = zonesInParent.filter(z => rule.specifiedChildren.has(z));
            const complementInResult = zonesInParent.filter(z => !rule.specifiedChildren.has(z));

            // AI가 괄호에 명시된 해역 대신 보완(complement)만 반환한 경우 교정
            if (specifiedInResult.length === 0 && complementInResult.length > 0) {
                console.log(`[AI Parser 검증] 괄호 한정 교정: ${rule.parent}(${[...rule.specifiedChildren].join(',')})`);
                console.log(`  AI가 반환한 해역: [${complementInResult.join(', ')}]`);
                console.log(`  교정 후: [${[...rule.specifiedChildren].join(', ')}]`);

                // complement 해역 제거, specified 해역 추가
                item.zones = item.zones.filter(z => !rule.allChildren.has(z));
                item.zones.push(...rule.specifiedChildren);
                item.zones = [...new Set(item.zones)];
            }
        }
    }
}

/**
 * 범위형 시각 문자열에서 시작 시각만 추출 (parseKmaTime 호환용)
 * 예: "2026년 02월 15일 오전(06시~12시)" → "2026년 02월 15일 06시 00분"
 * 예: "2026년 02월 15일 12시 00분" → "2026년 02월 15일 12시 00분" (그대로)
 */
function extractStartTime(tmEf) {
    if (!tmEf) return '';
    // 이미 "HH시 mm분" 형식이면 그대로 반환
    if (/\d{2}시\s*\d{2}분/.test(tmEf)) return tmEf;
    // 범위형: "오전(06시~12시)", "늦은 오후(15시~18시)", "밤(21시~24시)" 등에서 시작 시각 추출
    const rangeMatch = tmEf.match(/(\d{4}년\s*\d{2}월\s*\d{2}일)\s*.*?\((\d{2})시~\d{2}시\)/);
    if (rangeMatch) {
        return `${rangeMatch[1]} ${rangeMatch[2]}시 00분`;
    }
    return tmEf;
}

/**
 * 통보문의 번호별 항목을 분리하여 이벤트별 독립 블록으로 재구성
 * 예: (1) 풍랑주의보 ... (2) 풍랑주의보 ... → 이벤트 1/2, 이벤트 2/2로 분리
 * @param {string} noticeText - 원문 텍스트
 * @returns {{ separated: string|null, count: number }}
 */
function splitNumberedEvents(noticeText) {
    if (!noticeText) return { separated: null, count: 0 };

    // (2) 이상이 존재해야 다중 이벤트
    if (!/\(2\)/.test(noticeText)) return { separated: null, count: 1 };

    // 섹션 헤더 위치 파악
    const sectionNames = ['발효시각', '해당구역', '내용'];
    const sectionRegex = /□\s*(발효시각|해당구역|내용)/g;
    const sectionPositions = [];
    let m;
    while ((m = sectionRegex.exec(noticeText)) !== null) {
        sectionPositions.push({ name: m[1], start: m.index, headerEnd: m.index + m[0].length });
    }

    if (sectionPositions.length === 0) return { separated: null, count: 0 };

    // 최대 항목 번호 파악 (20 이하만 항목 번호로 인정)
    let maxNum = 0;
    const allNums = noticeText.match(/\(\d+\)/g);
    if (allNums) {
        for (const n of allNums) {
            const num = parseInt(n.replace(/[()]/g, ''));
            if (num > maxNum && num <= 20) maxNum = num;
        }
    }

    if (maxNum <= 1) return { separated: null, count: 1 };

    // 헤더 텍스트 (첫 번째 섹션 이전 — 통보문 제목, 발표시각 등)
    const headerText = noticeText.substring(0, sectionPositions[0].start).trim();

    // 각 섹션의 내용 추출
    const sections = {};
    for (let i = 0; i < sectionPositions.length; i++) {
        const sp = sectionPositions[i];
        const endPos = i + 1 < sectionPositions.length
            ? sectionPositions[i + 1].start
            : noticeText.length;
        sections[sp.name] = noticeText.substring(sp.headerEnd, endPos).trim();
    }

    // 각 섹션에서 번호별 항목 분리
    const itemsBySection = {};
    for (const [sectionName, sectionContent] of Object.entries(sections)) {
        itemsBySection[sectionName] = {};

        for (let n = 1; n <= maxNum; n++) {
            const itemRegex = new RegExp(`\\(${n}\\)`);
            const startMatch = itemRegex.exec(sectionContent);
            if (!startMatch) continue;

            const contentStart = startMatch.index + startMatch[0].length;

            // 다음 항목 번호 또는 섹션 끝까지
            let contentEnd = sectionContent.length;
            if (n < maxNum) {
                const nextRegex = new RegExp(`\\(${n + 1}\\)`);
                const remaining = sectionContent.substring(contentStart);
                const nextMatch = nextRegex.exec(remaining);
                if (nextMatch) {
                    contentEnd = contentStart + nextMatch.index;
                }
            }

            itemsBySection[sectionName][n] = sectionContent.substring(contentStart, contentEnd).trim();
        }
    }

    // 이벤트별 블록 구성
    const eventBlocks = [];
    for (let n = 1; n <= maxNum; n++) {
        let block = `--- 이벤트 ${n}/${maxNum} ---\n`;
        if (headerText) block += headerText + '\n';

        for (const sectionName of sectionNames) {
            if (itemsBySection[sectionName] && itemsBySection[sectionName][n]) {
                block += `□ ${sectionName}\n(${n}) ${itemsBySection[sectionName][n]}\n`;
            } else if (sections[sectionName]) {
                // 해당 섹션에 N번 항목이 없으면 섹션 전체 내용 포함 (공유 정보)
                block += `□ ${sectionName}\n${sections[sectionName]}\n`;
            }
        }
        eventBlocks.push(block.trim());
    }

    console.log(`[AI Parser] 통보문 ${maxNum}개 이벤트로 분리 완료`);
    return {
        separated: eventBlocks.join('\n\n'),
        count: maxNum
    };
}

/**
 * 부모해역(자식1, 자식2) 패턴을 코드 레벨에서 사전 확장
 * AI에게 전달하기 전에 해역명을 확정하여 괄호 해석 오류를 방지
 *
 * 처리 순서:
 * Step 1: 부모해역(자식1, 자식2) → 자식1, 자식2 (괄호 제한 추출)
 * Step 2: 단독 부모해역 → ZONE_GROUP_MAP의 모든 자식으로 확장
 *
 * @param {string} text - 통보문 텍스트 (분리된 이벤트 블록 포함 가능)
 * @returns {string}
 */
function resolveParenthesizedZones(text) {
    if (!text) return text;

    // 부모 해역 키를 길이 내림차순 정렬 (긴 이름 우선 매칭으로 부분 매칭 방지)
    const parentKeys = Object.keys(ZONE_GROUP_MAP).sort((a, b) => b.length - a.length);

    let result = text;

    // Step 1: 부모해역(자식1, 자식2) → 자식1, 자식2
    for (const parentKey of parentKeys) {
        const escaped = parentKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const parenRegex = new RegExp(escaped + '\\(([^)]+)\\)', 'g');
        result = result.replace(parenRegex, (match, children) => {
            console.log(`[Zone Pre-parse] 괄호 제한: ${parentKey}(...) → ${children.trim()}`);
            return children.trim();
        });
    }

    // Step 2: 단독 부모해역 → 모든 자식 해역으로 확장
    for (const parentKey of parentKeys) {
        if (!result.includes(parentKey)) continue;
        const escaped = parentKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'g'), (match) => {
            const expanded = ZONE_GROUP_MAP[parentKey].join(', ');
            console.log(`[Zone Pre-parse] 전체 확장: ${parentKey} → ${expanded}`);
            return expanded;
        });
    }

    return result;
}

/**
 * 분리된 이벤트 블록에서 비해상 특보 블록(강풍, 대설, 한파 등)을 제거하고 재번호 부여
 * AI 프롬프트의 "육상 특보 무시" 규칙과 "M개 블록 = M개 결과" 규칙 간의 충돌 방지
 * @param {string} separatedText - splitNumberedEvents()의 separated 결과
 * @returns {string}
 */
function filterMaritimeBlocks(separatedText) {
    if (!separatedText) return separatedText;

    const MARITIME_KEYWORDS = ['풍랑', '태풍', '지진해일', '폭풍해일'];

    // 블록 헤더 위치 파악
    const blockRegex = /---\s*이벤트\s*\d+\/\d+\s*---/g;
    const blockHeaders = [];
    let match;
    while ((match = blockRegex.exec(separatedText)) !== null) {
        blockHeaders.push({ header: match[0], start: match.index });
    }

    if (blockHeaders.length <= 1) return separatedText;

    // 각 블록 내용 추출
    const blocks = [];
    for (let i = 0; i < blockHeaders.length; i++) {
        const start = blockHeaders[i].start;
        const end = i + 1 < blockHeaders.length ? blockHeaders[i + 1].start : separatedText.length;
        blocks.push(separatedText.substring(start, end).trim());
    }

    // 해상 특보 블록만 필터링: (N) 뒤의 특보 타입명으로 판별
    const maritimeBlocks = blocks.filter(block => {
        const itemMatch = block.match(/\(\d+\)\s*(\S+)/);
        if (itemMatch) {
            return MARITIME_KEYWORDS.some(kw => itemMatch[1].includes(kw));
        }
        return true; // 타입 판별 불가 시 유지
    });

    // 필터링 결과가 동일하거나 전부 제거되면 원본 반환
    if (maritimeBlocks.length === blocks.length) return separatedText;
    if (maritimeBlocks.length === 0) return separatedText;

    // 재번호 부여: 이벤트 헤더 + 블록 내부 (N) 아이템 번호 모두 변경
    const total = maritimeBlocks.length;
    const renumbered = maritimeBlocks.map((block, idx) => {
        const newNum = idx + 1;
        // 블록 내부의 원래 아이템 번호 추출
        const origNumMatch = block.match(/\((\d+)\)/);
        let result = block.replace(/---\s*이벤트\s*\d+\/\d+\s*---/, `--- 이벤트 ${newNum}/${total} ---`);
        // 내부 (원래번호) → (새번호) 치환
        if (origNumMatch) {
            const origNum = origNumMatch[1];
            if (origNum !== String(newNum)) {
                result = result.replace(new RegExp(`\\(${origNum}\\)`, 'g'), `(${newNum})`);
            }
        }
        return result;
    });

    const removedCount = blocks.length - maritimeBlocks.length;
    console.log(`[AI Parser] 비해상 특보 블록 ${removedCount}개 제거, 해상 특보 ${total}개 블록 유지`);

    return renumbered.join('\n\n');
}

/**
 * Gemini를 사용하여 통보문 분석
 * @param {string} noticeText
 */
async function parseNoticeWithAI(noticeText, baseDate = '') {
    if (!API_KEY || API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
        const msg = '[AI Parser] GEMINI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.';
        console.warn(msg);
        return { data: [], error: msg };
    }

    try {
        // 번호별 항목 분리 (다중 이벤트 통보문 처리)
        const splitResult = splitNumberedEvents(noticeText);
        let baseText = splitResult.separated || noticeText;

        // 비해상 특보 블록 제거 (강풍, 대설, 한파 등 → AI 프롬프트 충돌 방지)
        if (splitResult.separated) {
            baseText = filterMaritimeBlocks(baseText);
        }

        // 부모해역(자식) 패턴을 코드 레벨에서 사전 확장 (AI 괄호 해석 오류 방지)
        const textForAI = resolveParenthesizedZones(baseText);

        // UI 표시용: 분리 또는 해역 확장이 적용된 경우 표시
        const processedText = (textForAI !== noticeText) ? textForAI : null;

        console.log('[AI Parser] Gemini API 호출 시작... (baseDate:', baseDate || '없음', ', 이벤트 분리:', splitResult.count > 1 ? splitResult.count + '개' : '없음', ', 해역 사전확장:', textForAI !== baseText ? 'Y' : 'N', ')');
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: { responseMimeType: "application/json" }
        });

        // 기준 날짜가 없으면 현재 시간 기준, 있으면 해당 날짜를 컨텍스트로 제공
        const referenceDateInfo = baseDate
            ? `통보문 발표 시각은 ${baseDate}이다. 이를 기준으로 '오늘', '내일', '모레'의 정확한 날짜(YYYY년 MM월 DD일)를 계산하여 추출하라.`
            : `현재 시각은 ${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월이다. 이를 기준으로 날짜를 유추하라.`;

        const prompt = `${SYSTEM_INSTRUCTION}\n\n${referenceDateInfo}\n\n분석할 통보문:\n${textForAI}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log('[AI Parser] Gemini 응답 수신 완료, 길이:', text.length);

        const parsed = JSON.parse(text);
        // [후처리 0] 괄호 한정 패턴 코드레벨 검증
        // 통보문에 "부모해역(자식해역)" 패턴이 있을 때, AI가 괄호 안 해역 대신
        // 보완(complement) 해역을 반환하는 오류를 코드 레벨에서 교정
        validateParenthesisZones(parsed, noticeText);

        // [후처리] AI가 부모 해역(전해상, 앞바다, 먼바다 등)을 확장하지 않고 반환한 경우 코드 레벨에서 강제 확장
        for (const item of parsed) {
            if (item.zones && Array.isArray(item.zones)) {
                const expanded = [];
                for (const zone of item.zones) {
                    if (ZONE_GROUP_MAP[zone]) {
                        expanded.push(...ZONE_GROUP_MAP[zone]);
                    } else {
                        expanded.push(zone);
                    }
                }
                item.zones = [...new Set(expanded)];
            }
        }
        // [Fix] 동일 type+command 이벤트 간 구역 중복 제거
        // 부모 해역 확장으로 인해 다른 이벤트의 구역이 중복 포함되는 문제 방지
        // AI 출력 순서(= 통보문 순서)에서 먼저 등장한 이벤트가 구역 우선권을 가짐
        // 예: 01시 해제(인천·경기)와 02시 해제(서해중부앞바다→전체확장) 간 겹침 방지
        const claimedZones = {};
        for (const item of parsed) {
            const key = `${item.type}|${item.command}`;
            if (!claimedZones[key]) {
                claimedZones[key] = new Set();
            }
            const beforeCount = item.zones.length;
            item.zones = item.zones.filter(z => !claimedZones[key].has(z));
            if (item.zones.length < beforeCount) {
                console.log(`[AI Parser] 구역 중복 제거: ${item.type} ${item.command} - ${beforeCount - item.zones.length}개 제거됨`);
            }
            item.zones.forEach(z => claimedZones[key].add(z));
        }
        // [후처리] AI가 해제 예고를 누락한 경우 코드 레벨 보정
        // 이벤트 블록 텍스트에서 "해제 예고:" 패턴을 직접 추출하여 tmCc에 채움
        if (splitResult.count > 1 && textForAI) {
            const eventBlocks = textForAI.split(/---\s*이벤트\s*\d+\/\d+\s*---/).filter(b => b.trim());
            for (let i = 0; i < parsed.length && i < eventBlocks.length; i++) {
                if (!parsed[i].tmCc && eventBlocks[i]) {
                    // "해제 예고: 23일 늦은 오후(15시~18시)" 또는 "해제 예고: 23일 12시" 패턴 매칭
                    const releaseMatch = eventBlocks[i].match(/해제\s*예고\s*[:：]\s*(\d{1,2})일\s+(.*?\(\d{2}시~\d{2}시\)|\d{2}시(?:\s*\d{2}분)?)/);
                    if (releaseMatch) {
                        const dayNum = releaseMatch[1].padStart(2, '0');
                        const timeRange = releaseMatch[2].trim();
                        // tmEf 또는 baseDate에서 년/월 유추
                        const dateRef = parsed[i].tmEf || baseDate || '';
                        const ymMatch = dateRef.match(/(\d{4})년\s*(\d{2})월/);
                        if (ymMatch) {
                            parsed[i].tmCc = `${ymMatch[1]}년 ${ymMatch[2]}월 ${dayNum}일 ${timeRange}`;
                            console.log(`[AI Parser] 해제 예고 코드 보정: ${parsed[i].tmCc}`);
                        }
                    }
                }
            }
        }
        // 하위 호환: tmEf → time 변환 (기존 코드에서 event.time 사용하는 부분 대응)
        // time에는 범위형에서 시작 시각만 추출하여 저장 (parseKmaTime 호환용)
        for (const item of parsed) {
            if (item.tmEf && !item.time) {
                item.time = extractStartTime(item.tmEf);
            }
            // 기존 tmYn → tmCc 호환
            if (item.tmCc !== undefined && item.tmYn === undefined) {
                item.tmYn = item.tmCc;
            }
        }
        return { data: parsed, error: null, separatedText: processedText };
    } catch (error) {
        const msg = `[AI Parser] 분석 중 오류 발생: ${error.message}`;
        console.error(msg);
        // 에러 발생 시에도 변환된 텍스트는 반환 (UI 표시용)
        const splitFallback = splitNumberedEvents(noticeText);
        const fallbackBase = splitFallback.separated || noticeText;
        const fallbackResolved = resolveParenthesizedZones(fallbackBase);
        return { data: [], error: msg, separatedText: (fallbackResolved !== noticeText) ? fallbackResolved : null };
    }
}

module.exports = {
    parseNoticeWithAI,
    extractStartTime,
    splitNumberedEvents,
    resolveParenthesizedZones,
    filterMaritimeBlocks,
    ZONE_GROUP_MAP
};
