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
const { parseCurrent, PARENTS } = require('../analysis/bulletin_survey/lifecycle_check');

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
    let n = 0, same = 0;
    for (const T of all.filter((b) => b.rpt === '6' && String(b.result.tmIn).startsWith('2026-11'))) {
        const win = all.filter((b) => b.office === T.office && b.ms <= T.ms && b.ms > T.ms - 3 * 86400e3);
        const z = S.compute(win, T.ms).zones;
        const truth = new Map([...parseCurrent(T.result.t6, []).cur].filter(([u]) => PARENTS.has(u)));
        const mine = new Map(Object.entries(z).filter(([u, v]) => PARENTS.has(u) && v.kind === 'formal').map(([u, v]) => [u, v.type + v.level]));
        n++; if (truth.size === mine.size && [...truth].every(([u, v]) => mine.get(u) === v)) same++;
    }
    ok(`특보 통보문 ${n}건 모두 발효 중 칸(부모)과 같음`, n > 0 && same === n, { n, same });
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
