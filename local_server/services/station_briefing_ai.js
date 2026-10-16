/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing_ai.js
 * 역할  : 관할 브리핑의 「총평」만 AI 에게 맡기는 부분 — 서버가 정한 사실(단계·해역·시각·숫자)을 묶어 AI 에게 보내고,
 *         돌아온 글을 관할별로 대조 검사(숫자·지명·단계 말·금지어·필수 포함·문장 수)해 통과한 것만 쓴다.
 *         순서: ChatGPT(관리자 정액제 VM) → 꺼져 있거나 실패하면 Gemini → 둘 다 실패하면 틀 총평. 실패한 관할만 한 번 더, 그래도 실패면 틀.
 *         묶음 단위(파출소·해양경찰서·지방청)와 「입력이 지난번과 같으면 재사용」을 설정으로 고른다(§11.6-17).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing_rules.js(hash·RELEASE_LINES)
 *  - 서버 API      : 없음 — AI 호출은 넘겨받은 어댑터로만(실제: codex_bridge.callRaw · gemini_client.callGeminiRaw — station_briefing.js 가 만든다)
 *  - 나를 쓰는 곳  : services/station_briefing.js(run) · scripts/test_station_briefing.js(가짜 어댑터)
 *  - 설계 근거     : 구성안 부록 A(입력 묶음·검증 순서) · coastal_risk.design.md §9.2(환각 방지) · handoff_marine_fusion.md 29~33행(직무 지시·해상 배수 금지)
 * [로드 순서] 서버 require 부작용 없음. 네트워크는 어댑터를 통해서만.
 * ============================================================================
 */
'use strict';
const R = require('./station_briefing_rules');

const SCHEMA = 'station-briefing-input-v1';
// 쓰지 않는 말 — 직무 지시(handoff_marine_fusion.md:29)·「안전」 단정(coastal_risk.design.md 「안전합니다」 금지)·확률 표현.
const FORBIDDEN = Object.freeze(['순찰', '배치', '출동', '단속', '통제', '사고 확률', '확률', '사고가 납니다']);
const SAFE_RE = /안전(?:합니다|하다|해요|한\s*편|할\s*것|하니|하므로)/;
// 단계 말 = 「관심/주의/경계 (이/가) 필요」 꼴만 단계로 본다. 「갯벌·고립 주의」·「떠밀림 주의」·「충돌·접촉 주의」 같은 앱 안내 이름과 「풍랑주의보」는 단계 말이 아니다.
const LEVEL_RE = /(관심|주의|경계)\s*(?:이|가)?\s*필요/g, LEVEL_RANK = { '관심': 1, '주의': 2, '경계': 3 };
// 따옴표로 인용한 공식 단계 이름(예: 공식 사고예보 '주의', 혼잡 예보 '높음')은 서버 사실 문장에 같은 꼴로 있어야 한다.
const LABEL_RE = /'(낮음|보통|주의|경계|높음|매우높음|위험)'/g;
const PLACE_RE = /[가-힣A-Za-z0-9]{2,}(?:해수욕장|해변|포구|앞바다|먼바다|연안바다|파출소|해양경찰서|방파제|해구|항)/g;
const NOT_PLACE = ['운항', '출항', '입항', '귀항', '결항', '회항', '사항', '방향', '저항', '항항'];
const MIN_S = 3, MAX_S = 5;

/** 글에서 숫자를 뽑아 표준 꼴로(앞자리 0·끝 0 무시). 예: '06:12, 1.80배, 232-2' → ['6','12','1.8','232','2']. @param {string} t @returns {string[]} [연계] ← stationInput·validateOverview */
function numbers(t) { return (String(t || '').match(/\d+(?:\.\d+)?/g) || []).map((x) => String(Number(x))); }
/** 문장으로 나눈다(마침표·물음표·느낌표 뒤 공백, 「다.」 끝). 예: 'A입니다. B입니다.' → 2. @param {string} t @returns {string[]} [연계] ← validateOverview */
function sentences(t) { return String(t || '').split(/(?<=[.!?。])\s+/).map((x) => x.trim()).filter(Boolean); }

