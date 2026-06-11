/**
 * zones.js — seaZoneCoordinates.js(특보구역 위경도) 로더 + 이름 매칭
 *
 * CSV 의 해역명(부모 특보구역)을 seaZoneCoordinates 의 구역으로 매칭한다.
 * 표기 변이(공백/괄호 자식해역) 정규화 후 이름으로 조회.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '../../seaZoneCoordinates.js'), 'utf8');
const _m = {};
eval(code + ';_m.Z=SEA_ZONE_COORDINATES;');
const ZONES = Object.values(_m.Z);

const norm = (s) => String(s || '').replace(/\s+/g, '').trim();
const byName = new Map(ZONES.map((z) => [norm(z.name), z]));

// 정규화 + 부스러기 제거: 괄호내용 삭제, 잔여 괄호/구두점 제거
function cleanName(raw) {
    let s = norm(raw).replace(/\(.*$/, '').replace(/[()]/g, '');
    return s;
}

/**
 * CSV 해역명 → 부모 특보구역(zone) 또는 null (좌표표에 없으면).
 *  1) 정확 매칭
 *  2) 집합명(예: "제주도앞바다" = 제주도동부/남부/서부앞바다 묶음): 같은 접두+접미(앞바다/먼바다/
 *     연안바다)를 가진 세부 구역들의 중심(centroid)으로 합성 (부모 단위 분석 합의)
 *  자식만 단독(예: "북서연안바다")인 경우는 부모 좌표가 없어 null.
 */
function resolveZone(rawArea) {
    const s = cleanName(rawArea);
    if (!s) return null;
    if (byName.has(s)) return byName.get(s);
    // 집합명 → centroid
    const m = s.match(/(앞바다|바깥먼바다|안쪽먼바다|먼바다|연안바다)$/);
    if (m) {
        const suffix = m[1];
        const prefix = s.slice(0, s.length - suffix.length);
        const cands = ZONES.filter((z) => { const n = norm(z.name); return n.startsWith(prefix) && n.endsWith(suffix); });
        if (cands.length) return centroid(s, cands);
        // region 묶음명: "동해남부앞바다"=region '동해남부' + type I(앞바다)/H(먼바다)
        const prefixIsRegion = REGIONS.has(prefix);
        if (prefixIsRegion) {
            const wantType = (suffix === '앞바다' || suffix === '연안바다') ? 'I' : 'H';
            const rc = ZONES.filter((z) => z.region === prefix && z.type === wantType);
            if (rc.length) return centroid(s, rc);
            const rc2 = ZONES.filter((z) => z.region === prefix);
            if (rc2.length) return centroid(s, rc2);
        }
    }
    return null;
}

const REGIONS = new Set(ZONES.map((z) => z.region));
function centroid(name, cands) {
    const lat = cands.reduce((a, z) => a + z.lat, 0) / cands.length;
    const lon = cands.reduce((a, z) => a + z.lon, 0) / cands.length;
    return { code: 'AGG', name, lat, lon, region: cands[0].region, type: cands[0].type, _agg: cands.length };
}

module.exports = { ZONES, resolveZone, norm };
