const https = require('https');
const fs = require('fs');
const path = require('path');
const aiParser = require('./ai_report_parser');

const CONFIG = {
    LIST_URL: 'https://www.weather.go.kr/w/special-report/list.do',
    DETAIL_URL: 'https://www.weather.go.kr/w/special-report/list.do',
    TARGET_TYPES: []
};

const ZONE_GROUP_MAP = {
    "동해남부앞바다": ["울산앞바다", "경북남부앞바다", "경북북부앞바다"],
    "동해남부먼바다": ["동해남부남쪽안쪽먼바다", "동해남부남쪽바깥먼바다", "동해남부북쪽안쪽먼바다", "동해남부북쪽바깥먼바다"],
    "동해중부앞바다": ["강원북부앞바다", "강원중부앞바다", "강원남부앞바다"],
    "동해중부먼바다": ["동해중부안쪽먼바다", "동해중부바깥먼바다"],
    "서해남부앞바다": ["전북북부앞바다", "전북남부앞바다", "전남북부서해앞바다", "전남중부서해앞바다", "전남남부서해앞바다"],
    "서해남부먼바다": ["서해남부북쪽안쪽먼바다", "서해남부북쪽바깥먼바다", "서해남부남쪽안쪽먼바다", "서해남부남쪽바깥먼바다"],
    "서해중부앞바다": ["인천·경기북부앞바다", "인천·경기남부앞바다", "충남북부앞바다", "충남남부앞바다"],
    "서해중부먼바다": ["서해중부안쪽먼바다", "서해중부바깥먼바다"],
    "남해동부앞바다": ["부산앞바다", "경남서부남해앞바다", "경남중부남해앞바다", "거제시동부앞바다"],
    "남해동부먼바다": ["남해동부안쪽먼바다", "남해동부바깥먼바다"],
    "남해서부앞바다": ["전남서부남해앞바다", "전남동부남해앞바다"],
    "남해서부먼바다": ["남해서부서쪽먼바다", "남해서부동쪽먼바다"],
    "제주도앞바다": ["제주도북부앞바다", "제주도동부앞바다", "제주도남부앞바다", "제주도서부앞바다"],
    "제주도먼바다": ["제주도남쪽바깥먼바다", "제주도남동쪽안쪽먼바다", "제주도남서쪽안쪽먼바다"]
};

async function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }).on('error', reject);
    });
}

async function fetchReportDetail(reportId) {
    const parts = reportId.split(':');
    const kind = parts[0] || '';
    const dateStr = parts[1] || '';
    const dateParam = dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6) + '-' + dateStr.substring(6, 8);
    // [Fix] prevStn=108 추가 — KMA 서버는 prevStn이 stn과 일치해야만 reportId를 인식함
    // prevStn 없이 요청하면 항상 최신 통보문 내용만 반환하는 버그가 있었음
    const url = `${CONFIG.DETAIL_URL}?prevStn=108&stn=108&kind=${kind}&date=${dateParam}&reportId=${reportId}`;

    const html = await fetchHtml(url);

    // [Fix] 여러 정규식 패턴을 순차적으로 시도하여 HTML 구조 변경에 대응
    let contentHtml = '';
    const patterns = [
        /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/section>/,  // 원본 패턴
        /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/div>/,      // </section> 대신 </div>
        /<div class="cmp-view-content">([\s\S]*)<\/div>/,                  // 마지막 </div>까지 (greedy)
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1] && match[1].trim().length > 20) {
            contentHtml = match[1];
            break;
        }
    }
    if (!contentHtml) return "";

    let text = contentHtml
        .replace(/<p[^>]*>/g, '\n').replace(/<\/p>/g, '\n').replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ ]+/g, ' ').trim();

    // [핵심 수정] "참고사항" 섹션 제거 — AI가 중복 이벤트를 생성하는 주요 원인
    // 참고사항에는 "현재 발효 중인 전체 특보 현황"이 나열되어 있어,
    // AI가 이를 새로운 이벤트로 오해하여 이미 발효 중인 해역까지 중복 처리함
    const refIdx = text.indexOf('참고사항');
    if (refIdx !== -1) {
        text = text.substring(0, refIdx).trim();
    }

    return text;
}

// [AI 대체] resolveZones, parseEvents 함수는 이제 ai_report_parser에서 처리하므로 삭제함

/**
 * 기상청 시간 문자열 파싱 (KST 기준 Date 객체 반환)
 */
