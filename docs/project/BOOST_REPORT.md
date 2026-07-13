# Boost Report — E-1 / E-2 / E-4 운영 안전성 보강

본 보고서는 `0d490e3` (followup-marine-v7-integration) 위에 추가된 3건 보강의 위치와 검증 결과를 정리한다.

## 1. 보강 위치

### E-2 (Must-fix) — weather_alerts.json 갱신

**파일**: `local_server/marine_warning_crawler.js`

- `_createZoneSkeleton()` — 동/서/남/제주 4 sea 트리 skeleton 생성. 기존 `weather_alerts_crawler.createZoneStructure()` 와 동일한 leaf 키 셋. 각 leaf 는 `{ current, upcoming, history, children }`.
- `_collectLeafZonesByName(tree)` — tree 를 재귀 순회하여 (current+children 보유 노드 = leaf zone) 만 부모이름 → 노드 Map 으로 수집.
- `_buildZoneTreeFromSnapshot(snap)` — StateSnapshot → zone tree 변환.
  - 부모: `wrnLvlNm === '예비'` → `upcoming`, 그 외 (주의보/경보) → `current`.
  - 자식: skeleton 의 children 객체에 등록된 자식만 채움. `예비` 는 dedup 정책에 맞춰 `wrnLvlNm '주의보'` 정규화 (downstream 푸시 dedup 일관성 보장).
  - 각 객체에 `source: 'MARINE_MMIS'` 표식 — 머지 대상 식별.
- `_writeWeatherAlertsJson(prev, curr)` — atomic write.
  - 디스크 read → `lastReportId`, `processedReportIds`, `pendingRetries`, `oneTimeBulletinWindowOverride`, 각 leaf 의 `history` 보존.
  - 새 `current` / `previous` 트리만 덮어쓰기.
  - `updatedAt` 한국어 KST 시각 (기존 포맷 호환).
  - `tmp → rename` atomic.

**호출 지점**: `run()` 의 cycle 끝, `_savePrevSnapshot(curr)` 직후. (E-1 first cycle guard 분기에서도 호출 — prev=empty, curr=수집결과.)

### E-1 — 첫 cycle 가드 (push skip + state 저장만)

**파일**: `local_server/marine_warning_crawler.js`

- `_isSnapshotEmpty(snap)` — parents+children 모두 비었으면 true.
- `run()`:
  - `isFirstLoad = (_prevSnapshot === null)` — 모듈 부팅 후 첫 호출인지 lazy load flag.
  - `_loadPrevSnapshot()` 결과가 `_isSnapshotEmpty` 이고 `isFirstLoad` 면:
    - 로그 `[Marine] 첫 부팅 — push skip, state 저장만 (현재 발효 부모=N, 자식=M)`
    - `_savePrevSnapshot(curr)` + `_writeWeatherAlertsJson(empty, curr)` 만 수행
    - 빈 배열 반환 (push 0)

### E-4 — Promise.allSettled 부분 실패 시 cycle skip

**파일**: `local_server/services/marine_client.js` + `local_server/marine_warning_crawler.js`

`marine_client.js`:
- `fetchAllRealtimeEndpoints()` 신규 함수.
  - 4 endpoint (`fetchWarnList`, `fetchWarnSascList`, `fetchWarnReady`, `fetchWarnSascReady`) 를 `Promise.allSettled` 로 묶음 호출.
  - 하나라도 `status === 'rejected'` 면 `Error('marine endpoint 부분 실패: ...')` 에 `partial=true`, `failedEndpoints=[...]` 메타 부여하여 throw.
  - 모두 fulfilled 이면 `{ warnList, warnSascList, warnReady, warnSascReady }` 반환.
- module.exports 에 추가.

`marine_warning_crawler.js`:
- `run()` 의 endpoint fetch 부분이 `try/catch` 로 `marineClient.fetchAllRealtimeEndpoints()` 호출.
- catch 시 로그 `[Marine] endpoint 부분 실패 — cycle skip (이번 1분 발사 0): <failedEndpoints>` 출력 후 빈 배열 반환.
- state 파일·weather_alerts.json 모두 미변경 → 마지막 성공 state 유지.

**정상 빈 응답 처리**: `_unwrap` 이 빈 응답 → `[]` 반환. 4개 모두 성공한 빈 배열이면 cycle 정상 흐름 (zone 해제 → release 푸시) — 이는 "정상 zone 0" 의 의도된 동작.

## 2. 검증 결과

### syntax
- `node -c local_server/marine_warning_crawler.js` — pass
- `node -c local_server/services/marine_client.js` — pass

### inline 시나리오 (9 / 9 pass)

1. skeleton 생성 — 동/서/남/제주 4 sea, 울산앞바다 leaf, 경남서부남해앞바다 신규 자식 4개 모두 등록 확인
2. populated snapshot → tree 변환 — 강원북부 주의보, 울산앞바다 예비 (upcoming), 자식 객체 잘 채워짐
3. `_writeWeatherAlertsJson` atomic write — `lastReportId`, `processedReportIds`, `pendingRetries`, `oneTimeBulletinWindowOverride`, leaf 의 `history` 보존 / tmp leftover 0
4. `_isSnapshotEmpty` — empty/populated/null 케이스 모두 정확
5. **E-1**: state 파일 없는 상태에서 `run()` → push 0회 + state 파일 생성 + weather_alerts.json 갱신
6. 두 번째 cycle (state 존재) → 정상 diff/push, weather_alerts.json 갱신 (강원중부 추가됨)
7. **E-4**: endpoint partial fail (throw) → cycle skip, state 파일 / weather_alerts.json 미변경
8. **E-4 정상 빈 응답**: 4개 모두 성공 + 빈 배열 → 정상 cycle (강원북부 해제 → release 푸시 1건)
9. `fetchAllRealtimeEndpoints` 함수 export 확인

### 회귀 (3 / 3 pass)
- S1 (negative → positive parent) → active 1건
- S2 (release) → release 1건
- S10 (예비 → 사라짐) → prelim_cancel 1건

## 3. downstream 영향

- `routes/weather.js` (mergeDmdwChildren, getWeatherAlertsResponse) — current/children shape 기반 walk. 동일 shape 유지 → 영향 0.
- `services/cache_manager.js` (warnings: 'weather_alerts.json' 키) — 파일 mtime 기반 캐시 무력화 자동 동작.
- `services/freshness.js` (warnings stale 감지) — `updatedAt` 갱신으로 fresh 유지.
- `routes/admin.js` (children-reset) — zone leaf shape 기반 walk 그대로.

## 4. 자격증명·보안

- 코드/로그/리포트/커밋 어디에도 평문 ID/PWD 미포함.
- 로그 마스킹 `hy***` 정책 (marine_client.maskUserId) 그대로 유지.
- 모델 ID / 자격증명 / 외부 라이브러리 추가 0.

## 5. legacy 보존

- `weather_alerts_crawler.js` / `dmdw_warn_crawler.js` 절대 미삭제.
- scheduler.js 의 비활성화 주석 (rollback 가이드) 그대로 유지.
