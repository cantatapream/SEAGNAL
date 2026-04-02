const fs = require('fs');
const path = require('path');
const https = require('https');

// [Push] Firebase Admin 초기화
const admin = require('firebase-admin');

try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('🔥 Firebase Admin 초기화 완료');
} catch (e) {
    console.warn('⚠️ Firebase serviceAccountKey.json 없음 (FCM 불가):', e.message);
}

// [Time Correction] 서버 시각 오차 보정용
let timeDriftOffset = 0;

async function syncTime() {
    return new Promise((resolve) => {
        const start = Date.now();
        const req = https.request('https://www.google.com', { method: 'HEAD', timeout: 5000 }, (res) => {
            const end = Date.now();
            const dateStr = res.headers.date;
            if (dateStr) {
                const globalTime = new Date(dateStr).getTime();
                const latency = (end - start) / 2;
                const trueTime = globalTime + latency;
                timeDriftOffset = trueTime - Date.now();
                if (Math.abs(timeDriftOffset) > 1000) {
                    log(`🕒 서버 시각 오차 감지 및 보정 (Offset: ${Math.round(timeDriftOffset / 1000)}초)`);
                }
            }
            resolve();
        });
        req.on('error', (e) => {
            log(`🕒 시각 동기화 실패: ${e.message}`);
            resolve();
        });
        req.end();
    });
}

function getCorrectedDate() {
    return new Date(Date.now() + timeDriftOffset);
}

function getNowStr() {
    return getCorrectedDate().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function log(msg) {
    console.log(`[${getNowStr()}] ${msg}`);
}

// [Admin] 크롤링 일시정지 플래그 (메모리 기반, 서버 재시작 시 자동 해제)
let crawlPaused = false;

// [Progress] 수집 진행 상황 이벤트 시스템
const EventEmitter = require('events');
const collectProgress = new EventEmitter();
collectProgress.setMaxListeners(20);

const lastRunStatus = {
    buoys: { lastRun: null, status: '대기 중', message: '' },
    general: { lastRun: null, status: '대기 중', message: '' },
    zone: { lastRun: null, status: '대기 중', message: '' },
    fishing: { lastRun: null, status: '대기 중', message: '' },  // 해양생활기상 (바다낚시 지수)
    seaSplit: { lastRun: null, status: '대기 중', message: '' }, // 바다갈라짐 체험지수
    surfing: { lastRun: null, status: '대기 중', message: '' }   // 서핑지수
};

const CONFIG_FILE = path.join(__dirname, 'data/api_config.json');

const CONFIG = {
    KMA_HUB_KEY: 'ZKEQU5ukRvGhEFObpBbxVw', // 기본값
    DATA_DIR: path.join(__dirname, 'data'),
    URLS: {
        BUOY: 'https://apihub.kma.go.kr/api/typ01/url/sea_obs.php',
        KMA_BUOY: 'https://apihub.kma.go.kr/api/typ01/url/kma_buoy.php',
        SEA_FORECAST: 'https://apihub.kma.go.kr/api/typ01/url/fct_afs_dl.php',
        SEA_ZONE_LARGE: 'https://apihub.kma.go.kr/api/typ06/url/marine_large_zone.php'
    }
};

// [Config Management] 인증키 동적 로드
function loadApiConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const fileData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (fileData.KMA_HUB_KEY) CONFIG.KMA_HUB_KEY = fileData.KMA_HUB_KEY;
        }
    } catch (e) {
        log(`⚠️ API 설정 로드 실패: ${e.message}`);
    }
}
loadApiConfig();

const marineForecastProcessor = require('./marine_forecast_processor');
const regionalForecastCollector = require('./regional_forecast_collector');

const DUCKDNS_CONFIG = {
    ENABLED: !process.env.FLY_ALLOC_ID,
    DOMAIN: 'seagnal',
    TOKEN: '481d08d8-641b-4ff3-8217-314fe1cbbaeb'
};

if (!fs.existsSync(CONFIG.DATA_DIR)) {
    fs.mkdirSync(CONFIG.DATA_DIR);
}

async function updateDuckDNS() {
    if (!DUCKDNS_CONFIG.ENABLED) return;
    try {
        const url = `https://www.duckdns.org/update?domains=${DUCKDNS_CONFIG.DOMAIN}&token=${DUCKDNS_CONFIG.TOKEN}&ip=`;
        await fetch(url);
    } catch (e) {
        console.error('DuckDNS Update Error:', e.message);
    }
}

const PROD_DATA_DIR = path.join(__dirname, '../../Production/local_server/data');
const IS_FLY_IO = !!process.env.FLY_ALLOC_ID;
const PROD_API_BASE = 'https://seagnal-server.fly.dev';

function saveData(filename, data) {
    const jsonStr = JSON.stringify(data, null, 2);
    try {
        fs.writeFileSync(path.join(CONFIG.DATA_DIR, filename), jsonStr);
        if (!IS_FLY_IO && fs.existsSync(PROD_DATA_DIR)) {
            fs.writeFileSync(path.join(PROD_DATA_DIR, filename), jsonStr);
        }
    } catch (e) { }
}

function getUtcTm(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    return `${y}${m}${d}${h}`;
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (e) {
        clearTimeout(id);
        throw e;
    }
}

// 1. 부이 수집
async function collectBuoys() {
    try {
        collectProgress.emit('progress', { type: 'buoys', step: '부이 데이터', current: 1, total: 2, detail: '관측 부이' });
        const url = `${CONFIG.URLS.BUOY}?stn=0&help=0&authKey=${CONFIG.KMA_HUB_KEY}`;
        const response = await fetchWithTimeout(url, {}, 8000);
        const buffer = await response.arrayBuffer();
        const text = new TextDecoder('euc-kr').decode(buffer);
        saveData('buoys.json', { updatedAt: getNowStr(), raw: text });
        lastRunStatus.buoys = { lastRun: getNowStr(), status: '성공', message: '데이터 저장 완료' };
    } catch (e) {
        log(`⚠️ KMA 직접 수집 실패, 프로덕션 프록시 시도: ${e.message}`);
        try {
            const res = await fetchWithTimeout(`${PROD_API_BASE}/api/buoys`, {}, 8000);
            const data = await res.json();
            saveData('buoys.json', data);
            lastRunStatus.buoys = { lastRun: getNowStr(), status: '성공', message: '프로덕션 프록시' };
        } catch (e2) {
            lastRunStatus.buoys = { lastRun: getNowStr(), status: '실패', message: e2.message };
        }
    }
}

// 1-2. 해양기상부이 상세 데이터 수집 (최대/유의/평균 파고)
async function collectKmaBuoys() {
    try {
        collectProgress.emit('progress', { type: 'buoys', step: '부이 데이터', current: 2, total: 2, detail: '해양기상부이' });
        const url = `${CONFIG.URLS.KMA_BUOY}?stn=0&help=0&authKey=${CONFIG.KMA_HUB_KEY}`;
        const response = await fetchWithTimeout(url, {}, 8000);
        const buffer = await response.arrayBuffer();
        const text = new TextDecoder('euc-kr').decode(buffer);
        saveData('kma_buoys.json', { updatedAt: getNowStr(), raw: text });
    } catch (e) {
        log(`⚠️ KMA 부이 상세 직접 수집 실패: ${e.message}`);
        // 프로덕션에 kma-buoys API가 있으면 프록시, 없으면 무시
        try {
            const res = await fetchWithTimeout(`${PROD_API_BASE}/api/kma-buoys`, {}, 8000);
            if (res.ok) {
                const data = await res.json();
                saveData('kma_buoys.json', data);
            }
        } catch (e2) {
            log(`⚠️ KMA 부이 상세 프록시 수집도 실패: ${e2.message}`);
        }
    }
}

