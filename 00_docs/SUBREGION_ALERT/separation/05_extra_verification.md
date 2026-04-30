# index1/index2 분리 분석 — 5. 추가 검증 결과 (Q3 옵션 가)

## 0. 본 파일의 목적

사용자 결정(Q3=옵션 가)에 따라 본 작업의 본격 구현 전에 추가 검증을 수행한 결과입니다.

검증 영역:
- 부모해역 알림 흐름
- 글로벌 이벤트 시스템
- 어드민 패널 동기화
- 푸시 알림 흐름
- localStorage / sessionStorage
- Service Worker / PWA / Manifest
- 백엔드 페이지 인지
- URL/Hash/Capacitor

검증 일시: 2026-05-01

---

## 1. 사용자 결정 사항 재정리 (Q1, Q2 변경 반영)

| 질문 | 최종 결정 | 의미 |
|---|---|---|
| Q1 | 가드 적용 안 함 | 기존 자식해역 표출은 index1에서도 그대로 |
| Q2 | 옵션 B (신규+기존 둘 다) | index1에서 비교 검증 가능 |
| Q3 | 옵션 가 (추가 검증) | 본 파일이 그 결과 |

### 1.1 결정에 따른 작업 변경

- **작업 13(기존 자식해역의 index1 가드) → 제거** (불필요)
- 대신 신규 모듈만 index1에서 동작하도록 가드 (작업 3, 15에 이미 포함)
- 사용자 화면 결과:
  - **index1**: 기존 자식해역 표출 (`.coastal-zones`) + 신규 자식해역 표출 (`#subregion-section`) 모두 표시
  - **index2**: 기존 자식해역 표출만 표시 (변화 없음)

---

## 2. 추가로 발견된 의존성 (4가지 신규)

### 2.1 [신규 발견 ❶] 부모해역 알림도 양 페이지 공유 코드

**이전 분석에서 부분적으로 다뤘으나 명시적 정리는 누락**.

부모해역 알림 흐름:
```
weather_alerts.json (current 객체)
  ↓ js/data.js:199 dispatchEvent('seagnal:alerts-changed')
  ↓ js/render.js:42-112 renderApp()
  ↓ js/render.js:61-98 부모 알림 카드 구조 (createAlertElement)
  ↓ DOM #alert-content
```

**중요 사실**:
- `index2_patch.js`는 `renderApp()`, `createAlertElement()`, `render_coastal.js` 함수들을 **오버라이드하지 않음**
- 즉, 부모해역 알림 표출은 양 페이지 100% 동일 흐름

**본 작업과의 관계**:
- 본 작업은 부모해역 알림을 변경하지 않으므로 직접 위험 없음
- 단, 신규 자식해역 표출이 부모 알림 카드 안에 들어가도록 만들면 양 페이지에 영향
- → **신규 자식해역은 별도 섹션(`#subregion-section`)에 둘 것**, 부모 카드 안에 넣지 말 것

### 2.2 [신규 발견 ❷] 글로벌 이벤트 시스템 양 페이지 공유

**이전 분석에서 단편적 언급, 본격 정리는 본 파일에서 처음**.

발견된 이벤트:
- `'seagnal:alerts-changed'` (단일 이벤트)
- 디스패치: `js/data.js:199`
- 리스너:
  - `js/ocean_warn_active5.js:440` (양 페이지 모두 로드)
  - `js/ocean_warn_active2.js`, `ocean_warn_active4.js` (index2 전용)

**위험**:
- 본 작업이 신규 이벤트(예: `'seagnal:subregion-changed'`)를 디스패치하면 양 페이지의 모든 리스너에 도달
- 신규 이벤트도 양 페이지에 노출됨

**완화책 (작업 17 신규 추가)**:
- 신규 이벤트 이름에 페이지 명시: `'seagnal:index1-subregion-changed'` 또는 `'seagnal:subregion-changed-index1'`
- 또는 신규 이벤트 핸들러에 페이지 가드: `if (window.__SEAGNAL_PAGE !== 'index1') return;`

### 2.3 [신규 발견 ❸] 어드민 패널이 양 페이지에서 동일하게 마운트

발견 사항:
- `js/admin.js:30-68` `showUnifiedLoginModal()` — 페이지 인식 없이 `document.body`에 모달 추가
- `js/admin.js:322-386` `showUnifiedAdminModal()` — 동일
- `js/admin_trigger.js` — 15-tap 트리거가 양 페이지에서 동작
- `js/alert_push.js:75-96` `showAlertManagementModal()` — 양 페이지에서 동일 탭 구조

**본 작업과의 관계**:
- 작업 11(통합관리자 센터에 자식해역 오류 탭 추가)이 그대로 적용되면 양 페이지의 어드민 패널에 모두 보임
- 자식해역 표출이 index1만이므로, index2의 어드민에서 자식해역 오류 탭이 보이는 것은 정보 차원에서 의미 있음 (운영자가 양쪽 모두 확인 가능)
- 다만 **사용자 결정**: 양쪽 모두 보일지, index1만 보일지

