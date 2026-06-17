/**
 * test_location_alert_server.js — 위치기반 경보 서버 모듈(④) 검증
 * 실행: node local_server/scripts/test_location_alert_server.js
 * 동의 저장소 + 디스패치(스냅샷/타깃/페이로드/추출)를 mock으로 검증. FCM/파일 의존 없음.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// 동의 저장소는 임시 파일로
const TMP = path.join(os.tmpdir(), `lac_test_${Date.now()}.json`);
process.env.LOCATION_ALERT_CONSENTS_FILE = TMP;

const store = require('../services/location_alert_store');
const dispatch = require('../services/location_alert_dispatch');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

console.log('[1] 동의 저장소');
try { fs.unlinkSync(TMP); } catch (_) { }
check('초기 활성 동의 0', store.count() === 0);
store.recordConsent({ token: 'tkA', agreed: true, version: '2026-06-16' });
store.recordConsent({ token: 'tkB', agreed: true, version: '2026-06-16' });
check('동의 2건', store.count() === 2);
store.recordConsent({ token: 'tkA', agreed: false }); // 철회(upsert)
check('철회 후 활성 1건', store.count() === 1, `(${store.count()})`);
check('전체 레코드 2건(철회 포함 보존)', store.all().length === 2);
const a = store.getActiveConsents();
check('활성 토큰은 tkB', a.length === 1 && a[0].token === 'tkB');
check('버전 기록됨', a[0].version === '2026-06-16');
check('시각 ISO 기록', /\d{4}-\d{2}-\d{2}T/.test(a[0].at));

console.log('\n[2] 스냅샷 생성 (tier 분류)');
const active = [
    { zone: '울산앞바다', warnType: '풍랑', level: '경보', event: 'active', tmEf: '20260617T2100' },
    { zone: '경북남부앞바다', warnType: '풍랑', level: '주의보', event: 'publish', efTime: '20260617T2100' },
    { zone: '제주도앞바다', warnType: '풍랑', level: '예비', event: 'publish' },
];
// efTime 필드명 호환: buildSnapshot은 rep.efTime 사용 → 위 두번째만 efTime. 첫번째는 tmEf(추출 어댑터용)
const snap = dispatch.buildSnapshot(active.map(w => ({ ...w, efTime: w.efTime || null })));
check('경보 구역 tier=severe', snap.zones['울산앞바다'].tier === 'severe', snap.zones['울산앞바다'].tier);
check('주의보 구역 tier=advisory', snap.zones['경북남부앞바다'].tier === 'advisory', snap.zones['경북남부앞바다'].tier);
check('예비 구역 tier=prelim', snap.zones['제주도앞바다'].tier === 'prelim', snap.zones['제주도앞바다'].tier);
check('스냅샷 generatedAt ISO', /\d{4}-\d{2}-\d{2}T/.test(snap.generatedAt));

console.log('\n[3] 타깃 선택 / 데이터 메시지');
const tokens = dispatch.selectTargetTokens([
    { token: 'x', agreed: true }, { token: 'y', agreed: false }, { token: 'x', agreed: true }, { token: 'z', agreed: true },
]);
check('agreed만 + 중복 제거 → [x,z]', tokens.length === 2 && tokens.includes('x') && tokens.includes('z'), JSON.stringify(tokens));
const msg = dispatch.buildDataMessage(snap);
check('데이터 메시지 type=location_alert_wake', msg.data.type === 'location_alert_wake');
check('snapshot은 문자열(JSON)', typeof msg.data.snapshot === 'string' && JSON.parse(msg.data.snapshot).zones['울산앞바다']);
check('android priority high', msg.android.priority === 'high');

console.log('\n[4] dispatchWake (mock)');
let sentTo = null, sentMsg = null;
const mockSend = async (tk, m) => { sentTo = tk; sentMsg = m; return { ok: true, successCount: tk.length }; };
(async () => {
    const r1 = await dispatch.dispatchWake(active, {
        sendFn: mockSend,
        getConsents: () => [{ token: 'tkB', agreed: true }],
        record: false,
    });
    check('대상 1명 전송', r1.sent === 1 && sentTo[0] === 'tkB', JSON.stringify(r1));
    check('전송 메시지에 스냅샷 포함', sentMsg && sentMsg.data.type === 'location_alert_wake');

    const r2 = await dispatch.dispatchWake([], { sendFn: mockSend, getConsents: () => [{ token: 'tkB', agreed: true }], record: false });
    check('활성 특보 없으면 미전송', r2.sent === 0 && r2.reason === 'no_active_zones', JSON.stringify(r2));

    const r3 = await dispatch.dispatchWake(active, { sendFn: mockSend, getConsents: () => [] });
    check('동의자 없으면 미전송', r3.sent === 0 && r3.reason === 'no_targets', JSON.stringify(r3));

    console.log('\n[5] weather_alerts 실제 트리 구조 추출');
    // 실제 구조: 지역 중첩 트리 + 말단 구역 노드(current/upcoming = 객체|null), 필드 wrnTp/wrnLvl/tmEf/tmCc
    const tree = {
        '동해': {
            '동해남부해상': {
                '동해남부앞바다': {
                    '울산앞바다': {
                        current: { wrnTp: '풍랑', wrnLvl: '경보', tmFc: 'F', tmEf: '20260617T2100', tmCc: '20260618T0600' },
                        upcoming: null, history: [], missingCount: 0,
                        children: { '울산앞바다중연안바다': null },
                    },
                    '경북남부앞바다': {
                        current: null,
                        upcoming: { wrnTp: '풍랑', wrnLvl: '예비', tmFc: 'F', tmEf: '오늘 밤(21~24시)', tmCc: '' },
                        history: [], missingCount: 0, children: {},
                    },
                    '제주도북부앞바다': { // current(주의보)+upcoming(태풍경보 발표예정) 동시
                        current: { wrnTp: '풍랑', wrnLvl: '주의보', tmEf: 'A', tmCc: 'B' },
                        upcoming: { wrnTp: '태풍', wrnLvl: '경보', tmEf: 'C', tmCc: '' },
                        history: [], missingCount: 0, children: {},
                    },
                },
            },
        },
    };
    const ext = dispatch.extractActiveWarnings(tree);
    const ulsan = ext.find(w => w.zone === '울산앞바다' && w.event === 'active');
    const gb = ext.find(w => w.zone === '경북남부앞바다');
    check('current 객체 → 울산 풍랑 경보 active', ulsan && ulsan.level === '경보' && ulsan.event === 'active' && ulsan.warnType === '풍랑', JSON.stringify(ulsan));
    check('upcoming 객체 → 경북 예비 publish', gb && gb.level === '예비' && gb.event === 'publish', JSON.stringify(gb));
    const jeju = ext.filter(w => w.zone === '제주도북부앞바다');
    check('current+upcoming 동시 → 2건', jeju.length === 2, JSON.stringify(jeju));
    const snap2 = dispatch.buildSnapshot(ext);
    check('제주 대표 tier=severe(태풍경보 우선)', snap2.zones['제주도북부앞바다'] && snap2.zones['제주도북부앞바다'].tier === 'severe', snap2.zones['제주도북부앞바다'] && snap2.zones['제주도북부앞바다'].tier);

    try { fs.unlinkSync(TMP); } catch (_) { }
    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    process.exit(fail ? 1 : 0);
})();
