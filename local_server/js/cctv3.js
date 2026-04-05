// ====================================================================
// cctv3.js — CCTV 마커 추가 + 클러스터링
//
// [역할]
//   CCTV_PROVIDERS(cctv1.js)에 정의된 모든 제공기관의 CCTV 지점을
//   cctv_image.png 아이콘 마커로 지도 위에 표시합니다.
//   가까운 마커는 자동으로 클러스터(숫자 원)로 묶이며,
//   확대하면 부드럽게 풀어집니다.
//
// [클러스터 색상]
//   50개 이상 — 빨간색
//   30개 이상 — 주황색
//   10개 이상 — 노란색
//    5개 이상 — 초록색
//    2~4개    — 파란색
//
// [연계]
//   - cctv1.js CCTV_PROVIDERS          — 데이터 순회
//   - cctv2.js cctvMap, cctvMarkerLayer — 지도 인스턴스/레이어 변수
//   - cctv4.js handleCctvMapClick()    — Feature 속성 읽어 팝업 표출
//   - cctv2.js initCctvMap()           — 지도 초기화 완료 후 이 함수 호출
// ====================================================================

// 클러스터 소스 전역 참조 (줌 레벨별 distance 동적 조절에 사용)
let _cctvClusterSource = null;

/**
 * 클러스터 크기에 따른 색상을 반환합니다.
 * @param {number} size — 클러스터에 포함된 마커 수
 * @returns {{ fill: string, stroke: string }}
 */
function _getClusterColor(size) {
    if (size >= 50) return { fill: 'rgba(220, 38, 38, 0.85)',  stroke: 'rgba(220, 38, 38, 0.3)' };   // 빨간색
    if (size >= 30) return { fill: 'rgba(234, 88, 12, 0.85)',  stroke: 'rgba(234, 88, 12, 0.3)' };   // 주황색
    if (size >= 10) return { fill: 'rgba(202, 138, 4, 0.85)',  stroke: 'rgba(202, 138, 4, 0.3)' };   // 노란색
    if (size >= 5)  return { fill: 'rgba(22, 163, 74, 0.85)',  stroke: 'rgba(22, 163, 74, 0.3)' };   // 초록색
    return              { fill: 'rgba(59, 130, 246, 0.85)', stroke: 'rgba(59, 130, 246, 0.3)' };  // 파란색
}

/**
 * 줌 레벨에 따른 클러스터 distance를 계산합니다.
 * 축소일수록 넓게, 확대일수록 좁게 묶입니다.
 * @param {number} zoom — 현재 줌 레벨
 * @returns {number} — 클러스터 distance (픽셀)
 */
function _getClusterDistance(zoom) {
    if (zoom >= 15) return 15;
    if (zoom >= 13) return 20;
    if (zoom >= 11) return 25;
    if (zoom >= 9)  return 30;
    if (zoom >= 7)  return 35;
    return 40;
}

/**
 * 모든 제공기관의 CCTV 지점을 지도 위에 마커로 표시합니다.
 */
