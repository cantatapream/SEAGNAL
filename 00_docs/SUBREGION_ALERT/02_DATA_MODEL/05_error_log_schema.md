# 자식해역 특보 표출 — 2.5 subregion_error_log.json 스키마

## 0. 본 파일의 위치

본 파일은 `02_DATA_MODEL/` 시리즈의 다섯 번째 파일이며, 자식해역 관련 오류를 영구 보존하는 로그 파일의 스키마를 정의합니다.

---

## 1. 파일 개요

### 1.1 파일 위치

```
local_server/data/subregion_error_log.json
```

### 1.2 파일 목적

- 자식해역 처리 과정에서 발생한 모든 오류를 영구 기록
- 통합관리자 센터의 자식해역 오류 영역에 표시할 데이터 제공
- 운영자가 확인/삭제 완료해도 내역 자체는 보존 (사용자 요구사항)

### 1.3 다른 오류 로그와의 차이

| 파일 | 보존 정책 |
|---|---|
| `collect_failures.json` | 물리 삭제 가능 (DELETE API 존재) |
| `review_needed.json` | 소프트 ack (acknowledged 플래그 토글, 파일 보존) |
| **`subregion_error_log.json`** | **소프트 ack 전용. 물리 삭제 없음** |

---

## 2. 최상위 구조

### 2.1 파일 형식

```json
{
  "schema_version": "1.0",
  "lastUpdated": "2026-04-30T22:05:00+09:00",
  "errors": [
    {
      "id": "err_2026043022050001",
      "errorType": "MAPPING_MISSING",
      "occurredAt": "2026-04-30T22:05:00+09:00",
      "acknowledged": false,
      "acknowledgedAt": null,
      "acknowledgedBy": null,

      "developerInfo": {
        "function": "lookupAppName",
        "file": "local_server/services/subregion_judge.js",
        "line": 142,
        "afsoRegId": "S2999999",
        "afsoRegKo": "○○○평수구"
      },

      "narrativeDescription": "2026년 04월 30일 22시 05분, 방재기상시스템에서 받은 자식해역 'S2999999 (○○○평수구)' 에 대해 우리 앱의 매핑 테이블에 등록된 이름이 없습니다. 매핑 테이블에 추가가 필요합니다.",

      "actionRequired": "region_alias_map.json 파일에 이 해역을 우리 앱에서 부르는 이름으로 추가해주세요.",

      "occurrenceCount": 3,
      "lastOccurredAt": "2026-04-30T22:05:00+09:00"
    }
  ],

  "stats": {
    "totalErrors": 12,
    "unacknowledged": 5,
    "byType": {
      "MAPPING_MISSING": 3,
      "LEVEL_CAP_APPLIED": 2,
      "TIME_CAP_APPLIED": 1,
      "AFSO_RESPONSE_ERROR": 4,
      "PARENT_CHILD_MISMATCH": 2
    }
  }
}
```

### 2.2 최상위 필드

| 필드 | 의미 |
|---|---|
| `schema_version` | 스키마 버전 |
| `lastUpdated` | 마지막 갱신 시각 |
| `errors` | 오류 항목 배열 |
| `stats` | 집계 통계 (선택) |

---

## 3. 오류 항목 객체

### 3.1 식별 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `id` | string | 고유 식별자 (`err_<타임스탬프><순번>`) |
| `errorType` | string | 오류 유형 코드 |
| `occurredAt` | string (ISO 8601) | 처음 발생 시각 |

### 3.2 ack 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `acknowledged` | boolean | 확인/삭제 완료 플래그 |
| `acknowledgedAt` | string 또는 null | 확인 시각 |
| `acknowledgedBy` | string 또는 null | 확인한 관리자 식별자 |

### 3.3 개발자용 정보 (`developerInfo`)

코드 위치, 함수, 변수 등 디버깅에 필요한 정보.

| 필드 | 타입 | 의미 |
|---|---|---|
| `function` | string | 오류 발생 함수명 |
| `file` | string | 파일 경로 |
| `line` | int | 줄 번호 |
| (오류별 특수 필드) | varies | 오류 종류에 따라 추가 필드 |

### 3.4 평문 서술 (`narrativeDescription`)

운영자/관리자가 코드를 모르더라도 이해할 수 있는 한글 문장.

- 예: "방재기상시스템에서 받은 자식해역 ... 매핑 테이블에 등록된 이름이 없습니다."

### 3.5 조치 안내 (`actionRequired`)

운영자가 어떤 조치를 취해야 하는지 명확한 지시.

- 예: "region_alias_map.json 파일에 이 해역을 추가해주세요."

### 3.6 누적 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `occurrenceCount` | int | 같은 오류가 발생한 누적 횟수 |
| `lastOccurredAt` | string | 마지막 재발생 시각 |

---

## 4. errorType 가능 값

### 4.1 오류 유형 코드

| 코드 | 의미 | 발생 시점 |
|---|---|---|
| `MAPPING_MISSING` | 매핑 누락 | 매핑 테이블에 없는 해역이 응답에 등장 |
| `LEVEL_CAP_APPLIED` | 자식 레벨이 부모 초과 | 캡 규칙 적용 시 |
| `TIME_CAP_APPLIED` | 자식 시각이 부모 초과 | 캡 규칙 적용 시 |
| `AFSO_RESPONSE_ERROR` | 방재기상 응답 오류 | HTTP 5xx, 빈 응답 등 |
| `PARENT_CHILD_MISMATCH` | 부모-자식 데이터 불일치 | 부모 미발효인데 자식 발효 등 |
| `STALE_PARENT` | 부모 통보문 24시간 무변화 | 안전장치 트리거 |
| `RANGE_TIME_PARENT` | 부모 통보문 범위형 시각 | 통보문 갱신 대기 |
| `DUPLICATE_ROW` | 응답에 같은 regId 중복 (드묾) | 데이터 무결성 이상 |

