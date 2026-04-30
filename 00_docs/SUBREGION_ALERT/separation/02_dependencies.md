# index1/index2 분리 분석 — 2. 의존성 / 맞물림 핫스팟

## 0. 본 파일의 목적

본 파일은 **index1 변경이 index2 운영에 영향을 미칠 수 있는 모든 경로**를 분석합니다. 분리 작업 시 어떤 부분을 건드리면 안 되는지, 어떤 부분에 가드를 두어야 하는지 식별하는 것이 목적입니다.

---

## 1. 의존성의 계층 구조

본 작업에서 두 페이지가 만나는 지점은 다음 계층 구조를 가집니다:

```
[Layer 1] HTML/DOM 구조 (페이지별 별도)
    ↓
[Layer 2] 프론트엔드 JS (대부분 공유, 일부 분기)
    ↓
[Layer 3] 백엔드 API (모두 공유)
    ↓
[Layer 4] 데이터 파일 (대부분 공유, testMode로 일부 격리 가능)
    ↓
[Layer 5] 스케줄러/크롤러 (모두 공유)
```

→ **위로 갈수록 분리 가능, 아래로 갈수록 공유 강제**.

본 작업은 Layer 1-2에서 분리하고, Layer 3-5는 신규 자원을 추가하되 기존 운영 자원은 건드리지 않는 전략을 채택합니다.

---

## 2. 프론트엔드 핫스팟 (위험도 순)

### 2.1 가장 위험 — `js/index2_patch.js` (1019줄)

- **역할**: index2의 모든 UI/탭 동작을 마스터 패치 (line 29-1019 전체가 패치 본체)
- **위험**: index2의 거의 모든 UI 동작을 감싸고 있음. 만약 본 작업이 공유 JS(예: `marine.js`의 `switchMainTab()`)를 변경하면 이 패치가 영향받음
- **본 작업 영향**: 본 작업은 신규 모듈만 추가하므로 직접 영향 없음. 단, 공유 JS를 수정하지 말 것

### 2.2 두 번째 — `seaZones.js`의 부이 모달 (line 1981-2243)

- **역할**: 부이 정보 팝업 렌더링 (양 페이지 공유)
- **분기**: line 1983, 2243에서 `=== 'index2'` 조건으로 크기/폰트만 다르게
- **위험**: 팝업 DOM 구조 자체를 바꾸면 양쪽 모두 영향
- **본 작업 영향**: 본 작업은 부이 관련이 없으므로 영향 없음

### 2.3 세 번째 — `js/render.js`의 알림 카드 (line 1054, 1100)

- **역할**: 부모해역 알림 카드를 화면에 그림
- **분기**: line 1100에서 index2일 때 4번째 버튼("종합정보") 추가, 카드 폭 자동 조정
- **위험**: 카드 DOM 구조 변경 시 양쪽 모두 영향
- **본 작업 영향**: 자식해역 표출이 부모 알림 카드 안에 들어가는 경우 영향. 별도 섹션으로 분리하면 영향 없음

### 2.4 네 번째 — `marine.js`의 `switchMainTab()` 함수

- **역할**: 메인 탭 전환 로직 (양 페이지 공유)
- **위험**: index2_patch.js가 이 함수를 override함. 본 작업이 새 탭을 추가할 때 이 함수와 충돌 가능
- **본 작업 영향**: 자식해역을 별도 탭으로 만들 경우 신중한 등록 필요

### 2.5 그 외 — DOM ID 충돌

양 페이지에 같은 ID가 존재하는 섹션:
- `#weather-alert-section`, `#sea-zone-section`, `#typhoon-section`
- `#promo-section`, `#fishing-section`, `#sea-parting-section`

→ JS가 이 ID를 통해 접근할 때 양 페이지에서 동작.
→ 본 작업은 신규 섹션 ID(`#subregion-section` 등)를 사용하여 충돌 회피.

---

## 3. 백엔드 핫스팟

### 3.1 가장 위험 — `weather_alerts.json` 공유

- **위치**: `local_server/data/weather_alerts.json` (86KB)
- **갱신**: `weather_alerts_crawler.js`가 1분마다 갱신
- **읽기**: `routes/weather.js:52`, `js/data.js`, 양쪽 페이지 모두
- **위험**: 본 작업이 이 파일을 변경하면 index2 운영에 직접 영향
- **본 작업 정책**: **이 파일 절대 변경 안 함**. 자식해역 데이터는 별도 파일에 저장

### 3.2 두 번째 — `active_lifecycle.json` 공유

- **위치**: `local_server/data/active_lifecycle.json` (60KB)
- **역할**: 발효 라이프사이클 상태
- **위험**: 위와 동일
- **본 작업 정책**: 이 파일도 변경 안 함. 자식해역 라이프사이클은 `subregion_lifecycle.json`에 별도 저장

