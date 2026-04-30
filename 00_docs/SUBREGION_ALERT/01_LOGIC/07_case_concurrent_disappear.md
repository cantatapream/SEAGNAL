# 자식해역 특보 표출 로직 — 1.7 케이스: 부모-자식 동시 사라짐

## 0. 본 파일의 위치

본 파일은 `01_LOGIC/` 시리즈의 일곱 번째 파일이며, **본 작업의 핵심 추정 로직** 중 하나를 다룹니다.

부모해역과 자식해역이 방재기상 응답에서 동시에 사라지는 경우, 이를 "지금 해제"가 아니라 "미래 해제 예정"으로 해석하는 로직을 정리합니다.

---

## 1. 케이스 정의

### 1.1 발생 상황

- 직전 사이클: 부모해역 P와 그 자식 C1, C2, C3이 모두 응답에 발효 행으로 존재
- 이번 사이클: P, C1, C2, C3가 **모두 응답에서 빠짐** (또는 모두 빈 행으로 변환)
- 통보문: 부모 P는 **여전히 발효 중**으로 유지 (해제 시각 미도달)

### 1.2 두 가능성

이 동시 사라짐의 원인은 다음 중 하나입니다.

- **(가) 미래 해제 예정**: 부모 P에 대한 해제 통보문이 발표됐고, 그 시점부터 방재기상이 P와 자식들을 미리 트리에서 제거. 실제 해제는 미래 시각에 발생.
- **(나) API 일시 오류**: 매우 드물지만 응답 자체가 일시적으로 부분 누락 (이 경우는 별도 가드로 방어)

방재기상의 동작 특성상 (가)가 압도적으로 흔합니다. 따라서 본 작업은 (가)를 기본 가정으로 처리합니다.

---

## 2. 핵심 처리 정책 — 부모 통보문 해제 시각까지 자식 유지

### 2.1 정책 요약

부모와 자식이 동시에 사라지면, **부모해역 통보문에 명시된 해제 예정 시각(`tmCc`)까지** 자식해역의 발효 표시를 유지합니다.

- 그 시각이 도달하기 전: 자식 화면 표시 유지 (추정 상태로)
- 그 시각이 도달: 부모와 자식 동시 해제 처리

### 2.2 정책의 근거

- 부모해역의 통보문은 truth source (원칙 1)
- 통보문에 명시된 해제 시각이 가장 정확한 미래 해제 정보
- 방재기상이 미리 빼버린 것은 사용자에게 보여줄 정보가 아님
- 자식은 부모와 결합 (원칙 5) → 부모 해제 시각 = 자식 해제 시각

### 2.3 함수 형태

```
function detectConcurrentDisappear(parentRegId, currentResponse, previousState, parentTongbomun):
  # 부모해역 행이 응답에 없거나 빈 행으로 변경됐는지 확인
  parentRow = currentResponse.metData.find(r => r.regId == parentRegId)
  parentMissingOrEmpty = (parentRow == null) or isEmptyRow(parentRow)

  if not parentMissingOrEmpty:
    return  # 부모는 여전히 응답에 있음 → 동시 사라짐 아님

  # 직전 사이클에 자식들이 발효 상태였는지 확인
  prevChildren = getChildrenOf(parentRegId, previousState)
  hadActiveChildren = prevChildren.any(c => c.current != null)

  if not hadActiveChildren:
    return  # 직전 자식이 없었으면 동시 사라짐 아님

  # 통보문상 부모는 살아있어야 함
  if parentTongbomun.current == null:
    return  # 부모도 통보문상 해제됐으면 다른 케이스 (자동 해제)

  # 동시 사라짐 확정 → 자식 잠금
  for child in prevChildren:
    if child.current != null:
      child.status = "pending_release"
      child.tmEd = parentTongbomun.tmCc  # 부모 해제 시각 상속
      log("[동시 사라짐 잠금] " + child.regKo + " → 부모 해제시각(" + parentTongbomun.tmCc + ")까지 유지")
```

