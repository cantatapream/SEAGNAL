# 자식해역 특보 표출 로직 — 1.11 케이스: 부모 자동 해제 시 자식 일괄 정리

## 0. 본 파일의 위치

본 파일은 `01_LOGIC/` 시리즈의 열한 번째 파일이며, **부모해역의 통보문이 자동 해제되는 시점**의 자식해역 처리를 다룹니다.

---

## 1. 부모 자동 해제의 정의

### 1.1 기존 자동 해제 로직

기존 코드에는 통보문의 `tmCc`(해제예정시각)를 기준으로 부모해역을 자동 해제하는 로직이 있습니다.

- 함수: `resolvePendingStatuses()`
- 위치: `local_server/weather_alerts_crawler.js:284-334`
- 동작: 매 1분 사이클마다 통보문의 `tmCc` ≤ 현재시각이면 부모해역의 `current = null` 처리

### 1.2 자동 해제의 조건

```
[기존 코드 발췌 — weather_alerts_crawler.js:303-308]

if (obj.current && !obj.current.tmRelease && obj.current.tmCc) {
    const ccTime = parseKmaTime(obj.current.tmCc);
    if (ccTime && ccTime <= now) {
        console.log(`[Resolver] 해제 예정 시각(tmCc) 도달: ${obj.current.tmCc}`);
        obj.current = null;
        obj.history = [];
    }
}
```

### 1.3 본 작업에서 추가되는 처리

기존 자동 해제 로직은 부모해역만 정리합니다. 본 작업으로 자식해역도 별도 자료구조로 관리되므로, 부모 자동 해제 시점에 자식해역도 함께 정리해야 합니다.

원칙 5(부모 없으면 자식도 없음)에 의해 강제됩니다.

---

## 2. 자식 일괄 정리 로직

### 2.1 정리 절차

부모 자동 해제 시점에 다음을 수행합니다.

1. 그 부모해역의 모든 자식해역 조회
2. 각 자식해역의 `current = null` 처리
3. `subregion_lifecycle.json`에 변경사항 영속화
4. 운영 로그 기록

### 2.2 함수 형태

```
function onParentAutoRelease(parentRegId):
  # Step 1: 부모 정리 (기존 로직)
  parentZone = parentStates[parentRegId]
  parentZone.current = null
  parentZone.history = []

  # Step 2: 자식 정리 (신규)
  children = getChildrenInLifecycle(parentRegId)

  for child in children:
    if child.current != null:
      log("[부모 자동 해제 연동] 자식 " + child.regKo + " 함께 정리")
      child.current = null
      child.lastReleasedAt = now()
      child.releaseReason = "PARENT_AUTO_RELEASE"

  # Step 3: 영속화
  saveSubregionLifecycle()
```

### 2.3 기존 코드와의 통합

기존 `resolvePendingStatuses()` 함수에 자식 정리 로직을 추가하거나, 그 함수가 부모를 해제할 때 새 hook을 호출하도록 수정합니다.

```
function resolvePendingStatuses(zones):
  for parentRegId in zones:
    obj = zones[parentRegId]

    if obj.current && !obj.current.tmRelease && obj.current.tmCc:
      ccTime = parseKmaTime(obj.current.tmCc)

      if ccTime && ccTime <= now:
        # 기존 로직
        obj.current = null
        obj.history = []

        # 신규 로직 — 자식 일괄 정리
        cleanupChildrenOnParentRelease(parentRegId)
```

---

## 3. 잠금 상태 자식의 처리

### 3.1 동시 사라짐 잠금과의 관계

`07_case_concurrent_disappear.md`에서 다룬 바와 같이, 부모-자식이 동시에 사라지면 자식해역은 `pending_release` 상태로 잠금됩니다.

이 잠금 상태는 부모 자동 해제 시점에 자연스럽게 해제됩니다.

- 잠금 시점에 자식의 `tmEd = parentTongbomun.tmCc`로 설정됨
- 부모 자동 해제 시점 = `parentTongbomun.tmCc` 도달 시점
- 따라서 부모 자동 해제 시점에 자식 잠금도 만료

### 3.2 함수 형태

```
function cleanupChildrenOnParentRelease(parentRegId):
  children = getChildrenInLifecycle(parentRegId)

  for child in children:
    # 잠금 상태든 정상 상태든 모두 정리
    if child.current != null:
      child.current = null
      child.lastReleasedAt = now()

      if child.status == "pending_release":
        child.releaseReason = "CONCURRENT_DISAPPEAR_RELEASE"
      else:
        child.releaseReason = "PARENT_AUTO_RELEASE"

      log("[자식 정리] " + child.regKo + " (" + child.releaseReason + ")")
```

