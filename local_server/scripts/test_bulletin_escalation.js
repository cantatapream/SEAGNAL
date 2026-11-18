'use strict';
/**
 * ============================================================================
 * 파일명: local_server/scripts/test_bulletin_escalation.js
 * 역할  : 격상 가능성(services/bulletin_escalation) 검사 — 통보문 참고사항·날씨해설에서 「풍랑경보로 변경될 가능성」「태풍특보로 변경될 가능성」의
 *         해역·시점을 맞게 읽는지(토막 단위 · 「제외」 · 해역별 시간 · 월 넘김 · 못 푸는 이름은 통째로 안 씀), 지우는 때가 맞는지, AI 답을 지어낸 해역 없이 쓰는지.
 * 사용자 2026-11-18~19: 「제주도해상 그밖의 해상 등 어떤 상황에서 그 문구를 썻는지가 중요함. 해당 용어가 나온 전문을 확인해서 맥락을 읽어야함」
 *   「넓게 부른 안내 - 추천대로」 · 「격상의 경우에만 하고자함. 재발표는 제외」 · 「관리자페이지에서 어떤 ai 쓸건지 결정하는 부분도 ui 만들어야」
 * 문장 예시는 실제 통보문·날씨해설 원문(2025-01 ~ 2026-11)에서 옮겼다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_escalation.js · services/bulletin_docs.js(needed extra) · services/bulletin_ai.js(⑤ 설정) ·
 *                   analysis/bulletin_survey/raw(과거 통보문 전량 — 판독 수 고정) · 글자 확인: routes/weather.js · scheduler.js · client/js/forecast/alerts/{escalation,render,data}.js ·
 *                   client/index2.html · client/js/admin/admin_bulletin_ai.js
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh 의 SUITES
 * [로드 순서] 해당 없음(단독 실행: node local_server/scripts/test_bulletin_escalation.js)
 * ============================================================================
 */
const fs = require('fs'), os = require('os'), path = require('path');
process.env.BULLETIN_AI_CONFIG_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'esc-cfg-')), 'cfg.json');   // ⑤ 설정 검사가 운영 설정 파일을 건드리지 않게
const E = require('../services/bulletin_escalation');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 400) : '')); } };
const H = 36e5;
const T = (s) => Date.parse(s.replace(' ', 'T') + ':00+09:00');
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
/** 관찰기 통보문 꼴. B('제주청','6','제11-43호','2026-11-17 16:00', { t2, other }) */
const B = (office, rpt, ho, tm, o = {}) => ({ office, rpt, code: office + rpt + ho + tm, result: Object.assign({ t1Title: ho, tmFc: tm + ':00.0', tmIn: (o.tmIn || tm) + ':30.0', t1: '', t2: '', other: '' }, o, { tmIn: (o.tmIn || tm) + ':30.0' }) });
const N = (b) => E.readBulletin(b).notices;
const dm = (ms) => new Date(ms + 9 * H).toISOString().slice(5, 16).replace('T', ' ');

console.log('A. 해역 이름 풀기');
{
    ok('묶음(○○ 제외) — 제외한 해역을 뺀다(종전 풀이는 「제외」를 무시해 전부를 돌려줬다)',
        same(E.resolve('제주도앞바다(북부 제외)'), ['제주도동부앞바다', '제주도남부앞바다', '제주도서부앞바다']) && same(E.resolve('제주도앞바다(북부앞바다제외)'), ['제주도동부앞바다', '제주도남부앞바다', '제주도서부앞바다'])
        && E.resolve('제주도전해상(제주도서부앞바다 제외)').length === 6 && !E.resolve('제주도전해상(제주도서부앞바다 제외)').includes('제주도서부앞바다'));
    ok('묶음(○○, ○○) — 괄호 안 해역만(줄여 쓴 것도)', same(E.resolve('제주도앞바다(서부,동부)'), ['제주도서부앞바다', '제주도동부앞바다']) && same(E.resolve('제주도앞바다(제주도남부앞바다, 제주도서부앞바다)'), ['제주도남부앞바다', '제주도서부앞바다']));
    ok('넓게 부른 이름은 기상청이 쓴 그대로 전 해역(사용자 「추천대로」) — 제주도전해상 = 7곳', E.resolve('제주도전해상').length === 7);
    ok('줄임 이름: ○○먼바다 = 안쪽+바깥 · 제주도남쪽안쪽먼바다 = 남동·남서 안쪽 · 제주도남쪽먼바다 = 제주 먼바다 셋',
        same(E.resolve('동해남부북쪽먼바다'), ['동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다']) && same(E.resolve('서해남부남쪽먼바다'), ['서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다'])
        && same(E.resolve('제주도남쪽안쪽먼바다'), ['제주도남동쪽안쪽먼바다', '제주도남서쪽안쪽먼바다']) && E.resolve('제주도남쪽먼바다').length === 3 && E.resolve('동해중부먼바다').length === 2);
    ok('못 푸는 이름은 null(반만 풀지 않는다) — 제주도해상·서해먼바다·제주도바깥먼바다·괄호가 해역 말이 아닌 것', E.resolve('제주도해상') === null && E.resolve('서해먼바다') === null && E.resolve('제주도바깥먼바다') === null
        && E.resolve('동해남부북쪽먼바다(12시 발효)') === null && E.resolve('제주도앞바다(중부 제외)') === null);
    ok('부모 하나에 붙은 괄호: 「(연안바다 제외)」 = 부모 그대로 · 「(연안바다)」 = 자식만이라 부모 카드에 안 붙인다', same(E.resolve('제주도남부앞바다(연안바다 제외)'), ['제주도남부앞바다']) && E.resolve('경북북부앞바다(연안바다)') === null);
}

console.log('B. 통보문 참고사항 — 표 꼴');
{
    const b = B('대구청', '6', '제11-36호', '2026-11-18 16:00', { other: '○ 풍랑 경보 변경 가능 시점\n(3) 동해남부북쪽안쪽먼바다: 19일 새벽(00시~06시)\n(4) 동해남부북쪽바깥먼바다: 19일 새벽(00시~06시)\n\n※ 풍랑경보 변경 가능 시점은 먼바다를 대상으로 48시간 이내에 풍랑주의보가 풍랑경보로 변경이 예상되는 경우 제공되며, 풍랑경보의 발효 여부와 시점은 조정될 수 있으므로 최신 기상정보를 참고하여 안전에 유의하시기 바랍니다.' });
    const n = N(b);
    ok('줄마다 해역·시간창(단서 ※ 줄은 안 읽는다)', n.length === 2 && n[0].zones.join() === '동해남부북쪽안쪽먼바다' && n[0].label === '새벽(00시~06시)' && dm(n[0].startMs) === '11-19 00:00' && dm(n[0].endMs) === '11-19 06:00' && dm(n[0].dayMs) === '11-19 00:00' && n[1].zones.join() === '동해남부북쪽바깥먼바다', n);
    ok('글머리가 「-」인 줄 · 한 줄에 여러 해역 · 「밤(18시~24시)」 = 다음 날 0시까지', (() => { const x = N(B('수도권청', '6', '제12-51호', '2025-12-24 17:57', { other: '○ 풍랑 경보 변경 가능 시점\n- 서해중부바깥먼바다, 서해중부안쪽먼바다: 25일 밤(18시~24시)\n※ 풍랑경보 변경 가능 시점은 …' })); return x.length === 1 && x[0].zones.length === 2 && dm(x[0].endMs) === '12-26 00:00'; })());
    ok('머리줄 표기 변형(풍랑경보 변경 가능 시점 · 가능성 시점 · 재변경)', ['o 풍랑경보 변경 가능 시점', '○ 풍랑 경보 변경 가능성 시점', '○ 풍랑 경보 재변경 가능 시점'].every((h) => N(B('강원청', '6', '제1-1호', '2026-01-12 10:00', { other: h + '\n(1) 동해중부안쪽먼바다: 13일 오전(06시~12시)' })).length === 1));
    const m = N(B('제주청', '6', '제2-66호', '2026-02-28 21:05', { other: '○ 풍랑 경보 변경 가능 시점\n(2), (3) 남해서부서쪽먼바다, 제주도전해상(제주도서부앞바다 제외): 2일 오후(12시~18시)' }));
    ok('월 넘김: 2월 28일 통보문의 「2일 오후」 = 3월 2일(같은 달로 읽으면 뜨자마자 지워진다) · 「제외」 반영 · 항목 번호는 안 쓴다', m.length === 1 && dm(m[0].startMs) === '03-02 12:00' && m[0].zones.length === 7 && !m[0].zones.includes('제주도서부앞바다') && m[0].zones.includes('남해서부서쪽먼바다'), m.map((x) => [dm(x.startMs), x.zones]));
    const u = E.readBulletin(B('강원청', '6', '제6-7호', '2026-06-20 10:01', { other: '○ 풍랑 경보 변경 가능 시점\n(2) : 20일 밤(18시~24시)\n※ …' }));
    ok('이름이 빈 줄은 안 쓴다(항목 번호로 해역을 넘겨짚지 않는다) — 못 읽은 줄로 남긴다', u.notices.length === 0 && u.unread.length === 1, u);
    const half = E.readBulletin(B('광주청', '6', '제9-9호', '2026-09-01 10:00', { other: '○ 풍랑 경보 변경 가능 시점\n(1) 서해남부북쪽바깥먼바다, 서해먼바다: 2일 오후(12시~18시)\n(2) 남해서부동쪽먼바다: 2일 밤(18시~24시)' }));
    ok('한 줄에 못 푸는 이름이 하나라도 있으면 그 줄은 통째로 안 쓴다 — 다른 줄은 그대로', half.notices.length === 1 && half.notices[0].zones.join() === '남해서부동쪽먼바다' && half.unread.length === 1, half);
    ok('참고사항에 「가능」이 있어도 경보 변경 안내가 아니면 안 읽는다(해제하나 다시 발표될 가능성 · 재발표는 제외 — 사용자)', N(B('제주청', '6', '제9-22호', '2026-09-08 16:00', { other: '(2) 제주도동부앞바다와 제주도남부앞바다의 풍랑주의보는 18시를 기해 해제하나, 9일 오전(06~12시)부터 다시 물결이 높아지면서 다시 풍랑특보가 발표될 가능성이 있으니 참고하기 바랍니다.' })).length === 0);
}