---

## 3. 잠금 상태 (`pending_release`)

### 3.1 정의

본 케이스로 인해 부모 해제 시각까지 유지되는 자식해역의 상태를 `pending_release`로 표시합니다.

### 3.2 잠금 상태의 의미

- 방재기상에서는 이미 빠졌지만 우리 앱은 발효 중으로 표시
- 추정 상태이므로 사용자에게 추정 안내 툴팁 부가
- 부모 해제 시각 도달 시 자동으로 해제 처리 (원칙 5에 따라 일괄)

### 3.3 영속화

잠금 상태는 `subregion_lifecycle.json`에 영속화되어 서버 재시작 후에도 유지됩니다. 자세한 스키마는 `02_DATA_MODEL/03_subregion_lifecycle_schema.md` 참조.

### 3.4 잠금 해제 시점

다음 중 하나에 해당하면 잠금 해제됩니다.

- 부모 통보문 자동 해제 (`tmCc` 도달) → 자식도 함께 해제
- 부모 통보문 갱신으로 부모가 다시 명시적으로 발효 정보 갱신 → 다음 절에서 다룸
- 방재기상 응답에 자식이 다시 등장 → 잠금 해제, 정상 상태로 복귀

---

## 4. 부모 통보문 갱신 시 자식 처리

### 4.1 갱신 시나리오

부모해역의 통보문이 갱신되는 경우 다음 시나리오가 가능합니다.

- 시나리오 A: 해제 시각 변경 (예: 14:00 → 16:00 연기)
- 시나리오 B: 해제 취소 + 격상 (예: 14:00 해제 예정 → 16:00 경보 격상)
- 시나리오 C: 격하 (예: 경보 → 주의보)

### 4.2 시나리오 A — 해제 시각 변경

- 부모 통보문의 `tmCc`가 14:00 → 16:00으로 변경됨
- 잠금 상태인 자식들의 `tmEd`도 16:00으로 자동 갱신
- 함수: `cascadeParentReleaseTimeChange(parentRegId, newTmCc)`

```
function cascadeParentReleaseTimeChange(parentRegId, newTmCc):
  for child in getChildrenOf(parentRegId):
    if child.status == "pending_release":
      child.tmEd = newTmCc
      log("[자식 시각 갱신] " + child.regKo + " 부모 해제시각 변경 반영 → " + newTmCc)
```

### 4.3 시나리오 B — 해제 취소 + 격상

- 부모 통보문이 해제 → 격상으로 전환
- 방재기상 응답에 부모와 자식이 다시 등장할 수 있음
- 잠금 상태인 자식이 정상 응답에 다시 등장하면 → 잠금 해제, 정상 상태로 복귀
- 격상 처리는 `09_case_level_change.md`에서 다룸

### 4.4 시나리오 C — 격하

- 부모가 경보 → 주의보로 격하
- 방재기상에 자식들이 다시 정상 응답으로 등장 (격하된 레벨로)
- 잠금 해제, 정상 처리 (캡 적용)
- 자세한 내용은 `09_case_level_change.md`에서 다룸

---

## 5. 시간 윈도우 정의 — "동시"의 정확한 의미

### 5.1 동시의 정의

본 작업에서 "동시 사라짐"은 **같은 사이클 안에서** 부모와 자식이 함께 빠지는 것을 의미합니다.

- 한 사이클의 응답에 부모 행과 자식 행이 모두 빠짐 → 동시 사라짐
- 부모 행은 빠지고 자식 행은 다음 사이클에 빠짐 → 시차 발생, 별도 처리

### 5.2 시차 발생 시 처리

부모와 자식이 다른 사이클에서 빠지는 경우는 드물지만 가능합니다. 이때는:

- 부모가 먼저 빠지고 자식이 다음 사이클에 빠짐 → 통보문상 부모는 살아있을 것이므로 자식은 6번 케이스(자식만 빠짐)로 처리
- 자식이 먼저 빠지고 부모가 다음 사이클에 빠짐 → 자식은 6번 케이스, 그 다음 사이클에 부모도 빠지면 동시로 재분류

