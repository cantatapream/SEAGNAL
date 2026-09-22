/**
 * ============================================================================
 * 파일명: scripts/refactor/simulate.js
 * 역할  : [V4 구동 무결성] 헤드리스 Chromium 으로 앱을 실제 로드·주행하여
 *         (1) 콘솔 에러 (2) 네트워크 404 (3) 전역 함수 인벤토리
 *         (4) 탭 전환 시나리오 결과를 수집한다.
 *         --baseline : 결과를 기준선으로 저장
 *         (없으면)   : 기준선과 비교 — "기준선에 없던 문제"만 회귀로 판정
 * 사용  : node local_server/server.js &   (서버 선기동, PORT 3001)
 *         node scripts/refactor/simulate.js --baseline
 *         node scripts/refactor/simulate.js
 * [연계] baseline/simulate_baseline.json (기준선), check_paths/check_order (V2·V3)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const URL_BASE = process.env.SIM_URL || 'http://localhost:3001';
const SNAP = path.join(__dirname, 'baseline', 'simulate_baseline.json');
const IS_BASELINE = process.argv.includes('--baseline');

// 시나리오: 메인탭 4개 + 해양생활 서브탭 순회 (data-target 기준 — 마크업과 결합)
const MAIN_TABS = ['weather-group', 'ocean-map-section', 'ocean-life-group', 'promo-section'];
const LIFE_SUBTABS = ['fishing-section', 'surfing-section', 'swimming-section',
    'scuba-section', 'mudflat-section', 'sea-parting-section'];

/**
 * 크로미움 실행 파일을 **환경에게 묻는다**. 여기에 경로를 박으면 그 컴퓨터 밖에서는 안 돈다.
 *
 * ⚠2026-09-22 (G-33) — 여기는 `executablePath: '/opt/pw-browsers/chromium'` 이 박혀 있었다.
 *   그 경로는 **이 개발 컨테이너에만** 있어서, 깃허브 CI 에서는 `npx playwright install` 로
 *   브라우저를 제대로 깔아 놓고도 V4 가 매번 죽었다 —
 *     `Failed to launch chromium because executable doesn't exist at /opt/pw-browsers/chromium`
 *   G-31(게이트 7개의 절대경로)과 **같은 병의 네 번째**다.
 *
 * 그런데 로컬은 기본 해석만으로는 안 된다 — `playwright-core` 가 가리키는 판(chromium-1243)과
 * 실제로 깔린 판(chromium-1194)이 달라서, 기본 경로는 **있지도 않은 파일**을 가리킨다.
 * 그래서 「묻고, 없으면 다음」 순서로 고른다. 어느 쪽도 못 찾으면 경로를 주지 않고
 * playwright 자신의 안내 문구가 나오게 둔다(우리가 지어낸 말보다 그쪽이 정확하다).
 *   ① SIM_CHROMIUM 환경변수 (사람이 직접 지정)
 *   ② playwright 가 스스로 아는 경로 — **실제로 파일이 있을 때만**
 *   ③ PLAYWRIGHT_BROWSERS_PATH/chromium — 브라우저 폴더를 환경이 알려 준 경우
 *
 * ⚠③도 **경로를 박지 않는다.** 환경변수가 가리키는 폴더에서 이름만 붙인다 —
 *   경로 문자열을 코드에 적는 순간 그것이 다시 G-31·G-33 이 된다(V2-b 가 잡는다).
 * @returns {string|undefined} 실행 파일 경로(없으면 undefined)
 */
function resolveChromium() {
    const cand = [];
    if (process.env.SIM_CHROMIUM) cand.push(process.env.SIM_CHROMIUM);
    try { cand.push(chromium.executablePath()); } catch (_) { /* 판을 모르면 건너뛴다 */ }
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
        cand.push(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'));
    }
    for (const c of cand) {
        try { if (c && fs.existsSync(c)) return c; } catch (_) { /* 접근 불가면 다음 */ }
    }
    return undefined;
}

