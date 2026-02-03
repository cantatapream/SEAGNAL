// 1. 발표 (Scenario 1)
if (statusId === 'publish') {
    title = `🔔 ${warnName} 발표`;
    body = ''; // [Fix] 중복 문구 제거
    timeGroups.forEach(tg => {
        body += `ㅇ${buildZoneList(tg.zones)}\n`;
        body += `  - 발효예정: ${fmtRange(tg.tmEf)}\n`;
    });
}
// 2. 발효 (Scenario 2)
else if (statusId === 'active') {
    title = `⚠️ ${warnName} 발효`;
    body = ''; // [Fix] 중복 문구 제거
    timeGroups.forEach(tg => {
        body += `ㅇ${buildZoneList(tg.zones)}\n`;
        body += `  - 해제예정: ${tg.tmYn ? fmtRange(tg.tmYn) : '미정'}\n`;
    });
}
// 3. 해제
else if (statusId === 'release') {
    // [Fix] 해제 시 '예비' 삭제 및 명칭 정교화
    const cleanWarnName = warnName.replace(/예비/g, '주의보').replace(/주의보\s?주의보/g, '주의보').trim();
    title = `✅ ${cleanWarnName} 해제`;
    const zonesAll = group.zones.map(z => getCoastalExclusionText(z.regKo, allActiveZones));
    body = `✅ ${cleanWarnName} 해제\n${fmtShort(firstTimeGroup.tmEf)}부 ${buildZoneList(zonesAll)} 에 발령되었던 ${cleanWarnName}가 해제되었습니다.`;
}
// 4. 격상/격하
else if (levelChange === 'upgrade' || levelChange === 'downgrade') {
    const iconLvl = levelChange === 'upgrade' ? '🔺' : '🔻';
    const titleWord = levelChange === 'upgrade' ? '격상' : '격하';
    title = `${iconLvl} ${warnName} ${titleWord}`;

    const prevName = getWarningType(group.wrnTp) + (levelChange === 'upgrade' ? '주의보' : '경보');
    body = `ㅇ${fmtShort(firstTimeGroup.tmEf)}부 ${buildZoneList(group.zones.map(z => z.regKo))} ${prevName} → ${warnName}로 ${titleWord}되었습니다.\n`; // [Fix] 중복 제목 제거
    timeGroups.forEach(tg => {
        body += `  - ${tg.zones.length === group.zones.length ? '' : buildZoneList(tg.zones) + ' '}해제예정: ${tg.tmYn ? fmtRange(tg.tmYn) : '미정'}\n`;
    });
}
