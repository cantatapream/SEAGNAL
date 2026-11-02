/**
 * 카톡판 특보현황(services/kakao_shadow) · 날짜별 기록장(services/kakao_relay_log) 검사.
 * 실행: node local_server/scripts/test_kakao_shadow.js
 * 사용자 확정 2026-11-03: 10일 시험 — 「수집되어서 반영되었을 때를 가정했을 때 오류가 없는가」, 「수집되는 정보들이 모두 기록」.
 * 시각은 고정값만 쓴다(시각 의존 테스트 금지 — CLAUDE.md 결정로그).
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const kr = require('../services/kakao_relay');
const sh = require('../services/kakao_shadow');
const { createLog, dayOf } = require('../services/kakao_relay_log');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const HEAD = '[해양기상기후정보 알림]\n\n해당 해양기상기후정보 알림 메시지는 고객님의 알림 신청에 의해 발송됩니다.\n\n[기상특보]\n';
const PRE = '[해양기상기후정보 알림]\n\n해당 해양기상기후정보 알림 메시지는 고객님의 알림 신청에 의해 발송됩니다.\n\n[예비특보]\n';
const T0 = Date.parse('2026-11-03T03:00:00Z'); // 12:00 KST
const min = (m) => T0 + m * 60e3;
const line = (zone, kind, at, action, extra = {}) => ({ section: '기상특보', zone, kind, level: kind.replace('풍랑', ''), type: '풍랑', at, action, ...extra });

console.log('A. 카톡 줄 → 카톡판 상태');
{
    const zs = {};
    sh.applyLine(zs, line('A', '풍랑주의보', '2026-11-03T11:00+09:00', '발효'), min(0));
    ok('지난 시각 발효 = 지금 발효 중', zs.A.cur && zs.A.cur.level === '주의보' && !zs.A.pend);
    sh.applyLine(zs, line('B', '풍랑주의보', '2026-11-03T15:00+09:00', '발효'), min(0));
    ok('미래 시각 발효 = 다가오는 특보', !zs.B.cur && zs.B.pend && sh.shadowView(zs.B).up === true);
    sh.advance(zs, Date.parse('2026-11-03T15:00+09:00'));
    ok('그 시각이 되면 발효 중으로', zs.B.cur.level === '주의보' && !zs.B.pend);
    sh.applyLine(zs, line('A', '풍랑주의보', '2026-11-03T18:00+09:00', '해제'), min(1));
    ok('미래 시각 해제 = 해제 예정(아직 발효 중)', zs.A.cur && zs.A.until === '2026-11-03T18:00+09:00');
    sh.applyLine(zs, line('A', '풍랑주의보', '2026-11-03T12:30+09:00', '연장'), min(2));
    ok('연장 = 해제 예정 무효', zs.A.cur && zs.A.until === null);
    sh.applyLine(zs, line('A', '풍랑경보', '2026-11-03T12:00+09:00', '변경'), min(3));
    ok('변경 = 그 등급으로', zs.A.cur.level === '경보');
    sh.applyLine(zs, line('A', '풍랑경보', '2026-11-03T12:00+09:00', '해제'), min(4));
    ok('지난 시각 해제 = 특보 없음', zs.A.cur === null);
    sh.applyLine(zs, { section: '예비특보', zone: 'C', kind: '풍랑예비특보', level: '예비', type: '풍랑', at: '2026-11-03T18:00+09:00', until: '2026-11-04T00:00+09:00', action: '발효' }, min(0));
    ok('예비특보 발효 = 다가오는 특보', sh.shadowView(zs.C).up === true && !zs.C.cur);
    sh.applyLine(zs, line('C', '풍랑주의보', '2026-11-03T21:00+09:00', '발효'), min(5));
    ok('정식 특보가 오면 예비특보는 그것으로 대신', zs.C.pre === null && zs.C.pend && sh.shadowView(zs.C).up === true);
    sh.applyLine(zs, line('C', '풍랑주의보', '2026-11-03T20:00+09:00', '변경해제'), min(6));
    sh.advance(zs, Date.parse('2026-11-03T20:00+09:00'));
    ok('변경해제(태풍으로) 미래 시각 → 그때 풍랑 끝', zs.C.until === null || zs.C.cur === null);
}

console.log('B. 앱 특보현황(MMIS) 읽기');
const block = (lvl, tp = '풍랑', extra = {}) => ({ wrnTp: tp, wrnTpNm: tp, wrnLvl: lvl, wrnLvlNm: lvl, ...extra });
const leaf = (cur, up, children) => ({ current: cur || null, upcoming: up || null, history: [], children: children || {} });
const tree = (zones) => ({ current: { 동해: { 동해중부해상: { 동해중부먼바다: zones } } } });
{
    const mv = sh.mmisView(tree({
        동해중부안쪽먼바다: leaf(block('주의보', '풍랑', { clrNtcTm: '2026년 11월 03일 18시 00분' }), null, { 울릉도북면연안바다: block('예비'), 울릉도서면연안바다: null }),
        동해중부바깥먼바다: leaf(null, block('예비')),
        동해남부북쪽바깥먼바다: leaf(block('경보', '태풍')),
    }));
    ok('부모 발효 중 등급·정확한 해제예고', mv['동해중부안쪽먼바다'].cur === '주의보' && mv['동해중부안쪽먼바다'].clr === '2026-11-03T18:00+09:00');
    ok('자식 「예비」 = 다가오는 특보', mv['울릉도북면연안바다'].up === true && mv['울릉도북면연안바다'].cur === null);
    ok('자식 빈 칸 = 특보 없음', mv['울릉도서면연안바다'].cur === null && mv['울릉도서면연안바다'].up === false);
    ok('부모 upcoming = 다가오는 특보', mv['동해중부바깥먼바다'].up === true);
    ok('태풍 구역 표시', mv['동해남부북쪽바깥먼바다'].typhoon === true);
    ok('범위형 해제예고는 비교 안 함(null)', sh.mmisView(tree({ X: leaf(block('주의보', '풍랑', { clrNtcTm: '2026년 11월 03일 오후' })) })).X.clr === null);
}

console.log('C. 구역 비교(같음·반영 대기·차이·태풍)');
{
    const sv = { cur: '주의보', up: false, until: null };
    ok('같음', sh.compareZone(sv, { cur: '주의보', up: false }, min(30), min(0), min(0)).status === 'match');
    ok('카톡이 바뀐 지 10분 안 = 반영 대기', sh.compareZone(sv, { cur: null, up: false }, min(9), min(0), 0).status === 'wait');
    ok('10분 지나도 다르면 차이(발효 등급)', (() => { const r = sh.compareZone(sv, { cur: null, up: false }, min(11), min(0), 0); return r.status === 'diff' && r.diffs.join() === 'cur'; })());
    ok('MMIS 만 바뀐 지 10분 안 = 반영 대기', sh.compareZone({ cur: null, up: false }, { cur: '주의보', up: false }, min(15), 0, min(10)).status === 'wait');
    ok('해제 시각이 양쪽 다 정확한데 다르면 차이(clr)', sh.compareZone({ cur: '주의보', up: false, until: '2026-11-03T18:00+09:00' }, { cur: '주의보', up: false, clr: '2026-11-03T21:00+09:00' }, min(60), 0, 0).diffs.join() === 'clr');
    ok('태풍 구역은 비교 제외', sh.compareZone(sv, { cur: null, typhoon: true }, min(60), 0, 0).status === 'typhoon');
}

console.log('D. 1분 실행 흐름(시작 상태·줄 결과·구간·기록)');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kakao-shadow-'));
const store = kr.createStore({ file: path.join(tmp, 'kakao_relay.json') });
const shFile = path.join(tmp, 'kakao_shadow.json');
const log = createLog(path.join(tmp, 'kakao_relay_log'));
let mmis = tree({ 동해중부안쪽먼바다: leaf(block('주의보', '풍랑', { clrNtcTm: '2026년 11월 03일 18시 00분' })), 동해중부바깥먼바다: leaf(), 동해남부북쪽바깥먼바다: leaf() });
const run = (m) => sh.runShadow({ store, now: min(m), readAlerts: () => mmis, file: shFile, log, enabled: true });
ok('열쇠 없는 서버는 아무것도 안 함', sh.runShadow({ store, now: min(0), readAlerts: () => mmis, file: shFile, log, enabled: false }) === null && !fs.existsSync(shFile));
let r = run(0);
let st = JSON.parse(fs.readFileSync(shFile, 'utf8'));
ok('처음엔 그 시각 MMIS 로 시작 상태 — 해제예고(예보)는 확정 해제로 넣지 않음', st.zones['동해중부안쪽먼바다'].cur.level === '주의보' && st.zones['동해중부안쪽먼바다'].until === null && r.diff === 0, r);
ok('시작 상태 기록(baseline)', log.read(dayOf(min(0))).some((e) => e.kind === 'baseline' && e.active.length === 1));
// 카톡: 동해중부바깥먼바다 발효(12:00 KST — 지난 시각)
store.storeMessages([{ text: HEAD + '동해중부바깥먼바다,\n풍랑주의보 11월 03일 12시 00분 발효', source: 'screen', trigger: true }], 'tablet', new Date(min(1)));
r = run(1);
ok('카톡 줄 반영 직후 MMIS 가 아직이면 반영 대기', r.wait === 1 && r.diff === 0, r);
mmis = tree({ 동해중부안쪽먼바다: leaf(block('주의보', '풍랑', { clrNtcTm: '2026년 11월 03일 18시 00분' })), 동해중부바깥먼바다: leaf(block('주의보')), 동해남부북쪽바깥먼바다: leaf() });
r = run(4);
ok('MMIS 가 따라오면 같음', r.wait === 0 && r.diff === 0, r);
let ev = log.read(dayOf(min(0)));
const ln = ev.find((e) => e.kind === 'line' && e.zone === '동해중부바깥먼바다');
ok('카톡 줄 결과 「일치」·카톡이 3분 빠름', ln && ln.result === '일치' && ln.lagMin === 3, ln);
const ep = ev.find((e) => e.kind === 'episode' && e.zone === '동해중부바깥먼바다');
ok('다른 상태였던 구간 3분·카톡이 먼저 바뀜·반영 대기로 끝', ep && ep.min === 3 && ep.first === '카톡이 먼저 바뀜' && ep.worst === 'wait', ep);
ok('받은 글 원문·줄 처리 기록(A)', ev.some((e) => e.kind === 'msg' && e.device === 'tablet' && /동해중부바깥먼바다/.test(e.text) && e.lines[0].tag === 'new'));
// MMIS 만 바뀜(카톡 없음) — 동해남부북쪽바깥먼바다
mmis = tree({ 동해중부안쪽먼바다: leaf(block('주의보', '풍랑', { clrNtcTm: '2026년 11월 03일 18시 00분' })), 동해중부바깥먼바다: leaf(block('주의보')), 동해남부북쪽바깥먼바다: leaf(block('주의보')) });
run(10);
r = run(21);
ok('카톡이 안 온 MMIS 변화는 10분 뒤 차이', r.diff === 1, r);
ev = log.read(dayOf(min(0)));
const tk = ev.filter((e) => e.kind === 'tick').pop();
ok('5분 기록에 차이 구역과 양쪽 상태', tk && tk.diffZones.some((z) => z.zone === '동해남부북쪽바깥먼바다' && z.kakao === '특보 없음' && /풍랑주의보/.test(z.mmis)), tk);
ok('MMIS 변화 기록', ev.some((e) => e.kind === 'mmis' && e.zone === '동해남부북쪽바깥먼바다'));
// 카톡이 늦게 옴 → 같아짐, 구간 끝: MMIS 가 먼저
store.storeMessages([{ text: HEAD + '동해남부북쪽바깥먼바다,\n풍랑주의보 11월 03일 12시 05분 발효', source: 'notification', trigger: true }], 'tablet', new Date(min(30)));
r = run(31);
ev = log.read(dayOf(min(0)));
const ep2 = ev.filter((e) => e.kind === 'episode' && e.zone === '동해남부북쪽바깥먼바다').pop();
ok('늦은 카톡 → 같아짐 · 구간 21분 · MMIS 가 먼저 · 최악 「차이」', r.diff === 0 && ep2 && ep2.min === 21 && ep2.first === 'MMIS가 먼저 바뀜' && ep2.worst === 'diff', ep2);
const ln2 = ev.filter((e) => e.kind === 'line' && e.zone === '동해남부북쪽바깥먼바다').pop();
ok('그 줄 결과 일치·음수(MMIS 가 20분 먼저)', ln2 && ln2.result === '일치' && ln2.lagMin === -20, ln2);
// 미래 해제 → 그 시각에 풀림 · MMIS 가 늦게 풀어도 대기 후 같음
store.storeMessages([{ text: HEAD + '동해중부바깥먼바다,\n풍랑주의보 11월 03일 13시 00분 해제', source: 'screen', trigger: true }], 'tablet', new Date(min(40)));
run(41);
r = run(61);
ok('카톡 해제 시각이 되면 카톡판은 풀림 → MMIS 아직이면 반영 대기', r.wait === 1, r);
mmis = tree({ 동해중부안쪽먼바다: leaf(block('주의보', '풍랑', { clrNtcTm: '2026년 11월 03일 18시 00분' })), 동해중부바깥먼바다: leaf(), 동해남부북쪽바깥먼바다: leaf(block('주의보')) });
r = run(64);
ok('MMIS 도 풀리면 같음', r.wait === 0 && r.diff === 0, r);
// 6시간 안 같아지면 불일치
store.storeMessages([{ text: HEAD + '동해중부안쪽먼바다,\n풍랑경보 11월 03일 13시 10분 변경', source: 'screen', trigger: true }], 'tablet', new Date(min(70)));
run(71);
run(71 + 6 * 60 + 1);
ev = log.read(dayOf(min(0)));
ok('6시간 내내 다르면 「불일치」로 닫음', ev.some((e) => e.kind === 'line' && e.zone === '동해중부안쪽먼바다' && e.result === '불일치'));
// 놓친 글은 반영 없이 기록만
store.storeMessages([
    { text: HEAD + '동해남부북쪽바깥먼바다,\n풍랑주의보 11월 03일 18시 30분 해제', source: 'screen', trigger: true },
    { text: HEAD + '울릉도북면연안바다,\n풍랑주의보 11월 03일 17시 00분 발효', source: 'screen', trigger: false },
], 'tablet', new Date(min(500)));
run(501);
st = JSON.parse(fs.readFileSync(shFile, 'utf8'));
ev = log.read(dayOf(min(0)));
ok('놓친 글 줄은 기록만(카톡판에 반영 안 함)', ev.some((e) => e.kind === 'missedLine' && e.zone === '울릉도북면연안바다') && !(st.zones['울릉도북면연안바다'] && st.zones['울릉도북면연안바다'].cur));
ok('같은 줄은 두 번 반영하지 않음', ev.filter((e) => e.kind === 'apply' && /18:30/.test(e.line)).length === 1 && (run(502), log.read(dayOf(min(0))).filter((e) => e.kind === 'apply' && /18:30/.test(e.line)).length === 1));
// 태풍 구역
mmis = tree({ 동해중부안쪽먼바다: leaf(block('경보', '태풍')), 동해중부바깥먼바다: leaf(), 동해남부북쪽바깥먼바다: leaf(block('주의보')) });
r = run(520);
ok('태풍 걸린 구역은 비교 제외로 셈', r.typhoon === 1, r);
// 특보현황 못 읽음
const before = log.read(dayOf(min(0))).length;
sh.runShadow({ store, now: min(530), readAlerts: () => { throw new Error('ENOENT'); }, file: shFile, log, enabled: true });
ok('특보현황을 못 읽으면 「못 읽음」을 남김(같음으로 안 셈)', log.read(dayOf(min(0))).slice(before).some((e) => e.kind === 'tick' && /ENOENT/.test(e.mmisError)));
// 깨진 상태 파일
const badFile = path.join(tmp, 'bad_shadow.json'); fs.writeFileSync(badFile, '{깨짐');
let threw = false; try { sh.runShadow({ store, now: min(0), readAlerts: () => mmis, file: badFile, log, enabled: true }); } catch (_) { threw = true; }
ok('깨진 상태 파일은 새로 시작하지 않고 멈춤·원본 보존', threw && fs.readFileSync(badFile, 'utf8') === '{깨짐' && fs.existsSync(badFile + '.bad'));

console.log('E. 기록장(A) — 신호·중복·기기·30일 보관');
store.heartbeat({ device: 'tablet', battery: 70, note: 'ok' }, new Date(min(600)));
store.storeMessages([{ text: HEAD + '동해남부북쪽바깥먼바다,\n풍랑주의보 11월 03일 18시 30분 해제', source: 'screen', trigger: true }], 'phone', new Date(min(601)));
store.setDevice('phone', 'disable', new Date(min(602)));
store.storeMessages([{ text: 'x' }], 'phone', new Date(min(603)));
ev = log.read(dayOf(min(600)));
ok('신호 기록(배터리)', ev.some((e) => e.kind === 'beat' && e.device === 'tablet' && e.battery === 70));
ok('중복 글도 어느 기기가 보냈는지 기록', ev.some((e) => e.kind === 'dup' && e.device === 'phone'));
ok('기기 설정·끈 기기의 글 거절 기록', ev.some((e) => e.kind === 'device' && e.action === 'disable') && ev.some((e) => e.kind === 'ignored' && e.device === 'phone' && e.count === 1));
const lg2 = createLog(path.join(tmp, 'prune'));
lg2.append({ kind: 'x' }, Date.parse('2026-10-01T03:00:00Z'));
lg2.append({ kind: 'x' }, Date.parse('2026-10-05T03:00:00Z'));
lg2.append({ kind: 'x' }, Date.parse('2026-11-03T03:00:00Z'));
ok('30일 지난 날짜 파일만 지움', JSON.stringify(lg2.prune(Date.parse('2026-11-03T03:00:00Z'))) === '["2026-10-01"]' && lg2.days().length === 2, lg2.days());
ok('KST 날짜로 나눔(UTC 15시 = 다음 날)', dayOf(Date.parse('2026-11-02T15:30:00Z')) === '2026-11-03');

console.log('F. 비교현황 요약(D)');
const s = sh.summarize({ day: dayOf(min(0)), now: min(700), file: shFile, log });
ok('시간대 24칸', s.hours.length === 24);
ok('12시대(KST): 받은 글·반영 줄·대기·차이 분', s.hours[12].msgs >= 2 && s.hours[12].applied >= 2 && s.hours[12].diffMin > 0, s.hours[12]);
ok('줄 결과 합계(일치·불일치·확인 불가)', s.totals.lines['일치'] >= 2 && s.totals.lines['불일치'] === 1 && s.totals.lines['확인 불가(MMIS에 정확한 해제 시각 없음)'] === 1, s.totals.lines);
ok('평균 지연(분) 계산', typeof s.totals.lagAvg === 'number');
ok('구간 목록·사건 목록', s.episodes.length >= 2 && s.events.some((e) => e.kind === 'baseline'));
ok('기록 있는 날 목록·현재 상태', s.days.some((d) => d.day === dayOf(min(0)) && d.msgs >= 2) && s.current && s.current.startedAt);
ok('날짜 꼴이 틀리면 오늘로', sh.summarize({ day: '../../etc', now: min(700), file: shFile, log }).day === dayOf(min(700)));

console.log('G. 적대검증 반영(2026-11-03 독립 검토 재현 6건)');
{
    const mk = (name) => {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kakao-shadow-' + name + '-'));
        const st2 = kr.createStore({ file: path.join(d, 'kakao_relay.json') });
        const lg = createLog(path.join(d, 'kakao_relay_log'));
        const f = path.join(d, 'kakao_shadow.json');
        return { st2, lg, f, run: (ms, mm) => sh.runShadow({ store: st2, now: ms, readAlerts: () => mm, file: f, log: lg, enabled: true }) };
    };
    const Z = (cur) => tree({ 동해중부안쪽먼바다: leaf(cur), 동해중부바깥먼바다: leaf(), 동해남부북쪽바깥먼바다: leaf() });
    // #1 3일 지난 글 재반영
    const a = mk('old');
    a.run(min(0), Z());
    a.st2.storeMessages([{ text: HEAD + '동해중부안쪽먼바다,\n풍랑주의보 11월 03일 12시 00분 발효', trigger: true }], 'tablet', new Date(min(1)));
    a.run(min(2), Z(block('주의보')));
    a.st2.storeMessages([{ text: HEAD + '동해중부안쪽먼바다,\n풍랑주의보 11월 03일 13시 00분 해제', trigger: true }], 'tablet', new Date(min(60)));
    a.run(min(61), Z());
    a.st2.storeMessages([{ text: HEAD + '동해중부안쪽먼바다,\n풍랑주의보 11월 07일 12시 00분 발효', trigger: true }], 'tablet', new Date(min(4 * 1440)));
    a.run(min(4 * 1440 + 1), Z(block('주의보')));
    const r1 = a.run(min(4 * 1440 + 30), Z(block('주의보')));
    const applies = a.lg.days().flatMap((d) => a.lg.read(d)).filter((e) => e.kind === 'apply');
    ok('#1 3일 지난 옛 글을 다시 반영하지 않음(카톡판이 옛 상태로 안 돌아감)', applies.length === 3 && r1.diff === 0, { n: applies.length, r1 });
    // #2 놓친 글 → 나중에 이번 알림으로 올라오면 반영
    const b = mk('promo');
    b.run(min(0), Z());
    const TXT_B = HEAD + '동해중부바깥먼바다,\n풍랑주의보 11월 03일 12시 00분 발효';
    b.st2.storeMessages([{ text: HEAD + '동해남부북쪽바깥먼바다,\n풍랑주의보 11월 03일 12시 00분 발효', trigger: true }, { text: TXT_B, trigger: false }], 'tablet', new Date(min(1)));
    b.run(min(2), Z());
    b.st2.storeMessages([{ text: TXT_B, trigger: true }], 'tablet', new Date(min(3)));
    b.run(min(4), Z());
    const shB = JSON.parse(fs.readFileSync(b.f, 'utf8'));
    ok('#2 놓친 글로 먼저 본 줄이 이번 알림으로 올라오면 카톡판에 반영', shB.zones['동해중부바깥먼바다'] && shB.zones['동해중부바깥먼바다'].cur && shB.zones['동해중부바깥먼바다'].cur.level === '주의보');
    // #5 같은 시각 여러 글 — 글 순서대로
    const c = mk('order');
    c.run(min(0), Z());
    c.st2.storeMessages([
        { text: HEAD + '동해중부바깥먼바다,\n풍랑주의보 11월 03일 12시 00분 발효\n\n동해중부안쪽먼바다,\n풍랑경보 11월 03일 12시 00분 변경', trigger: true },
        { text: HEAD + '동해중부안쪽먼바다,\n풍랑경보 11월 03일 12시 01분 해제', trigger: true },
    ], 'tablet', new Date(min(2)));
    c.run(min(3), Z());
    const shC = JSON.parse(fs.readFileSync(c.f, 'utf8'));
    ok('#5 같은 시각 받은 글은 글 순서 → 줄 순서로(나중 글의 해제가 이김)', shC.zones['동해중부안쪽먼바다'].cur === null, shC.zones['동해중부안쪽먼바다']);
    // #6 해제예고만 바뀌어도 오래된 차이는 차이로 남음
    ok('#6 MMIS 해제예고만 방금 바뀌어도 등급 차이는 「차이」 유지', sh.compareZone({ cur: null, up: false }, { cur: '주의보', up: false }, min(60), 0, min(58), min(0)).status === 'diff');
    ok('#6 해제 시각만 다를 때는 해제예고 변화 시각으로 대기 판단', sh.compareZone({ cur: '주의보', up: false, until: '2026-11-03T18:00+09:00' }, { cur: '주의보', up: false, clr: '2026-11-03T19:00+09:00' }, min(60), 0, min(58), min(0)).status === 'wait');
    // #4 시작 상태: 확정 해제시각(tmYn)·시작 전 카톡이 알린 미래 해제
    const d4 = mk('base');
    d4.st2.storeMessages([{ text: HEAD + '동해중부바깥먼바다,\n풍랑주의보 11월 03일 18시 00분 해제', trigger: true }], 'tablet', new Date(min(-30)));
    d4.run(min(0), tree({ 동해중부안쪽먼바다: leaf(block('주의보', '풍랑', { tmYn: '2026년 11월 03일 15시 00분', clrNtcTm: '2026년 11월 03일 15시 00분' })), 동해중부바깥먼바다: leaf(block('주의보', '풍랑', { clrNtcTm: '2026년 11월 03일 20시 00분' })), 동해남부북쪽바깥먼바다: leaf(block('주의보', '풍랑', { clrNtcTm: '2026년 11월 03일 16시 00분' })) }));
    const sh4 = JSON.parse(fs.readFileSync(d4.f, 'utf8'));
    ok('#4 시작 상태: MMIS 확정 해제시각(tmYn)은 넣음', sh4.zones['동해중부안쪽먼바다'].until === '2026-11-03T15:00+09:00');
    ok('#4 시작 상태: 시작 전 카톡이 알린 미래 해제는 넣음', sh4.zones['동해중부바깥먼바다'].until === '2026-11-03T18:00+09:00');
    ok('#4 시작 상태: MMIS 해제예고(예보)만 있으면 넣지 않음', sh4.zones['동해남부북쪽바깥먼바다'].until === null);
    // #3 줄 결과는 그 줄이 바꾼 것으로
    const e = mk('aspect');
    e.run(min(0), Z(block('주의보')));
    e.st2.storeMessages([{ text: HEAD + '동해중부안쪽먼바다,\n풍랑주의보 11월 03일 11시 00분 발효', trigger: true }], 'tablet', new Date(min(1)));
    e.run(min(2), Z(block('주의보')));
    e.st2.storeMessages([{ text: HEAD + '동해중부안쪽먼바다,\n풍랑주의보 11월 03일 18시 00분 해제', trigger: true }], 'tablet', new Date(min(3)));
    e.run(min(4), Z(block('주의보')));
    e.run(min(9), Z(block('주의보', '풍랑', { clrNtcTm: '2026년 11월 03일 18시 00분' })));
    const lnE = e.lg.read(dayOf(min(0))).filter((x) => x.kind === 'line');
    ok('#3 아무것도 안 바꾼 줄 = 「바뀐 것 없음」(평균 지연에 안 섞임)', lnE.some((x) => /11:00/.test(x.line) && x.result === '바뀐 것 없음(이미 아는 내용)' && x.lagMin === undefined), lnE);
    ok('#3 해제 시각 줄은 MMIS 해제예고가 같아질 때 일치·지연 6분', lnE.some((x) => /18:00/.test(x.line) && x.result === '일치' && x.lagMin === 6), lnE);
}

console.log('H. 멈춤과 조용함 구분');
{
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kakao-shadow-gap-'));
    const st3 = kr.createStore({ file: path.join(d, 'kakao_relay.json') });
    const lg = createLog(path.join(d, 'kakao_relay_log')), f = path.join(d, 'kakao_shadow.json');
    const mm = { updatedAt: new Date(min(-60)).toISOString(), ...tree({ 동해중부안쪽먼바다: leaf() }) };
    for (let m = 0; m <= 60; m += 5) sh.runShadow({ store: st3, now: min(m), readAlerts: () => mm, file: f, log: lg, enabled: true });
    // 13시(KST)는 비교가 돌지 않음
    const s3 = sh.summarize({ day: dayOf(min(0)), now: min(180), file: f, log: lg });
    ok('비교가 안 돈 지난 시간은 「기록 없음」', s3.hours[13].gap === true && s3.hours[12].gap === false && s3.totals.gapHours >= 1, [s3.hours[12].ticks, s3.hours[13].ticks]);
    ok('특보현황 파일이 15분 넘게 안 바뀌면 멈춤 의심으로 셈', s3.hours[12].staleTicks > 0, s3.hours[12]);
    ok('시험 시작 전 시간은 기록 없음으로 안 셈', s3.hours[11].gap === false);
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
