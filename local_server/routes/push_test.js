/**
 * ============================================================================
 * 파일명: routes/push_test.js
 * 역할: 푸시 알림 테스트 시나리오 API 라우트
 * ============================================================================
 *
 * [설명]
 * 이 파일은 개발/테스트 환경에서 푸시 알림을 시뮬레이션하는 API를 제공합니다.
 * - POST /api/test-push → 테스트 시나리오별 푸시 발송 (미리보기/실제 발송)
 * - GET /api/test-push/scenarios → 사용 가능한 시나리오 목록 조회
 *
 * 각 시나리오는 실제 특보 상황(발표/발효/해제/격상/격하 등)을 모사합니다.
 * mock 데이터를 global에 설정하여 크롤러가 테스트 데이터를 사용하게 합니다.
 *
 * [연계 파일]
 * - routes/push.js → 실제 푸시 발송 로직
 * - server.js → app.use()로 이 라우터 등록
 *
 * [초보자를 위한 안내]
 * 실제 기상청 API를 호출하지 않고도 푸시 알림이 올바르게 동작하는지
 * 확인할 수 있는 테스트 도구입니다. 관리자 페이지에서 시나리오를 선택하면
 * 해당 상황의 Mock 데이터가 설정되고, FCM 토큰으로 실제 발송도 가능합니다.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
// [Lazy] firebase-admin SDK 는 services/firebase_admin_lazy.js 의 getAdmin() 으로 첫 사용 시 로딩.
const { getAdmin } = require('../services/firebase_admin_lazy');

// ============================================================================
// Mock 시나리오 정의
// ============================================================================
const TEST_SCENARIOS = {
    // Case 1: 기본 발표 (동일 시각)
    'basic_publish': {
        title: '🔔 풍랑주의보 발표 알림',
        body: `📍 제주도서부앞바다, 제주도동부앞바다
  발표 03일 14:00 │ 발효 03일 14:00
  해제예정 05일 09:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑주의보', status: 'publish',
            tmFc: '202601031400', tmEf: '202601031400',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },
    'publish': {
        title: '🔔 풍랑주의보 발표 알림',
        body: `📍 제주도서부앞바다, 제주도동부앞바다
  발표 03일 14:00 │ 발효 03일 14:00
  해제예정 05일 09:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑주의보', status: 'publish',
            tmFc: '202601031400', tmEf: '202601031400',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },
    'active': {
        title: '🔔 풍랑주의보 발효 알림',
        body: `📍 제주도서부앞바다
  발표 03일 14:00 │ 발효 03일 18:00
  해제예정 05일 09:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑주의보', status: 'active',
            tmFc: '202601031400', tmEf: '202601031800',
            zones: '제주도서부앞바다'
        }
    },
    'release': {
        title: '✅ 풍랑주의보 해제 알림',
        body: `📍 제주도서부앞바다, 제주도동부앞바다
  해제 05일 09:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑주의보', status: 'release',
            tmFc: '202601050900', tmEf: '202601050900',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },
    'release_east': {
        title: '✅ 풍랑주의보 해제 알림 (동해)',
        body: `📍 경북북부앞바다
  해제 05일 10:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑주의보', status: 'release',
            tmFc: '202601051000', tmEf: '202601051000',
            zones: '경북북부앞바다'
        }
    },
    'release_jeju': {
        title: '✅ 풍랑주의보 해제 알림 (제주)',
        body: `📍 제주도서부앞바다
  해제 05일 11:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑주의보', status: 'release',
            tmFc: '202601051100', tmEf: '202601051100',
            zones: '제주도서부앞바다'
        }
    },
    'publish_high_wave_warning': {
        title: '⚠️ 풍랑경보 발표 알림',
        body: `📍 제주도서부앞바다
  발표 03일 16:00 │ 발효 03일 18:00
  해제예정 05일 12:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑경보', status: 'publish',
            tmFc: '202601031600', tmEf: '202601031800',
            zones: '제주도서부앞바다'
        }
    },
    'publish_typhoon_watch': {
        title: '🌀 태풍주의보 발표 알림',
        body: `📍 제주도서부앞바다
  발표 04일 10:00 │ 발효 04일 12:00
  태풍 예비특보`,
        data: {
            type: 'weather_alert', alertType: '태풍주의보', status: 'publish',
            tmFc: '202601041000', tmEf: '202601041200',
            zones: '제주도서부앞바다', warnVar: '3'
        }
    },
    'publish_typhoon_warning': {
        title: '🌀🚨 태풍경보 발표 알림',
        body: `📍 제주도서부앞바다
  발표 04일 14:00 │ 발효 04일 16:00
  위험! 선박 대피 요망`,
        data: {
            type: 'weather_alert', alertType: '태풍경보', status: 'publish',
            tmFc: '202601041400', tmEf: '202601041600',
            zones: '제주도서부앞바다', warnVar: '3'
        }
    },
    'upgrade_jeju': {
        title: '📢 풍랑 주의보→경보 격상 발표',
        body: `ㅇ제주도서부앞바다
   - 발효예정 : 3일 18:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑경보', status: 'level_upgrade_publish',
            tmFc: '202601031800', tmEf: '202601031800',
            zones: '제주도서부앞바다', prevAlertType: '풍랑주의보'
        }
    },
    'different_times': {
        title: '🔔 풍랑주의보 발표 알림',
        body: `📍 제주도서부앞바다
  발표 03일 14:00 │ 발효 03일 18:00
  해제예정 05일 09:00

📍 제주도동부앞바다
  발표 03일 14:00 │ 발효 03일 21:00
  해제예정 05일 12:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑주의보', status: 'publish',
            tmFc: '202601031400', tmEf: '202601031800',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },
    'upgrade': {
        title: '🚨 풍랑 주의보→경보 격상 발효',
        body: `ㅇ서해중부먼바다
   - 해제예정 : 미정`,
        data: {
            type: 'weather_alert', alertType: '풍랑경보', status: 'level_upgrade_active',
            tmFc: '202601031800', tmEf: '202601031800',
            zones: '서해중부먼바다', prevAlertType: '풍랑주의보'
        }
    },
    'downgrade': {
        title: '🚨 풍랑 경보→주의보 격하 발효',
        body: `ㅇ남해동부먼바다
   - 해제예정 : 4일 15:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑주의보', status: 'level_downgrade_active',
            tmFc: '202601040600', tmEf: '202601040600',
            zones: '남해동부먼바다', prevAlertType: '풍랑경보'
        }
    },
    basic_release: {
        title: '✅ 풍랑주의보 해제 알림',
        body: `📍 제주도서부앞바다, 제주도동부앞바다
  해제 05일 09:00`,
        data: {
            type: 'weather_alert', alertType: '풍랑주의보', status: 'release',
            tmFc: '202601050900', tmEf: '202601050900',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },
    'coastal_exclusion': {
        title: '🔔 풍랑주의보 발표 알림',
        body: `📍 제주도서부앞바다(남서연안 제외)
  발표 03일 14:00 │ 발효 03일 14:00
  해제예정 05일 09:00`
    },
    'complex': {
        title: '🔔 강풍주의보 발표 알림',
        body: `📍 동해중부먼바다, 동해남부먼바다
  발표 03일 10:00 │ 발효 03일 12:00
  해제예정 04일 06:00

📍 울릉도근해
  발표 03일 10:00 │ 발효 03일 15:00
  해제예정 04일 09:00`
    }
};

// ============================================================================
// 테스트 푸시 API
// ============================================================================

// 테스트 푸시 발송
router.post('/api/test-push', async (req, res) => {
    const { scenario, token } = req.body;

    if (!scenario) {
        return res.json({
            message: '사용 가능한 시나리오 목록',
            scenarios: Object.keys(TEST_SCENARIOS),
            usage: 'POST /api/test-push { "scenario": "basic_publish", "token": "FCM_TOKEN" }'
        });
    }

    const testData = TEST_SCENARIOS[scenario];
    if (!testData) {
        return res.status(400).json({
            error: '존재하지 않는 시나리오',
            available: Object.keys(TEST_SCENARIOS)
        });
    }

    // [테스트용] Mock Data 설정
    if (testData.data && (scenario.includes('publish') || scenario.includes('active') || scenario.includes('upgrade') || scenario.includes('downgrade'))) {
        const zonesList = testData.data.zones ? testData.data.zones.split(',') : [];
        const warnStress = testData.data.alertType.includes('경보') ? '1' : '0';
        const command = '1';
        let warnVar = testData.data.warnVar || '1';

        global.mockWarningData = {
            response: {
                header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' },
                body: {
                    dataType: 'JSON',
                    items: {
                        item: zonesList.map(zone => ({
                            areaName: zone,
                            warnVar: warnVar,
                            warnStress: warnStress,
                            command: command,
                            tmFc: testData.data.tmFc || '202601010000',
                            tmEf: testData.data.tmEf || '202601010000',
                            regId: 'TEST_ID',
                            tmSeq: '1'
                        }))
                    },
                    numOfRows: zonesList.length,
                    pageNo: 1,
                    totalCount: zonesList.length
                }
            }
        };
        console.log(`[TEST] Mock Data SET for ${scenario}`);
        setTimeout(() => { global.mockWarningData = null; }, 300000);
    } else if (testData.data && scenario.includes('release')) {
        global.mockWarningData = {
            response: { header: { resultCode: '00', resultMsg: 'NO_DATA' }, body: { items: { item: [] }, totalCount: 0 } }
        };
        console.log(`[TEST] Mock Data (Release) SET for ${scenario}`);
        setTimeout(() => { global.mockWarningData = null; }, 300000);
    }

    // 토큰이 없으면 미리보기만
    if (!token) {
        return res.json({
            preview: true,
            scenario: scenario,
            notification: testData,
            message: '실제 발송하려면 token을 포함하세요.'
        });
    }

    // [Lazy] 실제 FCM 발송 — 첫 호출에서 firebase-admin 이 로딩됨
    const admin = getAdmin();
    if (!admin || admin.apps.length === 0) {
        return res.status(500).json({ error: 'Firebase Admin이 초기화되지 않았습니다.' });
    }

    try {
        const message = {
            token: token,
            notification: {
                title: testData.title,
                body: testData.body
            },
            data: {
                url: '/?tab=weather-alert-section',
                scenario: scenario,
                ...(testData.data || {})
            }
        };

        const response = await admin.messaging().send(message);
        res.json({
            success: true,
            scenario: scenario,
            fcmResponse: response,
            notification: testData
        });
    } catch (e) {
        res.status(500).json({ error: e.message, code: e.code });
    }
});

// 시나리오 목록 조회
router.get('/api/test-push/scenarios', (req, res) => {
    res.json({
        scenarios: Object.entries(TEST_SCENARIOS).map(([key, val]) => ({
            id: key,
            title: val.title,
            bodyPreview: val.body.substring(0, 50) + '...'
        }))
    });
});

module.exports = router;
