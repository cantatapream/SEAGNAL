# 정책 ⑥ — 자식해역 관련 관리자 푸시 알림

**작성일**: 2026-05-16
**버전**: 1.0
**기반 시스템**: 기존 `services/admin_push.js` 의 `sendAdminPush(title, body, data)`

---

## 1. 핵심 원칙

- **사용자 푸시는 부모해역 변화만** (정책 ②)
- **자식해역 관련 변화·오류는 관리자 푸시 발송** (본 정책)
- 통보문 식별을 사람이 읽기 쉽게: `[광역 약칭] 제MM-NN호 (M/D HH:MM)` 형식
- 빈도 제어로 알림 폭주 차단

---

## 2. 통보문 식별 표기 변환

| 기계 표기 (reportId) | 사람 친화 표기 |
|---|---|
| `met:202605161430:42` | `제주 제05-42호 (5/16 14:30)` |
| `pwn:202605161100:18` | `예비 제05-18호 (5/16 11:00)` |
| `cmt:202605131630:26` | `해설 제05-26호 (5/13 16:30)` |

### 변환 함수

```javascript
const STN_ABBR = {
  105: '강원', 109: '서울인천경기', 133: '대전세종충남',
  143: '대구경북', 146: '전북', 156: '광주전남',
  159: '부산울산경남', 184: '제주'
};
const KIND_LABEL = {
  met: '특보', pwn: '예비', cmt: '해설', inf: '정보', ann: '속보'
};

function formatReportLabel(reportId, stn) {
  const [kind, dateStr, seq] = reportId.split(':');
  const m = dateStr.substring(4, 6);
  const d = dateStr.substring(6, 8);
  const hh = dateStr.substring(8, 10);
  const mm = dateStr.substring(10, 12);
  const stnAbbr = STN_ABBR[stn] || '';
  const houNumber = `제${m}-${seq}호`;
  return `${stnAbbr} ${houNumber} (${parseInt(m)}/${parseInt(d)} ${hh}:${mm})`;
}
```

---

## 3. 푸시 양식 9가지

### 케이스 ① — 자식해역 단독 발효 (P2)

```
🆕 자식해역 단독 발효
제주 제05-42호 (5/16 14:30) 풍랑주의보 발효
제주도서부앞바다(북서연안바다) — 부모와 별개로 단독 발효
```

- **category**: `subregion_p2_solo_active`
- **severity**: MEDIUM
- **빈도 제어**: 1시간 (key: category + reportId)
- **딥링크**: `/?openAdmin=collectTest&stn=184&reportId=met:202605161430:42`

### 케이스 ② — 자식해역 EXCLUDED 처리 (P1)

```
⊘ 자식해역 제외 처리
제주 제05-35호 (5/16 12:00) 풍랑주의보 발효
제주도서부앞바다(가파도연안바다 제외) — 가파도는 미발효
```

- **category**: `subregion_p1_excluded`
- **severity**: LOW
- **빈도 제어**: 6시간 (key: category + parent + child)

### 케이스 ③ — AI ↔ 정규식 결과 불일치

```
⚠️ 자식해역 추출 불일치 — 검토 필요
제주 제05-21호 (5/16 10:00) 풍랑주의보
제주도서부앞바다 — AI: 북서·남서 / 정규식: 북서만
정규식 결과로 반영. 어드민 검토 부탁
```

- **category**: `subregion_cross_check_mismatch`
- **severity**: MEDIUM
- **빈도 제어**: 즉시 발송 (매 사례)

### 케이스 ④ — 사용자 원칙 위반 (자동 보정)

```
❌ 데이터 원칙 위반 — 자동 보정
제주 제05-19호 (5/16 09:00) 풍랑주의보
부모해역(제주도서부앞바다) 없이 자식(북서연안바다)
단독 발효 시도 — 자동 보정 적용
```

- **category**: `subregion_principle_violation`
- **severity**: HIGH
- **빈도 제어**: 즉시

### 케이스 ⑤ — 자식해역 파서 실패

```
🐛 자식해역 파서 실패
제주 제05-15호 (5/16 08:00) — 본문에 자식해역
명시 있으나 AI·정규식 모두 추출 실패
패턴 비정상. 즉시 검토 필요
```

- **category**: `subregion_parser_failure`
- **severity**: HIGH
- **빈도 제어**: 즉시
- **딥링크**: `/?openAdmin=collectError`

### 케이스 ⑥ — 신규 자식해역 명칭 감지

```
🆕 신규 자식해역 명칭 감지 — 카탈로그 갱신 검토
제주 제05-30호 (5/16 13:00) — "○○○연안바다"
명칭 등장 (현재 25개 카탈로그에 없음)
empty_tree.json·mappings.js 추가 검토 필요
```

