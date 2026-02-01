const fs = require('fs');
const https = require('https');

https.get('https://seagnal-server.fly.dev/api/warnings', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const json = JSON.parse(data);

        // 1. Parse HUB data
        const hubMap = {};
        if (json.kma && json.kma.startsWith('BASE64:')) {
            const base64Data = json.kma.replace('BASE64:', '');
            const hubDecoded = Buffer.from(base64Data, 'base64').toString('utf-8');

            const lines = hubDecoded.split('\n').filter(l => l.trim() && !l.startsWith('#'));
            lines.forEach(line => {
                const parts = line.split(',').map(p => p.trim());
                if (parts.length >= 10) {
                    const regId = parts[2];
                    const regKo = parts[3].trim();
                    const tmFc = parts[4];
                    const tmEf = parts[5];
                    const wrnTp = parts[6];
                    const wrnLvl = parts[7];
                    const wrnCmd = parts[8];
                    const tmEd = parts[9];

                    if (regKo && wrnTp) {
                        hubMap[regId] = { regKo, wrnTp, wrnLvl, wrnCmd, tmFc, tmEf, tmEd };
                    }
                }
            });
        }

        // 2. Parse AFSO data
        const afsoMap = {};
        const afsoData = json.afso?.data?.metData || [];
        afsoData.forEach(item => {
            if (item.regId) {
                afsoMap[item.regId] = {
                    regKo: (item.regKo || '').trim(),
                    wrnTp: item.wrnTp || '',
                    wrnLvl: item.wrnLvlName || '',
                    wrnCmd: item.wrnCmd || '',
                    tmFc: item.tmFc || '',
                    tmEf: item.tmEf || item.tmEfOrg || '',
                    tmEd: item.tmEd || ''
                };
            }
        });

        // 3. Merge all zones
        const allZones = new Set([...Object.keys(hubMap), ...Object.keys(afsoMap)]);

        // 4. Output
        console.log('='.repeat(180));
        console.log('📊 HUB vs AFSO 전체 특보구역 비교 (2026-01-08 21:20 KST)');
        console.log('='.repeat(180));
        console.log('');
        console.log('| 해역명 | 특보 | 등급H/A | 명령H/A | 발표시각 HUB / AFSO | 발효시각 HUB / AFSO | 해제예정 HUB / AFSO |');
        console.log('|' + '-'.repeat(178) + '|');

        const sortedZones = Array.from(allZones).sort();

        sortedZones.forEach(regId => {
            const hub = hubMap[regId] || {};
            const afso = afsoMap[regId] || {};

            // Skip if both have no data
            if (!hub.wrnTp && !afso.wrnTp) return;

            const regKo = (afso.regKo || hub.regKo || regId).substring(0, 25);
            const wrnTp = afso.wrnTp || hub.wrnTp || '-';
            const wrnLvlH = hub.wrnLvl || '-';
            const wrnLvlA = afso.wrnLvl || '-';
            const wrnCmdH = hub.wrnCmd || '-';
            const wrnCmdA = afso.wrnCmd || '-';
            const tmFcH = hub.tmFc || '-';
            const tmFcA = afso.tmFc || '-';
            const tmEfH = hub.tmEf || '-';
            const tmEfA = afso.tmEf || '-';
            const tmEdH = (hub.tmEd || '-').substring(0, 18);
            const tmEdA = (afso.tmEd || '-').substring(0, 18);

            console.log(`| ${regKo.padEnd(25)} | ${wrnTp.padEnd(4)} | ${wrnLvlH}/${wrnLvlA} | ${wrnCmdH}/${wrnCmdA} | ${tmFcH} / ${tmFcA} | ${tmEfH} / ${tmEfA} | ${tmEdH} / ${tmEdA} |`);
        });

        console.log('');
        console.log('='.repeat(180));
        console.log(`HUB 특보 구역: ${Object.keys(hubMap).filter(k => hubMap[k].wrnTp).length}개`);
        console.log(`AFSO 특보 구역: ${Object.keys(afsoMap).filter(k => afsoMap[k].wrnTp).length}개`);
        console.log('='.repeat(180));
    });
}).on('error', (e) => {
    console.error('Error:', e.message);
});
