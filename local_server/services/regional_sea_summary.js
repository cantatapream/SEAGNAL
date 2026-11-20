'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/regional_sea_summary.js
 * 역할  : 지방청 단기 전망(날씨해설)에서 바다 얘기만 골라 「해상 기상 요약」을 만든다.
 *         ① 규칙으로 바다 항목(○ (해상)·(너울)·(조고)·(바다 안개)…)을 뽑는다 — 없으면 AI 를 부르지 않고 「없음」.
 *         ② AI(관리자 「AI 모델 설정」 ⑥ — 먼저 Gemma, 안 되면 ⑥ 순서)가 해역별 줄(해역·기간·바람·물결) + 종류별 한 줄로 줄인다.
 *         ③ 답의 숫자·해역 이름이 원문에 실제로 있는지 기계가 대조한다. 걸리면 다음 AI, 전부 안 되면 뽑은 원문 그대로 보인다.
 * 사용자 확정(2026-11-19):
 *   「기온 박스 아래에 해상 기상 요약이라고 해서 해상과 관련된 내용만 요약해서 표출하는 기능을 만들고자 해. 이 작업은 젬마가 진행하도록 하고 젬마가 안되면 …
 *     ai 모델 어떤것을 쓸것인지에 대한 순서로서 ai api 호출이 진행되도록」
 *   「작년 올해 여름철, 가을철, 겨울철, 봄철 각 한달씩 데이터를 수집하여 어떤식으로 전망했는지 조사하여 안을 만들어야」
 *   (안을 보고) 「1.모양 - 2번안 2.순서 - 전용칸 6 3.해상 기상 내용이 포함되어있지 않습니다. 라는 식으로 상자 표출」
 * 조사(2025·2026 × 1·4·8·10월, 관서 8곳 3,954건 — 방재기상플랫폼 날씨해설): 바다 얘기는 이름이 일정한 항목에 적힌다 —
 *   해상 2,852 · 너울 826 · 조고 559 · 바다 안개 493 · 「N일 해상 날씨」 100 · 풍랑 43 · 기상해일 30 · 이안류 28 · 어장/갯벌 안개 43.
 *   바다 항목이 하나도 없는 글 707건(17.9%). 바다 내용 길이 중앙 259자 · 90% 536자. 물결 수치 65.4% · 바람 수치 59.0% · 천둥.번개 32.8% · 특보 가능성 26.3%.
 *   머리(<…>) 이름은 제각각이라(유의 사항 2,629 · 강풍 및 해상 768 …) 항목 이름으로 고른다.
 * 실제 Gemma 로 불러 본 것(2026-11-19, 사용자가 준 임시 키 — gemma-4-26b-a4b-it, 지방청 7곳의 그날 새벽 발표분. 상세 analysis/bulletin_survey/README.md ⑲):
 *   · 답은 5~10초에 온다. 「수요 과다」(503)는 0.2초 만에 실패로 돌아온다(7편 중 3편) — 그때는 순서의 다음 AI, 그것도 안 되면 다음 수집 때 다시.
 *   · 처음 지시문으로는 답 4편 중 1편만 대조를 통과했다. 걸린 까닭과 고친 것:
 *       숫자가 없는 해역도 줄로 적음(wind·wave 둘 다 null) → 그런 줄은 버린다(trim) · 「풍랑특보 발효 중」을 「특보 가능성」으로 적음 → 「가능성」이 없는 줄은 버린다 ·
 *       없는 색 표시를 지어냄(`{{period:…}}` `{{kind:…}}`)·숫자가 아닌 것을 num 으로 감쌈 → 표시만 벗긴다(normalize) ·
 *       숫자가 적힌 해역을 숫자 없이 적음(틀린 답) → 「숫자가 적힌 줄의 해역이 해역 줄에 없다」로 잡는다(check 의 빠뜨림 검사).
 *   운영에서는 관리자 ⑥ 칸의 「시험 요약」(trial)으로 실제 답과 걸린 까닭·버린 줄을 본다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_ai(call 'seasummary' — ⑥ 순서·먼저 Gemma)
 *  - 서버 API      : 없음(결과는 regional_bulletin_collector.summarizePending 이 regional_forecast.json 의 seaSummary 로 넣는다 — 화면이 쓰는 칸만 → GET /api/regional-forecast)
 *  - 나를 쓰는 곳  : regional_bulletin_collector.js(summarizePending → summarize) · routes/bulletin_watch.js(POST /api/admin/bulletin-ai/try-sea-summary → trial)
 *  - 화면          : client/js/forecast/outlook/marine_forecast.js(「해상 기상 요약」 상자)
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */

