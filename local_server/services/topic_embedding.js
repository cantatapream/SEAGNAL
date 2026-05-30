/**
 * 토픽 임베딩 PoC — 룰베이스 직군 디지스트의 빈틈을 의미 임베딩으로 보완.
 *
 * [동기]
 *   Phase 2b 측정 토대 v1 결과: 짧고 모호한 직군 질의 4건이 web_search 폴백으로 빠짐.
 *   룰베이스 키워드 매칭은 "관내 해상 특보", "양양 오늘 어때" 같은 우회표현을 못 잡는다.
 *   이 모듈은 지식그래프의 Topic(직군별 관심사) 라벨을 임베딩해 두고, 질의를
 *   임베딩한 뒤 코사인 유사도로 가까운 상위 K개 토픽 + 그 servedBy 도구를 플래너에
 *   *추가 힌트* 로 주입한다. 룰베이스는 그대로 두고 덮어쓰지 않음(폴백 우선).
 *
 * [수명]
 *   warmup(topics): 그래프 로드 직후 백그라운드 실행. 디스크 캐시(graph/topic_embeddings.json)
 *     사용 — 모델·토픽 수 일치 시 즉시 로드, 아니면 다시 임베딩.
 *   nearestTopics(q, k): 질의 임베딩 + 코사인 → 상위 k. 임베딩 실패 시 빈 배열(폴백 안전).
 *
 * [의존]
 *   GEMINI_API_KEY 필요. @google/genai SDK. 실패는 silent(폴백 흐름 유지).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

// 2026-05 확인: text-embedding-004 는 v1beta 에서 embedContent 미지원(404).
// gemini-embedding-001 (3072 dim) 사용. 향후 신모델은 GEMINI_EMBED_MODEL 로 교체.
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
const CACHE_PATH = path.join(__dirname, '..', 'knowledge', 'graph', 'topic_embeddings.json');
const QUERY_CACHE_MAX = 256;     // 최근 질의 임베딩 LRU
const WARMUP_CONCURRENCY = 4;

let ai = null;
function client() {
    if (ai) return ai;
    if (!process.env.GEMINI_API_KEY) return null;
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return ai;
}

let TOPIC_DB = [];        // [{ id, jikgun, label, tools:[], vec:Float32Array }]
let warmupStarted = false;
let warmupDone = false;
const queryCache = new Map();  // text → vec (LRU)

/** 단일 텍스트를 임베딩. 실패 시 null. */
async function embed(text) {
    const c = client();
    if (!c) return null;
    try {
        const r = await c.models.embedContent({ model: EMBED_MODEL, contents: text });
        // 응답 형태: { embeddings: [{ values: [...] }] } 또는 { embedding: { values: [...] } }
        const v = (r && r.embeddings && r.embeddings[0] && r.embeddings[0].values)
            || (r && r.embedding && r.embedding.values) || null;
        return Array.isArray(v) ? v : null;
    } catch (e) {
        return null;
    }
}

function cosine(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    const d = Math.sqrt(na) * Math.sqrt(nb);
    return d > 0 ? dot / d : 0;
}

function loadCache() {
    try {
        const j = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        if (j.model !== EMBED_MODEL) return null;
        if (!Array.isArray(j.topics)) return null;
        return j;
    } catch (e) { return null; }
}
function saveCache() {
    try {
        const dir = path.dirname(CACHE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CACHE_PATH, JSON.stringify({
            model: EMBED_MODEL,
            builtAt: new Date().toISOString(),
            topics: TOPIC_DB.map(t => ({ id: t.id, jikgun: t.jikgun, label: t.label, tools: t.tools, vec: t.vec }))
        }));
    } catch (e) { /* 캐시 저장 실패는 무시 */ }
}

/**
 * warmup — 그래프 토픽 임베딩 캐시 마련. 입력: [{ id, jikgun, label, tools }]
 * 캐시가 모델·토픽수·라벨 모두 일치하면 즉시 로드, 아니면 재임베딩.
 * 백그라운드 실행 권장(await 하지 말고 호출만).
 */
async function warmup(topics) {
    if (warmupStarted) return;
    warmupStarted = true;
    const key = topics.map(t => `${t.id}|${t.label}`).join('§');

    const cached = loadCache();
    if (cached) {
        const cachedKey = cached.topics.map(t => `${t.id}|${t.label}`).join('§');
        if (cachedKey === key) {
            TOPIC_DB = cached.topics;
            warmupDone = true;
            console.log(`[TopicEmbed] cache hit · ${TOPIC_DB.length} topics`);
            return;
        }
    }

    const t0 = Date.now();
    const buf = new Array(topics.length).fill(null);
    let next = 0;
    async function worker() {
        while (next < topics.length) {
            const idx = next++;
            buf[idx] = await embed(topics[idx].label);
        }
    }
    await Promise.all(new Array(WARMUP_CONCURRENCY).fill(0).map(worker));

    TOPIC_DB = [];
    for (let i = 0; i < topics.length; i++) {
        if (!buf[i]) continue;
        TOPIC_DB.push({ id: topics[i].id, jikgun: topics[i].jikgun, label: topics[i].label, tools: topics[i].tools, vec: buf[i] });
    }
    warmupDone = TOPIC_DB.length > 0;
    if (warmupDone) saveCache();
    console.log(`[TopicEmbed] warmup ${TOPIC_DB.length}/${topics.length} · ${Date.now() - t0}ms · ${warmupDone ? '저장' : '실패(폴백)'}`);
}

/** 질의 임베딩(LRU 캐시). 실패 시 null. */
async function embedQuery(text) {
    if (!text) return null;
    const k = text.trim();
    if (queryCache.has(k)) {
        const v = queryCache.get(k);
        queryCache.delete(k); queryCache.set(k, v);  // LRU 갱신
        return v;
    }
    const v = await embed(k);
    if (v) {
        queryCache.set(k, v);
        if (queryCache.size > QUERY_CACHE_MAX) {
            const first = queryCache.keys().next().value;
            queryCache.delete(first);
        }
    }
    return v;
}

/**
 * 질의와 의미적으로 가까운 상위 K 토픽 + servedBy 도구.
 * 임베딩 미준비/실패 → 빈 배열(플래너는 룰베이스로 폴백).
 */
async function nearestTopics(query, k = 5, minScore = 0.55) {
    if (!warmupDone || !TOPIC_DB.length) return [];
    const qv = await embedQuery(query);
    if (!qv) return [];
    const ranked = TOPIC_DB.map(t => ({
        id: t.id, jikgun: t.jikgun, label: t.label, tools: t.tools, score: cosine(qv, t.vec)
    })).sort((a, b) => b.score - a.score).filter(r => r.score >= minScore).slice(0, k);
    return ranked;
}

function isReady() { return warmupDone && TOPIC_DB.length > 0; }
function stats() { return { ready: isReady(), topics: TOPIC_DB.length, model: EMBED_MODEL, queryCache: queryCache.size }; }

module.exports = { warmup, nearestTopics, isReady, stats };
