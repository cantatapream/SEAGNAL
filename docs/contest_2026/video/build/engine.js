/* SEA:GNAL 소개 영상 엔진 — 모든 화면 상태는 seek(t) 한 번으로 시간에서 계산한다(프레임 사이 상태 없음).
   부품: 스프링 · 마스크 글 · 커서 · 카메라 · 조리개 · 안드로이드 휴대폰 · 숫자 굴림 · 리퀴드 글라스 · 효과음 큐 */
'use strict';
const W = 1920, H = 1080;
const C = { bg: '#FBFAF7', navy: '#0B1E3F', teal: '#2AD8E2', tealText: '#0E9FAD', orange: '#F28C28',
  ink: '#0B1E3F', gray: '#8A93A3', light: '#E9ECF1' };

// ── 수학 ────────────────────────────────────────────────
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const easeIO = u => (u = clamp(u), u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeO = u => (u = clamp(u), 1 - Math.pow(1 - u, 3));
const easeI = u => (u = clamp(u), u * u * u);
const prog = (t, t0, d) => clamp((t - t0) / d);
/** 닫힌 형식 스프링 계단 응답(0→1, 넘침 있음). z=감쇠비, f=고유 진동수(Hz). t0 이전 0 */
function spr(t, t0, o = {}) {
  const z = o.z ?? 0.55, f = o.f ?? 2.1, tau = t - t0;
  if (tau <= 0) return 0;
  const w = 2 * Math.PI * f;
  if (z >= 1) { return 1 - Math.exp(-w * tau) * (1 + w * tau); }
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + (z * w / wd) * Math.sin(wd * tau));
}
/** 목표가 여러 번 바뀌는 값 = 바뀔 때마다 스프링 하나씩 더한 합. steps=[[t,값,opt?],...] */
function chain(t, v0, steps) {
  let v = v0, prev = v0;
  for (const s of steps) { v += (s[1] - prev) * spr(t, s[0], s[2]); prev = s[1]; }
  return v;
}
/** 구간 보간: keys=[[t,v],...] 사이를 easeIO 로 */
function keys(t, ks, ef = easeIO) {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i][0]) { const [t0, a] = ks[i - 1], [t1, b] = ks[i];
      const u = ef((t - t0) / (t1 - t0));
      return Array.isArray(a) ? a.map((x, k) => lerp(x, b[k], u)) : lerp(a, b, u); }
  }
  return ks[ks.length - 1][1];
}
const on = (t, a, b) => t >= a && t < b;

// ── DOM ──────────────────────────────────────────────────
function mk(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  (parent || document.getElementById('stage')).appendChild(e);
  return e;
}
const vis = (e, v) => { e.style.display = v ? '' : 'none'; };
function tf(e, x, y, s = 1, r = 0, extra = '') {
  e.style.transform = `translate(${x}px,${y}px) scale(${s}) rotate(${r}deg) ${extra}`;
}
const px = v => v + 'px';

// ── 효과음 큐 (로드 때 한 번 등록) ───────────────────────
window.CUES = [];
function cue(t, name, gain = 1) { window.CUES.push([+t.toFixed(4), name, gain]); }

// ── 마스크 글: 선 아래에서 솟고, 위로 밀려 나가거나 아래로 접혀 들어간다 ──
/** html 안의 **강조**는 청록. 반환: {el, set(t)} */
function maskText(parent, html, cls = 'hl') {
  const m = mk('div', 'mask ' + cls, parent);
  const inner = mk('div', 'in', m, html.replace(/\*\*(.+?)\*\*/g, '<em>$1</em>'));
  return { el: m, inner };
}
/** 솟기: tIn 에 스프링으로 0, tOut 이후 exit('up'|'down') */
function riseY(t, tIn, tOut, exit = 'up') {
  if (t < tIn) return 115;
  let y = 115 * (1 - spr(t, tIn, { z: 0.72, f: 2.0 }));
  if (tOut != null && t >= tOut) y += (exit === 'up' ? -118 : 118) * spr(t, tOut, { z: 1, f: 2.6 });
  return y;
}
function setRise(mt, t, tIn, tOut, exit) {
  const y = riseY(t, tIn, tOut, exit);
  vis(mt.el, t >= tIn && (tOut == null || t < tOut + 0.9));
  mt.inner.style.transform = `translateY(${y}%)`;
}

