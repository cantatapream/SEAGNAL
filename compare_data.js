const fs = require('fs');
const https = require('https');

// Fetch warnings data from server
https.get('https://seagnal-server.fly.dev/api/warnings', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const json = JSON.parse(data);

        console.log('='.repeat(80));
        console.log('📊 HUB vs AFSO 특보 데이터 비교');
        console.log('='.repeat(80));

        // Decode HUB data (Base64)
        let hubDecoded = '';
        if (json.kma && json.kma.startsWith('BASE64:')) {
            const base64Data = json.kma.replace('BASE64:', '');
            hubDecoded = Buffer.from(base64Data, 'base64').toString('utf-8');
        }

        console.log('\n[1] KMA HUB 원본 데이터 (Base64 디코딩):\n');
        console.log(hubDecoded.substring(0, 3000));
        console.log('\n... (truncated)\n');

        // AFSO data
        console.log('\n[2] AFSO 데이터 (발효 중인 특보만):\n');
        const afsoData = json.afso?.data?.metData || [];
        const activeAlerts = afsoData.filter(item => item.wrnTp && item.wrnTp !== '');

        console.log('구역명 | 특보 | 등급 | 명령 | 발표시각 | 발효시각 | 해제예정');
        console.log('-'.repeat(100));

        activeAlerts.forEach(item => {
            const regKo = (item.regKo || '').trim();
            const wrnTp = item.wrnTp || '';
            const wrnLvl = item.wrnLvlName || '';
            const wrnCmd = item.wrnCmd || '';
            const tmFc = item.tmFc || '-';
            const tmEf = item.tmEf || item.tmEfOrg || '-';
            const tmEd = item.tmEd || '-';

            console.log(`${regKo} | ${wrnTp} | ${wrnLvl} | ${wrnCmd} | ${tmFc} | ${tmEf} | ${tmEd}`);
        });

        console.log('\n='.repeat(80));
        console.log(`총 ${activeAlerts.length}개 구역에 특보 발효 중`);
        console.log('='.repeat(80));
    });
}).on('error', (e) => {
    console.error('Error:', e.message);
});
