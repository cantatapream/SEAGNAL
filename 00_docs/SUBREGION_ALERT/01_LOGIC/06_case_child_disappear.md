# 자식해역 특보 표출 로직 — 1.6 케이스: 자식해역만 빠짐

## 0. 본 파일의 위치

본 파일은 `01_LOGIC/` 시리즈의 여섯 번째 파일이며, 이전 파일(`05_case_normal.md`)의 정상 케이스와 대비되는 **자식해역 행이 응답에서 빠지는** 케이스를 다룹니다.

이 케이스는 **부모해역은 통보문상 살아있고**, 자식해역의 행만 방재기상 응답에서 빠진 경우입니다. 부모-자식이 동시에 빠지는 케이스는 다음 파일(`07_case_concurrent_disappear.md`)에서 다룹니다.

---

## 1. 케이스 정의

### 1.1 발생 상황

- 부모해역: 통보문상 발효 중 (예: 풍랑 경보 발효)
- 직전 사이클: 자식해역 X가 응답에 발효 행으로 존재
- 이번 사이클: 자식해역 X의 행이 응답에 **누락**

### 1.2 두 가능성

행 누락은 다음 두 원인 중 하나입니다.

- **(가) 진짜 해제**: 자식 X에 대한 해제 발표가 나서 방재기상이 즉시 트리에서 빼버림
- **(나) 일시 오류**: API 응답 생성 과정의 일시적 누락 (드물지만 가능)

(가)와 (나)를 구분할 결정적 신호가 응답 한 번으로는 없습니다. 따라서 **보수적 판정**(원칙 4)이 필요합니다.

---

## 2. 보수적 판정 정책 — 2회 연속 빠짐 규칙

### 2.1 규칙

자식해역 행이 응답에서 빠진 경우, **연속 2회** 빠지면 그때 해제로 확정합니다.

- 1회 빠짐: 화면 표시 유지 (보수적 대기)
- 2회 연속 빠짐: 해제 확정, 화면에서 제거

### 2.2 시각적 효과

- 사용자 화면에는 1회 빠짐 시점에는 변화 없음
- 약 2분 (1분 폴링 × 2회) 후 해제 확정
- 자식해역에 푸시 알림이 없으므로 사용자 영향 최소

### 2.3 일시 오류 방어

이 정책의 핵심 목적은 일시 오류로 인한 잘못된 해제를 방지하는 것입니다.

- API가 1회 빠진 행을 다음 사이클에 다시 정상으로 반환 → 1회 빠짐만으로 해제했으면 잘못된 정보가 사용자에게 노출
- 2회 연속 확인 시 잘못된 해제 위험을 약 절반 이하로 감소

### 2.4 함수 형태

```
function trackMissingRow(childRegId, previousState):
  # 직전 사이클에 존재했고, 이번 사이클 응답에 행이 없는 경우
  prevChild = previousState.subregions[childRegId]

  if prevChild == null:
    return  # 직전에도 없었음, 변화 없음

  prevChild.missedCount += 1

  if prevChild.missedCount >= 2:
    # 2회 연속 빠짐 → 해제 확정
    log("[자식 해제] " + prevChild.regKo + " 해제됨 (2회 연속 누락)")
    previousState.subregions[childRegId] = null
  else:
    # 1회 빠짐 → 표시 유지
    log("[자식 일시 누락] " + prevChild.regKo + " 1회 누락 (다음 사이클 확인)")
```

---

## 3. 빈 행과 행 누락의 차이 (중요)

### 3.1 두 신호의 다른 처리

이 케이스는 이전 파일(`05_case_normal.md`)에서 다룬 빈 행 케이스와 결정적으로 다릅니다.

| 신호 | 의미 | 처리 |
|---|---|---|
| 빈 행 (`wrnSeq=99`) | 방재기상이 명시적 "특보 없음" 신호 | **즉시 해제** (보수 대기 없음) |
| 행 누락 (응답에 없음) | 진짜 해제인지 일시 오류인지 모호 | **2회 연속 확인 후 해제** |

### 3.2 식별 방법

```
function judgeMissingState(childRegId, currentResponse):
  row = currentResponse.metData.find(r => r.regId == childRegId)

  if row == null:
    return ROW_MISSING  # 응답에 행 자체 없음 → 보수적 대기

  if row.wrnSeq == "99":
    return EMPTY_ROW  # 빈 행 신호 → 즉시 해제

  return ACTIVE_ROW  # 발효 행 → 정상 처리
```

### 3.3 왜 두 처리가 다른가

방재기상시스템은 응답 구조가 트리 전체를 항상 포함하도록 설계되어 있습니다. 따라서:

- **빈 행**: 방재기상이 정상 동작 중이며 그 해역을 의도적으로 "비어있음"으로 응답한 것
- **행 누락**: 방재기상의 응답 생성 과정에서 그 해역이 누락된 것 (의도된 신호가 아닐 수 있음)

이 차이가 처리의 차이를 만듭니다.

---

## 4. missedCount 카운터 관리

### 4.1 카운터의 역할

각 자식해역마다 `missedCount` 정수 필드를 유지하여 연속 빠짐 횟수를 추적합니다.

### 4.2 카운터 갱신 규칙

```
function updateMissedCount(childRegId, currentResponse, previousState):
  row = currentResponse.metData.find(r => r.regId == childRegId)
  child = previousState.subregions[childRegId]

  if child == null:
    return  # 추적 대상 아님

  if row != null and not isEmptyRow(row):
    # 이번 사이클에 정상 등장 → 카운터 리셋
    child.missedCount = 0
  elif row != null and isEmptyRow(row):
    # 빈 행 신호 → 즉시 해제 (이미 다른 함수에서 처리)
    pass
  else:
    # 행 누락 → 카운터 증가
    child.missedCount += 1
    if child.missedCount >= 2:
      child.current = null  # 해제 확정
```

### 4.3 카운터 리셋 시점

- 정상 발효 행으로 다시 등장 시 → 0
- 빈 행으로 등장 시 → 어차피 해제 처리되므로 카운터 무의미 (state는 null로)
- 해제 확정 후 다시 등장 시 → 신규 발효로 처리, 카운터 0부터 시작

### 4.4 영속화

`missedCount`는 `subregion_lifecycle.json`에 영속화되어 서버 재시작에도 유지됩니다. 자세한 스키마는 `02_DATA_MODEL/03_subregion_lifecycle_schema.md` 참조.

---

## 5. 통보문 폴링 실패와의 상호작용

### 5.1 우선순위

본 케이스의 처리는 **통보문 폴링이 정상이라는 전제** 하에 이루어집니다. 통보문 폴링이 실패한 경우 다른 정책이 적용됩니다.

- 통보문 폴링 실패 시: 자식 신규 해제 처리 보류 (β 정책)
- 즉, 부모 상태가 stale일 가능성이 있는 동안에는 2회 연속 빠짐을 만족해도 해제 처리 보류

### 5.2 함수 형태

```
function judgeChildRelease(childRegId, currentResponse, parentStatus, tongbomunHealth):
  if not tongbomunHealth.isHealthy:
    log("[해제 보류] 통보문 폴링 비정상 — 자식 해제 처리 보류")
    return  # 갱신 안 함

  # 통보문 정상이면 평소 로직 진행
  updateMissedCount(childRegId, currentResponse, ...)
```

### 5.3 정책 우선순위 요약

| 상황 | 처리 |
|---|---|
| 통보문 정상 + 자식 행 누락 1회 | 표시 유지, missedCount=1 |
| 통보문 정상 + 자식 행 누락 2회 연속 | 해제 확정 |
| 통보문 정상 + 자식 빈 행 | 즉시 해제 |
| 통보문 비정상 + 자식 행 누락 (몇 회든) | 해제 처리 보류 |

---

## 6. 사용자 영향 분석

### 6.1 정상 동작 시

- 진짜 해제: 약 2분의 지연 후 화면 반영
- 일시 오류 후 복구: 화면 유지, 사용자 영향 없음

### 6.2 자식해역에 푸시 알림이 없는 이유와 효과

본 작업의 자식해역 처리는 푸시 알림을 발송하지 않습니다. 따라서:

- 2분의 처리 지연이 사용자에게 알림 형태로 전달되지 않음
- 사용자가 화면을 직접 봐야 변화를 확인
- 짧은 시간 동안 잘못된 표시가 있어도 푸시 차원의 잘못된 알림은 발생하지 않음

이는 본 케이스의 보수적 처리를 안전하게 만드는 부수 효과입니다.

---

## 7. 본 케이스의 변형 — 부모와 자식 모두 빠지는 경우

본 케이스는 **부모는 살아있고 자식만 빠진** 경우만 다룹니다. 부모와 자식이 동시에 빠지는 경우는 다른 처리가 필요합니다.

- 다음 파일에서 상세 다룸: `07_case_concurrent_disappear.md`
- 미리보기:
  - 부모-자식 동시 사라짐: 부모 통보문 해제 시각까지 자식 발효 유지 (보수적 추정)
  - 즉시 해제로 처리하지 않음

---

## 8. 본 파일 다음 작업

- 다음 파일: `07_case_concurrent_disappear.md`
- 주제: 부모해역과 자식해역이 응답에서 동시에 사라지는 케이스
- 본 작업의 핵심 추정 로직 중 하나
