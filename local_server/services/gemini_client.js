/**
 * ============================================================================
 * 파일명: services/gemini_client.js
 * 역할: Gemini API 공용 클라이언트 (라운드로빈 + 폴백 + 공유 쿨다운)
 * ============================================================================
 *
 * [설명]
 * - 기본 키(GEMINI_API_KEY)와 백업 키(GEMINI_API_KEY_2)를 함께 관리
 * - 호출 시 라운드로빈으로 키를 번갈아 사용 → 일일 할당량 실질 2배
 * - 특정 키에서 429 발생 시 1시간 쿨다운 + 다른 키로 자동 폴백
 * - 두 키 모두 소진 시 관리자에게 푸시 알림
 * - 기본↔백업 전환 시 관리자 푸시 알림
 *
 * [사용처]
 * - ai_report_parser.js (특보 분석)
 * - marine_forecast_processor.js (해상 전망 분석)
 *
 * [반환 형식]
 *   { success: boolean, text: string|null, error: string|null,
 *     isRateLimited: boolean, keyLabel: string|null }
 * ============================================================================
 */

const { GoogleGenAI } = require('@google/genai');

// [쿨다운 정책] 429 의 종류에 따라 차등 적용.
//   기존엔 무조건 1시간이라, 분당 한도(RPM, 1분이면 회복)엔 과하게 길어 불필요한
//   장시간 블랙아웃을 만들고, 일일 한도(RPD)엔 모자라 의미가 약했음.
const COOLDOWN_MINUTE_MS  = 70 * 1000;          // 분당 한도(RPM): ~1분이면 회복 → 70초
const COOLDOWN_DEFAULT_MS = 5 * 60 * 1000;      // 종류 불명 429: 5분
const COOLDOWN_DAILY_MS   = 3 * 60 * 60 * 1000; // 일일 한도(RPD): 길게(다음 리셋까지 보수적 재시도)
const AI_COOLDOWN_MS = COOLDOWN_DEFAULT_MS;      // (구버전 export 호환용 별칭)
// 같은 알림이 과도하게 반복되지 않도록 종류별 최소 간격 유지
const NOTIFY_THROTTLE_MS = 10 * 60 * 1000; // 10분

// [키 로딩] 환경변수에서 키 읽어 등록 (없는 키는 목록에 추가하지 않음)
const keys = [];
if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE') {
    keys.push({ label: '기본', apiKey: process.env.GEMINI_API_KEY, cooldownUntil: 0 });
}
if (process.env.GEMINI_API_KEY_2) {
    keys.push({ label: '백업', apiKey: process.env.GEMINI_API_KEY_2, cooldownUntil: 0 });
}

console.log(`[Gemini] 키 ${keys.length}개 등록됨: ${keys.map(k => k.label).join(', ') || '없음'}`);

let nextIdx = 0;                // 라운드로빈 포인터
let lastSwitchNotifyAt = 0;     // 전환 알림 스로틀
let lastAllExhaustedNotifyAt = 0; // 전체 소진 알림 스로틀

// [사용량 카운터] 관리자 AI 탭 "호출량" 표시용. 일(KST) 단위 자동 리셋. 인메모리.
let usage = null;
function _todayKST() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
function _ensureUsage() {
    const d = _todayKST();
    if (!usage || usage.date !== d) usage = { date: d, requests: 0, apiCalls: 0, success: 0, rateLimited: 0, byCaller: {} };
    return usage;
}
function bumpUsage(field, caller) {
    const u = _ensureUsage();
    if (field) u[field] = (u[field] || 0) + 1;
    if (caller) u.byCaller[caller] = (u.byCaller[caller] || 0) + 1;
}
/** 오늘(KST) Gemini 사용량 스냅샷 — 관리자 UI에서 사용 */
function getUsageStats() { return Object.assign({}, _ensureUsage()); }

/** 등록된 키가 하나라도 있는지 */
function hasAnyKey() {
    return keys.length > 0;
}

/** 현재 키 상태 스냅샷 반환 (관리자 UI에서 사용) */
function getKeysStatus() {
    const now = Date.now();
    return keys.map((k, i) => ({
        index: i,
        label: k.label,
        cooldownUntil: k.cooldownUntil,
        onCooldown: k.cooldownUntil > now,
        remainingMs: Math.max(0, k.cooldownUntil - now)
    }));
}

/**
 * 라운드로빈 순서로 사용 가능한 다음 키를 선택
 * @param {number[]} excludeIndices 이번 호출에서 이미 시도했다가 실패한 인덱스
 * @returns 선택된 키 정보 또는 null(사용 가능 키 없음)
 */
