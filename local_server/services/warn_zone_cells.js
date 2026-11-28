/**
 * 파일명: local_server/services/warn_zone_cells.js
 * 역할  : GR4 교통 칸(0.025° 정사각) 중심이 어느 해상 특보구역에 드는지 찾는다 — 본구역(앞바다·먼바다)과
 *         세부구역(연안바다·평수구역)을 따로 돌려준다. 교통량 그래프 배경에 그 칸의 특보를 깔기 위해서다.
 *         사용자 2026-10-15: 「특보 구역은 알고 있지?(연안바다, 평수구역 구분 필요)」
 * [연계] client/assets/warn_zones.geojson(앞바다25·먼바다19) · warn_zones_sub.geojson(연안바다22·평수구역27)
 *        · sea_realtime_collector.cellBounds(칸 번호→경계) · risk_geo.pointInGeometry(안팎 판정)
 *        · 나를 쓰는 곳: sea_traffic_history.createApi(조회 API) · marine_fusion(해상 상세의 발효 중 특보 상자 — 2026-10-16)
 *        · 판정 규칙은 risk_sea_cells.describe(warnZone·warnSubZone)와 같다(중심점·원래 geometry·파일 순서 첫 일치).
 * [구역 개편 2026-11-28] 본구역은 원본 파일이 아니라 앱이 받는 지금 그림(services/warn_zones_split.body() — /api/warn-zones 와 같은 것)에서 읽는다.
 *        원본은 옛 이름(서해중부안쪽·바깥먼바다·제주도남쪽바깥먼바다)이라 특보 나무의 새 구역 이름과 안 맞아 특보가 안 붙었다
 *        (사용자 2026-11-28 「고쳐」 — 위험예측·교통량·해상 날씨 상자·브리핑이 이 표를 쓴다). 제주 전환 여부가 바뀌면 다시 읽는다.
 *        currentZoneName: 옛 이름으로 적힌 표(위험예측 관광지 표 등)를 위치로 새 구역에 맞춘다.
 * [로드 순서] 서버 require 부작용 없음. 첫 호출 때 두 파일을 한 번 읽어 이름·코드·경계 좌표만 남기고(나머지 속성·
 *        구멍 뚫린 표시용 도형은 버린다), 칸별 결과는 캐시한다.
 */
'use strict';
const fs = require('fs'), path = require('path');
const G = require('./risk_geo');
const { cellBounds } = require('./sea_realtime_collector');
const ASSETS = path.join(__dirname, '..', '..', 'client', 'assets');

/**
 * 특보구역 이름을 비교용 열쇠로 만든다(띄어쓰기·가운뎃점·마침표를 지운다).
 * 예: '인천.경기북부앞바다' → '인천경기북부앞바다', '태안서산북쪽 평수구역' 과 '태안·서산북쪽평수구역' 은 같은 열쇠
 * @param {string} name - geojson 또는 특보 트리(weather_alerts.json)의 구역 이름 @returns {string} 열쇠
 * [연계] ← zonesOfCell·sea_warning_history.list — 지도 파일과 크롤러 트리의 표기가 달라서(2026-10-15 실측 93개 전부 이 규칙으로 일치)
 */
function zoneKey(name) { return String(name || '').replace(/[\s·.]/g, ''); }

/**
 * 구역 이름으로 종류를 가른다. 예: '울산앞바다중 연안바다' → '연안바다', '동해중부 안쪽먼바다' → '먼바다'
 * @param {string} name - 구역 이름 @param {boolean} sub - 세부구역 파일(연안바다·평수구역)에서 왔는지
 * @returns {string} '앞바다'|'먼바다'|'연안바다'|'평수구역'
 * [연계] ← load·sea_warning_history.extract — 세부구역은 이름 끝이 평수구역/연안바다, 본구역은 먼바다 포함 여부
 */
function zoneKind(name, sub) {
    const s = String(name || '');
    if (sub) return /평수구역/.test(s) ? '평수구역' : '연안바다';
    return /먼바다/.test(s) ? '먼바다' : '앞바다';
}

let tables = null;
const cache = new Map();
/**
 * 두 geojson 을 한 번 읽어 판정에 필요한 것만 남긴다. 예: { main:[{name,code,kind,key,box,geometry}], sub:[…] }
 * @returns {object} 본구역·세부구역 표
 * [연계] ← zonesOfCell / 메모리: 원본 1.6MB 중 _holedGeometry(화면용 구멍 도형)·기타 속성은 버린다
 */
function load() {
    const jeju = require('../config/zone_split').isActive();
    if (tables && tables.jeju === jeju) return tables;
    cache.clear();   // 그림이 바뀌면 칸별 결과도 버린다
    const fromFeatures = (features, sub) => features.map((f) => {
        const p = f.properties || {}, pts = f.geometry.coordinates.flat(Infinity);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < pts.length; i += 2) { minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]); minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]); }
        return { name: String(p.name), code: p.WarnCode || null, kind: zoneKind(p.name, sub), key: zoneKey(p.name), box: [minX, minY, maxX, maxY], geometry: { type: f.geometry.type, coordinates: f.geometry.coordinates } };
    });
    const read = (file, sub) => fromFeatures(JSON.parse(fs.readFileSync(path.join(ASSETS, file), 'utf8')).features, sub);
    // 본구역 = 지금 그림(개편 반영 48개 — 제주 전환 전이면 47개). 세부구역(연안바다·평수구역 49개)은 바뀐 것이 없어 원본 그대로.
    const main = fromFeatures(JSON.parse(require('./warn_zones_split').body()).features, false);
    tables = { jeju, main, sub: read('warn_zones_sub.geojson', true) };
    return tables;
}

