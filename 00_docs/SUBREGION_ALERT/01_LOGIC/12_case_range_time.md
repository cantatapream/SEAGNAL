# 자식해역 특보 표출 로직 — 1.12 케이스: 범위형 해제예정시각

## 0. 본 파일의 위치

본 파일은 `01_LOGIC/` 시리즈의 열두 번째 파일이며, 통보문의 해제예정시각이 정확한 시각이 아닌 **범위형(예: "오전", "06시~12시")** 으로 발표되는 경우의 처리를 다룹니다.

---

## 1. 범위형 시각의 정의

### 1.1 범위형 시각의 형태

기상청 통보문은 가끔 정확한 시각이 아닌 범위 또는 시간대 표현을 사용합니다.

- 예: "9일 오전(06시~12시) 해제 예정"
- 예: "오후 늦게 해제 예정"
- 예: "내일 오전 격하 예정"

### 1.2 일반(정확) 시각의 형태

- 예: "2026년 04월 30일 14시 00분"

### 1.3 기존 코드의 처리 방식

기존 `parseKmaTime()` 함수는 정확 시각만 파싱 가능합니다.

- 정확 시각: `parseKmaTime("2026년 04월 30일 14시 00분")` → 유효한 Date 객체 반환
- 범위형: `parseKmaTime("9일 오전(06시~12시)")` → `null` 반환

따라서 범위형 시각은 자동 해제 로직이 트리거되지 않으며, 명시적 해제 통보문이 도착할 때까지 부모해역이 발효 상태로 유지됩니다.

---

## 2. 범위형 시각이 자식해역에 미치는 영향

### 2.1 동시 사라짐 잠금과의 충돌

범위형 시각은 동시 사라짐 잠금(`07_case_concurrent_disappear.md`)과 다음 충돌이 발생합니다.

- 부모-자식 동시 사라짐 시점: 자식의 `tmEd`를 부모의 `tmCc`로 설정
- 그러나 부모의 `tmCc`가 범위형이라 파싱 불가
- 자식의 `tmEd`도 명확하지 않게 됨

### 2.2 핵심 질문

이 경우 자식해역을 언제까지 유지할 것인가?

- 옵션 A: 범위 최대값(예: 12시)까지 유지
- 옵션 B: 범위 시작값(예: 06시)까지 유지
- 옵션 C: 통보문 갱신 시까지 무한 대기

---

## 3. 본 작업의 처리 정책 — 옵션 C (무한 대기)

### 3.1 정책 결정

본 작업은 **옵션 C — 통보문 갱신 시까지 무한 대기** 를 채택합니다.

- 자식해역의 `tmEd`를 명시 시각 없이 "부모 통보문 갱신 대기"로 설정
- 부모 통보문이 갱신되어 정확 시각이 들어오면 그때 자식 시각도 갱신
- 부모가 명시적 해제 통보문으로 자동 해제되면 자식도 함께 해제

### 3.2 정책의 근거

- 본 작업은 자식해역의 거짓 해제를 방지하는 것이 핵심 목표
- 옵션 A(범위 최대값)는 안전 측이지만 그 시각이 지나도 통보문이 갱신 안 되면 자식만 잘못 해제될 위험
- 옵션 B(범위 시작값)는 조기 해제 위험 더 큼
- 옵션 C는 부모 통보문 시스템에 100% 위임 → 통보문 시스템이 정상 동작한다는 가정 하에 가장 안전

### 3.3 정책의 의존성

이 정책은 부모 통보문 시스템이 정상 동작한다는 전제에 의존합니다.

- 1분마다 부모 통보문이 수집되고 있음 (기존 스케줄러)
- 통보문이 변경되면 우리 앱이 그 변경을 즉시 인지함
- 통보문이 명시적 해제 발표 시 자동 해제 로직이 트리거됨

이 전제가 깨지면 자식해역이 영원히 발효 상태로 표시될 수 있습니다. 안전장치는 별도 정의됩니다 (`03_OPERATIONS/07_stale_safeguard.md`).

---

## 4. 범위형 시각의 식별

### 4.1 식별 함수

```
function isRangeTime(timeString):
  if timeString == null or timeString == "":
    return false

  # 정확 시각 형식 매칭 시도
  exactPattern = /^\d{4}년 \d{2}월 \d{2}일 \d{2}시 \d{2}분$/
  if exactPattern.test(timeString):
    return false  # 정확 시각

  # 그 외 형태는 범위형 또는 모호한 시각
  return true
```

