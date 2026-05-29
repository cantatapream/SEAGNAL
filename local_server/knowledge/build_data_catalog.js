#!/usr/bin/env node
/**
 * 데이터 카탈로그 빌더 — 나리야가 "우리가 무엇을, 어떻게 수집하는지" 항상 알도록
 * knowledge/data_catalog.json(단일 출처)을 생성한다.
 *
 * 설계: 풍부한 메타데이터(기관/방식/주기/필드/단위)는 여기 META/ONDEMAND 에 큐레이트하되,
 * **실제 코드와의 드리프트는 자동 검출**한다 — services/cache_manager.js 의 캐시키와
 * routes/assistant.js 의 TOOL_EXEC 도구가 카탈로그에 빠지면 빌드를 실패시킨다(수동 동기화 방지).
 *
 * 실행: node knowledge/build_data_catalog.js   (cwd 무관)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const KROOT = __dirname;                       // .../knowledge
const SROOT = path.join(KROOT, '..');          // .../local_server
const OUT = path.join(KROOT, 'data_catalog.json');

// 표준 관측·예보 파라미터(스키마 §4) — 단위 포함
const DATAPARAMS = {
    wave_height: 'm', wind_speed: 'm/s', wind_dir: 'deg', wave_period: 's',
    water_temp: '°C', visibility: 'km', current_speed: 'cm/s', depth: 'm',
    tide_phase: '-', warning: '-', typhoon_eta: 'h', sky: '-'
};

// 캐시 데이터셋 메타(큐레이트). key = cache_manager.js 의 dataCache 키.
const META = {
    warnings:            { label: '해상특보(주의보/경보)', org: '기상청 marine MMIS', method: '크롤링', cadence: '1분', granularity: '해역(특보구역)+자식', fields: ['type', 'command', 'tmEf', 'history'], params: ['warning'], exposedBy: ['get_warning'] },
    forecasts:           { label: '해상 단기예보', org: '기상청 apihub', method: 'API', cadence: '05:15·17:15', granularity: '해역(43구역)', fields: ['wf', 'wd', 'ws', 'wh', 'sky'], params: ['wind_dir', 'wind_speed', 'wave_height', 'sky'], exposedBy: ['get_marine_forecast', 'get_zones_ranked'] },
    zoneForecasts:       { label: '해구별 파고·바람 시계열전망', org: '기상청 apihub', method: 'API', cadence: '09:30·21:30 (+75h/3h)', granularity: '해구(번호격자)', fields: ['wh', 'wp', 'waveDir', 'ws', 'windDir', 'tm'], params: ['wave_height', 'wave_period', 'wind_speed', 'wind_dir'], exposedBy: ['get_zone_forecast', 'get_zones_ranked'] },
    midTermSeaForecasts: { label: '중기 해상예보(3~10일)', org: '기상청 apihub', method: 'API', cadence: '06:15·18:15', granularity: '해역(8광역)', fields: ['wf', 'wh'], params: ['wave_height', 'sky'], exposedBy: ['get_midterm_forecast'] },
    marineBuoys:         { label: '해양기상부이(B타입)', org: '기상청 marine.kma', method: 'API', cadence: ':03·:13', granularity: '부이(~43)', fields: ['sig_wh', 'max_wh', 'wp', 'ws', 'wd', 'ta', 'pa', 'hm', 'tw', 'vs'], params: ['wave_height', 'wind_speed', 'water_temp', 'visibility', 'wave_period'], exposedBy: ['get_buoy_observation', 'get_buoys_with_obs', 'get_nearest_buoy', 'list_buoys_near'] },
    marineWhBuoys:       { label: '파고부이(C타입)', org: '기상청 marine.kma', method: 'API', cadence: ':03·:13', granularity: '부이(~51)', fields: ['sig_wh', 'max_wh', 'ave_wh', 'wp', 'tw'], params: ['wave_height', 'wave_period', 'water_temp'], exposedBy: ['get_buoy_observation', 'get_buoys_with_obs', 'get_nearest_buoy', 'list_buoys_near'] },
    marineLhBuoys:       { label: '등표(L타입)', org: '기상청 marine.kma', method: 'API', cadence: ':03·:13', granularity: '등표(9)', fields: ['ws', 'wd', 'gst', 'ta', 'pa', 'hm'], params: ['wind_speed'], exposedBy: ['get_buoy_observation', 'get_buoys_with_obs', 'get_nearest_buoy', 'list_buoys_near'] },
    marineVs:            { label: '시정계(가시거리)', org: '기상청 marine.kma', method: 'API', cadence: ':03·:13', granularity: '지점(~181)', fields: ['vs'], params: ['visibility'], exposedBy: [] },
    fishingIndex:        { label: '바다낚시 지수', org: '국립해양조사원(KHOA)', method: 'API', cadence: '06:30·18:30', granularity: '지점(갯바위/선상)', fields: ['totalIndex', 'wave', 'temp', 'current', 'wind', 'fish'], params: ['wave_height', 'water_temp', 'current_speed', 'wind_speed'], exposedBy: ['get_fishing_index'] },
    surfingIndex:        { label: '서핑 지수', org: '국립해양조사원(KHOA)', method: 'API', cadence: '06:30·18:30', granularity: '해수욕장(16)', fields: ['wave', 'period', 'wind', 'temp', 'grades', 'alert'], params: ['wave_height', 'wave_period', 'wind_speed', 'water_temp'], exposedBy: ['get_surfing_index'] },
    seaSplitIndex:       { label: '바다갈라짐(체험) 지수', org: '국립해양조사원(KHOA)', method: 'API', cadence: '매시 35분', granularity: '지점(14)', fields: ['bgng', 'end', 'index', 'ta', 'wind'], params: [], exposedBy: ['get_sea_split_index'] },
    // 미노출/콘텐츠/레거시
    buoys:    { label: '부이 실황(J타입, raw)', org: '기상청 apihub', method: 'API', cadence: '매시 05·35분', granularity: '부이', fields: ['WH', 'WD', 'WS', 'TW', 'TA'], params: ['wave_height', 'wind_speed', 'water_temp'], exposedBy: [], note: '레거시 raw 피드 — marineBuoys로 대체, AI 미노출' },
    kmaBuoys: { label: '[DEPRECATED] kma_buoy.php', org: '기상청', method: 'API', cadence: '중단', granularity: '부이', fields: [], params: [], exposedBy: [], note: '갱신 중단, 호환용 키만 유지' },
    notice:   { label: '공지', org: '자체(관리자)', method: 'CRUD', cadence: '수동', granularity: '-', fields: [], params: [], exposedBy: [], note: '앱 콘텐츠(기상데이터 아님)' },
    promo:    { label: '홍보', org: '자체(관리자)', method: 'CRUD', cadence: '수동', granularity: '-', fields: [], params: [], exposedBy: [], note: '앱 콘텐츠' },
    boards:   { label: '게시판', org: '자체(사용자)', method: 'CRUD', cadence: '수동', granularity: '-', fields: [], params: [], exposedBy: [], note: '앱 콘텐츠' }
};

// 온디맨드(캐시 아님, 라우트에서 요청 시 수집) 데이터셋 — 도구로만 접근.
const ONDEMAND = {
    current:     { label: '유향·유속(해류)', org: '국립해양조사원 해아름', method: 'API(격자, 30분 캐시)', cadence: '현재~+72h', granularity: '격자/해역', fields: ['s', 'd', 'temp'], params: ['current_speed'], tools: ['get_current'] },
    depth:       { label: '수심(BADA2024)', org: '국립해양조사원', method: '정적 격자 CSV', cadence: '정적', granularity: '격자', fields: ['수심'], params: ['depth'], tools: ['get_depth'] },
    tide:        { label: '조석(고조·저조·조위)', org: '국립해양조사원 TideBED', method: 'API(요청 시, LRU 캐시)', cadence: '요청 시', granularity: '지점/격자', fields: ['조위', '고조', '저조'], params: ['tide_phase'], tools: ['get_tide'] },
    seafogCctv:  { label: '해무 CCTV 스틸컷', org: '국립해양조사원', method: 'API', cadence: '10분', granularity: '항만(9)', fields: ['imgDt', 'uri'], params: ['visibility'], tools: ['get_seafog_cctv'] },
    typhoon:     { label: '태풍 통보문·진로', org: '기상청 방재기상플랫폼(dmdw)', method: '로그인 크롤링', cadence: '10분', granularity: '태풍', fields: ['lat', 'lon', 'pressure', 'windMs', 'grade'], params: ['typhoon_eta'], tools: ['get_typhoon_status'] }
};

// 도구 자체(데이터 비매핑) — 메타/위치 도구
const META_TOOLS = { get_app_capabilities: '앱 기능 안내(메타)', resolve_location: '지명→좌표 변환' };

// ---------------------------------------------------------------------------
// 코드에서 실제 캐시키·도구 추출 (드리프트 검출용)
// ---------------------------------------------------------------------------
function actualCacheKeys() {
    const src = fs.readFileSync(path.join(SROOT, 'services', 'cache_manager.js'), 'utf8');
    const m = src.match(/const files = \{([\s\S]*?)\n\s*\};/);
    const keys = [];
    if (m) { const re = /(\w+):\s*'[^']+\.json'/g; let p; while ((p = re.exec(m[1])) !== null) keys.push(p[1]); }
    return keys;
}
function actualTools() {
    const src = fs.readFileSync(path.join(SROOT, 'routes', 'assistant.js'), 'utf8');
    const m = src.match(/const TOOL_EXEC = \{([\s\S]*?)\n\};/);
    const tools = [];
    if (m) { const re = /^\s{4}([a-z_]+):\s*async/gm; let p; while ((p = re.exec(m[1])) !== null) tools.push(p[1]); }
    return tools;
}

// ---------------------------------------------------------------------------
// 조립 + 드리프트 검증
// ---------------------------------------------------------------------------
const cacheKeys = actualCacheKeys();
const tools = actualTools();
const problems = [];

for (const k of cacheKeys) if (!META[k]) problems.push(`cache_manager 키 '${k}' 가 META 에 없음(카탈로그 미반영)`);
const exposedTools = new Set();
for (const k of Object.keys(META)) for (const t of (META[k].exposedBy || [])) exposedTools.add(t);
for (const k of Object.keys(ONDEMAND)) for (const t of (ONDEMAND[k].tools || [])) exposedTools.add(t);
for (const t of Object.keys(META_TOOLS)) exposedTools.add(t);
for (const t of tools) if (!exposedTools.has(t)) problems.push(`TOOL_EXEC 도구 '${t}' 가 카탈로그에 매핑 안 됨`);
// 카탈로그가 참조하는 도구가 실제 존재하는지(역방향)
const toolSet = new Set(tools);
for (const t of exposedTools) if (!toolSet.has(t)) problems.push(`카탈로그가 참조한 도구 '${t}' 가 TOOL_EXEC 에 없음`);

if (problems.length) {
    console.error('[data_catalog] 드리프트 검출 — 빌드 실패:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
}

const datasets = cacheKeys.map(k => Object.assign({ key: k, kind: 'cache', exposed: (META[k].exposedBy || []).length > 0 }, META[k]));
const ondemand = Object.keys(ONDEMAND).map(k => Object.assign({ key: k, kind: 'ondemand', exposed: true }, ONDEMAND[k]));
const exposedCount = datasets.filter(d => d.exposed).length + ondemand.length;

const catalog = {
    builtAt: new Date().toISOString(),
    stats: {
        datasets: datasets.length + ondemand.length,
        exposed: exposedCount,
        unexposed: datasets.filter(d => !d.exposed).length,
        tools: tools.length
    },
    dataParams: Object.keys(DATAPARAMS).map(k => ({ key: k, unit: DATAPARAMS[k] })),
    datasets, ondemand,
    tools: tools.map(t => ({ name: t, meta: META_TOOLS[t] || null }))
};
fs.writeFileSync(OUT, JSON.stringify(catalog, null, 1));
console.log('data_catalog.json 생성:', OUT);
console.log('데이터셋', catalog.stats.datasets, '| 노출', catalog.stats.exposed, '| 미노출', catalog.stats.unexposed, '| 도구', catalog.stats.tools);
