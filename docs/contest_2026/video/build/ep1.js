/* 1편 「묻기 전에 먼저」 — 67.0초. 곡: V0~64.495 = 곡 0~64.495, V64.495~66.995 = 곡 86.495~88.995 (마디 44 + 강박)
   박자: 마디 n 시작 B(n) = 0.495 + 2(n-1), 박 b = +0.5(b-1). 기획안: docs/contest_2026/video/SEAGNAL_영상_최종기획안.md */
'use strict';
const B = (n, b = 1) => 0.495 + 2 * (n - 1) + 0.5 * (b - 1);
const TB = b => 64.495 + 0.5 * (b - 1);
const HIT = 66.495;
window.DUR = 66.995;

baseCSS(`
.logo{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
.lw{position:absolute;font-family:Arch;font-weight:800;font-size:176px;line-height:1;color:${C.navy};white-space:nowrap;letter-spacing:-0.01em}
.ldot{position:absolute;width:34px;height:34px;border-radius:50%;background:${C.teal}}
.shape{position:absolute;left:0;top:0;overflow:hidden}
.pilltxt{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:40px;letter-spacing:-0.02em}
.pilltxt .mask{position:relative}
.bub{position:absolute;padding:24px 34px;border-radius:34px;background:#fff;font-weight:700;font-size:36px;letter-spacing:-0.03em;color:${C.navy};white-space:nowrap;
  box-shadow:0 14px 32px rgba(11,30,63,.13),0 2px 6px rgba(11,30,63,.08);transform-origin:50% 50%}
.bub.me{background:${C.navy};color:#fff}
.bub .ck{display:inline-block;margin-left:14px;color:${C.tealText}}
.tel{position:absolute;left:0;top:0;width:76px;height:76px}
.win{position:absolute;left:0;top:0;overflow:hidden}
.wbar{position:absolute;left:0;top:0;right:0;height:56px;display:flex;align-items:center;padding-left:24px;gap:10px;font-family:Mono;font-size:21px;color:#9FB3D1}
.wbar i{width:13px;height:13px;border-radius:50%;background:#3A4E73;display:inline-block}
.term{position:absolute;left:0;top:0;font-family:Mono,Pre;color:#DCE6F5}
.tline{position:absolute;white-space:pre;font-size:23px;line-height:34px}
.tl2{position:relative;white-space:pre;font-size:23px;line-height:34px}
.tl2.hi{background:rgba(42,216,226,.20);color:#7FF0F6;border-radius:6px;padding:0 8px;margin-left:-8px}
.tline.hi{background:rgba(42,216,226,.20);color:#7FF0F6;border-radius:6px;padding:0 8px;margin-left:-8px}
.uin{position:absolute;font-family:Pre;font-weight:600;font-size:30px;color:#fff;white-space:nowrap}
.caret{display:inline-block;width:3px;height:30px;background:${C.teal};vertical-align:-4px;margin-left:3px}
.ctl{position:absolute;font-family:Pre;font-weight:700;font-size:38px;color:#fff;white-space:nowrap;letter-spacing:-0.02em}
.ctl b{color:${C.teal};margin-right:16px}
.gpill{display:flex;align-items:center;gap:12px;padding:0 28px;height:100%;white-space:nowrap;font-weight:700;color:${C.navy}}
.chip{font-family:Mono;font-size:22px;color:#0B6F79}
.lbl{font-weight:700;font-size:26px;color:${C.navy}}
.lbl small{display:block;font-weight:500;font-size:19px;color:#5E6B80;margin-top:2px}
.home{position:absolute;left:0;top:0;width:400px;height:816px;overflow:hidden;background:#0A1530}
.strip{position:absolute;left:0;width:400px;background-size:400px auto;background-repeat:no-repeat}
.scr{position:absolute;left:0;top:0;width:400px;height:816px;overflow:hidden;background:#0A1530}
.boxsvg{position:absolute;left:0;top:0;overflow:visible}
.shade{position:absolute;left:0;top:0;width:400px;height:816px;background:#1A1216;overflow:hidden}
.card{position:absolute;left:0;width:400px;background-size:400px auto;background-repeat:no-repeat}
.qb{position:absolute;padding:20px 30px;border-radius:30px 30px 30px 8px;background:#fff;font-weight:700;font-size:32px;color:${C.navy};white-space:nowrap;
  box-shadow:0 12px 28px rgba(11,30,63,.13);transform-origin:0 100%}
.qb .ck{display:inline-block;width:40px;height:40px;border-radius:50%;background:${C.teal};color:#fff;font-size:26px;line-height:40px;text-align:center;margin-left:16px;vertical-align:2px}
.tag{position:absolute;padding:10px 20px;border-radius:999px;background:${C.navy};color:#fff;font-weight:700;font-size:22px;white-space:nowrap}
.corner{position:absolute;right:48px;top:40px;padding:10px 22px;border-radius:999px;border:2px solid ${C.navy};font-weight:700;font-size:22px;color:${C.navy};white-space:nowrap;transform-origin:100% 50%}
.num{position:absolute;color:#fff;font-weight:800;font-size:108px;letter-spacing:-0.03em;white-space:nowrap;display:flex;align-items:baseline}
.num .u{font-size:56px;margin-left:6px}
.nlab{position:absolute;color:#9FD9E0;font-weight:600;font-size:32px;white-space:nowrap}
`);
glassDefs();
const stage = document.getElementById('stage');
const world = mk('div', 'world', stage);
const hud = mk('div', 'hud', stage);
const fx = mk('div', 'hud', stage);
const IMG = n => `assets/${n}`;
const S = 400 / 980;                       // S09 캡처 → 휴대폰 화면 배율

// ── 로고 (fx) ───────────────────────────────────────────
const logo = mk('div', 'logo', fx);
const lSEA = mk('span', 'lw', logo, 'SEA'), lGN = mk('span', 'lw', logo, 'GNAL');
const dA = mk('div', 'ldot', logo), dB = mk('div', 'ldot', logo);
let L0 = null;
function logoMeasure() {
  lSEA.style.fontStretch = lGN.style.fontStretch = '125%';
  const wS = lSEA.offsetWidth, wG = lGN.offsetWidth, cw = 64, g = 6, tot = wS + g + cw + g + wG;
  const x0 = 960 - tot / 2, cx = x0 + wS + g + cw / 2, top = 540 - 176 * 0.5;
  L0 = { wS, wG, cw, g, cx, top, yA: 540 - 34, yB: 540 + 34 };
}
/** k: 0=로고, 1=점 하나 / mg: 두 점이 합쳐진 정도 */
function setLogo(k, mg) {
  const { wS, wG, cw, g, cx, top, yA, yB } = L0;
  const st = lerp(125, 62, clamp(k * 1.6));
  lSEA.style.fontStretch = lGN.style.fontStretch = st + '%';
  const cS = lSEA.offsetWidth, cG = lGN.offsetWidth;
  const sx = Math.max(0, 1 - k);
  const gap = (cw / 2 + g) * (1 - k);
  vis(lSEA, sx > 0.003); vis(lGN, sx > 0.003);
  lSEA.style.transformOrigin = '100% 50%'; lGN.style.transformOrigin = '0 50%';
  lSEA.style.transform = `translate(${cx - gap - cS}px,${top}px) scaleX(${wS * sx / cS})`;
  lGN.style.transform = `translate(${cx + gap}px,${top}px) scaleX(${wG * sx / cG})`;
  const ym = (yA + yB) / 2;
  tf(dA, cx - 17, lerp(yA, ym, mg) - 17); tf(dB, cx - 17, lerp(yB, ym, mg) - 17);
}

