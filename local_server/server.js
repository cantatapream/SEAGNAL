require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const multer = require('multer'); // 파일 업로드 처리
const cron = require('node-cron'); // 스케줄링을 위한 cron

const scheduler = require('./scheduler');
const cloudBackup = require('./cloud_backup'); // [New] 클라우드 백업 모듈

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// [New] LRU Cache for Tide Data & Environment Flag
const LRU = require('lru-cache');
const tideCache = new LRU({
    max: 500,
    ttl: 1000 * 60 * 60,
    updateAgeOnGet: true
});
const IS_FLY_IO = !!process.env.FLY_APP_NAME;

// 업로드 폴더 확인 및 생성
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

// [수정] 스토리지 엔진 선택 (Cloudinary vs Local)
let upload;
if (process.env.CLOUDINARY_CLOUD_NAME) {
    const cloudinary = require('cloudinary').v2;
    const { CloudinaryStorage } = require('multer-storage-cloudinary');

    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });

    // 이미지 업로드용 스토리지
    const cloudStorage = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder: 'seagnal-uploads', // 클라우드 내 폴더명
            allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp'],
        },
    });

    // [New] 문서 파일 업로드용 스토리지 (raw 타입)
    const cloudStorageRaw = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: {
            folder: 'seagnal-files', // 문서 파일 폴더
            resource_type: 'raw', // 문서, 엑셀, 한글 등 지원
        },
    });

    upload = multer({ storage: cloudStorage });
    const uploadFile = multer({ storage: cloudStorageRaw });
    // uploadFile을 전역으로 사용할 수 있도록 설정
    global.uploadFile = uploadFile;

    console.log('☁️  Cloudinary Storage 모드로 동작합니다.');
} else {
    // 기존 로컬 설정
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, UPLOAD_DIR);
        },
        filename: (req, file, cb) => {
            // 한글 깨짐 방지: latin1 -> utf8 변환 (필요시)
            file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
            // 파일명 중복 방지: 타임스탬프 + 원본파일명
            cb(null, Date.now() + '_' + file.originalname);
        }
    });
    upload = multer({ storage: storage });
    // 로컬에서는 동일한 스토리지 사용 (모든 파일 허용)
    global.uploadFile = multer({ storage: storage });

    console.log('📂 Local Disk Storage 모드로 동작합니다.');
}

// ============================================================================
// [대규모 접속 최적화] 메모리 캐시 레이어
// ============================================================================
const dataCache = {
    warnings: null,
    buoys: null,
    forecasts: null,
    zoneForecasts: null,
    notice: null,
    promo: null, // 홍보 게시판 데이터
    lastUpdate: {}
};

// 파일을 메모리에 미리 로드하는 함수
function refreshCache() {
    const files = {
        warnings: 'weather_alerts.json',
        buoys: 'buoys.json',
        forecasts: 'general_forecasts.json',
        zoneForecasts: 'zone_forecasts.json',
        notice: 'notice.json',
        promo: 'promo.json'
    };

    Object.keys(files).forEach(key => {
        const filePath = path.join(DATA_DIR, files[key]);
        if (fs.existsSync(filePath)) {
            try {
                const stats = fs.statSync(filePath);
                const mtime = stats.mtimeMs;

                // [강제 갱신] mtime 비교 없이 5초마다 무조건 파일을 새로 읽어서 캐시 갱신
                // Docker 환경에서의 파일 감지 이슈 원천 봉쇄
                // if (dataCache.lastUpdate[key] !== mtime) {
                const data = fs.readFileSync(filePath, 'utf8');
                dataCache[key] = JSON.parse(data);
                dataCache.lastUpdate[key] = mtime;
                // console.log(`[Cache] ${key} 데이터 로드 완료`);
                // }
            } catch (e) {
                // console.error(`[Cache Error] ${key} 로드 실패:`, e.message);
            }
        }
    });
}

// 5초마다 데이터 변경 확인 (서버 부하 거의 없음)
setInterval(refreshCache, 5000);
refreshCache(); // 초기 로드

// [New] 매일 한국 시간 00:05분에 클라우드 백업 자동 실행 (Fly.io Timezone 고려)
// UTC 15:05 = KST 00:05
cron.schedule('5 15 * * *', () => {
    console.log('⏰ [Daily Schedule] 클라우드 백업 작업을 시작합니다.');
    cloudBackup.performBackup();
});

// ============================================================================
// 서버 설정 및 엔드포인트
// ============================================================================
app.use(cors());
app.use(express.json()); // [중요] 모든 POST 라우트에서 req.body를 사용하기 위해 먼저 설정

// [New] Fly.io 환경 대응: 메모리 캐시 데이터를 파일처럼 제공
// 클라이언트가 /data/tide_...json 요청 시, 파일 시스템보다 메모리를 먼저 확인
app.get('/data/:filename', (req, res, next) => {
    const filename = req.params.filename;

    // 1. 메모리 캐수에 데이터가 있으면 즉시 반환 (JSON)
    if (tideCache.has(filename)) {
        // console.log(`🚀 Memory Hit: ${filename}`); // 디버깅용 (필요 시 주석 해제)
        return res.json(tideCache.get(filename));
    }

    // 2. 없으면 다음 미들웨어(static file handler)로 넘김 -> 파일 시스템 조회 시도
    next();
});

// 정적 파일 제공 설정
// Fly.io 환경과 로컬 환경에 모두 대응하도록 설정
const staticRoot = process.env.FLY_ALLOC_ID ? __dirname : (fs.existsSync(path.join(__dirname, 'index.html')) ? __dirname : path.join(__dirname, '../'));

// 1. 기본 루트 (index.html, app.js, style.css 등)
app.use(express.static(staticRoot));

// 2. assets 폴더 내 리소스들을 루트에서도 접근 가능하게 설정 (sun_cloud_icon.png 등 호환성)
app.use(express.static(path.join(staticRoot, 'assets')));

// 3. images, uploads 등 명시적 경로 처리
app.use('/images', express.static(path.join(staticRoot, 'images')));
app.use('/tide_data', express.static(path.join(staticRoot, 'tide_data')));

// [수정] 메인 페이지 처리
app.get('/', (req, res) => {
    const flyPath = path.join(staticRoot, 'index.html');
    if (fs.existsSync(flyPath)) {
        res.sendFile(flyPath);
    } else {
        res.status(404).send('index.html 파일을 찾을 수 없습니다.');
    }
});

// [New] 서버 상태 확인용 헬스체크 API
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

console.log(`🌍 Serving static files from: ${staticRoot}`);

// 업로드된 파일 접근을 위한 정적 경로 설정 (UPLOAD_DIR 변수 사용)
app.use('/uploads', express.static(UPLOAD_DIR));

// 1. 특보 현황
// 1. 특보 정보 (통합 크롤러 데이터)
app.get('/api/weather-alerts', (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'weather_alerts.json');
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'weather_alerts.json not found' });
        }
        res.sendFile(filePath);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// (Legacy warnings endpoint removed)



