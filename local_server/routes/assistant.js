/**
 * ============================================================================
 * 파일명: routes/assistant.js
 * 역할: 음성/텍스트 AI 비서 백엔드 (자연어 질문 → 실데이터 근거 답변)
 * ============================================================================
 *
 * [설명]
 *   "오늘 제주도 북부 앞바다 기상 현황 알려줘" 같은 자연어 질문을 받아
 *   ① 어느 해역(zone)을 묻는지, ② 무엇(기상전망/특보)을 묻는지 파악하고,
 *   서버 메모리 캐시(dataCache)에 이미 들어와 있는 실제 기상 데이터만 근거로
 *   자연어 답변을 만들어 돌려준다.
 *
 *   엔드포인트:
 *     POST /api/assistant/ask      { query }  → { ok, zone, intent, answer, data, aiUsed }
 *     GET  /api/assistant/health             → { aiAvailable, dataReady, zoneCount }
 *
 * [설계 원칙 — 어선/항해용이라 안전 최우선]
 *   - AI 가 수치를 지어내지 못하도록, 답변 생성 단계에서 "주어진 데이터만 사용,
 *     없는 값은 모른다고 말하라"를 강제한다.
 *   - Gemini 키가 없거나 쿨다운이어도 동작하도록, 해역 매칭과 답변 생성 모두
 *     결정론적(deterministic) 폴백 경로를 둔다. → 키 없이도 실데이터 답변 가능.
 *
 * [데이터 출처 — 재수집 없이 기존 메모리 캐시 재사용]
 *   - dataCache.forecasts : general_forecasts.json (해역별 단기 기상전망)
 *   - dataCache.warnings  : weather_alerts.json   (해상 특보 트리)
 *
 * [연계 파일]
 *   - services/cache_manager.js → dataCache
 *   - services/gemini_client.js → callGemini (키 라운드로빈/폴백)
 *   - server.js                 → app.use()로 이 라우터 등록
 *   - js/assistant.js           → 프론트엔드(음성 호출어 + 텍스트)
 * ============================================================================
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { dataCache } = require('../services/cache_manager');
let DATA_DIR = path.join(__dirname, '..', 'data');
let SERVER_PORT = 3001;
try {
    const cfg = require('../config/server_config');
    DATA_DIR = cfg.DATA_DIR || DATA_DIR;
    SERVER_PORT = cfg.PORT || SERVER_PORT;
} catch (e) { /* 기본값 사용 */ }

/** 같은 서버의 내부 API를 호출(좌표 기반 해양 데이터·장소검색 등). Node18+ 전역 fetch 사용. */
async function internalGet(pathStr) {
    try {
        const r = await fetch('http://127.0.0.1:' + SERVER_PORT + pathStr);
        if (!r.ok) return { error: 'HTTP ' + r.status };
        return await r.json();
    } catch (e) { return { error: e.message }; }
}
async function internalPost(pathStr, bodyObj) {
    try {
        const r = await fetch('http://127.0.0.1:' + SERVER_PORT + pathStr, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj)
        });
        if (!r.ok) return { error: 'HTTP ' + r.status };
        return await r.json();
    } catch (e) { return { error: e.message }; }
}
const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 좌표의 오늘 고조/저조 시각을 조석 파이프라인(save_tide_input → /data 폴링)으로 조회. */
async function fetchTideTimes(lat, lon) {
    try {
        const now = new Date(), p = n => (n < 10 ? '0' : '') + n;
        const date = '' + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate());
        const time = p(now.getHours()) + p(now.getMinutes());
        const start = await internalPost('/api/save_tide_input', { date, time, lat, lon, deviceId: 'assistant-server' });
        if (!start || !start.files || !start.files.today) return null;
        const file = start.files.today;
        for (let i = 0; i < 8; i++) {
            const t = await internalGet('/data/' + encodeURIComponent(file));
            if (t && typeof t.tideBedStatus === 'string' && t.tideBedStatus.indexOf('complete') === 0) {
                const fmt = pk => (pk && pk.time) ? { 시각: pk.time, 조위m: pk.height } : null;
                const highs = [fmt(t.highTide1), fmt(t.highTide2)].filter(Boolean);
                const lows = [fmt(t.lowTide1), fmt(t.lowTide2)].filter(Boolean);
                return (highs.length || lows.length) ? { 고조: highs, 저조: lows } : null;
            }
            await _sleep(1200);
        }
        return null;
    } catch (e) { return null; }
}

// ============================================================================
// 부이 이름 ↔ ID 매핑 — buoyLocations.js(브라우저 전역 스크립트)에서 1회 파싱.
// "○○ 부이" 처럼 특정 부이를 물으면 그 부이를 앱에서 바로 열 수 있도록 id 를 얻는다.
// 파싱 실패해도(파일 변경 등) 빈 맵으로 두고 일반 부이 링크로 폴백 — 기동 안전.
// ============================================================================
const BUOY_BY_ID = [];   // [{ id, name, nname, lat, lon, type }]
try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'buoyLocations.js'), 'utf8');
    // 형식: "22103": { name: "거문도", lon: 127.5, lat: 34.0, type: "B" }
    const re = /"(\d+)":\s*\{\s*name:\s*"([^"]+)",\s*lon:\s*([-\d.]+),\s*lat:\s*([-\d.]+)(?:,\s*type:\s*"([^"]*)")?/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        BUOY_BY_ID.push({
            id: m[1], name: m[2], nname: m[2].replace(/[\s·]/g, ''),
            lon: +m[3], lat: +m[4], type: m[5] || ''
        });
    }
    console.log(`[Assistant] 부이 ${BUOY_BY_ID.length}개 로드됨`);
} catch (e) {
    console.warn('[Assistant] buoyLocations 파싱 실패 — 일반 부이 링크로 폴백:', e.message);
}

// [패치 A — C1] 부이 이름 → 좌표 lookup — focus.buoy 만 있는 follow-up 에서 좌표 폴백.
//   정확 일치 우선(nname === nn), 없으면 양방향 includes 로 보조 매칭(오매칭 위험 최소화).
function buoyToCoords(name) {
    if (!name) return null;
    const nn = String(name).replace(/[\s·]/g, '');
    if (!nn) return null;
    let hit = BUOY_BY_ID.find(b => b.nname === nn);
    if (!hit) hit = BUOY_BY_ID.find(b => b.nname.includes(nn) || nn.includes(b.nname));
    return hit ? { lat: hit.lat, lon: hit.lon } : null;
}

// ============================================================================
// 지명 → 해점 좌표 — 물때 바텀시트를 "그 지명에서 가장 가까운 해점"에서 띄우기 위함.
//  ① 조석 표준항(TIDE_REFERENCE_STATIONS, tide.js): 인천/제주/부산/목포 등 항만 좌표
//  ② 해역 대표좌표(SEA_ZONE_COORDINATES, seaZoneCoordinates.js): 특보구역 중심점
//     (코드 체계가 ZONE_NAME_TO_CODE 와 동일 — 예: 울산앞바다=12C10101)
//  파싱 실패해도 빈 맵으로 폴백 → 기동 안전.
// ============================================================================
const TIDE_STATIONS = [];        // [{ name, nname, lat, lon }]
try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'tide.js'), 'utf8');
    const re = /name:\s*"([^"]+)",\s*lat:\s*([-\d.]+),\s*lon:\s*([-\d.]+)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        TIDE_STATIONS.push({ name: m[1], nname: m[1].replace(/[\s·]/g, ''), lat: +m[2], lon: +m[3] });
    }
    console.log(`[Assistant] 조석 표준항 ${TIDE_STATIONS.length}개 로드됨`);
} catch (e) {
    console.warn('[Assistant] tide 표준항 파싱 실패:', e.message);
}

const ZONE_COORDS = {};          // code → { lat, lon }
try {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'seaZoneCoordinates.js'), 'utf8');
    const re = /'([0-9A-Z]+)':\s*\{[\s\S]*?lat:\s*([-\d.]+),\s*lon:\s*([-\d.]+)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        ZONE_COORDS[m[1]] = { lat: +m[2], lon: +m[3] };
    }
    console.log(`[Assistant] 해역 좌표 ${Object.keys(ZONE_COORDS).length}개 로드됨`);
} catch (e) {
    console.warn('[Assistant] seaZoneCoordinates 파싱 실패:', e.message);
}

// 해구(번호 격자) 좌표 — data/zone_coords.json (해구번호 → 위경도). 해구 랭킹·조회의 경위도원.
const HAEGU_COORDS = {};
try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'zone_coords.json'), 'utf8'));
    const src = raw && raw.data ? raw.data : raw;
    for (const k of Object.keys(src || {})) {
        const v = src[k];
        if (v && v.lat != null && v.lon != null) HAEGU_COORDS[String(k)] = { lat: +v.lat, lon: +v.lon };
    }
    console.log(`[Assistant] 해구 좌표 ${Object.keys(HAEGU_COORDS).length}개 로드됨`);
} catch (e) {
    console.warn('[Assistant] zone_coords 로드 실패 — 해구 좌표 없이 동작:', e.message);
}

// 데이터 카탈로그(단일 출처, knowledge/data_catalog.json) — "우리가 무엇을 수집하는지"를
// 플래너에 주입해 변칙·교차 질문에서도 보유/미보유를 정확히 판단하게 한다. 부재 시 빈 문자열.
let CATALOG_DIGEST = '';
try {
    const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'knowledge', 'data_catalog.json'), 'utf8'));
    const exposed = [...cat.datasets.filter(d => d.exposed), ...cat.ondemand].map(d => `${d.label}(${d.granularity})`);
    const unexposed = cat.datasets.filter(d => !d.exposed && (d.params || []).length).map(d => d.label);
    CATALOG_DIGEST =
`[수집 데이터 인벤토리 — 이 목록 안에서만 답하세요]
도구로 답 가능: ${exposed.join(' · ')}
${unexposed.length ? '수집하지만 아직 전용 도구 없음: ' + unexposed.join(' · ') + ' (물으면 "수집은 하지만 아직 안내 기능이 없어요"라고 안내)\n' : ''}이 인벤토리에 없는 정보는 지어내지 말고 "그 정보는 없어요"라고 하세요.`;
    console.log(`[Assistant] 데이터 카탈로그 로드: 데이터셋 ${cat.stats.datasets} · 노출 ${cat.stats.exposed} · 미노출 ${cat.stats.unexposed}`);
} catch (e) {
    console.warn('[Assistant] data_catalog 로드 실패 — 인벤토리 주입 없이 동작:', e.message);
}

// ============================================================================
// 직군별 지식베이스 (Phase 2b 간이 RAG) — knowledge/jikgun/*.md 에서 다이제스트 추출.
//  사용자 프로필의 직업/소속을 8개 직군 슬러그로 감지 → 해당 직군의 "핵심 관심사 +
//  전문용어"를 플래너/합성 컨텍스트에 주입(직군 맞춤 답변·STT 보정). 임베딩은 추후 단계.
//  파일 부재/파싱 실패해도 빈 맵으로 폴백 — 기동/응답 안전.
// ============================================================================
const JIKGUN_META = {
    fishery:        { name: '어업종사자', kw: ['어선', '선장', '선원', '조업', '어업', '양식', '어민', '어업인', '선주', '연승', '자망', '통발'] },
    angler:         { name: '기타(낚시객)', kw: ['낚시', '낚시객', '낚시꾼', '갯바위', '선상낚시', '루어', '원투', '출조', '조사', '에깅'] },
    marine_leisure: { name: '레저스포츠 활동자', kw: ['서핑', '서퍼', '요트', '세일링', '카약', '카누', 'sup', '패들', '다이빙', '스쿠버', '프리다이빙', '제트스키', '수상레저', '레저', '보트', '윈드서핑', '카이트'] },
    coast_guard:    { name: '해양경찰', kw: ['해양경찰', '해경', '수색구조', '구조대', '단속', '방제', '파출소', '경비함', '함정'] },
    navy:           { name: '해군', kw: ['해군', '해상작전', '초계', '상륙', '구축함', '호위함', '잠수함', '군함'] },
    mof:            { name: '해양수산부', kw: ['해양수산부', '해수부', '수산정책', '어업관리', '해양정책', '수산자원'] },
    local_gov:      { name: '지방자치단체', kw: ['지자체', '시청', '군청', '구청', '도청', '지방자치', '방재', '연안관리', '재난'] },
    public_org:     { name: '공공기관', kw: ['공사', '공단', '항만공사', '해양환경공단', '수산자원공단', '국립해양조사원', '교통안전공단', 'koem', 'fira', 'khoa', 'komsa', 'kiost', 'bpa', '연구원', '연구소', '공공기관'] }
};

const JIKGUN_KB = {};   // slug → { name, interests:[...], vocab:[[표준어,구어],...] }
try {
    const dir = path.join(__dirname, '..', 'knowledge', 'jikgun');
    for (const slug of Object.keys(JIKGUN_META)) {
        const fp = path.join(dir, slug + '.md');
        if (!fs.existsSync(fp)) continue;
        const interests = [], vocab = [];
        let sec = '';
        for (const ln of fs.readFileSync(fp, 'utf8').split('\n')) {
            const h = ln.match(/^##\s+(.*)/);
            if (h) { sec = h[1]; continue; }
            if (/^핵심 관심사/.test(sec)) {
                const b = ln.match(/\*\*([^*]+)\*\*/);
                if (b && interests.length < 14) interests.push(b[1].trim());
            } else if (/^전문용어/.test(sec) && /^\s*\|/.test(ln)) {
                const a = ln.split('|').map(s => s.trim());
                const cols = a.slice(1, a.length - 1);   // 양끝 빈칸 제거
                const std = cols[0], syn = cols[1];
                if (std && syn && !/표준어/.test(std) && !/^:?-+:?$/.test(std) && vocab.length < 18) {
                    vocab.push([std, syn]);
                }
            }
        }
        JIKGUN_KB[slug] = { name: JIKGUN_META[slug].name, interests, vocab };
    }
    const tot = Object.values(JIKGUN_KB).reduce((a, k) => a + k.interests.length, 0);
    console.log(`[Assistant] 직군 지식 ${Object.keys(JIKGUN_KB).length}종 로드됨 (관심사 ${tot}개)`);
} catch (e) {
    console.warn('[Assistant] 직군 지식 로드 실패 — 직군 개인화 없이 동작:', e.message);
}

// [§6 #21] 직군별 안전 임계표 — synth 가 사용자 제시 정량 수치(파고/풍속/시정)에
//   즉시 가부 결론을 내릴 수 있게 한다. 자유변칙 정량 카테고리 15% → 70%+ 목표.
let JIKGUN_THRESHOLDS = {};
try {
    const tp = path.join(__dirname, '..', 'knowledge', 'jikgun', '_thresholds.json');
    const tj = JSON.parse(fs.readFileSync(tp, 'utf8'));
    JIKGUN_THRESHOLDS = (tj && tj.jikgun) || {};
    console.log(`[Assistant] 직군 임계표 로드: ${Object.keys(JIKGUN_THRESHOLDS).length}직군`);
} catch (e) {
    console.warn('[Assistant] 직군 임계표 로드 실패:', e.message);
}

/** synth 가 사용자 정량 질의에 즉시 비교할 수 있도록 한 직군 임계표를 짧은 텍스트로. */
function thresholdDigest(slug) {
    const t = (slug && JIKGUN_THRESHOLDS[slug]) || JIKGUN_THRESHOLDS._default || null;
    if (!t) return '';
    const fmt = (k, v) => v ? `${k}: 안전≤${v.safe} / 주의 ${v.safe}~${v.caution} / 무리·위험≥${v.caution}${v.danger?'(매우 위험≥'+v.danger+')':''} ${v.unit || ''}` : '';
    const lines = [];
    if (t.wave_m)        lines.push(fmt('파고', t.wave_m));
    if (t.wind_ms)       lines.push(fmt('풍속', t.wind_ms));
    if (t.visibility_km) lines.push(fmt('시정', t.visibility_km));
    if (t.wave_period_s) lines.push(fmt('파주기', t.wave_period_s));
    if (t.water_temp_c)  lines.push(fmt('수온', t.water_temp_c));
    if (!lines.length) return '';
    return `[직군 ${t.label || slug} 안전 임계표]\n` + lines.join('\n')
        + (t.comment ? `\n주의: ${t.comment}` : '')
        + `\n공통 풍랑특보 기준: 풍랑주의보=파고 3m·풍속 14m / 풍랑경보=파고 5m·풍속 21m.`;
}

/** 프로필(직업/소속/목적)에서 8개 직군 슬러그를 감지. 못 찾으면 null. */
function detectJikgun(profile) {
    if (!profile) return null;
    let text = '';
    if (typeof profile === 'object') {
        text = [profile.occupation, profile.affiliation, profile['소속'], profile.purpose,
                profile.vesselText, (profile.vessel && profile.vessel.text)]
            .filter(Boolean).join(' ');
        if (!text) text = JSON.stringify(profile);
    } else text = String(profile);
    text = text.toLowerCase();
    let best = null, bestN = 0;
    for (const slug of Object.keys(JIKGUN_META)) {
        let n = 0;
        for (const k of JIKGUN_META[slug].kw) if (text.includes(k.toLowerCase())) n++;
        if (n > bestN) { bestN = n; best = slug; }
    }
    return bestN > 0 ? best : null;
}

/** 감지된 직군의 다이제스트(이름·핵심관심사·용어). 없으면 null. */
function jikgunDigest(profile) {
    const slug = detectJikgun(profile);
    if (!slug) return null;
    // 지식그래프(런타임 단일 출처) 우선: 관심사+권장도구(servedBy). 없으면 MD 다이제스트로 폴백.
    const g = GRAPH_RT.jikgun[slug];
    if (g && g.topics.length) {
        const kb = JIKGUN_KB[slug] || {};
        return {
            name: g.name,
            interests: g.topics.map(t => t.label),
            topicTools: g.topics.filter(t => t.tools.length).slice(0, 10)
                .map(t => `${t.label}→${[...new Set(t.tools)].join('/')}`),
            vocab: kb.vocab || []
        };
    }
    const kb = JIKGUN_KB[slug];
    if (!kb || (!kb.interests.length && !kb.vocab.length)) return null;
    return Object.assign({ topicTools: [] }, kb);
}


// ============================================================================
// Phase 1→2b: 지식그래프 런타임 연결. knowledge/graph/graph.json 을 단일 출처로 읽어
//  직군 "관심사→권장도구(servedBy)" 라우팅 힌트를 플래너에 공급한다(감지된 직군에 한함).
//  그래프 부재/파싱 실패 시 MD 다이제스트(JIKGUN_KB)로 자동 폴백 — 기동/응답 안전.
//  주: 전역 동의어 substring 주입은 흔한 단어("조금"=소조기 등) 오매칭 위험으로 도입하지 않음.
// ============================================================================
const GRAPH_RT = { jikgun: {} };   // slug → { name, topics:[{label,priority,tools:[...]}] }
try {
    const gp = path.join(__dirname, '..', 'knowledge', 'graph', 'graph.json');
    const G = JSON.parse(fs.readFileSync(gp, 'utf8'));
    const nodes = G.nodes || [], edges = G.edges || [];
    const servedBy = {};   // topicId → [tool]
    for (const e of edges) if (e.rel === 'servedBy') (servedBy[e.from] = servedBy[e.from] || []).push(e.to);
    for (const n of nodes) if (n.type === 'Jikgun') GRAPH_RT.jikgun[n.id] = { name: n.name, topics: [] };
    for (const n of nodes) {
        if (n.type === 'Topic' && GRAPH_RT.jikgun[n.jikgun]) {
            GRAPH_RT.jikgun[n.jikgun].topics.push({ label: n.label, priority: n.priority || 99, tools: servedBy[n.id] || [] });
        }
    }
    for (const s of Object.keys(GRAPH_RT.jikgun)) GRAPH_RT.jikgun[s].topics.sort((a, b) => a.priority - b.priority);
    const ttot = Object.values(GRAPH_RT.jikgun).reduce((a, j) => a + j.topics.length, 0);
    console.log(`[Assistant] 지식그래프 로드: 직군 ${Object.keys(GRAPH_RT.jikgun).length}종 · 관심사노드 ${ttot}개`);
} catch (e) {
    console.warn('[Assistant] 지식그래프 로드 실패 — MD 다이제스트로 폴백:', e.message);
}

// Phase 2b PoC — 토픽 임베딩 워밍업(백그라운드). 디스크 캐시 있으면 즉시. 실패해도 무영향.
let TOPIC_EMBED = null;
try {
    TOPIC_EMBED = require('../services/topic_embedding');
    const topicEntries = [];
    for (const slug of Object.keys(GRAPH_RT.jikgun)) {
        for (const t of GRAPH_RT.jikgun[slug].topics) {
            topicEntries.push({ id: `${slug}:${t.label}`, jikgun: slug, label: t.label, tools: t.tools || [] });
        }
    }
    if (topicEntries.length) {
        TOPIC_EMBED.warmup(topicEntries).catch(e => console.warn('[TopicEmbed] warmup 예외:', e.message));
    }
} catch (e) {
    console.warn('[Assistant] 토픽 임베딩 로드 실패 — 룰베이스만으로 동작:', e.message);
    TOPIC_EMBED = null;
}
// (이어서) v2 — 도구 디스크립션 임베딩 워밍업. TOOL_CATALOG 파싱(다음 코드 위치에 정의된
//   문자열)에서 도구명+짧은 설명을 뽑아 백그라운드 임베딩. 실패해도 룰베이스 흐름 유지.
// 실제 워밍업 호출은 TOOL_CATALOG 정의 이후 라인에서 수행(scheduleToolEmbedWarmup).
function scheduleToolEmbedWarmup(catalogText) {
    if (!TOPIC_EMBED || !TOPIC_EMBED.warmupTools) return;
    try {
        const re = /^- ([a-z_]+)\([^)]*\):\s*(.+)$/gm;
        const toolEntries = [];
        let m;
        while ((m = re.exec(catalogText)) !== null) {
            toolEntries.push({ name: m[1], desc: m[2].trim().slice(0, 300) });
        }
        if (toolEntries.length) {
            TOPIC_EMBED.warmupTools(toolEntries).catch(e => console.warn('[TopicEmbed] tool warmup 예외:', e.message));
        }
    } catch (e) { /* 무시 */ }
}


