const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

let summary = [];

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const history = data.history || [];

    let missingCount = 0;
    history.forEach(snap => {
        const hubActive = snap.hub.filter(h => h.cmd !== '해제');
        const realAfsoActive = snap.afso.filter(a => (a.status === 'ACTIVE' || a.status === 'ANNOUNCED') && !a.isCoastal && a.wrnTp);

        // HUB has alert but AFSO doesn't (Missing Case)
        if (hubActive.length > 0 && realAfsoActive.length === 0) {
            missingCount++;
        }
    });

    if (missingCount > 0) {
        summary.push({ zone: zoneName, missingCount, total: history.length });
    }
});

summary.sort((a, b) => b.missingCount - a.missingCount);
console.log('--- Summary of AFSO Missing Cases (HUB: Active / AFSO: None) ---');
summary.forEach(s => {
    console.log(`[${s.zone}] Missing in ${s.missingCount} / ${s.total} snapshots`);
});
