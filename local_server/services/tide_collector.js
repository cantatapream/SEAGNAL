/**
 * ============================================================================
 * 파일명: services/tide_collector.js
 * 역할: TideBED API를 통한 조석(조위) 데이터 수집 및 분석 모듈
 * ============================================================================
 *
 * [설명]
 * 이 파일은 공공데이터포털의 TideBED API를 호출하여 조석(밀물/썰물) 데이터를
 * 수집하고, 고조/저조 시각을 분석하는 기능을 담당합니다.
 *
 * 주요 기능:
 * - fetchTideBedPage(): TideBED API 단일 페이지 호출 (자동 키 전환 포함)
 * - collectTideBedData(): 5페이지 병렬 호출로 1일치 전체 데이터 수집
 * - getGridHash(): 좌표의 격자 식별자 조회
 * - collectAndSaveTideData(): 수집 + 피크 분석 + 캐시 저장 통합
 * - getAdjacentDates(): 전일/당일/익일 날짜 계산
 *
 * [연계 파일]
 * - config/server_config.js → DATA_DIR, IS_FLY_IO 사용
 * - services/cache_manager.js → tideCache에 결과 저장
 * - peak_finder.js → findTidePeaks() 함수로 고조/저조 분석
 * - routes/tide.js → API 엔드포인트에서 이 모듈의 함수 호출
 *
 * [초보자를 위한 안내]
 * TideBED API는 공공데이터포털(data.go.kr)에서 제공하는 조석 예측 API입니다.
 * 위도/경도를 입력하면 해당 위치의 1분 간격 해수면 높이 데이터를 반환합니다.
 * API 키에는 일일 호출 제한(10,000건)이 있어, 여러 키를 자동으로 전환합니다.
 * ============================================================================
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
// IS_FLY_IO 는 디스크 캐시 분기에 사용되었으나 디스크 캐시 제거로 미사용 → import 에서 제외.
const { DATA_DIR } = require('../config/server_config');
const { tideCache } = require('./cache_manager');
const { findTidePeaks } = require('../peak_finder');

// ============================================================================
// TideBED API 키 관리
// ============================================================================
const TIDEBED_CONFIG_FILE = path.join(DATA_DIR, 'tidebed_config.json');
const TIDEBED_BASE_URL = 'https://apis.data.go.kr/1192136/tidebed/GetTidebedApiService';

let tideBedConfig = {
    keys: [
        {
            key: 'PmxnR43icJwR7yzKjG612RncLikLD1RvZpPLgEJqUUx0vGQncdfuT9VjiqBlgiXMdcjyKopi4yvUPaPbcdIUfg==',
            used: 0,
            expiry: '2028-02-11',
            owner: 'JIN'
        }
    ],
    currentIndex: 0,
    lastResetDate: new Date().toISOString().split('T')[0]
};

// 기존 설정 파일 로드
if (fs.existsSync(TIDEBED_CONFIG_FILE)) {
    try {
        const savedConfig = JSON.parse(fs.readFileSync(TIDEBED_CONFIG_FILE, 'utf8'));
        if (savedConfig.keys && savedConfig.keys.length > 0) {
            tideBedConfig = savedConfig;

            let needsSave = false;
            tideBedConfig.keys.forEach(k => {
                if (!k.expiry) { k.expiry = '2028-02-11'; needsSave = true; }
                if (!k.owner) { k.owner = 'JIN'; needsSave = true; }
            });

            // 일일 초기화 로직 (KST 기준)
            const nowKst = new Date(Date.now() + (9 * 60 * 60 * 1000));
            const todayStr = nowKst.toISOString().split('T')[0];
            if (tideBedConfig.lastResetDate !== todayStr) {
                console.log(`📅 날짜 변경 감지 (${tideBedConfig.lastResetDate} -> ${todayStr}). TideBED API 사용량 초기화.`);
                tideBedConfig.keys.forEach(k => k.used = 0);
                tideBedConfig.currentIndex = 0;
                tideBedConfig.lastResetDate = todayStr;
                needsSave = true;
            }
            if (needsSave) saveTideBedConfig();
        }
    } catch (e) {
        console.error('⚠️ TideBED Config 로드 실패:', e.message);
    }
} else {
    saveTideBedConfig();
}

function saveTideBedConfig() {
    try {
        fs.writeFileSync(TIDEBED_CONFIG_FILE, JSON.stringify(tideBedConfig, null, 2), 'utf8');
    } catch (e) {
        console.error('⚠️ TideBED Config 저장 실패:', e.message);
    }
}

function rotateTideBedKey() {
    tideBedConfig.currentIndex = (tideBedConfig.currentIndex + 1) % tideBedConfig.keys.length;
    console.log(`🔄 TideBED API Key가 ${tideBedConfig.currentIndex + 1}번으로 전환되었습니다.`);
    saveTideBedConfig();
}

// ============================================================================
// TideBED API 호출 함수
// ============================================================================

/**
 * TideBED API 단일 페이지 호출 (자동 키 전환 지원)
 */
