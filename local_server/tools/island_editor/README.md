# island_editor — 섬 테두리 · 해안 관광지 편집기

해안 안전 예보(`client/js/ocean-map/coastal-risk/coastal_safety_forecast.design.md` §6)를 위해
사람이 직접 **①작은 섬 테두리를 그리고 ②해안 관광지 중 뺄 곳을 고르는** 단독 HTML 편집기.

| 파일 | 설명 |
|---|---|
| `island_editor.html` | **받아서 더블클릭하면 열리는 완성본**(약 1MB — OpenLayers·데이터 내장). 배경지도 타일만 인터넷 필요 |
| `island_editor.template.html` | 화면·동작 원본. 직접 열지 않는다 |
| `build_island_editor.js` | 틀 + OpenLayers + 데이터를 합쳐 `island_editor.html` 을 만든다 |

## 다시 만들기

데이터(`local_server/config/coastal_safety/island_targets.json`·`coastal_spots.json`)나 틀을 고쳤으면:

```
node local_server/tools/island_editor/build_island_editor.js
```

## 쓰는 법

- **① 섬 테두리 그리기**: 목록에서 섬을 누르면 그 좌표로 이동한다 → "새 테두리 그리기" → 섬 둘레를 클릭, 마지막 점을 두 번 클릭.
  점은 끌어서 옮기고, "점 삭제 모드"로 지운다. 노란 점선은 앱이 지금 가진 해안선(`client/land_mask_korea.json`).
- **② 해안 관광지 검토**: 점을 누르면 제외(빨강), 다시 누르면 되돌림. 이름 검색 가능.
- **내보내기**: `island_editor_export_YYYY-MM-DD.json` 한 파일에 섬 테두리(GeoJSON, 경위도 소수 6자리)와 제외 목록이 함께 담긴다.
  작업은 브라우저에 자동 저장되고, "불러오기"로 내보낸 파일을 다시 열 수 있다.

## 내보내기 파일 형식

```json
{
  "type": "seagnal_island_editor_export", "version": 1, "exported_at": "...",
  "island_outlines": { "type": "FeatureCollection", "features": [
    { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [[[lon, lat], ...]] },
      "properties": { "target_id": 1, "name": "팔미도", "spot": "인천 팔미도 등대", "sgg": "28110", "drawn_at": "..." } } ] },
  "excluded_spots": [ { "key": "26350|해운대해수욕장", "name": "...", "sgg_name": "...", "lat": 0, "lon": 0 } ],
  "custom_targets": [ { "id": "c...", "name": "...", "group": "custom", "lat": 0, "lon": 0 } ]
}
```

비슷한 도구: `local_server/tools/build_standalone_editor.js`(해구↔특보구역 편집기 단독본).
