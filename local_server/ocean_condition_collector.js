/**
 * ============================================================================
 * 파일명: ocean_condition_collector.js
 * 역할: 국립해양조사원 해황예보도 API 데이터 수집 및 이미지 디스크 캐싱
 * ============================================================================
 *
 * [설명]
 * 이 모듈은 공공데이터포털의 해황예보도 API를 호출하여
 * 20개 지역의 예보 데이터(JSON)와 예보도 이미지(PNG)를
 * 디스크에 저장(캐싱)합니다.
 *
 * [동작 흐름]
 * 1. "전국(korea)" 지역으로 API 호출하여 최신 발표일자 확인
 * 2. 기존 캐시의 발표일자와 비교
 * 3. 다르면(= 새 데이터) → 임시 폴더에 20개 지역 전체 수집
 * 4. 수집 완료 후 기존 캐시 → 삭제, 임시 폴더 → 정식 캐시로 교체
 *    (사용자는 교체 순간까지 기존 캐시를 이용, 서비스 중단 없음)
 *
 * [수집 스케줄]
 * - 서버 시작 시: 전체 수집 (init)
 * - 매일 09:05: 새 데이터 확인 후 변경 시 전체 수집
 *   (동일하면 10분 후 재시도, 최대 6회)
 *
 * [디스크 구조]
 * data/ocean_cache/
 *   ├── meta.json          ← 수집 메타정보 (발표일자, 수집시각)
 *   ├── korea.json          ← 전국 API 응답 데이터
 *   ├── busan.json          ← 부산 API 응답 데이터
 *   ├── ...                 ← (20개 지역 JSON)
 *   └── images/
 *       ├── do_korea_20260404_09.png
 *       ├── do_korea_20260404_12.png
 *       └── ...             ← (약 1,060개 이미지)
 *
 * [연계 파일]
 * - scheduler.js → init()에서 초기 수집 호출 + 1분 주기에서 09:05 스케줄
 * - routes/ocean_condition.js → 캐시된 데이터/이미지를 프론트에 제공
 * - config/server_config.js → DATA_DIR 경로 사용
 *
 * [초보자를 위한 안내]
 * - 공공데이터포털 API: 정부가 제공하는 무료 데이터 API 서비스
 * - 디스크 캐싱: RAM이 아닌 하드디스크(SSD)에 파일로 저장하는 방식
 *   → 서버 재시작해도 데이터 유지, 메모리 부담 없음
 * - 병렬 다운로드: 이미지를 한 번에 5개씩 동시에 받아 속도를 높임
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ============================================================================
// 상수 정의
// ============================================================================

/** 공공데이터포털 해황예보도 API 서비스키 */
const SERVICE_KEY = 'PmxnR43icJwR7yzKjG612RncLikLD1RvZpPLgEJqUUx0vGQncdfuT9VjiqBlgiXMdcjyKopi4yvUPaPbcdIUfg==';

/** 해황예보도 API 기본 URL */
const API_BASE_URL = 'https://apis.data.go.kr/1192136/oceanCondition/GetOceanConditionApiService';

/**
 * 해황예보도 지역 코드 목록 (20개)
 * - 키: API에서 사용하는 영문 지역코드 (areaCode 파라미터)
 * - 값: 한글 지역명 (UI 표출용)
 */
const AREA_CODES = {
    korea: '전국',
    baengnyeongdo: '백령도',
    incheon: '인천',
    taean: '태안',
    gyeokyeolbiyeoldo: '격렬비열도',
    gunsan: '군산',
    yeonggwang: '영광',
    heuksando: '흑산도',
    mokpo: '목포',
    wando: '완도',
    yeosu: '여수',
    tongyeong: '통영',
    busan: '부산',
    pohang: '포항',
    hupo: '후포',
    ulleungdo: '울릉도',
    donghae: '동해',
    sokcho: '속초',
    jeju: '제주',
    ieodo: '이어도'
};

/** 이미지 동시 다운로드 최대 개수 (khoa.go.kr 서버 부하 방지) */
const CONCURRENT_DOWNLOADS = 3;

