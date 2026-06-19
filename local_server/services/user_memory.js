/**
 * 사용자 기억 v2 — E_server 통합 모듈 (services/user_memory.js)
 *
 * [범위]
 *   A3 압축 두뇌 (consolidateMemory)
 *   A4 회수 두뇌 (retrieveMemory) — 4단 점수
 *   A5 연관성 가드 (filterRelevance) — L1×L2×L3(×L4) 곱셈 게이트
 *   buildMemoryPromptSection (assistant.js 통합용 prompt 텍스트 빌더)
 *
 * [원칙]
 *   - 모든 공개 함수는 throw 금지. 실패 시 null/[]/'' + console.warn 만 남기고 조용히 실패.
 *   - silent fallback: A4 실패 시 retrievedHints = {} → assistant.js 가 평소처럼 동작.
 *   - 외부 라이브러리 의존성 X. 내부 의존: services/topic_embedding.js (cosine·embedQuery).
 *   - LLM 호출은 Phase 0 stub (TODO 주석). 다음 라운드에서 gemini.callGemini 와 결합.
 *   - 본 라운드: 구조만 완성. 실제 DB I/O · LLM 콜 모두 호출자에 위임 (의존성 주입).
 *
 * [공개 함수]
 *   consolidateMemory(newEpisode, existing, opts)             → A3
 *   retrieveMemory(query, queryCtx, memorySnapshot, opts)     → A4 (+ A5 게이트 내장 호출)
 *   filterRelevance(query, queryCtx, candidates, hotTopics)   → A5
 *   buildMemoryPromptSection(retrievedHints)                  → prompt 섹션 빌더
 *
 * [통합 위치 — 다음 라운드]
 *   routes/assistant.js runBrain → A4 호출(planQuery 직전 또는 병렬) → A5 → planQuery 힌트 주입.
 *   res.json(answer) 직후 → queueMicrotask(() => consolidateMemory(...)) 비동기 압축.
 */
'use strict';

// ----------------------------------------------------------------------------
// 의존성 — 표준 라이브러리 + topic_embedding (재사용)
// ----------------------------------------------------------------------------
// topic_embedding 은 cosine/embedQuery 만 빌리고, 임베딩 DB 신규 인덱스는 stub 만.
let topicEmbedding = null;
try {
    topicEmbedding = require('./topic_embedding');
} catch (e) {
    // topic_embedding 미준비 → 임베딩 단계는 silent skip.
    topicEmbedding = null;
}

// ----------------------------------------------------------------------------
// 상수 — 임계·가중치·캡 (설계 문서 §2 ~ §4 와 정합)
// ----------------------------------------------------------------------------
const A4_K_DEFAULT = 4;             // 회수 상위 K (일반); 모니터 직군은 5
const A4_K_MONITOR = 5;
const A4_EMBED_MIN = 0.55;          // A4 회수 후보 채택 임계 (topic_embedding 와 정렬)
const A4_TOPK_PER_TOPIC = 2;        // 다양성 — 같은 topicKey 상위 2 항목 제한
const A4_OVERALL_TIMEOUT_MS = 800;  // 전체 회수 타임아웃
const A4_EMBED_TIMEOUT_MS = 600;    // 임베딩 단계 단독 타임아웃

const A5_SIM_MIN = 0.65;            // A5 게이트 임베딩 임계 (회수 임계 +0.10)
const A5_SIM_FLOOR_WITH_SURFACE = 0.55; // 표면 토큰 일치 시 floor
const A5_PASS_THRESHOLD = 0.50;     // score ≥ 0.50 → PASS
const A5_TOP_N = 2;                 // 답변 주입 최대 개수

const STYLE_NOTE_MAX_LEN = 60;

const RECENCY_BOOST = { hot: 1.2, mid: 1.0, cold: 0.8 };
const RECENCY_HOT_DAYS = 7;
const RECENCY_MID_DAYS = 30;

