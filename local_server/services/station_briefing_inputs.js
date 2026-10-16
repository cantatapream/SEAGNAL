/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing_inputs.js
 * 역할  : 관할 브리핑의 「입력 묶음」을 앱이 이미 가진 자료에서 모은다 — 파출소 관할 97곳(정리판), 해상(공식 사고예보·혼잡 예보·해구 예보·
 *         특보·과거 선박사고), 육상(연안 하루 값·위험구역), 조석(물빠짐 앵커 곡선·잠기는 바위), 기상청 해상 기상 전망, 파출소 대표 위치.
 *         새로 외부에서 수집하지 않는다(파출소 주소 → 좌표만 운영 서버가 처음 한 번 카카오 주소 검색, 실패하면 대체 위치 + 「대표 위치 추정」).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : config/coastal_safety/coastguard_stations.geojson(관할 97곳) · coastal_hazard_zones.wgs84.geojson(위험구역)
 *                    · services/risk_store.js(marineInputs·spots·coastDayDetail — 읽기·호출만) · services/marine_fusion.js(stationAt·cellHistory·warnTime)
 *                    · services/marine_congestion_codec.js · services/sea_warning_history.js(levelOf) · services/tide_field_common.js·tide_field_collector.js(앵커·곡선)
 *                    · services/hazard_rocks_submersion.js(간출암 목록) · data/hazard_rocks/submersion.json · data/marine_forecast.json(기상청 단기 해상 전망)
 *                    · services/coastal_events_collector.js(geocode — 행사 위치 찾기와 같은 카카오 호출·KAKAO_REST_API_KEY)
 *  - 서버 API      : 없음
 *  - 나를 쓰는 곳  : services/station_briefing.js(run) · scripts/test_station_briefing.js(순수 부분)
 * [로드 순서] 서버 require 부작용 없음. 무거운 정적 자료는 처음 쓸 때 읽는다.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');
const R = require('./station_briefing_rules');
const ROOT = path.join(__dirname, '..'), CONFIG = path.join(ROOT, 'config', 'coastal_safety'), DATA = path.join(ROOT, 'data');
const HOUR = 3600000;

