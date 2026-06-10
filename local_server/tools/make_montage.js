// zone_crops/*.png 를 지역별 몽타주 시트로 합침. 각 타일에 인덱스 번호를 비트맵으로 새김.
const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');

const DIR = path.join(__dirname, 'zone_crops');
const results = require(path.join(DIR, '_index.json')).filter(r => r.ok);

// 5x7 숫자 비트맵
const FONT = {
  '0': ['111','101','101','101','101','101','111'],
  '1': ['010','110','010','010','010','010','111'],
  '2': ['111','001','001','111','100','100','111'],
  '3': ['111','001','001','111','001','001','111'],
  '4': ['101','101','101','111','001','001','001'],
  '5': ['111','100','100','111','001','001','111'],
  '6': ['111','100','100','111','101','101','111'],
  '7': ['111','001','001','010','010','100','100'],
  '8': ['111','101','101','111','101','101','111'],
  '9': ['111','101','101','111','001','001','111'],
};
function drawDigits(img, text, ox, oy, scale, color) {
  let cx = ox;
  for (const ch of text) {
    const g = FONT[ch]; if (!g) { cx += 4 * scale; continue; }
    for (let r = 0; r < 7; r++) for (let c = 0; c < g[r].length; c++) {
      if (g[r][c] === '1') for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++)
        img.setPixelColor(color, cx + c * scale + dx, oy + r * scale + dy);
    }
    cx += (g[0].length + 1) * scale;
  }
}

const TILE_W = 420, TILE_H = 360, LABEL_H = 44, GAP = 8, COLS = 3;
const PAD = TILE_W; // unused

(async () => {
  const byReg = {};
  results.forEach(r => { (byReg[r.region] = byReg[r.region] || []).push(r); });

  const sheets = [];
  for (const [region, arr] of Object.entries(byReg)) {
    arr.sort((a, b) => a.idx - b.idx);
    const rows = Math.ceil(arr.length / COLS);
    const cellW = TILE_W + GAP, cellH = TILE_H + LABEL_H + GAP;
    const W = COLS * cellW + GAP, H = rows * cellH + GAP + 50;
    const sheet = new Jimp({ width: W, height: H, color: 0xf2f2f2ff });

    // 지역 제목 (인덱스 번호만 비트맵, 지역명은 채팅 범례로)
    for (let i = 0; i < arr.length; i++) {
      const r = arr[i];
      const col = i % COLS, row = Math.floor(i / COLS);
      const x0 = GAP + col * cellW, y0 = 50 + GAP + row * cellH;
      // 라벨 바
      const labelBar = new Jimp({ width: TILE_W, height: LABEL_H, color: 0x1f3a5fff });
      drawDigits(labelBar, String(r.idx), 12, 6, 5, 0xffffffff);
      sheet.composite(labelBar, x0, y0);
      // 타일(레터박스)
      const tile = new Jimp({ width: TILE_W, height: TILE_H, color: 0xffffffff });
      const im = await Jimp.read(path.join(DIR, r.file));
      const s = Math.min(TILE_W / im.bitmap.width, TILE_H / im.bitmap.height);
      const nw = Math.max(1, Math.round(im.bitmap.width * s)), nh = Math.max(1, Math.round(im.bitmap.height * s));
      im.resize({ w: nw, h: nh });
      tile.composite(im, Math.round((TILE_W - nw) / 2), Math.round((TILE_H - nh) / 2));
      sheet.composite(tile, x0, y0 + LABEL_H);
    }
    const out = path.join(DIR, `_sheet_${region}.png`);
    await sheet.write(out);
    sheets.push({ region, out, items: arr.map(a => ({ idx: a.idx, name: a.name })) });
  }
  fs.writeFileSync(path.join(DIR, '_sheets.json'), JSON.stringify(sheets, null, 2));
  console.log('시트 생성:', sheets.map(s => `${s.region}(${s.items.length})`).join(', '));
})();
