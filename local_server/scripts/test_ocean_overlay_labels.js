/**
 * test_ocean_overlay_labels.js — 해양종합정보 색칠 지도 위 수치 라벨(ocean_overlay_labels.js)을 고정한다.
 *
 * [왜 있나] 2026-11-18 사용자 확정 시안: 풍향·풍속/파고·파향 = 색 경계 등치선 + 값 라벨(빽빽),
 *   유향·유속 = 검정 테두리 흰 화살표 + 값(방위 글자 없음, 보통), 범례로 단위를 바꾸면 라벨도 같이.
 *   글자·간격·화살표 모양이 나중에 조용히 바뀌지 않게 잰다.
 *
 * [무엇을] 브라우저 없이 node 에서 파일을 읽어 window.OceanOverlayLabels 를 꺼내고,
 *   ①라벨 글자(m/s·kts·m, 방위 글자 없음) ②격자 간격 고르기 ③등치선 조각(marching squares — 자료 없는 칸
 *   건너뜀·안장 칸 두 조각) ④등치선 라벨 간격(다른 라벨 70px·같은 선 170px)·육지/여백 건너뜀
 *   ⑤유향·유속 화살표 = 검정 테두리 + 흰 칠, 동그라미 없음, 방위 글자 없음 — 을 가짜 캔버스로 기록해 본다.
 *
 * [실행] node local_server/scripts/test_ocean_overlay_labels.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES → client/js/ocean-map/map/ocean_overlay_labels.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'client', 'js', 'ocean-map', 'map', 'ocean_overlay_labels.js'), 'utf8');
const sandbox = { window: {}, Math, Float32Array };
vm.runInNewContext(SRC, sandbox);
const L = sandbox.window.OceanOverlayLabels;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

/** 그리기 호출을 기록하는 가짜 캔버스. measureText 는 글자당 7px. */
function fakeCtx() {
    const log = [];
    let state = {};
    const stack = [];
    const ctx = {
        log,
        save() { stack.push(Object.assign({}, state)); },
        restore() { state = stack.pop() || {}; },
        translate(x, y) { log.push({ op: 'translate', x, y }); },
        rotate(r) { log.push({ op: 'rotate', r }); },
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, rect() {}, roundRect() {},
        arc() { log.push({ op: 'arc' }); },
        stroke() { log.push({ op: 'stroke', style: ctx.strokeStyle, width: ctx.lineWidth }); },
        fill() { log.push({ op: 'fill', style: ctx.fillStyle }); },
        fillText(t, x, y) { log.push({ op: 'fillText', t, x, y }); },
        strokeText(t) { log.push({ op: 'strokeText', t }); },
        measureText(t) { return { width: String(t).length * 7 }; }
    };
    return ctx;
}

console.log('── ① 라벨 글자 ──');
ok('바람 8 → "8m/s"', L.contourLabelText('wind', 8, false) === '8m/s');
ok('바람 8 kts → "16kts"', L.contourLabelText('wind', 8, true) === '16kts');
ok('파고 1.5 → "1.5m" (kts 무시)', L.contourLabelText('wave', 1.5, true) === '1.5m');
ok('유속 63cm/s → "0.6m/s"', L.currentLabelText(63, false) === '0.6m/s');
ok('유속 63cm/s kts → "1.2kts"', L.currentLabelText(63, true) === '1.2kts');
ok('유속 글자에 방위(북·남·동·서) 없음', !/[북남동서]/.test(L.currentLabelText(63, false)));
ok('등치선 값 = 범례 색 경계(바람)', JSON.stringify(L.CONTOUR_THRESHOLDS.wind) === '[2,5,8,12,16,20]');
ok('등치선 값 = 범례 색 경계(파고)', JSON.stringify(L.CONTOUR_THRESHOLDS.wave) === '[0.5,1,1.5,2,3,4]');

console.log('── ② 격자 간격 ──');
ok('200px/° → 0.5°', L.pickGridStep(200, 84) === 0.5);
ok('400px/° → 0.25°', L.pickGridStep(400, 84) === 0.25);
ok('20px/° → 3°(마지막 칸)', L.pickGridStep(20, 84) === 3);

console.log('── ③ 등치선 조각 ──');
{
    const segs = L.contourSegments([0, 10, 0, 10], 2, 2, 10, [5]);
    ok('세로 경계 한 조각', segs.length === 1 && Math.abs(segs[0].x0 - 5) < 1e-9 && Math.abs(segs[0].x1 - 5) < 1e-9, JSON.stringify(segs));
    const none = L.contourSegments([0, 10, NaN, 10], 2, 2, 10, [5]);
    ok('자료 없는 칸(NaN) 건너뜀', none.length === 0);
    const saddle = L.contourSegments([10, 0, 0, 10], 2, 2, 10, [5]);   // a=10 b=0 / d=0 c=10
    ok('안장 칸 → 두 조각', saddle.length === 2);
    const flat = L.contourSegments([1, 1, 1, 1], 2, 2, 10, [5]);
    ok('경계 없는 칸 → 조각 없음', flat.length === 0);
}