(async () => {
    const exePath = resolveChromium();
    console.log(`[simulate] 크로미움: ${exePath || '(playwright 기본 해석에 맡김)'}`);
    const browser = await chromium.launch({ ...(exePath ? { executablePath: exePath } : {}), headless: true });
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } }); // 모바일 비율

    const consoleErrors = [];
    const failed404 = [];
    // ⚠5xx 는 **어느 주소가** 났는지 적어 둔다 (2026-09-22, G-35).
    //   종전에는 브라우저 콘솔 문구(`… status of 500 (Internal Server Error)`)만 남아
    //   **어느 엔드포인트인지 알 수 없었다.** 한 번 뜨면 그때마다 사람이 다시 재현해야 했다
    //   (실제로 이번에 그랬고, 다시 돌리니 안 났다 — 그러면 원인을 영영 모른다).
    //   회귀 판정에는 쓰지 않는다(콘솔 에러 쪽이 이미 잡는다). **진단을 위해 남길 뿐이다.**
    const server5xx = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + String(err).slice(0, 300)));
    // ⚠404 는 **왜** 404 인지까지 봐야 한다 (2026-09-22, G-35).
    //   깃허브 CI 에서 V4 가 처음으로 실제로 돌자 404 세 개가 나왔다 —
    //   `/api/marine-zone-forecasts`·`/api/regional-forecast`·`/api/weather-alerts`.
    //   코드가 깨진 것이 아니라 **그 응답을 만들 자료 파일이 그 환경에 없어서**다
    //   (`routes/weather.js` 가 `fs.existsSync` 로 확인하고 `{"error":"… not found"}` 를 준다.
    //    그 파일들은 API 키가 있어야 수집기가 만든다 — CI 에는 키가 비어 있다).
    //   `verify_all.sh` 의 HTTP 스모크도 같은 이유로 `/api/weather-alerts` 를 건너뛴다.
    //   ★그래서 **본문을 읽어 갈래를 나눈다.** 다른 이유의 404 는 종전대로 회귀로 잡는다 —
    //     넓게 봐주면 진짜 404 회귀까지 같이 묻힌다.
    const missingData = new Set();
    // ⚠본문 읽기는 **비동기**다. 판정 전에 반드시 기다려야 한다 (2026-09-22, G-38).
    //   처음에는 `.then()` 으로 담아 두고 판정은 그냥 읽었다 — 그랬더니 CI 에서
    //   404 네 건 중 **세 건만 갈리고 한 건이 남았다**(run #55). 코드가 틀린 게 아니라
    //   **아직 안 끝난 것**을 다 끝난 셈 치고 읽은 것이다. 경쟁 상태는 "가끔 맞는" 버그라
    //   더 고약하다 — 세 번은 맞고 한 번은 틀린다.
    const bodyReads = [];
    // ★갈래를 **못** 나눴으면 그 까닭을 남긴다 (2026-09-22, G-40).
    //   run #64 에서 404 다섯 건 중 셋만 「자료 부재」로 갈리고 `/api/buoys`·
    //   `/api/marine-zone-forecasts` 둘은 ❌ 로 남았다. 두 라우트 모두 코드상으로는
    //   `{"error":"데이터 준비 중"}` 을 돌려주는데도 그랬다 — 즉 **본문을 못 읽었거나
    //   다른 것이 왔다**. 그런데 그때 게이트가 찍은 것은 주소뿐이라 **어느 쪽인지 알 길이
    //   없었다.** 판정을 내리는 자리가 그 판정의 근거를 함께 적지 않으면, 읽는 사람은
    //   넘겨짚는 수밖에 없다(G-28·G-32·G-39 와 같은 마디).
    const notAbsentWhy = new Map();
    const method404 = new Map(); // 주소 → HTTP 메서드 (G-41 의 재요청 판단용)
    /**
     * 그 404 가 **「길이 없다」인가 「자료가 없다」인가**.
     * ⚠말 목록으로 가르지 않는다 — 처음에는 `not found` 문구로 갈랐는데, 같은 뜻을 한국어로
     *   적은 엔드포인트(`{"error":"데이터 준비 중"}`)를 놓쳤다(CI run #46 에서 실측).
     *   **모양으로 가른다**: 그 자리에 라우트가 있고 스스로 `{"error": …}` 를 돌려주면
     *   그것은 서버가 "지금 줄 자료가 없다"고 말하는 것이다. 라우트·정적 파일이 **사라져서**
     *   나는 404 는 JSON 이 아니라 HTML 이나 빈 본문이라 여기 안 걸리고, 종전대로 회귀로 잡힌다.
     * @param {string} body - 404 응답 본문
     * @returns {boolean} 자료 부재면 true
     */
    function isDataAbsent(body) {
        try {
            const j = JSON.parse(body);
            return !!j && typeof j === 'object' && (typeof j.error === 'string' || typeof j.message === 'string');
        } catch (_) { return false; }
    }
    page.on('response', (res) => {
        if (res.status() >= 500 && res.url().startsWith(URL_BASE)) {
            const at = server5xx.length;
            server5xx.push(res.status() + ' ' + res.url().replace(URL_BASE, ''));
            // ★5xx 도 **왜인지**를 함께 남긴다(G-42) — 404 에 한 것과 같은 마디(G-40).
            //   주소만 찍혀 있어서 khoa-wms 500 의 원인을 세 번 넘겨짚었고 세 번 다 재현에 실패했다.
            //   우리 라우트는 `proxy error: <까닭>` 을 본문에 담는다(routes/ocean1.js).
            bodyReads.push(res.text()
                .then((b) => {
                    const head = String(b == null ? '' : b).replace(/\s+/g, ' ').slice(0, 160);
                    if (head) server5xx[at] += '\n          ↳ ' + head;
                })
                .catch(() => { server5xx[at] += '\n          ↳ (본문을 못 읽었다)'; }));
        }
        if (res.status() !== 404 || !res.url().startsWith(URL_BASE)) return;
        const p = res.url().replace(URL_BASE, '');
        failed404.push(p);
        // 재요청은 **GET 만** 한다(G-41 아래). 메서드를 여기서 적어 둔다.
        try { method404.set(p, res.request().method()); } catch (_) { /* 못 읽으면 재요청 안 한다 */ }
        bodyReads.push(res.text()
            .then((b) => {
                if (isDataAbsent(b)) { missingData.add(p); return; }
                const head = String(b == null ? '' : b).replace(/\s+/g, ' ').slice(0, 120);
                notAbsentWhy.set(p, `본문이 {error|message} 꼴이 아니다 (${String(b || '').length}바이트): ${JSON.stringify(head)}`);
            })
            // 본문을 못 읽으면 갈래를 못 나눈다 — 종전대로 회귀로 본다. 다만 **왜 못 읽었는지는 남긴다.**
            .catch((e) => { notAbsentWhy.set(p, '본문을 못 읽었다: ' + ((e && e.message) || String(e))); }));
    });

    console.log(`[simulate] 접속: ${URL_BASE}/`);
    await page.goto(URL_BASE + '/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(12000); // 초기 데이터 로드·렌더 대기

    // (3) 전역 함수 인벤토리 — 앱이 window 에 노출한 함수들 (브라우저 기본 제외)
    const globals = await page.evaluate(() => {
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        const native = new Set(Object.getOwnPropertyNames(iframe.contentWindow));
        iframe.remove();
        return Object.getOwnPropertyNames(window)
            .filter((k) => !native.has(k) && typeof window[k] === 'function')
            .sort();
    });

    // (4) 시나리오 주행
    const scenarios = [];
    async function clickTab(target, label) {
        try {
            // 좌표 클릭이 아닌 요소 직접 click() 디스패치 — 지도형 섹션의 플로팅
            // 컨트롤이 버튼 좌표를 덮어도 탭 전환 로직 자체를 정확히 검증하기 위함
            // (이 도구의 목적은 픽셀 히트테스트가 아니라 JS 로직·전역 함수 무결성)
            const clicked = await page.evaluate((t) => {
                const el = document.querySelector(`button[data-target="${t}"]`);
                if (!el) return false;
                el.click();
                return true;
            }, target);
            if (!clicked) throw new Error('버튼 없음: ' + target);
            // 판정은 탭 시스템의 active 클래스 기준. 지도형 섹션은 초기화가
            // 무거워 활성화가 늦을 수 있으므로 고정 대기 대신 최대 10초 폴링
            let visible = false;
            try {
                await page.waitForFunction((t) => {
                    // 그룹 탭은 눌러도 그룹 자체가 아니라 그 안의 섹션이 켜진다 → 어떤 섹션이
                    //   켜지면 성공으로 볼지 적어 둔다. 여러 개인 것은 화면 전환 과정에서
                    //   둘 중 하나가 켜질 수 있기 때문이다.
                    // [2026-09-10] 'ocean-life-group' 기대값 정정 — 해양안전생활이 정식 탭이
                    //   되면서 이 그룹은 'fishing-section'(바다낚시)이 아니라 해양안전 화면을
                    //   먼저 연다. 그 화면은 자리표시 섹션(ocean-safety-section)을 잠깐 켰다가
                    //   해양종합정보 지도 섹션(ocean-map-section)을 빌려 쓰므로 둘 다 인정한다
                    //   (life_safety.js _enterSafety). 이 줄을 안 고치면 멀쩡한 화면이
                    //   "깨진 시나리오"로 잡힌다.
                    const groupMap = {
                        'weather-group': ['weather-alert-section'],
                        'ocean-life-group': ['ocean-map-section', 'ocean-safety-section']
                    };
                    const ids = groupMap[t] || [t];
                    return ids.some((id) => {
                        const el = document.getElementById(id);
                        return !!el && el.classList.contains('active');
                    });
                }, target, { timeout: 10000 });
                visible = true;
            } catch (_e) { /* 10초 내 활성화 안 됨 → 실패로 기록 */ }
            await page.waitForTimeout(1000);
            scenarios.push({ label, target, ok: visible });
        } catch (e) {
            scenarios.push({ label, target, ok: false, error: String(e).slice(0, 150) });
        }
    }
    for (const t of MAIN_TABS) await clickTab(t, `메인탭:${t}`);
    // ⚠라벨은 기준선(baseline)과 대조하는 **키**라 바꾸지 않는다. 이름을 바꾸면 기준선에서
    //   짝을 못 찾아 그 시나리오가 조용히 통과 처리된다(검사가 약해진다).
    //   화면상의 이름은 2026-09-10 부터 "해양안전생활" 이다.
    await clickTab('ocean-life-group', '메인탭 재진입:해양생활');
    for (const t of LIFE_SUBTABS) await clickTab(t, `서브탭:${t}`);

    // ★판정 전에 404 본문 읽기를 **다 기다린다**(G-38).
    //   ⚠그런데 `Promise.all(bodyReads)` 는 **그 순간의 배열**만 본다. 기다리는 동안 새 404 가
    //     들어오면 그 읽기는 아무도 안 기다리고, 곧바로 `browser.close()` 가 돌아
    //     `response.text: Target page, context or browser has been closed` 로 깨진다.
    //     CI run #68 이 바로 그 문구를 찍었다 — G-40 이 까닭을 적게 해 둔 덕에 알았다.
    //   그래서 **배열이 안 늘 때까지** 되풀이한다(G-41).
    {
        const deadline = Date.now() + 15000;
        let prev = -1;
        while (bodyReads.length !== prev && Date.now() < deadline) {
            prev = bodyReads.length;
            await Promise.race([
                Promise.all(bodyReads.slice()),
                new Promise((r) => setTimeout(r, 3000)),
            ]);
        }
    }

    await browser.close();

    // ★그래도 못 읽은 404 는 **Node 가 직접 한 번 더 받아 본다**(G-41).
    //   브라우저 버퍼는 페이지가 닫히면 사라지지만, 우리 서버는 여기 그대로 있다.
    //   이러면 타이밍에 기대지 않고 **본문 모양으로** 갈릴 수 있다(G-36 의 잣대를 그대로 쓴다).
    //   ⚠GET 만 다시 부른다 — 다른 메서드는 다시 부르면 서버 상태를 바꿀 수 있다.
    //   ⚠재요청 결과가 404 가 아니면(그 사이 자료가 준비됐거나 주소가 살아 있으면) 봐주지 않는다.
    for (const q of [...new Set(failed404)]) {
        if (missingData.has(q)) continue;
        if (!/본문을 못 읽었다/.test(notAbsentWhy.get(q) || '')) continue;
        if ((method404.get(q) || 'GET') !== 'GET') { notAbsentWhy.set(q, (notAbsentWhy.get(q) || '') + ' (GET 이 아니라 다시 부르지 않았다)'); continue; }
        try {
            const r = await fetch(URL_BASE + q);
            const b = await r.text();
            if (r.status === 404 && isDataAbsent(b)) { missingData.add(q); notAbsentWhy.delete(q); continue; }
            const head = String(b == null ? '' : b).replace(/\s+/g, ' ').slice(0, 120);
            notAbsentWhy.set(q, `브라우저에서 못 읽어 Node 가 다시 받았다 → ${r.status} · ${JSON.stringify(head)}`);
        } catch (e) {
            notAbsentWhy.set(q, '본문을 못 읽었고 Node 재요청도 실패했다: ' + ((e && e.message) || String(e)));
        }
    }

    const result = {
        url: URL_BASE,
        consoleErrors: [...new Set(consoleErrors)].sort(),
        failed404: [...new Set(failed404)].sort(),
        globalFunctions: globals,
        scenarios,
    };

    if (IS_BASELINE) {
        fs.mkdirSync(path.dirname(SNAP), { recursive: true });
        fs.writeFileSync(SNAP, JSON.stringify(result, null, 2));
        console.log(`[simulate] ✅ 기준선 저장 — 콘솔에러 ${result.consoleErrors.length} · 404 ${result.failed404.length} · 전역함수 ${globals.length} · 시나리오 ${scenarios.filter((s) => s.ok).length}/${scenarios.length} 통과`);
        scenarios.filter((s) => !s.ok).forEach((s) => console.log(`  ⚠ 기준선에서 실패한 시나리오: ${s.label}`));
        return;
    }

    // ── 기준선 비교: "기준선에 없던 문제"만 회귀 ──
    const base = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
    const newErrors = result.consoleErrors.filter((e) => !base.consoleErrors.includes(e));
    const new404 = result.failed404.filter((e) => !base.failed404.includes(e));
    const lostGlobals = base.globalFunctions.filter((g) => !result.globalFunctions.includes(g));
    const brokenScenarios = result.scenarios.filter((s) => {
        const b = base.scenarios.find((x) => x.label === s.label);
        return b && b.ok && !s.ok; // 기준선에서 되던 것이 안 되면 회귀
    });

    // ★「자료 파일이 없어서 나는 404」는 회귀가 아니다 — 다만 **숨기지는 않는다**(G-34 의 교훈).
    const envMiss = new404.filter((e) => missingData.has(e));
    const real404 = new404.filter((e) => !missingData.has(e));

    // 콘솔 에러 중에도 **환경 탓인 것**이 있다. 두 가지뿐이고, 둘 다 이유가 분명하다.
    //   ⓐ `… status of 404 (Not Found)` — 위 envMiss 가 브라우저 콘솔에 되비친 것이다.
    //      ⚠진짜 404 가 하나라도 있으면 이 줄이 그것 때문일 수도 있으므로 **빼지 않는다**.
    //   ⓑ `ERR_CERT_AUTHORITY_INVALID` — 개발 컨테이너의 에이전트 프록시 CA 탓이다.
    //      깃허브·운영에는 그 프록시가 없다(거기서 나면 그때는 진짜다 — 그래서 아래처럼
    //      **프록시가 켜져 있을 때만** 뺀다).
    const behindProxy = !!(process.env.HTTPS_PROXY || process.env.https_proxy);
    const envErrRe = [];
    if (envMiss.length && !real404.length) envErrRe.push(/status of 404 \(Not Found\)/i);
    if (behindProxy) envErrRe.push(/ERR_CERT_AUTHORITY_INVALID/i);
    const envErrors = newErrors.filter((e) => envErrRe.some((r) => r.test(e)));
    const realErrors = newErrors.filter((e) => !envErrRe.some((r) => r.test(e)));

    console.log(`[simulate] 신규 콘솔에러 ${realErrors.length}(+환경 ${envErrors.length}) · 신규 404 ${real404.length}(+자료부재 ${envMiss.length}) · 사라진 전역함수 ${lostGlobals.length} · 깨진 시나리오 ${brokenScenarios.length}`);
    let fail = false;
    if (envErrors.length) {
        console.log(`  ⏭️  환경 탓인 콘솔 에러 ${envErrors.length}건 — 회귀로 세지 않는다`);
        envErrors.forEach((e) => console.log('    - ' + e));
    }
    if (realErrors.length) {
        fail = true; console.error('  ❌ 신규 콘솔 에러:'); realErrors.slice(0, 10).forEach((e) => console.error('    - ' + e));
        // 콘솔 문구만으로는 어느 주소인지 모른다 — 우리가 따로 적어 둔 5xx 목록을 함께 준다.
        if (server5xx.length) {
            console.error('  ↳ 이번 주행에서 5xx 를 낸 주소:');
            [...new Set(server5xx)].forEach((e) => console.error('      ' + e));
        }
    }
    if (envMiss.length) {
        console.log(`  ⏭️  자료 파일이 없어 나는 404 ${envMiss.length}건 — 회귀로 세지 않는다(이 환경에 그 JSON 이 없다)`);
        envMiss.forEach((e) => console.log('    - ' + e));
    }
    if (real404.length) {
        fail = true; console.error('  ❌ 신규 404:');
        // ⚠주소만 찍지 않는다 — **왜 「자료 부재」로 안 갈렸는지**를 나란히 적는다(G-40).
        real404.slice(0, 20).forEach((e) => console.error(
            '    - ' + e + '\n        ↳ ' + (notAbsentWhy.get(e) || '본문 읽기가 제한시간(5초) 안에 안 끝났다')));
    }
    if (lostGlobals.length) { fail = true; console.error('  ❌ 사라진 전역 함수:'); lostGlobals.slice(0, 20).forEach((e) => console.error('    - ' + e)); }
    if (brokenScenarios.length) { fail = true; console.error('  ❌ 깨진 시나리오:'); brokenScenarios.forEach((s) => console.error('    - ' + s.label)); }

    if (fail) process.exit(1);
    console.log('[simulate] ✅ 통과 — 기준선 대비 회귀 없음');
})().catch((e) => { console.error('[simulate] 실행 실패:', e); process.exit(2); });
