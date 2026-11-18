/**
 * 통보문 관찰기(services/bulletin_watch) · 내려받기(routes/bulletin_watch) 검사.
 * 실행: node local_server/scripts/test_bulletin_watch.js
 * 사용자 확정 2026-11-15: 「빈 통보문으로 올라왔을때에는 해당 통보문을 계속 확인하는 로직이 필요… 내용이 채워질때까지」.
 * 대기 중(빈 통보문을 기다리는 동안) 일어날 수 있는 일을 표로 열거해 하나씩 고정한다(CLAUDE.md 결정로그 「대기 중 상태 변화 전수 열거」):
 *   그대로 빔 · 일부만 채움 · 다 채움 · 번호(code)가 바뀌어 다시 올라옴 · 목록 글자만 바뀜 · 본문 받기 실패 · 목록 받기 실패 ·
 *   세션 끊김 · 로그인 거부 · 하루 넘게 빔 · 채운 뒤 고침 · 겹친 실행.
 * 시각은 고정값만 쓴다(시각 의존 테스트 금지).
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { createWatch, isEmpty } = require('../services/bulletin_watch');
const { reportMarkdown, createRouter } = require('../routes/bulletin_watch');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x) : '')); } };
const T0 = Date.parse('2026-11-14T03:00:00Z');   // 12:00 KST
// 실제 꼴 번호(4번째 칸 = 발표시각) — 「사라짐」 판정이 이 시각으로 목록 기간 안쪽인지 본다
const code = (n, fc = '202611141200', rpt = '6', stn = '184') => `${rpt}|${stn}|${n}|${fc}|4|${fc}00`;
const C0 = code(10), C1 = code(11), C2 = code(12), C9 = code(19, '202611141200', '6', '109'), Y1 = code(21, '202611141200', '7');

/** 가짜 dmdw: lists['184|6'] = [{code, value}], details[code] = result. 호출 수를 센다. */
function fakeDmdw() {
    const f = { lists: {}, details: {}, calls: { list: 0, detail: 0, login: 0 }, failList: null, failDetail: new Set(), loginFail: false, loseSessionOnce: false };
    f.login = async () => { f.calls.login++; if (f.loginFail) throw new Error('로그인 거부(statecode=11)'); };
    f.post = async (p, form) => {
        if (f.loseSessionOnce) { f.loseSessionOnce = false; throw Object.assign(new Error('세션 끊김 302'), { sessionLost: true }); }
        if (p.endsWith('List.json')) {
            f.calls.list++;
            const k = form.stnId + '|' + form.rpt;
            if (f.failList === k) throw new Error('HTTP 500');
            if (form.rpt === '6' && form.wrnKindNm !== '') throw new Error('종류를 거르면 안 된다');
            return f.lists[k] || [];
        }
        f.calls.detail++;
        if (f.failDetail.has(form.rpt)) throw new Error('timeout');
        return { result: f.details[form.rpt] || null };
    };
    return f;
}
function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-'));
    const f = fakeDmdw();
    let t = T0;
    const w = createWatch({ post: f.post, login: f.login, now: () => t, dir, sleep: async () => {}, gapMs: 0 });
    const events = () => w.days().flatMap((d) => w.readDay(d));
    return { f, w, dir, tick: (m) => { t += m * 60e3; }, events, kinds: () => events().map((e) => e.kind) };
}
const FULL6 = { t1Title: '제11-1호', t1: '풍랑주의보 발표', t2: '(1) 풍랑주의보 발표 : 제주도남쪽바깥먼바다', t6: 'o 풍랑주의보 : 제주도남쪽바깥먼바다', tmIn: '2026-11-14 12:00:00.0' };
const EMPTY6 = { t1Title: '제11-1호', t1: '', t2: '', t6: '', tmIn: '2026-11-14 12:00:00.0' };

