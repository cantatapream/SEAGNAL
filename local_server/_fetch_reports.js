/**
 * ============================================================================
 * 파일명: _fetch_reports.js
 * 역할 : 개발/디버그용 1회성 스크립트 — KMA 특보 통보문 30건의 본문 텍스트를
 *        콘솔에 출력하여 ai_report_parser 의 입력 샘플 확보 + 파싱 검증.
 *
 *        파일명 _ 접두사: 운영 코드와 분리(서버 startup 에 require 안 됨).
 *        실행: node local_server/_fetch_reports.js
 * ============================================================================
 */

const https = require("https");

/** KMA 특보 페이지 HTML 본문 fetch (User-Agent 헤더로 봇 차단 회피). */
function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        https.get(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        }, (res) => {
            const chunks = [];
            res.on("data", chunk => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        }).on("error", reject);
    });
}

/**
 * 통보문 reportId(예: "108:20260430:abcd") 의 상세 페이지에서 본문 텍스트 추출.
 * cmp-view-content 영역을 정규식으로 파싱 + HTML 태그 제거 후 텍스트만 반환.
 */
async function fetchReportDetail(reportId) {
    const parts = reportId.split(':');
    const dateStr = parts[1] || '';
    const dateParam = dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6) + '-' + dateStr.substring(6, 8);
    const url = `https://www.weather.go.kr/w/special-report/list.do?prevStn=108&stn=108&date=${dateParam}&reportId=${reportId}`;
    const html = await fetchHtml(url);

    let contentHtml = '';
    const patterns = [
        /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/section>/,
        /<div class="cmp-view-content">([\s\S]*?)<\/div>\s*<\/div>/,
        /<div class="cmp-view-content">([\s\S]*)<\/div>/,
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

    return text;
}

/**
 * 스크립트 진입점 — 1~3 페이지의 통보문 ID 목록 수집 후 각 통보문 본문을
 * 차례로 fetch + 콘솔 출력. 최대 30건까지. "참고사항" 이후 부분은 잘라냄.
 */
async function main() {
    // Step 1: Get report list (pages 1-3)
    const allReports = [];
    for (let page = 1; page <= 3; page++) {
        const html = await fetchHtml(`https://www.weather.go.kr/w/special-report/list.do?pageIndex=${page}`);
        const selectListMatch = html.match(/<select id="select-list"[^>]*>([\s\S]*?)<\/select>/);
        if (!selectListMatch) continue;
        const pattern = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
        let match;
        while ((match = pattern.exec(selectListMatch[1])) !== null) {
            const id = match[1];
            const title = match[2].trim();
            if (id.includes(':') && (title.includes('[특보]') || title.includes('[예비]'))) {
                if (!allReports.some(r => r.id === id)) {
                    allReports.push({ id, title });
                }
            }
        }
    }

    console.log(`\n총 ${allReports.length}건의 특보 통보문 발견\n`);

    // Step 2: Fetch each report's raw text
    for (let i = 0; i < allReports.length && i < 30; i++) {
        const report = allReports[i];
        console.log(`\n${'='.repeat(80)}`);
        console.log(`[${i+1}] ${report.title}`);
        console.log(`    ID: ${report.id}`);
        console.log('='.repeat(80));

        try {
            const text = await fetchReportDetail(report.id);
            if (text) {
                // Remove 참고사항 section
                const refIdx = text.indexOf('참고사항');
                const cleanText = refIdx !== -1 ? text.substring(0, refIdx).trim() : text;
                console.log(cleanText);
            } else {
                console.log('[빈 텍스트]');
            }
        } catch (e) {
            console.log(`[오류] ${e.message}`);
        }
    }
}

main().catch(e => console.error(e.message));
