# index1/index2 분리 분석 — 3. 위험도 평가 + 분리 전략 권장

## 0. 본 파일의 목적

이전 두 파일(`01_inventory.md`, `02_dependencies.md`)의 분석을 종합하여, 본 작업에서 실제로 수행할 분리 작업 항목과 그 위험도/우선순위를 정리합니다.

---

## 1. 분리 작업 항목 전체 목록

본 작업에서 수행해야 할 분리/추가 작업을 모두 정리합니다.

| # | 작업 | 영역 | 위험도 | 우선순위 |
|---|---|---|---|---|
| 1 | index1.html에 `__SEAGNAL_PAGE='index1'` 플래그 추가 | 프론트 | 매우 낮음 | 1 (최우선) |
| 2 | index1 신규 섹션 (`#subregion-section`) 추가 | 프론트 | 낮음 | 2 |
| 3 | 신규 JS 파일 `js/subregion_display.js` 추가 | 프론트 | 낮음 | 3 |
| 4 | 신규 CSS (별도 파일 또는 인라인) | 프론트 | 매우 낮음 | 4 |
| 5 | 신규 백엔드 라우트 `routes/subregion.js` | 백엔드 | 낮음 | 5 |
| 6 | 신규 데이터 파일 3개 (lifecycle/alias_map/error_log) | 데이터 | 낮음 | 6 |
| 7 | 방재기상 폴링 모듈 `services/afso_poller.js` | 백엔드 | 중간 | 7 |
| 8 | 종합 판정 모듈 `services/subregion_judge.js` | 백엔드 | 중간 | 8 |
| 9 | 스케줄러에 신규 잡 등록 | 백엔드 | 중간 | 9 |
| 10 | 클라우드 백업에 `region_alias_map.json` 추가 | 운영 | 매우 낮음 | 10 |
| 11 | 통합관리자 센터 자식해역 오류 영역 추가 | 프론트 | 낮음 | 11 |
| 12 | 관리자 푸시 통합 (기존 `admin_push.js` 재사용) | 백엔드 | 매우 낮음 | 12 |

---

## 2. 위험도 등급 정의

| 등급 | 정의 | 예시 |
|---|---|---|
| **매우 낮음** | 신규 파일/코드 추가, 기존 코드 무영향 | 새 JS 파일, 새 CSS 클래스 |
| **낮음** | 기존 파일에 신규 코드 한두 줄 추가, 분리 가드로 격리 | index1.html에 `<script>` 한 줄 |
| **중간** | 기존 코드의 분기 로직에 추가, 조심스러운 검증 필요 | 스케줄러 setInterval 안에 신규 호출 추가 |
| **높음** | 기존 공유 데이터 변경 위험 | weather_alerts.json 스키마 변경 |
| **매우 높음** | 기존 공유 함수/시그니처 변경 | render.js의 함수 시그니처 변경 |

본 작업의 모든 항목은 **중간 이하**입니다. 높음/매우 높음 작업은 본 작업 범위에서 제외.

---

## 3. 항목별 상세 평가

### 3.1 [작업 1] index1 페이지 플래그 추가

**작업 내용**:
```html
<!-- index.html 상단 <head> 안에 추가 -->
<script>window.__SEAGNAL_PAGE = 'index1';</script>
```

**위험 평가**:
- 모든 기존 코드가 `=== 'index2'` 양성 검사이므로 index1 플래그가 'index1'이든 undefined든 결과 동일 (false 유지)
- `js/ocean_cctv.js:43`의 `!== 'index2'` 검사도 결과 동일 (true 유지, return)
- **부작용 0**

**권장**: 즉시 추가. 본 작업의 첫 번째 작업.

### 3.2 [작업 2] 신규 섹션 추가

**작업 내용**:
```html
<!-- index.html의 weather-sub-tabs 안에 -->
<section id="subregion-section" class="tab-content" style="display:none;">
  <div id="subregion-list-container"></div>
</section>
```

