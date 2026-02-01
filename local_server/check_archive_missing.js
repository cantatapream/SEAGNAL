const fs = require('fs');
const path = require('path');

const ARCHIVE_DIR = path.join(__dirname, 'data/archive');
const TARGET_DATE = '2026-01-29'; // ISO format date usually used in archives or kst
const START_HOUR = 2;

try {
    const files = fs.readdirSync(ARCHIVE_DIR);
    const results = [];

    files.forEach(file => {
        if (!file.endsWith('.json')) return;
        const data = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, file), 'utf8'));

        data.history.forEach(h => {
            // timestamp: "2026-01-29T07:16:00.123Z"
            const date = new Date(h.timestamp);
            // Convert to KST (+9)
            const kst = new Date(date.getTime() + (9 * 60 * 60 * 1000));

            const dateStr = kst.toISOString().split('T')[0];
            const hour = kst.getUTCHours(); // getUTCHours after adding 9h is the KST hour if we treat kst as UTC
            // Wait, simpler:
            if (dateStr !== TARGET_DATE) return;
            if (kst.getHours() < START_HOUR) return;

            const missing = h.afso.filter(a => a.status === 'MISSING');
            missing.forEach(m => {
                results.push({
                    kst: kst.toLocaleString('ko-KR'),
                    parent: file.replace('.json', ''),
                    zone: m.regKo,
                    detail: m.detail
                });
            });
        });
    });

    console.log(`--- [Archive 분석] AFSO 누락(MISSING) 로그 ---`);
    if (results.length === 0) {
        console.log('누락 항목이 없습니다.');
    } else {
        results.sort((a, b) => a.kst.localeCompare(b.kst));
        let lastReport = null;
        results.forEach(r => {
            const currentReport = `${r.parent}_${r.zone}`;
            if (lastReport !== currentReport) {
                console.log(`[${r.kst}] ${r.zone} (부모: ${r.parent})`);
                console.log(`  - 결과: MISSING`);
                console.log(`  -----------------------------------------`);
                lastReport = currentReport;
            }
        });
    }
} catch (e) {
    console.error('Error:', e.message);
}