// 2. 부이 정보
app.get('/api/buoys', (req, res) => {
    if (dataCache.buoys) res.json(dataCache.buoys);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 2-1. API 상태 확인 및 강제 업데이트
app.get('/api/status', (req, res) => {
    res.json(scheduler.getStatus());
});

app.post('/api/force-update/:type', async (req, res) => {
    const type = req.params.type;
    console.log(`🔄 수동 업데이트 요청: ${type}`);
    try {
        if (type === 'buoys') await scheduler.collectBuoys();
        else if (type === 'general') await scheduler.collectGeneralForecasts();
        else if (type === 'zone') await scheduler.collectZoneForecasts();
        else return res.status(400).json({ error: '잘못된 타입' });

        // 캐시 즉시 갱신
        refreshCache();

        res.json({ success: true, status: scheduler.getStatus()[type] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2-2. API 인증키 설정 조회 및 저장
app.get('/api/config', (req, res) => {
    try {
        res.json(scheduler.getConfig());
    } catch (e) {
        res.status(500).json({ error: '설정 조회 실패' });
    }
});

app.post('/api/config', (req, res) => {
    try {
        const success = scheduler.updateConfig(req.body);
        if (success) res.json({ success: true });
        else res.status(500).json({ error: '저장 실패' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});



// 3. 기상 전망
app.get('/api/forecasts', (req, res) => {
    if (dataCache.forecasts) res.json(dataCache.forecasts);
    else res.status(404).json({ error: '데이터 준비 중' });
});

// 4. 해구별 기상전망
app.get('/api/marine-zone-forecasts', (req, res) => {
    if (dataCache.zoneForecasts) res.json(dataCache.zoneForecasts);
    else res.status(404).json({ error: '데이터 준비 중' });
});


// 5. 공지사항 (GET)
app.get('/api/notice', (req, res) => {
    if (dataCache.notice) res.json(dataCache.notice);
    else res.json({ isActive: false }); // 파일 없으면 비활성 상태로 응답
});

// 6. 공지사항 저장/수정 (POST)
// express.json() 미들웨어는 상단에서 이미 설정됨

app.post('/api/notice', (req, res) => {
    const newNotice = req.body;

    // 유효성 검사 (간단히)
    if (typeof newNotice.isActive !== 'boolean') {
        return res.status(400).json({ error: '잘못된 데이터 형식' });
    }

    try {
        const filePath = path.join(DATA_DIR, 'notice.json');
        fs.writeFileSync(filePath, JSON.stringify(newNotice, null, 2), 'utf8');

        // 캐시 즉시 업데이트
        dataCache.notice = newNotice;
        dataCache.lastUpdate.notice = Date.now();

        res.json({ success: true, message: '공지사항이 저장되었습니다.' });
    } catch (e) {
        console.error('공지 저장 실패:', e);
        res.status(500).json({ error: '저장 실패' });
    }
});

// 6-1. 다중 공지사항 목록 조회 (활성/만료 분리)
app.get('/api/notices', (req, res) => {
    try {
        const filePath = path.join(DATA_DIR, 'notices.json');
        let notices = [];

        if (fs.existsSync(filePath)) {
            notices = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } else {
            // 기존 단일 공지 파일 호환
            if (dataCache.notice && dataCache.notice.isActive) {
                notices = [dataCache.notice];
            }
        }

        const now = new Date();
        const active = [];
        const expired = [];

        notices.forEach(n => {
            if (n.expiresAt) {
                const expDate = new Date(n.expiresAt.replace(' ', 'T') + ':00');
                if (expDate > now && n.isActive !== false) {
                    active.push(n);
                } else {
                    expired.push(n);
                }
            } else if (n.isActive) {
                active.push(n);
            } else {
                expired.push(n);
            }
        });

        res.json({ active, expired });
    } catch (e) {
        console.error('공지 목록 조회 실패:', e);
        res.json({ active: [], expired: [] });
    }
});

// 6-2. 다중 공지사항 저장/수정
app.post('/api/notices', (req, res) => {
    const newNotice = req.body;

    try {
        const filePath = path.join(DATA_DIR, 'notices.json');
        let notices = [];

        if (fs.existsSync(filePath)) {
            notices = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        // 기존 공지 수정 또는 신규 추가
        const existingIdx = notices.findIndex(n => n.id === newNotice.id);
        if (existingIdx >= 0) {
            notices[existingIdx] = newNotice;
        } else {
            notices.unshift(newNotice);
        }

        fs.writeFileSync(filePath, JSON.stringify(notices, null, 2), 'utf8');

        // 기존 단일 공지 파일도 업데이트 (호환성)
        if (newNotice.isActive) {
            const singlePath = path.join(DATA_DIR, 'notice.json');
            fs.writeFileSync(singlePath, JSON.stringify(newNotice, null, 2), 'utf8');
            dataCache.notice = newNotice;
        }

        res.json({ success: true });
    } catch (e) {
        console.error('공지 저장 실패:', e);
        res.status(500).json({ error: '저장 실패' });
    }
});

// 6-3. 공지사항 삭제
app.delete('/api/notice/:id', (req, res) => {
    const id = parseInt(req.params.id);

    try {
        const filePath = path.join(DATA_DIR, 'notices.json');
        let notices = [];

        if (fs.existsSync(filePath)) {
            notices = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        notices = notices.filter(n => n.id !== id);
        fs.writeFileSync(filePath, JSON.stringify(notices, null, 2), 'utf8');

        res.json({ success: true });
    } catch (e) {
        console.error('공지 삭제 실패:', e);
        res.status(500).json({ error: '삭제 실패' });
    }
});

// ============================================================================
// [신규] 6-4. 방문객 카운터 API (상세 통계 기록 추가)
// ============================================================================
const VISITORS_FILE = path.join(DATA_DIR, 'visitors.json');
const VISITORS_STATS_FILE = path.join(DATA_DIR, 'visitors_stats.json');

function getVisitorData() {
    try {
        if (fs.existsSync(VISITORS_FILE)) {
            return JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('방문객 데이터 로드 실패:', e);
    }
    return { today: 0, total: 0, lastDate: '' };
}

function updateGranularStats(kstDate) {
    try {
        const dateStr = kstDate.toISOString().split('T')[0];
        const hourStr = String(kstDate.getUTCHours()).padStart(2, '0');

        let stats = {};
        if (fs.existsSync(VISITORS_STATS_FILE)) {
            stats = JSON.parse(fs.readFileSync(VISITORS_STATS_FILE, 'utf8'));
        }

        if (!stats[dateStr]) {
            stats[dateStr] = { total: 0, hourly: {} };
        }

        stats[dateStr].total = (stats[dateStr].total || 0) + 1;
        stats[dateStr].hourly[hourStr] = (stats[dateStr].hourly[hourStr] || 0) + 1;

        // 최근 365일치 데이터만 유지 (파일 크기 관리)
        const keys = Object.keys(stats).sort();
        if (keys.length > 365) {
            delete stats[keys[0]];
        }

        fs.writeFileSync(VISITORS_STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
    } catch (e) {
        console.error('상세 통계 기록 실패:', e);
    }
}

app.get('/api/visit', (req, res) => {
    try {
        const data = getVisitorData();
        const shouldIncrement = req.query.inc !== 'false';

        if (shouldIncrement) {
            const now = new Date();
            const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
            const todayStr = kstDate.toISOString().split('T')[0];

            if (data.lastDate !== todayStr) {
                data.today = 1;
                data.lastDate = todayStr;
            } else {
                data.today += 1;
            }
            data.total += 1;

            fs.writeFileSync(VISITORS_FILE, JSON.stringify(data, null, 2), 'utf8');

            // 상세 통계 업데이트
            updateGranularStats(kstDate);
        }
        res.json(data);
    } catch (e) {
        console.error('방문객 카운트 실패:', e);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 방문자 통계 조회 API
app.get('/api/stats/visitors', (req, res) => {
    try {
        if (fs.existsSync(VISITORS_STATS_FILE)) {
            const stats = JSON.parse(fs.readFileSync(VISITORS_STATS_FILE, 'utf8'));
            res.json(stats);
        } else {
            res.json({});
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// [New] TideBED API Configuration & Key Management
const TIDEBED_CONFIG_FILE = path.join(DATA_DIR, 'tidebed_config.json');
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

// Config 로드
if (fs.existsSync(TIDEBED_CONFIG_FILE)) {
    try {
        const savedConfig = JSON.parse(fs.readFileSync(TIDEBED_CONFIG_FILE, 'utf8'));
        if (savedConfig.keys && savedConfig.keys.length > 0) {
            tideBedConfig = savedConfig;

            // [Fix] 기존 데이터에 expiry/owner 가 없는 경우 초기값 설정
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
    saveTideBedConfig(); // 기본 설정 저장
}

function saveTideBedConfig() {
    try {
        fs.writeFileSync(TIDEBED_CONFIG_FILE, JSON.stringify(tideBedConfig, null, 2), 'utf8');
    } catch (e) {
        console.error('⚠️ TideBED Config 저장 실패:', e.message);
    }
}

const TIDEBED_BASE_URL = 'https://apis.data.go.kr/1192136/tidebed/GetTidebedApiService';
const { findTidePeaks } = require('./peak_finder');

// TideBED API 페이지 호출 함수 (자동 키 전환 지원)
async function fetchTideBedPage(lat, lon, reqDate, pageNo, numOfRows = 300, retryCount = 0) {
    if (tideBedConfig.keys.length === 0) {
        console.error('❌ 등록된 TideBED API 키가 없습니다.');
        return null;
    }

    // [New] 매 호출 시 날짜 체크하여 일일 초기화 수행
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
                    // console.log(`  🔍 Page ${pageNo} raw response (first 200 chars):`, data.substring(0, 200));

                    // API 응답 에러 체크 (예: OVER_QUOTA, LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR)
                    if (data.includes('SERVICE_ERROR') || data.includes('LIMITED_NUMBER') || data.includes('OVER_QUOTA')) {
                        console.warn(`⚠️ TideBED API Key (${tideBedConfig.currentIndex + 1}번) 제한/오류 발생. 다음 키로 전환 시도...`);
                        if (retryCount < tideBedConfig.keys.length) {
                            rotateTideBedKey();
                            const result = await fetchTideBedPage(lat, lon, reqDate, pageNo, numOfRows, retryCount + 1);
                            return resolve(result);
                        }
                    }

                    const parsed = JSON.parse(data);

                    // 정상 응답인 경우 호출 횟수 증가
                    currentKeyData.used = (currentKeyData.used || 0) + 1;
                    if (currentKeyData.used >= 10000) {
                        console.log(`🚀 ${tideBedConfig.currentIndex + 1}번 키 제한(10,000회) 도달. 다음 키로 자동 전환.`);
                        rotateTideBedKey();
                    } else {
                        saveTideBedConfig(); // 사용량 업데이트 저장
                    }

                    resolve(parsed);
                } catch (e) {
                    // JSON 파싱 실패 시에도 에러 메시지에 따라 키 전환 여부 결정
                    if (data.includes('<returnReasonCode>')) { // XML 형태의 에러라면
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

function rotateTideBedKey() {
    tideBedConfig.currentIndex = (tideBedConfig.currentIndex + 1) % tideBedConfig.keys.length;
    console.log(`🔄 TideBED API Key가 ${tideBedConfig.currentIndex + 1}번으로 전환되었습니다.`);
    saveTideBedConfig();
}

// TideBED 관리 API 엔드포인트
app.get('/api/tidebed/config', (req, res) => {
    res.json({
        currentIndex: tideBedConfig.currentIndex,
        keys: tideBedConfig.keys.map((k, i) => ({
            id: i + 1,
            fullKey: k.key,
            used: k.used || 0,
            expiry: k.expiry || '-',
            owner: k.owner || '-'
        })),
        totalLimit: tideBedConfig.keys.length * 10000,
        totalUsed: tideBedConfig.keys.reduce((acc, k) => acc + (k.used || 0), 0)
    });
});

app.post('/api/tidebed/key', (req, res) => {
    const { key, expiry, owner } = req.body;
    if (!key) return res.status(400).json({ error: '인증키가 없습니다.' });

    // 중복 체크
    if (tideBedConfig.keys.some(k => k.key === key)) {
        return res.status(400).json({ error: '이미 등록된 인증키입니다.' });
    }

    tideBedConfig.keys.push({
        key: key,
        used: 0,
        expiry: expiry || '-',
        owner: owner || '-'
    });
    saveTideBedConfig();
    res.json({ success: true, count: tideBedConfig.keys.length });
});

app.delete('/api/tidebed/key/:index', (req, res) => {
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0 || index >= tideBedConfig.keys.length) {
        return res.status(400).json({ error: '잘못된 인덱스입니다.' });
    }

    if (tideBedConfig.keys.length <= 1) {
        return res.status(400).json({ error: '최소 하나 이상의 키가 필요합니다.' });
    }

    tideBedConfig.keys.splice(index, 1);
    // 현재 인덱스가 삭제된 위치보다 뒤라면 하나 당김
    if (tideBedConfig.currentIndex >= index && tideBedConfig.currentIndex > 0) {
        tideBedConfig.currentIndex--;
    }
    saveTideBedConfig();
    res.json({ success: true });
});

// TideBED 전체 데이터 수집 (5페이지 -> 1440개)
async function collectTideBedData(lat, lon, reqDate) {
    console.log(`📡 TideBED API 수집 시작: lat=${lat}, lon=${lon}, date=${reqDate}`);
    const allItems = [];

    // 5페이지 동시 요청
    const pagePromises = [1, 2, 3, 4, 5].map(page => {
        console.log(`  📄 Page ${page}/5 요청 시작...`);
        return fetchTideBedPage(lat, lon, reqDate, page).then(result => ({ page, result }));
    });

    const results = await Promise.all(pagePromises);

    // 순서대로 처리
    for (const { page, result } of results) {
        // API 응답 구조 호환: {response: {body: ...}} 또는 {body: ...} 둘 다 처리
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

// 격자 해시 조회 (1건만 빠르게 조회하여 격자 식별)
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

// 캐시 파일 자동 삭제 타이머 관리
const _fileCleanupTimers = {};
function scheduleFileCleanup(filePath, delayMs = 60000) {
    if (_fileCleanupTimers[filePath]) clearTimeout(_fileCleanupTimers[filePath]);
    _fileCleanupTimers[filePath] = setTimeout(() => {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ 캐시 삭제: ${path.basename(filePath)}`);
            }
        } catch (e) { /* ignore */ }
        delete _fileCleanupTimers[filePath];
    }, delayMs);
}

// YYYYMMDD 정수에서 전일/익일 날짜 계산
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

// 604라인 부근의 기존 collectAndSaveTideData는 유지하되, 내부 로직에서 padding 지원 가능하도록 수정 고려 가능
// 지금은 /api/save_tide_input 의 루프를 직접 강화하는 것이 더 안전함.

// 단일 날짜 수집 + 피크 분석 + 파일 저장 통합 함수 (패딩 지원 추가)
async function collectAndSaveTideData(lat, lon, dateInt, time, fileName, paddedItems = null) {
    const filePath = path.join(DATA_DIR, fileName);
    const reqDateStr = String(dateInt);
    const adj = getAdjacentDates(dateInt);

    // console.log(`📡 [${fileName}] 수집/분석 시작 (Padding: ${!!paddedItems})`);

    try {
        // 1. 데이터 확보 (이미 외부에서 3일치 합쳐서 줬다면 그것 사용, 아니면 단일 호출)
        let items = [];
        if (paddedItems) {
            // 외부에서 준 패딩된 전체 데이터
            items = paddedItems;
        } else {
            items = await collectTideBedData(lat, lon, reqDateStr);
        }

        // 2. 피크 탐색 (Target Date 지정하여 경계선 누락 방지!)
        const peakResult = findTidePeaks(items, adj.currentISO);

        // 3. 저장용 데이터 (파일에는 해당 날짜 데이터만 포함하거나 전체 포함 선택 - 여기서는 해당 날짜 데이터만 필터링해서 기록)
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

        tideCache.set(fileName, completeData);
        if (!IS_FLY_IO) {
            fs.writeFileSync(filePath, JSON.stringify(completeData, null, 2), 'utf8');
        }

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
        tideCache.set(fileName, errorData);
        if (!IS_FLY_IO) {
            fs.writeFileSync(filePath, JSON.stringify(errorData, null, 2), 'utf8');
        }
        return errorData;
    }
}

// [New] Tide Input Saver + TideBED API Collector (격자 캐싱 지원)
app.post('/api/save_tide_input', async (req, res) => {
    const { date, time, lat, lon } = req.body;

    console.log(`📡 Tide Input Received: Date=${date}, Time=${time}, Lat=${lat}, Lon=${lon}`);

    try {
        // 1단계: 격자 해시 조회 (1건 사전 조회)
        const gridHash = await getGridHash(lat, lon, date);
        if (!gridHash) {
            console.error('❌ 격자 해시를 확인할 수 없습니다.');
            res.json({ success: false, error: 'Grid hash unavailable' });
            return;
        }

        const adj = getAdjacentDates(date);
        console.log(`📅 격자: ${gridHash}, 날짜: 전일=${adj.prev}, 당일=${adj.current}, 익일=${adj.next}`);

        // 2단계: 3일치 파일명 결정 및 캐시 확인
        const datePairs = [
            { key: 'yesterday', date: adj.prev },
            { key: 'today', date: adj.current },
            { key: 'tomorrow', date: adj.next }
        ];

        const fileMap = {};
        const toCollect = [];

        for (const pair of datePairs) {
            const fileName = `tide_${pair.date}_${gridHash}.json`;
            const filePath = path.join(DATA_DIR, fileName);
            fileMap[pair.key] = fileName;

            fileMap[pair.key] = fileName;

            let cached = false;

            // [1순위] 메모리 캐시 확인
            if (tideCache.has(fileName)) {
                cached = true;
            }
            // [2순위] 파일 캐시 확인 (로컬 전용)
            else if (!IS_FLY_IO && fs.existsSync(filePath)) {
                try {
                    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (existing.tideBedStatus === 'complete') {
                        cached = true;
                        tideCache.set(fileName, existing); // 메모리 로드 (Warm-up)
                    }
                } catch (e) { /* corrupt file */ }
            }

            if (!cached) {
                toCollect.push({ key: pair.key, date: pair.date, fileName });
            }
        }

        console.log(`📦 캐시 히트: ${3 - toCollect.length}건, 수집 필요: ${toCollect.length}건`);

        // 3단계: collecting 상태 초기화 (메모리 우선, 로컬은 파일도 생성)
        for (const item of toCollect) {
            const filePath = path.join(DATA_DIR, item.fileName);
            const initData = {
                requestDate: item.date,
                requestTime: time,
                latitude: lat,
                longitude: lon,
                timestamp: new Date().toISOString(),
                tideBedStatus: 'collecting...',
                tideBedData: []
            };

            tideCache.set(item.fileName, initData); // 메모리에 '수집중' 상태 마킹
            if (!IS_FLY_IO) {
                fs.writeFileSync(filePath, JSON.stringify(initData, null, 2), 'utf8');
            }
        }

        // 클라이언트에 즉시 응답 (격자 해시 + 파일명 포함)
        res.json({
            success: true,
            gridHash,
            files: fileMap,
            cached: 3 - toCollect.length,
            collecting: toCollect.length
        });

        // 4단계: 백그라운드에서 필요한 날짜만 수집
        // 4단계: 백그라운드 수집 강화 (Padding Analysis 적용)
        (async () => {
            try {
                // 1. 필요한 모든 날짜(어제, 오늘, 내일) 리스트업
                const allNeededDays = [adj.prev, adj.current, adj.next];
                const rawItemsMap = {};

                // 2. 3일치 데이터를 병렬로 모두 확보 (캐시 우선, 없으면 API)
                await Promise.all(allNeededDays.map(async (dayValue) => {
                    const fname = `tide_${dayValue}_${gridHash}.json`;

                    // 캐시 혹은 파일에 데이터가 이미 있는지 확인
                    if (tideCache.has(fname) && tideCache.get(fname).tideBedStatus === 'complete') {
                        rawItemsMap[dayValue] = tideCache.get(fname).tideBedData;
                    } else if (!IS_FLY_IO && fs.existsSync(path.join(DATA_DIR, fname))) {
                        const existing = JSON.parse(fs.readFileSync(path.join(DATA_DIR, fname), 'utf8'));
                        if (existing.tideBedStatus === 'complete') {
                            rawItemsMap[dayValue] = existing.tideBedData;
                        }
                    }

                    // 없으면 API에서 가져옴
                    if (!rawItemsMap[dayValue]) {
                        rawItemsMap[dayValue] = await collectTideBedData(lat, lon, String(dayValue));
                    }
                }));

                // 3. 수집이 필요한 각 대상 일자별로 패딩 분석 수행
                for (const item of toCollect) {
                    const dateInt = item.date;
                    const adj = getAdjacentDates(dateInt);

                    // 패딩 데이터 구성: (어제 끝 3시간) + (오늘 전체) + (내일 앞 3시간)
                    const paddedItems = [
                        ...(rawItemsMap[adj.prev] || []).slice(-180),
                        ...(rawItemsMap[dateInt] || []),
                        ...(rawItemsMap[adj.next] || []).slice(0, 180)
                    ];

                    // 실제 저장 및 분석 실행
                    await collectAndSaveTideData(lat, lon, dateInt, time, item.fileName, paddedItems);
                }

                console.log(`🎉 [Padding Analysis] ${toCollect.length}일치 병렬 분석 및 수집 완료!`);
            } catch (err) {
                console.error('❌ 백그라운드 수집 오류:', err.message);
            }
        })();

    } catch (e) {
        console.error('Failed to save tide input:', e);
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// ============================================================================
// [신규] 7. 홍보정보 게시판 API
// ============================================================================

// 7-1. 게시글 목록 조회 (GET)
app.get('/api/promo', (req, res) => {
    if (dataCache.promo) res.json(dataCache.promo);
    else res.json([]); // 데이터 없으면 빈 배열
});

// 7-1-1. 게시글 상세 조회 (조회수 증가)
app.get('/api/promo/:id', (req, res) => {
    const id = req.params.id;
    try {
        const filePath = path.join(DATA_DIR, 'promo.json');
        let posts = [];
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            if (fileContent) posts = JSON.parse(fileContent);
        }

        const index = posts.findIndex(p => String(p.id) === String(id));
        if (index === -1) {
            return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
        }

        // 조회수 증가
        posts[index].views = (posts[index].views || 0) + 1;

        // 저장
        fs.writeFileSync(filePath, JSON.stringify(posts, null, 2), 'utf8');

        // 캐시 업데이트
        dataCache.promo = posts;
        dataCache.lastUpdate.promo = Date.now();

        res.json(posts[index]);
    } catch (e) {
        console.error('상세 조회 실패:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// 7-2. 파일 업로드 (POST) - 단일/다중 파일 지원
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '파일이 없습니다.' });
    }

    // Cloudinary인 경우 req.file.path가 전체 URL임.
    // 로컬인 경우 req.file.path는 파일 시스템 경로이므로 /uploads/ + filename 조합 필요.
    let fileUrl;
    if (req.file.path && /^https?:\/\//.test(req.file.path)) {
        fileUrl = req.file.path;
    } else {
        fileUrl = `/uploads/${req.file.filename}`;
    }

    res.json({ url: fileUrl, filename: req.file.filename, originalName: req.file.originalname });
});

// 7-2-1. [New] 문서 파일 업로드 (POST) - 엑셀, 한글, PDF 등
app.post('/api/upload-file', (req, res, next) => {
    // global.uploadFile 사용 (Cloudinary raw 또는 로컬)
    const uploadHandler = global.uploadFile || upload;
    uploadHandler.single('file')(req, res, (err) => {
        if (err) {
            console.error('파일 업로드 오류:', err);
            return res.status(500).json({ error: '파일 업로드 실패: ' + err.message });
        }

        if (!req.file) {
            return res.status(400).json({ error: '파일이 없습니다.' });
        }

        // [Fix] 한글 파일명 깨짐 방지: latin1 -> utf8 변환
        let originalName = req.file.originalname;
        try {
            originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
        } catch (e) {
            console.warn('파일명 인코딩 변환 실패:', e.message);
        }

        let fileUrl;
        if (req.file.path && /^https?:\/\//.test(req.file.path)) {
            fileUrl = req.file.path;
        } else {
            fileUrl = `/uploads/${req.file.filename}`;
        }

        // 파일 크기 (bytes)
        const fileSize = req.file.size || 0;

        res.json({
            success: true,
            url: fileUrl,
            filename: req.file.filename,
            originalName: originalName,
            size: fileSize,
            type: req.file.mimetype || 'application/octet-stream'
        });
    });
});
app.post('/api/promo', (req, res) => {
    const postData = req.body;
    // 필수 필드 체크
    if (!postData.title || !postData.content) {
        return res.status(400).json({ error: '제목과 내용은 필수입니다.' });
    }

    try {
        const filePath = path.join(DATA_DIR, 'promo.json');
        let posts = [];

        // 기존 데이터 로드
        if (fs.existsSync(filePath)) {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            if (fileContent) posts = JSON.parse(fileContent);
        }

        // [날짜 포맷 헬퍼] 한국 시간(KST) 기준 YYYY.MM.DD HH:mm 반환
        const getKstString = () => {
            const now = new Date();
            // 1. UTC -> KST 변환 (UTC+9)
            const kstOffset = 9 * 60 * 60 * 1000;
            const kstDate = new Date(now.getTime() + kstOffset);

            // 2. 포맷팅
            const yyyy = kstDate.getUTCFullYear();
            const mm = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(kstDate.getUTCDate()).padStart(2, '0');
            const hh = String(kstDate.getUTCHours()).padStart(2, '0');
            const min = String(kstDate.getUTCMinutes()).padStart(2, '0');

            return `${yyyy}.${mm}.${dd} ${hh}:${min}`;
        };

        // 수정(ID 존재) vs 신규(ID 없음)
        // 수정(ID 존재) vs 신규(ID 없음)
        if (postData.id) {
            // 수정
            const index = posts.findIndex(p => String(p.id) === String(postData.id));
            if (index !== -1) {
                posts[index] = {
                    ...posts[index],
                    ...postData,
                    // 카테고리와 핀 고정 여부 업데이트 (없으면 기존 값 유지 또는 기본값)
                    category: postData.category || posts[index].category || 'PROMO',
                    isPinned: postData.isPinned !== undefined ? postData.isPinned : (posts[index].isPinned || false),
                    // [New] 첨부파일 (배열)
                    attachments: postData.attachments || posts[index].attachments || [],
                    updatedAt: getKstString()
                };
            } else {
                return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
            }
        } else {
            // 신규
            const newPost = {
                id: Date.now(),
                title: postData.title,
                content: postData.content,
                // 신규 필드 추가 (카테고리, 고정 여부)
                category: postData.category || 'PROMO',
                isPinned: postData.isPinned || false,
                // [New] 첨부파일 (배열)
                attachments: postData.attachments || [],
                createdAt: getKstString(),
                updatedAt: getKstString(),
                views: 0
            };
            posts.unshift(newPost); // 최신글을 위로
        }

        // 파일 저장
        fs.writeFileSync(filePath, JSON.stringify(posts, null, 2), 'utf8');

        // 캐시 업데이트
        dataCache.promo = posts;
        dataCache.lastUpdate.promo = Date.now();

        res.json({ success: true, message: '게시글이 저장되었습니다.' });

    } catch (e) {
        console.error('게시글 저장 실패:', e);
        res.status(500).json({ error: '저장 실패' });
    }
});

// 7-4. 게시글 삭제 (DELETE)
app.delete('/api/promo/:id', (req, res) => {
    const id = req.params.id;
    try {
        const filePath = path.join(DATA_DIR, 'promo.json');
        let posts = [];
        if (fs.existsSync(filePath)) {
            posts = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }

        const initialLength = posts.length;
        posts = posts.filter(p => String(p.id) !== String(id));

        if (posts.length === initialLength) {
            return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
        }

        fs.writeFileSync(filePath, JSON.stringify(posts, null, 2), 'utf8');
        dataCache.promo = posts;

        res.json({ success: true, message: '삭제되었습니다.' });

    } catch (e) {
        console.error('삭제 실패:', e);
        res.status(500).json({ error: '삭제 실패' });
    }
});

// 8. 푸시 알림 (Web Push) API
// ====================================================
const webpush = require('web-push');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');

// VAPID 설정 로드
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:seagnal_admin@example.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
    console.log('🔔 Web Push VAPID 설정 완료');
}

// 구독 키 조회 (클라이언트가 사용할 Public Key 제공)
app.get('/api/vapid-public-key', (req, res) => {
    if (process.env.VAPID_PUBLIC_KEY) {
        res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
    } else {
        res.status(500).json({ error: 'VAPID Key 미설정' });
    }
});

// 구독 추가/갱신
// 구독 추가/갱신 (Web Push & FCM)
app.post('/api/subscribe', (req, res) => {
    const { subscription, token, zones, options } = req.body;

    // Web Push(subscription) 또는 FCM(token) 중 하나는 필수
    const isWebPush = subscription && subscription.endpoint;
    const isFcm = !!token;

    if (!isWebPush && !isFcm) {
        return res.status(400).json({ error: '유효하지 않은 구독 정보 (WebPush or FCM required)' });
    }

    let subs = [];
    try {
        if (fs.existsSync(SUBS_FILE)) {
            subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
        }

        // 식별자: Web Push는 endpoint, FCM은 token
        const id = isWebPush ? subscription.endpoint : token;

        // 중복 확인 및 업데이트
        const existingIndex = subs.findIndex(s => {
            const sId = s.type === 'fcm' ? s.token : (s.subscription ? s.subscription.endpoint : null);
            return sId === id;
        });

        const newEntry = {
            type: isFcm ? 'fcm' : 'web',
            // FCM이면 token 저장, Web Push면 subscription 객체 저장
            token: isFcm ? token : undefined,
            subscription: isWebPush ? subscription : undefined,
            zones: Array.isArray(zones) ? zones : [],
            options: options || { alert: true, release: true },
            updatedAt: Date.now()
        };

        if (existingIndex !== -1) {
            subs[existingIndex] = newEntry; // 갱신
        } else {
            subs.push(newEntry); // 추가
        }

        fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
        res.json({ success: true, message: '알림 구독 완료' });
    } catch (e) {
        console.error('구독 저장 실패:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// 구독 취소 (삭제)
app.post('/api/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint 누락' });

    try {
        if (fs.existsSync(SUBS_FILE)) {
            let subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
            const initialLen = subs.length;
            subs = subs.filter(s => s.subscription.endpoint !== endpoint);

            if (subs.length !== initialLen) {
                fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '취소 실패' });
    }
});

// ============================================================================
// [테스트] 푸시 알림 테스트 API
// ============================================================================
const admin = require('firebase-admin');

// Mock 시나리오 정의
const TEST_SCENARIOS = {
    // Case 1: 기본 발표 (동일 시각)
    // Case 1: 기본 발표 (동일 시각)
    'basic_publish': {
        title: '🔔 풍랑주의보 발표 알림',
        body: `📍 제주도서부앞바다, 제주도동부앞바다
  발표 03일 14:00 │ 발효 03일 14:00
  해제예정 05일 09:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'publish',
            tmFc: '202601031400',
            tmEf: '202601031400',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },
    // Alias for convenience
    'publish': {
        title: '🔔 풍랑주의보 발표 알림',
        body: `📍 제주도서부앞바다, 제주도동부앞바다
  발표 03일 14:00 │ 발효 03일 14:00
  해제예정 05일 09:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'publish',
            tmFc: '202601031400',
            tmEf: '202601031400',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },

    'active': {
        title: '🔔 풍랑주의보 발효 알림',
        body: `📍 제주도서부앞바다
  발표 03일 14:00 │ 발효 03일 18:00
  해제예정 05일 09:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'active',
            tmFc: '202601031400',
            tmEf: '202601031800',
            zones: '제주도서부앞바다'
        }
    },

    // Case 5: 해제 알림
    'release': {
        title: '✅ 풍랑주의보 해제 알림',
        body: `📍 제주도서부앞바다, 제주도동부앞바다
  해제 05일 09:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'release',
            tmFc: '202601050900',
            tmEf: '202601050900',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },
    'release_east': {
        title: '✅ 풍랑주의보 해제 알림 (동해)',
        body: `📍 경북북부앞바다
  해제 05일 10:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'release',
            tmFc: '202601051000',
            tmEf: '202601051000',
            zones: '경북북부앞바다'
        }
    },
    'release_jeju': {
        title: '✅ 풍랑주의보 해제 알림 (제주)',
        body: `📍 제주도서부앞바다
  해제 05일 11:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'release',
            tmFc: '202601051100',
            tmEf: '202601051100',
            zones: '제주도서부앞바다'
        }
    },

    'publish_high_wave_warning': {
        title: '⚠️ 풍랑경보 발표 알림',
        body: `📍 제주도서부앞바다
  발표 03일 16:00 │ 발효 03일 18:00
  해제예정 05일 12:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑경보',
            status: 'publish',
            tmFc: '202601031600',
            tmEf: '202601031800',
            zones: '제주도서부앞바다'
        }
    },
    'publish_typhoon_watch': {
        title: '🌀 태풍주의보 발표 알림',
        body: `📍 제주도서부앞바다
  발표 04일 10:00 │ 발효 04일 12:00
  태풍 예비특보`,
        data: {
            type: 'weather_alert',
            alertType: '태풍주의보',
            status: 'publish',
            tmFc: '202601041000',
            tmEf: '202601041200',
            zones: '제주도서부앞바다',
            warnVar: '3'
        }
    },
    'publish_typhoon_warning': {
        title: '🌀🚨 태풍경보 발표 알림',
        body: `📍 제주도서부앞바다
  발표 04일 14:00 │ 발효 04일 16:00
  위험! 선박 대피 요망`,
        data: {
            type: 'weather_alert',
            alertType: '태풍경보',
            status: 'publish',
            tmFc: '202601041400',
            tmEf: '202601041600',
            zones: '제주도서부앞바다',
            warnVar: '3'
        }
    },
    'upgrade_jeju': {
        title: '⚠️ 풍랑경보 격상 알림',
        body: `📍 제주도서부앞바다
  변경 03일 18:00 (주의보→경보)
  해제예정 미정`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑경보',
            status: 'upgrade',
            tmFc: '202601031800',
            tmEf: '202601031800',
            zones: '제주도서부앞바다',
            prevAlertType: '풍랑주의보'
        }
    },

    // Case 2: 시각이 다른 경우
    'different_times': {
        title: '🔔 풍랑주의보 발표 알림',
        body: `📍 제주도서부앞바다
  발표 03일 14:00 │ 발효 03일 18:00
  해제예정 05일 09:00

📍 제주도동부앞바다
  발표 03일 14:00 │ 발효 03일 21:00
  해제예정 05일 12:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'publish',
            tmFc: '202601031400',
            tmEf: '202601031800',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },

    // Case 3: 격상 알림
    'upgrade': {
        title: '⚠️ 풍랑경보 격상 알림',
        body: `📍 서해중부먼바다
  변경 03일 18:00 (주의보→경보)
  해제예정 정보 없음`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑경보',
            status: 'upgrade',
            tmFc: '202601031800',
            tmEf: '202601031800',
            zones: '서해중부먼바다',
            prevAlertType: '풍랑주의보'
        }
    },

    // Case 4: 격하 알림
    'downgrade': {
        title: '🔔 풍랑주의보 격하 알림',
        body: `📍 남해동부먼바다
  변경 04일 06:00 (경보→주의보)
  해제예정 04일 15:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'downgrade',
            tmFc: '202601040600',
            tmEf: '202601040600',
            zones: '남해동부먼바다',
            prevAlertType: '풍랑경보'
        }
    },

    // Case 5: 해제 알림
    basic_release: {
        title: '✅ 풍랑주의보 해제 알림',
        body: `📍 제주도서부앞바다, 제주도동부앞바다
  해제 05일 09:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'release',
            tmFc: '202601050900',
            tmEf: '202601050900',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },

    // Case 6: 해제 알림 (동해 - 중분류 테스트)
    release_east: {
        title: '✅ 풍랑주의보 해제 알림 (동해)',
        body: `📍 경북북부앞바다
  해제 05일 10:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'release',
            tmFc: '202601051000',
            tmEf: '202601051000',
            zones: '경북북부앞바다'
        }
    },

    // Case 7: 연안 예외 처리
    'coastal_exclusion': {
        title: '🔔 풍랑주의보 발표 알림',
        body: `📍 제주도서부앞바다(남서연안 제외)
  발표 03일 14:00 │ 발효 03일 14:00
  해제예정 05일 09:00`
    },

    // Case 7: 복합 상황 (여러 특보, 여러 구역)
    'complex': {
        title: '🔔 강풍주의보 발표 알림',
        body: `📍 동해중부먼바다, 동해남부먼바다
  발표 03일 10:00 │ 발효 03일 12:00
  해제예정 04일 06:00

📍 울릉도근해
  발표 03일 10:00 │ 발효 03일 15:00
  해제예정 04일 09:00`
    }
};

// 테스트 푸시 발송 API
app.post('/api/test-push', async (req, res) => {
    const { scenario, token } = req.body;

    if (!scenario) {
        return res.json({
            message: '사용 가능한 시나리오 목록',
            scenarios: Object.keys(TEST_SCENARIOS),
            usage: 'POST /api/test-push { "scenario": "basic_publish", "token": "FCM_TOKEN" }'
        });
    }

    const testData = TEST_SCENARIOS[scenario];
    if (!testData) {
        return res.status(400).json({
            error: '존재하지 않는 시나리오',
            available: Object.keys(TEST_SCENARIOS)
        });
    }

    // [테스트용] Mock Data 설정
    if (testData.data && (scenario.includes('publish') || scenario.includes('active') || scenario.includes('upgrade') || scenario.includes('downgrade'))) {
        const zonesList = testData.data.zones ? testData.data.zones.split(',') : [];
        const warnStress = testData.data.alertType.includes('경보') ? '1' : '0';
        const command = '1';

        // warnVar: 시나리오에 지정된 값 사용, 없으면 기본값 '1'(풍랑)
        let warnVar = testData.data.warnVar || '1';

        global.mockWarningData = {
            response: {
                header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' },
                body: {
                    dataType: 'JSON',
                    items: {
                        item: zonesList.map(zone => ({
                            areaName: zone,
                            warnVar: warnVar,
                            warnStress: warnStress,
                            command: command,
                            tmFc: testData.data.tmFc || '202601010000',
                            tmEf: testData.data.tmEf || '202601010000',
                            regId: 'TEST_ID',
                            tmSeq: '1'
                        }))
                    },
                    numOfRows: zonesList.length,
                    pageNo: 1,
                    totalCount: zonesList.length
                }
            }
        };
        console.log(`[TEST] Mock Data SET for ${scenario}`);
        setTimeout(() => { global.mockWarningData = null; }, 300000);
    } else if (testData.data && scenario.includes('release')) {
        global.mockWarningData = {
            response: { header: { resultCode: '00', resultMsg: 'NO_DATA' }, body: { items: { item: [] }, totalCount: 0 } }
        };
        console.log(`[TEST] Mock Data (Release) SET for ${scenario}`);
        setTimeout(() => { global.mockWarningData = null; }, 300000);
    }

    // 토큰이 없으면 미리보기만
    if (!token) {
        return res.json({
            preview: true,
            scenario: scenario,
            notification: testData,
            message: '실제 발송하려면 token을 포함하세요.'
        });
    }

    // 실제 FCM 발송
    if (admin.apps.length === 0) {
        return res.status(500).json({ error: 'Firebase Admin이 초기화되지 않았습니다.' });
    }

    try {
        const message = {
            token: token,
            notification: {
                title: testData.title,
                body: testData.body
            },
            data: {
                url: '/?tab=weather-alert-section',
                scenario: scenario,
                ...(testData.data || {})
            }
        };

        const response = await admin.messaging().send(message);
        res.json({
            success: true,
            scenario: scenario,
            fcmResponse: response,
            notification: testData
        });
    } catch (e) {
        res.status(500).json({ error: e.message, code: e.code });
    }
});

// 시나리오 목록 조회
app.get('/api/test-push/scenarios', (req, res) => {
    res.json({
        scenarios: Object.entries(TEST_SCENARIOS).map(([key, val]) => ({
            id: key,
            title: val.title,
            bodyPreview: val.body.substring(0, 50) + '...'
        }))
    });
});

// 8-1. 커스텀 푸시 발송 API (Broadcast + Personalized)
app.post('/api/push-custom', async (req, res) => {
    const { title, content, targetZones, isManualGroupSend, payload } = req.body;

    // 수동 그룹 발송 모드 (개인화 필터링 적용)
    if (isManualGroupSend && payload) {
        if (!payload.items || payload.items.length === 0) {
            return res.status(400).json({ error: '발송 데이터가 없습니다.' });
        }
    } else {
        // 기존 커스텀 발송 모드 검증
        if (!title || !content || !targetZones) {
            return res.status(400).json({ error: '제목, 내용, 발송 대상은 필수입니다.' });
        }
    }

    try {
        const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
        if (!fs.existsSync(SUBS_FILE)) {
            return res.status(404).json({ error: '구독자가 없습니다.' });
        }

        const subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));

        // ============================================================
        // [ZONE_HIERARCHY] 대분류 → 중분류 → 소분류(특보구역) 계층 구조
        // 앱의 SEA_REGIONS + SUB_REGION_ZONES 구조와 완전 일치시킴
        // ============================================================
        const ZONE_HIERARCHY = {
            // 대분류: 동해
            '동해': {
                '동해중부해상': [
                    '강원북부앞바다', '강원중부앞바다', '강원남부앞바다',
                    '동해중부안쪽먼바다', '동해중부바깥먼바다'
                ],
                '동해남부해상': [
                    '울산앞바다', '경북남부앞바다', '경북북부앞바다',
                    '동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다',
                    '동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다'
                ]
            },
            // 대분류: 서해
            '서해': {
                '서해중부해상': [
                    '인천·경기북부앞바다', '인천·경기남부앞바다',
                    '충남북부앞바다', '충남남부앞바다',
                    '서해중부안쪽먼바다', '서해중부바깥먼바다'
                ],
                '서해남부해상': [
                    '전북북부앞바다', '전북남부앞바다',
                    '전남북부서해앞바다', '전남중부서해앞바다', '전남남부서해앞바다',
                    '서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다',
                    '서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다'
                ]
            },
            // 대분류: 남해
            '남해': {
                '남해서부해상': [
                    '전남서부남해앞바다', '전남동부남해앞바다',
                    '남해서부서쪽먼바다', '남해서부동쪽먼바다'
                ],
                '남해동부해상': [
                    '부산앞바다', '경남서부남해앞바다', '경남중부남해앞바다', '거제시동부앞바다',
                    '남해동부안쪽먼바다', '남해동부바깥먼바다'
                ]
            },
            // 대분류: 제주
            '제주': {
                '제주해역': [
                    '제주도북부앞바다', '제주도남부앞바다', '제주도동부앞바다', '제주도서부앞바다',
                    '제주도남서쪽안쪽먼바다', '제주도남동쪽안쪽먼바다', '제주도남쪽바깥먼바다'
                ]
            }
        };

        // [Helper] 사용자 구독 목록(대/중/소 혼재)을 모두 소분류(특보구역)로 확장
        const expandToMinorZones = (userZones) => {
            if (!userZones || userZones.length === 0) return []; // 빈 배열이면 빈 배열 반환

            const minorZones = new Set();

            userZones.forEach(uz => {
                // 1. 대분류인지 확인
                if (ZONE_HIERARCHY[uz]) {
                    // 대분류 -> 그 아래 모든 중분류의 소분류 전부 추가
                    Object.values(ZONE_HIERARCHY[uz]).forEach(minors => {
                        minors.forEach(m => minorZones.add(m));
                    });
                    return;
                }

                // 2. 중분류인지 확인
                for (const major of Object.keys(ZONE_HIERARCHY)) {
                    if (ZONE_HIERARCHY[major][uz]) {
                        ZONE_HIERARCHY[major][uz].forEach(m => minorZones.add(m));
                        return;
                    }
                }

                // 3. 소분류(이미 최소 단위)인 경우 그대로 추가
                minorZones.add(uz);
            });

            return Array.from(minorZones);
        };


        // [Helper] 사용자 구독 구역과 타겟 구역의 교집합(실제 보낼 구역들) 추출
        const getMatchedZones = (userZones, targetItems, opts = {}) => {
            // 모든해역 설정인 경우 필터링 없이 전체 반환
            if (opts.target === 'all') return targetItems;

            // 사용자가 아무것도 구독 안했으면 전체 수신 (기존 정책 유지)
            if (!userZones || userZones.length === 0) return targetItems;

            // 사용자 구독 목록을 소분류(특보구역)로 확장
            const expandedUserZones = expandToMinorZones(userZones);
            if (expandedUserZones.length === 0) return []; // 확장 결과가 없으면 발송 안함

            // 교집합 찾기 (Items 구조 유지)
            const filteredItems = [];

            targetItems.forEach(item => {
                // item.zones는 이미 소분류 리스트
                const intersection = item.zones.filter(tz =>
                    expandedUserZones.includes(tz)
                );

                if (intersection.length > 0) {
                    filteredItems.push({
                        ...item,
                        zones: intersection // 겹치는 구역만 남김
                    });
                }
            });

            return filteredItems;
        };

        // [Helper] 동적 메시지 생성기 (전면 개편: 5가지 시나리오 적용)
        const generateMessage = (filteredPayload) => {
            const { templateId, typeName, level, items } = filteredPayload;
            // items: [{ zones: [...], tmFc, tmEf, tmYn }] (Grouped by Push Sender)

            let genTitle = '';
            let genBody = '';

            // 요일 배열 (일~토)
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

            // 시각 포맷 헬퍼: D일 HH:mm 또는 D일 범위시간 형식으로 변환
            const fmt = (str) => {
                if (!str) return '미정';

                // 1. "2026-02-06 12:00" 형식 처리 (숫자 시:분)
                const dateMatch = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
                if (dateMatch) {
                    const [, , , day, hour, minute] = dateMatch;
                    return `${parseInt(day)}일 ${hour}:${minute}`;
                }

                // 2. "2026-02-07 밤(18~24시)" 형식 처리 (한글 시간대)
                const koreanTimeMatch = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(.+)/);
                if (koreanTimeMatch) {
                    const [, , , day, timeDesc] = koreanTimeMatch;
                    return `${parseInt(day)}일 ${timeDesc}`;
                }

                // 3. 12자리 숫자 형식 (202602061200)
                if (/^\d{12}$/.test(str)) {
                    const day = str.substring(6, 8);
                    const hour = str.substring(8, 10);
                    const minute = str.substring(10, 12);
                    return `${parseInt(day)}일 ${hour}:${minute}`;
                }

                // 4. 그 외 (이미 포맷팅된 문자열: "9일 새벽(03시~06시)" 등)
                return str;
            };

            // 시각별 그룹핑 헬퍼 (tmEf 또는 tmYn 기준)
            const groupByTime = (items, timeKey) => {
                const groups = {};
                items.forEach(item => {
                    const timeVal = item[timeKey] || '미정';
                    if (!groups[timeVal]) {
                        groups[timeVal] = [];
                    }
                    item.zones.forEach(z => {
                        if (!groups[timeVal].includes(z)) {
                            groups[timeVal].push(z);
                        }
                    });
                });
                return groups; // { '2026-02-06 12:00': ['서해중부안쪽먼바다', '서해중부바깥먼바다'], ... }
            };

            // 그룹핑된 데이터를 메시지로 변환
            const formatGroupedMessage = (groups, timeLabel) => {
                return Object.entries(groups).map(([time, zones]) => {
                    const zStr = zones.join(', ');
                    const formattedTime = fmt(time);
                    return `ㅇ${zStr}\n   - ${timeLabel} : ${formattedTime}`;
                }).join('\n');
            };

            // [분석 반영] '예비' 등급은 실질적으로 '주의보'를 의미하므로 명칭 보정
            let effectiveLevel = level;
            if (level === '예비') {
                effectiveLevel = '주의보';
            }

            // 특보 명칭 (예: 풍랑주의보) - 보정된 등급 사용
            const fullTitle = `${typeName}${effectiveLevel ? ' ' + effectiveLevel : ''}`.trim();

            // ========================================================================
            // 1. 발표 (예비특보)
            // ========================================================================
            if (templateId === 'publish') {
                // [수정] "풍랑 주의보 예비 발표"와 같은 중복 표현을 제거하고 "풍랑 주의보 발표"로 통일
                genTitle = `📢 ${fullTitle} 발표`;
                const grouped = groupByTime(items, 'tmEf');
                genBody = formatGroupedMessage(grouped, '발효예정');
            }

            // ========================================================================
            // 2. 발효 (현재 발효)
            // ========================================================================
            else if (templateId === 'active') {
                genTitle = `🚨 ${fullTitle} 발효`;
                const grouped = groupByTime(items, 'tmYn');
                genBody = formatGroupedMessage(grouped, '해제예정');
            }

            // ========================================================================
            // 3. 해제 (특보 종료)
            // ========================================================================
            else if (templateId === 'release') {
                genTitle = `✅ ${fullTitle} 해제`;
                // 내용: 해역만 나열 (시각 그룹핑 불필요)
                const allZones = [];
                items.forEach(i => i.zones.forEach(z => { if (!allZones.includes(z)) allZones.push(z); }));
                genBody = `ㅇ${allZones.join(', ')}`;
            }

            // ========================================================================
            // 4. 발효시각 변경
            // ========================================================================
            else if (templateId === 'time_ef_change') {
                genTitle = `🕐 발효시각 변경`;
                const grouped = groupByTime(items, 'tmEf');
                genBody = formatGroupedMessage(grouped, '발효예정');
            }

            // ========================================================================
            // 5. 해제시각 변경
            // ========================================================================
            else if (templateId === 'time_yn_change') {
                genTitle = `🕐 해제시각 변경`;
                const grouped = groupByTime(items, 'tmYn');
                genBody = formatGroupedMessage(grouped, '해제예정');
            }

            // Fallback
            else {
                genTitle = `📢 ${fullTitle} 알림`;
                genBody = items.map(i => i.zones.join(', ')).join('\n');
            }

            return { title: genTitle, body: genBody };
        };

        let successCount = 0;
        let failCount = 0;

        let deadSubscriptionsFound = false;
        const broadcastPromises = subs.map(async (user) => {
            // 1. 전체 알림 수신 거부 확인
            if (user.options && user.options.master === false) return;

            let finalTitle = title; // 기본값
            let finalBody = content; // 기본값
            let shouldSend = false;

            let userFilteredItems = null;

            // 2. 모드별 처리
            if (isManualGroupSend && payload) {
                // [개인화 모드]
                // 사용자 맞춤 아이템 필터링 (모든해역 설정 고려)
                userFilteredItems = getMatchedZones(user.zones, payload.items, user.options || {});

                // 겹치는 구역 없으면 발송 안함
                if (!userFilteredItems || userFilteredItems.length === 0) return;

                const generated = generateMessage({ ...payload, items: userFilteredItems });
                finalTitle = generated.title;
                finalBody = generated.body;
                shouldSend = true;

            } else {
                // [기존 커스텀 모드]
                const sendAll = targetZones.includes('전체 해역') || targetZones.includes('전체해역');
                const zoneList = sendAll ? [] : targetZones.split(',').map(z => z.trim());

                if (sendAll || (user.options && user.options.target === 'all')) {
                    shouldSend = true;
                } else {
                    // 사용자 구독 목록을 소분류로 확장 후 교집합 확인
                    const expandedUserZones = expandToMinorZones(user.zones);
                    if (!expandedUserZones || expandedUserZones.length === 0) {
                        // 구독 없음 = 전체 수신 정책
                        shouldSend = true;
                    } else {
                        // 타겟 구역과 확장된 사용자 구역 간의 교집합 확인
                        const hasMatch = zoneList.some(tz => expandedUserZones.includes(tz));
                        shouldSend = hasMatch;
                    }
                }
            }

            if (!shouldSend) return;

            try {
                // URL 파라미터 구성 (개인화 정보 포함)
                const params = new URLSearchParams();
                params.append('popup', 'true');
                if (isManualGroupSend && payload) {
                    // alertType에 level 포함 (예: "풍랑주의보")
                    const fullAlertType = (payload.typeName || '') + (payload.level ? payload.level : '');
                    params.append('alertType', fullAlertType);
                    params.append('status', payload.templateId);
                    params.append('tmFc', payload.items[0].tmFc || '');
                    params.append('tmEf', payload.items[0].tmEf || '');
                    params.append('tmYn', payload.items[0].tmYn || '');  // 오타 수정: tmEd → tmYn
                    params.append('zones', userFilteredItems.flatMap(i => i.zones).join(','));
                }
                // [Fix] 절대 경로 URL 사용 (앱 실행 호환성 강화)
                const BASE_URL = 'https://seagnal-server.fly.dev';
                const url = `${BASE_URL}/?tab=weather-alert-section&${params.toString()}`;

                if (user.type === 'fcm' && user.token) {
                    if (admin.apps.length > 0) {
                        try {
                            await admin.messaging().send({
                                token: user.token,
                                notification: { title: finalTitle, body: finalBody },
                                data: { url: url, type: isManualGroupSend ? 'manual_group' : 'custom_push' }
                            });
                            successCount++;
                        } catch (err) {
                            failCount++;
                            if (err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token') {
                                user._isDead = true;
                                deadSubscriptionsFound = true;
                            }
                        }
                    }
                } else if (user.subscription) {
                    try {
                        const pushPayload = JSON.stringify({ title: finalTitle, body: finalBody, url: url });
                        await webpush.sendNotification(user.subscription, pushPayload);
                        successCount++;
                    } catch (err) {
                        failCount++;
                        if (err.statusCode === 404 || err.statusCode === 410) {
                            user._isDead = true;
                            deadSubscriptionsFound = true;
                        }
                    }
                }
            } catch (e) {
                failCount++;
            }
        });

        await Promise.all(broadcastPromises);

        // 만료된 구독자 정리
        if (deadSubscriptionsFound) {
            const updatedSubs = subs.filter(u => !u._isDead);
            fs.writeFileSync(SUBS_FILE, JSON.stringify(updatedSubs, null, 2));
            console.log(`🧹 [Push/Manual] 만료된 구독 데이터 ${subs.length - updatedSubs.length}건 정리 완료`);
        }

        // [History Save]
        // 개인화 발송인 경우, 히스토리에는 '전체 대상'으로 생성된 대표 메시지를 저장
        let histTitle = title;
        let histContent = content;
        let histTarget = targetZones;

        if (isManualGroupSend && payload) {
            const gen = generateMessage(payload); // 전체 아이템 기준 생성
            histTitle = gen.title;
            histContent = gen.body;
            histTarget = payload.items.flatMap(i => i.zones).join(', ');
        }

        const HISTORY_FILE = path.join(DATA_DIR, 'custom_push_history.json');
        let history = [];
        if (fs.existsSync(HISTORY_FILE)) {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }

        const kstDate = new Date(Date.now() + (9 * 60 * 60 * 1000));
        const timeStr = kstDate.toISOString().replace('T', ' ').substring(2, 16).replace(/-/g, '.');

        const newLog = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            time: timeStr,
            title: histTitle,
            content: histContent,
            target: histTarget,
            count: successCount,
            status: 'sent',
            type: req.body.type || 'manual', // [수정] 요청 시 전달받은 타입(auto 등)이 있으면 사용
            tab: isManualGroupSend ? (payload.templateId || 'active') : 'custom',
            tmRef: isManualGroupSend ? (payload.items[0].tmFc || payload.items[0].tmEf || '') : ''
        };
        history.unshift(newLog);
        if (history.length > 500) history = history.slice(0, 500);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

        res.json({ success: true, successCount, failCount });
    } catch (e) {
        console.error('커스텀 푸시 발송 실패:', e);
        res.status(500).json({ error: e.message });
    }
});

// 8-2. 이력 조회
app.get('/api/push-history', (req, res) => {
    try {
        const HISTORY_FILE = path.join(DATA_DIR, 'custom_push_history.json');
        if (fs.existsSync(HISTORY_FILE)) {
            res.json(JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')));
        } else {
            res.json([]);
        }
    } catch (e) {
        res.status(500).json({ error: '이력 조회 실패' });
    }
});

// 8-3. 이력 삭제 (개별)
app.delete('/api/push-history/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const HISTORY_FILE = path.join(DATA_DIR, 'custom_push_history.json');
        if (!fs.existsSync(HISTORY_FILE)) return res.json({ success: true });

        let history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        history = history.filter(h => h.id !== id);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '삭제 실패' });
    }
});

// 8-4. 이력 삭제 (전체 또는 선택)
app.delete('/api/push-history', (req, res) => {
    try {
        const { ids } = req.body; // ids가 있으면 선택 삭제, 없으면 전체 삭제
        const HISTORY_FILE = path.join(DATA_DIR, 'custom_push_history.json');

        if (!ids) {
            // 전체 삭제
            fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
        } else {
            // 선택 삭제
            let history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            history = history.filter(h => !ids.includes(h.id));
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '삭제 실패' });
    }
});

// ============================================================================
// [NEW] 9. 아카이브 데이터 조회 및 다운로드 API (추후 분석용)
// ============================================================================

// 가용 아카이브 목록 조회 (해역별 JSON 파일 리스트)
app.get('/api/archive/list', (req, res) => {
    try {
        const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
        if (!fs.existsSync(ARCHIVE_DIR)) {
            return res.json([]);
        }
        const files = fs.readdirSync(ARCHIVE_DIR)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const stats = fs.statSync(path.join(ARCHIVE_DIR, f));
                return {
                    name: f.replace('.json', ''),
                    filename: f,
                    size: stats.size,
                    updatedAt: stats.mtime
                };
            });
        res.json(files);
    } catch (e) {
        res.status(500).json({ error: '아카이브 목록 조회 실패: ' + e.message });
    }
});

// 특정 해역의 아카이브 JSON 파일 다운로드
app.get('/api/archive/download/:filename', (req, res) => {
    try {
        let filename = req.params.filename;
        // 보안 필터링
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).send('Invalid filename');
        }

        if (!filename.endsWith('.json')) filename += '.json';
        const filePath = path.join(DATA_DIR, 'archive', filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).send('해당 아카이브 파일을 찾을 수 없습니다.');
        }

        res.download(filePath, filename);
    } catch (e) {
        res.status(500).send('다운로드 중 오류 발생: ' + e.message);
    }
});

// ============================================================================
// [Admin] 특보 수집 테스트 API
// ============================================================================
const weatherAlertsCrawler = require('./weather_alerts_crawler');
const reportProcessor = require('./report_alert_processor');
const aiParser = require('./ai_report_parser');
const pushSender = require('./push_sender');

// 9-1. 크롤링 상태 조회
app.get('/api/admin/crawl-status', (req, res) => {
    res.json({ paused: scheduler.getCrawlPaused() });
});

// 9-2. 크롤링 정지/시작 토글
app.post('/api/admin/crawl-toggle', (req, res) => {
    const current = scheduler.getCrawlPaused();
    scheduler.setCrawlPaused(!current);
    const newState = scheduler.getCrawlPaused();
    console.log(`[Admin] 크롤링 상태 변경: ${newState ? '정지' : '실행'}`);
    res.json({ paused: newState });
});

// 9-3. 특보 장부 초기화
app.post('/api/admin/alerts-reset', (req, res) => {
    try {
        const freshForm = weatherAlertsCrawler.createFullForm();
        freshForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        fs.writeFileSync(weatherAlertsCrawler.CONFIG.OUTPUT_FILE, JSON.stringify(freshForm, null, 2), 'utf8');
        console.log('[Admin] 특보 장부 초기화 완료');
        res.json({ success: true, message: '특보 장부가 초기화되었습니다.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 9-4. 특정 날짜 통보문 목록 조회 (제목에 [특보]/[예비] 포함 필터링)
app.get('/api/admin/reports', async (req, res) => {
    try {
        const date = req.query.date; // YYYY-MM-DD
        if (!date) return res.status(400).json({ error: 'date 파라미터가 필요합니다 (YYYY-MM-DD)' });

        const https = require('https');
        const fetchPage = (pageIndex) => {
            return new Promise((resolve, reject) => {
                const url = `https://www.weather.go.kr/w/special-report/list.do?stn=108&date=${date}&pageIndex=${pageIndex}`;
                https.get(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                }, (resp) => {
                    const chunks = [];
                    resp.on('data', c => chunks.push(c));
                    resp.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
                }).on('error', reject);
            });
        };

        const allReports = [];
        const seenIds = new Set(); // [Fix] 페이지간 중복 방지 (select-list가 모든 페이지에서 동일하여 3배 중복 발생)
        for (let page = 1; page <= 3; page++) {
            const html = await fetchPage(page);
            const selectMatch = html.match(/<select id="select-list"[^>]*>([\s\S]*?)<\/select>/);
            if (!selectMatch) break;

            const pattern = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
            let match;
            while ((match = pattern.exec(selectMatch[1])) !== null) {
                const id = match[1];
                const title = match[2].trim();
                if (seenIds.has(id)) continue; // 중복 건너뜀
                if (id.includes(':') && (title.includes('[특보]') || title.includes('[예비]'))) {
                    // reportId에서 날짜 추출하여 요청 날짜와 매칭
                    const parts = id.split(':');
                    if (parts.length >= 2) {
                        const idDate = parts[1].substring(0, 8); // YYYYMMDD
                        const reqDate = date.replace(/-/g, '');   // YYYYMMDD
                        if (idDate === reqDate) {
                            seenIds.add(id);
                            allReports.push({ id, title });
                        }
                    }
                }
            }
            if (allReports.length === 0 && page === 1) break; // 첫 페이지에 결과 없으면 종료
        }

        res.json({ date, reports: allReports, count: allReports.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 9-5. 단일 통보문 수집 (AI 분석 포함, 장부 반영)
app.post('/api/admin/report-collect', async (req, res) => {
    try {
        const { reportId, title, referenceTime } = req.body;
        if (!reportId) return res.status(400).json({ error: 'reportId가 필요합니다' });

        // 1. 통보문 본문 가져오기
        const rawText = await reportProcessor.fetchReportDetail(reportId);
        if (!rawText) return res.json({ success: false, rawText: '', aiResult: [], message: '통보문 내용을 가져올 수 없습니다.' });

        // 2. 키워드 필터링
        const RELEVANT_KEYWORDS = ['풍랑', '태풍', '지진해일', '폭풍해일'];
        const foundKeywords = RELEVANT_KEYWORDS.filter(kw => rawText.includes(kw));

        if (foundKeywords.length === 0) {
            return res.json({
                success: true, reportId, title, rawText,
                aiResult: [], foundKeywords: [],
                message: '해상 특보 키워드(풍랑/태풍/지진해일/폭풍해일)가 포함되지 않은 통보문입니다.',
                applied: false
            });
        }

        // 3. AI 분석 (발표시각을 baseDate로 전달하여 날짜 계산 정확도 향상)
        const baseDate = extractTmFcFromReportId(reportId);
        const aiParsed = await aiParser.parseNoticeWithAI(rawText, baseDate);
        const aiResult = aiParsed.data || [];
        const aiError = aiParsed.error || null;

        // 4. 장부에 반영
        let applied = false;
        let pushResult = null;
        try {
            const outputFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
            let fullForm;
            if (fs.existsSync(outputFile)) {
                const existing = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
                fullForm = {
                    updatedAt: null,
                    lastReportId: existing.lastReportId || null,
                    previous: JSON.parse(JSON.stringify(existing.current || {})),
                    current: existing.current || {}
                };
            } else {
                fullForm = weatherAlertsCrawler.createFullForm();
            }

            // 기준시각: 클라이언트에서 전달한 referenceTime 또는 통보문의 발표시각 사용
            const refTime = referenceTime || null;

            for (const event of aiResult) {
                event.reportId = reportId;
                event.tmFc = extractTmFcFromReportId(reportId);
                event.zones.forEach(zoneName => {
                    if (reportProcessor.updateZoneStatus(fullForm.current, zoneName, event, refTime)) {
                        applied = true;
                    }
                });
            }

            // 기준시각 기반 상태 전환 (upcoming → current)
            // resolvePendingStatuses는 이벤트 적용 여부와 무관하게 실행해야 함
            // (이전 수집에서 upcoming으로 저장된 항목이 현재 기준시각에서 발효될 수 있음)
            weatherAlertsCrawler.resolvePendingStatuses(fullForm.current, null, refTime);

            // 변경 감지 및 저장 (이벤트 적용 + 상태 전환 모두 포함)
            const changes = weatherAlertsCrawler.detectChanges(fullForm.previous, fullForm.current);
            if (changes.length > 0) {
                applied = true;
                try {
                    await pushSender.processChanges(changes);
                    pushResult = { sent: true, changeCount: changes.length };
                    console.log(`[Admin] 테스트 수집 → 변경 ${changes.length}건 감지, 푸시 발송 완료`);
                } catch (pushErr) {
                    pushResult = { sent: false, error: pushErr.message };
                    console.error(`[Admin] 푸시 발송 오류:`, pushErr.message);
                }
                fullForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                if (reportId > (fullForm.lastReportId || '')) fullForm.lastReportId = reportId;
                fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');
            }
        } catch (applyErr) {
            console.error('[Admin] 장부 반영 오류:', applyErr.message);
        }

        res.json({ success: true, reportId, title, rawText, aiResult, foundKeywords, applied, aiError, pushResult });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 9-6. 전체 통보문 일괄 수집
app.post('/api/admin/reports-collect-all', async (req, res) => {
    try {
        const { reports, referenceTimeMode } = req.body; // [{ id, title }, ...], mode: 'auto'|'now'|'custom'
        if (!reports || !Array.isArray(reports)) return res.status(400).json({ error: 'reports 배열이 필요합니다' });

        const results = [];
        for (const report of reports) {
            try {
                const rawText = await reportProcessor.fetchReportDetail(report.id);
                const RELEVANT_KEYWORDS = ['풍랑', '태풍', '지진해일', '폭풍해일'];
                const foundKeywords = RELEVANT_KEYWORDS.filter(kw => rawText.includes(kw));

                if (foundKeywords.length === 0) {
                    results.push({ reportId: report.id, title: report.title, aiResult: [], foundKeywords: [], applied: false, message: '키워드 미포함' });
                    continue;
                }

                const baseDate = extractTmFcFromReportId(report.id);
                const aiParsed = await aiParser.parseNoticeWithAI(rawText, baseDate);
                const aiResult = aiParsed.data || [];
                const aiError = aiParsed.error || null;

                // 장부 반영
                let applied = false;
                const outputFile = weatherAlertsCrawler.CONFIG.OUTPUT_FILE;
                let fullForm;
                if (fs.existsSync(outputFile)) {
                    const existing = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
                    fullForm = {
                        updatedAt: null,
                        lastReportId: existing.lastReportId || null,
                        previous: JSON.parse(JSON.stringify(existing.current || {})),
                        current: existing.current || {}
                    };
                } else {
                    fullForm = weatherAlertsCrawler.createFullForm();
                }

                // 기준시각: 'auto' 모드면 reportId에서 추출, 아니면 null (시스템 시각)
                const refTime = (referenceTimeMode === 'auto') ? extractRefTimeFromReportId(report.id) : null;

                for (const event of aiResult) {
                    event.reportId = report.id;
                    event.tmFc = extractTmFcFromReportId(report.id);
                    event.zones.forEach(zoneName => {
                        if (reportProcessor.updateZoneStatus(fullForm.current, zoneName, event, refTime)) {
                            applied = true;
                        }
                    });
                }

                // 기준시각 기반 상태 전환 (upcoming → current)
                weatherAlertsCrawler.resolvePendingStatuses(fullForm.current, null, refTime);

                // 변경 감지 및 저장
                const changes = weatherAlertsCrawler.detectChanges(fullForm.previous, fullForm.current);
                if (changes.length > 0 || applied) {
                    fullForm.updatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
                    if (report.id > (fullForm.lastReportId || '')) fullForm.lastReportId = report.id;
                    fs.writeFileSync(outputFile, JSON.stringify(fullForm, null, 2), 'utf8');
                }

                results.push({ reportId: report.id, title: report.title, rawText, aiResult, foundKeywords, applied, aiError });
            } catch (itemErr) {
                results.push({ reportId: report.id, title: report.title, error: itemErr.message, applied: false });
            }
        }

        res.json({ success: true, totalCount: reports.length, results });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 헬퍼: reportId에서 기준시각(ISO) 추출 (resolvePendingStatuses용)
function extractRefTimeFromReportId(reportId) {
    const parts = (reportId || '').split(':');
    if (parts.length >= 2 && parts[1].length >= 12) {
        const ts = parts[1];
        return new Date(`${ts.substring(0,4)}-${ts.substring(4,6)}-${ts.substring(6,8)}T${ts.substring(8,10)}:${ts.substring(10,12)}:00+09:00`).toISOString();
    }
    return null;
}

// 헬퍼: reportId에서 발표시각 추출
function extractTmFcFromReportId(reportId) {
    const parts = reportId.split(':');
    if (parts.length >= 2) {
        const ts = parts[1];
        if (ts.length >= 12) {
            return `${ts.substring(0, 4)}년 ${ts.substring(4, 6)}월 ${ts.substring(6, 8)}일 ${ts.substring(8, 10)}시 ${ts.substring(10, 12)}분`;
        }
    }
    return '';
}

// 3001(관리자/개발용) 포트 고정 사용 (Fly.io도 3001 포트 사용하도록 fly.toml에 설정됨)
const finalPort = 3001;

app.listen(finalPort, () => {
    console.log(`\n=================================================`);
    console.log(`🚀 서버 실행 중! Port: ${finalPort}`);
    console.log(`📡 접속 주소: http://localhost:${finalPort}/index.html`);
    console.log(`✅ 활성 API: /api/push-custom (POST), /api/push-history (GET)`);
    console.log(`=================================================\n`);
});
