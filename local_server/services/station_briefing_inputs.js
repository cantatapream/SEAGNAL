/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing_inputs.js
 * 역할  : 관할 브리핑의 「입력 묶음」을 앱이 이미 가진 자료에서 모은다 — 파출소 관할 97곳(정리판), 해상(공식 사고예보·혼잡 예보·해구 예보·
 *         특보·과거 선박사고), 육상(연안 하루 값·위험구역), 조석(물빠짐 앵커 곡선·잠기는 바위), 기상청 해상 기상 전망, 파출소 대표 위치.
 *         새로 외부에서 수집하지 않는다(파출소 주소 → 좌표만 운영 서버가 처음 한 번 카카오 주소 검색, 실패하면 대체 위치 + 「대표 위치 추정」 — 한 실행 60초 상한·영구 오류 6시간 쉼).
 *         연안 특보·떠밀림 안내는 그날 칸 전부(coastDayDetail daily.notices), 공식 사고예보 프레임이 빠진 칸은 frameGaps 로 넘긴다.
 *         해역마다 가장 많이 겹치는 소해구(region.haegu.sub)의 예보 행도 붙인다(sea.weatherSmall — §11.10.19, 소해구 예보는 station_briefing.run 이 넘긴 찾기 함수로만 읽는다).
 *         해역마다 「최근 14일 선박 동향」(region.traffic — §11.10.23, 넘겨받은 sea_traffic_profile 계산기로만, 반올림 전 도형)도 붙인다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : config/coastal_safety/coastguard_stations.geojson(관할 97곳) · coastal_hazard_zones.wgs84.geojson(위험구역)
 *                    · services/risk_store.js(marineInputs·spots·coastDayDetail — 읽기·호출만) · services/marine_fusion.js(stationAt·cellHistory·warnTime)
 *                    · services/harbor_cells.js(항구 칸 — collectSea 가 그 칸의 혼잡 예보를 해역 혼잡에서 뺀다, 2026-10-19)
 *                    · services/marine_congestion_codec.js · services/sea_warning_history.js(levelOf) · services/tide_field_common.js·tide_field_collector.js(앵커·곡선)
 *                    · services/jeju_isolation_tide_collector.js·hazard_rocks_tide_collector.js(제주 앵커·곡선 — 결정 5) · services/sea_warning_history.js(이미 해제된 특보 — 결정 4, 기록기를 주입받음)
 *                    · services/hazard_rocks_submersion.js(간출암 목록) · data/hazard_rocks/submersion.json · data/marine_forecast.json(기상청 단기 해상 전망)
 *                    · services/coastal_events_collector.js(geocode — 행사 위치 찾기와 같은 카카오 호출·KAKAO_REST_API_KEY)
 *                    · client/assets/warn_zones.geojson(특보구역 — services/warn_zone_cells._load 로 읽음: 파출소에서 가장 가까운 앞바다, §11.10.1 · 30km 넘으면 가장 가까운 먼바다 — §11.10.2)
 *                    · regional_forecast.json[지방청].marineForecast(먼바다 단기 해상예보 — 앞바다가 30km 넘게 멀 때, regional_forecast_collector 가 저장)
 *                    · client/marine_zone_area.json(대해구 도형 — 총평 해구 줄 지도 펼침의 해구 상자, §11.10.3 · haeguBox) · 관할 도형(areaOf)·칸 상자(boxOf)·관광지 고립 사고 수(isolation)도 여기서 넘긴다
 *                    · regional_forecast_collector.js(loadCoastalForecasts·loadRegionalForecasts·ZONE_TO_OFFICE_MAP — 인덱스 「○○앞바다 기상예보」 표와 같은
 *                      data/regional_forecast.json 의 지방기상청 단기 해상예보·단기 전망 통보문, 처음 쓸 때 require)
 *                    · services/risk_time.js(nearest — 소해구 예보 시각 맞추기, risk_store 대해구 forecast 와 같은 규칙) · 소해구 예보는 smallzone_forecast.peek 결과를 찾기 함수로 받는다(직접 require 하지 않음)
                    · services/sea_traffic_profile.js(profiles — 해역별 최근 14일 선박 동향, station_briefing.run 이 계산기를 넘긴다 · 직접 require 하지 않음)
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
// ── 총평 근거 지도 펼침 재료(2026-10-17 사용자 결정 §11.10.3) — 브리핑 파일에 들어가므로 소수 4자리(약 11m)로 줄인다 ──
/** 경위도 소수 4자리. 예: 126.234567 → 126.2346. @param {number} v @returns {number} [연계] ← boxOf·areaOf·haeguBox */
function r4(v) { return Math.round(v * 1e4) / 1e4; }
/** 도형의 상자를 4자리로. 사고 칸(웹 메르카토르 5km 사각형)·혼잡 칸(±0.0125도)·해구(0.5도)는 모두 경위도 축에 맞은 사각형이라 상자가 곧 그 칸이다.
 * 예: 사고 칸 Polygon → [126.2187,33.4007,126.2636,33.4383]. @param {object} g @returns {number[]} [서,남,동,북] [연계] ← collectSea */
function boxOf(g) { return bounds(g).map(r4); }
/** 꺾은선 단순화(Douglas–Peucker, 경위도 그대로). 지도 펼침은 높이 약 200px(관할 30km 면 1px ≈ 150m)라 약 100m(0.001도) 안쪽 굴곡은 보이지 않는다 — 해안선을 따라 그린 관할(여호 3,106점 등)이 브리핑 파일을 키우지 않게.
 * 예: 거의 곧은 세 점 → 양 끝 두 점. @param {number[][]} pts @param {number} tol - 도 @returns {number[][]} [연계] ← areaOf */
function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]]; keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
        const [a, b] = stack.pop(), [x1, y1] = pts[a], [x2, y2] = pts[b], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
        let far = -1, fd = tol;
        for (let i = a + 1; i < b; i++) { const d = len ? Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / len : Math.hypot(pts[i][0] - x1, pts[i][1] - y1); if (d > fd) { fd = d; far = i; } }
        if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
    }
    return pts.filter((_, i) => keep[i]);
}
/** 관할 폴리곤을 단순화(약 100m)·4자리로(Polygon·MultiPolygon → 폴리곤 목록). 안쪽 고리(관할에서 뺀 섬) 중 가로·세로 모두 0.01도(약 1km) 안 되는 것은 뺀다 —
 * 약 200px 지도에서 몇 px 점이라 보이지 않고, 여호(안쪽 고리 419개)처럼 수백 개가 파일만 키운다. 바깥 고리는 모두 둔다.
 * 예: Polygon → [[[[126.1,33.3],…]]]. @param {object} g @returns {number[][][][]|null} [연계] ← gather(input.area) */
function areaOf(g) {
    if (!g || !Array.isArray(g.coordinates)) return null;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const big = (ring) => { const b = bounds({ coordinates: ring }); return b[2] - b[0] >= 0.01 || b[3] - b[1] >= 0.01; };
    return polys.map((rings) => rings.filter((ring, i) => i === 0 || big(ring)).map((ring) => simplify(ring, 0.001).map((p) => [r4(p[0]), r4(p[1])])));
}
let HAEGU_BOXES = null;
/** 대해구 번호의 상자 — client/marine_zone_area.json(해구 지도 도형, risk_sea_cells 가 대표 해구를 정하는 같은 파일)을 처음 쓸 때 한 번 읽는다. 없으면 null.
 * 예: haeguBox(232) → [126,33,126.5,33.5]. @param {number|string} major @returns {number[]|null} [연계] ← collectSea(weather[major].box) */
