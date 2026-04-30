# 자식해역 특보 표출 — 2.9 매핑 전수조사 절차

## 0. 본 파일의 위치

본 파일은 `02_DATA_MODEL/` 시리즈의 마지막(아홉 번째) 파일이며, 본 작업 시작 전 **1회성 사전 작업**으로 수행해야 하는 매핑 전수조사 절차를 정리합니다.

---

## 1. 전수조사의 목적

### 1.1 목적

본 작업이 시작되기 전에 방재기상시스템과 우리 앱 사이의 모든 해역 매핑을 미리 확인하여 매핑 테이블을 완전한 상태로 초기화합니다.

### 1.2 왜 필요한가

- 운영 중 매핑 누락이 발생하면 사용자에게 자식해역 정보가 누락됨
- 사전에 모든 해역을 매핑해두면 운영 중 누락 빈도를 최소화
- 미세한 표기 차이("평수구" vs "평수구역" 등)를 사전에 발견하고 보정

### 1.3 본 작업의 사용자 결정

사용자는 이 전수조사를 본 작업 시작 전에 **반드시 수행**할 것을 결정했습니다.

---

## 2. 전수조사의 범위

### 2.1 대상

- 우리 앱이 자식해역으로 다룰 모든 해역
- 그 자식해역들의 모든 부모해역

### 2.2 매핑 항목

각 자식해역에 대해 다음을 확인합니다.

- 방재기상의 `regId`
- 방재기상의 `regKo`
- 우리 앱에서 부르는 한글 이름
- 부모해역의 방재기상 `regId`

### 2.3 부모해역 매핑

각 부모해역에 대해 다음을 확인합니다.

- 방재기상의 `regId`
- 방재기상의 `regKo`
- 우리 앱에서 부르는 한글 이름
- 통보문 시스템의 식별자 (있을 경우)

---

## 3. 전수조사 절차 (단계별)

### 3.1 Step 1 — 방재기상 응답 수집

활동량이 평균적인 시기에 방재기상 API를 한 번 호출하여 모든 해역 행을 수집합니다.

```
curl -X POST "https://afso.kma.go.kr/afsOut/mmr/warning/retMmrWarningSeaNow.kajx" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "tmFc=$(date +%Y%m%d%H%M)&stnId=108&fe=f&mmr=mmr&tmFe=" \
  -o /tmp/afso_full_dump.json
```

응답에는 모든 부모해역(`wrnSeq=99` 빈 행 포함)과 모든 자식해역이 들어 있어야 합니다.

### 3.2 Step 2 — 응답에서 모든 regId/regKo 추출

```
function extractAllRegions(response):
  parents = []
  subregions = []

  for row in response.data.metData:
    if row.regId == row.regUp:
      parents.push({ regId: row.regId, regKo: row.regKo })
    else:
      subregions.push({
        regId: row.regId,
        regKo: row.regKo,
        parentRegId: row.regUp
      })

  return { parents, subregions }
```

### 3.3 Step 3 — 우리 앱의 해역 마스터 조회

우리 앱 코드에서 자식해역 이름 목록을 추출합니다. 가능한 경로:

- 기존 코드의 자식해역 정의 파일 (예: `seaZonesData.js`, `zoneOverlayConfig.js`)
- 기상청 텍스트 스크래핑에서 사용하는 매핑

### 3.4 Step 4 — 두 목록을 한글 이름으로 매칭

```
function matchByName(afsoRegions, appRegions):
  matched = []
  unmatched_in_afso = []  # 방재기상에는 있는데 앱에 없음
  unmatched_in_app = []   # 앱에는 있는데 방재기상에 없음

  for afsoRegion in afsoRegions:
    found = appRegions.find(r => r.name == afsoRegion.regKo)
    if found != null:
      matched.push({ afso: afsoRegion, app: found })
    else:
      # 정확 매칭 실패 → fuzzy 매칭 시도
      fuzzyFound = findFuzzyMatch(afsoRegion.regKo, appRegions)
      if fuzzyFound != null:
        matched.push({ afso: afsoRegion, app: fuzzyFound, fuzzy: true })
      else:
        unmatched_in_afso.push(afsoRegion)

  for appRegion in appRegions:
    if not matched.some(m => m.app.name == appRegion.name):
      unmatched_in_app.push(appRegion)

  return { matched, unmatched_in_afso, unmatched_in_app }
```

### 3.5 Step 5 — Fuzzy 매칭 결과 검토

표기 차이로 fuzzy 매칭된 해역을 운영자가 일일이 검토하여 정말 같은 해역인지 확인:

- "서해남부남쪽안쪽먼바다중조도부근평수구" ↔ "서해남부남쪽안쪽먼바다중조도부근평수구역" → 같음
- "OOO연안" ↔ "OOO연안바다" → 검토 필요

### 3.6 Step 6 — 매핑 테이블 초기 생성

검증된 매핑을 `region_alias_map.json` 파일에 작성:

```
{
  "schema_version": "1.0",
  "lastUpdated": "...",
  "parents": { ... 매칭된 부모들 ... },
  "subregions": { ... 매칭된 자식들 ... },
  "unmapped": []
}
```

### 3.7 Step 7 — 매칭 안 된 해역 검토

- `unmatched_in_afso`: 방재기상에는 있는데 앱에 없는 해역. 정말 우리 앱에서 다루지 않는 해역인지 확인
- `unmatched_in_app`: 앱에는 있는데 방재기상에 없는 해역. 코드 체계 차이 또는 우리 앱의 잘못된 정의일 수 있음

