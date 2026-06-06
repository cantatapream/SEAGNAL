/**
 * ============================================================================
 * 파일명: routes/push.js
 * 역할: 푸시 알림 구독/발송/이력 관리 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 Web Push 및 FCM 푸시 알림의 핵심 API를 관리합니다.
 * - GET /api/vapid-public-key → VAPID 공개키 제공 (클라이언트 구독용)
 * - POST /api/subscribe → 알림 구독 추가/갱신 (Web Push + FCM 이중 지원)
 * - POST /api/unsubscribe → 알림 구독 취소
 * - POST /api/push-custom → 커스텀/개인화 푸시 발송 (Broadcast + Personalized)
 * - GET /api/push-history → 발송 이력 조회
 * - DELETE /api/push-history/:id → 개별 이력 삭제
 * - DELETE /api/push-history → 전체/선택 이력 삭제
 *
 * [연계 파일]
 * - services/push_helpers.js → 구역 매칭, 메시지 생성 로직
 * - config/server_config.js → DATA_DIR 경로 사용
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * 이 앱은 해상 특보(풍랑주의보 등)가 발령되면 사용자에게 푸시 알림을 보냅니다.
 * 사용자는 관심 해역(예: 제주, 서해)을 구독하면, 해당 해역의 특보만 받습니다.
 * Web Push(브라우저)와 FCM(앱/Firebase) 두 가지 방식을 모두 지원합니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
// [Lazy] web-push SDK + VAPID 설정도 첫 발송 시점까지 미룬다.
//        require + setVapidDetails 가 startup 에서 약 2초를 소비하던 것을 절약.
//        getWebPush() 를 통해 webpush 인스턴스에 접근한다.
let _webpush = null;
let _vapidConfigured = false;
let _webpushInitDone = false;
/**
 * web-push 라이브러리 lazy init + VAPID 키 설정.
 * 패키지 미설치 또는 환경변수 미설정 시 null 반환 — 호출자는 푸시 발송 스킵.
 *
 * [멱등성] _webpushInitDone 플래그로 1회만 require + 설정. 두 번째 호출은 캐시.
 *
 * [환경변수]
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY — Web Push VAPID 인증 키
 */
function getWebPush() {
    if (_webpushInitDone) return _webpush;
    _webpushInitDone = true;
    try {
        _webpush = require('web-push');
        if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
            try {
                _webpush.setVapidDetails(
                    process.env.VAPID_SUBJECT || 'mailto:seagnal_admin@example.com',
                    process.env.VAPID_PUBLIC_KEY,
                    process.env.VAPID_PRIVATE_KEY
                );
                _vapidConfigured = true;
                console.log('🔔 Web Push VAPID 설정 완료 (lazy)');
            } catch (err) {
                console.error('⚠️ VAPID 설정 실패 (푸시 비활성화):', err.message);
            }
        }
    } catch (e) {
        console.error('⚠️ web-push 모듈 로딩 실패:', e && e.message);
        _webpush = null;
    }
    return _webpush;
}

// [Lazy] firebase-admin SDK 는 services/firebase_admin_lazy.js 의 getAdmin() 으로 첫 사용 시 로딩.
//        admin.* 사용 부분에서 getAdmin() 호출 후 null 체크하여 사용한다.
const { getAdmin } = require('../services/firebase_admin_lazy');
const { DATA_DIR, FILES } = require('../config/server_config');
const { expandToMinorZones, getMatchedZones, generateMessage, paginateByZoneBlocks } = require('../services/push_helpers');

const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const HISTORY_FILE = path.join(DATA_DIR, 'custom_push_history.json');
// [push_counter] 누적 카운터 — push_history 500 한도 우회.
const pushCounter = require('../services/push_counter');

// ============================================================================
// 구독/해지 이벤트 기록 함수
// ============================================================================

