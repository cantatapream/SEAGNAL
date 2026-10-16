/**
 * ============================================================================
 * 파일명: local_server/services/station_briefing_ai.js
 * 역할  : 관할 브리핑의 「총평」만 AI 에게 맡기는 부분 — 서버가 정한 사실(단계·해역·시각·숫자)을 묶어 AI 에게 보내고,
 *         돌아온 글을 관할별로 대조 검사(숫자+단위·한글 수사·배수·지명·단계 말·금지어·안전 단정·HTML/링크·필수 포함·문장 수, NFKC 정규화)해 통과한 것만 쓴다.
 *         순서: ChatGPT(관리자 정액제 VM) → 꺼져 있거나 실패하면 Gemini → 둘 다 실패하면 틀 총평. 실패한 관할만 한 번 더, 그래도 실패면 틀.
 *         묶음 단위(파출소·해양경찰서·지방청)와 「입력이 지난번과 같으면 재사용」을 설정으로 고른다(§11.6-17). 호출마다 시간 제한·실행 데드라인·VM 연속 실패 차단기.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/station_briefing_rules.js(hash·RULES_VERSION·templateOverview — 틀 총평 숫자를 허용 목록에·SOURCE_LABEL·md·dayWordOf)
 *  - 서버 API      : 없음 — AI 호출은 넘겨받은 어댑터로만(실제: codex_bridge.callRaw · gemini_client.callGeminiRaw — station_briefing.js 가 만든다)
 *  - 나를 쓰는 곳  : services/station_briefing.js(run) · scripts/test_station_briefing.js(가짜 어댑터)
 *  - 설계 근거     : 구성안 부록 A(입력 묶음·검증 순서) · coastal_risk.design.md §9.2(환각 방지) · handoff_marine_fusion.md 29~33행(직무 지시·해상 배수 금지)
 * [로드 순서] 서버 require 부작용 없음. 네트워크는 어댑터를 통해서만.
 * ============================================================================
 */
'use strict';
const R = require('./station_briefing_rules');

const SCHEMA = 'station-briefing-input-v2';
// 재사용 해시에 들어가는 판(독립 검토 B10) — 검증 규칙·지시문이 바뀌면 지난 AI 총평을 재사용하지 않는다.
const VALIDATOR_VERSION = 'sb-validate-v2', PROMPT_VERSION = 'sb-prompt-v2';
// 쓰지 않는 말 — 직무 지시(handoff_marine_fusion.md:29 — 「경비정 투입」 같은 지시도, 독립 검토 B6)·「안전」 단정(coastal_risk.design.md 「안전합니다」 금지)·확률 표현.
// 대조는 NFKC 정규화 + 공백·제로폭 문자를 지운 꼴끼리(「순 찰」·「순​찰」도 잡는다).
const FORBIDDEN = Object.freeze(['순찰', '배치', '출동', '단속', '통제', '투입', '경비정', '검문', '감시 강화', '집중 감시', '근무', '사고 확률', '확률', '사고가 납니다']);
// 「안전」 단정 — 공백을 지운 글에 건다. 「안전한 상태」·「이상 없음」·「문제없음」·「위험 요소가 없습니다」·「걱정 없」 등(B6). 「위험 요소는 확인되지 않았습니다」(§10.3 허용 문구)는 걸리지 않는다.
const SAFE_RE = /안전(?:합니다|하다|해요|한편|할것|하니|하므로|한상태|한상황|한수준|권|이보장|을보장)|이상(?:이|은|도)?(?:전혀)?없|문제(?:가|는|도)?(?:전혀)?없|위험(?:요소|요인)?(?:가|는|이|은|도)?(?:전혀)?없|걱정(?:이|은|도|할필요가?|할필요는)?(?:전혀)?없|우려(?:가|는|도)?(?:전혀)?없/;
// 단계 말 — 「관심/주의/경계」 + 서술(필요·요구·요망·단계·수준·하십시오·해야·바랍니다·기울·태세·강화 등) 모든 꼴(B4).
// 「갯벌·고립 주의」·「떠밀림 주의」·「충돌·접촉 주의」 같은 앱 안내 이름과 「풍랑주의보」·따옴표 「'주의'」는 단계 말이 아니다.
const LEVEL_RE = /(관심|주의|경계)\s*(?:이|가|를|을|은|는|의)?\s*(?:필요|요구|요망|요청|단계|수준|등급|하십시오|하세요|하시기|하셔야|해야|하여야|해\s*주십시오|바랍니다|기울|태세|강화)/g, LEVEL_RANK = { '관심': 1, '주의': 2, '경계': 3 };
// 따옴표로 인용한 공식 단계 이름(예: 공식 사고예보 '주의', 혼잡 예보 '높음')은 서버 사실 문장에 같은 꼴로 있어야 한다.
const LABEL_RE = /'(낮음|보통|주의|경계|높음|매우높음|위험)'/g;
// 숫자 + 단위(B1) — 단위까지 묶어 대조한다(「3m」와 「232-3해구」의 3은 다른 사실). 범위(「12~15m/s」)는 범위 자체가 입력에 있어야 한다.
const UNIT_SRC = 'm\\/s|km|cm|mm|해리|해구|시간|시|분|초|칸|척|건|곳|명|개|배|%|년|월|일|m';
const NUM_RE = new RegExp('(\\d{1,2}):(\\d{2})|(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_SRC + ')?(?:\\s*[~∼〜–-]\\s*(\\d+(?:\\.\\d+)?)\\s*(' + UNIT_SRC + ')?)?', 'g');
// 한글 수사(B2) — 「세 시」·「두 척」·「서른 미터」·「구 미터」·「삼십 m」 등 숫자를 한글로 쓴 꼴은 대조할 수 없으니 막는다(지시문: 숫자는 아라비아 숫자로).
const HNUM_RE = new RegExp('(?:^|[^가-힣])((?:열한|열두|하나|둘|셋|넷|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|스물|서른|마흔|쉰|예순|일흔|여든|아흔|[일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구]?백)\\s*(?:미터|m|시간|시|분|초|척|건|곳|명|해리|노트|킬로|칸|개|퍼센트|프로|센티)|[일이삼사오육칠팔구]\\s*(?:미터|해리|노트|킬로|퍼센트|프로|센티))(?=$|[^가-힣]|에|부터|까지|의|이|가|을|를|은|는|로|으로|쯤|경|께|씩|만|정도|이상|이하|동안|무렵|전|후|째)', 'g');
const HMULT_RE = /(?:^|[^가-힣])((?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|몇|수십|여러)\s*배)(?=$|[^가-힣]|로|나|가량|이상|정도|쯤|씩|만큼|가|는|에)/g;
// 지명(B5) — 접미사로 지명 후보를 찾는다. 한 글자 접미사(항·섬·곶·만·포·도)는 흔한 낱말(정도·운항·오늘만)과 겹쳐 따로 거른다.
const PLACE_SUFFIX = ['해양경찰서', '해수욕장', '연안바다', '앞바다', '먼바다', '파출소', '출장소', '방파제', '갯바위', '해변', '포구', '부두', '등대', '해구', '해협', '항', '섬', '곶', '만', '포', '도'];
const NOT_PLACE = new Set(['운항', '출항', '입항', '귀항', '결항', '회항', '사항', '저항', '항항', '대항', '조항', '반항', '이항', '공항', '어항', '개항', '취항', '기항', '내항', '외항', '본항', '선항', '대해구', '소해구',
    '어느정도', '위험도', '혼잡도', '난이도', '중요도', '정확도', '신뢰도', '만족도', '민감도', '선명도', '투명도', '집중도', '밀집도', '심각도', '가능도', '숙련도', '관심도', '노출도', '기여도', '영향도', '포화도', '분포도']);