### 4.2 오류 유형 추가 시

신규 오류 유형 추가 시:
- 코드의 enum 또는 상수에 추가
- 본 문서에 추가
- 통합관리자 센터의 표시 로직에 반영

---

## 5. 누적 처리 정책 (중복 방지)

### 5.1 같은 오류의 누적

같은 종류의 오류가 같은 대상에 대해 반복 발생하면 **새 항목으로 추가하지 않고 누적**합니다.

- `errorType` + 식별 필드 (예: `afsoRegId`)가 일치하면 같은 오류
- `occurrenceCount` 증가
- `lastOccurredAt` 갱신

### 5.2 함수 형태

```
function recordError(errorType, info, narrative, actionRequired):
  signature = errorType + "::" + info.afsoRegId  # 동일 오류 식별

  existing = errors.find(e => makeSignature(e) == signature)

  if existing != null:
    existing.occurrenceCount += 1
    existing.lastOccurredAt = nowISO()
  else:
    errors.push({
      id: generateId(),
      errorType: errorType,
      occurredAt: nowISO(),
      acknowledged: false,
      developerInfo: info,
      narrativeDescription: narrative,
      actionRequired: actionRequired,
      occurrenceCount: 1,
      lastOccurredAt: nowISO()
    })

    triggerAdminPush(narrative)  # 신규 오류 발생 시 푸시
```

### 5.3 푸시 알림 트리거

- 신규 오류 (처음 발생) → 관리자 푸시 발송
- 누적 오류 (이미 존재하는 오류 재발생) → 푸시 미발송 (스팸 방지)

---

## 6. 확인/삭제 처리 정책

### 6.1 확인 (acknowledge)

운영자가 통합관리자 센터에서 "확인 완료" 클릭 시:

```
function acknowledgeError(errorId, adminId):
  error = errors.find(e => e.id == errorId)
  if error == null: return

  error.acknowledged = true
  error.acknowledgedAt = nowISO()
  error.acknowledgedBy = adminId

  log("[오류 확인] " + errorId + " by " + adminId)
```

### 6.2 삭제는 불가

본 작업 정책상 **물리 삭제는 지원하지 않습니다**.

- DELETE API 엔드포인트는 만들지 않음
- 확인 완료 후에도 항목은 파일에 영구 보존
- 통합관리자 센터 UI에서는 확인된 항목을 숨김 처리할 수 있으나 데이터는 유지

### 6.3 모두 확인 (acknowledge-all)

```
function acknowledgeAllErrors(adminId):
  for error in errors:
    if not error.acknowledged:
      error.acknowledged = true
      error.acknowledgedAt = nowISO()
      error.acknowledgedBy = adminId
```

---

## 7. 오류 항목의 재활성화

### 7.1 확인 후 재발생

확인된(`acknowledged=true`) 오류가 다시 발생할 수 있습니다.

- 매핑 추가했는데 또 다른 매핑 누락이 발생
- 캡이 한 번 발생 후 시간 지나 또 발생

### 7.2 재활성화 정책

- 같은 signature의 오류가 재발생하면 → `acknowledged = false`로 다시 변경
- `occurrenceCount` 증가
- `lastOccurredAt` 갱신
- 푸시 발송 (재발 알림)

```
function recordError(errorType, info, ...):
  signature = ...
  existing = errors.find(...)

  if existing != null:
    if existing.acknowledged:
      # 확인된 오류 재발생 → 재활성화
      existing.acknowledged = false
      existing.acknowledgedAt = null
      existing.acknowledgedBy = null
      triggerAdminPush(...)  # 재활성화 푸시

    existing.occurrenceCount += 1
    existing.lastOccurredAt = nowISO()
```

---

## 8. 파일 크기 관리

### 8.1 무한 증가 방지

오류 항목이 무한히 누적되면 파일 크기가 커질 수 있습니다.

### 8.2 정책

- 본 작업의 사용자 정책: **삭제 안 함** (영구 보존)
- 따라서 파일 크기 관리는 별도 정책 필요
- 권장: 1년 이상 된 확인 완료 오류만 별도 archive 파일로 이관

### 8.3 미래 옵션 (필요 시)

```
function archiveOldErrors():
  threshold = now() - 365 days
  toArchive = errors.filter(e => e.acknowledged and e.acknowledgedAt < threshold)

  appendToArchive(toArchive)  # 별도 파일

  errors = errors.filter(e => not in toArchive)
```

이 archive 정책은 운영 후 데이터가 누적되면 도입 검토.

---

## 9. 백업 시스템과의 통합

본 파일은 기존 `cloudBackup` 시스템(`scheduler.js:104-131`)에 백업 대상으로 추가되어야 합니다. 자세한 내용: `08_persistence_backup.md`

---

## 10. 본 파일 다음 작업

- 다음 파일: `06_mapping_policy.md`
- 주제: 매핑 테이블 운영 정책
