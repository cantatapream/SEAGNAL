const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

console.log('--- Comprehensive Historical Discrepancy Log ---');

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const history = data.history || [];

    history.forEach((snap, idx) => {
        const hubActive = snap.hub.filter(h => h.cmd !== '해제');
        const afsoActive = snap.afso.filter(a => (a.status === 'ACTIVE' || a.status === 'ANNOUNCED') && !a.isCoastal);

        // Filter out "Ghost" AFSO items (empty wrnTp) from count comparison for better accuracy
        const realAfsoActive = afsoActive.filter(a => a.wrnTp && a.wrnTp !== '');

        if (hubActive.length !== realAfsoActive.length) {
            console.log(`\n[${zoneName}] at ${snap.kst || snap.timestamp}`);
            console.log(`  HUB (${hubActive.length}): ${hubActive.map(h => h.wrnTp).join(', ') || 'None'}`);
            console.log(`  AFSO (${realAfsoActive.length}): ${realAfsoActive.map(a => a.wrnTp).join(', ') || 'None'}`);

            // Check if there are "Ghost" items we filtered
            const ghosts = afsoActive.filter(a => !a.wrnTp || a.wrnTp === '');
            if (ghosts.length > 0) {
                console.log(`  * Note: AFSO has ${ghosts.length} empty (ghost) records.`);
            }
        }
    });
});