// ── 커서 ────────────────────────────────────────────────
function Cursor(parent) {
  const e = mk('div', 'cursor', parent,
    `<svg width="44" height="58" viewBox="0 0 22 29"><path d="M2 1.5 L2 23.5 L7.6 18.4 L11.2 26.6 L14.6 25.1 L11.1 17.2 L18.6 17.2 Z" fill="#0B0F17" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`);
  const o = { el: e, path: [], clicks: [], hide: [] };
  /** path=[[t,x,y],...] — 점 사이를 부드럽게(easeIO) */
  o.set = (t) => {
    const p = o.path;
    const shown = p.length && t >= p[0][0] && !o.hide.some(([a, b]) => t >= a && t < b);
    vis(e, shown);
    if (!shown) return;
    const [x, y] = keys(t, p.map(q => [q[0], [q[1], q[2]]]));
    let s = 1;
    for (const c of o.clicks) {
      const d = t - c;
      if (d >= 0 && d < 0.32) s = Math.min(s, d < 0.07 ? 1 - 0.15 * (d / 0.07) : 0.85 + 0.15 * spr(t, c + 0.07, { z: 0.5, f: 4 }));
    }
    e.style.transform = `translate(${x - 4}px,${y - 3}px) scale(${s})`;
  };
  o.click = (t, snd = 'click') => { o.clicks.push(t); cue(t, snd); };
  return o;
}

// ── 카메라(Screen Studio 식): cams=[[t,cx,cy,zoom],...] ──
function camTransform(t, cams) {
  const [cx, cy, z] = keys(t, cams.map(k => [k[0], [k[1], k[2], k[3]]]));
  return { cx, cy, z, css: `translate(${W / 2}px,${H / 2}px) scale(${z}) translate(${-cx}px,${-cy}px)` };
}

// ── 조리개 6날: 육각 구멍 반지름 r, 회전 a, 중심 (cx,cy) ──
function irisPath(cx, cy, r, a, R) {
  const V = [], d = [];
  for (let i = 0; i < 6; i++) { const th = a + i * Math.PI / 3; V.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]); }
  const hit = (p, q) => { // p 에서 q 방향 반직선이 반지름 R 원과 만나는 점
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const fx = p[0] - cx, fy = p[1] - cy, b = fx * ux + fy * uy, c = fx * fx + fy * fy - R * R;
    const s = -b + Math.sqrt(Math.max(0, b * b - c)); return [p[0] + ux * s, p[1] + uy * s];
  };
  const P = V.map((v, i) => hit(v, V[(i + 1) % 6]));     // 변 i 를 V[i+1] 너머로 늘린 끝
  const blades = [];
  for (let i = 0; i < 6; i++) {
    const vi = V[i], Pi = P[i], Pp = P[(i + 5) % 6];
    // 날 i: V[i] → 변 i 연장 끝 P[i] → 짧은 호 → 변 i-1 연장 끝 P[i-1] → V[i]
    blades.push(`M${vi[0]},${vi[1]} L${Pi[0]},${Pi[1]} A${R},${R} 0 0 0 ${Pp[0]},${Pp[1]} Z`);
  }
  return blades;
}
function Iris(parent) {
  const svg = mk('div', 'iris', parent, `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${'<path/>'.repeat(6)}</svg>`);
  const paths = [...svg.querySelectorAll('path')];
  /** k: 0=활짝(안 보임) 1=닫힘 */
  return { el: svg, set(t, cx, cy, k, rot0 = 0) {
    vis(svg, k > 0.001);
    if (k <= 0.001) return;
    if (k >= 0.997) { paths.forEach((p, i) => { p.setAttribute('d', i ? '' : `M0,0H${W}V${H}H0Z`); p.setAttribute('fill', '#0B1E3F'); p.setAttribute('stroke', 'none'); }); return; }
    const R = 2300, rMax = 1500, r = Math.max(2, rMax * (1 - k));
    const bl = irisPath(cx, cy, r, rot0 + k * 1.05, R);
    paths.forEach((p, i) => { p.setAttribute('d', bl[i]); p.setAttribute('fill', i % 2 ? '#0D2347' : '#0B1E3F');
      p.setAttribute('stroke', '#2A4370'); p.setAttribute('stroke-width', '2'); });
  } };
}