// 바다 항목 이름(「○ (이름)」) — 조사에서 나온 이름들. 뭍 안개(「안개」)·「강풍」은 넣지 않는다(강풍 항목 2,443개 중 해상·선박 낱말이 든 것 2개).
const SEA_LABEL = /해상|풍랑|너울|조고|바다\s*안개|해일|이안류|어장\s*안개|갯벌\s*안개|물결/;
// 종류별 한 줄의 종류 → 그 종류를 쓰려면 바다 글에 있어야 하는 낱말(없으면 지어낸 것).
//   「특보 가능성」은 「가능성」만으로는 안 된다 — 조고 항목의 「침수 가능성」뿐인 글 96편 중 95편에서 지어낸 「풍랑경보로 강화될 가능성」이 통과했다(별도 에이전트 검토 2026-11-19).
const KINDS = {
    '특보 가능성': /(?:특보|경보|주의보)[^.\n]{0,40}가능성/, '천둥·번개': /천둥|번개/, '너울': /너울/, '바다 안개': /안개/, '조고': /조고|만조|해수면|바닷물/,
    '이안류': /이안류/, '기상해일': /기상해일/, '폭풍해일': /폭풍해일/, '해제 예고': /해제\s*예고/,
};
// 기간 칸에 써도 되는 낱말(글에 없어도 되는 것) — 그 밖의 한글은 글에 있어야 한다
//   날을 가리키는 말(오늘·내일·모레·글피·당분간)은 여기 없다 — 그 해역의 숫자가 놓인 줄에 있어야 한다(없어도 받으면 「내일 오전까지」가 「오늘」로 나가도 못 잡는다 — 검토에서 1,072편 전부 통과).
const PERIOD_WORDS = ['새벽', '아침', '오전', '낮', '오후', '저녁', '밤', '늦은', '이른', '까지', '부터', '사이', '일', '월', '시'];
const DAY_WORDS = ['오늘', '내일', '모레', '글피', '그글피', '당분간'];
// 한 줄 글에 이 낱말을 쓰려면 바다 글에도 있어야 한다 — 뜻을 뒤집거나 부풀리는 말(「가능성은 없음」「출항 금지」「태풍특보」)을 지어내지 못하게
const HEAVY_WORDS = ['없음', '없겠', '않겠', '안전', '해제', '금지', '통제', '대피', '발효', '발표', '경보', '주의보', '태풍', '해일', '확대', '강화', '연장', '변경', '취소'];
// 해역 이름 낱말(띄어 쓴 글에서) — 「남해서부서쪽먼바다와」→「남해서부서쪽먼바다」
const ZONE_TOKEN = /[가-힣.]*[가-힣](?:먼바다|앞바다|연안바다|해상|해안)/g;
const zoneTokens = (text) => (String(text || '').match(ZONE_TOKEN) || []).map((t) => t.replace(/\./g, '')).filter((t) => t.length >= 4);
const NUM = /^\d+(?:\.\d+)?(?:~\d+(?:\.\d+)?)?$/;
// 「해제예고」 — 바다 글에 「서해중부해상은 당분간(충남앞바다(해제예고: 19일 밤(21~24시)))」처럼 괄호 곁말로 적힌다.
//   조사(3,954편)에서는 특보 현황 줄(○ 풍랑주의보: A(해제 예고: T) — 1,790번, 바다 항목으로 안 뽑는 줄)에만 있었고 바다 항목 안에는 0편이었다.
//   운영 「시험 요약」(2026-11-19 대전청)에서 처음 나왔는데 요약이 그 말을 빼도 검사가 못 잡았다 → 종류 「해제 예고」로 꼭 싣게 한다.
const LIFT = /해제\s*예고/;
const LIFT_PAREN = /\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g;   // 괄호 한 덩어리(세 겹까지)
/**
 * 바다 글 줄들에서 해제 예고를 뽑는다 — 어느 해역(그 말 바로 앞의 해역 이름), 언제(「해제예고:」 뒤, 괄호가 닫히기 전까지).
 * 예: liftNotices(['… 서해중부해상은 당분간(충남앞바다(해제예고: 19일 밤(21~24시))) 바람이 …']) → [{ zone:'충남앞바다', time:'19일밤(21~24시)' }]
 *   시점이 「N일 …」 꼴이 아니거나 너무 길면 time 은 ''(그때는 종류가 있는지와 해역만 본다). 앞에 해역 이름이 없으면 zone 은 ''.
 * @param {string[]} lines @returns {Array<{zone:string, time:string}>} time 은 공백을 걷은 꼴
 * [연계] ← check
 */
