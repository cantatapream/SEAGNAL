# 자식해역 특보 표출 로직 — 1.13 캡 규칙 (레벨 / 시각)

## 0. 본 파일의 위치

본 파일은 `01_LOGIC/` 시리즈의 열세 번째 파일이며, 자식해역의 레벨과 시각이 부모해역 통보문을 초과할 수 없도록 강제하는 **캡 규칙**을 정리합니다.

캡 규칙은 본 작업의 핵심 안전장치 중 하나입니다. 방재기상시스템이 격상/격하 발표를 미리 표시하는 약점을 보완합니다.

---

## 1. 캡 규칙의 정의

### 1.1 두 가지 캡

본 작업은 다음 두 가지 캡 규칙을 적용합니다.

- **레벨 캡**: 자식 레벨 ≤ 부모 통보문의 현재 발효 레벨
- **시각 캡**: 자식 종료 시각 ≤ 부모 통보문의 종료 시각

### 1.2 캡의 적용 시점

캡 규칙은 **매 사이클 자식해역 상태 갱신 시 자동 적용**됩니다.

- 방재기상 응답에서 자식 행을 받음
- 부모 통보문 상태 조회
- 두 값을 비교하여 자식이 부모를 초과하면 부모 값으로 강제 절단
- 자식 상태 객체에 절단된 값 저장

### 1.3 캡의 효과

- 방재기상이 사전 격상 표시한 자식 → 부모 통보문 레벨로 절단
- 방재기상의 자식 시각이 부모보다 길면 → 부모 시각으로 절단
- 사용자에게는 항상 부모 통보문과 일치하는 자식해역 정보가 표시됨

---

## 2. 레벨 캡 상세

### 2.1 레벨 코드 체계

레벨은 정수로 표현됩니다.

| `wrnLvl` | 의미 |
|---|---|
| `"1"` | 예비특보 |
| `"2"` | 주의보 |
| `"3"` | 경보 |

상위 단계는 더 높은 정수입니다. 즉:

- 예비 < 주의보 < 경보

### 2.2 레벨 캡 함수

```
function applyLevelCap(childRow, parentTongbomun):
  childLevel = parseInt(childRow.wrnLvl)
  parentLevel = getParentLevelInt(parentTongbomun)

  if childLevel > parentLevel:
    # 자식이 부모보다 높음 → 부모로 캡
    log("[레벨 캡 적용] " + childRow.regKo + " 자식=" + childLevel + " 부모=" + parentLevel)
    return parentLevel

  return childLevel
```

### 2.3 캡 적용 예시

#### 예시 A — 격상 사전 표시

- 통보문 부모: 풍랑 주의보 (레벨 2)
- 방재기상 자식: 풍랑 경보 (레벨 3) — 사전 격상 표시
- 캡 적용: 자식 레벨 = min(3, 2) = 2 (주의보)

#### 예시 B — 자식이 부모보다 낮음 (캡 무관)

- 통보문 부모: 풍랑 경보 (레벨 3)
- 방재기상 자식: 풍랑 주의보 (레벨 2)
- 캡 적용: 자식 레벨 = min(2, 3) = 2 (그대로 주의보)

#### 예시 C — 같은 레벨

- 통보문 부모: 풍랑 경보 (레벨 3)
- 방재기상 자식: 풍랑 경보 (레벨 3)
- 캡 적용: 자식 레벨 = min(3, 3) = 3 (그대로)

---

## 3. 시각 캡 상세

### 3.1 시각 캡 정의

자식해역의 종료 시각이 부모 통보문의 종료 시각을 넘을 수 없도록 강제합니다.

- `자식 tmEd ≤ 부모 tmCc`

### 3.2 시각 캡 함수

```
function applyTimeCap(childRow, parentTongbomun):
  childEnd = parseKmaTime(childRow.tmEd)
  parentEnd = parseKmaTime(parentTongbomun.tmCc)

  if childEnd == null or parentEnd == null:
    # 한쪽이 파싱 불가 (범위형 등) → 캡 미적용
    return childRow.tmEd  # 또는 별도 처리 (12번 문서 참조)

  if childEnd > parentEnd:
    # 자식이 부모보다 길음 → 부모로 캡
    log("[시각 캡 적용] " + childRow.regKo + " 자식=" + childRow.tmEd + " 부모=" + parentTongbomun.tmCc)
    return parentTongbomun.tmCc

  return childRow.tmEd
```

### 3.3 캡 적용 예시

#### 예시 A — 자식이 부모보다 길음

- 통보문 부모: `tmCc = 2026-05-01 06:00`
- 방재기상 자식: `tmEd = 2026-05-01 12:00` (6시간 더 길음)
- 캡 적용: 자식 종료 시각 = min(12:00, 06:00) = 06:00

#### 예시 B — 자식이 부모보다 짧음 (캡 무관)

- 통보문 부모: `tmCc = 2026-05-01 06:00`
- 방재기상 자식: `tmEd = 2026-04-30 18:00` (12시간 더 짧음)
- 캡 적용: 자식 종료 시각 = min(18:00, 06:00) = 18:00 (자식 시각 그대로)

이 케이스는 자식 자체가 부모와 다른 종료 시각을 갖는 정상 상황이며, 자식 시각 우선입니다.

#### 예시 C — 부모가 범위형 시각

