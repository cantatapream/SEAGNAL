/* 2·3편 공용 부품 — 1편(ep1.js)에서 검증한 것을 함수로 묶음: 로고 · 머리말 · 상자 · 사각형 모프 · 휴대폰 화면 밀기 */
'use strict';
const COMMON_CSS = `
.logo{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
.lw{position:absolute;font-family:Arch;font-weight:800;font-size:176px;line-height:1;color:${C.navy};white-space:nowrap;letter-spacing:-0.01em}
.ldot{position:absolute;width:34px;height:34px;border-radius:50%;background:${C.teal}}
.win{position:absolute;left:0;top:0;overflow:hidden}
.pilltxt{position:absolute;left:0;top:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:40px;letter-spacing:-0.02em}
.pilltxt .mask{position:relative}
.scr{position:absolute;left:0;top:0;width:400px;height:816px;overflow:hidden;background:#0A1530}
.boxsvg{position:absolute;left:0;top:0;overflow:visible}
.corner{position:absolute;right:48px;top:40px;padding:10px 22px;border-radius:999px;border:2px solid ${C.navy};font-weight:700;font-size:22px;color:${C.navy};white-space:nowrap;transform-origin:100% 50%}
.tag{position:absolute;padding:10px 20px;border-radius:999px;background:${C.navy};color:#fff;font-weight:700;font-size:22px;white-space:nowrap}
.gpill{display:flex;align-items:center;gap:12px;padding:0 28px;height:100%;white-space:nowrap;font-weight:700;color:${C.navy}}
.card{position:absolute;left:0;background-repeat:no-repeat}
`;
/** 로고: set(k, mg) — k 0=로고 1=점, mg 두 점 합침. cx = 「:」 가운데 x */
function Logo(parent) {
  const logo = mk('div', 'logo', parent);
  const a = mk('span', 'lw', logo, 'SEA'), b = mk('span', 'lw', logo, 'GNAL');
  const dA = mk('div', 'ldot', logo), dB = mk('div', 'ldot', logo);
  const o = { el: logo, L: null };
  o.measure = () => {
    a.style.fontStretch = b.style.fontStretch = '125%';
    const wS = a.offsetWidth, wG = b.offsetWidth, cw = 64, g = 6, tot = wS + g + cw + g + wG;
    const x0 = 960 - tot / 2; o.L = { wS, wG, cw, g, cx: x0 + wS + g + cw / 2, top: 540 - 88, yA: 506, yB: 574 }; o.cx = o.L.cx;
  };
  o.set = (k, mg) => {
    if (!o.L) o.measure();
    const { wS, wG, cw, g, cx, top, yA, yB } = o.L;
    a.style.fontStretch = b.style.fontStretch = lerp(125, 62, clamp(k * 1.6)) + '%';
    const cS = a.offsetWidth, cG = b.offsetWidth, sx = Math.max(0, 1 - k), gap = (cw / 2 + g) * (1 - k);
    vis(a, sx > 0.003); vis(b, sx > 0.003);
    a.style.transformOrigin = '100% 50%'; b.style.transformOrigin = '0 50%';
    a.style.transform = `translate(${cx - gap - cS}px,${top}px) scaleX(${wS * sx / cS})`;
    b.style.transform = `translate(${cx + gap}px,${top}px) scaleX(${wG * sx / cG})`;
    const ym = (yA + yB) / 2;
    tf(dA, cx - 17, lerp(yA, ym, mg) - 17); tf(dB, cx - 17, lerp(yB, ym, mg) - 17);
  };
  return o;
}
/** 머리말 여러 줄(마스크). o.center=가운데 정렬, o.size=글자 크기 */
function HL(parent, lines, x, y, o = {}) {
  const size = o.size || 78, lh = size * 1.18;
  const ms = lines.map((ln, i) => { const m = maskText(parent, ln, 'hl'); m.el.style.fontSize = px(size);
    m.el.style.left = px(x); m.el.style.top = px(y + i * lh); if (o.center) m.el.style.transform = 'translateX(-50%)'; return m; });
  return { ms, set(t, tIn, tOut, exit = 'up') { ms.forEach((m, i) => setRise(m, t, tIn + i * 0.08, tOut == null ? null : tOut + i * 0.05, exit)); } };
}
/** 선이 그려지는 상자(밑줄은 h 를 0 으로) */
function Box(parent, x, y, w, h, color = C.teal) {
  const P = h > 0 ? 2 * (w + h) : w;
  const shape = h > 0 ? `<rect x="2" y="2" width="${w}" height="${h}" rx="9" fill="none" stroke="${color}" stroke-width="3.5" stroke-dasharray="${P}" stroke-dashoffset="${P}"/>`
    : `<line x1="2" y1="2" x2="${w + 2}" y2="2" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${P}" stroke-dashoffset="${P}"/>`;
  const s = mk('div', 'boxsvg', parent, `<svg width="${w + 8}" height="${Math.max(h, 2) + 8}" style="overflow:visible">${shape}</svg>`);
  s.style.left = px(x - 2); s.style.top = px(y - 2);
  const r = s.firstChild.firstChild;
  return { el: s, set(t, t0, t1 = 1e9) { vis(s, t >= t0 && t < t1); r.setAttribute('stroke-dashoffset', P * (1 - easeO(prog(t, t0, 0.17)))); } };
}
function rectStyle(e, x, y, w, h, r, bg) {
  e.style.transform = `translate(${x}px,${y}px)`; e.style.width = px(Math.max(0, w)); e.style.height = px(Math.max(0, h));
  e.style.borderRadius = px(Math.max(0, r)); if (bg) e.style.background = bg;
}
function rectChain(t, r0, steps) {
  const o = {};
  for (const k of ['x', 'y', 'w', 'h', 'r']) o[k] = chain(t, r0[k], steps.map(([tt, rr, op]) => [tt, rr[k], op]));
  return o;
}
/** 휴대폰 화면 순서: seq=[[t, 레이어, 'up'|'right'|'left'|'none'|'zoom@x,y'|'wipe'],...] */
function screenSeq(t, seq, layers) {
  layers.forEach(l => vis(l, false));
  let ci = -1; for (let i = 0; i < seq.length; i++) if (t >= seq[i][0]) ci = i;
  if (ci < 0) return;
  const [ts, L, dir] = seq[ci], u = spr(t, ts, { z: .9, f: 2.3 });
  vis(L, true); L.style.transformOrigin = '50% 50%'; L.style.clipPath = 'none'; L.style.transform = 'none';
  const P = ci > 0 ? seq[ci - 1][1] : null;
  if (dir === 'up') L.style.transform = `translateY(${816 * (1 - u)}px)`;
  else if (dir === 'right' || dir === 'left') {
    const sgn = dir === 'right' ? 1 : -1;
    L.style.transform = `translateX(${sgn * 400 * (1 - u)}px)`;
    if (P && P !== L && t - ts < 0.9) { vis(P, true); P.style.clipPath = 'none'; P.style.transform = `translateX(${-sgn * 400 * u}px)`; }
  } else if (dir.startsWith('zoom@')) {
    const [zx, zy] = dir.slice(5).split(',');
    L.style.transformOrigin = `${zx}px ${zy}px`; L.style.transform = `scale(${Math.max(0.001, spr(t, ts + 0.03, { z: .75, f: 2.4 }))})`;
    if (P && t - ts < 0.7) { vis(P, true); P.style.transform = 'none'; P.style.clipPath = 'none'; }
  } else if (dir === 'wipe') {        // 왼쪽에서 오른쪽으로 새 화면이 드러남(다시 그려짐)
    L.style.clipPath = `inset(0 ${100 * (1 - easeIO(prog(t, ts, 0.45)))}% 0 0)`;
    if (P && t - ts < 0.5) { vis(P, true); P.style.transform = 'none'; P.style.clipPath = 'none'; }
  }
  // 겹칠 때 새 화면이 위
  layers.forEach(l => { l.style.zIndex = l === L ? 2 : 1; });
}
