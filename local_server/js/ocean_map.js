/**
 * ============================================================================
 * 파일명: js/ocean_map.js
 * 역할: 해양종합정보 지도 초기화 + 모드 전환 + 기본 인터랙션
 * ============================================================================
 *
 * [설명]
 * 해양종합정보 히든 탭의 OpenLayers 지도를 초기화하고,
 * 모드 A(조석지도) / 모드 B(해양현황) 전환을 관리합니다.
 *
 * [연계 파일]
 * - index.html → #ocean-map, #ocean-map-section
 * - ocean_markers.js → 조석 마커, 클릭 처리
 * - ocean_bottom_sheet.js → 바텀시트 표시
 * - ocean_overlay.js → 캔버스 오버레이 (모드 B)
 * - ocean_timeline.js → 타임라인 슬라이더 (모드 B)
 * - js/settings.js → 히든 탭 진입 메커니즘
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상태 변수
    // ========================================================================
    let oceanMap = null;           // OpenLayers Map 인스턴스
    let currentMode = 'A';        // 현재 모드: 'A' 조석지도, 'B' 해양현황
    let baseLayerA = null;         // 모드 A 베이스맵 (해아름 RLTM3857)
    let baseLayerB = null;         // 모드 B 베이스맵 (해아름 RLTMCOAST3857)

    // 해아름 WMS 엔드포인트 (F12 캡처로 확인됨)
    // http://www.khoa.go.kr/oceanmap/{LAYER}/wmsVectordata.do?SERVICE=WMS&...
    const KHOA_WMS_BASE = 'https://www.khoa.go.kr/oceanmap/';
    const KHOA_LAYER_A = 'BASEMAP_RLTM3857';      // 조석지도용
    const KHOA_LAYER_B = 'BASEMAP_RLTMCOAST3857'; // 해양현황용

    // 한반도 남부 + 제주 → 최소 줌 레벨 6
    const DEFAULT_CENTER = [127.0, 34.5];
    const DEFAULT_ZOOM = 7;
    const MIN_ZOOM = 6;
    const MAX_ZOOM = 18;

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

        // 타일 로드 실패 시 OSM으로 자동 교체
        var tileLoadErrors = 0;
        var fallbackTriggered = false;
        var tileLayer = new ol.layer.Tile({
            source: wmsSource,
            visible: true
        });
        wmsSource.on('tileloaderror', function () {
            tileLoadErrors++;
            if (!fallbackTriggered && tileLoadErrors >= 3) {
                fallbackTriggered = true;
                console.warn('[OceanMap] 해아름 WMS 로드 실패(' + layer + '), OSM으로 전환');
                tileLayer.setSource(new ol.source.OSM());
            }
        });

        console.log('[OceanMap] 해아름 WMS 엔드포인트:', endpoint);
        return tileLayer;
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
            // 해아름 WMS 레이어 생성 (실패 시 OSM 대체)
            baseLayerA = createKhoaLayer(KHOA_LAYER_A);
            baseLayerB = createKhoaLayer(KHOA_LAYER_B);
            baseLayerB.setVisible(false);

            const layers = [baseLayerA, baseLayerB];

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

            // 뷰포트 변경 시 오버레이 갱신 (모드 B)
            oceanMap.on('moveend', function () {
                if (currentMode === 'B' && window.oceanOverlayRefresh) {
                    window.oceanOverlayRefresh(oceanMap);
                }
            });

            // 모드 전환 버튼 바인딩
            bindModeButtons();

            // 뒤로가기 버튼
            const backBtn = document.getElementById('ocean-back-btn');
            if (backBtn) {
                backBtn.addEventListener('click', function () {
                    window.switchMainTab('tide-section');
                });
            }

            // 모드 A 초기화: 마커 추가
            if (window.initOceanMarkers) {
                window.initOceanMarkers(oceanMap);
            }

            // 위치 검색 초기화
            initOceanSearch();

            // 내 위치 버튼
            const myLocBtn = document.getElementById('ocean-myloc-btn');
            if (myLocBtn) {
                myLocBtn.addEventListener('click', goToMyLocation);
            }

            console.log('[OceanMap] 지도 초기화 완료 (해아름 WMS)');
        } catch (error) {
            console.error('[OceanMap] 초기화 오류:', error);
        }
    }

    // ========================================================================
    // 모드 전환
    // ========================================================================

    function bindModeButtons() {
        const btnA = document.getElementById('ocean-mode-a-btn');
        const btnB = document.getElementById('ocean-mode-b-btn');

        if (btnA) btnA.addEventListener('click', () => switchMode('A'));
        if (btnB) btnB.addEventListener('click', () => switchMode('B'));
    }

    function switchMode(mode) {
        if (mode === currentMode) return;
        currentMode = mode;

        const btnA = document.getElementById('ocean-mode-a-btn');
        const btnB = document.getElementById('ocean-mode-b-btn');
        const searchContainer = document.getElementById('ocean-search-container');
        const overlayControls = document.getElementById('ocean-overlay-controls');
        const timeline = document.getElementById('ocean-timeline');
        const legend = document.getElementById('ocean-legend');
        const canvas = document.getElementById('ocean-overlay-canvas');

        if (mode === 'A') {
            // 모드 A: 조석지도
            btnA.classList.add('active');
            btnB.classList.remove('active');

            if (searchContainer) searchContainer.style.display = '';
            if (overlayControls) overlayControls.style.display = 'none';
            if (timeline) timeline.style.display = 'none';
            if (legend) legend.style.display = 'none';
            if (canvas) canvas.style.display = 'none';

            // 베이스맵 전환
            if (baseLayerA) baseLayerA.setVisible(true);
            if (baseLayerB) baseLayerB.setVisible(false);

            // 마커 표시
            if (window.showOceanMarkers) window.showOceanMarkers(true);

            // 오버레이 정리
            if (window.oceanOverlayClear) window.oceanOverlayClear();

        } else {
            // 모드 B: 해양현황
            btnA.classList.remove('active');
            btnB.classList.add('active');

            if (searchContainer) searchContainer.style.display = 'none';
            if (overlayControls) overlayControls.style.display = '';
            if (timeline) timeline.style.display = '';
            if (legend) legend.style.display = '';
            if (canvas) canvas.style.display = '';

            // 베이스맵 전환
            if (baseLayerA) baseLayerA.setVisible(false);
            if (baseLayerB) baseLayerB.setVisible(true);

            // 마커 숨김
            if (window.showOceanMarkers) window.showOceanMarkers(false);

            // 오버레이 초기화
            if (window.oceanOverlayInit) window.oceanOverlayInit(oceanMap);

            // 타임라인 초기화
            if (window.initOceanTimeline) window.initOceanTimeline();
        }
    }

    // ========================================================================
    // 지도 클릭 처리
    // ========================================================================

    function handleMapClick(evt) {
        const coord = ol.proj.toLonLat(evt.coordinate);
        const lon = coord[0];
        const lat = coord[1];

        // 마커 클릭 확인 (모드 A)
        if (currentMode === 'A' && window.handleOceanMarkerClick) {
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

    function searchLocation(query) {
        // Kakao 장소 검색 API 사용 (tide.js와 동일 패턴)
        if (!window.kakao || !window.kakao.maps || !window.kakao.maps.services) {
            // Kakao SDK 없으면 드롭다운에 안내
            showSearchResults([{ name: 'Kakao SDK 로딩 중...', disabled: true }]);
            return;
        }

        const ps = new kakao.maps.services.Places();
        ps.keywordSearch(query, function (data, status) {
            if (status === kakao.maps.services.Status.OK && data.length > 0) {
                const results = data.slice(0, 5).map(item => ({
                    name: item.place_name,
                    address: item.address_name,
                    lat: parseFloat(item.y),
                    lon: parseFloat(item.x)
                }));
                showSearchResults(results);
            } else {
                showSearchResults([{ name: '검색 결과 없음', disabled: true }]);
            }
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
                if (oceanMap) {
                    oceanMap.getView().animate({
                        center: ol.proj.fromLonLat([lon, lat]),
                        zoom: 12,
                        duration: 800
                    });
                }
                closeSearchDropdown();
                document.getElementById('ocean-search-input').value = this.querySelector('strong').textContent;
            });
        });
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
    window.getOceanMode = function () { return currentMode; };
    // [임시 stub] Step 1에서 oceanCurrentDate 변수와 날짜 네비게이션을 제거했지만,
    //  ocean_bottom_sheet.js가 Step 4에서 새 구조로 교체될 때까지 임시 호환층을 유지함.
    //  Step 4 완료 후 이 함수는 제거 예정.
    window.getOceanDate = function () { return new Date(); };

})();
