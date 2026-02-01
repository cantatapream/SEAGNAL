const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

let missingCount = 0;
let missingZones = [];
let activeCount = 0;

files.forEach(file => {
    const content = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const latest = content.history[content.history.length - 1];

    const isMissing = latest.afso.some(a => a.status === 'MISSING');
    if (isMissing) {
        missingCount++;
        missingZones.push(file.replace('.json', ''));
    }

    if (latest.hub.length > 0 || latest.afso.some(a => a.status !== 'MISSING')) {
        activeCount++;
    }
});

console.log(`--- Archive Detection Summary ---`);
console.log(`Total Tracked Zones: ${files.length}`);
console.log(`Active (HUB or AFSO): ${activeCount}`);
console.log(`Zones with MISSING state in AFSO: ${missingCount}`);
if (missingCount > 0) console.log(`Missing Zones: ${missingZones.join(', ')}`);
