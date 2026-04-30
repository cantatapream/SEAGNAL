# 자식해역 특보 표출 — 3.6 index1 / index2 분리 전략

## 0. 본 파일의 위치

본 파일은 `03_OPERATIONS/` 시리즈의 여섯 번째 파일이며, 본 작업의 자식해역 표출 기능을 **index1에만 도입하고 index2(운영)에는 영향을 주지 않도록** 분리하는 전략을 정리합니다.

---

## 1. 현재 index 페이지 구조

### 1.1 두 페이지의 역할

| 페이지 | 역할 |
|---|---|
| `index2.html` | **현재 사용자 운영용**. 기본 진입점 (`/`) |
| `index.html` (index1) | 테스트/관리자 진입용. URL 직접 접근 (`/index.html`) |

### 1.2 라우팅

```
GET /              → index2.html (routes/health.js:33-40)
GET /index.html    → index.html (express.static 직접 서빙)
GET /index2.html   → index2.html (express.static 직접 서빙)
```

### 1.3 페이지 식별 플래그

| 페이지 | 플래그 |
|---|---|
| index2 | `<script>window.__SEAGNAL_PAGE = 'index2';</script>` (line 886) |
| index1 | (현재 플래그 없음) |

---

## 2. 현재 공유 자원 / 분리 자원 정리

### 2.1 거의 모든 자원이 공유됨

- 거의 모든 JS 파일 (core 라이브러리, 어드민, 프로모, 서핑 등)
- 거의 모든 CSS 파일
- 모든 백엔드 API 엔드포인트
- 모든 데이터 파일

### 2.2 이미 분리된 자원

#### index1 전용
- 구버전 CCTV 6모듈 (`cctv1.js` ~ `cctv6.js`)
- Tide 섹션 일부

#### index2 전용
- ocean comprehensive map 관련 모듈
- `marine_chart1.js` ~ `marine_chart5.js`
- `ocean_warn_active1.js` ~ `ocean_warn_active5.js`
- `ocean_buoy.js`, `ocean_warn_zone.js`, `ocean_cctv.js`
- `index2_patch.js` (index2 전용 레이아웃 패치)

### 2.3 기존 분기 패턴

이미 코드에 `window.__SEAGNAL_PAGE === 'index2'` 분기가 존재합니다.

- 예: `ocean_map.js:218,766` — index2에서만 ocean map 렌더
- 예: `ocean_cctv.js:43` — index2가 아니면 즉시 return

본 작업은 이 패턴을 그대로 따라갑니다.

---

## 3. 분리 전략 (5단계)

### 3.1 Step 1 — index1에 페이지 식별 플래그 추가

```html
<!-- index.html 상단 추가 -->
<script>window.__SEAGNAL_PAGE = 'index1';</script>
```

이로써 모든 JS에서 페이지 식별 가능.

### 3.2 Step 2 — 페이지별 기능 플래그 파일 생성

```
local_server/data/
  ├── index1_features.json
  └── index2_features.json
```

내용:

```json
// index1_features.json
{
  "방재기상_자식해역": true
}

// index2_features.json
{
  "방재기상_자식해역": false
}
```

### 3.3 Step 3 — 백엔드에 기능 조회 API 추가

```
GET /api/config/features?page=index1

응답:
{
  "방재기상_자식해역": true
}
```

구현:

```javascript
// local_server/routes/config.js (신규)
router.get('/api/config/features', (req, res) => {
  const page = req.query.page || 'index2'
  const file = `${page}_features.json`
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))
  res.json(data)
})
```

### 3.4 Step 4 — 프론트엔드 기능 플래그 로드

```javascript
// local_server/js/config.js 또는 적절한 위치
async function loadFeatures() {
  const page = window.__SEAGNAL_PAGE || 'index2'
  const response = await fetch(`/api/config/features?page=${page}`)
  window.SEAGNAL_FEATURES = await response.json()
}

// 페이지 로드 시 호출
loadFeatures()
```

### 3.5 Step 5 — 신규 자식해역 모듈에 가드 추가

```javascript
// 신규 자식해역 표출 모듈 시작 부분
if (window.__SEAGNAL_PAGE !== 'index1') return  // index2엔 동작 안 함
if (!window.SEAGNAL_FEATURES?.방재기상_자식해역) return  // 플래그 OFF면 동작 안 함

// 정상 동작
...
```

---

## 4. 데이터 파일 분리

### 4.1 신규 데이터 파일은 처음부터 분리

본 작업의 신규 데이터 파일은 운영(index2)과 테스트(index1)를 분리:

- `subregion_lifecycle.json` (운영용, 향후 index2 도입 시)
- `subregion_lifecycle_test.json` (테스트용, index1 전용)

### 4.2 매핑 테이블과 오류 로그는 공유

