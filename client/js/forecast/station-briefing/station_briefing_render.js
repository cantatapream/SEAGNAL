/**
 * ============================================================================
 * 파일명: client/js/forecast/station-briefing/station_briefing_render.js
 * 역할  : 「활동지점 안전 브리핑」 본문을 그린다 — 서버가 만든 브리핑(총평과 권고 = 서버 결론·(기상)·(물때)·근거·권고 + AI 해설 · 특별 상황·해상 시간 막대·해역 카드·육상 카드·조석·기준 시각)을
 *         화면 칸으로 옮긴다. 서버 글은 모두 textContent 로만 넣는다(계약서 §5 「화면은 textContent 로만」 — HTML 삽입 금지).
 *         HTML 로 넣는 것은 조석 게이지(해양종합정보 OS.tideGaugeHtml 이 숫자·시각만으로 만든 것)뿐이다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/bottom-sheet/ocean_bottom_sheet3.js(OceanSheet.tideGaugeHtml — 조석 게이지 디자인 그대로)
 *                    · marine-life/risk-forecast/risk_format.js(RiskFormat.BAND_COLORS — 위험예측 4색) · risk_basis.js(RiskBasis.open('briefing') — [기준 상세])
 *                    · style.css(.marine-forecast-sub-accordion·.ocean-tide-*) · station_briefing.css(.sb-*)
 *  - 서버 API      : 없음(받은 응답만 그린다 — 받기는 station_briefing.js · admin_station_briefing.js)
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
    var SOURCE_LABEL = { accident: '공식 사고예보', congestion: '혼잡 예보', zoneForecasts: '해구 예보', warnings: '기상특보', concentration: '관광지 사람 집중률', tourConcentration: '관광지 사람 집중률', hazard: '위험구역', events: '행사', rip: '이안류', gale: '강풍 자료', forecast: '해구 예보', detail: '관광지 상세', swell: '너울' };
    var EDITION = { morning: '08:00 판', evening: '17:30 판', night: '23:00 판(오늘 밤~내일)', warning: '특보 변경 판', manual: '관리자 즉시 실행 판' };
    var DOW = ['일', '월', '화', '수', '목', '금', '토'];
    // 쓰는 자료와 출처 — [기준 상세] 표(station_briefing_basis.js)와 본문 꼬리 「출처」 줄이 이 한 벌을 같이 쓴다(2단계 검토 B10 — 둘이 어긋나 있었다).
    // [자료, 출처, 쓰는 곳]. 출처는 수집기·자료 파일 머리 주석으로 확인한 것만(build_accidents.js 개방海 「선박사고(해경)」·「인명사고」, build_coast_accidents.py 유형·500m·2020~2024,
    // marine_fusion.js 선박사고 최근 5년(자료 마지막 해 2025), coastal_events_collector.js 관광공사+Gemini 보충, scheduler.js 이안류 KHOA+기상청, swell_smallzone.js 기상청 MMIS 너울).
    var SOURCES = [
        ['선박 사고위험 예보(3시간)', '한국해양교통안전공단 MTIS', '해상 단계'],
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
     * 단계 배지(색 상자 + 단계 말). 노랑·주황 위에는 어두운 글자.
     * 예: chip(2,'주의 필요') → <span class="sb-chip" style="background:#fb923c;color:#111">주의 필요</span>
     * @param {number} rank @param {string} word @returns {HTMLElement} [연계] ← 총평·카드·분석 머리
     */
    function chip(rank, word) {
        var c = el('span', 'sb-chip', word || WORDS[rank] || '—'), bg = colorOf(rank, word);
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
     * @param {Object} t - briefing.tide @param {number} nowMs - 지금(ms) @returns {HTMLElement}
     * [연계] ← render / → OceanSheet.tideGaugeHtml(ocean_bottom_sheet3.js buildTideGauge)
     */
    function tide(t, nowMs) {
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
        (t.text || []).forEach(function (line) { box.appendChild(el('p', 'sb-tide-text', line)); });
        if (t.anchor && Number.isFinite(Number(t.anchor.distKm))) box.appendChild(el('p', 'sb-small', '관할 대표 위치에서 ' + Number(t.anchor.distKm) + 'km 떨어진 조석 지점 기준'));
        return box;
    }
    /**
     * 다음 판 안내 — 예정 시각이 아직이면 「다음 브리핑 예정: …」, 이미 지났으면 「다음 브리핑을 준비 중입니다(… 예정)」(만들기 시작 뒤 AI 총평에 최대 20분 — 2단계 검토 B14).
     * 예: nextText('2026-10-17T23:00:00+09:00', 10-17 21:30) → '다음 브리핑 예정: 10월 17일(토) 23:00' · 23:05 → '다음 브리핑을 준비 중입니다(10월 17일(토) 23:00 시작)'
     * @param {string} iso @param {number} nowMs @returns {string} [연계] ← render(브리핑 없음·fallback)
     */
    function nextText(iso, nowMs) { return Date.parse(iso) <= nowMs ? '다음 브리핑을 준비 중입니다(' + kstText(iso) + ' 시작)' : '다음 브리핑 예정: ' + kstText(iso); }
    /**
     * 브리핑 응답 하나를 그린다(그릇 안을 비우고 새로). 브리핑이 없으면 안내(다음 예정 시각)만.
     * 예: render(document.getElementById('station-briefing-content'), {ok:true,display:true,date:'2026-10-17',briefing:{…},now:null}, {showSea:true,showLand:true,onLink:fn})
     * @param {HTMLElement} box @param {Object} resp - GET /api/station-briefing(또는 관리자 preview) 응답
     * @param {Object} [opts] - showSea·showLand(기본 true)·links(false 면 바로가기 없음)·onLink(target,btn)·now(ms, 시험용)
     * @returns {void}
     * [연계] ← station_briefing.js renderBody · admin_station_briefing.js 미리보기 / → summaryBodyV2(§11.10.1 총평)·summaryBody(§11.10 판)·legacyOverview(그 전)·renderRest·RiskBasis.open
     */
    function render(box, resp, opts) {
        opts = opts || {};
        var showSea = opts.showSea !== false, showLand = opts.showLand !== false, nowMs = Number.isFinite(opts.now) ? opts.now : Date.now();
        box.textContent = '';
        var b = resp && resp.briefing;
        var top = el('div', 'sb-meta');
        var left = el('div', 'sb-meta-text');
        if (b && b.station) left.appendChild(el('strong', 'sb-station', (b.station.name || '') + (b.station.office ? ' · ' + b.station.office : '')));
        if (b) left.appendChild(el('span', 'sb-edition', dateText(b.targetDate) + ' 브리핑 · ' + (EDITION[b.edition] || '') + ' · ' + kstText(b.generatedAt) + ' 생성'));
        top.appendChild(left);
        var basis = el('button', 'rf-basis-btn sb-basis-btn', '기준 상세'); basis.type = 'button';
        basis.addEventListener('click', function (e) { e.stopPropagation(); if (w.RiskBasis) w.RiskBasis.open('briefing', basis); });
        top.appendChild(basis);
        box.appendChild(top);
        if (!b) {
            var empty = el('div', 'sb-empty');
            empty.appendChild(el('p', '', '아직 이 관할의 브리핑이 없습니다.'));
            empty.appendChild(el('p', 'sb-small', resp && resp.nextExpectedAt ? nextText(resp.nextExpectedAt, nowMs) : '브리핑은 매일 08:00 · 17:30 · 23:00에 만들기 시작하고(AI 총평을 쓰면 최대 20분 뒤 보입니다), 특보가 바뀌면 다시 만듭니다.'));
            box.appendChild(empty);
            return;
        }
        if (resp.fallback) box.appendChild(el('p', 'sb-note', dateText(resp.wanted) + ' 브리핑(23:00 생성)이 아직 없어 ' + dateText(resp.date) + ' 브리핑을 보여 드립니다' + (resp.nextExpectedAt ? ' — ' + nextText(resp.nextExpectedAt, nowMs) : '') + '.'));

        // ① 총평과 권고 — summary.weather 칸이 있으면(§11.10.1) 결론 → (기상) → (물때) → 근거·권고 → AI 해설,
        //   summary 만 있으면(§11.10 판 — 10-17 낮에 저장된 파일) 육상·해상 덩어리 모양, 없으면(그 전) 종전 문단 모양
        var ov = b.overview || {}, s1 = section('총평과 권고', 'overview');
        if (b.summary && Object.prototype.hasOwnProperty.call(b.summary, 'weather')) summaryBodyV2(s1.body, b, resp, ov, showSea, showLand);
        else if (b.summary) summaryBody(s1.body, b, resp, ov, showSea, showLand); else legacyOverview(s1.body, b, resp, ov, showSea, showLand);
        box.appendChild(s1.root);
        renderRest(box, b, opts, showSea, showLand, nowMs);
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
                var ln = el('p', 'sb-small sb-level-note', '해상 분석에는 「' + (b.sea.level.word || WORDS[b.sea.level.rank]) + '」 해역이 있습니다 — 공식 사고예보 단계만 있고 기상·혼잡 근거가 겹치지 않아 총평에는 올리지 않았습니다. 아래 해상 분석을 보세요.');
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
        if (showLand && b.land && b.summary.land) block('land', '육상', b.land.level.rank, b.land.level.word, b.summary.land, ov.land);
        if (showSea && b.sea && b.summary.sea) block('sea', '해상', b.sea.overviewLevel.rank, b.sea.overviewLevel.word, b.summary.sea, ov.sea);
        if (showSea && resp.now && resp.now.text) body.appendChild(el('p', 'sb-now', resp.now.text));
        var note = ai && (ov.land || ov.sea) ? '해설은 ' + who + '가 썼습니다 — 숫자·지명·단계는 서버가 계산한 값만 씁니다' + (ov.reused ? '(지난 판과 입력이 같아 재사용)' : '') + '. 결론·근거·권고는 서버가 계산한 값입니다.'
            : 'AI 해설 없음 — 결론·근거·권고는 서버가 계산한 값입니다.';
        var sn = el('p', 'sb-small sb-source', note); sn.setAttribute('data-sb-source', ai ? ov.source : 'template'); body.appendChild(sn);
    }
    /**
     * 「총평과 권고」 §11.10.1 모양(2026-10-17 사용자 후속 결정 — *"결론 한줄 -> 기상(…가장 가까운 특보구역…오전, 오후…) … / 물때 / 연안의 안전 등급 분석에 근거…"*):
     *   ① 결론(육상·해상 단계 배지 + 결론 한 줄씩) ② (기상) 가장 가까운 앞바다 단기 해상예보 오전·오후 두 줄 + 출처 + (특이사항) 지방기상청 단기 전망 대상일 것
     *   ③ (물때) 공용 ④ 육상 (근거)·(권고) ⑤ 해상 (근거)·(권고) ⑥ AI 해설(있으면). 자료가 없으면 「기상예보 자료를 확인하지 못했습니다」. 글은 모두 textContent.
     * 예: summaryBodyV2(body, {summary:{weather:{zone:'제주도서부앞바다',rows:[{label:'오늘 오전',text:'…'}],source:'…',notes:[…]},tide:[…],land:{…},sea:{…}},…}, resp, ov, true, true)
     * @param {HTMLElement} body @param {Object} b @param {Object} resp @param {Object} ov @param {boolean} showSea @param {boolean} showLand @returns {void}
     * [연계] ← render / → chip·list
     */
    function summaryBodyV2(body, b, resp, ov, showSea, showLand) {
        var S = b.summary, ai = ov.source === 'chatgpt' || ov.source === 'gemini', who = ov.source === 'chatgpt' ? 'ChatGPT' : 'Gemini';
        var land = showLand && b.land && S.land, sea = showSea && b.sea && S.sea;
        /** 이름표가 붙은 칸. 예: part('weather','(기상)') → <div class="sb-part" data-sb-part="weather"><p class="sb-sum-k">(기상)</p></div> */
        var part = function (key, label) { var d = el('div', 'sb-part'); d.setAttribute('data-sb-part', key); if (label) d.appendChild(el('p', 'sb-sum-k', label)); body.appendChild(d); return d; };
        // ① 결론
        var c = part('conclusion', null);
        var head = function (label, rank, word, text) { var r = el('div', 'sb-conclusion'); var lv = el('span', 'sb-levels'); lv.appendChild(el('span', 'sb-level-k', label)); lv.appendChild(chip(rank, word)); r.appendChild(lv); r.appendChild(el('p', 'sb-headline', text || '')); c.appendChild(r); };
        if (land) head('육상', b.land.level.rank, b.land.level.word, S.land.headline);
        if (sea) {
            head('해상', b.sea.overviewLevel.rank, b.sea.overviewLevel.word, S.sea.headline);
            if (b.sea.level && Number(b.sea.level.rank) > Number(b.sea.overviewLevel.rank)) {
                var ln = el('p', 'sb-small sb-level-note', '해상 분석에는 「' + (b.sea.level.word || WORDS[b.sea.level.rank]) + '」 해역이 있습니다 — 공식 사고예보 단계만 있고 기상·혼잡 근거가 겹치지 않아 총평에는 올리지 않았습니다. 아래 해상 분석을 보세요.');
                ln.setAttribute('data-sb-level-note', ''); c.appendChild(ln);
            }
        }
        // ② (기상)
        var W = S.weather || {}, wp = part('weather', '(기상)' + (W.zone ? ' ' + W.zone : ''));
        if (W.zone && Number.isFinite(Number(W.distKm))) wp.appendChild(el('p', 'sb-small', '파출소 대표 위치에서 가장 가까운 특보구역(약 ' + Number(W.distKm) + 'km)'));
        if (!W.missing && Array.isArray(W.rows) && W.rows.length) {
            var wl = el('ul', 'sb-list sb-wx-rows'); W.rows.forEach(function (r) { var li = el('li'); li.appendChild(el('b', '', r.label + ' ')); li.appendChild(document.createTextNode(r.text)); wl.appendChild(li); }); wp.appendChild(wl);
            if (W.source) wp.appendChild(el('p', 'sb-small', W.source));
        } else { var wm = el('p', 'sb-miss', '기상예보 자료를 확인하지 못했습니다.'); wm.setAttribute('data-sb-wx-missing', ''); wp.appendChild(wm); }
        wp.appendChild(el('p', 'sb-sum-k', '(특이사항)'));
        if (W.bulletinMissing) wp.appendChild(el('p', 'sb-miss', '지방기상청 단기 전망 자료를 확인하지 못했습니다.'));
        else if (Array.isArray(W.notes) && W.notes.length) { var nl = list(W.notes); nl.classList.add('sb-wx-notes'); wp.appendChild(nl); }
        else wp.appendChild(el('p', 'sb-small', '이 날에 해당하는 특보·강풍·해상 특이사항이 단기 전망에 없습니다.'));
        if (!W.bulletinMissing && W.notesSource) wp.appendChild(el('p', 'sb-small', W.notesSource));
        // ③ (물때)
        if (Array.isArray(S.tide) && S.tide.length) { var tp = part('tide', '(물때)'); S.tide.forEach(function (t) { tp.appendChild(el('p', 'sb-sum-tide', t)); }); }
        // ④⑤ 육상·해상 근거·권고
        var basis = function (kind, label, sum) {
            var d = part(kind, null); d.setAttribute('data-sb-summary', kind); d.classList.add('sb-sum');
            d.appendChild(el('p', 'sb-part-title', label));
            if (Array.isArray(sum.basis) && sum.basis.length) { d.appendChild(el('p', 'sb-sum-k', '(근거)')); var ul = list(sum.basis); ul.classList.add('sb-sum-basis'); d.appendChild(ul); }
            if (sum.advice) { var ad = el('p', 'sb-sum-advice'); ad.appendChild(el('span', 'sb-sum-k', '(권고) ')); ad.appendChild(document.createTextNode(sum.advice)); d.appendChild(ad); }
        };
        if (land) basis('land', '육상', S.land);
        if (sea) basis('sea', '해상', S.sea);
        // ⑥ AI 해설
        if (ai && ((land && ov.land) || (sea && ov.sea))) {
            var cp = part('commentary', null);
            [['land', '육상', land && ov.land], ['sea', '해상', sea && ov.sea]].forEach(function (x) {
                if (!x[2]) return;
                var cm = el('p', 'sb-commentary'); cm.setAttribute('data-sb-commentary', x[0]);
                cm.appendChild(el('span', 'sb-commentary-k', '해설 · ' + who + ' · ' + x[1] + ' ')); cm.appendChild(document.createTextNode(x[2])); cp.appendChild(cm);
            });
        }
        if (showSea && resp.now && resp.now.text) body.appendChild(el('p', 'sb-now', resp.now.text));
        var note = ai && (ov.land || ov.sea) ? '해설은 ' + who + '가 썼습니다 — 숫자·지명·단계는 서버가 계산한 값만 씁니다' + (ov.reused ? '(지난 판과 입력이 같아 재사용)' : '') + '. 결론·기상·근거·권고는 서버가 모은·계산한 값입니다.'
            : 'AI 해설 없음 — 결론·기상·근거·권고는 서버가 모은·계산한 값입니다.';
        var sn = el('p', 'sb-small sb-source', note); sn.setAttribute('data-sb-source', ai ? ov.source : 'template'); body.appendChild(sn);
    }
    /**
     * 「총평과 권고」 종전 모양 — summary 가 없는 브리핑(2026-10-17 전에 저장된 10-16·10-17 파일 등)용: 단계 배지 · 육상/해상 문단(overview.land/sea) · 근거 ▸ 접힘 · 출처 작은 글씨.
     * @param {HTMLElement} body @param {Object} b @param {Object} resp @param {Object} ov @param {boolean} showSea @param {boolean} showLand @returns {void}
     * [연계] ← render
     */
    function legacyOverview(body, b, resp, ov, showSea, showLand) {
        var s1 = { body: body };   // 종전 render 안의 코드를 그대로 옮겨 s1.body 이름을 유지
        var levels = el('div', 'sb-levels');
        if (showLand && b.land && b.land.level) { levels.appendChild(el('span', 'sb-level-k', '육상')); levels.appendChild(chip(b.land.level.rank, b.land.level.word)); }
        if (showSea && b.sea && b.sea.overviewLevel) { levels.appendChild(el('span', 'sb-level-k', '해상')); levels.appendChild(chip(b.sea.overviewLevel.rank, b.sea.overviewLevel.word)); }
        if (levels.childNodes.length) s1.body.appendChild(levels);
        // 총평 해상 단계(거른 뒤)가 해상 분석 단계보다 낮으면 한 줄 — 초록 「평소 수준」이 「안전」으로 읽히지 않게(2단계 검토 B1).
        if (showSea && b.sea && b.sea.level && b.sea.overviewLevel && Number(b.sea.level.rank) > Number(b.sea.overviewLevel.rank)) {
            var ln = el('p', 'sb-small sb-level-note', '해상 분석에는 「' + (b.sea.level.word || WORDS[b.sea.level.rank]) + '」 해역이 있습니다 — 공식 사고예보 단계만 있고 기상·혼잡 근거가 겹치지 않아 총평에는 올리지 않았습니다. 아래 해상 분석을 보세요.');
            ln.setAttribute('data-sb-level-note', ''); s1.body.appendChild(ln);
        }
        if (showLand && ov.land) { var pl = el('p', 'sb-overview'); pl.setAttribute('data-sb-overview', 'land'); pl.appendChild(el('b', 'sb-overview-k', '육상 ')); pl.appendChild(document.createTextNode(ov.land)); s1.body.appendChild(pl); }
        if (showSea && ov.sea) { var ps = el('p', 'sb-overview'); ps.setAttribute('data-sb-overview', 'sea'); ps.appendChild(el('b', 'sb-overview-k', '해상 ')); ps.appendChild(document.createTextNode(ov.sea)); s1.body.appendChild(ps); }
        if (showSea && resp.now && resp.now.text) s1.body.appendChild(el('p', 'sb-now', resp.now.text));
        // 근거 ▸ (접힘) — 총평에 쓴 해역·관광지와 그 근거
        var basisItems = [];
        if (showSea && b.sea) {
            (b.sea.overviewTop || []).forEach(function (c) { if (c && c.overview) basisItems.push('해상 · ' + (c.overview.window ? c.overview.window + ' ' : '') + c.name + ' — ' + (c.overview.label || c.sourceLabel || '')); });
            if (b.sea.weather && b.sea.weather.text) basisItems.push('해상 · ' + b.sea.weather.text);
        }
        if (showLand && b.land) (b.land.overviewTop || []).forEach(function (c) { basisItems.push('육상 · ' + c.name + ' — ' + (c.sourceLabel || '') + (c.today && c.today.text ? ' (' + c.today.text + ')' : '')); });
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
            var cnt = el('p', 'sb-small', '관할 안 ' + (sea.reviewedCells || 0) + '칸 검토 · 관심 이상 ' + nAtt + '개 해역' + (nAcc ? '(그중 공식 사고예보 단계만 있는 해역 ' + nAcc + '개 — 총평에는 올리지 않음)' : '') + (nAtt > nCards ? ' · 카드는 단계 높은 순 ' + nCards + '곳까지' : ''));
            cnt.setAttribute('data-sb-sea-count', ''); s3.body.appendChild(cnt);
            if (Array.isArray(sea.missing) && sea.missing.length) s3.body.appendChild(el('p', 'sb-miss', '확인하지 못한 자료: ' + sourceNames(sea.missing) + ' — 그 근거는 판단에서 뺐습니다.'));
            if (sea.missingSlots && Array.isArray(sea.missingSlots.accident) && sea.missingSlots.accident.length) s3.body.appendChild(el('p', 'sb-miss', '공식 사고예보를 받지 못한 시각: ' + sea.missingSlots.accident.map(function (a) { return String(a).slice(11, 13) + '시'; }).join('·')));
            if (sea.weather && sea.weather.text) s3.body.appendChild(el('p', 'sb-weather', sea.weather.text));
            if (Array.isArray(sea.timeBar) && sea.timeBar.length) s3.body.appendChild(timeBar(sea.timeBar, nowMs));
            if (Array.isArray(sea.cards) && sea.cards.length) sea.cards.forEach(function (c) { s3.body.appendChild(seaCard(c, opts)); });
            else s3.body.appendChild(el('p', 'sb-small', (sea.missing && sea.missing.length ? '확인된 자료에서는 ' : '') + '관심 이상인 해역이 없습니다.'));
            box.appendChild(s3.root);
        }

        // ⑤ 육상 분석 — 관광지 카드 + 상시 위험 장소. 해상만 관할(land null)은 육상 보기를 꺼 두었어도 이유 한 줄을 보인다(계약 §7).
        if (showLand || !b.land) {
            var s4 = section('육상 분석', 'land');
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
        if (b.tide) { var s5 = section('조석', 'tide'); s5.body.appendChild(tide(b.tide, nowMs)); box.appendChild(s5.root); }

        // ⑦ 기준 시각·출처·참고 정보
        var foot = el('div', 'sb-foot');
        foot.appendChild(el('p', '', '기준 시각 ' + kstText(b.generatedAt) + ' · ' + (EDITION[b.edition] || '') + (b.window ? ' · 다루는 시간 ' + kstText(b.window.from) + ' ~ ' + kstText(b.window.to) : '')));
        var fs = el('p', '', '출처: ' + SOURCES.map(function (r) { return r[0] + ' — ' + r[1]; }).join(' · ')); fs.setAttribute('data-sb-foot-source', ''); foot.appendChild(fs);
        foot.appendChild(el('p', 'sb-notice', b.notice || '참고 정보이며 안전을 보장하지 않습니다.'));
        box.appendChild(foot);
    }
    w.StationBriefingRender = { render: render, colorOf: colorOf, kstText: kstText, dateText: dateText, sourceNames: sourceNames, dayWord: dayWord, WORDS: WORDS, SOURCES: SOURCES };
})(window);
