# 2단계 상세 계획 — 데이터 파일 준비

## 0. 본 단계 목표

자식해역 처리에 필요한 신규 데이터 파일 3개를 준비하고, 클라우드 백업 시스템에 통합.

**위험도**: 매우 낮음 (신규 파일 추가 + 배열에 한 줄 추가)

---

## 1. 작업 항목 (2개)

### 1.1 [작업 6] 신규 데이터 파일 3개 생성

#### 1.1.1 `local_server/data/subregion_lifecycle.json` (신규, 빈 초기 상태)

자식해역 라이프사이클 영속화 파일.

**초기 내용**:
```json
{
  "schema_version": "1.0",
  "lastUpdated": null,
  "subregions": {},
  "stats": {
    "totalActive": 0,
    "totalEstimated": 0,
    "lastSuccessfulPoll": null
  }
}
```

근거: `02_DATA_MODEL/03_subregion_lifecycle_schema.md`

#### 1.1.2 `local_server/data/region_alias_map.json` (audit/에서 이동)

매핑 전수조사로 이미 작성된 파일을 운영 위치로 복사.

**작업**:
- 원본: `00_docs/SUBREGION_ALERT/audit/region_alias_map.json` (audit 시점, 보존)
- 복사 대상: `local_server/data/region_alias_map.json` (운영 위치, 신규)

**내용**:
- parents: 44개
- subregions: 49개
- groupParents: 7개 (정보성)
- unmapped: 0개
- removedFromAppTree: 1개 (인천경기북부앞바다중연안바다 좀비 항목 이력)

근거: `audit/AUDIT_REPORT_2026-05-01.md`

#### 1.1.3 `local_server/data/subregion_error_log.json` (신규, 빈 초기 상태)

자식해역 관련 오류 로그.

**초기 내용**:
```json
{
  "schema_version": "1.0",
  "lastUpdated": null,
  "errors": [],
  "stats": {
    "totalErrors": 0,
    "unacknowledged": 0,
    "byType": {}
  }
}
```

근거: `02_DATA_MODEL/05_error_log_schema.md`

---

### 1.2 [작업 10] cloud_backup.js에 region_alias_map.json 추가

**파일**: `local_server/cloud_backup.js`
**위치**: line 105-113 `targetFiles` 배열

**변경 전** (line 105-113):
```javascript
const targetFiles = [
    'visitors.json',
    'visitors_stats.json',
    'tidebed_config.json',
    'notice.json',
    'notices.json',
    'promo.json',
    'surveys.json'
];
```

**변경 후**:
```javascript
const targetFiles = [
    'visitors.json',
    'visitors_stats.json',
    'tidebed_config.json',
    'notice.json',
    'notices.json',
    'promo.json',
    'surveys.json',
    'region_alias_map.json'  // 자식해역 매핑 메타데이터 (정적, 운영자 관리)
];
```

**효과**:
- 매일 00:05 KST 클라우드 백업 시 region_alias_map.json도 백업 대상에 포함
- subregion_lifecycle.json과 subregion_error_log.json은 백업 대상에서 제외 (운영 상태이므로 의도적)

근거: `02_DATA_MODEL/08_persistence_backup.md` §4.3

---

## 2. 변경 파일 목록 (4개)

| # | 파일 | 종류 | 비고 |
|---|---|---|---|
| 1 | `local_server/data/subregion_lifecycle.json` | 신규 | 빈 초기 상태 |
| 2 | `local_server/data/region_alias_map.json` | 신규 | audit/에서 복사 |
| 3 | `local_server/data/subregion_error_log.json` | 신규 | 빈 초기 상태 |
| 4 | `local_server/cloud_backup.js` | 수정 | targetFiles에 1줄 추가 |

---

## 3. 검증 방법

### 3.1 파일 존재 확인

```bash
ls -la /home/user/SEAGNAL/local_server/data/subregion_*.json
ls -la /home/user/SEAGNAL/local_server/data/region_alias_map.json
```

### 3.2 JSON 무결성 확인

