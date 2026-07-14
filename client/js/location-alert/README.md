# location-alert  `local_server/js/location-alert/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `location_alert_background.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `prefsPlugin`, `prefsSet`, `prefsRemove`, `isNative`, `savePosition`, `getPosition` |
| `location_alert_core.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `canonZone`, `toLngLat`, `haversineMeters`, `bearingDeg`, `pointInRing`, `pointInPolygon` |
| `location_alert_runtime.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `getCore`, `decideAlert`, `tierOfZone`, `loadFeatures`, `showLocalNotification`, `writeLastMatch` |
| `location_alert_ui.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `ls`, `ss`, `prefsSet`, `syncNativeFlags`, `syncNativeSubFlags`, `isAdminDevice` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