/** 경위도 상자. 예: Polygon → [minLon,minLat,maxLon,maxLat]. @param {object} g @returns {number[]} [연계] ← loadStations */
function bounds(g) { const a = g.coordinates.flat(Infinity), xs = a.filter((_, i) => i % 2 === 0), ys = a.filter((_, i) => i % 2 === 1); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
/**
 * 관할 정리판을 읽어 관할 목록을 만든다. idx 는 marine_fusion 의 관할 id(폴리곤 순번)와 같다.
 * 예: loadStations() → 97개 [{key:'제주해양경찰서|한림파출소', idx:'88', name:'한림파출소', office:'제주해양경찰서', region:'제주지방해양경찰청', address:'…', seaOnly:false}]
 * @param {string} [configDir] @returns {object[]} [연계] ← station_briefing.run·routes(관할 목록) / 해상만 = rules.SEA_ONLY_OFFICES
 */
function loadStations(configDir = CONFIG) {
    const g = JSON.parse(fs.readFileSync(path.join(configDir, 'coastguard_stations.geojson'), 'utf8'));
    return g.features.filter((f) => ['Polygon', 'MultiPolygon'].includes(f.geometry?.type)).map((f, i) => {
        const p = f.properties || {}, seaOnly = R.SEA_ONLY_OFFICES.includes(p.station);
        return { key: p.station + '|' + p.name, idx: String(i), name: p.name, office: p.station, region: p.region || null, address: p.address || null, geometry: f.geometry, bounds: bounds(f.geometry), seaOnly, seaOnlyReason: seaOnly ? '전남 관광지 집중률 자료 없음(공식 제공 대상이나 자료 미수신) — 해상만' : null };
    });
}
/**
 * 정리판 주소의 PDF 글자 깨짐을 고친다(카카오 검색 전에). 고칠 수 없는 것(시·군 누락 등)은 그대로 두고 주소 확인 목록에 남긴다.
 * 예: '강 원 특 별 자 치 도 속초시 청호대교 로 97' → '강원특별자치도 속초시 청호대교로 97' · '민락수변로92' → '민락수변로 92'
 *     '남당항로 213번길 25-62' → '남당항로213번길 25-62' · '강현면 낙 산사로 54-14' → '강현면 낙산사로 54-14'
 * @param {string} a @returns {string} [연계] ← geocodeStation · docs 주소 확인 목록
 */
function normalizeAddress(a) {
    let s = String(a || '').trim().replace(/\s+/g, ' ');
    s = s.replace(/(?:[가-힣] ){2,}[가-힣](?=\s|$)/g, (m) => m.replace(/ /g, ''));     // 한 글자씩 띄운 도 이름
    s = s.replace(/(^|\s)([가-힣]) ([가-힣]{2,}(?:로|길))(?=\s|\d|$)/g, '$1$2$3');     // '낙 산사로'
    s = s.replace(/([가-힣]{2,}) (로|길)(?=\s|\d|$)/g, '$1$2');                          // '청호대교 로'
    s = s.replace(/([가-힣](?:로|길))(\d+)(?=\s|$|-)/g, '$1 $2');                         // '민락수변로92'
    s = s.replace(/([가-힣](?:로|길)) (\d+번길)/g, '$1$2');                               // '남당항로 213번길'
    return s;
}
/**
 * 파출소 주소 하나를 카카오로 좌표로 바꾼다 — 행사 위치 찾기(coastal_events_collector.geocode)를 그대로 쓴다(같은 키 KAKAO_REST_API_KEY,
 * 후보 중 시군구·도로/지번이 실제로 일치하는 것만 채택). 이 작업트리·시험에서는 fetchImpl 을 가짜로 넣는다(실제 호출 금지).
 * 예: await geocodeStation('인천광역시 옹진군 영흥면 영흥로 109-18', {fetchImpl, key}) → {lat,lon,resolvedAddress}
 *     일치 없음 → throw Error('unmatched event') · 주소 해석 불가 → 'invalid event' · 키 없음 → 'missing key'
 * @param {string} address @param {object} o - {fetchImpl,key} @returns {Promise<object>} [연계] ← ensureLocations
 */
async function geocodeStation(address, { fetchImpl = fetch, key = process.env.KAKAO_REST_API_KEY } = {}) {
    return require('./coastal_events_collector').geocode({ address: normalizeAddress(address) }, fetchImpl, key);
}
/**
 * 대표 위치를 못 얻었을 때의 대체값 — 그 관할에 붙은 육지 쪽 점(관광지·위험구역 중심)의 평균, 없으면 관할 폴리곤 상자 중심(바다).
 * 예: 한림(관광지 30곳) → {lat,lon,method:'관할 관광지·위험구역 중심 평균(30점)'} · 여호(둘 다 없음) → {method:'관할 해역 상자 중심(바다)'}
 * @param {object} st - loadStations 항목 @param {object[]} points - [{lat,lon}] @returns {object} [연계] ← ensureLocations
 */
function estimateLocation(st, points) {
    const p = (points || []).filter((q) => Number.isFinite(q.lat) && Number.isFinite(q.lon));
    if (p.length) return { lat: +(p.reduce((a, q) => a + q.lat, 0) / p.length).toFixed(5), lon: +(p.reduce((a, q) => a + q.lon, 0) / p.length).toFixed(5), method: '관할 관광지·위험구역 중심 평균(' + p.length + '점)' };
    const b = st.bounds; return { lat: +((b[1] + b[3]) / 2).toFixed(5), lon: +((b[0] + b[2]) / 2).toFixed(5), method: '관할 해역 상자 중심(바다)' };
}
/**
 * 관할 대표 위치를 정한다(캐시 파일 + 처음 한 번 카카오). 다시 묻는 경우: 주소가 바뀜 · 지난번이 호출 고장(error — 네트워크·HTTP·키 없음).
 * 「일치 없음」(unmatched/invalid)은 같은 주소로 다시 묻지 않는다(답이 같다). 실패한 관할은 estimateLocation + estimated:true.
 * 예: await ensureLocations({stations, landPoints, file, geocoder:null}) → {'…|한림파출소': {lat,lon,source:'estimate',estimated:true,method,…}}
 * @param {object} o - stations·landPoints(key→점들)·file·geocoder(주소→Promise 좌표, 없으면 묻지 않음)·now
 * @returns {Promise<object>} key → 위치 [연계] ← station_briefing.run / 운영(FLY)에서만 geocoder 를 넘긴다
 */
async function ensureLocations({ stations, landPoints = {}, file = path.join(DATA, 'station_briefing', 'locations.json'), geocoder = null, now = Date.now() }) {
    const cache = readJson(file) || { v: 1, stations: {} }, out = {};
    let changed = false;
    for (const st of stations) {
        let c = cache.stations[st.key];
        const ask = geocoder && (!c || c.address !== st.address || c.status === 'error');
        if (ask) {
            try { const g = await geocoder(st.address); c = { status: 'ok', address: st.address, query: normalizeAddress(st.address), lat: g.lat, lon: g.lon, resolvedAddress: g.resolvedAddress || null, checkedAt: R.isoKst(now) }; }
            catch (e) { const why = String(e.message || ''); c = { status: /^(unmatched event|invalid event)$/.test(why) ? 'unmatched' : 'error', address: st.address, query: normalizeAddress(st.address), reason: /^(unmatched event|invalid event|missing key|HTTP \d{3})$/.test(why) ? why : 'network or parse error', checkedAt: R.isoKst(now) }; console.warn('[station_briefing] 대표 위치 카카오 실패 — ' + st.name + ': ' + c.reason + ' (추정 위치를 쓴다)'); }
            cache.stations[st.key] = c; changed = true;
        }
        if (c && c.status === 'ok') out[st.key] = { lat: c.lat, lon: c.lon, source: 'kakao', estimated: false, address: st.address, resolvedAddress: c.resolvedAddress };
        else { const e = estimateLocation(st, landPoints[st.key]); out[st.key] = { lat: e.lat, lon: e.lon, source: 'estimate', estimated: true, method: e.method, address: st.address, geocode: c ? c.status : 'not_tried' }; }
    }
    if (changed) writeJson(file, cache);
    return out;
}
/** JSON 파일 읽기(없거나 깨지면 null). @param {string} f @returns {object|null} [연계] ← 여러 곳 */
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }
/** 원자적 JSON 쓰기(임시 파일 → 이름 바꾸기). @param {string} f @param {object} d @returns {void} [연계] ← ensureLocations·station_briefing */
function writeJson(f, d) { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(d)); fs.renameSync(t, f); }

