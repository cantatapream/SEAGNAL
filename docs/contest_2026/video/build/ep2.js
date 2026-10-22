/* 2편 「특보 알림 하나를 꼼꼼하게」 — 40.6초. 곡 80.495~121.095 (V = 곡 − 80.495)
   숨 고르기 V0~8(높은 소리 V1·3·5·7) → 드롭 2 V8 → 차분 첫 박 V40 = 로고. 기획안 11절 참고. */
'use strict';
const B = (n, b = 1) => 2 * (n - 1) + 0.5 * (b - 1);
const HIT = 40.0;
window.DUR = 40.6;
baseCSS(COMMON_CSS + `
.mapc{position:absolute;left:0;top:0;width:1000px;height:1040px;transform-origin:500px 500px}
.zl{font-family:Pre;font-weight:700;fill:${C.navy};paint-order:stroke;stroke:#FBFAF7;stroke-width:2.2px}
.scan{position:absolute;left:0;top:0;height:3px;background:${C.teal}}
.ncard{position:absolute;left:0;top:0;width:734px;height:133px;background-size:734px auto;border-radius:22px;box-shadow:0 18px 40px rgba(11,30,63,.25)}
.banner{position:absolute;left:8px;top:8px;width:384px;height:76px;border-radius:20px;background:#2B2026;display:flex;align-items:center;gap:12px;padding:0 14px;box-shadow:0 8px 20px rgba(0,0,0,.35)}
.banner .ic{width:44px;height:44px;border-radius:12px;background-size:auto 100%;background-position:center;flex:none}
.banner .tt{color:#fff;font-weight:700;font-size:16px}
.banner .bd{color:#CFC6CC;font-weight:500;font-size:13px;margin-top:3px}
.banner .rc{position:absolute;right:12px;top:8px;font-size:11px;font-weight:600;color:#9A8F96;border:1px solid #6E636A;border-radius:6px;padding:1px 5px}
.tl{position:absolute;left:0;top:0;display:flex;align-items:center;gap:18px;font-weight:800;font-size:42px;color:${C.navy};white-space:nowrap}
.tl i{position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;background:${C.navy};flex:none}
.tl.em{color:${C.tealText}} .tl.em i{background:${C.teal}}
.ddl{position:absolute;left:0;top:0;width:300px;height:228px;border-radius:22px}
.ddl .gc{padding:8px 0}
.ddl .gc div{padding:12px 22px;font-weight:700;font-size:24px;color:${C.navy}}
.ddl .gc div.on{color:${C.tealText}}
.num2{position:absolute;color:#fff;font-weight:800;font-size:128px;letter-spacing:-0.03em;white-space:nowrap;display:flex;align-items:baseline}
.num2 .u{font-size:60px;margin-left:8px}
.bar{position:absolute;left:0;top:0;height:30px;border-radius:15px;background:${C.teal};transform-origin:0 50%}
.blab{position:absolute;color:#9FD9E0;font-weight:600;font-size:26px;white-space:nowrap}
`);
glassDefs();
const stage = document.getElementById('stage');
const world = mk('div', 'world', stage), hud = mk('div', 'hud', stage), fx = mk('div', 'hud', stage);
const IMG = n => `assets/${n}`;
const logo = Logo(fx);

