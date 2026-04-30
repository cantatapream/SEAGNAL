# 자식해역 특보 표출 — 2.3 subregion_lifecycle.json 스키마

## 0. 본 파일의 위치

본 파일은 `02_DATA_MODEL/` 시리즈의 세 번째 파일이며, **자식해역 활성 상태**를 영속 저장하는 신규 데이터 파일의 스키마를 정의합니다.

---

## 1. 파일 개요

### 1.1 파일 위치

```
local_server/data/subregion_lifecycle.json
```

### 1.2 파일 목적

- 자식해역의 현재 상태 영속화
- 매 사이클 자식해역 처리의 직전 상태 비교 기준
- 서버 재시작 후 직전 상태 복원

### 1.3 다른 파일과의 관계

| 파일 | 담당 |
|---|---|
| `weather_alerts.json` | 부모해역 트리 + history (기존, 변경 없음) |
| `active_lifecycle.json` | 부모해역 활성 상태 (기존, 변경 없음) |
| **`subregion_lifecycle.json`** | **자식해역 활성 상태 (신규)** |
| `region_alias_map.json` | 해역 이름 매핑 테이블 (신규) |
| `subregion_error_log.json` | 자식해역 관련 오류 로그 (신규) |

---

## 2. 최상위 구조

### 2.1 파일 형식

```json
{
  "schema_version": "1.0",
  "lastUpdated": "2026-04-30T22:05:00+09:00",
  "subregions": {
    "S2122000": { ... 자식해역 객체 ... },
    "S2110200": { ... },
    ...
  },
  "stats": {
    "totalActive": 12,
    "totalEstimated": 3,
    "lastSuccessfulPoll": "2026-04-30T22:05:00+09:00"
  }
}
```

### 2.2 최상위 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `schema_version` | string | 스키마 버전 |
| `lastUpdated` | string (ISO 8601) | 파일 마지막 갱신 시각 |
| `subregions` | object (regId → 자식 객체) | 자식해역별 상태 |
| `stats` | object | 통계 정보 (선택) |

---

## 3. 자식해역 객체 스키마

### 3.1 전체 필드

```json
{
  "regId": "S2122000",
  "regKoApp": "가파도연안바다",
  "regKoAfso": "가파도연안바다",
  "parentRegId": "S1232000",
  "parentRegKo": "제주도서부앞바다",

  "current": {
    "wrnTp": "풍랑",
    "wrnLvl": 2,
    "wrnLvlName": "주의보",
    "tmFc": "2026-04-30T14:00:00+09:00",
    "tmEf": "2026-04-30T14:00:00+09:00",
    "tmEd": "2026-05-01T06:00:00+09:00"
  },

  "rawFromAfso": {
    "wrnLvl": 3,
    "tmEd": "2026-05-01T12:00:00+09:00"
  },

  "status": "pending_release",
  "confidence": "STRONGLY_ESTIMATED",
  "estimationReason": "CONCURRENT_DISAPPEAR_LOCK",

  "missedCount": 0,
  "lastSeenAt": "2026-04-30T21:55:00+09:00",
  "firstActivatedAt": "2026-04-30T14:00:00+09:00",
  "lastReleasedAt": null,

  "eventLabel": "발효됨",
  "tmEdNote": null,

  "history": [
    {
      "event": "신규 발효",
      "wrnTp": "풍랑",
      "wrnLvl": 2,
      "at": "2026-04-30T14:00:00+09:00"
    }
  ]
}
```

### 3.2 식별 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `regId` | string | 방재기상 해역 코드 (키와 동일) |
| `regKoApp` | string | 우리 앱에서 사용하는 한글 이름 |
| `regKoAfso` | string | 방재기상에서 사용하는 한글 이름 (참고용) |
| `parentRegId` | string | 부모 해역 regId (방재기상 코드) |
| `parentRegKo` | string | 부모 해역 한글 이름 (우리 앱 기준) |

