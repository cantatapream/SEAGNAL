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

const AI_COOLDOWN_MS = 60 * 60 * 1000; // 1시간
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

/** 특정 키를 429(쿨다운) 상태로 표시 */
function markRateLimited(index) {
    if (index < 0 || index >= keys.length) return;
    keys[index].cooldownUntil = Date.now() + AI_COOLDOWN_MS;
    const untilStr = new Date(keys[index].cooldownUntil).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    console.error(`[Gemini] ⚠️ ${keys[index].label} 키 429 감지 → ${untilStr}까지 쿨다운 (1시간)`);
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
 * @param {string} params.model - 'gemini-2.5-flash' 등
 * @param {string|object} params.contents - 프롬프트 텍스트 또는 contents 객체
 * @param {object} params.config - responseMimeType 등
 * @param {string} params.caller - 호출자 식별용 라벨(예: 'AI Parser', 'MarineForecast')
 * @returns {Promise<{success, text, error, isRateLimited, keyLabel}>}
 */
async function callGemini({ model, contents, config, caller = 'unknown' }) {
    if (!hasAnyKey()) {
        return {
            success: false, text: null,
            error: 'GEMINI_API_KEY가 설정되지 않았습니다.',
            isRateLimited: false, keyLabel: null
        };
    }

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
                success: false, text: null,
                error: '모든 Gemini API 키가 쿨다운 중입니다.',
                isRateLimited: true, keyLabel: null
            };
        }

        try {
            const genAI = new GoogleGenAI({ apiKey: picked.apiKey });
            const result = await genAI.models.generateContent({ model, contents, config });
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
                success: true, text: result.text,
                error: null, isRateLimited: false, keyLabel: picked.label
            };
        } catch (e) {
            const errorMsg = e.message || '';
            const isRateLimited = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
            if (isRateLimited) {
                markRateLimited(picked.index);
                triedIndices.push(picked.index);
                if (!firstFailedKeyLabel) firstFailedKeyLabel = picked.label;
                // 다음 키로 폴백 시도 (루프 계속)
                continue;
            }
            // 429 외 오류: 폴백하지 않고 즉시 실패 반환 (구글 장애, 네트워크 등)
            return {
                success: false, text: null,
                error: e.message, isRateLimited: false, keyLabel: picked.label
            };
        }
    }
}

module.exports = {
    callGemini,
    getKeysStatus,
    hasAnyKey,
    AI_COOLDOWN_MS
};
