/**
 * ============================================================================
 * 파일명: local_server/scripts/test_disk_usage.js
 * 역할  : 서버 디스크(Fly 볼륨) 사용량 점검(services/disk_usage.js)과 관리자 「저장소」 탭 그리기(admin_collect.js _renderDiskCard·_setStorageBadge)를 고정한다.
 *         2026-11-15 운영 디스크가 꽉 차(ENOSPC — df 974M 중 947M) 23:00 판 브리핑을 저장하지 못한 뒤 사용자 결정:
 *         「외부 저장소」 → 「저장소」, 종류별로 나눠 보이기, 80% 넘으면 관리자 푸시 · 탭 N 뱃지.
 *         실제 디스크·실제 푸시 없이(가짜 statfs·가짜 push·고정 시계·임시 폴더).
 *   A. 사용률 식 — 운영 df 「2.0G 947M 928M 51%」와 같은 값
 *   B. 푸시 규칙 표(행마다 1:1) — 80% 미만 안 보냄 · 넘으면 1통 · 계속 넘어도 다시 안 보냄 · 75~80% 그대로 · 75% 아래로 내려가면 다시 보낼 수 있음 ·
 *      재기 실패는 기록만(푸시 없음) · 푸시가 던져도 다시 보내지 않음 · 서버가 다시 켜져도(상태 파일) 다시 안 보냄 · 깨진 상태 파일은 「안 보냄」으로
 *   C. 종류별 크기 — 이름으로 나눔 · 큰 것부터 · 바로 가기는 따라가지 않음 · 파일 수
 *   D. 화면 — 게이지·경고 줄·마지막 자동 점검(없음·실패)·종류별 펼침·이름 이스케이프 · N 뱃지 켜고 끄기 · 탭 이름 「저장소」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/disk_usage.js · client/js/admin/admin_collect.js(vm 으로 읽음) · client/js/admin/admin.js(탭 이름)
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 실행: node local_server/scripts/test_disk_usage.js
 * ============================================================================
 */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
delete process.env.FLY_ALLOC_ID;
const D = require('../services/disk_usage');
let pass = 0, fail = 0;
async function check(name, fn) { try { await fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + (e && e.message)); } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disk-usage-'));
const MB = 1024 * 1024;
// 가짜 statfs — 사용(used)·쓸 수 있는 남은 양(avail)을 MB 로. 예약 블록 0.
const fakeFs = (box) => () => { const bs = 4096; return { bsize: bs, blocks: Math.round((box.used + box.avail) * MB / bs), bfree: Math.round(box.avail * MB / bs), bavail: Math.round(box.avail * MB / bs) }; };