function liftNotices(lines) {
    const out = [];
    for (const line of lines) {
        const re = /해제\s*예고\s*[:：,]?\s*((?:[^(),\n]|\([^()\n]*\))*)/g;
        for (let m; (m = re.exec(line));) {
            let before = line.slice(0, m.index).replace(/[(（,\s]+$/, '');
            for (let k = 0; k < 4 && /\([^()]*\)$/.test(before); k++) before = before.replace(/\([^()]*\)$/, '').trim();   // 「A(○○ 제외)(해제예고 …)」의 A
            const toks = zoneTokens(before), time = bare(m[1]);
            out.push({ zone: toks.length ? toks[toks.length - 1] : '', time: /^(?:[가-힣]{2,3}\()?(?:\d{1,2}월)?\d{1,2}일/.test(time) && time.length <= 30 ? time : '' });   // 「19일 밤(…)」「오늘(19일) 밤(…)」
        }
    }
    return out;
}

/** 견주기 쉽게: 색 표시·공백을 걷고 물결표 꼴을 하나로. 예: bare('9 ∼ 18m/s') → '9~18m/s' */
const bare = (s) => String(s || '').replace(/\{\{(?:loc|num|warn):([^{}]*)\}\}/g, '$1').replace(/[∼〜～]/g, '~').replace(/\s+/g, '');
const hangul = (s) => String(s || '').match(/[가-힣]{2,}/g) || [];
/** 글 안의 숫자 덩어리가 모두 원문에 (다른 숫자의 일부가 아닌 채로) 있는가. 예: digitsIn('21일 9~18', '…모레(21일)…9~18m/s') → true */
function digitsIn(text, src) {
    return (String(text || '').match(/\d+(?:\.\d+)?/g) || []).every((n) => new RegExp('(?<![\\d.])' + n.replace('.', '\\.') + '(?![\\d]|\\.\\d)').test(src));
}

/**
 * 지방청 전망 본문에서 바다 항목을 뽑는다(규칙). 항목 = 「○ (이름) …」 한 줄과 그 밑에 딸린 줄(- 한편 … · o … · * … · ※ …).
 * 예: extractSeaItems('<유의 사항>\n○ (강풍) …\n○ (해상) 서해중부해상은 바람이 …\n- 한편, …\n○ (너울) …') → [{ label:'해상', lines:['○ (해상) …','- 한편, …'] }, { label:'너울', lines:['○ (너울) …'] }]
 *   이름이 없는 항목도 머리(<해상> 등)가 바다 이름이면 넣는다(조사: 「<해상> / 이름 없음」 19건). 이름 붙은 항목 밖의 「해역 + 바람·물결 숫자」 줄도 한 줄짜리 항목으로 넣는다.
 *   ⚠못 뽑는 것: 숫자 없이 「해상에는 물결이 높게 일겠습니다」만 <중점 사항> 등에 적힌 글(조사 3,954편 중 7편) — 그 글은 「바다 얘기 없음」으로 나간다.
 * @param {string} rawText 통보문 본문 @returns {Array<{label:string, sec:string, lines:string[]}>} 없으면 빈 배열
 * [연계] ← summarize · trial / 검사 test_regional_sea_summary
 */
function extractSeaItems(rawText) {
    const items = [];
    let sec = '', cur = null;
    for (const raw of String(rawText || '').split('\n')) {
        const l = raw.trim();
        if (!l) continue;
        const h = l.match(/^<\s*([^<>]{1,40}?)\s*>$/);
        if (h) { sec = h[1]; cur = null; continue; }
        // 이름은 괄호가 한 겹 겹쳐도 읽는다(「○ (8일(수)~9일(목) 해상 날씨)」 — 조사 15편). 「- (해상) …」처럼 줄표로 시작하는 바다 이름 줄도 새 항목으로 친다(2편).
        const m = l.match(/^[○◯]\s*\(((?:[^()]|\([^()]*\)){1,40})\)/), dash = l.match(/^[-*]\s*\(((?:[^()]|\([^()]*\)){1,40})\)/);
        if (/^[○◯]/.test(l) || (dash && SEA_LABEL.test(dash[1]))) {
            cur = { label: m ? m[1].trim() : dash ? dash[1].trim() : '', sec, lines: [l] };
            items.push(cur);
        } else if (cur) cur.lines.push(l);
    }
    // 특보·예비특보 현황의 이름 없는 줄(「○ 풍랑주의보: …」)은 넣지 않는다 — 특보 카드가 이미 보인다
    const sea = items.filter((i) => (i.label ? SEA_LABEL.test(i.label) : SEA_LABEL.test(i.sec) && !/특보/.test(i.sec)));
    // 이름 붙은 바다 항목 밖에 있는 「해역 + 바람·물결 숫자」 줄도 넣는다(조사: 「설 연휴기간 전망 / 유의 사항」의 「- 한편 … 동해중부해상에 바람이 9~16m/s …」 45줄 등 —
    //   이런 줄만 있는 글 14편이 「바다 얘기 없음」으로 나갈 뻔했다. 별도 에이전트 검토 2026-11-19). 기압계 설명·특보 목록 줄은 아니다.
    const got = new Set(sea.reduce((a, i) => a.concat(i.lines), []));
    sec = '';
    for (const raw of String(rawText || '').split('\n')) {
        const l = raw.trim();
        const h = l.match(/^<\s*([^<>]{1,40}?)\s*>$/);
        if (h) { sec = h[1]; continue; }
        if (!l || got.has(l) || /기압계/.test(sec) || /^[○◯]\s*[가-힣 ]*(?:주의보|경보|예비특보)[^:]{0,30}:/.test(l)) continue;
        if (/먼바다|앞바다|연안바다|해상/.test(l) && /\d\s*m\/s|물결[이은가]?\s*(?:최대\s*)?\d/.test(l)) { sea.push({ label: '', sec, lines: [l] }); got.add(l); }
    }
    return sea;
}

/**
 * AI 에게 줄 지시문. 바다 항목만 준다(글 전체를 주지 않는다 — 뭍 얘기가 섞여 들어가지 않게, 답이 빨리 오게).
 * @param {string} seaText 바다 항목 글(extractSeaItems 의 줄들을 이어 붙인 것) @returns {string}
 * [연계] ← summarize
 */
const PROMPT = (seaText) => `너는 기상청 지방청 날씨해설의 「바다」 부분을 짧게 정리한다. 아래 글에 적힌 것만 쓴다. 글에 없는 해역·숫자·시점을 만들지 않는다.

## 출력(JSON 만, 설명 금지)
{
  "zones": [{ "zone": "해역 이름", "period": "기간", "wind": "9~18" 또는 null, "wave": "1.5~4.0" 또는 null }],
  "notes": [{ "kind": "종류", "text": "한 줄" }]
}

## zones — 바람(m/s)이나 물결(m) 숫자가 적힌 해역만
- 숫자가 없는 해역은 zones 에 쓰지 않는다(wind 와 wave 가 둘 다 null 인 줄을 만들지 않는다). 그런 얘기는 notes 에 쓴다.
- 숫자가 적힌 문장의 해역은 하나도 빼지 않는다. 한 문장에서 여러 해역이 같은 숫자를 함께 쓰면(「A는 내일까지, B는 당분간 바람이 …」) 그 숫자를 A·B 모두에 적는다.
- 한 줄 = 한 해역(묶음) × 한 기간. 기간과 숫자가 같은 해역들은 " · " 로 이어 한 줄에 쓴다. 같은 해역이 기간별로 숫자가 다르면 줄을 나눈다.
  기간이 서로 다른 해역은 숫자가 같아도 한 줄에 묶지 않는다. period 칸에는 기간을 하나만 쓴다(" · " 로 둘을 잇지 않는다).
  예) 「A에 풍랑특보가 발효된 가운데, B는 내일(21일) 오전까지, C는 오늘(20일) 오후까지 바람이 25~60km/h(7~16m/s) … 물결이 1.0~3.5m」
      → {"zone":"B","period":"~내일(21일) 오전","wind":"7~16","wave":"1.0~3.5"}, {"zone":"C","period":"~오늘(20일) 오후","wind":"7~16","wave":"1.0~3.5"}
      (A 는 특보가 걸린 넓은 범위를 알리는 말이라 줄로 쓰지 않는다. 숫자는 B·C 것이다.)
- zone: 글에 적힌 이름 그대로(「(○○ 제외)」도 그대로). 줄이거나 풀어 쓰지 않는다.
- 「(해제예고: …)」 괄호는 zone·period 에 넣지 않는다. notes 의 "해제 예고" 로 쓴다.
- period: 글의 시점을 짧게. 「…까지」는 "~모레(21일) 오전", 「…부터」는 "내일(20일) 새벽~", 하루면 "오늘(19일)", 「당분간」은 "당분간". 날짜 괄호는 글에 있을 때만 쓴다.
- wind: 괄호 안 m/s 값만. "30~65km/h(9~18m/s)" → "9~18". 없으면 null.
- wave: 물결 높이 m 값만. "1.5~4.0m" → "1.5~4.0". 「최대 5.0m 이상」 같은 덧붙임은 zones 에 쓰지 않는다. 없으면 null.

## notes — 그 밖의 바다 얘기, 종류마다 한 줄
- kind 는 다음 중에서만: "특보 가능성", "해제 예고", "천둥·번개", "너울", "바다 안개", "조고", "이안류", "기상해일", "폭풍해일". 글에 없는 종류는 쓰지 않는다.
  · "특보 가능성" = 풍랑특보·풍랑경보·태풍특보가 발표되거나 변경·연장될 「가능성」이 있다고 글에 적혀 있을 때만. 한 줄에 「가능성」이라는 말을 그대로 쓴다.
    특보가 「발효 중」「발표된」이라는 말은 쓰지 않는다(이미 다른 화면에 있다).
  · "해제 예고" = 글에 「해제예고」(「해제 예고」)가 적혀 있으면 반드시 쓴다. 해역 이름 바로 뒤에 글의 시점을 한 글자도 바꾸지 않고 적는다: "{{loc:충남앞바다}} 19일 밤(21~24시)".
    여러 곳이면 " · " 로 잇고, 해역마다 제 시점을 바로 뒤에 적는다(해역과 시점 사이에 다른 말을 넣지 않는다). 해역 이름은 괄호 곁말(「(○○ 제외)」) 없이 이름만 쓴다.
    해제 예고가 붙지 않은 해역(그 괄호를 품은 더 넓은 해역 포함)과 해제 시점이 아닌 숫자(바람·물결)는 이 줄에 쓰지 않는다.
- text: 언제·어디·무엇을 60자 안팎으로. 「~하기 바랍니다」 같은 당부는 뺀다. 같은 종류가 여러 번 나오면 " · " 로 이어 한 줄로.
- text 안의 해역·지역 이름은 {{loc:이름}}, 숫자와 단위는 {{num:1.5~3.0m}}, 위험 표현은 {{warn:풍랑경보 변경 가능성}} 으로 감싼다(겹치지 않게).
  표시는 loc·num·warn 세 가지뿐이다(다른 이름의 표시를 만들지 않는다). 날짜·시점(「모레(21일)까지」)과 숫자가 없는 말은 num 으로 감싸지 않는다.

## 글
${seaText}`;

// 줄(색 표시·공백을 걷은 것)에 그 값이 있는가 — 바람은 「9~18m/s」, 물결은 「1.5~4.0m」 꼴. 다른 숫자의 일부이거나 「최대 5.0m 이상」처럼 「최대」가 붙은 물결 값은 치지 않는다.
const esc = (v) => String(v).replace(/\./g, '\\.');
const windIn = (t, w) => new RegExp('(?<![\\d.~])' + esc(w) + 'm/s').test(t);
const waveIn = (t, v) => new RegExp('(?<![\\d.~]|최대)' + esc(v) + 'm(?!/)').test(t);
const lineHasWind = (t) => /\dm\/s/.test(t);
const lineHasWave = (t) => /물결[^.]{0,10}?(?<![\d.~]|최대)\d+(?:\.\d+)?(?:~\d+(?:\.\d+)?)?m(?!\/)/.test(t);
/**
 * 그 해역 줄의 숫자가 놓인 원문 줄들 — 이름(괄호 밖)이 모두 그 줄에 있고, 적은 숫자는 그 줄에 있고, **안 적은 숫자는 그 줄에 없어야** 한다
 * (실제 Gemma 답: 「A는 …까지, B와 C는 …까지 바람이 9~16m/s, 물결이 1.5~4.0m」에서 A 의 바람을 null 로 적음 — 그 줄에 바람이 있으니 틀린 답).
 * @param {{zone:string, wind:string|null, wave:string|null}} z @param {string[]} rows 줄들(bare) @param {function(string, string): boolean} named 이름 덩어리가 그 줄에 있는가
 * @returns {string[]} [연계] ← trim(기간 손보기) · check
 */
function linesOf(z, rows, named) {
    let open = String(z.zone); for (let k = 0; k < 6 && /\([^()]*\)/.test(open); k++) open = open.replace(/\([^()]*\)/g, ' ');   // 「(○○ 제외)」「(해제예고 …)」 같은 곁말은 빼고
    const runs = hangul(open);
    return rows.filter((t) => runs.length > 0 && runs.every((r) => named(r, t)) && (z.wind == null ? !lineHasWind(t) : windIn(t, z.wind)) && (z.wave == null ? !lineHasWave(t) : waveIn(t, z.wave)));
}

/**
 * AI 답의 겉꼴만 고른다(뜻은 건드리지 않는다) — 그대로 두면 멀쩡한 답이 꼴 때문에 버려진다.
 *   종류 이름의 점·띄어쓰기(「천둥.번개」「천둥번개」 → 「천둥·번개」) · 숫자 칸에 붙은 단위(「9~18m/s」 → 「9~18」)·물결표 꼴 · 같은 종류 두 줄은 " · " 로 한 줄 ·
 *   색 표시: 없는 이름의 표시와 단위 붙은 숫자가 아닌 num 은 벗긴다(글자는 그대로 — 실제 Gemma 답에 `{{period:…}}` `{{num:천둥·번개}}` 가 있었다).
 * 예: normalize({ zones:[{ zone:'A', period:'오늘', wind:'9~18m/s', wave:2.5 }], notes:[{ kind:'천둥.번개', text:'a' }, { kind:'천둥번개', text:'b' }] })
 *     → { zones:[{ zone:'A', period:'오늘', wind:'9~18', wave:'2.5' }], notes:[{ kind:'천둥·번개', text:'a · b' }] }
 * @param {any} p @returns {any} 객체가 아니면 그대로
 * [연계] ← check · summarize
 */
function normalize(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p) || !Array.isArray(p.zones) || !Array.isArray(p.notes)) return p;
    const key = (k) => String(k || '').replace(/[\s.·ㆍ‧]/g, '');
    const kindOf = (k) => Object.keys(KINDS).find((x) => key(x) === key(k)) || k;
    const num = (v) => (v == null || v === '' ? null : String(v).replace(/[∼〜～]/g, '~').replace(/\s+/g, '').replace(/(?:m\/s|m)$/i, ''));
    const txt = (v) => (typeof v === 'string' ? v.trim() : v);
    // 색 표시 손보기(색만 벗긴다 — 글자는 그대로): 없는 이름의 표시(`{{period:…}}`)는 벗기고, 단위 붙은 숫자가 아닌 num(`{{num:천둥·번개}}` `{{num:모레(21일)까지}}`)도 벗긴다
    const tags = (v) => (typeof v !== 'string' ? v : v.replace(/\{\{([a-zA-Z가-힣_]+):([^{}]*)\}\}/g, (m, k, c) => (k === 'loc' || k === 'warn' ? m : k === 'num' && /\d\s*(?:m\/s|km\/h|mm|cm|m|℃|%)/.test(c) ? m : c)).trim());
    const zones = p.zones.map((z) => (z && typeof z === 'object' ? { zone: txt(z.zone), period: txt(z.period), wind: num(z.wind), wave: num(z.wave) } : z));
    const notes = [];
    for (const n of p.notes) {
        if (!n || typeof n !== 'object') { notes.push(n); continue; }
        const kind = kindOf(n.kind), prev = notes.find((x) => x && x.kind === kind);
        if (prev && typeof prev.text === 'string' && typeof n.text === 'string') prev.text += ' · ' + tags(n.text);
        else notes.push({ kind, text: tags(n.text) });
    }
    return { zones, notes };
}

