'use strict';
/**
 * scan_jeju_highwind.js — 제주 차트에서 제주 구역이 고풍속(≥WIND_ONSET_KT)을 읽는 프레임을
 *   스캔하고, 같은 프레임에서 인접 남해동부 구역과의 신호를 나란히 비교한다.
 *   목적: "제주 30kt 오판"이 실제 제주 해역 신호인지, 인접 강풍의 폴리곤 번짐인지 규명.
 *
 * 실행: node scan_jeju_highwind.js [sampleEvery]
 */
const fs = require('fs');
const path = require('path');
const { decode, calibFor } = require('./geoCalib');
const { loadZonePolygons, zonePixelIndices, analyzeByIndices, normName } = require('./zonePolygon');
const { ZONES } = require('./zones');
const windPalette = require('./windPalette');

const GIF = path.join(__dirname, 'cache', 'gif');
const sampleEvery = +(process.argv[2] || 8);   // 8장마다 1장(속도) — 케이스 충분히 잡힘
const ONSET = 25, AREA_MIN = 0.30, GE3 = 20, ALARM = 40, MINPIX = 12;

const cal = calibFor('jeju');
const warnMap = loadZonePolygons();
const f = cal.frame;
const inFrame = z => { const x = Math.round(cal.xOf(z.lon)), y = Math.round(cal.yOf(z.lat)); return x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1; };
const domain = ZONES.filter(z => inFrame(z) && warnMap.has(normName(z.name)));
const isJeju = z => z.name.startsWith('제주');
const isNamhae = z => z.name.includes('남해동부') || z.name.includes('남해서부');

const files = fs.readdirSync(GIF).filter(n => /jeju_wind/.test(n)).sort();
const picked = files.filter((_, i) => i % sampleEvery === 0);
console.log(`총 ${files.length} 프레임 중 ${picked.length} 샘플 (every ${sampleEvery}) / 도메인구역 ${domain.length}`);

// 폴리곤 픽셀 인덱스 1회 캐시 (w/h 고정 가정 — 첫 디코드로 확정)
let idxCache = null, W = 0, H = 0;
function buildIdx(dec) {
    idxCache = new Map(); W = dec.w; H = dec.h;
    for (const z of domain) idxCache.set(z.name, zonePixelIndices(cal, warnMap.get(normName(z.name)), dec.w, dec.h));
}
function ana(dec, z) {
    const idx = idxCache.get(z.name);
    if (!idx || !idx.length) return null;
    return analyzeByIndices(dec, idx, { classify: windPalette.classify, ge3Level: GE3, ge5Level: ALARM, minBandPixels: MINPIX });
}

const hits = [];   // 제주 구역이 onset 게이트 통과한 (프레임,구역)
let scanned = 0;
for (const fn of picked) {
    let dec;
    try { dec = decode(fs.readFileSync(path.join(GIF, fn))); } catch (e) { continue; }
    if (!idxCache || dec.w !== W || dec.h !== H) buildIdx(dec);
    scanned++;
    // 이 프레임의 모든 도메인 구역 분석 (제주 onset 발생 시 컨텍스트로 남해도 기록)
    const res = new Map();
    for (const z of domain) res.set(z.name, ana(dec, z));
    for (const z of domain) {
        if (!isJeju(z)) continue;
        const a = res.get(z.name);
        if (a && a.maxBand >= ONSET && a.areaFraction >= AREA_MIN) {
            // 인접 남해 구역 신호 동반 기록
            const nbr = domain.filter(isNamhae).map(n => { const x = res.get(n.name); return x ? `${n.name}:${x.maxBand}kt/${(x.areaFraction * 100 | 0)}%` : `${n.name}:-`; });
            hits.push({ fn, zone: z.name, maxBand: a.maxBand, area: +(a.areaFraction * 100).toFixed(0), ge5: a.pixelsGE5, sampled: a.sampled, nbr });
        }
    }
}
console.log(`디코드 ${scanned}장. 제주 onset(≥${ONSET}kt & 면적≥${AREA_MIN * 100}%) 히트 ${hits.length}건\n`);
// maxBand 강한 순 상위 15건
hits.sort((a, b) => b.maxBand - a.maxBand || b.area - a.area);
for (const h2 of hits.slice(0, 15)) {
    console.log(`★ ${h2.fn}`);
    console.log(`   ${h2.zone}: ${h2.maxBand}kt, 면적 ${h2.area}%, ge5px ${h2.ge5}, 표본 ${h2.sampled}px`);
    console.log(`   인접 남해: ${h2.nbr.join('  ')}`);
}
// 케이스 요약: 제주 onset 시 남해동부도 동시 고풍속인 비율
const withNamhaeHigh = hits.filter(h2 => h2.nbr.some(s => { const m = s.match(/:(\d+)kt/); return m && +m[1] >= ONSET; }));
console.log(`\n요약: 제주 onset 히트 ${hits.length}건 중, 인접 남해도 동시 ≥${ONSET}kt = ${withNamhaeHigh.length}건 (${hits.length ? (withNamhaeHigh.length / hits.length * 100 | 0) : 0}%)`);
// 상위 1건 파일명을 오버레이용으로 출력
if (hits.length) { fs.writeFileSync(path.join(__dirname, 'reports', '_top_jeju_frame.txt'), hits[0].fn); console.log('top frame →', hits[0].fn); }
