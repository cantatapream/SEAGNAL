const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
if (!fs.existsSync(archiveDir)) {
    console.log('Archive directory not found.');
    process.exit(1);
}

const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

console.log('--- HUB VS AFSO DISCREPANCIES (Main Zones Only) ---');
let totalDiscrepancies = 0;

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const content = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    if (!content.history || content.history.length === 0) return;

    const latest = content.history[content.history.length - 1];
    const hub = latest.hub || [];
    const afso = latest.afso || [];

    // [Filter] Main Zones Only: regKo does not contain '연안바다' or '평수구역'
    // And from afsoSnapshot, we already tagged isCoastal: zone !== parentZone.
    // So we use a search that excludes sub-zones.

    // 1. HUB Main Active (excluding sub-mentions if any, though HUB usually only has mains)
    const activeHub = hub.filter(h => h.cmd !== '해제' && !h.regKo.includes('연안바다') && !h.regKo.includes('평수구역'));

    // 2. AFSO Main Active (excluding isCoastal and sub-zone names)
    const activeAfso = afso.filter(a =>
        (a.status === 'ACTIVE' || a.status === 'ANNOUNCED') &&
        !a.isCoastal &&
        !a.regKo.includes('연안바다') &&
        !a.regKo.includes('평수구역')
    );

    // Ghost Retain Detection (Main Zone Only)
    const ghosts = afso.filter(a => {
        if (a.status === 'MISSING' || a.status === 'RELEASED' || a.isCoastal) return false;
        if (a.regKo.includes('연안바다') || a.regKo.includes('평수구역')) return false;
        // If AFSO has an active item for the main zone, but HUB has no active items for this entire zone group
        return (a.status === 'ACTIVE' || a.status === 'ANNOUNCED') && activeHub.length === 0;
    });

    if (ghosts.length > 0 || activeHub.length !== activeAfso.length) {
        totalDiscrepancies++;
        console.log(`\n[${zoneName}]`);

        if (ghosts.length > 0) {
            console.log(`  👻 Ghost Retain:`);
            ghosts.forEach(g => {
                console.log(`    - AFSO Main: ${g.regKo.trim()} | ${g.wrnTp || '(Empty)'} | Status: ${g.status}`);
            });
        }

        if (activeHub.length !== activeAfso.length) {
            console.log(`  ⚖️ Count Mismatch (Main): HUB=${activeHub.length}, AFSO=${activeAfso.length}`);
            if (activeHub.length > 0) console.log(`    - HUB Active: ${activeHub.map(h => `${h.regKo}(${h.wrnTp})`).join(', ')}`);
            if (activeAfso.length > 0) console.log(`    - AFSO Active: ${activeAfso.map(a => `${a.regKo}(${a.wrnTp})`).join(', ')}`);
        }
    }
});

if (totalDiscrepancies === 0) {
    console.log('No discrepancies found for main zones.');
} else {
    console.log(`\nTotal Main Zones with Discrepancies: ${totalDiscrepancies}`);
}
