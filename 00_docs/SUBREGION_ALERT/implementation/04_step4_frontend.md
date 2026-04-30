# 4단계 상세 계획 — 프론트엔드 표출

## 0. 본 단계 목표

index1에서 자식해역 신규 표출 (방재기상 기반)을 화면에 그림. 기존 자식해역 표출과 나란히 비교 가능하도록 별도 영역에 표시.

**위험도**: 낮음 (신규 자원만 추가, 페이지 가드 적용)

---

## 1. 작업 항목 (4개)

### 1.1 [작업 3] `js/subregion_display.js` 신규 작성

**책임**: index1에서 `/api/subregion/state` + `/api/subregion/alias-map` 조회 → `#subregion-section`에 부모해역별로 그룹화하여 렌더

**구조** (guard_pattern.md 표준 따름):
```javascript
(function() {
  'use strict';

  // [Layer 1] 페이지 가드
  if (window.__SEAGNAL_PAGE !== 'index1') return;

  // [Layer 2] 마운트 가드
  const container = document.getElementById('subregion-section');
  if (!container) return;

  // [Layer 3] 본 로직
  const KEY_PREFIX = 'seagnal_subregion_';
  const REFRESH_EVENT = 'seagnal:subregion-refreshed';
  const POLL_INTERVAL_MS = 60 * 1000;

  // 글로벌 namespace
  window.SubregionDisplay = {
    refresh: refresh,
    getState: () => ({...lastState}),
    setEnabled: setEnabled
  };

  // 1. 매핑 테이블 로드 (1회)
  // 2. 1분마다 /api/subregion/state 폴링
  // 3. 받은 데이터 → 부모해역별 그룹화
  // 4. 렌더 함수 → #subregion-section 업데이트
  // 5. 이벤트 디스패치 (다른 모듈이 알 수 있도록)
})();
```

**렌더링 정책** (separation/06 §7 + LOGIC 15 §4):

화면 구조:
```
#subregion-section
├─ .subregion-section-header (안내)
└─ .subregion-parent-group (부모해역별)
    ├─ .subregion-parent-name (예: 제주도서부앞바다)
    └─ .subregion-list
        ├─ .subregion-item (예: 가파도연안바다)
        │   ├─ .subregion-name
        │   ├─ .subregion-status (풍랑 경보 등)
        │   └─ .subregion-confidence-marker (ⓘ 또는 비표시)
        └─ ...
```

추정 마커 정책:
- `confidence === 'CONFIRMED'`: 마커 없음
- `confidence === 'WEAKLY_ESTIMATED'`: 작은 ⓘ + 옅은 색
- `confidence === 'STRONGLY_ESTIMATED'`: 강조 ⓘ + 회색조

툴팁: "본 정보는 실제 발표내용과 다를 수 있습니다." (추정 시)

### 1.2 [작업 16] localStorage 키 네임스페이싱

신규 모듈에서 사용하는 모든 localStorage 키:
```javascript
const KEY_PREFIX = 'seagnal_subregion_';
// 예: localStorage.getItem(`${KEY_PREFIX}last_seen_at`)
```

본 단계에서 실제로 저장하는 데이터:
- `seagnal_subregion_enabled` (사용자가 신규 표출 영역 토글한 경우, 옵션)
- `seagnal_subregion_last_refresh` (마지막 갱신 시각, 디버깅용)

### 1.3 [작업 17] 신규 이벤트 네임스페이싱

신규 이벤트 이름:
```javascript
const REFRESH_EVENT = 'seagnal:subregion-refreshed';
```

디스패치는 모듈이 데이터 갱신 후 발생. 5단계의 어드민 UI 모듈이 이 이벤트를 들을 수 있음.

### 1.4 CSS 보강 — `subregion.css`

1단계에서는 골격만 만들었음. 4단계에서 본격 스타일 작성:

```css
/* 부모해역 그룹 */
.subregion-parent-group { ... }
.subregion-parent-name { ... }
.subregion-list { ... }

/* 자식 항목 */
.subregion-item { ... }
.subregion-item-name { ... }
.subregion-item-status { ... }

/* 추정 마커 */
.subregion-confidence-marker { ... }
.subregion-confidence-marker.weak { ... }
.subregion-confidence-marker.strong { ... }

/* 상이성 강조 (5단계 비교 결과 반영용 — 4단계에선 골격만) */
.subregion-item.diff-mismatch { ... }
```

### 1.5 index.html에 `<script>` 태그 추가

