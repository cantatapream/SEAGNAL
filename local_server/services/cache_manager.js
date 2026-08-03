/**
 * ============================================================================
 * 파일명: services/cache_manager.js
 * 역할: 서버 메모리 캐시를 관리하는 모듈
 * ============================================================================
 *
 * [설명]
 * 이 파일은 서버의 데이터를 메모리에 캐싱하여 빠르게 응답할 수 있도록 합니다.
 * - dataCache: 특보, 부이, 전망, 공지, 홍보 데이터를 5초마다 JSON 파일에서 읽어 메모리에 보관
 * - tideCache: 조석 데이터를 LRU(Least Recently Used) 방식으로 최대 500건, 1시간 유지
 *
 * [연계 파일]
 * - config/server_config.js → DATA_DIR 경로 사용
 * - routes/*.js → dataCache 데이터를 API 응답으로 제공
 * - services/tide_collector.js → tideCache에 조석 데이터 저장/조회
 *
 * [초보자를 위한 안내]
 * 서버가 매번 파일을 읽으면 느리기 때문에, 자주 사용하는 데이터를 메모리(RAM)에
 * 미리 올려두고 빠르게 제공하는 것을 "캐싱"이라고 합니다.
 * LRU Cache는 가장 오래 사용하지 않은 데이터부터 자동으로 삭제하는 똑똑한 캐시입니다.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const LRU = require('lru-cache');
const { DATA_DIR } = require('../config/server_config');

// ============================================================================
// 1. 일반 데이터 캐시 (특보, 부이, 전망, 공지, 홍보)
// ============================================================================
const dataCache = {
    warnings: null,
    buoys: null,
    kmaBuoys: null,           // [DEPRECATED 2026-04-25] kma_buoy.php 캐시 — 갱신 중단, 호환을 위해 유지
    // [신규 2026-04-25] marine.kma.go.kr JSON endpoint 캐시
    marineBuoys: null,        // B타입 (해양기상부이) — buoy/list
    marineWhBuoys: null,      // C타입 (파고부이)     — wh-buoy/list
    marineLhBuoys: null,      // L타입 (등표)         — lh/list
    marineVs: null,           // 시정계 station       — vs/list (UI 표시는 후속, 캐시만)
    forecasts: null,
    zoneForecasts: null,
    midTermSeaForecasts: null,
    notice: null,
    promo: null,
    boards: null,
    fishingIndex: null,       // 바다낚시 지수 (scheduler.js → fishing_index.json)
    seaSplitIndex: null,      // 바다갈라짐 체험지수 (scheduler.js → sea_split_index.json)
    surfingIndex: null,       // 서핑지수 (scheduler.js → surfing_index.json)
    mudflatIndex: null,       // 갯벌체험 지수 (scheduler.js → mudflat_index.json)
    scubaIndex: null,         // 스킨스쿠버 지수 (scheduler.js → scuba_index.json)
    ripCurrentIndex: null,    // 이안류 지수 (scheduler.js → ripcurrent_index.json)
    swimmingIndex: null,      // 해수욕 지수 (scheduler.js → swimming_index.json)
    lastUpdate: {}
};

/**
 * JSON 파일들을 메모리에 로드하는 함수
 *
 * [동작]
 *   5초마다 setInterval 로 호출됨. 각 파일의 mtime(마지막 수정 시각)을 먼저 stat 으로
 *   확인하여, **변경된 파일만** read + parse 하여 메모리 캐시를 갱신한다.
 *   변경되지 않은 파일은 stat 만 하고 read/parse 를 스킵 (CPU 부담 절감).
 *
 * [mtime 기반 read 최적화 도입 배경]
 *   zone_forecasts.json (5.85 MB) 같은 큰 파일은 하루 2회만 갱신되는데,
 *   기존 코드는 5초마다 무조건 read + JSON.parse 하여 12시간 동안 8,640번
 *   같은 작업을 반복했음. mtime 비교로 변경 시에만 read 하도록 변경.
 *
 * [정확성 보장]
 *   - 첫 호출: dataCache.lastUpdate[key] 가 undefined 라 read 됨 (정상)
 *   - cron 등 외부에서 파일 갱신 시: mtime 변경 → 다음 5초 주기에 read
 *   - 따라서 데이터 갱신 정확성은 동일하게 유지됨
 */