- **category**: `subregion_unknown_name`
- **severity**: HIGH
- **빈도 제어**: 1일 (key: category + detectedChildName)

### 케이스 ⑦ — 예비특보 자연어 해제 (방식 A)

```
📩 예비특보 취소 확인 요청
예비 제05-18호 (5/16 11:00) — 제주도산지 호우
예비특보 / "발표 가능성이 낮아져 해제"
어드민 확인 후 적용
```

- **category**: `subregion_prelim_natural_cancel`
- **severity**: HIGH
- **빈도 제어**: 1시간 (key: category + reportId)
- **딥링크**: `/?openAdmin=reviewNeeded&category=prelim_natural_cancel`

### 케이스 ⑧ — 시각 단조성 위반

```
⏪ 시각 갱신 이상
제주 제05-50호 (5/16 20:00) — 북서연안바다
이전 22:00 (정확형) → 새 밤(21~24시) (범위형)
시간상 뒤로 가는 갱신. 검토 필요
```

- **category**: `subregion_time_monotonicity`
- **severity**: MEDIUM
- **빈도 제어**: 1시간 (key: category + reportId + childRegion)

### 케이스 ⑨ (선택) — 자식해역 정상 수집 완료

```
✅ 자식해역 수집 완료
제주 제05-39호 (5/16 14:00) 풍랑주의보 발효
제주도서부앞바다 / 발효 자식: 북서·남서
제외 자식: 가파도
```

- **category**: `subregion_collected_ok`
- **severity**: LOW
- **빈도 제어**: 사용자 설정 (기본 OFF)

---

## 4. 카테고리·딥링크·자동처리 매트릭스

| # | category | severity | 자동 처리 | 어드민 진입 위치 |
|---|---|---|---|---|
| ① | `subregion_p2_solo_active` | MEDIUM | ✅ 자동 반영 | 특보 수집 테스트 |
| ② | `subregion_p1_excluded` | LOW | ✅ 자동 반영 | 특보 수집 테스트 |
| ③ | `subregion_cross_check_mismatch` | MEDIUM | ⚠️ 정규식 반영 | 특보 수집 테스트 |
| ④ | `subregion_principle_violation` | HIGH | ⚠️ 강제 보정 | 특보 수집 테스트 |
| ⑤ | `subregion_parser_failure` | HIGH | ❌ 미반영 | 특보 수집 오류 |
| ⑥ | `subregion_unknown_name` | HIGH | ❌ 미반영 | 특보 수집 오류 |
| ⑦ | `subregion_prelim_natural_cancel` | HIGH | ❌ 어드민 확인 후 | 검토 필요 |
| ⑧ | `subregion_time_monotonicity` | MEDIUM | ✅ 자동 반영 | 특보 수집 테스트 |
| ⑨ | `subregion_collected_ok` | LOW | ✅ 자동 반영 | 특보 수집 테스트 |

---

## 5. 페이로드 표준 구조

```javascript
sendAdminPush(
  title,    // 한 줄, 아이콘 + 케이스 종류
  body,     // 사람 친화 통보문 식별 + 핵심 변화 (2~3줄)
  {
    url: 'https://seagnal-server.fly.dev/?openAdmin={타깃탭}&...',
    category: 'subregion_xxx',
    severity: 'HIGH | MEDIUM | LOW',
    reportId: 'met:...',
    parentRegion: '제주도서부앞바다',
    childRegion: '북서연안바다',
    stn: 184,
    diffType: '...',
    occurredAt: '2026-05-16T16:30:00+09:00',
    // 케이스별 추가 필드
  }
)
```

---

## 6. 어드민 탭 카운트 확장

기존 어드민 패널에 자식해역 카운트 추가:

```
[검토 필요⓹] [재시도 중⓪] [수집 실패②] [자식해역⓻]   ← 신규
```

자식해역 탭에는 미확인 케이스 (②~⑧) 의 모든 알림 누적 표시.

---

## 7. 코드 변경 위치

| 파일 | 변경 |
|---|---|
| `local_server/services/admin_push.js` | 변경 없음 (기존 sendAdminPush 그대로 사용) |
| `local_server/subregion_parser.js` (신규) | 9가지 케이스 감지 + sendAdminPush 호출 |
| `local_server/subregion_cross_check.js` (신규) | Dual Validation 결과에 따른 케이스 ③ 발송 |
| `local_server/data/admin_push_throttle.json` | 빈도 제어 상태 영속화 (신규 파일) |
| `local_server/js/admin.js` | 자식해역 탭 카운트 추가 |
