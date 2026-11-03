/**
 * test_kakao_relay_admin_ui.js — 관리자 「카톡 중계」 탭(client/js/admin/admin_kakao_relay.js)이 서버 기록을 사람이 읽게 그리는지 고정한다.
 *
 * [왜 있나] 사용자 확정 2026-11-03: 옛 「특보 예측」 자리에 카톡 중계 탭(기기별 신호·끄기/지우기, MMIS 대조 기록, 받은 특보).
 * [무엇을 보나] 브라우저 없이(vm) 가짜 fetch·컨테이너로 그려 본다 — 기기 카드·늦은 신호 경고·버튼, 대조 기록 문장,
 *   받은 글의 줄 표시(새 특보·놓친 글·이미 봄·모르는 구역·태풍=MMIS), 불러오기 실패를 숨기지 않음, 기기 버튼이 API 를 부름.
 * [실행] node local_server/scripts/test_kakao_relay_admin_ui.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES / → client/js/admin/admin_kakao_relay.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + String(x).slice(0, 300) : '')); } };
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'admin', 'admin_kakao_relay.js'), 'utf8');

function load(fetchImpl) {
    const calls = [];
    const win = { confirm: () => true, alert: () => {} };
    const ctx = { window: win, Date, JSON, Math, Number, String, Object, Array, encodeURIComponent,
        fetch: async (u, o) => { calls.push([u, o]); return fetchImpl(u, o); } };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    return { win, calls };
}
const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const DATA = {
    devices: {
        tablet: { state: 'on', beat: { at: iso(5 * 60e3), note: 'ok | 마지막 읽기: 없음', battery: 81 } },
        phone: { state: 'on', beat: { at: iso(2 * 3600e3), note: 'ok', battery: 40 }, lastMessageAt: iso(3 * 3600e3) },
        old: { state: 'removed' },
    },
    pending: [{ zone: '제주도동부앞바다', kind: '풍랑주의보', action: '연장', at: '2026-10-26T11:00+09:00', receivedAt: iso(12 * 60e3), status: 'alerted' }],
    checks: [{ at: iso(2 * 60e3), kind: 'mismatch', title: '⚠ 카톡 특보가 앱 특보현황에 10분째 반영 안 됨 (1곳)', body: '• 제주도동부앞바다 풍랑주의보 「연장」\n→ 통보문 확인' }],
    messages: [{
        receivedAt: iso(60e3), device: 'phone', source: 'screen', trigger: true,
        warnings: [
            { zone: '남해동부바깥먼바다', parent: null, zoneKnown: true, kind: '풍랑주의보', at: '2026-11-03T03:00+09:00', action: '해제', rawAction: '해제' },
            { zone: '제주도서부앞바다중북서연안바다', parent: '제주도서부앞바다', zoneKnown: true, kind: '풍랑주의보', at: '2026-11-03T03:00+09:00', action: '해제', rawAction: '해제' },
            { zone: '서해남부먼바다', zoneKnown: false, kind: '풍랑주의보', at: '2026-11-03T03:00+09:00', action: '해제', rawAction: '해제' },
            { zone: '남해동부바깥먼바다', zoneKnown: true, kind: '태풍경보', at: '2026-11-03T03:00+09:00', action: '발효', rawAction: '발효', mmisOnly: true },
        ],
        newWarnings: [{ zone: '남해동부바깥먼바다', kind: '풍랑주의보', at: '2026-11-03T03:00+09:00', action: '해제' }],
        missedWarnings: [],
    }, { receivedAt: iso(2 * 60e3), device: 'phone', source: 'screen', trigger: false, warnings: [
        { zone: '동해중부안쪽먼바다', zoneKnown: true, kind: '풍랑주의보', at: '2026-11-02T19:00+09:00', action: '발효', rawAction: '발효' }],
        newWarnings: [], missedWarnings: [{ zone: '동해중부안쪽먼바다', kind: '풍랑주의보', at: '2026-11-02T19:00+09:00', action: '발효' }] }],
};

(async () => {
    console.log('A. 그리기');
    const { win, calls } = load(async (u) => ({ ok: true, json: async () => DATA }));
    const c = { innerHTML: '' };
    await win.renderKakaoRelayAdminTab(c);
    const h = c.innerHTML;
    ok('관리자 토큰 래퍼가 붙는 /api/admin 경로로 부름', calls[0][0].startsWith('/api/admin/kakao-relay'));
    ok('기기 카드: 켜진 기기 둘·지운 기기는 아래 「다시 받기」', /<b style="color:#e6edf3">tablet<\/b>/.test(h) && /<b style="color:#e6edf3">phone<\/b>/.test(h) && /지운 기기: old/.test(h));
    ok('70분 넘은 신호는 경고(휴대폰)', /70분 넘게 없음/.test(h) && (h.match(/70분 넘게 없음/g) || []).length === 1);
    ok('배터리·상태 메모·마지막 글', /81%/.test(h) && /마지막 읽기: 없음/.test(h) && /마지막으로 글 받음/.test(h));
    ok('대조: 대기 중 줄·알림 보냄 표시·보낸 알림 문장', /반영 안 됨 알림 보냄/.test(h) && /10분째 반영 안 됨/.test(h) && /통보문 확인/.test(h));
    ok('받은 글: 이번 알림/직전 글 구분', /이번 알림/.test(h) && /함께 읽힌 직전 글/.test(h));
    ok('줄 표시: 새 특보·이미 봄·모르는 구역·태풍=MMIS·놓친 글', /새 특보/.test(h) && /이미 봄/.test(h) && /모르는 구역/.test(h) && /태풍=MMIS 기준/.test(h) && /놓친 글/.test(h));
    ok('자식 구역은 부모를 함께 보임', /\(제주도서부앞바다\)/.test(h));
    ok('글자 안전(HTML 안 섞임)', !/<script/i.test(h));

    ok('중계 기기: 한 줄에 2개(격자)·접힌 아코디언(제목에 이름)', /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(h) && /<details[^>]*>\s*<summary[^>]*>[^]*?<b style="color:#e6edf3">tablet<\/b>/.test(h) && !/<details open/.test(h));
    ok('신호 끊긴 기기는 접혀 있어도 ⚠ 표시(휴대폰만)', (h.match(/⚠ 신호 확인/g) || []).length === 1);
    // 자정 무렵이면 두 날로 갈릴 수 있어(글이 1~2분 전) 건수 합으로 본다 — 시각 의존 검사 금지.
    ok('받은 특보 글: 날짜별 접힌 아코디언·건수', (h.match(/📅 \d{2}\/\d{2} <span[^>]*>\((\d+)건\)/g) || []).reduce((a, x) => a + +/\((\d+)건/.exec(x)[1], 0) === 2);
    console.log('B. 실패를 숨기지 않음');
    const bad = load(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const c2 = { innerHTML: '' };
    await bad.win.renderKakaoRelayAdminTab(c2);
    ok('불러오기 실패면 그 사실을 보여 줌', /불러오지 못했습니다 — HTTP 401/.test(c2.innerHTML), c2.innerHTML);

    console.log('C. 기기 버튼');
    await win.__krDevice('phone', 'remove');
    const post = calls.find((x) => x[0] === '/api/admin/kakao-relay/device');
    ok('지우기 → POST device·action', post && JSON.parse(post[1].body).action === 'remove' && JSON.parse(post[1].body).device === 'phone', post && post[1].body);
    ok('누른 뒤 다시 그림', calls.filter((x) => x[0].startsWith('/api/admin/kakao-relay?')).length === 2);

    console.log('D. 버튼 줄·비교현황 창(2026-11-03 「[비교현황] [새로고침] (여기에 명시)」·「시간대별로 비교」)');
    const iB = h.indexOf('비교현황'), iR = h.indexOf('새로고침'), iT = h.indexOf('특보 알림톡을 중계 앱이');
    ok('버튼 순서 비교현황 → 새로고침, 설명은 버튼 아래', iB > 0 && iB < iR && iR < iT, [iB, iR, iT]);
    ok('버튼 줄 왼쪽 정렬', /justify-content:flex-start[^>]*>[^]*?비교현황/.test(h));
    // 작은 가짜 document — 창(div)을 만들고 지우는 것만 흉내 낸다.
    const els = {};
    const doc = { body: { appendChild: (e) => { els[e.id] = e; } }, getElementById: (id) => els[id] || null,
        createElement: () => { const e = { style: {}, addEventListener() {}, remove() { delete els[e.id]; } }; return e; }, addEventListener() {} };
    const SUM = {
        day: '2026-11-03', today: '2026-11-03', waitMin: 10,
        days: [{ day: '2026-11-02', msgs: 1, lines: {}, diffMin: 0 }, { day: '2026-11-03', msgs: 3, newLines: 4, lines: { '일치': 2, '불일치': 1 }, diffMin: 15, missedLines: 1 }],
        totals: { msgs: 3, dups: 2, newLines: 4, missedLines: 1, lines: { '일치': 2, '불일치': 1 }, lagAvg: 3, diffMin: 15, waitMin: 5, mmisChanges: 2, mmisError: 0, devices: { tablet: 3 }, beats: { tablet: 40 } },
        hours: Array.from({ length: 24 }, (_, i) => ({ hour: i, msgs: i === 12 ? 2 : 0, applied: i === 12 ? 2 : 0, mmisChanges: 0, diffMin: i === 12 ? 15 : 0, waitMin: 0, lines: i === 12 ? { '일치': 2 } : {},
            diffZones: i === 12 ? { '동해남부북쪽바깥먼바다': { min: 15, diffs: ['cur'], kakao: '특보 없음', mmis: '풍랑주의보' } } : {} })),
        lines: [{ t: '2026-11-03T03:04:00Z', zone: '동해중부바깥먼바다', line: '동해중부바깥먼바다 풍랑주의보 「발효」 11/03 12:00', receivedAt: '2026-11-03T03:01:00Z', result: '일치', lagMin: 3 }],
        episodes: [{ zone: '동해남부북쪽바깥먼바다', start: '2026-11-03T03:10:00Z', end: '2026-11-03T03:31:00Z', min: 21, worst: 'diff', first: 'MMIS가 먼저 바뀜' }],
        events: [{ t: '2026-11-03T03:00:00Z', kind: 'baseline', note: '시작' }],
        current: { startedAt: '2026-11-03T03:00:00Z', at: new Date().toISOString(), match: 92, wait: 0, diff: 1, typhoon: 0, active: 2,
            rows: [{ zone: '동해남부북쪽바깥먼바다', status: 'diff', diffs: ['cur'], kakao: '특보 없음', mmis: '풍랑주의보', active: true }] },
    };
    const calls3 = [];
    const ctx3 = { window: { confirm: () => true, alert() {} }, document: doc, Date, JSON, Math, Number, String, Object, Array, encodeURIComponent, console,
        fetch: async (u) => { calls3.push(u); return { ok: true, json: async () => SUM }; } };
    vm.createContext(ctx3); vm.runInContext(SRC, ctx3);
    await ctx3.window.__krCompare('2026-11-03');
    const ov = els['kr-compare'];
    const ch = ov ? ov.innerHTML : '';
    ok('비교현황 → 관리자 API 에 날짜를 넘김', calls3[0] === '/api/admin/kakao-relay/compare?day=2026-11-03', calls3);
    ok('지금 상태: 차이 구역·양쪽 상태', /동해남부북쪽바깥먼바다/.test(ch) && /카톡판/.test(ch) && /앱\(MMIS\)/.test(ch) && /발효 등급/.test(ch));
    ok('합계: 일치·불일치·평균 카톡이 빠름·차이 시간', /카톡 줄 → 일치/.test(ch) && /카톡 줄 → 불일치/.test(ch) && /평균 카톡이 3분 빠름/.test(ch) && /15분/.test(ch));
    ok('시간대 24줄·12시 펼치면 차이 구역과 줄 결과', (ch.match(/id="kr-hour-/g) || []).length === 24 && /10분 넘게 다른 구역/.test(ch) && /카톡이 3분 빠름/.test(ch));
    ok('날짜 고르기·날짜별 추세', /window.__krCompare\('2026-11-02'\)/.test(ch) && /날짜별 추세/.test(ch));
    ok('뜻 풀이(같음·반영 대기·차이·태풍)', /정상 시간차/.test(ch) && /확인 필요/.test(ch) && /태풍 발효를 보내지 않음/.test(ch));
    ok('보고서 내려받기 버튼 둘(이 날·시험 전체)', /이 날 보고서 내려받기\(\.md\)/.test(ch) && /window.__krReport\('2026-11-03'\)/.test(ch) && /window.__krReport\('all'\)/.test(ch));
    let clicked = null;
    doc.createElement = () => { const e = { style: {}, addEventListener() {}, click() { clicked = e.download; }, remove() {} }; return e; };
    ctx3.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
    ctx3.setTimeout = () => {};
    ctx3.fetch = async (u) => { calls3.push(u); return { ok: true, blob: async () => ({}) }; };
    await ctx3.window.__krReport('all');
    ok('내려받기 → 관리자 API·파일 이름', calls3.includes('/api/admin/kakao-relay/report.md?day=all') && clicked === 'kakao_relay_report_all.md', [calls3, clicked]);
    ctx3.window.__krCompareClose();
    ok('닫기', !els['kr-compare']);
    const ctx4 = { window: {}, document: doc, Date, JSON, Math, Number, String, Object, Array, encodeURIComponent, console, fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) };
    vm.createContext(ctx4); vm.runInContext(SRC, ctx4);
    await ctx4.window.__krCompare();
    ok('비교현황 못 불러오면 그 사실을 보여 줌', /불러오지 못했습니다 — HTTP 500/.test(els['kr-compare'].innerHTML));

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