/** 이미지 다운로드 웨이브 최대 반복 횟수 (1회차 전체 → 2~N회차 실패분 재시도) */
const MAX_DOWNLOAD_WAVES = 5;

/** 웨이브 간 대기 시간 (밀리초) — 서버 부하 분산 */
const WAVE_DELAY = 5000;

/** 데이터 저장 경로 (Fly.io 볼륨 마운트 범위 내) */
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'ocean_cache');
const CACHE_NEW_DIR = path.join(DATA_DIR, 'ocean_cache_new');

// ============================================================================
// 로깅 유틸리티
// ============================================================================

/**
 * 타임스탬프 포함 로그 출력
 * @param {string} msg - 출력할 메시지
 */
function log(msg) {
    const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.log(`[${now}] [해황예보도] ${msg}`);
}

// ============================================================================
// HTTP 요청 유틸리티
// ============================================================================

/**
 * HTTPS GET 요청을 수행하여 응답 본문을 문자열로 반환
 * (Node.js 기본 https 모듈 사용, 외부 라이브러리 의존 없음)
 *
 * @param {string} url - 요청할 URL
 * @param {number} [timeout=30000] - 타임아웃 (밀리초)
 * @returns {Promise<string>} 응답 본문 문자열
 */
// khoa.go.kr 서버가 User-Agent 없는 요청을 403으로 차단하므로 브라우저 헤더 필요
const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

function httpGet(url, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, { timeout, headers: DEFAULT_HEADERS }, (res) => {
            // 리다이렉트 처리 (301, 302)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpGet(res.headers.location, timeout).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume(); // 메모리 해제
                return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    });
}

/**
 * URL에서 파일을 다운로드하여 디스크에 저장
 * (이미지 파일 등 바이너리 데이터를 받아서 파일로 씀)
 *
 * @param {string} url - 다운로드할 파일 URL
 * @param {string} destPath - 저장할 로컬 파일 경로
 * @param {number} [timeout=30000] - 타임아웃 (밀리초)
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, { timeout, headers: DEFAULT_HEADERS }, (res) => {
            // 리다이렉트 처리
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadFile(res.headers.location, destPath, timeout).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
            }
            const fileStream = fs.createWriteStream(destPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => { fileStream.close(); resolve(); });
            fileStream.on('error', (err) => {
                fs.unlink(destPath, () => {}); // 실패 시 불완전 파일 삭제
                reject(err);
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    });
}

/**
 * 이미지 목록을 웨이브 방식으로 다운로드 (실패분 자동 재시도)
 *
 * [동작 흐름]
 * 1회차(Wave 1): 전체 이미지 다운로드 시도 → 실패 목록 수집
 * 2회차(Wave 2): 1회차 실패분만 재시도 → 여전히 실패한 것 수집
 * 3회차(Wave 3): 2회차 실패분만 재시도 → ...
 * → 모든 이미지 성공 or 최대 횟수(MAX_DOWNLOAD_WAVES) 도달 시 종료
 *
 * @param {Array<{url:string, dest:string, name:string}>} imageList - 다운로드할 이미지 목록
 * @param {Function} emitProgress - 진행률 이벤트 발행 함수
 * @returns {Object} { successCount, failCount, failedFiles }
 */