// L3 의도 양립 매트릭스 — 행: 회수 항목 expected_intent · 열: 질의 intent.
// admin_or_sec 와 off_domain 행/열은 모두 0 (이중 안전망).
const L3_MATRIX = {
    weather_check:   { weather_check: 1.0, safety_decision: 0.9, info_lookup: 0.6, meta_summary: 0.4, hypothetical: 0.3, admin_or_sec: 0.0, off_domain: 0.0 },
    safety_decision: { weather_check: 0.9, safety_decision: 1.0, info_lookup: 0.5, meta_summary: 0.4, hypothetical: 0.3, admin_or_sec: 0.0, off_domain: 0.0 },
    info_lookup:     { weather_check: 0.6, safety_decision: 0.5, info_lookup: 1.0, meta_summary: 0.5, hypothetical: 0.3, admin_or_sec: 0.0, off_domain: 0.0 },
    meta_summary:    { weather_check: 0.3, safety_decision: 0.3, info_lookup: 0.3, meta_summary: 1.0, hypothetical: 0.2, admin_or_sec: 0.0, off_domain: 0.0 },
    meta_any:        { weather_check: 0.3, safety_decision: 0.3, info_lookup: 0.3, meta_summary: 1.0, hypothetical: 0.2, admin_or_sec: 0.0, off_domain: 0.0 },
    hypothetical:    { weather_check: 0.3, safety_decision: 0.3, info_lookup: 0.3, meta_summary: 0.2, hypothetical: 0.8, admin_or_sec: 0.0, off_domain: 0.0 }
};

// L4 — 사용자 명시 거부 패턴 ("내 취향 무시", "일반적으로 답해" 류)
const USER_OVERRIDE_RE = /(취향|선호|관심사|내정보|개인).{0,6}(무시|빼고|제외|상관없이)|일반(적|인)?(으로|인)?\s*답/;
// 메타 의도 (직전 대화 회상/요약)
const META_RE = /방금|아까|이전|직전|뭐.*(물었|답했)|요약|정리해/;

// ----------------------------------------------------------------------------
// 내부 유틸 — 안전 접근·시간·점수 (throw 안 함)
// ----------------------------------------------------------------------------

/** Date 또는 ISO 문자열 또는 epoch ms 를 epoch ms 로. 실패 시 NaN. */
function _toMs(v) {
    if (v == null) return NaN;
    if (typeof v === 'number') return v;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : NaN;
}

/** 지난 며칠 (음수면 미래로 보고 0 처리). NaN 입력 → Infinity (가장 오래된 것 취급). */
function _ageDays(lastTs, now = Date.now()) {
    const t = _toMs(lastTs);
    if (!Number.isFinite(t)) return Infinity;
    const d = (now - t) / 86400000;
    return d < 0 ? 0 : d;
}

/** 시간 가중 — 설계 §2 Stage 3. */
function _recencyBoost(lastTs, now = Date.now()) {
    const d = _ageDays(lastTs, now);
    if (d <= RECENCY_HOT_DAYS) return RECENCY_BOOST.hot;
    if (d <= RECENCY_MID_DAYS) return RECENCY_BOOST.mid;
    return RECENCY_BOOST.cold;
}

/** 빈도 가중 — 설계 §2 Stage 4. cap = 1.1. */
function _freqBoost(refCount) {
    const rc = Number.isFinite(refCount) && refCount > 0 ? refCount : 0;
    if (rc === 0) return 1.0;
    const norm = Math.min(1, Math.log2(1 + rc) / Math.log2(11));
    return 1.0 + 0.1 * norm;
}

/** Promise 에 타임아웃 — 초과 시 null. */
function _withTimeout(promise, ms, label = 'op') {
    let to;
    const guard = new Promise(resolve => {
        to = setTimeout(() => {
            console.warn(`[user_memory] timeout: ${label} > ${ms}ms`);
            resolve(null);
        }, ms);
    });
    return Promise.race([
        Promise.resolve(promise).then(v => { clearTimeout(to); return v; }, e => {
            clearTimeout(to);
            console.warn(`[user_memory] error in ${label}:`, e && e.message ? e.message : e);
            return null;
        }),
        guard
    ]);
}

/** topicKey 별 항목 수를 N 까지로 컷 (다양성). */
function _limitPerTopic(items, n) {
    const seen = new Map();
    const out = [];
    for (const it of items) {
        const k = it && it.topicKey ? String(it.topicKey) : '__nokey__';
        const c = seen.get(k) || 0;
        if (c < n) { out.push(it); seen.set(k, c + 1); }
    }
    return out;
}

/** Stage 2 — 임베딩 단계. topic_embedding 미준비 → null. */
async function _embedQuerySafe(query) {
    if (!topicEmbedding || typeof topicEmbedding.isReady !== 'function') return null;
    // isReady 가 false 라도 embedQuery 는 작동 가능(질의 임베딩 단독). 단, gemini key 없으면 null.
    if (typeof topicEmbedding.embedQuery !== 'function') return null;
    try {
        return await _withTimeout(topicEmbedding.embedQuery(query), A4_EMBED_TIMEOUT_MS, 'embedQuery');
    } catch (e) {
        console.warn('[user_memory] embedQuery threw:', e && e.message ? e.message : e);
        return null;
    }
}

