// ===========================
// peak_finder.js
// TideBED 1분 조위 데이터에서 고조/저조 피크를 탐색하는 모듈
// ===========================

/**
 * 시간 문자열에서 분(minute) 단위 숫자로 변환
 */
function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.includes(' ') ? timeStr.split(' ')[1] : timeStr;
    const [h, m] = parts.split(':').map(Number);
    return h * 60 + m;
}

/**
 * 분(minute) 숫자를 "HH:mm" 문자열로 변환
 */
function minutesToTimeStr(totalMinutes) {
    while (totalMinutes < 0) totalMinutes += 1440;
    totalMinutes = totalMinutes % 1440;
    const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const m = String(totalMinutes % 60).padStart(2, '0');
    return `${h}:${m}`;
}

/**
 * 두 시간 문자열의 중간값을 계산 (자정 경계 대응)
 */
function getMidpointTime(time1, time2) {
    try {
        const d1 = new Date(time1.replace(/-/g, '/'));
        const d2 = new Date(time2.replace(/-/g, '/'));
        const mid = new Date((d1.getTime() + d2.getTime()) / 2);

        const h = String(mid.getHours()).padStart(2, '0');
        const m = String(mid.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    } catch (e) {
        const min1 = timeToMinutes(time1);
        const min2 = timeToMinutes(time2);
        const midMin = Math.round((min1 + min2) / 2);
        return minutesToTimeStr(midMin);
    }
}

/**
 * 1,440개 이상의 조위 데이터에서 고조/저조 피크를 탐색
 * @param {Array} tideBedData - TideBED API 응답의 item 배열
 * @param {string} targetDateStr - 추출하고자 하는 대상 날짜 (예: "2026-02-13")
 */
function findTidePeaks(tideBedData, targetDateStr = null) {
    if (!tideBedData || tideBedData.length === 0) {
        console.error('[PeakFinder] 데이터가 없습니다.');
        return { highTide1: null, highTide2: null, lowTide1: null, lowTide2: null, error: 'No data' };
    }

    // 1단계: 데이터 파싱
    const points = tideBedData.map(item => ({
        time: item.slctdDt || item.obsrvnDt,
        height: parseFloat(item.slctdHgt != null ? item.slctdHgt : item.obsrvnHgt)
    })).filter(p => !isNaN(p.height) && p.time);

    // 시간순 정렬
    points.sort((a, b) => new Date(a.time.replace(/-/g, '/')) - new Date(b.time.replace(/-/g, '/')));

    if (points.length < 60) {
        console.error(`[PeakFinder] 데이터 부족: ${points.length}개`);
        return { highTide1: null, highTide2: null, lowTide1: null, lowTide2: null, error: 'Insufficient data' };
    }

    // 2단계: 모든 로컬 극값(피크) 탐색
    let allPeaks = [];
    let lastDirection = 0;
    let flatStartIdx = -1;

    for (let i = 1; i < points.length; i++) {
        const diff = points[i].height - points[i - 1].height;

        if (diff > 0) { // 상승
            if (lastDirection === -1) {
                const startIdx = flatStartIdx >= 0 ? flatStartIdx : i - 1;
                const endIdx = i - 1;
                allPeaks.push({
                    type: 'low',
                    startTime: points[startIdx].time,
                    endTime: points[endIdx].time,
                    midpointTimeFull: points[Math.round((startIdx + endIdx) / 2)].time,
                    midpointTime: getMidpointTime(points[startIdx].time, points[endIdx].time),
                    height: points[endIdx].height
                });
            }
            lastDirection = 1;
            flatStartIdx = -1;
        } else if (diff < 0) { // 하강
            if (lastDirection === 1) {
                const startIdx = flatStartIdx >= 0 ? flatStartIdx : i - 1;
                const endIdx = i - 1;
                allPeaks.push({
                    type: 'high',
                    startTime: points[startIdx].time,
                    endTime: points[endIdx].time,
                    midpointTimeFull: points[Math.round((startIdx + endIdx) / 2)].time,
                    midpointTime: getMidpointTime(points[startIdx].time, points[endIdx].time),
                    height: points[endIdx].height
                });
            }
            lastDirection = -1;
            flatStartIdx = -1;
        } else { // 수위 동일 (Plateau)
            if (flatStartIdx < 0) flatStartIdx = i - 1;
        }
    }

    // 3단계: 대상 날짜 필터링 (개선: 정점의 중앙 시간 기준 엄격 분류)
    if (targetDateStr) {
        allPeaks = allPeaks.filter(p => {
            // 정점의 한가운데(Midpoint)가 해당 날짜에 들어올 때만 소속 인정
            const midTime = p.midpointTimeFull || p.startTime;
            return midTime.startsWith(targetDateStr);
        });
    }
    // 4단계: 유의미한 피크 선별 (시간순 중시)
    const filterPeaks = (peaks) => {
        if (peaks.length <= 1) return peaks;
        peaks.sort((a, b) => new Date(a.startTime.replace(/-/g, '/')) - new Date(b.startTime.replace(/-/g, '/')));

        const filtered = [peaks[0]];
        for (let i = 1; i < peaks.length; i++) {
            const prev = filtered[filtered.length - 1];
            const curr = peaks[i];
            const diffMin = (new Date(curr.startTime.replace(/-/g, '/')) - new Date(prev.startTime.replace(/-/g, '/'))) / 60000;

            if (diffMin > 180) {
                filtered.push(curr);
            } else if (curr.height > prev.height && curr.type === 'high') {
                filtered[filtered.length - 1] = curr;
            } else if (curr.height < prev.height && curr.type === 'low') {
                filtered[filtered.length - 1] = curr;
            }
        }
        return filtered;
    };

    const finalHighs = filterPeaks(allPeaks.filter(p => p.type === 'high'));
    const finalLows = filterPeaks(allPeaks.filter(p => p.type === 'low'));

    // 결과 구성
    return {
        highTide1: finalHighs[0] ? { time: finalHighs[0].midpointTime, height: finalHighs[0].height } : null,
        highTide2: finalHighs[1] ? { time: finalHighs[1].midpointTime, height: finalHighs[1].height } : null,
        highTide3: finalHighs[2] ? { time: finalHighs[2].midpointTime, height: finalHighs[2].height } : null,
        lowTide1: finalLows[0] ? { time: finalLows[0].midpointTime, height: finalLows[0].height } : null,
        lowTide2: finalLows[1] ? { time: finalLows[1].midpointTime, height: finalLows[1].height } : null,
        lowTide3: finalLows[2] ? { time: finalLows[2].midpointTime, height: finalLows[2].height } : null,
        peakCount: { high: finalHighs.length, low: finalLows.length }
    };
}

module.exports = { findTidePeaks };