### 5.3 함수 형태

```
function isConcurrentDisappear(parentRow, prevChildren, currentChildRows):
  parentMissing = (parentRow == null) or isEmptyRow(parentRow)
  childrenAllMissing = prevChildren.all(c => {
    row = currentChildRows.find(r => r.regId == c.regId)
    return (row == null) or isEmptyRow(row)
  })
  return parentMissing and childrenAllMissing
```

---

## 6. 자식해역의 시각 상속

### 6.1 상속 규칙

동시 사라짐 잠금 상태에서 자식의 종료 시각은 다음 규칙으로 결정됩니다.

- 자식 자체의 `tmEd`는 응답에서 빠졌으므로 알 수 없음
- 따라서 부모 통보문의 `tmCc`를 상속받음
- 캡 규칙(원칙 3)이 자연스럽게 적용됨 (자식이 부모보다 길 수 없음)

### 6.2 자식 자체의 짧은 시각이 있었던 경우

이 케이스는 별도 처리가 필요합니다.

- 직전 사이클에 자식이 부모보다 짧은 종료 시각을 가지고 있었음 (예: 부모 06:00, 자식 18:00)
- 동시 사라짐 발생
- 처리: 자식의 직전 종료 시각이 더 짧으면 → 자식의 직전 시각을 유지 (잠금 상태로 18:00까지 유지)

### 6.3 함수 형태

```
function inheritReleaseTime(child, parentTmCc):
  if child.tmEd != null and child.tmEd < parentTmCc:
    # 자식이 원래 더 짧은 시각이었음 → 자식 시각 유지
    return child.tmEd
  else:
    # 부모 시각 상속
    return parentTmCc
```

---

## 7. API 오류와 동시 사라짐의 구분

### 7.1 가짜 동시 사라짐

API가 응답을 빈 배열(`metData: []`) 또는 일시 오류로 반환한 경우 모든 행이 한꺼번에 사라진 것처럼 보입니다.

- 이 경우는 동시 사라짐이 아니라 **응답 자체의 오류**
- 자식 잠금 처리를 트리거하지 않아야 함

### 7.2 가드 규칙

응답이 다음 조건 중 하나라도 만족하면 동시 사라짐 판정을 보류합니다.

- `metData.length == 0`
- `meta.err == "true"`
- HTTP 5xx 응답
- 응답 구조 깨짐

상세 정책은 `03_OPERATIONS/02_error_handling.md` 참조.

### 7.3 함수 형태

```
function isResponseHealthy(response):
  if response.statusCode != 200: return false
  if response.body.meta.err == "true": return false
  if response.body.data.metData == null: return false
  if response.body.data.metData.length == 0: return false
  return true

function processConcurrentDisappearCheck(response, ...):
  if not isResponseHealthy(response):
    log("[응답 비정상] 자식 상태 갱신 보류")
    return  # 동시 사라짐 판정 안 함

  # 정상 응답일 때만 동시 사라짐 판정
  detectConcurrentDisappear(...)
```

---

## 8. 사용자 화면 표시

### 8.1 잠금 상태의 표시

- 자식해역은 화면에 발효 중으로 계속 표시됨
- 단, 추정 상태이므로 추정 마커(예: 작은 ⓘ 아이콘) 부가
- 툴팁: "본 정보는 실제 발표내용과 다를 수 있습니다."
- 자세한 표시 정책은 `15_estimation_display.md` 참조

### 8.2 잠금 해제 시 화면 변화

부모 해제 시각 도달 시 부모와 함께 자식도 화면에서 사라짐. 이 시점은 부모 자동 해제 로직(`resolvePendingStatuses`)이 트리거합니다.

---

## 9. 본 파일 다음 작업

- 다음 파일: `08_case_new_child.md`
- 주제: 자식해역이 응답에 새로 등장하는 케이스 (신규 발효 vs 재등장 구분)
