/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/access_control.js
 * 역할  : 해양안전 지도에 "출입통제" 토글 버튼을 얹어, 연안사고 예방에 관한
 *         법률 제10조에 따라 각 해양경찰서가 지정한 출입통제구역 폴리곤을
 *         표시한다. 폴리곤을 탭하면 관할서·구역명·상태를 토스트로 보여준다.
 *         구역 라벨은 OL 스타일이 아니라 별도 캔버스 오버레이(_labelCanvas)에
 *         그려, 좁은 지역에 여러 구역이 몰려 라벨이 겹치면 이번 줌 레벨에서는
 *         그 라벨을 그냥 건너뛴다(점 등 다른 표시도 없음) — 확대해서 겹침이
 *         풀리면 자동으로 나타난다. 지도가 패닝/줌 되는 동안에도 OL 의
 *         'postrender' 이벤트에 맞물려 매 프레임 다시 그려 라벨이 지도와 같이
 *         움직인다(라벨 텍스트 자체를 클릭해도 그 구역 팝업이 뜬다).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : ocean-map/map/ocean_map.js(window.getOceanMap·oceanGetBasemap·oceanSetBasemap), OpenLayers(ol.*)
 *  - 서버 API      : 없음 — /access_control_zones.json 정적 파일(지연 로드)
 *  - 마크업        : index2.html #ocean-access-control-toggle-btn — 해양안전 전용
 *  - 나를 쓰는 곳  : 토글 버튼은 이 파일이 자체 바인딩(ocean_warn_zone.js 와 동일 패턴).
 *                    폴리곤 클릭은 ocean_map.js의 handleMapClick 이
 *                    window._accessControlTryHandleClick(map, evt) 를 호출
 *                    (hazard_rocks.js 의 _hazardRocksTryHandleClick 과 동일 패턴 —
 *                    이래야 해양종합정보 바텀시트가 같은 클릭에 같이 뜨는 걸 막는다)
 * [로드 순서] ocean_map.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * [데이터 출처] 각 해양경찰서 홈페이지 고시.공고 게시판에서 직접 수집한 원문 PDF/HWP의
 *              경위도 좌표를 전사(자세한 출처·검증 이력은
 *              local_server/knowledge/legal/raw/02_해양경비구조/연안사고예방에관한법률/
 *              행정규칙/_원본첨부/_MANIFEST.md 참고). 폴리곤 전체가 좌표만으로 완결되는
 *              (해안선에 의존하지 않는) 구역만 우선 반영 — 나머지는 원본 이미지에
 *              손그림 경계선만 있어 후속 작업 필요.
 * ============================================================================
 */