/**
 * 관광지를 관할에 붙인다 — 관광지 표의 파출소 이름(10km 최근접 규칙으로 이미 정해진 것) 그대로, 같은 이름(남항파출소 부산·목포)은 가까운 폴리곤.
 * 예: assignSpots(stations, store.spots().spots) → Map{'제주해양경찰서|한림파출소' → [관광지 30곳]}
 * @param {object[]} stations @param {object[]} spots - risk_store.spots().spots @returns {Map} [연계] ← gather
 */
function assignSpots(stations, spots) {
    const G = require('./risk_geo'), byName = new Map(), out = new Map(stations.map((s) => [s.key, []]));
    for (const s of stations) { if (!byName.has(s.name)) byName.set(s.name, []); byName.get(s.name).push(s); }
    for (const p of spots || []) {
        const list = byName.get(p.police?.name) || [];
        const st = list.length === 1 ? list[0] : list.length > 1 ? list.slice().sort((a, b) => G.distanceToGeometry([p.lon, p.lat], a.geometry) - G.distanceToGeometry([p.lon, p.lat], b.geometry))[0] : null;
        if (st) out.get(st.key).push(p);
    }
    return out;
}
/**
 * 위험구역을 관할에 붙인다 — 자료의 「관할파출소」+「소속서」, 이름이 하나면 이름만(강릉서 신설은 위험구역 자료에 없음), 못 찾으면(목포남항 5곳) 같은 소속서의 가까운 폴리곤.
 * 예: assignHazards(stations, features) → Map{key → [{id,place,shape,class,lat,lon}]}
 * @param {object[]} stations @param {object[]} features - coastal_hazard_zones.wgs84.geojson features @returns {Map} [연계] ← gather
 */