### 3.3 현재 상태 필드 (`current`)

| 필드 | 타입 | 의미 |
|---|---|---|
| `current` | object 또는 null | 현재 발효 상태. null이면 미발효 |
| `current.wrnTp` | string | 특보 종류 |
| `current.wrnLvl` | int | 특보 레벨 (캡 적용 후 값) |
| `current.wrnLvlName` | string | 특보 레벨 한글명 |
| `current.tmFc` | string (ISO 8601) | 발표 시각 |
| `current.tmEf` | string (ISO 8601) | 발효 시각 |
| `current.tmEd` | string (ISO 8601) 또는 null | 종료 예정 시각 (캡 적용 후 값). 범위형 시 null |

### 3.4 원본 데이터 필드 (`rawFromAfso`)

캡 적용 전의 방재기상 원본 값. 디버깅 및 추정 표시 결정에 사용.

| 필드 | 타입 | 의미 |
|---|---|---|
| `rawFromAfso.wrnLvl` | int | 방재기상 원본 레벨 |
| `rawFromAfso.tmEd` | string 또는 null | 방재기상 원본 종료 시각 |

### 3.5 상태 / 신뢰도 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `status` | string | "active" / "pending_release" |
| `confidence` | string | "CONFIRMED" / "WEAKLY_ESTIMATED" / "STRONGLY_ESTIMATED" |
| `estimationReason` | string 또는 null | 추정 이유 코드 |

`estimationReason` 가능 값은 `01_LOGIC/15_estimation_display.md` 참조.

### 3.6 추적 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `missedCount` | int | 연속 빠짐 횟수 (0~2) |
| `lastSeenAt` | string (ISO 8601) | 방재기상에 마지막으로 정상 등장한 시각 |
| `firstActivatedAt` | string (ISO 8601) | 처음 발효 시작된 시각 |
| `lastReleasedAt` | string (ISO 8601) 또는 null | 마지막 해제 시각 |

### 3.7 이벤트 라벨 필드

| 필드 | 타입 | 의미 |
|---|---|---|
| `eventLabel` | string | 사용자 표시용 라벨 ("발효됨" / "격상됨" / "격하됨" / "예비특보 발표") |
| `tmEdNote` | string 또는 null | 종료 시각에 대한 메모 (예: "범위형 시각 — 통보문 갱신 대기") |

### 3.8 history 필드

각 자식해역의 변화 이력을 저장하여 디버깅 및 운영 분석에 사용.

| 필드 | 타입 | 의미 |
|---|---|---|
| `history[i].event` | string | "신규 발효" / "격상됨" / "격하됨" / "해제됨" 등 |
| `history[i].wrnTp` | string | 그 시점의 특보 종류 |
| `history[i].wrnLvl` | int | 그 시점의 레벨 |
| `history[i].at` | string (ISO 8601) | 변화 시각 |

history 보관 기간: 최근 N개 (예: 50개)로 제한 권장.

---

## 4. status 필드 상세

### 4.1 가능 값

| 값 | 의미 |
|---|---|
| `"active"` | 정상 발효 중 |
| `"pending_release"` | 동시 사라짐 잠금 또는 범위형 시각 잠금 상태 |

### 4.2 상태 전이

```
없음 → active (신규 발효 시)
active → pending_release (부모-자식 동시 사라짐 시)
pending_release → active (부모 통보문 갱신 + 응답 재등장 시)
active → 없음 (해제 시: current = null로 변경)
pending_release → 없음 (부모 자동 해제 시점 도달)
```

---

## 5. 예시 — 다양한 상태의 자식해역

### 5.1 정상 발효 자식

