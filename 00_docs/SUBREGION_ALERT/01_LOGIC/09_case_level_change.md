# 자식해역 특보 표출 로직 — 1.9 케이스: 격상 / 격하

## 0. 본 파일의 위치

본 파일은 `01_LOGIC/` 시리즈의 아홉 번째 파일이며, 격상(주의보 → 경보)과 격하(경보 → 주의보) 발표 시 자식해역의 처리를 다룹니다.

핵심: **부모해역 통보문이 절대 기준**이며, 방재기상시스템의 자식 레벨이 미리 변경되어도 우리 앱은 통보문을 따릅니다.

---

## 1. 격상/격하의 정의

### 1.1 격상 (Upgrade)

- 같은 종류 특보의 수준이 더 높은 단계로 변경됨
- 예: 풍랑 주의보 → 풍랑 경보
- 통보문상으로는 새 통보문 발표를 통해 명시됨

### 1.2 격하 (Downgrade)

- 같은 종류 특보의 수준이 더 낮은 단계로 변경됨
- 예: 풍랑 경보 → 풍랑 주의보
- 통보문상으로는 새 통보문 발표를 통해 명시됨

### 1.3 다른 종류로의 회전 (회화)

- 풍랑 → 태풍 등 종류가 변경되는 경우는 본 작업에서 다른 케이스로 다룸
- 본 작업에서는 자식해역에 한 종류의 특보만 처리하므로, 회전은 부모해역 영역에서만 처리되며 자식은 부모를 따라감

---

## 2. 핵심 정책 — 부모 통보문 절대 우선

### 2.1 정책 요약

자식해역의 격상/격하는 **반드시 부모 통보문이 격상/격하될 때** 적용합니다.

- 부모 통보문이 주의보 → 자식도 주의보 (방재기상이 미리 경보로 표시해도 무시)
- 부모 통보문이 경보로 격상 → 그 시점에 자식도 경보로 격상
- 부모 통보문이 주의보로 격하 → 그 시점에 자식도 주의보로 격하

### 2.2 정책의 근거 (원칙 1과 캡 규칙)

이 정책은 다음 원칙으로부터 자동으로 도출됩니다.

- 원칙 1: 부모해역의 진실은 통보문
- 원칙 3: 자식 레벨 ≤ 부모 통보문 레벨 (캡)

캡 규칙이 매 사이클 적용되므로, 통보문상 부모가 주의보면 자식이 방재기상에서 경보로 표시되어도 자동으로 주의보로 캡 절단됩니다.

### 2.3 함수 형태

```
function applyParentDrivenLevelChange(childRow, parentTongbomun):
  rawLevel = childRow.wrnLvl
  parentLevel = parentTongbomun.currentLevel

  if rawLevel > parentLevel:
    # 방재기상이 미리 격상한 케이스
    finalLevel = parentLevel
    log("[격상 캡 적용] " + childRow.regId + " 방재기상=" + rawLevel + " → 통보문=" + parentLevel)
  else:
    finalLevel = rawLevel

  return finalLevel
```

---

## 3. 격상 발표 사전 시점의 처리

### 3.1 시나리오

격상 발표는 미래 시점에 적용됩니다.

- 10:00 — 부모 통보문 발표: "14:00부터 풍랑 경보로 격상 예정"
- 10:00 ~ 13:59 — 통보문상 부모는 여전히 주의보 발효 중 (격상 예정 정보는 upcoming)
- 14:00 — 통보문상 부모가 경보로 갱신

### 3.2 방재기상의 사전 격상 표시

방재기상은 격상 발표가 나는 즉시 자식을 경보로 표시합니다.

- 10:00 — 방재기상 응답에서 자식 = 풍랑 경보로 표시 시작
- 14:00 이전에도 계속 경보로 표시

### 3.3 우리 앱의 처리

- 10:00 ~ 13:59 — 통보문 부모 = 주의보 → 캡 적용으로 자식도 주의보 표시
- 14:00 — 통보문 부모 = 경보 → 캡이 풀리며 자식도 경보 표시
- 라벨: 14:00 시점에 "격상됨"으로 변경

### 3.4 함수 형태

```
function applyCapEachCycle(childRow, parentTongbomun):
  # 매 사이클 마다 자동으로 적용됨 (캡 규칙)
  finalLevel = min(childRow.wrnLvl, parentTongbomun.currentLevel)
  child.wrnLvl = finalLevel

  if previousChild.wrnLvl != finalLevel:
    if finalLevel > previousChild.wrnLvl:
      child.eventLabel = "격상됨"
    elif finalLevel < previousChild.wrnLvl:
      child.eventLabel = "격하됨"
    log("[자식 레벨 변경] " + child.regKo + " " + previousChild.wrnLvl + " → " + finalLevel)
```

---

## 4. 격하 발표 사전 시점의 처리