**완화책 (작업 18 신규 추가)**:
- 옵션 a: 양 페이지에 자식해역 오류 탭 표시 (운영자 편의성)
- 옵션 b: index1에서만 표시 — 페이지 가드 추가
- → 사용자 결정에 따라 선택. 일단 **옵션 a 권장** (운영자가 어디서든 확인 가능)

### 2.4 [신규 발견 ❹] localStorage 키 모두 공유

발견된 localStorage 키 (모두 양 페이지 공유):
- `seagnal_admin_mode` — 어드민 모드 토글
- `seagnal_device_id` — 기기 식별자
- `push_token` — FCM 토큰
- `notificationSettings_v1` — 알림 설정
- `weatherAppSettings_v1` — 사용자 해역 필터
- `seagnal_markers_visible`, `seagnal_buoys_visible` 등

**본 작업과의 관계**:
- 본 작업이 신규 localStorage 키를 추가하면 양 페이지에서 접근 가능
- 만약 같은 사용자가 두 페이지를 동시에 띄우면 한쪽 변경이 다른 쪽에 영향

**완화책 (작업 16 신규 추가)**:
- 모든 신규 localStorage 키는 `seagnal_subregion_` 접두 사용
- 본 작업이 사용자 설정/취향을 저장한다면 페이지 가드 추가
- 단, 본 작업의 자식해역은 사용자 설정이 거의 없으므로 영향 미미

---

## 3. 안전 확인 사항 (위험 없음 확인)

### 3.1 Service Worker (✅ 안전)

- `sw.js` 캐싱 없음 (line 14: "캐싱 기능 없이 오직 푸시 알림 수신만 담당")
- 푸시 이벤트 핸들러는 페이지 인식 없이 동작하지만, **자식해역은 푸시 안 보내므로 무관**
- 알림 클릭 시 `data.url`로 이동 — 본 작업에서 자식해역 알림이 없으므로 무관

### 3.2 PWA / Manifest (✅ 안전)

- `manifest.json:6` `start_url: "./index2.html"` — PWA는 항상 index2로 시작
- `scope: "/"` — PWA가 전체 경로 제어
- 시사: PWA 사용자는 index2만 사용. index1은 직접 URL로만 접근. **안전한 분리**

### 3.3 백엔드 페이지 인지 (✅ 안전)

- 모든 라우트가 페이지 인식 없음
- Referer/User-Agent/Cookie로 페이지 구분 안 함
- 본 작업 신규 라우트도 페이지 무관 (단, 응답 데이터를 호출 측에서만 사용)

### 3.4 URL / Hash / Capacitor (✅ 안전)

- URL 파라미터로 페이지 구분 없음
- Hash 라우팅 없음
- Capacitor 네이티브 앱은 `webDir: www`이므로 빌드 결과만 사용. 본 작업 영향 없음

### 3.5 Cache-Control / HTTP 헤더 (✅ 안전)

- API 응답 캐싱 30초~30분 (페이지 무관)
- 정적 JS/CSS는 브라우저 기본 캐시
- 본 작업 신규 JS 파일은 별도 URL이므로 캐시 충돌 없음

---

## 4. 최종 분리 작업 목록 (보완 후)

본 추가 검증으로 작업 16, 17, 18이 신규 추가되고, 작업 13은 제거됩니다.

### 4.1 최종 작업 17개

| # | 작업 | 우선순위 | 위험도 | 비고 |
|---|---|---|---|---|
| 1 | index1 페이지 플래그 추가 | 1 | 매우 낮음 | |
| 2 | 신규 섹션 HTML 추가 | 2 | 낮음 | |
| 3 | 신규 JS 파일 (`subregion_display.js`) | 3 | 낮음 | 페이지 가드 필수 |
| 4 | 신규 CSS 파일 | 4 | 매우 낮음 | `.subregion-*` 클래스 |
| 5 | 백엔드 라우트 (`routes/subregion.js`) | 5 | 낮음 | |
| 6 | 신규 데이터 파일 3개 | 6 | 낮음 | |
| 7 | `afso_poller.js` | 7 | 중간 | |
| 8 | `subregion_judge.js` | 8 | 중간 | |
| 9 | 스케줄러 잡 등록 | 9 | 중간 | try/catch 격리 |
| 10 | 클라우드 백업 추가 | 10 | 매우 낮음 | |
| 11 | 통합관리자 센터 자식해역 오류 영역 | 11 | 낮음 | 양 페이지 표시 (옵션 a) |
| 12 | 관리자 푸시 통합 | 12 | 매우 낮음 | |
| ~~13~~ | ~~기존 자식해역의 index1 가드~~ | — | — | **제거** (Q1+Q2 결정) |
| 14 | cctv1/cctv4 분류 정정 (문서) | 14 | 0 | |
| 15 | 신규 모듈 가드 강화 | 15 | 0 | |
| **16** | **localStorage 키 네임스페이싱** | **16** | **0** | **신규 (extra-verify)** |
| **17** | **신규 이벤트 네임스페이싱** | **17** | **0** | **신규 (extra-verify)** |
| **18** | **어드민 UI 표시 정책 (양 페이지 vs index1만)** | **18** | **매우 낮음** | **신규 (extra-verify)** |

