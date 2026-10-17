/**
 * 파일명: local_server/scripts/test_sea_traffic_profile.js
 * 역할  : 관할 브리핑 해역별 「최근 14일 선박 동향」 계산(services/sea_traffic_profile.js)을 검사한다.
 *         14일 채우기·특보 시간 빼기·3시간 묶음 무효·수집 실패와 0척 구분·하루 평균 1척 미만 숨김·가장 많은 시간대 조건·KST 자정·디스크 읽기·캐시.
 *         사용자(브리핑 선박 동향 대화): 「12일 이상 값이 있는 경우 기준 좋아. 특보 뺴고 좋아.」 「가로 하자. … 그냥 최근 14일로 하자., 그리고 평균 1척 미만으로 가자.」
 *         「그 시간만 빼야하겠고, 예비특보는 빼지말아.」 「육상특보는 넣지마.」 「위험예보칸만 있고, 선박 칸이 없는 먼바다 해역은 아예 빼.」
 * [연계] services/sea_traffic_profile.js · services/sea_traffic_history.js(dayRows — 디스크 읽기 시험) · scripts/refactor/verify_all.sh SUITES
 * [로드 순서] 독립 Node 실행 — 네트워크 없음, 임시 폴더만 쓴다. 시계는 전부 주입(현재 시각에 기대지 않는다).
 */
