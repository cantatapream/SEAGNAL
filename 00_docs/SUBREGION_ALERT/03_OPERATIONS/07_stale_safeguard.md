# 자식해역 특보 표출 — 3.7 24시간 stale 안전장치

## 0. 본 파일의 위치

본 파일은 `03_OPERATIONS/` 시리즈의 일곱 번째 파일이며, 부모해역 통보문이 장기간 변화 없이 유지될 때의 안전장치를 정리합니다.

본 작업은 부모해역 통보문 시스템에 100% 위임하므로, 통보문 시스템이 stale 상태가 되면 자식해역도 영향을 받습니다.

---

## 1. Stale 상태의 정의

### 1.1 정의

부모해역의 통보문이 24시간 이상 변화 없이 유지되며, 그 사이에 자식해역도 변화가 없는 상태.

### 1.2 발생 가능 원인

- 통보문 크롤러 버그 또는 정지
- 기상청 페이지 구조 변경으로 파싱 실패
- 통보문 시스템 자체의 발표 누락
- 본 작업의 범위형 시각 처리로 무한 대기 중

### 1.3 위험성

- 자식해역이 영원히 발효 상태로 표시
- 사용자에게 잘못된 정보 노출 가능
- 본 작업의 보수적 정책이 거짓 발효를 만들 위험

---

## 2. 안전장치의 목적

### 2.1 목적

장기 stale 상태를 운영자에게 즉시 알려 시스템 점검을 유도.

### 2.2 동작 원리

- 매 사이클마다 부모해역의 마지막 변화 시각 확인
- 24시간 이상 변화 없으면 운영 로그 + 푸시 알림
- 시스템은 계속 동작 (자식해역 표시도 그대로 유지)
- 운영자가 시스템 점검 후 복구 시 자동 해제

### 2.3 단순한 알림 메커니즘

본 안전장치는 알림만 발송합니다. 자동으로 자식해역을 강제 해제하지 않습니다 (보수적 판정 우선).

---

## 3. 감지 로직

### 3.1 부모해역 마지막 변화 추적

```
function trackParentLastChange(parentRegId, parentTongbomun, previousTongbomun):
  if parentTongbomun.current == null:
    return  # 미발효 상태는 추적 안 함

  if hasMeaningfulChange(parentTongbomun, previousTongbomun):
    parentTongbomun.lastMeaningfulChange = now()
```

### 3.2 의미 있는 변화

- 레벨 변경
- 종류 변경
- 시각 변경 (`tmCc` 변경)
- 발효 → 미발효 또는 미발효 → 발효

### 3.3 무의미한 변화 (추적 제외)

- 단순 메타데이터 갱신
- `lastUpdated`만 변경

### 3.4 감지 함수

```
function detectStaleParent(parentTongbomun):
  if parentTongbomun.current == null:
    return false  # 미발효는 stale 아님

  if parentTongbomun.lastMeaningfulChange == null:
    parentTongbomun.lastMeaningfulChange = now()
    return false

  threshold = 24 hours
  elapsed = now() - parentTongbomun.lastMeaningfulChange

  return elapsed >= threshold
```

---

## 4. 알림 발송

### 4.1 첫 stale 감지 시

```
function onStaleDetected(parentRegId, parentTongbomun):
  recordError({
    errorType: "STALE_PARENT",
    info: {
      parentRegId: parentRegId,
      parentRegKo: lookupAppName(parentRegId),
      lastMeaningfulChange: parentTongbomun.lastMeaningfulChange,
      currentLevel: parentTongbomun.current.wrnLvl,
      currentWrnTp: parentTongbomun.current.wrnTp
    },
    narrative: ${nowKo()}, 부모해역 ${parentRegKo}의 통보문이 24시간 이상
변화 없이 유지되고 있습니다. 마지막 변화는 ${lastMeaningfulChangeKo}이었
습니다. 현재 ${parentTongbomun.current.wrnTp} ${parentTongbomun.current.wrnLvlName}
발효 중. 통보문 시스템 점검이 필요할 수 있습니다.,
    actionRequired: 통보문 크롤러 동작과 기상청 페이지를 확인해주세요.
  })

  triggerAdminPush(narrative)
```

### 4.2 알림 빈도 제어