**위험 평가**:
- 신규 ID이므로 기존 코드와 충돌 없음
- index2.html에는 추가하지 않으므로 index2 영향 없음
- 위험: index2_patch.js가 동적으로 모든 섹션을 순회하면 신규 섹션을 인식. **단, index1만 로드되므로 발생 안 함**

**권장**: 작업 1 다음에 진행.

### 3.3 [작업 3] 신규 JS 파일 추가

**작업 내용**:
```javascript
// js/subregion_display.js
(function() {
  if (window.__SEAGNAL_PAGE !== 'index1') return;  // 안전 가드

  // ... 자식해역 표출 로직
})();
```

**위험 평가**:
- 시작 시 페이지 가드로 다른 페이지에서 즉시 return
- index1.html에서만 `<script>` 태그로 로드
- 신규 글로벌 변수는 namespace로 보호 (`window.SubregionDisplay = {...}`)

**권장**: 작업 2 다음에 진행.

### 3.4 [작업 4] 신규 CSS

**작업 내용**:
- 신규 클래스 명명: `.subregion-*` 접두
- 기존 클래스(`.tab-content`, `.alert-card`)는 재사용 가능하되 override 안 함

**위험 평가**:
- CSS 클래스명이 충돌 없으면 영향 0
- `style.css`(공유) 수정은 양 페이지 영향이므로 신규 CSS는 별도 파일 또는 index1.html 인라인

**권장**: 별도 파일 `subregion.css` 추천. index1.html에서만 link.

### 3.5 [작업 5] 신규 백엔드 라우트

**작업 내용**:
```
GET  /api/subregion/state         → subregion_lifecycle.json 반환
GET  /api/subregion/error-log     → subregion_error_log.json 반환
POST /api/subregion/error-ack     → 오류 확인 처리
```

신규 파일: `local_server/routes/subregion.js`

**위험 평가**:
- 신규 라우트이므로 기존 라우트와 충돌 없음
- `/api/subregion/*` 경로는 기존에 사용되지 않는 prefix
- 인증 부재는 기존 정책과 동일

**권장**: 작업 3 후 백엔드 작업 시작 시 진행.

### 3.6 [작업 6] 신규 데이터 파일

**파일**:
- `data/subregion_lifecycle.json` 또는 `data/subregion_lifecycle_test.json` (testMode)
- `data/region_alias_map.json` (이미 audit/에서 작성, local_server/data/로 이동)
- `data/subregion_error_log.json`

**위험 평가**:
- 신규 파일이므로 기존 파일과 충돌 없음
- testMode 분기 패턴 재사용 (기존 `weather_alerts_test.json`과 동일)
- 원자적 쓰기 패턴 사용 (`atomicWriteJson`)

**권장**: 백엔드 라우트 작업과 함께 진행.

### 3.7 [작업 7] 방재기상 폴링 모듈

**작업 내용**:
```javascript
// services/afso_poller.js
async function pollAfso() {
  // 1. 방재기상 API 호출
  // 2. 응답 검증
  // 3. data/afso_raw/YYYY-MM-DDTHH-MM.json 보관 (선택)
  // 4. 결과 반환
}
module.exports = { pollAfso };
```

**위험 평가**:
- 신규 모듈, 기존 코드와 격리
- 외부 API 호출 실패 시 try/catch로 격리
- 메모리 사용은 응답 크기(~35KB)만큼 일시적

**권장**: 백엔드 작업 본격 시작 시.

### 3.8 [작업 8] 종합 판정 모듈

**작업 내용**:
```javascript
// services/subregion_judge.js
async function runJudgement(parentTongbomun, afsoResponse) {
  // LOGIC/14_rule_order.md의 9단계 처리
  // 1. 응답 건전성 검사
  // 2. 통보문 폴링 건전성
  // 3. 부모 자동 해제
  // 4. 행 분류
  // 5. 매핑 적용
  // 6. 캡 규칙
  // 7. 사라짐 카운트
  // 8. 동시 사라짐 잠금
  // 9. 영속화 + 표시 데이터
}
```

