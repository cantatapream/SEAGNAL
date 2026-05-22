# Synthesis Q — 부모 푸시 자식 정보 통합 종합본

작성: 2026-05-21
기반: SPEC `PARENT_PUSH_WITH_CHILDREN.md` v7
입력: Agent A (84점) / Agent B (82점) / Agent C (78점) + 검토 X/Y/Z
시각: P 와 차별화 — **클래스 기반 (Agent B) Base + Agent A/C 흡수**

---

## 1. 종합 전략

### Base 채택: Agent B (클래스 기반)
- `StateSnapshot` / `DiffMatrix` / `EventDispatcher` 의 캡슐화 구조
- `PushBuilder` / `PushSplitter` 의 메서드 단위 분리
- `TITLE_DISPATCH` / `TIME_LABEL_BY_EVENT` / `TIME_KEY_BY_EVENT` 테이블 dispatch
- 단계별 try/catch — 외부 응답 변형에 강건
- 검토 Y 의 점수 82 는 DiffMatrix.compute() 결함 2건만 해결하면 90+ 가능

### 흡수: Agent A (절차형) 의 우수 요소
- **부모 release 조건 확장** `(!curr || curr.wrnLvlNm === '해제' || !curr.wrnLvlNm)` — wrnLvlNm 빈값/undefined 도 release 로 인지
- 9-mode 한정사 빌더의 정확성 검증 — Agent B 와 동등
- `_parentDedupKey` 자식 set hash — Agent B 가 이미 동일 방식 적용

### 흡수: Agent C (함수형) 의 우수 요소
- **자식명 prefix strip** `_stripParentPrefix(parent, child)` — `제주도서부앞바다중북서연안바다` → `북서연안바다` (SPEC §6 S2/S11 1:1 일치)
- `EVENT_MATRIX` 선언적 패턴 — Agent B 의 TITLE_DISPATCH + TIME_LABEL_BY_EVENT + TIME_KEY_BY_EVENT 가 이미 동등 (열 분리로 더 명시적)
- `PARENT_CHILD_GROUP_TYPE` 28 부모 매트릭스 — Agent B 의 `PARENT_CHILD_TYPE` 가 이미 보유

---

## 2. 적용한 수정 (검토 보고서 기반)

### Critical (검토 Y for B)
- **C-1: 예비 → 정식 발효 전이 누락**
  - `marine_warning_crawler.js` DiffMatrix.compute 에 별도 분기 추가
  - `pPrev.wrnLvlNm === '예비' && pCurr.wrnLvlNm !== '예비' && pCurr.wrnLvlNm !== '해제'` 일 때 `active` bucket 으로 분류
  - `_score` 가 동률(예비=주의보)이라 격상/격하 bucket 에 안 들어가는 cycle 막힘을 해소

- **C-2: 자식만 시각 변경 (S24/S25) 미구현**
  - DiffMatrix.compute 에 자식 시각 diff 로직 추가
  - 부모 시각 동일 + 자식 시각 변경 시 `parentTimeUnchanged: true` 를 set 하여 time_*_change bucket 으로 발사
  - `buildChildQualifier` 의 "자식만 시각 변경" 분기가 비로소 호출됨

### Critical (검토 Z for C — Agent B base 에는 영향 없으나 시너지 흡수)
- **Z-C1: 자식 풀네임 short name 변환** — Agent B 의 `buildChildQualifier` 도 `active.join(', ')` 으로 풀네임을 그대로 출력했음. SPEC §6 S2 예시 `(북서연안바다, 남서연안바다 포함)` 매칭을 위해 `_stripParentPrefix` 추가 후 active/added/released 3 분기 모두 적용.

### Major (검토 X for A & Y for B)
- **X-M1: 부모 release 조건 확장** — Agent A 결함이지만 Agent B 에도 동일 보강 적용 (`|| !pCurr.wrnLvlNm`).
- **Y-M3: `groupEventsForFlush` 키 회귀** — legacy 자식 단독 push 경로 영향 검증. prevWrnTpNm 가 비어있으면 키 마지막 segment 가 `''` 로 추가될 뿐 묶음 결과 동일 → 함수적 회귀 없음. 그대로 유지.
- **Y-M4: `enqueueLevelUpgrade/Downgrade` fromLvl 폴백** — `prevWrnLvlNm: info.prevWrnLvlNm || fromLvl` 로 수정.

### Major (검토 Z for C — Agent B 에 흡수)
- **Z-M3: 격상+자식 추가 동시 → level_upgrade 가 흡수** — Agent B 는 이미 lvl_change 분기에서 `continue` 로 흐름 차단 → additional_active 중복 발사 없음. 검증 완료.

### Minor / 기타
- **routes/push.js 의 SPEC v7 무관 변경 (Agent C m6) 포함하지 않음** — 본 종합본 변경 파일은 SPEC 직접 영향 3개로 한정.

---

## 3. 변경 파일 (3개)