const PLACE_TAIL_RE = /(?:에서는|에서도|에서|으로는|으로|까지|부터|보다|처럼|에는|에도|에게|이나|이며|이고|이라|라는|와는|과는|의|에|은|는|이|가|을|를|과|와|로|만|앞|쪽|부근|인근|주변|일대|근처|해역|바다|방면)$/;
const MAN_CONTEXT = /^(?:에서|에서는|에서도|앞|쪽|부근|인근|주변|일대|근처|해역|바다|방면|의|에)$/;
const NEXT_CONTEXT = /^(?:해역|일대|주변|인근|부근|근처|앞|앞바다|연안|해안|쪽|방면|북|남|동|서|갯바위|방파제|포구|해상|바깥|안쪽|입구|부두|등대|섬)/;
const STOP_WORD = new Set(['관할', '인근', '주변', '부근', '해당', '같은', '모든', '각', '일부', '전체', '오늘', '내일', '따라서', '특히', '다만', '또', '및', '등', '해상', '육상', '연안', '이', '그', '저', '이번', '이곳', '그곳', '평소', '현재', '지금', '오전', '오후', '새벽', '밤', '낮', '앞', '뒤', '옆', '안', '밖', '근처', '여러', '주요']);
const PARTICLE_END = /(?:은|는|을|를|에|서|로|과|와|의|만|고|며|면|다|요|게|께|죠)$/;
const MIN_S = 3, MAX_S = 5;

/** NFKC 정규화(전각 숫자·호환 문자 → 보통 꼴, B2). 예: '９９m' → '99m'. @param {string} t @returns {string} [연계] ← 검증 전부 */
function norm(t) { return String(t || '').normalize('NFKC'); }
/** 정규화 + 공백·제로폭 문자 제거(금지어·안전 단정·이름 대조용). 예: '순​ 찰' → '순찰'. @param {string} t @returns {string} [연계] ← validateOverview */
function compact(t) { return norm(t).replace(/[\s​-‍⁠﻿­]/g, ''); }
/** 글에서 숫자를 뽑아 표준 꼴로(앞자리 0·끝 0 무시). 예: '06:12, 1.80배, 232-2' → ['6','12','1.8','232','2']. @param {string} t @returns {string[]} [연계] ← 시험 */
function numbers(t) { return (norm(t).match(/\d+(?:\.\d+)?/g) || []).map((x) => String(Number(x))); }
/**
 * 숫자를 단위·범위째 묶어 뽑는다(B1). 열쇠 꼴: 'n|단위'(단위 없으면 'n|') · 범위 'a~b|단위' · 시각 'h:mm|:'.
 * 예: '15~18시 파고 2.4m·풍속 13m/s, 06:12' → ['15~18|시','2.4|m','13|m/s','6:12|:'] · '232-2해구' → ['232~2|해구']
 * @param {string} t @returns {object[]} [{key,text,range,ends:[열쇠…]}] [연계] ← stationInput(허용 목록)·validateOverview(대조)
 */
