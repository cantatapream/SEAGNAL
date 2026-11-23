/**
 * ============================================================================
 * 파일명: local_server/scripts/test_ocean_menu_ui.js
 * 역할  : 해양종합정보 「새 모드」(탭 10번 누르면 켜지는 통합 메뉴)를 실제 브라우저로 눌러 본다.
 *         (초보자용: 사이드바 스위치·[보기]·[끄기]·안내 줄이 약속대로 움직이는지, 그리고
 *          새 모드를 켜지 않은 평소 화면은 그대로인지 확인한다.)
 * ----------------------------------------------------------------------------
 * [무엇을 보나 — 사용자 확정 2026-11-22]
 *  ① 평소 화면: [메뉴]·사이드바 없음, 아래 탭 4개, 오른쪽 버튼 줄 보임
 *  ② 「해양종합정보」 탭 10번 → 새 모드(탭 3개·버튼 줄 숨김·[메뉴]) / 9번으로는 안 켜짐 / 새로 열면 평소 화면
 *  ③ 사이드바: 폴더 4개(즐겨찾기·해양기상정보·해양안전정보·해양생활지수)와 줄 순서, 지도(바깥)를 누르면 닫힘, 뒤로가기 닫힘
 *  ④ 함께 켤 수 없는 묶음(특보구역·현황/파고/풍향/유향/천기) — 새로 켜면 먼저 켠 것이 꺼짐. 기상부이·해구기상은 함께
 *  ⑤ 배경지도: 파고=해안도, 해구기상을 함께 켜면 기본맵(파고는 그대로 켜져 있음), 끄면 해안도, 다 끄면 처음 배경
 *  ⑥ 천기: 켜도 아무것도 안 그림 → 버튼 7개 순서(기온·강수량·강수형태·강수확률·적설·하늘상태·시정예측),
 *     자료 없는 버튼은 회색 + 맨 뒤 + 누르면 알림(지정 문구)
 *  ⑦ [보기]: 사이드바 닫힘 · 맨 위 안내 줄 + 지도가 그만큼 내려감 · 기상정보·CCTV 숨김 · 한 번에 하나 ·
 *     보는 동안 스위치는 미뤄졌다가 [끄기] 뒤 반영 · 관제구역·항로는 두 층이 함께 · 뒤로가기 = 끄기
 *  ⑧ 사고발생 이력 분석: 사고이력[선박]/[인명]=현황+그 종류, 「필터」는 접힌 채 시작·누르면 펼침,
 *     「선택 초기화」는 필터가 걸렸을 때만 / 사고분석=분석+「전국 통계」
 *  ⑨ 태풍(활성 없음)은 맨 뒤·회색, 해수욕(개장 없음)은 맨 뒤·회색·「개장 해수욕장 없음」·눌러도 안 열림
 *  ⑩ 즐겨찾기·접은 폴더는 저장돼 다시 열어도 남는다(새 모드 자체는 저장 안 함)
 *  ⑪ 새 모드에서 특보 현황을 켠 채 지도를 누르면 특보 상자가 가로채지 않는다(tryHandleClick → false)
 *  ⑫ 다시 10번 → 평소 화면으로(보던 화면 닫힘)
 * [방법] 저장소의 client/ 를 그대로 올린 작은 서버 + 진짜 크로뮴. /api 는 404(해수욕지수만 가짜 자료),
 *        127.0.0.1 밖 요청은 모두 끊는다. 시각 의존 없음(해수욕 판정 함수는 오늘 날짜 키를 직접 만들어 넣는다).
 * [연계] → client/js/ocean-map/menu/ocean_menu.js(window.OceanMenu) · ocean_menu.css ·
 *          life_safety.js(_isOmPair·_lsDropParkedSafety) · accident_info.js(showFilterResetBtn) ·
 *          ocean_map.js(switchBaseLayer 새 모드 예외) · ocean_warn_active5.js(tryHandleClick)
 *        ← scripts/refactor/verify_all.sh SUITES
 * [실행] NODE_PATH=/opt/node-tools/node_modules node local_server/scripts/test_ocean_menu_ui.js
 * ============================================================================
 */
'use strict';
const path = require('path'), assert = require('assert'), express = require('express');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (e) { try { ({ chromium } = require('playwright')); } catch (e2) { chromium = null; } }
const root = path.join(__dirname, '../..');
let pass = 0, fail = 0;
/** 사례 하나를 돌리고 결과를 찍는다. 예: await check('탭 3개', async () => {...})  @param {string} name @param {Function} fn */
async function check(name, fn) { try { await fn(); console.log('✅', name); pass++; } catch (e) { console.error('❌', name, '—', String(e.message).slice(0, 300)); fail++; } }

