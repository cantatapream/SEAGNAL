const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync('data/active_lifecycle.json', 'utf8'));

const times = ['2026. 1. 29. 오후 4:04:00', '2026. 1. 29. 오후 4:15:00', '2026. 1. 29. 오후 4:16:00'];
let output = '=== [Incident 2] Sync Check for Multiple Zones ===\n';

Object.keys(data.zones).forEach(regId => {
    const zone = data.zones[regId];
    times.forEach(t => {
        const entry = zone.history.find(h => h.timestamp === t);
        if (entry && entry.hub.match === '정보없음') {
            output += `[${t}] ${zone.regKo} (${regId}) -> Match: ${entry.hub.match}\n`;
        }
    });
});

fs.writeFileSync('incident_2_sync_check.txt', output);
