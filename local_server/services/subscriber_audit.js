/**
 * ============================================================================
 * 파일명: services/subscriber_audit.js
 * 역할: 푸시 구독자 명단(subscriptions.json)에서 "실제로 알림을 받는 사람"을 세고,
 *       이미 죽은 등록표(FCM 토큰)를 가려내 지우는 서비스.
 * ----------------------------------------------------------------------------
 * [왜 필요한가] (2026-11-18 사용자 지적)
 *   관리자 센터의 "푸시 알림 구독자" 숫자가 명단에 남아 있는 등록표 개수였다.
 *   ① 알림을 꺼도 명단에 남고 ② 죽은 등록표는 "그 사람에게 푸시를 보내다 실패했을 때만"
 *   지워져서, 알림을 꺼 둔 사람·특보가 없는 해역 사람의 죽은 등록표는 계속 세어졌다.
 *   ③ 등록표가 바뀌면(같은 기기) "신규 구독"으로 또 세어 유지율이 실제보다 나쁘게 나왔다.
 *
 * [무엇을 하나]
 *   - countSubscribers()  : 등록 기기 수 / 실제 수신자 수(알림 켬, 같은 기기는 1명) / 최근 30일 접속
 *   - recordSubscriberEvent(): 신규·해지·만료·교체·묵은정리 사건을 날짜별로 기록
 *   - removeDead()        : 죽은 등록표를 명단에서 지우고 사건을 알맞게 기록 (발송 경로와 점검이 함께 씀)
 *   - runAudit()          : 전 등록표를 FCM 에 "검사만(dry-run)" 요청 — 실제 알림은 가지 않는다
 *   - getStatus()         : 마지막 점검이 언제·어떻게 끝났는지 (조용한 것 ≠ 이상 없는 것)
 *
 * [연계]
 *  - 사용하는 파일 : config/server_config.js(FILES) · services/atomic_write.js · services/firebase_admin_lazy.js
 *  - 나를 쓰는 곳  : routes/push.js(구독·발송 뒤 정리·통계) · routes/admin.js(/api/admin/subscriber-audit)
 *                    · services/subscriber_snapshot.js(일별 기록) · server.js(매일 KST 23:40 자동 점검)
 *  - 화면          : client/js/admin/admin.js renderSubscriberTab()
 *  - 시험          : scripts/test_subscriber_audit.js
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const { FILES } = require('../config/server_config');
const { writeFileAtomic } = require('./atomic_write');

// FCM 이 "이 등록표는 영구히 죽었다"고 답하는 코드 — 발송 경로(routes/push.js _DEAD_FCM)와 같은 기준.
const DEAD_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
]);
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;   // "최근 30일 접속" 기준
const BATCH_SIZE = 100;                        // 발송 경로와 같은 묶음 크기

let _running = false;   // 점검이 겹쳐 돌지 않게 (관리자 버튼 + 자동 점검)

/** 구독 한 줄의 고유값(앱=토큰, 웹=endpoint). 예: {type:'fcm',token:'abc'} → 'abc'
 * @param {object} s - 구독 한 줄  @returns {string|null}
 * [연계] ← countSubscribers / removeDead / runAudit — 같은 줄인지 가리기 위해 */
function subId(s) {
    return s.type === 'fcm' ? s.token : (s.subscription ? s.subscription.endpoint : null);
}

/** 알림을 켠 줄인가 — 발송 필터(routes/push.js `options.master === false` 면 건너뜀)와 같은 기준.
 * @param {object} s  @returns {boolean}
 * [연계] ← countSubscribers / removeDead / routes/push.js(/api/subscribe) */
function isOn(s) {
    return !(s.options && s.options.master === false);
}

/** 명단을 읽는다(없으면 빈 배열).  @returns {object[]}
 * [연계] ← countSubscribers 호출처 / removeDead / runAudit */
function readSubs() {
    if (!fs.existsSync(FILES.SUBSCRIPTIONS)) return [];
    const subs = JSON.parse(fs.readFileSync(FILES.SUBSCRIPTIONS, 'utf8'));
    return Array.isArray(subs) ? subs : [];
}