// Gemini 공용 클라이언트 (키 없으면 hasAnyKey()=false → 폴백 경로 사용)
let gemini = null;
try {
    gemini = require('../services/gemini_client');
} catch (e) {
    console.warn('[Assistant] gemini_client 로드 실패 — 폴백 모드로 동작:', e.message);
}
let assistantLog = null;
try { assistantLog = require('../services/assistant_log'); } catch (e) { /* 로그 없이 동작 */ }

// ============================================================================
// 1. 참조 데이터 (해역명 → 단기예보 구역코드)
// ----------------------------------------------------------------------------
// js/forecast.js 의 ZONE_NAME_TO_CODE 와 동일한 매핑. forecast.js 는 브라우저용
// 전역 스크립트라 require 할 수 없어 서버에서 쓰는 표를 여기에 둔다.
// (이 표는 기상청 구역코드 기준 정적 데이터이므로 변경 빈도가 거의 없다.)
// ============================================================================
const ZONE_NAME_TO_CODE = {
    // 제주
    '제주도서부앞바다': '12B10304', '제주도북부앞바다': '12B10302',
    '제주도동부앞바다': '12B10301', '제주도남부앞바다': '12B10303',
    '제주도앞바다': '12B10300', '제주도남쪽먼바다': '12B10400',
    '제주도남서쪽안쪽먼바다': '12B10400', '제주도남동쪽안쪽먼바다': '12B10400',
    '제주도남쪽바깥먼바다': '12B10400',
    // 서해중부
    '인천·경기북부앞바다': '12A20101', '경기북부앞바다': '12A20101',
    '인천·경기남부앞바다': '12A20102', '충남북부앞바다': '12A20103',
    '충남남부앞바다': '12A20104', '서해중부앞바다': '12A20100',
    '서해중부먼바다': '12A20200', '서해중부안쪽먼바다': '12A20200',
    '서해중부바깥먼바다': '12A20200',
    // 서해남부
    '전북북부앞바다': '22A30101', '전북남부앞바다': '22A30102',
    '전남북부서해앞바다': '22A30103', '전남중부서해앞바다': '22A30104',
    '전남남부서해앞바다': '22A30105', '서해남부앞바다': '12A30100',
    '서해남부먼바다': '12A30200', '서해남부북쪽바깥먼바다': '12A30200',
    '서해남부북쪽안쪽먼바다': '12A30200', '서해남부남쪽바깥먼바다': '12A30200',
    '서해남부남쪽안쪽먼바다': '12A30200',
    // 서해북부
    '서해북부앞바다': '12A10100', '서해북부먼바다': '12A10200',
    // 남해서부
    '전남서부남해앞바다': '12B10101', '전남동부남해앞바다': '12B10102',
    '남해서부앞바다': '12B10100', '남해서부먼바다': '12B10200',
    '남해서부서쪽먼바다': '12B10200', '남해서부동쪽먼바다': '12B10200',
    // 남해동부
    '경남서부남해앞바다': '12B20101', '경남중부남해앞바다': '12B20102',
    '부산앞바다': '12B20103', '거제시동부앞바다': '12B20104',
    '남해동부앞바다': '12B20100', '남해동부먼바다': '12B20200',
    '남해동부안쪽먼바다': '12B20200', '남해동부바깥먼바다': '12B20200',
    // 동해남부
    '울산앞바다': '12C10101', '경북남부앞바다': '12C10102',
    '경북북부앞바다': '12C10103', '동해남부앞바다': '12C10100',
    '동해남부먼바다': '12C10200', '동해남부남쪽안쪽먼바다': '12C10200',
    '동해남부남쪽바깥먼바다': '12C10200', '동해남부북쪽안쪽먼바다': '12C10200',
    '동해남부북쪽바깥먼바다': '12C10200',
    // 동해중부
    '강원남부앞바다': '12C20101', '강원중부앞바다': '12C20102',
    '강원북부앞바다': '12C20103', '동해중부앞바다': '12C20100',
    '동해중부먼바다': '12C20200', '동해중부안쪽먼바다': '12C20200',
    '동해중부바깥먼바다': '12C20200',
    // 동해북부
    '동해북부앞바다': '12C30100', '동해북부먼바다': '12C30200'
};

const ZONE_NAMES = Object.keys(ZONE_NAME_TO_CODE);

// 풍향 코드 → 한국어
const WIND_DIR_KO = {
    N: '북', NE: '북동', E: '동', SE: '남동',
    S: '남', SW: '남서', W: '서', NW: '북서',
    NNE: '북북동', ENE: '동북동', ESE: '동남동', SSE: '남남동',
    SSW: '남남서', WSW: '서남서', WNW: '서북서', NNW: '북북서'
};

// numEf(예보 시점 오프셋) → 사람이 읽는 라벨. KMA 단기예보 12시간 간격.
const NUM_EF_LABEL = {
    0: '오늘 낮', 1: '오늘 밤', 2: '내일 오전', 3: '내일 오후',
    4: '모레 오전', 5: '모레 오후', 6: '글피 오전', 7: '글피 오후', 8: '그 이후'
};

// ============================================================================
// 2. 유틸
// ============================================================================

/** 공백/구두점 제거 후 비교용 정규화 */
function normalize(s) {
    return String(s || '').replace(/[\s·.,!?~]/g, '').toLowerCase();
}

/**
 * 질문 문자열에서 해역명을 결정론적으로 추출한다.
 * 정규화된 질문 안에 정규화된 해역명이 통째로 포함되면 후보로 본다.
 * 여러 개 매칭되면 가장 긴(=더 구체적인) 이름을 선택한다.
 * 예: "제주 북부 앞바다" → "제주도북부앞바다" 는 직접 매칭되지 않으므로
 *     '제주도'/'북부'/'앞바다' 토큰 보조 매칭으로 보강한다.
 */
function detectZoneDeterministic(query) {
    const nq = normalize(query);

    // 1차: 해역명 전체가 정규화 질문에 포함되는 경우 (가장 신뢰도 높음)
    let best = null;
    for (const name of ZONE_NAMES) {
        if (nq.includes(normalize(name)) && (!best || name.length > best.length)) {
            best = name;
        }
    }
    if (best) return best;

    // 2차: 토큰 점수 매칭. "제주 북부 바다" 처럼 '도'·'앞'이 빠지거나 띄어쓰기가
    //   달라도 잡아낸다. 지역/방위 토큰(필수)과 거리 토큰(앞/먼바다, 보조)을 분리한다.
    const REGION_DIR_RE = /제주|북부|남부|동부|서부|북쪽|남쪽|동쪽|서쪽|인천|경기|충남|전북|전남|경남|부산|거제|울산|경북|강원|서해|남해|동해|중부/g;
    const regionDirTokens = (name) => name.replace('제주도', '제주').match(REGION_DIR_RE) || [];
    const isFar = (name) => name.includes('먼바다');

    // 질문의 거리 힌트: '먼바다' 언급 시 먼바다 선호, 그 외엔 앞바다(연안) 기본 선호
    const wantFar = nq.includes('먼바다');

    let bestScore = 0;
    let bestIsPreferredDistance = false;
    for (const name of ZONE_NAMES) {
        const toks = regionDirTokens(name);
        if (!toks.length) continue;
        // 지역/방위 토큰이 전부 포함될 때만 후보로 인정
        if (!toks.every(t => nq.includes(t))) continue;

        const preferredDistance = isFar(name) === wantFar; // 거리 힌트와 일치 여부
        // 더 구체적인(토큰 많은) 해역 우선, 동점이면 거리 힌트 일치 우선
        if (toks.length > bestScore ||
            (toks.length === bestScore && preferredDistance && !bestIsPreferredDistance)) {
            bestScore = toks.length;
            bestIsPreferredDistance = preferredDistance;
            best = name;
        }
    }
    if (best) return best;

    // 3차: 역방향 토큰 매칭. nq 에서 지역/방위 토큰을 뽑아, 모두 zone name 에 포함되는
    //   zone 들을 후보로. 짧은 비표준 입력("전남남해") 을 표준 zone("전남동부남해앞바다") 으로
    //   잇기 위함. 최소 2 토큰 조건으로 "전남" 단일 같은 과매칭 방지. 동률은 더 짧은(덜 구체적인)
    //   zone 우선 — 후속 자유도가 큰 default 가 안전.
    const nqTokens = [...new Set(nq.match(REGION_DIR_RE) || [])];
    if (nqTokens.length >= 2) {
        const candidates = [];
        for (const name of ZONE_NAMES) {
            const nName = name.replace('제주도', '제주');
            if (nqTokens.every(t => nName.includes(t))) candidates.push(name);
        }
        if (candidates.length) {
            candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
            return candidates[0];
        }
    }
    return best;
}

/** 질문에서 의도를 키워드로 추정 (AI 미사용/폴백 시) */
function detectIntentDeterministic(query) {
    const nq = normalize(query);
    // "어떤/무슨/뭐가/몇 개 부이가 있냐, 부이 목록" → 부이 목록
    if (/부이|부표/.test(nq) && /어떤|무슨|뭐|몇|있|목록|리스트|어디/.test(nq)) return 'buoy_list';
    if (/특보|주의보|경보|경계|위험/.test(nq)) return 'warning';
    return 'marine_weather';
}

/**
 * general_forecasts.json 의 한 해역(regId) 시계열을 사람이 읽는 요약으로 변환.
 * @returns {null|{ updatedAt, periods: [{label, sky, wind, wave, rain}] }}
 */
function buildForecastSummary(zoneName) {
    const code = ZONE_NAME_TO_CODE[zoneName];
    const all = dataCache.forecasts && dataCache.forecasts.data;
    if (!code || !all) return null;

    // 일부 권역(예: 동해중부앞바다 12C20100)은 'xx00' 집계예보가 발표되지 않고
    // 하위 구역(xx01~xx04)만 존재한다 → 가용한 첫 하위 구역으로 대체한다.
    let useCode = code, subUsed = null;
    if (!all[useCode] || !all[useCode].length) {
        if (/00$/.test(code)) {
            const base = code.slice(0, 6);
            for (const sfx of ['01', '02', '03', '04']) {
                const c = base + sfx;
                if (all[c] && all[c].length) { useCode = c; subUsed = c; break; }
            }
        }
        if (useCode === code) return null;
    }

    const series = all[useCode];
    const periods = series.slice(0, 4).map(e => {
        const d1 = WIND_DIR_KO[e.wd1] || e.wd1 || '';
        const d2 = WIND_DIR_KO[e.wd2] || e.wd2 || '';
        const dir = d1 && d2 && d1 !== d2 ? `${d1}~${d2}풍` : (d1 ? `${d1}풍` : '');
        const ws = (e.ws1 != null && e.ws2 != null) ? `${e.ws1}~${e.ws2}m/s`
            : (e.ws1 != null ? `${e.ws1}m/s` : '');
        const wh = (e.wh1 != null && e.wh2 != null) ? `${e.wh1}~${e.wh2}m`
            : (e.wh1 != null ? `${e.wh1}m` : '');
        return {
            label: NUM_EF_LABEL[e.numEf] || `+${e.numEf}`,
            sky: e.wf || '',
            wind: [dir, ws].filter(Boolean).join(' '),
            wave: wh,
            rain: e.rnYn ? '비/눈 가능' : ''
        };
    });

    const out = { updatedAt: dataCache.forecasts.updatedAt || null, periods };
    if (subUsed) out.note = '이 해역은 집계예보가 발표되지 않아 인접 하위 구역 예보로 대체했습니다.';
    return out;
}

/**
 * weather_alerts.json 의 current 트리를 재귀 탐색해 해당 해역의 특보 상태를 찾는다.
 * 트리 구조: current[권역][앞바다그룹][세부구역] = { current, upcoming, history }
 * @returns {null|{ current, upcoming }}
 */
function findWarning(zoneName) {
    const tree = dataCache.warnings && dataCache.warnings.current;
    if (!tree || typeof tree !== 'object') return null;

    const isLeaf = (n) => n && typeof n === 'object' && ('current' in n || 'upcoming' in n);

    // 서브트리에서 발효 중인 특보(current !== null)와 예비특보를 집계
    const aggregate = (node) => {
        let current = null, upcoming = null;
        const collect = (n) => {
            if (!n || typeof n !== 'object') return;
            if (isLeaf(n)) {
                if (!current && n.current) current = n.current;
                if (!upcoming && n.upcoming) upcoming = n.upcoming;
                return;
            }
            for (const k of Object.keys(n)) collect(n[k]);
        };
        collect(node);
        return { current, upcoming };
    };

    // zoneName 과 일치하는 노드를 찾는다. leaf 면 그대로, 그룹이면 하위를 집계.
    let result = null;
    const walk = (node) => {
        if (result || !node || typeof node !== 'object' || isLeaf(node)) return;
        for (const key of Object.keys(node)) {
            if (key === zoneName) {
                const matched = node[key];
                result = isLeaf(matched)
                    ? { current: matched.current || null, upcoming: matched.upcoming || null }
                    : aggregate(matched);
                return;
            }
            walk(node[key]);
        }
    };
    walk(tree);
    return result;
}

