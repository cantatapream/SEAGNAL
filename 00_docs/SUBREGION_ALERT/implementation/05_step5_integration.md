# 5단계 상세 계획 — 통합 및 어드민

## 0. 본 단계 목표

3단계에서 만든 백엔드 모듈들을 스케줄러에 연결하고, 통합관리자 센터의 특보수집오류 탭에 자식해역 비교 불일치 항목을 통합. 본 단계 완료 시점부터 실제 운영 데이터가 흐르기 시작.

**위험도**: 중간 (가장 통합적인 변경, 실제 운영 데이터 변경 시작)

---

## 1. 작업 항목 (5개)

### 1.1 [작업 9] 스케줄러 신규 잡 등록

**파일**: `local_server/scheduler.js`
**위치**: line 1437 근처 (weatherAlertsCrawler.run() 다음)

**전략**: 기존 `weatherAlertsCrawler.run()` **다음에** 자식해역 처리 잡을 추가. 같은 1분 setInterval 안에서 순차 실행.

**환경변수 가드**:
- `AFSO_ENABLED=false` 시 자식해역 처리 전체 스킵 → 즉시 롤백 가능

**변경 후 흐름**:
```javascript
// scheduler.js 1분 setInterval 안

if (!crawlPaused) {
    log('🔎 기상특보 크롤러 실행...');
    weatherAlertsCrawler.run().catch(err => log(`⚠️ 크롤러 오류: ${err.message}`));

    // 신규: 자식해역 처리 (방재기상 기반)
    if (process.env.AFSO_ENABLED !== 'false') {
        runSubregionPipeline().catch(err =>
            log(`⚠️ 자식해역 처리 오류: ${err.message}`)
        );
    }
}
```

`runSubregionPipeline()` 함수 (scheduler.js 내부 또는 별도 파일):
1. afsoPoller.pollAfso() 호출
2. weather_alerts.json에서 부모해역 통보문 상태 추출
3. subregionJudge.runJudgement() 호출
4. subregionComparator.runComparison() 호출
5. 오류 발생 시 try/catch로 격리

### 1.2 [작업 22] 특보수집오류 탭에 비교 불일치 통합

**파일**: `local_server/js/admin.js`
**위치**: `renderErrorListTab()` 함수 (line 472) 안

**변경**:
- 기존 3개 탭 (검토 필요 / 재시도 중 / 수집 실패) + 신규 1개 추가
- 신규 탭: "자식해역 비교 불일치" (subregionMismatch)
- index1에서만 표시 (페이지 가드)

**신규 추가**:
```javascript
// fetch에 1개 추가
const subregionRes = await fetch('/api/subregion/error-log?errorType=COMPARISON_MISMATCH&acknowledged=false');
let subregionMismatches = [];
if (subregionRes.ok) {
    const data = await subregionRes.json();
    subregionMismatches = data.errors || [];
}

const mismatchCount = subregionMismatches.length;

// 페이지 가드: index1에서만 자식해역 탭 표시
const isIndex1 = window.__SEAGNAL_PAGE === 'index1';

// 탭바에 1개 추가 (isIndex1일 때만)
const subregionTabBtn = isIndex1
    ? tabBtn('subregionMismatch', '<i class="fa-solid fa-water"></i> 자식해역 비교 불일치', mismatchCount, '#a855f7')
    : '';
```

**렌더 함수 (신규)**:
```javascript
function renderSubregionMismatchHtml(mismatches) {
    if (mismatches.length === 0) {
        return '<div style="text-align:center;padding:40px;color:#64748b;">자식해역 비교 불일치 항목 없음</div>';
    }
    return mismatches.map(m => renderMismatchCard(m)).join('');
}

function renderMismatchCard(mismatch) {
    // 상세 카드: 헤더 + 서술형 + 코드형(접기) + 확인 버튼
    // ...
}
```

상세 화면은 사용자 요구대로:
- 코드 형식 (`developerInfo` JSON 펼치기)
- 서술 형식 (`narrativeDescription`)
- 둘 다 상세히

### 1.3 [작업 11 정정] 통합관리자 센터 UI 연결

이미 1.2에서 같은 함수 내 통합으로 적용. 별도 탭이 아닌 **기존 탭의 4번째 서브탭**으로.

### 1.4 [작업 12] 관리자 푸시 통합

이미 3단계 `subregion_comparator.js`에서 `sendAdminPush()` 호출 구현 완료. 5단계는 스케줄러 연결로 실제 트리거.

### 1.5 [작업 18] index1만 표시 정책

1.2의 페이지 가드 `isIndex1`로 적용.

---

## 2. 변경 파일 목록 (3개)

| # | 파일 | 종류 | 예상 변경량 |
|---|---|---|---|
| 1 | `local_server/scheduler.js` | 수정 | +30~40줄 (신규 잡 + 헬퍼 함수) |
| 2 | `local_server/js/admin.js` | 수정 | +60~80줄 (신규 탭 + 렌더 함수) |
| 3 | `00_docs/.../05_step5_integration.md` | 신규 | (본 문서) |

