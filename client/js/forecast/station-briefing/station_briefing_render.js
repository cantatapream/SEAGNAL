/**
 * ============================================================================
 * 파일명: client/js/forecast/station-briefing/station_briefing_render.js
 * 역할  : 「연안 안전 브리핑」(종전 「활동지점 안전 브리핑」) 본문을 그린다 — 서버가 만든 브리핑(총평과 권고 = 서버 결론 + 연안·해상 분석 문단(AI 또는 규칙) + 접힌 「분석 근거」(근거·권고) + (기상)·(물때)
 *         · 특별 상황·해상 시간 막대·해역 카드·연안 카드·조석·기준 시각)을 화면 칸으로 옮긴다(2026-10-17 사용자 결정 「가」 모양 — 설계서 §11.10.4).
 *         아코디언 제목 글 「HH:MM AI 연안 안전 브리핑」(titleText)도 여기서 만든다. 서버 글은 모두 textContent 로만 넣는다(계약서 §5 「화면은 textContent 로만」 — HTML 삽입 금지).
 *         HTML 로 넣는 것은 조석 게이지(해양종합정보 OS.tideGaugeHtml 이 숫자·시각만으로 만든 것)뿐이다.
 *         근거 줄 ▸ 펼침(2026-10-17 §11.10.3): 고립 사고 지점 표 · 관할 해역 미니 지도(해당 칸·대해구 테두리 깜빡임 — 접거나 다시 그리면 멈춤).
 *         §11.10.9: 분석 근거 알약 배지 · 「평소보다 위험이 높아진 곳」 표 · 「{구역} 기상 현황」 머리 · 분석 문단 강조 토막(highlightSegments — span textContent 로만) · 마지막 「따라서 …」 → (권고) 줄
 *                   · 대해구 이름·「관할 해역 선박 N척」·붐비는 해역 링크 → 가운데 팝업 지도(openMapPopup — 서버 summary.sea.haegu·now.cells).
 *         §11.10.10: (물때) 「잠기는 바위(간출암) N곳」 링크 → 팝업 지도(관할 경계 + 그 바위 마커 — 서버 summary.rocks) → 마커를 누르면 해양안전 「위험지형」과 같은 간출암 조석 곡선 상자
 *                   (HazardRockTidePanel — hazard_rocks.js 의 같은 함수) · (고립 주의) 「과거 고립 사고(N개소 M건)」 링크(화살표 없음) → 「지점명 | 발생 현황」 표.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/bottom-sheet/ocean_bottom_sheet3.js(OceanSheet.tideGaugeHtml — 조석 게이지 디자인 그대로)
 *                    · marine-life/risk-forecast/risk_format.js(RiskFormat.BAND_COLORS — 위험예측 4색) · risk_basis.js(RiskBasis.open('briefing') — [기준 상세])
 *                    · style.css(.marine-forecast-sub-accordion·.ocean-tide-*) · station_briefing.css(.sb-*)
 *                    · ol.js(index2 <head> 전역 ol — 미니 지도) · ocean-map/map/ocean_map.js(window.oceanCreateKhoaLayer — 바탕 해아름 바다지도, 관심해역 고르기 지도와 같은 방식, 없으면 선만)
 *                    · marine-life/safety/hazard_rocks.js(window.HazardRockTidePanel — 간출암 조석 곡선 상자·마커 그림, §11.10.10) · index2.html <style>(.hazard-rock-popup.rock-tide-popup 모양)
 *  - 서버 API      : 없음(받은 응답만 그린다 — 받기는 station_briefing.js · admin_station_briefing.js). 간출암 상자는 HazardRockTidePanel 이 /api/hazard-rocks/tide-curve 를 받는다
 *  - 마크업        : index2.html #station-briefing-content(그 안을 통째로 만든다) · 관리자 미리보기 상자
 *  - 나를 쓰는 곳  : station_briefing.js(아코디언 본문) · admin/admin_station_briefing.js(관할 하나 미리보기)
 *  - 계약          : client/js/ocean-map/coastal-risk/briefing.contract.md §1.2·§2
 * [로드 순서] life_safety.js 다음 · station_briefing_basis.js·station_briefing.js 이전
 * ============================================================================
 */
