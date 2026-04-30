# 자식해역 특보 표출 — 2.4 region_alias_map.json 스키마

## 0. 본 파일의 위치

본 파일은 `02_DATA_MODEL/` 시리즈의 네 번째 파일이며, 방재기상시스템과 우리 앱의 해역 이름 매핑 테이블 스키마를 정의합니다.

---

## 1. 파일 개요

### 1.1 파일 위치

```
local_server/data/region_alias_map.json
```

### 1.2 파일 목적

- 방재기상시스템의 해역 식별자(regId, regKo) ↔ 우리 앱의 해역 식별자/이름 매핑
- 해역 이름의 미세한 표기 차이 보정 (예: "평수구" ↔ "평수구역")
- 부모-자식 트리의 통보문 시스템 ↔ 방재기상 시스템 결합

---

## 2. 최상위 구조

### 2.1 파일 형식

```json
{
  "schema_version": "1.0",
  "lastUpdated": "2026-04-30T10:00:00+09:00",

  "parents": {
    "S1232000": {
      "afsoRegKo": "제주도서부앞바다",
      "appRegKo": "제주도서부앞바다",
      "tongbomunRegId": "JEJU_WEST"
    },
    ...
  },

  "subregions": {
    "S2122000": {
      "afsoRegKo": "가파도연안바다",
      "appRegKo": "가파도연안바다",
      "parentRegId": "S1232000",
      "groupKey": "jeju_gapado"
    },
    "S2999900": {
      "afsoRegKo": "서해남부남쪽안쪽먼바다중조도부근평수구",
      "appRegKo": "서해남부남쪽안쪽먼바다중조도부근평수구역",
      "parentRegId": "S1XXXXXX",
      "groupKey": "seasouth_jodo"
    },
    ...
  },

  "unmapped": [
    {
      "afsoRegId": "S2NEW0000",
      "afsoRegKo": "새 해역명",
      "firstSeenAt": "2026-04-30T22:05:00+09:00",
      "occurrenceCount": 5
    }
  ]
}
```

### 2.2 최상위 필드

| 필드 | 의미 |
|---|---|
| `schema_version` | 스키마 버전 |
| `lastUpdated` | 매핑 테이블 마지막 갱신 시각 |
| `parents` | 부모해역 매핑 |
| `subregions` | 자식해역 매핑 |
| `unmapped` | 매핑 누락 발견 이력 (자동 누적) |

---

## 3. parents 섹션

### 3.1 키와 값

- 키: 방재기상의 부모 `regId`
- 값: 매핑 정보 객체

### 3.2 매핑 객체 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `afsoRegKo` | string | 방재기상의 한글 이름 (참고용) |
| `appRegKo` | string | 우리 앱에서 사용하는 한글 이름 |
| `tongbomunRegId` | string | 통보문 시스템의 부모 식별자 (있을 경우) |

### 3.3 활용

```
function getTongbomunIdFromAfso(afsoParentRegId):
  return parents[afsoParentRegId].tongbomunRegId

function getAppNameForParent(afsoParentRegId):
  return parents[afsoParentRegId].appRegKo
```

---

## 4. subregions 섹션

### 4.1 키와 값

- 키: 방재기상의 자식 `regId`
- 값: 매핑 정보 객체

### 4.2 매핑 객체 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `afsoRegKo` | string | 방재기상의 한글 이름 |
| `appRegKo` | string | 우리 앱에서 사용하는 한글 이름 |
| `parentRegId` | string | 부모해역의 방재기상 regId |
| `groupKey` | string | 우리 앱의 자식해역 그룹 식별자 (선택) |

### 4.3 활용

```
function lookupAppName(afsoRegId):
  entry = subregions[afsoRegId]
  return entry == null ? null : entry.appRegKo

function getParentRegId(afsoRegId):
  entry = subregions[afsoRegId]
  return entry == null ? null : entry.parentRegId
```

---

## 5. unmapped 섹션 (매핑 누락 이력)

### 5.1 자동 갱신

매핑 테이블에 없는 해역이 방재기상 응답에 등장하면 코드가 이 섹션에 자동으로 추가합니다.

### 5.2 객체 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `afsoRegId` | string | 방재기상 regId |
| `afsoRegKo` | string | 방재기상 한글 이름 |
| `firstSeenAt` | string | 처음 발견된 시각 |
| `occurrenceCount` | int | 발견 횟수 (사이클 카운트) |

### 5.3 운영자의 작업

운영자는 주기적으로 `unmapped` 섹션을 확인하여:

