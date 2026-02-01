const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync('data/active_lifecycle.json', 'utf8'));
const z = data.zones['S1323400'];
const morning = z.history.filter(h => h.timestamp.includes('오전 4:'));
let output = `Found ${morning.length} items in morning\n`;
morning.forEach(h => {
    output += `${h.timestamp} | AFSO: ${h.afso.wrnLvl} | HUB: ${h.hub.level} | Match: ${h.hub.match}\n`;
});
fs.writeFileSync('incident_1_details.txt', output);
