const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const warningsPath = path.join(__dirname, 'data', 'warnings.json');
if (!fs.existsSync(warningsPath)) {
    console.error('warnings.json not found');
    process.exit(1);
}
const rawData = JSON.parse(fs.readFileSync(warningsPath, 'utf8'));

// 1. Parse HUB Raw Base64 (using EUC-KR)
let kmaRaw = rawData.kma;
let decodedHub = "";
if (kmaRaw && kmaRaw.startsWith('BASE64:')) {
    const buffer = Buffer.from(kmaRaw.substring(7), 'base64');
    decodedHub = iconv.decode(buffer, 'euc-kr');
}

function parseHub(decodedText) {
    if (!decodedText) return [];
    const lines = decodedText.split('\n');
    const records = [];
    lines.forEach(line => {
        if (line.startsWith('#') || !line.trim() || line.startsWith('START') || line.startsWith('END')) return;
        const fields = line.split(',').map(f => f.trim());
        if (fields.length < 10) return;
        records.push({
            regKo: fields[3],
            wrnTp: fields[6],
            wrnLvl: fields[7],
            cmd: fields[8],
            edTm: fields[9]
        });
    });
    return records;
}

const hubRecords = parseHub(decodedHub);
const afsoRecords = rawData.afso.metData || [];

const BROAD_MAPPING = {
    // 앞바다
    '동해남부앞바다': ['울산앞바다', '경북남부앞바다', '경북북부앞바다'],
    '동해중부앞바다': ['강원북부앞바다', '강원중부앞바다', '강원남부앞바다'],
    '서해남부앞바다': ['전북북부앞바다', '전북남부앞바다', '전남북부서해앞바다', '전남중부서해앞바다', '전남남부서해앞바다'],
    '서해중부앞바다': ['인천·경기북부앞바다', '인천·경기남부앞바다', '충남북부앞바다', '충남남부앞바다'],
    '남해동부앞바다': ['부산앞바다', '경남서부남해앞바다', '경남중부남해앞바다', '거제시동부앞바다'],
    '남해서부앞바다': ['전남서부남해앞바다', '전남동부남해앞바다'],
    '제주도앞바다': ['제주도북부앞바다', '제주도서부앞바다', '제주도남부앞바다', '제주도동부앞바다'],
    // 먼바다
    '동해남부먼바다': ['동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다', '동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다'],
    '동해중부먼바다': ['동해중부안쪽먼바다', '동해중부바깥먼바다'],
    '서해남부먼바다': ['서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다', '서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다'],
    '서해중부먼바다': ['서해중부안쪽먼바다', '서해중부바깥먼바다'],
    '남해동부먼바다': ['남해동부안쪽먼바다', '남해동부바깥먼바다'],
    '남해서부먼바다': ['남해서부서쪽먼바다', '남해서부동쪽먼바다'],
    '제주도먼바다': ['제주도남서쪽안쪽먼바다', '제주도남동쪽안쪽먼바다', '제주도남쪽바깥먼바다']
};

const ALL_TARGETS = Object.values(BROAD_MAPPING).flat();

console.log('================================================================');
console.log('   [최종 검증] 먼바다 광역 포함 불일치 보고서            ');
console.log('   (분석 시각: ' + rawData.updatedAt + ')');
console.log('================================================================');

let missingCount = 0;
let ghostCount = 0;

// 1. Check Missing
ALL_TARGETS.forEach(target => {
    const cleanTarget = target.replace(/[\s·]/g, '');
    const broadEntry = Object.entries(BROAD_MAPPING).find(([broad, children]) =>
        children.some(c => c.replace(/[\s·]/g, '') === cleanTarget)
    );
    const cleanBroadParent = broadEntry ? broadEntry[0].replace(/[\s·]/g, '') : null;

    const hubActive = hubRecords.filter(r => {
        if (r.cmd === '해제') return false;
        const hubRegRaw = (r.regKo || '').trim();
        if (hubRegRaw.includes('(')) {
            const subMatch = hubRegRaw.match(/\(([^)]+)\)/);
            if (subMatch) {
                const specific = subMatch[1].replace(/[\s·]/g, '');
                return specific === cleanTarget;
            }
        }
        const cleanHub = hubRegRaw.replace(/[\s·]/g, '');
        return (cleanBroadParent && cleanHub === cleanBroadParent) || (cleanHub === cleanTarget);
    });

    const afsoActive = afsoRecords.filter(a => {
        const cleanAfso = (a.regKo || '').replace(/[\s·]/g, '').trim();
        const hasWrnTp = a.wrnTp && a.wrnTp.trim().length > 0;
        return hasWrnTp && (cleanAfso === cleanTarget || cleanAfso.includes(cleanTarget) || cleanTarget.includes(cleanAfso));
    });

    if (hubActive.length > 0 && afsoActive.length === 0) {
        missingCount++;
        console.log(`\n🔴 [MISSING] ${target}`);
        console.log(`   - HUB: ${hubActive.map(h => `${h.regKo}(${h.wrnTp},cmd:${h.cmd})`).join(', ')}`);
    }
});

// 2. Check Ghost Retain (Excluding Level 3 for HUB match)
const afsoCleaned = afsoRecords.filter(a => a.wrnTp && a.wrnTp.trim());

afsoCleaned.forEach(a => {
    const rawName = (a.regKo || '').trim();
    const cleanName = rawName.replace(/[\s·]/g, '');

    // Level 3 name mapping to Parent (Level 2)
    // Simply check if this string contains any of our Level 2 targets
    let parentTarget = ALL_TARGETS.find(t => cleanName.includes(t.replace(/[\s·]/g, '')));
    const cleanSearchName = parentTarget ? parentTarget.replace(/[\s·]/g, '') : cleanName;

    const hasInHub = hubRecords.some(r => {
        if (r.cmd === '해제') return false;
        const hubRegRaw = (r.regKo || '').trim();
        const cleanHub = hubRegRaw.replace(/[\s·]/g, '');

        // Match name directly
        if (cleanSearchName === cleanHub || cleanSearchName.includes(cleanHub) || cleanHub.includes(cleanSearchName)) return true;

        // Cascading Broad
        const broadEntry = Object.entries(BROAD_MAPPING).find(([broad, children]) =>
            cleanHub === broad.replace(/[\s·]/g, '')
        );
        if (broadEntry) {
            const children = broadEntry[1].map(c => c.replace(/[\s·]/g, ''));
            if (children.some(c => cleanSearchName.includes(c))) return true;
        }

        // Parentheses
        if (hubRegRaw.includes('(')) {
            const subMatch = hubRegRaw.match(/\(([^)]+)\)/);
            if (subMatch) {
                const specific = subMatch[1].replace(/[\s·]/g, '');
                return cleanSearchName === specific;
            }
        }
        return false;
    });

    if (!hasInHub) {
        ghostCount++;
        console.log(`\n👻 [GHOST RETAIN] ${rawName}`);
        console.log(`   - AFSO: ${a.wrnTp} ${a.wrnLvlName || ''}`);
        console.log(`   - HUB: (해당 혹은 상위 해역 데이터 없음)`);
    }
});

console.log('\n----------------------------------------------------------------');
console.log(`분석 요약: 누락(MISSING) ${missingCount}건, 유령(GHOST) ${ghostCount}건`);
console.log('----------------------------------------------------------------');
