const fs = require('fs');
const https = require('https');
const path = require('path');

const TARGET_URL = 'https://seagnal-server.fly.dev/api/weather-alerts';
const DEST_PATH = path.join(__dirname, 'data', 'weather_alerts.json');

console.log(`📡 Fetching alerts from ${TARGET_URL}...`);

https.get(TARGET_URL, (res) => {
    if (res.statusCode !== 200) {
        console.error(`❌ Failed to fetch: Status Code ${res.statusCode}`);
        // Try legacy endpoint if new one fails
        if (res.statusCode === 404) {
            console.log('🔄 Trying legacy endpoint /api/warnings...');
            fetchLegacy();
        }
        return;
    }

    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const parsed = JSON.parse(data);
            fs.writeFileSync(DEST_PATH, JSON.stringify(parsed, null, 2), 'utf8');
            console.log(`✅ Successfully injected data to ${DEST_PATH}`);
            console.log(`⏰ UpdatedAt: ${parsed.updatedAt}`);
        } catch (e) {
            console.error('❌ JSON Parse Error:', e.message);
            console.log('Raw data trace:', data.substring(0, 100));
        }
    });
}).on('error', (err) => {
    console.error('❌ Request Error:', err.message);
});

function fetchLegacy() {
    https.get('https://seagnal-server.fly.dev/api/warnings', (res) => {
        if (res.statusCode !== 200) {
            console.error(`❌ Legacy fetch also failed: Status Code ${res.statusCode}`);
            return;
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                fs.writeFileSync(DEST_PATH, JSON.stringify(parsed, null, 2), 'utf8');
                console.log(`✅ Successfully injected data (from legacy) to ${DEST_PATH}`);
            } catch (e) {
                console.error('❌ Legacy JSON Parse Error:', e.message);
            }
        });
    });
}
