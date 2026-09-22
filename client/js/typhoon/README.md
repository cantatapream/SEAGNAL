# typhoon  `local_server/js/typhoon/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `location_alert_typhoon_runtime.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `getRadius`, `getMessage`, `framesOf`, `decideTyphoonAlerts`, `notifIdForSeq`, `_refOfTyphoon` |
| `ocean_typhoon.js` | 해양종합 지도(OpenLayers)에 "태풍" 오버레이 + 재생 애니메이션을 표출. 자료 출처(한국 기상청 / 미국 JTWC)를 드롭다운으로 전환한다. | `cssRgb`, `beaufortWaveM`, `dir16`, `dirStr`, `asymNote`, `haversineKm` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
