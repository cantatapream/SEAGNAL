'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/news_judge.js
 * 역할  : 오늘의 뉴스 — 모은 기사 묶음을 AI 에게 보내 「해양종사자에게 영향이 있는가」를 판정받고(점수·분류·지역·요약·같은 사건),
 *         돌아온 답을 검사한다. AI 는 관리자 센터 「AI 모델 설정 ⑦ 오늘의 뉴스 판정」에서 고른 순서대로 부른다(services/bulletin_ai.call('news')).
 * 사용자 확정(설계 client/js/notice/news_hub.design.md §2, 원문 인용은 그 문서):
 *   대상자 — 어업인·양식인·낚시/레저 = 높음 / 수산물 유통·가공·섬 주민·여객선·해양경찰관 = 중간(「중간 유지」) / 상선·해운 선원 = 낮음
 *   6개 묶음 — 돈(정부·지자체 보조금 명시) · 처벌·의무 · 조업·이용 규칙 · 안전 · 바다 여건 · 바다 이용 갈등·제도
 *   3단계 — 누구에게 → 무엇이 → 얼마나 확정·급한가(5·4·3점, 2점 이하 탈락) · 이어지는 사고는 새 소식만 · 해외는 우리 연루·국내 규제 영향만
 *   법 개정 — 「뉴스에서 법개정은 해양종사자애 관련이 있는 부분에 대해서 뉴스로 보도된것만 게시」
 * 환각 막기: 요약에 원문(그 기사·같은 묶음 기사의 제목·요약)에 없는 숫자가 있으면 요약을 버리고 원문 요약으로 바꾼다(fixSummary).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_ai(call('news') · looseJson)
 *  - 나를 쓰는 곳  : services/news_collector.js(매시) · 검사 scripts/test_news_collector.js
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */

const CATS = { money: '돈', duty: '처벌·의무', rule: '조업·이용 규칙', safety: '안전', sea: '바다 여건', conflict: '바다 이용 갈등·제도' };
const REGIONS = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주', '전국'];
const BATCH = 20;          // 한 번에 묻는 기사 수 — 답이 길어져 잘리거나 빠뜨리지 않을 만큼
const SUMMARY_MAX = 320;   // 2~3문장(글자) — 넘으면 원문 요약으로

/**
 * 판정 지시문을 만든다.
 * 예: prompt([{ title:'암컷 대게…', desc:'…', source:'경북매일', time:'11.20 14:36' }], [{ id:'n1a2', title:'해광호 실종…' }])
 * @param {Array<{title:string, desc:string, source:string, time:string}>} arts 번호는 0부터
 * @param {Array<{id:string, title:string, date:string}>} cards 오늘·어제 이미 실은 카드(같은 사건을 묶으라고 준다)
 * @returns {string}
 * [연계] ← judge(이 파일)
 */
