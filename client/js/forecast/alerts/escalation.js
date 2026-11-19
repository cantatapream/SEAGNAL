/**
 * ============================================================================
 * 파일명: client/js/forecast/alerts/escalation.js
 * 역할  : 「격상 가능성」 표시 — 기상청이 「풍랑경보로 변경될 가능성」「태풍특보로 변경될 가능성」이 있다고 알린 특보구역의 카드에
 *         뱃지 「풍랑 주의보 🔺」와, 펼친 카드 안의 빨강 상자(출처 뱃지 · 가능성 종류 · 📋 원문 버튼 / 시점 / 단서)를 그린다.
 *         해역·시점은 서버가 통보문 참고사항과 날씨해설에서 읽어 둔 것(GET /api/zone-escalations)을 그대로 쓴다.
 * 사용자 2026-11-18: 「[풍랑주의보] 뱃지 안에 [풍랑주의보(올라가는 느낌의 이모지)] … 아코디언을 눌렀을 때 가능성 내용도 안에 명시」
 *   「박스형 … 풍랑 경보 변경 가능성 처럼 조사 빼고 … [통보문] [단기전망] [초단기전망] 처럼 출처를 이렇게 뱃지로」 · 「태풍가능성때 해역뱃지 그대로 동일하게 유지」
 *   「가능성 같은줄 오른쪽 끝에 통보문으로 연결되는 버튼을 두어서(특보구역에서와 마찬가지로) 해당 문구가 적힌 통보문이 팝업으로 열리도록」
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 서버 API      : GET /api/zone-escalations → { at, items: { 해역: [{ kind:'wave'|'typhoon', source:'통보문'|'단기전망'|'초단기전망', dayMs, label, caveat, expMs,
 *                    doc:{ title, viewUrl?|pdfUrl?|webUrl?, downloadUrl? } }] } } (서버 services/bulletin_escalation.js 가 매분 계산)
 *  - 호출처        : data.js loadAllData·refreshAlertData(loadZoneEscalations) · render.js createAlertElement(zoneEscalations · renderZoneEscalation)
 *  - 사용하는 함수 : shared/ui/ui_modal.js openKmaIframeModal(📋 원문 팝업) · alert_history.js canShowPdfInline(PC 는 PDF 를 바로)
 *  - 마크업        : 없음(카드 안에 직접 만든다)
 * [로드 순서] data.js 다음, render.js 앞(index2.html) — render.js 가 카드를 그릴 때 이 파일의 함수를 부른다
 * ============================================================================
 */
