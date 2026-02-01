const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

let activeCount = 0;
let announcedCount = 0;
let prelimCount = 0;

let activeList = new Set();
let announcedList = new Set();
let prelimList = new Set();

files.forEach(file => {
    const content = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const latest = content.history[content.history.length - 1];

    // Check for ACTIVE status across all sub-zones within this group
    const hasActive = latest.afso.some(a => a.status === 'ACTIVE');
    const hasAnnounced = latest.afso.some(a => a.status === 'ANNOUNCED');
    const hasPrelim = latest.afso.some(a => a.status === 'PRELIMINARY');

    if (hasActive) activeList.add(file.replace('.json', ''));
    if (hasAnnounced) announcedList.add(file.replace('.json', ''));
    if (hasPrelim) prelimList.add(file.replace('.json', ''));
});

// Calculate metrics based on unique AFSO zone names to match user's table (Individual Counts)
let indActive = new Set();
let indAnnounced = new Set();
let indPrelim = new Set();

files.forEach(file => {
    const content = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const latest = content.history[content.history.length - 1];
    latest.afso.forEach(a => {
        if (a.status === 'ACTIVE') indActive.add(a.regKo);
        if (a.status === 'ANNOUNCED') indAnnounced.add(a.regKo);
        if (a.status === 'PRELIMINARY') indPrelim.add(a.regKo);
    });
});

console.log(`--- Strict Real-time Analysis ---`);
console.log(`1. 가동 중인 특보 구역 (ACTIVE): ${indActive.size}`);
console.log(`2. 발효 예정 구역 (ANNOUNCED/PRELIM): ${indAnnounced.size + indPrelim.size}`);
console.log(`\n[상세 리스트 - ACTIVE]\n${Array.from(indActive).join(', ')}`);
console.log(`\n[상세 리스트 - ANNOUNCED/PRELIM]\n${Array.from(indAnnounced).join(', ')}, ${Array.from(indPrelim).join(', ')}`);
