const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const targetZones = ['강원남부앞바다', '강원북부앞바다', '강원중부앞바다', '경북북부앞바다'];

console.log('--- Targeted AFSO Missing Analysis (Gangwon & Gyeongbuk North) ---');

targetZones.forEach(zoneName => {
    const filePath = path.join(archiveDir, `${zoneName}.json`);
    if (!fs.existsSync(filePath)) {
        console.log(`[${zoneName}] File not found in archive.`);
        return;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const history = data.history || [];

    let missingCount = 0;
    let hubAlertSample = '';

    history.forEach(snap => {
        const hubActive = snap.hub.filter(h => h.cmd !== '해제');
        const realAfsoActive = snap.afso.filter(a => (a.status === 'ACTIVE' || a.status === 'ANNOUNCED') && !a.isCoastal && a.wrnTp);

        if (hubActive.length > 0) {
            hubAlertSample = hubActive.map(h => h.wrnTp).join(', ');
            if (realAfsoActive.length === 0) {
                missingCount++;
            }
        }
    });

    console.log(`\n[${zoneName}]`);
    console.log(`  - Total Snapshots: ${history.length}`);
    console.log(`  - Instances where HUB active but AFSO missing: ${missingCount}`);
    console.log(`  - HUB Alert Type: ${hubAlertSample || 'None'}`);

    if (missingCount === history.length && history.length > 0) {
        console.log(`  => RESULT: 100% MISSING (HUB has it, AFSO never sent it)`);
    } else if (missingCount > 0) {
        console.log(`  => RESULT: Partial Discrepancy (${Math.round(missingCount / history.length * 100)}% missing)`);
    } else {
        console.log(`  => RESULT: Clear (Matches or no HUB alerts)`);
    }
});