// ── 모양이 바뀌는 도형 1: 점 → 알약 → 휴대폰 → ☎ → 「☎ 파출소」 알약 (world) ──
const shape = mk('div', 'shape', world);
const shapeScr = mk('div', 'scr', shape);            // 휴대폰 시절의 화면
const homeA = makeHome(shapeScr);
const pillTxt = mk('div', 'pilltxt', shape);
const pillMask = maskText(pillTxt, '바다 : 그 날의 신호', '');
const telIco = mk('div', 'tel', shape, `<svg viewBox="0 0 24 24" width="76" height="76"><path fill="#fff" d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>`);
const telTxt = mk('div', 'pilltxt', shape); telTxt.innerHTML = '<span style="display:flex;align-items:center;gap:16px;font-size:50px"><svg viewBox="0 0 24 24" width="50" height="50"><path fill="#2AD8E2" d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>파출소</span>';

function makeHome(parent) {
  // S09-1(10월 6일, 펼친 상태)에서 펼친 줄(628~1126px)을 오려 「접힌 화면」을 만든다 — 실제 픽셀만
  const h = mk('div', 'home', parent);
  const top = mk('div', 'strip', h), exp = mk('div', 'strip', h), rest = mk('div', 'strip', h);
  for (const e of [top, exp, rest]) e.style.backgroundImage = `url(${IMG('s09_1.png')})`;
  top.style.top = '0px'; top.style.height = px(628 * S); top.style.backgroundPosition = '0 0';
  exp.style.top = px(628 * S); exp.style.height = '0px'; exp.style.backgroundPosition = `0 ${-628 * S}px`;
  rest.style.height = px((2000 - 1126) * S); rest.style.backgroundPosition = `0 ${-1126 * S}px`;
  const o = { el: h, exp, rest, setOpen(hpx) { // hpx: 원본 픽셀 기준 펼친 높이(0~498)
    exp.style.height = px(hpx * S); rest.style.top = px((628 + hpx) * S); } };
  o.setOpen(498);
  return o;
}

// ── 문제 장면: 말풍선 (world) ───────────────────────────
// 질문이 쉬지 않고 나타나 「☎ 파출소」로 빨려 들어간다(사용자 요청 10-19: 전화가 빗발치는 느낌)
const QV = ['특보 언제 발효·해제돼요?', '이거 해도 돼요? 처벌 대상이에요?', '내일 파도·바람·물때 어때요?', '특보 해제됐어요?', '처벌 대상이에요?', '내일 바람 어때요?', '물때 언제예요?', '특보 언제 풀려요?', '출항해도 돼요?', '이거 처벌돼요?'];
const SPOTS = [[300, 300], [1180, 330], [260, 780], [1250, 760], [90, 520], [1480, 560], [700, 900], [1460, 230], [120, 230], [1500, 900], [70, 880], [620, 210], [1120, 920], [1560, 420], [140, 400], [880, 220], [420, 960], [1620, 680], [40, 660], [1000, 210], [1380, 950]];
const TPOP = [B(4) + 0.25, B(4, 2) + 0.25, B(4, 3) + 0.25];
for (let k = 0, tt = B(4, 4) + 0.25; tt < B(8) - 0.75; k++) { TPOP.push(tt); tt += Math.max(0.16, 0.42 - k * 0.018); }
const BUBS = TPOP.map((t, k) => { const big = k < 3, txt = QV[k % QV.length], [x, y] = SPOTS[k % SPOTS.length];
  const e = mk('div', 'bub', world, txt); cue(t, 'pop', big ? 0.8 : 0.45);
  const tf = t + (big ? 1.25 : 0.8);   // 파출소로 날아가기 시작(클릭 순간까지 계속)
  return { e, x, y, t, tf, ta: tf + 0.3, sc: big ? 1 : 0.8 }; });
const OUT = [[B(5, 3), 1240, 830], [B(6, 3), 180, 860]].map(([t, x, y]) => ({ e: mk('div', 'bub me', world, '특보 바뀔 때마다 알림톡 발송'), t, x, y }));
shape.style.zIndex = '3';
const RINGS = BUBS.map(b => { const r = mk('div', 'abs', world, '<svg width="700" height="700" viewBox="-350 -350 700 700" style="overflow:visible"><circle cx="0" cy="0" r="10" fill="none" stroke="#2AD8E2"/></svg>'); return { r, c: r.querySelector('circle'), ta: b.ta }; });

// ── 머리말 (hud) ───────────────────────────────────────
function HL(parent, lines, x, y, o = {}) {
  const size = o.size || 78, lh = size * 1.18;
  const ms = lines.map((ln, i) => { const m = maskText(parent, ln, 'hl'); m.el.style.fontSize = px(size);
    m.el.style.left = px(x); m.el.style.top = px(y + i * lh); if (o.center) m.el.style.transform = 'translateX(-50%)'; return m; });
  return { ms, set(t, tIn, tOut, exit = 'up') { ms.forEach((m, i) => setRise(m, t, tIn + i * 0.08, tOut == null ? null : tOut + i * 0.05, exit)); } };
}
const h1 = HL(hud, ['같은 질문, 매번 전화로'], 960, 70, { center: 1 });
const hAI = HL(hud, ['현직 해양경찰관이 AI와 만든 앱'], 960, 870, { center: 1, size: 70 });
const hCheck = HL(hud, ['AI가 쓰고, **검사가 거른다**'], 960, 870, { center: 1, size: 70 });
const hPush = HL(hud, ['특보가 바뀌면,', '**휴대폰으로**'], 130, 380, { size: 84 });
const hFirst2 = HL(hud, ['묻기 전에 **먼저**'], 130, 150, { size: 78 });
const pushSub = maskText(hud, '발표 · 발효 · 해제 때마다 알림', 'sub'); pushSub.el.style.cssText += ';left:134px;top:600px;font-size:32px';
// 휴대폰 화면 옆 설명(사용자 요청 10-19: 왼쪽이 비어 보이고 화면 설명이 없다)
// 기능 투어(사용자 요청 10-19: 참고 영상만큼 빠르게, 기능 위주로) — 2초마다 기능 하나
const TOUR = [['특보정보', '해역별 특보 현황과 바다 날씨를 한 화면에'], ['특보구역 지도', '연안바다·평수구역까지 93개 구역'],
  ['해양종합정보', '바람·파도·해류·관측부이를 지도 위에'], ['바다 한 점, 정보 11가지', '물때·파고·바람·수온을 한 번에'],
  ['태풍 4개 기관 비교', '한국·미국·일본·유럽 예보를 골라 보기'], ['위험예측', '관광지 1,354곳, 오늘·내일 사고 위험 조건'],
  ['AI 연안 안전 브리핑', '관할을 고르면 하루 세 번 연안 요약'], ['AI 법률 챗봇', '해양 법령을 근거 조문과 함께 쉬운 말로']];