function assignHazards(stations, features) {
    const G = require('./risk_geo'), out = new Map(stations.map((s) => [s.key, []]));
    for (const f of features || []) {
        const q = f.properties || {}, police = String(q['관할파출소'] || ''), nm = /(파출소|출장소)$/.test(police) ? police : police + '파출소';
        const pts = (f.geometry?.coordinates || []).flat(Infinity), lon = pts.filter((_, i) => i % 2 === 0).reduce((a, v, _, arr) => a + v / arr.length, 0), lat = pts.filter((_, i) => i % 2 === 1).reduce((a, v, _, arr) => a + v / arr.length, 0);
        let c = stations.filter((s) => s.name === nm);
        if (c.length > 1) c = c.filter((s) => s.office === q['소속서']).length ? c.filter((s) => s.office === q['소속서']) : c;
        if (!c.length) c = stations.filter((s) => s.office === q['소속서']);
        if (!c.length) continue;
        const st = c.length === 1 ? c[0] : c.slice().sort((a, b) => G.distanceToGeometry([lon, lat], a.geometry) - G.distanceToGeometry([lon, lat], b.geometry))[0];
        out.get(st.key).push({ id: q.name, place: q['장소명'], shape: q['장소형태'], class: q['구역분류'], lat: +lat.toFixed(5), lon: +lon.toFixed(5) });
    }
    return out;
}
/** 예보 시각 열쇠(YYYYMMDDHH00, KST). 예: '2026-10-17T15:00:00+09:00' → '202610171500'. @param {string} at @returns {string} [연계] ← collectSea */
function forecastKey(at) { return at.slice(0, 4) + at.slice(5, 7) + at.slice(8, 10) + at.slice(11, 13) + '00'; }
/** 특보 종류 이름. 예: 'V' → '풍랑'. @param {string} s @returns {string} [연계] ← warningsFromTree */
function typeOf(s) { const v = String(s || ''); return { V: '풍랑', T: '태풍', O: '폭풍해일', W: '강풍' }[v.toUpperCase()] || v; }
/**
 * 특보 크롤러 결과 트리(weather_alerts.json current)에서 구역들의 발효·예비 특보를 꺼내 시각을 읽는다(지어내지 않는다 — 못 읽은 시각은 null).
 * 부모 구역: current = 발효, upcoming = 예비. 자식(연안바다·평수구역): 등급 글자에 「예비」가 있으면 예비, 주의보·경보면 발효.
 * 예: warningsFromTree(tree, new Set(['제주도북부앞바다']), now) → [{zone:'제주도북부앞바다',kind:'앞바다',type:'풍랑',level:'주의보',state:'발효',effective:{…},release:{start,end,range}}]
 * @param {object} tree @param {Set<string>} zones - 구역 열쇠(zoneKey) @param {number} now @returns {object[]} [연계] ← collectSea / → marine_fusion.warnTime
 */