// 2. 기상예보 수집
const SEA_FORECAST_ZONES = [
    '12B10304', '12B10302', '12B10301', '12B10303', '12B10300', '12B10400',
    '12A20101', '12A20102', '12A20103', '12A20104', '12A20100', '12A20200',
    '12A30100', '12A30200', '12A10100', '12A10200',
    '12B10101', '12B10102', '12B10100', '12B10200',
    '12B20101', '12B20102', '12B20103', '12B20104', '12B20100', '12B20200',
    '12C10101', '12C10102', '12C10103', '12C10100', '12C10200',
    '12C20101', '12C20102', '12C20103', '12C10100', '12C20200',
    '12C30100', '12C30200',
    '22A30101', '22A30102', '22A30103', '22A30104', '22A30105'
];

async function collectGeneralForecasts() {
    try {
        const results = {};
        const total = SEA_FORECAST_ZONES.length;
        for (let i = 0; i < total; i++) {
            const regId = SEA_FORECAST_ZONES[i];
            collectProgress.emit('progress', { type: 'general', step: '단기예보', current: i + 1, total, detail: `구역 ${regId}` });
            const url = `https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstMsgService/getSeaFcst?pageNo=1&numOfRows=30&dataType=JSON&regId=${regId}&authKey=${CONFIG.KMA_HUB_KEY}`;
            const res = await fetchWithTimeout(url, {}, 8000);
            const data = await res.json();
            if (data.response?.body?.items?.item) {
                results[regId] = Array.isArray(data.response.body.items.item) ? data.response.body.items.item : [data.response.body.items.item];
            }
            await new Promise(r => setTimeout(r, 50));
        }
        saveData('general_forecasts.json', { updatedAt: getNowStr(), data: results, count: Object.keys(results).length });
        lastRunStatus.general = { lastRun: getNowStr(), status: '성공', message: `${Object.keys(results).length}개 구역 저장` };
    } catch (e) {
        log(`⚠️ 기상예보 직접 수집 실패, 프로덕션 프록시 시도: ${e.message}`);
        try {
            const res = await fetchWithTimeout(`${PROD_API_BASE}/api/forecasts`, {}, 8000);
            const data = await res.json();
            saveData('general_forecasts.json', data);
            lastRunStatus.general = { lastRun: getNowStr(), status: '성공', message: '프로덕션 프록시' };
        } catch (e2) {
            lastRunStatus.general = { lastRun: getNowStr(), status: '실패', message: e2.message };
        }
    }
}

// 4. 해구별 기상전망 (UTC Manual)
let isCollectingZone = false;
function parseKmaTable(text) {
    const rows = [];
    const lines = text.trim().split('\n');
    let header = [];
    for (const line of lines) {
        if (line.startsWith('#')) {
            if (line.includes('TMA_FC')) { header = line.substring(1).trim().split(/\s+/); }
            continue;
        }
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) continue;
        const row = {};
        header.forEach((h, i) => { row[h] = parts[i]; });
        if (row.LZONE) {
            rows.push({
                tm: row.TMA_FC, lzone: row.LZONE,
                wh: parseFloat(row.WH_SIG), wp: parseFloat(row.WVPRD_MAX),
                waveDir: parseFloat(row.WVDR), ws: parseFloat(row.WS), windDir: parseFloat(row.WD)
            });
        }
    }
    return rows;
}
async function collectZoneForecasts() {
    if (isCollectingZone) return;
    isCollectingZone = true;
    try {
        const now = new Date();
        const latestUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
        if (latestUtc.getUTCHours() < 12) latestUtc.setUTCHours(0, 0, 0, 0);
        else latestUtc.setUTCHours(12, 0, 0, 0);

        let validBaseTm = null;
        for (let i = 0; i <= 3; i++) {
            const searchDate = new Date(latestUtc.getTime() - i * 12 * 60 * 60 * 1000);
            const tm = getUtcTm(searchDate);
            const url = `${CONFIG.URLS.SEA_ZONE_LARGE}?tma_fc=${tm}&tma_ef=${tm}&Lzone=0&disp=0&help=0&authKey=${CONFIG.KMA_HUB_KEY}`;
            try {
                const response = await fetchWithTimeout(url, {}, 5000);
                const buffer = await response.arrayBuffer();
                const text = new TextDecoder('euc-kr').decode(buffer);
                if (response.ok && text.includes('#START7777')) {
                    validBaseTm = tm;
                    break;
                }
            } catch (e) { }
        }

        if (validBaseTm) {
            const zoneDataMap = {};
            const baseDate = new Date(Date.UTC(parseInt(validBaseTm.substring(0, 4)), parseInt(validBaseTm.substring(4, 6)) - 1, parseInt(validBaseTm.substring(6, 8)), parseInt(validBaseTm.substring(8, 10))));

            const zoneSteps = Math.floor(75 / 3) + 1; // 26 steps
            for (let h = 0; h <= 75; h += 3) {
                const stepIdx = h / 3 + 1;
                collectProgress.emit('progress', { type: 'zone', step: '해구별 예보', current: stepIdx, total: zoneSteps, detail: `+${h}시간` });
                const efDate = new Date(baseDate.getTime() + h * 60 * 60 * 1000);
                const tm_ef = getUtcTm(efDate);
                const url = `${CONFIG.URLS.SEA_ZONE_LARGE}?tma_fc=${validBaseTm}&tma_ef=${tm_ef}&Lzone=0&disp=0&help=0&authKey=${CONFIG.KMA_HUB_KEY}`;
                try {
                    const response = await fetchWithTimeout(url, {}, 8000);
                    const buffer = await response.arrayBuffer();
                    const text = new TextDecoder('euc-kr').decode(buffer);
                    if (text.includes('#START7777')) {
                        const rows = parseKmaTable(text);
                        rows.forEach(row => {
                            row.tm = tm_ef;
                            if (!zoneDataMap[row.lzone]) zoneDataMap[row.lzone] = [];
                            zoneDataMap[row.lzone].push(row);
                        });
                    }
                } catch (e) { }
                await new Promise(r => setTimeout(r, 200));
            }
            if (Object.keys(zoneDataMap).length > 0) {
                saveData('zone_forecasts.json', { updatedAt: getNowStr(), baseTmUtf: validBaseTm, data: zoneDataMap, count: Object.keys(zoneDataMap).length });
                lastRunStatus.zone = { lastRun: getNowStr(), status: '성공', message: `${Object.keys(zoneDataMap).length}개 구역 저장` };
            }
        }
    } catch (e) {
        log(`⚠️ 해구별 예보 직접 수집 실패, 프로덕션 프록시 시도: ${e.message}`);
        try {
            const res = await fetchWithTimeout(`${PROD_API_BASE}/api/marine-zone-forecasts`, {}, 8000);
            const data = await res.json();
            saveData('zone_forecasts.json', data);
            lastRunStatus.zone = { lastRun: getNowStr(), status: '성공', message: '프로덕션 프록시' };
        } catch (e2) {
            lastRunStatus.zone = { lastRun: getNowStr(), status: '실패', message: e2.message };
        }
    } finally { isCollectingZone = false; }
}

