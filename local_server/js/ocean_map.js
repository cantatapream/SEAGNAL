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

    // 해아름 API 키
    const KHOA_KEY = 'FEEFEC76EEBF0FA3676CDCFE6';
    // 해아름 스크립트가 반환하는 타일 기본 URL (스크립트 로드 후 채워짐)
    let khoaTileUrlA = null;  // BASEMAP_RLTM3857 (조석지도용)
    let khoaTileUrlB = null;  // BASEMAP_RLTMCOAST3857 (해양현황용)

    // 한반도 남부 + 제주 → 최소 줌 레벨 6
    const DEFAULT_CENTER = [127.0, 34.5];
    const DEFAULT_ZOOM = 7;
    const MIN_ZOOM = 6;
    const MAX_ZOOM = 18;

    // ========================================================================
    // 해아름 타일 로드
    // ========================================================================

    /**
     * 해아름 스크립트를 브라우저에서 직접 로드합니다.
     *
     * [동작 방식]
     * KHOA는 지도 타일을 바로 주는 게 아니라,
     * "이 주소로 오면 지도 줄게" 라는 URL을 스크립트 형태로 알려줍니다.
     * 브라우저가 직접 이 스크립트를 받아서 _vectorMapUrl 변수에 저장합니다.
     *
     * [예시]
     * 스크립트 로드 → var _vectorMapUrl = 'https://www.khoa.go.kr/...'
     *              → 이 URL로 지도 사진 조각(타일)을 요청
     *
     * @param {string} layer - 레이어명 (BASEMAP_RLTM3857 등)
     * @returns {Promise<string|null>} 타일 기본 URL 또는 null
     */
    function loadKhoaScript(layer) {
        return new Promise(function (resolve) {
            var script = document.createElement('script');
            script.src = 'https://www.khoa.go.kr/oceanmap/' + layer +
                '/otmsSSLVectormapApi.do?ServiceKey=' + KHOA_KEY + '&version=2';

            script.onload = function () {
                // 스크립트가 window._vectorMapUrl 변수에 URL을 담아줌
                var url = window._vectorMapUrl || null;
                window._vectorMapUrl = null; // 다음 스크립트를 위해 초기화
                console.log('[OceanMap] 해아름 타일 URL(' + layer + '):', url);
                resolve(url);
            };

            script.onerror = function () {
                console.warn('[OceanMap] 해아름 스크립트 로드 실패:', layer);
                resolve(null);
            };

            document.head.appendChild(script);
        });
    }

    /**
     * 해아름 타일 URL로 OpenLayers 레이어를 만듭니다.
     * 실패 시 OSM으로 대체합니다.
     *
     * @param {string|null} tileUrl - loadKhoaScript()가 반환한 URL
     * @returns {ol.layer.Tile}
     */
    function createKhoaLayer(tileUrl) {
        if (tileUrl) {
            // 해아름 타일 URL 형식: 기본URL + &z={z}&x={x}&y={y}
            // (URL에 이미 ?ServiceKey=... 가 있으므로 &로 추가)
            var xyzSource = new ol.source.XYZ({
                url: tileUrl + '&z={z}&x={x}&y={y}',
                maxZoom: 18,
                attributions: '&copy; <a href="https://www.khoa.go.kr">국립해양조사원</a>'
            });

            // 타일 로드 실패 시 OSM으로 자동 교체
            var tileLoadErrors = 0;
            xyzSource.on('tileloaderror', function () {
                tileLoadErrors++;
                // 3번 연속 실패하면 OSM으로 전환
                if (tileLoadErrors === 3) {
                    console.warn('[OceanMap] 해아름 타일 로드 실패, OSM으로 자동 전환');
                    xyzSource.setUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
                }
            });

            return new ol.layer.Tile({
                source: xyzSource,
                visible: true
            });
        }

        // 해아름 URL 자체를 못 받은 경우 OSM으로 대체
        console.warn('[OceanMap] 해아름 타일 없음, OSM으로 대체');
        return new ol.layer.Tile({
            source: new ol.source.OSM(),
            visible: true
        });
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

        // 해아름 스크립트 2개를 순서대로 로드한 뒤 지도 초기화
        // (A 로드 후 B 로드 → 순서 보장)
        loadKhoaScript('BASEMAP_RLTM3857').then(function (urlA) {
            khoaTileUrlA = urlA;
            return loadKhoaScript('BASEMAP_RLTMCOAST3857');
        }).then(function (urlB) {
            khoaTileUrlB = urlB;
            buildMap();
        }).catch(function () {
            // 스크립트 로드 자체가 실패해도 OSM으로 지도 표시
            buildMap();
        });
    };

    /**
     * 실제 지도를 생성하는 함수.
     * 해아름 URL 확보 후 호출됩니다.
     */
    function buildMap() {
        try {
            // 해아름 타일로 레이어 생성 (실패 시 OSM 대체)
            baseLayerA = createKhoaLayer(khoaTileUrlA);
            baseLayerB = createKhoaLayer(khoaTileUrlB);
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

            // 날짜 네비게이션 초기화
            initDateNav();

            // 위치 검색 초기화
            initOceanSearch();

            // 내 위치 버튼
            const myLocBtn = document.getElementById('ocean-myloc-btn');
            if (myLocBtn) {
                myLocBtn.addEventListener('click', goToMyLocation);
            }

            console.log('[OceanMap] 지도 초기화 완료 (해아름 타일:', khoaTileUrlA ? '성공' : 'OSM 대체', ')');
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
        const dateNav = document.getElementById('ocean-date-nav');
        const searchContainer = document.getElementById('ocean-search-container');
        const overlayControls = document.getElementById('ocean-overlay-controls');
        const timeline = document.getElementById('ocean-timeline');
        const legend = document.getElementById('ocean-legend');
        const canvas = document.getElementById('ocean-overlay-canvas');

        if (mode === 'A') {
            // 모드 A: 조석지도
            btnA.classList.add('active');
            btnB.classList.remove('active');

            if (dateNav) dateNav.style.display = '';
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

            if (dateNav) dateNav.style.display = 'none';
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
    // 날짜 네비게이션 (모드 A)
    // ========================================================================

    let oceanCurrentDate = new Date();

    function initDateNav() {
        const prevBtn = document.getElementById('ocean-prev-date');
        const nextBtn = document.getElementById('ocean-next-date');

        if (prevBtn) prevBtn.addEventListener('click', () => changeDate(-1));
        if (nextBtn) nextBtn.addEventListener('click', () => changeDate(1));

        updateDateDisplay();
    }

    function changeDate(delta) {
        oceanCurrentDate.setDate(oceanCurrentDate.getDate() + delta);
        updateDateDisplay();
    }

    function updateDateDisplay() {
        const el = document.getElementById('ocean-solar-date');
        if (!el) return;

        const d = oceanCurrentDate;
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        el.textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일(${days[d.getDay()]})`;
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
    window.getOceanDate = function () { return oceanCurrentDate; };

})();
