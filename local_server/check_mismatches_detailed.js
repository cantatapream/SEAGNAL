const fs = require('fs');
const path = require('path');

const LIFECYCLE_FILE = path.join(__dirname, 'data/active_lifecycle.json');
const TARGET_DATE = '2026. 1. 29.';
const START_HOUR = 2;

function parseTimestamp(ts) {
    // Format: "2026. 1. 29. 오전 12:10:16" or "2026. 1. 29. 오후 4:00:41"
    const parts = ts.split(' ');
    const datePart = parts.slice(0, 3).join(' '); // "2026. 1. 29."
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

            const matchStatus = h.hub?.match || h.matchStatus; // Check common fields
            if (matchStatus && !['MATCH', 'AFSO_ONLY', 'RELEASE'].includes(matchStatus)) {
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

    // Sort by timestamp
    results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    console.log(`--- [상세 분석 결과] active_lifecycle.json (1분 단위) 불일치 로그 ---`);
    if (results.length === 0) {
        console.log('해당 시간대 이후 불일치 로그가 없습니다.');
    } else {
        // Group by sequence of the same regId to avoid too much noise
        let lastReport = null;
        results.forEach(r => {
            const currentReport = `${r.regId}_${r.afso?.wrnTp}_${r.matchStatus}`;
            if (lastReport !== currentReport) {
                console.log(`[${r.timestamp}] ${r.regKo} (${r.regId})`);
                console.log(`  - 상태: AFSO(${r.afso?.wrnLvl || 'N/A'}) vs HUB(${r.hub?.level || 'N/A'})`);
                console.log(`  - 결과: ${r.matchStatus}`);
                console.log(`  -----------------------------------------`);
                lastReport = currentReport;
            }
        });
    }
} catch (e) {
    console.error('분석 중 오류 발생:', e.message);
}
