/**
 * ============================================================================
 * 파일명: js/ocean_buoy.js
 * 역할: 해양종합 지도 – 기상부이 + 주요지명 격자 샘플링 레이어 (INDEX2 전용)
 * ============================================================================
 *
 * [설명]
 * INDEX2 해양종합 지도에서 기상부이와 주요지명(조석표준항) 마커를
 * "격자 기반 공간 분산 샘플링"으로 표시합니다.
 *
 * [샘플링 방식 — 종전 클러스터링 대체]
 *   - 종전: ol.source.Cluster 로 가까운 마커를 묶어 숫자 원형(2,9,18…)으로 표시.
 *           멀리서 볼 때 시각적으로 지저분하고 한쪽에 몰리는 문제.
 *   - 신규: 현재 뷰포트(보이는 영역)를 "화면 픽셀 단위" 격자로 나눠, 각 셀에서
 *           우선순위(부이 > 주요지점 > CCTV) 정렬 후 cellBudget 만큼 뽑아
 *           화면 전체에 골고루 분산 표시. 줌 인 할수록 격자가 작아져 더 많이 등장.
 *   - 픽셀 격자 채택 이유: 위경도(deg) 격자는 메르카토르 투영에서 위도에 따라
 *           화면상 칸 크기가 달라져 균일성이 깨짐. 픽셀 격자는 화면 어디서든
 *           동일한 정사각형 망이라 시각적으로 정확히 균일한 분산을 보장.
 *
 * [공유 격자 — CCTV 와 통합]
 *   3종 마커(부이 / 주요지점 / CCTV)가 "동일한 격자 칸"에서 함께 경쟁해야
 *   한쪽 몰림 없이 골고루 분산됨. 이를 위해 window.OceanGridSampler 라는
 *   공통 모듈을 이 파일에서 구현하고, ocean_cctv.js 는 CCTV 피처만 등록.
 *
 * [토글 동작]
 *   - 기상부이 / 주요지점 / CCTV 토글은 각각 "이 타입의 피처가 후보 풀에
 *     들어가느냐"를 결정함. 켜진 타입들끼리 같은 격자 칸에서 경쟁.
 *
 * [클릭 처리]
 *   - 격자 샘플링된 결과는 _vectorSource(부이/지명) 또는 별도 소스(CCTV)에
 *     실제 피처로 들어가므로, forEachFeatureAtPixel 으로 단일 피처를 정확히
 *     hit 할 수 있음. 클러스터 줌인 핸들러는 제거됨.
 *
 * [로드 순서] ocean_markers.js 이후, ocean_cctv.js 이전 권장
 *
 * [연계 파일]
 * - buoyLocations.js → BUOY_LOCATIONS, BUOY_TYPE_NAMES
 * - tide.js → stationData (조석 표준항 목록)
 * - seaZones.js → showBuoyModal()
 * - ocean_markers.js → 원본 마커 레이어 (이 파일이 대체)
 * - ocean_map.js → initOceanBuoys 호출, handleOceanBuoyClick 사용
 * - ocean_cctv.js → window.OceanGridSampler 에 'cctv' 타입 피처 등록
 * ============================================================================
 */

