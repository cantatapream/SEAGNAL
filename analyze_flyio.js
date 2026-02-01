const d = require('./flyio_state.json');

console.log('=== 강원남부 관련 해역 찾기 ===\n');
Object.keys(d).forEach(k => {
    const s = d[k];
    const regKo = s.activeAlert?.regKo || s.history?.[0]?.regKo || '';
    if (regKo.includes('강원남부')) {
        console.log('KEY:', k);
        console.log('regKo:', regKo);
        console.log('Active:', s.activeAlert?.wrnLvl);
        console.log('History (Jan 13):');
        s.history?.filter(h => h._recordedAt?.includes('1. 13')).forEach(h => {
            console.log(`  ${h._recordedAt} | ${h.wrnLvl} | ${h._status || '-'}`);
        });
        console.log('---');
    }
});

console.log('\n=== 04:00 시점 기록 확인 ===\n');
Object.keys(d).forEach(k => {
    const s = d[k];
    const h400 = s.history?.find(h => h._recordedAt?.includes('1. 13. 오전 4:00'));
    if (h400) {
        console.log(`${k} (${h400.regKo}): ${h400.wrnLvl} | ${h400._status}`);
    }
});
