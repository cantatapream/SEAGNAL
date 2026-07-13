# settings  `local_server/js/settings/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `settings.js` | 탭 시스템, 스타일 주입, 사용자 설정, 알림 설정, 위치 기반 검색 | `initTabs`, `injectTabStyles`, `injectGlobalStyles`, `initNotificationUI`, `updateRadioVisual`, `updateMasterState` |
| `zone_guide.js` | 관심 해역 설정 유도 팝업 (1회성 넛지) | `checkZoneGuide`, `isAllZonesOn`, `showZoneGuideModal`, `showZoneGuideToast` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