console.log('C. 통보문 참고사항 — 문장 꼴');
{
    const a = N(B('제주청', '6', '제10-48호', '2026-10-23 11:59', { other: '○ 오늘(23일) 12시를 기해 제주도남부.서부앞바다의 풍랑주의보를 발표합니다.\n\n- 한편, 10월 21일부터 풍랑주의보가 발효 중인 제주도남쪽바깥먼바다는 23일 밤(18시~24시)에, 제주도남쪽안쪽먼바다는 24일 새벽(00시~06시)에 풍랑경보로 변경될 가능성이 있으니 앞으로 발표하는 최신 기상정보를 참고하여 안전에 유의하시기 바랍니다.' }));
    ok('해역마다 다른 시간을 짝지어 읽는다 · 「10월 21일부터 발효 중인」은 가능 시점이 아니다 · 통보문 대상(앞바다)이 아닌 해역의 안내도 읽는다',
        a.length === 2 && a[0].zones.join() === '제주도남쪽바깥먼바다' && dm(a[0].startMs) === '10-23 18:00' && same(a[1].zones, ['제주도남동쪽안쪽먼바다', '제주도남서쪽안쪽먼바다']) && dm(a[1].startMs) === '10-24 00:00', a.map((x) => [x.zones, dm(x.startMs)]));
    const b = N(B('광주청', '6', '제1-59호', '2025-01-27 01:01', { other: '- 서해남부북쪽바깥먼바다는 27일 오후(12~18시)에, 서해남부남쪽바깥먼바다는 27일 밤(18~24시)에 풍랑경보로 변경될 가능성이 있습니다.' }));
    ok('「12~18시」 꼴 시간창', b.length === 2 && dm(b[0].startMs) === '01-27 12:00' && dm(b[1].startMs) === '01-27 18:00' && dm(b[1].endMs) === '01-28 00:00', b);
    const c = N(B('수도권청', '7', '제1-7호', '2025-01-26 03:59', { other: 'o 특히, 내일(27일) 오후에 서해중부먼바다에 물결이 최대 5.0m 이상으로 더욱 높게 일면서 풍랑경보로 강화될 가능성이 있겠으니, 앞으로 발표되는 기상정보를 참고하기 바랍니다.' }));
    ok('시간이 먼저 나오는 문장 · 시간창 숫자가 없으면 창 없이 날짜·시간대만', c.length === 1 && c[0].zones.length === 2 && dm(c[0].dayMs) === '01-27 00:00' && c[0].label === '오후' && c[0].startMs === null && c[0].endMs === null, c);
    const d = N(B('제주청', '7', '제1-6호', '2026-01-09 04:00', { other: 'o 제주도전해상과 남해서부서쪽먼바다에는 풍랑주의보가 풍랑경보로 변경될 가능성이 있겠습니다.\n※ 본 정보는 현 시점의 예측을 기반으로 제공되며 …\n※ 상세한 풍랑경보 시점은 풍랑특보가 발표되는 통보문을 참고하시기 바랍니다.' }));
    ok('시간이 없는 안내(예비 통보문) — 넓은 이름은 쓴 그대로 전 해역', d.length === 1 && d[0].zones.length === 8 && d[0].dayMs === null && d[0].label === '', d);
    ok('항목 번호가 낀 문장 「(2)A와 (3)B는 내일(3일) 오전(06~12시)에」', (() => { const x = N(B('광주청', '6', '제3-4호', '2025-03-02 23:32', { other: 'o (2)서해남부남쪽바깥먼바다와 (3)서해남부남쪽안쪽먼바다는 내일(3일) 오전(06~12시)에 풍랑경보로 변경될 가능성이 있습니다.' })); return x.length === 1 && x[0].zones.length === 2 && dm(x[0].startMs) === '03-03 06:00'; })());
    ok('경보를 주의보로 내리며 「다시 경보로 변경 발표 될 가능성」(격상) — 읽는다', (() => { const x = N(B('광주청', '6', '제3-33호', '2025-03-16 09:01', { other: '(1) 남해서부동쪽먼바다에 풍랑경보를 풍랑주의보로 변경하나 16일 오후부터 점차 물결이 높아지면서 풍랑경보로 변경 발표 될 가능성이 있으니 최신 정보를 참고하시기 바랍니다.' })); return x.length === 1 && x[0].zones.join() === '남해서부동쪽먼바다' && x[0].label === '오후부터'; })());
    const un = E.readBulletin(B('제주청', '7', '제2-15호', '2026-02-26 18:02', { other: '○ 참고사항: 제주도동부앞바다, 제주도남동쪽안쪽먼바다, 제주도바깥먼바다에는 풍랑주의보가 풍랑경보로 변경될 가능성이 있겠습니다.' }));
    ok('문장에 못 푸는 이름이 하나라도 있으면 통째로 안 쓴다(반만 보이지 않는다) — 못 읽은 줄로 남긴다', un.notices.length === 0 && un.unread.length === 1, un);
    ok('「서해남부바깥(북쪽, 남쪽)먼바다」 같은 변형도 넘겨짚지 않는다', E.readBulletin(B('광주청', '6', '제2-47호', '2025-02-07 00:01', { other: '- 서해남부바깥(북쪽, 남쪽)먼바다는 7일 오후(12~18시)에 풍랑경보로 변경될 가능성이 있습니다.' })).notices.length === 0);
    const cn = E.readBulletin(B('강원청', '7', '제10-8호', '2026-10-21 17:57', { other: '오늘(21일) 오후로 예고된 동해중부앞바다 풍랑 예비특보는 가능성이 낮아져 해제합니다.\n또한, 동해중부먼바다의 풍랑경보는 발표 가능성이 낮아졌음을 알려드립니다.' }));
    ok('취소 문구 「풍랑경보는 발표 가능성이 낮아졌음」 — 그 해역만(예비특보 취소 줄은 경보 안내가 아니다)', cn.notices.length === 0 && cn.cancels.length === 1 && same(cn.cancels[0].zones, ['동해중부안쪽먼바다', '동해중부바깥먼바다']), cn);
}

