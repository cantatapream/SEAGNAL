# 자식해역 특보 표출 로직 — 1.8 케이스: 자식해역 신규 등장

## 0. 본 파일의 위치

본 파일은 `01_LOGIC/` 시리즈의 여덟 번째 파일이며, 이전까지의 케이스(빠짐, 동시 사라짐)와 반대로 자식해역이 응답에 **새로 등장**하는 경우를 다룹니다.

신규 등장은 단순한 신규 발효일 수도, 격상/격하 후 재등장일 수도 있습니다. 본 파일에서는 두 케이스를 구분하는 로직을 정리합니다.

---

## 1. 케이스 정의

### 1.1 발생 상황

- 직전 사이클: 자식해역 X가 응답에 없거나 빈 행이었음
- 이번 사이클: 자식해역 X가 발효 행으로 응답에 등장

### 1.2 두 가능성

신규 등장의 원인은 다음 중 하나입니다.

- **(가) 진짜 신규 발효**: 그 자식해역에 처음으로 특보가 발효됨
- **(나) 격상/격하 후 재등장**: 직전에 격상/격하 발표로 잠시 빠졌다가 새 레벨로 재등장

본 파일에서는 두 케이스를 구분하는 정책과 함수를 정리합니다.

---

## 2. 구분 정책 — 부모 통보문 변화 우선

### 2.1 핵심 원칙

자식의 신규 등장이 격상/격하인지, 진짜 신규 발효인지를 결정하는 가장 신뢰할 수 있는 기준은 **부모 통보문의 변화**입니다.

- 부모 통보문이 격상되었고 자식이 새 레벨로 등장 → **격상 (재등장)**
- 부모 통보문이 격하되었고 자식이 새 레벨로 등장 → **격하 (재등장)**
- 부모 통보문에 변화가 없는데 자식만 새로 등장 → **신규 발효**

### 2.2 정책의 근거

부모해역은 통보문이 진실(원칙 1)이며, 자식의 변화는 부모 변화와 결합되어 있습니다(원칙 5). 따라서 자식 단독의 변화 패턴보다 부모 통보문의 갱신 이벤트가 더 결정적인 신호입니다.

### 2.3 함수 형태

```
function classifyNewChild(childRegId, currentRow, parentTongbomunCurrent, parentTongbomunPrevious):
  if parentTongbomunCurrent.level != parentTongbomunPrevious.level:
    if parentTongbomunCurrent.level > parentTongbomunPrevious.level:
      return "UPGRADED"  # 격상
    else:
      return "DOWNGRADED"  # 격하

  return "NEW"  # 부모 변화 없음 → 신규 발효
```

---

## 3. 신규 발효 처리

### 3.1 처리 절차

1. 자식해역 X에 대해 매핑 테이블에서 우리 앱 이름 조회
2. 부모 통보문 상태 조회 → 부모가 발효 중이어야 함 (원칙 5 위반 시 데이터 이상)
3. 캡 규칙 적용 (원칙 3)
4. `subregion_lifecycle.json`에 새 항목 추가
5. 라벨: "발효됨" (또는 "발표됨")

### 3.2 함수 형태

```
function processNewActivation(row, parentTongbomun, previousState):
  childRegId = row.regId
  appName = lookupAppName(childRegId)

  if appName == null:
    log("[매핑 누락] " + childRegId + " 매핑 없음 — 신규 발효 무시")
    return

  if parentTongbomun.current == null:
    log("[데이터 이상] 부모 미발효인데 자식 신규 발효 행 등장")
    return  # 원칙 5 — 부모 없으면 자식도 없음

  finalLevel = min(row.wrnLvl, parentTongbomun.currentLevel)
  finalEndTime = min(row.tmEd, parentTongbomun.tmCc)

  newChild = {
    regId: childRegId,
    regKo: appName,
    parentRegId: row.regUp,
    wrnTp: row.wrnTp,
    wrnLvl: finalLevel,
    tmEf: row.tmEf,
    tmEd: finalEndTime,
    status: "confirmed",
    lastSeenAt: now(),
    missedCount: 0,
    eventLabel: "발효됨"
  }

  previousState.subregions[childRegId] = newChild
  log("[자식 신규 발효] " + appName + " 풍랑 " + finalLevel)
```

---

## 4. 격상/격하 (재등장) 처리

### 4.1 격상 케이스

부모 통보문이 격상된 직후 자식이 새 레벨로 응답에 등장하는 경우입니다.

- 직전 부모 통보문: 풍랑 주의보
- 갱신 부모 통보문: 풍랑 경보
- 자식 응답 등장: 풍랑 경보 (또는 캡 적용으로 경보)

### 4.2 격하 케이스

부모 통보문이 격하된 직후 자식이 새 레벨로 응답에 등장하는 경우입니다.

- 직전 부모 통보문: 풍랑 경보
- 갱신 부모 통보문: 풍랑 주의보
- 자식 응답 등장: 풍랑 주의보 (또는 캡 적용으로 주의보)

### 4.3 처리 절차

1. 부모 통보문의 레벨 변화 감지 → `09_case_level_change.md` 참조
2. 자식해역의 등장이 부모 변화 직후인지 확인
3. 라벨: "격상됨" 또는 "격하됨"
4. 자식해역의 `eventLabel` 갱신
5. 사용자에게 표시되는 라벨이 "신규 발효"가 아닌 "격상"/"격하"로 표기

### 4.4 함수 형태