function parseKmaTime(timeStr) {
    if (!timeStr || timeStr === "시각미정") return null;
    const match = timeStr.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분/);
    if (!match) return null;
    const [_, y, m, d, h, min] = match;
    return new Date(`${y}-${m}-${d}T${h}:${min}:00+09:00`);
}

function updateZoneStatus(obj, targetZone, event) {
    if (!obj || typeof obj !== 'object') return false;
    for (const [key, value] of Object.entries(obj)) {
        if (key === targetZone && value && 'current' in value) {
            if (!value.history) value.history = [];
            // [Fix] 중복 검사: h.time은 tmFc(발표시각)로 저장되므로 event.tmFc와 비교해야 함
            // 기존에는 h.time === event.time (tmEf) 비교로 인해 중복 검사가 항상 실패하는 버그가 있었음
            const isDup = value.history.some(h =>
                h.reportId === event.reportId && h.command === event.command
            );
            if (!isDup) {
                value.history.unshift({
                    reportId: event.reportId, time: event.tmFc || new Date().toLocaleString('ko-KR'),
                    tmEf: event.time, type: event.type, command: event.command, processedAt: new Date().toISOString()
                });
                // [Fix] history 무한 증가 방지 (최근 20건만 유지)
                if (value.history.length > 20) value.history = value.history.slice(0, 20);
            }

            const effTime = parseKmaTime(event.time);
            const now = new Date();

            if (event.command === '해제') {
                if (effTime && effTime > now) {
                    if (value.current) { value.current.tmRelease = event.time; value.current.tmYn = event.time; }
                } else {
                    value.current = null; value.upcoming = null; value.history = [];
                }
            } else if (event.command === '예비') {
                const cleanType = event.type.replace('예비특보', '').replace('주의보', '').replace('경보', '').trim();
                const prevUp = value.upcoming || {};
                const inheritedTmFc = (prevUp.wrnTp === cleanType && prevUp.wrnLvl === '예비') ? (prevUp.tmFc || event.tmFc || '') : (event.tmFc || '');
                value.upcoming = { ...prevUp, wrnTp: cleanType, wrnLvl: '예비', tmEf: event.time, tmFc: inheritedTmFc };
            } else {
                const isJuui = event.type.includes('주의보');
                const cleanType = event.type.replace('주의보', '').replace('경보', '').trim();
                const level = isJuui ? '주의보' : '경보';
                const prevUp = value.upcoming || {};
                const prevCurr = value.current || {};

                let isContinued = false;
                const oldType = prevCurr.wrnTp || prevUp.wrnTp;
                const oldLvl = prevCurr.wrnLvl || prevUp.wrnLvl;
                if (oldType === cleanType) {
                    if (oldLvl === level || (oldLvl === '예비' && level === '주의보')) isContinued = true;
                }

                const inheritedTmFc = isContinued ? (prevCurr.tmFc || prevUp.tmFc || event.tmFc || '') : (event.tmFc || '');
                const inheritedTmYn = event.tmYn || prevCurr.tmYn || prevUp.tmYn || '';

                if (effTime && effTime > now) {
                    value.upcoming = { ...prevUp, wrnTp: cleanType, wrnLvl: level, tmFc: inheritedTmFc, tmEf: event.time, tmYn: inheritedTmYn };
                } else {
                    value.current = { ...prevCurr, wrnTp: cleanType, wrnLvl: level, tmFc: inheritedTmFc, tmEf: event.time || prevCurr.tmEf || '', tmYn: inheritedTmYn };
                    value.upcoming = null;
                }
            }
            return true;
        }
        if (updateZoneStatus(value, targetZone, event)) return true;
    }
    return false;
}

