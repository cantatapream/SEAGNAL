/**
 * ============================================================================
 * 파일명: local_server/scripts/test_pc_layout_ui.js
 * 역할  : PC 화면(A안 · 지도 중심형 — client/js/pc-layout/)을 실제 크로뮴으로 켜고 끄고 재 본다.
 *         (초보자용: 넓은 PC 창에서 「해양종합정보」 탭을 10번 누르면 PC 배치로 바뀌고, 휴대폰·태블릿에서는
 *          아무 일도 없으며, 꺼져 있을 때 평소 화면이 1픽셀도 달라지지 않는지 확인한다.)
 * ----------------------------------------------------------------------------
 * [무엇을 보나 — 설계서 client/js/pc-layout/pc_layout.design.md 「시험」 1~19]
 *  켜고 끄기  ① 휴대폰 폭 10번 → 안 켜짐 ② 터치·maxTouchPoints·앱(Capacitor)·좁은 창 → 안 켜짐
 *             ③ 9번·쉼·다른 탭이 끼면 안 켜짐 / 10번 → 켜짐 + 안내 ④ 다시 10번·[원래 화면으로]·새로고침 → 꺼짐
 *             ⑤ 끈 뒤·좁힌 뒤 탭 높이 변수 ⑥ 저장 안 함(localStorage·URL) ⑦ 꺼져 있을 때 0 영향 ⑧ 열린 사이드바 정리
 *  배치       ⑨ 해양종합정보 · 지점 창 ⑩ 위 막대(겹침 없음) ⑪ 메뉴가 늘 보임 · 지도 버튼 · 낮은 창
 *             ⑫ [보기] ⑬ 특보정보 · 점검 차단 ⑭ 특보 전용 지도 ⑮ 뉴스·공지·어황 ⑯ 길 잃은 고정 요소
 *  점검·정적  ⑰ 설정 단추의 점검 차단·집계 ⑱ CSS 는 body.pc-mode 아래만 ⑲ JS 가 저장·누름·창 열기를 안 한다
 * [방법] 저장소의 client/ 를 그대로 올린 작은 서버 + 진짜 크로뮴. /api 는 404(특보구역만 시험에서 가짜 자료),
 *        127.0.0.1 밖 요청은 모두 끊는다. 「서버 연결 불가」 창은 가린다. 기다림은 고정 ms — 오늘 날짜·시각에 기대지 않는다.
 *        「켠다」 = 1440×900 에서 아래 「해양종합정보」 탭을 진짜 마우스로 10번(130ms 간격).
 * [연계] → client/js/pc-layout/pc_layout.js(window.PcLayout) · pc_alert_map.js(window.PcAlertMap) · pc_layout.css ·
 *          ocean-map/warnings/ocean_warn_active3.js(_styleAlways·_styler) · ocean_warn_zone.js(loadFeatures) ·
 *          ocean-map/map/ocean_map.js · ocean-map/bottom-sheet/ocean_bottom_sheet1.js(PC 화면에서 다른 지점 누름)
 *        ← scripts/refactor/verify_all.sh SUITES
 * [실행] node local_server/scripts/test_pc_layout_ui.js
 * ============================================================================
 */
'use strict';
const path = require('path'), fs = require('fs'), assert = require('assert'), express = require('express');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (e) { try { ({ chromium } = require('playwright')); } catch (e2) { chromium = null; } }
const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let pass = 0, fail = 0;
/** 사례 하나를 돌리고 결과를 찍는다. 예: await check('9번은 안 켜짐', async () => {...})  @param {string} name @param {Function} fn */
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, '—', String(e && e.message).slice(0, 400)); fail++; } }

/** 두 사각형이 겹치나(0.5px 넘게). 예: ov({x:0,y:0,w:10,h:10},{x:5,y:5,w:10,h:10}) → true */
const ov = (a, b) => a && b && a.w > 0 && b.w > 0 && a.h > 0 && b.h > 0 && a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

// 시험용 특보구역 — 부모 2(동해중부앞바다·동해남부앞바다) · 자식 1
const poly = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const MAIN_GJ = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: '동해중부앞바다' }, geometry: poly(129.0, 37.0, 130.0, 38.0) },
    { type: 'Feature', properties: { name: '동해남부앞바다' }, geometry: poly(129.3, 35.5, 130.3, 36.5) }] };
const SUB_GJ = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: '강원중부 연안바다', WarnCode: 'S1110100' }, geometry: poly(128.9, 37.6, 129.2, 37.9) }] };