/**
 * 구독 또는 해지 이벤트를 일별로 집계하여 기록합니다.
 *
 * [데이터 구조]
 * subscriber_events.json:
 * {
 *   "2026-04-05": { "subscribe": 3, "unsubscribe": 1, "expired": 2 },
 *   "2026-04-04": { "subscribe": 5, "unsubscribe": 0, "expired": 0 },
 *   ...
 * }
 *
 * [이벤트 유형]
 * - subscribe: 신규 구독 (기존에 없던 사용자가 처음 구독)
 * - unsubscribe: 수동 해지 (사용자가 직접 구독 취소)
 * - expired: 만료 자동 정리 (FCM 토큰 만료 등으로 서버에서 자동 제거)
 *
 * @param {string} eventType - 'subscribe' | 'unsubscribe' | 'expired'
 * @param {number} count - 이벤트 발생 건수 (기본 1)
 *
 * [연계]
 * - config/server_config.js → FILES.SUBSCRIBER_EVENTS 경로
 * - /api/subscribe → 신규 구독 시 'subscribe' 기록
 * - /api/unsubscribe → 수동 해지 시 'unsubscribe' 기록
 * - /api/push-custom → 만료 토큰 정리 시 'expired' 기록
 * - /api/subscriber-events → 이 데이터를 조회하는 API
 * - js/admin.js → 구독 현황 탭의 이탈률 카드에서 활용
 */
function recordSubscriberEvent(eventType, count) {
    try {
        if (!count || count <= 0) return;

        // KST 기준 오늘 날짜
        var now = new Date();
        var kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        var todayStr = kstDate.toISOString().split('T')[0];

        // 기존 이벤트 로그 읽기
        var events = {};
        if (fs.existsSync(FILES.SUBSCRIBER_EVENTS)) {
            events = JSON.parse(fs.readFileSync(FILES.SUBSCRIBER_EVENTS, 'utf8'));
        }

        // 오늘 날짜 항목이 없으면 초기화
        if (!events[todayStr]) {
            events[todayStr] = { subscribe: 0, unsubscribe: 0, expired: 0 };
        }

        // 해당 이벤트 카운트 증가
        events[todayStr][eventType] = (events[todayStr][eventType] || 0) + count;

        fs.writeFileSync(FILES.SUBSCRIBER_EVENTS, JSON.stringify(events, null, 2), 'utf8');
    } catch (e) {
        console.error('[SubscriberEvent] 이벤트 기록 실패:', e.message);
    }
}

// ============================================================================
// VAPID 설정 — getWebPush() 안으로 이동 (lazy).
// 첫 푸시 발송 또는 vapid 관련 호출 시점에 require + setVapidDetails 가 1회 수행됨.
// ============================================================================

// ============================================================================
// 구독 관리 API
// ============================================================================

// 구독 키 조회 (클라이언트가 사용할 Public Key 제공)
router.get('/api/vapid-public-key', (req, res) => {
    if (process.env.VAPID_PUBLIC_KEY) {
        res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
    } else {
        res.status(500).json({ error: 'VAPID Key 미설정' });
    }
});

// 구독 추가/갱신 (Web Push & FCM)
router.post('/api/subscribe', (req, res) => {
    const { subscription, token, zones, options, deviceId } = req.body;

    const isWebPush = subscription && subscription.endpoint;
    const isFcm = !!token;

    if (!isWebPush && !isFcm) {
        return res.status(400).json({ error: '유효하지 않은 구독 정보 (WebPush or FCM required)' });
    }

    let subs = [];
    try {
        if (fs.existsSync(SUBS_FILE)) {
            subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
        }

        const id = isWebPush ? subscription.endpoint : token;

        const existingIndex = subs.findIndex(s => {
            const sId = s.type === 'fcm' ? s.token : (s.subscription ? s.subscription.endpoint : null);
            return sId === id;
        });

        const newEntry = {
            type: isFcm ? 'fcm' : 'web',
            token: isFcm ? token : undefined,
            subscription: isWebPush ? subscription : undefined,
            zones: Array.isArray(zones) ? zones : [],
            options: options || { alert: true, release: true },
            deviceId: deviceId || undefined,
            updatedAt: Date.now()
        };

        if (existingIndex !== -1) {
            // 기존 구독자 설정 갱신 (구독 해역/옵션 변경 등) → 신규 구독이 아니므로 이벤트 미기록
            subs[existingIndex] = newEntry;
        } else {
            // 신규 구독자 추가 → 이벤트 기록
            subs.push(newEntry);
            recordSubscriberEvent('subscribe', 1);
        }

        fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
        res.json({ success: true, message: '알림 구독 완료' });
    } catch (e) {
        console.error('구독 저장 실패:', e);
        res.status(500).json({ error: '서버 오류' });
    }
});

