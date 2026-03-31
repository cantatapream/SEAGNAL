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
    fishing: { lastRun: null, status: '대기 중', message: '' }  // 바다낚시 지수
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
        collectProgress.emit('progress', { type: 'fishing', step: '바다낚시 지수', current: 1, total: 3, detail: 'API 호출 중' });

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
        collectProgress.emit('progress', { type: 'fishing', step: '바다낚시 지수', current: 2, total: 3, detail: '데이터 가공 중' });

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
        collectProgress.emit('progress', { type: 'fishing', step: '바다낚시 지수', current: 3, total: 3, detail: '저장 중' });

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
            collectFishingIndex().then(() => log('✅ 바다낚시 지수 수집 완료'))
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
    getStatus: () => lastRunStatus,
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