/** cosine 위임. topic_embedding 미로딩 시 fallback (자체 구현). */
function _cosine(a, b) {
    if (topicEmbedding && typeof topicEmbedding.cosine === 'function') {
        try { return topicEmbedding.cosine(a, b); } catch (e) { /* fallthrough */ }
    }
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    const d = Math.sqrt(na) * Math.sqrt(nb);
    return d > 0 ? dot / d : 0;
}

/** tags 교집합 크기. */
function _tagOverlap(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return 0;
    const sb = new Set(b.map(x => String(x).toLowerCase()));
    let n = 0;
    for (const t of a) if (sb.has(String(t).toLowerCase())) n++;
    return n;
}

/** 표면 토큰 매칭 — query 텍스트에 topic/tags 토큰이 노출되었는지. */
function _surfaceTokenHit(item, query) {
    const q = String(query || '').toLowerCase();
    if (!q) return false;
    const tokens = [];
    if (item.topic) tokens.push(String(item.topic));
    if (item.topicKey) tokens.push(String(item.topicKey));
    if (Array.isArray(item.tags)) for (const t of item.tags) tokens.push(String(t));
    for (const t of tokens) {
        const s = t.toLowerCase().trim();
        if (s && s.length >= 2 && q.includes(s)) return true;
    }
    return false;
}

// ----------------------------------------------------------------------------
// 의도 분류 — 설계 §3 결정론 휴리스틱 (LLM 호출 0)
// queryCtx.intent 가 이미 들어와 있으면 우선. 없으면 query/cq 로 추정.
// ----------------------------------------------------------------------------
function _classifyQueryIntent(query, queryCtx) {
    if (queryCtx && typeof queryCtx.intent === 'string' && queryCtx.intent) return queryCtx.intent;
    const cq = (queryCtx && queryCtx.cq) ? String(queryCtx.cq) : '';
    const s = (String(query || '') + ' ' + cq).toLowerCase();
    if (!s.trim()) return 'off_domain';

    // 보안 우선 — 호출자(assistant.js) 가 isSec 플래그를 queryCtx 로 전달 시 활용.
    if (queryCtx && queryCtx.isSec) return 'admin_or_sec';

    if (META_RE.test(s)) return 'meta_summary';
    if (/만약|가정|만일|~라면|~다면/.test(s)) return 'hypothetical';
    if (/(출항|조업|입수|항해|승선|어로).{0,8}(돼|되|할까|가능|안전)/.test(s)) return 'safety_decision';
    if (/(파고|풍속|풍향|시정|특보|예보|수온|조석|만조|간조|물때|유속).{0,10}(어때|어떄|어떻|얼마|있어|있나|확인|알려)/.test(s)) return 'weather_check';
    if (/(파고|풍속|풍향|시정|특보|예보|수온|조석|만조|간조|물때|유속)/.test(s)) return 'weather_check';
    if (/무엇|뭐야|뭔가요|어디|얼마|언제|누구|왜/.test(s)) return 'info_lookup';

    // 도메인 판정은 호출자가 queryCtx.isDomain 으로 전달. 미전달이면 보수적으로 info_lookup.
    if (queryCtx && queryCtx.isDomain === false) return 'off_domain';
    return 'info_lookup';
}

/** L3 점수 조회 — 매트릭스 외 키는 0.3 (보수). */
function _l3Score(qIntent, itemIntent) {
    if (!qIntent || !itemIntent) return 0.3;
    const row = L3_MATRIX[itemIntent] || L3_MATRIX.info_lookup;
    const v = row[qIntent];
    return typeof v === 'number' ? v : 0.3;
}

// ============================================================================
// (1) A3 — consolidateMemory
// ============================================================================

/**
 * 신규 episode + 기존 consolidated 상위 N → LLM 1콜로 merge/add/skip 결정.
 *
 * @param {object} newEpisode  - { id, ts, query, answer, zone, tools, intent, channel, topicHints }
 * @param {Array}  existing    - consolidated_memory 상위 N (보통 5건) [{ id, topic, zone, summary, tags, refCount, lastTs }]
 * @param {object} opts        - { gemini, brainModel, interestTopics, styleDigest, userProfile, a5Domain }
 *                                a5Domain: 'in' | 'off' | 'uncertain' — A5 가 미리 라벨링. 'off' 면 LLM 콜 스킵.
 * @returns {Promise<{action:'merge'|'add'|'skip', target_id?:number, new_summary?:string, new_topic?:string, relevance_tags?:string[], reason?:string}|null>}
 *          실패/skip 결정 시 null 또는 {action:'skip'} 반환.
 */
