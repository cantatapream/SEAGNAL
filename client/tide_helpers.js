
// [New] IDW 결과를 TideBED 데이터 형식으로 변환 (어댑터)
function convertIDWToTideBedFormat(idwResult, dateInt) {
    if (!idwResult) return {};
    const obj = {
        requestDate: dateInt,
        tideBedStatus: 'complete (IDW)',
        tideBedData: [] // 1분 데이터는 없음 (보간으로 채움)
    };

    // IDW 결과(highTide1Time, highTide1Level 등)를 TideBED 형식(highTide1: {time, height})으로 매핑
    for (let i = 1; i <= 4; i++) {
        const timeKey = `highTide${i}Time`;
        const levelKey = `highTide${i}Level`;
        if (idwResult[timeKey] && idwResult[levelKey] !== undefined) {
            obj[`highTide${i}`] = {
                time: idwResult[timeKey],
                height: idwResult[levelKey]
            };
        }

        const lowTimeKey = `lowTide${i}Time`;
        const lowLevelKey = `lowTide${i}Level`;
        if (idwResult[lowTimeKey] && idwResult[lowLevelKey] !== undefined) {
            obj[`lowTide${i}`] = {
                time: idwResult[lowTimeKey],
                height: idwResult[lowLevelKey]
            };
        }
    }
    return obj;
}

// [New] 클라이언트용 전일/익일 날짜 계산 (YYYYMMDD 정수 반환)
function getClientAdjacentDates(baseDateObj) {
    const formatDate = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dt = String(d.getDate()).padStart(2, '0');
        return parseInt(`${y}${m}${dt}`);
    };

    const prev = new Date(baseDateObj);
    prev.setDate(prev.getDate() - 1);

    const next = new Date(baseDateObj);
    next.setDate(next.getDate() + 1);

    return {
        yesterday: formatDate(prev),
        today: formatDate(baseDateObj),
        tomorrow: formatDate(next),
        yesterdayObj: prev,
        todayObj: baseDateObj,
        tomorrowObj: next
    };
}