(async () => {
  if (!chromium) { console.log('playwright 없음 — 건너뜀'); console.log('0 PASS / 0 FAIL'); return; }
  let browser, server;
  const errors = [];
  try {
    const app = express();
    app.get('/api/swimming-index', (req, res) => res.json({ updatedAt: 'x', places: {} }));
    app.get('/', (req, res) => res.sendFile(path.join(root, 'client/index2.html')));
    app.use(express.static(path.join(root, 'client')));
    app.use('/api', (req, res) => res.status(404).json({ ok: false }));
    server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const exe = process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE;
    browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true, args: ['--no-sandbox'] });

    /**
     * 새 창을 띄워 앱이 다 뜰 때까지 기다린다.
     * @param {{width:number,height:number}} vp @param {object} [opt] - { ctx: newContext 옵션, init: addInitScript 함수, route: 페이지 route 를 더 거는 함수, font: 'large' 등 }
     */
    const open = async (vp, opt = {}) => {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, ...(opt.ctx || {}) });
      if (opt.font) await ctx.addInitScript((f) => { try { localStorage.setItem('user_font_size', f); } catch (e) { /* 저장소 없음 — 기본 글자 */ } }, opt.font);
      if (opt.init) await ctx.addInitScript(opt.init);
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(vp.width + ': ' + e.message));
      await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
      if (opt.route) await opt.route(page);
      await page.goto(base + '/');
      await page.waitForFunction(() => typeof window.switchMainTab === 'function' && window.OceanMenu && document.getElementById('ocean-buoy-toggle-btn'));
      await page.waitForTimeout(800);
      await page.evaluate(() => { const s = document.getElementById('splash-screen'); if (s) s.remove(); });
      await page.addStyleTag({ content: '#server-maintenance-popup, #network-error-popup { display: none !important; }' });
      return { ctx, page };
    };
    const W = (page, ms = 500) => page.waitForTimeout(ms);
    // 이 시험 서버는 /api 가 404 라 「서버 점검」 창이 뜰 수 있다 — 뒤로가기 목록에서 걷어 낸다(그 창의 닫기는 새로고침이다)
    const clean = (page) => page.evaluate(() => { ['server-maintenance-popup', 'network-error-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); if (window.PopupStack) window.PopupStack.remove(id); }); });
    /** 요소 한가운데를 진짜 마우스로 누른다 */
    const mclick = async (page, sel) => {
      const p = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
      if (!p) throw new Error('없음: ' + sel);
      await page.mouse.click(p[0], p[1]);
    };
    /** 「해양종합정보」 탭을 진짜 마우스로 n번(130ms 간격) */
    const tap = async (page, n) => { for (let i = 0; i < n; i++) { await mclick(page, '#bottom-tab-bar .tab-btn[data-target="ocean-map-section"]'); await W(page, 130); } };
    const isOn = (page) => page.evaluate(() => document.body.classList.contains('pc-mode'));
    const toast = (page) => page.evaluate(() => { const t = document.getElementById('ocean-ui-toast'); return t && t.classList.contains('visible') ? t.textContent : ''; });
    /** 사각형 {x,y,w,h} 여러 개를 한 번에 */
    const rects = (page, sels) => page.evaluate((ss) => {
      const o = {};
      for (const k in ss) { const e = document.querySelector(ss[k]); if (!e) { o[k] = null; continue; } const r = e.getBoundingClientRect(); o[k] = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; }
      return o;
    }, sels);
    /** 오른쪽 칸 폭 = max(440px, 23.5rem) */
    const sideW = (page) => page.evaluate(() => Math.round(Math.max(440, 23.5 * parseFloat(getComputedStyle(document.documentElement).fontSize))));
    /** (x,y) 의 맨 위 요소가 sel 안인가 */
    const topIn = (page, x, y, sel) => page.evaluate(([x, y, s]) => { const t = document.elementFromPoint(x, y), c = document.querySelector(s); return { ok: !!(t && c && (t === c || c.contains(t))), top: t ? (t.id || String(t.className).slice(0, 40) || t.tagName) : null }; }, [x, y, sel]);
    const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);

    // ═══════════════════ 켜고 끄기 ═══════════════════
    const { ctx: c390, page: p390 } = await open({ width: 390, height: 844 });
    await check('1. 390×844 에서 10번 → 안 켜짐 · #pc-pill 없음 · body class 가 누르기 전과 같다', async () => {
      await p390.evaluate(() => window.switchMainTab('ocean-map-section')); await W(p390, 900);
      const before = await p390.evaluate(() => document.body.className);
      await tap(p390, 10); await W(p390, 600);
      assert.equal(await isOn(p390), false);
      assert.equal(await p390.evaluate(() => !!document.getElementById('pc-pill')), false);
      assert.equal(await p390.evaluate(() => document.body.className), before);
    });
    await check('9-휴대폰. 390 폭에서는 지점 창이 열린 채 다른 지점을 불러도 그대로(종전 합의 — 조용히 무시)', async () => {
      await p390.evaluate(() => window.showOceanBottomSheet(37.5, 129.5)); await W(p390, 900);
      await p390.evaluate(() => window.showOceanBottomSheet(35.0, 129.0)); await W(p390, 500);
      assert.equal(await p390.evaluate(() => window.OceanSheet.state.lat), 37.5);
    });
    await c390.close();

    await check('2. 안 켜지는 경우 넷 — 터치(hasTouch) · maxTouchPoints 5 · 앱(Capacitor.isNativePlatform) · 1100×800', async () => {
      const cases = [
        ['hasTouch', { width: 1440, height: 900 }, { ctx: { hasTouch: true } }],
        ['maxTouchPoints', { width: 1440, height: 900 }, { init: () => { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }); } }],
        ['capacitor', { width: 1440, height: 900 }, {}],
        ['1100', { width: 1100, height: 800 }, {}]];
      for (const [name, vp, opt] of cases) {
        const { ctx, page } = await open(vp, opt);
        // 앱 흉내는 페이지가 뜬 뒤에 바꾼다(미리 넣으면 Capacitor 코어가 덮어쓴다 — 설계서 시험 2)
        if (name === 'capacitor') await page.evaluate(() => { window.Capacitor.isNativePlatform = () => true; });
        await tap(page, 10); await W(page, 500);
        assert.equal(await isOn(page), false, name + ' 에서 켜졌다');
        assert.equal(await page.evaluate(() => window.PcLayout.isArmed()), false, name);
        await ctx.close();
      }
    });

    const { ctx, page } = await open({ width: 1440, height: 900 });
    await check('3. 9번 → 안 켜짐 · 10번째 → 켜짐 + 안내 A · 5번·3200ms 쉼·5번 → 안 켜짐 · 5번·「특보정보」·5번 → 안 켜짐', async () => {
      await tap(page, 9); await W(page, 300);
      assert.equal(await isOn(page), false, '9번');
      await tap(page, 1); await W(page, 500);
      assert.equal(await isOn(page), true, '10번');
      assert.equal(await toast(page), 'PC 화면으로 바뀌었습니다 · 새로고침(F5)하면 원래 화면으로 돌아갑니다');
      await page.evaluate(() => window.PcLayout.disarm()); await W(page, 600);
      await tap(page, 5); await W(page, 3200); await tap(page, 5); await W(page, 400);
      assert.equal(await isOn(page), false, '쉼');
      await W(page, 3200); await tap(page, 5); await mclick(page, '#bottom-tab-bar .tab-btn[data-target="weather-group"]'); await W(page, 300); await tap(page, 5); await W(page, 400);
      assert.equal(await isOn(page), false, '다른 탭');
    });
    await check('4. 켠 뒤 다시 10번 → 꺼짐 + 안내 B · [원래 화면으로] → 꺼짐 · 새로고침 → 꺼짐', async () => {
      await tap(page, 10); await W(page, 500); assert.equal(await isOn(page), true);
      await W(page, 3200);   // 앞의 누름과 섞이지 않게
      await tap(page, 10); await W(page, 500);
      assert.equal(await isOn(page), false, '다시 10번');
      assert.equal(await toast(page), '원래 화면으로 돌아왔습니다');
      await W(page, 3200); await tap(page, 10); await W(page, 600); assert.equal(await isOn(page), true);
      await mclick(page, '#pc-exit'); await W(page, 500);
      assert.equal(await isOn(page), false, '[원래 화면으로]');
      await W(page, 3200); await tap(page, 10); await W(page, 600); assert.equal(await isOn(page), true);
      await page.reload();
      await page.waitForFunction(() => window.PcLayout && window.OceanMenu); await W(page, 800);
      await page.evaluate(() => { const s = document.getElementById('splash-screen'); if (s) s.remove(); });
      await page.addStyleTag({ content: '#server-maintenance-popup, #network-error-popup { display: none !important; }' });
      assert.equal(await isOn(page), false, '새로고침');
      assert.equal(await page.evaluate(() => window.PcLayout.isArmed()), false);
    });
    const tabVar = () => page.evaluate(() => ({ v: document.documentElement.style.getPropertyValue('--main-tab-height'), h: document.getElementById('bottom-tab-bar').offsetHeight + 'px', sub: document.getElementById('weather-sub-tabs').style.bottom, on: document.body.classList.contains('pc-mode') }));
    await check('5. 탭 높이 변수 — 끈 뒤 600ms · 켠 채 1100 으로 줄인 600ms 뒤 <html> --main-tab-height = 탭 줄 높이 = 하위탭 줄 bottom · 1440 으로 되돌리면 다시 켜짐', async () => {
      await tap(page, 10); await W(page, 600); assert.equal(await isOn(page), true);
      await page.evaluate(() => window.PcLayout.disarm()); await W(page, 600);
      let t = await tabVar(); assert.equal(t.v, t.h, '끈 뒤 ' + JSON.stringify(t)); assert.equal(t.sub, t.h, '끈 뒤 하위탭 ' + JSON.stringify(t));
      await page.evaluate(() => window.PcLayout.arm()); await W(page, 600); assert.equal(await isOn(page), true);
      await page.setViewportSize({ width: 1100, height: 800 }); await W(page, 600);
      t = await tabVar(); assert.equal(t.on, false, '좁히면 pc-mode 가 떨어진다'); assert.equal(t.v, t.h, '좁힌 뒤 ' + JSON.stringify(t)); assert.equal(t.sub, t.h, '좁힌 뒤 하위탭 ' + JSON.stringify(t));
      await page.setViewportSize({ width: 1440, height: 900 }); await W(page, 600);
      assert.equal(await isOn(page), true, '넓히면 다시 붙는다');
      await page.evaluate(() => window.PcLayout.disarm()); await W(page, 600);
    });
    await check('6. 저장 안 함 — 켜기 전 · 켠 뒤(세 탭을 돌고 특보정보에서 2초) · 끈 뒤의 localStorage 전체와 주소가 같다', async () => {
      const snap = () => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return { ls: o, href: location.href }; });
      await page.evaluate(() => window.switchMainTab('ocean-map-section')); await W(page, 1500);
      const s0 = await snap();
      await tap(page, 10); await W(page, 600); assert.equal(await isOn(page), true);
      for (const t of ['promo-section', 'ocean-map-section', 'weather-group']) { await mclick(page, '#bottom-tab-bar .tab-btn[data-target="' + t + '"]'); await W(page, 900); }
      await W(page, 2000);
      const s1 = await snap();
      await mclick(page, '#pc-exit'); await W(page, 600);
      const s2 = await snap();
      assert.deepEqual(s1, s0, '켠 뒤'); assert.deepEqual(s2, s0, '끈 뒤');
    });
    await check('8. 사이드바가 열린 채 켜면 — om-open 없음 · 덮개 숨김 · 뒤로가기 목록에 om-sidebar 없음', async () => {
      await page.evaluate(() => window.switchMainTab('ocean-map-section')); await W(page, 800);
      await page.evaluate(() => window.OceanMenu.open()); await W(page, 400);
      assert.ok(await page.evaluate(() => document.body.classList.contains('om-open')), '열려 있었다');
      await page.evaluate(() => window.PcLayout.arm()); await W(page, 500);
      const s = await page.evaluate(() => ({ open: document.body.classList.contains('om-open'), bd: getComputedStyle(document.getElementById('om-backdrop')).display, stack: window.PopupStack.list() }));
      assert.equal(s.open, false); assert.equal(s.bd, 'none'); assert.ok(!s.stack.includes('om-sidebar'), JSON.stringify(s.stack));
    });

    // ═══════════════════ 배치(켠 뒤) ═══════════════════
    /** 해양종합정보의 기본 틀(메뉴·지도 섹션)을 잰다 */
    const mainFrame = async (pg, Wd, Hd) => {
      const side = await sideW(pg);
      const r = await rects(pg, { menu: '#om-sidebar', sec: '#ocean-map-section' });
      assert.deepEqual([r.menu.x, r.menu.y, r.menu.w], [0, 56, 280], '메뉴 ' + JSON.stringify(r.menu));
      assert.equal(r.sec.x, 280, '지도 섹션 왼쪽'); assert.equal(r.sec.r, Wd - side, '지도 섹션 오른쪽 끝 ' + JSON.stringify(r.sec)); assert.equal(r.sec.b, Hd, '지도 섹션 아래 끝');
      return side;
    };
    await check('9. 해양종합정보 — 메뉴 (0,56) 280 · 지도 섹션 · 빈 안내가 오른쪽 칸 맨 위 · [전체 메뉴]·덮개 숨김 · 지점 창(보통·크게): 오른쪽 칸 · 넘침 0 · ✕/☆ 안 겹침 · 다른 지점 누르면 바뀜', async () => {
      const side = await mainFrame(page, 1440, 900);
      const t = await topIn(page, 1440 - side / 2, 450, '#pc-side-hint'); assert.ok(t.ok, '오른쪽 칸 한가운데 맨 위 = ' + t.top);
      assert.equal(await vis(page, '#om-menu-btn'), false); assert.equal(await vis(page, '#om-backdrop'), false);
      for (const font of ['medium', 'large']) {
        await page.evaluate((f) => FontSizeManager.set(f), font); await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await W(page, 500);
        const sw = await sideW(page);
        await page.evaluate(() => window.showOceanBottomSheet(37.5, 129.5)); await W(page, 1500);
        const g = await page.evaluate(() => {
          const sh = document.getElementById('ocean-bottom-sheet'), R = sh.getBoundingClientRect();
          const out = [...sh.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && (r.right > R.right + 1 || r.left < R.left - 1); }).map((e) => e.id || e.className);
          const q = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
          return { R: [Math.round(R.left), Math.round(R.top), Math.round(R.width), Math.round(R.bottom)], out, x: q('#ocean-sheet-close'), fav: q('#ocean-sheet-fav-btn') };
        });
        assert.deepEqual(g.R, [1440 - sw, 56, sw, 900], font + ' 지점 창 자리');
        assert.deepEqual(g.out, [], font + ' 창 밖으로 나간 자식');
        assert.ok(!ov(g.x, g.fav), font + ' ✕/☆ 겹침 ' + JSON.stringify([g.x, g.fav]));
        const c = await topIn(page, 1440 - sw / 2, 500, '#ocean-bottom-sheet'); assert.ok(c.ok, font + ' 창 한가운데 맨 위 = ' + c.top);
        await page.evaluate(() => window.showOceanBottomSheet(35.0, 129.0)); await W(page, 800);
        assert.equal(await page.evaluate(() => window.OceanSheet.state.lat), 35.0, font + ' 다른 지점');
        await page.evaluate(() => window.OceanSheet.closeSheet()); await W(page, 500);
      }
      await page.evaluate(() => FontSizeManager.set('medium')); await page.evaluate(() => window.dispatchEvent(new Event('resize'))); await W(page, 400);
    });
    await check('11. 지도 누름 · Escape · 뒤로가기 뒤에도 왼쪽 메뉴가 보인다', async () => {
      await page.mouse.click(640, 500); await W(page, 600);
      await clean(page); await page.keyboard.press('Escape'); await W(page, 300);
      await clean(page); await page.evaluate(() => window.PopupStack.popLast()); await W(page, 500);
      const r = await rects(page, { menu: '#om-sidebar' });
      assert.ok(await vis(page, '#om-sidebar'), '메뉴 보임'); assert.deepEqual([r.menu.x, r.menu.y, r.menu.w], [0, 56, 280]);
      await page.evaluate(() => { if (window.OceanSheet) window.OceanSheet.closeSheet(); }); await W(page, 400);
    });
    await check('16. 길 잃은 고정 요소 — 해양종합정보: 고정 요소가 전부 메뉴 오른쪽·위 막대 아래(범례·즐겨찾기 줄은 손으로 켜서)', async () => {
      await page.evaluate(() => { ['ocean-fav-bar'].forEach((id) => { const e = document.getElementById(id); if (e) { e.classList.remove('empty'); e.style.display = 'flex'; } }); document.querySelectorAll('#ocean-map-section .ocean-legend').forEach((e) => { e.style.display = 'block'; }); }); await W(page, 300);
      const bad = await strays(page); assert.deepEqual(bad, []);
      await page.evaluate(() => { const e = document.getElementById('ocean-fav-bar'); if (e) e.style.display = ''; document.querySelectorAll('#ocean-map-section .ocean-legend').forEach((x) => { x.style.display = ''; }); });
    });
    async function strays(pg) {
      return pg.evaluate(() => {
        const ex = '.main-header, #bottom-tab-bar, #om-sidebar, .modal, [id*="popup"], [class*="popup"], [class*="modal"], #ocean-ui-toast';
        return [...document.querySelectorAll('body *')].filter((e) => {
          const cs = getComputedStyle(e); if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false;
          const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false;
          if (e.closest(ex)) return false;
          if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;   // 화면 밖(닫혀 내려간 창 등)
          return r.left < 279.5 || r.top < 55.5;
        }).map((e) => (e.id || String(e.className).slice(0, 40)) + '@' + Math.round(e.getBoundingClientRect().left) + ',' + Math.round(e.getBoundingClientRect().top));
      });
    }
    await check('12. [보기] 항행경보·바다낚시(지점 창·사고 통계 창)·바다갈라짐 · [끄기] · 해양안전생활 탭은 숨김', async () => {
      const side = await sideW(page);
      await page.evaluate(() => window.OceanMenu.openView('navw')); await W(page, 2000);
      let r = await rects(page, { banner: '#om-banner', sec: '#ocean-map-section' });
      assert.deepEqual([r.banner.x, r.banner.y], [280, 56], '안내 줄 ' + JSON.stringify(r.banner));
      assert.equal(r.sec.y, 56 + r.banner.h, '지도 섹션이 안내 줄 아래'); assert.equal(r.sec.r, 1440 - side);
      let t = await topIn(page, 1440 - side / 2, 450, '#pc-side-hint'); assert.ok(t.ok, 'navw 오른쪽 칸 맨 위 = ' + t.top);
      assert.deepEqual(await strays(page), [], 'navw 길 잃은 고정 요소');
      // 사고 통계 창은 해양종합정보 지도 섹션 안에 있다 — 그 지도를 빌리는 해양안전 [보기](여기서는 항행경보)에서 잰다
      await page.evaluate(() => document.getElementById('accident-stats-sheet').classList.add('open')); await W(page, 400);
      let a = await rects(page, { sh: '#accident-stats-sheet' });
      assert.deepEqual([a.sh.x, a.sh.y, a.sh.b], [1440 - side, 56 + r.banner.h, 900], '사고 통계 창 ' + JSON.stringify(a.sh));
      await page.evaluate(() => document.getElementById('accident-stats-sheet').classList.remove('open')); await W(page, 300);
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('accident-stats-sheet')).visibility), 'hidden', '닫으면 숨김');
      await page.evaluate(() => window.OceanMenu.openView('fish')); await W(page, 2000);
      r = await rects(page, { banner: '#om-banner', sec: '#fishing-section' });
      assert.equal(r.sec.x, 280, '바다낚시 섹션 왼쪽'); assert.equal(r.sec.r, 1440 - side, '바다낚시 섹션 오른쪽 끝 ' + JSON.stringify(r.sec));
      t = await topIn(page, 1440 - side / 2, 450, '#pc-side-hint'); assert.ok(t.ok, 'fish 오른쪽 칸 맨 위 = ' + t.top);
      assert.deepEqual(await strays(page), [], 'fish 길 잃은 고정 요소');
      await page.evaluate(() => document.getElementById('fishing-bottomsheet').classList.add('active')); await W(page, 500);
      let s = await rects(page, { sh: '#fishing-bottomsheet' });
      assert.deepEqual([s.sh.x, s.sh.y, s.sh.b], [1440 - side, 56 + r.banner.h, 900], '낚시 지점 창 ' + JSON.stringify(s.sh));
      assert.equal(await vis(page, '.fishing-bottomsheet-overlay'), false, '덮개 숨김');
      await page.evaluate(() => document.getElementById('fishing-bottomsheet').classList.remove('active')); await W(page, 400);
      await page.evaluate(() => window.OceanMenu.openView('part')); await W(page, 2000);
      r = await rects(page, { sec: '#sea-parting-section' });
      assert.equal(r.sec.r, 1440, '바다갈라짐 표가 오른쪽 끝까지 ' + JSON.stringify(r.sec)); assert.equal(r.sec.x, 280);
      await mclick(page, '#om-banner .om-banner-off'); await W(page, 1500);
      await mainFrame(page, 1440, 900);
      await page.evaluate(() => window.switchMainTab('ocean-life-group')); await W(page, 1200);
      assert.equal(await vis(page, '.tab-btn[data-target="ocean-life-group"]'), false, '숨긴 탭');
      await page.evaluate(() => window.switchMainTab('ocean-map-section')); await W(page, 1000);
    });
    await check('11-b. 1200×800 지도 위 버튼(검색칸·기본맵·내 위치·안내·＋−)이 서로 안 겹침 · 1280×560 지도 높이 > 0 · 메뉴 몸통 스크롤', async () => {
      try {
      await page.setViewportSize({ width: 1200, height: 800 }); await W(page, 900);
      assert.equal(await isOn(page), true);
      const r = await rects(page, { search: '#ocean-map-section .ocean-search-container', base: '#ocean-basemap-toggle', my: '#ocean-myloc-btn', info: '#ocean-info-btn', zin: '#pc-zoom [data-pc-zoom="1"]', zout: '#pc-zoom [data-pc-zoom="-1"]' });
      const ks = Object.keys(r), bad = [];
      for (let i = 0; i < ks.length; i++) { assert.ok(r[ks[i]] && r[ks[i]].w > 0, ks[i] + ' 안 보임'); for (let j = i + 1; j < ks.length; j++) if (ov(r[ks[i]], r[ks[j]])) bad.push(ks[i] + '×' + ks[j]); }
      assert.deepEqual(bad, [], JSON.stringify(r));
      await page.setViewportSize({ width: 1280, height: 560 }); await W(page, 900);
      const g = await page.evaluate(() => { const b = document.querySelector('#om-sidebar .om-body'); return { mapH: document.getElementById('ocean-map').getBoundingClientRect().height, sh: b.scrollHeight, ch: b.clientHeight }; });
      assert.ok(g.mapH > 0, JSON.stringify(g)); assert.ok(g.sh > g.ch, '메뉴 몸통이 스크롤된다 ' + JSON.stringify(g));
      } finally { await page.setViewportSize({ width: 1440, height: 900 }); await W(page, 900); }
    });
    await check('13. 특보정보 — 하위탭 줄 (0,56) 400×44(본문을 눌러도) · 특보현황 몸통이 왼쪽 칸(collapsed 여도) · 오른쪽 섹션 폭 = 칸 폭 · 점검으로 막으면 몸통 숨김·머리는 왼쪽 칸·덮개를 누르면 점검 안내', async () => {
      const side = await sideW(page);
      await mclick(page, '#bottom-tab-bar .tab-btn[data-target="weather-group"]'); await W(page, 1200);
      let r = await rects(page, { sub: '#weather-sub-tabs', sec: '#weather-alert-section' });
      assert.deepEqual([r.sub.x, r.sub.y, r.sub.w, r.sub.h], [0, 56, 400, 44], '하위탭 ' + JSON.stringify(r.sub));
      assert.equal(r.sec.w, side, '오른쪽 섹션 폭'); assert.equal(r.sec.r, 1440);
      await page.mouse.click(1440 - side / 2, 700); await W(page, 600);
      r = await rects(page, { sub: '#weather-sub-tabs' });
      assert.deepEqual([r.sub.x, r.sub.y, r.sub.w, r.sub.h], [0, 56, 400, 44], '본문을 누른 뒤 하위탭 ' + JSON.stringify(r.sub));
      await page.evaluate(() => document.getElementById('main-accordion-body').classList.add('collapsed')); await W(page, 400);
      r = await rects(page, { body: '#main-accordion-body', head: '#main-accordion-header' });
      assert.ok(await vis(page, '#main-accordion-body'), 'collapsed 여도 보인다');
      assert.deepEqual([r.body.x, r.body.w, r.body.b], [0, 400, 900], '몸통 ' + JSON.stringify(r.body));
      assert.deepEqual([r.head.x, r.head.y, r.head.w], [0, 100, 400], '머리 ' + JSON.stringify(r.head));
      assert.equal(r.body.y, r.head.b, '몸통이 머리 바로 아래 ' + JSON.stringify([r.head, r.body]));
      // 요약 배지가 많아 머리가 두 줄이 되어도(settings.js 전역 규칙 height:auto) 몸통이 머리 아래에서 시작한다
      await page.evaluate(() => { const mk = (z, t, l, pre) => ({ zoneName: z, regId: z, warnType: t, level: l, tmFc: '202601010600', tmEf: '202601011000', tmCc: '', tmEd: '', command: pre ? '발표' : '발효', isPreliminary: pre, isCoastal: false, source: 'CRAWLER', prevLevel: null, history: [] });
        appState.alerts = [mk('동해중부앞바다', '풍랑', '주의보', false), mk('서해중부앞바다', '강풍', '주의보', true)]; renderApp(); }); await W(page, 600);
      r = await rects(page, { body: '#main-accordion-body', head: '#main-accordion-header' });
      assert.ok(r.head.h > 56, '시험 조건: 머리가 두 줄 ' + JSON.stringify(r.head));
      assert.equal(r.body.y, r.head.b, '두 줄 머리 아래 ' + JSON.stringify([r.head, r.body]));
      await page.evaluate(() => { appState.alerts = []; renderApp(); }); await W(page, 400);
      await page.evaluate(() => { localStorage.removeItem('seagnal_admin_mode'); applyFeatureBlocks(['weather-alert']); }); await W(page, 400);
      assert.equal(await vis(page, '#main-accordion-body'), false, '막으면 몸통이 안 보인다');
      r = await rects(page, { head: '#main-accordion-header' });
      assert.deepEqual([r.head.x, r.head.w], [0, 400], '막힌 머리도 왼쪽 칸 ' + JSON.stringify(r.head));
      await page.mouse.click(200, 128); await W(page, 400);
      assert.equal(await page.evaluate(() => document.getElementById('blocked-feature-popup').style.display), 'flex', '덮개를 누르면 점검 안내');
      await page.evaluate(() => { document.getElementById('blocked-feature-popup').style.display = 'none'; applyFeatureBlocks([]); }); await W(page, 400);
      const css = read('client/js/pc-layout/pc_layout.css').replace(/\/\*[\s\S]*?\*\//g, '');
      const bad = css.split('}').filter((rule) => rule.includes('#main-accordion-body') && /(^|[;{\s])display\s*:/.test(rule.split('{')[1] || ''));
      assert.deepEqual(bad, [], '#main-accordion-body 규칙에 display 가 없다');
    });
    await check('15. 뉴스·공지·어황 — 갈래 세로 220 · 목록 칸 220/480 · 목록이 날짜줄 바로 아래 · 공지 창이 읽기 칸 · 새로 받기', async () => {
      await mclick(page, '#bottom-tab-bar .tab-btn[data-target="promo-section"]'); await W(page, 1200);
      const r = await rects(page, { tabs: '#nhub-tabs', t1: '#nhub-tabs .nhub-tab:nth-child(1)', t2: '#nhub-tabs .nhub-tab:nth-child(2)', date: '#news-dateline', panel: '#promo-section .nhub-panel.active' });
      assert.equal(r.tabs.x, 0); assert.equal(r.tabs.w, 220, '갈래 폭 ' + JSON.stringify(r.tabs));
      assert.ok(r.t2.y >= r.t1.b - 1 && r.t2.x === r.t1.x, '갈래가 세로 ' + JSON.stringify([r.t1, r.t2]));
      assert.deepEqual([r.panel.x, r.panel.w], [220, 480], '목록 칸 ' + JSON.stringify(r.panel));
      assert.ok(r.panel.y - r.date.b <= 24 && r.panel.y >= r.date.b - 1, '빈 띠 없음 ' + JSON.stringify([r.date, r.panel]));
      await page.evaluate(() => { const m = document.getElementById('promo-detail-modal'); m.classList.remove('hidden'); m.style.top = '0px'; m.style.height = '900px'; }); await W(page, 300);
      const m = await rects(page, { m: '#promo-detail-modal' });
      assert.deepEqual([m.m.x, m.m.y, m.m.r], [700, 56, 1440], '공지 창 ' + JSON.stringify(m.m));
      await page.evaluate(() => { const m = document.getElementById('promo-detail-modal'); m.classList.add('hidden'); m.style.top = ''; m.style.height = ''; });
      await page.evaluate(() => { window.__ptrN = 0; const p = window.NoticeHub._ptr; const o = p.refresh; p.refresh = function () { window.__ptrN++; return o.apply(this, arguments); }; });
      await mclick(page, '#pc-news-refresh'); await W(page, 300);
      assert.equal(await page.evaluate(() => window.__ptrN), 1, '새로 받기를 누르면 NoticeHub._ptr.refresh');
    });
    await check('10. 위 막대 — 1440×900·1200×800 × 글자 보통·크게, 배지·제보 단추를 켠 채로 세 탭 모두 0~56 안·겹침 없음 · 설정 창이 위 막대를 덮는다', async () => {
      for (const [vw, vh] of [[1440, 900], [1200, 800]]) for (const font of ['medium', 'large']) {
        const o = await open({ width: vw, height: vh }, { font });
        await o.page.evaluate(() => window.PcLayout.arm()); await W(o.page, 600);
        assert.equal(await isOn(o.page), true, vw + ' 켜짐');
        await o.page.evaluate(() => { document.getElementById('work-mode-badge').style.display = ''; document.getElementById('header-report-btn').style.display = ''; });
        for (const t of ['weather-group', 'ocean-map-section', 'promo-section']) {
          await o.page.evaluate((x) => window.switchMainTab(x), t); await W(o.page, 900);
          const r = await rects(o.page, { logo: '.main-header .logo-text', badge: '#work-mode-badge', tabW: '#bottom-tab-bar .tab-btn[data-target="weather-group"]', tabO: '#bottom-tab-bar .tab-btn[data-target="ocean-map-section"]', tabP: '#bottom-tab-bar .tab-btn[data-target="promo-section"]', pill: '#pc-pill', visitor: '.visitor-counter', report: '#header-report-btn', settings: '.header-settings-btn', exit: '#pc-exit' });
          const ks = Object.keys(r), bad = [], out = [];
          for (let i = 0; i < ks.length; i++) {
            const a = r[ks[i]]; if (!a || !(a.w > 0)) { out.push(ks[i] + ' 안 보임'); continue; }
            if (a.y < 0 || a.b > 56 || a.x < 0 || a.r > vw) out.push(ks[i] + JSON.stringify(a));
            for (let j = i + 1; j < ks.length; j++) if (ov(a, r[ks[j]])) bad.push(ks[i] + '×' + ks[j]);
          }
          assert.deepEqual(out, [], vw + '/' + font + '/' + t + ' 0~56 밖');
          assert.deepEqual(bad, [], vw + '/' + font + '/' + t + ' 겹침');
        }
        await mclick(o.page, '.header-settings-btn'); await W(o.page, 700);
        const tt = await topIn(o.page, vw / 2, 28, '#settings-modal'); assert.ok(tt.ok, vw + '/' + font + ' 설정 창이 위 막대를 덮는다 — 맨 위 ' + tt.top);
        await o.ctx.close();
      }
    });
    await check('14. 특보 전용 지도 — 자리·크기 · 4층 색칠(_styleAlways) · _styler 는 켜졌을 때만 · 해양종합정보 지도 없음 · 범례/출처 안 겹침 · 카드 → 지도 · 점검 · 해상일기도 · AI 챗봇 단추', async () => {
      const o = await open({ width: 1440, height: 900 }, {
        init: () => {   // 시험용 — 지도 객체를 붙잡아 둔다(PC 코드는 지도를 밖에 내놓지 않는다)
          const grab = () => { if (!window.ol || !ol.Map || ol.Map.__grab) return false; const O = ol.Map; window.__olMaps = []; const G = function (opt) { const m = new O(opt); window.__olMaps.push(m); return m; }; G.prototype = O.prototype; G.__grab = true; ol.Map = G; return true; };
          const t = setInterval(() => { if (grab()) clearInterval(t); }, 5);
        },
        route: async (pg) => {
          await pg.route('**/api/warn-zones-sub*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SUB_GJ) }));
          await pg.route('**/api/warn-zones?*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MAIN_GJ) }));
        }
      });
      const pg = o.page, side = await sideW(pg);
      await pg.evaluate(() => { window.switchMainTab('weather-group'); window.PcLayout.arm(); }); await W(pg, 2000);
      const r = await rects(pg, { m: '#pc-alert-map' });
      assert.deepEqual([r.m.x, r.m.y, r.m.w, r.m.b], [400, 56, 1440 - 400 - side, 900], '지도 자리 ' + JSON.stringify(r.m));
      const g = await pg.evaluate(() => { const m = window.__olMaps.find((x) => x.getTargetElement() && x.getTargetElement().id === 'pc-alert-map'); window.__pcMap = m; return { size: m.getSize(), n: m.getLayers().getLength() }; });
      assert.deepEqual(g.size, [r.m.w, r.m.h], 'OL 지도 크기 ' + JSON.stringify(g));
      await pg.evaluate(() => { appState.alerts = appState.alerts || []; appState.alerts.push({ zoneName: '동해중부앞바다', warnType: '풍랑', level: '주의보', isPreliminary: false }); window.dispatchEvent(new Event('seagnal:alerts-changed')); }); await W(pg, 500);
      const st = await pg.evaluate(() => {
        const f = window.__pcMap.getLayers().getArray().map((l) => l.getSource && l.getSource()).filter(Boolean).map((s) => s.getFeatures ? s.getFeatures() : []).flat().find((x) => x.get('name') === '동해중부앞바다');
        const A = window.OceanWarnActive, Z = window.OceanWarnZone, fillOf = (s) => { const x = Z.onlyFill(s); return x && x.getFill() ? String(x.getFill().getColor()) : null; };
        const out = { found: !!f, always: fillOf(A._styleAlways(f, 'main')), activeBefore: A._state.active, stylerOff: A._styler(f, 'main') };
        A._state.active = true;
        const s1 = A._styler(f, 'main'), s2 = A._styleAlways(f, 'main');
        out.sameKind = Array.isArray(s1) === Array.isArray(s2) && !!s1 && !!s2; out.sameFill = fillOf(s1) === fillOf(s2) && fillOf(s1) !== null;
        A._state.active = false;
        out.oceanMap = window.getOceanMap ? window.getOceanMap() : 'none';
        return out;
      });
      assert.ok(st.found, '부모 구역을 받았다'); assert.ok(st.always, '_styleAlways 결과가 색칠 ' + JSON.stringify(st));
      assert.equal(st.activeBefore, false); assert.equal(st.stylerOff, null, '꺼져 있으면 _styler 는 null');
      assert.ok(st.sameKind && st.sameFill, '켜면 _styler 와 _styleAlways 가 같다 ' + JSON.stringify(st));
      assert.equal(st.oceanMap, null, '해양종합정보 지도는 만들지 않았다');
      const lg = await pg.evaluate(() => { const q = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }; return { lg: q(document.getElementById('pc-alert-legend')), at: q(document.querySelector('#pc-alert-map .ol-attribution')) }; });
      assert.ok(!ov(lg.lg, lg.at), '범례/출처 겹침 ' + JSON.stringify(lg));
      // 카드 → 지도: 흉내 낸 카드를 목록에 넣고 진짜 마우스로 누른다
      await pg.evaluate(() => { const ac = document.getElementById('alert-content'); ac.classList.remove('hidden'); ac.style.display = 'block'; const c = document.createElement('div'); c.className = 'alert-card'; c.setAttribute('data-zone', '동해남부앞바다'); c.id = 'pc-test-card'; c.style.cssText = 'height:60px;background:#333'; c.addEventListener('click', (e) => e.stopPropagation()); ac.insertBefore(c, ac.firstChild); c.scrollIntoView(); }); await W(pg, 300);
      await mclick(pg, '#pc-test-card'); await W(pg, 900);
      const inZone = await pg.evaluate(() => { const v = window.__pcMap.getView(), c = ol.proj.toLonLat(v.getCenter()); return { c, ok: c[0] > 129.3 && c[0] < 130.3 && c[1] > 35.5 && c[1] < 36.5 }; });
      assert.ok(inZone.ok, '지도 중심이 그 구역 안 ' + JSON.stringify(inZone.c));
      await pg.evaluate(() => { document.getElementById('pc-test-card').remove(); });
      await pg.evaluate(() => { localStorage.removeItem('seagnal_admin_mode'); window._blockedFeatures = ['ov-warn-zone']; window.PcAlertMap.refresh(); }); await W(pg, 300);
      const blk = await pg.evaluate(() => { const ls = window.__pcMap.getLayers().getArray(); const n = document.getElementById('pc-alert-note'); return { vis: ls.filter((l) => l.getZIndex() >= 40).map((l) => l.getVisible()), note: n.hidden ? '' : n.textContent }; });
      assert.ok(blk.vis.length === 5 && blk.vis.every((v) => v === false), '구역 층 꺼짐 ' + JSON.stringify(blk));
      assert.equal(blk.note, '특보구역 표시는 점검 중입니다');
      await pg.evaluate(() => { window._blockedFeatures = []; window.PcAlertMap.refresh(); });
      await pg.evaluate(() => window.switchSubTab('marine-chart-section')); await W(pg, 900);
      assert.equal(await vis(pg, '#pc-alert-map'), false, '해상일기도에서는 전용 지도가 안 보인다');
      const mc = await rects(pg, { s: '#marine-chart-section' }); assert.equal(mc.s.w, 1440, '일기도 섹션 폭 ' + JSON.stringify(mc.s));
      await pg.evaluate(() => window.switchSubTab('weather-alert-section')); await W(pg, 900);
      assert.equal(await vis(pg, '#pc-alert-map'), true, '돌아오면 다시 보인다');
      assert.equal(await vis(pg, '#nryaFab'), false, '서버 노출 기본값에서 AI 챗봇 단추는 안 보인다');
      await o.ctx.close();
    });

    // ═══════════════════ 0 영향 ═══════════════════
    await check('7. 꺼져 있을 때 0 영향 — PC 파일 셋을 빈 응답으로 바꾼 쪽과 원래 쪽(390·1440, 누르지 않음)의 주요 요소 사각형·display·position 이 같다', async () => {
      const sels = ['#bottom-tab-bar', '.main-header', '#ocean-map-section', '#om-menu-btn', '#weather-alert-section', '#promo-section'];
      const measure = async (vp, empty) => {
        const o = await open(vp, { route: empty ? async (pg) => { await pg.route(/\/js\/pc-layout\/pc_(layout|alert_map)\.(js|css)/, (r) => r.fulfill({ status: 200, contentType: r.request().url().includes('.css') ? 'text/css' : 'application/javascript', body: '' })); } : null });
        const out = {};
        for (const t of ['weather-group', 'ocean-map-section', 'promo-section']) {
          await o.page.evaluate((x) => window.switchMainTab(x), t); await W(o.page, 1200);
          out[t] = await o.page.evaluate((ss) => ss.map((s) => { const e = document.querySelector(s); if (!e) return s + ':없음'; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return [s, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), cs.display, cs.position].join(' '); }), sels);
        }
        out.pc = await o.page.evaluate(() => typeof window.PcLayout);
        await o.ctx.close();
        return out;
      };
      for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const a = await measure(vp, true), b = await measure(vp, false);
        assert.equal(a.pc, 'undefined', '빈 쪽에는 PC 코드가 없다'); assert.equal(b.pc, 'object');
        delete a.pc; delete b.pc;
        assert.deepEqual(b, a, vp.width + ' 폭');
      }
    });

    // ═══════════════════ 점검·집계·정적 ═══════════════════
    await check('17. 설정 단추 — 점검으로 막으면 PC 화면에서도 안 열리고 점검 안내 · 막지 않으면 /api/usage 에 settings.open', async () => {
      await page.evaluate(() => { localStorage.removeItem('seagnal_admin_mode'); applyFeatureBlocks(['settings-btn']); }); await W(page, 300);
      assert.equal(await isOn(page), true);
      await mclick(page, '.header-settings-btn'); await W(page, 500);
      const s = await page.evaluate(() => ({ open: !document.getElementById('settings-modal').classList.contains('hidden'), popup: document.getElementById('blocked-feature-popup').style.display }));
      assert.equal(s.open, false, '막힌 설정 창이 열렸다'); assert.equal(s.popup, 'flex', '점검 안내');
      await page.evaluate(() => { document.getElementById('blocked-feature-popup').style.display = 'none'; applyFeatureBlocks([]); }); await W(page, 300);
      const used = [];
      await page.route('**/api/usage', (r) => { try { const b = JSON.parse(r.request().postData() || '{}'); used.push(...(b.features || [b.feature])); } catch (e) { /* 본문이 없으면 무시 */ } r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
      await mclick(page, '.header-settings-btn'); await W(page, 600);
      assert.ok(used.includes('settings.open'), JSON.stringify(used));
      await page.unroute('**/api/usage');
    });
    await check('17-b. [전체 메뉴] 점검 — 켠 뒤 막히면 메뉴 스위치를 눌러도 안 켜지고 평소 화면 + 점검 안내 · 막힌 채 10번 눌러도 안 켜짐', async () => {
      assert.equal(await isOn(page), true);
      await page.evaluate(() => { window.switchMainTab('ocean-map-section'); }); await W(page, 500);
      await page.evaluate(() => { localStorage.removeItem('seagnal_admin_mode'); document.getElementById('blocked-feature-popup').style.display = 'none'; applyFeatureBlocks(['om-menu']); }); await W(page, 300);
      const before = await page.evaluate(() => document.querySelectorAll('#om-sidebar [aria-checked="true"]').length);
      await mclick(page, '#om-sidebar [data-om="sw"][data-id="wav"]'); await W(page, 500);
      const s = await page.evaluate(() => ({ pc: document.body.classList.contains('pc-mode'), popup: document.getElementById('blocked-feature-popup').style.display, n: document.querySelectorAll('#om-sidebar [aria-checked="true"]').length }));
      assert.equal(s.pc, false, '막혔는데 PC 화면이 남았다'); assert.equal(s.popup, 'flex', '점검 안내'); assert.equal(s.n, before, '막힌 메뉴의 스위치가 켜졌다');
      await page.evaluate(() => { document.getElementById('blocked-feature-popup').style.display = 'none'; window.PcLayout.disarm(); }); await W(page, 500);
      for (let i = 0; i < 10; i++) await mclick(page, '#bottom-tab-bar .tab-btn[data-target="ocean-map-section"]');
      await W(page, 400);
      assert.equal(await isOn(page), false, '막힌 채 10번에 켜졌다');
      await page.evaluate(() => { applyFeatureBlocks([]); window.PcLayout.arm(); }); await W(page, 600);
      assert.equal(await isOn(page), true);
    });
    await check('18. 정적 — pc_layout.css 의 모든 선택자가 body.pc-mode 로 시작(첫 규칙 한 줄 예외) · :root·@font-face·@keyframes·@media 없음', async () => {
      const css = read('client/js/pc-layout/pc_layout.css').replace(/\/\*[\s\S]*?\*\//g, '');
      assert.ok(!/:root|@font-face|@keyframes|@media/.test(css));
      const sels = css.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
      const first = sels.shift();
      assert.equal(first.replace(/\s+/g, ' '), '#pc-pill, #pc-exit, #pc-side-hint, #pc-zoom, #pc-read-hint, #pc-news-refresh, #pc-alert-map, #pc-alert-legend, #pc-alert-note');
      const bad = sels.map((s) => s.split(',').map((x) => x.trim())).flat().filter((s) => !/^body\.pc-mode([.\[:\s]|$)/.test(s));
      assert.deepEqual(bad, []);
    });
    await check('19. 정적 — PC JS 두 파일에 저장·주소 바꾸기·프로그램 누름·창 열기 함수가 없다 · index2.html 에서 PC script 둘이 ocean_menu.js 뒤', async () => {
      const banned = ['localStorage.setItem', 'sessionStorage', 'pushState', 'replaceState', '.click(', 'openChat', 'openSettingsModal', 'openReportModal', 'Nariya' + 'Chat'];
      for (const f of ['client/js/pc-layout/pc_layout.js', 'client/js/pc-layout/pc_alert_map.js']) {
        const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'); const hit = banned.filter((b) => src.includes(b)); assert.deepEqual(hit, [], f);
      }
      const html = read('client/index2.html');
      const iMenu = html.indexOf('js/ocean-map/menu/ocean_menu.js'), iMap = html.indexOf('js/pc-layout/pc_alert_map.js'), iLay = html.indexOf('js/pc-layout/pc_layout.js');
      assert.ok(iMenu > 0 && iMap > iMenu && iLay > iMap, [iMenu, iMap, iLay].join(','));
      assert.ok(html.indexOf('js/pc-layout/pc_layout.css') > html.indexOf('js/ocean-map/menu/ocean_menu.css'));
    });
    await check('화면 오류 없음(pageerror 0)', async () => { assert.deepEqual(errors, []); });
    await ctx.close();
  } catch (e) { console.error('❌ 시험 준비 실패', e.message); fail++; }
  finally { if (browser) await browser.close(); if (server) server.close(); }
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
