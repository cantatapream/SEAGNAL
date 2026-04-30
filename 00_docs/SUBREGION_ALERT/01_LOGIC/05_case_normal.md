# 자식해역 특보 표출 로직 — 1.5 케이스: 정상 (빈 행 활용)

## 0. 본 파일의 위치

본 파일은 `01_LOGIC/` 시리즈의 다섯 번째 파일이며, 모든 케이스 분석의 첫 번째 사례입니다.

**가장 일반적인 정상 케이스**, 즉 방재기상 API가 정상 응답을 반환하고 자식해역의 상태가 명확한 경우를 다룹니다.

---

## 1. 정상 케이스의 정의

### 1.1 정상 응답의 조건

다음 조건을 모두 만족하는 응답을 "정상 응답"으로 간주합니다.

- HTTP 200 OK
- `meta.err` 필드가 `"false"` 또는 비어 있음
- `data.metData`가 배열이며 `length > 0`
- 응답 구조가 예상한 스키마에 부합

### 1.2 정상 응답의 자식해역 분류

정상 응답에서 자식해역 행은 두 가지 형태로 들어옵니다.

- **(가) 발효 행**: `wrnSeq != "99"`, `wrnTp` 비어있지 않음, `wrnLvl` 비어있지 않음
- **(나) 빈 행 (특보 없음 신호)**: `wrnSeq == "99"`, `wrnTp == ""`, `wrnLvl == ""`

본 파일은 이 두 형태의 처리를 다룹니다.

---

## 2. 빈 행(`wrnSeq=99`)의 의미

### 2.1 명시적 "특보 없음" 신호

`wrnSeq=99` 행은 단순히 "데이터 없음"이 아니라 **방재기상시스템이 명시적으로 보내주는 "특보 없음 확인 신호"** 입니다.

- 그 자식해역이 트리에 살아있고 정상적으로 추적되고 있음
- 다만 현재 그 해역에 발효 중인 특보가 없음
- 즉, "그 자식해역에 특보가 없다"는 사실을 신뢰할 수 있음

### 2.2 빈 행과 행 누락의 차이

| 케이스 | 의미 | 신뢰 수준 |
|---|---|---|
| 응답에 `wrnSeq=99` 행 존재 | 트리에서 추적 중, 특보 없음 | 명확한 신호로 신뢰 |
| 응답에 행 자체가 없음 | API 일시 누락 가능성 | 단독 신뢰 불가, 추가 판정 필요 |

### 2.3 본 작업에서의 활용

빈 행은 자식해역 상태 판정에서 다음 역할을 합니다.

- 자식해역의 표시 상태를 "특보 없음"으로 즉시 확정 가능
- 직전 사이클에 발효였다면 "지금 해제됐음"이 명확
- "행 누락"으로 인한 보수적 판정(2회 연속 빠짐 대기 등)이 필요 없음

### 2.4 함수 형태

```
function isEmptyRow(row):
  return row.wrnSeq == "99" or
         (row.wrnTp == "" and row.wrnLvl == "")

function isActiveRow(row):
  return not isEmptyRow(row)
```

---

## 3. 발효 행 처리

### 3.1 발효 행의 정의

`wrnSeq` 값이 `"99"`가 아니고 `wrnTp`/`wrnLvl`이 비어있지 않은 행입니다.

```json
{
  "regId": "S2122000",
  "regKo": "가파도연안바다",
  "regUp": "S1232000",
  "wrnSeq": "1",
  "wrnTp": "풍랑",
  "wrnLvlName": "주의보",
  "wrnLvl": "2",
  "tmFc": "202604301400",
  "tmEf": "202604301400",
  "tmEd": "202605010600"
}
```

### 3.2 처리 절차

1. 부모해역의 통보문 상태를 조회 (원칙 1)
2. 자식 레벨이 부모 레벨을 초과하는지 확인 → 초과 시 캡 적용 (원칙 3)
3. 자식 종료 시각이 부모 종료 시각을 초과하는지 확인 → 초과 시 캡 적용 (원칙 3)
4. 캡 적용 결과로 자식 상태 확정
5. `subregion_lifecycle.json`에 저장

### 3.3 함수 형태

```
function processActiveRow(row, parentTongbomun):
  # Step 1: 부모 상태 조회
  if parentTongbomun.current == null:
    log("[데이터 이상] 부모해역이 통보문상 발효 안 됐는데 자식 발효 행 존재")
    return null  # 부모가 없으면 자식도 없음 (원칙 5)

  # Step 2~3: 캡 적용
  finalLevel = min(row.wrnLvl, parentTongbomun.currentLevel)
  finalEndTime = min(row.tmEd, parentTongbomun.tmCc)

  # Step 4: 자식 상태 객체 생성
  return {
    regId: row.regId,
    regKo: lookupAppName(row.regId),  # 매핑 테이블 적용
    parentRegId: row.regUp,
    wrnTp: row.wrnTp,
    wrnLvl: finalLevel,
    tmEf: row.tmEf,
    tmEd: finalEndTime,
    status: "confirmed",  # 정상 응답으로 확인된 상태
    lastSeenAt: now(),
    missedCount: 0
  }
```

