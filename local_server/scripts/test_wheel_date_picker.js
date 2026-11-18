/**
 * test_wheel_date_picker.js — 날짜칸을 누르면 휠 선택기가 뜨고, 고른 값이 칸에 제대로 들어가는지
 * 실제 브라우저(휴대폰 크기·터치)로 눌러 본다.
 *
 * [왜 있나] 2026-11-18 사용자 요청: 「날짜 선택하는 부분이 현재 캘린더 방식으로 되어있는데
 *   휠 피커로 년월일을 선택할 수 있도록 해줘」. client/js/shared/ui/wheel_date_picker.js 가
 *   앱 전체의 <input type="date">·<input type="datetime-local"> 누름을 가로챈다. 각 화면은
 *   원래 듣던 change 이벤트와 .value("YYYY-MM-DD") 로 값을 받으므로, **그 둘이 원래와 똑같이
 *   오는지**가 핵심이다 — 그래서 소스를 읽지 않고 실제로 눌러 본다.
 *
 * [무엇을 보나]
 *   ① 날짜칸을 누르면 휠이 뜨고, 칸에 readonly 가 붙는다(기본 달력이 안 뜨게)
 *   ② 휠을 굴려 [확인] → 칸 값이 "YYYY-MM-DD" 로 바뀌고 change 가 정확히 1번 온다
 *   ③ [취소]·바깥 누름 → 값도 그대로, change 도 안 온다
 *   ④ 3월 31일에서 2월로 굴리면 일 줄이 28개로 줄고 2월 28일로 들어간다
 *   ⑤ datetime-local 은 시·분 줄까지 5줄, 값은 "YYYY-MM-DDTHH:mm"
 *   ⑥ 원래 readonly·data-native-picker 칸은 건드리지 않는다
 *   ⑦ min·max 를 넘는 값은 그 끝으로 맞춘다
 *   ⑧ 나중에 innerHTML 로 만든 칸(사고정보 기간 팝업처럼)도 동작한다
 *
 * [실행] node local_server/scripts/test_wheel_date_picker.js   (서버 필요 없음)
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → client/js/shared/ui/wheel_date_picker.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../client/js/shared/ui/wheel_date_picker.js'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}

(async () => {
    let chromium = null, pwErr = null;
    for (const mod of ['playwright', 'playwright-core']) {
        try { ({ chromium } = require(mod)); break; } catch (e) { pwErr = e; }
    }
    if (!chromium) {
        console.log('\n⏭️  건너뜀 — playwright 도 playwright-core 도 없다(' + pwErr.message.split('\n')[0] + ').');
        console.log('\n0 PASS / 0 FAIL (SKIPPED: playwright 없음)');
        return;
    }
    const cand = [];
    if (process.env.PW_CHROME) cand.push(process.env.PW_CHROME);
    try { cand.push(chromium.executablePath()); } catch (_) { /* 판을 모르면 건너뛴다 */ }
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) cand.push(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'));
    const exe = cand.find(c => { try { return c && fs.existsSync(c); } catch (_) { return false; } });
    let browser;
    try { browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox'] }); }
    catch (e) {
        console.log('\n⏭️  건너뜀 — 브라우저를 못 띄웠다(' + e.message + ').');
        console.log('\n0 PASS / 0 FAIL (SKIPPED: 브라우저 없음)');
        return;
    }

    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(`<!doctype html><html><body style="background:#000">
        <input type="date" id="d1" value="2025-06-15">
        <input type="date" id="d2" value="2026-03-31">
        <input type="datetime-local" id="dt" value="2026-11-18T09:05">
        <input type="date" id="ro" value="2026-01-01" readonly>
        <input type="date" id="nat" value="2026-01-01" data-native-picker>
        <input type="date" id="mm" value="2026-05-10" min="2026-05-01" max="2026-05-20">
        <div id="dyn"></div>
        <script>window.__chg = {};
          document.addEventListener('change', e => { window.__chg[e.target.id] = (window.__chg[e.target.id] || 0) + 1; });
        </script></body></html>`);
    await page.addScriptTag({ content: SRC });

    const isOpen = () => page.evaluate(() => !!document.getElementById('wdp-overlay'));
    const waitClosed = () => page.waitForFunction(() => !document.getElementById('wdp-overlay'), null, { timeout: 2000 });
    // 한 줄을 n칸 굴린다(지금 칸 기준). 멈춘 뒤 값 확정(120ms)을 기다린다.
    async function roll(key, n) {
        await page.evaluate(([k, n]) => {
            const el = document.querySelector('#wdp-overlay .wdp-col[data-key="' + k + '"]');
            el.scrollTop = el.scrollTop + n * 40;
        }, [key, n]);
        await page.waitForTimeout(400);
    }
    const title = () => page.textContent('#wdp-overlay .wdp-title');
    const val = id => page.inputValue('#' + id);
    const chg = id => page.evaluate(i => window.__chg[i] || 0, id);

    console.log('① 누르면 휠이 뜬다');
    await page.tap('#d1');
    await page.waitForSelector('#wdp-overlay.show');
    ok('휠 선택기가 떴다', await isOpen());
    ok('칸에 readonly 가 붙었다(기본 달력 차단)', await page.evaluate(() => document.getElementById('d1').readOnly));
    ok('줄이 3개(년·월·일)', (await page.$$('#wdp-overlay .wdp-col')).length === 3);
    ok('머리줄이 지금 값·요일을 보여 준다', (await title()) === '2025년 6월 15일 (일)', await title());

    console.log('② 굴려서 확인');
    await roll('y', 1); await roll('m', -2); await roll('d', 3);
    ok('머리줄이 굴린 값으로 바뀐다', (await title()) === '2026년 4월 18일 (토)', await title());
    await page.tap('#wdp-overlay .wdp-btn.ok');
    await waitClosed();
    ok('값이 2026-04-18', (await val('d1')) === '2026-04-18', await val('d1'));
    ok('change 가 1번 왔다', (await chg('d1')) === 1, await chg('d1'));

    console.log('③ 취소·바깥 누름은 아무것도 안 바꾼다');
    await page.tap('#d1'); await page.waitForSelector('#wdp-overlay.show');
    await roll('y', -3);
    await page.tap('#wdp-overlay .wdp-btn.cancel'); await waitClosed();
    ok('취소 — 값 그대로', (await val('d1')) === '2026-04-18', await val('d1'));
    await page.tap('#d1'); await page.waitForSelector('#wdp-overlay.show');
    await roll('m', 2);
    await page.mouse.click(195, 50); await waitClosed();
    ok('바깥 누름 — 값 그대로', (await val('d1')) === '2026-04-18', await val('d1'));
    ok('change 는 여전히 1번', (await chg('d1')) === 1, await chg('d1'));
    await page.tap('#d1'); await page.waitForSelector('#wdp-overlay.show');
    await page.tap('#wdp-overlay .wdp-btn.ok'); await waitClosed();
    ok('안 굴리고 확인 — change 가 오지 않는다(값이 같으니)', (await chg('d1')) === 1, await chg('d1'));

    console.log('④ 3월 31일 → 2월');
    await page.tap('#d2'); await page.waitForSelector('#wdp-overlay.show');
    await roll('m', -1);
    const nDays = await page.evaluate(() => document.querySelectorAll('#wdp-overlay .wdp-col[data-key="d"] .wdp-item').length);
    ok('일 줄이 28개로 줄었다', nDays === 28, nDays);
    await page.tap('#wdp-overlay .wdp-btn.ok'); await waitClosed();
    ok('값이 2026-02-28', (await val('d2')) === '2026-02-28', await val('d2'));

    console.log('⑤ 날짜시각칸');
    await page.tap('#dt'); await page.waitForSelector('#wdp-overlay.show');
    ok('줄이 5개(년·월·일·시·분)', (await page.$$('#wdp-overlay .wdp-col')).length === 5);
    ok('머리줄에 시각', (await title()) === '2026년 11월 18일 (수) 09:05', await title());
    await roll('h', 5); await roll('mi', 10);
    await page.tap('#wdp-overlay .wdp-btn.ok'); await waitClosed();
    ok('값이 2026-11-18T14:15', (await val('dt')) === '2026-11-18T14:15', await val('dt'));

    console.log('⑥ 손대지 않는 칸');
    await page.tap('#ro'); await page.waitForTimeout(300);
    ok('원래 readonly 칸은 휠을 열지 않는다', !(await isOpen()));
    await page.tap('#nat'); await page.waitForTimeout(300);
    ok('data-native-picker 칸은 휠을 열지 않는다', !(await isOpen()));
    ok('data-native-picker 칸에 readonly 를 붙이지 않았다', !(await page.evaluate(() => document.getElementById('nat').readOnly)));

    console.log('⑦ min·max');
    await page.tap('#mm'); await page.waitForSelector('#wdp-overlay.show');
    ok('min·max 가 같은 해면 년 줄은 1개', (await page.$$('#wdp-overlay .wdp-col[data-key="y"] .wdp-item')).length === 1);
    await roll('d', 15);
    await page.tap('#wdp-overlay .wdp-btn.ok'); await waitClosed();
    ok('max 를 넘으면 2026-05-20 으로', (await val('mm')) === '2026-05-20', await val('mm'));

    console.log('⑧ 나중에 만든 칸');
    await page.evaluate(() => {
        document.getElementById('dyn').innerHTML = '<input type="date" id="late" value="2024-12-31">';
        document.getElementById('late').addEventListener('change', e => { window.__late = e.target.value; });
    });
    await page.tap('#late'); await page.waitForSelector('#wdp-overlay.show');
    await roll('d', -30);
    await page.tap('#wdp-overlay .wdp-btn.ok'); await waitClosed();
    ok('innerHTML 로 만든 칸도 change 로 값을 받는다', (await page.evaluate(() => window.__late)) === '2024-12-01',
        await page.evaluate(() => window.__late));

    ok('페이지 오류 없음', errors.length === 0, errors);
    await browser.close();
    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('  ❌ 실행 오류 — ' + e.message); console.log('\n' + pass + ' PASS / ' + (fail + 1) + ' FAIL'); process.exitCode = 1; });
