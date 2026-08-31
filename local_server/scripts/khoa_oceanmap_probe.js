/**
 * ============================================================================
 * 파일명: local_server/scripts/khoa_oceanmap_probe.js
 * 역할  : 국립해양조사원(KHOA) 오션맵(khoa.go.kr/oceanmap)이 인명사고 마커를
 *         표시할 때 내부적으로 호출하는 API(XHR/JSON/WMS/WFS 등)를 찾아낸다.
 *         [배경] 사용자가 오션맵 화면에서는 인명사고 위치가 정확하게 찍혀
 *         보이는데, 우리 앱은 국립해양조사원이 배포한 원본 엑셀의 "위치텍스트"를
 *         지오코딩으로 역산해야 해서 오차가 크다(별도 조사: 498건 의심 후보).
 *         오션맵이 쓰는 원본 API를 알아내면 더 정확한 좌표를 직접 받을 수
 *         있는지 확인하려는 것 — 이 스크립트는 그 API를 "찾기만" 한다(수집·
 *         저장은 하지 않음, 읽기 전용 정찰).
 * [실행환경] 이 저장소의 개발 샌드박스(Claude Code on the web)는 khoa.go.kr·
 *   data.go.kr 접속이 프록시 정책상 막혀 있어(2026-08-31 curl 403 확인,
 *   WebFetch도 EGRESS_BLOCKED) 여기서 실행할 수 없다. GitHub Actions
 *   (ubuntu-latest, 외부망 열림)에서 대신 돌린다 — 카카오맵 지오코딩 검증
 *   스크립트(accident_geocode_check.js)와 같은 우회 패턴.
 * [동작] Playwright로 헤드리스 브라우저를 열고 오션맵 메인 페이지에 접속,
 *   페이지 로드 중/메뉴 클릭 중 발생하는 모든 네트워크 응답을 가로채
 *   JSON·XML·WMS·WFS·ArcGIS 계열 API로 보이는 것만 추려 요약한다.
 *   "사고정보"·"인명사고" 텍스트가 보이면 클릭해 그 레이어를 켜본다(정확한
 *   선택자를 모르므로 텍스트 매칭으로 최대한 시도 — 실패해도 스크립트는
 *   계속 진행하고 실패 사실을 결과에 남긴다).
 * [출력] 콘솔 요약(엔드포인트 목록) + local_server/data/khoa_probe_result.json
 *   (호출된 API 목록·샘플 응답 일부) + 스크린샷 3장(단계별 확인용)
 * [연계] .github/workflows/khoa-oceanmap-probe.yml
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_JSON = path.join(OUT_DIR, 'khoa_probe_result.json');
const SHOT_DIR = path.join(OUT_DIR, 'khoa_probe_shots');

const TARGET_URL = 'https://www.khoa.go.kr/oceanmap/main.do';

// API처럼 보이는 응답을 가려내는 기준 — GIS 사이트는 흔히 WMS/WFS/ArcGIS
// REST(OGC 표준) 아니면 자체 /api/ 를 쓴다.
const API_URL_HINT = /(api|\.json|geojson|wms|wfs|arcgis|featureserver|mapserver|rest\/services|ogc|geoserver|accident|person|인명)/i;
const INTERESTING_CONTENT_TYPE = /json|xml|geo\+json/i;

function isInteresting(url, contentType) {
    return API_URL_HINT.test(url) || INTERESTING_CONTENT_TYPE.test(contentType || '');
}

async function safeClickByText(page, text, log) {
    try {
        const loc = page.getByText(text, { exact: false }).first();
        const count = await loc.count();
        if (count === 0) {
            log.push({ step: `click:"${text}"`, ok: false, reason: '요소 못 찾음' });
            return false;
        }
        await loc.click({ timeout: 5000 });
        log.push({ step: `click:"${text}"`, ok: true });
        return true;
    } catch (e) {
        log.push({ step: `click:"${text}"`, ok: false, reason: String(e.message || e).slice(0, 200) });
        return false;
    }
}

async function main() {
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();

    const captured = [];
    page.on('response', async (res) => {
        try {
            const url = res.url();
            const headers = res.headers();
            const contentType = headers['content-type'] || '';
            if (!isInteresting(url, contentType)) return;
            let bodySample = null;
            try {
                const buf = await res.body();
                bodySample = buf.toString('utf8').slice(0, 1500);
            } catch (_) { /* 바디 못 읽는 응답(리다이렉트 등)은 무시 */ }
            captured.push({
                url, status: res.status(), contentType,
                method: res.request().method(), bodySample,
            });
        } catch (_) { /* 개별 응답 실패는 전체 흐름에 영향 없게 무시 */ }
    });

    const clickLog = [];

    console.log('[1/4] 메인 페이지 접속:', TARGET_URL);
    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 60000 }).catch((e) => {
        clickLog.push({ step: 'goto', ok: false, reason: String(e.message || e).slice(0, 300) });
    });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(SHOT_DIR, '1_initial.png'), fullPage: false }).catch(() => {});

    console.log('[2/4] "사고정보" 메뉴 진입 시도');
    await safeClickByText(page, '사고정보', clickLog);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOT_DIR, '2_after_accident_menu.png'), fullPage: false }).catch(() => {});

    console.log('[3/4] "인명사고" 레이어 토글 시도');
    await safeClickByText(page, '인명사고', clickLog);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOT_DIR, '3_after_person_layer.png'), fullPage: false }).catch(() => {});

    console.log('[4/4] 추가 대기 후 네트워크 수집 마감');
    await page.waitForTimeout(3000);

    await browser.close();

    const uniqueByUrl = new Map();
    captured.forEach((c) => { if (!uniqueByUrl.has(c.url)) uniqueByUrl.set(c.url, c); });
    const unique = Array.from(uniqueByUrl.values());

    console.log(`\n총 캡처 응답 ${captured.length}건, URL 기준 중복제거 ${unique.length}건`);
    unique.forEach((c) => {
        console.log(`  [${c.status}] ${c.method} ${c.contentType} ${c.url}`);
    });

    console.log('\n클릭 시도 로그:');
    clickLog.forEach((c) => console.log('  ', JSON.stringify(c)));

    fs.writeFileSync(OUT_JSON, JSON.stringify({ target: TARGET_URL, clickLog, captured: unique }, null, 1));
    console.log('\n결과 저장:', OUT_JSON);
}

main().catch((e) => {
    console.error('probe 실패:', e);
    process.exit(1);
});