function numTokens(t) {
    const out = [];
    for (const m of norm(t).matchAll(NUM_RE)) {
        if (m[1] !== undefined) { out.push({ key: Number(m[1]) + ':' + m[2] + '|:', text: m[0], range: false, ends: [] }); continue; }
        const a = String(Number(m[3])), u1 = m[4] || '';
        if (m[5] === undefined) { out.push({ key: a + '|' + u1, text: m[0].trim(), range: false, unit: u1, ends: [] }); continue; }
        const b = String(Number(m[5])), u = m[6] || u1;
        out.push({ key: a + '~' + b + '|' + u, text: m[0].trim(), range: true, unit: u, ends: [a + '|' + u, b + '|' + u] });
    }
    return out;
}
/** 허용 숫자 열쇠를 사람이 읽는 꼴로. 예: '15~18|시' → '15~18시' · '6:12|:' → '6:12' · '52|' → '52'. @param {string} k @returns {string} [연계] ← stationInput(AI 입력 allowed_numbers) */
function showNum(k) { const [n, u] = k.split('|'); return u === ':' ? n : n + u; }
/** 문장으로 나눈다(마침표·물음표·느낌표 뒤 공백, 「다.」 끝). 예: 'A입니다. B입니다.' → 2. @param {string} t @returns {string[]} [연계] ← validateOverview */
function sentences(t) { return norm(t).split(/(?<=[.!?。])\s+/).map((x) => x.trim()).filter(Boolean); }
/**
 * 글에서 지명 후보를 뽑는다(B5). 낱말(조사 떼고)이 지명 접미사로 끝나면 후보, 접미사만 있는 낱말(「앞바다」)·띄어 쓴 지명(「제주도 서부 앞바다」)은
 * 앞 낱말 한두 개를 붙여 본다(공백으로만 떨어진 이름다운 낱말일 때). 한 글자 접미사: 항은 앞 1글자 이상, 섬·곶·포·도는 2글자 이상, 만은 뒤에 장소 말(에서·앞·해역…)이 올 때만,
 * 도는 조사가 더 붙었거나(「흑산도는」) 다음 낱말이 장소 말일 때만(「바람도 셉니다」의 조사 도와 가른다).
 * 예: '차귀도 앞 갯바위' → [{cands:['차귀도']}] · '제주도 동부 앞바다' → [{cands:['동부앞바다','제주도동부앞바다']}] · '정도·운항·오늘만·바람도 셉니다' → []
 * @param {string} t @returns {object[]} [{text, cands:[공백 없는 후보…]}] [연계] ← validateOverview
 */
function placeCandidates(t) {
    const src = norm(t), words = [...src.matchAll(/[가-힣A-Za-z0-9]+/g)].map((m) => ({ w: m[0], i: m.index, end: m.index + m[0].length })), out = [];
    const nameish = (x) => x && !/\d/.test(x.w) && !STOP_WORD.has(x.w) && !PARTICLE_END.test(x.w);
    words.forEach((x, k) => {
        let w = x.w, tail = '';
        for (let n = 0; n < 2 && !PLACE_SUFFIX.some((sf) => w.endsWith(sf)); n++) { const m = w.match(PLACE_TAIL_RE); if (!m || m[0].length >= w.length) break; tail = m[0] + tail; w = w.slice(0, -m[0].length); }
        if (/[도만]$/.test(w) && PLACE_SUFFIX.some((sf) => w.slice(0, -1).endsWith(sf))) { tail = w.slice(-1) + tail; w = w.slice(0, -1); }   // 「금능해수욕장도」·「한림항만」 — 조사 도·만
        const sf = PLACE_SUFFIX.find((s) => w.endsWith(s)); if (!sf) return;
        const pre = w.slice(0, -sf.length);
        if (pre && /^[\d-]+$/.test(pre)) return;          // 「232-2해구」 — 숫자는 숫자 검사가 본다
        if (NOT_PLACE.has(w) || /(?:정도|속도|온도|파도)$/.test(w)) return;
        if (sf === '항' && pre.length < 1) return;
        if (['섬', '곶', '포', '도', '만'].includes(sf) && pre.length < 2) return;
        const next = words[k + 1] && /^\s+$/.test(src.slice(x.end, words[k + 1].i)) ? words[k + 1].w : '';
        if (sf === '만' && !MAN_CONTEXT.test(tail) && !NEXT_CONTEXT.test(next)) return;
        // 「바람도 셉니다」의 도는 조사 — 뒤에 조사(는·에·의…)가 붙었거나(「흑산도는」) 다음 낱말이 장소 말(앞·해역·북방…)일 때만 지명 후보.
        if (sf === '도' && !tail && !NEXT_CONTEXT.test(next)) return;
        const prev = (j) => { const a = words[j], b = words[j + 1]; return a && b && /^\s+$/.test(src.slice(a.end, b.i)) && nameish(a) ? a.w : null; };
        const p1 = prev(k - 1), p2 = p1 ? prev(k - 2) : null;
        if (!pre && !p1) return;                           // 「앞바다」·「방파제」만 — 일반 낱말
        const cands = [w]; if (p1) cands.push(p1 + w); if (p2) cands.push(p2 + p1 + w);
        out.push({ text: (p2 ? p2 + ' ' : '') + (p1 ? p1 + ' ' : '') + w, cands: pre ? cands : cands.slice(1) });
    });
    return out;
}

