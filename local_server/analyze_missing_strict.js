const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

console.log('================================================================');
console.log('   [정밀 분석] HUB 활성 상태 vs AFSO 목록 부재(MISSING) 추적     ');
console.log('   (분석 기준: HUB cmd !== 해제 AND AFSO 응답 목록에 없음)        ');
console.log('================================================================');

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const history = data.history || [];

    let missingLog = [];

    history.forEach((snap, idx) => {
        const hubActive = snap.hub.filter(h => h.cmd !== '해제');

        hubActive.forEach(h => {
            // AFSO 목록에 해당 구역(regKo)이 있는지 확인 (status !== MISSING 인 것들 중)
            const existsInAfso = snap.afso.some(a =>
                a.status !== 'MISSING' &&
                (a.regKo || '').replace(/\s+/g, '').includes(h.regKo.replace(/\s+/g, ''))
            );

            if (!existsInAfso) {
                missingLog.push({
                    time: snap.kst || snap.timestamp,
                    hubType: h.wrnTp,
                    hubCmd: h.cmd,
                    hubEdTm: h.edTm || '없음'
                });
            }
        });
    });

    if (missingLog.length > 0) {
        console.log(`\n[${zoneName}]`);
        console.log(`  - 분석된 스냅샷: ${history.length}회 중 ${missingLog.length}회 누락`);

        const first = missingLog[0];
        const last = missingLog[missingLog.length - 1];

        console.log(`  - 최초 누락: ${first.time} [HUB: ${first.hubType}, CMD: ${first.hubCmd}, 예고: ${first.hubEdTm}]`);
        if (missingLog.length > 1) {
            console.log(`  - 최종 누락: ${last.time} [HUB: ${last.hubType}, CMD: ${last.hubCmd}, 예고: ${last.hubEdTm}]`);
        }

        // 조기 해제 구간 분석 (예고 시각이 미래인데 목록에서 사라진 경우)
        const earlyRemovals = missingLog.filter(m => m.hubEdTm && m.hubEdTm !== '없음');
        if (earlyRemovals.length > 0) {
            console.log(`  - ⚠️ 조기 해제(예고 시간 전 사라짐) 패턴이 확인됨 (${earlyRemovals.length}회)`);
        }
    }
});