**위험 평가**:
- 신규 모듈
- 입력은 기존 통보문 결과(읽기만) + 신규 방재기상 응답
- 출력은 신규 데이터 파일 (`subregion_lifecycle.json`)
- 기존 데이터 파일 절대 수정 안 함

**권장**: 작업 7 후 진행.

### 3.9 [작업 9] 스케줄러 통합

**작업 내용**:
```javascript
// scheduler.js:1373 근처 수정 (1분 주기 setInterval 안)
setInterval(async () => {
  try {
    await weatherAlertsCrawler.run();        // 기존
  } catch (e) { console.error('[기존 크롤러 오류]', e); }

  // ===== 신규 추가 =====
  if (process.env.AFSO_ENABLED !== 'false') {
    try {
      const tongbomunResult = getCurrentTongbomunState();
      const afsoResult = await afsoPoller.pollAfso();
      await subregionJudge.runJudgement(tongbomunResult, afsoResult);
    } catch (e) { console.error('[자식해역 처리 오류]', e); }
  }
  // =====================
}, 60000);
```

**위험 평가**:
- 가장 신중해야 할 부분
- 신규 로직이 실패해도 기존 크롤러는 try/catch로 보호
- 기존 크롤러가 실패해도 신규 로직은 별도 try/catch로 격리
- 환경 변수 `AFSO_ENABLED=false`로 즉시 비활성화 가능

**권장**: 마지막 통합 단계. 신규 모듈들이 충분히 검증된 후 진행.

### 3.10 [작업 10] 클라우드 백업 추가

**작업 내용**:
```javascript
// cloud_backup.js:105 근처 targetFiles 배열에 추가
const targetFiles = [
  ..., // 기존
  'region_alias_map.json',  // 신규: 메타데이터 정적 파일
];
```

**위험 평가**:
- 단순 배열 추가
- 기존 백업 동작에 영향 없음

**권장**: 매우 낮은 위험. 작업 6과 함께 진행.

### 3.11 [작업 11] 통합관리자 센터 UI 추가

**작업 내용**:
- `js/admin.js`에 자식해역 오류 탭 렌더 함수 추가 (`renderSubregionErrorTab()`)
- 기존 패턴 (`renderErrorListTab`) 그대로 재활용

**위험 평가**:
- 기존 admin.js에 함수 추가 (기존 함수 변경 없음)
- 양 페이지에서 admin.js를 공유하므로 양쪽 모두 새 탭이 보일 수 있음
- **단, 자식해역 표출은 index1만이므로 자식해역 오류도 index1만 의미 있음**
- 운영자가 index2의 어드민 패널에서 자식해역 탭을 보아도 표시할 데이터 없음 → 영향 미미

**권장**: 자식해역 오류 영역만 페이지 가드 또는 양쪽 동작 허용. 사용자 판단.

### 3.12 [작업 12] 관리자 푸시 통합

**작업 내용**:
- `services/admin_push.js`의 `sendAdminPush()` 그대로 호출
- 별도 모듈/파일 생성 없음

**위험 평가**:
- 기존 함수 호출만, 매우 안전
- FCM 토큰 풀이 동일 (admin_devices.json)
- 푸시 빈도 제어 정책으로 스팸 방지

**권장**: 매우 낮은 위험.

---

## 4. 분리 작업 권장 순서

총 12개 작업의 권장 실행 순서:

```
[1단계] 분리 인프라 구축
  1. index1 페이지 플래그 추가
  2. 신규 섹션 (subregion-section) HTML 추가
  4. 신규 CSS 파일 또는 인라인 스타일 준비

[2단계] 데이터 파일 준비
  6. 신규 데이터 파일 3개 (빈 파일 또는 audit/region_alias_map.json 복사)
  10. 클라우드 백업 대상 추가

[3단계] 백엔드 모듈 작성
  7. afso_poller.js 작성
  8. subregion_judge.js 작성
  5. routes/subregion.js 작성

[4단계] 프론트엔드 표출
  3. js/subregion_display.js 작성

[5단계] 통합
  9. 스케줄러 잡 등록
  11. 통합관리자 센터 자식해역 오류 영역
  12. 관리자 푸시 통합

[6단계] 검증]
```