function haeguBox(major) {
    if (!HAEGU_BOXES) { const d = readJson(path.join(ROOT, '..', 'client', 'marine_zone_area.json')); HAEGU_BOXES = new Map(((d && d.features) || []).filter((f) => f.geometry).map((f) => [String(f.properties?.marine_zone_no), boxOf(f.geometry)])); }
    return HAEGU_BOXES.get(String(major)) || null;
}
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
// 대표 위치 카카오 묻기의 한도(독립 검토 C2·C4): 한 번 실행에서 위치 찾기 전체 60초, 한 건 15초(행사 위치 찾기 fetch 는 30초 — 그보다 먼저 끊는다).
// 영구 오류(키 없음·401·403)는 6시간, 호출 고장이 3번 이어지면 30분 동안 묻지 않는다(매 실행 97곳 재시도·로그 97줄 방지).
const GEO_BUDGET_MS = 60000, GEO_CALL_MS = 15000, GEO_PERM_BACKOFF_MS = 6 * HOUR, GEO_ERR_BACKOFF_MS = 30 * 60000, GEO_ERR_STREAK = 3;
/**
 * 관할 대표 위치를 정한다(캐시 파일 + 처음 한 번 카카오). 다시 묻는 경우: 주소가 바뀜 · 카카오에 보낼 정리된 주소(normalizeAddress)가 바뀜 · 지난번이 호출 고장(error — 네트워크·HTTP·키 없음).
 * 「일치 없음」(unmatched/invalid)은 같은 질의로 다시 묻지 않는다(답이 같다). 실패한 관할은 estimateLocation + estimated:true.
 * 시간 상한: 위치 찾기 전체 budgetMs(기본 60초)·한 건 callMs(15초) — 넘으면 남은 관할은 이번엔 묻지 않고 추정(다음 실행에 다시).
 * 영구 오류(missing key·HTTP 401/403)면 그 자리에서 멈추고 6시간 묻지 않는다, 호출 고장이 3번 이어지면 30분 — cache.backoff 에 남긴다. 실패 로그는 실행마다 한 줄로 모은다.
 * 예: await ensureLocations({stations, landPoints, file, geocoder:null}) → {'…|한림파출소': {lat,lon,source:'estimate',estimated:true,method,…}}
 * @param {object} o - stations·landPoints(key→점들)·file·geocoder(주소→Promise 좌표, 없으면 묻지 않음)·now(기록 시각, 가짜 시계 가능)
 *                     ·timer(경과 시간 재기 — 기본 Date.now)·budgetMs·callMs
 * @returns {Promise<object>} key → 위치 [연계] ← station_briefing.run / 운영(FLY)에서만 geocoder 를 넘긴다
 */
async function ensureLocations({ stations, landPoints = {}, file = path.join(DATA, 'station_briefing', 'locations.json'), geocoder = null, now = Date.now(), timer = Date.now, budgetMs = GEO_BUDGET_MS, callMs = GEO_CALL_MS }) {
    const cache = readJson(file) || { v: 1, stations: {} }, out = {}, t0 = timer(), geoErrors = [];
    let changed = false, stop = null, streak = 0;
    if (cache.backoff && Date.parse(cache.backoff.until) > now) stop = 'backoff';
    for (const st of stations) {
        let c = cache.stations[st.key];
        const query = normalizeAddress(st.address);
        const want = geocoder && (!c || c.address !== st.address || (c.query && c.query !== query) || c.status === 'error');
        if (want && !stop && timer() - t0 >= budgetMs) stop = 'budget';
        if (want && !stop) {
            let timeoutId = null;
            try {
                const left = Math.max(1, Math.min(callMs, budgetMs - (timer() - t0)));
                const g = await Promise.race([geocoder(st.address), new Promise((_, rej) => { timeoutId = setTimeout(() => rej(new Error('timeout')), left); })]);
                c = { status: 'ok', address: st.address, query, lat: g.lat, lon: g.lon, resolvedAddress: g.resolvedAddress || null, checkedAt: R.isoKst(now) }; streak = 0;
            } catch (e) {
                const why = String(e.message || '');
                c = { status: /^(unmatched event|invalid event)$/.test(why) ? 'unmatched' : 'error', address: st.address, query, reason: /^(unmatched event|invalid event|missing key|timeout|HTTP \d{3})$/.test(why) ? why : 'network or parse error', checkedAt: R.isoKst(now) };
                geoErrors.push(st.name + ':' + c.reason);
                if (c.status === 'error') streak++; else streak = 0;
                if (/^(missing key|HTTP 401|HTTP 403)$/.test(c.reason)) { stop = 'permanent'; cache.backoff = { until: R.isoKst(now + GEO_PERM_BACKOFF_MS), reason: c.reason, at: R.isoKst(now) }; }
                else if (streak >= GEO_ERR_STREAK) { stop = 'errors'; cache.backoff = { until: R.isoKst(now + GEO_ERR_BACKOFF_MS), reason: c.reason + ' ' + streak + '번 연속', at: R.isoKst(now) }; }
            } finally { clearTimeout(timeoutId); }
            cache.stations[st.key] = c; changed = true;
        }
        if (c && c.status === 'ok') out[st.key] = { lat: c.lat, lon: c.lon, source: 'kakao', estimated: false, address: st.address, resolvedAddress: c.resolvedAddress };
        else { const e = estimateLocation(st, landPoints[st.key]); out[st.key] = { lat: e.lat, lon: e.lon, source: 'estimate', estimated: true, method: e.method, address: st.address, geocode: c ? c.status : 'not_tried' }; }
    }
    if (geoErrors.length || (stop && stop !== 'backoff')) console.warn('[station_briefing] 대표 위치 카카오 실패 ' + geoErrors.length + '곳(' + geoErrors.slice(0, 5).join(', ') + (geoErrors.length > 5 ? ' …' : '') + ')' + (stop ? ' — 이번 실행 묻기 멈춤: ' + stop + (cache.backoff && stop !== 'budget' ? '(다시 묻기 ' + cache.backoff.until + ')' : '') : '') + ' — 추정 위치를 쓴다');
    if (changed) writeJson(file, cache);
    return out;
}
/** JSON 파일 읽기(없거나 깨지면 null). @param {string} f @returns {object|null} [연계] ← 여러 곳 */
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }
/** 원자적 JSON 쓰기(임시 파일 → 이름 바꾸기). 쓰기·이름 바꾸기가 실패하면 임시 파일을 지우고 오류를 그대로 던진다(.tmp 잔재 방지 — 독립 검토 C9).
 * @param {string} f @param {object} d @returns {void} [연계] ← ensureLocations·station_briefing */
function writeJson(f, d) {
    fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.' + process.pid + '.tmp';
    try { fs.writeFileSync(t, JSON.stringify(d)); fs.renameSync(t, f); }
    catch (e) { try { fs.unlinkSync(t); } catch (_) { /* 임시 파일이 아직 안 생겼음 */ } throw e; }
}

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
 * 소해구 예보 행에서 그 3시간 칸의 값을 고른다 — 대해구 예보(risk_store forecast)와 같은 규칙: 칸 시각이 행 시각 범위(맨 앞 −1.5시간 ~ 맨 뒤 +1.5시간) 안이면
 * 가장 가까운 행(같으면 이른 행 — risk_time.nearest), 값은 0 이상 숫자만(그 밖·null 은 null). 행 시각 tm 은 발효시각 UTC "YYYYMMDDHH"(대해구 행과 같은 꼴).
 * 예: rows [{tm:'2026101706',wh:2.4,ws:13}] · at '2026-10-17T15:00:00+09:00' → {wh:2.4, ws:13, forecastAt:'2026-10-17T15:00:00+09:00'} · 범위 밖 → {wh:null, ws:null, forecastAt:null}
 * @param {object[]} rows - smallzone_forecast 행 [{tm,wh,ws,…}] @param {string} at - 칸 시작(KST ISO) @returns {object} {wh, ws, forecastAt}
 * [연계] ← smallWeather / → risk_time.nearest
 */