/**
 * 구독자 수를 센다.
 * 예: 줄 3개(같은 기기 2줄 모두 켬 + 다른 기기 1줄 끔) → { total:3, active:1, masterOff:1, recent30:1 }
 * @param {object[]} subs - 명단
 * @param {number} [now] - 기준 시각(ms)
 * @returns {{total:number,fcm:number,web:number,active:number,masterOff:number,recent30:number}}
 *   total=등록 기기(줄) 수 · active=실제 수신자(알림 켬, 같은 deviceId 는 1명) ·
 *   masterOff=알림 끈 줄 수 · recent30=실제 수신자 중 최근 30일 안에 앱을 연 사람
 * [연계] ← routes/push.js(/api/push-subscriber-stats) · subscriber_snapshot.takeSnapshot — 화면 숫자와 일별 기록이 같은 기준을 쓰게 하기 위해
 */
function countSubscribers(subs, now) {
    const t = now || Date.now();
    let fcm = 0, web = 0, masterOff = 0;
    const devices = new Map();   // 기기 → 최근 30일 안에 갱신된 줄이 있는가
    subs.forEach(function (s) {
        if (s.type === 'fcm') fcm++; else web++;
        if (!isOn(s)) { masterOff++; return; }
        const key = s.deviceId ? 'd:' + s.deviceId : 'i:' + subId(s);
        const recent = !!s.updatedAt && (t - s.updatedAt) <= RECENT_MS;
        devices.set(key, devices.get(key) || recent);
    });
    let recent30 = 0;
    devices.forEach(function (r) { if (r) recent30++; });
    return { total: subs.length, fcm: fcm, web: web, active: devices.size, masterOff: masterOff, recent30: recent30 };
}

/**
 * 구독 사건을 날짜(KST)별로 더해 기록한다.
 * 예: recordSubscriberEvent('expired', 3) → subscriber_events.json["2026-11-18"].expired += 3
 * @param {string} eventType - 'subscribe'(신규·다시 켬) | 'unsubscribe'(알림 끔) | 'expired'(죽은 등록표 정리)
 *                             | 'replaced'(같은 기기의 등록표 교체 — 사람 수 변화 없음)
 *                             | 'backlog'(첫 점검에서 지운 묵은 죽은 등록표 — 그날 이탈이 아님)
 * @param {number} count - 건수
 * [연계] ← routes/push.js(/api/subscribe) · removeDead / → /api/subscriber-events 가 이 파일을 화면에 준다
 */
function recordSubscriberEvent(eventType, count) {
    try {
        if (!eventType || !count || count <= 0) return;
        const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
        let events = {};
        if (fs.existsSync(FILES.SUBSCRIBER_EVENTS)) {
            events = JSON.parse(fs.readFileSync(FILES.SUBSCRIBER_EVENTS, 'utf8'));
        }
        if (!events[todayStr]) events[todayStr] = { subscribe: 0, unsubscribe: 0, expired: 0 };
        events[todayStr][eventType] = (events[todayStr][eventType] || 0) + count;
        writeFileAtomic(FILES.SUBSCRIBER_EVENTS, JSON.stringify(events, null, 2), 'utf8');
    } catch (e) {
        console.error('[SubscriberEvent] 이벤트 기록 실패:', e.message);
    }
}

/**
 * 구독 등록 요청 하나가 어떤 사건인지 가린다(명단에 넣기 **전에** 부른다).
 * 예: 명단에 같은 기기의 켜진 줄이 있는데 새 등록표가 옴 → 'replaced' / 켜져 있던 줄이 끔으로 옴 → 'unsubscribe'
 * @param {object[]} subs - 지금 명단   @param {number} existingIndex - 같은 등록표의 자리(-1 이면 새 줄)
 * @param {object} newEntry - 들어온 줄
 * @returns {string|null} 'subscribe'(새 사람·다시 켬) | 'unsubscribe'(알림 끔) | 'replaced'(같은 기기의 새 등록표) | null(변화 없음)
 * [연계] ← routes/push.js(/api/subscribe) → recordSubscriberEvent — 「실제 수신자」 증감과 사건 기록을 맞추기 위해.
 *          ※ 예전에는 앱이 해지 창구를 부르지 않아 해지가 늘 0건이었고, 등록표 교체가 신규로 세어졌다.
 */
