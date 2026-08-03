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
 * - GET /api/navigational-warning/list?date=YYYYMMDD → 지정 날짜(생략 시 오늘) 발효 중인
 *   항행경보 구역(zones) 목록. 같은 구역명(같은 물리적 구역)이 시간대만 다르게 여러
 *   문서/여러 번 나오면 하나로 합쳐 occurrences 배열에 담는다(라벨 겹침 방지). 구역마다
 *   날짜별 시간창 배열(windows, 모든 occurrence 합집합)을 함께 준다 — 클라이언트가
 *   "선택한 날짜의 특정 시각에 이 구역이 만료됐는지"를 판정하는 데 쓴다
 *   (날짜 내비게이션 + 시간 슬라이더).
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
const CACHE_TTL_MS = 30 * 60 * 1000;      // 30분 — 목록+구역 결합 결과 캐시(날짜별)
const SESSION_TTL_MS = 20 * 60 * 1000;    // 20분 — JSESSIONID 재발급 주기

const _cacheByDate = new Map();  // date(YYYYMMDD) → { zones, fetchedAt } — 날짜 내비게이션용
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

/** 공식 API — 지정한 날짜(YYYYMMDD)에 발효 중인 항행경보 텍스트 목록 */
async function _fetchOfficialList(dateYmd) {
    const serviceKey = getServiceKey();
    if (!serviceKey) throw new Error('항행경보 API 키가 설정되지 않았습니다.');

    const url = `${NAVWARN_API_URL}?ServiceKey=${serviceKey}&type=json&date=${dateYmd}&numOfRows=100&pageNo=1`;
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

/** 세션이 없거나 오래됐으면(SESSION_TTL_MS 초과) 새로 발급받고, 아니면 캐시된 쿠키를 그대로 준다 */
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

/** ALARM_MD_DETAIL("08/03,08/04")과 ALARM_TIME_DETAIL("00:00 ~ 08:00,18:00 ~ 23:59")을
 *  같은 순번끼리 짝지어, 날짜별로 묶은 뒤 줄바꿈으로 구분한 표시용 문자열을 만든다.
 *  예: "08/03 00:00 ~ 08:00, 18:00 ~ 23:59\n08/04 00:00 ~ 08:00" — 같은 날의 시간대는
 *  한 줄에 이어 쓰고, 날짜가 바뀌면 줄을 바꿔 가지런히 읽히게 한다. */
function _zipValidity(mdDetail, timeDetail) {
    if (!mdDetail || !timeDetail) return mdDetail || timeDetail || null;
    const dates = mdDetail.split(',').map(s => s.trim());
    const times = timeDetail.split(',').map(s => s.trim());
    if (dates.length !== times.length) return `${mdDetail} ${timeDetail}`;

    const byDate = new Map();
    dates.forEach((d, i) => {
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d).push(times[i]);
    });
    return Array.from(byDate.keys()).sort()
        .map(d => `${d} ${byDate.get(d).join(', ')}`)
        .join('\n');
}

/** "HH:MM ~ HH:MM" 한 조각을 하루 중 분(0~1439) 단위 [start, end]로 바꾼다.
 *  시작=끝(예: "00:00 ~ 00:00")이면 상시(하루 종일)로 보고 [0, 1439]를 반환한다. */
function _parseTimeRangeMin(str) {
    const m = (str || '').match(/(\d{2}):(\d{2})\s*~\s*(\d{2}):(\d{2})/);
    if (!m) return null;
    const start = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    let end = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
    if (end <= start) end = 1439; // 상시 또는 자정 넘어가는 경우 → 그날 자정까지로 처리
    return { start, end };
}

/** ALARM_DATE_DETAIL("2026-08-03,2026-08-04")과 ALARM_TIME_DETAIL을 날짜별
 *  시간창 배열로 만든다 — 클라이언트가 "선택한 날짜의 몇 시에 만료되는지" 판정하는 데 쓴다. */