function smallRowAt(rows, at) {
    const T = require('./risk_time'), utc = (tm) => { const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(String(tm)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]) : NaN; };
    const times = (rows || []).map((r) => utc(r.tm)).filter(Number.isFinite), t = Date.parse(at);
    const inside = times.length && t >= Math.min(...times) - 1.5 * HOUR && t <= Math.max(...times) + 1.5 * HOUR;
    const r = inside ? T.nearest(rows, at, (x) => utc(x.tm)) : null;
    const n = (x) => (x !== null && x !== '' && x !== undefined && Number.isFinite(Number(x)) && Number(x) >= 0 ? Number(x) : null);
    return { wh: n(r && r.wh), ws: n(r && r.ws), forecastAt: r ? R.isoKst(utc(r.tm)) : null };
}
/**
 * 해역마다 가장 많이 겹치는 소해구(region.haegu {major, sub} — risk_sea_cells.describe 가 칸 사각형과 겹친 넓이로 고른 것)의 예보 행을 붙인다(설계서 §11.10.19).
 * 소해구마다 한 벌 — 열쇠 「232-5」. 대해구 weather[major].rows 와 같은 꼴(창의 3시간 칸마다 {at, wh, ws, forecastAt}).
 * 못 붙이는 소해구는 넣지 않는다 → 그 해역은 규칙(seaSection)이 대해구 예보로 후퇴한다: 찾기 함수가 그 대해구를 주지 않음(저장 판 없음·지난 판) · 그 소해구 줄 없음 ·
 * 창의 칸이 모두 파고·풍속 null(육지 소해구 — 기상청 -999).
 * 예: smallWeather([{haegu:{major:232,sub:5}}], win, (m) => ({baseTm:'2026101700', data:{'5':[…]}})) → {'232-5':{label:'232-5해구', major:'232', sub:5, baseTm:'2026101700', rows:[{at,wh,ws,forecastAt}…]}}
 * @param {object[]} regions - collectSea 해역 @param {object} win - editionWindow(slots) @param {Function|null} small - (대해구 번호) → {baseTm, data:{소해구:[행]}} | null
 * @returns {object} 소해구 열쇠 → 예보 [연계] ← collectSea · services/station_briefing.js run(저장 판을 다시 받은 뒤 다시 붙임) / → smallRowAt
 */
function smallWeather(regions, win, small) {
    const out = {}, seen = new Set();
    if (typeof small !== 'function') return out;
    for (const r of regions || []) {
        const h = r.haegu; if (!h || h.major == null || h.sub == null) continue;
        const key = h.major + '-' + h.sub; if (seen.has(key)) continue; seen.add(key);
        const z = small(h.major), all = z && z.data && z.data[String(h.sub)];
        if (!Array.isArray(all) || !all.length) continue;
        const rows = win.slots.map((at) => { const f = smallRowAt(all, at); return { at, wh: f.wh, ws: f.ws, forecastAt: f.forecastAt }; });
        if (!rows.some((q) => q.wh !== null || q.ws !== null)) continue;   // 육지 소해구(값이 모두 -999 → null) — 대해구로 후퇴
        // 이름표 「232-5해구」(2026-10-18 사용자 *"전체적으로 대해구 ## 이렇게 표현하지말고 ##해구 이런식으로 … 소해구는 ##-#해구"* — 설계서 §11.10.22 A, 종전 「소해구 232-5」)
        out[key] = { label: key + '해구', major: String(h.major), sub: Number(h.sub), baseTm: z.baseTm || null, rows };
    }
    return out;
}
/**
 * 해상 입력을 관할마다 모은다 — 관할 안 모든 칸(공식 사고 5km 칸 + 혼잡 교통 칸, 칸 중심이 든 관할 — marine_fusion.briefing 과 같은 규칙)을
 * 해역으로 묶고(같은 공식 사고 칸에 든 교통 칸은 하나), 창의 3시간 칸마다 공식 사고 단계·그 3시간 중 가장 높은 혼잡 예보를 붙인다.
 * 예: collectSea(stations, {risk, marine, win, now}) → Map{key → {reviewedCells, regions:[{rid,lat,lon,haegu,ref,zone,slots:{at:{accident,congestion}},history}], weather:{major:{label,rows}}, weatherSmall:{'232-5':{label,rows}}, warnings:[…]}}
 * @param {object[]} stations @param {object} o - risk(risk_store)·marine(marine_fusion 저장소)·win·now·smallZone(소해구 찾기 함수 — smallWeather, 없으면 weatherSmall 은 빈 객체)
 *                     ·traffic(sea_traffic_profile 계산기 {profiles} — 있으면 해역마다 region.traffic = 결과|null, 없으면 필드 없음 — §11.10.23)
 *                     ·harbor(항구 칸 목록 {has} — 기본 services/harbor_cells.forDefault. 그 칸의 혼잡 예보는 해역 혼잡에 넣지 않는다 — 2026-10-19 사용자 「예보 혼잡까지 전부」) @returns {object} {bySt:Map, sources}
 * [연계] ← gather / → marine.stationAt·cellHistory·codec.rowAt·warningsFromTree·smallWeather·traffic.profiles
 */
