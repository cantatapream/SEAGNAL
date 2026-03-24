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
const webpush = require('web-push');
const admin = require('firebase-admin');
const { DATA_DIR } = require('../config/server_config');
const { expandToMinorZones, getMatchedZones, generateMessage } = require('../services/push_helpers');

const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const HISTORY_FILE = path.join(DATA_DIR, 'custom_push_history.json');

// ============================================================================
// VAPID 설정
// ============================================================================
let vapidConfigured = false;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(
            process.env.VAPID_SUBJECT || 'mailto:seagnal_admin@example.com',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
        vapidConfigured = true;
        console.log('🔔 Web Push VAPID 설정 완료');
    } catch (err) {
        console.error('⚠️ VAPID 설정 실패 (푸시 비활성화):', err.message);
    }
}

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
    const { subscription, token, zones, options } = req.body;

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
            updatedAt: Date.now()
        };

        if (existingIndex !== -1) {
            subs[existingIndex] = newEntry;
        } else {
            subs.push(newEntry);
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

            if (subs.length !== initialLen) {
                fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
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

                    const generated = generateMessage({ ...payload, items: userFilteredItems });
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
                    // 해제
                    if (opts.release === false && tid === 'release') {
                        return;
                    }
                    // 야간 수신 거부 (KST 22:00 ~ 07:00)
                    if (opts.night === false) {
                        const kstHour = (new Date().getUTCHours() + 9) % 24;
                        if (kstHour >= 22 || kstHour < 7) {
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

                    if (user.type === 'fcm' && user.token) {
                        if (admin.apps.length > 0) {
                            try {
                                await admin.messaging().send({
                                    token: user.token,
                                    notification: { title: finalTitle, body: finalBody },
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
                                }
                            }
                        }
                    } else if (user.subscription) {
                        try {
                            const pushPayload = JSON.stringify({ title: finalTitle, body: finalBody, url: url });
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
            fs.writeFileSync(SUBS_FILE, JSON.stringify(updatedSubs, null, 2));
            console.log(`🧹 [Push/Manual] 만료된 구독 데이터 ${allSubs.length - updatedSubs.length}건 정리 완료`);
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
            tab: isManualGroupSend ? (payload.templateId && payload.templateId.startsWith('level_') ? 'level' : (payload.templateId || 'active')) : 'custom',
            tmRef: isManualGroupSend ? (payload.items[0].tmFc || payload.items[0].tmEf || '') : ''
        };
        history.unshift(newLog);
        if (history.length > 500) history = history.slice(0, 500);
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

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
router.get('/api/push-history', (req, res) => {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            res.json(JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')));
        } else {
            res.json([]);
        }
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

module.exports = router;