---

## 4. 빈 행 처리 (특보 없음 확인)

### 4.1 처리 절차

1. 직전 사이클의 자식 상태를 조회
2. 직전 사이클에 발효였다면 "방금 해제됐음"으로 처리
3. 직전 사이클에도 비어있었다면 "계속 특보 없음"
4. `subregion_lifecycle.json`에서 해당 자식 항목 삭제 또는 `current=null`

### 4.2 함수 형태

```
function processEmptyRow(row, previousState):
  childRegId = row.regId

  if previousState.subregions[childRegId] == null:
    # 이전에도 없었음 → 계속 없음
    return  # 변화 없음, 처리 끝

  if previousState.subregions[childRegId].current != null:
    # 이전에 발효였는데 지금 빈 행 → 방금 해제
    log("[자식 해제] " + lookupAppName(childRegId) + " 해제됨 (빈 행 신호)")
    previousState.subregions[childRegId].current = null
    previousState.subregions[childRegId].lastReleasedAt = now()
```

### 4.3 빈 행 신호의 즉시성

빈 행은 즉시 해제 처리가 가능합니다.

- "행이 빠진 경우"는 일시 오류 가능성 때문에 2회 연속 빠짐을 기다리는데
- "빈 행이 명시적으로 들어온 경우"는 방재기상이 적극적으로 알려준 신호이므로 보수적 대기 불필요
- 따라서 빈 행 → 즉시 해제

---

## 5. 정상 응답에서의 자식해역 일괄 처리 흐름

### 5.1 한 사이클의 자식해역 처리 알고리즘

```
function processNormalResponse(response, previousState, parentStates):
  # 응답에서 자식 행만 추출 (regId != regUp 인 행)
  childRows = response.data.metData.filter(r => r.regId != r.regUp)

  # 각 행을 분류 처리
  for row in childRows:
    parentTongbomun = parentStates[mapAfsoToTongbomun(row.regUp)]

    if isEmptyRow(row):
      processEmptyRow(row, previousState)
    else:
      newState = processActiveRow(row, parentTongbomun)
      previousState.subregions[row.regId] = newState

  # 응답에 행 자체가 없는 자식 처리 (별도 케이스, 06번 문서에서 다룸)
  trackMissingRows(childRows, previousState)
```

### 5.2 매 사이클의 누적 효과

이 알고리즘은 매 1분마다 반복되며, 자식해역 상태가 다음과 같이 누적/갱신됩니다.

- 정상 응답이 계속 들어오면 → 자식 상태가 매 사이클 갱신, 변화는 즉시 반영
- 한 자식이 발효 → 빈 행으로 바뀌면 → 즉시 해제 처리
- 한 자식이 빈 행 → 발효 행으로 바뀌면 → 신규 발효로 처리 (자세한 내용은 `08_case_new_child.md`)

---

## 6. 함정 — 매핑 누락 행은 빈 행 처리에서도 동일

### 6.1 시나리오

응답에 발효 행 또는 빈 행이 있지만, 그 `regId`가 우리 앱 매핑 테이블에 없는 경우입니다.

### 6.2 처리 방침

- 매핑이 없으면 우리 앱은 그 자식해역을 사용자에게 표시할 수 없음
- 처리: 해당 행 무시 + 운영 로그 기록 (서술형)
- 자세한 정책: `02_DATA_MODEL/06_mapping_policy.md`

### 6.3 함수 형태

```
function processRow(row, previousState, parentStates):
  appName = lookupAppName(row.regId)
  if appName == null:
    log("[매핑 누락] regId=" + row.regId + " 우리 앱에 매핑 없음")
    return  # 무시 + 로그

  # 정상 매핑이 있는 경우만 본격 처리
  ...
```

---

## 7. 정상 케이스의 비-이상 신호

### 7.1 모든 자식이 발효 행인 응답

- 전국적으로 특보가 활발한 시기 (태풍 등)에는 자식해역 다수가 발효 행으로 들어옴
- 이 경우에도 알고리즘은 동일하게 동작
- 캡 규칙은 매 행마다 적용

### 7.2 모든 자식이 빈 행인 응답

- 평온한 시기에는 모든 자식이 빈 행으로 들어옴
- 이 경우에도 응답은 정상으로 간주 (행 수가 충분하면)
- 단, **응답이 완전히 비어있는 경우(`metData.length == 0`)는 오류로 간주** — 자세한 내용은 `02_error_handling.md`

---

## 8. 본 파일 다음 작업

- 다음 파일: `06_case_child_disappear.md`
- 주제: 자식해역 행이 응답에서 빠지는 케이스 (1회 / 2회 연속)
- 본 파일에서 다룬 빈 행과 달리, 행 자체가 응답에 없는 경우의 보수적 판정 정책