같은 부모해역에 대한 stale 알림은 일별 1회만:

```
function shouldSendStalePush(parentRegId):
  lastPushed = getLastStalePushTime(parentRegId)
  if lastPushed == null:
    return true

  return (now() - lastPushed) >= 24 hours
```

---

## 5. Stale 해제

### 5.1 자동 해제 조건

부모해역에 의미 있는 변화가 발생하면 stale 상태가 자동 해제됩니다.

```
function onParentChangeDetected(parentRegId):
  parentTongbomun = tongbomunZones[parentRegId]
  parentTongbomun.lastMeaningfulChange = now()

  # stale 알림 누적 카운트 리셋 (선택)
```

### 5.2 통보문 갱신 후 동작

stale 상태가 해제되면 본 작업의 정상 흐름이 재개됩니다.

- 자식해역의 잠금 상태가 부모 시각 갱신에 따라 갱신
- 사용자 화면도 정상 정보로 복귀

---

## 6. Stale 상태에서의 자식해역 처리

### 6.1 자식해역도 stale로 유지

부모가 stale이면 본 작업의 보수적 정책에 따라 자식해역도 stale 상태로 유지됩니다.

- 잠금 상태인 자식: `tmEd`가 그대로 유지 (또는 null)
- 발효 상태인 자식: 화면 표시 유지

### 6.2 자식해역 표시의 추정 마커

stale 상태에서 자식해역이 표시되는 동안에는 강한 추정 마커가 부가될 수 있습니다.

- 단, 본 작업의 1차 범위에서는 stale 자체가 자식 추정 마커에 직접 영향 없음
- 자식해역의 추정 마커는 다른 케이스(동시 사라짐 잠금 등)에서 결정

---

## 7. 함수 형태 — Stale 모니터

### 7.1 매 사이클 호출

```
function checkAllParentsForStale():
  for parentRegId, parentTongbomun in tongbomunZones:
    isStale = detectStaleParent(parentTongbomun)

    if isStale:
      if shouldSendStalePush(parentRegId):
        onStaleDetected(parentRegId, parentTongbomun)
        recordStalePushSent(parentRegId)
```

### 7.2 Step 3 통합

이 함수는 Step 3의 마지막 단계(영속화 직후)에 호출:

```
function runStep3():
  # ...
  step3_9_persistAndBuild()

  # Stale 검사 (신규)
  checkAllParentsForStale()
```

---

## 8. 통보문 시스템 자체의 안전장치 (참고)

### 8.1 통보문 폴링 모니터링

통보문 폴링이 N분 이상 응답을 못 받으면 별도 알림. 이는 stale 안전장치보다 더 빠른 감지 메커니즘.

### 8.2 본 작업과의 관계

본 작업의 stale 안전장치는 통보문 폴링 자체는 정상이지만 **변화가 없는** 상태를 감지합니다.

- 통보문 폴링 실패: 통보문 시스템 자체 안전장치 (기존)
- 통보문 stale: 본 작업의 stale 안전장치 (신규)

두 가지가 함께 동작하여 다양한 장애 시나리오를 커버합니다.

---

## 9. Stale 안전장치의 한계

### 9.1 24시간이 너무 긴가?

24시간은 다음을 고려한 임계치입니다.

- 일부 부모해역은 24시간 이상 같은 상태를 유지하는 게 정상 (장기 발효 시)
- 너무 짧으면 정상 운영 중에도 알림 발생
- 24시간이 운영 영향과 안전장치 효과의 균형점

### 9.2 임계치 조정 가능

`STALE_THRESHOLD_HOURS` 같은 상수로 분리하여 운영 후 조정 가능하게 둘 수 있습니다.

```
const STALE_THRESHOLD_HOURS = 24

function detectStaleParent(parentTongbomun):
  threshold = STALE_THRESHOLD_HOURS * 3600 * 1000
  ...
```

### 9.3 본 작업의 1차 범위

본 작업의 1차 범위에서는 24시간으로 고정. 운영 후 데이터를 보고 조정.

---

## 10. 본 파일 다음 작업

- 다음 파일: `08_rollout_strategy.md`
- 주제: 롤아웃 전략 (검증 기간, 점진적 도입)
