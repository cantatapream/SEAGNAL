// ====================================================================
// cctv2.js — 지도 초기화
//
// [역할]
//   OpenLayers 지도를 #cctv-map 컨테이너에 초기화합니다.
//   최초 1회만 생성하고, 이후 탭 재진입 시 updateSize()만 호출합니다.
//
// [연계]
//   - cctv3.js  addCctvMarkers()     — initCctvMap() 내부에서 호출
//   - cctv4.js  handleCctvMapClick() — initCctvMap() 내부에서 클릭 이벤트 등록
//   - cctv6.js  CctvFavorites.init() — initCctvMap() 내부에서 즐겨찾기 초기화
//   - cctv5.js  DOMContentLoaded     — CCTV 탭 클릭 시 initCctvMap() 호출
//   - index.html #cctv-map           — 지도 렌더링 대상 DOM
//   - OpenLayers v8.2.0 (CDN)        — ol.Map, ol.View, ol.layer.Tile 등 사용
// ====================================================================

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 전역 상태 변수
// cctv2~4.js 전체에서 공유합니다.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** OpenLayers 지도 인스턴스 (최초 1회만 생성) */
let cctvMap = null;

/** CCTV 마커 벡터 레이어 (지도 위의 아이콘 그룹) */
let cctvMarkerLayer = null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 지도 초기화
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * CCTV 지도를 초기화합니다.
 *
 * [동작 흐름]
 *   1. cctvMap이 이미 있으면 updateSize()만 호출하고 종료
 *      (탭 재진입 시 OpenLayers가 컨테이너 크기를 재계산)
 *   2. OpenStreetMap 배경 레이어 생성
 *   3. ol.Map 인스턴스 생성 (#cctv-map 컨테이너에 렌더링)
 *      - 초기 뷰: 한반도 해안 전체 (중심 128.0°E / 36.0°N, zoom 6)
 *   4. 마커 추가 (addCctvMarkers — cctv3.js)
 *   5. 즐겨찾기 초기화 (CctvFavorites.init — cctv6.js)
 *   6. 마우스 호버 커서 변경 (pointermove)
 *   7. 마커 클릭 이벤트 등록 (handleCctvMapClick — cctv4.js)
 *
 * [연계]
 *   - cctv5.js DOMContentLoaded — CCTV 탭 클릭 시 이 함수 호출
 *   - #cctv-map (index.html)    — 지도가 그려질 DOM 컨테이너
 */
function initCctvMap() {
    // ① 이미 초기화된 경우: 크기 갱신만 하고 종료
    //    (탭이 숨겨진 상태에서 OpenLayers가 크기를 0으로 인식할 수 있으므로 필요)
    if (cctvMap) {
        cctvMap.updateSize();
        return;
    }

    // ② 지도 컨테이너 DOM 요소 확인
    const mapEl = document.getElementById('cctv-map');
    if (!mapEl) return;

    try {
        // ③ OpenStreetMap 배경 레이어
        const baseLayer = new ol.layer.Tile({
            source: new ol.source.OSM()
        });

        // ④ 지도 생성
        //    - 초기 중심 좌표: 경도 128.0°, 위도 36.0° (한반도 중부 해안)
        //    - zoom 6: 독도(동) ~ 이어도(남) ~ 소청초(서) 전체가 한 화면에 보임
        cctvMap = new ol.Map({
            target: 'cctv-map',
            layers: [baseLayer],
            view: new ol.View({
                center: ol.proj.fromLonLat([128.0, 36.0]),
                zoom: 6,
                minZoom: 5,
                maxZoom: 18
            })
        });

        // ⑤ CCTV 마커 지도에 추가 (cctv3.js)
        addCctvMarkers();

        // ⑥ 즐겨찾기 초기화 (localStorage 로드 + 지도 오른쪽 버튼 목록 렌더링)
        //    CctvFavorites는 cctv6.js에 정의됨
        if (window.CctvFavorites) {
            CctvFavorites.init();
        }

        // ⑦ 마커 위에 마우스 올릴 때 포인터 커서로 변경
        //    (클릭 가능하다는 시각적 피드백)
        cctvMap.on('pointermove', function (e) {
            const hit = cctvMap.hasFeatureAtPixel(e.pixel);
            cctvMap.getTargetElement().style.cursor = hit ? 'pointer' : '';
        });

        // ⑧ 마커/지도 클릭 이벤트 등록 (cctv4.js)
        cctvMap.on('singleclick', handleCctvMapClick);

    } catch (err) {
        console.error('[CCTV] 지도 초기화 오류:', err);
    }
}
