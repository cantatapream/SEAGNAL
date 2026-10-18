/**
 * test_hazard_rock_tide_labels.js — 간출암 조석 상자 곡선 위 「현 시각」 라벨이 「잠김」·「노출」 라벨과 겹치지 않게 고정한다.
 *
 * [왜 있나] 2026-10-18 16:20 KST 사용자 화면(「간출암 · 저조 시 2.8m 노출」): 잠김 16:35 ~ 노출 17:0x 처럼
 *   잠긴 구간이 짧고 지금이 그 근처면, 점 아래 「현 시각 16:20」과 교차점 아래 「노출 17:02」가 같은 자리에
 *   겹쳐 둘 다 읽을 수 없었다(「출 …02」만 보임). 잠김 라벨(위)·노출 라벨(아래)이 거의 같은 x 에 서므로
 *   현재 시각 라벨을 위로만 옮겨서는 안 되고 옆으로도 비켜야 한다(hazard_rocks.js renderTideChart).
 *   해양안전 「위험지형」 팝업과 연안 안전 브리핑 바위 상자가 같은 그리기 함수를 쓰므로 한 곳만 본다.
 *
 * [무엇을] 실제 브라우저(Chromium, Playwright)로 window.HazardRockTidePanel.mount 를 띄우고, 서버 응답
 *   (/api/hazard-rocks/tide-curve)은 시험 자료로 가로챈다. 시각은 page.clock 으로 고정(실행 시각과 무관).
 *   ①사용자 상황(짧은 잠김 구간 바로 앞) ②지금이 노출 직후 ③라벨이 겹칠 일이 없는 보통 상황(종전 자리 그대로 —
 *   점 아래) 셋을 그려, 글자 상자(getBBox)끼리 겹치지 않는지와 그림 밖으로 나가지 않는지 잰다.
 *   화면은 SHOT_DIR(기본: 운영체제 임시 폴더)에 남긴다.
 *
 * [실행] NODE_PATH=…/node_modules node local_server/scripts/test_hazard_rock_tide_labels.js
 *   브라우저를 못 띄우는 환경이면 「0 PASS / 0 FAIL」(verify_all 이 ⏭️ 로 따로 센다 — 통과로 치지 않는다).
 * [연계] ← scripts/refactor/verify_all.sh SUITES → client/js/marine-life/safety/hazard_rocks.js(renderTideChart)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'client', 'js', 'marine-life', 'safety', 'hazard_rocks.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'client', 'index2.html'), 'utf8');
const CSS = (HTML.match(/\.hazard-rock-popup\.rock-tide-popup \{[\s\S]*?\.rock-tide-popup \.rtp-wave[^\n]*/) || [''])[0];
const SHOT_DIR = process.env.SHOT_DIR || os.tmpdir();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

/** 10분 간격 하루치 — 정점(peakMin, peakCm) 둘레가 반정현파. 잠김 기준선 바로 위로 살짝 올라 짧게 잠기게 만든다. */
function curve(peakMin, peakCm) {
    const pts = [];
    for (let m = 0; m < 1440; m += 10) {
        const cm = (peakCm - 83) + 83 * Math.cos(2 * Math.PI * (m - peakMin) / 745);
        pts.push({ t: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, cm: Math.round(cm * 10) / 10 });
    }
    return pts;
}
const BODY = { success: true, ready: true, date: 20261018, region: 'jeju', valsouCm: 280,
    points: curve(1008, 280.5),   // 정점 16:48 280.5cm → 280cm 를 16:35 무렵 넘고 17:01 무렵 내려온다(짧은 잠김)
    peaks: [{ t: '02:30', cm: 228, type: 'high' }, { t: '09:20', cm: 127, type: 'low' }, { t: '16:50', cm: 280, type: 'high' }, { t: '23:00', cm: 190, type: 'low' }],
    prevPeaks: [], submergedAt: ['16:35'] };

