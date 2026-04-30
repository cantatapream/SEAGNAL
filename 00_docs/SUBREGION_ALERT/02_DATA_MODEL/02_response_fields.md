# 자식해역 특보 표출 — 2.2 응답 필드 의미

## 0. 본 파일의 위치

본 파일은 `02_DATA_MODEL/` 시리즈의 두 번째 파일이며, 방재기상 API 응답의 각 필드 의미를 상세히 정리합니다.

---

## 1. metData 행의 모든 필드

각 행은 해역 1개 + 그 해역의 한 특보 정보를 담고 있습니다. 본 작업에서 사용하는 필드와 미사용 필드를 명확히 구분합니다.

### 1.1 본 작업에서 사용하는 핵심 필드

| 필드 | 타입 | 의미 | 본 작업 활용 |
|---|---|---|---|
| `regId` | string | 해역 코드 | 자식해역 식별자 |
| `regKo` | string | 해역 이름 | 매핑 테이블 키 |
| `regUp` | string | 부모 해역 코드 | 부모 결합 |
| `regUpKo` | string | 부모 해역 이름 | 매핑 테이블 키 (부모) |
| `wrnSeq` | string | 특보 시퀀스 | "99" = 빈 행 식별 |
| `wrnTp` | string | 특보 종류 | 풍랑/태풍/폭풍해일 등 |
| `wrnLvl` | string | 특보 레벨 (숫자) | 1=예비, 2=주의보, 3=경보 |
| `wrnLvlName` | string | 특보 레벨 이름 | 한글 표시 (참고용) |
| `tmFc` | string | 발표 시각 | 자식 발표 시각 (참고) |
| `tmEf` | string | 발효 시각 | 자식 발효 시각 |
| `tmEd` | string | 해제 예정 시각 | 자식 종료 시각 (캡 대상) |

### 1.2 본 작업에서 사용하지 않는 필드

| 필드 | 의미 | 미사용 사유 |
|---|---|---|
| `tmEfOrg` | 원본 발효 시각 | 갱신 이력용. 본 작업 미필요 |
| `t07` | 알 수 없음 (코드 분기에 사용됨) | seaWarningStatus.js에서 해제예고 표시 분기에만 사용 |
| `t08` | 알 수 없음 | 본 작업 미사용 |
| `wrnCmd` | 특보 명령 | 본 작업 미사용 |
| `stnId` | 관서 ID | 응답마다 같은 값 |
| `wrnGrd` | 특보 등급 (별도) | 본 작업 미사용 |
| `typ` | 알 수 없음 | 본 작업 미사용 |
| `cnt` | 알 수 없음 | 본 작업 미사용 |
| `rpt` | 알 수 없음 | 본 작업 미사용 |

---

## 2. regId 필드 상세

### 2.1 형식

```
S{prefix}{level}{detail}

예시:
  S1131000 - 동해남부앞바다 (큰 부모)
  S1131100 - 울산앞바다 (부모)
  S2110200 - 울산앞바다중 평수구역 (자식)
  S2120400 - 울산앞바다중 연안바다 (자식)
```

### 2.2 첫 두 글자 분류

| 접두 | 의미 |
|---|---|
| `S1` | 일반 해역 (부모해역 등) |
| `S2` | 평수구역, 연안바다 (자식해역) |

### 2.3 본 작업에서의 활용

- `regId`로 자식해역을 고유 식별
- 매핑 테이블의 키로 사용
- 부모-자식 결합은 `regId` + `regUp` 조합으로

---

## 3. regKo 필드 상세

### 3.1 형식

해역의 한글 이름. 공백 포함 가능.

```
"가파도연안바다"
"울산앞바다중 평수구역"
"서해남부남쪽안쪽먼바다중조도부근평수구"
```

### 3.2 우리 앱 이름과의 차이

방재기상의 `regKo`는 우리 앱의 자식해역 이름과 미세하게 다를 수 있습니다.

- 방재기상: "서해남부남쪽안쪽먼바다중조도부근평수구"
- 우리 앱: "서해남부남쪽안쪽먼바다중조도부근평수구역"

차이: 끝의 "역" 한 글자 누락

이런 차이는 매핑 테이블에서 보정합니다. 자세한 내용: `04_alias_map_schema.md`

### 3.3 함수 형태

```
function lookupAppName(regId):
  alias = regionAliasMap[regId]
  if alias != null:
    return alias
  return null  # 매핑 누락 — 로그 후 무시
```

---

## 4. regUp / regUpKo 필드 상세

### 4.1 정의

`regUp`는 해당 행의 부모 해역의 `regId`이며, `regUpKo`는 부모 해역의 한글 이름입니다.

### 4.2 자기 자신이 부모인 경우

부모해역 자신이 응답에 들어오는 경우 `regId == regUp`이 됩니다.

