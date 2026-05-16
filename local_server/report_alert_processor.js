const https = require('https');
const fs = require('fs');
const path = require('path');
const aiParser = require('./ai_report_parser');
const subregionParser = require('./subregion_parser');
const subregionAdminPush = require('./services/subregion_admin_push');
const subregionNormalizer = require('./services/subregion_normalizer');
const subregionCrossCheck = require('./services/subregion_cross_check');

const COLLECT_CACHE_DIR = path.join(__dirname, 'data', 'collect_cache');
// [검토 필요 통보문] "내용 없음"이지만 참고사항에 해상 키워드가 포함된 통보문 저장
const REVIEW_NEEDED_FILE = path.join(__dirname, 'data', 'review_needed.json');

const CONFIG = {
    LIST_URL: 'https://www.weather.go.kr/w/special-report/list.do',
    DETAIL_URL: 'https://www.weather.go.kr/w/special-report/list.do',
    TARGET_TYPES: [],
    // [9 광역 수집 정책 — 정책 01_COLLECTION_SCOPE.md]
    // 충북(131)은 5년치 해상특보 0건으로 수집 제외, 전국(108)은 광역 중복이라 폐지.
    // 이 9 광역에서 reportId 합집합을 만들어 unique 한 통보문만 처리.
    STN_CODES: [105, 109, 133, 143, 146, 156, 159, 184],
    // 광역별 페이지네이션 최대 페이지 수 (광역당 1~2페이지면 보통 충분)
    MAX_PAGES_PER_STN: 3
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
    const kind = parts[0] || 'met';   // 'met' | 'pwn' 등
    const dateStr = parts[1] || '';
    const dateParam = dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6) + '-' + dateStr.substring(6, 8);

    // [URL 정확화 — 정책 01_COLLECTION_SCOPE.md]
    //   광역(stn) 별로 발표된 통보문 본문을 가져오려면 prevStn=stn=해당광역 + kind=해당종류 명시 필수.
    //   stn 이 reportId 와 일치하지 않으면 KMA 서버가 reportId 를 무시하고 최신 통보문만 반환함.
    //   options.stn 이 없으면 fallback 으로 stn=108 (이전 동작 유지).
    const stn = (options && options.stn) || 108;
    const url = `${CONFIG.DETAIL_URL}?prevStn=${stn}&prevKind=${kind}&prevCmtCd=&stn=${stn}&kind=${kind}&date=${dateParam}&reportId=${encodeURIComponent(reportId)}`;

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

    // [HTML 엔티티 디코딩 강화 — 자식해역 명칭 보존용]
    // 기상청 통보문에 가끔 미디코딩 엔티티가 잔존하여 자식해역 매칭이 실패함.
    // 예: "태안&middot;서산 북쪽 평수구역" → "태안·서산 북쪽 평수구역" 으로 정규화.
    text = text
        .replace(/&middot;/g, '·')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#183;/g, '·')
        .replace(/&#xb7;/gi, '·');

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

        // ──────────────────────────────────────────────────────────────────────
        // [9 광역 병렬 호출 — 정책 01_COLLECTION_SCOPE.md]
        //   전국(stn=108) 1회 호출 → 9 광역(105, 109, 133, 143, 146, 156, 159, 184)
        //   병렬 호출로 변경. 전국은 자식해역(연안바다·평수구역) 정보를 제공하지 않으므로
        //   광역별 수집 필수.
        //
        //   각 광역마다 페이지네이션(최대 MAX_PAGES_PER_STN)으로 통보문 목록 수집.
        //   seenReportIds 로 광역간 중복 제거.
        //
        //   성능: 9 광역 병렬 호출 ~1.3초 (실측). 1분 사이클 내 충분히 처리 가능.
        // ──────────────────────────────────────────────────────────────────────
        const pattern = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;

        // 각 (stn, page) 의 URL 을 미리 만든다.
        const stnPageUrls = [];
        for (const stn of CONFIG.STN_CODES) {
            for (let page = 1; page <= CONFIG.MAX_PAGES_PER_STN; page++) {
                stnPageUrls.push({ stn, page, url: `${CONFIG.LIST_URL}?stn=${stn}&pageIndex=${page}` });
            }
        }

        // 9 광역 × 3 페이지 = 최대 27 요청. 병렬 호출.
        // 일부 실패해도 다른 광역 결과는 살려서 진행 (다음 사이클 재시도).
        const settled = await Promise.allSettled(
            stnPageUrls.map(({ url }) => fetchHtml(url))
        );

        for (let i = 0; i < settled.length; i++) {
            const { stn, page } = stnPageUrls[i];
            const result = settled[i];
            if (result.status === 'rejected') {
                console.warn(`[ReportProcessor] stn=${stn} page=${page} 요청 실패: ${result.reason?.message || result.reason}`);
                continue;
            }
            const html = result.value;
            const selectListMatch = html.match(/<select id="select-list"[^>]*>([\s\S]*?)<\/select>/);
            if (!selectListMatch) {
                continue;  // 해당 stn/page 에서 통보문 없음 (정상 케이스도 많음)
            }

            const pageReports = [];
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(selectListMatch[1])) !== null) {
                const id = match[1];
                const title = match[2].trim();
                // [필터링] 제목에 [특보] 또는 [예비]가 포함된 통보문만 수집 대상
                if (id.includes(':') && (title.includes('[특보]') || title.includes('[예비]'))) {
                    if (!seenReportIds.has(id)) {
                        seenReportIds.add(id);
                        pageReports.push({ id, title, stn });
                    }
                }
            }
            if (pageReports.length > 0) {
                console.log(`[ReportProcessor] stn=${stn} page=${page} 통보문 ${pageReports.length}건`);
            }

            // [누락 방지] processedIds에 없으면 무조건 수집 대상
            for (const r of pageReports) {
                if (processedIds.has(r.id)) continue;

                const rTs = (r.id.split(':')[1] || '').substring(0, 12);
                if (rTs.length >= 12) {
                    const reportDate = new Date(`${rTs.substring(0,4)}-${rTs.substring(4,6)}-${rTs.substring(6,8)}T${rTs.substring(8,10)}:${rTs.substring(10,12)}:00+09:00`);
                    if (now - reportDate > THIRTY_DAYS_MS) {
                        continue;  // 30일 이상 지난 통보문은 수집하지 않음
                    }
                }
                allNewReports.push(r);
            }
        }
        console.log(`[ReportProcessor] 9 광역 수집 합계: 신규 통보문 ${allNewReports.length}건 (dedup 후)`);

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
        // 해상 특보 키워드 목록
        // 1) 본문에 이 키워드가 있는 통보문만 AI 분석 대상 (비해상 특보는 AI 건너뛰어 호출량 절약)
        // 2) 참고사항 해상키워드 체크 안전망 (비해상 통보문에서도 참고사항에 해상 키워드 있으면 관리자 알림)
        // 3) 캐시 저장 시 foundKeywords 기록용
        const SEA_KEYWORDS = ['풍랑', '태풍', '지진해일', '폭풍해일'];

        // [재시도 대상 관리] pendingRetries: 빈 통보문 또는 API 오류로 처리되지 못한 통보문의 재시도 정보
        // weather_alerts.json에 함께 저장되어 서버 재시작 후에도 재시도 상태가 유지됨
        // pendingRetries 구조:
        //   {
        //     "met:202604100400:52": {
        //       title: "[특보] 04-52호 ...",         // 통보문 제목
        //       firstSeen: "ISO시각",                // 처음 감지된 시각 (6시간 타임아웃 기준점)
        //       retryCount: 0,                       // 현재까지 재시도한 횟수
        //       lastRetry: "ISO시각",                // 마지막 재시도 시각 (재시도 간격 판단용)
        //       lastNoticeSent: "ISO시각",           // 마지막 "지속 알림" 푸시 발송 시각 (10분 간격 제어)
        //       reason: "EMPTY_CONTENT"               // 재시도 사유:
        //                                            //   "EMPTY_CONTENT" = 빈 통보문 (1분 재시도, AI 미사용)
        //                                            //   "API_RATE_LIMIT" = Gemini 429 오류 (10분 재시도)
        //     }
        //   }
        if (!fullForm.pendingRetries) fullForm.pendingRetries = {};
        const EMPTY_RETRY_MS = 1 * 60 * 1000;            // 빈 통보문 재시도 간격: 1분 (AI 호출 없이 본문만 재확인, 부담 없음)
        const RATE_LIMIT_RETRY_MS = 10 * 60 * 1000;      // API 할당량 초과 재시도 간격: 10분 (빠른 재시도 시 429 악순환 방지)
        const MAX_RETRY_DURATION_MS = 6 * 60 * 60 * 1000; // 최대 재시도 기간: 6시간 (초과 시 수집 포기, 관리자 수동 확인 필요)
        const NOTICE_INTERVAL_MS = 10 * 60 * 1000;       // 지속 알림 푸시 간격: 10분 (관리자에게 "아직 미수집" 알림 주기)

        for (const report of allNewReports) {
            console.log(`[ReportProcessor] 통보문 확인 중: ${report.title}`);

            // ──────────────────────────────────────────────────────────────
            // [재시도 체크] 이전에 pendingRetries에 등록된 통보문인 경우
            // reason에 따라 다른 간격으로 재시도:
            //   EMPTY_CONTENT: 1분 (AI 미사용, HTTP로 본문만 재확인)
            //   API_RATE_LIMIT: 10분 (Gemini 할당량 리셋 대기)
            // firstSeen 기준 6시간 초과 시 수집 포기
            // ──────────────────────────────────────────────────────────────
            const pending = fullForm.pendingRetries[report.id];
            if (pending) {
                // reason에 따라 재시도 간격 결정
                // API_RATE_LIMIT(429 오류): 10분 대기 (빠른 재시도 시 429 악순환 발생)
                // EMPTY_CONTENT(빈 통보문): 1분 대기 (AI 호출 없이 본문만 재확인, 부담 없음)
                const retryInterval = pending.reason === 'API_RATE_LIMIT'
                    ? RATE_LIMIT_RETRY_MS : EMPTY_RETRY_MS;
                const elapsed = now - new Date(pending.lastRetry);
                // 재시도 간격이 아직 안 지났으면 이번 사이클에서는 건너뜀
                if (elapsed < retryInterval) {
                    continue;
                }
                // 6시간 경과: 수집 포기 → processedReportIds에 등록 + 관리자 알림
                const age = now - new Date(pending.firstSeen);
                if (age > MAX_RETRY_DURATION_MS) {
                    const reasonLabel = pending.reason === 'API_RATE_LIMIT' ? 'AI 할당량 초과' : '빈 통보문';
                    console.log(`[ReportProcessor] ⏰ 재시도 시간 초과 (6시간): ${report.title} (사유: ${reasonLabel})`);
                    // review_needed.json에 저장 (관리자센터 "특보 수집 오류" 탭에서 확인 가능)
                    try {
                        let reviews = [];
                        if (fs.existsSync(REVIEW_NEEDED_FILE)) {
                            reviews = JSON.parse(fs.readFileSync(REVIEW_NEEDED_FILE, 'utf8'));
                        }
                        if (!reviews.some(r => r.reportId === report.id)) {
                            reviews.push({
                                reportId: report.id,
                                title: report.title,
                                referenceText: `6시간 재시도 실패 (사유: ${reasonLabel}, ${pending.retryCount}회 시도)`,
                                detectedAt: pending.firstSeen,
                                acknowledged: false
                            });
                            fs.writeFileSync(REVIEW_NEEDED_FILE, JSON.stringify(reviews, null, 2), 'utf8');
                        }
                    } catch (e) { console.error('[ReportProcessor] review_needed 저장 오류:', e.message); }
                    // 관리자에게 FCM 푸시 발송
                    const { sendAdminPush } = require('./services/admin_push');
                    sendAdminPush(
                        '⚠️ 통보문 수집 실패',
                        `${report.title} - 6시간 재시도 실패 (사유: ${reasonLabel}, ${pending.retryCount}회). 수동 확인 필요`
                    ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                    // processedReportIds에 등록하여 더 이상 재시도하지 않음
                    if (!fullForm.processedReportIds) fullForm.processedReportIds = [];
                    fullForm.processedReportIds.push(report.id);
                    delete fullForm.pendingRetries[report.id];
                    continue;
                }
                console.log(`[ReportProcessor] 🔄 재시도 ${pending.retryCount + 1}: ${report.title} (사유: ${pending.reason || 'EMPTY_CONTENT'})`);
            }

            // ──────────────────────────────────────────────────────────────
            // [본문 가져오기] KMA 웹사이트에서 통보문 본문 HTML을 가져와 텍스트로 변환
            // ──────────────────────────────────────────────────────────────
            // report.stn 은 9 광역 수집 시 광역 코드가 들어있음 (없으면 fallback 108)
            const text = await fetchReportDetail(report.id, { stn: report.stn });
            const baseDate = extractTmFcFromId(report.id);

            // ──────────────────────────────────────────────────────────────
            // [케이스 A: 빈 본문] fetchReportDetail이 빈 문자열을 반환한 경우
            // 원인: KMA가 양식만 올리고 본문을 아직 안 채웠거나, HTML 구조가 맞지 않음
            // 대응: 1분마다 본문만 재확인 (AI 호출 없음 → API 부담 없음)
            // 본문이 채워지면 다음 사이클에서 키워드 검사 후 AI 분석 또는 미수집 판정
            // ──────────────────────────────────────────────────────────────
            if (!text || text.trim().length === 0) {
                const nowIso = new Date().toISOString();
                if (!fullForm.pendingRetries[report.id]) {
                    // [첫 감지] pendingRetries에 등록 + 관리자에게 즉시 알림
                    fullForm.pendingRetries[report.id] = {
                        title: report.title,
                        firstSeen: nowIso,
                        retryCount: 0,
                        lastRetry: nowIso,
                        lastNoticeSent: nowIso,
                        reason: 'EMPTY_CONTENT'
                    };
                    console.log(`[ReportProcessor] ⚠️ 빈 통보문 감지 (본문 없음), 재시도 등록: ${report.title}`);
                    const { sendAdminPush } = require('./services/admin_push');
                    sendAdminPush(
                        '🔍 빈 통보문 감지',
                        `${report.title} - 본문 미게시 상태, 1분 간격 재확인 시작 (최대 6시간)`
                    ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                } else {
                    // [재시도 실패] 여전히 본문이 비어있음 → 재시도 횟수 증가
                    const pendingEntry = fullForm.pendingRetries[report.id];
                    pendingEntry.retryCount++;
                    pendingEntry.lastRetry = nowIso;
                    // [reason 자동 갱신] 이전에 API_RATE_LIMIT였더라도 현재 상태는 "빈 본문"이므로 EMPTY_CONTENT로 변경
                    // → 재시도 간격이 10분(RATE_LIMIT)에서 1분(EMPTY)으로 자동 전환되어 더 빠른 회복 가능
                    pendingEntry.reason = 'EMPTY_CONTENT';
                    console.log(`[ReportProcessor] 재시도 실패 (여전히 빈 본문): ${report.title} (${pendingEntry.retryCount}회)`);

                    // [지속 알림] 10분마다 관리자에게 "아직 빈 상태" 알림 (스팸 방지)
                    const noticeElapsed = now - new Date(pendingEntry.lastNoticeSent || pendingEntry.firstSeen);
                    if (noticeElapsed >= NOTICE_INTERVAL_MS) {
                        const minutesSinceFirst = Math.round((now - new Date(pendingEntry.firstSeen)) / 60000);
                        const { sendAdminPush } = require('./services/admin_push');
                        sendAdminPush(
                            '⏳ 빈 통보문 지속',
                            `${report.title} - ${minutesSinceFirst}분 경과, 아직 본문 미게시 (${pendingEntry.retryCount}회 확인)`
                        ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                        pendingEntry.lastNoticeSent = nowIso;
                    }
                }
                continue; // processedReportIds에 넣지 않음 → 다음 사이클에서 본문 재확인
            }

            // ──────────────────────────────────────────────────────────────
            // [해상 키워드 체크] 본문에 풍랑/태풍/지진해일/폭풍해일 키워드가 있는지 검사
            // 키워드 있음 → AI 분석 필요 (해상 특보가 포함된 통보문)
            // 키워드 없음 → 비해상 특보 (강풍/대설/한파 등) → AI 건너뛰어 호출량 절약
            //
            // 이전에는 모든 통보문을 AI로 보내 Gemini 할당량 초과(429)가 발생했음
            // 이제는 해상 관련 통보문만 AI에 보내 호출량을 대폭 감축
            //
            // 예시:
            //   [특보] 강풍주의보·풍랑주의보 발표 → 본문에 "풍랑" 있음 → AI 분석 ✅
            //   [예비] 제04-17호 (제목에 풍랑 없음) → 본문에 "풍랑 예비특보" 있음 → AI 분석 ✅
            //   [특보] 강풍주의보 발표 → 본문에 해상키워드 없음 → AI 건너뜀 → 호출량 절약
            // ──────────────────────────────────────────────────────────────
            const hasSeaKeyword = SEA_KEYWORDS.some(kw => text.includes(kw));

            if (!hasSeaKeyword) {
                console.log(`[ReportProcessor] 비해상 통보문 (해상 키워드 미포함): ${report.title} → AI 건너뜀`);

                // [빈 통보문에서 복구된 경우] 이전에 빈 통보문이었다가 내용이 채워졌지만 해상 키워드 없음
                // → 비해상이므로 미수집 처리 + pendingRetries 정리 + 관리자 알림
                if (fullForm.pendingRetries[report.id]) {
                    const recovered = fullForm.pendingRetries[report.id];
                    const totalMinutes = Math.round((now - new Date(recovered.firstSeen)) / 60000);
                    console.log(`[ReportProcessor] ✅ 빈 통보문 → 내용 확인됨 (비해상): ${report.title} (${totalMinutes}분 경과)`);
                    const { sendAdminPush } = require('./services/admin_push');
                    sendAdminPush(
                        '✅ 빈 통보문 내용 확인',
                        `${report.title} - 내용 채워짐, 해상 미해당 (${recovered.retryCount}회 확인, ${totalMinutes}분 경과)`
                    ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                    delete fullForm.pendingRetries[report.id];
                }

                // [참고사항 해상키워드 안전망] 본문에 "없음"이 포함되고 참고사항에 해상 키워드가 있으면
                // "이 통보문은 관리자 확인이 필요할 수 있음"을 review_needed에 기록
                // (예: 본문 "○ 내용: 없음"이지만 참고사항에 "풍랑주의보" 언급)
                if (text.includes('없음')) {
                    try {
                        const fullText = await fetchReportDetail(report.id, { keepReference: true, stn: report.stn });
                        const refIdx = fullText.indexOf('참고사항');
                        if (refIdx !== -1) {
                            const refSection = fullText.substring(refIdx);
                            const refKeywords = SEA_KEYWORDS.filter(kw => refSection.includes(kw));
                            if (refKeywords.length > 0) {
                                console.log(`[ReportProcessor] ⚠️ 비해상 통보문이지만 참고사항에 해상키워드 발견: ${refKeywords.join(', ')}`);
                                let reviews = [];
                                if (fs.existsSync(REVIEW_NEEDED_FILE)) {
                                    reviews = JSON.parse(fs.readFileSync(REVIEW_NEEDED_FILE, 'utf8'));
                                }
                                if (!reviews.some(r => r.reportId === report.id)) {
                                    reviews.push({
                                        reportId: report.id,
                                        title: report.title,
                                        referenceText: `참고사항 해상키워드: ${refKeywords.join(', ')}`,
                                        detectedAt: new Date().toISOString(),
                                        acknowledged: false
                                    });
                                    fs.writeFileSync(REVIEW_NEEDED_FILE, JSON.stringify(reviews, null, 2), 'utf8');
                                }
                                const { sendAdminPush } = require('./services/admin_push');
                                sendAdminPush(
                                    '🔍 참고사항 해상키워드 감지',
                                    `${report.title} - 본문 "없음"이나 참고사항에 ${refKeywords.join(', ')} 포함`
                                ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                            }
                        }
                    } catch (refErr) {
                        console.error('[ReportProcessor] 참고사항 체크 오류:', refErr.message);
                    }
                }

                // [캐시 저장] 비해상 통보문도 캐시에 저장 → 관리자센터에서 [완료][결과] 표시
                try {
                    if (!fs.existsSync(COLLECT_CACHE_DIR)) fs.mkdirSync(COLLECT_CACHE_DIR, { recursive: true });
                    const cacheData = {
                        success: true, reportId: report.id, title: report.title,
                        rawText: text, separatedText: null, aiResult: [], foundKeywords: [],
                        applied: false, aiError: null, pushResult: null
                    };
                    const cacheFileName = report.id.replace(/[/:]/g, '_') + '.json';
                    fs.writeFileSync(path.join(COLLECT_CACHE_DIR, cacheFileName), JSON.stringify(cacheData, null, 2), 'utf8');
                } catch (cacheErr) {
                    console.error('[ReportProcessor] 수집 캐시 저장 오류:', cacheErr.message);
                }

                // processedReportIds에 등록하여 다음 사이클에서 건너뜀
                fullForm.lastReportId = report.id;
                if (!fullForm.processedReportIds) fullForm.processedReportIds = [];
                fullForm.processedReportIds.push(report.id);
                continue; // 비해상 통보문 처리 완료 → 다음 통보문으로
            }

            // ──────────────────────────────────────────────────────────────
            // [AI 분석] 해상 키워드가 포함된 통보문만 Gemini AI로 분석
            // 이전에는 모든 통보문을 AI로 보내 할당량 초과(429) 문제가 발생했음
            // 이제는 해상 관련 통보문만 AI에 보내 호출량을 대폭 감축 (약 750건→200건 이하)
            // ──────────────────────────────────────────────────────────────
            console.log(`[ReportProcessor] AI 분석 시작 (해상 키워드 발견): ${report.title}`);
            const aiParsed = await aiParser.parseNoticeWithAI(text, baseDate);
            const events = aiParsed.data || [];
            const separatedText = aiParsed.separatedText || null;
            if (aiParsed.error) {
                console.error(`[ReportProcessor] AI 분석 오류: ${aiParsed.error}`);
            }

            // ──────────────────────────────────────────────────────────────
            // [자식해역 정규식 파서 — Dual Validation 의 한 축]
            //   ai_report_parser 는 부모해역 단위로 zones 를 반환하지만,
            //   "○○앞바다(○○연안바다)" 같은 자식해역 명시는 별도 처리되지 않는다.
            //   subregion_parser 가 본문 전체에서 P1·P2 정규식으로 자식해역을 추출하여
            //   events 와 별도로 aiParsed.children 에 저장한다.
            //   장부 갱신(weather_alerts_crawler.js)에서 events + children 을 결합 적용.
            //
            //   AI 와 정규식 결과 비교는 별도 모듈(subregion_cross_check)에서 처리하며,
            //   불일치 시 관리자 푸시 발송 (정책 06_ADMIN_PUSH_POLICY.md case ③).
            // ──────────────────────────────────────────────────────────────
            try {
                const childrenInfo = subregionParser.extractChildrenFromBody(text);
                if (childrenInfo.length > 0) {
                    aiParsed.children = childrenInfo;
                    console.log(`[ReportProcessor] 자식해역 추출 ${childrenInfo.length}건:`,
                        childrenInfo.map(c => `${c.parent}(${c.child}${c.excluded ? ' 제외' : ''})`).join(', '));
                } else {
                    // [케이스 ⑤ — 자식해역 파서 실패 감지]
                    //   본문에 자식해역 키워드(연안바다·평수구역)는 있으나 정규식이 추출 실패한 경우
                    //   = 비정상 형식 또는 신규 패턴 가능성 → 관리자 알림
                    if (/연안바다|평수구역/.test(text)) {
                        subregionAdminPush.sendParserFailure({
                            reportId: report.id,
                            stn: report.stn,
                            rawSnippet: text.match(/.{0,80}(연안바다|평수구역).{0,80}/)?.[0] || ''
                        });
                    }
                }

                // ──────────────────────────────────────────────────────────
                // [Dual Validation 교차 검증 — 정책 06 케이스 ③]
                //   AI 파서 결과(events.zones) 와 정규식 파서 결과(children) 를 비교.
                //   AI 가 자식해역명을 zones 에 잘못 넣었거나 (hallucination),
                //   정규식이 잡은 자식을 AI 가 누락한 경우 등 불일치 시 관리자 푸시.
                //   결과적으로 정규식 결과(aiParsed.children) 를 신뢰값으로 채택.
                // ──────────────────────────────────────────────────────────
                subregionCrossCheck.runCrossCheck({
                    reportId: report.id,
                    stn: report.stn,
                    aiParsed
                });
            } catch (e) {
                console.error('[ReportProcessor] 자식해역 cross-check 오류:', e.message);
            }

            try {
                const childrenInfo = aiParsed.children || [];
                if (childrenInfo.length > 0) {

                    // ──────────────────────────────────────────────────────────
                    // [자식해역 관련 관리자 푸시 — 정책 06_ADMIN_PUSH_POLICY.md]
                    //   각 추출 케이스마다 관리자에게 푸시 발송. 빈도 제어 내장.
                    //   ①·② 자동 처리, ⑥ 신규 명칭 감지.
                    //   ③·④·⑧ 은 장부 적용 단계에서 별도 발송.
                    // ──────────────────────────────────────────────────────────
                    for (const ch of childrenInfo) {
                        try {
                            // ⑥ 신규 자식해역 명칭 (카탈로그 미등록)
                            if (subregionNormalizer.isKnownParent(ch.parent)
                                && !subregionNormalizer.isKnownChild(ch.parent, ch.child)
                                && !subregionNormalizer.isDeprecated(ch.child)) {
                                subregionAdminPush.sendUnknownChildName({
                                    reportId: report.id,
                                    stn: report.stn,
                                    parentRegion: ch.parent,
                                    detectedChildName: ch.child
                                });
                            }
                            // ② P1 제외 처리
                            if (ch.excluded) {
                                subregionAdminPush.sendP1Excluded({
                                    reportId: report.id,
                                    stn: report.stn,
                                    parentRegion: ch.parent,
                                    childRegion: ch.child
                                });
                            } else {
                                // ① P2 단독 발효 (excluded=false)
                                subregionAdminPush.sendP2SoloActive({
                                    reportId: report.id,
                                    stn: report.stn,
                                    parentRegion: ch.parent,
                                    childRegion: ch.child,
                                    wrnTp: events[0] && events[0].type,
                                    wrnLvl: events[0] && events[0].command,
                                    tmEf: events[0] && events[0].tmEf
                                });
                            }
                        } catch (e) {
                            console.error('[ReportProcessor] 자식해역 관리자 푸시 오류:', e.message);
                        }
                    }
                }
            } catch (e) {
                console.error('[ReportProcessor] 자식해역 파서 오류:', e.message);
            }

            // ──────────────────────────────────────────────────────────────────
            // [방식 A: 예비특보 자연어 해제] — kind=pwn 통보문의 참고사항 절
            // "발표 가능성이 낮[아어]져 해제" 매칭 시 자동 해제 X, 관리자 확인 대기.
            // ──────────────────────────────────────────────────────────────────
            if (report.id.startsWith('pwn:')) {
                try {
                    // 참고사항 절을 보존해서 다시 가져오기
                    const fullText = await fetchReportDetail(report.id, { keepReference: true, stn: report.stn });
                    const refIdx = fullText.indexOf('참고사항');
                    if (refIdx !== -1) {
                        const referenceBlock = fullText.substring(refIdx);
                        const cancels = subregionParser.extractPrelimNaturalCancel(referenceBlock);
                        for (const c of cancels) {
                            subregionAdminPush.sendPrelimNaturalCancel({
                                reportId: report.id,
                                stn: report.stn,
                                affectedRegion: c.region,
                                affectedKind: c.kind,
                                detectedPhrase: c.detectedPhrase
                            });
                        }
                    }
                } catch (e) {
                    console.error('[ReportProcessor] 예비특보 자연어 해제 매칭 오류:', e.message);
                }
            }

            // ──────────────────────────────────────────────────────────────
            // [케이스 C: API 할당량 초과] Gemini AI가 429 RESOURCE_EXHAUSTED 오류 반환
            // → 통보문 내용은 정상이지만 AI가 거부한 것 ("빈 통보문"이 아님!)
            // → 10분 간격으로 재시도 (빠른 재시도 시 429 악순환이 발생하기 때문)
            // → 할당량이 시간이 지나면 리셋되므로 느리게 재시도하면 성공 가능
            // ──────────────────────────────────────────────────────────────
            if (aiParsed.isRateLimited) {
                const nowIso = new Date().toISOString();
                if (!fullForm.pendingRetries[report.id]) {
                    // [첫 감지] pendingRetries에 등록 (reason: API_RATE_LIMIT, 10분 재시도)
                    fullForm.pendingRetries[report.id] = {
                        title: report.title,
                        firstSeen: nowIso,
                        retryCount: 0,
                        lastRetry: nowIso,
                        lastNoticeSent: nowIso,
                        reason: 'API_RATE_LIMIT'
                    };
                    console.log(`[ReportProcessor] ⚠️ AI 할당량 초과 감지: ${report.title}`);
                    const { sendAdminPush } = require('./services/admin_push');
                    sendAdminPush(
                        '⚠️ AI 할당량 초과',
                        `${report.title} - Gemini API 429 오류, 10분 간격 재시도 시작 (최대 6시간)`
                    ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                } else {
                    // [재시도 실패] 여전히 429 → 재시도 횟수 증가, reason 갱신
                    const pendingEntry = fullForm.pendingRetries[report.id];
                    pendingEntry.retryCount++;
                    pendingEntry.lastRetry = nowIso;
                    // reason 갱신: 빈 통보문이었다가 내용 채워진 후 429 발생 시 EMPTY→RATE_LIMIT 전환
                    pendingEntry.reason = 'API_RATE_LIMIT';
                    console.log(`[ReportProcessor] AI 할당량 초과 지속: ${report.title} (${pendingEntry.retryCount}회)`);

                    // [지속 알림] 10분마다 관리자에게 알림 (스팸 방지)
                    const noticeElapsed = now - new Date(pendingEntry.lastNoticeSent || pendingEntry.firstSeen);
                    if (noticeElapsed >= NOTICE_INTERVAL_MS) {
                        const minutesSinceFirst = Math.round((now - new Date(pendingEntry.firstSeen)) / 60000);
                        const { sendAdminPush } = require('./services/admin_push');
                        sendAdminPush(
                            '⏳ AI 할당량 초과 지속',
                            `${report.title} - ${minutesSinceFirst}분 경과, AI 할당량 미회복 (${pendingEntry.retryCount}회 시도)`
                        ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                        pendingEntry.lastNoticeSent = nowIso;
                    }
                }
                continue; // processedReportIds에 넣지 않음 → 10분 뒤 재시도
            }

            // ──────────────────────────────────────────────────────────────
            // [케이스 D: AI 빈 양식 판단] AI가 정상 응답했지만 hasContent=false
            // 본문에 해상 키워드는 있지만 AI가 "빈 양식"으로 판단한 드문 케이스
            // → 빈 통보문과 동일하게 1분 간격 재시도 (KMA가 내용을 채울 때까지 대기)
            // ──────────────────────────────────────────────────────────────
            if (!aiParsed.hasContent) {
                const nowIso = new Date().toISOString();
                if (!fullForm.pendingRetries[report.id]) {
                    fullForm.pendingRetries[report.id] = {
                        title: report.title,
                        firstSeen: nowIso,
                        retryCount: 0,
                        lastRetry: nowIso,
                        lastNoticeSent: nowIso,
                        reason: 'EMPTY_CONTENT'
                    };
                    console.log(`[ReportProcessor] ⚠️ AI 빈 양식 판단: ${report.title}`);
                    const { sendAdminPush } = require('./services/admin_push');
                    sendAdminPush(
                        '🔍 빈 통보문 감지',
                        `${report.title} - AI가 빈 양식으로 판단, 1분 간격 재확인 시작 (최대 6시간)`
                    ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                } else {
                    const pendingEntry = fullForm.pendingRetries[report.id];
                    pendingEntry.retryCount++;
                    pendingEntry.lastRetry = nowIso;
                    // [reason 자동 갱신] 이전에 API_RATE_LIMIT였더라도 현재는 AI 호출이 정상 응답한 상태이므로
                    // EMPTY_CONTENT로 변경 → 재시도 간격이 10분에서 1분으로 자동 전환
                    pendingEntry.reason = 'EMPTY_CONTENT';
                    console.log(`[ReportProcessor] 재시도 실패 (AI 빈 양식 판단 지속): ${report.title} (${pendingEntry.retryCount}회)`);

                    // [지속 알림] 10분마다 관리자 알림 (스팸 방지)
                    const noticeElapsed = now - new Date(pendingEntry.lastNoticeSent || pendingEntry.firstSeen);
                    if (noticeElapsed >= NOTICE_INTERVAL_MS) {
                        const minutesSinceFirst = Math.round((now - new Date(pendingEntry.firstSeen)) / 60000);
                        const { sendAdminPush } = require('./services/admin_push');
                        sendAdminPush(
                            '⏳ 빈 통보문 지속',
                            `${report.title} - ${minutesSinceFirst}분 경과, 아직 미수집 (${pendingEntry.retryCount}회 확인)`
                        ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                        pendingEntry.lastNoticeSent = nowIso;
                    }
                }
                continue; // processedReportIds에 넣지 않음 → 1분 뒤 재시도
            }

            // ──────────────────────────────────────────────────────────────
            // [재시도 성공] 이전에 pendingRetries에 있었는데 이제 내용이 확인된 경우
            // → pendingRetries에서 제거 + 관리자에게 "수집 완료" 푸시 발송
            // 발생 시나리오:
            //   - 빈 통보문(EMPTY_CONTENT)이었다가 내용 채워짐 → AI 분석 성공
            //   - AI 할당량 초과(API_RATE_LIMIT)였다가 할당량 회복 → AI 분석 성공
            // ──────────────────────────────────────────────────────────────
            if (fullForm.pendingRetries[report.id]) {
                const recoveredEntry = fullForm.pendingRetries[report.id];
                const totalMinutes = Math.round((now - new Date(recoveredEntry.firstSeen)) / 60000);
                const reasonLabel = recoveredEntry.reason === 'API_RATE_LIMIT' ? 'AI 할당량 회복' : '내용 확인';
                console.log(`[ReportProcessor] ✅ 재시도 성공! ${reasonLabel}: ${report.title} (${recoveredEntry.retryCount}회, ${totalMinutes}분)`);
                const { sendAdminPush } = require('./services/admin_push');
                sendAdminPush(
                    '✅ 수집 완료',
                    `${report.title} - ${reasonLabel}, 정상 수집 완료 (${recoveredEntry.retryCount}회 재시도, ${totalMinutes}분 소요)`
                ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                delete fullForm.pendingRetries[report.id];
            }

            // ──────────────────────────────────────────────────────────────
            // [이벤트 적용] AI가 해상 특보 이벤트를 추출한 경우에만 존 트리에 적용
            // events가 빈 배열([])이면 해상 무관 통보문 → 캐시만 저장하고 넘어감
            // ──────────────────────────────────────────────────────────────
            if (events.length > 0) {
                // [Fix] AI 결과 중복 제거: 동일 type+command+zones 조합의 이벤트 병합
                const deduplicatedEvents = [];
                const seenEventKeys = new Set();
                for (const event of events) {
                    const sortedZones = [...(event.zones || [])].sort().join(',');
                    const eventKey = `${event.type}|${event.command}|${sortedZones}`;
                    if (!seenEventKeys.has(eventKey)) {
                        seenEventKeys.add(eventKey);
                        deduplicatedEvents.push(event);
                    } else {
                        console.log(`[ReportProcessor] 중복 이벤트 제거: ${event.type} ${event.command}`);
                    }
                }

                // [Fix] 동일 통보문 내 같은 기상유형 이벤트 간 tmCc(해제예정시각) 전파
                // 예: 풍랑주의보(tmCc 있음)와 풍랑예비특보(tmCc 없음)가 동시에 있을 때,
                //     해제예정은 해당 기상현상 전체에 적용되므로 tmCc가 없는 이벤트에 복사
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
                            if (!event.tmYn) event.tmYn = event.tmCc;
                            console.log(`[ReportProcessor] tmCc 전파: ${event.type} ← ${tmCcByBaseType[baseType]}`);
                        }
                    }
                }

                // 분석된 각 이벤트를 존 트리(weather_alerts.json의 current)에 적용
                // 같은 통보문 내 동일 type+command로 이미 처리된 구역은 덮어쓰지 않음
                const processedZonesInReport = {};
                for (const event of deduplicatedEvents) {
                    event.reportId = report.id;
                    event.tmFc = extractTmFcFromId(report.id);
                    event.title = report.title || '';
                    event.zones = [...new Set(event.zones || [])];

                    const trackingKey = `${event.type}|${event.command}`;
                    if (!processedZonesInReport[trackingKey]) {
                        processedZonesInReport[trackingKey] = new Set();
                    }

                    console.log(`[AI Event] ${event.type} ${event.command} (${event.time}) - 구역: ${event.zones.length}개`);

                    event.zones.forEach(zoneName => {
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
                // 특정 해역의 주의보/경보에만 tmCc가 있고 예비 해역에는 없는 경우,
                // 같은 기상유형의 모든 해역에 tmCc를 적용
                if (Object.keys(tmCcByBaseType).length > 0) {
                    const propagatedCount = propagateTmCcToZoneTree(fullForm.current, tmCcByBaseType);
                    if (propagatedCount > 0) {
                        console.log(`[ReportProcessor] 존 트리 tmCc 전파: ${propagatedCount}건 업데이트`);
                        changed = true;
                    }
                }
            } else if (text.includes('없음')) {
                // ──────────────────────────────────────────────────────────────
                // [참고사항 해상키워드 체크] AI가 events=[]이고 본문에 "없음"이 포함된 경우
                // 참고사항에 해상 키워드가 있으면 관리자 확인이 필요할 수 있음
                // 예: 본문 "○ 내용: 없음"이지만 참고사항에 "풍랑주의보" 언급
                // ──────────────────────────────────────────────────────────────
                try {
                    const fullText = await fetchReportDetail(report.id, { keepReference: true, stn: report.stn });
                    const refIdx = fullText.indexOf('참고사항');
                    if (refIdx !== -1) {
                        const refSection = fullText.substring(refIdx);
                        const refKeywords = SEA_KEYWORDS.filter(kw => refSection.includes(kw));
                        if (refKeywords.length > 0) {
                            console.log(`[ReportProcessor] ⚠️ "없음" 통보문이지만 참고사항에 해상키워드 발견: ${refKeywords.join(', ')}`);
                            // review_needed.json에 저장
                            let reviews = [];
                            if (fs.existsSync(REVIEW_NEEDED_FILE)) {
                                reviews = JSON.parse(fs.readFileSync(REVIEW_NEEDED_FILE, 'utf8'));
                            }
                            if (!reviews.some(r => r.reportId === report.id)) {
                                reviews.push({
                                    reportId: report.id,
                                    title: report.title,
                                    referenceText: `참고사항 해상키워드: ${refKeywords.join(', ')}`,
                                    detectedAt: new Date().toISOString(),
                                    acknowledged: false
                                });
                                fs.writeFileSync(REVIEW_NEEDED_FILE, JSON.stringify(reviews, null, 2), 'utf8');
                            }
                            // 관리자 푸시 발송
                            const { sendAdminPush } = require('./services/admin_push');
                            sendAdminPush(
                                '🔍 참고사항 해상키워드 감지',
                                `${report.title} - 본문 "없음"이나 참고사항에 ${refKeywords.join(', ')} 포함`
                            ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                        }
                    }
                } catch (refErr) {
                    console.error('[ReportProcessor] 참고사항 체크 오류:', refErr.message);
                }
            }

            // ──────────────────────────────────────────────────────────────
            // [캐시 저장] 모든 통보문의 AI 분석 결과를 캐시에 저장
            // 해상 이벤트가 없는 통보문(육상 특보 등)도 [완료][결과]로 관리자센터에 표시됨
            // 관리자가 수동 수집 테스트에서 재조회 시 AI 토큰 소모를 방지하는 역할도 함
            // ──────────────────────────────────────────────────────────────
            try {
                if (!fs.existsSync(COLLECT_CACHE_DIR)) fs.mkdirSync(COLLECT_CACHE_DIR, { recursive: true });
                const foundKeywords = SEA_KEYWORDS.filter(kw => text.includes(kw));
                const cacheData = {
                    success: true, reportId: report.id, title: report.title,
                    rawText: text, separatedText, aiResult: events, foundKeywords,
                    applied: changed, aiError: aiParsed.error || null, pushResult: null
                };
                const cacheFileName = report.id.replace(/[/:]/g, '_') + '.json';
                fs.writeFileSync(path.join(COLLECT_CACHE_DIR, cacheFileName), JSON.stringify(cacheData, null, 2), 'utf8');
            } catch (cacheErr) {
                console.error('[ReportProcessor] 수집 캐시 저장 오류:', cacheErr.message);
            }

            // ──────────────────────────────────────────────────────────────
            // [처리 완료 등록] processedReportIds에 추가하여 다음 사이클에서 건너뜀
            // ──────────────────────────────────────────────────────────────
            fullForm.lastReportId = report.id;
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
        // [pendingRetries 안전 정리] 24시간 초과 항목 제거
        // KMA 목록에서 사라져 for 루프에 진입하지 못한 항목이 영구 잔존하는 것을 방지
        // (정상적인 경우 6시간 내 MAX_RETRIES 도달로 제거되지만, 목록 누락 시 여기서 처리)
        if (fullForm.pendingRetries) {
            const SAFETY_CLEANUP_MS = 24 * 60 * 60 * 1000; // 24시간
            const cleanupNow = new Date();
            for (const [id, info] of Object.entries(fullForm.pendingRetries)) {
                const age = cleanupNow - new Date(info.firstSeen);
                if (age > SAFETY_CLEANUP_MS) {
                    console.log(`[ReportProcessor] 🧹 pendingRetries 24시간 초과 정리: ${info.title}`);
                    // review_needed.json에 기록
                    try {
                        let reviews = [];
                        if (fs.existsSync(REVIEW_NEEDED_FILE)) {
                            reviews = JSON.parse(fs.readFileSync(REVIEW_NEEDED_FILE, 'utf8'));
                        }
                        if (!reviews.some(r => r.reportId === id)) {
                            reviews.push({
                                reportId: id,
                                title: info.title,
                                referenceText: '24시간 안전 정리 (KMA 목록에서 사라짐)',
                                detectedAt: info.firstSeen,
                                acknowledged: false
                            });
                            fs.writeFileSync(REVIEW_NEEDED_FILE, JSON.stringify(reviews, null, 2), 'utf8');
                        }
                    } catch (e) { console.error('[ReportProcessor] review_needed 저장 오류:', e.message); }
                    // 관리자 푸시 발송
                    const { sendAdminPush } = require('./services/admin_push');
                    sendAdminPush(
                        '⚠️ 통보문 수집 실패 (안전 정리)',
                        `${info.title} - 24시간 경과, KMA 목록 미노출. 수동 확인 필요`
                    ).catch(err => console.error('[ReportProcessor] 관리자 푸시 오류:', err.message));
                    // processedReportIds에 등록하여 재수집 방지
                    if (!fullForm.processedReportIds) fullForm.processedReportIds = [];
                    fullForm.processedReportIds.push(id);
                    delete fullForm.pendingRetries[id];
                }
            }
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