- 새 해역 등장 → `subregions`에 매핑 추가
- 추가 후 `unmapped`에서 해당 항목 제거

### 5.4 함수 형태

```
function recordUnmapped(afsoRow):
  existing = unmapped.find(u => u.afsoRegId == afsoRow.regId)
  if existing != null:
    existing.occurrenceCount += 1
  else:
    unmapped.push({
      afsoRegId: afsoRow.regId,
      afsoRegKo: afsoRow.regKo,
      firstSeenAt: nowISO(),
      occurrenceCount: 1
    })
    log("[매핑 누락] " + 서술형메시지(afsoRow))
```

---

## 6. 매핑 테이블 초기화 — 전수조사

### 6.1 본 작업 시작 전 1회성 작업

본 작업 시작 전에 방재기상 API를 1회 호출하여 모든 해역을 추출하고, 우리 앱의 해역 마스터와 대조하여 매핑 테이블을 초기화합니다.

자세한 절차: `09_full_audit_procedure.md`

### 6.2 초기화 결과

전수조사 결과 발견된 모든 매핑이 `parents`와 `subregions` 섹션에 채워집니다.

---

## 7. 매핑 테이블의 갱신 정책

### 7.1 코드 자동 갱신

코드가 자동으로 갱신하는 부분: `unmapped` 섹션만.

- 매핑 누락 발견 시 자동 추가
- 재발생 시 카운트 증가

### 7.2 운영자 수동 갱신

운영자가 수동으로 갱신하는 부분: `parents`와 `subregions` 섹션.

- 새 해역 매핑 추가
- 이름 변경 반영
- `unmapped`에서 해결된 항목 제거

### 7.3 운영자 알림

매핑 누락이 새로 발생할 때마다 관리자 푸시 알림 + 통합관리자 센터의 자식해역 오류 영역에 표시. 자세한 내용: `03_OPERATIONS/03_admin_push_integration.md`, `03_OPERATIONS/04_admin_ui.md`

---

## 8. 매핑 데이터의 무결성

### 8.1 검증 규칙

매핑 테이블 로드 시 다음을 검증합니다.

- 모든 자식의 `parentRegId`가 `parents` 섹션에 존재해야 함
- `appRegKo`는 비어있지 않아야 함
- `regId`는 `S` 접두사 + 7자리 숫자 형식

### 8.2 검증 함수

```
function validateAliasMap(map):
  errors = []

  for afsoRegId, child in map.subregions:
    if not /^S\d{7}$/.test(afsoRegId):
      errors.push("Invalid regId format: " + afsoRegId)
    if child.appRegKo == "":
      errors.push("Empty appRegKo for: " + afsoRegId)
    if not map.parents[child.parentRegId]:
      errors.push("Parent not found: " + child.parentRegId + " (for child " + afsoRegId + ")")

  return errors
```

### 8.3 무결성 위반 시 처리

- 시작 시 무결성 검증 실패 → 시스템 로그에 경고, 매핑 테이블 사용 불가 알림
- 운영자가 수정 후 재시작

---

## 9. 매핑 테이블 예시 (전체)

```json
{
  "schema_version": "1.0",
  "lastUpdated": "2026-04-30T10:00:00+09:00",
  "parents": {
    "S1232000": {
      "afsoRegKo": "제주도서부앞바다",
      "appRegKo": "제주도서부앞바다",
      "tongbomunRegId": "JEJU_WEST"
    },
    "S1131100": {
      "afsoRegKo": "울산앞바다",
      "appRegKo": "울산앞바다",
      "tongbomunRegId": "ULSAN_FRONT"
    }
  },
  "subregions": {
    "S2122000": {
      "afsoRegKo": "가파도연안바다",
      "appRegKo": "가파도연안바다",
      "parentRegId": "S1232000"
    },
    "S2110200": {
      "afsoRegKo": "울산앞바다중 평수구역",
      "appRegKo": "울산앞바다중 평수구역",
      "parentRegId": "S1131100"
    },
    "S2999900": {
      "afsoRegKo": "서해남부남쪽안쪽먼바다중조도부근평수구",
      "appRegKo": "서해남부남쪽안쪽먼바다중조도부근평수구역",
      "parentRegId": "S1XXXXXX"
    }
  },
  "unmapped": []
}
```

---

## 10. 본 파일 다음 작업

- 다음 파일: `05_error_log_schema.md`
- 주제: subregion_error_log.json 스키마 (자식해역 관련 오류 로그)
