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
 * [2026-09-01 수정1] 1차 실행: "사고정보" 클릭 타임아웃(오버레이 문제). 페이지
 *   로드만으로 listOLMPData.json 호출 확인 → 본문을 콘솔에 직접 출력하도록 함.
 * [2026-09-01 수정2] 2차 실행: listOLMPData.json 은 "레이어 정의 목록"(가공선로·
 *   해저케이블 등 WMS 레이어 메타데이터)이었고 buoyList.json 은 항로표지(등부표)
 *   좌표였다 — 둘 다 인명사고 데이터가 아니다. page.evaluate() 로 DOM에서 직접
 *   .click() 을 호출하는 방식으로 바꿔 actionability 검사를 우회했지만, 텍스트가
 *   "사고정보"인 요소가 페이지 안에 여러 곳(상단 메뉴·이 화면의 사이드바 카탈로그·
 *   진입 후 breadcrumb)에 있어 첫 번째로 찾은(상단 메뉴) 걸 클릭해 "Element is
 *   not visible"로 계속 실패했다.
 * [2026-09-01 수정3] 사용자가 실제 화면 스크린샷을 캡처해 정확한 경로를 알려줬다 —
 *   상단 메뉴가 아니라 **좌측 "데이터셋" 탭 → "안전" 카테고리 펼치기 → "사고정보"
 *   하위메뉴(화살표로 진입하는 별도 화면) → "선박사고밀도" 섹션 펼치기 → "인명사고
 *   (25년)" 토글**이 진짜 경로다. "사고정보"·"안전" 처럼 페이지에 여러 번 나오는
 *   텍스트는 첫 번째 매치가 아니라 "그 화면에서만 같이 보이는 이웃 텍스트"로
 *   범위를 좁혀야 정확한 요소를 찾을 수 있다(예: "안전"은 "지형/지명"·"항해지원"과
 *   같은 목록에 있는 것만, "사고정보"는 "갯골(상세)"와 같은 목록에 있는 것만).
 *   evalClickScoped() 가 이 방식으로 클릭 대상을 찾는다.
 * [출력] 콘솔 요약(엔드포인트 목록) + local_server/data/khoa_probe_result.json
 *   (호출된 API 목록·샘플 응답 일부) + 스크린샷 5장(단계별 확인용)
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

const KEY_ENDPOINT_HINT = /(listOLMPData|buoyList|accident|person|인명|nshpac)/i;

/** 텍스트를 직접 소유한(자식 텍스트노드 기준) 요소 목록 — {el, text}. */
function collectTextOwners(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const out = [];
    let node;
    while ((node = walker.nextNode())) {
        const own = Array.from(node.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent.trim())
            .join('');
        if (own) out.push({ el: node, text: own });
    }
    return out;
}

/** "target" 이라는 텍스트가 페이지에 여러 번 나올 때, "neighborTexts" 를 전부
 * 같이 갖고 있는 가장 작은 컨테이너 안에서만 target 을 찾아 클릭한다 — 상단
 * 메뉴·사이드바·breadcrumb 처럼 같은 단어가 여러 화면 영역에 나오는 문제를
 * "이웃 문맥"으로 구분한다(2026-09-01, 사용자 스크린샷으로 정확한 경로 확인 후). */
async function evalClickScoped(page, target, neighborTexts, log) {
    try {
        const result = await page.evaluate(({ target, neighborTexts }) => {
            function collectTextOwners(root) {
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
                const out = [];
                let node;
                while ((node = walker.nextNode())) {
                    const own = Array.from(node.childNodes)
                        .filter((n) => n.nodeType === 3)
                        .map((n) => n.textContent.trim())
                        .join('');
                    if (own) out.push({ el: node, text: own });
                }
                return out;
            }
            const all = document.querySelectorAll('*');
            let best = null, bestSize = Infinity;
            for (const el of all) {
                const nodes = collectTextOwners(el);
                const texts = nodes.map((n) => n.text);
                if (neighborTexts.every((t) => texts.some((x) => x.includes(t)))) {
                    const size = el.querySelectorAll('*').length;
                    if (size < bestSize) { bestSize = size; best = el; }
                }
            }
            if (!best) return { ok: false, reason: '이웃 문맥을 만족하는 컨테이너 못 찾음' };
            const nodes = collectTextOwners(best);
            const targetNode = nodes.find((n) => n.text.includes(target));
            if (!targetNode) return { ok: false, reason: '컨테이너 안에서 target 못 찾음' };
            targetNode.el.click();
            return { ok: true };
        }, { target, neighborTexts });
        log.push({ step: `evalClickScoped:"${target}" (이웃:${neighborTexts.join(',')})`, ok: result.ok, reason: result.reason || null });
        return result.ok;
    } catch (e) {
        log.push({ step: `evalClickScoped:"${target}"`, ok: false, reason: String(e.message || e).slice(0, 200) });
        return false;
    }
}

