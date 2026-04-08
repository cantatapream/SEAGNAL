/**
 * 육지 마스크 사전 생성 스크립트
 * 실행: node local_server/scripts/generate_land_mask.js
 *
 * @geo-maps/earth-land-10km 에서 전 세계 육지 GeoJSON을 받아
 * 한반도 + 일본 + 중국 해안 범위(118-142E, 24-46N)로 클리핑하여
 * local_server/land_mask_korea.json 에 저장합니다.
 * (부속 도서 포함, 한 번 생성 후 영구 사용)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BBOX = [118, 24, 142, 46]; // [minLon, minLat, maxLon, maxLat]
const OUT_PATH = path.join(__dirname, '..', 'land_mask_korea.json');

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return fetchJson(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('JSON 파싱 실패: ' + e.message)); }
            });
        }).on('error', reject);
    });
}

function ringInBbox(ring) {
    for (const [lon, lat] of ring) {
        if (lon >= BBOX[0] && lon <= BBOX[2] && lat >= BBOX[1] && lat <= BBOX[3]) return true;
    }
    return false;
}

function extractRingsFromGeojson(geojson) {
    const rings = [];
    for (const feat of (geojson.features || [])) {
        const geom = feat.geometry;
        if (!geom) continue;
        const polys = geom.type === 'Polygon'      ? [geom.coordinates]
                    : geom.type === 'MultiPolygon' ?  geom.coordinates : [];
        for (const poly of polys) {
            const outer = poly[0];
            if (outer && ringInBbox(outer)) rings.push(outer);
        }
    }
    return rings;
}

async function main() {
    console.log('육지 마스크 생성 시작...');

    const URL = 'https://cdn.jsdelivr.net/npm/@geo-maps/earth-land-10km@1.2.0/contents.json';
    console.log('다운로드:', URL);

    const geojson = await fetchJson(URL);
    console.log('다운로드 완료, 피처 수:', (geojson.features || []).length);

    const rings = extractRingsFromGeojson(geojson);
    console.log('bbox 필터링 후 링 수:', rings.length);

    fs.writeFileSync(OUT_PATH, JSON.stringify({ rings }));
    const size = fs.statSync(OUT_PATH).size;
    console.log('저장 완료:', OUT_PATH);
    console.log('파일 크기:', (size / 1024).toFixed(1) + ' KB');
}

main().catch(e => { console.error('오류:', e.message); process.exit(1); });
