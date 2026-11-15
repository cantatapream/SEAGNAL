/**
 * MMIS ↔ 통보문 비교 기록(services/bulletin_compare) · 메인 출처 전환 버튼(client/js/forecast/alerts/alert_source_toggle.js) 검사.
 * 실행: node local_server/scripts/test_bulletin_compare.js
 * 사용자 확정 2026-11-15: 「MMIS는 … 몇 분 몇 초에 어떠한 그 푸시 알림이 나갔는데, 통보문을 했을 때는 몇 분 몇 초에 어떠한 내용의 푸시 알림이 나갔을 거다」 비교 문서 ·
 *   가상 푸시엔 MMIS 디바운스 없음 · 메인 「기상정보」 옆 [MMIS][통보문]은 관리자만, 기본 MMIS, 바뀌는 범위는 메인 목록만.
 * 시각은 고정값만 쓴다.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const C = require('../services/bulletin_compare');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };
const T0 = Date.parse('2026-11-16T03:00:00Z');
const Z = (kind, level, extra) => Object.assign({ parent: '제주도남쪽바깥먼바다', kind, type: '풍랑', level, tmFc: '2026년 11월 16일 12시 00분', tmEf: kind === 'yebi' ? '2026년 11월 16일 오후(12시~18시)' : '2026년 11월 16일 13시 00분', clr: '' }, extra);

console.log('A. MMIS 나무 펼치기 · 가상 푸시 종류');
{
    const tree = { 제주도: { 제주도먼바다: { 제주도남쪽바깥먼바다: { current: null, upcoming: { wrnTpNm: '풍랑', wrnLvlNm: '예비', tmEf: '2026년 11월 16일 오후(12시~18시)' }, history: [], children: {} } },
        제주도앞바다: { 제주도서부앞바다: { current: { wrnTpNm: '풍랑', wrnLvlNm: '주의보', clrNtcTm: '17일 오전' }, upcoming: null, history: [], children: { 제주도서부앞바다중북서연안바다: { wrnTpNm: '풍랑', wrnLvlNm: '주의보' }, 제주도서부앞바다중남서연안바다: null } } } } };
    const f = C.flattenTree(tree);
    ok('예비 = yebi, 정식 = formal, 자식도(빈 자식은 없음)', f['제주도남쪽바깥먼바다'].kind === 'yebi' && f['제주도서부앞바다'].kind === 'formal' && f['제주도서부앞바다'].clr === '17일 오전' && f['제주도서부앞바다중북서연안바다'] && !f['제주도서부앞바다중남서연안바다']);
    const t = (b, a, pn) => (C.templateOf('제주도남쪽바깥먼바다', b, a, pn) || {}).templateId;
    ok('없음→예비 publish · 예비→정식 active · 정식→없음 release · 예비→없음 prelim_cancel', t(null, Z('yebi', '예비')) === 'publish' && t(Z('yebi', '예비'), Z('formal', '주의보')) === 'active' && t(Z('formal', '주의보'), null) === 'release' && t(Z('yebi', '예비'), null) === 'prelim_cancel');
    ok('주의보→경보 level_upgrade_active · 해제 예고만 바뀜 time_yn_change · 예비 시간창만 바뀜 time_ef_change', t(Z('formal', '주의보'), Z('formal', '경보')) === 'level_upgrade_active' && t(Z('formal', '주의보'), Z('formal', '주의보', { clr: '17일' })) === 'time_yn_change' && t(Z('yebi', '예비'), Z('yebi', '예비', { tmEf: 'x' })) === 'time_ef_change');
    const kid = (b, a) => (C.templateOf('제주도서부앞바다중북서연안바다', b && Object.assign({}, b, { parent: '제주도서부앞바다' }), a && Object.assign({}, a, { parent: '제주도서부앞바다' }), Z('formal', '주의보', { parent: '제주도서부앞바다' })) || {}).templateId;
    ok('부모가 정식 중인 자식: 추가 = additional_active, 빠짐 = partial_release', kid(null, Z('formal', '주의보')) === 'additional_active' && kid(Z('formal', '주의보'), null) === 'partial_release');
    ok('바뀐 게 없으면 null', C.templateOf('x', Z('formal', '주의보'), Z('formal', '주의보'), null) === null);
}

console.log('A2. 발표(발효 전) · 표기 차이');
{
    const mt = { 동해: { 동해중부해상: { 강원북부앞바다: { current: null, upcoming: { wrnTpNm: '풍랑', wrnLvlNm: '예비', tmEf: '2026년 11월 16일 04시 30분' }, history: [], children: {} } } } };
    const f = C.flattenTree(mt);
    ok('MMIS 「예비 + 정확한 시각」 = 발표(발효 전)', f['강원북부앞바다'].kind === 'pending');
    const now = Date.parse('2026-11-16T01:40:00+09:00');
    const raw = { 강원북부앞바다: { parent: '강원북부앞바다', kind: 'formal', type: '풍랑', level: '주의보', tmEf: '2026년 11월 16일 04시 30분', efMs: Date.parse('2026-11-16T04:30:00+09:00'), clr: '17일 새벽(03시~06시)' } };
    const b = C.pendingOf(raw, now);
    ok('통보문 「주의보, 발효 시각 아직」 = 발표(발효 전) → MMIS 와 같은 상태로 셈', b['강원북부앞바다'].kind === 'pending' && C.sig(b['강원북부앞바다']) === C.sig(f['강원북부앞바다']));
    ok('발효 시각이 지나면 정식', C.pendingOf(raw, Date.parse('2026-11-16T04:31:00+09:00'))['강원북부앞바다'].kind === 'formal');
    const P = { parent: 'x', kind: 'pending', type: '풍랑', level: '주의보', tmEf: '04시 30분' }, F = Object.assign({}, P, { kind: 'formal' });
    ok('가상 푸시 두 걸음: 나타나면 publish(📢 발표) → 발효 시각에 active(🚨 발효)', C.templateOf('x', null, P).templateId === 'publish' && C.templateOf('x', P, F).templateId === 'active' && C.templateOf('x', Z('yebi', '예비'), P).templateId === 'publish');
    ok('예비 시간창 이름만 다른 건 같음(아침=오전, 저녁 18~00시=밤 18~24시)', C.winKey('2026년 11월 16일 아침(06시~12시)') === C.winKey('2026년 11월 16일 오전(06시~12시)') && C.winKey('2026년 11월 16일 저녁(18시~00시)') === C.winKey('2026년 11월 16일 밤(18시~24시)'));
    ok('해제 예고도 시각으로', C.clrKey('17일 오전(09시~12시)') === C.clrKey('17일  오전(09시~12시)') && C.clrKey('17일 오전(09시~12시)') !== C.clrKey('17일 오후(12시~18시)'));
}

console.log('B. 매분 기록 — 처음·바뀜·두 쪽 다름·가상 푸시·실제 푸시');
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-'));
    let t = T0, B = {}, M = { current: {} }, pushes = [];
    const mtree = (lvl) => ({ 제주도: { 제주도먼바다: { 제주도남쪽바깥먼바다: { current: lvl === '주의보' ? { wrnTpNm: '풍랑', wrnLvlNm: '주의보' } : null, upcoming: lvl === '예비' ? { wrnTpNm: '풍랑', wrnLvlNm: '예비', tmEf: '2026년 11월 16일 오후(12시~18시)' } : null, history: [], children: {} } } } });
    const cmp = C.createCompare({ getBulletin: () => ({ zones: B }), getMmis: () => M.current, getPushes: () => pushes, now: () => t, dir });
    const ev = () => cmp.days().flatMap((d) => cmp.readDay(d));
    pushes = [{ id: T0 - 60e3, type: 'auto', title: '옛 푸시', content: '', target: 'x' }];
    cmp.run();
    ok('처음엔 기준만(바뀜·옛 푸시 안 셈)', ev().length === 1 && ev()[0].kind === 'baseline');
    t += 60e3; B = { 제주도남쪽바깥먼바다: Z('yebi', '예비') }; cmp.run();
    const e1 = ev();
    ok('통보문 쪽 바뀜 + 두 쪽 다름 시작 + 가상 푸시(publish, 실제와 같은 문구)', e1.some((e) => e.kind === 'change' && e.side === 'bulletin') && e1.some((e) => e.kind === 'mismatch_start') && e1.some((e) => e.kind === 'virtual_push' && e.title === '📢 풍랑 주의보 발표' && /발효예정/.test(e.content)));
    t += 5 * 60e3; M.current = mtree('예비'); pushes.push({ id: t + 1234, type: 'auto', title: '📢 풍랑 주의보 발표', content: 'ㅇ제주도남쪽바깥먼바다', target: '제주도남쪽바깥먼바다', count: 900 }); pushes.push({ id: t + 2000, type: 'manual', title: '수동', target: 'x' });
    cmp.run();
    const e2 = ev();
    ok('MMIS 쪽 바뀜 + 두 쪽 같아짐(5분 동안 달랐음)', e2.some((e) => e.kind === 'change' && e.side === 'mmis') && e2.some((e) => e.kind === 'mismatch_end' && e.minutes === 5));
    const mp = e2.filter((e) => e.kind === 'mmis_push');
    ok('실제 MMIS 푸시는 보낸 시각(초까지)으로, 자동 푸시만', mp.length === 1 && mp[0].at === new Date(t + 1234 + 9 * 3600e3).toISOString().replace('Z', '+09:00') && mp[0].count === 900);
    t += 60e3; cmp.run();
    ok('같은 푸시는 두 번 안 셈', ev().filter((e) => e.kind === 'mmis_push').length === 1);
    const md = C.reportMarkdown(ev(), 'all');
    ok('보고서: 푸시 짝(같은 해역 6시간 안) + 시간 차이(통보문이 5분 1초 빠름)', /\| 11-16 12:06 📢 풍랑 주의보 발표 — 제주도남쪽바깥먼바다 \| 11-16 12:01 📢 풍랑 주의보 발표 — 제주도남쪽바깥먼바다 \| 통보문이 5분 1초 빠름 \|/.test(md), md.split('## 푸시 짝')[1].slice(0, 400));
    ok('보고서: 요약·두 쪽이 달랐던 동안·시간순 설명·원본 부록', /짝이 맞은 것 1건/.test(md) && /제주도남쪽바깥먼바다: 5분/.test(md) && /## 시간순 기록/.test(md) && /```jsonl/.test(md));
    const cmp2 = C.createCompare({ getBulletin: () => null, getMmis: () => M.current, getPushes: () => [], now: () => t, dir });
    ok('통보문 기준이 아직 없으면 건너뜀', cmp2.run().skipped === true);
}

console.log('C. 메인 [MMIS][통보문] 버튼');
{
    const root = path.join(__dirname, '..', '..');
    const html = fs.readFileSync(path.join(root, 'client/index2.html'), 'utf8');
    const data = fs.readFileSync(path.join(root, 'client/js/forecast/alerts/data.js'), 'utf8');
    ok('「기상정보」 글자 오른쪽에 버튼 자리(기본 숨김)', /기상정보\s*\n\s*<!-- \[관리자만\][^\n]*\n\s*<span id="alert-source-toggle" style="display:none/.test(html) && /data-src="mmis"/.test(html) && /data-src="bulletin"/.test(html));
    ok('스크립트는 data.js 바로 다음', html.indexOf('js/forecast/alerts/alert_source_toggle.js') > html.indexOf('js/forecast/alerts/data.js'));
    ok('data.js 두 곳이 같은 출처 주소를 씀(평소 MMIS)', (data.match(/window\.__alertSourceUrl \|\| '\/api\/weather-alerts'/g) || []).length === 2);
    const mk = (admin, resp) => {
        const box = { style: {}, btns: [{ a: 'mmis', style: {} }, { a: 'bulletin', style: {} }], note: { textContent: '' } };
        box.querySelectorAll = () => box.btns.map((b) => ({ getAttribute: () => b.a, style: b.style }));
        box.querySelector = () => box.note;
        const calls = { flatten: [], render: 0, refresh: 0, alerts: [] };
        const sb = { window: {}, document: { readyState: 'complete', getElementById: () => box, addEventListener: () => {} }, localStorage: { getItem: () => (admin ? 'true' : null) }, console,
            fetch: async (u) => resp(u), flattenAlertsData: (d) => calls.flatten.push(d), renderApp: () => calls.render++, refreshAlertData: async () => calls.refresh++ };
        sb.window.alert = (m) => calls.alerts.push(m);
        vm.runInNewContext(fs.readFileSync(path.join(root, 'client/js/forecast/alerts/alert_source_toggle.js'), 'utf8'), sb);
        return { sb, box, calls };
    };
    const u = mk(false, async () => ({}));
    ok('일반 사용자에겐 안 보임', u.box.style.display === 'none');
    (async () => {
        const a = mk(true, async (u) => ({ ok: true, status: 200, json: async () => ({ updatedAt: '2026-11-16T03:00:00.000Z', current: { 동해: {} } }) }));
        ok('관리자에겐 보이고 MMIS 가 눌린 채 시작', a.box.style.display === 'inline-flex' && a.box.btns[0].style.fontWeight === '800');
        await a.sb.window.setAlertSource('bulletin');
        ok('[통보문]: 관리자 주소로 받아 같은 화면 코드로 그림 + 자동 새로고침도 그 주소', a.sb.window.__alertSourceUrl === '/api/admin/bulletin-status' && a.calls.flatten.length === 1 && a.calls.render === 1 && /통보문 기준 · 12:00 계산/.test(a.box.note.textContent));
        const z = mk(true, async () => ({ ok: true, status: 200, json: async () => ({ updatedAt: '2026-11-16T03:00:00.000Z', bulletins: 0, current: {} }) }));
        await z.sb.window.setAlertSource('bulletin');
        ok('쓴 통보문이 0건이면 경고(「특보 없음」과 구분)', /⚠ 통보문 0건/.test(z.box.note.textContent));
        const c = mk(true, async () => ({ ok: true, status: 200, json: async () => ({ updatedAt: '2026-11-16T03:00:00.000Z', bulletins: 12, current: {} }) }));
        await c.sb.window.setAlertSource('bulletin');
        ok('쓴 통보문 수 표시(「통보문 기준 · 12건 · 12:00 계산」)', /통보문 기준 · 12건 · 12:00 계산/.test(c.box.note.textContent));
        await a.sb.window.setAlertSource('mmis');
        ok('[MMIS]: 주소를 되돌리고 MMIS 로 다시 그림', a.sb.window.__alertSourceUrl === null && a.calls.refresh === 1 && a.calls.render === 2);
        const n = mk(true, async () => ({ ok: false, status: 401, json: async () => ({}) }));
        await n.sb.window.setAlertSource('bulletin');
        ok('관리자 로그인이 없으면(401) 안내만, 화면은 그대로', /관리자 로그인이 필요/.test(n.calls.alerts[0] || '') && n.calls.flatten.length === 0 && n.sb.window.__alertSourceUrl === undefined);
        console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
        process.exit(fail ? 1 : 0);
    })().catch((e) => { console.error(e); process.exit(1); });
}
