const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'data/active_lifecycle.json');

try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));

    console.log('=== [상세 분석 1] 제주도서부앞바다 (S1323400) 오전 4시 상황 ===');
    const jeju = data.zones['S1323400'];
    if (jeju) {
        // Filter history between 04:00 and 05:00
        const morning = jeju.history.filter(h => h.timestamp.includes('2026. 1. 29. 오전 4:'));
        morning.forEach(h => {
            console.log(`[${h.timestamp}]`);
            console.log(`  - AFSO: ${h.afso.wrnLvl} (${h.afso.wrnTp}, ${h.afso.command}, 발표:${h.afso.tmFc})`);
            console.log(`  - HUB: ${h.hub.level} (결과: ${h.hub.match})`);
            console.log(`  - 해제예고: ${h.afso.tmYn}`);
        });
    }

    console.log('\n=== [상세 분석 2] 오후 4시 대규모 예비특보 전환 과정 (샘플: 동해남부북쪽안쪽먼바다 S1132210) ===');
    const eastSea = data.zones['S1132210'];
    if (eastSea) {
        // Filter history between 15:50 and 16:30
        const afternoon = eastSea.history.filter(h =>
            h.timestamp.includes('2026. 1. 29. 오후 3:5') ||
            h.timestamp.includes('2026. 1. 29. 오후 4:')
        );
        afternoon.forEach(h => {
            console.log(`[${h.timestamp}] AFSO:${h.afso.wrnLvl} vs HUB:${h.hub.level} -> ${h.hub.match}`);
            if (h.isKeyframe) console.log(`  >> KEYFRAME: ${h.keyframeType}`);
        });
    }

} catch (e) {
    console.error(e);
}
