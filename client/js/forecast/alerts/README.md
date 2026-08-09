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

## 설계 문서 (이 폴더의 `.design.md`)

| 문서 | 내용 | 언제 읽나 |
|------|------|-----------|
| `mmis_history.design.md` | **특보 시스템의 단일 권위 문서.** MMIS 엔드포인트 메커니즘(§2) · 시나리오 상태머신(§4) · 사용자 표출 정책(§5) · **시행착오 timeline(§6)** · 현재 상태(§7) · 부록·용어집(§8) | 특보 관련 코드를 건드리기 전에 **반드시**. 특히 §7 은 현재 운영 상태의 유일한 권위 |
| `child_confirm.design.md` | 자식해역(연안바다·평수구역) **"확정 후 발사"** 설계안 — 관찰창 규칙·이벤트별 발사 정책·사용자 확정 사항(원문 인용 포함) | 자식 한정사·GAP 구간·푸시 발사 시점을 건드릴 때 |
| `fmttime_fix.design.md` | 시각 표기(`formatWarningTime`) 정정 이력 | 시각 포맷을 건드릴 때 |

### 자식해역 오표기 — 반복 사고이므로 먼저 볼 것

`(모든 평수구역/연안바다 포함)` 같은 자식 한정사 오표기는 **6회 재발**했다(6/2·6/19·6/20·7/14·7/18·8/8).
매번 증상이 나온 *경로*만 막고 *집계 기준*을 안 건드려서 수렴하지 않았다.

- 최종 해법 → `mmis_history.design.md` **§7.7.26**(자식 정합 필터) · **§7.7.27**(자식 확정 관찰창)
- 무엇이 왜 틀렸는지 → 같은 문서 **§6.8** (오진 3연속 · 상한 2회 삽입·철회 · 새 게이트가 기존 디바운스를 먹은 건 · 대기 상태 도입의 부작용 · 사용자 의도 왜곡 · 검증 게이트 공백)
- 핵심 원칙 — **모르는 것을 지어내서 메우지 않는다. 모르면 기다린다. 기다려도 없으면 없는 것으로 한다.**

## 회귀 테스트

이 폴더의 표출·푸시 정책은 서버 쪽 스위트가 지킨다. **모두 `scripts/refactor/verify_all.sh` 의 `SUITES` 배열에 등록돼 있어야 돌아간다** — 등록 누락이 위 5회 재발의 근본 조건이었다.

| 스위트 (`local_server/scripts/`) | 지키는 것 |
|---|---|
| `test_child_relevance.js` | 자식 정합 필터 — "이번 특보에 해당하는 자식"만 집계 |
| `test_child_confirm.js` | 자식 확정 관찰창 — 대기·재관찰·만료·폐기·복원 |
| `test_child_unknown_gate.js` | 자식 정보 '미상' 게이트 — 모르면 침묵 |
| `test_ef_exact_refine.js` | 범위형 → 정확시각 정밀화 통지 |
| `test_cancel_verdict_room.js` | 예비취소 판정 보류실 |
| `test_push_pagination.js` | 푸시 본문 분할 |
| `test_bulletin_cancel_scanner.js` | 통보문 취소 스캐너 |

## 로드 순서

index.html 의 script 태그 순서를 따름 — 변경 금지 (번들러 없음).