async function fetchTideBedPage(lat, lon, reqDate, pageNo, numOfRows = 300, retryCount = 0) {
    if (tideBedConfig.keys.length === 0) {
        console.error('❌ 등록된 TideBED API 키가 없습니다.');
        return null;
    }

    // 매 호출 시 날짜 체크하여 일일 초기화 수행
    const nowKst = new Date(Date.now() + (9 * 60 * 60 * 1000));
    const todayStr = nowKst.toISOString().split('T')[0];
    if (tideBedConfig.lastResetDate !== todayStr) {
        console.log(`📅 날짜 변경 감지 (${todayStr}). 사용량 초기화.`);
        tideBedConfig.keys.forEach(k => k.used = 0);
        tideBedConfig.currentIndex = 0;
        tideBedConfig.lastResetDate = todayStr;
        saveTideBedConfig();
    }

    const currentKeyData = tideBedConfig.keys[tideBedConfig.currentIndex];
    const apiKey = currentKeyData.key;

    return new Promise((resolve) => {
        const encodedKey = encodeURIComponent(apiKey);
        const url = `${TIDEBED_BASE_URL}?serviceKey=${encodedKey}&lat=${lat}&lot=${lon}&reqDate=${reqDate}&type=json&min=1&numOfRows=${numOfRows}&pageNo=${pageNo}`;

        https.get(url, (response) => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', async () => {
                try {
                    if (data.includes('SERVICE_ERROR') || data.includes('LIMITED_NUMBER') || data.includes('OVER_QUOTA')) {
                        console.warn(`⚠️ TideBED API Key (${tideBedConfig.currentIndex + 1}번) 제한/오류 발생. 다음 키로 전환 시도...`);
                        if (retryCount < tideBedConfig.keys.length) {
                            rotateTideBedKey();
                            const result = await fetchTideBedPage(lat, lon, reqDate, pageNo, numOfRows, retryCount + 1);
                            return resolve(result);
                        }
                    }

                    const parsed = JSON.parse(data);

                    currentKeyData.used = (currentKeyData.used || 0) + 1;
                    if (currentKeyData.used >= 10000) {
                        console.log(`🚀 ${tideBedConfig.currentIndex + 1}번 키 제한(10,000회) 도달. 다음 키로 자동 전환.`);
                        rotateTideBedKey();
                    } else {
                        saveTideBedConfig();
                    }

                    resolve(parsed);
                } catch (e) {
                    if (data.includes('<returnReasonCode>')) {
                        console.warn(`⚠️ TideBED API XML 에러 응답 감지. 키 전환 시도...`);
                        if (retryCount < tideBedConfig.keys.length) {
                            rotateTideBedKey();
                            const result = await fetchTideBedPage(lat, lon, reqDate, pageNo, numOfRows, retryCount + 1);
                            return resolve(result);
                        }
                    }
                    console.error(`❌ TideBED Page ${pageNo} JSON parse error:`, e.message);
                    resolve(null);
                }
            });
        }).on('error', (err) => {
            console.error(`❌ TideBED Page ${pageNo} request error:`, err.message);
            resolve(null);
        });
    });
}

/**
 * TideBED 전체 데이터 수집 (5페이지 병렬 → 1440건)
 */
async function collectTideBedData(lat, lon, reqDate) {
    console.log(`📡 TideBED API 수집 시작: lat=${lat}, lon=${lon}, date=${reqDate}`);
    const allItems = [];

    const pagePromises = [1, 2, 3, 4, 5].map(page => {
        console.log(`  📄 Page ${page}/5 요청 시작...`);
        return fetchTideBedPage(lat, lon, reqDate, page).then(result => ({ page, result }));
    });

    const results = await Promise.all(pagePromises);

    for (const { page, result } of results) {
        const body = result?.response?.body || result?.body;
        const header = result?.response?.header || result?.header;

        if (body && body.items) {
            const items = body.items.item;
            if (Array.isArray(items)) {
                allItems.push(...items);
            } else if (items) {
                allItems.push(items);
            }
            console.log(`  ✅ Page ${page}: ${Array.isArray(items) ? items.length : 1}건 수집 완료`);
        } else {
            console.warn(`  ⚠️ Page ${page}: 데이터 없음 또는 오류`);
            if (header) {
                console.warn(`     응답 코드: ${header.resultCode || 'N/A'}`);
                console.warn(`     응답 메시지: ${header.resultMsg || 'N/A'}`);
            }
        }
    }

    console.log(`📡 TideBED 수집 완료: 총 ${allItems.length}건`);
    return allItems;
}