// 5. 중기해상예보 수집 (getMidSeaFcst)
const MID_TERM_SEA_REG_IDS = [
    '12A10000', // 서해북부
    '12A20000', // 서해중부
    '12A30000', // 서해남부
    '12B10000', // 남해서부
    '12B20000', // 남해동부
    '12C10000', // 동해남부
    '12C20000', // 동해중부
    '12C30000', // 동해북부
];

async function collectMidTermSeaForecasts() {
    try {
        // 최근 06:00 또는 18:00 KST 발표시각 계산
        const now = getCorrectedDate();
        const kst = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000));
        const kstHour = kst.getHours();
        let tmFcDate = new Date(kst);

        if (kstHour >= 18) {
            tmFcDate.setHours(18, 0, 0, 0);
        } else if (kstHour >= 6) {
            tmFcDate.setHours(6, 0, 0, 0);
        } else {
            // 전날 18시
            tmFcDate.setDate(tmFcDate.getDate() - 1);
            tmFcDate.setHours(18, 0, 0, 0);
        }

        const tmFc = `${tmFcDate.getFullYear()}${String(tmFcDate.getMonth() + 1).padStart(2, '0')}${String(tmFcDate.getDate()).padStart(2, '0')}${String(tmFcDate.getHours()).padStart(2, '0')}00`;

        const results = {};
        const MAX_RETRIES = 3;
        const TIMEOUT_MS = 30000; // 30초 (기상청 API 응답 지연 대비)
        const midTotal = MID_TERM_SEA_REG_IDS.length;
        for (let mi = 0; mi < midTotal; mi++) {
            const regId = MID_TERM_SEA_REG_IDS[mi];
            collectProgress.emit('progress', { type: 'general', step: '중기예보', current: mi + 1, total: midTotal, detail: `구역 ${regId}` });
            const url = `https://apihub.kma.go.kr/api/typ02/openApi/MidFcstInfoService/getMidSeaFcst?pageNo=1&numOfRows=10&dataType=JSON&regId=${regId}&tmFc=${tmFc}&authKey=${CONFIG.KMA_HUB_KEY}`;
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const res = await fetchWithTimeout(url, {}, TIMEOUT_MS);
                    const data = await res.json();
                    if (data.response?.body?.items?.item) {
                        const items = Array.isArray(data.response.body.items.item)
                            ? data.response.body.items.item
                            : [data.response.body.items.item];
                        results[regId] = items[0];
                    }
                    break; // 성공 시 재시도 루프 탈출
                } catch (e) {
                    if (attempt < MAX_RETRIES) {
                        const delay = attempt * 2000; // 2초, 4초 대기 후 재시도
                        log(`⚠️ 중기해상예보 ${regId} ${attempt}/${MAX_RETRIES}회 실패, ${delay/1000}초 후 재시도: ${e.message}`);
                        await new Promise(r => setTimeout(r, delay));
                    } else {
                        log(`⚠️ 중기해상예보 ${regId} ${MAX_RETRIES}회 모두 실패: ${e.message}`);
                    }
                }
            }
            await new Promise(r => setTimeout(r, 50));
        }

        if (Object.keys(results).length > 0) {
            saveData('mid_term_sea_forecasts.json', {
                updatedAt: getNowStr(),
                tmFc: tmFc,
                data: results,
                count: Object.keys(results).length
            });
            log(`✅ 중기해상예보 수집 완료: ${Object.keys(results).length}개 구역`);
        } else {
            log('⚠️ 중기해상예보 데이터 없음');
        }
    } catch (e) {
        log(`⚠️ 중기해상예보 수집 실패: ${e.message}`);
    }
}

// ============================================================================
// 바다낚시 지수 수집 (국립해양조사원 공공데이터포털 API)
// ============================================================================
// [설명]
// 국립해양조사원의 바다낚시지수 API(fcstFishingv2)를 호출하여
// 갯바위/선상별 전국 낚시 포인트의 예보 데이터를 수집합니다.
// 수집된 데이터는 위치별로 그룹핑되어 fishing_index.json으로 저장됩니다.
//
// [연계]
// - cache_manager.js → fishingIndex 키로 메모리 캐시
// - routes/fishing.js → GET /api/fishing-index 엔드포인트에서 클라이언트에 제공
// - js/fishing.js (프론트엔드) → 지도 마커 및 바텀시트 렌더링에 사용
//
// [API 갱신 주기] 하루 2회 (오전/오후)
// [수집 스케줄] 06:30, 18:30 (발표 직후 여유를 두고 수집)
// ============================================================================

// 바다낚시 지수 API 인증키 (공공데이터포털 발급)
const FISHING_API_KEY = 'PmxnR43icJwR7yzKjG612RncLikLD1RvZpPLgEJqUUx0vGQncdfuT9VjiqBlgiXMdcjyKopi4yvUPaPbcdIUfg==';
const FISHING_API_BASE = 'https://apis.data.go.kr/1192136/fcstFishingv2/GetFcstFishingApiServicev2';

/**
 * 바다낚시 지수 데이터 수집 메인 함수
 * - API 1회 호출로 갯바위+선상 전체 데이터를 수집
 * - 위치명 패턴("(숫자km)")으로 갯바위/선상 자동 분류
 * - 수집된 데이터를 fishing_index.json으로 저장
 * - 실패 시 lastRunStatus.fishing에 오류 정보 기록
 *
 * [연계] routes/fishing.js → /api/fishing-index, js/fishing.js → 지도 마커
 */
