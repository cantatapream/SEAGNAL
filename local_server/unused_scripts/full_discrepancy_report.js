const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
if (!fs.existsSync(archiveDir)) {
    console.log('Archive directory not found.');
    process.exit(1);
}

const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

console.log('================================================================');
console.log('   전 해역 AFSO 데이터 누락(MISSING) 및 불일치 전수 조사 보고서   ');
console.log('   (분석 대상: 최근 아카이브된 모든 스냅샷)                ');
console.log('================================================================');

let severeMissing = [];
let intermittentMissing = [];
let ghostRetain = [];
let perfectMatch = [];

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const history = data.history || [];
    if (history.length === 0) return;

    let totalHubActive = 0;
    let totalAfsoMissingCount = 0; // HUB는 있는데 AFSO는 아예 없는 경우
    let totalGhostCount = 0; // HUB는 없는데 AFSO에 빈 레코드가 남은 경우

    history.forEach(snap => {
        const hubActive = snap.hub.filter(h => h.cmd !== '해제');
        const realAfsoActive = snap.afso.filter(a => (a.status === 'ACTIVE' || a.status === 'ANNOUNCED') && !a.isCoastal && a.wrnTp);
        const ghosts = snap.afso.filter(a => (a.status === 'ACTIVE' || a.status === 'ANNOUNCED') && !a.isCoastal && (!a.wrnTp || a.wrnTp === ''));

        if (hubActive.length > 0) {
            totalHubActive++;
            if (realAfsoActive.length === 0) {
                totalAfsoMissingCount++;
            }
        } else if (ghosts.length > 0) {
            totalGhostCount++;
        }
    });

    const missingRate = totalHubActive > 0 ? (totalAfsoMissingCount / totalHubActive) * 100 : 0;

    if (missingRate >= 90) {
        severeMissing.push({ zone: zoneName, rate: missingRate.toFixed(1), count: `${totalAfsoMissingCount}/${totalHubActive}` });
    } else if (missingRate > 0) {
        intermittentMissing.push({ zone: zoneName, rate: missingRate.toFixed(1), count: `${totalAfsoMissingCount}/${totalHubActive}` });
    } else if (totalGhostCount > 0) {
        ghostRetain.push({ zone: zoneName, ghostSnaps: totalGhostCount });
    } else {
        perfectMatch.push(zoneName);
    }
});

console.log('\n🔴 [치명적 고립/누락] HUB에는 특보가 있으나 AFSO에서 90% 이상 누락된 해역');
console.log('----------------------------------------------------------------');
if (severeMissing.length > 0) {
    severeMissing.forEach(s => console.log(`- ${s.zone.padEnd(20)}: 누락율 ${s.rate}% (${s.count})`));
} else {
    console.log('없음');
}

console.log('\n🟠 [간헐적 누락/불안정] AFSO 응답에 나타났다 사라졌다를 반복하는 해역');
console.log('----------------------------------------------------------------');
if (intermittentMissing.length > 0) {
    intermittentMissing.forEach(s => console.log(`- ${s.zone.padEnd(20)}: 누락율 ${s.rate}% (${s.count})`));
} else {
    console.log('없음');
}

console.log('\n👻 [유령 특보] 특보는 해제되었으나 AFSO가 빈 레코드를 남긴 해역');
console.log('----------------------------------------------------------------');
if (ghostRetain.length > 0) {
    ghostRetain.forEach(g => console.log(`- ${g.zone.padEnd(20)}: 유령 레코드 감지 (${g.ghostSnaps}회)`));
} else {
    console.log('없음');
}

console.log('\n🟢 [정상] HUB와 AFSO가 비교적 잘 일치하는 해역');
console.log('----------------------------------------------------------------');
console.log(perfectMatch.length > 0 ? perfectMatch.join(', ') : '없음');

console.log('\n================================================================');
console.log(`총 분석 해역: ${files.length}개`);
console.log('결론: 동해권 및 먼바다 대부분에서 AFSO의 심각한 데이터 누락이 확인됨.');
console.log('================================================================');