---

## 3. 검증 방법

### 3.1 syntax 검증

```bash
node --check /home/user/SEAGNAL/local_server/scheduler.js
node --check /home/user/SEAGNAL/local_server/js/admin.js
```

### 3.2 환경변수 비활성화 검증 (롤백 보장)

`AFSO_ENABLED=false` 설정 시 자식해역 처리 전체 스킵 → 시뮬레이션:
```bash
# (스케줄러 코드에서 process.env.AFSO_ENABLED 검사 명시 확인)
grep -n "AFSO_ENABLED" /home/user/SEAGNAL/local_server/scheduler.js
```

### 3.3 페이지 가드 검증

- `admin.js`에 `window.__SEAGNAL_PAGE === 'index1'` 검사 추가됨
- index2의 어드민에서는 자식해역 탭 비표시 (정적 분석)

### 3.4 운영 영향

본 단계 적용 시점부터:
- 매 1분마다 방재기상 API 호출 시작
- subregion_lifecycle.json 갱신 시작
- subregion_error_log.json 갱신 시작 (상이성 발견 시)
- 사용자 화면:
  - **index2**: 변화 0 (가드로 인해)
  - **index1**: #subregion-section에 데이터 채워짐 (자식해역 신규 표출)

---

## 4. 롤백 방법

### 4.1 즉시 롤백 (환경변수)

```bash
# Fly.io secrets 또는 .env 파일에 설정
AFSO_ENABLED=false
```
→ 다음 1분 사이클부터 자식해역 처리 전체 스킵
→ index1 화면도 빈 상태로 (데이터 갱신 안 됨)
→ 사용자 영향 0 (index2는 처음부터 변화 없음)

### 4.2 코드 롤백 (필요 시)

```bash
git revert <5단계 커밋>
```

---

## 5. 진입 직전 재검토 (4가지 관점)

### 5.1 문서 기반 적정성

- ✅ `separation/06_comparison_validation.md` 비교 검증 시스템 정책 그대로 반영
- ✅ `separation/05_extra_verification.md` 작업 18 결정(옵션 b: index1만) 반영
- ✅ `02_DATA_MODEL/05_error_log_schema.md` errorType 'COMPARISON_MISMATCH' 일관
- ✅ `01_LOGIC/14_rule_order.md` 9단계 처리 순서 — runJudgement에서 이미 구현
- ✅ 누락 없음

### 5.2 코드 기반 적정성

- ✅ `scheduler.js:1430-1460` 1분 주기 setInterval 위치 확인
- ✅ `weatherAlertsCrawler.run()` 직후가 자식해역 처리 적절 위치
- ✅ `js/admin.js:472` `renderErrorListTab()` 함수 진입점 확인
- ✅ 기존 fetch 패턴(Promise.all) 그대로 따라 신규 fetch 추가 가능
- ✅ 3단계에서 만든 모듈(afso_poller, judge, comparator)은 require로 사용 가능

### 5.3 로직 기반 적정성

- ✅ try/catch 격리: 자식해역 처리 실패 시 기존 weatherAlertsCrawler 영향 없음
- ✅ AFSO_ENABLED 환경변수: 즉시 비활성화 가능
- ✅ subregionJudge가 weather_alerts.json 읽기만 함 (쓰지 않음) → 운영 데이터 무영향
- ✅ comparator가 subregion_error_log.json만 씀 → 기존 어드민 동작 무영향
- ✅ admin.js의 신규 탭은 기존 3개 탭 동작 그대로 두고 추가만

### 5.4 누락 점검

- ✅ 5개 작업 항목 모두 명시 (9, 22, 11, 12, 18)
- ✅ 변경 파일 3개 명시
- ✅ 환경변수 가드 명시
- ✅ 페이지 가드 명시 (admin.js)
- ✅ 롤백 명시 (환경변수 + 코드)

**주의 사항**:
- 본 단계 시작 시점에 외부 API 호출이 시작됨 → 첫 사이클부터 데이터 흐름
- 첫 1~2 사이클은 "콜드 스타트"로 비교 결과가 부정확할 수 있음 (3단계 LOGIC 8 §8 참조)

---

## 6. 진입 결정

**이상 없음**. 5단계 작업 진행.

---

## 7. 작업 진행 순서

```
[1] scheduler.js에 runSubregionPipeline() 헬퍼 추가
[2] scheduler.js의 1분 setInterval 안에 호출 추가 (AFSO_ENABLED 가드 포함)
[3] admin.js에 자식해역 비교 불일치 탭 렌더 함수 추가
[4] admin.js의 renderErrorListTab()에 신규 탭 통합 (페이지 가드 포함)
[5] syntax 검증
[6] 페이지 가드 동작 확인 (정적 분석)
[7] git 커밋 + 푸시
[8] 5단계 완료 보고
```