// 구독 취소 (삭제)
router.post('/api/unsubscribe', (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint 누락' });

    try {
        if (fs.existsSync(SUBS_FILE)) {
            let subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
            const initialLen = subs.length;
            subs = subs.filter(s => s.subscription.endpoint !== endpoint);

            // 실제로 삭제된 구독자가 있으면 파일 저장 + 해지 이벤트 기록
            var removedCount = initialLen - subs.length;
            if (removedCount > 0) {
                fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
                recordSubscriberEvent('unsubscribe', removedCount);
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '취소 실패' });
    }
});

// ============================================================================
// 커스텀 푸시 발송 API (Broadcast + Personalized)
// ============================================================================
router.post('/api/push-custom', async (req, res) => {
    const { title, content, targetZones, isManualGroupSend, payload, sendToAllSubscribers, adminToken } = req.body;

    // 수동 그룹 발송 모드 (개인화 필터링 적용)
    if (isManualGroupSend && payload) {
        if (!payload.items || payload.items.length === 0) {
            return res.status(400).json({ error: '발송 데이터가 없습니다.' });
        }
    } else {
        if (!title || !content || !targetZones) {
            return res.status(400).json({ error: '제목, 내용, 발송 대상은 필수입니다.' });
        }
    }

    try {
        if (!fs.existsSync(SUBS_FILE)) {
            return res.status(404).json({ error: '구독자가 없습니다.' });
        }

        let subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));

        // 관리자 테스트 모드: adminToken이 있으면 해당 토큰의 구독자로만 한정
        if (adminToken) {
            const originalCount = subs.length;
            subs = subs.filter(s => s.type === 'fcm' && s.token === adminToken);
            console.log(`🔧 [Push] 관리자 테스트 모드: ${originalCount}명 중 관리자 토큰 매칭 ${subs.length}명`);
            if (subs.length === 0) {
                return res.json({ success: true, successCount: 0, failCount: 0, message: '관리자 토큰과 일치하는 구독자가 없습니다.' });
            }
        }

        let successCount = 0;
        let failCount = 0;
        let deadSubscriptionsFound = false;

        // 배치 발송 (100명씩 끊어서 발송하여 메모리 절약)
        const BATCH_SIZE = 100;
        for (let i = 0; i < subs.length; i += BATCH_SIZE) {
            const batch = subs.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (user) => {
                // 1. 전체 알림 수신 거부 확인
                if (user.options && user.options.master === false) return;

                let finalTitle = title;
                let finalBody = content;
                let shouldSend = false;
                let userFilteredItems = null;

                // 2. 모드별 처리
                if (isManualGroupSend && payload) {
                    // [개인화 모드]
                    userFilteredItems = getMatchedZones(user.zones, payload.items, user.options || {});
                    if (!userFilteredItems || userFilteredItems.length === 0) return;

                    // [작업2b] "특정관리해역 푸시 알림 허용" — 기본 ON.
                    //   명시적으로 childZones===false 인 사용자만 자식 한정사 미표시.
                    //   (토글 추가 이전 구독자는 키가 없으므로 기본 ON으로 동작 — 마이그레이션)
                    const showChildZones = !(user.options && user.options.childZones === false);
                    const generated = generateMessage({ ...payload, items: userFilteredItems, showChildZones });
                    // 연장 등에서 본문이 비면(예: childZones OFF + 자식 단독 연장) 미발송.
                    if (!generated.body || !generated.title) return;
                    finalTitle = generated.title;
                    finalBody = generated.body;
                    shouldSend = true;
                } else {
                    // [기존 커스텀 모드]
                    const sendAll = sendToAllSubscribers || targetZones.includes('전체 해역') || targetZones.includes('전체해역') || targetZones.includes('구독자 전원');
                    const zoneList = sendAll ? [] : targetZones.split(',').map(z => z.trim());

                    if (sendAll || (user.options && user.options.target === 'all')) {
                        shouldSend = true;
                    } else {
                        const expandedUserZones = expandToMinorZones(user.zones);
                        if (!expandedUserZones || expandedUserZones.length === 0) {
                            shouldSend = true;
                        } else {
                            const hasMatch = zoneList.some(tz => expandedUserZones.includes(tz));
                            shouldSend = hasMatch;
                        }
                    }
                }

                if (!shouldSend) return;

                // 3. 시나리오별 수신 설정 필터링 (announce/active/release/night)
                if (isManualGroupSend && payload) {
                    const opts = user.options || {};
                    const tid = payload.templateId;

                    // 발표 관련 (publish, 격상/격하 발표, 발효시각 변경)
                    if (opts.announce === false &&
                        ['publish', 'level_upgrade_publish', 'level_downgrade_publish', 'time_ef_change'].includes(tid)) {
                        return;
                    }
                    // 발효 관련 (active, 격상/격하 발효, 해제시각 변경)
                    if (opts.active === false &&
                        ['active', 'level_upgrade_active', 'level_downgrade_active', 'time_yn_change'].includes(tid)) {
                        return;
                    }
                    // 해제 — 예비특보 취소(prelim_cancel)도 ✅ 해제 계열로 묶어 release 토글에 연동.
                    //   (이전엔 어떤 콘텐츠 토글에도 안 걸려 야간 외엔 무조건 발송되던 비대칭 해소.)
                    if (opts.release === false && (tid === 'release' || tid === 'prelim_cancel')) {
                        return;
                    }
                    // [자식 독립 푸시] additional_active(추가 발효) / partial_release(일부 해제)
                    //   - 자식(연안바다/평수구역) 전용 알림 → childZones OFF 사용자는 수신 안 함
                    //   - 추가 발효 ~ 발효 계열 토글, 일부 해제 ~ 해제 계열 토글 적용
                    if (['additional_active', 'partial_release'].includes(tid) && opts.childZones === false) {
                        return;
                    }
                    if (opts.active === false && tid === 'additional_active') {
                        return;
                    }
                    if (opts.release === false && tid === 'partial_release') {
                        return;
                    }
                    // 연장: 발효예정연장 ~ 발표(announce) 계열, 해제예정연장 ~ 발효(active) 계열
                    if (opts.announce === false && tid === 'ef_extend') {
                        return;
                    }
                    if (opts.active === false && tid === 'yn_extend') {
                        return;
                    }
                    // 야간 수신 거부 (KST 23:00 ~ 07:00) — UI 라벨과 일치
                    if (opts.night === false) {
                        const kstHour = (new Date().getUTCHours() + 9) % 24;
                        if (kstHour >= 23 || kstHour < 7) {
                            return;
                        }
                    }
                }

                try {
                    // URL 파라미터 구성 (개인화 정보 포함)
                    const params = new URLSearchParams();
                    params.append('popup', 'true');
                    if (isManualGroupSend && payload) {
                        const fullAlertType = (payload.typeName || '') + (payload.level ? payload.level : '');
                        params.append('alertType', fullAlertType);
                        params.append('status', payload.templateId);
                        params.append('tmFc', payload.items[0].tmFc || '');
                        params.append('tmEf', payload.items[0].tmEf || '');
                        params.append('tmYn', payload.items[0].tmYn || '');
                        params.append('zones', userFilteredItems.flatMap(i => i.zones).join(','));
                    }
                    const BASE_URL = 'https://seagnal-server.fly.dev';
                    const url = `${BASE_URL}/?tab=weather-alert-section&${params.toString()}`;

                    // [연장 분할] ef_extend/yn_extend 는 본문이 길면 (n/N) 으로 나눠 다건 발송.
                    //   그 외는 단건. 동일 url(딥링크) 공유.
                    const isExtend = isManualGroupSend && payload &&
                        (payload.templateId === 'ef_extend' || payload.templateId === 'yn_extend');
                    const parts = isExtend
                        ? paginateByZoneBlocks(finalTitle, finalBody)
                        : [{ title: finalTitle, body: finalBody }];

                    if (user.type === 'fcm' && user.token) {
                        // [Lazy] 여기서 처음으로 firebase-admin 이 로딩되고 initializeApp 이 호출됨
                        const admin = getAdmin();
                        if (admin && admin.apps.length > 0) {
                            for (const part of parts) {
                                try {
                                    await admin.messaging().send({
                                        token: user.token,
                                        notification: { title: part.title, body: part.body },
                                        data: { url: url, type: isManualGroupSend ? 'manual_group' : 'custom_push' },
                                        android: { priority: 'high' },
                                        apns: { headers: { 'apns-priority': '10' } }
                                    });
                                    successCount++;
                                } catch (err) {
                                    failCount++;
                                    if (err.code === 'messaging/registration-token-not-registered' || err.code === 'messaging/invalid-registration-token') {
                                        user._isDead = true;
                                        deadSubscriptionsFound = true;
                                        break;
                                    }
                                }
                            }
                        }
                    } else if (user.subscription) {
                        for (const part of parts) {
                            try {
                                const pushPayload = JSON.stringify({ title: part.title, body: part.body, url: url });
                                // [Lazy] 첫 호출 시 web-push 로딩 + VAPID 설정
                                const webpush = getWebPush();
                                if (!webpush) {
                                    throw new Error('web-push SDK 사용 불가');
                                }
                                await webpush.sendNotification(user.subscription, pushPayload, {
                                    TTL: 86400,
                                    urgency: 'high'
                                });
                                successCount++;
                            } catch (err) {
                                failCount++;
                                if (err.statusCode === 404 || err.statusCode === 410) {
                                    user._isDead = true;
                                    deadSubscriptionsFound = true;
                                    break;
                                }
                            }
                        }
                    }
                } catch (e) {
                    failCount++;
                }
            });

            await Promise.all(batchPromises);
        }

        // 만료된 구독자 정리 (관리자 테스트 모드에서는 실제 구독 파일 건드리지 않음)
        if (deadSubscriptionsFound && !adminToken) {
            const allSubs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
            const deadTokens = new Set(subs.filter(u => u._isDead).map(u => u.type === 'fcm' ? u.token : (u.subscription ? u.subscription.endpoint : null)));
            const updatedSubs = allSubs.filter(s => {
                const sId = s.type === 'fcm' ? s.token : (s.subscription ? s.subscription.endpoint : null);
                return !deadTokens.has(sId);
            });
            var expiredCount = allSubs.length - updatedSubs.length;
            fs.writeFileSync(SUBS_FILE, JSON.stringify(updatedSubs, null, 2));
            console.log(`🧹 [Push/Manual] 만료된 구독 데이터 ${expiredCount}건 정리 완료`);
            // 만료 자동 정리 이벤트 기록
            recordSubscriberEvent('expired', expiredCount);
        }

        // 관리자 테스트 모드에서는 히스토리 기록 생략
        if (adminToken) {
            console.log(`🔧 [Push] 관리자 테스트 모드 발송 완료: 성공 ${successCount}, 실패 ${failCount}`);
            return res.json({ success: true, successCount, failCount, testMode: true });
        }

        // [History Save]
        let histTitle = title;
        let histContent = content;
        let histTarget = targetZones;

        if (isManualGroupSend && payload) {
            const gen = generateMessage(payload);
            histTitle = gen.title;
            histContent = gen.body;
            histTarget = payload.items.flatMap(i => i.zones).join(', ');
        }

        let history = [];
        if (fs.existsSync(HISTORY_FILE)) {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }

        const kstDate = new Date(Date.now() + (9 * 60 * 60 * 1000));
        const timeStr = kstDate.toISOString().replace('T', ' ').substring(2, 16).replace(/-/g, '.');

        const newLog = {
            id: Date.now() + Math.floor(Math.random() * 1000),
            time: timeStr,
            title: histTitle,
            content: histContent,
            target: histTarget,
            count: successCount,
            status: 'sent',
            type: req.body.type || 'manual',
            tab: isManualGroupSend
                ? (payload.templateId && payload.templateId.startsWith('level_')
                    ? 'level'
                    : (payload.templateId === 'time_ef_change' || payload.templateId === 'time_yn_change'
                        ? 'change-time'
                        : (payload.templateId || 'active')))
                : 'custom',
            tmRef: isManualGroupSend ? (payload.items[0].tmFc || payload.items[0].tmEf || '') : ''
        };
        history.unshift(newLog);
        if (history.length > 500) history = history.slice(0, 500);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

        // [push_counter] 누적 카운터 증가 — history 500 한도 우회.
        try {
            pushCounter.incrementSend(successCount || 0);
        } catch (_e) { /* counter 실패 무시 */ }

        res.json({ success: true, successCount, failCount });
    } catch (e) {
        console.error('커스텀 푸시 발송 실패:', e);
        res.status(500).json({ error: e.message });
    }
});

