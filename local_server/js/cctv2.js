// ====================================================================
// cctv2.js — SVG 아이콘 생성 + 지도 초기화
//
// [역할]
//   1. 감시카메라(CCTV) 형태의 SVG 마커 아이콘을 동적으로 생성합니다.
//   2. OpenLayers 지도를 #cctv-map 컨테이너에 초기화합니다.
//      (최초 1회만 생성, 이후 탭 재진입 시 updateSize()만 호출)
//
// [연계]
//   - cctv1.js  CCTV_PROVIDERS       — color 값 참조
//   - cctv3.js  addCctvMarkers()     — initCctvMap() 내부에서 호출
//   - cctv4.js  handleCctvMapClick() — initCctvMap() 내부에서 클릭 이벤트 등록
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
// SVG 아이콘 생성 유틸리티
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 16진수 색상값의 명도를 조절합니다.
 * [사용처] createCctvIconSvg() — 아이콘 테두리 색상을 본 색상보다 어둡게 만들 때 사용
 *
 * @param {string} hex    — '#rrggbb' 형태의 색상값 (예: '#1565c0')
 * @param {number} amount — 양수: 밝게, 음수: 어둡게 (예: -40이면 각 채널 -40)
 * @returns {string} — 조절된 '#rrggbb' 색상값
 */
function cctvShadeColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
    const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * 감시카메라(CCTV) 형태의 SVG 아이콘 data URI를 생성합니다.
 *
 * 아이콘 구조 (측면도):
 *   ╭──────────────╮
 *   │  본체(body)  │━━━● ← 렌즈(lens)
 *   ╰──────────────╯
 *         │  ← 마운트 폴(mount)
 *      ═══════  ← 베이스 플레이트(base)
 *
 * [사용처] cctv3.js addCctvMarkers() — ol.style.Icon의 src 속성에 사용
 *
 * @param {string} color — 아이콘 채우기 색상 (예: '#1565c0')
 * @returns {string}     — OpenLayers ol.style.Icon src에 바로 사용 가능한 data URI
 */
function createCctvIconSvg(color) {
    // 테두리 색상: 본 색상보다 40 어둡게
    const stroke = cctvShadeColor(color, -40);

    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 34" width="44" height="34">',

        // 카메라 본체 (좌측 둥근 사각형)
        `<rect x="1" y="7" width="24" height="14" rx="3"`,
        ` fill="${color}" stroke="${stroke}" stroke-width="1.5"/>`,

        // 렌즈 배럴 (본체 우측에 연결된 원통형 부분)
        `<rect x="25" y="10.5" width="12" height="7" rx="2"`,
        ` fill="${color}" stroke="${stroke}" stroke-width="1.5"/>`,

        // 렌즈 유리 (어두운 원 — 카메라 렌즈 표현)
        `<circle cx="39" cy="14" r="3.2"`,
        ` fill="#071831" stroke="${stroke}" stroke-width="1"/>`,

        // 렌즈 하이라이트 (반사광 느낌의 작은 흰 원)
        `<circle cx="38.1" cy="13.1" r="1"`,
        ` fill="rgba(255,255,255,0.45)"/>`,

        // 마운트 폴 (카메라를 지지하는 수직 기둥)
        `<rect x="10" y="21" width="4" height="8" rx="1"`,
        ` fill="${color}" stroke="${stroke}" stroke-width="1"/>`,

        // 베이스 플레이트 (벽/기둥 부착 부분)
        `<rect x="6" y="28" width="12" height="4" rx="2"`,
        ` fill="${color}" stroke="${stroke}" stroke-width="1.5"/>`,

        '</svg>'
    ].join('');

    // OpenLayers Icon src에 바로 사용할 수 있도록 data URI 형태로 반환
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

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
 *   5. 마우스 호버 커서 변경 (pointermove)
 *   6. 마커 클릭 이벤트 등록 (handleCctvMapClick — cctv4.js)
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

        // ⑥ 마커 위에 마우스 올릴 때 포인터 커서로 변경
        //    (클릭 가능하다는 시각적 피드백)
        cctvMap.on('pointermove', function (e) {
            const hit = cctvMap.hasFeatureAtPixel(e.pixel);
            cctvMap.getTargetElement().style.cursor = hit ? 'pointer' : '';
        });

        // ⑦ 마커/지도 클릭 이벤트 등록 (cctv4.js)
        cctvMap.on('singleclick', handleCctvMapClick);

    } catch (err) {
        console.error('[CCTV] 지도 초기화 오류:', err);
    }
}
