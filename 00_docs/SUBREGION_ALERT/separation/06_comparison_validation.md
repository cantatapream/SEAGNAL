# index1/index2 분리 분석 — 6. 비교 검증 시스템 (핵심 기능)

## 0. 본 파일의 목적

사용자 요구사항에 따라 본 작업의 핵심 기능 중 하나로 자리잡은 **비교 검증 시스템**의 상세 설계를 정리합니다.

본 시스템은 다음 두 가지 역할을 합니다.

1. **검증 도구**: 신규 방재기상 로직이 기존 텍스트 스크래핑 로직과 일관된 결과를 내는지 검증
2. **운영 모니터링**: 상이성 발견 시 운영자에게 즉시 알림 + 통합관리자 센터에 상세 표시

---

## 1. 시스템 구성 개요

### 1.1 동작 흐름

```
[1분 사이클]
  ↓
[Step A] 통보문 폴링 → 기존 자식해역 처리 (mapDataToForm)
  → weather_alerts.json children 객체 갱신 ('Y' / null)
  ↓
[Step B] 방재기상 폴링 → 신규 자식해역 처리 (subregion_judge)
  → subregion_lifecycle.json 갱신
  ↓
[Step C] 비교 검증 (subregion_comparator) ★ 신규 핵심 기능
  → 두 결과 비교
  → 상이성 발견 시:
      ├─ subregion_error_log.json에 상이성 항목 기록
      ├─ 관리자 푸시 발송 (admin_push)
      └─ 통합관리자 센터 특보수집오류 탭에 표시
  ↓
[Step D] 화면 표출 (index1만)
  → #subregion-section 안에 두 결과 나란히 표시
```

### 1.2 사용자 화면 영향

| 페이지 | 자식해역 표출 |
|---|---|
| **index1** | 기존 로직 결과(`.coastal-zones`) + 신규 로직 결과(`#subregion-section`) 나란히 표시 |
| **index2** | 기존 로직 결과(`.coastal-zones`)만 표시 (변화 없음) |

### 1.3 운영자 영향

| 위치 | 동작 |
|---|---|
| **통합관리자 센터 → 특보수집오류 탭** (이미지의 그 화면) | 상이성 발견 시 항목 표시 (코드 + 서술 형식) |
| **관리자 푸시** | 상이성 발견 시 알림 (스팸 방지 정책 적용) |

---

## 2. 비교 알고리즘

### 2.1 비교 단위

비교는 **자식해역(regId) + 특보종류(wrnTp) 조합**별로 수행:

```javascript
// 같은 regId라도 다른 wrnTp면 별도 비교
"S2122000:풍랑"   → 비교 단위 1
"S2122000:폭풍해일" → 비교 단위 2
```

단, 본 작업의 결정에 따라 **동일 자식해역에 두 종류 동시 발효 없음**이므로 실질적으로 regId 단독 비교와 동일.

### 2.2 비교 대상 필드

각 자식해역 단위에서 다음 필드를 비교:

| 비교 항목 | 기존 로직에서 추출 | 신규 로직에서 추출 |
|---|---|---|
| **활성 여부** | `weather_alerts.json` children 값이 `'Y'`인가 | `subregion_lifecycle.json`의 `current` 객체가 존재하는가 |
| **특보 종류** | 부모해역의 `current.wrnTp` 상속 | 신규 객체의 `current.wrnTp` |
| **특보 레벨** | 부모해역의 `current.wrnLvl` 상속 | 신규 객체의 `current.wrnLvl` (캡 적용 후) |
| **부모 해역 일치** | 부모해역 식별자 | 부모해역 식별자 (매핑 테이블 통해) |

### 2.3 상이성 분류

