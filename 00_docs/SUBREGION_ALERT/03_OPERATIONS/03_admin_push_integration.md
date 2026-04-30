# 자식해역 특보 표출 — 3.3 관리자 푸시 알림 통합

## 0. 본 파일의 위치

본 파일은 `03_OPERATIONS/` 시리즈의 세 번째 파일이며, 자식해역 관련 오류 발생 시 관리자에게 푸시 알림을 발송하는 메커니즘을 정리합니다.

기존에 유사 기능이 이미 구현되어 있으므로, 본 작업은 **기존 패턴을 그대로 재활용**합니다.

---

## 1. 기존 시스템 분석

### 1.1 기존 관리자 푸시 시스템

기존 시스템은 통합관리자 센터의 특보수집오류 영역에 사용되며, 다음과 같이 구성됩니다.

| 컴포넌트 | 위치 |
|---|---|
| 푸시 발송 함수 | `local_server/services/admin_push.js:28-94` `sendAdminPush()` |
| 관리자 기기 목록 파일 | `local_server/data/admin_devices.json` |
| 기기 등록 API | `routes/admin.js:1264-1313` |
| 기기 등록 해제 API | `routes/admin.js:1313-1349` |
| 기기 상태 조회 | `routes/admin.js:1349-1371` |
| 오류 등록 API (예시) | `routes/admin.js:404-425` |

### 1.2 푸시 발송 함수 시그니처

```
sendAdminPush(title, body, data = {})
```

| 인자 | 타입 | 의미 |
|---|---|---|
| `title` | string | 푸시 제목 |
| `body` | string | 푸시 본문 (서술형 메시지) |
| `data` | object | 추가 메타데이터 (FCM data payload로 전달) |

### 1.3 기존 동작

- `admin_devices.json`에서 등록된 모든 기기의 FCM 토큰 로드
- Firebase Messaging API로 일괄 발송
- 죽은 토큰은 자동 제거

---

## 2. 본 작업의 통합 방식

### 2.1 통합 원칙

본 작업은 기존 `sendAdminPush()` 함수를 **그대로 재사용**합니다. 새 푸시 시스템을 만들지 않습니다.

### 2.2 통합 함수

```
function triggerAdminPush(narrative, errorType, errorId):
  title = "자식해역 오류: " + getErrorTypeKorean(errorType)
  body = narrative

  data = {
    category: "subregion_alert",
    errorType: errorType,
    errorId: errorId,
    deeplink: "통합관리자센터/특보알림/특보수집오류/자식해역"
  }

  sendAdminPush(title, body, data)
```

### 2.3 errorType 한글 변환

```
function getErrorTypeKorean(errorType):
  switch errorType:
    case "MAPPING_MISSING": return "매핑 누락"
    case "AFSO_RESPONSE_ERROR": return "방재기상 응답 오류"
    case "PARENT_CHILD_MISMATCH": return "부모-자식 데이터 불일치"
    case "STALE_PARENT": return "통보문 stale 경고"
    case "LEVEL_CAP_APPLIED": return "레벨 캡 적용"
    case "TIME_CAP_APPLIED": return "시각 캡 적용"
    case "RANGE_TIME_PARENT": return "범위형 시각 잠금"
    default: return "기타"
```

---

## 3. 푸시 알림 대상 오류

### 3.1 푸시 발송 대상

다음 오류 유형은 신규 발생 시 푸시:

- `MAPPING_MISSING`
- `AFSO_RESPONSE_ERROR`
- `PARENT_CHILD_MISMATCH`
- `STALE_PARENT`

### 3.2 푸시 미발송 대상

다음 오류 유형은 로그만 기록 (정보성):

- `LEVEL_CAP_APPLIED`
- `TIME_CAP_APPLIED`
- `RANGE_TIME_PARENT`

### 3.3 본 정책의 근거

자세한 분류 정책: `01_error_classification.md` 참조.

---

## 4. 푸시 발송 빈도 제어

### 4.1 첫 발생만 발송

같은 오류가 반복 발생해도 푸시는 첫 발생 시만 발송합니다.

### 4.2 함수 형태

```
function shouldTriggerPush(errorType, signature):
  errorLog = loadErrorLog()
  existing = errorLog.errors.find(e => makeSignature(e) == signature)

  # 신규 오류
  if existing == null:
    return true

  # 확인 후 재활성화 (확인됐던 오류가 재발생)
  if existing.acknowledged:
    return true

  # 확인 안 된 같은 오류가 또 발생 → 푸시 안 함
  return false
```

### 4.3 STALE_PARENT의 빈도 제어

24시간 무변화로 발생하는 `STALE_PARENT`는 일별 1회 알림:

