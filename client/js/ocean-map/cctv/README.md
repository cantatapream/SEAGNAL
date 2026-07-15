# cctv  `local_server/js/ocean-map/cctv/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `cctv1.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | — |
| `cctv4.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `handleCctvMapClick`, `showCctvPopup`, `_initCctvHlsPlayer`, `_startCoastImageRefresh`, `_stopCoastImageRefresh`, `_initSeafogSlider` |
| `ocean_cctv.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `_buildInfoHtml`, `_buildSingleStyle`, `_buildFeatures`, `_ensureCctvLayer`, `_favLocStyle`, `_ensureFavLocLayer` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