/**
 * 옛 구역 이름으로 적힌 자료(위험예측 관광지 표 risk_spots.json·해상 칸 표 sea_cells.json 등)를 그 위치가 든 **지금 구역 이름**으로 바꾼다.
 *   옛 이름이 아니면 그대로. 새 구역들 중 그 점을 품는 것 → 없으면(경계 위·소수 오차) 가장 가까운 것.
 *   파일은 고치지 않는다 — risk_spots.json 은 사고 집계표가 해시로 묶여 있어 고치면 집계가 꺼진다.
 * 예: currentZoneName('서해중부안쪽먼바다', [124.70, 37.84]) → '서해중부북쪽안쪽먼바다'(대청도) · currentZoneName('울산앞바다', p) → '울산앞바다'
 * @param {string} name - 자료에 적힌 구역 이름 @param {number[]} p - [경도, 위도] @returns {string}
 * [연계] ← risk_store(warningsFor 를 부르기 전) / → config/zone_split.isOldName·splitNames · load().main(지금 그림)
 */
function currentZoneName(name, p) {
    const ZS = require('../config/zone_split');
    if (!name || !ZS.isOldName(name) || !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return name;
    const want = new Set(ZS.splitNames([name]).map(zoneKey));
    const cand = load().main.filter((z) => want.has(z.key));
    const hit = cand.find((z) => G.pointInGeometry(p, z.geometry));
    if (hit) return zoneKey(hit.name);
    let best = null;
    for (const z of cand) { const d = G.distanceToGeometry(p, z.geometry); if (!best || d < best.d) best = { d, z }; }
    return best ? zoneKey(best.z.name) : name;
}

/**
 * 칸 중심을 품는 첫 구역을 찾는다(상자로 먼저 거른다). 예: find(main,[129.4,35.4]) → 울산앞바다 표 한 줄
 * @param {object[]} list - load() 의 main 또는 sub @param {number[]} p - [경도,위도] @returns {object|null}
 * [연계] ← zonesOfCell / risk_sea_cells.describe 와 같은 순서·같은 판정(첫 일치)
 */
function find(list, p) {
    for (const z of list) {
        if (p[0] < z.box[0] || p[0] > z.box[2] || p[1] < z.box[1] || p[1] > z.box[3]) continue;
        if (G.pointInGeometry(p, z.geometry)) return z;
    }
    return null;
}

/**
 * GR4 칸이 속한 특보구역을 돌려준다(결과 캐시). 예: zonesOfCell('GR4_F4K23_P4') → { center:[126.5375,33.5625],
 *   main:{name:'제주도북부앞바다',code:'S1323100',kind:'앞바다'}, sub:{name:'제주도북부앞바다중 연안바다',…,kind:'연안바다'} }
 * 중심이 어느 구역에도 안 들면 그 칸은 null(육지 위 중심·특보구역 밖 바다). 번호 짜임이 틀리면 null 전체.
 * @param {string} id - GR4_ 칸 번호 @returns {object|null} {center, main, sub}
 * [연계] ← sea_traffic_history.createApi(query) → 그 구역들의 특보 구간을 sea_warning_history.list 로 찾는다
 */
function zonesOfCell(id) {
    if (cache.has(id)) return cache.get(id);
    const b = cellBounds(id);
    if (!b) return null;
    const out = zonesAt([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
    // 상한이 없으면 공개 API 로 서로 다른 번호를 계속 물을 때 캐시가 끝없이 커진다(번호 짜임상 범위 안 칸이 약 100만).
    // 실제 교통 칸은 위치표 상한 30,000칸 안이므로 그보다 넉넉한 40,000에서 비우고 다시 쌓는다.
    if (cache.size >= 40000) cache.clear();
    cache.set(id, out);
    return out;
}

/**
 * 한 점(경위도)이 드는 특보구역을 돌려준다(캐시 없음 — GR4 칸이 아닌 지점용). 예: zonesAt([126.6375,33.5625]) →
 *   { center:[126.6375,33.5625], main:{name:'제주도북부앞바다',…,kind:'앞바다'}, sub:{name:'제주도북부앞바다중 연안바다',…,kind:'연안바다'} }
 * @param {number[]} p - [경도,위도] @returns {object} {center, main, sub} — 안 들면 main·sub 가 null
 * [연계] ← zonesOfCell(칸 중심) · marine_fusion(해상 상세 특보 상자 — GR4 칸이 없는 지점)
 */
function zonesAt(p) {
    const { main, sub } = load();
    const pick = (z) => z ? { name: z.name, code: z.code, kind: z.kind, key: z.key } : null;
    return { center: p, main: pick(find(main, p)), sub: pick(find(sub, p)) };
}

module.exports = { zonesOfCell, zonesAt, zoneKey, zoneKind, currentZoneName, _load: load };