(function () {
    'use strict';

    var DATA_URL = '/access_control_zones.json';

    var _layer = null;       // 외곽선 layer
    var _fillLayer = null;   // 채움 layer
    var _source = null;
    var _visible = false;
    var _loaded = false;
    var _loading = false;

    var _map = null;               // moveend/resize 훅 등록용
    var _labelCanvas = null;       // 라벨 전용 오버레이 캔버스(OL 뷰포트 위에 겹침, pointer-events:none)
    var _labelCtx = null;
    var _labelRects = new Map();   // feature → 현재 그려진 라벨의 화면(css px) 사각형(라벨 클릭 판정용)
    var _labelRAF = null;          // moveend 다발 발생 시 중복 재계산 방지용 requestAnimationFrame 핸들

    /** 출입통제구역 폴리곤 스타일 (빨간 톤 — 해도상 출입통제 표기 관례와 동일). 라벨 텍스트는
     *  겹침 회피가 필요해 OL 스타일이 아니라 _labelCanvas 오버레이에 별도로 그린다. */
    function _zoneStyle() {
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: 'rgba(255, 82, 82, 0.9)',
                width: 2
            }),
            fill: new ol.style.Fill({
                color: 'rgba(255, 82, 82, 0.15)'
            })
        });
    }

    function _onlyFill(style) {
        var f = style.getFill();
        if (!f) return null;
        return new ol.style.Style({ fill: f });
    }
    function _onlyStroke(style) {
        return new ol.style.Style({ stroke: style.getStroke() });
    }
    /** feature 의 지리 범위가 현재 해상도(m/px)에서 몇 픽셀 크기로 보이는지(가로/세로 중 큰 쪽) */
    function _extentPixelSizeAtResolution(feature, resolution) {
        var extent = feature.getGeometry().getExtent();
        return Math.max((extent[2] - extent[0]) / resolution, (extent[3] - extent[1]) / resolution);
    }

    // 폴리곤이 화면에서 이 픽셀 크기보다 작게 보이면 채움/외곽선을 아예 안 그린다 — 특히
    // 위치 추정치라 작은 정사각형으로만 표시해 둔 구역들이 축소된 화면에서 작은 점처럼
    // 보이던 문제(라벨 텍스트만으로 충분히 위치를 알 수 있어 점 표시가 불필요) 해결.
    var MIN_SHAPE_PX = 8;

    function _fillOnlyStyle(feature, resolution) {
        if (_extentPixelSizeAtResolution(feature, resolution) < MIN_SHAPE_PX) return null;
        return _onlyFill(_zoneStyle(feature));
    }
    function _strokeOnlyStyle(feature, resolution) {
        if (_extentPixelSizeAtResolution(feature, resolution) < MIN_SHAPE_PX) return null;
        return _onlyStroke(_zoneStyle(feature));
    }

    function _ensureLayers(map) {
        _map = map;
        if (!_source) _source = new ol.source.Vector();

        if (!_fillLayer) {
            _fillLayer = new ol.layer.Vector({
                source: _source,
                style: _fillOnlyStyle,
                zIndex: 42,
                visible: _visible,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_fillLayer);
        }
        if (!_layer) {
            _layer = new ol.layer.Vector({
                source: _source,
                style: _strokeOnlyStyle,
                zIndex: 82,
                visible: _visible,
                updateWhileAnimating: false,
                updateWhileInteracting: false
            });
            map.addLayer(_layer);
        }
        // 'moveend'(드래그가 끝난 뒤에만)로는 드래그하는 동안 라벨 캔버스가 그 자리에
        // 멈춰 있다가 드래그가 끝나야 스냅되어 보이는 지연이 생긴다. OL 자체 렌더 루프에
        // 맞물리는 'postrender'(패닝/줌 애니메이션 중에도 프레임마다 발생) 콜백 안에서
        // 바로 다시 그려야 OL 레이어와 같은 프레임에 맞춰져 지연 없이 따라 움직인다
        // (requestAnimationFrame 으로 한 번 더 감싸면 그만큼 한 프레임 늦게 그려진다).
        map.on('postrender', function () { if (_visible) _drawLabels(); });
    }

    /** 지도 뷰포트 위에 겹쳐지는 라벨 전용 캔버스를 1회 생성(pointer-events:none —
     *  클릭 판정은 _accessControlTryHandleClick 이 _labelRects 로 직접 처리) */
    function _ensureLabelCanvas() {
        if (_labelCanvas) return;
        _labelCanvas = document.createElement('canvas');
        _labelCanvas.style.position = 'absolute';
        _labelCanvas.style.left = '0';
        _labelCanvas.style.top = '0';
        _labelCanvas.style.pointerEvents = 'none';
        _labelCanvas.style.zIndex = '10';
        _labelCtx = _labelCanvas.getContext('2d');
        _map.getViewport().appendChild(_labelCanvas);
    }

    /** feature 하나의 라벨 기준점(화면 픽셀) — Polygon 은 내부점(오목한 모양도 안전),
     *  LineString 은 중간 지점을 기준으로 삼는다 */
    function _labelAnchorPixel(map, feature) {
        var geom = feature.getGeometry();
        var coord = geom.getType() === 'Polygon' ? geom.getInteriorPoint().getCoordinates() : geom.getCoordinateAt(0.5);
        return map.getPixelFromCoordinate(coord);
    }

    /** 라벨은 기준점 바로 위 고정 위치에만 놓는다(밀어내기·인출선 없음) — 그 자리가
     *  이미 그려진 다른 라벨과 겹치면 이번 줌 레벨에서는 텍스트 대신 작은 점만 찍는다.
     *  축소된 화면일수록 같은 지점들이 화면상 더 가까이 뭉쳐 겹침이 잦아지므로 점만
     *  남고, 확대할수록 픽셀 간격이 벌어져 겹침이 풀리면서 라벨이 하나씩 저절로
     *  나타난다(줌 레벨별 표시 개수를 따로 관리할 필요 없음). */
    function _layoutLabels(map, features) {
        var placed = [];
        var layout = []; // { feature, anchor:[x,y], rect:{x0,y0,x1,y1}|null, dotOnly }

        function overlaps(r) {
            for (var i = 0; i < placed.length; i++) {
                var p = placed[i];
                if (r.x0 < p.x1 + 3 && r.x1 > p.x0 - 3 && r.y0 < p.y1 + 3 && r.y1 > p.y0 - 3) return true;
            }
            return false;
        }

        var items = features.map(function (f) {
            var anchor = _labelAnchorPixel(map, f);
            var text = f.get('location') || '';
            var w = _labelCtx.measureText(text).width;
            return { feature: f, anchor: anchor, w: w, h: 14 };
        });
        items.sort(function (a, b) { return a.anchor[1] - b.anchor[1] || a.anchor[0] - b.anchor[0]; });

        items.forEach(function (it) {
            var cy = it.anchor[1] - 8; // 점보다 살짝 위에 뜨도록
            var rect = { x0: it.anchor[0] - it.w / 2 - 2, y0: cy - it.h / 2, x1: it.anchor[0] + it.w / 2 + 2, y1: cy + it.h / 2 };
            if (!overlaps(rect)) {
                placed.push(rect);
                layout.push({ feature: it.feature, anchor: it.anchor, rect: rect, dotOnly: false });
            } else {
                layout.push({ feature: it.feature, anchor: it.anchor, rect: null, dotOnly: true });
            }
        });
        return layout;
    }

    /** moveend/resize 직후 다발적으로 여러 번 불려도 프레임당 1번만 재계산하도록 묶는다 */
    function _scheduleLabelUpdate() {
        if (_labelRAF) return;
        _labelRAF = requestAnimationFrame(function () {
            _labelRAF = null;
            _drawLabels();
        });
    }

    /** 라벨 오버레이를 다시 그린다 — 겹치는 라벨은 이번 줌에서 그냥 건너뛴다(_layoutLabels 참고) */
    function _drawLabels() {
        if (!_map || !_labelCanvas || !_source) return;
        var size = _map.getSize();
        if (!size) return;
        var dpr = window.devicePixelRatio || 1;
        _labelCanvas.width = size[0] * dpr;
        _labelCanvas.height = size[1] * dpr;
        _labelCanvas.style.width = size[0] + 'px';
        _labelCanvas.style.height = size[1] + 'px';
        _labelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        _labelCtx.clearRect(0, 0, size[0], size[1]);
        _labelCtx.font = 'bold 11px "Pretendard", sans-serif';
        _labelCtx.textBaseline = 'middle';

        _labelRects.clear();
        var layout = _layoutLabels(_map, _source.getFeatures());
        layout.forEach(function (it) {
            if (it.dotOnly) {
                // 이 줌 레벨에서는 너무 촘촘히 몰려 있음 — 점도 찍지 않고 그냥 건너뛴다.
                // 확대해서 겹침이 풀리면 자동으로 라벨이 나타난다.
                return;
            }
            var cx = (it.rect.x0 + it.rect.x1) / 2;
            var cy = (it.rect.y0 + it.rect.y1) / 2;
            var text = it.feature.get('location') || '';
            _labelCtx.textAlign = 'center';
            _labelCtx.strokeStyle = 'rgba(0,0,0,0.85)';
            _labelCtx.lineWidth = 3;
            _labelCtx.strokeText(text, cx, cy);
            _labelCtx.fillStyle = '#ffb3b3';
            _labelCtx.fillText(text, cx, cy);
            _labelRects.set(it.feature, it.rect);
        });
    }

    /** 정적 GeoJSON lazy fetch — 버튼을 처음 켤 때만 1회 */
    function _load() {
        if (_loaded || _loading) return;
        _loading = true;
        fetch(DATA_URL)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (geojson) {
                if (!_source) return;
                var features = new ol.format.GeoJSON().readFeatures(geojson, {
                    dataProjection: 'EPSG:4326',
                    featureProjection: 'EPSG:3857'
                });
                _source.addFeatures(features);
                _loaded = true;
                _loading = false;
                if (_visible) _scheduleLabelUpdate();
            })
            .catch(function (err) {
                _loading = false;
                console.warn('[AccessControl] GeoJSON 로드 실패:', err.message);
            });
    }

    /** "라벨/값" 2열 grid의 한 행 — 값이 없으면 그 행 자체를 만들지 않는다.
     *  (grid-template-columns: max-content 1fr 이라 값이 줄바꿈되면 값 칸의
     *  왼쪽 끝, 즉 라벨 다음 위치에 자동으로 맞춰 정렬된다) */
    function _row(label, value) {
        if (!value) return '';
        return '<span class="ac-detail-label">' + label + '</span><span class="ac-detail-value">' + value + '</span>';
    }

    /** 문의처 문자열 속 전화번호(예: 032-650-2348)를 tel: 링크로 바꿔 탭하면 바로 전화 걸리게 한다 */
    function _linkifyPhone(text) {
        if (!text) return text;
        return text.replace(/(\d{2,3}-\d{3,4}-\d{4})/g, function (num) {
            return '<a href="tel:' + num.replace(/-/g, '') + '" style="color:#93c5fd;text-decoration:underline;white-space:nowrap;">' + num + '</a>';
        });
    }

    /** 폴리곤 feature 하나의 상세 정보 팝업 HTML을 만든다(구역마다 고시 내용이 달라 항목별로 있는 것만 표시) */
    function _buildDetailHtml(hit) {
        var rows = '';
        rows += _row('관할', hit.get('station'));
        rows += _row('고시.공고', hit.get('notice_no'));
        rows += _row('일자', hit.get('date'));
        rows += _row('지정사유', hit.get('reason'));
        rows += _row('소재지', hit.get('address'));
        rows += _row('통제기간', hit.get('control_period'));
        rows += _row('통제시간', hit.get('control_time'));
        rows += _row('대상', hit.get('target'));
        rows += _row('벌칙', hit.get('penalty'));
        rows += _row('문의처', _linkifyPhone(hit.get('contact')));
        rows += _row('상태', hit.get('status'));

        var html = rows ? '<div class="ac-detail-grid">' + rows + '</div>' : '';

        var src = hit.get('source_file');
        if (src) {
            var url = '/api/legal/src?p=' + encodeURIComponent(src);
            var filename = src.split('/').pop().replace(/'/g, '');
            // 관할서마다 실제로 "고시" 또는 "공고"로 다르게 발행하므로(근거 조항은 같지만
            // 행정행위 형식이 다름) 버튼 문구도 원본 파일명을 보고 그대로 맞춘다.
            // (notice_no 필드는 평택 5건이 값 자체에 고시/공고 표기가 없어 source_file 로 판단)
            var docLabel = /고시/.test(src) ? '고시' : '공고';
            // <a download> 는 Capacitor 네이티브 웹뷰에서 그냥 무시된다(ocean_typhoon.js
            // downloadImg() 와 동일한 앱 공통 문제) — 그래서 클릭해도 아무 반응이 없었음.
            // window._accessControlDownloadSrc() 가 네이티브면 시스템 브라우저(@capacitor/browser)로,
            // 아니면 평범한 <a download> 로 내려받게 분기한다.
            html += '<p style="margin-top:18px;text-align:center;">' +
                '<button type="button" class="ac-src-btn" ' +
                'onclick="window._accessControlDownloadSrc(\'' + url + '\', \'' + filename + '\')">' +
                '<i class="fa-solid fa-file-lines"></i> ' + docLabel + ' 원문 다운로드하기</button></p>';
        }
        return html || '<p>세부 정보를 불러오지 못했습니다.</p>';
    }

    /**
     * [외부 API] 고시/공고 원문 파일을 내려받는다. Capacitor 네이티브 웹뷰는 <a download> 를
     * 무시하므로(ocean_typhoon.js downloadImg()·admin_collect.js 와 동일 패턴), 네이티브에서는
     * 시스템 브라우저(@capacitor/browser)로 attachment URL 을 열어 OS 가 받게 하고,
     * 일반 웹에서는 평범한 <a download> 로 처리한다.
     */
    window._accessControlDownloadSrc = function (url, filename) {
        function anchor() {
            var a = document.createElement('a');
            a.href = url; a.download = filename; a.target = '_blank';
            document.body.appendChild(a); a.click(); a.remove();
        }
        var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        var Browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
        if (isNative && Browser && Browser.open) {
            try {
                var p = Browser.open({ url: window.location.origin + url });
                if (p && p.catch) p.catch(anchor);
                return;
            } catch (e) { /* 폴백 */ }
        }
        anchor();
    };

    /** feature 의 지리 범위가 현재 화면에서 몇 픽셀 크기로 보이는지(가로/세로 중 큰 쪽) */
    function _extentPixelSize(map, feature) {
        var extent = feature.getGeometry().getExtent();
        var p1 = map.getPixelFromCoordinate([extent[0], extent[1]]);
        var p2 = map.getPixelFromCoordinate([extent[2], extent[3]]);
        if (!p1 || !p2) return 0;
        return Math.max(Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1]));
    }

    /**
     * [외부 API] 지도 클릭이 출입통제구역 폴리곤을 눌렀는지 확인한다.
     * 구역이 화면에 너무 작게(줌아웃 상태) 보이는 상태에서 누르면 — 그 구역이 잘 보이도록
     * 먼저 확대만 하고 팝업은 띄우지 않는다. 이미 충분히 확대돼 있는 상태에서 누르면(또는
     * 확대 후 같은 구역을 한 번 더 누르면) 바로 상세정보 팝업을 띄운다.
     * @param {ol.Map} map
     * @param {ol.MapBrowserEvent} evt
     * @returns {boolean} true 면 클릭이 소비됨(호출자는 바텀시트 등을 건너뛰어야 함)
     * [연계] ← ocean_map.js handleMapClick — hazard_rocks 다음 우선순위로 호출.
     *        자체 singleclick 리스너를 따로 달지 않는 이유: 그렇게 하면 handleMapClick 의
     *        바텀시트 로직과 같은 클릭에 동시에 반응해버려 팝업+바텀시트가 함께 뜬다.
     */
    window._accessControlTryHandleClick = function (map, evt) {
        if (!_visible || !_fillLayer) return false;
        var hit = map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer === _fillLayer) return feature;
            // 채움이 없는 선(LineString, 예: 용수리 가~나 통제경계선)은 _fillLayer로는
            // 못 잡으므로 외곽선 레이어(_layer)에서 보조로 판정 — 폴리곤은 이미 위에서
            // _fillLayer 판정으로 잡히므로 여기선 LineString feature만 추가로 본다.
            if (layer === _layer && feature.getGeometry().getType() === 'LineString') return feature;
            return null;
        }, { hitTolerance: 6 });
        if (!hit) {
            // 폴리곤/선을 못 맞췄으면 라벨 텍스트 위를 눌렀는지도 확인 — _labelRects 는
            // _drawLabels() 가 매번 다시 채운다.
            _labelRects.forEach(function (rect, feature) {
                if (hit) return;
                if (evt.pixel[0] >= rect.x0 && evt.pixel[0] <= rect.x1 && evt.pixel[1] >= rect.y0 && evt.pixel[1] <= rect.y1) hit = feature;
            });
        }
        if (!hit) return false;

        if (_extentPixelSize(map, hit) < 60) {
            map.getView().fit(hit.getGeometry().getExtent(), { padding: [80, 80, 80, 80], maxZoom: 15, duration: 400 });
            return true;
        }

        var location = hit.get('location') || '출입통제구역';
        if (typeof window.showSeagnalModal === 'function') {
            window.showSeagnalModal(location, _buildDetailHtml(hit), 'info');
            // 항목 수가 많아 기본 폭(320px)보다 넓게 — 이 팝업에만 적용, 다른 showSeagnalModal 호출부는 그대로
            var modalContent = document.querySelector('#seagnal-custom-modal .seagnal-modal-content');
            if (modalContent) modalContent.classList.add('access-control-wide');
        } else if (typeof window._showOceanToast === 'function') {
            window._showOceanToast((hit.get('station') || '') + ' ' + location, 'bottom', 3000);
        }
        return true;
    };

    function _bindToggle(map) {
        var btn = document.getElementById('ocean-access-control-toggle-btn');
        if (!btn) return;

        var _prevBasemap = null; // OFF 시 원래 배경지도로 되돌리기 위해 ON 시점 값을 기억

        btn.addEventListener('click', function () {
            _visible = !_visible;
            btn.classList.toggle('active', _visible);
            if (_layer) _layer.setVisible(_visible);
            if (_fillLayer) _fillLayer.setVisible(_visible);
            if (_visible) {
                _load();
                _ensureLabelCanvas();
                _scheduleLabelUpdate();
                // 폴리곤을 실제 지형과 대조해 보기 쉽도록 배경지도를 위성지도로 자동 전환
                // (ocean_warn_active.js 의 "ON 시 배경 전환 → OFF 시 복귀" 와 동일 패턴)
                if (typeof window.oceanGetBasemap === 'function' && typeof window.oceanSetBasemap === 'function') {
                    _prevBasemap = window.oceanGetBasemap();
                    if (_prevBasemap !== 'vworld') window.oceanSetBasemap('vworld');
                }
            } else {
                if (_labelCtx && _labelCanvas) _labelCtx.clearRect(0, 0, _labelCanvas.width, _labelCanvas.height);
                _labelRects.clear();
                if (_prevBasemap && _prevBasemap !== 'vworld' && typeof window.oceanSetBasemap === 'function') {
                    window.oceanSetBasemap(_prevBasemap);
                    _prevBasemap = null;
                }
            }
        });
    }

    /** oceanMap 이 만들어질 때까지 폴링 (ocean_warn_zone.js 와 동일 패턴) */
    function _installWhenReady() {
        function _try() {
            var map = window.getOceanMap && window.getOceanMap();
            if (map) {
                _ensureLayers(map);
                _bindToggle(map);
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
