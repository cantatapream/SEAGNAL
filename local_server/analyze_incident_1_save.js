const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync('data/active_lifecycle_save.json', 'utf8'));
const evts = data.events.filter(e => e.regId === 'S1323400');
let output = '';
evts.forEach(e => {
    output += `${e.timestamp} | Type: ${e.keyframeType} | AFSO: ${e.afso.wrnLvl} | HUB: ${e.hub.level} | Match: ${e.hub.match}\n`;
});
fs.writeFileSync('incident_1_save_details.txt', output);
