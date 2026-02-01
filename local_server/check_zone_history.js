const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'data/active_lifecycle.json');
try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const zone = data.zones['S1323400'];
    if (zone) {
        console.log(`History for ${zone.regKo} (${zone.regId}):`);
        zone.history.slice(-20).forEach(h => {
            console.log(`[${h.timestamp}] AFSO:${h.afso?.wrnLvl} HUB:${h.hub?.level} Match:${h.hub?.match || h.matchStatus}`);
        });
    } else {
        console.log('Zone S1323400 not found');
    }
} catch (e) {
    console.error(e);
}