// ── 지도 (world) ───────────────────────────────────────
const M = window.MAP;
const ZN = n => M.z44.find(z => z.name === n) || M.z49.find(z => z.name === n);
const PAINT1 = ['남해동부 바깥먼바다', '제주도 남쪽 바깥먼바다'];
const JW = '제주도서부앞바다', JNW = '제주도서부앞바다중 북서연안바다', JSW = '제주도서부앞바다중 남서연안바다', JGP = '제주도서부앞바다중 가파도연안바다';
const mapc = mk('div', 'mapc', world);
const grp = (id, names, useHole) => `<g clip-path="url(#${id})">${names.map(n => { const z = ZN(n); return `<path d="${useHole && z.dh ? z.dh : z.d}" fill="url(#hatch)" fill-rule="evenodd" stroke="rgba(34,197,94,.95)" stroke-width="1.3"/>`; }).join('')}</g>`;
mapc.innerHTML = `<svg width="1000" height="1040" viewBox="-500 -500 1000 1040" style="overflow:visible">
<defs>
 <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="rgba(34,197,94,.40)"/><rect width="3.2" height="9" fill="rgba(156,163,175,.55)"/></pattern>
 <clipPath id="cpLand"><circle id="cpLandC" cx="0" cy="0" r="0"/></clipPath>
 ${['g1', 'g2a', 'g2b'].map(i => `<clipPath id="cp_${i}"><rect id="cr_${i}" x="0" y="0" width="0" height="0"/></clipPath>`).join('')}
</defs>
<path d="${M.land}" fill="#E7EBF1" clip-path="url(#cpLand)"/>
${grp('cp_g1', PAINT1, true)}
${grp('cp_g2a', [JW, JNW], true)}
${grp('cp_g2b', [JSW, JGP], false)}
<g id="z49">${M.z49.map(z => `<path d="${z.d}" fill="none" stroke="#3E79A6" stroke-width="0.9"/>`).join('')}</g>
<g id="z44">${M.z44.map(z => `<path d="${z.d}" fill="none" stroke="${C.navy}" stroke-width="1.6" stroke-linejoin="round"/>`).join('')}</g>
<g id="lbl"></g>
</svg>`;
const svg = mapc.querySelector('svg');
const z44p = [...svg.querySelectorAll('#z44 path')], z49p = [...svg.querySelectorAll('#z49 path')];
const grpOrder = n => /제주/.test(n) ? 3 : /동해|강원|경북|울산|울릉|독도/.test(n) ? 0 : /서해|인천|경기|충남|전북|전남북부서해|흑산/.test(n) ? 1 : 2;
let z44len, z49len, z44cy, bbJW, sweepBB = {};
function mapMeasure() {
  z44len = z44p.map(p => p.getTotalLength()); z49len = z49p.map(p => p.getTotalLength());
  z44p.forEach((p, i) => { p.setAttribute('stroke-dasharray', z44len[i]); });
  z49p.forEach((p, i) => { p.setAttribute('stroke-dasharray', z49len[i]); });
  z44cy = z44p.map(p => { const b = p.getBBox(); return b.y + b.height / 2; });
  const bb = el => el.getBBox();
  for (const id of ['g1', 'g2a', 'g2b']) { const g = svg.querySelector(`#cr_${id}`).closest('svg').querySelector(`g[clip-path="url(#cp_${id})"]`); sweepBB[id] = bb(g); }
  bbJW = svg.querySelector('g[clip-path="url(#cp_g2a)"]').getBBox();
  // 연안바다 이름표
  const L = svg.querySelector('#lbl');
  for (const [n, s] of [[JNW, '북서연안바다'], [JSW, '남서연안바다'], [JGP, '가파도연안바다'], [JW, '제주도서부앞바다']]) {
    const i = M.z49.findIndex(z => z.name === n), p = i >= 0 ? z49p[i] : z44p[M.z44.findIndex(z => z.name === n)];
    const b = p.getBBox(); const tx = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tx.setAttribute('class', 'zl'); tx.setAttribute('font-size', n === JW ? '8.5' : '6.2'); tx.setAttribute('text-anchor', 'middle');
    const dx = n === JW ? -18 : (n === JGP ? 14 : (n === JSW ? -16 : -6)), dy = n === JW ? -10 : (n === JGP ? 9 : 0);
    tx.setAttribute('x', b.x + b.width / 2 + dx); tx.setAttribute('y', b.y + b.height / 2 + dy); tx.textContent = s; L.appendChild(tx);
  }
}
/** 사선 띠로 쓸어 칠하기/빼기: u 0→1 들어옴, v 0→1 빠짐 */
function sweep(id, u, v) {
  const b = sweepBB[id], D = Math.hypot(b.width, b.height) + 20, cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const r = svg.querySelector(`#cr_${id}`);
  r.setAttribute('x', cx - D / 2 + D * v); r.setAttribute('y', cy - D / 2); r.setAttribute('height', D); r.setAttribute('width', Math.max(0, D * (u - v)));
  r.setAttribute('transform', `rotate(45 ${cx} ${cy})`);
}
const scan = mk('div', 'scan', world);

// ── 첫 소개 (점 → 「특보정보」 알약) ───────────────────
const pill = mk('div', 'win', world);
const pillT = mk('div', 'pilltxt', pill); const pillM = maskText(pillT, '특보정보', '');
const subA = maskText(hud, '특보 알림 하나를 꼼꼼하게', 'hl'); subA.el.style.cssText += ';left:960px;top:600px;transform:translateX(-50%);font-size:52px';
const subB = maskText(hud, '현직 해양경찰관이 AI와 만든 해양안전 앱 SEA:GNAL', 'sub'); subB.el.style.cssText += ';left:960px;top:684px;transform:translateX(-50%);font-size:28px;color:#5E6B80';
const corner = mk('div', 'corner', hud, '2 / 3 &nbsp;특보 알림 하나를 꼼꼼하게');

