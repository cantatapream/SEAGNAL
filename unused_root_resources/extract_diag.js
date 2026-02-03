const fs = require('fs');
const logs = JSON.parse(fs.readFileSync('fly_latest_logs_v3.json', 'utf8'));
const targets = ["남해동부안쪽먼바다", "남해동부바깥먼바다", "동해남부남쪽안쪽먼바다"];
const filtered = logs.events.filter(e => targets.includes(e.regKo));
fs.writeFileSync('logs_diagnostic.json', JSON.stringify(filtered, null, 2), 'utf8');
console.log('Done');