### 3.3 세 번째 — `scheduler.js` 1분 주기 잡

- **위치**: `scheduler.js:1373` `setInterval(..., 60000)`
- **역할**: weatherAlertsCrawler.run() 매분 호출
- **위험**: 본 작업의 방재기상 폴링도 같은 1분 주기로 돌아야 함. 같은 setInterval에 추가할지, 별도 setInterval로 둘지 결정 필요
- **본 작업 정책**: 같은 1분 주기에 통보문 다음에 방재기상 폴링 순차 실행

### 3.4 네 번째 — `routes/admin.js`의 testMode 패턴

- **위치**: `routes/admin.js:53` `TEST_ALERTS_FILE`, `:60-62` `getOutputFile(testMode)`
- **역할**: 테스트 모드 시 별도 파일에 쓰기
- **본 작업 활용**: 같은 패턴으로 `subregion_lifecycle.json` ↔ `subregion_lifecycle_test.json` 분기 가능

### 3.5 다섯 번째 — `services/admin_push.js`

- **위치**: `services/admin_push.js:28-94` `sendAdminPush()`
- **역할**: 관리자 FCM 푸시
- **본 작업 활용**: 자식해역 오류 발생 시 이 함수 호출. 별도 푸시 시스템 만들지 않음

---

## 4. 변경 영향 흐름 분석 (10가지 시나리오)

### 시나리오 1 — 공유 JS 파일 변경 시
- 예: `js/render.js`의 함수 시그니처 변경
- **영향**: 양 페이지 모두 즉시 영향
- **회피 방법**: 공유 JS 파일은 본 작업에서 직접 수정 안 함

### 시나리오 2 — 신규 JS 파일 추가 시
- 예: `js/subregion_display.js` 신규 추가
- **영향**: HTML에서 로드한 페이지에만 영향
- **회피 방법**: index1.html에만 `<script>` 태그 추가, 파일 자체 시작에 페이지 플래그 가드

### 시나리오 3 — 공유 데이터 파일 변경 시
- 예: `weather_alerts.json` 스키마 변경
- **영향**: 매우 위험. 모든 사용처에 영향
- **회피 방법**: 본 작업에서 절대 변경 안 함

### 시나리오 4 — 신규 데이터 파일 추가 시
- 예: `subregion_lifecycle.json` 신규 추가
- **영향**: 그 파일을 읽는 코드에만 영향
- **회피 방법**: 신규 파일은 신규 코드에서만 사용, 기존 코드 수정 없음

### 시나리오 5 — 공유 API 라우트 동작 변경 시
- 예: `/api/weather-alerts`에 응답 필드 추가
- **영향**: 양 페이지의 클라이언트 모두 영향
- **회피 방법**: 본 작업에서 기존 라우트 수정 안 함, 신규 라우트만 추가

### 시나리오 6 — 신규 API 라우트 추가 시
- 예: `/api/subregion/state` 신규 추가
- **영향**: 그 라우트를 호출하는 클라이언트만 영향 (없으면 영향 없음)
- **회피 방법**: 신규 라우트는 index1 클라이언트만 호출, index2 클라이언트는 호출 안 함

### 시나리오 7 — 스케줄러 신규 잡 추가 시
- 예: 방재기상 폴링 잡 추가
- **영향**: 백그라운드 처리만 영향, 페이지 무관
- **회피 방법**: 데이터 파일을 신규 파일로 분리하면 운영 데이터 영향 없음

### 시나리오 8 — index2.html 직접 수정 시
- **영향**: index2만 영향
- **회피 방법**: 본 작업은 index2.html을 수정하지 않음

### 시나리오 9 — index.html(index1) 직접 수정 시
- 예: 페이지 플래그 추가, 신규 섹션 추가, 신규 JS 로드
- **영향**: index1만 영향
- **본 작업의 핵심 작업 지점**

### 시나리오 10 — `style.css` 수정 시
- **영향**: 양 페이지 모두
- **회피 방법**: 본 작업의 자식해역 스타일은 별도 CSS 파일(`subregion.css`) 또는 인라인으로

---

## 5. 페이지 식별 플래그 동작 매트릭스

본 작업 적용 후 각 코드의 동작:

| 코드 | 현재 (index1 플래그 없음) | 본 작업 후 (index1='index1') |
|---|---|---|
| `=== 'index2'` 양성 검사 | index1: false → 동작 안 함 | 동일 |
| `!== 'index2'` 음성 검사 | index1: true → 동작함 | 동일 |
| `=== 'index1'` 양성 검사 | index1: false → 동작 안 함 | index1: true → 동작 |
| 플래그 미사용 | 양 페이지 모두 동작 | 동일 |