// ── 머리말 (hud, 왼쪽) ─────────────────────────────────
const hA = HL(hud, ['93개 구역,', '**1분마다** 확인'], 110, 250, { size: 84 });
const p93 = Glass(hud); p93.el.style.cssText += ';height:76px;width:320px';
p93.gc.innerHTML = '<div class="gpill" style="font-size:32px">44 + 49 = <span style="color:#0E9FAD">93</span></div>';
const s93 = maskText(hud, '연안바다 22 · 평수구역 27', 'small'); s93.el.style.cssText += ';left:118px;top:560px;font-size:26px';
const ring = mk('div', 'abs', hud, `<svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="40" fill="none" stroke="#E2E7EE" stroke-width="9"/><circle id="rg" cx="48" cy="48" r="40" fill="none" stroke="${C.teal}" stroke-width="9" stroke-linecap="round" transform="rotate(-90 48 48)" stroke-dasharray="251.3" stroke-dashoffset="251.3"/><text x="48" y="57" text-anchor="middle" font-family="Pre" font-weight="800" font-size="26" fill="${C.navy}">1분</text></svg>`);
const rg = ring.querySelector('#rg');
const legend = Glass(hud); legend.el.style.cssText += ';height:64px;width:520px';
legend.gc.innerHTML = `<div class="gpill" style="font-size:24px;gap:14px"><svg width="34" height="24"><defs><pattern id="h2" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="rgba(34,197,94,.45)"/><rect width="2.6" height="7" fill="rgba(156,163,175,.6)"/></pattern></defs><rect width="34" height="24" rx="5" fill="url(#h2)" stroke="rgba(34,197,94,.95)"/></svg>풍랑 주의보 <span style="font-weight:500;color:#5E6B80;font-size:20px">10월 6일 04:32 앱 화면 기준</span></div>`;
const hB = HL(hud, ['연안바다·', '**평수구역까지**'], 110, 250, { size: 84 });
// 알림 카드(실제, S13-1에서 오림): A=6:00 일부 해제, B=9:00 해제
function ncard(y0) { const c = mk('div', 'ncard', hud); c.style.backgroundImage = `url(${IMG('s13_1.png')})`; c.style.backgroundPosition = `0 ${-y0 * 0.85}px`; return c; }
const cardA = ncard(66 + 168 * 3), cardB = ncard(66);
// 발표 → 발효 → 해제
const hC = ['발표 →', '발효 →', '<em>해제</em>'].map(s => { const m = maskText(hud, s, 'hl'); m.el.style.fontSize = '92px'; m.el.style.top = '330px'; return m; });
const sC = maskText(hud, '단계마다 알림이 갑니다', 'sub'); sC.el.style.cssText += ';left:116px;top:470px;font-size:34px';
const hD = HL(hud, ['알림을 누르면,', '**안전 안내**'], 110, 280, { size: 84 });
const hBu = HL(hud, ['관측부이', '**실측값까지**'], 110, 280, { size: 84 });
const sBu = maskText(hud, '가까운 부이의 파고·풍속·수온', 'sub'); sBu.el.style.cssText += ';left:116px;top:500px;font-size:32px';
const hSet = HL(hud, ['관심 해역만,', '**단계별로 골라 받기**'], 110, 280, { size: 80 });
const sSet = maskText(hud, '발표·발효·해제 알림을 따로 켜고 끕니다', 'sub'); sSet.el.style.cssText += ';left:116px;top:500px;font-size:32px';
const hE = HL(hud, ['틀린 알림을', '막아 온 **8개월**'], 110, 120, { size: 76 });
const TL = [['출처 네 가지 시도', ''], ['통보문 6,200건 분석', ''], ['사라져도 3분 지켜보기', ''], ['9·7 오발송 → 재현 테스트 30건', ''], ['다른 AI 검토: 결함 4건', 'em']]
  .map(([s, c], i) => { const e = mk('div', 'tl ' + c, hud, `<i></i><span class="mask" style="position:relative"><span class="in" style="display:block">${s}</span></span>`); return { e, m: { el: e.querySelector('.mask'), inner: e.querySelector('.in') }, i }; });
const tlLine = mk('div', 'abs', hud); tlLine.style.cssText += ';height:6px;background:#D5DCE6;left:150px;top:577px;border-radius:3px;transform-origin:0 50%';
const hF = HL(hud, ['한 번 터치,', '바다 정보 **11가지**'], 110, 280, { size: 80 });
const c11 = Glass(world); c11.el.style.cssText += ';height:84px;width:300px';
c11.gc.innerHTML = '<div class="gpill" style="font-size:30px">바다 정보 <span id="o11" style="color:#0E9FAD"></span>가지</div>';
const odo11 = Odo(c11.gc.querySelector('#o11'), '11');
const hG = HL(hud, ['4개 기관 태풍,', '**골라 비교**'], 110, 230, { size: 84 });
const AG = ['한국(기상청)', '미국(JTWC)', '일본(JMA)', '유럽(ECMWF)'].map(s => { const g = Glass(hud); g.el.style.cssText += ';height:70px;width:280px;border-radius:22px'; g.gc.innerHTML = `<div class="gpill" style="font-size:28px">${s}</div>`; return g; });
const sG = maskText(hud, '한 번에 한 기관씩 골라 봅니다', 'small'); sG.el.style.cssText += ';left:118px;top:780px;font-size:26px';
const ddl = Glass(world, 'ddl'); ddl.el.style.zIndex = '20'; ddl.gc.innerHTML = ['한국(기상청)', '미국(JTWC)', '일본(JMA/RSMC)', '유럽(ECMWF)'].map((s, i) => `<div class="${i === 2 ? 'on' : ''}">${s}</div>`).join('');

