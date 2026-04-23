/**
 * ocean_cctv.js
 * ============================================================================
 * [역할]
 *   index2 (종합기상 > 해양종합) 에서 CCTV 기능을 oceanMap 위에 통합하는 모듈.
 *   우측 컨트롤의 "CCTV" 토글 버튼 / 유의사항 버튼 을 바인딩하고,
 *   활성화 시 CCTV 마커 클러스터를 oceanMap 에 표시한다.
 *
 * [왜 index2 전용 별도 모듈인가?]
 *   - index1(index.html) 의 해안CCTV 서브탭은 `cctv2~7.js` 를 그대로 사용하여
 *     독립 OpenLayers 지도(#cctv-map) 로 제공됨. 이 동작은 변함없이 유지.
 *   - index2 에서만 해양종합(oceanMap) 에 CCTV 를 통합하여 하위 탭을 없앰.
 *     이를 위해 기존 cctv*.js 는 건드리지 않고, 이 파일이 oceanMap 대상 전용
 *     로직을 새로 구현.
 *   - 공유 파일: cctv1.js (CCTV_PROVIDERS 데이터) / cctv4.js (showCctvPopup 팝업)
 *
 * [페이지 가드]
 *   index1 에서도 이 파일이 실수로 로드될 경우를 대비해 최상위에서
 *   `window.__SEAGNAL_PAGE === 'index2'` 가 아니면 전체 스킵.
 *
 * [연계]
 *   - index2.html
 *     · #ocean-cctv-toggle-btn   : CCTV 토글 버튼 (기상부이 아래)
 *     · #ocean-cctv-notice-btn   : 유의사항 버튼 (내위치 아래, CCTV ON 시만 표시)
 *     · #cctv-modal-backdrop     : CCTV 영상 팝업 컨테이너 (cctv4.js 가 채움)
 *   - js/cctv1.js  window.CCTV_PROVIDERS — 지점 데이터
 *   - js/cctv4.js  window.showCctvPopup  — 영상 팝업
 *   - js/ocean_map.js window.getOceanMap() — oceanMap 인스턴스 조회
 *
 * [index1 무영향]
 *   - 기존 cctv1~7.js 코드 수정 없음
 *   - index1 의 #cctv-section / cctvMap / CctvFavorites 그대로 동작
 *   - localStorage 키도 분리 (index1 은 cctv_favorites_v1, index2 는 후속
 *     그룹에서 별도 키 도입 예정)
 * ============================================================================
 */