async function applyNewReports(fullForm) {
    console.log(`[ReportProcessor] 체크 중... (LastId: ${fullForm.lastReportId})`);
    try {
        const allNewReports = [];
        const seenReportIds = new Set(); // [Fix] 페이지간 중복 방지 (select-list가 모든 페이지에서 동일)
        let foundLast = false;
        for (let page = 1; page <= 5; page++) {
            const html = await fetchHtml(`${CONFIG.LIST_URL}?pageIndex=${page}`);
            const selectListMatch = html.match(/<select id="select-list"[^>]*>([\s\S]*?)<\/select>/);
            if (!selectListMatch) {
                console.log(`[ReportProcessor] ${page}페이지에서 select-list를 찾지 못했습니다.`);
                break;
            }
            const pattern = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
            const pageReports = [];
            let match;
            while ((match = pattern.exec(selectListMatch[1])) !== null) {
                const id = match[1];
                const title = match[2].trim();
                // [필터링] 제목에 [특보] 또는 [예비]가 포함된 통보문만 수집
                if (id.includes(':') && (title.includes('[특보]') || title.includes('[예비]'))) {
                    if (!seenReportIds.has(id)) {
                        seenReportIds.add(id);
                        pageReports.push({ id, title });
                    }
                }
            }
            console.log(`[ReportProcessor] ${page}페이지에서 ${pageReports.length}건의 통보문 발견.`);

            for (const r of pageReports) {
                if (r.id === fullForm.lastReportId) { foundLast = true; break; }
                allNewReports.push(r);
            }
            if (foundLast || pageReports.length === 0) break;
        }

        if (allNewReports.length === 0) {
            console.log('[ReportProcessor] 처리할 새로운 통보문이 없습니다.');
            return false;
        }

        allNewReports.reverse();
        console.log(`[ReportProcessor] 총 ${allNewReports.length}건의 신규 통보문 처리 시작.`);
        let changed = false;
        const RELEVANT_KEYWORDS = ['풍랑', '태풍', '지진해일', '폭풍해일'];

        for (const report of allNewReports) {
            console.log(`[ReportProcessor] 통보문 확인 중: ${report.title}`);
            const text = await fetchReportDetail(report.id);

            // [필터링] 내용에 해상 관련 키워드가 포함된 경우에만 AI 분석 수행
            const hasRelevantKeyword = RELEVANT_KEYWORDS.some(kw => text.includes(kw));
            if (!hasRelevantKeyword) {
                console.log(`[ReportProcessor] 해상 특보 키워드 미포함, 건너뜀: ${report.title}`);
                fullForm.lastReportId = report.id;
                continue;
            }

            console.log(`[ReportProcessor] AI 분석 시작: ${report.title}`);
            // AI를 사용하여 통보문 분석
            const aiParsed = await aiParser.parseNoticeWithAI(text);
            const events = aiParsed.data || [];
            if (aiParsed.error) {
                console.error(`[ReportProcessor] AI 분석 오류: ${aiParsed.error}`);
            }

            // [Fix] AI 결과 중복 제거: 동일 type+command+zones 조합의 이벤트 병합
            const deduplicatedEvents = [];
            const seenEventKeys = new Set();
            for (const event of events) {
                // zones를 정렬하여 순서 무관하게 비교
                const sortedZones = [...(event.zones || [])].sort().join(',');
                const eventKey = `${event.type}|${event.command}|${sortedZones}`;
                if (!seenEventKeys.has(eventKey)) {
                    seenEventKeys.add(eventKey);
                    deduplicatedEvents.push(event);
                } else {
                    console.log(`[ReportProcessor] 중복 이벤트 제거: ${event.type} ${event.command}`);
                }
            }

            // 분석된 각 이벤트를 시스템에 적용
            for (const event of deduplicatedEvents) {
                // reportId 및 발표시각(tmFc) 추가
                event.reportId = report.id;
                event.tmFc = extractTmFcFromId(report.id);

                // [Fix] zones 내 중복 제거
                event.zones = [...new Set(event.zones || [])];

                console.log(`[AI Event] ${event.type} ${event.command} (${event.time}) - 구역: ${event.zones.length}개`);

                event.zones.forEach(zoneName => {
                    if (updateZoneStatus(fullForm.current, zoneName, event)) {
                        changed = true;
                    }
                });
            }
            fullForm.lastReportId = report.id;
        }
        return changed;
    } catch (e) {
        console.error(`[ReportProcessor] 오류: ${e.message}`);
        return false;
    }
}

/**
 * reportId에서 기상청 발표시각 형식 추출
 * @param {string} reportId (ex: "1:202408301000")
 */
function extractTmFcFromId(reportId) {
    const parts = reportId.split(':');
    if (parts.length >= 2) {
        const ts = parts[1];
        if (ts.length >= 12) {
            return `${ts.substring(0, 4)}년 ${ts.substring(4, 6)}월 ${ts.substring(6, 8)}일 ${ts.substring(8, 10)}시 ${ts.substring(10, 12)}분`;
        }
    }
    return '';
}

module.exports = {
    applyNewReports,
    fetchReportDetail,
    updateZoneStatus,
    ZONE_GROUP_MAP
};
