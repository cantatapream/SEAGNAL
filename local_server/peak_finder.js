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

    // 결과 구성 — H/L 각 최대 4개 (12h padding 확대로 자정 ±12h 피크까지 노출 가능)
    return {
        highTide1: finalHighs[0] ? { time: finalHighs[0].midpointTime, height: finalHighs[0].height } : null,
        highTide2: finalHighs[1] ? { time: finalHighs[1].midpointTime, height: finalHighs[1].height } : null,
        highTide3: finalHighs[2] ? { time: finalHighs[2].midpointTime, height: finalHighs[2].height } : null,
        highTide4: finalHighs[3] ? { time: finalHighs[3].midpointTime, height: finalHighs[3].height } : null,
        lowTide1: finalLows[0] ? { time: finalLows[0].midpointTime, height: finalLows[0].height } : null,
        lowTide2: finalLows[1] ? { time: finalLows[1].midpointTime, height: finalLows[1].height } : null,
        lowTide3: finalLows[2] ? { time: finalLows[2].midpointTime, height: finalLows[2].height } : null,
        lowTide4: finalLows[3] ? { time: finalLows[3].midpointTime, height: finalLows[3].height } : null,
        peakCount: { high: finalHighs.length, low: finalLows.length }
    };
}

// ===========================
// 표본 곡선용 — findTidePeaks 와 같은 규칙을 {m, cm} 표본에 적용 (2026-10-18)
// ===========================
/** 같은 종류(고조끼리·저조끼리) 극값을 하나로 합치는 간격(분) — findTidePeaks 4단계의 180 과 같은 값. */
const SAME_TYPE_MERGE_MIN = 180;
/** 이보다 작게 오르내린 고조↔저조 짝은 "물때"가 아니라 흔들림으로 보고 지운다(cm).
 *  [근거 — 운영 공개 API 표본 161개(서해·남해·제주 62곳 × 오늘~모레, 2026-10-18 실측)]
 *    평탄 구간을 하나로 친 뒤 이웃 극값끼리의 높이 차이를 세면 **진짜 물때는 전부 20cm 이상(356쌍),
 *    흔들림은 전부 1cm 미만(19쌍)** 으로 갈렸다. 흔들림은 여러 기준점의 1cm 계단을 거리 가중으로
 *    섞을 때 한 곳이 먼저 한 칸 내려가고 다른 곳이 나중에 한 칸 올라가 생긴다(바텀시트는 한 지점
 *    값만 쓰므로 생기지 않는다). 3cm 는 두 무리 사이 — 흔들림보다 3배 크고 가장 작은 실제 물때의 1/6. */
const MIN_SWING_CM = 3;

/**
 * 일정 간격 조위 표본에서 고조·저조를 찾는다 — 바텀시트(findTidePeaks)와 같은 규칙.
 *   ① 오르다 내리면 고조, 내리다 오르면 저조. **같은 값이 이어지는 평탄 구간은 하나로** 보고
 *      그 가운데 시각을 극값 시각으로 한다(1cm 계단마다 고조·저조를 번갈아 만들지 않게).
 *   ② (추가) 높이 차이가 MIN_SWING_CM 보다 작은 고조↔저조 짝은 흔들림으로 지운다 — 가장 작은 짝부터.
 *   ③ 극값의 평탄 구간 가운데가 [dayStart, dayEnd) 안에 들 때만 그날 것으로 친다(앞뒤 날 표본을
 *      이어 붙여 넘기면 자정 근처 극값도 놓치지 않는다 — 바텀시트의 12시간 패딩과 같은 뜻).
 *   ④ 같은 종류가 SAME_TYPE_MERGE_MIN 분 이내로 붙으면 더 극단값만 남긴다(findTidePeaks 4단계).
 *   ⑤ (추가) 그 뒤에도 같은 종류가 이웃하면 더 극단값 하나만(고조·저조가 번갈게).
 * 예: 10분 간격 하루치(조금 날 계단 곡선) → [{m:155,cm:228,type:'high'},{m:560,cm:127,type:'low'},…] (4개 안팎)
 * @param {Array<{m:number,cm:number}>} samples - m=분(그날 0시 기준, 앞날은 음수·다음날은 1440 이상 가능), 오름차순, 결측 없음
 * @param {{dayStart?:number, dayEnd?:number}} [opts] - 그날 범위(기본 0~1440)
 * @returns {Array<{m:number,cm:number,type:'high'|'low'}>} 시각순 극값(m 은 정수 분)
 * [연계] ← services/hazard_rocks_submersion.js getTideCurve(간출암 조석 상자의 고조·저조 목록)
 *        ← services/hazard_rocks_prev_peaks.js extremaOfCurve(어제 극값 요약 — 그날 첫 물때 ▲/▼)
 *   두 곳이 같은 규칙을 쓰게 하려고 여기 하나로 둔다. 바텀시트 findTidePeaks 는 TideBED 원자료
 *   (문자열 시각·4개 상한)를 받으므로 그대로 두고, 같은 규칙을 표본용으로 옮긴 것이다.
 */
