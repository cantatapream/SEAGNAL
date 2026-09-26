#!/usr/bin/env node
// ============================================================================
// [용도] **본문이 가리키는 그림이 실제로 있는가** (P-13).
//
// 왜 있나
//   원문 안에 `<img id="N">` 으로 박힌 표·산식·도해가 있다. `cleanBody()` 가 그것을
//   `【이미지 N】` 마커로 바꾸고, `resolveRefs()` ①이 같은 폴더 `_이미지/N.png` 가 있는지
//   보아 **있을 때만** 화면에 건다. 없으면 화면이 그 자리를 **흔적 없이 지운다**.
//   ★거짓말은 안 하지만 — **원문에 있는 것이 조용히 사라진다.** 사용자는 표가 있었다는
//   사실조차 모른다. 그 자리가 실측 **224/1,069(21.0%)** 다.
//
// [왜 여기서 안 채우나] 받으려면 law.go.kr 에 나가야 한다. 2026-09-22 이 컨테이너에서
//   실측: `flDownload.do` 10번 중 **1번** 성공(나머지는 connection reset). 게다가 변환에
//   쓰는 **Pillow 이 안 깔려 있다**. 즉 지금 자리에서는 **수집 자체가 안 된다** → 3-25.
//   (같은 아웃바운드 불안정이 V4 의 간헐 500 `/api/ocean/khoa-wms` 의 원인이기도 하다, G-35)
//
// [판정] 기준선보다 **늘면 실패**. 0 을 요구하지 않는다 — 채우려면 네트워크가 있어야 한다.
//   늘었다면 **새로 들어온 원문의 그림을 안 받고 들여왔다**는 뜻이다.
//
// [쓰는 법]  node body_image_ready.js          사람이 보는 표
//            node body_image_ready.js --gate   기준선 대조
//            node body_image_ready.js --update 기준선 재생성(줄었을 때만)
//            node body_image_ready.js --list   없는 것을 다 찍는다
//
// [연계] `scripts/refactor/verify_all.sh` V5-23 · `article_text.js` cleanBody·resolveRefs ①
//        · 받는 도구 `dl_byl_images.sh` · 사람이 옮겨 적는 화면 `img_worksheet.py`
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('../../../../services/article_text.js');

const LEGAL = path.resolve(__dirname, '../..');
const RAW = path.join(LEGAL, 'raw');
const BASE = path.join(__dirname, 'baseline/body_image.json');

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '_이미지') walk(p, out); }
    else if (e.isFile() && p.endsWith('.txt')) out.push(p);
  }
  return out;
}

let refs = 0, have = 0;
const miss = [];
for (const f of walk(RAW, [])) {
  let t;
  try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (t.indexOf('<img id=') < 0 && t.indexOf('【이미지') < 0) continue;
  const tags = A.cleanBody(t).match(/【이미지\s*(\d+)】/g);
  if (!tags) continue;
  let names = new Set();
  try { names = new Set(fs.readdirSync(path.join(path.dirname(f), '_이미지'))); } catch { /* 폴더 없음 */ }
  for (const tag of new Set(tags)) {
    const num = tag.match(/(\d+)/)[1];
    refs++;
    if (names.has(num + '.png')) have++;
    else miss.push(`${f.slice(RAW.length + 1)}\t${num}`);
  }
}
const cur = { 가리킴: refs, 있다: have, 없다: miss.length };

const argv = process.argv.slice(2);
if (argv.includes('--list')) { miss.forEach(m => console.log(m)); process.exit(0); }
if (argv.includes('--update')) {
  fs.mkdirSync(path.dirname(BASE), { recursive: true });
  fs.writeFileSync(BASE, JSON.stringify({ 기준일: new Date().toISOString().slice(0, 10), ...cur }, null, 2) + '\n');
  console.log(`  기준선을 다시 구웠다 — ${JSON.stringify(cur)}`);
  process.exit(0);
}
const pct = refs ? (have / refs * 100).toFixed(1) : '0.0';
console.log(`  본문이 가리키는 그림 ${refs}개`);
console.log(`    ✅ 있다 ${have} (${pct}%)   ❌ 없다 ${miss.length}`);
console.log('    없으면 화면이 그 자리를 **흔적 없이 지운다** — 거짓말은 아니나 조용히 사라진다.');
console.log('    받으려면 law.go.kr 이 필요하다(3-25) · 목록은 --list');

if (!argv.includes('--gate')) process.exit(0);
let base = null;
if (fs.existsSync(BASE)) { try { base = JSON.parse(fs.readFileSync(BASE, 'utf8')); } catch { base = null; } }
if (!base) { console.log('  ⚠기준선이 없다 — --update 로 먼저 구워라'); process.exit(1); }
console.log(`  기준선(${base.기준일}) — 없다 ${base.없다}`);
if (cur.없다 > base.없다) {
  console.log(`  ❌ 늘었다: ${base.없다} → ${cur.없다} — **그림을 안 받고 원문을 들여왔다**`);
  process.exit(1);
}
console.log('  ✅ 기준선 대비 늘지 않았다');
process.exit(0);
