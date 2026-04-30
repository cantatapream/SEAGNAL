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

// ── 해아름 WMS 이미지 취득 ─────────────────────────────────────────────────
/**
 * 클릭 좌표를 포함하는 해아름 WMS 타일(zoom 15, 256×256px)을 취득한다.
 *
 * KHOA WMS는 GeoWebCache 기반으로 타일-그리드에 정렬된 BBOX만 PNG를 반환한다.
 * 임의 BBOX(비정렬)는 메인 페이지 HTML로 리다이렉트되므로,
 * OpenLayers가 보내는 것과 동일한 tile-aligned BBOX를 사용한다.
 *
 * 실패 시 zoom 14 → 13 순으로 폴백(시야각은 넓어지지만 데이터는 동일).
 *
 * @param {number} lat - 위도
 * @param {number} lon - 경도
 * @returns {Promise<Buffer|null>} PNG 이미지 버퍼 또는 null(실패/비PNG)
 */
async function fetchKhoaWmsImage(lat, lon, startZoom = 15) {
    const R       = 6378137;
    const originX = -Math.PI * R;  // ≈ -20037508 m
    const originY =  Math.PI * R;  // ≈ +20037508 m

    /**
     * Web Mercator(EPSG:3857) 좌표 (x, y) 가 속한 타일의 bbox 반환.
     * 타일 시스템: 줌 레벨 zoom 에서 2^zoom × 2^zoom 격자.
     * @returns {{minX, minY, maxX, maxY, tx, ty}} - 타일 인덱스(tx, ty) 와 사각형
     */
    function tileBbox(x, y, zoom) {
        const tileSize = 2 * Math.PI * R / Math.pow(2, zoom);
        const tx = Math.floor((x - originX) / tileSize);
        const ty = Math.floor((originY - y) / tileSize);
        const minX = originX + tx * tileSize;
        const maxX = minX + tileSize;
        const maxY = originY - ty * tileSize;
        const minY = maxY - tileSize;
        return `${minX},${minY},${maxX},${maxY}`;
    }

    const { x, y } = latLonToMercator(lat, lon);
    const port     = process.env.PORT || 3001;
    const fetchFn  = global.fetch || require('node-fetch');

    // startZoom 부터 최대 2단계 아래까지 PNG 획득 시도
    for (const zoom of [startZoom, startZoom - 1, startZoom - 2]) {
        const bbox = tileBbox(x, y, zoom);

        const wmsParams = new URLSearchParams({
            layer:       'BASEMAP_ENC573857', // 전자해도: 등심선·저질 기호가 상세
            SERVICE:     'WMS',
            VERSION:     '1.1.1',
            REQUEST:     'GetMap',
            FORMAT:      'image/png',
            TRANSPARENT: 'true',
            LAYERS:      '',
            STYLES:      '',
            WIDTH:       '256',
            HEIGHT:      '256',
            SRS:         'EPSG:3857',
            TILED:       'true',   // OpenLayers가 항상 포함하는 파라미터
            BBOX:        bbox
        });

        const proxyUrl = `http://localhost:${port}/api/ocean/khoa-wms?${wmsParams}`;

        try {
            const r = await fetchFn(proxyUrl);

            if (!r.ok) {
                console.error(`[해아름 WMS] z${zoom} 프록시 오류:`, r.status);
                continue;
            }

            const buf = Buffer.from(await r.arrayBuffer());

            // PNG 매직 바이트 검증 (0x89 0x50 = \x89P)
            if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) {
                const preview = buf.slice(0, 200).toString('utf8').replace(/[\r\n]+/g, ' ');
                console.error(`[해아름 WMS] z${zoom} PNG 아님, 길이:${buf.length} | ${preview}`);
                continue; // 다음 zoom 레벨 시도
            }

            console.log(`[해아름 WMS] z${zoom} 취득 성공, ${buf.length} bytes, bbox=${bbox}`);
            return buf;

        } catch (e) {
            console.error(`[해아름 WMS] z${zoom} 요청 예외:`, e.message);
        }
    }

    return null; // 모든 zoom 레벨 실패
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
     (해아름 전자해도는 수심 구간마다 다른 파란색 계열 배경색으로 등심선을 표시합니다.)
  ② 중앙 지점과 동일한 색상 구역 안에 있는 수심 숫자 중 중앙에서 가장 가까운 것을 읽으세요.

  ③ [IHO 해도 수심 표기법 — 중요]
     해도의 수심 숫자는 정수 부분(큰 글자)과 소수 부분(작은 글자)을 글자 크기 차이로 구분합니다.

     판독 방법:
     1) 먼저 숫자 전체에서 크기가 작은(subscript) 자리를 식별합니다.
     2) 작은 자리가 없으면 → 숫자 전체가 정수값입니다.
        예) "15" (모두 같은 크기) → 15m
     3) 마지막 한 자리만 작으면 → [나머지 자리].[작은 자리] 로 읽습니다.
        예) "71" 에서 "1"만 작으면 → 7.1m   (71m도 아니고 71.1m도 아닙니다)
        예) "35" 에서 "5"만 작으면 → 3.5m
        예) "79" 에서 "9"만 작으면 → 7.9m
        예) "159" 에서 "9"만 작으면 → 15.9m
        예) "225" 에서 "5"만 작으면 → 22.5m

     ⚠ 절대 하지 말 것:
        - 작은 자리를 큰 자리에 이어 붙이지 마세요. "71"(1이 작음) → 71.1m ✗
        - 크기 차이가 없는데 소수점을 임의로 삽입하지 마세요.

     - 음수("-" 기호): 조고(고조 기준면 위) = 노출 암반/천소
       예) "-26" 에서 "6"이 작으면 → 기준면 위 2.6m

  ④ 같은 색상 구역에 수심 숫자가 없는 경우, 인접한 등심선 값에서 추정하세요.