function collectSea(stations, { risk, marine, win, now, warnHistory = null, smallZone = null, traffic = null, harbor = require('./harbor_cells').forDefault() }) {
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
    // 공식 사고예보 원천은 ok 인데 창의 어떤 칸 프레임이 없으면(예보 범위 밖·수집 누락) 그 칸은 「사고예보 없음(0)」이 아니라 「확인 불가」 — 칸 목록을 넘긴다(독립 검토 낮음).
    const accGaps = (src.accident?.status === 'ok' ? win.slots.filter((at) => !Array.isArray(frames[forecastKey(at)])) : []);
    const zonesWanted = new Set(), out = new Map(), geomOf = new Map();   // geomOf = 해역 열쇠 → 반올림 전 도형(최근 14일 선박 동향 — box 는 소수 4자리로 줄인 상자라 쓰지 않는다)
    for (const s of stations) {
        const e = bySt.get(s.key), regions = [], majors = new Set();
        for (const [gid, g] of e.groups) {
            const b = g.base, slots = {};
            for (const at of win.slots) {
                let best = null;
                for (let h = 0; h < 3; h++) {
                    const hk = forecastKey(R.isoKst(Date.parse(at) + h * HOUR));
                    for (const id of g.traffic) { if (harbor.has(id)) continue; /* 항구 칸(정박·계류) 혼잡 예보는 충돌·접촉 근거가 아니다 */ const r = codec.rowAt(inputs.congestion, hk, id, ids); if (!r) continue; const rank = { '낮음': 0, '보통': 1, '높음': 2, '매우높음': 3 }[r.congestionLevel] ?? -1; if (!best || rank > best.rank || (rank === best.rank && r.congestionIndex > best.index)) best = { rank, level: r.congestionLevel, index: r.congestionIndex, at: R.isoKst(Date.parse(at) + h * HOUR) }; }
                }
                slots[at] = { accident: g.accident ? accLevel(forecastKey(at), g.accident.i) : null, congestion: best ? { level: best.level, index: best.index, at: best.at } : null };
            }
            const geom = g.accident?.geometry || { type: 'Polygon', coordinates: [[[b.lon - .0125, b.lat - .0125], [b.lon - .0125, b.lat + .0125], [b.lon + .0125, b.lat + .0125], [b.lon + .0125, b.lat - .0125], [b.lon - .0125, b.lat - .0125]]] };
            const zone = b.warnSubZone ? { name: b.warnSubZone, kind: 'sub' } : b.warnZone ? { name: b.warnZone, kind: 'main' } : null;
            if (b.warnZone) zonesWanted.add(R.zoneKey(b.warnZone)); if (b.warnSubZone) zonesWanted.add(R.zoneKey(b.warnSubZone));
            if (b.haegu?.major) majors.add(b.haegu.major);
            geomOf.set(gid, geom);
            regions.push({ rid: gid, gridId: g.traffic[0] || null, accidentGridId: g.accident?.id || null, lat: b.lat, lon: b.lon, box: boxOf(geom), haegu: b.haegu || null, ref: b.ref || null, zone, zones: [b.warnZone, b.warnSubZone].filter(Boolean), cellCount: g.traffic.length + (g.accident ? 1 : 0), slots, history: marine.cellHistory(geom, 'grid:' + (g.accident?.id || b.id)) });
        }
        const weather = {};
        // 이름표 「232해구」(§11.10.22 A — 종전 「대해구 232」). [기상 예보] 꼬리 「(232해구 예보)」·해구 문장 「경북북부앞바다(75해구)」가 이 글을 쓴다.
        for (const major of majors) weather[major] = { label: major + '해구', box: haeguBox(major), rows: win.slots.map((at) => { const f = inputs.weather(major, at); return { at, wh: f.wh, ws: f.ws, forecastAt: f.forecastAt }; }) };
        // weatherSmall(§11.10.19 — 사용자 *"소해구 기준으로 기상이 표출되어야 함."*): 해역마다 가장 많이 겹치는 소해구 예보. 없으면 그 해역만 대해구 weather 로(규칙 seaSection)
        out.set(s.key, { reviewedCells: e.cells.size, regions, weather, weatherSmall: smallWeather(regions, win, smallZone), zones: [...new Set(regions.flatMap((r) => r.zones))], frameGaps: accGaps.length && regions.some((r) => r.accidentGridId) ? { accident: accGaps } : {} });
    }
    // 최근 14일 선박 동향(2026-10-18 사용자 확정 *"좋아 이렇게 하자."* — 설계서 §11.10.23): sea_traffic_profile 의 해역별 결과를 해역마다 붙인다.
    //   넘기는 것 = 해역 열쇠(rid)·반올림 전 도형(geom — traffic_history.design.md 「2단계 때 쓰는 법」)·특보구역(zones — 풍랑·태풍 주의보·경보 시간을 뺀다). 계산이 던지면 줄만 없다(경고 한 줄, 브리핑은 계속).
    if (traffic) {
        const list = [...out.values()].flatMap((v) => v.regions);
        let res = null;
        try { res = traffic.profiles(list.map((r) => ({ key: r.rid, geometry: geomOf.get(r.rid), zones: r.zones }))); } catch (e) { console.warn('[station_briefing] 최근 14일 선박 동향 계산 실패 — 그 줄 없이 만든다: ' + (e && e.message)); }
        for (const r of list) r.traffic = (res && res.get(r.rid)) || null;
    }
    const all = warningsFromTree(inputs.warnings?.current, zonesWanted, now);
    // 이미 해제된 특보(결정 4): 창 시작 3시간 전(육상 해제 뒤 기간 — 해상 1시간보다 길다)부터 지금까지. 같은 구역·종류가 지금 발효 중이면 다시 발효된 것이라 뺀다.
    const live = new Set(all.filter((w) => w.state === '발효').map((w) => R.zoneKey(w.zone) + '|' + w.type));
    const gone = src.warnings?.status === 'ok' ? releasedFrom(warnHistory, [...zonesWanted], Date.parse(win.from) - R.AFTER_RELEASE_LAND_H * HOUR, now).filter((w) => !live.has(R.zoneKey(w.zone) + '|' + w.type)) : [];
    for (const [, v] of out) { const ks = new Set(v.zones.map(R.zoneKey)); v.warnings = all.concat(gone).filter((w) => ks.has(R.zoneKey(w.zone))); }
    return { bySt: out, sources: { accident: src.accident?.status || 'missing', congestion: src.congestion?.status || 'missing', zoneForecasts: src.zoneForecasts?.status || 'missing', warnings: src.warnings?.status || 'missing', tourConcentration: src.tourConcentration?.status || 'missing', events: src.events?.status || 'missing' } };
}
/**
 * 연안 하루 값의 안내(특보·떠밀림 바람)를 그날 칸 전부에서 모은다 — 맨 위 notices 는 「가장 높은 칸」 것뿐이라(risk_store.coastDayDetail),
 * 그 칸 밖의 특보·바람이 빠진다(독립 검토 A1). daily.notices(risk_store.dayNotices — 그날 칸 전부)가 있으면 그것을, 없으면 종전 notices.
 * detail = 특보마다 기상청 시각(발표 issued·발효 예정 effective·해제 예고 release — risk_store.dayNotices, 2026-10-16 결정 1). 같은 특보가 끊겨 두 번 나오면 첫 것.
 * driftTarget = 표류 안내의 대상 말(서버 risk_score.driftTarget — 그 예보 시각의 KST 달, 6~9월 「튜브·물놀이기구」·그 밖 「소형 보트·레저기구」, 설계서 §11.10.36). 연안 시트와 같은 값을 그대로 넘긴다. 표류가 없으면 null.
 * 예: daily.notices [{key:'warning',name:'풍랑경보',state:'발효',from:'…18:00',to:'…21:00',issued,effective,release},{key:'drift',windMs:11,…}]
 *     → {effective:['풍랑경보'],prelim:[],windMs:11,driftTarget:'소형 보트·레저기구',detail:[{name:'풍랑경보',state:'발효',issued,effective,release}]}
 * @param {object} d - coastDayDetail 결과 @returns {object} {effective:string[],prelim:string[],windMs:number|null,driftTarget:string|null,detail:object[]} [연계] ← collectLand → rules.landSpot
 */
function dayNoticeSummary(d) {
    const daily = d && d.daily && Array.isArray(d.daily.notices) ? d.daily.notices : null;
    if (!daily) { const n = (k) => (d.notices || []).find((x) => x.key === k) || null, wn = n('warning'), dr = n('drift'); return { effective: wn?.effective || [], prelim: wn?.prelim || [], windMs: dr ? dr.windMs : null, driftTarget: dr?.target || null, detail: (wn?.times || []).map((x) => ({ name: x.name, state: x.state, issued: x.issued || null, effective: x.effective || null, release: x.release || null })) }; }
    const pick = (state) => [...new Set(daily.filter((x) => x.key === 'warning' && x.state === state && x.name).map((x) => x.name))];
    const drifts = daily.filter((x) => x.key === 'drift' && Number.isFinite(x.windMs)), winds = drifts.map((x) => x.windMs), detail = [], seen = new Set();
    for (const x of daily) if (x.key === 'warning' && x.name && !seen.has(x.state + '|' + x.name)) { seen.add(x.state + '|' + x.name); detail.push({ name: x.name, state: x.state, issued: x.issued || null, effective: x.effective || null, release: x.release || null }); }
    return { effective: pick('발효'), prelim: pick('예비'), windMs: winds.length ? Math.max(...winds) : null, driftTarget: drifts.find((x) => x.target)?.target || null, detail };
}
/**
 * 특보 구간 기록(sea_warning_history — 특보 크롤러 결과를 1분마다 「발효 시작~해제」로 남긴 것)에서 [from, to] 사이에 실제로 해제된 구간을 꺼낸다.
 * 해제 뒤 「관심」(2026-10-16 결정 4 — 해상 1시간·육상 3시간)은 해제 직후 특보 변경 판에서 특보가 이미 트리에서 사라진 뒤에 쓰이므로 이 기록이 있어야 한다.
 * 등급이 바뀌어 닫힌 구간(levelChange — 격상·격하, 해제 아님)은 뺀다. 열린 구간(지금도 발효)은 해제가 아니다.
 * 예: releasedFrom(rec, ['제주도북부앞바다'], 05:00, 08:10) → [{zone:'제주도북부앞바다',kind:'앞바다',type:'풍랑',level:'주의보',state:'해제',issued:null,effective:null,release:{start:'…07:30…',end:'…07:30…',range:false},source:'history'}]
 * @param {object|null} rec - sea_warning_history 기록기({list}) — 없으면 [] @param {string[]} zones @param {number} from - ms @param {number} to - ms @returns {object[]}
 * [연계] ← collectSea(해상 해역 특보)·collectLand(관광지 특보구역) / → sea_warning_history.list
 */