function addCctvMarkers() {
    if (!cctvMap) return;

    // 기존 마커 레이어/이벤트 정리
    if (cctvMarkerLayer) {
        cctvMap.removeLayer(cctvMarkerLayer);
        cctvMarkerLayer = null;
    }

    // 모든 제공기관의 Feature를 담을 배열
    const allFeatures = [];

    for (const [providerKey, provider] of Object.entries(CCTV_PROVIDERS)) {
        provider.items.forEach(function (item) {
            // coastal 마커는 동일 지점에 다른 provider 마커가 겹칠 수 있으므로
            // 약 11m 북쪽으로 미세 offset → 확대 시 시각적으로 분리
            var lat = parseFloat(item.lat) + (providerKey === 'coastal' ? 0.0001 : 0);
            var lng = parseFloat(item.lng);

            const feature = new ol.Feature({
                geometry: new ol.geom.Point(ol.proj.fromLonLat([lng, lat])),
                cctvId:       item.cctvId,
                name:         item.name,
                subtitle:     item.subtitle,
                providerKey:  providerKey,
                providerName: provider.name,
                cnt:          item.cnt          || '1',
                sensorName:   item.sensorName   || null,
                cameraCount:  item.cameraCount  || 1,
                // obsName: 해무 CCTV(seafog) 전용 — 공공API 관측소명과 정확히 일치해야 함
                // 팝업에서 /api/seafog-cctv?obs={obsName} 쿼리에 사용됩니다.
                // seafog 이외 프로바이더는 null로 설정됩니다.
                obsName:   item.obsName         || null,
                shareUrl:  provider.type === 'iframe' ? provider.shareUrl(item.cctvId, item) : null,
                streamUrl: provider.type === 'hls'    ? provider.streamUrl(item.cctvId) : null
            });

            feature.setStyle(new ol.style.Style({
                image: new ol.style.Icon({
                    src: '/images/cctv_image.png',
                    anchor: [0.5, 1.0],
                    anchorXUnits: 'fraction',
                    anchorYUnits: 'fraction',
                    scale: 0.07
                }),
                text: new ol.style.Text({
                    text: item.name,
                    offsetX: 0,
                    offsetY: 10,
                    textAlign: 'center',
                    fill: new ol.style.Fill({ color: '#ffffff' }),
                    stroke: new ol.style.Stroke({ color: '#000000', width: 3 }),
                    font: 'bold 11px "Noto Sans KR", sans-serif'
                })
            }));

            allFeatures.push(feature);
        });
    }

    // ── 클러스터 소스 ────────────────────────────────────────────────
    const vectorSource = new ol.source.Vector({ features: allFeatures });
    const initialZoom = cctvMap.getView().getZoom() || 6;

    _cctvClusterSource = new ol.source.Cluster({
        distance: _getClusterDistance(initialZoom),
        minDistance: 0,
        source: vectorSource
    });

    // ── 스타일 캐시 (성능 최적화) ─────────────────────────────────────
    const styleCache = {};

    // ── 클러스터 레이어 ──────────────────────────────────────────────
    cctvMarkerLayer = new ol.layer.Vector({
        source: _cctvClusterSource,
        // 줌/이동 중에도 실시간 렌더링 → 부드러운 전환
        updateWhileAnimating: true,
        updateWhileInteracting: true,
        style: function (feature) {
            var clusterFeatures = feature.get('features');
            var size = clusterFeatures ? clusterFeatures.length : 1;

            if (size === 1) {
                // 개별 마커: 내부 Feature의 기존 스타일(아이콘+라벨) 그대로 사용
                return clusterFeatures[0].getStyle();
            }

            // 클러스터 스타일 — 캐시 키: 크기별 색상 단계
            var colorKey = size >= 50 ? '50' : size >= 30 ? '30' : size >= 10 ? '10' : size >= 5 ? '5' : '2';
            var cacheKey = colorKey + '-' + size;

            if (!styleCache[cacheKey]) {
                var color = _getClusterColor(size);
                // 내부 원 반지름: 크기에 비례하되 너무 커지지 않게
                var radius = 16 + Math.min(size, 80) * 0.15;

                styleCache[cacheKey] = [
                    // 외곽 반투명 링 (후광 효과)
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: radius + 6,
                            fill: new ol.style.Fill({ color: color.stroke })
                        })
                    }),
                    // 내부 원 + 숫자
                    new ol.style.Style({
                        image: new ol.style.Circle({
                            radius: radius,
                            fill: new ol.style.Fill({ color: color.fill }),
                            stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
                        }),
                        text: new ol.style.Text({
                            text: size.toString(),
                            fill: new ol.style.Fill({ color: '#ffffff' }),
                            font: 'bold ' + (size >= 100 ? '11' : '13') + 'px "Noto Sans KR", sans-serif'
                        })
                    })
                ];
            }

            return styleCache[cacheKey];
        },
        zIndex: 10
    });

    cctvMap.addLayer(cctvMarkerLayer);

    // ── 줌 레벨 변경 시 클러스터 distance 동적 조절 ──────────────────
    cctvMap.getView().on('change:resolution', function () {
        var zoom = cctvMap.getView().getZoom();
        var newDist = _getClusterDistance(zoom);
        if (_cctvClusterSource && _cctvClusterSource.getDistance() !== newDist) {
            _cctvClusterSource.setDistance(newDist);
        }
    });
}
