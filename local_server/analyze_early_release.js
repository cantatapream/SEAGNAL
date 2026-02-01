const fs = require('fs');
const path = require('path');

async function findEarlyReleaseCases() {
    const tempDir = path.join(__dirname, 'temp_archives');
    if (!fs.existsSync(tempDir)) {
        console.log('데이터가 없습니다.');
        return;
    }

    const files = fs.readdirSync(tempDir);
    const cases = [];

    files.forEach(file => {
        const filePath = path.join(tempDir, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const zoneName = file.replace('.json', '');

        if (content.history) {
            content.history.forEach(entry => {
                const kst = entry.kst;
                const hub = entry.hub || [];
                const afso = entry.afso || [];

                // 1. HUB에는 데이터가 있는데 AFSO는 완전히 비어있는 경우 (Missing)
                if (hub.length > 0 && afso.length === 0) {
                    hub.forEach(h => {
                        // cmd가 '해제'인 기록이 있는지 확인 (해제 예보 상태)
                        // 혹은 일반 '발표' 상태인데 AFSO만 먼저 빠졌는지 확인
                        cases.push({
                            zone: zoneName,
                            time: kst,
                            hubWrnTp: h.wrnTp,
                            hubWrnLvl: h.hubWrnLvl || h.wrnLvl,
                            hubCmd: h.cmd,
                            hubTmFc: h.tmFc,
                            hubTmEf: h.tmEf,
                            timestamp: new Date(entry.timestamp)
                        });
                    });
                }
            });
        }
    });

    // 시간순 정렬
    cases.sort((a, b) => a.timestamp - b.timestamp);

    console.log('--- [조사 결과] HUB는 유지중이나 AFSO만 먼저 빠진 사례 (역-누락) ---');
    console.log('------------------------------------------------------------------');

    if (cases.length === 0) {
        console.log('발견된 사례가 없습니다. (AFSO는 HUB가 해제하기 전까지 항상 데이터를 유지함)');
    } else {
        cases.forEach(c => {
            console.log(`[역-누락] ${c.time} | ${c.zone} | HUB(${c.hubWrnTp} ${c.hubWrnLvl}, ${c.hubCmd}, Ef:${c.hubTmEf}) | AFSO: 없음`);
        });
    }

    console.log('\n--- 분석 요약 ---');
    console.log(`총 발견 건수: ${cases.length}건`);

    const zoneStats = cases.reduce((acc, c) => {
        acc[c.zone] = (acc[c.zone] || 0) + 1;
        return acc;
    }, {});

    Object.entries(zoneStats).forEach(([z, count]) => {
        console.log(`${z}: ${count}회`);
    });
}

findEarlyReleaseCases();