console.log('D. 날씨해설 — 토막(절) 단위');
{
    const pub = T('2026-10-27 10:10');
    const txt = (sea) => '<중점 사항>\n○ 오늘 전국이 흐리겠습니다.\n\n<해상 및 강풍>\n○ (해상) ' + sea + '\n○ (강풍) 강원산지에 바람이 강하게 불겠습니다.\n\n<예보의 변동성>\n○ (변동성) 내일 내리는 비는 제30호 태풍 참피(CHAMPI)의 이동 경로와 강도 등에 따라 강수 구역과 시점 등이 변경될 가능성이 있겠고, 제주도남쪽바깥먼바다는 태풍특보로 변경될 가능성이 있겠으니, 최신 예보를 참고하기 바랍니다.';
    const a = E.readCommentary(txt('풍랑특보가 발효된 서해상과 제주도남쪽먼바다, 동해중부해상(앞바다 11시 발효)은 바람이 매우 강하게 불고, 물결이 1.5~3.5m(동해중부먼바다와 동해남부북쪽먼바다 5.0m 이상)로 매우 높게 일겠으니, 유의하기 바랍니다.\n- 또한, 동해중부먼바다는 오늘(27일) 오후부터, 동해남부북쪽먼바다는 오늘 밤부터 물결이 5.0m 이상으로 더욱 높게 일면서, 풍랑경보로 변경될 가능성이 있겠고, 오늘 오후부터 그 밖의 대부분 해상에도 차차 바람이 매우 강하게 불고, 물결이 매우 높게 일면서 풍랑특보를 발표할 가능성이 있겠으니, 앞으로 발표하는 기상정보를 참고하기 바랍니다.'), pub);
    ok('한 문장에 섞인 「경보 변경」 토막만 읽는다 — 「그 밖의 대부분 해상 … 풍랑특보를 발표할 가능성」(새 특보)·「발효된 서해상」(지금 상태)·물결 괄호의 해역은 안 쓴다',
        a.notices.length === 2 && a.notices.every((n) => n.kind === 'wave') && same(a.notices[0].zones, ['동해중부안쪽먼바다', '동해중부바깥먼바다']) && a.notices[0].label === '오후부터' && dm(a.notices[0].dayMs) === '10-27 00:00'
        && same(a.notices[1].zones, ['동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다']) && a.notices[1].label === '밤부터' && a.unread.length === 0, a);
    ok('해상 문단 밖(「<예보의 변동성>」 문단 — 여기에 「태풍특보로 변경될 가능성」 글자가 있어도)은 안 읽는다 · 강풍 문단도', !a.notices.some((n) => n.kind === 'typhoon') && !E.seaPart(txt('x')).includes('변동성') && !E.seaPart(txt('x')).includes('(강풍)'));
    const noMark = E.readCommentary('<중점 사항>\n○ 흐리겠습니다.\n\n<해상>\n○ 풍랑특보가 발효된 서해상은 물결이 높겠습니다.\n- 특히, 동해중부먼바다는 오늘 밤부터 물결이 더욱 높게 일면서 풍랑경보로 변경될 가능성이 있겠습니다.\n\n<예보의 변동성>\n○ 제주도남쪽바깥먼바다는 태풍특보로 변경될 가능성이 있겠습니다.', pub);
    ok('「(해상)」 표식 없이 「<해상>」 머리 아래에 쓴 글도 읽는다(실자료 1건) — 다음 머리 앞까지만', noMark.notices.length === 1 && noMark.notices[0].kind === 'wave' && noMark.notices[0].zones.length === 2, noMark);
    ok('「가능성은 낮겠으나」「가능성이 있었으나」는 안내가 아니다', E.readCommentary(txt('- 특히, 동해중부먼바다는 오늘 밤부터 물결이 높게 일겠으나 풍랑경보로 변경될 가능성은 낮겠으니 참고하기 바랍니다.\n- 또한, 남해동부바깥먼바다는 태풍특보로 변경될 가능성이 있었으나 태풍이 약해졌습니다.'), pub).notices.length === 0);
    const b = E.readCommentary(txt('풍랑특보가 발효된 제주도해상(북부앞바다 제외)과 남해동부바깥먼바다는 당분간 물결이 매우 높게 일겠으니, 유의하기 바랍니다.\n- 특히, 제주도남쪽먼바다와 남해동부바깥먼바다는 오늘(23일) 밤부터, 제주도앞바다(북부 제외)는 모레(25일) 새벽부터 차차 물결이 최대 5.0m 이상으로 더욱 높게 일면서, 풍랑경보로 강화될 가능성이 있겠으니, 앞으로 발표하는 기상정보를 참고하기 바랍니다.'), T('2026-10-23 16:30'));
    ok('「제주도앞바다(북부 제외)」 — 북부앞바다는 빠진다 · 해역마다 다른 날', b.notices.length === 2 && b.notices[0].zones.length === 4 && dm(b.notices[0].dayMs) === '10-23 00:00' && same(b.notices[1].zones, ['제주도동부앞바다', '제주도남부앞바다', '제주도서부앞바다']) && dm(b.notices[1].dayMs) === '10-25 00:00' && b.notices[1].label === '새벽부터', b);
    const c = E.readCommentary(txt('풍랑특보가 발효된 제주도해상과 남해먼바다는 내일(26일)까지 물결이 매우 높게 일겠으니, 유의하기 바랍니다.\n- 또한, 남해동부안쪽먼바다는 오늘 오전부터 물결이 5.0m 이상으로 더욱 높게 일면서, 풍랑경보로 변경될 가능성이 있겠고, 오늘 오후부터 동해중부먼바다에는 차차 물결이 매우 높게 일면서 풍랑특보를 발표할 가능성이 있겠으며, 모레(27일)부터 대부분 해상에서 물결이 높게 일겠습니다.\n- 특히, 제30호 태풍 ‘참피(CHAMPI)’의 영향으로 제주도남쪽바깥먼바다에 태풍특보가 발효된 가운데, 오늘 오후에 남해동부바깥먼바다도 태풍특보로 변경될 가능성이 있겠으니, 앞으로 발표하는 기상정보를 참고하기 바랍니다.'), T('2026-10-25 04:30'));
    ok('태풍: 「○○에 태풍특보가 발효된 가운데」(지금 상태) 뒤 토막만 — 남해동부바깥먼바다 · 같은 글의 풍랑 토막도 따로',
        c.notices.length === 2 && c.notices[0].kind === 'wave' && c.notices[0].zones.join() === '남해동부안쪽먼바다' && c.notices[1].kind === 'typhoon' && c.notices[1].zones.join() === '남해동부바깥먼바다' && c.notices[1].label === '오후' && dm(c.notices[1].dayMs) === '10-25 00:00', c);
    const d = E.readCommentary(txt('- 특히, 제30호 태풍 ‘참피(CHAMPI)’의 영향으로 제주도남쪽바깥먼바다의 풍랑특보는 내일 오전에, 남해동부바깥먼바다는 내일 오후에 태풍특보로 변경될 가능성이 있겠으며 태풍 진로에 따라 매우 유동적이니, 앞으로 발표하는 최신의 기상정보를 참고하기 바랍니다.'), T('2026-10-24 16:30'));
    ok('태풍: 해역마다 다른 때(「내일 오전에」「내일 오후에」 = 발표일 다음 날)', d.notices.length === 2 && d.notices.every((n) => n.kind === 'typhoon') && d.notices[0].zones.join() === '제주도남쪽바깥먼바다' && d.notices[0].label === '오전' && dm(d.notices[0].dayMs) === '10-25 00:00' && d.notices[1].label === '오후', d);
    const e = E.readCommentary(txt('- 특히, 오늘(18일) 밤부터 동해중부먼바다, 내일(19일) 새벽부터 동해남부북쪽먼바다에, 모레(20일) 새벽에 제주도남쪽먼바다에는 물결이 최대 5.0m 이상으로 더욱 높게 일면서 풍랑경보로 변경될 가능성이 있겠으니, 앞으로 발표하는 기상정보를 참고하기 바랍니다.'), T('2026-11-18 16:30'));
    ok('시간이 먼저 나오는 토막 셋', e.notices.length === 3 && dm(e.notices[0].dayMs) === '11-18 00:00' && dm(e.notices[1].dayMs) === '11-19 00:00' && dm(e.notices[2].dayMs) === '11-20 00:00' && e.notices[2].zones.length === 3 && e.notices[2].label === '새벽', e);
    const f = E.readCommentary(txt('- 특히, 제주도해상과 그 밖의 남해상에는 오늘 밤부터 물결이 더욱 높게 일면서 풍랑경보로 변경될 가능성이 있겠습니다.'), pub);
    ok('경보 변경 토막이라도 넓은 말(「제주도해상」「그 밖의 남해상」)은 못 푼다 → 아무 해역에도 붙이지 않는다(못 읽은 토막으로 남긴다)', f.notices.length === 0 && f.unread.length === 1, f);
    ok('새 특보 발표 가능성만 있는 글 · 해상 문단이 없는 글 = 없음', E.readCommentary(txt('내일(5일) 새벽부터 서해남부북쪽먼바다, 오전부터 제주도해상에 물결이 매우 높게 일면서 풍랑특보를 발표할 가능성이 있겠으니, 참고하기 바랍니다.'), pub).notices.length === 0 && E.readCommentary('<중점 사항>\n○ 맑겠습니다.', pub).notices.length === 0);
}

