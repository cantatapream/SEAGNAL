/**
 * ============================================================================
 * 파일명: client/js/forecast/station-briefing/station_briefing_riskmap.js
 * 역할  : 연안 안전 브리핑의 지도(팝업·근거 펼침)에 위험예측 화면과 같은 배경 — 위성지도 위 해상 칸 색·선박 수(혼잡도) / 위험 예측 색 / 연안 위험 색 — 을 깔고,
 *         칸·관광지를 누르면 위험예측과 같은 바텀시트(해상 분석·연안 분석)를 이 화면 안에서 올린다(2026-10-18 사용자 결정 — 설계서 §11.10.24·§11.10.26).
 *         색·숫자·흐림·해안선 자르기·누름 판정은 새로 만들지 않고 위험예측 지도 층(RiskMapLayer)을, 시트 내용은 위험예측 시트(RiskSheet)를 그대로 쓴다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : marine-life/risk-forecast/risk_api.js(RiskAPI — 요청·짧은 캐시) · risk_map_layer.js(RiskMapLayer.create — 지도 층·육지 가리개·hit)
 *                    · risk_sheet.js(RiskSheet.create — 바텀시트 틀·해상/연안 본문) · risk_marine.js(RiskMarine.cellOf — 교통량 그래프 칸) · risk_basis.js(RiskBasis.open — [기준 상세])
 *                    · ocean-map/map/ocean_map.js(oceanCreateVworldLayer·oceanVworldReady — 위성지도) · core/backbutton.js(PopupStack — 휴대폰 뒤로가기)
 *  - 서버 API      : GET /api/risk-forecast/sea/area-frame(mode=current|risk, bbox) · coast/area-frame(bbox) · sea/analysis · coast/spot · sea/traffic-history · islands
 *                    · /api/ocean/land-mask(RiskMapLayer.boundaries — 해안선 자르기)
 *  - 마크업        : 없음(station_briefing_render.js miniMap 이 만든 지도 · openMapPopup 창 · document.body 에 바텀시트를 붙인다)
 *  - 나를 쓰는 곳  : station_briefing_render.js(miniMap opt.risk · riskPopup · 근거 펼침 지도)
 * [로드 순서] risk_forecast.js 다음 · station_briefing_render.js 이전 — 순서 변경 금지
 * ============================================================================
 */