/**
 * 브리핑 하나에서 AI 에게 보낼 관할 입력을 만든다(부록 A — 관할 배열의 한 칸). 총평에 올릴 것만 넣는다:
 * 해상은 overviewTop(기상·혼잡 근거가 겹친 해역 — §11.6-17①), 육상은 오늘 바뀐 요소가 있는 곳(overviewTop) + 상시 위험 장소 이름.
 * 허용 숫자 = 서버가 만든 사실 문장들 안의 숫자 전부, 허용 지명 = 관할·해역·구역·관광지 이름.
 * 예: stationInput(한림 브리핑) → {id:'제주해양경찰서|한림파출소', sea:{level:'주의 필요',top:[…]}, land:{…}, allowed_numbers:['15','18',…], allowed_places:[…], levels:{…}}
 * @param {object} b - rules.buildBriefing 결과 @returns {object} [연계] ← batchInput·validateOverview / hash 의 대상
 */
function stationInput(b) {
    const sea = b.sea, land = b.land, facts = [], places = new Set([b.station.name, b.station.office, b.station.region].filter(Boolean)), levels = {}, multipliers = new Set();
    const seaTop = sea.overviewTop.map((c) => {
        const ev = [c.overview.window + ' ' + c.overview.label, ...c.today.lines.slice(0, 4), c.traits.text];
        facts.push(c.name, ...ev); places.add(c.name); if (c.nameBase) places.add(c.nameBase); if (c.traits.zone?.name) places.add(c.traits.zone.name);
        levels[c.name] = c.overview.rank; if (c.nameBase) levels[c.nameBase] = Math.max(levels[c.nameBase] || 0, c.overview.rank);
        return { name: c.name, level: c.overview.word, window: c.overview.window, evidence: ev };
    });
    const timeline = sea.timeBar.filter((s) => s.rank > 0 || s.events.length).map((s) => ({ at: s.label, level: s.word, events: s.events.map((e) => e.text) }));
    timeline.forEach((s) => facts.push(s.at, ...s.events));
    const special = b.special.map((x) => { facts.push(x.title, ...x.lines); places.add(x.zone); return [x.title, ...x.lines].join(' '); });
    if (b.special.some((x) => x.kind === 'release')) { multipliers.add('1.2'); multipliers.add('1.3'); }
    if (sea.weather) facts.push(sea.weather.text);
    const seaPart = { level: sea.overviewLevel.word, reviewed_cells: sea.reviewedCells, attention_regions: sea.attentionRegions, weather: sea.weather ? sea.weather.text : null, top: seaTop, timeline, missing_sources: sea.missing };
    facts.push(String(sea.reviewedCells), String(sea.attentionRegions));
    let landPart = null;
    if (land) {
        const top = land.overviewTop.map((c) => { facts.push(c.name, ...c.today.changes, c.traits.text); places.add(c.name); levels[c.name] = c.rank; (c.today.changes.join(' ').match(/(\d+(?:\.\d+)?)배/g) || []).forEach((m) => multipliers.add(String(Number(m.replace('배', ''))))); return { name: c.name, level: c.word, changes: c.today.changes, traits: c.traits.text }; });
        const constant = land.constant.slice(0, 5).map((c) => { places.add(c.name); facts.push(c.name, c.text || ''); return c.name; });
        landPart = { level: land.level.word, reviewed_spots: land.reviewedSpots, changed_spots: land.cards.length, top, constant };
        facts.push(String(land.reviewedSpots), String(land.cards.length));
    }
    const tide = b.tide ? b.tide.text : [];
    facts.push(...tide);
    // 틀 총평에 쓰는 고정 기준 숫자(파고 2m·풍속 12m/s)는 weather 문장 안에 이미 있다. 날짜 숫자(월·일)도 허용.
    facts.push(b.targetDate.slice(5, 7), b.targetDate.slice(8, 10));
    const labels = new Set(); for (const f of facts) for (const m of String(f).matchAll(LABEL_RE)) labels.add(m[0]);
    return {
        id: b.key, name: b.station.name, office: b.station.office, date: b.targetDate, day_word: R.dayWordOf(b),
        sea: seaPart, land: landPart, special, tide,
        allowed_numbers: [...new Set(facts.flatMap(numbers))].sort((a, b2) => Number(a) - Number(b2)),
        allowed_places: [...places].filter(Boolean).sort(), levels, allowed_multipliers: [...multipliers].sort(), allowed_labels: [...labels].sort(),
        required: { sea: sea.overviewTop[0] ? (sea.overviewTop[0].nameBase || sea.overviewTop[0].name) : null, land: land?.overviewTop[0]?.name || null },
    };
}
/**
 * 여러 관할을 한 번에 보낼 묶음을 만든다(부록 A schema). kma_outlook = 기상청 해상 기상 전망(단기 통보문) 원문 발췌 — 원인·흐름 이해용이며
 * 그 안의 숫자·지명은 총평에 쓰지 않는다(허용 목록에 넣지 않는다).
 * 예: batchInput([한림, 애월], kma) → {schema:'station-briefing-input-v1', stations:[2], kma_outlook:{…}, rules:{…}}
 * @param {object[]} inputs - stationInput 결과들 @param {object|null} kma - {title,publishTime,forecastPeriod,excerpt:{해상,강풍,너울,바다안개}}
 * @returns {object} [연계] ← generate / → buildPrompt
 */
