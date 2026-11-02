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
 * - (2026-10-18) fetchTideBedPage 시간 제한 TIDEBED_TIMEOUTS(연결 5초·전체 15초) — 연결 실패만 다른 키로 1회 재시도
 * - (2026-10-20) 전체 기한 15초 → 30초 — TideBED 가 간헐적으로 약 18초 걸려 정상 응답이 끊겼다(아래 TIDEBED_TIMEOUTS)
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
/** TideBED 요청 1건의 시간 제한(ms) — 두 단계로 나눈다(2026-10-18, 독립 검토 B-D2·B-D3 로 고침).
 *  connectMs: 연결(TCP+TLS)이 이 안에 안 되면 끊는다. 서버에 요청이 닿지도 않았으므로 **다른 키로 1회** 다시 묻는다.
 *  totalMs  : 요청 시작부터 응답 끝까지의 전체 기한. 넘기면 끊되 **곧바로 다시 묻지 않고**, 페이지 재시도
 *             (collectTideBedPages)도 하지 않는다 — 느린 정상 응답을 끊고 거듭 물으면 페이지당 요청이 최대 6배가 된다.
 *  [근거] ①처음엔 req.setTimeout(10초) 하나였는데, 그것은 **연결된 뒤에만** 시작해 연결이 안 되는 경우
 *    (예전 증상 — 약 127초) 를 막지 못했다(검토 B 실측). ②전체 기한 15초 = 같은 apis.data.go.kr 계열 다른 수집기의
 *    상한(marine_client·regional_forecast_collector 15초 — bulletin_cancel_scanner 는 10초). 이 응답을
 *    바텀시트가 기다리므로 그보다 길게는 두지 않았다. ③연결 5초 = 정상이면 1초 안쪽인 연결 단계에 여유를 둔 값.
 *    ⚠TideBED 정상 응답 시간은 이 환경에서 잴 수 없었다(접속 차단) — 운영 로그로 확인해 고칠 것.
 *  사용자 최악 대기: 연결 실패 5초 + 다른 키 5초 = 10초, 느린 응답 30초(그 뒤 오류).
 *  [2026-10-20 전체 기한 15초 → 30초 — 운영 로그와 실측으로 고침]
 *    운영 로그(10-20 09:14 KST): 바텀시트 조석 요청이 「TideBED Page 1 … 전체 시간 초과 15000ms」로 끊겨
 *    「격자 해시를 확인할 수 없습니다」 → 사용자 화면에 조석이 안 나왔다. 같은 날 같은 요청(numOfRows=1)을 좌표 6곳에
 *    15번 직접 보내 보니 응답이 온 10번 중 8번은 1~2초였고 **2번은 18.0초·18.5초** 걸려 정상 자료가 왔다(둘 다 위 좌표
 *    33.70771, 126.60283 — 그러나 같은 좌표의 300건 페이지·이후 8번은 2초 안쪽이라 좌표 탓이 아니라 간헐적 지연).
 *    나머지 5번은 연결이 끊겼는데, 시험 환경의 중계(프록시) 기록에도 남아 있어 TideBED 탓인지 가르지 못했다.
 *    15초면 이 느린 정상 응답을 버린다.
 *    30초 = 관측 최대(18.5초)에 여유를 둔 값. 시간 제한이 없던 10-18 이전에는 이런 응답을 기다려 받았다.
 *    ⚠연결 기한(5초)은 그대로 — 위 지연은 연결 뒤 응답 대기에서 났다.
 *  (시험이 짧은 값으로 바꿔 쓸 수 있게 객체로 둔다 — test_tide_edges.js [D]) */
const TIDEBED_TIMEOUTS = { connectMs: 5000, totalMs: 30000 };

// ============================================================================
// 사용자 요청 우선 신호 (야간 앵커 수집과 TideBED 키 충돌 회피)
// ----------------------------------------------------------------------------
//   야간 수집기(tide_field_collector)와 사용자 바텀시트 조석 요청이 같은 TideBED
//   키 3개를 공유한다. 수집 중 사용자가 바텀시트를 열면 동시 호출이 키 한도를
//   넘겨 사용자 요청이 실패할 수 있다. 사용자 라우트가 요청마다 noteUserRequest()
//   로 활동 시각을 찍고, 수집기는 isUserActive() 인 동안 키를 양보(대기)한다.
//   → 사용자 요청이 우선 처리되고 수집은 그 뒤 이어진다.
let _lastUserTideRequestAt = 0;
const USER_ACTIVE_WINDOW_MS = 10000;   // 사용자 요청 후 이 시간 동안 수집 양보(10초)
/** 사용자 조석 요청 처리 시 호출 — "지금 사용자 활동 중" 표시. */
function noteUserRequest() { _lastUserTideRequestAt = Date.now(); }
/** 최근 windowMs 내 사용자 조석 요청이 있었나(=수집기가 양보해야 하나). */
function isUserActive(windowMs) {
    return (Date.now() - _lastUserTideRequestAt) < (windowMs || USER_ACTIVE_WINDOW_MS);
}

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

