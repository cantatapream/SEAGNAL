/**
 * ============================================================================
 * 파일명: routes/ocean1.js
 * 역할: 해양종합정보 메인 라우터 + 수심 조회 API
 * ============================================================================
 *
 * [설명]
 * 해양종합정보 지도에서 사용하는 API의 메인 진입점입니다.
 * 이 파일은 수심 조회 기능을 직접 제공하고,
 * 나머지 해양 API들(ocean2~5)을 하나로 묶어 등록합니다.
 *
 * - GET /api/ocean/depth → 특정 좌표의 수심 조회 (BADA2024 격자 데이터)
 *
 * [연계 파일]
 * - ocean2.js → ROMS 유향유속/수온 API
 * - ocean3.js → 기상청 풍향속 API
 * - ocean4.js → 파고 + 종합 데이터 API
 * - ocean5.js → 저질 AI 판독 API
 * - server.js → app.use()로 이 라우터 등록
 * - data/bathymetry/ → BADA2024 수심 격자 파일 (Fly.io Volume에 저장)
 *
 * [수심 데이터 구조]
 * bathymetry/ 폴더에 "lat{위도정수}_lon{경도정수}" 파일이 59개 있음
 * 각 파일은 CSV 형식: 경도,위도,수심(m)
 * 예: 125.407856,30.999858,63.930301
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DATA_DIR } = require('../config/server_config');

// ============================================================================
// 수심 데이터 관련 설정
// ============================================================================

// 수심 데이터 파일이 저장된 폴더 경로
// [연계] Fly.io Volume → /app/local_server/data/bathymetry/
const BATHYMETRY_DIR = path.join(DATA_DIR, 'bathymetry');

// 사용 가능한 수심 파일 목록을 서버 시작 시 한번 읽어서 캐시
// → 매 요청마다 폴더를 읽지 않아도 되므로 성능 향상
let availableFiles = new Set();

/**
 * 서버 시작 시 수심 파일 목록 로드
 * - bathymetry/ 폴더에서 "lat숫자_lon숫자" 형태의 파일만 등록
 * - 파일이 없어도 에러 없이 빈 Set으로 유지 (내륙 좌표 등 대비)
 */
function loadBathymetryFileList() {
    try {
        if (fs.existsSync(BATHYMETRY_DIR)) {
            const files = fs.readdirSync(BATHYMETRY_DIR);
            files.forEach(f => {
                if (f.startsWith('lat')) {
                    availableFiles.add(f);
                }
            });
            console.log(`[Ocean] 수심 데이터 파일 ${availableFiles.size}개 감지`);
        } else {
            console.warn('[Ocean] 수심 데이터 폴더 없음:', BATHYMETRY_DIR);
        }
    } catch (e) {
        console.error('[Ocean] 수심 파일 목록 로드 실패:', e.message);
    }
}

// 서버 시작 시 파일 목록 로드
loadBathymetryFileList();

// ============================================================================
// API: 수심 조회
// ============================================================================

/**
 * GET /api/ocean/depth
 *
 * 특정 좌표의 수심을 BADA2024 격자 데이터에서 조회합니다.
 *
 * [동작 흐름]
 * 1. 클릭 좌표(lat, lon)를 받음
 * 2. 좌표의 정수 부분으로 해당 파일 결정 (예: 34.5, 126.3 → "lat34_lon126")
 * 3. 파일을 한 줄씩 읽으며 가장 가까운 격자점 검색
 * 4. 가장 가까운 점의 수심값 반환
 *
 * [요청 파라미터]
 * - lat (필수): 위도 (예: 34.5)
 * - lon (필수): 경도 (예: 126.3)
 *
 * [응답 예시]
 * { success: true, depth: 45.2, nearestLat: 34.498, nearestLon: 126.301, distance: 0.003 }
 */