function warningsFromTree(tree, zones, now) {
    const { warnTime } = require('./marine_fusion'), { zoneKind } = require('./warn_zone_cells'), out = [];
    const push = (zone, sub, b, upcoming) => {
        if (!b || typeof b !== 'object' || !zones.has(R.zoneKey(zone))) return;
        const raw = String(b.wrnLvlNm || b.wrnLvl || ''), pre = upcoming || /예비/.test(raw);
        if (!pre && !/주의보|경보/.test(raw)) return;
        if (/해제/.test(raw)) return;
        const issued = warnTime(b.tmFc, now), anchor = issued ? Date.parse(issued.start) : now;
        out.push({ zone, kind: zoneKind(zone, sub), type: typeOf(b.wrnTpNm || b.wrnTp), level: /경보/.test(raw) ? '경보' : '주의보', state: pre ? '예비' : '발효', issued, effective: warnTime(b.tmEf, anchor), release: pre ? null : warnTime(b.clrNtcTm || b.tmCc || b.tmYn, anchor) });
    };
    (function walk(n) {
        if (!n || typeof n !== 'object') return;
        for (const [name, v] of Object.entries(n)) {
            if (!v || typeof v !== 'object') continue;
            if (Object.hasOwn(v, 'children') && (Object.hasOwn(v, 'current') || Object.hasOwn(v, 'upcoming'))) {
                push(name, false, v.current, false); push(name, false, v.upcoming, true);
                for (const [child, b] of Object.entries(v.children || {})) push(child, true, b, false);
            } else walk(v);
        }
    })(tree);
    return out;
}
/** 점이 든 사고 칸을 찾는 격자 색인(0.1도). 예: idx.find([126.24,33.44]) → 사고 칸 | null. @param {object[]} cells @returns {object} [연계] ← collectSea */
function cellIndex(cells) {
    const G = require('./risk_geo'), map = new Map();
    for (const c of cells || []) { const b = bounds(c.geometry); for (let x = Math.floor(b[0] * 10); x <= Math.floor(b[2] * 10); x++) for (let y = Math.floor(b[1] * 10); y <= Math.floor(b[3] * 10); y++) { const k = x + ',' + y; if (!map.has(k)) map.set(k, []); map.get(k).push({ c, b }); } }
    return { find(p) { return (map.get(Math.floor(p[0] * 10) + ',' + Math.floor(p[1] * 10)) || []).filter(({ c, b }) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && G.pointInGeometry(p, c.geometry)).map((x) => x.c).sort((a, b) => a.id.localeCompare(b.id))[0] || null; } };
}
/**
 * 해상 입력을 관할마다 모은다 — 관할 안 모든 칸(공식 사고 5km 칸 + 혼잡 교통 칸, 칸 중심이 든 관할 — marine_fusion.briefing 과 같은 규칙)을
 * 해역으로 묶고(같은 공식 사고 칸에 든 교통 칸은 하나), 창의 3시간 칸마다 공식 사고 단계·그 3시간 중 가장 높은 혼잡 예보를 붙인다.
 * 예: collectSea(stations, {risk, marine, win, now}) → Map{key → {reviewedCells, regions:[{rid,lat,lon,haegu,ref,zone,slots:{at:{accident,congestion}},history}], weather:{major:{label,rows}}, warnings:[…]}}
 * @param {object[]} stations @param {object} o - risk(risk_store)·marine(marine_fusion 저장소)·win·now @returns {object} {bySt:Map, sources}
 * [연계] ← gather / → marine.stationAt·cellHistory·codec.rowAt·warningsFromTree
 */