async function consolidateMemory(newEpisode, existing, opts) {
    if (!newEpisode || typeof newEpisode !== 'object') {
        console.warn('[user_memory.consolidate] invalid newEpisode');
        return null;
    }
    const existingList = Array.isArray(existing) ? existing : [];
    const o = opts || {};

    // A5 협업 — 비도메인 라벨이면 LLM 콜 자체 스킵 (설계 §8).
    if (o.a5Domain === 'off') {
        return { action: 'skip', reason: 'a5_off_domain' };
    }

    // 결정론 사전 분기 — 동일 zone + tag overlap ≥ 2 인 후보가 명확히 있으면 merge 힌트.
    // (LLM 이 같은 결론에 빠르게 도달하도록 컨텍스트 prep — 실제 결정은 LLM 가 함.)
    const newTags = Array.isArray(newEpisode.topicHints) ? newEpisode.topicHints : [];
    let preferredMergeId = null;
    for (const ex of existingList) {
        if (!ex || ex.zone !== newEpisode.zone) continue;
        if (_tagOverlap(newTags, ex.tags) >= 2) { preferredMergeId = ex.id; break; }
    }

    // ----------------------------------------------------------------------
    // TODO (다음 라운드): 실제 LLM 호출 — gemini.callGemini.
    //   - opts.gemini 주입 시 사용 (테스트 가능성 위해 DI).
    //   - 시스템 프롬프트는 설계 §2.2 의 한국어 버전.
    //   - response_mime_type='application/json', temperature=0, caller='Assistant-Consolidate'.
    //   - max retries 2, 429 시 backoff (gemini_client 가 내부 처리).
    //   - timeout 4초 — 실패해도 사용자 응답 영향 없음 (async).
    // ----------------------------------------------------------------------
    const gemini = o.gemini || null;
    const model = o.brainModel || 'gemini-2.5-flash-lite';
    if (!gemini || typeof gemini.callGemini !== 'function') {
        // Phase 0 stub — LLM 미주입 시 결정론 fallback (preferredMergeId 있으면 merge, 아니면 add).
        if (preferredMergeId != null) {
            return {
                action: 'merge',
                target_id: preferredMergeId,
                new_summary: String(newEpisode.query || '').slice(0, 80),
                relevance_tags: newTags.slice(0, 5),
                reason: 'stub_fallback_merge_by_tag_overlap'
            };
        }
        if (!newEpisode.zone && (!newTags || newTags.length === 0)) {
            return { action: 'skip', reason: 'stub_fallback_no_zone_no_tags' };
        }
        return {
            action: 'add',
            new_topic: newTags[0] || (newEpisode.zone ? `${newEpisode.zone} 일반` : '기타'),
            new_summary: String(newEpisode.query || '').slice(0, 80),
            relevance_tags: newTags.slice(0, 5),
            reason: 'stub_fallback_add'
        };
    }

    const prompt = _buildConsolidatePrompt(newEpisode, existingList, o, preferredMergeId);
    try {
        const r = await _withTimeout(
            gemini.callGemini({
                model,
                contents: prompt,
                config: { responseMimeType: 'application/json', temperature: 0 },
                caller: 'Assistant-Consolidate'
            }),
            4000,
            'consolidate-llm'
        );
        if (!r || !r.success || !r.text) {
            console.warn('[user_memory.consolidate] LLM no-text fallback → skip');
            return { action: 'skip', reason: 'llm_no_text' };
        }
        let parsed = null;
        try { parsed = JSON.parse(r.text); } catch (e) {
            console.warn('[user_memory.consolidate] JSON parse fail → skip');
            return { action: 'skip', reason: 'llm_parse_fail' };
        }
        if (!parsed || !parsed.action || !['merge', 'add', 'skip'].includes(parsed.action)) {
            return { action: 'skip', reason: 'llm_invalid_action' };
        }
        return parsed;
    } catch (e) {
        console.warn('[user_memory.consolidate] threw → skip:', e && e.message);
        return { action: 'skip', reason: 'exception' };
    }
}