const CAPS = TOUR.map(([a, d], i) => { const t0 = B(16 + i) + (i === 0 ? 0.2 : 0), t1 = B(17 + i);
  const mi = maskText(hud, String(i + 1).padStart(2, '0') + ' / 08', 'sub'); mi.el.style.cssText += ';left:134px;top:350px;font-size:24px;color:#0E9FAD;font-weight:800';
  const ma = maskText(hud, a, 'hl'); ma.el.style.cssText += ';left:130px;top:392px;font-size:68px';
  const mb = maskText(hud, d, 'sub'); mb.el.style.cssText += ';left:134px;top:490px;font-size:32px';
  return { t0, t1, i: mi, a: ma, b: mb }; });
const tourTag = mk('div', 'tag', hud, '심사 기간 공개');
// 소개 줄
const subA = maskText(hud, '현직 해양경찰관이 AI와 만든 해양안전 앱', 'sub'); subA.el.style.cssText += ';left:960px;top:612px;transform:translateX(-50%);font-size:36px;font-weight:700;color:#0B1E3F';
const subB = maskText(hud, '개인 개발 · 무료 · 광고 없음', 'sub'); subB.el.style.cssText += ';left:960px;top:668px;transform:translateX(-50%);font-size:28px;color:#5E6B80';
const corner = mk('div', 'corner', hud, '1 / 3 &nbsp;묻기 전에 먼저');

// ── 「묻기 전에 먼저」 큰 머리말 + 밑줄 → 터미널 창 → 휴대폰 → 숫자판 (world) ──
const big1 = maskText(world, '묻기 전에', 'hl'); big1.el.style.fontSize = '124px';
const big2 = maskText(world, '<em>먼저</em>', 'hl'); big2.el.style.fontSize = '124px';
const body = mk('div', 'win', world);          // 하나의 도형이 밑줄 → 창 → 휴대폰 → 숫자판 → 덮개 → 알약 → 점
const wbar = mk('div', 'wbar', body, '<i></i><i></i><i></i><span style="margin-left:14px">Claude Code — SEAGNAL</span>');
const term = mk('div', 'term', body);
const TYPED = '추측하지 말고 정확히 확인해서, 코드와 로직 그리고 데이터에 근거해서';
const uin = mk('div', 'uin', term);
// 실제 코드(origin/main local_server/services/push_helpers.js 236~330행) — 알림 제목 3줄(57·63·69번째)만 청록
const CODE = window.CODE_LINES.map((l, i) => [l, [57, 63, 69].includes(i) ? 1 : 0]);
const codeEls = CODE.map(([s, hi], i) => { const m = mk('div', 'mask', term); m.style.left = '40px'; m.style.top = px(118 + i * 34);
  const inn = mk('div', 'in tl2' + (hi ? ' hi' : ''), m); inn.textContent = s || ' '; return { m, inn, hi }; });
const codeFile = mk('div', 'tline', term, '<span style="color:#6E86AD">local_server/services/push_helpers.js</span>'); codeFile.style.left = '40px'; codeFile.style.top = '70px';
const CTL = ['규칙 파일 첫 줄: 추측 금지', '자동 검사 59종 · 테스트 묶음 126개', '다른 AI가 교차 검토', '시행착오 기록 400건 넘게'];
const ctlEls = CTL.map((s, i) => { const m = maskText(term, `<b>✓</b>${s}`, 'ctl'); m.el.style.left = '60px'; m.el.style.top = px(80 + i * 96); return m; });

// 작업 저장 알약(유리) · AI 도구 알약
const stat = Glass(world); stat.el.style.cssText += ';width:640px;height:84px';
stat.gc.innerHTML = '<div class="gpill" style="font-size:30px">작업 저장 <span id="o1"></span>회 중 AI <span id="o2"></span>회</div>';
const odo1 = Odo(stat.gc.querySelector('#o1'), '7,384'), odo2 = Odo(stat.gc.querySelector('#o2'), '7,217');
const statCap = maskText(world, '2026. 2.~10. 19. 저장 기록 기준', 'small');
const TOOLS = [['Antigravity', '가능성 확인'], ['ChatGPT · Codex', '구조'], ['Claude Design', '화면'], ['Claude Code', '코드·검사·운영'], ['Gemini', '아이콘']];
const toolEls = TOOLS.map(([a, b]) => { const g = Glass(world); g.el.style.cssText += ';width:300px;height:76px;border-radius:24px';
  g.gc.innerHTML = `<div class="gpill" style="padding:0 22px"><div class="lbl">${a}<small>${b}</small></div></div>`; return g; });
// 코드 칩 — 터미널에서 떨어져 나와 드롭 때 실제 알림 제목이 된다
const chip = Glass(world); chip.el.style.cssText += ';height:52px;width:330px';
chip.gc.innerHTML = '<div class="gpill chip" style="padding:0 20px">✅ ${fullTitle} 해제</div>';

// ── 휴대폰 화면(body 안) ────────────────────────────────
const pscr = mk('div', 'scr', body); pscr.style.left = '14px'; pscr.style.top = '14px'; pscr.style.borderRadius = '44px';
const punch = mk('div', 'punch', body);
const home = makeHome(pscr);
function shotLayer(src, w, top = 0, extraBg) {
  const d = mk('div', 'scr', pscr); if (extraBg) d.style.background = extraBg;
  const im = mk('img', 'shot', d); im.src = IMG(src); im.style.width = px(w); im.style.top = px(top); return d;
}
const L_s092 = shotLayer('s09_2.png', 400), L_s093 = shotLayer('s09_3.png', 400), L_s095 = shotLayer('s09_5.png', 400);
const L_s122 = shotLayer('s12_2.png', 400);
const L_map = shotLayer('s09_2.png', 400);
const L_186 = shotLayer('s18_6.png', 400), L_t1 = shotLayer('s20_1.png', 400, 0, '#0E1A2E'), L_t2 = shotLayer('s20_2.png', 400, 0, '#0E1A2E');
const L_rm = shotLayer('s32_c.png', 400), L_312 = shotLayer('s31_2.png', 400), L_332 = shotLayer('s33_2.png', 400);
const L_map2 = shotLayer('s09_2.png', 400); const sheet2 = mk('img', 'shot', L_map2); sheet2.src = IMG('s19_3.png'); sheet2.style.width = '400px';
const sheet = mk('img', 'shot', L_map); sheet.src = IMG('s19_1.png'); sheet.style.width = '400px';
const L_chat = shotLayer('s14_1.png', 400, 0, '#152542');
// 상자(선이 그려짐)
function Box(parent, x, y, w, h) {
  const P = 2 * (w + h);
  const s = mk('div', 'boxsvg', parent, `<svg width="${w + 8}" height="${h + 8}" style="overflow:visible"><rect x="2" y="2" width="${w}" height="${h}" rx="9" fill="none" stroke="${C.teal}" stroke-width="3.5" stroke-dasharray="${P}" stroke-dashoffset="${P}"/></svg>`);
  s.style.left = px(x - 2); s.style.top = px(y - 2);
  const r = s.querySelector('rect');
  return { set(t, t0) { vis(s, t >= t0); r.setAttribute('stroke-dashoffset', P * (1 - easeO(prog(t, t0, 0.17)))); } };
}
// 「풍랑 주의보」 배지: S09-1 y 1012~1035, x 703~828
const bxBadge = Box(home.exp, 284, (1006 - 628) * S, 56, 15);
// 발표·발효·해제예정 줄: S12-2 y 368~388 · 408~428 · 447~468, x 107~612
const bxRows = [363, 403, 442].map(y => Box(L_s122, 55, y * (400 / 720), 289, 17));
const SH = 400 / 907;
// 답 첫 단락: S14-1 y 867~1014, x 136~965
const bxChat = Box(L_chat, 44, 855 * (400 / 1132), 301, 171 * (400 / 1132));
// 조석 블록: S19-1 y 327~769, x 82~803
const bxTide = Box(L_map, 31, 212 + 315 * SH, 326, 465 * SH);
const bxWave = Box(L_map, 22, 212 + 1012 * SH, 168, 140 * SH);
const bxWind = Box(L_map, 198, 212 + 1012 * SH, 176, 140 * SH);
// 알림창(S13-1) — 카드 8장을 오려 하나씩 떨어뜨린다
const shade = mk('div', 'shade', pscr); shade.style.zIndex = '5';
const shTop = mk('div', 'card', shade); shTop.style.cssText += `;top:0;height:${64 * 0.463}px;background-image:url(${IMG('s13_1.png')});background-position:0 0`;
const SK = 400 / 864;
const cards = [0, 1, 2, 3, 4, 5, 6, 7].map(k => { const c = mk('div', 'card', shade);
  const y0 = 66 + 168 * k; c.style.height = px(156 * SK); c.style.backgroundImage = `url(${IMG('s13_1.png')})`; c.style.backgroundPosition = `0 ${-y0 * SK}px`;
  return { c, y: y0 * SK }; });

