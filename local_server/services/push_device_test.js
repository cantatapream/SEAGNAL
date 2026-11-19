/**
 * ============================================================================
 * 파일명: local_server/services/push_device_test.js
 * 역할  : 관리자 센터 「직접 발송」의 "이 휴대폰에만 보내기(시험)" — 푸시 1통을 **휴대폰 한 대에만** 보낸다.
 *         구독자 목록을 아예 읽지 않는다. 그래서 어떤 실수로도 여러 사람에게 나갈 수 없다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(보내는 함수·타이머는 부르는 쪽이 넣어 준다 — 시험이 가짜로 바꿔 넣는다)
 *  - 서버 API      : 없음 (routes/push.js 의 POST /api/admin/push-test-device 가 이 모듈을 부른다)
 *  - 마크업        : 없음
 *  - 나를 쓰는 곳  : routes/push.js · scripts/test_push_device_test.js
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 * [왜 있나 — 사용자 확정 2026-11-20]
 *   새 앱(1.3.0)의 헤드업 알림을 휴대폰 한 대로 시험해야 하는데, 「직접 발송」은 해역 구독자나 구독자 전원에게만 보낼 수 있었다.
 *   사용자 원문: *「직접 발송」에 "이 휴대폰에만 보내기" 체크칸과 10초 지연을 추가할지. 추가*
 * [10초 지연이 서버에 있는 이유]
 *   보내는 순간에는 관리자 화면이 켜져 있다. "앱을 끈 상태"를 시험하려면 누른 뒤 앱을 끌 시간이 필요하다.
 *   화면 쪽에서 10초를 세면 앱을 끄는 순간 요청 자체가 안 나간다 → 서버가 요청을 받은 뒤 10초를 센다.
 *   그 10초 안에 서버가 다시 켜지면 이 시험 푸시는 사라진다(시험용이라 따로 보관하지 않는다).
 * [푸시 모양] 실제 「직접 발송」과 글자 하나까지 같다(routes/push.js 의 custom_push) — 채널 지정이 없어야 새 앱의 기본 채널(헤드업)로 간다.
 */
'use strict';

const BASE_URL = 'https://seagnal-server.fly.dev';
const MAX_DELAY_SEC = 60;   // 시험용 지연 한도 — 넘는 값은 거절한다(서버에 타이머를 오래 걸어 두지 않는다)
const MAX_TITLE = 100;
const MAX_CONTENT = 500;    // 「직접 발송」 화면의 글자 수 한도와 같다
const MAX_TOKEN = 4096;

/**
 * 요청 본문을 확인한다.
 * 예: validate({token:'abc…', title:'시험', content:'내용', delaySec:10}) → {ok:true, token, title, content, delaySec:10}
 *     validate({title:'시험', content:'내용'}) → {ok:false, error:'이 휴대폰의 푸시 주소(token)가 없습니다 …'}
 * @param {object} body - {token, title, content, delaySec}
 * @returns {{ok:boolean, error?:string, token?:string, title?:string, content?:string, delaySec?:number}}
 * [연계] ← routes/push.js POST /api/admin/push-test-device — 틀리면 아무것도 보내지 않고 400 으로 답한다
 */
function validate(body) {
    const b = body || {};
    const token = typeof b.token === 'string' ? b.token.trim() : '';
    if (!token) return { ok: false, error: '이 휴대폰의 푸시 주소(token)가 없습니다 — 앱에서 알림을 허용한 뒤 다시 시도하세요.' };
    if (token.length > MAX_TOKEN) return { ok: false, error: '푸시 주소(token)가 너무 깁니다.' };
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    const content = typeof b.content === 'string' ? b.content.trim() : '';
    if (!title || !content) return { ok: false, error: '제목과 내용은 필수입니다.' };
    if (title.length > MAX_TITLE) return { ok: false, error: `제목은 ${MAX_TITLE}자까지입니다.` };
    if (content.length > MAX_CONTENT) return { ok: false, error: `내용은 ${MAX_CONTENT}자까지입니다.` };
    const raw = b.delaySec === undefined || b.delaySec === null || b.delaySec === '' ? 0 : Number(b.delaySec);
    if (!Number.isInteger(raw) || raw < 0 || raw > MAX_DELAY_SEC) return { ok: false, error: `지연(delaySec)은 0~${MAX_DELAY_SEC} 사이 정수여야 합니다.` };
    return { ok: true, token, title, content, delaySec: raw };
}

/**
 * 보낼 푸시 한 통을 만든다 — 실제 「직접 발송」과 같은 모양.
 * 예: buildMessage({token:'t1', title:'시험', content:'내용'}) → {token:'t1', notification:{title:'시험', body:'내용'}, data:{url:…, type:'custom_push'}, android:{priority:'high'}, …}
 * @param {{token:string, title:string, content:string}} v @returns {object} firebase-admin 의 send() 에 넣는 메시지
 * [연계] ← sendToDevice. 모양의 원본 = routes/push.js `/api/push-custom` 의 msg(바뀌면 여기도 맞춘다 — 시험이 대조한다)
 */
function buildMessage(v) {
    return {
        token: v.token,
        notification: { title: v.title, body: v.content },
        data: { url: `${BASE_URL}/?tab=weather-alert-section&popup=true`, type: 'custom_push' },
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' } },
    };
}

/**
 * 휴대폰 한 대에 시험 푸시를 보낸다(지연이 있으면 예약만 하고 바로 돌아온다).
 * 예: await sendToDevice({token, title, content, delaySec:0}, {send}) → {success:true, scheduled:false, messageId:'…'}
 *     await sendToDevice({token, title, content, delaySec:10}, {send, setTimer}) → {success:true, scheduled:true, delaySec:10}
 * @param {object} v - validate() 가 돌려준 값
 * @param {{send:function(object):Promise<{ok:boolean,code?:string,messageId?:string}>, setTimer?:function, log?:function}} deps
 * @returns {Promise<object>}
 * [연계] ← routes/push.js / → deps.send(routes/push.js 의 _sendFcmPart — 재시도·결과 로그 포함)
 *        send 는 **이 한 통**만 받는다. 구독자 목록·여러 토큰을 넘기는 길이 이 모듈에는 없다.
 */
async function sendToDevice(v, deps) {
    const send = deps.send;
    const setTimer = deps.setTimer || setTimeout;
    const log = deps.log || console.log;
    const msg = buildMessage(v);
    if (v.delaySec > 0) {
        setTimer(() => {
            Promise.resolve()
                .then(() => send(msg))
                .then((r) => log(`[Push/test-device] 예약 발송 ${r && r.ok ? '성공' : '실패'}${r && r.code ? ' code=' + r.code : ''}`))
                .catch((e) => log('[Push/test-device] 예약 발송 오류: ' + (e && e.message)));
        }, v.delaySec * 1000);
        return { success: true, scheduled: true, delaySec: v.delaySec };
    }
    const r = await send(msg);
    if (r && r.ok) return { success: true, scheduled: false, messageId: r.messageId || null };
    return { success: false, scheduled: false, error: '발송 실패' + (r && r.code ? ' (' + r.code + ')' : ''), code: (r && r.code) || null };
}

module.exports = { validate, buildMessage, sendToDevice, MAX_DELAY_SEC, MAX_TITLE, MAX_CONTENT };
