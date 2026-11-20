/**
 * ============================================================================
 * 파일명: local_server/services/internal_push_auth.js
 * 역할  : 푸시 발송·발송 기록 삭제 주소를 "관리자 또는 서버 자신"만 쓸 수 있게 하는 문지기.
 *         관리자는 로그인 열쇠(X-Admin-Token)로, 서버 안의 자동 발송(특보·태풍)은 이 파일의 내부 열쇠로 통과한다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/admin_auth.js(requireAdminToken — 관리자 열쇠 확인)
 *  - 서버 API      : 없음 (routes/push.js 의 POST /api/push-custom · POST /api/push-typhoon ·
 *                    DELETE /api/push-history(/:id) 앞에 붙는다)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : routes/push.js(문지기) · push_sender.js(자동 특보 푸시) · services/typhoon_notifier.js(자동 태풍 푸시)
 *                    · scripts/test_push_route_auth.js
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 * [왜 — 사용자 확정 2026-11-20]
 *   위 네 주소에 관리자 확인이 없어, 주소를 아는 누구나 전체 구독자에게 푸시를 보내거나 발송 기록을 지울 수 있었다.
 *   사용자 원문: 「이것 반영하고자 하는데, 주의할 점이 발생하지 않도록 그 부분에 대해서는 재검토 할 수 있도록 해줘.」
 *   주의할 점 = 서버의 자동 특보 푸시(push_sender.js → /api/push-custom)와 자동 태풍 푸시(typhoon_notifier.js → /api/push-typhoon)가
 *   같은 주소를 서버 안에서 HTTP 로 부른다. 관리자 열쇠만 받게 하면 자동 푸시가 전부 막힌다 → 내부 열쇠를 함께 받는다.
 * [내부 열쇠]
 *   - 서버가 켜질 때마다 새로 만든다(32바이트 무작위). 디스크·로그·응답 어디에도 남기지 않는다 — 이 프로세스 메모리에만 있다.
 *   - 자동 발송 코드는 scheduler.js 를 통해 같은 프로세스에서 돈다(routes/admin.js·routes/weather.js 가 require) → 같은 열쇠를 안다.
 *   - 비교는 길이와 내용을 상수 시간으로 견준다(timingSafeEqual).
 */
'use strict';
const crypto = require('crypto');

const HEADER = 'X-Seagnal-Internal';
const TOKEN = crypto.randomBytes(32).toString('hex');

/**
 * 자동 발송 코드가 요청에 붙일 머리말.
 * 예: fetch(url, { headers: Object.assign({ 'Content-Type': 'application/json' }, internalHeaders()) })
 * @returns {{[k:string]:string}}
 * [연계] ← push_sender.js sendToApi · services/typhoon_notifier.js postPush
 */
function internalHeaders() {
    return { [HEADER]: TOKEN };
}

/**
 * 이 요청이 서버 자신(내부 열쇠)에서 왔는가.
 * @param {import('express').Request} req @returns {boolean}
 */
function isInternalRequest(req) {
    const got = String((req && typeof req.get === 'function' && req.get(HEADER)) || '');
    const a = Buffer.from(got);
    const b = Buffer.from(TOKEN);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * 문지기 — 내부 열쇠가 맞으면 통과, 아니면 관리자 열쇠(X-Admin-Token)를 본다(없거나 틀리면 401).
 * 예: router.post('/api/push-custom', requireAdminOrInternal, handler)
 * [연계] → services/admin_auth.js requireAdminToken(같은 401 응답 — 화면의 fetch 래퍼가 그 401 을 보고 로그인을 다시 띄운다)
 */
function requireAdminOrInternal(req, res, next) {
    if (isInternalRequest(req)) return next();
    return require('./admin_auth').requireAdminToken(req, res, next);
}

module.exports = { internalHeaders, isInternalRequest, requireAdminOrInternal, HEADER };