(async () => {
    console.log('\n[1] 현재 시각 라벨 — 잠김·노출 라벨과 겹치지 않는다(Chromium)');
    let chromium;
    try { ({ chromium } = require('playwright-core')); } catch (e) { console.log('  ⏭️ playwright-core 없음 — 건너뜀'); console.log(`\n${pass} PASS / ${fail} FAIL`); return; }
    let browser;
    try {
        const exe = process.env.PW_CHROME || process.env.SIM_CHROMIUM || process.env.CHROMIUM_EXECUTABLE;
        browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), headless: true, args: ['--no-sandbox'] });
    } catch (e) { console.log('  ⏭️ 브라우저를 띄우지 못함 — 건너뜀: ' + (e && e.message || '').split('\n')[0]); console.log(`\n${pass} PASS / ${fail} FAIL`); return; }

    /** nowKst("HH:MM") 에 상자를 그리고 세 라벨 상자를 잰다. @returns {Promise<{now,boxes,svg,errors}>} */
    async function draw(nowKst, shotName) {
        const ctx = await browser.newContext({ viewport: { width: 380, height: 640 }, timezoneId: 'Asia/Seoul', deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.clock.setFixedTime(new Date(`2026-10-18T${nowKst}:00+09:00`));
        await page.route('**/*', (r) => {
            const u = r.request().url();
            if (u === 'http://hr.test/') return r.fulfill({ contentType: 'text/html', body:
                `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#0b1220;font-family:sans-serif} ${CSS}</style></head>` +
                `<body><div id="box" class="hazard-rock-popup rock-tide-popup" style="width:340px;margin:10px"></div></body></html>` });
            if (u.startsWith('http://hr.test/api/hazard-rocks/tide-curve')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(BODY) });
            if (u === 'http://hr.test/hr.js') return r.fulfill({ contentType: 'application/javascript', body: SRC });
            return r.abort();
        });
        await page.goto('http://hr.test/');
        await page.addScriptTag({ url: 'http://hr.test/hr.js' });
        await page.evaluate(() => window.HazardRockTidePanel.mount(document.getElementById('box'), { rockId: 1, v: 2.8, lon: 126.2, lat: 33.4, onClose: () => {} }));
        await page.waitForSelector('.rtp-svg text tspan', { timeout: 5000 });
        await page.waitForTimeout(200);
        const r = await page.evaluate(() => {
            const svg = document.querySelector('.rtp-svg');
            const vb = svg.viewBox.baseVal;
            const boxes = {};
            svg.querySelectorAll('text').forEach((t) => {
                const first = t.querySelector('tspan');
                if (!first) return;
                const k = first.textContent;
                if (k === '현 시각' || k === '잠김' || k === '노출') { const b = t.getBBox(); boxes[k] = { x1: b.x, x2: b.x + b.width, y1: b.y, y2: b.y + b.height, text: t.textContent }; }
            });
            return { boxes, vb: { w: vb.width, h: vb.height } };
        });
        const file = path.join(SHOT_DIR, shotName);
        await page.locator('#box').screenshot({ path: file });
        await ctx.close();
        return { ...r, errors, file };
    }
    const overlap = (a, b) => !!(a && b) && a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    const inside = (a, vb) => !!a && a.x1 >= 0 && a.x2 <= vb.w && a.y1 >= 0 && a.y2 <= vb.h;

    try {
        // ① 사용자 상황 — 16:20, 잠김 16:35 · 노출 17:01 (구간 26분 ≈ 가로 5px)
        const a = await draw('16:20', 'hr_label_case1_1620.png');
        console.log('     화면: ' + a.file);
        ok('① 화면 오류 없음', a.errors.length === 0, a.errors.join(' | '));
        ok('① 세 라벨이 다 그려졌다(잠김·노출·현 시각)', a.boxes['잠김'] && a.boxes['노출'] && a.boxes['현 시각'], Object.keys(a.boxes).join(','));
        ok('① 현 시각 ↔ 노출 라벨이 겹치지 않는다', !overlap(a.boxes['현 시각'], a.boxes['노출']), JSON.stringify([a.boxes['현 시각'], a.boxes['노출']]));
        ok('① 현 시각 ↔ 잠김 라벨이 겹치지 않는다', !overlap(a.boxes['현 시각'], a.boxes['잠김']), JSON.stringify([a.boxes['현 시각'], a.boxes['잠김']]));
        ok('① 현 시각 라벨이 그림 안에 있다', inside(a.boxes['현 시각'], a.vb), JSON.stringify(a.boxes['현 시각']));
        ok('① 라벨 글자가 그대로다(16:20)', a.boxes['현 시각'] && a.boxes['현 시각'].text === '현 시각16:20', a.boxes['현 시각'] && a.boxes['현 시각'].text);

        // ② 지금이 노출 직후(17:10)
        const b = await draw('17:10', 'hr_label_case2_1710.png');
        console.log('     화면: ' + b.file);
        ok('② 현 시각 ↔ 노출 라벨이 겹치지 않는다', !overlap(b.boxes['현 시각'], b.boxes['노출']), JSON.stringify([b.boxes['현 시각'], b.boxes['노출']]));
        ok('② 현 시각 ↔ 잠김 라벨이 겹치지 않는다', !overlap(b.boxes['현 시각'], b.boxes['잠김']));
        ok('② 현 시각 라벨이 그림 안에 있다', inside(b.boxes['현 시각'], b.vb), JSON.stringify(b.boxes['현 시각']));

        // ③ 겹칠 일이 없는 보통 상황(08:00 — 잠김 구간과 멀다) → 종전 자리(점 바로 아래) 그대로
        const c = await draw('08:00', 'hr_label_case3_0800.png');
        console.log('     화면: ' + c.file);
        const nowCx = c.boxes['현 시각'] ? (c.boxes['현 시각'].x1 + c.boxes['현 시각'].x2) / 2 : NaN;
        const expectX = 30 + (480 / 1440) * (320 - 30 - 8);   // renderTideChart X(08:00)
        ok('③ 겹칠 일이 없으면 현 시각 라벨은 점 바로 아래(가로 위치 그대로)', Math.abs(nowCx - expectX) < 2, `${nowCx} vs ${expectX}`);
    } finally {
        await browser.close();
    }

    console.log('\n[2] 코드에 남아 있어야 할 것');
    ok('현재 시각 라벨 자리를 잠김·노출 라벨 상자와 대어 고른다', /labelBoxes\.some\(function \(o\) \{ return boxesOverlap\(bx, o\); \}\)/.test(SRC));
    ok('옆으로 비키는 후보가 있다(짧은 잠김 구간 — 위·아래가 다 막힘)', /var sides = nowX <= labelsMidX/.test(SRC));
    ok('verify_all.sh SUITES 에 이 스위트가 있다', /test_hazard_rock_tide_labels/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8')));

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.log('  ❌ 실행 오류 — ' + (e && e.stack || e)); console.log(`\n${pass} PASS / ${fail + 1} FAIL`); process.exit(1); });
