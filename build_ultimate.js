const fs = require('fs');
const tree = fs.readFileSync('empty_tree.json', 'utf8');
const scriptContent = `
const fs = require('fs');
const tree = ${tree};
const { updateZoneStatus, ZONE_GROUP_MAP } = require('./local_server/report_alert_processor');

const events = [
    {
        reportId: "met:202602100400:19",
        type: "풍랑예비특보",
        command: "예비",
        time: "2026년 02월 11일 새벽",
        zones: ["남해동부바깥먼바다", "제주도남쪽바깥먼바다"],
        tmFc: "2026년 02월 10일 04시 00분",
        originalTitle: "[특보] 제02-19호 : 2026.02.10.04:00/ 예비특보"
    },
    {
        reportId: "met:202602110600:116",
        type: "풍랑주의보",
        command: "발표",
        time: "2026년 02월 11일 08시 00분",
        zones: ["남해동부바깥먼바다", "제주도남쪽바깥먼바다"],
        tmFc: "2026년 02월 10일 04시 00분",
        tmYn: "11일 늦은 오후(15시~18시)",
        originalTitle: "[특보] 제02-116호 : 2026.02.11.06:00/ 풍랑주의보 발표"
    },
    {
        reportId: "met:202602110800:117",
        type: "풍랑주의보",
        command: "발표",
        time: "2026년 02월 11일 09시 00분",
        zones: ["제주도남동쪽안쪽먼바다"],
        tmFc: "2026년 02월 11일 08시 00분",
        tmYn: "11일 늦은 오후(15시~18시)",
        originalTitle: "[특보] 제02-117호 : 2026.02.11.08:00/ 풍랑주의보 발표"
    }
];

const data = {
    updatedAt: new Date().toLocaleString("ko-KR"),
    lastReportId: "met:202602110800:117",
    previous: JSON.parse(JSON.stringify(tree)),
    current: JSON.parse(JSON.stringify(tree))
};

events.forEach(event => {
    event.zones.forEach(z => {
        let targetZones = [];
        if (ZONE_GROUP_MAP[z]) targetZones = targetZones.concat(ZONE_GROUP_MAP[z]);
        else targetZones.push(z);

        targetZones.forEach(zoneName => {
            updateZoneStatus(data.current, zoneName, event);
        });
    });
});

fs.writeFileSync("./local_server/data/weather_alerts.json", JSON.stringify(data, null, 2));
console.log("Server Restored Successfully");
`;

fs.writeFileSync('diag_ultimate_restore.js', scriptContent);
console.log('diag_ultimate_restore.js created');
