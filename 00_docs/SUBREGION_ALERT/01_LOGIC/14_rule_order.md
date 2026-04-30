# 자식해역 특보 표출 로직 — 1.14 규칙 적용 순서

## 0. 본 파일의 위치

본 파일은 `01_LOGIC/` 시리즈의 열네 번째 파일이며, **한 사이클 안에서 모든 규칙을 어떤 순서로 적용해야 하는지** 정리합니다.

이전 12개 파일에서 다룬 모든 정책이 한 1분 사이클 안에서 충돌 없이 적용되도록 순서를 명시하는 것이 목적입니다.

---

## 1. 한 사이클의 단계

### 1.1 4단계 흐름 (재정리)

매 1분 스케줄러는 다음 4단계를 순차적으로 실행합니다.

```
[Step 1] 통보문 크롤링 (기존)
[Step 2] 방재기상 폴링 (신규)
[Step 3] 자식해역 상태 종합 판정 (신규, 본 파일의 핵심)
[Step 4] 사용자 표출 데이터 생성
```

### 1.2 Step 3의 내부 순서

본 파일은 Step 3 내부의 규칙 적용 순서를 다룹니다.

---

## 2. Step 3의 9단계 처리 순서

### 2.1 처리 순서 요약

| 순서 | 단계 | 핵심 내용 |
|---|---|---|
| 3.1 | 응답 건전성 검사 | 오류면 갱신 보류 |
| 3.2 | 통보문 폴링 건전성 검사 | 비정상이면 자식 신규 해제 보류 |
| 3.3 | 부모 자동 해제 처리 | tmCc 도달 시 부모 + 자식 일괄 정리 |
| 3.4 | 방재기상 행 분류 | 발효 행 / 빈 행 / 누락 식별 |
| 3.5 | 매핑 적용 | 우리 앱 이름으로 변환, 매핑 누락 로그 |
| 3.6 | 캡 규칙 적용 | 레벨/시각 캡 |
| 3.7 | 사라짐 카운트 갱신 | missedCount 증가/리셋 |
| 3.8 | 동시 사라짐 잠금 검사 | 부모-자식 동시 사라짐 시 잠금 |
| 3.9 | 상태 영속화 + 표시 데이터 생성 | 파일 저장, UI용 데이터 빌드 |

### 2.2 순서 결정 근거

각 단계는 다음 단계의 결과에 영향을 미치지 않도록 순서가 정해졌습니다.

- 응답이 비정상이면 그 사이클 갱신 자체가 보류 → 첫 단계
- 부모 자동 해제는 자식 일괄 정리를 트리거 → 자식 처리 전 실행
- 캡은 행 분류와 매핑 후 적용 → 데이터 정상 변환 후
- 잠금은 사라짐 카운트와 부모 상태가 모두 확정된 후 판단

---

## 3. 단계별 상세

### 3.1 응답 건전성 검사

```
function step3_1_checkAfsoHealth(afsoResponse):
  if afsoResponse.statusCode != 200:
    log("[AFSO 응답 오류] HTTP " + afsoResponse.statusCode)
    return UNHEALTHY

  if afsoResponse.body.meta.err == "true":
    log("[AFSO 응답 오류] meta.err == true")
    return UNHEALTHY

  if afsoResponse.body.data.metData == null or
     afsoResponse.body.data.metData.length == 0:
    log("[AFSO 응답 오류] metData 비어있음")
    return UNHEALTHY

  return HEALTHY
```

비정상이면 Step 3의 나머지 단계를 모두 건너뜀. 자식 상태 그대로 유지.

### 3.2 통보문 폴링 건전성 검사

```
function step3_2_checkTongbomunHealth():
  if Step1.crawlSucceeded == false:
    log("[통보문 폴링 실패] 자식 신규 해제 처리 보류")
    return UNHEALTHY
  return HEALTHY
```

통보문이 비정상이면 Step 3.7(사라짐 카운트)에서 자식 해제 확정을 보류.

### 3.3 부모 자동 해제 처리