---

## 5. 단계별 검증 방법

### 5.1 1단계 검증 (분리 인프라)

- index1 접속 시 `window.__SEAGNAL_PAGE` 콘솔 출력이 `'index1'`인지 확인
- index2 접속 시 `'index2'` 그대로인지 확인
- 두 페이지의 기존 기능 모두 정상 동작 확인 (탭 전환, 알림 카드 등)

### 5.2 2단계 검증 (데이터 파일)

- 신규 파일 3개가 정상 위치에 존재하는지 확인
- JSON 파싱 가능한지 확인
- 클라우드 백업 시 `region_alias_map.json` 포함되는지 확인

### 5.3 3단계 검증 (백엔드 모듈)

- afso_poller.js 단독 실행으로 응답 정상 수신
- subregion_judge.js 단위 테스트 (입력별 출력 검증)
- 신규 라우트가 응답 정상 반환

### 5.4 4단계 검증 (프론트엔드)

- index1에서 자식해역 정보 화면 표시
- index2에서 자식해역 표시 안 됨 (페이지 가드 동작 확인)
- 추정 마커, 툴팁 표시 정상

### 5.5 5단계 검증 (통합)

- 스케줄러 실행 후 1분 사이클마다 데이터 갱신
- 오류 발생 시 통합관리자 센터에 표시
- 관리자 푸시 정상 도착

### 5.6 6단계 검증 (전체)

- 1주일 운영하면서 다음 항목 모니터링
  - 매핑 누락 빈도
  - 캡 적용 빈도
  - 응답 오류 빈도
  - 영속화 실패 여부

---

## 6. 롤백 시나리오

각 단계별 롤백 방법:

| 단계 | 롤백 방법 |
|---|---|
| 1단계 | index1.html의 신규 추가 부분 제거 |
| 2단계 | 데이터 파일 삭제 또는 클라우드 백업 설정 되돌리기 |
| 3단계 | 신규 모듈 파일 삭제 |
| 4단계 | js/subregion_display.js 제거 |
| 5단계 | 환경 변수 `AFSO_ENABLED=false` 설정 → 즉시 비활성화 |
| 6단계 | 위 모든 단계 역순 |

가장 빠른 롤백: **환경 변수로 5단계 비활성화** → 사용자 영향 즉시 0.

---

## 7. 본 작업에서 절대 하지 말 것

다음은 본 작업 범위에서 **금지** 사항입니다:

- `weather_alerts.json` 직접 수정
- `active_lifecycle.json` 직접 수정
- 공유 JS 파일(`render.js`, `data.js`, `seaZones.js` 등) 직접 수정
- `style.css` 수정
- `index2.html` 수정
- 기존 라우트 시그니처 변경
- 기존 스케줄러 잡 동작 변경 (단, setInterval 콜백 안에 추가는 OK)
- 인증 시스템 변경

---

## 8. 본 작업의 핵심 원칙 (재확인)

1. **신규 자원만 추가**, 기존 자원은 수정 최소화
2. **페이지 플래그로 분기**, 명시적 비교만 사용
3. **데이터 파일 분리**, 운영 파일 무영향
4. **try/catch 격리**, 오류 전파 방지
5. **환경 변수로 즉시 비활성화 가능**, 빠른 롤백 보장

---

## 9. 다음 단계 (코드 구현)

본 분석 문서 시리즈 완료 후 코드 구현으로 넘어갑니다.

권장 순서:
1. 본 문서 사용자 검토 및 승인
2. 작업 1-2 진행 (index1 분리 인프라)
3. 작업 3-4 진행 (프론트 자원 준비)
4. 작업 5-8 진행 (백엔드 구현)
5. 작업 9-12 진행 (통합)
6. 1주일 운영 모니터링 후 index2 확장 검토

전체 코드 구현은 사용자 승인 후 진행 예정입니다.