| 분류 코드 | 의미 |
|---|---|
| `BOTH_ACTIVE_DIFFERENT_LEVEL` | 둘 다 발효 중이지만 레벨이 다름 |
| `BOTH_ACTIVE_DIFFERENT_TYPE` | 둘 다 발효 중이지만 특보 종류가 다름 |
| `LEGACY_ACTIVE_AFSO_INACTIVE` | 기존만 발효, 신규는 미발효 |
| `LEGACY_INACTIVE_AFSO_ACTIVE` | 기존은 미발효, 신규만 발효 |
| `BOTH_INACTIVE` | 둘 다 미발효 (상이성 없음, 정상) |
| `BOTH_ACTIVE_MATCH` | 둘 다 발효 중 + 종류/레벨 일치 (정상) |

→ 상이성 항목으로 기록하는 것은 **앞 4개**.
→ 마지막 2개는 정상이므로 기록하지 않음.

### 2.4 비교 함수 (의사코드)

```javascript
function compareSubregion(legacy, afso) {
  const result = {
    subregionRegId: ...,
    subregionName: ...,
    parentRegion: ...,
    comparedAt: nowISO(),
    legacy: { ... },
    afso: { ... },
    diff: [],
    diffType: null,
    severity: null
  };

  // 활성 여부 일치 체크
  if (!legacy.active && !afso.active) {
    result.diffType = "BOTH_INACTIVE";
    return null;  // 기록 안 함 (정상)
  }

  if (legacy.active && !afso.active) {
    result.diffType = "LEGACY_ACTIVE_AFSO_INACTIVE";
    result.severity = "HIGH";
    result.diff.push({ field: "active", legacy: true, afso: false });
    return result;
  }

  if (!legacy.active && afso.active) {
    result.diffType = "LEGACY_INACTIVE_AFSO_ACTIVE";
    result.severity = "HIGH";
    result.diff.push({ field: "active", legacy: false, afso: true });
    return result;
  }

  // 둘 다 활성 — 세부 필드 비교
  if (legacy.wrnTp !== afso.wrnTp) {
    result.diffType = "BOTH_ACTIVE_DIFFERENT_TYPE";
    result.severity = "HIGH";
    result.diff.push({ field: "wrnTp", legacy: legacy.wrnTp, afso: afso.wrnTp });
    return result;
  }

  if (legacy.wrnLvl !== afso.wrnLvl) {
    result.diffType = "BOTH_ACTIVE_DIFFERENT_LEVEL";
    result.severity = afso.wrnLvl > legacy.wrnLvl ? "MEDIUM" : "LOW";
    result.diff.push({
      field: "wrnLvl",
      legacy: legacy.wrnLvl,
      afso: afso.wrnLvl
    });
    return result;
  }

  result.diffType = "BOTH_ACTIVE_MATCH";
  return null;  // 기록 안 함 (정상)
}
```

### 2.5 위험도 (severity) 정의

| 위험도 | 케이스 | 운영자 대응 |
|---|---|---|
| `HIGH` | 활성 여부 불일치 / 특보 종류 다름 | 즉시 점검 필요 |
| `MEDIUM` | 신규가 기존보다 높은 레벨 | 부모 통보문 격상 발표 가능성, 모니터링 |
| `LOW` | 신규가 기존보다 낮은 레벨 | 부모 통보문 격하 발표 가능성, 모니터링 |

---

## 3. 데이터 모델 (`subregion_error_log.json` 확장)

### 3.1 기존 정의 활용

이전 문서(`02_DATA_MODEL/05_error_log_schema.md`)에서 정의한 `subregion_error_log.json`을 그대로 활용. 기존 오류 유형에 신규 항목 추가:

| 오류 유형 코드 | 의미 |
|---|---|
| (기존) `MAPPING_MISSING` | 매핑 누락 |
| (기존) `LEVEL_CAP_APPLIED` | 캡 적용 |
| (기존) `AFSO_RESPONSE_ERROR` | 방재기상 응답 오류 |
| ... | ... |
| **(신규) `COMPARISON_MISMATCH`** | **두 로직 결과 상이** |

### 3.2 신규 오류 항목 스키마