// ── 하나의 도형: 알림 카드 → 휴대폰 → 숫자판 → 덮개 → 알약 → 점 (world) ──
const body = mk('div', 'win', world);
const pscr = mk('div', 'scr', body); pscr.style.left = '14px'; pscr.style.top = '14px'; pscr.style.borderRadius = '44px';
const punch = mk('div', 'punch', body);
function shotLayer(src, w, top = 0, bg) { const d = mk('div', 'scr', pscr); if (bg) d.style.background = bg; const im = mk('img', 'shot', d); im.src = IMG(src); im.style.width = px(w); im.style.top = px(top); return d; }
const L_122 = shotLayer('s12_2.png', 400), L_map = shotLayer('s09_2.png', 400), L_t1 = shotLayer('s20_1.png', 400, 0, '#0E1A2E'), L_t2 = shotLayer('s20_2.png', 400, 0, '#0E1A2E');
const L_262 = shotLayer('s26_2.png', 400, 0, '#0B1529'), L_263 = shotLayer('s26_3.png', 400, 0, '#0B1529');
// 발표·발효·해제 정보 줄: S26-3 y 706~934, x 112~800 (픽셀로 잼)
const bxPush = Box(L_263, 90 * (400 / 864), 690 * (400 / 864), 710 * (400 / 864), 250 * (400 / 864));
const sheet = mk('img', 'shot', L_map); sheet.src = IMG('s19_3.png'); sheet.style.width = '400px';
const RS = 400 / 720;
// 발표·발효·해제예정 줄: S12-2 y 368~388 · 408~428 · 447~468, x 107~612 (픽셀로 잼)
const bx122 = [363, 403, 442].map(y => Box(L_122, 55, y * RS, 289, 17));
// 파고 줄(「파고」 752~769 · 값 787~808, x 115~505 — S12-2 픽셀로 잼)
const bxBuoy = Box(L_122, 60, 742 * RS, 226, 76 * RS);
// 재구성 알림(발표) — 실물 캡처 없음, 코드 형식(push_helpers.js:293)대로 + 「재구성」 표시
const banner = mk('div', 'banner', pscr, `<div class="ic"></div><div><div class="tt">📢 풍랑 주의보 발표</div><div class="bd">ㅇ제주도북부앞바다</div></div><div class="rc">재구성</div>`);
banner.querySelector('.ic').style.backgroundImage = `url(${IMG('s13_1.png')})`;
banner.querySelector('.ic').style.cssText += ';background-size:400px auto;background-position:-13px -42px';
const popW = mk('div', 'abs', pscr); popW.style.cssText += ';width:372px;height:465px;left:14px;top:175px;border-radius:18px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.5)';
popW.style.zIndex = '6'; banner.style.zIndex = '6';
const popI = mk('img', 'shot', popW); popI.src = IMG('s13_3.png'); popI.style.width = '372px';
const PS = 372 / 495;
// 글줄 위치는 S13-3 픽셀로 잼: ② 273~289 · ③ 369~386/402~418 · ④ 531~547
const bxP = [Box(popW, 20 * PS, 104 * PS, 452 * PS, 128 * PS), Box(popW, 263 * PS, 295 * PS, 180 * PS, 0), Box(popW, 323 * PS, 391 * PS, 120 * PS, 0), Box(popW, 29 * PS, 423 * PS, 58 * PS, 0), Box(popW, 232 * PS, 552 * PS, 200 * PS, 0)];
// 숫자판
const n823 = mk('div', 'num2', world); const od823 = Odo(n823, '823,412'); mk('span', 'u', n823, '건');
const nLab = maskText(world, '알림 · 2,566번 보냄 · 모든 알림 합계', 'nlab'); nLab.el.style.cssText += ';font-size:28px';
const bar1 = mk('div', 'bar', world), bar2 = mk('div', 'bar', world);
const bl1 = maskText(world, '5월 28일 155,958건', 'blab'), bl2 = maskText(world, '10월 19일 823,412건', 'blab');
const x53 = maskText(world, '약 5.3배', 'hl'); x53.el.style.cssText += ';font-size:52px;color:#2AD8E2';
const install = maskText(hud, '구글 플레이 <b style="color:#0E9FAD">SEA:GNAL</b> &nbsp;·&nbsp; seagnal-server.fly.dev', 'sub');
install.el.style.cssText += ';left:960px;top:800px;transform:translateX(-50%);font-size:36px;font-weight:700;color:#0B1E3F';
const iris = Iris(fx);
const cur = Cursor(world);

// ── 지도 위치·카메라 ───────────────────────────────────
const MX = 1240, MY = 540;
let JX = 1068, JY = 846;          // mapMeasure 뒤 제주도서부앞바다 가운데(stage)
const cam = { x: [], y: [], z: [] };
function buildCam() {
  JX = MX + bbJW.x + bbJW.width / 2; JY = MY + bbJW.y + bbJW.height / 2;
  cam.x = [[B(6), JX + 40, { z: .85, f: 1.3 }], [B(7, 4), 960, { z: .9, f: 1.6 }], [B(8) + 0.3, 1000, { z: .85, f: 1.5 }], [B(10), 960, { z: .9, f: 1.8 }],
    [B(10, 3) + 0.15, 1060, { z: .85, f: 1.8 }], [B(11), 960, { z: .9, f: 1.8 }], [B(11, 3) + 0.4, 1060, { z: .85, f: 1.5 }], [B(13), 960, { z: .9, f: 1.6 }]];
  cam.y = [[B(6), JY - 10, { z: .85, f: 1.3 }], [B(7, 4), 540, { z: .9, f: 1.6 }], [B(8) + 0.3, 410, { z: .85, f: 1.5 }], [B(9) + 0.1, 560, { z: .85, f: 1.8 }], [B(10), 540, { z: .9, f: 1.8 }],
    [B(10, 3) + 0.15, 509, { z: .85, f: 1.8 }], [B(11), 540, { z: .9, f: 1.8 }], [B(11, 3) + 0.4, 530, { z: .85, f: 1.5 }], [B(13), 540, { z: .9, f: 1.6 }]];
  cam.z = [[B(3) + 0.5, 1.06, { z: .9, f: .8 }], [B(4) + 0.5, 1.12, { z: .9, f: .8 }], [B(5), 1.0, { z: .45, f: 2.2 }],
    [B(6), 2.4, { z: .85, f: 1.3 }], [B(7, 4), 1.0, { z: .9, f: 1.6 }], [B(8) + 0.3, 1.8, { z: .85, f: 1.5 }], [B(10), 1.0, { z: .9, f: 1.8 }],
    [B(10, 3) + 0.15, 1.5, { z: .85, f: 1.8 }], [B(11), 1.0, { z: .9, f: 1.8 }], [B(11, 3) + 0.4, 1.55, { z: .85, f: 1.5 }], [B(13), 1.0, { z: .9, f: 1.6 }]];
  // 속도감 보강(10-19): 드롭 뒤 남쪽으로 한 번, 팝업 항목마다 아래로, 태풍 진로 확대
  cam.x.push([B(4), 1040, { z: .95, f: .6 }], [B(5) + 0.6, 1150, { z: .85, f: 2 }], [B(16) + 1.2, 1100, { z: .85, f: 2.2 }], [B(17) - 0.15, 960, { z: .9, f: 2.4 }],
    [B(17, 3) + 0.4, 1100, { z: .85, f: 2.2 }], [B(18), 960, { z: .9, f: 2.4 }]);
  cam.y.push([B(5) + 0.6, 640, { z: .85, f: 2 }], [B(12, 2), 560, { z: .85, f: 2.4 }], [B(12, 3), 600, { z: .85, f: 2.4 }], [B(12, 4), 640, { z: .85, f: 2.4 }],
    [B(16) + 1.2, 330, { z: .85, f: 2.2 }], [B(17) - 0.15, 540, { z: .9, f: 2.4 }], [B(17, 3) + 0.4, 330, { z: .85, f: 2.2 }], [B(18), 540, { z: .9, f: 2.4 }]);
  cam.z.push([B(5) + 0.6, 1.15, { z: .85, f: 2 }], [B(16) + 1.2, 1.5, { z: .85, f: 2.2 }], [B(17) - 0.15, 1.0, { z: .9, f: 2.4 }],
    [B(17, 3) + 0.4, 1.5, { z: .85, f: 2.2 }], [B(18), 1.0, { z: .9, f: 2.4 }]);
  for (const k of ['x', 'y', 'z']) cam[k].sort((p, q) => p[0] - q[0]);
}

