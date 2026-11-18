# map  `local_server/js/ocean-map/map/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `ocean_map.js` | 해양종합정보 지도 초기화 + 베이스맵 전환 + 기본 인터랙션 | `createKhoaLayer`, `_bboxOfRing`, `initMarineZoneGridLayers`, `bindMarineZoneGridToggle`, `_isSubVisibleZoom`, `_styleSelectedMainFeature` |
| `ocean_markers.js` | 해양종합정보 조석 표준항 마커 + 클릭 처리 | `initOceanMarkers`, `showOceanMarkers`, `handleOceanMarkerClick` |
| `ocean_northup.js` | 해양종합정보 지도의 "진북(North Up)" 회전 컨트롤 | `_renderButton`, `_rotateToNorth`, `_setRotateInteraction`, `_toast`, `_applyState`, `_onClick` |
| `ocean_overlay_labels.js` | 색칠 지도 위 수치 라벨 그리기 — 풍향·풍속/파고·파향 등치선+값, 유향·유속 화살표+값 | `contourSegments`, `drawContourLines`, `drawContourLabels`, `drawCurrentLabels`, `contourLabelText`, `currentLabelText`, `pickGridStep` |
| `ocean_overlay.js` | 해양현황 캔버스 오버레이 (해류/바람/파고 색상 + 파티클 애니메이션) | `_hideOverlayCanvas`, `_onCompositePrerender`, `_hookParticleCompositing`, `_offsetToDateHour`, `resizeCanvas`, `setActiveLayer` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).

## 수치 라벨 (2026-11-18 사용자 확정)

오른쪽 버튼으로 유향·유속 / 풍향·풍속 / 파고·파향을 켜면, 색 위에 그 자리 값이 글자로 **늘** 함께 나온다(끄는 버튼 없음).

| 항목 | 모양 | 밀도 |
|------|------|------|
| 풍향·풍속 | 색 경계 등치선(2·5·8·12·16·20 m/s) + 선 위 값 알약 | 빽빽(같은 선 170px·다른 라벨 70px) |
| 파고·파향 | 색 경계 등치선(0.5·1·1.5·2·3·4 m) + 선 위 값 알약 | 빽빽 |
| 유향·유속 | 흰 화살표(검정 테두리, 흘러가는 쪽) + 값 — 방위 글자·동그라미 없음 | 보통(라벨 중심 84px 이상, 0.25°~3° 격자) |

- 범례를 눌러 m/s ↔ kts 로 바꾸면 라벨도 같이 바뀐다(파고는 m 고정). 바텀시트에서 바꿔도 같다(`oceanOverlayUpdateLegend`).
- 라벨은 그림일 뿐 누름 처리가 없다 — 지도를 누르면 종전대로 지도 자체의 동작(바텀시트)만 일어난다.
- 그리는 자리: `ocean_overlay.js` 의 `renderGridToOffscreen` 이 색과 같은 값으로 등치선을 긋고(육지 펀치아웃 전),
  `_renderLabels` 가 라벨 전용 캔버스에 라벨을 그린다. `animate` 가 히트맵 → 흰 흐름선 → 라벨 순으로 합성한다.
- 검색창·지도 버튼·색 범례·특보 범례 밑에는 라벨을 놓지 않는다(`_labelAvoidRects`). 육지·자료 없는 칸에도 안 놓는다.
- 시험: `local_server/scripts/test_ocean_overlay_labels.js` (verify_all SUITES 등록).