다음은 페이지에 무관하므로 단일 파일 사용:

- `region_alias_map.json` (공유)
- `subregion_error_log.json` (공유)

### 4.3 데이터 파일 선택 함수

```javascript
function getSubregionLifecycleFile(page) {
  return page === 'index1' ? 'subregion_lifecycle_test.json' : 'subregion_lifecycle.json'
}
```

---

## 5. 스케줄러 처리

### 5.1 단일 스케줄러 + 두 데이터 파일

스케줄러는 1개로 운영하되, 두 데이터 파일을 같이 갱신:

- 매 1분 사이클마다 방재기상 폴링 1회
- 결과를 두 파일에 모두 영속화 (또는 1차 도입에서는 test 파일만)

### 5.2 1차 도입 권장

본 작업의 1차 도입에서는 다음 권장:

- 스케줄러가 자식해역 처리를 수행하되, 결과는 **`subregion_lifecycle_test.json`에만 저장**
- 운영(`subregion_lifecycle.json`)은 충분 검증 후 활성화
- index1만 테스트 파일을 읽음

### 5.3 함수 형태

```
function persistResult(state, page):
  file = getSubregionLifecycleFile(page)
  atomicWriteJson(file, state)

# 1차 도입에서는 test만
runStep3()
persistResult(state, 'index1')  # test 파일에만 저장

# 안정화 후 운영도 활성화
persistResult(state, 'index1')
persistResult(state, 'index2')  # 향후 운영 활성화 시
```

---

## 6. 신규 백엔드 API의 페이지 분기

### 6.1 자식해역 데이터 조회 API

```
GET /api/subregion/state?page=index1

응답: subregion_lifecycle_test.json 내용
```

또는

```
GET /api/subregion/state?page=index2

응답: subregion_lifecycle.json 내용 (운영 활성화 시)
```

### 6.2 구현 예시

```javascript
router.get('/api/subregion/state', (req, res) => {
  const page = req.query.page || 'index2'
  const file = getSubregionLifecycleFile(page)
  const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'))
  res.json(data)
})
```

---

## 7. 관리자 푸시 / UI는 공유

### 7.1 자식해역 오류는 페이지 무관

오류 처리는 페이지(index1/index2) 무관하게 발생할 수 있으므로:

- 오류 로그 파일은 단일 (`subregion_error_log.json`)
- 관리자 푸시도 단일 시스템
- 통합관리자 센터 UI도 양쪽 페이지에서 모두 보임

### 7.2 페이지 식별자 추가 (선택)

오류 로그에 페이지 식별자를 추가하여 어느 페이지에서 발생한 오류인지 추적 가능하게 할 수 있습니다. 본 작업의 1차 범위에서는 미포함.

---

## 8. 분리 검증 방법

### 8.1 검증 항목

본 작업 도입 후 다음 항목을 확인하여 분리 정상 동작 확인:

- index2 접속 시 자식해역 정보 표시 안 됨 (직전 동작 그대로)
- index1 접속 시 자식해역 정보 표시됨 (신규 기능)
- index2의 데이터 파일은 변경 안 됨
- 양쪽 페이지의 다른 기능들은 모두 정상 동작

### 8.2 검증 절차

```
1. 본 작업 적용 전 index2 화면 스크린샷 저장
2. 본 작업 적용
3. index2 접속 → 화면이 동일한지 확인
4. index1 접속 → 자식해역 정보 표시되는지 확인
5. 데이터 파일 (weather_alerts.json 등) 변경 없음 확인
6. 운영 로그에 비정상 사항 없음 확인
```

### 8.3 운영 모니터링

분리 도입 후 며칠간 운영 모니터링하여 다음 확인:

- 자식해역 매핑 누락 빈도 (전수조사 정확도 검증)
- 캡 적용 빈도 (방재기상 사전 격상 빈도)
- 동시 사라짐 잠금 빈도
- 푸시 알림 양

---

## 9. 향후 index2 도입 시

### 9.1 도입 절차

index1에서 충분히 검증한 후 index2에 도입할 때:

```
1. index2_features.json의 방재기상_자식해역 = true 변경
2. subregion_lifecycle_test.json → subregion_lifecycle.json 또는 데이터 마이그레이션
3. 백엔드 API의 페이지 분기를 단순화 (양쪽 모두 같은 파일 사용)
4. 운영 모니터링
```

### 9.2 롤백

문제 발생 시 즉시 롤백:

```
1. index2_features.json의 방재기상_자식해역 = false 복원
2. 코드 변경 없이 즉시 비활성화
```

플래그 기반 분리이므로 롤백이 빠르고 안전합니다.

---

## 10. 본 파일 다음 작업

- 다음 파일: `07_stale_safeguard.md`
- 주제: 24시간 stale 안전장치 (통보문 시스템 점검 신호)