// ── 커서 ───────────────────────────────────────────────
const PX = 1050, PY = 132;
cur.path = [[B(2, 2), 1720, 1000], [B(2, 4) - 0.15, 975, 552], [B(2, 4) + 0.1, 970, 548], [B(3, 3), 1350, 420], [B(4, 3), 300, 640],
  [B(4, 4) + 0.1, 280, 660], [B(5, 3), 700, 760], [B(5, 4) + 0.4, 1990, 760],
  [B(8), 1990, 900], [B(8) + 0.2, PX + 330, PY + 210], [B(8, 2) + 0.2, PX + 330, PY + 232], [B(8, 3) + 0.2, PX + 330, PY + 254], [B(9) + 0.3, PX + 250, PY + 452], [B(9, 4), PX + 255, PY + 456],
  [B(10, 3) - 0.2, PX + 200, PY + 40], [B(10, 3) - 0.02, PX + 200, PY + 40], [B(10, 4), PX + 340, PY + 380], [B(10, 4) + 0.3, PX + 342, PY + 382],
  [B(11), PX + 250, PY + 120], [B(11) + 0.85, PX + 200, PY + 52], [B(11) + 0.95, PX + 200, PY + 52],
  [B(12), PX + 14 + 300 * PS, PY + 175 + 236 * PS], [B(12, 2), PX + 14 + 450 * PS, PY + 175 + 305 * PS], [B(12, 3), PX + 14 + 90 * PS, PY + 175 + 430 * PS], [B(12, 4), PX + 14 + 435 * PS, PY + 175 + 560 * PS],
  [B(13) + 0.3, 160, 680], [B(14, 2) + 0.3, 1700, 680], [B(14, 4) + 0.3, 1500, 780],
  [B(15) + 0.3, PX + 180, PY + 360], [B(15) + 0.4, PX + 180, PY + 360], [B(15, 4), PX + 300, PY + 600],
  [B(16) + 0.25, PX + 371, PY + 318], [B(16) + 0.35, PX + 371, PY + 318],
  [B(16, 3) + 0.4, PX + 300, PY + 640], [B(17) - 0.05, PX + 276, PY + 580], [B(17) + 0.05, PX + 276, PY + 580],
  [B(17, 2) + 0.05, 1230, 650], [B(17, 2) + 0.25, 1230, 650], [B(18), 400, 470], [B(18, 4), 400, 700],
  [B(19), 1700, 640], [B(19, 4), 700, 870], [B(20, 2) + 0.3, 1260, 870]];
cur.hide = [[B(5, 4) + 0.38, B(8)], [B(20, 2) + 0.35, 99]];
[B(2, 4), B(10, 3) - 0.02, B(10, 4) + 0.15, B(11) + 0.9, B(15) + 0.35, B(16) + 0.3, B(17), B(17, 2) + 0.15].forEach(t => cur.click(t));
cue(B(3, 2), 'pop', 0.6); cue(B(4, 2), 'pop', 0.6); cue(B(5) + 0.5, 'pop', 0.7);
cue(B(7), 'notify', 0.8); cue(B(7, 3), 'notify', 0.8); cue(B(11) + 0.2, 'notify', 0.9);
cue(B(15) + 0.5, 'pop', 0.6); cue(B(17) + 0.05, 'pop', 0.5); [0, 1, 2, 3].forEach(i => cue(B(18, 1 + i), 'pop', 0.5));
TL.forEach((x, i) => cue(i < 4 ? B(13, 1 + i) : B(14, 2), 'pop', 0.45)); cue(B(19), 'pop', 0.8);