function collectSea(stations, { risk, marine, win, now }) {
    const codec = require('./marine_congestion_codec'), inputs = risk.marineInputs(), src = inputs.sources || {};
    const byIdx = new Map(stations.map((s) => [s.idx, s])), bySt = new Map(stations.map((s) => [s.key, { cells: new Set(), groups: new Map() }]));
    const acc = inputs.accident?.cells || [], idx = cellIndex(acc), accById = new Map(acc.map((c) => [c.id, c]));
    const visit = (c, kind) => {
        const st = marine.stationAt([c.lon, c.lat]), s = st && byIdx.get(st.id); if (!s) return;
        const e = bySt.get(s.key); e.cells.add(kind + ':' + c.id);
        const a = kind === 'A' ? c : idx.find([c.lon, c.lat]), gid = a ? 'A:' + a.id : 'T:' + c.id;
        if (!e.groups.has(gid)) e.groups.set(gid, { base: a || c, accident: a || null, traffic: [] });
        if (kind === 'T') e.groups.get(gid).traffic.push(c.id);
    };
    for (const c of acc) visit(c, 'A');
    for (const c of inputs.cells?.cells || []) if (String(c.id).startsWith('GR4_')) visit(c, 'T');
    const ids = codec.cellIds(inputs.congestion), frames = inputs.accident?.frames || {}, rowCache = new Map();
    const accLevel = (key, i) => { if (!rowCache.has(key)) rowCache.set(key, new Map((frames[key] || []).map((r) => [r[0], r[2]]))); return rowCache.get(key).get(i) || null; };
    const zonesWanted = new Set(), out = new Map();
    for (const s of stations) {
        const e = bySt.get(s.key), regions = [], majors = new Set();
        for (const [gid, g] of e.groups) {
            const b = g.base, slots = {};
            for (const at of win.slots) {
                let best = null;
                for (let h = 0; h < 3; h++) {
                    const hk = forecastKey(R.isoKst(Date.parse(at) + h * HOUR));
                    for (const id of g.traffic) { const r = codec.rowAt(inputs.congestion, hk, id, ids); if (!r) continue; const rank = { '낮음': 0, '보통': 1, '높음': 2, '매우높음': 3 }[r.congestionLevel] ?? -1; if (!best || rank > best.rank || (rank === best.rank && r.congestionIndex > best.index)) best = { rank, level: r.congestionLevel, index: r.congestionIndex, at: R.isoKst(Date.parse(at) + h * HOUR) }; }
                }
                slots[at] = { accident: g.accident ? accLevel(forecastKey(at), g.accident.i) : null, congestion: best ? { level: best.level, index: best.index, at: best.at } : null };
            }
            const geom = g.accident?.geometry || { type: 'Polygon', coordinates: [[[b.lon - .0125, b.lat - .0125], [b.lon - .0125, b.lat + .0125], [b.lon + .0125, b.lat + .0125], [b.lon + .0125, b.lat - .0125], [b.lon - .0125, b.lat - .0125]]] };
            const zone = b.warnSubZone ? { name: b.warnSubZone, kind: 'sub' } : b.warnZone ? { name: b.warnZone, kind: 'main' } : null;
            if (b.warnZone) zonesWanted.add(R.zoneKey(b.warnZone)); if (b.warnSubZone) zonesWanted.add(R.zoneKey(b.warnSubZone));
            if (b.haegu?.major) majors.add(b.haegu.major);
            regions.push({ rid: gid, gridId: g.traffic[0] || null, accidentGridId: g.accident?.id || null, lat: b.lat, lon: b.lon, haegu: b.haegu || null, ref: b.ref || null, zone, zones: [b.warnZone, b.warnSubZone].filter(Boolean), cellCount: g.traffic.length + (g.accident ? 1 : 0), slots, history: marine.cellHistory(geom, 'grid:' + (g.accident?.id || b.id)) });
        }
        const weather = {};
        for (const major of majors) weather[major] = { label: '대해구 ' + major, rows: win.slots.map((at) => { const f = inputs.weather(major, at); return { at, wh: f.wh, ws: f.ws, forecastAt: f.forecastAt }; }) };
        out.set(s.key, { reviewedCells: e.cells.size, regions, weather, zones: [...new Set(regions.flatMap((r) => r.zones))] });
    }
    const all = warningsFromTree(inputs.warnings?.current, zonesWanted, now);
    for (const [, v] of out) { const ks = new Set(v.zones.map(R.zoneKey)); v.warnings = all.filter((w) => ks.has(R.zoneKey(w.zone))); }
    return { bySt: out, sources: { accident: src.accident?.status || 'missing', congestion: src.congestion?.status || 'missing', zoneForecasts: src.zoneForecasts?.status || 'missing', warnings: src.warnings?.status || 'missing', tourConcentration: src.tourConcentration?.status || 'missing', events: src.events?.status || 'missing' } };
}
/**
 * 육상 입력: 관할에 붙은 관광지마다 연안 하루 값(coastDayDetail — 그날 3시간 칸 중 가장 높은 칸, T24)을 그대로 쓰고, 관광지에 안 붙은 위험구역은 상시 위험 장소로.
 * 예: collectLand(spots, hazards, {risk, t:'2026-10-17T08:00:00+09:00'}) → {spots:[{id,name,index,band,people:{ratio,score},event,swell,rip,notices,hazard,history,missing}], hazardOnly:[…]}
 * @param {object[]} spots @param {object[]} hazards @param {object} o - risk·t @returns {object} [연계] ← gather / → risk_store.coastDayDetail(읽기만)
 */
