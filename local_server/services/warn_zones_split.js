'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/warn_zones_split.js
 * 역할  : 해상 특보구역 그림(client/assets/warn_zones.geojson, 44개)에서 「제주도 남쪽 바깥먼바다」 도형 하나를
 *         동경 126°17'40" 선으로 잘라 「제주도 남서쪽 바깥먼바다」·「제주도 남동쪽 바깥먼바다」 두 개로 바꾼 그림(45개)을 만든다.
 *         전환(config/zone_split.js) 뒤 /api/warn-zones 가 이 그림을 내보낸다(routes/weather.js). 원본 파일은 고치지 않는다.
 * 왜 파일을 따로 두지 않고 그때그때 만드나: 원본이 1.5MB 이고 구멍 도형(_holedGeometry) 등이 다시 만들어질 수 있다 —
 *         사본을 두면 둘이 어긋난다. 원본에서 도형 하나만 바꿔 만들면 늘 원본과 같다.
 * 경계(사용자 확정 2026-11-18·22 — 기상청 담당자 확인):
 *   「기존의 남쪽바깥먼바다의 구역의 크기는 변화가 없지만 위 경위도를 이은 선을 기준으로 나뉜다」
 *   「지금 네가 기입한 선에서 경도 변화없이 위도만 아래로 쭉 내린것」 「남서쪽이 더 큰 영역, 남동쪽이 작은영역」
 *   → 기존 「남서쪽안쪽/남동쪽안쪽」 경계의 남쪽 끝점(126.294445E, 32.2525N — 옛 도형의 북쪽 꼭짓점)에서 같은 경도로 옛 도형의 남쪽 변까지.
 *   ⚠남쪽 끝점 위도는 우리 원본 도형의 남쪽 변에서 계산한 값이다(기상청 새 도형 원본은 아직 못 받았다).
 * ----------------------------------------------------------------------------
 * [구역 개편2 2026-11-28] 서해중부 먼바다 2 → 4 · 남해동부 먼바다 2 → 3 — 날씨누리 「특보(종합) · GIS로 보기」가 읽는 그림
 *   (https://www.weather.go.kr/wnuri-map/data/boundary/wrnArea.geojson, 2026-11-28 받음 — 특보구역 48개, 코드가 MMIS 지도 목록과 같다)의
 *   새 구역 좌표를 그대로 옮겨 적었다(SPLIT2_FEATURES). 옛 도형 3개(서해중부안쪽·바깥, 남해동부안쪽)를 새 도형 6개로 바꾼다 → 45 + 3 = 48개.
 *   · 남해동부중간먼바다만 남쪽 변을 직선으로 줄였다 — 날씨누리 원본은 일본 섬(대마도·고토) 해안을 따라 점 1,167개·섬 구멍 26개인데,
 *     우리 원본의 이웃 「남해동부 바깥먼바다」가 같은 변을 (127.833334, 32.615)–(130.168056, 33.678889) 직선으로 그려 두었다. 그 두 꼭짓점을 이어 틈이 없게 했다.
 *   · 같은 날 날씨누리 그림으로 제주 두 구역(S1324120·S1324220)도 대조했다 — 위 splitFeatures 가 만든 좌표와 소수 6자리까지 같다.
 *   2차 개편은 늘 적용한다(config/zone_split.js 머리 [2차 개편]).
 * [연계]
 *  - 사용하는 파일 : config/zone_split(새 이름) · client/assets/warn_zones.geojson(원본)
 *  - 서버 API      : 없음 (routes/weather.js GET /api/warn-zones 가 body() 를 내보낸다)
 *  - 나를 쓰는 곳  : routes/weather.js · 검사 test_zone_split
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const ZONE_SPLIT = require('../config/zone_split');

const SRC = path.join(__dirname, '..', '..', 'client', 'assets', 'warn_zones.geojson');
const norm = (s) => String(s || '').replace(/\s+/g, '');

/**
 * 구역 그림에서 옛 도형을 새 두 도형으로 바꾼 새 그림을 돌려준다(입력은 고치지 않는다).
 * 예: splitFeatures(원본 44개) → 45개. 「제주도 남서쪽 바깥먼바다」(서)·「제주도 남동쪽 바깥먼바다」(동)가 북쪽 꼭짓점과 남쪽 점을 똑같은 좌표로 함께 쓴다(틈 없음).
 * @param {{features: Array}} fc GeoJSON FeatureCollection
 * @returns {object} 새 FeatureCollection
 * @throws 옛 도형이 없거나 꼴이 예상과 다르면(도형 1개·구멍 없음·경계선이 변 2개와 만남) — 조용히 틀린 그림을 내보내지 않으려고
 * [연계] ← body(이 파일) · test_zone_split
 */
function splitFeatures(fc) {
    const i = fc.features.findIndex((f) => norm(f.properties && f.properties.name) === ZONE_SPLIT.OLD);
    if (i < 0) throw new Error('옛 구역 도형이 없다: ' + ZONE_SPLIT.OLD);
    const f = fc.features[i], g = f.geometry;
    if (!g || g.type !== 'MultiPolygon' || g.coordinates.length !== 1 || g.coordinates[0].length !== 1 || f.properties._holedGeometry) throw new Error('옛 구역 도형 꼴이 예상과 다르다');
    const ring = g.coordinates[0][0].slice(0, -1);   // 닫는 점 빼고
    // 경계선 = 가장 북쪽… 이 아니라 「안쪽먼바다 경계가 닿는 꼭짓점」 = 옛 도형에서 경도가 분할선과 같은 꼭짓점(126.294445E)
    const LON = 126 + 17 / 60 + 40 / 3600;
    const top = ring.findIndex((p) => Math.abs(p[0] - LON) < 1e-4);
    if (top < 0) throw new Error('분할선 위쪽 꼭짓점(126.2944E)을 못 찾았다');
    const lon = ring[top][0];
    // 분할선이 지나는 다른 변(남쪽 변) 하나를 찾아 그 위의 점을 만든다
    let cutAt = -1, cut = null;
    for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length];
        if (k === top || (k + 1) % ring.length === top) continue;
        if ((a[0] - lon) * (b[0] - lon) < 0) {
            if (cutAt >= 0) throw new Error('분할선이 변 둘 이상과 만난다');
            cutAt = k; cut = [lon, +(a[1] + (lon - a[0]) / (b[0] - a[0]) * (b[1] - a[1])).toFixed(6)];
        }
    }
    if (cutAt < 0) throw new Error('분할선이 남쪽 변과 만나지 않는다');
    // top → … → cutAt 까지 한쪽, cutAt+1 → … → top 까지 다른 쪽
    const walk = (from, to) => { const out = []; for (let k = from; ; k = (k + 1) % ring.length) { out.push(ring[k]); if (k === to) break; } return out; };
    const sideA = [...walk(top, cutAt), cut, ring[top]];
    const sideB = [ring[top], cut, ...walk((cutAt + 1) % ring.length, (top - 1 + ring.length) % ring.length), ring[top]];
    const meanLon = (r) => r.reduce((s, p) => s + p[0], 0) / r.length;
    const [west, east] = meanLon(sideA) < meanLon(sideB) ? [sideA, sideB] : [sideB, sideA];
    const make = (name, r, tag) => ({
        type: 'Feature',
        // WarnCode = 기상청 회신 코드(config/zone_split.NEW_CODES). 화면은 이름으로 맞춘다.
        properties: Object.assign({}, f.properties, { id: f.properties.id + tag, WarnCode: Object.keys(ZONE_SPLIT.NEW_CODES).find((c) => ZONE_SPLIT.NEW_CODES[c] === name) || '', name: name.replace('제주도', '제주도 ').replace('바깥먼바다', ' 바깥먼바다'), splitFrom: f.properties.name }),
        geometry: { type: 'MultiPolygon', coordinates: [[r]] },
    });
    const features = fc.features.slice();
    features.splice(i, 1, make(ZONE_SPLIT.NEW_WEST, west, 'W'), make(ZONE_SPLIT.NEW_EAST, east, 'E'));
    return Object.assign({}, fc, { features });
}

