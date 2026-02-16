// ============================================================================
// Google Cloud Storage 자동 백업 모듈 (Free Tier: us-west1)
// ============================================================================
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

// 백업 봇 인증키 경로
const KEY_FILE_PATH = path.join(__dirname, 'serviceAccountKey_Backup.json');
const BUCKET_NAME = 'seagnal-server-backup'; // 사용자 버킷 이름
const DATA_DIR = path.join(__dirname, 'data');

// Google Storage 클라이언트 초기화
let storage = null;
let bucket = null;

if (fs.existsSync(KEY_FILE_PATH)) {
    try {
        storage = new Storage({
            keyFilename: KEY_FILE_PATH,
            projectId: require(KEY_FILE_PATH).project_id
        });
        bucket = storage.bucket(BUCKET_NAME);
        console.log(`📦 Google Cloud Backup 초기화 완료 (Bucket: ${BUCKET_NAME})`);
    } catch (e) {
        console.error('⚠️ Google Cloud Backup 초기화 실패:', e.message);
    }
} else {
    console.warn('⚠️ 백업용 인증키 파일(serviceAccountKey_Backup.json)이 없습니다. 클라우드 백업이 비활성화됩니다.');
}

/**
 * 단일 파일 업로드 함수
 */
async function uploadFile(fileName) {
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
 */
async function performBackup() {
    if (!bucket) return;

    console.log('🔄 [Daily Backup] 클라우드 백업 시작...');
    const targetFiles = [
        'visitors.json',
        'visitors_stats.json',
        'tidebed_config.json',
        'notice.json',
        'notices.json',
        'promo.json'
    ];

    for (const file of targetFiles) {
        await uploadFile(file);
    }
    console.log('✨ [Daily Backup] 모든 백업 작업 완료');
}

module.exports = {
    performBackup
};