function collectLand(spots, hazards, { risk, t }) {
    const out = [], linked = new Set();
    for (const p of spots) {
        let d; try { d = risk.coastDayDetail(p.id, t); } catch (e) { out.push({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, beach: !!p.beach, missing: ['detail'], error: e.status || 500 }); continue; }
        const row = (k) => (d.rows || []).find((r) => r.key === k) || null, hz = row('hazard'), people = row('people'), ev = row('event'), sw = row('swell'), rip = row('rip');
        const notice = (k) => (d.notices || []).find((n) => n.key === k) || null, wn = notice('warning'), dr = notice('drift');
        for (const z of hz?.zones || []) linked.add(z.id);
        const acc = d.history?.available ? d.history.accidents || [] : null, types = {};
        for (const a of acc || []) types[a.type] = (types[a.type] || 0) + 1;
        out.push({
            id: p.id, name: p.name, lat: p.lat, lon: p.lon, beach: !!p.beach, index: d.index, band: d.band, peakAt: d.daily?.peakAt || d.t,
            people: people && !people.missing ? { ratio: people.ratio, score: people.score } : null, event: ev && ev.name ? { name: ev.name, weekend: !!ev.weekend } : null,
            swell: sw ? { periodS: sw.periodS } : null, rip: rip ? { level: rip.level } : null,
            notices: { effective: wn?.effective || [], prelim: wn?.prelim || [], windMs: dr ? dr.windMs : null },
            hazard: hz ? { count: hz.count || 0, byType: (hz.byType || []).map((x) => ({ class: x.class, count: x.count })) } : null,
            history: acc ? { count: acc.length, from: d.history.from, to: d.history.to, topTypes: Object.entries(types).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).slice(0, 3).map(([type, count]) => ({ type, count })) } : null,
            missing: d.missing || [],
        });
    }
    return { spots: out, hazardOnly: hazards.filter((z) => !linked.has(z.id)) };
}
/**
 * 조석: 대표 위치가 서해·남해(물빠짐 대상 해역)이면 가장 가까운 앵커(25km 안 — tide_field 보간 반경과 같다)의 대상 날짜 곡선으로
 * 고조·저조와 게이지용 곡선(10분 간격)을 만든다. 잠기는 바위(간출암)는 관할 폴리곤 안의 것만, 그날 잠기는 시각.
 * 예: collectTide(태안 위치, '2026-10-17', geometry) → {anchorId:'A12',distKm:3.2,date:'2026-10-17',curve:[{t:'00:00',cm:312},…144],peaks:[{type:'low',t:'06:12',cm:-12},…],prevPeak,nextPeak,rocks:{count:3,first:'05:40',last:'07:10'}}
 * @param {object} loc - {lat,lon} @param {string} date - YYYY-MM-DD @param {object} geometry - 관할 폴리곤 @param {object} [deps] - 시험용 주입(anchors·readCurve·rocks·crossings)
 * @returns {object|null} 서해·남해가 아니거나 앵커·곡선이 없으면 null(사유 reason) [연계] ← gather
 */
function collectTide(loc, date, geometry, deps = {}) {
    const TFC = require('./tide_field_common');
    if (!loc || !TFC.isWestSouthSea(loc.lat, loc.lon)) return null;
    const anchors = deps.anchors || require('./tide_field_collector').loadAnchors() || [];
    const near = anchors.map((a) => ({ a, d: TFC.haversineKm(loc.lat, loc.lon, a.lat, a.lon) })).filter((x) => x.d <= TFC.TIDE_FIELD_CONFIG.INTERP_MAX_KM).sort((x, y) => x.d - y.d)[0];
    if (!near) return null;
    const read = deps.readCurve || ((id, ymd) => readJson(require('./tide_field_collector').curvePath(id, ymd)));
    const ymd = date.replace(/-/g, ''), shift = (n) => R.kstDate(Date.parse(date + 'T00:00:00+09:00') + n * 24 * HOUR).replace(/-/g, '');
    const cur = read(near.a.id, ymd);
    if (!cur || !Array.isArray(cur.curve) || !cur.curve.length) return null;
    const peaksOf = (c) => c && c.peaks ? Object.entries(c.peaks).filter(([, v]) => v && v.time).map(([k, v]) => ({ type: k.startsWith('low') ? 'low' : 'high', t: v.time, cm: v.height })).sort((a, b) => a.t.localeCompare(b.t)) : [];
    const peaks = peaksOf(cur), prev = peaksOf(read(near.a.id, shift(-1))).at(-1) || null, next = peaksOf(read(near.a.id, shift(1)))[0] || null;
    const curve = cur.curve.filter((p) => /:[0-5]0$/.test(p.t)).map((p) => ({ t: p.t, cm: p.h }));
    let rocks = null;
    try {
        const G = require('./risk_geo'), list = deps.rocks || require('./hazard_rocks_submersion').loadRocks(), cr = deps.crossings || readJson(path.join(require('./hazard_rocks_tide_common').HAZARD_ROCKS_TIDE_DIR, 'submersion.json'))?.crossings || {};
        const times = [];
        for (const r of list) { if (!G.pointInGeometry([r.lon, r.lat], geometry)) continue; for (const iso of cr[String(r.id)] || []) { const k = R.isoKst(Date.parse(iso)); if (k.slice(0, 10) === date) times.push(k.slice(11, 16)); } }
        times.sort(); if (times.length) rocks = { count: new Set(list.filter((r) => (cr[String(r.id)] || []).some((iso) => R.isoKst(Date.parse(iso)).slice(0, 10) === date) && G.pointInGeometry([r.lon, r.lat], geometry)).map((r) => r.id)).size, first: times[0], last: times.at(-1) };
    } catch (_) { rocks = null; /* 간출암 자료 없음 — 문구만 빠진다 */ }
    return { anchorId: near.a.id, distKm: +near.d.toFixed(1), date, status: cur.status || null, curve, peaks, prevPeak: prev, nextPeak: next, rocks };
}
/**
 * 기상청 해상 기상 전망(단기 통보문) 원문 발췌 — marine_forecast_processor 가 10분마다 저장한 data/marine_forecast.json 의 shortTerm.codeCategories(원문에서 코드로 잘라 낸 것, AI 가공본 아님).
 * 항목마다 600자까지. AI 입력에는 원인·흐름 이해용으로만 넣고 숫자·지명은 허용 목록에 넣지 않는다.
 * 예: kmaOutlook() → {title:'[해설] 단기 해상 전망',publishTime:'10.16. 16:30',forecastPeriod:'※ …',excerpt:{해상:'…',강풍:'…'}} · 파일 없음 → null
 * @param {string} [dataDir] @returns {object|null} [연계] ← station_briefing.run → station_briefing_ai.batchInput
 */
