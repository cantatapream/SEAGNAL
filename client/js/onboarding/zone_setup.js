/**
 * 파일: client/js/onboarding/zone_setup.js
 *
 * 역할: 앱을 처음 켠 사람이 **관심 해역을 고르는 화면**입니다.
 *       ①"설정해보세요" 안내 → ②어느 바다인지 고르기(동해·서해·남해·제주)
 *       → ③고른 바다마다 지도에서 구역을 눌러 고르기 → ④설정에 저장.
 *       고르고 나면 이어서 튜토리얼이 시작됩니다.
 *
 * [연계]
 *  - 사용파일 : js/core/config.js (SEA_REGIONS · SUB_REGION_ZONES — 바다/구역 목록)
 *               js/ocean-map/map/ocean_map.js (oceanCreateKhoaLayer — 배경 바다지도)
 *               js/settings/settings.js (UserSettings — weatherAppSettings_v1 저장)
 *               js/ocean-map/warnings/ocean_warn_zone.js (normalizeZoneName — 이름 맞추기)
 *               assets/vendor/ol/ol.js (지도)
 *  - 서버API  : GET /api/warn-zones (특보구역 실제 경계 44개, GeoJSON)
 *  - 마크업   : 없음 — 이 파일이 덮개를 통째로 만들어 body 에 붙인다
 *  - 호출처   : js/tutorial/tutorial.js 의 숨은 진입로(공지사항 탭 3초 안에 5연타)
 *               window.openZoneSetup(끝났을때호출할함수)
 *
 * [로드 순서] index2.html 맨 끝, tutorial.js **앞**(tutorial.js 가 이 파일을 부른다)
 *
 * ⚠ 아직 일반 사용자에게는 보이지 않습니다 — 숨은 진입로로만 열리는 시험 모드입니다.
 */