### 4.1 시나리오

격하 발표도 격상과 대칭적으로 처리됩니다.

- 10:00 — 부모 통보문 발표: "14:00부터 풍랑 주의보로 격하 예정"
- 10:00 ~ 13:59 — 통보문상 부모는 여전히 경보 발효 중
- 14:00 — 통보문상 부모가 주의보로 갱신

### 4.2 방재기상의 사전 격하 표시

- 10:00 — 방재기상 응답에서 자식 = 풍랑 주의보로 표시 시작 (사전 격하)
- 14:00 이전에도 계속 주의보로 표시

### 4.3 우리 앱의 처리

- 10:00 ~ 13:59 — 통보문 부모 = 경보 → 자식도 경보로 표시 유지
  - 캡 규칙: 자식의 방재기상 레벨(주의보)이 부모(경보)보다 낮음 → **자식 레벨이 부모를 초과하지 않으므로 캡 절단되지 않음**
  - 이 경우 자식이 부모보다 낮게 표시될 수 있음 (예: 부모 경보, 자식 주의보)

### 4.4 격하 케이스의 특수성

격상 케이스와 다른 점은 **방재기상의 사전 격하 표시가 캡 규칙을 통과한다**는 점입니다.

- 캡 규칙은 자식이 부모보다 **높을 때**만 절단
- 자식이 부모보다 **낮은 것은 자연 가능**한 상황 (실제로 부모 경보 + 자식 일부 주의보 케이스 존재)
- 따라서 방재기상의 사전 격하 표시가 그대로 표시됨

### 4.5 정책 결정 — 격하도 부모 우선

본 작업에서는 격하 케이스도 격상과 대칭적으로 부모 통보문을 우선합니다.

- 통보문상 부모가 아직 경보 발효 중 → 자식도 경보 유지
- 14:00 시점에 부모가 주의보로 갱신 → 그때 자식도 주의보로 갱신

### 4.5-A 정정 — 신호 변경 (2026-05-01)

**기존 정책의 한계**: `parentTongbomun.upcomingDowngrade` 신호는 통보문 갱신 시점에만 감지 가능. 그러나 방재기상은 통보문보다 빠르게 격하를 표시하므로, 그 시점에는 통보문에 `upcomingDowngrade`가 아직 없음 → 정책 발동 안 됨.

**정정 정책**: 신호를 **방재기상 부모 행 변동**으로 변경.
- 같은 사이클의 방재기상 응답에서 부모 행도 함께 격하/빠짐 → 사전 격하 → 자식 레벨 유지
- 방재기상 부모 행은 그대로 → 자식 단독 격하 → 즉시 적용 (LOGIC 06 자식 단독 해제와 대칭)

```
function applyDowngradeProtection(childRow, parentTongbomun, previousChild, parentRowFromAfso):
  # 자식 격하 감지 + 직전 사이클에 자식 = 부모 레벨이었던 경우만
  if childRow.wrnLvl < parentTongbomun.current.wrnLvl and
     previousChild and previousChild.current.wrnLvl == parentTongbomun.current.wrnLvl:

    # 방재기상 부모 행도 함께 격하/빠짐?
    parentLowered = (parentRowFromAfso == null) or
                    isEmptyRow(parentRowFromAfso) or
                    parentRowFromAfso.wrnLvl < parentTongbomun.current.wrnLvl

    if parentLowered:
      # 사전 격하 — 부모 레벨 유지 (통보문 격하까지 대기)
      log("[격하 사전 캡] 방재기상 부모-자식 동시 격하 감지 — 통보문 격하까지 부모 레벨 유지")
      return parentTongbomun.current.wrnLvl

  # 자식 단독 격하 또는 격하 아님 — 즉시 적용
  return childRow.wrnLvl
```

### 4.5-B 자식 단독 격하 (LOGIC 06과 대칭)

부모해역 통보문 그대로 + 방재기상 부모 행 그대로 + 자식만 격하 = **자식 단독 격하**.

- 즉시 적용 (LOGIC 06의 자식 단독 해제 정책과 대칭)
- 자식이 부모와 다른 레벨인 것은 자연 가능 (LOGIC 02 §3.5)
- 캡 규칙으로 자동 통과 (자식 < 부모이므로 절단 없음)

### 4.6 정책의 효과

이 정책으로 자식해역의 격상/격하는 항상 부모 통보문 갱신과 동기화됩니다.

- 통보문에 명시된 격상 예정 시각까지는 자식도 옛 레벨 유지
- 통보문에 명시된 격하 예정 시각까지는 자식도 옛 레벨 유지
- 사용자에게 보이는 변화는 부모 통보문 변화와 동기화됨

---

## 5. 부모 통보문 갱신 감지

### 5.1 갱신 감지 방법

부모 통보문이 갱신되었는지는 직전 사이클의 통보문 데이터와 이번 사이클의 데이터를 비교하여 감지합니다.

