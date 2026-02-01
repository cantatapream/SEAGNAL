const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

console.log('================================================================');
console.log('   [역대 기록 분석] AFSO 조기 누락(MISSING) 히스토리 추적 보고서   ');
console.log('   (설정 목적: 발표/발효/변경 히스토리 및 조기 해제 구간 분석)   ');
console.log('================================================================');

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const history = data.history || [];

    let currentAlertState = null;
    let missingInstances = [];

    history.forEach((snap, idx) => {
        const hubActive = snap.hub.filter(h => h.cmd !== '해제');
        const afsoMissing = snap.afso.filter(a => a.status === 'MISSING' && !a.isCoastal);

        if (hubActive.length > 0) {
            const h = hubActive[0];
            const stateKey = `${h.wrnTp}_${h.wrnLvl}_${h.cmd}`;

            // 상태 변화 감지 (발표, 발효, 변경 등)
            if (currentAlertState !== stateKey) {
                // console.log(`  [${snap.kst}] HUB State Changed: ${h.wrnTp}(${h.wrnLvl}) - ${h.cmd}`);
                currentAlertState = stateKey;
            }

            // AFSO 누락 감지 (HUB는 살아있는데 AFSO 목록에서 빠진 경우)
            if (afsoMissing.length > 0) {
                missingInstances.push({
                    time: snap.kst || snap.timestamp,
                    hubCmd: h.cmd,
                    hubEdTm: h.edTm || '정보없음',
                    detail: afsoMissing[0].detail
                });
            }
        } else {
            currentAlertState = null;
        }
    });

    if (missingInstances.length > 0) {
        console.log(`\n[${zoneName}]`);
        console.log(`  - 총 기록 스냅샷: ${history.length}개`);
        console.log(`  - AFSO 조기 누락 발생 횟수: ${missingInstances.length}회`);

        // 누락 발생 구간 요약
        if (missingInstances.length > 0) {
            const first = missingInstances[0];
            const last = missingInstances[missingInstances.length - 1];
            console.log(`  - 첫 누락 감지 시각: ${first.time} (HUB CMD: ${first.hubCmd}, 예고시각: ${first.hubEdTm})`);
            if (missingInstances.length > 1) {
                console.log(`  - 최근 누락 감지 시각: ${last.time} (HUB CMD: ${last.hubCmd}, 예고시각: ${last.hubEdTm})`);
            }
        }
    }
});