// ============================================================================
// 3. 답변 생성 — 결정론적 폴백 (Gemini 없이도 실데이터 답변)
// ============================================================================
function composeAnswerFallback(zoneName, intent, fc, warn, profile) {
    const brief = profile && typeof profile === 'object'
        && /간단|짧/.test(String(profile.answerStyle || ''));
    const parts = [];

    // 특보: 질문 의도가 특보이거나, 현재 발효 중인 특보가 있으면 항상 먼저 안내
    const wantWarning = intent === 'warning' || intent === 'both';
    if (warn && warn.current) {
        parts.push(`${zoneName}에는 현재 ${warn.current.type || '해상 특보'}가 발효 중입니다.`);
        if (warn.upcoming && warn.upcoming.type) {
            parts.push(`예비특보로 ${warn.upcoming.type}도 예고돼 있습니다.`);
        }
    } else if (wantWarning) {
        if (warn) {
            parts.push(`${zoneName}에는 현재 발효 중인 해상 특보가 없습니다.`);
        } else {
            parts.push(`${zoneName}의 특보 정보를 확인하지 못했습니다.`);
        }
        if (warn && warn.upcoming && warn.upcoming.type) {
            parts.push(`다만 예비특보로 ${warn.upcoming.type}가 예고돼 있습니다.`);
        }
    }

    // 기상전망: 특보만 물어본 게 아니거나, 특보 데이터가 없어 더 줄 정보가 필요할 때
    if (intent !== 'warning' || parts.length === 0) {
        if (fc && fc.periods.length) {
            const p = fc.periods[0];
            const seg = [`${zoneName} ${p.label} 기상은`];
            if (p.sky) seg.push(p.sky + ',');
            if (p.wind) seg.push('바람은 ' + p.wind + ',');
            if (p.wave) seg.push('물결은 ' + p.wave + '로 예상됩니다.');
            parts.push(seg.join(' ').replace(/,\s*$/, '.'));

            const p1 = brief ? null : fc.periods[1];
            if (p1) {
                const seg2 = [`${p1.label}은`];
                if (p1.sky) seg2.push(p1.sky + ',');
                if (p1.wave) seg2.push('물결 ' + p1.wave + '입니다.');
                parts.push(seg2.join(' '));
            }
        } else if (zoneName.includes('먼바다')) {
            // 먼바다는 단기예보(general_forecasts) 제공 구역이 아니다.
            parts.push(`${zoneName}는 단기 기상전망 제공 구역이 아니라서, 중기 해상예보를 참고하셔야 합니다.`);
        } else if (parts.length === 0) {
            parts.push(`${zoneName}의 기상 데이터를 지금은 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.`);
        }
    }

    return parts.join(' ');
}

// ============================================================================
// 4. 답변 생성 — Gemini (실데이터를 근거로 자연스러운 구어체 요약)
// ----------------------------------------------------------------------------
//  profile/memory 는 개인화용 — 휴대폰에 저장된 사용자 프로필과 과거 대화 요약.
//  답변의 "근거 데이터"는 여전히 기상청 실데이터(fc/warn)뿐이며, profile/memory
//  는 말투·관점·기본 해역 같은 맥락에만 쓰도록 프롬프트에서 분리한다.
// ============================================================================
async function composeAnswerAI(zoneName, intent, fc, warn, profile, memory, style) {
    const factPayload = {
        해역: zoneName,
        질문유형: intent,
        기상전망: fc,   // { updatedAt, periods:[...] } or null
        특보: warn      // { current, upcoming } or null
    };

    const personalBlock = buildPersonalContext(profile, memory, style);

    const prompt =
`당신은 한국 어선·항해자를 돕는 해양 기상 개인 비서입니다.
아래 "기상데이터" JSON은 "${zoneName}"의 실제 기상청 데이터입니다. 이 데이터에 있는 값만 근거로 답하세요.
- 데이터에 없는 수치나 사실을 절대 지어내지 마세요. 없으면 "정보가 없습니다"라고 말하세요.
- 음성으로 읽어줄 답변이므로 2~3문장의 자연스러운 구어체로 짧게 답하세요.
- 풍향/풍속/파고 같은 핵심 수치를 우선 전달하세요.
- 표, 마크다운, 이모지는 쓰지 마세요. 순수 문장만 출력하세요.
${personalBlock}
기상데이터:
${JSON.stringify(factPayload, null, 1)}`;

    const result = await gemini.callGemini({
        model: 'gemini-2.5-flash-lite',
        contents: prompt,
        config: { temperature: 0.3 },
        caller: 'Assistant'
    });

    if (result.success && result.text) {
        return result.text.trim();
    }
    // AI 실패 시 폴백 답변으로 안전하게 대체
    return composeAnswerFallback(zoneName, intent, fc, warn, profile);
}

/**
 * 프로필/메모리를 프롬프트에 끼워넣을 개인화 컨텍스트 블록 생성.
 * 없으면 빈 문자열. (개인화는 맥락일 뿐, 기상 수치의 근거가 아님을 명시)
 */
function buildPersonalContext(profile, memory, style, currentQuery = '') {
    const lines = [];
    if (profile && (typeof profile === 'object' ? Object.keys(profile).length : String(profile).trim())) {
        const profileText = typeof profile === 'string' ? profile : JSON.stringify(profile);
        lines.push(`[사용자 프로필] ${profileText}`);
    }
    // [직군 맞춤] 감지된 직군의 중시 주제를 답변 우선순위 힌트로(수치는 수집결과에서만).
    const jk = jikgunDigest(profile);
    if (jk) lines.push(`[사용자 직군] ${jk.name} — 중시 주제: ${jk.interests.slice(0, 8).join(', ')}. 답변 시 이 우선순위를 고려하되, 수치·사실은 반드시 수집결과에서만.`);
    // [§6 #21] 직군별 안전 임계표 주입 — 사용자가 정량 수치를 직접 제시하면(파고/풍속/시정 N미터·km)
    //   도구 결과 없이도 임계표와 즉시 비교해 가부 결론을 답할 수 있게 한다.
    const slug = detectJikgun(profile);
    const tdig = thresholdDigest(slug);
    if (tdig) {
        // [§B 패치 — MOF-4-01 (C6)] 정량 수치 검출 시 임계표를 prompt 상단(첫 lines) 으로 끌어올린다.
        //   기존: 직군 임계표가 jikgunDigest 다음에 push 돼 prompt 내 후순위로 묻힘.
        //   변경: 단위 정량 수치(파고/풍속/시정/수온/파주기 + m·m/s·km·℃·s) 가 질의에 있으면 unshift 로 상단 배치.
        const NUM_UNIT_RE = /(\d+(?:\.\d+)?)\s*(m\/s|미터퍼세크|m|미터|km|킬로|℃|도|s|초)/i;
        const enrichedTdig = `═══ 직군 임계표 (정량 비교 우선) ═══\n${tdig}\n** 규칙: 사용자 질의에 정량 수치(파고/풍속/시정/수온/파주기 + 단위 m·m/s·km·℃·s) 가 하나라도 명시되면 — 단정형("파고 1.5m") 이든 조건형("파고 2m 넘으면") 이든 가설형("풍랑특보 시") 이든 — 그 수치를 위 임계표 및 주의(직군 SOP) 와 비교해 *가부·권고 결론을 한 줄 먼저* 답하세요. 결정 단어(가능/주의/무리/위험/적합/권장/권고/통제/발령/허용/보류) 중 한 단어 이상 반드시 포함. 수집결과가 비어도 임계표만으로 답 가능 — 이때 도구 결과 부재는 결론 뒤에 *현 상태 미확인* 한 줄 부기로만 다루고 "정보가 없습니다" 단독 응답은 금지. 도구 결과가 있으면 결론 뒤에 보조 근거로 첨부. 임계표는 *외부 수치 사실이 아니라 직군 표준 운용 기준*.`;
        // 정량 수치가 명시되면 임계표 + 규칙을 lines 맨 앞으로 (synth prompt 에서 [사용자 프로필] 보다 먼저 보이게).
        // currentQuery 미전달 시 memory 마지막 항목으로 폴백 (호환성).
        const probe = currentQuery || (Array.isArray(memory) && memory.length ? String(memory[memory.length - 1]) : '');
        if (NUM_UNIT_RE.test(probe)) {
            lines.unshift(enrichedTdig);
        } else {
            lines.push(enrichedTdig);
        }
    }
    // [성향 다이제스트] 휴대폰에 누적된 통계 — 자주 묻는 주제/해역·선호 형식·말투
    if (style && typeof style === 'object') {
        const topN = (counts, n) => (counts && typeof counts === 'object')
            ? Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]) : [];
        const parts = [];
        if (style.totalQuestions) parts.push(`누적 질문 ${style.totalQuestions}회`);
        const tz = topN(style.zoneCounts, 3); if (tz.length) parts.push(`자주 보는 해역: ${tz.join(', ')}`);
        const tt = topN(style.topicCounts, 3); if (tt.length) parts.push(`관심 주제: ${tt.join(', ')}`);
        if (style.preferredFormat) parts.push(`선호 답변형식: ${style.preferredFormat}`);
        if (style.styleNote) parts.push(`말투/스타일: ${style.styleNote}`);
        if (parts.length) lines.push(`[사용자 성향] ${parts.join(' · ')}`);
    }
    if (Array.isArray(memory) && memory.length) {
        lines.push(`[최근 대화] ${memory.slice(-5).join(' / ')}`);
    }
    if (!lines.length) return '';
    return `\n아래는 이 사용자에 대한 참고 맥락입니다. 말투·관심사·기본 활동해역·답변 길이 조절에만 활용하고,
기상 수치는 반드시 위 "기상데이터"/"수집결과"에서만 가져오세요. 사용자가 '간단히'를 선호하면 더 짧게 답하세요.
${lines.join('\n')}\n`;
}

/**
 * 프로필에서 기본 활동 해역(특보구역명)을 뽑는다. 질문에 해역이 없을 때 사용.
 * profile.location.zone 이 유효하면 그걸, 아니면 freeText/문자열에서 매칭 시도.
 * @returns {string|null} 유효한 ZONE_NAME 또는 null
 */
function profileDefaultZone(profile) {
    if (!profile) return null;
    if (typeof profile === 'object') {
        const loc = profile.location;
        if (loc && loc.zone && ZONE_NAME_TO_CODE[loc.zone]) return loc.zone;
        const text = (loc && loc.freeText) || profile.locationText || '';
        if (text) {
            const z = detectZoneDeterministic(text);
            if (z) return z;
        }
        return null;
    }
    // 문자열 프로필이면 통째로 매칭 시도
    return detectZoneDeterministic(String(profile));
}

/**
 * Gemini 로 질문에서 { zone, intent } 추출. 실패 시 null 반환(호출자가 폴백).
 */
async function detectWithAI(query) {
    const prompt =
`사용자의 한국어 질문에서 (1) 어떤 해상 구역을 묻는지 (2) 무엇을 묻는지 알아내세요.
구역은 반드시 아래 목록 중 정확히 하나의 문자열로만 답하세요. 목록에 없으면 zone 을 null 로 두세요.

구역 목록:
${ZONE_NAMES.join(', ')}

intent 는 다음 중 하나(질문이 진짜로 무엇을 원하는지 보고 고르세요):
- "marine_weather": 날씨/바람/파고/하늘 등 기상 전망을 물음
- "warning": 특보/주의보/경보 발효 여부를 물음
- "buoy_list": 그 해역에 "어떤/무슨 기상부이가 있는지" 부이 목록을 물음
- "both": 기상+특보 둘 다

질문: "${query}"

JSON 형식으로만 답하세요: {"zone": "<구역명 또는 null>", "intent": "<intent>"}`;

    try {
        const result = await gemini.callGemini({
            model: 'gemini-2.5-flash-lite',
            contents: prompt,
            config: { responseMimeType: 'application/json', temperature: 0 },
            caller: 'Assistant-Intent'
        });
        if (!result.success || !result.text) return null;
        const parsed = JSON.parse(result.text);
        const zone = ZONE_NAME_TO_CODE[parsed.zone] ? parsed.zone : null;
        const intent = ['marine_weather', 'warning', 'both', 'buoy_list'].includes(parsed.intent)
            ? parsed.intent : 'marine_weather';
        return { zone, intent };
    } catch (e) {
        return null;
    }
}

// ============================================================================
// 5. 레이트리밋 (IP당 분당 20회) — 공개 엔드포인트 남용으로 공유 Gemini
//    쿼터/쿨다운이 소진돼 기존 AI 기능(특보 분석·해상전망)이 영향받는 것을 방지.
// ----------------------------------------------------------------------------
//  - 인메모리 고정 윈도우(fixed window). 외부 의존성/파일 I/O 없음 → 기동 안전.
//  - Fly.io 프록시 뒤라 req.ip 가 프록시 IP일 수 있어 X-Forwarded-For 의
//    첫 IP(원 클라이언트)를 우선 사용한다.
// ============================================================================
const RATE_LIMIT_MAX = 20;             // 분당 허용 횟수
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const _rateBuckets = new Map();        // ip → { windowStart, count }

function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return (req.socket && req.socket.remoteAddress) || req.ip || 'unknown';
}

/** @returns {{ allowed: boolean, retryAfterSec: number }} */
function checkRateLimit(ip) {
    const now = Date.now();
    const bucket = _rateBuckets.get(ip);
    if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
        _rateBuckets.set(ip, { windowStart: now, count: 1 });
        return { allowed: true, retryAfterSec: 0 };
    }
    if (bucket.count >= RATE_LIMIT_MAX) {
        const retryAfterSec = Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);
        return { allowed: false, retryAfterSec: Math.max(1, retryAfterSec) };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSec: 0 };
}

// 만료된 버킷 주기적 정리 (메모리 누수 방지). unref() 로 프로세스 종료를 막지 않음.
const _rateCleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of _rateBuckets) {
        if (now - b.windowStart >= RATE_LIMIT_WINDOW_MS) _rateBuckets.delete(ip);
    }
}, 5 * 60 * 1000);
if (_rateCleanup.unref) _rateCleanup.unref();

// ============================================================================
// 6. 라우트
// ============================================================================

router.get('/api/assistant/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        aiAvailable: !!(gemini && gemini.hasAnyKey && gemini.hasAnyKey()),
        dataReady: !!(dataCache.forecasts && dataCache.forecasts.data),
        zoneCount: ZONE_NAMES.length
    });
});

// ============================================================================
// 8. Tool Use 두뇌 (플랜 → 실행 → 종합)
// ----------------------------------------------------------------------------
//  의도를 하드코딩 매칭하지 않고, AI가 질문을 보고 어떤 데이터를 가져올지 "계획"하면
//  서버가 그 도구들을 실행해 실데이터를 모으고, AI가 그 결과만 근거로 답한다.
//  복합 질문("325 해구 60시간 후 조업 가능?")도 여러 도구를 조합해 처리.
//  ⚠️ Gemini 키가 있을 때만 동작. 실패 시 호출자가 기존 결정론적 경로로 폴백.
//  보안: 도구는 공개/사용자 데이터 한정 — 관리자(/api/admin/*) 기능은 절대 미포함.
// ============================================================================
const BRAIN_MODEL = 'gemini-2.5-flash-lite';

const TOOL_CATALOG = `
[예보]
- get_marine_forecast(zone): 명명된 해상예보구역(예: 제주도북부앞바다)의 단기 기상전망(풍향/풍속/파고/하늘).
- get_zone_forecast(zoneId, hoursAhead): 해구번호(예: "325")의 N시간 후 예보(파고/파주기/풍속/풍향)와 그 해구의 경위도. 미래 약 72시간까지. "그 해구 경위도/위도/경도" 같은 후속 질문에도 이걸로 좌표를 답하세요.
- get_midterm_forecast(zone): 해역의 중기(3~10일) 해상예보.
- get_warning(zone): 해당 해역의 특보(주의보/경보) 발효 여부와 종류.
[관측]
- list_buoys_near(zone): 해당 해역 인근 기상부이 목록(이름·거리만).
- get_buoys_with_obs(zone): 해역 인근 기상부이 목록 + 각 부이의 최신 관측값을 한 번에. ("부이 뭐 있고 각각 관측값 줘" 류는 반드시 이걸 쓰세요)
- get_buoy_observation(buoyName): 특정 부이의 최신 실측값(파고/풍속/수온/시정 등).
- get_current(zone 또는 lat,lon): 해역(또는 좌표)의 유향·유속(해류). 해역명만 줘도 됨.
- get_depth(zone 또는 lat,lon): 해역(또는 좌표)의 수심. 해역명만 줘도 됨.
- get_seafog_cctv(harbor): 항구 해무 CCTV 최신 영상(이미지 링크).
- get_visibility(place): 지명/해역의 가장 가까운 시정계 관측소의 시정(가시거리, km). "시정/가시거리/얼마나 잘 보여" 류.
- get_tide(place): 지명/해역의 오늘 고조·저조 시각과 조위(만조/간조/물때 질문은 이걸 쓰세요).
[생활지수]
- get_fishing_index(location): 바다낚시(갯바위/선상) 지수. ※ 스쿠버·다이빙·해루질은 대상 아님.
- get_surfing_index(beach): 서핑 지수(해수욕장별 초/중/상급 등급, 파고·수온). 일반 '물놀이'도 이걸로 참고.
- get_sea_split_index(place): 바다갈라짐=갯벌이 열리는 '모세의 기적' 체험 시간대. ※ 스쿠버/다이빙과 무관.
[위치기반]
- get_nearest_buoy(lat, lon): 좌표(사용자 GPS)에서 가장 가까운 기상부이의 위치 + 최신 관측값.
[비교/집계]
- get_zones_ranked(metric, order, threshold, top, scope): 정렬·필터(집계/비교 "제일·가장·줄세워·N 넘는").
  metric: "wave"(파고)/"wind"(풍속) → 해역 또는 해구 / "temp"(수온)/"vis"(시정) → 관측지점(부이·시정계).
  order:"desc"(높은순,기본)|"asc"(낮은순; 시정 "제일 나빠"는 기본 낮은순), threshold:기준값 이상만, top:개수.
  scope:"zone"(명명 해역, 기본) | "haegu"(해구 번호 격자 — 결과에 해구 번호+경위도). wave/wind 에만 적용.
  예: "풍속 가장 높은 해구"→metric:"wind",scope:"haegu"; "수온 높은 곳 줄세워"→metric:"temp"; "어디 시정 제일 나빠"→metric:"vis".
[기타]
- get_typhoon_status(): 현재 발효 중인 태풍 현황.
- get_app_capabilities(): 이 앱(SEA:GNAL)이 제공하는 기능/정보의 종류와 형태. "이 앱 뭐 할 수 있어 / 어떤 정보 줘 / 무슨 기능 있어" 류 메타 질문에 사용.
- resolve_location(text): 임의 지명을 좌표/주소로 변환(get_current/get_depth/get_tide 의 좌표 확보용).`;

// [Phase 2b PoC v2] TOOL_CATALOG 정의 완료 직후 — 도구 디스크립션 임베딩 워밍업 예약.
//   토픽 워밍업과 동일 백그라운드 흐름. 디스크 캐시 있으면 즉시 로드.
scheduleToolEmbedWarmup(TOOL_CATALOG);