// INDEX2에서만 실행
if (window.__SEAGNAL_PAGE === 'index2') {

(function () {
    'use strict';

    // ========================================================================
    // 상태 변수
    // ========================================================================
    var _map = null;
    var _vectorSource = null;     // 격자 샘플링 결과(부이/지명) 피처 소스
    var _layer = null;            // 부이/지명 표시 레이어
    var _buoyFeatures = [];       // 부이 후보 피처 배열 (전부)
    var _stationFeatures = [];    // 주요지명 후보 피처 배열 (전부)
    var _buoysVisible = false;
    var _stationsVisible = false;
    var _origShowOceanMarkers = null;

    // ========================================================================
    // 격자 샘플링 파라미터 — 픽셀 단위 뷰포트 격자
    // ========================================================================
    //
    // [정책]
    //  - 줌이 낮을수록 큰 격자(px) + 작은 cellBudget → 화면에 골고루 듬성듬성
    //  - 줌이 높을수록 작은 격자(px) + 큰 cellBudget → 점점 더 많이 등장
    //  - 줌 15 이상은 모든 마커 표시 (격자 없이 통과)
    //
    // [격자 좌표계 — 지도 고정(월드 좌표) 격자]
    //  - cellPx 는 "화면상 칸 크기(px)" 를 뜻하지만, 실제 격자 인덱스는
    //    지도 투영 좌표(EPSG:3857, 미터)로 계산한다: cellMeters = cellPx * resolution.
    //  - 이렇게 하면 같은 줌(resolution 고정)에서 격자 원점이 지도에 박혀 있어
    //    화면을 팬해도 각 마커가 항상 같은 칸에 속한다 → 선택 결과가 안정적이라
    //    "있던 마커가 갑자기 사라지거나 나타나는" 현상이 없다.
    //  - 픽셀 좌표로 격자를 만들면 격자가 뷰포트에 고정되어 팬할 때 지도 위에서
    //    격자가 움직이고, 같은 마커가 칸을 옮겨다니며 선택/탈락이 바뀐다(=깜빡임).
    //  - 메르카토르 왜곡: 같은 줌에서는 화면상 미터/픽셀 비율(resolution)이 일정해
    //    cellMeters 가 화면상 cellPx 크기를 그대로 유지하므로 화면 균일성도 보존된다.
    //
    // [cellBudget]
    //  같은 셀에 떨어진 마커 중 최대 몇 개를 표시할지. 부이+지명+CCTV 합산.
    //  3개 토글 모두 켜진 상태에서 budget 2 이면 한 셀에 두 개 마커 공존 가능.
    // [사용자 지정 파라미터 — 라운드로빈 분배와 합쳐 한 셀에서 최대 budget 개]
    //   줌 15+ : 제한 없음 — 모두 표시 (cellPx=0)
    //   줌 12~14 : cellPx 70,  budget 3
    //   줌 9~11  : cellPx 100, budget 2
    //   줌 5~8   : cellPx 150, budget 1
    //   줌 0~4   : cellPx 150, budget 1 (저줌 fallback)
    var GRID_TABLE = [
        // { zoomMin, cellPx, cellBudget }
        { zoomMin: 15, cellPx: 0,   cellBudget: Infinity },
        { zoomMin: 12, cellPx: 70,  cellBudget: 3 },
        { zoomMin: 9,  cellPx: 100, cellBudget: 2 },
        { zoomMin: 5,  cellPx: 150, cellBudget: 1 },
        { zoomMin: 0,  cellPx: 150, cellBudget: 1 }
    ];

    function _gridParamsForZoom(zoom) {
        for (var i = 0; i < GRID_TABLE.length; i++) {
            if (zoom >= GRID_TABLE[i].zoomMin) return GRID_TABLE[i];
        }
        return GRID_TABLE[GRID_TABLE.length - 1];
    }

    // 마커 타입별 우선순위 / 라운드로빈 순서
    //   index 0 부터 차례로 라운드로빈 됨. 한 슬롯에서 빈 타입은 자동으로
    //   다음 타입에게 양보(=우선순위 fallback) 되므로 이 배열 순서 자체가
    //   "슬롯 부족 시 어떤 타입이 더 우선 선택되는가" 의 의미도 가짐.
    //   1: 기상부이 → 2: 주요지점 → 3: CCTV
    var TYPE_ORDER = ['buoy', 'station', 'cctv'];

    // ========================================================================
    // 부이 아이콘 SVG (seaZones.js BUOY_SVG와 동일)
    // ========================================================================
    var BUOY_ICON_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
        '<g>' +
        '<path d="M20 70 Q 50 85 80 70 L 80 60 L 20 60 Z" fill="#FDD835" stroke="#000" stroke-width="3"/>' +
        '<ellipse cx="50" cy="60" rx="30" ry="10" fill="#FFEB3B" stroke="#000" stroke-width="2"/>' +
        '<rect x="45" y="30" width="10" height="30" fill="#FBC02D" stroke="#000" stroke-width="2"/>' +
        '<rect x="40" y="30" width="20" height="5" fill="#F57F17" stroke="#000" stroke-width="2"/>' +
        '<circle cx="50" cy="25" r="5" fill="#F44336" stroke="#000" stroke-width="2"/>' +
        '<path d="M50 25 L 60 15 M 50 25 L 40 15" stroke="#000" stroke-width="2"/>' +
        '<rect x="25" y="50" width="12" height="8" fill="#1E88E5" stroke="#000" stroke-width="1" transform="rotate(-10 25 50)"/>' +
        '<rect x="63" y="50" width="12" height="8" fill="#1E88E5" stroke="#000" stroke-width="1" transform="rotate(10 63 50)"/>' +
        '</g></svg>'
    );

    // ========================================================================
    // 피처 생성 (전체 후보 — 1회만 생성)
    // ========================================================================

    /** BUOY_LOCATIONS 데이터로 부이 피처 생성 */
    function createBuoyFeatures() {
        if (typeof BUOY_LOCATIONS === 'undefined') return [];
        var features = [];
        var keys = Object.keys(BUOY_LOCATIONS);
        for (var i = 0; i < keys.length; i++) {
            var id = keys[i];
            var buoy = BUOY_LOCATIONS[id];
            // [좌표 가드] CCTV _buildFeatures() 와 일관성 — lat/lon 이 숫자가
            // 아니거나 NaN 이면 잘못된 좌표(0,0 부근)에 마커가 찍히는 것을 방지
            if (typeof buoy.lat !== 'number' || typeof buoy.lon !== 'number' || isNaN(buoy.lat) || isNaN(buoy.lon)) continue;
            var feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([buoy.lon, buoy.lat])),
                markerType: 'buoy',
                _sampleType: 'buoy',
                _sampleLat: buoy.lat,
                _sampleLon: buoy.lon,
                buoyId: id,
                buoyName: buoy.name,
                buoyType: buoy.type,
                buoyLat: buoy.lat,
                buoyLon: buoy.lon
            });
            features.push(feature);
        }
        return features;
    }

    /** stationData(tide.js)로 조석 표준항 피처 생성 */
    function createStationFeatures() {
        if (typeof stationData === 'undefined' || !stationData) return [];
        var features = [];
        for (var i = 0; i < stationData.length; i++) {
            var station = stationData[i];
            // [좌표 가드] CCTV _buildFeatures() 와 일관성 — lat/lon 이 숫자가
            // 아니거나 NaN 이면 잘못된 좌표(0,0 부근)에 마커가 찍히는 것을 방지
            if (typeof station.lat !== 'number' || typeof station.lon !== 'number' || isNaN(station.lat) || isNaN(station.lon)) continue;
            var feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([station.lon, station.lat])),
                markerType: 'station',
                _sampleType: 'station',
                _sampleLat: station.lat,
                _sampleLon: station.lon,
                stationName: station.name,
                stationCode: station.code,
                stationLat: station.lat,
                stationLon: station.lon,
                type: 'tide-station'
            });
            features.push(feature);
        }
        return features;
    }

    // ========================================================================
    // 스타일 함수 (단일 피처용 — 클러스터 스타일 제거됨)
    // ========================================================================

    function getBuoyStyle(feature, zoom) {
        var scale = zoom >= 10 ? 0.525 : zoom >= 8 ? 0.45 : 0.375;
        var name = feature.get('buoyName');
        var styles = [
            // 모바일 히트 영역 확장용 투명 원 (사용자가 부이 옆을 탭해도 잡힘)
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 20,
                    fill: new ol.style.Fill({ color: 'rgba(0,0,0,0.01)' })
                })
            }),
            new ol.style.Style({
                image: new ol.style.Icon({
                    src: BUOY_ICON_SVG,
                    scale: scale,
                    anchor: [0.5, 0.8]
                })
            })
        ];
        if (zoom >= 8) {
            var fontSize = zoom >= 10 ? '13px' : '12px';
            styles.push(new ol.style.Style({
                text: new ol.style.Text({
                    text: name,
                    font: 'bold ' + fontSize + ' "Pretendard", sans-serif',
                    fill: new ol.style.Fill({ color: '#FDD835' }),
                    stroke: new ol.style.Stroke({ color: '#000', width: 3 }),
                    offsetY: -36,
                    textAlign: 'center'
                })
            }));
        }
        return styles;
    }

    function getStationStyle(feature, zoom) {
        var name = feature.get('stationName');
        var radius = zoom >= 10 ? 6 : zoom >= 8 ? 5 : 4;
        var styles = [
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: radius + 2,
                    fill: new ol.style.Fill({ color: 'rgba(255,255,255,0.9)' }),
                    stroke: new ol.style.Stroke({ color: '#1a73e8', width: 1.5 })
                })
            }),
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: radius,
                    fill: new ol.style.Fill({ color: '#1a73e8' })
                })
            })
        ];
        if (zoom >= 8) {
            var fontSize = zoom >= 10 ? '11px' : '10px';
            styles.push(new ol.style.Style({
                text: new ol.style.Text({
                    text: name,
                    font: 'bold ' + fontSize + ' "Pretendard", sans-serif',
                    fill: new ol.style.Fill({ color: '#1a237e' }),
                    stroke: new ol.style.Stroke({ color: '#fff', width: 3 }),
                    offsetY: -16,
                    textAlign: 'center'
                })
            }));
        }
        return styles;
    }

    /** 레이어 스타일 함수 — 피처 타입에 따라 분기 */
    function layerStyleFunction(feature) {
        var zoom = _map.getView().getZoom();
        if (feature.get('markerType') === 'buoy') {
            return getBuoyStyle(feature, zoom);
        }
        return getStationStyle(feature, zoom);
    }

    // ========================================================================
    // 격자 샘플링 코어 — window.OceanGridSampler
    // ========================================================================
    //
    // 외부 등록자가 type 별로 피처 배열 + visible 플래그를 제공하면,
    // 현재 뷰포트 + 줌에 맞춰 격자 샘플링한 결과를 각 type 의 sink(소스)에 반영.
    //
    // [등록 API]
    //   OceanGridSampler.register({
    //     type:    'buoy' | 'station' | 'cctv',
    //     getAll:  () => Feature[],   // 전체 후보
    //     getVisible: () => boolean,  // 토글 상태
    //     sink:    ol.source.Vector   // 샘플링 결과를 받을 소스
    //   })
    //   OceanGridSampler.attach(map)
    //   OceanGridSampler.refresh()  // 외부에서 토글 변경 시 즉시 재샘플링
    //
    var _samplerRegistry = [];      // [{type, getAll, getVisible, sink}]
    var _samplerMap = null;
    var _samplerScheduled = false;
    var _sizeRetryCount = 0;        // [0,0] size 재시도 횟수 (무한 폴링 방지)
    var _SIZE_RETRY_MAX = 30;       // 30회 * 200ms = 6초 후 포기

    function _scheduleSample() {
        if (_samplerScheduled) return;
        _samplerScheduled = true;
        // 다음 프레임에 모아서 한 번만 (moveend + 토글 변경이 연속될 때 중복 방지)
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(_doSample);
        } else {
            setTimeout(_doSample, 16);
        }
    }

    function _doSample() {
        _samplerScheduled = false;
        if (!_samplerMap) return;
        var view = _samplerMap.getView();
        var zoom = view.getZoom();
        var resolution = view.getResolution();
        var params = _gridParamsForZoom(zoom);

        // 지도가 아직 준비되지 않으면(해상도 없음) 잠시 후 재시도.
        // [무한 재호출 방지] 비활성 탭(display:none) 등으로 영구히 준비 안 되는
        // 케이스 대비: 최대 _SIZE_RETRY_MAX 회(200ms 간격, 약 6초)만 재시도하고
        // 포기. 이후 moveend / change:resolution / 토글 이벤트로 자동 재개됨.
        if (typeof zoom !== 'number' || !resolution) {
            if (_sizeRetryCount < _SIZE_RETRY_MAX) {
                _sizeRetryCount++;
                setTimeout(_scheduleSample, 200);
            }
            return;
        }
        _sizeRetryCount = 0;

        // 1. visible 한 전체 후보를 한 풀로 모음 (뷰포트 클리핑 없음)
        //    [중요] 격자 선택을 "지도 전체" 기준으로 확정해야, 같은 줌에서
        //    화면을 팬할 때 마커가 사라지거나 새로 나타나지 않는다. 화면 밖
        //    피처는 OpenLayers Vector 레이어가 알아서 렌더하지 않으므로,
        //    여기서 뷰포트로 자르지 않고 선택 결과 전체를 sink 에 넣는다.
        var pool = [];     // [{feature, coord, type}]
        for (var i = 0; i < _samplerRegistry.length; i++) {
            var entry = _samplerRegistry[i];
            if (!entry.getVisible()) continue;
            var all = entry.getAll();
            for (var k = 0; k < all.length; k++) {
                var feat = all[k];
                var geom = feat.getGeometry();
                if (!geom) continue;
                pool.push({
                    feature: feat,
                    coord: geom.getCoordinates(),   // EPSG:3857 투영 좌표(미터)
                    type: feat.get('_sampleType')
                });
            }
        }

        // 2. cellPx=0 (줌 매우 높음) 면 그대로 전부 통과
        var selected;
        if (!params.cellPx || params.cellBudget === Infinity) {
            selected = [];
            for (var p = 0; p < pool.length; p++) {
                selected.push(pool[p].feature);
            }
        } else {
            // 3. 격자 버킷에 담기 — 지도 투영 좌표(미터) 기준 셀 인덱스.
            //    cellMeters = cellPx * resolution 이라 화면상 칸 크기는
            //    cellPx(px) 그대로지만, 격자 원점이 지도(월드 좌표)에 고정되어
            //    같은 줌에서 팬해도 각 마커가 항상 같은 칸에 속한다. → 선택
            //    결과가 안정적이라 마커가 들락날락하지 않는다.
            var buckets = {};   // key "ix:iy" → [{feature, type}, ...]
            var cellMeters = params.cellPx * resolution;
            for (var j = 0; j < pool.length; j++) {
                var item = pool[j];
                var ix = Math.floor(item.coord[0] / cellMeters);
                var iy = Math.floor(item.coord[1] / cellMeters);
                var key = ix + ':' + iy;
                if (!buckets[key]) buckets[key] = [];
                buckets[key].push(item);
            }

            // 4. 라운드로빈 슬롯 분배 (핵심 알고리즘)
            //
            //    각 셀의 cellBudget 슬롯을 (buoy → station → cctv) 순으로
            //    "한 칸씩" 회전하며 채움.
            //     · 한 타입에 후보가 더 있으면 그 타입이 슬롯을 차지하고
            //       다음 슬롯은 자동으로 다음 타입 차례로 넘어감.
            //     · 한 타입에 후보가 비면 그 슬롯은 다음 우선순위 타입이
            //       양보받음 (= 우선순위 fallback).
            //     · 모든 타입의 큐가 비면 종료.
            //
            //    효과:
            //     - 한 셀에 같은 타입만 몰리지 않음(시각적 다양성).
            //     - 1개 타입만 토글 ON 이면 그 타입이 모든 슬롯을 차지.
            //     - 슬롯 부족 + 모든 타입 활성이면 우선순위(부이>지점>CCTV) 보장.
            //
            //    구현: 셀별로 타입 큐 인덱스를 따로 두고, rr 포인터를
            //    typeCount(=3) 주기로 돌리며 비어있지 않은 큐를 만나면 1개 push.
            selected = [];
            var budget = params.cellBudget;
            var bKeys = Object.keys(buckets);
            var typeCount = TYPE_ORDER.length;
            for (var b = 0; b < bKeys.length; b++) {
                var arr = buckets[bKeys[b]];
                // 타입별 큐 분리 (입력 순서 유지)
                var queues = { buoy: [], station: [], cctv: [] };
                for (var qi = 0; qi < arr.length; qi++) {
                    var item = arr[qi];
                    if (queues[item.type]) queues[item.type].push(item);
                }
                // 라운드로빈
                var idx   = { buoy: 0, station: 0, cctv: 0 };
                var filled = 0;
                var rr     = 0;
                var miss   = 0;   // 연속 빈 시도 횟수 — typeCount 도달 시 모두 빔
                while (filled < budget && miss < typeCount) {
                    var curType = TYPE_ORDER[rr % typeCount];
                    var q = queues[curType];
                    if (idx[curType] < q.length) {
                        selected.push(q[idx[curType]].feature);
                        idx[curType]++;
                        filled++;
                        miss = 0;
                    } else {
                        miss++;
                    }
                    rr++;
                }
            }
        }

        // 5. 타입별로 분류하여 각 sink 에 반영
        var byType = {};
        for (var s = 0; s < selected.length; s++) {
            var ty = selected[s].get('_sampleType');
            if (!byType[ty]) byType[ty] = [];
            byType[ty].push(selected[s]);
        }

        // sink 별로 자기 타입의 피처만 쓰되, 같은 sink 에 여러 타입을 합치는
        // 케이스를 지원 (부이/지명이 _vectorSource 공유) — 같은 sink 가
        // 여러 entry 에서 참조되면 그 sink 의 피처는 한 번만 clear 후 누적 add.
        var sinkBatched = []; // [{sink, feats: Feature[]}]
        function _findSinkBatch(sink) {
            for (var x = 0; x < sinkBatched.length; x++) {
                if (sinkBatched[x].sink === sink) return sinkBatched[x];
            }
            var nb = { sink: sink, feats: [] };
            sinkBatched.push(nb);
            return nb;
        }
        for (var r = 0; r < _samplerRegistry.length; r++) {
            var reg = _samplerRegistry[r];
            if (!reg.sink) continue;
            var feats = (reg.getVisible() && byType[reg.type]) ? byType[reg.type] : [];
            var batch = _findSinkBatch(reg.sink);
            for (var f = 0; f < feats.length; f++) batch.feats.push(feats[f]);
        }
        for (var y = 0; y < sinkBatched.length; y++) {
            sinkBatched[y].sink.clear();
            if (sinkBatched[y].feats.length > 0) {
                sinkBatched[y].sink.addFeatures(sinkBatched[y].feats);
            }
        }
    }

    window.OceanGridSampler = {
        register: function (entry) {
            if (!entry || !entry.type) return;
            // 같은 type 중복 등록 방지 (덮어쓰기)
            for (var i = 0; i < _samplerRegistry.length; i++) {
                if (_samplerRegistry[i].type === entry.type) {
                    _samplerRegistry[i] = entry;
                    _scheduleSample();
                    return;
                }
            }
            _samplerRegistry.push(entry);
            _scheduleSample();
        },
        attach: function (map) {
            if (_samplerMap === map) return;
            _samplerMap = map;
            // 뷰포트 / 줌 변경 시 재샘플링
            map.on('moveend', _scheduleSample);
            // 일부 케이스(즉시 줌 변경)에서 moveend 이전에 view 만 바뀔 수 있으므로 보조
            map.getView().on('change:resolution', _scheduleSample);
            _scheduleSample();
        },
        refresh: _scheduleSample
    };

    // ========================================================================
    // 초기화 (ocean_map.js의 buildMap에서 호출)
    // ========================================================================

    window.initOceanBuoys = function (map) {
        _map = map;

        // 피처 후보 생성 (전체)
        _buoyFeatures = createBuoyFeatures();
        _stationFeatures = createStationFeatures();

        // 표시용 벡터 소스 (샘플링 결과만 들어감)
        _vectorSource = new ol.source.Vector();

        // 레이어 — 더 이상 ol.source.Cluster 사용 안 함
        _layer = new ol.layer.Vector({
            source: _vectorSource,
            updateWhileAnimating: true,
            updateWhileInteracting: true,
            style: layerStyleFunction,
            zIndex: 130
        });

        map.addLayer(_layer);

        // 격자 샘플러에 부이 / 주요지점 등록
        window.OceanGridSampler.register({
            type: 'buoy',
            getAll: function () { return _buoyFeatures; },
            getVisible: function () { return _buoysVisible; },
            sink: _vectorSource
        });
        window.OceanGridSampler.register({
            type: 'station',
            getAll: function () { return _stationFeatures; },
            getVisible: function () { return _stationsVisible; },
            sink: _vectorSource
        });
        window.OceanGridSampler.attach(map);

        // ocean_markers.js 의 원본 함수 저장 후 오버라이드
        _origShowOceanMarkers = window.showOceanMarkers;

        // showOceanMarkers 오버라이드: 토글 후 샘플링 재계산
        window.showOceanMarkers = function (visible) {
            _stationsVisible = visible;
            if (_origShowOceanMarkers) _origShowOceanMarkers(false);
            window.OceanGridSampler.refresh();
        };

        // localStorage 에서 이전 상태 복원
        _stationsVisible = localStorage.getItem('seagnal_markers_visible') === 'true';
        if (_origShowOceanMarkers) _origShowOceanMarkers(false);

        // 부이 토글 버튼 바인딩
        bindBuoyToggle();

        // 초기 샘플링
        window.OceanGridSampler.refresh();

        console.log('[OceanBuoy] 격자 샘플링 레이어 초기화 (부이: ' + _buoyFeatures.length + ', 지명: ' + _stationFeatures.length + ')');
    };

    // ========================================================================
    // 부이 토글 버튼 바인딩
    // ========================================================================

    function bindBuoyToggle() {
        var btn = document.getElementById('ocean-buoy-toggle-btn');
        if (!btn) return;

        _buoysVisible = localStorage.getItem('seagnal_buoys_visible') === 'true';
        btn.classList.toggle('active', _buoysVisible);

        btn.addEventListener('click', function () {
            _buoysVisible = !_buoysVisible;
            btn.classList.toggle('active', _buoysVisible);
            window.OceanGridSampler.refresh();
            try { localStorage.setItem('seagnal_buoys_visible', String(_buoysVisible)); } catch (e) {}
        });
    }

    // ========================================================================
    // 클릭 처리 (ocean_map.js 의 handleMapClick 에서 호출)
    // ========================================================================
    //
    // [변경 — 클러스터 제거]
    //  종전에는 클러스터 원(2,9,18…) 클릭 시 fit() 으로 줌인하는 로직이 있었음.
    //  이제는 격자 샘플링 결과의 단일 피처만 표시되므로 클러스터 줌인 핸들러 제거.
    //  벡터 소스에는 _vectorSource(부이/지명 통합) 의 피처가 직접 들어있어
    //  forEachFeatureAtPixel 로 그대로 hit 가능.
    //
    window.handleOceanBuoyClick = function (map, evt) {
        if (!_layer || !_layer.getVisible()) return false;

        // 인접 마커 중 가장 가까운 단일 피처 선택 (밀집 구역의 오인식 방지)
        var candidates = [];
        map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer !== _layer) return;
            var geom = feature.getGeometry();
            if (!geom) return;
            var centerCoord = geom.getCoordinates();
            var centerPixel = map.getPixelFromCoordinate(centerCoord);
            if (!centerPixel) return;
            var dx = centerPixel[0] - evt.pixel[0];
            var dy = centerPixel[1] - evt.pixel[1];
            var dist = Math.sqrt(dx * dx + dy * dy);
            candidates.push({ feature: feature, dist: dist });
        }, { hitTolerance: 8 });

        if (candidates.length === 0) return false;

        candidates.sort(function (a, b) { return a.dist - b.dist; });
        var single = candidates[0].feature;
        var hit = false;

        if (single.get('markerType') === 'buoy') {
            // 부이 모달 (멱등 처리 — 같은 부이면 재생성하지 않음)
            var buoyId = single.get('buoyId');
            var existingModal = document.getElementById('buoy-info-modal');
            if (!(existingModal && existingModal.dataset.buoyId === buoyId)) {
                var buoyData = {
                    name: single.get('buoyName'),
                    type: single.get('buoyType')
                };
                if (typeof showBuoyModal === 'function') {
                    showBuoyModal(buoyId, buoyData);
                    var createdModal = document.getElementById('buoy-info-modal');
                    if (createdModal) createdModal.dataset.buoyId = buoyId;
                }
            }
            hit = true;
        } else if (single.get('markerType') === 'station') {
            var lat = single.get('stationLat');
            var lon = single.get('stationLon');
            var name = single.get('stationName');
            var code = single.get('stationCode');
            if (window.showOceanBottomSheet) {
                window.showOceanBottomSheet(lat, lon, { stationName: name, stationCode: code });
            }
            hit = true;
        }

        // 네이티브 click 이벤트 전파 차단 (해구기상 DOM 마커와 동일 효과)
        if (hit && evt.originalEvent) {
            if (typeof evt.originalEvent.stopPropagation === 'function') {
                evt.originalEvent.stopPropagation();
            }
            if (typeof evt.originalEvent.preventDefault === 'function') {
                evt.originalEvent.preventDefault();
            }
        }

        return hit;
    };

})();

} // end if (window.__SEAGNAL_PAGE === 'index2')