console.log('C2. 별도 에이전트 검토(2026-11-19)에서 나온 것 — 과거 자료에는 0건이지만 재현되는 것');
{
    const M = B('광주청', '6', '제11-60호', '2026-11-19 00:00', { tmIn: '2026-11-18 23:59', other: '- 서해남부북쪽바깥먼바다는 오늘(18일) 밤(18~24시)에 풍랑경보로 변경될 가능성이 있습니다.' });
    ok('0시 발표·전날 밤 입력 통보문의 「오늘(18일)」 = 바로 전날 18일(「앞서면 다음 달」로 읽으면 12월 18일이 되어 한 달 남는다)', (() => { const x = N(M); return x.length === 1 && dm(x[0].startMs) === '11-18 18:00' && dm(x[0].endMs) === '11-19 00:00'; })(), N(M));
    ok('그 통보문의 「내일 오전」 = 입력한 날(18일)의 다음 날 19일 — 날짜 기준은 발표·입력 시각 중 이른 쪽', (() => { const x = N(B('광주청', '6', '제11-61호', '2026-11-19 00:00', { tmIn: '2026-11-18 23:59', other: '- 서해남부북쪽바깥먼바다는 내일 오전에 풍랑경보로 변경될 가능성이 있습니다.' })); return x.length === 1 && dm(x[0].dayMs) === '11-19 00:00'; })());
    ok('그 안내는 시간창 끝 + 6시간에 사라진다(한 달 남지 않는다)', (() => { const at = (t) => Object.keys(E.compute({ bulletins: [M], nowMs: T(t) }).items).length; return at('2026-11-19 05:00') === 1 && at('2026-11-19 06:01') === 0 && at('2026-11-25 12:00') === 0; })());
    ok('연말: 12월 31일 통보문의 「1일」 = 다음 해 1월 1일 · 그 달에 없는 날(「31일」을 2월에)은 가까운 달의 그 날', (() => { const x = N(B('강원청', '6', '제12-90호', '2026-12-31 16:00', { other: '○ 풍랑 경보 변경 가능 시점\n(1) 동해중부안쪽먼바다: 1일 새벽(00시~06시)' })); return x.length === 1 && new Date(x[0].startMs + 9 * H).toISOString().slice(0, 13) === '2027-01-01T00'; })());
    const neg = E.readBulletin(B('광주청', '6', '제11-62호', '2026-11-18 16:00', { other: '- 서해남부북쪽바깥먼바다는 18일 밤(18~24시)에 풍랑경보로 변경될 가능성은 낮습니다.\n- 서해남부남쪽바깥먼바다는 풍랑경보로 변경될 가능성이 있었으나 변경하지 않습니다.' }));
    ok('「가능성은 낮습니다」는 안내가 아니라 취소 · 「가능성이 있었으나 변경하지 않습니다」도 안내가 아니다', neg.notices.length === 0 && neg.cancels.length === 1 && neg.cancels[0].zones.join() === '서해남부북쪽바깥먼바다', neg);
    const cl = N(B('제주청', '6', '제9-23호', '2026-09-08 16:00', { other: '제주도동부앞바다와 제주도남부앞바다의 풍랑주의보는 18시를 기해 해제하나, 9일 오전(06~12시)부터 제주도남쪽바깥먼바다는 물결이 높아져 풍랑경보로 변경될 가능성이 있습니다.' }));
    ok('한 줄 안의 앞 토막(「…해제하나,」)에 적힌 해역은 안 읽는다 — 방금 해제한 앞바다에 안내가 붙지 않는다', cl.length === 1 && cl[0].zones.join() === '제주도남쪽바깥먼바다' && dm(cl[0].startMs) === '09-09 06:00', cl);
    const two = N(B('제주청', '6', '제10-70호', '2026-10-23 12:00', { other: '제주도남부앞바다에 풍랑주의보를 발표합니다. 제주도남쪽바깥먼바다는 23일 밤(18시~24시)에 풍랑경보로 변경될 가능성이 있습니다.' }));
    ok('한 줄에 문장이 둘이면 앞 문장의 해역은 안 읽는다', two.length === 1 && two[0].zones.join() === '제주도남쪽바깥먼바다', two);
    ok('「그글피(8월 1일) 새벽」 — 글피로 잘못 읽지 않는다', (() => { const x = N(B('제주청', '6', '제7-70호', '2026-07-28 16:00', { other: '- 제주도남쪽바깥먼바다는 그글피(8월 1일) 새벽(00~06시)에 풍랑경보로 변경될 가능성이 있습니다.' })); return x.length === 1 && dm(x[0].startMs) === '08-01 00:00'; })());
    const sea = (o) => B('광주청', '6', '제11-63호', '2026-11-18 16:00', { other: o });
    ok('물결 높이 설명(「물결이」 뒤 괄호)의 해역은 안 읽는다', (() => { const x = N(sea('- 서해남부북쪽바깥먼바다는 오늘 밤부터 물결이 3.0~5.0m(서해남부남쪽바깥먼바다 5.0m 이상)로 높게 일면서 풍랑경보로 변경될 가능성이 있습니다.')); return x.length === 1 && x[0].zones.join() === '서해남부북쪽바깥먼바다'; })());
    // 같은 호를 경보 뒤에 고쳐 다시 냄
    const b1 = B('강원청', '6', '제11-25호', '2026-11-18 16:00', { t2: '(1) 풍랑주의보 발표 : 동해중부바깥먼바다', other: '○ 풍랑 경보 변경 가능 시점\n(1) 동해중부바깥먼바다: 19일 오전(06시~12시)' });
    const warn = B('강원청', '6', '제11-27호', '2026-11-18 22:00', { t2: '(1) 풍랑경보 변경 : 동해중부바깥먼바다' });
    const fix = B('강원청', '6', '제11-25호', '2026-11-18 16:00', { tmIn: '2026-11-18 23:00', t2: b1.result.t2, other: b1.result.other });
    ok('경보가 난 뒤 같은 호를 고쳐 다시 내도 끝난 안내가 되살아나지 않는다(안내 시각 = 그 호가 처음 나온 때)', Object.keys(E.compute({ bulletins: [b1, warn, fix], nowMs: T('2026-11-18 23:10') }).items).length === 0 && Object.keys(E.compute({ bulletins: [fix, warn, b1], nowMs: T('2026-11-18 23:10') }).items).length === 0);
    const dayOnly = B('광주청', '6', '제3-33호', '2025-03-16 09:01', { other: '(1) 남해서부동쪽먼바다에 풍랑경보를 풍랑주의보로 변경하나 16일 오후부터 점차 물결이 높아지면서 풍랑경보로 변경 발표 될 가능성이 있으니 최신 정보를 참고하시기 바랍니다.' });
    ok('날짜만 아는 안내(「16일 오후부터」)는 그 날 끝 + 6시간까지(96시간이 아니다)', (() => { const at = (t) => Object.keys(E.compute({ bulletins: [dayOnly], nowMs: T(t) }).items).length; return at('2025-03-17 05:00') === 1 && at('2025-03-17 06:01') === 0; })());
    const order = [B('강원청', '6', '제11-25호', '2026-11-18 16:00', { tmIn: '2026-11-18 16:17', t2: '(1) 풍랑주의보 발표 : 동해중부바깥먼바다', other: '○ 풍랑 경보 변경 가능 시점\n(1) 동해중부바깥먼바다: 19일 오전(06시~12시)' }), B('강원청', '6', '제11-26호', '2026-11-18 16:30', { tmIn: '2026-11-18 16:05', t2: '(1) 풍랑주의보 해제 : 동해중부바깥먼바다' })];
    ok('사건 순서는 입력시각으로 본다(발표시각보다 일찍·늦게 입력되는 통보문 — 실자료 −31분~+17분) · 넣는 순서가 뒤섞여도 같다', Object.keys(E.compute({ bulletins: order, nowMs: T('2026-11-18 17:00') }).items).length === 1 && Object.keys(E.compute({ bulletins: order.slice().reverse(), nowMs: T('2026-11-18 17:00') }).items).length === 1);
    const ty = { type: '단기전망', reportId: 'cmt:202610241630:119', title: '[해설] 제10-119호', rawText: '○ (해상) - 특히, 제주도남쪽바깥먼바다의 풍랑특보는 내일 오전에 태풍특보로 변경될 가능성이 있겠습니다.\n<끝>' };
    ok('그 글 뒤에 그 해역이 해제되면 태풍 가능성도 끝', Object.keys(E.compute({ bulletins: [B('제주청', '6', '제10-58호', '2026-10-24 20:00', { t2: '(1) 풍랑경보 해제 : 제주도남쪽바깥먼바다' })], forecasts: [ty], nowMs: T('2026-10-24 21:00') }).items).length === 0);
    const newer = { type: '초단기전망', reportId: 'cmt:202610242210:120', title: '[해설] 제10-120호', rawText: '○ (해상) - 특히, 제주도남쪽바깥먼바다의 풍랑특보는 내일(25일) 새벽에 태풍특보로 변경될 가능성이 있겠습니다.\n<끝>' };
    ok('글을 넣는 순서가 뒤섞여도 더 새 글이 이긴다', [[ty, newer], [newer, ty]].every((f) => E.compute({ bulletins: [], forecasts: f, nowMs: T('2026-10-24 23:00') }).items['제주도남쪽바깥먼바다'][0].label === '새벽'));
}

