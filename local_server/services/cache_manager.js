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
    kmaBuoys: null,
    forecasts: null,
    zoneForecasts: null,
    notice: null,
    promo: null,
    boards: null,
    lastUpdate: {}
};

/**
 * JSON 파일들을 메모리에 로드하는 함수
 * 5초마다 자동 실행되며, Docker 환경에서의 파일 감지 이슈를 방지하기 위해
 * 무조건 파일을 새로 읽어서 캐시를 갱신합니다.
 */
function refreshCache() {
    const files = {
        warnings: 'weather_alerts.json',
        buoys: 'buoys.json',
        kmaBuoys: 'kma_buoys.json',
        forecasts: 'general_forecasts.json',
        zoneForecasts: 'zone_forecasts.json',
        notice: 'notice.json',
        promo: 'promo.json',
        boards: 'boards.json'
    };

    Object.keys(files).forEach(key => {
        const filePath = path.join(DATA_DIR, files[key]);
        if (fs.existsSync(filePath)) {
            try {
                const stats = fs.statSync(filePath);
                const mtime = stats.mtimeMs;
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
const tideCache = new LRU({
    max: 500,                    // 최대 500건 보관
    ttl: 1000 * 60 * 60,        // 1시간 후 자동 만료
    updateAgeOnGet: true         // 조회 시 TTL 갱신
});

module.exports = {
    dataCache,
    tideCache,
    refreshCache
};