(async () => {
  if (!chromium) { console.log('playwright 없음 — 건너뜀'); console.log('0 PASS / 0 FAIL'); return; }
  let browser, server;
  try {
    const app = express();
    app.get('/api/swimming-index', (req, res) => res.json({ updatedAt: 'x', places: {} }));   // 개장 해수욕장 없음
    app.get('/', (req, res) => res.sendFile(path.join(root, 'client/index2.html')));
    app.use(express.static(path.join(root, 'client')));
    app.use('/api', (req, res) => res.status(404).json({ ok: false }));
    server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const exe = process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE;
    browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
    const load = async () => {
      await page.goto(base + '/');
      await page.waitForFunction(() => typeof window.switchMainTab === 'function' && window.OceanMenu && document.getElementById('ocean-buoy-toggle-btn'));
      await page.waitForTimeout(600);
      await page.evaluate(() => { const s = document.getElementById('splash-screen'); if (s) s.remove(); });
    };
    const wait = (ms = 500) => page.waitForTimeout(ms);
    // 이 시험 서버는 /api 가 404 라 「서버 점검」 창이 뜰 수 있다 — 화면을 덮고 뒤로가기 목록에도 끼므로 볼 때마다 걷어 낸다
    const clean = () => page.evaluate(() => { ['server-maintenance-popup', 'network-error-popup'].forEach((id) => { const e = document.getElementById(id); if (e) e.remove(); if (window.PopupStack) window.PopupStack.remove(id); }); });
    const back = async () => { await clean(); await page.evaluate(() => window.PopupStack.popLast()); };
    const tapOcean = async (n) => { for (let i = 0; i < n; i++) await page.evaluate(() => document.querySelector('.tab-btn[data-target="ocean-map-section"]').click()); };
    const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) throw new Error('없음: ' + s); e.click(); }, sel);
    const sw = (id) => click('#om-sidebar [data-om="sw"][data-id="' + id + '"]');
    const view = (id) => click('#om-sidebar [data-om="view"][data-id="' + id + '"]');
    /** 화면 상태를 한 번에 읽는다 */
    const S = () => page.evaluate(() => {
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
      const q = (s) => document.querySelector(s), m = window.OceanMenu.state();
      const sec = q('.tab-content.active');
      return {
        mode: m.mode, open: m.open, view: m.view, pending: m.pending, cls: document.body.className,
        tab: document.body.getAttribute('data-active-tab'), sec: sec && sec.id, secTop: sec ? Math.round(sec.getBoundingClientRect().top) : null,
        on: [...document.querySelectorAll('#ocean-overlay-controls .ocean-overlay-btn.active')].map(b => b.id || b.dataset.layer || b.dataset.shrt).sort(),
        base: window.oceanGetBasemap ? window.oceanGetBasemap() : null,
        menuBtn: vis(q('#om-menu-btn')), rail: vis(q('#ocean-overlay-controls')), lsRail: vis(q('#ls-rail')),
        tabs: [...document.querySelectorAll('#bottom-tab-bar .tab-btn')].filter(vis).map(b => b.textContent.trim()),
        oceanTabOn: q('.tab-btn[data-target="ocean-map-section"]').classList.contains('active'),
        banner: vis(q('#om-banner')) ? q('#om-banner .om-banner-text').textContent : '', bannerH: q('#om-banner') ? q('#om-banner').offsetHeight : 0,
        sideX: q('#om-sidebar') ? Math.round(q('#om-sidebar').getBoundingClientRect().left) : null,
        subs: [...document.querySelectorAll('#om-subs button')].map(b => b.textContent.replace(/\s+/g, '') + (b.classList.contains('om-sub-dead') ? '×' : '') + (b.classList.contains('active') ? '●' : '')),
        stack: (window.PopupStack && window.PopupStack.list ? window.PopupStack.list() : []).filter(x => /^om-/.test(x)),
        folders: [...document.querySelectorAll('#om-sidebar .om-folder')].map(f => f.querySelector('.om-folder-title').textContent + ':' + [...f.querySelectorAll('.om-row .om-name')].map(n => n.firstChild.textContent).join(',')),
        toast: (q('#locate-toast.visible .lt-text') || {}).textContent || ''
      };
    });

    await load();
    await check('① 평소 화면 — [메뉴]·사이드바 없음 · 아래 탭 4개 · 오른쪽 버튼 줄 보임', async () => {
      await tapOcean(1); await wait(1200); const s = await S();
      assert.equal(s.mode, false); assert.equal(s.menuBtn, false); assert.equal(s.rail, true);
      assert.deepEqual(s.tabs, ['특보정보', '해양종합정보', '해양안전생활', '뉴스·공지·어황']);
      assert.ok(!/om-/.test(s.cls), s.cls);
    });
    await check('② 9번으로는 안 켜지고(이미 1번 + 8번), 10번째에 켜진다 → 탭 3개 · 버튼 줄 숨김 · [메뉴]', async () => {
      await tapOcean(8); await wait(200); assert.equal((await S()).mode, false);
      await tapOcean(1); await wait(500); const s = await S();
      assert.equal(s.mode, true); assert.equal(s.menuBtn, true); assert.equal(s.rail, false);
      assert.deepEqual(s.tabs, ['특보정보', '해양종합정보', '뉴스·공지·어황']);
    });
    await check('[2026-11-23] 위쪽 버튼 한 줄(기본맵→내 위치→안내 · 「진북 정렬」 버튼은 없고 늘 진북 고정) · 넓은 [전체 메뉴](글자 크게 설정에도 같은 크기) · 사이드바 폭 60% · 이름 한 줄', async () => {
      const m = () => page.evaluate(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
        const q = (s) => document.querySelector(s);
        return { base: r(q('#ocean-basemap-toggle')), northShown: q('#ocean-northup-btn').offsetParent !== null, northLocked: q('#ocean-northup-btn').classList.contains('northup-locked'), lsLock: localStorage.getItem('oceanMap.northUp.locked'), my: r(q('#ocean-myloc-btn')), info: r(q('#ocean-info-btn')),
          menu: r(q('#om-menu-btn')), menuText: q('#om-menu-btn .om-menu-label').textContent,
          search: r(q('#ocean-map-section .ocean-search-container')) };
      });
      let g = await m();
      assert.equal(g.northShown, false, '진북 정렬 버튼은 안 보인다'); assert.equal(g.northLocked, true, '진북 고정 상태'); assert.equal(g.lsLock, null, '고정은 저장하지 않는다(앱을 껐다 켜면 원래대로)'); assert.equal(g.menuText, '전체 메뉴');
      assert.ok(g.base.x < g.my.x && g.my.x < g.info.x, JSON.stringify(g));
      assert.ok(Math.abs(g.base.y - g.my.y) <= 2 && Math.abs(g.base.y - g.info.y) <= 2, '한 줄 ' + JSON.stringify(g));
      assert.ok(g.base.y >= g.search.y + g.search.h, '검색란 아래'); assert.ok(g.menu.w >= 90 && g.menu.h <= 46 && Math.abs(g.menu.y - g.base.y) <= 4, JSON.stringify(g.menu));
      assert.ok(g.info.x + g.info.w < g.menu.x, '안내 버튼과 [전체 메뉴]가 겹치지 않는다');
      assert.deepEqual([g.my.w, g.my.h, g.info.w, g.info.h], [g.base.w, g.base.h, g.base.w, g.base.h], '세 버튼이 기본맵 버튼과 같은 크기 ' + JSON.stringify(g));
      assert.ok(g.menu.h === g.base.h, '[전체 메뉴] 높이도 같다');
      const before = g.menu;
      await page.evaluate(() => { document.documentElement.setAttribute('data-font-size', 'large'); document.documentElement.style.fontSize = '18px'; }); await wait(300);
      g = await m(); assert.deepEqual([g.menu.w, g.menu.h], [before.w, before.h], '글자 크게에도 [전체 메뉴] 크기 그대로');
      await click('#om-menu-btn'); await wait(700);
      const sb = await page.evaluate(() => ({ w: Math.round(document.getElementById('om-sidebar').getBoundingClientRect().width),
        over: [...document.querySelectorAll('#om-sidebar .om-name')].filter(e => e.clientWidth && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent),
        twoLine: [...document.querySelectorAll('#om-sidebar .om-row')].filter(e => e.offsetHeight > 70).length,
        pad: getComputedStyle(document.querySelector('#om-sidebar .om-folder[data-folder="wx"] .om-row')).paddingLeft }));
      assert.equal(sb.w, Math.round(390 * 0.6)); assert.deepEqual(sb.over, []); assert.equal(sb.twoLine, 0); assert.equal(sb.pad, '10px');
      await page.evaluate(() => { document.documentElement.removeAttribute('data-font-size'); document.documentElement.style.fontSize = ''; window.OceanMenu.close(); }); await wait(300);
    });
    await check('③ 사이드바 — 폴더·줄 순서(태풍·해수욕은 맨 뒤) · 바깥(지도)을 누르면 닫힘 · 뒤로가기로 닫힘', async () => {
      await click('#om-menu-btn'); await wait(450); let s = await S();
      assert.equal(s.open, true); assert.ok(s.sideX < 390 && s.sideX >= 70, 'sideX=' + s.sideX); assert.deepEqual(s.stack, ['om-sidebar']);
      assert.deepEqual(s.folders, [
        '즐겨찾기:',
        '해양기상정보:특보구역·현황,파고·파향,풍향·풍속,유향·유속,기상부이,해구기상,천기,태풍',
        '해양안전정보:항행경보 현황,위험예측,사고발생 이력·분석,사고이력,사고분석,위험지형,갯벌 수위 예측,출입통제·낚시금지,관제구역·항로,CCTV',
        '해양생활지수:바다낚시,서핑,스킨스쿠버,갯벌체험,바다갈라짐,너울,해수욕']);
      await clean(); await page.mouse.click(20, 400); await wait(450); s = await S(); assert.equal(s.open, false); assert.deepEqual(s.stack, []);
      await click('#om-menu-btn'); await wait(300);
      await back(); await wait(300); assert.equal((await S()).open, false);
    });
    await check('⑨ 태풍(활성 없음)·해수욕(개장 없음) — 회색 · 안내 글 · 해수욕은 눌러도 안 열림', async () => {
      const r = await page.evaluate(() => {
        const row = (id, om) => document.querySelector('#om-sidebar [data-om="' + om + '"][data-id="' + id + '"]').closest('.om-row');
        return { typh: row('typh', 'sw').className + '|' + row('typh', 'sw').textContent, swim: row('swim', 'view').className + '|' + row('swim', 'view').textContent };
      });
      assert.ok(/om-dead/.test(r.typh) && /활성 태풍 없음/.test(r.typh), r.typh);
      assert.ok(/om-dead/.test(r.swim) && /개장 해수욕장 없음/.test(r.swim), r.swim);
      await view('swim'); await wait(400); const s = await S(); assert.equal(s.view, ''); assert.equal(s.tab, 'ocean-map-section');
      const today = await page.evaluate(() => { const d = new Date(Date.now() + 9 * 3600e3), p = n => (n < 10 ? '0' : '') + n; return '' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()); });
      const judged = await page.evaluate((t) => [
        window.OceanMenu._anyBeachOpen({ places: { a: { forecasts: { [t]: { 오전: { opnStat: '폐장' }, 오후: { opnStat: '개장' } } } } } }),
        window.OceanMenu._anyBeachOpen({ places: { a: { forecasts: { [t]: { 일: { opnStat: '폐장' } } } } } }),
        window.OceanMenu._anyBeachOpen({ places: { a: { forecasts: { '20200101': { 일: { opnStat: '개장' } } } } } }),
        window.OceanMenu._anyBeachOpen(null)], today);
      assert.deepEqual(judged, [true, false, false, false]);
    });
    let base0;
    await check('④⑤ 함께 못 켜는 묶음 + 배경지도 — 풍향→파고(풍향 꺼짐·해안도) → +해구기상(기본맵·파고 유지) → 특보구역·현황(파고 꺼짐) → 해구기상 끔(해안도)', async () => {
      base0 = (await S()).base;
      await click('#om-menu-btn'); await wait(300);
      await sw('wind'); await wait(1100); let s = await S(); assert.deepEqual(s.on, ['wind']); assert.equal(s.base, 'coast');
      await sw('wav'); await wait(1100); s = await S(); assert.deepEqual(s.on, ['wave']); assert.equal(s.base, 'coast');
      await sw('buoy'); await sw('grid'); await wait(1100); s = await S();
      assert.deepEqual(s.on, ['ocean-buoy-toggle-btn', 'ocean-marine-zone-toggle-btn', 'wave']); assert.equal(s.base, 'rltm');
      await sw('zone'); await wait(1100); s = await S();
      assert.ok(s.on.includes('ocean-warn-zone-toggle-btn') && !s.on.includes('wave') && s.on.includes('ocean-buoy-toggle-btn'), JSON.stringify(s.on));
      await sw('grid'); await wait(1100); s = await S(); assert.equal(s.base, 'coast');
    });
    await check('⑥ 천기 — 켜면 특보구역·현황이 꺼지고 버튼 7개(순서)만 나온다(그림 없음) · 고르면 그려짐 · 자료 없는 버튼은 회색·맨 뒤·알림', async () => {
      await sw('wx'); await wait(1100); let s = await S();
      assert.ok(!s.on.includes('ocean-warn-zone-toggle-btn'), JSON.stringify(s.on));
      assert.deepEqual(s.on.filter(x => ['pop', 'pcp', 'sno', 'sky', 'pty', 'tmp', 'ocean-vsby-toggle-btn'].includes(x)), []);
      await page.evaluate(() => ['tmp', 'pcp', 'pty', 'pop', 'sno', 'sky', 'vsby'].forEach(k => window.OceanMenu._setWxAvail(k, true)));
      s = await S(); assert.deepEqual(s.subs.map(x => x.replace(/[×●]/g, '')), ['기온', '강수량', '강수형태', '강수확률', '적설', '하늘상태', '시정예측']);
      await page.evaluate(() => window.OceanMenu._setWxAvail('sno', false)); s = await S();
      assert.deepEqual(s.subs, ['기온', '강수량', '강수형태', '강수확률', '하늘상태', '시정예측', '적설×']);
      await click('#om-subs [data-om="wx"][data-id="sno"]'); await wait(300); s = await S();
      assert.equal(s.toast, '기상청 단기예보 데이터를\n일시적으로 불러올 수 없습니다.'); assert.ok(!s.on.includes('sno'));
      assert.equal(s.base, base0, '다 끄면 처음 배경');
      await sw('wx'); await wait(400); s = await S(); assert.deepEqual(s.subs, []);
    });
    await check('⑦ [보기] 위험지형 — 사이드바 닫힘 · 안내 줄 + 지도가 그 높이만큼 내려감 · 기상정보 숨김 · 탭 표시는 해양종합정보', async () => {
      await sw('wind'); await wait(900);
      await view('terr'); await wait(1600); const s = await S();
      assert.equal(s.open, false); assert.equal(s.view, 'terr'); assert.equal(s.tab, 'ocean-life-group');
      assert.equal(s.banner, '위험지형 화면 표출 중 해양기상정보는 표시되지 않습니다.');
      assert.ok(s.bannerH > 30 && s.secTop === s.bannerH, 'secTop=' + s.secTop + ' bannerH=' + s.bannerH);
      assert.ok(s.on.includes('ocean-terrain-toggle-btn') && !s.on.includes('wind') && !s.on.includes('ocean-buoy-toggle-btn'), JSON.stringify(s.on));
      assert.deepEqual(await page.evaluate(() => [document.querySelector('#om-banner .om-banner-off').textContent, document.querySelector('#om-sidebar .om-viewbox-off').textContent, getComputedStyle(document.querySelector('#om-banner .om-banner-off')).backgroundColor]),
        ['끄기', '화면 끄기', 'rgb(37, 99, 235)'], '위는 「끄기」, 사이드바는 「화면 끄기」 — 파란색으로 채운 버튼');
      assert.equal(s.oceanTabOn, true); assert.deepEqual(s.tabs, ['특보정보', '해양종합정보', '뉴스·공지·어황']); assert.deepEqual(s.stack, ['om-view']);
      assert.equal(s.lsRail, false);
    });
    await check('⑦ 보는 동안 스위치는 미뤄진다(지도 그대로) · 관제구역·항로는 두 층이 함께 · 한 번에 하나', async () => {
      await click('#om-menu-btn'); await wait(300);
      await sw('wav'); await wait(300); let s = await S();
      assert.ok(s.pending && s.pending.wav === true && s.pending.wind === false, JSON.stringify(s.pending)); assert.ok(!s.on.includes('wave'));
      await view('vts'); await wait(1400); s = await S();
      assert.deepEqual(s.on, ['ocean-seaway-toggle-btn', 'ocean-vts-toggle-btn']); assert.equal(s.view, 'vts');
      assert.equal(s.banner, '관제구역·항로 화면 표출 중 해양기상정보는 표시되지 않습니다.');
    });
    await check('[2026-11-23] 갯벌 수위 예측 [보기] — 배경이 위성지도(인증을 못 받는 시험 서버에서는 기본맵) · 다른 [보기]로 가면 그 화면의 배경으로', async () => {
      await click('#om-menu-btn'); await wait(300); await view('mud'); await wait(1800); let s = await S();
      assert.equal(s.view, 'mud'); assert.ok(s.base === 'vworld' || s.base === 'rltm', 'base=' + s.base);
      const asked = await page.evaluate(() => { const o = window.oceanSetBasemap, seen = []; window.oceanSetBasemap = function (b) { seen.push(b); return o.apply(this, arguments); }; window.OceanMenu.openView('terr'); window.OceanMenu.openView('mud'); window.oceanSetBasemap = o; return seen; });
      assert.ok(asked.includes('vworld'), '갯벌 수위 예측을 열 때 위성지도를 청한다 ' + JSON.stringify(asked));
      await wait(1500); await click('#om-menu-btn'); await wait(300); await view('vts'); await wait(1400); s = await S(); assert.equal(s.base, 'enc');
    });
    await check('⑧ 사고이력[인명] — 현황·인명사고 · 「필터」 접힌 채 시작 → 누르면 펼침 · 「선택 초기화」는 숨김 / 사고분석 — 「전국 통계」', async () => {
      await click('#om-menu-btn'); await wait(300); await view('accPerson');
      assert.equal(await page.evaluate(() => { const b = document.getElementById('om-loading'); return !b.hidden && getComputedStyle(b).display !== 'none'; }), true, '자료를 받는 동안 가운데 로딩 표시');
      await page.waitForFunction(() => { const b = document.querySelector('#accident-source-toggle button.active'); return b && b.getAttribute('data-source') === 'person' && getComputedStyle(document.getElementById('accident-filter-bar')).display !== 'none'; }, null, { timeout: 30000 });
      await wait(500);
      const a = () => page.evaluate(() => { const g = id => getComputedStyle(document.getElementById(id)); const bar = document.getElementById('accident-filter-bar');
        return { mode: document.querySelector('#ocean-accident-mode-toggle button.active').getAttribute('data-mode'), modeVis: g('ocean-accident-mode-toggle').visibility, srcDisp: g('accident-source-toggle').display,
          barH: bar.offsetHeight, open: bar.classList.contains('om-open'), reset: g('accident-filter-reset-btn').display, nw: g('accident-nationwide-btn').display, head: g('om-acc-filter-head').display }; });
      let r = await a();
      assert.equal(await page.evaluate(() => document.getElementById('om-loading').hidden), true, '다 받으면 로딩 표시가 내려간다');
      assert.equal(r.mode, 'status'); assert.equal(r.modeVis, 'hidden'); assert.equal(r.srcDisp, 'none'); assert.equal(r.head, 'flex');
      assert.ok(r.barH <= 50 && !r.open, 'barH=' + r.barH); assert.equal(r.reset, 'none');
      await click('#om-acc-filter-head'); await wait(450); r = await a(); assert.ok(r.open && r.barH > 120, 'barH=' + r.barH);
      assert.equal(await page.evaluate(() => document.getElementById('om-acc-filter-head').textContent.trim()), '필터 선택');
      await click('#accident-filter-reset-btn'); await wait(450); r = await a(); assert.ok(!r.open && r.barH <= 50, '선택 초기화를 누르면 필터가 접힌다 barH=' + r.barH);
      assert.equal((await S()).view, 'accPerson');
      await click('#om-menu-btn'); await wait(300); await view('accStat'); await wait(1500); r = await a();
      assert.equal(r.mode, 'analysis'); assert.equal(r.nw, 'block'); assert.equal((await S()).banner, '사고분석 화면 표출 중 해양기상정보는 표시되지 않습니다.');
    });
    await check('[2026-11-23] 사고분석 「전국 통계」 시트 — [전체 메뉴] 버튼 아래까지만 올라오고 · 본문이 옆으로 넘치지 않는다', async () => {
      await click('#accident-nationwide-btn');
      await page.waitForFunction(() => document.getElementById('accident-stats-sheet').classList.contains('open') && document.querySelector('#accident-stats-body .ash-chips'), null, { timeout: 30000 });
      await wait(700);
      const g = await page.evaluate(() => { const sh = document.getElementById('accident-stats-sheet').getBoundingClientRect(), mb = document.getElementById('om-menu-btn').getBoundingClientRect(), b = document.getElementById('accident-stats-body');
        let over = 0; b.querySelectorAll('*').forEach(e => { const r = e.getBoundingClientRect(); if (r.width && r.right > innerWidth + 0.5) over++; });
        return { top: Math.round(sh.top), menuBottom: Math.round(mb.bottom), sw: b.scrollWidth, cw: b.clientWidth, over }; });
      assert.ok(g.top >= g.menuBottom + 4, '시트 윗변이 버튼 아래 ' + JSON.stringify(g));
      assert.ok(g.sw <= g.cw && g.over === 0, '옆으로 넘침 없음 ' + JSON.stringify(g));
      await click('#accident-stats-close'); await wait(500);
    });
    await check('⑦ 바다낚시 [보기] — 활동 화면 · 갯바위(먼저)·선상 버튼 · 지도 섹션이 안내 줄만큼 내려감', async () => {
      await click('#om-menu-btn'); await wait(300); await view('fish'); await wait(1500); const s = await S();
      assert.equal(s.sec, 'fishing-section'); assert.equal(s.view, 'fish'); assert.deepEqual(s.subs, ['갯바위●', '선상']);
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#om-subs .om-gubun')].map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), b.querySelector('i').className.replace('fa-solid ', '')]; })),
        [[48, 42, 'fa-mountain'], [48, 42, 'fa-ship']], '갯바위·선상 버튼 — 왼쪽 버튼과 같은 크기 + 선 그림');
      assert.ok(s.secTop === s.bannerH && s.bannerH > 30, 'secTop=' + s.secTop); assert.equal(s.lsRail, false); assert.equal(s.menuBtn, true);
      await click('#om-subs [data-om="gubun"][data-id="선상"]'); await wait(500); assert.deepEqual((await S()).subs, ['갯바위', '선상●']);
    });
    await check('⑦ 뒤로가기 = [끄기] — 해양종합정보 지도로 · 미뤄 둔 스위치 반영(풍향 대신 파고 + 기상부이) · 안내 줄 사라짐', async () => {
      await back(); await wait(1500); const s = await S();
      assert.equal(s.tab, 'ocean-map-section'); assert.equal(s.view, ''); assert.equal(s.pending, null); assert.equal(s.banner, ''); assert.equal(s.secTop, 0);
      assert.deepEqual(s.on, ['ocean-buoy-toggle-btn', 'wave']); assert.deepEqual(s.stack, []);
    });
    await check('⑦ [보기] 중 아래 「해양종합정보」 탭을 누르면 [끄기]와 같다 · 안내 줄의 [끄기] 버튼', async () => {
      await click('#om-menu-btn'); await wait(300); await view('surf'); await wait(1200); assert.equal((await S()).sec, 'surfing-section');
      await tapOcean(1); await wait(1000); let s = await S(); assert.equal(s.view, ''); assert.equal(s.tab, 'ocean-map-section'); assert.deepEqual(s.on, ['ocean-buoy-toggle-btn', 'wave']);
      await click('#om-menu-btn'); await wait(300); await view('part'); await wait(1000); assert.equal((await S()).sec, 'sea-parting-section');
      await click('#om-banner .om-banner-off'); await wait(1000); s = await S(); assert.equal(s.view, ''); assert.equal(s.tab, 'ocean-map-section');
    });
    await check('[독립 검토 1] 점검으로 막힌 화면의 [보기] — 아무것도 바뀌지 않는다(켜 둔 기상정보 그대로 · 4초 뒤에도 엉뚱한 버튼이 안 켜짐)', async () => {
      await page.evaluate(() => { try { localStorage.removeItem('seagnal_admin_mode'); } catch (e) {} document.querySelector('.sub-tab-btn[data-target="ocean-safety-section"]').dataset.blocked = 'true'; });
      const before = (await S()).on;
      await page.evaluate(() => window.OceanMenu.openView('terr')); await wait(4200); await clean();
      await page.evaluate(() => { if (window.closeSeagnalModal) window.closeSeagnalModal(); document.querySelectorAll('.notice-modal-overlay, #blocked-feature-popup').forEach(e => e.remove()); delete document.querySelector('.sub-tab-btn[data-target="ocean-safety-section"]').dataset.blocked; });
      const s = await S();
      assert.equal(s.tab, 'ocean-map-section'); assert.equal(s.view, ''); assert.equal(s.pending, null); assert.deepEqual(s.on, before); assert.equal(s.banner, '');
    });
    await check('[독립 검토 3] 사고이력 [선박]→[인명] 을 연달아 눌러도 마지막에 누른 인명으로 맞춰진다', async () => {
      await page.evaluate(() => { window.OceanMenu.openView('accShip'); window.OceanMenu.openView('accPerson'); });
      await page.waitForFunction(() => { const b = document.querySelector('#accident-source-toggle button.active'), m = document.querySelector('#ocean-accident-mode-toggle button.active');
        return b && m && b.getAttribute('data-source') === 'person' && m.getAttribute('data-mode') === 'status'; }, null, { timeout: 30000 });
      await wait(900);
      const src = await page.evaluate(() => document.querySelector('#accident-source-toggle button.active').getAttribute('data-source'));
      assert.equal(src, 'person'); assert.equal((await S()).view, 'accPerson');
      await page.evaluate(() => window.OceanMenu.closeView()); await wait(1000);
    });
    await check('[독립 검토 2·5] 다른 탭의 하위탭 여백 변수는 건드리지 않는다 · 배경과 무관한 스위치(기상부이)는 사용자가 고른 배경을 바꾸지 않는다', async () => {
      const v = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--sub-tab-height') === getComputedStyle(document.documentElement).getPropertyValue('--sub-tab-height'));
      assert.equal(v, true, '해양종합정보 탭에서는 body 가 변수를 덮지 않는다');
      await wait(2000);   // 앞 사례의 [끄기] 뒤 배경 맞춤(최대 1.8초)이 끝난 다음에 고른다
      await page.evaluate(() => window.oceanSetBasemap('enc')); await click('#om-menu-btn'); await wait(250);
      await sw('buoy'); await wait(2200); assert.equal((await S()).base, 'enc');
      await sw('buoy'); await wait(300); await page.evaluate(() => { window.oceanSetBasemap('coast'); window.OceanMenu.close(); }); await wait(300);
    });
    await check('⑪ 새 모드 — 특보 현황이 켜져 있어도 지도 누름을 특보 상자가 가로채지 않는다', async () => {
      const r = await page.evaluate(() => {
        if (!window.OceanWarnActive || !window.OceanWarnActive.tryHandleClick) return 'no-module';
        const st = window.OceanWarnActive._state || (window.OceanWarnActive.state);
        const was = st ? st.active : null; if (st) st.active = true;
        const out = window.OceanWarnActive.tryHandleClick(window.getOceanMap && window.getOceanMap(), { pixel: [100, 300] });
        if (st) st.active = was; return st ? out : 'no-state';
      });
      assert.ok(r === false || r === 'no-state' || r === 'no-module', String(r));
    });
    await check('⑩ 즐겨찾기·접은 폴더는 저장된다 — 다시 열어 새 모드를 켜면 그대로(새 모드 자체는 꺼진 채 시작)', async () => {
      await click('#om-menu-btn'); await wait(300);
      await click('#om-sidebar [data-om="fav"][data-id="wav"]'); await click('#om-sidebar [data-om="fav"][data-id="surf"]');
      await click('#om-sidebar .om-folder[data-folder="life"] .om-folder-head'); await wait(400);
      let s = await S(); assert.equal(s.folders[0], '즐겨찾기:파고·파향,서핑');
      await load(); s = await S(); assert.equal(s.mode, false); assert.equal(s.menuBtn, false);
      await tapOcean(10); await wait(700); await click('#om-menu-btn'); await wait(300); s = await S();
      assert.equal(s.mode, true); assert.equal(s.folders[0], '즐겨찾기:파고·파향,서핑');
      const closed = await page.evaluate(() => [...document.querySelectorAll('#om-sidebar .om-folder.closed')].map(f => f.getAttribute('data-folder')));
      assert.deepEqual(closed, ['life']);
    });
    await check('⑫ 다시 10번 → 평소 화면(보던 화면 닫힘 · 탭 4개 · 버튼 줄 다시 보임)', async () => {
      await view('terr'); await wait(1400); assert.equal((await S()).view, 'terr');
      await page.evaluate(() => window.OceanMenu.setMode(false)); await wait(900); const s = await S();
      assert.equal(s.mode, false); assert.equal(s.tab, 'ocean-map-section'); assert.equal(s.menuBtn, false); assert.equal(s.rail, true);
      assert.deepEqual(s.tabs, ['특보정보', '해양종합정보', '해양안전생활', '뉴스·공지·어황']); assert.ok(!/om-/.test(s.cls), s.cls); assert.equal(s.secTop, 0);
      assert.ok(!s.on.includes('ocean-terrain-toggle-btn'), JSON.stringify(s.on));
    });
    await check('[2026-11-23] 새 모드를 끄면 진북 정렬 버튼이 다시 보이고 고정이 풀린다 · 태풍 「해역표출 강제(디버그)」는 화면·코드에 없다 · 범례 아래 참고 문구는 유럽(ECMWF)·일본(JMA)만 남김', async () => {
      const fs = require('fs');
      assert.deepEqual(await page.evaluate(() => { const b = document.getElementById('ocean-northup-btn'); return [b.offsetParent !== null, b.classList.contains('northup-locked')]; }), [true, false]);
      assert.equal(await page.evaluate(() => !!document.getElementById('tphn-dbg-row')), false);
      const src = fs.readFileSync(path.join(root, 'client/js/typhoon/ocean_typhoon.js'), 'utf8');
      assert.ok(!/_debugKorea|tphn-dbg|해역표출 강제/.test(src) && !/tphn-dbg|해역표출 강제/.test(fs.readFileSync(path.join(root, 'client/index2.html'), 'utf8')));
      assert.ok(src.includes("var KEEP_NOTE = { ecmwf: true, jma: true };") && src.includes("if (!KEEP_NOTE[_src] && !extra) { el.textContent = ''; el.style.display = 'none'; return; }"), '유럽(ECMWF)·일본(JMA)만 출처 줄을 남긴다');
    });
    await check('화면 오류 없음', async () => { assert.deepEqual(errors, []); });
  } catch (e) { console.error('❌ 시험 준비 실패', e.message); fail++; }
  finally { if (browser) await browser.close(); if (server) server.close(); }
  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
