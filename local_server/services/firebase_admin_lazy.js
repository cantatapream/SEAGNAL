/**
 * ============================================================================
 * 파일명: services/firebase_admin_lazy.js
 * 역할: firebase-admin SDK 의 lazy(지연) 로딩 + initializeApp 호출을
 *       단일 게이트로 묶어 제공하는 헬퍼 모듈
 * ============================================================================
 *
 * [왜 필요한가]
 *   firebase-admin SDK 는 require 만 해도 약 3초가 걸리는 무거운 모듈이며,
 *   여러 파일(scheduler.js, routes/push.js, routes/push_test.js,
 *   routes/report.js, services/admin_push.js)에서 각자 require 하고 있었다.
 *   require 자체는 Node 모듈 캐시로 한 번만 일어나지만, 그 한 번이
 *   서버 startup 의 require 체인 안에서 발생하여 listen 을 늦추는 원인이었다.
 *   이 모듈은 firebase-admin 의 require + initializeApp 을 첫 호출 시점까지
 *   미루는 단일 진입점을 제공한다 (lazy require + lazy init).
 *
 * [동작]
 *   - getAdmin()  최초 호출 시 firebase-admin 을 require 하고
 *                 serviceAccountKey.json 으로 initializeApp 을 호출한다.
 *                 두 번째 호출부터는 캐시된 admin 객체를 즉시 반환.
 *                 (Node 의 require 캐시 + 자체 _initDone 플래그)
 *   - SDK 미설치 또는 인증키 부재 시 null 을 반환한다 (호출 측이 null 체크).
 *
 * [연계]
 *   - scheduler.js                : 더 이상 firebase-admin 을 직접 require 하지 않음
 *   - routes/push.js              : admin.apps.length, admin.messaging() → getAdmin().*
 *   - routes/push_test.js         : 동일
 *   - routes/report.js            : 동일
 *   - services/admin_push.js      : 동일
 *
 * [초보자 안내]
 *   "Lazy require" 패턴은 무거운 모듈을 파일 상단에서 require 하지 않고,
 *   해당 모듈이 실제로 필요한 함수 안에서 require 하는 기법이다.
 *   Node.js 의 require 는 캐시되므로, 두 번째부터는 즉시 반환된다.
 *   따라서 "한 번은 비용을 내야 하지만, 그 시점을 startup 이후로 미룰 수 있다."
 * ============================================================================
 */

'use strict';

const path = require('path');

// 캐시 변수들
let _admin = null;     // 로드된 firebase-admin 모듈 (또는 null)
let _initDone = false; // 한 번이라도 시도했는지 여부 (성공·실패 모두 포함)

/**
 * firebase-admin SDK 를 가져온다 (필요 시 첫 호출에서 로딩 + 초기화).
 * 다음 사용 패턴을 그대로 대체할 수 있다:
 *
 *   기존:  const admin = require('firebase-admin');
 *          if (admin.apps.length > 0) await admin.messaging().send({...});
 *
 *   변경:  const { getAdmin } = require('./services/firebase_admin_lazy');
 *          const admin = getAdmin();
 *          if (admin && admin.apps.length > 0) await admin.messaging().send({...});
 *
 * @returns {object|null} firebase-admin 모듈, 사용 불가 시 null
 */
function getAdmin() {
    if (_initDone) return _admin;
    _initDone = true;

    try {
        // [Lazy Require] 첫 호출 시점에만 SDK 로딩 (~3초 1회).
        // 이후 모든 호출은 Node 모듈 캐시로 즉시 반환.
        const admin = require('firebase-admin');

        // 이미 다른 경로로 initializeApp 이 호출됐을 수 있으므로 중복 호출 방지
        if (admin.apps && admin.apps.length === 0) {
            try {
                // 인증키 파일은 local_server/serviceAccountKey.json (services/ 의 부모)
                const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
                const serviceAccount = require(keyPath);
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount)
                });
                console.log('🔥 Firebase Admin 초기화 완료 (lazy)');
            } catch (e) {
                console.warn('⚠️ Firebase serviceAccountKey.json 없음 또는 초기화 실패 (FCM 불가):', e && e.message);
                // SDK 자체는 로딩됐으므로 admin 은 그대로 반환 (apps.length === 0 으로 호출측 체크)
            }
        }

        _admin = admin;
    } catch (e) {
        console.warn('⚠️ firebase-admin 모듈 로딩 실패 (FCM 비활성):', e && e.message);
        _admin = null;
    }

    return _admin;
}

module.exports = { getAdmin };
