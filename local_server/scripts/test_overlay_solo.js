/**
 * test_overlay_solo.js — 해양안전 오버레이가 "한 번에 하나만" 켜지는지 실제로 눌러 본다.
 *
 * [왜 있나] 2026-09-10 사용자 보고: 사고정보와 위험지형이 화면에 겹쳐 나온다.
 *   원인은 **자료를 받는 동안 들어온 "꺼라" 가 버려지는 것**이었다. 버튼 8개는
 *   life_safety.js 의 _bindSoloOverlays 가 "한 번에 하나만" 켜지도록 묶어 두는데,
 *   그 장치는 `active` 표시가 붙은 버튼만 찾아서 끈다. 그런데 사고정보(7.1MB)와
 *   위험지형(갯바위 4.7MB)은 그 표시를 **자료를 다 받은 뒤에야** 붙이고 있어서,
 *   받는 동안에는 끌 대상으로 보이지 않았다. 그러고는 자료가 도착하면 취소된 줄
 *   모르고 스스로 켜져 두 화면이 겹쳤다. 전수 시험 결과 56쌍 중 14쌍이 깨져 있었다
 *   (위험지형이 먼저 켜진 7쌍 + 사고정보가 먼저 켜진 7쌍).
 *
 * [왜 소스만 읽어서는 안 되나] 이 결함은 "무엇을 썼나" 가 아니라 "언제 실행되나" 의
 *   문제라, 파일을 읽는 것만으로는 안 잡힌다. 실제로 눌러 봐야 한다.
 *
 * [왜 응답을 일부러 늦추나] 처음 만든 시험은 0건으로 통과했는데, 자료가 이미 캐시에
 *   있어 0.25초 만에 로딩이 끝나 **"받는 중에 누르기" 라는 조건 자체가 성립하지
 *   않았기** 때문이다. 손으로 재현한 버그조차 못 잡는 시험은 통과해도 의미가 없다.
 *   그래서 화면이 다 뜬 뒤 오가는 자료 요청(.json · /api/)마다 DELAY 만큼 지연시켜,
 *   어느 환경에서 돌려도 "받는 중" 창이 반드시 열려 있게 만든다.
 *
 * [무엇을 보나] A 를 켜고 아직 받는 중일 때 B 를 누른 뒤, 다 끝난 화면이
 *   "B 만 켠 화면" 과 똑같은지 본다. 버튼의 active 표시뿐 아니라 **지도에 실제로
 *   그려진 벡터 레이어의 원본 도형 수**까지 맞대어 보므로, 버튼은 꺼졌는데 그림만
 *   남는 경우도 잡는다(위험지형이 실제로 그랬다).
 *
 * [실행]
 *   node local_server/server.js &                      # 먼저 서버를 띄운다
 *   node local_server/scripts/test_overlay_solo.js     # 기본: 빠른 4쌍(약 2분)
 *   node local_server/scripts/test_overlay_solo.js --full   # 전수 56쌍(약 25분)
 *   서버가 안 떠 있으면 검사를 건너뛴다(0 PASS / 0 FAIL) — verify_all.sh 의 V6 과 같은 방식.
 *
 * [이 환경에서 못 보는 것] 물빠짐·항행경보는 외부(기상청·해양조사원) 자료가 있어야
 *   켜지므로, 망이 막힌 곳에서는 눌러도 아무것도 안 뜬다. 그 두 개가 "먼저 켜는 쪽"
 *   인 쌍은 결과가 무의미하니 --full 결과를 읽을 때 감안할 것.
 *
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → client/js/marine-life/safety/life_safety.js (_bindSoloOverlays — 한 번에 하나만)
 *        → client/js/marine-life/safety/hazard_rocks.js (bindToggle — 켜짐 표시를 즉시 붙임)
 *        → client/js/marine-life/safety/accident_info.js (bindUi — 켜짐 표시를 즉시 붙임)
 */
'use strict';

