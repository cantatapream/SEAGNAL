
// [New] 동해 북부 예외 처리 함수 (북위 36도 이북 & 동해)
async function processEastSeaNorthException(latitude, longitude, coordinate) {
    showTidePopup(coordinate, { clickedLat: latitude.toFixed(6), clickedLon: longitude.toFixed(6), loading: true });

    const dates = getClientAdjacentDates(currentTideDate);
    const years = new Set([
        dates.yesterdayObj.getFullYear(),
        dates.todayObj.getFullYear(),
        dates.tomorrowObj.getFullYear()
    ]);

    for (const y of years) {
        const loaded = await loadTideData(String(y));
        if (!loaded) {
            showTidePopup(coordinate, {
                clickedLat: latitude.toFixed(6),
                clickedLon: longitude.toFixed(6),
                error: `${y}년 조석 데이터(표준항)를 불러올 수 없습니다.`
            });
            return;
        }
    }

    const result = {};
    const keyMap = { yesterday: dates.yesterday, today: dates.today, tomorrow: dates.tomorrow };

    for (const [key, dateInt] of Object.entries(keyMap)) {
        const stations = findNearestStationsWithData(latitude, longitude, dateInt, 3);
        if (stations.length === 0) {
            showTidePopup(coordinate, {
                clickedLat: latitude.toFixed(6),
                clickedLon: longitude.toFixed(6),
                error: '동해 북부 예보를 위한 근거 데이터가 부족합니다.'
            });
            return;
        }
        const idw = interpolateTideByIDW(stations);
        result[key] = convertIDWToTideBedFormat(idw, dateInt);
    }

    console.log('⚡ 동해 북부 예외 처리: IDW 결과 표출 (표준항 보간)');

    // [UI Hint] IDW 결과임을 명시하기 위한 가짜 데이터 추가 (필요시)
    // result.today.tideBedStatus = 'complete (IDW)';

    showTidePopup(coordinate, {
        clickedLat: latitude.toFixed(6),
        clickedLon: longitude.toFixed(6),
        tideBed: result
    });
}
