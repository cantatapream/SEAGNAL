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
    zone: { lastRun: null, status: '대기 중', message: '' }
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
            collectMidTermSeaForecasts()
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
        const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const min = now.getMinutes();

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

        // [New] 특보 정보 크롤링 (매 1분 마다 실행)
        // 사용자 요청: 실시간성 확보를 위해 1분 주기로 단축
        if (!crawlPaused) {
            log('🔎 기상특보 크롤러 실행...');
            weatherAlertsCrawler.run().catch(err => log(`⚠️ 크롤러 오류: ${err.message}`));
        } else {
            log('⏸️ 기상특보 크롤링 일시정지 상태');
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
