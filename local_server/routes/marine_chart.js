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
// 카테고리별 KMA 엔드포인트
// - wave/surge/current: 해양 차트 계열 (cht/images/...)
// - sst: 위성 영상 계열 (sat/images/water-temp) — 다른 경로 + 다른 form 필드 (type 없음)
const KMA_ENDPOINTS = {
    wave:    `${KMA_HOST}/w/wnuri-img/rest/cht/images/ocean-wave.do`,
    surge:   `${KMA_HOST}/w/wnuri-img/rest/cht/images/ocean-forecast.do`,
    current: `${KMA_HOST}/w/wnuri-img/rest/cht/images/ocean-forecast.do`,
    sst:     `${KMA_HOST}/w/wnuri-img/rest/sat/images/water-temp.do`,
};
// 카테고리별 Referer (KMA 가 referer 검증 시 페이지 URL 일치 필요)
const KMA_REFERERS = {
    wave:    `${KMA_HOST}/w/image/chart/ocean/wave-model.do`,
    surge:   `${KMA_HOST}/w/image/chart/ocean/surge-height.do`,
    current: `${KMA_HOST}/w/image/chart/ocean/current.do`,
    sst:     `${KMA_HOST}/w/image/chart/ocean/water-temp.do`,
};

// 허용 영역 코드 화이트리스트 (오타·임의값 방어)
// wave: G6/A6/R3/C/RWW3, 그 외 카테고리: S(단기) / 해수면온도 영역코드(ea020lc, ko020lc)
const ALLOWED_TYPES = new Set(['G6', 'A6', 'R3', 'C', 'RWW3', 'S', 'ea020lc', 'ko020lc']);

// 허용 카테고리
const ALLOWED_CATS = new Set(['wave', 'surge', 'current', 'sst']);

// 자료 prefix 검증: 영문/숫자/언더스코어/대괄호만 허용 (KMA 카탈로그 패턴)
const DATA_PATTERN = /^[A-Za-z0-9_\[\]]+$/;

router.get('/api/marine-chart/list', async (req, res) => {
    const { type, data, area, stn, cat } = req.query;
    // 카테고리 (wave/surge/current/sst) — 미지정 시 wave 호환성 유지
    const category = cat && ALLOWED_CATS.has(cat) ? cat : 'wave';

    if (!type || !ALLOWED_TYPES.has(type)) {
        return res.status(400).json({ error: 'invalid type' });
    }
    if (!data || !DATA_PATTERN.test(data)) {
        return res.status(400).json({ error: 'invalid data' });
    }

    // 카테고리별로 KMA 가 받는 query 형식이 다름 — 분기 처리.
    let params;
    if (category === 'sst') {
        // 해수면온도는 위성영상 계열 — type 필드 없이 area + data 만 보냄.
        // 프론트의 state.type 을 KMA 의 area 로 매핑 (영역 코드 ea020lc/ko020lc).
        if (!/^[a-z0-9]+$/.test(type)) {
            return res.status(400).json({ error: 'invalid type for sst' });
        }
        params = new URLSearchParams({
            area: type,    // 프론트 type → KMA area
            data,
            unit: 'km/h',
            leaflet: '0',
            kmap: '0',
        });
    } else {
        // 해양차트 계열 (wave/surge/current) — type + data + 보조 파라미터
        // KMA 는 data 의 [AREA]/[STN] 자리표시자를 server-side 에서 치환.
        params = new URLSearchParams({
            type,
            data,
            unit: 'km/h',
            leaflet: '0',
            kmap: '0',
        });
        // 연안(C) 일 때만 area 전달 — wave 카테고리 한정
        if (category === 'wave' && type === 'C' && area) {
            if (!/^[a-z]+$/.test(area)) {
                return res.status(400).json({ error: 'invalid area' });
            }
            params.set('area', area);
        }
        // 해양순환은 area 가 수심 코드 (000/010 등 3자리 숫자)
        if (category === 'current' && area) {
            if (!/^[0-9]{3}$/.test(area)) {
                return res.status(400).json({ error: 'invalid area' });
            }
            params.set('area', area);
        }
        // BUOY 스펙트럼 / 폭풍해일 시계열-지방청 변수일 때 stn 전달
        if (stn) {
            if (!/^[A-Za-z0-9_]+$/.test(stn)) {
                return res.status(400).json({ error: 'invalid stn' });
            }
            params.set('stn', stn);
        }
    }

    const endpoint = KMA_ENDPOINTS[category];
    const referer = KMA_REFERERS[category];

    try {
        const upstream = await fetch(`${endpoint}?${params}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': referer,
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