// Q&A 말풍선 · 예고 알약 (hud)
const QB = [['특보 언제 발효·해제돼요?', 130, 330, B(26)], ['이거 해도 돼요? 처벌 대상이에요?', 130, 460, B(27)], ['내일 파도·바람·물때 어때요?', 130, 590, B(28)]]
  .map(([s, x, y, t]) => { const e = mk('div', 'qb', hud, s + '<span class="ck">✓</span>'); cue(t, 'pop', 0.8); return { e, x, y, t, ck: e.querySelector('.ck') }; });
const chatTag = mk('div', 'tag', world, 'AI 법률 챗봇 · 심사 기간 공개');
const NEXT = [['2 / 3 &nbsp;특보 알림 하나를 꼼꼼하게', 130, 760, B(29, 1)], ['3 / 3 &nbsp;사고 나던 곳을 미리', 130, 830, B(29, 2)]]
  .map(([s, x, y, t]) => { const e = mk('div', 'tag', hud, s); e.style.fontSize = '26px'; e.style.padding = '12px 24px'; cue(t, 'pop', 0.7); return { e, x, y, t }; });

// 숫자판 (world — body 가 판이 됨)
const nums = [
  { x: 493, v: 1862, f: '1,862', u: '명', lab: '설치', t: B(30) },
  { x: 960, v: 82, f: '82', u: '만 건', lab: '알림', t: B(31) },
  { x: 1427, v: 75, f: '75', u: '종', lab: '공공데이터', t: B(32) },
].map(n => { const box = mk('div', 'num', world); const od = Odo(box, n.f); mk('span', 'u', box, n.u);
  const lab = maskText(world, n.lab, 'nlab'); cue(n.t, 'pop', 0.9); return { ...n, box, od, lab }; });
const nSmall = maskText(hud, '2026. 10. 19. 기준 · 설문 응답자 중 해양경찰이 아닌 사용자 22.0%', 'small');
nSmall.el.style.cssText += ';left:960px;top:735px;transform:translateX(-50%);font-size:24px';
const install = maskText(hud, '구글 플레이 <b style="color:#0E9FAD">SEA:GNAL</b> &nbsp;·&nbsp; seagnal-server.fly.dev', 'sub');
install.el.style.cssText += ';left:960px;top:790px;transform:translateX(-50%);font-size:36px;font-weight:700;color:#0B1E3F';
const endDot = mk('div', 'ldot', fx); endDot.style.background = C.navy;

const iris = Iris(fx);
const cur = Cursor(world);

// ── 커서 길 ────────────────────────────────────────────
const PX = 1050, PY = 132;   // 휴대폰 화면 왼쪽 위(world)
cur.path = [
  [B(7, 2), 1720, 1140], [B(7, 3) + 0.35, 985, 600], [B(8), 975, 588],
  [16.3, 1120, 600], [17.3, 1360, 600], [19.8, 520, 790], [20.5, 530, 790], [22.0, 1020, 790],
  [24.3, 1260, 190], [24.9, 1300, 178], [25.2, 260, 360], [26.4, 250, 700], [27.0, 900, 620], [30.2, 1000, 640],
];
// 기능 투어: 기능마다 누를 곳과 누르는 시각(기능 시작 + dt)
const TAPS = [[200, 224, 0.35], [120, 640, 0.35], [371, 173, 0.35], [180, 300, 0.15], [276, 580, 0.9], [230, 330, 0.8], [200, 140, 0.35], [200, 330, 0.35]];
TAPS.forEach(([x, y, dt], i) => { const tf = B(16 + i); cur.path.push([tf + dt - 0.25, PX + x - 30, PY + y + 40], [tf + dt, PX + x, PY + y], [tf + dt + 0.3, PX + x + 6, PY + y + 4]); });
cur.path.push([B(24) + 0.15, PX + 200, PY + 12], [B(24) + 0.2, PX + 200, PY + 12]);
// 끌어내리기: 알림창 아래 끝을 커서가 쥔다(42.495~48.495)
const pull = t => {
  if (t < B(24) + 0.2) return 0;
  if (t < B(25)) return keys(t, [[B(24) + 0.2, 0], [B(24, 2) + 0.3, 250], [B(24, 3), 330], [B(24, 4), 400], [B(25) - 0.02, 520]], easeIO);
  return 520 + (816 - 520) * spr(t, B(25), { z: 0.5, f: 2.4 });
};
for (let t = B(24) + 0.25; t < B(25); t += 0.125) cur.path.push([t, PX + 200, PY + pull(t) + 14]);
cur.path.push([B(25), PX + 200, PY + 534], [B(25, 2), PX + 330, PY + 680],
  [B(26) - 0.1, PX + 200, PY + 790], [B(26), PX + 200, PY + 790], [B(26, 2) - 0.1, PX + 200, PY + 300],   // 알림창 밀어 올림
  [B(26, 2) + 0.2, PX + 70, PY + 210], [B(26, 4), PX + 330, PY + 254],
  [B(27) - 0.15, PX + 367, PY + 762], [B(27), PX + 367, PY + 762],       // AI 챗봇 단추
  [B(27, 3) - 0.1, PX + 60, PY + 320], [B(27, 4), PX + 340, PY + 320],
  [B(28) - 0.1, PX + 354, PY + 18], [B(28), PX + 354, PY + 18],          // 닫기
  [B(28) + 0.25, PX + 150, PY + 786], [B(28) + 0.45, PX + 230, PY + 150], [B(28, 3) + 0.2, PX + 300, PY + 700], [B(29), PX + 320, PY + 720],
  [B(30), 1700, 760], [62.9, 660, 840], [65.4, 1300, 840]);
