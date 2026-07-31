/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/life_safety.js
 * 역할  : "해양생활안전" 화면 — 하단 해양생활 탭을 10번 연달아 누르면 열리는 시험용 화면.
 *         하위탭을 [해양안전 | 해양생활] 로 바꾸고, 해양생활 쪽은 6개 활동(바다낚시·서핑·
 *         해수욕·스킨스쿠버·갯벌체험·바다갈라짐)을 화면 오른쪽 세로 버튼으로 갈아끼우며,
 *         배경지도(기본맵·전자해도·해안도·세계지도)를 해양종합정보와 같은 방식으로 고른다.
 *         새로고침(앱 재시작)하면 원래 해양생활 화면으로 돌아온다 — 저장하지 않음.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.oceanCreateKhoaLayer — 해아름 WMS 레이어),
 *                    shared/ui/ui_modal.js(window.showSeagnalModal — 안내 팝업),
 *                    marine-life/*(fishing·surfing·scuba·mudflat·sea_parting — 활동 로직 그대로 재사용),
 *                    forecast/alerts/marine.js(TAB_GROUP_SUBTABS·SECTION_TO_GROUP·switchSubTab)
 *  - 서버 API      : 없음 (활동별 데이터 호출은 각 활동 모듈이 기존대로 담당)
 *  - 마크업        : index2.html 의 #ocean-safety-section, #ocean-safety-sub-tabs,
 *                    #ls-topleft-controls, #ls-rail
 *  - 나를 쓰는 곳  : 없음 — 스스로 하단 해양생활 탭 클릭을 세어 진입한다
 * [로드 순서] js/core/index2_patch.js 다음 — index2_patch 가 감싼 switchMainTab/
 *             switchSubTab 위에 한 겹 더 얹어야 하므로 반드시 그 뒤 · 순서 변경 금지
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수
    // ========================================================================

    /** 트리거: 해양생활 탭을 몇 번 눌러야 열리는가 (ocean_typhoon.js 의 잠금해제와 동일 규격) */
    var TAP_THRESHOLD = 10;
    /** 트리거: 이 시간(ms) 안에 다음 탭이 없으면 카운트 초기화 */
    var TAP_RESET_MS = 3000;

    /**
     * 오른쪽 세로 버튼(레일)에 올릴 활동 목록.
     *  - id      : 기존 섹션 DOM id (그대로 재사용)
     *  - label   : 버튼에 쓰는 글자 (아이콘 없이 텍스트만)
     *  - gpsBtn  : 그 활동이 이미 갖고 있는 "내 위치" 버튼 id (없으면 null)
     *  - getMap  : 그 활동의 OpenLayers 지도 인스턴스를 얻는 함수 (지도 없는 활동은 null)
     * [주의] 이안류(ripcurrent)는 현재 하위탭에서도 숨김 상태라 여기서도 뺀다.
     */
    var ACTIVITIES = [
        { id: 'fishing-section',     label: '바다낚시',   gpsBtn: 'fishing-my-location-btn', getMap: function () { return window.getFishingMap && window.getFishingMap(); } },
        { id: 'surfing-section',     label: '서핑',       gpsBtn: 'surfing-my-location-btn', getMap: function () { return (window._surfing && window._surfing.map) || null; } },
        { id: 'swimming-section',    label: '해수욕',     gpsBtn: null,                      getMap: null },
        { id: 'scuba-section',       label: '스킨스쿠버', gpsBtn: 'scuba-my-location-btn',   getMap: function () { return window.getScubaMap && window.getScubaMap(); } },
        { id: 'mudflat-section',     label: '갯벌체험',   gpsBtn: 'mudflat-my-location-btn', getMap: function () { return window.getMudflatMap && window.getMudflatMap(); } },
        { id: 'sea-parting-section', label: '바다갈라짐', gpsBtn: null,                      getMap: null }
    ];

    /** 배경지도 종류 → 버튼에 표시할 이름 (해양종합정보 switchBaseLayer 와 동일 표기) */
    var BASEMAP_NAMES = { rltm: '기본맵', enc: '전자해도', coast: '해안도', osm: '세계지도' };

    /** 해아름 WMS 레이어명 — ocean_map.js 와 동일 (기본맵/전자해도/해안도) */
    var KHOA_LAYERS = {
        rltm:  'BASEMAP_RLTM3857',
        enc:   'BASEMAP_ENC573857',
        coast: 'BASEMAP_RLTMCOAST3857'
    };

    // ========================================================================
    // 상태 (전부 메모리 — localStorage 에 남기지 않으므로 새로고침하면 원상복구)
    // ========================================================================

    var _tapCount = 0;          // 해양생활 탭 연타 횟수
    var _tapTimer = null;       // 연타 초기화 타이머
    var _unlocked = false;      // 해양생활안전 화면이 열렸는가
    var _currentAct = 'fishing-section';  // 현재 보고 있는 활동 섹션 id
    var _currentBase = 'rltm';  // 현재 배경지도 종류
    var _lastView = null;       // 활동을 바꿔도 지도 위치가 이어지도록 기억 {center, zoom}
    var _decorated = [];        // 배경지도 레이어를 이미 끼워 넣은 지도 목록(중복 방지)

    // ========================================================================
    // 1. 트리거 — 해양생활 탭 10회 연타
    // ========================================================================

    /**
     * 하단 "해양생활" 메인탭에 연타 감지를 붙인다.
     * 예: 3초 안에 10번 누르면 해양생활안전 화면이 열린다(그 전까지는 평소대로 동작).
     * [연계] → _unlock() — 임계치에 닿았을 때 화면을 바꾼다.
     *          index2.html 의 .tab-btn[data-target="ocean-life-group"] 이 대상
     */
    function _bindTrigger() {
        var tabBtn = document.querySelector('.main-tabs .tab-btn[data-target="ocean-life-group"]');
        if (!tabBtn) return;

        tabBtn.addEventListener('click', function () {
            if (_unlocked) return;

            _tapCount++;
            clearTimeout(_tapTimer);
            _tapTimer = setTimeout(function () { _tapCount = 0; }, TAP_RESET_MS);

            if (_tapCount < TAP_THRESHOLD) return;
            _tapCount = 0;
            _unlock();
        });
    }

    /**
     * 해양생활안전 화면으로 전환한다 (이 세션 동안만).
     * 하위탭 바를 [해양안전 | 해양생활] 로 갈아끼우고 body 에 표시용 클래스를 붙인 뒤
     * 해양생활 탭을 다시 열어 새 화면이 그려지게 한다.
     * [연계] → marine.js 의 TAB_GROUP_SUBTABS (그룹이 어떤 하위탭 바를 쓰는지의 출처)
     *          → window.switchMainTab — 실제 화면 전환
     */
    function _unlock() {
        _unlocked = true;

        // 해양생활 그룹이 쓰는 하위탭 바를 새 것으로 교체
        if (typeof TAB_GROUP_SUBTABS !== 'undefined') {
            TAB_GROUP_SUBTABS['ocean-life-group'] = 'ocean-safety-sub-tabs';
        }

        document.body.classList.add('ls-mode');

        if (typeof window.switchMainTab === 'function') {
            window.switchMainTab('ocean-life-group');
        }
    }

    // ========================================================================
    // 2. 화면 동기화 — 어떤 활동이 켜져 있는지에 따라 크롬(우측 레일/좌측 상단)을 맞춘다
    // ========================================================================

    /**
     * 현재 활성 섹션을 보고 우측 레일·좌측 상단 컨트롤 상태를 맞춘다.
     * 예: 서핑 섹션이 켜져 있으면 → 레일의 "서핑" 버튼만 진하게, 갯바위/선상 팝아웃은 감춤,
     *     GPS 버튼은 서핑의 내 위치 버튼을 대신 누르도록 연결.
     * [연계] ← _wrapTabSwitchers() 가 탭 전환 직후마다 호출 / → _decorateMap() 배경지도 준비
     */
    function _syncChrome() {
        if (!_unlocked) return;

        var actId = null;
        for (var i = 0; i < ACTIVITIES.length; i++) {
            var sec = document.getElementById(ACTIVITIES[i].id);
            if (sec && sec.classList.contains('active')) { actId = ACTIVITIES[i].id; break; }
        }

        // 활동 섹션이 아닌 곳(해양안전 등)에 있으면 레일/좌측 컨트롤을 숨긴다
        document.body.classList.toggle('ls-life', !!actId);
        if (!actId) return;

        _currentAct = actId;

        // 하위탭 바의 "해양생활" 버튼이 항상 현재 활동을 가리키도록 동기화
        var lifeSubBtn = document.getElementById('ls-life-sub-btn');
        if (lifeSubBtn) {
            lifeSubBtn.setAttribute('data-target', actId);
            lifeSubBtn.classList.add('active');
        }

        // 레일 버튼 active 표시 ([data-act] 로 한정 — 갯바위/선상 팝아웃 버튼은 제외)
        var railBtns = document.querySelectorAll('#ls-rail .ls-act-btn[data-act]');
        for (var j = 0; j < railBtns.length; j++) {
            railBtns[j].classList.toggle('active', railBtns[j].getAttribute('data-act') === actId);
        }

        // 갯바위/선상 팝아웃은 바다낚시일 때만 의미가 있으므로 다른 활동으로 가면 접는다
        // (바다낚시 버튼 자체는 레일에 계속 남아 있어야 하므로 wrap 은 숨기지 않는다)
        var gubunWrap = document.getElementById('ls-gubun-wrap');
        if (gubunWrap && actId !== 'fishing-section') {
            gubunWrap.classList.remove('popup-open');
        }

        // GPS 버튼: 그 활동에 내 위치 기능이 있을 때만 노출
        var act = _findActivity(actId);
        var gpsBtn = document.getElementById('ls-gps-btn');
        if (gpsBtn) gpsBtn.style.display = (act && act.gpsBtn) ? '' : 'none';

        // 지도가 있는 활동이면 배경지도 레이어를 준비하고 직전 위치를 이어받는다
        _prepareMap(act);
    }

    /**
     * 활동 id 로 ACTIVITIES 항목을 찾는다.
     * 예: _findActivity('surfing-section') → { id:'surfing-section', label:'서핑', ... }
     * @param {string} id - 섹션 DOM id
     * @returns {Object|null} 활동 정보 (없으면 null)
     * [연계] ← _syncChrome() / _selectActivity() — 활동별 버튼·지도 연결에 사용
     */
    function _findActivity(id) {
        for (var i = 0; i < ACTIVITIES.length; i++) {
            if (ACTIVITIES[i].id === id) return ACTIVITIES[i];
        }
        return null;
    }

    /**
     * 활동을 바꾼다 (우측 레일 버튼 클릭).
     * 기존 하위탭 전환 함수를 그대로 쓰기 때문에 지도 초기화·사용량 집계 등
     * 기존 동작이 모두 유지된다.
     * @param {string} sectionId - 이동할 활동 섹션 id
     * [연계] → window.switchSubTab (marine.js) — 섹션 표시/초기화 / → _syncChrome()
     */
    function _selectActivity(sectionId) {
        // 활동을 떠나기 전에 지금 지도 위치를 기억해 둔다 (다음 활동이 이어받도록)
        _rememberView();
        if (typeof window.switchSubTab === 'function') {
            window.switchSubTab(sectionId);
        }
    }

    // ========================================================================
    // 3. 지도 — 배경지도 4종 + 활동 간 위치 이어받기
    // ========================================================================

    /**
     * 현재 활동의 지도 위치(중심·줌)를 기억한다.
     * 활동을 바꿔도 "지도 하나를 계속 보고 있는" 느낌이 나게 하기 위함.
     * [연계] ← _selectActivity() / → _prepareMap() 가 기억한 값을 적용
     */
    function _rememberView() {
        var act = _findActivity(_currentAct);
        var map = act && act.getMap && act.getMap();
        if (!map || !map.getView) return;
        try {
            _lastView = { center: map.getView().getCenter(), zoom: map.getView().getZoom() };
        } catch (e) { /* 지도가 아직 준비 전이면 무시 */ }
    }

    /**
     * 활동의 지도에 배경지도 4종을 준비하고, 직전 활동의 위치를 이어받는다.
     * 지도가 아직 안 만들어졌을 수 있으므로(활동 진입 시 200ms 뒤 초기화) 잠시 뒤 다시 시도한다.
     * @param {Object|null} act - ACTIVITIES 항목
     * [연계] ← _syncChrome() / → _decorateMap(), _applyBasemap()
     */
    function _prepareMap(act) {
        if (!act || !act.getMap) return;

        function _try(retries) {
            var map = act.getMap();
            if (!map) {
                if (retries > 0) setTimeout(function () { _try(retries - 1); }, 250);
                return;
            }
            _decorateMap(map);
            _applyBasemap(_currentBase);
            if (_lastView && _lastView.center) {
                try {
                    map.getView().setCenter(_lastView.center);
                    map.getView().setZoom(_lastView.zoom);
                } catch (e) { /* 줌 한계가 다른 지도면 OL 이 알아서 맞춘다 */ }
            }
            if (map.updateSize) map.updateSize();
        }
        _try(6);
    }

    /**
     * 활동 지도에 해아름 배경지도(기본맵·전자해도·해안도) 레이어를 끼워 넣는다.
     * 원래 있던 OSM 타일은 "세계지도" 선택지로 그대로 쓴다.
     * 예: 바다낚시 지도 layers = [기본맵, 전자해도, 해안도, OSM, 마커…]
     * @param {ol.Map} map - 대상 지도
     * [연계] → ocean_map.js 의 window.oceanCreateKhoaLayer — WMS 프록시 설정을 그대로 재사용
     */
    function _decorateMap(map) {
        if (_decorated.indexOf(map) !== -1) return;
        if (typeof window.oceanCreateKhoaLayer !== 'function') return;

        var layers = map.getLayers();
        // 원래 첫 레이어가 OSM 타일 — 세계지도 선택지로 표시해 둔다
        var osm = layers.item(0);
        if (osm) osm.set('lsBase', 'osm');

        var order = ['rltm', 'enc', 'coast'];
        for (var i = 0; i < order.length; i++) {
            var lyr = window.oceanCreateKhoaLayer(KHOA_LAYERS[order[i]]);
            lyr.set('lsBase', order[i]);
            lyr.setVisible(false);
            layers.insertAt(i, lyr);
        }
        _decorated.push(map);
    }

    /**
     * 배경지도를 지정한 종류로 바꾼다 (지금까지 준비된 모든 활동 지도에 함께 적용).
     * 예: _applyBasemap('enc') → 전자해도만 보이고 나머지 배경은 숨김
     * @param {string} type - 'rltm' | 'enc' | 'coast' | 'osm'
     * [연계] ← 좌측 상단 배경지도 메뉴 클릭 / _prepareMap() 진입 시 현재 선택 재적용
     */
    function _applyBasemap(type) {
        _currentBase = type;

        for (var i = 0; i < _decorated.length; i++) {
            var layers = _decorated[i].getLayers().getArray();
            for (var j = 0; j < layers.length; j++) {
                var kind = layers[j].get('lsBase');
                if (kind) layers[j].setVisible(kind === type);
            }
        }

        // 토글 버튼 라벨 + 메뉴 active 표시 갱신
        var label = document.getElementById('ls-basemap-label');
        if (label) {
            label.textContent = BASEMAP_NAMES[type] || '지도';
            label.setAttribute('data-line1', BASEMAP_NAMES[type] || '지도');
        }
        var items = document.querySelectorAll('#ls-basemap-menu .ocean-basemap-item');
        for (var k = 0; k < items.length; k++) {
            items[k].classList.toggle('active', items[k].getAttribute('data-basemap') === type);
        }
    }

    // ========================================================================
    // 4. 안내(ⓘ) 팝업 — 해양종합정보와 같은 탭형 팝업
    // ========================================================================

    /**
     * 숨겨진 유의사항 DOM 의 내용을 읽어 온다.
     * 예: _pickHtml('#scuba-disclaimer') → 스킨스쿠버 유의사항 문단들
     * @param {string} selector - 유의사항이 들어 있는 요소 선택자
     * @returns {string} 내용 HTML (없으면 빈 문자열)
     * [연계] ← _buildInfoHtml() — 활동별 안내 본문을 기존 문구 그대로 재사용하기 위함
     */
    function _pickHtml(selector) {
        var el = document.querySelector(selector);
        return el ? el.innerHTML : '';
    }

    /**
     * 안내 팝업 본문(탭바 + 패널)을 만든다.
     * 6개 활동 버튼이 위에 있고, 누르면 그 활동의 유의사항이 아래에 표시된다.
     * @returns {string} 팝업에 넣을 HTML
     * [연계] → index2.html 의 .ocean-info-tabs/.ocean-info-panel CSS 를 그대로 사용
     *          → window.__lsInfoSwitch — 탭 전환
     */
    function _buildInfoHtml() {
        var items = [
            { id: 'fishing', label: '바다낚시', html:
                '<p><strong>갯바위</strong></p>' + _pickHtml('#fishing-disclaimer-gwbr') +
                '<p><strong>선상</strong></p>' + _pickHtml('#fishing-disclaimer-ship') },
            { id: 'surfing',  label: '서핑',       html: _pickHtml('#surfing-disclaimer') },
            { id: 'swimming', label: '해수욕',     html: '<p><i class="fa-solid fa-circle-check"></i> 해수욕 지수는 해수욕장 개장기간에 제공됩니다.</p>' },
            { id: 'scuba',    label: '스킨스쿠버', html: _pickHtml('#scuba-disclaimer') },
            { id: 'mudflat',  label: '갯벌체험',   html: _pickHtml('#mudflat-disclaimer') },
            { id: 'parting',  label: '바다갈라짐', html: _pickHtml('#sp-footer-info .sp-disclaimer') ||
                '<p><i class="fa-solid fa-circle-check"></i> 바다갈라짐 정보를 먼저 열어 보시면 안내 문구가 표시됩니다.</p>' }
        ];

        var tabsHtml = '<div class="ocean-info-tabs">';
        var panelsHtml = '<div class="ocean-info-panels">';
        for (var i = 0; i < items.length; i++) {
            var activeCls = (i === 0) ? ' active' : '';
            tabsHtml += '<button type="button" class="ocean-info-tab-btn' + activeCls +
                        '" data-info-tab="' + items[i].id + '" ' +
                        'onclick="window.__lsInfoSwitch(\'' + items[i].id + '\')">' + items[i].label + '</button>';
            panelsHtml += '<div class="ocean-info-panel' + activeCls + '" data-info-panel="' + items[i].id + '">' +
                          (items[i].html || '<p>준비 중입니다.</p>') + '</div>';
        }
        return tabsHtml + '</div>' + panelsHtml + '</div>';
    }

    /**
     * 안내 팝업 안에서 탭을 바꾼다 (팝업 HTML 의 onclick 에서 호출).
     * @param {string} tabId - 활동 탭 id (예: 'surfing')
     * [연계] ← _buildInfoHtml() 이 심어 둔 onclick
     */
    window.__lsInfoSwitch = function (tabId) {
        var tabs = document.querySelectorAll('.ocean-info-tab-btn');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-info-tab') === tabId);
        }
        var panels = document.querySelectorAll('.ocean-info-panel');
        for (var j = 0; j < panels.length; j++) {
            panels[j].classList.toggle('active', panels[j].getAttribute('data-info-panel') === tabId);
        }
    };

    // ========================================================================
    // 5. 이벤트 바인딩
    // ========================================================================

    /**
     * 새 화면의 버튼들(레일·배경지도·안내·GPS·갯바위/선상)에 클릭 이벤트를 붙인다.
     * 페이지 로드 시 1회만 실행된다.
     * [연계] → _selectActivity(), _applyBasemap(), _buildInfoHtml(),
     *          기존 활동 모듈의 내 위치/갯바위·선상 버튼을 대신 눌러 로직을 재사용
     */
    function _bindControls() {
        // --- 우측 레일: 활동 선택 ([data-act] 가 있는 버튼만 — 갯바위/선상은 아래에서 따로) ---
        var railBtns = document.querySelectorAll('#ls-rail .ls-act-btn[data-act]');
        for (var i = 0; i < railBtns.length; i++) {
            railBtns[i].addEventListener('click', function () {
                var target = this.getAttribute('data-act');
                var gubunWrap = document.getElementById('ls-gubun-wrap');

                // 바다낚시는 이미 켜진 상태에서 다시 누르면 갯바위/선상 팝아웃을 여닫는다
                //  (해양종합정보의 "천기" 버튼과 같은 방식 — 버튼 왼쪽으로 펼쳐짐)
                if (target === 'fishing-section' && _currentAct === 'fishing-section' && gubunWrap) {
                    gubunWrap.classList.toggle('popup-open');
                    return;
                }
                if (gubunWrap) gubunWrap.classList.remove('popup-open');
                _selectActivity(target);
            });
        }

        // --- 좌측 상단: 배경지도 피커 ---
        var bmToggle = document.getElementById('ls-basemap-toggle');
        var bmMenu = document.getElementById('ls-basemap-menu');
        if (bmToggle && bmMenu) {
            bmToggle.addEventListener('click', function (e) {
                e.stopPropagation();
                bmMenu.style.display = bmMenu.style.display === 'none' ? '' : 'none';
            });
            var items = bmMenu.querySelectorAll('.ocean-basemap-item');
            for (var b = 0; b < items.length; b++) {
                items[b].addEventListener('click', function (e) {
                    e.stopPropagation();
                    _applyBasemap(this.getAttribute('data-basemap'));
                    bmMenu.style.display = 'none';
                });
            }
        }

        // --- 좌측 상단: 안내(ⓘ) ---
        var infoBtn = document.getElementById('ls-info-btn');
        if (infoBtn) {
            infoBtn.addEventListener('click', function () {
                if (typeof window.showSeagnalModal === 'function') {
                    window.showSeagnalModal('안내사항', _buildInfoHtml(), 'info');
                }
            });
        }

        // --- 레일 하단: 내 위치 (활동이 원래 갖고 있던 버튼을 대신 누름) ---
        var gpsBtn = document.getElementById('ls-gps-btn');
        if (gpsBtn) {
            gpsBtn.addEventListener('click', function () {
                var act = _findActivity(_currentAct);
                var origin = act && act.gpsBtn && document.getElementById(act.gpsBtn);
                if (origin) origin.click();
            });
        }

        // --- 갯바위/선상 팝아웃 (바다낚시 전용) ---
        var gubunBtns = document.querySelectorAll('#ls-gubun-wrap .ls-gubun-item');
        for (var g = 0; g < gubunBtns.length; g++) {
            gubunBtns[g].addEventListener('click', function (e) {
                e.stopPropagation();
                var gubun = this.getAttribute('data-gubun');
                // 기존 바다낚시 토글 버튼을 대신 눌러 마커 재렌더링 로직을 그대로 사용
                var origin = document.querySelector('.fishing-gubun-btn[data-gubun="' + gubun + '"]');
                if (origin) origin.click();

                var all = document.querySelectorAll('#ls-gubun-wrap .ls-gubun-item');
                for (var k = 0; k < all.length; k++) {
                    all[k].classList.toggle('active', all[k] === this);
                }
                var wrap = document.getElementById('ls-gubun-wrap');
                if (wrap) wrap.classList.remove('popup-open');
            });
        }
    }

    /**
     * 탭 전환 함수를 한 겹 감싸, 전환이 끝날 때마다 새 화면 상태를 다시 맞춘다.
     * (index2_patch.js 가 이미 한 번 감쌌으므로 그 위에 얹는다)
     * [연계] → _syncChrome() — 레일/좌측 컨트롤/지도 동기화
     */
    function _wrapTabSwitchers() {
        var origMain = window.switchMainTab;
        window.switchMainTab = function (targetId) {
            origMain.apply(window, arguments);
            _syncChrome();
        };

        var origSub = window.switchSubTab;
        window.switchSubTab = function (targetId) {
            origSub.apply(window, arguments);
            _syncChrome();
        };
    }

    // ========================================================================
    // 6. 초기화
    // ========================================================================

    document.addEventListener('DOMContentLoaded', function () {
        _bindTrigger();
        _bindControls();
        _wrapTabSwitchers();
    });

})();
