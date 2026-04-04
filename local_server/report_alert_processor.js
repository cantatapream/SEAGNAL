const https = require('https');
const fs = require('fs');
const path = require('path');
const aiParser = require('./ai_report_parser');

const COLLECT_CACHE_DIR = path.join(__dirname, 'data', 'collect_cache');
// [검토 필요 통보문] "내용 없음"이지만 참고사항에 해상 키워드가 포함된 통보문 저장
const REVIEW_NEEDED_FILE = path.join(__dirname, 'data', 'review_needed.json');

const CONFIG = {
    LIST_URL: 'https://www.weather.go.kr/w/special-report/list.do',
    DETAIL_URL: 'https://www.weather.go.kr/w/special-report/list.do',
    TARGET_TYPES: []
};

const ZONE_GROUP_MAP = {
    // 전해상: 해당 해역의 모든 하위 해역 (앞바다 + 먼바다 전체)
    "동해중부전해상": ["강원북부앞바다", "강원중부앞바다", "강원남부앞바다", "동해중부안쪽먼바다", "동해중부바깥먼바다"],
    "동해남부전해상": ["울산앞바다", "경북남부앞바다", "경북북부앞바다", "동해남부남쪽안쪽먼바다", "동해남부남쪽바깥먼바다", "동해남부북쪽안쪽먼바다", "동해남부북쪽바깥먼바다"],
    "서해중부전해상": ["인천·경기북부앞바다", "인천·경기남부앞바다", "충남북부앞바다", "충남남부앞바다", "서해중부안쪽먼바다", "서해중부바깥먼바다"],
    "서해남부전해상": ["전북북부앞바다", "전북남부앞바다", "전남북부서해앞바다", "전남중부서해앞바다", "전남남부서해앞바다", "서해남부북쪽안쪽먼바다", "서해남부북쪽바깥먼바다", "서해남부남쪽안쪽먼바다", "서해남부남쪽바깥먼바다"],
    "남해동부전해상": ["부산앞바다", "경남서부남해앞바다", "경남중부남해앞바다", "거제시동부앞바다", "남해동부안쪽먼바다", "남해동부바깥먼바다"],
    "남해서부전해상": ["전남서부남해앞바다", "전남동부남해앞바다", "남해서부서쪽먼바다", "남해서부동쪽먼바다"],
    "제주도전해상": ["제주도북부앞바다", "제주도동부앞바다", "제주도남부앞바다", "제주도서부앞바다", "제주도남쪽바깥먼바다", "제주도남동쪽안쪽먼바다", "제주도남서쪽안쪽먼바다"],
    // 앞바다/먼바다 그룹
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

// 통보문 상세 본문 가져오기
// options.keepReference = true이면 참고사항 섹션을 유지 (검토 필요 감지용)
// 기본값은 참고사항 제거 (기존 AI 분석에 영향 없도록)
async function fetchReportDetail(reportId, options) {
    const parts = reportId.split(':');
    const dateStr = parts[1] || '';
    const dateParam = dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6) + '-' + dateStr.substring(6, 8);
    // [Fix] kind 파라미터 제거 — KMA 서버는 kind가 포함되면 reportId를 무시하고
    // 해당 kind의 최신 통보문만 반환함. kind 없이 prevStn+reportId만 보내야 정상 동작.
    const url = `${CONFIG.DETAIL_URL}?prevStn=108&stn=108&date=${dateParam}&reportId=${reportId}`;

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
    // options.keepReference = true일 때만 참고사항을 유지 (검토 필요 감지용)
    if (!options || !options.keepReference) {
        const refIdx = text.indexOf('참고사항');
        if (refIdx !== -1) {
            text = text.substring(0, refIdx).trim();
        }
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

function updateZoneStatus(obj, targetZone, event, referenceTime) {
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
                    reportId: event.reportId, title: event.title || '',
                    time: event.tmFc || new Date().toLocaleString('ko-KR'),
                    tmEf: event.tmEf || event.time, tmCc: event.tmCc || '', type: event.type, command: event.command, processedAt: new Date().toISOString()
                });
                // [Fix] history 무한 증가 방지 (최근 20건만 유지)
                if (value.history.length > 20) value.history = value.history.slice(0, 20);
            }

            const effTime = parseKmaTime(event.time);
            const now = referenceTime ? new Date(referenceTime) : new Date();

            // tmEf 원본(범위형 포함)을 보존, time은 parseKmaTime 호환용 시작시각
            const tmEfOriginal = event.tmEf || event.time;
            const tmCc = event.tmCc || '';

            if (event.command === '해제') {
                if (effTime && effTime > now) {
                    if (value.current) { value.current.tmRelease = event.time; value.current.tmYn = event.time; value.current.tmCc = tmEfOriginal; }
                } else {
                    value.current = null; value.upcoming = null; value.history = [];
                }
            } else if (event.command === '예비') {
                const cleanType = event.type.replace('예비특보', '').replace('주의보', '').replace('경보', '').trim();
                const prevUp = value.upcoming || {};
                const prevCurr = value.current || {};
                const inheritedTmFc = (prevUp.wrnTp === cleanType && prevUp.wrnLvl === '예비') ? (prevUp.tmFc || event.tmFc || '') : (event.tmFc || '');
                // upcoming은 current와 독립된 건이므로, current의 해제예정시각(tmCc)을 상속하면 안됨
                const inheritedTmCc = tmCc || prevUp.tmCc || prevUp.tmYn || '';
                const tmCcExplicit = !!(tmCc); // AI가 통보문에서 직접 추출한 경우만 true
                value.upcoming = { ...prevUp, wrnTp: cleanType, wrnLvl: '예비', tmEf: tmEfOriginal, tmFc: inheritedTmFc, tmCc: inheritedTmCc, tmCcExplicit };
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
                if (effTime && effTime > now) {
                    // upcoming은 current와 독립된 건이므로, current의 해제예정시각(tmCc)을 상속하면 안됨
                    const inheritedTmCc = tmCc || event.tmYn || prevUp.tmCc || prevUp.tmYn || '';
                    const tmCcExplicit = !!(tmCc || event.tmYn); // AI가 통보문에서 직접 추출한 경우만 true
                    value.upcoming = { ...prevUp, wrnTp: cleanType, wrnLvl: level, tmFc: inheritedTmFc, tmEf: tmEfOriginal, tmCc: inheritedTmCc, tmCcExplicit };
                } else {
                    const inheritedTmCc = tmCc || event.tmYn || prevCurr.tmCc || prevCurr.tmYn || prevUp.tmCc || prevUp.tmYn || '';
                    value.current = { ...prevCurr, wrnTp: cleanType, wrnLvl: level, tmFc: inheritedTmFc, tmEf: tmEfOriginal || prevCurr.tmEf || '', tmCc: inheritedTmCc };
                    value.upcoming = null;
                }
            }
            return true;
        }
        if (updateZoneStatus(value, targetZone, event, referenceTime)) return true;
    }
    return false;
}