```json
{
  "id": "err_2026050103300001",
  "errorType": "COMPARISON_MISMATCH",
  "severity": "MEDIUM",
  "occurredAt": "2026-05-01T03:30:00+09:00",
  "acknowledged": false,
  "acknowledgedAt": null,
  "acknowledgedBy": null,

  "developerInfo": {
    "comparisonId": "cmp_2026050103300001",
    "subregionRegId": "S2122000",
    "subregionName": "제주도서부앞바다중가파도연안바다",
    "parentRegion": "제주도서부앞바다",
    "diffType": "BOTH_ACTIVE_DIFFERENT_LEVEL",

    "legacy": {
      "source": "weather_alerts.json children",
      "active": "Y",
      "inheritedFromParent": {
        "wrnTp": "풍랑",
        "wrnLvl": 2,
        "wrnLvlName": "주의보"
      }
    },

    "afso": {
      "source": "subregion_lifecycle.json",
      "status": "active",
      "wrnTp": "풍랑",
      "wrnLvl": 3,
      "wrnLvlName": "경보",
      "tmEf": "2026-04-30T14:00:00+09:00",
      "rawFromAfso": { "wrnLvl": 3 },
      "appliedCap": false
    },

    "diff": [
      {
        "field": "wrnLvl",
        "legacy": 2,
        "afso": 3,
        "diffType": "VALUE_MISMATCH"
      },
      {
        "field": "wrnLvlName",
        "legacy": "주의보",
        "afso": "경보",
        "diffType": "VALUE_MISMATCH"
      }
    ]
  },

  "narrativeDescription": "...상세 서술 텍스트 (아래 §4.2 형식)...",

  "actionRequired": "...운영자 안내 텍스트 (아래 §4.3 형식)...",

  "occurrenceCount": 1,
  "lastOccurredAt": "2026-05-01T03:30:00+09:00"
}
```

---

## 4. 표시 형식 명세

### 4.1 코드 형식 (개발자용)

위 §3.2의 JSON을 그대로 표시. 단, UI에서는 `<details><pre>{...}</pre></details>` 안에 펼치기 가능한 형태로 표시.

### 4.2 서술 형식 (운영자용)

상이성 항목별 평문 메시지 표준 템플릿:

```
{발생 시각}, 자식해역 비교 검증에서 결과가 일치하지 않는 항목이 발견되었습니다.

[해역 정보]
  자식해역 이름: {regKoApp}
  부모해역: {parentRegKoApp}
  방재기상 코드: {afsoRegId}

[기존 로직 결과 (기상청 텍스트 스크래핑 기반)]
  발효 상태: {발효 중 / 미발효}
  특보 종류: {wrnTp}
  특보 수준: {wrnLvlName} (부모해역 통보문에서 상속받음)
  근거 데이터: weather_alerts.json의 children 객체

[방재기상 로직 결과 (방재기상시스템 API 기반)]
  발효 상태: {발효 중 / 미발효}
  특보 종류: {wrnTp}
  특보 수준: {wrnLvlName}
  발효 시각: {tmEf}
  근거 데이터: subregion_lifecycle.json (방재기상 응답)

[차이점]
  {diffType별 상세 설명}

[추정 원인]
  {diffType별 추정 원인}

[조치 안내]
  {diffType별 조치 안내}
  - 사용자에게는 기존 로직 결과가 표시됩니다 (안전 측 정책).
```

### 4.3 diffType별 추정 원인 / 조치 안내

#### `BOTH_ACTIVE_DIFFERENT_LEVEL` (신규가 더 높음, MEDIUM)

```
[추정 원인]
  부모해역의 통보문이 아직 {기존레벨}이지만, 방재기상시스템이 {신규레벨}
  격상 발표를 미리 표시하고 있을 가능성이 높습니다. 부모 통보문이 갱신되면
  두 결과가 다시 일치할 것입니다.

[조치 안내]
  - 부모해역 통보문이 갱신될 때까지 기다려보세요 (보통 1~2시간).
  - 통보문 갱신 후에도 차이가 지속되면 매핑 테이블 또는 데이터 품질
    점검이 필요할 수 있습니다.
  - 사용자에게는 기존 로직 결과 ({기존레벨})가 표시됩니다 (안전 측 정책).
```