/** A3 시스템 프롬프트 — 설계 §2.2. */
function _buildConsolidatePrompt(newEpisode, existing, opts, preferredMergeId) {
    const interestTopics = opts.interestTopics || {};
    const styleDigest = opts.styleDigest || '';
    const userProfile = opts.userProfile || {};
    const top5 = existing.slice(0, 5).map(e => ({
        id: e.id, topic: e.topic, zone: e.zone, summary: e.summary,
        refCount: e.refCount, lastTs: e.lastTs, tags: e.tags
    }));
    const hint = preferredMergeId != null
        ? `(서버 힌트: id=${preferredMergeId} 항목과 zone·tags 가 일치합니다. merge 후보)`
        : '';

    return `당신은 SEAGNAL "나리야" 의 사용자 장기기억 관리자입니다.
방금 신규 episode 가 발생했습니다. 기존 consolidated_memory (사용자 장기기억) 와 비교해,
신규 episode 가 *어디로 흡수되어야 하는지* 결정하세요. ${hint}

[원칙]
1. 같은 zone + 같은 토픽이면 기존 항목과 merge (summary 갱신, refCount++).
2. 새 zone 또는 새 토픽이면 add.
3. 일회성·단발적·비반복 가능성 높은 질의(여행 정보·인사·잡담·비도메인)는 skip.
4. 직군(어선장/낚시/해경)과 무관한 도메인은 skip 권장.
5. summary 는 80자 이내 한 줄.
6. relevance_tags 는 3~5개, 한국어 단어, 검색 회수용 키.

[입력]
신규: ${JSON.stringify(newEpisode)}
기존(상위 5건): ${JSON.stringify(top5)}
관심토픽 카운트: ${JSON.stringify(interestTopics).slice(0, 400)}
사용자 직군: ${JSON.stringify(userProfile.jikgun || null)}
말투 다이제스트: ${String(styleDigest).slice(0, 200)}

[출력 — JSON only, 다른 텍스트 금지]
{
  "action": "merge" | "add" | "skip",
  "target_id": <merge 일 때만 — 합칠 기존 항목 id>,
  "new_summary": "<merge: 합쳐진 새 summary / add: 신규 summary / skip: 생략>",
  "new_topic": "<add 일 때만 — 신규 토픽 라벨>",
  "relevance_tags": ["…"],
  "reason": "<한 줄 — 모니터링용>"
}`;
}

// ============================================================================
// (2) A4 — retrieveMemory (4단 점수)
// ============================================================================

/**
 * 4단 하이브리드 회수 — Stage1 정확 매칭 + Stage2 임베딩 + Stage3 시간 가중 + Stage4 빈도 가중.
 * 마지막에 A5 게이트 통과시켜 retrievedHints 반환.
 *
 * @param {string} query
 * @param {object} queryCtx       - { zoneKey, jikgun, topicKeys, cq, intent?, isDomain?, isSec? }
 * @param {object} memorySnapshot - { consolidated:[], interestTopics:[], styleDigest:object|string }
 *   consolidated 항목 형상: { id, summary, summaryVec?, zoneKey?, jikgun?, topicKey?, lastSeenAt|lastTs, refCount, sourceEpisodeIds?, expected_intent?, domain_tags?, topic?, tags? }
 * @param {object} opts           - { k?, jikgunMonitor?, now?, skipA5? }
 * @returns {Promise<{episodes:Array, hotTopics:Array, styleNote:string, meta?:object}>}
 *          실패/0건 시 빈 episodes/hotTopics/'' styleNote 반환. throw 안 함.
 */
