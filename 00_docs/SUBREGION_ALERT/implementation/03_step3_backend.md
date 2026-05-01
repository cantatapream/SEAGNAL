# 3단계 상세 계획 — 백엔드 모듈 작성

## 0. 본 단계 목표

자식해역 처리에 필요한 백엔드 핵심 모듈 5개를 신규 작성. 이 단계까지는 **스케줄러에 등록하지 않으므로 운영에 영향 0** (5단계에서 등록).

**위험도**: 중간 (가장 많은 코드 신규 작성, 단 호출 미연결)

---

## 1. 작업 항목 (5개 모듈)

### 1.1 [작업 7] `services/afso_poller.js` — 방재기상 API 폴링

**책임**: 방재기상시스템 API 호출 → 응답 검증 → 정형화된 데이터 반환

**시그니처**:
```javascript
async function pollAfso(): Promise<{
  success: boolean,
  metData: AfsoRow[] | null,
  error: { type: string, message: string } | null,
  rawResponse: object | null
}>
```

**핵심 로직** (LOGIC 14 §3.1 응답 건전성 검사 포함):
1. `tmFc` 파라미터 생성 (현재 KST 시각, YYYYMMDDHHMI)
2. POST 호출: `https://afso.kma.go.kr/afsOut/mmr/warning/retMmrWarningSeaNow.kajx`
3. 응답 검증 (statusCode, meta.err, data.metData 존재 여부)
4. 결과 반환

근거: `01_LOGIC/14_rule_order.md` §3.1, `02_DATA_MODEL/01_api_spec.md`

---

### 1.2 [작업 8] `services/subregion_judge.js` — 자식해역 종합 판정

**책임**: 통보문 + 방재기상 응답 → 자식해역 상태 판정 → subregion_lifecycle.json 갱신

**시그니처**:
```javascript
async function runJudgement(parentTongbomunState, afsoResult): Promise<{
  success: boolean,
  newSubregionsState: object,
  error: object | null
}>
```

**핵심 로직** (LOGIC 14의 9단계 중 1~9 모두 적용):
- Step 1: AFSO 응답 건전성 검사
- Step 2: 통보문 건전성 검사
- Step 3: 부모 자동 해제 처리 (자식 일괄 정리)
- Step 4: 행 분류 (parent / child / empty / active)
- Step 5: 매핑 적용 (region_alias_map.json)
- Step 6: 캡 규칙 적용 (자식 ≤ 부모)
- Step 7: 사라짐 카운트 갱신 (1회/2회 빠짐)
- Step 8: 동시 사라짐 잠금 검사
- Step 9: 영속화 (subregion_lifecycle.json 쓰기)

근거: `01_LOGIC/14_rule_order.md`, `01_LOGIC/05~13` 케이스 처리

---

### 1.3 [작업 19] `services/subregion_comparator.js` — 비교 검증

**책임**: 기존 로직 결과(weather_alerts.json children) + 신규 로직 결과(subregion_lifecycle.json) 비교 → 상이성 감지 → subregion_error_log.json 갱신

**시그니처**:
```javascript
async function runComparison(parentTongbomunState): Promise<{
  matches: number,
  mismatches: number,
  newMismatches: ComparisonMismatch[]
}>
```

**핵심 로직** (`separation/06_comparison_validation.md` 기반):
1. 매핑된 자식해역 49개에 대해
2. 각 자식의 기존 로직 결과 추출 (children 'Y'/null + 부모 통보문 상속)
3. 각 자식의 신규 로직 결과 추출 (subregion_lifecycle.json)
4. 비교 함수 호출 → diffType 판정
5. 상이성 발견 시:
   - subregion_error_log.json에 항목 추가/갱신
   - 푸시 발송 정책 검사 → 발송 결정
6. 통계 반환

---

### 1.4 [작업 20] 푸시 발송 정책 (subregion_comparator.js 안에 통합)

**정책** (`separation/06_comparison_validation.md` §5):
- HIGH severity: 1시간 간격 스팸 방지
- MEDIUM severity: 6시간 간격
- LOW severity: 발송 안 함

**구현 위치**: `subregion_comparator.js` 내부 함수로 통합 (별도 파일 분리 안 함)

**시그니처**:
```javascript
function shouldSendComparisonPush(severity, signature): boolean
```

`signature` = `subregionRegId + diffType` (스팸 방지 키)

---

### 1.5 [작업 5] `routes/subregion.js` — API 라우트

**4개 엔드포인트**:

| 메서드 | 경로 | 응답 |
|---|---|---|
| `GET` | `/api/subregion/state` | `subregion_lifecycle.json` 반환 |
| `GET` | `/api/subregion/error-log` | `subregion_error_log.json` 반환 |
| `POST` | `/api/subregion/error-ack` | 특정 오류 항목 acknowledged 처리 |
| `POST` | `/api/subregion/error-ack-all` | 모든 미확인 오류 acknowledged 처리 |

**server.js 등록**:
```javascript
// server.js의 다른 routes 등록 옆 (line 76 admin 다음 등 적절한 위치)
app.use(require('./routes/subregion'));
```

근거: `02_DATA_MODEL/05_error_log_schema.md`, `03_OPERATIONS/04_admin_ui.md`

---

## 2. 변경 파일 목록 (6개)