function releasedFrom(rec, zones, from, to) {
    if (!rec || !zones.length) return [];
    let rows = []; try { rows = rec.list({ zones, from, to }).intervals || []; } catch (_) { return []; }
    return rows.filter((x) => x.end && x.endBy !== 'levelChange' && Date.parse(x.end) >= from && Date.parse(x.end) <= to)
        .map((x) => { const at = R.isoKst(Date.parse(x.end)); return { zone: x.zone, kind: x.kind || null, type: x.type, level: x.level, state: '해제', issued: null, effective: null, release: { start: at, end: at, range: false }, source: 'history' }; });
}
/**
 * 육상 입력: 관할에 붙은 관광지마다 연안 하루 값(coastDayDetail — 그날 3시간 칸 중 가장 높은 칸, T24)을 그대로 쓰고, 관광지에 안 붙은 위험구역은 상시 위험 장소로.
 * 특보·떠밀림 안내는 그날 칸 전부(daily.notices — dayNoticeSummary).
 * 예: collectLand(spots, hazards, {risk, t:'2026-10-17T08:00:00+09:00'}) → {spots:[{id,name,index,band,people:{ratio,score},event,swell,rip,notices,hazard,history,isolation,isolationYears,missing}], hazardOnly:[…]}
 * @param {object[]} spots @param {object[]} hazards @param {object} o - risk·t @returns {object} [연계] ← gather / → risk_store.coastDayDetail(읽기만)
 */
function collectLand(spots, hazards, { risk, t, now = Date.parse(t), warnHistory = null }) {
    const out = [], linked = new Set(), from = Date.parse(t);
    for (const p of spots) {
        let d; try { d = risk.coastDayDetail(p.id, t); } catch (e) { out.push({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, beach: !!p.beach, missing: ['detail'], error: e.status || 500 }); continue; }
        const row = (k) => (d.rows || []).find((r) => r.key === k) || null, hz = row('hazard'), people = row('people'), ev = row('event'), sw = row('swell'), rip = row('rip');
        const nt = dayNoticeSummary(d);
        // 특보 해제 뒤 3시간 「관심」(2026-10-16 결정 4): ①지금 걸린 특보 중 해제 예고(범위면 끝)가 이 날 칸 시작 이전이고 그 뒤 3시간이 이 날에 걸치는 것(예: 오늘 밤 22시 해제 → 내일 00~01시)
        //   ②특보 구간 기록에서 이미 해제된 것(해제 시각 + 3시간 > 이 날 칸 시작). 그날 칸에 발효로 남아 있는 특보는 발효 단계가 이미 더 높아 뺀다.
        const released = [];
        if (typeof risk.coastWarnings === 'function') {
            let cw = null; try { cw = risk.coastWarnings(p.id); } catch (_) { cw = null; }
            for (const w of cw?.warnings || []) { const e = w.state === '발효' && w.release ? Date.parse(w.release.end) : NaN; if (Number.isFinite(e) && e <= from && e + R.AFTER_RELEASE_LAND_H * HOUR > from) released.push({ name: w.name, at: R.isoKst(e), source: w.source }); }
            if (cw?.zones?.warn) for (const w of releasedFrom(warnHistory, [cw.zones.warn], from - R.AFTER_RELEASE_LAND_H * HOUR, now)) if (!cw.warnings.some((x) => x.state === '발효' && x.name === w.type + w.level)) released.push({ name: w.type + w.level, at: w.release.start, source: 'history' });
        }
        for (const z of hz?.zones || []) linked.add(z.id);
        const acc = d.history?.available ? d.history.accidents || [] : null, types = {};
        for (const a of acc || []) types[a.type] = (types[a.type] || 0) + 1;
        out.push({
            id: p.id, name: p.name, lat: p.lat, lon: p.lon, beach: !!p.beach, index: d.index, band: d.band, peakAt: d.daily?.peakAt || d.t,
            people: people && !people.missing ? { ratio: people.ratio, score: people.score } : null, event: ev && ev.name ? { name: ev.name, weekend: !!ev.weekend } : null,
            swell: sw ? { periodS: sw.periodS } : null, rip: rip ? { level: rip.level } : null,
            notices: nt, released: released.filter((r) => !nt.effective.includes(r.name)),
            // warnZone = 이 관광지가 든 특보구역(risk.coastWarnings zones.warn) — 브리핑 「기상특보 현황」 표의 특보구역 칸(rules.landWarnRows, 설계서 §11.10.16 소절 E1). 모르면 null
            warnZone: (() => { if (typeof risk.coastWarnings !== 'function') return null; try { const cw = risk.coastWarnings(p.id); return (cw && cw.zones && cw.zones.warn) || null; } catch (_) { return null; } })(),
            // zones = 위험구역 id·종류(2026-10-18 사용자 결정 — 설계서 §11.10.20: 카드 [위험구역] 표의 [위치 보기] 지도가 /api/risk-forecast/hazard-zones?ids= 로 폴리곤을 받는다. id = 위험구역 자료의 name)
            hazard: hz ? { count: hz.count || 0, byType: (hz.byType || []).map((x) => ({ class: x.class, count: x.count })), zones: (hz.zones || []).filter((z) => z && z.id).map((z) => ({ id: z.id, class: z.class || null })) } : null,
            // isolation = 고립 사고 수(총평 (고립 주의) 지점 표 — 2026-10-17 §11.10.3). 기록을 못 쓰면(available 아님) null — 0 과 가른다.
            isolation: acc ? acc.filter((a) => a.type === '고립').length : null,
            // isolationYears = 같은 고립 사고 기록의 연도별 수({2022:1, 2023:2} — 2026-10-17 사용자 결정 §11.10.10 「발생 현황」 칸). 연도는 기록의 year(없으면 date 앞 4자리),
            //   둘 다 없으면 '미상'으로 센다(합이 isolation 과 늘 같게 — 조용히 빠지지 않게). 기록을 못 쓰면 null.
            isolationYears: acc ? acc.filter((a) => a.type === '고립').reduce((m, a) => { const y = Number.isInteger(a.year) ? String(a.year) : /^\d{4}/.test(String(a.date || '')) ? String(a.date).slice(0, 4) : '미상'; m[y] = (m[y] || 0) + 1; return m; }, {}) : null,
            // types·death·missing·byYear(2026-10-18 사용자 결정 — 설계서 §11.10.20 카드 [사고현황('20~'24년)]): 유형 전부 · 사망·실종 인원 합(기록의 death·missing — 숫자가 아니면 0 으로 더한다) ·
            //   연도·유형별 건수 [{year:'2020', type:'익수', count:2}](연도 = 기록의 year, 없으면 date 앞 4자리, 둘 다 없으면 '미상' — isolationYears 와 같은 규칙)
            history: acc ? { count: acc.length, from: d.history.from, to: d.history.to, topTypes: Object.entries(types).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).slice(0, 3).map(([type, count]) => ({ type, count })),
                types, death: acc.reduce((n, a) => n + (Number(a.death) || 0), 0), missing: acc.reduce((n, a) => n + (Number(a.missing) || 0), 0),
                byYear: Object.values(acc.reduce((m, a) => { const y = Number.isInteger(a.year) ? String(a.year) : /^\d{4}/.test(String(a.date || '')) ? String(a.date).slice(0, 4) : '미상', k = y + '|' + a.type; (m[k] = m[k] || { year: y, type: a.type, count: 0 }).count++; return m; }, {})) } : null,
            missing: d.missing || [],
        });
    }
    return { spots: out, hazardOnly: hazards.filter((z) => !linked.has(z.id)) };
}
/**
 * 조석: 대표 위치가 서해·남해(물빠짐 대상 해역)이면 가장 가까운 물빠짐 앵커(25km 안 — tide_field 보간 반경과 같다)의 대상 날짜 곡선으로,
 * 제주(tide_field_common.JEJU_BBOX — 추자도는 남해 쪽)이면 제주 고립판정 촘촘 격자 앵커(jeju_isolation_tide_collector, data/tide_field/curves_jeju)의 곡선으로
 * (그 격자가 없으면 제주 간출암 잠김경고 앵커 hazard_rocks_tide_collector, data/hazard_rocks/curves — 둘 다 매일 KST 23:30 자동 수집, 같은 꼴 {curve:[{t,h}],peaks:{lowTide1…}})
 * 고조·저조와 게이지용 곡선(10분 간격)을 만든다(2026-10-16 결정 5 — 원문 *"나 는 반영하자"*: 제주 관할도 조석·고립 문구). 잠기는 바위(간출암)는 관할 폴리곤 안의 것만, 그날 잠기는 시각.
 * 예: collectTide(태안 위치, '2026-10-17', geometry) → {region:'westsouth',anchorId:'A12',distKm:3.2,date:'2026-10-17',curve:[{t:'00:00',cm:312},…144],peaks:[{type:'low',t:'06:12',cm:-12},…],prevPeak,nextPeak,
 *       rocks:{count:3,first:'05:40',last:'07:10',items:[{id:5,lat:36.66,lon:126.12,v:1.2,times:['05:40']},…]}}
 *     collectTide(한림 위치, …) → {region:'jeju',anchorId:'J0',…} · 동해·앵커 없음·곡선 없음 → null
 * @param {object} loc - {lat,lon} @param {string} date - YYYY-MM-DD @param {object} geometry - 관할 폴리곤
 * @param {object} [deps] - 시험용 주입(anchors·jejuAnchors·hrAnchors·readCurve(id,ymd,source)·rocks·crossings)
 * @returns {object|null} [연계] ← gather
 */