// [TDZ 수정] 아래 설정 로드/초기화 블록이 saveTideBedConfig({ flush: true }) 를 호출하는데,
//   그 함수가 참조하는 _saveDebounceTimer(let) 선언이 블록보다 뒤에 있으면
//   "Cannot access '_saveDebounceTimer' before initialization" 으로 부팅이 깨진다
//   (설정파일이 없거나 날짜변경/키 마이그레이션이 필요한 경우). 선언을 호출보다
//   앞으로 끌어올려 TDZ 를 제거한다. (함수 _doWriteConfig/saveTideBedConfig 는 호이스팅됨)
let _saveDebounceTimer = null;
const _SAVE_DEBOUNCE_MS = 5000;

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
 *
 * [2026-05] currentIndex 는 더 이상 per-call key 선택에 사용되지 않음
 *   (pickKeyIndex 가 round-robin 카운터 사용). 이 함수는 한도 초과 키를
 *   excludeIndices 에 추가하거나, 호환성을 위해 사용량 메타 갱신만 트리거.
 */
function rotateTideBedKey() {
    tideBedConfig.currentIndex = (tideBedConfig.currentIndex + 1) % tideBedConfig.keys.length;
    console.log(`🔄 TideBED API Key 회전 → 인덱스 ${tideBedConfig.currentIndex + 1}번`);
    saveTideBedConfig({ flush: true });
}

// ── 키 분산 호출 (Round-Robin per call) — 2026-05 ───────────────────
// 기존: tideBedConfig.currentIndex 의 키 1개만 사용 (한도 도달 시에만 회전).
//   동시 호출 다수가 같은 키로 몰려 TideBED 측 키별 throttle/UNKNOWN_ERROR 빈발.
// 변경: 호출마다 다음 키 선택. 7~15 페이지 동시 호출이 3개 키로 분산 → 키당
//   부하 1/3 → UNKNOWN_ERROR 빈도 감소 + 일일 한도(키당 10,000) 균등 활용.
// 정책:
//   - 호출 카운터 % 키수
//   - 일일 한도 도달 키는 자동 제외
//   - 재시도 시 실패 키를 excludeIndices 로 회피 (다른 키로 강제 전환)
let _keyRoundRobinCounter = 0;
function pickKeyIndex(excludeIndices) {
    const ex = Array.isArray(excludeIndices) ? excludeIndices : [];
    const n = tideBedConfig.keys.length;
    if (n === 0) return -1;
    // 최대 2바퀴 시도: 한도 초과/제외 키 회피
    for (let attempt = 0; attempt < n * 2; attempt++) {
        const idx = _keyRoundRobinCounter % n;
        _keyRoundRobinCounter = (_keyRoundRobinCounter + 1) % (n * 1000); // overflow 방지
        if (ex.includes(idx)) continue;
        const k = tideBedConfig.keys[idx];
        if ((k.used || 0) >= 10000) continue; // 일일 한도 도달 키 자동 제외
        return idx;
    }
    // 모두 한도 초과/제외 → 제외 안 된 첫 키라도 반환 (최후 수단)
    for (let i = 0; i < n; i++) if (!ex.includes(i)) return i;
    return -1; // 정말로 가용 키 없음
}

// ============================================================================
// TideBED API 호출 함수
// ============================================================================

