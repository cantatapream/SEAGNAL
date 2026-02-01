const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'server_archive_gangwon.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

console.log(`--- 분석 시작: ${filePath} ---`);
console.log(`총 레코드 수: ${data.history.length}`);

let missingCount = 0;
let ghostCount = 0;
let mismatchCount = 0;

data.history.forEach(entry => {
    const kst = entry.kst;
    const hub = entry.hub || [];
    const afso = entry.afso || [];

    // 1. MISSING (HUB 에는 있으나 AFSO 에는 없는 경우)
    // 27일 이후 데이터만 필터링 (kst: 2026. 1. 27...)
    if (kst.includes('2026. 1. 27.') || kst.includes('2026. 1. 28.')) {

        // HUB 활성 특보 확인 (cmd !== '해제')
        const activeHub = hub.filter(h => h.cmd !== '해제');

        if (activeHub.length > 0 && afso.length === 0) {
            missingCount++;
            console.log(`[MISSING] ${kst} | HUB: ${activeHub.map(h => h.wrnTp + ' ' + h.wrnLvl).join(', ')} | AFSO: 없음`);
        }

        // 2. LEVEL MISMATCH & GHOST
        afso.forEach(a => {
            if (a.levelMatch && a.levelMatch !== 'MATCH') {
                if (a.levelMatch === 'GHOST') {
                    ghostCount++;
                    console.log(`[GHOST] ${kst} | AFSO: ${a.wrnTp} ${a.wrnLvl} | HUB: 없음`);
                } else {
                    mismatchCount++;
                    console.log(`[${a.levelMatch}] ${kst} | AFSO: ${a.wrnTp} ${a.wrnLvl} | HUB: ${a.hubWrnLvl}`);
                }
            }
        });
    }
});

console.log('\n--- 분석 결과 요약 ---');
console.log(`누락(MISSING): ${missingCount}건`);
console.log(`유령(GHOST): ${ghostCount}건`);
console.log(`등급 불일치: ${mismatchCount}건`);
