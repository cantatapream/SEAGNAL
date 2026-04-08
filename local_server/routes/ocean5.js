/**
 * ============================================================================
 * 파일명: routes/ocean5.js
 * 역할: 저질(해저면 성분) + 해도 수심 AI 판독 API
 * ============================================================================
 *
 * [설명]
 * 클릭 좌표를 받아 서버에서 해아름(KHOA) WMS 타일을 직접 요청하고,
 * Gemini 2.0 Flash에 전달하여 저질 및 수심 정보를 AI로 판독합니다.
 *
 * - POST /api/ocean/seabed → 좌표 수신 → WMS 이미지 취득 → AI 분석 → 반환
 *
 * [기존 방식 문제]
 * 클라이언트(브라우저) 뷰포트를 캡처 → 줌 레벨·레이어 상태에 의존적
 *
 * [새 방식]
 * 서버에서 해아름 WMS GetMap을 직접 호출 → 항상 일정한 해상도·레이어 보장
 * 클릭 좌표를 중심으로 반경 약 1.5km(768×768px) 타일 이미지를 취득
 *
 * [외부 API]
 * - KHOA 해아름 WMS (http://www.khoa.go.kr/oceanmap/)
 * - Gemini 2.0 Flash Multimodal
 *
 * [연계 파일]
 * - ocean1.js → router.use()로 연결
 * - .env → GEMINI_API_KEY
 * ============================================================================
 */

const express = require('express');
const router  = express.Router();

// ── Gemini AI 초기화 ─────────────────────────────────────────────────────────
let genAI = null;
try {
    const { GoogleGenAI } = require('@google/genai');
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) genAI = new GoogleGenAI({ apiKey });
} catch (e) {
    console.warn('[Ocean5] Gemini AI 모듈 로드 실패:', e.message);
}

// ── 좌표 변환: WGS84(위경도) → EPSG:3857(Web Mercator 미터) ─────────────────
function latLonToMercator(lat, lon) {
    const R = 6378137; // WGS84 장반경 (m)
    const x = lon * (Math.PI / 180) * R;
    const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
    return { x, y };
}

// ── 해아름 WMS 이미지 서버 직접 취득 ─────────────────────────────────────────
/**
 * 클릭 좌표 중심으로 해아름 WMS 타일 이미지(768×768px)를 서버에서 요청한다.
 * - 레이어: BASEMAP_RLTM3857 (조석지도 — 수심·저질 기호 포함)
 * - 반경: 약 1.5km (3km × 3km 영역)
 * - SRS: EPSG:3857
 *
 * @param {number} lat - 위도
 * @param {number} lon - 경도
 * @returns {Promise<Buffer|null>} PNG 이미지 버퍼 또는 null(실패/비PNG)
 */
async function fetchKhoaWmsImage(lat, lon) {
    const { x, y } = latLonToMercator(lat, lon);
    const half = 1500; // 1500m 반경 → 3km × 3km 영역
    const bbox = `${x - half},${y - half},${x + half},${y + half}`;

    const layer = 'BASEMAP_RLTM3857';
    const params = new URLSearchParams({
        SERVICE:     'WMS',
        VERSION:     '1.1.1',
        REQUEST:     'GetMap',
        FORMAT:      'image/png',
        TRANSPARENT: 'true',
        LAYERS:      '',      // KHOA WMS: 레이어는 URL 경로로 지정하므로 빈 값
        STYLES:      '',
        WIDTH:       '768',
        HEIGHT:      '768',
        SRS:         'EPSG:3857',
        BBOX:        bbox
    });

    const url = `http://www.khoa.go.kr/oceanmap/${layer}/wmsVectordata.do?${params}`;

    // node-fetch v2 직접 사용 (global.fetch는 timeout 옵션 미지원)
    const nodeFetch = require('node-fetch');

    try {
        const r = await nodeFetch(url, {
            redirect: 'follow',
            timeout:  12000,    // node-fetch v2 timeout (ms)
            headers: {
                'Referer':    'http://www.khoa.go.kr/oceanmap/main.do',
                'User-Agent': 'Mozilla/5.0'
            }
        });

        if (!r.ok) {
            console.error('[해아름 WMS] HTTP 오류:', r.status, r.statusText);
            return null;
        }

        const buf = Buffer.from(await r.arrayBuffer());

        // PNG 매직 바이트 검증: 0x89 0x50 0x4E 0x47 (‰PNG)
        // KHOA가 에러 시 HTML/XML을 200으로 반환하는 경우 차단
        if (buf.length < 8 ||
            buf[0] !== 0x89 || buf[1] !== 0x50 ||
            buf[2] !== 0x4E || buf[3] !== 0x47) {
            console.error('[해아름 WMS] PNG가 아닌 응답 수신 (길이:', buf.length, ')');
            return null;
        }

        return buf;
    } catch (e) {
        console.error('[해아름 WMS] 이미지 요청 실패:', e.message);
        return null;
    }
}

// ── Gemini 프롬프트 ───────────────────────────────────────────────────────────
/**
 * 수심 + 저질 동시 추출 프롬프트
 * - 이미지 정중앙 = 클릭 지점
 * - 등심선(배경색)을 기반으로 같은 색상 구역 내 가장 가까운 수심 숫자 판독
 * - 육지·항내 판별 포함
 */
