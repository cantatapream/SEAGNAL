# 자식해역 특보 표출 — 3.2 오류 처리 정책

## 0. 본 파일의 위치

본 파일은 `03_OPERATIONS/` 시리즈의 두 번째 파일이며, 이전 파일(`01_error_classification.md`)에서 분류한 각 오류 유형의 **처리 흐름**을 정리합니다.

---

## 1. 처리 정책 개요

### 1.1 일반 처리 원칙

오류 처리에는 다음 일반 원칙이 적용됩니다.

- 시스템 정지 없음 — 한 오류로 전체 시스템이 멈추지 않음
- 보수적 판정 우선 — 모호한 경우 사용자 안전 측으로
- 영속화 우선 — 오류 발생 사실은 반드시 기록
- 사용자 알림 최소 — 자식해역에 푸시 없음. 운영자 알림만

### 1.2 처리 단계 표준

각 오류는 다음 4단계로 처리됩니다.

```
[Step 1] 감지 및 검증
[Step 2] 보수적 처리 (시스템 동작 유지)
[Step 3] 로그 기록 (subregion_error_log.json)
[Step 4] 운영자 알림 (필요 시 푸시)
```

---

## 2. MAPPING_MISSING 처리 흐름

### 2.1 흐름

```
1. 방재기상 응답에서 자식 행 추출
2. lookupAppName(regId) 호출
3. null 반환 → 매핑 누락
4. unmapped 섹션에 추가 (또는 카운트 증가)
5. 오류 로그 기록 (서술형)
6. 첫 발생 시 관리자 푸시
7. 그 행 무시, 다음 행 처리 계속
```

### 2.2 함수 형태

```
function handleMappingMissing(afsoRow, parentRegId):
  recordUnmapped(afsoRow)

  isFirstOccurrence = !errorExistsInLog("MAPPING_MISSING", afsoRow.regId)

  recordError({
    errorType: "MAPPING_MISSING",
    info: {
      function: "lookupAppName",
      file: "subregion_judge.js",
      afsoRegId: afsoRow.regId,
      afsoRegKo: afsoRow.regKo,
      parentRegId: parentRegId,
      wrnTp: afsoRow.wrnTp,
      wrnLvlName: afsoRow.wrnLvlName
    },
    narrative: ${nowKo()}, 방재기상시스템에서 자식해역 정보를 받았으나 우리 앱의 매핑 테이블에 등록되지 않은 해역이 있습니다. 방재기상 코드 ${afsoRow.regId}, 방재기상 이름 ${afsoRow.regKo}, 부모해역 ${parentRegId}, 발효 특보 ${afsoRow.wrnTp} ${afsoRow.wrnLvlName}.,
    actionRequired: region_alias_map.json 파일에 이 해역을 추가해주세요.
  })

  if isFirstOccurrence:
    triggerAdminPush(narrative)
```

---

## 3. LEVEL_CAP_APPLIED 처리 흐름

### 3.1 흐름

```
1. 자식 레벨이 부모 레벨보다 높음 감지
2. 자식 레벨 = 부모 레벨로 캡 (정상 처리)
3. 자식해역 객체에 confidence=WEAKLY_ESTIMATED 마킹
4. estimationReason="LEVEL_CAPPED"
5. 오류 로그 기록 (정보성)
6. 푸시 미발송
7. 다음 행 처리 계속
```

### 3.2 함수 형태

```
function handleLevelCap(afsoRow, parentTongbomun, child):
  childLvl = parseInt(afsoRow.wrnLvl)
  parentLvl = getParentLvlInt(parentTongbomun)

  if childLvl <= parentLvl:
    return childLvl  # 캡 미적용

  # 캡 적용
  finalLvl = parentLvl

  child.confidence = "WEAKLY_ESTIMATED"
  child.estimationReason = "LEVEL_CAPPED"

  recordError({
    errorType: "LEVEL_CAP_APPLIED",
    info: { afsoRegId: afsoRow.regId, childLvl, parentLvl },
    narrative: ${nowKo()}, ${afsoRow.regKo} 자식해역의 방재기상 레벨이 부모해역의 통보문 레벨보다 높습니다 (자식=${childLvl} 부모=${parentLvl}). 안전을 위해 부모 레벨로 캡 적용했습니다. 이는 보통 방재기상이 격상 발표를 사전 표시했기 때문입니다.,
    actionRequired: 통보문 갱신 시 자동으로 캡이 풀립니다. 별도 조치 불필요.
  })

  # 푸시 미발송
  return finalLvl
```

