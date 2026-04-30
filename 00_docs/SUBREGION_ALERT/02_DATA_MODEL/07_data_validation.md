# 자식해역 특보 표출 — 2.7 데이터 검증 규칙

## 0. 본 파일의 위치

본 파일은 `02_DATA_MODEL/` 시리즈의 일곱 번째 파일이며, 데이터 흐름 각 지점에서의 검증 규칙을 정리합니다.

---

## 1. 검증 지점

본 작업은 다음 지점에서 데이터 검증을 수행합니다.

| 지점 | 대상 | 실패 시 동작 |
|---|---|---|
| 응답 수신 직후 | 방재기상 API 응답 | 갱신 보류 + 오류 로그 |
| 행 처리 시 | 각 행의 필수 필드 | 그 행만 무시 + 로그 |
| 매핑 적용 시 | regId 매핑 존재 여부 | 행 무시 + unmapped 추가 |
| 캡 적용 시 | 자식 vs 부모 비교 | 캡 적용 + 로그 (정상 처리) |
| 영속화 시 | 자식 상태 객체 무결성 | 영속화 보류 + 알림 |
| 시작 시 | 매핑 테이블 무결성 | 매핑 사용 불가 + 알림 |

---

## 2. 응답 검증

### 2.1 검증 규칙

```
function validateAfsoResponse(response):
  # HTTP 레벨
  if response.statusCode != 200:
    return { valid: false, reason: "HTTP_STATUS", detail: response.statusCode }

  if response.body == null:
    return { valid: false, reason: "EMPTY_BODY" }

  # 메타 레벨
  if response.body.meta == null:
    return { valid: false, reason: "MISSING_META" }

  if response.body.meta.err == "true":
    return { valid: false, reason: "META_ERR_TRUE", detail: response.body.meta.errCd }

  # 데이터 레벨
  if response.body.data == null:
    return { valid: false, reason: "MISSING_DATA" }

  if response.body.data.metData == null:
    return { valid: false, reason: "MISSING_METDATA" }

  if not Array.isArray(response.body.data.metData):
    return { valid: false, reason: "METDATA_NOT_ARRAY" }

  if response.body.data.metData.length == 0:
    return { valid: false, reason: "METDATA_EMPTY" }

  return { valid: true }
```

### 2.2 실패 시 동작

응답 검증 실패 시:
- 그 사이클의 자식해역 갱신 보류
- `subregion_error_log.json`에 `AFSO_RESPONSE_ERROR` 오류 기록
- 첫 발생 시 관리자 푸시
- 다음 사이클 대기

---

## 3. 행 검증

### 3.1 발효 행 필수 필드

```
function validateActiveRow(row):
  errors = []

  if not /^S\d{7}$/.test(row.regId):
    errors.push("invalid regId: " + row.regId)

  if row.regKo == "":
    errors.push("empty regKo for " + row.regId)

  if not /^S\d{7}$/.test(row.regUp):
    errors.push("invalid regUp for " + row.regId)

  if row.wrnTp == "":
    errors.push("empty wrnTp for " + row.regId)

  if not /^[123]$/.test(row.wrnLvl):
    errors.push("invalid wrnLvl for " + row.regId + ": " + row.wrnLvl)

  if row.tmEf != "" and not /^\d{12}$/.test(row.tmEf):
    errors.push("invalid tmEf for " + row.regId + ": " + row.tmEf)

  return errors
```

### 3.2 빈 행 검증

빈 행은 `wrnSeq=99`만 확인하면 충분.

```
function validateEmptyRow(row):
  if row.wrnSeq != "99":
    return ["expected wrnSeq=99 but got " + row.wrnSeq]
  if not /^S\d{7}$/.test(row.regId):
    return ["invalid regId in empty row: " + row.regId]
  return []
```

### 3.3 검증 실패 시 동작

특정 행이 검증 실패해도 응답 전체를 무효화하지는 않습니다.

- 실패한 행만 건너뜀
- 다른 행은 정상 처리
- 운영 로그 기록

---

## 4. 매핑 검증

### 4.1 매핑 조회 결과 검증

```
function validateMapping(afsoRegId):
  appName = lookupAppName(afsoRegId)
  if appName == null:
    return { valid: false, reason: "MAPPING_MISSING" }
  if appName == "":
    return { valid: false, reason: "EMPTY_APP_NAME" }
  return { valid: true, appName: appName }
```

### 4.2 부모 결합 검증

자식의 `regUp`이 매핑 테이블의 `parents`에 존재하는지 확인:

```
function validateParentLinkage(afsoRow):
  parentEntry = aliasMap.parents[afsoRow.regUp]
  if parentEntry == null:
    return { valid: false, reason: "PARENT_NOT_MAPPED", detail: afsoRow.regUp }
  return { valid: true, parent: parentEntry }
```

### 4.3 실패 시 동작

매핑 누락 시:
- `unmapped` 섹션 갱신
- 오류 로그 기록 (서술형)
- 그 행 처리 건너뜀
- 자세한 정책: `06_mapping_policy.md`

---

## 5. 자식 vs 부모 일관성 검증

### 5.1 부모 발효 검증

자식이 발효 행으로 들어왔을 때 부모도 통보문상 발효 중이어야 함 (원칙 5):

```
function validateParentChildConsistency(childRow, parentTongbomun):
  if parentTongbomun.current == null:
    return {
      valid: false,
      reason: "PARENT_INACTIVE",
      detail: "부모 미발효인데 자식 발효 행 등장"
    }
  return { valid: true }
```