// [구역 개편2] 날씨누리 wrnArea.geojson(2026-11-28)의 새 구역 좌표 — 머리 주석. 속성 꼴은 우리 원본(warn_zones.geojson)에 맞췄다.
const SPLIT2_FEATURES = [
    ['S1252110', '서해중부북쪽안쪽먼바다', [[125.909444, 36.833333], [124.583333, 36.833333], [124.0, 38.0], [124.667873, 38.0], [124.667873, 37.983849], [124.746667, 37.961389], [124.728889, 37.8425], [124.772223, 37.779167], [125.975, 37.036389], [125.9497811, 36.9580587], [125.909444, 36.833333]]],
    ['S1252120', '서해중부북쪽바깥먼바다', [[124.583333, 36.833333], [122.7211387, 36.833333], [122.728455, 38.0], [124.0, 38.0], [124.583333, 36.833333]]],
    ['S1252210', '서해중부남쪽안쪽먼바다', [[126.274173, 35.9990539], [125.0, 36.0], [124.583333, 36.833333], [125.909444, 36.833333], [125.855, 36.664723], [126.000901, 36.5], [126.1664414, 36.313104], [126.193056, 36.283056], [126.274173, 35.9990539]]],
    ['S1252220', '서해중부남쪽바깥먼바다', [[125.0, 36.0], [122.713783, 36.0], [122.7211387, 36.833333], [124.583333, 36.833333], [125.0, 36.0]]],
    ['S1312030', '남해동부안쪽먼바다', [[127.833232, 34.420715], [128.239445, 34.611112], [128.548888, 34.618055], [128.8987, 34.8258], [129.416667, 35.133333], [128.7, 34.333333], [127.833333, 34.138333], [127.833232, 34.420715]]],
    ['S1312040', '남해동부중간먼바다', [[129.416667, 35.133333], [130.168056, 33.678889], [127.833334, 32.615], [127.833334, 33.58], [127.833333, 34.138333], [128.7, 34.333333], [129.416667, 35.133333]]],
];
const SPLIT2_OLD_NAMES = ['서해중부안쪽먼바다', '서해중부바깥먼바다', '남해동부안쪽먼바다'];