async function applyNewReports(fullForm) {
    console.log(`[ReportProcessor] 체크 중... (LastId: ${fullForm.lastReportId})`);
    try {
        const allNewReports = [];
        const seenReportIds = new Set(); // [Fix] 페이지간 중복 방지 (select-list가 모든 페이지에서 동일)

        // [누락 방지] processedIds 기반 수집 — 처리 완료된 통보문만 건너뜀
        // 기존 타임스탬프 비교 방식은 기상청이 통보문을 종류별로 그룹화하여 나열할 때
        // 시간순이 뒤바뀌면 특정 통보문이 영원히 수집되지 않는 누락 버그가 있었음.
        // 개선: processedReportIds에 없는 통보문은 무조건 수집 대상으로 처리.
        const processedIds = new Set(fullForm.processedReportIds || []);
        if (fullForm.lastReportId) processedIds.add(fullForm.lastReportId);

        // [보호] 너무 오래된 통보문 재수집 방지를 위한 기준 (30일)
        // processedReportIds가 정리되면서 오래된 ID가 삭제되었을 때,
        // 기상청 목록에 남아있는 오래된 통보문을 다시 수집하지 않도록 차단
        const now = new Date();
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

        let allProcessedOnPage = false; // 현재 페이지의 통보문이 전부 처리 완료인지
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
                // [필터링] 제목에 [특보] 또는 [예비]가 포함된 통보문만 수집 대상
                if (id.includes(':') && (title.includes('[특보]') || title.includes('[예비]'))) {
                    if (!seenReportIds.has(id)) {
                        seenReportIds.add(id);
                        pageReports.push({ id, title });
                    }
                }
            }
            console.log(`[ReportProcessor] ${page}페이지에서 ${pageReports.length}건의 통보문 발견.`);

            // [누락 방지] processedIds에 없으면 무조건 수집 대상 (타임스탬프 순서 무관)
            let newOnThisPage = 0;
            for (const r of pageReports) {
                // 이미 처리 완료된 통보문이면 건너뜀
                if (processedIds.has(r.id)) continue;

                // 통보문 ID에서 발표 시각 추출하여 30일 이내인지 확인
                // (processedReportIds에서 정리된 오래된 통보문이 재수집되는 것을 방지)
                const rTs = (r.id.split(':')[1] || '').substring(0, 12);
                if (rTs.length >= 12) {
                    const reportDate = new Date(`${rTs.substring(0,4)}-${rTs.substring(4,6)}-${rTs.substring(6,8)}T${rTs.substring(8,10)}:${rTs.substring(10,12)}:00+09:00`);
                    if (now - reportDate > THIRTY_DAYS_MS) {
                        continue; // 30일 이상 지난 통보문은 수집하지 않음
                    }
                }

                allNewReports.push(r);
                newOnThisPage++;
            }

            // 이 페이지에서 새 통보문이 없고, 통보문 자체도 있었다면 → 다음 페이지 탐색 불필요
            // (더 오래된 페이지에는 새 통보문이 있을 가능성이 매우 낮음)
            if (newOnThisPage === 0 && pageReports.length > 0) {
                allProcessedOnPage = true;
                break;
            }
            if (pageReports.length === 0) break;
        }

        if (allNewReports.length === 0) {
            console.log('[ReportProcessor] 처리할 새로운 통보문이 없습니다.');
            return false;
        }

        allNewReports.reverse();

        // [Fix] 보고서를 ID 내 타임스탬프 기준으로 시간순 정렬
        // KMA select-list는 보고서를 타입(met:/pwn:)별로 그룹화하여 나열하므로,
        // reverse()만으로는 정확한 시간순이 보장되지 않음.
        // 예: pwn:(예비) 보고서가 met:(특보) 보고서보다 뒤에 처리되면,
        //     해제 이후에 과거 예비가 재적용되어 tmCc가 유실되는 문제 발생.
        allNewReports.sort((a, b) => {
            const tsA = (a.id.split(':')[1] || '').substring(0, 12);
            const tsB = (b.id.split(':')[1] || '').substring(0, 12);
            return tsA.localeCompare(tsB);
        });

        console.log(`[ReportProcessor] 총 ${allNewReports.length}건의 신규 통보문 처리 시작.`);
        let changed = false;
        const RELEVANT_KEYWORDS = ['풍랑', '태풍', '지진해일', '폭풍해일'];

        for (const report of allNewReports) {
            console.log(`[ReportProcessor] 통보문 확인 중: ${report.title}`);
            const text = await fetchReportDetail(report.id);

            // [필터링] 내용에 해상 관련 키워드가 포함된 경우에만 AI 분석 수행
            const hasRelevantKeyword = RELEVANT_KEYWORDS.some(kw => text.includes(kw));
            if (!hasRelevantKeyword) {
                // [검토 필요 감지] "□ 내용: 없음"이지만 참고사항에 해상 키워드가 있는 경우
                // 이 경우는 자동 처리가 불가하므로 관리자에게 알려야 함
                // 예: "동해중부안쪽먼바다의 풍랑특보는 발표가능성이 낮아져 해제합니다" (참고사항에만 있음)
                const isContentEmpty = !text.trim() || text.trim() === '□ 내용' || text.includes('없음');
                if (isContentEmpty) {
                    // 참고사항 포함된 원본 텍스트를 별도로 가져옴 (기존 text는 참고사항이 잘린 상태)
                    const fullText = await fetchReportDetail(report.id, { keepReference: true });
                    // 참고사항 부분만 추출
                    const refIdx = fullText.indexOf('참고사항');
                    const referenceText = refIdx !== -1 ? fullText.substring(refIdx).trim() : '';
                    // 참고사항에 해상 특보 키워드가 포함되어 있는지 확인
                    const hasKeywordInRef = RELEVANT_KEYWORDS.some(kw => referenceText.includes(kw));

                    if (hasKeywordInRef) {
                        console.log(`[ReportProcessor] ⚠️ 검토 필요 통보문 감지: ${report.title}`);
                        console.log(`[ReportProcessor]   → 본문 "내용 없음", 참고사항에 해상 키워드 포함`);
                        // review_needed.json에 저장 (관리자 확인 대상)
                        try {
                            let reviews = [];
                            if (fs.existsSync(REVIEW_NEEDED_FILE)) {
                                reviews = JSON.parse(fs.readFileSync(REVIEW_NEEDED_FILE, 'utf8'));
                            }
                            // 같은 통보문 중복 저장 방지
                            if (!reviews.some(r => r.reportId === report.id)) {
                                reviews.push({
                                    reportId: report.id,
                                    title: report.title,
                                    referenceText: referenceText,
                                    detectedAt: new Date().toISOString(),
                                    acknowledged: false  // 관리자가 [확인완료]를 누르면 true로 변경
                                });
                                fs.writeFileSync(REVIEW_NEEDED_FILE, JSON.stringify(reviews, null, 2), 'utf8');
                                console.log(`[ReportProcessor] 검토 필요 통보문 저장 완료: ${report.id}`);

                                // [관리자 푸시] "내용 없음" 통보문 감지 시 관리자에게 푸시 발송
                                const { sendAdminPush } = require('./services/admin_push');
                                sendAdminPush(
                                    '🔍 검토 필요 통보문',
                                    `${report.title} - 본문 없음, 참고사항에 특보 키워드 포함`
                                ).catch(err => console.error('[ReportProcessor] 관리자 푸시 발송 오류:', err.message));
                            }
                        } catch (reviewErr) {
                            console.error('[ReportProcessor] 검토 필요 저장 오류:', reviewErr.message);
                        }
                    }
                }

                console.log(`[ReportProcessor] 해상 특보 키워드 미포함, 건너뜀: ${report.title}`);
                fullForm.lastReportId = report.id;
                // [누락 방지] 키워드 미포함 통보문도 processedReportIds에 추가
                // 추가하지 않으면, 매 사이클마다 같은 통보문의 본문을 반복 조회하게 됨
                if (!fullForm.processedReportIds) fullForm.processedReportIds = [];
                if (!fullForm.processedReportIds.includes(report.id)) {
                    fullForm.processedReportIds.push(report.id);
                }
                continue;
            }

            console.log(`[ReportProcessor] AI 분석 시작: ${report.title}`);
            // AI를 사용하여 통보문 분석 (번호별 항목 분리 포함)
            const baseDate = extractTmFcFromId(report.id);
            const aiParsed = await aiParser.parseNoticeWithAI(text, baseDate);
            const events = aiParsed.data || [];
            const separatedText = aiParsed.separatedText || null;
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

            // [Fix] 동일 통보문 내 같은 기상유형 이벤트 간 tmCc 전파
            // 예: 풍랑주의보(tmCc 있음)와 풍랑예비특보(tmCc 없음)가 동시 존재 시,
            // 해제예정은 해당 기상현상 전체에 적용되므로 tmCc가 없는 이벤트에 전파
            const tmCcByBaseType = {};
            for (const event of deduplicatedEvents) {
                const baseType = (event.type || '').replace('예비특보', '').replace('주의보', '').replace('경보', '').trim();
                if (event.tmCc && !tmCcByBaseType[baseType]) {
                    tmCcByBaseType[baseType] = event.tmCc;
                }
            }
            for (const event of deduplicatedEvents) {
                if (!event.tmCc) {
                    const baseType = (event.type || '').replace('예비특보', '').replace('주의보', '').replace('경보', '').trim();
                    if (tmCcByBaseType[baseType]) {
                        event.tmCc = tmCcByBaseType[baseType];
                        // tmYn도 동기화 (하위 호환)
                        if (!event.tmYn) event.tmYn = event.tmCc;
                        console.log(`[ReportProcessor] tmCc 전파: ${event.type} ← ${tmCcByBaseType[baseType]}`);
                    }
                }
            }

            // 분석된 각 이벤트를 시스템에 적용
            // [Fix] 같은 통보문 내 동일 type+command로 이미 처리된 구역은 덮어쓰지 않도록 추적
            const processedZonesInReport = {};
            for (const event of deduplicatedEvents) {
                // reportId 및 발표시각(tmFc), 통보문 제목(title) 추가
                event.reportId = report.id;
                event.tmFc = extractTmFcFromId(report.id);
                event.title = report.title || '';

                // [Fix] zones 내 중복 제거
                event.zones = [...new Set(event.zones || [])];

                const trackingKey = `${event.type}|${event.command}`;
                if (!processedZonesInReport[trackingKey]) {
                    processedZonesInReport[trackingKey] = new Set();
                }

                console.log(`[AI Event] ${event.type} ${event.command} (${event.time}) - 구역: ${event.zones.length}개`);

                event.zones.forEach(zoneName => {
                    // [Fix] 같은 통보문의 같은 type+command로 이미 처리된 구역은 건너뜀 (시간 덮어쓰기 방지)
                    if (processedZonesInReport[trackingKey].has(zoneName)) {
                        console.log(`[ReportProcessor] 구역 중복 건너뜀: ${zoneName} (${trackingKey}, 이전 이벤트에서 이미 처리됨)`);
                        return;
                    }
                    processedZonesInReport[trackingKey].add(zoneName);

                    if (updateZoneStatus(fullForm.current, zoneName, event)) {
                        changed = true;
                    }
                });
            }
            // [Fix] 통보문의 tmCc를 존 트리 전체에 전파
            // 통보문이 특정 해역의 주의보/경보에만 tmCc를 포함하고, 예비 해역에는 별도 이벤트가 없는 경우,
            // 같은 기상유형(예: 풍랑)의 예비/주의보/경보가 걸려있는 모든 해역에 tmCc를 적용
            if (Object.keys(tmCcByBaseType).length > 0) {
                const propagatedCount = propagateTmCcToZoneTree(fullForm.current, tmCcByBaseType);
                if (propagatedCount > 0) {
                    console.log(`[ReportProcessor] 존 트리 tmCc 전파: ${propagatedCount}건 업데이트`);
                    changed = true;
                }
            }

            // 수집 결과를 캐시에 저장 (관리자 테스트에서 재조회 시 AI 토큰 소모 방지)
            try {
                if (!fs.existsSync(COLLECT_CACHE_DIR)) fs.mkdirSync(COLLECT_CACHE_DIR, { recursive: true });
                const foundKeywords = RELEVANT_KEYWORDS.filter(kw => text.includes(kw));
                const cacheData = {
                    success: true, reportId: report.id, title: report.title,
                    rawText: text, separatedText, aiResult: deduplicatedEvents, foundKeywords,
                    applied: changed, aiError: aiParsed.error || null, pushResult: null
                };
                const cacheFileName = report.id.replace(/[/:]/g, '_') + '.json';
                fs.writeFileSync(path.join(COLLECT_CACHE_DIR, cacheFileName), JSON.stringify(cacheData, null, 2), 'utf8');
            } catch (cacheErr) {
                console.error('[ReportProcessor] 수집 캐시 저장 오류:', cacheErr.message);
            }

            fullForm.lastReportId = report.id;
            // [Fix] 처리 완료 ID 추적 (동시 발표 통보문 재수집 방지)
            if (!fullForm.processedReportIds) fullForm.processedReportIds = [];
            fullForm.processedReportIds.push(report.id);
        }
        // [processedReportIds 정리] 30일 이상 지난 ID는 삭제하여 무한 증가 방지
        // 기존에는 lastTs 기준으로 이전 ID를 모두 삭제했으나, 이 경우 동시각 통보문의
        // ID가 정리되어 다음 사이클에서 재수집될 수 있었음.
        // 30일 보관으로 변경하여 충분한 재수집 방어 기간을 확보하면서도 무한 증가를 방지.
        if (fullForm.processedReportIds) {
            const cleanupNow = new Date();
            const CLEANUP_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30일
            fullForm.processedReportIds = fullForm.processedReportIds.filter(id => {
                const ts = (id.split(':')[1] || '').substring(0, 12);
                if (ts.length >= 12) {
                    const idDate = new Date(`${ts.substring(0,4)}-${ts.substring(4,6)}-${ts.substring(6,8)}T${ts.substring(8,10)}:${ts.substring(10,12)}:00+09:00`);
                    return (cleanupNow - idDate) < CLEANUP_THRESHOLD_MS;
                }
                return true; // 파싱 불가한 ID는 유지
            });
        }
        return changed;
    } catch (e) {
        console.error(`[ReportProcessor] 오류: ${e.message}`);
        return false;
    }
}

