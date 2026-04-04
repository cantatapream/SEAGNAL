// ============================================================================
// Google Cloud Storage 백업 복구 모듈
// ============================================================================
// 사용법 (CLI): node cloud_restore.js [날짜]
//   예: node cloud_restore.js 20260401
//   날짜 미지정 시 가장 최근 백업에서 복구
// ============================================================================
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

const KEY_FILE_PATH = path.join(__dirname, 'serviceAccountKey_Backup.json');
const BUCKET_NAME = 'seagnal-server-backup';
const DATA_DIR = path.join(__dirname, 'data');

let storage = null;
let bucket = null;

if (fs.existsSync(KEY_FILE_PATH)) {
    try {
        storage = new Storage({
            keyFilename: KEY_FILE_PATH,
            projectId: require(KEY_FILE_PATH).project_id
        });
        bucket = storage.bucket(BUCKET_NAME);
    } catch (e) {
        console.error('GCS 초기화 실패:', e.message);
    }
} else {
    console.error('인증키 파일이 없습니다: serviceAccountKey_Backup.json');
}

/**
 * 백업 폴더 목록 조회 (날짜별)
 */
async function listBackupDates() {
    if (!bucket) throw new Error('GCS 연결 안 됨');

    const [files] = await bucket.getFiles();
    const folders = new Set();
    files.forEach(f => {
        const folder = f.name.split('/')[0];
        if (folder.startsWith('backup_')) {
            folders.add(folder);
        }
    });
    return [...folders].sort();
}

/**
 * 특정 백업 폴더에서 설문 관련 파일 목록 조회
 */
async function listSurveyFiles(dateFolder) {
    if (!bucket) throw new Error('GCS 연결 안 됨');

    const [files] = await bucket.getFiles({ prefix: dateFolder + '/' });
    return files.filter(f => f.name.includes('survey'));
}

/**
 * 특정 날짜의 백업에서 설문 데이터 복구
 * @param {string} dateFolder - 예: 'backup_20260401'
 * @param {boolean} dryRun - true면 복구하지 않고 목록만 출력
 * @returns {object} 복구 결과
 */
async function restoreSurveyData(dateFolder, dryRun = false) {
    if (!bucket) throw new Error('GCS 연결 안 됨');

    const surveyFiles = await listSurveyFiles(dateFolder);

    if (surveyFiles.length === 0) {
        return { success: false, message: `${dateFolder}에 설문 백업 파일이 없습니다.`, files: [] };
    }

    const results = [];

    for (const file of surveyFiles) {
        const fileName = file.name.split('/').pop(); // surveys.json 또는 survey_responses_*.json
        const localPath = path.join(DATA_DIR, fileName);

        if (dryRun) {
            const [metadata] = await file.getMetadata();
            results.push({
                file: fileName,
                size: metadata.size,
                updated: metadata.updated,
                action: 'preview'
            });
            continue;
        }

        // 기존 파일이 있으면 .bak으로 백업
        if (fs.existsSync(localPath)) {
            const bakPath = localPath + '.bak_' + Date.now();
            fs.copyFileSync(localPath, bakPath);
            console.log(`  기존 파일 백업: ${fileName} -> ${path.basename(bakPath)}`);
        }

        // GCS에서 다운로드
        const [contents] = await file.download();
        fs.writeFileSync(localPath, contents);

        // 복구된 데이터 확인
        let recordCount = 0;
        try {
            const parsed = JSON.parse(contents.toString('utf8'));
            recordCount = Array.isArray(parsed) ? parsed.length : 1;
        } catch (e) { /* ignore */ }

        results.push({
            file: fileName,
            size: contents.length,
            records: recordCount,
            action: 'restored'
        });
        console.log(`  ✅ 복구 완료: ${fileName} (${recordCount}건, ${contents.length} bytes)`);
    }

    return {
        success: true,
        message: `${dateFolder}에서 ${results.length}개 파일 복구 완료`,
        files: results
    };
}

/**
 * 가장 최근 백업 날짜에서 설문 데이터가 있는 폴더 찾기
 */
async function findLatestSurveyBackup() {
    const dates = await listBackupDates();
    // 최신 날짜부터 역순 탐색
    for (let i = dates.length - 1; i >= 0; i--) {
        const files = await listSurveyFiles(dates[i]);
        // surveys.json이 있고 내용이 비어있지 않은 백업 찾기
        for (const file of files) {
            if (file.name.endsWith('surveys.json')) {
                const [contents] = await file.download();
                try {
                    const data = JSON.parse(contents.toString('utf8'));
                    if (Array.isArray(data) && data.length > 0) {
                        return { folder: dates[i], surveyCount: data.length };
                    }
                } catch (e) { /* continue */ }
            }
        }
    }
    return null;
}

// 모듈 export (서버에서 API로 사용 가능)
module.exports = {
    listBackupDates,
    listSurveyFiles,
    restoreSurveyData,
    findLatestSurveyBackup
};

// CLI 직접 실행 시
if (require.main === module) {
    (async () => {
        try {
            const targetDate = process.argv[2]; // 예: 20260401

            console.log('🔍 백업 폴더 목록 조회 중...');
            const dates = await listBackupDates();
            console.log(`📂 총 ${dates.length}개 백업 발견:`);
            dates.forEach(d => console.log(`  - ${d}`));

            let dateFolder;
            if (targetDate) {
                dateFolder = `backup_${targetDate}`;
                if (!dates.includes(dateFolder)) {
                    console.error(`❌ ${dateFolder} 백업을 찾을 수 없습니다.`);
                    process.exit(1);
                }
            } else {
                console.log('\n🔍 설문 데이터가 있는 최신 백업 검색 중...');
                const latest = await findLatestSurveyBackup();
                if (!latest) {
                    console.error('❌ 설문 데이터가 있는 백업을 찾을 수 없습니다.');
                    process.exit(1);
                }
                dateFolder = latest.folder;
                console.log(`✅ 발견: ${dateFolder} (설문 ${latest.surveyCount}개)`);
            }

            // 미리보기
            console.log(`\n📋 [${dateFolder}] 설문 파일 목록:`);
            const preview = await restoreSurveyData(dateFolder, true);
            preview.files.forEach(f => {
                console.log(`  - ${f.file} (${f.size} bytes, ${f.updated})`);
            });

            // 복구 실행
            console.log(`\n🔄 복구 시작...`);
            const result = await restoreSurveyData(dateFolder, false);
            console.log(`\n✨ ${result.message}`);

        } catch (e) {
            console.error('❌ 복구 실패:', e.message);
            process.exit(1);
        }
    })();
}
