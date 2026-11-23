/**
 * 「AI 비교 시험」(services/ai_compare_trial) · 관리자 창구(routes/bulletin_watch) · 화면 카드(client/js/admin/admin_bulletin_ai.js drawCompare) 검사.
 * 실행: node local_server/scripts/test_ai_compare_trial.js
 * 사용자 2026-11-23: 「클로드는 하이쿠 - low, midium, 소넷 - low, midium … 업스테이지도 mini low, midium, high, pro low, midium, high로 테스트해서 각 도출된 결과를 보고 어떤 모델이 적절한지 판단해보자.」
 * 채점이 맞는지 고정한다: ② 시험 글 20건 모두 원문에서 바르게 뽑은 답은 「맞음」 · 업스테이지가 실제로 낸 틀린 답 6건은 「틀림」(까닭까지) ·
 *   ⑥ 실제 업스테이지 답([조고] 줄에 바람 얘기)은 「걸림」, 바른 답은 「통과」 · 진행(설정 10 × 글) · 멈춤 · 서버가 다시 뜨면 멈춤으로 · 보고서.
 * 실제 AI 는 부르지 않는다(가짜 call 을 끼운다). 시각 의존 없음.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const C = require('../services/ai_compare_trial');
const all = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'analysis', 'bulletin_survey', 'ai_compare_cases.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 400) : '')); } };
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-')), 'state.json');

// 원문에서 바르게 뽑은 답(A) · 업스테이지가 실제로 낸 틀린 답(wrong — 관리자 [통보문] AI 해석 기록 11-20~23)
const E=(종류,해역표현,근거문장,시간_후)=>({종류,해역표현,근거문장,시간_후:시간_후||null});
const A={
'광주청 제11-34호':[E('안내','남해서부서쪽먼바다','남해서부서쪽먼바다의 풍랑특보 발표(발효)현황은 제주지방기상청의 최신 특보통보문을 참고하시기 바랍니다.')],
'수도권청 제11-12호':[E('정확해제시각','서해중부먼바다','서해중부먼바다의 풍랑특보는 오늘(21일) 11시에 해제하나','오늘(21일) 11시')],
'강원청 제11-39호':[E('등급변경가능성','동해중부안쪽먼바다','(1) 동해중부안쪽먼바다: 24일 오전(06시~12시)','24일 오전(06시~12시)'),E('등급변경가능성','동해중부바깥먼바다','(2) 동해중부바깥먼바다: 24일 오전(06시~12시)','24일 오전(06시~12시)')],
'부산청 제11-10호(예비)':[E('예비추가','동해남부남쪽안쪽먼바다, 동해남부남쪽바깥먼바다, 남해동부안쪽먼바다','o 11월 24일 새벽(00시~06시) : 동해남부남쪽안쪽먼바다, 동해남부남쪽바깥먼바다, 남해동부안쪽먼바다','11월 24일 새벽(00시~06시)'),E('예비추가','남해동부바깥먼바다','o 11월 24일 오전(09시~12시) :  남해동부바깥먼바다','11월 24일 오전(09시~12시)')],
'대구청 제11-14호(예비)':[E('예비추가','동해남부앞바다(경북남부앞바다, 경북북부앞바다)','o 11월 24일 오전(09시~12시) : 동해남부앞바다(경북남부앞바다, 경북북부앞바다)','11월 24일 오전(09시~12시)')],
'대전청 제11-6호(예비)':[E('예비취소','특정관리해역','특정관리해역의 풍랑특보 발표 가능성이 낮아 풍랑 예비특보는 해제합니다.')],
'수도권청 제11-5호(예비)':[E('예비취소','서해중부바깥먼바다','오늘(15일) 오후로 예고된 서해중부바깥먼바다의 풍랑 예비특보는 가능성이 낮아져 해제하나')],
'제주청 제11-11호(예비)':[E('예비취소','제주도동부앞바다, 제주도남동쪽안쪽먼바다','어제(16일) 밤으로 예고된 제주도동부앞바다, 제주도남동쪽안쪽먼바다의 풍랑 예비특보는 가능성이 낮아져 해제하나')],
'광주청 제11-11호(예비)':[E('예비취소','남해서부동쪽먼바다','어제(16일) 밤으로 예고된 남해서부동쪽먼바다의 풍랑 예비특보는 가능성이 낮아져 해제하나'),E('안내','남해서부서쪽먼바다','남해서부서쪽먼바다의 풍랑특보 발표(발효)현황은 제주지방기상청의 최신 특보통보문을 참고하시기 바랍니다.')],
'대구청 제11-32호':[E('해제예고연장','동해남부북쪽안쪽먼바다와 경북남부앞바다','오늘(17일) 오전으로 해제 예고되었던 동해남부북쪽안쪽먼바다와 경북남부앞바다의 풍랑주의보 해제 예고를 오늘(17일) 늦은 오후로 연장합니다.','오늘(17일) 늦은 오후')],
'대전청 제11-6호':[E('해제예고연장','충남앞바다','오늘(19일) 밤(21~24시)으로 해제 예고되었던 충남앞바다 풍랑주의보는 내일(20일) 늦은 오후(15~18시)로 해제 예고를 연장하니','내일(20일) 늦은 오후(15~18시)')],
'제주청 제11-43호':[E('등급변경가능성','제주도남쪽바깥먼바다','(1) 제주도남쪽바깥먼바다: 20일 새벽(00시~06시)','20일 새벽(00시~06시)')],
'대구청 제11-36호':[E('등급변경가능성','동해남부북쪽안쪽먼바다','(3) 동해남부북쪽안쪽먼바다: 19일 새벽(00시~06시)','19일 새벽(00시~06시)'),E('등급변경가능성','동해남부북쪽바깥먼바다','(4) 동해남부북쪽바깥먼바다: 19일 새벽(00시~06시)','19일 새벽(00시~06시)')],
'제주청 제11-12호(예비)':[E('예비추가','제주도남동쪽안쪽먼바다','o 11월 18일 새벽(00시~06시) : 제주도남동쪽안쪽먼바다','11월 18일 새벽(00시~06시)'),E('예비추가','제주도앞바다(제주도동부앞바다, 제주도서부앞바다)','o 11월 18일 오전(06시~12시) : 제주도앞바다(제주도동부앞바다, 제주도서부앞바다)','11월 18일 오전(06시~12시)')],
'부산청 제11-8호(예비)':[E('예비추가','남해동부안쪽먼바다','o 11월 18일 오후(12시~18시) : 남해동부안쪽먼바다','11월 18일 오후(12시~18시)'),E('예비추가','동해남부남쪽안쪽먼바다, 동해남부남쪽바깥먼바다','o 11월 18일 밤(18시~24시) :  동해남부남쪽안쪽먼바다, 동해남부남쪽바깥먼바다','11월 18일 밤(18시~24시)')],
'광주청 제11-14호(예비)':[E('예비연장','서해남부북쪽안쪽먼바다','오늘(17일) 오후로 예고된 서해남부북쪽안쪽먼바다의 풍랑 예비특보는 내일(18일) 새벽(00~06시)으로 연장하여 발표합니다.','내일(18일) 새벽(00~06시)')],
'광주청 제11-9호(예비)':[E('안내','남해서부서쪽먼바다','남해서부서쪽먼바다의 풍랑특보 발표(발효)현황은 제주지방기상청의 최신 특보통보문을 참고하시기 바랍니다.')],
'대전청 제11-5호':[E('특보발표가능성','위 구역','위 구역의 풍랑특보를 해제하나, 오늘 오후 다시 바람이 매우 강하게 불고 물결이 높아 질 수 있으니','오늘 오후')],
'대구청 제11-34호':[],
'제주청 제11-15호(예비)':[],
};
const wrong={
'광주청 제11-34호':[E('안내','남해서서부쪽먼바다','남해서서부쪽먼바다의 풍랑특보 발표(발효)현황은 제주지방기상청의 최신 특보통보문을 참고하시기 바랍니다.')],
'수도권청 제11-12호':[E('정확해제시각','서해중부먼바다','서해중부먼바다의 풍랑특보는 오늘(21일) 11시에 해제하나',null)],
'강원청 제11-39호':[E('등급변경가능성','동해중부안쪽먼바다','(1) 동해중부안쪽먼바다: 24일 오전(06시~12시)','24일 오전(06시~12시)'),E('등급변경가능성','동해중부바깥먼바다','○ 풍랑 경보 변경 가능 시점\n (2) 동해중부바깥먼바다: 24일 오전(06시~12시)','24일 오전(06시~12시)')],
'부산청 제11-10호(예비)':[E('예비추가','동해남부남쪽안쪽먼바다, 동해남부남쪽바깥먼바다, 남해동부안쪽먼바다','o 11월 24일 새벽(00시~06시) : 동해남부남쪽안쪽먼바다, 동해남부남쪽바깥먼바다, 남해동부안쪽먼바다',null),E('예비추가','남해동부바깥먼바다','o 11월 24일 오전(09시~12시) :  남해동부바깥먼바다',null)],
'대구청 제11-14호(예비)':[E('예비추가','동해남부앞바다(경북남부앞바다, 경북북부앞바다),','o 11월 24일 오전(09시~12시) : 동해남부앞바다(경북남부앞바다, 경북북부앞바다)',null)],
'대전청 제11-6호(예비)':[E('예비취소','충남앞바다','오늘(23일) 오전으로 예고되었던 충남앞바다 풍랑 예비특보에 맞춰 특정관리해역을 제외한 해역에 풍랑주의보는 발표하였으나, 특정관리해역의 풍랑특보 발표 가능성이 낮아 풍랑 예비특보는 해제합니다.')],
};

(async () => {
    console.log('A. ② 채점');
    ok('시험 글 20건 — 실수 5 · 표본 15(대전 11-6 예비는 모든 AI 가 같게 적어 표본 「어려운 글」로 옮김)', all.interpret.length === 20 && all.interpret.filter((c) => c.group === '실수').length === 5);
    const notOk = all.interpret.filter((c) => C.gradeInterpret(c, JSON.stringify({ 요약: 'x', 사건: A[c.id] })).verdict !== '맞음').map((c) => c.id);
    ok('원문에서 바르게 뽑은 답은 20건 모두 「맞음」(정답표가 원문으로 맞힐 수 있는 것이다)', !notOk.length, notOk);
    const g = (id) => C.gradeInterpret(all.interpret.find((c) => c.id === id), JSON.stringify({ 사건: wrong[id] }));
    ok('실제 틀린 답: 해역 이름 오타(광주 11-34) → 틀림(빠짐 + 근거 문장이 원문에 없음)', g('광주청 제11-34호').verdict === '틀림' && /빠짐: 안내/.test(g('광주청 제11-34호').reasons.join()));
    ok('실제 틀린 답: 해제 시각 빈칸(수도권 11-12) → 틀림', g('수도권청 제11-12호').verdict === '틀림' && /11시/.test(g('수도권청 제11-12호').reasons.join()));
    ok('실제 틀린 답: 근거 이어 붙임(강원 11-39) → 틀림(바깥먼바다 모자람)', g('강원청 제11-39호').verdict === '틀림' && /동해중부바깥먼바다/.test(g('강원청 제11-39호').reasons.join()));
    ok('실제 틀린 답: 예비 시각 빠뜨림(부산 11-10 · 대구 11-14) → 틀림', g('부산청 제11-10호(예비)').verdict === '틀림' && g('대구청 제11-14호(예비)').verdict === '틀림');
    ok('「충남앞바다」로 적은 답(대전 11-6 예비 — 업스테이지·클로드 모두)은 이제 사건 검사가 확인필요로 돌려 덮지 않는다 → 맞음(2026-11-23 checkEvent 고침)', g('대전청 제11-6호(예비)').verdict === '맞음' && g('대전청 제11-6호(예비)').events[0].판정 === '확인필요', g('대전청 제11-6호(예비)'));
    ok('JSON 이 아니거나 「사건」 이 없으면 실패', C.gradeInterpret(all.interpret[0], '모르겠다').verdict === '실패' && C.gradeInterpret(all.interpret[0], '{"요약":"x"}').verdict === '실패');
    ok('사건 없는 글(대구 11-34)에 자동 반영 후보를 지어내면 틀림', C.gradeInterpret(all.interpret.find((c) => c.id === '대구청 제11-34호'), JSON.stringify({ 사건: [{ 종류: '예비취소', 해역표현: '경북남부앞바다', 근거문장: 'x' }] })).verdict === '틀림');

    console.log('B. ⑥ 채점');
    ok('시험 글 10편 — 실수 1 · 표본 9 · 모두 바다 항목이 있다', all.seasummary.length === 10 && all.seasummary.filter((c) => c.group === '실수').length === 1);
    const j = all.seasummary.find((c) => c.id === '제주 11-23');
    const Z = [{ zone: '제주도남쪽먼바다 · 제주도앞바다(남부앞바다 제외) · 남해서부서쪽먼바다', period: '내일(24일) 새벽~', wind: '9~15', wave: '1.0~3.5' }, { zone: '제주도남부앞바다', period: '내일(24일) 새벽~', wind: '8~14', wave: '1.5~2.5' }];
    const 특 = { kind: '특보 가능성', text: '{{loc:제주도남쪽먼바다}} · {{loc:남해서부서쪽먼바다}}에 {{warn:풍랑특보가 발표될 가능성}}' };
    ok('실제 업스테이지 답([조고] 줄에 바람 얘기) → 걸림', C.gradeSea(j, JSON.stringify({ zones: Z, notes: [특, { kind: '조고', text: '{{loc:제주도남부앞바다}}에서 {{num:8~14m/s}}·{{num:1.5~2.5m}}의 바람이 강하게 불어 항해·조업 선박은 각별히 유의' }] })).verdict === '걸림');
    const good = C.gradeSea(j, '```json\n' + JSON.stringify({ zones: Z, notes: [특, { kind: '조고', text: '모레(25일)부터 대조기로 만조 시간대 {{loc:해안가 저지대}} 침수 가능성' }] }) + '\n```');
    ok('바른 답 → 통과 · 카드에 실릴 모양을 돌려준다(울타리 친 답도 꺼낸다)', good.verdict === '통과' && good.shown.zones.length === 2 && good.shown.notes.length === 2, good);
    ok('숫자 없는 제주 11-22 글은 빈 답도 통과하고 서버가 「바람·물결」 줄을 붙인다', (() => { const r = C.gradeSea(all.seasummary.find((c) => c.id === '제주 11-22'), '{"zones":[],"notes":[]}'); return r.verdict === '통과' && r.shown.notes[0].kind === '바람·물결'; })());
    ok('지시문은 운영과 같다(②: 참고사항 원문 · ⑥: 바다 글)', C.promptFor('interpret', all.interpret[0]).includes('남해서부서쪽먼바다의 풍랑특보') && C.promptFor('seasummary', j).includes('제주도남부앞바다에도'));

    console.log('C. 진행·멈춤·보고서');
    ok('설정 10가지 — 클로드 키1 하이쿠·소넷 × low·medium · 업스테이지 mini·pro × low·medium·high', C.VARIANTS.length === 10 && C.VARIANTS.filter((v) => v.id === 'claude1').length === 4
        && ['claude-haiku-5-5', 'claude-sonnet-5-5'].every((m) => ['low', 'medium'].every((e) => C.VARIANTS.some((v) => v.model === m && v.effort === e)))
        && ['solar-mini4', 'solar-pro4'].every((m) => ['low', 'medium', 'high'].every((e) => C.VARIANTS.some((v) => v.id === 'upstage' && v.model === m && v.effort === e))));
    const llm = require('../services/llm_chain');
    ok('설정마다 고르는 모델·노력이 운영 선택지 안이다', C.VARIANTS.every((v) => llm.isValidPick(v.id, { model: v.model, effort: v.effort })));
    const small = { interpret: all.interpret.slice(0, 2), seasummary: all.seasummary.slice(0, 1) };
    const calls = [];
    const fake = async (id, args, pick) => { calls.push(id + '|' + pick.model + '|' + pick.effort); if (pick.model === 'solar-mini4' && pick.effort === 'low') return { success: false, error: '429' };
        return { success: true, response: { text: args.contents.includes('바다') && !args.contents.includes('사건') ? '{"zones":[],"notes":[]}' : JSON.stringify({ 사건: A[small.interpret.find((c) => args.contents.includes(c.bulletin.result.t1Title)) ? small.interpret.find((c) => args.contents.includes(c.bulletin.result.t1Title)).id : ''] || [] }) } }; };
    const file = tmpFile();
    const t = C.createCompare({ call: fake, cases: small, file });
    t.start(['interpret', 'seasummary']);
    for (let k = 0; k < 200 && t.status().running; k++) await new Promise((r) => setTimeout(r, 5));
    const s = t.status();
    ok('설정 10 × 글 3 = 30번 불렀고 끝났다', calls.length === 30 && !s.running && s.done === 30 && s.total === 30, { n: calls.length, s });
    const mini = s.rows.find((r) => r.key === 'mini-low'), son = s.rows.find((r) => r.key === 'sonnet-medium');
    ok('설정별 요약: 호출 실패는 「실패」로 센다 · 다른 설정은 ② 맞음 2/2', mini.interpret.fail === 2 && son.interpret.ok === 2 && son.interpret.n === 2, s.rows);
    const md = C.reportMarkdown(t.results(), s, small);
    ok('보고서: 설정별 요약 표 · 글마다 설정별 판정과 답', /## ② 참고사항 해석 — 설정별 요약/.test(md) && /업스테이지 mini · low\*\* — 실패/.test(md) && /정답:/.test(md));
    const t2 = C.createCompare({ call: fake, cases: small, file });
    fs.writeFileSync(file, JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(file, 'utf8')), { running: true })));
    ok('서버가 다시 뜨면 「도는 중」이 멈춤으로(이어 돌리지 않는다 — 운영 키)', t2.status().running === false && /다시 떠서/.test(t2.status().stopped));
    const waiting = []; const slow = () => new Promise((r) => waiting.push(() => r({ success: false, error: 'x' })));
    const releaseAll = () => waiting.splice(0).forEach((f) => f());
    const t3 = C.createCompare({ call: slow, cases: small, file: tmpFile() });
    t3.start(['interpret']); t3.stop(); releaseAll();
    for (let k = 0; k < 200 && t3.status().running; k++) { await new Promise((r) => setTimeout(r, 5)); releaseAll(); }
    ok('멈추기 — 도는 건만 마치고 더 부르지 않는다', !t3.status().running && /멈춤/.test(t3.status().stopped) && t3.status().done <= 10, t3.status());

    console.log('D. 창구·화면');
    const rt = fs.readFileSync(path.join(__dirname, '..', 'routes', 'bulletin_watch.js'), 'utf8'), ui = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'admin', 'admin_bulletin_ai.js'), 'utf8');
    ok('관리자 창구 넷(상태·시작·멈춤·보고서) 모두 관리자 인증', ["'/api/admin/bulletin-ai/compare', authorize", "'/api/admin/bulletin-ai/compare/start', authorize", "'/api/admin/bulletin-ai/compare/stop', authorize", "'/api/admin/bulletin-ai/compare/report.md', authorize"].every((x) => rt.includes(x)));
    ok('화면: 시작 전에 부르는 횟수를 묻는다 · 도는 동안 10초마다 갱신 · 연결이 끊겨도 30초 뒤 다시 묻는다 · 결과 내려받기', /w\.confirm\('AI 를 ' \+ n \+ '번 부릅니다/.test(ui) && /setTimeout\(load, 10000\)/.test(ui) && /setTimeout\(load, 30000\)/.test(ui) && /compare\/report\.md/.test(ui));

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('검사 중 예외', e); process.exit(1); });
