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
- **부분 제한**: 부모 해역 뒤에 괄호가 있고 그 안에 특정 해역이 명시되어 있다면(예: 제주도먼바다(제주도남쪽바깥먼바다)), 오직 괄호 안에 명시된 해역들만 추출해라.
- **복수 명시**: 괄호 안에 여러 해역이 콤마로 구분되어 있다면(예: 서해남부먼바다(서해남부북쪽안쪽먼바다, 서해남부북쪽바깥먼바다)), 그 해역들을 모두 추출해라.
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
- **tmCc (해제시각)**: 해당 특보의 해제 시각 또는 해제 예고 시각이다.
  - 해제 시각이 명시된 경우: 동일한 형식으로 추출한다 (범위형도 동일 규칙 적용).
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

### 6. 최종 검증 (반드시 수행)
JSON 배열을 출력하기 전에, 아래 검증을 반드시 수행하라:
- 각 항목의 zones에 포함된 모든 해역이 통보문 원문에 **실제로 명시**되어 있는지 원문과 1:1 대조하라.
- 부모 해역 뒤에 괄호가 있어 특정 해역만 명시된 경우(예: "서해중부앞바다(충남북부앞바다, 충남남부앞바다)"), 괄호 안에 명시된 해역만 남기고 **원문에 없는 해역은 zones에서 제거**하라.
- 원문에 근거 없이 추론하거나 확장한 해역이 있으면 반드시 제거하라.
`;

/**
 * 범위형 시각 문자열에서 시작 시각만 추출 (parseKmaTime 호환용)
 * 예: "2026년 02월 15일 오전(06시~12시)" → "2026년 02월 15일 06시 00분"
 * 예: "2026년 02월 15일 12시 00분" → "2026년 02월 15일 12시 00분" (그대로)
 */
function extractStartTime(tmEf) {
    if (!tmEf) return '';
    // 이미 "HH시 mm분" 형식이면 그대로 반환
    if (/\d{2}시\s*\d{2}분/.test(tmEf)) return tmEf;
    // 범위형: "오전(06시~12시)", "오후(12시~18시)", "밤(18시~24시)" 등에서 시작 시각 추출
    const rangeMatch = tmEf.match(/(\d{4}년\s*\d{2}월\s*\d{2}일)\s*\S*\((\d{2})시~\d{2}시\)/);
    if (rangeMatch) {
        return `${rangeMatch[1]} ${rangeMatch[2]}시 00분`;
    }
    return tmEf;
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
        console.log('[AI Parser] Gemini API 호출 시작... (baseDate:', baseDate || '없음', ')');
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: { responseMimeType: "application/json" }
        });

        // 기준 날짜가 없으면 현재 시간 기준, 있으면 해당 날짜를 컨텍스트로 제공
        const referenceDateInfo = baseDate
            ? `통보문 발표 시각은 ${baseDate}이다. 이를 기준으로 '오늘', '내일', '모레'의 정확한 날짜(YYYY년 MM월 DD일)를 계산하여 추출하라.`
            : `현재 시각은 ${new Date().getFullYear()}년 ${new Date().getMonth() + 1}월이다. 이를 기준으로 날짜를 유추하라.`;

        const prompt = `${SYSTEM_INSTRUCTION}\n\n${referenceDateInfo}\n\n분석할 통보문:\n${noticeText}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log('[AI Parser] Gemini 응답 수신 완료, 길이:', text.length);

        const parsed = JSON.parse(text);
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
        return { data: parsed, error: null };
    } catch (error) {
        const msg = `[AI Parser] 분석 중 오류 발생: ${error.message}`;
        console.error(msg);
        return { data: [], error: msg };
    }
}

module.exports = {
    parseNoticeWithAI,
    extractStartTime,
    ZONE_GROUP_MAP
};
