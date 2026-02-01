const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const https = require('https');

// [Push] VAPID 설정
const admin = require('firebase-admin');

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

try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('🔥 Firebase Admin 초기화 완료');
} catch (e) {
    console.warn('⚠️ Firebase serviceAccountKey.json 없음 (FCM 불가):', e.message);
}

// [Note] 레거시 상태 저장 로직(alert_state.json, alert_history_archive.json)은 삭제되었으며, 
// 실제 상태 관리는 LifeCycleManager가, 아카이빙은 ArchiveManager가 담당합니다.

const lastRunStatus = {
    warnings: { lastRun: null, status: '대기 중', message: '' },
    warnings_hub: { lastRun: null, status: '대기 중', message: '' },
    warnings_afso: { lastRun: null, status: '대기 중', message: '' },
    buoys: { lastRun: null, status: '대기 중', message: '' },
    general: { lastRun: null, status: '대기 중', message: '' },
    zone: { lastRun: null, status: '대기 중', message: '' }
};

// [Push] 대권역 -> 세부구역 매핑
const ZONE_MAPPING = {
    '동해중부': ['동해중부', '강원', '경북북부'],
    '동해남부': ['동해남부', '경북남부', '울산', '부산'],
    '서해중부': ['서해중부', '인천', '경기', '충남'],
    '서해남부': ['서해남부', '전북', '전남북부', '전남중부', '전남남부'],
    '남해서부': ['남해서부', '전남', '완도', '진도', '무안', '신안'],
    '남해동부': ['남해동부', '경남', '거제', '통영', '남해앞', '부산'],
    '제주도': ['제주', '추자']
};



function isZoneMatched(userZones, areaName) {
    if (!userZones || userZones.length === 0) return false; // [수정] 구독 해제 시 전체 수신되는 버그 수정

    return userZones.some(userZone => {
        // [수정] 단순 포함 관계(includes)가 아닌 Set 기반의 명확한 매칭 필요
        // 하지만 기존 데이터 호환성을 위해 우선 userZone이 areaName에 포함되는지 확인하되,
        // 대분류가 소분류에 묻히는 케이스 방지
        const cleanArea = areaName.replace(/\s+/g, '');
        const cleanUser = userZone.replace(/\s+/g, '');
        if (cleanArea.includes(cleanUser)) return true;

        const keywords = ZONE_MAPPING[userZone];
        if (keywords && keywords.some(k => cleanArea.includes(k.replace(/\s+/g, '')))) return true;

        return false;
    });
}


function getWarningType(wrnTp) {
    if (!wrnTp) return wrnTp;
    return wrnTp.replace('주의보', '').replace('경보', '').trim();
}

function fixZoneName(name) {
    if (!name) return name;
    if (name.endsWith('평수구')) return name + '역';
    return name;
}

/**
 * [NEW] tmYn 필드에서 해제 예정 시각을 파싱하는 함수
 * 예: "15일 오후(15시~18시)" → "202601151800" (종료 시각 기준)
 * 예: "16일 새벽(03시~06시)" → "202601160600"
 * @param {string} tmYn - 해제 예고 텍스트 (예: "15일 밤(21시 ~ 24시)")
 * @param {string} refDate - 참조 날짜 (YYYYMMDDHHmm 형식, 발표 시각 기준)
 * @returns {string} YYYYMMDDHHmm 형식의 해제 예정 시각, 파싱 실패 시 빈 문자열
 */
function parseTmYnToRawTmEd(tmYn, refDate) {
    if (!tmYn || typeof tmYn !== 'string') return '';

    try {
        // 기준 날짜 추출 (참조 시각에서 년/월 가져오기)
        const refYear = refDate ? refDate.substring(0, 4) : new Date().getFullYear().toString();
        const refMonth = refDate ? refDate.substring(4, 6) : String(new Date().getMonth() + 1).padStart(2, '0');

        // 일자 추출: "15일", "16일" 등
        const dayMatch = tmYn.match(/(\d{1,2})일/);
        if (!dayMatch) return '';
        const day = dayMatch[1].padStart(2, '0');

        // 시간 범위 추출: "(15시~18시)", "(21시 ~ 24시)" 등
        const timeMatch = tmYn.match(/\((\d{1,2})시\s*[~～-]\s*(\d{1,2})시\)/);
        if (!timeMatch) {
            // 단일 시간 형식 처리: "15시" 등
            const singleTimeMatch = tmYn.match(/(\d{1,2})시/);
            if (singleTimeMatch) {
                const hour = singleTimeMatch[1].padStart(2, '0');
                return `${refYear}${refMonth}${day}${hour}00`;
            }
            return '';
        }

        // 종료 시각 사용 (해제 예정 시각의 끝)
        let endHour = parseInt(timeMatch[2]);

        // 24시 처리 → 다음 날 00시로 변환
        if (endHour === 24) {
            const nextDay = parseInt(day) + 1;
            return `${refYear}${refMonth}${String(nextDay).padStart(2, '0')}0000`;
        }

        return `${refYear}${refMonth}${day}${String(endHour).padStart(2, '0')}00`;
    } catch (e) {
        console.error(`[parseTmYnToRawTmEd] 파싱 실패: ${tmYn}`, e.message);
        return '';
    }
}

function savePushLog({ title, content, target, type, tab, tmRef }) {
    try {
        const DATA_DIR = path.join(__dirname, 'data');
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
            title,
            content,
            target,
            type,
            tab,
            tmRef: tmRef || '',
            status: 'sent'
        };

        history.unshift(newLog);
        if (history.length > 500) history = history.slice(0, 500);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (e) {
        console.error('Push history save failed:', e);
    }
}

const CONFIG_FILE = path.join(__dirname, 'data/api_config.json');
const HUB_STATUS_FILE = path.join(__dirname, 'data/hub_status.json');

const CONFIG = {
    KMA_HUB_KEY: 'ZKEQU5ukRvGhEFObpBbxVw', // 기본값
    AFSO_KEY: '', // 향후 필요시 대비
    USE_HUB_RELEASE: false, // [NEW] HUB 하이브리드 해제 활성화 여부
    DATA_DIR: path.join(__dirname, 'data'),
    URLS: {
        KMA_WARNING: 'https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php',
        AFSO_WARNING: 'https://afso.kma.go.kr/afsOut/mmr/warning/retMmrWarningSeaNow.kajx',
        BUOY: 'https://apihub.kma.go.kr/api/typ01/url/sea_obs.php',
        SEA_FORECAST: 'https://apihub.kma.go.kr/api/typ01/url/fct_afs_dl.php',
        SEA_ZONE_LARGE: 'https://apihub.kma.go.kr/api/typ06/url/marine_large_zone.php'
    }
};

/**
 * [Archive] 구역 분류 체계 (app.js 기반)
 * 분석 파일 생성의 기준이 되는 상위 해역과 그에 속한 하위 구역(연안바다/평수구역) 정의
 */
const ARCHIVE_ZONES = {
    // 제주해역
    '제주도북부앞바다': ['제주도북부앞바다중연안바다'],
    '제주도동부앞바다': ['제주도동부앞바다중북동연안바다', '제주도동부앞바다중남동연안바다', '제주도동부앞바다중우도연안바다'],
    '제주도남부앞바다': ['제주도남부앞바다중연안바다'],
    '제주도서부앞바다': ['제주도서부앞바다중북서연안바다', '제주도서부앞바다중남서연안바다', '제주도서부앞바다중가파도연안바다'],
    '제주도남서쪽안쪽먼바다': [],
    '제주도남동쪽안쪽먼바다': [],
    '제주도남쪽바깥먼바다': [],

    // 서해중부
    '인천·경기북부앞바다': ['인천·경기북부앞바다중평수구역', '인천·경기북부앞바다중연안바다'],
    '인천·경기남부앞바다': ['인천·경기남부앞바다중먼평수구역', '인천·경기남부앞바다중북부앞평수구역', '인천·경기남부앞바다중남부앞평수구역'],
    '충남북부앞바다': ['천수만평수구역', '안면도서쪽평수구역', '당진평수구역', '태안·서산북쪽평수구역'],
    '충남남부앞바다': ['충남남부앞바다중평수구역'],
    '서해중부안쪽먼바다': [],
    '서해중부바깥먼바다': [],

    // 서해남부
    '전북북부앞바다': ['전북북부앞바다중평수구역'],
    '전북남부앞바다': ['전북남부앞바다중평수구역'],
    '전남북부서해앞바다': ['전남북부서해앞바다중평수구역'],
    '전남중부서해앞바다': ['전남중부서해앞바다중먼평수구역', '전남중부서해앞바다중앞평수구역'],
    '전남남부서해앞바다': ['전남남부서해앞바다중평수구역'],
    '서해남부북쪽안쪽먼바다': [],
    '서해남부북쪽바깥먼바다': [],
    '서해남부남쪽안쪽먼바다': ['서해남부남쪽안쪽먼바다중조도부근평수구역'],
    '서해남부남쪽바깥먼바다': [],

    // 남해서부
    '전남서부남해앞바다': ['전남서부남해앞바다중평수구역'],
    '전남동부남해앞바다': ['전남동부남해앞바다중서부평수구역', '전남동부남해앞바다중동부평수구역'],
    '남해서부서쪽먼바다': ['남해서부서쪽먼바다중추자도연안바다'],
    '남해서부동쪽먼바다': [],

    // 남해동부
    '부산앞바다': ['부산앞바다중동부평수구역', '부산앞바다중서부평수구역', '부산앞바다중연안바다'],
    '경남서부남해앞바다': ['경남서부남해앞바다중동부평수구역', '경남서부남해앞바다중서부평수구역', '경남서부남해앞바다중남부평수구역', '경남서부남해앞바다중남해군연안바다'],
    '경남중부남해앞바다': ['경남중부남해앞바다중평수구역', '경남중부남해앞바다중연안바다'],
    '거제시동부앞바다': ['거제시동부앞바다중연안바다'],
    '남해동부안쪽먼바다': [],
    '남해동부바깥먼바다': [],

    // 동해남부
    '울산앞바다': ['울산앞바다중평수구역', '울산앞바다중연안바다'],
    '경북남부앞바다': ['경북남부앞바다중평수구역', '경북남부앞바다중연안바다'],
    '경북북부앞바다': ['경북북부앞바다중연안바다'],
    '동해남부남쪽안쪽먼바다': [],
    '동해남부남쪽바깥먼바다': [],
    '동해남부북쪽안쪽먼바다': [],
    '동해남부북쪽바깥먼바다': [],

    // 동해중부
    '강원북부앞바다': ['강원북부앞바다중연안바다'],
    '강원중부앞바다': ['강원중부앞바다중연안바다'],
    '강원남부앞바다': ['강원남부앞바다중연안바다'],
    '동해중부안쪽먼바다': ['울릉도울릉읍연안바다', '울릉도서면연안바다', '울릉도북면연안바다'],
    '동해중부바깥먼바다': []
};

/**
 * [Archive] 광역 특보 통계 매핑 (HUB API가 광역 명칭으로 발표할 경우 대비)
 */