```bash
python3 -c "import json; json.load(open('/home/user/SEAGNAL/local_server/data/subregion_lifecycle.json'))"
python3 -c "import json; json.load(open('/home/user/SEAGNAL/local_server/data/region_alias_map.json'))"
python3 -c "import json; json.load(open('/home/user/SEAGNAL/local_server/data/subregion_error_log.json'))"
```

### 3.3 매핑 테이블 무결성 검증 (region_alias_map.json)

```python
import json
m = json.load(open('region_alias_map.json'))
errors = []

# parents 검증
for regId in m['parents']:
    assert regId.startswith('S') and len(regId) == 8

# subregions 검증
for regId, info in m['subregions'].items():
    assert regId.startswith('S')
    assert info['parentRegId'] in m['parents'], \
        f"parent {info['parentRegId']} not in parents"

print(f"parents: {len(m['parents'])}, subregions: {len(m['subregions'])}")
print("OK")
```

### 3.4 cloud_backup.js 변경 확인

```bash
grep -A 10 "const targetFiles" /home/user/SEAGNAL/local_server/cloud_backup.js
# 'region_alias_map.json' 포함 확인
```

### 3.5 운영 영향 확인

- index2 사용자 화면: 변화 없음 (데이터 파일은 아직 사용 안 됨)
- index1 사용자 화면: 변화 없음 (3단계까지는 사용 안 됨)
- 스케줄러: 정상 동작 (변경 없음)
- 클라우드 백업: 다음 사이클 (00:05 KST)에 region_alias_map.json 포함 여부 확인 (추후)

---

## 4. 롤백 방법

1. 신규 데이터 파일 3개 삭제:
   ```bash
   rm /home/user/SEAGNAL/local_server/data/subregion_lifecycle.json
   rm /home/user/SEAGNAL/local_server/data/region_alias_map.json
   rm /home/user/SEAGNAL/local_server/data/subregion_error_log.json
   ```
2. cloud_backup.js의 `'region_alias_map.json'` 라인 제거

---

## 5. 진입 직전 재검토 (4가지 관점)

### 5.1 문서 기반 적정성

- ✅ 본 단계가 `separation/03_risk_assessment.md`의 "2단계 데이터 파일 준비"와 일치
- ✅ 작업 6, 10이 모두 포함됨
- ✅ 스키마는 `02_DATA_MODEL/03, 04, 05`와 일치
- ✅ 백업 정책은 `02_DATA_MODEL/08`과 일치 (region_alias_map만 백업)
- ✅ 누락 없음

### 5.2 코드 기반 적정성

- ✅ `local_server/data/` 디렉토리 실존, 다른 데이터 파일들과 같은 위치
- ✅ `local_server/cloud_backup.js:105-113` `targetFiles` 배열 실존
- ✅ `audit/region_alias_map.json` 실존, 정상 JSON (15334 bytes)
- ✅ 동일 이름의 파일이 운영 위치에 없음 (충돌 없음)

### 5.3 로직 기반 적정성

- ✅ 빈 파일 생성은 어떤 코드도 호출하지 않음 (3단계 이후 사용 시작)
- ✅ cloud_backup의 targetFiles 추가는 단순 배열 추가 (다음 백업 사이클부터 포함)
- ✅ 기존 데이터 파일 무영향
- ✅ 사용자 화면 무영향

### 5.4 누락 점검

- ✅ 작업 항목: 작업 6 (3개 파일) + 작업 10 (백업 추가)
- ✅ 변경 파일 목록: 4개
- ✅ 검증 방법: 5개 항목
- ✅ 롤백 방법: 명시
- ✅ 위험도: '매우 낮음'

---

## 6. 진입 결정

**이상 없음**. 2단계 작업 진행.

---

## 7. 작업 진행 순서

```
[1] subregion_lifecycle.json 빈 파일 생성
[2] subregion_error_log.json 빈 파일 생성
[3] audit/region_alias_map.json → local_server/data/ 복사
[4] cloud_backup.js의 targetFiles에 region_alias_map.json 추가
[5] 검증 (5가지)
[6] git 커밋 + 푸시
[7] 2단계 완료 보고
```