function prompt(arts, cards) {
    const list = arts.map((a, i) => `[${i}] (${a.source || '언론사 모름'} · ${a.time}) ${a.title}\n    ${a.desc}`).join('\n');
    const have = cards.length ? cards.map((c) => `- ${c.id} (${c.date}) ${c.title}`).join('\n') : '(없음)';
    return `너는 바다에서 일하는 사람들을 위한 뉴스 편집자다. 아래 기사마다 「해양종사자의 돈·처벌·조업·안전에 실제 변화가 생기는가」를 판정하라.

[대상자]
- 높음(같은 비중): 어업인(어선 선주·선장·어선원, 맨손어업·해녀·어촌계), 양식인(어류·패류·해조류), 낚시·레저(낚시인·낚시어선업, 보트·제트스키·카약·서핑·스쿠버, 해루질·갯바위 방문객)
- 중간: 수산물 유통·가공(위판장·중도매인·가공업), 섬 주민·여객선 이용자, 해양경찰관(단속 기준·처벌 조항 변경, 해상 사고·수색, 해경 제도·장비 변화)
- 낮음: 상선·해운 선원

[분류 cat]
- money(돈): 정부·지자체 보조금·지원금(공고·신청 접수), 융자, 어선보험·재해보험, 면세유·직불금, 피해 보상(적조·태풍·기름 유출), 가격·시장 동향
- duty(처벌·의무): 처벌·과태료 신설·강화, 단속 예고·결과, 면허·등록·검사 의무 변경, 시행일
- rule(조업·이용 규칙): 금어기·금채기·TAC(총허용어획량)·금지체장, 어구 규제, 조업·보호구역, 출입통제, 낚시 포획 제한, 레저 규칙
- safety(안전): 인명·선박 사고와 그 새 소식, 위험예보, 의무 장비, 사고 원인 발표
- sea(바다 여건): 적조·고수온·해파리·냉수대, 해양오염, 어장 변화, 어획량 동향
- conflict(바다 이용 갈등·제도): 해상풍력·공유수면 점용, 외국인 선원 제도, 해양종사자 관련 법 개정·발의·입법예고, 무역협정, 어민 집회
- none: 어디에도 해당하지 않음

[점수 score — 3단계로 정한다: ①누구에게 ②무엇이 ③얼마나 확정·급한가]
- 5: 지금 바로 행동해야 함(인명사고, 곧 시행되는 처벌, 마감이 임박한 보조금)
- 4: 확정된 변화(법 공포·고시, 금어기 변경 확정, 단속 기간 발표)
- 3: 예정·논의 중인 변화(법안 발의, 입법예고, 정책 논쟁·어민 집회), 가격·어획 동향
- 2: 간접적인 내용 · 1: 무관하거나 홍보
- 반드시 1점: 임명·취임·MOU·협약·행사·축제·시상·기념식·단순 홍보·기관 실적 자랑·훈련·점검·교육 실시 기사·관광 개발·마트 할인 판매.
- 관광 개발·관광객 유치 계획은 수상레저·여객선이 함께 언급돼도 1점(그 기사가 레저 규칙·안전 의무를 바꾸는 경우만 판정).
- 해외 소식은 우리 선원·선박이 연루됐거나 국내 규제에 영향이 있을 때만 판정하고, 아니면 1점.

[같은 사건]
- 이 목록 안에서 같은 사건을 다룬 기사들은 group 에 같은 글자(예 "g1")를 준다. 혼자면 빈 글.
- 아래 「이미 실은 카드」와 같은 사건이면 same 에 그 카드 id 를 쓴다. 그 사건의 새 사실(발견·구조·원인 발표·처분 등)이 있으면 new_info:true, 같은 내용의 반복이면 new_info:false.

[요약 summary — 점수 3 이상만]
- 한국어 2~3문장. 제목과 기사 요약에 있는 사실만 쓴다. 숫자·날짜·지명·기관명은 원문 그대로. 원문에 없는 내용·추측·평가를 더하지 않는다.
- region: 기사의 장소가 속한 시·도 하나(${REGIONS.slice(0, -1).join('·')}). 시·군·항구 이름만 나와도 그것이 속한 시·도를 쓴다(예: 태안→충남, 울진·포항→경북, 통영·거제→경남, 속초·삼척→강원, 평택→경기). 여러 시·도에 걸치거나 전국 단위일 때만 "전국".

[이미 실은 카드]
${have}

[기사]
${list}

답은 JSON 하나만: {"items":[{"i":번호,"score":1~5,"cat":"money|duty|rule|safety|sea|conflict|none","region":"…","group":"","same":"","new_info":false,"summary":"…","reason":"판정 까닭 한 줄"}]}
모든 번호(0~${arts.length - 1})를 한 번씩 빠짐없이.`;
}

/**
 * 답 모양을 검사한다 — 번호가 빠짐없이 한 번씩, 점수·분류가 정한 값 안. bulletin_ai.call 의 accept 로 넘긴다(틀리면 다음 순위 AI 로).
 * 예: shapeOk({ items:[{i:0,score:4,cat:'duty'}] }, 1) → true · 번호 빠짐 → false
 * @param {any} p 꺼낸 JSON @param {number} n 기사 수 @returns {boolean}
 * [연계] ← judge
 */
function shapeOk(p, n) {
    if (!p || typeof p !== 'object' || !Array.isArray(p.items) || p.items.length !== n) return false;
    const seen = new Set();
    for (const it of p.items) {
        if (!it || typeof it !== 'object' || !Number.isInteger(it.i) || it.i < 0 || it.i >= n || seen.has(it.i)) return false;
        seen.add(it.i);
        if (!Number.isInteger(it.score) || it.score < 1 || it.score > 5) return false;
        if (it.score >= 3 && !Object.prototype.hasOwnProperty.call(CATS, it.cat)) return false;   // 실을 기사는 분류가 있어야
    }
    return true;
}

