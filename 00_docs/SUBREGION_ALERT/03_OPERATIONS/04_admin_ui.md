# 자식해역 특보 표출 — 3.4 통합관리자 센터 UI

## 0. 본 파일의 위치

본 파일은 `03_OPERATIONS/` 시리즈의 네 번째 파일이며, 통합관리자 센터에 추가될 자식해역 오류 영역 UI를 정리합니다.

---

## 1. 통합관리자 센터의 기존 구조

### 1.1 기존 탭 구조

```
통합관리자 센터
└── 특보 알림 탭
    ├── 실시간 특보 알림 관리
    ├── 특보 수집 테스트
    ├── 특보 수집 오류  ← 신규 영역이 여기에 추가됨
    │   ├── 검토 필요 (기존)
    │   ├── 재시도 중 (기존)
    │   ├── 수집 실패 (기존)
    │   └── 자식해역 관련 오류 (신규) ← 추가
    └── 특보 수정
```

### 1.2 코드 위치

| 컴포넌트 | 위치 |
|---|---|
| 메인 렌더 함수 | `local_server/js/admin.js:2240` `renderUnifiedAlertContent()` |
| 오류 탭 렌더 | `local_server/js/admin.js:472-702` `renderErrorListTab()` |
| 서브탭 전환 | `local_server/js/admin.js:705-710` |
| HTML 마운트 | `local_server/index.html` |

---

## 2. 신규 서브탭 추가 — "자식해역 관련 오류"

### 2.1 위치

특보수집오류 탭 안의 4번째 서브탭으로 추가.

### 2.2 데이터 소스

`subregion_error_log.json` 파일.

### 2.3 표시 항목

각 오류 항목별로 다음 정보 표시:

- 오류 유형 (한글)
- 발생 시각 (서술형: "2026년 04월 30일 22시 05분")
- 평문 서술 (`narrativeDescription`)
- 조치 안내 (`actionRequired`)
- 누적 횟수 (`occurrenceCount`)
- 마지막 발생 시각 (`lastOccurredAt`)
- 확인 여부 (`acknowledged`)
- 개발자 정보 (`developerInfo`) — 접기/펼치기 가능

---

## 3. UI 와이어프레임

### 3.1 메인 화면

```
┌──────────────────────────────────────────────────────────────┐
│ 자식해역 관련 오류                                            │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 미확인 오류: 5  |  전체: 12  |  유형별 통계 ▼            │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ [필터: 전체 | 미확인 | 매핑 누락 | 응답 오류 | ...]          │
│                                                              │
│ ─────────────────────────────────────────────────────────── │
│ ⓘ 매핑 누락                                          [미확인]│
│ 2026년 04월 30일 22시 05분 발생                              │
│ 누적 3회 발생, 마지막 22시 05분                              │
│                                                              │
│ 방재기상시스템에서 받은 자식해역 'S2999900 (○○평수구)'에   │
│ 대해 우리 앱의 매핑 테이블에 등록된 이름이 없습니다.         │
│                                                              │
│ [조치] region_alias_map.json 파일에 이 해역을 추가해주세요.  │
│                                                              │
│ ▶ 개발자 정보                                                │
│ [확인 완료]                                                  │
│ ─────────────────────────────────────────────────────────── │
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 개발자 정보 펼친 모습

```
▼ 개발자 정보
  function: lookupAppName
  file: local_server/services/subregion_judge.js:142
  afsoRegId: S2999900
  afsoRegKo: ○○평수구
  parentRegId: S1131000
  wrnTp: 풍랑
  wrnLvl: 2
```

---

## 4. 신규 함수 (프론트엔드)

### 4.1 메인 렌더 함수

```javascript
function renderSubregionErrorTab() {
  // local_server/js/admin.js에 추가 예정

  fetch('/api/admin/subregion-errors')
    .then(r => r.json())
    .then(errors => {
      const container = document.getElementById('subregion-error-tab')
      container.innerHTML = renderErrorList(errors)
    })
}

function renderErrorList(errorLog) {
  const stats = renderStats(errorLog.stats)
  const filter = renderFilter()
  const items = errorLog.errors.map(renderErrorItem).join('')

  return `
    ${stats}
    ${filter}
    <div class="error-list">${items}</div>
  `
}

function renderErrorItem(error) {
  return `
    <div class="error-item ${error.acknowledged ? 'acked' : 'unacked'}">
      <div class="header">
        <span class="type">${getErrorTypeKorean(error.errorType)}</span>
        <span class="status">${error.acknowledged ? '확인됨' : '미확인'}</span>
      </div>
      <div class="time">${formatKoreanDate(error.occurredAt)} 발생</div>
      <div class="count">누적 ${error.occurrenceCount}회 발생, 마지막 ${formatKoreanDate(error.lastOccurredAt)}</div>
      <div class="narrative">${escapeHtml(error.narrativeDescription)}</div>
      <div class="action">[조치] ${escapeHtml(error.actionRequired)}</div>
      <details>
        <summary>개발자 정보</summary>
        <pre>${formatDeveloperInfo(error.developerInfo)}</pre>
      </details>
      ${error.acknowledged ? '' : `<button onclick="acknowledgeError('${error.id}')">확인 완료</button>`}
    </div>
  `
}
```

### 4.2 확인 처리 함수

```javascript
function acknowledgeError(errorId) {
  fetch('/api/admin/subregion-errors/acknowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ errorId, adminId: getCurrentAdminId() })
  })
  .then(() => renderSubregionErrorTab())  // 화면 갱신
}