async function downloadImagesInWaves(imageList, emitProgress, totalSteps) {
    const totalImages = imageList.length;
    let successCount = 0;
    let pendingList = imageList.slice(); // 다운로드 대기 목록 (복사본)

    for (let wave = 1; wave <= MAX_DOWNLOAD_WAVES; wave++) {
        if (pendingList.length === 0) break;

        const waveLabel = wave === 1 ? '다운로드' : `재시도 ${wave - 1}차`;
        const waveTotal = pendingList.length;
        let waveDone = 0;
        const waveFailed = []; // 이번 웨이브에서 실패한 항목

        log(`🔄 [Wave ${wave}] ${waveLabel}: ${waveTotal}개 이미지 (동시 ${CONCURRENT_DOWNLOADS}개)`);

        // 각 이미지를 다운로드하는 작업 배열 생성
        const tasks = pendingList.map(item => async () => {
            try {
                await downloadFile(item.url, item.dest);
                successCount++;
                waveDone++;
                // 개별 이미지 진행률: "Wave1 다운로드 125/1060 (전체 125/1060)"
                if (waveDone % 10 === 0 || waveDone === waveTotal) {
                    emitProgress('이미지 ' + waveLabel, 22, totalSteps,
                        `${waveDone}/${waveTotal} (전체 ${successCount}/${totalImages})`);
                }
                return { success: true };
            } catch (err) {
                waveDone++;
                waveFailed.push(item);
                log(`  ❌ [Wave ${wave}] 실패: ${item.name} — ${err.message}`);
                if (waveDone % 10 === 0 || waveDone === waveTotal) {
                    emitProgress('이미지 ' + waveLabel, 22, totalSteps,
                        `${waveDone}/${waveTotal} (전체 ${successCount}/${totalImages})`);
                }
                return { success: false, error: err.message };
            }
        });

        // 병렬 실행 (동시 CONCURRENT_DOWNLOADS개)
        await parallelLimit(tasks, CONCURRENT_DOWNLOADS);

        log(`📊 [Wave ${wave}] 결과: 성공 ${waveTotal - waveFailed.length}/${waveTotal}, 실패 ${waveFailed.length}개`);

        if (waveFailed.length === 0) {
            log(`✅ 모든 이미지 다운로드 완료!`);
            break;
        }

        if (wave < MAX_DOWNLOAD_WAVES) {
            // 다음 웨이브 전 대기 (서버 부하 분산)
            log(`⏳ ${WAVE_DELAY / 1000}초 대기 후 실패분 ${waveFailed.length}개 재시도...`);
            emitProgress('재시도 대기', 22, totalSteps,
                `${wave}차 완료, ${waveFailed.length}개 실패 — ${WAVE_DELAY / 1000}초 후 재시도`);
            await new Promise(r => setTimeout(r, WAVE_DELAY));
        }

        // 다음 웨이브에서는 실패분만 시도
        pendingList = waveFailed;
    }

    // 최종 실패 목록
    const failedFiles = pendingList.map(item => item.name);
    if (failedFiles.length > 0) {
        log(`⚠️ 최종 실패 이미지 (${failedFiles.length}개):`);
        failedFiles.forEach(name => log(`    - ${name}`));
    }

    return {
        successCount,
        failCount: failedFiles.length,
        failedFiles
    };
}

// ============================================================================
// API 호출 함수
// ============================================================================

/**
 * 특정 지역의 해황예보도 데이터를 API에서 가져옴
 *
 * @param {string} areaCode - 지역코드 (예: 'korea', 'busan')
 * @returns {Promise<Object>} API 응답 JSON 객체
 *   {
 *     header: { resultCode, resultMsg },
 *     body: {
 *       items: { item: [ { ofcBrnchId, ofcBrnchNm, ofcFrcstYmd, ofcFrcstTm, imgFileNm, imgFilePath }, ... ] },
 *       totalCount, ...
 *     }
 *   }
 */
async function fetchAreaData(areaCode) {
    // API URL 구성 (서비스키는 인코딩 필요)
    const url = `${API_BASE_URL}?serviceKey=${encodeURIComponent(SERVICE_KEY)}&areaCode=${areaCode}&type=json&numOfRows=300`;

    const responseText = await httpGet(url);
    const data = JSON.parse(responseText);

    // API 오류 체크
    if (data.header && data.header.resultCode !== '00') {
        throw new Error(`API 오류 [${areaCode}]: ${data.header.resultMsg}`);
    }

    return data;
}

// ============================================================================
// 병렬 다운로드 제어
// ============================================================================

/**
 * 작업 목록을 최대 N개씩 병렬로 실행 (서버 부담 방지)
 * 예: 1,060개 이미지를 5개씩 나눠서 순차적으로 처리
 *
 * @param {Array<Function>} tasks - 실행할 비동기 함수 배열
 * @param {number} concurrency - 동시 실행 최대 개수
 * @param {Function} [onDone=null] - 각 작업 완료 시 호출되는 콜백 (진행률 추적용)
 * @returns {Promise<Array>} 각 작업의 결과 (성공/실패 모두 포함)
 */
