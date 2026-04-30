# 자식해역 특보 표출 — 2.6 매핑 테이블 운영 정책

## 0. 본 파일의 위치

본 파일은 `02_DATA_MODEL/` 시리즈의 여섯 번째 파일이며, 매핑 테이블의 일상 운영 정책을 정리합니다.

스키마 자체는 이전 파일(`04_alias_map_schema.md`)에서 정의되었으며, 본 파일은 그 운영 측면을 다룹니다.

---

## 1. 매핑 테이블의 역할 재정리

### 1.1 핵심 역할

매핑 테이블은 두 시스템 간 해역 식별자/이름의 차이를 보정합니다.

- 방재기상시스템 (외부) ↔ 우리 앱 (내부)
- regId 기준 매핑 + regKo 보조 검증

### 1.2 두 시스템의 차이 유형

- **표기 차이**: "평수구" vs "평수구역" 같은 미세한 한글 차이
- **신규 해역**: 한 쪽에 있는데 다른 쪽에 없는 해역
- **이름 변경**: 한 쪽이 이름을 변경했는데 다른 쪽은 그대로

본 매핑 테이블은 표기 차이와 신규 해역을 다룹니다. 이름 변경은 운영자 수동 갱신.

---

## 2. 운영 라이프사이클

### 2.1 초기 구축 (1회성)

본 작업 시작 전 매핑 테이블을 초기화합니다.

- 절차: `09_full_audit_procedure.md`
- 결과: 모든 부모/자식 해역의 매핑이 채워짐

### 2.2 일상 운영 (자동)

코드가 자동으로 수행:

- 매핑 누락 발견 시 → `unmapped` 섹션에 자동 추가
- 같은 누락이 재발생 → `occurrenceCount` 증가
- 첫 발견 시 관리자 푸시 알림

### 2.3 일상 운영 (수동)

운영자가 수동으로 수행:

- `unmapped` 섹션 검토
- 새 해역 매핑 결정
- `subregions` 섹션에 추가
- `unmapped`에서 해당 항목 제거

### 2.4 비상 운영

- 매핑 테이블 무결성 위반 발견 시
- 매핑 테이블이 완전 손상된 경우
- 백업에서 복구

---

## 3. 매핑 누락 처리 정책

### 3.1 발견 흐름

```
방재기상 응답 행 → regId 추출 → 매핑 테이블 조회 → 매핑 없음 발견
   → unmapped 섹션에 추가 (또는 카운트 증가)
   → subregion_error_log.json에 오류 기록
   → 첫 발견이면 관리자 푸시 알림
   → 그 행은 무시하고 다음 행 처리
```

### 3.2 함수 형태

```
function processChildRow(afsoRow):
  appName = lookupAppName(afsoRow.regId)

  if appName == null:
    handleMappingMissing(afsoRow)
    return  # 무시

  # 정상 처리
  ...

function handleMappingMissing(afsoRow):
  recordUnmapped(afsoRow)  # alias_map.json의 unmapped 섹션 갱신

  recordError(
    errorType: "MAPPING_MISSING",
    info: {
      function: "lookupAppName",
      file: "subregion_judge.js",
      afsoRegId: afsoRow.regId,
      afsoRegKo: afsoRow.regKo,
      parentRegId: afsoRow.regUp
    },
    narrative: "${nowKo()}, 방재기상시스템에서 자식해역 정보를 받았으나, 우리 앱의 매핑 테이블에 등록되지 않은 해역이 있습니다. 방재기상 코드: ${afsoRow.regId}, 방재기상 이름: ${afsoRow.regKo}, 부모해역: ${afsoRow.regUp}, 발효 특보: ${afsoRow.wrnTp} ${afsoRow.wrnLvlName}",
    actionRequired: "region_alias_map.json 파일에 이 해역을 추가해주세요. 추가 전까지 이 해역의 특보 정보는 사용자에게 표시되지 않습니다."
  )
```

### 3.3 사용자 영향

- 매핑 누락 자식해역은 우리 앱 화면에 **표시되지 않음**
- 사용자에게는 그 해역에 특보가 없는 것처럼 보임
- 안전 측 영향이 아님 (정보 누락 위험)

### 3.4 신속 대응 권장

매핑 누락 발견 시 운영자는 가능한 빨리 매핑 추가:

- 통합관리자 센터에서 발견 즉시 대응
- 매핑 추가 → 다음 사이클부터 정상 표시