```
function detectParentLevelChange(parentRegId, currentTongbomun, previousTongbomun):
  curr = currentTongbomun.zones[parentRegId]
  prev = previousTongbomun.zones[parentRegId]

  if curr == null or prev == null:
    return null

  if curr.currentLevel != prev.currentLevel:
    return {
      from: prev.currentLevel,
      to: curr.currentLevel,
      direction: curr.currentLevel > prev.currentLevel ? "UPGRADE" : "DOWNGRADE"
    }

  return null
```

### 5.2 부모 통보문 갱신 → 자식 자연 따라감 (cascade가 아닌 캡 풀림)

**중요 표현 정정 (2026-05-01)**:

기존 표현은 "부모 변경 감지 시 자식 일괄 갱신"이라는 적극적 cascade 트리거로 보일 수 있으나, 실제 코드 동작은 다음과 같습니다.

- 매 사이클의 캡 규칙(LOGIC 13): `자식 레벨 = min(방재기상 자식 레벨, 부모 통보문 레벨)`
- 통보문 부모가 격상되면 → **캡이 풀리며** 자식이 자연스럽게 새 레벨로 표시됨
- 통보문 부모가 격하되면 → 동일 패턴 (단, 시나리오 ② 사전 격하 차단 정책 결합)

따라서 "cascade 트리거" 보다는 **"매 사이클 캡 자동 적용의 부수 효과로 자식이 부모를 따라감"** 으로 이해해야 정확합니다.

```
function applyCapEachCycle(childRow, parentTongbomun, prevChild):
  # 매 사이클 자동 적용
  newLvl = min(childRow.wrnLvl, parentTongbomun.currentLevel)

  # 직전 사이클 자식 레벨과 비교하여 라벨 추정
  if prevChild.current.wrnLvl != newLvl:
    if newLvl > prevChild.current.wrnLvl: child.eventLabel = "격상됨"
    elif newLvl < prevChild.current.wrnLvl: child.eventLabel = "격하됨"

  child.current.wrnLvl = newLvl
```

### 5.2-A 자식 단독 격상/격하

부모 통보문 변동 없이 자식만 변동하는 케이스 (LOGIC 06 자식 단독 해제와 대칭):
- 자식 단독 격상 (자식이 부모 레벨까지 격상) → 캡으로 부모 레벨로 막힘 (정상, 또는 부모와 같아짐)
- 자식 단독 격하 → 즉시 적용 (방재기상 부모 행도 그대로일 때, §4.5-A 참조)

---

## 6. 자식해역의 신규 격상 (직전 미발효 → 격상 등장)

### 6.1 시나리오

자식이 직전 사이클까지 미발효였고 부모도 미발효였다가, 이번 사이클에 부모가 격상 발효되며 자식도 등장하는 경우입니다.

이 경우는 격상이라기보다 **신규 발효**입니다.

- 직전: 부모 미발효, 자식 미발효
- 이번: 부모 풍랑 경보 발효 시작, 자식도 등장

### 6.2 라벨 처리

자식해역에 직전 발효 이력이 없으므로 라벨은 "발효됨"이지 "격상됨"이 아닙니다.

```
function determineEventLabel(childRegId, parentChange, previousChild):
  if previousChild == null or previousChild.current == null:
    return "발효됨"  # 직전 발효 이력 없음 → 신규
  else:
    if parentChange != null:
      return parentChange.direction == "UPGRADE" ? "격상됨" : "격하됨"
    else:
      return null  # 변화 없음
```

---

## 7. 격상/격하 직후 자식 잠깐 사라짐의 처리

### 7.1 시나리오

방재기상은 격상/격하 발표 직후 자식을 잠시 응답에서 빼버리고 새 레벨로 재등장시키는 패턴이 있습니다.

- 13:30:00 — 가파도 풍랑 주의보 응답에 등장
- 13:30:05 — 격상 발표 → 가파도 응답에서 빠짐
- 13:30:30 — 가파도 풍랑 경보로 재등장

### 7.2 처리 정책

이 패턴은 다음 두 정책으로 자연스럽게 처리됩니다.

- **2회 연속 빠짐 정책 (06번 문서)**: 1회 빠짐은 화면 유지 → 사용자 화면에 깜빡임 없음
- **부모 통보문 우선 정책 (본 문서)**: 부모가 격상되어야 자식도 격상

따라서 13:30:05 시점에 자식이 빠졌어도 화면 표시는 유지되고, 13:30:30 시점에 자식이 다시 등장하면 missedCount가 리셋되며 부모 변화에 맞춰 라벨이 갱신됩니다.

---

## 8. 본 파일 다음 작업

- 다음 파일: `10_case_preliminary.md`
- 주제: 예비특보(`wrnLvl=1`) 처리 정책
