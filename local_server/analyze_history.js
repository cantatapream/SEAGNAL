const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

console.log('--- 5-Minute Archive Historical Discrepancy Analysis ---');

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const history = data.history || [];

    if (history.length < 2) return;

    let totalMissingEvents = 0;
    let totalGhostEvents = 0;
    let missingLog = [];

    history.forEach((snap, index) => {
        const timestamp = snap.kst || snap.timestamp;
        const missingInSnap = snap.afso.filter(a => a.status === 'MISSING');

        // 1. Detect "MISSING" events (HUB has it, AFSO doesn't)
        if (missingInSnap.length > 0) {
            totalMissingEvents++;
            missingInSnap.forEach(m => {
                missingLog.push(`  [${timestamp}] MISSING: ${m.regKo} - ${m.detail}`);
            });
        }

        // 2. Detect "Ghost Retain" transitions (HUB says released, but AFSO still active)
        const activeHub = snap.hub.filter(h => h.cmd !== '해제');
        const activeAfso = snap.afso.filter(a => a.status === 'ACTIVE' && (a.wrnTp === '' || !a.wrnTp));

        if (activeHub.length === 0 && activeAfso.length > 0) {
            totalGhostEvents++;
        }
    });

    if (totalMissingEvents > 0 || totalGhostEvents > 0) {
        console.log(`\n[${zoneName}]`);
        console.log(`  - Total Snapshots Recorded: ${history.length}`);
        if (totalMissingEvents > 0) {
            console.log(`  - Data Missing Incidents (AFSO update failure): ${totalMissingEvents}`);
            // Show only first and last missing for brevity
            if (missingLog.length > 5) {
                console.log(missingLog[0]);
                console.log('  ...');
                console.log(missingLog[missingLog.length - 1]);
            } else {
                missingLog.forEach(l => console.log(l));
            }
        }
        if (totalGhostEvents > 0) {
            console.log(`  - Ghost Retain Incidents (AFSO cleanup failure): ${totalGhostEvents} snapshots`);
        }
    }
});