async function parallelLimit(tasks, concurrency, onDone = null) {
    const results = [];
    let index = 0;

    async function worker() {
        while (index < tasks.length) {
            const currentIndex = index++;
            try {
                results[currentIndex] = { success: true, value: await tasks[currentIndex]() };
            } catch (err) {
                results[currentIndex] = { success: false, error: err.message };
            }
            if (onDone) onDone();
        }
    }

    // concurrency 수만큼 워커를 동시에 실행
    const workers = [];
    for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    return results;
}

// ============================================================================
// 폴더 관리 유틸리티
// ============================================================================

/**
 * 폴더를 재귀적으로 삭제 (Node.js 14+ 호환)
 * @param {string} dirPath - 삭제할 폴더 경로
 */
function removeDirSync(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
    }
}

/**
 * 폴더가 없으면 생성 (중첩 폴더도 한 번에 생성)
 * @param {string} dirPath - 생성할 폴더 경로
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// ============================================================================
// 메인 수집 함수
// ============================================================================

/**
 * 해황예보도 전체 수집 (20개 지역의 JSON + 이미지)
 *
 * [동작 순서]
 * 1. 임시 폴더(ocean_cache_new) 생성
 * 2. 20개 지역 순차적으로 API 호출 → JSON 저장
 * 3. 모든 이미지 URL 수집 → 5개씩 병렬 다운로드
 * 4. 수집 완료 후 기존 캐시와 교체 (무중단)
 *
 * @param {boolean} [force=false] - true이면 발표일자 비교 없이 강제 수집
 * @param {EventEmitter} [progressEmitter=null] - 진행률 이벤트 발행용 (관리자 수동 수집 시 전달)
 * @returns {Promise<Object>} 수집 결과 { success, totalImages, failedImages, elapsed }
 */
