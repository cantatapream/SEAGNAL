// 사용: node m14_landmask_check.js <해양교통 혼잡 4단계 응답 JSON 두 개(mtc4_1010_03.json·mtc4_1010_12.json)가 있는 폴더> <client/land_mask_korea.json>
// M14 — 해안선 파일(client/land_mask_korea.json)이 바다를 육지로 잡는 오차 측정.
// 해양교통 혼잡 4단계 격자(배가 실제로 있는 칸) 중심점이 육지로 판정되는지 + 그 점에서 해안선까지 거리.
// 칸 크기 약 2.3×2.8km → 중심에서 칸 모서리까지 약 1.8km. 해안선이 1.8km 보다 멀면 "칸 전체가 육지" = 파일 오류 확실.
const fs = require('fs');
const S = process.argv[2], MASK = process.argv[3];
const mask = JSON.parse(fs.readFileSync(MASK));
const B = 0.02, idx = new Map();
for (const ring of mask.rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
  const [xi, yi] = ring[i], [xj, yj] = ring[j];
  for (let b = Math.floor(Math.min(yi, yj) / B); b <= Math.floor(Math.max(yi, yj) / B); b++) { if (!idx.has(b)) idx.set(b, []); idx.get(b).push(xi, yi, xj, yj); }
}
function land(lon, lat) { const e = idx.get(Math.floor(lat / B)) || []; let c = false;
  for (let k = 0; k < e.length; k += 4) { const [xi, yi, xj, yj] = [e[k], e[k+1], e[k+2], e[k+3]]; if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) c = !c; } return c; }
function distKm(lon, lat) { let best = Infinity; const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57;
  for (let b = Math.floor(lat / B) - 4; b <= Math.floor(lat / B) + 4; b++) { const e = idx.get(b); if (!e) continue;
    for (let k = 0; k < e.length; k += 4) { const ax = (e[k] - lon) * kx, ay = (e[k+1] - lat) * ky, bx = (e[k+2] - lon) * kx, by = (e[k+3] - lat) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + t * dx, ay + t * dy); if (d < best) best = d; } } return best; }
const cells = new Map();
for (const f of ['mtc4_1010_03.json', 'mtc4_1010_12.json']) for (const it of JSON.parse(fs.readFileSync(S + '/' + f)).response.body.items.item) cells.set(it.gridId, it);
let n = 0, onLand = [], far = [];
for (const it of cells.values()) { n++; if (land(it.longitude, it.latitude)) { const d = distKm(it.longitude, it.latitude); onLand.push([it.gridId, it.latitude, it.longitude, d, it.congestionIndex]); if (d > 1.8) far.push(onLand[onLand.length - 1]); } }
console.log('격자 칸(03시·12시 합집합)', n, '· 중심이 육지로 판정', onLand.length, '· 그중 해안선까지 1.8km 초과(칸 전체가 육지 = 파일 오류 확실)', far.length);
const h = [0, 0.5, 1, 1.8, 3, 5, 99]; for (let i = 0; i < h.length - 1; i++) console.log(`  해안선까지 ${h[i]}~${h[i+1]}km: ${onLand.filter(r => r[3] >= h[i] && r[3] < h[i+1]).length}`);
far.sort((a, b) => b[3] - a[3]); console.log('1.8km 초과 칸 (위도, 경도, 해안선까지 km, 혼잡지수):'); for (const r of far) console.log('  ' + r[1].toFixed(4) + ', ' + r[2].toFixed(4) + ', ' + r[3].toFixed(2) + ', ' + r[4]);
fs.writeFileSync('m14_onland.json', JSON.stringify(onLand));
