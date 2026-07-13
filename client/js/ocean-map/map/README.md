# map  `local_server/js/ocean-map/map/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `ocean_map.js` | 해양종합정보 지도 초기화 + 베이스맵 전환 + 기본 인터랙션 | `createKhoaLayer`, `_bboxOfRing`, `initMarineZoneGridLayers`, `bindMarineZoneGridToggle`, `_isSubVisibleZoom`, `_styleSelectedMainFeature` |
| `ocean_markers.js` | 해양종합정보 조석 표준항 마커 + 클릭 처리 | `initOceanMarkers`, `showOceanMarkers`, `handleOceanMarkerClick` |
| `ocean_northup.js` | 해양종합정보 지도의 "진북(North Up)" 회전 컨트롤 | `_renderButton`, `_rotateToNorth`, `_setRotateInteraction`, `_toast`, `_applyState`, `_onClick` |
| `ocean_overlay.js` | 해양현황 캔버스 오버레이 (해류/바람/파고 색상 + 파티클 애니메이션) | `_hideOverlayCanvas`, `_onCompositePrerender`, `_hookParticleCompositing`, `_offsetToDateHour`, `resizeCanvas`, `setActiveLayer` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