const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
/** 글 속 숫자 덩이. 예: '12월 1일부터 9cm 이하' → ['12','1','9'] */
const numbersOf = (s) => String(s || '').match(/\d+(?:[.,]\d+)?/g) || [];
/**
 * 요약을 검사해 쓸 글을 돌려준다 — 원문(그 기사·같은 묶음 기사)에 없는 숫자가 있거나 너무 길거나 비면 원문 요약(앞 2문장)으로 바꾼다.
 * 예: fixSummary('12월 1일부터 단속', '…12월 1일부터…') → { text:'12월 1일부터 단속', fixed:false } · 원문에 없는 '30%' → { text:원문 요약, fixed:true } · 원문 요약이 주소뿐 → 제목
 * @param {string} s AI 요약 @param {string} source 원문 글(제목+요약 이어 붙임) @param {string} fallback 원문 요약 @param {string} [title] 원문 요약도 못 쓰면 쓸 제목
 * @returns {{text:string, fixed:boolean}}
 * [연계] ← judge — 없으면: AI 가 지어낸 숫자(기간·금액·인원)가 그대로 카드에 나간다
 */
function fixSummary(s, source, fallback, title) {
    const text = String(s || '').replace(/\s+/g, ' ').trim();
    // 숫자는 덩이째 견준다 — 글자 포함으로 보면 '3명'이 '2023년' 안의 3 으로, '10억'이 '100억' 안의 10 으로 통과했다(별도 에이전트 검토 2026-11-21, 실행으로 재현)
    const srcNums = new Set(numbersOf(String(source || '').replace(/(\d),(?=\d{3})/g, '$1')));
    // 주소가 든 요약도 버린다 — 실제 시험(2026-11-21)에서 기사 요약이 유튜브 주소뿐이라 카드 요약 칸에 주소가 나갔다
    const bad = !text || text.length > SUMMARY_MAX || /https?:\/\/|www\./i.test(text) || numbersOf(text.replace(/(\d),(?=\d{3})/g, '$1')).some((n) => !srcNums.has(n));
    if (!bad) return { text, fixed: false };
    let fb = String(fallback || '').replace(URL_RE, ' ').replace(/\s+/g, ' ').trim().split(/(?<=[.다])\s+/).slice(0, 2).join(' ');
    if (fb.length < 15) fb = String(title || '').trim();   // 원문 요약이 비었거나 주소뿐이면 제목
    return { text: fb.slice(0, SUMMARY_MAX), fixed: true };
}

/**
 * 기사 묶음을 판정한다. BATCH 개씩 나눠 묻는다. 한 묶음이 끝까지 실패하면 그 묶음 기사는 failed 로 돌려준다(다음 시간에 다시).
 * 예: await judge(arts, cards) → { results:[{ i, score, cat, region, group, same, newInfo, summary, summaryFixed, reason, provider }], failed:[i…], providers:{gemma:2} }
 * @param {Array<{title:string, desc:string, source:string, time:string}>} arts
 * @param {Array<{id:string, title:string, date:string}>} cards
 * @param {{call?:function}} [o] call = 검사에서 바꿔 끼우는 bulletin_ai.call
 * @returns {Promise<{results:Array, failed:number[], providers:object, errors:string[]}>}
 * [연계] ← news_collector.run / → bulletin_ai.call('news')
 */
async function judge(arts, cards, o) {
    const call = (o && o.call) || require('./bulletin_ai').call;
    const looseJson = require('./bulletin_ai').looseJson;
    const results = [], failed = [], providers = {}, errors = [];
    for (let b = 0; b < arts.length; b += BATCH) {
        const part = arts.slice(b, b + BATCH);
        let r;
        try { r = await call('news', prompt(part, cards || []), { caller: 'NewsJudge', accept: (p) => shapeOk(p, part.length) }); }
        catch (e) { console.warn('[오늘의 뉴스] 판정 호출 중 예외:', e && e.message); r = { success: false, error: String((e && e.message) || e) }; }
        const p = r && r.success ? looseJson(r.text) : undefined;
        if (!r || !r.success || !shapeOk(p, part.length)) {
            for (let k = 0; k < part.length; k++) failed.push(b + k);
            errors.push(String((r && r.error) || '답 모양이 맞지 않음').slice(0, 200));
            console.warn('[오늘의 뉴스] 판정 실패(다음 시간에 다시) — 기사 ' + part.length + '건:', errors[errors.length - 1]);
            continue;
        }
        providers[r.provider] = (providers[r.provider] || 0) + 1;
        for (const it of p.items) {
            const a = part[it.i], idx = b + it.i;
            // 같은 묶음 기사들의 글도 원문으로 친다 — 묶음 요약은 여러 기사의 사실을 합칠 수 있다
            const grp = it.group ? p.items.filter((x) => x.group === it.group).map((x) => part[x.i]) : [a];
            const source = grp.map((x) => x.title + ' ' + x.desc).join(' ');
            const sum = it.score >= 3 ? fixSummary(it.summary, source, a.desc, a.title) : { text: '', fixed: false };
            results.push({
                i: idx, score: it.score, cat: Object.prototype.hasOwnProperty.call(CATS, it.cat) ? it.cat : 'none',
                region: REGIONS.includes(it.region) ? it.region : '', group: it.group ? 'b' + b + ':' + String(it.group).slice(0, 20) : '',
                same: typeof it.same === 'string' ? it.same.slice(0, 40) : '', newInfo: it.new_info === true,
                summary: sum.text, summaryFixed: sum.fixed, reason: String(it.reason || '').slice(0, 120), provider: r.provider,
            });
        }
    }
    return { results, failed, providers, errors };
}