const BASE = process.env.SIM_URL || 'http://localhost:3001';
const DELAY = Number(process.env.DELAY || 2500);   // 자료 응답을 늦추는 시간
const GAP = Number(process.env.GAP || 400);        // A 누르고 B 누르기까지
const SETTLE = Number(process.env.SETTLE || 14000); // 늦춘 응답까지 다 도착하기를 기다리는 시간
const FULL = process.argv.indexOf('--full') >= 0;

const BTNS = [
    { id: 'ocean-terrain-toggle-btn',  name: '위험지형' },
    { id: 'ocean-accident-toggle-btn', name: '사고정보' },
    { id: 'ocean-banzone-toggle-btn',  name: '금지구역' },
    { id: 'ocean-navwarn-btn',         name: '항행경보' },
    { id: 'ocean-mudflat-toggle-btn',  name: '물빠짐'   },
    { id: 'ocean-cctv-toggle-btn',     name: 'CCTV'    },
    { id: 'ocean-vts-toggle-btn',      name: '관제구역' },
    { id: 'ocean-seaway-toggle-btn',   name: '항로·해역' }
];

// 빠른 검사에서 쓸 쌍 — 실제로 깨졌던 두 버튼(위험지형·사고정보)을 양방향으로 본다.
//   상대는 관제구역(33개, 자료가 저장소 안에 있어 어디서나 켜진다)으로 고정.
const QUICK = [['위험지형', '관제구역'], ['사고정보', '관제구역'],
               ['관제구역', '위험지형'], ['관제구역', '사고정보']];

const SNAP = `(() => {
  const map = window.getOceanMap && window.getOceanMap();
  const sig = [];
  if (map) map.getLayers().getArray().forEach((l) => {
    if (!l.getVisible || !l.getVisible()) return;
    let s = null; try { s = l.getSource && l.getSource(); } catch(e){}
    if (!s) return;
    let raw = null;
    try {
      // 클러스터 레이어는 한 겹 안쪽이 원본이다(뭉친 개수는 줌에 따라 변해 못 쓴다).
      if (s.getSource && s.getSource() && s.getSource().getFeatures) raw = s.getSource().getFeatures().length;
      else if (s.getFeatures) raw = s.getFeatures().length;
    } catch(e){}
    if (raw === null || raw === 0) return;
    sig.push((l.getZIndex && l.getZIndex()) + ':' + raw);
  });
  const on = [];
  ${JSON.stringify(BTNS)}.forEach(b => { const e = document.getElementById(b.id); if (e && e.classList.contains('active')) on.push(b.name); });
  const dom = [];
  [['terrain-legend','위험지형범례'],['mudflat-slider-bar','물빠짐슬라이더'],['ocean-accident-mode-toggle','사고정보모드토글'],
   ['banzone-legend','금지구역범례'],['navwarn-date-nav','항행경보날짜바']].forEach(([id,label]) => {
    const e = document.getElementById(id);
    if (e && getComputedStyle(e).display !== 'none') dom.push(label);
  });
  return { sig: sig.sort().join(' | '), on: on.sort().join(','), dom: dom.sort().join(',') };
})()`;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? '\n' + detail : '')); }
}

/** 서버가 떠 있나 — 안 떠 있으면 검사를 건너뛴다(다른 사람 로컬에서 게이트가 헛되이 깨지지 않게). */
function serverUp() {
    return fetch(BASE + '/', { method: 'GET' }).then(r => r.ok).catch(() => false);
}

/**
 * 버튼을 순서대로 누르고 최종 화면 상태를 돌려준다.
 * 예: run(browser, ['ocean-terrain-toggle-btn','ocean-vts-toggle-btn'])
 *     → 위험지형을 켜고 0.4초 뒤(아직 받는 중) 관제구역을 누른 결과
 */
