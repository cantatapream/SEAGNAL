/**
 * ============================================================================
 * 파일명: scripts/refactor/check_paths.js
 * 역할  : [V2 경로 무결성] index2.html 의 모든 <script src>·<link href> 와
 *         sw.js 의 캐시 목록이 실제 존재하는 파일을 가리키는지 검사한다.
 *         리팩토링(파일 이동) 후 배포 전에 404 를 사전 차단하는 안전장치.
 * 사용  : node scripts/refactor/check_paths.js
 *         종료코드 0 = 통과, 1 = 끊어진 경로 존재
 * [연계] scripts/refactor/check_order.js (V3), simulate.js (V4) 와 한 세트
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const STATIC_ROOT = path.join(ROOT, 'client'); // STEP 7: client/ 분리 완료
const INDEX = path.join(STATIC_ROOT, 'index2.html');
const SW = path.join(STATIC_ROOT, 'sw.js');

function stripQuery(p) { return p.split('?')[0]; }

function collectFromIndex() {
    const html = fs.readFileSync(INDEX, 'utf8');
    const refs = [];
    const scriptRe = /<script[^>]*\ssrc="([^"]+)"/g;
    const linkRe = /<link[^>]*\shref="([^"]+)"/g;
    let m;
    while ((m = scriptRe.exec(html))) refs.push({ kind: 'script', raw: m[1] });
    while ((m = linkRe.exec(html))) refs.push({ kind: 'link', raw: m[1] });
    return refs;
}

function collectFromSw() {
    if (!fs.existsSync(SW)) return [];
    const src = fs.readFileSync(SW, 'utf8');
    const refs = [];
    // sw.js 안의 따옴표로 감싼 로컬 자원 경로 (js/css/png/ico/json/html)
    const re = /['"](\/?[A-Za-z0-9_\-./]+\.(?:js|css|png|ico|json|html))(?:\?[^'"]*)?['"]/g;
    let m;
    while ((m = re.exec(src))) refs.push({ kind: 'sw-cache', raw: m[1] });
    return refs;
}

function isExternal(p) {
    return /^(https?:)?\/\//.test(p) || p.startsWith('data:');
}

// STEP 7: staticRoot 는 client/ 지만, 아래 URL 은 서버가 명시적 알리아스로 서빙
// (server.js 의 /services/typhoon_*.js sendFile — 서버·클라 공용 모듈)
const SERVER_ALIASES = new Set(['services/typhoon_radius.js', 'services/typhoon_message.js']);

// 기준선 철학(§13.2): 리팩토링 이전부터 끊어져 있던 경로는 허용 목록으로 관리하고,
// "새로 생긴" 끊어진 경로만 회귀로 판정한다. --snapshot 으로 허용 목록 생성.
const ALLOW = path.join(__dirname, 'baseline', 'paths_allowlist.json');

const refs = [...collectFromIndex(), ...collectFromSw()];
const broken = [];
let checked = 0;
for (const r of refs) {
    if (isExternal(r.raw)) continue;
    const rel = stripQuery(r.raw).replace(/^\//, '');
    if (!rel) continue;
    checked++;
    if (SERVER_ALIASES.has(rel)) {
        // 알리아스 대상이 서버 폴더에 실존하는지 확인
        if (!fs.existsSync(path.join(ROOT, 'local_server', rel))) broken.push(`${r.kind}(alias): ${r.raw}`);
        continue;
    }
    const abs = path.join(STATIC_ROOT, rel);
    if (!fs.existsSync(abs)) broken.push(`${r.kind}: ${r.raw}`);
}
const uniqueBroken = [...new Set(broken)].sort();

if (process.argv.includes('--snapshot')) {
    fs.mkdirSync(path.dirname(ALLOW), { recursive: true });
    fs.writeFileSync(ALLOW, JSON.stringify({ preexistingBroken: uniqueBroken }, null, 2));
    console.log(`[check_paths] 기준선 기록 — 기존 끊어진 경로 ${uniqueBroken.length}개를 허용 목록으로 저장`);
    process.exit(0);
}

const allow = fs.existsSync(ALLOW)
    ? JSON.parse(fs.readFileSync(ALLOW, 'utf8')).preexistingBroken : [];
const newBroken = uniqueBroken.filter((b) => !allow.includes(b));

console.log(`[check_paths] 검사한 로컬 경로: ${checked}개 (기존 문제 허용: ${allow.length}개)`);
if (newBroken.length) {
    console.error(`[check_paths] ❌ 신규 끊어진 경로 ${newBroken.length}개:`);
    newBroken.forEach((b) => console.error('  - ' + b));
    process.exit(1);
}
console.log('[check_paths] ✅ 통과 — 신규로 끊어진 경로 없음');
