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
const router = express.Router();
const { dataCache } = require('../services/cache_manager');

// Gemini 공용 클라이언트 (키 없으면 hasAnyKey()=false → 폴백 경로 사용)
let gemini = null;
try {
    gemini = require('../services/gemini_client');
} catch (e) {
    console.warn('[Assistant] gemini_client 로드 실패 — 폴백 모드로 동작:', e.message);
}

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
    return best;
}

/** 질문에서 의도(특보 vs 기상전망)를 키워드로 추정 */
function detectIntentDeterministic(query) {
    const nq = normalize(query);
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
    if (!code || !all || !all[code] || !all[code].length) return null;

    const series = all[code];
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

    return { updatedAt: dataCache.forecasts.updatedAt || null, periods };
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
function composeAnswerFallback(zoneName, intent, fc, warn) {
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

            const p1 = fc.periods[1];
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
// ============================================================================
async function composeAnswerAI(zoneName, intent, fc, warn) {
    const factPayload = {
        해역: zoneName,
        질문유형: intent,
        기상전망: fc,   // { updatedAt, periods:[...] } or null
        특보: warn      // { current, upcoming } or null
    };

    const prompt =
`당신은 한국 어선·항해자를 돕는 해양 기상 음성 비서입니다.
아래 JSON은 "${zoneName}"의 실제 기상청 데이터입니다. 이 데이터에 있는 값만 사용해서 답하세요.
- 데이터에 없는 수치나 사실을 절대 지어내지 마세요. 없으면 "정보가 없습니다"라고 말하세요.
- 음성으로 읽어줄 답변이므로 2~3문장의 자연스러운 구어체로 짧게 답하세요.
- 풍향/풍속/파고 같은 핵심 수치를 우선 전달하세요.
- 표, 마크다운, 이모지는 쓰지 마세요. 순수 문장만 출력하세요.

데이터:
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
    return composeAnswerFallback(zoneName, intent, fc, warn);
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

intent 는 다음 중 하나:
- "marine_weather": 날씨/바람/파고/기상 전망
- "warning": 특보/주의보/경보 발효 여부
- "both": 둘 다

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
        const intent = ['marine_weather', 'warning', 'both'].includes(parsed.intent)
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

    if (!query) {
        return res.status(400).json({ ok: false, error: '질문(query)이 비어 있습니다.' });
    }

    const aiAvailable = !!(gemini && gemini.hasAnyKey && gemini.hasAnyKey());

    // [1] 해역 + 의도 파악 — AI 우선, 실패/부재 시 결정론적 폴백
    let zone = null;
    let intent = null;
    if (aiAvailable) {
        const ai = await detectWithAI(query);
        if (ai) { zone = ai.zone; intent = ai.intent; }
    }
    if (!zone) zone = detectZoneDeterministic(query);
    if (!intent) intent = detectIntentDeterministic(query);

    // [2] 해역을 못 찾으면 안내 답변
    if (!zone) {
        return res.json({
            ok: true,
            zone: null,
            intent,
            answer: '어느 해역을 말씀하시는지 알아듣지 못했어요. 예를 들어 "제주도 북부 앞바다 기상" 처럼 해역 이름을 함께 말씀해 주세요.',
            data: null,
            aiUsed: false
        });
    }

    // [3] 실데이터 수집 (메모리 캐시)
    const fc = buildForecastSummary(zone);
    const warn = findWarning(zone);

    // [4] 답변 생성 — AI 우선, 폴백 보장
    let answer;
    let aiUsed = false;
    if (aiAvailable) {
        answer = await composeAnswerAI(zone, intent, fc, warn);
        aiUsed = true;
    } else {
        answer = composeAnswerFallback(zone, intent, fc, warn);
    }

    res.json({
        ok: true,
        zone,
        intent,
        answer,
        data: { forecast: fc, warning: warn },
        aiUsed
    });
});

module.exports = router;