// ============================================================================
// 푸시 이력 관리 API
// ============================================================================

// 이력 조회
// - 기본(쿼리 page 없음): 전체 배열을 그대로 반환 (하위호환 — 기존 호출자 영향 없음)
// - page 쿼리 있을 때: { data, pagination } 형태로 반환
//   (정렬은 항상 id 역순(최신 우선) — 기존 데이터는 unshift 로 이미 최신순이지만
//    안전을 위해 명시적으로 정렬)
router.get('/api/push-history', (req, res) => {
    try {
        let history = [];
        if (fs.existsSync(HISTORY_FILE)) {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }

        // 최신순 정렬 (id 가 Date.now 기반이라 큰 값일수록 최신)
        if (Array.isArray(history)) {
            history.sort((a, b) => (b.id || 0) - (a.id || 0));
        }

        // 페이지네이션 요청 여부
        const hasPageQuery = Object.prototype.hasOwnProperty.call(req.query, 'page');
        if (!hasPageQuery) {
            // 하위호환: 기존처럼 raw array 반환
            return res.json(history);
        }

        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
        const total = history.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const start = (page - 1) * limit;
        const data = history.slice(start, start + limit);

        res.json({
            data,
            pagination: { page, limit, total, totalPages }
        });
    } catch (e) {
        res.status(500).json({ error: '이력 조회 실패' });
    }
});