/**
 * 글이 받쳐 주지 않는 군더더기를 버린다(버려도 틀린 답이 맞는 답이 되지는 않는 것만 — 빠뜨림은 뒤에서 check 가 따로 본다).
 *   ①숫자가 없는 해역 줄(wind·wave 둘 다 없음) ②그 종류의 낱말이 바다 글에 없는 한 줄 ③「가능성」이라는 말이 없는 「특보 가능성」 줄(실제 Gemma 답: 「풍랑특보 발효 중」)
 *   ④해역·기간 칸에 딸려 온 「(…해제예고…)」 괄호(그 말은 「해제 예고」 한 줄로 따로 실린다)
 *   그리고 기간을 원문대로 고친다: 원문에서 그 시점 바로 뒤가 늘 「까지」(또는 「부터」)인데 답이 그 말을 뺐으면 붙인다
 *   (실제 Gemma 답: 원문 「모레(21일) 오전까지」 → 답 「모레(21일) 오전」 — 「그때까지」가 「그때」로 읽힌다).
 * 예: trim({ zones:[{ zone:'A', period:'당분간', wind:null, wave:null }], notes:[{ kind:'너울', text:'…' }] }, items) → { p:{ zones:[], notes:[] }, dropped:['해역 줄(숫자 없음): A', '한 줄(글에 없는 종류): 너울'] }
 * @param {any} p normalize 를 거친 답 @param {Array} items extractSeaItems 결과 @returns {{p:any, dropped:string[]}} dropped = 버리거나 고친 것(관리자 「시험 요약」에 보인다). 객체가 아니면 그대로
 * [연계] ← check · summarize
 */