/**
 * 브리핑 하나에서 AI 에게 보낼 관할 입력을 만든다(부록 A — 관할 배열의 한 칸). 총평에 올릴 것만 넣는다:
 * 해상은 overviewTop(기상·혼잡 근거가 겹친 해역 — §11.6-17①), 육상은 오늘 바뀐 요소가 있는 곳(overviewTop) + 상시 위험 장소 이름.
 * 허용 숫자 = 서버가 만든 사실 문장들(+ 틀 총평) 안의 「숫자+단위」, 허용 지명 = 관할·해역·구역·관광지 이름(+ 이름 줄기: 파출소 이름에서 「파출소」를 뗀 것 등 — 정확히 같을 때만).
 * 단계(levels)는 문단별(sea·land) — 이름 없는 문장의 단계는 그 문단 최저 단계까지(B4). 배수는 문단별(B3 — 해상 = 해제 칸 1.2·1.3, 육상 = 사람 배수).
 * 예: stationInput(한림 브리핑) → {id:'제주해양경찰서|한림파출소', sea:{level:'주의 필요',top:[…]}, land:{…}, allowed_numbers:['15~18시','2.4m',…], allowed_places:[…], levels:{sea:{…},land:{…}}}
 * @param {object} b - rules.buildBriefing 결과 @returns {object} [연계] ← batchInput·validateOverview / hash 의 대상
 */