// ── 숫자 굴림(오도미터) ─────────────────────────────────
function Odo(parent, fmt, cls = 'odo') {
  // fmt 예: '1,862' → 자리마다 띠
  const e = mk('div', cls, parent);
  const cols = [];
  for (const ch of fmt) {
    if (/\d/.test(ch)) { const m = mk('span', 'od-m', e); const s = mk('span', 'od-s', m, '0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>0'); cols.push(s); }
    else mk('span', 'od-c', e, ch);
  }
  const n = cols.length;
  return { el: e, set(v) {
    v = Math.max(0, v); if (Math.abs(v - Math.round(v)) < 0.02) v = Math.round(v);
    for (let k = 0; k < n; k++) { // k=0 이 가장 높은 자리. 윗자리는 아랫자리가 9→0 으로 넘어갈 때만 굴러간다
      const p = Math.pow(10, n - 1 - k);
      const base = Math.floor(v / p) % 10, rem = v % p;
      const roll = p === 1 ? (v % 1) : clamp(rem - (p - 1), 0, 1);
      cols[k].style.transform = `translateY(${-(base + roll) / 11 * 100}%)`;
    }
  } };
}

// ── 안드로이드 휴대폰 ───────────────────────────────────
/** 화면 412×900 비율(0.49)에 맞춤. w=화면 너비. screen 안에 레이어를 쌓는다 */
function Phone(parent, w = 400) {
  const h = Math.round(w / 0.49);
  const body = mk('div', 'phone', parent);
  body.style.width = px(w + 28); body.style.height = px(h + 28);
  const scr = mk('div', 'pscreen', body); scr.style.width = px(w); scr.style.height = px(h);
  const hole = mk('div', 'punch', body);
  return { el: body, scr, hole, w, h };
}
/** 휴대폰 화면에 그림 레이어: src, 화면 너비에 맞춰 위쪽 정렬 */
function Shot(parent, src, w) {
  const e = mk('img', 'shot', parent); e.src = src; e.style.width = px(w); return e;
}

// ── 리퀴드 글라스 ───────────────────────────────────────
// 유리 아래 장면 복제(src 그림)를 SVG 변위 맵으로 굴절. 흰 바탕 위에서는 테두리 빛만 보인다.
function glassDefs() {
  // 둥근 사각 거리장 변위 맵(가장자리일수록 바깥→안쪽으로 당김)
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'), im = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + .5) / N * 2 - 1, v = (y + .5) / N * 2 - 1;
    const ex = Math.max(0, Math.abs(u) - 0.72) / 0.28, ey = Math.max(0, Math.abs(v) - 0.6) / 0.4;
    const k = Math.min(1, Math.hypot(ex, ey));
    const s = Math.pow(k, 2.2);
    const i = (y * N + x) * 4;
    im.data[i] = 128 - Math.sign(u) * s * 127 * (ex > 0 ? 1 : 0);
    im.data[i + 1] = 128 - Math.sign(v) * s * 127 * (ey > 0 ? 1 : 0);
    im.data[i + 2] = 128; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const url = cv.toDataURL();
  const d = mk('div', '', document.body, `<svg width="0" height="0" style="position:absolute"><defs>
  <filter id="lg" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feImage href="${url}" result="map" preserveAspectRatio="none" x="0" y="0" width="100%" height="100%"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="26" xChannelSelector="R" yChannelSelector="G" result="r"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="30" xChannelSelector="R" yChannelSelector="G" result="g"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="34" xChannelSelector="R" yChannelSelector="G" result="b"/>
    <feColorMatrix in="r" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="rr"/>
    <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="gg"/>
    <feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="bb"/>
    <feBlend in="rr" in2="gg" mode="screen" result="rg"/><feBlend in="rg" in2="bb" mode="screen"/>
  </filter></defs></svg>`);
  return d;
}
/** 유리 상자: 안쪽에 굴절 레이어(.refr)와 내용(.gc). refract(srcEl) 로 아래 그림을 맞춰 복제 */
function Glass(parent, cls = '') {
  const e = mk('div', 'glass ' + cls, parent);
  const refr = mk('div', 'refr', e);
  const gc = mk('div', 'gc', e);
  let clone = null, srcEl = null;
  return { el: e, gc,
    refract(src) { srcEl = src; refr.innerHTML = ''; clone = src.cloneNode(true); clone.removeAttribute('id'); clone.style.position = 'absolute'; clone.style.transformOrigin = '0 0'; refr.appendChild(clone); },
    /** 매 프레임 레이아웃이 끝난 뒤 부른다: 화면 좌표 차이를 유리 자신의 배율로 나눠 맞춘다 */
    align(scale = 1) {
      if (!clone || !srcEl || e.style.display === 'none') return;
      const a = e.getBoundingClientRect(), b = srcEl.getBoundingClientRect();
      const sx = b.width / (srcEl.offsetWidth || 1);
      clone.style.width = px(srcEl.offsetWidth); clone.style.height = px(srcEl.offsetHeight);
      clone.style.transform = `translate(${(b.left - a.left) / scale}px,${(b.top - a.top) / scale}px) scale(${sx / scale})`;
    } };
}

