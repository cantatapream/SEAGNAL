/**
 * [관리자 푸시 발송 서비스]
 * admin_devices.json에 등록된 모든 FCM 기기에 푸시 알림을 발송합니다.
 * 순환 참조 방지를 위해 routes/admin.js와 report_alert_processor.js에서
 * 공통으로 사용하는 독립 모듈로 분리되었습니다.
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/server_config');

// Firebase Admin SDK (런타임에 한 번만 로드)
let firebaseAdmin;
try {
    firebaseAdmin = require('firebase-admin');
} catch (e) { /* Firebase 미설치 시 무시 */ }

const ADMIN_DEVICES_FILE = path.join(DATA_DIR, 'admin_devices.json');

/**
 * 등록된 모든 관리자 FCM 기기에 푸시 알림 발송.
 * - Firebase 미초기화 또는 등록 기기 없으면 조용히 종료
 * - 만료된 토큰은 자동으로 목록에서 제거
 * @param {string} title 푸시 제목
 * @param {string} body 푸시 본문
 * @param {object} [data] 추가 데이터 (선택)
 * @returns {Promise<{sent: number, failed: number}>} 발송 결과
 */
async function sendAdminPush(title, body, data = {}) {
    try {
        // Firebase 초기화 확인
        if (!firebaseAdmin || firebaseAdmin.apps.length === 0) {
            console.warn('[AdminPush] Firebase 미초기화, 관리자 푸시 발송 불가');
            return { sent: 0, failed: 0 };
        }

        // 등록된 관리자 기기 목록 로드
        if (!fs.existsSync(ADMIN_DEVICES_FILE)) {
            console.log('[AdminPush] 등록된 관리자 기기 없음 (파일 미존재)');
            return { sent: 0, failed: 0 };
        }
        let devices = JSON.parse(fs.readFileSync(ADMIN_DEVICES_FILE, 'utf8'));
        // FCM 기기만 필터 (휴대폰 푸시 전용)
        const fcmDevices = devices.filter(d => d.type === 'fcm' && d.token);

        if (fcmDevices.length === 0) {
            console.log('[AdminPush] 등록된 FCM 관리자 기기 없음');
            return { sent: 0, failed: 0 };
        }

        let sent = 0, failed = 0;
        let deadTokenFound = false;

        // 관리자 센터 URL (푸시 클릭 시 이동)
        const BASE_URL = 'https://seagnal-server.fly.dev';
        const url = data.url || `${BASE_URL}/?tab=admin`;

        for (const device of fcmDevices) {
            try {
                await firebaseAdmin.messaging().send({
                    token: device.token,
                    notification: { title, body },
                    data: { url, type: 'admin_alert', ...data },
                    android: { priority: 'high' },
                    apns: { headers: { 'apns-priority': '10' } }
                });
                sent++;
                console.log(`[AdminPush] 발송 성공: ${device.token.substring(0, 20)}...`);
            } catch (err) {
                failed++;
                console.error(`[AdminPush] 발송 실패: ${err.message}`);
                // 만료/무효 토큰은 목록에서 제거 표시
                if (err.code === 'messaging/registration-token-not-registered' ||
                    err.code === 'messaging/invalid-registration-token') {
                    device._isDead = true;
                    deadTokenFound = true;
                }
            }
        }

        // 만료된 토큰 정리
        if (deadTokenFound) {
            devices = devices.filter(d => !d._isDead);
            fs.writeFileSync(ADMIN_DEVICES_FILE, JSON.stringify(devices, null, 2), 'utf8');
            console.log('[AdminPush] 만료된 토큰 정리 완료');
        }

        console.log(`[AdminPush] 발송 완료: 성공 ${sent}건, 실패 ${failed}건`);
        return { sent, failed };
    } catch (err) {
        console.error('[AdminPush] 발송 중 오류:', err.message);
        return { sent: 0, failed: 0 };
    }
}

module.exports = { sendAdminPush };
