const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

console.log('--- Targeted Discrepancy: HUB Active (with Release Schedule) vs AFSO Missing ---');

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const history = data.history || [];

    let findings = [];

    history.forEach(snap => {
        const hubActive = snap.hub.filter(h => h.cmd !== '해제');
        const afsoActive = snap.afso.filter(a => (a.status === 'ACTIVE' || a.status === 'ANNOUNCED') && !a.isCoastal && a.wrnTp);

        if (hubActive.length > 0 && afsoActive.length === 0) {
            findings.push({
                time: snap.kst || snap.timestamp,
                hub: hubActive.map(h => `${h.wrnTp}(${h.cmd}, edTm:${h.edTm || 'none'})`).join(', ')
            });
        }
    });

    if (findings.length > 0) {
        console.log(`\n[${zoneName}] Found ${findings.length} missing instances`);
        // Show first few examples
        findings.slice(0, 3).forEach(f => {
            console.log(`  - ${f.time}: HUB says [${f.hub}], but AFSO is empty.`);
        });
        if (findings.length > 3) console.log(`  ... (${findings.length - 3} more)`);
    }
});
