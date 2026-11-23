'use strict';
/**
 * ============================================================================
 * 파일명: local_server/scripts/test_news_collector.js
 * 역할  : 오늘의 뉴스(services/news_collector · services/news_judge) 검사 — 모으기·겹침 지우기·확실한 것만 거르기·AI 판정·같은 사건 묶기·
 *         새 소식만 새 카드·판정 실패는 다음에 다시·펼친 횟수·30일 정리·요약의 지어낸 숫자 막기. 네이버·AI·기사 페이지 없이 가짜로 돈다.
 * 사용자 확정: client/js/notice/news_hub.design.md §1·§1-2·§2(원문 인용)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/news_collector.js · services/news_judge.js · services/naver_search.js · routes/news.js · server.js(글자 확인)
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh 의 SUITES
 * [로드 순서] 해당 없음(단독 실행: node local_server/scripts/test_news_collector.js)
 * ============================================================================
 */
const fs = require('fs'), os = require('os'), path = require('path');
const N = require('../services/news_collector');
const J = require('../services/news_judge');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 300) : '')); } };
const H = 3600000, DAY = 86400000;
const T0 = Date.parse('2026-11-21T05:02:00Z');   // KST 2026-11-21 14:02
const rfc = (ms) => new Date(ms).toUTCString().replace('GMT', '+0000');
const item = (title, desc, url, ms) => ({ title: '<b>' + title + '</b>', description: desc, link: url, originallink: url, pubDate: rfc(ms) });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'news-'));

/** 가짜 바깥: results[검색어] = items 배열(쪽마다 100개씩 자른다) · verdict(제목) = 판정 · meta 는 고정 사진 */
function fake() {
    const f = { results: {}, failKw: new Set(), searched: [], judged: [], verdict: () => ({ score: 1, cat: 'none' }), judgeFail: false, clock: T0, metas: [] };
    f.search = async (q, o) => {
        f.searched.push(q + '@' + o.start);
        if (f.failKw.has(q)) return { ok: false, items: [], total: 0, error: 'HTTP 401' };
        const all = f.results[q] || [];
        return { ok: true, items: all.slice(o.start - 1, o.start - 1 + 100), total: all.length };
    };
    f.judge = async (arts, cards) => {
        f.judged.push({ titles: arts.map((a) => a.title), cards: cards.map((c) => c.id) });
        if (f.judgeFail) return { results: [], failed: arts.map((_, i) => i), providers: {}, errors: ['모든 AI 실패'] };
        return { results: arts.map((a, i) => Object.assign({ i, score: 1, cat: 'none', region: '', group: '', same: '', newInfo: false, summary: a.desc, summaryFixed: false, reason: '', provider: 'gemma' }, f.verdict(a.title, cards))), failed: [], providers: { gemma: 1 }, errors: [] };
    };
    f.meta = async (u) => { f.metas.push(u); return { image: /kbs/.test(u) ? 'http://news.kbs.co.kr/a.jpg' : 'https://img.example.com/' + path.basename(u) + '.jpg', site: /kbs/.test(u) ? 'KBS' : '' }; };
    f.now = () => f.clock;
    f.groups = () => [];   // 그날 카드 전체 같은 사건 묶기(가짜) — 기본은 묶을 것 없음
    f.grouped = [];
    f.dedupe = async (cards) => { f.grouped.push(cards.map((x) => x.title)); return { groups: f.groups(cards), by: 'gemma' }; };
    return f;
}
const mk = (f, dir) => N.createNews({ dir, configFile: path.join(dir, 'cfg.json'), search: f.search, judge: f.judge, meta: f.meta, now: f.now, dedupe: (cards) => f.dedupe(cards) });

