'use strict';
// ============================================================================
// [구독자 집계·죽은 등록표 점검] 시험 — node scripts/test_subscriber_audit.js
//   2026-11-18: 관리자 센터 「푸시 알림 구독자」가 명단 줄 수(등록표 개수)여서
//   알림 끈 사람·죽은 등록표·등록표 교체가 그대로 세어지던 것을 고쳤다.
//   여기서 고정하는 것: ①세는 기준 ②지울 때 사건 구분 ③점검이 「죽음」 코드만 지움
//   ④검사만 모드는 안 지움 ⑤실패가 기록에 남음 ⑥구독 요청의 사건 구분.
//   FCM 은 대역(가짜)을 쓴다 — 실제 발송·네트워크 없음. 시각 의존 없음(now 를 넘긴다).
// ============================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FILES } = require('../config/server_config');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subaudit-'));
FILES.SUBSCRIPTIONS = path.join(tmp, 'subscriptions.json');
FILES.SUBSCRIBER_EVENTS = path.join(tmp, 'subscriber_events.json');
FILES.SUBSCRIBER_AUDIT = path.join(tmp, 'subscriber_audit.json');
FILES.SUBSCRIBER_STATS = path.join(tmp, 'subscriber_stats.json');
const A = require('../services/subscriber_audit');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌ FAIL:', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const writeSubs = (subs) => fs.writeFileSync(FILES.SUBSCRIPTIONS, JSON.stringify(subs));
const readSubs = () => JSON.parse(fs.readFileSync(FILES.SUBSCRIPTIONS, 'utf8'));
const events = () => { if (!fs.existsSync(FILES.SUBSCRIBER_EVENTS)) return {}; const e = JSON.parse(fs.readFileSync(FILES.SUBSCRIBER_EVENTS, 'utf8')); return Object.values(e)[0] || {}; };
const resetEvents = () => { try { fs.unlinkSync(FILES.SUBSCRIBER_EVENTS); } catch (_) { } };
const fcm = (token, deviceId, opt, updatedAt) => ({ type: 'fcm', token, deviceId, options: opt || {}, updatedAt });
// 가짜 FCM: deadTokens 는 「죽음」, flakyTokens 는 일시 오류, 나머지는 성공. dry-run 인자를 기록한다.
const fakeMessaging = (deadTokens, flakyTokens) => {
    const calls = [];
    return {
        calls,
        send: async (msg, dryRun) => {
            calls.push({ token: msg.token, dryRun, hasNotification: !!msg.notification });
            if (deadTokens.includes(msg.token)) { const e = new Error('x'); e.code = 'messaging/registration-token-not-registered'; throw e; }
            if ((flakyTokens || []).includes(msg.token)) { const e = new Error('x'); e.code = 'messaging/server-unavailable'; throw e; }
            return 'id';
        }
    };
};

