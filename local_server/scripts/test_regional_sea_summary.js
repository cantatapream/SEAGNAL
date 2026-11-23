'use strict';
/**
 * ============================================================================
 * 파일명: local_server/scripts/test_regional_sea_summary.js
 * 역할  : 지방청 단기 전망 「해상 기상 요약」 검사 — 바다 항목 뽑기(규칙) · AI 답의 원문 대조(check) · 요약 흐름(없음/요약됨/원문 그대로) ·
 *         「분포도」 줄 빼기 · 날씨해설 원문(PDF) 열쇠와 보관(통보문 원문과 서로 지우지 않는지).
 *         AI·바깥 서버·pdftoppm 없이 돈다(가짜로 끼운다). 글은 실제 발표분(제주 2026-11-19 제11-37호 · 2026-08-28 제08-56호)에서 옮겼다.
 * ⚠AI 답은 사람이 쓴 것이다 — 작업 환경에 AI 키가 없어 실제 AI 답으로는 시험하지 못했다(운영에서는 관리자 ⑥ 칸 「시험 요약」으로 본다).
 * 사용자 2026-11-19: 「기온 박스 아래에 해상 기상 요약 … 해상과 관련된 내용만 요약」 「강수지역분포도 그 부분이 표출되지 않도록 텍스트도 삭제」 「4.원문보기 반영」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/regional_sea_summary.js · regional_bulletin_collector.js(dropFigureCaption·docKeyOf) · services/bulletin_docs.js(syncExtra) ·
 *                   routes/weather.js · routes/bulletin_watch.js · scheduler.js(글자 확인)
 *  - 나를 쓰는 곳  : scripts/refactor/verify_all.sh 의 SUITES
 * [로드 순서] 해당 없음(단독 실행: node local_server/scripts/test_regional_sea_summary.js)
 * ============================================================================
 */
const fs = require('fs'), os = require('os'), path = require('path');
// 수집기가 쓰는 저장 파일·캐시 폴더를 임시 자리로 돌린다(운영 자료를 건드리지 않게) — 수집기를 부르기 전에 정해야 한다
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'seasum-'));
process.env.REGIONAL_FORECAST_FILE = path.join(TMP, 'regional_forecast.json');
process.env.REGIONAL_BULLETIN_CACHE_DIR = path.join(TMP, 'cache');
const S = require('../services/regional_sea_summary');
const R = require('../regional_bulletin_collector');
const D = require('../services/bulletin_docs');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (x !== undefined ? ' — ' + JSON.stringify(x).slice(0, 400) : '')); } };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// 제주지방기상청 2026-11-19 04:50 발표(제11-37호) — 바다 항목은 (해상) 하나, 딸린 줄 셋
const JEJU = `< 오늘~모레 예상 강수지역 분포도 >
<특보 현황>
○ 대설주의보: 제주도산지
○ 풍랑주의보: 남해서부서쪽먼바다, 제주도앞바다(제주도남부앞바다 제외)(해제 예고: 21일 오전(09~12시))
○ 풍랑주의보: 제주도남쪽안쪽먼바다(해제 예고: 21일 밤(21~24시))
○ 풍랑주의보: 제주도남쪽바깥먼바다(해제 예고: 22일 새벽(03~06시))
<예비특보 현황>
○ 풍랑 예비특보(20일 새벽(00~06시)): 제주도남부앞바다
<중점 사항>
○ 내일까지 제주도에는 바람이 매우 강하게 부는 곳이 있겠고, 당분간 해상에는 물결이 매우 높게 이는 곳이 있겠습니다.
<강풍 및 해상>
○ (강풍) 강풍특보가 발효 중인 제주도(서귀포시남부 제외)에는 내일(20일) 오전까지 바람이 순간풍속 70km/h(20m/s)(산지 90km/h(25m/s)) 이상으로 매우 강하게 불겠습니다.
o 간판, 비닐하우스 등 실외 설치 시설물 점검 및 농작물 관리 철저
○ (해상) 풍랑특보가 발효 중인 남해서부서쪽먼바다와 제주도앞바다(남부앞바다 제외)는 모레(21일) 오전까지, 남쪽안쪽먼바다는 모레 밤까지, 남쪽바깥먼바다는 글피(22일) 새벽까지 바람이 30~65km/h(9~18m/s)로 매우 강하게 불고, 물결이 1.5~4.0m로 매우 높게 일겠으니, 항해나 조업하는 선박은 각별히 유의하기 바라며, 해상교통 이용객들은 사전에 운항정보를 확인하기 바랍니다.
- 특히, 내일(20일) 새벽부터 제주도남서쪽안쪽먼바다와 제주도남쪽바깥먼바다에는 물결이 최대 5.0m 이상으로 더욱 높게 일면서 풍랑경보로 변경 발표될 가능성이 있겠고, 풍랑경보 발효 기간과 풍랑경보 변경 가능성 정보는 현시점의 예측을 기반으로 제공되며, 기상상황에 따라 풍랑경보의 발표여부와 시점, 발표지역이 조정될 수 있으므로 최신 기상정보를 참고하기 바랍니다.
- 한편, 제주도남부앞바다에는 오늘(19일) 바람이 30~50km/h(9~14m/s)로 강하게 불고, 물결이 1.5~3.0m로 높게 일겠고, 내일(20일) 새벽부터 차차 바람이 30~55km/h(9~15m/s)로 매우 강하게 불고, 물결이 1.5~3.5m로 매우 높게 일면서 풍랑특보가 발표될 가능성이 있겠으니, 앞으로 발표하는 기상정보를 참고하기 바랍니다.
- 또한, 내일(20일)과 모레(21일) 제주도해상에는 천둥.번개가 치는 곳이 있겠으니, 해상 안전사고에 유의하기 바랍니다.
<글피 전망>
○ (하늘상태) 글피(22일)는 가끔 구름많겠습니다.
<기압계 현황 및 전망>
○ 오늘(19일)과 내일(20일)은 중국 북부지방에서 확장하는 찬 대륙고기압의 영향을 받겠습니다.`;
// 그 글에 사람이 쓴 요약(고친 안 그림과 같은 내용)
const GOOD = () => ({
    zones: [
        { zone: '남해서부서쪽먼바다 · 제주도앞바다(남부앞바다 제외)', period: '~모레(21일) 오전', wind: '9~18', wave: '1.5~4.0' },
        { zone: '제주도남쪽안쪽먼바다', period: '~모레(21일) 밤', wind: '9~18', wave: '1.5~4.0' },
        { zone: '제주도남쪽바깥먼바다', period: '~글피(22일) 새벽', wind: '9~18', wave: '1.5~4.0' },
        { zone: '제주도남부앞바다', period: '오늘(19일)', wind: '9~14', wave: '1.5~3.0' },
        { zone: '제주도남부앞바다', period: '내일(20일) 새벽~', wind: '9~15', wave: '1.5~3.5' },
    ],
    notes: [
        { kind: '특보 가능성', text: '내일(20일) 새벽부터 {{loc:제주도남서쪽안쪽먼바다·제주도남쪽바깥먼바다}} {{warn:풍랑경보 변경 가능성}}(물결 {{num:최대 5.0m 이상}}) · {{loc:제주도남부앞바다}} {{warn:풍랑특보 발표 가능성}}' },
        { kind: '천둥·번개', text: '내일(20일)~모레(21일) {{loc:제주도해상}}' },
    ],
});
// 제주지방기상청 2026-08-28 16:40 발표(제08-56호) — 해상·너울·조고·이안류가 한꺼번에(바다 부분만)
const SUMMER = `<해상>
○ (해상) 풍랑특보가 발효 중인 제주도남부앞바다와 제주도서부앞바다(북서연안바다 제외)는 오늘(28일) 늦은 오후까지, 제주도남쪽안쪽먼바다에는 내일(29일) 새벽까지, 제주도남쪽바깥먼바다에는 내일 오전까지 바람이 30~55km/h(9~15m/s)로 매우 강하게 불고, 물결이 1.5~3.5m로 매우 높게 일겠으니, 항해나 조업하는 선박은 안전사고에 유의하기 바랍니다.
- 한편, 오늘(28일)은 제주도해상과 남해서부서쪽먼바다, 내일(29일)과 모레(30일)는 남해서부서쪽먼바다를 중심으로 돌풍이 불고, 천둥.번개가 치는 곳이 있겠으니, 해상 안전사고에 각별히 유의하기 바랍니다.
<유의 사항>
○ (너울) 내일(29일)까지 제주도해안에는 강한 너울에 의한 높은 물결이 백사장으로 강하게 밀려오거나 갯바위나 방파제를 넘는 곳이 있겠으니, 해안가 접근을 자제하여 안전사고에 각별히 유의하기 바랍니다.
○ (조고) 당분간 달의 인력이 강해 바닷물의 높이가 높은 기간으로, 만조 시 해안가 저지대 침수, 하수 역류 등 피해가 발생하지 않도록 유의하기 바라며, 해안가 안전사고에도 각별히 유의하기 바랍니다.
○ (이안류) 오늘(28일) 중문 해수욕장 등에서는 이안류 발생 가능성에 대한 주의와 경계가 필요하니, 해수욕장 피서객 안전사고에 각별히 유의하기 바랍니다.
※ 이안류: 해안 가까이에서 파도가 부서지면서 한 곳으로 밀려든 해수가 좁은 폭을 통하여 다시 바다로 빠르게 빠져나가는 흐름
○ (안개) 내일(29일) 새벽 중산간 이상 지역에 가시거리 200m 미만의 짙은 안개가 끼는 곳이 있겠습니다.`;
const GOOD_SUMMER = () => ({
    zones: [
        { zone: '제주도남부앞바다 · 제주도서부앞바다(북서연안바다 제외)', period: '~오늘(28일) 늦은 오후', wind: '9~15', wave: '1.5~3.5' },
        { zone: '제주도남쪽안쪽먼바다', period: '~내일(29일) 새벽', wind: '9~15', wave: '1.5~3.5' },
        { zone: '제주도남쪽바깥먼바다', period: '~내일(29일) 오전', wind: '9~15', wave: '1.5~3.5' },
    ],
    notes: [
        { kind: '천둥·번개', text: '오늘 {{loc:제주도해상·남해서부서쪽먼바다}}, 내일~모레(30일) {{loc:남해서부서쪽먼바다}} — 돌풍 동반' },
        { kind: '너울', text: '내일(29일)까지 {{loc:제주도해안}} — 백사장으로 밀려오거나 갯바위·방파제를 넘는 곳' },
        { kind: '조고', text: '당분간 바닷물 높이가 높은 기간 — 만조 때 해안 저지대 침수' },
        { kind: '이안류', text: '오늘(28일) {{loc:중문 해수욕장}} 등 발생 가능성' },
    ],
});