### 4.2 작업 16, 17, 18 상세

#### [작업 16] localStorage 키 네임스페이싱

```javascript
// 신규 키 명명 규칙
const KEY_PREFIX = 'seagnal_subregion_';

// 예
localStorage.setItem(`${KEY_PREFIX}last_seen`, ...)
localStorage.setItem(`${KEY_PREFIX}error_ack_state`, ...)
```

#### [작업 17] 신규 이벤트 네임스페이싱

```javascript
// 신규 모듈 내에서
const EVENT_NAME = 'seagnal:subregion-updated';

// 디스패치
window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: ... }));

// 리스너 (신규 모듈 내)
window.addEventListener(EVENT_NAME, (e) => {
  if (window.__SEAGNAL_PAGE !== 'index1') return;  // 안전 가드
  // ... 처리
});
```

#### [작업 18] 어드민 UI 표시 정책

**결정**: 양 페이지에서 자식해역 오류 탭 표시 (옵션 a 권장).

이유:
- 운영자가 어느 페이지에서든 오류 확인 가능
- 자식해역 데이터 자체는 index1만 만들지만, 오류는 운영자에게 항상 알려야 함
- 현재 어드민 패널 구조와 일관성 유지

만약 사용자가 옵션 b (index1만)을 원하면:
```javascript
if (window.__SEAGNAL_PAGE === 'index1') {
  tabs.push({ id: 'subregion-errors', label: '자식해역 오류' });
}
```

---

## 5. 사용자 요구 기준 최종 충족 여부

### 5.1 "index1 즉시 삭제 가능" 기준

| 기준 | 보완 후 만족? | 검증 |
|---|---|---|
| (a) 코드 의존 — index2가 index1 자원 없이 동작 | ✅ | cctv1/cctv4는 사실상 공유로 보존, 다른 index1 전용 자원(cctv2/3/5/6, index.html)은 안전 삭제 가능 |
| (b) 데이터 의존 — index2 데이터는 index1 무관 | ✅ | 신규 데이터 파일은 신규 라우트에서만 사용, 운영 데이터 무영향 |
| (c) 동작 의존 — index2 표출은 index1 무관 | ✅ | 신규 모듈은 index1 가드, 신규 이벤트도 가드, localStorage 네임스페이싱 |
| (d) 어드민 동작 — 양 페이지 일관성 | ✅ | 어드민 UI 양 페이지 동일 (옵션 a) |
| (e) 푸시 / SW / PWA — 양 페이지 안전 | ✅ | 모두 페이지 인식 없거나 안전 분리 확인 |

→ **사용자 요구 기준 100% 충족 가능**.

---

## 6. 추가 검증으로 인한 진행 변경 사항

이전 04 보고서 대비:

| 항목 | 04 보고서 | 본 보고서 (05) |
|---|---|---|
| 작업 13 | 신규 추가 | 제거 (사용자 결정 반영) |
| localStorage 네임스페이싱 | 미언급 | 작업 16 신규 추가 |
| 이벤트 네임스페이싱 | 미언급 | 작업 17 신규 추가 |
| 어드민 표시 정책 | 미언급 | 작업 18 신규 추가 |
| 부모해역 흐름 분석 | 미언급 | §2.1 정리 |
| Service Worker / PWA | 미언급 | §3.1, §3.2 안전 확인 |

---

## 7. 본격 코드 구현 준비 상태

본 추가 검증으로 다음이 확인되었습니다:

- ✅ 모든 의존성 파악 완료
- ✅ 위험 항목 모두 완화책 마련
- ✅ 사용자 요구 기준 충족 가능
- ✅ 작업 17개로 상세 계획 수립

**남은 사용자 결정 사항** (1개):
- 작업 18: 자식해역 오류 탭을 양 페이지 모두 표시할지(옵션 a) 또는 index1만(옵션 b)

이것만 결정되면 본격 코드 구현으로 넘어갈 수 있습니다.

### 권장 다음 단계

1. 작업 18 결정 (1분 안에 가능)
2. 본격 코드 구현 시작 (1단계부터 순서대로)
3. 각 단계별 검증 후 다음 진행
4. 최종 통합 후 1주일 운영 모니터링

---

## 8. 본 시리즈 마무리

본 파일을 끝으로 `separation/` 시리즈가 완료됩니다.

| 파일 | 내용 |
|---|---|
| `01_inventory.md` | 자원 인벤토리 (1차 분석) |
| `02_dependencies.md` | 의존성 / 핫스팟 (1차 분석) |
| `03_risk_assessment.md` | 위험도 평가 (1차 분석) |
| `04_re_review.md` | 재검토 — 누락 2건 발견 |
| `05_extra_verification.md` | 추가 검증 — 신규 발견 4건, 안전 확인 5건 |

총 5개 분리 분석 문서. 본격 코드 구현 시작 가능 상태.