async function collectFishingIndex() {
    try {
        log('🎣 바다낚시 지수 수집 시작...');

        // 진행률 이벤트 발행 (admin 수동 호출 시 SSE 스트림으로 전달)
        // total=6: 낚시지수 3단계(1~3) + 바다갈라짐 3단계(4~6) — 해양생활기상 통합 호출
        collectProgress.emit('progress', { type: 'fishing', step: '바다낚시 지수', current: 1, total: 6, detail: 'API 호출 중' });

        // API는 gubun 파라미터와 무관하게 갯바위+선상 전체 데이터를 반환하므로
        // 1회만 호출하고 위치명 패턴으로 분류 (선상: "항구명(Xkm)" 패턴)
        const SHIP_PATTERN = /\(\d+km\)/; // 선상 위치는 "(숫자km)" 패턴 포함

        const result = {
            updatedAt: getNowStr(),
            갯바위: {},
            선상: {}
        };

        const items = await _fetchFishingData('갯바위');

        // 진행률 이벤트: API 응답 수신 완료, 데이터 가공 시작
        collectProgress.emit('progress', { type: 'fishing', step: '바다낚시 지수', current: 2, total: 6, detail: '데이터 가공 중' });

        if (!items || items.length === 0) {
            log('⚠️ 바다낚시 데이터 없음');
        } else {
            // 응답 데이터를 위치명 패턴으로 갯바위/선상 분류 후 그룹핑
            items.forEach(item => {
                    const placeName = item.seafsPstnNm;
                    if (!placeName) return;

                    // 위치명에 "(숫자km)" 패턴 포함 → 선상, 없으면 → 갯바위
                    const gubun = SHIP_PATTERN.test(placeName) ? '선상' : '갯바위';

                    // API 응답의 날짜 형식: "YYYY-MM-DD" → "YYYYMMDD"로 변환
                    const dateStr = item.predcYmd ? item.predcYmd.replace(/-/g, '') : '';

                    // 해당 위치가 처음 등장하면 초기 객체 생성
                    if (!result[gubun][placeName]) {
                        result[gubun][placeName] = {
                            lat: parseFloat(item.lat) || 0,    // 위도
                            lot: parseFloat(item.lot) || 0,    // 경도
                            forecasts: {},                      // 날짜별 예보 데이터
                            etcFishList: ''                     // 기타어종 목록 (갯바위만)
                        };
                    }

                    const place = result[gubun][placeName];

                    // 해당 날짜의 예보 객체 초기화
                    if (!place.forecasts[dateStr]) {
                        place.forecasts[dateStr] = {};
                    }

                    // 오전/오후/일(종일) 구분하여 저장
                    const timeSlot = item.predcNoonSeCd; // '오전', '오후', 또는 '일'
                    if (!place.forecasts[dateStr][timeSlot]) {
                        place.forecasts[dateStr][timeSlot] = {
                            totalIndex: '',   // 종합 낚시 지수
                            items: [],        // 어종별 상세 (갯바위만)
                            minWvhgt: '',     // 최저 파고 (m)
                            maxWvhgt: '',     // 최고 파고 (m)
                            minWtem: '',      // 최저 수온 (°C)
                            maxWtem: '',      // 최고 수온 (°C)
                            minArtmp: '',     // 최저 기온 (°C)
                            maxArtmp: '',     // 최고 기온 (°C)
                            minCrsp: '',      // 최저 유속 (kn)
                            maxCrsp: '',      // 최고 유속 (kn)
                            minWspd: '',      // 최저 풍속 (m/s)
                            maxWspd: '',      // 최고 풍속 (m/s)
                            tdlvHrCn: ''      // 물때 정보
                        };
                    }

                    const slot = place.forecasts[dateStr][timeSlot];

                    // 공통 기상 데이터 (동일 시간대에서 첫 번째 데이터로 설정)
                    if (!slot.minWvhgt) {
                        slot.minWvhgt = item.minWvhgt || '';
                        slot.maxWvhgt = item.maxWvhgt || '';
                        slot.minWtem = item.minWtem || '';
                        slot.maxWtem = item.maxWtem || '';
                        slot.minArtmp = item.minArtmp || '';
                        slot.maxArtmp = item.maxArtmp || '';
                        slot.minCrsp = item.minCrsp || '';
                        slot.maxCrsp = item.maxCrsp || '';
                        slot.minWspd = item.minWspd || '';
                        slot.maxWspd = item.maxWspd || '';
                        slot.tdlvHrCn = item.tdlvHrCn || '';
                    }

                    // 어종별 상세 데이터 추가 (갯바위만 seafsTgfshNm 존재)
                    if (item.seafsTgfshNm) {
                        slot.items.push({
                            fishName: item.seafsTgfshNm,     // 어종명
                            totalIndex: item.totalIndex || '' // 해당 어종의 낚시 지수
                        });

                        // 기타어종 목록 추출 (첫 등장 시에만 기록)
                        if (item.seafsTgfshNm === '기타어종' && !place.etcFishList) {
                            place.etcFishList = '부시리,광어,전갱이,고등어,망상어,학공치,무늬오징어,갑오징어,갈치,도다리,가자미,숭어,꼴뚜기,붕장어,한치,보리멸,청어';
                        }
                    } else {
                        // 선상: 어종 데이터 없이 totalIndex만 존재
                        if (!slot.totalIndex && item.totalIndex) {
                            slot.totalIndex = item.totalIndex;
                        }
                    }

                });

                // 종합 지수 설정: 전체 어종의 totalIndex 중 최빈값(가장 많이 나오는 값) 사용
                // 동일 빈도일 경우 더 보수적(나쁜) 등급을 대표로 선정
                const levelOrder = { '매우나쁨': 1, '나쁨': 2, '보통': 3, '좋음': 4, '매우좋음': 5 };
                ['갯바위', '선상'].forEach(g => {
                    Object.values(result[g]).forEach(pl => {
                        Object.values(pl.forecasts).forEach(dateFc => {
                            Object.values(dateFc).forEach(slot => {
                                if (slot.items && slot.items.length > 0) {
                                    const freq = {};
                                    slot.items.forEach(si => {
                                        if (si.totalIndex) freq[si.totalIndex] = (freq[si.totalIndex] || 0) + 1;
                                    });
                                    let modeLevel = '';
                                    let modeCount = 0;
                                    Object.keys(freq).forEach(lv => {
                                        if (freq[lv] > modeCount || (freq[lv] === modeCount && (levelOrder[lv] || 0) < (levelOrder[modeLevel] || 0))) {
                                            modeLevel = lv;
                                            modeCount = freq[lv];
                                        }
                                    });
                                    if (modeLevel) slot.totalIndex = modeLevel;
                                }
                            });
                        });
                    });
                });
        }

        // 수집된 날짜 분포 분석 (디버깅용)
        const dateAnalysis = {};
        ['갯바위', '선상'].forEach(g => {
            const dateSet = new Set();
            Object.values(result[g]).forEach(pl => {
                Object.keys(pl.forecasts).forEach(d => dateSet.add(d));
            });
            dateAnalysis[g] = Array.from(dateSet).sort();
        });
        log(`🎣 바다낚시 날짜 분포 - 갯바위: ${dateAnalysis['갯바위'].join(',')} (${dateAnalysis['갯바위'].length}일), 선상: ${dateAnalysis['선상'].join(',')} (${dateAnalysis['선상'].length}일)`);

        // 진행률 이벤트: 파일 저장 단계
        collectProgress.emit('progress', { type: 'fishing', step: '바다낚시 지수', current: 3, total: 6, detail: '저장 중' });

        // JSON 파일로 저장 (data/fishing_index.json)
        saveData('fishing_index.json', result);
        lastRunStatus.fishing = {
            lastRun: getNowStr(),
            status: '성공',
            message: `갯바위 ${Object.keys(result['갯바위']).length}개소(${dateAnalysis['갯바위'].length}일), 선상 ${Object.keys(result['선상']).length}개소(${dateAnalysis['선상'].length}일)`
        };
        log(`✅ 바다낚시 지수 수집 완료 (갯바위: ${Object.keys(result['갯바위']).length}, 선상: ${Object.keys(result['선상']).length})`);

    } catch (e) {
        lastRunStatus.fishing = { lastRun: getNowStr(), status: '실패', message: e.message };
        log(`⚠️ 바다낚시 지수 수집 실패: ${e.message}`);
    }
}

/**
 * 바다낚시 API 호출 함수 (페이지네이션 포함)
 * @param {string} gubun 구분 ('갯바위' 또는 '선상')
 * @returns {Array} API 응답의 전체 items 배열 (실패 시 빈 배열)
 *
 * [설명]
 * 국립해양조사원 API를 호출하여 해당 구분의 전체 낚시 포인트 데이터를 가져옵니다.
 * reqDate 미지정 시 현재일 기준 7일치 데이터가 반환됩니다.
 * numOfRows 최대값이 300이므로, 전체 데이터를 가져오기 위해 페이지를 순회합니다.
 *
 * [연계] collectFishingIndex()에서 호출
 */
