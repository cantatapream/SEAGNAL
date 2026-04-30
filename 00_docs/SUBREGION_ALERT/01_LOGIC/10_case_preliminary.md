# 자식해역 특보 표출 로직 — 1.10 케이스: 예비특보 (wrnLvl=1)

## 0. 본 파일의 위치

본 파일은 `01_LOGIC/` 시리즈의 열 번째 파일이며, 자식해역에 대한 예비특보(`wrnLvl=1`) 처리 정책을 다룹니다.

---

## 1. 예비특보의 정의

### 1.1 정의

예비특보는 가까운 미래에 특보가 발효될 가능성이 있을 때 사전에 발표되는 단계입니다.

- 통보문상 표기: 예비
- 방재기상 API에서: `wrnLvl="1"` 또는 `wrnLvlName="예비"`
- 일반 단계 순서: 예비 → 주의보 → 경보 (낮음 → 높음)

### 1.2 예비특보의 의미

- 발효 중은 아니지만 가까운 시기에 발효될 가능성이 있음
- 사용자에게 경각심을 주는 사전 알림 역할
- 부모해역 통보문에 종종 등장
- 자식해역에도 방재기상시스템에서 `wrnLvl=1`로 표시될 수 있음

---

## 1-A. 동일 해역의 다중 특보 처리 정책 (전제)

### 1-A.1 단일 특보 전제 (사용자 결정 사항)

본 작업은 다음을 전제로 합니다.

- **동일 자식해역에 두 종류의 특보(예: 풍랑 + 폭풍해일)가 동시에 발효되는 경우는 없음**
- 이는 사용자 결정 사항이며, 자연 발생적으로도 매우 드문 케이스
- upcoming(예비) 형태로는 동시에 존재할 수 있음 (예: 풍랑 발효 + 폭풍해일 예비)

### 1-A.2 만약 발생할 경우의 폴백 정책 — 풍랑 우선

데이터 이상 또는 매우 드문 케이스로 동일 자식해역에 두 종류의 특보가 동시에 발효 행으로 들어올 경우의 폴백 정책:

- **풍랑을 우선 표시**
- 다른 종류는 무시 (오류 로그 기록)

### 1-A.3 함수 형태

```
function selectPrimaryWarning(rows):
  # 동일 regId 행이 여러 종류로 들어온 경우
  windRows = rows.filter(r => r.wrnTp == "풍랑" and not isEmptyRow(r))
  otherRows = rows.filter(r => r.wrnTp != "풍랑" and not isEmptyRow(r))

  if windRows.length > 0 and otherRows.length > 0:
    log("[데이터 이상] 동일 해역에 풍랑과 다른 종류 특보 동시 발효 — 풍랑 우선")
    return windRows[0]

  if windRows.length > 0:
    return windRows[0]

  if otherRows.length > 0:
    return otherRows[0]

  return null
```

### 1-A.4 정책의 근거

- 풍랑은 해상에서 가장 자주 발효되는 특보 종류
- 사용자(선원)에게 가장 직접적인 영향
- 만약 두 종류가 함께 들어왔다면 사용자에게 가장 중요한 풍랑을 우선 노출하는 것이 안전 측

---

## 2. 자식해역에 예비특보가 등장하는 패턴

### 2.1 패턴 A — 자식이 다른 발효 중 + 별종 예비특보 등장

- 가파도연안 = 풍랑 경보 발효 중
- 같은 가파도연안에 폭풍해일 주의보가 예비로 추가 (다른 종류)

### 2.2 패턴 B — 자식이 미발효 + 예비특보만 등장

- 가파도연안 = 발효 특보 없음
- 가파도연안에 풍랑 주의보 예비특보 등장

### 2.3 패턴 C — 같은 종류의 격상/격하 예비

- 가파도연안 = 풍랑 주의보 발효 중
- 같은 풍랑의 경보로 격상 예비 등장

---

## 3. 패턴별 처리 정책

### 3.1 패턴 A — 다른 종류의 예비특보 추가

**정책**: 표시하지 않음

- 동일 자식해역에는 동시에 한 종류의 특보만 표시 (사용자 결정)
- 따라서 발효 중인 풍랑 경보만 표시
- 폭풍해일 예비특보는 부모해역 화면에서만 표시 (자식해역에는 표출 안 함)

### 3.2 패턴 B — 자식이 미발효이고 예비특보만 등장

**정책**: 표시함

- 자식해역에 발효 중인 특보가 없을 때 예비특보만 등장하면 그것을 표시
- 사용자에게 "예비특보"임을 명확히 알 수 있도록 라벨에 반영
- 라벨: "예비특보 발표"

### 3.3 패턴 C — 같은 종류의 격상/격하 예비

**정책**: 표시하지 않음 (격상/격하 정보는 부모해역에서만)

- 자식해역은 현재 발효 중인 풍랑 주의보만 표시
- 격상 예비 정보는 부모해역의 upcoming에서만 표시
- 격상 예정 시각이 도달하면 부모 통보문이 갱신되며 그때 자식도 격상 (`09_case_level_change.md` 참조)

---

## 4. 함수 형태

### 4.1 예비특보 행 분류