async function collectOceanCondition(force = false, progressEmitter = null) {
    // 진행률 이벤트 헬퍼 (emitter가 없으면 무시)
    const emitProgress = (step, current, total, detail) => {
        if (progressEmitter) {
            progressEmitter.emit('progress', {
                type: 'ocean-condition', step, current, total, detail
            });
        }
    };
    const startTime = Date.now();
    log('🌊 해황예보도 수집 시작...');

    try {
        // 총 진행 단계: 1(확인) + 20(지역) + 1(이미지) + 1(교체) = 23
        const TOTAL_STEPS = 23;

        // ── 1단계: 최신 데이터 확인 (전국 데이터로 발표일 체크) ──
        emitProgress('발표일 확인', 1, TOTAL_STEPS, '전국 데이터 조회 중');
        log('📡 전국(korea) 데이터로 최신 발표일자 확인 중...');
        const koreaData = await fetchAreaData('korea');
        const items = koreaData?.body?.items?.item || [];

        if (items.length === 0) {
            log('⚠️ API 응답에 데이터가 없습니다. 수집 중단.');
            return { success: false, reason: 'API 응답 비어있음' };
        }

        // 가장 이른 예보일자 = 발표 기준일
        const latestDate = items[0].ofcFrcstYmd;
        log(`📅 API 발표 기준일: ${latestDate}`);

        // ── 2단계: 기존 캐시와 비교 (강제 수집이 아닌 경우) ──
        if (!force) {
            const metaPath = path.join(CACHE_DIR, 'meta.json');
            if (fs.existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                    if (meta.latestDate === latestDate) {
                        log(`✅ 기존 캐시와 동일한 발표일자(${latestDate}). 수집 스킵.`);
                        return { success: true, reason: '변경 없음', skipped: true };
                    }
                    log(`🔄 발표일자 변경 감지: ${meta.latestDate} → ${latestDate}`);
                } catch (e) {
                    log('⚠️ 기존 meta.json 읽기 실패, 전체 수집 진행');
                }
            }
        }

        // ── 3단계: 임시 폴더 생성 ──
        removeDirSync(CACHE_NEW_DIR); // 이전 실패한 임시 폴더 정리
        ensureDir(CACHE_NEW_DIR);
        ensureDir(path.join(CACHE_NEW_DIR, 'images'));

        // ── 4단계: 20개 지역 API 호출 + JSON 저장 ──
        const allImageTasks = []; // 다운로드할 이미지 목록
        const areaCodes = Object.keys(AREA_CODES);
        let areaCount = 0;

        for (const areaCode of areaCodes) {
            try {
                // 전국은 이미 호출했으므로 재사용
                const data = areaCode === 'korea' ? koreaData : await fetchAreaData(areaCode);
                const areaItems = data?.body?.items?.item || [];

                // JSON 데이터 저장 (지역별 파일)
                const jsonPath = path.join(CACHE_NEW_DIR, `${areaCode}.json`);
                fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');

                // 이미지 다운로드 목록에 추가 (URL, 저장경로, 파일명)
                for (const item of areaItems) {
                    if (item.imgFilePath && item.imgFileNm) {
                        allImageTasks.push({
                            url: item.imgFilePath,
                            dest: path.join(CACHE_NEW_DIR, 'images', item.imgFileNm),
                            name: item.imgFileNm
                        });
                    }
                }

                areaCount++;
                // 진행률: 2~21번째 단계 (20개 지역)
                emitProgress('지역 데이터', 1 + areaCount, TOTAL_STEPS, `${AREA_CODES[areaCode]} (${areaCount}/${areaCodes.length})`);
                log(`  📥 [${areaCount}/${areaCodes.length}] ${AREA_CODES[areaCode]}(${areaCode}): ${areaItems.length}건`);

            } catch (err) {
                log(`  ⚠️ ${AREA_CODES[areaCode]}(${areaCode}) 수집 실패: ${err.message}`);
            }
        }

        log(`📦 총 ${allImageTasks.length}개 이미지 다운로드 시작 (웨이브 방식, 최대 ${MAX_DOWNLOAD_WAVES}회 반복)...`);
        emitProgress('이미지 다운로드', 22, TOTAL_STEPS, `0/${allImageTasks.length}개`);

        // ── 5단계: 웨이브 방식 이미지 다운로드 ──
        // 1회차: 전체 다운로드 → 2회차: 실패분 재시도 → ... → 모두 성공 or 최대 횟수 도달
        const dlResult = await downloadImagesInWaves(allImageTasks, emitProgress, TOTAL_STEPS);
        const successCount = dlResult.successCount;
        const failCount = dlResult.failCount;

        log(`📸 이미지 다운로드 최종 결과: 성공 ${successCount}개, 실패 ${failCount}개`);

        // 실패가 너무 많으면 (80% 이상) 수집 실패로 처리하고 기존 캐시 유지
        if (failCount > allImageTasks.length * 0.8) {
            log('❌ 이미지 다운로드 실패율 80% 초과. 기존 캐시 유지.');
            removeDirSync(CACHE_NEW_DIR);
            return { success: false, reason: `이미지 다운로드 대량 실패 (${failCount}/${allImageTasks.length})` };
        }
        if (failCount > 0) {
            log(`⚠️ 일부 이미지 최종 실패: ${failCount}개 (${MAX_DOWNLOAD_WAVES}회 시도 후)`);
        }

        // ── 6단계: 메타 정보 저장 ──
        const meta = {
            latestDate: latestDate,
            collectedAt: new Date().toISOString(),
            totalAreas: areaCount,
            totalImages: successCount,
            failedImages: failCount,
            failedFiles: dlResult.failedFiles || [],
            downloadWaves: Math.min(MAX_DOWNLOAD_WAVES, failCount > 0 ? MAX_DOWNLOAD_WAVES : 1)
        };
        fs.writeFileSync(
            path.join(CACHE_NEW_DIR, 'meta.json'),
            JSON.stringify(meta, null, 2),
            'utf-8'
        );

        // ── 7단계: 폴더 교체 (무중단 전환) ──
        emitProgress('캐시 교체', 23, TOTAL_STEPS, '폴더 교체 중');
        // 순서: 기존 캐시 삭제 → 임시 폴더를 정식 캐시로 이름 변경
        // (사용자 요청은 이 사이 아주 짧은 순간만 영향받을 수 있으나, 실질적으로 무시 가능)
        const oldCacheExists = fs.existsSync(CACHE_DIR);
        if (oldCacheExists) {
            removeDirSync(CACHE_DIR);
        }
        fs.renameSync(CACHE_NEW_DIR, CACHE_DIR);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log(`🎉 해황예보도 수집 완료! (${areaCount}개 지역, ${successCount}개 이미지, ${elapsed}초 소요)`);

        return {
            success: true,
            totalAreas: areaCount,
            totalImages: successCount,
            failedImages: failCount,
            elapsed: parseFloat(elapsed)
        };

    } catch (err) {
        log(`❌ 해황예보도 수집 중 오류: ${err.message}`);
        // 임시 폴더가 남아있으면 정리
        removeDirSync(CACHE_NEW_DIR);
        return { success: false, reason: err.message };
    }
}