window.seek = function (t) {
  if (!z44len) { logo.measure(); mapMeasure(); buildCam(); }
  const cz = chain(t, 1, cam.z), cx = chain(t, 960, cam.x), cy = chain(t, 540, cam.y);
  world.style.transform = `translate(${W / 2}px,${H / 2}px) scale(${cz}) translate(${-cx}px,${-cy}px)`;
  // 로고
  let k = 0, mg = 0;
  if (t < 2.1) { k = chain(t, 0, [[0.25, .34, { z: .75, f: 3 }], [0.6, .67, { z: .75, f: 3 }], [1.0, 1, { z: .8, f: 3 }]]); mg = spr(t, 1.2, { z: .8, f: 3 }); }
  if (t >= HIT) { k = mg = 1 - spr(t, HIT, { z: .78, f: 2.6 }); if (t > DUR - 0.03) k = mg = 0; }
  const lOn = t < B(2) || t >= HIT; vis(logo.el, lOn); if (lOn) logo.set(clamp(k, 0, 1.2), clamp(mg));
  // 알약
  const pOn = on(t, B(2), B(3) + 0.35); vis(pill, pOn);
  if (pOn) {
    const r = rectChain(t, { x: logo.cx - 17, y: 523, w: 34, h: 34, r: 17 }, [[B(2), { x: 960 - 200, y: 494, w: 400, h: 92, r: 46 }, { z: .62, f: 2.2 }],
      [B(3), { x: MX + 330, y: MY - 300, w: 22, h: 22, r: 11 }, { z: .8, f: 2.4 }]]);
    const press = cur.clicks.some(c => t - c >= 0 && t - c < 0.22);
    rectStyle(pill, r.x, r.y, r.w, r.h, r.r, t < B(2) + 0.1 ? C.teal : C.navy);
    if (press) pill.style.transform += ' scale(0.97)';
    setRise(pillM, t, B(2, 2), B(3), 'up');
  }
  setRise(subA, t, B(2, 2), B(3), 'down'); setRise(subB, t, B(2, 3), B(3), 'down');
  const cOn = t >= B(2, 2) && t < B(20, 2) + 0.62; vis(corner, cOn); if (cOn) corner.style.transform = `scale(${spr(t, B(2, 2), { z: .55, f: 2.4 })})`;

  // 지도
  const mOn = on(t, B(3) - 0.05, B(8) + 1.4); vis(mapc, mOn); vis(scan, false);
  if (mOn) {
    const mx = t < B(8) ? MX : MX + (-1500) * spr(t, B(8), { z: .95, f: 1.7 });
    mapc.style.transform = `translate(${mx - 500}px,${MY - 500}px)`;
    svg.querySelector('#cpLandC').setAttribute('r', 900 * easeO(prog(t, B(3), 0.9)));
    z44p.forEach((p, i) => { const g = grpOrder(M.z44[i].name), t0 = B(3) + g * 0.25 + (i % 5) * 0.03;
      p.setAttribute('stroke-dashoffset', z44len[i] * (1 - easeIO(prog(t, t0, 0.6))));
      const sy = MY - 500 + 1040 * easeIO(prog(t, B(5), 0.6)) - MY;           // 훑는 선(지도 단위 y)
      const bump = on(t, B(5), B(5) + 0.7) ? Math.exp(-Math.pow((sy - z44cy[i]) / 45, 2)) : 0;
      p.setAttribute('stroke-width', 1.6 + 2.2 * bump); });
    z49p.forEach((p, i) => p.setAttribute('stroke-dashoffset', z49len[i] * (1 - easeIO(prog(t, B(4) + (i % 7) * 0.05, 0.7)))));
    const scOn = on(t, B(5), B(5) + 0.62); vis(scan, scOn);
    if (scOn) { scan.style.width = '1000px'; scan.style.transform = `translate(${MX - 500}px,${MY - 500 + 1040 * easeIO(prog(t, B(5), 0.6))}px)`; }
    sweep('g1', easeIO(prog(t, B(5, 2), 0.5)), 0);
    sweep('g2a', easeIO(prog(t, B(6) + 0.35, 0.5)), easeIO(prog(t, B(7, 3) + 0.25, 0.5)));
    sweep('g2b', easeIO(prog(t, B(6) + 0.35, 0.5)), easeIO(prog(t, B(7) + 0.3, 0.5)));
    svg.querySelector('#lbl').style.display = on(t, B(6) + 0.3, B(8)) ? '' : 'none';
  }
  hA.set(t, B(3), B(6), 'up');
  const p93On = on(t, B(4, 2), B(6)); vis(p93.el, p93On);
  if (p93On) p93.el.style.transform = `translate(110px,470px) scale(${spr(t, B(4, 2), { z: .55, f: 2.4 })})`;
  setRise(s93, t, B(4, 3), B(6), 'down');
  const rOn = on(t, B(4), B(6)); vis(ring, rOn);
  if (rOn) { ring.style.transform = `translate(460px,460px) scale(${spr(t, B(4), { z: .55, f: 2.4 })})`;
    const q = Math.min(4, Math.floor((t - B(4)) / 0.5) + 1) / 4 + (t >= B(5) ? 1 : 0) * 0;
    rg.setAttribute('stroke-dashoffset', 251.3 * (1 - (t >= B(5) ? 1 : q))); }
  const lgOn = on(t, B(5, 3), B(6)); vis(legend.el, lgOn);
  if (lgOn) legend.el.style.transform = `translate(110px,640px) scale(${spr(t, B(5, 3), { z: .55, f: 2.4 })})`;
  hB.set(t, B(6), B(8), 'up');
  // 알림 카드
  const caOn = on(t, B(7), B(8) + 0.05); vis(cardA, caOn);
  if (caOn) { const y = t < B(7, 3) ? 70 : 70 + 152 * spr(t, B(7, 3), { z: .8, f: 2.4 }); cardA.style.transform = `translate(${1120 + 800 * (1 - spr(t, B(7), { z: .8, f: 2.2 }))}px,${y}px)`; }
  const cbOn = on(t, B(7, 3), B(8) + 0.08); vis(cardB, cbOn);
  if (cbOn) cardB.style.transform = `translate(${1120 + 800 * (1 - spr(t, B(7, 3), { z: .8, f: 2.2 }))}px,70px)`;

  // 하나의 도형: 카드 B → 휴대폰 → 숫자판 → 덮개 → 알약 → 점
  const bOn = on(t, B(8), HIT); vis(body, bOn);
  const isPhone = on(t, B(8) + 0.1, B(19) + 0.1);
  if (bOn) {
    const r = rectChain(t, { x: 1120, y: 70, w: 734, h: 133, r: 22 }, [
      [B(8), { x: 1036, y: 118, w: 428, h: 844, r: 58 }, { z: .72, f: 1.8 }],
      [B(13) + 0.1, { x: 2150, y: 118, w: 428, h: 844, r: 58 }, { z: .9, f: 2 }],
      [B(15) - 0.2, { x: 1036, y: 118, w: 428, h: 844, r: 58 }, { z: .75, f: 2 }],
      [B(19), { x: 260, y: 230, w: 1400, h: 500, r: 44 }, { z: .72, f: 1.8 }],
      [B(20, 2) + 0.6, { x: -260, y: -260, w: 2440, h: 1600, r: 0 }, { z: 1, f: 3.2 }],
      [B(20, 2) + 0.92, { x: 960 - 310, y: 494, w: 620, h: 92, r: 46 }, { z: .8, f: 3 }],
      [B(20, 4), { x: logo.cx - 17, y: 523, w: 34, h: 34, r: 17 }, { z: .8, f: 3.4 }]]);
    rectStyle(body, r.x, r.y, r.w, r.h, r.r, isPhone ? '#10141B' : (t < B(8) + 0.1 ? '#2B2026' : C.navy));
    body.style.boxShadow = isPhone ? '0 0 0 2px #2B3240 inset,0 30px 60px rgba(11,30,63,.22)' : (t < B(20, 2) + 0.6 ? '0 30px 60px rgba(11,30,63,.24)' : 'none');
  }
  vis(pscr, isPhone); vis(punch, isPhone);
  if (isPhone) {
    pscr.style.clipPath = `inset(${408 * spr(t, B(19), { z: 1, f: 4 })}px 0 ${408 * spr(t, B(19), { z: 1, f: 4 })}px 0 round 44px)`;
    screenSeq(t, [[B(8) + 0.12, L_122, 'up'], [B(10), L_262, 'right'], [B(10, 3), L_263, 'right'], [B(11) - 0.05, L_122, 'left'], [B(15), L_map, 'right'], [B(16) + 0.55, L_t1, 'none'], [B(17, 2) + 0.35, L_t2, 'wipe']], [L_122, L_262, L_263, L_map, L_t1, L_t2]);
    bx122.forEach((b, i) => b.set(t, B(8) + 0.25 + i * 0.5, B(11)));
    bxBuoy.set(t, B(9) + 0.4, B(11)); bxPush.set(t, B(10, 3) + 0.45);
    // 재구성 알림 배너
    const bnOn = on(t, B(11) + 0.15, B(11) + 1.1); vis(banner, bnOn);
    if (bnOn) banner.style.transform = `translateY(${-100 * (1 - spr(t, B(11) + 0.15, { z: .75, f: 2.6 }))}px) scale(${t > B(11) + 0.9 ? 0.97 : 1})`;
    const ppOn = on(t, B(11) + 1.0, B(13) + 0.3); vis(popW, ppOn);
    if (ppOn) { const s = t < B(13) ? spr(t, B(11) + 1.0, { z: .7, f: 2.4 }) : 1 - easeI(prog(t, B(13), 0.28));
      popW.style.transformOrigin = '186px -115px'; popW.style.transform = `scale(${Math.max(0.001, s)})`; }
    bxP[0].set(t, B(12)); bxP[1].set(t, B(12, 2)); bxP[2].set(t, B(12, 3)); bxP[3].set(t, B(12, 3) + 0.15); bxP[4].set(t, B(12, 4));
    sheet.style.top = px(2 + 814 * (t < B(16) ? 1 - spr(t, B(15) + 0.45, { z: .85, f: 2.2 }) : spr(t, B(16), { z: 1, f: 3 })));
  }
  // 「발표 → 발효 → 해제」 머리말
  hC.forEach((m, i) => setRise(m, t, B(8) + 0.5 * i, B(9), 'up'));
  let hx = 110; hC.forEach(m => { m.el.style.left = px(hx); hx += m.el.offsetWidth + 18; });
  setRise(sC, t, B(8, 4), B(9), 'up');
  hBu.set(t, B(9), B(10), 'up'); setRise(sBu, t, B(9) + 0.2, B(10), 'up');
  hSet.set(t, B(10), B(11), 'up'); setRise(sSet, t, B(10) + 0.2, B(11), 'up');
  hD.set(t, B(11), B(13), 'up');
  hE.set(t, B(13), B(15), 'up');
  vis(tlLine, on(t, B(13), B(15) + 0.4)); tlLine.style.width = '1620px';
  tlLine.style.transform = `scaleX(${easeIO(prog(t, B(13), 1.0)) * (1 - easeI(prog(t, B(15), 0.35)))})`;
  TL.forEach((x, i) => { const ti = i < 4 ? B(13, 1 + i) : B(14, 2), cxx = 150 + i * 405, up = i % 2 === 0;
    vis(x.e, on(t, ti, B(15) + 0.9));
    const w = x.e.offsetWidth, slide = 160 * (1 - spr(t, ti, { z: .7, f: 2.4 }));
    x.e.style.transform = `translate(${Math.max(40, Math.min(1880 - w, cxx - w / 2)) + slide}px,${up ? 486 : 612}px)`;
    const ii = x.e.querySelector('i'); ii.style.transform = `translate(${cxx - Math.max(40, Math.min(1880 - w, cxx - w / 2)) - 11 - slide}px,${up ? 83 : -43}px) scale(${Math.max(0, spr(t, ti, { z: .5, f: 2.6 }) * (1 - spr(t, B(15), { z: 1, f: 3 })))})`;
    setRise(x.m, t, ti + 0.05, B(15), 'up'); });
  hF.set(t, B(15), B(16) + 0.35, 'up');
  const c1On = on(t, B(15) + 0.5, B(16) + 0.4); vis(c11.el, c1On);
  if (c1On) { c11.el.style.transform = `translate(700px,620px) scale(${spr(t, B(15) + 0.5, { z: .55, f: 2.4 }) * (1 - spr(t, B(16), { z: 1, f: 3 }))})`;
    odo11.set(Math.min(11, Math.floor(1 + 10 * easeO(prog(t, B(15) + 0.55, 1.0))))); }
  // 조리개: 태풍 단추
  let ik = 0; const ti0 = B(16) + 0.3;
  if (on(t, ti0, ti0 + 0.25)) ik = easeI(prog(t, ti0, 0.25)); else if (on(t, ti0 + 0.25, ti0 + 0.85)) ik = 1 - easeO(prog(t, ti0 + 0.3, 0.55));
  iris.set(t, PX + 371, PY + 318, ik, 0.2);
  hG.set(t, B(16, 2) + 0.1, B(19), 'up');
  const dOn = on(t, B(17) + 0.05, B(17, 2) + 0.35); vis(ddl.el, dOn);
  if (dOn) { const s = t < B(17, 2) + 0.2 ? spr(t, B(17) + 0.05, { z: .6, f: 2.8 }) : 1 - easeI(prog(t, B(17, 2) + 0.2, 0.15));
    ddl.el.style.transformOrigin = '50% 100%'; ddl.el.style.transform = `translate(${PX + 126}px,${PY + 380}px) scale(${Math.max(0.001, s)})`; }
  AG.forEach((g, i) => { const ti = B(18, 1 + i), o = on(t, ti, B(19) + 0.4); vis(g.el, o); if (!o) return;
    g.el.style.transform = `translate(110px,${440 + i * 82}px) scale(${spr(t, ti, { z: .55, f: 2.4 }) * (1 - spr(t, B(19), { z: 1, f: 3 }))})`; });
  setRise(sG, t, B(18, 3), B(19), 'down');
  // 숫자판
  const nOn = on(t, B(19) + 0.1, B(20, 2) + 0.63); vis(n823, nOn);
  if (nOn) { od823.set(823412 * easeO(prog(t, B(19) + 0.15, 1.4))); n823.style.transform = `translate(${960 - n823.offsetWidth / 2}px,268px) scale(${spr(t, B(19) + 0.1, { z: .55, f: 2.4 })})`; n823.style.transformOrigin = '50% 60%'; }
  setRise(nLab, t, B(19, 2), null); nLab.el.style.left = px(960 - nLab.el.offsetWidth / 2); nLab.el.style.top = '420px'; if (t >= B(20, 2) + 0.63) vis(nLab.el, false);
  const brOn = on(t, B(19, 3), B(20, 2) + 0.63); vis(bar1, brOn); vis(bar2, brOn);
  const BX = 700, BW = 680;
  if (brOn) { bar1.style.width = px(BW * 155958 / 823412); bar2.style.width = px(BW);
    bar1.style.transform = `translate(${BX}px,535px) scaleX(${easeO(prog(t, B(19, 3), 0.4))})`; bar2.style.transform = `translate(${BX}px,605px) scaleX(${easeO(prog(t, B(19, 3) + 0.25, 0.6))})`; }
  for (const [m, y, t0] of [[bl1, 535, B(19, 3) + 0.1], [bl2, 605, B(19, 3) + 0.3]]) { setRise(m, t, t0, null); m.el.style.fontSize = '26px';
    m.el.style.left = px(BX - 24 - m.el.offsetWidth); m.el.style.top = px(y + 15 - m.el.offsetHeight / 2); if (t >= B(20, 2) + 0.63) vis(m.el, false); }
  setRise(x53, t, B(20) + 0.1, null); x53.el.style.left = px(BX + BW + 30); x53.el.style.top = px(570 - x53.el.offsetHeight / 2); if (t >= B(20, 2) + 0.63) vis(x53.el, false);
  setRise(install, t, B(19, 4), null); if (t >= B(20, 2) + 0.63) vis(install.el, false);
  cur.set(t);
};
cue(B(20) + 0.1, 'pop', 0.7);