'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const io = require('../services/risk_collector_io'), H = require('../services/sea_traffic_history'), P = require('../services/sea_traffic_profile');
let pass = 0, fail = 0;
function check(name, fn) { try { fn(); pass++; console.log('✅ ' + name); } catch (e) { fail++; console.log('❌ ' + name + ' — ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); } }
const DAY = 86400000, K = (s) => Date.parse(s + '+09:00');
const NOW = K('2026-10-18T10:00:00');                       // 어제 = 10-17, 14일 = 10-04~10-17, 42일 전 = 09-06
const back = (k, now = NOW) => io.day(now - k * DAY);
const box = (w, s, e, n) => ({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
// 칸 A·B 는 해역 상자 안(중심), C 는 상자 밖, D 는 상자에 겹치지만 중심이 밖
const CELLS = [{ id: 'GR4_A', lon: 126.5125, lat: 33.5125 }, { id: 'GR4_B', lon: 126.5375, lat: 33.5375 }, { id: 'GR4_C', lon: 126.6125, lat: 33.5125 }, { id: 'GR4_D', lon: 126.5625, lat: 33.5125 }];
const ZONES = ['제주도북부앞바다', '제주도북부연안바다'];
const R1 = { key: 'A:1', geometry: box(126.5, 33.5, 126.55, 33.55), zones: ZONES };
const FAR = { key: 'A:far', geometry: box(124.0, 32.0, 124.05, 32.05), zones: ['제주도남쪽바깥먼바다'] };
/** 가짜 기록: f(date, s) → {칸:척수} | null(그 30분 수집 실패) — dayRows 꼴로 돌려준다. */
function fake(f, { first = '2026-08-01', last = '2026-10-18' } = {}) {
    const log = [];
    return {
        log, readDay(date) {
            log.push(date);
            if (date < first || date > last) return null;
            const ids = [], pos = new Map(), slots = [];
            for (let s = 0; s < 48; s++) {
                const row = f(date, s); if (!row) continue;
                const idx = [], tenths = [];
                for (const [id, v] of Object.entries(row)) { if (!pos.has(id)) { pos.set(id, ids.length); ids.push(id); } idx.push(pos.get(id)); tenths.push(Math.round(v * 10)); }
                slots.push({ s, n: 6, idx, tenths });
            }
            return { date, ids, slots };
        }
    };
}
const iv = (zone, type, level, start, end) => ({ zone, type, level, start: start + '+09:00', end: end ? end + '+09:00' : null });
function make(f, { warnings = [], clock = () => NOW, first, last, cells = CELLS } = {}) {
    const fk = fake(f, { first, last }), seen = [];
    const p = P.createProfile({ cells: () => cells, readDay: fk.readDay, warnings: (q) => { seen.push(q); return { intervals: warnings }; }, clock });
    return { p, fk, seen, one: (r = R1) => p.profiles([r]).get(r.key) };
}
const flat = (v) => () => ({ 'GR4_A': v });

check('14일 충분 — 해역 안 칸만 더한다(중심이 밖인 칸 제외) · 결과 모양', () => {
    const { one, fk } = make(() => ({ 'GR4_A': 3, 'GR4_B': 2, 'GR4_C': 50, 'GR4_D': 50 }));
    const r = one();
    assert.equal(r.days, 14); assert.equal(r.oldest, back(14)); assert.equal(r.oldest, '2026-10-04');
    assert.equal(r.dailyAvg, 5); assert.equal(r.cells, 2); assert.equal(r.peak, null);
    assert.equal(r.blocks.length, 8);
    assert.deepEqual(r.blocks[0], { from: '00', to: '03', avg: 5 }); assert.deepEqual(r.blocks[7], { from: '21', to: '24', avg: 5 });
    assert.deepEqual(fk.log, Array.from({ length: 14 }, (_, k) => back(k + 1)));     // 어제부터 14일만 읽었다(오늘은 읽지 않음)
});
check('14일 부족 → null (42일 안에 13일뿐)', () => {
    const { one } = make(flat(3), { first: back(13), last: back(1) });
    assert.equal(one(), null);
});
check('42일 한도 경계 — 42일 전은 쓰고 43일 전은 안 쓴다', () => {
    const ok = make((d) => (d === back(42) || d >= back(13) ? { 'GR4_A': 3 } : null));
    assert.equal(ok.one().oldest, back(42)); assert.equal(back(42), '2026-09-06');
    const no = make((d) => (d === back(43) || d >= back(13) ? { 'GR4_A': 3 } : null));
    assert.equal(no.one(), null);
    assert.equal(no.fk.log.length, 42); assert.ok(!no.fk.log.includes(back(43)));
});
check('특보 시간만 빼고 거슬러 간다 — 5일 내내 풍랑주의보면 19일 전까지 · 특보 중 값은 평균에 안 들어간다', () => {
    const warn = [iv('제주도북부앞바다', '풍랑', '주의보', back(5) + 'T00:00:00', back(0) + 'T00:00:00')];
    const { one, seen } = make((d) => ({ 'GR4_A': d >= back(5) ? 100 : 4 }), { warnings: warn });
    const r = one();
    assert.equal(r.oldest, back(19)); assert.equal(r.oldest, '2026-09-29');
    assert.equal(r.dailyAvg, 4);
    assert.deepEqual(seen[0].zones, ZONES);                                         // 해역의 본구역·세부구역 둘 다 묻는다
});
check('특보는 그 30분만 뺀다 — 06:00~07:10 경보(세부구역·표기 차이)면 06:00·06:30·07:00 세 칸만 빠지고 묶음은 유효', () => {
    // 10-17 의 06~09 묶음: 06:00 10척 · 06:30 10 · 07:00 10 · 07:30 1 · 08:00 2 · 08:30 3 → 특보 뺀 평균 (1+2+3)/3 = 2
    const vals = [10, 10, 10, 1, 2, 3];
    const warn = [iv('제주도 북부 연안바다', '태풍', '경보', back(1) + 'T06:00:00', back(1) + 'T07:10:00')];
    const { one } = make((d, s) => ({ 'GR4_A': d === back(1) && s >= 12 && s < 18 ? vals[s - 12] : 2 }), { warnings: warn });
    const r = one();
    assert.equal(r.oldest, back(14));                                               // 그날 그 묶음은 무효가 아니다(3칸 남음)
    assert.equal(r.blocks[2].avg, 2);
});
check('발효 중(해제 전, end=null) 특보는 지금까지 뺀다', () => {
    const warn = [iv('제주도북부앞바다', '풍랑', '경보', back(2) + 'T12:00:00', null)];
    const { one } = make(flat(3), { warnings: warn });
    const r = one();
    assert.equal(r.blocks[0].avg, 3);
    assert.equal(r.oldest, back(16));                                               // 오후 묶음은 10-16·10-17 무효 → 16일 전까지
});
check('예비특보·육상특보·강풍은 빼지 않는다 · 다른 구역 특보도 빼지 않는다', () => {
    const all = (zone, type, level) => iv(zone, type, level, back(30) + 'T00:00:00', back(0) + 'T00:00:00');
    const warn = [all('제주도북부앞바다', '풍랑', '예비'), all('제주도북부앞바다', '풍랑', '예비특보'), all('제주도산지', '강풍', '주의보'),
        all('제주도북부', '풍랑', '주의보'), all('제주도북부앞바다', '강풍', '주의보'), all('제주도남부앞바다', '풍랑', '경보')];
    const { one } = make(flat(3), { warnings: warn });
    assert.equal(one().oldest, back(14));
});
check('6칸 중 3칸 미만이면 그날 그 묶음 무효 · 정확히 3칸이면 유효', () => {
    // 10-17: 00~03 묶음은 2칸만 수집(무효) · 03~06 묶음은 3칸 수집(유효)
    const { one } = make((d, s) => (d === back(1) && ((s < 6 && s >= 2) || (s >= 6 && s < 9)) ? null : { 'GR4_A': 3 }));
    const r = one();
    assert.equal(r.oldest, back(15));                                               // 00~03 묶음만 하루 더 거슬러 간다
    assert.equal(r.dailyAvg, 3);
});
check('수집 실패(그 30분 null)는 빼고, 응답은 받았는데 칸이 없으면 0척', () => {
    // 매일 03~06 묶음: 6·7·8 칸 6척, 9·10 칸 응답에 A 없음(0척), 11 칸 수집 실패 → (6+6+6+0+0)/5 = 3.6
    //   (실패를 0척으로 넣었으면 18/6 = 3.0, 칸 없음을 실패처럼 뺐으면 18/3 = 6.0)
    const f = (tail) => (d, s) => (s < 6 || s >= 12 || s <= 8 ? { 'GR4_A': 6 } : s <= 10 ? { 'GR4_C': 9 } : tail);
    assert.equal(make(f(null)).one().blocks[1].avg, 3.6);
    assert.equal(make(f({ 'GR4_C': 9 })).one().blocks[1].avg, 3);                  // 11 칸도 응답은 받았고 A 가 없음 → 0척
});
check('하루 평균 1척 미만이면 null · 1.0 이면 보인다', () => {
    assert.equal(make(flat(0.9)).one(), null);
    assert.equal(make(flat(1)).one().dailyAvg, 1);
});
check('칸 0개(위험예보 칸만 있는 먼바다) → null, 날짜 기록도 읽지 않는다', () => {
    const { one, fk } = make(flat(3));
    assert.equal(one(FAR), null);
    assert.equal(fk.log.length, 0);
});
const blockDays = (vals) => (d, s) => ({ 'GR4_A': vals[Math.floor(s / 6)] });
check('가장 많은 시간대: 7.0척 이상 그리고 하루 평균 × 1.5 이상 — 경계값 포함', () => {
    let r = make(blockDays([4.5, 4.5, 7.5, 4.5, 4.5, 4.5, 4.5, 5.5])).one();       // 하루 5.0 · 7.5 = 1.5배 정확히
    assert.equal(r.dailyAvg, 5); assert.deepEqual(r.peak, { from: '06', to: '09', avg: 7.5 });
    r = make(blockDays([4.5, 4.5, 7.5, 4.5, 4.5, 4.5, 4.5, 6.3])).one();            // 하루 5.1 · 1.5배 = 7.65 > 7.5
    assert.equal(r.dailyAvg, 5.1); assert.equal(r.peak, null);
    r = make(blockDays([3.5, 3.5, 3.5, 7, 3.5, 3.5, 3.5, 4])).one();                 // 7.0 정확히 · 하루 4.0
    assert.deepEqual(r.peak, { from: '09', to: '12', avg: 7 });
    r = make(blockDays([3.5, 3.5, 3.5, 6.9, 3.5, 3.5, 3.5, 4])).one();               // 6.9 < 7
    assert.equal(r.peak, null);
});
check('가장 많은 시간대 동률이면 이른 시각', () => {
    const r = make(blockDays([2, 8, 2, 2, 2, 8, 2, 2])).one();
    assert.deepEqual(r.peak, { from: '03', to: '06', avg: 8 });
});
check('KST 자정 경계 — 23:59:59 에는 어제가 10-16, 00:00 에는 10-17 · 오늘은 읽지 않는다 · 날짜가 바뀌면 다시 계산', () => {
    let now = K('2026-10-17T23:59:59');
    const { p, fk } = make((d) => ({ 'GR4_A': d === '2026-10-17' ? 17 : 3 }), { clock: () => now });
    let r = p.profiles([R1]).get('A:1');
    assert.equal(r.oldest, '2026-10-03'); assert.equal(r.dailyAvg, 3);
    assert.ok(!fk.log.includes('2026-10-17'));
    now = K('2026-10-18T00:00:00');
    r = p.profiles([R1]).get('A:1');
    assert.equal(r.oldest, '2026-10-04'); assert.equal(r.dailyAvg, 4);               // (13×3 + 17)/14 = 4
    assert.ok(!fk.log.includes('2026-10-18'));
});
check('캐시 — 같은 날 다시 물으면 읽지 않는다 · 새 해역만 그 날짜를 다시 읽는다 · 다음 날은 새 어제 하루만 읽는다', () => {
    let now = NOW;
    const { p, fk } = make(flat(3), { clock: () => now });
    p.profiles([R1]);
    assert.equal(fk.log.length, 14);
    p.profiles([R1]);
    assert.equal(fk.log.length, 14);
    const R2 = { key: 'T:GR4_C', geometry: box(126.6, 33.5, 126.625, 33.525), zones: ZONES };
    const out = p.profiles([R1, R2]);
    assert.equal(fk.log.length, 28); assert.equal(out.get('T:GR4_C'), null);         // C 칸은 기록에 없음 → 매일 0척 → 하루 평균 0 → null
    now += DAY;
    const r = p.profiles([R1, R2]).get('A:1');
    assert.equal(fk.log.length, 29); assert.equal(fk.log[28], '2026-10-18');
    assert.equal(r.oldest, '2026-10-05');
    now += 50 * DAY; p.profiles([R1]);
    assert.ok(p._stats().cachedDays <= 42 + 1);                                      // 42일보다 오래된 날짜 합계는 버린다
});
check('칸 위치표가 비어 있으면 null 을 주되 캐시하지 않는다(다음 호출에서 다시)', () => {
    let cells = [];
    const fk = fake(flat(3));
    const p = P.createProfile({ cells: () => cells, readDay: fk.readDay, warnings: () => ({ intervals: [] }), clock: () => NOW });
    assert.equal(p.profiles([R1]).get('A:1'), null);
    cells = CELLS;
    assert.equal(p.profiles([R1]).get('A:1').dailyAvg, 3);
});
check('디스크에서 읽기 — 메모리(15일) 밖 날짜는 날짜 파일을 읽기만 하고 메모리에 올리지 않는다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-profile-'));
    // 10-17 부터 30일치 날짜 파일(v2): 칸 A, 30분마다 값 = 날짜 일(日) 숫자(10-17 → 17)·표본 6
    for (let k = 1; k <= 30; k++) {
        const date = back(k), v = Number(date.slice(8, 10));
        io.write(path.join(dir, 'traffic_history', date + '.json.gz'), { v: 2, date, stepMinutes: 30, ids: ['GR4_Z', 'GR4_A'], slots: Array.from({ length: 48 }, (_, s) => ({ s, n: 6, c: [null, v] })) });
    }
    const h = H.createHistory({ dir, clock: () => NOW });
    const mem = h.dayRows(back(3)), disk = h.dayRows(back(20));
    assert.equal(mem.ids[mem.slots[0].idx[0]], 'GR4_A'); assert.equal(mem.slots[0].tenths[0], 150);
    assert.equal(disk.ids[disk.slots[0].idx[0]], 'GR4_A'); assert.equal(disk.slots[0].tenths[0], Number(back(20).slice(8, 10)) * 10);
    assert.equal(disk.slots.length, 48); assert.equal(disk.slots[0].n, 6);
    assert.equal(h.dayRows('2026-01-01'), null);
    // 10일 내내 특보 → 24일 전(09-24)까지 — 15일 전부터는 디스크
    const warn = [iv('제주도북부앞바다', '풍랑', '주의보', back(10) + 'T00:00:00', back(0) + 'T00:00:00')];
    const p = P.createProfile({ cells: () => CELLS, readDay: h.dayRows, warnings: () => ({ intervals: warn }), clock: () => NOW });
    const r = p.profiles([R1]).get('A:1');
    assert.equal(r.oldest, back(24));
    const days = Array.from({ length: 14 }, (_, k) => Number(back(k + 11).slice(8, 10)));
    assert.equal(r.dailyAvg, Math.round(days.reduce((a, b) => a + b, 0) / 14 * 10) / 10);
    assert.ok(!h._memory().days.includes(back(24)));                               // 메모리는 15일 그대로
});

console.log(`${pass} PASS / ${fail} FAIL`);
if (fail) process.exitCode = 1;
