/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/navigational_warning.js
 * 역할  : 해양안전 지도에 "항행경보" 토글 버튼을 얹어, 선택한 날짜에 발효 중인 항행경보
 *         (선박사고·표류장애물·수중장애물·해상사격훈련 등)의 구역을 원형/다각형
 *         으로 표시한다. 날짜 내비게이션(◀▶)으로 다른 날짜를 조회하고, 기준 시각
 *         슬라이더로 그 날짜의 특정 시각에 어떤 구역이 살아있는지 확인할 수 있다
 *         (시각이 지난 구역은 회색으로 바뀌고 라벨도 사라진다 — 활성 구역만 라벨을
 *         단다). 같은 구역이 시간대만 다르게 여러 번 나오면 서버가 하나로 합쳐 주므로,
 *         구역을 탭하면 그 안의 각 시간대(occurrence)를 구분해서 보여준다(이미 끝난
 *         시간대는 흐리게 + "종료" 표시). 줌 제한 없이 항상 라벨을 그리되, 화면에
 *         여럿이 겹치면 큰 구역을 우선해(renderOrder) OpenLayers declutter가 정리한다.
 *         구역이 화면에서 작게 보일 때 탭하면 팝업 대신 그 구역으로 먼저 확대하고,
 *         충분히 커진 뒤 다시 탭해야 팝업이 뜬다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.getOceanMap·oceanGetBasemap·oceanSetBasemap),
 *                    shared/ui/ui_modal.js(window.showSeagnalModal), OpenLayers(ol.*)
 *  - 서버 API      : GET /api/navigational-warning/list?date=YYYYMMDD (날짜별 30분 캐시 —
 *                    텍스트는 공식 data.go.kr API, 좌표는 KHOA 내부 API 보강, 같은 구역명은
 *                    서버가 미리 병합, local_server/routes/navigational_warning.js)
 *  - 마크업        : index2.html #ocean-navwarn-btn(토글 버튼) ·
 *                    #navwarn-date-nav/#navwarn-prev-day/#navwarn-next-day/
 *                    #navwarn-date-label/#navwarn-date-tag(날짜 내비게이션) ·
 *                    #navwarn-time-bar/#navwarn-time-slider/#navwarn-time-value(시간 슬라이더) ·
 *                    #navwarn-loading(로딩 스피너) — 전부 해양안전 전용
 *  - 나를 쓰는 곳  : 토글 버튼은 이 파일이 자체 바인딩(seaway.js 와 동일 패턴).
 *                    구역 클릭은 ocean_map.js의 handleMapClick 이
 *                    window._navwarnTryHandleClick(map, evt) 를 호출(seaway.js 다음 순위)
 * [로드 순서] seaway.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * ============================================================================
 */