```
function step3_3_processParentAutoRelease():
  for parentRegId in tongbomunZones:
    parent = tongbomunZones[parentRegId]

    if parent.current != null and parent.current.tmCc != null:
      ccTime = parseKmaTime(parent.current.tmCc)
      if ccTime != null and ccTime <= now():
        # 부모 정리 (기존 로직)
        parent.current = null
        parent.history = []

        # 자식 일괄 정리 (신규)
        cleanupChildrenOnParentRelease(parentRegId)
```

자세한 내용: `11_case_parent_auto_release.md`

### 3.4 방재기상 행 분류

```
function step3_4_classifyRows(afsoResponse):
  result = { active: [], empty: [], parentRows: [] }

  for row in afsoResponse.body.data.metData:
    if row.regId == row.regUp:
      result.parentRows.push(row)  # 부모 행
    elif isEmptyRow(row):
      result.empty.push(row)
    else:
      result.active.push(row)

  return result
```

### 3.5 매핑 적용

```
function step3_5_applyMapping(rows):
  mapped = []
  for row in rows:
    appName = lookupAppName(row.regId)
    if appName == null:
      log("[매핑 누락] regId=" + row.regId + " regKo=" + row.regKo)
      continue
    row.appName = appName
    mapped.push(row)
  return mapped
```

### 3.6 캡 규칙 적용

```
function step3_6_applyCap(activeRows, tongbomunZones):
  for row in activeRows:
    parent = tongbomunZones[lookupParentTongbomun(row.regUp)]
    if parent == null or parent.current == null:
      log("[데이터 이상] 부모 미발효인데 자식 발효 행 존재")
      continue

    row.cappedLevel = applyLevelCap(row, parent)
    row.cappedTmEd = applyTimeCap(row, parent)
```

### 3.7 사라짐 카운트 갱신

```
function step3_7_updateMissedCount(activeRows, emptyRows, previousState, tongbomunHealthy):
  # 발효 행으로 등장한 자식 → missedCount=0 리셋
  for row in activeRows:
    if previousState.subregions[row.regId] != null:
      previousState.subregions[row.regId].missedCount = 0

  # 빈 행으로 들어온 자식 → 즉시 해제
  for row in emptyRows:
    prevChild = previousState.subregions[row.regId]
    if prevChild != null and prevChild.current != null:
      prevChild.current = null
      log("[자식 즉시 해제] " + prevChild.regKo + " (빈 행 신호)")

  # 응답에 행 자체가 없는 자식 → missedCount 증가
  trackedIds = new Set(rowsInResponse.map(r => r.regId))
  for childId in previousState.subregions:
    if not trackedIds.has(childId):
      child = previousState.subregions[childId]
      if child.current != null:
        child.missedCount += 1

        if not tongbomunHealthy:
          log("[해제 보류] 통보문 비정상 — " + child.regKo + " 해제 처리 보류")
          continue

        if child.missedCount >= 2:
          log("[자식 해제] " + child.regKo + " 2회 연속 누락")
          child.current = null
```

### 3.8 동시 사라짐 잠금 검사

```
function step3_8_lockConcurrentDisappear(parentRegIdList, currentResponse, previousState, tongbomunZones):
  for parentRegId in parentRegIdList:
    parentRow = currentResponse.body.data.metData.find(r => r.regId == parentRegId)
    parentMissingOrEmpty = (parentRow == null) or isEmptyRow(parentRow)

    if not parentMissingOrEmpty:
      continue

    parentTongbomun = tongbomunZones[parentRegId]
    if parentTongbomun.current == null:
      continue  # 통보문상 부모도 해제 → 자동 해제 케이스 (3.3에서 처리됨)

    prevChildren = getChildrenInLifecycle(parentRegId, previousState)
    hadActive = prevChildren.any(c => c.current != null)
    if not hadActive:
      continue

    # 잠금 처리
    for child in prevChildren:
      if child.current != null:
        child.status = "pending_release"
        if isRangeTime(parentTongbomun.tmCc):
          child.tmEd = null
          child.tmEdNote = "범위형 시각 — 통보문 갱신 대기"
        else:
          child.tmEd = parentTongbomun.tmCc
        log("[동시 사라짐 잠금] " + child.regKo)
```

### 3.9 상태 영속화 + 표시 데이터 생성

