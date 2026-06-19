// 특보구역별 해구도 크롭 미리보기 생성기
// haegudo.gif 를 특보구역(zone_grid_map.json)별로 잘라, 구성 대해구 칸 외곽선을 그려 저장.
// 출력: tools/zone_crops/*.png + 지역별 몽타주 시트
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Jimp } = require('jimp');

const ROOT = path.join(__dirname, '..');
const HAEGUDO = path.join(ROOT, 'images', 'haegudo.gif');
const OUT = path.join(__dirname, 'zone_crops');
fs.mkdirSync(OUT, { recursive: true });

// --- GRID_DATA / SEA_ZONES_DATA 를 브라우저 전역 const 파일에서 추출 ---
// 브라우저 전역 const 파일에서 객체 리터럴만 brace-matching 으로 추출
function extractObject(file, name) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = code.indexOf(`${name} =`);
  if (m < 0) throw new Error(`${name} not found in ${file}`);
  let i = code.indexOf('{', m), depth = 0, start = i;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return JSON.parse(code.slice(start, i));
}
const GRID = extractObject('seaZones.js', 'GRID_DATA');
const SZ = extractObject('seaZonesData.js', 'SEA_ZONES_DATA');
const ZMAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'zone_grid_map.json'), 'utf8'));

// 해구번호 -> cellKey 역매핑
const numToCell = {};
for (const [key, num] of Object.entries(SZ)) {
  if (num && num !== '0' && !(num in numToCell)) numToCell[num] = key;
}

// cellKey -> 픽셀 사각형 {x1,y1,x2,y2}
function cellRect(key) {
  const [lonPart, latPart] = key.split('_');
  const [la, lb] = lonPart.split('-');
  const [ta, tb] = latPart.split('-');
  if (!GRID.lon[la] || !GRID.lon[lb] || !GRID.lat[ta] || !GRID.lat[tb]) return null;
  const xs = [GRID.lon[la].val, GRID.lon[lb].val];
  const ys = [GRID.lat[ta].val, GRID.lat[tb].val];
  return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
}

// 구역의 대해구 집합 = majorZones ∪ smallZones의 부모해구
function majorsOf(z) {
  const set = new Set();
  (z.majorZones || []).forEach(n => set.add(String(n)));
  (z.smallZones || []).forEach(s => set.add(String(s).split('-')[0]));
  return [...set];
}

const IMG_W = 2225, IMG_H = 2659;
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function drawRectOutline(img, x1, y1, x2, y2, color, thick = 3) {
  x1 = clamp(Math.round(x1), 0, img.bitmap.width - 1);
  x2 = clamp(Math.round(x2), 0, img.bitmap.width - 1);
  y1 = clamp(Math.round(y1), 0, img.bitmap.height - 1);
  y2 = clamp(Math.round(y2), 0, img.bitmap.height - 1);
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < img.bitmap.width && y < img.bitmap.height) img.setPixelColor(color, x, y); };
  for (let t = 0; t < thick; t++) {
    for (let x = x1; x <= x2; x++) { set(x, y1 + t); set(x, y2 - t); }
    for (let y = y1; y <= y2; y++) { set(x1 + t, y); set(x2 - t, y); }
  }
}

(async () => {
  const base = await Jimp.read(HAEGUDO);
  let font = null;
  try { const { loadFont, SANS_32_BLACK } = require('jimp/fonts'); font = await loadFont(SANS_32_BLACK); } catch (e) { console.log('font load skip:', e.message); }

  const zones = Object.entries(ZMAP).filter(([code, z]) => z && (z.name));
  const results = [];
  let idx = 0;
  for (const [code, z] of zones) {
    const majors = majorsOf(z);
    const rects = [];
    const missing = [];
    for (const m of majors) {
      const key = numToCell[m];
      if (!key) { missing.push(m); continue; }
      const r = cellRect(key);
      if (r) rects.push(r); else missing.push(m);
    }
    if (!rects.length) { results.push({ code, name: z.name, ok: false, reason: 'no rects', missing }); continue; }
    // 합집합 bbox + 여백
    let bx1 = Math.min(...rects.map(r => r.x1)), by1 = Math.min(...rects.map(r => r.y1));
    let bx2 = Math.max(...rects.map(r => r.x2)), by2 = Math.max(...rects.map(r => r.y2));
    const padX = Math.max(20, (bx2 - bx1) * 0.08), padY = Math.max(20, (by2 - by1) * 0.08);
    bx1 = clamp(bx1 - padX, 0, IMG_W); by1 = clamp(by1 - padY, 0, IMG_H);
    bx2 = clamp(bx2 + padX, 0, IMG_W); by2 = clamp(by2 + padY, 0, IMG_H);
    const w = Math.round(bx2 - bx1), h = Math.round(by2 - by1);
    if (w < 8 || h < 8) { results.push({ code, name: z.name, ok: false, reason: 'tiny', missing }); continue; }

    const crop = base.clone().crop({ x: Math.round(bx1), y: Math.round(by1), w, h });
    // 구성 대해구 칸 외곽선 (빨강)
    for (const r of rects) drawRectOutline(crop, r.x1 - bx1, r.y1 - by1, r.x2 - bx1, r.y2 - by1, 0xff2222ff, 4);

    idx++;
    const fname = `${String(idx).padStart(2, '0')}_${code}.png`;
    await crop.write(path.join(OUT, fname));
    results.push({ code, name: z.name, region: z.region, ok: true, idx, w, h, count: rects.length, missing, file: fname });
  }

  fs.writeFileSync(path.join(OUT, '_index.json'), JSON.stringify(results, null, 2));
  console.log('생성:', results.filter(r => r.ok).length, '/ 실패:', results.filter(r => !r.ok).length);
  results.filter(r => !r.ok).forEach(r => console.log('  ✗', r.code, r.name, r.reason, 'missing=', r.missing));
})();
