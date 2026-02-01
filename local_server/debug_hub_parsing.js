const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, 'data/hub_hybrid_history.json');

try {
    const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    const latest = data[0];

    console.log(`[Cycle] KST: ${latest.kstDisplay}, Type: ${latest.type}`);
    const lines = latest.raw.split('\n');

    console.log('--- Raw Lines (first 10) ---');
    lines.slice(0, 10).forEach(l => console.log(`[${l}]`));

    console.log('--- Marine Zones Found ---');
    lines.forEach(l => {
        if (l.trim().startsWith('#')) return;
        const parts = l.split(',').map(s => s.trim());
        if (parts[2] && parts[2].startsWith('S')) {
            console.log(`MATCH: ${l}`);
        }
    });
} catch (e) {
    console.error('Error:', e.message);
}