// 이력 삭제 (개별)
router.delete('/api/push-history/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (!fs.existsSync(HISTORY_FILE)) return res.json({ success: true });

        let history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        history = history.filter(h => h.id !== id);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '삭제 실패' });
    }
});

// 이력 삭제 (전체 또는 선택)
router.delete('/api/push-history', (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids) {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify([], null, 2));
        } else {
            let history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            history = history.filter(h => !ids.includes(h.id));
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: '삭제 실패' });
    }
});

// ============================================================================
// [push_counter] 누적 푸시 발송 카운터 조회 (500 한도 우회)
// ============================================================================
// push_history 는 500건으로 capped 되어 admin UI 의 "총 N회 M개" 표시가
// 500 이상으로 증가하지 않는 문제를 해결.
//
// 응답: { totalSends: 12345, totalCount: 98765 }
//   - totalSends: 발송 cycle 수 (모든 push 경로 통합)
//   - totalCount: 발송된 push 총 개수 (수신자 수 합산)
//
// 부팅 시 counter 파일이 없으면 기존 push_history.json 으로부터 1회 마이그레이션.
router.get('/api/push-counter', (req, res) => {
    try {
        const c = pushCounter.get();
        res.json(c);
    } catch (e) {
        console.error('[push-counter] 조회 실패:', e && e.message);
        res.status(500).json({ error: '조회 실패' });
    }
});