(function () {
    'use strict';

    var LIST_URL = '/api/navigational-warning/list';
    var NM_TO_M = 1852;          // 1해리(nautical mile) = 1852m — RADIUS(해리) → OpenLayers Circle 반경(m) 환산
    var MIN_TAPPABLE_PX = 90;    // 이보다 화면상 작게 보이는 구역은 탭해도 팝업 대신 확대만 한다(fishing_ban.js 와 동일 기준)
    var FIT_MAX_ZOOM = 18;       // 아주 작은 구역이 과확대되는 걸 막는 상한
    var WEEKDAY_KR = ['일', '월', '화', '수', '목', '금', '토'];

    var _layer = null;       // 외곽선 layer (라벨도 여기 붙음, declutter 적용)
    var _fillLayer = null;   // 채움 layer
    var _source = null;
    var _visible = false;
    var _loading = false;
    var _loadedDate = null;  // 현재 _source 에 채워진 데이터의 날짜(YYYY-MM-DD) — 날짜 전환 시 재조회 판단용

    var _selectedDate = _todayIso(); // 조회 중인 날짜(YYYY-MM-DD)
    var _refMinutes = _nowMinutes(); // 기준 시각(하루 중 분, 0~1439) — 날짜 이동 시 _bindDateNav._go()가 리셋(오늘=현재시각, 그 외=00:00)

    function _pad2(n) { return n < 10 ? '0' + n : String(n); }
    function _toIso(d) { return d.getFullYear() + '-' + _pad2(d.getMonth() + 1) + '-' + _pad2(d.getDate()); }
    function _todayIso() { return _toIso(new Date()); }
    function _nowMinutes() { var d = new Date(); return d.getHours() * 60 + Math.round(d.getMinutes() / 15) * 15; }
    function _addDaysIso(iso, delta) {
        var d = new Date(iso + 'T00:00:00');
        d.setDate(d.getDate() + delta);
        return _toIso(d);
    }
    function _formatDateLabel(iso) {
        var d = new Date(iso + 'T00:00:00');
        return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WEEKDAY_KR[d.getDay()] + ')';
    }
    function _fmtMin(min) { return _pad2(Math.floor(min / 60)) + ':' + _pad2(min % 60); }

    /** 선택한 날짜(_selectedDate) 기준으로 이 시간창 배열이 만료됐는지 — 시간창 자체가
     *  아예 없으면(데이터 없음) 만료로 보지 않는다(과다 숨김 방지). 하지만 시간창은
     *  있는데 선택한 날짜엔 해당하는 게 하나도 없다면(예: 8/15~16만 예정인데 8/14를
     *  보는 중) 그 날짜엔 활동이 없는 것이므로 만료(회색)로 본다.
     *  zone(병합됨, 전체 occurrence 합집합)과 occurrence(개별) 양쪽에 다 쓴다. */
    function _isWindowsExpired(windows) {
        if (!windows || !windows.length) return false;
        var matching = windows.filter(function (w) { return w.date === _selectedDate; });
        if (!matching.length) return true;
        var latestEnd = Math.max.apply(null, matching.map(function (w) { return w.end; }));
        return _refMinutes > latestEnd;
    }
    function _isExpired(zone) { return _isWindowsExpired(zone.windows); }

    /** 선택한 날짜에 해당하는 시간창을 "00:00~08:00" 형태로 짧게 합친 문자열(라벨용).
     *  같은 구역에 여러 occurrence(시간대)가 있으면 그만큼 여러 조각이 함께 나온다. */
    function _todayTimeLabel(zone) {
        var windows = (zone.windows || []).filter(function (w) { return w.date === _selectedDate; });
        if (!windows.length) return '';
        return windows.map(function (w) { return _fmtMin(w.start) + '~' + _fmtMin(w.end); }).join(', ');
    }

    /** zone.occurrences 에서 구분(noti_cat/app_cat) 값을 모아 중복 없이 합친 라벨 문자열 */
    function _categoryLabel(zone) {
        var seen = {};
        var cats = [];
        (zone.occurrences || []).forEach(function (occ) {
            var c = (occ.noti_cat || occ.app_cat || '').trim();
            if (c && !seen[c]) { seen[c] = true; cats.push(c); }
        });
        return cats.join('·');
    }

    /** 항행경보 구역 스타일 — 경고 의미의 진한 빨강(활성) / 회색(선택 날짜·시각 기준 만료).
     *  만료된 구역은 라벨을 아예 그리지 않는다(줌아웃 상태에서 활성 구역만 눈에 띄게).
     *  줌 제한 없이 항상 라벨을 시도하고, 화면에 여럿이 겹치면 declutter + renderOrder
     *  (큰 구역 우선, _boxArea 참고)가 어떤 라벨을 남길지 정리한다. */
    function _zoneStyle(feature) {
        var zone = feature.get('zone');
        var expired = _isExpired(zone);

        var strokeColor = expired ? 'rgba(148, 163, 184, 0.75)' : 'rgba(185, 28, 28, 0.95)';
        var fillColor = expired ? 'rgba(148, 163, 184, 0.10)' : 'rgba(185, 28, 28, 0.22)';

        var text = null;
        if (!expired) {
            var label = [_categoryLabel(zone), _todayTimeLabel(zone)].filter(Boolean).join('\n');
            if (label) {
                text = new ol.style.Text({
                    text: label,
                    font: '700 12px Pretendard, sans-serif',
                    fill: new ol.style.Fill({ color: '#fff' }),
                    stroke: new ol.style.Stroke({ color: 'rgba(15, 23, 42, 0.85)', width: 3 }),
                    overflow: true,
                    declutterMode: 'declutter'
                });
            }
        }

        return new ol.style.Style({
            stroke: new ol.style.Stroke({ color: strokeColor, width: 2, lineDash: [6, 4] }),
            fill: new ol.style.Fill({ color: fillColor }),
            text: text
        });
    }
    function _fillOnlyStyle(feature) {
        var s = _zoneStyle(feature);
        return new ol.style.Style({ fill: s.getFill() });
    }
    function _strokeOnlyStyle(feature) {
        var s = _zoneStyle(feature);
        return new ol.style.Style({ stroke: s.getStroke(), text: s.getText() });
    }

    /** feature 지오메트리의 화면 바운딩박스 면적(㎡, EPSG:3857 좌표계 기준) —
     *  Polygon/Circle 양쪽에 동일하게 쓸 수 있는 "구역 크기" 근사치.
     *  renderOrder 에서 큰 구역이 먼저 그려지게 해, declutter가 라벨을 지울 때
     *  작은 구역보다 큰 구역의 라벨을 우선 남기도록 한다(사용자 요청 — 큰 구역 우선). */
    function _boxArea(feature) {
        var ext = feature.getGeometry() && feature.getGeometry().getExtent();
        if (!ext) return 0;
        return (ext[2] - ext[0]) * (ext[3] - ext[1]);
    }
    function _bySizeDesc(f1, f2) { return _boxArea(f2) - _boxArea(f1); }

    function _ensureLayers(map) {
        if (!_source) _source = new ol.source.Vector();

        if (!_fillLayer) {
            _fillLayer = new ol.layer.Vector({
                source: _source,
                style: _fillOnlyStyle,
                zIndex: 43,
                visible: _visible,
                renderOrder: _bySizeDesc,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_fillLayer);
        }
        if (!_layer) {
            _layer = new ol.layer.Vector({
                source: _source,
                style: _strokeOnlyStyle,
                zIndex: 83,
                visible: _visible,
                declutter: true, // 인접한 구역의 라벨이 겹치면 자동으로 덜 중요한 쪽을 숨긴다
                renderOrder: _bySizeDesc, // declutter가 라벨을 고를 때 큰 구역을 먼저 배치 → 우선권
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_layer);
        }
    }

    /** 슬라이더/날짜 변경 후 스타일만 다시 계산하도록 두 레이어를 다시 그린다(재조회 없음) */
    function _restyle() {
        if (_fillLayer) _fillLayer.changed();
        if (_layer) _layer.changed();
    }

    /** 서버가 준 zone(원형/다각형 위경도, 같은 구역명은 이미 병합돼 옴)을 OpenLayers
     *  feature로 변환한다. 점이 부족해 그릴 수 없는 zone은 건너뛴다(그런 항목도 있음). */
    function _buildFeatures(zones) {
        var features = [];
        zones.forEach(function (zone) {
            var geom = null;
            if (zone.type === 'circle' && zone.points.length >= 1 && zone.radiusNm) {
                var center = ol.proj.fromLonLat([zone.points[0].lon, zone.points[0].lat]);
                geom = new ol.geom.Circle(center, zone.radiusNm * NM_TO_M);
            } else if (zone.points.length >= 3) {
                var ring = zone.points.map(function (p) { return ol.proj.fromLonLat([p.lon, p.lat]); });
                ring.push(ring[0]);
                geom = new ol.geom.Polygon([ring]);
            }
            if (!geom) return;

            var feature = new ol.Feature({ geometry: geom });
            feature.set('zone', zone);
            features.push(feature);
        });
        return features;
    }

    function _setLoading(loading) {
        var el = document.getElementById('navwarn-loading');
        if (!el) return;
        el.style.display = loading ? 'flex' : 'none';
        el.setAttribute('aria-hidden', loading ? 'false' : 'true');
    }

    /** 선택한 날짜(_selectedDate)의 목록을 받아 지도를 다시 그린다. 이미 그 날짜가
     *  로드돼 있으면 재조회하지 않는다(토글을 껐다 켜기만 한 경우). KHOA 세션 발급이
     *  섞이면 몇 초 걸릴 수 있어 로딩 스피너를 띄운다. */
    function _load() {
        if (_loadedDate === _selectedDate || _loading) return;
        _loading = true;
        _setLoading(true);
        var ymd = _selectedDate.replace(/-/g, '');
        fetch(LIST_URL + '?date=' + ymd)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                _loading = false;
                _setLoading(false);
                if (!data.success || !_source) return;
                _source.clear();
                _source.addFeatures(_buildFeatures(data.zones || []));
                _loadedDate = _selectedDate;
            })
            .catch(function (err) {
                _loading = false;
                _setLoading(false);
                console.warn('[NavWarn] 목록 로드 실패:', err.message);
            });
    }

    /** "라벨/값" 2열 grid의 한 행 — 값이 없으면 그 행 자체를 만들지 않는다.
     *  (CSS 는 출입통제/항로 팝업과 같은 .ac-detail-* 을 그대로 재사용) */
    function _row(label, value) {
        if (!value) return '';
        return '<span class="ac-detail-label">' + label + '</span><span class="ac-detail-value">' + value + '</span>';
    }

    /** 본문(content)을 줄 단위로 나눠 문단을 만든다. "*"로 시작하는 줄(참고 링크 등
     *  각주성 문구)은 위쪽 여백을 넉넉히 줘 본문과 시각적으로 구분한다. */
    function _formatContent(content) {
        var lines = content.replace(/\r\n|\r/g, '\n').split('\n');
        var html = '';
        lines.forEach(function (line) {
            var trimmed = line.trim();
            if (!trimmed) return;
            var isNote = trimmed.charAt(0) === '*';
            var style = 'font-size:0.88rem;line-height:1.65;text-align:left;' +
                (isNote ? 'margin:14px 0 0;color:#9fb4cc;font-size:0.82rem;' : 'margin:0 0 8px;color:#e4eaf3;');
            html += '<p style="' + style + '">' + trimmed + '</p>';
        });
        return html;
    }

    /** occurrence(같은 구역의 시간대 한 건) 하나의 상세 블록 HTML — 선택한 날짜·시각
     *  기준으로 이미 끝난 occurrence는 흐리게(opacity) + "종료" 표시를 붙인다. */
    function _buildOccurrenceHtml(occ) {
        var expired = _isWindowsExpired(occ.windows);
        var cat = occ.noti_cat || occ.app_cat || '';
        var rows = '';
        rows += _row('구분', cat);
        rows += _row('발표기관', occ.gov_cd);
        rows += _row('유효기간', occ.validity);
        rows += _row('근거', occ.basic);

        var titleText = (occ.title || '') + (expired ? ' <span style="color:#f87171;font-weight:800;">· 종료</span>' : '');
        var html = '<p style="margin:0 0 6px;color:#fff;font-weight:700;font-size:0.92rem;text-align:left;">' + titleText + '</p>';
        html += rows ? '<div class="ac-detail-grid">' + rows + '</div>' : '';
        if (occ.content) html += _formatContent(occ.content);
        return expired ? '<div style="opacity:0.55;">' + html + '</div>' : html;
    }

    /** 구역 feature 하나의 상세 정보 팝업 HTML — occurrences(시간대)별로 구분해 보여준다 */
    function _buildDetailHtml(feature) {
        var zone = feature.get('zone');
        var occs = zone.occurrences || [];
        if (!occs.length) return '<p>세부 정보를 불러오지 못했습니다.</p>';

        return occs.map(function (occ, i) {
            var block = _buildOccurrenceHtml(occ);
            return i === 0 ? block : '<div style="margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.12);">' + block + '</div>';
        }).join('');
    }

    /**
     * [외부 API] 지도 클릭이 항행경보 구역(폴리곤 또는 그 라벨)을 눌렀는지 확인한다.
     * 구역이 화면에서 얼마나 크게 보이는지에 따라 두 갈래로 나뉜다(fishing_ban.js /
     * seaway.js 와 동일 패턴) — 예1: 줌아웃 상태에서 작게 보이는 구역을 탭하면 팝업 없이
     * 그 구역 범위로 지도를 확대하고 끝(커진 뒤 다시 탭하면 팝업). 예2: 이미 충분히 크게
     * 보일 때 탭하면 바로 상세 팝업.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 바텀시트 등을 건너뛰어야 함 —
     *                    확대만 한 경우도 true라 바텀시트가 같이 뜨지 않는다)
     * [연계] ← ocean_map.js handleMapClick — 항로 다음 순위로 호출.
     */
    window._navwarnTryHandleClick = function (map, evt) {
        if (!_visible || !_fillLayer) return false;
        var hit = map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer === _fillLayer) return feature;
            // 줌아웃 상태에선 폴리곤이 몇 px 밖에 안 돼 채움만으로는 잘 안 잡힌다 —
            // 외곽선+라벨 레이어에서도 보조 판정한다.
            if (layer === _layer) return feature;
            return null;
        }, { hitTolerance: 5 }); // 작은 구역은 손가락으로 정확히 누르기 어렵다
        if (!hit) return false;

        var extent = hit.getGeometry() && hit.getGeometry().getExtent();
        var resolution = map.getView().getResolution();
        if (extent && resolution) {
            var widthPx = (extent[2] - extent[0]) / resolution;
            var heightPx = (extent[3] - extent[1]) / resolution;
            if (widthPx < MIN_TAPPABLE_PX && heightPx < MIN_TAPPABLE_PX) {
                var vworldMaxZoom = window.oceanCreateVworldLayer && window.oceanCreateVworldLayer.maxZoom;
                map.getView().fit(extent, {
                    padding: [80, 80, 80, 80],
                    duration: 400,
                    maxZoom: vworldMaxZoom || FIT_MAX_ZOOM
                });
                return true; // 확대만 하고 팝업은 띄우지 않는다(클릭은 소비)
            }
        }

        var zone = hit.get('zone');
        if (window.trackUsage) window.trackUsage('safety.navwarn.zone');  // [사용량] 구역 눌러 정보를 볼 때 1건
        if (typeof window.showSeagnalModal === 'function') {
            window.showSeagnalModal(zone.name || '항행경보', _buildDetailHtml(hit), 'info');
            var modalContent = document.querySelector('#seagnal-custom-modal .seagnal-modal-content');
            if (modalContent) modalContent.classList.add('access-control-wide', 'navwarn-detail-scroll');
        } else if (typeof window._showOceanToast === 'function') {
            window._showOceanToast(zone.name || '항행경보', 'bottom', 3000);
        }
        return true;
    };

    /** 날짜 내비게이션 라벨/뱃지를 현재 _selectedDate 기준으로 갱신 */
    function _updateDateNavUI() {
        var label = document.getElementById('navwarn-date-label');
        var tag = document.getElementById('navwarn-date-tag');
        if (label) label.textContent = _formatDateLabel(_selectedDate);
        if (!tag) return;
        var today = _todayIso();
        if (_selectedDate === today) {
            tag.textContent = '오늘';
            tag.classList.remove('other');
        } else {
            tag.textContent = _selectedDate < today ? '지난 날짜' : '예정';
            tag.classList.add('other');
        }
    }

    function _bindDateNav() {
        var prevBtn = document.getElementById('navwarn-prev-day');
        var nextBtn = document.getElementById('navwarn-next-day');
        var slider = document.getElementById('navwarn-time-slider');
        var valueEl = document.getElementById('navwarn-time-value');
        // 날짜를 이동하면 기준 시각을 그 날짜에 맞게 리셋한다 — 오늘이면 현재 시각,
        // 오늘이 아니면(과거/미래) 00:00부터. 리셋 후에는 사용자가 슬라이더로 자유롭게
        // 움직일 수 있다(사용자 요청, 이전의 "날짜 넘겨도 슬라이더 유지" 방침 대체).
        function _go(delta) {
            _selectedDate = _addDaysIso(_selectedDate, delta);
            _refMinutes = (_selectedDate === _todayIso()) ? _nowMinutes() : 0;
            if (slider) slider.value = String(_refMinutes);
            if (valueEl) valueEl.textContent = _fmtMin(_refMinutes);
            _updateDateNavUI();
            _load();
            _restyle();
        }
        // [사용량] 사용자가 ◀▶ 로 날짜를 넘길 때마다 1건(사용자 확정 2026-09-10)
        if (prevBtn) prevBtn.addEventListener('click', function () { if (window.trackUsage) window.trackUsage('safety.navwarn.date'); _go(-1); });
        if (nextBtn) nextBtn.addEventListener('click', function () { if (window.trackUsage) window.trackUsage('safety.navwarn.date'); _go(1); });
    }

    function _bindTimeSlider() {
        var slider = document.getElementById('navwarn-time-slider');
        var valueEl = document.getElementById('navwarn-time-value');
        if (!slider) return;
        slider.addEventListener('input', function () {
            _refMinutes = parseInt(slider.value, 10) || 0;
            if (valueEl) valueEl.textContent = _fmtMin(_refMinutes);
            _restyle();
        });
    }

    function _setBarsVisible(visible) {
        var dateNav = document.getElementById('navwarn-date-nav');
        var timeBar = document.getElementById('navwarn-time-bar');
        [dateNav, timeBar].forEach(function (el) {
            if (!el) return;
            el.style.display = visible ? 'flex' : 'none';
            el.setAttribute('aria-hidden', visible ? 'false' : 'true');
        });
        if (!visible) _setLoading(false);
    }

    function _bindToggle(map) {
        var btn = document.getElementById('ocean-navwarn-btn');
        if (!btn) return;

        var slider = document.getElementById('navwarn-time-slider');
        var valueEl = document.getElementById('navwarn-time-value');

        var _prevBasemap = null; // OFF 시 원래 배경지도로 되돌리기 위해 ON 시점 값을 기억

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer) _layer.setVisible(_visible);
            if (_fillLayer) _fillLayer.setVisible(_visible);
            _setBarsVisible(_visible);
            if (_visible) {
                if (window.trackUsage) window.trackUsage('safety.navwarn');  // [사용량] 켤 때만 1건
                _updateDateNavUI();
                if (slider) slider.value = String(_refMinutes);
                if (valueEl) valueEl.textContent = _fmtMin(_refMinutes);
                _load();
                // 실제 지형과 비교하기 쉽도록 배경지도를 위성지도로 자동 전환한다
                // (출입통제·낚시금지와 동일 패턴).
                if (typeof window.oceanGetBasemap === 'function' && typeof window.oceanSetBasemap === 'function') {
                    _prevBasemap = window.oceanGetBasemap();
                    if (_prevBasemap !== 'vworld') window.oceanSetBasemap('vworld');
                }
            } else if (_prevBasemap && _prevBasemap !== 'vworld' && typeof window.oceanSetBasemap === 'function') {
                window.oceanSetBasemap(_prevBasemap);
                _prevBasemap = null;
            }
        });
    }

    /** oceanMap 이 만들어질 때까지 폴링 (seaway.js 와 동일 패턴) */
    function _installWhenReady() {
        function _try() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map) {
                _ensureLayers(map);
                _bindToggle(map);
                _bindDateNav();
                _bindTimeSlider();
                return;
            }
            setTimeout(_try, 250);
        }
        _try();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _installWhenReady);
    } else {
        _installWhenReady();
    }
})();