/**
 * TideBED API 단일 페이지 호출 — 키 분산 호출 (Round-Robin per call)
 *
 * [2026-05] 매 호출마다 다음 키 사용. 동시 호출이 여러 키로 분산되어 키별
 *   throttle/UNKNOWN_ERROR 빈도 감소. 실패 시 그 키를 excludeKeyIndices 에
 *   추가하고 다른 키로 재시도 (실패 키 회피).
 *
 * [시간 제한·네트워크 재시도 — 2026-10-18]
 *   예전엔 https.get 에 시간 제한이 없어, 연결이 안 되면 OS 가 포기할 때까지(리눅스 기본 SYN 재시도
 *   6회 ≈ 127초 + 응답 대기) 사용자 바텀시트가 "불러오는 중"으로 멈췄다(getGridHash 가 응답 전에
 *   이 함수를 기다린다). 지금은 TIDEBED_TIMEOUTS 의 두 기한을 건다:
 *     - 연결 단계 실패(연결 시간 초과·연결 거부·DNS 등, 응답 전) → 다른 키로 **1회만** 다시. 두 번째도 실패면 null.
 *     - 연결 뒤 전체 기한 초과 → 다시 묻지 않고 { _timedOut: true } (호출부는 실패로 보고, 페이지 재시도도 안 한다).
 *     - 연결 뒤 끊김(본문 중단 등) → null(다시 묻지 않음 — 페이지 재시도가 맡는다).
 *
 * @param {number} retryCount  내부 재귀 카운터 (외부 호출 시 0)
 * @param {number[]} excludeKeyIndices  재시도 시 회피할 키 인덱스 (실패 키)
 * @param {boolean} netRetried  네트워크 오류로 이미 한 번 다시 물었나(내부용 — 두 번째 오류면 그대로 null)
 */
