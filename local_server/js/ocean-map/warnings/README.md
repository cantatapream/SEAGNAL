# warnings  `local_server/js/ocean-map/warnings/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `ocean_warn_active1.js` | 해양종합정보 지도 위에 "현재 활성/다가오는 특보"를 색칠하고, | — |
| `ocean_warn_active2.js` | appState.alerts 배열을 부모 zoneName 단위로 묶어 "활성 맵(activeMap)" | `_ensureSubToParent` |
| `ocean_warn_active3.js` | OceanWarnZone.setActiveStyler 에 등록할 스타일 함수 구현. | `_stripeFillPattern`, `_getHoledOlGeom`, `_coloredStyle`, `_dimmedOutlineStyle`, `_subLabelOnlyStyle` |
| `ocean_warn_active4.js` | 우측 컨트롤 스택의 "🚨 ON/OFF" 토글 버튼을 바인딩하고, | `_getButton`, `_isWarnZoneOn`, `_setLegendVisible`, `_onToggleClick` |
| `ocean_warn_active5.js` | 부모 zone 클릭 시 어두운 남색 정보 박스 표출, 외부 클릭 자동 close, | `_fmtTime`, `_findHitParentZone`, `_findHit`, `_buildTypeText`, `_renderAlertBlock`, `_esc` |
| `ocean_warn_vsby.js` | 해역별 특보 현황 아코디언의 각 특보구역 카드에 "시정(visibility) 뱃지" | `_normName`, `_hexToRgb`, `_bucketIndex`, `_fmtKm`, `_clamp`, `_parseTm` |
| `ocean_warn_zone.js` | 해양종합정보 지도에 KMA 해상 예특보구역 폴리곤 outline 표출 | `_normalizeZoneName`, `_zoneStyle`, `_shortLabel`, `_buildSubZoneTextStyle`, `_subZoneStyle`, `_onlyFill` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
