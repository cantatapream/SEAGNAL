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
            // 초기 로드 시 마이그레이션/리셋은 중요 영속화 — flush
            if (needsSave) saveTideBedConfig({ flush: true });
        }
    } catch (e) {
        console.error('⚠️ TideBED Config 로드 실패:', e.message);
    }
} else {
    // 최초 파일 생성도 flush
    saveTideBedConfig({ flush: true });
}

/**
 * TideBED API 키 사용량/현재 인덱스 등 설정을 TIDEBED_CONFIG_FILE 에 저장.
 *
 * [디바운싱 — 이슈 1 (조석 버벅임) 대응]
 *   기존: 매 API 응답마다 fs.writeFileSync 동기 호출 (3일치 5페이지×3 = 최대 15회/요청).
 *   변경: 호출은 즉시 디바운스 타이머 예약만, 실제 fs.writeFileSync 는 5초 후 1회.
 *   슬라이더 연타/매 응답마다 발생하던 디스크 IO 폭주를 제거 → 응답 latency 절감.
 *   `flush=true` 전달 시 즉시 동기 저장 (키 회전/삭제 등 중요한 영속화 보장).
 *
 *   실패 시 콘솔 경고만 (예외 throw 안 함) — 다음 정상 갱신에서 자동 복구.
 */
let _saveDebounceTimer = null;
const _SAVE_DEBOUNCE_MS = 5000;
function _doWriteConfig() {
    try {
        fs.writeFileSync(TIDEBED_CONFIG_FILE, JSON.stringify(tideBedConfig, null, 2), 'utf8');
    } catch (e) {
        console.error('⚠️ TideBED Config 저장 실패:', e.message);
    }
}
function saveTideBedConfig(opts) {
    const flush = !!(opts && opts.flush);
    if (flush) {
        // 키 등록/삭제/회전 등 영속화 필수 시점: 즉시 저장 + 보류 타이머 취소
        if (_saveDebounceTimer) { clearTimeout(_saveDebounceTimer); _saveDebounceTimer = null; }
        _doWriteConfig();
        return;
    }
    // 일반 사용량 카운트 갱신: 5초 디바운스 (마지막 호출 후 5초 뒤 1회만 기록)
    if (_saveDebounceTimer) return; // 이미 예약돼 있으면 누적 안 함
    _saveDebounceTimer = setTimeout(() => {
        _saveDebounceTimer = null;
        _doWriteConfig();
    }, _SAVE_DEBOUNCE_MS);
}

// 프로세스 종료 시 누락 방지 — 디바운스 타이머에 보류 중인 변경 강제 flush
process.on('beforeExit', () => {
    if (_saveDebounceTimer) {
        clearTimeout(_saveDebounceTimer);
        _saveDebounceTimer = null;
        _doWriteConfig();
    }
});

/**
 * TideBED API 키를 다음 순번으로 회전 (라운드 로빈).
 * 일일 호출 한도 도달 또는 일시 차단 발생 시 호출 — 즉시 다른 키로 전환하여
 * 서비스 중단 없이 계속 데이터 수집. 회전 후 saveTideBedConfig 로 즉시 영속화.
 */
