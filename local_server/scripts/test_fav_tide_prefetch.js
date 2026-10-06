/**
 * test_fav_tide_prefetch.js — 즐겨찾기 조석 미리받기(OS.prefetchFavoriteTides)를 고정한다.
 *
 * [왜 있나] 2026-10-06 사용자 요청: 즐겨찾기 칩을 눌러도 조석을 그 자리에서 다시 받아
 *   3~5초 이상 기다리는 일이 있었다. 앱 시작·복귀 때 즐겨찾기 해점의 오늘 조석을 미리 받아
 *   영속 캐시(tideCache:v1)에 넣고, 시트가 열릴 때 캐시 hit 하도록 했다. 이 기능은 화면에
 *   아무것도 안 보이므로 깨져도 "조금 느리다" 로만 드러난다 → 여기서 고정한다.
 *
 * [무엇을 고정하나]
 *   ① 미리받기 결과가 시트 경로(fetchTideForSheet)에서 실제로 캐시 hit 되는가(네트워크 0회).
 *   ② 'complete-quick'(임시) 은 저장하지 않고 final 만 저장하는가.
 *   ③ 오늘치가 이미 있으면 받지 않는가 · 동시에 두 번 불려도 한 번만 받는가.
 *   ④ 받는 사이 즐겨찾기가 해제되면 버리는가 · 한 해점 실패가 다음 해점을 막지 않는가.
 *   ⑤ 동해북부 좌표는 시트와 같은 IDW 경로를 쓰는가 · 이미 저장된 날은 덮어쓰지 않는가.
 *   ⑥ 배선 — load·visibilitychange 리스너, 칩 클릭이 즐겨찾기 좌표 그대로 시트를 여는가,
 *      verify_all.sh 등록.
 *
 * [실행] node local_server/scripts/test_fav_tide_prefetch.js   (네트워크 안 씀 — fetch 를 가짜로 끼운다)
 * [연계] ← scripts/refactor/verify_all.sh SUITES
 *        → client/js/ocean-map/bottom-sheet/ocean_bottom_sheet3.js
 *        → client/js/ocean-map/cctv/ocean_cctv.js (칩 클릭 → showOceanBottomSheet)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SHEET3 = path.join(ROOT, 'client', 'js', 'ocean-map', 'bottom-sheet', 'ocean_bottom_sheet3.js');
const SHEET3_SRC = fs.readFileSync(SHEET3, 'utf8');
const CCTV_SRC = fs.readFileSync(path.join(ROOT, 'client', 'js', 'ocean-map', 'cctv', 'ocean_cctv.js'), 'utf8');
const VERIFY_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'refactor', 'verify_all.sh'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

/**
 * sheet3 를 가짜 브라우저 안에 띄운다.
 * @param {Object} opt
 *   favs     : [{lat, lon}] 즐겨찾기 목록 (배열을 그대로 참조 — 도중에 지우면 해제와 같다)
 *   statusSeq: { today: [...], yesterday: [...], tomorrow: [...] } /data 응답 상태를 회차별로
 *   postResp : (body) => 응답 객체 (기본: 성공·파일 3개)
 *   onPoll   : 폴링 1회마다 부르는 훅
 */