```
function shouldTriggerStalePush(parentRegId):
  lastPushed = getLastStalePushTime(parentRegId)
  if lastPushed == null:
    return true
  return (now() - lastPushed) >= 24 hours
```

---

## 5. 푸시 메시지 형식

### 5.1 일반 형식

| 항목 | 내용 |
|---|---|
| 제목 | "자식해역 오류: [오류 유형 한글]" |
| 본문 | 서술형 메시지 (`narrativeDescription`) |
| data.category | "subregion_alert" |
| data.errorType | 오류 코드 |
| data.errorId | 오류 항목 ID |
| data.deeplink | 통합관리자 센터 해당 영역 경로 |

### 5.2 예시 — MAPPING_MISSING

```
제목: 자식해역 오류: 매핑 누락
본문:
  2026년 04월 30일 22시 05분, 방재기상시스템에서 받은 자식해역
  'S2999900 (○○○평수구)' 에 대해 우리 앱의 매핑 테이블에 등록된
  이름이 없습니다. 매핑 테이블에 추가가 필요합니다.

data: {
  "category": "subregion_alert",
  "errorType": "MAPPING_MISSING",
  "errorId": "err_2026043022050001",
  "deeplink": "통합관리자센터/특보알림/특보수집오류/자식해역"
}
```

### 5.3 예시 — AFSO_RESPONSE_ERROR

```
제목: 자식해역 오류: 방재기상 응답 오류
본문:
  2026년 04월 30일 22시 05분, 방재기상시스템 API에 응답 오류가
  발생했습니다. 사유 HTTP_STATUS, 상세 503. 자식해역 상태는 직전
  사이클의 정보를 그대로 유지합니다.

data: { ... }
```

---

## 6. 관리자 기기 등록

### 6.1 기존 등록 메커니즘 재활용

본 작업은 별도 기기 등록 절차를 만들지 않고 기존 메커니즘을 그대로 사용합니다.

- 기존 등록 API: `POST /api/admin/register-device`
- 기존 해제 API: `POST /api/admin/unregister-device`
- 기존 파일: `admin_devices.json`

### 6.2 기존 사용자에게 추가 작업 불필요

이미 통합관리자 센터에서 푸시를 받고 있는 관리자는 별도 작업 없이 자식해역 오류 푸시도 받게 됩니다.

---

## 7. 푸시 미수신 시 디버깅

### 7.1 발생 가능 원인

- `admin_devices.json`이 비어 있음
- FCM 토큰이 만료
- Firebase 설정 오류

### 7.2 디버깅 절차

```
1. admin_devices.json 확인 — 토큰이 있는지
2. sendAdminPush() 함수의 로그 확인
3. Firebase 콘솔에서 발송 이력 확인
4. 클라이언트 측 권한 (브라우저/앱 알림 허용) 확인
```

### 7.3 푸시 발송 실패 자체가 오류

푸시 발송 실패는 `sendAdminPush()` 내부에서 처리됩니다. 본 작업은 발송 결과를 별도로 추적하지 않습니다.

---

## 8. 자식해역 푸시와 사용자 푸시의 분리

### 8.1 사용자 푸시 미발송

자식해역 정보 변경(발효, 해제, 격상 등)에 대해 **일반 사용자에게는 푸시를 발송하지 않습니다**.

- 사용자에게는 화면 표시만으로 정보 제공
- 본 작업의 핵심 정책

### 8.2 관리자 푸시만 발송

자식해역 관련 푸시는 **관리자 푸시 시스템**에서만 발송:

- 자식해역 관련 오류 발생 시
- 매핑 누락, 응답 오류 등 운영자가 알아야 할 사안

### 8.3 시스템 분리

기존 사용자 푸시 시스템(`push_sender.js` 등)과 관리자 푸시 시스템(`admin_push.js`)이 명확히 분리되어 있어, 본 작업이 사용자 푸시에 영향을 주지 않습니다.

---

## 9. 푸시 알림 테스트

### 9.1 개발 단계 테스트

신규 오류 유형이 추가되면 다음을 테스트:

- 첫 발생 시 푸시 발송 여부
- 반복 발생 시 푸시 미발송
- 확인 후 재발생 시 푸시 재발송
- 푸시 본문이 서술형으로 정확히 도착

### 9.2 본 작업 도입 시 검증

본 작업 도입 직후 운영자가 receiveing 측에서 다음 확인:

- 매핑 누락 강제 발생 시 푸시 도착
- 응답 오류 강제 발생 시 푸시 도착
- 기존 푸시 시스템과 충돌 없음

---

## 10. 본 파일 다음 작업

- 다음 파일: `04_admin_ui.md`
- 주제: 통합관리자 센터 UI 추가 (자식해역 오류 영역)