- 통보문 부모: `tmCc = "9일 오전(06~12시)"` (범위형)
- 방재기상 자식: `tmEd = 2026-05-09 14:00`
- 캡 적용: 부모 시각 파싱 불가 → 캡 미적용, 자식 시각 그대로

상세한 범위형 시각 처리는 `12_case_range_time.md` 참조.

---

## 4. 캡 규칙의 비대칭성

### 4.1 자식이 부모보다 낮은 것은 정상

캡 규칙은 자식이 부모를 **초과하지 못하게** 합니다. 자식이 부모보다 **낮은 것은 자연 가능한** 상황입니다.

- 부모 경보 + 자식 일부 주의보 (가파도연안만 다른 자식보다 약한 경우)
- 부모 06:00 종료 + 자식 18:00 종료 (자식이 더 일찍 끝남)

### 4.2 캡 미적용 케이스

다음 경우 캡은 적용되지 않습니다.

- 자식 레벨이 부모와 같거나 낮음
- 자식 종료 시각이 부모와 같거나 짧음
- 부모 또는 자식의 데이터가 파싱 불가 (범위형 등)

---

## 5. 캡 적용 시 비정상 데이터 로그

### 5.1 캡 적용 자체가 비정상 신호

캡 규칙이 적용되어야 하는 상황은 본질적으로 **자식이 부모를 초과하는 비정상 데이터**가 발생한 경우입니다.

- 자식 레벨이 부모를 초과 → 방재기상이 사전 격상 표시
- 자식 시각이 부모를 초과 → 데이터 이상 또는 동기화 지연

### 5.2 로그 기록 의무

캡이 적용될 때마다 운영 로그에 기록합니다.

```
function applyLevelCapWithLog(childRow, parentTongbomun):
  childLevel = parseInt(childRow.wrnLvl)
  parentLevel = getParentLevelInt(parentTongbomun)

  if childLevel > parentLevel:
    log({
      type: "LEVEL_CAP_APPLIED",
      childRegId: childRow.regId,
      childRegKo: lookupAppName(childRow.regId),
      parentRegId: childRow.regUp,
      childLevel: childLevel,
      parentLevel: parentLevel,
      message: childRow.regKo + " 자식 레벨이 부모 레벨보다 높음 — 부모 레벨로 캡 적용"
    })
    return parentLevel

  return childLevel
```

### 5.3 로그의 운영 활용

- 캡 발생 빈도 모니터링 → 자주 발생하면 방재기상 데이터 품질 이슈
- 특정 해역에서만 자주 발생 → 매핑 테이블 점검 등 디버깅 자료
- 자세한 로그 정책: `03_OPERATIONS/05_log_format.md` 참조

---

## 6. 캡 후 자식해역 표시

### 6.1 캡 후 표시 정책

캡이 적용된 자식해역은 추정 상태 마커가 부가됩니다.

- 일반 표시 (캡 없음): 확정 상태 (○)
- 캡 적용 후 표시: 약한 추정 상태 (◐)
- 동시 사라짐 잠금 후 표시: 강한 추정 상태 (●)

자세한 추정 표시 정책은 `15_estimation_display.md` 참조.

### 6.2 사용자 영향

- 캡 적용으로 인한 정보 차이는 사용자에게 안전 측 영향만 미침
- 즉, 잘못 격상되어 표시되는 위험을 차단

---

## 7. 캡 규칙과 다른 케이스의 상호작용

### 7.1 동시 사라짐 잠금과의 상호작용

동시 사라짐 잠금 시 자식의 `tmEd`는 부모의 `tmCc`로 설정됩니다. 이는 시각 캡과 자연스럽게 일치합니다.

### 7.2 격상/격하 케이스와의 상호작용

부모 통보문이 격상되면 자식 레벨 캡도 자동으로 풀리며 자식 레벨이 갱신됩니다.

```
function refreshCapEachCycle():
  for child in subregions:
    parent = getParentTongbomun(child.parentRegId)
    afsoRow = getAfsoRow(child.regId)

    if afsoRow != null:
      child.wrnLvl = applyLevelCap(afsoRow, parent)
      child.tmEd = applyTimeCap(afsoRow, parent)
```

### 7.3 예비특보와의 상호작용

부모가 예비특보면 자식도 예비특보를 초과 못 함 (캡 자동 적용).

---

## 8. 캡 규칙의 부정 효과 — 가능성

### 8.1 데이터 손실 가능성

캡 규칙은 방재기상의 자식 데이터 일부를 무시합니다. 따라서 다음과 같은 데이터 손실이 발생할 수 있습니다.

- 자식해역의 사전 격상 정보
- 자식해역의 더 긴 발효 예정 시각

### 8.2 정책적 판단

이 손실은 의도된 결과입니다.

- 사전 격상 정보는 부모 통보문에서만 신뢰
- 발효 예정 시각은 부모 통보문이 진실
- 자식해역의 단독 미래 정보를 신뢰하지 않음

이 정책은 본 작업의 핵심 설계 원칙(원칙 1)에 부합하며, 사용자에게 일관된 정보를 제공하기 위해 필요합니다.

---

## 9. 본 파일 다음 작업

- 다음 파일: `14_rule_order.md`
- 주제: 한 사이클 안에서 모든 규칙의 적용 순서
