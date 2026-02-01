const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
if (!fs.existsSync(archiveDir)) {
    console.log('Archive directory not found.');
    process.exit(1);
}

const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

console.log('--- ALL HUB VS AFSO DISCREPANCIES ---');
let totalDiscrepancies = 0;

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const content = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    if (!content.history || content.history.length === 0) return;

    const latest = content.history[content.history.length - 1];
    const hub = latest.hub || [];
    const afso = latest.afso || [];

    const activeHub = hub.filter(h => h.cmd !== '해제');
    const activeAfso = afso.filter(a => a.status === 'ACTIVE' || a.status === 'ANNOUNCED');

    // Ghost Retain Detection (AFSO says something is active but HUB has nothing for this zone/broad zone)
    const ghosts = afso.filter(a => {
        if (a.status === 'MISSING' || a.status === 'RELEASED') return false;
        // If there are no active alerts in HUB for this archive file at all, it's a ghost
        return activeHub.length === 0;
    });

    // Missing in AFSO Detection
    const missing = afso.filter(a => a.status === 'MISSING');

    if (ghosts.length > 0 || missing.length > 0 || activeHub.length !== activeAfso.length) {
        totalDiscrepancies++;
        console.log(`\n[${zoneName}]`);

        if (ghosts.length > 0) {
            console.log(`  👻 Ghost Retain (${ghosts.length}):`);
            ghosts.forEach(g => {
                console.log(`    - AFSO Item: ${g.regKo.trim()} | ${g.wrnTp || '(Empty)'} | Status: ${g.status}`);
            });
        }

        if (missing.length > 0) {
            console.log(`  🔍 Missing in AFSO (Present in HUB) (${missing.length}):`);
            missing.forEach(m => {
                console.log(`    - ${m.regKo}: ${m.detail}`);
            });
        }

        if (activeHub.length !== activeAfso.length) {
            console.log(`  ⚖️ Count Mismatch: HUB=${activeHub.length}, AFSO=${activeAfso.length}`);
            if (activeHub.length > 0) {
                console.log(`    - HUB Active: ${activeHub.map(h => `${h.regKo}(${h.wrnTp})`).join(', ')}`);
            }
        }
    }
});

if (totalDiscrepancies === 0) {
    console.log('No discrepancies found.');
} else {
    console.log(`\nTotal Zones with Discrepancies: ${totalDiscrepancies}`);
}