async function _fetchFishingData(gubun) {
    const allItems = [];
    const encodedKey = encodeURIComponent(FISHING_API_KEY);
    let pageNo = 1;
    const numOfRows = 300; // API 최대값

    try {
        while (true) {
            const params = new URLSearchParams({
                numOfRows: String(numOfRows),
                pageNo: String(pageNo),
                type: 'json',
                gubun: gubun
            });
            const url = `${FISHING_API_BASE}?serviceKey=${encodedKey}&${params.toString()}`;
            const response = await fetchWithTimeout(url, {}, 30000);

            if (!response.ok) {
                log(`⚠️ 바다낚시 API 응답 오류 (${gubun}, p${pageNo}): HTTP ${response.status}`);
                break;
            }

            const data = await response.json();

            // 결과코드 검증
            if (data?.header?.resultCode !== '00') {
                log(`⚠️ 바다낚시 API 오류 (${gubun}): ${data?.header?.resultMsg}`);
                break;
            }

            const items = data?.body?.items?.item;
            if (!items) break;

            // 단건 응답인 경우 배열로 감싸기
            const arr = Array.isArray(items) ? items : [items];
            allItems.push(...arr);

            // 전체 건수 대비 현재까지 수집량 확인 → 다음 페이지 필요 여부
            const totalCount = data?.body?.totalCount || 0;
            log(`🎣 바다낚시 ${gubun} p${pageNo}: ${arr.length}건 수신 (누적 ${allItems.length}/${totalCount})`);

            // 종료 조건: 반환 건수가 numOfRows 미만이면 마지막 페이지
            if (arr.length < numOfRows) break;

            pageNo++;
            // 안전장치: 최대 10페이지까지만 (3000건)
            if (pageNo > 10) break;
        }

        log(`🎣 바다낚시 ${gubun} API 수집: ${allItems.length}건 (${pageNo}페이지)`);
        return allItems;
    } catch (e) {
        log(`⚠️ 바다낚시 API 호출 실패 (${gubun}): ${e.message}`);
        return allItems; // 이미 수집한 데이터는 반환
    }
}

// ========================================================================
// 바다갈라짐 체험지수 수집
// ========================================================================

// 바다갈라짐 API 설정 (바다낚시와 동일한 인증키 사용)
const SEA_SPLIT_API_BASE = 'https://apis.data.go.kr/1192136/fcstSeaSplitv2/GetFcstSeaSplitApiServicev2';

// 14개 전체 지점 목록 (코드 순서 기준, 데이터 없는 지점 안내용)
const SEA_SPLIT_ALL_PLACES = [
    'SD1:진도', 'SD2:무창포', 'SD4:제부도', 'SD5:서건도', 'SD6:실미도',
    'SD7:하섬', 'SD8:웅도', 'SD9:소야도', 'SD10:소매물도', 'SD11:동섬',
    'SD19:우도', 'SD20:선재도', 'SD21:화도', 'SD22:대섬'
];

/**
 * 바다갈라짐 체험지수 데이터 수집 함수
 *
 * [설명]
 * 국립해양조사원 바다갈라짐 API를 호출하여 전국 지점의 7일간 예보 데이터를 수집합니다.
 * numOfRows=300으로 1회 호출 시 대부분 전체 데이터를 수신하며, 초과 시 페이지 순회합니다.
 * 수집된 데이터를 지점명 기준으로 그룹핑하고, 날짜별로 정리하여 JSON 파일로 저장합니다.
 *
 * [데이터 구조]
 * {
 *   updatedAt: '수집 시점',
 *   allPlaces: ['진도','무창포',...],  // 14개 전체 지점명 (데이터 없는 지점 안내용)
 *   places: {
 *     '실미도': {
 *       lat: 37.40252, lot: 126.39808,
 *       forecasts: {
 *         '2026-04-01': [
 *           { bgng: '09:00', end: '14:02', minArtmp: '7.9', maxArtmp: '9.0',
 *             minWspd: '0.7', maxWspd: '7.4', weather: '흐림', totalIndex: '보통' }
 *         ],
 *         '2026-04-06': [       // 같은 날 2구간 가능
 *           { bgng: '09:00', end: '09:22', ... totalIndex: '나쁨' },
 *           { bgng: '14:19', end: '18:00', ... totalIndex: '보통' }
 *         ]
 *       }
 *     }
 *   }
 * }
 *
 * [연계] routes/fishing.js → /api/sea-split-index, js/sea_parting.js → UI 렌더링
 */
async function collectSeaSplitIndex() {
    try {
        log('🛤️ 바다갈라짐 체험지수 수집 시작...');

        // 진행률 이벤트 발행 (관리자 수동 수집 시 SSE 스트림으로 전달)
        // type을 'fishing'으로 통일 — 해양생활기상 통합 호출 시 같은 SSE 스트림으로 전달되도록
        collectProgress.emit('progress', { type: 'fishing', step: '바다갈라짐 지수', current: 4, total: 6, detail: 'API 호출 중' });

        const items = await _fetchSeaSplitData();

        collectProgress.emit('progress', { type: 'fishing', step: '바다갈라짐 지수', current: 5, total: 6, detail: '데이터 가공 중' });

        // ── 발표시각 판단을 위해 기존 저장 데이터를 읽어옴 ──
        // 이전에 저장된 sea_split_index.json을 읽어서 예보 데이터(places)가 바뀌었는지 비교
        // 바뀌었으면 "데이터가 갱신된 시점"의 정시를, 안 바뀌었으면 기존 발표시각을 유지
        let previousData = null;
        try {
            const prevPath = path.join(CONFIG.DATA_DIR, 'sea_split_index.json');
            if (fs.existsSync(prevPath)) {
                previousData = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
            }
        } catch (readErr) {
            // 파일 읽기 실패 시 previousData = null → "변경됨"으로 처리 (안전하게)
            log(`⚠️ 기존 바다갈라짐 데이터 읽기 실패 (최초 실행 또는 파일 손상): ${readErr.message}`);
        }

        // 결과 객체 초기화 (updatedAt은 아래에서 데이터 비교 후 결정)
        const result = {
            updatedAt: '', // 데이터 비교 후 설정됨
            allPlaces: SEA_SPLIT_ALL_PLACES.map(s => s.split(':')[1]), // ['진도','무창포',...]
            places: {}
        };

        if (!items || items.length === 0) {
            log('⚠️ 바다갈라짐 데이터 없음 (전 지점 갈라짐 없음)');
        } else {
            // API 응답을 지점명 기준으로 그룹핑
            items.forEach(item => {
                const placeName = item.splocPstnNm;
                if (!placeName) return;

                // 해당 지점이 처음 등장하면 초기 객체 생성
                if (!result.places[placeName]) {
                    result.places[placeName] = {
                        lat: parseFloat(item.lat) || 0,
                        lot: parseFloat(item.lot) || 0,
                        forecasts: {}
                    };
                }

                const place = result.places[placeName];
                const dateStr = item.predcYmd || ''; // 'YYYY-MM-DD' 형식

                // 해당 날짜의 예보 배열 초기화 (같은 날 2구간 가능하므로 배열)
                if (!place.forecasts[dateStr]) {
                    place.forecasts[dateStr] = [];
                }

                // 시간 구간별 데이터 추가
                place.forecasts[dateStr].push({
                    bgng: item.splocBgngDt || '',       // 체험 시작 시간 (HH:MM)
                    end: item.splocEndDt || '',          // 체험 종료 시간 (HH:MM)
                    minArtmp: item.minArtmp || '',       // 최저기온 (°C)
                    maxArtmp: item.maxArtmp || '',       // 최고기온 (°C)
                    minWspd: item.minWspd || '',         // 최저풍속 (m/s)
                    maxWspd: item.maxWspd || '',         // 최고풍속 (m/s)
                    weather: item.weather || '',         // 날씨 (맑음, 흐림, 구름많음 등)
                    totalIndex: item.totalIndex || ''    // 바다갈라짐 체험지수 (5단계)
                });
            });
        }

        // 수집 결과 로그
        const placeNames = Object.keys(result.places);
        log(`🛤️ 바다갈라짐 수집 완료: ${placeNames.length}개 지점 (${placeNames.join(', ')})`);

        // 데이터 없는 지점 목록 로그
        const missingPlaces = result.allPlaces.filter(n => !result.places[n]);
        if (missingPlaces.length > 0) {
            log(`🛤️ 바다갈라짐 미발생 지점: ${missingPlaces.join(', ')}`);
        }

        collectProgress.emit('progress', { type: 'fishing', step: '바다갈라짐 지수', current: 6, total: 6, detail: '저장 중' });

        // ── 발표시각 결정: 이전 데이터와 비교하여 변경 여부 판단 ──
        // places 객체(예보 데이터 본체)만 비교 — updatedAt/allPlaces는 비교 대상이 아님
        // JSON 문자열로 변환하여 비교 (객체 구조가 동일해도 참조가 다르므로)
        const newPlacesStr = JSON.stringify(result.places);
        const oldPlacesStr = previousData ? JSON.stringify(previousData.places) : null;
        const isDataChanged = (oldPlacesStr === null) || (newPlacesStr !== oldPlacesStr);

        if (isDataChanged) {
            // 데이터가 바뀌었으므로 현재 시각의 "정시"를 발표시각으로 기록
            // 예: 13:35에 변경 감지 → "2026. 4. 2. PM 01:00:00"
            const now = getCorrectedDate();
            const kstMs = now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000);
            const kstDate = new Date(kstMs);
            // 분/초/밀리초를 0으로 만들어 정시로 변환
            kstDate.setMinutes(0, 0, 0);
            const yyyy = kstDate.getFullYear();
            const mm = kstDate.getMonth() + 1;
            const dd = kstDate.getDate();
            const hh = kstDate.getHours();
            const ampm = hh < 12 ? 'AM' : 'PM';
            const hh12 = hh === 0 ? 12 : (hh > 12 ? hh - 12 : hh);
            // "2026. 4. 2. AM 09:00:00" 형식으로 포맷
            result.updatedAt = `${yyyy}. ${mm}. ${dd}. ${ampm} ${String(hh12).padStart(2, '0')}:00:00`;
            log(`🛤️ 바다갈라짐 데이터 변경 감지 → 발표시각 갱신: ${result.updatedAt}`);
        } else {
            // 데이터가 동일하므로 기존 발표시각을 그대로 유지
            result.updatedAt = previousData.updatedAt;
            log(`🛤️ 바다갈라짐 데이터 변경 없음 → 기존 발표시각 유지: ${result.updatedAt}`);
        }

        // JSON 파일로 저장
        saveData('sea_split_index.json', result);
        lastRunStatus.seaSplit = {
            lastRun: getNowStr(),
            status: '성공',
            message: `${placeNames.length}개 지점, 미발생 ${missingPlaces.length}개`
        };

    } catch (e) {
        lastRunStatus.seaSplit = { lastRun: getNowStr(), status: '실패', message: e.message };
        log(`⚠️ 바다갈라짐 체험지수 수집 실패: ${e.message}`);
    }
}

