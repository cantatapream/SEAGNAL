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

(async () => {
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } }); // 모바일 비율

    const consoleErrors = [];
    const failed404 = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + String(err).slice(0, 300)));
    page.on('response', (res) => {
        if (res.status() === 404 && res.url().startsWith(URL_BASE)) {
            failed404.push(res.url().replace(URL_BASE, ''));
        }
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

    await browser.close();

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

    console.log(`[simulate] 신규 콘솔에러 ${newErrors.length} · 신규 404 ${new404.length} · 사라진 전역함수 ${lostGlobals.length} · 깨진 시나리오 ${brokenScenarios.length}`);
    let fail = false;
    if (newErrors.length) { fail = true; console.error('  ❌ 신규 콘솔 에러:'); newErrors.slice(0, 10).forEach((e) => console.error('    - ' + e)); }
    if (new404.length) { fail = true; console.error('  ❌ 신규 404:'); new404.slice(0, 20).forEach((e) => console.error('    - ' + e)); }
    if (lostGlobals.length) { fail = true; console.error('  ❌ 사라진 전역 함수:'); lostGlobals.slice(0, 20).forEach((e) => console.error('    - ' + e)); }
    if (brokenScenarios.length) { fail = true; console.error('  ❌ 깨진 시나리오:'); brokenScenarios.forEach((s) => console.error('    - ' + s.label)); }

    if (fail) process.exit(1);
    console.log('[simulate] ✅ 통과 — 기준선 대비 회귀 없음');
})().catch((e) => { console.error('[simulate] 실행 실패:', e); process.exit(2); });
