const fs = require('fs');
const path = require('path');

try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'local_server/data/alert_state.json'), 'utf8'));
    const keys = Object.keys(data);

    console.log(`[검증 완료]`);
    console.log(`- 총 특보 발효 구역 수: ${keys.length}개`);

    const types = {};
    keys.forEach(k => {
        const item = data[k].current;
        const type = `${item.wrnTp}(${item.wrnLvl || ''})`;
        types[type] = (types[type] || 0) + 1;
    });

    console.log(`- 특보 종류별 분포:`, types);

} catch (e) {
    console.error('검증 실패:', e.message);
}