| # | 파일 | 종류 | 예상 크기 |
|---|---|---|---|
| 1 | `local_server/services/afso_poller.js` | 신규 | ~100줄 |
| 2 | `local_server/services/subregion_judge.js` | 신규 | ~250줄 |
| 3 | `local_server/services/subregion_comparator.js` | 신규 | ~200줄 |
| 4 | `local_server/routes/subregion.js` | 신규 | ~120줄 |
| 5 | `local_server/server.js` | 수정 | +1줄 (라우트 등록) |
| 6 | `00_docs/SUBREGION_ALERT/implementation/03_step3_backend.md` | 신규 | (본 문서) |

---

## 3. 검증 방법

### 3.1 모듈 단위 검증

각 모듈 작성 직후 require 가능한지 syntax 검증:
```bash
node -e "const m = require('/home/user/SEAGNAL/local_server/services/afso_poller'); console.log('afso_poller:', Object.keys(m))"
node -e "const m = require('/home/user/SEAGNAL/local_server/services/subregion_judge'); console.log('judge:', Object.keys(m))"
node -e "const m = require('/home/user/SEAGNAL/local_server/services/subregion_comparator'); console.log('comparator:', Object.keys(m))"
node -e "const r = require('/home/user/SEAGNAL/local_server/routes/subregion'); console.log('routes/subregion: typeof =', typeof r)"
```

### 3.2 afso_poller 실제 호출 검증

```javascript
// 단발 테스트 스크립트
const poller = require('/home/user/SEAGNAL/local_server/services/afso_poller');
poller.pollAfso().then(r => {
  console.log('success:', r.success);
  console.log('metData length:', r.metData ? r.metData.length : 'null');
  console.log('error:', r.error);
});
```
→ success=true, metData.length≈100, error=null 기대

### 3.3 라우트 등록 후 응답 확인 (서버 재시작 필요)

본 단계는 서버 재시작 안 함. 5단계에서 통합 후 검증.

### 3.4 운영 영향 확인

- 신규 모듈 5개는 서버 시작 시 require만 됨 (호출은 5단계에서)
- 기존 동작에 영향 없음
- subregion_lifecycle.json / subregion_error_log.json 빈 상태 유지

---

## 4. 롤백 방법

```bash
# 1. 신규 모듈 4개 삭제
rm /home/user/SEAGNAL/local_server/services/afso_poller.js
rm /home/user/SEAGNAL/local_server/services/subregion_judge.js
rm /home/user/SEAGNAL/local_server/services/subregion_comparator.js
rm /home/user/SEAGNAL/local_server/routes/subregion.js

# 2. server.js에서 routes/subregion 등록 라인 제거
```

---

## 5. 진입 직전 재검토 (4가지 관점)

### 5.1 문서 기반 적정성

- ✅ `01_LOGIC/14_rule_order.md` 9단계 처리 순서 → subregion_judge.js로 그대로 매핑
- ✅ `02_DATA_MODEL/01_api_spec.md` API 명세 → afso_poller.js에 그대로 구현
- ✅ `02_DATA_MODEL/03~05_*_schema.md` 스키마 → judge/comparator가 따름
- ✅ `separation/06_comparison_validation.md` 비교 알고리즘 → comparator.js로 구현
- ✅ 누락 없음

### 5.2 코드 기반 적정성

- ✅ `local_server/services/` 폴더 실존 (admin_push.js 등 다수 모듈)
- ✅ `local_server/routes/` 폴더 실존
- ✅ `services/admin_push.js:28-94` `sendAdminPush()` 함수 그대로 호출 가능
- ✅ `server.js:76` 다음에 라우트 추가 가능
- ✅ 기존 통보문 데이터 (weather_alerts.json) 읽기 패턴 확인 가능

### 5.3 로직 기반 적정성

- ✅ 신규 모듈 5개는 서로 독립 (afso_poller / judge / comparator / routes / push 정책)
- ✅ judge가 이전 사이클 상태 비교를 위해 subregion_lifecycle.json 읽기 → 첫 사이클은 빈 상태로 시작 → 안전
- ✅ comparator는 이전 사이클 비교 안 함 (현재 사이클 결과만 비교) → 첫 사이클부터 동작 가능
- ✅ 모든 모듈에 try/catch 적용 → 한 모듈 실패가 다른 모듈에 영향 없음
- ✅ 본 단계에서는 스케줄러 호출 없음 → 신규 모듈이 자동 실행 안 됨 → 운영 영향 0

### 5.4 누락 점검

- ✅ 작업 항목: 5개 모듈
- ✅ 변경 파일: 6개
- ✅ 검증 방법: 단위 + 호출 + 운영 영향
- ✅ 롤백: 명시
- ✅ 5단계와의 연결 명확 (스케줄러 통합은 5단계)

---

## 6. 진입 결정

**이상 없음**. 3단계 작업 진행.

---

## 7. 작업 진행 순서

```
[1] services/afso_poller.js 작성 + syntax 검증 + 실제 API 호출 검증
[2] services/subregion_judge.js 작성 + syntax 검증
[3] services/subregion_comparator.js 작성 + syntax 검증
[4] routes/subregion.js 작성 + syntax 검증
[5] server.js에 라우트 등록 + 서버 시작 가능 여부 확인 (단, 호출은 안 됨)
[6] git 커밋 + 푸시
[7] 3단계 완료 보고
```
