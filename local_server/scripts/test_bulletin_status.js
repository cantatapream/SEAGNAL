/**
 * 통보문 기준 특보현황(services/bulletin_status) 검사.
 * 실행: node local_server/scripts/test_bulletin_status.js
 * 사용자 확정 2026-11-15: 통보문 기준 특보현황 — 부모 이름만 = 자식 포함, 예비 시간창 끝 뒤 10분 대기(목록에서 빠질 때는 대기 없음),
 *   3일 전 통보문부터. 결과는 /api/weather-alerts 와 같은 나무.
 * 대기 중(예비 시간창 끝 ~ 10분) 일어날 수 있는 일: 정식 특보가 옴 · 다음 예비 목록에 연장돼 다시 옴 · 「풍랑예비특보 해제」 통보문 · 아무 글 없음.
 * 실제 자료 되풀이 검산(2026-11): 각 특보 통보문 시각에 3일 안 통보문만으로 계산 → 그 통보문의 발효 중 칸(부모)과 같아야 한다.
 * 시각은 고정값만 쓴다.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const S = require('../services/bulletin_status');
const { parseCurrent, parseItems, PARENTS } = require('../analysis/bulletin_survey/lifecycle_check');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };
const K = (s) => Date.parse(s.replace(' ', 'T') + '+09:00');
const W = (ho, tmIn, o) => ({ office: '제주청', rpt: '6', result: Object.assign({ t1Title: ho, tmFc: tmIn + ':00.0', tmIn: tmIn + ':30.0', t1: '', t2: '', t3: '', t4: '', t6: 'o 없음', t7: 'o 없음' }, o) });
const Y = (ho, tmIn, t4) => ({ office: '제주청', rpt: '7', result: { t1Title: ho, tmFc: tmIn + ':00.0', tmIn: tmIn + ':30.0', t4, t5: '', other: 'o 없음' } });

console.log('A. 정식 특보');
{
    const list = [
        W('제11-1호', '2026-11-14 10:00', { t1: '풍랑주의보 발표', t2: '(1) 풍랑주의보 발표 : 제주도앞바다(제주도서부앞바다)\n o 제주도서부앞바다(북서연안바다 제외)', t3: '(1) 풍랑주의보 발표 : 2026년 11월 14일 13시 00분', t4: '(1) 풍랑주의보 발표\n  o 해제 예고: 16일 늦은 오후(15시~18시)', t6: 'o 풍랑주의보 : 제주도앞바다(제주도서부앞바다)' }),
    ];
    const z = S.compute(list, K('2026-11-14 12:00')).zones;
    ok('첫 통보문: 발효 중 칸 + 변경 칸 → 부모 주의보', z['제주도서부앞바다'] && z['제주도서부앞바다'].kind === 'formal' && z['제주도서부앞바다'].level === '주의보');
    ok('부모 이름만 = 자식 포함, 괄호 「제외」는 뺌', z['제주도서부앞바다중남서연안바다'] && !z['제주도서부앞바다중북서연안바다']);
    ok('발효 시각(t3)·해제 예고(t4)·발표 시각을 MMIS 꼴로', z['제주도서부앞바다'].tmEf === '2026년 11월 14일 13시 00분' && z['제주도서부앞바다'].clr === '16일 늦은 오후(15시~18시)' && z['제주도서부앞바다'].tmFc === '2026년 11월 14일 10시 00분');
    list.push(W('제11-2호', '2026-11-15 09:00', { t1: '풍랑경보 변경', t2: '(1) 풍랑경보 변경 : 제주도서부앞바다', t3: '(1) 풍랑경보 변경 : 2026년 11월 15일 10시 00분', t4: '(1) 풍랑경보 변경\n  o 해제 예고: 17일 오전(09시~12시)' }));
    list.push(W('제11-3호', '2026-11-15 15:00', { t1: '풍랑경보 해제예고연장', t2: '(1) 풍랑경보 해제예고연장 : 제주도서부앞바다', t4: '(1) 풍랑경보 해제예고연장\n  o 해제 예고: 18일 오전(09시~12시)' }));
    const z2 = S.compute(list, K('2026-11-15 16:00')).zones;
    ok('변경 → 경보, 해제예고연장 → 해제 예고만 바뀜(등급 그대로)', z2['제주도서부앞바다'].level === '경보' && z2['제주도서부앞바다'].clr === '18일 오전(09시~12시)');
    list.push(W('제11-4호', '2026-11-16 09:00', { t1: '풍랑경보 해제', t2: '(1) 풍랑경보 해제 : 제주도서부앞바다' }));
    ok('해제 → 없음(자식 포함)', !Object.keys(S.compute(list, K('2026-11-16 10:00')).zones).length);
}

console.log('A1. 해제는 해제 시각이 되어야 지움 — 사용자 확정 2026-11-16 「해당 시간이 도래해야 지우는거야」 · 범위 끝 뒤 후속 없으면 유지(「가」)');
{
    // 실제 대구 2026 11-24호(발표) → 11-25호(21:57 입력, 해제 시각 23:00)
    const D = (ho, tmIn, o) => ({ office: '대구청', rpt: '6', result: Object.assign({ t1Title: ho, tmFc: tmIn + ':00.0', tmIn: tmIn + ':30.0', t1: '', t2: '', t3: '', t4: '', t6: 'o 없음', t7: 'o 없음' }, o) });
    const w24 = D('제11-24호', '2026-11-15 12:31', { t2: '(1) 풍랑주의보 발표 : 동해남부앞바다(경북북부앞바다)', t3: '(1) 풍랑주의보 발표 : 2026년 11월 15일 13시 30분', t4: '(1) 풍랑주의보 발표\n  o 해제 예고: 17일 오전(09시~12시)' });
    const w25 = D('제11-25호', '2026-11-15 21:57', { t1: '풍랑주의보 해제', t2: '(1) 풍랑주의보 해제 : 동해남부앞바다(경북북부앞바다)', t3: '(1) 풍랑주의보 해제 : 2026년 11월 15일 23시 00분', t6: 'o 풍랑주의보 : 동해남부북쪽안쪽먼바다' });
    const z1 = S.compute([w24, w25], K('2026-11-15 22:30')).zones;
    ok('해제 통보문이 와도 해제 시각(23:00) 전이면 특보 유지 · 해제 예고 칸 = 정확한 해제 시각(자식도)', z1['경북북부앞바다'] && z1['경북북부앞바다'].kind === 'formal' && z1['경북북부앞바다'].clr === '2026년 11월 15일 23시 00분' && z1['경북북부앞바다중연안바다'] && z1['경북북부앞바다중연안바다'].clr === '2026년 11월 15일 23시 00분', z1['경북북부앞바다']);
    ok('해제 시각이 되면 지움', !S.compute([w24, w25], K('2026-11-15 23:00')).zones['경북북부앞바다']);
    const w25late = Object.assign({}, w25, { result: Object.assign({}, w25.result, { tmIn: '2026-11-15 23:05:30.0' }) });
    ok('해제 시각이 이미 지난 해제 통보문은 바로 지움', !S.compute([w24, w25late], K('2026-11-15 23:06')).zones['경북북부앞바다']);
    ok('해제 예고 범위(17일 09~12시)가 끝나고 10분이 지나도 해제 통보문이 없으면 특보 유지(대전 2026 10-2호 — 4시간 뒤 해제)', S.compute([w24], K('2026-11-17 12:20')).zones['경북북부앞바다'].kind === 'formal');
}

console.log('A1b. 적대검증 2026-11-16 회귀 — 발효 전 변경 · 첫 통보문 해제 · 해제 대기 중 해제예고 · AI 「위 해역」 정확 단위');
{
    const G = (ho, tmIn, o) => ({ office: '강원청', rpt: '6', result: Object.assign({ t1Title: ho, tmFc: tmIn + ':00.0', tmIn: tmIn + ':30.0', t1: '', t2: '', t3: '', t4: '', t6: 'o 없음', t7: 'o 없음' }, o) });
    const a1 = G('제1-33호', '2025-01-09 06:00', { t2: '(1) 풍랑주의보 발표 : 동해중부바깥먼바다', t3: '(1) 풍랑주의보 발표 : 2025년 01월 09일 07시 00분', t4: '(1) 풍랑주의보 발표\n  o 해제 예고: 10일 오후(15시~18시)' });
    const a2 = G('제1-34호', '2025-01-09 08:55', { t2: '(1) 풍랑경보 변경 : 동해중부바깥먼바다', t3: '(1) 풍랑경보 변경 : 2025년 01월 09일 10시 00분', t4: '(1) 풍랑경보 변경\n  o 해제 예고: 11일 오전(09시~12시)' });
    const z = S.compute([a1, a2], K('2025-01-09 09:30')).zones['동해중부바깥먼바다'];
    ok('#2 주의보 발효 중 「경보 변경」(발효 10:00) — 발효 전엔 주의보 그대로 + 다음 = 경보', z.kind === 'formal' && z.level === '주의보' && z.next && z.next.level === '경보' && z.next.tmEf === '2025년 01월 09일 10시 00분', z);
    ok('#2 발효 시각이 되면 경보(다음 없음)', (() => { const y = S.compute([a1, a2], K('2025-01-09 10:00')).zones['동해중부바깥먼바다']; return y.level === '경보' && !y.next; })());
    const tr = S.toTree({ 동해중부바깥먼바다: Object.assign({ parent: '동해중부바깥먼바다' }, z) });
    ok('#2 나무: 발효 중 = current, 다음 = upcoming(MMIS 와 같은 꼴)', JSON.stringify(tr).includes('"wrnLvlNm":"경보"') && JSON.stringify(tr).includes('"wrnLvlNm":"주의보"'));
    const r97 = G('제1-97호', '2026-01-30 22:00', { t2: '(1) 풍랑주의보 해제 : 동해중부안쪽먼바다, 동해중부바깥먼바다', t3: '(1) 풍랑주의보 해제 : 2026년 01월 31일 01시 00분', t6: 'o 없음' });
    const z97 = S.compute([r97], K('2026-01-30 23:00')).zones;
    ok('#3 창의 첫 통보문이 해제(발효 중 칸엔 이미 없음)여도 해제 시각(01:00)까지 유지', z97['동해중부안쪽먼바다'] && z97['동해중부안쪽먼바다'].clr === '2026년 01월 31일 01시 00분' && z97['동해중부바깥먼바다'], z97);
    ok('#3 해제 시각이 되면 지움', !Object.keys(S.compute([r97], K('2026-01-31 01:00')).zones).length);
    const ext = G('제1-98호', '2026-01-30 23:30', { t2: '(1) 풍랑주의보 해제예고연장 : 동해중부안쪽먼바다', t4: '(1) 풍랑주의보 해제예고연장\n  o 해제 예고: 31일 오전(06시~09시)' });
    const zx = S.compute([r97, ext], K('2026-01-31 01:30')).zones['동해중부안쪽먼바다'];
    ok('해제 대기 중 더 새 해제예고연장이 오면 그 통보문을 따름(앞 해제 시각에 안 지움)', zx && zx.clr === '31일 오전(06시~09시)' && !zx.relMs, zx);
    // #1 AI 「위 해역」 = 본문 항목의 실제 단위(자식만) — 부모로 넓히지 않는다(부산 2025 1-60호)
    const zones = { 울산앞바다: { parent: '울산앞바다', kind: 'formal', clr: '29일 밤(21시~24시)', inMs: 1 }, 울산앞바다중연안바다: { parent: '울산앞바다', kind: 'formal', clr: '29일 밤(21시~24시)', inMs: 1 } };
    const ap = S.applyAi(zones, [{ 종류: '정확해제시각', zones: ['울산앞바다중연안바다'], exact: true, inMs: 2, 시간_후: '09시 30분' }]);
    ok('#1 「위 해역」(정확 단위) 후보는 그 자식에만 — 남아 있는 부모는 안 덮음', ap.length === 1 && zones['울산앞바다'].clr === '29일 밤(21시~24시)' && zones['울산앞바다중연안바다'].clr === '09시 30분', { ap, zones });
}

console.log('A1c. 정식 특보 발효 중 같은 해역 예비 = 다가오는 특보 — 사용자 확정 2026-11-17');
{
    const G = (ho, tmIn, o) => ({ office: '강원청', rpt: '6', result: Object.assign({ t1Title: ho, tmFc: tmIn + ':00.0', tmIn: tmIn + ':30.0', t1: '', t2: '', t3: '', t4: '', t6: 'o 없음', t7: 'o 없음' }, o) });
    const GY = (ho, tmIn, t4) => ({ office: '강원청', rpt: '7', result: { t1Title: ho, tmFc: tmIn + ':00.0', tmIn: tmIn + ':30.0', t4, t5: '', other: 'o 없음' } });
    const w = G('제1-40호', '2025-01-11 10:00', { t2: '(1) 풍랑주의보 발표 : 동해중부안쪽먼바다', t3: '(1) 풍랑주의보 발표 : 2025년 01월 11일 11시 00분', t4: '(1) 풍랑주의보 발표\n  o 해제 예고: 11일 밤(18시~21시)' });
    const rel = G('제1-41호', '2025-01-11 18:00', { t2: '(1) 풍랑주의보 해제 : 동해중부안쪽먼바다', t3: '(1) 풍랑주의보 해제 : 2025년 01월 11일 20시 00분' });
    const y = GY('제1-9호', '2025-01-11 16:00', '(1) 풍랑 예비특보\n o 01월 12일 오전(06시~12시) : 동해중부안쪽먼바다');
    const r = S.compute([w, rel, y], K('2025-01-11 18:30'));
    const z = r.zones['동해중부안쪽먼바다'];
    ok('주의보 발효 중(20시 해제 대기) + 같은 해역 예비 → 지금 = 주의보, 다가오는 = 예비(12일 오전)', z.kind === 'formal' && z.upYebi && z.upYebi.tmEf === '2025년 01월 12일 오전(06시~12시)', z);
    const tr = JSON.stringify(r.tree);
    ok('나무: current = 주의보 · upcoming = 예비(메인 화면 「[다가오는 특보] 풍랑 주의보 예정」)', /"current":\{[^}]*"wrnLvlNm":"주의보"/.test(tr) && /"upcoming":\{[^}]*"wrnLvlNm":"예비"/.test(tr), tr.slice(0, 400));
    const z2 = S.compute([w, rel, y], K('2025-01-11 20:00')).zones['동해중부안쪽먼바다'];
    ok('해제 시각(20:00)이 되면 그 예비가 이어받음(지금 = 예비)', z2 && z2.kind === 'yebi' && z2.tmEf === '2025년 01월 12일 오전(06시~12시)', z2);
    const ap = S.applyAi(r.zones, [{ 종류: '예비취소', zones: ['동해중부안쪽먼바다'], inMs: K('2025-01-11 18:20'), office: '강원청', ho: '제1-42호' }]);
    ok('AI 예비취소(더 새 통보문)는 다가오는 예비만 뺌(부모 이름 = 자식 포함) — 지금 주의보는 그대로', ap.length >= 1 && ap.every((x) => x.what === '다가오는 예비 뺌') && ap.some((x) => x.unit === '동해중부안쪽먼바다') && r.zones['동해중부안쪽먼바다'].kind === 'formal' && !r.zones['동해중부안쪽먼바다'].upYebi, ap);
}

console.log('A2. 여러 항목이 한 머리를 함께 쓰는 해제 예고');
{
    const t = S.itemTimes({ t3: '(1) 풍랑주의보 발표 : 2026년 11월 15일 13시 30분\n(2) 풍랑주의보 발표 : 2026년 11월 15일 14시 30분', t4: '(1) ,(2) 풍랑주의보 발표\n  o 해제 예고: 17일 오전(09시~12시)' });
    ok('「(1) ,(2) … 해제 예고」 = 두 항목 모두(2026-11-15 대구 11-24호)', t.clr[1] === '17일 오전(09시~12시)' && t.clr[2] === '17일 오전(09시~12시)' && t.ef[2].text === '2026년 11월 15일 14시 30분');
}

console.log('B. 예비특보 — 10분 대기');
{
    const list = [Y('제11-1호', '2026-11-15 16:00', '(1) 풍랑 예비특보\n o 11월 16일 오후(12시~18시) : 제주도남쪽바깥먼바다\n o 11월 16일 밤(18시~24시) : 제주도앞바다(제주도동부앞바다)')];
    const z = S.compute(list, K('2026-11-16 10:00')).zones;
    ok('예비 목록 → 예비(시간창 MMIS 꼴)', z['제주도남쪽바깥먼바다'].kind === 'yebi' && z['제주도남쪽바깥먼바다'].tmEf === '2026년 11월 16일 오후(12시~18시)' && z['제주도동부앞바다'].tmEf === '2026년 11월 16일 밤(18시~24시)');
    ok('「24시」 끝은 다음날 0시', z['제주도동부앞바다'].endMs === K('2026-11-17 00:00'));
    const r1 = S.compute(list, K('2026-11-16 18:05'));
    ok('시간창 끝난 뒤 10분 안 = 아직 예비(기다리는 중 표시)', r1.zones['제주도남쪽바깥먼바다'] && r1.waiting.includes('제주도남쪽바깥먼바다'));
    ok('10분 지나면 뺌(아무 글 없음)', !S.compute(list, K('2026-11-16 18:10')).zones['제주도남쪽바깥먼바다']);
    const withFormal = list.concat([W('제11-5호', '2026-11-16 18:03', { t1: '풍랑주의보 발표', t2: '(1) 풍랑주의보 발표 : 제주도남쪽바깥먼바다', t3: '(1) 풍랑주의보 발표 : 2026년 11월 16일 19시 00분' })]);
    ok('기다리는 동안 정식 특보가 오면 정식(예비 아님)', S.compute(withFormal, K('2026-11-16 18:05')).zones['제주도남쪽바깥먼바다'].kind === 'formal');
    const extended = list.concat([Y('제11-2호', '2026-11-16 18:04', '(1) 풍랑 예비특보\n o 11월 17일 새벽(00시~06시) : 제주도남쪽바깥먼바다')]);
    const ze = S.compute(extended, K('2026-11-16 18:05')).zones;
    ok('기다리는 동안 다음 예비 목록에 연장돼 오면 새 시간창(목록 통째 교체)', ze['제주도남쪽바깥먼바다'].tmEf === '2026년 11월 17일 새벽(00시~06시)' && !ze['제주도동부앞바다']);
    const cleared = list.concat([Y('제11-3호', '2026-11-16 13:00', 'o 없음')]);
    ok('목록이 「o 없음」이면 곧바로 전부 뺌(목록에서 빠질 때는 기다리지 않음)', !Object.keys(S.compute(cleared, K('2026-11-16 13:01')).zones).length);
    const rel = list.concat([W('제11-6호', '2026-11-16 11:00', { t1: '풍랑예비특보 해제', t2: '제주도앞바다(제주도동부앞바다)', t3: '(1) 풍랑예비특보 해제 : 2026년 11월 16일 11시 00분' })]);
    const zr = S.compute(rel, K('2026-11-16 11:30')).zones;
    ok('「풍랑예비특보 해제」 통보문(번호 없는 꼴) 구역은 뺌, 나머지 예비는 남김', !zr['제주도동부앞바다'] && zr['제주도남쪽바깥먼바다'].kind === 'yebi');
}

console.log('C. 나무 모양(/api/weather-alerts 와 같음)');
{
    const list = [W('제11-1호', '2026-11-14 10:00', { t1: '풍랑주의보 발표', t2: '(1) 풍랑주의보 발표 : 제주도서부앞바다', t3: '(1) 풍랑주의보 발표 : 2026년 11월 14일 13시 00분', t6: 'o 풍랑주의보 : 제주도서부앞바다' }),
        Y('제11-1호', '2026-11-15 16:00', '(1) 풍랑 예비특보\n o 11월 16일 오후(12시~18시) : 제주도남쪽바깥먼바다')];
    const { tree } = S.compute(list, K('2026-11-16 10:00'));
    const leaf = tree['제주도'] && tree['제주도']['제주도앞바다'] && tree['제주도']['제주도앞바다']['제주도서부앞바다'];
    ok('정식 = current(출처 BULLETIN), 자식도 채움', leaf && leaf.current && leaf.current.wrnLvlNm === '주의보' && leaf.current.source === 'BULLETIN' && leaf.children['제주도서부앞바다중북서연안바다'] && leaf.children['제주도서부앞바다중북서연안바다'].wrnLvlNm === '주의보');
    const far = tree['제주도']['제주도먼바다']['제주도남쪽바깥먼바다'];
    ok('예비 = upcoming', far && far.upcoming && far.upcoming.wrnLvlNm === '예비' && !far.current);
    ok('바다 4곳 뼈대(동해·서해·남해·제주도)', ['동해', '서해', '남해', '제주도'].every((k) => tree[k]));
}

console.log('D. 실제 자료 되풀이 검산(2026-11 제주청·부산청)');
{
    const raw = path.join(__dirname, '..', 'analysis', 'bulletin_survey', 'raw');
    const all = [];
    for (const ym of ['2026-10', '2026-11']) for (const stn of ['184', '159']) {
        const d = JSON.parse(fs.readFileSync(path.join(raw, ym, stn + '.json'), 'utf8'));
        for (const it of Object.values(d.items)) if (it.result) all.push({ office: d.officeName, rpt: it.rpt, result: it.result, ms: K(String(it.result.tmIn).slice(0, 16)) });
    }
    let n = 0, same = 0, heldN = 0, heldOk = 0, nextN = 0, nextOk = 0;
    for (const T of all.filter((b) => b.rpt === '6' && String(b.result.tmIn).startsWith('2026-11'))) {
        const win = all.filter((b) => b.office === T.office && b.ms <= T.ms && b.ms > T.ms - 3 * 86400e3);
        const z = S.compute(win, T.ms).zones;
        const truth = new Map([...parseCurrent(T.result.t6, []).cur].filter(([u]) => PARENTS.has(u)));
        // 발효 중 칸(t6)은 해제 통보문을 낸 순간 해제 예정 해역을 이미 뺀다 — 우리는 해제 시각까지 유지하므로(2026-11-16 사용자 확정)
        //   「해제 시각을 기다리는 단위(relMs)」는 이 대조에서 뺀다. 그 단위가 정말 그 통보문의 해제 항목인지도 함께 센다.
        //   같은 까닭으로 발효 중 칸은 변경 통보문을 낸 순간 「새 등급」을 적는다(발효 전이어도) — 우리는 앱처럼 발효 시각까지 지금 등급을 두고 다음(next)을 따로 든다 → 대조는 다음 등급으로.
        //   그 단위를 해제 시각이 아직인 해제 항목으로 적은 통보문이 창 안에 있는가(이 통보문이든 앞 통보문이든)
        const relUnits = new Set(win.filter((b) => b.rpt === '6').flatMap((b) => { const { ef } = S.itemTimes(b.result); return parseItems(b.result.t2, []).filter((it) => it.action === '해제' && (ef[it.n] || {}).ms > T.ms).flatMap((it) => [...it.units]); }));
        const held = Object.entries(z).filter(([u, v]) => PARENTS.has(u) && v.relMs);
        heldN += held.length;
        heldOk += held.filter(([u]) => !truth.has(u) && relUnits.has(u)).length;   // 정말 해제 시각이 아직인 해제 항목 단위인가(적대검증 — 종전엔 t2 에 「해제」 글자만 봤다)
        const nexts = Object.entries(z).filter(([u, v]) => PARENTS.has(u) && v.next);
        nextN += nexts.length;
        nextOk += nexts.filter(([u, v]) => truth.get(u) === v.next.type + v.next.level).length;
        const mine = new Map(Object.entries(z).filter(([u, v]) => PARENTS.has(u) && v.kind === 'formal' && !v.relMs).map(([u, v]) => [u, v.next ? v.next.type + v.next.level : v.type + v.level]));
        n++; if (truth.size === mine.size && [...truth].every(([u, v]) => mine.get(u) === v)) same++;
    }
    ok(`특보 통보문 ${n}건 모두 발효 중 칸(부모)과 같음(해제 시각을 기다리는 단위는 빼고)`, n > 0 && same === n, { n, same });
    ok(`해제 시각을 기다리는 단위 ${heldN}곳 모두 해제 시각이 아직인 해제 항목이고 발효 중 칸에 없음`, heldN > 0 && heldOk === heldN, { heldN, heldOk });
    ok(`발효 전 변경을 기다리는 단위 ${nextN}곳 모두 발효 중 칸이 그 다음 등급을 적음`, nextN > 0 && nextOk === nextN, { nextN, nextOk });
}

console.log('E. 저장');
{
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bs-')), 'bulletin_status.json');
    const out = S.run({ watch: { bulletins: () => [Y('제11-1호', '2026-11-15 16:00', '(1) 풍랑 예비특보\n o 11월 16일 오후(12시~18시) : 제주도남쪽바깥먼바다')] }, now: () => K('2026-11-16 10:00'), file });
    const back = S.read(file);
    ok('계산 결과를 파일에 남기고 다시 읽음(current 나무·zones·통보문 수)', back && back.bulletins === 1 && back.current && back.zones['제주도남쪽바깥먼바다'] && out.updatedAt === back.updatedAt);
    ok('없으면 null', S.read(file + '.없음') === null);
    ok('시각 꼴 바꾸기', S.korTime('2026-11-15 16:00:00.0') === '2026년 11월 15일 16시 00분');
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