/**
 * 구역 그림에서 2차 개편 옛 도형 3개를 새 도형 6개로 바꾼 새 그림(입력은 고치지 않는다). 새 도형은 옛 도형이 있던 자리에 넣는다(그리는 순서 유지).
 * 예: splitFeatures2(45개) → 48개
 * @param {{features: Array}} fc
 * @returns {object} 새 FeatureCollection
 * @throws 옛 도형 3개 중 하나라도 없으면 — 조용히 틀린 그림(겹치는 옛 도형 + 새 도형)을 내보내지 않으려고
 * [연계] ← body(이 파일) · test_zone_split
 */
function splitFeatures2(fc) {
    const idx = SPLIT2_OLD_NAMES.map((n) => fc.features.findIndex((f) => norm(f.properties && f.properties.name) === n));
    idx.forEach((i, k) => { if (i < 0) throw new Error('2차 개편 옛 구역 도형이 없다: ' + SPLIT2_OLD_NAMES[k]); });
    const base = fc.features[idx[0]].properties;
    const make = ([code, name, ring]) => ({
        type: 'Feature',
        properties: { id: 'WRNAREA.' + code, BLN_Flag: base.BLN_Flag, WarnCode: code, name, level: base.level, ground: 'sea', source: 'wnuri-map wrnArea.geojson 2026-11-28' },
        geometry: { type: 'MultiPolygon', coordinates: [[ring]] },
    });
    const features = [];
    fc.features.forEach((f, i) => {
        if (i === idx[0]) features.push(...SPLIT2_FEATURES.slice(0, 4).map(make));        // 서해중부 4개 — 옛 안쪽 자리에
        else if (i === idx[2]) features.push(...SPLIT2_FEATURES.slice(4).map(make));      // 남해동부 안쪽·중간 — 옛 안쪽 자리에
        else if (i !== idx[1]) features.push(f);                                          // 옛 서해중부바깥은 뺀다
    });
    return Object.assign({}, fc, { features });
}

let _cache = { mtimeMs: 0, jeju: null, text: null };
/**
 * 지금 기준 구역 그림을 글자(JSON)로 돌려준다 — 2차 개편은 늘, 제주 분할은 전환 뒤에만. 원본 파일이 바뀌거나 제주 전환 여부가 바뀌면 다시 만든다.
 * 예: body() → '{"type":"FeatureCollection",…48개…}'(제주 전환 뒤) · 47개(전환 전)
 * @returns {string}
 * [연계] ← routes/weather.js GET /api/warn-zones
 */
function body() {
    const mtimeMs = fs.statSync(SRC).mtimeMs;
    const jeju = ZONE_SPLIT.isActive();
    if (_cache.text && _cache.mtimeMs === mtimeMs && _cache.jeju === jeju) return _cache.text;
    let fc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
    if (jeju) fc = splitFeatures(fc);
    _cache = { mtimeMs, jeju, text: JSON.stringify(splitFeatures2(fc)) };
    return _cache.text;
}

module.exports = { splitFeatures, splitFeatures2, SPLIT2_FEATURES, body };