// 앱 기능 안내(메타) — "이 앱 뭐 할 수 있어?"에 답하기 위한 정적 요약.
const APP_CAPABILITIES = {
    이름: 'SEA:GNAL(바다날씨)',
    기능: [
        '해상 기상예보: 해역별 단기(풍향·풍속·파고·하늘), 해구번호별 75시간 시계열, 중기(3~10일)',
        '해상 특보: 해역별 풍랑·강풍 등 주의보/경보 발효 현황',
        '기상부이/관측: 부이별 파고·풍속·수온·시정 실측, 위치에서 가장 가까운 부이',
        '해양종합정보 지도: 유향·유속, 풍향·풍속, 파고·파향, 수심, 기상부이, 해무 CCTV 레이어',
        '조석/물때: 지점별 고조·저조(지도 해점 바텀시트)',
        '태풍: 현재 태풍 현황·경로·예보',
        '생활지수: 바다낚시·서핑·물놀이·스쿠버·갯벌·바다갈라짐 지수',
        '해상일기도: 수치파랑·해일·순환·수온 차트'
    ],
    형태: '음성/텍스트 질문에 답하고, 답변에서 앱의 해당 화면(해양종합정보 레이어/특보/태풍/부이 등)으로 바로가기 버튼 제공'
};

/** 해역명 정규화: 정확명이면 그대로, 아니면 결정론적 매칭 */
function resolveZoneName(name) {
    if (!name) return null;
    if (ZONE_NAME_TO_CODE[name]) return name;
    return detectZoneDeterministic(String(name));
}

/** 좌표 결정: lat/lon 직접 주어지면 그걸, 아니면 해역명→대표좌표(ZONE_COORDS). 없으면 null.
 *  (유속/수심처럼 좌표가 필요한 도구가 카카오 지오코딩 없이도 해역명으로 동작하게 함) */
function coordsFor(zone, lat, lon) {
    if (lat != null && lon != null && isFinite(+lat) && isFinite(+lon)) return { lat: +lat, lon: +lon };
    const z = resolveZoneName(zone);
    const code = z && ZONE_NAME_TO_CODE[z];
    if (code && ZONE_COORDS[code]) return { lat: ZONE_COORDS[code].lat, lon: ZONE_COORDS[code].lon };
    return null;
}

/** 해구번호 N시간 후 예보 (zone_forecasts 시계열에서 가장 가까운 시점) */
function getZoneForecastAt(zoneId, hoursAhead) {
    const all = dataCache.zoneForecasts && dataCache.zoneForecasts.data;
    if (!all || !all[zoneId]) return { error: `해구 ${zoneId} 예보 데이터가 없습니다.` };
    const series = all[zoneId];
    const t = new Date(Date.now() + (hoursAhead || 0) * 3600000);
    const p = (n) => (n < 10 ? '0' : '') + n;
    const target = Number('' + t.getUTCFullYear() + p(t.getUTCMonth() + 1) + p(t.getUTCDate()) + p(t.getUTCHours()));
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < series.length; i++) { const d = Math.abs(Number(series[i].tm) - target); if (d < bestDiff) { bestDiff = d; bestIdx = i; } }
    const best = series[bestIdx];
    // 추세 질문("점점 세져?")용으로 해당 시점부터 다음 5스텝 시계열도 함께 반환
    const trend = series.slice(bestIdx, bestIdx + 5).map(e => ({ tm: e.tm, 파고m: e.wh, 풍속ms: e.ws }));
    const co = HAEGU_COORDS[String(zoneId)];
    return {
        zoneId, hoursAhead: hoursAhead || 0, forecastTimeUTC: best.tm,
        ...(co ? { 위도: co.lat, 경도: co.lon } : {}),
        파고m: best.wh, 파주기s: best.wp, 풍속ms: best.ws, 풍향deg: best.windDir, 파향deg: best.waveDir,
        시계열: trend
    };
}

/** 특정 부이 최신 실측 (marine_buoys/wh/lh 캐시에서 이름 매칭). 부이 종류별 필드명 차이를 흡수. */
function getBuoyObs(name) {
    const norm = normalize(name);
    if (!norm) return { error: '부이 이름이 비었습니다.' };
    const pick = (o, keys) => { for (const k of keys) { if (o[k] != null && o[k] !== '' && o[k] !== -99 && o[k] !== -99.0) return o[k]; } return undefined; };
    const pools = [dataCache.marineBuoys, dataCache.marineWhBuoys, dataCache.marineLhBuoys];
    // 같은 부이가 여러 스냅샷에 나뉘어(파고부이/기상부이 등) 일부 필드만 있을 수 있어,
    // 모든 풀에서 일치 항목을 모아 비어 있는 필드만 채워 합친다.
    const out = { name: null };
    const fields = {
        풍속ms: ['ws', 'wspd', 'wind_speed'], 풍향deg: ['wd', 'wdir', 'wind_dir'],
        파고m: ['wh', 'sig_wh', 'ave_wh', 'max_wh'], 파주기s: ['wp', 'wpd', 'wave_prd'],
        수온C: ['tw', 'wtem', 'water_temp'], 시정: ['vs', 'vis']
    };
    let matched = false;
    for (const pool of pools) {
        const arr = pool && pool.data;
        if (!Array.isArray(arr)) continue;
        const hit = arr.find(b => {
            const kn = normalize(b.kor_nm || b.obs_nm || '');
            return kn && (kn.includes(norm) || norm.includes(kn));
        });
        if (!hit) continue;
        matched = true;
        if (!out.name) out.name = hit.kor_nm || hit.obs_nm;
        for (const f of Object.keys(fields)) {
            if (out[f] == null) { const v = pick(hit, fields[f]); if (v !== undefined) out[f] = v; }
        }
    }
    if (!matched) return { error: `'${name}' 부이의 최신 관측값을 찾지 못했습니다.` };
    Object.keys(out).forEach(k => { if (out[k] == null) delete out[k]; });
    return out;
}

/** 시정(가시거리) — 지명/해역의 가장 가까운 시정계 관측소 값. 이름 직접매칭 우선, 없으면 좌표 최근접. */
function getVisibility(place, lat, lon) {
    const list = (dataCache.marineVs && dataCache.marineVs.data) || [];
    if (!Array.isArray(list) || !list.length) return { error: '시정 관측 데이터가 없습니다.' };
    const valid = list.filter(s => s.vs != null && s.vs !== '' && Number(s.vs) >= 0 && s.lat != null && s.lon != null);
    if (place) {
        const nq = normalize(place);
        const hit = nq && valid.find(s => { const kn = normalize(s.kor_nm || s.obs_nm || ''); return kn && (kn.includes(nq) || nq.includes(kn)); });
        if (hit) return { 지점: hit.kor_nm || hit.obs_nm, 시정km: Number(hit.vs), 위도: hit.lat, 경도: hit.lon, 기준시각: hit.obs_tm };
    }
    const co = coordsFor(place, lat, lon);
    if (!co) return { error: `'${place || ''}' 위치의 시정을 찾지 못했습니다.` };
    let best = null, bd = Infinity;
    for (const s of valid) { const d = haversineKm(co.lat, co.lon, s.lat, s.lon); if (d < bd) { bd = d; best = s; } }
    return best ? { 지점: best.kor_nm || best.obs_nm, 시정km: Number(best.vs), 거리km: Math.round(bd), 위도: best.lat, 경도: best.lon, 기준시각: best.obs_tm }
        : { error: '가까운 시정 관측소가 없습니다.' };
}

/** 파고/풍속 기준 정렬·필터 (집계/비교형 질문용).
 *  scope='zone'(기본): 명명된 해역(특보구역) 단기예보 기준.
 *  scope='haegu': 해구(번호 격자) 시계열 기준 — 해구 번호 + 경위도(zone_coords) 동봉. */
function rankZones(metric, order, threshold, top, scope) {
    // 관측 기반 랭킹: 수온(부이 tw)·시정(시정계 vs) — 해역/해구 예보가 아닌 지점 단위.
    if (metric === 'temp' || metric === 'vis') {
        const rows = [];
        if (metric === 'vis') {
            const list = (dataCache.marineVs && dataCache.marineVs.data) || [];
            if (!Array.isArray(list) || !list.length) return { error: '시정 관측 데이터가 없습니다.' };
            for (const s of list) {
                const v = s.vs;
                if (v == null || v === '' || Number(v) < 0 || s.lat == null) continue;
                rows.push({ 지점: s.kor_nm || s.obs_nm || String(s.stn_id), 시정km: Number(v), 위도: s.lat, 경도: s.lon });
            }
            let a = (threshold != null) ? rows.filter(r => r.시정km >= Number(threshold)) : rows;
            a.sort((x, y) => order === 'desc' ? y.시정km - x.시정km : x.시정km - y.시정km); // 기본 오름차순: 나쁜(낮은) 곳 먼저
            return { metric: 'vis', count: a.length, items: a.slice(0, top || 5) };
        }
        const pools = [dataCache.marineBuoys, dataCache.marineWhBuoys, dataCache.marineLhBuoys];
        const seen = {};
        for (const pool of pools) {
            const list = (pool && pool.data) || [];
            if (!Array.isArray(list)) continue;
            for (const b of list) {
                const tw = (b.tw != null && b.tw !== -99 && b.tw !== '') ? b.tw : (b.wtem != null ? b.wtem : null);
                const nm = b.kor_nm || b.obs_nm;
                if (!nm || tw == null || b.lat == null) continue;
                if (seen[nm]) continue; seen[nm] = 1;
                rows.push({ 지점: nm, 수온C: Number(tw), 위도: b.lat, 경도: b.lon });
            }
        }
        if (!rows.length) return { error: '수온 관측 데이터가 없습니다.' };
        let a = (threshold != null) ? rows.filter(r => r.수온C >= Number(threshold)) : rows;
        a.sort((x, y) => order === 'asc' ? x.수온C - y.수온C : y.수온C - x.수온C); // 기본 내림차순: 높은 곳 먼저
        return { metric: 'temp', count: a.length, items: a.slice(0, top || 5) };
    }
    const key = (metric === 'wind') ? 'wind' : 'wave';
    const lbl = key === 'wind' ? '풍속ms' : '파고m';
    if (scope === 'haegu') {
        const all = dataCache.zoneForecasts && dataCache.zoneForecasts.data;
        if (!all) return { error: '해구 예보 데이터가 없습니다.' };
        const p = (n) => (n < 10 ? '0' : '') + n;
        const t = new Date();
        const target = Number('' + t.getUTCFullYear() + p(t.getUTCMonth() + 1) + p(t.getUTCDate()) + p(t.getUTCHours()));
        const rows = [];
        for (const id of Object.keys(all)) {
            const series = all[id];
            if (!Array.isArray(series) || !series.length) continue;
            let b = series[0], bd = Infinity;
            for (const e of series) { const d = Math.abs(Number(e.tm) - target); if (d < bd) { bd = d; b = e; } }
            const val = key === 'wind' ? b.ws : b.wh;
            if (val == null) continue;
            const co = HAEGU_COORDS[String(id)];
            rows.push({ 해구: String(id), [lbl]: val, 위도: co ? co.lat : null, 경도: co ? co.lon : null });
        }
        let arr = rows;
        if (threshold != null) arr = arr.filter(r => Number(r[lbl]) >= Number(threshold));
        arr.sort((a, b) => order === 'asc' ? a[lbl] - b[lbl] : b[lbl] - a[lbl]);
        return { scope: 'haegu', metric: key, count: arr.length, items: arr.slice(0, top || 5) };
    }
    const all = dataCache.forecasts && dataCache.forecasts.data;
    if (!all) return { error: '예보 데이터가 없습니다.' };
    const seen = {}; const rows = [];
    for (const name of Object.keys(ZONE_NAME_TO_CODE)) {
        const code = ZONE_NAME_TO_CODE[name];
        if (seen[code] || !all[code] || !all[code].length) continue;
        seen[code] = 1;
        const e = all[code][0];
        const wave = e.wh2 != null ? e.wh2 : e.wh1;
        const wind = e.ws2 != null ? e.ws2 : e.ws1;
        rows.push({ zone: name, wave, wind });
    }
    let arr = rows.filter(r => r[key] != null);
    if (threshold != null) arr = arr.filter(r => Number(r[key]) >= Number(threshold));
    arr.sort((a, b) => order === 'asc' ? a[key] - b[key] : b[key] - a[key]);
    return { scope: 'zone', metric: key, count: arr.length, items: arr.slice(0, top || 5).map(r => ({ zone: r.zone, [lbl]: r[key] })) };
}

/** 현재 태풍 현황 + 최신 통보문 위치/강도/이동 (data/typhoon.json + bulletin).
 *  주의: 태풍 피드는 DMDW 자격증명이 설정된 서버(운영)에서만 채워진다. 미설정 환경은 빈 값. */
async function getTyphoonStatus() {
    try {
        const fp = path.join(DATA_DIR, 'typhoon.json');
        if (!fs.existsSync(fp)) return { hasActive: false, note: '이 서버에 태풍 피드가 설정되지 않았거나 현재 발효 중인 태풍이 없습니다.' };
        const t = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (!t.hasActive || !(t.typhoons || []).length) return { hasActive: false };
        const out = [];
        for (const ty of t.typhoons) {
            const entry = { name: ty.name, seq: ty.seq };
            const bl = (ty.bulletins || []).find(b => b.isLatest) || (ty.bulletins || [])[0];
            if (bl && bl.code) {
                const yr = ty.yearInt || new Date().getFullYear();
                const b = await internalGet(`/api/typhoon/bulletin?year=${yr}&code=${encodeURIComponent(bl.code)}`);
                const c = b && b.current;
                if (c && c.lat != null) {
                    entry.현재위치 = { 위도: c.lat, 경도: c.lon };
                    entry.중심기압hPa = c.pressure;
                    entry.최대풍속ms = c.windMs;
                    entry.진행방향 = c.dir;
                    entry.이동속도kmh = c.speedKmh;
                    entry.강도 = c.size;
                    entry.강풍반경km = c.radStrong;
                }
            }
            out.push(entry);
        }
        return { hasActive: true, typhoons: out, note: '상세 예상경로는 태풍정보 탭에서 볼 수 있어요' };
    } catch (e) { return { error: '태풍 정보를 읽지 못했습니다.' }; }
}

