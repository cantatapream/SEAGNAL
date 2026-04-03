// ====================================================================
// cctv3.js — CCTV 마커 추가
//
// [역할]
//   CCTV_PROVIDERS(cctv1.js)에 정의된 모든 제공기관의 CCTV 지점을
//   cctv_image.png 아이콘 마커로 지도 위에 표시합니다.
//   아이콘 아래에 지점명 라벨을 표시합니다 (조석정보 표준항 방식과 동일).
//
// [마커 구조]
//   - 각 지점 → ol.Feature (지도 위의 점 하나)
//   - 스타일  → /images/cctv_image.png 아이콘
//              + 지점명 텍스트 라벨 (아이콘 아래)
//   - 속성   → cctvId, name, subtitle, providerKey, providerName,
//               shareUrl (iframe 방식), streamUrl (HLS 방식)
//              (클릭 핸들러 cctv4.js에서 꺼내 사용)
//
// [연계]
//   - cctv1.js CCTV_PROVIDERS          — 데이터 순회
//   - cctv2.js cctvMap, cctvMarkerLayer — 지도 인스턴스/레이어 변수
//   - cctv4.js handleCctvMapClick()    — Feature 속성 읽어 팝업 표출
//   - cctv2.js initCctvMap()           — 지도 초기화 완료 후 이 함수 호출
// ====================================================================

/**
 * 모든 제공기관의 CCTV 지점을 지도 위에 마커로 표시합니다.
 *
 * [동작 흐름]
 *   1. 기존 마커 레이어가 있으면 제거 (재렌더링 대비)
 *   2. CCTV_PROVIDERS 객체를 순회
 *      → 각 지점을 ol.Feature로 생성 (좌표 + 팝업용 속성 포함)
 *   3. 마커 스타일: cctv_image.png 아이콘 + 아이콘 아래 지점명 라벨
 *   4. 모든 Feature를 하나의 ol.layer.Vector로 묶어 지도에 추가
 *
 * [좌표 변환]
 *   KBS/거제시 좌표는 WGS84(경위도)이므로
 *   OpenLayers 내부 좌표계인 EPSG:3857(Web Mercator)로 변환합니다.
 *   → ol.proj.fromLonLat([경도, 위도])
 *
 * [Feature 속성 설명]
 *   providerKey — 팝업에서 CCTV_PROVIDERS[key]로 type/links를 조회하기 위한 키
 *   shareUrl    — iframe 방식 제공기관(KBS)의 영상 공유 페이지 URL (HLS면 null)
 *   streamUrl   — HLS 방식 제공기관(거제시 등)의 스트림 URL (iframe이면 null)
 */