console.log('── ④ 등치선 라벨 간격·자리 ──');
{
    // 화면 600×800, x=300 에 세로로 긴 8m/s 선, x=330 에 12m/s 선 (서로 30px — 가까움)
    const segs = [];
    for (let y = 0; y < 800; y += 4) {
        segs.push({ th: 8, x0: 300, y0: y, x1: 300, y1: y + 4 });
        segs.push({ th: 12, x0: 330, y0: y, x1: 330, y1: y + 4 });
    }
    const ctx = fakeCtx();
    const n = L.drawContourLabels(ctx, segs, { layer: 'wind', useKts: false, w: 600, h: 800, isSea: () => true });
    const pos = ctx.log.filter((e) => e.op === 'translate');
    const texts = ctx.log.filter((e) => e.op === 'fillText').map((e) => e.t);
    let minAny = Infinity;
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) {
        minAny = Math.min(minAny, Math.hypot(pos[i].x - pos[j].x, pos[i].y - pos[j].y));
    }
    ok('라벨이 놓임', n >= 3, 'n=' + n);
    ok('라벨끼리 70px 이상', minAny >= 70, 'min=' + minAny.toFixed(1));
    ok('위·아래 여백에는 안 놓음', pos.every((p) => p.y >= 8 && p.y <= 788));
    ok('글자 = "8m/s" 또는 "12m/s"', texts.every((t) => t === '8m/s' || t === '12m/s'), texts.join(','));
    const ctxKts = fakeCtx();
    L.drawContourLabels(ctxKts, segs, { layer: 'wind', useKts: true, w: 600, h: 800, isSea: () => true });
    ok('kts 로 바꾸면 라벨도 kts', ctxKts.log.filter((e) => e.op === 'fillText').every((e) => /kts$/.test(e.t)));
    const ctxAvoid = fakeCtx();
    const nAvoid = L.drawContourLabels(ctxAvoid, segs, { layer: 'wind', useKts: false, w: 600, h: 800, isSea: () => true, avoid: [[250, 0, 380, 800]] });
    ok('버튼 자리(avoid)에는 안 놓음', nAvoid === 0, 'n=' + nAvoid);
    const ctxLand = fakeCtx();
    const nLand = L.drawContourLabels(ctxLand, segs, { layer: 'wind', useKts: false, w: 600, h: 800, isSea: () => false });
    ok('육지(바다 아님)에는 안 놓음', nLand === 0);
}

console.log('── ⑤ 유향·유속 화살표 라벨 ──');
{
    const ctx = fakeCtx();
    // 위경도 = 화면 px 로 단순 대응 (1° = 100px, 원점 lon 120 / lat 40 이 화면 왼쪽 위)
    const n = L.drawCurrentLabels(ctx, {
        w: 800, h: 800, lonRange: [120, 128], latRange: [32, 40], pxPerDeg: 100, useKts: false,
        toPixel: (lon, lat) => [(lon - 120) * 100, (40 - lat) * 100],
        sample: () => ({ crsp: 63, crdir: 90 }),
        screenAngle: (lon, lat, deg) => deg * Math.PI / 180,
        isSea: () => true
    });
    const strokes = ctx.log.filter((e) => e.op === 'stroke');
    const fills = ctx.log.filter((e) => e.op === 'fill');
    const texts = ctx.log.filter((e) => e.op === 'fillText').map((e) => e.t);
    ok('라벨이 놓임', n > 0, 'n=' + n);
    ok('화살표 테두리 = 검정', strokes.length === n && strokes.every((s) => s.style === '#000' && s.width >= 2));
    ok('화살표 칠 = 흰색', fills.length === n && fills.every((f) => f.style === '#fff'));
    ok('동그라미 없음', !ctx.log.some((e) => e.op === 'arc'));
    ok('글자 = 값+단위만 (방위 글자 없음)', texts.length === n && texts.every((t) => t === '0.6m/s'), texts.slice(0, 3).join(','));
    ok('화살표 방향 = 흘러가는 쪽(동=90°)', ctx.log.filter((e) => e.op === 'rotate').every((e) => Math.abs(e.r - Math.PI / 2) < 1e-9));
    // 1° = 100px 이면 간격 1° (0.5°=50px 는 84px 보다 좁다) → 라벨 사이 100px
    const tx = ctx.log.filter((e) => e.op === 'translate').map((e) => e.x);
    const gaps = [...new Set(tx.map((x) => Math.round(x)))].sort((a, b) => a - b);
    ok('라벨 가로 간격 ≥ 84px', gaps.every((x, i) => i === 0 || x - gaps[i - 1] >= 84), gaps.join(','));
    const ctxNone = fakeCtx();
    const nNone = L.drawCurrentLabels(ctxNone, {
        w: 800, h: 800, lonRange: [120, 128], latRange: [32, 40], pxPerDeg: 100, useKts: false,
        toPixel: (lon, lat) => [(lon - 120) * 100, (40 - lat) * 100],
        sample: () => null, screenAngle: () => 0, isSea: () => true
    });
    ok('자료 없는 자리는 건너뜀', nNone === 0);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
