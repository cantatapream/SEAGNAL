const fs = require('fs');
const path = require('path');

const LIFECYCLE_FILE = path.join(__dirname, 'data/active_lifecycle.json');
const TARGET_DATE = '2026. 1. 29.';
const START_HOUR = 2;

function parseTimestamp(ts) {
    const parts = ts.split(' ');
    const datePart = parts.slice(0, 3).join(' ');
    let ampm = parts[3];
    let timePart = parts[4];
    if (!timePart) return null;
    let [h, m, s] = timePart.split(':').map(Number);
    if (ampm === '오후' && h !== 12) h += 12;
    if (ampm === '오전' && h === 12) h = 0;
    return { datePart, h, m, s };
}

try {
    const data = JSON.parse(fs.readFileSync(LIFECYCLE_FILE, 'utf8'));
    const results = [];

    for (const [regId, zone] of Object.entries(data.zones)) {
        zone.history.forEach(h => {
            const ts = parseTimestamp(h.timestamp);
            if (!ts) return;
            if (ts.datePart !== TARGET_DATE) return;
            if (ts.h < START_HOUR) return;

            const matchStatus = h.hub?.match || h.matchStatus;
            // Exclude MATCH, AFSO_ONLY, RELEASE, and now also '정보없음' to see specific delays
            if (matchStatus && !['MATCH', 'AFSO_ONLY', 'RELEASE', '정보없음'].includes(matchStatus)) {
                results.push({
                    timestamp: h.timestamp,
                    regKo: zone.regKo,
                    regId: regId,
                    afso: h.afso,
                    hub: h.hub,
                    matchStatus: matchStatus
                });
            }
        });
    }

    results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    console.log(`--- [지연/불일치 분석] UPGRADE_DELAY, DOWNGRADE_DELAY, GHOST 등 ---`);
    if (results.length === 0) {
        console.log('특이 사항(지연/GHOST 등)이 없습니다.');
    } else {
        let lastReport = null;
        results.forEach(r => {
            const currentReport = `${r.regId}_${r.afso?.wrnTp}_${r.matchStatus}`;
            if (lastReport !== currentReport) {
                console.log(`[${r.timestamp}] ${r.regKo} (${r.regId})`);
                console.log(`  - AFSO: ${r.afso?.wrnLvl || 'N/A'}, HUB: ${r.hub?.level || 'N/A'}`);
                console.log(`  - 결과: ${r.matchStatus}`);
                console.log(`  -----------------------------------------`);
                lastReport = currentReport;
            }
        });
    }
} catch (e) {
    console.error('Error:', e.message);
}
