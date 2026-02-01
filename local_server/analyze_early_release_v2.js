const fs = require('fs');
const path = require('path');

async function findEarlyReleaseDetailed() {
    const tempDir = path.join(__dirname, 'temp_archives');
    if (!fs.existsSync(tempDir)) {
        console.log('데이터가 없습니다.');
        return;
    }

    const files = fs.readdirSync(tempDir);
    const cases = [];

    console.log(`총 ${files.length}개 해역 분석 중...`);

    files.forEach(file => {
        const filePath = path.join(tempDir, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const zoneName = file.replace('.json', '');

        if (content.history) {
            content.history.forEach(entry => {
                const kst = entry.kst;
                const hub = entry.hub || [];
                const afso = entry.afso || [];

                // 27일~28일 전체 기록 대상
                if (!kst.includes('2026. 1. 27.') && !kst.includes('2026. 1. 28.')) return;

                // 상황: HUB에는 활성 특보(해제되지 않은 상태이거나 해제 발표는 났으나 물리적 시간은 남은 상태)가 있는데 
                // AFSO에는 해당 특보 정보가 아예 없는 경우

                const hubActive = hub.filter(h => h.cmd !== '해제');
                // 해제 커맨드가 아닌 '발표' 등의 상태가 HUB에 있는데 AFSO는 비어있는지 확인
                if (hubActive.length > 0 && afso.length === 0) {
                    cases.push({
                        zone: zoneName,
                        time: kst,
                        hubInfo: hubActive.map(h => `${h.wrnTp}(${h.cmd}, Ef:${h.tmEf})`).join(', '),
                        timestamp: new Date(entry.timestamp)
                    });
                }
            });
        }
    });

    cases.sort((a, b) => a.timestamp - b.timestamp);

    console.log('\n--- [정밀 조사] HUB는 데이터 전송 중이나 AFSO만 조기 종료한 사례 ---');
    console.log('----------------------------------------------------------------------');

    if (cases.length === 0) {
        console.log('역-누락(AFSO 조기 해제) 사례가 단 한 건도 발견되지 않았습니다.');
        console.log('이것은 AFSO가 HUB보다 먼저 데이터를 지우는 경우는 사실상 없음을 의미합니다.');
    } else {
        cases.forEach(c => {
            console.log(`[조기해제 의심] ${c.time} | ${c.zone} | HUB: ${c.hubInfo} | AFSO: 없음`);
        });
    }

    console.log('\n--- 분석 요약 ---');
    console.log(`전수 조사 완료. 발견된 조기 해제 사례: ${cases.length}건`);
}

findEarlyReleaseDetailed();