(async () => {
    await check('[A] 사용률 = 사용 ÷ (사용 + 남은 양), df 처럼 올림 — 운영 df(2026-11-15 증설 뒤 2.0G·947M·928M·51%)와 같은 값 · 예약 블록이 있어도 df 와 같은 식 · 79.01% → 80(독립 검토 3)', () => {
        const k = D.measure('/x', fakeFs({ used: 947, avail: 928 }));
        assert.equal(Math.round(k.pct), 51); assert.equal(Math.round(k.used / MB), 947); assert.equal(Math.round(k.avail / MB), 928);
        // 증설 전(974M 중 947M · Avail 0) → 100%
        assert.equal(D.measure('/x', fakeFs({ used: 947, avail: 0 })).pct, 100);
        // 예약 블록(bfree > bavail): df 는 used ÷ (used + avail)
        const r = D.measure('/x', () => ({ bsize: 1024, blocks: 1000, bfree: 300, bavail: 250 }));
        assert.equal(r.pct, 74, '700 ÷ 950 = 73.7% → df 처럼 74'); assert.equal(r.usable, 950 * 1024);
        assert.equal(D.measure('/x', () => ({ bsize: 1, blocks: 10000, bfree: 1999, bavail: 1999 })).pct, 81, '80.01% → 81');
        assert.equal(D.measure('/x', () => ({ bsize: 1, blocks: 10000, bfree: 2099, bavail: 2099 })).pct, 80, '79.01% → 80 (반올림이면 79 라 뱃지·푸시가 안 떴다)');
    });

    await check('[B] 푸시 규칙 표 — 79% 안 보냄 · 80% 1통 · 90% 다시 안 보냄 · 77% 그대로 · 74% 다시 무장 · 81% 또 1통 · 상태 파일에 남김', async () => {
        const box = { used: 79, avail: 21 }, sent = [], stateFile = path.join(tmp, 'b.json');
        const m = D.createMonitor({ dir: tmp, statfs: fakeFs(box), push: async (t, b, d) => { sent.push({ t, b, d }); return { sent: 1, failed: 0 }; }, clock: () => Date.parse('2026-11-15T23:00:00+09:00'), stateFile });
        let r = await m.check(); assert.equal(sent.length, 0); assert.equal(r.ok, true); assert.equal(r.disk.pct, 79);
        box.used = 80; box.avail = 20; r = await m.check(); assert.equal(sent.length, 1, '80% 에서 1통'); assert.equal(r.pushed, true);
        assert.ok(/80%/.test(sent[0].t) && /저장소/.test(sent[0].b), sent[0].t + ' / ' + sent[0].b); assert.equal(sent[0].d.kind, 'disk_usage');
        assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).alerted, true, '상태 파일에 남김');
        box.used = 90; box.avail = 10; await m.check(); assert.equal(sent.length, 1, '계속 넘어도 다시 안 보냄');
        box.used = 77; box.avail = 23; await m.check(); assert.equal(sent.length, 1); assert.equal(m.summary().alert.alerted, true, '75~80% 는 그대로(오가며 반복 알림 방지)');
        box.used = 74; box.avail = 26; await m.check(); assert.equal(m.summary().alert.alerted, false, '75% 아래 → 다시 보낼 수 있음');
        box.used = 81; box.avail = 19; await m.check(); assert.equal(sent.length, 2, '다시 넘으면 또 1통');
    });

    await check('[B] 서버가 다시 켜져도(같은 상태 파일) 같은 상태로는 다시 안 보냄 · 깨진 상태 파일은 「아직 안 보냄」으로 · 상태 파일을 못 써도(디스크 가득) 이 서버에서는 다시 안 보냄', async () => {
        const box = { used: 85, avail: 15 }, sent = [], stateFile = path.join(tmp, 'c.json'), push = async () => { sent.push(1); return { sent: 1 }; };
        await D.createMonitor({ dir: tmp, statfs: fakeFs(box), push, stateFile }).check(); assert.equal(sent.length, 1);
        await D.createMonitor({ dir: tmp, statfs: fakeFs(box), push, stateFile }).check(); assert.equal(sent.length, 1, '다시 켜진 서버');
        fs.writeFileSync(stateFile, '{'); await D.createMonitor({ dir: tmp, statfs: fakeFs(box), push, stateFile }).check(); assert.equal(sent.length, 2, '깨진 파일 → 보냄');
        const m = D.createMonitor({ dir: tmp, statfs: fakeFs(box), push, stateFile: path.join(tmp, 'no-such-dir', 'x.json') });
        await m.check(); await m.check(); assert.equal(sent.length, 3, '못 써도 메모리 상태로 1통만');
    });

    await check('[B] 재기 실패는 기록만(푸시 없음 · summary 에 error·N 뱃지 · lastCheck ok:false) · 푸시가 던지거나 0건이면 「보냄」으로 적지 않고 다음 점검에 다시(독립 검토 1) · 보내는 중 겹친 점검은 두 번 안 보냄', async () => {
        const sent = [];
        const bad = D.createMonitor({ dir: tmp, statfs: () => { throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' }); }, push: async () => { sent.push(1); }, stateFile: path.join(tmp, 'd.json') });
        const r = await bad.check(); assert.deepStrictEqual([r.ok, r.error], [false, 'EIO']); assert.equal(sent.length, 0);
        const s = bad.summary(); assert.equal(s.disk, null); assert.equal(s.error, 'EIO'); assert.equal(s.warn, true, '못 재면 뱃지를 켠다(「80% 미만」과 구분)'); assert.equal(s.lastCheck.ok, false);
        const box = { used: 95, avail: 5 }; let n = 0, fails = 1;
        const m = D.createMonitor({ dir: tmp, statfs: fakeFs(box), push: async () => { n++; if (fails-- > 0) throw new Error('fcm down'); return { sent: 1 }; }, stateFile: path.join(tmp, 'e.json') });
        assert.equal((await m.check()).pushed, false); assert.equal(m.summary().alert.alerted, false, '던지면 「보냄」 아님');
        assert.equal((await m.check()).pushed, true); assert.equal(n, 2, '다음 점검에 다시 보냄'); assert.equal(m.summary().alert.alerted, true);
        await m.check(); assert.equal(n, 2, '전달된 뒤로는 다시 안 보냄');
        let z0 = 0; const z = D.createMonitor({ dir: tmp, statfs: fakeFs(box), push: async () => { z0++; return { sent: 0, failed: 0 }; }, stateFile: path.join(tmp, 'f.json') });
        assert.equal((await z.check()).pushed, false, '기기 없음(0건) → pushed:false'); assert.equal(z.summary().alert.alerted, false); await z.check(); assert.equal(z0, 2, '0건이면 다음 점검에 다시');
        let release, k = 0; const slow = D.createMonitor({ dir: tmp, statfs: fakeFs(box), push: () => { k++; return new Promise((r) => { release = () => r({ sent: 1 }); }); }, stateFile: path.join(tmp, 'f2.json') });
        const p1 = slow.check(); await slow.check(); release(); await p1; assert.equal(k, 1, '보내는 중 겹친 점검은 두 번 안 보냄');
    });

    await check('[B] summary — warn 은 80% 이상일 때만 · 점검 전이면 lastCheck null · 개발 환경(FLY_ALLOC_ID 없음)에선 start 가 점검을 켜지 않음', () => {
        const box = { used: 80, avail: 20 };
        const m = D.createMonitor({ dir: tmp, statfs: fakeFs(box), push: async () => ({ sent: 1 }), stateFile: path.join(tmp, 'g.json') });
        let s = m.summary(); assert.equal(s.warn, true); assert.equal(s.lastCheck, null); assert.equal(s.warnPct, 80);
        box.used = 79; box.avail = 21; s = m.summary(); assert.equal(s.warn, false);
        assert.equal(m.start(), false);
    });

    await check('[C] 종류별 크기 — data/ 바로 아래 이름으로 나눔 · 큰 종류부터 · 폴더 파일 수 · 바로 가기는 따라가지 않음 · 모르는 이름은 「기타」', () => {
        const d = fs.mkdtempSync(path.join(tmp, 'data-'));
        fs.mkdirSync(path.join(d, 'bathymetry')); for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(d, 'bathymetry', 'lat' + i), Buffer.alloc(200 * 1024));
        fs.mkdirSync(path.join(d, 'station_briefing')); fs.writeFileSync(path.join(d, 'station_briefing', 'state.json'), Buffer.alloc(50 * 1024));
        fs.writeFileSync(path.join(d, 'zone_forecasts.json'), Buffer.alloc(20 * 1024)); fs.writeFileSync(path.join(d, 'mystery.bin'), Buffer.alloc(10 * 1024));
        fs.mkdirSync(path.join(d, 'kakao_relay_log')); fs.symlinkSync(path.join(d, 'bathymetry'), path.join(d, 'kakao_relay_log', 'link'));
        const cats = D.breakdown(d), name = (c) => cats.find((x) => x.category === c);
        assert.equal(cats[0].category, '고정 참조 자료(수심 원본)'); assert.equal(cats[0].items[0].files, 3); assert.ok(cats[0].bytes >= 600 * 1024);
        assert.equal(name('AI 브리핑').items[0].name, 'station_briefing'); assert.equal(name('특보·기상·해양').items[0].name, 'zone_forecasts.json'); assert.equal(name('기타').items[0].name, 'mystery.bin');
        assert.ok(name('카톡 중계').bytes < 100 * 1024, '바로 가기를 따라가 수심 자료를 두 번 세지 않음 — ' + name('카톡 중계').bytes);
        for (let i = 1; i < cats.length; i++) assert.ok(cats[i - 1].bytes >= cats[i].bytes, '큰 종류부터');
        assert.deepStrictEqual([D.categoryOf('.codex'), D.categoryOf('server_logs'), D.categoryOf('risk_forecast'), D.categoryOf('subscriptions.json'), D.categoryOf('x.log')], ['법령·챗봇', '서버 기록(로그)', '위험예측', '사용자·운영', '서버 기록(로그)']);
        const m = D.createMonitor({ dir: d, statfs: fakeFs({ used: 10, avail: 90 }), push: async () => ({}), stateFile: path.join(tmp, 'h.json') });
        assert.ok(Array.isArray(m.snapshot().categories) && m.snapshot().categories.length === cats.length, 'snapshot = summary + 종류별');
    });

    // ── 화면(admin_collect.js 를 vm 으로 — 가짜 document) ──
    const src = fs.readFileSync(path.join(__dirname, '../../client/js/admin/admin_collect.js'), 'utf8');
    const mkEl = () => { const kids = []; return { kids, style: {}, attrs: {}, className: '', textContent: '', setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { kids.push(c); c.parent = this; }, remove() { const p = this.parent; if (p) p.kids.splice(p.kids.indexOf(this), 1); }, querySelector(sel) { return sel === '[data-storage-badge]' ? kids.find((k) => 'data-storage-badge' in k.attrs) || null : null; } }; };
    const tabBtn = mkEl();
    const ctx = { console: { ...console, warn() {} }, CONFIG: { API_BASE: '' }, fetch: () => Promise.reject(new Error('시험')), localStorage: { getItem() { return null; } }, setTimeout, Promise,
        document: { addEventListener() {}, getElementById() { return null; }, querySelector(sel) { return sel === '.admin-main-tab[data-tab="storage"]' ? tabBtn : null; }, createElement: () => mkEl() } };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);

    await check('[D] 서버 디스크 카드 — 게이지·남은 공간·크기 · 80% 이상 경고 줄 · 마지막 자동 점검(성공·실패·없음) · 알림 보낸 기록 · 종류별 펼침 · 이름 이스케이프', () => {
        const disk = { total: 2 * 1024 * MB, used: 947 * MB, avail: 928 * MB, pct: 50.5 };
        const cats = [{ category: '고정 참조 자료(수심 원본)', bytes: 597 * MB, items: [{ name: 'bathymetry', dir: true, bytes: 597 * MB, files: 59 }] }, { category: '기타', bytes: MB, items: [{ name: '<img src=x>.json', dir: false, bytes: MB, files: 1 }] }];
        let h = ctx._renderDiskCard({ warnPct: 80, disk, warn: false, lastCheck: { at: '2026-11-15T23:10:00+09:00', ok: true, disk }, alert: { alerted: false }, categories: cats });
        assert.ok(h.includes('서버 디스크 (Fly 볼륨)') && h.includes('남은 공간') && h.includes('928.0 MB'), '남은 공간');
        assert.ok(!h.includes('data-disk-warn'), '80% 미만이면 경고 줄 없음');
        assert.ok(h.includes('마지막 자동 점검 11-15 23:10 — 50.5%'));
        assert.ok(h.includes('고정 참조 자료(수심 원본)') && h.includes('59개') && h.includes('&lt;img src=x&gt;.json') && !h.includes('<img src=x>'), '종류·파일 수·이스케이프');
        h = ctx._renderDiskCard({ warnPct: 80, disk: { ...disk, pct: 86 }, warn: true, lastCheck: { at: '2026-11-15T23:20:00+09:00', ok: false, error: 'EIO' }, alert: { alerted: true, at: '2026-11-15T23:00:00+09:00', pct: 86 }, categories: [] });
        assert.ok(h.includes('data-disk-warn') && h.includes('80% 이상 사용 중'), '경고 줄'); assert.ok(h.includes('23:20 실패 — EIO'), '점검 실패는 실패로'); assert.ok(h.includes('80% 넘음 알림 보냄 11-15 23:00(86%)'));
        h = ctx._renderDiskCard({ warnPct: 80, disk, warn: false, lastCheck: null, alert: { alerted: false }, categories: [] });
        assert.ok(h.includes('자동 점검 기록 없음'), '점검 전은 「없음」 — 0 이나 정상처럼 보이지 않게');
        h = ctx._renderDiskCard({ warnPct: 80, disk: null, error: 'EIO', lastCheck: null, categories: [] });
        assert.ok(h.includes('디스크를 재지 못했습니다: EIO'));
        h = ctx._renderDiskCard({ warnPct: 80, disk: { ...disk, pct: 86 }, warn: true, lastCheck: { at: '2026-11-15T23:30:00+09:00', ok: true, disk, pushed: false }, alert: { alerted: false }, categories: [] });
        assert.ok(h.includes('data-disk-push-fail') && h.includes('알림을 보내지 못했습니다') && !h.includes('알림 보냄'), '전달 0건은 「보냄」이 아니라 실패로(독립 검토 1)');
        assert.ok(h.includes('쓸 수 있는 크기') && h.includes('예약분 뺌'), '게이지 분모와 같은 수(독립 검토 4)');
    });

    await check('[D] 「저장소」 탭 N 뱃지 — 80% 이상이면 붙고(한 번만) 내려가면 떨어짐 · 탭 이름은 「저장소」(옛 「외부 저장소」 아님)', () => {
        ctx._setStorageBadge(true); ctx._setStorageBadge(true);
        const badges = tabBtn.kids.filter((k) => 'data-storage-badge' in k.attrs); assert.equal(badges.length, 1); assert.equal(badges[0].textContent, 'N'); assert.equal(badges[0].className, 'new-badge');
        ctx._setStorageBadge(false); assert.equal(tabBtn.kids.filter((k) => 'data-storage-badge' in k.attrs).length, 0);
        const adminSrc = fs.readFileSync(path.join(__dirname, '../../client/js/admin/admin.js'), 'utf8');
        assert.ok(/\{ id: 'storage', name: '저장소'/.test(adminSrc) && !/name: '외부 저장소'/.test(adminSrc), '탭 이름');
        assert.ok(/refreshStorageBadge\(\)/.test(adminSrc), '관리자 센터를 열 때 뱃지를 맞춘다');
    });

    console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail ? 1 : 0);
})();