function collectTide(loc, date, geometry, deps = {}) {
    const TFC = require('./tide_field_common');
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;
    const J = TFC.JEJU_BBOX, jeju = loc.lat >= J.latMin && loc.lat <= J.latMax && loc.lon >= J.lonMin && loc.lon <= J.lonMax;
    const region = TFC.isWestSouthSea(loc.lat, loc.lon) ? 'westsouth' : jeju ? 'jeju' : null;
    if (!region) return null;
    // 앵커 원천: 서해·남해 = 물빠짐(field) · 제주 = 제주 촘촘 격자(jeju), 그것이 없으면 간출암 앵커(hr)
    let source = 'field', anchors;
    if (region === 'westsouth') anchors = deps.anchors || require('./tide_field_collector').loadAnchors() || [];
    else {
        anchors = deps.jejuAnchors || (deps.anchors ? [] : require('./jeju_isolation_tide_collector').loadAnchors()) || []; source = 'jeju';
        if (!anchors.length) { anchors = deps.hrAnchors || (deps.anchors ? [] : require('./hazard_rocks_tide_collector').loadAnchors()) || []; source = 'hr'; }
    }
    const near = anchors.map((a) => ({ a, d: TFC.haversineKm(loc.lat, loc.lon, a.lat, a.lon) })).filter((x) => x.d <= TFC.TIDE_FIELD_CONFIG.INTERP_MAX_KM).sort((x, y) => x.d - y.d)[0];
    if (!near) return null;
    const pathOf = { field: (id, ymd) => require('./tide_field_collector').curvePath(id, ymd), jeju: (id, ymd) => require('./jeju_isolation_tide_collector').curvePath(id, ymd), hr: (id, ymd) => require('./hazard_rocks_tide_collector').curvePath(id, ymd) }[source];
    const read = deps.readCurve ? (id, ymd) => deps.readCurve(id, ymd, source) : (id, ymd) => readJson(pathOf(id, ymd));
    const ymd = date.replace(/-/g, ''), shift = (n) => R.kstDate(Date.parse(date + 'T00:00:00+09:00') + n * 24 * HOUR).replace(/-/g, '');
    const cur = read(near.a.id, ymd);
    if (!cur || !Array.isArray(cur.curve) || !cur.curve.length) return null;
    const peaksOf = (c) => c && c.peaks ? Object.entries(c.peaks).filter(([, v]) => v && v.time).map(([k, v]) => ({ type: k.startsWith('low') ? 'low' : 'high', t: v.time, cm: v.height })).sort((a, b) => a.t.localeCompare(b.t)) : [];
    const peaks = peaksOf(cur), prevDayPeaks = peaksOf(read(near.a.id, shift(-1))), prev = prevDayPeaks.at(-1) || null, next = peaksOf(read(near.a.id, shift(1)))[0] || null;
    const curve = cur.curve.filter((p) => /:[0-5]0$/.test(p.t)).map((p) => ({ t: p.t, cm: p.h }));
    let rocks = null;
    try {
        const G = require('./risk_geo'), list = deps.rocks || require('./hazard_rocks_submersion').loadRocks(), cr = deps.crossings || readJson(path.join(require('./hazard_rocks_tide_common').HAZARD_ROCKS_TIDE_DIR, 'submersion.json'))?.crossings || {};
        // items = 그날 잠기는 관할 안 간출암 하나하나(id·위치·간출 높이 v(m)·그날 잠기는 시각) — 총평 「잠기는 바위(간출암) N곳」을 누르면 여는 지도와
        //   해양안전 「위험지형」 간출암 팝업(같은 id 로 /api/hazard-rocks/tide-curve)의 재료(2026-10-17 사용자 결정 — 설계서 §11.10.10). id 는 hazard_rocks.json 의 properties.id
        //   (해양안전 위험지형 레이어 feature.get('id') 와 같은 번호 — hazard_rocks_submersion.loadRocks 주석). 첫 잠김 시각 순 → id 순.
        const items = [];
        for (const r of list) {
            if (!G.pointInGeometry([r.lon, r.lat], geometry)) continue;
            const at = (cr[String(r.id)] || []).map((iso) => R.isoKst(Date.parse(iso))).filter((k) => k.slice(0, 10) === date).map((k) => k.slice(11, 16)).sort();
            if (at.length) items.push({ id: r.id, lat: r.lat, lon: r.lon, v: r.v, times: at });
        }
        items.sort((a, b) => a.times[0].localeCompare(b.times[0]) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
        const times = items.flatMap((x) => x.times).sort();
        if (times.length) rocks = { count: items.length, first: times[0], last: times.at(-1), items };
    } catch (_) { rocks = null; /* 간출암 자료 없음 — 문구만 빠진다 */ }
    return { region, anchorSource: source, anchorId: near.a.id, distKm: +near.d.toFixed(1), date, status: cur.status || null, curve, peaks, prevPeak: prev, prevDayPeaks, nextPeak: next, rocks };
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
 * 지방기상청 단기 해상예보(앞바다 PDF)·단기 전망 통보문을 한 번 읽는다 — 인덱스 「○○앞바다 기상예보」 팝업(/api/regional-coastal-forecast)과
 * 같은 함수(regional_forecast_collector.loadCoastalForecasts — 구역의 관할 지방청 자료만)를 그대로 쓴다. 읽기 실패·파일 없음이면 빈 묶음(지어내지 않음).
 * 예: regionalForecast() → {coastal:{'제주도서부앞바다':{officeName:'제주지방기상청',publishTime:'10.17. 05:00',periods:[…]}}, offices:{'184':{officeName,bulletinPublishTime,summary,…}}, zoneOffice:{…}}
 * @returns {object} [연계] ← station_briefing.run(실행마다 한 번) → gather → collectZoneWeather
 */
function regionalForecast() {
    try {
        const C = require('../regional_forecast_collector');
        return { coastal: C.loadCoastalForecasts() || {}, offices: C.loadRegionalForecasts() || {}, zoneOffice: C.ZONE_TO_OFFICE_MAP || {} };
    } catch (e) { console.warn('[station_briefing] 지방기상청 예보 읽기 실패:', e && e.message); return { coastal: {}, offices: {}, zoneOffice: {} }; }
}
/**
 * 파출소 대표 위치에서 가장 가까운 앞바다(특보구역)를 찾는다 — 특보구역 도형(client/assets/warn_zones.geojson, warn_zone_cells 가 읽는 같은 파일)의
 * 경계까지 거리(안에 들면 0)로. 인덱스 「내 위치 → 가장 가까운 예보 구역」과 같은 뜻이지만 화면의 점 좌표(ZONE_COORDINATES — Windy 지도 중심) 대신 실제 구역 도형을 쓴다.
 * 예: nearestCoastalZone({lat:33.41, lon:126.26}) → {zone:'제주도서부앞바다', distKm:0.5} · 위치 없음 → null
 * @param {object|null} loc - {lat,lon} @returns {object|null} [연계] ← collectZoneWeather · 시험(한림 → 제주도서부앞바다, 실제 도형)
 */
function nearestCoastalZone(loc) {
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;
    const G = require('./risk_geo'), zones = require('./warn_zone_cells')._load().main.filter((z) => z.kind === '앞바다');
    let best = null;
    for (const z of zones) { const d = G.distanceToGeometry([loc.lon, loc.lat], z.geometry); if (!best || d < best.d) best = { z, d }; }
    return best ? { zone: best.z.name, key: best.z.key, distKm: +best.d.toFixed(1) } : null;
}
// 가장 가까운 앞바다가 이보다 멀면(km) 그 앞바다 예보는 파출소 바다라고 보기 어렵다 — 더 가까운 먼바다 예보가 있으면 그것을, 없으면 거리를 밝힌다(2026-10-17 독립 검토 5).
// 30km 근거: 관할 97곳 추정 위치(estimateLocation — 관광지·위험구역 중심, 카카오 좌표 없이)로 재 보니 30km 를 넘는 곳은 울릉(강원남부앞바다 115.9km)·흑산(전남중부서해앞바다 44.2km) 두 곳,
// 그다음이 추자(26.5km)·거문(11.2km)이고 나머지 93곳은 3km 안이었다. 섬 관할 두 곳만 걸러지는 값이다(운영 카카오 좌표로는 다시 재지 않았다).
const COASTAL_MAX_KM = 30;
/**
 * 파출소 대표 위치에서 가장 가까운 먼바다(특보구역 도형 kind 「먼바다」). 예: 울릉 추정 위치(37.504, 130.875) → {zone:'동해중부 안쪽먼바다', distKm:0}. @param {object|null} loc @returns {object|null} [연계] ← collectZoneWeather
 */
function nearestFarZone(loc) {
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;
    const G = require('./risk_geo'), zones = require('./warn_zone_cells')._load().main.filter((z) => z.kind === '먼바다');
    let best = null;
    for (const z of zones) { const d = G.distanceToGeometry([loc.lon, loc.lat], z.geometry); if (!best || d < best.d) best = { z, d }; }
    return best ? { zone: best.z.name, key: best.z.key, distKm: +best.d.toFixed(1) } : null;
}
/** 해역 이름 차례(앱 SEA_REGIONS 와 같은 네 이름) — 표본 수가 같으면 앞의 것. [연계] ← stationSeas */
const SEAS = ['동해', '서해', '남해', '제주'];
/**
 * 관할 폴리곤 하나가 동해·서해·남해·제주 중 어느 해역(들)에 걸치는지 정한다(설정 화면 「지도에서 선택하기」의 해역 단추 — 2026-10-17).
 * 규칙: 관할 상자를 12×12 로 나눈 점 중 관할 안에 드는 점마다 그 점을 품는 특보구역(앞바다·먼바다 44곳, warn_zone_cells 표)을 찾고,
 *       그 구역이 속한 해역(push_helpers.ZONE_HIERARCHY — 앱 SEA_REGIONS·SUB_REGION_ZONES 와 같은 계층)에 한 표.
 *       표를 하나라도 받은 해역을 모두, 표가 많은 차례로 돌려준다(첫째 = 주 해역). 그래서 경계 관할은 두 해역 지도에 다 나온다
 *       (2026-10-17 실측: 추자 남해81·제주3, 땅끝 서해47·남해16, 기장 남해55·동해14 — 나머지 94곳은 한 해역).
 *       관할 안 점이 하나도 없으면(아주 작은 관할) 꼭짓점으로, 어느 구역에도 안 들면(항만 안쪽 등 특보구역 밖) 가장 가까운 구역의 해역 하나.
 * 지방청(region)으로 정하지 않는 이유: 서해지방청 여수·완도서와 남해지방청 울산서처럼 지방청과 바다가 다른 관할이 있다(실측 — 여수·완도 11곳 남해, 울산 4곳 동해).
 * 예: stationSeas(한림 폴리곤) → ['제주'] · stationSeas(추자 폴리곤) → ['남해','제주'] · stationSeas(울산항 폴리곤) → ['동해']
 * @param {object} geometry - Polygon·MultiPolygon(경위도) @param {object[]} [zones] - {sea,box,geometry} 목록(시험용, 기본 seaZones())
 * @returns {string[]} 해역 이름들(구역 표가 비면 빈 배열) [연계] ← stationAreas / → risk_geo.pointInGeometry·distanceToGeometry
 */
function stationSeas(geometry, zones = seaZones()) {
    const G = require('./risk_geo'), b = bounds(geometry), N = 12, tally = {};
    let pts = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const p = [b[0] + (i + 0.5) / N * (b[2] - b[0]), b[1] + (j + 0.5) / N * (b[3] - b[1])]; if (G.pointInGeometry(p, geometry)) pts.push(p); }
    if (!pts.length) pts = (geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0]).slice();
    for (const p of pts) { const z = zones.find((z) => p[0] >= z.box[0] && p[0] <= z.box[2] && p[1] >= z.box[1] && p[1] <= z.box[3] && G.pointInGeometry(p, z.geometry)); if (z) tally[z.sea] = (tally[z.sea] || 0) + 1; }
    const seas = SEAS.filter((s) => tally[s]).sort((a, c) => tally[c] - tally[a]);
    if (seas.length) return seas;
    let near = null; const p = pts[Math.floor(pts.length / 2)];
    for (const z of zones) { const d = G.distanceToGeometry(p, z.geometry); if (!near || d < near.d) near = { sea: z.sea, d }; }
    return near ? [near.sea] : [];
}
/**
 * 특보구역(앞바다·먼바다) 표에 해역 이름을 붙인다 — 이름 열쇠(warn_zone_cells.zoneKey)로 ZONE_HIERARCHY 소분류와 맞춘다.
 * 예: seaZones() → [{sea:'동해', name:'울산앞바다', box:[…], geometry}, …](44곳)
 * @returns {object[]} [연계] ← stationSeas / warn_zone_cells._load(client/assets/warn_zones.geojson) · push_helpers.ZONE_HIERARCHY
 */