function trim(p, items) {
    const dropped = [];
    if (!p || typeof p !== 'object' || Array.isArray(p) || !Array.isArray(p.zones) || !Array.isArray(p.notes)) return { p, dropped };
    const all = items.map((i) => bare(i.lines.join('\n'))).join('\n');
    const zones = p.zones.filter((z) => { if (z && typeof z === 'object' && z.wind == null && z.wave == null) { dropped.push('해역 줄(숫자 없음): ' + z.zone); return false; } return true; });
    // 해역·기간 칸에 딸려 온 「(…해제예고…)」 괄호는 뺀다 — 그 말은 「해제 예고」 한 줄로 따로 실려야 하고(없으면 check 가 거절), 칸에 남으면 이름이 한 줄을 넘긴다
    //   (실제 Gemma 답 2026-11-19: zone 「서해중부해상(충남앞바다(해제예고: 19일 밤(21~24시)))」).
    for (const z of zones) {
        if (!z || typeof z !== 'object') continue;
        for (const k of ['zone', 'period']) {
            if (typeof z[k] !== 'string' || !LIFT.test(z[k])) continue;
            const cut = z[k].replace(LIFT_PAREN, (m) => (LIFT.test(m) ? '' : m)).trim();
            if (cut !== z[k]) { dropped.push('해역·기간 칸의 해제 예고 곁말을 뺌: ' + z[k].slice(0, 60)); z[k] = cut; }
        }
    }
    const notes = p.notes.filter((n) => {
        if (!n || typeof n !== 'object' || !Object.prototype.hasOwnProperty.call(KINDS, n.kind)) return true;   // 꼴이 틀린 것은 check 가 걸러 낸다
        if (!KINDS[n.kind].test(all)) { dropped.push('한 줄(글에 없는 종류): ' + n.kind); return false; }
        if (n.kind === '특보 가능성' && typeof n.text === 'string' && !/가능성/.test(n.text)) { dropped.push('한 줄(「가능성」이 없는 특보 가능성): ' + n.text.slice(0, 40)); return false; }
        return true;
    });
    const rows = items.reduce((a, i) => a.concat(i.lines.map(bare)), []);
    const toks = zoneTokens(items.reduce((a, i) => a.concat(i.lines), []).join('\n'));
    const nd = (x) => String(x).replace(/\./g, '');
    const near = (r, t) => nd(t).includes(nd(r)) || toks.some((T) => nd(r).endsWith(T) && nd(t).includes(T));
    for (const z of zones) {
        if (!z || typeof z !== 'object' || typeof z.zone !== 'string' || typeof z.period !== 'string') continue;
        const core = bare(z.period).replace(/^~+|~+$/g, '').replace(/(?:까지|부터)$/, '');
        if (!core) continue;
        const next = new Set();
        for (const t of linesOf(z, rows, near)) for (let i = t.indexOf(core); i >= 0; i = t.indexOf(core, i + 1)) next.add(t.substr(i + core.length, 2));
        if (next.size !== 1) continue;
        const f = [...next][0];
        if (f === '까지' && !/^~|까지/.test(z.period)) { z.period = z.period.trim() + '까지'; dropped.push('기간에 「까지」를 붙임: ' + z.zone + ' ' + z.period); }
        else if (f === '부터' && !/~$|부터/.test(z.period)) { z.period = z.period.trim() + '부터'; dropped.push('기간에 「부터」를 붙임: ' + z.zone + ' ' + z.period); }
    }
    return { p: { zones, notes }, dropped };
}

