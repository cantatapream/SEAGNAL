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

    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