function rotateTideBedKey() {
    tideBedConfig.currentIndex = (tideBedConfig.currentIndex + 1) % tideBedConfig.keys.length;
    console.log(`🔄 TideBED API Key가 ${tideBedConfig.currentIndex + 1}번으로 전환되었습니다.`);
    // 키 회전은 영속화 중요 — flush 로 즉시 저장
    saveTideBedConfig({ flush: true });
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
        // 일일 리셋은 중요 영속화 — flush
        saveTideBedConfig({ flush: true });
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
 * TideBED 데이터 수집 — 지정 페이지만 병렬 호출 (1..5 부분 집합 지원)
 *
 * [페이지 단위 자동 재시도 — 2026-05]
 *   fetchTideBedPage 내부의 키 회전(SERVICE_ERROR/LIMITED_NUMBER/OVER_QUOTA)
 *   으로는 잡히지 않는 UNKNOWN_ERROR(resultCode=99) 또는 일시 네트워크 장애로
 *   일부 페이지(예: Page 4·5)만 실패하는 케이스 방어. 실패 페이지만 골라
 *   backoff 와 함께 최대 2회 재요청. 재시도 후에도 부족분이 남으면 부분
 *   데이터를 반환하되, 완전성 판정은 호출 측(collectAndSaveTideData) 에서
 *   record 수 기반으로 다시 검사한다.
 *
 * [페이지 셀렉터 — 2026-05 boundary 최적화]
 *   pages 파라미터로 1~5 부분 집합 지정 가능 (어제/내일 boundary peak 만
 *   필요한 경우 trade off: TideBED 부하·UNKNOWN_ERROR 빈도 ↓).
 *   호출 측이 어떤 페이지를 받았는지 알아야 하므로 { items, loadedPages,
 *   failedPages } 객체를 반환. 기존 단일 인자(reqDate) 호출 호환을 위해
 *   기본값 [1,2,3,4,5] 적용 + 옛 사용처(배열 반환 기대) 를 위한 wrapper
 *   collectTideBedData 유지.
 */
async function collectTideBedPages(lat, lon, reqDate, pages) {
    const pageList = Array.isArray(pages) && pages.length > 0
        ? pages.slice().sort((a, b) => a - b)
        : [1, 2, 3, 4, 5];
    console.log(`📡 TideBED API 수집 시작: lat=${lat}, lon=${lon}, date=${reqDate}, pages=[${pageList.join(',')}]`);

    const allItems = [];
    const loadedPages = [];

    const pagePromises = pageList.map(page => {
        console.log(`  📄 Page ${page}/${pageList.length === 5 ? '5' : pageList.length + ' (부분)'} 요청 시작...`);
        return fetchTideBedPage(lat, lon, reqDate, page).then(result => ({ page, result }));
    });

    const results = await Promise.all(pagePromises);

    const failedPages = [];
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
            loadedPages.push(page);
            console.log(`  ✅ Page ${page}: ${Array.isArray(items) ? items.length : 1}건 수집 완료`);
        } else {
            console.warn(`  ⚠️ Page ${page}: 데이터 없음 또는 오류`);
            if (header) {
                console.warn(`     응답 코드: ${header.resultCode || 'N/A'}`);
                console.warn(`     응답 메시지: ${header.resultMsg || 'N/A'}`);
            }
            failedPages.push(page);
        }
    }

    const MAX_PAGE_RETRIES = 2;
    let retryAttempt = 0;
    let remainingFailed = failedPages;
    while (remainingFailed.length > 0 && retryAttempt < MAX_PAGE_RETRIES) {
        retryAttempt++;
        const backoffMs = 500 * retryAttempt; // 500ms → 1000ms (보수적 유지 — 백오프 결정 리포트 참조)
        console.log(`🔁 페이지 재시도 ${retryAttempt}/${MAX_PAGE_RETRIES}: [${remainingFailed.join(', ')}] (backoff ${backoffMs}ms)`);
        await new Promise(r => setTimeout(r, backoffMs));

        const retryPromises = remainingFailed.map(page =>
            fetchTideBedPage(lat, lon, reqDate, page).then(result => ({ page, result }))
        );
        const retryResults = await Promise.all(retryPromises);

        const stillFailed = [];
        for (const { page, result } of retryResults) {
            const body = result?.response?.body || result?.body;
            const header = result?.response?.header || result?.header;
            if (body && body.items) {
                const items = body.items.item;
                if (Array.isArray(items)) {
                    allItems.push(...items);
                } else if (items) {
                    allItems.push(items);
                }
                loadedPages.push(page);
                console.log(`  ✅ Page ${page} (재시도 ${retryAttempt}): ${Array.isArray(items) ? items.length : 1}건 수집 완료`);
            } else {
                console.warn(`  ⚠️ Page ${page} (재시도 ${retryAttempt}): 여전히 실패 (응답 코드: ${header?.resultCode || 'N/A'})`);
                stillFailed.push(page);
            }
        }
        remainingFailed = stillFailed;
    }

    if (remainingFailed.length > 0) {
        console.error(`❌ ${remainingFailed.length}개 페이지 최종 실패: [${remainingFailed.join(', ')}] → 부분 데이터(${allItems.length}건) 반환`);
    }

    console.log(`📡 TideBED 수집 완료: 총 ${allItems.length}건 (loadedPages=[${loadedPages.sort((a,b)=>a-b).join(',')}])`);
    return { items: allItems, loadedPages: loadedPages.sort((a, b) => a - b), failedPages: remainingFailed };
}

/**
 * 후방 호환 wrapper — 옛 호출처는 5페이지 전체 raw 배열을 기대.
 *   기존 시그니처: collectTideBedData(lat, lon, reqDate) → array
 *   신규 셀렉터 필요 시 collectTideBedPages 직접 호출 권장.
 */
async function collectTideBedData(lat, lon, reqDate, pages) {
    const { items } = await collectTideBedPages(lat, lon, reqDate, pages);
    return items;
}