function findPeaksInSamples(samples, opts) {
    const dayStart = opts && opts.dayStart != null ? opts.dayStart : 0;
    const dayEnd = opts && opts.dayEnd != null ? opts.dayEnd : 1440;
    const pts = (samples || []).filter(p => p && p.cm != null && !isNaN(p.cm));
    if (pts.length < 3) return [];

    // ① 평탄 구간을 하나로 보는 극값 탐색(findTidePeaks 2단계와 같은 흐름)
    let raw = [];
    let lastDir = 0, flatStart = -1;
    for (let i = 1; i < pts.length; i++) {
        const diff = pts[i].cm - pts[i - 1].cm;
        if (diff === 0) { if (flatStart < 0) flatStart = i - 1; continue; }
        const dir = diff > 0 ? 1 : -1;
        if (lastDir !== 0 && dir !== lastDir) {
            const s = flatStart >= 0 ? flatStart : i - 1, e = i - 1;
            // 가운데 시각은 내림 — findTidePeaks(getMidpointTime: 두 시각 평균의 '분'만 취함)와 같은 값
            raw.push({ type: lastDir === 1 ? 'high' : 'low', start: pts[s].m, m: Math.floor((pts[s].m + pts[e].m) / 2), cm: pts[e].cm });
        }
        lastDir = dir; flatStart = -1;
    }

    // ② 흔들림 짝 지우기 — 이웃한 고조↔저조 차이가 가장 작은 짝부터, MIN_SWING_CM 이상만 남을 때까지
    while (raw.length >= 2) {
        let bi = -1, best = Infinity;
        for (let i = 0; i + 1 < raw.length; i++) {
            const sw = Math.abs(raw[i + 1].cm - raw[i].cm);
            if (sw < best) { best = sw; bi = i; }
        }
        if (best >= MIN_SWING_CM) break;
        raw.splice(bi, 2);
    }

    // ③ 그날 것만
    raw = raw.filter(p => p.m >= dayStart && p.m < dayEnd);

    // ④ 같은 종류 180분 합침(findTidePeaks filterPeaks — 간격은 평탄 구간 시작 기준)
    const mergeSameType = (list) => {
        const out = [];
        for (const p of list) {
            const prev = out[out.length - 1];
            if (!prev || p.start - prev.start > SAME_TYPE_MERGE_MIN) out.push(p);
            else if ((p.type === 'high' && p.cm > prev.cm) || (p.type === 'low' && p.cm < prev.cm)) out[out.length - 1] = p;
        }
        return out;
    };
    const merged = mergeSameType(raw.filter(p => p.type === 'high')).concat(mergeSameType(raw.filter(p => p.type === 'low')))
        .sort((a, b) => a.m - b.m);
    // ⑤ (추가) ④ 뒤에 같은 종류가 이웃하면(예: 고조 하나가 옆 고조에 합쳐져 저조 둘이 붙음) 더 극단값 하나만 —
    //   목록은 고조·저조가 번갈아야 화면의 "직전 물때 대비 ▲/▼"가 뜻을 가진다. 한 지점 곡선이면 일어나지 않는다.
    const out = [];
    for (const p of merged) {
        const prev = out[out.length - 1];
        if (prev && prev.type === p.type) { if ((p.type === 'high' && p.cm > prev.cm) || (p.type === 'low' && p.cm < prev.cm)) out[out.length - 1] = p; }
        else out.push(p);
    }
    return out.map(p => ({ m: p.m, cm: p.cm, type: p.type }));
}

module.exports = { findTidePeaks, findPeaksInSamples, MIN_SWING_CM, SAME_TYPE_MERGE_MIN };