console.log('A. 빈 판정');
ok('특보: 제목·해당구역·발효 중 칸 중 하나라도 비면 빈 것', isEmpty('6', EMPTY6) && isEmpty('6', { ...FULL6, t2: '<br>' }) && !isEmpty('6', FULL6));
ok('예비: 목록·유효시각 칸 중 하나라도 비면 빈 것', isEmpty('7', { t4: '', t5: '2026-11-14 23:58' }) && !isEmpty('7', { t4: 'o 없음', t5: '2026-11-14 23:58' }));
ok('본문이 없으면(null) 빈 것', isEmpty('6', null));

(async () => {
    console.log('B. 내용이 있는 새 통보문');
    {
        const s = setup();
        s.f.lists['184|6'] = [{ code: C1, value: '[ 특보 ] 제11-1호 : 2026.11.14.12:00 / 풍랑주의보 발표 (*)' }];
        s.f.details[C1] = FULL6;
        await s.w.run();
        const e = s.events()[0];
        ok('「새 통보문」 1건(첫 회차라 이미 있던 것 표시), 내용 있음, 본문 원본 그대로 저장', e.kind === 'new' && e.baseline === true && e.empty === false && e.result.t2 === FULL6.t2 && /제주청/.test(e.설명));
        ok('목록은 관서 8곳 × (특보·예비) = 16번, 특보는 종류를 거르지 않음', s.f.calls.list === 16);
        const d0 = s.f.calls.detail;
        s.tick(1); await s.w.run();
        ok('1분 뒤에는 본문을 다시 받지 않음(내용 있음)', s.f.calls.detail === d0);
        s.tick(2); await s.w.run();
        ok('3분째 한 번 다시 확인', s.f.calls.detail === d0 + 1);
        s.tick(7); await s.w.run();
        ok('10분째 한 번 더 확인', s.f.calls.detail === d0 + 2);
        s.tick(5); await s.w.run();
        ok('그 뒤로는 안 받음', s.f.calls.detail === d0 + 2);
        ok('바뀐 게 없으면 기록 없음', s.kinds().join() === 'new');
    }

    console.log('B3. 3일 전부터 받기');
    {
        const s = setup(); const seen = [];
        const post0 = s.f.post; s.f.post = async (p, form) => { if (p.endsWith('List.json')) seen.push(form.startDate + '~' + form.endDate); return post0(p, form); };
        const w = createWatch({ post: s.f.post, login: s.f.login, now: () => T0, dir: s.dir, sleep: async () => {}, gapMs: 0 });
        await w.run();
        ok('목록은 3일 전 날짜부터 오늘까지(이미 발표·발효된 특보부터)', seen.length === 16 && seen.every((x) => x === '20261111~20261114'), seen[0]);
    }
    {
        const s = setup();
        const OLD = code(30, '202611110100');   // 기간 시작(11-11 00시) 바로 안쪽 — 곧 저절로 빠질 것
        s.f.lists['184|6'] = [{ code: OLD, value: 'old' }, { code: C1, value: 'v1' }]; s.f.details[OLD] = FULL6; s.f.details[C1] = FULL6;
        await s.w.run();
        s.f.lists['184|6'] = [{ code: C1, value: 'v1' }];   // 날짜가 넘어가 목록 기간 밖으로 빠짐
        s.tick(1); await s.w.run();
        ok('기간 끝자락에서 저절로 빠진 옛 통보문은 「사라짐」으로 안 봄', !s.kinds().includes('gone'));
        s.tick(4 * 24 * 60); await s.w.run();
        s.f.lists['184|6'] = [{ code: C1, value: 'v1' }];
        s.tick(2 * 24 * 60); await s.w.run();
        ok('목록에 아직 있는 통보문은 오래돼도 「새 통보문」으로 다시 잡지 않음', s.kinds().filter((k) => k === 'new').length === 2);
    }
    {   // 목록에서 빠진 통보문도 처음 본 뒤 10일까지 들고 있는다(사용자 결정 2026-11-18 「10일로 하자」 — 통보문 없이 이어지는 특보가 계산에서 빠지지 않게)
        const s = setup();
        const OLD = code(31, '202611110100');
        s.f.lists['184|6'] = [{ code: OLD, value: 'old' }, { code: C1, value: 'v1' }]; s.f.details[OLD] = FULL6; s.f.details[C1] = FULL6;
        await s.w.run();
        s.f.lists['184|6'] = [{ code: C1, value: 'v1' }];
        const has = () => s.w.bulletins().some((b) => b.code === OLD);
        s.tick(6 * 24 * 60); await s.w.run();
        ok('목록에서 빠지고 6일이 지나도 본문을 들고 있음(종전 5일이면 지워졌다)', has());
        s.tick(3 * 24 * 60 + 23 * 60); await s.w.run();
        ok('9일 23시간째까지 들고 있음', has());
        s.tick(2 * 60); await s.w.run();
        ok('10일이 넘으면 지움 · 목록에 남아 있는 통보문은 그대로', !has() && s.w.bulletins().some((b) => b.code === C1));
    }

    console.log('B4. 본문 없는 옛 기록 채우기');
    {
        const s = setup();
        s.f.lists['184|6'] = [{ code: C1, value: 'v1' }]; s.f.details[C1] = FULL6;
        await s.w.run();
        const st = JSON.parse(fs.readFileSync(path.join(s.dir, 'state.json'), 'utf8'));
        delete st.seen[C1].result; fs.writeFileSync(path.join(s.dir, 'state.json'), JSON.stringify(st));   // 01:05 이전에 본 기록 흉내
        const w2 = createWatch({ post: s.f.post, login: s.f.login, now: () => T0 + 60e3, dir: s.dir, sleep: async () => {}, gapMs: 0 });
        ok('옛 기록은 bulletins() 에 안 나옴(본문 없음)', w2.bulletins().length === 0);
        const d = s.f.calls.detail; await w2.run();
        ok('다음 회차에 본문을 한 번 다시 받아 채움 → bulletins() 에 나옴', s.f.calls.detail === d + 1 && w2.bulletins().length === 1 && w2.bulletins()[0].result.t2 === FULL6.t2);
        const d2 = s.f.calls.detail; await w2.run();
        ok('채운 뒤엔 다시 안 받음', s.f.calls.detail === d2);
    }

    console.log('C. 빈 통보문 → 채워질 때까지 매분');
    {
        const s = setup();
        s.f.lists['184|6'] = [{ code: C1, value: '[ 특보 ] 제11-1호 : 2026.11.14.12:00 /  (*)' }];
        s.f.details[C1] = EMPTY6;
        await s.w.run();
        ok('처음 빈 채로 보면 「빈」 표시', s.events()[0].empty === true && /비어 있다/.test(s.events()[0].설명));
        let d = s.f.calls.detail;
        for (let i = 0; i < 4; i++) { s.tick(1); await s.w.run(); }
        ok('비어 있는 동안 매분 다시 받음(4분 → 4번 이상)', s.f.calls.detail - d >= 4);
        ok('그대로 비어 있으면 기록이 늘지 않음', s.kinds().join() === 'new');
        s.f.details[C1] = { ...EMPTY6, t1: '풍랑주의보 발표' };
        s.tick(1); await s.w.run();
        ok('일부만 채워지면 「내용 바뀜」(아직 빔)', s.events().at(-1).kind === 'detail_changed' && s.events().at(-1).empty === true);
        s.f.details[C1] = FULL6;
        s.tick(1); await s.w.run();
        const e = s.events().at(-1);
        ok('다 채워지면 「채워짐」 + 걸린 분(처음 빈 채로 본 뒤 6분)', e.kind === 'filled' && e.emptyMinutes === 6 && e.result.t2 === FULL6.t2, e);
        d = s.f.calls.detail;
        s.tick(1); await s.w.run();
        ok('채워진 뒤에는 매분 받지 않음', s.f.calls.detail === d);
        s.f.details[C1] = { ...FULL6, t6: 'o 풍랑경보 : 제주도남쪽바깥먼바다' };
        s.tick(2); await s.w.run();   // 채워진 뒤 3분 → 한 번 다시 확인
        ok('채운 뒤 고친 것도 다시 확인 때 「내용 바뀜」으로 남음', s.events().at(-1).kind === 'detail_changed' && s.events().at(-1).empty === false);
    }

    console.log('D. 번호가 바뀌어 다시 올라옴 · 목록 글자만 바뀜');
    {
        const s = setup();
        s.f.lists['184|6'] = [{ code: C1, value: 'v1' }];
        s.f.details[C1] = EMPTY6;
        await s.w.run();
        s.f.lists['184|6'] = [{ code: C2, value: 'v1' }];
        s.f.details[C2] = FULL6;
        s.tick(1); await s.w.run();
        const k = s.kinds();
        ok('옛 번호는 「목록에서 사라짐」(빈 채로 있던 것 표시), 새 번호는 「새 통보문」', k.includes('gone') && s.events().find((e) => e.kind === 'gone').wasEmpty === true && k.filter((x) => x === 'new').length === 2);
        s.tick(1); await s.w.run();
        ok('사라짐은 한 번만 기록', s.kinds().filter((x) => x === 'gone').length === 1);
        s.f.lists['184|6'] = [{ code: C2, value: 'v2' }];
        s.tick(1); await s.w.run();
        ok('목록 글자만 바뀌면 「목록 글자 바뀜」(전·후 함께)', s.events().at(-1).kind === 'list_changed' && s.events().at(-1).before === 'v1' && s.events().at(-1).after === 'v2');
    }

    console.log('E. 실패·세션');
    {
        const s = setup();
        s.f.lists['184|6'] = [{ code: C1, value: 'v1' }];
        s.f.details[C1] = FULL6;
        s.f.failDetail.add(C1);
        await s.w.run();
        ok('새 통보문 본문을 못 받으면 오류 기록 + 빈 것으로 보고 다음 분에 다시', s.kinds().includes('error') && s.events().find((e) => e.kind === 'new').empty === true);
        s.f.failDetail.clear();
        s.tick(1); await s.w.run();
        ok('다음 분에 받으면 「채워짐」으로 이어짐', s.events().at(-1).kind === 'filled');

        s.f.failList = '159|7';
        s.f.lists['184|6'] = [];   // C1 이 목록에서 빠졌지만
        s.tick(1); await s.w.run();
        ok('목록 하나를 못 받은 회차엔 「사라짐」을 판단하지 않음', !s.kinds().includes('gone') && s.events().at(-1).kind === 'error');
        s.f.failList = null;
        s.tick(1); await s.w.run();
        ok('목록을 다 받은 회차에 판단', s.kinds().includes('gone'));

        const before = s.f.calls.login;
        s.f.loseSessionOnce = true;
        s.tick(1); await s.w.run();
        ok('세션이 끊기면 다시 로그인하고 이어감(오류 없음)', s.f.calls.login === before + 1 && s.events().at(-1).kind !== 'error');
    }
    {
        const s = setup();
        s.f.loginFail = true;
        await s.w.run();
        const n1 = s.f.calls.login;
        ok('로그인 거부되면 오류 기록', s.kinds().every((k) => k === 'error') && s.kinds().length > 0);
        s.tick(1); await s.w.run();
        s.tick(10); await s.w.run();
        ok('거부 뒤 30분은 다시 로그인하지 않음(계정 잠김 방지)', s.f.calls.login === n1);
        s.f.loginFail = false;
        s.tick(20); await s.w.run();
        ok('30분 지나면 다시 시도해 정상', s.f.calls.login === n1 + 1 && s.f.calls.list > 0);
    }

    console.log('B2. 관찰 시작 때 이미 있던 통보문');
    {
        const s = setup();
        s.f.lists['184|6'] = [{ code: C0, value: 'v0' }];
        s.f.details[C0] = FULL6;
        await s.w.run();
        s.f.lists['184|6'].push({ code: C1, value: 'v1' }); s.f.details[C1] = FULL6;
        s.tick(1); await s.w.run();
        const ev = s.events();
        ok('첫 회차 것은 「이미 있던」 표시, 그 뒤 것은 진짜 새 통보문', ev[0].baseline === true && /이미 있던/.test(ev[0].설명) && ev[1].baseline === undefined && /새 통보문/.test(ev[1].설명));
        ok('보고서 요약의 새 통보문 수에서 뺌', /- 새 통보문: 1건/.test(reportMarkdown(ev, 'all')) && /이미 있던 통보문: 1건/.test(reportMarkdown(ev, 'all')));
    }
    {
        const s = setup();
        s.f.failList = '184|6';
        await s.w.run();
        s.f.failList = null; s.f.lists['109|6'] = [{ code: C9, value: 'v9' }]; s.f.details[C9] = FULL6;
        s.tick(1); await s.w.run();
        ok('목록을 다 못 받은 첫 회차 뒤에도 기준은 다음 온전한 회차에 선다', s.events().find((e) => e.kind === 'new').baseline === true);
    }

    console.log('F. 하루 넘게 빔 · 겹친 실행');
    {
        const s = setup();
        s.f.lists['184|7'] = [{ code: Y1, value: '< 예비 > 제11-1호' }];
        s.f.details[Y1] = { t4: '', t5: '' };
        await s.w.run();
        s.tick(24 * 60 + 1);
        const d = s.f.calls.detail; await s.w.run();
        ok('하루가 지나도 비어 있으면 그만 받음', s.f.calls.detail === d);
    }
    {
        const s = setup();
        const p1 = s.w.run(), p2 = s.w.run();
        const r2 = await p2; await p1;
        ok('앞 실행이 안 끝났으면 다음 실행은 건너뜀', r2.skipped === true);
    }

    console.log('G. 내려받기 보고서');
    {
        const s = setup();
        s.f.lists['184|6'] = [{ code: C1, value: 'v1' }];
        s.f.details[C1] = EMPTY6;
        await s.w.run();
        s.f.details[C1] = FULL6; s.tick(2); await s.w.run();
        const md = reportMarkdown(s.events(), 'all');
        ok('요약에 빈 통보문 수·채워짐·걸린 분', /처음 볼 때 비어 있던 통보문: 1건 · 그중 채워진 것: 1건 \(채워지기까지 2분\)/.test(md), md.slice(0, 600));
        ok('기록 시각은 한국 시각(+09:00)', s.events()[0].at === '2026-11-14T12:00:00.000+09:00', s.events()[0].at);
        ok('쉬운 설명 줄과 원본 JSON 줄이 함께', /\[빈 통보문이 채워짐\]/.test(md) && /```jsonl[\s\S]*"kind":"filled"/.test(md));
        const router = createRouter({ watch: { days: () => s.w.days(), readDay: (d) => s.w.readDay(d) }, authorize: (q, r, n) => n() });
        const layer = router.stack.find((l) => l.route && l.route.path === '/api/admin/bulletin-watch/report.md');
        const res = { h: {}, set(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; }, send(b) { this.body = b; } };
        layer.route.stack.at(-1).handle({ query: { day: 'bad' } }, res);
        ok('날짜 형식이 틀리면 400', res.code === 400);
        const res2 = { ...res, h: {}, code: undefined };
        layer.route.stack.at(-1).handle({ query: { day: 'all' } }, res2);
        ok('전체 내려받기 = 마크다운 첨부', /markdown/.test(res2.h['Content-Type']) && /attachment/.test(res2.h['Content-Disposition']) && /# 통보문 관찰 기록/.test(res2.body));
    }

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