```json
{
  "regId": "S2122000",
  "regKoApp": "가파도연안바다",
  "parentRegId": "S1232000",
  "current": {
    "wrnTp": "풍랑",
    "wrnLvl": 2,
    "wrnLvlName": "주의보",
    "tmFc": "2026-04-30T14:00:00+09:00",
    "tmEf": "2026-04-30T14:00:00+09:00",
    "tmEd": "2026-05-01T06:00:00+09:00"
  },
  "rawFromAfso": { "wrnLvl": 2, "tmEd": "2026-05-01T06:00:00+09:00" },
  "status": "active",
  "confidence": "CONFIRMED",
  "estimationReason": null,
  "missedCount": 0,
  "lastSeenAt": "2026-04-30T22:05:00+09:00",
  "eventLabel": "발효됨"
}
```

### 5.2 동시 사라짐 잠금 자식

```json
{
  "regId": "S2122000",
  "regKoApp": "가파도연안바다",
  "parentRegId": "S1232000",
  "current": {
    "wrnTp": "풍랑",
    "wrnLvl": 2,
    "wrnLvlName": "주의보",
    "tmEd": "2026-05-01T06:00:00+09:00"
  },
  "rawFromAfso": null,
  "status": "pending_release",
  "confidence": "STRONGLY_ESTIMATED",
  "estimationReason": "CONCURRENT_DISAPPEAR_LOCK",
  "missedCount": 1,
  "lastSeenAt": "2026-04-30T21:55:00+09:00",
  "eventLabel": "발효됨"
}
```

### 5.3 1회 빠짐 자식

```json
{
  "regId": "S2122000",
  "current": {
    "wrnTp": "풍랑",
    "wrnLvl": 2
  },
  "status": "active",
  "confidence": "WEAKLY_ESTIMATED",
  "estimationReason": "MISSED_ONCE",
  "missedCount": 1,
  "lastSeenAt": "2026-04-30T22:04:00+09:00"
}
```

### 5.4 캡 적용 자식

```json
{
  "regId": "S2122000",
  "current": {
    "wrnTp": "풍랑",
    "wrnLvl": 2,
    "wrnLvlName": "주의보"
  },
  "rawFromAfso": { "wrnLvl": 3, "tmEd": "..." },
  "status": "active",
  "confidence": "WEAKLY_ESTIMATED",
  "estimationReason": "LEVEL_CAPPED",
  "missedCount": 0
}
```

### 5.5 미발효 (해제됨) 자식

해제된 자식은 객체에서 삭제하거나 `current = null`로 둘 수 있습니다.

```json
{
  "regId": "S2122000",
  "regKoApp": "가파도연안바다",
  "parentRegId": "S1232000",
  "current": null,
  "lastReleasedAt": "2026-04-30T22:05:00+09:00"
}
```

해제 후에도 자식 항목을 유지할지 삭제할지 정책: **해제 후 한동안 유지하다가 N일 후 정리** 권장.

---

## 6. 파일 갱신 패턴

### 6.1 갱신 시점

매 1분 사이클의 Step 3.9(영속화)에서 갱신.

### 6.2 갱신 함수

```
function saveSubregionLifecycle(state):
  state.lastUpdated = nowISO()
  state.stats = computeStats(state.subregions)

  tmpFile = "subregion_lifecycle.json.tmp"
  writeFile(tmpFile, JSON.stringify(state, null, 2))
  rename(tmpFile, "subregion_lifecycle.json")  # 원자적 교체
```

### 6.3 원자적 쓰기

쓰기 도중 서버가 죽어도 이전 상태가 보존되도록 임시 파일 + rename 패턴 사용.

---

## 7. 파일 크기 추정

### 7.1 한 자식해역당 평균 크기

- 약 500바이트 ~ 1KB

### 7.2 전체 자식해역 수

- 우리 앱 매핑 대상 자식해역: 약 50~100개

### 7.3 예상 파일 크기

- 정상 운영 시: 약 25~100KB
- history 누적 시: 약 100~500KB

---

## 8. 본 파일 다음 작업

- 다음 파일: `04_alias_map_schema.md`
- 주제: region_alias_map.json 스키마 (해역 이름 매핑 테이블)