신규 JS 파일 로드. index2.html은 추가하지 않음.

위치: 다른 `<script>` 태그들 옆 (적절한 위치)

```html
<!-- 자식해역 신규 표출 (방재기상 기반, index1 전용) -->
<script src="js/subregion_display.js?v=Step4_Initial_20260501"></script>
```

---

## 2. 변경 파일 목록 (4개)

| # | 파일 | 종류 | 예상 크기 |
|---|---|---|---|
| 1 | `local_server/js/subregion_display.js` | 신규 | ~250줄 |
| 2 | `local_server/subregion.css` | 수정 | +80줄 (스타일 보강) |
| 3 | `local_server/index.html` | 수정 | +1줄 (script 태그) |
| 4 | `00_docs/SUBREGION_ALERT/implementation/04_step4_frontend.md` | 신규 | (본 문서) |

---

## 3. 검증 방법

### 3.1 syntax 검증

```bash
node --check /home/user/SEAGNAL/local_server/js/subregion_display.js
```

### 3.2 가드 동작 검증 (코드 정적 분석)

- Layer 1 가드: `window.__SEAGNAL_PAGE !== 'index1'` 사용
- Layer 2 가드: `document.getElementById('subregion-section')` 검증
- IIFE 캡슐화: 글로벌 변수 `window.SubregionDisplay` 한 개만 노출
- localStorage 키: `seagnal_subregion_` 접두 사용
- 이벤트 이름: `seagnal:subregion-` 접두 사용

### 3.3 운영 영향 확인

- index2.html에 `<script>` 태그 추가 안 됨 (검증)
- index2 접속 시 신규 모듈 로드 안 됨
- index1 접속 시 페이지 가드 통과 + 마운트 가드 통과 시에만 동작
- 백엔드 데이터 (subregion_lifecycle.json)가 빈 상태이면 안내만 표시

### 3.4 5단계 통합 후 동작 (참고)

본 단계에서는 백엔드가 데이터를 채우지 않으므로 화면은 빈 안내만 표시. 5단계에서 스케줄러 통합 후 실제 데이터로 채워짐.

---

## 4. 롤백 방법

1. `js/subregion_display.js` 삭제
2. `index.html`의 `<script>` 태그 제거
3. `subregion.css`의 추가 스타일 revert

---

## 5. 진입 직전 재검토 (4가지 관점)

### 5.1 문서 기반 적정성

- ✅ `separation/06_comparison_validation.md §7` 화면 레이아웃 그대로 반영
- ✅ `implementation/guard_pattern.md` 3-Layer 가드 + namespacing 모두 적용
- ✅ `01_LOGIC/15_estimation_display.md §4` 추정 마커 정책 반영
- ✅ `02_DATA_MODEL/03_subregion_lifecycle_schema.md` 데이터 형식 따름
- ✅ 누락 없음

### 5.2 코드 기반 적정성

- ✅ 1단계에서 추가한 `#subregion-section` 컨테이너 활용 가능 (line 484 확인)
- ✅ 1단계에서 추가한 `subregion.css` 보강 가능 (50줄 정도 있음)
- ✅ 3단계에서 추가한 `/api/subregion/state` 라우트 호출 가능
- ✅ index2.html에는 `<script>` 추가하지 않으므로 영향 없음
- ✅ 기존 JS 파일들과 의존성 없음 (독립 모듈)

### 5.3 로직 기반 적정성

- ✅ 페이지 가드: index2에서 즉시 return → 영향 0
- ✅ 마운트 가드: 미리 만들어둔 #subregion-section이 없으면 종료
- ✅ 데이터 빈 상태: 안내만 표시 (오류 안 발생)
- ✅ 1분 폴링이 백엔드 부하 작음 (<1KB 응답)
- ✅ DOM 조작은 #subregion-section 내부만 (외부 영향 0)

### 5.4 누락 점검

- ✅ 4개 작업 항목 모두 명시 (3, 16, 17, CSS 보강)
- ✅ 변경 파일 4개 명시
- ✅ 검증 방법: syntax + 가드 + 운영 영향
- ✅ 롤백: 명시
- ✅ 5단계와의 연결 명확

---

## 6. 진입 결정

**이상 없음**. 4단계 작업 진행.

---

## 7. 작업 진행 순서

```
[1] subregion_display.js 작성
[2] subregion.css 보강
[3] index.html에 <script> 태그 추가
[4] syntax + 가드 검증
[5] git 커밋 + 푸시
[6] 4단계 완료 보고
```