/**
 * 바다갈라짐 API 호출 함수 (페이지네이션 포함)
 * @returns {Array} API 응답의 전체 items 배열 (실패 시 빈 배열)
 *
 * [설명]
 * numOfRows=300(최대값)으로 호출하며, totalCount가 300을 초과하면 다음 페이지를 순회합니다.
 * 현재 7일간 예보 × 14지점이므로 약 70~100건이 일반적이며 1회 호출로 충분합니다.
 *
 * [연계] collectSeaSplitIndex()에서 호출
 */
async function _fetchSeaSplitData() {
    const allItems = [];
    const encodedKey = encodeURIComponent(FISHING_API_KEY); // 낚시와 동일한 API 키 사용
    let pageNo = 1;
    const numOfRows = 300;

    try {
        while (true) {
            const params = new URLSearchParams({
                numOfRows: String(numOfRows),
                pageNo: String(pageNo),
                type: 'json'
            });
            const url = `${SEA_SPLIT_API_BASE}?serviceKey=${encodedKey}&${params.toString()}`;
            const response = await fetchWithTimeout(url, {}, 30000);

            if (!response.ok) {
                log(`⚠️ 바다갈라짐 API 응답 오류 (p${pageNo}): HTTP ${response.status}`);
                break;
            }

            const data = await response.json();

            if (data?.header?.resultCode !== '00') {
                log(`⚠️ 바다갈라짐 API 오류: ${data?.header?.resultMsg}`);
                break;
            }

            const items = data?.body?.items?.item;
            if (!items) break;

            const arr = Array.isArray(items) ? items : [items];
            allItems.push(...arr);

            const totalCount = data?.body?.totalCount || 0;
            log(`🛤️ 바다갈라짐 p${pageNo}: ${arr.length}건 수신 (누적 ${allItems.length}/${totalCount})`);

            if (arr.length < numOfRows) break;
            pageNo++;
            if (pageNo > 10) break; // 안전장치
        }

        return allItems;
    } catch (e) {
        log(`⚠️ 바다갈라짐 API 호출 실패: ${e.message}`);
        return allItems;
    }
}

// ============================================================================
// 서핑지수 수집
// ============================================================================

/**
 * 서핑 API 기본 URL 및 API 키
 * - 낚시지수와 동일한 국립해양조사원 인증키 사용
 * - 서핑지수 API: fcstSurfingv2 (낚시: fcstFishingv2)
 */
const SURFING_API_BASE = 'https://apis.data.go.kr/1192136/fcstSurfingv2/GetFcstSurfingApiServicev2';

/**
 * 16개 서핑 해수욕장별 해구번호 및 특보구역 매핑 (백엔드 저장용)
 *
 * - zone: zone_forecasts.json의 해구 키 (풍향/풍속/파고 조회에 사용)
 * - alert: weather_alerts.json의 말단 구역명 (해상특보 조회에 사용)
 *
 * [해구번호 결정 근거]
 * 해수욕장 GPS 좌표 → 해구도 격자 매핑
 * 5xxx 연안 격자(파고=0)는 인접 근해 해구 번호로 대체
 * 사용자 직접 지정: 월포(816), 진하(923), 다대포(927), 남열(977), 만리포(1644), 월정리(223)
 */
const SURFING_BEACH_META = {
    '송지호해수욕장':     { zone: '55',   alert: '강원북부앞바다' },
    '죽도해수욕장':       { zone: '62',   alert: '강원북부앞바다' },
    '경포해수욕장':       { zone: '63',   alert: '강원북부앞바다' },
    '금진해수욕장':       { zone: '63',   alert: '강원중부앞바다' },
    '망상해수욕장':       { zone: '63',   alert: '강원남부앞바다' },
    '월포해수욕장':       { zone: '816',  alert: '경북남부앞바다' },
    '진하해수욕장':       { zone: '923',  alert: '울산앞바다' },
    '송정해수욕장':       { zone: '92',   alert: '부산앞바다' },
    '다대포해수욕장':     { zone: '927',  alert: '부산앞바다' },
    '송정솔바람해수욕장': { zone: '98',   alert: '경남서부남해앞바다' },
    '남열해수욕장':       { zone: '977',  alert: '전남동부남해앞바다' },
    '명사십리해수욕장':   { zone: '213',  alert: '전남서부남해앞바다' },
    '만리포해수욕장':     { zone: '1644', alert: '충남북부앞바다' },
    '곽지해수욕장':       { zone: '232',  alert: '제주도북부앞바다' },
    '월정리해수욕장':     { zone: '223',  alert: '제주도동부앞바다' },
    '중문색달해수욕장':   { zone: '232',  alert: '제주도남부앞바다' }
};