---

## 4. 부모 통보문 갱신과 자동 해제의 충돌

### 4.1 시나리오

부모 통보문이 자동 해제 시각(`tmCc`)에 도달했지만, 그 직전에 새 통보문이 발표되어 해제 시각이 변경되는 경우가 있습니다.

- 14:00 — 원래 부모 자동 해제 예정
- 13:55 — 새 통보문: "16:00으로 해제 시각 연기"
- 14:00 — 자동 해제가 트리거되어야 하나?

### 4.2 처리 정책

기존 자동 해제 로직은 매 사이클 통보문을 다시 읽고 `tmCc`를 확인합니다. 따라서:

- 13:55 — 새 통보문 처리 → `tmCc = 16:00`으로 갱신
- 14:00 — 자동 해제 체크 시 `tmCc = 16:00 > now()` → 해제 안 함
- 16:00 — 자동 해제 트리거

이 흐름은 기존 로직 그대로 동작하며, 본 작업으로 변경되지 않습니다.

### 4.3 자식 잠금 시각의 갱신

`pending_release` 상태인 자식의 `tmEd`도 부모 통보문 갱신과 함께 자동 갱신됩니다 (`07_case_concurrent_disappear.md` 4.2절 참조).

```
function cascadeParentReleaseTimeChange(parentRegId, newTmCc):
  for child in getChildrenInLifecycle(parentRegId):
    if child.status == "pending_release":
      child.tmEd = newTmCc
```

---

## 5. 부모 자동 해제와 방재기상 응답의 일관성

### 5.1 일관성 검증

부모 자동 해제 시점에 방재기상 응답에서도 부모/자식이 사라져 있어야 정상입니다.

- 부모 통보문 자동 해제 → 부모 방재기상에서도 빠짐 (보통 일치)
- 자식도 방재기상에서 빠짐 (잠금 상태였을 가능성 높음)

### 5.2 일관성 깨지는 경우

매우 드물지만 다음 경우가 가능합니다.

- 부모 통보문상 자동 해제됐는데 방재기상에는 부모가 여전히 등장
- 또는 자식이 여전히 등장

이 경우는 **방재기상 응답이 stale** 한 상태이거나 데이터 이상입니다.

### 5.3 처리 정책

- 통보문이 truth source이므로 부모는 해제 처리
- 자식도 함께 정리 (원칙 5)
- 방재기상이 다음 사이클에 갱신되어 부모/자식이 빠지길 대기
- 일관성 깨짐 자체를 운영 로그로 기록 (디버깅 자료)

```
function checkConsistencyOnParentRelease(parentRegId, afsoResponse):
  parentRow = afsoResponse.metData.find(r => r.regId == parentRegId)
  if parentRow != null and not isEmptyRow(parentRow):
    log("[일관성 이상] 부모 통보문 자동 해제됐으나 방재기상 응답에 여전히 등장: " + parentRegId)
```

---

## 6. 자식 일괄 정리의 영속화 시점

### 6.1 영속화 의무

자식 일괄 정리는 부모 자동 해제와 같은 트랜잭션 단위로 영속화되어야 합니다.

- 부모는 `weather_alerts.json`, `active_lifecycle.json`에서 정리됨 (기존)
- 자식은 `subregion_lifecycle.json`에서 정리됨 (신규)

두 영속화가 한쪽만 성공하면 일관성이 깨집니다.

### 6.2 권장 구현

원자적 영속화를 위해 다음 패턴을 따릅니다.

- 임시 파일에 먼저 쓰기
- 모두 성공하면 rename으로 교체
- 한 쪽이라도 실패하면 전체 롤백

자세한 영속화 정책은 `02_DATA_MODEL/08_persistence_backup.md` 참조.

---

## 7. 부모 자동 해제 후 사용자 화면

### 7.1 화면 변화

부모 자동 해제 시점에 사용자 화면은 다음과 같이 변경됩니다.

- 부모해역 표시 제거 (기존 동작)
- 그 부모의 모든 자식해역 표시 제거 (신규 동작)

### 7.2 라벨

자동 해제 시점은 별도 사용자 알림 없이 화면에서 자연스럽게 사라집니다.

- 부모해역에는 이미 푸시 알림 정책이 있음 (기존 그대로)
- 자식해역에는 푸시 알림 없음 (본 작업 정책)

---

## 8. 본 파일 다음 작업

- 다음 파일: `12_case_range_time.md`
- 주제: 통보문의 범위형 해제예정시각 처리 (예: "오전" "06시~12시")
