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

(async () => {
    if (!(await serverUp())) {
        console.log(`\n⏭️  건너뜀 — ${BASE} 에 서버가 없다. 먼저 \`node local_server/server.js &\` 로 띄우고 다시 돌릴 것.`);
        console.log('\n0 PASS / 0 FAIL');
        return;
    }

    let chromium;
    try { ({ chromium } = require('playwright')); }
    catch (e) {
        console.log('\n⏭️  건너뜀 — playwright 가 없다(' + e.message + ').');
        console.log('\n0 PASS / 0 FAIL');
        return;
    }

    const exe = process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
    let browser;
    try { browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] }); }
    catch (e) {
        console.log('\n⏭️  건너뜀 — 브라우저를 못 띄웠다(' + e.message + ').');
        console.log('\n0 PASS / 0 FAIL');
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
