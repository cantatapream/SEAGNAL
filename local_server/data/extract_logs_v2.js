const fs = require('fs');
const logs = JSON.parse(fs.readFileSync('fly_latest_logs_v3.json', 'utf8'));
const target = "동해남부남쪽안쪽먼바다";
const filtered = logs.events.filter(e => e.regKo === target);
fs.writeFileSync('logs_donghae_utf8.json', JSON.stringify(filtered, null, 2), 'utf8');
console.log('Done');