// ── 공통 스타일 ─────────────────────────────────────────
function baseCSS(extra = '') {
  const s = document.createElement('style');
  s.textContent = `
@font-face{font-family:Pre;src:url(fonts/Pretendard-Regular.otf);font-weight:400}
@font-face{font-family:Pre;src:url(fonts/Pretendard-Medium.otf);font-weight:500}
@font-face{font-family:Pre;src:url(fonts/Pretendard-SemiBold.otf);font-weight:600}
@font-face{font-family:Pre;src:url(fonts/Pretendard-Bold.otf);font-weight:700}
@font-face{font-family:Pre;src:url(fonts/Pretendard-ExtraBold.otf);font-weight:800}
@font-face{font-family:Arch;src:url(fonts/archivo.woff2);font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:Mono;src:url(fonts/GeistMono-Regular.woff2);font-weight:400}
@font-face{font-family:Mono;src:url(fonts/GeistMono-SemiBold.woff2);font-weight:600}
html,body{margin:0;padding:0;background:${C.bg};overflow:hidden}
#stage{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${C.bg};font-family:Pre,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased}
#stage *{box-sizing:border-box}
.abs,#stage>div{position:absolute;left:0;top:0}
.world{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0}
.hud{position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none}
.mask{position:absolute;overflow:hidden;padding:0.06em 0.04em 0.16em;white-space:nowrap}
.mask .in{transform:translateY(115%)}
.hl{font-weight:800;font-size:78px;letter-spacing:-0.035em;line-height:1.12;color:${C.navy}}
.hl em{font-style:normal;color:${C.tealText}}
.sub{font-weight:600;font-size:30px;letter-spacing:-0.02em;color:#3B4A63}
.small{font-weight:500;font-size:22px;color:#6B778A;letter-spacing:-0.01em}
.cursor{position:absolute;left:0;top:0;transform-origin:4px 3px;z-index:50;filter:drop-shadow(0 3px 5px rgba(0,0,0,.25))}
.iris{position:absolute;left:0;top:0;z-index:40}
.odo{display:inline-flex;align-items:flex-start;font-variant-numeric:tabular-nums}
.od-m{display:inline-block;height:1.1em;overflow:hidden;line-height:1.1em}
.od-s{display:inline-block;line-height:1.1em}
.od-c{display:inline-block;line-height:1.1em}
.phone{position:absolute;border-radius:58px;background:#10141B;box-shadow:0 0 0 2px #2B3240 inset,0 30px 60px rgba(11,30,63,.22),0 8px 18px rgba(11,30,63,.18)}
.pscreen{position:absolute;left:14px;top:14px;border-radius:44px;overflow:hidden;background:#0A1530}
.punch{position:absolute;width:16px;height:16px;border-radius:50%;background:#05070A;left:50%;top:30px;margin-left:-8px;box-shadow:0 0 0 2px #1a1f28}
.shot{position:absolute;left:0;top:0;display:block}
.glass{position:absolute;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.18);
  box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.75),inset 0 2px 1px rgba(255,255,255,.9),inset 0 -2px 6px rgba(11,30,63,.10),0 10px 26px rgba(11,30,63,.16)}
.glass .refr{position:absolute;inset:0;filter:url(#lg) saturate(1.15) brightness(1.06)}
.glass .gc{position:absolute;left:0;top:0;right:0;bottom:0}
${extra}`;
  document.head.appendChild(s);
}