(function (w) {
    'use strict';
    // 단계 4색 = 위험예측 관례(RiskFormat.BAND_COLORS 의 평소 수준·다소 높음·높음·매우 높음 순서 — 초록·노랑·주황·빨강).
    // 브리핑 단계 0 평소 수준 · 1 관심 필요 · 2 주의 필요 · 3 경계 필요 를 순서대로 맞춘다. 확인 불가는 회색.
    var BAND_ORDER = ['평소 수준', '다소 높음', '높음', '매우 높음'], FALLBACK = ['#2fb36b', '#f2c230', '#fb923c', '#e0322c'], GREY = '#64748b';
    var WORDS = ['평소 수준', '관심 필요', '주의 필요', '경계 필요'];
    // 원천 열쇠 → 사람이 읽는 이름(서버 station_briefing_rules.SOURCE_LABEL 과 같은 표 + sources 의 tourConcentration).
    // accident = 「해양사고 위험예보」(2026-10-17 사용자 결정 §11.10.3 — 브리핑 안 이름만, 종전 「공식 사고예보」)
    var SOURCE_LABEL = { accident: '해양사고 위험예보', congestion: '혼잡 예보', zoneForecasts: '해구 예보', warnings: '기상특보', concentration: '관광지 사람 집중률', tourConcentration: '관광지 사람 집중률', hazard: '위험구역', events: '행사', rip: '이안류', gale: '강풍 자료', forecast: '해구 예보', detail: '관광지 상세', swell: '너울' };
    // 판 이름 — 정시 판은 그 판의 시각(editionTime — 07:30·17:30·23:00, 2026-10-17 §11.10.4 전에 만든 판은 만든 시각 08:00 등) + 「판」, 나머지는 이 표.
    var EDITION = { night: '판(오늘 밤~내일)', warning: '특보 변경 판', manual: '관리자 즉시 실행 판' }, SCHEDULED = { morning: 1, evening: 1, night: 1 };
    /**
     * 판 시각 「HH:MM」 — 정시 판은 공개 시각(publishAt — 07:30·17:30·23:00), 특보 변경·관리자 판은 만든 시각(generatedAt).
     * publishAt 이 없는 옛 판(§11.10.4 전)은 만든 시각 — 그때는 만든 시각이 곧 판 시각(08:00·17:30·23:00)이었다.
     * 예: {edition:'morning',publishAt:'…T07:30:00+09:00',generatedAt:'…T07:10:05+09:00'} → '07:30' · {edition:'warning',generatedAt:'…T13:12:40+09:00'} → '13:12' · null → ''
     * @param {Object} b - briefing @returns {string} [연계] ← titleText·editionLabel·subtitleText(editionIso 를 같이 쓴다 — 제목과 머리 글의 시각이 어긋나지 않게)
     */
    function editionTime(b) { var m = /T(\d{2}):(\d{2})/.exec(editionIso(b)); return m ? m[1] + ':' + m[2] : ''; }
    /** 판 시각을 정하는 ISO 한 곳(제목·머리 글 공용). 예: 정시 판 → publishAt · 특보·관리자·옛 판 → generatedAt · null → ''. @param {Object} b @returns {string} [연계] ← editionTime·subtitleText */
    function editionIso(b) { return String((b && SCHEDULED[b.edition] && b.publishAt ? b.publishAt : b && b.generatedAt) || ''); }
    /**
     * 본문 머리 글 — 2026-10-17 사용자 결정(설계서 §11.10.9 ⑦) 원문 *"10월 17일 몇시 브리핑, 몇시 기준 브리핑 이렇게 나왔으면 좋겠고 관리자 즉시 실행판이라고 그런 종류를 써놓을 필요는 없을 것 같아 그리고 몇 시에 생성됐는지도 적힐 필요 없을 것 같아
     * 단 그 오른쪽에 괄호로서 다음 브리핑 갱신 시점 몇 시 … 또는 특보 변경 시 라고 하고 괄호를 닫았으면 좋겠거든."*
     * 날짜·시각 = 제목 「HH:MM AI 연안 안전 브리핑」과 같은 판 시각(editionIso). 다음 갱신 = 서버 nextPublishAt(다음 정시 판 공개 시각) — 오늘이 아니면 「내일 HH:MM」. 없으면 괄호 없이.
     * 예: subtitleText({edition:'evening',publishAt:'2026-10-17T17:30:00+09:00'}, '2026-10-17T23:00:00+09:00', 10-17 18:00) → '10월 17일 17:30 기준 브리핑 (다음 브리핑 갱신 23:00 또는 특보 변경 시)'
     *     밤 23:05 · next '2026-10-18T07:30…' → '… (다음 브리핑 갱신 내일 07:30 또는 특보 변경 시)'
     * @param {Object} b @param {string} [nextIso] - resp.nextPublishAt @param {number} nowMs @returns {string} [연계] ← render(.sb-edition)
     */
    function subtitleText(b, nextIso, nowMs) {
        var iso = editionIso(b), d = /^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso), n = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(String(nextIso || ''));
        var head = d ? (+d[1]) + '월 ' + (+d[2]) + '일 ' + d[3] + ':' + d[4] + ' 기준 브리핑' : dateText(b && b.targetDate) + ' 브리핑';
        if (!n) return head;
        var today = new Date(nowMs + 9 * 3600000).toISOString().slice(0, 10);
        return head + ' (다음 브리핑 갱신 ' + (n[1] === today ? '' : '내일 ') + n[2] + ':' + n[3] + ' 또는 특보 변경 시)';
    }
    /**
     * 아코디언 제목 — 2026-10-17 사용자 *"연안 안전 브리핑 아코디언을 hh:mm AI 연안 안전 브리핑으로 변경해줘."*. 보이는 판의 시각을 앞에, 판이 없으면 시각 없이.
     * 예: titleText({edition:'morning',publishAt:'2026-10-17T07:30:00+09:00'}) → '07:30 AI 연안 안전 브리핑' · titleText(null) → 'AI 연안 안전 브리핑'
     * @param {Object|null} b @returns {string} [연계] ← station_briefing.js setTitle(#station-briefing-title)
     */
    function titleText(b) { var t = editionTime(b); return (t ? t + ' ' : '') + 'AI 연안 안전 브리핑'; }
    /** 머리·꼬리의 판 이름. 예: 아침 판 → '07:30 판' · 밤 판 → '23:00 판(오늘 밤~내일)' · 특보 → '특보 변경 판'. @param {Object} b @returns {string} [연계] ← renderRest(꼬리 — §11.10.9 ⑦ 부터 머리 글은 subtitleText) */
    function editionLabel(b) { if (!b) return ''; if (SCHEDULED[b.edition]) return editionTime(b) + ' ' + (EDITION[b.edition] || '판'); return EDITION[b.edition] || ''; }
    var DOW = ['일', '월', '화', '수', '목', '금', '토'];
    // 쓰는 자료와 출처 — [기준 상세] 표(station_briefing_basis.js)와 본문 꼬리 「출처」 줄이 이 한 벌을 같이 쓴다(2단계 검토 B10 — 둘이 어긋나 있었다).
    // [자료, 출처, 쓰는 곳]. 출처는 수집기·자료 파일 머리 주석으로 확인한 것만(build_accidents.js 개방海 「선박사고(해경)」·「인명사고」, build_coast_accidents.py 유형·500m·2020~2024,
    // marine_fusion.js 선박사고 최근 5년(자료 마지막 해 2025), coastal_events_collector.js 관광공사+Gemini 보충, scheduler.js 이안류 KHOA+기상청, swell_smallzone.js 기상청 MMIS 너울).
    var SOURCES = [
        ['해양사고 위험예보(선박 사고위험 예보, 3시간)', '한국해양교통안전공단 MTIS', '해상 단계'],
        ['해양교통 혼잡 예보', '한국해양교통안전공단 MTIS', '해상 「충돌·접촉 주의」'],
        ['실시간 선박 교통', '한국해양교통안전공단 MTIS', '「지금 밀집」 한 줄(오늘 브리핑만)'],
        ['해상 특보(풍랑·태풍)·육상 강풍특보·특보 해제 기록', '기상청', '해상·육상 단계, 특별 상황'],
        ['해구별 3시간 예보(파고·풍속)', '기상청', '해상 단계, 「몇 시부터 높아지는지」'],
        ['해상 기상 전망(단기 통보문)', '기상청', '총평을 쓰는 AI 의 원인 참고(그 안의 숫자·지명은 옮기지 않음)'],
        ['조석(고조·저조)·잠기는 바위', '국립해양조사원 조석 예측(앱이 매일 23:30 수집)', '조석 칸'],
        ['관광지 사람 집중률 예측', '한국관광공사', '육상 「사람 평소의 N배」, 연안 위험지수'],
        ['지역 행사', '한국관광공사(+ Gemini 보충 검색)', '육상 「오늘 바뀐 요소」'],
        ['너울 · 이안류', '기상청 · 국립해양조사원', '육상 「오늘 바뀐 요소」'],
        ['연안사고 위험구역', '해양경찰청', '육상 특성, 상시 위험 장소'],
        ['과거 선박사고(2021~2025)', '해양경찰청 선박사고 기록(국립해양조사원 개방海 제공)', '해역 [특성]'],
        ['과거 연안사고 — 연안 인명사고(익수·추락·고립·표류·기타), 관광지 구역 + 앞바다 500m, 2020~2024', '국립해양조사원 개방海 인명사고', '관광지 [특성]'],
    ];

    /**
     * 단계 순위의 색을 고른다(위험예측 4색). 확인 불가(순위 0 이면서 말이 「확인 불가…」)는 회색.
     * 예: colorOf(2) → '#fb923c'(주황) · colorOf(0,'확인 불가(일부)') → '#64748b'
     * @param {number} rank - 0~3 @param {string} [word] - 서버 단계 말 @returns {string} CSS 색
     * [연계] ← chip·timeBar / → RiskFormat.BAND_COLORS(risk_format.js — 지도·연안 상자와 같은 색)
     */
    function colorOf(rank, word) {
        if (typeof word === 'string' && word.indexOf('확인 불가') === 0) return GREY;
        var r = Number(rank); if (!(r >= 0 && r <= 3)) return GREY;
        var bands = w.RiskFormat && w.RiskFormat.BAND_COLORS;
        return (bands && bands[BAND_ORDER[r]]) || FALLBACK[r];
    }
    /**
     * 요소 하나를 만든다 — 글은 textContent 로만.
     * 예: el('p','sb-note','참고 정보') → <p class="sb-note">참고 정보</p>
     * @param {string} tag @param {string} [cls] @param {*} [text] - 문자열로 바꿔 textContent 에 @returns {HTMLElement}
     * [연계] ← 이 파일의 모든 그리기 함수
     */
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined && text !== null) e.textContent = String(text);
        return e;
    }
    /**
     * 단계 배지(색 상자 + 단계 말). 노랑·주황 위에는 어두운 글자. prefix 가 있으면 배지 글 앞에(「연안 주의 필요」 — 2026-10-17 사용자 *"육상 주의 필요가 아니라 연안 주의 필요라고 명시되도록 해줘."*).
     * 예: chip(2,'주의 필요') → <span class="sb-chip" style="background:#fb923c;color:#111">주의 필요</span> · chip(2,'주의 필요','연안') → 「연안 주의 필요」
     * @param {number} rank @param {string} word @param {string} [prefix] @returns {HTMLElement} [연계] ← 총평·카드·분석 머리
     */
    function chip(rank, word, prefix) {
        var c = el('span', 'sb-chip', (prefix ? prefix + ' ' : '') + (word || WORDS[rank] || '—')), bg = colorOf(rank, word);
        c.style.background = bg; c.style.color = bg !== GREY && (Number(rank) === 1 || Number(rank) === 2) ? '#111827' : '#fff';
        c.setAttribute('data-rank', String(rank));
        return c;
    }
    /**
     * KST ISO 시각을 「10월 17일(토) 08:00」으로 쓴다(글자에서 직접 — 기기 시간대와 무관). 모양이 아니면 '—'.
     * 예: kstText('2026-10-17T08:00:00+09:00') → '10월 17일(토) 08:00'
     * @param {string} iso @returns {string} [연계] ← 머리·꼬리·다음 예정
     */
    function kstText(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
        if (!m) return '—';
        var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return (+m[2]) + '월 ' + (+m[3]) + '일(' + DOW[d.getUTCDay()] + ') ' + m[4] + ':' + m[5];
    }
    /** 날짜만. 예: '2026-10-17' → '10월 17일(토)'. @param {string} date @returns {string} [연계] ← 머리 */
    function dateText(date) { var t = kstText(String(date || '') + 'T00:00'); return t === '—' ? '—' : t.slice(0, -6); }
    /** 「오늘/내일」 — 대상 날짜가 만든 날짜보다 뒤면 내일(서버 rules.dayWordOf 와 같은 규칙, 23시 판). 예: {targetDate:'2026-10-18',generatedAt:'2026-10-17T23:00…'} → '내일'. @param {Object} b @returns {string} [연계] ← 육상 빈 칸 문구(B6) */
    function dayWord(b) { return b && b.generatedAt && b.targetDate > String(b.generatedAt).slice(0, 10) ? '내일' : '오늘'; }
    /** 원천 열쇠들을 이름으로. 예: ['congestion','accident'] → '혼잡 예보·공식 사고예보'. @param {string[]} keys @returns {string} [연계] ← 분석 머리 */
    function sourceNames(keys) { var out = []; (keys || []).forEach(function (k) { var n = SOURCE_LABEL[k] || String(k); if (out.indexOf(n) < 0) out.push(n); }); return out.join('·'); }

    /**
     * 접히는 칸 하나(종합 예보의 하위 아코디언과 같은 모양 .marine-forecast-sub-accordion). 머리를 누르면 펼침/접힘.
     * 예: section('총평과 권고', 'overview') → {root, body} — body 에 내용을 붙인다
     * @param {string} title @param {string} key - data-sb-sec(시험·스크린샷이 찾는 이름) @returns {{root:HTMLElement, body:HTMLElement, head:HTMLElement}}
     * [연계] ← render / 모양: style.css .marine-forecast-sub-*(해상 기상 전망 아코디언 안 칸)
     */
    function section(title, key) {
        var root = el('div', 'marine-forecast-sub-accordion open sb-sec'), head = el('div', 'marine-forecast-sub-header'), body = el('div', 'marine-forecast-sub-body sb-sec-body');
        root.setAttribute('data-sb-sec', key);
        head.setAttribute('role', 'button'); head.tabIndex = 0;
        head.appendChild(el('span', 'marine-forecast-sub-title', title));
        var icon = el('i', 'fa-solid fa-chevron-down marine-forecast-sub-icon'); icon.setAttribute('aria-hidden', 'true'); head.appendChild(icon);
        var flip = function () { root.classList.toggle('open'); head.setAttribute('aria-expanded', String(root.classList.contains('open'))); };
        head.setAttribute('aria-expanded', 'true');
        head.addEventListener('click', flip);
        head.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
        root.appendChild(head); root.appendChild(body);
        return { root: root, body: body, head: head };
    }
    /**
     * 「이름표 + 내용」 줄. 예: row('[특성]', '2021~2025년 선박사고 18건…') → <div class="sb-row"><span class="sb-row-k">[특성]</span><span>…</span></div>
     * @param {string} k @param {string|HTMLElement} v @returns {HTMLElement} [연계] ← 카드
     */
    function row(k, v) {
        var r = el('div', 'sb-row'); r.appendChild(el('span', 'sb-row-k', k));
        if (v && v.nodeType) r.appendChild(v); else r.appendChild(el('span', 'sb-row-v', v));
        return r;
    }
    /** 글 목록. 예: list(['15~21시 공식 사고예보 \'주의\'']) → <ul class="sb-list"><li>…</li></ul>. @param {string[]} items @returns {HTMLElement} */
    function list(items) { var u = el('ul', 'sb-list'); (items || []).forEach(function (x) { u.appendChild(el('li', '', x)); }); return u; }

    /**
     * 카드 아래 [위험예측에서 보기 ›] 버튼(§11.4). opts.links 가 거짓(관리자 미리보기)이면 만들지 않는다.
     * 예: linkBtn({kind:'coast',id:'50110|협재해수욕장',date:'2026-10-17'}, opts) → <button class="sb-link">위험예측에서 보기 ›</button>
     * @param {Object} target - RiskForecast.openAt 에 넘길 것 @param {Object} opts - render 옵션(onLink) @returns {HTMLElement|null}
     * [연계] ← seaCard·landCard / → opts.onLink(station_briefing.js openInRisk)
     */
    function linkBtn(target, opts) {
        if (!opts || opts.links === false || typeof opts.onLink !== 'function' || !target) return null;
        var b = el('button', 'sb-link', '위험예측에서 보기 ›'); b.type = 'button';
        b.addEventListener('click', function (e) { e.stopPropagation(); opts.onLink(target, b); });
        return b;
    }
    /**
     * 해역 카드 하나 — 「○○ 방위 N해리 해역(해구)」, 단계·출처 꼬리표, [특성]·[오늘 예상], 틀 문장, 바로가기.
     * 예: seaCard({name:'비양도 북북서방 1.4해리 해역(232-2해구)',rank:2,word:'주의 필요',sourceLabel:"공식 사고예보 '주의'",window:'15~24시',…}, opts)
     * @param {Object} c - briefing.sea.cards[] @param {Object} opts @returns {HTMLElement}
     * [연계] ← render / → linkBtn(GR4 칸 id·좌표·시각)
     */
    function seaCard(c, opts) {
        var card = el('div', 'sb-card'); card.setAttribute('data-sb-card', 'sea');
        var head = el('div', 'sb-card-head'); head.appendChild(el('strong', 'sb-card-name', c.name || '이름 없는 해역')); head.appendChild(chip(c.rank, c.word)); card.appendChild(head);
        var tags = el('div', 'sb-tags');
        if (c.sourceLabel) tags.appendChild(el('span', 'sb-tag', c.sourceLabel));
        if (c.window) tags.appendChild(el('span', 'sb-tag sb-tag-time', c.window));
        if (tags.childNodes.length) card.appendChild(tags);
        if (c.traits && c.traits.text) card.appendChild(row('[특성]', c.traits.text));
        var lines = c.today && Array.isArray(c.today.lines) ? c.today.lines : [];
        if (lines.length) card.appendChild(row('[오늘 예상]', list(lines)));
        if (c.sentence) card.appendChild(el('p', 'sb-sentence', c.sentence));
        var lk = c.link || {}, lon = Number(lk.lon), lat = Number(lk.lat);
        var b = linkBtn(Number.isFinite(lon) && Number.isFinite(lat) ? { kind: 'marine', id: lk.gridId || 'point', location: { lon: lon, lat: lat }, t: lk.t || null } : null, opts);
        if (b) card.appendChild(b);
        return card;
    }
    /**
     * 육상(관광지) 카드 하나 — 이름·단계·출처, [특성]·[오늘 예상](오늘 바뀐 요소), 틀 문장, 일부 자료 확인 불가, 바로가기.
     * 예: landCard({name:'협재해수욕장',rank:2,word:'주의 필요',sourceLabel:"연안 위험지수 72 '높음'",today:{changes:['사람 평소의 1.8배']},…}, opts)
     * @param {Object} c - briefing.land.cards[] @param {Object} opts @returns {HTMLElement}
     * [연계] ← render / → linkBtn(관광지 id·날짜)
     */
    function landCard(c, opts) {
        var card = el('div', 'sb-card'); card.setAttribute('data-sb-card', 'land');
        var head = el('div', 'sb-card-head'); head.appendChild(el('strong', 'sb-card-name', c.name || '이름 없는 장소')); head.appendChild(chip(c.rank, c.word)); card.appendChild(head);
        if (c.sourceLabel) { var tags = el('div', 'sb-tags'); tags.appendChild(el('span', 'sb-tag', c.sourceLabel)); card.appendChild(tags); }
        if (c.traits && c.traits.text) card.appendChild(row('[특성]', c.traits.text));
        var ch = c.today && Array.isArray(c.today.changes) ? c.today.changes : [];
        if (ch.length) card.appendChild(row('[오늘 예상]', list(ch)));
        if (c.sentence) card.appendChild(el('p', 'sb-sentence', c.sentence));
        if (Array.isArray(c.missing) && c.missing.length) card.appendChild(el('p', 'sb-miss', '일부 자료 확인 불가: ' + sourceNames(c.missing)));
        var lk = c.link || {}, lon = Number(lk.lon), lat = Number(lk.lat);
        var b = linkBtn(lk.spotId ? { kind: 'coast', id: lk.spotId, date: lk.date || null, location: Number.isFinite(lon) && Number.isFinite(lat) ? { lon: lon, lat: lat } : null } : null, opts);
        if (b) card.appendChild(b);
        return card;
    }
    /**
     * 해상 시간 막대 — 3시간 칸마다 관할 최고 단계 색, 사건(특보 해제 예고·예비·해제·발효)이 있는 칸에 ⚑. 칸을 누르면 아래 줄에 그 칸 설명.
     * 처음 설명은 사건이 있는 첫 칸, 없으면 가장 높은 단계의 첫 칸.
     * 예: timeBar([{label:'06시',rank:2,word:'주의 필요',region:'…',labels:[…],events:[{kind:'release',text:'…'}]}, …]) → 칸 6개 + 설명 줄 + 범례
     * 보는 시각(nowMs)에 이미 끝난 칸은 흐리게(.sb-slot-past) — 만드는 시각이 든 칸부터 다루므로 열어 볼 때 지난 칸이 섞일 수 있다(2단계 검토 B3).
     * @param {Object[]} slots - briefing.sea.timeBar @param {number} [nowMs] - 지금(ms) @returns {HTMLElement}
     * [연계] ← render(해상 분석)
     */
    function timeBar(slots, nowMs) {
        var wrap = el('div', 'sb-timebar-wrap'), bar = el('div', 'sb-timebar'), detail = el('p', 'sb-slot-detail');
        bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', '해상 시간 막대 — 3시간 칸별 관할 최고 단계');
        detail.setAttribute('aria-live', 'polite');
        var buttons = [];
        /** 칸 하나의 설명을 아래 줄에 쓴다. 예: '06시 · 주의 필요 · 한림항 북동방 5.2해리 해역(232-3해구) · 근거 … · ⚑ …' */
        var show = function (i) {
            var s = slots[i] || {};
            var parts = [s.label || '', s.word || WORDS[s.rank] || ''];
            if (s.region) parts.push(s.region);
            if (Array.isArray(s.labels) && s.labels.length) parts.push('근거 ' + s.labels.join(', '));
            (s.events || []).forEach(function (e) { if (e && e.text) parts.push('⚑ ' + e.text); });
            detail.textContent = parts.filter(Boolean).join(' · ');
            buttons.forEach(function (b, k) { b.setAttribute('aria-pressed', String(k === i)); });
        };
        slots.forEach(function (s, i) {
            var b = el('button', 'sb-slot'); b.type = 'button';
            var bg = colorOf(s.rank, s.word); b.style.background = bg;
            var past = Number.isFinite(nowMs) && Date.parse(s.at) + 3 * 3600000 <= nowMs; if (past) { b.classList.add('sb-slot-past'); b.setAttribute('data-past', 'true'); }
            b.appendChild(el('span', 'sb-slot-h', String(s.label || '').replace(/시$/, '')));
            if (Array.isArray(s.events) && s.events.length) { var f = el('span', 'sb-slot-flag', '⚑'); f.setAttribute('aria-hidden', 'true'); b.appendChild(f); b.setAttribute('data-event', 'true'); }
            b.setAttribute('aria-label', (s.label || '') + ' ' + (s.word || WORDS[s.rank] || '') + (s.events && s.events.length ? ' — 특보 사건 있음' : '') + (past ? ' — 지난 시간' : ''));
            b.setAttribute('data-rank', String(s.rank));
            b.addEventListener('click', function () { show(i); });
            buttons.push(b); bar.appendChild(b);
        });
        wrap.appendChild(bar);
        var legend = el('div', 'sb-legend');
        WORDS.forEach(function (word, r) { var k = el('span', 'sb-legend-k'); var sw = el('i'); sw.style.background = colorOf(r); k.appendChild(sw); k.appendChild(document.createTextNode(word)); legend.appendChild(k); });
        legend.appendChild(el('span', 'sb-legend-k', '⚑ 특보 사건'));
        if (slots.some(function (s) { return Number.isFinite(nowMs) && Date.parse(s.at) + 3 * 3600000 <= nowMs; })) legend.appendChild(el('span', 'sb-legend-k', '흐린 칸 = 이미 지난 시간'));
        wrap.appendChild(legend); wrap.appendChild(detail);
        var first = -1, top = -1;
        slots.forEach(function (s, i) { if (first < 0 && s.events && s.events.length) first = i; if (top < 0 || Number(s.rank) > Number(slots[top].rank)) top = i; });
        if (slots.length) show(first >= 0 ? first : top);
        return wrap;
    }
    /**
     * 조석 칸 — 해양종합정보 바텀시트 조석 게이지 디자인 그대로(OS.tideGaugeHtml) + 서버 문구(밀물·잠기는 바위).
     * 계약 §2.2: peaks {type,t:'HH:MM',cm} → {type, minutes, level}. prevPeak 는 전날 자신의 시각이라 1440 을 빼서 앞날로 민다.
     * 게이지(진행 막대)는 그 날이 오늘(KST)일 때만 — 바텀시트와 같은 규칙. 시각·cm 가 모양에 맞지 않는 피크는 버린다(HTML 에 숫자만 들어가게).
     * 예: tide({date:'2026-10-17',gauge:{peaks:[{type:'low',t:'06:12',cm:-12},…],prevPeak:{type:'high',t:'23:59',cm:600}},text:['06:12 저조 뒤부터 …']}, now)
     * @param {Object} t - briefing.tide @param {number} nowMs - 지금(ms) @param {Object} [b] - briefing(바위 링크 — §11.10.10) @returns {HTMLElement}
     * [연계] ← render / → OceanSheet.tideGaugeHtml(ocean_bottom_sheet3.js buildTideGauge)·rocksLine
     */
    function tide(t, nowMs, b) {
        var box = el('div', 'sb-tide');
        var conv = function (p, shift) {
            var m = p && /^(\d{2}):(\d{2})$/.exec(String(p.t || '')), cm = p ? Number(p.cm) : NaN;
            if (!m || !Number.isFinite(cm) || (p.type !== 'high' && p.type !== 'low')) return null;
            return { type: p.type, minutes: (+m[1]) * 60 + (+m[2]) + (shift || 0), level: cm };
        };
        var g = t.gauge || {}, peaks = (g.peaks || []).map(function (p) { return conv(p, 0); }).filter(Boolean).sort(function (a, b) { return a.minutes - b.minutes; });
        var y = g.prevPeak ? [conv(g.prevPeak, -1440)].filter(Boolean) : [], n = g.nextPeak ? [conv(g.nextPeak, 1440)].filter(Boolean) : [];
        var OS = w.OceanSheet;
        if (peaks.length && OS && typeof OS.tideGaugeHtml === 'function') {
            // 기기 시간대와 상관없이 KST 시·분을 갖는 Date(게이지는 dateObj.getHours()·getMinutes() 를 읽는다).
            var k = new Date(nowMs + 9 * 3600000), kst = new Date(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), k.getUTCHours(), k.getUTCMinutes());
            var today = k.toISOString().slice(0, 10) === t.date;
            // 피크가 서버 숫자·시각만으로 바뀐 뒤 해양종합정보와 같은 함수로 만든 HTML(숫자·고정 글자만).
            var wrap = el('div', 'ocean-tide-wrap');
            var title = el('div', 'ocean-tide-title-row'); var tt = el('div', 'ocean-tide-title'); var ic = el('i', 'fa-solid fa-water'); tt.appendChild(ic); tt.appendChild(document.createTextNode(' 조석 · ' + dateText(t.date))); title.appendChild(tt); wrap.appendChild(title);
            var gauge = el('div', 'sb-tide-gauge'); gauge.innerHTML = OS.tideGaugeHtml(peaks, y, n, kst, today); wrap.appendChild(gauge);
            box.appendChild(wrap);
        }
        (t.text || []).forEach(function (line) { box.appendChild(rocksLine('sb-tide-text', line, b)); });   // 「잠기는 바위(간출암) N곳」은 (물때) 칸과 같은 지도 링크(§11.10.10)
        if (t.anchor && Number.isFinite(Number(t.anchor.distKm))) box.appendChild(el('p', 'sb-small', '관할 대표 위치에서 ' + Number(t.anchor.distKm) + 'km 떨어진 조석 지점 기준'));
        return box;
    }
    /**
     * 다음 판 안내 — 공개 시각(§11.10.4 — 20분 전부터 만들어 두었다가 이 시각에 보임)이 아직이면 「다음 브리핑 공개: …」, 이미 지났으면(서버가 늦게 켜진 경우 등) 「다음 브리핑을 준비 중입니다(… 공개 예정)」.
     * 예: nextText('2026-10-17T23:00:00+09:00', 10-17 21:30) → '다음 브리핑 공개: 10월 17일(토) 23:00' · 23:05 → '다음 브리핑을 준비 중입니다(10월 17일(토) 23:00 공개 예정)'
     * @param {string} iso @param {number} nowMs @returns {string} [연계] ← render(브리핑 없음 — §11.10.9 ⑦ 부터 fallback 상자는 없음)
     */
    function nextText(iso, nowMs) { return Date.parse(iso) <= nowMs ? '다음 브리핑을 준비 중입니다(' + kstText(iso) + ' 공개 예정)' : '다음 브리핑 공개: ' + kstText(iso); }
    /**
     * 브리핑 응답 하나를 그린다(그릇 안을 비우고 새로). 브리핑이 없으면 안내(다음 예정 시각)만.
     * 예: render(document.getElementById('station-briefing-content'), {ok:true,display:true,date:'2026-10-17',briefing:{…},now:null}, {showSea:true,showLand:true,onLink:fn})
     * @param {HTMLElement} box @param {Object} resp - GET /api/station-briefing(또는 관리자 preview) 응답
     * @param {Object} [opts] - showSea·showLand(기본 true)·links(false 면 바로가기 없음)·onLink(target,btn)·now(ms, 시험용)
     * @returns {void}
     * [연계] ← station_briefing.js renderBody · admin_station_briefing.js 미리보기 / → summaryBodyV3(§11.10.4 「가」 모양 — summary.analysis 있음)·summaryBodyV2(§11.10.1 총평)·summaryBody(§11.10 판)·legacyOverview(그 전)·renderRest·RiskBasis.open
     */
    function render(box, resp, opts) {
        opts = opts || {};
        closeMapPopup();   // 본문을 다시 그리면 열린 팝업 지도도 닫는다(§11.10.9 ⑥)
        var showSea = opts.showSea !== false, showLand = opts.showLand !== false, nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
        box.textContent = '';
        var b = resp && resp.briefing;
        var top = el('div', 'sb-meta');
        var left = el('div', 'sb-meta-text');
        if (b && b.station) left.appendChild(el('strong', 'sb-station', (b.station.name || '') + (b.station.office ? ' · ' + b.station.office : '')));
        if (b) left.appendChild(el('span', 'sb-edition', subtitleText(b, resp && resp.nextPublishAt, nowMs)));   // §11.10.9 ⑦ — 판 종류·생성 시각 없음
        top.appendChild(left);
        var basis = el('button', 'rf-basis-btn sb-basis-btn', '기준 상세'); basis.type = 'button';
        basis.addEventListener('click', function (e) { e.stopPropagation(); if (w.RiskBasis) w.RiskBasis.open('briefing', basis); });
        top.appendChild(basis);
        box.appendChild(top);
        if (!b) {
            // 「아직 이 관할의 브리핑이 없습니다.」 줄은 뺐다(§11.10.10 F — 2026-10-17 사용자 *"오류나 자료 없음처럼 다른 내용을 알리는 안내는 남깁니다 <- 이 작업 할 필요 없어"*).
            //   빼도 칸이 비지 않는다 — 머리 줄([기준 상세])과 아래 다음 공개 안내(「다음 브리핑 공개: …」 또는 공개 시각 설명)가 남는다(UI 시험 「브리핑 없음」이 잰다).
            var empty = el('div', 'sb-empty'); empty.setAttribute('data-sb-empty', '');
            empty.appendChild(el('p', 'sb-small', resp && resp.nextExpectedAt ? nextText(resp.nextExpectedAt, nowMs) : '브리핑은 매일 07:30 · 17:30 · 23:00에 보입니다 — 각 20분 전(07:10 · 17:10 · 22:40)부터 만들어 두었다가 그 시각에 보여 드리고, 특보가 바뀌면 그 관할을 곧바로 다시 만듭니다.'));
            box.appendChild(empty);
            return;
        }
        // 「○○ 브리핑(23:00 공개)이 아직 없어 ○○ 브리핑을 보여 드립니다 — 다음 브리핑 공개 …」 상자는 없앴다(§11.10.9 ⑦ — 사용자 *"그 박스 자체가"* 필요 없다). 다음 갱신 시각은 머리 글 괄호에 있다.
        // 관리자 미리보기의 공개 예정 판 안내 「예정 — … 에 공개될 판입니다 …」 상자도 없앴다(§11.10.10 F — 같은 사용자 말). 공개 예정 판인지는 관리자 「AI 브리핑」 상태의 「공개 예정」 줄과 머리 글 시각이 보인다.

        // ① 총평과 권고 — summary.weather 칸이 있으면(§11.10.1) 결론 → (기상) → (물때) → 근거·권고 → AI 해설,
        //   summary 만 있으면(§11.10 판 — 10-17 낮에 저장된 파일) 육상·해상 덩어리 모양, 없으면(그 전) 종전 문단 모양
        var ov = b.overview || {}, s1 = section('총평과 권고', 'overview');
        if (b.summary && b.summary.analysis) summaryBodyV3(s1.body, b, resp, ov, showSea, showLand);
        else if (b.summary && Object.prototype.hasOwnProperty.call(b.summary, 'weather')) summaryBodyV2(s1.body, b, resp, ov, showSea, showLand);
        else if (b.summary) summaryBody(s1.body, b, resp, ov, showSea, showLand); else legacyOverview(s1.body, b, resp, ov, showSea, showLand);
        box.appendChild(s1.root);
        renderRest(box, b, opts, showSea, showLand, nowMs);
    }
    /**
     * 총평 해상 단계가 해상 분석 단계보다 낮을 때 결론 아래 한 줄(2단계 검토 B1 — 초록 「평소 수준」이 「안전」으로 읽히지 않게).
     * 2026-10-17 사용자 *"날씨 혼잡이 겹치지 않아 결론에는 넣지 않았습니다라는 텍스트는 빼줘"*(§11.10.3) — 그 이유 글을 빼고 어디를 보면 되는지만.
     * 예: {sea:{level:{rank:3,word:'경계 필요'}}} → '해상 분석에는 「경계 필요」 해역이 있습니다 — 해양사고 위험예보만 위험 단계인 해역입니다(아래 근거·해상 분석).'
     * @param {Object} b @returns {string} [연계] ← summaryBodyV2·summaryBody·legacyOverview
     */
    function levelNoteText(b) { return '해상 분석에는 「' + (b.sea.level.word || WORDS[b.sea.level.rank]) + '」 해역이 있습니다 — 해양사고 위험예보만 위험 단계인 해역입니다(아래 근거·해상 분석).'; }

    // ── 근거 줄 펼침(2026-10-17 사용자 결정 §11.10.3) — 고립 사고 지점 표 · 해역·해구 미니 지도(테두리 깜빡임) ──
    var xSeq = 0, BLINK_MS = 600, blinking = 0;
    /**
     * 누르면 바로 아래가 펼쳐지는 글 버튼. 펼칠 때마다 build 로 새로 만들고, 접으면 build 가 돌려준 정리 함수(지도 깜빡임 멈춤)를 부르고 비운다.
     * 사용자 원문: *"사고지점을 하이퍼링크로 해서 누르면 아래로 아코디언이 펼쳐지며"* · *"그 텍스트를 누르면 … 아코디언처럼 펼쳐지면서"*.
     * 예: expander('사고 지점(5개소)', fn, 'iso') → {btn:<button aria-expanded="false" aria-controls="sb-x-1">사고 지점(5개소)<span> ▸</span></button>, panel:<div id="sb-x-1" hidden>}
     *     expander('연안 분석 근거 상세 보기', fn, 'basis-land', true) → 알약 배지 버튼(.sb-x-pill — 글 + 작은 꺾쇠 .sb-x-chev, 펼치면 CSS 가 꺾쇠를 뒤집는다 — 2026-10-17 사용자 *"배지 모양으로 … 오른쪽으로 정렬"*, 설계서 §11.10.9)
     * @param {string} text - 버튼 글(textContent) @param {function(HTMLElement):(Function|void)} build - 펼칠 때 panel 을 채움, 정리 함수를 돌려줄 수 있음 @param {string} key - data-sb-x(시험이 찾는 이름)
     * @param {boolean} [pill] - 참이면 알약 배지 모양(글 화살표 ▸/▾ 대신 꺾쇠)
     * @param {boolean} [noArrow] - 참이면 화살표 없이 밑줄 글만(§11.10.10 D — (고립 주의) 링크, 사용자 *"화살표 … 그냥 없애줘"*). 펼침 상태는 aria-expanded 로 그대로 알린다
     * @returns {{btn:HTMLButtonElement, panel:HTMLElement}} [연계] ← isolationLine·basisList·summaryBodyV3 / → isoTable·raisedTable·miniMap
     */
    function expander(text, build, key, pill, noArrow) {
        var id = 'sb-x-' + (++xSeq), btn = el('button', 'sb-x-btn' + (pill ? ' sb-x-pill' : '')), panel = el('div', 'sb-x-panel'), arrow = pill ? el('span', 'sb-x-chev') : el('span', 'sb-x-arrow', ' ▸'), stop = null;
        btn.type = 'button'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', id); btn.setAttribute('data-sb-x', key);
        btn.appendChild(document.createTextNode(text)); arrow.setAttribute('aria-hidden', 'true'); if (!noArrow) btn.appendChild(arrow);
        panel.id = id; panel.hidden = true; panel.setAttribute('data-sb-x-panel', key);
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = btn.getAttribute('aria-expanded') !== 'true';
            if (typeof stop === 'function') stop();
            stop = null; panel.textContent = ''; panel.hidden = !open;
            btn.setAttribute('aria-expanded', String(open)); if (!pill) arrow.textContent = open ? ' ▾' : ' ▸';
            if (open) stop = build(panel) || null;
        });
        return { btn: btn, panel: panel };
    }
    /**
     * 고립 사고 지점 표 「지점명 | 발생 현황」(서버 summary.isolation — head·rows[].status 「22년(1건), 23년(2건), 24년(1건)」, 합 많은 순·이름 순, 모두). 글은 textContent.
     * 2026-10-17 사용자 *"22년 괄호 열고 몇 건, 컴마 23년 괄호 열고 몇 건 …"*(§11.10.10 E). status 가 없는 옛 판(§11.10.3 — 「지점명 | 발생 건수」)은 그 판 그대로 「N건」.
     * 예: isoTable(panel, {head:['지점명','발생 현황'], rows:[{name:'도시해녀',count:2,status:'22년(1건), 23년(1건)'}], caption:'2020~2024 연안사고 기록 중 고립(관광지 구역 + 앞바다 500m)'})
     * @param {HTMLElement} panel @param {Object} iso @returns {void} [연계] ← isolationLine(expander build)
     */
    function isoTable(panel, iso) {
        var t = el('table', 'sb-iso-table'); t.setAttribute('data-sb-iso-table', '');
        if (iso.caption) t.appendChild(el('caption', '', iso.caption));
        var head = Array.isArray(iso.head) && iso.head.length === 2 ? iso.head : ['지점명', '발생 건수'];
        var hr = el('tr'); hr.appendChild(el('th', '', head[0])); hr.appendChild(el('th', '', head[1])); var th = el('thead'); th.appendChild(hr); t.appendChild(th);
        var tb = el('tbody');
        (iso.rows || []).forEach(function (r) { var tr = el('tr'); tr.appendChild(el('td', '', r.name)); tr.appendChild(el('td', 'sb-num', r.status ? String(r.status) : Number(r.count) + '건')); tb.appendChild(tr); });
        t.appendChild(tb); panel.appendChild(t);
    }
    /**
     * 연안 근거 첫 줄 「평소보다 위험이 높아진 곳 N곳」을 누르면 펼치는 표 「관광지 | 평소 | 오늘(예상)」(서버 summary.land.raised — 관심 이상 관광지 전부, 단계 높은 순·이름 순).
     * 2026-10-17 사용자 *"관광지, 기존, 위험이 높아진 곳 세 개로 구분해서 기존엔 뭐였는데 뭘로 높아졌다 … 위험이 높아진 모든 관광지에 대해서"*(설계서 §11.10.9).
     * 평소 칸은 서버 값(「평소 수준」 — 관광지마다 따로 저장된 평소 단계는 없다, 서버 rules.raisedTable 주석), 오늘 칸은 단계 배지 + 아래 작게 높아진 이유. 글은 textContent.
     * 예: raisedTable(panel, {head:['관광지','평소','오늘(예상)'], rows:[{name:'협재해수욕장',usual:'평소 수준',rank:2,word:'주의 필요',reason:"연안 위험지수 72(높음, 예상), 방문객 평소의 1.8배(예상)"}], caption:'…'})
     * @param {HTMLElement} panel @param {Object} r - summary.land.raised @returns {void} [연계] ← basisList(expander build) / → chip
     */
    function raisedTable(panel, r) {
        var t = el('table', 'sb-iso-table sb-raised-table'); t.setAttribute('data-sb-raised-table', '');
        if (r.caption) t.appendChild(el('caption', '', r.caption));
        var hr = el('tr'), th = el('thead'); (r.head || ['관광지', '평소', '오늘(예상)']).forEach(function (h) { hr.appendChild(el('th', '', h)); }); th.appendChild(hr); t.appendChild(th);
        var tb = el('tbody');
        (r.rows || []).forEach(function (x) {
            var tr = el('tr'); tr.appendChild(el('td', 'sb-raised-name', x.name));
            var u = el('td'); u.appendChild(chip(0, x.usual || '평소 수준')); tr.appendChild(u);
            var d = el('td'); d.appendChild(chip(x.rank, x.word)); if (x.reason) d.appendChild(el('p', 'sb-small sb-raised-why', x.reason)); tr.appendChild(d);
            tb.appendChild(tr);
        });
        t.appendChild(tb); panel.appendChild(t);
    }
    /**
     * (물때) 아래 「(고립 주의) 저조 시간(…) 전후 과거 고립 사고(N개소 M건)으로 확인 및 주의가 필요합니다.」 — 서버 link(「과거 고립 사고(N개소 M건)」)가 버튼(화살표 없음 — §11.10.10 D), 누르면 지점 표.
     * 예: isolationLine({text:'(고립 주의) 저조 시간(08:16·22:09) 전후 과거 고립 사고(5개소 6건)으로 확인 및 주의가 필요합니다.', link:'과거 고립 사고(5개소 6건)', rows:[…]}) → <div data-sb-isolation><p>…<button>…</button>…</p><div panel></div></div>
     * @param {Object} iso - summary.isolation @returns {HTMLElement} [연계] ← tidePart / → expander·isoTable
     */
    function isolationLine(iso) {
        var wrap = el('div', 'sb-iso'); wrap.setAttribute('data-sb-isolation', '');
        var p = el('p', 'sb-iso-line'), text = String(iso.text || ''), link = String(iso.link || ''), i = link ? text.indexOf(link) : -1;
        var x = expander(link || '과거 고립 사고', function (panel) { isoTable(panel, iso); }, 'iso', false, true);
        if (i >= 0) { p.appendChild(document.createTextNode(text.slice(0, i))); p.appendChild(x.btn); p.appendChild(document.createTextNode(text.slice(i + link.length))); }
        else { p.appendChild(document.createTextNode(text + ' ')); p.appendChild(x.btn); }
        wrap.appendChild(p); wrap.appendChild(x.panel);
        return wrap;
    }
    /** 움직임 줄이기 설정이면 참(깜빡이지 않고 굵은 테두리로만). @returns {boolean} [연계] ← miniMap */
    function reducedMotion() { try { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } }
    /**
     * 펼친 칸 안에 작은 지도(높이 약 200px)를 그린다 — 관할 해역 경계(파란 선) 전체가 보이게 맞추고, 해당 칸·해구 테두리(빨강)를 약 600ms 마다 깜빡인다.
     * 사용자 원문: *"대한민국 전도 전체로 보면 될 것이 아니라 그 해역 그 관할 전체가 표시되고 … 그 격자의 테두리가 깜빡깜빡했으면 좋겠거든."*
     * 바탕은 관심해역 고르기 지도(zone_setup.js)와 같은 해아름 바다지도(oceanCreateKhoaLayer) — 없으면 선만. 움직임 줄이기 설정이면 깜빡이지 않는다.
     * 지도는 그림처럼 고정(끌기·확대 없음) — 페이지를 쓸어 내릴 때 지도가 손가락을 가로채지 않게.
     * 예: miniMap(panel, [[[[126.1,33.3],…]]], [[126.2,33.4,126.25,33.44]], '빨간 테두리(깜빡임) = …') → 정리 함수(깜빡임 멈춤·지도 떼기)
     * §11.10.9 ⑥: opt.big = 팝업용 큰 지도(.sb-minimap-lg) · opt.cells = [{id, box, count}] 선박이 있는 격자 — 테두리 + 격자 가운데 척수 글(ol Text) · opt.dim = 깜빡이는 격자 말고 나머지 격자를 흐리게.
     * §11.10.10: opt.points = [{id, lat, lon, v, times}] 간출암 — 해양안전 「위험지형」과 같은 간출암 그림(HazardRockTidePanel.icon, 없으면 주황 점) · opt.onPoint(row, unselect) = 마커를 눌렀을 때
     *            (누른 마커에 빨간 고리, unselect() 를 부르면 고리를 지운다). 지도는 끌기·확대 없이도 누름(click)은 받는다.
     * @param {HTMLElement} panel @param {Array} area - 관할 폴리곤 목록(경위도) @param {number[][]} boxes - [서,남,동,북] 목록 @param {string} caption @param {Object} [opt] - {big, cells, dim, points, onPoint}
     * @returns {Function|null} 정리 함수 [연계] ← basisList(expander build)·openMapPopup(대해구·지금 밀집 팝업) / ol.js(index2 전역)·ocean_map.js oceanCreateKhoaLayer
     */
    function miniMap(panel, area, boxes, caption, opt) {
        opt = opt || {};
        var box = el('div', 'sb-minimap' + (opt.big ? ' sb-minimap-lg' : '')); panel.appendChild(box);
        if (caption) panel.appendChild(el('p', 'sb-small sb-minimap-cap', caption));
        if (typeof w.ol === 'undefined' || !Array.isArray(area) || !area.length) { box.setAttribute('data-sb-map', 'none'); box.appendChild(el('p', 'sb-small', '지도를 불러오지 못했습니다.')); return null; }
        var ol = w.ol, proj = function (p) { return ol.proj.fromLonLat([Number(p[0]), Number(p[1])]); };
        var areaSrc = new ol.source.Vector({ features: area.map(function (poly) { return new ol.Feature(new ol.geom.Polygon(poly.map(function (ring) { return ring.map(proj); }))); }) });
        var hlSrc = new ol.source.Vector({ features: (boxes || []).map(function (b) { return new ol.Feature(new ol.geom.Polygon([[[b[0], b[1]], [b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]].map(proj)])); }) });
        var still = reducedMotion(), on = true, fill = new ol.style.Fill({ color: 'rgba(239,68,68,0.16)' });
        var styleOn = new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#ef4444', width: still ? 3 : 2.5 }), fill: fill }), styleOff = new ol.style.Style({ stroke: new ol.style.Stroke({ color: 'rgba(239,68,68,0)', width: 2.5 }), fill: fill });
        var hlLayer = new ol.layer.Vector({ source: hlSrc, style: function () { return on ? styleOn : styleOff; } });
        var areaLayer = new ol.layer.Vector({ source: areaSrc, style: new ol.style.Style({ stroke: new ol.style.Stroke({ color: '#2563eb', width: 2 }), fill: new ol.style.Fill({ color: 'rgba(37,99,235,0.05)' }) }) });
        // 선박이 있는 격자(§11.10.9 ⑥) — 청록 테두리 + 가운데 척수(진한 글·흰 테두리: 바다 바탕에서 읽히게). opt.dim 이면 흐리게
        var cellSrc = new ol.source.Vector({ features: (Array.isArray(opt.cells) ? opt.cells : []).map(function (c) { var b = c.box, f = new ol.Feature(new ol.geom.Polygon([[[b[0], b[1]], [b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]].map(proj)])); f.set('label', String(c.count)); f.set('id', c.id); return f; }) });
        var cellLayer = new ol.layer.Vector({ source: cellSrc, style: function (f) { return new ol.style.Style({ stroke: new ol.style.Stroke({ color: opt.dim ? 'rgba(8,145,178,0.45)' : '#0891b2', width: 1.5 }), fill: new ol.style.Fill({ color: opt.dim ? 'rgba(8,145,178,0.06)' : 'rgba(8,145,178,0.14)' }),
            text: new ol.style.Text({ text: f.get('label'), font: '700 13px sans-serif', fill: new ol.style.Fill({ color: opt.dim ? 'rgba(15,23,42,0.6)' : '#0f172a' }), stroke: new ol.style.Stroke({ color: '#ffffff', width: 3 }), overflow: true }) }); } });
        // 간출암 마커(§11.10.10) — 위치는 서버 summary.rocks.rows 그대로(화면이 바위를 찾지 않는다). 그림은 해양안전 「위험지형」 간출암과 같은 것(hazard_rocks.js 가 내보냄)
        var RP = w.HazardRockTidePanel, sel = null;
        var ptSrc = new ol.source.Vector({ features: (Array.isArray(opt.points) ? opt.points : []).filter(function (r) { return r && Number.isFinite(Number(r.lon)) && Number.isFinite(Number(r.lat)); }).map(function (r) { var f = new ol.Feature(new ol.geom.Point(proj([r.lon, r.lat]))); f.set('row', r); return f; }) });
        var ptImg = RP && RP.icon ? new ol.style.Icon({ src: RP.icon, scale: RP.iconScale || 0.3 }) : new ol.style.Circle({ radius: 7, fill: new ol.style.Fill({ color: '#f59e0b' }), stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 }) });
        var ptStyle = new ol.style.Style({ image: ptImg }), ring = new ol.style.Style({ image: new ol.style.Circle({ radius: 17, stroke: new ol.style.Stroke({ color: '#ef4444', width: 3 }), fill: new ol.style.Fill({ color: 'rgba(239,68,68,0.15)' }) }) });
        var ptLayer = new ol.layer.Vector({ source: ptSrc, style: function (f) { return f === sel ? [ring, ptStyle] : ptStyle; } });
        var layers = [];
        if (typeof w.oceanCreateKhoaLayer === 'function') { try { var base = w.oceanCreateKhoaLayer('BASEMAP_RLTM3857'); base.setVisible(true); layers.push(base); } catch (e) { console.warn('[station-briefing] 바탕 지도 없이 선만 그립니다', e); } }
        layers.push(areaLayer, cellLayer, hlLayer, ptLayer);
        var map = new ol.Map({ target: box, layers: layers, view: new ol.View({ center: proj([127.5, 36]), zoom: 7 }), controls: [], interactions: [] });
        var ext = areaSrc.getExtent().slice(); if (hlSrc.getFeatures().length) ol.extent.extend(ext, hlSrc.getExtent()); if (cellSrc.getFeatures().length) ol.extent.extend(ext, cellSrc.getExtent()); if (ptSrc.getFeatures().length) ol.extent.extend(ext, ptSrc.getExtent());
        if (ptSrc.getFeatures().length && typeof opt.onPoint === 'function') {
            map.on('click', function (evt) {
                var hit = null; map.forEachFeatureAtPixel(evt.pixel, function (f) { hit = f; return true; }, { layerFilter: function (l) { return l === ptLayer; }, hitTolerance: 6 });
                if (!hit) return;
                sel = hit; ptLayer.changed(); box.setAttribute('data-sb-map-sel', String(hit.get('row').id));
                opt.onPoint(hit.get('row'), function () { if (sel === hit) { sel = null; ptLayer.changed(); box.removeAttribute('data-sb-map-sel'); } });
            });
        }
        map.updateSize(); map.getView().fit(ext, { size: map.getSize(), padding: [10, 10, 10, 10] });
        box.setAttribute('data-sb-map', 'ol'); box.setAttribute('data-sb-map-base', layers.length > 3 ? 'khoa' : 'none');
        box.setAttribute('data-sb-map-cells', String(cellSrc.getFeatures().length)); box.setAttribute('data-sb-map-labels', cellSrc.getFeatures().map(function (f) { return f.get('label'); }).join(','));
        box.setAttribute('data-sb-map-points', String(ptSrc.getFeatures().length)); box.setAttribute('data-sb-map-icon', RP && RP.icon ? 'hazard-rocks' : 'dot');
        box.setAttribute('data-sb-map-area', String(areaSrc.getFeatures().length)); box.setAttribute('data-sb-map-hl', String(hlSrc.getFeatures().length));
        box._sbMap = { map: map, area: areaSrc, hl: hlSrc, hlLayer: hlLayer, cells: cellSrc, points: ptSrc };   // 시험용 손잡이(OL 지형지물 수 확인 · 마커 화면 위치)
        var timer = null;
        var stop = function () { if (timer) { clearInterval(timer); timer = null; blinking--; } box.setAttribute('data-sb-blink', still ? 'static' : 'off'); map.setTarget(null); };
        if (still) box.setAttribute('data-sb-blink', 'static');
        else {
            box.setAttribute('data-sb-blink', 'on'); blinking++;
            timer = setInterval(function () { if (!box.isConnected) { stop(); return; } on = !on; box.setAttribute('data-sb-blink-phase', on ? '1' : '0'); hlLayer.changed(); }, BLINK_MS);
        }
        return stop;
    }
    /** 지도 아래 한 줄 풀이. 예: ({key:'haegu',major:'232'}, {name:'한림파출소'}) → '빨간 테두리(깜빡임) = 대해구 232 · 파란 선 = 한림파출소 관할 해역'. @param {Object} d - detail @param {Object} station @returns {string} [연계] ← basisList */
    function mapCaption(d, station) {
        var what = d.key === 'haegu' ? '대해구 ' + (d.major || '') : d.key === 'accidentOnly' ? '해양사고 위험예보만 위험 단계인 해역' : '위험이 높아진 해역';
        return '빨간 테두리(깜빡임) = ' + what + ' · 파란 선 = ' + ((station && station.name) || '') + ' 관할 해역';
    }

    // ── 팝업 지도(2026-10-17 사용자 결정 — 설계서 §11.10.9 ⑥) — 대해구 링크·지금 밀집 링크가 연다 ──
    // 원문: *"대해구 75 부분은 정확히 어딘지 알 수 있도록 하이퍼링크를 통해, 그 부분을 눌렀을 때 팝업으로 지도가 표출되고, 해당 해역의 해구 격자가 표시되도록"* ·
    //       *"관할 해역 선박 27척 … 팝업으로 해당 관할이 나오고, 그 지도의 선박이 있는 격자를 표시한 뒤 그 격자 안에 선박수를 표출"* · *"죽변항 북서방 0.7해리 해역 그 부분도 마찬가지로 하이퍼링크 처리 및 격자 안에 숫자 처리"*.
    // 모양·닫기는 관할 확인 창(station_briefing_picker.js confirmPick)과 같은 틀(.sb-dlg — role=dialog·aria-modal·Esc·바깥·✕·하드웨어 뒤로가기 PopupStack). 지도는 근거 줄 펼침과 같은 miniMap(OpenLayers·해아름 바탕).
    var popup = null;
    /** 팝업 지도를 닫는다(깜빡임 멈춤·지도 떼기·연 곳으로 초점). 예: closeMapPopup(). @returns {void} [연계] ← openMapPopup(✕·바깥·Esc·뒤로가기)·render(본문을 다시 그릴 때) */
    function closeMapPopup() {
        closeRockPanel();   // 간출암 상자(§11.10.10)가 떠 있으면 같이 닫는다
        if (!popup) return;
        var p = popup; popup = null;
        if (w.PopupStack) w.PopupStack.remove('sb-map-popup');
        if (typeof p.stop === 'function') p.stop();
        if (p.wrap.parentNode) p.wrap.parentNode.removeChild(p.wrap);
        if (p.back && p.back.isConnected && p.back.focus) p.back.focus({ preventScroll: true });
    }
    /**
     * 가운데 팝업 하나를 열고 build(지도 칸)로 채운다 — 이미 열린 것은 닫는다.
     * 예: openMapPopup('경북북부앞바다(대해구 75)', function (body) { return miniMap(body, area, [box], '…', {big:true}); }, btn)
     * @param {string} title @param {function(HTMLElement):(Function|void)} build - 정리 함수를 돌려줄 수 있음 @param {string} key - data-sb-map-popup(시험이 찾는 이름) @returns {void}
     * [연계] ← analysisNodes(대해구 링크)·nowNode(지금 밀집 링크) / → miniMap·closeMapPopup
     */
    function openMapPopup(title, build, key) {
        closeMapPopup();
        var back = document.activeElement, wrap = el('div', 'sb-dlg sb-mapdlg'), dim = el('div', 'sb-dlg-dim'), box = el('div', 'sb-dlg-box sb-mapdlg-box'), id = 'sb-mapdlg-t' + (++xSeq);
        wrap.setAttribute('data-sb-map-popup', key || '');
        box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', id);
        var head = el('div', 'sb-mapdlg-head'), t = el('p', 'sb-dlg-title', title), x = el('button', 'sb-mapdlg-x', '✕'); t.id = id; x.type = 'button'; x.setAttribute('aria-label', '닫기'); x.setAttribute('data-sb-map-close', '');
        head.appendChild(t); head.appendChild(x); box.appendChild(head);
        var body = el('div', 'sb-mapdlg-body'); box.appendChild(body);
        wrap.appendChild(dim); wrap.appendChild(box); document.body.appendChild(wrap);
        popup = { wrap: wrap, back: back, stop: null };
        x.addEventListener('click', function (e) { e.stopPropagation(); closeMapPopup(); });
        dim.addEventListener('pointerdown', function (e) { e.preventDefault(); closeMapPopup(); });
        wrap.addEventListener('click', function (e) { e.stopPropagation(); });   // 바깥 아코디언 머리로 번지지 않게
        // Esc = 간출암 상자(§11.10.10)가 떠 있으면 그것만, 아니면 창 · Tab = 창 안에서만 돈다(상자가 떠 있으면 ✕ ↔ 상자 단추들)
        wrap.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); if (rockPanel) closeRockPanel(); else closeMapPopup(); }
            else if (e.key === 'Tab') {
                e.preventDefault();
                var f = [x].concat(rockPanel ? [].slice.call(rockPanel.el.querySelectorAll('button')).filter(function (b) { return !b.disabled; }) : []), k = f.indexOf(document.activeElement);
                f[(k + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
            }
        });
        if (w.PopupStack) w.PopupStack.push('sb-map-popup', closeMapPopup);
        var p = popup; p.stop = build(body) || null;   // 붙인 뒤에 그려야 지도가 크기를 잰다
        x.focus();
    }
    /**
     * 글 안의 링크 단추(밑줄 글 — 근거 줄 펼침 단추와 같은 .sb-x-btn 모양). 예: mapLink('대해구 75', fn, 'haegu') → <button class="sb-x-btn sb-maplink" data-sb-maplink="haegu" aria-haspopup="dialog">
     * @param {string} text @param {function(HTMLElement)} onOpen - 눌렀을 때(단추를 넘긴다) @param {string} key @returns {HTMLButtonElement} [연계] ← analysisNodes·nowNode
     */
    function mapLink(text, onOpen, key) {
        var b = el('button', 'sb-x-btn sb-maplink', text); b.type = 'button'; b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('data-sb-maplink', key);
        b.addEventListener('click', function (e) { e.stopPropagation(); onOpen(b); });
        return b;
    }
    // ── 잠기는 바위(간출암) — 링크 → 팝업 지도 → 마커 → 간출암 조석 곡선 상자(2026-10-17 사용자 결정 — 설계서 §11.10.10) ──
    // 원문: *"그 간출암 두 곳 그 부분에 하이퍼링크를 걸어서 누르면 그 바위 두 곳이 어디에 있는지 지도에 표출 … 그 바위 마커를 누르면 우리 해양안전생활에서 위험지형에
    //       저 간출암을 누르면 시간대에 따라 팝업으로 언제 잠기고 뭐 이런 게 별도의 박스로 정보를 제공하잖아. 거기까지 제공될 수 있도록"*.
    // 상자는 새로 만들지 않고 해양안전 「위험지형」의 것을 그대로 쓴다(hazard_rocks.js mountTidePanel → window.HazardRockTidePanel). 바위 번호(id)는 서버가 준 hazard_rocks.json id.
    var rockPanel = null;
    /** 간출암 상자를 닫는다(받기 멈춤·떼기·마커 고리 지움). 예: closeRockPanel(). @returns {void} [연계] ← openRockPanel(✕·뒤로가기)·openMapPopup(Esc)·closeMapPopup */
    function closeRockPanel() {
        if (!rockPanel) return;
        var r = rockPanel; rockPanel = null;
        if (w.PopupStack) w.PopupStack.remove('sb-rock-panel');
        if (r.ctl) r.ctl.close();
        if (r.el.parentNode) r.el.parentNode.removeChild(r.el);
        if (typeof r.done === 'function') r.done();
    }
    /**
     * 팝업 지도 창 위 가운데에 간출암 조석 곡선 상자를 띄운다 — 해양안전 「위험지형」 간출암 팝업과 같은 함수(HazardRockTidePanel.mount)·같은 모양(.hazard-rock-popup.rock-tide-popup).
     * 다른 마커를 누르면 상자를 바꾼다. hazard_rocks.js 가 없으면(그 화면에 안 실렸으면) 아무것도 띄우지 않고 거짓.
     * 예: openRockPanel({id:812, lat:33.4, lon:126.2, v:0.9, times:['02:40']}, unselectFn) → true
     * @param {Object} row - summary.rocks.rows 한 줄 @param {Function} done - 상자가 닫힐 때(마커 고리 지움) @returns {boolean}
     * [연계] ← rocksLine(miniMap onPoint) / → HazardRockTidePanel.mount(hazard_rocks.js)·closeRockPanel
     */
    function openRockPanel(row, done) {
        closeRockPanel();
        var RP = w.HazardRockTidePanel;
        if (!popup || !RP || typeof RP.mount !== 'function') { if (typeof done === 'function') done(); return false; }
        var el = document.createElement('div'); el.className = 'hazard-rock-popup rock-tide-popup sb-rockbox';
        el.setAttribute('data-sb-rockbox', String(row.id)); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', RP.title(row.v));
        el.addEventListener('click', function (e) { e.stopPropagation(); });
        popup.wrap.appendChild(el);
        rockPanel = { el: el, ctl: null, done: done };
        rockPanel.ctl = RP.mount(el, { rockId: row.id, v: row.v, lon: Number(row.lon), lat: Number(row.lat), onClose: function () { closeRockPanel(); } });
        if (w.PopupStack) w.PopupStack.push('sb-rock-panel', closeRockPanel);
        var c = el.querySelector('.rtp-close'); if (c && c.focus) c.focus({ preventScroll: true });
        return true;
    }
    /**
     * (물때)·조석 칸의 서버 물때 줄 하나 — 그 줄에 summary.rocks.link(「잠기는 바위(간출암) N곳」)가 있고 관할 경계(summary.sea.area)가 있으면 그 글만 팝업 지도 링크로.
     * 지도 = 관할 경계(파란 선) + 그 N곳 간출암 마커 — 마커를 누르면 openRockPanel. 그 밖은 글만(옛 판·바위 목록 없음).
     * 예: rocksLine('sb-sum-tide', '관할 내 잠기는 바위(간출암) 2곳이 02:40~16:41 사이 …', b) → <p class="sb-sum-tide" data-sb-rocks>관할 내 <button data-sb-maplink="rocks">잠기는 바위(간출암) 2곳</button>이 …</p>
     * @param {string} cls - p 의 class @param {string} line - 서버 글 @param {Object} b - briefing(summary.rocks·summary.sea.area·station) @returns {HTMLElement}
     * [연계] ← tidePart·tide / → mapLink·openMapPopup·miniMap(points)·openRockPanel
     */
    function rocksLine(cls, line, b) {
        var p = el('p', cls), S = (b && b.summary) || {}, R = S.rocks, text = String(line || ''), i = R && R.link ? text.indexOf(R.link) : -1;
        var area = S.sea && Array.isArray(S.sea.area) && S.sea.area.length ? S.sea.area : null;
        if (i < 0 || !area || !Array.isArray(R.rows) || !R.rows.length) { p.textContent = text; return p; }
        var stName = (b.station && b.station.name) || '';
        p.setAttribute('data-sb-rocks', '');
        p.appendChild(document.createTextNode(text.slice(0, i)));
        p.appendChild(mapLink(R.link, function () {
            openMapPopup(stName + ' 관할 내 ' + R.link, function (body) {
                return miniMap(body, area, [], '바위 그림 = 이 날 물에 잠기는 간출암(누르면 오늘·내일·모레 조석 곡선과 잠기는 시각) · 파란 선 = ' + stName + ' 관할 해역', { big: true, points: R.rows, onPoint: openRockPanel });
            }, 'rocks');
        }, 'rocks'));
        p.appendChild(document.createTextNode(text.slice(i + R.link.length)));
        return p;
    }
    /**
     * 「지금 밀집」 줄 — 「관할 해역 선박 N척」과 가장 붐비는 해역 이름을 팝업 지도 링크로(§11.10.9 ⑥). 관할 경계(summary.sea.area)나 격자(now.cells)가 없으면 글만.
     * 예: nowNode({text:'20:45 기준 관할 해역 선박 35척 · …\n죽변항 … 27척 — 충돌·접촉 주의', count:35, cells:[…], busiest:{name:'죽변항 …', count:27, id:'GR4_…'}}, b)
     * @param {Object} now - resp.now @param {Object} b - briefing @returns {HTMLElement} p.sb-now [연계] ← summaryBodyV3 / → mapLink·openMapPopup·miniMap
     */
    function nowNode(now, b) {
        var p = el('p', 'sb-now'), text = String(now.text || ''); p.setAttribute('data-sb-now', '');
        var area = b.summary && b.summary.sea && Array.isArray(b.summary.sea.area) && b.summary.sea.area.length ? b.summary.sea.area : null, cells = Array.isArray(now.cells) ? now.cells : [];
        var stName = (b.station && b.station.name) || '', links = [];
        if (area && cells.length) {
            var all = '관할 해역 선박 ' + now.count + '척';
            links.push({ text: all, key: 'all', open: function () { openMapPopup(stName + ' 관할 해역 선박 ' + now.count + '척', function (body) { return miniMap(body, area, [], '청록 칸 = 지금 선박이 있는 해역 격자 · 칸 안 숫자 = 선박 수 · 파란 선 = ' + stName + ' 관할 해역', { big: true, cells: cells }); }, 'now-all'); } });
            var bz = now.busiest, bc = bz && bz.id ? cells.filter(function (c) { return c.id === bz.id; })[0] : null;
            if (bz && bz.name && bc) links.push({ text: bz.name, key: 'busiest', open: function () { openMapPopup(bz.name + ' ' + bz.count + '척', function (body) { return miniMap(body, area, [bc.box], '빨간 테두리(깜빡임) = ' + bz.name + ' · 칸 안 숫자 = 선박 수 · 파란 선 = ' + stName + ' 관할 해역', { big: true, cells: cells, dim: true }); }, 'now-busiest'); } });
        }
        var at = 0;
        links.map(function (l) { return { l: l, i: text.indexOf(l.text) }; }).filter(function (x) { return x.i >= 0; }).sort(function (a, c) { return a.i - c.i; }).forEach(function (x) {
            if (x.i < at) return;
            p.appendChild(document.createTextNode(text.slice(at, x.i))); p.appendChild(mapLink(x.l.text, x.l.open, 'now-' + x.l.key)); at = x.i + x.l.text.length;
        });
        p.appendChild(document.createTextNode(text.slice(at)));
        return p;
    }
    /**
     * (근거) 목록 — 서버가 준 줄 번호(detail.line)에 지도 재료(boxes)와 관할 경계(area)가 있으면 그 줄을 펼침 버튼으로, 풀이(note)가 있으면 줄 아래 작게.
     * 연안 근거 첫 줄에 서버 raised(§11.10.9)가 있으면 그 줄 안의 「평소보다 위험이 높아진 곳 N곳」(raised.link)만 버튼 — 누르면 바로 아래 표(raisedTable). 글에 link 가 없으면 줄 끝에 버튼.
     * 예: basisList({basis:['관할 해역 30칸 중 위험이 높아진 해역 1칸', …], area:[…], detail:[{line:0,key:'overview',boxes:[[…]]}]}, b) → <ul class="sb-list sb-sum-basis">
     *     basisList({basis:['관할 관광지 30곳 중 평소보다 위험이 높아진 곳 12곳 (주의 3곳 · 관심 9곳)', …], raised:{line:0, link:'평소보다 위험이 높아진 곳 12곳', rows:[…]}}, b)
     * @param {Object} sum - {basis, area, detail, raised} @param {Object} b - briefing(관할 이름) @returns {HTMLElement} [연계] ← summaryBodyV2·summaryBodyV3 / → expander·miniMap·raisedTable
     */
    function basisList(sum, b) {
        var u = el('ul', 'sb-list sb-sum-basis'), det = {}, area = Array.isArray(sum.area) && sum.area.length ? sum.area : null;
        var rz = sum.raised && Array.isArray(sum.raised.rows) && sum.raised.rows.length ? sum.raised : null;
        (Array.isArray(sum.detail) ? sum.detail : []).forEach(function (d) { if (d && Number.isFinite(Number(d.line))) det[Number(d.line)] = d; });
        sum.basis.forEach(function (text, i) {
            var li = el('li'), d = det[i], note = d && d.note ? el('p', 'sb-small sb-basis-note', d.note) : null;
            if (rz && Number(rz.line) === i) {
                var link = String(rz.link || ''), at = link ? text.indexOf(link) : -1, rx = expander(link || '위험이 높아진 곳', function (panel) { raisedTable(panel, rz); }, 'raised');
                if (at >= 0) { li.appendChild(document.createTextNode(text.slice(0, at))); li.appendChild(rx.btn); li.appendChild(document.createTextNode(text.slice(at + link.length))); }
                else { li.appendChild(document.createTextNode(text + ' ')); li.appendChild(rx.btn); }
                li.appendChild(rx.panel);
            } else if (d && area && Array.isArray(d.boxes) && d.boxes.length) {
                var x = expander(text, function (panel) { return miniMap(panel, area, d.boxes, mapCaption(d, b.station)); }, 'map-' + (d.key || ''));
                li.appendChild(x.btn); if (note) li.appendChild(note); li.appendChild(x.panel);
            } else { li.appendChild(document.createTextNode(text)); if (note) li.appendChild(note); }
            if (d && d.key) li.setAttribute('data-sb-basis', d.key);
            u.appendChild(li);
        });
        return u;
    }
    /**
     * 「총평과 권고」 새 모양(2026-10-17 사용자 결정 §11.10 — *"오늘 한림파출소 관할 연안의 단계는 "주의 필요" 입니다. (줄바꿈) (근거)가 나오도록"*).
     * 육상(보일 때)·해상마다: 단계 배지 줄 → 결론(굵게) → (근거) 목록 → (권고) → (물때, 육상만) → AI 해설(있으면, 작은 이름표 「해설 · ChatGPT」).
     * 결론·근거·권고는 서버가 계산한 글(summary), 해설만 AI(overview.land·sea — 틀이면 없음). 글은 모두 textContent.
     * 예: summaryBody(body, {summary:{land:{headline:'오늘 한림파출소 관할 연안의 단계는 "주의 필요"입니다.',basis:[…],advice:'…',tide:[…]},sea:{…}},…}, resp, ov, true, true)
     * @param {HTMLElement} body @param {Object} b - briefing @param {Object} resp @param {Object} ov - b.overview @param {boolean} showSea @param {boolean} showLand @returns {void}
     * [연계] ← render / → chip·list
     */
    function summaryBody(body, b, resp, ov, showSea, showLand) {
        var ai = ov.source === 'chatgpt' || ov.source === 'gemini', who = ov.source === 'chatgpt' ? 'ChatGPT' : 'Gemini';
        /** 육상·해상 한 덩어리. */
        var block = function (kind, label, rank, word, sum, commentary) {
            var wrap = el('div', 'sb-sum'); wrap.setAttribute('data-sb-summary', kind);
            var lv = el('div', 'sb-levels'); lv.appendChild(el('span', 'sb-level-k', label)); lv.appendChild(chip(rank, word)); wrap.appendChild(lv);
            if (kind === 'sea' && b.sea.level && Number(b.sea.level.rank) > Number(b.sea.overviewLevel.rank)) {
                // 총평 해상 단계(거른 뒤)가 해상 분석 단계보다 낮으면 한 줄 — 초록 「평소 수준」이 「안전」으로 읽히지 않게(2단계 검토 B1).
                var ln = el('p', 'sb-small sb-level-note', levelNoteText(b));
                ln.setAttribute('data-sb-level-note', ''); wrap.appendChild(ln);
            }
            wrap.appendChild(el('p', 'sb-headline', sum.headline || ''));
            if (Array.isArray(sum.basis) && sum.basis.length) { wrap.appendChild(el('p', 'sb-sum-k', '(근거)')); var ul = list(sum.basis); ul.classList.add('sb-sum-basis'); wrap.appendChild(ul); }
            if (sum.advice) { var ad = el('p', 'sb-sum-advice'); ad.appendChild(el('span', 'sb-sum-k', '(권고) ')); ad.appendChild(document.createTextNode(sum.advice)); wrap.appendChild(ad); }
            if (Array.isArray(sum.tide) && sum.tide.length) { wrap.appendChild(el('p', 'sb-sum-k', '(물때)')); sum.tide.forEach(function (t) { wrap.appendChild(el('p', 'sb-sum-tide', t)); }); }
            if (ai && commentary) {
                var cm = el('p', 'sb-commentary'); cm.setAttribute('data-sb-commentary', kind);
                cm.appendChild(el('span', 'sb-commentary-k', '해설 · ' + who + ' ')); cm.appendChild(document.createTextNode(commentary)); wrap.appendChild(cm);
            }
            body.appendChild(wrap);
        };
        if (showLand && b.land && b.summary.land) block('land', '연안', b.land.level.rank, b.land.level.word, b.summary.land, ov.land);
        if (showSea && b.sea && b.summary.sea) block('sea', '해상', b.sea.overviewLevel.rank, b.sea.overviewLevel.word, b.summary.sea, ov.sea);
        if (showSea && resp.now && resp.now.text) body.appendChild(el('p', 'sb-now', resp.now.text));
        var note = ai && (ov.land || ov.sea) ? '해설은 ' + who + '가 썼습니다 — 숫자·지명·단계는 서버가 계산한 값만 씁니다' + (ov.reused ? '(지난 판과 입력이 같아 재사용)' : '') + '. 결론·근거·권고는 서버가 계산한 값입니다.'
            : 'AI 해설 없음 — 결론·근거·권고는 서버가 계산한 값입니다.';
        var sn = el('p', 'sb-small sb-source', note); sn.setAttribute('data-sb-source', ai ? ov.source : 'template'); body.appendChild(sn);
    }
    /**
     * (기상) 칸 — 가장 가까운 앞바다 단기 해상예보 오전·오후 두 줄 + 출처 + 특이사항(§11.10.1·§11.10.2). summaryBodyV2(§11.10.1)·summaryBodyV3(§11.10.4) 공용.
     * 2026-10-17 사용자 결정(§11.10.9): 머리 「{구역} 기상 현황」을 결론 줄(.sb-headline 「… 해상의 단계는 "평소 수준"입니다」)과 같은 모양으로 — 원문 *"그 텍스트 크기와 스타일과 동일한 크기로 그 헤더 … 경북북부앞바다 기상 현황"*.
     *   「파출소 대표 위치에서 가장 가까운 특보구역(약 0.1km)」 줄과 먼 구역 안내(서버 weather.note — 울릉·흑산처럼 앞바다가 30km 넘게 먼 곳)는 그리지 않는다 — *"아예 삭제 … 필요가 없는 내용"*. 구역 이름은 머리에 남는다.
     *   특이사항: 항목이 있으면 머리 「특이사항」(같은 모양) + 목록 + 출처 · 항목이 없으면 이유와 상관없이(그날 특이사항 없음 · 단기 전망을 못 받음(bulletinMissing) · 뽑지 못함(notesFound)) 칸째 없음 —
     *   머리·안내·출처 줄 모두 없음(§11.10.11 사용자 결정 *"아예 빼 받지 못함 안내 넣지 말고"* — 이 자리만 L-291 「조용한 것이 이상 없는 것처럼 보이면 안 된다」보다 사용자 결정이 우선).
     * 예: weatherPart(part, {weather:{zone:'제주도서부앞바다',rows:[{label:'오늘 오전',text:'…'}],source:'…',notes:[…]}}) → <div data-sb-part="weather"><p class="sb-headline sb-wx-head">제주도서부앞바다 기상 현황</p>…</div>
     * @param {function(string,string):HTMLElement} part - 이름표 칸 만들기 @param {Object} S - summary @returns {void} [연계] ← summaryBodyV2·summaryBodyV3
     */
    function weatherPart(part, S) {
        var W = S.weather || {}, wp = part('weather', null), head = function (text, key) { var h = el('p', 'sb-headline sb-wx-head', text); h.setAttribute('data-sb-wx-head', key); wp.appendChild(h); };
        head((W.zone ? W.zone + ' ' : '') + '기상 현황', 'weather');
        if (!W.missing && Array.isArray(W.rows) && W.rows.length) {
            var wl = el('ul', 'sb-list sb-wx-rows'); W.rows.forEach(function (r) { var li = el('li'); li.appendChild(el('b', '', r.label + ' ')); li.appendChild(document.createTextNode(r.text)); wl.appendChild(li); }); wp.appendChild(wl);
            if (W.source) wp.appendChild(el('p', 'sb-small', W.source));
        } else { var wm = el('p', 'sb-miss', '기상예보 자료를 확인하지 못했습니다.'); wm.setAttribute('data-sb-wx-missing', ''); wp.appendChild(wm); }
        if (!W.bulletinMissing && Array.isArray(W.notes) && W.notes.length) {
            head('특이사항', 'notes'); var nl = list(W.notes); nl.classList.add('sb-wx-notes'); wp.appendChild(nl);
            if (W.notesSource) wp.appendChild(el('p', 'sb-small', W.notesSource));
        }
        // 그 밖(항목 없음·못 받음·뽑지 못함) — 칸째 없음: 머리·안내·출처 줄 모두 없다(§11.10.11)
    }
    /**
     * (물때) 칸 — 서버 물때 줄 + (고립 주의) 줄(§11.10.3 — 연안을 보일 때만). 줄이 없으면 칸도 없다. summaryBodyV2·summaryBodyV3 공용.
     * @param {function(string,string):HTMLElement} part @param {Object} S - summary @param {*} land - 연안을 보이나(summary.land) @param {Object} b - briefing(바위 링크 — §11.10.10) @returns {void} [연계] ← summaryBodyV2·summaryBodyV3 / → isolationLine·rocksLine
     */
    function tidePart(part, S, land, b) {
        // (고립 주의) 줄(§11.10.3)은 물때 줄 아래 — 「과거 고립 사고(N개소 M건)」를 누르면 지점 표(§11.10.10). 「잠기는 바위(간출암) N곳」은 팝업 지도 링크(rocksLine)
        var iso = land && S.isolation && Array.isArray(S.isolation.rows) && S.isolation.rows.length ? S.isolation : null;
        if ((Array.isArray(S.tide) && S.tide.length) || iso) { var tp = part('tide', '(물때)'); (S.tide || []).forEach(function (t) { tp.appendChild(rocksLine('sb-sum-tide', t, b)); }); if (iso) tp.appendChild(isolationLine(iso)); }
    }
    /**
     * 「총평과 권고」 §11.10.1 모양(2026-10-17 사용자 후속 결정 — *"결론 한줄 -> 기상(…가장 가까운 특보구역…오전, 오후…) … / 물때 / 연안의 안전 등급 분석에 근거…"*):
     *   ① 결론(육상·해상 단계 배지 + 결론 한 줄씩) ② (기상) 가장 가까운 앞바다 단기 해상예보 오전·오후 두 줄 + 출처 + (특이사항) 지방기상청 단기 전망 대상일 것
     *   ③ (물때) 공용 ④ 육상 (근거)·(권고) ⑤ 해상 (근거)·(권고) ⑥ AI 해설(있으면). 자료가 없으면 「기상예보 자료를 확인하지 못했습니다」. 글은 모두 textContent.
     *   §11.10.3: (물때) 아래 (고립 주의) 줄(summary.isolation — 지점 표 펼침) · 근거 줄 ▸ 지도 펼침(basisList) · 해상 근거 끝에 지금 밀집 한 줄.
     * 예: summaryBodyV2(body, {summary:{weather:{zone:'제주도서부앞바다',rows:[{label:'오늘 오전',text:'…'}],source:'…',notes:[…]},tide:[…],land:{…},sea:{…}},…}, resp, ov, true, true)
     * @param {HTMLElement} body @param {Object} b @param {Object} resp @param {Object} ov @param {boolean} showSea @param {boolean} showLand @returns {void}
     * [연계] ← render / → chip·list·basisList·isolationLine
     */
    function summaryBodyV2(body, b, resp, ov, showSea, showLand) {
        var S = b.summary, ai = ov.source === 'chatgpt' || ov.source === 'gemini', who = ov.source === 'chatgpt' ? 'ChatGPT' : 'Gemini';
        var land = showLand && b.land && S.land, sea = showSea && b.sea && S.sea;
        /** 이름표가 붙은 칸. 예: part('weather','(기상)') → <div class="sb-part" data-sb-part="weather"><p class="sb-sum-k">(기상)</p></div> */
        var part = function (key, label) { var d = el('div', 'sb-part'); d.setAttribute('data-sb-part', key); if (label) d.appendChild(el('p', 'sb-sum-k', label)); body.appendChild(d); return d; };
        // ① 결론
        var c = part('conclusion', null);
        var head = function (label, rank, word, text) { var r = el('div', 'sb-conclusion'); var lv = el('span', 'sb-levels'); lv.appendChild(el('span', 'sb-level-k', label)); lv.appendChild(chip(rank, word)); r.appendChild(lv); r.appendChild(el('p', 'sb-headline', text || '')); c.appendChild(r); };
        if (land) head('연안', b.land.level.rank, b.land.level.word, S.land.headline);
        if (sea) {
            head('해상', b.sea.overviewLevel.rank, b.sea.overviewLevel.word, S.sea.headline);
            if (b.sea.level && Number(b.sea.level.rank) > Number(b.sea.overviewLevel.rank)) {
                var ln = el('p', 'sb-small sb-level-note', levelNoteText(b));
                ln.setAttribute('data-sb-level-note', ''); c.appendChild(ln);
            }
        }
        weatherPart(part, S);
        tidePart(part, S, land, b);
        // ④⑤ 연안·해상 근거·권고
        var nowText = showSea && resp.now && resp.now.text ? resp.now.text : null;
        var basis = function (kind, label, sum) {
            var d = part(kind, null); d.setAttribute('data-sb-summary', kind); d.classList.add('sb-sum');
            d.appendChild(el('p', 'sb-part-title', label));
            // 해상 근거 끝에 「지금 … 선박 N척」(실시간 — 서버 route 가 붙임) 한 줄, 그다음 (권고)(§11.10.3 화면 순서)
            var rows = Array.isArray(sum.basis) ? sum.basis : [];
            if (rows.length || (kind === 'sea' && nowText)) {
                d.appendChild(el('p', 'sb-sum-k', '(근거)')); var ul = basisList({ basis: rows, area: sum.area, detail: sum.detail, raised: sum.raised }, b);
                if (kind === 'sea' && nowText) { var nl = el('li', 'sb-now', nowText); nl.setAttribute('data-sb-now', ''); ul.appendChild(nl); nowText = null; }
                d.appendChild(ul);
            }
            if (sum.advice) { var ad = el('p', 'sb-sum-advice'); ad.appendChild(el('span', 'sb-sum-k', '(권고) ')); ad.appendChild(document.createTextNode(sum.advice)); d.appendChild(ad); }
        };
        if (land) basis('land', '연안', S.land);
        if (sea) basis('sea', '해상', S.sea);
        // ⑥ AI 해설
        if (ai && ((land && ov.land) || (sea && ov.sea))) {
            var cp = part('commentary', null);
            [['land', '연안', land && ov.land], ['sea', '해상', sea && ov.sea]].forEach(function (x) {
                if (!x[2]) return;
                var cm = el('p', 'sb-commentary'); cm.setAttribute('data-sb-commentary', x[0]);
                cm.appendChild(el('span', 'sb-commentary-k', '해설 · ' + who + ' · ' + x[1] + ' ')); cm.appendChild(document.createTextNode(x[2])); cp.appendChild(cm);
            });
        }
        if (nowText) body.appendChild(el('p', 'sb-now', nowText));
        var note = ai && (ov.land || ov.sea) ? '해설은 ' + who + '가 썼습니다 — 숫자·지명·단계는 서버가 계산한 값만 씁니다' + (ov.reused ? '(지난 판과 입력이 같아 재사용)' : '') + '. 결론·기상·근거·권고는 서버가 모은·계산한 값입니다.'
            : 'AI 해설 없음 — 결론·기상·근거·권고는 서버가 모은·계산한 값입니다.';
        var sn = el('p', 'sb-small sb-source', note); sn.setAttribute('data-sb-source', ai ? ov.source : 'template'); body.appendChild(sn);
    }

    // ── 분석 문단 강조(2026-10-17 사용자 결정 — 설계서 §11.10.9 ④) ──
    // 원문: *"풍랑주의보 예비특보가 10월 18일 06~12시에 발효될 예정 이 부분을 볼드, 노란색 처리(발효 시에는 빨간색으로)"* · *"하트해변은 과 방문객이 평소의 2.4배로 예상 을 볼드"*
    //   · *"매우 높음, 높음 등 등급은 그 색상으로 볼드 및 색상변경"*. 글은 서버가 준 평문 그대로 — 잘라서 span 의 textContent 로만 넣는다(innerHTML 없음).
    // 특보 종류 = 앱이 이미 쓰는 특보 이름(forecast/alerts/render.js TYPE_RANK 의 태풍·풍랑·강풍·해일·호우·대설 + 서버 station_briefing_inputs.typeOf 의 폭풍해일). 긴 이름 먼저(폭풍해일 → 해일).
    var HL_KINDS = '폭풍해일|태풍|풍랑|강풍|해일|호우|대설';
    // 따옴표 단계 이름 → 단계 순위(색 = colorOf — 위험예측 4색). 연안 위험지수 단계(BAND_ORDER)와 해양사고 위험예보 '주의'·'경계'(브리핑 주의 필요·경계 필요와 같은 순위).
    //   '보통'·'낮음'·'매우높음'(혼잡 예보)은 앱에 그 말의 색이 없어 굵게만(색을 새로 만들지 않는다).
    var HL_LABEL = { '평소 수준': 0, '다소 높음': 1, '높음': 2, '매우 높음': 3, '주의': 2, '경계': 3 }, HL_STEP = { '관심': 1, '주의': 2, '경계': 3 };
    /** 정규식 글자 이스케이프. 예: '경북북부앞바다(대해구 75)' → '경북북부앞바다\(대해구 75\)'. @param {string} t @returns {string} [연계] ← highlightSegments */
    function reEsc(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    /**
     * 분석 문단 글을 강조 토막으로 나눈다(순수 함수 — 시험이 vm 으로 직접 부른다). 겹치면 앞 규칙이 이긴다: ①특보 → ②문장 첫 장소 주어 → ③방문객 배수 → ④단계 말.
     *   ① 특보: 「풍랑주의보 예비특보 … 예정」(그 절 안 — 쉼표·마침표 전까지 「예정」이 있으면 거기까지, 없으면 「…예비특보」까지) → 'warn-pre'(굵게·노랑).
     *      예비특보가 아닌 특보 이름은 그 절에 「예정」이 있으면 'warn-pre', 「발효 중·발효되어·발효되었·발효됩니다·발효되고·발효된·발효돼」가 있으면 거기까지 'warn-on'(굵게·빨강), 둘 다 없으면(해제 등) 강조 없음.
     *   ② 문장 첫머리의 알려진 장소 이름(names — 그 브리핑 자료의 관광지·해역·특보구역 이름)들을 과·와·· 로 이은 것 + 은·는 → 'b'(굵게).
     *   ③ 「방문객이 (각각) 평소의 2.2배와 2.8배로 예상」·「방문객 평소의 1.8배(예상)」 → 'b'.
     *   ④ 따옴표 단계 이름('매우 높음' 등 — 따옴표 포함)·「경계 필요」「주의 필요」「관심 필요」 → 'lv'(굵게, rank 있으면 그 단계 색).
     * 예: highlightSegments("하트해변은 연안 위험지수 '매우 높음'으로 …", ['하트해변']) → [{text:'하트해변은',cls:'b'},{text:' 연안 위험지수 ',cls:null},{text:"'매우 높음'",cls:'lv',rank:3},…]
     *   ⓪(§11.10.9 ⑥) links — 대해구 이름(「경북북부앞바다(대해구 75)」·「대해구 75」, 서버 summary.sea.haegu) → 'link'(key = 대해구 번호) — 화면이 팝업 지도 단추로. 다른 규칙보다 먼저.
     * @param {string} text - 분석 문단(평문) @param {string[]} [names] - 알려진 장소 이름 @param {Array<{text:string,key:string}>} [links] - 링크로 만들 글
     * @returns {Array<{text:string, cls:(string|null), rank?:number, key?:string}>} 이어 붙이면 원문과 같다
     * [연계] ← analysisNodes(summaryBodyV3 분석 문단) · 시험 test_station_briefing.js [§11.10.9-5] / → reEsc
     */
    function highlightSegments(text, names, links) {
        var t = String(text || ''), marks = [];
        var free = function (a, b) { return marks.every(function (m) { return b <= m.a || a >= m.b; }); };
        var add = function (a, b, cls, rank) { if (b > a && free(a, b)) marks.push(rank === undefined ? { a: a, b: b, cls: cls } : { a: a, b: b, cls: cls, rank: rank }); };
        // ⓪ 링크(대해구) — 긴 글 먼저(「…(대해구 75)」가 「대해구 75」보다 먼저). 「대해구 75」 뒤에 숫자가 이어지면(대해구 750) 링크가 아니다
        (links || []).filter(function (l) { return l && l.text; }).sort(function (x, y) { return y.text.length - x.text.length; }).forEach(function (l) {
            var i = -1; while ((i = t.indexOf(l.text, i + 1)) >= 0) if (!/\d/.test(t.charAt(i + l.text.length)) && free(i, i + l.text.length)) marks.push({ a: i, b: i + l.text.length, cls: 'link', key: String(l.key) });
        });
        var clauseEnd = function (i) { var m = /[,，.。!?]/.exec(t.slice(i)); return m ? i + m.index : t.length; };
        // ① 특보
        var wr = new RegExp('(?:' + HL_KINDS + ')(?:주의보|경보)', 'g'), m;
        while ((m = wr.exec(t))) {
            var a = m.index, cl = t.slice(a, clauseEnd(a)), pre = /^\s*예비\s*특보/.exec(cl.slice(m[0].length)), ye = cl.indexOf('예정'), on = /발효\s*중|발효(?:되어|되었|되고|됩니다|된|돼)/.exec(cl);
            if (ye >= 0 && (pre || !on || ye < on.index)) add(a, a + ye + 2, 'warn-pre');
            else if (pre) add(a, a + m[0].length + pre[0].length, 'warn-pre');
            else if (on) add(a, a + on.index + on[0].length, 'warn-on');
        }
        // ② 문장 첫 장소 주어
        var ns = (names || []).filter(function (n) { return n && String(n).length >= 2; }).map(String).sort(function (x, y) { return y.length - x.length; });
        if (ns.length) {
            var alt = '(?:' + ns.map(reEsc).join('|') + ')', subj = new RegExp('(^|[.!?。]\\s+|\\n)(' + alt + '(?:\\s*(?:과|와|·|,)\\s*' + alt + ')*(?:은|는))', 'g');
            while ((m = subj.exec(t))) { var s0 = m.index + m[1].length; add(s0, s0 + m[2].length, 'b'); }
        }
        // ③ 방문객 배수
        var N = '\\d+(?:\\.\\d+)?배', vr = new RegExp('방문객(?:이|은|도)?\\s*(?:각각\\s*)?평소의\\s*' + N + '(?:\\s*(?:와|과|,|·)\\s*' + N + ')*(?:\\s*(?:으로|로)\\s*예상|\\(예상\\))?', 'g');
        while ((m = vr.exec(t))) add(m.index, m.index + m[0].length, 'b');
        // ④ 단계 말
        var lr = /'(매우 높음|다소 높음|평소 수준|높음|보통|낮음|매우높음|주의|경계)'|(경계|주의|관심) 필요/g;
        while ((m = lr.exec(t))) { var rk = m[1] !== undefined ? HL_LABEL[m[1]] : HL_STEP[m[2]]; add(m.index, m.index + m[0].length, 'lv', rk); }
        marks.sort(function (x, y) { return x.a - y.a; });
        var out = [], at = 0;
        marks.forEach(function (k) { if (k.a > at) out.push({ text: t.slice(at, k.a), cls: null }); var seg = { text: t.slice(k.a, k.b), cls: k.cls }; if (k.rank !== undefined) seg.rank = k.rank; if (k.key !== undefined) seg.key = k.key; out.push(seg); at = k.b; });
        if (at < t.length || !out.length) out.push({ text: t.slice(at), cls: null });
        return out;
    }
    /**
     * 분석 문단의 마지막 「따라서 …」 문장을 떼어 (권고)로 — 2026-10-17 사용자 결정(설계서 §11.10.9 ⑤) 원문 *"차라리 본문에 따라서 (권고) 하트해변에는 경계가, … 필요합니다.가 근거의 (권고)에 붙은 노란색 텍스트 스타일로 본문에 반영토록 하는거야. 근거에서는 권고를 빼고."*
     * 화면만 바꾼다 — AI 지시문·검증(마지막 「따라서 … 필요합니다」)은 그대로. 마지막 문장이 「따라서」로 시작하지 않으면(옛 판 등) null(문단 그대로·근거의 (권고) 그대로).
     * 예: splitAdvice('A입니다. 따라서 하트해변에는 경계가 필요합니다.') → {body:'A입니다.', advice:'하트해변에는 경계가 필요합니다.'} · splitAdvice('따라서 X가 필요합니다.') → {body:'', advice:'X가 필요합니다.'} · 'A입니다.' → null
     * @param {string} text @returns {{body:string, advice:string}|null} [연계] ← summaryBodyV3 · 시험 test_station_briefing.js [§11.10.9-6]
     */
    function splitAdvice(text) {
        var t = String(text || ''), m = /(^|[.!?。]\s+)따라서\s+([^]*)$/.exec(t);
        if (!m || /[.!?。]\s+\S/.test(m[2])) return null;   // 「따라서」 뒤에 문장이 더 있으면 마지막 문장이 아니다
        return { body: t.slice(0, m.index + m[1].length).trim(), advice: m[2].trim() };
    }
    /**
     * 그 브리핑에서 문단 주어로 나올 수 있는 장소 이름 — 관광지(관심 이상 전부·카드·상시 위험 장소)·해역 카드·대해구(「경북북부앞바다(대해구 75)」·「대해구 75」·특보구역)·관할 이름.
     * 예: highlightNames(한림 브리핑) → ['한림파출소','협재해수욕장','금능해수욕장',…,'제주도북부앞바다·제주도서부앞바다(대해구 232)','대해구 232',…]
     * @param {Object} b - briefing @returns {string[]} [연계] ← summaryBodyV3 → highlightSegments
     */
    function highlightNames(b) {
        var out = [], add = function (n) { if (n && out.indexOf(String(n)) < 0) out.push(String(n)); };
        if (b && b.station) add(b.station.name);
        var L = (b && b.land) || {}; (L.attentionAll || []).concat(L.cards || [], L.constant || []).forEach(function (c) { add(c && c.name); });
        var S = (b && b.sea) || {}; (S.cards || []).concat(S.overviewTop || []).forEach(function (c) { add(c && c.name); add(c && c.nameBase); });
        var flows = S.weatherByHaegu ? Object.keys(S.weatherByHaegu).map(function (k) { return S.weatherByHaegu[k]; }) : [];
        flows.concat(S.weather ? [S.weather] : []).forEach(function (f) { if (!f) return; add(f.label); if (f.where) { add(f.where + '(' + f.label + ')'); String(f.where).split('·').forEach(add); } });
        return out;
    }
    /**
     * 강조 토막을 DOM 으로(글은 textContent 로만). 'b' 굵게 · 'warn-pre' 굵게 노랑(colorOf(1)) · 'warn-on' 굵게 빨강(.sb-hl-red — §11.10.11 대비용 밝은 빨강) · 'lv' 굵게 + 그 단계 색(경계 = .sb-hl-red, rank 없으면 굵게만).
     * 예: analysisNodes(p, '하트해변은 …', ['하트해변']) → p 에 텍스트·<span class="sb-hl sb-hl-b">하트해변은</span>… 를 붙인다
     * §11.10.9 ⑥: hg = {list:[{major,label,name,box}], area, station} 이 있으면 대해구 이름을 팝업 지도 단추로(관할 경계 + 그 대해구 테두리 깜빡임).
     * @param {HTMLElement} p @param {string} text @param {string[]} names @param {Object} [hg] @returns {void} [연계] ← summaryBodyV3 / → highlightSegments·colorOf·mapLink·openMapPopup
     */
    function analysisNodes(p, text, names, hg) {
        var hl = hg && hg.area && Array.isArray(hg.list) ? hg.list : [], links = [];
        hl.forEach(function (h) { links.push({ text: h.name, key: h.major }); if (h.label && h.label !== h.name) links.push({ text: h.label, key: h.major }); });
        highlightSegments(text, names, links).forEach(function (sg) {
            if (sg.cls === 'link') {
                var h = hl.filter(function (x) { return String(x.major) === sg.key; })[0];
                p.appendChild(mapLink(sg.text, function () { openMapPopup(h.name, function (body) { return miniMap(body, hg.area, [h.box], '빨간 테두리(깜빡임) = ' + h.label + ' 해구 격자 · 파란 선 = ' + hg.station + ' 관할 해역', { big: true }); }, 'haegu'); }, 'haegu'));
                return;
            }
            if (!sg.cls) { p.appendChild(document.createTextNode(sg.text)); return; }
            var sp = el('span', 'sb-hl sb-hl-' + sg.cls, sg.text);
            // 빨강(발효 · 「경계」 단계)은 인라인 색 대신 .sb-hl-red(station_briefing.css — 이 문단 글자에만 쓰는 조금 밝은 빨강, 어두운 카드 위 대비 4.5 이상 · §11.10.11). 지도·배지의 4색은 그대로.
            if (sg.cls === 'warn-pre') sp.style.color = colorOf(1); else if (sg.cls === 'warn-on') sp.classList.add('sb-hl-red'); else if (sg.cls === 'lv' && sg.rank !== undefined) { if (Number(sg.rank) === 3) sp.classList.add('sb-hl-red'); else sp.style.color = colorOf(sg.rank); sp.setAttribute('data-rank', String(sg.rank)); }
            p.appendChild(sp);
        });
    }
    /**
     * 「총평과 권고」 §11.10.4 「가」 모양(2026-10-17 사용자 *"가.로 진행하고"* — 설계서 §11.10.4):
     *   ① [연안 ○○ 필요] 결론 → 연안 분석 문단(AI 3~5문장, 실패면 서버 규칙 분석 — 작은 이름표 「AI 분석 · ChatGPT」/「규칙 분석」) → ▸ 연안 분석 근거(접힘 — (근거)·(권고))
     *   ② [해상 ○○ 필요] 결론(+ 해상 분석 단계가 더 높으면 한 줄) → 해상 분석 문단 → 지금 밀집 줄 → ▸ 해상 분석 근거(접힘 — (근거)(▸ 지도 펼침 그대로)·(권고))
     *   ③ 「{구역} 기상 현황」 ④ (물때)·(고립 주의) — 작은 출처 줄은 §11.10.9 부터 없음(이름표만). 사용자 원문: *"그 분석 아래에 (연안 분석 근거) <- 이 아코디언이 있어서 누르면 육상 분석 근거가 나오고 해상 분석 아래에 (해상 분석 근거) <- 이 아코디언이 있어서 누르면 … 분석 근거가 나오도록"*
     * 예: summaryBodyV3(body, {summary:{analysis:{land:'…',sea:'…'},land:{headline,basis,advice},sea:{…},weather:{…},tide:[…]},…}, resp, {source:'chatgpt',land:'…',sea:'…'}, true, true)
     * @param {HTMLElement} body @param {Object} b @param {Object} resp @param {Object} ov - b.overview @param {boolean} showSea @param {boolean} showLand @returns {void}
     * [연계] ← render / → chip·expander·basisList·weatherPart·tidePart
     */
    function summaryBodyV3(body, b, resp, ov, showSea, showLand) {
        var S = b.summary, A = S.analysis || {}, ai = ov.source === 'chatgpt' || ov.source === 'gemini', who = ov.source === 'chatgpt' ? 'ChatGPT' : 'Gemini';
        var land = showLand && b.land && S.land, sea = showSea && b.sea && S.sea, nowText = showSea && resp.now && resp.now.text ? resp.now.text : null, names = highlightNames(b);
        var hg = S.sea && Array.isArray(S.sea.haegu) && S.sea.haegu.length && Array.isArray(S.sea.area) && S.sea.area.length ? { list: S.sea.haegu, area: S.sea.area, station: (b.station && b.station.name) || '' } : null;   // §11.10.9 ⑥ 대해구 링크
        /** 이름표가 붙은 칸. 예: part('weather','(기상)') → <div class="sb-part" data-sb-part="weather"><p class="sb-sum-k">(기상)</p></div> */
        var part = function (key, label) { var d = el('div', 'sb-part'); d.setAttribute('data-sb-part', key); if (label) d.appendChild(el('p', 'sb-sum-k', label)); body.appendChild(d); return d; };
        /** 연안·해상 한 덩어리 — 결론 → 분석 문단 → (해상이면 지금 밀집) → ▸ 분석 근거. */
        var block = function (kind, label, rank, word, sum, aiText, ruleText) {
            var d = part(kind, null); d.classList.add('sb-sum'); d.setAttribute('data-sb-summary', kind);
            var c = el('div', 'sb-conclusion'); c.appendChild(chip(rank, word, label)); c.appendChild(el('p', 'sb-headline', sum.headline || '')); d.appendChild(c);
            if (kind === 'sea' && b.sea.level && Number(b.sea.level.rank) > Number(b.sea.overviewLevel.rank)) { var ln = el('p', 'sb-small sb-level-note', levelNoteText(b)); ln.setAttribute('data-sb-level-note', ''); d.appendChild(ln); }
            var useAi = !!(ai && aiText), text = useAi ? aiText : ruleText, sp = text ? splitAdvice(text) : null;
            /** (권고) 한 줄 — 근거 칸의 (권고)와 같은 모양(.sb-sum-advice 노랑 굵게, 이름표 .sb-sum-k). */
            var adviceLine = function (txt, src) { var ad = el('p', 'sb-sum-advice'); ad.setAttribute('data-sb-advice', src); ad.appendChild(el('span', 'sb-sum-k', '(권고) ')); ad.appendChild(document.createTextNode(txt)); return ad; };
            if (text) {
                var p = el('p', 'sb-analysis'); p.setAttribute('data-sb-analysis', kind); p.setAttribute('data-sb-analysis-source', useAi ? ov.source : 'rule');
                // 문단 글은 강조 토막으로(§11.10.9 ④ — 특보·장소 주어·방문객 배수·단계 말, textContent 로만). 마지막 「따라서 …」는 떼어 아래 (권고) 줄로(⑤ — 강조 없이 (권고) 모양 그대로)
                var tag = el('span', 'sb-an-tag' + (useAi ? '' : ' sb-an-rule'), useAi ? 'AI 분석 · ' + who : '규칙 분석'); p.appendChild(tag); p.appendChild(document.createTextNode(' ')); analysisNodes(p, sp ? sp.body : text, names, kind === 'sea' ? hg : null); d.appendChild(p);
                if (sp) d.appendChild(adviceLine(sp.advice, 'analysis'));
            } else if (sum.advice) d.appendChild(adviceLine(sum.advice, 'summary'));   // 문단이 없으면(지금 규칙으로는 생기지 않음 — 시험 [§11.10.9-6]) 서버 권고를 결론 아래에 — 권고가 사라지지 않게
            var basisAdvice = !!text && !sp && sum.advice;   // 근거 칸 (권고)는 문단에서 (권고)를 못 뗐을 때만(옛 판 등)
            if (kind === 'sea' && nowText) { d.appendChild(nowNode(resp.now, b)); nowText = null; }   // §11.10.9 ⑥ — 「관할 해역 선박 N척」·붐비는 해역이 팝업 지도 링크
            var rows = Array.isArray(sum.basis) ? sum.basis : [];
            if (rows.length || basisAdvice) {
                // 2026-10-17 사용자 *"너무 딱딱한 디자인 … 연안 분석 근거 상세 보기 해가지고 약간 배지 모양으로 만들어서 그 칸에서 오른쪽으로 정렬"*(§11.10.9) — 알약 배지, 오른쪽(.sb-basis-x)
                var x = expander(label + ' 분석 근거 상세 보기', function (panel) {
                    if (rows.length) { panel.appendChild(el('p', 'sb-sum-k', '(근거)')); panel.appendChild(basisList({ basis: rows, area: sum.area, detail: sum.detail, raised: sum.raised }, b)); }
                    if (basisAdvice) panel.appendChild(adviceLine(sum.advice, 'basis'));
                }, 'basis-' + kind, true);
                var row = el('p', 'sb-basis-x'); row.appendChild(x.btn); d.appendChild(row); d.appendChild(x.panel);
            }
        };
        if (land) block('land', '연안', b.land.level.rank, b.land.level.word, S.land, ov.land, A.land);
        if (sea) block('sea', '해상', b.sea.overviewLevel.rank, b.sea.overviewLevel.word, S.sea, ov.sea, A.sea);
        if (nowText) { var nw = el('p', 'sb-now', nowText); nw.setAttribute('data-sb-now', ''); body.appendChild(nw); }
        weatherPart(part, S);
        tidePart(part, S, land, b);
        // 맨 아래 작은 출처 줄(「분석 문단은 ChatGPT가 썼습니다 — 숫자·지명·단계는 …」/「규칙 분석 — …」)은 없앴다 — 2026-10-17 사용자 *"굳이 필요가 없어 … 아예 다 빼줘"*(§11.10.9).
        //   누가 썼는지는 분석 문단 앞 이름표(「AI 분석 · ChatGPT」/「규칙 분석」 — data-sb-analysis-source)가 그대로 보인다.
    }
    /**
     * 「총평과 권고」 종전 모양 — summary 가 없는 브리핑(2026-10-17 전에 저장된 10-16·10-17 파일 등)용: 단계 배지 · 육상/해상 문단(overview.land/sea) · 근거 ▸ 접힘 · 출처 작은 글씨.
     * @param {HTMLElement} body @param {Object} b @param {Object} resp @param {Object} ov @param {boolean} showSea @param {boolean} showLand @returns {void}
     * [연계] ← render
     */
    function legacyOverview(body, b, resp, ov, showSea, showLand) {
        var s1 = { body: body };   // 종전 render 안의 코드를 그대로 옮겨 s1.body 이름을 유지
        var levels = el('div', 'sb-levels');
        if (showLand && b.land && b.land.level) { levels.appendChild(el('span', 'sb-level-k', '연안')); levels.appendChild(chip(b.land.level.rank, b.land.level.word)); }
        if (showSea && b.sea && b.sea.overviewLevel) { levels.appendChild(el('span', 'sb-level-k', '해상')); levels.appendChild(chip(b.sea.overviewLevel.rank, b.sea.overviewLevel.word)); }
        if (levels.childNodes.length) s1.body.appendChild(levels);
        // 총평 해상 단계(거른 뒤)가 해상 분석 단계보다 낮으면 한 줄 — 초록 「평소 수준」이 「안전」으로 읽히지 않게(2단계 검토 B1).
        if (showSea && b.sea && b.sea.level && b.sea.overviewLevel && Number(b.sea.level.rank) > Number(b.sea.overviewLevel.rank)) {
            var ln = el('p', 'sb-small sb-level-note', levelNoteText(b));
            ln.setAttribute('data-sb-level-note', ''); s1.body.appendChild(ln);
        }
        if (showLand && ov.land) { var pl = el('p', 'sb-overview'); pl.setAttribute('data-sb-overview', 'land'); pl.appendChild(el('b', 'sb-overview-k', '연안 ')); pl.appendChild(document.createTextNode(ov.land)); s1.body.appendChild(pl); }
        if (showSea && ov.sea) { var ps = el('p', 'sb-overview'); ps.setAttribute('data-sb-overview', 'sea'); ps.appendChild(el('b', 'sb-overview-k', '해상 ')); ps.appendChild(document.createTextNode(ov.sea)); s1.body.appendChild(ps); }
        if (showSea && resp.now && resp.now.text) s1.body.appendChild(el('p', 'sb-now', resp.now.text));
        // 근거 ▸ (접힘) — 총평에 쓴 해역·관광지와 그 근거
        var basisItems = [];
        if (showSea && b.sea) {
            (b.sea.overviewTop || []).forEach(function (c) { if (c && c.overview) basisItems.push('해상 · ' + (c.overview.window ? c.overview.window + ' ' : '') + c.name + ' — ' + (c.overview.label || c.sourceLabel || '')); });
            if (b.sea.weather && b.sea.weather.text) basisItems.push('해상 · ' + b.sea.weather.text);
        }
        if (showLand && b.land) (b.land.overviewTop || []).forEach(function (c) { basisItems.push('연안 · ' + c.name + ' — ' + (c.sourceLabel || '') + (c.today && c.today.text ? ' (' + c.today.text + ')' : '')); });
        if (basisItems.length) { var d = el('details', 'sb-basis'); d.appendChild(el('summary', '', '근거')); d.appendChild(list(basisItems)); s1.body.appendChild(d); }
        var srcNote = ov.source === 'template' ? '기본 문장(틀) — AI 총평 대신 서버 규칙으로 만든 문장입니다.' : ov.source === 'chatgpt' || ov.source === 'gemini' ? (ov.source === 'chatgpt' ? 'ChatGPT' : 'Gemini') + '가 쓴 총평 — 숫자·지명·단계는 서버가 계산한 값만 씁니다' + (ov.reused ? '(지난 판과 입력이 같아 재사용)' : '') + '.' : null;
        if (srcNote) { var sn = el('p', 'sb-small sb-source'); sn.setAttribute('data-sb-source', ov.source); sn.textContent = srcNote; s1.body.appendChild(sn); }
    }
    /**
     * 총평 아래 나머지 칸(특별 상황·해상 분석·육상 분석·조석·꼬리)을 그린다 — 종전 render 뒷부분 그대로.
     * @param {HTMLElement} box @param {Object} b @param {Object} opts @param {boolean} showSea @param {boolean} showLand @param {number} nowMs @returns {void}
     * [연계] ← render / → section·timeBar·seaCard·landCard·tide
     */
    function renderRest(box, b, opts, showSea, showLand, nowMs) {
        // ② 특별 상황(특보 해제 예고·예비·이미 해제 — 기상청 시각 그대로)
        if (Array.isArray(b.special) && b.special.length) {
            var s2 = section('특별 상황', 'special');
            b.special.forEach(function (x) {
                var it = el('div', 'sb-special'); it.setAttribute('data-kind', x.kind || '');
                it.appendChild(el('p', 'sb-special-title', '⚑ ' + (x.title || '')));
                (x.lines || []).forEach(function (l) { it.appendChild(el('p', 'sb-special-line', l)); });
                s2.body.appendChild(it);
            });
            box.appendChild(s2.root);
        }

        // ③④ 해상 분석 — 시간 막대 + 해역 카드
        if (showSea && b.sea) {
            var sea = b.sea, s3 = section('해상 분석', 'sea');
            var sh = el('div', 'sb-sec-head'); sh.appendChild(chip(sea.level && sea.level.rank, sea.level && sea.level.word)); if (sea.level && sea.level.source) sh.appendChild(el('span', 'sb-tag', sea.level.source)); s3.body.appendChild(sh);
            var nAtt = sea.attentionRegions || 0, nCards = Array.isArray(sea.cards) ? sea.cards.length : 0, nAcc = Number.isFinite(sea.overviewRegions) ? Math.max(0, nAtt - sea.overviewRegions) : 0;
            // 칸 = 해역 묶음(reviewedRegions — 총평 근거와 같은 단위, §11.10.3). 그 전 브리핑은 reviewedCells.
            var nAll = Number.isFinite(sea.reviewedRegions) ? sea.reviewedRegions : (sea.reviewedCells || 0);
            var cnt = el('p', 'sb-small', '관할 해역 ' + nAll + '칸 검토 · 관심 이상 ' + nAtt + '칸' + (nAcc ? '(그중 해양사고 위험예보만 위험 단계인 해역 ' + nAcc + '칸 — 총평에는 올리지 않음)' : '') + (nAtt > nCards ? ' · 카드는 단계 높은 순 ' + nCards + '곳까지' : ''));
            cnt.setAttribute('data-sb-sea-count', ''); s3.body.appendChild(cnt);
            if (Array.isArray(sea.missing) && sea.missing.length) s3.body.appendChild(el('p', 'sb-miss', '확인하지 못한 자료: ' + sourceNames(sea.missing) + ' — 그 근거는 판단에서 뺐습니다.'));
            if (sea.missingSlots && Array.isArray(sea.missingSlots.accident) && sea.missingSlots.accident.length) s3.body.appendChild(el('p', 'sb-miss', '해양사고 위험예보를 받지 못한 시각: ' + sea.missingSlots.accident.map(function (a) { return String(a).slice(11, 13) + '시'; }).join('·')));
            if (sea.weather && sea.weather.text) s3.body.appendChild(el('p', 'sb-weather', sea.weather.text));
            if (Array.isArray(sea.timeBar) && sea.timeBar.length) s3.body.appendChild(timeBar(sea.timeBar, nowMs));
            if (Array.isArray(sea.cards) && sea.cards.length) sea.cards.forEach(function (c) { s3.body.appendChild(seaCard(c, opts)); });
            else s3.body.appendChild(el('p', 'sb-small', (sea.missing && sea.missing.length ? '확인된 자료에서는 ' : '') + '관심 이상인 해역이 없습니다.'));
            box.appendChild(s3.root);
        }

        // ⑤ 육상 분석 — 관광지 카드 + 상시 위험 장소. 해상만 관할(land null)은 육상 보기를 꺼 두었어도 이유 한 줄을 보인다(계약 §7).
        if (showLand || !b.land) {
            var s4 = section('연안 분석', 'land');
            if (!b.land) s4.body.appendChild(el('p', 'sb-small', b.seaOnlyReason || '이 관할은 해상 브리핑만 제공합니다.'));
            else {
                var land = b.land, lh = el('div', 'sb-sec-head'); lh.appendChild(chip(land.level && land.level.rank, land.level && land.level.word)); if (land.level && land.level.source) lh.appendChild(el('span', 'sb-tag', land.level.source)); s4.body.appendChild(lh);
                var nLand = Array.isArray(land.cards) ? land.cards.length : 0;
                var lc = el('p', 'sb-small', '관광지 ' + (land.reviewedSpots || 0) + '곳 검토' + (land.reviewedHazards ? ' · 관광지에 붙지 않은 위험구역 ' + land.reviewedHazards + '곳' : '') + (land.failedSpots ? ' · 관광지 ' + land.failedSpots + '곳 자료 확인 불가' : '') + (Number(land.attentionSpots) > nLand ? ' · 관심 이상 ' + land.attentionSpots + '곳 중 카드는 단계 높은 순 ' + nLand + '곳까지' : ''));
                lc.setAttribute('data-sb-land-count', ''); s4.body.appendChild(lc);
                if (Array.isArray(land.missing) && land.missing.length) s4.body.appendChild(el('p', 'sb-miss', '확인하지 못한 자료: ' + sourceNames(land.missing)));
                if (Array.isArray(land.cards) && land.cards.length) land.cards.forEach(function (c) { s4.body.appendChild(landCard(c, opts)); });
                else { var ne = el('p', 'sb-small', dayWord(b) + ' 평소와 달라진 요소(사람·행사·너울·이안류·특보·바람)가 있는 관광지가 없습니다.'); ne.setAttribute('data-sb-land-none', ''); s4.body.appendChild(ne); }
                if (Array.isArray(land.constant) && land.constant.length) {
                    var cd = el('details', 'sb-constant'); cd.appendChild(el('summary', '', '상시 위험 장소 (' + land.constant.length + ')'));
                    var cl = el('ul', 'sb-list');
                    land.constant.forEach(function (c) { var li = el('li'); li.appendChild(el('b', '', c.name || '')); if (c.text) li.appendChild(document.createTextNode(' — ' + c.text)); cl.appendChild(li); });
                    cd.appendChild(cl); s4.body.appendChild(cd);
                }
            }
            box.appendChild(s4.root);
        }

        // ⑥ 조석(서해·남해·제주 관할)
        if (b.tide) { var s5 = section('조석', 'tide'); s5.body.appendChild(tide(b.tide, nowMs, b)); box.appendChild(s5.root); }

        // ⑦ 기준 시각·출처·참고 정보
        var foot = el('div', 'sb-foot');
        foot.appendChild(el('p', '', '기준 시각 ' + kstText(b.generatedAt) + ' · ' + editionLabel(b) + (b.window ? ' · 다루는 시간 ' + kstText(b.window.from) + ' ~ ' + kstText(b.window.to) : '')));
        var fs = el('p', '', '출처: ' + SOURCES.map(function (r) { return r[0] + ' — ' + r[1]; }).join(' · ')); fs.setAttribute('data-sb-foot-source', ''); foot.appendChild(fs);
        foot.appendChild(el('p', 'sb-notice', b.notice || '참고 정보이며 안전을 보장하지 않습니다.'));
        box.appendChild(foot);
    }
    // blinking() = 지금 깜빡이는 지도 수(시험이 접기·다시 그리기 뒤 0 인지 본다 — §11.10.3)
    w.StationBriefingRender = { render: render, titleText: titleText, editionTime: editionTime, subtitleText: subtitleText, colorOf: colorOf, kstText: kstText, dateText: dateText, sourceNames: sourceNames, dayWord: dayWord, highlightSegments: highlightSegments, highlightNames: highlightNames, splitAdvice: splitAdvice, closeMapPopup: closeMapPopup, WORDS: WORDS, SOURCES: SOURCES, blinking: function () { return blinking; } };
})(window);
