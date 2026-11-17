/**
 * MMIS ↔ 통보문 비교 기록(services/bulletin_compare) · 메인 출처 전환 버튼(client/js/forecast/alerts/alert_source_toggle.js) 검사.
 * 지금 두 쪽이 다른 곳 표(diffSnapshot — 메인 「MMIS와 상이 N개소」 줄·팝업)도 본다.
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
    ok('가상 푸시 두 걸음: 예비 없이 나타나면 publish(📢 발표) → 발효 시각에 active(🚨 발효)', C.templateOf('x', null, P).templateId === 'publish' && C.templateOf('x', P, F).templateId === 'active');
    // 앱 규칙(2026-11-16 사용자 「발효시각 변경이라는 명칭은 맞음 … 범위형 … 확정된 발효시간」 · 「앱과 맞춰」) — push_sender isPreToAdvisory
    ok('예비(범위) → 발표(정확한 시각) = 🕐 발효시각 변경(time_ef_change)', C.templateOf('x', Z('yebi', '예비', { parent: 'x' }), P).templateId === 'time_ef_change');
    const Y1 = Z('yebi', '예비', { parent: 'x', tmEf: '2026년 11월 16일 오전(06시~12시)' }), Y2 = Object.assign({}, Y1, { tmEf: '2026년 11월 16일 오후(12시~18시)' });
    const e1 = C.templateOf('x', Y1, Y2);
    ok('예비 06~12시 → 12~18시(같은 종류, 더 늦은 범위) = 발효 예정시각 연장(ef_extend, 기존·변경 후)', e1.templateId === 'ef_extend' && e1.oldTime === Y1.tmEf && e1.newTime === Y2.tmEf, e1);
    ok('예비 12~18시 → 06~12시(앞당김) = 발효시각 변경', C.templateOf('x', Y2, Y1).templateId === 'time_ef_change');
    const F1 = Z('formal', '주의보', { parent: 'x', clr: '17일 오전(09시~12시)' });
    ok('해제 예고 오전 → 오후(같은 종류·등급, 더 늦은 범위) = 해제 예정시각 연장(yn_extend)', C.templateOf('x', F1, Object.assign({}, F1, { clr: '17일 오후(12시~18시)' })).templateId === 'yn_extend');
    ok('해제 예고 범위 → 정확한 해제 시각 = 🕐 해제시각 변경(time_yn_change)', C.templateOf('x', F1, Object.assign({}, F1, { clr: '2026년 11월 17일 11시 00분' })).templateId === 'time_yn_change');
    const kidY = (b, a, pc) => (C.templateOf('x중연안바다', Object.assign({}, b, { parent: 'x' }), Object.assign({}, a, { parent: 'x' }), Z('formal', '주의보', { parent: 'x' }), pc) || {}).templateId || null;
    ok('적대검증 #4 예비 연장도 부모가 같이 바뀌면 자식 몫은 안 냄', (C.templateOf('x중연안바다', Object.assign({}, Y1, { parent: 'x' }), Object.assign({}, Y2, { parent: 'x' }), null, true) || null) === null && C.templateOf('x중연안바다', Object.assign({}, Y1, { parent: 'x' }), Object.assign({}, Y2, { parent: 'x' }), null, false).templateId === 'ef_extend');
    const cur = Z('formal', '주의보', { parent: 'x' }), nxt = { kind: 'pending', type: '풍랑', level: '경보', tmEf: '2025년 01월 09일 10시 00분' };
    ok('적대검증 #2 주의보 발효 중 다음 경보 = 격상 발표(level_upgrade_publish) · 경보 중 다음 주의보 = 격하 발표 · 다음 특보 시각만 바뀜 = 발효시각 변경',
        C.upTemplate(cur, null, nxt, false).templateId === 'level_upgrade_publish' && C.upTemplate(Z('formal', '경보', { parent: 'x' }), null, Object.assign({}, nxt, { level: '주의보' }), false).templateId === 'level_downgrade_publish'
        && C.upTemplate(cur, nxt, Object.assign({}, nxt, { tmEf: '2025년 01월 09일 11시 00분' }), false).templateId === 'time_ef_change');
    // 2026-11-17 사용자 「풍랑주의보 발효 중인경우 같은 해역에 예비 특보가 나오는 경우 다가오는 특보로」 — 앱: 예비 = 주의보 동급(push_sender LVL_RANK)
    const upY = { kind: 'yebi', type: '풍랑', level: '예비', tmEf: '2026년 11월 16일 밤(18시~24시)' };
    ok('주의보 발효 중 + 같은 해역 예비 = 📢 발표(publish) · 경보 발효 중 + 예비 = 격하 발표', C.upTemplate(cur, null, upY, false).templateId === 'publish' && C.upTemplate(Z('formal', '경보', { parent: 'x' }), null, upY, false).templateId === 'level_downgrade_publish');
    ok('풍랑경보 발효 중 + 태풍 예비(종류 다름) = 「풍랑경보→태풍주의보 격상 발표」(앱과 같음 — 2026-11-17 사용자 확정)', (() => { const t = C.upTemplate(Z('formal', '경보', { parent: 'x' }), null, Object.assign({}, upY, { type: '태풍' }), false); return t.templateId === 'type_upgrade_publish' && t.prevTypeName === '풍랑' && t.prevLevel === '경보'; })());
    ok('태풍주의보 발효 중 + 다가오는 풍랑 예비 → 태풍 예비(예비끼리 종류만) = 종류 격상 발표(앱 「예비 단계 종류 격상」)', C.upTemplate(Z('formal', '주의보', { parent: 'x', type: '태풍' }), upY, Object.assign({}, upY, { type: '태풍' }), false).templateId === 'type_upgrade_publish');
    ok('다가오는 예비 시간창이 더 늦게 = 발효 예정시각 연장 · 다가오는 예비 → 정확한 발표 = 발효시각 변경',
        C.upTemplate(cur, Object.assign({}, upY, { tmEf: '2026년 11월 16일 오후(12시~18시)' }), upY, false).templateId === 'ef_extend'
        && C.upTemplate(cur, upY, { kind: 'pending', type: '풍랑', level: '주의보', tmEf: '2026년 11월 16일 19시 00분' }, false).templateId === 'time_ef_change');
    {   // MMIS 나무의 current + upcoming → up 으로 같이 보고, 다가오는 칸이 다르면 「다름」
        const mt = { 동해: { 동해중부해상: { 동해중부안쪽먼바다: { current: { wrnTpNm: '풍랑', wrnLvlNm: '주의보', clrNtcTm: '2025년 01월 11일 20시 00분' }, upcoming: { wrnTpNm: '풍랑', wrnLvlNm: '예비', tmEf: '2025년 01월 12일 오전(06시~12시)' }, history: [], children: {} } } } };
        const f = C.flattenTree(mt)['동해중부안쪽먼바다'];
        ok('MMIS 「발효 중 + 다가오는 예비」 = 지금 주의보 + up 예비', f.kind === 'formal' && f.up && f.up.kind === 'yebi');
        const bz = C.pendingOf({ 동해중부안쪽먼바다: { parent: '동해중부안쪽먼바다', kind: 'formal', type: '풍랑', level: '주의보', clr: '2025년 01월 11일 20시 00분', upYebi: { type: '풍랑', level: '예비', tmEf: '2025년 01월 12일 오전(06시~12시)' } } }, 0)['동해중부안쪽먼바다'];
        ok('통보문 upYebi 도 같은 꼴 → 두 쪽 같음', C.sig(bz) === C.sig(f), [C.sig(bz), C.sig(f)]);
        const noUp = Object.assign({}, bz); delete noUp.up;
        const d = C.diffSnapshot({ 동해중부안쪽먼바다: f }, { 동해중부안쪽먼바다: noUp }, 0, '');
        ok('다가오는 칸만 다르면 팝업에 「다가오는 특보」 줄이 다름 · 「왜?」= upcoming', d.count === 1 && d.zones[0].parts[0].rows.some((r) => r.k === '다가오는 특보' && r.diff) && d.zones[0].parts[0].why.id === 'upcoming', d.zones[0] && d.zones[0].parts[0]);
    }
    {   // 적대검증 2026-11-17 회귀
        // D1 자식 해역에는 다가오는 칸이 없다(MMIS 나무 자식 = 블록 하나) — 통보문 자식에 up 을 붙이면 늘 「다름」
        const bz = C.pendingOf({ P: { parent: 'P', kind: 'formal', type: '풍랑', level: '주의보', clr: 'x', upYebi: { type: '풍랑', level: '예비', tmEf: '2026년 01월 19일 밤(18시~24시)' } },
            P중연안바다: { parent: 'P', kind: 'formal', type: '풍랑', level: '주의보', clr: 'x', upYebi: { type: '풍랑', level: '예비', tmEf: '2026년 01월 19일 밤(18시~24시)' } } }, 0);
        ok('D1 다가오는 특보는 부모에만(자식엔 up 없음)', bz.P.up && !bz['P중연안바다'].up);
        // D2 MMIS 는 발효 중 해역의 격상 발표대기를 등급(경보)으로 적는다 → 발표(발효 전)으로 읽어 통보문 next 와 같게
        const mt = { 동해: { g: { P: { current: { wrnTpNm: '풍랑', wrnLvlNm: '주의보', clrNtcTm: '10일 밤(21시~24시)' }, upcoming: { wrnTpNm: '풍랑', wrnLvlNm: '경보', tmEf: '2025년 01월 09일 10시 00분' }, history: [], children: {} } } } };
        const m = C.flattenTree(mt).P;
        const b = C.pendingOf({ P: { parent: 'P', kind: 'formal', type: '풍랑', level: '주의보', clr: '10일 밤(21시~24시)', next: { type: '풍랑', level: '경보', tmEf: '2025년 01월 09일 10시 00분', efMs: 9e15 } } }, 0).P;
        ok('D2 MMIS 「주의보 + upcoming 경보(발효 전)」 = 통보문 「주의보 + next 경보」 → 같음', m.up.kind === 'pending' && C.sig(m) === C.sig(b), [C.sig(m), C.sig(b)]);
    }
    {   // 주의보 해제 → 곧바로 예비: 그 예비를 다가오는 특보로 알린 적이 없으면 해제 + 발표(부산 2025 2-70호 — 같은 1분에 겹쳐 발표가 빠졌다, 2026-11-17)
        const os = require('os'), fs2 = require('fs'), path2 = require('path');
        const F = { parent: 'P', kind: 'formal', type: '풍랑', level: '주의보', clr: '2025년 02월 24일 12시 00분', tmFc: '', tmEf: '', issueMs: 1000, inMs: 1000 };   // 주의보를 낸 통보문 = 1000
        const Yb = { parent: 'P', kind: 'yebi', type: '풍랑', level: '예비', clr: '', tmFc: '2025년 02월 24일 12시 00분', tmEf: '2025년 02월 25일 오후(12시~18시)', inMs: 2000 };   // 예비 목록 = 그보다 나중(2000)
        const mk = (seq) => { const dir = fs2.mkdtempSync(path2.join(os.tmpdir(), 'bcmp-rel-')); let i = 0; const c = C.createCompare({ getBulletin: () => ({ zones: seq[Math.min(i, seq.length - 1)] }), getMmis: () => ({}), getMmisAt: () => '', getPushes: () => [], now: () => T0 + i * 60e3, dir });
            for (i = 0; i < seq.length; i++) c.run(); return c.days().flatMap((d) => c.readDay(d)).filter((e) => e.kind === 'virtual_push').map((e) => e.templateId + ':' + e.target); };
        const r1 = mk([{ P: F }, { P: Yb }]);
        ok('같은 1분에 해제와 새 예비가 겹침(다가오는 특보로 알린 적 없음) → 해제 + 발표', r1.includes('release:P') && r1.includes('publish:P'), r1);
        const r2 = mk([{ P: F }, { P: Object.assign({}, F, { upYebi: { type: '풍랑', level: '예비', tmEf: Yb.tmEf } }) }, { P: Yb }]);
        ok('먼저 다가오는 특보로 「발표」를 냈으면, 해제 때는 해제만(발표 중복 없음)', r2.filter((x) => x === 'publish:P').length === 1 && r2[r2.length - 1] === 'release:P', r2);
        const Fc = Object.assign({}, F, { parent: 'P' }), Ycc = Object.assign({}, Yb, { parent: 'P' });
        const r3 = mk([{ P: F, P중연안바다: Fc }, { P: Object.assign({}, F, { upYebi: { type: '풍랑', level: '예비', tmEf: Yb.tmEf } }), P중연안바다: Fc }, { P: Yb, P중연안바다: Ycc }]);
        ok('부모 예비를 이미 알렸으면 자식 해역 몫(추가 발표)도 따로 안 냄', !r3.some((x) => x.startsWith('child_prelim')), r3);
        const r4 = mk([{ P: F, P중연안바다: Fc }, { P: Yb, P중연안바다: Ycc }]);
        ok('알린 적 없으면 부모 = 발표, 자식 = 추가 발표', r4.includes('publish:P') && r4.includes('child_prelim:P중연안바다'), r4);
        // 적대검증 2026-11-17 D1 — 정식 특보보다 먼저 나온 목록의 「옛 예비」(그 정식으로 넘어간 것)는 해제 때 다시 알리지 않는다(수도권 2025-10-27 06:00)
        const r5 = mk([{ P: F }, { P: Object.assign({}, Yb, { inMs: 500 }) }]);
        ok('D1 정식보다 먼저 나온 옛 예비가 해제 뒤 남아도 「발표」를 안 냄(해제만)', r5.includes('release:P') && !r5.some((x) => /^publish|^child_prelim/.test(x)), r5);
        // D2 — 알린 다가오는 예비(25일 오후)가 해제와 같은 1분에 25일 밤으로 바뀜 → 발표가 아니라 연장
        const r6 = mk([{ P: F }, { P: Object.assign({}, F, { upYebi: { type: '풍랑', level: '예비', tmEf: Yb.tmEf, inMs: 2000 } }) }, { P: Object.assign({}, Yb, { tmEf: '2025년 02월 25일 밤(18시~24시)' }) }]);
        ok('D2 알린 다가오는 예비가 해제와 같은 1분에 더 늦은 시간창으로 → 「발효 예정시각 연장」(발표 아님)', r6.includes('ef_extend:P') && r6.filter((x) => x === 'publish:P').length === 1, r6);
    }
    {   // 배포 순간: 옛 저장본(ver 없음 — 다가오는 특보 모름)에 up 이 한꺼번에 「새로 나타남」으로 잡혀 가짜 바뀜·푸시가 쏟아지면 안 된다(2026-11-17)
        const os = require('os'), fs2 = require('fs'), path2 = require('path');
        const dir = fs2.mkdtempSync(path2.join(os.tmpdir(), 'bcmp-up-'));
        const zone = { parent: 'P', kind: 'formal', type: '풍랑', level: '주의보', clr: '17일 오전(09시~12시)', tmFc: '', tmEf: '' };
        fs2.writeFileSync(path2.join(dir, 'state.json'), JSON.stringify({ mmis: { P: Object.assign({}, zone) }, bulletin: { P: Object.assign({}, zone) }, lastPushId: 0, mismatch: {} }));
        const mt = { 동해: { g: { P: { current: { wrnTpNm: '풍랑', wrnLvlNm: '주의보', clrNtcTm: '17일 오전(09시~12시)' }, upcoming: { wrnTpNm: '풍랑', wrnLvlNm: '예비', tmEf: '2026년 11월 17일 밤(18시~24시)' }, history: [], children: {} } } } };
        const bz = { P: Object.assign({}, zone, { upYebi: { type: '풍랑', level: '예비', tmEf: '2026년 11월 17일 밤(18시~24시)' } }) };
        const cmp = C.createCompare({ getBulletin: () => ({ zones: bz }), getMmis: () => mt, getMmisAt: () => '', getPushes: () => [], now: () => T0, dir });
        cmp.run();
        const ev = cmp.readDay(cmp.days()[0] || '');
        ok('옛 저장본에서 처음 돌 때 다가오는 특보 때문에 가짜 바뀜·가상 푸시·다름이 생기지 않음', !ev.some((e) => e.kind === 'change' || e.kind === 'virtual_push' || e.kind === 'mismatch_start'), ev.map((e) => e.kind));
        bz.P.upYebi = { type: '풍랑', level: '예비', tmEf: '2026년 11월 18일 새벽(00시~06시)' };
        cmp.run();
        const ev2 = cmp.readDay(cmp.days()[0]);
        ok('그다음 다가오는 예비가 더 늦은 시간창으로 바뀌면 「발효 예정시각 연장」 가상 푸시', ev2.some((e) => e.kind === 'virtual_push' && e.templateId === 'ef_extend'), ev2.map((e) => e.kind + ':' + (e.templateId || '')));
        ok('D5 다가오는 특보만 바뀐 분에 통보문 바뀜 기록은 한 번', ev2.filter((e) => e.kind === 'change' && e.side === 'bulletin' && e.unit === 'P').length === 1, ev2.filter((e) => e.kind === 'change').map((e) => e.side + ':' + e.unit + ':' + !!e.upcoming));
    }
    {   // 보고서 구분 — 탭으로(적대검증 #5)
        const ev = [{ kind: 'mmis_push', at: '2026-11-16T10:00:00+09:00', title: '🌀 제25호 태풍 발생', tab: 'typhoon', target: '' },
            { kind: 'mmis_push', at: '2026-11-16T10:05:00+09:00', title: '📍 [위치기반] 태풍 반경 안전 경보 신호 발송', tab: 'typhoon', target: '' },
            { kind: 'mmis_push', at: '2026-11-16T10:06:00+09:00', title: '📍 [위치기반] 해상특보 안전 경보 발송', tab: 'location', content: '울산앞바다(풍랑주의보)', target: '', count: 7 },
            { kind: 'mmis_push', at: '2026-11-16T10:07:00+09:00', title: '📍 [위치기반] 해상특보 안전 경보 발송', content: '옛 기록(탭 없음)', target: '' }];
        const md = C.reportMarkdown(ev, 'all');
        ok('적대검증 #5 보고서: 태풍 알림은 따로 · 위치기반 칸엔 해상특보 위치기반만(옛 기록은 제목으로) · 짝 맞추기엔 0건', /MMIS 실제 0건/.test(md) && /태풍 알림\(짝 맞추기에서 뺌\): 2건/.test(md) && /위치기반 경보\(MMIS, 짝 맞추기에서 뺌\): 2건/.test(md), md.split('\n').slice(6, 12));
    }
    ok('자식만 시각이 바뀌면 child_time_*, 부모도 같이 바뀌면 자식 몫은 안 냄(부모 푸시가 맡음)', kidY(F1, Object.assign({}, F1, { clr: '2026년 11월 17일 11시 00분' }), false) === 'child_time_yn_change' && kidY(F1, Object.assign({}, F1, { clr: '2026년 11월 17일 11시 00분' }), true) === null);
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
    // 지금 다른 곳 표(diff)도 매번 남는다 — 같아졌으니 0곳, 시각은 그 비교 시각
    const ld = cmp.latestDiff();
    ok('매분 비교가 지금 다른 곳 표를 남김(같아진 지금 = 0곳, 비교 시각)', ld && ld.count === 0 && ld.atMs === t && Array.isArray(ld.zones), ld);
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-'));
    const cmp3 = C.createCompare({ getBulletin: () => ({ zones: { 제주도남쪽바깥먼바다: Z('yebi', '예비') } }), getMmis: () => mtree(null), getMmisAt: () => '2026. 11. 16. 오후 2:31:09', getPushes: () => [], now: () => T0, dir: dir2 });
    ok('비교 전에는 null', cmp3.latestDiff() === null);
    cmp3.run();
    const ld3 = cmp3.latestDiff();
    ok('처음 비교(기준만 남기는 때)에도 표를 만듦 + MMIS 갱신 시각이 근거 칸에', ld3.count === 1 && ld3.zones[0].parts[0].rows[4].m === 'MMIS 14:31 갱신', ld3);
    ok('표는 state.json 에 함께 저장(서버를 다시 켜도 남음)', C.createCompare({ dir: dir2 }).latestDiff().count === 1);
}

console.log('D. 지금 다른 곳 표(diffSnapshot) — 부모별 묶음·칸별 다름·「왜?」 규칙');
{
    const P = (parent, kind, level, extra) => Object.assign({ parent, kind, type: '풍랑', level, tmFc: '2026년 11월 15일 10시 00분', tmEf: kind === 'yebi' ? '2026년 11월 16일 오전(06시~12시)' : '2026년 11월 15일 06시 00분', clr: '' }, extra);
    const KB = '경북북부앞바다', KW = '강원중부앞바다', GN = '경남서부남해앞바다', JJ = '제주도서부앞바다';
    const M = {
        [KB]: P(KB, 'yebi', '예비', { tmEf: '2026년 11월 16일 아침(06시~12시)' }),   // 아침 = 오전 → 같음
        [KB + '중연안바다']: P(KB, 'formal', '주의보', { tmFc: '2026년 11월 15일 13시 00분', tmEf: '2026년 11월 15일 13시 30분' }),
        [KW]: P(KW, 'yebi', '예비', { tmEf: '2026년 11월 16일 새벽(00시~06시)' }),
        [GN + '중동부평수구역']: P(GN, 'formal', '주의보', { clr: '15일 오후(12시~15시)' }),
        [GN + '중서부평수구역']: P(GN, 'formal', '주의보', { clr: '15일 오후(12시~15시)' }),
        [JJ]: P(JJ, 'formal', '주의보', { clr: '17일 오전(09시~12시)' }),   // 두 쪽 같음 → 안 나옴
    };
    const B = {
        [KB]: P(KB, 'yebi', '예비', { ho: '제11-31호' }),
        [KB + '중연안바다']: P(KB, 'yebi', '예비', { ho: '제11-31호' }),
        [KW]: P(KW, 'pending', '주의보', { tmFc: '2026년 11월 15일 14시 00분', tmEf: '2026년 11월 16일 04시 30분', ho: '제11-35호' }),
        [GN + '중서부평수구역']: P(GN, 'formal', '주의보', { clr: '15일 밤(21시~24시)', ho: '제11-33호' }),
        [JJ]: P(JJ, 'formal', '주의보', { clr: '17일  오전(09시~12시)' }),
    };
    const AT = Date.parse('2026-11-15T05:32:00Z');
    const d = C.diffSnapshot(M, B, AT, '2026. 11. 15. 오후 2:31:09');
    ok('부모 해역별로 묶음 — 다른 부모 3곳, MMIS 나무 순서, 같은 곳(제주도서부앞바다·부모 경북북부앞바다)은 빠짐', d.count === 3 && d.zones.map((z) => z.parent).join() === [KB, KW, GN].join() && d.at === '2026-11-15T14:32:00.000+09:00', d.zones.map((z) => z.parent));
    const [kb, kw, gn] = d.zones;
    ok('부모마다 다른 구역 수 + 부제(연안바다만 / 해역 전체가 / 평수구역 2곳)', kb.count === 1 && kb.sub === '연안바다만 다름' && kw.count === 1 && kw.sub === '해역 전체가 다름' && gn.count === 2 && gn.sub === '평수구역 2곳 다름', d.zones.map((z) => [z.count, z.sub]));
    ok('구역 칩(연안바다·해역 전체·평수구역)', kb.parts[0].kind === '연안바다' && kw.parts[0].kind === '해역 전체' && gn.parts.every((p) => p.kind === '평수구역'));
    const flags = (p) => p.rows.map((r) => (r.diff ? 1 : 0)).join('');
    ok('칸별 다름: 정식↔예비 = 종류·발효 시각(해제 예고·발표 시각·근거는 아님)', flags(kb.parts[0]) === '110000' && kb.parts[0].rows[0].m === '풍랑주의보' && kb.parts[0].rows[0].b === '풍랑 예비특보' && kb.parts[0].rows[1].b === '16일 오전(06시~12시)', kb.parts[0].rows);
    const dong = gn.parts.find((p) => /중동부/.test(p.unit)), seo = gn.parts.find((p) => /중서부/.test(p.unit));
    ok('칸별 다름: 정식↔없음 = 종류·발효 시각·해제 예고, 통보문 칸은 「없음」·「—」', flags(dong) === '111000' && dong.rows[0].b === '없음' && dong.rows[1].b === '—' && dong.rows[4].b === '—', dong.rows);
    ok('칸별 다름: 같은 정식이면 sig 처럼 해제 예고만(발효 시각은 안 봄)', flags(seo) === '001000' && seo.rows[2].b === '15일 밤(21시~24시)', seo.rows);
    ok('근거 자료: MMIS = 갱신 시각(KST 글자에서 HH:MM) · 통보문 = 호', kb.parts[0].rows[4].m === 'MMIS 14:31 갱신' && kb.parts[0].rows[4].b === '제11-31호 통보문' && kw.parts[0].rows[4].b === '제11-35호 통보문');
    ok('근거 자료: MMIS 갱신 시각을 못 읽으면 「—」(지어내지 않음)', C.diffSnapshot(M, B, AT, '').zones[0].parts[0].rows[4].m === '—' && C.mmisHm('2026. 11. 16. AM 12:05:00') === '00:05' && C.mmisHm('2026. 11. 16. 오후 12:05:00') === '12:05' && C.mmisHm('2026. 11. 16. 오후 2:05:09') === '14:05');
    ok('발표(발효 전): 종류 칸은 등급을 안 봄(MMIS 「발표」 = 통보문 「주의보」), 발효 시각 + 「발효 예정」', (() => {
        const m = { x: P('x', 'pending', '발표', { tmEf: '2026년 11월 16일 04시 30분' }) }, b = { x: P('x', 'pending', '주의보', { tmEf: '2026년 11월 16일 05시 00분' }) };
        const p = C.diffSnapshot(m, b, AT, '').zones[0].parts[0];
        return flags(p) === '010000' && p.rows[1].b === '16일 05시 00분 발효 예정' && p.why.id === 'pending_time' && C.diffSnapshot(m, { x: Object.assign({}, b.x, { tmEf: m.x.tmEf }) }, AT, '').count === 0;
    })());
    ok('다른 곳 집합 = sig 가 다르다고 보는 곳 그대로(비교 기록과 같은 기준)', (() => {
        const units = new Set([...Object.keys(M), ...Object.keys(B)]);
        const want = [...units].filter((u) => C.sig(M[u]) !== C.sig(B[u])).sort().join();
        return d.zones.flatMap((z) => z.parts.map((p) => p.unit)).sort().join() === want;
    })());
    ok('부모와 자식이 함께 다르면 부모가 맨 위, 부제는 「해역 전체·연안바다 다름」', (() => {
        const z = C.diffSnapshot({ [KB + '중연안바다']: M[KB + '중연안바다'], [KB]: P(KB, 'formal', '주의보') }, {}, AT, '').zones[0];
        return z.parts[0].unit === KB && z.count === 2 && z.sub === '해역 전체·연안바다 다름';
    })());
    ok('다른 곳이 없으면 0곳 · 빈 목록', (() => { const e = C.diffSnapshot({ [JJ]: M[JJ] }, { [JJ]: B[JJ] }, AT, ''); return e.count === 0 && e.zones.length === 0; })());
    const W = (m, b) => C.whyOf(m, b);
    const F = (extra) => P('x', 'formal', '주의보', extra);
    ok('「왜?」 틀 고르기: MMIS만 · 통보문만', W(F(), null).id === 'mmis_only' && W(F(), null).text === '통보문에는 이 구역에 아무 특보도 없는데 MMIS에는 풍랑주의보 표시가 남아 있습니다.' && W(null, P('x', 'yebi', '예비')).id === 'bulletin_only' && /통보문에는 풍랑 예비특보 표시가 있습니다/.test(W(null, P('x', 'yebi', '예비')).text));
    ok('「왜?」 틀 고르기: 단계(발효 중 ↔ 예비) — 발표 시각 앞뒤는 사실만 붙임', kb.parts[0].why.id === 'stage' && kb.parts[0].why.text === 'MMIS는 발효 중인 특보, 통보문은 예비특보 상태입니다. MMIS 쪽 발표 시각이 더 나중입니다.' && kw.parts[0].why.text === 'MMIS는 예비특보, 통보문은 발표(발효 전) 상태입니다. 통보문 쪽 발표 시각이 더 나중입니다.');
    ok('「왜?」 틀 고르기: 종류 · 단계(주의보↔경보)', W(F(), F({ type: '태풍' })).id === 'type' && W(F(), F({ level: '경보' })).id === 'level' && /MMIS 주의보 · 통보문 경보/.test(W(F(), F({ level: '경보' })).text));
    ok('「왜?」 틀 고르기: 예비 시간대만 · 해제 예고만(발표 시각이 같으면 앞뒤 말 없음)', W(P('x', 'yebi', '예비'), P('x', 'yebi', '예비', { tmEf: '2026년 11월 16일 오후(12시~18시)' })).text === '종류는 같고 예비특보 시간대만 다릅니다(MMIS 16일 오전(06시~12시) · 통보문 16일 오후(12시~18시)).' && seo.why.id === 'clr' && seo.why.text === '특보는 같고 해제 예고 시각만 다릅니다(MMIS 15일 오후(12시~15시) · 통보문 15일 밤(21시~24시)).');
}

console.log('E. GET /api/admin/bulletin-status 에 diff');
{
    const { createRouter } = require('../routes/bulletin_watch');
    const X = { atMs: 1, count: 2, zones: [] };
    const call = (latest) => {
        const router = createRouter({ status: { read: () => ({ updatedAt: 'u', bulletins: 3, waiting: [], current: {} }) }, compare: { latestDiff: () => latest }, authorize: (q, r, n) => n() });
        const layer = router.stack.find((l) => l.route && l.route.path === '/api/admin/bulletin-status');
        const res = { h: {}, set(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; } };
        layer.route.stack.at(-1).handle({ query: {} }, res);
        return res.body;
    };
    ok('응답에 diff(마지막 비교의 다른 곳 표) — 기존 칸은 그대로', call(X).diff === X && call(X).bulletins === 3 && call(X).source === 'BULLETIN');
    ok('비교 전이면 diff: null', call(null).diff === null);
}

console.log('C. 메인 [MMIS][통보문] 버튼');
{
    const root = path.join(__dirname, '..', '..');
    const html = fs.readFileSync(path.join(root, 'client/index2.html'), 'utf8');
    const data = fs.readFileSync(path.join(root, 'client/js/forecast/alerts/data.js'), 'utf8');
    ok('「기상정보」 글자 오른쪽에 버튼 자리(기본 숨김)', /기상정보\s*\n\s*<!-- \[관리자만\][^\n]*\n\s*<span id="alert-source-toggle" style="display:none/.test(html) && /data-src="mmis"/.test(html) && /data-src="bulletin"/.test(html));
    ok('스크립트는 data.js 바로 다음', html.indexOf('js/forecast/alerts/alert_source_toggle.js') > html.indexOf('js/forecast/alerts/data.js'));
    ok('data.js 두 곳이 같은 출처 주소를 씀(평소 MMIS)', (data.match(/window\.__alertSourceUrl \|\| '\/api\/weather-alerts'/g) || []).length === 2);
    ok('머리 아래 「MMIS와 상이」 줄 자리(기본 숨김) · 옛 버튼 옆 글(.ast-note)은 없앰', /<div id="ast-diff-line" style="display:none/.test(html) && !/ast-note/.test(html));
    ok('data.js 가 특보 자료를 받을 때마다(두 곳) 상이 줄 갱신을 부름', (data.match(/window\.__alertSourceOnData\(rootData\)/g) || []).length === 2);
    const mk = (admin, resp) => {
        const box = { style: {}, btns: [{ a: 'mmis', style: {} }, { a: 'bulletin', style: {} }] };
        box.querySelectorAll = () => box.btns.map((b) => ({ getAttribute: () => b.a, style: b.style }));
        const link = { onclick: null };
        const line = { style: {}, innerHTML: '', querySelector: () => (/ast-diff-link/.test(line.innerHTML) ? link : null) };
        const appended = [];
        const el = () => { const e = { style: {}, innerHTML: '', remove() { e.removed = true; }, querySelector: () => ({}), querySelectorAll: () => [] }; return e; };
        const els = { 'alert-source-toggle': box, 'ast-diff-line': line };
        const calls = { flatten: [], render: 0, refresh: 0, alerts: [] };
        const sb = { window: {}, document: { readyState: 'complete', getElementById: (id) => els[id] || null, addEventListener: () => {}, createElement: el,
                head: { appendChild: (e) => { els['ast-pop-css'] = e; } }, body: { appendChild: (e) => appended.push(e) } },
            localStorage: { getItem: () => (admin ? 'true' : null) }, console,
            fetch: async (u) => resp(u), flattenAlertsData: (d) => calls.flatten.push(d), renderApp: () => calls.render++, refreshAlertData: async () => calls.refresh++ };
        sb.window.alert = (m) => calls.alerts.push(m);
        vm.runInNewContext(fs.readFileSync(path.join(root, 'client/js/forecast/alerts/alert_source_toggle.js'), 'utf8'), sb);
        return { sb, box, line, link, appended, calls };
    };
    const u = mk(false, async () => ({}));
    ok('일반 사용자에겐 안 보임', u.box.style.display === 'none');
    const AT = Date.parse('2026-11-16T03:00:00.000Z');
    const DIFF = C.diffSnapshot({ 경북북부앞바다중연안바다: { parent: '경북북부앞바다', kind: 'formal', type: '풍랑', level: '주의보', tmFc: '', tmEf: '2026년 11월 15일 13시 30분', clr: '' } }, {}, AT, '');
    const J = (body) => async () => ({ ok: true, status: 200, json: async () => body });
    (async () => {
        const a = mk(true, J({ updatedAt: '2026-11-16T03:00:00.000Z', bulletins: 12, current: { 동해: {} }, diff: DIFF }));
        ok('관리자에겐 보이고 MMIS 가 눌린 채 시작(상이 줄은 숨김)', a.box.style.display === 'inline-flex' && a.box.btns[0].style.fontWeight === '800' && a.line.style.display !== 'flex');
        await a.sb.window.setAlertSource('bulletin');
        ok('[통보문]: 관리자 주소로 받아 같은 화면 코드로 그림 + 자동 새로고침도 그 주소', a.sb.window.__alertSourceUrl === '/api/admin/bulletin-status' && a.calls.flatten.length === 1 && a.calls.render === 1);
        ok('[통보문]: 머리 아래 「12:00 기준 MMIS와 상이 1개소」(개소 = 누르는 글자)', a.line.style.display === 'flex' && /12:00 기준 MMIS와 상이 <a [^>]*class="ast-diff-link"[^>]*>1개소<\/a>/.test(a.line.innerHTML) && typeof a.link.onclick === 'function', a.line.innerHTML);
        a.link.onclick();
        const pop = a.appended[0] && a.appended[0].innerHTML || '';
        ok('「N개소」 누르면 아래 팝업: 제목·부모 아코디언(1곳 다름·부제)·표(다른 칸 노랑)·「왜?」', /MMIS와 다른 해역 1곳/.test(pop) && /12:00 기준/.test(pop) && /경북북부앞바다<small>연안바다만 다름<\/small>/.test(pop) && /1곳 다름/.test(pop) &&
            /<td class="k">특보 종류·단계<\/td><td class="diff">풍랑주의보<\/td><td class="diff">없음<\/td>/.test(pop) && /<td class="k">발표 시각<\/td><td>—<\/td><td>—<\/td>/.test(pop) && /<b>왜\?<\/b><span>통보문에는 이 구역에 아무 특보도 없는데/.test(pop), pop.slice(0, 400));
        const z = mk(true, J({ updatedAt: '2026-11-16T03:00:00.000Z', bulletins: 0, current: {}, diff: DIFF }));
        await z.sb.window.setAlertSource('bulletin');
        ok('쓴 통보문이 0건이면 상이 대신 경고(「특보 없음」과 구분 — 옛 버튼 옆 글에서 옮김)', /⚠ 통보문 0건/.test(z.line.innerHTML) && !/개소/.test(z.line.innerHTML));
        const c = mk(true, J({ updatedAt: '2026-11-16T03:00:00.000Z', bulletins: 12, current: {}, diff: Object.assign({}, DIFF, { count: 0, zones: [] }) }));
        await c.sb.window.setAlertSource('bulletin');
        ok('다른 곳 0개 = 「12:00 기준 MMIS와 상이 없음」(누를 것 없음)', /12:00 기준 MMIS와 상이 없음/.test(c.line.innerHTML) && !/ast-diff-link/.test(c.line.innerHTML));
        const nd = mk(true, J({ updatedAt: 'x', bulletins: 12, current: {}, diff: null }));
        await nd.sb.window.setAlertSource('bulletin');
        ok('비교 전(diff 없음) = 「MMIS와 비교 전」', /MMIS와 비교 전/.test(nd.line.innerHTML));
        a.sb.window.__alertSourceOnData({ bulletins: 12, diff: Object.assign({}, DIFF, { atMs: AT + 60e3, count: 0, zones: [] }) });
        ok('자동 새로고침(data.js) 때 상이 줄도 새로(12:01)', /12:01 기준 MMIS와 상이 없음/.test(a.line.innerHTML));
        await a.sb.window.setAlertSource('mmis');
        ok('[MMIS]: 주소를 되돌리고 MMIS 로 다시 그림 + 상이 줄 숨김', a.sb.window.__alertSourceUrl === null && a.calls.refresh === 1 && a.calls.render === 2 && a.line.style.display === 'none');
        a.sb.window.__alertSourceOnData({ bulletins: 12, diff: DIFF });
        ok('MMIS 로 돌아간 뒤의 새로고침은 상이 줄을 다시 띄우지 않음', a.line.style.display === 'none');
        const n = mk(true, async () => ({ ok: false, status: 401, json: async () => ({}) }));
        await n.sb.window.setAlertSource('bulletin');
        ok('관리자 로그인이 없으면(401) 안내만, 화면은 그대로', /관리자 로그인이 필요/.test(n.calls.alerts[0] || '') && n.calls.flatten.length === 0 && n.sb.window.__alertSourceUrl === undefined);
        console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
        process.exit(fail ? 1 : 0);
    })().catch((e) => { console.error(e); process.exit(1); });
}
