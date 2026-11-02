/**
 * test_kakao_relay.js — 카톡 특보 알림톡 수신(services/kakao_relay · routes/kakao_relay)을 고정한다.
 *
 * [왜 있나] 사용자 결정 2026-11-02 「3번으로 진행하자」 — 태블릿 전용 앱이 카톡 대화방 글을 읽어 서버로 보낸다.
 *   서버는 받은 글을 특보 줄로 나누고 같은 글을 한 번만 남긴다. 아직 푸시에는 연결하지 않는다.
 * [무엇을 보나] A. 분해(실제 알림톡 4장 스크린샷의 글 꼴) B. 중복 제거·보관 상한 C. 열쇠 검사·라우트
 * [실행] node local_server/scripts/test_kakao_relay.js
 * [연계] ← scripts/refactor/verify_all.sh SUITES / → services/kakao_relay.js · routes/kakao_relay.js
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const express = require('express');
const { parseWarnings, createStore, judgeHealth, checkHealth, MAX_MESSAGES, HEARTBEAT_STALE_MS } = require('../services/kakao_relay');
const { createRouter } = require('../routes/kakao_relay');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const NOV = new Date('2026-11-02T09:00:00Z');
const HEAD = '[해양기상기후정보 알림]\n\n해당 해양기상기후정보 알림 메시지는 고객님의 알림 신청에 의해 발송됩니다.\n\n[기상특보]\n';

(async () => {
    console.log('A. 분해');
    let w = parseWarnings(HEAD + '동해남부북쪽바깥먼바다,\n풍랑주의보 11월 02일 19시 00분 발효', NOV);
    ok('한 건 발효', JSON.stringify(w) === JSON.stringify([{ zone: '동해남부북쪽바깥먼바다', zoneKey: '동해남부북쪽바깥먼바다', kind: '풍랑주의보', at: '2026-11-02T19:00+09:00', action: '발효', rawAction: '발효' }]), w);
    w = parseWarnings(HEAD + '제주도서부앞바다,\n풍랑주의보 11월 02일 18시 00분\n해제\n제주도서부앞바다중 북서연안바다,\n풍랑주의보 11월 02일 18시 00분\n해제\n제주도서부앞바다중가파도연안바\n다,\n풍랑주의보 11월 02일 18시 00분\n해제', NOV);
    ok('여러 건·줄바꿈 해제', w.length === 3 && w.every((x) => x.action === '해제'), w);
    ok('띄어쓰기 있는 구역 이름 유지', w[1] && w[1].zone === '제주도서부앞바다중 북서연안바다', w[1]);
    ok('비교용 열쇠는 공백 없음', w[1] && w[1].zoneKey === '제주도서부앞바다중북서연안바다', w[1]);
    ok('잘린 동작어는 unknown', parseWarnings(HEAD + '서해남부먼바다,\n풍랑주의보 11월 02일 19시 00분 해', NOV)[0].action === 'unknown');
    ok('끊긴 구역 이름 이어 붙임', w[2] && w[2].zone === '제주도서부앞바다중가파도연안바다', w[2]);
    ok('04시 05분 같은 분 단위', parseWarnings(HEAD + '제주도동부앞바다중 남동연안바다,\n풍랑주의보 11월 02일 04시 05분\n해제', NOV)[0].at === '2026-11-02T04:05+09:00');
    ok('[기상특보] 없으면 빈 목록', parseWarnings('아무 글', NOV).length === 0);
    ok('12월에 받은 1월 특보는 다음 해', parseWarnings(HEAD + '서해남부먼바다,\n풍랑경보 01월 01일 03시 00분 발효', new Date('2026-12-31T16:00:00Z'))[0].at.startsWith('2027-01-01'));

    console.log('B. 저장');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kakao-relay-'));
    const st = createStore({ file: path.join(tmp, 'db.json') });
    let r = st.storeMessages([{ text: HEAD + '동해남부북쪽바깥먼바다,\n풍랑주의보 11월 02일 19시 00분 발효' }, { text: '  ' }], 'tab', NOV);
    ok('새 글 1건·빈 글 무시', r.added === 1 && r.duplicate === 0, r);
    r = st.storeMessages([{ text: HEAD + '동해남부북쪽바깥먼바다,\n풍랑주의보 11월 02일 19시 00분 발효\n' }], 'tab', NOV);
    ok('같은 글(앞뒤 공백만 다름) 중복', r.added === 0 && r.duplicate === 1, r);
    ok('분해 결과 저장', st.snapshot().messages[0].warnings.length === 1);
    st.storeMessages(Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => ({ text: 'x' + i })), 'tab', NOV);
    ok('보관 상한', st.snapshot(1000).messages.length === MAX_MESSAGES);

    r = st.storeMessages([{ text: HEAD + '꼴이 바뀐 글' }], 'tab', NOV);
    ok('분해 0줄이면 unparsed 표시', r.new[0].unparsed === true, r.new[0]);
    const bad = path.join(tmp, 'bad.json'); fs.writeFileSync(bad, '{깨짐');
    let threw = false; try { createStore({ file: bad }).heartbeat({}); } catch (_) { threw = true; }
    ok('깨진 파일은 덮어쓰지 않음', threw && fs.readFileSync(bad, 'utf8') === '{깨짐' && fs.existsSync(bad + '.bad'));

    console.log('D. 특보 줄 단위 중복');
    const st2 = createStore({ file: path.join(tmp, 'db2.json') });
    const L1 = '서해남부먼바다,\n풍랑주의보 11월 02일 17시 00분 발효';
    let n = st2.storeMessages([{ text: HEAD + L1, source: 'notification' }], 't', NOV).new[0];
    ok('처음 본 줄은 새 특보', n.newWarnings.length === 1, n.newWarnings);
    n = st2.storeMessages([{ text: HEAD + L1 + '\n서해중부먼바다,\n풍랑주의보 11월 02일 17시 00분 발효' }], 't', NOV).new[0];
    ok('알림 글·화면 글이 달라도 같은 줄은 새것 아님(새 줄만)', n.newWarnings.length === 1 && n.newWarnings[0].zone === '서해중부먼바다', n.newWarnings);
    n = st2.storeMessages([{ text: HEAD + '동해중부먼바다,\n풍랑주의보 10월 30일 17시 00분 발효' }], 't', NOV).new[0];
    ok('24시간 넘게 지난 옛 특보는 새것 아님', n.newWarnings.length === 0, n.newWarnings);
    n = st2.storeMessages([{ text: HEAD + '남해동부먼바다,\n풍랑주의보 11월 02일 17시 00분 해' }], 't', NOV).new[0];
    ok('동작어 모름(unknown)은 새것 아님', n.newWarnings.length === 0);

    console.log('E. 멈춤 판정');
    const T = Date.parse('2026-11-02T05:00:00Z');
    ok('신호 한 번도 없음 → 판정 안 함(null)', judgeHealth(null, T) === null);
    ok('69분 전 신호 → 정상', judgeHealth({ at: new Date(T - 69 * 60e3).toISOString(), note: 'ok | 마지막 읽기: 없음' }, T).ok === true);
    let v = judgeHealth({ at: new Date(T - HEARTBEAT_STALE_MS - 1).toISOString(), note: 'ok' }, T);
    ok('70분 넘게 끊김 → 이상(KST 시각)', v.ok === false && /신호 끊김 — 마지막 11\/02 12:49/.test(v.reason), v);
    ok('신호 시각 손상 → 이상', judgeHealth({ at: 'x' }, T).ok === false);
    ok('접근성 꺼짐 → 이상', judgeHealth({ at: new Date(T).toISOString(), note: '접근성 꺼짐 | 마지막 읽기: 없음' }, T).reason === '태블릿 화면 읽기(접근성) 꺼짐');
    ok('알림 감시 끊김 → 이상', judgeHealth({ at: new Date(T).toISOString(), note: 'ok · 알림 감시 끊김 | 마지막 읽기: 없음' }, T).reason === '태블릿 카톡 알림 감시 끊김');
    v = judgeHealth({ at: new Date(T).toISOString(), note: 'ok | 마지막 읽기: 11-02 13:00 실패: 시간 초과' }, T);
    ok('마지막 읽기 실패 → 이상', v.ok === false && /대화방 읽기 실패/.test(v.reason), v);
    ok('마지막 읽기 성공 → 정상', judgeHealth({ at: new Date(T).toISOString(), note: 'ok | 마지막 읽기: 11-02 13:00 성공 3개' }, T).ok === true);
    const calls = [];
    const fakeAlert = { report: async (id, o) => calls.push([id, o]) };
    const st3 = createStore({ file: path.join(tmp, 'db3.json') });
    ok('열쇠 미설정이면 감시 안 함', (await checkHealth({ store: st3, alert: fakeAlert, now: T, enabled: false })) === null && !calls.length);
    ok('신호 없으면 보고 안 함', (await checkHealth({ store: st3, alert: fakeAlert, now: T, enabled: true })) === null && !calls.length);
    st3.heartbeat({ device: 't', note: 'ok' }, new Date(T - 2 * 3600e3));
    await checkHealth({ store: st3, alert: fakeAlert, now: T, enabled: true });
    ok('끊김은 kakaoRelay 실패로 보고(사람 문장 사유)', calls.length === 1 && calls[0][0] === 'kakaoRelay' && calls[0][1].ok === false && /신호 끊김/.test(calls[0][1].error.plainReason), calls);
    st3.heartbeat({ device: 't', note: 'ok' }, new Date(T));
    await checkHealth({ store: st3, alert: fakeAlert, now: T, enabled: true });
    ok('신호 돌아오면 정상 보고', calls.length === 2 && calls[1][1].ok === true);
    ok('수집현황 카드가 읽는 heartbeatAt 칸', JSON.parse(fs.readFileSync(path.join(tmp, 'db3.json'), 'utf8')).heartbeatAt === new Date(T).toISOString());

    console.log('C. 라우트');
    const app = express(); app.use(express.json());
    let secret = 'k';
    app.use(createRouter({ store: st, getSecret: () => secret, authorize: (q, s, n) => n() }));
    const srv = http.createServer(app).listen(0);
    const port = srv.address().port;
    const call = (m, p, body, h = {}) => new Promise((res) => {
        const q = http.request({ port, method: m, path: p, headers: { 'Content-Type': 'application/json', ...h } }, (rs) => { let d = ''; rs.on('data', (c) => (d += c)); rs.on('end', () => res({ status: rs.statusCode, body: JSON.parse(d || '{}') })); });
        q.end(body ? JSON.stringify(body) : undefined);
    });
    ok('열쇠 없으면 401', (await call('POST', '/api/kakao-relay/messages', { messages: [] })).status === 401);
    ok('열쇠 틀리면 401', (await call('POST', '/api/kakao-relay/messages', { messages: [] }, { 'X-Relay-Token': 'z' })).status === 401);
    let x = await call('POST', '/api/kakao-relay/messages', { device: 't', messages: [{ text: 'new-one' }] }, { 'X-Relay-Token': 'k' });
    ok('맞는 열쇠 저장·받은 건수 회신', x.status === 200 && x.body.added === 1 && x.body.accepted === 1, x);
    x = await call('POST', '/api/kakao-relay/messages', { messages: Array.from({ length: 51 }, (_, i) => ({ text: 'm' + i })) }, { 'X-Relay-Token': 'k' });
    ok('50건 초과는 일부 받고 성공이라 하지 않음(413)', x.status === 413, x);
    x = await call('POST', '/api/kakao-relay/heartbeat', { device: 't', battery: 77 }, { 'X-Relay-Token': 'k' });
    ok('신호 기록', x.status === 200 && st.snapshot().heartbeat.battery === 77, x);
    x = await call('GET', '/api/admin/kakao-relay?n=2');
    ok('관리자 조회 최신순', x.body.messages.length === 2 && x.body.messages[0].text === 'new-one', x.body.messages);
    secret = '';
    ok('서버에 열쇠 미설정이면 503', (await call('POST', '/api/kakao-relay/heartbeat', {}, { 'X-Relay-Token': '' })).status === 503);
    secret = 'k';
    ok('실시간 기록 읽기는 열쇠 필요', (await call('GET', '/api/kakao-relay/messages')).status === 401);
    x = await call('GET', '/api/kakao-relay/messages?n=1', null, { 'X-Relay-Token': 'k' });
    ok('실시간 기록 읽기(열쇠)', x.status === 200 && x.body.messages.length === 1 && 'heartbeat' in x.body, x.body);
    console.log('F. 임시 긁어오기');
    secret = 'k';
    x = await call('POST', '/api/kakao-relay/backfill', { device: 'p', messages: [{ text: HEAD + '서해남부먼바다,\n풍랑주의보 12월 30일 17시 00분 발효', date: '2025년 12월 30일 화요일', time: '오후 5:03' }, { text: 'b2' }] }, { 'X-Relay-Token': 'k' });
    ok('긁어오기 저장', x.status === 200 && x.body.added === 2 && x.body.total === 2, x);
    x = await call('POST', '/api/kakao-relay/backfill', { messages: [{ text: 'b2' }] }, { 'X-Relay-Token': 'k' });
    ok('긁어오기 중복', x.body.added === 0 && x.body.duplicate === 1, x);
    ok('긁어오기 열쇠 필요', (await call('GET', '/api/kakao-relay/backfill')).status === 401);
    x = await call('GET', '/api/kakao-relay/backfill', null, { 'X-Relay-Token': 'k' });
    const b0 = x.body.messages[0];
    ok('날짜 줄로 연도 결정(2025년 12월)·시각 보존', b0.warnings[0].at === '2025-12-30T17:00+09:00' && b0.time === '오후 5:03' && b0.yearGuessed === false, b0);
    ok('날짜 없으면 연도 추정 표시', x.body.messages[1].yearGuessed === true);
    ok('실시간 기록·중복표와 섞이지 않음', !st.snapshot(1000).messages.some((m) => m.text === 'b2'));
    x = await call('DELETE', '/api/kakao-relay/backfill', null, { 'X-Relay-Token': 'k' });
    ok('분석 후 지우기', x.body.deleted === 2 && (await call('GET', '/api/kakao-relay/backfill', null, { 'X-Relay-Token': 'k' })).body.messages.length === 0, x);
    srv.close();
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
