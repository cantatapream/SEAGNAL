const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

let activeCount = 0;
let clearCount = 0;
let details = [];

files.forEach(file => {
    const content = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const latest = content.history[content.history.length - 1];

    // Check if there's any active alert in hub or afso
    const hasHubAlert = latest.hub.some(h => h.cmd !== '해제');
    const hasAfsoAlert = latest.afso.some(a => a.status !== 'MISSING' && a.cmd !== '해제');

    if (hasHubAlert || hasAfsoAlert) {
        activeCount++;
        details.push({ name: file.replace('.json', ''), status: '특보 있음' });
    } else {
        clearCount++;
    }
});

console.log(`--- Archive Analysis Summary ---`);
console.log(`Total Sea Zones Tracked: ${files.length}`);
console.log(`Active Warning Zones: ${activeCount}`);
console.log(`Clear Zones: ${clearCount}`);
console.log(`\nActive Zones List:`, details.map(d => d.name).join(', '));