async function run(browser, ids) {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const p = await ctx.newPage();
    try {
        await p.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
        await p.waitForTimeout(3500);
        const clear = () => p.evaluate(() =>
            document.querySelectorAll('.notice-modal-overlay, #server-maintenance-popup, .modal-overlay').forEach(e => e.remove()));
        await clear();
        await p.click('.main-tabs .tab-btn[data-target="ocean-life-group"]');
        await p.waitForTimeout(2500);
        await clear();
        // 여기서부터 자료 응답을 늦춘다 — 첫 화면 로딩은 이미 끝난 뒤라 영향 없음.
        await p.route('**/*', async (route) => {
            const u = route.request().url();
            if (/\.json(\?|$)/.test(u) || u.indexOf('/api/') >= 0) await new Promise(r => setTimeout(r, DELAY));
            await route.continue();
        });
        for (let i = 0; i < ids.length; i++) {
            await p.click('#' + ids[i]);
            if (i < ids.length - 1) await p.waitForTimeout(GAP);
        }
        await p.waitForTimeout(SETTLE);
        return await p.evaluate(SNAP);
    } finally { await ctx.close(); }
}

/**
 * 사고 통계 시트를 열어 놓고 "화면에 보이는데 눌리지는 않는 버튼" 이 있는지 본다.
 * 감춰진 버튼은 괜찮다 — 눌리지도 않으면서 보이는 것이 사용자를 헷갈리게 한다.
 */
async function checkNoDeadButtons(browser) {
    const W = 375, H = 667;   // 시트가 가장 높이 올라오는 작은 화면
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true });
    const p = await ctx.newPage();
    try {
        await p.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
        await p.waitForTimeout(3500);
        const clear = () => p.evaluate(() =>
            document.querySelectorAll('.notice-modal-overlay, #server-maintenance-popup, .modal-overlay').forEach(e => e.remove()));
        await clear();
        await p.click('.main-tabs .tab-btn[data-target="ocean-life-group"]');
        await p.waitForTimeout(2500); await clear();
        await p.tap('#ocean-accident-toggle-btn');
        await p.waitForTimeout(9000);
        await p.touchscreen.tap(Math.round(W / 2), Math.round(H / 2));   // 격자 한 칸 → 통계 시트
        await p.waitForTimeout(2500);
        const r = await p.evaluate(`(() => {
          const sheet = document.getElementById('accident-stats-sheet');
          const dead = [];
          ${JSON.stringify(BTNS)}.forEach((btn) => {
            const e = document.getElementById(btn.id); if (!e) return;
            const b = e.getBoundingClientRect();
            if (b.width === 0 || b.height === 0) return;   // 감춰진 건 괜찮다
            const t = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
            if (!(t && (t === e || e.contains(t)))) dead.push(btn.name);
          });
          const close = document.querySelector('#accident-stats-sheet .ocean-sheet-close');
          let closeOk = false;
          if (close) { const b = close.getBoundingClientRect();
            const t = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
            closeOk = !!(t && (t === close || close.contains(t))); }
          return { open: !!(sheet && sheet.classList.contains('open')), dead, closeOk };
        })()`);
        ok('통계 시트가 열렸다(시험 전제)', r.open, '        시트가 안 열려 이 검사는 의미가 없다');
        ok('시트가 열려 있어도 "보이는데 눌리지 않는" 버튼이 없다', r.dead.length === 0,
            '        눌리지 않는 버튼: ' + r.dead.join(', '));
        ok('시트를 닫는 버튼은 눌린다(갇히지 않는다)', r.closeOk);
    } finally { await ctx.close(); }
}

/**
 * 자료를 받다가 통신이 끊긴 뒤, 신호가 돌아와 버튼을 다시 누르면 회복되는가.
 *
 * [왜 있나] 2026-09-11 사용자 보고 "버튼이 갑자기 안 눌린다".
 *   사고정보(7.1MB)·위험지형(갯바위 4.7MB)은 받아 온 결과를 약속(promise)으로
 *   기억해 두는데, **실패한 약속까지 그대로 기억**했다. 그래서 한 번이라도 받기가
 *   끊기면(신호 약화·LTE↔WiFi 전환 등) 그 뒤로는 버튼을 눌러도 받으러 가지도 않고
 *   즉시 실패해, 앱을 껐다 켜기 전까지 계속 먹통이었다.
 *   A/B 로 확인했다 — 고치기 전에는 회복 후에도 0개, 고친 뒤에는 정상 표출.
 * [왜 통신을 끊어 시험하나] 이 결함은 "성공했을 때"는 절대 드러나지 않는다.
 *   실패를 한 번 만들어야만 보인다.
 */