/**
 * 서핑지수를 수집하여 surfing_index.json에 저장합니다.
 *
 * [동작 흐름]
 * 1. 서핑 API를 페이지네이션으로 전체 호출 (최대 480건, 2페이지)
 * 2. 해수욕장명 기준으로 그룹핑
 *    - 날짜(predcYmd) → 시간대(predcNoonSeCd: 오전/오후/일) → 등급(grdCn)
 * 3. SURFING_BEACH_META에서 해구번호와 특보구역 매핑
 * 4. data/surfing_index.json으로 저장
 *
 * [저장 구조]
 * {
 *   updatedAt: "2026.04.02 09:00",
 *   beaches: {
 *     "경포해수욕장": {
 *       lat, lot, zone: "63", alert: "강원북부앞바다",
 *       forecasts: {
 *         "20260402": {
 *           "오전": { avgWvhgt, avgWvpd, avgWspd, avgWtem, grades: { 초급:"매우좋음", 중급:"보통", 상급:"나쁨" } },
 *           "오후": { ... }
 *         },
 *         "20260405": { "일": { ... } }   // D+3 이후 종일
 *       }
 *     }
 *   }
 * }
 *
 * [호출 시점]
 * - 서버 시작 시 init() → Promise.all 병렬 실행
 * - 매일 06:30, 18:30 (낚시지수와 동일한 API 발표 직후)
 *
 * [연계]
 * - cache_manager.js → surfingIndex 키로 메모리 캐시
 * - routes/fishing.js → GET /api/surfing-index 엔드포인트
 * - js/surfing1.js (프론트엔드) → _loadSurfingData()에서 fetch
 */
async function collectSurfingIndex() {
    try {
        log('🏄 서핑지수 수집 시작...');

        // 페이지네이션으로 전체 데이터 수집
        const allItems = await _fetchSurfingData();
        if (allItems.length === 0) {
            log('⚠️ 서핑지수 수집: 수신 데이터 없음');
            lastRunStatus.surfing = { lastRun: getNowStr(), status: '실패', message: '수신 데이터 없음' };
            return;
        }

        // 해수욕장명 기준으로 데이터 그룹핑
        // API는 1개 해수욕장 × 1개 날짜 × 1개 시간대 × 1개 등급 = 1행으로 반환
        // 즉, 경포해수욕장 오전 초급/중급/상급 = 3행
        const beaches = {};

        allItems.forEach(item => {
            const name = item.surfPlcNm;  // 해수욕장명 (예: '경포해수욕장')
            if (!name) return;

            // 해수욕장 기본 정보 초기화 (최초 등장 시)
            if (!beaches[name]) {
                const meta = SURFING_BEACH_META[name] || {};
                beaches[name] = {
                    lat: item.lat,
                    lot: item.lot,
                    zone: meta.zone || '',
                    alert: meta.alert || '',
                    forecasts: {}
                };
            }

            // 날짜 키: "20260402" 형식
            const dateStr = item.predcYmd ? item.predcYmd.replace(/-/g, '') : null;
            if (!dateStr) return;

            if (!beaches[name].forecasts[dateStr]) {
                beaches[name].forecasts[dateStr] = {};
            }

            // 시간대 키: '오전', '오후', 또는 '일'(종일)
            // API 응답의 predcNoonSeCd: '오전', '오후', '일'
            const slot = item.predcNoonSeCd || '일';

            if (!beaches[name].forecasts[dateStr][slot]) {
                // 시간대별 기상 평균값 저장 (초급/중급/상급 공통값)
                beaches[name].forecasts[dateStr][slot] = {
                    avgWvhgt: item.avgWvhgt || '',  // 평균 파고 (m)
                    avgWvpd:  item.avgWvpd  || '',  // 평균 파주기 (sec)
                    avgWspd:  item.avgWspd  || '',  // 평균 풍속 (m/s)
                    avgWtem:  item.avgWtem  || '',  // 평균 수온 (°C)
                    grades: {}
                };
            }

            // 등급별 서핑지수 저장 (grdCn: '초급'/'중급'/'상급')
            const grade = item.grdCn;  // '초급', '중급', '상급'
            if (grade) {
                beaches[name].forecasts[dateStr][slot].grades[grade] = item.totalIndex || '';
            }
        });

        // JSON 파일로 저장 (data/surfing_index.json)
        const result = {
            updatedAt: getNowStr(),
            beaches
        };
        saveData('surfing_index.json', result);

        lastRunStatus.surfing = {
            lastRun: getNowStr(),
            status: '성공',
            message: `${Object.keys(beaches).length}개 해수욕장 저장 완료`
        };
        log(`✅ 서핑지수 수집 완료 (${Object.keys(beaches).length}개 해수욕장)`);

    } catch (e) {
        lastRunStatus.surfing = { lastRun: getNowStr(), status: '실패', message: e.message };
        log(`⚠️ 서핑지수 수집 실패: ${e.message}`);
    }
}

/**
 * 서핑지수 API를 페이지네이션으로 전체 호출합니다.
 *
 * [페이지네이션 이유]
 * API 1회 최대 응답: numOfRows=300건
 * 실제 데이터: 16해수욕장 × 3등급 × 7일 × 평균 1.5시간대 ≈ 480건
 * → 2페이지 필요 (300 + 180)
 *
 * [연계] collectSurfingIndex()에서 호출
 *
 * @returns {Array} 전체 API 응답 items 배열
 */
async function _fetchSurfingData() {
    const allItems = [];
    const encodedKey = encodeURIComponent(FISHING_API_KEY); // 낚시지수와 동일한 API 키
    let pageNo = 1;
    const numOfRows = 300;

    try {
        while (true) {
            const params = new URLSearchParams({
                numOfRows: String(numOfRows),
                pageNo: String(pageNo),
                type: 'json'
            });
            const url = `${SURFING_API_BASE}?serviceKey=${encodedKey}&${params.toString()}`;
            const response = await fetchWithTimeout(url, {}, 30000);

            if (!response.ok) {
                log(`⚠️ 서핑지수 API 응답 오류 (p${pageNo}): HTTP ${response.status}`);
                break;
            }

            const data = await response.json();

            if (data?.header?.resultCode !== '00') {
                log(`⚠️ 서핑지수 API 오류: ${data?.header?.resultMsg}`);
                break;
            }

            const items = data?.body?.items?.item;
            if (!items) break;

            const arr = Array.isArray(items) ? items : [items];
            allItems.push(...arr);

            const totalCount = data?.body?.totalCount || 0;
            log(`🏄 서핑지수 p${pageNo}: ${arr.length}건 수신 (누적 ${allItems.length}/${totalCount})`);

            // 더 이상 가져올 데이터가 없으면 종료
            if (arr.length < numOfRows) break;
            pageNo++;
            if (pageNo > 10) break; // 안전장치 (무한루프 방지)
        }

        return allItems;
    } catch (e) {
        log(`⚠️ 서핑지수 API 호출 실패: ${e.message}`);
        return allItems;
    }
}

// [Note] 기존 특보 수집(collectWarnings) 및 해구별 예보(collectZoneForecasts) 로직은 제거됨.
// 특보는 weather_alerts_crawler.js가 전담.