/**
 * AI 답이 원문과 맞는지 본다. 맞으면 ''(빈 글), 아니면 걸린 까닭 한 줄.
 * 예: check({ zones:[{ zone:'동해중부먼바다', period:'~글피(22일) 오전', wind:'8~20', wave:'1.5~4.0' }], notes:[] }, items) → '' / wave 를 '1.5~9.0' 으로 고치면 '물결 숫자가 글에 없다: …'
 *   보는 것(겉꼴을 고른 뒤 — normalize): ①칸 꼴 ②해역 이름의 한글이 모두 바다 글에 있다(글의 다른 곳에 온전한 이름이 있고 바다 글의 해역 낱말 하나가 통째로 그 끝이면 풀어 쓴 이름도 받는다 — 「남쪽안쪽먼바다」→「제주도남쪽안쪽먼바다」) ③바람·물결 숫자가 글에 「9~18m/s」「1.5~4.0m」 꼴로 있다(「최대 5.0m 이상」의 5.0 은 물결 값으로 안 친다) ④그 해역·숫자가 같은 줄(○ 줄이나 「- 한편 …」 줄 하나) 안에 함께 있고, 그 줄에 적힌 바람·물결을 빼고 적지 않았다 — ⚠한 줄 안에서 오늘·내일 숫자를 서로 바꿔 적은 것은 못 잡는다
 *            ⑤기간의 숫자와 날을 가리키는 말(오늘·내일·모레…)이 그 줄에 있다 ⑥종류는 정해진 것만, 그 종류의 낱말이 글에 있다
 *            ⑦한 줄 글의 숫자·해역 이름({{loc}} 안팎)이 글에 있다 · 뜻을 뒤집거나 부풀리는 낱말(없음·안전·금지·경보·태풍 …)은 글에 있을 때만 · 색 표시 꼴이 온전하다
 *            ⑧빠뜨림: 숫자가 적힌 해상 항목이 있는데 zones 가 비었다 / 글에 있는 종류(너울·조고·안개·이안류·해일·천둥·특보 가능성·해제 예고)의 한 줄이 없다 /
 *              바람 숫자(m/s)가 적힌 줄의 해역(괄호 밖)이 그 줄의 숫자를 단 해역 줄로 없다(실제 Gemma 답: 「A는 내일까지, B는 당분간 바람이 …」에서 A 를 숫자 없이 적음)
 *            ⑨해제 예고(2026-11-19): 글의 「A(해제예고: T)」마다 한 줄에 A 바로 뒤 T 가 글 그대로 있다 · 그 짝과 군말(풍랑특보·해제 예고) 말고는 그 줄에 아무것도 못 쓴다 ·
 *              해역이나 시점을 못 읽은 해제 예고가 있으면 요약하지 않는다 · 해역·기간 칸에는 못 넣는다
 * @param {any} p AI 답(꺼낸 JSON) @param {Array<{label:string, lines:string[]}>} items extractSeaItems 결과 @param {string} [rawText] 글 전체(풀어 쓴 해역 이름을 확인할 때만 쓴다)
 * @returns {string}
 * [연계] ← summarize(bulletin_ai.call 의 accept) / 검사 test_regional_sea_summary
 */