function subscribeEventType(subs, existingIndex, newEntry) {
    // ★줄 단위로 따지지 않고 「실제 수신자 수가 어떻게 바뀌나」로 정한다 — 그래야 사건 합계와 숫자가 어긋날 수 없다.
    //   (독립 검토 2026-11-18: 같은 기기의 옛 줄이 남아 있을 때 끄면 수는 그대로인데 해지가 세어졌다.)
    const next = subs.slice();
    if (existingIndex !== -1) next[existingIndex] = newEntry; else next.push(newEntry);
    const diff = countSubscribers(next).active - countSubscribers(subs).active;
    if (diff > 0) return 'subscribe';
    if (diff < 0) return 'unsubscribe';
    return (existingIndex === -1 && isOn(newEntry)) ? 'replaced' : null;
}

/**
 * 죽은 등록표를 명단에서 지우고, 사건을 알맞게 기록한다.
 * 예: removeDead(new Set(['tokA'])) → { removed:1, expired:1, replaced:0, off:0 }
 *   - expired  = 지워서 「실제 수신자 수」가 줄어든 만큼 → 'expired' 로 기록(opts.backlog 면 'backlog')
 *   - off      = 알림을 끈 줄(끌 때 이미 '해지'로 셌다) → 사건 없음
 *   - replaced = 같은 기기의 켜진 줄이 따로 남아 사람 수가 그대로인 옛 줄 → 사건 없음
 * @param {Set<string>} deadIds - 죽은 줄의 고유값(subId)
 * @param {{backlog?:boolean, backup?:boolean}} [opts] - backlog=묵은 정리로 기록 · backup=지우기 전 명단 사본 저장
 * @returns {{removed:number,expired:number,replaced:number,off:number}}
 * [연계] ← routes/push.js(발송 뒤 정리 2곳) · runAudit — 지우는 기준과 기록을 한 곳에 두기 위해.
 *          ★명단을 **지금 다시 읽어** 지운다(발송 도중 들어온 새 구독을 덮어쓰지 않게).
 */
function removeDead(deadIds, opts) {
    const o = opts || {};
    const out = { removed: 0, expired: 0, replaced: 0, off: 0 };
    if (!deadIds || deadIds.size === 0) return out;
    const all = readSubs();
    const kept = all.filter(function (s) { return !deadIds.has(subId(s)); });
    const dead = all.filter(function (s) { return deadIds.has(subId(s)); });
    if (dead.length === 0) return out;
    // 이탈 = 「실제 수신자 수」가 줄어든 만큼(같은 기기 줄 둘이 함께 죽어도 1명). 나머지는 끈 줄이거나 교체된 옛 줄.
    out.removed = dead.length;
    out.expired = countSubscribers(all).active - countSubscribers(kept).active;
    out.off = dead.filter(function (s) { return !isOn(s); }).length;
    out.replaced = out.removed - out.off - out.expired;
    if (o.backup) fs.copyFileSync(FILES.SUBSCRIPTIONS, FILES.SUBSCRIPTIONS.replace(/\.json$/, '.before_cleanup.json'));
    writeFileAtomic(FILES.SUBSCRIPTIONS, JSON.stringify(kept, null, 2));
    recordSubscriberEvent(o.backlog ? 'backlog' : 'expired', out.expired);
    return out;
}

/** 마지막 점검 기록을 읽는다.
 * @returns {{lastRun:object|null, lastApplied:object|null, running:boolean}} lastRun=가장 최근 점검(검사만 포함) · lastApplied=가장 최근 "정리까지 한" 점검
 * [연계] ← routes/admin.js(GET /api/admin/subscriber-audit) — 화면이 "언제·어떻게 끝났나"를 띄우기 위해 */
function getStatus() {
    let st = { lastRun: null, lastApplied: null };
    try {
        if (fs.existsSync(FILES.SUBSCRIBER_AUDIT)) st = JSON.parse(fs.readFileSync(FILES.SUBSCRIBER_AUDIT, 'utf8'));
    } catch (e) { /* 깨진 기록은 없는 것으로 본다 */ }
    return { lastRun: st.lastRun || null, lastApplied: st.lastApplied || null, running: _running };
}