async function evalClickByText(page, text, log) {
    try {
        const clicked = await page.evaluate((needle) => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            let node;
            while ((node = walker.nextNode())) {
                const own = Array.from(node.childNodes)
                    .filter((n) => n.nodeType === 3)
                    .map((n) => n.textContent.trim())
                    .join('');
                if (own.includes(needle)) {
                    node.click();
                    return true;
                }
            }
            return false;
        }, text);
        log.push({ step: `evalClick:"${text}"`, ok: clicked, reason: clicked ? null : '요소 못 찾음' });
        return clicked;
    } catch (e) {
        log.push({ step: `evalClick:"${text}"`, ok: false, reason: String(e.message || e).slice(0, 200) });
        return false;
    }
}

async function dumpVisibleTexts(page, label) {
    try {
        const texts = await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('body *').forEach((el) => {
                if (out.length > 150) return;
                const own = Array.from(el.childNodes)
                    .filter((n) => n.nodeType === 3)
                    .map((n) => n.textContent.trim())
                    .join('');
                if (own && own.length <= 40) out.push(own);
            });
            return out;
        });
        console.log(`[${label} 화면 텍스트 스냅샷] ${JSON.stringify(texts)}`);
    } catch (e) {
        console.log(`[${label} 텍스트 덤프 실패]`, e.message);
    }
}

async function main() {
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();

    const captured = [];
    let watchAllJson = false;
    page.on('response', async (res) => {
        try {
            const url = res.url();
            const headers = res.headers();
            const contentType = headers['content-type'] || '';
            const jsonLike = /json/i.test(contentType);
            if (!isInteresting(url, contentType) && !(watchAllJson && jsonLike)) return;
            const req = res.request();
            const postData = req.postData();
            let bodySample = null;
            try {
                const buf = await res.body();
                bodySample = buf.toString('utf8').slice(0, 1500);
            } catch (_) { /* 바디 못 읽는 응답(리다이렉트 등)은 무시 */ }
            captured.push({
                url, status: res.status(), contentType,
                method: req.method(), postData, bodySample,
            });
            if (KEY_ENDPOINT_HINT.test(url) || (watchAllJson && jsonLike)) {
                console.log(`\n[핵심API${watchAllJson ? '·클릭후' : ''}] ${req.method()} ${url}`);
                console.log('  요청 본문:', (postData || '(없음)').slice(0, 1000));
                console.log('  응답 본문:', (bodySample || '(없음)').slice(0, 3000));
            }
        } catch (_) { /* 개별 응답 실패는 전체 흐름에 영향 없게 무시 */ }
    });

    const clickLog = [];

    console.log('[1/6] 메인 페이지 접속:', TARGET_URL);
    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 60000 }).catch((e) => {
        clickLog.push({ step: 'goto', ok: false, reason: String(e.message || e).slice(0, 300) });
    });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(SHOT_DIR, '1_initial.png'), fullPage: false }).catch(() => {});

    console.log('[2/6] "데이터셋" 탭 진입');
    await evalClickByText(page, '데이터셋', clickLog);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SHOT_DIR, '2_dataset_tab.png'), fullPage: false }).catch(() => {});

    console.log('[3/6] "안전" 카테고리 펼치기 (이웃: 지형/지명·항해지원)');
    await evalClickScoped(page, '안전', ['지형/지명', '항해지원'], clickLog);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '3_safety_category.png'), fullPage: false }).catch(() => {});

    console.log('[4/6] "사고정보" 하위메뉴 진입 (이웃: 갯골(상세)·편의시설)');
    await evalClickScoped(page, '사고정보', ['갯골(상세)', '편의시설'], clickLog);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(SHOT_DIR, '4_accident_info_screen.png'), fullPage: false }).catch(() => {});
    await dumpVisibleTexts(page, '사고정보 화면 진입 직후');

    console.log('[5/6] "선박사고밀도" 섹션 펼치기 (이웃: 선박사고분석)');
    await evalClickScoped(page, '선박사고밀도', ['선박사고분석'], clickLog);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '5_density_section.png'), fullPage: false }).catch(() => {});
    await dumpVisibleTexts(page, '선박사고밀도 펼친 직후');

    console.log('[6/6] "인명사고" 토글 클릭 (이웃: 선박사고(해양)');
    watchAllJson = true;
    await evalClickScoped(page, '인명사고', ['선박사고(해양'], clickLog);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(SHOT_DIR, '6_person_layer_on.png'), fullPage: false }).catch(() => {});

    console.log('추가 대기 후 네트워크 수집 마감');
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