(async () => {
    const NOW = 1800000000000, DAY = 86400000;

    console.log('\n[1] countSubscribers — 세는 기준');
    const c = A.countSubscribers([
        fcm('t1', 'devA', {}, NOW - DAY),                    // 켬·최근
        fcm('t2', 'devA', {}, NOW - 100 * DAY),              // 같은 기기의 옛 등록표 → 1명으로
        fcm('t3', 'devB', { master: false }, NOW),           // 알림 끔
        fcm('t4', undefined, { master: true }, NOW - 40 * DAY), // 기기 id 없음·오래됨
        fcm('t5', undefined, {}, undefined),                 // 갱신 시각 없음
    ], NOW);
    ok('등록 기기 수 = 줄 수 5', c.total === 5, c);
    ok('실제 수신자 = 3 (같은 기기 1명·끈 사람 제외)', c.active === 3, c);
    ok('알림 끔 = 1', c.masterOff === 1, c);
    ok('최근 30일 접속 = 1', c.recent30 === 1, c);
    ok('빈 명단 = 전부 0', A.countSubscribers([], NOW).active === 0);

    console.log('\n[2] removeDead — 지울 때 사건 구분');
    resetEvents();
    writeSubs([fcm('old', 'devA'), fcm('new', 'devA'), fcm('gone', 'devB'), fcm('off', 'devC', { master: false }), fcm('keep', 'devD')]);
    const r = A.removeDead(new Set(['old', 'gone', 'off', 'not-in-file']));
    ok('3건 지움', r.removed === 3 && readSubs().length === 2, r);
    ok('같은 기기의 산 줄이 남으면 교체(이탈 아님)', r.replaced === 1, r);
    ok('알림 끈 줄은 이탈로 안 셈', r.off === 1, r);
    ok('이탈 1건만 expired 로 기록', r.expired === 1 && events().expired === 1, events());
    ok('남은 줄 = new·keep', readSubs().map(s => s.token).join() === 'new,keep');
    resetEvents();
    writeSubs([fcm('a', 'devA')]);
    ok('죽은 것이 없으면 아무것도 안 함', A.removeDead(new Set()).removed === 0 && readSubs().length === 1 && events().expired === undefined);
    writeSubs([fcm('a', 'devA'), fcm('b', 'devA')]);
    const r2 = A.removeDead(new Set(['a', 'b']));
    ok('같은 기기 줄 둘이 함께 죽으면 이탈은 1명(사람 수 기준)', r2.expired === 1 && r2.replaced === 1 && r2.removed === 2, r2);
    // 어떤 조합이든: 기록되는 이탈 = 실제 수신자 수가 줄어든 만큼
    const mix = [fcm('a', 'd1'), fcm('b', 'd1'), fcm('c', 'd2', { master: false }), fcm('d', 'd2'), fcm('e'), fcm('f', 'd3'), fcm('g', 'd3', { master: false })];
    [['a'], ['a', 'b'], ['c'], ['d'], ['c', 'd'], ['e', 'f'], ['g'], ['a', 'd', 'e', 'f', 'g']].forEach((ids) => {
        writeSubs(mix);
        const before = A.countSubscribers(mix).active;
        const rr = A.removeDead(new Set(ids));
        const after = A.countSubscribers(readSubs()).active;
        ok('지움 [' + ids.join() + '] → 이탈 ' + rr.expired + ' = 수신자 감소 ' + (before - after), rr.expired === before - after && rr.off >= 0 && rr.replaced >= 0, rr);
    });

    console.log('\n[3] runAudit — 검사만 모드');
    resetEvents();
    writeSubs([fcm('live1', 'd1'), fcm('dead1', 'd2'), fcm('flaky', 'd3'), fcm('dead2', 'd4', { master: false })]);
    let m = fakeMessaging(['dead1', 'dead2'], ['flaky']);
    const p = await A.runAudit({ apply: false, messaging: m });
    ok('성공', p.ok === true, p);
    ok('4건 검사·죽음 2·확인 못 함 1·삶 1', p.checked === 4 && p.dead === 2 && p.unknown === 1 && p.alive === 1, p);
    ok('전부 dry-run(검사만)으로 불렀다', m.calls.length === 4 && m.calls.every(x => x.dryRun === true));
    ok('알림 본문을 싣지 않았다', m.calls.every(x => !x.hasNotification));
    ok('검사만 → 명단 그대로', readSubs().length === 4);
    ok('검사만 → 사건 기록 없음', Object.keys(events()).length === 0, events());
    ok('마지막 점검 기록 남음(정리 기록은 아직 없음)', A.getStatus().lastRun.dead === 2 && A.getStatus().lastApplied === null);

    console.log('\n[4] runAudit — 정리 모드');
    m = fakeMessaging(['dead1', 'dead2'], ['flaky']);
    const q = await A.runAudit({ apply: true, trigger: 'cron', messaging: m });
    ok('죽은 2건만 지움 — 일시 오류(flaky)는 남김', readSubs().map(s => s.token).join() === 'live1,flaky', readSubs().map(s => s.token));
    ok('결과: 이탈 1 · 알림 끈 기기 1', q.expired === 1 && q.off === 1 && q.replaced === 0, q);
    ok('첫 정리는 backlog 로 기록(expired 아님)', events().backlog === 1 && !events().expired, events());
    ok('지우기 전 사본이 남는다(4줄)', JSON.parse(fs.readFileSync(FILES.SUBSCRIPTIONS.replace(/\.json$/, '.before_cleanup.json'), 'utf8')).length === 4);
    ok('정리 기록이 남는다', A.getStatus().lastApplied && A.getStatus().lastApplied.trigger === 'cron');
    ok('결과에 정리 뒤 숫자가 실린다', q.counts.total === 2 && q.counts.active === 2, q.counts);
    writeSubs([fcm('live1', 'd1'), fcm('dead3', 'd5')]);
    resetEvents();
    await A.runAudit({ apply: true, messaging: fakeMessaging(['dead3']) });
    ok('두 번째 정리부터는 expired 로 기록', events().expired === 1 && !events().backlog, events());

    console.log('\n[5] runAudit — 실패가 조용히 묻히지 않는다');
    const before = readSubs().length;
    const f = await A.runAudit({ apply: true, messaging: { send: async () => { const e = new Error('x'); e.code = 'messaging/mismatched-credential'; throw e; } } });
    ok('전부 인증 오류 → 한 줄도 안 지움 + 실패로 남음(성공으로 위장 안 함)', readSubs().length === before && f.ok === false && f.unknown === before, f);
    ok('오류 코드별 건수가 남는다', f.errorCodes['messaging/mismatched-credential'] === before, f.errorCodes);
    // ★FCM 이 전 등록표에 「죽음」을 돌려줄 때(프로젝트 쪽 404 도 같은 코드로 온다) 명단 전체를 지우면 안 된다.
    writeSubs([fcm('x1', 'e1'), fcm('x2', 'e2'), fcm('x3', 'e3')]);
    const allDead = await A.runAudit({ apply: true, messaging: fakeMessaging(['x1', 'x2', 'x3']) });
    ok('전부 「죽음」으로 나오면 지우지 않고 실패', readSubs().length === 3 && allDead.ok === false && allDead.dead === 3 && /지우지 않았습니다/.test(allDead.error), allDead);
    writeSubs([fcm('live1', 'd1')]);
    fs.writeFileSync(FILES.SUBSCRIPTIONS, '{깨진 파일');
    const g = await A.runAudit({ apply: true, messaging: fakeMessaging([]) });
    ok('명단을 못 읽으면 ok:false + 오류 글', g.ok === false && !!g.error, g);
    ok('실패가 마지막 점검 기록에 남는다', A.getStatus().lastRun.ok === false);
    ok('실패는 정리 기록을 덮지 않는다', A.getStatus().lastApplied && A.getStatus().lastApplied.ok === true);
    ok('점검이 끝나면 running 이 풀린다', A.getStatus().running === false);

    console.log('\n[6] subscribeEventType — 구독 요청의 사건 구분');
    // 라우터(/api/subscribe)와 같은 순서: 사건을 가린 뒤 명단에 넣는다.
    let list = [];
    const post = (e) => {
        const idx = list.findIndex(s => s.token === e.token);
        const ev = A.subscribeEventType(list, idx, e);
        if (idx !== -1) list[idx] = e; else list.push(e);
        return ev;
    };
    ok('새 기기 → subscribe', post(fcm('n1', 'devX', { master: true })) === 'subscribe');
    ok('같은 등록표 다시 등록(앱 실행) → 사건 없음', post(fcm('n1', 'devX', { master: true })) === null);
    ok('같은 기기의 새 등록표 → replaced (신규 아님)', post(fcm('n2', 'devX', { master: true })) === 'replaced');
    ok('한 줄뿐인 기기가 알림 끔 → unsubscribe', post(fcm('s1', 'devS', {})) === 'subscribe' && post(fcm('s1', 'devS', { master: false })) === 'unsubscribe');
    ok('끈 채로 다시 등록 → 사건 없음', post(fcm('s1', 'devS', { master: false })) === null);
    ok('다시 켬 → subscribe', post(fcm('s1', 'devS', { master: true })) === 'subscribe');
    ok('처음부터 끈 채 등록 → 사건 없음', post(fcm('n3', 'devY', { master: false })) === null);
    ok('기기 id 없는 새 등록표 → subscribe', post(fcm('n4', undefined, { master: true })) === 'subscribe');
    ok('옵션이 비어 있으면 켬으로 본다(발송 필터와 같다)', post(fcm('n5', 'devZ', {})) === 'subscribe');
    // 같은 기기의 옛 줄(켬)이 아직 남아 있을 때 현재 줄을 끄고 켜도 사람 수는 그대로 → 사건 없음
    list = [fcm('old', 'devQ'), fcm('cur', 'devQ')];
    ok('옛 줄이 남은 채 현재 줄 끔 → 사건 없음(수신자 수 그대로)', post(fcm('cur', 'devQ', { master: false })) === null);
    ok('그 상태에서 다시 켬 → 사건 없음', post(fcm('cur', 'devQ', {})) === null);
    list = [fcm('n1', 'devX'), fcm('n2', 'devX'), fcm('n3', 'devY', { master: false }), fcm('n4'), fcm('n5', 'devZ')];
    const cc = A.countSubscribers(list);
    ok('명단 5줄 · 실제 수신자 3(devX 1명 + n4 + devZ)', cc.total === 5 && cc.active === 3, cc);
    resetEvents();
    A.recordSubscriberEvent(null, 1);
    ok('사건 없음(null)은 기록하지 않는다', Object.keys(events()).length === 0, events());
    // 라우터가 실제로 이 함수를 쓰는지(글자 확인) — 라우터를 직접 돌리면 실제 data/ 에 쓰므로 돌리지 않는다.
    const pushSrc = fs.readFileSync(path.join(__dirname, '..', 'routes', 'push.js'), 'utf8');
    ok('routes/push.js 가 subscribeEventType 을 쓴다', /recordSubscriberEvent\(subscriberAudit\.subscribeEventType\(subs, existingIndex, newEntry\), 1\)/.test(pushSrc));
    ok('routes/push.js 발송 뒤 정리 2곳이 removeDead 를 쓴다', (pushSrc.match(/subscriberAudit\.removeDead\(/g) || []).length === 2);

    console.log('\n[7] 일별 기록에 실제 수신자가 실린다');
    writeSubs(list);
    require('../services/subscriber_snapshot').takeSnapshot();
    const snap = Object.values(JSON.parse(fs.readFileSync(FILES.SUBSCRIBER_STATS, 'utf8')))[0];
    ok('total 5 · active 3 · masterOff 1', snap.total === 5 && snap.active === 3 && snap.masterOff === 1, snap);

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})();