function kmaOutlook(dataDir = DATA) {
    const d = readJson(path.join(dataDir, 'marine_forecast.json')), s = d && d.shortTerm;
    if (!s || !s.codeCategories) return null;
    const excerpt = {}; for (const k of ['해상', '강풍', '너울', '바다안개']) if (typeof s.codeCategories[k] === 'string') excerpt[k] = s.codeCategories[k].slice(0, 600);
    return { title: s.title || null, publishTime: s.publishTime || null, forecastPeriod: s.forecastPeriod || null, excerpt };
}
/**
 * 관할들의 입력 묶음을 만든다(rules.buildBriefing 에 그대로 넣을 수 있는 꼴).
 * 예: await gather({stations, risk, marine, win, now, locations}) → [{key,name,office,region,seaOnly,location,sources,sea,places,land,tide}]
 * @param {object} o - stations(대상 관할만)·allStations·risk·marine·win·now·locations(key→위치)·hazards(Map)·spotsBySt(Map)·tideDeps
 * @returns {object[]} [연계] ← station_briefing.run / → collectSea·collectLand·collectTide
 */
function gather({ stations, risk, marine, win, now, locations, hazards, spotsBySt, tideDeps }) {
    const sea = collectSea(stations, { risk, marine, win, now });
    const landT = win.targetDate === R.kstDate(now) ? R.isoKst(Math.floor(now / 60000) * 60000) : win.targetDate + 'T00:00:00+09:00';
    return stations.map((st) => {
        const spots = spotsBySt.get(st.key) || [], hz = hazards.get(st.key) || [], s = sea.bySt.get(st.key);
        return {
            key: st.key, name: st.name, office: st.office, region: st.region, seaOnly: st.seaOnly, seaOnlyReason: st.seaOnlyReason,
            location: locations[st.key] || null, sources: sea.sources,
            sea: { reviewedCells: s.reviewedCells, regions: s.regions, weather: s.weather, warnings: s.warnings },
            places: spots.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })).concat(spots.length ? [] : hz.map((z) => ({ name: z.place, lat: z.lat, lon: z.lon }))),
            land: st.seaOnly ? null : collectLand(spots, hz, { risk, t: landT }),
            tide: collectTide(locations[st.key], win.targetDate, st.geometry, tideDeps),
        };
    });
}

module.exports = { loadStations, normalizeAddress, geocodeStation, estimateLocation, ensureLocations, assignSpots, assignHazards, warningsFromTree, collectSea, collectLand, collectTide, kmaOutlook, gather, forecastKey, readJson, writeJson, CONFIG, DATA };