async function checkRecoversAfterNetworkDrop(browser) {
    const CASES = [
        { id: 'ocean-accident-toggle-btn', name: '사고정보' },
        { id: 'ocean-terrain-toggle-btn', name: '위험지형' }
    ];
    const COUNT = `(() => {
      const map = window.getOceanMap && window.getOceanMap();
      let n = 0;
      if (map) map.getLayers().getArray().forEach(l => {
        if (!l.getVisible || !l.getVisible()) return;
        let s = null; try { s = l.getSource && l.getSource(); } catch(e){}
        if (!s) return; let raw = null;
        try { if (s.getSource && s.getSource() && s.getSource().getFeatures) raw = s.getSource().getFeatures().length;
              else if (s.getFeatures) raw = s.getFeatures().length; } catch(e){}
        if (raw) n += raw;
      });
      return n;
    })()`;
    for (const c of CASES) {
        const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
        const p = await ctx.newPage();
        try {
            await p.goto(BASE + '/', { waitUntil: 'load', timeout: 60000 });
            await p.waitForTimeout(3500);
            const clear = () => p.evaluate(() =>
                document.querySelectorAll('.notice-modal-overlay, #server-maintenance-popup, .modal-overlay').forEach(e => e.remove()));
            await clear();
            await p.click('.main-tabs .tab-btn[data-target="ocean-life-group"]');
            await p.waitForTimeout(2500); await clear();

            await ctx.setOffline(true);          // 신호가 끊긴 상태에서 누른다
            await p.click('#' + c.id);
            await p.waitForTimeout(6000);
            const failed = await p.evaluate(COUNT);
            await ctx.setOffline(false);         // 신호 회복
            await p.waitForTimeout(1000);
            // 켜진 표시가 남아 있으면 먼저 꺼야 다음 클릭이 "켜기" 가 된다
            if (await p.evaluate(`document.getElementById('${c.id}').classList.contains('active')`)) {
                await p.click('#' + c.id); await p.waitForTimeout(1500);
            }
            await p.click('#' + c.id);
            await p.waitForTimeout(10000);
            const after = await p.evaluate(COUNT);
            ok(`${c.name} — 통신이 끊긴 채 누르면 아무것도 안 그려진다(시험 전제)`, failed === 0,
                `        그려진 도형 ${failed}개 — 끊기가 안 걸려 이 검사는 의미가 없다`);
            ok(`${c.name} — 신호가 돌아온 뒤 다시 누르면 정상 표출된다`, after > 0,
                `        그려진 도형 ${after}개 — 실패를 기억해 버려 계속 먹통이다`);
        } finally { await ctx.close(); }
    }
}

