/**
 * ============================================================================
 * 파일명: client/js/forecast/station-briefing/station_briefing_picker.js
 * 역할  : 「활동지점(파출소 관할) 설정」 화면의 관할 고르기 칸 — 탭 두 개(사용자 2026-10-17).
 *         ①「지도에서 선택하기」: 해역 단추(동해·서해·남해·제주 — 온보딩 「관심해역을 클릭해보세요」와 같은 모양·같은 SEA_REGIONS)
 *            → 그 해역의 파출소 관할 폴리곤 지도(온보딩 「○○ 특보구역을 선택해주세요」와 같은 방식 — 눌러 고르기·확대·이동)
 *         ②「파출소로 선택하기」: 지방청 → 해양경찰서 → 파출소 아코디언 + 이름 찾기(찾으면 맞는 묶음을 저절로 펼침).
 *         고른 결과·저장·해상/육상 칸·[저장]·[건너뛰기]는 station_briefing.js renderSetup 이 그대로 맡는다(이 파일은 고르기만).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : core/config.js(SEA_REGIONS — 해역 이름·아이콘·표시 이름) · assets/vendor/ol/ol.js(지도)
 *                    · ocean-map/map/ocean_map.js(oceanCreateKhoaLayer — 배경 바다지도, 온보딩 zone_setup.js 와 같은 것)
 *                    · station_briefing.css(.sb-tabs·.sb-sea-*·.sb-map·.sb-acc-* 모양)
 *  - 서버 API      : GET /api/station-briefing/areas(관할 구역 — 부르는 일은 station_briefing.js 의 get 이 맡아 opts.loadAreas 로 넘긴다)
 *  - 마크업        : 없음 — renderSetup 이 넘겨 준 칸 안에 만든다
 *  - 나를 쓰는 곳  : station_briefing.js renderSetup(mount) · renderBody(destroy — 다른 화면으로 바뀔 때 지도 정리)
 *  - 계약          : client/js/ocean-map/coastal-risk/briefing.contract.md §1.1b(areas — 해역 규칙)
 * [로드 순서] station_briefing_basis.js 다음, station_briefing.js 앞(station_briefing.js 가 이 파일을 부른다)
 * ============================================================================
 */