/**
 * 격자 해시 조회 (1건만 빠르게 조회하여 격자 식별)
 */
async function getGridHash(lat, lon, reqDate) {
    try {
        const result = await fetchTideBedPage(lat, lon, reqDate, 1, 1);
        const body = result?.response?.body || result?.body;
        if (body && body.items) {
            const item = Array.isArray(body.items.item) ? body.items.item[0] : body.items.item;
            if (item && item.m2TconstAmp !== undefined && item.m2TconstTlag !== undefined) {
                const amp = Math.round(parseFloat(item.m2TconstAmp) * 1000);
                const tlag = Math.round(parseFloat(item.m2TconstTlag) * 1000);
                return `${amp}_${tlag}`;
            }
        }
    } catch (e) {
        console.error('❌ 격자 해시 조회 실패:', e.message);
    }
    return null;
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

// [제거됨] scheduleFileCleanup — 디스크 캐시 자동 삭제 타이머
//   디스크 캐시 자체가 제거되어 더 이상 정리할 파일이 없으므로 dead code 가 됨.
//   외부 사용처도 0건이라 안전하게 제거.

/**
 * YYYYMMDD 정수에서 전일/당일/익일 날짜 계산
 */
function getAdjacentDates(dateInt) {
    const str = String(dateInt);
    const year = parseInt(str.substring(0, 4));
    const month = parseInt(str.substring(4, 6)) - 1;
    const day = parseInt(str.substring(6, 8));

    const current = new Date(year, month, day);
    const prev = new Date(current); prev.setDate(current.getDate() - 1);
    const next = new Date(current); next.setDate(current.getDate() + 1);

    const toYMD = (d) => parseInt(d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'));
    const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    return {
        prev: toYMD(prev),
        current: dateInt,
        next: toYMD(next),
        currentISO: toISO(current)
    };
}

/**
 * 단일 날짜 수집 + 피크 분석 + 파일 저장 통합 함수 (패딩 지원)
 */
async function collectAndSaveTideData(lat, lon, dateInt, time, fileName, paddedItems = null) {
    // (디스크 캐시 제거로 filePath 미사용 — 메모리 캐시(tideCache)만 사용)
    const reqDateStr = String(dateInt);
    const adj = getAdjacentDates(dateInt);

    try {
        let items = [];
        if (paddedItems) {
            items = paddedItems;
        } else {
            items = await collectTideBedData(lat, lon, reqDateStr);
        }

        const peakResult = findTidePeaks(items, adj.currentISO);

        const dayOnlyItems = items.filter(i => (i.slctdDt || i.obsrvnDt).startsWith(adj.currentISO));

        const completeData = {
            requestDate: dateInt,
            requestTime: time,
            latitude: lat,
            longitude: lon,
            timestamp: new Date().toISOString(),
            tideBedStatus: dayOnlyItems.length > 0 ? 'complete' : 'error',
            tideBedCount: dayOnlyItems.length,
            highTide1: peakResult.highTide1,
            highTide2: peakResult.highTide2,
            lowTide1: peakResult.lowTide1,
            lowTide2: peakResult.lowTide2,
            peakCount: peakResult.peakCount,
            tideBedData: dayOnlyItems
        };

        // 메모리 캐시(tideCache LRU)에만 저장. 디스크 파일 저장은 제거됨
        // (캐시 적중률 낮고 파일 누적 부담이 더 컸음 — 메모리 캐시로 충분).
        tideCache.set(fileName, completeData);

        return completeData;
    } catch (err) {
        console.error(`❌ ${fileName} 수집 실패:`, err.message);
        const errorData = {
            requestDate: dateInt,
            requestTime: time,
            latitude: lat,
            longitude: lon,
            timestamp: new Date().toISOString(),
            tideBedStatus: 'error',
            tideBedError: err.message,
            tideBedData: []
        };
        // 에러 결과도 메모리에만 캐시 (짧은 시간 동안 같은 요청 반복 차단)
        tideCache.set(fileName, errorData);
        return errorData;
    }
}

module.exports = {
    tideBedConfig,
    saveTideBedConfig,
    rotateTideBedKey,
    fetchTideBedPage,
    collectTideBedData,
    getGridHash,
    getAdjacentDates,
    collectAndSaveTideData
    // scheduleFileCleanup 제거됨 — 디스크 캐시 제거로 dead code (사용처 0건)
};