function buildSeabedPrompt(lat, lon) {
    return `이 이미지는 국립해양조사원(KHOA) 해아름 전자해도입니다.
이미지의 정중앙이 분석 대상 위치(위도 ${lat.toFixed(5)}, 경도 ${lon.toFixed(5)})입니다.

[1. 육지·항내 판별 — 최우선 확인]
이미지 중앙 지점이 다음 중 하나이면 isLand: true로 설정하고 나머지 항목은 null로 반환하세요:
  - 육지(흰색·회색 지형)
  - 방파제 내측(항구 내부)
  - 암초 노출 지역

[2. 수심 판독]
  ① 이미지 중앙 지점의 배경 수색(水色, 바다 배경색)을 먼저 파악하세요.
     (해아름 해도는 수심 구간마다 다른 파란색 계열 배경색으로 등심선을 표시합니다.)
  ② 중앙 지점과 동일한 색상 구역 안에 있는 수심 숫자 중 중앙에서 가장 가까운 것을 읽으세요.
  ③ 수심 숫자는 흰색 또는 밝은 회색 숫자로 표기됩니다 (정수: 25, 소수: 1.5, 0.3).
  ④ 같은 색상 구역에 수심 숫자가 없는 경우, 인접한 등심선 값에서 추정하세요.

[3. 저질 판독]
이미지 중앙 근처에서 저질 기호를 찾아 가장 가까운 것을 식별하세요.
저질 기호(노란색 알파벳):
  S(모래), M(진흙/니질), G(자갈), R(암반), Sh(패각),
  Co(산호), Wd(해초), Cy(점토), Si(미사), St(돌), fS(세사), cS(조사)

※ 복합 기호(예: MS, SM, cSM)는 첫 글자가 주성분입니다.

다음 JSON 형식으로만 응답하세요 (추가 설명 없이):
{
  "isLand": false,
  "depth": 25,
  "depthNote": "등심선 기준 약 25m",
  "primary": "모래(S)",
  "secondary": "진흙(M)",
  "summary": "해저면 특성 한 줄 설명",
  "characteristics": "낚시·양식 등 활용 관점 한 줄 설명"
}

예외 처리:
- 수심 식별 불가: "depth": null, "depthNote": "수심 식별 불가"
- 저질 식별 불가: "primary": "식별 불가", "secondary": null
- 육지·항내:     "isLand": true, "depth": null, "primary": null`;
}

// ── JSON 파싱 ─────────────────────────────────────────────────────────────────
function parseSeabedResponse(text) {
    // ```json ... ``` 블록 추출
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[1].trim()); } catch (_) {}
    }
    // 중괄호 JSON 직접 추출
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
        try { return JSON.parse(braceMatch[0]); } catch (_) {}
    }
    // 파싱 실패 시 텍스트 그대로
    return {
        isLand: false,
        depth: null,
        depthNote: null,
        primary: '판독 불가',
        secondary: null,
        summary: text.substring(0, 200),
        characteristics: ''
    };
}

// ============================================================================
// API: POST /api/ocean/seabed
// ============================================================================
/**
 * 저질 + 해도 수심 AI 판독
 *
 * [요청 바디]
 * { "lat": 34.5, "lon": 126.3 }
 *
 * [응답]
 * {
 *   success: true,
 *   seabed: {
 *     isLand: false,
 *     depth: 25,
 *     depthNote: "등심선 기준 약 25m",
 *     primary: "모래(S)",
 *     secondary: null,
 *     summary: "...",
 *     characteristics: "..."
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

        const { lat, lon } = req.body;
        if (lat == null || lon == null) {
            return res.status(400).json({ success: false, error: '위경도 좌표가 필요합니다.' });
        }

        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);

        // 서버에서 해아름 WMS 이미지 직접 요청 (클릭 좌표 중심, 최대 줌 수준)
        const imageBuffer = await fetchKhoaWmsImage(latNum, lonNum);
        if (!imageBuffer) {
            return res.json({
                success: false,
                error: '해아름 지도 이미지를 가져올 수 없습니다. 잠시 후 다시 시도해주세요.'
            });
        }

        const base64Data = imageBuffer.toString('base64');

        // Gemini 2.0 Flash — 저질 + 수심 동시 판독
        const response = await genAI.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType: 'image/png', data: base64Data } },
                    { text: buildSeabedPrompt(latNum, lonNum) }
                ]
            }]
        });

        // response.text 안전 접근
        // @google/genai v1.x: .text getter가 멀티파트 응답 시 throw할 수 있으므로
        // candidates 경로를 우선하고 .text를 fallback으로 사용
        let aiText = '';
        try {
            const part = response?.candidates?.[0]?.content?.parts?.[0];
            aiText = (typeof part?.text === 'string')
                ? part.text
                : (response.text || '');
        } catch (_) {
            aiText = '';
        }

        const seabed  = parseSeabedResponse(aiText);

        res.json({ success: true, seabed, rawText: aiText });

    } catch (e) {
        console.error('[Ocean5] 저질 AI 판독 오류:', e.message, e.stack);
        const msg = e.message && e.message.length < 200 ? e.message : '저질 분석 중 오류가 발생했습니다.';
        res.status(500).json({ success: false, error: msg });
    }
});

module.exports = router;
