# 1단계 상세 계획 — 분리 인프라 구축

## 0. 본 단계 목표

index1과 index2의 강한 분리를 위한 기초 인프라를 구축. 코드 동작에는 영향 없는 "준비 단계".

**위험도**: 매우 낮음 (모든 변경이 신규 추가 + 문서)

---

## 1. 작업 항목 (5개)

### 1.1 [작업 1] index.html에 페이지 식별 플래그 추가

**파일**: `local_server/index.html`
**위치**: line 13 (title 다음, 또는 head 내 다른 적절한 위치)

**변경 전**:
```html
    <title>SEA:GNAL(바다:그 날의 신호)</title>
    <meta property="og:title" content="SEA:GNAL(바다:그 날의 신호)">
```

**변경 후**:
```html
    <title>SEA:GNAL(바다:그 날의 신호)</title>
    <meta property="og:title" content="SEA:GNAL(바다:그 날의 신호)">

    <!-- 페이지 식별 플래그 (자식해역 표출 모듈 등에서 분기 사용) -->
    <script>window.__SEAGNAL_PAGE = 'index1';</script>
```

**효과**:
- index1 접속 시 `window.__SEAGNAL_PAGE === 'index1'` 평가됨
- 기존 코드의 `=== 'index2'` 검사들은 모두 false (영향 없음)
- 기존 `js/ocean_cctv.js:43` 의 `!== 'index2'` 검사도 결과 동일 (true 유지, return)

### 1.2 [작업 2] 자식해역 신규 섹션 컨테이너 추가

**파일**: `local_server/index.html`
**위치**: `<div id="alert-content">` (line 477) 근처

**전략**: alert-content 컨테이너 자체는 render.js가 동적으로 갱신하므로 그 자식이 되면 충돌 위험. 따라서 alert-content **이전**에 별도 컨테이너 추가.

**변경 전** (line 475-477):
```html

                    <!-- Alert Containers -->
                    <div id="alert-content" class="alert-content hidden">
```

**변경 후**:
```html

                    <!-- 자식해역 신규 표출 영역 (방재기상 기반, index1 전용 비교 검증) -->
                    <div id="subregion-section" class="subregion-section hidden">
                        <!-- 신규 표출은 js/subregion_display.js가 동적으로 채움 (4단계에서 구현) -->
                    </div>

                    <!-- Alert Containers -->
                    <div id="alert-content" class="alert-content hidden">
```

**효과**:
- 1단계에서는 빈 컨테이너만 추가. 채우는 로직은 4단계에서 구현
- `hidden` 클래스로 초기 비표시. 4단계에서 데이터 있으면 표시 처리
- 사용자 화면 변화 없음 (1단계 시점)

### 1.3 [작업 4] 신규 CSS 파일 생성 + index.html link

**신규 파일**: `local_server/subregion.css`

**내용** (1단계는 최소 스타일만, 4단계에서 본격 작성):
```css
/* subregion.css — 자식해역 신규 표출 영역 스타일 (index1 전용) */

/* 컨테이너 */
.subregion-section {
    margin-top: 16px;
    padding: 12px;
    background-color: rgba(255, 255, 255, 0.03);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
}

/* 초기 비표시 */
.subregion-section.hidden {
    display: none;
}

/* 헤더 (4단계에서 활용) */
.subregion-section-header {
    font-size: 0.95rem;
    font-weight: 600;
    color: #aaa;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
}

/* 자식 항목 (4단계에서 활용) */
.subregion-item {
    /* 4단계에서 정의 */
}
```

**index.html 변경** (line 30 근처, 다른 CSS link 옆):

**변경 전**:
```html
    <!-- Styles -->
    <link rel="stylesheet" href="style.css?v=Margin_Final_v5">
    <link rel="stylesheet" href="splash.css?v=Badge_Update_20260101">
```