(async () => {
    console.log('── 바다 항목 뽑기(규칙) ──');
    {
        const it = S.extractSeaItems(JEJU);
        ok('제주 11-37호: (해상) 항목 하나와 딸린 줄 셋 — (강풍)·(하늘상태)·특보 현황·중점 사항·기압계는 안 뽑는다', it.length === 1 && it[0].label === '해상' && it[0].lines.length === 4 && /^○ \(해상\)/.test(it[0].lines[0]) && /^- 또한/.test(it[0].lines[3]), it.map((i) => [i.label, i.lines.length]));
        const su = S.extractSeaItems(SUMMER);
        ok('여름 글: 해상·너울·조고·이안류 네 항목 — 뭍 안개(「안개」)는 안 뽑는다 · 이안류의 ※ 풀이 줄은 그 항목에 딸린다', su.map((i) => i.label).join() === '해상,너울,조고,이안류' && su[3].lines.length === 2, su.map((i) => [i.label, i.lines.length]));
        ok('이름이 조금 달라도 뽑는다(조사에서 나온 이름들): 바다 안개·바다안개·풍랑·기상해일·서해5도 어장 안개·갯벌 안개정보·6~9일 해상 날씨·강한 바람과 높은 물결 유의',
            ['바다 안개', '바다안개', '풍랑', '기상해일', '서해5도 어장 안개', '갯벌 안개정보', '6~9일 해상 날씨', '강한 바람과 높은 물결 유의'].every((l) => S.extractSeaItems('<유의 사항>\n○ (' + l + ') 글').length === 1));
        ok('뭍 항목은 안 뽑는다: 강풍·안개·건조·기온·하늘상태·동해안 해돋이 전망', ['강풍', '안개', '건조', '기온', '하늘상태', '동해안 해돋이 전망'].every((l) => S.extractSeaItems('<유의 사항>\n○ (' + l + ') 글').length === 0));
        ok('이름 없는 항목은 머리가 바다 이름일 때만(<해상>) — <특보 현황>·<중점 사항>의 줄은 아니다', S.extractSeaItems('<해상>\n○ 동해중부해상은 물결이 1.0~2.5m로 일겠습니다.').length === 1
            && S.extractSeaItems('<특보 현황>\n○ 풍랑주의보: 동해중부먼바다').length === 0 && S.extractSeaItems('<중점 사항>\n○ 해상에는 물결이 매우 높게 일겠습니다.').length === 0 && S.extractSeaItems('<풍랑특보 현황>\n○ 풍랑주의보: 동해중부먼바다').length === 0);
        ok('바다 얘기가 없는 글·빈 글은 빈 목록', S.extractSeaItems('<중점 사항>\n○ 맑겠습니다.\n<기온>\n○ (기온) 평년과 비슷').length === 0 && S.extractSeaItems('').length === 0 && S.extractSeaItems(null).length === 0);
    }

    console.log('── AI 답의 원문 대조(check) ──');
    {
        const items = S.extractSeaItems(JEJU), bad = (f) => { const c = GOOD(); f(c); return S.check(c, items, JEJU); };
        ok('사람이 쓴 요약은 통과 — 글에 「남쪽안쪽먼바다」로만 적힌 곳을 「제주도남쪽안쪽먼바다」로 풀어 써도(특보 현황에 온전한 이름이 있다) 받는다', S.check(GOOD(), items, JEJU) === '', S.check(GOOD(), items, JEJU));
        ok('겉꼴만 다른 답도 통과: 숫자에 단위(「9~18m/s」「1.5∼4.0m」)·종류 이름의 점(「천둥.번개」)·같은 종류 두 줄', bad((c) => { c.zones[0].wind = '9~18m/s'; c.zones[0].wave = '1.5∼4.0m'; c.notes[1].kind = '천둥.번개'; c.notes.push({ kind: '특보가능성', text: '{{loc:제주도남부앞바다}} 가능성' }); }) === '');
        ok('normalize: 뜻은 그대로 겉꼴만 — 단위·물결표·종류 이름·같은 종류는 한 줄로', JSON.stringify(S.normalize({ zones: [{ zone: ' A ', period: '오늘', wind: '9~18m/s', wave: 2.5 }], notes: [{ kind: '천둥.번개', text: 'a' }, { kind: '천둥번개', text: 'b' }] }))
            === JSON.stringify({ zones: [{ zone: 'A', period: '오늘', wind: '9~18', wave: '2.5' }], notes: [{ kind: '천둥·번개', text: 'a · b' }] }));
        const cases = [
            ['물결 숫자를 바꿈', (c) => { c.zones[0].wave = '1.5~9.0'; }, /물결 숫자가 글에 없다/],
            ['바람 숫자를 바꿈', (c) => { c.zones[0].wind = '19~28'; }, /바람 숫자가 글에 없다/],
            ['글에 있는 숫자의 일부만(「5~4.0」)', (c) => { c.zones[0].wave = '5~4.0'; }, /물결 숫자가 글에 없다/],
            ['글에 없는 해역', (c) => { c.zones[1].zone = '동해중부먼바다'; }, /해역 이름이 글에 없다/],
            ['다른 줄의 숫자와 짝지음(남부앞바다 + 9~18)', (c) => { c.zones[3].wind = '9~18'; }, /같은 줄에 함께 있지 않다/],
            ['글에 없는 날짜', (c) => { c.zones[0].period = '~모레(25일) 오전'; }, /기간의 숫자가 글에 없다/],
            ['글에 없는 기간 낱말', (c) => { c.zones[0].period = '주말 내내'; }, /기간의 낱말이 글에 없다/],
            ['숫자가 적힌 해역을 숫자 없이 적음(그 줄은 버려지고, 빠뜨림으로 잡힌다)', (c) => { c.zones[0].wind = null; c.zones[0].wave = null; }, /숫자가 적힌 줄의 해역이 해역 줄에 없다: 남해서부서쪽먼바다/],
            ['숫자가 적힌 해역 한 곳을 통째로 뺌', (c) => { c.zones.splice(2, 1); }, /숫자가 적힌 줄의 해역이 해역 줄에 없다: 남쪽바깥먼바다/],
            ['「한편」 줄의 해역(남부앞바다)을 뺌', (c) => { c.zones.splice(3, 2); }, /숫자가 적힌 줄의 해역이 해역 줄에 없다: 제주도남부앞바다/],
            ['해역 칸에 색 표시', (c) => { c.zones[0].zone = '{{loc:제주도앞바다}}'; }, /색 표시가 들어 있다/],
            ['특보 가능성 줄을 뺌', (c) => { c.notes.shift(); }, /빠졌다: 특보 가능성/],
            ['천둥·번개 줄을 뺌', (c) => { c.notes.pop(); }, /빠졌다: 천둥·번개/],
            ['모르는 종류', (c) => { c.notes.push({ kind: '태풍 전망', text: '글' }); }, /모르는 종류/],
            ['색 표시 꼴이 깨짐', (c) => { c.notes[1].text = '{{loc:제주도해상} } 천둥'; }, /색 표시 꼴이 깨졌다/],
            ['한 줄에 글에 없는 숫자', (c) => { c.notes[0].text += ' 7.0m'; }, /한 줄의 숫자가 글에 없다/],
            ['한 줄에 글에 없는 지역', (c) => { c.notes[1].text = '{{loc:울릉도}} 천둥.번개'; }, /지역 이름이 글에 없다/],
            ['해역 줄을 전부 뺌', (c) => { c.zones = []; }, /해역 줄이 없다/],
            ['빈 답', (c) => { c.zones = []; c.notes = []; }, /답이 비었다/],
            ['zones 가 배열이 아님', (c) => { c.zones = '없음'; }, /배열이 아니다/],
        ];
        const miss = cases.filter(([, f, re]) => !re.test(bad(f))).map(([n, f]) => n + ' → ' + JSON.stringify(bad(f)));
        ok('틀리게 고친 답 ' + cases.length + '가지를 모두 걸러 낸다(숫자·해역·날짜·짝·빠뜨림·없는 종류·깨진 표시)', miss.length === 0, miss);
        ok('객체가 아닌 답(null·배열·글)은 걸린다', [null, [], '글', 3].every((p) => S.check(p, items, JEJU) !== ''));
        const su = S.extractSeaItems(SUMMER);
        ok('여름 글(해상·너울·조고·이안류)에 사람이 쓴 요약도 통과', S.check(GOOD_SUMMER(), su, SUMMER) === '', S.check(GOOD_SUMMER(), su, SUMMER));
        const dropped = ['너울', '조고', '이안류'].map((k) => { const c = GOOD_SUMMER(); c.notes = c.notes.filter((n) => n.kind !== k); return S.check(c, su, SUMMER); });
        ok('글에 항목이 있는 종류(너울·조고·이안류)를 빼면 걸린다 — 뭍 안개 항목은 「바다 안개」를 요구하지 않는다', dropped.every((w, i) => new RegExp('빠졌다: ' + ['너울', '조고', '이안류'][i]).test(w)), dropped);
    }

    console.log('── 실제 Gemma 답(2026-11-19, gemma-4-26b-a4b-it — 지방청 그날 새벽 발표분) ──');
    {
        // 수도권: 숫자가 없는 해역 두 곳을 null 줄로 적고, 시점을 num 으로 감쌌다 — 군더더기만 버리면 맞는 답
        const SUDO = '<강풍 및 풍랑>\n○ (풍랑) 풍랑특보가 발효 중인 서해중부해상은 당분간(인천.경기앞바다(해제예고: 19일 밤(21~24시))) 바람이 25~60km/h(7~16m/s)로 매우 강하게 불고 물결이 1.0~3.5m로 매우 높게 일겠습니다.\n- 한편, 서해중부먼바다는 모레(21일)까지 매우 강한 바람과 매우 높은 물결이 일며 풍랑특보가 길게 이어질 가능성이 있고, 인천.경기앞바다는 내일(20일) 오전 다시 바람이 강해지며, 물결이 매우 높게 일며 풍랑특보가 발표될 가능성이 있으니, 앞으로 발표되는 기상정보를 참고하기 바랍니다.';
        const aSudo = { zones: [{ zone: '서해중부해상', period: '당분간', wind: '7~16', wave: '1.0~3.5' }, { zone: '서해중부먼바다', period: '모레(21일)까지', wind: null, wave: null }, { zone: '인천.경기앞바다', period: '내일(20일) 오전', wind: null, wave: null }],
            notes: [{ kind: '특보 가능성', text: '{{loc:서해중부먼바다}} {{num:모레(21일)까지}} {{warn:풍랑특보가 길게 이어질 가능성}} · {{loc:인천.경기앞바다}} {{num:내일(20일) 오전}} {{warn:풍랑특보가 발표될 가능성}}' }] };
        const iS = S.extractSeaItems(SUDO), tS = S.trim(S.normalize(aSudo), iS);
        // (2026-11-19 오후) 이 답은 「해제예고」를 뺐다 — 종전에는 받았으나 이제 「해제 예고」 한 줄이 없으면 걸린다. 그 한 줄을 더한 답은 종전대로 받는다.
        const aSudoLift = Object.assign({}, aSudo, { notes: aSudo.notes.concat([{ kind: '해제 예고', text: '{{loc:인천.경기앞바다}} 19일 밤(21~24시)' }]) });
        ok('수도권 답(해제 예고 없음)은 이제 걸린다 — 「글에 있는 종류가 빠졌다: 해제 예고」', S.check(aSudo, iS, SUDO) === '글에 있는 종류가 빠졌다: 해제 예고', S.check(aSudo, iS, SUDO));
        ok('수도권 답 + 해제 예고 한 줄: 숫자 없는 해역 줄 둘을 버리고 받는다 — 괄호 안 해역(인천.경기앞바다)은 해역 줄 「빠뜨림」으로 치지 않는다 · 시점을 감싼 num 표시는 벗긴다', S.check(aSudoLift, iS, SUDO) === '' && tS.p.zones.length === 1 && tS.dropped.length === 2
            && tS.p.notes[0].text === '{{loc:서해중부먼바다}} 모레(21일)까지 {{warn:풍랑특보가 길게 이어질 가능성}} · {{loc:인천.경기앞바다}} 내일(20일) 오전 {{warn:풍랑특보가 발표될 가능성}}', { why: S.check(aSudoLift, iS, SUDO), t: tS });
        // 대구: 숫자가 적힌 해역(동해남부앞바다)을 숫자 없이 적었고(틀린 답), 없는 색 표시를 지어냈다 — 걸러야 한다
        const DAEGU = '<해상 및 강풍>\n○ (해상) 풍랑특보가 발표된 동해남부앞바다(경북북부앞바다)(06시 발효)는 내일(20일) 까지, 동해남부북쪽먼바다는 당분간 바람이 30~70km/h(8~20m/s)로 매우 강하게 불고, 물결이 1.5~4.5m(동해남부북쪽먼바다 최대 5.0m이상)로 매우 높게 일겠으니, 항해나 조업하는 선박은 각별히 유의하기 바랍니다.\n- 한편, 모레(21일)까지 동해상에는 천둥.번개가 치는 곳이 있겠으니, 해상 안전사고에 유의하기 바랍니다.';
        const aDaegu = { zones: [{ zone: '동해남부앞바다(경북북부앞바다)', period: '내일(20일)까지', wind: null, wave: null }, { zone: '동해남부북쪽먼바다', period: '당분간', wind: '8~20', wave: '1.5~4.5' }],
            notes: [{ kind: '특보 가능성', text: '{{loc:동해남부앞바다(경북북부앞바다)}} {{warn:풍랑특보}} 발효 중' }, { kind: '천둥·번개', text: '{{period:모레(21일)까지}} {{loc:동해상}}에는 {{kind:천둥·번개}} 치는 곳이 있겠음' }] };
        const iD = S.extractSeaItems(DAEGU);
        ok('대구 답: 「A는 내일까지, B는 당분간 바람이 …」에서 A 를 숫자 없이 적은 답은 걸린다(해역 빠뜨림) — 지어낸 표시(`{{period:…}}` `{{kind:…}}`)는 벗겨질 뿐 통과의 까닭이 되지 않는다', /숫자가 적힌 줄의 해역이 해역 줄에 없다: 동해남부앞바다/.test(S.check(aDaegu, iD, DAEGU))
            && S.normalize(aDaegu).notes[1].text === '모레(21일)까지 {{loc:동해상}}에는 천둥·번개 치는 곳이 있겠음', S.check(aDaegu, iD, DAEGU));
        const fixedDaegu = { zones: [{ zone: '동해남부앞바다(경북북부앞바다)', period: '내일(20일)까지', wind: '8~20', wave: '1.5~4.5' }, aDaegu.zones[1]], notes: [aDaegu.notes[1]] };
        ok('대구: 두 해역에 숫자를 다 적은 답은 받는다(「최대 5.0m이상」 괄호는 안 따진다)', S.check(fixedDaegu, iD, DAEGU) === '', S.check(fixedDaegu, iD, DAEGU));
        // 광주: 해역 줄 다섯은 맞는데 「풍랑특보가 발효 중」을 「특보 가능성」으로 적었다 — 그 한 줄만 버리면 맞는 답
        const GWANGJU = '<해상 및 강풍>\n○ (해상) 풍랑특보가 발효 중인 서해남부앞바다는 내일(20일)까지, 남해서부먼바다는 모레(21일) 오전까지, 서해남부먼바다는 모레(21일)까지 바람이 32~54km/h(9~15m/s)로 매우 강하게 불고, 물결이 1.5~3.5m로 매우 높게 일겠으니, 항해나 조업하는 선박은 각별히 유의하기 바랍니다.\n- 한편, 모레(21일) 오전 서해남부앞바다, 모레(21일) 오후 남해서부먼바다는 바람이 29~47km/h(8~13m/s)로 강하게 불고, 물결이 1.0~2.5m로 높게 일겠습니다.\n- 한편, 모레(21일)까지 서해남부해상에는 천둥.번개가 치는 곳이 있겠으니, 해상 안전사고에 유의하기 바랍니다.';
        const aGwangju = { zones: [{ zone: '서해남부앞바다', period: '내일(20일)까지', wind: '9~15', wave: '1.5~3.5' }, { zone: '남해서부먼바다', period: '모레(21일) 오전까지', wind: '9~15', wave: '1.5~3.5' }, { zone: '서해남부먼바다', period: '모레(21일)까지', wind: '9~15', wave: '1.5~3.5' },
            { zone: '서해남부앞바다', period: '모레(21일) 오전', wind: '8~13', wave: '1.0~2.5' }, { zone: '남해서부먼바다', period: '모레(21일) 오후', wind: '8~13', wave: '1.0~2.5' }],
            notes: [{ kind: '특보 가능성', text: '{{loc:서해남부앞바다}}에 {{warn:풍랑특보}}가 발효 중' }, { kind: '천둥·번개', text: '모레(21일)까지 {{loc:서해남부해상}}에 {{warn:천둥·번개}} 치는 곳이 있음' }] };
        const iG = S.extractSeaItems(GWANGJU), tG = S.trim(S.normalize(aGwangju), iG);
        ok('광주 답: 「가능성」이 글에 없는데 적은 「특보 가능성」 줄만 버리고 받는다 — 해역 줄 다섯·천둥·번개는 그대로', S.check(aGwangju, iG, GWANGJU) === '' && tG.p.zones.length === 5 && tG.p.notes.map((n) => n.kind).join() === '천둥·번개' && tG.dropped.length === 1, { why: S.check(aGwangju, iG, GWANGJU), d: tG.dropped });
        // 강원: 그대로 통과한 답 — 숫자가 아닌 것을 num 으로 감싼 표시만 벗긴다
        const GANGWON = '<해상 및 강풍>\n○ (해상) 풍랑특보가 발효된 동해중부앞바다는 내일(20일) 밤까지, 동해중부먼바다는 글피(22일) 오전까지 바람이 30~70km/h(8~20m/s)로 매우 강하게 불고, 물결이 1.5~4.0m(동해중부먼바다 최대 5.0m 이상)로 매우 높게 일겠으니, 항해나 조업하는 선박은 각별히 유의하기 바랍니다.\n- 한편, 모레(21일)까지 동해중부해상에는 천둥.번개가 치는 곳이 있겠으니, 해상 안전사고에 유의하기 바랍니다.';
        const aGangwon = { zones: [{ zone: '동해중부앞바다', period: '내일(20일) 밤까지', wind: '8~20', wave: '1.5~4.0' }, { zone: '동해중부먼바다', period: '글피(22일) 오전까지', wind: '8~20', wave: '1.5~4.0' }], notes: [{ kind: '천둥·번개', text: '모레(21일)까지 {{loc:동해중부해상}}에는 {{num:천둥·번개}}가 치는 곳이 있겠음' }] };
        ok('강원 답: 통과 — `{{num:천둥·번개}}`(숫자가 아닌 num)는 표시만 벗긴다', S.check(aGangwon, S.extractSeaItems(GANGWON), GANGWON) === '' && S.normalize(aGangwon).notes[0].text === '모레(21일)까지 {{loc:동해중부해상}}에는 천둥·번개가 치는 곳이 있겠음');
        // 2차(지시문을 고친 뒤) — 통과한 답을 원문과 한 줄씩 견줘 찾은 두 가지
        // 부산: 「A는 …까지, B와 C는 …까지 바람이 9~16m/s, 물결이 1.5~4.0m」에서 A 의 바람만 null 로 적었다(그 줄에 바람이 적혀 있다 — 틀린 답)
        const BUSAN = '<강풍 및 해상>\n○ (해상) 풍랑주의보가 발효된 남해동부안쪽먼바다는 모레(21일) 오전까지, 남해동부바깥먼바다와 동해남부남쪽먼바다는 글피(22일) 새벽까지 바람이 30~60km/h(9~16m/s)로 매우 강하게 불고, 물결이 1.5~4.0m로 매우 높게 일겠으니, 항해나 조업하는 선박은 각별히 유의하기 바랍니다.\n- 한편, 오늘(19일)까지 동해남부남쪽해상에는 천둥.번개가 치는 곳이 있겠으니, 해상 안전사고에 유의하기 바랍니다.';
        const aBusan = (wind) => ({ zones: [{ zone: '남해동부안쪽먼바다', period: '모레(21일) 오전까지', wind, wave: '1.5~4.0' }, { zone: '남해동부바깥먼바다 · 동해남부남쪽먼바다', period: '글피(22일) 새벽까지', wind: '9~16', wave: '1.5~4.0' }], notes: [{ kind: '천둥·번개', text: '오늘(19일)까지 {{loc:동해남부남쪽해상}}에는 {{warn:천둥·번개}}가 치는 곳이 있겠습니다.' }] });
        const iB = S.extractSeaItems(BUSAN);
        ok('부산 답: 그 줄에 바람이 적혀 있는데 한 해역의 바람을 빼고(null) 적은 답은 걸린다 — 바람을 적은 답은 받는다', /같은 줄에 함께 있지 않다/.test(S.check(aBusan(null), iB, BUSAN)) && S.check(aBusan('9~16'), iB, BUSAN) === '', [S.check(aBusan(null), iB, BUSAN), S.check(aBusan('9~16'), iB, BUSAN)]);
        // 제주: 원문 「모레(21일) 오전까지」「모레 밤까지」「글피(22일) 새벽까지」를 「…오전」「…밤」「…새벽」으로 적었다 — 원문대로 「까지」를 붙인다
        const aJeju = { zones: [{ zone: '남해서부서쪽먼바다와 제주도앞바다(남부앞바다 제외)', period: '모레(21일) 오전', wind: '9~18', wave: '1.5~4.0' }, { zone: '남쪽안쪽먼바다', period: '모레 밤', wind: '9~18', wave: '1.5~4.0' }, { zone: '남쪽바깥먼바다', period: '글피(22일) 새벽', wind: '9~18', wave: '1.5~4.0' },
            { zone: '제주도남부앞바다', period: '오늘(19일)', wind: '9~14', wave: '1.5~3.0' }, { zone: '제주도남부앞바다', period: '내일(20일) 새벽~', wind: '9~15', wave: '1.5~3.5' }],
            notes: [{ kind: '특보 가능성', text: '내일(20일) 새벽부터 {{loc:제주도남서쪽안쪽먼바다}}와 {{loc:제주도남쪽바깥먼바다}}는 {{num:5.0m}} 이상 물결로 {{warn:풍랑경보 변경 가능성}} · 내일(20일) 새벽부터 {{loc:제주도남부앞바다}}는 {{warn:풍랑특보가 발표될 가능성}}' }, { kind: '천둥·번개', text: '내일(20일)과 모레(21일) {{loc:제주도해상}}에는 천둥·번개가 치는 곳이 있겠음' }] };
        const iJ = S.extractSeaItems(JEJU), tJ = S.trim(S.normalize(aJeju), iJ);
        ok('제주 답: 받는다 — 원문에서 그 시점 뒤가 「까지」인 세 줄에 「까지」를 붙인다(「그때까지」가 「그때」로 읽히지 않게) · 「오늘(19일)」「…새벽~」은 그대로', S.check(aJeju, iJ, JEJU) === '' && tJ.p.zones.map((z) => z.period).join(' | ') === '모레(21일) 오전까지 | 모레 밤까지 | 글피(22일) 새벽까지 | 오늘(19일) | 내일(20일) 새벽~', { why: S.check(aJeju, iJ, JEJU), per: tJ.p.zones.map((z) => z.period) });
        const maxWave = JSON.parse(JSON.stringify(aJeju)); maxWave.zones.push({ zone: '제주도남서쪽안쪽먼바다', period: '내일(20일) 새벽부터', wind: null, wave: '5.0' });
        ok('「최대 5.0m 이상」의 5.0 을 물결 값으로 적은 해역 줄은 걸린다(「물결 5.0m」로 읽히면 안 된다 — 그 얘기는 한 줄 쪽에 쓴다)', /물결 숫자가 글에 없다/.test(S.check(maxWave, iJ, JEJU)), S.check(maxWave, iJ, JEJU));
        // 대전: 괄호째 옮긴 긴 해역 이름 — (2026-11-19 오후) 해제 예고 곁말은 칸에서 빼고, 「해제 예고」 한 줄이 있어야 받는다
        const DAEJEON = '<풍랑 및 강풍>\n○ (풍랑) 풍랑특보가 발효된 서해중부해상은 당분간(충남앞바다(해제예고: 19일 밤(21~24시))) 바람이 25~60km/h(7~16m/s)로 매우 강하게 불고 물결이 1.0~4.0m로 매우 높게 일겠습니다.\n- 한편, 서해중부먼바다는 모레(21일)까지 매우 강한 바람과 매우 높은 물결이 일며 풍랑특보가 길게 이어질 가능성이 있고, 충남앞바다는 내일(20일) 오전 다시 바람이 강해지며, 물결이 매우 높게 일며 풍랑특보가 발표될 가능성이 있으니, 앞으로 발표되는 기상정보를 참고하기 바랍니다.';
        const aDaejeon = { zones: [{ zone: '서해중부해상(충남앞바다(해제예고: 19일 밤(21~24시)))', period: '당분간', wind: '7~16', wave: '1.0~4.0' }], notes: [{ kind: '특보 가능성', text: '모레(21일)까지 {{loc:서해중부먼바다}} {{warn:풍랑특보가 길게 이어질 가능성}} · 내일(20일) 오전 {{loc:충남앞바다}} {{warn:풍랑특보가 발표될 가능성}}' }] };
        const iDJ = S.extractSeaItems(DAEJEON), cp = (x) => JSON.parse(JSON.stringify(x));
        const djLift = (text, kind) => { const c = cp(aDaejeon); c.notes.push({ kind: kind || '해제 예고', text }); return c; };
        ok('대전 답(해제 예고를 해역 이름 칸에만 적음)은 걸린다 — 한 줄이 없다', S.check(cp(aDaejeon), iDJ, DAEJEON) === '글에 있는 종류가 빠졌다: 해제 예고', S.check(cp(aDaejeon), iDJ, DAEJEON));
        { const t = S.trim(S.normalize(djLift('{{loc:충남앞바다}} 19일 밤(21~24시)')), iDJ);
          ok('대전 답 + 해제 예고 한 줄: 받는다 — 해역 이름 칸의 「(충남앞바다(해제예고: …))」는 빼고 「서해중부해상」만 남긴다(버린 것에 적힌다)', S.check(djLift('{{loc:충남앞바다}} 19일 밤(21~24시)'), iDJ, DAEJEON) === '' && t.p.zones[0].zone === '서해중부해상' && t.dropped.some((d) => /해제 예고 곁말을 뺌/.test(d)), t); }
        ok('해제 예고: 종류 이름을 붙여 써도(「해제예고」)·해역 뒤에 조사가 붙어도 받는다', S.check(djLift('{{loc:충남앞바다}}는 19일 밤(21~24시)', '해제예고'), iDJ, DAEJEON) === '');
        ok('해제 예고: 시점을 고치거나(20일) 줄이거나(「19일 밤」) 다른 때로 바꾸면 걸린다', [' 20일 밤(21~24시)', ' 19일 밤', ' 19일 낮(21~24시)'].every((x) => /해제 예고가 빠졌거나 글과 다르다/.test(S.check(djLift('{{loc:충남앞바다}}' + x), iDJ, DAEJEON))));
        ok('해제 예고: 해역을 넓혀 적거나(서해중부해상) 해제 예고가 없는 해역을 덧붙이면 걸린다', /해제 예고가 빠졌거나 글과 다르다/.test(S.check(djLift('{{loc:서해중부해상}} 19일 밤(21~24시)'), iDJ, DAEJEON))
            && /해역·시점 말고 다른 말이 있다/.test(S.check(djLift('{{loc:서해중부해상}}({{loc:충남앞바다}} 19일 밤(21~24시))'), iDJ, DAEJEON)));
        // 별도 에이전트 검토(2026-11-19 오후)에서 통과하던 틀린 답들 — 해제 예고 줄에는 「해역 + 그 시점」 짝과 군말만 쓸 수 있다
        ok('해제 예고(검토): 뜻을 뒤집는 곁말(「까지 유지」「해제되지 않음」「아님」「해제 안함」「지속」)·지어낸 짝 덧붙이기·바람 숫자 섞기는 걸린다 — 군말(「풍랑특보 해제 예고:」)은 받는다',
            ['{{loc:충남앞바다}} 19일 밤(21~24시)까지 유지', '{{loc:충남앞바다}} 19일 밤(21~24시) 이후에도 해제되지 않음', '{{loc:충남앞바다}} 19일 밤(21~24시) 해제 예고 아님', '{{loc:충남앞바다}} 해제 안함 19일 밤(21~24시)', '{{loc:충남앞바다}} 19일 밤(21~24시) 풍랑특보 지속',
             '{{loc:충남앞바다}} 19일 밤(21~24시) · 충남앞바다 24일 밤(21~24시)', '{{loc:충남앞바다}} 19일 밤(21~24시), 물결 {{num:1.0~4.0m}}'].every((x) => S.check(djLift(x), iDJ, DAEJEON) !== '')
            && ['{{loc:충남앞바다}} 풍랑특보 해제 예고: 19일 밤(21~24시)', '{{loc:충남앞바다}}는 19일 밤(21~24시) 해제 예고', '{{loc:충남앞바다}}의 풍랑특보 19일 밤(21∼24시)'].every((x) => S.check(djLift(x), iDJ, DAEJEON) === ''));
        { const mk = (lift) => '<유의 사항>\n○ (해상) 서해중부해상은 당분간(충남앞바다(' + lift + ')) 바람이 30~65km/h(9~18m/s), 물결이 1.5~4.0m로 높게 일겠습니다.';
          const ans = (text) => ({ zones: [{ zone: '서해중부해상', period: '당분간', wind: '9~18', wave: '1.5~4.0' }], notes: [{ kind: '해제 예고', text }] });
          const A = mk('해제예고: 내일(20일) 새벽(03~06시)'), iA = S.extractSeaItems(A), M = mk('해제예고: 1월 1일 오전(09~12시)'), iM = S.extractSeaItems(M);
          ok('해제 예고(검토): 시점이 「내일(20일) 새벽(…)」「1월 1일 오전(…)」 꼴이어도 시점을 대조한다 — 그대로 적으면 받고, 때를 바꾸거나(새벽→오전) 시점을 빼면 걸린다',
              S.check(ans('{{loc:충남앞바다}} 내일(20일) 새벽(03~06시)'), iA, A) === '' && S.check(ans('{{loc:충남앞바다}} 1월 1일 오전(09~12시)'), iM, M) === ''
              && ['{{loc:충남앞바다}} 20일 오전(03~06시)', '{{loc:충남앞바다}} 내일(20일) 밤(03~06시)', '{{loc:충남앞바다}} 오늘(20일) 새벽(03~06시)', '{{loc:충남앞바다}} 해제예고', '{{loc:충남앞바다}} 20'].every((x) => S.check(ans(x), iA, A) !== '')
              && S.check(ans('{{loc:충남앞바다}} 1월 1일 오후(09~12시)'), iM, M) !== '', [S.check(ans('{{loc:충남앞바다}} 내일(20일) 새벽(03~06시)'), iA, A), S.check(ans('{{loc:충남앞바다}} 1월 1일 오전(09~12시)'), iM, M)]);
          // 못 읽는 해제 예고: 시점 꼴이 낯설거나(「곧」), 「해제」와 「예고」 사이에서 줄이 갈렸다 — 어떤 답도 받지 않는다(원문 줄이 그대로 나간다)
          const U = mk('해제예고: 곧'), iU = S.extractSeaItems(U);
          const BR = '<유의 사항>\n○ (해상) 서해중부해상은 당분간 바람이 30~65km/h(9~18m/s), 물결이 1.5~4.0m로 높게 일겠습니다.\n- 충남앞바다(해제\n예고: 19일 밤(21~24시))', iB = S.extractSeaItems(BR);
          ok('해제 예고(검토): 해역이나 시점을 못 읽은 해제 예고가 있으면 어떤 답도 받지 않는다(줄이 갈린 「해제⏎예고」 포함) — 해역만 맞춘 답이 통과하지 않는다',
              /읽지 못했다/.test(S.check(ans('{{loc:충남앞바다}} 해제 예고'), iU, U)) && ['{{loc:서해중부해상}} 19일 밤(21~24시)', '{{loc:충남앞바다}} 19일 새벽(21~24시)', '{{loc:충남앞바다}} 19일 밤(21~24시)'].every((x) => /읽지 못했다/.test(S.check(ans(x), iB, BR))), [S.check(ans('{{loc:충남앞바다}} 해제 예고'), iU, U), S.check(ans('{{loc:충남앞바다}} 19일 밤(21~24시)'), iB, BR)]); }
        ok('해제 예고: 글에 없는데 지어낸 한 줄은 버린다(글에 없는 종류) · 기간 칸에 넣은 곁말도 뺀다', (() => { const c = { zones: [], notes: [{ kind: '해제 예고', text: '{{loc:제주도앞바다}} 21일 오전(09~12시)' }] }; const t = S.trim(S.normalize(c), iJ); return !t.p.notes.some((n) => n.kind === '해제 예고') && t.dropped.some((d) => /글에 없는 종류\): 해제 예고/.test(d)); })()
            && (() => { const c = djLift('{{loc:충남앞바다}} 19일 밤(21~24시)'); c.zones[0] = { zone: '서해중부해상', period: '당분간(충남앞바다(해제예고: 19일 밤(21~24시)))', wind: '7~16', wave: '1.0~4.0' }; return S.check(c, iDJ, DAEJEON) === '' && S.trim(S.normalize(c), iDJ).p.zones[0].period === '당분간'; })());
        // 두 곳의 해제 예고 — 서로 바꿔 적으면 걸린다(해역 바로 뒤에 제 시점)
        const TWO = '<풍랑>\n○ (해상) 풍랑특보가 발효 중인 동해중부앞바다(해제 예고: 9일 밤(21~24시))와 동해중부먼바다(해제 예고: 10일 새벽(03~06시))는 오늘(9일) 바람이 35~60km/h(10~16m/s)로 강하게 불고 물결이 2.0~4.0m로 매우 높게 일겠습니다.';
        const iTwo = S.extractSeaItems(TWO), two = (text) => ({ zones: [{ zone: '동해중부앞바다 · 동해중부먼바다', period: '오늘(9일)', wind: '10~16', wave: '2.0~4.0' }], notes: [{ kind: '해제 예고', text }] });
        ok('해제 예고 두 곳: 뽑기(해역·시점 짝) · 제 짝대로 적으면 받고, 서로 바꾸거나 한 곳을 빼면 걸린다', JSON.stringify(S.liftNotices(iTwo[0].lines)) === JSON.stringify([{ zone: '동해중부앞바다', time: '9일밤(21~24시)' }, { zone: '동해중부먼바다', time: '10일새벽(03~06시)' }])
            && S.check(two('{{loc:동해중부앞바다}} 9일 밤(21~24시) · {{loc:동해중부먼바다}} 10일 새벽(03~06시)'), iTwo, TWO) === ''
            && /해제 예고가 빠졌거나 글과 다르다/.test(S.check(two('{{loc:동해중부앞바다}} 10일 새벽(03~06시) · {{loc:동해중부먼바다}} 9일 밤(21~24시)'), iTwo, TWO))
            && /해제 예고가 빠졌거나 글과 다르다/.test(S.check(two('{{loc:동해중부앞바다}} 9일 밤(21~24시)'), iTwo, TWO)), [S.liftNotices(iTwo[0].lines), S.check(two('{{loc:동해중부앞바다}} 9일 밤(21~24시) · {{loc:동해중부먼바다}} 10일 새벽(03~06시)'), iTwo, TWO)]);
        ok('해제 예고 뽑기: 적는 꼴들(「해제 예고: 」「해제예고 :」「해제 예고, 」「해제 예고 N일」) · 「(○○ 제외)」 뒤 · 시점 꼴이 아니면 time 은 빈 글', JSON.stringify(S.liftNotices(['서해중부앞바다(해제예고 : 15일 저녁(18~21시)), 동해남부먼바다(해제 예고, 10일 오후(15~18시)), 제주도앞바다(제주도남부앞바다 제외)(해제 예고 21일 오전(09~12시))', '남해동부해상은 곧 해제 예고가 있겠습니다.']))
            === JSON.stringify([{ zone: '서해중부앞바다', time: '15일저녁(18~21시)' }, { zone: '동해남부먼바다', time: '10일오후(15~18시)' }, { zone: '제주도앞바다', time: '21일오전(09~12시)' }, { zone: '남해동부해상', time: '' }]), S.liftNotices(['서해중부앞바다(해제예고 : 15일 저녁(18~21시)), 동해남부먼바다(해제 예고, 10일 오후(15~18시)), 제주도앞바다(제주도남부앞바다 제외)(해제 예고 21일 오전(09~12시))', '남해동부해상은 곧 해제 예고가 있겠습니다.']));
        ok('지시문: 종류에 「해제 예고」가 있고, 해역·기간 칸에 넣지 말라고 적혀 있다', /"해제 예고"/.test(S.PROMPT('x')) && /zone·period 에 넣지 않는다/.test(S.PROMPT('x')));
        ok('버려도 되는 것만 버린다: 「가능성」이 글에 있는 글에서 「특보 가능성」 줄에 「가능성」이라는 말이 없으면 버리고 → 빠뜨림으로 걸린다', /빠졌다: 특보 가능성/.test(S.check(Object.assign({}, aSudo, { notes: [{ kind: '특보 가능성', text: '{{loc:서해중부먼바다}} {{warn:풍랑특보}} 발효 중' }] }), iS, SUDO)));
        ok('색 표시 손보기는 단위 붙은 숫자만 num 으로 남긴다 · loc·warn 은 그대로', S.normalize({ zones: [], notes: [{ kind: '너울', text: '{{num:1.5~3.0m}} {{num:9~14m/s}} {{num:21일}} {{loc:제주도해안}} {{warn:너울}} {{etc:글}}' }] }).notes[0].text === '{{num:1.5~3.0m}} {{num:9~14m/s}} 21일 {{loc:제주도해안}} {{warn:너울}} 글');
    }

    console.log('── 요약 흐름(summarize) ──');
    {
        const calls = [];
        const fake = (answer) => async (f, prompt, o) => { calls.push({ f, prompt, o }); const a = typeof answer === 'function' ? answer() : answer; if (a && a.success && o.accept && !o.accept(JSON.parse(a.text))) return { success: false, error: '답을 쓸 수 없다(부르는 쪽 검사에 걸림)', tried: [{ id: 'gemma', ok: false }] }; return a; };
        const r0 = await S.summarize('<중점 사항>\n○ 맑겠습니다.', { call: fake({ success: true, text: '{}' }) });
        ok('바다 항목이 없으면 AI 를 부르지 않고 「없음」', r0.state === 'none' && calls.length === 0 && typeof r0.at === 'string', r0);
        const r1 = await S.summarize(JEJU, { call: fake({ success: true, text: JSON.stringify(GOOD()), provider: 'gemma', tried: [{ id: 'gemma', ok: true }] }) });
        ok('요약됨: 해역별 줄·종류별 한 줄·누가 답했나 — ⑥(seasummary)로 부르고, 바다 항목만 준다(특보 현황·강풍·기압계 글은 지시문에 없다)', r1.state === 'ok' && r1.by === 'gemma' && r1.zones.length === 5 && r1.notes.length === 2 && calls.length === 1 && calls[0].f === 'seasummary'
            && typeof calls[0].o.accept === 'function' && /○ \(해상\) 풍랑특보가 발효 중인/.test(calls[0].prompt) && !/대설주의보|강풍특보가 발효 중인 제주도|대륙고기압|분포도/.test(calls[0].prompt), { state: r1.state, by: r1.by });
        const wrong = GOOD(); wrong.zones[0].wave = '1.5~9.0';
        const r2 = await S.summarize(JEJU, { call: fake({ success: true, text: JSON.stringify(wrong), provider: 'gemini' }) });
        ok('답이 원문 대조에 걸리면 「원문 그대로」 — 뽑은 바다 줄과 걸린 까닭을 남긴다(지어낸 숫자가 화면에 안 나간다)', r2.state === 'raw' && r2.lines.length === 4 && /^○ \(해상\)/.test(r2.lines[0]) && r2.reasons.some((w) => /물결 숫자가 글에 없다/.test(w)) && !r2.zones, r2);
        const r3 = await S.summarize(JEJU, { call: fake({ success: false, error: '429 quota', tried: [{ id: 'gemma', ok: false }, { id: 'gemini', ok: false }] }) });
        ok('AI 가 전부 실패해도 「원문 그대로」 — 오류 글·시도 기록을 남긴다', r3.state === 'raw' && /429/.test(r3.error) && r3.tried.length === 2 && r3.lines.length === 4);
        const r4 = await S.summarize(JEJU, { call: async () => { throw new Error('network down'); } });
        const r5 = await S.summarize(JEJU, { call: async () => ({ success: true, text: 'JSON 아님' }) });
        const r6 = await S.summarize(JEJU, { call: async () => ({ success: true, text: JSON.stringify(wrong) }) });   // accept 를 안 부르는 호출자
        ok('호출이 던지거나 · JSON 이 아니거나 · 검사를 건너뛴 답이 와도 던지지 않고 「원문 그대로」', r4.state === 'raw' && /network down/.test(r4.error) && r5.state === 'raw' && r6.state === 'raw');
        const t = await S.trial(JEJU).catch((e) => ({ thrown: e.message }));
        ok('trial(관리자 「시험 요약」): 던지지 않고 걸린 시간·AI 에게 준 바다 글·결과를 준다(이 환경엔 AI 키가 없어 「원문 그대로」)', !t.thrown && typeof t.ms === 'number' && /^○ \(해상\)/.test(t.seaText) && ['ok', 'raw'].includes(t.result.state), t.thrown || t.result.state);
        ok('지시문: 종류 이름이 검사가 아는 종류와 같다(「바람·물결」은 서버가 원문에서 붙여 AI 에게 안 준다) · 글에 없는 것을 만들지 말라고 적는다', Object.keys(S.KINDS).filter((k) => k !== '바람·물결').every((k) => S.PROMPT('x').includes('"' + k + '"')) && /글에 없는 해역·숫자·시점을 만들지 않는다/.test(S.PROMPT('x')));
    }

    console.log('── 운영 「시험 요약」 2026-11-20(수도권) — 「X에 특보가 발효된 가운데, A는 …, B는 …」의 X 는 배경이다 ──');
    {
        const SD = '<강풍 및 풍랑>\n○ (풍랑) 서해중부전해상에 풍랑특보가 발효된 가운데, 서해중부먼바다는 내일(21일) 오전까지, 인천.경기앞바다는 오늘(20일) 오후까지 바람이 25~60km/h(7~16m/s)로 매우 강하게 불고 물결이 1.0~3.5m로 매우 높게 일겠으니, 항해 및 조업 선박은 각별히 유의하기 바랍니다.';
        const iSD = S.extractSeaItems(SD), row = (zone, period) => ({ zone, period, wind: '7~16', wave: '1.0~3.5' }), c = (zones, notes) => S.check({ zones, notes: notes || [] }, iSD, SD);
        // 실제 답 넷(클로드 키1 · 업스테이지 · ChatGPT · Gemini — Gemini 는 「발효 중」 한 줄이 더 있었고 그 줄은 trim 이 버린다)
        ok('실제 답(클로드·업스테이지·ChatGPT·Gemini): 뒤의 두 해역을 제 기간으로 적은 답은 받는다 — 앞 절의 「서해중부전해상」을 요구하지 않는다(종전: 다섯 AI 전부 거절)',
            c([row('서해중부먼바다', '내일(21일) 오전까지'), row('인천.경기앞바다', '오늘(20일) 오후까지')]) === '' && c([row('서해중부먼바다', '~내일(21일) 오전'), row('인천.경기앞바다', '~오늘(20일) 오후')]) === ''
            && c([row('서해중부먼바다', '~내일(21일) 오전'), row('인천.경기앞바다', '오늘(20일) 오후까지')]) === '' && c([row('서해중부먼바다', '내일(21일) 오전까지'), row('인천.경기앞바다', '오늘(20일) 오후까지')], [{ kind: '특보 가능성', text: '{{loc:서해중부전해상}} {{warn:풍랑특보}} 발효 중' }]) === '',
            c([row('서해중부먼바다', '내일(21일) 오전까지'), row('인천.경기앞바다', '오늘(20일) 오후까지')]));
        ok('뒤의 해역 하나를 빼거나, 앞 절의 넓은 해역만 적은 답은 여전히 걸린다', /해역 줄에 없다: 인천경기앞바다/.test(c([row('서해중부먼바다', '내일(21일) 오전까지')])) && /해역 줄에 없다: 서해중부먼바다/.test(c([row('서해중부전해상', '내일(21일) 오전까지')])));
        ok('실제 Gemma 답: 두 해역을 한 줄에 묶고 기간도 둘을 이어 적은 답은 걸린다(어느 기간이 어느 해역 것인지 알 수 없다) · 가운뎃점으로 적은 이름(「인천·경기앞바다」)은 같은 이름으로 본다',
            /기간이 둘 이상/.test(c([row('서해중부먼바다 · 인천·경기앞바다', '내일(21일) 오전까지 · 오늘(20일) 오후까지')])) && c([row('서해중부먼바다', '내일(21일) 오전까지'), row('인천·경기앞바다', '오늘(20일) 오후까지')]) === '');
        ok('지시문: 기간이 다른 해역은 줄을 나누고 period 에는 기간 하나만 — 「…가운데,」 꼴의 예시가 들어 있다(실제 Gemma 가 두 번 연속 한 줄로 묶었다)', /기간이 서로 다른 해역은 숫자가 같아도 한 줄에 묶지 않는다/.test(S.PROMPT('x')) && /period 칸에는 기간을 하나만/.test(S.PROMPT('x')) && /발효된 가운데, B는/.test(S.PROMPT('x')));
        // 뒤에 해역이 없으면 앞 절의 해역이 숫자의 임자다 — 종전대로 요구한다(조사 자료의 다른 꼴)
        const ONE = '<해상>\n○ (해상) 서해남부먼바다에 풍랑특보가 발효중인 가운데, 모레(23일)까지 바람이 35~60km/h(10~16m/s)로 매우 강하게 불고 물결이 1.5~4.0m로 매우 높게 일겠습니다.', iO = S.extractSeaItems(ONE);
        ok('「X에 특보가 발효중인 가운데, 모레까지 바람이 …」(뒤에 해역 없음): X 를 해역 줄로 적어야 한다(종전 그대로)', S.check({ zones: [{ zone: '서해남부먼바다', period: '모레(23일)까지', wind: '10~16', wave: '1.5~4.0' }], notes: [] }, iO, ONE) === '' && S.check({ zones: [], notes: [] }, iO, ONE) !== '');
    }

    console.log('── 별도 에이전트 검토에서 나온 것(2026-11-19) ──');
    {
        // 글 다른 곳(예비특보 줄)에만 있는 형제 해역을 해상 항목의 숫자에 붙인 답 — 끝 몇 글자(「부앞바다」)만 맞아 통과하던 것
        const GW = '<예비특보 현황>\n○ 풍랑 예비특보(12일 오후): 강원북부앞바다\n<유의 사항>\n○ (해상) 풍랑특보가 발효된 강원남부앞바다는 오늘(11일) 오후까지, 동해중부먼바다는 내일(12일) 오전까지 바람이 30~60km/h(9~16m/s)로 매우 강하게 불고, 물결이 1.5~4.0m로 매우 높게 일겠습니다.';
        const iGW = S.extractSeaItems(GW);
        const honest = { zones: [{ zone: '강원남부앞바다', period: '오늘(11일) 오후까지', wind: '9~16', wave: '1.5~4.0' }, { zone: '동해중부먼바다', period: '내일(12일) 오전까지', wind: '9~16', wave: '1.5~4.0' }], notes: [] };
        const sibling = JSON.parse(JSON.stringify(honest)); sibling.zones.push({ zone: '강원북부앞바다', period: '오늘(11일) 오후까지', wind: '9~16', wave: '1.5~4.0' });
        ok('형제 해역: 글의 다른 곳에만 있는 「강원북부앞바다」를 숫자에 붙인 답은 걸린다(끝 글자만 같은 「강원남부앞바다」로 통과하지 않는다) — 정직한 답은 통과', S.check(honest, iGW, GW) === '' && /해역 이름이 글에 없다: 강원북부앞바다/.test(S.check(sibling, iGW, GW)), [S.check(honest, iGW, GW), S.check(sibling, iGW, GW)]);
        // 한 줄 글에 지어낸 내용
        const iJ = S.extractSeaItems(JEJU), note = (text) => { const c = GOOD(); c.notes[0].text = text; return S.check(c, iJ, JEJU); };
        ok('한 줄 글: 뜻을 뒤집거나 부풀리는 말(없음·안전·금지·태풍)은 글에 있을 때만 — 「가능성은 없음, 해상은 안전하겠음」「출항 금지 가능성」「태풍특보 발효 가능성」은 걸린다',
            /글에 없는 말이 있다: (없음|안전)/.test(note('풍랑특보가 발표될 가능성은 없음, 해상은 안전하겠음')) && /글에 없는 말이 있다: 금지/.test(note('모든 선박 출항 금지 가능성')) && /글에 없는 말이 있다: 태풍/.test(note('{{warn:태풍특보 발효 가능성}} 매우 높음')),
            [note('풍랑특보가 발표될 가능성은 없음, 해상은 안전하겠음'), note('모든 선박 출항 금지 가능성'), note('{{warn:태풍특보 발효 가능성}} 매우 높음')]);
        ok('한 줄 글: 색 표시로 안 감싼 해역 이름도 글에 있어야 한다(「부산앞바다」)', /한 줄의 해역 이름이 글에 없다: 부산앞바다/.test(note('부산앞바다와 제주도남부앞바다는 풍랑특보 발표 가능성')), note('부산앞바다와 제주도남부앞바다는 풍랑특보 발표 가능성'));
        // 「가능성」만 있고 특보 얘기는 없는 글(조고의 침수 가능성)에 지어낸 특보 가능성
        const JOGO = '<유의 사항>\n○ (조고) 내일(2월 1일)까지 달의 인력이 강해 바닷물의 높이가 높은 기간으로, 만조 시 저지대에는 침수 가능성이 있겠으니, 피해가 발생하지 않도록 유의하기 바랍니다.';
        const iJo = S.extractSeaItems(JOGO), tJo = S.trim(S.normalize({ zones: [], notes: [{ kind: '조고', text: '내일(2월 1일)까지 만조 때 저지대 침수 가능성' }, { kind: '특보 가능성', text: '{{warn:풍랑경보로 강화될 가능성}}' }] }), iJo);
        ok('「침수 가능성」뿐인 글에 「특보 가능성」 줄을 적으면 그 줄은 버려진다(「가능성」 한 낱말로는 받지 않는다)', tJo.p.notes.map((n) => n.kind).join() === '조고' && tJo.dropped.length === 1, tJo);
        // 기간의 날 낱말
        const day = (period) => { const c = GOOD(); c.zones[1].period = period; return S.check(c, iJ, JEJU); };
        ok('기간: 날을 가리키는 말은 그 줄에 있어야 한다 — 「오늘」(그 줄에 없음)·「그글피」는 걸리고 「모레 밤까지」「당분간」이 그 줄에 없으면 그것도 걸린다', /기간의 낱말이 글에 없다/.test(day('오늘 밤까지')) && /기간의 낱말이 글에 없다/.test(day('그글피까지')) && /기간의 낱말이 글에 없다/.test(day('당분간')) && day('모레 밤까지') === '', [day('오늘 밤까지'), day('당분간'), day('모레 밤까지')]);
        // 뽑기
        ok('뽑기: 이름에 괄호가 겹친 항목(「8일(수)~9일(목) 해상 날씨」)·줄표로 시작하는 바다 이름 줄(「- (해상) …」)도 뽑는다', S.extractSeaItems('<추석 연휴기간 전망>\n○ (8일(수)~9일(목) 해상 날씨) 제주도해상에 바람이 30~50km/h(8~14m/s)로 불겠습니다.').length === 1
            && S.extractSeaItems('<유의 사항>\n○ (강풍) 바람이 강하게 불겠습니다.\n- (해상) 서해중부먼바다는 풍랑특보가 발표될 가능성이 있겠습니다.').map((i) => i.label).join() === '해상');
        const HOL = '<설 연휴기간 전망>\n○ (유의 사항) 귀성길 교통안전에 유의하기 바랍니다.\n- 한편, 27일(월) 밤~31일(금) 동해중부해상에 바람이 30~60km/h(9~16m/s)로 매우 강하게 불고, 물결이 1.5~4.0m(먼바다 중심 최대 5.0m 이상)로 매우 높게 일겠습니다.\n<기압계 현황 및 전망>\n○ 내일은 동해상에서 발달하는 저기압의 영향으로 바람이 10m/s 로 불겠습니다.';
        ok('뽑기: 바다 이름이 없는 항목 밑의 「해역 + 바람·물결 숫자」 줄도 뽑는다(설 연휴 전망의 「- 한편 … 동해중부해상에 …」) — 기압계 설명 줄·특보 목록 줄은 아니다', S.extractSeaItems(HOL).length === 1 && /^- 한편, 27일/.test(S.extractSeaItems(HOL)[0].lines[0])
            && S.extractSeaItems('<특보 현황>\n○ 풍랑주의보: 동해중부먼바다(물결 3.0m)').length === 0, S.extractSeaItems(HOL));
        // 답 꺼내기
        const fenced = await S.summarize(JEJU, { call: async () => ({ success: true, provider: 'gemini', text: '```json\n' + JSON.stringify(GOOD()) + '\n```\n*(참고: 원문의 해역 이름을 그대로 옮겼습니다.)*' }) });
        ok('답을 울타리로 싸고 뒤에 설명을 붙여도 꺼내 쓴다(검사와 같은 방식으로 꺼낸다 — 옳은 답이 버려지지 않게)', fenced.state === 'ok' && fenced.zones.length === 5, fenced.state + ' ' + fenced.error);
        const long = '가'.repeat(100) + '먼바다';
        ok('해역 이름이 80자를 넘어도(한 줄에 해역 일고여덟 곳) 길이 때문에 버리지 않는다 — 160자까지', !/너무 길다/.test(S.check({ zones: [{ zone: long, period: '오늘', wind: '9~16', wave: null }], notes: [] }, iGW, GW)));
    }

    console.log('── 요약을 따로 돌리기(summarizePending) ──');
    {
        const FILE = process.env.REGIONAL_FORECAST_FILE, CDIR = process.env.REGIONAL_BULLETIN_CACHE_DIR;
        const RID = 'cmt:202611190450:37', cfile = (code, rid) => path.join(CDIR, code + '_' + rid.replace(/[/:]/g, '_') + '.json');
        const put = (store, caches) => { fs.mkdirSync(CDIR, { recursive: true }); for (const f of fs.readdirSync(CDIR)) fs.unlinkSync(path.join(CDIR, f)); fs.writeFileSync(FILE, JSON.stringify(store)); for (const [code, rid, c] of caches) fs.writeFileSync(cfile(code, rid), JSON.stringify(c)); };
        const store = () => JSON.parse(fs.readFileSync(FILE, 'utf8')), cache = (code, rid) => JSON.parse(fs.readFileSync(cfile(code, rid), 'utf8'));
        const full = { state: 'ok', zones: GOOD().zones, notes: GOOD().notes, by: 'gemma', at: 'T', tried: [{ id: 'gemma', ok: true }], reasons: ['앞 답이 걸린 까닭'], dropped: ['버린 줄'] };
        const calls = [];
        put({ 184: { officeCode: '184', officeName: '제주지방기상청', bulletinReportId: RID, summary: '본문', temperature: { high: '12 ~ 13' } }, 143: { officeCode: '143', bulletinReportId: RID, seaSummary: { state: 'none', at: 'T' } }, 105: { officeCode: '105', bulletinReportId: RID } },
            [['184', RID, { rawText: JEJU, aiColored: true, summary: '본문' }], ['143', RID, { rawText: 'x' }], ['105', RID, { aiColored: true, summary: '옛 캐시(본문 없음)' }]]);
        const s1 = await R.summarizePending({ summarize: async (raw) => { calls.push(raw.slice(0, 8)); return full; } });
        const e1 = store()[184];
        ok('요약이 안 끝난 지방청만 부른다(끝난 곳·본문이 없는 옛 캐시는 안 부른다) — 공개 파일에는 화면이 쓰는 칸만 싣고(AI 오류·시도 기록·걸린 까닭은 안 나간다) 다른 칸은 그대로', calls.length === 1 && s1.ok === 1 && JSON.stringify(Object.keys(e1.seaSummary).sort()) === JSON.stringify(['at', 'notes', 'state', 'zones'])
            && e1.seaSummary.zones.length === 5 && e1.summary === '본문' && e1.temperature.high === '12 ~ 13' && !store()[105].seaSummary && store()[143].seaSummary.state === 'none', { s1, keys: Object.keys(e1.seaSummary) });
        ok('캐시 파일에는 진단까지 남긴다(누가 답했나·걸린 까닭·시도 횟수) — 관리자·다음 시도가 본다', cache('184', RID).seaSummary.by === 'gemma' && cache('184', RID).seaSummary.reasons.length === 1 && cache('184', RID).seaTries === 1 && cache('184', RID).rawText === JEJU);
        calls.length = 0; await R.summarizePending({ summarize: async () => { calls.push(1); return full; } });
        ok('끝난 요약은 다시 부르지 않는다', calls.length === 0);
        // 못 한 요약: 다음 수집 때 다시, 통보문마다 네 번까지
        const rawAns = { state: 'raw', lines: ['○ (해상) …'], error: '429 quota exceeded for project 1234', reasons: ['물결 숫자가 글에 없다'], tried: [{ id: 'gemma', ok: false, error: '429' }], at: 'T' };
        put({ 184: { officeCode: '184', bulletinReportId: RID } }, [['184', RID, { rawText: JEJU, aiColored: true }]]);
        calls.length = 0; const stats = [];
        for (let k = 0; k < 6; k++) stats.push(await R.summarizePending({ summarize: async () => { calls.push(k); return rawAns; } }));
        ok('못 만든 요약(raw)은 다음 수집 때 다시 해 보되 한 통보문에 ' + R.SEA_MAX_TRIES + '번까지만 — 그 뒤로는 AI 를 부르지 않고 「원문 그대로」로 둔다', calls.length === R.SEA_MAX_TRIES && stats[4].gaveUp === 1 && stats[5].gaveUp === 1 && store()[184].seaSummary.state === 'raw' && cache('184', RID).seaTries === R.SEA_MAX_TRIES, { calls: calls.length, last: stats[5] });
        ok('「원문 그대로」도 공개 파일에는 줄만 나간다 — AI 오류 글(할당량·프로젝트 번호 등)은 안 나간다', JSON.stringify(Object.keys(store()[184].seaSummary).sort()) === JSON.stringify(['at', 'lines', 'state']) && !/429|quota/.test(JSON.stringify(store()[184])));
        // 요약하는 사이 새 통보문이 들어옴
        const RID2 = 'cmt:202611191640:38';
        put({ 184: { officeCode: '184', bulletinReportId: RID } }, [['184', RID, { rawText: JEJU, aiColored: true }]]);
        await R.summarizePending({ summarize: async () => { const st = store(); st[184].bulletinReportId = RID2; st[184].seaSummary = null; fs.writeFileSync(FILE, JSON.stringify(st)); return full; } });
        ok('요약하는 사이 새 통보문이 들어왔으면 그 결과를 싣지 않는다(새 글에 옛 요약이 붙지 않게)', store()[184].bulletinReportId === RID2 && store()[184].seaSummary === null);
        // 캐시에 끝난 요약이 있는데 공개 파일에는 없음(같은 통보문을 다시 색칠한 뒤 등)
        put({ 184: { officeCode: '184', bulletinReportId: RID, seaSummary: null } }, [['184', RID, { rawText: JEJU, seaSummary: full, seaTries: 1 }]]);
        calls.length = 0; await R.summarizePending({ summarize: async () => { calls.push(1); return full; } });
        ok('캐시에 끝난 요약이 있으면 AI 를 다시 부르지 않고 그것을 싣는다', calls.length === 0 && store()[184].seaSummary.state === 'ok');
        // 겹쳐 돌지 않는다
        put({ 184: { officeCode: '184', bulletinReportId: RID } }, [['184', RID, { rawText: JEJU }]]);
        let release; const gate = new Promise((r) => { release = r; }); calls.length = 0;
        const first = R.summarizePending({ summarize: async () => { calls.push(1); await gate; return full; } });
        const second = await R.summarizePending({ summarize: async () => { calls.push(2); return full; } });
        release(); await first;
        ok('도는 중에 또 불리면 건너뛴다(같은 글로 AI 를 겹쳐 부르지 않는다)', second.skipped === true && calls.join() === '1');
        ok('저장 파일이 없거나 요약이 던져도 던지지 않는다', (fs.unlinkSync(FILE), (await R.summarizePending({ summarize: async () => full })).ok === 0) && (put({ 184: { officeCode: '184', bulletinReportId: RID } }, [['184', RID, { rawText: JEJU }]]), (await R.summarizePending({ summarize: async () => { throw new Error('boom'); } })).ok === 0));
        ok('publicSea: 상태마다 화면이 쓰는 칸만', JSON.stringify(R.publicSea({ state: 'none', at: 'T', x: 1 })) === '{"state":"none","at":"T"}' && !('tried' in R.publicSea(full)) && !('error' in R.publicSea(rawAns)));
    }

    console.log('── 「분포도」 줄 빼기 ──');
    {
        const caps = ['< 오늘~모레 예상 기온 분포도 >', '< 오늘~내일 예상 강수지역 및 오늘~내일 예상 기온 분포도 >', '< 오늘~모레 예상 강수지역 및 내일~모레 예상 기온 분포도 >', '< 오늘~모레 예상 강수지역 분포도 >',
            '< 오늘 예상 강수지역 분포도, 내일~모레 예상 기온 분포도 >', '< 특보 현황 및 오늘~모레 예상 강수지역 분포도 >', '< 예비특보 현황 및 오늘~모레 예상 강수지역 분포도 >', '<오늘~모레 예상 강수지역 분포도>'];
        ok('실제로 본 그림 제목 줄 꼴 ' + caps.length + '가지를 모두 뺀다 — 다른 줄은 그대로', caps.every((c) => R.dropFigureCaption(c + '\n<특보 현황>\n○ 풍랑주의보: 제주도앞바다') === '<특보 현황>\n○ 풍랑주의보: 제주도앞바다'));
        ok('본문 머리(<특보 현황>·<중점 사항>)와 「분포도」가 든 보통 문장은 안 뺀다 · 글이 아니면 그대로', R.dropFigureCaption('<특보 현황>\n<중점 사항>\n○ 강수 분포도는 누리집을 참고하기 바랍니다.') === '<특보 현황>\n<중점 사항>\n○ 강수 분포도는 누리집을 참고하기 바랍니다.' && R.dropFigureCaption(null) === null);
        ok('제주 11-37호 글에서도 그 줄만 빠진다', !/분포도/.test(R.dropFigureCaption(JEJU)) && R.dropFigureCaption(JEJU).startsWith('<특보 현황>') && R.dropFigureCaption(JEJU).split('\n').length === JEJU.split('\n').length - 1);
        ok('새로 받는 글(수집)과 이미 저장된 글(내려줄 때) 두 곳에서 뺀다(글자 확인)', /return dropFigureCaption\(text\);/.test(read('regional_bulletin_collector.js')) && /e\.summary = rb\.dropFigureCaption\(e\.summary\)/.test(read('routes/weather.js')));
    }

    console.log('── 날씨해설 원문(PDF) ──');
    {
        const d = R.docKeyOf('184', 'cmt:202611190450:37');
        ok('열쇠·주소·호: 발표시각·관서·호로 정해진다(실제로 받아 본 주소 꼴)', d && d.key === 'fax_wcmt_202611190450_184_37' && d.url === 'https://marine.kma.go.kr/resources/kmas/C5N_DATA/WRN/PDF/202611/19/fax_wcmt_202611190450_184_37.pdf' && d.ho === '제11-37호', d);
        ok('꼴이 다른 번호·관서는 null(바깥 글자를 주소에 붙이지 않는다)', R.docKeyOf('184', 'cmt:2026:37') === null && R.docKeyOf('184', '') === null && R.docKeyOf('../x', 'cmt:202611190450:37') === null && R.docKeyOf('184', 'cmt:202611190450:37/../x') === null);
        ok('보관소가 그 열쇠를 받아들인다(쪽 그림·PDF 경로) — 다른 꼴은 여전히 막는다', D.KEY_RE.test(d.key) && D.KEY_RE.test('KTKO50_202611181600_184_51') && !D.KEY_RE.test('fax_wcmt_x') && !D.KEY_RE.test('../fax_wcmt_202611190450_184_37'));

        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcmt-')), fetched = [];
        const docs = D.createDocs({ dir, fetchPdf: async (url) => { fetched.push(url); return /_99\.pdf$/.test(url) ? null : Buffer.from('%PDF-1.4 ' + url); }, convert: async (pdf, prefix) => { fs.writeFileSync(prefix + '-1.png', 'P1'); fs.writeFileSync(prefix + '-2.png', 'P2'); } });
        const W = (seq) => R.docKeyOf('184', 'cmt:202611190450:' + seq), ls = () => fs.readdirSync(dir).sort();
        const s1 = await docs.syncExtra([W(37), W(99)]);
        ok('받아서 쪽 그림으로 바꾼다 — 아직 안 올라온 것은 기다린다(다음에 다시)', s1.need === 2 && s1.fetched === 1 && s1.converted === 1 && s1.waiting === 1 && docs.pages(W(37).key).join() === '1,2' && !!docs.file(W(37).key, 'pdf') && docs.pages(W(99).key).length === 0, s1);
        // 특보 통보문 한 건을 같은 보관소에 둔다
        const b = { office: '제주청', rpt: '6', result: { t1Title: '제11-51호', tmIn: '2026-11-18 16:00:30.0', rptImageName2: '202611/18/KTKO50_202611181600_184_51.png' } };
        const trails = { z: { list: [{ rpt: '6', office: '제주청', ho: '제11-51호', inMs: Date.parse('2026-11-18T16:00:30+09:00') }] } };
        await docs.sync({ trails, bulletins: [b] });
        ok('특보 통보문 맞추기가 날씨해설 원문을 지우지 않는다(집안이 다르다)', docs.pages('KTKO50_202611181600_184_51').length === 2 && docs.pages(W(37).key).length === 2, ls());
        const s2 = await docs.syncExtra([W(38)]);
        ok('새 발표가 나오면 앞의 날씨해설을 지운다 — 특보 통보문은 그대로', s2.removed === 3 && docs.pages(W(37).key).length === 0 && docs.pages(W(38).key).length === 2 && docs.pages('KTKO50_202611181600_184_51').length === 2, { s2, ls: ls() });
        const s3 = await docs.syncExtra([]);
        ok('목록이 비면(지방청 자료를 못 읽음) 지우지 않는다 · 꼴이 다른 열쇠는 받지 않는다', s3.removed === 0 && docs.pages(W(38).key).length === 2 && (await docs.syncExtra([{ key: '../evil', url: 'http://x' }, { key: 'KTKO50_202611181600_184_52', url: 'http://x' }])).need === 0);
        await docs.sync({ trails: {}, bulletins: [b] });
        ok('특보가 끝나 통보문이 지워져도 날씨해설 원문은 남는다', docs.pages('KTKO50_202611181600_184_51').length === 0 && docs.pages(W(38).key).length === 2);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    console.log('── 이어 붙인 곳(글자 확인) ──');
    {
        const col = read('regional_bulletin_collector.js'), sch = read('scheduler.js'), wea = read('routes/weather.js'), adm = read('routes/bulletin_watch.js');
        const body = (name) => { const i = col.indexOf('async function ' + name + '('); return col.slice(i, col.indexOf('\n}\n', i)); };
        ok('수집기: 요약은 색칠 수집 안에서 부르지 않는다(색칠본·서버 시작이 요약을 기다리지 않게) — 수집이 끝난 뒤 기다리지 않고 따로 돌린다(두 끝 모두)', !/summarize\(/.test(body('processOneOffice'))
            && (body('collectAllRegionalBulletins').match(/summarizePending\(\)\.catch\(/g) || []).length === 2 && !/await summarizePending/.test(body('collectAllRegionalBulletins')));
        ok('수집기: 통보문이 바뀌면 앞 통보문의 요약을 지운다(새 글에 옛 요약이 붙어 나가지 않게) · 같은 통보문을 다시 색칠할 때는 요약·시도 횟수를 이어 둔다', /changed \? \{ seaSummary: null \} : \{\}/.test(col) && /result\.seaSummary = cached\.seaSummary/.test(col) && /result\.seaTries = cached\.seaTries/.test(col));
        ok('원문 받기: 지방청 수집이 끝날 때마다(부팅·발표 시간대) — 방재기상플랫폼 관찰기와 무관하게', (sch.match(/regionalBulletinCollector\.syncDocs\(\)/g) || []).length === 2 && /syncExtra\(docs\)/.test(col));
        ok('화면 자료: 원문 그림이 있는 관서에만 doc(보기·받기 주소)을 붙인다', /docs\.pages\(d\.key\)\.length/.test(wea) && /viewUrl: '\/api\/bulletin-doc\/' \+ d\.key \+ '\/view'/.test(wea) && /e\.doc\.downloadUrl = '\/api\/bulletin-doc\/' \+ d\.key \+ '\/pdf'/.test(wea));
        ok('관리자 「시험 요약」: 지방청 7곳 가운데서만 · 저장하지 않는다(trial)', /try-sea-summary', authorize/.test(adm) && /BULLETIN_OFFICES\.some\(\(o\) => o\.code === office\)/.test(adm) && /regional_sea_summary'\)\.trial\(raw\)/.test(adm));
        // 「바람·물결」(2026-11-22 운영 제주 — 숫자 없는 바다 글은 종전엔 어떤 답도 통과하지 못해 원문 그대로 나갔다).
        //   이 종류 줄은 AI 가 쓰지 않고 서버가 원문을 잘라 붙인다(calmNote) — AI 에게 쓰게 했더니 독립 검토에서 해역 넓히기·날 섞기·「매우」 빌리기·뜻 뒤집기가 통과했다.
        {
            const JL = '○ (해상) 모레(24일)부터 제주도해상과 남해서부서쪽먼바다에는 차차 바람이 강하게 불고 물결이 높게 일겠으니, 항해 및 조업하는 선박은 유의하기 바라며, 앞으로 발표하는 기상정보를 참고하기 바랍니다.';
            const JI = [{ label: '해상', sec: '강풍 및 해상', lines: [JL] }], JR = '<강풍 및 해상>\n' + JL;
            const NL = '○ (해상) 내일(23일)은 동해중부먼바다에 바람이 30~65km/h(9~18m/s)로 매우 강하게 불고 물결이 1.5~4.0m로 매우 높게 일겠습니다.';
            const NI = [{ label: '해상', sec: '해상', lines: [NL] }];
            const cn = S.calmNote([JL]);
            ok('바람·물결: 원문을 잘라 만든다 — 줄머리·뒤 당부를 떼고 마지막 「높게」까지, 해역은 {{loc:}}', cn && cn.kind === '바람·물결' && cn.text === '모레(24일)부터 {{loc:제주도해상}}과 {{loc:남해서부서쪽먼바다}}에는 차차 바람이 강하게 불고 물결이 높게', cn);
            ok('바람·물결: 숫자가 적힌 줄에서는 만들지 않는다 · 숫자 줄이 있는 글의 숫자 없는 덧붙임 줄로도 만들지 않는다(그런 글은 해역 줄이 싣는다)', S.calmNote([NL]) === null && S.calmNote([NL, '- 또한, 모레(24일) 동해중부앞바다에도 바람이 강하게 불고 물결이 높게 일겠습니다.']) === null);
            { const L2 = '- 또한, 모레(24일) 제주도남쪽바깥먼바다를 중심으로 바람이 매우 강하게 불고 물결이 매우 높게 일겠습니다.'; const c3 = S.calmNote([JL, JL, L2, L2.replace('남쪽바깥', '남서쪽안쪽'), L2.replace('남쪽바깥', '남동쪽안쪽'), L2.replace('남쪽바깥먼바다', '동부앞바다')]);
              ok('바람·물결: 같은 문장은 한 번만 · 길면 문장 단위로 240자까지(색 표시가 깨지지 않는다)', c3.text.split(' · ').length === new Set(c3.text.split(' · ')).size && c3.text.length <= 240 && !/\{\{[^}]*$/.test(c3.text) && (c3.text.match(/\{\{/g) || []).length === (c3.text.match(/\}\}/g) || []).length, c3.text); }
            ok('바람·물결: 줄머리의 「- 또한,」은 뗀다', (S.calmNote(['- 또한, 모레(24일) 제주도해상에도 바람이 강하게 불고 물결이 높게 일겠습니다.']) || {}).text === '모레(24일) {{loc:제주도해상}}에도 바람이 강하게 불고 물결이 높게');
            ok('바람·물결: 숫자 없는 줄뿐인 글은 빈 답도 받는다 · 숫자 없는 해역 줄만 낸 답도(지워져 빈 답) 받는다', S.check({ zones: [], notes: [] }, JI, JR) === '' && S.check({ zones: [{ zone: '제주도해상', period: '모레(24일)~', wind: null, wave: null }], notes: [] }, JI, JR) === '');
            const evil = ['모레(24일)부터 {{loc:제주도해상}}과 {{loc:동해중부먼바다}}에 바람이 강하게 불고 물결이 높게', '모레(24일)부터 {{loc:제주도해상}}에 바람이 약해지고 물결이 낮아지겠음', '모레(24일)부터 {{loc:제주도해상}}에 바람이 매우 강하게'];
            ok('바람·물결: AI 가 쓴 이 종류 줄은 무엇이든 버린다(검토가 찾은 넓히기·뒤집기·부풀리기)', evil.every((x) => S.trim(S.normalize({ zones: [], notes: [{ kind: '바람·물결', text: x }] }), JI).p.notes.length === 0));
            ok('바람·물결: 숫자 글에는 빈 답을 여전히 안 받는다', /해역 줄이 없다|답이 비었다/.test(S.check({ zones: [], notes: [] }, NI, NL)));
            const r1 = await S.summarize(JR, { call: async (id, prompt, o) => { const text = '{"zones":[],"notes":[{"kind":"바람·물결","text":"' + evil[1] + '"}]}'; return o.accept(JSON.parse(text)) ? { success: true, text, provider: 'fake' } : { success: false, error: 'x' }; } });
            ok('바람·물결: summarize — AI 의 뒤집은 줄은 버리고 원문을 잘라 붙인 한 줄만 싣는다', r1.state === 'ok' && r1.notes.length === 1 && r1.notes[0].text === cn.text, r1);
            ok('바람·물결: 지시문은 이 얘기를 AI 에게 쓰지 말라 하고, 화면 딱지(노랑)는 있다', /서버가 원문을 그대로 붙인다/.test(S.PROMPT('x')) && !/"바람·물결"/.test(S.PROMPT('x')) && /'바람·물결': 'yellow'/.test(read('../client/js/forecast/outlook/marine_forecast.js')));
            ok('「매우」는 글에 있을 때만 한 줄에 쓴다(부풀리는 말)', /글에 없는 말이 있다: 매우/.test(S.check({ zones: [], notes: [{ kind: '천둥·번개', text: '모레 {{loc:제주도해상}}에 매우 강한 천둥·번개' }] }, [{ label: '해상', sec: '해상', lines: ['○ (해상) 모레(24일) 제주도해상에는 천둥·번개가 치는 곳이 있겠습니다.'] }], 'x')));
        }
        // 날을 적지 않은 「- 또한, …에도」 줄은 위 ○ 줄의 기간을 이어받는다 · 기간 방향(부터↔까지) 뒤집기는 걸린다 (운영 제주 2026-11-23 「시험 요약」 — 맞게 읽은 다섯 답이 전부 거절됐다)
        {
            const L1 = '○ (해상) 내일(24일) 새벽부터 제주도남쪽먼바다, 제주도앞바다(남부앞바다 제외), 남해서부서쪽먼바다에 차차 바람이 30~55km/h(9~15m/s)로 매우 강하게 불고, 물결이 1.0~3.5m로 매우 높게 일면서 풍랑특보가 발표될 가능성이 있겠으니, 앞으로 발표하는 기상정보를 참고하기 바랍니다.';
            const L2 = '- 또한, 제주도남부앞바다에도 바람이 30~50km/h(8~14m/s)로 강하게 불고, 물결이 1.5~2.5m로 높게 일겠으니, 항해나 조업하는 선박은 각별히 유의하기 바랍니다.';
            const L3 = '○ (조고) 모레(25일)부터 달의 인력이 강해 바닷물의 높이가 높은 대조기 기간으로, 만조 시간대에는 해수면 높이가 더욱 높아져 해안가 저지대를 중심으로 침수 가능성이 있겠으니, 안전사고 등에 각별히 유의하기 바랍니다.';
            const R = '<강풍 및 해상>\n' + [L1, L2, L3].join('\n'), I = S.extractSeaItems(R);
            const mk = (p2, p1 = '내일(24일) 새벽~') => ({ zones: [{ zone: '제주도남쪽먼바다 · 제주도앞바다(남부앞바다 제외) · 남해서부서쪽먼바다', period: p1, wind: '9~15', wave: '1.0~3.5' }, { zone: '제주도남부앞바다', period: p2, wind: '8~14', wave: '1.5~2.5' }],
                notes: [{ kind: '특보 가능성', text: '{{loc:제주도남쪽먼바다}} · {{loc:남해서부서쪽먼바다}}에 {{warn:풍랑특보가 발표될 가능성}}' }, { kind: '조고', text: '모레(25일)부터 대조기로 만조 시간대 {{loc:해안가 저지대}} 침수 가능성' }] });
            ok('딸린 줄: 날을 안 적은 「- 또한, 제주도남부앞바다에도 …」는 위 줄의 「내일(24일) 새벽부터」를 이어받는다(Gemma·업스테이지·ChatGPT 답)', S.check(mk('내일(24일) 새벽~'), I, R) === '', S.check(mk('내일(24일) 새벽~'), I, R));
            ok('딸린 줄: 다른 날을 적거나 「명시 없음」이면 걸린다', /기간의 숫자가 글에 없다/.test(S.check(mk('모레(25일)~'), I, R)) && /기간의 낱말이 글에 없다/.test(S.check(mk('명시 없음'), I, R)));
            ok('기간 방향: 글 「내일(24일) 새벽부터」를 「~내일(24일) 새벽」(까지)으로 적으면 걸린다(실제 Gemini 답) · 「부터」만 빠뜨린 것은 붙여 받는다',
                /방향이 글과 반대다/.test(S.check(mk('~내일(24일) 새벽', '~내일(24일) 새벽'), I, R)) && S.check(mk('내일(24일) 새벽', '내일(24일) 새벽'), I, R) === '');
            ok('기간 방향: 글이 「…까지」인데 「…~」(부터)로 적어도 걸린다', /방향이 글과 반대다\(글은 「까지」\)/.test(S.check({ zones: [{ zone: '동해중부먼바다', period: '모레(21일) 오전~', wind: '9~18', wave: '1.5~4.0' }], notes: [] }, [{ label: '해상', sec: '해상', lines: ['○ (해상) 모레(21일) 오전까지 동해중부먼바다에 바람이 30~65km/h(9~18m/s)로 매우 강하게 불고, 물결이 1.5~4.0m로 매우 높게 일겠습니다.'] }], 'x')));
        }
        ok('MMIS 코드를 쓰지 않는다', !/mmis/i.test(read('services/regional_sea_summary.js').replace(/\/\*[\s\S]*?\*\//g, '')));
    }

    console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('검사 중 예외', e); process.exit(1); });
