/**
 * ============================================================================
 * 파일명: local_server/scripts/test_usage_keys.js
 * 역할  : 사용량 통계 회귀 검사 — ①앱이 세는 모든 기능 키에 한글 이름표가 있는가
 *         ②"프로그램 클릭 동안 세지 않기"(withUsageSuppressed)가 실제로 동작하는가.
 *         새 버튼에 trackUsage 를 달고 이름표를 빼먹으면 여기서 잡힌다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : client/js/shared/utils/usage_keys.js(이름표) · client/js/shared/utils/utils.js
 *                    (trackUsage/withUsageSuppressed 를 가짜 브라우저 환경에 올려 검사)
 *  - 서버 API      : 없음
 *  - 마크업        : client/index2.html (배경지도 data-basemap 값 → 'ocean.basemap.*' 키)
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh 의 SUITES
 * [로드 순서] 해당 없음(단독 실행: node local_server/scripts/test_usage_keys.js)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const LABELS = require(path.join(ROOT, 'client/js/shared/utils/usage_keys.js'));

let pass = 0, fail = 0;
function check(ok, msg) {
    if (ok) { pass++; console.log('  ✅ ' + msg); }
    else { fail++; console.log('  ❌ ' + msg); }
}

/** client/js 아래 .js 파일 목록(관리자 화면은 세는 쪽이 아니라 보여주는 쪽이라 제외). */
function listClientJs(dir, out) {
    fs.readdirSync(dir).forEach(name => {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) { if (name !== 'admin') listClientJs(p, out); }
        else if (name.endsWith('.js') && name !== 'usage_keys.js') out.push(p);   // 이름표 자신은 발신처가 아니다
    });
    return out;
}

// ── ① 발신 키 ⊂ 이름표 ──────────────────────────────────────────────
// trackUsage 를 부르는 파일 안의 '접두어.키' 꼴 문자열 리터럴을 전부 모은다.
//   (오버레이·천기 레이어처럼 변수로 넘기는 키도 결국 같은 파일 안에 리터럴로 있다)
const KEY_RE = /'((?:main|buoy|chart|ocean|shrt|sheet|life|safety)\.[A-Za-z0-9_.가-힣]+)'/g;
const emitted = new Map(); // key -> 첫 발견 파일
listClientJs(path.join(ROOT, 'client/js'), []).forEach(f => {
    const src = fs.readFileSync(f, 'utf8');
    if (src.indexOf('trackUsage') === -1) return;
    let m;
    while ((m = KEY_RE.exec(src))) {
        if (m[1].endsWith('.')) continue;                 // 'ocean.basemap.' + bm 같은 접두어
        if (!emitted.has(m[1])) emitted.set(m[1], path.relative(ROOT, f));
    }
});
// 배경지도 키는 index2.html 의 data-basemap 값에서 동적으로 만들어진다.
const html = fs.readFileSync(path.join(ROOT, 'client/index2.html'), 'utf8');
new Set(html.match(/data-basemap="([a-z]+)"/g).map(s => s.match(/"([a-z]+)"/)[1]))
    .forEach(bm => emitted.set('ocean.basemap.' + bm, 'client/index2.html'));

console.log('① 발신 키 ' + emitted.size + '개 — 이름표 ' + Object.keys(LABELS).length + '개');
check(emitted.size >= 50, '발신 키를 50개 이상 찾았다(수집 자체가 깨지지 않았다)');
emitted.forEach((file, key) => {
    check(typeof LABELS[key] === 'string' && LABELS[key].trim() !== '',
        '이름표 있음: ' + key + '  (' + file + ')');
});

// ── 사용자 확정 규칙(2026-09-10)의 키가 실제로 발신되는가 ──
[
    'safety.mudflat', 'safety.terrain', 'safety.terrain.marker',
    'ocean.accident_info', 'safety.accident.zone', 'safety.accident.marker',
    'safety.ban_zone', 'safety.ban_zone.area',
    'safety.navwarn', 'safety.navwarn.date', 'safety.navwarn.zone',
    'safety.vts', 'safety.vts.zone', 'safety.seaway', 'safety.seaway.zone', 'ocean.cctv_open'
].forEach(k => check(emitted.has(k), '해양안전 집계 키 발신처 있음: ' + k));

// ── ② withUsageSuppressed 동작 — utils.js 를 가짜 브라우저에 올려 실제로 호출 ──
const sent = [];
const noop = () => {};
const fakeEl = { addEventListener: noop, classList: { add: noop, remove: noop, contains: () => false },
    style: {}, value: '', innerHTML: '', appendChild: noop, querySelector: () => null, querySelectorAll: () => [] };
const win = {
    localStorage: { getItem: () => 'test-device', setItem: noop },
    fetch: (url, opts) => { sent.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true }); },
    document: { createElement: () => Object.assign({}, fakeEl, { set innerHTML(v) { this._v = v; }, get value() { return this._v || ''; } }),
        getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        addEventListener: noop, body: fakeEl, documentElement: fakeEl },
    addEventListener: noop, setTimeout, clearTimeout, console, CONFIG: { API_BASE: '' },
    navigator: { userAgent: 'test' }, location: { href: '' }
};
win.window = win;
vm.createContext(win);
try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'client/js/shared/utils/utils.js'), 'utf8'), win, { filename: 'utils.js' });
    check(typeof win.trackUsage === 'function' && typeof win.withUsageSuppressed === 'function',
        'utils.js 가 trackUsage / withUsageSuppressed 를 정의한다');
    win.trackUsage('safety.vts');
    check(sent.length === 1 && sent[0].feature === 'safety.vts', '일반 호출은 1건 보낸다');
    win.withUsageSuppressed(() => { win.trackUsage('ocean.wind'); win.trackUsageMany(['ocean.wave', 'ocean.current']); });
    check(sent.length === 1, '억제 구간 안의 호출(단건·다건)은 보내지 않는다');
    win.withUsageSuppressed(() => { win.withUsageSuppressed(() => {}); win.trackUsage('ocean.wind'); });
    check(sent.length === 1, '억제 구간이 겹쳐도(중첩) 안쪽이 끝난 뒤 바깥은 계속 억제된다');
    win.trackUsage('ocean.wind');
    check(sent.length === 2, '억제 구간이 끝나면 다시 센다');
} catch (e) {
    check(false, 'utils.js 가짜 브라우저 로드 실패: ' + (e && e.message));
}

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