```
function processLevelChangeReentry(row, parentTongbomunCurrent, parentTongbomunPrevious, previousState):
  childRegId = row.regId

  if parentTongbomunCurrent.level > parentTongbomunPrevious.level:
    label = "격상됨"
  elif parentTongbomunCurrent.level < parentTongbomunPrevious.level:
    label = "격하됨"
  else:
    label = "발효됨"  # 부모 변화 없음 — 신규 발효로 처리

  child = previousState.subregions[childRegId]
  if child == null:
    # 직전 사이클에 없었던 자식이 등장
    processNewActivation(row, parentTongbomunCurrent, previousState)
    if label != "발효됨":
      previousState.subregions[childRegId].eventLabel = label
  else:
    # 직전에 있던 자식이 갱신됨
    child.wrnLvl = min(row.wrnLvl, parentTongbomunCurrent.currentLevel)
    child.tmEd = min(row.tmEd, parentTongbomunCurrent.tmCc)
    child.eventLabel = label
    child.lastSeenAt = now()
    child.missedCount = 0
```

---

## 5. 부모 통보문이 자식보다 늦게 갱신되는 케이스

### 5.1 시나리오

방재기상이 부모 통보문보다 빠르게 갱신되는 경우 다음 시나리오가 발생할 수 있습니다.

- 14:00 — 부모 통보문에 격상 발표가 곧 올 예정
- 14:00:30 — 방재기상에 자식이 이미 경보로 등장
- 14:01:00 — 부모 통보문이 아직 주의보
- 14:01:30 — 부모 통보문 갱신 (경보)

### 5.2 처리 정책

- 14:00:30 시점: 부모는 통보문상 주의보 → 자식 응답이 경보여도 **캡 적용으로 자식도 주의보**
- 14:01:30 시점: 부모 통보문 격상 → 자식의 캡이 풀려서 경보로 갱신

이 흐름은 캡 규칙(원칙 3)에 의해 자동으로 처리됩니다.

### 5.3 라벨 처리

자식의 `eventLabel`은 부모 통보문의 변화가 감지된 시점에 갱신됩니다.

- 14:00:30 — 자식 등장, 캡으로 주의보 → 라벨 "발효됨"
- 14:01:30 — 부모 격상, 자식도 격상 → 라벨 "격상됨"으로 갱신

이렇게 하면 사용자는 자식의 정확한 변화를 단계적으로 보게 됩니다.

---

## 6. 빠진 후 재등장의 시간 윈도우

### 6.1 짧은 시간 빠진 후 재등장

방재기상은 격상/격하 발표 직후 **잠시 빠졌다가 새 레벨로 재등장**하는 패턴이 있습니다.

- 13:30 — 가파도 풍랑 주의보
- 13:30:05 — 가파도 응답에서 빠짐 (격상 발표 시점)
- 13:30:30 — 가파도 풍랑 경보로 재등장

### 6.2 처리 정책

이 짧은 빠짐은 다음 정책으로 처리됩니다.

- 13:30:05 시점: `missedCount=1`, 화면 표시 유지 (1회 빠짐 = 보수 대기)
- 13:30:30 시점: 정상 응답으로 등장 → `missedCount=0`으로 리셋, 캡 적용

따라서 사용자 화면에는 1회 빠짐이 보이지 않고, 자연스럽게 격상으로 보입니다.

### 6.3 부모 통보문의 격상 시점

부모 통보문이 같은 시기에 격상되었으면 → 라벨이 "격상됨"으로 갱신.
부모 통보문이 아직 격상 전이면 → 캡으로 자식도 그대로 직전 레벨 유지.

---

## 7. 신규 발효의 신뢰 수준

### 7.1 즉시 확정 가능

신규 발효는 직전 사이클에 비교 데이터가 명확하므로 즉시 확정 처리 가능합니다.

- 직전 사이클에 없었던 행이 이번 사이클에 발효 행으로 등장 → 즉시 신규 발효
- 추정 표시 불필요 (확정 상태로 분류)

### 7.2 함수 형태

```
function isNewActivation(childRegId, currentRow, previousState):
  prevChild = previousState.subregions[childRegId]
  if prevChild == null or prevChild.current == null:
    if currentRow != null and not isEmptyRow(currentRow):
      return true
  return false
```

---

## 8. 본 케이스의 함정 — 콜드 스타트

### 8.1 시나리오

서버 재시작 직후 첫 폴링 시점에:

- 어제부터 가파도 풍랑 경보 발효 중 (어제부터 살아있음)
- 서버 재시작 → 메모리 비교 데이터 손실
- 첫 폴링 결과 가파도 행 정상 등장
- "신규 발효!"로 잘못 판정될 수 있음

### 8.2 방어 방법

`subregion_lifecycle.json`을 영속화하여 재시작 후에도 직전 상태를 복원합니다.

- 재시작 → 파일에서 직전 상태 로드
- 첫 폴링 결과와 직전 상태 비교
- 같은 발효 상태 → "변화 없음"으로 처리, 신규 발효 이벤트 발생 안 함

### 8.3 가드 코드

```
function loadPreviousState():
  if file_exists("subregion_lifecycle.json"):
    return readJsonFile("subregion_lifecycle.json")
  else:
    return { subregions: {} }  # 빈 상태로 시작

function judgeFirstCycleAfterRestart(currentRow, previousState):
  prevChild = previousState.subregions[currentRow.regId]
  if prevChild != null and prevChild.current != null:
    if sameSpec(prevChild, currentRow):
      return "UNCHANGED"  # 같은 발효 상태 → 이벤트 없음
  ...
```

이 가드는 콜드 스타트 외에도 일반적으로 안전망 역할을 합니다.

---

## 9. 본 파일 다음 작업

- 다음 파일: `09_case_level_change.md`
- 주제: 격상/격하 발표 시 자식해역의 처리 (부모 통보문 우선)