async function init() {
    // [중요] 외부 서버와 시각 동기화
    await syncTime();

    log('🚀 스케줄러 가동 (Lite Version: Buoys & Forecasts Only)');
    log('📡 부이/예보 데이터 수집 시작...');

    updateDuckDNS();

    const startTime = Date.now();

    try {
        await Promise.all([
            collectBuoys().then(() => log('✅ 부이 데이터 수집 완료')),
            collectKmaBuoys().then(() => log('✅ 부이 상세(파고) 데이터 수집 완료')),
            collectGeneralForecasts().then(() => log('✅ 일반예보 데이터 수집 완료')),
            collectZoneForecasts().then(() => log('✅ 해구별 예보 데이터 수집 완료')),
            collectMidTermSeaForecasts(),
            marineForecastProcessor.collectMarineForecasts().then(() => log('✅ 해상 기상 전망 수집 완료')),
            regionalForecastCollector.collectRegionalForecasts().then(() => log('✅ 지방기상청 단기예보 수집 완료')),
            collectFishingIndex().then(() => log('✅ 바다낚시 지수 수집 완료')),
            collectSeaSplitIndex().then(() => log('✅ 바다갈라짐 체험지수 수집 완료')),
            collectSurfingIndex().then(() => log('✅ 서핑지수 수집 완료'))
        ]);
    } catch (e) {
        log(`⚠️ 일부 수집 중 오류: ${e.message}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`🎉 초기 데이터 수집 완료! (소요시간: ${elapsed}초)`);

    setInterval(updateDuckDNS, 30 * 60 * 1000);

    const weatherAlertsCrawler = require('./weather_alerts_crawler'); // 크롤러 모듈 추가

    // ... (중략) ...

    // 1분 주기 작업 (실제로는 부이/예보/특보 주기 체크)
    setInterval(async () => {
        await syncTime();
        const now = getCorrectedDate();
        // KST 기준으로 시/분 계산 (서버가 UTC여도 정상 동작하도록)
        const kstMs = now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000);
        const kstDate = new Date(kstMs);
        const hm = `${String(kstDate.getHours()).padStart(2, '0')}:${String(kstDate.getMinutes()).padStart(2, '0')}`;
        const min = kstDate.getMinutes();

        // 부이: 매시 5분, 35분
        if (min % 30 === 5) {
            collectBuoys();
            collectKmaBuoys();
        }

        // 기상예보: 하루 2회 (05:15, 17:15)
        if (['05:15', '17:15'].includes(hm)) collectGeneralForecasts();

        // [복구] 해구별 기상전망: 하루 4회
        if (['02:00', '08:00', '14:00', '20:00'].includes(hm)) collectZoneForecasts();

        // 중기해상예보: 하루 2회 (06:15, 18:15)
        if (['06:15', '18:15'].includes(hm)) collectMidTermSeaForecasts();

        // 바다낚시 지수: 하루 2회 (06:30, 18:30) - API 발표 직후 수집
        if (['06:30', '18:30'].includes(hm)) collectFishingIndex();

        // 서핑지수: 하루 2회 (06:30, 18:30) - 낚시지수와 동일한 API 발표 주기
        if (['06:30', '18:30'].includes(hm)) collectSurfingIndex();

        // 바다갈라짐 체험지수: 매시 35분 (1시간 간격)
        if (min === 35) collectSeaSplitIndex();

        // 지방기상청 단기예보: 발표 주기(05, 11, 17시) +10분에 수집
        if (['05:10', '11:10', '17:10'].includes(hm)) {
            regionalForecastCollector.collectRegionalForecasts()
                .then(() => log('✅ 지방기상청 단기예보 수집 완료'))
                .catch(err => log(`⚠️ 지방기상청 단기예보 수집 오류: ${err.message}`));
        }

        // 지방기상청 단기예보: 미수집 지방청 재시도 (30분 간격)
        if (min % 30 === 10 && !['05:10', '11:10', '17:10'].includes(hm)) {
            regionalForecastCollector.retryMissingOffices()
                .catch(err => log(`⚠️ 지방기상청 재수집 오류: ${err.message}`));
        }

        // [New] 특보 정보 크롤링 (매 1분 마다 실행)
        // 사용자 요청: 실시간성 확보를 위해 1분 주기로 단축
        if (!crawlPaused) {
            log('🔎 기상특보 크롤러 실행...');
            weatherAlertsCrawler.run().catch(err => log(`⚠️ 크롤러 오류: ${err.message}`));
        } else {
            log('⏸️ 기상특보 크롤링 일시정지 상태');
        }

        // [New] 해상 기상 전망 수집 (매 10분마다)
        if (min % 10 === 3) {
            marineForecastProcessor.collectMarineForecasts()
                .catch(err => log(`⚠️ 해상 기상 전망 수집 오류: ${err.message}`));
        }

        if (process.env.FLY_ALLOC_ID) {
            fetch('https://seagnal-server.fly.dev/api/health').catch(() => { });
        }
    }, 60000);
}

init();

module.exports = {
    collectBuoys,
    collectKmaBuoys,
    collectGeneralForecasts,
    collectZoneForecasts,
    collectMidTermSeaForecasts,
    collectFishingIndex,
    collectSeaSplitIndex,
    collectSurfingIndex,
    // 관리자 페이지용 상태 반환
    // fishing 키에 낚시지수 + 바다갈라짐 통합 상태를 담아서 반환
    // (내부적으로는 fishing/seaSplit 별도 관리, 외부에는 fishing으로 통합 노출)
    getStatus: () => {
        const status = Object.assign({}, lastRunStatus);
        const f = lastRunStatus.fishing;
        const s = lastRunStatus.seaSplit;

        if (f.status === '성공' && s.status === '성공') {
            // 둘 다 성공이면 메시지를 합치고, 더 최근에 실행된 쪽의 시각을 표시
            status.fishing = {
                lastRun: s.lastRun || f.lastRun,  // 바다갈라짐이 매시 35분 실행되므로 보통 더 최신
                status: '성공',
                message: f.message + ' / ' + s.message
            };
        } else if (f.status === '실패' || s.status === '실패') {
            // 하나라도 실패면 실패 표시 (어떤 쪽이 실패했는지 메시지에 포함)
            const failMsg = [];
            if (f.status === '실패') failMsg.push('낚시: ' + f.message);
            if (s.status === '실패') failMsg.push('갈라짐: ' + s.message);
            status.fishing = {
                lastRun: s.lastRun || f.lastRun,
                status: '실패',
                message: failMsg.join(' / ')
            };
        } else if (f.status === '성공' || s.status === '성공') {
            // 한쪽만 성공, 다른 쪽은 아직 대기 중 (서버 시작 직후 등)
            // 실행 완료된 쪽의 상태를 표시
            const done = f.status === '성공' ? f : s;
            status.fishing = { lastRun: done.lastRun, status: done.status, message: done.message };
        }
        // else: 둘 다 '대기 중'이면 기본 fishing 상태 그대로 유지

        // seaSplit 키는 외부에 노출하지 않음 (관리자 화면에서 별도 카드가 없으므로)
        delete status.seaSplit;
        return status;
    },
    collectProgress,
    getCrawlPaused: () => crawlPaused,
    setCrawlPaused: (val) => { crawlPaused = !!val; },
    getConfig: () => ({ KMA_HUB_KEY: CONFIG.KMA_HUB_KEY }),
    updateConfig: (newConfig) => {
        try {
            if (newConfig.KMA_HUB_KEY) {
                CONFIG.KMA_HUB_KEY = newConfig.KMA_HUB_KEY;
                fs.writeFileSync(CONFIG_FILE, JSON.stringify({ KMA_HUB_KEY: CONFIG.KMA_HUB_KEY }, null, 2), 'utf8');
                return true;
            }
        } catch (e) {
            console.error('API 설정 저장 실패:', e.message);
        }
        return false;
    }
};