---

## 4. TIME_CAP_APPLIED 처리 흐름

LEVEL_CAP_APPLIED와 거의 동일. 시각만 다름.

### 4.1 함수 형태

```
function handleTimeCap(afsoRow, parentTongbomun, child):
  childEnd = parseAfsoTime(afsoRow.tmEd)
  parentEnd = parseTongbomunTime(parentTongbomun.tmCc)

  if childEnd == null or parentEnd == null:
    return afsoRow.tmEd  # 캡 미적용

  if childEnd <= parentEnd:
    return afsoRow.tmEd  # 캡 미적용

  finalEnd = parentTongbomun.tmCc
  child.confidence = "WEAKLY_ESTIMATED"
  child.estimationReason = "TIME_CAPPED"

  recordError({
    errorType: "TIME_CAP_APPLIED",
    info: { afsoRegId: afsoRow.regId, childEnd: afsoRow.tmEd, parentEnd: parentTongbomun.tmCc },
    narrative: ${nowKo()}, ${afsoRow.regKo} 자식해역의 방재기상 종료 예정 시각이 부모해역의 통보문 시각보다 늦습니다. 부모 시각으로 캡 적용했습니다.,
    actionRequired: 별도 조치 불필요.
  })

  return finalEnd
```

---

## 5. AFSO_RESPONSE_ERROR 처리 흐름

### 5.1 흐름

```
1. 응답 검증 실패 감지
2. 그 사이클 자식해역 갱신 전체 보류 (Step 3.4 이후 모두 건너뜀)
3. 직전 자식 상태 그대로 유지
4. 오류 로그 기록
5. 첫 발생 시 관리자 푸시 (연속 발생은 카운트)
6. 다음 사이클 대기
```

### 5.2 함수 형태

```
function step3_1_checkAfsoHealth(afsoResponse):
  validation = validateAfsoResponse(afsoResponse)

  if not validation.valid:
    isFirstOccurrence = !errorExistsRecently("AFSO_RESPONSE_ERROR")

    recordError({
      errorType: "AFSO_RESPONSE_ERROR",
      info: {
        statusCode: afsoResponse.statusCode,
        reason: validation.reason,
        detail: validation.detail
      },
      narrative: ${nowKo()}, 방재기상시스템 API에 응답 오류가 발생했습니다. 사유 ${validation.reason}, 상세 ${validation.detail}. 자식해역 상태는 직전 사이클의 정보를 그대로 유지합니다.,
      actionRequired: 일시 오류면 자동 복구됩니다. 30분 이상 지속 시 점검이 필요합니다.
    })

    if isFirstOccurrence:
      triggerAdminPush(narrative)

    return UNHEALTHY

  return HEALTHY
```

### 5.3 보류 처리

이 오류는 그 사이클의 모든 자식해역 처리를 보류합니다. Step 3의 나머지 단계가 실행되지 않습니다.

```
function runStep3():
  health = step3_1_checkAfsoHealth(afsoResponse)
  if health != HEALTHY:
    return  # 모든 후속 처리 보류

  # 정상 응답일 때만 진행
  step3_2_...
```

---

## 6. TONGBOMUN_POLLING_ERROR 처리 흐름

### 6.1 흐름

```
1. 통보문 크롤러 실패 감지 (기존 시스템)
2. 자식해역 처리에서 통보문 폴링 상태 확인
3. 통보문 비정상 → 자식 신규 해제 처리 보류
4. 발효 행 처리는 정상 진행 (캡 적용 시 직전 통보문 사용)
```

### 6.2 보류 정책

