const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY);

const ZONE_GROUP_MAP = {
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
- **전체 포함**: 통보문에 부모 해역 이름(예: 제주도먼바다)만 있고 뒤에 괄호가 없다면, 해당 부모에 속한 모든 자식 해역을 리스트에 넣어라.
- **부분 제한**: 부모 해역 뒤에 괄호가 있고 그 안에 특정 해역이 명시되어 있다면(예: 제주도먼바다(제주도남쪽바깥먼바다)), 오직 괄호 안에 명시된 해역들만 추출해라.
- **복수 명시**: 괄호 안에 여러 해역이 콤마로 구분되어 있다면(예: 서해남부먼바다(서해남부북쪽안쪽먼바다, 서해남부북쪽바깥먼바다)), 그 해역들을 모두 추출해라.

### 3. 상태(command) 및 시각(time) 추출 규칙
- **command 종류**: '발표', '발효', '해제', '예비', '변경', '보강', '연장' 중 하나로 분류한다.
- **time**: 해당 상태가 실제로 발생하는(효력을 발생하는) 시각을 'YYYY년 MM월 DD일 HH시 mm분' 형식으로 추출한다. 
  - '해제'의 경우 해제 시각을, '발효'의 경우 발효 시각을 정확히 매칭해야 한다.
- **tmYn (해제예고)**: 문장에 '해제 예고' 또는 '해제 시각'에 대한 예측 정보가 있다면 'tmYn' 필드에 해당 텍스트를 입력한다.

### 4. 출력 형식
반드시 아래와 같은 JSON 배열 형식으로만 응답해야 한다. 추가적인 설명은 생략한다.
[
  {
    "type": "풍랑주의보 | 풍랑경보 | 태풍주의보 | 태풍경보 | 지진해일주의보 | 지진해일경보 | 폭풍해일주의보 | 폭풍해일경보",
    "command": "발표",
    "time": "2024년 08월 30일 10시 00분",
    "zones": ["제주도남쪽바깥먼바다"],
    "tmYn": "31일 오전"
  }
]
`;

/**
 * Gemini 1.5 Flash를 사용하여 통보문 분석
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
        return { data: parsed, error: null };
    } catch (error) {
        const msg = `[AI Parser] 분석 중 오류 발생: ${error.message}`;
        console.error(msg);
        return { data: [], error: msg };
    }
}

module.exports = {
    parseNoticeWithAI,
    ZONE_GROUP_MAP
};
