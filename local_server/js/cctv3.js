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
//   - 속성   → cctvId, name, subtitle, providerName, shareUrl
//              (클릭 핸들러 cctv4.js에서 꺼내 사용)
//
// [연계]
//   - cctv1.js CCTV_PROVIDERS        — 데이터 순회
//   - cctv2.js cctvMap, cctvMarkerLayer — 지도 인스턴스/레이어 변수
//   - cctv4.js handleCctvMapClick()  — Feature 속성 읽어 팝업 표출
//   - cctv2.js initCctvMap()         — 지도 초기화 완료 후 이 함수 호출
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
 *   KBS API 좌표는 WGS84(경위도)이므로
 *   OpenLayers 내부 좌표계인 EPSG:3857(Web Mercator)로 변환합니다.
 *   → ol.proj.fromLonLat([경도, 위도])
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
    // 제공기관 순회: CCTV_PROVIDERS의 각 키(kbs, 추후 localGov 등)마다 처리
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
                providerName: provider.name,
                shareUrl:     provider.shareUrl(item.cctvId)
            });

            // ── 마커 스타일: PNG 아이콘 + 아이콘 아래 지점명 라벨 ──
            feature.setStyle(new ol.style.Style({

                // PNG 이미지 아이콘
                image: new ol.style.Icon({
                    // /images/cctv_image.png — local_server/images/ 경로
                    src: '/images/cctv_image.png',
                    // 앵커: [0.5, 1.0] → 이미지 하단 중앙이 실제 좌표 위치에 오도록
                    // (핀 형태 이미지일 경우 끝점이 정확히 해당 지점을 가리킴)
                    anchor: [0.5, 1.0],
                    anchorXUnits: 'fraction',
                    anchorYUnits: 'fraction',
                    // 스케일: 조석정보 마커와 유사한 크기 (~28-32px 표시)
                    scale: 0.07
                }),

                // 지점명 텍스트 라벨 — 아이콘 아래 중앙 배치
                // (조석정보의 표준항 마커와 동일한 방식)
                text: new ol.style.Text({
                    text: item.name,
                    offsetX: 0,     // 수평 중앙 정렬
                    offsetY: 10,    // 아이콘 아래쪽으로 배치
                    textAlign: 'center',
                    fill: new ol.style.Fill({ color: '#ffffff' }),
                    // 검정 외곽선으로 어떤 배경(밝은 지도/어두운 지도)에서도 읽기 쉽게
                    stroke: new ol.style.Stroke({ color: '#000000', width: 3 }),
                    font: 'bold 11px "Noto Sans KR", sans-serif'
                })
            }));

            allFeatures.push(feature);
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // 모든 Feature를 하나의 벡터 레이어로 묶어 지도에 추가
    // zIndex: 10 → OSM 배경(zIndex 0)보다 위에 표시
    // ─────────────────────────────────────────────────────────────────
    cctvMarkerLayer = new ol.layer.Vector({
        source: new ol.source.Vector({ features: allFeatures }),
        zIndex: 10
    });

    cctvMap.addLayer(cctvMarkerLayer);
}