console.log('E. 지우는 때 — 통보문 안내');
{
    const note = '○ 풍랑 경보 변경 가능 시점\n(1) 동해중부안쪽먼바다, 동해중부바깥먼바다: 18일 밤(18시~24시)';
    const b1 = B('강원청', '6', '제11-25호', '2026-11-18 16:00', { t1: '풍랑주의보 발표', t2: '(1) 풍랑주의보 발표 : 동해중부안쪽먼바다, 동해중부바깥먼바다', other: note, rptImageName2: '202611/18/KTKO50_202611181600_105_25.png' });
    const at = (bs, t, more) => E.compute(Object.assign({ bulletins: bs, nowMs: T(t) }, more || {}));
    const r1 = at([b1], '2026-11-18 20:00');
    const it = (r, z) => (r.items[z] || [])[0];
    ok('안내가 뜬다 — 종류·출처·시점·단서·만료(시간창 끝 + 6시간)·원문', it(r1, '동해중부안쪽먼바다') && it(r1, '동해중부안쪽먼바다').kind === 'wave' && it(r1, '동해중부안쪽먼바다').source === '통보문' && it(r1, '동해중부안쪽먼바다').label === '밤(18시~24시)'
        && it(r1, '동해중부안쪽먼바다').caveat === '발효 여부와 시점은 조정될 수 있음' && dm(it(r1, '동해중부안쪽먼바다').expMs) === '11-19 06:00' && it(r1, '동해중부안쪽먼바다').doc.key === 'KTKO50_202611181600_105_25'
        && it(r1, '동해중부안쪽먼바다').doc.title === '제11-25호 풍랑주의보 발표' && !!it(r1, '동해중부바깥먼바다'), r1.items);
    ok('안내가 적힌 통보문을 원문 보관 대상으로 넘긴다(refs)', r1.refs.length === 1 && r1.refs[0].ho === '제11-25호' && r1.refs[0].rpt === '6' && r1.refs[0].office === '강원청' && r1.refs[0].inMs === T('2026-11-18 16:00') + 30e3, r1.refs);
    ok('시간창이 지나도 6시간은 남고(경보가 조금 늦게 나는 경우), 그 뒤에는 사라진다', !!it(at([b1], '2026-11-19 05:59'), '동해중부안쪽먼바다') && !it(at([b1], '2026-11-19 06:01'), '동해중부안쪽먼바다'));
    const warn = B('강원청', '6', '제11-27호', '2026-11-18 22:00', { t2: '(1) 풍랑경보 변경 : 동해중부바깥먼바다' });
    const r2 = at([b1, warn], '2026-11-18 22:30');
    ok('그 해역에 풍랑경보 통보문이 나오면 끝 — 다른 해역은 그대로', !it(r2, '동해중부바깥먼바다') && !!it(r2, '동해중부안쪽먼바다') && r2.refs.length === 1);
    const back = B('강원청', '6', '제11-30호', '2026-11-19 02:00', { t2: '(1) 풍랑주의보 변경 : 동해중부바깥먼바다' });
    ok('경보가 다시 주의보로 내려가도 옛 안내는 되살아나지 않는다', !it(at([b1, warn, back], '2026-11-19 02:30'), '동해중부바깥먼바다'));
    const ext = B('강원청', '6', '제11-26호', '2026-11-18 19:00', { t2: '(1) 풍랑주의보 해제예고연장 : 동해중부안쪽먼바다, 동해중부바깥먼바다', other: 'o 없음' });
    ok('새 통보문에 안내가 없다는 것만으로는 안 지운다(실자료 12건 중 10건이 그 뒤 경보)', !!it(at([b1, ext], '2026-11-18 20:00'), '동해중부안쪽먼바다'));
    const rel = B('강원청', '6', '제11-28호', '2026-11-18 21:00', { t2: '(1) 풍랑주의보 해제 : 동해중부안쪽먼바다' });
    ok('그 해역 해제 통보문이 나오면 끝', !it(at([b1, rel], '2026-11-18 21:30'), '동해중부안쪽먼바다') && !!it(at([b1, rel], '2026-11-18 21:30'), '동해중부바깥먼바다'));
    const ty = B('강원청', '6', '제11-29호', '2026-11-18 21:00', { t2: '(1) 태풍주의보 발표 : 동해중부안쪽먼바다' });
    ok('그 해역에 태풍특보가 나오면 풍랑 가능성은 끝', !it(at([b1, ty], '2026-11-18 21:30'), '동해중부안쪽먼바다'));
    const newer = B('강원청', '6', '제11-31호', '2026-11-18 21:00', { t2: '(1) 풍랑주의보 해제예고연장 : 동해중부안쪽먼바다', other: '○ 풍랑 경보 변경 가능 시점\n(1) 동해중부안쪽먼바다: 19일 오전(06시~12시)', rptImageName2: '202611/18/KTKO50_202611182100_105_31.png' });
    const r3 = at([b1, newer], '2026-11-19 07:00');
    ok('같은 해역에 더 새 안내가 있으면 그것으로 바꾼다(시간·원문) — 다시 안내 안 된 해역은 옛 안내대로 끝난다', it(r3, '동해중부안쪽먼바다') && it(r3, '동해중부안쪽먼바다').label === '오전(06시~12시)' && it(r3, '동해중부안쪽먼바다').doc.key === 'KTKO50_202611182100_105_31' && !it(r3, '동해중부바깥먼바다'), r3.items);
    const can = B('강원청', '7', '제11-9호', '2026-11-18 19:00', { other: '또한, 동해중부먼바다의 풍랑경보는 발표 가능성이 낮아졌음을 알려드립니다.' });
    ok('취소 문구가 나오면 끝', !it(at([b1, can], '2026-11-18 19:30'), '동해중부안쪽먼바다') && !it(at([b1, can], '2026-11-18 19:30'), '동해중부바깥먼바다'));
    ok('취소보다 뒤에 나온 새 안내는 다시 뜬다', !!it(at([b1, can, newer], '2026-11-18 21:30'), '동해중부안쪽먼바다'));
    const nt = B('제주청', '7', '제1-6호', '2026-01-09 04:00', { other: 'o 제주도전해상과 남해서부서쪽먼바다에는 풍랑주의보가 풍랑경보로 변경될 가능성이 있겠습니다.' });
    ok('시간 없는 안내: 96시간까지(실자료 최장 79.9시간 뒤 경보) — 시점 줄 없이', (() => { const a = at([nt], '2026-01-12 12:00'), z = it(a, '제주도남부앞바다'); return z && z.dayMs === null && z.label === '' && !it(at([nt], '2026-01-13 04:02'), '제주도남부앞바다') && Object.keys(a.items).length === 8; })());
    const v1 = B('강원청', '6', '제11-25호', '2026-11-18 16:00', { tmIn: '2026-11-18 16:10', t2: b1.result.t2, other: 'o 없음' });
    ok('같은 호를 고쳐 다시 낸 통보문은 마지막 판만 본다(고친 판에 안내가 없으면 없다)', !it(at([b1, v1], '2026-11-18 20:00'), '동해중부안쪽먼바다'));
    ok('아직 입력되지 않은(미래) 통보문의 안내는 안 보인다 · 통보문이 없으면 빈 목록', !it(at([b1], '2026-11-18 15:00'), '동해중부안쪽먼바다') && Object.keys(at([], '2026-11-18 20:00').items).length === 0 && Object.keys(at(null, '2026-11-18 20:00').items).length === 0);
}

