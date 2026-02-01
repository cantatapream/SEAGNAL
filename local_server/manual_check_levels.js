const fs = require('fs');
const path = require('path');

const tempDir = path.join(__dirname, 'temp_archives');
const files = fs.readdirSync(tempDir);

console.log('--- 등급 불일치 수동 전수 조사 ---');

files.forEach(file => {
    const filePath = path.join(tempDir, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const zoneName = file.replace('.json', '');

    if (content.history) {
        content.history.forEach(entry => {
            const afso = entry.afso || [];
            afso.forEach(a => {
                // levelMatch 필드가 없거나 비어있는 경우를 대비해 직접 비교
                const hubWrnLvl = a.hubWrnLvl || '없음';
                const afsoWrnLvl = a.wrnLvl || '없음';

                if (hubWrnLvl !== '없음' && afsoWrnLvl !== '없음' && hubWrnLvl !== afsoWrnLvl) {
                    console.log(`[LEVEL_DIFF] ${entry.kst} | ${zoneName} | AFSO:${afsoWrnLvl} vs HUB:${hubWrnLvl}`);
                }
            });
        });
    }
});
