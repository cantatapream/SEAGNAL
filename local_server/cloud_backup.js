// ============================================================================
// Google Cloud Storage 자동 백업 모듈 (Free Tier: us-west1)
// ============================================================================
//
// [Lazy Require 적용 — 시작 속도 최적화]
//   `@google-cloud/storage` SDK 는 require 만 해도 약 7초가 걸리는 무거운 모듈이다.
//   매일 자정 cron 에서만 사용하는데 require 를 파일 상단에서 하면
//   서버 startup 마다 7초가 추가되어 fly.io 의 health check 가 실패하는 원인이 된다.
//   → 모듈을 함수 내부에서 require ("lazy require") 하여 첫 호출 시점에만 로딩되도록 한다.
//   Node.js 의 require 는 캐시되므로 두 번째 호출부터는 즉시 반환된다.
//
// [연계]
//   - server.js → const cloudBackup = require('./cloud_backup')
//                 cron.schedule(..., () => cloudBackup.performBackup())
//   - cron 호출 시점(매일 KST 00:05)에 첫 require 가 일어나며 사용자 응답에는 영향 없음.
// ============================================================================

const path = require('path');
const fs = require('fs');

// 백업 봇 인증키 경로
const KEY_FILE_PATH = path.join(__dirname, 'serviceAccountKey_Backup.json');
const BUCKET_NAME = 'seagnal-server-backup'; // 사용자 버킷 이름
const DATA_DIR = path.join(__dirname, 'data');

// ============================================================================
// Bucket 인스턴스 lazy 초기화
// ============================================================================
// 첫 호출 시 @google-cloud/storage 를 require 하고 Storage / bucket 인스턴스를
// 만든 뒤 캐시한다. 인증키 파일이 없거나 초기화에 실패하면 null 을 캐시하여
// 이후 호출들이 즉시 no-op 이 되도록 한다.
let _bucket = null;            // 캐시된 bucket 인스턴스
let _bucketInitDone = false;   // 첫 초기화 시도가 끝났는지 여부

/**
 * GCS bucket 인스턴스 lazy init + 캐시.
 * 환경변수(BUCKET 키 등) 미설정이거나 SDK 미설치 시 null 반환 → 호출자가 backup skip.
 *
 * [멱등성] _bucketInitDone 플래그로 1회만 초기화.
 */
function getBucket() {
    if (_bucketInitDone) return _bucket;
    _bucketInitDone = true;

    if (!fs.existsSync(KEY_FILE_PATH)) {
        console.warn('⚠️ 백업용 인증키 파일(serviceAccountKey_Backup.json)이 없습니다. 클라우드 백업이 비활성화됩니다.');
        return null;
    }

    try {
        // [Lazy Require] 무거운 SDK 를 첫 호출 시점에 로딩 (~7초 1회).
        // 이후 호출은 Node 내부 모듈 캐시로 즉시 반환됨.
        const { Storage } = require('@google-cloud/storage');
        const storage = new Storage({
            keyFilename: KEY_FILE_PATH,
            projectId: require(KEY_FILE_PATH).project_id
        });
        _bucket = storage.bucket(BUCKET_NAME);
        console.log(`📦 Google Cloud Backup 초기화 완료 (Bucket: ${BUCKET_NAME})`);
    } catch (e) {
        console.error('⚠️ Google Cloud Backup 초기화 실패:', e.message);
        _bucket = null;
    }
    return _bucket;
}

/**
 * 단일 파일 업로드 함수
 * 로컬 data/ 폴더에 있는 파일을 클라우드 버킷의 backup_YYYYMMDD/ 경로로 업로드한다.
 * 인증키가 없거나 대상 파일이 없으면 조용히 종료한다.
 */
async function uploadFile(fileName) {
    const bucket = getBucket();
    if (!bucket) return;

    const filePath = path.join(DATA_DIR, fileName);
    if (!fs.existsSync(filePath)) {
        // console.log(`ℹ️ 백업 대상 파일 없음: ${fileName}`);
        return;
    }

    try {
        // 클라우드 저장 경로: backup_YYYYMMDD/filename.json
        const today = new Date();
        const kstDate = new Date(today.getTime() + (9 * 60 * 60 * 1000));
        const dateFolder = `backup_${kstDate.toISOString().split('T')[0].replace(/-/g, '')}`;
        const destination = `${dateFolder}/${fileName}`;

        await bucket.upload(filePath, {
            destination: destination,
            metadata: {
                cacheControl: 'private, max-age=0',
            },
        });

        console.log(`✅ [Backup] ${fileName} -> ${destination} 업로드 성공`);
    } catch (e) {
        console.error(`❌ [Backup] ${fileName} 업로드 실패:`, e.message);
    }
}

/**
 * 전체 데이터 백업 실행 (주요 파일)
 * server.js 의 cron 에서 매일 KST 00:05 에 호출됨.
 */
async function performBackup() {
    const bucket = getBucket();
    if (!bucket) return;

    console.log('🔄 [Daily Backup] 클라우드 백업 시작...');
    const targetFiles = [
        'visitors.json',
        'visitors_stats.json',
        'usage_stats.json',
        'tidebed_config.json',
        'notice.json',
        'notices.json',
        'promo.json',
        'surveys.json',
        'subscriptions.json',     // [추가] 푸시 구독자(토큰) — 핵심 자산. 기존 미백업이라 손상 시 복구불가였음.
        'subscriber_stats.json',  // [추가] 구독자 수 추이(일별 집계) — 통계 보존.
        'subscriber_events.json'  // [추가] 구독/해지/만료 일별 카운트 — 통계 보존.
    ];

    for (const file of targetFiles) {
        await uploadFile(file);
    }

    // 설문 응답 파일들 (survey_responses_*.json) 동적 백업
    try {
        const surveyResponseFiles = fs.readdirSync(DATA_DIR)
            .filter(f => f.startsWith('survey_responses_') && f.endsWith('.json'));
        for (const file of surveyResponseFiles) {
            await uploadFile(file);
        }
    } catch (e) {
        console.error('❌ [Backup] 설문 응답 파일 백업 실패:', e.message);
    }
    console.log('✨ [Daily Backup] 모든 백업 작업 완료');
}

module.exports = {
    performBackup
};
