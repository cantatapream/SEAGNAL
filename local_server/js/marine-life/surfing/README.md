# surfing  `local_server/js/marine-life/surfing/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `surfing1.js` | 서핑지수 프론트엔드 - 기본 구조 / 상태 / 지도 초기화 / 데이터 로드 / 유틸함수 | `_createSurfingMyLocElement`, `_showSurfingMyLocMarker`, `_goToSurfingMyLocation`, `_openSurfingNoticePopup`, `_bindFloatingControls`, `_loadSurfingData` |
| `surfing2.js` | 서핑지수 프론트엔드 - 마커 렌더링 / 범례 / "서핑지수란?" 버튼+팝업 | `_renderMarkers`, `_selectMarker`, `_resetMarkerStyle`, `_addLegendControl`, `_addGuideControl`, `_openGuidePopup` |
| `surfing3.js` | 서핑지수 프론트엔드 - 팝업 열기/닫기 + 이벤트 바인딩 + 날짜 네비게이션 | `_bindEvents`, `_openPopup`, `_closePopup` |
| `surfing4.js` | 서핑지수 프론트엔드 - 팝업 콘텐츠 렌더링 (서핑지수 테이블 + 상세정보) | `_renderPopupContent`, `_buildIndexTable`, `_buildAlertInlineHtml`, `_buildDetailTableAmPm`, `fmt`, `_buildDetailCompact` |
| `surfing5.js` | 서핑지수 프론트엔드 - 해상특보 맵 구축 + 해상특보 HTML 생성 | `_buildAlertMap`, `traverse`, `_buildAlertHtml`, `_esc` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
