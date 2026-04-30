/**
 * ============================================================================
 * 파일명: js/ocean_warn_active5.js  (5/5 — 클릭 정보박스 + 초기화)
 * 역할 : 부모 zone 클릭 시 어두운 남색 정보 박스 표출, 외부 클릭 자동 close,
 *        모듈 부트스트랩(이벤트 listener 등록 + 버튼 바인딩 polling).
 * ============================================================================
 *
 * [클릭 흐름]
 *   ocean_map.js handleMapClick()
 *     → window.OceanWarnActive.tryHandleClick(map, evt)
 *         ├─ active 모드 아님   → false 반환 (바텀시트로 fallback)
 *         ├─ feature hit X     → false 반환 (바텀시트로 fallback)
 *         ├─ hit 한 zone 이 activeMap 에 없음 → false 반환 (해제된 zone)
 *         └─ activeMap 에 있음 → 박스 표출 + true 반환 (바텀시트 스킵)
 *
 * [박스 닫기]
 *   - X 버튼 click
 *   - document 외부 영역 pointerdown (capture 단계로 등록 → 박스 외 어디든)
 *   - 지도 'movestart' 이벤트 (사용자가 지도 이동/줌 시작)
 * ============================================================================
 */

(function () {
    'use strict';

    var ns = window.OceanWarnActive;
    if (!ns) return;
    var state = ns._state;

    // ────────────────────────────────────────────────────────────────────
    // 시간 문자열 정규화
    // ────────────────────────────────────────────────────────────────────

    /**
     * KMA 가 주는 시각 문자열을 깔끔하게 표시. 우리 데이터는 이미 한국어 포맷
     * (예: "2026년 04월 29일 오후 06시") 이라 거의 그대로 둠. 단 긴 공백·중복 공백 정리.
     */
    function _fmtTime(raw) {
        if (!raw) return '';
        return ('' + raw).replace(/\s+/g, ' ').trim();
    }

    // ────────────────────────────────────────────────────────────────────
    // 클릭 hit 검사
    // ────────────────────────────────────────────────────────────────────

    /**
     * 주어진 픽셀 위치에서 부모 특보구역명 결정.
     *
     * [정책]
     *   - 자식(sub) feature 가 hit 되면 그 자식의 fullName 으로 부모 zone 환원
     *   - 메인(main) feature 가 hit 되면 그 zone 이름 그대로
     *   - 자식이 부모보다 위에 그려지므로 자식이 우선 hit 됨 (자연스러움)
     *
     * @param {ol.Map} map
     * @param {Array<number>} pixel - [x, y]
     * @returns {string|null} - 부모 zoneName
     */
    function _findHitParentZone(map, pixel) {
        var mainLayer = window.OceanWarnZone && window.OceanWarnZone.getMainLayer();
        var subLayer  = window.OceanWarnZone && window.OceanWarnZone.getSubLayer();
        if (!mainLayer && !subLayer) return null;

        var found = null;
        map.forEachFeatureAtPixel(pixel, function (feature, layer) {
            if (found) return; // 첫 hit 사용
            if (layer === subLayer) {
                var fullName = window.OceanWarnZone.getSubFullName(feature);
                var parent = ns._resolveParentByFullName(fullName);
                if (parent) found = parent;
            } else if (layer === mainLayer) {
                var name = window.OceanWarnZone.getMainZoneName(feature);
                if (name) found = name;
            }
        }, {
            layerFilter: function (l) { return l === mainLayer || l === subLayer; },
            hitTolerance: 2
        });

        return found;
    }

    // ────────────────────────────────────────────────────────────────────
    // 박스 DOM 빌드
    // ────────────────────────────────────────────────────────────────────

    /**
     * 한 알림(alertItem) 을 박스 한 블록으로 렌더링.
     *
     * [표시 라인]
     *   - 종류·등급 (예: "풍랑경보" / "태풍주의보(발효 예정)")
     *   - 발표 (tmFc)         — 값 있을 때만
     *   - 발효 / 발효 예정    — 값 있을 때만 (upcoming 이면 "발효 예정")
     *   - 해제 (tmCc)         — 값 있을 때만
     *   - 격상/격하           — command='변경' + prevLevel 있을 때만
     *
     * @param {Object} a       - alertItem
     * @param {boolean} isUpcoming - true 면 "발효 예정" 라벨 사용
     */
    function _renderAlertBlock(a, isUpcoming) {
        var lines = [];
        var typeText = (a.warnType || '') + (a.level || '');
        if (isUpcoming) typeText += ' (발효 예정)';
        lines.push('<div class="warn-active-line warn-active-type">• ' + _esc(typeText) + '</div>');

        if (a.tmFc) {
            lines.push('<div class="warn-active-line"><span class="warn-active-key">발표</span>'
                + '<span class="warn-active-val">' + _esc(_fmtTime(a.tmFc)) + '</span></div>');
        }
        if (a.tmEf) {
            var efLabel = isUpcoming ? '발효 예정' : '발효';
            lines.push('<div class="warn-active-line"><span class="warn-active-key">' + efLabel + '</span>'
                + '<span class="warn-active-val">' + _esc(_fmtTime(a.tmEf)) + '</span></div>');
        }
        if (a.tmCc) {
            lines.push('<div class="warn-active-line"><span class="warn-active-key">해제</span>'
                + '<span class="warn-active-val">' + _esc(_fmtTime(a.tmCc)) + '</span></div>');
        }
        // 격상/격하 — data.js 에서 command='변경' + prevLevel 채워줌
        if (a.command === '변경' && a.prevLevel) {
            // 이전 등급 → 현재 등급 (예: "주의보 → 경보")
            var arrow = a.prevLevel + ' → ' + (a.level || '');
            lines.push('<div class="warn-active-line"><span class="warn-active-key">격상/격하</span>'
                + '<span class="warn-active-val">' + _esc(arrow) + '</span></div>');
        }
        return lines.join('');
    }

    /**
     * HTML 안전 escape — zone 이름·시각 문자열에 < > & 가 들어와도 안전하게 표시.
     */
    function _esc(s) {
        return ('' + (s || ''))
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * 정보 박스를 만들어 화면에 띄움.
     *
     * [위치 선정]
     *   기본: 클릭한 픽셀의 약간 아래·우측에 박스 좌상단을 둠
     *   화면 우측/하단을 넘어가면 자동으로 반대쪽으로 뒤집기
     *
     * @param {string} parentZone
     * @param {Array<number>} pixel - [x, y]
     */
    ns._showBox = function (parentZone, pixel) {
        ns._hideBox(); // 기존 박스 있으면 먼저 닫기

        var info = state.activeMap[parentZone];
        if (!info) return;

        // 박스 콘텐츠 빌드
        var html = ''
            + '<div class="warn-active-box-header">'
            +   '<span class="warn-active-box-title">' + _esc(parentZone) + '</span>'
            +   '<button type="button" class="warn-active-box-close" aria-label="닫기">&times;</button>'
            + '</div>'
            + '<div class="warn-active-box-body">';

        var hasCurrent = info.allCurrents.length > 0;
        var hasUpcoming = info.allUpcomings.length > 0;

        if (hasCurrent) {
            html += '<div class="warn-active-section">';
            html += '  <div class="warn-active-section-title">현재 발효 중</div>';
            for (var i = 0; i < info.allCurrents.length; i++) {
                html += '<div class="warn-active-item">' + _renderAlertBlock(info.allCurrents[i], false) + '</div>';
            }
            html += '</div>';
        }
        if (hasUpcoming) {
            html += '<div class="warn-active-section warn-active-section-upcoming">';
            html += '  <div class="warn-active-section-title">다가오는 특보</div>';
            for (var j = 0; j < info.allUpcomings.length; j++) {
                html += '<div class="warn-active-item">' + _renderAlertBlock(info.allUpcomings[j], true) + '</div>';
            }
            html += '</div>';
        }
        html += '</div>'; // box-body

        // 박스 컨테이너
        var box = document.createElement('div');
        box.className = 'warn-active-box';
        box.innerHTML = html;
        document.body.appendChild(box);

        // 위치 조정 — 클릭 픽셀 아래·우측 (지도 컨테이너 기준 → 화면 절대 좌표 변환)
        var mapEl = document.getElementById('ocean-map');
        var rect = mapEl ? mapEl.getBoundingClientRect() : { left: 0, top: 0 };
        var px = (pixel && pixel[0] != null) ? pixel[0] : 0;
        var py = (pixel && pixel[1] != null) ? pixel[1] : 0;
        var pageX = rect.left + px;
        var pageY = rect.top + py;

        // 박스 크기 측정
        var bw = box.offsetWidth;
        var bh = box.offsetHeight;
        var vw = window.innerWidth;
        var vh = window.innerHeight;

        // 기본: 클릭 위치 우측 12px, 아래 12px
        var left = pageX + 12;
        var top  = pageY + 12;
        if (left + bw + 12 > vw) left = pageX - bw - 12; // 우측 침범 시 좌측으로
        if (top + bh + 12 > vh)  top  = pageY - bh - 12; // 하단 침범 시 위로
        if (left < 8) left = 8;
        if (top < 8)  top  = 8;

        box.style.left = left + 'px';
        box.style.top  = top + 'px';

        // 닫기 버튼
        var closeBtn = box.querySelector('.warn-active-box-close');
        if (closeBtn) closeBtn.addEventListener('click', ns._hideBox);

        state.box = box;
        _bindOutsideClose();
    };

    /**
     * 박스 닫기 — DOM 제거 + outside listener 해제.
     */
    ns._hideBox = function () {
        if (state.box && state.box.parentNode) {
            state.box.parentNode.removeChild(state.box);
        }
        state.box = null;
        _unbindOutsideClose();
    };

    /**
     * document 의 capture-phase pointerdown 으로 박스 외부 클릭 감지.
     * 박스 내부 클릭은 contains 검사로 무시.
     */
    function _bindOutsideClose() {
        if (state.boxOutsideHandler) return; // 중복 방지
        state.boxOutsideHandler = function (e) {
            if (!state.box) return;
            if (state.box.contains(e.target)) return; // 박스 안 클릭은 유지
            ns._hideBox();
        };
        document.addEventListener('pointerdown', state.boxOutsideHandler, true);
    }
    function _unbindOutsideClose() {
        if (!state.boxOutsideHandler) return;
        document.removeEventListener('pointerdown', state.boxOutsideHandler, true);
        state.boxOutsideHandler = null;
    }

    // ────────────────────────────────────────────────────────────────────
    // 외부 공개 API — 지도 클릭 가드 (ocean_map.js handleMapClick 호출)
    // ────────────────────────────────────────────────────────────────────

    /**
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true → 이 모듈이 처리함 (바텀시트 스킵).
     *                   false → 처리 안 함 (바텀시트 흐름 계속).
     */
    ns.tryHandleClick = function (map, evt) {
        // active 모드 아닐 때는 절대 처리 안 함 → 기존 바텀시트 흐름 유지
        if (!state.active) return false;
        if (!evt || !evt.pixel) return false;

        var parentZone = _findHitParentZone(map, evt.pixel);
        if (!parentZone) return false;

        // activeMap 에 없으면 = 해제됐거나 처음부터 특보 없음 → 박스 표출 안 함
        // (요구사항: 해당 특보 구역을 클릭해도 정보가 아무것도 없으면 박스 X)
        var info = state.activeMap[parentZone];
        if (!info) return false;

        // 박스 표시 — true 반환하여 바텀시트 호출 차단
        ns._showBox(parentZone, evt.pixel);
        return true;
    };

    /**
     * 지도 외부에서 호출 가능한 강제 새로고침 — 향후 디버깅·관리자 모드용.
     */
    ns.refresh = function () {
        ns._buildActiveMap();
        ns._renderButton();
        if (state.active && window.OceanWarnZone) {
            window.OceanWarnZone.refresh();
        }
    };

    /** 현재 색칠 모드인지 외부에서 조회 */
    ns.isActive = function () { return !!state.active; };

    // ────────────────────────────────────────────────────────────────────
    // 부트스트랩 — 이벤트 listener 등록 + 버튼/지도 준비될 때까지 polling
    // ────────────────────────────────────────────────────────────────────

    /**
     * 'seagnal:alerts-changed' 핸들러 — 특보 데이터가 갱신되면:
     *   1) activeMap 다시 만들고
     *   2) 버튼 표시 갱신 (특보 없음 → ON 가능 / 다시 특보 없음 등 자동 전환)
     *   3) 활성 모드면 layer 다시 그리기
     *   4) 활성 모드 도중 특보가 모두 사라졌으면 자동 _deactivate
     */
    function _onAlertsChanged() {
        ns._buildActiveMap();
        // 활성 도중 색칠 가능 항목이 0 이 되면 자동 OFF
        if (state.active && !ns._hasAnyColorableActive()) {
            ns._deactivate();
            return;
        }
        ns._renderButton();
        if (state.active && window.OceanWarnZone) {
            window.OceanWarnZone.refresh();
        }
        // 박스가 떠 있다면 닫음 — 이전 시점 데이터일 수 있어 안전하게 닫기
        if (state.box) ns._hideBox();
    }

    /**
     * 지도 'movestart' 발생 시 박스 자동 닫기 (사용자가 화면 이동/줌 시작).
     */
    function _bindMapClose(map) {
        if (!map) return;
        map.on('movestart', function () { if (state.box) ns._hideBox(); });
    }

    /**
     * 부트 — DOM/지도/특보구역 모듈 모두 준비될 때까지 폴링하다 한 번 초기화.
     *
     * [준비 조건]
     *   1) #ocean-warn-active-toggle-btn DOM 존재 (5.html 추가 후)
     *   2) window.OceanWarnZone 객체 (ocean_warn_zone.js 로드)
     *   3) window.getOceanMap() 가 OL Map 반환 (ocean_map.js 초기화 완료)
     */
    function _bootWhenReady() {
        var attempts = 0;
        var TIMER_MS = 250;

        function tick() {
            attempts++;
            var btnReady = !!document.getElementById('ocean-warn-active-toggle-btn');
            var zoneReady = !!window.OceanWarnZone;
            var map = (typeof window.getOceanMap === 'function') ? window.getOceanMap() : null;
            var mapReady = !!map;

            if (btnReady && zoneReady && mapReady) {
                _initialize(map);
                return;
            }
            // 무기한 polling — ocean_warn_zone.js 와 동일 패턴 (시간 제한 없음)
            setTimeout(tick, TIMER_MS);
        }
        tick();
    }

    function _initialize(map) {
        // 1) 활성 맵 1차 빌드 (이미 데이터 있을 수 있음)
        ns._buildActiveMap();

        // 2) 버튼 바인딩 + 첫 표시
        if (typeof ns._bindButton === 'function') ns._bindButton();
        ns._renderButton();

        // 3) 'seagnal:alerts-changed' listener 등록
        window.addEventListener('seagnal:alerts-changed', _onAlertsChanged);

        // 4) 지도 movestart 시 박스 닫기
        _bindMapClose(map);

        ns._log('initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bootWhenReady);
    } else {
        _bootWhenReady();
    }
})();
