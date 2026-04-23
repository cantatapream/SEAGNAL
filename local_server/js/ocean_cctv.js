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
     * 지도 포인터/커서 관련 훅을 oceanMap 에 바인딩 (1회만).
     *
     * [click 은 여기서 바인딩하지 않음]
     *  ocean_map.js 의 handleMapClick 이 이미 click 리스너를 등록해 두었는데,
     *  여기서 별도 click 리스너를 추가하면 두 핸들러가 동시에 실행되어
     *  "CCTV 마커 클릭 시 바텀시트도 같이 열리는" 문제가 발생.
     *  → click 은 handleMapClick 내부에서 window.oceanCctv.tryHandleMapClick 을
     *    먼저 호출해 CCTV 처리가 끝나면 기존 흐름(부이/마커/바텀시트)을 skip 한다.
     *    (ocean_map.js 가드는 window.oceanCctv 존재 여부 체크 → index1 무영향)
     */
    function _bindMapHooks(map) {
        if (_mapHooksBound) return;
        _mapHooksBound = true;

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
            // cursor 해제는 다른 레이어 로직(ocean_markers 등)에 위임하여 간섭 방지
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

        // 하단 즐겨찾기 바 내용 전환 (CCTV ↔ 위치)
        _renderFavBar();
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

    // ═══════════════════════════════════════════════════════════════════════
    // 즐겨찾기 매니저 (oceanFav)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // [역할]
    //   index2 해양종합 전용 즐겨찾기 두 종류를 관리하고, 하단 #ocean-fav-bar
    //   에 최대 3개 칩을 렌더한다.
    //     - cctv     : CCTV 지점 즐겨찾기 (localStorage: cctv_favorites_ocean_v1)
    //     - location : 해역 바텀시트 위치 즐겨찾기 (ocean_location_favorites_v1)
    //
    // [index1 독립]
    //   index1 의 기존 CCTV 즐겨찾기(cctv_favorites_v1)는 전혀 건드리지 않는다.
    //   키 이름이 다르므로 두 페이지의 즐겨찾기는 완전히 분리되어 저장된다.
    //
    // [표시 규칙 (renderAll 이 자동 판단)]
    //   - 해양종합이 active 가 아니면 표시 안 함
    //   - CCTV 토글 ON  → CCTV 즐겨찾기만 표시 (위치 즐겨찾기 숨김)
    //   - CCTV 토글 OFF → 위치 즐겨찾기 표시 (있으면)
    //   - 목록이 비어있으면 .empty 클래스로 바 자체 숨김 (CSS 에서 display:none)
    //
    // [500m 중복 판정 (location)]
    //   위치 즐겨찾기 중복 여부는 반경 500m 이내로 판단(하버사인 거리).
    //
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * 두 지점 사이의 거리(m) 계산 (하버사인).
     * [용도] 위치 즐겨찾기 500m 반경 중복 판정 / 클릭 좌표 매칭
     */
    function _haversineMeters(lat1, lon1, lat2, lon2) {
        var R = 6371000; // 지구 반지름 (m)
        var toRad = Math.PI / 180;
        var dLat = (lat2 - lat1) * toRad;
        var dLon = (lon2 - lon1) * toRad;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
              + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad)
              * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /** 저장소 한쪽의 기본 동작 셋 (cctv / location 공통 로직) */
    function _createFavStore(storageKey, maxCount) {
        return {
            MAX: maxCount,
            STORAGE_KEY: storageKey,
            items: [],

            /** localStorage 에서 읽어와 items 채움 */
            load: function () {
                try {
                    var raw = localStorage.getItem(this.STORAGE_KEY);
                    this.items = raw ? JSON.parse(raw) : [];
                    if (!Array.isArray(this.items)) this.items = [];
                } catch (e) {
                    this.items = [];
                }
            },

            /** items 를 localStorage 에 기록 */
            save: function () {
                try {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.items));
                } catch (e) {
                    console.warn('[oceanFav] 저장 실패:', e);
                }
            },

            /** 3개 제한 검사 — 가득이면 false (거부) */
            canAdd: function () { return this.items.length < this.MAX; },

            /** 항목 추가 (호출자가 먼저 canAdd 확인) */
            push: function (item) {
                this.items.push(item);
                this.save();
            },

            /** id 로 제거 */
            removeById: function (id) {
                this.items = this.items.filter(function (it) { return it.id !== id; });
                this.save();
            }
        };
    }

    // CCTV 즐겨찾기 저장소
    // item 구조: { id, cctvId, name, subtitle, providerKey, providerName,
    //              shareUrl, streamUrl, cnt, sensorName, cameraCount, obsName }
    var _favCctv = _createFavStore('cctv_favorites_ocean_v1', 3);

    // 위치 즐겨찾기 저장소
    // item 구조: { id, name, lat, lon, addedAt }
    var _favLocation = _createFavStore('ocean_location_favorites_v1', 3);

    // 둘 다 초기 로드
    _favCctv.load();
    _favLocation.load();

    /**
     * CCTV 즐겨찾기: id 로 존재 여부 확인.
     * [사용] 팝업 헤더의 별 버튼 상태 판정 (그룹3 에서 활용)
     */
    function _cctvHas(id) {
        for (var i = 0; i < _favCctv.items.length; i++) {
            if (_favCctv.items[i].id === id) return true;
        }
        return false;
    }

    /**
     * 위치 즐겨찾기: 반경 500m 안에 기존 즐겨찾기가 있으면 그 항목 반환, 없으면 null.
     * [사용] 바텀시트의 ⭐ 버튼 활성 상태 판정 / ⭐ 재클릭 시 제거 대상 찾기
     */
    function _locationFindNear(lat, lon) {
        for (var i = 0; i < _favLocation.items.length; i++) {
            var it = _favLocation.items[i];
            var dist = _haversineMeters(lat, lon, it.lat, it.lon);
            if (dist <= 500) return it;
        }
        return null;
    }

    /** 위치 즐겨찾기: 이름 중복 여부 */
    function _locationHasName(name) {
        for (var i = 0; i < _favLocation.items.length; i++) {
            if (_favLocation.items[i].name === name) return true;
        }
        return false;
    }

    /**
     * 하단 #ocean-fav-bar 에 현재 상태에 맞는 칩들을 렌더한다.
     *
     * [렌더 대상 결정]
     *  - CCTV 토글 ON  → CCTV 즐겨찾기
     *  - CCTV 토글 OFF → 위치 즐겨찾기
     *
     * [빈 목록 처리]
     *  렌더 대상이 비어 있으면 .empty 클래스 추가 → CSS 에서 display:none
     */
    function _renderFavBar() {
        var bar = document.getElementById('ocean-fav-bar');
        if (!bar) return;
        bar.innerHTML = '';

        var isCctv = _cctvActive;
        var items  = isCctv ? _favCctv.items : _favLocation.items;

        if (!items || items.length === 0) {
            bar.classList.add('empty');
            return;
        }
        bar.classList.remove('empty');

        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'ocean-fav-chip';
            chip.dataset.kind = isCctv ? 'cctv' : 'location';
            chip.dataset.id   = it.id;
            // 아이콘: CCTV 는 카메라, 위치는 별
            var iconClass = isCctv ? 'fa-solid fa-video' : 'fa-solid fa-star';
            var labelText = (it.name || '').toString();
            chip.innerHTML = '<i class="chip-icon ' + iconClass + '"></i>'
                           + '<span class="chip-name"></span>';
            chip.querySelector('.chip-name').textContent = labelText;
            chip.addEventListener('click', _handleChipClick);
            bar.appendChild(chip);
        }
    }

    /**
     * 즐겨찾기 칩 클릭 핸들러.
     *  - CCTV: 저장된 CCTV 정보로 showCctvPopup 재오픈 (지도 이동 없음)
     *  - 위치: 지도 해당 좌표로 이동 + 바텀시트 오픈
     */
    function _handleChipClick(e) {
        var chip = e.currentTarget;
        var kind = chip.dataset.kind;
        var id   = chip.dataset.id;
        if (kind === 'cctv') {
            var cctv = null;
            for (var i = 0; i < _favCctv.items.length; i++) {
                if (_favCctv.items[i].id === id) { cctv = _favCctv.items[i]; break; }
            }
            if (cctv && typeof window.showCctvPopup === 'function') {
                window.showCctvPopup(cctv);
            }
        } else if (kind === 'location') {
            var loc = null;
            for (var j = 0; j < _favLocation.items.length; j++) {
                if (_favLocation.items[j].id === id) { loc = _favLocation.items[j]; break; }
            }
            if (!loc) return;
            var map = window.getOceanMap && window.getOceanMap();
            if (map) {
                map.getView().animate({
                    center: ol.proj.fromLonLat([loc.lon, loc.lat]),
                    zoom: Math.max(map.getView().getZoom() || 6, 10),
                    duration: 400
                });
            }
            if (typeof window.showOceanBottomSheet === 'function') {
                window.showOceanBottomSheet(loc.lat, loc.lon);
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // 바텀시트 열림 / 범례 표시 상태 감시 (MutationObserver)
    // ──────────────────────────────────────────────────────────────
    /**
     * .ocean-bottom-sheet 의 class 변화를 감시하여 body.ocean-sheet-open 토글.
     * 바텀시트 열리면 하단 즐겨찾기 바는 자동 숨김 (CSS 에서 처리).
     */
    function _observeBottomSheet() {
        var sheet = document.getElementById('ocean-bottom-sheet');
        if (!sheet) return;
        var sync = function () {
            document.body.classList.toggle('ocean-sheet-open',
                sheet.classList.contains('open'));
        };
        sync();
        new MutationObserver(sync).observe(sheet, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    /**
     * .ocean-legend 의 style.display 변화를 감시하여 body.ocean-legend-visible 토글.
     * 범례(오버레이 ON) 가 뜨면 즐겨찾기 바를 범례 위로 115px 올림.
     */
    function _observeLegend() {
        var legend = document.getElementById('ocean-legend');
        if (!legend) return;
        var sync = function () {
            // 인라인 display:none 이 있으면 숨김, 아니면 표시
            var hidden = legend.style.display === 'none';
            document.body.classList.toggle('ocean-legend-visible', !hidden);
        };
        sync();
        new MutationObserver(sync).observe(legend, {
            attributes: true,
            attributeFilter: ['style']
        });
    }

    // DOM 준비 후 옵저버 바인딩
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            _observeBottomSheet();
            _observeLegend();
            _renderFavBar();
        });
    } else {
        _observeBottomSheet();
        _observeLegend();
        _renderFavBar();
    }

    // ──────────────────────────────────────────────────────────────
    // 외부 API
    // ──────────────────────────────────────────────────────────────
    // [tryHandleMapClick]
    //  ocean_map.js 의 handleMapClick 내부에서 **가장 먼저** 호출.
    //  true 반환 시 기존 부이/마커/바텀시트 흐름을 모두 skip 해야 함.
    //  CCTV 가 OFF 이거나 CCTV 마커에 맞지 않으면 false 반환 → 기존 흐름 진행.
    //
    // [isActive / setActive]
    //  후속 그룹(즐겨찾기)에서 CCTV 상태를 조회/제어하기 위한 API.
    window.oceanCctv = {
        isActive: function () { return _cctvActive; },
        setActive: _setCctvActive,
        tryHandleMapClick: function (map, evt) {
            return _handleCctvClick(map, evt);
        }
    };

    // ══════════════════════════════════════════════════════════════
    // window.CctvFavorites shim (index2 전용)
    // ──────────────────────────────────────────────────────────────
    // [왜 shim?]
    //  cctv4.js 의 팝업 헤더 별 버튼은 onclick="toggleCctvFavorite()" 로 바인딩되어
    //  있고, 그 핸들러는 `window.CctvFavorites.has / add / remove` 를 호출한다.
    //  index1 에서는 cctv6.js 가 실제 CctvFavorites 를 정의하지만, index2 에서는
    //  cctv6.js 를 로드하지 않아 이 객체가 undefined → 별 버튼이 무동작.
    //
    //  cctv4.js 는 공유 파일이라 수정 금지이므로, index2 에서는 동일 시그니처의
    //  얇은 shim 을 노출하여 기존 별 버튼 로직이 그대로 oceanFav 매니저에
    //  위임되도록 함.
    //
    // [인터페이스 일치]
    //  - has(cctvId)      → oceanFav.cctvHas(cctvId) 로 위임
    //  - remove(cctvId)   → oceanFav.cctvRemove(cctvId)
    //  - add(obj)         → oceanFav.cctvAdd({ id: obj.cctvId, ...obj })
    //    * 성공 true / 실패 false 반환 (cctv4.js 시그니처 유지)
    //    * "full" 거부 시 showSeagnalModal 로 사용자 안내
    //
    // [index1 무영향]
    //  이 파일은 __SEAGNAL_PAGE==='index2' 가드 안에서 실행되므로 index1 에는
    //  shim 이 설치되지 않음 → index1 의 실제 CctvFavorites 그대로 사용.
    // ══════════════════════════════════════════════════════════════
    window.CctvFavorites = {
        has: function (cctvId) {
            return _cctvHas(cctvId);
        },
        remove: function (cctvId) {
            _favCctv.removeById(cctvId);
            _renderFavBar();
        },
        add: function (obj) {
            if (!obj || !obj.cctvId) return false;
            // 내부 스키마는 id 필드를 primary key 로 사용
            var item = {
                id:           obj.cctvId,
                cctvId:       obj.cctvId,
                name:         obj.name,
                subtitle:     obj.subtitle,
                providerKey:  obj.providerKey,
                providerName: obj.providerName,
                shareUrl:     obj.shareUrl,
                streamUrl:    obj.streamUrl,
                cameraCount:  obj.cameraCount,
                obsName:      obj.obsName,
                sensorName:   obj.sensorName,
                cnt:          obj.cnt
            };
            // 3개 제한 초과 시 거부 + 안내
            if (!_favCctv.canAdd()) {
                if (typeof window.showSeagnalModal === 'function') {
                    window.showSeagnalModal('즐겨찾기',
                        '즐겨찾기는 최대 3개까지 저장할 수 있습니다.\n기존 항목을 먼저 해제해 주세요.', 'info');
                }
                return false;
            }
            // 이미 같은 cctvId 가 있으면 중복 거부
            if (_cctvHas(obj.cctvId)) return false;
            _favCctv.push(item);
            _renderFavBar();
            return true;
        },
        /**
         * render: cctv6.js 원본은 지도 우측 상단에 즐겨찾기 버튼 목록을 그리는
         * 함수. index2 에서는 하단 #ocean-fav-bar 가 대체하므로 no-op.
         * 혹시 외부에서 호출되면 하단 바만 갱신.
         */
        render: function () { _renderFavBar(); }
    };

    // ──────────────────────────────────────────────────────────────
    // 즐겨찾기 외부 API (그룹 3/4 에서 연동)
    // ──────────────────────────────────────────────────────────────
    window.oceanFav = {
        // CCTV 즐겨찾기 관련
        cctvHas: _cctvHas,
        cctvAdd: function (item) {
            // 3개 제한 초과 시 거부
            if (!_favCctv.canAdd()) return { ok: false, reason: 'full' };
            if (_cctvHas(item.id)) return { ok: false, reason: 'exists' };
            _favCctv.push(item);
            _renderFavBar();
            return { ok: true };
        },
        cctvRemove: function (id) {
            _favCctv.removeById(id);
            _renderFavBar();
        },
        cctvGetAll: function () { return _favCctv.items.slice(); },

        // 위치 즐겨찾기 관련
        locationFindNear: _locationFindNear,
        locationHasName: _locationHasName,
        locationAdd: function (item) {
            // 3개 제한 초과 시 거부
            if (!_favLocation.canAdd()) return { ok: false, reason: 'full' };
            // 500m 반경 중복 거부
            if (_locationFindNear(item.lat, item.lon)) return { ok: false, reason: 'near_exists' };
            // 이름 중복 거부
            if (_locationHasName(item.name))          return { ok: false, reason: 'name_exists' };
            _favLocation.push(item);
            _renderFavBar();
            return { ok: true };
        },
        locationRemoveById: function (id) {
            _favLocation.removeById(id);
            _renderFavBar();
        },
        locationRemoveNear: function (lat, lon) {
            var near = _locationFindNear(lat, lon);
            if (near) {
                _favLocation.removeById(near.id);
                _renderFavBar();
                return true;
            }
            return false;
        },
        locationGetAll: function () { return _favLocation.items.slice(); },

        // 재렌더 강제
        rerender: _renderFavBar
    };

})();