### 3.8 Step 8 — 무결성 검증

매핑 테이블 무결성 검증 함수 (`07_data_validation.md`)를 통과하는지 확인.

---

## 4. Fuzzy 매칭 알고리즘

### 4.1 단순 유사도 매칭

```
function findFuzzyMatch(afsoName, appRegions):
  bestMatch = null
  bestScore = 0

  for appRegion in appRegions:
    score = similarity(afsoName, appRegion.name)
    if score > bestScore and score >= 0.85:
      bestScore = score
      bestMatch = appRegion

  return bestMatch

function similarity(a, b):
  # 단순 Levenshtein 거리 기반
  distance = levenshtein(a, b)
  maxLen = max(a.length, b.length)
  return 1 - (distance / maxLen)
```

### 4.2 한국어 특화 매칭

한국어 표기 차이 패턴을 고려한 보조 함수:

```
function normalizeKoreanRegionName(name):
  # 끝의 "바다", "역" 같은 흔한 보조어 정규화
  normalized = name.replace(/(연안)$/, "$1바다")
  normalized = normalized.replace(/(평수구)$/, "$1역")
  return normalized
```

### 4.3 매뉴얼 검토 필수

Fuzzy 매칭 결과는 **반드시 매뉴얼 검토** 후 매핑 테이블에 반영. 자동 매칭만 신뢰하면 잘못된 매핑이 발생 가능.

---

## 5. 전수조사 결과 보고서

### 5.1 보고서 항목

전수조사 결과를 다음 형식으로 정리하여 운영자/관리자가 검토:

```markdown
# 자식해역 매핑 전수조사 결과 (2026-04-30)

## 요약
- 방재기상 응답 행 수: 215
  - 부모 행 수: 35
  - 자식 행 수: 180
- 우리 앱 해역 수: 178
- 정확 매칭: 165
- Fuzzy 매칭 (검토 필요): 12
- 매칭 실패 (방재기상): 3
- 매칭 실패 (우리 앱): 13

## Fuzzy 매칭 검토 필요 (12개)
| 방재기상 | 우리 앱 | 유사도 |
|---|---|---|
| OO평수구 | OO평수구역 | 0.95 |
| ... | ... | ... |

## 매칭 실패 — 방재기상에만 있음 (3개)
- regId=S2NEW0001, regKo="새로운해역"
  → 우리 앱에서 다룰지 결정 필요
- ...

## 매칭 실패 — 우리 앱에만 있음 (13개)
- name="OO앞바다"
  → 방재기상 응답에 없음. 우리 앱 정의 점검 필요
- ...
```

### 5.2 보고서 위치

작성 시점에는 다음 위치에 저장:

```
00_docs/SUBREGION_ALERT/audit_results_YYYY-MM-DD.md
```

---

## 6. 전수조사 도구 (선택)

### 6.1 일회성 스크립트

전수조사를 자동화하는 일회성 Node.js 스크립트 작성을 권장:

```javascript
// local_server/scripts/audit_subregion_mapping.js

const axios = require('axios')
const fs = require('fs')
const path = require('path')

async function audit() {
  // Step 1: 방재기상 호출
  const response = await callAfsoApi()

  // Step 2: 추출
  const { parents, subregions } = extractAllRegions(response)

  // Step 3: 앱 해역 로드
  const appRegions = loadAppRegions()

  // Step 4-5: 매칭
  const result = matchByName(parents, subregions, appRegions)

  // Step 6-8: 보고서 생성
  fs.writeFileSync('./audit_report.md', formatReport(result))

  console.log("Audit done. See ./audit_report.md")
}

audit()
```

### 6.2 스크립트 위치

```
local_server/scripts/audit_subregion_mapping.js
```

이 스크립트는 본 작업 도입 시 1회 실행 후 보존. 향후 매핑 정기 점검에도 재사용 가능.

---

## 7. 전수조사 후 정기 점검

### 7.1 정기 재점검

매핑 테이블은 시간이 지나면서 변화할 수 있습니다.

- 새 해역 추가 (드묾)
- 해역 이름 변경 (드묾)

### 7.2 권장 주기

- 분기별 1회 (또는 반기별 1회) 자동 매칭 점검
- 운영 중 `unmapped` 섹션 누적 시 즉시 점검

### 7.3 점검 도구

위의 일회성 스크립트를 정기 도구로 발전시킬 수 있음. 점검 결과를 통합관리자 센터에 표시.

---

## 8. 본 파일 마무리 — DATA_MODEL 시리즈 완료

본 파일을 끝으로 `02_DATA_MODEL/` 시리즈가 완료됩니다. 본 시리즈에서 정리한 내용:

- 방재기상 API 명세 (01)
- 응답 필드 의미 (02)
- subregion_lifecycle.json 스키마 (03)
- region_alias_map.json 스키마 (04)
- subregion_error_log.json 스키마 (05)
- 매핑 운영 정책 (06)
- 데이터 검증 규칙 (07)
- 영속화 / 백업 정책 (08)
- 매핑 전수조사 절차 (09)

다음 시리즈는 `03_OPERATIONS/` 입니다.

- 오류 분류
- 오류 처리 정책
- 관리자 푸시 알림 통합
- 통합관리자 센터 UI
- 로그 형식 (서술형)
- index1/index2 분리 전략
- 24시간 stale 안전장치
- 롤아웃 전략
- 향후 검증 사항