(function (w) {
    'use strict';
    var items = {};   // 해역 이름(공백·가운뎃점 뺀 것) → 안내 목록
    var norm = function (s) { return String(s || '').replace(/[\s·.]/g, ''); };
    var TITLE = { wave: '풍랑 경보 변경 가능성', typhoon: '태풍 특보 변경 가능성' };
    var SRC = {
        '통보문': 'background:rgba(79,195,247,0.16);border:1px solid rgba(79,195,247,0.5);color:#81d4fa;',
        '단기전망': 'background:rgba(129,199,132,0.16);border:1px solid rgba(129,199,132,0.5);color:#a5d6a7;',
        '초단기전망': 'background:rgba(186,104,200,0.16);border:1px solid rgba(186,104,200,0.5);color:#ce93d8;'
    };

    var WAIT_MS = 2500;   // 특보 화면이 이 목록을 기다려 주는 시간 — 없으면: 이 주소가 느릴 때(이동통신망) 특보 카드 전체가 그만큼 늦게 뜬다(별도 에이전트 검토 2026-11-19: 25초 늦추면 카드도 25초)
    /**
     * 서버에서 격상 가능성 목록을 받아 둔다(특보 자료를 받을 때 함께). 실패하면 앞서 받은 것을 그대로 둔다 — 항목마다 만료 시각이 있어 낡은 것은 스스로 빠진다.
     *   2.5초 안에 못 받으면 기다리지 않고 넘어간다 — 카드는 🔺 없이 먼저 뜨고, 목록이 늦게 오면 그때 카드를 다시 그린다(renderApp).
     * @returns {Promise<void>} 절대 거부하지 않는다(특보 화면을 막지 않게)
     * [연계] ← data.js fetchAllData · refreshAlertData / → GET /api/zone-escalations
     */
    w.loadZoneEscalations = function () {
        var late = false;
        var got = fetch('/api/zone-escalations').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
            if (!j || !j.items) return;
            var next = {};
            Object.keys(j.items).forEach(function (z) { next[norm(z)] = j.items[z]; });
            items = next;
            if (late && typeof w.renderApp === 'function') w.renderApp();
        }).catch(function (e) { console.warn('[격상 가능성] 목록을 못 받음 — 앞서 받은 것으로 그린다:', e && e.message); });
        return Promise.race([got, new Promise(function (res) { setTimeout(function () { late = true; res(); }, WAIT_MS); })]);
    };

    /**
     * 그 카드에 보일 안내만 고른다.
     * 예: zoneEscalations('동해중부안쪽먼바다', { current:{ warnType:'풍랑', level:'주의보' }, upcoming:[] }) → [{ kind:'wave', source:'통보문', … }]
     *   · 풍랑 특보(주의보·예비)가 없는 카드에는 안 보인다 — 격상은 풍랑주의보에서 오르는 것이다 · 때가 지난 것은 뺀다
     *   · 풍랑 가능성: 카드가 (지금이든 다가오는 것이든) 이미 경보·태풍이면 뺀다 — 화면 카드가 통보문보다 몇 분 빠를 수 있다
     *   · 태풍 가능성: 이미 태풍특보일 때만 뺀다(풍랑경보 카드에는 보인다 — 태풍특보는 풍랑경보에서 오른다)
     * @param {string} zoneName 카드의 특보구역 이름 @param {{current?:object, upcoming?:Array}} st 그 카드의 지금 특보·다가오는 특보(warnType·level)
     * @returns {Array} 안내 목록(없으면 빈 배열)
     * [연계] ← render.js createAlertElement
     */
    w.zoneEscalations = function (zoneName, st) {
        var list = items[norm(zoneName)] || [], now = Date.now();
        var cur = (st && st.current) || null, ups = (st && st.upcoming) || [];
        if (!list.length || (!cur && !ups.length)) return [];
        var any = function (pred) { return (cur && pred(cur)) || ups.some(pred); };
        var wave = function (a) { return String((a && a.warnType) || '').indexOf('풍랑') >= 0; };
        var typhoon = function (a) { return String((a && a.warnType) || '').indexOf('태풍') >= 0; };
        var warning = function (a) { return String((a && a.level) || '').indexOf('경보') >= 0; };
        if (!any(wave)) return [];
        return list.filter(function (it) {
            if (!it || !(it.expMs > now) || !TITLE[it.kind]) return false;
            return it.kind === 'typhoon' ? !any(typhoon) : !any(typhoon) && !any(warning);
        });
    };

    /** 「11월 18일(오늘) 밤(18시~24시)」 — 날짜가 없으면 ''(시점 줄을 안 그린다). 날짜는 한국 시각으로 센다. */
    function whenText(it) {
        if (typeof it.dayMs !== 'number' || !isFinite(it.dayMs)) return '';
        var KST = 9 * 3600e3, d = new Date(it.dayMs + KST);
        var diff = Math.round((Math.floor((it.dayMs + KST) / 864e5) - Math.floor((Date.now() + KST) / 864e5)));
        var rel = diff === -1 ? '(어제)' : diff === 0 ? '(오늘)' : diff === 1 ? '(내일)' : diff === 2 ? '(모레)' : '';   // 시간창이 지난 뒤 6시간은 남는다 — 자정을 넘기면 「어제」
        return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일' + rel + (it.label ? ' ' + it.label : '');
    }

    /**
     * 안내 하나의 빨강 상자를 만든다(글은 textContent 로만 넣는다).
     *   1줄 = [출처 뱃지] 풍랑 경보 변경 가능성 ……… 📋   2줄 = 시점   3줄 = 단서(「발효 여부와 시점은 조정될 수 있음」)
     * @param {object} it GET /api/zone-escalations 의 한 항목 @returns {HTMLElement}
     * [연계] ← render.js createAlertElement / → openKmaIframeModal(📋)
     */
    w.renderZoneEscalation = function (it) {
        var box = document.createElement('div');
        box.className = 'zone-escalation';
        box.style.cssText = 'margin-top:8px;padding:9px 10px;border-radius:8px;background:rgba(239,83,80,0.10);border:1px solid rgba(239,83,80,0.38);';
        var top = document.createElement('div');
        top.style.cssText = 'display:flex;align-items:center;gap:6px;';
        var src = document.createElement('span');
        src.style.cssText = 'font-size:0.66rem;font-weight:700;padding:1px 6px;border-radius:5px;white-space:nowrap;' + (SRC[it.source] || SRC['통보문']);
        src.textContent = it.source;
        var title = document.createElement('span');
        title.style.cssText = 'font-size:0.8rem;font-weight:700;color:#ff8a80;';
        title.textContent = TITLE[it.kind];
        top.appendChild(src); top.appendChild(title);
        var doc = it.doc || {};
        var url = doc.viewUrl || doc.webUrl || (doc.pdfUrl
            ? ((typeof w.canShowPdfInline === 'function' && w.canShowPdfInline()) ? doc.pdfUrl + '#navpanes=0&view=FitH' : 'https://docs.google.com/gview?embedded=true&url=' + encodeURIComponent(doc.pdfUrl))
            : '');
        // 팝업(openKmaIframeModal)은 제목·주소를 HTML 로 그대로 붙인다 — 우리 서버 그림 주소나 https 주소만, 제목은 꺾쇠·따옴표를 뺀 글자만 넘긴다(기상청 글에서 온 값이다)
        var safeTitle = String(doc.title || '원문').replace(/[<>&"'`]/g, '');
        if (!/^(?:\/api\/bulletin-doc\/|https:\/\/)[^"'<>\s]+$/.test(url)) url = '';
        if (url && typeof w.openKmaIframeModal === 'function') {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'zone-escalation-doc';
            btn.title = '이 안내가 적힌 원문 보기';
            btn.style.cssText = 'margin-left:auto;background:rgba(129,212,250,0.15);border:1px solid rgba(129,212,250,0.3);width:26px;height:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:0.78rem;flex-shrink:0;cursor:pointer;padding:0;';
            btn.textContent = '📋';
            // 통보문이면 팝업 머리줄에 「PDF」 받기 버튼도(우리 서버에 받아 둔 원문 — ui_modal.js). 주소는 우리 서버 원문 경로일 때만 넘긴다.
            var dl = /^\/api\/bulletin-doc\/[A-Za-z0-9_]+\/pdf$/.test(doc.downloadUrl || '') ? { download: { url: doc.downloadUrl, name: safeTitle.replace(/[\\/:*?|]/g, ' ') + '.pdf' } } : undefined;
            btn.addEventListener('click', function (e) { e.stopPropagation(); w.openKmaIframeModal(url, safeTitle, dl); });   // 카드 접힘·펼침으로 번지지 않게
            top.appendChild(btn);
        }
        box.appendChild(top);
        var when = whenText(it);
        if (when) {
            var l2 = document.createElement('div');
            l2.style.cssText = 'font-size:0.8rem;color:#e6edf3;margin-top:5px;';
            l2.textContent = when;
            box.appendChild(l2);
        }
        if (it.caveat) {
            var l3 = document.createElement('div');
            l3.style.cssText = 'font-size:0.66rem;color:#8b949e;margin-top:3px;';
            l3.textContent = it.caveat;
            box.appendChild(l3);
        }
        return box;
    };
})(window);