#### `BOTH_ACTIVE_DIFFERENT_LEVEL` (신규가 더 낮음, LOW)

```
[추정 원인]
  부모해역의 통보문이 {기존레벨}이지만, 방재기상시스템이 {신규레벨}로
  격하 발표를 미리 표시하고 있을 가능성이 있습니다.

[조치 안내]
  - 부모해역 통보문이 갱신될 때까지 기다려보세요.
  - 자식해역에 별도 발효 시각이 있어 부모와 다를 수도 있습니다.
  - 사용자에게는 기존 로직 결과 ({기존레벨})가 표시됩니다.
```

#### `LEGACY_ACTIVE_AFSO_INACTIVE` (HIGH)

```
[추정 원인]
  기존 로직(텍스트 스크래핑)은 발효로 판단하지만, 방재기상시스템은 해당
  자식해역 정보를 응답에 포함하지 않습니다. 다음 중 하나의 가능성:
  1. 방재기상에서 사전 해제 발표가 표시됨 (미래 해제 예정)
  2. 방재기상에서 일시 누락 (응답 오류)
  3. 매핑 테이블 또는 우리 앱 정의 오류

[조치 안내]
  - 1~2분 후 다시 확인하여 일시적 누락인지 확인하세요.
  - 지속되면 우리 앱 트리 정의(weather_alerts_crawler.js) 또는
    매핑 테이블(region_alias_map.json) 점검이 필요합니다.
  - 사용자에게는 기존 로직 결과 (발효 중)가 표시됩니다.
```

#### `LEGACY_INACTIVE_AFSO_ACTIVE` (HIGH)

```
[추정 원인]
  방재기상시스템은 해당 자식해역을 발효 상태로 표시하지만, 기존 로직
  (텍스트 스크래핑)은 그렇지 않습니다. 다음 중 하나의 가능성:
  1. 기상청 텍스트 페이지에서 사전 삭제됨 (미래 해제 예정인데 텍스트만 빠짐)
  2. 텍스트 스크래핑 파싱 오류
  3. 매핑 이름 차이로 텍스트 매칭 실패

[조치 안내]
  - 부모해역 통보문이 살아있는지 확인하세요.
  - 자식해역 이름이 텍스트와 정확히 매칭되는지 점검하세요.
  - 사용자에게는 기존 로직 결과 (미발효)가 표시됩니다.
```

#### `BOTH_ACTIVE_DIFFERENT_TYPE` (HIGH)

```
[추정 원인]
  같은 자식해역에 대해 두 로직이 서로 다른 종류의 특보를 보고합니다
  (예: 기존=풍랑, 신규=태풍). 매우 드문 케이스로, 데이터 무결성 점검이
  필요합니다.

[조치 안내]
  - 부모해역의 통보문 종류와 비교하세요.
  - 매핑 테이블의 부모-자식 연결이 올바른지 확인하세요.
  - 사용자에게는 기존 로직 결과 ({기존종류})가 표시됩니다.
```

---

## 5. 푸시 알림 정책

### 5.1 발송 조건

상이성 발견 시 다음 정책에 따라 푸시 발송:

| 위험도 | 첫 발생 | 반복 발생 |
|---|---|---|
| `HIGH` | 즉시 발송 | 1시간 간격 (스팸 방지) |
| `MEDIUM` | 즉시 발송 | 6시간 간격 |
| `LOW` | 발송 안 함 | 발송 안 함 (운영자 검토 시 UI에서 확인) |

### 5.2 푸시 메시지 형식

기존 `admin_push.js` 시그니처 그대로:

```javascript
sendAdminPush(
  title: "자식해역 비교 불일치 감지",
  body: "{regKoApp} ({parentRegion}) — {간단 요약}",
  data: {
    category: "subregion_comparison_mismatch",
    severity: "MEDIUM",
    comparisonId: "cmp_...",
    subregionRegId: "S2122000",
    deeplink: "통합관리자센터/특보알림/특보수집오류"
  }
)
```