// 도구 실행기 (모두 공개/사용자 데이터만 — 관리자 기능 없음)
const TOOL_EXEC = {
    get_marine_forecast: async ({ zone } = {}) => {
        const z = resolveZoneName(zone);
        const fc = z ? buildForecastSummary(z) : null;
        return fc ? Object.assign({ zone: z }, fc) : { error: '해당 해역 단기예보가 없습니다.', zone: z };
    },
    get_zone_forecast: async ({ zoneId, hoursAhead } = {}) => getZoneForecastAt(String(zoneId || ''), Number(hoursAhead) || 0),
    get_warning: async ({ zone } = {}) => {
        // [패치 A — C3] zone 미지정 또는 "전국"/"전 해역" → 전국 발효 특보 트리 집계 반환.
        //   ★ 응답 키 호환성: zone 있는 호출은 기존 {zone, warning:{}} 그대로,
        //     zone 비는 호출은 {zone:'전국', activeCount:N, warnings:[…], warning:null}.
        //     기존 `warning` 키도 null 로 포함해 합성/소비자 호환 유지.
        if (!zone || /^전국$|^전\s*해역$/.test(String(zone).trim())) {
            const tree = (dataCache.warnings && dataCache.warnings.current) || null;
            if (!tree) return { zone: '전국', activeCount: 0, warnings: [], warning: null, note: '특보 데이터를 불러오지 못했습니다.' };
            const active = [];
            const walk = (node, pathArr) => {
                if (!node || typeof node !== 'object') return;
                if ('current' in node || 'upcoming' in node) {
                    if (node.current) active.push({
                        zone: pathArr[pathArr.length - 1] || null,
                        type: node.current.type || '해상 특보',
                        detail: node.current
                    });
                    return;
                }
                for (const k of Object.keys(node)) walk(node[k], pathArr.concat(k));
            };
            walk(tree, []);
            return { zone: '전국', activeCount: active.length, warnings: active.slice(0, 12), warning: null };
        }
        const z = resolveZoneName(zone);
        return { zone: z, warning: z ? findWarning(z) : null };
    },
    list_buoys_near: async ({ zone } = {}) => {
        const z = resolveZoneName(zone);
        const b = z ? findBuoysNearZone(z, 5, 120) : [];
        return { zone: z, buoys: b.map(x => ({ name: x.name, distKm: Math.round(x.distKm), type: x.type })) };
    },
    get_buoy_observation: async ({ buoyName } = {}) => getBuoyObs(buoyName),
    get_visibility: async ({ place, zone, lat, lon } = {}) => getVisibility(place || zone, lat, lon),
    get_buoys_with_obs: async ({ zone, lat, lon } = {}) => {
        let buoys = [];
        if (zone) { const z = resolveZoneName(zone); buoys = z ? findBuoysNearZone(z, 5, 120) : []; }
        else if (lat != null && lon != null) { buoys = findNearestBuoys(+lat, +lon, 5); }
        if (!buoys.length) return { error: '인근 기상부이를 찾지 못했습니다.' };
        return {
            zone: zone ? resolveZoneName(zone) : null,
            buoys: buoys.map(b => ({ name: b.name, distKm: Math.round(b.distKm), type: b.type === 'C' ? '파고부이' : '기상부이', observation: getBuoyObs(b.name) }))
        };
    },
    get_tide: async ({ place, lat, lon } = {}) => {
        let pt = null;
        if (lat != null && lon != null) pt = { lat: +lat, lon: +lon, name: place || '해당 지점' };
        else { const z = resolveZoneName(place); pt = resolveTidePoint(place || '', z, null); }
        if (!pt) return { error: '해점을 찾지 못했습니다.' };
        const times = await fetchTideTimes(pt.lat, pt.lon);
        if (times) return Object.assign({ place: pt.name, lat: pt.lat, lon: pt.lon }, times);
        return { place: pt.name, lat: pt.lat, lon: pt.lon, note: '고조/저조 시각은 앱 바텀시트에서 확인하세요' };
    },
    get_typhoon_status: async () => getTyphoonStatus(),
    get_zones_ranked: async ({ metric, order, threshold, top, scope } = {}) => rankZones(metric, order, threshold, top, scope),
    get_app_capabilities: async () => APP_CAPABILITIES,

    get_midterm_forecast: async ({ zone } = {}) => {
        const z = resolveZoneName(zone);
        const code = z && ZONE_NAME_TO_CODE[z];
        if (!code) return { error: '해역을 인식하지 못했습니다.' };
        const regId = code.slice(0, 4) + '0000';   // 중기 권역코드 파생 (예: 12B10302 → 12B10000)
        const d = dataCache.midTermSeaForecasts && dataCache.midTermSeaForecasts.data;
        const e = d && d[regId];
        return e ? { zone: z, regId, updatedAt: dataCache.midTermSeaForecasts.updatedAt, forecast: e } : { error: '중기예보 데이터가 없습니다.', regId };
    },
    get_fishing_index: async ({ location } = {}) => {
        const fi = dataCache.fishingIndex;
        if (!fi || fi.error) return { error: '바다낚시 지수가 아직 준비되지 않았습니다.' };
        const norm = normalize(location || '');
        const out = [];
        for (const grp of ['갯바위', '선상']) {
            const g = fi[grp]; if (!g) continue;
            for (const name of Object.keys(g)) {
                if (!norm || normalize(name).includes(norm)) {
                    const loc = g[name];
                    const dates = loc.forecasts ? Object.keys(loc.forecasts) : [];
                    const f = dates.length ? loc.forecasts[dates[0]] : null;
                    out.push({ group: grp, name, date: dates[0], 오전: f && f['오전'] && f['오전'].totalIndex, 오후: f && f['오후'] && f['오후'].totalIndex });
                }
            }
        }
        return out.length ? { updatedAt: fi.updatedAt, points: out.slice(0, 8) } : { error: '해당 지점의 낚시지수를 찾지 못했습니다.' };
    },
    get_surfing_index: async ({ beach } = {}) => {
        const si = dataCache.surfingIndex; const B = si && si.beaches;
        if (!B) return { error: '서핑 지수가 아직 준비되지 않았습니다.' };
        const norm = normalize(beach || '');
        const out = [];
        for (const name of Object.keys(B)) {
            if (!norm || normalize(name).includes(norm)) {
                const b = B[name];
                const dates = b.forecasts ? Object.keys(b.forecasts) : [];
                const f = dates.length ? b.forecasts[dates[0]] : null;
                const am = f && f['오전'];
                out.push({ name, date: dates[0], 등급: am && am.grades, 파고m: am && am.avgWvhgt, 풍속ms: am && am.avgWspd, 수온C: am && am.avgWtem });
            }
        }
        return out.length ? { updatedAt: si.updatedAt, spots: out.slice(0, 8) } : { error: '해당 해수욕장의 서핑지수를 찾지 못했습니다.' };
    },
    get_sea_split_index: async ({ place } = {}) => {
        const ss = dataCache.seaSplitIndex; const P = ss && ss.places;
        if (!P) return { error: '바다갈라짐 지수가 아직 준비되지 않았습니다.' };
        if (!place) return { updatedAt: ss.updatedAt, places: ss.allPlaces || Object.keys(P) };
        const norm = normalize(place);
        for (const name of Object.keys(P)) {
            if (normalize(name).includes(norm)) {
                const p = P[name];
                const dates = p.forecasts ? Object.keys(p.forecasts) : [];
                return { name, date: dates[0], windows: dates.length ? p.forecasts[dates[0]] : [] };
            }
        }
        return { error: '해당 지점의 바다갈라짐 정보를 찾지 못했습니다.', places: ss.allPlaces };
    },
    get_seafog_cctv: async ({ harbor } = {}) => {
        const j = await internalGet('/api/seafog-cctv?obs=' + encodeURIComponent(harbor || ''));
        if (Array.isArray(j) && j.length) { const x = j[0]; return { harbor: x.sfogObsvtrNm, time: x.imgDt, imageUrl: x.uri }; }
        return { error: '해무 CCTV 이미지를 찾지 못했습니다.' };
    },
    get_current: async ({ zone, lat, lon, date } = {}) => {
        const c = coordsFor(zone, lat, lon);
        if (!c) return { error: '좌표를 알 수 없습니다(해역명 또는 lat,lon 필요).' };
        const d = date || (() => { const t = new Date(); const p = n => (n < 10 ? '0' : '') + n; return '' + t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()); })();
        const r = await internalGet(`/api/ocean/khoa-stream-nearest?lat=${c.lat}&lon=${c.lon}&date=${d}`);
        if (!r || r.success === false || r.crsp == null) return { zone: zone || null, error: '유속 데이터를 가져오지 못했습니다.' };
        // KHOA 유속(crsp)은 cm/s. 노트로도 환산 제공(초속 미터 아님).
        return {
            zone: zone || null,
            유향deg: r.crdir,
            유속cms: r.crsp,
            유속노트: Math.round(Number(r.crsp) * 0.01944 * 10) / 10,
            수온C: r.wtem
        };
    },
    get_depth: async ({ zone, lat, lon } = {}) => {
        const c = coordsFor(zone, lat, lon);
        if (!c) return { error: '좌표를 알 수 없습니다(해역명 또는 lat,lon 필요).' };
        const r = await internalGet(`/api/ocean/depth?lat=${c.lat}&lon=${c.lon}`);
        return Object.assign({ zone: zone || null }, r || {});
    },
    resolve_location: async ({ text } = {}) => {
        const j = await internalGet('/api/search-place?q=' + encodeURIComponent(text || ''));
        const docs = j && j.documents;
        if (Array.isArray(docs) && docs.length) { const r = docs[0]; return { name: r.place_name, address: r.address_name, lat: +r.y, lon: +r.x }; }
        return { error: '장소를 찾지 못했습니다(검색 키 미설정일 수 있음).' };
    },
    get_nearest_buoy: async ({ lat, lon } = {}) => {
        if (lat == null || lon == null) return { error: '좌표(lat,lon)가 필요합니다(GPS).' };
        const near = findNearestBuoys(+lat, +lon, 3);
        if (!near.length) return { error: '인근 부이를 찾지 못했습니다.' };
        const top = near[0];
        return {
            nearest: { name: top.name, distKm: Math.round(top.distKm), lat: top.lat, lon: top.lon, type: top.type },
            observation: getBuoyObs(top.name),
            others: near.slice(1).map(b => ({ name: b.name, distKm: Math.round(b.distKm) }))
        };
    }
};

/** 1단계: 질문 → 가져올 데이터 계획(JSON) */
/** 직전 턴의 도구 결과에서 "주목 대상(focus)"을 구조화 추출 — 해역/해구/부이/좌표/랭킹.
 *  자유텍스트 memory로는 유실되는 해구 번호·좌표를 구조로 보존해 후속 질문 연속성을 보장한다. */
function deriveFocus(plan, results, zoneName, query) {
    const focus = { zone: zoneName || (plan && plan.zone) || null, haegu: null, buoy: null, coords: null, rankedItems: null, lastTools: (results || []).map(r => r.tool) };
    for (const r of (results || [])) {
        const v = r && r.result;
        if (!v || typeof v !== 'object' || v.error) continue;
        if (v.zoneId) focus.haegu = String(v.zoneId);
        if (focus.coords == null && v['위도'] != null && v['경도'] != null) focus.coords = { lat: v['위도'], lon: v['경도'] };
        if (v.name && r.tool === 'get_buoy_observation') {
            focus.buoy = v.name;
            // [패치 A — C2] 후속 zone/좌표 기반 도구(get_current/get_depth/get_visibility 등) 폴백을 위해
            //   부이 좌표를 함께 보존. BUOY_BY_ID 에서 정확/양방향 매칭.
            if (focus.coords == null) {
                const co = buoyToCoords(v.name);
                if (co) focus.coords = co;
            }
        }
        if (v.nearest && v.nearest.name) {
            focus.buoy = v.nearest.name;
            if (focus.coords == null && v.nearest.lat != null && v.nearest.lon != null) {
                focus.coords = { lat: v.nearest.lat, lon: v.nearest.lon };
            }
        }
        if (Array.isArray(v.items) && v.items.length) {
            focus.rankedItems = v.items.slice(0, 5);
            const top = v.items[0];
            if (top['해구'] && !focus.haegu) focus.haegu = String(top['해구']);
            if (top.zone && !focus.zone) focus.zone = top.zone;          // 명명 해역 랭킹 1위
            if (focus.coords == null && top['위도'] != null && top['경도'] != null) focus.coords = { lat: top['위도'], lon: top['경도'] };
        }
    }
    // [결함 1 — focus 전파 강화] zone 이 비면 query 에서 fuzzy 보강(detectZoneDeterministic).
    //   결함 분석에서 후속 턴이 focus 못 받아 엉뚱한 해역 추천한 케이스(angler Q5 등) 직타.
    if (!focus.zone && typeof query === 'string') {
        const z = detectZoneDeterministic(query);
        if (z) focus.zone = z;
    }
    return (focus.zone || focus.haegu || focus.buoy || focus.coords || focus.rankedItems) ? focus : null;
}

async function planQuery(query, profile, location, memory, focus) {
    const locLine = (location && location.lat != null && location.lon != null)
        ? `\n사용자 현재 위치(GPS): 위도 ${location.lat}, 경도 ${location.lon}. "내 위치/가까운/근처" 류 질문엔 이 좌표를 좌표기반 도구(get_nearest_buoy/get_current/get_depth/get_tide)에 넣으세요.`
        : '';
    const pz = profileDefaultZone(profile);
    const pzLine = pz ? `\n사용자 기본 활동해역: ${pz}. 질문에 해역/지명이 없으면 이 해역을 기본으로 쓰세요.` : '';
    // [후속 질문 맥락] "그럼/다른/얘/거기/인근/그건" 등 지시어는 직전 대화로 대상을 정한다.
    const memLine = (Array.isArray(memory) && memory.length)
        ? `\n[최근 대화] ${memory.slice(-3).join(' / ')}\n질문이 "그럼/다른/얘/거기/그건/그게/저거/방금/그 해구/그 해역/인근/위에서/아까" 등으로 이전 맥락을 가리키면, 위 최근 대화에서 대상(해역명·해구 번호·지명·좌표)을 그대로 이어받아 args 에 넣으세요. 특히 직전 답변에 해구 번호가 있었고 "몇 해구/경위도/위도/경도"를 물으면, 그 해구 번호로 get_zone_forecast(zoneId) 를 호출해 좌표를 답하세요.`
        : '';
    // [직전 확정 대상 — 구조화 연속성] 자유텍스트보다 우선. 지시어 후속을 결정론적으로 해소.
    const focusLine = (focus && (focus.zone || focus.haegu || focus.buoy || focus.coords)) ?
`\n[직전 확정 대상] ${[
    focus.zone ? '해역=' + focus.zone : null,
    focus.haegu ? '해구=' + focus.haegu + '번' : null,
    focus.buoy ? '부이/지점=' + focus.buoy : null,
    focus.coords ? ('좌표=' + focus.coords.lat + ',' + focus.coords.lon) : null,
    (focus.rankedItems && focus.rankedItems.length) ? ('직전 랭킹 상위=' + focus.rankedItems.slice(0, 3).map(it => it['해구'] || it['지점'] || it.zone).filter(Boolean).join('/')) : null
].filter(Boolean).join(' · ')}
질문이 "그게/그 해구/그 해역/거기/방금/그건/위에서/그 중" 등으로 대상을 가리키면 위 [직전 확정 대상]을 그대로 args 에 쓰세요(해구 경위도·예보는 get_zone_forecast(zoneId=해구번호), 좌표기반은 lat/lon).` : '';
    // [음성인식 보정] 질문은 음성→텍스트라 오인식이 잦다. 우리 도메인 용어로 교정한다.
    const vocabLine =
`\n[음성인식 보정 — 중요]
질문은 음성인식 결과라 우리 도메인 용어가 잘못 들어올 수 있습니다(예: "제육볶음 6호 태풍"→"제6호 태풍", "제주국방/난방"→"제주 남방", "해구 삼백이십오"→"325 해구"). 아래 용어를 참고해, 명백한 오인식만 보수적으로 교정해 correctedQuery 에 넣고(의미 바꾸지 말 것), steps 도 교정된 의미로 계획하세요. 오인식이 없으면 correctedQuery 는 원문 그대로.
- 해역명: ${ZONE_NAMES.join(', ')}
- 부이/지명: 거문도, 오륙도, 마라도, 추자도, 울릉도, 서귀포, 신안, 가거도 등
- 호출어: 나리야`;
    // [직군 맞춤] 프로필 직군이 감지되면, 그 직군이 중시하는 주제(도구 선택 우선순위)와
    //   직군 용어(STT 보정 참고)를 알려준다. 수치/사실은 여전히 도구 결과에서만.
    const jk = jikgunDigest(profile);
    const jikgunLine = jk
        ? `\n[사용자 직군: ${jk.name}] 질문이 모호하면 이 직군의 우선 관심사를 우선 고려하고, 아래 "관심사→권장도구" 매핑대로 도구를 고르세요(수치·사실은 도구 결과에서만):\n`
          + ((jk.topicTools && jk.topicTools.length)
                ? jk.topicTools.join('; ')
                : jk.interests.slice(0, 10).join(', '))
          + (jk.vocab && jk.vocab.length ? `\n직군 용어(STT 보정 참고): ${jk.vocab.slice(0, 12).map(v => v[0] + '=' + v[1]).join('; ')}` : '')
        : '';
    const catalogLine = CATALOG_DIGEST ? ('\n' + CATALOG_DIGEST + '\n') : '';
    // [Phase 2b PoC] 의미 임베딩으로 질의와 가까운 관심사 상위 5개 + 도구. 룰베이스가
    //   놓치는 우회표현("관내 특보", "양양 어때")을 보완. 800ms 타임아웃·실패 시 빈 문자열.
    let simLine = '';
    if (TOPIC_EMBED && TOPIC_EMBED.isReady && TOPIC_EMBED.isReady()) {
        try {
            const top = await Promise.race([
                TOPIC_EMBED.nearestTopics(query, 5, 0.6),
                new Promise(resolve => setTimeout(() => resolve([]), 800))
            ]);
            if (Array.isArray(top) && top.length) {
                const lines = top.map(t => `- ${t.label}${(t.tools && t.tools.length) ? ' → ' + [...new Set(t.tools)].join('/') : ''} (sim ${t.score.toFixed(2)})`);
                simLine = `\n[유사 관심사(의미 임베딩, 상위 ${top.length}) — 룰베이스가 놓친 우회표현일 때 도구 후보로]:\n${lines.join('\n')}\n`;
            }
        } catch (e) { /* 폴백 — simLine 비움 */ }
    }
    // [v2] 도구 디스크립션 임베딩 — 질의와 의미적으로 가까운 도구 직접 매칭(상위 4).
    //   토픽 임베딩이 못 잡는 패턴(도구 자체에 핵심 키워드가 있음)을 보완.
    let toolSimLine = '';
    if (TOPIC_EMBED && TOPIC_EMBED.toolsReady && TOPIC_EMBED.toolsReady()) {
        try {
            const topTools = await Promise.race([
                TOPIC_EMBED.nearestTools(query, 4, 0.55),
                new Promise(resolve => setTimeout(() => resolve([]), 600))
            ]);
            if (Array.isArray(topTools) && topTools.length) {
                toolSimLine = `\n[질의에 가까운 도구 후보(의미 임베딩, 상위 ${topTools.length})] ${topTools.map(t => `${t.name}(${t.score.toFixed(2)})`).join(', ')}\n`;
            }
        } catch (e) { /* 폴백 */ }
    }
    const prompt =
`사용자의 한국어 질문에 답하기 위해 어떤 데이터를 가져올지 계획하세요.
사용 가능한 도구:
${TOOL_CATALOG}
${catalogLine}
규칙:
- 답에 꼭 필요한 도구만 steps 에 넣으세요(불필요한 호출 금지).
- 해역명/해구번호/지명/부이명을 args 에 정확히 넣으세요. 해구번호는 숫자 문자열(예: "325").
- 유속/유향/해류는 get_current(zone=해역명), 수심은 get_depth(zone=해역명)로 호출하세요.
  해역명이 분명하면 resolve_location 을 쓰지 말고 zone 인자에 해역명을 그대로 넣으세요.
  resolve_location 은 항/해수욕장/마을 같은 임의 지명일 때만 쓰세요.
- 섬·항·해안 지명(예: 추자도, 거문도, 마라도, 연평도)의 바다 상황·기상을 물으면, 웹검색 말고 먼저
  get_buoy_observation(지명) 또는 get_nearest_buoy 로 해상 관측을, 해역명이면 get_marine_forecast 를 쓰세요.
- "조업 가능?" 같은 판단 질문은 관련 예보(해구/해역)·특보·필요시 부이를 함께 모으세요.
- "어느/가장 ~한 해구"처럼 해구를 비교·랭킹하면 get_zones_ranked(scope:"haegu") 로 — 답에 해구 번호와 경위도가 나오게. "해역"으로 물으면 scope 생략.
- 시정/가시거리는 get_visibility(지명) 로. 수온·시정을 "줄세워/제일 높은·낮은"으로 비교하면 get_zones_ranked(metric:"temp"/"vis").
- 생활지수: 낚시→get_fishing_index, 서핑/물놀이→get_surfing_index, 갯벌/바다갈라짐→get_sea_split_index.
  스쿠버·다이빙처럼 전용 지수가 없는 활동은 위 지수에 억지로 맞추지 말고 steps 를 비워(웹검색 폴백) 두세요.
- 관리자/설정/키 같은 건 도구가 없으니 무시하세요.
- **(중요) 한국 해상·기상 도메인 질의(특보·예보·파고·풍속·시정·부이·조석·유속·수심·태풍·해구·해역·낚시·서핑·관측·수온 등)는 반드시 위 도구로 처리하세요.** 위치가 모호해도(예: "오늘 특보", "관내 어때", "전국 상황") web_search 폴백을 노리고 steps 를 비우지 말고, 가장 그럴듯한 도구를 하나라도 호출하세요(예: 위치 없는 특보 → get_warning(zone="전국") 또는 zone 생략, "오늘 연안" → get_marine_forecast(zone="서해남부") 같은 기본 해역). 결과가 비어 있으면 합성 단계가 "현재 ~ 없음" 으로 자연스럽게 보고합니다.
- **(다중 도구 패턴)** 직군이 어업·해양경찰·해군·지자체·공공기관·해양수산부 같은 종합 모니터링 직군이고 질의가 "어때/상황/괜찮을까/어떻게 됐어/전반/전체/관내" 같이 종합적이면, get_marine_forecast + get_warning 을 **함께** 호출하세요. 해양수산부·공공기관 등 정책·중기 관심 직군은 추가로 get_midterm_forecast 도. 출항/조업 판단 질의는 추가로 get_tide·get_current 도 함께. 답할 자료가 비더라도 호출은 같이 — 합성이 데이터별로 "있음/없음" 을 명확히 보고합니다.
- **(직군 floor 보강 — marine_leisure/local_gov)**
  · **레저스포츠(marine_leisure)** 직군 + 해수욕장·해변명(양양/송정/낙산/해운대/협재/이호테우/광안리/대천/안목/속초 등) 질의는 무조건 **get_surfing_index(beach=이름) 먼저 호출**. 그 다음 보조로 get_marine_forecast. 해변명을 detectZoneDeterministic 으로 zone 변환하려 하지 마세요 — surfing_index 가 위치 자체 처리.
  · **지방자치단체(local_gov)** 직군 + "관내/우리시/시청 관할/관할 해역" 같은 모호 지명은 사용자 GPS 좌표(있으면) 또는 활동 default 해역으로 도구 호출. 둘 다 없으면 get_warning(zone="전국") 으로 전국 특보 요약하세요. "관내" 를 그대로 zone 인자에 넣지 마세요.${locLine}${pzLine}${focusLine}${memLine}${jikgunLine}${vocabLine}${simLine}${toolSimLine}

사용자 프로필(참고): ${profile ? JSON.stringify(profile).slice(0, 500) : '없음'}
질문: "${query}"

JSON 으로만: {"correctedQuery":"<교정된 질문 또는 원문>", "steps":[{"tool":"<도구명>","args":{...}}], "zone":"<관련 해역명 또는 null>"}`;
    const r = await gemini.callGemini({
        model: BRAIN_MODEL, contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0 }, caller: 'Assistant-Plan'
    });
    if (!r.success || !r.text) return null;
    try { const p = JSON.parse(r.text); if (!Array.isArray(p.steps)) return null; return p; } catch (e) { return null; }
}

