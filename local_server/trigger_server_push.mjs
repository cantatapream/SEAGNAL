// 서버의 /api/test-push 엔드포인트를 호출하여 FCM 발송 및 Mock 데이터 설정을 요청하는 스크립트
// 사용법: node trigger_server_push.mjs <scenario> <token>

const API_URL = 'https://seagnal-server.fly.dev/api/test-push';
const scenario = process.argv[2] || 'publish';
const token = process.argv[3] || 'c70cev3eTkadH3rM9cVKkv:APA91bE0d2mFuDY-9NSlQlzwIxMwACbgXEX3ROcs38afP7cczURuL72AdZfQ23Ad-Z1zj8vreg7JZDVpvRgn5FSCGGvB36wL-VT1JfSehl9XgcrprB5GSRs';

async function sendPush() {
    console.log(`Sending '${scenario}' to server (${API_URL})...`);
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scenario, token })
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }

        const json = await response.json();
        console.log('Server Response:', JSON.stringify(json, null, 2));
    } catch (e) {
        console.error('Error:', e);
    }
}

sendPush();