```json
{
  "regId": "S1131100",
  "regKo": "울산앞바다",
  "regUp": "S1131000",       ← 더 큰 부모 (광역)
  "regUpKo": "동해남부앞바다"
}
```

본 작업에서 부모해역 행은 자식 판정에 직접 사용하지 않으나, 분류에는 활용됩니다.

### 4.3 자식해역의 부모 식별

```
function getParentRegId(childRow):
  return childRow.regUp

function isParentRow(row):
  return row.regId == row.regUp
```

---

## 5. wrnSeq 필드 상세

### 5.1 의미

특보 시퀀스 번호. 한 해역에 대해 여러 특보 행이 있을 때 구분용.

### 5.2 본 작업에서의 핵심 — "99" 값

`wrnSeq == "99"` 행은 **빈 행 (특보 없음 신호)** 임을 나타냅니다.

- 특보 없음을 명시적으로 알려주는 시퀀스 값
- 다른 필드(`wrnTp`, `wrnLvl`, `tmFc`, `tmEf`, `tmEd`)가 모두 빈 문자열
- 본 작업에서 즉시 해제 신호로 활용

### 5.3 일반 발효 행

발효 행의 `wrnSeq`는 `"1"` 또는 다른 값.

### 5.4 함수 형태

```
function isEmptyRow(row):
  return row.wrnSeq == "99"

function isActiveRow(row):
  return row.wrnSeq != "99" and row.wrnTp != ""
```

---

## 6. wrnTp 필드 상세

### 6.1 가능 값

| 값 | 의미 |
|---|---|
| `"풍랑"` | 풍랑 특보 |
| `"태풍"` | 태풍 특보 |
| `"폭풍해일"` | 폭풍해일 특보 |
| `""` | 빈 행 (wrnSeq=99) |

### 6.2 본 작업에서의 활용

- 자식해역의 특보 종류로 사용
- 동일 해역에 여러 종류 동시 발효 없음 (사용자 결정 사항)

---

## 7. wrnLvl / wrnLvlName 필드 상세

### 7.1 wrnLvl (숫자)

| 값 | 의미 |
|---|---|
| `"1"` | 예비특보 |
| `"2"` | 주의보 |
| `"3"` | 경보 |

### 7.2 wrnLvlName (한글)

| 값 | 의미 |
|---|---|
| `"예비"` | 예비특보 |
| `"주의보"` | 주의보 |
| `"경보"` | 경보 |

### 7.3 본 작업에서의 활용

- 캡 규칙의 비교 기준 (정수 비교 권장)
- 사용자 표시 시 한글 이름 사용

---

## 8. 시각 필드 (tmFc, tmEf, tmEd) 상세

### 8.1 형식

```
"YYYYMMDDHHMI"  (12자리)

예: "202604301400" → 2026년 04월 30일 14시 00분
```

### 8.2 의미

| 필드 | 의미 |
|---|---|
| `tmFc` | 발표 시각 |
| `tmEf` | 발효 시각 |
| `tmEd` | 해제 예정 시각 |

### 8.3 빈 값

빈 행에서는 모두 빈 문자열(`""`).

### 8.4 파싱 함수

```
function parseAfsoTime(timeStr):
  if timeStr == "" or timeStr == null:
    return null

  # YYYYMMDDHHMI 형식 파싱
  if not /^\d{12}$/.test(timeStr):
    return null

  year = timeStr.substring(0, 4)
  month = timeStr.substring(4, 6)
  day = timeStr.substring(6, 8)
  hour = timeStr.substring(8, 10)
  minute = timeStr.substring(10, 12)

  return new Date(year, month-1, day, hour, minute)
```

### 8.5 통보문 시각과의 형식 차이

- 통보문 시각: `"2026년 04월 30일 14시 00분"` (한글 형식)
- 방재기상 시각: `"202604301400"` (숫자 12자리)

본 작업에서 시각 비교를 위해 두 형식을 표준형(예: ISO 8601 또는 Date 객체)으로 변환하여 처리합니다.

---

## 9. 응답 안정성 검증 필드

### 9.1 검증해야 할 필드

본 작업의 Step 3.1(응답 건전성 검사)에서 다음 필드를 확인합니다.

- `meta.err` 값이 `"true"` → 오류
- `data.metData` 가 `null` 또는 `[]` → 오류
- `data.metData[i].regId`가 비어 있거나 잘못된 형식 → 그 행 제외

### 9.2 검증 함수

```
function validateAfsoResponse(response):
  if response.meta == null: return ERROR
  if response.meta.err == "true": return ERROR
  if response.data == null: return ERROR
  if response.data.metData == null: return ERROR
  if response.data.metData.length == 0: return ERROR
  return OK
```

자세한 검증 로직: `07_data_validation.md`

---

## 10. 본 파일 다음 작업

- 다음 파일: `03_subregion_lifecycle_schema.md`
- 주제: 자식해역 상태 영속화 파일(subregion_lifecycle.json) 스키마