router.get('/api/ocean/depth', async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lon = parseFloat(req.query.lon);

        // 파라미터 유효성 검사
        if (isNaN(lat) || isNaN(lon)) {
            return res.status(400).json({ success: false, error: '위도(lat)와 경도(lon)를 입력해주세요.' });
        }

        // 좌표의 정수 부분으로 파일명 결정
        // 예: lat=34.5, lon=126.3 → "lat34_lon126"
        const latKey = Math.floor(lat);
        const lonKey = Math.floor(lon);
        const fileName = `lat${latKey}_lon${lonKey}`;

        // 해당 파일이 존재하는지 캐시된 목록에서 확인
        if (!availableFiles.has(fileName)) {
            return res.json({ success: false, error: '해당 해역의 수심 데이터가 없습니다.' });
        }

        const filePath = path.join(BATHYMETRY_DIR, fileName);

        // 파일을 한 줄씩 읽으며 가장 가까운 격자점 탐색
        // - 전체 파일을 메모리에 올리지 않고 스트림으로 읽어 메모리 절약
        // - 각 줄의 좌표와 클릭 좌표의 거리를 계산하여 최솟값 추적
        const result = await findNearestDepth(filePath, lat, lon);

        if (result) {
            res.json({
                success: true,
                depth: result.depth,
                nearestLat: result.lat,
                nearestLon: result.lon,
                distance: result.distance
            });
        } else {
            res.json({ success: false, error: '수심 데이터를 찾을 수 없습니다.' });
        }
    } catch (e) {
        console.error('[Ocean] 수심 조회 오류:', e.message);
        res.status(500).json({ success: false, error: '수심 조회 중 오류가 발생했습니다.' });
    }
});

/**
 * 수심 파일에서 가장 가까운 격자점을 찾는 함수
 *
 * [동작 방식]
 * - 파일을 한 줄씩 스트림으로 읽음 (메모리 효율적)
 * - 각 줄: "경도,위도,수심" 형태의 CSV
 * - 클릭 좌표와의 유클리드 거리 계산
 * - 가장 가까운 점의 수심을 반환
 *
 * @param {string} filePath - 수심 파일 경로
 * @param {number} targetLat - 클릭한 위도
 * @param {number} targetLon - 클릭한 경도
 * @returns {Object|null} { lat, lon, depth, distance }
 */
function findNearestDepth(filePath, targetLat, targetLon) {
    return new Promise((resolve, reject) => {
        let nearest = null;
        let minDistSq = Infinity; // 거리의 제곱 (제곱근 계산 생략으로 성능 향상)

        const rl = readline.createInterface({
            input: fs.createReadStream(filePath),
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            // 각 줄 파싱: "경도,위도,수심"
            const parts = line.split(',');
            if (parts.length < 3) return;

            const lon = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            const depth = parseFloat(parts[2]);

            if (isNaN(lon) || isNaN(lat) || isNaN(depth)) return;

            // 유클리드 거리의 제곱 (제곱근 생략 → 비교만 하면 되므로)
            const dLat = lat - targetLat;
            const dLon = lon - targetLon;
            const distSq = dLat * dLat + dLon * dLon;

            if (distSq < minDistSq) {
                minDistSq = distSq;
                nearest = { lat, lon, depth, distance: Math.sqrt(distSq) };
            }
        });

        rl.on('close', () => resolve(nearest));
        rl.on('error', (err) => reject(err));
    });
}

// ============================================================================
// API: 해양종합정보 설정 (프론트엔드에서 KHOA 맵 키 조회용)
// ============================================================================

/**
 * GET /api/ocean/config
 * 해양종합정보 프론트엔드에서 필요한 설정값을 반환합니다.
 * - KHOA_MAP_KEY: 해아름 지도 타일 API 키
 */
router.get('/api/ocean/config', (req, res) => {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'api_config.json'), 'utf8'));
        res.json({
            KHOA_MAP_KEY: config.KHOA_MAP_KEY || ''
        });
    } catch (e) {
        res.json({ KHOA_MAP_KEY: '' });
    }
});

// ============================================================================
// 하위 라우터 연결 (ocean2~5)
// ============================================================================
// 각 파일이 존재할 때만 안전하게 로드
// → 개발 중 파일이 아직 없어도 서버가 정상 기동됨

try { router.use(require('./ocean2')); } catch (e) { console.warn('[Ocean] ocean2.js 로드 실패:', e.message); }
try { router.use(require('./ocean3')); } catch (e) { console.warn('[Ocean] ocean3.js 로드 실패:', e.message); }
try { router.use(require('./ocean4')); } catch (e) { console.warn('[Ocean] ocean4.js 로드 실패:', e.message); }
try { router.use(require('./ocean5')); } catch (e) { console.warn('[Ocean] ocean5.js 로드 실패:', e.message); }

module.exports = router;
