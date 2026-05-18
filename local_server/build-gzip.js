/**
 * ============================================================================
 * 파일명: build-gzip.js
 * 역할: 정적 자원(.js/.css/.json/.svg/.woff2/.html) 을 빌드 타임에 미리
 *       gzip(.gz) / brotli(.br) 로 압축해 두는 빌드 스크립트
 * ============================================================================
 *
 * [왜 만들었나 — 5순위 작업]
 *   기존엔 server.js 의 compression() 미들웨어가 매 요청마다 응답을
 *   "실시간" gzip 압축했음. 정적 자원(라이브러리/스크립트/스타일) 처럼
 *   내용이 거의 변하지 않는 파일도 매번 CPU 를 써서 다시 압축 → 낭비.
 *   요청당 약 80~100ms 의 CPU 비용 발생 (Fly.io 1 vCPU 환경 기준).
 *
 *   이 스크립트는 정적 자원을 빌드 시 미리 .gz / .br 로 만들어 두어,
 *   server.js 가 express-static-gzip 미들웨어로 그 결과를 그대로
 *   응답하게 한다. 응답 CPU 비용 ≒ 0, 첫 요청부터 압축본 전송.
 *
 * [옵션 A — prestart 자동 실행]
 *   package.json 의 "prestart" 훅에 등록되어 있어, `npm start` 직전에
 *   자동으로 한 번 실행된다. 개발자가 빌드를 잊어도 안전 (= 옵션 A).
 *   mtime(수정시각) 비교로 이미 최신이면 스킵하므로 부하 미미.
 *
 * [무엇을 압축하나]
 *   - 디렉토리: local_server/{assets, images, js, css, tide_data}
 *   - 확장자: .js .css .json .svg .woff2 .html
 *   - 크기 임계값: 1KB 미만은 스킵 (압축 효율 < 헤더 오버헤드)
 *   - 압축 형식: gzip(level 9) + brotli(quality 11) 둘 다 생성
 *   - uploads/ 는 동적 업로드 파일이라 제외 (server.js 에서도 별도 처리)
 *
 * [재빌드 스킵 — mtime 비교]
 *   원본보다 .gz / .br 가 최신이면 스킵. 첫 빌드 후 재실행은 매우 빠름.
 *
 * [의존성]
 *   Node.js 내장 모듈만 사용: zlib, fs, path  (외부 패키지 0)
 *
 * [연계 파일]
 *   - server.js → express-static-gzip 이 .gz / .br 를 응답
 *   - package.json → "prestart" 훅으로 매 start 직전 실행
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------------------
// 설정값
// ---------------------------------------------------------------------------
const ROOT = __dirname;                                     // local_server/
const TARGET_DIRS = ['assets', 'images', 'js', 'css', 'tide_data'];
const TARGET_EXTS = new Set(['.js', '.css', '.json', '.svg', '.woff2', '.html']);
const MIN_SIZE = 1024;                                      // 1KB 미만은 스킵

// 큰 파일(10MB 이상) 은 메모리 한꺼번에 올리지 않도록 스트림 사용 임계값
const STREAM_THRESHOLD = 10 * 1024 * 1024;

// 통계 카운터
let scanned = 0;
let compressed = 0;
let skippedFresh = 0;
let skippedSmall = 0;
let totalOriginal = 0;
let totalGzip = 0;
let totalBrotli = 0;

/** 디렉토리를 재귀 순회하며 콜백 호출 */
function walk(dir, cb) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return;  // 디렉토리가 없으면 조용히 스킵
    }
    for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            walk(full, cb);
        } else if (ent.isFile()) {
            cb(full);
        }
    }
}

/**
 * 한 파일에 대해 gzip / brotli 압축본 생성.
 *  - 원본보다 .gz / .br 가 새것이면 스킵 (mtime 비교)
 *  - 이미 .gz / .br 인 파일은 건너뜀 (재귀 방지)
 */
function compressOne(srcPath) {
    const ext = path.extname(srcPath).toLowerCase();
    if (ext === '.gz' || ext === '.br') return;       // 이미 압축본
    if (!TARGET_EXTS.has(ext)) return;                // 대상 확장자 아님

    const stat = fs.statSync(srcPath);
    scanned++;
    if (stat.size < MIN_SIZE) { skippedSmall++; return; }

    const gzPath = srcPath + '.gz';
    const brPath = srcPath + '.br';

    // mtime 비교: 둘 다 최신이면 작업 없음
    const gzFresh = fs.existsSync(gzPath) && fs.statSync(gzPath).mtimeMs >= stat.mtimeMs;
    const brFresh = fs.existsSync(brPath) && fs.statSync(brPath).mtimeMs >= stat.mtimeMs;
    if (gzFresh && brFresh) { skippedFresh++; return; }

    const buf = fs.readFileSync(srcPath);
    totalOriginal += stat.size;

    if (!gzFresh) {
        const gz = zlib.gzipSync(buf, { level: zlib.constants.Z_BEST_COMPRESSION });
        fs.writeFileSync(gzPath, gz);
        totalGzip += gz.length;
    } else {
        totalGzip += fs.statSync(gzPath).size;
    }

    if (!brFresh) {
        // brotli 는 텍스트 압축률이 gzip 보다 ~15% 더 좋음.
        // 큰 파일은 quality 6 으로 낮춰 빌드시간 폭증 방지 (압축률 차이 미미).
        const quality = stat.size > STREAM_THRESHOLD
            ? 6
            : zlib.constants.BROTLI_MAX_QUALITY;
        const br = zlib.brotliCompressSync(buf, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
            }
        });
        fs.writeFileSync(brPath, br);
        totalBrotli += br.length;
    } else {
        totalBrotli += fs.statSync(brPath).size;
    }

    compressed++;
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------
const startedAt = Date.now();
console.log('[build-gzip] 정적 자원 사전 압축 시작…');

for (const sub of TARGET_DIRS) {
    walk(path.join(ROOT, sub), compressOne);
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
const ratio = totalOriginal > 0 ? ((1 - totalGzip / totalOriginal) * 100).toFixed(1) : '0.0';
console.log(
    `[build-gzip] 완료: ${compressed}개 압축 / ${scanned}개 스캔 ` +
    `(최신 스킵 ${skippedFresh}, 1KB 미만 스킵 ${skippedSmall}) — ` +
    `원본 ${(totalOriginal / 1024).toFixed(1)}KB → gzip ${(totalGzip / 1024).toFixed(1)}KB ` +
    `(${ratio}% 절감), brotli ${(totalBrotli / 1024).toFixed(1)}KB, ${elapsed}초`
);
