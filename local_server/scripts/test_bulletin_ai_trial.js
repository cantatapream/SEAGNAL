/**
 * 참고사항 AI 시험(services/bulletin_ai_trial) · 관리자 창구(routes/bulletin_watch) · 「통보문 관찰」 탭(client/js/admin/admin_bulletin_watch.js) 검사.
 * 실행: node local_server/scripts/test_bulletin_ai_trial.js
 * 사용자 확정 2026-11-15: 「대표 표본 200건으로 확인해보자」 「서버에서 chat gpt가 돌아가도록 해놓았어 … 그것을 활용」 「통보문 관찰이라는 탭」 「ㄱ(누르면 바로)」.
 * 진행 중 일어날 수 있는 일을 하나씩 고정한다: 한 건씩 차례 · 멈춤(지금 건만 마치고) · 이어서(끝난 건 건너뜀·실패한 건 다시) ·
 *   연달아 3번 실패하면 멈춤 · 서버가 다시 뜨면 「진행 중」이 「멈춤」으로 · JSON 아닌 답 · 근거 문장이 원문에 없음 · 해역 못 읽음.
 * 실제 ChatGPT 는 부르지 않는다(가짜 ai 를 끼운다). 시각 의존 없음.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const T = require('../services/bulletin_ai_trial');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bat-')), 'state.json');

const ITEM_CANCEL = { id: 1, office: '부산청', 종류: '예비특보', rpt: '7', 호: '제10-8호', 발표: '2025-10-13 00:00', 본문: 'o 없음',
    참고사항: 'o 당초 어제(12일) 밤으로 예고되었던 동해남부남쪽먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제하나, 해안가 안전사고에 유의하기 바랍니다.',
    rule: { 빠짐: [], 시간바뀜: [], 새로: [], 시간지나끝남: [{ 해역: '동해남부남쪽안쪽먼바다', 시간창: '10-12 18:00~00:00', 다시나옴: [] }, { 해역: '동해남부남쪽바깥먼바다', 시간창: '10-12 18:00~00:00', 다시나옴: [] }, { 해역: '울산앞바다', 시간창: '10-12 18:00~00:00', 다시나옴: [] }] } };
const ITEM_EXT = { id: 2, office: '강원청', 종류: '예비특보', rpt: '7', 호: '제 3-19호', 발표: '2025-03-27 06:00', 본문: '…',
    참고사항: 'o 오늘(27일) 새벽으로 예고되었던 동해중부바깥먼바다의 풍랑 예비특보는 내일(28일) 오전으로 연장 발표합니다.',
    rule: { 빠짐: [], 시간바뀜: [], 새로: [{ 해역: '동해중부안쪽먼바다', 시간창: '03-28 06:00~12:00' }], 시간지나끝남: [{ 해역: '동해중부바깥먼바다', 시간창: '03-27 00:00~06:00', 다시나옴: ['03-28 06:00~12:00'] }] } };
const ITEM_WRN = { id: 3, office: '제주청', 종류: '특보', rpt: '6', 호: '제 7-24호', 발표: '2026-07-09 10:00', 본문: '(1) 풍랑주의보 발표 : 제주도남쪽바깥먼바다',
    참고사항: '○ 풍랑 경보 변경 가능 시점 (1) 제주도남쪽바깥먼바다: 11일 새벽(00시~06시)', rule: { 항목: [{ 종류: '풍랑주의보', 동작: '발표', 해역: ['제주도남쪽바깥먼바다'] }] } };

console.log('A. 지시문');
{
    const p = T.buildPrompt(ITEM_CANCEL);
    ok('참고사항·본문·통보문 머리가 들어감', p.includes(ITEM_CANCEL.참고사항) && p.includes('[본문]\no 없음') && p.includes('부산청 예비특보 제10-8호'));
    ok('해역은 원문 그대로·펼치지 말 것, 근거 문장은 그대로 복사', /펼치거나 바꾸거나 새로 만들지 마라/.test(p) && /한 글자도 바꾸지 않고/.test(p));
    ok('종류 목록·JSON 꼴 지시', T.KINDS.every((k) => p.includes(k)) && /"사건":\[/.test(p));
}

console.log('B. 해역 펼치기(규칙 — AI 는 안 펼친다)');
{
    const z = T.resolveZones;
    ok('묶음(부모, 부모) → 괄호 안 부모만', JSON.stringify(z('동해중부앞바다(강원중부앞바다, 강원남부앞바다)')) === JSON.stringify(['강원중부앞바다', '강원남부앞바다']));
    ok('「동해중부」의 「중」은 나눔표가 아님', z('동해중부앞바다(강원중부앞바다)') !== null);
    ok('「A 중 B(자식)」 → 그 부모', JSON.stringify(z('제주도서부앞바다 중 북서연안바다')) === JSON.stringify(['제주도서부앞바다']));
    ok('줄임 「X먼바다」 = 안쪽+바깥', JSON.stringify(z('동해중부먼바다')) === JSON.stringify(['동해중부안쪽먼바다', '동해중부바깥먼바다']));
    ok('줄임 「경북앞바다」 = 북부+남부', JSON.stringify(z('경북앞바다')) === JSON.stringify(['경북북부앞바다', '경북남부앞바다']));
    ok('「…와 …」 두 덩어리 다 펼침', z('동해남부북쪽먼바다와 경북남부앞바다').length === 3);
    ok('목록에 없는 표현은 못 읽음(null) — 지어내지 않음', z('가나다해상') === null && z('강원중.북부앞바다') === null);
    ok('① 묶음 이름은 그 관서 관할로 좁힘(수도권 「서해중부앞바다」 = 인천·경기만, 대전이면 충남만)', JSON.stringify(z('서해중부앞바다', { office: '수도권청' })) === JSON.stringify(['인천·경기북부앞바다', '인천·경기남부앞바다']) && JSON.stringify(z('서해중부앞바다', { office: '대전청' })) === JSON.stringify(['충남북부앞바다', '충남남부앞바다']));
    ok('③ 「위 구역」 = 이 통보문 본문 해역', JSON.stringify(z('위 구역', { bodyZones: ['제주도서부앞바다'] })) === JSON.stringify(['제주도서부앞바다']));
    ok('④ 「X해상」 = X앞바다 묶음 + X…먼바다, 끝 조사 「의」 뗌', JSON.stringify(z('동해남부남쪽해상', { office: '부산청' })) === JSON.stringify(['동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다']) && z('동해중부해상의', { office: '강원청' }).length === 5);
    ok('④ 「제주도북동연안바다」(「앞바다 중」 빠짐) → 그 부모', JSON.stringify(z('제주도북동연안바다', { office: '제주청' })) === JSON.stringify(['제주도동부앞바다']));
    ok('④ 「제주도앞바다(북부앞바다 제외)」 줄인 이름 제외', !z('제주도앞바다(북부앞바다 제외)', { office: '제주청' }).includes('제주도북부앞바다') && z('제주도앞바다(북부앞바다 제외)', { office: '제주청' }).length === 3);
    ok('육상 지역 표현은 걸러 냄', T.isLand('충청남도(태안, 당진)') && T.isLand('제주도(추자도)') && T.isLand('울릉도.독도') && !T.isLand('제주도서부앞바다'));
}

console.log('C. 검산');
{
    const c1 = T.checkOne(ITEM_CANCEL, { 사건: [{ 종류: '예비취소', 해역표현: '동해남부남쪽먼바다', 시간_전: '어제(12일) 밤', 시간_후: null, 근거문장: '동해남부남쪽먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제하나' }] });
    ok('끝난 뒤 나온 취소 문장 = 규칙 「시간 지나 끝남(다시 안 나옴)」과 일치', c1.판정[0].판정 === '일치' && c1.근거있음 === 1, c1);
    ok('규칙은 끝났는데 AI 가 말 안 한 해역은 따로 남김(울산앞바다)', c1.규칙만.join() === '울산앞바다');
    const c2 = T.checkOne(ITEM_EXT, { 사건: [{ 종류: '예비연장', 해역표현: '동해중부바깥먼바다', 시간_전: '오늘(27일) 새벽', 시간_후: '내일(28일) 오전', 근거문장: '동해중부바깥먼바다의 풍랑 예비특보는 내일(28일) 오전으로 연장 발표합니다.' }] });
    ok('연장 = 규칙 「끝난 뒤 다시 나옴」과 일치', c2.판정[0].판정 === '일치', c2);
    const c3 = T.checkOne(ITEM_EXT, { 사건: [{ 종류: '예비취소', 해역표현: '동해중부바깥먼바다', 근거문장: '없는 문장' }] });
    ok('취소라 했지만 규칙상 다시 나왔으면 불일치 + 근거 없음 표시', c3.판정[0].판정 === '불일치' && c3.근거없음 === 1, c3);
    const c4 = T.checkOne(ITEM_CANCEL, { 사건: [{ 종류: '예비취소', 해역표현: '가나다해상', 근거문장: '동해남부남쪽' }] });
    ok('규칙이 못 펼친 표현은 「해역 못 읽음」(지어낸 해역으로 일치 판정하지 않음)', c4.판정[0].판정 === '해역 못 읽음' && c4.해역못읽음.join() === '가나다해상');
    const c6 = T.checkOne(ITEM_CANCEL, { 사건: [{ 종류: '예비연장', 해역표현: '충청남도(태안, 당진)', 근거문장: '동해남부남쪽' }] });
    ok('육상 지역은 「육상(뺌)」 — 비교·못 읽음에 넣지 않음', c6.판정[0].판정 === '육상(뺌)' && !c6.해역못읽음.length);
    const ITEM_LAG = { ...ITEM_CANCEL, id: 9, 참고사항: '제주도북동연안바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다.', office: '제주청', rule: { 빠짐: [], 시간바뀜: [], 새로: [], 시간지나끝남: [], 직전빠짐: [{ 해역: '제주도동부앞바다', 시간창: '07-01 06:00~12:00' }] } };
    const c7 = T.checkOne(ITEM_LAG, { 사건: [{ 종류: '예비취소', 해역표현: '제주도북동연안바다', 근거문장: '제주도북동연안바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제합니다.' }] });
    ok('취소 문장이 목록 정리보다 한 통보문 늦게 와도(직전 3시간 안 빠짐) 일치', c7.판정[0].판정 === '일치', c7);
    const c5 = T.checkOne(ITEM_WRN, { 사건: [{ 종류: '등급변경가능성', 해역표현: '제주도남쪽바깥먼바다', 시간_후: '11일 새벽(00시~06시)', 근거문장: '(1) 제주도남쪽바깥먼바다: 11일 새벽(00시~06시)' }] });
    ok('목록으로 확인 못 하는 종류는 「비교 기준 없음」', c5.판정[0].판정 === '비교 기준 없음');
    ok('사건 배열이 없으면 꼴 틀림', T.checkOne(ITEM_CANCEL, { 요약: 'x' }).꼴 === false);
}

(async () => {
    console.log('D. 실행기 — 차례·멈춤·이어서·실패');
    const answer = (item) => ({ success: true, response: { text: '```json\n' + JSON.stringify({ 사건: [], 요약: '건 ' + item }) + '\n```' } });
    {
        const calls = []; let inFlight = 0, maxInFlight = 0;
        const ai = async (prompt) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); calls.push(prompt); await new Promise((r) => setTimeout(r, 5)); inFlight--; return answer(calls.length); };
        const file = tmpFile();
        const t = T.createTrial({ ai, sample: [ITEM_CANCEL, ITEM_EXT, ITEM_WRN], file, sleep: async () => {}, gapMs: 0 });
        const s0 = t.start();
        ok('시작하면 「진행 중」', s0.status === 'running' && s0.total === 3);
        ok('진행 중에 다시 눌러도 두 번 돌지 않음', t.start().status === 'running');
        await t.done();
        const s = t.status();
        ok('한 건씩 차례로(동시에 2건 이상 안 보냄)', maxInFlight === 1 && calls.length === 3);
        ok('다 끝나면 「다 끝남」, 코드 울타리(```json) 벗겨 읽음', s.status === 'done' && s.done === 3 && t.results()[0].rec.parsed.요약 === '건 1', s);
        ok('진행은 파일에 남음', JSON.parse(fs.readFileSync(file, 'utf8')).results['3'].ok === true);
        const t2 = T.createTrial({ ai, sample: [ITEM_CANCEL, ITEM_EXT, ITEM_WRN], file, sleep: async () => {}, gapMs: 0 });
        t2.start(); await t2.done();
        ok('다시 시작해도 끝난 건은 다시 안 보냄', calls.length === 3);
    }
    {
        let n = 0; const file = tmpFile();
        let t;
        const ai = async () => { n++; if (n === 1) t.stop(); return answer(n); };
        t = T.createTrial({ ai, sample: [ITEM_CANCEL, ITEM_EXT, ITEM_WRN], file, sleep: async () => {}, gapMs: 0 });
        t.start(); await t.done();
        ok('멈춤 = 지금 건만 마치고 섬', n === 1 && t.status().status === 'stopped' && t.status().done === 1 && /관리자가 멈춤/.test(t.status().stopReason));
        const t2 = T.createTrial({ ai: async () => { n++; return answer(n); }, sample: [ITEM_CANCEL, ITEM_EXT, ITEM_WRN], file, sleep: async () => {}, gapMs: 0 });
        t2.start(); await t2.done();
        ok('다시 시작하면 멈춘 곳부터 이어서', n === 3 && t2.status().status === 'done');
    }
    {
        const file = tmpFile(); let n = 0;
        const t = T.createTrial({ ai: async () => { n++; return { success: false, error: 'VM 작업자 연결 없음' }; }, sample: [ITEM_CANCEL, ITEM_EXT, ITEM_WRN, { ...ITEM_WRN, id: 4 }], file, sleep: async () => {}, gapMs: 0 });
        t.start(); await t.done();
        const s = t.status();
        ok('연달아 3번 실패하면 멈추고(4번째는 안 보냄) 까닭을 남김', n === 3 && s.status === 'stopped' && /연달아 3번 실패/.test(s.stopReason) && s.lastError === 'VM 작업자 연결 없음', s);
        const t2 = T.createTrial({ ai: async () => answer(9), sample: [ITEM_CANCEL, ITEM_EXT, ITEM_WRN, { ...ITEM_WRN, id: 4 }], file, sleep: async () => {}, gapMs: 0 });
        t2.start(); await t2.done();
        ok('다시 시작하면 실패한 건을 다시 해서 끝남', t2.status().status === 'done' && t2.status().failed === 0);
    }
    {
        const file = tmpFile();
        const t = T.createTrial({ ai: async () => ({ success: true, response: { text: '죄송하지만 JSON 이 아닙니다' } }), sample: [ITEM_CANCEL], file, sleep: async () => {}, gapMs: 0 });
        t.start(); await t.done();
        ok('JSON 이 아닌 답은 실패로(까닭 남김)', t.results()[0].rec.ok === false && /JSON/.test(t.results()[0].rec.error));
        fs.writeFileSync(file, JSON.stringify({ status: 'running', results: {} }));
        const t2 = T.createTrial({ ai: async () => answer(1), sample: [ITEM_CANCEL], file });
        ok('서버가 다시 뜨면 「진행 중」이던 것은 「멈춤」으로(혼자 다시 돌지 않음)', t2.status().status === 'stopped');
    }

    console.log('E. 보고서');
    {
        const rows = [
            { item: ITEM_CANCEL, rec: { ok: true, ms: 12000, parsed: { 사건: [{ 종류: '예비취소', 해역표현: '동해남부남쪽먼바다', 시간_전: '어제(12일) 밤', 근거문장: '동해남부남쪽먼바다의 풍랑 예비특보는 발표 가능성이 낮아져 해제하나' }], 요약: '취소' } } },
            { item: ITEM_EXT, rec: { ok: false, error: 'codex 시간초과' } },
            { item: ITEM_WRN, rec: null },
        ];
        const md = T.reportMarkdown(rows, { status: 'stopped', total: 3, done: 1, failed: 1, stopReason: '관리자가 멈춤' });
        ok('요약: 진행·근거 문장·판정 수', /진행: 1\/3건 끝남 · 실패 1건/.test(md) && /근거 문장이 원문에 그대로 있음 1개/.test(md) && /판정: 일치 1/.test(md), md.slice(0, 700));
        ok('건마다 원문·규칙 결과·AI 해석·판정', /\*\*참고사항 원문\*\*/.test(md) && /시간 지나 끝남: 동해남부남쪽안쪽먼바다/.test(md) && /\[예비취소\] 「동해남부남쪽먼바다」.*\*\*일치\*\*/.test(md));
        ok('실패·아직 안 함도 그대로 보임', /AI\*\*: 실패 — codex 시간초과/.test(md) && /AI\*\*: 아직 안 함/.test(md));
        ok('부록에 원본 JSON 줄', /```jsonl[\s\S]*"id":1/.test(md));
    }

    console.log('F. 관리자 창구');
    {
        const { createRouter } = require('../routes/bulletin_watch');
        const fake = { s: { status: 'idle', total: 200, done: 0, failed: 0 }, status() { return this.s; }, start() { this.s = { ...this.s, status: 'running' }; return this.s; }, stop() { return this.s; }, report: () => '# 통보문 참고사항 AI 시험 결과' };
        const router = createRouter({ watch: { days: () => [], readDay: () => [] }, trial: fake, authorize: (q, r, n) => n() });
        const handle = (method, p) => { const l = router.stack.find((x) => x.route && x.route.path === p && x.route.methods[method]); const res = { h: {}, set(k, v) { this.h[k] = v; }, json(o) { this.body = o; }, send(b) { this.body = b; } }; l.route.stack.at(-1).handle({ query: {} }, res); return res; };
        ok('상태', handle('get', '/api/admin/bulletin-ai-trial').body.total === 200);
        ok('시작', handle('post', '/api/admin/bulletin-ai-trial/start').body.status === 'running');
        ok('보고서 = 마크다운 첨부', /markdown/.test(handle('get', '/api/admin/bulletin-ai-trial/report.md').h['Content-Type']));
        const real = createRouter({ watch: { days: () => [], readDay: () => [] }, trial: fake });
        const l = real.stack.find((x) => x.route && x.route.path === '/api/admin/bulletin-ai-trial/start');
        ok('시작·멈춤은 관리자 인증을 거침(기본 인증이 앞에 붙음)', l.route.stack.length === 2);
    }

    console.log('G. 「통보문 관찰」 탭');
    {
        const root = path.join(__dirname, '..', '..');
        const adminJs = fs.readFileSync(path.join(root, 'client/js/admin/admin.js'), 'utf8');
        const html = fs.readFileSync(path.join(root, 'client/index2.html'), 'utf8');
        ok('특보 관리에 「통보문 관찰」 탭(카톡 중계 다음)', /id: 'kakao-relay'[^\n]*\n[^\n]*\n\s*\{ id: 'bulletin-watch', name: '통보문 관찰'/.test(adminJs) && /topTabId === 'bulletin-watch'[\s\S]{0,120}renderBulletinWatchAdminTab/.test(adminJs));
        ok('스크립트는 admin.js 뒤·카톡 중계 다음에 실림', html.indexOf('js/admin/admin_bulletin_watch.js') > html.indexOf('js/admin/admin_kakao_relay.js') && html.indexOf('js/admin/admin_kakao_relay.js') > html.indexOf('js/admin/admin.js'));
        ok('카톡 중계 탭에는 관찰기록 버튼이 없음(옮김)', !/통보문 관찰기록/.test(fs.readFileSync(path.join(root, 'client/js/admin/admin_kakao_relay.js'), 'utf8')));
        const sandbox = { window: {}, document: { getElementById: () => null }, console, setTimeout, URL: {}, fetch: async () => ({ ok: true, json: async () => ({}) }) };
        vm.runInNewContext(fs.readFileSync(path.join(root, 'client/js/admin/admin_bulletin_watch.js'), 'utf8'), sandbox);
        const c = { innerHTML: '' };
        sandbox.window.renderBulletinWatchAdminTab(c);
        ok('탭에 관찰기록 내려받기 + AI 시험 [시험 시작][멈춤][결과 내려받기] + 나리야 경고', /기록 내려받기/.test(c.innerHTML) && /시험 시작/.test(c.innerHTML) && /멈춤/.test(c.innerHTML) && /결과 내려받기/.test(c.innerHTML) && /나리야 답이 늦어질 수/.test(c.innerHTML));
        const txt = sandbox.window.__bwTrialText({ status: 'running', done: 37, total: 200, failed: 1, lastAt: '2026-11-15T13:41:00.000Z', stopReason: null });
        ok('상태 글: 진행 중 · 37/200 · 실패 1 · 마지막 응답 KST', /진행 중/.test(txt) && /37\/200 끝남/.test(txt) && /실패 1/.test(txt) && /11-15 22:41 KST/.test(txt), txt);
    }

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