/**
 * 그날 실린 카드 가운데 같은 사건을 묶는다 — 판정(20건씩)에서 AI 가 묶음 표시를 빠뜨려 같은 발표가 여러 장으로 실린 것을 한 번 더 걸러 낸다.
 *   사용자 2026-11-22 「중복내용 제외」 — 해수부 「김장철 수산물 원산지 특별점검」 한 발표가 카드 4장으로 실렸다(운영 화면).
 *   AI(⑦ 순서)에 제목·요약 앞부분 목록을 주고 묶음을 받는다. AI 가 실패하거나 답이 틀리면 묶지 않는다(groups:[] · by:'failed').
 *   기계로 제목을 비교하지 않는다 — 「통영/여수 해상서 어선 전복」(0.75)·「해수부/경남도 원산지 점검」(0.70)처럼 틀이 같은 다른 사건이 붙는다(검토 실측 2026-11-22).
 * 예: await groupDuplicates([{title:'해수부, 김장철 원산지 특별점검'}, {title:'김장철 수산물 원산지 특별점검…해수부'}, {title:'해광호 수색'}]) → { groups:[[0,1]], by:'gemma' }
 * @param {Array<{title:string, summary?:string}>} cards @param {{call?:function}} [o]
 * @returns {Promise<{groups:number[][], by:string, error?:string}>} 두 장 이상인 묶음만, 카드 하나는 한 묶음에만
 * [연계] ← news_collector.run(매 수집 끝) / → bulletin_ai.call('news')
 */
async function groupDuplicates(cards, o) {
    const n = cards.length;
    if (n < 2) return { groups: [], by: 'none' };
    const valid = (p) => {
        if (!p || typeof p !== 'object' || !Array.isArray(p.groups)) return false;
        const seen = new Set();
        for (const g of p.groups) {
            if (!Array.isArray(g) || g.length < 2) return false;
            for (const i of g) { if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return false; seen.add(i); }
        }
        return true;
    };
    const list = cards.map((c, i) => `[${i}] ${c.title} — ${String(c.summary || '').replace(/\s+/g, ' ').slice(0, 70)}`).join('\n');
    const text = `아래는 같은 날 실린 해양 뉴스 카드 목록이다. 같은 사건·같은 발표·같은 사고를 다룬 카드끼리 묶어라.
- 같은 기관의 같은 발표를 여러 언론이 쓴 것(예: 해수부 김장철 수산물 원산지 특별점검)은 한 묶음
- 같은 사고의 같은 날 보도(수색·발견·원인 등 후속 포함)는 한 묶음
- 주제가 비슷해도 기관·지역·사건이 다르면 따로(예: 부산해경 김장철 단속과 해수부 원산지 점검은 따로)
답은 JSON 하나만: {"groups":[[번호,번호,...],...]} — 두 장 이상인 묶음만, 한 카드는 한 묶음에만. 묶을 것이 없으면 {"groups":[]}

${list}`;
    try {
        const call = (o && o.call) || require('./bulletin_ai').call;
        const r = await call('news', text, { caller: 'NewsDedupe', accept: valid });
        const p = r && r.success ? require('./bulletin_ai').looseJson(r.text) : undefined;
        if (valid(p)) return { groups: p.groups, by: r.provider || 'ai' };
        const error = String((r && r.error) || '답 모양이 틀림').slice(0, 120);
        console.warn('[오늘의 뉴스] 같은 사건 묶기 AI 실패 — 이번엔 합치지 않는다:', error);
        return { groups: [], by: 'failed', error };
    } catch (e) {
        console.warn('[오늘의 뉴스] 같은 사건 묶기 중 예외 — 이번엔 합치지 않는다:', e && e.message);
        return { groups: [], by: 'failed', error: String((e && e.message) || e).slice(0, 120) };
    }
}

module.exports = { judge, prompt, shapeOk, fixSummary, groupDuplicates, CATS, REGIONS, BATCH };
