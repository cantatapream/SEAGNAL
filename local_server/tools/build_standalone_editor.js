// zone_editor.html → 서버 없이 열리는 단독본(zone_editor_standalone.html) 생성.
// OpenLayers(css/js) + 격자(marine_zone_area.json) + 매핑(zone_grid_map.json)을
// 모두 인라인하여 더블클릭만으로 동작하게 만든다. (타일 배경은 인터넷 필요)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let h = read('zone_editor.html');
const olcss = read('assets/vendor/ol/ol.css');
const oljs = read('assets/vendor/ol/ol.js');
const GEO = read('marine_zone_area.json');
const MAP = read('assets/zone_grid_map.json');

function must(before) {
  if (!h.includes(before)) throw new Error('치환 대상 없음:\n' + before.slice(0, 80));
}

// 1) ol.css 인라인
const cssTag = '<link rel="stylesheet" href="/assets/vendor/ol/ol.css">';
must(cssTag);
h = h.replace(cssTag, '<style>\n' + olcss + '\n</style>');

// 2) ol.js 인라인 + 격자/매핑 데이터 인라인
const jsTag = '<script src="/assets/vendor/ol/ol.js"></script>';
must(jsTag);
h = h.replace(jsTag,
  '<script>\n' + oljs + '\n</script>\n' +
  '<script>window.__GEO__=' + GEO + ';\nwindow.__MAP__=' + MAP + ';</script>');

// 3) 데이터 fetch → 인라인 데이터 사용
const fetchBlock =
  "    [GEO, MAP] = await Promise.all([\n" +
  "      fetch('/marine_zone_area.json').then(r => r.json()),\n" +
  "      fetch('/assets/zone_grid_map.json').then(r => r.json())\n" +
  "    ]);";
must(fetchBlock);
h = h.replace(fetchBlock,
  '    GEO = window.__GEO__; MAP = JSON.parse(JSON.stringify(window.__MAP__));');

const out = path.join(ROOT, '..', 'zone_editor_standalone.html');
fs.writeFileSync(out, h);

// 검증
const leftDataFetch = (h.match(/fetch\(['"]\/(marine|assets)/g) || []).length;
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log('생성:', out);
console.log('크기:', kb, 'KB | 남은 데이터 fetch:', leftDataFetch, leftDataFetch ? '❌' : '✅');
