const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, 'data/hub_hybrid_history.json');

try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    // Get latest entries
    const latest = data.slice(0, 3);

    latest.forEach(entry => {
        console.log(`[Cycle] KST: ${entry.kstDisplay}, Type: ${entry.type}`);
        const lines = entry.raw.split('\n').filter(l => l.trim() && !l.startsWith('#'));

        const marineCount = lines.filter(l => {
            const parts = l.split(',').map(s => s.trim());
            return parts[2] && parts[2].startsWith('S');
        }).length;

        const landCount = lines.filter(l => {
            const parts = l.split(',').map(s => s.trim());
            return parts[2] && parts[2].startsWith('L');
        }).length;

        console.log(`  - Marine Zones: ${marineCount}`);
        console.log(`  - Land Zones: ${landCount}`);

        if (marineCount > 0) {
            console.log(`  - Sample Marine: ${lines.find(l => l.split(',')[2]?.startsWith('S'))}`);
        }
        console.log('-----------------------------------------');
    });
} catch (e) {
    console.error('Error:', e.message);
}