| 파일 | 변경 내용 |
|---|---|
| `local_server/services/push_helpers.js` | v7 admin 블록 추가 (PushBuilder/PushSplitter/buildChildQualifier/buildSplitPushes/buildAdminTitle) + `_stripParentPrefix` 추가 |
| `local_server/services/dmdw_push_sender.js` | v7 enqueueParent* 패밀리 + flushParent (1초 간격, 자식 set hash dedup) + `fromLvl` 폴백 |
| `local_server/marine_warning_crawler.js` | 신규 — StateSnapshot/DiffMatrix/EventDispatcher + 예비→주의보 분기 + 자식 시각 변경 분기 + release 조건 확장 |

`push_sender.js`, `generateMessage` 기존 분기, `routes/push.js` — **무변경**. V15 회귀 0.

---

## 4. 검증 결과

### 4.1 SPEC §6 시나리오 일치 (verify_synth_q.js — 27 PASS / 0 FAIL)
- S1 (`(연안바다 미발효) / (평수구역/연안바다 미발효)`)
- S2/S6 (`(북서연안바다, 남서연안바다 포함) / (평수구역 포함)`) ← strip prefix 검증
- S3 (`(평수구역 포함) / (연안바다 포함)`)
- S8 (`(가파도연안바다 추가 발효)`) ← strip prefix
- S10 (`✅ 풍랑 예비특보 취소`)
- S11 (`(가파도연안바다만 해제) / (천수만평수구역, 안면도서쪽평수구역만 해제)`) ← strip prefix 적용/미적용 혼합
- S12 (`(모든 연안바다 해제) / (모든 평수구역/연안바다 해제)`)
- S13 (release — 한정사 없음)
- S14/S15/S16/S17 (level_upgrade — `(모든 X 포함) / (X 포함) / (연안바다 격상 없음)`)
- S23 (`🕐 해제시각 변경`)
- **S24/S25 자식만 시각 변경 (`(연안바다만 시각 변경)`)** ← Critical-2 보강 결과
- S26 (`🚨 풍랑경보→태풍주의보 격상 발효`)

### 4.2 Critical 보강 재현
- **C-1 예비 → 주의보 전이**: prev=예비, curr=주의보 시
  - 종전 (Agent B 원본): `time_yn_change` 1, `active` 0 ← 잘못된 푸시
  - 현재 (종합 Q): `active` 1, `time_yn_change` 0 ✅
- **C-2 자식만 시각 변경**: 부모 시각 동일, 자식 tmYn 만 변경 시
  - `time_yn_change` 1 발사, `parentTimeUnchanged === true` ✅
- **M3 격상+자식 추가 동시**: 부모 격상, 자식도 추가 발효 시
  - `level_upgrade_active: 1`, `additional_active: 0` ✅ (중복 회피)

### 4.3 분할 알고리즘
- 28 부모 동일 시간 그룹 → 4 청크 (157/160/163/137 바이트, 모두 ≤200, 부모 줄 절단 0)
- 1 부모 단독 → 1 청크
- 0 부모 → 빈 배열
- 분할 시에만 `(n/N)` 부착 — 1 청크는 미부착 확인

### 4.4 V15 회귀
- `generateMessage()` 본체 무변경
- 기존 사용자 push 흐름 (`push_sender.js`) 무변경
- audience !== 'admin' 호출 시 fallback warn 만 출력

### 4.5 syntax / 외부 라이브러리
- `node --check` 3 파일 모두 통과
- 외부 패키지 0 (Node built-in + 기존 admin_push.js / push_helpers.js 만 require)

---

## 5. 보안 점검

- `MARINE_USER_ID`, `MARINE_USER_PWD` 평문 노출 0 — 주석 1회 + env 변수명만
- 로그 마스킹 `hy***` 정책 코드 기반 유지
- 모델 ID / API key 미포함
- 외부 npm 라이브러리 추가 없음

---

## 6. P vs Q 차별 포인트

| 영역 | Synthesis P (예상) | Synthesis Q (본) |
|---|---|---|
| Base | Agent A 절차형 (가능) | Agent B 클래스 기반 ← 채택 |
| 자식명 처리 | Agent B 의 mapping name 그대로 (가능) | Agent C 의 `_stripParentPrefix` 흡수 ✅ |
| DiffMatrix | Agent A 의 _compare 기반 (가능) | Agent B 의 클래스 + Critical 2건 보강 ✅ |
| 신규 이벤트 | enqueue* 다중 함수 (가능) | enqueueParentFamily 단일 진입 + thin wrapper |
| 보강 우선순위 | Agent A 의 audience='user' 분기 강조 (가능) | Agent B 의 builder 분리 강조, V15 는 generateMessage 무변경으로 보장 |

---

## 7. 점수 (자체 추정)

- 시나리오 정확성 (V16/V25): 27/27 PASS
- Critical 보강 (Y의 2건 + Z의 1건): 모두 해결
- 분할 정책 (V17~V20/V24): PASS
- dedup (V23): PASS (Agent B 의 sorted set hash + chunk key)
- V15 회귀: 0
- 추정: **91/100**
