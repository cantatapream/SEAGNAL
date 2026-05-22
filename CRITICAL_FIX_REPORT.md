# CRITICAL FIX REPORT — Must-fix (fmtTime dot) + D-medium (옵션 C)

base commit: `a515853 fix(marine): D-1/D-2/D-6 시간 형식 변환 + 가드 보강`
worktree:    `/home/user/SEAGNAL/.claude/worktrees/agent-a88b0232315d47bc7`
branch:      `worktree-agent-a88b0232315d47bc7`

## 1. Must-fix — fmtTime dot 패턴

### 위치
`local_server/services/push_helpers.js` 의 `fmtTime` 함수 (line ~666).

### 변경 내용
한글 패턴 (`2026년 02월 07일 …`) 처리 다음, 최종 fallback (`return str`) 직전에 mmis dot
형식 (`YYYY.MM.DD HH:MM`) 매칭 분기 5줄 삽입. parseInt(day,10) 으로 leading-zero 정리.

### 검증
- fmtTime("2026.05.21 06:00") → "21일 06:00"  PASS
- fmtTime("2026.12.03 14:30") → "3일 14:30"   PASS (leading-zero 처리)
- 기존 패턴 5종 (대시/12자리/한글/공백시간/빈값) 회귀 없음 — 6/6 PASS
- v7 admin push body 에 dot 형식 노출 0건 (fmtTime 통과 후 결과에 '.' 없음)

## 2. D-medium — mmis 빈 응답 폭주 방어 (옵션 C)

### 위치
`local_server/marine_warning_crawler.js`
- 신규 인프라: line 523~640 (`_loadSuspiciousState` / `_saveSuspiciousState` /
  `_classifyReleases` / `_applySuspiciousGuard`)
- run() 통합: diff/dispatch 직전 `_applySuspiciousGuard(prevForDiff, curr)` 호출
- exports: 테스트용 노출 추가

### 알고리즘 요약 (옵션 C)
1. `_classifyReleases(prev, curr)` — 사라진 zone 을 두 분류
   - normalReleases: `clr_ntc_tm` 등록 → 정상 해제로 인정 (release 분기 진입)
   - suspiciousZones: 미등록 → 의심 (mmis 누락 가능성)
2. SUSPICIOUS_THRESHOLD (=3) 이상 의심 시:
   - cycleCount 누적, firstSeenAt 기록, 디스크 영속화
   - 의심 zone 을 `curr.parents` 에 prev 정보로 복원 → "발효 중" 위장 → 해당 cycle release 보류
3. MAX_SUSPICIOUS_CYCLES (=10) 도달 시 강제 해제 인정 (curr 복원 X → 정상 release 흐름) + state reset
4. 의심 미달 (threshold 미만) 또는 mmis 회복 → state reset

### 디스크 영속화
- 파일: `local_server/data/marine_suspicious_state.json`
- atomic write (tmp → rename) — 재배포 시 의심 상태 복원

### 검증 시나리오 (18/18 PASS)
| # | 시나리오 | 기대 | 결과 |
|---|----------|------|------|
| S1 | 8 zone 모두 clr_ntc_tm 등록 → curr=0 | 정상 release 8건 | PASS |
| S2 | 5 등록 + 3 미등록 → curr=0 | 5 release + 3 cycle skip | PASS |
| S3 | 8 미등록 → curr=0 | 전부 cycle skip, state 시작 | PASS |
| S4 | 의심 후 zone 재등장 | reset cycleCount=0 | PASS |
| S5 | 9 cycle 누적 + 1 cycle 추가 (10 도달) | 강제 release 진행 | PASS |
| S6 | 2 미등록 (< threshold) → curr=0 | 정상 release, 가드 미작동 | PASS |
| S7 | 디스크 round-trip | save→load 동일 | PASS |
| S8 | 이미 '해제' 상태 zone 제외 | 의심 후보에서 빠짐 | PASS |

기존 release 분기 (S11/S12/S13) 는 본 가드가 curr 를 수정하기 직전에만 작동하며,
정상 해제 (clr_ntc_tm 등록) 는 curr 가 그대로 비어있는 채로 DiffMatrix 에 도달 →
release 이벤트 정상 발사. 회귀 없음.

## 3. 보안

- 평문 자격증명 0건, 모델 ID 미포함, 로그 마스킹 `hy***` 유지.
- 신규 코드는 fs/path/JSON 만 사용 (외부 라이브러리 추가 없음).

## 4. syntax / lint

- `node -c local_server/services/push_helpers.js` OK
- `node -c local_server/marine_warning_crawler.js` OK
- 양 모듈 require 성공 (`node -e "require('./...')"`)
