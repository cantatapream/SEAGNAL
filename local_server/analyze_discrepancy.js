const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
if (!fs.existsSync(archiveDir)) {
    console.log('Archive directory not found.');
    process.exit(1);
}

const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

let discrepancies = [];

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const content = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    if (!content.history || content.history.length === 0) return;

    const latest = content.history[content.history.length - 1];
    const hub = latest.hub || [];
    const afso = latest.afso || [];

    // 1. Check for MISSING AFSO data (Already detected by our logic)
    const missingInAfso = afso.filter(a => a.status === 'MISSING');
    if (missingInAfso.length > 0) {
        discrepancies.push({
            zone: zoneName,
            type: 'MISSING_IN_AFSO',
            details: missingInAfso.map(m => m.regKo || zoneName).join(', ')
        });
    }

    // 2. Compare Active Alerts Count (Only comparing Parent/Main zones for simplicity)
    const activeHub = hub.filter(h => h.cmd !== '해제');
    const activeAfso = afso.filter(a => a.status === 'ACTIVE' && !a.isCoastal); // Parent only

    if (activeHub.length !== activeAfso.length) {
        discrepancies.push({
            zone: zoneName,
            type: 'COUNT_MISMATCH',
            details: `HUB has ${activeHub.length} active, AFSO has ${activeAfso.length} active (Main Zone)`
        });
    }

    // 3. Compare Alert Levels for matching zones
    activeHub.forEach(h => {
        const match = activeAfso.find(a => a.regKo === h.regKo && a.wrnTp === h.wrnTp);
        if (match) {
            const hubLvl = (h.wrnLvl || '').replace('보', '').replace('경', '경보').replace('주', '주의보');
            const afsoLvl = match.wrnLvl || '';
            if (!afsoLvl.includes(h.wrnLvl)) { // Weak matching due to naming differences
                // discrepancies.push({ zone: zoneName, type: 'LEVEL_MISMATCH', details: `HUB: ${h.wrnLvl}, AFSO: ${match.wrnLvl}` });
            }
        }
    });
});

console.log(`--- HUB vs AFSO Discrepancy Analysis ---`);
if (discrepancies.length === 0) {
    console.log('No major discrepancies found in the latest snapshots.');
} else {
    console.log(`Found ${discrepancies.length} discrepancy records:\n`);
    discrepancies.forEach(d => {
        console.log(`[${d.zone}] ${d.type}: ${d.details}`);
    });
}
