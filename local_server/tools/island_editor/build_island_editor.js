/**
 * ============================================================================
 * 파일명: local_server/tools/island_editor/build_island_editor.js
 * 역할  : 섬 테두리·해안 관광지 편집기 단독본(island_editor.html)을 만든다.
 *         OpenLayers 와 데이터(섬 목록·해안 관광지·참고 해안선)를 HTML 한 장에
 *         모두 넣어, 파일을 받아 더블클릭만 하면 서버 없이 열리게 한다.
 *         (배경지도 타일만 인터넷에서 받는다 — zone_editor 단독본과 같은 방식)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : island_editor.template.html(틀),
 *                    client/assets/vendor/ol/ol.js·ol.css,
 *                    local_server/config/coastal_safety/island_targets.json·coastal_spots.json,
 *                    client/land_mask_korea.json(그릴 섬 주변 해안선만 잘라 참고선으로 씀)
 *  - 서버 API      : 없음
 *  - 나를 쓰는 곳  : 사람이 직접 실행 — node local_server/tools/island_editor/build_island_editor.js
 *  - 비슷한 도구   : local_server/tools/build_standalone_editor.js (해구↔특보구역 편집기)
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const HERE = __dirname;
const read = p => fs.readFileSync(path.join(REPO, p), 'utf8');

// 그릴 섬 주변 몇 도까지 참고 해안선을 실을지 — 약 5km. 더 넓히면 파일만 커지고
// 섬 하나 그리는 화면(줌 16 전후)에서는 보이지도 않는다.
const REF_BOX_DEG = 0.05;

/**
 * 그릴 섬 주변의 앱 해안선(land_mask_korea.json)만 골라 선 목록으로 만든다.
 * 예: 팔미도 주변 5km 안의 작은 섬 테두리 + 본토 해안선 조각.
 * @param {Array} targets island_targets.json 의 targets
 * @returns {Array<Array<[number,number]>>} 경위도 선 목록(편집기에서 노란 점선으로 그림)
 * [연계] 편집기 template 의 refLayer — "앱이 지금 가진 해안선"을 보여 주어
 *        이미 있는 섬을 다시 그리지 않게 하려는 참고용이다.
 */
function nearbyCoastLines(targets) {
  const rings = JSON.parse(read('client/land_mask_korea.json')).rings;
  const near = (x, y) => targets.some(t => Math.abs(x - t.lon) <= REF_BOX_DEG && Math.abs(y - t.lat) <= REF_BOX_DEG);
  const out = [];
  for (const ring of rings) {
    // 연속으로 상자 안에 든 점들을 한 조각으로 묶는다(큰 고리는 일부만 잘려 나온다).
    let run = [];
    for (const [x, y] of ring) {
      if (near(x, y)) run.push([+x.toFixed(6), +y.toFixed(6)]);
      else { if (run.length >= 2) out.push(run); run = []; }
    }
    if (run.length >= 2) {
      // 고리 전체가 상자 안이면 닫아 준다.
      if (run.length === ring.length) run.push(run[0]);
      out.push(run);
    }
  }
  return out;
}

function main() {
  let h = fs.readFileSync(path.join(HERE, 'island_editor.template.html'), 'utf8');
  const targets = JSON.parse(read('local_server/config/coastal_safety/island_targets.json')).targets;
  const spots = JSON.parse(read('local_server/config/coastal_safety/coastal_spots.json')).spots;

  // 관광지는 편집기에 필요한 칸만 배열로 줄여 싣는다: [키, 이름, 시군구, 위도, 경도, 포함규칙]
  const spotRows = spots.map(s => [s.sgg + '|' + s.name, s.name, s.sgg_name, s.lat, s.lon, s.rule]);
  const ref = nearbyCoastLines(targets);
  const data = { targets, spots: spotRows, ref };

  const swap = (marker, body) => {
    if (!h.includes(marker)) throw new Error('치환 표시 없음: ' + marker);
    h = h.replace(marker, () => body);
  };
  swap('<!--@@OL_CSS@@-->', '<style>\n' + read('client/assets/vendor/ol/ol.css') + '\n</style>');
  swap('<!--@@OL_JS@@-->', '<script>\n' + read('client/assets/vendor/ol/ol.js') + '\n</script>');
  swap('<!--@@DATA@@-->', '<script>window.__ISLAND_EDITOR__=' + JSON.stringify(data) + ';</script>');

  const out = path.join(HERE, 'island_editor.html');
  fs.writeFileSync(out, h);
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log('생성:', path.relative(REPO, out), '|', kb, 'KB');
  console.log('섬', targets.length, '곳 | 관광지', spotRows.length, '곳 | 참고 해안선 조각', ref.length, '개');
}

main();