function seaZones() {
    const W = require('./warn_zone_cells'), H = require('./push_helpers').ZONE_HIERARCHY, seaOf = {};
    for (const sea of Object.keys(H)) for (const list of Object.values(H[sea])) for (const n of list) seaOf[W.zoneKey(n)] = sea;
    return W._load().main.filter((z) => seaOf[z.key]).map((z) => ({ sea: seaOf[z.key], name: z.name, box: z.box, geometry: z.geometry }));
}
/**
 * 설정 화면 지도용 관할 구역 — 관할마다 열쇠·해역들(stationSeas)·폴리곤(좌표 소수 넷째 자리 ≈ 11m 로 반올림, 꼭짓점은 그대로 — 단순화 안 함).
 * 예: stationAreas(loadStations()) → [{key:'제주해양경찰서|한림파출소', seas:['제주'], geometry:{type:'Polygon', coordinates:[[[126.2,33.4],…]]}}, …]
 * @param {object[]} stations - loadStations() 꼴(geometry 있음) @param {object[]} [zones] @returns {object[]} [연계] ← station_briefing.stationAreas → GET /api/station-briefing/areas
 */
function stationAreas(stations, zones = seaZones()) {
    const r4 = (c) => Array.isArray(c[0]) ? c.map(r4) : [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4];
    return stations.filter((s) => s.geometry).map((s) => ({ key: s.key, seas: stationSeas(s.geometry, zones), geometry: { type: s.geometry.type, coordinates: r4(s.geometry.coordinates) } }));
}
/**
 * 관할 하나의 (기상) 입력 — 가장 가까운 앞바다 · 그 구역 단기 해상예보 · 그 구역 관할 지방청(ZONE_TO_OFFICE_MAP)의 단기 전망 통보문.
 * 구역 이름은 도형 파일(「인천.경기북부앞바다」)과 예보 자료(「인천·경기북부앞바다」) 표기가 달라 열쇠(띄어쓰기·가운뎃점·점 무시)로 맞춘다.
 * 통보문은 regional_bulletin_collector 가 저장한 summary(AI 색칠 마크업이 있을 수 있음 — 규칙이 벗긴다)·bulletinPublishTime('2026.10.17 04:40').
 * 가장 가까운 앞바다가 COASTAL_MAX_KM(30km)보다 멀면(독립 검토 5): 그보다 가까운 먼바다의 단기 해상예보(같은 지방청 PDF 의 marineForecast)가 있으면 그 먼바다를 쓰고(kind 'far'),
 * 없으면 그 앞바다를 그대로 쓰되 note 「가장 가까운 앞바다 특보구역(약 N km 떨어짐) 예보입니다」를 단다(화면에 보인다).
 * 예: collectZoneWeather({lat:33.41,lon:126.26}, regionalForecast()) → {zone:'제주도서부앞바다', kind:'coastal', distKm:0.5, note:null, office:'184', coastal:{…}|null, bulletin:{officeName,publishTime,text}|null}
 *     울릉(먼바다 예보 있음) → {zone:'동해중부안쪽먼바다', kind:'far', distKm:0, note:'가장 가까운 앞바다 특보구역(강원남부앞바다)이 약 115.9km 떨어져 있어 파출소가 있는 먼바다 특보구역 예보입니다', …}
 * @param {object|null} loc @param {object|null} regional - regionalForecast() 결과 @returns {object|null} [연계] ← gather → rules.weatherSummary
 */
