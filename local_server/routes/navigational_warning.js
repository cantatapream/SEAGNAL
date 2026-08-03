/**
 * ============================================================================
 * 파일명: routes/navigational_warning.js
 * 역할: 항행경보(국립해양조사원) 현황 조회 API — 오늘 발효 중인 항행경보 목록 +
 *       구역별 위경도(원형/다각형) 제공
 * ============================================================================
 *
 * [설명]
 * 텍스트(제목/본문/발표기관/구분)는 data.go.kr 공식 오픈API(getNavigationalWarningInfo,
 * ROMS_SERVICE_KEY 공유)로 받는다 — 이 API는 안정적이고 한글 텍스트가 깨끗하다.
 * 다만 이 API엔 좌표·구역명이 없다. 실제 좌표·구역명은 국립해양조사원
 * "항행경보 상황판" 웹사이트(nwb.khoa.go.kr)가 화면에 그릴 때 쓰는 내부
 * (미문서화) API에만 있어, doc_num으로 매칭해 구역(zones)만 그쪽에서 보강한다.
 *
 * ⚠ 주의: 아래 KHOA_* 함수가 부르는 API는 data.go.kr 처럼 서비스키·이용약관이
 *   있는 공식 오픈API가 아니라, 웹사이트 자바스크립트(main.js)가 쓰는 내부
 *   AJAX 엔드포인트다. 예고 없이 응답 구조가 바뀌거나 접근이 막힐 수 있다
 *   (2026-08 사용자 확인 후 위험 감수하고 채택). 그래서 텍스트는 공식 API로만
 *   받고, 이 내부 API는 좌표 보강에만 쓴다 — 내부 API가 막혀도 목록 자체는
 *   그대로 나오고 zones만 빈 배열이 된다(부분 실패, 전체 실패 아님).
 *
 * - GET /api/navigational-warning/list → 오늘 발효 중인 항행경보 + (가능하면) 구역 좌표
 *
 * [내부 API 흐름 — 구역 보강용]
 * 1. GET  https://www.khoa.go.kr/nwb/mainPage.do?lang=ko  → JSESSIONID 세션 획득
 * 2. POST https://www.khoa.go.kr/nwb/getDocList.do        → 오늘자 문서 ID 목록
 *    (DOC_NUM "제26-251호" 를 공식 API의 doc_num "26-251" 과 매칭)
 * 3. POST https://www.khoa.go.kr/nwb/getDocAreaPoint.do    → 문서별 구역명/좌표/반경
 *
 * [연계 파일]
 * - server.js → router.use()로 연결
 * - data/api_config.json → ROMS_SERVICE_KEY(공식 API 인증키, ocean2.js 와 공유)
 * - js/marine-life/safety/navigational_warning.js → 이 API를 호출해 지도에 표시
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { DATA_DIR } = require('../config/server_config');

const NAVWARN_API_URL = 'https://apis.data.go.kr/1192136/NavigationalWarning/getNavigationalWarningInfo';
const KHOA_BASE = 'https://www.khoa.go.kr/nwb';
const CACHE_TTL_MS = 30 * 60 * 1000;      // 30분 — 목록+구역 결합 결과 캐시
const SESSION_TTL_MS = 20 * 60 * 1000;    // 20분 — JSESSIONID 재발급 주기

let _cache = null;      // { items, fetchedAt }
let _session = null;    // { cookie, obtainedAt }

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

/** 공식 API — 오늘 발효 중인 항행경보 텍스트 목록 */
async function _fetchOfficialList() {
    const serviceKey = getServiceKey();
    if (!serviceKey) throw new Error('항행경보 API 키가 설정되지 않았습니다.');

    const url = `${NAVWARN_API_URL}?ServiceKey=${serviceKey}&type=json&numOfRows=100&pageNo=1`;
    const response = await fetch(url);
    const text = await response.text();
    const data = JSON.parse(text);

    const header = data.header;
    if (!header || (header.resultCode !== '00' && header.resultCode !== '03')) {
        throw new Error('항행경보 데이터를 가져올 수 없습니다.');
    }
    const rawItems = data.body?.items?.item;
    return rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];
}

// ── 아래부터는 좌표 보강용 KHOA 내부(미문서화) API ──────────────────────────

/** mainPage.do 를 방문해 JSESSIONID 를 새로 받는다 */
async function _bootstrapSession() {
    const res = await fetch(`${KHOA_BASE}/mainPage.do?lang=ko`);
    const setCookie = res.headers.raw()['set-cookie'] || [];
    const jsessionCookie = setCookie.map(c => c.split(';')[0]).find(c => c.startsWith('JSESSIONID='));
    if (!jsessionCookie) throw new Error('JSESSIONID 발급 실패');
    _session = { cookie: jsessionCookie, obtainedAt: Date.now() };
    return _session.cookie;
}

async function _getSessionCookie() {
    if (_session && (Date.now() - _session.obtainedAt) < SESSION_TTL_MS) {
        return _session.cookie;
    }
    return _bootstrapSession();
}

/** KHOA 내부 AJAX(POST, form-urlencoded, JSON 응답)를 호출한다. 세션 만료로
 *  보이면 한 번 재발급 후 재시도한다. */
async function _khoaPost(pathName, formData) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const cookie = await _getSessionCookie();
        const body = new URLSearchParams(formData).toString();
        const res = await fetch(`${KHOA_BASE}/${pathName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${KHOA_BASE}/mainPage.do?lang=ko`,
                'Cookie': cookie
            },
            body
        });
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            if (attempt === 0) { _session = null; continue; } // 세션 만료 추정 → 재발급 후 재시도
            throw new Error('KHOA 내부 API 응답이 JSON이 아님');
        }
        if (data.RESULT_CODE !== '000' && attempt === 0) {
            _session = null;
            continue;
        }
        return data;
    }
    throw new Error('KHOA 내부 API 호출 실패');
}

