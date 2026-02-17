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
    const url = `${CONFIG.DETAIL_URL}?stn=108&kind=${kind}&date=${dateParam}&reportId=${encodeURIComponent(reportId)}`;

    const html = await fetchHtml(url);
    const contentMatch = html.match(/<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/section>/);
    if (!contentMatch) return "";

    return contentMatch[1]
        .replace(/<p[^>]*>/g, '\n').replace(/<\/p>/g, '\n').replace(/<br\s*\/?>/g, '\n')
        .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ ]+/g, ' ').trim();
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
            const isDup = value.history.some(h => h.reportId === event.reportId && h.command === event.command && h.time === event.time);
            if (!isDup) {
                value.history.unshift({
                    reportId: event.reportId, time: event.tmFc || new Date().toLocaleString('ko-KR'),
                    tmEf: event.time, type: event.type, command: event.command, processedAt: new Date().toISOString()
                });
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
                    pageReports.push({ id, title });
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

            // 분석된 각 이벤트를 시스템에 적용
            for (const event of events) {
                // reportId 및 발표시각(tmFc) 추가
                event.reportId = report.id;
                event.tmFc = extractTmFcFromId(report.id);

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
