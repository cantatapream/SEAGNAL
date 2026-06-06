#!/usr/bin/env node
/**
 * Phase 1 지식그래프 빌더.
 * 정합화된 직군 파일(../jikgun/*.md)과 코드 식별자(해역/부이/조석항/도구)를 읽어
 * knowledge/graph/graph.json {nodes:[], edges:[]} 를 생성한다. 의존성 0(순수 fs/정규식).
 * 실행: node knowledge/graph/build_graph.js   (cwd 무관)
 *
 * 노드: SeaZone, Buoy, TideStation, DataParam, Tool, Jikgun, Topic, Term, Gap, ProactiveRule
 * 엣지: caresAbout, servedBy, isGap, usesVocab, hasRule, provides, near
 * 주의: GridZone(해구)↔SeaZone 좌표 포함표는 격자 좌표 데이터가 없어 v1에서 보류(스키마 §5 후속).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const GDIR = __dirname;                              // .../knowledge/graph
const KROOT = path.join(GDIR, '..');                 // .../knowledge
const SROOT = path.join(KROOT, '..');                // .../local_server
const JIK = path.join(KROOT, 'jikgun');
const OUT = path.join(GDIR, 'graph.json');

const nodes = [];
const edges = [];
const seen = new Set();
function addNode(id, type, props) {
    const key = type + '::' + id;
    if (seen.has(key)) return id;
    seen.add(key);
    nodes.push(Object.assign({ id, type }, props || {}));
    return id;
}
function addEdge(from, rel, to, props) {
    edges.push(Object.assign({ from, rel, to }, props || {}));
}
const norm = s => String(s || '').replace(/[\s·]/g, '');

// ---------------------------------------------------------------------------
// 1. 식별자(코드) 노드
// ---------------------------------------------------------------------------
// 1-a. SeaZone: ZONE_NAME_TO_CODE(assistant.js) + ZONE_COORDS(seaZoneCoordinates.js)
function readZoneNameToCode() {
    const src = fs.readFileSync(path.join(SROOT, 'routes', 'assistant.js'), 'utf8');
    const m = src.match(/const ZONE_NAME_TO_CODE\s*=\s*\{([\s\S]*?)\n\s*\};/);
    const map = {};
    if (m) {
        const re = /'([^']+)'\s*:\s*'([0-9A-Z]+)'/g; let p;
        while ((p = re.exec(m[1])) !== null) map[p[1]] = p[2];
    }
    return map;
}
function readZoneCoords() {
    const src = fs.readFileSync(path.join(SROOT, 'seaZoneCoordinates.js'), 'utf8');
    const re = /'([0-9A-Z]+)':\s*\{[\s\S]*?lat:\s*([-\d.]+),\s*lon:\s*([-\d.]+)/g;
    const c = {}; let m;
    while ((m = re.exec(src)) !== null) c[m[1]] = { lat: +m[2], lon: +m[3] };
    return c;
}
const ZN = readZoneNameToCode();
const ZC = readZoneCoords();
const seaZones = [];   // {regId, name, lat, lon}
const regSeen = new Set();
for (const name of Object.keys(ZN)) {
    const regId = ZN[name];
    const coord = ZC[regId] || null;
    if (!regSeen.has(regId)) {
        regSeen.add(regId);
        addNode(regId, 'SeaZone', { name, aliases: [name], lat: coord && coord.lat, lon: coord && coord.lon });
        if (coord) seaZones.push({ regId, name, lat: coord.lat, lon: coord.lon });
    } else {
        const nd = nodes.find(n => n.type === 'SeaZone' && n.id === regId);
        if (nd && !nd.aliases.includes(name)) nd.aliases.push(name);
    }
}

// 1-b. Buoy (buoyLocations.js)
const buoys = [];
{
    const src = fs.readFileSync(path.join(SROOT, 'buoyLocations.js'), 'utf8');
    const re = /"(\d+)":\s*\{\s*name:\s*"([^"]+)",\s*lon:\s*([-\d.]+),\s*lat:\s*([-\d.]+)(?:,\s*type:\s*"([^"]*)")?/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        addNode(m[1], 'Buoy', { name: m[2], lat: +m[4], lon: +m[3], buoyType: m[5] || '' });
        buoys.push({ id: m[1], name: m[2], lat: +m[4], lon: +m[3] });
    }
}

// 1-c. TideStation (tide.js)
const tides = [];
{
    const src = fs.readFileSync(path.join(SROOT, 'tide.js'), 'utf8');
    const re = /name:\s*"([^"]+)",\s*lat:\s*([-\d.]+),\s*lon:\s*([-\d.]+)/g;
    let m, i = 0;
    const tseen = new Set();
    while ((m = re.exec(src)) !== null) {
        if (tseen.has(m[1])) continue; tseen.add(m[1]);
        const id = 'tide:' + m[1];
        addNode(id, 'TideStation', { name: m[1], lat: +m[2], lon: +m[3] });
        tides.push({ id, name: m[1], lat: +m[2], lon: +m[3] }); i++;
    }
}

// 1-d. DataParam (스키마 §4 표준키)
const DATAPARAMS = {
    wave_height: 'm', wind_speed: 'm/s', wind_dir: 'deg', wave_period: 's',
    water_temp: '°C', visibility: 'km', current_speed: 'cm/s', depth: 'm',
    tide_phase: '-', warning: '-', typhoon_eta: 'h', sky: '-'
};
for (const k of Object.keys(DATAPARAMS)) addNode(k, 'DataParam', { unit: DATAPARAMS[k] });

// 1-e. Tool + provides (스키마 §4)
const TOOL_PROVIDES = {
    get_marine_forecast: ['wind_dir', 'wind_speed', 'wave_height', 'sky'],
    get_zone_forecast: ['wave_height', 'wave_period', 'wind_speed', 'wind_dir'],
    get_midterm_forecast: ['wave_height', 'sky'],
    get_warning: ['warning'],
    get_buoy_observation: ['wave_height', 'wind_speed', 'water_temp', 'visibility', 'wave_period'],
    get_buoys_with_obs: ['water_temp', 'wave_height', 'wind_speed'],
    get_nearest_buoy: ['wave_height', 'wind_speed', 'water_temp'],
    list_buoys_near: [],
    get_current: ['current_speed'],
    get_depth: ['depth'],
    get_tide: ['tide_phase'],
    get_seafog_cctv: ['visibility'],
    get_typhoon_status: ['typhoon_eta'],
    get_zones_ranked: ['wave_height', 'wind_speed'],
    get_surfing_index: [], get_fishing_index: [], get_sea_split_index: [],
    get_app_capabilities: [], resolve_location: []
};
for (const t of Object.keys(TOOL_PROVIDES)) {
    addNode(t, 'Tool', { provides: TOOL_PROVIDES[t] });
    for (const dp of TOOL_PROVIDES[t]) addEdge(t, 'provides', dp);
}

// ---------------------------------------------------------------------------
// 2. 직군 파일 파싱 → Jikgun/Topic/Term/Gap/ProactiveRule + 엣지
// ---------------------------------------------------------------------------
const JIKGUN_NAMES = {
    coast_guard: '해양경찰', fishery: '어업종사자', marine_leisure: '레저스포츠 활동자',
    mof: '해양수산부', navy: '해군', local_gov: '지방자치단체', public_org: '공공기관', angler: '기타(낚시객)'
};
function sectionMap(md) {
    // "## 제목" 기준으로 섹션 본문 분리
    const out = {}; let cur = null, buf = [];
    for (const ln of md.split('\n')) {
        const h = ln.match(/^##\s+(.*)/);
        if (h) { if (cur) out[cur] = buf.join('\n'); cur = h[1].trim(); buf = []; }
        else if (cur) buf.push(ln);
    }
    if (cur) out[cur] = buf.join('\n');
    return out;
}
function findSection(secs, re) {
    const k = Object.keys(secs).find(s => re.test(s));
    return k ? secs[k] : '';
}
// 한국어 기능명 → 도구 ID (관심사 [앱매핑] 부분 매칭용)
const FEATURE_TOOL = [
    [/단기\s*예보|해역별|기상\s*전망|풍향|하늘/, 'get_marine_forecast'],
    [/해구|시계열/, 'get_zone_forecast'],
    [/중기/, 'get_midterm_forecast'],
    [/특보|주의보|경보/, 'get_warning'],
    [/부이/, 'get_buoy_observation'],
    [/유향|유속|조류|해류/, 'get_current'],
    [/수심/, 'get_depth'],
    [/해무|cctv|시정/i, 'get_seafog_cctv'],
    [/조석|물때|고조|저조|바텀시트/, 'get_tide'],
    [/낚시\s*지수|바다낚시/, 'get_fishing_index'],
    [/서핑/, 'get_surfing_index'],
    [/바다갈라짐|갯벌/, 'get_sea_split_index'],
    [/태풍/, 'get_typhoon_status'],
    [/랭킹|비교/, 'get_zones_ranked'],
    [/최근접|가장\s*가까운|gps/i, 'get_nearest_buoy']
];
let nTopic = 0, nTerm = 0, nGap = 0, nRule = 0;
for (const slug of Object.keys(JIKGUN_NAMES)) {
    const fp = path.join(JIK, slug + '.md');
    if (!fs.existsSync(fp)) continue;
    const md = fs.readFileSync(fp, 'utf8');
    const secs = sectionMap(md);
    addNode(slug, 'Jikgun', { name: JIKGUN_NAMES[slug] });

    // 2-a. Topic (핵심 관심사 — 굵은 라벨 + [앱매핑] 도구/[GAP])
    const interest = findSection(secs, /^핵심 관심사/);
    let pr = 0;
    for (const ln of interest.split('\n')) {
        const b = ln.match(/\*\*([^*]+)\*\*/);
        if (!b) continue;
        pr++;
        const label = b[1].trim();
        const tid = slug + ':' + label;
        addNode(tid, 'Topic', { label, jikgun: slug, priority: pr });
        addEdge(slug, 'caresAbout', tid, { priority: pr });
        // [앱매핑]은 도구 함수명이 아닌 한국어 기능명이라 키워드로 도구에 매핑한다.
        const mapPart = (ln.split(/\[앱매핑\]/)[1] || ln);
        const mapped = new Set(mapPart.match(/get_[a-z_]+/g) || []);
        for (const [kw, tool] of FEATURE_TOOL) if (kw.test(mapPart)) mapped.add(tool);
        for (const t of mapped) if (TOOL_PROVIDES[t]) addEdge(tid, 'servedBy', t);
        if (/\[GAP\]/.test(ln)) { const nd = nodes.find(n => n.type === 'Topic' && n.id === tid); if (nd) nd.gap = true; }
        nTopic++;
    }

    // 2-b. Term (전문용어·동의어 표)
    const vocab = findSection(secs, /^전문용어/);
    for (const ln of vocab.split('\n')) {
        if (!/^\s*\|/.test(ln)) continue;
        const a = ln.split('|').map(s => s.trim());
        const cols = a.slice(1, a.length - 1);
        const std = cols[0], syn = cols[1];
        if (!std || !syn || /표준어/.test(std) || /^:?-+:?$/.test(std)) continue;
        const id = 'term:' + slug + ':' + std;
        const synonyms = syn.split(/[,/·]/).map(s => s.trim()).filter(Boolean);
        addNode(id, 'Term', { standard: std, synonyms, jikgun: slug });
        addEdge(slug, 'usesVocab', id);
        nTerm++;
    }

    // 2-c. Gap (GAP 보완 후보 표)
    const gap = findSection(secs, /^GAP 보완/);
    for (const ln of gap.split('\n')) {
        if (!/^\s*\|/.test(ln)) continue;
        const a = ln.split('|').map(s => s.trim());
        const cols = a.slice(1, a.length - 1);
        const item = (cols[0] || '').replace(/\*\*/g, '');
        const org = cols[1], url = (cols[2] || '').match(/https?:\/\/\S+/);
        if (!item || /GAP 항목/.test(item) || /^:?-+:?$/.test(item)) continue;
        const id = 'gap:' + slug + ':' + item;
        addNode(id, 'Gap', { label: item, externalSource: org || null, url: url ? url[0] : null, jikgun: slug });
        addEdge(slug, 'hasGap', id);
        nGap++;
    }

    // 2-d. ProactiveRule (### TR-<약어>-NN 블록)
    const rules = findSection(secs, /선제 제안/);
    const blocks = rules.split(/\n(?=### TR-)/);
    for (const blk of blocks) {
        const h = blk.match(/^### (TR-[A-Z]+-\d+):\s*(.*)/);
        if (!h) continue;
        const ruleId = h[1], title = h[2].trim();
        const cond = (blk.match(/트리거\(조건식\):\s*(.*)/) || [])[1] || '';
        const msg = (blk.match(/제안 멘트:\s*"?([^"\n]+)"?/) || [])[1] || '';
        const basis = (blk.match(/근거 앱데이터:\s*(.*)/) || [])[1] || '';
        addNode(ruleId, 'ProactiveRule', { jikgun: slug, title, trigger: cond.trim(), message: msg.trim(), basis: basis.trim() });
        addEdge(slug, 'hasRule', ruleId);
        // 트리거 metric → DataParam 연결
        const metrics = [...cond.matchAll(/metric:\s*"([a-z_]+)"/g)].map(x => x[1]);
        for (const mt of [...new Set(metrics)]) if (DATAPARAMS[mt]) addEdge(ruleId, 'triggersOn', mt);
        nRule++;
    }
}

// ---------------------------------------------------------------------------
// 3. 지리 엣지: SeaZone → 최근접 Buoy/TideStation (Haversine)
// ---------------------------------------------------------------------------
function hav(a, b) {
    const R = 6371, toR = d => d * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}
function nearest(zone, list, k, maxKm) {
    return list.map(x => ({ x, d: hav(zone, x) }))
        .filter(o => o.d <= maxKm).sort((a, b) => a.d - b.d).slice(0, k);
}
for (const z of seaZones) {
    for (const o of nearest(z, buoys, 3, 120)) addEdge(z.regId, 'near', o.x.id, { km: Math.round(o.d) });
    for (const o of nearest(z, tides, 2, 120)) addEdge(z.regId, 'near', o.x.id, { km: Math.round(o.d) });
}

// ---------------------------------------------------------------------------
// 4. 저장 + 통계
// ---------------------------------------------------------------------------
const byType = {};
for (const n of nodes) byType[n.type] = (byType[n.type] || 0) + 1;
const byRel = {};
for (const e of edges) byRel[e.rel] = (byRel[e.rel] || 0) + 1;
const graph = {
    builtAt: new Date().toISOString(),
    stats: { nodes: nodes.length, edges: edges.length, byType, byRel },
    nodes, edges
};
fs.mkdirSync(GDIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(graph, null, 1));
console.log('graph.json 생성:', OUT);
console.log('노드', nodes.length, byType);
console.log('엣지', edges.length, byRel);
console.log('직군 추출: Topic', nTopic, 'Term', nTerm, 'Gap', nGap, 'Rule', nRule);