(async () => {
    if (!(await serverUp())) {
        console.log(`\n⏭️  건너뜀 — ${BASE} 에 서버가 없다. 먼저 \`node local_server/server.js &\` 로 띄우고 다시 돌릴 것.`);
        console.log('\n0 PASS / 0 FAIL');
        return;
    }

    // ⚠2026-09-22(G-34) — 여기는 `playwright` 만 찾았다. 그런데 이 저장소에 실제로 깔려 있는
    //   것은 **`playwright-core`** 다(두 묶음은 브라우저 조작 API 가 같다). 그래서 이 스위트는
    //   **한 번도 돌지 않고** `0 PASS / 0 FAIL` 만 찍어 왔고, verify_all 은 그것을 ✅ 로 셌다.
    //   둘 다 받아들인다 — 먼저 `playwright`, 없으면 `playwright-core`.
    let chromium = null, pwErr = null;
    for (const mod of ['playwright', 'playwright-core']) {
        try { ({ chromium } = require(mod)); break; } catch (e) { pwErr = e; }
    }
    if (!chromium) {
        console.log('\n⏭️  건너뜀 — playwright 도 playwright-core 도 없다(' + pwErr.message.split('\n')[0] + ').');
        console.log('\n0 PASS / 0 FAIL (SKIPPED: playwright 없음)');
        return;
    }

    // ⚠2026-09-22(G-33·G-34) — 여기는 `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` 이
    //   **판번호까지 박혀** 있었다. 그 판이 없는 자리(깃허브 CI·다른 기계·브라우저를 올린 뒤)
    //   에서는 못 띄우고 **`0 PASS / 0 FAIL` 을 찍고 조용히 돌아갔다** — 그러면 verify_all 이
    //   그것을 ✅ 로 센다. 즉 **아무것도 안 돌린 스위트가 통과로 잡혀 왔다.**
    //   경로를 박지 말고 환경에게 묻는다(순서는 simulate.js resolveChromium 과 같다).
    const cand = [];
    if (process.env.PW_CHROME) cand.push(process.env.PW_CHROME);
    try { cand.push(chromium.executablePath()); } catch (_) { /* 판을 모르면 건너뛴다 */ }
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
        cand.push(require('path').join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium'));
    }
    const fsx = require('fs');
    const exe = cand.find(c => { try { return c && fsx.existsSync(c); } catch (_) { return false; } });
    let browser;
    try { browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox'] }); }
    catch (e) {
        // ⚠건너뛴다는 사실을 **결과줄에 남긴다** — `0 PASS / 0 FAIL` 만 찍으면 통과처럼 보인다.
        console.log('\n⏭️  건너뜀 — 브라우저를 못 띄웠다(' + e.message + ').');
        console.log('\n0 PASS / 0 FAIL (SKIPPED: 브라우저 없음)');
        return;
    }

    const byName = {};
    BTNS.forEach(b => { byName[b.name] = b; });
    const pairs = FULL
        ? BTNS.flatMap(a => BTNS.filter(x => x.name !== a.name).map(x => [a.name, x.name]))
        : QUICK;

    // 비교 기준: "B 만 켠 화면". 필요한 B 만 미리 찍어 둔다.
    console.log(`\n[해양안전] 한 번에 하나만 — ${FULL ? '전수 ' + pairs.length : '빠른 ' + pairs.length}쌍` +
                ` (자료응답 ${DELAY}ms 지연 · 간격 ${GAP}ms)`);
    const base = {};
    for (const name of [...new Set(pairs.map(x => x[1]))]) {
        base[name] = await run(browser, [byName[name].id]);
    }

    // ── 보이는데 눌리지 않는 버튼이 있으면 안 된다 (2026-09-11 사용자 보고) ──
    //   사고 통계 시트(#accident-stats-sheet, z-index 70)가 열리면 버튼 묶음
    //   (#ocean-overlay-controls, z-index 50)이 그 아래 깔려 눌리지 않았다. 시트가
    //   얼마나 높이 올라오는지가 화면 크기를 따라가서, 작은 화면(375×667)에서는
    //   사고정보 버튼까지 덮였고 — 그러면 끌 수도 없어 7개 버튼이 계속 먹통이 됐다.
    //   화면 크기에 따라 달라지므로 작은 화면으로 확인한다.
    await checkNoDeadButtons(browser);
    await checkRecoversAfterNetworkDrop(browser);

    for (const [an, bn] of pairs) {
        const got = await run(browser, [byName[an].id, byName[bn].id]);
        const want = base[bn];
        const same = got.sig === want.sig && got.on === want.on && got.dom === want.dom;
        ok(`${an} 를 받는 중에 ${bn} 를 누르면 ${bn} 만 남는다`, same,
            `        기대(${bn}만) 켜짐=[${want.on}] 화면=[${want.dom}] 레이어=[${want.sig}]\n` +
            `        실제        켜짐=[${got.on}] 화면=[${got.dom}] 레이어=[${got.sig}]`);
    }

    await browser.close();
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
})();
