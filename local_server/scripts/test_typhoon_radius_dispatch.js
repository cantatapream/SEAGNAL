/**
 * test_typhoon_radius_dispatch.js — 위치기반 태풍 반경 알림: 서버 디스패치 검증
 * 실행: node local_server/scripts/test_typhoon_radius_dispatch.js
 *
 * 순수 윈도/dedup 헬퍼(slotOfTmFc/kstDateOfTmFc/dedupKey) + selectTargetTokens +
 * dispatchTyphoon(주입 mock, lastKey 주입으로 파일 무접촉) + baseline(임시 파일) 검증.
 * FCM 미사용(sendFn mock). 상태파일은 dispatchTyphoon 에 lastKey 를 주입해 회피하고,
 * baseline 테스트만 실제 data 파일을 백업/복원하며 사용.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const D = require('../services/typhoon_radius_dispatch');

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name} ${extra || ''}`); }
}

// ── [1] slotOfTmFc ──────────────────────────────────────────────────────────
console.log('[1] slotOfTmFc (KST hour 윈도)');
check('10:00 → morning', D.slotOfTmFc('202606261000') === 'morning');
check('10:59 → morning', D.slotOfTmFc('202606261059') === 'morning');
check('11:00 → null',    D.slotOfTmFc('202606261100') === null);
check('09:59 → null',    D.slotOfTmFc('202606260959') === null);
check('22:00 → night',   D.slotOfTmFc('202606262200') === 'night');
check('22:30 → night',   D.slotOfTmFc('202606262230') === 'night');
check('23:00 → null',    D.slotOfTmFc('202606262300') === null);
check('04:30 → null',    D.slotOfTmFc('202606260430') === null);
check('16:30 → null',    D.slotOfTmFc('202606261630') === null);
check('빈/짧은 입력 → null', D.slotOfTmFc('2026') === null && D.slotOfTmFc('') === null && D.slotOfTmFc(null) === null);
// tmFc 는 KST 문자열 그대로 해석(UTC 변환 없음): 22:00 KST 슬롯이 night 임을 확인(경계 의미 검증).
check('KST 문자열 경계: 2200 KST = night', D.slotOfTmFc('202612312200') === 'night');

// ── [2] kstDateOfTmFc / dedupKey ────────────────────────────────────────────
console.log('\n[2] kstDateOfTmFc / dedupKey');
check('kstDate 추출', D.kstDateOfTmFc('202606261059') === '20260626');
check('kstDate 짧은입력 null', D.kstDateOfTmFc('20260626') === null);
check('dedupKey morning', D.dedupKey('202606261059') === '20260626-morning');
check('dedupKey night', D.dedupKey('202606262200') === '20260626-night');
check('dedupKey 윈도밖 → null', D.dedupKey('202606261600') === null);

// ── [3] selectTargetTokens ──────────────────────────────────────────────────
console.log('\n[3] selectTargetTokens');
check('agreed=true dedup', JSON.stringify(D.selectTargetTokens([
    { token: 'a', agreed: true }, { token: 'a', agreed: true }, { token: 'b', agreed: true },
])) === JSON.stringify(['a', 'b']));
check('agreed=false 제외', JSON.stringify(D.selectTargetTokens([
    { token: 'a', agreed: false }, { token: 'b', agreed: true },
])) === JSON.stringify(['b']));
check('빈 입력 → []', JSON.stringify(D.selectTargetTokens([])) === '[]' && JSON.stringify(D.selectTargetTokens(null)) === '[]');
check('token 없으면 제외', JSON.stringify(D.selectTargetTokens([{ agreed: true }])) === '[]');

// ── [4] dispatchTyphoon (주입 mock + lastKey 로 파일 무접촉) ─────────────────
console.log('\n[4] dispatchTyphoon (mock 주입)');
function consents() { return [{ token: 'tk1', agreed: true }, { token: 'tk2', agreed: true }]; }
function mkJson(tmFc) { return { typhoons: [{ seq: '6', name: '장미', latestTmFc: tmFc, bulletins: [{ code: '1_x_6_1', isLatest: true }] }] }; }

(async () => {
    // 트리거: morning 윈도 + lastKey 다름 → 발송.
    let calls = [];
    const sendFn = async (tokens, message) => { calls.push({ tokens, message }); return { ok: true, successCount: tokens.length }; };
    let r = await D.dispatchTyphoon(mkJson('202606261059'), { sendFn, getConsents: consents, record: false, lastKey: '20260625-night' });
    check('윈도 안 + 새 키 → 발송', r.reason === 'sent' && r.sent === 2, JSON.stringify(r));
    check('발송 메시지 type', calls.length === 1 && calls[0].message.data.type === 'typhoon_radius_wake');
    check('sig = dedupKey', calls[0].message.data.sig === '20260626-morning', calls[0].message.data.sig);
    check('android high priority', calls[0].message.android.priority === 'high');

    // 같은 슬롯/날(=같은 키) → 재발송 skip.
    calls = [];
    r = await D.dispatchTyphoon(mkJson('202606261059'), { sendFn, getConsents: consents, record: false, lastKey: '20260626-morning' });
    check('같은 키 → already_sent(미발송)', r.reason === 'already_sent' && r.sent === 0 && calls.length === 0, JSON.stringify(r));

    // 같은 날 다른 슬롯(night) → 새 키 → 발송.
    calls = [];
    r = await D.dispatchTyphoon(mkJson('202606262200'), { sendFn, getConsents: consents, record: false, lastKey: '20260626-morning' });
    check('같은 날 night 슬롯 → 발송', r.reason === 'sent' && r.sent === 2 && r.slot === 'night', JSON.stringify(r));

    // 윈도 밖(16시) → no_window.
    calls = [];
    r = await D.dispatchTyphoon(mkJson('202606261600'), { sendFn, getConsents: consents, record: false, lastKey: '' });
    check('윈도 밖 → no_window(미발송)', r.reason === 'no_window' && calls.length === 0, JSON.stringify(r));

    // 활성 0 → no_active.
    r = await D.dispatchTyphoon({ typhoons: [] }, { sendFn, getConsents: consents, record: false, lastKey: '' });
    check('활성 0 → no_active', r.reason === 'no_active' && r.sent === 0);
    r = await D.dispatchTyphoon(null, { sendFn, getConsents: consents, record: false, lastKey: '' });
    check('null json → no_active', r.reason === 'no_active');

    // 동의자 0 → no_targets (dedupKey 갱신 안 함 의미 — 여기선 lastKey 주입이라 파일 무접촉).
    calls = [];
    r = await D.dispatchTyphoon(mkJson('202606261059'), { sendFn, getConsents: () => [], record: false, lastKey: 'x' });
    check('동의자 0 → no_targets(미발송)', r.reason === 'no_targets' && r.sent === 0 && calls.length === 0, JSON.stringify(r));

    // 복수 태풍 같은 슬롯 → 단일 키 → 1회 발송(토큰 전체).
    calls = [];
    const multi = { typhoons: [
        { seq: '6', name: '장미', latestTmFc: '202606261005', bulletins: [{ code: 'c1', isLatest: true }] },
        { seq: '7', name: '쁘라삐룬', latestTmFc: '202606261050', bulletins: [{ code: 'c2', isLatest: true }] },
    ] };
    r = await D.dispatchTyphoon(multi, { sendFn, getConsents: consents, record: false, lastKey: '' });
    check('복수 태풍 동일 슬롯 → 1회 발송', r.reason === 'sent' && calls.length === 1 && r.dedupKey === '20260626-morning', JSON.stringify(r));

    // record:false 시 이력 미기록 / record:true 시 기록 — 실제 history 파일 백업/복원으로 확인.
    const HIST = path.join(path.dirname(D._SIG_FILE), 'custom_push_history.json');
    const bH = (function () { try { return fs.existsSync(HIST) ? fs.readFileSync(HIST, 'utf8') : null; } catch (_) { return null; } })();
    try {
        try { if (fs.existsSync(HIST)) fs.unlinkSync(HIST); } catch (_) { }
        await D.dispatchTyphoon(mkJson('202606261059'), { sendFn, getConsents: consents, record: false, lastKey: '' });
        check('record:false → 이력 파일 미생성', !fs.existsSync(HIST));
        await D.dispatchTyphoon(mkJson('202606261059'), { sendFn, getConsents: consents, record: true, lastKey: '' });
        let entries = [];
        try { entries = JSON.parse(fs.readFileSync(HIST, 'utf8')); } catch (_) { }
        check('record:true → 이력 1건 tab:typhoon', Array.isArray(entries) && entries.length >= 1 && entries[0].tab === 'typhoon', JSON.stringify(entries[0] || null));
    } finally {
        try { if (bH === null) { if (fs.existsSync(HIST)) fs.unlinkSync(HIST); } else fs.writeFileSync(HIST, bH); } catch (_) { }
    }

    // ── [5] baseline-on-empty-state (실제 data 파일 백업/복원) ──────────────
    console.log('\n[5] dispatchTyphoonOnLatest baseline (empty state)');
    const TYPHOON_FILE = D._TYPHOON_FILE, SIG_FILE = D._SIG_FILE;
    function backup(p) { try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; } catch (_) { return null; } }
    function restore(p, v) { try { if (v === null) { if (fs.existsSync(p)) fs.unlinkSync(p); } else fs.writeFileSync(p, v); } catch (_) { } }
    const bT = backup(TYPHOON_FILE), bS = backup(SIG_FILE);
    try {
        fs.mkdirSync(path.dirname(TYPHOON_FILE), { recursive: true });
        // 빈 상태(sig 파일 없음) + 윈도 안 활성 태풍 → baseline 만 기록(발송 X).
        try { fs.unlinkSync(SIG_FILE); } catch (_) { }
        fs.writeFileSync(TYPHOON_FILE, JSON.stringify(mkJson('202606261059')));
        let sent = false;
        const r5 = await D.dispatchTyphoonOnLatest({ sendFn: async () => { sent = true; return { ok: true, successCount: 1 }; }, getConsents: consents });
        check('빈 상태 → baseline(미발송)', r5.reason === 'baseline' && sent === false, JSON.stringify(r5));
        check('baseline 후 sig 파일 기록됨', fs.existsSync(SIG_FILE));
        // 같은 키 상태로 다시 호출 → already_sent.
        const r6 = await D.dispatchTyphoonOnLatest({ sendFn: async () => { sent = true; return { ok: true, successCount: 1 }; }, getConsents: consents, record: false });
        check('baseline 후 같은 키 → already_sent', r6.reason === 'already_sent', JSON.stringify(r6));
        // 파일 없음 → no_file.
        try { fs.unlinkSync(TYPHOON_FILE); } catch (_) { }
        const r7 = await D.dispatchTyphoonOnLatest({ sendFn: async () => ({ ok: true }), getConsents: consents });
        check('typhoon.json 없음 → no_file', r7.reason === 'no_file', JSON.stringify(r7));
    } finally {
        restore(TYPHOON_FILE, bT);
        restore(SIG_FILE, bS);
    }

    console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
    process.exit(fail ? 1 : 0);
})();
