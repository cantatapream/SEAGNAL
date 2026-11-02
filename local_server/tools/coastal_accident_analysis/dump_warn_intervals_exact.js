// 저장소 build_accident_warn_flags.js 의 buildIntervals() 를 그대로 불러 "시각 단위" 특보 구간을 JSON 으로 덤프한다.
// (저장소 파일은 읽기만 한다. turf 는 buildIntervals 에 쓰이지 않아 빈 스텁으로 대체 — NODE_PATH 로 주입)
// 사용: NODE_PATH=<stub> node dump_warn_intervals_exact.js OUT.json
const path = require('path');
const mod = require(path.resolve(__dirname, '..', '..', 'scripts', 'build_accident_warn_flags.js'));
const iv = mod.buildIntervals();
const out = {};
for (const [k, arr] of Object.entries(iv)) out[k] = arr.map(x => [x.start, x.end]);
require('fs').writeFileSync(process.argv[2], JSON.stringify(out));
console.log('keys', Object.keys(out).length, 'intervals', Object.values(out).reduce((a, b) => a + b.length, 0));