(function (w) {
    'use strict';
    var api = null;
    /** 위험예측 요청 도구(같은 짧은 캐시 — islands 는 하루). 예: rapi().get('islands') @returns {Object|null} [연계] ← attach·sheet / → RiskAPI.create */
    function rapi() { if (!api && w.RiskAPI) api = w.RiskAPI.create(); return api; }
    /** 모든 부품이 있는가(위험예측 스크립트가 안 실린 화면 — 관리자 미리보기 단독 등 — 이면 거짓, 그때 지도는 종전 모양). @returns {boolean} [연계] ← station_briefing_render.js */
    function ready() { return !!(w.ol && w.RiskAPI && w.RiskMapLayer && w.RiskSheet && w.RiskMarine && w.RiskFormat); }
    /**
     * 경위도 상자 [서,남,동,북]를 구한다 — 관할 폴리곤(area)과 상자들을 다 담고 사방 margin(°) 여유, 소수 넷째 자리.
     * 예: bbox([[[[126.1,33.3],[126.4,33.3],[126.4,33.5],[126.1,33.3]]]], [], 0.05) → [126.05,33.25,126.45,33.55]
     * @param {Array} area - 관할 폴리곤 목록(경위도 고리 배열) @param {number[][]} [boxes] @param {number} [margin] @returns {number[]|null}
     * [연계] ← station_briefing_render.js riskOpt / 서버 area-frame 은 4°×4° 넘으면 400
     */
    function bbox(area, boxes, margin) {
        var xs = [], ys = [], m = margin === undefined ? 0.05 : margin;
        (Array.isArray(area) ? area : []).forEach(function (poly) { (poly || []).forEach(function (ring) { (ring || []).forEach(function (p) { xs.push(Number(p[0])); ys.push(Number(p[1])); }); }); });
        (Array.isArray(boxes) ? boxes : []).forEach(function (b) { xs.push(b[0], b[2]); ys.push(b[1], b[3]); });
        xs = xs.filter(Number.isFinite); ys = ys.filter(Number.isFinite); if (!xs.length || !ys.length) return null;
        var r = function (v) { return Math.round(v * 1e4) / 1e4; };
        return [r(Math.max(115, Math.min.apply(null, xs) - m)), r(Math.max(20, Math.min.apply(null, ys) - m)), r(Math.min(140, Math.max.apply(null, xs) + m)), r(Math.min(45, Math.max.apply(null, ys) + m))];
    }
    /**
     * 위성지도 바탕 두 장(영상 + 지명 라벨 — 위험예측을 켜면 바뀌는 배경과 같은 브이월드). 위성 키를 못 받으면 해아름 기본맵 한 장으로 바꾼다(위험예측 satelliteOn 과 같은 규칙).
     * 예: baseLayers(function (kind) { box.setAttribute('data-sb-map-base', kind); }) → [sat, label] · 함수가 없으면 null
     * @param {function(string)} onKind - 'vworld'·'khoa' 를 알린다 @returns {Array|null} [연계] ← station_briefing_render.js miniMap / → oceanCreateVworldLayer·oceanVworldReady·oceanCreateKhoaLayer
     */
    function baseLayers(onKind) {
        if (typeof w.oceanCreateVworldLayer !== 'function') return null;
        var sat = w.oceanCreateVworldLayer('Satellite'), label = w.oceanCreateVworldLayer('Hybrid'), out = [sat, label];
        sat.setVisible(true); label.setVisible(true); onKind('vworld');
        if (typeof w.oceanVworldReady === 'function') w.oceanVworldReady().then(function (ok) {
            if (ok) return;
            sat.setVisible(false); label.setVisible(false);
            if (typeof w.oceanCreateKhoaLayer === 'function') { try { var k = w.oceanCreateKhoaLayer('BASEMAP_RLTM3857'); k.setVisible(true); k.setZIndex(-1); if (out.map) out.map.addLayer(k); } catch (e) { console.warn('[연안 안전 브리핑] 바탕 지도 없음', e); } }
            onKind('khoa');
        });
        return out;
    }
    /**
     * 만든 지도에 위험예측 층을 얹고 그 구역 자료를 받는다. 누르면 위험예측 지도와 같은 판정(RiskMapLayer.hit — 해상 칸·연안 관광지)으로 onPick.
     * 해상 지도(current·risk)는 칸 안 육지 쪽을 눌러도 그 칸(onPick('marine', id, 칸 중심 {lon,lat}) — §11.10.38, hit 의 {landSea:true}). 칸 밖 육지는 아무 일 없음.
     * kind: 'current' = 혼잡도 지금(밀집도 색 + 칸 안 선박 수 — 위험예측에서 「혼잡도」를 켠 지금 화면) · 'risk' = 위험 예측 색 · 'coast' = 연안 위험 색(그날 하루 값).
     * 예: attach(map, {kind:'current', bbox:[126,33.2,126.5,33.6], onPick:fn}) → {load, select, spots, destroy}
     * @param {ol.Map} map @param {Object} opt - {kind, t, bbox, onPick(kind,id,point), onLoad(data)} @returns {Object}
     * [연계] ← station_briefing_render.js miniMap / → RiskMapLayer.create·boundaries·drawUnified·drawCoast·hit · GET sea/area-frame·coast/area-frame
     */
    function attach(map, opt) {
        var L = w.RiskMapLayer.create(map, function (kind, id, point) { if (typeof opt.onPick === 'function') opt.onPick(kind, id, point); }), coast = opt.kind === 'coast', spots = [], seq = 0, alive = true;
        L.setActive(coast ? { coast: true, sea: false } : { coast: false, sea: true }, true);
        L.boundaries(rapi()).catch(function (e) { console.warn('[연안 안전 브리핑] 해안선 자료를 받지 못해 칸 색이 육지에도 보일 수 있습니다:', e && e.message); });
        /** 그 구역 자료를 (다시) 받아 그린다. 예: load() → 지금 칸 / load('2026-10-18T06:00:00+09:00') → 그 시각. @param {string} [t] @returns {Promise<Object|null>} */
        async function load(t) {
            var n = ++seq, at = t === undefined ? opt.t : t, params = { bbox: opt.bbox.join(',') }; if (at) params.t = at;
            if (!coast) params.mode = opt.kind === 'risk' ? 'risk' : 'current';
            var d = await rapi().get(coast ? 'coast/area-frame' : 'sea/area-frame', params, true);
            if (n !== seq || !alive) return null;
            if (coast) { spots = d.spots || []; L.setTables({ cells: [] }, { spots: spots }, null); L.drawCoast({ spots: d.scores || [] }); }
            else {
                var cells = d.cells || [];
                L.drawUnified({ cells: cells.map(function (c, k) { return { i: k, id: c.id, lon: c.lon, lat: c.lat }; }) }, { mode: d.mode, cells: cells.map(function (c, k) { return [k, c.n, c.level, c.color]; }) });
            }
            if (typeof opt.onLoad === 'function') opt.onLoad(d);
            return d;
        }
        // §11.10.38(2026-10-19 사용자 「격자(육지쪽)을 눌러도 바텀시트가 켜지도록」): 해상 지도(current·risk)는 칸 안 육지 쪽을 눌러도 그 칸 해상 시트 — 위험예측 본 화면은 그대로(hit 의 o 없음)
        var click = function (evt) { L.hit(evt, { landSea: !coast }); };
        map.on('click', click);
        return { load: load, select: function (kind, id) { L.setSelection(kind, id); }, spots: function () { return spots; }, layer: L,
            destroy: function () { alive = false; map.un('click', click); L.destroy(); } };
    }
    /** 연안 시트 날짜 줄 글(위험예측 RiskForecast.dayInfo 의 sheet 꼴). 예: dayText('2026-10-17') → "'26. 10. 17.(토)" @param {string} date - YYYY-MM-DD @returns {string} [연계] ← sheet(open) / → RiskSheet.day */
    function dayText(date) { var l = new Date(Date.parse(date + 'T00:00:00Z')); return "'" + String(l.getUTCFullYear()).slice(-2) + '. ' + (l.getUTCMonth() + 1) + '. ' + l.getUTCDate() + '.(' + ['일', '월', '화', '수', '목', '금', '토'][l.getUTCDay()] + ')'; }
    /**
     * 위험예측과 같은 바텀시트 하나를 host 안에 만든다(.rf-sheet — 아래에서 0.2초 뒤 올라오고 0.3초 동안 내려감, 위험예측 RiskSheet 그대로).
     * open('marine', id, {lon,lat}, t) = 해상 분석(GET sea/analysis + 교통량 그래프) · open('coast', id, null, t) = 연안 분석(GET coast/spot — 그날 하루 값).
     * 휴대폰 뒤로가기·✕·Escape(부르는 쪽)로 닫는다. 시각 막대 자리(.rf-timeline)는 해상이면 비우고, 연안이면 그 하루 값 날짜만(넘기기 단추 없음) — 이 시트는 고른 시각(지금 또는 브리핑 날짜) 하나만 보인다.
     * 예: var s = sheet(document.body, {onClose:fn}); s.open('coast', '50110|협재해수욕장', null, undefined)
     * @param {HTMLElement} host @param {Object} [o] - {onClose(), onOpen()} @returns {{open:Function, close:Function, isOpen:Function, el:HTMLElement, destroy:Function}}
     * [연계] ← station_briefing_render.js riskPopup·근거 펼침 지도 / → RiskSheet.create·show·loading·hold·trafficHistory·clear · RiskBasis.open · PopupStack
     */
    function sheet(host, o) {
        o = o || {};
        var el = document.createElement('div'); el.className = 'rf-sheet sb-rf-sheet'; el.setAttribute('role', 'region'); el.setAttribute('aria-label', '위험예측 상세'); el.setAttribute('data-sb-rf-sheet', '');
        el.addEventListener('click', function (e) { e.stopPropagation(); });   // 바깥 아코디언·창 바깥 누르기로 번지지 않게
        host.appendChild(el);
        var seq = 0, cur = null, pushed = false, S = w.RiskSheet.create(el, {
            close: function () { close(); },
            basis: function (kind, btn) { if (w.RiskBasis) w.RiskBasis.open(kind, btn); },
            choose: function (kind, id) { open(kind, id, null, cur && cur.t); },
            retry: function () { if (cur) open(cur.kind, cur.id, cur.point, cur.t); },
            hazard: function (id) { if (typeof o.onHazard === 'function') o.onHazard(id, S); },
            day: function () {}, marinePoint: function () {}
        });
        /** 시트를 연다(이미 열려 있으면 내용만 바꾼다). @param {string} kind - 'marine'|'coast' @param {string} id @param {Object|null} point @param {string} [t] @param {number} [delay] - 처음 올라오기까지(ms, 기본 200) @returns {Promise<void>} */
        async function open(kind, id, point, t, delay) {
            var n = ++seq; cur = { kind: kind, id: id, point: point, t: t };
            S.hold(delay === undefined ? 200 : delay); S.loading({ title: '불러오는 중…' });
            el.setAttribute('data-sb-rf-kind', kind); el.setAttribute('data-sb-rf-id', String(id));
            if (!pushed && w.PopupStack) { w.PopupStack.push('sb-rf-sheet', function () { pushed = false; close(true); }); pushed = true; }
            if (typeof o.onOpen === 'function') o.onOpen(kind, id, point);
            var params = { id: id }; if (t) params.t = t; if (point) { params.lon = point.lon; params.lat = point.lat; }
            try {
                var d = await rapi().get(kind === 'coast' ? 'coast/spot' : 'sea/analysis', params, true);
                if (n !== seq) return;
                // ctx.now(위험예측은 서버 meta.now): 시각을 안 보냈으면 응답 시각이 곧 지금, 보냈으면 이 기기 시각(지금/미래 문구용)
                var now = t ? new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19) + '+09:00' : d.t;
                // 연안: 시각 막대 자리에 그 하루 값의 날짜 줄(위험예측 연안 시트와 같은 꼴 — 「'26. 10. 17.(토)」 + 「가장 높은 때 HH시 기준」) — 넘기기 단추는 숨긴다(station_briefing.css).
                //   브리핑 날짜 하나만 보이므로 날짜를 밝혀 둔다. show 보다 먼저 그려야 show 가 둘째 줄(가장 높은 때)을 채운다. 해상은 시각 막대 자리를 비운다.
                var dd = kind === 'coast' && d.daily && /^\d{4}-\d{2}-\d{2}$/.test(String(d.daily.date || '')) ? d.daily.date : null;
                if (dd) S.day({ date: dd, sheet: dayText(dd), prev: false, next: false });
                S.show(d, kind === 'coast' ? 'coast' : 'marine', null, { now: now });
                var tl = el.querySelector('.rf-timeline'); if (tl) tl.hidden = !dd;
                el.setAttribute('data-sb-rf-loaded', kind);
                if (kind !== 'coast' && d.marine) {
                    var cell = w.RiskMarine.cellOf(d.marine);
                    if (!cell) S.trafficHistory(null, null, 'nocell');
                    else { try { var h = await rapi().get('sea/traffic-history', { cell: cell, days: 15 }); if (n === seq) S.trafficHistory(cell, h); } catch (e) { console.warn('[연안 안전 브리핑] 교통량 기록을 받지 못함 — 시트에 「불러오지 못했습니다」:', e && e.message); if (n === seq) S.trafficHistory(cell, null, 'error'); } }
                }
            } catch (e) { if (n === seq) S.error(e && e.message || '오류'); }
        }
        /** 시트를 내린다. @param {boolean} [fromBack] - 뒤로가기가 이미 목록에서 뺐으면 참 @returns {void} */
        function close(fromBack) {
            seq++; cur = null; S.clear(); el.removeAttribute('data-sb-rf-loaded');
            if (pushed && !fromBack && w.PopupStack) w.PopupStack.remove('sb-rf-sheet'); pushed = false;
            if (typeof o.onClose === 'function') o.onClose();
        }
        function isOpen() { return el.classList.contains('open'); }
        return { open: open, close: close, isOpen: isOpen, el: el, destroy: function () { if (isOpen() || pushed) close(); if (el.parentNode) el.parentNode.removeChild(el); } };
    }
    w.StationBriefingRiskMap = { ready: ready, bbox: bbox, baseLayers: baseLayers, attach: attach, sheet: sheet, dayText: dayText };
})(window);
