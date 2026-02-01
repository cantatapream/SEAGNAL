const fs = require('fs');
const path = require('path');

const SAVE_FILE = path.join(__dirname, 'data/active_lifecycle_save.json');
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
    const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    const mismatches = data.events.filter(evt => {
        const ts = parseTimestamp(evt.timestamp);
        if (!ts) return false;

        // Filter by date and time (today after 2 AM)
        if (ts.datePart !== TARGET_DATE) return false;
        if (ts.h < START_HOUR) return false;

        // Find mismatches
        const match = evt.hub?.match;
        return match && !['MATCH', 'AFSO_ONLY', 'RELEASE'].includes(match);
    });

    console.log(`--- [분석 결과] 2026. 1. 29. 02:00 이후 불일치(Mismatch) 로그 ---`);
    if (mismatches.length === 0) {
        console.log('해당 시간대 이후 불일치 로그가 없습니다.');
    } else {
        mismatches.forEach(m => {
            console.log(`[${m.timestamp}] ${m.regKo} (${m.regId})`);
            console.log(`  - 유형: ${m.keyframeType}`);
            console.log(`  - 상태: AFSO(${m.afso?.wrnLvl || 'N/A'}) vs HUB(${m.hub?.level || 'N/A'})`);
            console.log(`  - 결과: ${m.hub?.match}`);
            console.log(`  -----------------------------------------`);
        });
    }
} catch (e) {
    console.error('분석 중 오류 발생:', e.message);
}