function boot(opt) {
    const store = {};
    const calls = { post: [], data: [], listeners: {}, docListeners: {} };
    const pollCount = {};
    const favs = opt.favs;
    const near = (a, b) => Math.abs(a.lat - b.lat) < 0.005 && Math.abs(a.lon - b.lon) < 0.005;

    const fetchStub = (url, init) => {
        if (url === '/api/save_tide_input') {
            const body = JSON.parse(init.body);
            calls.post.push(body);
            const tag = body.lat + '_' + body.lon;
            const resp = opt.postResp ? opt.postResp(body) : {
                success: true, gridHash: 'G' + tag,
                files: { yesterday: 'y_' + tag + '.json', today: 't_' + tag + '.json', tomorrow: 'n_' + tag + '.json' }
            };
            return Promise.resolve({ json: () => Promise.resolve(resp) });
        }
        if (url.indexOf('/data/') === 0) {
            const fname = url.slice(6);
            calls.data.push(fname);
            if (opt.onPoll) opt.onPoll(fname);
            const kind = fname[0] === 'y' ? 'yesterday' : fname[0] === 't' ? 'today' : 'tomorrow';
            const n = pollCount[fname] = (pollCount[fname] || 0) + 1;
            const seqAll = (opt.statusSeqFor && opt.statusSeqFor(fname)) || opt.statusSeq || {};
            const seq = seqAll[kind] || ['complete'];
            const st = seq[Math.min(n - 1, seq.length - 1)];
            return Promise.resolve({ json: () => Promise.resolve({ tideBedStatus: st, file: fname, highTide1: '0101' }) });
        }
        return Promise.reject(new Error('unexpected ' + url));
    };

    const OS = { state: {}, formatDateInt: d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() };
    const win = {
        OceanSheet: OS,
        oceanFav: {
            locationGetAll: () => favs.slice(),
            locationFindNear: (lat, lon) => favs.find(f => near(f, { lat, lon })) || null
        },
        addEventListener: (ev, fn) => { (calls.listeners[ev] = calls.listeners[ev] || []).push(fn); }
    };
    const doc = {
        visibilityState: 'visible',
        addEventListener: (ev, fn) => { (calls.docListeners[ev] = calls.docListeners[ev] || []).push(fn); },
        getElementById: () => null
    };
    const ctx = {
        window: win, document: doc, console,
        localStorage: {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; }
        },
        fetch: fetchStub,
        setTimeout: (fn) => setImmediate(fn),   // 폴링 간격을 0 으로 — 시험을 빨리
        clearTimeout: () => {},
        Promise, Date, Math, JSON, Object, String, Array, parseInt, parseFloat, isNaN
    };
    vm.createContext(ctx);
    vm.runInContext(SHEET3_SRC, ctx, { filename: 'ocean_bottom_sheet3.js' });
    const persist = () => JSON.parse(store['tideCache:v1'] || '{}');
    return { OS, calls, store, persist, win, doc };
}

function dayKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function shift(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function pk(lat, lon) { return (Math.round(lat * 1e5) / 1e5) + '_' + (Math.round(lon * 1e5) / 1e5); }

(async function main() {
    // 날짜는 "실행한 날" 기준으로만 비교한다(시각에 따라 결과가 바뀌는 가정 없음).
    const now = new Date();
    const T = dayKey(now), Y = dayKey(shift(now, -1)), N = dayKey(shift(now, 1));
    const BUSAN = { lat: 35.07512, lon: 129.08345 };   // 남해 — KHOA 경로
    const MOKPO = { lat: 34.78123, lon: 126.38456 };

    // ── [1] 미리받기 → 시트 경로 캐시 hit ────────────────────────────────────
    console.log('\n[1] 미리받기 결과가 시트를 열 때 그대로 쓰이는가');
    {
        const b = boot({ favs: [BUSAN], statusSeq: { today: ['collecting', 'complete-quick', 'complete'] } });
        await b.OS.prefetchFavoriteTides();
        const pt = b.persist()[pk(BUSAN.lat, BUSAN.lon)];
        ok('POST 는 1회', b.calls.post.length === 1, 'post=' + b.calls.post.length);
        ok('시트와 같은 5소수점 좌표·오늘 날짜로 요청',
            b.calls.post[0].lat === BUSAN.lat && b.calls.post[0].date === b.OS.formatDateInt(now));
        ok('deviceId 를 보내지 않는다(시트와 같다 — 서버 일일 15회 제한에 안 걸린다)',
            !('deviceId' in b.calls.post[0]));
        ok('영속 캐시에 오늘·어제·내일이 다 들어갔다', !!(pt && pt.days[T] && pt.days[Y] && pt.days[N]),
            pt ? Object.keys(pt.days).join(',') : '없음');
        ok('오늘 항목은 final(complete) 이다 — complete-quick 이 저장되지 않았다',
            pt && pt.days[T].data.tideBedStatus === 'complete');
        ok('오늘 항목에 어제·내일 이웃이 같이 들어갔다(게이지·교차일 피크용)',
            pt && pt.days[T].neighbors && pt.days[T].neighbors.yesterday && pt.days[T].neighbors.tomorrow);
        ok('격자ID 도 영속 캐시에 남았다(다음 요청 KHOA 사전조회 절감)',
            !!b.store['gridHashCache:v1'] && b.store['gridHashCache:v1'].indexOf('G') >= 0);
        ok('화면용 메모리 캐시는 건드리지 않았다', !b.OS.state._tideMultiDayCache);

        // 시트가 열린 것처럼 fetchTideForSheet 호출 — 네트워크 없이 렌더돼야 한다
        const before = b.calls.post.length + b.calls.data.length;
        let rendered = null, loading = false;
        b.OS.renderTideData = (data, isIdw, d, nb) => { rendered = { data, isIdw, nb }; };
        b.OS.renderTideLoading = () => { loading = true; };
        b.OS.fetchTideForSheet(BUSAN.lat, BUSAN.lon, new Date());
        ok('시트를 열면 캐시 hit — 네트워크 0회', b.calls.post.length + b.calls.data.length === before);
        ok('로딩 화면("3~5초 소요")이 뜨지 않는다', !loading);
        ok('미리 받은 오늘 데이터로 바로 렌더', rendered && rendered.data.tideBedStatus === 'complete'
            && rendered.nb.yesterday && rendered.nb.tomorrow);
    }

    // ── [2] 중복 방지 ───────────────────────────────────────────────────────
    console.log('\n[2] 이미 있으면 안 받는다 · 동시에 두 번 불려도 한 번');
    {
        const b = boot({ favs: [BUSAN] });
        await b.OS.prefetchFavoriteTides();
        const n1 = b.calls.post.length;
        await b.OS.prefetchFavoriteTides();
        ok('오늘치가 있으면 다시 부를 때 POST 0회', b.calls.post.length === n1, 'post=' + b.calls.post.length);

        const b2 = boot({ favs: [BUSAN] });
        await Promise.all([b2.OS.prefetchFavoriteTides(), b2.OS.prefetchFavoriteTides()]);
        ok('진행 중에 또 불리면(앱 복귀 반복) 무시 — POST 1회', b2.calls.post.length === 1, 'post=' + b2.calls.post.length);

        const b3 = boot({ favs: [] });
        await b3.OS.prefetchFavoriteTides();
        ok('즐겨찾기가 없으면 아무것도 안 받는다', b3.calls.post.length === 0);
    }

    // ── [3] 대기 중 상태 변화 ─────────────────────────────────────────────────
    console.log('\n[3] 받는 사이 즐겨찾기 해제 · 실패 격리');
    {
        const favs = [BUSAN];
        const b = boot({ favs, onPoll: () => { favs.length = 0; } });   // 첫 폴링 때 해제
        await b.OS.prefetchFavoriteTides();
        ok('받는 사이 해제된 해점은 저장하지 않는다', !b.persist()[pk(BUSAN.lat, BUSAN.lon)]);

        const b2 = boot({
            favs: [BUSAN, MOKPO],
            statusSeqFor: f => (f.indexOf(String(BUSAN.lat)) >= 0 ? { today: ['error'] } : null)
        });
        await b2.OS.prefetchFavoriteTides();
        ok('오늘이 error 인 해점은 저장 안 함', !b2.persist()[pk(BUSAN.lat, BUSAN.lon)]);
        ok('앞 해점이 실패해도 다음 해점은 받는다', !!(b2.persist()[pk(MOKPO.lat, MOKPO.lon)] || {}).days);
        ok('해점은 차례로 — POST 2회', b2.calls.post.length === 2);

        const b3 = boot({ favs: [BUSAN], postResp: () => ({ success: false, error: 'Grid hash unavailable' }) });
        await b3.OS.prefetchFavoriteTides();
        ok('격자 밖(서버 실패)이면 조용히 끝나고 저장 없음', !b3.persist()[pk(BUSAN.lat, BUSAN.lon)]);
        await b3.OS.prefetchFavoriteTides();
        ok('실패한 뒤에도 다음 호출은 다시 시도한다(진행 중 플래그가 풀렸다)', b3.calls.post.length === 2);

        const b4 = boot({ favs: [BUSAN], statusSeq: { today: ['complete-quick'] } });
        await b4.OS.prefetchFavoriteTides();
        ok('끝까지 complete-quick 이면(시간초과) 저장하지 않는다 — 시트가 열 때 받는다',
            !b4.persist()[pk(BUSAN.lat, BUSAN.lon)]);
    }

    // ── [4] 동해북부·덮어쓰기 ─────────────────────────────────────────────────
    console.log('\n[4] 동해북부 IDW 경로 · 이미 저장된 날은 안 덮는다');
    {
        const SOKCHO = { lat: 38.2, lon: 128.6 };
        const b = boot({ favs: [SOKCHO] });
        let idwCalled = 0;
        b.OS.tryEastSeaIdw = (lat, lon, d, cb) => {
            idwCalled++;
            cb({ yesterday: { s: 'y' }, today: { s: 't' }, tomorrow: { s: 'n' } }, null);
        };
        await b.OS.prefetchFavoriteTides();
        const pt = b.persist()[pk(SOKCHO.lat, SOKCHO.lon)];
        ok('동해북부는 OS.tryEastSeaIdw 를 쓰고 서버 POST 없음', idwCalled === 1 && b.calls.post.length === 0);
        ok('IDW 결과는 isIdw=true 로 저장', pt && pt.days[T].isIdw === true && pt.days[N].isIdw === true);

        const b2 = boot({ favs: [BUSAN] });
        // 시트가 먼저 저장해 둔 어제 항목(표시용 결과)이 있는 상태
        b2.store['tideCache:v1'] = JSON.stringify({
            [pk(BUSAN.lat, BUSAN.lon)]: { days: { [Y]: { data: { mark: 'sheet' }, isIdw: false, neighbors: null } }, lastUsed: 1 }
        });
        await b2.OS.prefetchFavoriteTides();
        const pt2 = b2.persist()[pk(BUSAN.lat, BUSAN.lon)];
        ok('이미 있는 날(어제)은 덮어쓰지 않는다', pt2.days[Y].data.mark === 'sheet');
        ok('없는 날(오늘)은 채운다', !!pt2.days[T]);
        ok('LRU 기준(lastUsed)은 미리받기가 바꾸지 않는다', pt2.lastUsed === 1);
    }

    // ── [5] 배선 ────────────────────────────────────────────────────────────
    console.log('\n[5] 배선 — 언제 불리고, 칩이 같은 좌표로 시트를 여는가');
    {
        const b = boot({ favs: [BUSAN] });
        ok('window load 리스너 등록(앱 시작)', (b.calls.listeners.load || []).length === 1);
        ok('visibilitychange 리스너 등록(앱 복귀)', (b.calls.docListeners.visibilitychange || []).length === 1);
        b.calls.docListeners.visibilitychange[0]();
        await new Promise(r => setTimeout(r, 50));
        ok('앱 복귀(visible) 시 실제로 미리받기가 돈다', b.calls.post.length === 1);

        // 영속 캐시 키는 좌표 정확일치(5소수점). 칩이 즐겨찾기 좌표 그대로 시트를 열어야 hit 한다.
        ok('칩 클릭이 즐겨찾기 좌표 그대로 시트를 연다(loc.lat, loc.lon)',
            /window\.showOceanBottomSheet\(loc\.lat,\s*loc\.lon\)/.test(CCTV_SRC));
        ok('ocean_cctv.js 가 locationGetAll 을 내보낸다',
            /locationGetAll:\s*function/.test(CCTV_SRC));
        ok('verify_all.sh SUITES 에 등록', /\btest_fav_tide_prefetch\b/.test(VERIFY_SRC));
    }

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();
