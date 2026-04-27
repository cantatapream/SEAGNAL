/**
 * ============================================================================
 * 파일명: routes/marine_chart.js
 * 역할: KMA 날씨누리 해상일기도 GIF 자료 메타데이터 프록시
 * ============================================================================
 *
 * [설명]
 * 기상청 날씨누리(weather.go.kr)가 일반 공개 페이지에 노출하는 해상일기도
 * GIF 자료의 "가용 시각 목록(JSON)" 만 받아서 그대로 클라이언트에 전달한다.
 * 이미지(GIF) 자체는 클라이언트가 KMA 호스트에서 직접 로드하므로 서버 부담 없음.
 *
 * - GET /api/marine-chart/list
 *     ?type=R3                       (영역 코드: G6/A6/R3/C/RWW3)
 *     &data=kim_rww3_wave_ft03_pa4_  (자료 prefix)
 *
 * [왜 프록시가 필요한가?]
 * KMA JSON 엔드포인트는 X-Requested-With + Referer 헤더 검증이 있어
 * 브라우저가 다른 출처에서 직접 호출하면 CORS 또는 차단으로 실패한다.
 * 서버에서 한 번 받아 그대로 전달하는 방식이 가장 가볍다(캐시 불필요).
 *
 * [업스트림]
 * https://www.weather.go.kr/w/wnuri-img/rest/cht/images/ocean-wave.do
 *
 * [응답 예시]
 * [
 *   {
 *     "name": "2026년 04월 26일 21 (KST) 지역(3시간간격) 해상풍과 파고-지역",
 *     "tm":   "2026042621",
 *     "stm":  "s000",
 *     "url":  "/w/repositary/image/cht/img/kim_rww3_wave_ft03_pa4_s000_2026042612.gif",
 *     "ftm":  "2026042621"
 *   },
 *   ...
 * ]
 *
 * url 은 KMA 도메인 기준 상대경로. 클라이언트에서 'https://www.weather.go.kr'
 * 를 prefix 로 붙여 <img src> 에 그대로 사용하면 된다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

const KMA_HOST = 'https://www.weather.go.kr';
const KMA_LIST_URL = `${KMA_HOST}/w/wnuri-img/rest/cht/images/ocean-wave.do`;
const KMA_REFERER = `${KMA_HOST}/w/image/chart/ocean/wave-model.do`;

// 허용 영역 코드 화이트리스트 (오타·임의값 방어)
const ALLOWED_TYPES = new Set(['G6', 'A6', 'R3', 'C', 'RWW3']);

// 자료 prefix 검증: 영문/숫자/언더스코어/대괄호만 허용 (KMA 카탈로그 패턴)
const DATA_PATTERN = /^[A-Za-z0-9_\[\]]+$/;

router.get('/api/marine-chart/list', async (req, res) => {
    const { type, data, area, stn } = req.query;

    if (!type || !ALLOWED_TYPES.has(type)) {
        return res.status(400).json({ error: 'invalid type' });
    }
    if (!data || !DATA_PATTERN.test(data)) {
        return res.status(400).json({ error: 'invalid data' });
    }

    // 연안 자료는 [AREA] 자리표시자를 실제 청 코드로 치환
    let dataParam = data;
    if (type === 'C' && area) {
        if (!/^[a-z]+$/.test(area)) {
            return res.status(400).json({ error: 'invalid area' });
        }
        dataParam = dataParam.replace('[AREA]', area);
    }
    // BUOY 스펙트럼류는 [STN] 도 같이 치환
    if (type === 'C' && stn) {
        if (!/^[A-Z0-9]+$/.test(stn)) {
            return res.status(400).json({ error: 'invalid stn' });
        }
        dataParam = dataParam.replace('[STN]', stn);
    }

    const params = new URLSearchParams({
        type,
        data: dataParam,
        unit: 'km/h',
        leaflet: '0',
        kmap: '0',
    });

    try {
        const upstream = await fetch(`${KMA_LIST_URL}?${params}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': KMA_REFERER,
            },
            timeout: 8000,
        });

        if (!upstream.ok) {
            return res.status(502).json({ error: `upstream ${upstream.status}` });
        }

        const list = await upstream.json();
        // KMA host 를 클라이언트가 그대로 쓸 수 있게 url 을 절대경로로 보강
        const enriched = Array.isArray(list)
            ? list.map(item => ({
                ...item,
                url: item.url && item.url.startsWith('/') ? KMA_HOST + item.url : item.url,
            }))
            : list;

        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(enriched);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