function stationInput(b) {
    const sea = b.sea, land = b.land, facts = [], places = new Set([b.station.name, b.station.office, b.station.region].filter(Boolean)), levels = { sea: {}, land: {} }, mult = { sea: new Set(), land: new Set() };
    levels.sea[b.station.name] = sea.overviewLevel.rank; if (land) levels.land[b.station.name] = land.level.rank;
    const seaTop = sea.overviewTop.map((c) => {
        const ev = [c.overview.window + ' ' + c.overview.label, ...c.today.lines.slice(0, 4), c.traits.text];
        facts.push(c.name, ...ev); places.add(c.name); if (c.nameBase) places.add(c.nameBase); if (c.traits.zone?.name) places.add(c.traits.zone.name);
        levels.sea[c.name] = c.overview.rank; if (c.nameBase) levels.sea[c.nameBase] = Math.max(levels.sea[c.nameBase] || 0, c.overview.rank);
        return { name: c.name, level: c.overview.word, window: c.overview.window, evidence: ev };
    });
    const timeline = sea.timeBar.filter((s) => s.rank > 0 || s.events.length).map((s) => ({ at: s.label, level: s.word, events: s.events.map((e) => e.text) }));
    timeline.forEach((s) => facts.push(s.at, ...s.events));
    const special = b.special.map((x) => { facts.push(x.title, ...x.lines); places.add(x.zone); return [x.title, ...x.lines].join(' '); });
    if (b.special.some((x) => x.kind === 'release' || x.kind === 'released')) for (const k of ['1.2|배', '1.3|배', '1.2~1.3|배']) mult.sea.add(k);
    if (sea.weather) facts.push(sea.weather.text);
    const missSea = sea.missing.map((k) => R.SOURCE_LABEL[k] || k);
    const seaPart = { level: sea.overviewLevel.word, reviewed_cells: sea.reviewedCells, attention_regions: sea.attentionRegions, weather: sea.weather ? sea.weather.text : null, top: seaTop, timeline, missing_sources: [...new Set(missSea)] };
    let landPart = null, missLand = [];
    if (land) {
        // source = 단계 출처 꼬리표(결정 2 — 「연안 위험지수 72 '높음'」·「풍랑주의보」): 사실 목록에 넣어 그 숫자·따옴표 단계 이름을 AI 가 옮겨도 통과하게 한다.
        const top = land.overviewTop.map((c) => { facts.push(c.name, ...c.today.changes, c.traits.text, c.sourceLabel || ''); places.add(c.name); levels.land[c.name] = c.rank; for (const t of numTokens(c.today.changes.join(' '))) if (t.unit === '배') mult.land.add(t.key); return { name: c.name, level: c.word, source: c.sourceLabel || null, changes: c.today.changes, traits: c.traits.text }; });
        const constant = land.constant.slice(0, 5).map((c) => { places.add(c.name); facts.push(c.name, c.text || ''); return c.name; });
        missLand = [...new Set(land.missing.map((k) => R.SOURCE_LABEL[k] || k))];
        landPart = { level: land.level.word, reviewed_spots: land.reviewedSpots, changed_spots: land.cards.length, top, constant, missing_sources: missLand };
    }
    const tide = b.tide ? b.tide.text : [];
    facts.push(...tide);
    // 틀 총평 문장(서버가 서버 값만으로 만든 것)도 사실로 넣는다 — 「관할 안 52칸」·「관심 이상 3개 해역」·「관광지 4곳」 같은 숫자+단위 꼴이 허용 목록에 들어간다.
    const tpl = R.templateOverview(b); facts.push(tpl.sea, tpl.land || '');
    facts.push(R.md(b.targetDate)); if (b.generatedAt) facts.push(R.md(b.generatedAt.slice(0, 10)));
    const labels = new Set(); for (const f of facts) for (const m of norm(f).matchAll(LABEL_RE)) labels.add(m[0]);
    const nums = new Set(); for (const f of facts) for (const t of numTokens(f)) { nums.add(t.key); t.ends.forEach((k) => nums.add(k)); }
    // 이름 줄기(정확히 같을 때만 허용): 파출소·해양경찰서 이름에서 꼬리를 뗀 것(「한림」·「제주」), 특보구역에서 방위·바다 꼬리를 뗀 것(「제주도」).
    const stems = new Set([b.station.name.replace(/(?:파출소|출장소)$/, ''), String(b.station.office || '').replace(/해양경찰서$/, '')].filter((x) => x.length >= 2));
    for (const pl of places) { const m = String(pl).match(/^(.+?)(?:북부|남부|동부|서부|중부|북동|북서|남동|남서)?(?:앞바다|먼바다|연안바다|평수구역)/); if (m && m[1].length >= 2) stems.add(m[1]); }
    // 띄어 쓴 허용 이름의 앞 낱말들(「비응항 방파제」 → 「비응항」) — 낱말 단위라 「림항」 같은 조각은 들어가지 않는다.
    for (const pl of places) { const ws = String(pl).split(/\s+/); for (let i = 1; i < ws.length; i++) stems.add(ws.slice(0, i).join('')); }
    return {
        id: b.key, name: b.station.name, office: b.station.office, date: b.targetDate, day_word: R.dayWordOf(b),
        sea: seaPart, land: landPart, special, tide,
        allowed_numbers: [...nums].sort().map(showNum), allowed_number_keys: [...nums].sort(),
        allowed_places: [...places].filter(Boolean).sort(), place_stems: [...stems].sort(), levels,
        allowed_multipliers: { sea: [...mult.sea].sort().map(showNum), land: [...mult.land].sort().map(showNum) }, allowed_multiplier_keys: { sea: [...mult.sea].sort(), land: [...mult.land].sort() },
        allowed_labels: [...labels].sort(), fact_sentences: [...new Set([...tide, ...b.special.flatMap((x) => x.lines)])],
        required: { sea: sea.overviewTop[0] ? (sea.overviewTop[0].nameBase || sea.overviewTop[0].name) : null, land: land?.overviewTop[0]?.name || null, missing: { sea: seaPart.missing_sources, land: missLand } },
    };
}
/**
 * 여러 관할을 한 번에 보낼 묶음을 만든다(부록 A schema). kma_outlook = 기상청 해상 기상 전망(단기 통보문) 원문 발췌 — 원인·흐름 이해용이며
 * 그 안의 숫자·지명은 총평에 쓰지 않는다(허용 목록에 넣지 않는다).
 * 예: batchInput([한림, 애월], kma) → {schema:'station-briefing-input-v2', stations:[2], kma_outlook:{…}, rules:{…}}
 * @param {object[]} inputs - stationInput 결과들 @param {object|null} kma - {title,publishTime,forecastPeriod,excerpt:{해상,강풍,너울,바다안개}}
 * @returns {object} [연계] ← generate / → buildPrompt
 */
