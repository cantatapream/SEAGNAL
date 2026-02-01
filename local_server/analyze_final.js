const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

let activeCount = 0;
let preliminaryOnlyCount = 0;
let clearCount = 0;

let activeZones = [];
let prelimZones = [];

files.forEach(file => {
    const content = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const latest = content.history[content.history.length - 1];

    const hasActive = latest.afso.some(a => a.status === 'ACTIVE' && a.cmd !== '해제');
    const hasPrelim = latest.afso.some(a => a.status === 'PRELIMINARY' && a.cmd !== '해제');

    if (hasActive) {
        activeCount++;
        activeZones.push(file.replace('.json', ''));
    } else if (hasPrelim) {
        preliminaryOnlyCount++;
        prelimZones.push(file.replace('.json', ''));
    } else {
        clearCount++;
    }
});

console.log(`--- Refined Archive Analysis ---`);
console.log(`Total Tracked Zones: ${files.length}`);
console.log(`1. Active Warning Zones (주의보/경보): ${activeCount}`);
console.log(`2. Preliminary Only (예비특보만): ${preliminaryOnlyCount}`);
console.log(`3. Clear Zones (특보 없음): ${clearCount}`);
console.log(`\n[Active Zones]\n${activeZones.join(', ')}`);
console.log(`\n[Preliminary Only Zones]\n${prelimZones.join(', ')}`);