function collectZoneWeather(loc, regional) {
    const nz = nearestCoastalZone(loc);
    if (!nz) return null;
    const rg = regional || { coastal: {}, offices: {}, zoneOffice: {} }, k = (n) => R.zoneKey(n);
    const officeOf = (key) => { const e = Object.entries(rg.zoneOffice || {}).find(([n]) => k(n) === key); return e ? e[1] : null; };
    const bulletinOf = (office) => { const o = office && rg.offices ? rg.offices[office] : null; return o && o.summary ? { officeName: o.officeName || null, publishTime: o.bulletinPublishTime || null, text: o.summary } : null; };
    if (nz.distKm > COASTAL_MAX_KM) {
        const fz = nearestFarZone(loc), office = fz && fz.distKm < nz.distKm ? officeOf(fz.key) : null, o = office && rg.offices ? rg.offices[office] : null;
        const name = o && o.marineForecast ? Object.keys(o.marineForecast).find((n) => k(n) === fz.key) : null;
        if (name && (o.marineForecast[name].periods || []).length) {
            const where = fz.distKm > 0 ? '가장 가까운 먼바다 특보구역(약 ' + fz.distKm + 'km)' : '파출소가 있는 먼바다 특보구역';
            return { zone: name, kind: 'far', distKm: fz.distKm, note: '가장 가까운 앞바다 특보구역(' + nz.zone + ')이 약 ' + nz.distKm + 'km 떨어져 있어 ' + where + ' 예보입니다', office,
                coastal: { officeName: o.officeName || null, publishTime: o.publishTime || null, collectedAt: o.collectedAt || null, ...o.marineForecast[name] }, bulletin: bulletinOf(office) };
        }
    }
    const coastalName = Object.keys(rg.coastal || {}).find((n) => k(n) === nz.key) || null, office = officeOf(nz.key);
    return { zone: coastalName || nz.zone, kind: 'coastal', distKm: nz.distKm, note: nz.distKm > COASTAL_MAX_KM ? '가장 가까운 앞바다 특보구역(약 ' + nz.distKm + 'km 떨어짐) 예보입니다' : null, office,
        coastal: coastalName ? rg.coastal[coastalName] : null, bulletin: bulletinOf(office) };
}
/**
 * 관할들의 입력 묶음을 만든다(rules.buildBriefing 에 그대로 넣을 수 있는 꼴).
 * 예: await gather({stations, risk, marine, win, now, locations}) → [{key,name,office,region,seaOnly,location,sources,sea,places,land,tide}]
 * @param {object} o - stations(대상 관할만)·allStations·risk·marine·win·now·locations(key→위치)·hazards(Map)·spotsBySt(Map)·tideDeps
 *                     ·warnHistory(특보 구간 기록 — sea_warning_history 기록기, 없으면 이미 해제된 특보는 보지 않는다)
 *                     ·regional(regionalForecast() 결과 — 없으면 (기상) 칸은 「자료를 확인하지 못했습니다」)
 *                     ·smallZone(소해구 예보 찾기 함수 (대해구) → {baseTm, data}|null — station_briefing.run 이 저장 판·판 비교로 만든다, §11.10.19. 없으면 모든 해역이 대해구 예보)
 *                     ·traffic(sea_traffic_profile 계산기 — collectSea 가 해역마다 최근 14일 선박 동향을 붙인다, §11.10.23. 없으면 그 줄 없음)
 * @returns {object[]} [연계] ← station_briefing.run / → collectSea·collectLand·collectTide·collectZoneWeather
 */
function gather({ stations, risk, marine, win, now, locations, hazards, spotsBySt, tideDeps, warnHistory = null, regional = null, smallZone = null, traffic = null }) {
    const sea = collectSea(stations, { risk, marine, win, now, warnHistory, smallZone, traffic });
    const landT = win.targetDate === R.kstDate(now) ? R.isoKst(Math.floor(now / 60000) * 60000) : win.targetDate + 'T00:00:00+09:00';
    return stations.map((st) => {
        const spots = spotsBySt.get(st.key) || [], hz = hazards.get(st.key) || [], s = sea.bySt.get(st.key);
        return {
            key: st.key, name: st.name, office: st.office, region: st.region, seaOnly: st.seaOnly, seaOnlyReason: st.seaOnlyReason,
            location: locations[st.key] || null, sources: sea.sources, area: areaOf(st.geometry),
            sea: { reviewedCells: s.reviewedCells, regions: s.regions, weather: s.weather, weatherSmall: s.weatherSmall, warnings: s.warnings, frameGaps: s.frameGaps },
            places: spots.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })).concat(spots.length ? [] : hz.map((z) => ({ name: z.place, lat: z.lat, lon: z.lon }))),
            land: st.seaOnly ? null : collectLand(spots, hz, { risk, t: landT, now, warnHistory }),
            tide: collectTide(locations[st.key], win.targetDate, st.geometry, tideDeps),
            zoneWeather: collectZoneWeather(locations[st.key], regional),
        };
    });
}

module.exports = { areaOf, boxOf, haeguBox, loadStations, normalizeAddress, geocodeStation, estimateLocation, ensureLocations, assignSpots, assignHazards, warningsFromTree, releasedFrom, dayNoticeSummary, collectSea, smallWeather, smallRowAt, collectLand, collectTide, kmaOutlook, regionalForecast, nearestCoastalZone, nearestFarZone, collectZoneWeather, COASTAL_MAX_KM, gather, forecastKey, readJson, writeJson, CONFIG, DATA, stationSeas, seaZones, stationAreas };