function addCctvMarkers() {
    // 지도가 아직 초기화되지 않았으면 실행하지 않음
    if (!cctvMap) return;

    // 기존 마커 레이어가 있으면 제거 후 재생성
    if (cctvMarkerLayer) {
        cctvMap.removeLayer(cctvMarkerLayer);
        cctvMarkerLayer = null;
    }

    // 모든 제공기관의 Feature를 담을 배열
    const allFeatures = [];

    // ─────────────────────────────────────────────────────────────────
    // 제공기관 순회: CCTV_PROVIDERS의 각 키(kbs, geoje 등)마다 처리
    // ─────────────────────────────────────────────────────────────────
    for (const [providerKey, provider] of Object.entries(CCTV_PROVIDERS)) {

        // 해당 기관의 모든 CCTV 지점을 Feature로 변환
        provider.items.forEach(function (item) {

            // ol.Feature: 지도 위의 점 하나를 나타내는 객체
            const feature = new ol.Feature({
                // 지도 좌표: WGS84(경위도) → EPSG:3857(Web Mercator) 변환
                geometry: new ol.geom.Point(
                    ol.proj.fromLonLat([parseFloat(item.lng), parseFloat(item.lat)])
                ),

                // ── 팝업 표출 시 cctv4.js handleCctvMapClick()에서 읽는 속성 ──
                cctvId:       item.cctvId,
                name:         item.name,
                subtitle:     item.subtitle,

                // 제공기관 키: 팝업에서 CCTV_PROVIDERS[providerKey]로 type·links 조회
                providerKey:  providerKey,
                providerName: provider.name,

                // iframe 방식(KBS): shareUrl 사용, HLS 방식(거제시 등): streamUrl 사용
                // 반대쪽 필드는 null로 설정하여 팝업이 어떤 방식인지 명확히 구분
                shareUrl:  provider.type === 'iframe' ? provider.shareUrl(item.cctvId) : null,
                streamUrl: provider.type === 'hls'    ? provider.streamUrl(item.cctvId) : null
            });

            // ── 마커 스타일: PNG 아이콘 + 아이콘 아래 지점명 라벨 ──
            feature.setStyle(new ol.style.Style({

                // PNG 이미지 아이콘
                image: new ol.style.Icon({
                    // /images/cctv_image.png — local_server/images/ 경로
                    src: '/images/cctv_image.png',
                    // 앵커: [0.5, 1.0] → 이미지 하단 중앙이 실제 좌표 위치에 오도록
                    anchor: [0.5, 1.0],
                    anchorXUnits: 'fraction',
                    anchorYUnits: 'fraction',
                    // 스케일: 조석정보 마커와 유사한 크기 (~28-32px 표시)
                    scale: 0.07
                }),

                // 지점명 텍스트 라벨 — 아이콘 아래 중앙 배치
                text: new ol.style.Text({
                    text: item.name,
                    offsetX: 0,     // 수평 중앙 정렬
                    offsetY: 10,    // 아이콘 아래쪽으로 배치
                    textAlign: 'center',
                    fill: new ol.style.Fill({ color: '#ffffff' }),
                    // 검정 외곽선으로 어떤 배경에서도 읽기 쉽게
                    stroke: new ol.style.Stroke({ color: '#000000', width: 3 }),
                    font: 'bold 11px "Noto Sans KR", sans-serif'
                })
            }));

            allFeatures.push(feature);
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // 클러스터 소스: 가까운 마커를 하나의 클러스터로 묶음
    //   distance: 45px — 이 거리 안의 마커들은 하나로 합침
    //   minDistance: 20px — 클러스터 간 최소 간격
    // ─────────────────────────────────────────────────────────────────
    const vectorSource = new ol.source.Vector({ features: allFeatures });
    const clusterSource = new ol.source.Cluster({
        distance: 45,
        minDistance: 20,
        source: vectorSource
    });

    // ─────────────────────────────────────────────────────────────────
    // 클러스터 레이어: 스타일 함수로 클러스터/개별 마커 구분 표시
    //   - 클러스터(2개 이상): 파란 원 + 개수 텍스트
    //   - 개별 마커(1개): 기존 cctv_image.png 아이콘 + 지점명 라벨
    // zIndex: 10 → OSM 배경(zIndex 0)보다 위에 표시
    // ─────────────────────────────────────────────────────────────────
    cctvMarkerLayer = new ol.layer.Vector({
        source: clusterSource,
        style: function (feature) {
            var clusterFeatures = feature.get('features');
            var size = clusterFeatures ? clusterFeatures.length : 1;

            if (size > 1) {
                // 클러스터 스타일: 파란 원 + 흰색 개수 텍스트
                return new ol.style.Style({
                    image: new ol.style.Circle({
                        radius: 18 + Math.min(size, 50) * 0.3,
                        fill: new ol.style.Fill({ color: 'rgba(59, 130, 246, 0.85)' }),
                        stroke: new ol.style.Stroke({ color: '#ffffff', width: 2 })
                    }),
                    text: new ol.style.Text({
                        text: size.toString(),
                        fill: new ol.style.Fill({ color: '#ffffff' }),
                        font: 'bold 13px "Noto Sans KR", sans-serif'
                    })
                });
            } else {
                // 개별 마커: 내부 Feature의 기존 스타일(아이콘+라벨) 그대로 사용
                return clusterFeatures[0].getStyle();
            }
        },
        zIndex: 10
    });

    cctvMap.addLayer(cctvMarkerLayer);
}
