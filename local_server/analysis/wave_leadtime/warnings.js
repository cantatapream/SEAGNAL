/**
 * ============================================================================
 * warnings.js — 특보 CSV(방재기상플랫폼 발효현황 export) 파서
 * ============================================================================
 *
 * CSV 컬럼: 발표시간, 지역, 발효시각, 해당지역, 내용
 *   - 발표시간 : 통보문이 발표(announce)된 시각          예) 2023-06-01 04:00
 *   - 지역     : 발표 관서(청) 또는 '전국'                예) 제주도 / 부산·울산·경상남도
 *   - 발효시각 : "(n) <종류><등급> <행위> : <발효 일시>" 들이 ' / ' 로 연결
 *               예) (1) 풍랑주의보 발표 : 2023년 06월 01일 07시 00분
 *   - 해당지역 : "(n) ... : <해역명들>" — 발효시각의 (n) 과 1:1 대응
 *   - 내용     : 해제 예고 등 부가
 *
 * 한 행이 여러 (n) 항목을 가질 수 있어 항목 단위로 평탄화한다.
 * 이 분석은 '풍랑' 특보의 '발표/변경(격상)' 이벤트만 사용한다.
 *
 * [반환 이벤트]
 *   {
 *     officeRegion : '제주도',               // CSV 지역(청). '전국' 행은 기본 제외
 *     kind         : '풍랑',
 *     level        : '주의보' | '경보',
 *     action       : '발표' | '변경' | '해제' | '연장',
 *     announceAt   : Date,                    // 발표시간(col1) — 기상청이 알린 시각
 *     effectiveAt  : Date,                    // 발효 일시(col3 파싱)
 *     seaAreas     : ['제주도남동쪽안쪽먼바다', ...],
 *   }
 * ============================================================================
 */
'use strict';

const fs = require('fs');

const OFFICE_REGIONS = new Set([
    '제주도', '부산·울산·경상남도', '광주·전라남도', '대구·경상북도',
    '강원특별자치도', '대전·세종·충청남도', '전북특별자치도', '서울·인천·경기도', '충청북도',
]);

// "2023-06-01 04:00" (KST) → Date. 컨테이너 TZ=Asia/Seoul 전제.
function parseAnnounce(s) {
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}
// "2023년 06월 01일 07시 00분" (KST) → Date
function parseEffective(s) {
    const m = s.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}

// CSV 라인을 5개 필드로 분해. 필드 내부에 콤마가 없는 구조(검증됨)라 단순 분할 가능하나,
// 안전하게 앞 2개 콤마와 뒤 1개 콤마로 5분할(따옴표 비사용 CSV).
function splitRow(line) {
    const first = line.indexOf(',');
    const second = line.indexOf(',', first + 1);
    const last = line.lastIndexOf(',');
    // 발효시각/해당지역 사이 경계는 명확치 않으므로, 구조 규칙 활용:
    // col3(발효시각) 와 col4(해당지역) 모두 '(n) ... : ...' 패턴. 마지막 콤마 앞이 col4의 끝/col5 시작.
    // 실측상 정확 분할을 위해 col3,col4 경계를 ') :' 다음의 ', (1)' 로 잡기 어렵다.
    // → 단순화: 필드 5개로 보고 col1,col2 는 콤마분할, 나머지는 휴리스틱.
    if (first < 0 || second < 0) return null;
    const c1 = line.slice(0, first);
    const c2 = line.slice(first + 1, second);
    const rest = line.slice(second + 1);
    // rest = col3,col4,col5. col5(내용)는 비거나 '... 해제 예고 ...'. 마지막 콤마로 col5 분리.
    const restLast = rest.lastIndexOf(',');
    const c5 = restLast >= 0 ? rest.slice(restLast + 1) : '';
    const mid = restLast >= 0 ? rest.slice(0, restLast) : rest;
    // mid = col3,col4. col4(해당지역)는 첫 '(1)' 이 col3 시작, 그 다음 '(1)' 이 col4 시작.
    // col3 과 col4 의 경계 콤마를 찾는다: col3 는 ': <일시>' 로 끝남(분 단위). 그 직후 콤마.
    const sep = mid.search(/분,/);
    let c3, c4;
    if (sep >= 0) { c3 = mid.slice(0, sep + 1); c4 = mid.slice(sep + 2); }
    else {
        const midLast = mid.indexOf(',');
        c3 = midLast >= 0 ? mid.slice(0, midLast) : mid;
        c4 = midLast >= 0 ? mid.slice(midLast + 1) : '';
    }
    return [c1, c2, c3, c4, c5];
}

// "(1) 풍랑주의보 발표 : 2023년 ...  / (2) 강풍주의보 발표 : ..." → 항목 배열
function splitItems(text) {
    // ' / (n)' 경계로 분리. 첫 항목은 '(1)' 로 시작.
    return text.split(/\s*\/\s*(?=\(\d+\))/).map((s) => s.trim()).filter(Boolean);
}

function parseEffItem(item) {
    // "(1) 풍랑주의보 발표 : 2023년 06월 01일 07시 00분"
    const m = item.match(/^\((\d+)\)\s*(\S+?)(주의보|경보)\s*(발표|변경|해제|연장|대치)\s*:\s*(.+)$/);
    if (!m) return null;
    return { idx: +m[1], kind: m[2], level: m[3], action: m[4], effectiveAt: parseEffective(m[5]) };
}
function parseAreaItem(item) {
    // "(1) 풍랑주의보 발표 : 서해남부남쪽안쪽먼바다. 서해남부남쪽바깥먼바다"
    const m = item.match(/^\((\d+)\)\s*.*?:\s*(.+)$/);
    if (!m) return null;
    const areas = m[2].split(/[.\s]*[.]\s*|\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    return { idx: +m[1], areas };
}

/**
 * @param {string} csvPath UTF-8 CSV
 * @param {object} [opt] { kinds:Set('풍랑'), actions:Set('발표','변경'), includeNational:false }
 * @returns {Array} 평탄화된 이벤트
 */
function parseWarnings(csvPath, opt = {}) {
    const kinds = opt.kinds || new Set(['풍랑']);
    const actions = opt.actions || new Set(['발표', '변경']);
    const includeNational = !!opt.includeNational;

    const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
    const events = [];
    for (let li = 1; li < lines.length; li++) {
        const line = lines[li];
        if (!line.trim()) continue;
        const cols = splitRow(line);
        if (!cols) continue;
        const [announceStr, region, effCol, areaCol] = cols;
        if (!includeNational && region === '전국') continue;
        if (!OFFICE_REGIONS.has(region)) continue;
        const announceAt = parseAnnounce(announceStr);

        const effItems = splitItems(effCol).map(parseEffItem).filter(Boolean);
        const areaItems = splitItems(areaCol).map(parseAreaItem).filter(Boolean);
        const areaByIdx = new Map(areaItems.map((a) => [a.idx, a.areas]));

        for (const it of effItems) {
            if (!kinds.has(it.kind)) continue;
            if (!actions.has(it.action)) continue;
            if (!it.effectiveAt) continue;
            events.push({
                officeRegion: region,
                kind: it.kind,
                level: it.level,
                action: it.action,
                announceAt,
                effectiveAt: it.effectiveAt,
                seaAreas: areaByIdx.get(it.idx) || [],
            });
        }
    }
    return events;
}

module.exports = { parseWarnings, OFFICE_REGIONS };