// ============================================================================
// 구독자 통계 API (해역별 구독자 수, 총 구독자 수 등)
// ============================================================================

/**
 * GET /api/push-subscriber-stats
 *
 * 해역별 구독자 수와 전체 통계를 반환합니다.
 * 관리자 센터의 여러 화면에서 사용됩니다:
 * - 발송 이력: 해역별 현재 구독자 수 표시
 * - 직접 발송: 해역 선택 시 각 해역 옆에 구독자 수 표시
 * - 이용자 현황 탭: 전체 구독자 분포 표시
 *
 * [응답 형식]
 * {
 *   totalSubscribers: 501,       // 전체 구독자 수
 *   fcmCount: 312,               // FCM(앱) 구독자 수
 *   webCount: 189,               // Web Push(브라우저) 구독자 수
 *   zoneCounts: {                // 소분류 해역별 구독자 수 (35개)
 *     "강원북부앞바다": 480,
 *     "제주도서부앞바다": 485,
 *     ...
 *   }
 * }
 *
 * [연계]
 * - services/push_helpers.js → expandToMinorZones()로 대/중분류를 소분류로 확장
 * - js/alert_push.js → 직접 발송 탭에서 이 API를 호출하여 구독자 수 표시
 * - js/admin.js → 이용자 현황 탭에서 이 API를 호출
 */