function _buildWindows(dateDetail, timeDetail) {
    if (!dateDetail || !timeDetail) return [];
    const dates = dateDetail.split(',').map(s => s.trim());
    const times = timeDetail.split(',').map(s => s.trim());
    if (dates.length !== times.length) return [];

    return dates.map((iso, i) => {
        const range = _parseTimeRangeMin(times[i]);
        if (!range || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
        return { date: iso, start: range.start, end: range.end };
    }).filter(Boolean);
}

/** getDocAreaPoint.do 결과 한 건을 클라이언트가 쓰기 쉬운 zone 객체로 변환한다.
 *  occurrence(발표문 하나 분량 — 구분·발표기관·근거·본문·유효기간·시간창)를 함께 담아,
 *  이후 _mergeZonesByName() 이 같은 구역명끼리 occurrences 를 합칠 수 있게 한다. */
function _toZone(d, item) {
    return {
        name: d.POSITION_NM + (d.POS_ID ? `(${d.POS_ID})` : ''),
        chartNo: d.SEA_POS || null,
        type: (d.AREATYPE === '0') ? 'polygon' : 'circle',
        points: _parsePositions(d.POSITION),
        radiusNm: d.RADIUS ? parseFloat(d.RADIUS) : null,
        occurrence: {
            doc_num: item.doc_num,
            gov_cd: item.gov_cd,
            noti_cat: item.noti_cat,
            app_cat: item.app_cat,
            title: item.title,
            basic: item.basic,
            content: item.content,
            validity: _zipValidity(d.ALARM_MD_DETAIL, d.ALARM_TIME_DETAIL),
            windows: _buildWindows(d.ALARM_DATE_DETAIL, d.ALARM_TIME_DETAIL)
        }
    };
}

/** 같은 구역명(POSITION_NM+POS_ID — KHOA 공식 구역 코드라 안정적인 식별자)을 가진
 *  zone들을 하나로 합친다. 한 문서 안에서, 또는 서로 다른 문서 사이에서 같은 물리적
 *  구역이 시간대만 다르게 여러 번(예: 08~18시 / 18~24시) 반복되는 경우가 있는데,
 *  이걸 각각 별도 도형으로 그리면 라벨이 같은 자리에 겹쳐 뭉개진다(2026-08 사용자
 *  스크린샷으로 확인). 좌표는 첫 occurrence 것을 대표로 쓰고(같은 구역이므로 동일하다고
 *  가정), occurrences 는 배열로 모아 클라이언트가 팝업에서 항목별로 구분해 보여준다.
 *  windows 는 여러 occurrence의 시간창을 합쳐, "이 구역이 특정 시각에 만료됐는지"
 *  판정할 때 어느 occurrence 것이든 다 반영되게 한다. */
function _mergeZonesByName(zones) {
    const byName = new Map();
    zones.forEach((z) => {
        if (!byName.has(z.name)) {
            byName.set(z.name, { name: z.name, chartNo: z.chartNo, type: z.type, points: z.points, radiusNm: z.radiusNm, occurrences: [], windows: [] });
        }
        const merged = byName.get(z.name);
        merged.occurrences.push(z.occurrence);
        merged.windows.push(...z.occurrence.windows);
    });
    return Array.from(byName.values());
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

/** 지정한 날짜(YYYYMMDD)의 문서목록(ID 포함)을 받아 doc_num → ID 매핑을 만든다.
 *  실패하면 빈 맵(호출부는 이 경우 zones를 빈 배열로 두고 텍스트 목록만 보여준다) */
async function _fetchDocIdMap(dateYmd) {
    const listData = await _khoaPost('getDocList.do', {
        doctype: '', appcat: '', noticat: '', searchArea: '', searchtext: '', ordertype: '',
        lang: 'ko', menuType: 'navWarning',
        startdate: dateYmd, enddate: dateYmd, startnum: 1, endnum: 50
    });
    const map = {};
    (listData.RESULT_DATA || []).forEach((raw) => {
        map[_normalizeDocNum(raw.DOC_NUM)] = raw.ID;
    });
    return map;
}

/** 문서 하나(docId, item)의 구역 목록을 받아 zone 객체 배열로 변환한다(그릴 점이 없는 zone은 제외) */
async function _fetchZonesFor(docId, item) {
    const areaData = await _khoaPost('getDocAreaPoint.do', { id: docId, searchArea: '' });
    return (areaData.RESULT_DATA || []).map(d => _toZone(d, item)).filter(z => z.points.length > 0);
}

/**
 * GET /api/navigational-warning/list?date=YYYYMMDD
 *
 * 지정한 날짜(생략 시 오늘)에 발효 중인 항행경보 구역 목록을 반환한다(날짜별 30분
 * 캐시). 텍스트는 공식 API, 좌표는 KHOA 내부 API — 구역 보강이 실패하면 zones가
 * 빈 배열이 된다(전체 실패 아님). 같은 구역명을 가진 항목은 하나로 합쳐 occurrences
 * 배열에 담는다(§_mergeZonesByName 참고 — 같은 구역이 시간대만 다르게 반복되는
 * 경우 지도에 라벨이 겹치는 걸 막기 위함). 날짜 내비게이션(client)이 date 파라미터로
 * 다른 날짜를 조회한다.
 *
 * [응답 예시]
 * {
 *   success: true,
 *   zones: [{
 *     name: "대한해협-욕지도남방근해(D-72)", chartNo: "2200", type: "polygon",
 *     points: [{ lat: 34.16, lon: 128.0 }, ...], radiusNm: null,
 *     windows: [{ date: "2026-08-03", start: 540, end: 960 }, ...],
 *     occurrences: [{
 *       doc_num: "26-253", gov_cd: "합동참모본부", noti_cat: "해상사격", app_cat: "해상사격",
 *       title: "8월 1주 해상사격훈련(합동참모본부) 실시 알림", basic: "합동참모본부 합동화력과-...",
 *       content: "1. 합동참모본부...", validity: "08/03 09:00 ~ 16:00",
 *       windows: [{ date: "2026-08-03", start: 540, end: 960 }]
 *     }]
 *   }]
 * }
 */
router.get('/api/navigational-warning/list', async (req, res) => {
    try {
        const dateYmd = /^\d{8}$/.test(req.query.date || '') ? req.query.date : _todayYmd();

        const cached = _cacheByDate.get(dateYmd);
        if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
            return res.json({ success: true, zones: cached.zones });
        }

        const officialItems = await _fetchOfficialList(dateYmd);

        let docIdMap = {};
        try {
            docIdMap = await _fetchDocIdMap(dateYmd);
        } catch (e) {
            console.warn('[NavWarn] KHOA 내부 목록 조회 실패(구역 보강 생략):', e.message);
        }

        const zonesByItem = await Promise.all(officialItems.map(async (raw) => {
            const item = {
                doc_num: raw.doc_num, gov_cd: raw.gov_cd, noti_cat: raw.noti_cat, app_cat: raw.app_cat,
                title: raw.title, basic: raw.basic, content: raw.content
            };
            const docId = docIdMap[raw.doc_num];
            if (!docId) return [];
            try {
                return await _fetchZonesFor(docId, item);
            } catch (e) {
                console.warn('[NavWarn] 구역 조회 실패 (doc_num=' + raw.doc_num + '):', e.message);
                return [];
            }
        }));

        const zones = _mergeZonesByName(zonesByItem.flat());

        _cacheByDate.set(dateYmd, { zones, fetchedAt: Date.now() });
        res.json({ success: true, zones });
    } catch (err) {
        console.error('[NavWarn] 조회 실패:', err.message);
        res.json({ success: false, error: '항행경보 조회 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
