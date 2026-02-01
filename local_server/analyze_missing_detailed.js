const fs = require('fs');
const path = require('path');

const archiveDir = path.join(__dirname, 'data', 'archive');
const files = fs.readdirSync(archiveDir).filter(f => f.endsWith('.json'));

console.log('================================================================');
console.log('   [정밀 분석] HUB 활성 vs AFSO 조기 해제(MISSING) 분석 보고서   ');
console.log('   (HUB: 해제 전이나, AFSO: API 목록에서 사라진 사례 조사)       ');
console.log('================================================================');

files.forEach(file => {
    const zoneName = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(archiveDir, file), 'utf8'));
    const history = data.history || [];
    if (history.length === 0) return;

    // 최신 스냅샷 기준 분석
    const latest = history[history.length - 1];
    const hubActive = latest.hub.filter(h => h.cmd !== '해제');

    // AFSO에서 해당 구역이 'MISSING'으로 분류된 데이터만 추출
    const missingInAfso = latest.afso.filter(a => a.status === 'MISSING');

    if (missingInAfso.length > 0 && hubActive.length > 0) {
        console.log(`\n[${zoneName}]`);
        console.log(`  🕒 분석 시각: ${latest.kst || latest.timestamp}`);

        console.log(`  🔸 HUB 상태 (해제 전):`);
        hubActive.forEach(h => {
            console.log(`    - ${h.regKo} | ${h.wrnTp} | cmd: ${h.cmd} | tmEf: ${h.tmEf} | edTm: ${h.edTm || '(없음)'}`);
            if (h.edTm) {
                console.log(`      └─ 분석: HUB는 ${h.edTm}에 해제 예정으로 '예고' 중이나, 아직 공식 해제(cmd:해제)는 하지 않음.`);
            } else {
                console.log(`      └─ 분석: HUB는 해제 시각 정보 없이 계속 유지 중.`);
            }
        });

        console.log(`  🔹 AFSO 상태 (조기 해제됨):`);
        missingInAfso.forEach(m => {
            console.log(`    - ${m.regKo}: ${m.detail}`);
            console.log(`      └─ 결과: AFSO API 응답 목록에서 이 구역이 완전히 사라짐.`);
        });
    }
});