async function retrieveMemory(query, queryCtx, memorySnapshot, opts) {
    const empty = { episodes: [], hotTopics: [], styleNote: '', meta: { retrieved: 0, dropped: 0, reason: 'empty' } };
    if (!query || typeof query !== 'string') return empty;
    const snap = memorySnapshot || {};
    const ctx = queryCtx || {};
    const o = opts || {};
    const t0 = Date.now();

    const items = Array.isArray(snap.consolidated) ? snap.consolidated : [];
    if (items.length === 0) {
        return Object.assign({}, empty, { meta: { retrieved: 0, dropped: 0, reason: 'no_consolidated', latencyMs: Date.now() - t0 } });
    }

    const k = Number.isFinite(o.k) && o.k > 0
        ? o.k
        : (o.jikgunMonitor ? A4_K_MONITOR : A4_K_DEFAULT);
    const now = Number.isFinite(o.now) ? o.now : Date.now();

    // ---- 전체 회수 타임아웃 가드 ----
    const work = (async () => {
        // ---- Stage 1 — 정확 매칭 (deterministic) ----
        const topicKeys = new Set(Array.isArray(ctx.topicKeys) ? ctx.topicKeys.map(String) : []);
        for (const it of items) {
            const exactZone = ctx.zoneKey && it.zoneKey && it.zoneKey === ctx.zoneKey;
            const exactJikgun = ctx.jikgun && it.jikgun && it.jikgun === ctx.jikgun;
            const exactTopic = it.topicKey && topicKeys.has(String(it.topicKey));
            it._score1 = (exactZone || exactJikgun || exactTopic) ? 1.0 : 0.0;
            it._reasonTags = [];
            if (exactZone) it._reasonTags.push('zone-exact');
            if (exactJikgun) it._reasonTags.push('jikgun-exact');
            if (exactTopic) it._reasonTags.push('topic-exact');
        }

        // ---- Stage 2 — 임베딩 유사도 ----
        const qVec = await _embedQuerySafe(query);
        for (const it of items) {
            it._score2 = 0;
            if (qVec && it.summaryVec && Array.isArray(it.summaryVec)) {
                const s = _cosine(qVec, it.summaryVec);
                it._score2 = Math.max(0, Math.min(1, s));
                if (it._score2 >= A4_EMBED_MIN) it._reasonTags.push('embed');
            }
        }

        // ---- Stage 3 — 시간 가중 / Stage 4 — 빈도 가중 ----
        for (const it of items) {
            const lastTs = it.lastSeenAt || it.lastTs;
            it._recencyBoost = _recencyBoost(lastTs, now);
            it._freqBoost = _freqBoost(it.refCount || 0);
            if (it._recencyBoost > 1.0) it._reasonTags.push('recency');
            if (it._freqBoost > 1.05) it._reasonTags.push('freq');
            it._ageDays = _ageDays(lastTs, now);
        }

        // ---- 최종 랭킹 — finalScore = max(s1, s2) × recency × freq ----
        const candidates = items
            .filter(it => it._score1 === 1.0 || it._score2 >= A4_EMBED_MIN)
            .map(it => ({
                id: it.id,
                summary: it.summary,
                score: Math.max(it._score1, it._score2) * it._recencyBoost * it._freqBoost,
                ageDays: it._ageDays,
                refCount: it.refCount || 0,
                reasonTags: it._reasonTags.slice(),
                topicKey: it.topicKey,
                topic: it.topic,
                zoneKey: it.zoneKey,
                jikgun: it.jikgun,
                expected_intent: it.expected_intent,
                domain_tags: it.domain_tags,
                tags: it.tags,
                summaryVec: it.summaryVec,
                _raw: it
            }))
            .sort((a, b) => b.score - a.score);

        // 다양성 — 같은 topicKey 상위 2.
        const diverse = _limitPerTopic(candidates, A4_TOPK_PER_TOPIC).slice(0, k);

        // ---- 핫 토픽 ----
        const interests = Array.isArray(snap.interestTopics) ? snap.interestTopics : [];
        const hotTopics = interests
            .filter(t => !ctx.jikgun || !t.jikgun || t.jikgun === ctx.jikgun)
            .slice() // copy
            .sort((a, b) => (Number(b.hotness) || 0) - (Number(a.hotness) || 0))
            .slice(0, 3)
            .map(t => ({ topicKey: t.topicKey, label: t.label, hotness: t.hotness }));

        // ---- styleNote — style_digest → 1줄 ----
        const styleNote = _styleDigestToNote(snap.styleDigest);

        return { diverse, hotTopics, styleNote, qVec };
    })();

    let result;
    try {
        result = await _withTimeout(work, A4_OVERALL_TIMEOUT_MS, 'retrieve-overall');
    } catch (e) {
        console.warn('[user_memory.retrieve] threw:', e && e.message);
        return empty;
    }
    if (!result) {
        return Object.assign({}, empty, { meta: { retrieved: 0, dropped: 0, reason: 'overall_timeout', latencyMs: Date.now() - t0 } });
    }

    let { diverse, hotTopics, styleNote, qVec } = result;

    // ---- A5 게이트 ----
    let dropped = 0;
    if (!o.skipA5) {
        let filteredCandidates;
        try {
            filteredCandidates = filterRelevance(query, Object.assign({}, ctx, { _qVec: qVec }), diverse, hotTopics);
        } catch (e) {
            console.warn('[user_memory.retrieve] A5 threw → passthrough:', e && e.message);
            filteredCandidates = { consolidated: diverse, hotTopics, dropped: [] };
        }
        dropped = (filteredCandidates && filteredCandidates.dropped) ? filteredCandidates.dropped.length : 0;
        diverse = (filteredCandidates && filteredCandidates.consolidated) ? filteredCandidates.consolidated : [];
        hotTopics = (filteredCandidates && filteredCandidates.hotTopics) ? filteredCandidates.hotTopics : hotTopics;
    }

    return {
        episodes: diverse.slice(0, A5_TOP_N),  // A5 통과 후 답변 주입 상한
        hotTopics,
        styleNote,
        meta: {
            retrieved: diverse.length,
            dropped,
            latencyMs: Date.now() - t0,
            embedReady: !!qVec
        }
    };
}