(function () {
    'use strict';

    // ========================================================================
    // [모양 값] 튜토리얼(js/tutorial/tutorial.js)과 같은 색을 쓴다
    // ========================================================================
    var C_CARD   = '#1c2338';
    var C_ACCENT = '#448aff';
    var C_TEXT   = '#cbd5e1';
    var C_SUB    = '#94a3b8';
    var C_BORDER = 'rgba(255,255,255,0.12)';
    var C_DIM    = 'rgba(6,11,24,0.88)';
    var WARN_ZONES_URL = '/api/warn-zones';

    var _root = null;      // 덮개
    var _onDone = null;    // 끝나면 부를 함수(튜토리얼 시작)
    var _macroSel = [];    // 고른 바다 이름들 ('동해' …)
    var _queueIdx = 0;     // 지금 몇 번째 바다를 고르는 중인가
    var _picked = {};      // { 구역명: true } — 고른 구역
    var _geo = null;       // /api/warn-zones 응답(한 번만 받아 둔다)
    var _map = null;       // 지도
    var _layer = null;     // 구역 폴리곤 레이어

    // ========================================================================
    // [자료 읽기]
    // ========================================================================

    /**
     * 한 바다(대분류)에 속한 구역 이름을 모두 모은다.
     * @param {string} macro - '동해' | '서해' | '남해' | '제주'
     * @returns {Array<string>} 구역 이름들 (없으면 빈 배열)
     * [연계] config.js 의 SEA_REGIONS · SUB_REGION_ZONES
     */
    function _zonesOf(macro) {
        if (typeof SEA_REGIONS === 'undefined' || typeof SUB_REGION_ZONES === 'undefined') return [];
        var subs = (SEA_REGIONS[macro] && SEA_REGIONS[macro].subRegions) || [];
        var out = [];
        subs.forEach(function (sub) {
            (SUB_REGION_ZONES[sub] || []).forEach(function (z) { out.push(z); });
        });
        return out;
    }

    /**
     * 지도 자료의 구역 이름을 앱에서 쓰는 이름으로 맞춘다.
     *
     * 왜 필요한가?
     *   같은 구역인데 자료마다 적는 법이 다르다 — 지도는 "동해남부 남쪽 안쪽먼바다",
     *   앱은 "동해남부남쪽안쪽먼바다"(띄어쓰기 없음), "인천.경기" vs "인천·경기".
     *   앱에 이미 그 변환 함수가 있어 그대로 쓰고, 없을 때만 같은 규칙으로 대신한다.
     *
     * @param {string} name - 지도 자료의 이름
     * @returns {string} 앱에서 쓰는 이름
     */
    function _appName(name) {
        if (window.OceanWarnZone && typeof window.OceanWarnZone.normalizeZoneName === 'function') {
            return window.OceanWarnZone.normalizeZoneName(name);
        }
        return String(name || '').replace(/\s+/g, '').replace(/\./g, '·');
    }

    /**
     * 특보구역 경계(44개)를 한 번만 받아 둔다.
     * @param {Function} done - 받아오면 부를 함수(실패하면 null 을 넘긴다)
     * [연계] GET /api/warn-zones — 해양종합정보 지도가 쓰는 것과 같은 자료
     */
    function _loadZones(done) {
        if (_geo) { done(_geo); return; }
        fetch(WARN_ZONES_URL)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) { _geo = j; done(j); })
            .catch(function () { done(null); });
    }

    // ========================================================================
    // [화면 조각]
    // ========================================================================

    /**
     * 덮개를 만들어 화면에 붙인다(터치는 덮개가 모두 받는다).
     * @returns {HTMLElement}
     */
    function _build() {
        var root = document.createElement('div');
        root.id = 'zone-setup-overlay';
        root.style.cssText = 'position:fixed;inset:0;z-index:100000;background:' + C_DIM
            + ';display:flex;align-items:center;justify-content:center;'
            + 'padding:calc(16px + env(safe-area-inset-top,0px)) 14px calc(16px + env(safe-area-inset-bottom,0px));'
            + 'box-sizing:border-box;font-family:\'Noto Sans KR\',sans-serif;';

        var flag = document.createElement('div');
        flag.textContent = '관심해역 설정 시험 모드';
        flag.style.cssText = 'position:absolute;left:12px;top:calc(10px + env(safe-area-inset-top,0px));'
            + 'padding:4px 10px;border-radius:20px;background:rgba(68,138,255,0.18);border:1px solid '
            + C_ACCENT + ';color:' + C_ACCENT + ';font-size:0.66rem;font-weight:700;letter-spacing:0.5px;';
        root.appendChild(flag);

        var card = document.createElement('div');
        card.id = 'zone-setup-card';
        card.style.cssText = 'width:100%;max-width:420px;max-height:100%;box-sizing:border-box;'
            + 'background:linear-gradient(145deg,#1e293b,#0f172a);border:1px solid ' + C_BORDER
            + ';border-radius:20px;padding:24px 18px;box-shadow:0 20px 60px rgba(0,0,0,0.5);'
            + 'display:flex;flex-direction:column;overflow-y:auto;';
        root.appendChild(card);
        return root;
    }

    /** 카드 속을 비운다. @returns {HTMLElement} 카드 */
    function _card() {
        var c = _root.querySelector('#zone-setup-card');
        c.innerHTML = '';
        return c;
    }

    /**
     * 큰 버튼 하나를 만든다.
     * @param {string} label - 글자
     * @param {boolean} primary - true 면 파란 강조 버튼
     * @param {Function} onClick
     * @returns {HTMLElement}
     */
    function _btn(label, primary, onClick) {
        var b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'width:100%;padding:' + (primary ? '14px' : '12px')
            + ';border-radius:12px;font-size:' + (primary ? '1rem' : '0.88rem')
            + ';font-weight:' + (primary ? '700' : '500') + ';cursor:pointer;'
            + (primary
                ? 'background:linear-gradient(135deg,#448aff,#2f6fe0);border:none;color:#fff;'
                  + 'box-shadow:0 4px 15px rgba(68,138,255,0.3);'
                : 'background:transparent;border:1px solid rgba(255,255,255,0.08);color:#64748b;');
        b.onclick = onClick;
        return b;
    }

    // ========================================================================
    // [1단계] 안내
    // ========================================================================

    function _stepGate() {
        var c = _card();
        c.style.textAlign = 'center';
        c.innerHTML = '<div style="width:60px;height:60px;margin:0 auto 16px;'
            + 'background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:16px;'
            + 'display:flex;align-items:center;justify-content:center;font-size:1.6rem;">★</div>'
            + '<h3 style="color:#fff;font-size:1.15rem;margin:0 0 8px;font-weight:700;line-height:1.4;">'
            + '관심 해역을 설정해보세요</h3>'
            + '<p style="color:' + C_SUB + ';font-size:0.85rem;margin:0 0 20px;line-height:1.6;">'
            + '관심 해역만 선택하면<br>꼭 필요한 특보 알림만 받을 수 있어요</p>';
        var go = _btn('관심 해역 설정하기', true, _stepMacro);
        go.style.marginBottom = '10px';
        c.appendChild(go);
        c.appendChild(_btn('건너뛰기', false, function () { _close(true); }));
    }

    // ========================================================================
    // [2단계] 어느 바다인지 고르기
    // ========================================================================

    function _stepMacro() {
        var c = _card();
        c.style.textAlign = 'left';
        c.innerHTML = '<h3 style="color:#fff;font-size:1.1rem;margin:0 0 6px;font-weight:700;">'
            + '관심해역을 클릭해보세요</h3>'
            + '<p style="color:' + C_SUB + ';font-size:0.82rem;margin:0 0 20px;line-height:1.55;">'
            + '화면에서 관심해역 위주로 표시됩니다.</p>';

        var grid = document.createElement('div');
        grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:22px;';
        var names = (typeof SEA_REGIONS !== 'undefined') ? Object.keys(SEA_REGIONS) : [];
        names.forEach(function (m) {
            var info = SEA_REGIONS[m] || {};
            var chip = document.createElement('button');
            chip.dataset.macro = m;
            chip.textContent = (info.icon || '') + ' ' + (info.displayName || m);
            chip.onclick = function () {
                var i = _macroSel.indexOf(m);
                if (i === -1) _macroSel.push(m); else _macroSel.splice(i, 1);
                _paintChip(chip, i === -1);
                ok.disabled = _macroSel.length === 0;
                ok.style.opacity = ok.disabled ? '0.45' : '1';
            };
            _paintChip(chip, _macroSel.indexOf(m) !== -1);
            grid.appendChild(chip);
        });
        c.appendChild(grid);

        var ok = _btn('확인', true, function () {
            if (!_macroSel.length) return;
            _queueIdx = 0;
            _stepZone();
        });
        ok.disabled = _macroSel.length === 0;
        ok.style.opacity = ok.disabled ? '0.45' : '1';
        c.appendChild(ok);
    }

    /**
     * 바다 칩 하나의 색을 고른 상태/안 고른 상태로 칠한다.
     * @param {HTMLElement} chip
     * @param {boolean} on - 고른 상태면 true
     */
    function _paintChip(chip, on) {
        chip.style.cssText = 'padding:14px 8px;border-radius:12px;font-size:0.9rem;font-weight:600;'
            + 'cursor:pointer;transition:0.15s;'
            + (on
                ? 'background:rgba(68,138,255,0.18);border:1.5px solid ' + C_ACCENT + ';color:#fff;'
                : 'background:rgba(255,255,255,0.04);border:1.5px solid ' + C_BORDER + ';color:' + C_TEXT + ';');
    }

    // ========================================================================
    // [3단계] 지도에서 구역 고르기 (고른 바다마다 한 번씩)
    // ========================================================================

    function _stepZone() {
        var macro = _macroSel[_queueIdx];
        var c = _card();
        c.style.textAlign = 'left';

        var head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;';
        head.innerHTML = '<h3 style="color:#fff;font-size:1.05rem;margin:0;font-weight:700;">'
            + macro + ' 특보구역을 선택해주세요</h3>'
            + '<span style="font-size:0.7rem;font-weight:700;color:' + C_SUB + ';">'
            + (_queueIdx + 1) + ' / ' + _macroSel.length + '</span>';
        c.appendChild(head);

        var desc = document.createElement('p');
        desc.style.cssText = 'color:' + C_SUB + ';font-size:0.78rem;margin:0 0 12px;line-height:1.5;';
        desc.textContent = '선택한 구역이 관심해역으로 등록됩니다. 지도를 눌러 구역을 고르고, '
            + '확대·이동해서 경계를 확인해보세요.';
        c.appendChild(desc);

        var box = document.createElement('div');
        box.id = 'zone-setup-map';
        // [주의] 높이를 flex 로 늘리면 지도 알맹이(.ol-viewport)의 height:100% 가 0 으로 풀려
        //   지도가 그려지긴 해도 **터치가 안 먹는다**(실측 확인). 그래서 높이를 화면 비율(vh)로
        //   못박아 부모 높이를 확정해 준다.
        box.style.cssText = 'position:relative;width:100%;flex:0 0 auto;height:46vh;min-height:240px;'
            + 'border-radius:14px;overflow:hidden;border:1px solid ' + C_BORDER + ';margin-bottom:10px;'
            + 'background:#0d1830;';
        c.appendChild(box);

        var count = document.createElement('div');
        count.id = 'zone-setup-count';
        count.style.cssText = 'color:' + C_SUB + ';font-size:0.76rem;margin:0 0 10px;';
        c.appendChild(count);

        var ok = _btn(_queueIdx + 1 < _macroSel.length ? '확인 (다음 해역)' : '확인 (설정 마치기)', true, function () {
            _queueIdx += 1;
            _destroyMap();
            if (_queueIdx < _macroSel.length) _stepZone();
            else { _save(); _close(false); }
        });
        c.appendChild(ok);

        _makeMap(box, macro, count);
    }

    /**
     * 지도를 만들고 그 바다의 구역만 그린다.
     *
     * @param {HTMLElement} box - 지도를 담을 칸
     * @param {string} macro - 지금 고르는 바다
     * @param {HTMLElement} countEl - "n개 선택" 을 적을 자리
     * [연계] /api/warn-zones · ol.js — 다른 화면(낚시·갯벌 지도)과 같은 방식
     */
    function _makeMap(box, macro, countEl) {
        var mine = {};
        _zonesOf(macro).forEach(function (z) { mine[z] = true; });

        _loadZones(function (geo) {
            if (!_root || !geo || typeof ol === 'undefined') {
                box.innerHTML = '<div style="padding:24px;color:' + C_SUB + ';font-size:0.85rem;'
                    + 'text-align:center;line-height:1.6;">지도를 불러오지 못했습니다.<br>'
                    + '설정(⚙️) → 관심해역 에서 고를 수 있습니다.</div>';
                return;
            }
            var all = new ol.format.GeoJSON().readFeatures(geo, {
                dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'
            });
            var feats = all.filter(function (f) { return mine[_appName(f.get('name'))]; });

            var src = new ol.source.Vector({ features: feats });
            // declutter: 구역 이름이 겹치면 한쪽을 숨긴다 — 앞바다들이 붙어 있어
            //   겹친 글자가 서로를 덮어 읽을 수 없기 때문(확대하면 다시 보인다).
            _layer = new ol.layer.Vector({ source: src, style: _zoneStyle, declutter: true });
            // 배경 지도는 앱의 해아름(KHOA) 바다지도를 그대로 쓴다(관리자 구역편집기와 같은 방식).
            var base = (typeof window.oceanCreateKhoaLayer === 'function')
                ? window.oceanCreateKhoaLayer('BASEMAP_RLTM3857')
                : new ol.layer.Tile({ source: new ol.source.OSM() });
            base.setVisible(true);
            _map = new ol.Map({
                target: box,
                layers: [base, _layer],
                view: new ol.View({ center: ol.proj.fromLonLat([128, 36]), zoom: 6, minZoom: 5, maxZoom: 12 }),
                controls: ol.control.defaults.defaults({ attribution: false, zoom: false })
            });
            _map.updateSize();
            if (feats.length) {
                _map.getView().fit(src.getExtent(), { size: _map.getSize(), padding: [24, 24, 24, 24] });
            }
            window.__zsMap = _map; window.__zsLayer = _layer;   // 시험용 손잡이
            _map.on('singleclick', function (evt) {
                var hit = null;
                _map.forEachFeatureAtPixel(evt.pixel, function (f) { hit = f; return true; },
                    { layerFilter: function (l) { return l === _layer; } });
                if (!hit) return;
                var nm = _appName(hit.get('name'));
                if (_picked[nm]) delete _picked[nm]; else _picked[nm] = true;
                _layer.changed();
                _updateCount(countEl, macro);
            });
            _updateCount(countEl, macro);
        });
    }

    /**
     * 구역 하나를 어떻게 칠할지 정한다(고른 것은 파랗게).
     * @param {Object} feature - ol feature
     * @returns {Object} ol.style.Style
     */
    function _zoneStyle(feature) {
        var on = !!_picked[_appName(feature.get('name'))];
        // [주의] 배경이 밝은 바다지도라, 안 고른 구역의 선·글자는 **어둡게** 해야 보인다
        //   (흰 선으로 두면 배경에 묻혀 경계가 안 보였다 — 실제 화면으로 확인).
        return new ol.style.Style({
            fill: new ol.style.Fill({ color: on ? 'rgba(68,138,255,0.45)' : 'rgba(13,24,48,0.10)' }),
            stroke: new ol.style.Stroke({ color: on ? C_ACCENT : 'rgba(13,24,48,0.55)', width: on ? 2.5 : 1.2 }),
            text: new ol.style.Text({
                text: _appName(feature.get('name')),
                font: '11px "Noto Sans KR",sans-serif',
                fill: new ol.style.Fill({ color: on ? '#ffffff' : '#0f172a' }),
                stroke: new ol.style.Stroke({ color: on ? 'rgba(6,11,24,0.85)' : 'rgba(255,255,255,0.9)', width: 3 }),
                overflow: true
            })
        });
    }

    /**
     * "n개 선택" 글을 갱신한다.
     * @param {HTMLElement} el
     * @param {string} macro
     */
    function _updateCount(el, macro) {
        if (!el) return;
        // [왜 이름까지 적나] 구역이 붙어 있으면 지도 위 이름표가 겹쳐 일부가 숨는다(declutter).
        //   그래서 고른 구역 이름을 여기에 적어 무엇을 골랐는지 확실히 보이게 한다.
        var got = _zonesOf(macro).filter(function (z) { return _picked[z]; });
        el.textContent = got.length
            ? ('고른 구역 ' + got.length + '개 — ' + got.join(', '))
            : '아직 고른 구역이 없습니다. 지도를 눌러 고르세요.';
    }

    /** 지도를 치운다(다음 바다로 넘어가거나 닫을 때). */
    function _destroyMap() {
        if (_map) { _map.setTarget(null); _map = null; }
        _layer = null;
    }

    // ========================================================================
    // [저장]
    // ========================================================================

    /**
     * 고른 구역을 앱 설정에 적는다.
     *
     * 무엇을 하나?
     *   고른 구역만 켜고 나머지는 끈다. 고른 구역이 속한 바다·중분류는 켜 둔다
     *   (부모가 꺼져 있으면 자식도 안 보이기 때문 — UserSettings.isVisible 규칙).
     *   하나도 안 골랐으면 아무것도 바꾸지 않는다(지금까지 보던 대로 둔다).
     *
     * [연계] settings.js 의 UserSettings(weatherAppSettings_v1)
     */
    function _save() {
        if (typeof UserSettings === 'undefined') return;
        var picked = Object.keys(_picked);
        if (!picked.length) return;

        Object.keys(SEA_REGIONS).forEach(function (macro) {
            var subs = (SEA_REGIONS[macro].subRegions) || [];
            var macroOn = false;
            subs.forEach(function (sub) {
                var subOn = false;
                (SUB_REGION_ZONES[sub] || []).forEach(function (z) {
                    var on = !!_picked[z];
                    UserSettings.set(z, on);
                    if (on) subOn = true;
                });
                UserSettings.set(sub, subOn);
                if (subOn) macroOn = true;
            });
            UserSettings.set(macro, macroOn);
        });
        UserSettings.save();

        // 설정(⚙️) 화면에서 [저장]을 눌렀을 때와 **같은 뒷정리**를 한다
        // (settings.js 의 saveSettingsAndClose 와 같은 순서) — 푸시 알림 대상 갱신 +
        // 특보·기상현황·예보 화면 다시 그리기. 없는 함수는 건너뛴다.
        try {
            if (typeof window.subscribeUser === 'function') window.subscribeUser();
            if (typeof window.renderApp === 'function') window.renderApp();
            if (typeof window.renderMarineWeatherStatus === 'function') window.renderMarineWeatherStatus();
            if (typeof window.loadRegionalForecast === 'function') window.loadRegionalForecast();
            if (typeof window.rerenderAdvisoryPrediction === 'function') window.rerenderAdvisoryPrediction();
        } catch (e) { /* 다시 그리기 실패는 설정 저장과 무관 — 저장은 이미 끝났다 */ }
    }

    // ========================================================================
    // [열기 / 닫기]
    // ========================================================================

    /**
     * 관심해역 설정 화면을 연다.
     *
     * @param {Function} [onDone] - 다 고르거나 건너뛰면 부를 함수(튜토리얼 시작에 쓴다)
     * [연계] tutorial.js 의 숨은 진입로가 부른다. 콘솔에서 window.openZoneSetup() 로도 열린다.
     */
    function open(onDone) {
        if (_root) return;
        _onDone = (typeof onDone === 'function') ? onDone : null;
        _macroSel = [];
        _queueIdx = 0;
        _picked = {};
        _root = _build();
        document.body.appendChild(_root);
        _stepGate();
    }

    /**
     * 화면을 닫는다.
     *
     * @param {boolean} skipped - 건너뛰기로 닫았으면 true
     * [연계] 닫을 때 zone_guide 의 "관심 해역을 설정해보세요" 팝업을 끈다 —
     *        같은 말을 두 번 하지 않기 위해서다(설계 인수인계 문서의 요청).
     */
    function _close(skipped) {
        _destroyMap();
        if (_root) { _root.remove(); _root = null; }
        try { localStorage.setItem('zone_guide_dismissed', 'true'); } catch (e) { /* 저장 실패는 무시 */ }
        var done = _onDone;
        _onDone = null;
        if (done) done(skipped);
    }

    window.openZoneSetup = open;
})();