cur.hide = [[B(8) + 0.1, 16.3], [65.5, 99]];
[B(7, 4) - 0.35, 19.995, ...TAPS.map(([x, y, dt], i) => B(16 + i) + dt), B(24) + 0.2, B(26), B(27), B(28), B(28) + 0.25, B(28) + 0.5].forEach(t => cur.click(t));
cue(20.495, 'typing', 0.7); cue(21.995, 'click', 0.8);
cue(B(25), 'notify', 1.0);
cue(B(8, 3), 'pop', 0.6);
cue(B(5, 3), 'notify', 0.35); cue(B(6, 3), 'notify', 0.35);
for (let i = 0; i < 5; i++) cue(B(13, 2) + i * 0.25, 'pop', 0.55);
cue(B(13), 'pop', 0.8);
for (const n of [26, 27, 28]) cue(B(n) + 1.75, 'pop', 0.5);

// 카메라: [t,값,스프링]의 합
// 카메라: [t,값,스프링]의 합 — 기능마다 확대(왼쪽 설명이 가려지지 않게 중심 x 1100)
// [첫 확대 y, 배율, 두 번째로 옮겨 갈 y(없으면 null)] — 기능 하나(2초) 안에서 확대 → 옮김 → 빠짐
const FOC = [[420, 1.6, 640], [760, 1.6, 600], [520, 1.45, 720], [600, 1.45, 790], [330, 1.6, null], [525, 1.6, null], [330, 1.55, 600], [460, 1.7, 580]];
const camX = [], camY = [], camZ = [];
FOC.forEach(([cyf, zf, cy2], i) => { const tf = B(16 + i);
  camX.push([tf + 0.3, 1100, { z: .8, f: 2.2 }]); camY.push([tf + 0.3, cyf, { z: .8, f: 2.2 }]); camZ.push([tf + 0.3, zf, { z: .8, f: 2.2 }]);
  if (cy2) { camY.push([tf + 1.0, cy2, { z: .8, f: 2.4 }]); camZ.push([tf + 1.0, zf + 0.12, { z: .75, f: 2.4 }]); }
  camZ.push([tf + 1.65, 1.0 + 0.06 * (i % 2), { z: .8, f: 2.6 }]); camY.push([tf + 1.65, 540, { z: .8, f: 2.6 }]); });
camX.push([B(24), 1100, { z: .9, f: 2 }], [B(25), 960, { z: .55, f: 1.6 }],
  [B(26) + 0.35, 1115, { z: .85, f: 1.5 }], [B(27) + 0.3, 1130, { z: .85, f: 1.6 }], [B(28) + 0.5, 1140, { z: .85, f: 1.6 }], [B(29), 960, { z: .9, f: 1.5 }]);
camY.push([B(24), 540, { z: .9, f: 2 }],
  [B(26) + 0.35, 365, { z: .85, f: 1.5 }], [B(27) + 0.3, 470, { z: .85, f: 1.6 }], [B(28) + 0.5, 600, { z: .85, f: 1.6 }], [B(29), 540, { z: .9, f: 1.5 }]);
camZ.push([B(24), 1.0, { z: .9, f: 2 }], [B(24, 2), 1.06, { z: .7, f: 3 }], [B(24, 3), 1.12, { z: .7, f: 3 }], [B(24, 4), 1.24, { z: .8, f: 1.6 }], [B(25), 1.0, { z: .5, f: 1.8 }],
  [B(26) + 0.35, 1.9, { z: .85, f: 1.5 }], [B(27), 1.2, { z: .85, f: 1.8 }], [B(27) + 0.3, 1.6, { z: .85, f: 1.6 }], [B(28), 1.0, { z: .9, f: 2 }],
  [B(28) + 0.5, 1.5, { z: .85, f: 1.6 }], [B(29), 1.0, { z: .9, f: 1.5 }]);
camX.push([B(11) - 0.1, 760, { z: .8, f: 2 }], [B(11, 4) + 0.1, 960, { z: .85, f: 2 }], [B(13), 1080, { z: .85, f: 2 }], [B(13, 3), 840, { z: .85, f: 2 }], [B(14), 900, { z: .85, f: 2 }], [B(16) - 0.2, 960, { z: .9, f: 2 }]);
camY.push([B(11) - 0.1, 735, { z: .8, f: 2 }], [B(11, 4) + 0.1, 540, { z: .85, f: 2 }], [B(16) - 0.2, 540, { z: .9, f: 2 }]);
camZ.push([B(11) - 0.1, 1.6, { z: .8, f: 2 }], [B(11, 4) + 0.1, 1.12, { z: .85, f: 2 }], [B(13), 1.15, { z: .85, f: 2 }], [B(14), 1.08, { z: .85, f: 2 }]);
for (const tc of [B(14) + 0.25, B(14, 3), B(15), B(15, 3)]) camZ.push([tc, 1.14, { z: .6, f: 3.2 }], [tc + 0.22, 1.08, { z: .7, f: 3 }]);
camZ.push([B(16) - 0.2, 1.0, { z: .9, f: 2 }]);
const byT = a => a.sort((p, q) => p[0] - q[0]); byT(camX); byT(camY); byT(camZ);

// ── seek ───────────────────────────────────────────────
function rectStyle(e, x, y, w, h, r, bg) {
  e.style.transform = `translate(${x}px,${y}px)`; e.style.width = px(w); e.style.height = px(h);
  e.style.borderRadius = px(r); if (bg) e.style.background = bg;
}
/** 여러 단계의 사각형: steps=[[t,{x,y,w,h,r}],...] 각 값을 chain 스프링으로 */
function rectChain(t, r0, steps) {
  const o = {};
  for (const k of ['x', 'y', 'w', 'h', 'r']) o[k] = chain(t, r0[k], steps.map(([tt, rr, op]) => [tt, rr[k], op]));
  return o;
}

