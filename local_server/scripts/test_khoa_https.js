/**
 * test_khoa_https.js — 개방海(국립해양조사원, khoa.go.kr)를 http:// 로 부르는 코드가 없게 고정한다.
 *
 * [왜 있나] 개방海가 보안정책으로 오픈API 호출을 HTTPS 로 전환한다고 공지했다
 *   (시행 2026-09-15). 2026-09-28 전수 조사에서 서비스 코드 중 http:// 로 부르던 곳은
 *   해양종합정보 배경 해도(routes/ocean1.js /api/ocean/khoa-wms) 하나뿐이었고 HTTPS 로 바꿨다.
 *   HTTP 가 막히면 배경 지도가 통째로 비는데, 그 전까지는 아무 검사에도 안 걸린다.
 *   누가 모르고 되돌리거나 새 기능을 http:// 로 붙이면 여기서 걸리게 한다.
 *
 * [무엇을 보나] 앱이 실제로 쓰는 코드 — 서버(routes·services·scheduler·server.js)와
 *   화면(client/js · index2.html). 설명 글(// 또는 * 로 시작하는 줄)은 부르는 코드가 아니라 뺀다.
 *   개발할 때만 쓰는 도구(local_server/tools · client/zone_editor.html)도 뺀다 — 앱 사용자와 무관.
 *
 * [실행] node local_server/scripts/test_khoa_https.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → local_server/routes/ocean1.js (배경 해도 프록시)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const VERIFY_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8');
const OCEAN1_SRC = fs.readFileSync(path.join(ROOT, 'local_server', 'routes', 'ocean1.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

/** 폴더 아래 확장자가 맞는 파일을 전부 모은다(압축본 .gz/.br 은 제외). */
function walk(dir, exts, out) {
    if (!fs.existsSync(dir)) return out;
    fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) { if (d.name !== 'node_modules') walk(p, exts, out); return; }
        if (exts.some(e => d.name.endsWith(e))) out.push(p);
    });
    return out;
}

const FILES = []
    .concat(walk(path.join(ROOT, 'local_server', 'routes'), ['.js'], []))
    .concat(walk(path.join(ROOT, 'local_server', 'services'), ['.js'], []))
    .concat([path.join(ROOT, 'local_server', 'scheduler.js'), path.join(ROOT, 'local_server', 'server.js')])
    .concat(walk(path.join(ROOT, 'client', 'js'), ['.js'], []))
    .concat([path.join(ROOT, 'client', 'index2.html')])
    .filter(f => fs.existsSync(f));

const HTTP_KHOA = /http:\/\/(?:[a-z0-9-]+\.)*khoa\.go\.kr/i;
const hits = [];
FILES.forEach((f) => {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (!HTTP_KHOA.test(line)) return;
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return;   // 설명 글
        hits.push(path.relative(ROOT, f) + ':' + (i + 1));
    });
});

console.log('\n[1] 개방海를 http:// 로 부르는 서비스 코드');
ok('검사한 파일이 충분하다 (서버·화면 코드 100개 이상)', FILES.length > 100, String(FILES.length));
ok('★개방海를 http:// 로 부르는 줄이 없다', hits.length === 0, hits.join(' '));

console.log('\n[2] 배경 해도(개방海 WMS) 프록시');
ok('★배경 해도를 https:// 로 받는다',
    /const upstream = 'https:\/\/www\.khoa\.go\.kr\/oceanmap\/' \+ layer/.test(OCEAN1_SRC));
ok('Referer 도 https:// 로 보낸다',
    /'Referer': 'https:\/\/www\.khoa\.go\.kr\/oceanmap\/main\.do'/.test(OCEAN1_SRC));

// 이 검사 자체가 제대로 거르는지 — 일부러 넣은 http:// 줄은 잡고, 설명 글은 넘겨야 한다.
console.log('\n[3] 검사기 자체 확인');
const probe = ["const u = 'http://www.khoa.go.kr/x';", "  // http://www.khoa.go.kr/x", "   * http://www.khoa.go.kr/x"];
const caught = probe.filter((l) => {
    const t = l.trim();
    return HTTP_KHOA.test(l) && !(t.startsWith('//') || t.startsWith('*'));
});
ok('부르는 코드는 잡고 설명 글은 넘긴다', caught.length === 1 && caught[0] === probe[0]);

console.log('\n[4] 게이트 등록');
ok('verify_all.sh SUITES 에 test_khoa_https 가 있다', /test_khoa_https/.test(VERIFY_SRC));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