```
function step3_7_updateMissedCount(activeRows, emptyRows, previousState, tongbomunHealthy):
  # ...

  for childId in 누락된 자식들:
    child = previousState.subregions[childId]
    if child.current == null:
      continue

    child.missedCount += 1

    if not tongbomunHealthy:
      log("[자식 해제 보류] " + child.regKo + " 통보문 비정상 — 다음 사이클 대기")
      continue  # 해제 확정 안 함

    if child.missedCount >= 2:
      child.current = null  # 해제 확정
```

### 6.3 통보문 폴링 상태 확인

기존 통보문 크롤러의 실행 결과를 확인하는 인터페이스 필요:

```
function isTongbomunHealthy():
  # 기존 시스템에서 마지막 폴링 결과 확인
  lastPollResult = getLastTongbomunPollResult()
  return lastPollResult.success and (now() - lastPollResult.at) < 5 minutes
```

---

## 7. PARENT_CHILD_MISMATCH 처리 흐름

### 7.1 흐름

```
1. 자식 발효 행 처리 시 부모 통보문 조회
2. 부모 미발효 감지
3. 자식 행 무시
4. 오류 로그 기록 (드물지만 운영자 알림 가치 있음)
5. 푸시 발송
```

### 7.2 함수 형태

```
function processActiveChild(afsoRow, parentTongbomun):
  if parentTongbomun.current == null:
    isFirstOccurrence = !errorExistsRecently("PARENT_CHILD_MISMATCH", afsoRow.regId)

    recordError({
      errorType: "PARENT_CHILD_MISMATCH",
      info: {
        afsoRegId: afsoRow.regId,
        afsoRegKo: afsoRow.regKo,
        parentRegId: afsoRow.regUp,
        parentTongbomunActive: false
      },
      narrative: ${nowKo()}, ${afsoRow.regKo} 자식해역의 발효 행이 방재기상 응답에 등장했지만 부모해역(${afsoRow.regUp})의 통보문은 미발효 상태입니다. 데이터 이상으로 분류하여 자식해역 표시를 보류했습니다.,
      actionRequired: 통보문이 다음 사이클에 갱신되면 자동 복구됩니다. 지속 발생 시 점검 필요.
    })

    if isFirstOccurrence:
      triggerAdminPush(narrative)

    return SKIP  # 행 무시

  # 정상 처리
  ...
```

---

## 8. 오류의 누적과 푸시 알림 빈도 제어

### 8.1 푸시 스팸 방지

같은 오류가 매 사이클 반복되면 푸시 알림이 매분 폭주합니다.

### 8.2 빈도 제어

```
function shouldSendPush(errorType, signature):
  existing = errorLog.find(e => e.errorType == errorType and e.signature == signature)

  if existing == null:
    return true  # 첫 발생

  if existing.acknowledged:
    return true  # 확인 후 재발생 (재활성화)

  # 확인 안 된 같은 오류 재발생 → 푸시 안 함
  return false
```

### 8.3 일별 STALE_PARENT 알림

`STALE_PARENT`는 24시간 무변화 감지로 발생하므로, 매일 1회 알림되도록 제어:

```
function shouldSendStaleParentPush(parentRegId):
  lastSent = getLastStaleParentPushAt(parentRegId)
  return (now() - lastSent) >= 24 hours
```

---

## 9. 다중 오류 동시 발생

### 9.1 한 사이클에 여러 오류 발생

매 사이클 여러 오류가 동시에 발생할 수 있습니다.

- 매핑 누락 + 캡 적용 + ...
- 각 오류는 독립적으로 기록

### 9.2 처리 정책

- 모든 오류를 빠짐없이 기록
- 푸시 빈도는 위의 제어 정책에 따름
- 한 사이클에 여러 신규 푸시 발송 시 동일 푸시가 짧게 여러 번 갈 수 있음

### 9.3 푸시 묶음 (선택)

같은 사이클에 여러 신규 오류 발생 시 푸시를 묶어서 1개로 보낼지는 추후 정책 결정. 본 작업의 1차 범위에서는 개별 발송.

---

## 10. 본 파일 다음 작업

- 다음 파일: `03_admin_push_integration.md`
- 주제: 관리자 푸시 알림 통합 (기존 패턴 활용)