```
function classifyWrnLevel(row):
  if row.wrnLvl == "1" or row.wrnLvlName == "예비":
    return "PRELIMINARY"
  elif row.wrnLvl == "2" or row.wrnLvlName == "주의보":
    return "WATCH"
  elif row.wrnLvl == "3" or row.wrnLvlName == "경보":
    return "WARNING"
  else:
    return "UNKNOWN"
```

### 4.2 예비특보 처리 결정

```
function shouldDisplayPreliminary(row, currentChildState):
  # 패턴 A — 다른 종류 발효 중 + 별종 예비
  if currentChildState != null and
     currentChildState.current != null and
     currentChildState.wrnTp != row.wrnTp:
    return false  # 다른 종류이므로 표시 안 함

  # 패턴 C — 같은 종류 + 격상 예비
  if currentChildState != null and
     currentChildState.current != null and
     currentChildState.wrnTp == row.wrnTp:
    return false  # 격상 예비는 표시 안 함 (부모 통보문이 격상되면 자식도 자동)

  # 패턴 B — 미발효 + 예비특보 단독
  if currentChildState == null or currentChildState.current == null:
    return true  # 표시함

  return false
```

---

## 5. 예비특보의 라벨

### 5.1 라벨 표기

자식해역의 예비특보는 다음과 같이 표기됩니다.

- 예비특보 발표 시: "예비특보 발표"
- 예비특보 발효 시: "예비특보 발효" (방재기상 정의상 예비도 발효 상태일 수 있음)
- 정식 주의보로 격상 시: "격상됨" (다음 케이스에서 처리)

### 5.2 사용자 화면 표시

- 일반 발효 특보와 시각적으로 구분되도록 별도 스타일 (예: 회색 톤)
- 예비특보임을 명확히 알 수 있는 텍스트 라벨

---

## 6. 예비특보의 부모해역과의 관계

### 6.1 부모 발효 중 + 자식 예비특보 (패턴 A의 변형)

- 부모 통보문: 풍랑 경보 발효 중
- 방재기상 자식: 가파도연안 = 풍랑 경보 발효 (정상) + 폭풍해일 주의보 예비

이 경우 자식해역 화면에는 풍랑 경보만 표시. 폭풍해일 예비는 부모해역 화면에서 보여줍니다.

### 6.2 부모 미발효 + 자식 예비특보

- 부모 통보문: 미발효
- 방재기상 자식: 가파도연안 = 풍랑 주의보 예비

이 경우는 원칙 5(부모 없으면 자식도 없음)에 위배되는 비정상 데이터입니다. 다만 예비특보는 "발효 전" 단계이므로 원칙 5의 엄격한 적용 대상이 아닐 수 있습니다.

**처리 정책**: 부모 통보문에도 예비특보 발표가 있는지 확인. 있으면 자식 예비도 표시. 없으면 데이터 이상으로 로그 + 표시 보류.

```
function handleChildPreliminary(row, parentTongbomun):
  if parentTongbomun.current != null:
    # 부모 발효 중 → 패턴 A로 처리
    return shouldDisplayPreliminary(row, ...)

  if parentTongbomun.preliminary != null and
     parentTongbomun.preliminary.wrnTp == row.wrnTp:
    # 부모도 예비특보 상태 → 자식도 예비 표시
    return true

  log("[데이터 이상] 부모 미발효 + 부모 예비도 없는데 자식 예비특보 등장")
  return false
```

---

## 7. 예비특보가 사라지는 경우

### 7.1 예비특보 → 발효 전환

예비특보가 정식 주의보 또는 경보로 발효되는 경우입니다.

- 직전 사이클: 자식 = 풍랑 주의보 예비 (`wrnLvl=1`)
- 이번 사이클: 자식 = 풍랑 주의보 (`wrnLvl=2`)

**처리**: "예비특보 발표"가 "발효됨"으로 갱신.

### 7.2 예비특보 → 사라짐 (취소)

예비특보가 발효 없이 취소되는 경우입니다.

- 직전 사이클: 자식 = 풍랑 주의보 예비
- 이번 사이클: 자식 행 빠짐 (또는 빈 행)

**처리**: 예비특보 표시 제거. 사라짐 처리는 일반 케이스(05, 06번 문서)와 동일.

---

## 8. 캡 규칙과 예비특보의 상호작용

### 8.1 부모가 예비특보면 자식도 예비특보까지

캡 규칙은 자식 레벨이 부모 레벨을 초과하지 못하게 합니다.

- 부모 통보문: 풍랑 예비특보
- 방재기상 자식: 풍랑 주의보로 표시 (방재기상이 미리 격상)

이 경우 캡 적용으로 자식도 풍랑 예비특보로 표시.

### 8.2 함수 형태

```
function applyCapWithPreliminary(childRow, parentTongbomun):
  parentLevel = getParentLevel(parentTongbomun)  # 1=예비, 2=주의보, 3=경보

  childLevel = parseInt(childRow.wrnLvl)

  finalLevel = min(childLevel, parentLevel)
  return finalLevel
```

---

## 9. 본 파일 다음 작업

- 다음 파일: `11_case_parent_auto_release.md`
- 주제: 부모해역 자동 해제 시 자식해역 일괄 정리