window.seek = function (t) {
  if (!L0) logoMeasure();
  // 카메라
  const cz = chain(t, 1, camZ), cx = chain(t, 960, camX), cy = chain(t, 540, camY);
  world.style.transform = `translate(${W / 2}px,${H / 2}px) scale(${cz}) translate(${-cx}px,${-cy}px)`;

  // 로고
  let k = 0, mg = 0;
  if (t < 2.6) { k = chain(t, 0, [[1.265, .25, { z: .75, f: 3 }], [1.515, .5, { z: .75, f: 3 }], [1.765, .75, { z: .75, f: 3 }], [2.145, 1, { z: .8, f: 3 }]]); mg = spr(t, 2.2, { z: .8, f: 3 }); }
  if (t >= HIT) { k = 1 - spr(t, HIT, { z: .78, f: 2.6 }); mg = 1 - spr(t, HIT, { z: .78, f: 2.6 }); if (t > DUR - 0.03) k = mg = 0; }
  const logoOn = t < B(2) || t >= HIT;
  vis(logo, logoOn); if (logoOn) setLogo(clamp(k, 0, 1.2), clamp(mg));

  // 도형 1 (점 → 알약 → 휴대폰 → ☎ → 알약)
  const shOn = t >= B(2) && t < B(8) + 0.62;
  vis(shape, shOn);
  if (shOn) {
    const ym = 540;
    const r = rectChain(t, { x: L0.cx - 17, y: ym - 17, w: 34, h: 34, r: 17 }, [
      [B(2), { x: 960 - 320, y: 494, w: 640, h: 92, r: 46 }, { z: .62, f: 2.2 }],
      [B(3), { x: 960 - 214, y: 118, w: 428, h: 844, r: 58 }, { z: .72, f: 1.8 }],
      [B(4), { x: 960 - 215, y: 560 - 60, w: 430, h: 120, r: 60 }, { z: .65, f: 2.2 }],
    ]);
    // ☎ 울림: 도입 음표마다 흔들림
    let rot = 0, bump = 0;
    if (on(t, B(4) + 0.3, B(8))) rot = 2.2 * Math.sin(t * 52) * (0.5 + 0.5 * clamp((t - B(4)) / 5));
    for (const bb of BUBS) { const d = t - bb.ta; if (d > 0 && d < 0.6) { bump += 0.07 * Math.exp(-d * 7) * Math.cos(d * 22); rot += 5 * Math.exp(-d * 8) * Math.sin(d * 40); } }
    rectStyle(shape, r.x, r.y, r.w, r.h, r.r, t < B(2) + 0.1 ? C.teal : (t < B(3) + 0.05 ? C.navy : (t < B(4) + 0.08 ? '#10141B' : C.navy)));
    shape.style.transform += ` rotate(${rot}deg) scale(${1 + bump})`; shape.style.transformOrigin = '50% 50%';
    shape.style.boxShadow = on(t, B(3), B(4) + 0.2) ? '0 0 0 2px #2B3240 inset,0 30px 60px rgba(11,30,63,.22)' : '0 16px 40px rgba(11,30,63,.18)';
    // 화면: 휴대폰일 때만, 아래에서 밀려 올라옴
    const scrOn = on(t, B(3) + 0.15, B(4) + 0.06);
    vis(shapeScr, scrOn);
    if (scrOn) { shapeScr.style.left = '14px'; shapeScr.style.top = '14px'; shapeScr.style.width = px(Math.max(0, r.w - 28)); shapeScr.style.height = px(Math.max(0, r.h - 28));
      shapeScr.style.borderRadius = px(Math.max(0, r.r - 14));
      homeA.el.style.transform = `translateY(${816 * (1 - spr(t, B(3) + 0.25, { z: .85, f: 1.7 }))}px)`; }
    vis(pillTxt, t < B(3) + 0.3); setRise(pillMask, t, B(2, 3), B(3), 'up');
    const telOn = false;
    vis(telIco, telOn); if (telOn) { const s = spr(t, B(4) + 0.25, { z: .5, f: 2.6 }) * (1 - spr(t, B(7, 2) - 0.32, { z: 1, f: 4 })); telIco.style.transform = `translate(${r.w / 2 - 38}px,${r.h / 2 - 38}px) scale(${s})`; }
    const ttOn = t >= B(4) + 0.15; vis(telTxt, ttOn);
    if (ttOn) { const s = spr(t, B(4) + 0.2, { z: .6, f: 2.6 }); telTxt.style.transform = `scale(${s})`;
      const press = cur.clicks.some(c => t - c >= 0 && t - c < 0.25); if (press) shape.style.transform += ' scale(0.97)'; }
  }
  // 소개 줄
  setRise(subA, t, B(2, 2), B(3), 'down'); setRise(subB, t, B(2, 3) + 0.25, B(3), 'down');
  // 1/3 표시
  const cOn = t >= B(2, 2) && t < 65.62; vis(corner, cOn);
  if (cOn) corner.style.transform = `scale(${spr(t, B(2, 2), { z: .55, f: 2.4 })})`;

  // 말풍선: 나타남 → 잠깐 → 파출소로 빨려 들어감, 꽂힐 때 벨 파동
  const PCX = 960, PCY = 560;
  for (const b of BUBS) {
    const onb = t >= b.t && t < b.ta; vis(b.e, onb); if (!onb) continue;
    const w = b.e.offsetWidth, h = b.e.offsetHeight;
    let s = b.sc * spr(t, b.t, { z: .5, f: 2.6 }), x = b.x, y = b.y;
    if (t >= b.tf) { const u = easeI(prog(t, b.tf, 0.3)); x = lerp(b.x, PCX - w / 2, u); y = lerp(b.y, PCY - h / 2, u); s *= (1 - 0.85 * u); }
    b.e.style.transform = `translate(${x}px,${y}px) scale(${Math.max(0, s)})`;
  }
  RINGS.forEach(r => { const d = t - r.ta, o = d > 0 && d < 0.55; vis(r.r, o); if (!o) return;
    r.r.style.transform = `translate(${PCX - 350}px,${PCY - 350}px)`; const u = easeO(d / 0.55);
    r.c.setAttribute('r', 90 + 250 * u); r.c.setAttribute('stroke-width', 7 * (1 - u)); });
  OUT.forEach(o => { const on_ = on(t, o.t, o.t + 1.4); vis(o.e, on_); if (!on_) return;
    const u = spr(t, o.t, { z: .8, f: 2 }), out = easeI(prog(t, o.t + 0.95, 0.45));
    const x = lerp(PCX - 230, o.x, u) + (o.x > PCX ? 900 : -900) * out, y = lerp(PCY - 40, o.y, u);
    o.e.style.transform = `translate(${x}px,${y}px) scale(${0.3 + 0.7 * Math.min(1, u)})`; });
  h1.set(t, B(5, 3), B(8), 'down');

  // 조리개: 「☎ 파출소」 둘레에서 닫혔다(14.495~15.1) 열림(15.495~)
  let ik = 0;
  if (on(t, B(8), B(8, 3))) ik = easeI(prog(t, B(8), 0.6)); else if (on(t, B(8, 3), B(9))) ik = 1 - easeO(prog(t, B(8, 3), 0.6));
  iris.set(t, 960, 560, ik, 0.3);

  // 큰 머리말 「묻기 전에 먼저」
  const bigY = 420 - 60 * spr(t, B(9, 3), { z: .7, f: 2 });
  const bw1 = big1.el.offsetWidth, bw2 = big2.el.offsetWidth, bx0 = 960 - (bw1 + 26 + bw2) / 2;
  big1.el.style.left = px(bx0); big1.el.style.top = px(bigY); big2.el.style.left = px(bx0 + bw1 + 26); big2.el.style.top = px(bigY);
  window._u = { x: bx0 + bw1 + 26 + 10, w: bw2 - 20 };
  setRise(big1, t, B(8, 3), B(10), 'up'); setRise(big2, t, B(8, 4), B(10), 'up');

  // 하나의 도형: 밑줄 → 창 → 휴대폰 → 숫자판 → 덮개 → 알약 → 점
  const bOn = t >= B(9) && t < HIT;
  vis(body, bOn);
  if (bOn) {
    const u0 = window._u.x, uy = bigY + 160;
    const uw = window._u.w * easeIO(prog(t, B(9), 0.75));
    const r = rectChain(t, { x: u0, y: uy, w: uw, h: 12, r: 6 }, [
      [B(10), { x: 360, y: 230, w: 1200, h: 56, r: 22 }, { z: .75, f: 2.2 }],
      [B(10, 2), { x: 360, y: 230, w: 1200, h: 560, r: 28 }, { z: .8, f: 2.0 }],
      [B(16), { x: 1036, y: 118, w: 428, h: 844, r: 58 }, { z: .72, f: 1.7 }],
      [B(30) + 0.15, { x: 260, y: 300, w: 1400, h: 420, r: 44 }, { z: .72, f: 1.8 }],
      [TB(3), { x: -260, y: -260, w: 2440, h: 1600, r: 0 }, { z: 1, f: 3.2 }],
      [TB(3) + 0.32, { x: 960 - 310, y: 540 - 46, w: 620, h: 92, r: 46 }, { z: .8, f: 3 }],
      [TB(4) + 0.1, { x: L0.cx - 17, y: 540 - 17, w: 34, h: 34, r: 17 }, { z: .8, f: 3.4 }],
    ]);
    if (t < B(10)) { r.w = uw; }
    const isPhone = on(t, B(16) + 0.1, B(30) + 0.1);
    rectStyle(body, r.x, r.y, Math.max(0, r.w), Math.max(0, r.h), r.r, t < B(10) ? C.teal : (isPhone ? '#10141B' : C.navy));
    body.style.boxShadow = t >= B(10) && t < TB(3) ? (isPhone ? '0 0 0 2px #2B3240 inset,0 30px 60px rgba(11,30,63,.22),0 8px 18px rgba(11,30,63,.16)' : '0 0 0 1.5px rgba(255,255,255,.55) inset,0 30px 60px rgba(11,30,63,.24)') : 'none';
    vis(wbar, on(t, B(10), B(16) + 0.05));
    vis(term, on(t, B(10, 2), B(16) + 0.35));
    // 입력 줄 타이핑
    const nTyped = Math.floor(clamp((t - B(11)) / 1.45) * TYPED.length);
    const sent = t >= B(11, 4) + 0.05;
    const blink = Math.floor(t * 2.5) % 2 === 0;
    uin.style.left = '40px';
    uin.style.top = px(sent ? 492 - 446 * spr(t, B(11, 4) + 0.05, { z: .9, f: 2.6 }) : 492);
    uin.style.color = sent ? '#9FB3D1' : '#fff'; uin.style.fontSize = px(sent ? 30 - 6 * spr(t, B(11, 4), { z: 1, f: 3 }) : 30);
    uin.innerHTML = '<span style="color:#2AD8E2">›</span> ' + TYPED.slice(0, nTyped) + (t >= 19.995 && !sent && blink ? '<span class="caret"></span>' : '');
    vis(uin, t >= 19.995 && t < B(14));
    vis(codeFile, on(t, B(12), B(14)));
    // 코드가 쏟아짐: 줄이 빠르게 위로 흘러가며(초당 약 16줄) ✅ 해제 줄이 가운데 올 때 멈춤
    const scrollC = (118 + 69 * 34 - 300) * easeIO(prog(t, B(12) + 0.3, 3.5));
    const col = spr(t, B(14), { z: 1, f: 3 });
    codeEls.forEach((c, i) => {
      const y = (118 + i * 34 - scrollC) * (1 - col) - 40 * col;
      const tin = B(12) + Math.min(i, 12) * 0.08;
      const o = t >= tin && t < B(14) + 0.5 && y > 60 && y < 560;
      vis(c.m, o); if (!o) return;
      c.m.style.top = px(y); c.inn.style.transform = `translateY(${riseY(t, tin, null)}%)`; c.m.style.height = px(34 * (1 - col) + 4);
    });
    ctlEls.forEach((m, i) => setRise(m, t, B(14, 1 + i * 2) + (i === 0 ? 0.25 : 0), B(16), 'down'));
    if (isPhone) { pscr.style.width = '400px'; pscr.style.height = '816px'; }
  }
  // 작업 저장 알약
  const stOn = on(t, B(13), B(16) + 0.4); vis(stat.el, stOn);
  if (stOn) { const s = spr(t, B(13), { z: .55, f: 2.4 }), ss = 1 - spr(t, B(16), { z: 1, f: 3 });
    stat.el.style.transform = `translate(920px,128px) scale(${s * ss})`; stat.el.style.transformOrigin = '50% 50%';
    const r = easeO(prog(t, B(13) + 0.05, 1.6)); odo1.set(7384 * r); odo2.set(7217 * r); }
  setRise(statCap, t, B(13, 2), B(16), 'down'); statCap.el.style.left = '930px'; statCap.el.style.top = '86px';
  toolEls.forEach((g, i) => { const ti = B(13, 2) + i * 0.25, o = on(t, ti, B(16) + 0.4); vis(g.el, o); if (!o) return;
    const s = spr(t, ti, { z: .5, f: 2.6 }) * (1 - spr(t, B(16), { z: 1, f: 3.2 }));
    g.el.style.transform = `translate(${50}px,${290 + i * 96}px) scale(${s})`; });
  hAI.set(t, B(12), B(14), 'up'); hCheck.set(t, B(14), B(16), 'down');

  // 코드 칩: 접힐 때 떨어져 나와 휴대폰 왼쪽 위에서 기다림 → 드롭 때 첫 알림 제목으로
  const chOn = false; vis(chip.el, false);
  if (chOn) {
    let x = chain(t, 400, [[B(14), 1180, { z: .8, f: 2 }], [B(16), 560, { z: .8, f: 1.6 }]]);
    let y = chain(t, 230 + 118 + 13 * 34, [[B(14), 800, { z: .8, f: 2 }], [B(16), 880, { z: .8, f: 1.6 }]]);
    let sc = 1;
    if (t >= B(25)) { const u = spr(t, B(25), { z: .9, f: 2.4 }); x = lerp(x, PX + 78, u); y = lerp(y, PY + 46 - 4, u); sc = lerp(1, 0.36, u); }
    const pop = t < B(14) ? 0 : spr(t, B(14), { z: .55, f: 2.6 });
    chip.el.style.transformOrigin = '0 0';
    chip.el.style.transform = `translate(${x}px,${y}px) scale(${sc * Math.min(1, pop)})`;
  }

  // 휴대폰 화면들
  const pOn = on(t, B(16) + 0.1, B(30) + 0.2); vis(pscr, pOn); vis(punch, pOn);
  if (pOn) {
    // 접는 셔터: 숫자판으로 바뀌기 직전 화면이 위아래에서 닫힘
    const shut = spr(t, B(30), { z: 1, f: 4 });
    pscr.style.clipPath = `inset(${408 * shut}px 0 ${408 * shut}px 0 round 44px)`;
    // 화면 순서: [시각, 레이어, 방향]
    const SEQ = [[B(16) + 0.15, home.el, 'up'], [B(17), L_186, 'right'], [B(18), L_s092, 'right'], [B(19), L_map2, 'none'], [B(20), L_t1, 'right'], [B(20) + 1.0, L_t2, 'wipe'],
      [B(21), L_rm, 'right'], [B(21) + 0.9, L_312, 'up'], [B(22), L_332, 'right'], [B(23), L_chat, 'zoom'], [B(24), home.el, 'left'],
      [B(26) - 0.01, L_s122, 'none'], [B(27), L_chat, 'zoom'], [B(28) + 0.27, L_map, 'right']];
    const layers = [home.el, L_s092, L_s093, L_s095, L_s122, L_chat, L_map, L_186, L_t1, L_t2, L_rm, L_312, L_332, L_map2];
    let ci = -1; for (let i = 0; i < SEQ.length; i++) if (t >= SEQ[i][0]) ci = i;
    layers.forEach(l => vis(l, false));
    if (ci >= 0) {
      const [ts, L, dir] = SEQ[ci], u = spr(t, ts, { z: .9, f: 2.3 });
      vis(L, true); L.style.transformOrigin = '50% 50%';
      if (dir === 'up') L.style.transform = `translateY(${816 * (1 - u)}px)`;
      else if (dir === 'right' || dir === 'left') {
        const sgn = dir === 'right' ? 1 : -1;
        L.style.transform = `translateX(${sgn * 400 * (1 - u)}px)`;
        if (ci > 0 && t - ts < 0.9) { const P = SEQ[ci - 1][1]; if (P !== L) { vis(P, true); P.style.transform = `translateX(${-sgn * 400 * u}px)`; } }
      } else if (dir === 'zoom') { // 챗봇 단추 자리에서 창이 커짐
        L.style.transformOrigin = '367px 762px'; L.style.transform = `scale(${Math.max(0.001, spr(t, ts + 0.05, { z: .75, f: 2.4 }))})`;
        if (t - ts < 0.6) { const P = SEQ[ci - 1][1]; vis(P, true); P.style.transform = 'none'; }
      } else if (dir === 'wipe') { L.style.clipPath = `inset(0 ${100 * (1 - easeIO(prog(t, ts, 0.45)))}% 0 0)`; if (t - ts < 0.5) { const P = SEQ[ci - 1][1]; vis(P, true); P.style.transform = 'none'; P.style.clipPath = 'none'; } }
      else L.style.transform = 'none';
      if (dir !== 'wipe') L.style.clipPath = 'none';
      layers.forEach(l => { l.style.zIndex = l === L ? 2 : 1; });
      // 챗봇 닫기: 단추 자리로 오그라듦 → 아래 화면(특보구역 카드) → 지도 밀기
      if (L === L_map && t - ts < 0.9) { vis(L_s122, true); L_s122.style.transform = `translateX(${-400 * u}px)`; }
      if (on(t, B(28), B(28) + 0.27)) { vis(L_chat, true); vis(L_s122, true); L_s122.style.transform = 'none';
        L_chat.style.transformOrigin = '367px 762px'; L_chat.style.transform = `scale(${Math.max(0.001, 1 - easeI(prog(t, B(28), 0.25)))})`; }
    }
    home.setOpen(498);
    sheet2.style.top = px(2 + 814 * (1 - spr(t, B(19) + 0.25, { z: .85, f: 2.2 })));
    bxBadge.set(t, 999); bxChat.set(t, B(23) + 0.6);
    // 지도 위 해점 시트
    sheet.style.top = px(212 + 604 * (1 - spr(t, B(28) + 0.55, { z: .85, f: 2.2 })));
    bxRows.forEach((b, i) => b.set(t, B(26, 2) + i * 0.45));
    bxTide.set(t, B(28, 3) + 0.1); bxWave.set(t, B(28, 3) + 0.35); bxWind.set(t, B(28, 3) + 0.6);
    // 알림창
    const pl = t < B(26) ? pull(t) : 816 * (1 - spr(t, B(26) + 0.05, { z: .9, f: 2 }));
    vis(shade, pl > 0.5);
    shade.style.transform = `translateY(${pl - 816}px)`;
    const slot = 77.8;
    cards.forEach((c, i) => {
      if (i === 0) { const o = t >= B(25); vis(c.c, o); if (o) c.c.style.top = px(c.y - 120 * (1 - spr(t, B(25) + 0.02, { z: .6, f: 2.6 }))); return; }
      vis(c.c, true); c.c.style.top = px(c.y - slot * (1 - spr(t, B(25) + 0.02, { z: .7, f: 2.6 }))); });
    vis(shTop, true);
  }
  hPush.set(t, B(24), B(26), 'up');
  setRise(pushSub, t, B(25, 2), B(26), 'up');
  CAPS.forEach(c => { setRise(c.i, t, c.t0, c.t1, 'up'); setRise(c.a, t, c.t0 + 0.05, c.t1, 'up'); setRise(c.b, t, c.t0 + 0.15, c.t1, 'up'); });
  const ttOn2 = on(t, B(23) + 0.3, B(24)); vis(tourTag, ttOn2); if (ttOn2) tourTag.style.transform = `translate(134px,550px) scale(${spr(t, B(23) + 0.3, { z: .55, f: 2.6 })})`;
  hFirst2.set(t, B(26), B(30), 'up');
  // Q&A 말풍선
  QB.forEach((q, i) => { const o = on(t, q.t, B(30) + 0.5); vis(q.e, o); if (!o) return;
    const s = spr(t, q.t, { z: .55, f: 2.4 }), suck = spr(t, B(30), { z: 1, f: 2.2 });
    q.e.style.transform = `translate(${lerp(q.x, 900, suck)}px,${lerp(q.y, 520, suck)}px) scale(${Math.max(0, s * (1 - suck))})`;
    const ck = q.t + 1.75; q.ck.style.transform = `scale(${t >= ck ? spr(t, ck, { z: .45, f: 3 }) : 0})`; });
  const tgOn = on(t, B(27) + 0.4, B(28)); vis(chatTag, tgOn);
  if (tgOn) chatTag.style.transform = `translate(${PX + 20}px,${PY - 64}px) scale(${spr(t, B(27) + 0.4, { z: .55, f: 2.6 })})`;
  NEXT.forEach(n => { const o = on(t, n.t, B(30) + 0.5); vis(n.e, o); if (!o) return;
    const s = spr(t, n.t, { z: .55, f: 2.4 }), suck = spr(t, B(30), { z: 1, f: 2.2 });
    n.e.style.transform = `translate(${lerp(n.x, 900, suck)}px,${lerp(n.y, 520, suck)}px) scale(${Math.max(0, s * (1 - suck))})`; });

  // 숫자판
  nums.forEach(n => { const o = on(t, n.t, TB(3) + 0.06); vis(n.box, o);
    if (o) { const s = spr(t, n.t, { z: .55, f: 2.4 }); const r = easeO(prog(t, n.t + 0.05, 1.2));
      n.od.set(n.v * clamp(r, 0, 1)); n.box.style.transform = `translate(${n.x - n.box.offsetWidth / 2}px,${380}px) scale(${s})`; n.box.style.transformOrigin = '50% 60%'; }
    setRise(n.lab, t, n.t + 0.25, null); n.lab.el.style.left = px(n.x - n.lab.el.offsetWidth / 2); n.lab.el.style.top = '545px'; });
  setRise(nSmall, t, B(30, 3), null); setRise(install, t, B(32, 2), null);
  if (t >= TB(3) + 0.03) { vis(nSmall.el, false); vis(install.el, false); nums.forEach(n => { vis(n.box, false); vis(n.lab.el, false); }); }
  // 끝 점 → 로고
  vis(endDot, false);

  cur.set(t);
  // 유리 굴절 맞추기
  stat.align(cz);
};
window.READY = (async () => { await document.fonts.ready; stat.refract(wbar); })();