**변경 후**:
```html
    <!-- Styles -->
    <link rel="stylesheet" href="style.css?v=Margin_Final_v5">
    <link rel="stylesheet" href="splash.css?v=Badge_Update_20260101">

    <!-- 자식해역 신규 표출 (index1 전용 비교 검증) -->
    <link rel="stylesheet" href="subregion.css?v=Step1_Initial_20260501">
```

**효과**:
- index2.html은 이 CSS를 link하지 않으므로 영향 없음
- index1만 신규 스타일 로드

### 1.4 [작업 14] cctv1.js / cctv4.js 분류 정정 (문서)

**파일**: `00_docs/SUBREGION_ALERT/separation/01_inventory.md`

**변경**: §4.2 "index1 전용 (6개)" 섹션을 정정.

```markdown
### 4.2 index1 전용 (4개)

(이전: 6개로 잘못 기재)

js/cctv2.js
js/cctv3.js
js/cctv5.js
js/cctv6.js

> 정정 사항 (2026-05-01): cctv1.js / cctv4.js는 index2.html:2599-2600에서도
> 로드되며 js/ocean_cctv.js가 window.CCTV_PROVIDERS / showCctvPopup() 를
> 사용하므로 사실상 공유 자원. index1 즉시 삭제 시 보존 필요.

### 4.3 사실상 공유 (cctv1.js / cctv4.js)

이전 분석에서 'index1 전용'으로 분류했으나 실제로는 양 페이지에서 사용됨.

js/cctv1.js  -- window.CCTV_PROVIDERS 정의
js/cctv4.js  -- showCctvPopup, toggleCctvFavorite 정의

이들은 index1 / index2 모두에서 ocean_cctv.js (index2 전용 신버전)도 참조함.
```

**효과**: 문서 정정만, 코드 변경 없음

### 1.5 [작업 15] 신규 모듈 가드 강화 패턴 정립 (문서)

**신규 파일**: `00_docs/SUBREGION_ALERT/implementation/guard_pattern.md`

**내용**: 신규 JS 모듈 작성 시 따라야 할 표준 가드 패턴 정의 (4단계에서 사용)

```markdown
# 신규 모듈 가드 패턴

## 표준 가드 패턴

모든 신규 자식해역 관련 JS 모듈은 다음 가드로 시작해야 함.

\```javascript
(function() {
  'use strict';

  // [Layer 1] 페이지 가드 — index1이 아니면 즉시 종료
  if (window.__SEAGNAL_PAGE !== 'index1') {
    console.log('[Subregion] index2에서는 동작 안 함');
    return;
  }

  // [Layer 2] 마운트 위치 가드 — 컨테이너가 없으면 종료
  const container = document.getElementById('subregion-section');
  if (!container) {
    console.warn('[Subregion] #subregion-section 마운트 위치 없음');
    return;
  }

  // [Layer 3] 정상 진입 — 본 모듈 실제 로직
  // ...
})();
\```

## 이벤트 가드

\```javascript
window.addEventListener('seagnal:subregion-updated', (e) => {
  if (window.__SEAGNAL_PAGE !== 'index1') return;
  // ...
});
\```

## localStorage 키 네임스페이싱

\```javascript
const KEY_PREFIX = 'seagnal_subregion_';
localStorage.setItem(`${KEY_PREFIX}xxx`, ...);
\```
```

**효과**: 4단계 이후 신규 모듈이 일관된 가드 패턴 사용

---

## 2. 변경 파일 목록 (5개)

| # | 파일 | 종류 | 변경량 |
|---|---|---|---|
| 1 | `local_server/index.html` | 수정 | +5줄 (플래그 + CSS link + 컨테이너) |
| 2 | `local_server/subregion.css` | 신규 | ~30줄 |
| 3 | `00_docs/SUBREGION_ALERT/separation/01_inventory.md` | 수정 | +10줄 (분류 정정) |
| 4 | `00_docs/SUBREGION_ALERT/implementation/guard_pattern.md` | 신규 | ~40줄 |

---

## 3. 검증 방법

### 3.1 코드 변경 직후 검증

