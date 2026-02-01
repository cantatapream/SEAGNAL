const fs = require('fs');
const path = require('path');

async function analyzeDelays() {
    const tempDir = path.join(__dirname, 'temp_archives');
    if (!fs.existsSync(tempDir)) {
        console.log('먼저 analyze_all_server.js를 실행하여 데이터를 다운로드해야 합니다.');
        return;
    }

    const files = fs.readdirSync(tempDir);
    const delayLogs = [];

    files.forEach(file => {
        const filePath = path.join(tempDir, file);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const zoneName = file.replace('.json', '');

        if (content.history) {
            content.history.forEach(entry => {
                const kst = entry.kst;
                const afso = entry.afso || [];

                afso.forEach(a => {
                    if (a.levelMatch === 'UPGRADE_DELAY' || a.levelMatch === 'DOWNGRADE_DELAY') {
                        delayLogs.push({
                            type: a.levelMatch,
                            time: kst,
                            zone: zoneName,
                            afsoLvl: a.wrnLvl,
                            hubLvl: a.hubWrnLvl,
                            rawTime: new Date(entry.timestamp)
                        });
                    }
                });
            });
        }
    });

    // 시간순 정렬
    delayLogs.sort((a, b) => a.rawTime - b.rawTime);

    console.log('--- 격상/격하 지연 상세 분석 보고서 ---');
    console.log('--------------------------------------');

    if (delayLogs.length === 0) {
        console.log('감지된 격상/격하 지연 사례가 없습니다.');
        return;
    }

    let currentGroup = null;

    delayLogs.forEach(log => {
        // 동일 해역의 연속된 지연은 그룹화하여 시각화 (선택적)
        console.log(`[${log.type}] ${log.time} | ${log.zone} | AFSO: ${log.afsoLvl} vs HUB: ${log.hubLvl}`);
    });

    console.log('\n--- 통계 요약 ---');
    const stats = delayLogs.reduce((acc, log) => {
        acc[log.zone] = (acc[log.zone] || 0) + 1;
        return acc;
    }, {});

    Object.entries(stats).sort((a, b) => b[1] - a[1]).forEach(([zone, count]) => {
        console.log(`${zone}: ${count}회 감지`);
    });
}

analyzeDelays();