function batchInput(inputs, kma) {
    return {
        schema: SCHEMA, stations: inputs, kma_outlook: kma || null,
        rules: { sentences_per_paragraph: [MIN_S, MAX_S], forbidden: FORBIDDEN.concat(['안전합니다', "해상 '사고 N배'"]), level_words: ['관심 필요', '주의 필요', '경계 필요'] },
    };
}
/** AI 지시문 + 묶음 JSON. 예: buildPrompt(batch) → '너는 …\n\n{"schema":…}'. @param {object} batch @returns {string} [연계] ← generate */
function buildPrompt(batch) {
    return [
        '너는 해양 안전 「활동지점 안전 브리핑」의 총평만 쓰는 작성자다. 아래 JSON 의 stations 마다 육상 한 문단(land)과 해상 한 문단(sea)을 쓴다.',
        '각 문단은 3~5문장. 단순 나열이 아니라 원인과 시간 흐름을 엮는다(예: 「오전에는 바람이 약하지만 15시부터 파고가 높아져 …」). 마지막 문장은 「따라서 … 에 관심/주의/경계가 필요합니다」 꼴.',
        '규칙(어기면 그 관할 글은 버려진다):',
        '1) 숫자는 그 관할의 allowed_numbers 에 있는 것만 쓴다. 새 숫자·비율·배수를 만들지 않는다.',
        '2) 지명(항·포구·해수욕장·앞바다·해구·파출소 등)은 allowed_places 에 있는 것만 쓴다.',
        '3) 단계 말(관심 필요·주의 필요·경계 필요)은 levels 에 적힌 단계보다 높이지 않는다. levels 에 없는 대상에는 「관심」까지만. 따옴표로 쓰는 공식 단계 이름(\'주의\' 등)은 allowed_labels 에 있는 것만.',
        '4) 해상 문단에는 required.sea, 육상 문단에는 required.land 이름을 반드시 넣는다(null 이면 생략).',
        '5) 쓰지 않는 말: 순찰·배치·출동·단속·통제(직무 지시), 「안전합니다」, 「사고 확률」, 해상의 「사고 N배」. 지시(「~하라」)가 아니라 「~에 관심/주의/경계가 필요합니다」.',
        '6) land 가 null 인 관할(해상만 제공)은 land 를 null 로 둔다.',
        '7) kma_outlook 은 기상청 해상 기상 전망 원문 발췌다 — 원인(저기압·바람 방향 등)과 흐름을 이해하는 데만 쓰고, 그 안의 숫자·지명은 옮기지 않는다.',
        '8) 입력에 없는 사실을 지어내지 않는다.',
        '응답은 JSON 하나만: {"stations":[{"id":"<입력 id 그대로>","land":"…"|null,"sea":"…"}]}',
        '',
        JSON.stringify(batch),
    ].join('\n');
}
/**
 * AI 응답 글에서 관할별 총평을 꺼낸다(앞뒤 ``` 표시 허용). 모양이 틀리면 throw.
 * 예: '{"stations":[{"id":"a","land":null,"sea":"…"}]}' → Map{'a' → {land:null,sea:'…'}}
 * @param {string} text @returns {Map<string,object>} [연계] ← generate
 */
