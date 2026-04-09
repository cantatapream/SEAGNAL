/**
 * ============================================================================
 * 파일명: js/ocean_map.js
 * 역할: 해양종합정보 지도 초기화 + 베이스맵 전환 + 기본 인터랙션
 * ============================================================================
 *
 * [설명]
 * 해양종합정보 히든 탭의 OpenLayers 지도를 초기화합니다.
 * 조석지도/해양현황 분리 모드 없이 단일 통합 지도 뷰로 동작합니다.
 * - 베이스맵: 기본맵 / 전자해도 / 해안도 (피커로 선택)
 * - 오버레이: 조류/바람/파고 (항상 표시되는 우측 버튼)
 * - 주요지명: 조석 마커 토글 버튼
 * - 타임라인: 항상 표시 (조류=1h 스텝, 바람/파고=3h 스텝)
 *
 * [연계 파일]
 * - index.html → #ocean-map, #ocean-map-section
 * - ocean_markers.js → 조석 마커, 클릭 처리
 * - ocean_bottom_sheet.js → 바텀시트 표시
 * - ocean_overlay.js → 캔버스 오버레이
 * - ocean_timeline.js → 타임라인 슬라이더
 * - js/settings.js → 히든 탭 진입 메커니즘
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상태 변수
    // ========================================================================
    let oceanMap = null;              // OpenLayers Map 인스턴스
    let baseLayerA         = null;    // 기본맵 (BASEMAP_RLTM3857)
    let baseLayerENC       = null;    // 전자해도 (BASEMAP_ENC573857)
    let baseLayerCoast     = null;    // 해안도 (BASEMAP_RLTMCOAST3857)
    let baseLayerSatellite = null;    // 위성지도 (국토정보플랫폼 국토위성지도)
    let currentBase        = 'rltm'; // 현재 베이스맵: 'rltm' | 'enc' | 'coast' | 'satellite'
    let searchResultLayer = null;     // 검색 결과 마커 레이어

    // 해아름 WMS 엔드포인트 (F12 캡처로 확인됨)
    // http://www.khoa.go.kr/oceanmap/{LAYER}/wmsVectordata.do?SERVICE=WMS&...
    const KHOA_WMS_BASE = 'https://www.khoa.go.kr/oceanmap/';
    const KHOA_LAYER_A     = 'BASEMAP_RLTM3857';      // 기본맵 (국문)
    const KHOA_LAYER_ENC   = 'BASEMAP_ENC573857';     // 전자해도
    const KHOA_LAYER_COAST = 'BASEMAP_RLTMCOAST3857'; // 해안도

    // 한반도 남부 + 제주 → 최소 줌 레벨 6
    // [중요] MAX_ZOOM 은 KHOA 해아름 WMS 가 안정적으로 타일을 제공하는 한계까지로 제한.
    //        그 이상으로 확대하면 해아름이 빈 타일을 주고, 사용자는 OpenStreetMap 같은
    //        다른 지도가 갑자기 나오는 것처럼 느낀다(실제로는 OSM 폴백 코드가 바꾸던 것).
    //        해아름만 사용한다는 요구사항(2026-04 사용자 지시)에 따라 폴백을 제거하고
    //        대신 줌 한계를 15 로 고정한다.
    const DEFAULT_CENTER = [127.0, 34.5];
    const DEFAULT_ZOOM = 7;
    const MIN_ZOOM = 6;
    const MAX_ZOOM = 15;

    // ========================================================================
    // 해아름 WMS 레이어 생성
    // ========================================================================

    /**
     * 해아름 WMS 타일 레이어를 생성합니다.
     *
     * [동작 방식]
     * KHOA 해아름은 WMS 1.1.1 GetMap 방식으로 지도 조각을 줍니다.
     * 우리는 OpenLayers의 TileWMS source에 엔드포인트와 파라미터만
     * 넘기면, OL이 알아서 BBOX를 계산해서 256x256 png를 요청합니다.
     *
     * [캡처된 실제 요청 예시]
     *  http://www.khoa.go.kr/oceanmap/BASEMAP_RLTMHL/wmsVectordata.do
     *    ?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap
     *    &FORMAT=image/png&TRANSPARENT=true
     *    &WIDTH=256&HEIGHT=256&SRS=EPSG:5179&STYLES=
     *    &BBOX=...
     *
     * 레이어 이름에 '3857'이 포함되어 있으므로 EPSG:3857로 요청합니다.
     *
     * @param {string} layer - 레이어명 (BASEMAP_RLTM3857 등)
     * @returns {ol.layer.Tile}
     */
    function createKhoaLayer(layer) {
        // KHOA가 HTTPS→HTTP 302 리다이렉트를 보내 브라우저가 차단하므로
        // 서버 프록시(/api/ocean/khoa-wms)를 거쳐서 받습니다.
        var endpoint = '/api/ocean/khoa-wms';

        var wmsSource = new ol.source.TileWMS({
            url: endpoint,
            params: {
                'layer': layer,
                'SERVICE': 'WMS',
                'VERSION': '1.1.1',
                'REQUEST': 'GetMap',
                'FORMAT': 'image/png',
                'TRANSPARENT': true,
                'STYLES': '',
                'LAYERS': '',
                'SRS': 'EPSG:3857'
            },
            projection: 'EPSG:3857',
            attributions: '&copy; <a href="https://www.khoa.go.kr">국립해양조사원</a>',
            crossOrigin: 'anonymous'
        });

        // 타일 레이어 생성
        // [정책] 사용자 요구사항: "해아름만 나와야 함".
        //   기존에 있던 'tileloaderror 3회 누적 시 OSM 으로 setSource' 폴백은
        //   한 번 발동되면 영구적으로 OSM 이 표시되어 줌아웃해도 복구되지 않는
        //   문제가 있어 제거했다. 대신 MAX_ZOOM 을 KHOA 한계(15)로 고정하여
        //   해아름이 타일을 못 주는 줌 레벨 자체를 차단한다.
        var tileLayer = new ol.layer.Tile({
            source: wmsSource,
            visible: true
        });

        wmsSource.on('tileloaderror', function () {
            console.warn('[OceanMap] 해아름 WMS 타일 로드 실패(' + layer + ')');
        });

        console.log('[OceanMap] 해아름 WMS 엔드포인트:', endpoint);
        return tileLayer;
    }

    // ========================================================================
    // 국토정보플랫폼 항공영상 레이어 생성
    // ========================================================================

    /**
     * 국토정보플랫폼(NGII) 항공영상 WMTS 레이어를 생성합니다.
     *
     * [좌표계]
     * GoogleMapsCompatible TileMatrixSet = EPSG:3857 기반 타일.
     * 우리 지도와 좌표계가 동일하므로 마커·오버레이 위치가 그대로 정확합니다.
     *
     * [레이어]
     * AIRPHOTO = 최신 항공사진 (mapMode:9 해당)
     * 해상도 ~0.25m/픽셀 (국토위성지도보다 고해상도)
     *
     * [인증]
     * URL 파라미터로 apikey 전달.
     * ol.source.XYZ 사용 — GoogleMapsCompatible 타일셋은 XYZ({z}/{y}/{x}) 구조와 동일.
     * ol.source.WMTS + ol.tilegrid.WMTS.createForProjection 은 OL 8.2.0 CDN 번들에서
     * 노출되지 않으므로 XYZ 방식으로 대체합니다.
     */
    function createNgiiSatelliteLayer() {
        var NGII_KEY = 'E2BC008450A0DDAFEFAFBD606AB7E8DEC6F031C369';

        // GoogleMapsCompatible 타일셋 = EPSG:3857, z/y/x 인덱스 동일 → XYZ로 직접 요청
        var source = new ol.source.XYZ({
            url: 'https://map.ngii.go.kr/ms/map/getNgiiMap.do' +
                 '?service=WMTS&request=GetTile&version=1.0.0' +
                 '&layer=AIRPHOTO&style=default' +
                 '&tilematrixset=GoogleMapsCompatible' +
                 '&format=image/png' +
                 '&tilematrix={z}&tilerow={y}&tilecol={x}' +
                 '&apikey=' + NGII_KEY,
            crossOrigin: 'anonymous',
            attributions: '&copy; <a href="https://www.ngii.go.kr" target="_blank">국토지리정보원</a>'
        });

        source.on('tileloaderror', function () {
            console.warn('[OceanMap] NGII 항공영상 타일 로드 실패');
        });

        return new ol.layer.Tile({ source: source, visible: false });
    }

    // ========================================================================
    // 지도 초기화
    // ========================================================================

    /**
     * 해양종합정보 지도를 초기화합니다.
     * 이미 초기화된 경우 updateSize()만 호출합니다.
     */
    window.initOceanMap = function () {
        if (oceanMap) {
            oceanMap.updateSize();
            return;
        }

        // WMS 방식이라 비동기 스크립트 로드 불필요 → 즉시 빌드
        buildMap();
    };

    /**
     * 실제 지도를 생성하는 함수.
     * 해아름 URL 확보 후 호출됩니다.
     */
    function buildMap() {
        try {
            // 해아름 WMS 레이어 생성
            baseLayerA     = createKhoaLayer(KHOA_LAYER_A);
            baseLayerENC   = createKhoaLayer(KHOA_LAYER_ENC);
            baseLayerCoast = createKhoaLayer(KHOA_LAYER_COAST);

            // 국토정보플랫폼 위성지도 레이어 생성 (EPSG:3857 GoogleMapsCompatible)
            baseLayerSatellite = createNgiiSatelliteLayer();

            // 초기 가시성: 기본맵만 표시
            baseLayerENC.setVisible(false);
            baseLayerCoast.setVisible(false);
            // baseLayerSatellite는 createNgiiSatelliteLayer()에서 이미 visible:false

            const layers = [baseLayerA, baseLayerENC, baseLayerCoast, baseLayerSatellite];

            // 지도 생성
            oceanMap = new ol.Map({
                target: 'ocean-map',
                layers: layers,
                view: new ol.View({
                    center: ol.proj.fromLonLat(DEFAULT_CENTER),
                    zoom: DEFAULT_ZOOM,
                    minZoom: MIN_ZOOM,
                    maxZoom: MAX_ZOOM
                }),
                controls: ol.control.defaults.defaults({ zoom: false, rotate: false })
            });

            // 클릭 이벤트
            oceanMap.on('click', handleMapClick);

            // 뷰포트 변경 시 오버레이 갱신
            oceanMap.on('moveend', function () {
                if (window.oceanOverlayRefresh) {
                    window.oceanOverlayRefresh(oceanMap);
                }
            });

            // 베이스맵 선택 피커 바인딩
            bindBasemapPicker();

            // 마커 초기화 후 바로 토글 버튼 바인딩
            // (bindMarkerToggle 내부에서 localStorage 복원 + showOceanMarkers 초기 적용)
            if (window.initOceanMarkers) {
                window.initOceanMarkers(oceanMap);
            }
            bindMarkerToggle();

            // 위치 검색 초기화
            initOceanSearch();

            // 내 위치 버튼
            const myLocBtn = document.getElementById('ocean-myloc-btn');
            if (myLocBtn) {
                myLocBtn.addEventListener('click', goToMyLocation);
            }

            // 오버레이 초기화 (버튼 바인딩, 캔버스 준비)
            if (window.oceanOverlayInit) {
                window.oceanOverlayInit(oceanMap);
            }

            // 타임라인 초기화 (항상 표시)
            if (window.initOceanTimeline) {
                window.initOceanTimeline();
            }

            console.log('[OceanMap] 지도 초기화 완료 (해아름 WMS)');
        } catch (error) {
            console.error('[OceanMap] 초기화 오류:', error);
        }
    }

    // ========================================================================
    // 베이스맵 선택 피커
    // ========================================================================

    /** 현재 currentBase 에 해당하는 레이어만 표시, 나머지 숨김 */
    function applyBaseLayerVisibility() {
        if (baseLayerA)         baseLayerA.setVisible(currentBase === 'rltm');
        if (baseLayerENC)       baseLayerENC.setVisible(currentBase === 'enc');
        if (baseLayerCoast)     baseLayerCoast.setVisible(currentBase === 'coast');
        if (baseLayerSatellite) baseLayerSatellite.setVisible(currentBase === 'satellite');
    }

    /**
     * 베이스맵을 지정한 종류로 전환합니다.
     * @param {string} type - 'rltm'(기본맵) | 'enc'(전자해도) | 'coast'(해안도)
     *
     * 기본맵·전자해도로 전환할 경우 파티클 오버레이(조류/바람/파고)를 자동으로 끕니다.
     * 오버레이는 해안도에서만 의미 있는 시각화이기 때문입니다.
     * (해안도 → 기본맵으로 돌아가면서 파티클이 남아 있는 것을 방지)
     */
    function switchBaseLayer(type) {
        currentBase = type;
        applyBaseLayerVisibility();

        // 피커 버튼 active 상태 갱신
        document.querySelectorAll('.ocean-basemap-item').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.basemap === type);
        });

        // 레이어 이름 표시 갱신
        var toggleLabel = document.getElementById('ocean-basemap-label');
        if (toggleLabel) {
            var names = { rltm: '기본맵', enc: '전자해도', coast: '해안도', satellite: '항공영상' };
            toggleLabel.textContent = names[type] || '지도';
        }

        // 기본맵·전자해도·위성지도로 전환 시 오버레이(파티클+범례+슬라이더) 자동 OFF
        // coast(해안도)로 전환할 때만 오버레이 상태를 유지합니다.
        if (type !== 'coast' && window.oceanOverlayTurnOff) {
            window.oceanOverlayTurnOff();
        }
    }

    /** 오버레이 버튼 클릭 시 배경지도를 해안도로 자동 전환 */
    window.switchToCoastBasemap = function () {
        if (currentBase !== 'coast') {
            switchBaseLayer('coast');
        }
    };

    function bindBasemapPicker() {
        var toggleBtn = document.getElementById('ocean-basemap-toggle');
        var menu      = document.getElementById('ocean-basemap-menu');
        if (!toggleBtn || !menu) return;

        // 토글 버튼: 메뉴 열고 닫기
        toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            menu.style.display = menu.style.display === 'none' ? '' : 'none';
        });

        // 메뉴 아이템 클릭: 레이어 전환 + 메뉴 닫기
        document.querySelectorAll('.ocean-basemap-item').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                switchBaseLayer(this.dataset.basemap);
                menu.style.display = 'none';
            });
        });

        // 지도 클릭 시 메뉴 닫기
        oceanMap.on('click', function () {
            menu.style.display = 'none';
        });
    }

    // ========================================================================
    // 주요지명 마커 토글
    // ========================================================================

    function bindMarkerToggle() {
        var btn = document.getElementById('ocean-marker-toggle-btn');
        if (!btn) return;

        // localStorage에서 이전 상태 복원 (기본값: 숨김)
        var markersVisible = localStorage.getItem('seagnal_markers_visible') === 'true';
        btn.classList.toggle('active', markersVisible);
        if (window.showOceanMarkers) window.showOceanMarkers(markersVisible);

        btn.addEventListener('click', function () {
            markersVisible = !markersVisible;
            btn.classList.toggle('active', markersVisible);
            if (window.showOceanMarkers) window.showOceanMarkers(markersVisible);
            try { localStorage.setItem('seagnal_markers_visible', markersVisible); } catch (e) {}
        });
    }

    // ========================================================================
    // 지도 클릭 처리
    // ========================================================================

    function handleMapClick(evt) {
        const coord = ol.proj.toLonLat(evt.coordinate);
        const lon = coord[0];
        const lat = coord[1];

        // 마커 클릭 확인
        if (window.handleOceanMarkerClick) {
            const hit = window.handleOceanMarkerClick(oceanMap, evt);
            if (hit) return; // 마커 클릭이면 마커 핸들러에서 처리
        }

        // 빈 영역 클릭 → 바텀시트 표시
        if (window.showOceanBottomSheet) {
            window.showOceanBottomSheet(lat, lon);
        }
    }

    // ========================================================================
    // 위치 검색
    // ========================================================================

    function initOceanSearch() {
        const input = document.getElementById('ocean-search-input');
        const clearBtn = document.getElementById('ocean-search-clear');
        if (!input) return;

        let searchTimer = null;

        input.addEventListener('input', function () {
            clearBtn.style.display = this.value ? '' : 'none';
            clearTimeout(searchTimer);
            if (this.value.trim().length >= 2) {
                searchTimer = setTimeout(() => searchLocation(this.value.trim()), 300);
            } else {
                closeSearchDropdown();
            }
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                input.value = '';
                clearBtn.style.display = 'none';
                closeSearchDropdown();
                input.focus();
            });
        }

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (this.value.trim().length >= 2) {
                    searchLocation(this.value.trim());
                }
            }
        });
    }

    /**
     * 위치 검색 (서버 프록시 방식)
     *
     * [역할]
     * 사용자가 검색창에 입력한 키워드(예: "제주항")로 장소를 찾아
     * 드롭다운에 결과를 보여줍니다. 결과를 클릭하면 지도가 그 좌표로 이동합니다.
     *
     * [왜 서버 프록시?]
     * - 조석정보 탭(tide.js)과 동일하게 우리 서버의 /api/search-place 를 통해 검색합니다.
     * - 브라우저가 직접 Kakao 자바스크립트 SDK 를 부르지 않으므로
     *   1) Kakao Maps SDK 스크립트를 페이지에 로드할 필요가 없고
     *   2) 도메인 인증/배포환경 변경 이슈가 없으며
     *   3) tide.js 검색에서 이미 검증된 동일 응답 포맷을 그대로 사용합니다.
     *
     * [연계]
     * - 서버: routes/tide.js 의 /api/search-place (Kakao REST API 프록시)
     * - 호출처: 본 파일 위쪽 input 'input'/'keydown' 이벤트 핸들러
     * - 결과 표시: showSearchResults() 가 드롭다운 DOM 을 렌더링
     * - 항목 클릭: 같은 함수 안에서 oceanMap.getView().animate() 로 이동
     */
    function searchLocation(query) {
        // 1) 검색 시작 안내 (사용자가 무언가 진행 중임을 인지)
        showSearchResults([{ name: '검색 중...', disabled: true }]);

        // 2) 서버 프록시 호출 — Kakao REST API 응답을 그대로 패스스루
        fetch('/api/search-place?q=' + encodeURIComponent(query))
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, data: data };
                });
            })
            .then(function (resp) {
                // 3-a) 서버 오류 (예: API 키 미설정)
                if (!resp.ok) {
                    showSearchResults([{
                        name: (resp.data && resp.data.error) || '검색 서비스를 사용할 수 없습니다',
                        disabled: true
                    }]);
                    return;
                }

                var docs = resp.data && resp.data.documents;
                // 3-b) 결과 없음
                if (!docs || docs.length === 0) {
                    showSearchResults([{ name: '검색 결과가 없습니다', disabled: true }]);
                    return;
                }

                // 3-c) 정상 결과 → 기존 showSearchResults 가 기대하는 포맷으로 매핑
                //   - place_name  → name   (드롭다운 굵은 글씨)
                //   - address_name → address (드롭다운 보조 텍스트)
                //   - x(경도) / y(위도) → lon / lat (지도 이동에 사용)
                var results = docs.slice(0, 5).map(function (item) {
                    return {
                        name: item.place_name,
                        address: item.address_name,
                        lat: parseFloat(item.y),
                        lon: parseFloat(item.x)
                    };
                });
                showSearchResults(results);
            })
            .catch(function (err) {
                // 4) 네트워크 오류 등
                console.error('[OceanMap] 검색 오류:', err && err.message);
                showSearchResults([{ name: '검색 중 오류가 발생했습니다', disabled: true }]);
            });
    }

    function showSearchResults(results) {
        const dropdown = document.getElementById('ocean-search-dropdown');
        if (!dropdown) return;

        dropdown.innerHTML = results.map(r => {
            if (r.disabled) {
                return `<div class="ocean-search-item disabled">${r.name}</div>`;
            }
            return `<div class="ocean-search-item" data-lat="${r.lat}" data-lon="${r.lon}">
                <strong>${r.name}</strong>
                <span>${r.address || ''}</span>
            </div>`;
        }).join('');

        dropdown.style.display = 'block';

        dropdown.querySelectorAll('.ocean-search-item:not(.disabled)').forEach(item => {
            item.addEventListener('click', function () {
                const lat = parseFloat(this.dataset.lat);
                const lon = parseFloat(this.dataset.lon);
                var name = this.querySelector('strong').textContent;
                if (oceanMap) {
                    oceanMap.getView().animate({
                        center: ol.proj.fromLonLat([lon, lat]),
                        zoom: 12,
                        duration: 800
                    });
                    addOrUpdateSearchMarker(lat, lon, name);
                }
                closeSearchDropdown();
                document.getElementById('ocean-search-input').value = name;
            });
        });
    }

    /**
     * 검색 결과 위치에 마커 + 라벨을 표시한다.
     *
     * [역할]
     *  사용자가 위치 검색 드롭다운에서 항목을 클릭했을 때, 지도 이동 직후
     *  그 좌표 위에 빨간 점(중심 6px) + 흰 원(10px) + 반투명 외곽 원(14px)
     *  3겹 마커를 그리고, 위쪽에 장소 이름 라벨(빨간 배경)을 함께 표시한다.
     *  조석정보 탭(tide.js) 의 검색 결과 마커와 동일한 시각/패턴이다.
     *
     * [동작 방식]
     *  - 첫 호출 시: ol.layer.Vector + ol.source.Vector 를 1회 생성하고
     *    style 함수에서 3겹 Circle + Text 를 반환하도록 정의한 뒤
     *    oceanMap 에 addLayer 한다.
     *  - 이후 호출 시: 기존 source.clear() 로 이전 마커를 지우고 새 Feature
     *    1개를 추가한다 → 항상 마커 1개만 유지된다.
     *
     * [연계]
     *  - 호출처: showSearchResults 의 항목 클릭 핸들러
     *  - 모델: tide.js 657-707 의 searchResultLayer 패턴
     *
     * @param {number} lat   위도
     * @param {number} lon   경도
     * @param {string} name  마커 위에 표시할 장소 이름
     */
    function addOrUpdateSearchMarker(lat, lon, name) {
        if (!oceanMap) return;
        var coord = ol.proj.fromLonLat([lon, lat]);

        if (!searchResultLayer) {
            searchResultLayer = new ol.layer.Vector({
                source: new ol.source.Vector(),
                zIndex: 900,
                style: function (feature) {
                    var label = feature.get('name') || '';
                    return [
                        new ol.style.Style({
                            image: new ol.style.Circle({
                                radius: 14,
                                fill: new ol.style.Fill({ color: 'rgba(255, 80, 80, 0.15)' })
                            })
                        }),
                        new ol.style.Style({
                            image: new ol.style.Circle({
                                radius: 10,
                                fill: new ol.style.Fill({ color: '#ffffff' }),
                                stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.08)', width: 1 })
                            })
                        }),
                        new ol.style.Style({
                            image: new ol.style.Circle({
                                radius: 6,
                                fill: new ol.style.Fill({ color: '#ff4444' })
                            }),
                            text: new ol.style.Text({
                                text: label,
                                offsetY: -22,
                                font: 'bold 12px sans-serif',
                                fill: new ol.style.Fill({ color: '#ffffff' }),
                                backgroundFill: new ol.style.Fill({ color: 'rgba(255,68,68,0.85)' }),
                                padding: [2, 6, 2, 6],
                                backgroundStroke: new ol.style.Stroke({ color: 'rgba(255,68,68,0.9)', width: 1 })
                            })
                        })
                    ];
                }
            });
            oceanMap.addLayer(searchResultLayer);
        }

        var source = searchResultLayer.getSource();
        source.clear();
        var feature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
        feature.set('name', name);
        source.addFeature(feature);
    }

    function closeSearchDropdown() {
        const dropdown = document.getElementById('ocean-search-dropdown');
        if (dropdown) dropdown.style.display = 'none';
    }

    // ========================================================================
    // 내 위치
    // ========================================================================

    function goToMyLocation() {
        if (!navigator.geolocation) return;

        navigator.geolocation.getCurrentPosition(
            function (pos) {
                if (oceanMap) {
                    oceanMap.getView().animate({
                        center: ol.proj.fromLonLat([pos.coords.longitude, pos.coords.latitude]),
                        zoom: 12,
                        duration: 800
                    });
                }
            },
            function () {
                console.warn('[OceanMap] 위치 정보를 가져올 수 없습니다.');
            },
            { enableHighAccuracy: true, timeout: 5000 }
        );
    }

    // ========================================================================
    // 외부 인터페이스
    // ========================================================================

    window.getOceanMap = function () { return oceanMap; };

})();