/** 2~3단계: 계획 실행 + 실데이터로 답변 종합 */
/** 웹검색 폴백 — 내부 데이터로 못 답할 때 Gemini 구글검색 그라운딩으로 답+출처. */
async function webSearchAnswer(query) {
    try {
        const r = await gemini.callGeminiRaw({
            model: 'gemini-2.5-flash',   // 검색 그라운딩 지원 모델
            contents: query + '\n\n한국어로 간결하게, 음성으로 읽을 수 있게 표/마크다운 없이 핵심만 답하세요. 모르면 모른다고 하세요.',
            config: { tools: [{ googleSearch: {} }], temperature: 0.3 },
            caller: 'Assistant-Web'
        });
        if (!r.success || !r.response) return null;
        let text = '';
        try { text = r.response.text || ''; } catch (e) { text = ''; }
        if (!text.trim()) return null;
        // 음성용: 마크다운 기호 제거(불릿/굵게/헤더 등)
        text = text.replace(/\*\*|\*|`|#+\s?|^\s*[-•]\s?/gm, '').replace(/\n{2,}/g, '\n').trim();
        // 출처 링크 추출 (groundingMetadata.groundingChunks[].web)
        const gm = (((r.response.candidates || [])[0] || {}).groundingMetadata) || {};
        const chunks = gm.groundingChunks || [];
        const webLinks = chunks
            .map(c => c.web ? { title: c.web.title || c.web.uri, uri: c.web.uri } : null)
            .filter(Boolean).slice(0, 3);
        return { answer: text.trim(), webLinks };
    } catch (e) { return null; }
}

/** 의존 위빙 판단: "X 가장 ~한 곳의 Y(조석/유속/수심/특보/해무)" 처럼 1차 결과(focus)가 있어야
 *  2차 도구를 부를 수 있는 질문인지. 좁게 트리거(일반 단일질문은 재계획 안 함). */
function needsReplan(q, results, focus) {
    if (!focus || (!focus.coords && !focus.haegu && !focus.zone)) return false;
    const nq = normalize(q);
    const sup = /(가장|제일|최고|최저|높은|낮은|센|약한|많은|적은|상위|랭킹|줄세|순위)/.test(nq);
    const sec = /(조석|물때|만조|간조|유속|유향|해류|수심|특보|주의보|경보|해무|씨씨티비)/.test(nq);
    if (!(sup && sec)) return false;
    const done = new Set((results || []).map(r => r.tool));
    const secTools = ['get_tide', 'get_current', 'get_depth', 'get_warning', 'get_seafog_cctv'];
    return !secTools.some(t => done.has(t));   // 2차 도구가 이미 실행됐으면 불필요
}

async function runBrain(query, profile, memory, style, location, focus) {
    const plan = await planQuery(query, profile, location, memory, focus);
    if (!plan) return null;
    // 음성인식 보정 결과(있으면) — 종합/웹폴백/표시에 사용할 질문
    const cq = (plan.correctedQuery && typeof plan.correctedQuery === 'string' && plan.correctedQuery.trim())
        ? plan.correctedQuery.trim() : query;
    const corrected = (cq !== query) ? cq : null;

    // [지명 정규화] LLM 이 "전남남해" 처럼 표준 해역명을 살짝 다르게 주면,
    //   detectZoneDeterministic 으로 fuzzy 매칭해 표준명("전남남해앞바다")으로 정정.
    //   tool 호출이 빈 결과를 내고 web_search 폴백으로 빠지는 패턴을 사전 차단한다.
    // [패치 A — C5-pre 공유 상수] §C4(부이 폴백) + §C5(local_gov 강제 호출) + §C5-b(isDomainQuery 보강)가 함께 참조.
    //   함수 상단 1회 선언으로 중복·스코프 충돌 방지(synthesis §1.3 #2).
    const VAGUE_LOCAL_RE = /관내|우리\s*시|시청\s*관할|관할\s*해역|관할\s*구역|우리\s*지역/;
    const MONITOR_JIKGUN = new Set(['local_gov', 'coast_guard', 'navy', 'mof', 'public_org']);
    const OVERVIEW_RE = /어때|상황|전반|전체|괜찮/;
    const _jikgunSlug = detectJikgun(profile);   // 1회 계산 — §C4/§C5/§C5-b 공유
    const canonZone = (z) => {
        if (typeof z !== 'string' || !z.trim()) return z;
        const r = detectZoneDeterministic(z);
        return (r && r !== z) ? r : z;
    };
    // [§6 #22 v2 — focus 후속 전파 도구별 args 정확 주입] 도구마다 zone/place/location/beach 등
    //   인자 이름이 다르다. v3 에서 args.zone 만 채워 일부 도구(get_tide/get_buoy_observation 등)
    //   에 무영향이라 연속 카테고리 -5p 회귀. 도구별 매핑 테이블로 정확히 채운다.
    const PRONOUN_RE = /거기|그곳|그쪽|그\s*해역|그\s*해구|그\s*부이|방금|아까|그건|그게|저거/;
    const isPronounFollowup = PRONOUN_RE.test(cq);
    const focusZone  = focus && focus.zone;
    const focusHaegu = focus && focus.haegu;
    const focusBuoy  = focus && focus.buoy;
    const focusCoords = focus && focus.coords;
    // 도구별 focus.zone 을 받을 args 이름 (앞에 있는 게 우선)
    const FOCUS_ZONE_ARG = {
        get_marine_forecast: 'zone',
        get_warning: 'zone',
        get_midterm_forecast: 'zone',
        list_buoys_near: 'zone',
        get_visibility: 'place',          // place 우선, zone 보조
        get_buoys_with_obs: 'zone',
        get_tide: 'place',
        get_sea_split_index: 'place',
        get_fishing_index: 'location',
        get_surfing_index: 'beach',
        get_current: 'zone',
        get_depth: 'zone',
        get_seafog_cctv: 'harbor',
    };
    const COORD_TOOLS = new Set(['get_current','get_depth','get_tide','get_nearest_buoy','get_visibility','get_buoys_with_obs']);
    for (const step of plan.steps || []) {
        if (!step || !step.args || typeof step.args !== 'object') continue;
        if (step.args.zone) step.args.zone = canonZone(step.args.zone);
        if (!isPronounFollowup) continue;
        // 1) 도구별 zone-인자 주입
        const zoneArg = FOCUS_ZONE_ARG[step.tool];
        if (focusZone && zoneArg && !step.args[zoneArg]) step.args[zoneArg] = focusZone;
        // 2) 해구번호 — get_zone_forecast
        if (focusHaegu && step.tool === 'get_zone_forecast' && !step.args.zoneId) {
            step.args.zoneId = focusHaegu;
        }
        // 3) 부이명 — get_buoy_observation
        if (focusBuoy && step.tool === 'get_buoy_observation' && !step.args.buoyName) {
            step.args.buoyName = focusBuoy;
        }
        // 4) 좌표 — 좌표 받는 도구만, args 비었을 때
        if (focusCoords && COORD_TOOLS.has(step.tool) && step.args.lat == null && step.args.lon == null) {
            step.args.lat = focusCoords.lat;
            step.args.lon = focusCoords.lon;
        }
    }

    // [패치 A — C4 ANG-2-01b 게이트] 후속 부이 follow-up 의 풍속/시정/유속 등 폴백.
    //   focus.buoy 만 있고 focus.zone 이 없는 상태에서 후속이 zone 기반 도구로 라우팅되면
    //   args 가 비어 빈 응답이 된다. 안전한 결정론적 보강:
    //     1) get_buoy_observation 이 plan 에 없으면 강제 1단계 추가 (단일 부이 실측).
    //     2) focus.coords 있으면 get_buoys_with_obs 군집 폴백(단일 부이 ws 결측 대비).
    if (isPronounFollowup && focusBuoy && !focusZone) {
        const wantWind = /풍속|바람|풍향/.test(cq);
        const wantVis  = /시정|가시거리/.test(cq);
        const wantTemp = /수온/.test(cq);
        const wantWave = /파고|물결|파주기/.test(cq);
        const needsBuoyObs = (wantWind || wantVis || wantTemp || wantWave);
        const _buoyPlanTools = new Set(plan.steps.map(s => s.tool));
        if (needsBuoyObs && !_buoyPlanTools.has('get_buoy_observation')) {
            plan.steps.unshift({ tool: 'get_buoy_observation', args: { buoyName: focusBuoy } });
            _buoyPlanTools.add('get_buoy_observation');
        }
        if (needsBuoyObs && focusCoords && !_buoyPlanTools.has('get_buoys_with_obs')) {
            plan.steps.push({ tool: 'get_buoys_with_obs', args: { lat: focusCoords.lat, lon: focusCoords.lon } });
            _buoyPlanTools.add('get_buoys_with_obs');
        }
    }

    // [패치 A — C5 LG-1-01 게이트] local_gov + "관내/우리시…" 모호지명 결정론 보강.
    //   planQuery 의 LLM 규칙(#23)을 LLM 이 무시해 web_search 폴백으로 빠지는 회귀를 직타.
    //   직군이 local_gov 이고 모호어가 있고 GPS·default·focus 어느 것도 잡지 못했으면
    //   get_warning(args={}) 강제 호출(§C3 의 전국 집계 분기 진입).
    const _pz = profileDefaultZone(profile);
    const _hasGPS = !!(location && location.lat != null && location.lon != null);
    const _vagueLocal = VAGUE_LOCAL_RE.test(cq);
    if (_jikgunSlug === 'local_gov' && _vagueLocal && !_hasGPS && !_pz && !focusZone) {
        const _lgPlanTools = new Set(plan.steps.map(s => s.tool));
        if (!_lgPlanTools.has('get_warning')) {
            plan.steps.unshift({ tool: 'get_warning', args: {} });   // zone 비움 → 전국 집계
            _lgPlanTools.add('get_warning');
        }
        if (!_lgPlanTools.has('get_typhoon_status')) {
            plan.steps.push({ tool: 'get_typhoon_status', args: {} });
            _lgPlanTools.add('get_typhoon_status');
        }
    }

    const results = [];
    for (const step of plan.steps.slice(0, 6)) {
        const exec = step && TOOL_EXEC[step.tool];
        if (!exec) continue;
        try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
        catch (e) { results.push({ tool: step.tool, error: e.message }); }
    }

    // [의존 위빙 — 1회 재계획] "X 가장 ~한 곳의 Y" 처럼 1차 결과가 있어야 2차 도구 인자를
    //   채울 수 있는 질문은, 1차 focus를 주입해 한 번 더 계획한다(이미 실행한 도구는 건너뜀).
    const focus1 = deriveFocus(plan, results, plan.zone, cq);
    if (needsReplan(cq, results, focus1)) {
        const plan2 = await planQuery(cq, profile, location, memory, focus1);
        if (plan2 && Array.isArray(plan2.steps)) {
            const done = new Set(results.map(r => r.tool));
            for (const step of plan2.steps.slice(0, 3)) {
                const exec = step && TOOL_EXEC[step.tool];
                if (!exec || done.has(step.tool)) continue;   // 1차에서 한 도구 반복 금지
                done.add(step.tool);
                try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
                catch (e) { results.push({ tool: step.tool, error: e.message }); }
            }
        }
    }

    // [웹검색 폴백] 내부 도구로 "실제 값"을 못 얻었으면(계획이 비었거나 결과가 전부
    //   오류/빈값) 구글 검색 그라운딩으로 답 + 출처 링크. 키 지원 모델에서만 동작.
    const hasRealData = (v) => {
        if (!v || typeof v !== 'object' || v.error) return false;
        return Object.values(v).some(val => {
            if (val == null) return false;
            if (Array.isArray(val)) return val.length > 0;
            if (typeof val === 'object') return Object.keys(val).length > 0;
            if (typeof val === 'string') return val.trim().length > 0;
            return true;
        });
    };
    const gotUseful = results.some(r => hasRealData(r.result));
    // [도메인 가드] 한국 해양·기상 영역 질의는 web_search 폴백 금지.
    //  결과가 비더라도 합성 단계가 "현재 ~ 없음" 또는 "위치를 좀 더 알려주세요" 로 보고하게 둔다.
    //  비도메인 질문(관광·역사·일반상식·인물 등)에만 web_search 가 마지막 수단으로 살아남는다.
    //  도메인 여부는 (a) 도메인 키워드 (b) 알려진 해역명 fuzzy 매칭 (c) 알려진 섬·부이 지명 중 하나라도.
    const DOMAIN_RE = /특보|예보|파고|파주기|풍속|풍향|풍랑|해상|해양|연안|해역|해구|부이|시정|가시거리|조석|만조|간조|물때|유속|유향|해류|수심|태풍|기상|관측|수온|낚시|서핑|어업|조업|항해|바다|섬|항구|항만/;
    const ISLAND_BUOY_RE = /거문도|오륙도|마라도|추자도|울릉도|서귀포|신안|가거도|백령도|연평도|흑산도|위미|독도|덕적|영흥|울진|포항|속초|동해|강릉|삼척|군산|목포|여수|통영|거제|부산|보길도|진도|완도|소청도|대청도|어청도|울도|소흑산도/;
    const isDomainQuery = DOMAIN_RE.test(query) || DOMAIN_RE.test(cq)
        || ISLAND_BUOY_RE.test(query) || ISLAND_BUOY_RE.test(cq)
        || !!detectZoneDeterministic(query) || !!detectZoneDeterministic(cq);
    // [환각 가드 — §6 #16] 도메인 질의인데 도구 호출이 0건이면(빈 steps + 위빙도
    //   추가 못 함) synth 에게 그냥 질문만 넘기면 LLM 일반 지식으로 답을 지어낼 위험.
    //   안전한 메시지로 차단 — 사용자가 다시 시도하거나 위치를 구체화하도록 유도.
    if (isDomainQuery && results.length === 0) {
        return {
            answer: '죄송해요, 지금 그 정보를 가져오지 못했어요. 위치를 좀 더 구체적으로 알려주시면 더 도와드릴 수 있어요.',
            zone: plan.zone || null,
            toolsUsed: [],
            corrected,
            focus: null
        };
    }
    if (!gotUseful && !isDomainQuery) {
        const web = await webSearchAnswer(cq);
        if (web && web.answer) {
            return { answer: web.answer, zone: plan.zone || null, toolsUsed: ['web_search'], webLinks: web.webLinks || [], corrected, focus: deriveFocus(plan, results, plan.zone, cq) };
        }
    }

    const personal = buildPersonalContext(profile, memory, style, cq);
    const synth =
`당신은 한국 어선·항해자를 돕는 해양 기상 개인 비서입니다.
아래 "수집결과"의 실제 데이터에만 근거해, 사용자가 "물어본 것만" 답하세요.
- (환각 금지) 수집결과에 없는 수치/사실은 절대 지어내지 마세요. 일반 지식·추측·웹 정보로 빈칸을 채우지 마세요. 수집결과가 비어 있거나 데이터가 없으면 짧게 "그 정보는 없어요" 또는 "지금은 가져오지 못했어요"라고만 답하세요. 도구가 빈 결과를 돌려주면(예: warnings:[]) "현재 발효 중인 ~ 없습니다"처럼 *없음*을 그대로 보고하세요. **get_warning 응답은 두 형태가 공존합니다 — (1) 특정 해역 호출 시 \`{zone, warning}\` (\`warning\` 이 단일 객체 또는 null), (2) 전국 집계 호출 시 \`{zone:'전국', activeCount:N, warnings:[…]}\` (\`warnings\` 배열, 동시에 \`warning:null\` 이 포함될 수도 있음 — 그때는 \`warnings\` 를 우선). \`warning\` 이 비어있지 않으면(객체) 그 단일 특보를, \`warnings\` 배열이 있으면 N건을(\`activeCount=0\` 또는 \`warnings:[]\` 이면 "전국 풍랑특보 없음"으로) 자연어로 풀어 보고하세요. \`activeCount\` 의 숫자 N 은 *집계 결과 건수*이지 기상 수치(파고·풍속)가 아닙니다 — 결정 임계와 혼동 금지.**
- **(CoT 누수 절대 금지)** 내부 사고 과정·추론 단계·메타 코멘트를 응답에 출력하지 마세요. "내가 생각해 보니/추론 과정/thinking:/sources:/먼저 ~를 확인하고~" 같은 메타 텍스트는 한 글자도 답에 포함 금지. 사용자가 최종 답만 음성으로 듣게 됩니다 — 깔끔한 결론만.
- **(컨텍스트 격리 — 🔒 프라이버시)** 위에 제공된 [최근 대화]/[직전 확정 대상]/[수집 데이터 인벤토리]/memory/focus/personal/profile/jikgun 같은 **입력 블록·라벨 자체를 답에 출력하지 마세요**. 그 안의 사실(직전 해역명·해구·좌표)만 자연어로 풀어쓰세요. "[최근 대화] memory: ..." 같은 prompt 컨텍스트 텍스트가 응답에 노출되면 안 됩니다(다른 사용자 정보 누설 위험).
- **(비기상·비도메인 정보 거절)** 사용자가 우리 도구로 답할 수 없는 정보(산업재해·인구·교통사고·산재 통계 · 법령 제N조·시행령 · 운용규정·매뉴얼·SAR 절차 · 면허·채용·예산·조례 · 해역 경계 좌표 · 어획 통계·정책 5개년·정원·인사 등 비기상 행정·법령·통계·매뉴얼)을 물으면, 수집결과에 web_search 답이 있어도 그 답을 그대로 채택하지 말고 **"그 정보는 우리 자료에 없어요"** 또는 **"기상·해상 정보 외엔 안내가 어려워요"** 로 답하세요. 우리 데이터(기상청·KHOA·해양조사원)는 *현재 기상·해상 관측·예보·특보·태풍·생활지수·조석·유속·수심·시정* 만 다룹니다.
- **(메타·자기요약 질의)** "방금 결정 사유/한 줄 요약/방금 결과 뭐였지/왜 그렇게 판단" 같이 *직전 답을 다시 요약하라*는 질의면, 수집결과 대신 [최근 대화] memory 의 마지막 항목을 1-2줄로 자연어 요약해 답하세요(없으면 "직전 대화 기록이 없어요"). 새 도구 호출 데이터에 의존하지 마세요.
- **(의사결정형 — 정량 판단 강화)** "출항/조업/훈련/작업/타도 돼/가능?·괜찮을까?·해도 돼?·위험?·안전?" 류 안전 판단 질의는 수집결과의 정량 수치(파고·풍속·시정·특보)에 근거해 짧은 한 줄로 가부 결론을 먼저 주세요(예: 파고 ≥2m 또는 풍속 ≥14m/s 또는 풍랑특보 발효면 "무리/주의", 파고 <1m + 풍속 <10m + 특보無면 "가능", 그 사이면 "주의/조건부 가능"). 그 다음 근거 수치 1-2개. 마지막에 "최종 판단은 선장님 몫" 한 번만.
- **(가설·조건문 질의 — 데이터 부재여도 SOP 답)** "만약/~시/~라면/~면 어떡해/~떴을 때/~넘으면/~발효되면" 같이 *가설 조건* 을 전제로 SOP·운용 가부를 묻는 질의는, 그 조건이 *현재 발효 중인지* 와 무관하게 위 [직군 안전 임계표] 및 그 주의(직군 표준 SOP) 에 따라 **조건부 가설답을 먼저 주세요**. 형식: "(조건)이면 (가능/주의/무리/통제/권장 + 임계 수치 근거) 가 표준입니다. 현재는 (실제 상태 한 줄)." 의 2단 구조로 간결히. 결정 단어(가능/주의/무리/위험/적합/권장/권고/발령/통제/허용/보류) 를 반드시 한 단어 이상 포함. "현재 상태 한 줄" 은 get_warning 응답이 \`warning:null\` 이거나 \`warnings:[]\` 비어있으면 "현재 풍랑특보 없음" 으로 양방향 해석. 임계표는 *외부 사실이 아니라 직군 표준 운용 기준* 이므로 환각 금지 규칙과 모순되지 않습니다.
- 사용자가 사실을 단정해도(예: "제6호 태풍이 북상 중인데", "특보 떴잖아") 수집결과와 다르면 수집결과를 따르세요. 예: 태풍 hasActive 가 false 면 "현재 발효 중인 태풍은 없습니다"라고 정정하세요. 사용자의 전제를 그대로 인정하지 마세요.
- 핵심만 간결하게. 사용자가 묻지 않은 일반론·참고사항·주의문구를 덧붙이지 마세요.
- 여러 항목(예: 부이 여러 개)을 물으면 항목마다 이름과 관측 수치를 명확히, 관측 기준시각이 있으면 함께.
- "추세/점점/변화" 질문이면 수집결과의 시계열(시간대별 값)을 보고 늘어나는지·줄어드는지·비슷한지 말하세요.
- 음성으로 읽어줄 구어체. 표/마크다운/이모지 금지. 풍속은 "초속 N미터"로 읽으세요(예: 초속 7미터). "m/s","퍼세크" 같은 표기는 쓰지 마세요.
- 유속(해류)은 cm/s 또는 노트로 말하세요(예: "유속 23cm퍼세크" 말고 "유속 초속 23센티미터, 약 0.4노트"). 유속을 "초속 N미터"로 말하지 마세요.
- "지금 출항/조업해도 되냐"처럼 안전 결정을 직접 물었을 때는: 데이터(파고·풍속·특보)에 근거해 "○○ 정도라 (가능할 것 같다/주의가 필요하다/무리로 보인다)"는 간단한 판단을 먼저 주고, 마지막에 "최종 판단은 선장님 몫"이라는 취지를 딱 한 번 덧붙이세요. 그 외 질문엔 이 판단/문구를 절대 넣지 마세요.
${personal}
질문: "${cq}"
수집결과(JSON): ${JSON.stringify(results)}`;
    const r = await gemini.callGemini({ model: BRAIN_MODEL, contents: synth, config: { temperature: 0.3 }, caller: 'Assistant-Synth' });
    if (!r.success || !r.text) return null;
    // [§6 #24 — 컨텍스트 누수 방어선] synth 가 어겨도 안전하도록 후처리. 라벨 라인만
    //  제거(자연어 답 본문은 손대지 않는다). 사용자가 보는 답에서 prompt 컨텍스트 라벨이
    //  나오지 않게 한다. 🔒 다른 사용자/세션 정보 누설 방지.
    const cleanAnswer = (s) => s
        .split('\n')
        .filter(line => !/^\s*\[(최근 대화|직전 확정 대상|수집 데이터 인벤토리|유사 관심사|질의에 가까운 도구 후보|사용자 직군|관심사 지식|사용자 프로필|개인화)\b/.test(line))
        .filter(line => !/^\s*(memory|focus|personal|profile|jikgun|sources?|thinking|reasoning)\s*[:：]/i.test(line))
        .join('\n')
        .trim();
    return { answer: cleanAnswer(r.text), zone: plan.zone || null, toolsUsed: results.map(x => x.tool), corrected, focus: deriveFocus(plan, results, plan.zone, cq) };
}

router.post('/api/assistant/ask', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    // [레이트리밋] IP당 분당 20회 초과 시 429
    const rate = checkRateLimit(getClientIp(req));
    if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSec));
        return res.status(429).json({
            ok: false,
            error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
            answer: '요청이 너무 많아요. 잠시 후 다시 불러 주세요.',
            retryAfterSec: rate.retryAfterSec
        });
    }

    const query = (req.body && req.body.query ? String(req.body.query) : '').trim();
    // [개인화] 휴대폰에 저장돼 함께 전송된 프로필/메모리 (없으면 무시)
    const profile = (req.body && req.body.profile) || null;
    const memory = (req.body && Array.isArray(req.body.memory)) ? req.body.memory : null;
    const style = (req.body && req.body.style && typeof req.body.style === 'object') ? req.body.style : null;
    // 사용자 GPS 좌표(있을 때만) — "내 위치 가까운 부이" 류 질문에 사용
    const loc = (req.body && req.body.location && req.body.location.lat != null && req.body.location.lon != null)
        ? { lat: +req.body.location.lat, lon: +req.body.location.lon } : null;
    // [구조화 연속성] 클라가 돌려보낸 직전 턴의 주목 대상(해역/해구/부이/좌표) — 후속 해소용
    const focus = (req.body && req.body.focus && typeof req.body.focus === 'object') ? req.body.focus : null;

    if (!query) {
        return res.status(400).json({ ok: false, error: '질문(query)이 비어 있습니다.' });
    }

    // [대화 로그] 이 핸들러의 모든 답변 응답을 테스트 로그에 1회 기록 (res.json 래핑).
    const _json = res.json.bind(res);
    res.json = function (obj) {
        try {
            if (assistantLog && obj && obj.answer) {
                assistantLog.push({
                    query, answer: obj.answer, zone: obj.zone, intent: obj.intent,
                    aiUsed: obj.aiUsed, tools: obj.data && obj.data.toolsUsed
                });
            }
        } catch (e) { /* 무시 */ }
        return _json(obj);
    };

    const aiAvailable = !!(gemini && gemini.hasAnyKey && gemini.hasAnyKey());

    // [Tool Use 두뇌] AI 키가 있으면 먼저 두뇌로 처리(임의·복합 질문 이해 → 도구 실행 → 답변).
    //   실패하면 아래 결정론적 경로로 자동 폴백한다.
    if (aiAvailable) {
        try {
            const brain = await runBrain(query, profile, memory, style, loc, focus);
            if (brain && brain.answer) {
                // 앱 기능 바로가기 + 웹검색 출처 링크(있으면)를 함께
                const links = buildLinks(query, null, brain.zone, profile, loc);
                (brain.webLinks || []).forEach(w => links.push({ type: 'web', label: w.title || '참고 링크', url: w.uri }));
                // 물때 질문인데 표준항/해역/GPS로 해점을 못 잡았으면, 지명을 추출해
                // 프론트가 장소검색→확인→바텀시트로 잇도록 신호(tideSearch). 버튼 보장용.
                let tideSearch = null;
                if (/물때|조석|만조|간조|밀물|썰물|사리|조금|물참|간만/.test(normalize(query)) && !links.some(l => l.type === 'tide')) {
                    const place = extractTidePlace(query);
                    if (place) tideSearch = place;
                }
                return res.json({
                    ok: true, zone: brain.zone, intent: 'brain', answer: brain.answer,
                    data: { toolsUsed: brain.toolsUsed }, aiUsed: true, zoneFromProfile: false,
                    links, tideSearch, corrected: brain.corrected || null, focus: brain.focus || null
                });
            }
        } catch (e) { /* 두뇌 실패 → 결정론적 폴백으로 진행 */ }
    }

    // [위치기반 폴백] GPS 좌표 + "가까운 부이" 류 질문 → 가장 가까운 부이 + 관측값
    if (loc && /부이|부표/.test(normalize(query)) && /가까운|가장|제일|근처|내위치|현재위치|주변/.test(normalize(query))) {
        const near = findNearestBuoys(loc.lat, loc.lon, 3);
        if (near.length) {
            const top = near[0];
            const obs = getBuoyObs(top.name);
            const obsTxt = (obs && !obs.error)
                ? ` 현재 풍속 ${obs['풍속ms'] != null ? obs['풍속ms'] + 'm/s' : '정보없음'}, 파고 ${obs['파고m'] != null ? obs['파고m'] + 'm' : '정보없음'}, 수온 ${obs['수온C'] != null ? obs['수온C'] + '도' : '정보없음'}입니다.`
                : ' 다만 최신 관측값은 지금 불러오지 못했어요.';
            return res.json({
                ok: true, zone: null, intent: 'nearest_buoy',
                answer: `현재 위치에서 가장 가까운 기상부이는 ${top.name}(약 ${Math.round(top.distKm)}km)입니다.${obsTxt}`,
                data: { nearest: { name: top.name, distKm: Math.round(top.distKm) }, observation: obs },
                aiUsed: false, zoneFromProfile: false,
                links: [{ type: 'ocean', layer: 'buoy', buoy: top.id, label: `${top.name} 부이 보기` }], tideSearch: null
            });
        }
    }

    // [1] 해역 + 의도 파악 — AI 우선, 실패/부재 시 결정론적 폴백
    let zone = null;
    let intent = null;
    if (aiAvailable) {
        const ai = await detectWithAI(query);
        if (ai) { zone = ai.zone; intent = ai.intent; }
    }
    if (!zone) zone = detectZoneDeterministic(query);
    if (!intent) intent = detectIntentDeterministic(query);

    // [1-b] 질문에 해역이 없으면 프로필의 기본 활동해역을 사용 (개인화)
    let zoneFromProfile = false;
    if (!zone && profile) {
        const pz = profileDefaultZone(profile);
        if (pz) { zone = pz; zoneFromProfile = true; }
    }

    // 앱 내 기능 연결 버튼(특보/부이/태풍/CCTV 등) — 해역과 무관한 항목(태풍·CCTV)도
    // 있으므로 해역 유무와 별개로 먼저 계산한다.
    const links = buildLinks(query, intent, zone, profile, loc);

    // [물때 — 임의 지점] 물때 질문인데 표준항/해역으로 해점을 못 잡았다면,
    //   질문에서 지명을 추출해 프론트가 장소 검색(카카오) → 확인 → 조석 조회를 하도록 신호.
    let tideSearch = null;
    {
        const nqt = normalize(query);
        if (/물때|조석|만조|간조|밀물|썰물|사리|조금|물참|간만/.test(nqt) && !links.some(l => l.type === 'tide')) {
            const place = extractTidePlace(query);
            if (place) tideSearch = place;
        }
    }

    // [2] 해역을 못 찾은 경우
    if (!zone) {
        // 태풍·CCTV처럼 해역이 필요 없는 바로가기가 있으면, 안내 대신 버튼을 제시
        const answer = tideSearch
            ? `"${tideSearch}" 물때를 찾아볼게요.`
            : (links.length
                ? '말씀하신 정보는 아래 바로가기 버튼에서 바로 확인하실 수 있어요.'
                : '어느 해역을 말씀하시는지 알아듣지 못했어요. 예를 들어 "제주도 북부 앞바다 기상" 처럼 해역 이름을 함께 말씀해 주세요.');
        return res.json({ ok: true, zone: null, intent, answer, data: null, aiUsed: false, links, tideSearch });
    }

    // [3] 실데이터 수집 (메모리 캐시)
    const fc = buildForecastSummary(zone);
    const warn = findWarning(zone);

    // [3-buoy] "이 해역에 어떤 기상부이가 있냐" 류 — 인근 부이 목록으로 답한다.
    if (intent === 'buoy_list') {
        const buoys = findBuoysNearZone(zone, 4, 90);
        const answer = composeBuoyListAnswer(zone, buoys);
        const buoyLinks = buoys.map(b => ({
            type: 'ocean', layer: 'buoy', buoy: b.id, label: `${b.name} 부이 보기`, zone
        }));
        return res.json({
            ok: true, zone, intent, answer,
            data: { buoys: buoys.map(b => ({ id: b.id, name: b.name, type: b.type, distKm: Math.round(b.distKm) })) },
            aiUsed: false, zoneFromProfile, links: buoyLinks, tideSearch: null
        });
    }

    // [4] 답변 생성 — AI 우선, 폴백 보장
    let answer;
    let aiUsed = false;
    if (aiAvailable) {
        answer = await composeAnswerAI(zone, intent, fc, warn, profile, memory, style);
        aiUsed = true;
    } else {
        answer = composeAnswerFallback(zone, intent, fc, warn, profile);
    }

    res.json({
        ok: true,
        zone,
        intent,
        answer,
        data: { forecast: fc, warning: warn },
        aiUsed,
        zoneFromProfile,
        links,       // 앱 내 기능 연결용 (해양종합정보 레이어 바로가기)
        tideSearch   // 임의 지점 물때 검색이 필요하면 추출된 지명(없으면 null)
    });
});

