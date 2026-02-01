const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'data/active_lifecycle.json');
try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const zone = data.zones['S1323400'];
    if (zone) {
        console.log(`History for ${zone.regKo} (${zone.regId}):`);
        // Filter for today after 2 AM
        const todayHist = zone.history.filter(h => h.timestamp.includes('2026. 1. 29.') && !h.timestamp.includes('오전 1:') && !h.timestamp.includes('오전 0:'));
        todayHist.forEach(h => {
            if (h.hub?.match !== 'MATCH' && h.hub?.match !== 'AFSO_ONLY') {
                console.log(`[${h.timestamp}] AFSO:${h.afso?.wrnLvl} HUB:${h.hub?.level} Match:${h.hub?.match || h.matchStatus}`);
            }
        });
    }
} catch (e) {
    console.error(e);
}