/** style_digest 객체/문자열 → 60자 이내 한 줄. */
function _styleDigestToNote(sd) {
    if (!sd) return '';
    if (typeof sd === 'string') return sd.replace(/\s+/g, ' ').trim().slice(0, STYLE_NOTE_MAX_LEN);
    try {
        const parts = [];
        if (sd.tone) parts.push(String(sd.tone));
        if (sd.length) parts.push(`길이 ${sd.length}`);
        if (sd.dialect) parts.push(String(sd.dialect));
        if (Array.isArray(sd.prefs) && sd.prefs.length) parts.push(sd.prefs.slice(0, 2).join('·'));
        return parts.join('. ').slice(0, STYLE_NOTE_MAX_LEN);
    } catch (e) { return ''; }
}

// ============================================================================
// (3) A5 — filterRelevance (L1×L2×L3×L4 곱셈 게이트)
// ============================================================================

/**
 * L1 도메인 × L2 임베딩 × L3 의도 양립 × L4 사용자 명시 거부.
 * 곱셈 게이트 — 어느 한 항이 0 이면 즉시 차단.
 *
 * @param {string} query
 * @param {object} queryCtx   - { zoneKey, jikgun, cq, intent?, isDomain?, isSec?, _qVec? }
 * @param {Array}  candidates - A4 산출물 (보통 3~5개)
 * @param {Array}  hotTopics  - 핫 토픽
 * @returns {{consolidated:Array, hotTopics:Array, dropped:Array}}
 */
function filterRelevance(query, queryCtx, candidates, hotTopics) {
    const cands = Array.isArray(candidates) ? candidates : [];
    const hots = Array.isArray(hotTopics) ? hotTopics : [];
    const ctx = queryCtx || {};
    const passResult = { consolidated: [], hotTopics: hots, dropped: [] };

    // ---- L4 — 사용자 명시 거부 ----
    const qText = String(query || '');
    if (USER_OVERRIDE_RE.test(qText)) {
        return { consolidated: [], hotTopics: [], dropped: cands.map(c => ({ id: c.id, reason: 'L4_user_override' })) };
    }

    // ---- L1 — 질의 도메인 게이트 ----
    // 호출자가 isDomain 을 명시 전달. META 의도이면 L1 = 1.0 강제.
    const intent = _classifyQueryIntent(qText, ctx);
    if (intent === 'admin_or_sec') {
        return { consolidated: [], hotTopics: [], dropped: cands.map(c => ({ id: c.id, reason: 'L3_intent_sec' })) };
    }
    const isMeta = intent === 'meta_summary';
    const L1 = isMeta ? 1.0 : (ctx.isDomain === false ? 0.0 : (ctx.isDomain === true ? 1.0 : 0.5));
    if (L1 === 0.0) {
        return { consolidated: [], hotTopics: [], dropped: cands.map(c => ({ id: c.id, reason: 'L1_domain' })) };
    }

    // ---- L2 + L3 — 항목별 ----
    const passed = [];
    for (const it of cands) {
        // L2 — 임베딩 유사도. _qVec/summaryVec 둘 다 있을 때만 측정. 없으면 score 기존값 사용.
        let l2 = 0;
        if (ctx._qVec && it.summaryVec) {
            const sim = _cosine(ctx._qVec, it.summaryVec);
            l2 = Math.max(0, Math.min(1, sim));
        } else if (typeof it.score === 'number') {
            // A4 score 는 boost 포함 — 임베딩 단일 신호로 변환하기 위해 보수적으로 clip.
            l2 = Math.min(1, it.score);
        }
        // L2 floor — 표면 토큰 매칭 시 0.55 까지 허용 (false negative 방지).
        if (l2 < A5_SIM_MIN && _surfaceTokenHit(it, qText)) {
            l2 = Math.max(l2, A5_SIM_FLOOR_WITH_SURFACE);
        }
        if (l2 < A5_SIM_MIN) {
            passResult.dropped.push({ id: it.id, reason: 'L2_sim', score: l2 });
            continue;
        }

        // L3 — 의도 양립
        const itemIntent = it.expected_intent || 'info_lookup';
        const l3 = _l3Score(intent, itemIntent);
        if (l3 === 0) {
            passResult.dropped.push({ id: it.id, reason: 'L3_intent', score: 0 });
            continue;
        }

        const score = L1 * l2 * l3;
        if (score < A5_PASS_THRESHOLD) {
            passResult.dropped.push({ id: it.id, reason: 'L3_intent', score });
            continue;
        }

        passed.push(Object.assign({}, it, { _a5score: score }));
    }

    // 정렬 후 TOP_N.
    passed.sort((a, b) => (b._a5score || 0) - (a._a5score || 0));
    passResult.consolidated = passed.slice(0, A5_TOP_N);
    return passResult;
}