[3. 저질 판독 — 반드시 시각적 기호를 우선 확인]
  ① 저질 기호의 외형:
     - 전자해도(ENC)에서 저질 기호는 진청색(dark blue) 또는 흑색 이탤릭(기울어진) 알파벳입니다.
     - 노란색이 아닙니다. 수심 숫자(회색/검정 직립 숫자)와 글꼴 스타일이 다릅니다.

  ② 우선순위 규칙 (매우 중요):
     - 이미지 정중앙에서 가장 가까이 있는 저질 기호를 찾으세요.
     - 배경 색상(파란 구역 = 물)이 저질을 결정하지 않습니다.
       저질은 반드시 이탤릭 알파벳 기호로만 판단하세요.

  ③ 기호 목록:
     R(암반/바위), S(모래), M(진흙/니질), G(자갈), Sh(패각),
     Co(산호), Wd(해초), Cy(점토), Si(미사), St(돌), fS(세사), cS(조사)

  ④ 복합 기호(예: MS, SM, cSM)는 첫 글자가 주성분입니다.
  ⑤ 근처에 저질 기호가 전혀 없으면 "식별 불가"로 반환하세요.
     (배경 색상을 근거로 저질을 추측하지 마세요.)

다음 JSON 형식으로만 응답하세요 (추가 설명 없이, 실제 이미지에서 읽은 값으로 채우세요):
{
  "isLand": false,
  "depth": <이미지에서 읽은 실제 수심>,
  "depthNote": "<판독 근거>",
  "primary": "<이미지에서 읽은 실제 저질 기호>",
  "secondary": null,
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

        // ── Gemini 호출 공통 함수 ──────────────────────────────────────────────
        async function analyzeImage(buf) {
            const b64 = buf.toString('base64');
            const resp = await genAI.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: 'image/png', data: b64 } },
                        { text: buildSeabedPrompt(latNum, lonNum) }
                    ]
                }]
            });
            let text = '';
            try {
                const part = resp?.candidates?.[0]?.content?.parts?.[0];
                text = (typeof part?.text === 'string') ? part.text : (resp.text || '');
            } catch (_) {}
            return text;
        }

        // ── 1차 시도: zoom 15 (≈1.2km 타일) ──────────────────────────────────
        const imageBuffer = await fetchKhoaWmsImage(latNum, lonNum, 15);
        if (!imageBuffer) {
            return res.json({
                success: false,
                error: '해아름 지도 이미지를 가져올 수 없습니다. 잠시 후 다시 시도해주세요.'
            });
        }

        let aiText = await analyzeImage(imageBuffer);
        let seabed = parseSeabedResponse(aiText);

        // ── 2차 시도: 저질 식별 불가 → zoom 13(≈4.9km)으로 줌아웃 후 재분석 ──
        // 줌아웃하면 더 넓은 범위가 256px에 담기므로 주변 저질 기호가 화면에 등장함
        if (!seabed.isLand && (!seabed.primary || seabed.primary === '식별 불가')) {
            console.log('[Ocean5] 저질 식별 불가 → zoom 13으로 줌아웃 재시도');
            const widerBuffer = await fetchKhoaWmsImage(latNum, lonNum, 13);
            if (widerBuffer) {
                const widerText = await analyzeImage(widerBuffer);
                const widerSeabed = parseSeabedResponse(widerText);
                // 재시도에서 기호를 찾았으면 채택, 수심은 1차 값 유지
                if (widerSeabed.primary && widerSeabed.primary !== '식별 불가') {
                    seabed.primary   = widerSeabed.primary;
                    seabed.secondary = widerSeabed.secondary;
                    if (!seabed.depth && widerSeabed.depth) {
                        seabed.depth     = widerSeabed.depth;
                        seabed.depthNote = widerSeabed.depthNote;
                    }
                    aiText = widerText;
                }
            }
        }

        res.json({ success: true, seabed, rawText: aiText });

    } catch (e) {
        console.error('[Ocean5] 저질 AI 판독 오류:', e.message, e.stack);
        const msg = e.message && e.message.length < 200 ? e.message : '저질 분석 중 오류가 발생했습니다.';
        res.status(500).json({ success: false, error: msg });
    }
});

module.exports = router;