console.log('F. 날씨해설로 채우기 — 통보문 우선');
{
    const sea = (s) => '<해상>\n○ (해상) ' + s + '\n<끝>';
    const F = (type, id, s) => ({ type, reportId: id, title: '[해설] 제11-89호 : 2026.11.18.16:30/ ' + (type === '초단기전망' ? '초단기 전망' : '단기 전망'), rawText: sea(s) });
    const dan = F('단기전망', 'cmt:202611181630:89', '- 특히, 오늘(18일) 밤부터 동해중부먼바다, 모레(20일) 새벽에 제주도남쪽먼바다에는 물결이 최대 5.0m 이상으로 더욱 높게 일면서 풍랑경보로 변경될 가능성이 있겠으니, 참고하기 바랍니다.');
    const b1 = B('강원청', '6', '제11-25호', '2026-11-18 16:00', { t2: '(1) 풍랑주의보 발표 : 동해중부안쪽먼바다', other: '○ 풍랑 경보 변경 가능 시점\n(1) 동해중부안쪽먼바다: 18일 밤(18시~24시)' });
    const at = (bs, fs_, t, zones) => E.compute({ bulletins: bs, forecasts: fs_, zones: zones || {}, nowMs: T(t) });
    const r = at([b1], [dan], '2026-11-18 20:00');
    const src = (x, z) => (x.items[z] || []).map((i) => i.source + ':' + i.kind).join();
    ok('같은 해역이면 통보문 것 · 통보문에 없는 해역만 날씨해설로(사용자 「통보문을 우선하고, 통보문에 없는 것만 날씨해설로」)',
        src(r, '동해중부안쪽먼바다') === '통보문:wave' && src(r, '동해중부바깥먼바다') === '단기전망:wave' && src(r, '제주도남쪽바깥먼바다') === '단기전망:wave', r.items);
    const one = (r.items['제주도남쪽바깥먼바다'] || [])[0];
    ok('날씨해설 항목: 시점 · 만료(발표 18시간) · 📋 = 그 날씨해설 페이지', one && one.label === '새벽' && dm(one.dayMs) === '11-20 00:00' && dm(one.expMs) === '11-19 10:30' && one.doc.type === 'web' && one.doc.title === '제11-89호 : 2026.11.18.16:30/ 단기 전망'
        && one.doc.webUrl === 'https://www.weather.go.kr/w/special-report/list.do?prevStn=108&stn=108&date=2026-11-18&reportId=cmt%3A202611181630%3A89', one);
    ok('발표 18시간이 지난 글은 안 쓴다(수집이 멈췄을 때 옛 「오늘 밤부터」가 남지 않게) · 아직 발표 전인 글도 안 쓴다', src(at([], [dan], '2026-11-19 10:31'), '제주도남쪽바깥먼바다') === '' && src(at([], [dan], '2026-11-18 16:00'), '제주도남쪽바깥먼바다') === '');
    const can = B('강원청', '7', '제11-9호', '2026-11-18 19:00', { other: '또한, 동해중부먼바다의 풍랑경보는 발표 가능성이 낮아졌음을 알려드립니다.' });
    ok('통보문이 취소한 것을 그보다 먼저 나온 날씨해설이 되살리지 않는다(실자료 2026-10-21 — 4시간 되살아날 뻔)', src(at([b1, can], [dan], '2026-11-18 20:00'), '동해중부안쪽먼바다') === '' && src(at([b1, can], [dan], '2026-11-18 20:00'), '동해중부바깥먼바다') === '');
    const cho = F('초단기전망', 'cmt:202611182210:90', '- 또한, 동해중부먼바다는 내일(19일) 새벽부터 물결이 더욱 높게 일면서 풍랑경보로 변경될 가능성이 있겠습니다.');
    ok('취소 뒤에 나온 새 글이 다시 말하면 뜬다', src(at([b1, can], [dan, cho], '2026-11-18 22:30'), '동해중부바깥먼바다') === '초단기전망:wave');
    ok('통보문 안내가 시간이 지나 끝난 뒤, 그보다 먼저 나온 글로는 되살리지 않는다', src(at([b1], [dan], '2026-11-19 07:00'), '동해중부안쪽먼바다') === '' && src(at([b1], [dan], '2026-11-19 07:00'), '동해중부바깥먼바다') === '단기전망:wave');
    const warn = B('강원청', '6', '제11-27호', '2026-11-18 22:00', { t2: '(1) 풍랑경보 변경 : 동해중부바깥먼바다' });
    ok('글 뒤에 그 해역 풍랑경보 통보문이 나오면 날씨해설 것도 끝(다음 글을 기다리지 않는다 — 실자료 최장 11.5시간 남았다)', src(at([warn], [dan], '2026-11-18 22:30'), '동해중부바깥먼바다') === '');
    const r2 = at([], [dan, cho], '2026-11-18 22:30');
    ok('더 새 글이 그 해역을 다시 말하면 그것으로 · 새 글에 없다고 지우지 않는다(초단기 글은 가까운 때만 다루기도 한다)', (r2.items['동해중부바깥먼바다'] || [])[0].source === '초단기전망' && (r2.items['동해중부바깥먼바다'] || [])[0].label === '새벽부터' && src(r2, '제주도남쪽바깥먼바다') === '단기전망:wave', r2.items);
    const zonesWarn = { 제주도남쪽바깥먼바다: { kind: 'formal', type: '풍랑', level: '경보' }, 제주도남동쪽안쪽먼바다: { kind: 'formal', type: '풍랑', level: '주의보', next: { type: '풍랑', level: '경보' } }, 제주도남서쪽안쪽먼바다: { kind: 'yebi', type: '풍랑', level: '예비' } };
    const r3 = at([], [dan], '2026-11-18 20:00', zonesWarn);
    ok('이미 풍랑경보(곧 경보)인 해역에는 풍랑 가능성을 안 붙인다 — 예비 단계 해역에는 붙인다', src(r3, '제주도남쪽바깥먼바다') === '' && src(r3, '제주도남동쪽안쪽먼바다') === '' && src(r3, '제주도남서쪽안쪽먼바다') === '단기전망:wave', r3.items);
    const ty = F('단기전망', 'cmt:202610241630:119', '- 특히, 제30호 태풍 ‘참피(CHAMPI)’의 영향으로 제주도남쪽바깥먼바다의 풍랑특보는 내일 오전에, 남해동부바깥먼바다는 내일 오후에 태풍특보로 변경될 가능성이 있겠으며 태풍 진로에 따라 매우 유동적이니, 참고하기 바랍니다.');
    const r4 = at([], [ty], '2026-10-24 18:00', { 제주도남쪽바깥먼바다: { kind: 'formal', type: '풍랑', level: '경보' }, 남해동부바깥먼바다: { kind: 'formal', type: '풍랑', level: '경보' } });
    ok('태풍 가능성은 이미 풍랑경보인 해역에도 뜬다(실자료: 안내된 해역이 그때 전부 풍랑경보였다) — 단서 「태풍 진로에 따라 매우 유동적」', src(r4, '제주도남쪽바깥먼바다') === '단기전망:typhoon' && src(r4, '남해동부바깥먼바다') === '단기전망:typhoon' && r4.items['제주도남쪽바깥먼바다'][0].caveat === '태풍 진로에 따라 매우 유동적' && r4.items['제주도남쪽바깥먼바다'][0].label === '오전', r4.items);
    const tw = B('제주청', '6', '제10-59호', '2026-10-25 04:03', { t2: '(1) 태풍경보 변경 : 제주도남쪽바깥먼바다' });
    const r5 = at([tw], [ty], '2026-10-25 04:30', { 남해동부바깥먼바다: { kind: 'formal', type: '태풍', level: '주의보' } });
    ok('태풍특보가 나온 해역(통보문·지금 상태)에는 태풍 가능성을 더 안 보인다', src(r5, '제주도남쪽바깥먼바다') === '' && src(r5, '남해동부바깥먼바다') === '');
    const both = at([B('제주청', '6', '제10-50호', '2026-10-24 17:00', { other: '○ 풍랑 경보 변경 가능 시점\n(1) 남해동부바깥먼바다: 25일 오전(06시~12시)' })], [ty], '2026-10-24 18:00');
    ok('한 해역에 풍랑(통보문)·태풍(날씨해설) 가능성이 함께 있으면 둘 다', src(both, '남해동부바깥먼바다') === '통보문:wave,단기전망:typhoon');
    ok('날씨해설 파일이 없거나 깨졌으면 빈 목록(통보문 것만 계산)', E.readForecasts(path.join(os.tmpdir(), 'no-such-forecast.json')).length === 0);
}