function pickNextKey(excludeIndices) {
    const now = Date.now();
    const n = keys.length;
    for (let step = 0; step < n; step++) {
        const idx = (nextIdx + step) % n;
        if (excludeIndices.includes(idx)) continue;
        if (keys[idx].cooldownUntil > now) continue;
        nextIdx = (idx + 1) % n;
        return { index: idx, label: keys[idx].label, apiKey: keys[idx].apiKey };
    }
    return null;
}

/**
 * 429 오류 메시지로 한도 종류를 추정해 쿨다운 길이를 차등 결정.
 *   일일(RPD)=길게 / 분당(RPM)=짧게 / 불명=기본(5분).
 *   구글 429 메시지엔 보통 "per day"/"per minute" 또는 quota metric 명이 포함된다.
 */
function classifyCooldown(errorMsg) {
    const m = String(errorMsg || '');
    if (/per\s*day|perday|requests?\s*per\s*day|PerDay|daily/i.test(m)) return { ms: COOLDOWN_DAILY_MS, kind: '일일(RPD)' };
    if (/per\s*minute|perminute|requests?\s*per\s*minute|PerMinute/i.test(m)) return { ms: COOLDOWN_MINUTE_MS, kind: '분당(RPM)' };
    return { ms: COOLDOWN_DEFAULT_MS, kind: '불명' };
}

/** 특정 키를 429(쿨다운) 상태로 표시 — 한도 종류(일일/분당/불명)에 따라 쿨다운 차등 */
function markRateLimited(index, errorMsg) {
    if (index < 0 || index >= keys.length) return;
    const { ms, kind } = classifyCooldown(errorMsg);
    keys[index].cooldownUntil = Date.now() + ms;
    const untilStr = new Date(keys[index].cooldownUntil).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.error(`[Gemini] ⚠️ ${keys[index].label} 키 429(${kind}) → ${untilStr}까지 쿨다운(${Math.round(ms / 60000)}분). err=${String(errorMsg).slice(0, 180)}`);
}

/** 관리자 푸시 (순환 참조 방지용 lazy require) */
function notifyAdmin(title, body) {
    try {
        const { sendAdminPush } = require('./admin_push');
        sendAdminPush(title, body).catch(err => console.error('[Gemini] 관리자 푸시 오류:', err.message));
    } catch (e) { /* 무시 */ }
}

/**
 * Gemini 호출 (자동 키 선택 + 폴백)
 * @param {object} params
 * @param {string} params.model - 'gemini-2.5-flash-lite' 등
 * @param {string|object} params.contents - 프롬프트 텍스트 또는 contents 객체
 * @param {object} params.config - responseMimeType 등
 * @param {string} params.caller - 호출자 식별용 라벨(예: 'AI Parser', 'MarineForecast')
 * @returns {Promise<{success, text, error, isRateLimited, keyLabel}>}
 */
async function callGeminiRaw({ model, contents, config, caller = 'unknown' }) {
    if (!hasAnyKey()) {
        return {
            success: false, response: null,
            error: 'GEMINI_API_KEY가 설정되지 않았습니다.',
            isRateLimited: false, keyLabel: null
        };
    }

    bumpUsage('requests', caller);
    const triedIndices = [];
    let firstFailedKeyLabel = null;

    while (true) {
        const picked = pickNextKey(triedIndices);
        if (!picked) {
            // [모든 키 쿨다운] 전체 소진 알림 (10분 스로틀)
            const now = Date.now();
            if (now - lastAllExhaustedNotifyAt >= NOTIFY_THROTTLE_MS) {
                lastAllExhaustedNotifyAt = now;
                notifyAdmin(
                    '⛔ 모든 Gemini 키 소진',
                    `기본/백업 키 모두 쿨다운 중입니다. (${caller}) 수동 반영 또는 할당량 회복 대기 필요.`
                );
            }
            return {
                success: false, response: null,
                error: '모든 Gemini API 키가 쿨다운 중입니다.',
                isRateLimited: true, keyLabel: null
            };
        }

        try {
            bumpUsage('apiCalls');
            const genAI = new GoogleGenAI({ apiKey: picked.apiKey });
            const result = await genAI.models.generateContent({ model, contents, config });
            bumpUsage('success');
            // 성공: 이전 키에서 실패 후 전환된 경우 관리자에게 알림 (스로틀 10분)
            if (firstFailedKeyLabel && firstFailedKeyLabel !== picked.label) {
                const now = Date.now();
                if (now - lastSwitchNotifyAt >= NOTIFY_THROTTLE_MS) {
                    lastSwitchNotifyAt = now;
                    notifyAdmin(
                        '🔄 Gemini 키 자동 전환',
                        `${firstFailedKeyLabel} 키 429 → ${picked.label} 키로 전환 성공 (${caller})`
                    );
                }
            }
            return {
                success: true, response: result,
                error: null, isRateLimited: false, keyLabel: picked.label
            };
        } catch (e) {
            const errorMsg = e.message || '';
            const isRateLimited = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
            // [진단 로그] 모든 실패를 호출자/키/상태와 함께 남겨 원인(429 종류/404/인증 등)을 추적.
            //   "모든 키 소진"이 진짜 한도인지, 설정/일시 오류인지 로그로 바로 판별 가능.
            console.error(`[Gemini] 호출 실패 caller=${caller} key=${picked.label} rateLimited=${isRateLimited} err=${String(errorMsg).slice(0, 250)}`);
            if (isRateLimited) {
                bumpUsage('rateLimited');
                markRateLimited(picked.index, errorMsg);
                triedIndices.push(picked.index);
                if (!firstFailedKeyLabel) firstFailedKeyLabel = picked.label;
                // 다음 키로 폴백 시도 (루프 계속)
                continue;
            }
            // 429 외 오류: 폴백하지 않고 즉시 실패 반환 (구글 장애, 네트워크 등)
            return {
                success: false, response: null,
                error: e.message, isRateLimited: false, keyLabel: picked.label
            };
        }
    }
}