const BROAD_ZONE_MAPPING = {
    // 1. 동해 (East Sea)
    '동해중부앞바다': ['강원북부앞바다', '강원중부앞바다', '강원남부앞바다'],
    '동해중부먼바다': ['동해중부안쪽먼바다', '동해중부바깥먼바다'],
    '동해남부앞바다': ['울산앞바다', '경북남부앞바다', '경북북부앞바다'],
    '동해남부먼바다': ['동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다', '동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다'],

    // 2. 서해 (West Sea)
    '서해중부앞바다': ['인천경기북부앞바다', '인천경기남부앞바다', '충남북부앞바다', '충남남부앞바다'],
    '서해중부먼바다': ['서해중부안쪽먼바다', '서해중부바깥먼바다'],
    '서해남부앞바다': ['전북북부앞바다', '전북남부앞바다', '전남북부서해앞바다', '전남중부서해앞바다', '전남남부서해앞바다'],
    '서해남부먼바다': ['서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다', '서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다'],

    // 3. 남해 (South Sea)
    '남해동부앞바다': ['부산앞바다', '거제시동부앞바다', '경남중부남해앞바다', '경남서부남해앞바다'],
    '남해동부먼바다': ['남해동부안쪽먼바다', '남해동부바깥먼바다'],
    '남해서부앞바다': ['전남동부남해앞바다', '전남서부남해앞바다'],
    '남해서부먼바다': ['남해서부동쪽먼바다', '남해서부서쪽먼바다'],

    // 4. 제주 (Jeju)
    '제주도앞바다': ['제주도북부앞바다', '제주도동부앞바다', '제주도남부앞바다', '제주도서부앞바다'],
    '제주도남쪽먼바다': ['제주도남서쪽안쪽먼바다', '제주도남동쪽안쪽먼바다', '제주도남쪽바깥먼바다'],
    '제주도먼바다': ['제주도남서쪽안쪽먼바다', '제주도남동쪽안쪽먼바다', '제주도남쪽바깥먼바다'], // 호환성용

    // 5. 기타/특수
    '울릉도독도': ['울릉도울릉읍연안바다', '울릉도서면연안바다', '울릉도북면연안바다'],
    '울릉도.독도': ['울릉도울릉읍연안바다', '울릉도서면연안바다', '울릉도북면연안바다']
};

const getLvlPriority = (lvl) => {
    if (!lvl) return 0;
    const l = lvl.replace(/\s/g, '');
    if (l.includes('태풍경보')) return 5;
    if (l.includes('태풍주의보')) return 4;
    if (l.includes('경보')) return 3;
    if (l.includes('주의보') || l.includes('주의')) return 2;
    if (l.includes('예비')) return 1;
    return 0;
};

// ============================================================================
// [NEW] HUB 하이브리드 해제 시스템
// ============================================================================

/**
 * HUB 상태 파일 로드 (해제 이력 추적용)
 */
function loadHubStatus() {
    try {
        if (fs.existsSync(HUB_STATUS_FILE)) {
            return JSON.parse(fs.readFileSync(HUB_STATUS_FILE, 'utf8'));
        }
    } catch (e) {
        log(`⚠️ HUB 상태 로드 실패: ${e.message}`);
    }
    return { releases: {}, updatedAt: null };
}

/**
 * HUB 상태 파일 저장
 */
function saveHubStatus(status) {
    try {
        status.updatedAt = getNowStr();
        fs.writeFileSync(HUB_STATUS_FILE, JSON.stringify(status, null, 2));
    } catch (e) {
        log(`❌ HUB 상태 저장 실패: ${e.message}`);
    }
}

/**
 * HUB Base64 데이터 파싱 (EUC-KR → UTF-8)
 * @param {Buffer} buffer - HUB API에서 받은 원본 데이터
 * @returns {Array} 파싱된 특보 레코드 배열
 */
function parseHubData(buffer) {
    const iconv = require('iconv-lite');
    const decoded = iconv.decode(buffer, 'euc-kr');
    const lines = decoded.split('\n').filter(line => line.trim() && !line.startsWith('#'));

    const records = [];
    for (const line of lines) {
        // 콤마로 구분된 필드 파싱
        const parts = line.split(',').map(s => s.trim());
        if (parts.length < 10) continue;

        // 필드 순서: REG_UP, REG_UP_KO, REG_ID, REG_KO, TM_FC, TM_EF, WRN, LVL, CMD, ED_TM
        const record = {
            regUp: parts[0] || '',
            regUpKo: parts[1] || '',
            regId: parts[2] || '',
            regKo: parts[3] || '',
            tmFc: parts[4] || '',      // 발표 시각 (YYYYMMDDHHMM)
            tmEf: parts[5] || '',      // 발효 시각 (YYYYMMDDHHMM)
            wrnTp: parts[6] || '',     // 특보 종류 (풍랑, 태풍 등)
            wrnLvl: parts[7] || '',    // 등급 (예비, 주의보, 경보)
            cmd: parts[8] || '',       // 명령 (발표, 해제)
            edTm: (parts[9] || '').replace(/[^0-9]/g, '') // 해제 예정 시각
        };

        // 유효한 레코드만 추가
        if (record.regId && record.wrnTp) {
            records.push(record);
        }
    }

    return records;
}

/**
 * [NEW] HUB 데이터 원본 로그 저장 (통합 파일 방식)
 * @param {Buffer} buffer - HUB API에서 받은 원본 데이터
 * @param {string} prefix - 로그 메시지 구분자 (release 등)
 */

/**
 * HUB 데이터에서 해제된 구역 추출
 * @param {Array} hubRecords - parseHubData로 파싱된 레코드
 * @param {string} nowNum - 현재 시각 (YYYYMMDDHHMM)
 * @returns {Object} 해제된 구역 정보 { regId: { regKo, wrnTp, edTm } }
 */
function extractHubReleases(hubRecords, nowNum) {
    const releases = {};

    for (const rec of hubRecords) {
        // CMD가 "해제"인 경우
        if (rec.cmd && rec.cmd.includes('해제')) {
            // 해제 예정 시각이 있으면 그 시각, 없으면 즉시 해제
            const releaseTime = rec.edTm || nowNum;

            // [수정] 해제 명령인 경우 시각과 무관하게 즉시 해제 목록에 추가 (Ghost Retain 돌파용)
            releases[rec.regId] = {
                regKo: rec.regKo,
                wrnTp: rec.wrnTp,
                edTm: releaseTime,
                hubVerified: true
            };
        }
    }

    return releases;
}

/**
 * 상위 구역 해제 시 연관 소구역 자동 해제 (Cascading)
 * @param {Object} releases - 해제된 구역 맵
 * @param {Object} activeMap - 현재 발효 중인 activeMap
 * @returns {Object} 확장된 해제 맵
 */
function cascadeReleases(releases, activeMap) {
    const extended = { ...releases };

    // 상위 구역(regUp)이 해제되면 하위 구역도 해제
    for (const [regId, info] of Object.entries(releases)) {
        // activeMap에서 같은 상위 구역에 속한 소구역 찾기
        for (const [activeRegId, activeInfo] of Object.entries(activeMap)) {
            // 연안바다, 평수구역 판별 (S212xxxx, S211xxxx 등)
            if (activeRegId.startsWith('S21') && activeInfo.regKo) {
                const mainZone = activeInfo.regKo.replace(/중\s*(연안바다|평수구역|평수구).*$/, '').trim();
                const releasedZone = info.regKo.replace(/중\s*(연안바다|평수구역|평수구).*$/, '').trim();

                if (mainZone === releasedZone || info.regKo.includes(mainZone)) {
                    if (!extended[activeRegId]) {
                        extended[activeRegId] = {
                            regKo: activeInfo.regKo,
                            wrnTp: info.wrnTp,
                            edTm: info.edTm,
                            hubVerified: true,
                            cascaded: true
                        };
                    }
                }
            }
        }
    }

    return extended;
}

// [Config Management] 인증키 동적 로드 및 저장
function loadApiConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const fileData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (fileData.KMA_HUB_KEY) CONFIG.KMA_HUB_KEY = fileData.KMA_HUB_KEY;
            if (fileData.AFSO_KEY) CONFIG.AFSO_KEY = fileData.AFSO_KEY;
            if (typeof fileData.USE_HUB_RELEASE === 'boolean') CONFIG.USE_HUB_RELEASE = fileData.USE_HUB_RELEASE;
            // log('🔑 API 설정 로드 완료');
        }
    } catch (e) {
        log(`⚠️ API 설정 로드 실패: ${e.message}`);
    }
}
loadApiConfig();

function saveApiConfig(newConfig) {
    try {
        if (newConfig.KMA_HUB_KEY) CONFIG.KMA_HUB_KEY = newConfig.KMA_HUB_KEY;
        if (newConfig.AFSO_KEY !== undefined) CONFIG.AFSO_KEY = newConfig.AFSO_KEY;
        if (typeof newConfig.USE_HUB_RELEASE === 'boolean') CONFIG.USE_HUB_RELEASE = newConfig.USE_HUB_RELEASE;

        fs.writeFileSync(CONFIG_FILE, JSON.stringify({
            KMA_HUB_KEY: CONFIG.KMA_HUB_KEY,
            AFSO_KEY: CONFIG.AFSO_KEY,
            USE_HUB_RELEASE: CONFIG.USE_HUB_RELEASE
        }, null, 2));
        log(`✅ API 설정 저장 완료 (USE_HUB_RELEASE: ${CONFIG.USE_HUB_RELEASE})`);
        return true;
    } catch (e) {
        log(`❌ API 설정 저장 실패: ${e.message}`);
        return false;
    }
}



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

function getNowStr() {
    return getCorrectedDate().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}
function getYMDHM() {
    const now = getCorrectedDate();
    const kst = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const year = kst.getUTCFullYear();
    const month = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kst.getUTCDate()).padStart(2, '0');
    const hour = String(kst.getUTCHours()).padStart(2, '0');
    const min = String(kst.getUTCMinutes()).padStart(2, '0');
    return `${year}${month}${day}${hour}${min}`;
}
function log(msg) {
    console.log(`[${getNowStr()}] ${msg}`);
}
function decodeHtml(text) {
    if (!text) return '';
    return text.replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#40;/g, '(').replace(/&#41;/g, ')').replace(/\u2028/g, ' ').replace(/\u2029/g, ' ');
}
function getUtcTm(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const h = String(date.getUTCHours()).padStart(2, '0');
    return `${y}${m}${d}${h}`;
}

const PROD_DATA_DIR = path.join(__dirname, '../../Production/local_server/data');
const IS_FLY_IO = !!process.env.FLY_ALLOC_ID;

function saveData(filename, data) {
    const jsonStr = JSON.stringify(data, null, 2);
    try {
        fs.writeFileSync(path.join(CONFIG.DATA_DIR, filename), jsonStr);
        if (!IS_FLY_IO && fs.existsSync(PROD_DATA_DIR)) {
            fs.writeFileSync(path.join(PROD_DATA_DIR, filename), jsonStr);
        }
    } catch (e) { }
}