// ============================================================================
// (4) buildMemoryPromptSection — assistant.js 통합 시 prompt 텍스트 빌더
// ============================================================================

/**
 * retrieveMemory 산출물 → planQuery/synth 에 주입할 한국어 prompt 섹션.
 * 0건이면 '' 반환 → 호출자는 분기 없이 빈 문자열 concat (회귀 0).
 *
 * @param {object} retrievedHints - { episodes, hotTopics, styleNote, meta? }
 * @returns {string}
 */
function buildMemoryPromptSection(retrievedHints) {
    if (!retrievedHints || typeof retrievedHints !== 'object') return '';
    const eps = Array.isArray(retrievedHints.episodes) ? retrievedHints.episodes : [];
    const hots = Array.isArray(retrievedHints.hotTopics) ? retrievedHints.hotTopics : [];
    const styleNote = String(retrievedHints.styleNote || '').trim();

    if (eps.length === 0 && hots.length === 0 && !styleNote) return '';

    const lines = [];

    // [관련 기억] — 최대 2~3줄, 줄당 60자 cap, 수치 강제 금지 명시.
    if (eps.length > 0) {
        lines.push(`[관련 기억 (사용자 DB 회수 K=${eps.length}) — 참고만, 수치는 도구 결과에서만]`);
        for (const e of eps.slice(0, 3)) {
            const tags = Array.isArray(e.reasonTags) && e.reasonTags.length ? `(${e.reasonTags.slice(0, 2).join('·')}) ` : '';
            const summary = String(e.summary || '').replace(/\s+/g, ' ').slice(0, 60);
            const age = Number.isFinite(e.ageDays) ? `${Math.round(e.ageDays)}일전` : '';
            const rc = Number.isFinite(e.refCount) ? `×${e.refCount}` : '';
            const meta = [age, rc].filter(Boolean).join('·');
            lines.push(`- ${tags}"${summary}"${meta ? ' (' + meta + ')' : ''}`);
        }
    }

    if (hots.length > 0) {
        const labels = hots.map(h => h.label || h.topicKey).filter(Boolean).slice(0, 3).join(' · ');
        if (labels) lines.push(`[핫 관심사 top${Math.min(hots.length, 3)}] ${labels}`);
    }

    if (styleNote) {
        lines.push(`[사용자 맥락] ${styleNote}`);
    }

    return lines.join('\n');
}

// ============================================================================
// 임베딩 캐시 확장 — assertions only (이 라운드는 stub)
// ----------------------------------------------------------------------------
// 설계 문서 §7 — services/topic_embedding.js 에 addEpisodeVec / removeEpisodeVec /
// nearestEpisodes 신설 권고. 본 라운드는 *호출 인터페이스 가용성만* assertion 으로
// 검사하고, 미존재 시 silent 폴백.
// ============================================================================
function _assertEmbeddingExtensionsStub() {
    if (!topicEmbedding) return { ready: false, missing: ['module'] };
    const missing = [];
    for (const fn of ['addEpisodeVec', 'removeEpisodeVec', 'nearestEpisodes']) {
        if (typeof topicEmbedding[fn] !== 'function') missing.push(fn);
    }
    return { ready: missing.length === 0, missing };
}

// ============================================================================
// 공개 export
// ============================================================================
module.exports = {
    consolidateMemory,
    retrieveMemory,
    filterRelevance,
    buildMemoryPromptSection,
    // 내부 헬퍼 (테스트·디버그 용)
    _internals: {
        classifyQueryIntent: _classifyQueryIntent,
        recencyBoost: _recencyBoost,
        freqBoost: _freqBoost,
        cosine: _cosine,
        tagOverlap: _tagOverlap,
        styleDigestToNote: _styleDigestToNote,
        assertEmbeddingExtensions: _assertEmbeddingExtensionsStub,
        constants: {
            A4_K_DEFAULT, A4_K_MONITOR, A4_EMBED_MIN, A4_TOPK_PER_TOPIC,
            A5_SIM_MIN, A5_SIM_FLOOR_WITH_SURFACE, A5_PASS_THRESHOLD, A5_TOP_N,
            RECENCY_BOOST, RECENCY_HOT_DAYS, RECENCY_MID_DAYS,
            L3_MATRIX
        }
    }
};