### 5.2 종류 일관성 검증

자식의 `wrnTp`가 부모의 `wrnTp`와 같아야 함:

```
function validateWrnTpConsistency(childRow, parentTongbomun):
  if childRow.wrnTp != parentTongbomun.current.wrnTp:
    return {
      valid: false,
      reason: "WRN_TYPE_MISMATCH",
      detail: "자식 " + childRow.wrnTp + " vs 부모 " + parentTongbomun.current.wrnTp
    }
  return { valid: true }
```

### 5.3 실패 시 동작

- 데이터 이상이지만 시스템은 계속 동작
- 자식 행 무시 또는 캡 처리
- 오류 로그 기록 (`PARENT_CHILD_MISMATCH`)

---

## 6. 캡 적용 검증

### 6.1 레벨 캡 검증

```
function validateLevelCap(childRow, parentTongbomun):
  childLvl = parseInt(childRow.wrnLvl)
  parentLvl = getParentLvlInt(parentTongbomun)

  if childLvl > parentLvl:
    return {
      capApplied: true,
      capType: "LEVEL",
      from: childLvl,
      to: parentLvl,
      narrative: childRow.regKo + " 자식 레벨이 부모 레벨보다 높음 — 부모 레벨로 캡 적용"
    }
  return { capApplied: false }
```

### 6.2 시각 캡 검증

```
function validateTimeCap(childRow, parentTongbomun):
  if childRow.tmEd == "" or parentTongbomun.tmCc == null:
    return { capApplied: false, reason: "MISSING_TIME" }

  childEnd = parseAfsoTime(childRow.tmEd)
  parentEnd = parseTongbomunTime(parentTongbomun.tmCc)

  if childEnd == null or parentEnd == null:
    return { capApplied: false, reason: "PARSE_ERROR" }

  if childEnd > parentEnd:
    return {
      capApplied: true,
      capType: "TIME",
      from: childRow.tmEd,
      to: parentTongbomun.tmCc,
      narrative: childRow.regKo + " 자식 시각이 부모 시각보다 늦음 — 부모 시각으로 캡 적용"
    }
  return { capApplied: false }
```

### 6.3 캡 적용 자체는 정상 처리

캡 적용은 오류가 아닌 안전 조치입니다. 다만 캡이 발생했음을 로그에 남깁니다.

---

## 7. 영속화 검증

### 7.1 자식 상태 객체 무결성

영속화 직전 자식 상태 객체의 무결성 검증:

```
function validateSubregionState(state):
  errors = []

  for regId, child in state.subregions:
    if child.regId != regId:
      errors.push("regId mismatch: key=" + regId + " obj=" + child.regId)

    if child.parentRegId == "":
      errors.push("empty parentRegId for " + regId)

    if child.confidence != null and not isValidConfidence(child.confidence):
      errors.push("invalid confidence for " + regId + ": " + child.confidence)

    if child.status != null and not isValidStatus(child.status):
      errors.push("invalid status for " + regId + ": " + child.status)

  return errors
```

### 7.2 실패 시 동작

영속화 검증 실패는 큰 문제입니다.

- 그 사이클 영속화 보류
- 직전 정상 파일 그대로 유지
- 관리자 푸시 알림
- 운영자가 데이터 점검 필요

---

## 8. 매핑 테이블 무결성 검증 (시작 시)

### 8.1 시작 시 검증

서버 시작 시 또는 매핑 테이블 reload 시:

```
function validateAliasMap(map):
  errors = []

  # parents 섹션
  for regId, entry in map.parents:
    if not /^S\d{7}$/.test(regId):
      errors.push("invalid parent regId: " + regId)
    if entry.appRegKo == "":
      errors.push("empty appRegKo for parent " + regId)

  # subregions 섹션
  for regId, entry in map.subregions:
    if not /^S\d{7}$/.test(regId):
      errors.push("invalid child regId: " + regId)
    if entry.appRegKo == "":
      errors.push("empty appRegKo for child " + regId)
    if not map.parents[entry.parentRegId]:
      errors.push("parent not found for child " + regId + ": " + entry.parentRegId)

  return errors
```

### 8.2 실패 시 동작

매핑 테이블 무결성 위반은 시스템 운영에 큰 영향:

- 매핑 테이블 사용 불가
- 모든 자식해역이 매핑 누락으로 처리
- 사용자에게 자식해역 표시 0
- 관리자 푸시로 즉시 알림

---

## 9. 검증 함수의 일관된 반환 형식

### 9.1 권장 형식

모든 검증 함수는 일관된 반환 형식 사용 권장:

```typescript
type ValidationResult = {
  valid: boolean
  reason?: string  // 실패 사유 코드
  detail?: any     // 추가 정보
  narrative?: string  // 사용자/운영자용 평문 메시지
}
```

### 9.2 예시

```javascript
// 성공
{ valid: true }

// 실패
{
  valid: false,
  reason: "MAPPING_MISSING",
  detail: { afsoRegId: "S2999900" },
  narrative: "방재기상 코드 S2999900에 대한 매핑이 없습니다."
}
```

### 9.3 활용

코드 곳곳에서 검증 결과를 받아 일관된 패턴으로 처리:

```
result = validateXxx(...)
if not result.valid:
  recordError(result.reason, result.detail, result.narrative)
  return  // 또는 다른 처리
```

---

## 10. 본 파일 다음 작업

- 다음 파일: `08_persistence_backup.md`
- 주제: 데이터 영속화 / 백업 정책