(async () => {
    console.log('① 글 정리·열쇠');
    ok('<b>·엔티티를 걷는다', N.clean('<b>금어기</b> &quot;해제&quot; &amp; 단속') === '금어기 "해제" & 단속');
    ok('주소 열쇠: www·추적 꼬리 빼고 같은 기사', N.urlKey('https://www.a.com/x?utm_source=naver&id=3') === N.urlKey('https://a.com/x?id=3&ref=naver'));
    ok('제목 열쇠: 띄어쓰기·[단독] 무시', N.titleKey('[단독] 암컷 대게, 처벌') === N.titleKey('암컷대게 처벌'));
    ok('KST 날짜·짧은 시각', N.kstDate(Date.parse('2026-11-20T16:00:00Z')) === '2026-11-21' && N.kstShort(Date.parse('2026-11-20T05:36:00Z')) === '11.20 14:36');

    console.log('② 첫 수집 — 겹침 지우기·마트 할인 버리기·판정·같은 사건 묶기');
    const f = fake(), dir = tmp(), c = mk(f, dir);
    f.results = {
        '해경 단속': [
            item('암컷 대게, 잡아도 팔아도 처벌…12월 1일부터 특별단속', '울진해경이 12월 1일부터 3개월간 대게 불법 포획을 단속한다. 암컷과 9cm 이하 대게가 대상이다.', 'https://www.kbmaeil.com/a1', T0 - 2 * H),
            item('동해해경청, 대게 불법 포획 특별 단속', '동해해경청이 대게 성어기 불법 포획·유통을 단속한다.', 'https://news.kbs.co.kr/a2', T0 - 3 * H),
            item('어제 기사(창 밖)', '오래된 기사', 'https://old.com/1', T0 - 30 * H),
        ],
        '어업 보조금': [
            item('암컷 대게, 잡아도 팔아도 처벌…12월 1일부터 특별단속', '같은 기사가 다른 검색어로', 'https://kbmaeil.com/a1?utm_source=naver', T0 - 2 * H),   // 주소 겹침
            item('이마트, 참다랑어 뱃살 반값 할인', '주말 특가', 'https://mart.com/1', T0 - 1 * H),                                                          // 마트 할인 → 기계로 버림
            item('○○군, 어선 장비 지원사업 신청 접수', '어선 안전장비 구입비를 지원한다. 접수는 12월 5일까지.', 'https://news.kbs.co.kr/n1', T0 - 4 * H),   // KBS 사진은 http(가짜 meta)
            item('FIRA 워크숍 성료', '자율관리어업 워크숍을 열었다.', 'https://fira.com/w', T0 - 5 * H),
        ],
    };
    f.verdict = (t) => /대게/.test(t) ? { score: 4, cat: 'duty', region: '경북', group: 'b0:g1', summary: '12월 1일부터 3개월간 대게 불법 포획을 단속한다.' }
        : /지원사업/.test(t) ? { score: 4, cat: 'money', region: '' } : { score: 1, reason: '행사' };
    await c.setKeywords(['해경 단속', '어업 보조금']);
    let st = await c.run();
    ok('결과: 정상 · 받음 6(창 밖 1 제외) · 겹침 뺀 5 · 할인 1 버림 · 판정 4 · 실음 3 · 새 카드 2 · 묶음 1 · 뺀 기사 1', st.ok && st.fetched === 6 && st.unique === 5 && st.dropped === 1 && st.candidates === 4 && st.judged === 4 && st.kept === 3 && st.added === 2 && st.merged === 1 && st.rejected === 1, st);
    const D = c.day('2026-11-21');
    ok('카드 2장 · 최신순(발행 시각)', D.cards.length === 2 && D.cards[0].pubMs > D.cards[1].pubMs, D.cards.map((x) => x.title));
    const crab = D.cards.find((x) => /대게/.test(x.title));
    ok('같은 사건 묶음: 「외 1건」 · 대표는 원문 요약이 더 긴 기사 · 분류·지역 · 시각 꼴', crab && crab.more === 1 && /암컷 대게/.test(crab.title) && crab.cat === 'duty' && crab.catName === '처벌·의무' && crab.region === '경북' && /^\d{2}\.\d{2} \d{2}:\d{2}$/.test(crab.time), crab);
    ok('사진·언론사: 새 카드 대표 기사 페이지에서만 읽는다(2장 = 2번)', f.metas.length === 2 && D.cards.every((x) => /^https?:\/\//.test(x.image)), f.metas);
    ok('뺀 기사는 그날 파일에 남는다(관리자 [원문]·[싣기]용)', (() => { const raw = JSON.parse(fs.readFileSync(path.join(dir, '2026-11-21.json'), 'utf8')); return raw.rejected.length === 1 && raw.rejected[0].link === 'https://fira.com/w' && raw.rejected[0].reason === '행사'; })());
    ok('보관 날짜 목록', c.dates().join() === '2026-11-21');

    console.log('③ 두 번째 수집 — 이미 판정한 기사는 다시 묻지 않는다');
    f.clock = T0 + H; f.judged.length = 0;
    st = await c.run();
    ok('새 기사 없으면 판정 호출 없음 · 지난 확인 15분 전보다 오래된 기사는 다시 받지 않는다', st.ok && st.candidates === 0 && st.fetched === 0 && f.judged.length === 0, st);
    // 네이버 색인이 늦어 지난 확인 뒤에야 나타난, 그 전 10분 사이 기사 — 15분 겹쳐 보므로 잡힌다
    f.results['해경 단속'].unshift(item('늦게 색인된 기사', '내용', 'https://late.com/1', T0 + H - 10 * 60000));   // 지난 확인(T0+1h) 10분 전 발행
    f.clock = T0 + 1.5 * H;
    st = await c.run();
    ok('지난 확인과 15분 겹쳐 봐서 늦게 올라온 기사를 놓치지 않는다', st.ok && st.fetched === 1 && st.candidates === 1, st);

    console.log('④ 이미 실은 카드와 같은 사건 — 같은 날은 한 장(새 소식이면 머리를 최신으로), 다른 날은 새 소식일 때만 새 카드');
    f.clock = T0 + 2 * H;
    f.results['해경 단속'].unshift(
        item('대게 단속 또 보도', '같은 내용', 'https://c.com/r', T0 + 1.5 * H),
        item('대게 단속 첫날 12건 적발', '단속 첫날 12건을 적발했다.', 'https://c.com/n', T0 + 1.6 * H));
    f.verdict = (t, cards) => /또 보도/.test(t) ? { score: 4, cat: 'duty', same: crab.id, newInfo: false } : /적발/.test(t) ? { score: 4, cat: 'duty', same: crab.id, newInfo: true } : { score: 1 };
    st = await c.run();
    const D2 = c.day('2026-11-21');
    ok('판정에 오늘·어제 카드 목록을 준다', f.judged[f.judged.length - 1].cards.includes(crab.id));
    const crab2 = D2.cards.find((x) => x.id === crab.id);
    ok('같은 날: 반복 보도·새 소식 모두 그 카드에 더한다(「외 3건」) · 새 소식이면 카드 머리가 최신 소식 · 카드 수 그대로', st.merged === 2 && st.added === 0 && st.updated === 1 && D2.cards.length === 2
        && crab2.more === 3 && /12건 적발/.test(crab2.title), { st, cards: D2.cards.map((x) => [x.title, x.more]) });
    ok('대표 기사가 바뀐 카드는 사진을 다시 읽는다', f.metas.includes('https://c.com/n'), f.metas);
    {
        // 다음 날 — 새 소식이면 새 카드(followOf), 반복이면 어제 카드에 더한다
        const g = fake(), dd = tmp(), cc = mk(g, dd);
        await cc.setKeywords(['k']);
        g.results.k = [item('해광호 실종 사흘째 수색', '수색 중', 'https://a.com/1', T0 - 2 * H)];
        g.verdict = () => ({ score: 5, cat: 'safety' });
        await cc.run();
        const first = cc.day('2026-11-21').cards[0];
        g.clock = T0 + DAY;
        g.results.k.unshift(item('해광호 선체 발견', '선체를 발견했다', 'https://a.com/2', T0 + DAY - H), item('해광호 수색 계속', '수색 중', 'https://a.com/3', T0 + DAY - 0.5 * H));
        g.verdict = (t) => /발견/.test(t) ? { score: 5, cat: 'safety', same: first.id, newInfo: true } : { score: 5, cat: 'safety', same: first.id, newInfo: false };
        const s2 = await cc.run();
        const next = cc.day('2026-11-22').cards;
        ok('다른 날 새 소식 → 그날 새 카드 · 반복 보도 → 어제 카드 「외 1건」', s2.added === 1 && next.length === 1 && /발견/.test(next[0].title) && cc.day('2026-11-21').cards[0].more === 1, { s2, next: next.map((x) => x.title) });
    }
    {
        // 묶음(20건)을 넘어서도 같은 사건을 본다 — 앞 묶음에서 만든 카드를 다음 묶음에 준다(실제 시험: 해광호 카드 3장으로 갈라짐)
        const g = fake(), dd = tmp(), cc = mk(g, dd);
        await cc.setKeywords(['k']);
        g.results.k = Array.from({ length: 25 }, (_, i) => item(i === 24 ? '평택해경 대조기 주의보 (B)' : i === 0 ? '평택해경 대조기 주의보 (A)' : '기타 ' + i, '내용 ' + i, 'https://p.com/' + i, T0 - (30 - i) * 60000));
        let firstId = null;
        g.verdict = (t, cards) => {
            if (/\(A\)/.test(t)) return { score: 4, cat: 'safety' };
            if (/\(B\)/.test(t)) { const c0 = cards.find((c) => true); firstId = c0 && c0.id; return { score: 4, cat: 'safety', same: firstId || '', newInfo: false }; }
            return { score: 1 };
        };
        const s3 = await cc.run();
        ok('판정을 20건씩 나눠 부르고, 둘째 묶음에 첫 묶음 카드를 준다 → 같은 사건 한 장(「외 1건」)', g.judged.length === 2 && g.judged[1].cards.length === 1 && s3.added === 1 && cc.day('2026-11-21').cards[0].more === 1, { judged: g.judged.map((j) => [j.titles.length, j.cards.length]), s3 });
    }

    console.log('④-2 그날 카드 전체에서 같은 사건 한 번 더 합치기(사용자 2026-11-22 「중복내용 제외」 — 해수부 원산지 점검 카드 4장)');
    {
        const g = fake(), dd = tmp(), cc = mk(g, dd);
        await cc.setKeywords(['k']);
        const T = ['해수부, 김장철 수산물 원산지 표시 특별 점검', '해수부, 김장철 맞이 천일염·젓갈 원산지 집중 단속', '김장철 수산물 원산지 특별점검…해수부, 천일염·젓갈 집중단속', '경남도, 23일부터 김장철 수산물 원산지 특별 단속 실시', '숨긴 카드: 해수부 원산지 점검'];
        g.results.k = T.map((t, i) => item(t, i === 2 ? '해양수산부가 다음 달 4일까지 김장철 수산물 원산지 표시 특별점검을 한다. 천일염·젓갈이 중점이다.' : '내용 ' + i, 'https://o.com/' + i, T0 - (5 - i) * 600000));
        g.verdict = () => ({ score: 4, cat: 'duty' });   // 판정 단계는 묶음을 빠뜨렸다(운영에서 실제로 난 일)
        await cc.run();
        let D = cc.day('2026-11-21');
        ok('준비: 판정만으로는 카드 5장', D.cards.length === 5, D.cards.map((x) => x.title));
        const id = (i) => D.cards.find((x) => x.title === T[i]).id;
        cc.hit('2026-11-21', id(0)); cc.hit('2026-11-21', id(1)); cc.hit('2026-11-21', id(1));
        await cc.setHidden('2026-11-21', id(4), true);
        // 다음 회차: 새 기사 1건 + 묶기 AI 가 해수부 3장을 한 묶음으로
        g.clock = T0 + H;
        g.results.k.unshift(item('해광호 수색', '수색', 'https://o.com/z', T0 + 0.5 * H));
        g.verdict = (t) => /해광호/.test(t) ? { score: 5, cat: 'safety' } : { score: 4, cat: 'duty' };
        g.groups = (cards) => { const i = (s) => cards.findIndex((x) => x.title.startsWith(s)); return [[i('해수부, 김장철 수산물'), i('해수부, 김장철 맞이'), i('김장철 수산물 원산지 특별점검')]]; };
        g.grouped.length = 0;
        const s = await cc.run();
        D = cc.day('2026-11-21');
        const main = D.cards.find((x) => /원산지/.test(x.title) && !/경남/.test(x.title));
        ok('묶기에 숨긴 카드는 넣지 않는다', g.grouped.length === 1 && !g.grouped[0].some((t) => /숨긴/.test(t)) && g.grouped[0].length === 5, g.grouped);
        ok('해수부 3장 → 1장(「외 2건」) · 다른 기관(경남도)은 따로 · 보이는 카드 5→3(숨긴 1장 빼고)', s.deduped === 2 && D.cards.length === 3 && main && main.more === 2 && D.cards.some((x) => /경남도/.test(x.title)), { s, cards: D.cards.map((x) => [x.title, x.more]) });
        ok('카드 머리는 묶음에서 가장 최근 기사', main && main.title === T[2], main && main.title);
        ok('펼친 횟수는 남는 카드에 더한다(1+2)', main && main.views === 3, main && main.views);
        const adm = cc.adminDay('2026-11-21');
        ok('숨긴 카드는 그대로 남는다', adm.cards.some((x) => x.hidden && /숨긴/.test(x.title)));
        const moved = adm.rejected.filter((x) => /같은 사건으로 합침/.test(x.reason));
        ok('합쳐서 빠진 카드는 「AI 가 뺀 기사」로 옮긴다(관리자가 [싣기]로 되살릴 수 있게 — 검토 지적)', moved.length === 2 && moved.every((x) => x.link && x.reason.includes(T[2])), adm.rejected);
        ok('「새 카드」 수는 합친 뒤 숫자(이번에 새로 실은 해광호 1장)', s.added === 1, s.added);
        g.clock = T0 + 2 * H; g.grouped.length = 0;
        await cc.run();
        ok('새 카드가 없는 회차는 묶기를 부르지 않는다(AI 호출 아끼기)', g.grouped.length === 0, g.grouped);
    }
    {
        // 사고 후속: 머리가 최신 소식 · 관리자가 실은 카드는 빼지 않음 · AI 를 기다리는 사이 들어온 펼침을 덮지 않음
        const g = fake(), dd = tmp(), cc = mk(g, dd);
        await cc.setKeywords(['k']);
        g.results.k = [item('해광호 실종 수색 사흘째', '수색이 이어졌다. 해경 함정 10척이 투입됐다.', 'https://h.com/1', T0 - 3 * H), item('해광호 수색 계속', '수색', 'https://h.com/2', T0 - 2.5 * H), item('관리자 기사', '내용', 'https://h.com/m', T0 - 2 * H)];
        g.verdict = (t) => /관리자/.test(t) ? { score: 1, reason: '홍보' } : { score: 5, cat: 'safety' };
        await cc.run();
        const rj = cc.adminDay('2026-11-21').rejected.find((x) => /관리자/.test(x.title));
        await cc.publish('2026-11-21', 0, 'rule', rj.link);
        let D = cc.day('2026-11-21');
        const old = D.cards.find((x) => x.title === '해광호 실종 수색 사흘째') || D.cards.find((x) => /해광호/.test(x.title));
        cc.hit('2026-11-21', old.id);
        g.clock = T0 + H;
        g.results.k.unshift(item('해광호 선원 시신 발견', '선원 1명을 발견했다.', 'https://h.com/3', T0 + 0.5 * H));
        g.verdict = () => ({ score: 5, cat: 'safety' });
        let manId = D.cards.find((x) => /관리자/.test(x.title)).id, otherId = D.cards.find((x) => /해광호/.test(x.title) && x.id !== old.id);
        otherId = otherId && otherId.id;
        g.dedupe = async (cards) => {
            cc.hit('2026-11-21', manId); cc.hit('2026-11-21', manId);   // AI 를 기다리는 사이 다른 카드 펼침 2번
            return { groups: [cards.map((_, i) => i)], by: 'gemma' };   // AI 가 지나치게 묶음(관리자 카드까지)
        };
        await cc.run();
        D = cc.day('2026-11-21');
        const acc = D.cards.find((x) => /해광호/.test(x.title));
        ok('후속 소식이 합쳐지면 카드 머리는 최신 소식(「시신 발견」이 묻히지 않게 — 검토 지적)', D.cards.filter((x) => /해광호/.test(x.title)).length === 1 && acc.title === '해광호 선원 시신 발견', D.cards.map((x) => x.title));
        ok('관리자가 실은 카드는 묶기에 넣지 않는다(AI 가 모두 한 묶음이라 해도 — 관리자 고른 분류 그대로)', D.cards.some((x) => /관리자/.test(x.title) && x.cat === 'rule'), D.cards.map((x) => [x.title, x.cat]));
        ok('AI 를 기다리는 사이 들어온 펼친 횟수를 덮지 않는다(검토 지적 — 종전엔 0)', D.cards.find((x) => /관리자/.test(x.title)).views === 2, D.cards.map((x) => [x.title, x.views]));
        ok('합친 카드의 펼친 횟수는 남는 카드로', acc.views === 1, acc.views);
        const mv = cc.adminDay('2026-11-21').rejected.filter((x) => /같은 사건으로 합침/.test(x.reason));
        ok('「AI 가 뺀 기사」에는 화면에서 빠진 기사만 — 머리가 된 「시신 발견」은 없고 「→ 자기 자신」 줄도 없다(운영 2026-11-23 관리자 화면에서 발견)',
            mv.length === 2 && !mv.some((x) => /시신 발견/.test(x.title)) && mv.every((x) => !x.reason.includes('「' + x.title + '」')) && mv.some((x) => x.title === '해광호 실종 수색 사흘째'), mv.map((x) => [x.title, x.reason]));
    }
    {
        // 묶기 AI 가 실패하면 합치지 않고, 새 카드가 없어도 다음 회차에 다시 묻는다 · 관리자 화면에 띄울 실패 기록
        const g = fake(), dd = tmp(), cc = mk(g, dd);
        await cc.setKeywords(['k']);
        g.results.k = [item('통영 해상서 어선 전복…선원 2명 실종', '통영', 'https://t.com/1', T0 - 2 * H), item('여수 해상서 어선 전복…선원 2명 실종', '여수', 'https://t.com/2', T0 - H)];
        g.verdict = () => ({ score: 5, cat: 'safety' });
        g.dedupe = async (cards) => { g.grouped.push(cards.length); return { groups: [], by: 'failed', error: '모든 AI 실패' }; };
        const s1 = await cc.run();
        ok('AI 실패 → 합치지 않음(제목 틀이 같은 다른 사고가 붙지 않게) · 실패 기록', cc.day('2026-11-21').cards.length === 2 && s1.dedupeBy === 'failed' && s1.dedupeError === '모든 AI 실패' && s1.dedupeRetry.join() === '2026-11-21' && s1.ok, s1);
        g.clock = T0 + H;
        const s2 = await cc.run();
        ok('새 카드가 없어도 지난 회차에 실패한 날은 다시 묻는다', g.grouped.length === 2 && s2.dedupeRetry.length === 1, { n: g.grouped, s2 });
        g.dedupe = async () => ({ groups: [], by: 'gemma' });
        g.clock = T0 + 2 * H;
        const s3 = await cc.run();
        ok('다시 물어 성공하면 더 묻지 않는다', s3.dedupeRetry.length === 0 && s3.dedupeBy === 'gemma', s3);
    }
    {
        const calls = [];
        const cards = [{ title: '해수부, 김장철 수산물 원산지 표시 특별 점검' }, { title: '해수부, 내달 4일까지 김장철 수산물 원산지 표시 특별점검' }, { title: '부산해경, 김장철 농수산물 유통 특별단속' }, { title: '실종 어선 해광호 수색 닷새째' }];
        const r1 = await J.groupDuplicates(cards, { call: async (fn, prm, o) => { calls.push(fn + '|' + prm); return { success: false, error: '모든 AI 실패' }; } });
        ok('groupDuplicates: AI 실패 → 묶지 않는다(by failed · 까닭)', r1.by === 'failed' && r1.groups.length === 0 && r1.error === '모든 AI 실패', r1);
        ok('⑦ news 로 부른다 · 지시문: 제목·요약 목록과 「기관·지역·사건이 다르면 따로」', /^news\|/.test(calls[0]) && /\[3\] 실종 어선 해광호/.test(calls[0]) && /기관·지역·사건이 다르면 따로/.test(calls[0])
            // 운영 2026-11-22·23: 「오늘의 안전 상황」 종합 기사가 다른 카드와 합쳐졌고, 22일 진도 전복 카드가 사라졌다(해광호 카드에 합쳐진 것으로 추정)
            && /배 이름·장소가 다르면/.test(calls[0]) && /종합·정리 기사.*어느 묶음에도 넣지 않는다/.test(calls[0]));
        const bad = await J.groupDuplicates(cards, { call: async () => ({ success: true, text: '{"groups":[[0,9]]}', provider: 'gemma' }) });
        ok('답에 없는 번호가 있으면 버린다', bad.by === 'failed' && bad.groups.length === 0, bad);
        const dup = await J.groupDuplicates(cards, { call: async () => ({ success: true, text: '{"groups":[[0,1],[1,2]]}', provider: 'gemma' }) });
        ok('한 카드가 두 묶음에 있으면 버린다', dup.by === 'failed', dup);
        const good = await J.groupDuplicates(cards, { call: async (fn, prm, o) => { const text = '{"groups":[[0,1]]}'; return o.accept(JSON.parse(text)) ? { success: true, text, provider: 'gemma' } : { success: false }; } });
        ok('좋은 답은 그대로 · 누가 답했나', good.by === 'gemma' && JSON.stringify(good.groups) === '[[0,1]]', good);
    }

    console.log('⑤ 판정이 실패하면 다음 시간에 다시');
    f.clock = T0 + 3 * H; f.judgeFail = true;
    f.results['어업 보조금'].unshift(item('양식 재해보험 가입 지원', '양식 재해보험료를 지원한다.', 'https://d.com/1', T0 + 2.5 * H));
    st = await c.run();
    ok('판정 전부 실패 → ok:false · 이유', st.ok === false && /AI 판정이 모두 실패/.test(st.error || '') && st.failed === 1, st);
    f.clock = T0 + 4 * H; f.judgeFail = false; f.verdict = () => ({ score: 3, cat: 'money' });
    st = await c.run();
    ok('다음 시간에 그 기사를 다시 묻고 싣는다(창이 지나도 pending 으로)', st.ok && st.candidates === 1 && st.added === 1 && c.day('2026-11-21').cards.some((x) => /재해보험/.test(x.title)), st);

    console.log('⑥ 기사가 많은 검색어는 다음 쪽까지');
    {
        const g = fake(), d2 = tmp(), c2 = mk(g, d2);
        g.results['어선 사고'] = Array.from({ length: 150 }, (_, i) => item('사고 ' + i, '내용 ' + i, 'https://x.com/' + i, T0 - (i + 1) * 60000));
        await c2.setKeywords(['어선 사고']);
        const s = await c2.run();
        ok('100건이 모두 창 안이면 2쪽을 받는다', g.searched.join() === '어선 사고@1,어선 사고@101' && s.fetched === 150, { searched: g.searched, s });
    }

    console.log('⑥-2 검색어 하나만 실패해도 다음 회차에 그 검색어의 놓친 시간을 다시 받는다(검토 지적 — 종전엔 영영 놓침)');
    {
        const g = fake(), d5 = tmp(), c5 = mk(g, d5);
        await c5.setKeywords(['A', 'B']);
        g.results.A = [item('기사A', 'a', 'https://a.com/1', T0 - 30 * 60000)];
        g.results.B = [item('어선 전복 기사B', 'b', 'https://b.com/1', T0 - 40 * 60000)];
        g.verdict = () => ({ score: 4, cat: 'safety' });
        await c5.run();                                           // 기준 회차(둘 다 받음)
        g.clock = T0 + H; g.failKw = new Set(['B']);
        g.results.B.unshift(item('어선 전복 기사B2', 'b2', 'https://b.com/2', T0 + 0.5 * H));
        const s1 = await c5.run();
        ok('B 만 실패 → 정상(실패 목록에 B)', s1.ok === true && s1.keywordErrors.length === 1);
        g.clock = T0 + 2 * H; g.failKw = new Set();
        await c5.run();
        ok('다음 회차에 B 는 마지막으로 받은 때부터 다시 받아 B2 를 싣는다', c5.day('2026-11-21').cards.some((x) => /기사B2/.test(x.title)), c5.day('2026-11-21').cards.map((x) => x.title));
    }

    console.log('⑦ 검색어가 모두 실패하면 실패로 남는다(기사 0건과 구별)');
    {
        const g = fake(), d3 = tmp(), c3 = mk(g, d3);
        await c3.setKeywords(['가', '나']); g.failKw = new Set(['가', '나']);
        const s = await c3.run();
        ok('ok:false · 「검색어 2개 모두 받지 못함」', s.ok === false && /검색어 2개 모두/.test(s.error || '') && s.keywordErrors.length === 2, s);
        g.failKw = new Set(['가']);
        const s2 = await c3.run();
        ok('하나만 실패면 정상(실패 목록은 남김)', s2.ok === true && s2.keywordErrors.length === 1, s2);
    }

    console.log('⑧ 펼친 횟수 · http 사진 · 30일 정리');
    {
        const id = crab.id;
        c.hit('2026-11-21', id); const n2 = c.hit('2026-11-21', id);
        ok('펼칠 때마다 1', n2 === 2 && c.day('2026-11-21').cards.find((x) => x.id === id).views === 2);
        c.hit('2026-11-21', id, true); c.hit('2026-11-21', id, true);
        ok('관리자는 같은 날 1번만', c.day('2026-11-21').cards.find((x) => x.id === id).views === 3);
        ok('없는 카드·꼴이 아닌 값은 null', c.hit('2026-11-21', 'n0000000000') === null && c.hit('../x', id) === null && c.hit('2026-11-21', '../../a') === null);
        ok('우리 카드에 실린 사진 주소만 전달 대상', c.imageKnown('http://news.kbs.co.kr/a.jpg') === true && c.imageKnown('http://evil.com/x.jpg') === false);
        f.clock = T0 + 31 * DAY; f.results = {}; await c.run();
        ok('30일 지난 날짜 파일·펼친 횟수를 지운다', !fs.existsSync(path.join(dir, '2026-11-21.json')) && !Object.keys((JSON.parse(fs.readFileSync(path.join(dir, 'views.json'), 'utf8')).count) || {}).length, c.dates());
    }

    console.log('⑨ 검색어 설정');
    {
        const d4 = tmp(), c4 = mk(fake(), d4);
        ok('기본 검색어(보조금·해상풍력·해경 포함)', c4.keywords().length >= 40 && ['어업 보조금', '해상풍력 어민', '해경 단속'].every((k) => c4.keywords().includes(k)));
        ok('빈 글·겹침 빼고 저장', c4.setKeywords([' 금어기 ', '금어기', '', '적조']).keywords.join() === '금어기,적조' && c4.keywords().join() === '금어기,적조');
        ok('빈 목록은 거절', c4.setKeywords([]).ok === false && c4.setKeywords('x').ok === false);
    }

    console.log('⑩ 판정 모듈 — 지시문·답 검사·지어낸 숫자 막기');
    {
        const p = J.prompt([{ title: 'T', desc: 'D', source: 's', time: '11.21 09:00' }], [{ id: 'nabc', title: '해광호', date: '2026-11-21' }]);
        ok('지시문: 대상자(해양경찰관 중간)·보조금·법 개정·새 사실·이미 실은 카드·번호', /중간: [^\n]*해양경찰관/.test(p) && /정부·지자체 보조금/.test(p) && /법 개정/.test(p) && /new_info/.test(p) && /nabc/.test(p) && /0~0/.test(p));
        ok('답 검사: 정상', J.shapeOk({ items: [{ i: 0, score: 4, cat: 'duty' }, { i: 1, score: 1, cat: 'none' }] }, 2));
        ok('답 검사: 번호 빠짐·겹침·점수 밖·실을 기사의 분류 없음은 거절', !J.shapeOk({ items: [{ i: 0, score: 4, cat: 'duty' }] }, 2) && !J.shapeOk({ items: [{ i: 0, score: 4, cat: 'duty' }, { i: 0, score: 1 }] }, 2)
            && !J.shapeOk({ items: [{ i: 0, score: 7, cat: 'duty' }] }, 1) && !J.shapeOk({ items: [{ i: 0, score: 3, cat: 'x' }] }, 1) && !J.shapeOk([], 1));
        ok('요약의 숫자가 원문에 있으면 그대로', J.fixSummary('12월 1일부터 3개월 단속.', '12월 1일부터 3개월간', 'x').fixed === false);
        const fx = J.fixSummary('단속으로 30% 줄었다.', '단속을 시작했다. 대상은 대게다. 셋째 문장.', '단속을 시작했다. 대상은 대게다. 셋째 문장.');
        ok('원문에 없는 숫자 → 원문 요약 앞 2문장으로', fx.fixed === true && fx.text === '단속을 시작했다. 대상은 대게다.', fx);
        const fu = J.fixSummary('https://youtu.be/4xPMXU5Vf98', 'https://youtu.be/4xPMXU5Vf98', 'https://youtu.be/4xPMXU5Vf98?si=C1wh', '외국인 선원 55% 시대… 정부 개편에 어업현장 반발');
        ok('숫자는 덩이째 견준다 — 원문 2023년의 3·100억의 10 으로 지어낸 3명·10억을 통과시키지 않는다(검토 지적)', J.fixSummary('어선 전복으로 3명이 숨졌다.', '2023년 이후 1명 실종', '원문 요약이다. 둘째.', 't').fixed === true
            && J.fixSummary('보조금 10억원', '보조금 100억원 지원', '원문 요약이다. 둘째.', 't').fixed === true && J.fixSummary('1,000명 지원', '1000명을 지원', 'x', 't').fixed === false && J.fixSummary('12월 1일부터 3개월', '12월 1일부터 3개월간', 'x', 't').fixed === false);
        ok('요약·원문 요약이 주소뿐이면 제목을 쓴다(실제 시험에서 유튜브 주소가 나갔다)', fu.fixed === true && fu.text === '외국인 선원 55% 시대… 정부 개편에 어업현장 반발', fu);
        ok('지시문: 시·군 이름이면 그 시·도(태안→충남)', /태안→충남/.test(J.prompt([{ title: 'T', desc: 'D', source: 's', time: 't' }], [])));
        ok('지시문: 관광 개발은 수상레저가 함께 나와도 1점(실제 시험에서 홍도 관광 기사가 3점으로 실림)', /관광 개발·관광객 유치 계획은 수상레저·여객선이 함께 언급돼도 1점/.test(J.prompt([{ title: 'T', desc: 'D', source: 's', time: 't' }], [])));
        const calls = [];
        const good = await J.judge([{ title: 'A', desc: '12월 1일', source: 's', time: 't' }, { title: 'B', desc: 'b', source: 's', time: 't' }], [], { call: async (fName, prm, o) => {
            calls.push(fName); const text = JSON.stringify({ items: [{ i: 0, score: 4, cat: 'duty', region: '경북', group: 'g1', summary: '12월 1일부터 단속', reason: 'r' }, { i: 1, score: 1, cat: 'none' }] });
            return o.accept(JSON.parse(text)) ? { success: true, text, provider: 'gemma' } : { success: false, error: 'x' }; } });
        ok('judge: ⑦ news 로 부른다 · 결과·묶음 열쇠·누가 답했나', calls.join() === 'news' && good.results.length === 2 && good.results[0].group === 'b0:g1' && good.results[0].region === '경북' && good.providers.gemma === 1 && good.failed.length === 0, good);
        const bad = await J.judge(Array.from({ length: 25 }, (_, i) => ({ title: 't' + i, desc: 'd', source: 's', time: 't' })), [], { call: async () => ({ success: true, text: '{"items":[]}', provider: 'gemini' }) });
        ok('답 모양이 틀리면 그 묶음(20건씩) 기사를 failed 로 — 다음 시간에 다시', bad.failed.length === 25 && bad.results.length === 0 && bad.errors.length === 2, { f: bad.failed.length, e: bad.errors });
    }

    console.log('⑪ 연결(글자 확인)');
    const root = path.join(__dirname, '..');
    const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    ok('server.js: 라우트 연결 · 운영 시작에서 start', server.includes("app.use(require('./routes/news'))") && server.includes("require('./services/news_collector').start()"));
    const route = fs.readFileSync(path.join(root, 'routes', 'news.js'), 'utf8');
    ok('라우트: 날짜별 목록·펼친 횟수·사진 전달(우리 카드 사진만)', route.includes("router.get('/api/news'") && route.includes("/api/news/:date/:id/open") && route.includes("/api/news/img") && route.includes('imageKnown(u)'));
    ok('naver_search: searchNews 를 내보낸다', typeof require('../services/naver_search').searchNews === 'function');
    ok('AI 모델 설정에 ⑦ news 가 있다', !!require('../services/bulletin_ai').FEATURES.news);
    ok('운영이 아니면 start 하지 않는다', (() => { const was = process.env.FLY_ALLOC_ID; delete process.env.FLY_ALLOC_ID; const r = mk(fake(), tmp()).start(); if (was) process.env.FLY_ALLOC_ID = was; return r === false; })());

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
