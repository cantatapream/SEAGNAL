/**
 * ============================================================================
 * 파일명: services/fcm_multicast_chunked.js
 * 역할: 위치기반 "깨우는 신호"(데이터 전용 FCM)를 토큰 500개씩 나눠 보내고,
 *       성공·실패 수와 실패 사유(코드별 건수)를 모아 돌려주는 작은 도우미.
 * ============================================================================
 *
 * [왜 필요한가] (2026-10-15)
 *   firebase-admin 의 sendEachForMulticast 는 토큰이 500개를 넘으면 **보내지 않고 예외**를 던진다
 *   (node_modules/firebase-admin/lib/messaging/messaging.js FCM_MAX_BATCH_SIZE = 500).
 *   종전 위치기반 특보·태풍 디스패치는 동의 토큰 전부를 한 번에 넘겨, 동의자가 500명을 넘는 순간
 *   전원이 못 받게 되는 구조였다. 또 토큰별 실패 사유를 버려서 "왜 0건인지"를 알 수 없었다.
 *
 * [사용자 결정 원문 인용] 2026-10-15 — "①②둘 다, 서버만, 앱 업데이트 없음".
 *   ①(a) 토큰별 실패 코드 요약(코드별 건수, 토큰은 남기지 않음) ①(d) 토큰을 ≤500개씩 나눠 보내고 합산.
 *
 * [연계]
 *   - ← services/location_alert_dispatch.js _defaultSendFn : 위치기반 특보 깨우기 발송
 *   - ← services/typhoon_radius_dispatch.js _defaultSendFn : 위치기반 태풍 반경 깨우기 발송
 *   - → firebase-admin messaging().sendEachForMulticast (호출 측이 messaging 객체를 넘긴다)
 *   - 서버 API: 없음 / 검사: local_server/scripts/test_location_dispatch_reliability.js
 * ============================================================================
 */
'use strict';

// firebase-admin messaging.js 의 FCM_MAX_BATCH_SIZE 와 같은 값. 이보다 크면 SDK 가 예외를 던진다.
const FCM_MAX_TOKENS_PER_CALL = 500;

/**
 * 토큰 배열을 size 개씩 자른다.
 * 예) chunkTokens(['a','b','c'], 2) → [['a','b'],['c']]
 * @param {string[]} tokens
 * @param {number} [size=500]
 * @returns {string[][]}
 * [연계] ← sendMulticastChunked (이 파일) — SDK 의 500개 한도를 넘지 않게 하려고.
 */
function chunkTokens(tokens, size) {
    const n = size || FCM_MAX_TOKENS_PER_CALL;
    const out = [];
    for (let i = 0; i < (tokens || []).length; i += n) out.push(tokens.slice(i, i + n));
    return out;
}

/**
 * 토큰을 ≤500개씩 나눠 sendEachForMulticast 를 여러 번 부르고 결과를 합산한다.
 *   한 묶음이 예외를 던져도 나머지 묶음은 계속 보낸다(그 묶음 토큰 수만큼 실패로 센다).
 * 예) await sendMulticastChunked(admin.messaging(), tokens, { data, android })
 *     → { ok:true, successCount:1180, failureCount:20, errorCodes:{'messaging/registration-token-not-registered':20}, calls:3 }
 * @param {object} messaging firebase-admin Messaging (sendEachForMulticast 를 가진 객체)
 * @param {string[]} tokens
 * @param {{data:object, android?:object}} message
 * @returns {Promise<{ok:boolean, successCount:number, failureCount:number, errorCodes:Object<string,number>, calls:number, reason?:string}>}
 *   ok=false 는 "어느 묶음이 예외를 던졌다"는 뜻이다(reason = 첫 예외 메시지 앞 200자). 토큰 값은 담지 않는다.
 * [연계] ← location_alert_dispatch.js / typhoon_radius_dispatch.js 의 _defaultSendFn.
 */
async function sendMulticastChunked(messaging, tokens, message) {
    let successCount = 0, failureCount = 0, calls = 0, firstError = null;
    const errorCodes = {};
    const add = (code, n) => { errorCodes[code] = (errorCodes[code] || 0) + n; };
    for (const chunk of chunkTokens(tokens)) {
        calls++;
        try {
            const res = await messaging.sendEachForMulticast({
                tokens: chunk,
                data: message.data,
                android: message.android,
            });
            const s = (res && Number.isFinite(res.successCount)) ? res.successCount : 0;
            const f = (res && Number.isFinite(res.failureCount)) ? res.failureCount : (chunk.length - s);
            successCount += s;
            failureCount += f;
            const responses = (res && Array.isArray(res.responses)) ? res.responses : [];
            for (const r of responses) {
                if (r && r.success === false) add((r.error && r.error.code) || 'unknown', 1);
            }
        } catch (e) {
            // 이 묶음만 실패로 세고 다음 묶음은 계속 보낸다. 예외 메시지는 **첫 번째만** 로그에 남긴다
            //   (묶음마다 찍으면 한 주기에 여러 줄이 된다 — 나머지는 errorCodes 건수로 요약된다).
            failureCount += chunk.length;
            add((e && e.code) || 'send_threw', chunk.length);
            if (!firstError) {
                firstError = String((e && e.message) || 'send_threw').slice(0, 200);
                console.error('[FcmMulticastChunked] 묶음 ' + calls + ' 전송 예외(' + chunk.length + '개 실패 처리):', firstError);
            }
        }
    }
    const out = { ok: !firstError, successCount, failureCount, errorCodes, calls };
    if (firstError) out.reason = firstError;
    return out;
}

/**
 * 발송 1회의 결과를 로그 한 줄로 만든다(토큰 값은 절대 넣지 않는다).
 * 예) '대상 1200 · 호출 3회 · 성공 1180 · 실패 20 · 실패코드 {"messaging/…":20}'
 * @param {number} targets 보낸 대상 토큰 수
 * @param {object} result sendFn 결과
 * @returns {string}
 * [연계] ← location_alert_dispatch.js dispatchWake / typhoon_radius_dispatch.js dispatchTyphoon 의 요약 로그.
 */
function formatSendSummary(targets, result) {
    const r = result || {};
    const s = Number.isFinite(r.successCount) ? r.successCount : 0;
    const f = Number.isFinite(r.failureCount) ? r.failureCount : Math.max(0, targets - s);
    const parts = ['대상 ' + targets];
    if (Number.isFinite(r.calls)) parts.push('호출 ' + r.calls + '회');
    parts.push('성공 ' + s, '실패 ' + f);
    if (r.errorCodes && Object.keys(r.errorCodes).length) parts.push('실패코드 ' + JSON.stringify(r.errorCodes));
    if (r.reason) parts.push('사유 ' + String(r.reason).slice(0, 200));
    return parts.join(' · ');
}

module.exports = { FCM_MAX_TOKENS_PER_CALL, chunkTokens, sendMulticastChunked, formatSendSummary };
