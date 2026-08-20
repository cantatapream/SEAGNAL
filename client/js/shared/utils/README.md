# utils  `local_server/js/shared/utils/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `mappings.js` | 연안바다/평수구역 매핑, 부이 위치 매핑, 부이 타입 정의 | — |
| `accident_codes.js` | 사고정보(선박심판원·인명) `_CD` 코드값 → 한글 라벨 매핑(사고유형·해역) + 주/야간 판정 헬퍼(선박(해경) 전용이던 발생원인·선박종류·관할해경서 라벨과 `accidentIsDaytimeFromHM`은 2026-08-20 해경 소스 제외로 함께 삭제) | `accidentLabel`, `accidentIsDaytimeFromTmz` |
| `utils.js` | 전역 상태(appState), 유틸리티 함수, 날짜/시간 포맷팅 | `getSeaArea`, `formatDate`, `formatWarningTime`, `getKfTime`, `getProxiedUrl`, `decodeHtmlEntities` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
