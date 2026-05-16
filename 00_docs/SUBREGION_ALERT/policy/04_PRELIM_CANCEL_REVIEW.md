# 정책 ④ — 예비특보 자연어 해제 처리 (방식 A)

**작성일**: 2026-05-16
**버전**: 1.0
**관련 분석**: `audit/KMA_PRELIM_CANCEL_PATTERNS_2026-04-13_TO_05-13.md`

---

## 1. 배경 — 두 가지 예비특보 해제 방식

### 방식 A: 자연어 해제 ([예비] 통보문 참고사항 절)

```
[예비] 통보문 본문
   □ 내용
   o 없음

   < 참고사항 >
   o 오늘(17일) 오전으로 예고되었던 제주도산지의 호우 예비특보는
     발표 가능성이 낮아져 해제합니다.
```

→ **자동 처리 X** (사용자 결정). `review_needed.json` 추가 + 관리자 푸시 알림 → 어드민 확인 후 적용.

### 방식 B: 정식 [특보] 통보문

```
[특보] 통보문 본문
   □ 발효시각
   (1) 풍랑예비특보 해제 : 2026년 05월 16일 14시 00분

   □ 해당지역
   (1) 풍랑예비특보 해제 : 제주도서부앞바다( 북서연안바다 )
```

→ **자동 처리** (정식 [특보] 형식이므로 신뢰).

본 정책은 **방식 A** 만 다룸. 방식 B 는 일반 통보문 파서 흐름에 포함됨.

---

## 2. 방식 A 검출 정규식

### 2-1. 핵심 시그니처

```javascript
const PRELIM_CANCEL_NATURAL_RE =
  /(?<region>[가-힣.·\s()0-9~]+?)의?\s*(?<kind>[가-힣]+)\s*예비\s*특보(?:는)?\s*발표\s*가능성이\s*낮[아어]져\s*해제(?:합니다|하나)/g;
```

### 2-2. 표기 변형 처리

| 변형 | 처리 |
|---|---|
| 낮아져 / 낮어져 | `낮[아어]져` 매칭 |
| 예비특보 / 예비 특보 / 호우예비특보 | `예비\s*특보` 매칭 |
| 해제합니다 / 해제하나 | `해제(?:합니다\|하나)` 매칭 |

### 2-3. 추출 필드

```javascript
{
  region: "제주도산지",        // 해당 지역(자식해역 포함 가능)
  kind: "호우",                 // 특보 종류
  targetTime: "오전(06시~12시)", // 원래 예고된 시간대 (참고사항 앞부분 정규식)
  issuedAt: "2026-04-17 11:00", // 본 통보문 발표 시각
  detectedPhrase: "발표 가능성이 낮아져 해제합니다"  // 원문
}
```

---

## 3. 처리 흐름

```
[예비] 통보문 도착 (kind=pwn)
   │
   ▼
본문 추출 (□ 내용 + 참고사항 절 보존)
   │
   ▼
참고사항 절에 PRELIM_CANCEL_NATURAL_RE 매칭
   │
   ├─ 매칭 X → 일반 처리 (□ 내용 절만 사용)
   │
   └─ 매칭 O → 자동 처리 X
        │
        ▼
   ① review_needed.json 에 추가
   ② 관리자 푸시 알림 발송 (case ⑦)
        │
        ▼
관리자 어드민 패널에서 확인
   ├─ ✓ 확인 → 장부에서 해당 upcoming 제거 + 사용자 알림 발송 (기존 양식)
   └─ ✗ 무시 → 그냥 폐기 (장부 변화 없음)
```

---

## 4. `review_needed.json` 구조 확장

기존 구조에 자식해역·예비특보 관련 필드 추가:

```json
{
  "items": [
    {
      "id": "rev_20260517_001",
      "reportId": "pwn:202605170400:26",
      "category": "prelim_natural_cancel",
      "severity": "HIGH",
      "createdAt": "2026-05-17T04:00:00+09:00",
      "acknowledged": false,
      "acknowledgedAt": null,
      "acknowledgedBy": null,
      "details": {
        "affectedRegion": "제주도산지",
        "affectedKind": "호우",
        "targetTime": "새벽(03시~06시)",
        "detectedPhrase": "오늘(19일) 새벽으로 예고된 제주도북부의 호우예비특보는 발표 가능성이 낮아져 해제합니다",
        "fullReferenceBlock": "...",
        "rawNotice": "..."
      }
    }
  ]
}
```

---

## 5. 어드민 패널 — 검토 필요 탭 확장

기존 `검토 필요` 탭에 `예비특보 취소` 카테고리 추가:

```
[검토 필요⓹]
 ├─ 일반 검토 필요 (기존)
 └─ 예비특보 취소 확인  ← 신규
     ├─ 제주도산지 호우 예비특보 (#pwn:202605170400:26)
     │   [✓ 확인 및 적용]   [✗ 무시]
     ├─ 제주도북부 호우 예비특보 (#pwn:202605190400:26)
     ...
```

### 5-1. ✓ 확인 클릭 시

1. 장부에서 해당 upcoming 제거
   ```
   부모.upcoming = null  (또는 해당 자식.upcoming = null)
   ```
2. 사용자에게 정식 알림 발송 (기존 `push_helpers.js` 양식 #3 — `✅ ○○예비특보 해제`)
3. `review_needed.json` 의 해당 항목 acknowledged=true 갱신

### 5-2. ✗ 무시 클릭 시

장부 변화 없음. review_needed.json 의 항목 acknowledged=true + 무시 사유 기록.

---

## 6. 관리자 푸시 양식 (Case ⑦, 정책 ⑥ 참조)

```
🔔 SEAGNAL 관리자
📩 예비특보 취소 확인 요청
예비 제05-26호 (5/17 04:00) — 제주도산지 호우
예비특보 / "발표 가능성이 낮아져 해제"
어드민 확인 후 적용
```

푸시 클릭 시: `/?openAdmin=reviewNeeded&category=prelim_natural_cancel`

---

## 7. 빈도 제어

- 같은 reportId 1시간 1회 발송
- 어드민 미확인 시 1시간마다 알림 재발송 (기존 반복 푸시 로직 재사용)

---

## 8. 코드 변경 위치

| 파일 | 변경 |
|---|---|
| `local_server/report_alert_processor.js` | 참고사항 절 보존 옵션 + PRELIM_CANCEL_NATURAL_RE 적용 |
| `local_server/services/admin_push.js` | (변경 없음) |
| `local_server/data/review_needed.json` | 구조 확장 (details 필드 추가) |
| `local_server/js/admin.js` | 검토 필요 탭에 예비특보 카테고리 + 확인/무시 버튼 |
| `local_server/routes/admin.js` | 예비특보 확인/무시 API 추가 |