/**
 * 격자 해시 조회 (1건만 빠르게 조회하여 격자 식별)
 *
 * [원복 — 2026-05 사용자 합의]
 *   기존: 좌표→해시 메모리 캐시 (0.001° 양자화, TTL 12h) 로 latency 개선.
 *   변경: 사용자 간 공유 캐시 제거 정책에 따라 메모리 캐시 제거.
 *   매 호출마다 fetchTideBedPage 1회 호출. 클라이언트 측 차등 캐싱
 *   (localStorage 즐겨찾기 영속 + 비즐겨찾기 메모리) 으로 사용자 단말 내
 *   재방문 latency 는 보존.
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
 *
 * [opts — 2026-05 boundary 최적화]
 *   isNeighbor:   true 면 어제/내일 (보조) 데이터로 간주 → 완전성 게이트 완화.
 *                 boundary peak 1개만 잡혀도 'complete' 로 표시 (클라이언트
 *                 폴링 흐름 유지). 데이터 자체는 부분 페이지만 받았음을
 *                 loadedPages 로 함께 캐시한다.
 *   loadedPages:  실제로 받은 페이지 번호 배열. 캐시 entry 에 그대로 저장 →
 *                 라우터에서 슬라이더가 이 날을 직접 조회할 때 length < 5 면
 *                 누락 페이지 재수집을 결정.
 */