function parseResponse(text) {
    const m = String(text || '').trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i), body = m ? m[1] : String(text || '').trim();
    const j = JSON.parse(body);
    if (!j || !Array.isArray(j.stations)) throw new Error('invalid response');
    const out = new Map();
    for (const s of j.stations) if (s && typeof s.id === 'string' && !out.has(s.id)) out.set(s.id, { land: typeof s.land === 'string' ? s.land.trim() : null, sea: typeof s.sea === 'string' ? s.sea.trim() : '' });
    return out;
}
/**
 * 관할 하나의 총평을 입력과 대조한다(부록 A 검증 순서 1~7). 하나라도 어기면 ok:false 와 이유 목록.
 *   모양(문단·문장 수 3~5, 해상만 관할은 land 없음) · 숫자(allowed_numbers) · N배(allowed_multipliers — 해상 「사고 N배」 금지) · 지명(allowed_places)
 *   · 단계 말(문장 안 대상의 levels 를 넘으면 실패 — 「관심」은 늘 허용) · 필수 포함(required) · 금지어
 * 예: validateOverview({land:null, sea:'…한림항 순찰…'}, si) → {ok:false, errors:['forbidden:순찰']}
 * @param {object} o - {land,sea} @param {object} si - stationInput @returns {object} {ok,errors}
 * [연계] ← generate · 시험(틀 총평도 이 검사를 통과해야 한다)
 */
function validateOverview(o, si) {
    const errors = [], allowedN = new Set(si.allowed_numbers), allowedM = new Set(si.allowed_multipliers || []);
    const paras = [['sea', o?.sea], ['land', o?.land]];
    if (!si.land && o?.land) errors.push('shape:land-not-allowed');
    if (si.land && !o?.land) errors.push('shape:land-missing');
    if (!o?.sea) errors.push('shape:sea-missing');
    for (const [k, t] of paras) {
        if (!t) continue;
        const ss = sentences(t);
        if (ss.length < MIN_S || ss.length > MAX_S) errors.push('shape:' + k + '-sentences-' + ss.length);
        for (const n of numbers(t)) if (!allowedN.has(n)) errors.push('number:' + n);
        for (const mm of t.matchAll(/(\d+(?:\.\d+)?)\s*배/g)) if (!allowedM.has(String(Number(mm[1])))) errors.push('multiplier:' + mm[1]);
        for (const p of t.match(PLACE_RE) || []) { if (NOT_PLACE.some((w) => p.endsWith(w))) continue; if (!si.allowed_places.some((a) => a.includes(p) || p.includes(a) && a.length >= 2 && p.replace(a, '').length <= 1)) errors.push('place:' + p); }
        for (const w of FORBIDDEN) if (t.includes(w)) errors.push('forbidden:' + w);
        for (const lm of t.matchAll(LABEL_RE)) if (!(si.allowed_labels || []).includes(lm[0])) errors.push('label:' + lm[0]);
        if (SAFE_RE.test(t)) errors.push('forbidden:안전 단정');
        for (const s of ss) {
            const named = Object.entries(si.levels || {}).filter(([name]) => s.includes(name)).map(([, r]) => r);
            const cap = Math.max(1, ...named, named.length ? 0 : (k === 'sea' ? levelRank(si.sea?.level) : levelRank(si.land?.level)));
            for (const lm of s.matchAll(LEVEL_RE)) if (LEVEL_RANK[lm[1]] > cap) errors.push('level:' + lm[1] + '>' + cap);
        }
    }
    if (si.required?.sea && o?.sea && !o.sea.includes(si.required.sea)) errors.push('required:sea');
    if (si.required?.land && o?.land && !o.land.includes(si.required.land)) errors.push('required:land');
    return { ok: errors.length === 0, errors: [...new Set(errors)] };
}
/** 단계 말 → 순위. 예: '주의 필요' → 2, '평소 수준' → 0. @param {string} w @returns {number} [연계] ← validateOverview */
function levelRank(w) { return w && w.startsWith('경계') ? 3 : w && w.startsWith('주의') ? 2 : w && w.startsWith('관심') ? 1 : 0; }

