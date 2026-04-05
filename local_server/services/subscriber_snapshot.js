/**
 * ============================================================================
 * 파일명: services/subscriber_snapshot.js
 * 역할: 푸시 알림 구독자 수를 매일 기록하여 증감 추이를 분석할 수 있게 하는 서비스
 * ============================================================================
 *
 * [설명]
 * 매일 자정(KST)에 현재 구독자 수를 스냅샷으로 기록합니다.
 * 기록된 데이터는 관리자 센터의 "구독 현황" 탭에서
 * 일별/주간/월별 구독자 추이 그래프와 증감 분석에 활용됩니다.
 *
 * [데이터 구조]
 * subscriber_stats.json 파일에 다음과 같은 형태로 저장됩니다:
 * {
 *   "2026-04-05": { "total": 690, "fcm": 690, "web": 0 },
 *   "2026-04-04": { "total": 678, "fcm": 678, "web": 0 },
 *   ...
 * }
 *
 * [연계 파일]
 * - config/server_config.js → FILES.SUBSCRIBER_STATS 경로 참조
 * - config/server_config.js → FILES.SUBSCRIPTIONS 구독자 목록 참조
 * - server.js → cron.schedule()로 이 서비스의 takeSnapshot()을 매일 호출
 * - routes/push.js → /api/subscriber-history API에서 이 데이터를 조회
 * - js/admin.js → renderSubscriberTab()에서 그래프/증감 카드 렌더링
 *
 * [초보자를 위한 안내]
 * 구독자 수는 실시간으로 변합니다. 하지만 "어제보다 늘었는지, 줄었는지"를
 * 알려면 과거의 구독자 수를 기록해둬야 합니다.
 * 이 서비스가 바로 그 역할을 합니다 — 매일 한 번 현재 구독자 수를
 * "사진 찍듯이" 저장(스냅샷)해서, 나중에 추이를 분석할 수 있게 합니다.
 * ============================================================================
 */

const fs = require('fs');
const { FILES } = require('../config/server_config');

/**
 * 현재 구독자 수를 읽어서 오늘 날짜의 스냅샷으로 기록합니다.
 *
 * [동작 과정]
 * 1. subscriptions.json에서 현재 구독자 목록을 읽음
 * 2. FCM(앱)과 Web(웹브라우저) 구독자 수를 각각 카운트
 * 3. subscriber_stats.json에 오늘 날짜 키로 저장
 *
 * [호출 시점]
 * - server.js의 cron 스케줄러가 매일 KST 23:55 (UTC 14:55)에 호출
 * - 서버 시작 시에도 한 번 호출하여 오늘 데이터가 없으면 즉시 기록
 */
function takeSnapshot() {
    try {
        // 1. 현재 구독자 목록 읽기
        let subscriptions = [];
        if (fs.existsSync(FILES.SUBSCRIPTIONS)) {
            subscriptions = JSON.parse(fs.readFileSync(FILES.SUBSCRIPTIONS, 'utf8'));
        }

        // 2. 유형별 카운트 (fcm = 앱 사용자, web = 웹브라우저 사용자)
        let fcmCount = 0;
        let webCount = 0;
        subscriptions.forEach(function (sub) {
            if (sub.type === 'fcm') {
                fcmCount++;
            } else {
                webCount++;
            }
        });

        const totalCount = fcmCount + webCount;

        // 3. 오늘 날짜 문자열 생성 (KST 기준)
        const now = new Date();
        const kstDate = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        const todayStr = kstDate.toISOString().split('T')[0]; // "2026-04-05" 형태

        // 4. 기존 스냅샷 데이터 읽기
        let stats = {};
        if (fs.existsSync(FILES.SUBSCRIBER_STATS)) {
            stats = JSON.parse(fs.readFileSync(FILES.SUBSCRIBER_STATS, 'utf8'));
        }

        // 5. 오늘 날짜 스냅샷 기록 (이미 있으면 덮어씀 — 하루에 여러 번 호출되어도 안전)
        stats[todayStr] = {
            total: totalCount,
            fcm: fcmCount,
            web: webCount
        };

        // 6. 파일에 저장
        fs.writeFileSync(FILES.SUBSCRIBER_STATS, JSON.stringify(stats, null, 2), 'utf8');

        console.log('[SubscriberSnapshot] ' + todayStr + ' 구독자 스냅샷 기록 완료: ' +
            'total=' + totalCount + ', fcm=' + fcmCount + ', web=' + webCount);
    } catch (e) {
        console.error('[SubscriberSnapshot] 스냅샷 기록 실패:', e.message);
    }
}

module.exports = { takeSnapshot };