### 5.3 푸시 본문 예시

```
제목: 자식해역 비교 불일치 감지
본문: 가파도연안바다 (제주도서부앞바다) — 기존 주의보 vs 신규 경보
      특보 수준이 1단계 차이. 상세는 통합관리자 센터에서 확인하세요.
```

### 5.4 발송 빈도 제어 함수

```javascript
function shouldSendComparisonPush(diffType, severity, signature) {
  if (severity === "LOW") return false;

  const lastSent = getLastComparisonPushTime(signature);
  if (lastSent === null) return true;

  const interval = severity === "HIGH" ? 3600 * 1000 : 6 * 3600 * 1000;
  return (now() - lastSent) >= interval;
}
```

`signature` = `subregionRegId + diffType` 조합. 같은 자식해역의 같은 종류의 상이성은 빈도 제어.

---

## 6. UI 통합 — 특보수집오류 탭

### 6.1 탭 구조 변경 (이미지 참조)

이미지에 따르면 현재 특보수집오류 탭은 단일 화면입니다. 본 작업으로 다음과 같이 확장:

```
[통합관리자 센터 → 특보 알림 → 특보수집오류 탭]

  [통계 영역]
  - 검토 필요: N건
  - 재시도 중: M건
  - 수집 실패: K건
  - 자식해역 비교 불일치: L건  ← 신규

  [필터 / 분류]
  [○ 전체] [○ 검토 필요] [○ 재시도 중] [○ 수집 실패] [● 자식해역 비교 불일치]

  [오류 목록 — 자식해역 비교 불일치]
  ───────────────────────────────────────
  ⚠️ 자식해역 비교 불일치 [MEDIUM]            [미확인]
  2026년 05월 01일 03시 30분 발생

  자식해역 비교 검증에서 결과가 일치하지 않는 항목이 발견되었습니다.

  [해역 정보]
    자식해역: 제주도서부앞바다중 가파도연안바다
    부모해역: 제주도서부앞바다

  [기존 로직 결과] 풍랑 주의보 발효 중
  [방재기상 결과] 풍랑 경보 발효 중

  [차이] 특보 수준 1단계 차이 (주의보 → 경보)

  ▶ 코드 형식 보기 (펼치기)
  ▶ 상세 서술 보기 (펼치기)

  [확인 완료] 버튼
  ───────────────────────────────────────
```

### 6.2 표시 위치 정책

사용자 결정(작업 18 = 옵션 b): **index1의 어드민 패널에서만 표시**.

- index1의 통합관리자 센터: 자식해역 비교 불일치 항목 표시
- index2의 통합관리자 센터: 표시 안 함 (페이지 가드)

```javascript
// js/admin.js 또는 관련 위치
function renderSubregionComparisonTab() {
  if (window.__SEAGNAL_PAGE !== 'index1') return null;
  // ... 렌더 로직
}
```

---

## 7. index1 화면 표시 — 두 결과 나란히

### 7.1 화면 레이아웃

```
[index1의 알림 화면]

  [부모해역 알림 카드: 제주도서부앞바다 풍랑 주의보]
   └─ [기존 자식해역 표출: .coastal-zones (변화 없음)]
       - 북서연안 [기존]
       - 남서연안 [기존]
       - 가파도연안 [기존]

   └─ [신규 자식해역 표출: #subregion-section] ★
       - 북서연안 [방재기상]
       - 남서연안 [방재기상]
       - 가파도연안 [방재기상] ⚠️ 기존과 차이

   └─ [상단/하단 라벨]
       "위 ⚠️ 표시는 기존 로직과 방재기상 로직 결과가 다른 항목입니다.
        상세는 통합관리자 센터에서 확인하세요."
```

### 7.2 시각적 구분

- 기존 자식해역 영역: 기존 스타일 그대로 (`.coastal-zones`)
- 신규 자식해역 영역: 별도 컨테이너 (`#subregion-section`)
- 상이성 있는 항목: 시각적 강조 (예: 노란 배경, ⚠️ 아이콘)