/**
 * 스트리밍 호출(비동기 제너레이터) — 키 선택·쿨다운 로직은 callGeminiRaw와 동일하나,
 * 전체 응답을 기다리지 않고 청크가 오는 대로 바로 넘겨준다(체감 대기시간 단축용).
 * 429는 스트림을 열기 *전*에만 다음 키로 폴백한다 — 스트림이 이미 시작된 뒤 중간에
 * 끊기면 그 시점까지 텍스트가 클라이언트에 이미 전달됐을 수 있어 재시도하지 않고
 * 에러를 그대로 던진다(호출부가 "여기까지만 받았다"로 처리).
 * @param {object} params - { model, contents, config, caller }
 * @yields {string} 텍스트 조각(delta)
 */
async function* callGeminiStream({ model, contents, config, caller = 'unknown' }) {
    if (!hasAnyKey()) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');

    bumpUsage('requests', caller);
    const triedIndices = [];

    while (true) {
        const picked = pickNextKey(triedIndices);
        if (!picked) {
            const now = Date.now();
            if (now - lastAllExhaustedNotifyAt >= NOTIFY_THROTTLE_MS) {
                lastAllExhaustedNotifyAt = now;
                notifyAdmin('⛔ 모든 Gemini 키 소진', `기본/백업 키 모두 쿨다운 중입니다. (${caller})`);
            }
            throw new Error('모든 Gemini API 키가 쿨다운 중입니다.');
        }

        let stream;
        try {
            bumpUsage('apiCalls');
            const genAI = new GoogleGenAI({ apiKey: picked.apiKey });
            stream = await genAI.models.generateContentStream({ model, contents, config });
        } catch (e) {
            const errorMsg = e.message || '';
            const isRateLimited = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
            console.error(`[Gemini] 스트림 시작 실패 caller=${caller} key=${picked.label} rateLimited=${isRateLimited} err=${String(errorMsg).slice(0, 250)}`);
            if (isRateLimited) {
                bumpUsage('rateLimited');
                markRateLimited(picked.index, errorMsg);
                triedIndices.push(picked.index);
                continue; // 스트림 열기 전 실패만 다음 키로 폴백
            }
            throw e;
        }

        bumpUsage('success');
        for await (const chunk of stream) {
            const t = chunk.text;
            if (t) yield t;
        }
        return;
    }
}

/**
 * 단발 텍스트 응답 헬퍼 — callGeminiRaw 를 감싸 기존 { success, text } 계약을 유지.
 */
async function callGemini(args) {
    const r = await callGeminiRaw(args);
    if (r.success) {
        let text = null;
        try { text = r.response.text; } catch (e) { text = null; }
        return { success: true, text, error: null, isRateLimited: false, keyLabel: r.keyLabel };
    }
    return { success: false, text: null, error: r.error, isRateLimited: r.isRateLimited, keyLabel: r.keyLabel };
}

module.exports = {
    callGemini,
    callGeminiRaw,
    callGeminiStream,
    getKeysStatus,
    getUsageStats,
    hasAnyKey,
    AI_COOLDOWN_MS
};