function batchInput(inputs, kma) {
    // AI 에게는 사람이 읽는 꼴만 보낸다(대조용 열쇠·사실 문장 목록은 서버 검증에만 쓴다).
    const strip = (si) => { const { allowed_number_keys: _a, allowed_multiplier_keys: _b, fact_sentences: _c, ...rest } = si; return rest; };
    return {
        schema: SCHEMA, stations: inputs.map(strip), kma_outlook: kma || null,
        rules: { sentences_per_paragraph: [MIN_S, MAX_S], forbidden: FORBIDDEN.concat(['안전합니다', '이상 없음', '문제없음', "해상 '사고 N배'", '한글 수사(세 시·두 척 등)', 'HTML·링크']), level_words: ['관심 필요', '주의 필요', '경계 필요'] },
    };
}
/** AI 지시문 + 묶음 JSON. 예: buildPrompt(batch) → '너는 …\n\n{"schema":…}'. @param {object} batch @returns {string} [연계] ← generate */
function buildPrompt(batch) {
    return [
        '너는 해양 안전 「활동지점 안전 브리핑」의 총평만 쓰는 작성자다. 아래 JSON 의 stations 마다 육상 한 문단(land)과 해상 한 문단(sea)을 쓴다.',
        '각 문단은 3~5문장. 단순 나열이 아니라 원인과 시간 흐름을 엮는다(예: 「오전에는 바람이 약하지만 15시부터 파고가 높아져 …」). 마지막 문장은 「따라서 … 에 관심/주의/경계가 필요합니다」 꼴.',
        '규칙(어기면 그 관할 글은 버려진다):',
        '1) 숫자는 단위까지 그 관할의 allowed_numbers 에 있는 꼴로만 쓴다(예: 「2.4m」·「15~18시」·「06:12」). 새 숫자·비율·범위를 만들지 않는다. 숫자는 아라비아 숫자로만 — 한글 수사(세 시·두 척·서른 미터)는 쓰지 않는다.',
        '2) 지명(항·포구·해수욕장·앞바다·해구·섬·갯바위·파출소 등)은 allowed_places 이름(또는 place_stems)을 그대로만 쓴다.',
        '3) 단계 말(관심·주의·경계 + 필요·요구·단계·하십시오 등 모든 꼴)은 levels.sea(해상 문단)·levels.land(육상 문단)에 적힌 그 대상의 단계보다 높이지 않는다. 단계 말이 있는 문장에는 대상 이름을 함께 쓴다 — 이름이 없으면 그 문단의 가장 낮은 단계까지만. 따옴표로 쓰는 공식 단계 이름(\'주의\' 등)은 allowed_labels 에 있는 것만.',
        '4) 해상 문단에는 required.sea, 육상 문단에는 required.land 이름을 반드시 넣는다(null 이면 생략). required.missing.sea·land 에 적힌 자료 이름(확인하지 못한 자료)은 그 문단 첫머리에 「…자료를 확인하지 못했다」고 밝힌다 — 그때는 「평소 수준」·「없습니다」로 단정하지 않는다.',
        '5) 쓰지 않는 말: 순찰·배치·출동·단속·통제·투입·경비정·검문·근무(직무 지시), 「안전합니다」·「이상 없음」·「문제없음」·「위험 요소가 없습니다」(안전 단정), 「사고 확률」. 배수(N배)는 allowed_multipliers.sea(해상)·land(육상)에 있는 것만 — 해상의 「사고 N배」·「두 배」는 쓰지 않는다. 지시(「~하라」)가 아니라 「~에 관심/주의/경계가 필요합니다」.',
        '6) land 가 null 인 관할(해상만 제공)은 land 를 null 로 둔다.',
        '7) kma_outlook 은 기상청 해상 기상 전망 원문 발췌다 — 원인(저기압·바람 방향 등)과 흐름을 이해하는 데만 쓰고, 그 안의 숫자·지명은 옮기지 않는다.',
        '8) 입력에 없는 사실을 지어내지 않는다. 글은 평문만 — HTML 태그·링크(URL)·마크다운을 쓰지 않는다.',
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
 * 관할 하나의 총평을 입력과 대조한다(부록 A 검증 순서 + 독립 검토 B1~B6·B13). 하나라도 어기면 ok:false 와 이유 목록. 모든 대조는 NFKC 정규화한 글로.
 *   모양(문단·문장 수 3~5, 해상만 관할은 land 없음) · HTML·링크 금지 · 숫자(「숫자+단위」·범위째 allowed_number_keys) · 한글 수사 금지
 *   · N배(문단별 allowed_multiplier_keys — 해상 「사고 N배」·「두 배」 금지) · 지명(allowed_places 가 후보 끝에 오거나 place_stems 와 같을 때만)
 *   · 단계 말(모든 서술 꼴 — 문장 속 대상의 문단별 단계를 넘으면 실패, 대상 없는 문장은 문단 최저 단계까지, 「관심」은 늘 허용, 서버 사실 문장 그대로는 제외)
 *   · 필수 포함(required — 첫 해역·첫 장소·빠진 자료 이름) · 금지어(공백·제로폭 무시) · 안전 단정
 * 예: validateOverview({land:null, sea:'…한림항 순찰…'}, si) → {ok:false, errors:['forbidden:순찰']}
 * @param {object} o - {land,sea} @param {object} si - stationInput @returns {object} {ok,errors}
 * [연계] ← generate · 시험(틀 총평도 이 검사를 통과해야 한다)
 */
function validateOverview(o, si) {
    const errors = [], allowedN = new Set(si.allowed_number_keys || []), mk = si.allowed_multiplier_keys || { sea: [], land: [] };
    const names = (si.allowed_places || []).map(compact).filter((x) => x.length >= 2), stems = new Set((si.place_stems || []).map(compact));
    const factS = (si.fact_sentences || []).map(compact).filter(Boolean);
    const paras = [['sea', o?.sea], ['land', o?.land]];
    if (!si.land && o?.land) errors.push('shape:land-not-allowed');
    if (si.land && !o?.land) errors.push('shape:land-missing');
    if (!o?.sea) errors.push('shape:sea-missing');
    for (const [k, raw] of paras) {
        if (!raw) continue;
        const t = norm(raw), c = compact(raw), ss = sentences(t);
        if (ss.length < MIN_S || ss.length > MAX_S) errors.push('shape:' + k + '-sentences-' + ss.length);
        if (/[<>]|https?:|www\.|javascript:|&[a-z]+;|\]\(/i.test(t)) errors.push('markup');
        const multSet = new Set(mk[k] || []);
        for (const n of numTokens(t)) {
            if (n.unit === '배') { if (!multSet.has(n.key)) errors.push('multiplier:' + n.text); continue; }
            if (!allowedN.has(n.key)) errors.push('number:' + n.text);
        }
        for (const m of t.matchAll(HNUM_RE)) errors.push('number:hangul:' + m[1].replace(/\s+/g, ' '));
        for (const m of t.matchAll(HMULT_RE)) errors.push('multiplier:' + m[1].replace(/\s+/g, ' '));
        for (const pc of placeCandidates(t)) if (!pc.cands.some((x) => stems.has(x) || names.some((a) => x.endsWith(a)))) errors.push('place:' + pc.cands[pc.cands.length - 1]);
        for (const w of FORBIDDEN) if (c.includes(compact(w))) errors.push('forbidden:' + w);
        for (const lm of t.matchAll(LABEL_RE)) if (!(si.allowed_labels || []).includes(lm[0])) errors.push('label:' + lm[0]);
        if (SAFE_RE.test(c)) errors.push('forbidden:안전 단정');
        const lv = (si.levels && si.levels[k]) || {}, floor = Math.min(...Object.values(lv), 3);
        for (const s of ss) {
            const cs = compact(s);
            if (cs.length >= 12 && factS.some((f) => f.includes(cs))) continue;   // 서버 사실 문장(조석·해제 안내)을 그대로 옮긴 것
            const named = Object.entries(lv).filter(([name]) => cs.includes(compact(name))).map(([, r]) => r);
            const cap = Math.max(1, named.length ? Math.max(...named) : floor);
            for (const lm of s.matchAll(LEVEL_RE)) if (LEVEL_RANK[lm[1]] > cap) errors.push('level:' + lm[1] + '>' + cap);
        }
        for (const miss of (si.required?.missing?.[k] || [])) if (!c.includes(compact(miss))) errors.push('required:missing:' + miss);
    }
    if (si.required?.sea && o?.sea && !compact(o.sea).includes(compact(si.required.sea))) errors.push('required:sea');
    if (si.required?.land && o?.land && !compact(o.land).includes(compact(si.required.land))) errors.push('required:land');
    return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

/** 묶음 단위대로 나눈다. 예: unit 'office' → 해양경찰서마다 한 묶음(21개). @param {object[]} items @param {string} unit - station|office|region @returns {object[][]} [연계] ← generate */
function groupBy(items, unit) {
    const m = new Map();
    for (const it of items) { const k = unit === 'station' ? it.b.key : unit === 'region' ? (it.b.station.region || it.b.station.office) : it.b.station.office; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
    return [...m.values()];
}
// 호출 시간 제한 기본값(B7) — VM 은 codex_bridge 자체 300초 뒤 조금 더, Gemini 는 어댑터 90초 뒤 조금 더(어댑터가 먼저 끊는다). VM 이 이 횟수만큼 잇달아 실패하면 그 실행 동안 VM 을 건너뛴다.
const DEFAULT_TIMEOUTS = Object.freeze({ vm: 320000, gemini: 100000 }), VM_FAIL_LIMIT = 3;
/**
 * 관할 브리핑들의 총평을 만든다(AI 또는 틀). 재사용 → 묶음 호출(VM→Gemini) → 관할별 검증 → 실패 관할만 1회 재시도 → 틀.
 * 재사용(B10): 해시 = 관할 입력 + 규칙·검증·지시문 판 + 방식 + 모델(ChatGPT·Gemini 둘 다 — VM 이 꺼지면 Gemini 로 가므로) + 기상청 전망.
 *   같은 해시라도 지난 글의 출처가 고른 방식의 첫 공급자가 아니면(ChatGPT 방식인데 Gemini 가 쓴 글) VM 이 지금 살아 있으면 다시 만든다.
 * 시간(B7): 호출마다 시간 제한(timeouts, signal 로 끊기 요청 + Promise.race) · 실행 데드라인(deadline — timer 로 잼, 넘으면 남은 관할은 틀) · VM 연속 실패 차단기(vmFailLimit).
 * 예: await generate({briefings:[…97], config:{method:'chatgpt',chatgptModel:'gpt-6-luna',geminiModel:'gemini-2.5-flash',batchUnit:'office',onlyChanged:true}, previous, adapters, kma})
 *     → {overviews:{key:{land,sea,source:'chatgpt'|'gemini'|'template',model,hash,reused?}}, stats:{calls,reused,ai,template,retried,deadline}, errors:[…]}
 * @param {object} o - briefings·config·previous(key→지난 브리핑)·adapters{vm,gemini}·kma·now·timer·deadline·timeouts·vmFailLimit
 * @returns {Promise<object>} [연계] ← station_briefing.run / → stationInput·batchInput·buildPrompt·parseResponse·validateOverview
 */
async function generate({ briefings, config, previous = {}, adapters = {}, kma = null, now = Date.now(), timer = Date.now, deadline = Infinity, timeouts = DEFAULT_TIMEOUTS, vmFailLimit = VM_FAIL_LIMIT }) {
    const method = config.method || 'template', overviews = {}, errors = [], stats = { calls: 0, reused: 0, ai: 0, template: 0, retried: 0, deadline: 0 };
    const at = R.isoKst(now), preferred = method === 'chatgpt' ? 'chatgpt' : 'gemini';
    const up = (a) => !!a && (typeof a.available !== 'function' || a.available());
    let vmFails = 0, vmBroken = false;
    const vmUp = method === 'chatgpt' && up(adapters.vm);
    const items = briefings.map((b) => { const si = stationInput(b); return { b, si, hash: R.hash({ si, rules: R.RULES_VERSION, validator: VALIDATOR_VERSION, prompt: PROMPT_VERSION, method, chatgptModel: method === 'chatgpt' ? config.chatgptModel : null, geminiModel: method !== 'template' ? config.geminiModel : null, kma: kma ? R.hash(kma) : null }) }; });
    const template = (it) => { overviews[it.b.key] = { land: it.b.overview.land, sea: it.b.overview.sea, source: 'template', model: null, hash: it.hash }; stats.template++; };
    const pending = [];
    for (const it of items) {
        const prev = previous[it.b.key]?.overview;
        if (method === 'template') { template(it); continue; }
        const sameSource = prev && (prev.source === preferred || (prev.source === 'gemini' && method === 'chatgpt' && !vmUp));
        if (config.onlyChanged !== false && prev && prev.hash === it.hash && sameSource) { overviews[it.b.key] = { ...prev, reused: true }; stats.reused++; continue; }
        pending.push(it);
    }
    const chain = method === 'chatgpt' ? ['vm', 'gemini'] : ['gemini'];
    /** 한 묶음을 사슬(VM → Gemini) 순서로 보낸다 — 앞이 꺼져 있거나 실패·시간초과·해석 실패면 다음. 데드라인이 지났으면 부르지 않는다. @returns {Promise<object|null>} {provider,model,map} */
    async function callChain(group) {
        const prompt = buildPrompt(batchInput(group.map((it) => it.si), kma)), keys = group.map((it) => it.b.key);
        for (const p of chain) {
            const a = adapters[p];
            if (p === 'vm' && vmBroken) { errors.push({ at, stage: 'call', provider: p, stations: keys, reason: 'VM 연속 실패 ' + vmFails + '회 — 이번 실행은 건너뜀' }); continue; }
            if (!up(a)) { errors.push({ at, stage: 'call', provider: p, stations: keys, reason: p === 'vm' ? 'VM 작업자 연결 없음' : '사용 불가' }); continue; }
            const left = deadline - timer();
            if (left <= 0) return null;
            const model = p === 'vm' ? config.chatgptModel : config.geminiModel, ms = Math.max(1, Math.min(timeouts[p] || DEFAULT_TIMEOUTS.gemini, left)), ac = new AbortController();
            let tid = null;
            try {
                stats.calls++;
                const text = await Promise.race([a.call({ prompt, model, signal: ac.signal }), new Promise((_, rej) => { tid = setTimeout(() => { ac.abort(); rej(new Error(p + ' 시간초과(' + Math.round(ms / 1000) + '초)')); }, ms); })]);
                const map = parseResponse(text);
                if (p === 'vm') vmFails = 0;
                return { provider: p === 'vm' ? 'chatgpt' : 'gemini', model, map };
            } catch (e) {
                errors.push({ at, stage: e.message === 'invalid response' || e instanceof SyntaxError ? 'parse' : 'call', provider: p, stations: keys, reason: String(e.message || e).slice(0, 120) });
                if (p === 'vm' && ++vmFails >= vmFailLimit) vmBroken = true;
            } finally { clearTimeout(tid); }
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
    const past = () => timer() >= deadline;
    const groups = groupBy(pending, config.batchUnit || 'office');
    for (let gi = 0; gi < groups.length; gi++) {
        if (past()) { const rest = groups.slice(gi).flat(); errors.push({ at, stage: 'deadline', provider: null, stations: rest.map((it) => it.b.key), reason: '실행 데드라인 넘음 — 남은 ' + rest.length + '곳은 틀 총평' }); for (const it of rest) template(it); stats.deadline += rest.length; break; }
        const group = groups[gi];
        const failed = accept(group, await callChain(group));
        if (!failed.length) continue;
        if (past()) { for (const it of failed) template(it); stats.deadline += failed.length; continue; }
        stats.retried += failed.length;
        const again = accept(failed, await callChain(failed));
        for (const it of again) template(it);
    }
    return { overviews, stats, errors };
}

module.exports = { SCHEMA, VALIDATOR_VERSION, PROMPT_VERSION, FORBIDDEN, DEFAULT_TIMEOUTS, VM_FAIL_LIMIT, stationInput, batchInput, buildPrompt, parseResponse, validateOverview, generate, numbers, numTokens, placeCandidates, sentences, groupBy, norm, compact };