/**
 * 전 등록표를 FCM 에 "검사만" 요청해 죽은 것을 가려낸다. 실제 알림은 가지 않는다(dry-run).
 * 예: await runAudit({ apply:false }) → { ok:true, apply:false, checked:1384, dead:37, unknown:2, ... } (지우지 않음)
 *     await runAudit({ apply:true })  → 위와 같고 죽은 37건을 지운 뒤 removed/expired/replaced/off 를 채운다
 * @param {{apply?:boolean, trigger?:string, messaging?:object}} [opts]
 *   apply=true 면 죽은 등록표를 지운다 · trigger='manual'|'cron' · messaging=시험용 대역(없으면 firebase-admin)
 * @returns {Promise<object>} 점검 결과(그대로 subscriber_audit.json 에 남는다). 실패하면 { ok:false, error }
 * [연계] ← routes/admin.js(POST /api/admin/subscriber-audit) · server.js(매일 KST 23:40)
 *        → removeDead(지우기) — 죽었다는 판정 코드는 발송 경로와 같다(DEAD_CODES).
 *          그 밖의 오류(일시 장애·인증 문제 등)는 unknown 으로만 세고 **지우지 않는다.**
 */
async function runAudit(opts) {
    const o = opts || {};
    const result = { at: Date.now(), apply: !!o.apply, trigger: o.trigger || 'manual', ok: false };
    if (_running) return Object.assign(result, { error: '이미 점검 중입니다.' });
    _running = true;
    try {
        let messaging = o.messaging;
        if (!messaging) {
            const admin = require('./firebase_admin_lazy').getAdmin();
            if (!admin || admin.apps.length === 0) throw new Error('FCM(푸시 서버) 연결을 쓸 수 없습니다.');
            messaging = admin.messaging();
        }
        const targets = readSubs().filter(function (s) { return s.type === 'fcm' && s.token; });
        const deadIds = new Set();
        const errorCodes = {};
        let alive = 0, unknown = 0;
        for (let i = 0; i < targets.length; i += BATCH_SIZE) {
            await Promise.all(targets.slice(i, i + BATCH_SIZE).map(async function (s) {
                try {
                    await messaging.send({ token: s.token, data: { type: 'audit' } }, true);   // true = 검사만
                    alive++;
                } catch (err) {
                    const code = (err && err.code) || 'unknown';
                    errorCodes[code] = (errorCodes[code] || 0) + 1;
                    if (DEAD_CODES.has(code)) deadIds.add(s.token); else unknown++;
                }
            }));
        }
        Object.assign(result, { checked: targets.length, alive: alive, dead: deadIds.size, unknown: unknown, errorCodes: errorCodes });
        // ★한 건도 「살아 있다」고 확인되지 않으면 실패로 보고 **아무것도 지우지 않는다.**
        //   firebase-admin 은 FCM 의 일반 404(NOT_FOUND — 등록표가 아니라 프로젝트 쪽 문제일 수 있다)도
        //   「등록표 죽음」과 같은 코드로 돌려준다(lib/utils/error.js). 이 확인이 없으면 FCM·인증 쪽 오류
        //   한 번에 매일 자동 정리가 명단 전체를 지운다. (인증 오류로 전부 「확인 못 함」인 경우도 여기서 실패로 남는다.)
        if (targets.length > 0 && alive === 0) {
            throw new Error('살아 있는 등록표를 한 건도 확인하지 못했습니다(죽음 ' + deadIds.size + ' · 확인 못 함 ' + unknown + '). FCM 연결·인증 문제일 수 있어 지우지 않았습니다.');
        }
        const prev = getStatus();
        if (o.apply) {
            // 첫 정리에서 나오는 것은 그날 떠난 사람이 아니라 그동안 쌓인 것 → 'backlog' 로 따로 적는다.
            Object.assign(result, removeDead(deadIds, { backlog: !prev.lastApplied, backup: true }));
        }
        result.ok = true;
        result.counts = countSubscribers(readSubs());
    } catch (e) {
        result.error = e.message;
        console.error('[SubscriberAudit] 점검 실패:', e.message);
    } finally {
        _running = false;
    }
    try {
        const prev = getStatus();
        const st = { lastRun: result, lastApplied: (result.ok && result.apply) ? result : prev.lastApplied };
        writeFileAtomic(FILES.SUBSCRIBER_AUDIT, JSON.stringify(st, null, 2), 'utf8');
    } catch (e) {
        console.error('[SubscriberAudit] 점검 기록 저장 실패:', e.message);
    }
    console.log('[SubscriberAudit] ' + JSON.stringify(result));
    return result;
}

module.exports = { subId, isOn, readSubs, countSubscribers, subscribeEventType, recordSubscriberEvent, removeDead, getStatus, runAudit, DEAD_CODES };