router.get('/api/push-subscriber-stats', (req, res) => {
    try {
        // 1. 구독자 파일 읽기
        let subs = [];
        if (fs.existsSync(SUBS_FILE)) {
            subs = JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
        }

        // 2. FCM / Web Push 구분 카운트
        let fcmCount = 0;
        let webCount = 0;

        // 3. 소분류 해역별 구독자 수 집계
        //    - 각 구독자의 zones 배열을 소분류(35개)로 확장
        //    - zones가 비어있으면 "모든 해역 수신" → 35개 전부에 카운트
        const zoneCounts = {};

        // ZONE_HIERARCHY에서 전체 소분류 목록 추출 (초기값 0으로 세팅)
        const { ZONE_HIERARCHY } = require('../services/push_helpers');
        const allMinorZones = [];
        for (const major of Object.values(ZONE_HIERARCHY)) {
            for (const minors of Object.values(major)) {
                minors.forEach(z => allMinorZones.push(z));
            }
        }
        allMinorZones.forEach(z => { zoneCounts[z] = 0; });

        subs.forEach(sub => {
            // FCM/Web 구분
            if (sub.type === 'fcm') fcmCount++;
            else webCount++;

            // 해역 확장: 빈 배열이거나 target='all'이면 전체 해역 구독으로 간주
            const isAllZones = (!sub.zones || sub.zones.length === 0) ||
                               (sub.options && sub.options.target === 'all');

            if (isAllZones) {
                // 전체 해역 구독자 → 모든 소분류에 +1
                allMinorZones.forEach(z => { zoneCounts[z]++; });
            } else {
                // 개별 해역 구독자 → 소분류로 확장하여 해당 해역에만 +1
                const expanded = expandToMinorZones(sub.zones);
                expanded.forEach(z => {
                    if (zoneCounts[z] !== undefined) zoneCounts[z]++;
                });
            }
        });

        res.json({
            totalSubscribers: subs.length,
            fcmCount,
            webCount,
            zoneCounts
        });
    } catch (e) {
        console.error('구독자 통계 조회 실패:', e);
        res.status(500).json({ error: '통계 조회 실패' });
    }
});

// ============================================================================
// 구독자 일별 스냅샷 이력 조회 API
// ============================================================================

/**
 * 구독자 증감 추이를 분석하기 위한 일별 스냅샷 데이터를 반환합니다.
 *
 * [응답 형태]
 * {
 *   "2026-04-05": { "total": 690, "fcm": 690, "web": 0 },
 *   "2026-04-04": { "total": 678, "fcm": 678, "web": 0 },
 *   ...
 * }
 *
 * [연계]
 * - services/subscriber_snapshot.js → takeSnapshot()이 이 데이터를 매일 기록
 * - js/admin.js → renderSubscriberTab()에서 이 API를 호출하여 추이 차트/증감 카드 표시
 */
router.get('/api/subscriber-history', (req, res) => {
    try {
        if (fs.existsSync(FILES.SUBSCRIBER_STATS)) {
            const stats = JSON.parse(fs.readFileSync(FILES.SUBSCRIBER_STATS, 'utf8'));
            res.json(stats);
        } else {
            res.json({});
        }
    } catch (e) {
        console.error('구독자 이력 조회 실패:', e);
        res.status(500).json({ error: '이력 조회 실패' });
    }
});

/**
 * 구독/해지 이벤트 일별 집계 데이터를 반환합니다.
 *
 * [응답 형태]
 * {
 *   "2026-04-05": { "subscribe": 3, "unsubscribe": 1, "expired": 2 },
 *   "2026-04-04": { "subscribe": 5, "unsubscribe": 0, "expired": 0 },
 *   ...
 * }
 *
 * [연계]
 * - recordSubscriberEvent() → 구독/해지 발생 시 이 데이터를 기록
 * - js/admin.js → renderSubscriberTab()에서 이탈률 카드 렌더링에 사용
 */
router.get('/api/subscriber-events', (req, res) => {
    try {
        if (fs.existsSync(FILES.SUBSCRIBER_EVENTS)) {
            const events = JSON.parse(fs.readFileSync(FILES.SUBSCRIBER_EVENTS, 'utf8'));
            res.json(events);
        } else {
            res.json({});
        }
    } catch (e) {
        console.error('구독 이벤트 조회 실패:', e);
        res.status(500).json({ error: '이벤트 조회 실패' });
    }
});

module.exports = router;