/**
 * 물때 질문에서 지명 후보를 추출 (조석/필러 단어 제거). 2글자 미만이면 null.
 * 예: "정자항 물때 알려줘" → "정자항", "물때 알려줘" → null
 */
function extractTidePlace(query) {
    let s = String(query || '');
    // 조석/필러 '단어'만 제거. 단일 글자 조사(이/가/은/는/의…)는 지명을 손상시키므로
    // 제거하지 않는다(예: "이호테우"의 "이"). Kakao 검색은 조사 붙어도 잘 찾는다.
    s = s.replace(/물때표|물때|조석|만조|간조|밀물|썰물|사리|조금|물참|간만|고조|저조/g, ' ');
    s = s.replace(/알려줘|보여줘|알려주|알려|보여|어때|어떄|어떻게|지금|오늘|내일|모레|시간|조회|확인|해줘|좀/g, ' ');
    s = s.replace(/[?!.,~]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length >= 2 ? s : null;
}

/** 두 좌표 사이 거리(km) — Haversine */
function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 해역 대표좌표 기준으로 가까운 기상부이 목록 반환 (거리 포함) */
function findBuoysNearZone(zoneName, limit, maxKm) {
    const code = ZONE_NAME_TO_CODE[zoneName];
    const center = code && ZONE_COORDS[code];
    if (!center) return [];
    const ranked = BUOY_BY_ID
        .filter(b => isFinite(b.lat) && isFinite(b.lon))
        .map(b => Object.assign({}, b, { distKm: haversineKm(center.lat, center.lon, b.lat, b.lon) }))
        .sort((x, y) => x.distKm - y.distKm);
    const within = ranked.filter(b => b.distKm <= (maxKm || 90));
    return (within.length ? within : ranked).slice(0, limit || 4);
}

/** 좌표(GPS)에서 가장 가까운 기상부이들 (거리 포함) */
function findNearestBuoys(lat, lon, limit) {
    return BUOY_BY_ID
        .filter(b => isFinite(b.lat) && isFinite(b.lon))
        .map(b => Object.assign({}, b, { distKm: haversineKm(lat, lon, b.lat, b.lon) }))
        .sort((a, b) => a.distKm - b.distKm)
        .slice(0, limit || 3);
}

/** 인근 부이 목록을 자연어 답변으로 */
function composeBuoyListAnswer(zoneName, buoys) {
    if (!buoys.length) return `${zoneName} 인근의 기상부이 정보를 찾지 못했어요.`;
    const names = buoys.map(b => `${b.name}(${Math.round(b.distKm)}km${b.type === 'C' ? ', 파고부이' : ''})`).join(', ');
    return `${zoneName}에서 가까운 기상부이는 ${names} 입니다. 아래 버튼을 누르면 해당 부이 관측값을 앱에서 볼 수 있어요.`;
}

/** 질문에서 특정 부이를 가리키면 { id, name } 반환 (없으면 null) */
function findBuoyInQuery(query) {
    const nq = normalize(query);
    // 긴 이름 우선 매칭(예: "서해170" 이 "서해"보다 먼저)
    let best = null;
    for (const b of BUOY_BY_ID) {
        if (b.nname && nq.includes(b.nname) && (!best || b.nname.length > best.nname.length)) best = b;
    }
    return best ? { id: best.id, name: best.name } : null;
}

/**
 * 물때 바텀시트를 띄울 "해점" 좌표를 정한다 — 지명에서 가장 가까운 바다 지점.
 *  우선순위: ① 질문 속 조석 표준항(항만) → 그 좌표
 *            ② 감지된 특보구역 → 해역 대표좌표
 *            ③ 프로필 기본 해역 → 그 해역 대표좌표
 * @returns {null|{ lat, lon, name }}
 */
function resolveTidePoint(query, zone, profile, location) {
    const nq = normalize(query);
    // ① 표준항(지명) 매칭 — 긴 이름 우선
    let st = null;
    for (const s of TIDE_STATIONS) {
        if (s.nname && nq.includes(s.nname) && (!st || s.nname.length > st.nname.length)) st = s;
    }
    if (st) return { lat: st.lat, lon: st.lon, name: st.name };

    // ② 감지된 해역의 대표좌표
    const codeFor = (zn) => (zn && ZONE_NAME_TO_CODE[zn]) ? ZONE_NAME_TO_CODE[zn] : null;
    let code = codeFor(zone);
    if (code && ZONE_COORDS[code]) return { lat: ZONE_COORDS[code].lat, lon: ZONE_COORDS[code].lon, name: zone };

    // ③ GPS 현재 위치 — 표준항/해역을 못 잡았을 때 가장 가까운 해점에서 바텀시트
    if (location && location.lat != null && location.lon != null) {
        return { lat: +location.lat, lon: +location.lon, name: '현재 위치' };
    }

    // ④ 프로필 기본 해역
    const pz = profileDefaultZone(profile);
    code = codeFor(pz);
    if (code && ZONE_COORDS[code]) return { lat: ZONE_COORDS[code].lat, lon: ZONE_COORDS[code].lon, name: pz };

    return null;
}

/**
 * 답변 주제에 맞는 "앱 내 기능 연결" 버튼 목록을 만든다.
 * 종류:
 *   - { type:'ocean', layer }  → 해양종합정보 페이지 + 레이어 활성화
 *   - { type:'tab', target }   → 해당 탭으로 이동 (switchMainTab)
 *   - { type:'tide', lat, lon }→ 해양종합정보 + 그 해점에서 물때 바텀시트
 * @returns {Array<object>}
 */
function buildLinks(query, intent, zone, profile, location) {
    const nq = normalize(query);
    const links = [];
    const addOcean = (layer, label, extra) => {
        if (!links.some(l => l.type === 'ocean' && l.layer === layer)) {
            links.push(Object.assign({ type: 'ocean', layer, label, zone: zone || null }, extra || {}));
        }
    };
    const addTab = (target, label) => {
        if (!links.some(l => l.type === 'tab' && l.target === target)) {
            links.push({ type: 'tab', target, label, zone: zone || null });
        }
    };

    // 물때/조석 — 지명/GPS에서 가장 가까운 해점에서 바텀시트
    if (/물때|조석|만조|간조|간만|밀물|썰물|사리|조금|물참|간물참/.test(nq)) {
        const pt = resolveTidePoint(query, zone, profile, location);
        if (pt) links.push({ type: 'tide', lat: pt.lat, lon: pt.lon, label: `${pt.name} 물때 보기` });
    }

    // 해양종합정보 레이어
    if (/유향|유속|조류|해류/.test(nq)) addOcean('current', '유향·유속 보기');
    if (/풍향|풍속|바람|강풍|돌풍/.test(nq)) addOcean('wind', '풍향·풍속 보기');
    if (/파고|파랑|물결|너울|파도/.test(nq)) addOcean('wave', '파고·파랑 보기');
    if (/cctv|씨씨티비|시시티비|해안.?카메라|해무.?카메라|영상/.test(nq)) addOcean('cctv', 'CCTV 보기');
    if (/부이|부표|관측|파고부이|등표/.test(nq)) {
        const buoy = findBuoyInQuery(query);
        if (buoy) addOcean('buoy', `${buoy.name} 부이 보기`, { buoy: buoy.id });
        else addOcean('buoy', '기상부이 보기');
    }

    // 전용 탭(switchMainTab)
    if (/특보|주의보|경보/.test(nq) || intent === 'warning' || intent === 'both') addTab('weather-alert-section', '특보 화면 보기');
    if (/태풍/.test(nq)) addTab('typhoon-section', '태풍정보 보기');
    if (/해구/.test(nq)) addTab('sea-zone-section', '해구정보 보기');
    if (/일기도|기압계|기압골/.test(nq)) addTab('marine-chart-section', '해상일기도 보기');
    if (/예보|기상예보/.test(nq)) addTab('weather-alert-section', '기상예보 보기');

    return links;
}

// ============================================================================
// 7. AI 대화형 온보딩 — 첫 실행 시 사용자에게 몇 가지 질문해 프로필을 만든다.
// ----------------------------------------------------------------------------
//  요청: POST /api/assistant/onboard  { messages: [{from:'ai'|'user', text}] }
//        (messages 가 비어 있으면 첫 인사+첫 질문 반환)
//  응답: { done, message, profile? }   done=true 면 message=마무리멘트 + profile 동봉
//
//  - AI 키가 있으면 Gemini 가 자연스러운 대화로 진행하고 프로필을 추출(JSON).
//  - 키가 없으면 정해진 질문 순서(scripted)로 진행 — 키 없이도 동작/테스트 가능.
//  - 프로필은 서버에 저장하지 않는다. 클라이언트(휴대폰)가 받아 로컬에 저장.
// ============================================================================

// scripted 폴백용 질문 순서 (체크리스트와 동일)
const ONBOARD_SCRIPT = [
    '만나서 반갑습니다. 더 잘 도와드리려고 몇 가지만 여쭤볼게요. 답변은 이 휴대폰에만 저장되고 외부로 공유되지 않습니다. 먼저, 어떤 일을 하고 계신가요? (예: 어선 선장, 선원, 양식, 낚시, 레저보트 등)',
    '이 앱을 주로 어떤 목적으로 쓰실 계획인가요? (예: 출항 판단, 조업 계획, 안전 확인, 낚시 시기 등)',
    '기상을 보실 때 무엇을 위주로 보시나요? (예: 파고, 풍향, 풍속, 조류, 물때, 시정, 수온, 특보 등 — 편하신 것 말씀해 주세요)',
    '보통 어디서 활동하시나요? 기준점과 방위·거리(예: ○○항 남서방 12해리), 위경도, 또는 특보 구역(예: 제주도북부앞바다) 중 편하신 방식으로요. "때에 따라 다름"도 괜찮습니다.',
    '혹시 선장이거나 조업을 하신다면, 배의 톤수나 선종을 알려주시겠어요? (해당 없으면 "없음"이라고 해주세요)',
    '마지막으로, 답변은 간단한 요약이 좋으세요, 아니면 수치까지 자세히가 좋으세요?'
];
const ONBOARD_FIELDS = ['occupation', 'purpose', 'weatherFactors', 'locationText', 'vesselText', 'answerStyle'];

/** scripted 온보딩 진행 (AI 키 없을 때) */
function onboardScripted(messages) {
    const userReplies = messages.filter(m => m && m.from === 'user').map(m => String(m.text || '').trim());
    const step = userReplies.length; // 다음에 물어볼 질문 인덱스

    if (step < ONBOARD_SCRIPT.length) {
        return { done: false, message: ONBOARD_SCRIPT[step] };
    }
    // 모든 답변 수집 완료 → 프로필 구성
    const profile = {};
    ONBOARD_FIELDS.forEach((f, i) => { if (userReplies[i]) profile[f] = userReplies[i]; });
    // 활동 위치에서 특보구역 추정 시도
    if (profile.locationText) {
        const z = detectZoneDeterministic(profile.locationText);
        profile.location = { freeText: profile.locationText, zone: z || null };
        delete profile.locationText;
    }
    return {
        done: true,
        message: '감사합니다. 알려주신 내용은 이 휴대폰에만 저장돼요. 이제 "나리야" 라고 부르고 궁금한 바다 날씨를 물어보세요. 설정에서 언제든 보기·수정·삭제할 수 있습니다.',
        profile
    };
}

/** AI 온보딩 진행 (Gemini). 실패 시 null 반환(호출자가 scripted 폴백). */
async function onboardWithAI(messages) {
    const transcript = messages.map(m => `${m.from === 'ai' ? '비서' : '사용자'}: ${m.text}`).join('\n');
    const prompt =
`당신은 한국 어선·항해자를 위한 해양 기상 개인 비서입니다. 지금은 첫 만남이라, 사용자를
파악하기 위한 짧은 온보딩 인터뷰를 진행합니다. 따뜻하고 간결하게, 한 번에 하나씩만 물으세요.

수집 목표(과하지 않게, 사용자가 건너뛰면 넘어가기):
1) 직종/역할  2) 앱 사용 목적  3) 주로 보는 기상요소(파고/파향/풍향/풍속/조류/물때/시정/수온/특보 등 — 필요하면 짧게 설명)
4) 주 활동 위치(기준점+방위거리, 위경도, 특보구역, 또는 "때에 따라 다름")  5) 선박 정보(선장/조업 시 톤수·선종)  6) 답변 스타일(간단/자세히)

규칙:
- 첫 메시지에서는 인사 + "정보는 이 휴대폰에만 저장되고 외부 공유되지 않는다"는 안내를 포함하세요.
- 한 번에 질문 하나. 이미 답한 항목은 다시 묻지 마세요.
- 충분히 모였거나 사용자가 그만하고 싶어하면 done=true 로 마치고 따뜻한 마무리 멘트를 message 에 담으세요.
- profile 은 done=true 일 때만 채우세요. 형식:
  {"occupation":"","purpose":"","weatherFactors":[],"location":{"freeText":"","zone":null},"vessel":{"text":""},"answerStyle":""}
  (모르는 값은 비워두기. zone 은 아래 특보구역 목록에 정확히 있을 때만 채우고 없으면 null)

특보구역 목록: ${ZONE_NAMES.join(', ')}

지금까지의 대화:
${transcript || '(아직 없음 — 첫 인사와 첫 질문을 시작하세요)'}

JSON 으로만 답하세요: {"done": false, "message": "<다음에 할 말>", "profile": null}`;

    try {
        const result = await gemini.callGemini({
            model: 'gemini-2.5-flash-lite',
            contents: prompt,
            config: { responseMimeType: 'application/json', temperature: 0.4 },
            caller: 'Assistant-Onboard'
        });
        if (!result.success || !result.text) return null;
        const parsed = JSON.parse(result.text);
        if (typeof parsed.message !== 'string' || !parsed.message.trim()) return null;
        return {
            done: !!parsed.done,
            message: parsed.message.trim(),
            profile: parsed.done ? (parsed.profile || {}) : undefined
        };
    } catch (e) {
        return null;
    }
}

router.post('/api/assistant/onboard', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    const rate = checkRateLimit(getClientIp(req));
    if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSec));
        return res.status(429).json({ ok: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
    }

    const messages = (req.body && Array.isArray(req.body.messages)) ? req.body.messages : [];
    const aiAvailable = !!(gemini && gemini.hasAnyKey && gemini.hasAnyKey());

    let result = null;
    if (aiAvailable) result = await onboardWithAI(messages);
    if (!result) result = onboardScripted(messages);

    res.json({ ok: true, ...result });
});