/** 묶음 단위대로 나눈다. 예: unit 'office' → 해양경찰서마다 한 묶음(21개). @param {object[]} items @param {string} unit - station|office|region @returns {object[][]} [연계] ← generate */
function groupBy(items, unit) {
    const m = new Map();
    for (const it of items) { const k = unit === 'station' ? it.b.key : unit === 'region' ? (it.b.station.region || it.b.station.office) : it.b.station.office; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
    return [...m.values()];
}
/**
 * 관할 브리핑들의 총평을 만든다(AI 또는 틀). 재사용 → 묶음 호출(VM→Gemini) → 관할별 검증 → 실패 관할만 1회 재시도 → 틀.
 * 예: await generate({briefings:[…97], config:{method:'chatgpt',chatgptModel:'gpt-6-luna',geminiModel:'gemini-2.5-flash',batchUnit:'office',onlyChanged:true}, previous, adapters, kma})
 *     → {overviews:{key:{land,sea,source:'chatgpt'|'gemini'|'template',model,hash,reused?}}, stats:{calls,reused,ai,template,retried}, errors:[…]}
 * @param {object} o - briefings·config·previous(key→지난 브리핑)·adapters{vm,gemini}·kma·now
 * @returns {Promise<object>} [연계] ← station_briefing.run / → stationInput·batchInput·buildPrompt·parseResponse·validateOverview
 */
async function generate({ briefings, config, previous = {}, adapters = {}, kma = null, now = Date.now() }) {
    const method = config.method || 'template', overviews = {}, errors = [], stats = { calls: 0, reused: 0, ai: 0, template: 0, retried: 0 };
    const at = R.isoKst(now);
    const items = briefings.map((b) => { const si = stationInput(b); return { b, si, hash: R.hash({ si, rules: R.RULES_VERSION, method, model: method === 'chatgpt' ? config.chatgptModel : method === 'gemini' ? config.geminiModel : null, kma: kma ? R.hash(kma) : null }) }; });
    const template = (it) => { overviews[it.b.key] = { land: it.b.overview.land, sea: it.b.overview.sea, source: 'template', model: null, hash: it.hash }; stats.template++; };
    const pending = [];
    for (const it of items) {
        const prev = previous[it.b.key]?.overview;
        if (method === 'template') { template(it); continue; }
        if (config.onlyChanged !== false && prev && prev.hash === it.hash && ['chatgpt', 'gemini'].includes(prev.source)) { overviews[it.b.key] = { ...prev, reused: true }; stats.reused++; continue; }
        pending.push(it);
    }
    const chain = method === 'chatgpt' ? ['vm', 'gemini'] : ['gemini'];
    /** 한 묶음을 사슬(VM → Gemini) 순서로 보낸다 — 앞이 꺼져 있거나 실패·해석 실패면 다음. @returns {Promise<object|null>} {provider,model,map} */
    async function callChain(group) {
        const prompt = buildPrompt(batchInput(group.map((it) => it.si), kma));
        for (const p of chain) {
            const a = adapters[p];
            if (!a || (typeof a.available === 'function' && !a.available())) { errors.push({ at, stage: 'call', provider: p, stations: group.map((it) => it.b.key), reason: p === 'vm' ? 'VM 작업자 연결 없음' : '사용 불가' }); continue; }
            const model = p === 'vm' ? config.chatgptModel : config.geminiModel;
            try { stats.calls++; const text = await a.call({ prompt, model }); return { provider: p === 'vm' ? 'chatgpt' : 'gemini', model, map: parseResponse(text) }; }
            catch (e) { errors.push({ at, stage: e.message === 'invalid response' || e instanceof SyntaxError ? 'parse' : 'call', provider: p, stations: group.map((it) => it.b.key), reason: String(e.message || e).slice(0, 120) }); }
        }
        return null;
    }
    /** 한 묶음 결과를 관할별로 검증해 통과는 받아들이고 실패 목록을 돌려준다. @returns {object[]} 실패 항목 */
    function accept(group, res) {
        const failed = [];
        for (const it of group) {
            const o = res?.map.get(it.b.key);
            if (!res) { failed.push(it); continue; }
            const v = o ? validateOverview(o, it.si) : { ok: false, errors: ['missing:station'] };
            if (v.ok) { overviews[it.b.key] = { land: o.land || null, sea: o.sea, source: res.provider, model: res.model, hash: it.hash }; stats.ai++; }
            else { errors.push({ at, stage: 'validate', provider: res.provider, stations: [it.b.key], reason: v.errors.slice(0, 6).join(',') }); failed.push(it); }
        }
        return failed;
    }
    for (const group of groupBy(pending, config.batchUnit || 'office')) {
        const failed = accept(group, await callChain(group));
        if (!failed.length) continue;
        stats.retried += failed.length;
        const again = accept(failed, await callChain(failed));
        for (const it of again) template(it);
    }
    return { overviews, stats, errors };
}

module.exports = { SCHEMA, FORBIDDEN, stationInput, batchInput, buildPrompt, parseResponse, validateOverview, generate, numbers, sentences, groupBy };
