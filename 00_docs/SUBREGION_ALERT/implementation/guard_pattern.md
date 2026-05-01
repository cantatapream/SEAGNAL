# 신규 모듈 가드 패턴 표준

본 문서는 자식해역 표출 시스템에 추가되는 모든 신규 JS 모듈이 따라야 할 표준 가드 패턴을 정리합니다.

## 0. 가드의 목적

신규 모듈이 의도치 않게 index2(운영 페이지)에서 동작하는 것을 방지하여 운영 영향 0을 보장합니다.

---

## 1. 표준 가드 패턴 (모듈 시작 부분)

모든 신규 자식해역 관련 JS 모듈은 다음 3-Layer 가드로 시작해야 합니다.

```javascript
(function() {
  'use strict';

  // ============================================
  // [Layer 1] 페이지 가드 — index1이 아니면 즉시 종료
  // ============================================
  if (window.__SEAGNAL_PAGE !== 'index1') {
    console.log('[Subregion] index2/기타 페이지에서는 동작 안 함 — 모듈 종료');
    return;
  }

  // ============================================
  // [Layer 2] 마운트 위치 가드 — 컨테이너가 없으면 종료
  // ============================================
  const container = document.getElementById('subregion-section');
  if (!container) {
    console.warn('[Subregion] #subregion-section 마운트 위치 없음 — 1단계 인프라 미완료');
    return;
  }

  // ============================================
  // [Layer 3] 정상 진입 — 본 모듈 실제 로직
  // ============================================
  // ... 실제 모듈 코드 ...

})();
```

### 1.1 Layer 1 — 페이지 가드

- `window.__SEAGNAL_PAGE === 'index1'` 인 경우만 진행
- `'index2'`, undefined, 그 외 모든 값은 즉시 return
- 명시적 비교만 사용 (`!==`로 부정 검사 권장)

### 1.2 Layer 2 — 마운트 위치 가드

- 본 모듈이 사용할 DOM 컨테이너가 존재해야 진행
- 1단계 인프라가 완료되지 않은 환경에서도 안전하게 종료
- console.warn으로 상황 알림 (개발자 디버깅 용)

### 1.3 Layer 3 — 정상 진입

- 위 두 가드를 통과한 경우에만 실제 로직 실행
- 모듈의 모든 변수/함수는 IIFE 안에 캡슐화

---

## 2. 이벤트 가드 패턴

신규 이벤트 리스너에도 동일한 가드 적용:

```javascript
window.addEventListener('seagnal:subregion-updated', (e) => {
  if (window.__SEAGNAL_PAGE !== 'index1') return;
  // ... 정상 처리
});
```

이벤트 디스패치도 페이지 식별을 명확히:

```javascript
// 디스패치 측
window.dispatchEvent(new CustomEvent('seagnal:subregion-updated', {
  detail: {
    page: 'index1',  // 명시적으로 페이지 표기
    data: ...
  }
}));
```

---

## 3. localStorage 키 네임스페이싱

신규 localStorage 키는 모두 다음 접두 사용:

```javascript
const KEY_PREFIX = 'seagnal_subregion_';

// 사용 예
localStorage.setItem(`${KEY_PREFIX}last_seen_at`, ...);
localStorage.setItem(`${KEY_PREFIX}user_filter`, ...);

// 읽기
const value = localStorage.getItem(`${KEY_PREFIX}last_seen_at`);
```

기존 `seagnal_*` 키들과 명확히 구분되어 충돌 방지.

---

## 4. 글로벌 변수 네임스페이싱

신규 글로벌 변수도 namespace 패턴:

```javascript
// 좋은 예
window.SubregionDisplay = {
  refresh: function() { ... },
  getState: function() { ... }
};

// 나쁜 예 (글로벌 오염)
window.refreshSubregion = function() { ... };
window.subregionState = { ... };
```

기존 코드의 `window.switchMainTab()` 같은 단순 함수와 충돌 가능성 차단.

---

## 5. CSS 클래스 네임스페이싱

신규 CSS 클래스는 `subregion-` 접두 사용:

```css
/* 좋은 예 */
.subregion-section { ... }
.subregion-item { ... }
.subregion-item.diff-mismatch { ... }

/* 나쁜 예 (기존 충돌) */
.coastal-item { ... }       /* 기존 .coastal-item과 충돌 */
.alert-card { ... }          /* 기존 .alert-card와 충돌 */
```

---

## 6. 적용 대상 모듈 (4단계 이후)

본 가드 패턴은 다음 신규 모듈에 모두 적용됨:

- `js/subregion_display.js` (4단계)
- `services/afso_poller.js` (3단계, 백엔드이므로 일부 변형)
- `services/subregion_judge.js` (3단계, 백엔드)
- `services/subregion_comparator.js` (3단계, 백엔드)

백엔드 모듈은 `window` 객체가 없으므로 페이지 가드 대신 환경 변수 가드 사용:

```javascript
// services/afso_poller.js (백엔드)
if (process.env.AFSO_ENABLED === 'false') {
  console.log('[AFSO Poller] 환경변수로 비활성화됨');
  return;
}
```

---

## 7. 검증 체크리스트

신규 모듈 작성 후 다음을 검증:

- [ ] Layer 1 가드 (`__SEAGNAL_PAGE !== 'index1'`) 적용됨
- [ ] Layer 2 가드 (마운트 위치 검증) 적용됨
- [ ] IIFE로 캡슐화되어 변수 누출 없음
- [ ] localStorage 키 `seagnal_subregion_` 접두 사용
- [ ] CSS 클래스 `subregion-` 접두 사용
- [ ] 글로벌 변수는 `window.Subregion*` 네임스페이스
- [ ] 이벤트 이름은 `seagnal:subregion-*` 네임스페이스
- [ ] index2에서 콘솔 로그로 종료 메시지 출력 확인