// ============================================================================
// 9-TTS. 자연스러운 음성(Gemini TTS) — 텍스트를 자연 음성으로 합성해 WAV로 반환.
//   기존 Gemini 키 재사용. 키 없거나 실패하면 503 → 클라이언트가 내장 TTS로 폴백.
//   비용·지연이 있으므로 클라이언트에서 "자연 음성" 토글이 켜졌을 때만 호출.
// ============================================================================
/** RAW PCM(16bit mono) → WAV 컨테이너 (브라우저/네이티브 재생용) */
function pcmToWav(pcm, sampleRate, channels, bitsPerSample) {
    const blockAlign = channels * bitsPerSample / 8;
    const byteRate = sampleRate * blockAlign;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);          // PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

router.post('/api/assistant/tts', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const rate = checkRateLimit(getClientIp(req));
    if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSec));
        return res.status(429).json({ error: '요청이 너무 많습니다.' });
    }
    if (!(gemini && gemini.callGeminiRaw && gemini.hasAnyKey && gemini.hasAnyKey())) {
        return res.status(503).json({ error: '자연 음성(TTS)을 사용할 수 없습니다(키 없음).' });
    }
    const text = (req.body && req.body.text ? String(req.body.text) : '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'text 가 필요합니다.' });
    const voice = (req.body && req.body.voice) ? String(req.body.voice) : 'Kore';

    try {
        const r = await gemini.callGeminiRaw({
            model: 'gemini-2.5-flash-preview-tts',
            contents: text,
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
            },
            caller: 'Assistant-TTS'
        });
        if (!r.success || !r.response) return res.status(502).json({ error: 'TTS 합성 실패' });
        const parts = (((r.response.candidates || [])[0] || {}).content || {}).parts || [];
        const audio = parts.find(p => p.inlineData && /audio|pcm|L16/i.test(p.inlineData.mimeType || ''));
        if (!audio || !audio.inlineData || !audio.inlineData.data) return res.status(502).json({ error: '오디오 데이터 없음' });
        const pcm = Buffer.from(audio.inlineData.data, 'base64');
        const m = (audio.inlineData.mimeType || '').match(/rate=(\d+)/);
        const sampleRate = m ? Number(m[1]) : 24000;
        const wav = pcmToWav(pcm, sampleRate, 1, 16);
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Length', String(wav.length));
        return res.send(wav);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// 9-STT. 클라우드 받아쓰기(Gemini 오디오) + 도메인 힌트 — 음성을 고정밀 텍스트로.
//   호출어로 깨운 뒤 녹음한 질문 오디오(base64)를 받아, 우리 도메인 용어를 힌트로 줘
//   정확히 받아쓴다. 기존 Gemini 키 재사용. 키 없거나 실패하면 503(클라이언트가 내장 인식 폴백).
//   요청: { audio: <base64>, mimeType: "audio/webm"|"audio/wav"|... }
//   응답: { ok, text }
// ============================================================================
router.post('/api/assistant/transcribe', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const rate = checkRateLimit(getClientIp(req));
    if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSec));
        return res.status(429).json({ ok: false, error: '요청이 너무 많습니다.' });
    }
    if (!(gemini && gemini.callGeminiRaw && gemini.hasAnyKey && gemini.hasAnyKey())) {
        return res.status(503).json({ ok: false, error: '받아쓰기를 사용할 수 없습니다(키 없음).' });
    }
    const audio = req.body && req.body.audio;
    const mimeType = (req.body && req.body.mimeType) ? String(req.body.mimeType) : 'audio/webm';
    if (!audio || typeof audio !== 'string') return res.status(400).json({ ok: false, error: 'audio(base64)가 필요합니다.' });

    const hint =
`다음 한국어 음성을 그대로 받아쓰세요(해양 기상 비서용). 추측·요약·답변하지 말고, 들린 문장만 한 줄로 출력하세요.
자주 나오는 용어(이쪽으로 잘못 들리면 교정): 호출어 "나리야", 해역명 ${ZONE_NAMES.slice(0, 40).join(', ')} 등, 부이명 거문도/오륙도/마라도/추자도/울릉도/서귀포, "해구 325" 같은 해구 번호.`;
    try {
        const r = await gemini.callGeminiRaw({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: hint }, { inlineData: { mimeType, data: audio } }] }],
            config: { temperature: 0 },
            caller: 'Assistant-STT'
        });
        if (!r.success || !r.response) return res.status(502).json({ ok: false, error: '받아쓰기 실패' });
        let text = '';
        try { text = (r.response.text || '').trim(); } catch (e) { text = ''; }
        if (!text) return res.status(502).json({ ok: false, error: '받아쓴 내용이 없습니다.' });
        return res.json({ ok: true, text });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ============================================================================
// 9. 스타일·성향 다이제스트 — 누적 대화를 AI가 정리(말투/선호형식/관심사).
//   클라이언트가 몇 건마다 한 번 호출해 결과를 휴대폰에 저장(seagnal_style.styleNote).
//   통계(자주 보는 해역/주제, 질문 수)는 클라이언트가 결정론적으로 누적하므로,
//   이 엔드포인트는 "말투/선호" 같은 정성 요약만 담당. 키 없으면 ok:false 반환.
// ============================================================================
router.post('/api/assistant/style-digest', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const rate = checkRateLimit(getClientIp(req));
    if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSec));
        return res.status(429).json({ ok: false, error: '요청이 너무 많습니다.' });
    }
    if (!(gemini && gemini.hasAnyKey && gemini.hasAnyKey())) {
        return res.json({ ok: false, reason: 'no-ai' });
    }
    const history = (req.body && Array.isArray(req.body.history)) ? req.body.history.slice(-30) : [];
    if (!history.length) return res.json({ ok: false, reason: 'no-history' });

    const prompt =
`사용자가 해양 기상 비서와 나눈 대화 기록입니다. 사용자의 "성향"을 한 문장으로 요약하세요.
- 어떤 말투로 묻는지(예: 짧고 직설적/존댓말/사투리), 어떤 정보를 자주 원하는지, 답변 길이 선호(간결/상세)를 반영.
- 개인정보·민감정보는 넣지 마세요. 60자 이내 한 문장.

대화기록(JSON): ${JSON.stringify(history)}

JSON 으로만: {"styleNote":"<한 문장>","preferredFormat":"간결|상세|보통"}`;
    try {
        const r = await gemini.callGemini({
            model: BRAIN_MODEL, contents: prompt,
            config: { responseMimeType: 'application/json', temperature: 0.3 }, caller: 'Assistant-Style'
        });
        if (!r.success || !r.text) return res.json({ ok: false, reason: 'ai-failed' });
        const p = JSON.parse(r.text);
        return res.json({ ok: true, styleNote: (p.styleNote || '').slice(0, 80), preferredFormat: p.preferredFormat || null });
    } catch (e) {
        return res.json({ ok: false, reason: 'error' });
    }
});

module.exports = router;
