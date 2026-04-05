/**
 * ============================================================================
 * 파일명: routes/ocean5.js
 * 역할: 저질(해저면 성분) AI 판독 API
 * ============================================================================
 *
 * [설명]
 * 해아름(KHOA) ENC57 해도 타일 이미지를 Gemini 2.0 Flash에 전달하여
 * 해저면 저질 정보를 AI로 판독합니다.
 *
 * - POST /api/ocean/seabed → 해도 이미지를 Gemini AI로 분석하여 저질 정보 추출
 *
 * [외부 API]
 * Gemini 2.0 Flash (Multimodal) - 이미지 분석
 *
 * [연계 파일]
 * - ocean1.js → 이 파일을 router.use()로 연결
 * - .env → GEMINI_API_KEY
 * ============================================================================
 */

const express = require('express');
const router = express.Router();

/**
 * Gemini AI 클라이언트 초기화
 * - 환경변수 GEMINI_API_KEY 사용
 * - 서버 시작 시 한번만 초기화
 */
let genAI = null;
try {
    const { GoogleGenAI } = require('@google/genai');
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
        genAI = new GoogleGenAI({ apiKey });
    }
} catch (e) {
    console.warn('[Ocean] Gemini AI 모듈 로드 실패:', e.message);
}

// 저질 판독 프롬프트
const SEABED_PROMPT = `이 해도(해양 수로도) 이미지를 분석하여 해저면 저질(底質) 정보를 추출해주세요.

해도에서 저질은 다음과 같은 약어로 표기됩니다:
- S (Sand, 모래)
- M (Mud, 진흙/니질)
- G (Gravel, 자갈)
- R (Rock, 암반)
- Sh (Shell, 패각/조개껍데기)
- Co (Coral, 산호)
- Wd (Weed, 해초)
- Cy (Clay, 점토)
- Si (Silt, 미사)
- St (Stone, 돌)
- fS (fine Sand, 세사)
- cS (coarse Sand, 조사)

이미지에서 보이는 저질 기호들을 찾아 다음 형식으로 응답해주세요:

1. 주요 저질 타입 (가장 많이 보이는 것)
2. 보조 저질 타입 (있는 경우)
3. 해저면 특성 요약 (한 줄)
4. 해당 해역의 특징 (낚시, 양식 등 활용 관점에서 한 줄)

저질 기호가 보이지 않는 경우 "저질 정보를 식별할 수 없습니다"라고 답해주세요.
JSON 형식으로 응답하세요:
{
  "primary": "모래(S)",
  "secondary": "진흙(M)",
  "summary": "모래와 진흙이 혼합된 해저면",
  "characteristics": "저서생물 서식에 적합한 환경"
}`;

// ============================================================================
// API: 저질 AI 판독
// ============================================================================

/**
 * POST /api/ocean/seabed
 *
 * 해도 이미지를 Gemini AI로 분석하여 저질 정보를 추출합니다.
 *
 * [동작 흐름]
 * 1. 클라이언트가 해아름 ENC57 타일 이미지를 base64로 전송
 * 2. Gemini 2.0 Flash에 이미지 + 프롬프트 전달
 * 3. AI 응답을 파싱하여 JSON으로 반환
 *
 * [요청 바디]
 * {
 *   "image": "data:image/png;base64,iVBOR...",  // base64 이미지
 *   "lat": 34.5,    // 참고용 좌표 (선택)
 *   "lon": 126.3    // 참고용 좌표 (선택)
 * }
 *
 * [응답 예시]
 * {
 *   success: true,
 *   seabed: {
 *     primary: "모래(S)",
 *     secondary: "진흙(M)",
 *     summary: "모래와 진흙이 혼합된 해저면",
 *     characteristics: "저서생물 서식에 적합한 환경"
 *   }
 * }
 */
router.post('/api/ocean/seabed', async (req, res) => {
    try {
        if (!genAI) {
            return res.status(500).json({
                success: false,
                error: 'Gemini API 키가 설정되지 않았습니다. (.env의 GEMINI_API_KEY)'
            });
        }

        const { image, lat, lon } = req.body;

        if (!image) {
            return res.status(400).json({ success: false, error: '이미지 데이터가 필요합니다.' });
        }

        // base64 이미지 데이터 추출
        // "data:image/png;base64,iVBOR..." → mimeType + base64Data
        let mimeType = 'image/png';
        let base64Data = image;

        if (image.startsWith('data:')) {
            const match = image.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
                mimeType = match[1];
                base64Data = match[2];
            }
        }

        // 좌표 정보가 있으면 프롬프트에 추가
        let prompt = SEABED_PROMPT;
        if (lat && lon) {
            prompt += `\n\n참고: 이 해도의 대략적 위치는 위도 ${lat}, 경도 ${lon} 부근입니다.`;
        }

        // Gemini 2.0 Flash 호출
        const response = await genAI.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [{
                role: 'user',
                parts: [
                    {
                        inlineData: {
                            mimeType,
                            data: base64Data
                        }
                    },
                    { text: prompt }
                ]
            }]
        });

        const aiText = response.text || '';

        // JSON 파싱 시도
        const seabed = parseSeabedResponse(aiText);

        res.json({
            success: true,
            seabed,
            rawText: aiText
        });

    } catch (e) {
        console.error('[Ocean] 저질 AI 판독 오류:', e.message);
        res.status(500).json({ success: false, error: '저질 분석 중 오류가 발생했습니다.' });
    }
});

/**
 * Gemini AI 응답에서 JSON을 추출하는 함수
 * - JSON 블록이 있으면 파싱
 * - 없으면 텍스트 그대로 반환
 */
function parseSeabedResponse(text) {
    // ```json ... ``` 블록 추출 시도
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[1].trim());
        } catch (e) { /* 파싱 실패 시 아래로 진행 */ }
    }

    // 중괄호로 둘러싸인 JSON 추출 시도
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
        try {
            return JSON.parse(braceMatch[0]);
        } catch (e) { /* 파싱 실패 시 아래로 진행 */ }
    }

    // JSON 파싱 실패 시 텍스트 그대로 반환
    return {
        primary: '판독 불가',
        secondary: null,
        summary: text.substring(0, 200),
        characteristics: ''
    };
}

module.exports = router;