function check(p, items, rawText) {
    p = trim(normalize(p), items).p;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return '답이 객체가 아니다';
    const zones = p.zones, notes = p.notes;
    if (!Array.isArray(zones) || !Array.isArray(notes)) return 'zones·notes 가 배열이 아니다';
    if (!zones.length && !notes.length) return '바다 항목이 있는데 답이 비었다';
    if (zones.length > 16 || notes.length > 8) return '줄이 너무 많다';
    const per = items.map((i) => bare(i.lines.join('\n')));
    const all = per.join('\n'), whole = bare(rawText);
    const rows = items.reduce((a, i) => a.concat(i.lines.map(bare)), []);   // 줄 하나하나 — 해역과 숫자가 같은 줄(문장)에 있는지 볼 때
    const lifts = liftNotices(items.reduce((a, i) => a.concat(i.lines), []));
    // 이름 한 덩어리가 글에 있는가 — 바다 글에 그대로 있거나, 글 전체에 있고 바다 글의 **해역 낱말 하나가 통째로** 그 이름의 끝이다(「남쪽안쪽먼바다」→「제주도남쪽안쪽먼바다」).
    //   끝 몇 글자만 맞으면 받던 것을 고쳤다 — 「강원북부앞바다」가 바다 글의 「강원남부앞바다」 속 「부앞바다」로 통과했다(검토: 글 다른 곳에만 있는 형제 해역을 덧붙인 답 1,193개 중 354개 통과).
    const toks = zoneTokens(items.reduce((a, i) => a.concat(i.lines), []).join('\n'));
    //   가운뎃점 자리의 마침표(「인천.경기앞바다」)는 빼고 견준다.
    const nd = (x) => String(x).replace(/\./g, '');
    const named = (r, t) => nd(t).includes(nd(r)) || (nd(whole).includes(nd(r)) && toks.some((T) => nd(r).endsWith(T) && nd(t).includes(T)));
    const str = (v, max) => typeof v === 'string' && !!v.trim() && v.length <= max;
    for (const z of zones) {
        if (!z || typeof z !== 'object') return '해역 줄이 객체가 아니다';
        if (!str(z.zone, 160)) return '해역 이름이 없거나 너무 길다';
        if (!str(z.period, 40)) return '기간이 없다: ' + z.zone;
        if (/\{\{|\}\}/.test(z.zone + z.period)) return '해역·기간 칸에 색 표시가 들어 있다: ' + z.zone;
        // 한 줄 = 한 기간. 해역 둘을 한 줄에 묶고 기간도 둘을 이어 적으면 어느 기간이 어느 해역 것인지 화면에서 알 수 없다(실제 Gemma 답 2026-11-20: 「서해중부먼바다 · 인천·경기앞바다 | 내일(21일) 오전까지 · 오늘(20일) 오후까지」)
        if (/[·ㆍ‧,\/]/.test(z.period)) return '기간 칸에 기간이 둘 이상이다(해역마다 줄을 나눠야 한다): ' + z.period;
        if (LIFT.test(z.zone + z.period)) return '해역·기간 칸에 해제 예고가 들어 있다: ' + z.zone;
        const wind = z.wind, wave = z.wave;
        if (wind === null && wave === null) return '바람·물결 숫자가 둘 다 없다: ' + z.zone;
        if (wind !== null && !NUM.test(wind)) return '바람 숫자 꼴이 아니다: ' + wind;
        if (wave !== null && !NUM.test(wave)) return '물결 숫자 꼴이 아니다: ' + wave;
        const runs = hangul(z.zone);
        if (!runs.length || !runs.every((r) => named(r, all))) return '해역 이름이 글에 없다: ' + z.zone;
        if (wind !== null && !windIn(all, wind)) return '바람 숫자가 글에 없다: ' + z.zone + ' ' + wind;
        if (wave !== null && !waveIn(all, wave)) return '물결 숫자가 글에 없다: ' + z.zone + ' ' + wave;
        const at = linesOf(z, rows, named);
        if (!at.length) return '해역과 숫자가 같은 줄에 함께 있지 않다(그 줄에 적힌 숫자를 빼고 적었어도 여기 걸린다): ' + z.zone;
        // 기간: 숫자와 날을 가리키는 말(오늘·내일·모레…)은 그 줄에 있어야 한다. 나머지 낱말은 정해 둔 것이거나 그 줄에 있다.
        if (!at.some((t) => digitsIn(z.period, t))) return '기간의 숫자가 글에 없다: ' + z.period;
        if (!at.some((t) => hangul(z.period).every((r) => (PERIOD_WORDS.includes(r) || t.includes(r)) && (!DAY_WORDS.some((d) => r.includes(d)) || t.includes(r))))) return '기간의 낱말이 글에 없다: ' + z.period;
    }
    for (const n of notes) {
        if (!n || typeof n !== 'object') return '한 줄이 객체가 아니다';
        if (!Object.prototype.hasOwnProperty.call(KINDS, n.kind)) return '모르는 종류: ' + n.kind;
        if (!KINDS[n.kind].test(all)) return '글에 없는 종류: ' + n.kind;
        if (!str(n.text, 240)) return '한 줄 글이 없거나 너무 길다: ' + n.kind;
        if (/\{\{|\}\}/.test(n.text.replace(/\{\{(?:loc|num|warn):[^{}]*\}\}/g, ''))) return '색 표시 꼴이 깨졌다: ' + n.kind;
        if (!digitsIn(bare(n.text), all)) return '한 줄의 숫자가 글에 없다: ' + n.kind;
        for (const m of n.text.matchAll(/\{\{loc:([^{}]*)\}\}/g)) if (!hangul(m[1]).every((r) => named(r, all))) return '한 줄의 지역 이름이 글에 없다: ' + m[1];
        // 색 표시로 안 감싼 해역 이름도 본다 · 뜻을 뒤집거나 부풀리는 낱말은 글에 있을 때만(검토: 「…가능성은 없음, 해상은 안전하겠음」「출항 금지 가능성」이 1,073편 전부 통과했다)
        const plain = n.text.replace(/\{\{(?:loc|num|warn):([^{}]*)\}\}/g, '$1');
        for (const t of zoneTokens(plain)) if (!named(t, all)) return '한 줄의 해역 이름이 글에 없다: ' + t;
        const heavy = HEAVY_WORDS.find((w) => plain.includes(w) && !all.includes(w));
        if (heavy) return '한 줄에 글에 없는 말이 있다: ' + heavy;
        // 해제 예고: 글의 해제 예고마다 그 해역 바로 뒤(몇 글자 안)에 그 시점이 글 그대로 있어야 한다 — 빠뜨림·다른 해역의 시점과 바꿔 적음·시점 고쳐 적음을 잡는다.
        //   해제 예고가 없는 해역과 해제 시점이 아닌 숫자는 이 줄에 못 쓴다(「서해중부해상 19일 밤 해제」처럼 넓혀 적지 못하게).
        if (n.kind === '해제 예고') {
            // 읽지 못한 해제 예고(해역이나 시점을 못 뽑음 — 「해제\n예고」처럼 줄이 갈렸거나 시점 꼴이 낯섦)가 있으면 요약하지 않는다(원문 줄이 그대로 나간다).
            //   못 읽은 채 받으면 해역 이름만 맞아도 통과해 틀린 시각이 나간다(검토: 「새벽」→「오전」, 시점 빼기가 통과했다).
            if (!lifts.length || lifts.some((L) => !L.zone || !L.time)) return '글의 해제 예고를 읽지 못했다(해역이나 시점 꼴이 낯설다) — 요약하지 않는다';
            // 이 줄에는 「해역 + 그 시점」 짝과 군말(풍랑특보·해제 예고·시점)만 쓸 수 있다. 짝을 하나씩 지우고 남는 글이 있으면 걸린다 —
            //   빠뜨림·짝 바꾸기·시점 고치기·넓혀 적기·지어낸 짝 덧붙이기·뜻 뒤집는 곁말(「해제 안함」「까지 유지」「아님」)을 한꺼번에 막는다(검토에서 뒤 둘이 통과했다).
            const rx = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            let rest = nd(bare(n.text));
            for (const L of lifts) {
                const re = new RegExp(rx(nd(L.zone)) + '(?:풍랑|특보|해제예고|시점|[:：는은의])*' + rx(nd(L.time)));
                if (!re.test(rest)) return '해제 예고가 빠졌거나 글과 다르다(해역 바로 뒤에 글의 시점 그대로): ' + L.zone + ' ' + L.time;
                rest = rest.replace(re, ' ');
            }
            rest = rest.replace(/풍랑|특보|해제예고|해제|예고|[·,.\s]/g, '');
            if (rest) return '해제 예고 줄에 해역·시점 말고 다른 말이 있다: ' + rest.slice(0, 30);
        }
    }
    // 빠뜨림
    const kinds = new Set(notes.map((n) => n.kind));
    if (!zones.length && items.some((i, k) => /해상|풍랑|물결/.test(i.label || i.sec) && /\d(?:m\/s|m(?!\/|m))/.test(per[k]))) return '숫자가 적힌 해상 항목이 있는데 해역 줄이 없다';
    // 바람 숫자가 적힌 줄(= 전망의 본줄)의 해역은 모두, 그 줄의 숫자를 단 해역 줄로 있어야 한다. 괄호 안(「(○○ 제외)」「(해제예고 …)」「(△△ 최대 5.0m 이상)」)은 곁말이라 안 따진다.
    for (const line of items.reduce((a, i) => a.concat(i.lines), [])) {
        const b = bare(line);
        if (!lineHasWind(b)) continue;
        let open = String(line); for (let k = 0; k < 6 && /\([^()]*\)/.test(open); k++) open = open.replace(/\([^()]*\)/g, ' ');
        // 「X에 풍랑특보가 발효된 가운데, A는 내일까지, B는 오늘까지 바람이 …」 — 앞 절의 X 는 숫자의 임자가 아니라 배경이다(숫자는 뒤의 A·B 것). 뒤에 해역이 또 있으면 앞 절의 해역은 요구하지 않는다.
        //   「X에 풍랑특보가 발효된 가운데, 오늘까지 바람이 …」처럼 뒤에 해역이 없으면 X 가 숫자의 임자 — 종전대로 요구한다.
        //   운영 「시험 요약」 2026-11-20(수도권): 다섯 AI 가 모두 「서해중부먼바다 / 인천.경기앞바다」로 옳게 답했는데 「서해중부전해상」이 없다고 전부 거절했다.
        //   조사 자료: 바람 숫자 줄 3,639 가운데 「…가운데,」 절에 해역이 든 줄 209 — 뒤에 해역이 또 있는 꼴 137.
        const lead = open.match(/^(.*?(?:특보|주의보|경보)[^,]{0,12}가운데)[,\s]/);
        const tail = lead ? open.slice(lead[0].length) : '';
        const names = zoneTokens(lead && zoneTokens(tail).some((t) => !/해안$/.test(t)) ? tail : open).filter((t) => !/해안$/.test(t));
        for (const t of names) {
            const covered = zones.some((z) => {
                const zb = bare(z.zone).replace(/[.·ㆍ‧]/g, '');   // 「인천.경기앞바다」를 「인천·경기앞바다」로 적은 답도 같은 이름으로 본다(실제 Gemma 답 2026-11-20)
                const same = zb.includes(t);
                return same && z.wind != null && windIn(b, z.wind) && (lineHasWave(b) ? z.wave != null && waveIn(b, z.wave) : z.wave == null || waveIn(b, z.wave));
            });
            if (!covered) return '숫자가 적힌 줄의 해역이 해역 줄에 없다: ' + t;
        }
    }
    const must = [['너울', /너울/], ['조고', /조고/], ['바다 안개', /안개/], ['이안류', /이안류/], ['기상해일', /기상해일/], ['폭풍해일', /폭풍해일/]];
    for (const [k, re] of must) if (!kinds.has(k) && items.some((i) => re.test(i.label))) return '글에 있는 종류가 빠졌다: ' + k;
    if (!kinds.has('천둥·번개') && /천둥/.test(all)) return '글에 있는 종류가 빠졌다: 천둥·번개';
    if (!kinds.has('특보 가능성') && /(?:특보|경보|주의보)[^.\n]{0,40}가능성/.test(all)) return '글에 있는 종류가 빠졌다: 특보 가능성';
    if (!kinds.has('해제 예고') && LIFT.test(all)) return '글에 있는 종류가 빠졌다: 해제 예고';
    return '';
}

