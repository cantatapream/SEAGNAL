# alerts  `local_server/js/forecast/alerts/`

> 이 폴더의 파일별 상세 설명은 각 `<파일명>.guide.md` 참고 (단일 파일이면 이 문서에 통합).
> 이 초안은 파일 헤더의 `역할:` 에서 자동 생성됨 — 데이터 흐름·주의사항은 검수하며 보강.

## 파일 구성

| 파일 | 역할 | 주요 함수 |
|------|------|-----------|
| `alert_history.js` | 특보 히스토리 팝업 모달 (해역별 통보문 이력 조회) | `createZoneBulletinItem`, `formatBulletinTime`, `createHistoryItem`, `loadBulletinContent`, `renderBulletinContent`, `renderFallbackContent` |
| `data.js` | 데이터 수집(fetchAllData), 부이 데이터, API 상태 관리 | `fetchAllData`, `loadBackgroundData`, `refreshAlertData`, `flattenAlertsData`, `recursiveFind`, `_isExactSingleTime` |
| `marine.js` | 해구별 기상정보 모달, 해양 차트 렌더링 | `parseMarineZoneData`, `_tmKst`, `formatMarineTime`, `trimPastMarineRows`, `_mmisFctTmToUtcKey`, `_kstTmToMs` |
| `render.js` | 메인 UI 렌더링 (renderApp, createAlertElement) | `renderApp`, `createAlertElement` |
| `render_coastal.js` | 연안 구역 렌더링, 부이 데이터 표시, 로딩/시간 업데이트 | `displayBuoyInfo`, `createDataBox`, `formatBuoyTime`, `createCoastalElement`, `updateLoading`, `toggleSection` |
| `zone_avg.js` | (역할 헤더 없음 — STEP 6 에서 작성 필요) | `onReady`, `_flushReady`, `_normalizeName`, `_buildNameIndex`, `init`, `_parseTm` |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