/**
 * 존 트리를 순회하며, 같은 기상유형의 upcoming/current에 tmCc가 비어있는 해역에 전파
 * @param {object} obj - 존 트리 노드
 * @param {object} tmCcByBaseType - { '풍랑': '2026년 02월 08일 밤(21시~24시)', ... }
 * @returns {number} 업데이트된 해역 수
 */
function propagateTmCcToZoneTree(obj, tmCcByBaseType) {
    if (!obj || typeof obj !== 'object') return 0;
    let count = 0;

    for (const [key, value] of Object.entries(obj)) {
        if (key === 'children' || key === 'history' || key === 'missingCount') continue;

        if (value && typeof value === 'object' && 'current' in value && 'upcoming' in value) {
            // upcoming에 tmCc가 비어있고, 같은 기상유형의 tmCc가 있으면 전파
            if (value.upcoming && value.upcoming.wrnTp && !value.upcoming.tmCc) {
                const baseType = value.upcoming.wrnTp; // 이미 클린 타입 (예: '풍랑')
                if (tmCcByBaseType[baseType]) {
                    value.upcoming.tmCc = tmCcByBaseType[baseType];
                    console.log(`[ReportProcessor] tmCc 존 전파 (upcoming): ${key} ← ${tmCcByBaseType[baseType]}`);
                    count++;
                }
            }
            // current에도 동일 적용
            if (value.current && value.current.wrnTp && !value.current.tmCc) {
                const baseType = value.current.wrnTp;
                if (tmCcByBaseType[baseType]) {
                    value.current.tmCc = tmCcByBaseType[baseType];
                    console.log(`[ReportProcessor] tmCc 존 전파 (current): ${key} ← ${tmCcByBaseType[baseType]}`);
                    count++;
                }
            }
        }

        // 하위 노드 재귀 탐색
        count += propagateTmCcToZoneTree(value, tmCcByBaseType);
    }
    return count;
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