(function (w) {
    'use strict';
    // 지도 상태 — 화면에 지도는 한 번에 하나(설정 화면은 하나뿐). areas 는 한 번 받으면 이 화면을 다시 열어도 그대로 쓴다.
    var P = { map: null, layer: null, areas: null, areasP: null, missing: 0 };
    var C_ACCENT = '#448aff';   // 온보딩 zone_setup.js 와 같은 강조색(고른 구역)

    /** 해역 목록(SEA_REGIONS 차례 그대로 — 없으면 네 이름). 예: seas() → [{name:'동해', label:'🌅 동해 해역'}, …]. @returns {Object[]} [연계] ← mapPanel */
    function seas() {
        var R = typeof SEA_REGIONS !== 'undefined' ? SEA_REGIONS : null;   // config.js 의 const(전역 어휘 환경 — window 속성이 아니다)
        return (R ? Object.keys(R) : ['동해', '서해', '남해', '제주']).map(function (m) { var i = (R && R[m]) || {}; return { name: m, label: ((i.icon || '') + ' ' + (i.displayName || m + ' 해역')).trim() }; });
    }
    /** 지도 이름표 — 「파출소」를 뗀다(온보딩 지도처럼 짧게). 예: short('한림파출소') → '한림'. @param {string} n @returns {string} */
    function short(n) { return String(n || '').replace(/파출소$/, ''); }
    /** 요소 하나. 예: el('button','sb-btn','저장'). @param {string} tag @param {string} [cls] @param {string} [text] @returns {HTMLElement} */
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

    /** 지도를 치운다(해역을 다시 고르거나 화면이 바뀔 때). 예: destroy(). @returns {void} [연계] ← mount·showSeas·station_briefing.js renderBody */
    function destroy() { if (P.map) { P.map.setTarget(null); P.map = null; } P.layer = null; }

    /**
     * 관할 고르기 칸을 만든다(탭 두 개). 고르면 opts.onPick(관할) — 선택 표시는 refresh() 로 다시 맞춘다.
     * 예: var pk = mount(box, {stations:S.stations, selected:()=>S.pick.station, onPick:choose, loadAreas:()=>get('/api/station-briefing/areas')}); pk.refresh();
     * @param {HTMLElement} host @param {{stations:Object[], selected:function():string|null, onPick:function(Object), loadAreas:function():Promise<Object>}} opts
     * @returns {{refresh:function():void}} [연계] ← station_briefing.js renderSetup / → mapPanel·listPanel
     */
    function mount(host, opts) {
        destroy();
        var tabs = el('div', 'sb-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '관할 고르는 방법');
        var defs = [['map', '지도에서 선택하기'], ['list', '파출소로 선택하기']], btns = {}, panels = {};
        defs.forEach(function (d) {
            var b = el('button', 'sb-tab', d[1]); b.type = 'button'; b.id = 'sb-tab-' + d[0]; b.setAttribute('role', 'tab'); b.setAttribute('data-sb-tab', d[0]); b.setAttribute('aria-controls', 'sb-panel-' + d[0]);
            var p = el('div', 'sb-tab-panel'); p.id = 'sb-panel-' + d[0]; p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', b.id); p.setAttribute('data-sb-panel', d[0]);
            b.addEventListener('click', function (e) { e.stopPropagation(); select(d[0], false); });
            // 왼쪽·오른쪽 화살표로 다른 탭(WAI-ARIA 탭 관례)
            b.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); select(d[0] === 'map' ? 'list' : 'map', true); } });
            btns[d[0]] = b; panels[d[0]] = p; tabs.appendChild(b);
        });
        host.appendChild(tabs); host.appendChild(panels.map); host.appendChild(panels.list);
        var mapUi = mapPanel(panels.map, opts), listUi = listPanel(panels.list, opts);
        /** 탭 하나를 보인다. @param {string} k - 'map'|'list' @param {boolean} focus - 화살표로 옮겼으면 그 탭에 초점 */
        function select(k, focus) {
            defs.forEach(function (d) { var on = d[0] === k; btns[d[0]].setAttribute('aria-selected', String(on)); btns[d[0]].tabIndex = on ? 0 : -1; panels[d[0]].hidden = !on; });
            if (focus) btns[k].focus();
            if (k === 'map') mapUi.shown(); else listUi.shown();
        }
        select('map', false);
        return { refresh: function () { mapUi.refresh(); listUi.refresh(); } };
    }

    /**
     * 탭 ①「지도에서 선택하기」 — 해역 단추 → 그 해역 관할 폴리곤 지도.
     * 예: 「🍊 제주 해역」 누름 → 제주 해역 관할 6곳(한림·제주·추자 …) 지도 → 한림 폴리곤 누름 → opts.onPick(한림)
     * @param {HTMLElement} panel @param {Object} opts - mount 와 같음 @returns {{shown:function, refresh:function}} [연계] ← mount / → drawMap
     */
    function mapPanel(panel, opts) {
        var cur = null, hint = null;
        /** 해역 단추 화면. */
        function showSeas() {
            destroy(); cur = null; hint = null; panel.textContent = '';
            panel.appendChild(el('h5', 'sb-pick-title', '해역을 눌러 보세요'));
            panel.appendChild(el('p', 'sb-pick-sub', '고른 해역의 파출소 관할 구역이 지도에 나옵니다.'));
            var grid = el('div', 'sb-sea-grid');
            seas().forEach(function (s) {
                var b = el('button', 'sb-sea-btn', s.label); b.type = 'button'; b.setAttribute('data-sea', s.name);
                b.addEventListener('click', function (e) { e.stopPropagation(); showMap(s.name); });
                grid.appendChild(b);
            });
            panel.appendChild(grid);
        }
        /** 한 해역의 관할 지도 화면. @param {string} sea */
        function showMap(sea) {
            destroy(); cur = sea; panel.textContent = '';
            var head = el('div', 'sb-pick-head');
            head.appendChild(el('h5', 'sb-pick-title', sea + ' 파출소 관할을 선택해주세요'));
            var back = el('button', 'sb-btn sb-sea-back', '‹ 해역 다시 고르기'); back.type = 'button'; back.setAttribute('data-sb-sea-back', '');
            back.addEventListener('click', function (e) { e.stopPropagation(); showSeas(); });
            head.appendChild(back); panel.appendChild(head);
            panel.appendChild(el('p', 'sb-pick-sub', '지도를 눌러 관할을 고르고, 확대·이동해서 경계를 확인해보세요.'));
            var box = el('div', 'sb-map', '관할 구역을 불러오는 중…'); box.setAttribute('data-sb-map', sea); panel.appendChild(box);
            hint = el('p', 'sb-map-hint'); hint.setAttribute('data-sb-map-hint', ''); panel.appendChild(hint);
            box.addEventListener('click', function (e) { e.stopPropagation(); });   // 지도 누름이 아코디언 머리 등 바깥으로 번지지 않게
            var mine = cur;
            loadAreas(opts).then(function (areas) {
                if (cur !== mine || !box.isConnected) return;   // 그 사이 다른 해역·다른 화면으로 바뀜
                if (!areas || typeof ol === 'undefined') return fail(box);
                drawMap(box, sea, areas, opts);
                refresh();
            }, function () { if (cur === mine && box.isConnected) fail(box); });
            refresh();
        }
        /** 지도를 못 그릴 때 — 다른 탭으로 고를 수 있다고 알린다. @param {HTMLElement} box */
        function fail(box) { box.textContent = '지도를 불러오지 못했습니다. 「파출소로 선택하기」에서 고를 수 있습니다.'; }
        /** 지도 아래 줄(온보딩 「아직 고른 구역이 없습니다」와 같은 자리)·폴리곤 색을 지금 선택에 맞춘다. */
        function refresh() {
            if (P.layer) P.layer.changed();
            if (!hint) return;
            var key = opts.selected(), st = (opts.stations || []).filter(function (s) { return s.key === key; })[0];
            var onMap = !!(st && P.layer && P.layer.getSource().getFeatureById(key));
            hint.textContent = onMap ? '고른 관할: ' + st.name + ' · ' + st.office : '아직 이 지도에서 고른 관할이 없습니다. 지도를 눌러 고르세요.';
            if (P.map && P.missing) hint.textContent += ' (지도에 구역이 없는 관할 ' + P.missing + '곳은 「파출소로 선택하기」에서 고를 수 있습니다.)';
        }
        showSeas();
        // 다른 탭에 갔다 오면 지도 칸 크기가 0 이었던 동안의 크기를 다시 잰다(ol 은 숨은 칸 크기를 모른다).
        return { shown: function () { if (P.map) P.map.updateSize(); }, refresh: refresh };
    }
    /**
     * 관할 구역을 한 번 받는다(실패하면 다음에 다시). 예: loadAreas(opts).then(areas → [{key,seas,geometry}]).
     * @param {Object} opts @returns {Promise<Object[]|null>} [연계] ← mapPanel / → opts.loadAreas(GET /api/station-briefing/areas)
     */
    function loadAreas(opts) {
        if (P.areas) return Promise.resolve(P.areas);
        if (!P.areasP) {
            P.areasP = Promise.resolve().then(opts.loadAreas).then(function (r) {
                P.areasP = null;
                if (!r || r.display !== true || !Array.isArray(r.areas)) return null;
                P.areas = r.areas; return P.areas;
            }, function (e) { P.areasP = null; console.warn('[활동지점 브리핑] 관할 구역을 받지 못함:', e && e.message); throw e; });
        }
        return P.areasP;
    }
    /**
     * 한 해역의 관할 폴리곤 지도를 그린다 — 온보딩 zone_setup.js _makeMap 과 같은 방식(배경 해아름 바다지도 · 이름표 겹치면 숨김 · 눌러 고르기).
     * 그 해역에 걸치는 관할(서버 seas 에 그 해역이 있는 것)을 모두 그리고, 지도 범위를 그 관할들에 맞춘다.
     * 예: drawMap(box, '제주', areas, opts) → 6곳(한림·애월·… 추자는 남해·제주 둘 다)
     * @param {HTMLElement} box @param {string} sea @param {Object[]} areas @param {Object} opts [연계] ← mapPanel / → zoneStyle · opts.onPick
     */
    function drawMap(box, sea, areas, opts) {
        var byKey = {}; (opts.stations || []).forEach(function (s) { byKey[s.key] = s; });
        var shown = areas.filter(function (a) { return byKey[a.key] && (a.seas || []).indexOf(sea) >= 0; });
        var has = {}; areas.forEach(function (a) { has[a.key] = true; });
        P.missing = (opts.stations || []).filter(function (s) { return !has[s.key]; }).length;
        var feats = new ol.format.GeoJSON().readFeatures({ type: 'FeatureCollection', features: shown.map(function (a) {
            return { type: 'Feature', id: a.key, properties: { key: a.key, label: short(byKey[a.key].name) }, geometry: a.geometry };
        }) }, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' });
        var src = new ol.source.Vector({ features: feats });
        box.textContent = ''; box.classList.add('sb-map-ready');   // 「불러오는 중…」 글자(와 그 여백)를 지우고 지도를 넣는다
        // declutter: 이름표가 겹치면 한쪽을 숨긴다(확대하면 다시 보인다) — 온보딩 지도와 같다. 고른 것은 지도 아래 줄에 이름이 늘 보인다.
        P.layer = new ol.layer.Vector({ source: src, style: function (f) { return zoneStyle(f, f.get('key') === opts.selected()); }, declutter: true });
        var base = typeof w.oceanCreateKhoaLayer === 'function' ? w.oceanCreateKhoaLayer('BASEMAP_RLTM3857') : new ol.layer.Tile({ source: new ol.source.OSM() });
        base.setVisible(true);
        P.map = new ol.Map({ target: box, layers: [base, P.layer], view: new ol.View({ center: ol.proj.fromLonLat([127.5, 35.5]), zoom: 6, minZoom: 5, maxZoom: 13 }),
            controls: ol.control.defaults.defaults({ attribution: false, zoom: false }) });
        P.map.updateSize();
        if (feats.length) P.map.getView().fit(src.getExtent(), { size: P.map.getSize(), padding: [20, 20, 20, 20] });
        P.map.on('singleclick', function (evt) {
            var hit = null;
            P.map.forEachFeatureAtPixel(evt.pixel, function (f) { hit = f; return true; }, { layerFilter: function (l) { return l === P.layer; } });
            if (hit && byKey[hit.get('key')]) opts.onPick(byKey[hit.get('key')]);
        });
    }
    /**
     * 관할 폴리곤 모양 — 온보딩 zone_setup.js _zoneStyle 과 같은 색(밝은 바다지도 위라 안 고른 선·글자는 어둡게, 고른 것은 파랗게·위로).
     * 예: zoneStyle(한림, true) → 파란 칠·굵은 선·흰 글자 「한림」 @param {Object} f - ol feature @param {boolean} on @returns {Object} ol.style.Style
     */
    function zoneStyle(f, on) {
        return new ol.style.Style({
            zIndex: on ? 2 : 1,
            fill: new ol.style.Fill({ color: on ? 'rgba(68,138,255,0.45)' : 'rgba(13,24,48,0.10)' }),
            stroke: new ol.style.Stroke({ color: on ? C_ACCENT : 'rgba(13,24,48,0.55)', width: on ? 2.5 : 1.2 }),
            text: new ol.style.Text({ text: f.get('label'), font: (on ? 'bold ' : '') + '11px "Noto Sans KR",sans-serif', overflow: true,
                fill: new ol.style.Fill({ color: on ? '#ffffff' : '#0f172a' }), stroke: new ol.style.Stroke({ color: on ? 'rgba(6,11,24,0.85)' : 'rgba(255,255,255,0.9)', width: 3 }) })
        });
    }

    /**
     * 탭 ②「파출소로 선택하기」 — 지방청 → 해양경찰서 → 파출소 아코디언(서버 목록 차례 그대로) + 이름 찾기.
     * 찾기 글자가 있으면 맞는 관할만 남기고 그 지방청·경찰서를 모두 펼친다. 글자를 지우면 고른 관할이 든 묶음만 펼친다.
     * 예: 「애월」 입력 → 제주지방해양경찰청 ▾ 제주해양경찰서 ▾ [애월파출소]
     * @param {HTMLElement} panel @param {Object} opts - mount 와 같음 @returns {{shown:function, refresh:function}} [연계] ← mount
     */
    function listPanel(panel, opts) {
        var stations = opts.stations || [], open = {}, seq = 0;
        var q = el('input', 'sb-search'); q.type = 'search'; q.placeholder = '파출소·해양경찰서 이름으로 찾기'; q.setAttribute('aria-label', '관할 찾기'); panel.appendChild(q);
        var listBox = el('div', 'sb-station-list'); listBox.setAttribute('role', 'group'); listBox.setAttribute('aria-label', '파출소 관할'); panel.appendChild(listBox);
        /** 고른 관할이 든 지방청·경찰서를 펼침 목록에 더한다. */
        function openSelected() { var st = stations.filter(function (s) { return s.key === opts.selected(); })[0]; if (st) { open['r|' + st.region] = true; open['o|' + st.region + '|' + st.office] = true; } }
        /** 펼침 단추 + 몸 한 벌. @returns {{wrap:HTMLElement, body:HTMLElement}} */
        function acc(kind, id, label) {
            var wrap = el('div', 'sb-acc sb-acc-' + kind), bodyId = 'sb-acc-' + (++seq);
            var b = el('button', 'sb-acc-btn sb-' + kind, label); b.type = 'button'; b.setAttribute('aria-expanded', String(!!open[id])); b.setAttribute('aria-controls', bodyId); b.setAttribute('data-sb-acc', id);
            var body = el('div', kind === 'office' ? 'sb-acc-body sb-office-list' : 'sb-acc-body'); body.id = bodyId; body.hidden = !open[id];
            b.addEventListener('click', function (e) { e.stopPropagation(); open[id] = !open[id]; b.setAttribute('aria-expanded', String(!!open[id])); body.hidden = !open[id]; });
            wrap.appendChild(b); wrap.appendChild(body); return { wrap: wrap, body: body };
        }
        /** 목록을 다시 그린다(찾기 글자로 거름). */
        function draw() {
            var term = q.value.trim(), lastR = null, lastO = null, rBody = null, oBody = null, shown = 0; listBox.textContent = ''; seq = 0;
            stations.forEach(function (s) {
                if (term && (s.name + ' ' + s.office + ' ' + (s.region || '')).indexOf(term) < 0) return;
                var rid = 'r|' + s.region, oid = 'o|' + s.region + '|' + s.office;
                if (s.region !== lastR) { var r = acc('region', rid, s.region || '지방청 미상'); listBox.appendChild(r.wrap); rBody = r.body; lastR = s.region; lastO = null; }
                if (s.office !== lastO) { var o = acc('office', oid, s.office); rBody.appendChild(o.wrap); oBody = o.body; lastO = s.office; }
                var b = el('button', 'sb-station-btn'); b.type = 'button'; b.setAttribute('data-key', s.key); b.setAttribute('aria-pressed', 'false');
                b.appendChild(document.createTextNode(s.name));
                if (s.seaOnly) b.appendChild(el('small', null, '해상만'));
                b.addEventListener('click', function (e) { e.stopPropagation(); opts.onPick(s); });
                oBody.appendChild(b); shown++;
            });
            if (!shown) listBox.appendChild(el('p', 'sb-small', stations.length ? '찾는 관할이 없습니다.' : '관할 목록을 받지 못했습니다.'));
            refresh();
        }
        /** 찾기 글자가 바뀌면 — 글자가 있으면 맞는 묶음을 모두 펼치고, 지우면 고른 관할 묶음만. */
        function onInput() {
            var term = q.value.trim(); open = {};
            if (term) stations.forEach(function (s) { if ((s.name + ' ' + s.office + ' ' + (s.region || '')).indexOf(term) >= 0) { open['r|' + s.region] = true; open['o|' + s.region + '|' + s.office] = true; } });
            else openSelected();
            draw();
        }
        /** 칩의 눌림 표시를 지금 선택에 맞춘다. */
        function refresh() { var key = opts.selected(); listBox.querySelectorAll('[data-key]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-key') === key)); }); }
        q.addEventListener('input', onInput);
        q.addEventListener('click', function (e) { e.stopPropagation(); });
        openSelected(); draw();
        // 지도에서 고르고 이 탭으로 오면 그 관할 묶음을 펼쳐 보인다(찾기 중이 아니면).
        return { shown: function () { if (!q.value.trim()) { openSelected(); draw(); } }, refresh: refresh };
    }

    w.StationBriefingPicker = { mount: mount, destroy: destroy, _map: function () { return P.map; }, _layer: function () { return P.layer; } };
})(window);