// ============================================================================
// 스케줄 수집 함수 (매일 09:05 ~ 최대 6회 재시도)
// ============================================================================

/** 현재 재시도 타이머 (중복 실행 방지용) */
let retryTimer = null;

/**
 * 매일 09:05에 호출되는 스케줄 수집 함수
 * - 새 데이터가 확인되면 전체 수집 실행
 * - 기존 데이터와 동일하면 10분 후 재시도 (최대 6회 = 약 1시간)
 *
 * @param {number} [attempt=1] - 현재 시도 횟수
 */
async function scheduledCollect(attempt = 1) {
    const MAX_RETRIES = 6; // 최대 재시도 횟수 (10분 × 6 = 60분)

    log(`📋 정기 수집 시도 (${attempt}/${MAX_RETRIES})`);

    const result = await collectOceanCondition(false); // force=false: 변경 시에만 수집

    if (result.skipped && attempt < MAX_RETRIES) {
        // 데이터 미변경 → 10분 후 재시도
        log(`⏳ 데이터 미변경. ${attempt + 1}차 재시도를 10분 후 실행합니다.`);
        retryTimer = setTimeout(() => scheduledCollect(attempt + 1), 10 * 60 * 1000);
    } else if (result.skipped) {
        log('⚠️ 최대 재시도 횟수 초과. 다음 스케줄까지 대기합니다.');
    }
}

/**
 * 진행 중인 재시도 타이머 취소 (서버 종료 시 등)
 */
function cancelRetry() {
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
}

// ============================================================================
// 캐시 상태 조회 함수
// ============================================================================

/**
 * 현재 캐시 상태를 반환 (관리자 페이지 등에서 활용)
 *
 * @returns {Object} 캐시 메타 정보 또는 '캐시 없음' 상태
 */
function getCacheStatus() {
    const metaPath = path.join(CACHE_DIR, 'meta.json');
    if (fs.existsSync(metaPath)) {
        try {
            return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        } catch (e) {
            return { status: 'meta.json 읽기 오류' };
        }
    }
    return { status: '캐시 없음' };
}

/**
 * 캐시 디렉토리 경로를 반환 (라우트에서 파일 서빙에 사용)
 * @returns {string}
 */
function getCacheDir() {
    return CACHE_DIR;
}

/**
 * 지역 코드 목록을 반환 (프론트엔드 드롭다운 구성에 사용)
 * @returns {Object} { korea: '전국', busan: '부산', ... }
 */
function getAreaCodes() {
    return AREA_CODES;
}

// ============================================================================
// 모듈 내보내기
// ============================================================================
module.exports = {
    collectOceanCondition,   // 전체 수집 실행
    scheduledCollect,        // 스케줄 수집 (재시도 포함)
    cancelRetry,             // 재시도 타이머 취소
    getCacheStatus,          // 캐시 상태 조회
    getCacheDir,             // 캐시 디렉토리 경로
    getAreaCodes,            // 지역 코드 목록
    AREA_CODES               // 지역 코드 상수 (직접 참조용)
};
