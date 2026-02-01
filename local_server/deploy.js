const fs = require('fs');
const path = require('path');

// 설정: Development 폴더와 배포 대상 폴더 (현재 폴더)
const DEV_DIR = path.join(__dirname, '../');
const PROD_DIR = __dirname; // 현재 폴더(local_server)로 직접 복사

// 배포할 파일 및 폴더 목록
const FILES_TO_DEPLOY = [
    'index.html',
    'app.js',
    'style.css',
    'splash.css',
    'splashIconData.js', // [New] Base64 스플래시 아이콘
    'seaZones.js',
    'haegudoData.js', // [New] Base64 지도 데이터
    'seaZonesData.js',
    'seaZoneCoordinates.js',
    'buoyLocations.js',
    'gridCalibrationData.js',
    'zoneOverlayConfig.js',
    'tide.js',
    'tide_calendar.js',
    'tide_data.js',
    'manifest.json', // PWA 설정 파일
    'sw.js', // Service Worker
    '.well-known/assetlinks.json', // [New] Android 앱 인증 파일
    'local_server/server.js', // 서버 실행 파일 포함
    'local_server/scheduler.js', // API 데이터 수집 스케줄러
    'local_server/Dockerfile',
    'local_server/.dockerignore',
    'local_server/fly.toml',
    'local_server/.env', // 환경 변수 파일
    'local_server/package.json',
    'local_server/package-lock.json'
];

// 배포할 폴더 목록 (전체 복사)
const FOLDERS_TO_DEPLOY = [
    'images',
    'assets',
    'tide_data',
    '연안바다_이미지',
    'local_server/uploads'
];

// 데이터 파일 목록 (수집 완료된 데이터도 배포할지 결정)
const DATA_FILES = [
    'local_server/data/warnings.json',
    'local_server/data/buoys.json',
    'local_server/data/general_forecasts.json',
    'local_server/data/zone_forecasts.json',
    'local_server/data/notice.json',
    'local_server/data/promo.json'
];

// 폴더 전체 복사 함수 (재귀)
function copyFolderRecursive(src, dest) {
    if (!fs.existsSync(src)) {
        console.warn(`  ⚠️ 건너뜀 (폴더 없음): ${src}`);
        return;
    }

    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });
    let fileCount = 0;

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyFolderRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
            fileCount++;
        }
    }

    return fileCount;
}

async function deploy() {
    console.log('🚀 [배포 시스템] 정식 서비스 배포를 시작합니다...');

    // 1. 서비스 폴더가 없으면 생성
    if (!fs.existsSync(PROD_DIR)) {
        fs.mkdirSync(PROD_DIR, { recursive: true });
        console.log(`📁 서비스 폴더 생성됨: ${PROD_DIR}`);
    }

    // 2. 서비스 폴더 내부에 local_server/data 구조 생성
    const prodDataDir = path.join(PROD_DIR, 'local_server/data');
    if (!fs.existsSync(prodDataDir)) {
        fs.mkdirSync(prodDataDir, { recursive: true });
    }

    // 3. 파일 복사 함수 (Development에서 현재 폴더로 복사)
    function copyFile(srcRelativePath) {
        // local_server/ prefix가 있으면 제거 (이미 현재 폴더가 local_server이므로)
        let srcPath = srcRelativePath;
        if (srcRelativePath.startsWith('local_server/') || srcRelativePath.startsWith('local_server\\')) {
            srcPath = srcRelativePath.replace(/^local_server[\\/]/, '');
        }

        const src = path.join(DEV_DIR, srcRelativePath);
        const dest = path.join(PROD_DIR, srcPath);

        if (fs.existsSync(src)) {
            const destDir = path.dirname(dest);
            if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

            fs.copyFileSync(src, dest);
            console.log(`  ✓ 복사 완료: ${srcPath}`);
        } else {
            console.warn(`  ⚠️ 건너뜀 (파일 없음): ${srcRelativePath}`);
        }
    }

    // 4. 메인 코드 배포
    console.log('\n📦 [1/4] 프로그램 코드 복사 중...');
    FILES_TO_DEPLOY.forEach(copyFile);

    // 5. 이미지/에셋 폴더 배포
    console.log('\n🖼️ [2/4] 이미지 및 에셋 폴더 복사 중...');
    for (const folder of FOLDERS_TO_DEPLOY) {
        const src = path.join(DEV_DIR, folder);

        // local_server/ prefix 제거
        let destFolder = folder;
        if (folder.startsWith('local_server/') || folder.startsWith('local_server\\')) {
            destFolder = folder.replace(/^local_server[\\/]/, '');
        }

        const dest = path.join(PROD_DIR, destFolder);
        const count = copyFolderRecursive(src, dest);
        if (count !== undefined) {
            console.log(`  ✓ ${destFolder}/ 복사 완료 (${count}개 파일)`);
        }
    }

    // 6. 최신 데이터 배포
    console.log('\n📊 [3/4] 최신 데이터 파일 복사 중...');
    DATA_FILES.forEach(copyFile);

    // 7. 캐시 버스팅을 위한 버전 파일 생성
    console.log('\n🔄 [4/4] 버전 정보 갱신 중...');
    const versionInfo = {
        version: Date.now(),
        deployedAt: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    };
    // 버전 파일 저장
    fs.writeFileSync(path.join(PROD_DIR, 'version.json'), JSON.stringify(versionInfo, null, 2));
    console.log(`  ✓ 버전: ${versionInfo.version}`);

    // 8. index.html 캐시 버스팅 (app.js?v=...)
    console.log('\n⚡ [5/4] index.html 캐시 버스팅 적용 중...');
    const indexHtmlPath = path.join(PROD_DIR, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
        let htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
        // app.js?v=TIMESTAMP 로 교체
        const cacheBuster = `app.js?v=${versionInfo.version}`;
        htmlContent = htmlContent.replace(/src="app\.js"/g, `src="${cacheBuster}"`)
            .replace(/src='app\.js'/g, `src='${cacheBuster}'`);
        fs.writeFileSync(indexHtmlPath, htmlContent);
        console.log(`  ✓ app.js -> ${cacheBuster}`);
    }

    console.log('\n✨ [성공] 배포 준비 완료!');
    console.log(`🚀 Fly.io 배포: fly deploy`);
}

deploy().catch(err => {
    console.error('❌ 배포 중 오류 발생:', err.message);
});

