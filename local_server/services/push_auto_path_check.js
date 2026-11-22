/**
 * ============================================================================
 * 파일명: local_server/services/push_auto_path_check.js
 * 역할  : [임시] 「자동 푸시 경로 점검」 — 서버의 자동 특보·태풍 푸시가 쓰는 길(내부 열쇠)이 운영 서버에서 정말 열리는지 본다.
 *         관리자 센터 「직접 발송」의 [자동 푸시 경로 점검] 버튼이 부른다. 확인이 끝나면 지워도 된다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/internal_push_auth.js(internalHeaders — 자동 발송 코드와 같은 내부 열쇠)
 *  - 서버 API      : 없음 (routes/push.js 의 POST /api/admin/push-auto-path-check 가 이 모듈을 부른다)
 *                    이 모듈이 서버 자신에게 부르는 곳: POST /api/push-custom · POST /api/push-typhoon
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : routes/push.js · scripts/test_push_auto_path_check.js
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 * [왜 — 사용자 요청 2026-11-20]
 *   사용자: 「직접 발송하는 것으로 자동 푸시 온다고 볼 수 있니 ?」 → 아니다(직접 발송 = 관리자 열쇠, 자동 푸시 = 내부 열쇠).
 *   사용자: 「자동 푸시 경로 점검 버튼 임시로 만들어보자.」
 * [하는 일 — 실제 사용자에게는 절대 가지 않게]
 *   ① 특보 길: push_sender.js 와 똑같이 http://localhost:3001/api/push-custom 에 내부 열쇠를 붙여 부른다.
 *      adminToken = 이 휴대폰의 푸시 주소 → push-custom 이 구독자를 그 한 대로 좁히고 발송 기록도 남기지 않는다(routes/push.js 관리자 테스트 모드).
 *      ★adminToken 이 비면 push-custom 은 전체 구독자에게 보낸다 — 그래서 주소가 없거나 짧으면 아예 부르지 않는다(validate).
 *   ② 태풍 길: push-typhoon 에는 한 대로 좁히는 방법이 없다 → 일부러 제목·본문 없이 부른다.
 *      문지기를 통과하면 「title/body required」(400), 막히면 401 — 발송은 일어나지 않는다.
 */
'use strict';

const PUSH_CUSTOM_URL = 'http://localhost:3001/api/push-custom';   // push_sender.js API_URL 과 같은 주소
const PUSH_TYPHOON_URL = 'http://localhost:3001/api/push-typhoon'; // typhoon_notifier.js PUSH_API 와 같은 주소
const MIN_TOKEN = 20;     // FCM 푸시 주소는 이보다 훨씬 길다 — 빈 값·짧은 값으로 전체 발송이 되는 것을 막는 문턱
const MAX_TOKEN = 4096;

/**
 * 이 휴대폰 푸시 주소를 확인한다. 예: validate('') → {ok:false, error:'…'}
 * @param {*} token @returns {{ok:boolean, token?:string, error?:string}}
 */
function validate(token) {
    const t = typeof token === 'string' ? token.trim() : '';
    if (t.length < MIN_TOKEN) return { ok: false, error: '이 휴대폰의 푸시 주소가 없습니다 — 앱에서 알림을 허용한 휴대폰에서 눌러 주세요.' };
    if (t.length > MAX_TOKEN) return { ok: false, error: '푸시 주소가 너무 깁니다.' };
    return { ok: true, token: t };
}

/**
 * 두 길을 점검한다.
 * 예: await run('fcm-token…', { fetchImpl: fetch, headers: internalHeaders })
 *     → { ok:true, custom:{ passed:true, status:200, successCount:1, … }, typhoon:{ passed:true, status:400 } }
 * @param {string} token - validate 를 통과한 이 휴대폰 푸시 주소
 * @param {{fetchImpl:Function, headers:Function}} deps - 시험이 가짜로 바꿔 넣는다
 * @returns {Promise<object>}
 * [연계] ← routes/push.js POST /api/admin/push-auto-path-check
 */
async function run(token, deps) {
    const v = validate(token);
    if (!v.ok) return { ok: false, error: v.error };
    const f = deps.fetchImpl;
    const H = Object.assign({ 'Content-Type': 'application/json' }, deps.headers());

    // ① 특보 길 — 이 휴대폰 한 대에만 실제 발송(adminToken). 발송 기록 없음.
    let custom;
    try {
        const r = await f(PUSH_CUSTOM_URL, {
            method: 'POST', headers: H,
            body: JSON.stringify({
                title: '[점검] 자동 푸시 경로',
                content: '자동 특보 푸시가 쓰는 길(서버 내부 열쇠)이 열려 있습니다. 이 알림은 이 휴대폰에만 보냈습니다.',
                targetZones: '전체해역',
                sendToAllSubscribers: true,
                adminToken: v.token,
            }),
        });
        const j = await r.json().catch((e) => { console.warn('[auto-path-check] 특보 길 응답을 읽지 못했다:', e && e.message); return {}; });
        custom = { passed: r.status !== 401 && r.status !== 403, status: r.status, successCount: j.successCount || 0, failCount: j.failCount || 0, message: j.message || j.error || '' };
    } catch (e) {
        console.warn('[auto-path-check] 특보 길 요청 실패:', e && e.message);
        custom = { passed: false, status: 0, message: '서버 자신에게 요청하지 못했다: ' + (e && e.message) };
    }

    // ② 태풍 길 — 제목·본문 없이 불러 문지기만 본다(400 = 통과, 401 = 막힘). 발송 없음.
    let typhoon;
    try {
        const r = await f(PUSH_TYPHOON_URL, { method: 'POST', headers: H, body: JSON.stringify({}) });
        typhoon = { passed: r.status === 400, status: r.status };
    } catch (e) {
        console.warn('[auto-path-check] 태풍 길 요청 실패:', e && e.message);
        typhoon = { passed: false, status: 0, message: '서버 자신에게 요청하지 못했다: ' + (e && e.message) };
    }

    return { ok: true, custom, typhoon };
}

module.exports = { validate, run, PUSH_CUSTOM_URL, PUSH_TYPHOON_URL, MIN_TOKEN };
