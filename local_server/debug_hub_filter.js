const fs = require('fs');
const path = require('path');

const warningsPath = path.join(__dirname, 'data', 'warnings.json');
const rawData = JSON.parse(fs.readFileSync(warningsPath, 'utf8'));

let kmaRaw = rawData.kma;
if (kmaRaw.startsWith('BASE64:')) {
    kmaRaw = Buffer.from(kmaRaw.substring(7), 'base64').toString('utf8');
}

const lines = kmaRaw.split('\n');
console.log('--- Matching HUB Records for "광역" or "강원" or "동해중부" ---');
lines.forEach(line => {
    if (line.includes('강원') || line.includes('동해중부') || line.includes('서해남부') || line.includes('제주')) {
        console.log(line);
    }
});