async function collectAndSaveTideData(lat, lon, dateInt, time, fileName, paddedItems = null, opts = {}) {
    // (디스크 캐시 제거로 filePath 미사용 — 메모리 캐시(tideCache)만 사용)
    const reqDateStr = String(dateInt);
    const adj = getAdjacentDates(dateInt);
    const isNeighbor = !!opts.isNeighbor;
    const loadedPages = Array.isArray(opts.loadedPages) ? opts.loadedPages.slice().sort((a, b) => a - b) : null;

    try {
        let items = [];
        if (paddedItems) {
            items = paddedItems;
        } else {
            items = await collectTideBedData(lat, lon, reqDateStr);
        }

        const peakResult = findTidePeaks(items, adj.currentISO);

        const dayOnlyItems = items.filter(i => (i.slctdDt || i.obsrvnDt).startsWith(adj.currentISO));

        // [완전성 검수 강화 — 2026-05]
        //   기존: dayOnlyItems.length > 0 면 무조건 'complete' 마킹.
        //   문제: 5페이지 중 일부가 UNKNOWN_ERROR 로 누락되어 부분 데이터(예:
        //         900건/1440건) 가 들어와도 'complete' 로 처리되어 클라이언트가
        //         부분 시간대의 고/저조 1개씩만 받아 렌더 → "조석이 고조 1·저조 1
        //         만 표출" 증상의 직접 원인.
        //   변경: dayOnlyItems 가 충분히(>= MIN_DAY_RECORDS) 채워졌을 때만
        //         'complete'. 부족하면 'error' 마킹 → 30초 TTL 에러 캐시 →
        //         클라이언트 폴링 재시도 또는 사용자 재클릭으로 자동 복구 유도.
        //         collectTideBedData 의 페이지 재시도(MAX_PAGE_RETRIES) 와
        //         조합되어 일시 장애는 자동 복구되고, 진짜 장애만 사용자에게 노출.
        //
        //   임계값 1380 (= 1440 - 60분 여유):
        //     TideBED API 가 격자(gridHash)별로 자정 경계 ±몇 분(보통 3~7분)의
        //     인접일 레코드를 섞어서 반환하는 케이스가 관측됨 → dayOnlyItems 가
        //     1433/1440 또는 1437/1440 으로 살짝 부족한 정상 응답. 페이지 단위
        //     실패(≥240분 누락) 는 잡으면서 boundary 오프셋은 통과시키도록
        //     1시간 마진으로 완화.
        //
        // [neighbor 모드 — boundary 최적화 분리]
        //   어제/내일은 클라이언트 게이지/예상조위 계산에 raw 1분 데이터가 직접
        //   사용되지 않음 (ocean_bottom_sheet3.js:731-743 / interpolateLevel).
        //   yPeaks.last() / tPeaks.first() 1개씩만 사용. → boundary 부근 페이지
        //   하나만 잡혀도 충분. dayOnlyItems.length 검수는 보조 정보로만 남기고
        //   'complete' 마킹 (false-positive 'error' 차단).
        const EXPECTED_DAY_RECORDS = 1440;
        const MIN_DAY_RECORDS = 1380; // 1440 - 60분 (boundary offset 허용)
        let isFullData = dayOnlyItems.length >= MIN_DAY_RECORDS;

        if (isNeighbor) {
            // neighbor: peak 1개 (high 또는 low) 라도 잡히면 OK.
            const hasAnyPeak = !!(peakResult.highTide1 || peakResult.lowTide1);
            if (hasAnyPeak) {
                isFullData = true; // 'complete' 로 표시 → 클라이언트 폴링 종료
            } else {
                console.warn(`⚠️ ${fileName}: 이웃 데이터지만 boundary peak 미검출 — 'error' 유지`);
                isFullData = false;
            }
        } else {
            // today: 기존 strict gate 유지
            if (!isFullData && dayOnlyItems.length > 0) {
                console.warn(`⚠️ ${fileName}: 부분 데이터(${dayOnlyItems.length}/${EXPECTED_DAY_RECORDS}건, 임계 ${MIN_DAY_RECORDS}) — 'error' 처리하여 재요청 유도`);
            } else if (dayOnlyItems.length < EXPECTED_DAY_RECORDS && dayOnlyItems.length >= MIN_DAY_RECORDS) {
                console.log(`ℹ️ ${fileName}: boundary offset 감지 (${dayOnlyItems.length}/${EXPECTED_DAY_RECORDS}건) — 정상 처리`);
            }
        }

        const completeData = {
            requestDate: dateInt,
            requestTime: time,
            latitude: lat,
            longitude: lon,
            timestamp: new Date().toISOString(),
            tideBedStatus: isFullData ? 'complete' : 'error',
            tideBedCount: dayOnlyItems.length,
            // [boundary 최적화] 어떤 페이지를 받았는지 캐시에 기록.
            //   length < 5 인데 슬라이더가 이 날을 직접 조회하면 라우터가
            //   누락 페이지 추가 수집 → 전체 5페이지 캐시로 승격.
            loadedPages: loadedPages, // null 이면 paddedItems 경로 — 호출 측이 직접 지정
            isNeighbor: isNeighbor,
            // ❸ 모든 피크 (H/L 각 최대 4개) 전달 — peak_finder 가 채워준 키만 정의됨
            highTide1: peakResult.highTide1,
            highTide2: peakResult.highTide2,
            highTide3: peakResult.highTide3,
            highTide4: peakResult.highTide4,
            lowTide1: peakResult.lowTide1,
            lowTide2: peakResult.lowTide2,
            lowTide3: peakResult.lowTide3,
            lowTide4: peakResult.lowTide4,
            peakCount: peakResult.peakCount,
            tideBedData: dayOnlyItems
        };

        // ❷-B 서버 가드: 이미 같은 fileName 이 complete/complete-quick 으로 캐시돼
        // 있는데 새 결과가 'error' (빈/부분 padded 결과) 면 덮어쓰지 않음.
        const existing = tideCache.get(fileName);
        if (existing
            && (existing.tideBedStatus === 'complete' || existing.tideBedStatus === 'complete-quick' || existing.tideBedStatus === 'complete (IDW)')
            && completeData.tideBedStatus === 'error') {
            console.log(`🛡️  ${fileName}: 기존 ${existing.tideBedStatus} 유지 — error 덮어쓰기 차단`);
            return existing;
        }

        // 부분 데이터('error') 는 30초 TTL 로만 캐시 — 같은 좌표 재클릭 시
        // 자동 재요청 가능하도록 짧게 유지 (catch 블록의 errorData 와 동일 정책).
        if (!isFullData) {
            tideCache.set(fileName, completeData, { ttl: 30 * 1000 });
            return completeData;
        }

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
        // [이슈 1 대응] 에러 캐시는 30초만 유지 — 1시간 캐시되면 같은 좌표
        // 재클릭/슬라이더 이동 시에도 계속 'error' 응답 (사용자 보고: "데이터를
        // 받아오지 못하는 경우 발생"). 짧은 TTL 로 자동 재시도 가능하게 함.
        tideCache.set(fileName, errorData, { ttl: 30 * 1000 });
        return errorData;
    }
}

module.exports = {
    tideBedConfig,
    saveTideBedConfig,
    rotateTideBedKey,
    fetchTideBedPage,
    collectTideBedData,
    collectTideBedPages,   // 페이지 셀렉터 (boundary 최적화) 지원 신규 API
    getGridHash,
    getAdjacentDates,
    collectAndSaveTideData
    // scheduleFileCleanup 제거됨 — 디스크 캐시 제거로 dead code (사용처 0건)
};