### 4.2 적용 예시

```
isRangeTime("2026년 04월 30일 14시 00분") → false
isRangeTime("9일 오전(06시~12시)") → true
isRangeTime("오후 늦게") → true
isRangeTime("") → false  (시각 자체가 없음)
isRangeTime(null) → false
```

---

## 5. 범위형 시각 시 자식해역 처리

### 5.1 동시 사라짐 잠금 갱신

```
function lockChildOnConcurrentDisappear(child, parentTongbomun):
  if isRangeTime(parentTongbomun.tmCc):
    # 범위형 시각 → 자식 tmEd를 명시 안 함
    child.status = "pending_release"
    child.tmEd = null
    child.tmEdNote = "부모 통보문 갱신 대기 (범위형 시각: " + parentTongbomun.tmCc + ")"
    log("[범위형 시각 잠금] " + child.regKo + " 부모 통보문 갱신까지 무한 대기")
  else:
    # 정확 시각 → 자식 tmEd 명시
    child.status = "pending_release"
    child.tmEd = parentTongbomun.tmCc
    log("[동시 사라짐 잠금] " + child.regKo + " " + parentTongbomun.tmCc + "까지 유지")
```

### 5.2 자동 해제 트리거의 동작

자식의 `tmEd`가 null이면 자동 해제 트리거에서 제외됩니다.

```
function checkChildAutoRelease(child):
  if child.tmEd == null:
    return  # 부모 통보문 갱신 대기 중

  if parseKmaTime(child.tmEd) <= now():
    # 자식 자체 시각 도달 → 자식만 해제
    child.current = null
```

### 5.3 부모 통보문 갱신 시 자식 시각 갱신

부모 통보문이 정확 시각으로 갱신되면 자식의 `tmEd`도 갱신됩니다.

```
function onParentTongbomunUpdate(parentRegId, oldTongbomun, newTongbomun):
  if isRangeTime(oldTongbomun.tmCc) and not isRangeTime(newTongbomun.tmCc):
    # 범위형 → 정확 시각으로 갱신됨
    for child in getChildrenInLifecycle(parentRegId):
      if child.status == "pending_release" and child.tmEd == null:
        child.tmEd = newTongbomun.tmCc
        child.tmEdNote = null
        log("[자식 시각 확정] " + child.regKo + " → " + newTongbomun.tmCc)
```

---

## 6. 범위형 시각 운영 안전장치

### 6.1 24시간 무변화 안전장치

부모 통보문이 24시간 이상 변화 없이 범위형 시각으로 유지되면 운영 로그에 경고 기록.

```
function checkStaleParent(parentRegId, parentTongbomun):
  if isRangeTime(parentTongbomun.tmCc):
    if (now() - parentTongbomun.lastUpdated) > 24 * 3600 * 1000:
      log("[Stale 경고] 부모해역 " + parentRegId + " 통보문이 24시간 이상 범위형 시각으로 유지됨 — 통보문 시스템 점검 필요")
```

### 6.2 안전장치의 위치

상세한 안전장치 정책은 `03_OPERATIONS/07_stale_safeguard.md` 참조.

---

## 7. 범위형 시각의 표시 정책

### 7.1 사용자 화면

범위형 시각으로 잠금된 자식해역은 다음과 같이 표시됩니다.

- 발효 중으로 표시
- 추정 마커 부가 (시각이 명확하지 않음)
- 툴팁: "본 정보는 실제 발표내용과 다를 수 있습니다."

### 7.2 부모해역 화면 (참고)

부모해역은 본 작업의 직접 대상이 아니므로 기존 표시 그대로 유지. 부모 통보문에 범위형 시각이 들어와도 기존 정책대로 동작.

---

## 8. 범위형 시각의 빈도

### 8.1 발생 빈도

범위형 시각은 자주 발생하지는 않으나 종종 발견됩니다.

- 정확 시각이 발표 가능한 경우 거의 모두 정확 시각 사용
- 다음 날 새벽 등 정확한 예측이 어려운 시각에 범위형 사용
- 본 작업의 처리 정책으로 대부분 안전하게 처리됨

### 8.2 모니터링 권장

운영 중 범위형 시각이 얼마나 자주 발생하는지 데이터 수집 권장. 빈도가 높으면 옵션 A(범위 최대값) 도입 검토.

---

## 9. 본 파일 다음 작업

- 다음 파일: `13_cap_rules.md`
- 주제: 캡 규칙 (자식 레벨/시각이 부모를 초과 시 강제 절단)