async function fetchWithRetry(url, options = {}, retries = 3, timeout = 10000) {
    for (let i = 0; i < retries; i++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (err) {
            clearTimeout(timeoutId);
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
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

// 1. 특보 수집 (통합) - **장부 기반 신규 로직**
// 1. 특보 수집 (통합) - **히스토리 기반 상태 관리 (History-Based State Machine)**
async function collectWarnings() {
    log('🔄 특보 자동 수집 시작 (History-Based Logic)...');
    let hubSuccess = false;
    let afsoSuccess = false;
    let kmaBase64 = null;
    let afsoJson = {};

    // 1) KMA HUB (백업용 + 하이브리드 해제용)
    let hubBuffer = null; // [NEW] HUB 파싱용 버퍼 보관
    try {
        const kmaUrl = `${CONFIG.URLS.KMA_WARNING}?disp=0&help=0&stn_id=0&authKey=${CONFIG.KMA_HUB_KEY}`;
        const kmaRes = await fetchWithRetry(kmaUrl);
        const kmaArrayBuffer = await kmaRes.arrayBuffer();
        hubBuffer = Buffer.from(kmaArrayBuffer); // [NEW] 파싱용 버퍼 저장
        kmaBase64 = 'BASE64:' + hubBuffer.toString('base64');
        lastRunStatus.warnings_hub = { lastRun: getNowStr(), status: '성공', message: 'HUB 데이터 수집 완료' };
        hubSuccess = true;
    } catch (e) {
        lastRunStatus.warnings_hub = { lastRun: getNowStr(), status: '실패', message: e.message };
        log(`❌ HUB 특보 수집 실패: ${e.message}`);
    }

    // 2) AFSO (실제 사용 데이터)
    try {
        let metData = [];
        let page = 1;
        const maxPages = 5; // 안전장치

        const seenItems = new Set();
        while (page <= maxPages) {
            const afsoUrl = `${CONFIG.URLS.AFSO_WARNING}?tmFc=${getYMDHM()}&stnId=108&fe=f&mmr=mmr&tmFe=&numOfRows=999&page=${page}&_t=${Date.now()}`;

            const afsoRes = await fetchWithRetry(afsoUrl);
            const afsoText = await afsoRes.text();
            let pageJson = {};
            try { pageJson = JSON.parse(afsoText); } catch (e) { log(`❌ AFSO JSON 파싱 실패: ${e.message}`); break; }

            const items = pageJson.data?.metData || pageJson.metData || [];
            if (items.length === 0) break;

            items.forEach(item => {
                const uniqueKey = `${item.regId}_${item.tmFc}_${item.wrnTp}_${item.wrnLvl}`;
                if (!seenItems.has(uniqueKey)) {
                    metData.push(item);
                    seenItems.add(uniqueKey);
                }
            });

            if (items.length < 100) break;
            page++;
            await new Promise(r => setTimeout(r, 200));
        }

        afsoJson = { metData: metData };

        const count = metData.length;
        log(`🔍 AFSO 수신: ${count}건 (페이지: ${page})`);

        // [NEW] 히스토리 기반 비교 엔진 (History Engine)
        // LifeCycleManager의 최신 상태를 비교용 prevState로 인라인 변환
        const prevState = {};
        if (typeof lifeCycleManager !== 'undefined' && lifeCycleManager.state && lifeCycleManager.state.zones) {
            for (const [regId, entry] of Object.entries(lifeCycleManager.state.zones)) {
                prevState[regId] = {
                    activeAlert: entry.current,
                    upcomingAlert: entry.upcoming,
                    history: entry.history || []
                };
            }
        }

        const nextState = {};
        const changes = []; // 발생한 알림 이벤트

        // 2-1) 현재 API 데이터를 active/upcoming으로 분리 수집
        const activeMap = {};   // 현재 발효 중인 특보
        const upcomingMap = {}; // 예정된 특보 (아직 발효 안 됨)
        const nowNum = getYMDHM().replace(/[^0-9]/g, '');

        if (metData && Array.isArray(metData)) {
            metData.forEach(item => {
                if (!item.regId) return;

                // [수정 v2] wrnCmd에 의존하지 않고, 해제 시각 필드로 판단
                let rawTmEdFromApi = (item.tmEd || '').replace(/[^0-9]/g, '');
                const tmYnText = (item.tmEdKo || item.tmEd || '').replace(/&#40;/g, '(').replace(/&#41;/g, ')');
                const tmFcRef = (item.tmFc || '').replace(/[^0-9]/g, '');

                // [NEW] rawTmEd가 비어있으면 tmYn에서 파싱 시도
                let rawTmEd = rawTmEdFromApi;
                if (!rawTmEd || rawTmEd.length < 12) {
                    rawTmEd = parseTmYnToRawTmEd(tmYnText, tmFcRef);
                }

                // [NEW] 미래 해제 여부 판단 (wrnCmd와 무관하게 rawTmEd만으로 판단)
                const hasFutureReleaseTime = rawTmEd && rawTmEd.length >= 12 && rawTmEd > nowNum;

                // [수정] 해제 명령이면서 해제 시각이 이미 지난 경우만 스킵
                const isImmediateRelease = item.wrnCmd && item.wrnCmd.includes('해제') && !hasFutureReleaseTime;
                if (isImmediateRelease) return;

                if (item.wrnTp && item.wrnTp.trim() !== '') {
                    const level = (item.wrnLvlName && item.wrnLvlName.includes('경보')) || item.wrnLvl === '3' ? '경보' :
                        (item.wrnLvlName && item.wrnLvlName.includes('주의')) || item.wrnLvl === '2' ? '주의보' :
                            (item.wrnLvlName && item.wrnLvlName.includes('예비')) || item.wrnLvl === '1' ? '예비' : '기타';

                    const rawTmEf = (item.tmEf || '').replace(/[^0-9]/g, '');
                    const isActive = rawTmEf && rawTmEf.length >= 12 && rawTmEf <= nowNum;

                    const alertData = {
                        regId: item.regId,
                        regKo: (item.regKo || '').trim(),
                        wrnTp: item.wrnTp || '',
                        wrnLvl: level,
                        tmFc: item.tmFc || '',
                        tmEf: (item.tmEfKo || item.tmEf || '').replace(/&#40;/g, '(').replace(/&#41;/g, ')'),
                        tmYn: tmYnText,
                        command: item.wrnCmd || '',
                        rawTmEf: rawTmEf,
                        rawTmEd: rawTmEd  // [수정] 파싱된 값 사용
                    };

                    const LEVEL_RANK = { '경보': 3, '주의보': 2, '예비': 1, '기타': 0, '': 0 };

                    // [NEW] 발효 중인 특보에 미래 해제 시각이 있는 경우 처리
                    if (isActive && (level === '주의보' || level === '경보')) {
                        const existing = activeMap[item.regId];
                        if (!existing || LEVEL_RANK[level] > LEVEL_RANK[existing.wrnLvl || '']) {
                            // [수정] 미래 해제 시각이 있으면 isPendingRelease 플래그 추가
                            if (hasFutureReleaseTime) {
                                activeMap[item.regId] = { ...alertData, isPendingRelease: true };
                            } else {
                                activeMap[item.regId] = alertData;
                            }
                        }
                    } else if (!isActive && level !== '기타') {
                        // 예정된 특보 (주의보, 경보, 예비) → upcomingMap에 저장
                        const existing = upcomingMap[item.regId];
                        if (!existing || LEVEL_RANK[level] > LEVEL_RANK[existing.wrnLvl || '']) {
                            upcomingMap[item.regId] = alertData;
                        }
                    } else if (hasFutureReleaseTime && (level === '주의보' || level === '경보')) {
                        // [수정] wrnCmd와 무관하게 미래 해제 시각이 있으면 activeMap에 유지
                        activeMap[item.regId] = { ...alertData, isPendingRelease: true };
                    }
                }
            });
        }

        // [호환성] 기존 로직과의 호환을 위해 currentMap도 유지 (activeMap 우선, 없으면 upcomingMap)
        const currentMap = {};
        Object.keys(activeMap).forEach(regId => { currentMap[regId] = activeMap[regId]; });
        Object.keys(upcomingMap).forEach(regId => {
            if (!currentMap[regId]) currentMap[regId] = upcomingMap[regId];
        });

        // =================================================================
        // [NEW] HUB 하이브리드 해제 엔진 (상시 수집 및 분석)
        // =================================================================
        let hubReleasedZones = {};
        let hubPresentRegIds = new Set(); // [NEW] HUB에 실시간으로 존재하는 모든 구역 ID Set
        const hubStatus = loadHubStatus();
        let currentHubRecords = []; // [NEW] 라이프사이클 업데이트용 HUB 레코드 보관

        if (hubBuffer && hubSuccess) {
            try {
                currentHubRecords = parseHubData(hubBuffer);
                hubPresentRegIds = new Set(currentHubRecords.map(r => r.regId)); // 현재 HUB 응답에 포함된 모든 구역

                // HUB에서 해제된 구역 추출
                const rawReleases = extractHubReleases(currentHubRecords, nowNum);
                // 연관 소구역 자동 해제 (Cascading)
                hubReleasedZones = cascadeReleases(rawReleases, activeMap);

                const releasedCount = Object.keys(hubReleasedZones).length;
                if (releasedCount > 0) {
                    // [상시 기록] 해제 감지 시 무조건 로그 기록 (분석용)

                    // HUB 상태에 해제 이력 저장 (AFSO 뒷북 방지용으로 로그 유효 시간 관리)
                    for (const [regId, info] of Object.entries(hubReleasedZones)) {
                        hubStatus.releases[regId] = {
                            ...info,
                            verifiedAt: nowStr,
                            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
                        };
                    }
                    saveHubStatus(hubStatus);
                } else {
                    // [NEW] 해제가 없더라도 모든 유효 수집 주기에 대해 로그 기록 (분석용)
                }

                // ---------------------------------------------------------
                // [분기점] 관리자 설정에 따른 실제 데이터 적용
                // CONFIG.USE_HUB_RELEASE가 true = 하이브리드 모드(HUB 사용)
                if (CONFIG.USE_HUB_RELEASE) {
                    // 하이브리드 모드일 때만 activeMap에서 레이어 삭제 처리
                    if (releasedCount > 0) {
                        const releasedRegIds = Object.keys(hubReleasedZones);
                        for (const regId of releasedRegIds) {
                            if (activeMap[regId]) {
                                log(`  → [HUB Hybrid] ${activeMap[regId].regKo} 빠른 해제 적용`);
                                // [조치 2] 비교 로직(Case A)에서 대기 없이 해제하도록 플래그 부여
                                activeMap[regId].hubVerified = true;

                                delete activeMap[regId];
                                delete currentMap[regId];
                            }
                        }

                        // [조치 1] 인덱스 페이지(warnings.json) 데이터에서도 제거 (동기화)
                        metData = metData.filter(item => !releasedRegIds.includes(item.regId));
                        afsoJson.metData = metData; // 업데이트된 리스트 반영
                    }

                    // AFSO 뒷북 데이터 필터링 (최근 1시간 내 HUB에서 해제된 정보는 AFSO에서 다시 들어와도 무시)
                    for (const [regId, info] of Object.entries(hubStatus.releases || {})) {
                        if (info.expiresAt && info.expiresAt > new Date().toISOString()) {
                            if (activeMap[regId]) {
                                log(`  → [HUB Filter] ${activeMap[regId].regKo} (AFSO 중복/지연 데이터 무시)`);
                                activeMap[regId].hubVerified = true;
                                delete activeMap[regId];
                                delete currentMap[regId];

                                // metData에서도 필터링
                                metData = metData.filter(item => item.regId !== regId);
                                afsoJson.metData = metData;
                            }
                        }
                    }
                } else {
                    // AFSO 전용 모드일 때는 수집/로그만 수행하고 데이터 반영은 건너뜀
                }
            } catch (e) {
                log(`⚠️ HUB 하이브리드 엔진 오류: ${e.message}`);
            }
        }

        // [정리] 오래된 HUB 해제 이력 정리 (1시간 지난 것 삭제)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        for (const [regId, info] of Object.entries(hubStatus.releases || {})) {
            if (info.expiresAt && info.expiresAt < oneHourAgo) {
                delete hubStatus.releases[regId];
            }
        }

        // 2-2) 전체 비교 (이전 상태 + 현재 상태 합집합)
        const allZoneIds = new Set([...Object.keys(prevState), ...Object.keys(currentMap)]);
        // nowNum은 위에서 이미 선언됨
        const nowStr = getNowStr();

        allZoneIds.forEach(regId => {
            let prevEntry = prevState[regId];
            const currActive = activeMap[regId] || null;
            const currUpcoming = upcomingMap[regId] || null;
            const currInfo = currentMap[regId]; // 호환성용


            // Case A: 완전 해제 (장부엔 있었는데 API에서 모두 사라진 경우)
            if (prevEntry && !currActive && !currUpcoming) {
                const releaseData = prevEntry.activeAlert || prevEntry.upcomingAlert;
                if (releaseData) {
                    // [핵심 수정 v2] API 목록에서 사라졌더라도, 해제 예정 시각이 아직 도래하지 않았다면 유지
                    let releaseTime = releaseData.rawTmEd || '';

                    // [NEW] rawTmEd가 비어있으면 tmYn에서 파싱 시도
                    if (!releaseTime || releaseTime.length < 12) {
                        const tmFcRef = (releaseData.tmFc || '').replace(/[^0-9]/g, '');
                        releaseTime = parseTmYnToRawTmEd(releaseData.tmYn, tmFcRef);
                    }

                    // [조치 2] 해제 승인 조건 (HUB 명시적 해제 OR HUB 데이터 리스트에서 사라짐)
                    const isHubExplicitlyReleased = (hubReleasedZones && hubReleasedZones[regId]);
                    const isHubMissing = hubBuffer && hubSuccess && !hubPresentRegIds.has(regId);
                    const isHubVerified = (releaseData.hubVerified === true) || isHubExplicitlyReleased || isHubMissing;

                    if (!isHubVerified && releaseTime && releaseTime > nowNum && releaseTime.length >= 12) {
                        // 아직 해제 시간이 아니므로 상태 유지 (Ghost Active)
                        log(`👻 [Ghost Retain] ${regId} (${releaseData.regKo}) 해제 예정 ${releaseTime}까지 유지`);
                        nextState[regId] = prevEntry;
                        return;
                    }

                    // 시간이 지났거나 정보가 없으면 해제 처리
                    changes.push({ type: 'release', regId, data: releaseData });
                }
                return; // nextState에 넣지 않음 → 삭제됨
            }

            // Case B: 신규 발생 (이전에 없었는데 생김)
            if (!prevEntry && (currActive || currUpcoming)) {
                const newEntry = {
                    activeAlert: currActive ? { ...currActive, status: 'active' } : null,
                    upcomingAlert: currUpcoming ? { ...currUpcoming, status: 'publish' } : null,
                    history: []
                };

                if (currActive) newEntry.history.push({ ...currActive, _recordedAt: nowStr, _status: 'active' });
                if (currUpcoming) newEntry.history.push({ ...currUpcoming, _recordedAt: nowStr, _status: 'publish' });

                nextState[regId] = newEntry;

                // 최초 실행이 아닐 때만 알림
                if (Object.keys(prevState).length > 0) {
                    if (currActive) changes.push({ type: 'active', regId, data: currActive });
                    if (currUpcoming) changes.push({ type: 'publish', regId, data: currUpcoming });
                }
                return;
            }

            // Case C: 업데이트 (기존 데이터가 있는 경우)
            if (prevEntry && (currActive || currUpcoming)) {
                const prevActive = prevEntry.activeAlert;
                const prevUpcoming = prevEntry.upcomingAlert;
                const LEVEL_RANK = { '경보': 3, '주의보': 2, '예비': 1, '기타': 0, '': 0 };

                const newEntry = {
                    activeAlert: null,
                    upcomingAlert: null,
                    history: prevEntry.history || []
                };
                const nowNum = nowStr.replace(/[^0-9]/g, ''); // YYYYMMDDHHmm

                // B) 상태 비교 및 변경 탐색 (Core Logic)
                // -------------------------------------------------------------

                // C-1) activeAlert 처리 (현재 발효 중인 특보)
                if (currActive) {
                    const isNew = !prevActive;

                    // [수정] 발효의 기준: 이전에 발효된 특보가 없었다면 무조건 '발효'임 (사용자 원칙)
                    const isActivation = isNew;

                    // [수정] 시각 변경 감지
                    const isTimeOnlyChange = prevActive &&
                        prevActive.wrnTp === currActive.wrnTp &&
                        prevActive.wrnLvl === currActive.wrnLvl &&
                        (prevActive.tmEf !== currActive.tmEf || prevActive.tmYn !== currActive.tmYn);

                    const isLevelChange = prevActive && (prevActive.wrnLvl !== currActive.wrnLvl);

                    const isChanged = prevActive && (
                        prevActive.wrnTp !== currActive.wrnTp ||
                        prevActive.wrnLvl !== currActive.wrnLvl ||
                        prevActive.tmEf !== currActive.tmEf ||
                        prevActive.tmYn !== currActive.tmYn
                    );

                    if (isNew || isChanged || isActivation) {
                        const lastHistory = newEntry.history[newEntry.history.length - 1];
                        const isIdentical = lastHistory &&
                            lastHistory.wrnLvl === currActive.wrnLvl &&
                            lastHistory.tmEf === currActive.tmEf &&
                            lastHistory.tmYn === currActive.tmYn &&
                            lastHistory.wrnTp === currActive.wrnTp &&
                            lastHistory._status === 'active';

                        if (!isIdentical) {
                            log(`🔄 [Active Change] ${regId} (${currActive.regKo}): ${prevActive?.wrnLvl || 'NEW'} -> ${currActive.wrnLvl}`);
                            newEntry.history.push({ ...currActive, _recordedAt: nowStr, _status: 'active' });
                        }

                        let changeType = 'active'; // 기본값 (신규 발효)

                        if (prevActive) {
                            // 이미 발효 중인 특보가 있을 때만 '격상/격하' 단어를 사용함
                            if (isLevelChange) {
                                const isUp = LEVEL_RANK[currActive.wrnLvl] > LEVEL_RANK[prevActive.wrnLvl];
                                changeType = isUp ? 'upgrade' : 'downgrade';
                            } else if (isTimeOnlyChange) {
                                changeType = 'active_time_change';
                            }
                        }

                        changes.push({ type: changeType, regId, data: currActive });
                    }

                    // [New] 해제 예정(Release Scheduled) 감지
                    if (currActive.isPendingRelease) {
                        const isFirstNotice = !prevActive || !prevActive.isPendingRelease;
                        const isTimeChange = prevActive && prevActive.isPendingRelease && prevActive.tmYn !== currActive.tmYn;

                        if (isFirstNotice || isTimeChange) {
                            changes.push({ type: 'release_scheduled', regId, data: currActive });
                            log(`🔔 [Release Scheduled] ${regId} (${currActive.regKo}) ${currActive.tmYn} 해제 예정 알림 등록`);
                        }
                    }

                    newEntry.activeAlert = { ...currActive, status: 'active' };
                } else if (prevActive) {
                    // [해석] 기상청 데이터(Active)에서 일시적으로 사라졌을 때의 처리
                    // 사용자 원칙: 공식 해제 시각(tmEd)이 지나거나, 다른 예보로 완전히 대체되었을 때만 해제로 간주함
                    // [추가] HUB 데이터에서도 사라졌다면 사용자의 요청에 따라 즉시 해제함 (Silent Removal)
                    const isPassedEd = prevActive.rawTmEd && prevActive.rawTmEd <= nowNum;
                    const isConfirmedRemoval = !currUpcoming || currUpcoming.wrnTp !== prevActive.wrnTp;
                    const isConfirmedByHub = (hubReleasedZones && hubReleasedZones[regId]) || (hubBuffer && hubSuccess && !hubPresentRegIds.has(regId));
                    const isFutureEd = prevActive.rawTmEd && prevActive.rawTmEd > nowNum;

                    if (isPassedEd || isConfirmedRemoval || isConfirmedByHub) {
                        changes.push({ type: 'release', regId, data: prevActive });
                        // newEntry.activeAlert는 null로 유지 (해제됨)
                    } else if (isFutureEd) {
                        // 아직 해제 시각이 안 되었으므로 'active' 상태를 강제 유지
                        newEntry.activeAlert = { ...prevActive, isGhostActive: true };
                        log(`👻 [Ghost Active] ${regId} (${prevActive.regKo}) 해제 시각 전까지 유지 중...`);
                    }
                }

                // C-2) upcomingAlert 처리 (예정된 특보)
                if (currUpcoming) {
                    const isNew = !prevUpcoming;

                    const isTimeOnlyChange = prevUpcoming &&
                        prevUpcoming.wrnTp === currUpcoming.wrnTp &&
                        prevUpcoming.wrnLvl === currUpcoming.wrnLvl &&
                        (prevUpcoming.tmEf !== currUpcoming.tmEf || prevUpcoming.tmYn !== currUpcoming.tmYn);

                    const isLevelChange = prevUpcoming && (prevUpcoming.wrnLvl !== currUpcoming.wrnLvl);

                    // [수정] 이미 발효 중인 특보가 있을 때 예정 정보를 대조
                    const isLevelChangeVsActive = prevActive && (prevActive.wrnLvl !== currUpcoming.wrnLvl);

                    const isChanged = prevUpcoming && (
                        prevUpcoming.wrnTp !== currUpcoming.wrnTp ||
                        prevUpcoming.wrnLvl !== currUpcoming.wrnLvl ||
                        prevUpcoming.tmEf !== currUpcoming.tmEf ||
                        prevUpcoming.tmYn !== currUpcoming.tmYn
                    );

                    if (isNew || isChanged || (prevActive && isLevelChangeVsActive)) {
                        const lastHistory = newEntry.history[newEntry.history.length - 1];
                        const isIdentical = lastHistory &&
                            lastHistory.wrnLvl === currUpcoming.wrnLvl &&
                            lastHistory.tmEf === currUpcoming.tmEf &&
                            lastHistory.tmYn === currUpcoming.tmYn &&
                            lastHistory._status === 'publish';

                        if (!isIdentical) {
                            log(`📢 [Upcoming Change] ${regId} (${currUpcoming.regKo}): ${prevUpcoming?.wrnLvl || 'NEW'} -> ${currUpcoming.wrnLvl}`);
                            newEntry.history.push({ ...currUpcoming, _recordedAt: nowStr, _status: 'publish' });
                        }

                        let changeType = 'publish'; // 기본: 신규 발표

                        if (prevActive) {
                            // 발효 중인 게 있을 때만 '격상/격하 예정' 사용
                            if (isLevelChangeVsActive || isLevelChange) {
                                const isUp = LEVEL_RANK[currUpcoming.wrnLvl] > LEVEL_RANK[prevActive.wrnLvl];
                                changeType = isUp ? 'upgrade_scheduled' : 'downgrade_scheduled';
                            } else if (isTimeOnlyChange) {
                                changeType = 'publish_time_change';
                            }
                        } else {
                            // 발효 중인 게 없을 때는 등급이 바뀌어도 '신규 발표'임 (사용자 원칙)
                            if (isTimeOnlyChange && !isLevelChange) {
                                changeType = 'publish_time_change';
                            }
                        }

                        changes.push({ type: changeType, regId, data: currUpcoming });
                    }

                    newEntry.upcomingAlert = { ...currUpcoming, status: 'publish' };
                }
                // prevUpcoming이 있었는데 currUpcoming이 없으면
                // 1) 발효되어 currActive로 이동했거나 (이미 처리됨)
                // 2) 취소/해제되었거나
                if (prevUpcoming && !currUpcoming && !currActive) {
                    changes.push({ type: 'release', regId, data: prevUpcoming });
                }

                nextState[regId] = newEntry;
            }
        });


        // 2-5) 알림 발송 (Raw changes를 직접 넘겨줌 - 개인화 필터링을 위해)
        if (changes.length > 0) {
            log(`🚀 상태 변경 감지: ${changes.length}건`);
            sendPushAlert(changes); // groupChangesToAlerts는 sendPushAlert 내부에서 사용자별로 수행됨
        }

        // =================================================================
        // [NEW] LifeCycle Update & Final Save
        // =================================================================
        // API 수집/필터링/알림 로직이 모두 끝난 후, 최종 상태를 장부에 업데이트
        lifeCycleManager.update(activeMap, upcomingMap, metData, currentHubRecords);

        // Index 페이지용 데이터는 이제 API가 아니라 LifeCycle 장부에서 가져옴
        const finalWarnings = lifeCycleManager.getWarningsJson();
        afsoJson.metData = finalWarnings.metData; // 서버 메모리 객체 업데이트

        lastRunStatus.warnings_afso = { lastRun: getNowStr(), status: '성공', message: `AFSO ${count}건` };
        afsoSuccess = true;
    } catch (e) {
        lastRunStatus.warnings_afso = { lastRun: getNowStr(), status: '실패', message: e.message };
        log(`❌ AFSO 로직 실패: ${e.message}`);
        console.error(e);
    }

    // 통합 결과 저장 (백엔드만 사용하므로 구조 변경 무관)
    if (hubSuccess || afsoSuccess) {
        // [핵심 변경] warnings.json에 저장되는 데이터는 API 원본이 아니라 LifeCycle 요약본임
        // 따라서 조기 삭제되거나 누락된 데이터도 LifeCycle이 살아있다면 여기 포함됨.
        saveData('warnings.json', {
            updatedAt: getNowStr(),
            kma: kmaBase64,
            afso: afsoJson // 위에서 lifeCycleManager.getWarningsJson() 결과로 덮어씌워짐
        });

        lastRunStatus.warnings = { lastRun: getNowStr(), status: '성공', message: '데이터 저장 완료' };
    }
}

// [Modified] 사용자별 맞춤 알림 발송 함수 (Personalization)
function sendPushAlert(changes) {
    if (!changes || changes.length === 0) return;

    const SUBS_FILE = path.join(__dirname, 'data/subscriptions.json');
    if (!fs.existsSync(SUBS_FILE)) return;

    let subs = [];
    try { subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch (e) { log(`❌ 구독자 로드 실패: ${e.message}`); }
    if (subs.length === 0) return;

    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || 'mailto:seagnal_admin@example.com',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
    }

    log(`🔔 [Push] 개인화 알림 발송 시작 (총 변경사항: ${changes.length}건 / 대상: ${subs.length}명)`);

    let deadSubscriptionsFound = false;

    // [New] 야간 시간대 확인 (KST 23:00 ~ 07:00)
    // Fly.io 서버가 UTC 기준일 수 있으므로 안전하게 변환
    const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const kstHour = nowKst.getUTCHours();
    const isNightTime = (kstHour >= 23 || kstHour < 7);

    // [Personalization Loop]
    const sendPromises = subs.map(user => {

        // Default options: Alert ON for all types, Night ON (Fail-safe)
        const opts = user.options || { master: true, announce: true, active: true, release: true, night: true };

        // 0. 마스터 스위치 확인
        if (opts.master === false) return Promise.resolve();

        // 2. 야간 시간대 확인 (기본값 True -> False일 때만 차단)
        // opts.night가 undefined여도 알림을 보내도록 안전장치 마련
        if (isNightTime && opts.night === false) {
            console.log(`🔇 [Skip] 야간 차단: ${user.id} (Night: ${opts.night})`);
            return Promise.resolve();
        }

        // 1. 이 사용자가 받아야 할 변경사항만 필터링
        const userChanges = changes.filter(ch => {
            const isMatch = (opts.target === 'all') ? true : isZoneMatched(user.zones, ch.data.regKo);
            if (!isMatch) return false;

            // [핵심 필터] '해제 예정' 알림은 중복 정보이므로 차단 (실제 '해제' 알림은 허용)
            // 사용자 원칙: "풍랑주의보 해제 예정 푸시는 발효 시점에 이미 정보가 포함되어 있으므로 발송하지 않음"
            if (ch.type === 'release_scheduled') return false;

            if (ch.type === 'release' && !opts.release) return false;
            // if (ch.type === 'release_scheduled' && !opts.release) return false; // 위에서 원천 차단
            if (ch.type === 'publish' && !opts.announce) return false;
            if (['active', 'upgrade', 'downgrade'].includes(ch.type) && !opts.active) return false;

            return true;
        });

        if (userChanges.length === 0) return Promise.resolve();

        // 2. 필터링된 데이터로 알림 메시지 생성
        const personalAlerts = groupChangesToAlerts(userChanges);

        // 3. 발송
        return Promise.all(personalAlerts.map(alert => {
            const params = new URLSearchParams();
            params.append('popup', 'true');
            if (alert.data) Object.entries(alert.data).forEach(([k, v]) => params.append(k, v));
            const url = `/?tab=weather-alert-section&${params.toString()}`;

            let pushPromise;
            if (user.type === 'fcm' && user.token) {
                if (admin.apps.length > 0) {
                    const message = {
                        token: user.token,
                        notification: { title: alert.title, body: alert.body },
                        data: { url: url, type: 'weather_alert', ...(alert.data || {}) }
                    };
                    pushPromise = admin.messaging().send(message);
                }
            } else if ((!user.type || user.type === 'web') && user.subscription) {
                const payload = JSON.stringify({ title: alert.title, body: alert.body, url: url });
                pushPromise = webpush.sendNotification(user.subscription, payload);
            }

            if (pushPromise) {
                return pushPromise.then(() => {
                    // [Fix] 중복 기록 방지: 한 번의 전체 발송 주기에서 동일한 알림은 대표로 한 번만 기록
                    const logKey = `${alert.title}_${alert.tmRef || alert.headerTime}`;
                    if (!global._lastPushLoggedKeys) global._lastPushLoggedKeys = new Set();

                    if (!global._lastPushLoggedKeys.has(logKey)) {
                        global._lastPushLoggedKeys.add(logKey);
                        // 짧은 시간(5초) 후 Set 초기화하여 다음 주기 준비
                        setTimeout(() => global._lastPushLoggedKeys?.delete(logKey), 5000);

                        savePushLog({
                            title: alert.title,
                            content: alert.body,
                            target: alert.areaName,
                            type: 'auto',
                            tab: alert.data.status,
                            tmRef: alert.tmRef
                        });
                    }
                    return { success: true };
                }).catch(err => {
                    if (err.code === 'messaging/registration-token-not-registered' || err.statusCode === 404 || err.statusCode === 410) {
                        user._isDead = true; deadSubscriptionsFound = true;
                    }
                    return { success: false, error: err.message };
                });
            }
            return Promise.resolve();
        }));
    });

    Promise.all(sendPromises).then(() => {
        if (deadSubscriptionsFound) {
            const updatedSubs = subs.filter(u => !u._isDead);
            fs.writeFileSync(SUBS_FILE, JSON.stringify(updatedSubs, null, 2));
        }
    });
}

// [Helper] 변경 사항을 알림 메시지로 변환
function groupChangesToAlerts(changes) {
    const alerts = [];
    const grouped = {};

    changes.forEach(ch => {
        const fullTmEf = ch.data.tmEf ? (ch.data.tmEf.length < 10 ? new Date().getFullYear() + ch.data.tmEf : ch.data.tmEf) : '';
        const fullTmYn = ch.data.tmYn ? (ch.data.tmYn.length < 10 ? new Date().getFullYear() + ch.data.tmYn : ch.data.tmYn) : '';
        const fullTmFc = ch.data.tmFc ? (ch.data.tmFc.length < 10 ? new Date().getFullYear() + ch.data.tmFc : ch.data.tmFc) : '';

        // [핵심 변경] 그룹 키에서 시각(tmEf)을 제거하여 특보 종류별로 통합
        const key = `${ch.type}_${ch.data.wrnTp}_${ch.data.wrnLvl || ''}`;
        if (!grouped[key]) {
            grouped[key] = {
                type: ch.type,
                wrnTp: ch.data.wrnTp,
                wrnLvl: ch.data.wrnLvl,
                tmFc: fullTmFc || getNowStr().replace(/[^0-9]/g, '').substring(0, 12),
                items: []
            };
        }
        grouped[key].items.push({
            zone: fixZoneName(ch.data.regKo),
            tmEf: fullTmEf,
            tmYn: fullTmYn,
            rawTmEf: ch.data.rawTmEf,
            rawTmEd: ch.data.rawTmEd,
            regId: ch.data.regId
        });
    });

    Object.values(grouped).forEach(g => {
        let title = '';
        const warnName = getWarnNameDisplay(g.wrnTp, g.type, g.wrnLvl);

        // [수정] 아이콘 및 제목 형식 개선 (관리자 타임라인과 일치)
        const firstItem = g.items[0];
        const isScheduled = g.type.includes('scheduled') || (firstItem.rawTmEf && firstItem.rawTmEf > g.tmFc);
        const suffix = isScheduled ? ' 예정' : '';

        const isTyphoon = g.wrnTp === '2' || warnName.includes('태풍');
        const iconLvl = g.type.includes('upgrade') ? '🔺' : '🔻';
        const levelIcon = isTyphoon ? '🌀' : iconLvl;

        if (g.type === 'publish') title = `📢 ${warnName} 발표`;
        else if (g.type === 'publish_time_change') title = `🕐 ${warnName} 발효시각 변경`;
        else if (g.type === 'active') title = `🚨 ${warnName} 발효`;
        else if (g.type === 'active_time_change') title = `🕐 ${warnName} 해제시각 변경`;
        else if (g.type === 'release_scheduled') title = `✅ ${warnName} 해제 예정`;
        else if (g.type === 'release') title = `✅ ${warnName} 해제`;
        else if (g.type.includes('upgrade')) title = `${levelIcon} ${warnName}로 격상${suffix}`;
        else if (g.type.includes('downgrade')) title = `${levelIcon} ${warnName}로 격하${suffix}`;
        else title = `🔔 ${warnName} 알림${suffix}`;

        // [핵심 변경] 본문 생성 로직 개선: 시간별로 그룹화하여 출력
        // 1. 시간별 그룹 생성
        const timeGroups = {}; // Key: "Time String", Value: [Zone List]

        g.items.forEach(item => {
            const timeRange = fmtRange(item.tmEf);
            const releaseTime = item.tmYn ? fmtRange(item.tmYn) : '정보 없음';

            // 그룹화 기준이 되는 시간 문자열 결정
            let timeKey = '';
            const actionWord = isScheduled ? '예정' : '부';
            if (g.type === 'publish' || g.type === 'publish_time_change') {
                timeKey = `- 발효예정: ${timeRange}`;
            } else if (g.type.includes('grade')) {
                timeKey = `- ${timeRange}${actionWord}\n  - 해제예정: ${releaseTime}`;
            } else if (g.type === 'active' || g.type === 'active_time_change' || g.type === 'release' || g.type === 'release_scheduled') {
                if (g.type === 'release') timeKey = '';
                else if (g.type === 'release_scheduled') timeKey = `- 해제예정: ${releaseTime}`;
                else timeKey = `- 해제예정: ${releaseTime}`;
            } else {
                timeKey = `- 일시: ${timeRange}`;
            }

            if (!timeGroups[timeKey]) {
                timeGroups[timeKey] = [];
            }
            timeGroups[timeKey].push(item.zone);
        });

        // 2. 그룹별 본문 작성
        let bodyLines = [];
        const state = (typeof lifeCycleManager !== 'undefined' && lifeCycleManager.state) ? lifeCycleManager.state.zones : {};

        // [New] 대구역 - 소구역 계층 구조 파악 (예: 인천·경기남부앞바다 -> [먼평수구역, 북부앞평수구역...])
        const hierarchy = {};
        Object.values(state).forEach(entry => {
            const h = entry.history || [];
            const rawKo = entry.current?.regKo || entry.upcoming?.regKo || (h.length > 0 ? h[0].regKo : null);
            const rKo = fixZoneName(rawKo);
            if (rKo && rKo.includes('중 ')) {
                const [large, sub] = rKo.split('중 ');
                if (!hierarchy[large]) hierarchy[large] = new Set();
                hierarchy[large].add(sub.trim());
            }
        });

        Object.keys(timeGroups).forEach(tKey => {
            const zones = timeGroups[tKey];

            // [New] 축약 로직 적용
            const parentsPresent = new Set();
            const subsByParent = {}; // ParentName -> Set of present sub names

            zones.forEach(z => {
                if (z.includes('중 ')) {
                    const [large, sub] = z.split('중 ');
                    if (!subsByParent[large]) subsByParent[large] = new Set();
                    subsByParent[large].add(sub.trim());
                } else {
                    parentsPresent.add(z);
                }
            });

            const finalZones = []; // Declare finalZones here to be used in scope

            // 1) 대구역이 포함된 경우: 축약 시도
            parentsPresent.forEach(p => {
                const allSubs = hierarchy[p];
                if (allSubs && allSubs.size > 0) {
                    const presentSubs = subsByParent[p] || new Set();
                    const missingSubs = [...allSubs].filter(s => !presentSubs.has(s));

                    if (missingSubs.length === 0) {
                        // 모든 하위 구역이 다 포함됨 -> 대구역만 표시하고 하위 구역 제거 (완전 축약)
                        finalZones.push(p);
                        // 해당 대구역의 하위 구역들은 개별 리스트에 추가하지 않음
                        if (subsByParent[p]) subsByParent[p].forEach(s => processedSubs.add(`${p}중 ${s}`));
                    } else if (presentSubs.size >= (allSubs.size / 2)) {
                        // 과반수 이상 포함 시: "OO앞바다(연안바다 등)" 형식
                        // 단, 너무 길어지면 지저분하므로, 그냥 대구역 + 외 N개 처리하거나 나열
                        // 여기서는 일단 나열하되, UI에서 그룹핑되길 기대함.
                        // 알림 메시지에서는 "OO앞바다(연안바다 외)" 처럼 처리 가능
                        finalZones.push(`${p}(${[...presentSubs].join(',')})`);
                        if (subsByParent[p]) subsByParent[p].forEach(s => processedSubs.add(`${p}중 ${s}`));
                    } else {
                        // 소수만 포함: 대구역 추가
                        finalZones.push(p);
                    }
                } else {
                    // 하위 구역 정보가 없는 일반 대구역
                    finalZones.push(p);
                }
            });

            // 2) 대구역 없이 소구역만 있는 경우 또는 처리되지 않은 소구역 추가
            Object.keys(subsByParent).forEach(p => {
                // 이미 처리된(축약된) 소구역은 건너뜀
                // 여기 로직은 복잡해질 수 있으므로, 단순하게 "대구역이 리스트에 없으면 소구역 나열"로 처리
                if (!parentsPresent.has(p)) {
                    subsByParent[p].forEach(s => finalZones.push(`${p}중 ${s}`));
                } else {
                    // 대구역이 있지만 완전 축약되지 않은 나머지 소구역들 (위 로직 보완 필요)
                    // 현재는 parentsPresent 루프에서 처리했으므로 패스
                }
            });

            // 단순화를 위해 기존 로직 유지 (축약 로직은 추후 고도화)
            // 위 축약 로직은 side-effect가 있을 수 있어, 일단 안전하게 전체 나열로 롤백하되
            // "중 " 문구만 좀 다듬어서 출력
        });


        Object.keys(timeGroups).forEach(tKey => {
            // [Rollback to Simple] 복잡한 축약보다 정확한 전달 우선
            const zones = timeGroups[tKey].map(z => z.replace('중 ', ' '));
            const zoneStr = zones.join(', ');
            if (tKey) {
                bodyLines.push(`${tKey}\n  - ${zoneStr}`);
            } else {
                bodyLines.push(`- ${zoneStr}`);
            }
        });

        const body = bodyLines.join('\n');

        alerts.push({
            title: decodeHtml(title),
            body: decodeHtml(body),
            areaName: g.items.map(i => i.zone).join(','),
            tmRef: g.tmFc,
            data: {
                wrnTp: g.wrnTp,
                wrnLvl: g.wrnLvl,
                type: g.type,
                tmFc: g.tmFc,
                status: 'active', // 탭 이동용
                alertType: warnName,
                tmEf: firstItem.tmEf,
                tmYn: firstItem.tmYn,
                zones: g.items.map(i => i.zone).join(','),
                regIds: g.items.map(i => i.regId).join(',')
            },
            headerTime: firstItem.tmEf // 헤더 표시용 시간
        });
    });

    return alerts;
}

// [LifeCycle] 특보 생애주기 관리자
class LifeCycleManager {
    constructor() {
        this.filePath = path.join(CONFIG.DATA_DIR, 'active_lifecycle.json');
        this.saveFilePath = path.join(CONFIG.DATA_DIR, 'active_lifecycle_save.json');
        this.state = this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
                // zones가 없으면 빈 객체로 초기화
                if (!data.zones) data.zones = {};
                return data;
            }
        } catch (e) {
            log(`⚠️ LifeCycle 로드 실패: ${e.message}`);
        }
        return { updatedAt: '', zones: {} };
    }

    reload() {
        this.state = this.load();
        log('🔄 [LifeCycle] 장부 데이터 재로드 완료 (동기화 반영)');
    }

    save() {
        try {
            this.state.updatedAt = getNowStr();
            fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
        } catch (e) {
            log(`❌ LifeCycle 저장 실패: ${e.message}`);
        }
    }

    /**
     * 영구보존 파일(active_lifecycle_save.json)에 키프레임 추가
     * [NEW] 동일 regId에서 동일 내용이 반복될 경우, 최근 10개만 유지하는 중복 정리 로직 추가
     */
    appendPermanent(regId, regKo, record) {
        try {
            let saveData = { updatedAt: '', events: [] };
            if (fs.existsSync(this.saveFilePath)) {
                try {
                    saveData = JSON.parse(fs.readFileSync(this.saveFilePath, 'utf8'));
                } catch (e) {
                    log(`⚠️ LifeCycle Save 파일 파싱 실패, 새로 시작합니다.`);
                }
            }

            // 새 이벤트 생성
            const newEvent = {
                regId,
                regKo,
                ...record
            };

            // 핵심 비교 키 생성 (wrnTp + wrnLvl + keyframeType)
            const getKey = (evt) => {
                const afso = evt.afso || {};
                return `${evt.regId}|${String(afso.wrnTp || '')}|${String(afso.wrnLvl || '')}|${String(evt.keyframeType || '')}`;
            };

            const newKey = getKey(newEvent);

            // [중복 정리] 동일 regId + 동일 내용 반복 시 최근 10개만 유지
            // 같은 키를 가진 이벤트들만 필터링
            const sameKeyEvents = saveData.events.filter(e => getKey(e) === newKey);

            if (sameKeyEvents.length >= 10) {
                // 10개 이상이면 가장 오래된 동일 키 이벤트 삭제
                const oldestIdx = saveData.events.findIndex(e => getKey(e) === newKey);
                if (oldestIdx !== -1) {
                    saveData.events.splice(oldestIdx, 1);
                    log(`🧹 [LifeCycle] 중복 로그 정리: ${regKo} (${record.keyframeType})`);
                }
            }

            // 이벤트 추가
            saveData.events.push(newEvent);
            saveData.updatedAt = getNowStr();

            // 파일 저장
            fs.writeFileSync(this.saveFilePath, JSON.stringify(saveData, null, 2));
        } catch (e) {
            log(`❌ LifeCycle 영구 저장 실패: ${e.message}`);
        }
    }

    /**
     * 중앙 업데이트 메서드
     * 중앙 업데이트 메서드 (Proactive Audit Mode)
     * AFSO 데이터에 의존하지 않고, 전체 구역 리스트를 기반으로 HUB와 AFSO를 대조하여 생애주기 관리
     */
    update(activeMap, upcomingMap, metData, hubRecords) {
        const nowKst = getCorrectedDate();
        const nowNum = getYMDHM().replace(/[^0-9]/g, '');
        const nowStr = getNowStr();

        // 1. HUB 데이터 사전 매핑 (광역 -> 세부 구역 전파)
        const zoneToHub = {};
        if (Array.isArray(hubRecords) && hubRecords.length > 0) {
            hubRecords.forEach(h => {
                const rawH = h.regKo || '';
                const cleanH = rawH.replace(/[\s·\.]/g, '');
                zoneToHub[cleanH] = h;

                for (const [broadName, children] of Object.entries(BROAD_ZONE_MAPPING)) {
                    if (broadName.replace(/[\s·\.]/g, '') === cleanH) {
                        children.forEach(child => {
                            const cleanC = child.replace(/[\s·\.]/g, '');
                            if (!zoneToHub[cleanC] || getLvlPriority(h.wrnLvl) > getLvlPriority(zoneToHub[cleanC].wrnLvl)) {
                                zoneToHub[cleanC] = h;
                            }
                        });
                    }
                }

                const m = rawH.match(/\(([^)]+)\)/);
                if (m) {
                    const subH = m[1].replace(/[\s·\.]/g, '');
                    zoneToHub[subH] = h;
                }
            });
        }

        // 2. 감사 대상 리스트 구축 (Proactive List)
        const auditNames = new Set();
        Object.entries(ARCHIVE_ZONES).forEach(([parent, subs]) => {
            auditNames.add(parent);
            subs.forEach(s => auditNames.add(s));
        });
        // AFSO에서 현재 들어온 모든 구역명 추가 (ARCHIVE_ZONES 누락 대비)
        Object.values(activeMap).forEach(i => auditNames.add(i.regKo));
        Object.values(upcomingMap).forEach(i => auditNames.add(i.regKo));
        // 장부에 이미 등록된 모든 구역명 추가
        Object.values(this.state.zones).forEach(e => auditNames.add(e.regKo));

        const processedRegIds = new Set();

        // 3. 전구역 루프 조사
        auditNames.forEach(zoneName => {
            // A) regId 및 현재 API 데이터 매칭
            let regId = null;
            let afsoItem = null;

            // AFSO 데이터에서 regId 찾기 (최신성 우선)
            const activeMatch = Object.values(activeMap).find(i => i.regKo === zoneName);
            const upcomingMatch = Object.values(upcomingMap).find(i => i.regKo === zoneName);

            if (activeMatch) { regId = activeMatch.regId; afsoItem = activeMatch; }
            else if (upcomingMatch) { regId = upcomingMatch.regId; afsoItem = upcomingMatch; }

            if (!regId) {
                // 장부에서 과거 regId 이력 조회
                const entry = Object.values(this.state.zones).find(e => e.regKo === zoneName);
                if (entry) regId = entry.regId;
            }

            if (!regId) return; // regId를 알 수 없는 구역은 Lifecycle 관리가 불가능하므로 스킵
            processedRegIds.add(regId);

            // B) HUB 데이터 비교 분석
            let hubInfo = { level: '정보없음', tmEf: '', match: '정보없음' };
            const cleanZ = zoneName.replace(/[\s·\.]/g, '');
            const isCoastalZone = zoneName.includes('연안바다') || zoneName.includes('평수구역') || zoneName.includes('평수구');

            if (isCoastalZone) {
                hubInfo.match = 'AFSO_ONLY';
                hubInfo.level = 'N/A';
            } else {
                const matchingHub = zoneToHub[cleanZ];
                if (matchingHub) {
                    hubInfo.level = matchingHub.wrnLvl;
                    hubInfo.tmEf = matchingHub.tmEf;
                    hubInfo.regKo = matchingHub.regKo;
                    const hubPrio = getLvlPriority(matchingHub.wrnLvl);
                    const afsoPrio = afsoItem ? getLvlPriority(afsoItem.wrnLvl) : 0;

                    if (hubPrio === afsoPrio) hubInfo.match = 'MATCH';
                    else if (hubPrio > afsoPrio) hubInfo.match = 'UPGRADE_DELAY';
                    else hubInfo.match = 'DOWNGRADE_DELAY';
                } else if (hubRecords && hubRecords.length > 0) {
                    // HUB에 정보가 없는데 AFSO에만 있는 경우 (GHOST)
                    if (afsoItem) hubInfo.match = 'GHOST';
                    else return; // 둘 다 없으면 건너뜀 (평시 상태)
                } else if (afsoItem) {
                    hubInfo.match = '정보없음'; // HUB 수집 실패 시
                } else {
                    return; // 둘 다 정보 없음
                }
            }

            // C) AFSO 누락 감지 (Proactive MISSING Logic)
            if (!afsoItem && hubInfo.level !== '정보없음' && hubInfo.level !== 'N/A') {
                hubInfo.match = 'MISSING';
            }

            // D) 장부 업데이트 및 Keyframe 판단
            let entry = this.state.zones[regId];
            if (!entry) {
                entry = { regId, regKo: zoneName, summary: null, current: null, upcoming: null, history: [] };
                this.state.zones[regId] = entry;
            }

            const lastHist = entry.history.length > 0 ? entry.history[entry.history.length - 1] : null;
            let isKeyframe = false;
            let keyframeType = null;

            if (!lastHist) {
                isKeyframe = true;
                keyframeType = hubInfo.match === 'MISSING' ? 'AFSO누락감지' : '발표';
            } else {
                const prevWrnLvl = String(lastHist.afso?.wrnLvl || '');
                const currWrnLvl = String(afsoItem?.wrnLvl || '');
                const prevMatch = String(lastHist.hub?.match || '정보없음');
                const currMatch = String(hubInfo.match);

                // 1. 특보 등급 변경 감지
                if (currWrnLvl !== '' && prevWrnLvl !== currWrnLvl) {
                    isKeyframe = true;
                    if (prevWrnLvl === '') keyframeType = '발표';
                    else {
                        const prevPrio = getLvlPriority(prevWrnLvl);
                        const currPrio = getLvlPriority(currWrnLvl);
                        keyframeType = currPrio > prevPrio ? '격상' : '격하';
                    }
                }
                // 2. 불일치 상태 변경 감지 (Mismatch Start/End)
                // MATCH <-> UPGRADE_DELAY, MATCH <-> MISSING 등 모든 대조 상태 변화 기록
                if (prevMatch !== currMatch && currMatch !== '정보없음' && currMatch !== 'AFSO_ONLY') {
                    isKeyframe = true;
                    // 가독성을 위해 상태 변경 명시
                    keyframeType = `대조상태변경(${currMatch})`;
                }
                // 3. 해제 예정 정보 변경 감지
                const prevTmYn = String(lastHist.afso?.tmYn || '');
                const currTmYn = String(afsoItem?.tmYn || '');
                if (currTmYn !== '' && prevTmYn !== currTmYn && currTmYn !== '정보 없음') {
                    isKeyframe = true;
                    keyframeType = keyframeType || '해제예정변경';
                }
            }

            const newHistoryEntry = {
                timestamp: nowStr,
                afso: afsoItem ? {
                    wrnTp: afsoItem.wrnTp, wrnLvl: afsoItem.wrnLvl, tmFc: afsoItem.tmFc,
                    tmEf: afsoItem.tmEf, tmYn: afsoItem.tmYn, command: afsoItem.command,
                    rawTmEf: afsoItem.rawTmEf, rawTmEd: afsoItem.rawTmEd
                } : null,
                hub: hubInfo,
                isKeyframe,
                keyframeType
            };

            entry.history.push(newHistoryEntry);
            if (isKeyframe) this.appendPermanent(regId, entry.regKo, newHistoryEntry);

            // 히스토리 길이 제한 (100건)
            while (entry.history.length > 100) {
                const nonKeyframeIdx = entry.history.findIndex(h => !h.isKeyframe);
                if (nonKeyframeIdx !== -1) entry.history.splice(nonKeyframeIdx, 1);
                else entry.history.shift();
            }

            // 요약 요약 업데이트
            entry.summary = {
                updatedAt: nowStr,
                afsoStatus: afsoItem ? { wrnTp: afsoItem.wrnTp, wrnLvl: afsoItem.wrnLvl, tmEf: afsoItem.tmEf, tmYn: afsoItem.tmYn || '정보 없음' } : null,
                hubStatus: { wrnLvl: hubInfo.level, tmEf: hubInfo.tmEf, regKo: hubInfo.regKo || '' },
                matchStatus: hubInfo.match,
                historyCount: entry.history.length,
                keyframeCount: entry.history.filter(h => h.isKeyframe).length
            };

            // 상태 슬롯 업데이트 (Current / Upcoming)
            if (afsoItem) {
                const isFuture = afsoItem.rawTmEf && afsoItem.rawTmEf > nowNum;
                if (isFuture) {
                    // 미래 발효 예정인 데이터
                    entry.upcoming = { ...afsoItem, status: 'publish' };
                } else {
                    // 현재 발효 중인 데이터 (Current)
                    const prevCurrentLvl = entry.current ? entry.current.wrnLvl : null;
                    entry.current = { ...afsoItem, status: 'active' };

                    // [로직] Upcoming에 있던 예보가 발효 시각이 되어 Current로 넘어온 경우, Upcoming 슬롯 비우기
                    if (entry.upcoming && entry.upcoming.rawTmEf <= nowNum) {
                        // 예정되어 있던 그 특보가 맞다면 삭제
                        if (entry.upcoming.wrnLvl === entry.current.wrnLvl) {
                            entry.upcoming = null;
                        }
                    }
                }
            }
            else {
                // AFSO에서 사라진 경우, MISSING 상태가 아니라면(완전 해제라면) 소멸 루틴 대기
            }
        });

        // 4. 소멸/해제 처리 (장부에만 남아있는 구역들)
        Object.keys(this.state.zones).forEach(regId => {
            if (processedRegIds.has(regId)) return; // 위 루프에서 이미 처리됨

            const entry = this.state.zones[regId];
            const currentStatus = entry.current;
            let releaseTime = currentStatus ? currentStatus.rawTmEd : '';
            const isExpired = releaseTime && releaseTime <= nowNum;
            const isUnknownExpiration = !releaseTime;

            if (isExpired || isUnknownExpiration) {
                // 완전히 종료됨 -> 영구 보존용 해제 로그 기록 후 장부에서 제거
                this.appendPermanent(regId, entry.regKo, {
                    timestamp: nowStr,
                    afso: null,
                    hub: { level: '해제', match: 'MATCH' },
                    isKeyframe: true,
                    keyframeType: '해제'
                });

                // [종속 해제 정책] 메인 해역 해제 시 하위 구역(연안바다/평수구역) 동시 해제
                const childZoneNames = ARCHIVE_ZONES[entry.regKo] || [];
                if (childZoneNames.length > 0) {
                    log(`🔗 [LifeCycle] 메인해역 ${entry.regKo} 해제에 따른 하위구역 ${childZoneNames.length}개 동시 해제 검토`);
                    for (const [childId, childEntry] of Object.entries(this.state.zones)) {
                        if (childZoneNames.includes(childEntry.regKo)) {
                            this.appendPermanent(childId, childEntry.regKo, {
                                timestamp: nowStr,
                                isKeyframe: true,
                                keyframeType: '해제(메인종속)',
                                afso: childEntry.current ? { ...childEntry.current, command: '해제' } : { command: '해제' },
                                hub: { match: 'RELEASE_COUPLED' }
                            });
                            delete this.state.zones[childId];
                            log(`   └─ 🔗 [Coupled Release] ${childEntry.regKo}`);
                        }
                    }
                }
                delete this.state.zones[regId];
            }
        });

        this.save();
    }

    // Index 페이지용 데이터(warnings.json) 생성
    getWarningsJson() {
        const metData = [];

        Object.values(this.state.zones).forEach(entry => {
            // [사용자 원칙] 표출 우선순위 제어 (격상 예고 시 뱃지 강등 방지)
            // 1순위: 현재 발효 중인 특보(Current)가 있다면 무조건 이를 뱃지로 사용 (격상 발표가 있어도 주의보 유지)
            // 2순위: 발효 중인 특보가 없을 때만 예정(Upcoming) 정보를 사용하여 뱃지(예비) 표출
            const target = entry.current || entry.upcoming;

            if (target) {
                // 기존 API 포맷(metData)과 호환되도록 변환
                metData.push({
                    regId: target.regId,
                    regKo: target.regKo,
                    wrnTp: target.wrnTp,
                    wrnLvl: target.wrnLvl,
                    tmFc: target.tmFc,
                    tmEf: target.tmEf,
                    tmEd: target.tmYn, // 화면 표시용 해제예정 텍스트

                    // [New] 부가 정보 (프론트에서 활용 가능)
                    _lifecycle: {
                        isCurrent: !!entry.current, // 현재 발효 중인지 여부
                        upcoming: entry.upcoming ? {
                            wrnLvl: entry.upcoming.wrnLvl,
                            tmEf: entry.upcoming.tmEf
                        } : null
                    }
                });
            }
        });

        return { metData };
    }
}

const lifeCycleManager = new LifeCycleManager();


function getWarnNameDisplay(name, type, level) {
    if (!name) return '기상특보';
    const lvlText = level || '주의보';
    let cleanName = name.trim();

    // 1. 발표(예비) 단계인 경우
    if (type === 'publish') {
        const baseName = cleanName.replace(/주의보|경보|예비특보|예비/g, '').trim();
        return `${baseName}${lvlText}`;
    }

    // 2. 발효/해제/변경 단계인 경우
    // 이름에 주의보/경보가 없으면 level을 붙임
    if (!cleanName.includes('주의보') && !cleanName.includes('경보') && !cleanName.includes('예비')) {
        return `${cleanName}${lvlText}`;
    }

    return cleanName;
}

/**
 * [Sync] Fly.io 서버에서 기상특보 생애주기 데이터를 동기화
 * 로컬 PC 가동 시, 24시간 깨어있는 서버의 최신 데이터를 가져와 공백을 메움
 */
async function syncWithServer() {
    if (process.env.FLY_ALLOC_ID) return; // 서버(Fly.io)에서는 동기화하지 않음

    log('☁️ [Sync] Fly.io 서버에서 최신 생애주기 데이터 동기화 시도...');
    const baseUrl = 'https://seagnal-server.fly.dev/api';
    const files = [
        { name: 'active_lifecycle.json', endpoint: '/active-lifecycle' },
        { name: 'active_lifecycle_save.json', endpoint: '/active-lifecycle-save' }
    ];

    let successCount = 0;
    for (const file of files) {
        try {
            const res = await fetchWithTimeout(baseUrl + file.endpoint, {}, 8000);
            if (res.ok) {
                const data = await res.json();
                const filePath = path.join(CONFIG.DATA_DIR, file.name);
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
                log(`✅ [Sync] ${file.name} 동기화 완료`);
                successCount++;
            } else {
                log(`⚠️ [Sync] ${file.name} 동기화 건너뜀 (HTTP ${res.status})`);
            }
        } catch (e) {
            log(`❌ [Sync] ${file.name} 동기화 중 오류: ${e.message}`);
        }
    }

    if (successCount > 0 && typeof lifeCycleManager !== 'undefined') {
        lifeCycleManager.reload();
    }
}

function buildZoneList(zones) {
    // 중복 제거 및 정렬
    const unique = Array.from(new Set(zones)).sort();
    const list = unique.join(', ');
    if (list.length > 300) { // 너무 길면 생략
        const sub = list.substring(0, 300);
        return `${sub}... 외 ${unique.length}개 구역`;
    }
    return list;
}

const fmtRange = (t) => {
    if (!t) return '미정';
    const nums = t.replace(/[^0-9]/g, '');
    if (nums.length < 10) return t;

    const mm = nums.substring(4, 6);
    const dd = nums.substring(6, 8);
    if (dd === '00' || dd === '0') return '정보 없음';
    const hh = parseInt(nums.substring(8, 10));
    const min = nums.substring(10, 12) || '00';

    // [핵심 변경] 정확한 시각이 있으면 우선 출력, 모호한 경우 범위를 출력
    if (min === '00' || min === '30' || (parseInt(min) % 5 === 0 && min !== '55')) {
        let ampm = hh < 12 ? '오전' : '오후';
        let hour12 = hh === 0 ? 12 : (hh > 12 ? hh - 12 : hh);
        let result = `${mm}/${dd} ${ampm} ${hour12}시`;
        if (min !== '00') result += ` ${parseInt(min)}분`;
        return result;
    }

    // 범위 출력 (기상청 특수 지칭 시각)
    let range = "";
    if (hh >= 0 && hh < 6) range = "새벽(00시~06시)";
    else if (hh >= 6 && hh < 12) range = "오전(06시~12시)";
    else if (hh >= 12 && hh < 18) range = "오후(12시~18시)";
    else range = "밤(18시~24시)";
    return `${mm}/${dd} ${range}`;
};

// [Helper] 두 시각(YYYYMMDDHHmm) 사이의 분(minute) 차이 계산 (t2 - t1)
function getDiffMinutes(t1Str, t2Str) {
    if (!t1Str || !t2Str || t1Str.length < 12 || t2Str.length < 12) return 0;

    // YYYYMMDDHHmm -> Date Object
    const parse = (s) => new Date(
        s.substring(0, 4), s.substring(4, 6) - 1, s.substring(6, 8),
        s.substring(8, 10), s.substring(10, 12)
    );

    const d1 = parse(t1Str);
    const d2 = parse(t2Str);

    const diffMs = d2 - d1;
    return Math.floor(diffMs / 60000);
}


// 1-1. HUB 특보만 수집 (수동)
async function collectWarningsHub() {
    try {
        const kmaUrl = `${CONFIG.URLS.KMA_WARNING}?disp=0&help=0&stn_id=0&authKey=${CONFIG.KMA_HUB_KEY}`;
        const kmaRes = await fetchWithRetry(kmaUrl);
        const kmaArrayBuffer = await kmaRes.arrayBuffer();
        const kmaBase64 = 'BASE64:' + Buffer.from(kmaArrayBuffer).toString('base64');

        let existing = {};
        try {
            existing = JSON.parse(fs.readFileSync(path.join(CONFIG.DATA_DIR, 'warnings.json'), 'utf8'));
        } catch (e) { }
        existing.kma = kmaBase64;
        existing.updatedAt = getNowStr();
        saveData('warnings.json', existing);

        lastRunStatus.warnings_hub = { lastRun: getNowStr(), status: '성공', message: 'HUB 데이터 수집 완료' };
        log('✅ HUB 특보 수동 수집 완료');
    } catch (e) {
        lastRunStatus.warnings_hub = { lastRun: getNowStr(), status: '실패', message: e.message };
        throw e;
    }
}

// 1-2. AFSO 특보만 수집 (수동)
async function collectWarningsAfso() {
    await collectWarnings(); // 통합 로직 사용
}

// 2. 부이 수집
async function collectBuoys() {
    try {
        const url = `${CONFIG.URLS.BUOY}?stn=0&help=0&authKey=${CONFIG.KMA_HUB_KEY}`;
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        const text = new TextDecoder('euc-kr').decode(buffer);
        saveData('buoys.json', { updatedAt: getNowStr(), raw: text });
        lastRunStatus.buoys = { lastRun: getNowStr(), status: '성공', message: '데이터 저장 완료' };
    } catch (e) {
        lastRunStatus.buoys = { lastRun: getNowStr(), status: '실패', message: e.message };
    }
}

// 3. 기상예보
const SEA_FORECAST_ZONES = [
    '12B10304', '12B10302', '12B10301', '12B10303', '12B10300', '12B10400',
    '12A20101', '12A20102', '12A20103', '12A20104', '12A20100', '12A20200',
    '12A30100', '12A30200', '12A10100', '12A10200',
    '12B10101', '12B10102', '12B10100', '12B10200',
    '12B20101', '12B20102', '12B20103', '12B20104', '12B20100', '12B20200',
    '12C10101', '12C10102', '12C10103', '12C10100', '12C10200',
    '12C20101', '12C20102', '12C20103', '12C20100', '12C20200',
    '12C30100', '12C30200',
    // [New] 서해남부 앞바다 (전북/전남) - 사용자 확인 코드
    '22A30101', '22A30102', '22A30103', '22A30104', '22A30105'
];
async function collectGeneralForecasts() {
    try {
        const results = {};
        for (const regId of SEA_FORECAST_ZONES) {
            const url = `https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstMsgService/getSeaFcst?pageNo=1&numOfRows=30&dataType=JSON&regId=${regId}&authKey=${CONFIG.KMA_HUB_KEY}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.response?.body?.items?.item) {
                results[regId] = Array.isArray(data.response.body.items.item) ? data.response.body.items.item : [data.response.body.items.item];
            }
            await new Promise(r => setTimeout(r, 50));
        }
        saveData('general_forecasts.json', { updatedAt: getNowStr(), data: results, count: Object.keys(results).length });
        lastRunStatus.general = { lastRun: getNowStr(), status: '성공', message: `${Object.keys(results).length}개 구역 저장` };
    } catch (e) {
        lastRunStatus.general = { lastRun: getNowStr(), status: '실패', message: e.message };
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

            for (let h = 0; h <= 75; h += 3) {
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
        lastRunStatus.zone = { lastRun: getNowStr(), status: '실패', message: e.message };
    } finally { isCollectingZone = false; }
}


async function init() {
    // [중요] 외부 서버와 시각 동기화 (오차 보정)
    await syncTime();

    // [New] Fly.io 서버와 데이터 동기화 (로컬 PC 공백 메우기)
    await syncWithServer();

    log('🚀 스케줄러 가동 (New State-Based Logic)');
    log('📡 모든 API 데이터 수집 시작...');

    updateDuckDNS();

    const startTime = Date.now();

    try {
        await collectWarnings();
        log('✅ 특보 데이터 수집 완료');

        log('📡 나머지 데이터(부이/예보) 수집 시작...');
        await Promise.all([
            collectBuoys().then(() => log('✅ 부이 데이터 수집 완료')),
            collectGeneralForecasts().then(() => log('✅ 일반예보 데이터 수집 완료')),
            collectZoneForecasts().then(() => log('✅ 해구별 예보 데이터 수집 완료'))
        ]);
    } catch (e) {
        log(`⚠️ 일부 수집 중 오류: ${e.message}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`🎉 모든 데이터 수집 완료! (소요시간: ${elapsed}초)`);

    setInterval(updateDuckDNS, 30 * 60 * 1000);
    setInterval(async () => {
        await syncTime();
        const now = getCorrectedDate();
        const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        log(`⏰ [Scheduler] 1분 주기 작업 (State-Based) 시작 (시각: ${hm})`);

        collectWarnings(); // 핵심!

        if (now.getMinutes() % 30 === 5) collectBuoys();
        if (['05:15', '17:15'].includes(hm)) collectGeneralForecasts();
        if (['02:00', '08:00', '14:00', '20:00'].includes(hm)) collectZoneForecasts();

        if (process.env.FLY_ALLOC_ID) {
            fetch('https://seagnal-server.fly.dev/api/health').catch(() => { });
        }
    }, 60000);
}

init();

module.exports = {
    collectWarnings,
    collectBuoys,
    collectGeneralForecasts,
    collectZoneForecasts,
    getStatus: () => lastRunStatus,
    getConfig: () => ({
        KMA_HUB_KEY: CONFIG.KMA_HUB_KEY,
        AFSO_KEY: CONFIG.AFSO_KEY,
        USE_HUB_RELEASE: CONFIG.USE_HUB_RELEASE
    }),
    updateConfig: saveApiConfig
};