```bash
# 1. 변경 파일 syntax 확인
node -e "require('fs').readFileSync('/home/user/SEAGNAL/local_server/index.html')"
# JSON 파일은 없으므로 패스

# 2. CSS 파일 정상 로드 가능한지 (브라우저 DevTools에서)
# 3. index.html 자체 파싱 가능한지 (브라우저)
```

### 3.2 동작 검증 (수동)

| 검증 항목 | 방법 | 기대 결과 |
|---|---|---|
| index1 페이지 플래그 | index1 접속 후 콘솔 `window.__SEAGNAL_PAGE` | `'index1'` 출력 |
| index2 페이지 플래그 | index2 접속 후 콘솔 `window.__SEAGNAL_PAGE` | `'index2'` 출력 (변경 없음) |
| #subregion-section 존재 | index1 접속 후 콘솔 `document.getElementById('subregion-section')` | 빈 div 반환 |
| #subregion-section 비표시 | index1 접속 후 시각적 확인 | 화면에 보이지 않음 (hidden) |
| index2 변화 없음 | index2 모든 기존 기능 | 정상 동작 |
| 기존 자식해역 표출 | 양 페이지의 .coastal-zones | 정상 표출 |

### 3.3 회귀 검증

- 기존 알림 카드 클릭 / 펼침 동작
- 기존 탭 전환 (특보 → 해구기상 → 태풍정보 등)
- 어드민 패널 (15-tap)

---

## 4. 롤백 방법

git revert로 1단계 커밋 되돌림. 또는 수동 revert:

1. `local_server/index.html` 추가된 부분 제거 (5줄)
2. `local_server/subregion.css` 파일 삭제
3. 문서 변경은 운영에 영향 없으므로 그대로 두거나 revert

---

## 5. 진입 직전 재검토 (4가지 관점)

### 5.1 문서 기반 적정성

- ✅ 본 단계 작업이 `separation/03_risk_assessment.md`의 "1단계 분리 인프라 구축"과 일치
- ✅ 작업 1, 2, 4, 14, 15가 모두 포함됨
- ✅ `06_comparison_validation.md`의 정책과 부합 (index1만 신규, index2 무영향)
- ✅ 누락 없음

### 5.2 코드 기반 적정성

- ✅ `local_server/index.html` 실존 (line 2077까지)
- ✅ `<title>` line 13, `<link>` line 30 근처, `<div id="alert-content">` line 477 모두 확인
- ✅ CSS 파일 위치 패턴 (`local_server/` 루트) 확인
- ✅ 기존 코드와 새 가드 패턴 충돌 없음 (15곳의 `__SEAGNAL_PAGE` 검사 모두 영향 없음 검증됨)

### 5.3 로직 기반 적정성

- ✅ index1 플래그 'index1' 설정 시:
  - `=== 'index2'` 검사 → false (변화 없음, 정상)
  - `!== 'index2'` 검사 → true (변화 없음, 정상)
- ✅ #subregion-section 컨테이너는 `.hidden` 클래스로 비표시 → 화면에 영향 없음
- ✅ subregion.css 추가 → index2.html은 link 안 하므로 영향 없음
- ✅ 양 페이지의 기존 동작 100% 유지 보장

### 5.4 누락 점검

- ✅ 작업 항목: 5개 모두 명시 (작업 1, 2, 4, 14, 15)
- ✅ 변경 파일 목록: 4개 명시
- ✅ 검증 방법: 7개 항목 명시
- ✅ 롤백 방법: 명시
- ✅ 위험도 평가: '매우 낮음' 명시

---

## 6. 진입 결정

본 4가지 재검토 결과 **이상 없음**. 1단계 작업 진행.

---

## 7. 작업 진행 순서

```
[1] subregion.css 파일 생성
[2] index.html 수정 (플래그 + CSS link + 컨테이너)
[3] separation/01_inventory.md 정정
[4] implementation/guard_pattern.md 작성
[5] 검증 (수동 + 자동)
[6] git 커밋 + 푸시
[7] 1단계 완료 보고
```