```
function step3_9_persistAndBuild(previousState):
  # 영속화
  saveSubregionLifecycle(previousState)

  # 표시 데이터 생성
  displayData = buildDisplayData(tongbomunZones, previousState)
  return displayData
```

---

## 4. 단계 간 의존성 매트릭스

| Step | 입력 의존 | 출력 영향 |
|---|---|---|
| 3.1 | AFSO 응답 | 모든 후속 Step |
| 3.2 | 통보문 결과 | 3.7 (해제 보류 결정) |
| 3.3 | 통보문 결과 | 3.8 (자동 해제와 잠금 충돌 방지) |
| 3.4 | 3.1 정상 | 3.5, 3.6, 3.7, 3.8 |
| 3.5 | 3.4 결과 | 3.6 (매핑된 행만 캡 적용) |
| 3.6 | 3.5 결과 + 통보문 | 3.7 (캡 후 자식 상태 결정) |
| 3.7 | 3.6 결과 | 3.8 (사라짐 카운트가 잠금 결정에 영향) |
| 3.8 | 3.7 결과 | 3.9 (잠금 상태도 저장) |
| 3.9 | 모든 이전 Step | UI |

---

## 5. 단계 간 충돌 방지

### 5.1 충돌 가능 시나리오

다음 시나리오는 단계 순서가 잘못되면 발생할 수 있습니다.

#### 시나리오 A — 부모 자동 해제 + 동시 사라짐 잠금

- 부모가 `tmCc` 도달 → 자동 해제 트리거
- 동시에 부모-자식 모두 응답에서 빠짐 (정상)
- 잘못된 순서: 잠금 먼저 → 자식 잠금 → 그 다음 부모 자동 해제 → 자식 정리 (불필요한 잠금 후 정리)
- 올바른 순서: 부모 자동 해제 먼저 (3.3) → 자식도 함께 정리 → 잠금 단계(3.8)에서 부모는 이미 통보문상 해제됐으므로 잠금 안 함

#### 시나리오 B — 매핑 누락 + 캡 적용

- 매핑 없는 자식 행이 들어옴
- 잘못된 순서: 캡 먼저 → 매핑 안 됨 → 캡 데이터 무용지물
- 올바른 순서: 매핑 먼저 (3.5) → 매핑 안 된 행 제외 → 매핑된 행만 캡 (3.6)

### 5.2 본 순서가 충돌을 방지하는 방식

위 두 시나리오 모두 본 순서(3.1 → 3.9)에서 자동으로 해결됩니다.

---

## 6. 단계 실패 시 복구 정책

### 6.1 부분 실패의 처리

각 단계가 부분 실패한 경우 다음 정책을 따릅니다.

| 실패 단계 | 처리 |
|---|---|
| 3.1 (응답 건전성) | 모든 후속 Step 건너뜀, 자식 상태 그대로 유지 |
| 3.2 (통보문 건전성) | 3.7에서 해제 보류, 그 외 정상 진행 |
| 3.3 (자동 해제) | 로그 후 다음 Step 진행 |
| 3.4~3.7 (각 행 처리) | 그 행만 건너뜀, 다른 행 정상 처리 |
| 3.8 (잠금) | 잠금 실패 로그 후 다음 Step 진행 |
| 3.9 (영속화) | 영속화 실패는 큰 문제 — 운영 알림 |

### 6.2 함수 형태

```
function runStep3():
  try:
    if not step3_1_checkAfsoHealth(): return
    tongbomunHealthy = step3_2_checkTongbomunHealth()
    step3_3_processParentAutoRelease()
    rows = step3_4_classifyRows()
    rows.active = step3_5_applyMapping(rows.active)
    step3_6_applyCap(rows.active)
    step3_7_updateMissedCount(rows, tongbomunHealthy)
    step3_8_lockConcurrentDisappear()
    step3_9_persistAndBuild()
  catch e:
    log("[Step 3 예외] " + e.message)
    # 자식 상태는 그대로 유지하고 다음 사이클 대기
```

---

## 7. 본 파일 다음 작업

- 다음 파일: `15_estimation_display.md`
- 주제: 추정 상태의 표시 정책 (확정/추정 구분)
