/**
 * ============================================================================
 * 파일명: routes/navigational_warning.js
 * 역할: 항행경보(국립해양조사원) 현황 조회 API — 현재 발효 중인 항행경보 목록 제공
 * ============================================================================
 *
 * [설명]
 * 국립해양조사원(KHOA)의 항행경보 API를 호출하여, 선박사고·표류장애물·
 * 수중장애물·해상사격훈련 등 현재 발효 중인 항행경보 목록(제목/발표기관/근거/본문)을
 * 제공합니다. 표지 위치 데이터(등대표)와 달리 실시간 통보문이라 서버에서
 * 짧은 주기로 캐시해 최신 상태를 유지합니다.
 *
 * - GET /api/navigational-warning/list → 현재 발효 중인 항행경보 목록
 *
 * [외부 API]
 * 엔드포인트: https://apis.data.go.kr/1192136/NavigationalWarning/getNavigationalWarningInfo
 * 인증키: ROMS_SERVICE_KEY 재사용 — data.go.kr 1192136(국립해양조사원) 그룹은
 *        ROMS·Buoy·NavigationalWarning API가 인증키를 공유한다(실측 확인).
 *
 * [연계 파일]
 * - server.js → router.use()로 연결
 * - data/api_config.json → ROMS_SERVICE_KEY(공유 인증키)
 * - js/marine-life/safety/navigational_warning.js → 이 API를 호출해 팝업 목록 표시
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { DATA_DIR } = require('../config/server_config');

const NAVWARN_API_URL = 'https://apis.data.go.kr/1192136/NavigationalWarning/getNavigationalWarningInfo';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30분 — 경보문이라 등대표보다 짧게

let _cache = null;      // { items, fetchedAt }

/** ROMS API와 동일한 서비스키를 읽어오는 함수(ocean2.js getRomsKey()와 동일 패턴) */
function getServiceKey() {
    if (process.env.ROMS_SERVICE_KEY) {
        return process.env.ROMS_SERVICE_KEY;
    }
    try {
        const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'api_config.json'), 'utf8'));
        return config.ROMS_SERVICE_KEY || '';
    } catch (e) {
        return '';
    }
}

/**
 * GET /api/navigational-warning/list
 *
 * 현재 발효 중인 항행경보 목록을 조회합니다(30분 캐시).
 *
 * [응답 예시]
 * {
 *   success: true,
 *   items: [{
 *     doc_num: "26-251", doc_type: "기타", gov_cd: "기타",
 *     noti_cat: "장애물", app_cat: "항행정보",
 *     title: "보령, 외연도 서방 전복선박 표류 알림",
 *     basic: "보령해양경찰서 경비구조과-4484(2026.7.24.)",
 *     content: "충남 보령시 외연도 서방 약 21해리 해상에서...",
 *     area: "1"
 *   }, ...]
 * }
 */
router.get('/api/navigational-warning/list', async (req, res) => {
    try {
        if (_cache && (Date.now() - _cache.fetchedAt) < CACHE_TTL_MS) {
            return res.json({ success: true, items: _cache.items });
        }

        const serviceKey = getServiceKey();
        if (!serviceKey) {
            return res.status(500).json({ success: false, error: '항행경보 API 키가 설정되지 않았습니다.' });
        }

        const url = `${NAVWARN_API_URL}?ServiceKey=${serviceKey}&type=json&numOfRows=100&pageNo=1`;
        const response = await fetch(url);
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            console.error('[NavWarn] 응답 파싱 실패:', text.substring(0, 200));
            return res.json({ success: false, error: '항행경보 API 응답 형식 오류' });
        }

        const header = data.header;
        if (!header || (header.resultCode !== '00' && header.resultCode !== '03')) {
            return res.json({ success: false, error: '항행경보 데이터를 가져올 수 없습니다.' });
        }

        // resultCode '03' = No Data(현재 발효 중인 경보 없음) — 정상 케이스, 빈 목록으로 처리
        const rawItems = data.body?.items?.item;
        const items = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];

        _cache = { items, fetchedAt: Date.now() };
        res.json({ success: true, items });
    } catch (err) {
        console.error('[NavWarn] 조회 실패:', err.message);
        res.json({ success: false, error: '항행경보 조회 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