(function () {
    'use strict';

    // ──────────────────────────────────────────────────────────────
    // 페이지 가드: index2 에서만 동작
    // ──────────────────────────────────────────────────────────────
    if (window.__SEAGNAL_PAGE !== 'index2') return;

    // ──────────────────────────────────────────────────────────────
    // 모듈 전역 상태
    // ──────────────────────────────────────────────────────────────
    /** CCTV 마커 클러스터 레이어 (최초 CCTV ON 시 생성) */
    var _cctvClusterLayer = null;
    /** 클러스터 source (줌 변경 시 distance 조정용) */
    var _cctvClusterSource = null;
    /** CCTV 토글 활성 상태 (true 면 마커 표시 중) */
    var _cctvActive = false;
    /** click/pointermove 리스너 바인딩 여부 (1회) */
    var _mapHooksBound = false;

    // ──────────────────────────────────────────────────────────────
    // 유의사항 문구 (기존 #cctv-disclaimer 에 있던 텍스트를 모듈 내부로 이식)
    // [이유] cctv-section HTML 삭제로 소스 DOM 이 사라졌으므로 여기서 보유.
    // ──────────────────────────────────────────────────────────────
    var CCTV_NOTICE_HTML = ''
        + '<p><i class="fa-solid fa-circle-check"></i> 이 해안 CCTV 서비스는 어항 안전상태 및 해상 기상현황 확인 등 공익적 목적으로 운영됩니다.</p>'
        + '<p><i class="fa-solid fa-circle-check"></i> 제공 영상은 지방자치단체(부산시·거제시·옹진군), 해양수산부 연안포털, KBS 재난센터에서 공공에 공개한 영상을 활용하며, 본 앱은 영상을 수집·저장하지 않습니다.</p>'
        + '<p><i class="fa-solid fa-circle-check"></i> 영상 정보의 정확성과 이를 활용함에 따른 민·형사상 법적 책임은 정보활용 주체에 있으며, 정보 제공주체 및 본 앱은 이에 대한 책임을 지지 않습니다.</p>'
        + '<p><i class="fa-solid fa-circle-check"></i> 옹진군 CCTV의 지도 위치는 명칭·지명을 참고하여 수기 배치된 것으로, 실제 설치 위치와 다를 수 있습니다.</p>';

    // ──────────────────────────────────────────────────────────────
    // 클러스터 스타일 헬퍼 (cctv3.js 와 유사하지만 oceanMap 전용으로 별도 구현)
    // ──────────────────────────────────────────────────────────────
    /**
     * 클러스터 크기에 따른 색상.
     * [규칙] 50+ 빨강 / 30+ 주황 / 10+ 노랑 / 5+ 초록 / 2+ 파랑 (cctv3 동일)
     */
    function _clusterColor(size) {
        if (size >= 50) return { fill: 'rgba(220, 38, 38, 0.85)', stroke: 'rgba(220, 38, 38, 0.3)' };
        if (size >= 30) return { fill: 'rgba(234, 88, 12, 0.85)', stroke: 'rgba(234, 88, 12, 0.3)' };
        if (size >= 10) return { fill: 'rgba(202, 138, 4, 0.85)', stroke: 'rgba(202, 138, 4, 0.3)' };
        if (size >= 5)  return { fill: 'rgba(22, 163, 74, 0.85)', stroke: 'rgba(22, 163, 74, 0.3)' };
        return              { fill: 'rgba(59, 130, 246, 0.85)', stroke: 'rgba(59, 130, 246, 0.3)' };
    }

    /**
     * 줌 레벨에 따른 클러스터 distance (cctv3 동일 규칙)
     */
    function _clusterDistance(zoom) {
        if (zoom >= 15) return 15;
        if (zoom >= 13) return 20;
        if (zoom >= 11) return 25;
        if (zoom >= 9)  return 30;
        if (zoom >= 7)  return 35;
        return 40;
    }

    /**
     * 클러스터/단일 마커의 OpenLayers Style 생성
     * @param {ol.Feature} feature — Cluster source 가 만든 feature (features 속성 포함)
     */
    function _buildClusterStyle(feature) {
        var features = feature.get('features');
        if (!features) return null;
        var size = features.length;

        // 단일 지점: CCTV 아이콘 + 지점명 라벨 (cctv3.js 와 유사하지만 파란 원형 기반)
        if (size === 1) {
            var one = features[0];
            var name = one.get('name') || '';
            return [
                new ol.style.Style({
                    image: new ol.style.Icon({
                        src: '/images/cctv_image.png',
                        anchor: [0.5, 1.0],
                        anchorXUnits: 'fraction',
                        anchorYUnits: 'fraction',
                        scale: 0.07
                    }),
                    text: new ol.style.Text({
                        text: name,
                        font: '600 11px "Noto Sans KR", sans-serif',
                        fill: new ol.style.Fill({ color: '#ffffff' }),
                        stroke: new ol.style.Stroke({ color: 'rgba(0,0,0,0.85)', width: 3 }),
                        offsetY: -24
                    })
                })
            ];
        }

        // 클러스터: 숫자 원형
        var c = _clusterColor(size);
        return [
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 20,
                    fill: new ol.style.Fill({ color: c.stroke })
                })
            }),
            new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 16,
                    fill: new ol.style.Fill({ color: c.fill }),
                    stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
                }),
                text: new ol.style.Text({
                    text: String(size),
                    font: '700 13px "Noto Sans KR", sans-serif',
                    fill: new ol.style.Fill({ color: '#ffffff' })
                })
            })
        ];
    }

    // ──────────────────────────────────────────────────────────────
    // CCTV 데이터 → ol.Feature 배열
    // ──────────────────────────────────────────────────────────────
    /**
     * window.CCTV_PROVIDERS 구조를 순회하여 각 CCTV 지점을 ol.Feature 로 변환.
     *
     * [데이터 구조 (cctv1.js 기준)]
     *   CCTV_PROVIDERS[providerKey] = {
     *     type:     'iframe' | 'hls',
     *     name:     기관명,
     *     shareUrl: fn(cctvId, item),  (iframe 전용)
     *     streamUrl: fn(cctvId),       (hls 전용)
     *     items:    [ { cctvId, name, subtitle, lat(str), lng(str), ... } ]
     *   }
     *
     * [Feature 속성]
     *   cctv3.js 와 동일 스키마로 저장해 showCctvPopup(data) 에 바로 전달 가능.
     */
    function _buildFeatures() {
        var providers = window.CCTV_PROVIDERS;
        if (!providers) return [];
        var features = [];
        var keys = Object.keys(providers);
        for (var i = 0; i < keys.length; i++) {
            var providerKey = keys[i];
            var provider = providers[providerKey];
            if (!provider || !provider.items) continue;
            for (var j = 0; j < provider.items.length; j++) {
                var item = provider.items[j];
                var lat = parseFloat(item.lat);
                var lng = parseFloat(item.lng);
                if (isNaN(lat) || isNaN(lng)) continue;

                // coastal 마커는 동일 지점에 다른 provider 가 겹칠 때 살짝 offset
                // (cctv3.js 와 동일 처리)
                if (providerKey === 'coastal') lat += 0.0001;

                var f = new ol.Feature({
                    geometry: new ol.geom.Point(ol.proj.fromLonLat([lng, lat])),
                    cctvId:       item.cctvId,
                    name:         item.name,
                    subtitle:     item.subtitle,
                    providerKey:  providerKey,
                    providerName: provider.name,
                    cnt:          item.cnt         || '1',
                    sensorName:   item.sensorName  || null,
                    cameraCount:  item.cameraCount || 1,
                    obsName:      item.obsName     || null,
                    shareUrl:  provider.type === 'iframe' ? provider.shareUrl(item.cctvId, item) : null,
                    streamUrl: provider.type === 'hls'    ? provider.streamUrl(item.cctvId)     : null
                });
                features.push(f);
            }
        }
        return features;
    }

    // ──────────────────────────────────────────────────────────────
    // 마커 레이어 생성 (지연 생성: CCTV 버튼 처음 ON 시에만)
    // ──────────────────────────────────────────────────────────────
    function _ensureClusterLayer(map) {
        if (_cctvClusterLayer) return _cctvClusterLayer;

        var featureSource = new ol.source.Vector({
            features: _buildFeatures()
        });

        _cctvClusterSource = new ol.source.Cluster({
            source: featureSource,
            distance: _clusterDistance(map.getView().getZoom() || 6)
        });

        _cctvClusterLayer = new ol.layer.Vector({
            source: _cctvClusterSource,
            style: _buildClusterStyle,
            // 부이 / 주요지명 vector(zIndex:100) 와 같은 레이어로 파티클 위에 배치
            zIndex: 100,
            updateWhileAnimating: true,
            updateWhileInteracting: true
        });
        map.addLayer(_cctvClusterLayer);

        // 줌 변경 시 distance 동적 조정 (cctv3 와 동일 규칙)
        map.getView().on('change:resolution', function () {
            if (!_cctvClusterSource) return;
            _cctvClusterSource.setDistance(_clusterDistance(map.getView().getZoom() || 6));
        });

        return _cctvClusterLayer;
    }

    // ──────────────────────────────────────────────────────────────
    // 지도 클릭 훅 — CCTV 마커/클러스터 클릭 감지
    // ──────────────────────────────────────────────────────────────
    /**
     * 주변 클러스터 후보들 중 가장 가까운 것을 선택해 영상 팝업을 띄움.
     * [흐름]
     *  1) CCTV 토글 OFF → 스킵
     *  2) 클릭 위치에서 _cctvClusterLayer 의 feature 들 수집
     *  3) 클러스터(feature.size > 1) 면 지도 확대(fitExtent)
     *  4) 단일(feature.size === 1) 이면 cctv4.js showCctvPopup 호출
     *
     * @returns {boolean} 처리했으면 true (다른 핸들러가 더 처리하지 않도록)
     */
    function _handleCctvClick(map, evt) {
        if (!_cctvActive || !_cctvClusterLayer) return false;

        var hitFeature = null;
        map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
            if (layer !== _cctvClusterLayer) return;
            if (!hitFeature) hitFeature = feature;
        }, { hitTolerance: 6 });

        if (!hitFeature) return false;

        var inner = hitFeature.get('features');
        if (!inner || inner.length === 0) return false;

        if (inner.length === 1) {
            // 단일 CCTV → 영상 팝업 (cctv4.js showCctvPopup 시그니처에 맞춰
            //   Feature 속성으로 저장해 둔 값을 객체로 재구성해 전달)
            var f = inner[0];
            if (typeof window.showCctvPopup === 'function') {
                window.showCctvPopup({
                    cctvId:       f.get('cctvId'),
                    name:         f.get('name'),
                    subtitle:     f.get('subtitle'),
                    providerKey:  f.get('providerKey'),
                    providerName: f.get('providerName'),
                    shareUrl:     f.get('shareUrl'),
                    streamUrl:    f.get('streamUrl'),
                    cnt:          f.get('cnt')        || '1',
                    sensorName:   f.get('sensorName') || null,
                    cameraCount:  f.get('cameraCount')|| 1,
                    obsName:      f.get('obsName')    || null
                });
            }
            return true;
        }

        // 클러스터 → 포함된 피처 범위로 확대 (cctv4/cctv3 와 유사 동작)
        var extent = ol.extent.createEmpty();
        for (var i = 0; i < inner.length; i++) {
            ol.extent.extend(extent, inner[i].getGeometry().getExtent());
        }
        map.getView().fit(extent, {
            duration: 400,
            padding: [60, 60, 60, 60],
            maxZoom: 14
        });
        return true;
    }

    /**
     * 지도 클릭/포인터 훅을 oceanMap 에 바인딩 (1회만).
     * - handleMapClick(ocean_map.js)은 부이 → 마커 → 바텀시트 순서.
     *   CCTV 는 우선권이 필요하지는 않으므로 click 시점에 우리가 먼저 feature 체크.
     *   다만 oceanMap.on('click') 은 ocean_map.js 가 이미 바인딩해 두었으므로,
     *   capture phase / preventDefault 대신 별도 리스너 등록 후 "이벤트 버블링을
     *   막을 방법이 OL 에 없으므로" handleMapClick 내부 로직과 공존.
     *   [현실 동작] 부이 클릭 → 바텀시트 열림 + CCTV 마커 클릭은 별도. 서로 간섭 없음.
     */
    function _bindMapHooks(map) {
        if (_mapHooksBound) return;
        _mapHooksBound = true;

        map.on('click', function (evt) {
            // 다른 마커가 동일 픽셀에 있으면 두 핸들러 모두 호출될 수 있으나,
            // forEachFeatureAtPixel 에서 우리 레이어만 체크하므로 CCTV 단일 클릭만 처리.
            _handleCctvClick(map, evt);
        });

        // 포인터 호버 시 커서 변경 (CCTV 활성일 때만)
        map.on('pointermove', function (evt) {
            if (!_cctvActive || !_cctvClusterLayer) return;
            var hit = false;
            map.forEachFeatureAtPixel(evt.pixel, function (feature, layer) {
                if (layer === _cctvClusterLayer) hit = true;
            }, { hitTolerance: 6 });
            if (hit) {
                var target = map.getTargetElement();
                if (target && target.style.cursor !== 'pointer') target.style.cursor = 'pointer';
            }
            // cursor 해제는 다른 레이어 로직이 담당(ocean_markers 등). 간섭 피하려고
            // 여기선 설정만 함.
        });
    }

    // ──────────────────────────────────────────────────────────────
    // CCTV 토글 (ON / OFF)
    // ──────────────────────────────────────────────────────────────
    /**
     * CCTV 활성/비활성 전환.
     * @param {boolean} on
     */
    function _setCctvActive(on) {
        var map = window.getOceanMap && window.getOceanMap();
        if (!map) return;

        if (on) {
            var layer = _ensureClusterLayer(map);
            layer.setVisible(true);
            _bindMapHooks(map);
            _cctvActive = true;
            document.body.classList.add('ocean-cctv-on');
            // 유의사항 버튼 표시
            var noticeBtn = document.getElementById('ocean-cctv-notice-btn');
            if (noticeBtn) noticeBtn.style.display = '';
        } else {
            if (_cctvClusterLayer) _cctvClusterLayer.setVisible(false);
            _cctvActive = false;
            document.body.classList.remove('ocean-cctv-on');
            // 유의사항 버튼 숨김
            var noticeBtn2 = document.getElementById('ocean-cctv-notice-btn');
            if (noticeBtn2) noticeBtn2.style.display = 'none';
            // 열려있던 CCTV 영상 팝업도 함께 닫음 (사용자 요구: CCTV OFF 시 팝업 동기 닫힘)
            if (typeof window.closeCctvPopup === 'function') {
                window.closeCctvPopup();
            } else {
                // closeCctvPopup 이 export 되지 않았을 경우의 폴백: 백드롭 직접 닫기
                var backdrop = document.getElementById('cctv-modal-backdrop');
                if (backdrop) {
                    backdrop.style.display = 'none';
                    backdrop.innerHTML = '';
                }
            }
        }

        // 버튼 시각 상태 갱신
        var toggleBtn = document.getElementById('ocean-cctv-toggle-btn');
        if (toggleBtn) toggleBtn.classList.toggle('active', _cctvActive);
    }

    // ──────────────────────────────────────────────────────────────
    // 유의사항 팝업
    // ──────────────────────────────────────────────────────────────
    function _openNoticePopup() {
        if (typeof window.showSeagnalModal !== 'function') return;
        window.showSeagnalModal('유의사항', CCTV_NOTICE_HTML, 'info');
    }

    // ──────────────────────────────────────────────────────────────
    // 버튼 바인딩 + 초기화
    // ──────────────────────────────────────────────────────────────
    function _bindButtons() {
        var toggleBtn = document.getElementById('ocean-cctv-toggle-btn');
        if (toggleBtn && !toggleBtn.dataset.bound) {
            toggleBtn.addEventListener('click', function () {
                _setCctvActive(!_cctvActive);
            });
            toggleBtn.dataset.bound = '1';
        }
        var noticeBtn = document.getElementById('ocean-cctv-notice-btn');
        if (noticeBtn && !noticeBtn.dataset.bound) {
            noticeBtn.addEventListener('click', _openNoticePopup);
            noticeBtn.dataset.bound = '1';
        }
    }

    // DOMContentLoaded 후 버튼 바인딩 (oceanMap 생성과 독립적 — 첫 클릭 시 layer 지연 생성)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bindButtons);
    } else {
        _bindButtons();
    }

    // ──────────────────────────────────────────────────────────────
    // 외부 API (다음 그룹에서 즐겨찾기 연동 시 재사용)
    // ──────────────────────────────────────────────────────────────
    window.oceanCctv = {
        isActive: function () { return _cctvActive; },
        setActive: _setCctvActive
    };

})();