### 7.3 사용자 안내 툴팁

신규 영역 상단 또는 하단에 작게:

```
[방재기상시스템 기반 자식해역 표출 (검증 단계)]
이 정보는 본 정보는 실제 발표내용과 다를 수 있습니다.
운영 검증 중인 정보로, 정확한 정보는 좌측 표출을 참고하세요.
```

---

## 8. 작업 목록 최종 정리

본 비교 검증 시스템으로 작업 목록 최종 갱신:

### 8.1 변경된 작업

| # | 변경 내용 |
|---|---|
| 작업 11 | "자식해역 오류 영역 추가" → **"기존 특보수집오류 탭에 자식해역 비교 불일치 항목 통합"** |
| 작업 18 | **옵션 b 결정** (index1만 표시) |

### 8.2 신규 작업 4개

| # | 작업 | 위험도 |
|---|---|---|
| **19** | **자식해역 비교 검증 모듈** (`services/subregion_comparator.js`) | 중간 |
| **20** | **상이성 감지 시 푸시 발송 정책** (스팸 방지 포함) | 낮음 |
| **21** | **index1 화면 두 결과 나란히 표시** (`subregion_display.js` 확장) | 낮음 |
| **22** | **특보수집오류 탭에 비교 불일치 항목 통합 + 페이지 가드** | 낮음 |

### 8.3 최종 작업 수: 17개 → **20개**

(13번 제거되어 실제 17개에서 19/20/21/22 추가, 11번은 정정으로 그대로 카운트)

---

## 9. 비교 검증의 운영 가치

### 9.1 검증 단계의 가치

- 신규 로직(방재기상 기반)이 기존 로직(텍스트 스크래핑 기반)과 일관된 결과를 내는지 데이터로 검증
- 운영 중 자연스럽게 차이 발견 → 운영자에게 즉시 알림
- 검증 데이터가 쌓이면 향후 index2 적용 결정의 근거

### 9.2 운영 단계의 가치 (검증 후에도)

- 두 데이터 소스의 일관성 모니터링 도구로 영구 활용
- 기상청 시스템 변화 감지 (예: 텍스트 페이지 형식 변경, 방재기상 데이터 변경)
- 매핑 테이블 품질 모니터링

### 9.3 비교 검증이 만드는 효과

- **검증 부담 ↓**: 자동 비교로 운영자가 매번 수동 확인 불필요
- **신뢰도 ↑**: 데이터로 검증된 신규 로직만 향후 운영 적용
- **이슈 발견 속도 ↑**: 매분 자동 감지로 빠른 대응

---

## 10. 본격 코드 구현 시작 준비 완료

본 문서로 모든 분리/검증 설계가 마무리되었습니다.

### 10.1 분리 분석 시리즈 최종 (총 6개)

| 파일 | 내용 |
|---|---|
| `01_inventory.md` | 자원 인벤토리 |
| `02_dependencies.md` | 의존성 / 핫스팟 |
| `03_risk_assessment.md` | 위험도 평가 |
| `04_re_review.md` | 재검토 — 누락 2건 |
| `05_extra_verification.md` | 추가 검증 — 신규 4건 |
| `06_comparison_validation.md` | 비교 검증 시스템 (본 파일) |

### 10.2 작업 20개 항목 모두 정의됨

작업 1~22 (13번 제거) 모두 위험도 평가 + 구현 가이드 포함.

### 10.3 다음 단계

본격 코드 구현 시작:

1. **1단계** — index1 분리 인프라 (작업 1, 2, 4, 14, 15)
2. **2단계** — 데이터 파일 (작업 6, 10)
3. **3단계** — 백엔드 모듈 (작업 5, 7, 8, **19**, **20**)
4. **4단계** — 프론트엔드 (작업 3, **21**, 16, 17)
5. **5단계** — 통합 및 어드민 (작업 9, **22**, 11, 12, 18)
6. **6단계** — 검증 및 모니터링

본 문서 시리즈를 끝으로 사용자 승인 후 실제 코드 구현으로 넘어갑니다.