→ **현재 코드는 모두 그대로 동작**. 본 작업은 신규 `=== 'index1'` 검사만 추가.

---

## 6. 이론적 위험: index1 플래그 추가 시 부작용

### 6.1 영향 검증

`window.__SEAGNAL_PAGE = 'index1'` 추가 시 영향 받는 코드:

| 파일 | 줄 | 검사 | 영향 |
|---|---|---|---|
| `seaZones.js` | 1983 | `=== 'index2'` | 영향 없음 (false 그대로) |
| `seaZones.js` | 2243 | `=== 'index2'` | 영향 없음 |
| `js/render.js` | 1054, 1100 | `=== 'index2'` | 영향 없음 |
| `js/settings.js` | 48 | `=== 'index2'` | 영향 없음 |
| `js/windy.js` | 313, 560, 703 | `=== 'index2'` | 영향 없음 |
| `js/ocean_map.js` | 766 | `=== 'index2'` | 영향 없음 |
| `js/ocean_buoy.js` | 29, 500 | `=== 'index2'` | 영향 없음 |
| `js/ocean_cctv.js` | 43 | `!== 'index2'` | **이전: undefined !== 'index2' → true → return** / **이후: 'index1' !== 'index2' → true → return**. 동일 |
| `js/index2_patch.js` | 29, 1019 | `=== 'index2'` | 영향 없음 |
| `js/config.js` | 118 | `=== 'index2'` | 영향 없음 |

**결론**: 모든 기존 검사 결과가 변하지 않음. **index1 플래그 추가는 안전**.

### 6.2 단, 미래 코드를 위한 영향

신규 코드가 다음 형태로 작성될 경우 의도치 않은 분기 가능:

```javascript
// 위험: index1과 undefined를 같게 보지 않음
if (window.__SEAGNAL_PAGE === undefined) { ... }

// 안전: 명시적 'index2' 비교
if (window.__SEAGNAL_PAGE !== 'index2') { ... }

// 안전: 명시적 'index1' 비교
if (window.__SEAGNAL_PAGE === 'index1') { ... }
```

→ 본 작업의 신규 코드는 **명시적 비교만 사용**.

---

## 7. 데이터 파일 의존성 그래프

```
weather_alerts.json (공유, 절대 변경 X)
    ↓ 읽기
routes/weather.js → /api/weather-alerts
    ↓ 응답
js/data.js (양 페이지 모두)
    ↓ 처리
[부모해역 표출 — 양 페이지 모두 동일 동작]

subregion_lifecycle.json (신규, index1만 사용)
    ↓ 읽기
routes/subregion.js → /api/subregion/state
    ↓ 응답
js/subregion_display.js (index1만)
    ↓ 처리
[자식해역 표출 — index1만]
```

→ 두 흐름은 **데이터 파일/라우트/JS 모두 분리**. 교차점 없음.

---

## 8. 스케줄러 의존성 분석

본 작업의 신규 폴링이 기존 스케줄러에 추가될 때:

```javascript
// scheduler.js:1373 (현재)
setInterval(() => {
    weatherAlertsCrawler.run();  // 1분마다 통보문 크롤링
}, 60000);

// 본 작업 후 (제안)
setInterval(async () => {
    await weatherAlertsCrawler.run();           // 통보문 (기존)
    await afsoSubregionPoller.run();            // 방재기상 (신규, 통보문 다음에)
    await subregionJudge.runJudgement();        // 종합 판정 (신규)
}, 60000);
```

**위험 평가**:
- 통보문 크롤러가 실패해도 신규 폴링은 동작 (try/catch로 격리)
- 신규 폴링이 실패해도 통보문 크롤러는 영향 없음
- `await` 순차 실행으로 데이터 일관성 보장

---

## 9. 회피 가능한 의존성 vs 회피 불가능한 의존성

### 9.1 회피 가능 (분리 작업으로 해결)

- 프론트엔드 JS 페이지 분기 → 플래그 가드
- 데이터 파일 분리 → testMode 패턴
- API 분리 → 신규 라우트
- UI 섹션 분리 → 신규 ID/섹션

### 9.2 회피 불가능 (그대로 공유)

- Express 서버 자체 (한 프로세스)
- Node.js 메모리 공간
- 파일 시스템 (같은 디스크)
- 운영 환경 (같은 호스트)

→ 회피 불가 의존성에 대해서는 **각 컴포넌트의 try/catch 격리**, **자원 사용 최소화**로 영향 통제.

---

## 10. 다음 문서

- `03_risk_assessment.md` — 본 분석을 종합한 항목별 위험도 평가 + 분리 전략 권장