/**
 * 한 편을 요약한다. 절대 던지지 않는다(수집을 막지 않게).
 * 예: await summarize(rawText) → { state:'ok', zones:[…], notes:[…], by:'gemma', at:'2026-11-19T…' }
 *   바다 항목이 없으면 { state:'none' }(AI 를 부르지 않는다) · AI 가 전부 안 되면 { state:'raw', lines:[뽑은 원문 줄], error:'…' }(다음 수집 때 다시 해 본다)
 * @param {string} rawText 통보문 본문 @param {{call?:function}} [o] call = bulletin_ai.call 대신 끼울 것(검사용)
 * @returns {Promise<{state:'ok'|'none'|'raw', zones?:Array, notes?:Array, lines?:string[], by?:string, error?:string, at:string, tried?:Array, reasons?:string[], dropped?:string[]}>}
 *   reasons = 버려진 답들이 걸린 까닭 · dropped = 쓰인 답에서 버린 군더더기 줄(trim)
 * [연계] ← regional_bulletin_collector.processOneOffice · trial / → services/bulletin_ai.call('seasummary')
 */
async function summarize(rawText, o) {
    const at = new Date().toISOString();
    const items = extractSeaItems(rawText);
    if (!items.length) return { state: 'none', at };
    const lines = items.reduce((a, i) => a.concat(i.lines), []);
    const reasons = [];
    const accept = (p) => { const why = check(p, items, rawText); if (why) reasons.push(why); return !why; };
    let r;
    try { r = await ((o && o.call) || require('./bulletin_ai').call)('seasummary', PROMPT(lines.join('\n')), { caller: 'RegionalSea', accept }); }
    catch (e) { console.warn('[해상 기상 요약] AI 호출 중 예외:', e && e.message); r = { success: false, error: String((e && e.message) || e) }; }
    let p = null;
    let dropped = [];
    //   답은 느슨하게 꺼낸다(bulletin_ai.looseJson — ```json 울타리·뒤에 덧붙인 설명·한 겹 배열). accept 는 그렇게 꺼내 보고 통과시키므로 여기서도 같아야 한다(검토: 옳은 답이 버려졌다).
    if (r.success) { const j = require('./bulletin_ai').looseJson(r.text); if (j === undefined) console.warn('[해상 기상 요약] 답에서 JSON 을 못 꺼냄'); else { const t = trim(normalize(j), items); p = t.p; dropped = t.dropped; } }
    // accept 를 거치지 않고 온 답(끼운 call 이 안 불렀거나 JSON 이 아닌 답)도 여기서 한 번 더 본다
    if (!p || check(p, items, rawText)) {
        const error = r.success ? '답이 원문 대조에 걸림' : String(r.error || '모든 AI 실패').slice(0, 200);
        console.warn('[해상 기상 요약] 요약하지 못해 원문 그대로 둔다 —', error, reasons.length ? '· 걸린 까닭: ' + reasons.join(' / ') : '');
        return { state: 'raw', lines, error, reasons, tried: r.tried || [], at };
    }
    return { state: 'ok', zones: p.zones, notes: p.notes, by: r.provider || '', at, tried: r.tried || [], reasons, dropped };
}

/**
 * 관리자 「시험 요약」 — 그 글을 지금 설정(⑥)대로 요약해 보고, 누가 답했는지·걸린 까닭·걸린 시간을 함께 돌려준다(저장하지 않는다).
 * 예: await trial(rawText) → { ms:5210, seaText:'○ (해상) …', result:{ state:'ok', by:'gemma', zones:[…], notes:[…], tried:[{id:'gemma', ok:true}], reasons:[] } }
 * @param {string} rawText @returns {Promise<{ms:number, seaText:string, result:object}>}
 * [연계] ← routes/bulletin_watch.js POST /api/admin/bulletin-ai/try-sea-summary
 */
async function trial(rawText) {
    const t0 = Date.now();
    const result = await summarize(rawText);
    return { ms: Date.now() - t0, seaText: extractSeaItems(rawText).reduce((a, i) => a.concat(i.lines), []).join('\n'), result };
}

module.exports = { extractSeaItems, normalize, trim, check, summarize, trial, liftNotices, PROMPT, SEA_LABEL, KINDS };