function refreshCache() {
    const files = {
        warnings: 'weather_alerts.json',
        buoys: 'buoys.json',
        kmaBuoys: 'kma_buoys.json',                  // DEPRECATED — 마지막 성공 캐시 그대로 유지
        // [신규 2026-04-25] marine.kma.go.kr JSON endpoint 4종 (매시 :03 KST 갱신)
        marineBuoys: 'marine_buoys.json',
        marineWhBuoys: 'marine_wh_buoys.json',
        marineLhBuoys: 'marine_lh_buoys.json',
        marineVs: 'marine_vs.json',                  // 시정계 — UI 표시 후속, 캐시만
        forecasts: 'general_forecasts.json',
        zoneForecasts: 'zone_forecasts.json',
        midTermSeaForecasts: 'mid_term_sea_forecasts.json',
        notice: 'notice.json',
        promo: 'promo.json',
        boards: 'boards.json',
        fishingIndex: 'fishing_index.json',       // 바다낚시 지수 데이터
        seaSplitIndex: 'sea_split_index.json',  // 바다갈라짐 체험지수 데이터
        surfingIndex: 'surfing_index.json',      // 서핑지수 데이터
        mudflatIndex: 'mudflat_index.json',      // 갯벌체험 지수 데이터
        scubaIndex: 'scuba_index.json',          // 스킨스쿠버 지수 데이터
        ripCurrentIndex: 'ripcurrent_index.json', // 이안류 지수 데이터
        swimmingIndex: 'swimming_index.json'     // 해수욕 지수 데이터
    };

    Object.keys(files).forEach(key => {
        const filePath = path.join(DATA_DIR, files[key]);
        if (fs.existsSync(filePath)) {
            try {
                const stats = fs.statSync(filePath);
                const mtime = stats.mtimeMs;

                // [최적화] mtime 이 같으면 read/parse 스킵 (이미 메모리에 있음).
                //   첫 호출 시 dataCache.lastUpdate[key] 가 undefined 라 자연스럽게 read 됨.
                if (dataCache.lastUpdate[key] === mtime) {
                    return;
                }

                // 변경된 경우에만 실제 read + parse
                const data = fs.readFileSync(filePath, 'utf8');
                dataCache[key] = JSON.parse(data);
                dataCache.lastUpdate[key] = mtime;
            } catch (e) {
                // 파일 읽기 실패 시 무시 (다음 주기에 재시도)
            }
        }
    });
}

// 5초마다 데이터 변경 확인 (서버 부하 거의 없음)
setInterval(refreshCache, 5000);
refreshCache(); // 초기 로드

// ============================================================================
// 2. 조석 데이터 LRU 캐시
// ============================================================================
// [원복 200 → 50 — 사용자 합의 2026-05]
//   "모든 사용자가 같은 해점을 클릭한다는 보장이 없고… 휴대폰 내에만 캐싱하고
//   캐싱 내용이 서버 등에 공유될 필요는 없어."
//   → 클라이언트(localStorage/메모리)에서 차등 캐싱하므로 서버는 단일 요청 내
//   3일 병렬 폴링 / 같은 응답 폴링 재사용 정도의 최소 메모리만 사용.
//   error 캐시 자동 TTL 30초 wrapper 도 제거 — 호출 측이 명시한 TTL 만 사용.
const tideCache = new LRU({
    max: 50,                     // 단일 응답 폴링 재사용 용도의 최소 메모리
    ttl: 1000 * 60 * 60,        // 1시간 후 자동 만료 (정상 데이터)
    updateAgeOnGet: true         // 조회 시 TTL 갱신 — 폴링 중인 항목 보호
});

module.exports = {
    dataCache,
    tideCache,
    refreshCache
};
