# 자식해역 특보 표출 — 2.8 영속화 / 백업 정책

## 0. 본 파일의 위치

본 파일은 `02_DATA_MODEL/` 시리즈의 여덟 번째 파일이며, 신규 데이터 파일들의 영속화 방식과 백업 정책을 정리합니다.

---

## 1. 영속화 대상 파일 (3개)

본 작업으로 추가되는 영속 파일은 다음 3개입니다.

| 파일 | 갱신 빈도 | 갱신 주체 |
|---|---|---|
| `subregion_lifecycle.json` | 매 1분 사이클 | 코드 (자동) |
| `region_alias_map.json` | 매핑 누락 시 unmapped 부분만 | 코드 (자동) + 운영자 (수동) |
| `subregion_error_log.json` | 오류 발생 시 | 코드 (자동) + 운영자 (acknowledge 시) |

---

## 2. 원자적 쓰기 패턴

### 2.1 패턴 정의

JSON 파일 쓰기 도중 서버가 죽으면 파일이 손상될 수 있습니다. 이를 방지하기 위해 **임시 파일 + rename** 패턴을 사용합니다.

```
function atomicWriteJson(filePath, data):
  tmpPath = filePath + ".tmp"

  # Step 1: 임시 파일에 쓰기
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2))

  # Step 2: 원자적 rename
  fs.renameSync(tmpPath, filePath)
```

### 2.2 패턴의 효과

- Step 1 도중 서버 죽음 → 원본 파일은 그대로 유지, 임시 파일만 손상
- Step 2 도중 서버 죽음 → rename은 OS 단위 원자적 연산이므로 부분 실패 없음
- 결과: 원본 파일은 항상 일관된 상태 유지

### 2.3 모든 영속화 파일에 적용

```
function saveSubregionLifecycle(state):
  state.lastUpdated = nowISO()
  atomicWriteJson("local_server/data/subregion_lifecycle.json", state)

function saveAliasMap(map):
  map.lastUpdated = nowISO()
  atomicWriteJson("local_server/data/region_alias_map.json", map)

function saveErrorLog(log):
  log.lastUpdated = nowISO()
  atomicWriteJson("local_server/data/subregion_error_log.json", log)
```

---

## 3. 영속화 빈도

### 3.1 subregion_lifecycle.json

- 매 1분 사이클의 Step 3.9에서 갱신
- 변화 없는 사이클에서도 `lastUpdated` 갱신을 위해 매번 쓸지 vs 변화 있을 때만 쓸지는 성능 고려 사항

권장: 변화가 없으면 쓰지 않음 (디스크 I/O 절감).

```
function saveSubregionLifecycleIfChanged(currentState, previousState):
  if hasMeaningfulChange(currentState, previousState):
    saveSubregionLifecycle(currentState)
```

### 3.2 region_alias_map.json

- `unmapped` 섹션 갱신 시에만 쓰기
- 운영자 수동 편집 시 운영자가 직접 저장

### 3.3 subregion_error_log.json

- 새 오류 발생 시
- 오류 acknowledge 시
- 그 외 변화 없으면 쓰지 않음

---

## 4. 백업 시스템과의 통합

### 4.1 기존 백업 시스템

기존 시스템에는 일일 클라우드 백업이 설정되어 있습니다.

- 위치: `local_server/scheduler.js:104-131`
- 호출: `cloudBackup.performBackup()`
- 시각: 매일 00:05 KST

### 4.2 백업 대상 추가

신규 3개 파일을 백업 대상에 추가해야 합니다.

```
[기존 백업 대상에 추가할 파일 목록]
- weather_alerts.json
- active_lifecycle.json
- (기타 기존 데이터 파일)
+ subregion_lifecycle.json     ← 신규
+ region_alias_map.json        ← 신규
+ subregion_error_log.json     ← 신규
```

### 4.3 cloudBackup 모듈 수정

```
[cloudBackup.js 수정 예시]

const BACKUP_FILES = [
  "weather_alerts.json",
  "active_lifecycle.json",
  ...,
  "subregion_lifecycle.json",   // 신규
  "region_alias_map.json",       // 신규
  "subregion_error_log.json"     // 신규
]

async function performBackup():
  for file in BACKUP_FILES:
    await uploadFile(file)
```

### 4.4 백업 누락 방지

신규 파일이 백업에서 누락되지 않도록 다음 검증 권장:

- 시작 시 `BACKUP_FILES` 배열에 모든 신규 파일이 포함되었는지 확인
- 신규 파일을 추가할 때 백업 모듈도 함께 갱신하는 코드 리뷰 체크리스트

---

## 5. 복구 시나리오

### 5.1 정상 재시작

서버 재시작 시 영속화 파일에서 자동 복구:

```
function startup():
  state = loadFromFile("subregion_lifecycle.json")
  aliasMap = loadFromFile("region_alias_map.json")
  errorLog = loadFromFile("subregion_error_log.json")

  if state == null:
    state = { schema_version: "1.0", subregions: {}, lastUpdated: null }

  ...
```

### 5.2 파일 손상 시

원자적 쓰기 덕분에 파일 손상 가능성은 낮지만, 만약 발생한다면:

- 서버 시작 시 JSON 파싱 실패 → 운영 알림
- 백업에서 가장 최근 정상 파일 복원
- 일부 데이터 손실 가능 (백업 시점 ~ 복원 시점 사이)

### 5.3 복구 절차

```
1. 서버 정지
2. 손상 파일 확인
3. 백업에서 가장 최근 정상 파일 복원
4. 서버 재시작
5. 영속화 정상 동작 확인
6. 운영 로그 점검
```

---

## 6. 메모리 ↔ 파일 동기화

### 6.1 메모리 캐시

자식해역 상태는 매 사이클 메모리에 보관하면서 파일에도 영속화됩니다.

```
let inMemoryState = null

function loadOnStart():
  inMemoryState = loadFromFile("subregion_lifecycle.json")

function updateAndPersist(changes):
  applyChanges(inMemoryState, changes)
  saveSubregionLifecycle(inMemoryState)
```

### 6.2 동기화 보장

- 모든 변경은 메모리에 먼저 적용
- 메모리 변경 후 즉시 영속화
- 영속화 실패 시 메모리도 롤백 (또는 다음 사이클 재시도)

### 6.3 다중 프로세스 주의

본 작업은 단일 Node.js 프로세스에서 동작한다는 가정 하에 설계됩니다.

- 다중 프로세스에서 같은 파일 동시 쓰기 → 충돌 가능
- 만약 멀티 프로세스로 확장 시 별도 락 메커니즘 필요

---

## 7. 영속화 실패 시 처리

### 7.1 실패 케이스

영속화는 다음 이유로 실패할 수 있습니다.

- 디스크 가득
- 권한 문제
- 임시 파일 작성 실패
- rename 실패

### 7.2 실패 시 동작

```
function saveSubregionLifecycleSafely(state):
  try:
    atomicWriteJson("subregion_lifecycle.json", state)
    return SUCCESS
  catch e:
    log("[영속화 실패] " + e.message)
    triggerAdminPush("자식해역 상태 영속화 실패: " + e.message)
    return FAILURE
```

### 7.3 실패 누적 시

영속화 실패가 누적되면 메모리만 갱신되고 디스크가 stale 상태:

- 서버 재시작 시 데이터 유실
- 그 동안의 자식해역 상태 변화 모두 손실
- 따라서 영속화 실패는 **즉시 운영 알림** 대상

---

## 8. 영속화 성능 최적화

### 8.1 쓰기 빈도 줄이기

- 변화 없으면 쓰지 않기 (Diff 비교)
- 변화 단위가 작으면 한 사이클에서 모아 쓰기

### 8.2 비동기 쓰기

영속화는 비동기로 수행하여 메인 처리 흐름에 영향 최소화:

```
async function persistAsync(state):
  return new Promise((resolve, reject) => {
    fs.writeFile("subregion_lifecycle.json.tmp", JSON.stringify(state), (err) => {
      if (err) reject(err)
      else fs.rename("subregion_lifecycle.json.tmp", "subregion_lifecycle.json", resolve)
    })
  })
```

### 8.3 1분 주기 처리에서의 영속화 시간

영속화 시간이 1분을 넘지 않도록 권장. 일반적으로 100ms 미만 소요 예상.

---

## 9. 백업 데이터 검증

### 9.1 백업 후 검증

cloudBackup 후 업로드된 파일이 정상인지 검증:

- 파일 크기가 0이 아닌지
- JSON 파싱 가능한지
- 핵심 필드 (schema_version 등) 존재 여부

### 9.2 백업 실패 시 알림

백업 실패도 운영 알림 대상.

---

## 10. 본 파일 다음 작업

- 다음 파일: `09_full_audit_procedure.md`
- 주제: 매핑 전수조사 사전 작업 절차