console.log('G. AI(⑤) — 규칙이 못 읽은 문장만, 지어낸 해역 없이');
(async () => {
    const base = T('2026-11-18 16:00');
    const S = '서해남부북쪽바깥먼바다 일대 해역에는 오늘 밤부터 물결이 더욱 높게 일면서 풍랑경보로 변경될 가능성이 있겠습니다.';
    ok('규칙은 이 문장을 못 읽는다(「일대 해역」이 남는다)', E.readHead('서해남부북쪽바깥먼바다 일대 해역에는 오늘 밤부터', base) === null);
    const good = E.fromAi(S, [{ 해역: '서해남부북쪽바깥먼바다', 시점: '오늘 밤부터' }], base);
    ok('AI 답: 해역 말·시점 말이 문장에 그대로 있고 규칙이 풀 수 있으면 쓴다', good && good.length === 1 && good[0].zones.join() === '서해남부북쪽바깥먼바다' && good[0].label === '밤부터', good);
    ok('AI 가 문장에 없는 해역을 내면 통째로 안 쓴다(지어낸 해역 막기)', E.fromAi(S, [{ 해역: '서해남부북쪽바깥먼바다', 시점: '오늘 밤부터' }, { 해역: '서해남부남쪽바깥먼바다', 시점: '' }], base) === null);
    ok('AI 가 풀어 쓴 이름(문장에 없는 글자)·규칙이 못 푸는 이름·문장에 없는 시점·빈 답 = 안 쓴다', E.fromAi('제주도바깥먼바다에는 풍랑경보로 변경될 가능성', [{ 해역: '제주도남쪽바깥먼바다', 시점: '' }], base) === null
        && E.fromAi('제주도바깥먼바다에는 풍랑경보로 변경될 가능성', [{ 해역: '제주도바깥먼바다', 시점: '' }], base) === null && E.fromAi(S, [{ 해역: '서해남부북쪽바깥먼바다', 시점: '내일 새벽' }], base) === null
        && E.fromAi(S, [], base) === null && E.fromAi(S, null, base) === null && E.fromAi(S, [{}], base) === null);
    const bS = B('광주청', '6', '제11-40호', '2026-11-18 16:00', { other: '- ' + S });
    ok('지금 상태를 함께 적은 글(「발효 중인 …」「…해제하나」)은 AI 로 읽지 않는다 — AI 가 그 해역을 골라도 「글에 있는 해역」이라 통과해 버리기 때문', E.fromAi('풍랑주의보가 발효 중인 서해남부북쪽바깥먼바다 일대 해역과 서해남부남쪽바깥먼바다 인근 해역에는', [{ 해역: '서해남부북쪽바깥먼바다', 시점: '' }], base) === null);
    ok('AI 답은 머리 토막(가능성 문구 앞) 안의 글자여야 한다 — 문구 뒤 다른 토막의 해역·시점은 못 쓴다', E.readBulletin(B('광주청', '6', '제11-41호', '2026-11-18 16:00', { other: '- 서해남부북쪽바깥먼바다 일대 해역에는 풍랑경보로 변경될 가능성이 있고, 내일(19일) 새벽부터 서해남부남쪽바깥먼바다에는 물결이 높겠습니다.' }), () => [{ 해역: '서해남부남쪽바깥먼바다', 시점: '내일(19일) 새벽부터' }]).notices.length === 0);
    ok('통보문 문장: AI 답이 없으면 못 읽은 줄 · 있으면 안내', E.readBulletin(bS).unread.length === 1 && E.readBulletin(bS, () => [{ 해역: '서해남부북쪽바깥먼바다', 시점: '오늘 밤부터' }]).notices.length === 1);
    // 보관소
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esc-ai-')), file = path.join(dir, 'ai.json');
    let calls = [], answer = () => ({ success: true, text: '```json\n{"항목":[{"해역":"서해남부북쪽바깥먼바다","시점":"오늘 밤부터"}]}\n```' }), clock = base;
    const mk = () => E.createAi({ ai: async (p) => { calls.push(p); return answer(); }, file, now: () => clock });
    let ai = mk();
    ok('아직 안 물은 문장은 답 없음', ai.read(S) === null);
    const f1 = await ai.fill([S]);
    ok('못 읽은 문장을 한 번 묻고 답을 남긴다(지시문에 그 문장이 들어간다)', f1.asked === 1 && calls.length === 1 && calls[0].includes(S) && JSON.stringify(ai.read(S)) === JSON.stringify([{ 해역: '서해남부북쪽바깥먼바다', 시점: '오늘 밤부터' }]));
    ok('같은 문장은 다시 묻지 않는다 · 서버를 다시 올려도 답이 남는다', (await ai.fill([S])).asked === 0 && calls.length === 1 && mk().read(S) !== null);
    ok('답으로 읽혀 「못 읽은 문장」에서 빠져도(빈 목록) 답을 지우지 않는다 — 지우면 매분 다시 묻는다', (await ai.fill([])).asked === 0 && mk().read(S) !== null);
    const S2 = '남해동부바깥먼바다 부근 해상은 내일 오전에 태풍특보로 변경될 가능성이 있겠습니다.';
    answer = () => ({ success: false, error: 'quota' }); ai = mk();
    await ai.fill([S2]); await ai.fill([S2]);
    ok('실패하면 10분 뒤에 다시 — 그 안에는 안 묻는다', calls.length === 2 && ai.read(S2) === null);
    clock += 10 * 60e3 + 1; await ai.fill([S2]); clock += 10 * 60e3 + 1; await ai.fill([S2]); clock += 10 * 60e3 + 1; await ai.fill([S2]);
    ok('세 번 실패하면 더 묻지 않는다', calls.length === 4);
    answer = () => ({ success: true, text: '모르겠습니다' }); clock += 1;
    const S3 = '동해중부먼바다 인근 해역은 풍랑경보로 변경될 가능성이 있겠습니다.';
    await ai.fill([S3]);
    ok('JSON 이 아닌 답은 실패로 친다 · 더는 못 읽은 문장이 아닌 실패 기록은 지운다', ai.read(S3) === null && JSON.parse(fs.readFileSync(file, 'utf8')).done && Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).done).every((d) => d.ok || d.text.startsWith('동해중부먼바다')));
    ok('보관소 파일 내용이 null·숫자·배열·틀린 모양이어도 던지지 않고 빈 보관소로 본다(던지면 격상 계산이 매분 죽는다)', ['null', '5', '[]', '{"done":"x"}', '{"done":[1]}', '{잘린'].every((c, i) => { const f = path.join(dir, 'bad' + i + '.json'); fs.writeFileSync(f, c); return E.createAi({ ai: async () => answer(), file: f, now: () => clock }).read(S) === null; }));
    const big = E.createAi({ ai: async () => ({ success: true, text: JSON.stringify({ 항목: [{ 해역: '가'.repeat(5000), 시점: '나'.repeat(5000) }] }) }), file: path.join(dir, 'big.json'), now: () => clock });
    await big.fill([S]);
    ok('아주 긴 AI 답은 잘라 둔다', big.read(S)[0].해역.length === 100 && big.read(S)[0].시점.length === 60);
    const boom = E.createAi({ ai: async () => { throw new Error('network'); }, file: path.join(dir, 'ai2.json'), now: () => clock });
    ok('AI 호출이 던져도 보관소는 던지지 않는다', (await boom.fill([S])).asked === 1 && boom.read(S) === null);
    // run: 저장 + AI 걸기
    const out = path.join(dir, 'esc.json'), asked = [];
    const res = E.run({ watch: { bulletins: () => [bS] }, zones: {}, forecasts: [], file: out, now: () => T('2026-11-18 20:00'), ai: { read: () => null, fill: async (t) => { asked.push(...t); return { asked: t.length }; } } });
    ok('run: 계산 결과를 저장하고, 못 읽은 문장만 AI 에 걸어 둔다(기다리지 않는다)', res.unread.length === 1 && asked.length === 1 && asked[0] === '- ' + S && JSON.stringify(E.read(out).items) === '{}' && E.read(path.join(dir, 'none.json')) === null, [res.unread, asked]);
    const asked2 = [];
    E.run({ watch: { bulletins: () => [B('강원청', '6', '제6-7호', '2026-06-20 10:01', { other: '○ 풍랑 경보 변경 가능 시점\n(2) : 20일 밤(18시~24시)' }), B('강원청', '7', '제10-8호', '2026-06-20 10:02', { other: '또한, 어느 일대 해역의 풍랑경보는 발표 가능성이 낮아졌음을 알려드립니다.' })] }, zones: {}, forecasts: [], file: out, now: () => T('2026-06-20 12:00'), ai: { read: () => null, fill: async (t) => { asked2.push(...t); return { asked: 0 }; } } });
    ok('AI 에는 답을 쓸 수 있는 문장만 묻는다 — 표의 이름 빈 줄·취소 줄은 안 묻는다(답을 쓸 곳이 없다)', asked2.length === 0, asked2);
    const res2 = E.run({ watch: { bulletins: () => [bS] }, zones: {}, forecasts: [], file: out, now: () => T('2026-11-18 20:00'), ai: { read: (t) => (t === '- ' + S ? [{ 해역: '서해남부북쪽바깥먼바다', 시점: '오늘 밤부터' }] : null), fill: async () => { asked.push('again'); return { asked: 0 }; } } });
    ok('다음 분: AI 답이 있으면 그 문장이 안내로 읽힌다(더 묻지 않는다)', (res2.items['서해남부북쪽바깥먼바다'] || []).length === 1 && res2.unread.length === 0 && !asked.includes('again'), res2);

    console.log('H. 과거 통보문 전량(2025-01 ~ 2026-11-11, 분석 폴더 원자료)으로 판독 수 고정');
    {
        const RAW = path.join(__dirname, '..', 'analysis', 'bulletin_survey', 'raw');
        const all = [];
        for (const ym of fs.readdirSync(RAW).sort()) for (const f of fs.readdirSync(path.join(RAW, ym))) {
            const d = JSON.parse(fs.readFileSync(path.join(RAW, ym, f), 'utf8'));
            for (const it of Object.values(d.items || {})) if (it.result && it.result.tmIn) all.push({ office: d.officeName, rpt: it.rpt, result: it.result });
        }
        let table = 0, sent = 0, cancel = 0; const unread = [], lines = [];
        for (const b of all) {
            if (!/경보/.test(String(b.result.other || ''))) continue;
            const r = E.readBulletin(b); table += r.notices.filter((x) => x.form === 'table').length; sent += r.notices.filter((x) => x.form === 'sentence').length; cancel += r.cancels.length; unread.push(...r.unread);
            for (const x of r.notices) lines.push([b.office, b.rpt, b.result.t1Title, b.result.tmIn.slice(0, 16), x.form, x.zones.join('+'), x.dayMs, x.label, x.startMs, x.endMs].join('|'));
            for (const c of r.cancels) lines.push([b.office, b.result.t1Title, 'cancel', c.zones.join('+')].join('|'));
        }
        const digest = require('crypto').createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 12);
        ok('읽은 내용 전체(통보문·해역·날짜·시간창)의 지문이 그대로다 — 개수는 같고 해역·시각만 달라지는 변화도 잡는다(2차 독립 검토가 원문과 전수 대조해 틀린 것 0 으로 확인한 결과)', digest === 'f9c2c4f57d47', digest);
        ok(`통보문 ${all.length}건: 표 줄 105 · 문장 안내 27 · 취소 1 · 못 읽은 줄 6(서해먼바다·제주도바깥먼바다·서해남부바깥(북쪽, 남쪽)먼바다 등 — 넘겨짚지 않는다)`,
            all.length === 5768 && table === 105 && sent === 27 && cancel === 1 && unread.length === 6 && unread.every((u) => /서해먼바다|제주도바깥먼바다|바깥\(북쪽|안쪽\(북쪽|^\(2\) :/.test(u)), { n: all.length, table, sent, cancel, unread });
    }

    console.log('I. 이어진 곳');
    {
        const D = require('../services/bulletin_docs');
        const img = (b, k) => Object.assign(b, { result: Object.assign(b.result, { rptImageName2: '202611/18/' + k + '.png' }) });
        const bA = img(B('강원청', '6', '제11-25호', '2026-11-18 16:00'), 'KTKO50_202611181600_105_25'), bB = img(B('제주청', '6', '제11-51호', '2026-11-18 16:00'), 'KTKO50_202611181600_184_51');
        const ref = (b) => ({ rpt: b.rpt, office: b.office, ho: b.result.t1Title, inMs: Date.parse(b.result.tmIn.slice(0, 19).replace(' ', 'T') + '+09:00') });
        const need = D.needed({ z: { list: [ref(bB)] } }, [bA, bB], [ref(bA)]);
        ok('원문 보관: 발자취에 없어도 안내가 적힌 통보문은 둔다(extra) · extra 가 없으면 종전 그대로', need.size === 2 && need.has('KTKO50_202611181600_105_25') && D.needed({ z: { list: [ref(bB)] } }, [bA, bB]).size === 1 && D.needed({}, [bA], [ref(bA)]).size === 1);
        const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
        const sch = read('local_server/scheduler.js'), route = read('local_server/routes/weather.js'), cli = read('client/js/forecast/alerts/escalation.js'), ren = read('client/js/forecast/alerts/render.js'), dat = read('client/js/forecast/alerts/data.js'), idx = read('client/index2.html');
        ok('스케줄러: 통보문 기준 계산 다음 매분 — 실패해도 원문 보관은 간다 · 안내 통보문을 원문 보관에 넘긴다', /escRefs = esc\.run\(\{ zones: st\.zones \}\)\.refs/.test(sch) && /catch \(err\) \{ log\(`⚠️ \[bulletin_escalation\][^\n]*escRefs = \(esc\.read\(\) \|\| \{\}\)\.refs \|\| \[\]/.test(sch) && /extra: escRefs/.test(sch));
        ok('화면용 주소: 때가 지난 것은 빼고, 받아 둔 그림이 있으면 그 주소를 붙인다 — 특보현황 주소(/api/weather-alerts)와 따로', route.includes("router.get('/api/zone-escalations'") && /it\.expMs > now/.test(route) && /doc\.viewUrl = '\/api\/bulletin-doc\/' \+ d\.key \+ '\/view'/.test(route));
        ok('화면: 뱃지 🔺 · 빨강 상자 · 출처 뱃지 셋 · 📋 원문 팝업 · 글은 textContent 로만', /firstBadge\.textContent \+= ' 🔺'/.test(ren) && /window\.renderZoneEscalation\(it\)/.test(ren) && ['통보문', '단기전망', '초단기전망'].every((s) => cli.includes("'" + s + "'")) && /풍랑 경보 변경 가능성/.test(cli) && /태풍 특보 변경 가능성/.test(cli)
            && /openKmaIframeModal\(url, safeTitle\)/.test(cli) && !/innerHTML/.test(cli.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
        ok('화면: 「일부 해역만」 카드에는 안 단다 · 이미 경보·태풍인 카드에는 풍랑 가능성을 안 그린다(태풍 가능성은 태풍일 때만 숨김)', /!kidsOnly && typeof window\.zoneEscalations === 'function'/.test(ren) && /it\.kind === 'typhoon' \? !any\(typhoon\) : !any\(typhoon\) && !any\(warning\)/.test(cli));
        ok('화면: 목록을 2.5초까지만 기다린다(느리면 카드를 먼저 그리고, 늦게 오면 다시 그린다) · 풍랑 특보가 없는 카드에는 안 그린다 · 지난 날은 「(어제)」 · 팝업에는 우리 서버 그림·https 주소와 꺾쇠 뺀 제목만',
            /Promise\.race\(\[got, new Promise/.test(cli) && /WAIT_MS = 2500/.test(cli) && /if \(late && typeof w\.renderApp === 'function'\) w\.renderApp\(\)/.test(cli) && /if \(!any\(wave\)\) return \[\]/.test(cli)
            && /diff === -1 \? '\(어제\)'/.test(cli) && /replace\(\/\[<>&"'`\]\/g, ''\)/.test(cli) && cli.includes("if (!/^(?:\\/api\\/bulletin-doc\\/|https:\\/\\/)[^\"'<>\\s]+$/.test(url)) url = '';"));
        ok('화면: 특보를 받을 때 함께 받는다 · 스크립트 순서 data → escalation → render', (dat.match(/window\.loadZoneEscalations\(\)/g) || []).length === 2 && idx.indexOf('js/forecast/alerts/data.js') < idx.indexOf('js/forecast/alerts/escalation.js') && idx.indexOf('js/forecast/alerts/escalation.js') < idx.indexOf('js/forecast/alerts/render.js'));
        const ai = require('../services/bulletin_ai'), cfg = ai.getConfig();
        ok('AI 모델 설정 ⑤ escalation: 기본 Gemini 만(다른 AI 는 관리자가 추가해야 쓰인다) · 저장된다 · 관리자 화면에 칸이 있다', cfg.escalation && cfg.escalation.order[0] === 'gemini' && cfg.escalation.removed.length === 4 && ai.FEATURES.escalation.name === '격상 가능성 읽기'
            && ai.setConfig('escalation', { removed: ['upstage', 'chatgpt'] }).ok && ai.getConfig().escalation.removed.join() === 'upstage,chatgpt' && /escalation: \['⑤ 격상 가능성 읽기'/.test(read('client/js/admin/admin_bulletin_ai.js')) && /drawFeature\(host, 'escalation'\)/.test(read('client/js/admin/admin_bulletin_ai.js')));
        const src = read('local_server/services/bulletin_escalation.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        ok('MMIS 코드를 쓰지 않는다', !/marine_client|marine_warning_crawler|fetchWarn|ntfctn/.test(src));
    }

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
