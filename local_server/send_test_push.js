
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const TEST_SCENARIOS = {
    'publish': {
        title: '🔔 풍랑주의보 발표 알림',
        body: `📍 제주도서부앞바다, 제주도동부앞바다\n  발표 03일 14:00 │ 발효 03일 14:00\n  해제예정 05일 09:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'publish',
            tmFc: '202601031400',
            tmEf: '202601031400',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },
    'active': {
        title: '🔔 풍랑주의보 발효 알림',
        body: `📍 제주도서부앞바다\n  발표 03일 14:00 │ 발효 03일 18:00\n  해제예정 05일 09:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'active',
            tmFc: '202601031400',
            tmEf: '202601031800',
            zones: '제주도서부앞바다'
        }
    },
    'upgrade': {
        title: '⚠️ 풍랑경보 격상 알림',
        body: `📍 서해중부먼바다\n  변경 03일 18:00 (주의보→경보)\n  해제예정 정보 없음`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑경보',
            status: 'upgrade',
            tmFc: '202601031800',
            tmEf: '202601031800',
            zones: '서해중부먼바다',
            prevAlertType: '풍랑주의보'
        }
    },
    'downgrade': {
        title: '🔔 풍랑주의보 격하 알림',
        body: `📍 남해동부먼바다\n  변경 04일 06:00 (경보→주의보)\n  해제예정 04일 15:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'downgrade',
            tmFc: '202601040600',
            tmEf: '202601040600',
            zones: '남해동부먼바다',
            prevAlertType: '풍랑경보'
        }
    },
    'release': {
        title: '✅ 풍랑주의보 해제 알림',
        body: `📍 제주도서부앞바다, 제주도동부앞바다\n  해제 05일 09:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'release',
            tmFc: '202601050900',
            tmEf: '202601050900',
            zones: '제주도서부앞바다,제주도동부앞바다'
        }
    },
    'release_east': {
        title: '✅ 풍랑주의보 해제 알림 (동해)',
        body: `📍 경북북부앞바다\n  해제 05일 10:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'release',
            tmFc: '202601051000',
            tmEf: '202601051000',
            zones: '경북북부앞바다'
        }
    },
    'release_jeju': {
        title: '✅ 풍랑주의보 해제 알림 (제주)',
        body: `📍 제주도서부앞바다\n  해제 05일 11:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑주의보',
            status: 'release',
            tmFc: '202601051100',
            tmEf: '202601051100',
            zones: '제주도서부앞바다'
        }
    },
    'publish_high_wave_warning': {
        title: '⚠️ 풍랑경보 발표 알림',
        body: `📍 제주도서부앞바다\n  발표 03일 16:00 │ 발효 03일 18:00\n  해제예정 05일 12:00`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑경보',
            status: 'publish',
            tmFc: '202601031600',
            tmEf: '202601031800',
            zones: '제주도서부앞바다'
        }
    },
    'publish_typhoon_watch': {
        title: '🌀 태풍주의보 발표 알림',
        body: `📍 제주도서부앞바다\n  발표 04일 10:00 │ 발효 04일 12:00\n  태풍 예비특보`,
        data: {
            type: 'weather_alert',
            alertType: '태풍주의보',
            status: 'publish',
            tmFc: '202601041000',
            tmEf: '202601041200',
            zones: '제주도서부앞바다',
            warnVar: '3'
        }
    },
    'publish_typhoon_warning': {
        title: '🌀🚨 태풍경보 발표 알림',
        body: `📍 제주도서부앞바다\n  발표 04일 14:00 │ 발효 04일 16:00\n  위험! 선박 대피 요망`,
        data: {
            type: 'weather_alert',
            alertType: '태풍경보',
            status: 'publish',
            tmFc: '202601041400',
            tmEf: '202601041600',
            zones: '제주도서부앞바다',
            warnVar: '3'
        }
    },
    'upgrade_jeju': {
        title: '⚠️ 풍랑경보 격상 알림',
        body: `📍 제주도서부앞바다\n  변경 03일 18:00 (주의보→경보)\n  해제예정 미정`,
        data: {
            type: 'weather_alert',
            alertType: '풍랑경보',
            status: 'upgrade',
            tmFc: '202601031800',
            tmEf: '202601031800',
            zones: '제주도서부앞바다',
            prevAlertType: '풍랑주의보'
        }
    }
    // 필요한 다른 시나리오 추가 가능
};

const args = process.argv.slice(2);
const scenarioKey = args[0];
const token = args[1];

if (!scenarioKey || !token) {
    console.log('Usage: node send_test_push.js <scenario> <device_token>');
    console.log('Scenarios:', Object.keys(TEST_SCENARIOS).join(', '));
    process.exit(1);
}

const scenario = TEST_SCENARIOS[scenarioKey];
if (!scenario) {
    console.error('Unknown scenario:', scenarioKey);
    process.exit(1);
}

const message = {
    token: token,
    notification: {
        title: scenario.title,
        body: scenario.body
    },
    data: {
        url: '/?tab=weather-alert-section',
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        ...(scenario.data || {})
    }
};

console.log(`Sending '${scenarioKey}' to token prefix: ${token.substring(0, 10)}...`);

admin.messaging().send(message)
    .then((response) => {
        console.log('Successfully sent message:', response);
        process.exit(0);
    })
    .catch((error) => {
        console.log('Error sending message:', error);
        process.exit(1);
    });