---

## 4. 매핑 추가 작업 절차 (수동)

### 4.1 운영자 작업 단계

1. 통합관리자 센터의 자식해역 오류 영역에서 매핑 누락 항목 확인
2. 평문 서술에서 방재기상 regId, 이름, 부모 정보 파악
3. `region_alias_map.json` 파일 편집
4. `subregions` 섹션에 새 항목 추가:
   ```json
   "S2NEW0000": {
     "afsoRegKo": "방재기상 이름",
     "appRegKo": "우리 앱 이름",
     "parentRegId": "부모 regId"
   }
   ```
5. `unmapped` 섹션에서 해당 항목 제거 (선택)
6. 파일 저장
7. 다음 1분 사이클에 자동 반영 확인
8. 통합관리자 센터에서 해당 오류 항목 "확인 완료" 처리

### 4.2 매핑 추가 시 주의사항

- `appRegKo`는 우리 앱 다른 곳(seaZones, 화면 표시 등)에서 사용하는 이름과 일치해야 함
- `parentRegId`는 `parents` 섹션에 존재해야 함
- 추가 후 코드의 무결성 검증 통과 확인

### 4.3 운영 도구 (선택)

매핑 추가 작업을 통합관리자 센터에서 직접 할 수 있는 UI를 제공할지는 추후 결정. 본 작업의 1차 범위는 파일 직접 편집.

---

## 5. 매핑 테이블의 캐싱 전략

### 5.1 메모리 캐시

매핑 테이블은 자주 조회되므로 메모리 캐시 권장.

```
let mapCache = null
let mapMtime = null

function getMappingMap():
  stat = fs.statSync("region_alias_map.json")
  if mapCache == null or stat.mtimeMs != mapMtime:
    mapCache = JSON.parse(fs.readFileSync("region_alias_map.json"))
    mapMtime = stat.mtimeMs
  return mapCache
```

### 5.2 변경 감지

파일 mtime을 비교하여 매핑 테이블이 갱신되었는지 감지. 갱신되면 다음 호출에서 자동 reload.

### 5.3 핫 리로드

서버 재시작 없이도 매핑 테이블 변경이 즉시 반영됨.

---

## 6. 매핑 테이블 변경 감사 (audit)

### 6.1 변경 이력

매핑 테이블은 운영자가 수동 편집하므로 변경 이력 추적 권장.

### 6.2 권장 방안

- Git 추적: `region_alias_map.json`을 git에 포함시키고 커밋 이력으로 추적
- 또는 별도 audit 로그: 변경 시점/내용을 별도 파일에 기록

### 6.3 본 작업의 범위

본 작업의 1차 범위에서는 git 추적으로 충분. 별도 audit 로그는 미포함.

---

## 7. 매핑 테이블 무결성 검증

### 7.1 시작 시 검증

서버 시작 시 또는 매핑 테이블 reload 시 무결성 검증:

```
function validateAndLoadMap():
  raw = fs.readFileSync("region_alias_map.json")
  map = JSON.parse(raw)

  errors = validateAliasMap(map)
  if errors.length > 0:
    log("[매핑 테이블 무결성 위반]")
    for err in errors:
      log("  - " + err)
    triggerAdminPush("매핑 테이블에 무결성 위반이 있습니다. 점검 필요.")
    return null

  return map
```

### 7.2 무결성 위반 시 동작

- 운영 알림
- 매핑 테이블 사용 불가 → 모든 자식해역 매핑 누락으로 처리
- 그러나 시스템은 계속 동작 (자식해역 표시만 누락)
- 운영자 수정 후 핫 리로드로 복구

---

## 8. 매핑 누락의 통계

### 8.1 누락 패턴 분석

`unmapped` 섹션의 데이터로 다음 통계를 추출 가능:

- 가장 자주 누락되는 해역 → 매핑 추가 우선순위
- 누락 발생 빈도 → 운영 작업량 추정
- 누락 후 매핑까지 평균 소요 시간 → 운영 SLA

### 8.2 모니터링

운영 통계는 `subregion_error_log.json`의 `stats` 섹션 또는 별도 모니터링 도구에서 집계.

---

## 9. 본 파일 다음 작업

- 다음 파일: `07_data_validation.md`
- 주제: 데이터 검증 규칙 (응답 / 매핑 / 자식 상태)
