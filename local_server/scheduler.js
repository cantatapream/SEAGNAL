const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const https = require('https');
const iconv = require('iconv-lite');

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
    USE_HUB_RELEASE: false, // [NEW] HUB 하이브리드 해제 활성화 여부
    DATA_DIR: path.join(__dirname, 'data'),
    URLS: {
        KMA_WARNING: 'https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php',
        KMA_OVERALL: 'https://www.weather.go.kr/w/wnuri-fct2021/weather/warning.do', // [NEW] 연안바다/평수구역 크롤링용
        BUOY: 'https://apihub.kma.go.kr/api/typ01/url/sea_obs.php',
        SEA_FORECAST: 'https://apihub.kma.go.kr/api/typ01/url/fct_afs_dl.php',
        SEA_ZONE_LARGE: 'https://apihub.kma.go.kr/api/typ06/url/marine_large_zone.php'
    }
};

// [NEW] 자식->부모 역방향 매핑 테이블 생성 (Inheritance용)
const CHILD_TO_PARENT = {};
// ARCHIVE_ZONES를 순회하며 역매핑 생성
setTimeout(() => {
    Object.entries(ARCHIVE_ZONES).forEach(([parent, children]) => {
        children.forEach(child => {
            CHILD_TO_PARENT[child.replace(/[\s·\.]/g, '')] = parent;
        });
    });
}, 0);

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
            // [Safety] activeInfo가 없는 경우(delete 누락 등) 대비
            if (!activeInfo) continue;
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
        if (typeof newConfig.USE_HUB_RELEASE === 'boolean') CONFIG.USE_HUB_RELEASE = newConfig.USE_HUB_RELEASE;

        fs.writeFileSync(CONFIG_FILE, JSON.stringify({
            KMA_HUB_KEY: CONFIG.KMA_HUB_KEY,
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
    // [Fix] Intl/Locale를 사용하여 타임존에 상관없이 항상 정확한 YYYYMMDDHHmm(KST) 추출
    // sv-SE(스웨덴) 로케일은 YYYY-MM-DD HH:mm:ss 형식을 제공하여 파싱이 용이함
    const kstStr = now.toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
    return kstStr.replace(/[^0-9]/g, '').substring(0, 12);
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

/**
 * [NEW] 기상청 웹페이지에서 연안바다 특보 상황 크롤링
 * AFSO API 누락 시 실제 해제 여부를 교차 검토하기 위함
 */
async function fetchCoastalAlerts() {
    try {
        const url = CONFIG.URLS.KMA_OVERALL;
        const res = await fetchWithRetry(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });
        const html = await res.text();

        // <특정관리해역 평수구역/연안바다 특보사항> 전체 섹션 추출을 위해 상위 키워드 사용
        const startTag = '특정관리해역';
        const endTag = '참고사항';
        const endTagAlt = '참고사사항'; // 기상청 오타 대응

        let startIdx = html.indexOf(startTag);
        if (startIdx === -1) return "";

        const section = html.substring(startIdx);
        let endIdx = section.indexOf(endTag);
        if (endIdx === -1) endIdx = section.indexOf(endTagAlt);

        const targetText = endIdx !== -1 ? section.substring(0, endIdx) : section;

        // HTML 태그 제거 및 공백 정규화
        const cleanText = targetText.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

        log(`🌐 연안바다/평수구역 크롤링 성공 (길이: ${cleanText.length})`);
        return cleanText;
    } catch (e) {
        log(`❌ 연안바다/평수구역 크롤링 실패: ${e.message}`);
        return "";
    }
}

// 1. 특보 수집 (통합) - **장부 기반 신규 로직**
// 1. 특보 수집 (통합) - **히스토리 기반 상태 관리 (History-Based State Machine)**
// [Phase 1-6] HUB 중심의 하이브리드 수집 로직 (AFSO 제거됨)
// [Phase 1-6] HUB 중심의 하이브리드 수집 로직 (AFSO 제거됨)
async function collectWarnings() {
    const nowStr = getNowStr();
    const nowNum = getYMDHM(); // YYYYMMDDHHmm
    log(`🔄 [HUB-Only] 특보 수집 시작 (KST: ${nowStr})`);

    let activeMap = {};   // 현재 발효 중인 특보 (부모 + 자식 상속)
    let upcomingMap = {}; // 예비 특보 (HUB에서 제공 시)
    let metData = [];     // 최종 리스트 (레거시 호환용)
    let hubRawData = [];  // HUB 원본 파싱 데이터

    // 1. HUB API 호출 (메인 데이터 소스)
    let hubBuffer = null;
    try {
        const kmaUrl = `${CONFIG.URLS.KMA_WARNING}?disp=0&help=0&stn_id=0&authKey=${CONFIG.KMA_HUB_KEY}`;
        const kmaRes = await fetchWithRetry(kmaUrl);
        const kmaArrayBuffer = await kmaRes.arrayBuffer();
        hubBuffer = Buffer.from(kmaArrayBuffer);

        lastRunStatus.warnings_hub = { lastRun: getNowStr(), status: '성공', message: 'HUB 수집 완료' };

        // EUC-KR 디코딩 및 파싱
        const decodedText = iconv.decode(hubBuffer, 'euc-kr');
        hubRawData = parseHubTextNew(decodedText); // 파싱 헬퍼 호출

    } catch (e) {
        lastRunStatus.warnings_hub = { lastRun: getNowStr(), status: '실패', message: e.message };
        log(`❌ HUB 수집 실패: ${e.message}`);
        return; // 메인 소스 실패 시 중단
    }

    // 2. 연안바다 크롤링 (자식 구역 활성 여부 확인용)
    // 기상청 특보 페이지에서 현재 떠있는 특보 텍스트를 가져옴
    let coastalZoneNames = new Set();
    try {
        const coastalAlertsBaseStr = await fetchCoastalAlerts(); // 기존 함수 재활용
        // 텍스트에서 구역명 추출 (단순 포함 여부 확인을 위해 정제)
        const cleanStr = coastalAlertsBaseStr.replace(/[\s·\.]/g, '');

        // CHILD_TO_PARENT 키(정제된 구역명)를 순회하며 크롤링된 텍스트에 포함되어 있는지 확인
        Object.keys(CHILD_TO_PARENT).forEach(childCleanName => {
            if (cleanStr.includes(childCleanName)) {
                coastalZoneNames.add(childCleanName);
            }
        });
        log(`🌐 연안바다 크롤링: ${coastalZoneNames.size}개 구역 감지`);
    } catch (e) {
        log(`⚠️ 연안바다 크롤링 실패: ${e.message}`);
    }

    // 3. 데이터 처리 및 상속 로직 (Inheritance Engine)
    const nowYMDHM = getYMDHM();

    hubRawData.forEach(item => {
        // [Filter] 사용자 요청: 해상 관련 특보만 표출 (풍랑, 태풍, 지진해일, 폭풍해일)
        // 그 외(강풍, 호우, 대설, 건조, 한파 등)는 제외
        const ALLOWED_TYPES = ['풍랑', '태풍', '지진해일', '폭풍해일'];
        if (!item.wrnTp || !ALLOWED_TYPES.some(t => item.wrnTp.includes(t))) return;

        // 3-1. 메인 해역(Parent) 처리
        if (!item.wrnTp || !item.wrnLvl) return;

        // 특보 레벨이 '해제'가 아닌 경우만 활성으로 간주
        if (item.command === '해제' || item.wrnLvl === '해제') return;

        // 현재 시각보다 먼 미래의 발효는 upcoming으로, 아니면 active로
        const isFuture = (item.tmEf > nowYMDHM);

        const alertObj = {
            regId: item.regId,
            regKo: item.regKo,
            wrnTp: item.wrnTp,
            wrnLvl: item.wrnLvl,
            tmFc: item.tmFc,
            tmEf: item.tmEf,
            tmYn: item.tmYn, // 해제예고시각 (있다면)
            img: '', // HUB는 이미지 없음 (AFSO Legacy)
            isCoastal: false,
            source: 'HUB'
        };

        if (isFuture) {
            upcomingMap[item.regId] = alertObj;
        } else {
            activeMap[item.regId] = alertObj;
        }

        // 3-2. 자식 구역(Coastal) 상속 처리
        const parentName = item.regKo.replace(/[\s·\.]/g, '');

        // 이 부모에 속한 자식들 찾기
        const relevantChildren = Object.entries(CHILD_TO_PARENT)
            .filter(([childClean, pName]) => pName.replace(/[\s·\.]/g, '') === parentName)
            .map(([childClean]) => childClean);

        relevantChildren.forEach(childClean => {
            if (coastalZoneNames.has(childClean)) {
                let originalChildName = childClean;
                const parentKey = Object.keys(ARCHIVE_ZONES).find(k => k.replace(/[\s·\.]/g, '') === parentName);
                if (parentKey && ARCHIVE_ZONES[parentKey]) {
                    const found = ARCHIVE_ZONES[parentKey].find(c => c.replace(/[\s·\.]/g, '') === childClean);
                    if (found) originalChildName = found;
                }

                const childId = `${item.regId}_SUB_${childClean}`;

                const childAlert = {
                    ...alertObj, // 부모 속성 복사
                    regId: childId,
                    regKo: originalChildName,
                    parentRegId: item.regId,   // 부모 ID 저장
                    parentRegKo: item.regKo,   // 부모 이름 저장
                    isCoastal: true,
                    source: 'INHERIT'
                };

                if (isFuture) {
                    upcomingMap[childId] = childAlert;
                } else {
                    activeMap[childId] = childAlert;
                }
            }
        });
    });

    // 4. 통합 리스트 생성 (metData)
    const allAlerts = [...Object.values(activeMap), ...Object.values(upcomingMap)];
    metData = allAlerts;

    // 5. LifeCycle Manager 업데이트 (Hub 전용)
    const changes = lifeCycleManager.updateHubOnly(activeMap, upcomingMap, metData);

    // 6. 알림 발송
    if (changes && changes.length > 0) {
        log(`🚀 [HUB] 상태 변경 감지: ${changes.length}건`);
        sendPushAlert(changes);
    }

    // 7. 결과 저장 (warnings.json)
    const afsoJsonWrapper = {
        metData: metData.map(d => ({
            regId: d.regId,
            regKo: d.regKo,
            wrnTp: d.wrnTp,
            wrnLvl: d.wrnLvl,
            tmFc: d.tmFc,
            tmEf: d.tmEf,
            tmEd: d.tmYn,
            wrnCmd: d.wrnLvl,
            _lifecycle: { isCurrent: true }
        }))
    };

    saveData('warnings.json', {
        updatedAt: getNowStr(),
        kma: 'HUB_ONLY_MODE',
        afso: { metData: [] } // 호환성 유지
    });

    lastRunStatus.warnings = { lastRun: getNowStr(), status: '성공', message: `통합 ${metData.length}건 저장` };
    log(`✅ 수집 완료: 총 ${metData.length}건`);
}

// [Helper] HUB 텍스트 파싱 함수 (개선됨)
function parseHubTextNew(text) {
    const lines = text.split('\n');
    const results = [];

    lines.forEach(line => {
        if (!line.trim() || line.startsWith('#')) return;

        const parts = line.split(',').map(s => s.trim());
        if (parts.length < 8) return;

        // 날짜 형식(20YYMMDDHHmm)을 찾아 기준점 잡기
        let tmFcIdx = -1;
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].length === 12 && parts[i].startsWith('20')) {
                tmFcIdx = i;
                break;
            }
        }

        if (tmFcIdx === -1) return;

        const regId = parts[tmFcIdx - 2];
        const regKo = parts[tmFcIdx - 1];
        const tmFc = parts[tmFcIdx];
        const tmEf = parts[tmFcIdx + 1];
        const wrnTp = parts[tmFcIdx + 2];
        const wrnLvl = parts[tmFcIdx + 3];
        const command = parts[tmFcIdx + 4];

        // [Fix] 해제 예고(tmYn) 파싱
        // command 뒤쪽 필드에서 날짜/시간 패턴("일", "시", ":")이 있는 문자열 탐색
        let tmYn = '';
        if (parts.length > tmFcIdx + 5) {
            // 우선 바로 뒷 필드를 확인
            const cand = parts[tmFcIdx + 5];
            if (cand && (cand.includes('일') || cand.includes('시') || cand.includes(':'))) {
                tmYn = cand;
            } else {
                // 바로 뒤가 아니라면 그 뒤들도 스캔 (혹시 모를 공백 필드 대응)
                for (let k = tmFcIdx + 5; k < parts.length; k++) {
                    if (parts[k] && (parts[k].includes('일') || parts[k].includes('시') || parts[k].includes(':'))) {
                        tmYn = parts[k];
                        break;
                    }
                }
            }
        }

        results.push({
            regId,
            regKo,
            tmFc,
            tmEf,
            wrnTp,
            wrnLvl,
            command,
            tmYn: tmYn
        });
    });
    return results;
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
        // 부모와 자식이 같은 발효 시각을 공유하므로(Inheritance), 이 키를 통해 하나로 묶임
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

        // [USER REQUEST] 단독 자식 구역일 경우 "부모중 자식" 형식 적용
        let displayZone = fixZoneName(ch.data.regKo);
        if (ch.data.isCoastal && ch.data.parentRegKo) {
            const pKo = ch.data.parentRegKo;
            // 부모 이름이 이미 포함되어 있는지 체크 (중복 방지)
            if (!displayZone.includes(pKo)) {
                displayZone = `${pKo}중 ${displayZone}`;
            }
        }

        grouped[key].items.push({
            zone: displayZone,
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

        // [핵심 변경] 본문 생성 로직: 부모 중심 요약 (Parent-Centric Summarization)
        const timeGroups = {};
        g.items.forEach(item => {
            const timeRange = fmtRange(item.tmEf);
            const releaseTime = item.tmYn ? fmtRange(item.tmYn) : '정보 없음';

            let timeLabel = '';
            if (g.type === 'publish' || g.type === 'publish_time_change') {
                timeLabel = `발효예정: ${timeRange}`;
            } else if (g.type.includes('grade')) {
                const action = g.type.includes('upgrade') ? '격상' : '격하';
                timeLabel = `${timeRange}부 ${action} / 해제예정: ${releaseTime}`;
            } else if (g.type === 'active' || g.type === 'active_time_change' || g.type === 'release_scheduled') {
                timeLabel = `해제예정: ${releaseTime}`;
            } else if (g.type === 'release') {
                timeLabel = '';
            } else {
                timeLabel = `일시: ${timeRange}`;
            }

            if (!timeGroups[timeLabel]) timeGroups[timeLabel] = {};

            // 변경된 데이터에서 부모 정보를 찾음
            const ch = changes.find(c => c.data.regId === item.regId);
            const pName = (ch && ch.data.parentRegKo) ? ch.data.parentRegKo : item.zone;

            if (!timeGroups[timeLabel][pName]) {
                timeGroups[timeLabel][pName] = { items: [] };
            }
            timeGroups[timeLabel][pName].items.push(ch ? ch.data : item);
        });

        let bodyLines = [];
        Object.entries(timeGroups).forEach(([label, parentMap]) => {
            const displayZones = [];

            Object.entries(parentMap).forEach(([pName, pGroup]) => {
                const parentItemInGroup = pGroup.items.find(it => !it.isCoastal);
                const childrenInGroup = pGroup.items.filter(it => it.isCoastal);

                const allExpectedChildren = ARCHIVE_ZONES[pName] || [];

                if (parentItemInGroup) {
                    // 1. 부모가 포함된 경우 (초기 발표/해제 등)
                    const missingChildren = allExpectedChildren.filter(expected =>
                        !childrenInGroup.some(it => it.regKo.replace(/[\s·\.]/g, '') === expected.replace(/[\s·\.]/g, ''))
                    );

                    if (missingChildren.length === 0) {
                        // 자식까지 100% 다 포함됨 -> 부모 이름만 노출
                        displayZones.push(pName);
                    } else {
                        // 일부 자식 제외 -> "부모(자식A, 자식B 제외)" 형식
                        const shortMissingNames = missingChildren.map(m => m.replace(pName, '').replace('중', '').trim());
                        displayZones.push(`${pName}(${shortMissingNames.join(', ')} 제외)`);
                    }
                } else {
                    // 2. 자식들만 포함된 경우 (증분 추가/해제 등)
                    const shortNames = childrenInGroup.map(it => it.regKo.replace(pName, '').replace('중', '').trim());
                    displayZones.push(`${pName}중 ${shortNames.join(', ')}`);
                }
            });

            if (displayZones.length > 0) {
                bodyLines.push(`ㅇ ${displayZones.join(', ')}`);
                if (label) bodyLines.push(`  - ${label}`);
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
                status: g.type, // [Fix] 하드코딩된 'active' 제거 -> 실제 타입(release 등) 전달
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
     * 중앙 업데이트 메서드 (Proactive Audit Mode)
     * AFSO 데이터에 의존하지 않고, 전체 구역 리스트를 기반으로 HUB와 AFSO를 대조하여 생애주기 관리
     */
    update(activeMap, upcomingMap, metData, hubRecords, coastalAlertsBaseStr = "") {
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
        Object.values(activeMap).forEach(i => i && i.regKo && auditNames.add(i.regKo));
        Object.values(upcomingMap).forEach(i => i && i.regKo && auditNames.add(i.regKo));
        // 장부에 이미 등록된 모든 구역명 추가
        Object.values(this.state.zones).forEach(e => e && e.regKo && auditNames.add(e.regKo));

        const processedRegIds = new Set();

        // 3. 전구역 루프 조사
        auditNames.forEach(zoneName => {
            // A) regId 및 현재 API 데이터 매칭
            let regId = null;
            let afsoItem = null;

            // AFSO 데이터에서 regId 찾기 (최신성 우선)
            const activeMatch = Object.values(activeMap).find(i => i && i.regKo === zoneName);
            const upcomingMatch = Object.values(upcomingMap).find(i => i && i.regKo === zoneName);

            if (activeMatch) { regId = activeMatch.regId; afsoItem = activeMatch; }
            else if (upcomingMatch) { regId = upcomingMatch.regId; afsoItem = upcomingMatch; }

            if (!regId) {
                // 장부에서 과거 regId 이력 조회
                const entry = Object.values(this.state.zones).find(e => e && e.regKo === zoneName);
                if (entry) regId = entry.regId;
            }

            if (!regId) return; // regId를 알 수 없는 구역은 Lifecycle 관리가 불가능하므로 스킵

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
                    else {
                        // 둘 다 없는데 장부에 있다면 -> 삭제 루프행 (processedRegIds에 넣지 않고 통과)
                        if (!this.state.zones[regId]) return;
                    }
                } else if (afsoItem) {
                    hubInfo.match = '정보없음'; // HUB 수집 실패 시
                }
            }

            // C) AFSO 누락 감지 (Proactive MISSING Logic)
            if (!afsoItem && hubInfo.level !== '정보없음' && hubInfo.level !== 'N/A') {
                hubInfo.match = 'MISSING';
            }

            // [NEW] 연안바다/평수구역 보호 검토
            if (!afsoItem && isCoastalZone) {
                if (coastalAlertsBaseStr && coastalAlertsBaseStr.includes(cleanZ)) {
                    log(`🛡️ [LifeCycle Audit] ${zoneName} 웹 현황 유지 중 → 궤도 유지`);
                } else {
                    // 웹에서도 사라졌다면 소멸 루프행 (ProcessedRegIds에 미등록)
                    return;
                }
            }

            // D) 최종 생존 판단: API에 데이터가 있거나(AFSO/HUB), 연안바다 보호 중인 경우만 계속 유지
            const isAlive = afsoItem || (hubInfo.level !== '정보없음' && hubInfo.level !== 'N/A' && hubInfo.level !== '해제') || (isCoastalZone && coastalAlertsBaseStr && coastalAlertsBaseStr.includes(cleanZ));
            if (!isAlive) return;

            processedRegIds.add(regId);

            // D) 장부 업데이트 및 Keyframe 판단
            let entry = this.state.zones[regId];
            if (!entry) {
                entry = { regId, regKo: zoneName, summary: null, current: null, upcoming: null, history: [], isReleaseNotified: false };
                this.state.zones[regId] = entry;
            }

            // [Fix] 새로운 유효 정보(발표/발효)가 들어왔을 때만 '해제 알림' 상태 리셋
            // 단순히 감사 리스트에 존재한다고 해서 리셋하면, 해제된 구역에 대해 매 분 알림이 발송되는 버그 발생
            const isActualAlert = afsoItem || (hubInfo.level !== '정보없음' && hubInfo.level !== 'N/A' && hubInfo.level !== '평시' && hubInfo.level !== '해제');
            if (isActualAlert) {
                entry.isReleaseNotified = false;
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
                    if (entry.upcoming) {
                        const upcomingPrio = getLvlPriority(entry.upcoming.wrnLvl);
                        const currentPrio = getLvlPriority(entry.current.wrnLvl);

                        // 1) 예정되어 있던 특보와 현재 특보 등급이 같거나, 현재 특보 등급이 더 높으면(예보 단계 통과) 예보 슬롯 비우기
                        if (currentPrio >= upcomingPrio) {
                            entry.upcoming = null;
                        }
                        // 2) 발효 시각이 이미 지났는데도 Current로 못 올라왔다면 (파싱 오류 등으로 인한 Ghost Upcoming) 삭제
                        else if (entry.upcoming.rawTmEf && entry.upcoming.rawTmEf <= nowNum) {
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

            // [NEW] 연안바다/평수구역 최후의 보호 (장부 삭제 전 크롤링 데이터 대조)
            const isCoastal = entry.regKo.includes('연안바다') || entry.regKo.includes('평수구역') || entry.regKo.includes('평수구');
            if (isCoastal && coastalAlertsBaseStr) {
                const cleanTarget = entry.regKo.replace(/[\s·\.]/g, '');
                if (coastalAlertsBaseStr.includes(cleanTarget)) {
                    log(`🛡️ [LifeCycle Audit] ${regId} (${entry.regKo}) 웹 현황 유지 중 → 장부 삭제 차단`);
                    return;
                }
            }

            const currentStatus = entry.current;
            let releaseTime = currentStatus ? currentStatus.rawTmEd : '';
            const isExpired = releaseTime && releaseTime <= nowNum;
            const isUnknownExpiration = !releaseTime;

            // [Fix] 일반 해역(Non-Coastal)은 API(HUB/AFSO)에서 모두 사라지면 예측 시각과 관계없이 해제함
            // 예측 시각은 API 지연 상황을 대비한 보조 수단이며, 양쪽 API에서 모두 정보가 없는 시점에선 삭제가 맞음
            if (isExpired || isUnknownExpiration || !isCoastal) {
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
    // [New] HUB 전용 상태 업데이트 메서드 (단순화됨)
    updateHubOnly(activeMap, upcomingMap, metData) {
        const changes = [];
        const nowStr = getNowStr();
        const nowNum = getYMDHM();

        // 1. 현재 수집된 모든 구역 식별
        const currentRegIds = new Set([...Object.keys(activeMap), ...Object.keys(upcomingMap)]);

        // 2. 신규/변경 감지 및 장부 업데이트
        currentRegIds.forEach(regId => {
            const newItem = activeMap[regId] || upcomingMap[regId];
            if (!newItem) return;

            let entry = this.state.zones[regId];
            let isNew = false;

            if (!entry) {
                // 완전 신규
                entry = {
                    regId,
                    regKo: newItem.regKo,
                    current: null,
                    upcoming: null,
                    history: [],
                    isReleaseNotified: false
                };
                this.state.zones[regId] = entry;
                isNew = true;
            }

            // 비교 대상 (기존 상태)
            const prevItem = entry.current || entry.upcoming;

            // [상태 결정 로직 고도화]
            let newStatus = 'publish';
            if (newItem.isCoastal) {
                // 자식 구역의 경우: 부모의 현재 상태를 먼저 살핌
                const parentEntry = newItem.parentRegId ? this.state.zones[newItem.parentRegId] : null;
                if (parentEntry && parentEntry.current) {
                    // 부모가 이미 발효 중이면 자식도 발효(active)로 간주
                    newStatus = 'active';
                } else {
                    // 부모가 없거나 아직 예비면 부모의 시각 정보에 따름
                    newStatus = activeMap[regId] ? 'active' : 'publish';
                }
            } else {
                // 일반 구역(부모)
                newStatus = activeMap[regId] ? 'active' : 'publish';
            }

            // 실제 상태 객체 구성 (Hub Item -> App Item)
            const appItem = {
                ...newItem,
                status: newStatus
            };

            // 변경사항 감지
            if (isNew) {
                // [신규]
                if (newItem.wrnLvl !== '기타' && newItem.wrnLvl !== '해제') {
                    // 계산된 newStatus를 type으로 사용 (부모가 발효 중이면 자식도 'active' 타입으로 알림 생성)
                    changes.push({ type: newStatus, data: appItem });
                    this.appendHistory(entry, newItem, '신규발생', nowStr);
                }
            } else if (prevItem) {
                // [변경]
                const prevLvl = prevItem.wrnLvl;
                const currLvl = newItem.wrnLvl;
                const prevLvlPrio = getLvlPriority(prevLvl);
                const currLvlPrio = getLvlPriority(currLvl);

                if (prevLvl !== currLvl) {
                    if (currLvlPrio > prevLvlPrio) {
                        changes.push({ type: 'upgrade', data: appItem });
                        this.appendHistory(entry, newItem, '격상', nowStr);
                    } else if (currLvlPrio < prevLvlPrio) {
                        changes.push({ type: 'downgrade', data: appItem });
                        this.appendHistory(entry, newItem, '격하', nowStr);
                    }
                } else {
                    // 등급은 같으나 상세 정보 변경? (시각 등)
                    const isIssuanceTimeChanged = prevItem.tmEf !== newItem.tmEf;
                    const isReleaseTimeChanged = prevItem.tmYn !== newItem.tmYn;

                    if (isIssuanceTimeChanged || isReleaseTimeChanged) {
                        // 예정 시각 변경인지, 해제 시각 변경인지 타입 결정
                        const changeType = (newStatus === 'publish') ? 'publish_time_change' : 'active_time_change';
                        changes.push({ type: changeType, data: appItem });
                        this.appendHistory(entry, newItem, '시각변경', nowStr);
                    }
                }
            } else {
                // 장부에는 있었으나 활성 상태가 아니었던 경우 (재발생)
                changes.push({ type: 'active', data: appItem });
                this.appendHistory(entry, newItem, '재발생', nowStr);
            }

            // 장부 슬롯 현행화
            if (activeMap[regId]) {
                entry.current = appItem;
                entry.upcoming = null; // Current가 있으면 Upcoming 제거
            } else {
                entry.upcoming = appItem;
            }
        });

        // 3. 해제 감지 (장부에는 있는데 수집된 목록에 없는 경우)
        Object.keys(this.state.zones).forEach(regId => {
            if (currentRegIds.has(regId)) return; // 생존

            const entry = this.state.zones[regId];
            const lastItem = entry.current || entry.upcoming;

            // 해제 알림 전송 (단, 이미 해제 알림을 보냈거나(isReleaseNotified), 데이터가 유효하지 않으면 생략)
            if (lastItem && !entry.isReleaseNotified) {
                // [중요] 연안바다 상속 구역의 경우, 부모가 해제되면 같이 해제됨.
                // 이미 collectWarnings에서 연안바다 체크를 통해 리스트에서 빠졌으므로 여기서 해제 처리됨.

                // 해제 이벤트 생성
                const releaseItem = { ...lastItem, status: 'release', wrnLvl: '해제' }; // 정보용
                changes.push({ type: 'release', data: releaseItem });

                this.appendHistory(entry, { wrnLvl: '해제', tmEf: nowStr }, '해제', nowStr);
                entry.isReleaseNotified = true; // 알림 중복 방지
            }

            // 장부에서 제거 (Clean up)
            // 즉시 제거할지, 잠시 유지할지는 정책 나름. 여기서는 즉시 제거.
            delete this.state.zones[regId];
        });

        this.save();
        return changes;
    }

    // [Helper] 히스토리 추가
    appendHistory(entry, item, type, nowStr) {
        entry.history.push({
            timestamp: nowStr,
            wrnTp: item.wrnTp,
            wrnLvl: item.wrnLvl,
            tmEf: item.tmEf,
            isKeyframe: true,
            keyframeType: type
        });
        if (entry.history.length > 50) entry.history.shift();
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