async function fetchTideBedPage(lat, lon, reqDate, pageNo, numOfRows = 300, retryCount = 0, excludeKeyIndices = [], netRetried = false) {
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

    // 호출마다 다음 키 선택 (한도 초과/실패 키 자동 회피)
    const keyIdx = pickKeyIndex(excludeKeyIndices);
    if (keyIdx < 0) {
        console.error(`❌ 가용 TideBED API 키 없음 (excludeKeyIndices=[${excludeKeyIndices.join(',')}])`);
        return null;
    }
    const currentKeyData = tideBedConfig.keys[keyIdx];
    const apiKey = currentKeyData.key;
    const keyLabel = currentKeyData.owner ? `#${keyIdx + 1}(${currentKeyData.owner})` : `#${keyIdx + 1}`;

    return new Promise((resolveOnce) => {
        // 응답 끝·요청 오류·응답 오류가 겹쳐 와도 결과는 한 번만 낸다(시간 초과로 끊을 때 둘 다 올 수 있다).
        let settled = false;
        const resolve = (v) => { if (!settled) { settled = true; resolveOnce(v); } };
        const encodedKey = encodeURIComponent(apiKey);
        const url = `${TIDEBED_BASE_URL}?serviceKey=${encodedKey}&lat=${lat}&lot=${lon}&reqDate=${reqDate}&type=json&min=1&numOfRows=${numOfRows}&pageNo=${pageNo}`;

        const req = https.get(url, (response) => {
            let data = '';
            response.on('error', onNetError);   // 본문을 받다가 끊긴 경우(시간 초과 포함)
            response.on('data', chunk => data += chunk);
            response.on('end', async () => {
                try {
                    if (data.includes('SERVICE_ERROR') || data.includes('LIMITED_NUMBER') || data.includes('OVER_QUOTA')) {
                        console.warn(`⚠️ TideBED Key ${keyLabel} 제한/오류 — 실패 키 제외하고 다른 키로 재시도`);
                        if (retryCount < tideBedConfig.keys.length) {
                            const newExclude = excludeKeyIndices.concat([keyIdx]);
                            const result = await fetchTideBedPage(lat, lon, reqDate, pageNo, numOfRows, retryCount + 1, newExclude, netRetried);
                            return resolve(result);
                        }
                    }

                    const parsed = JSON.parse(data);

                    currentKeyData.used = (currentKeyData.used || 0) + 1;
                    if (currentKeyData.used >= 10000) {
                        console.log(`🚀 Key ${keyLabel} 일일 한도(10,000회) 도달 — pickKeyIndex 가 이후 자동 제외`);
                    }
                    saveTideBedConfig(); // 디바운스 저장

                    resolve(parsed);
                } catch (e) {
                    if (data.includes('<returnReasonCode>')) {
                        console.warn(`⚠️ TideBED Key ${keyLabel} XML 에러 응답 — 실패 키 제외하고 다른 키로 재시도`);
                        if (retryCount < tideBedConfig.keys.length) {
                            const newExclude = excludeKeyIndices.concat([keyIdx]);
                            const result = await fetchTideBedPage(lat, lon, reqDate, pageNo, numOfRows, retryCount + 1, newExclude, netRetried);
                            return resolve(result);
                        }
                    }
                    console.error(`❌ TideBED Page ${pageNo} (Key ${keyLabel}) JSON parse error:`, e.message);
                    resolve(null);
                }
            });
        });
        // 두 기한 — 연결 단계(connectMs)·전체(totalMs). 둘 다 끊으면 아래 onNetError 로 간다.
        let connected = false, timedOut = false;
        const connTimer = setTimeout(() => { if (!connected) req.destroy(new Error(`연결 시간 초과 ${TIDEBED_TIMEOUTS.connectMs}ms`)); }, TIDEBED_TIMEOUTS.connectMs);
        const totalTimer = setTimeout(() => { timedOut = true; req.destroy(new Error(`전체 시간 초과 ${TIDEBED_TIMEOUTS.totalMs}ms`)); }, TIDEBED_TIMEOUTS.totalMs);
        const clearTimers = () => { clearTimeout(connTimer); clearTimeout(totalTimer); };
        req.on('socket', (sock) => {
            if (!sock.connecting) { connected = true; return; }   // 재사용된(이미 연결된) 소켓
            sock.once('connect', () => { connected = true; });
            sock.once('secureConnect', () => { connected = true; });
        });
        req.on('response', () => { connected = true; });
        req.on('close', clearTimers);
        req.on('error', onNetError);
        async function onNetError(err) {
            clearTimers();
            if (settled) return;
            console.error(`❌ TideBED Page ${pageNo} (Key ${keyLabel}) request error:`, err && err.message);
            // 연결 단계 실패 → 다른 키로 1회만(키가 1개뿐이면 같은 키로 1회). 요청이 서버에 닿지 않았다.
            if (!connected && !netRetried) {
                settled = true;   // 이 요청의 결과는 재시도 결과로 낸다
                const newExclude = tideBedConfig.keys.length > 1 ? excludeKeyIndices.concat([keyIdx]) : excludeKeyIndices;
                return resolveOnce(await fetchTideBedPage(lat, lon, reqDate, pageNo, numOfRows, retryCount + 1, newExclude, true));
            }
            // 연결 뒤 전체 기한 초과 → 다시 묻지 않는다(느린 정상 응답을 거듭 끊어 호출만 늘리지 않게).
            resolve(timedOut ? { _timedOut: true } : null);
        }
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
    // [시간 초과 페이지는 다시 묻지 않는다 — 2026-10-18 독립 검토 B-D3] 전체 기한(15초)을 넘긴 페이지까지
    //   아래에서 2번 더 물으면 느린 정상 응답 하나에 요청이 3배(연결 재시도까지 6배)가 된다. 그 페이지는 실패로 남기고
    //   다음 수집 때(앵커 수집기는 다음 배치·기동 보충, 바텀시트는 사용자 재요청) 다시 받는다.
    const timedOutPages = new Set();
    for (const { page, result } of results) {
        if (result && result._timedOut) timedOutPages.add(page);
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

    // 백오프: 200ms → 500ms (이전 500/1000ms 에서 단축 — boundary 최적화로 1차 호출
    //   페이지 수가 15→7~9 로 감소하면 TideBED 부하/UNKNOWN_ERROR 자체가 줄어 재시도
    //   발생 빈도가 낮아진다. 재시도가 발생했을 때는 사용자 latency 에 직결되므로
    //   초기 backoff 를 짧게 가져가 빠른 복구. 200ms 도 일시 네트워크 글리치/응답
    //   큐잉에는 충분하다. 최대 횟수(2회) 는 무한 재시도 방지로 유지.
    const RETRY_DELAYS_MS = [200, 500];
    const MAX_PAGE_RETRIES = RETRY_DELAYS_MS.length;
    let retryAttempt = 0;
    let remainingFailed = failedPages.filter(pg => !timedOutPages.has(pg));
    while (remainingFailed.length > 0 && retryAttempt < MAX_PAGE_RETRIES) {
        const backoffMs = RETRY_DELAYS_MS[retryAttempt];
        retryAttempt++;
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
            } else if (result && result._timedOut) {
                console.warn(`  ⚠️ Page ${page} (재시도 ${retryAttempt}): 시간 초과 — 더 묻지 않음`);
                timedOutPages.add(page);
            } else {
                console.warn(`  ⚠️ Page ${page} (재시도 ${retryAttempt}): 여전히 실패 (응답 코드: ${header?.resultCode || 'N/A'})`);
                stillFailed.push(page);
            }
        }
        remainingFailed = stillFailed;
    }
    remainingFailed = remainingFailed.concat([...timedOutPages]).sort((a, b) => a - b);

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
    return (await lookupGridHash(lat, lon, reqDate)).hash;
}

/**
 * 격자 해시를 묻되 「격자 미제공」과 「조회 실패」를 가른다(2026-10-18 독립 검토 C-1·B-D4).
 * 예: 정상 → {hash:'1234_5678', error:false} · 격자 없음(응답은 왔는데 자료 없음) → {hash:null, error:false}
 *     · 네트워크 오류·시간 초과·키 오류·알 수 없는 오류 코드 → {hash:null, error:true}
 * @param {number} lat @param {number} lon @param {string|number} reqDate - YYYYMMDD
 * @returns {Promise<{hash:string|null, error:boolean}>}
 * [연계] ← getGridHash(바텀시트 — 종전처럼 해시만) · 세 앵커 수집기 collectOne·resolveNudge
 *   [왜] 예전엔 둘 다 null 이라, 일시 장애(새 10초 시간 제한 포함) 때 수집기가 곡선이 있던 파일을
 *     「격자 미제공」 빈 파일로 덮었고, 서해·남해 인근 격자 탐색은 장애를 「못 찾음」으로 세어 3번이면 앵커를 영구 포기했다.
 *   ⚠「자료 없음」 판정: 응답 머리(header)의 resultCode 가 없거나 '00'(정상)·'03'(공공데이터포털 NODATA)
 *     ·'10'(INVALID_REQUEST_PARAMETER_ERROR — 격자 밖 좌표)일 때.
 *   [코드 10 = 격자 밖 — 2026-10-19 운영 로그로 확인] 같은 수집·같은 날짜에서 특정 앵커 좌표만 늘 10 을 받고
 *     나머지는 정상으로 받았다(66회 · 그중 A0001 은 /api/tide-field/nogrid 의 격자 미제공 목록에 있던 앵커).
 *     10 을 「조회 실패」로 셌더니 그 앵커들이 매번 failed 가 되어, 인근 격자로 보정해 받던 앵커도 새 날짜를
 *     못 받고, 그 앵커들이 줄 맨 앞에 오면 연속 실패 차단기가 나머지 수집까지 멈췄다(물빠짐 8/114 · 제주 고립 26/45).
 */
async function lookupGridHash(lat, lon, reqDate) {
    let result = null;
    try { result = await fetchTideBedPage(lat, lon, reqDate, 1, 1); }
    catch (e) { console.error('❌ 격자 해시 조회 실패:', e.message); return { hash: null, error: true }; }
    if (!result || result._timedOut) return { hash: null, error: true };   // 네트워크·시간 초과·키 오류
    const body = result?.response?.body || result?.body;
    const header = result?.response?.header || result?.header;
    if (body && body.items) {
        const item = Array.isArray(body.items.item) ? body.items.item[0] : body.items.item;
        if (item && item.m2TconstAmp !== undefined && item.m2TconstTlag !== undefined) {
            const amp = Math.round(parseFloat(item.m2TconstAmp) * 1000);
            const tlag = Math.round(parseFloat(item.m2TconstTlag) * 1000);
            return { hash: `${amp}_${tlag}`, error: false };
        }
    }
    const code = header && header.resultCode != null ? String(header.resultCode) : null;
    if (code && code !== '00' && code !== '03' && code !== '10') {
        console.warn(`⚠️ 격자 해시 조회 — 오류 코드 ${code}(${header.resultMsg || ''}) — 「격자 미제공」으로 치지 않는다`);
        return { hash: null, error: true, code };
    }
    // code 를 함께 준다 — 바텀시트 라우트가 「왜 격자 미제공인가」를 로그에 남기게(2026-10-20: 4.9초 만에 이유 없이
    //   「격자 해시를 확인할 수 없습니다」만 남은 건이 있었는데, 실패인지 격자 밖인지 로그로 가를 수 없었다).
    return { hash: null, error: false, code };
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
    TIDEBED_TIMEOUTS,
    collectTideBedData,
    collectTideBedPages,   // 페이지 셀렉터 (boundary 최적화) 지원 신규 API
    getGridHash,
    lookupGridHash,
    getAdjacentDates,
    collectAndSaveTideData,
    // [사용자 우선] 야간 수집과 키 충돌 회피용 신호
    noteUserRequest,
    isUserActive,
    USER_ACTIVE_WINDOW_MS
    // scheduleFileCleanup 제거됨 — 디스크 캐시 제거로 dead code (사용처 0건)
};