function acknowledgeAllErrors() {
  if (!confirm('모든 미확인 오류를 확인 완료 처리하시겠습니까?')) return

  fetch('/api/admin/subregion-errors/acknowledge-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId: getCurrentAdminId() })
  })
  .then(() => renderSubregionErrorTab())
}
```

---

## 5. 신규 백엔드 API

### 5.1 오류 목록 조회

```
GET /api/admin/subregion-errors

응답:
{
  "schema_version": "1.0",
  "lastUpdated": "...",
  "errors": [ ... ],
  "stats": {
    "totalErrors": 12,
    "unacknowledged": 5,
    "byType": { ... }
  }
}
```

구현 예시:

```javascript
// local_server/routes/admin.js에 추가

router.get('/api/admin/subregion-errors', (req, res) => {
  const filePath = path.join(DATA_DIR, 'subregion_error_log.json')
  if (!fs.existsSync(filePath)) {
    return res.json({ errors: [], stats: { totalErrors: 0 } })
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  res.json(data)
})
```

### 5.2 개별 오류 확인 처리

```
POST /api/admin/subregion-errors/acknowledge
Body: { errorId: "err_...", adminId: "..." }

응답: { success: true }
```

구현 예시:

```javascript
router.post('/api/admin/subregion-errors/acknowledge', (req, res) => {
  const { errorId, adminId } = req.body
  const filePath = path.join(DATA_DIR, 'subregion_error_log.json')
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))

  const error = data.errors.find(e => e.id === errorId)
  if (!error) {
    return res.status(404).json({ error: 'Not found' })
  }

  error.acknowledged = true
  error.acknowledgedAt = new Date().toISOString()
  error.acknowledgedBy = adminId

  atomicWriteJson(filePath, data)
  res.json({ success: true })
})
```

### 5.3 모두 확인 처리

```
POST /api/admin/subregion-errors/acknowledge-all
Body: { adminId: "..." }

응답: { success: true, acknowledgedCount: N }
```

### 5.4 물리 삭제 API 미제공

본 작업의 사용자 정책상 **삭제 API는 만들지 않습니다**. 따라서 다음과 같은 엔드포인트는 추가하지 않음:

```
DELETE /api/admin/subregion-errors/{errorId}  ← 미제공
DELETE /api/admin/subregion-errors            ← 미제공
```

---

## 6. UI 표시 정책

### 6.1 미확인 오류 강조

미확인 오류는 시각적으로 명확히 강조:

- 빨강 또는 노랑 색상
- "미확인" 라벨
- 상단 카운트에서 미확인 수 표시

### 6.2 확인된 오류

확인된 오류는 시각적으로 약화:

- 회색 톤
- "확인됨" 라벨
- 별도 필터로 숨김 가능

### 6.3 누적 카운트 강조

같은 오류가 반복 발생 시 누적 카운트가 크면 강조:

- 5회 이상: 노란 배경
- 20회 이상: 빨간 배경
- 카운트만으로도 빈도 파악 가능

---

## 7. 통계 표시

### 7.1 상단 통계 영역

오류 탭 상단에 다음 정보 표시:

- 미확인 오류 수
- 전체 오류 수
- 유형별 분포 (드롭다운으로 펼치기)

### 7.2 통계 데이터 소스

`subregion_error_log.json`의 `stats` 섹션. 파일 갱신 시 stats도 함께 갱신됨.

### 7.3 통계 갱신 함수

```javascript
function computeStats(errors) {
  const byType = {}
  let unacknowledged = 0

  for (const e of errors) {
    byType[e.errorType] = (byType[e.errorType] || 0) + 1
    if (!e.acknowledged) unacknowledged++
  }

  return {
    totalErrors: errors.length,
    unacknowledged: unacknowledged,
    byType: byType
  }
}
```

---

## 8. UI 자동 갱신

### 8.1 갱신 정책

- 페이지 로드 시 1회 갱신
- 30초마다 자동 폴링 갱신 (선택)
- 또는 푸시 도착 시 즉시 갱신 (Service Worker 메시지 활용)

### 8.2 폴링 갱신

```javascript
let subregionErrorPoller = null

function startPolling() {
  subregionErrorPoller = setInterval(renderSubregionErrorTab, 30000)
}

function stopPolling() {
  clearInterval(subregionErrorPoller)
}
```

---

## 9. UI 코드 위치 (예상)

```
local_server/js/admin.js
  - 추가 함수: renderSubregionErrorTab(), renderErrorList(), renderErrorItem() 등

local_server/routes/admin.js
  - 추가 엔드포인트: GET /api/admin/subregion-errors,
                    POST /api/admin/subregion-errors/acknowledge,
                    POST /api/admin/subregion-errors/acknowledge-all
```

---

## 10. 본 파일 다음 작업

- 다음 파일: `05_log_format.md`
- 주제: 로그 형식 (개발자용 + 서술형)
