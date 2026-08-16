/**
 * 육지 마스크 사전 생성 스크립트
 * 실행: node local_server/scripts/generate_land_mask.js
 *
 * @geo-maps/earth-lands-10m(전 세계 육지 폴리곤, 닫힌 링) 에서 받아
 * 한반도 + 일본 + 중국 해안 범위(118-142E, 24-46N)로 클리핑하여
 * local_server/land_mask_korea.json 에 저장합니다.
 * (부속 도서 포함, 한 번 생성 후 영구 사용)
 *
 * [2026-08 교체 이력] 기존 earth-land-10km(10km급 저해상도)는 새만금 방조제 같은
 *   근래 지형을 반영 못 해 ocean_overlay.js 의 육지 마스크가 해안선 근처에서
 *   각지게 잘리거나 육지를 침범했다. earth-lands-10m 은 같은 배포처의 훨씬
 *   정밀한 버전(한반도 권역 점 개수 약 22배)이라 교체함. 파일이 200MB급이라
 *   jsdelivr CDN 은 파일 크기 제한(403)에 걸려, npm 레지스트리 tarball을 직접
 *   받아 tar로 푼다.
 */

const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PKG = '@geo-maps/earth-lands-10m';
const PKG_VERSION = '0.6.0';
const BBOX = [118, 24, 142, 46]; // [minLon, minLat, maxLon, maxLat]
const SIMPLIFY_TOLERANCE_DEG = 0.0002; // 약 22m — 링 점 개수만 줄이고 형상은 그대로 유지
const OUT_PATH = path.join(__dirname, '..', '..', 'client', 'land_mask_korea.json'); // STEP 7

function fetchBuffer(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchBuffer(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error('다운로드 실패 HTTP ' + res.statusCode));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

function ringInBbox(ring) {
    for (const [lon, lat] of ring) {
        if (lon >= BBOX[0] && lon <= BBOX[2] && lat >= BBOX[1] && lat <= BBOX[3]) return true;
    }
    return false;
}

/** Douglas-Peucker 단순화 — 형상은 유지하되 거의 일직선인 중간 점만 솎아낸다. */
function simplifyRing(ring, tolerance) {
    if (ring.length <= 3) return ring;

    function perpDist(p, a, b) {
        const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(x - x1, y - y1);
        const t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
        const px = x1 + t * dx, py = y1 + t * dy;
        return Math.hypot(x - px, y - py);
    }

    function dp(points) {
        if (points.length <= 2) return points;
        let maxDist = 0, maxIdx = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const d = perpDist(points[i], points[0], points[points.length - 1]);
            if (d > maxDist) { maxDist = d; maxIdx = i; }
        }
        if (maxDist <= tolerance) return [points[0], points[points.length - 1]];
        const left = dp(points.slice(0, maxIdx + 1));
        const right = dp(points.slice(maxIdx));
        return left.slice(0, -1).concat(right);
    }

    return dp(ring);
}

function extractRingsFromGeometryCollection(geojson) {
    const rings = [];
    const multiPoly = (geojson.geometries || []).find(g => g.type === 'MultiPolygon');
    if (!multiPoly) throw new Error('MultiPolygon 지오메트리를 찾지 못함');
    for (const poly of multiPoly.coordinates) {
        const outer = poly[0];
        if (outer && ringInBbox(outer)) rings.push(outer);
    }
    return rings;
}

async function main() {
    console.log('육지 마스크 생성 시작...');

    const tarballUrl = `https://registry.npmjs.org/${PKG}/-/${PKG.split('/')[1]}-${PKG_VERSION}.tgz`;
    console.log('tarball 다운로드:', tarballUrl);
    const tarballBuf = await fetchBuffer(tarballUrl);
    console.log('다운로드 완료:', (tarballBuf.length / 1e6).toFixed(1) + 'MB');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'land-mask-'));
    const tarballPath = path.join(tmpDir, 'pkg.tgz');
    fs.writeFileSync(tarballPath, tarballBuf);
    execFileSync('tar', ['xzf', tarballPath, '-C', tmpDir]);

    const dataPath = path.join(tmpDir, 'package', 'map.geo.json');
    console.log('압축 해제 완료, 파싱 중...');
    const geojson = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    let rings = extractRingsFromGeometryCollection(geojson);
    const rawPtCount = rings.reduce((n, r) => n + r.length, 0);
    console.log(`bbox 필터링 후 링 ${rings.length}개, 점 ${rawPtCount.toLocaleString()}개`);

    rings = rings.map(r => simplifyRing(r, SIMPLIFY_TOLERANCE_DEG));
    const simplifiedPtCount = rings.reduce((n, r) => n + r.length, 0);
    console.log(`단순화 후 점 ${simplifiedPtCount.toLocaleString()}개 (허용오차 ${SIMPLIFY_TOLERANCE_DEG}도)`);

    fs.writeFileSync(OUT_PATH, JSON.stringify({ rings }));
    const size = fs.statSync(OUT_PATH).size;
    console.log('저장 완료:', OUT_PATH);
    console.log('파일 크기:', (size / 1024).toFixed(1) + ' KB');

    fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