/** "34-09-41N,128-00-00E" 형태의 DMS 좌표 한 조각을 십진수로 변환 */
function _parseDms(token) {
    const m = token.trim().match(/^(\d{1,3})-(\d{1,2})-(\d{1,2})([NSEW])$/);
    if (!m) return null;
    const deg = parseInt(m[1], 10) + parseInt(m[2], 10) / 60 + parseInt(m[3], 10) / 3600;
    const dir = m[4];
    return (dir === 'S' || dir === 'W') ? -deg : deg;
}

/** POSITION 텍스트(줄마다 "위도,경도", 원형은 한 줄만) → [{lat, lon}, ...] */
function _parsePositions(positionText) {
    if (!positionText) return [];
    return positionText.split(/\r\n|\r|\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const parts = line.split(',').map(s => s.trim()).filter(Boolean);
            if (parts.length !== 2) return null;
            const lat = _parseDms(parts[0]);
            const lon = _parseDms(parts[1]);
            if (lat === null || lon === null) return null;
            return { lat, lon };
        })
        .filter(Boolean);
}

/** ALARM_MD_DETAIL("08/03,08/04")과 ALARM_TIME_DETAIL("00:00~08:00,18:00~23:59")을
 *  같은 순번끼리 짝지어 "08/03 00:00~08:00, 08/04 18:00~23:59" 형태로 합친다.
 *  하루에 시간대가 여러 개면 그 날짜가 여러 번 나오는 게 정상(짝을 맞추기 위함). */
function _zipValidity(mdDetail, timeDetail) {
    if (!mdDetail || !timeDetail) return mdDetail || timeDetail || null;
    const dates = mdDetail.split(',');
    const times = timeDetail.split(',');
    if (dates.length !== times.length) return `${mdDetail} ${timeDetail}`;
    return dates.map((d, i) => `${d.trim()} ${times[i].trim()}`).join(', ');
}

/** getDocAreaPoint.do 결과 한 건을 클라이언트가 쓰기 쉬운 zone 객체로 변환 */
function _toZone(d) {
    return {
        name: d.POSITION_NM + (d.POS_ID ? `(${d.POS_ID})` : ''),
        chartNo: d.SEA_POS || null,
        type: (d.AREATYPE === '0') ? 'polygon' : 'circle',
        points: _parsePositions(d.POSITION),
        radiusNm: d.RADIUS ? parseFloat(d.RADIUS) : null,
        validity: _zipValidity(d.ALARM_MD_DETAIL, d.ALARM_TIME_DETAIL)
    };
}

/** 오늘 날짜(YYYYMMDD, 서버 로컬 시간 기준) */
function _todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}

/** doc_num("26-251")과 매칭하도록 KHOA DOC_NUM("제26-251호")에서 제/호를 뗀다 */
function _normalizeDocNum(khoaDocNum) {
    return (khoaDocNum || '').replace(/^제/, '').replace(/호$/, '').trim();
}

/** 오늘자 문서목록(ID 포함)을 받아 doc_num → ID 매핑을 만든다. 실패하면 빈 맵
 *  (호출부는 이 경우 zones를 빈 배열로 두고 텍스트 목록만 보여준다) */
async function _fetchDocIdMap() {
    const today = _todayYmd();
    const listData = await _khoaPost('getDocList.do', {
        doctype: '', appcat: '', noticat: '', searchArea: '', searchtext: '', ordertype: '',
        lang: 'ko', menuType: 'navWarning',
        startdate: today, enddate: today, startnum: 1, endnum: 50
    });
    const map = {};
    (listData.RESULT_DATA || []).forEach((raw) => {
        map[_normalizeDocNum(raw.DOC_NUM)] = raw.ID;
    });
    return map;
}

async function _fetchZonesFor(docId) {
    const areaData = await _khoaPost('getDocAreaPoint.do', { id: docId, searchArea: '' });
    return (areaData.RESULT_DATA || []).map(_toZone).filter(z => z.points.length > 0);
}

/**
 * GET /api/navigational-warning/list
 *
 * 오늘 발효 중인 항행경보 목록(공식 API)에, 가능하면 구역 좌표(KHOA 내부 API)를
 * 보강해 반환한다(30분 캐시). 구역 보강이 실패해도 텍스트 목록은 정상 반환한다.
 */
router.get('/api/navigational-warning/list', async (req, res) => {
    try {
        if (_cache && (Date.now() - _cache.fetchedAt) < CACHE_TTL_MS) {
            return res.json({ success: true, items: _cache.items });
        }

        const officialItems = await _fetchOfficialList();

        let docIdMap = {};
        try {
            docIdMap = await _fetchDocIdMap();
        } catch (e) {
            console.warn('[NavWarn] KHOA 내부 목록 조회 실패(구역 보강 생략):', e.message);
        }

        const items = await Promise.all(officialItems.map(async (raw) => {
            let zones = [];
            const docId = docIdMap[raw.doc_num];
            if (docId) {
                try {
                    zones = await _fetchZonesFor(docId);
                } catch (e) {
                    console.warn('[NavWarn] 구역 조회 실패 (doc_num=' + raw.doc_num + '):', e.message);
                }
            }
            return {
                doc_num: raw.doc_num,
                gov_cd: raw.gov_cd,
                noti_cat: raw.noti_cat,
                app_cat: raw.app_cat,
                title: raw.title,
                basic: raw.basic,
                content: raw.content,
                zones
            };
        }));

        _cache = { items, fetchedAt: Date.now() };
        res.json({ success: true, items });
    } catch (err) {
        console.error('[NavWarn] 조회 실패:', err.message);
        res.json({ success: false, error: '항행경보 조회 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
