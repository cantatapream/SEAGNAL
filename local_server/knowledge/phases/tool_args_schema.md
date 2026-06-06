# 도구별 args 스키마 단일화 설계안

> 대상: `routes/assistant.js` 의 `TOOL_EXEC` / `TOOL_CATALOG` / `FOCUS_ZONE_ARG`(#22, L1466).
> 본 문서는 **설계만**. assistant.js 는 읽기 전용으로 분석함. 코드 수정 없음.

---

## 1. 현 인자표 (TOOL_EXEC 기준, L1128~1265)

> ※ TOOL_EXEC 실제 핸들러는 **20개**(아래 표 #1~#20과 1:1 대응). 흔히 "19도구"로 칭하나
>   `get_nearest_buoy`(#20)까지 포함하면 20개다. 표는 grep 대조로 인자명까지 전수 일치 확인됨.

| # | 도구 | 현재 args | 위치인자 | 보조/좌표 | 비고 |
|---|------|-----------|---------|-----------|------|
| 1 | get_marine_forecast | `{zone}` | zone | - | resolveZoneName |
| 2 | get_zone_forecast | `{zoneId, hoursAhead}` | zoneId(해구번호) | - | 위치인자 아님(격자번호) |
| 3 | get_warning | `{zone}` | zone | - | |
| 4 | get_midterm_forecast | `{zone}` | zone | - | ZONE_NAME_TO_CODE |
| 5 | list_buoys_near | `{zone}` | zone | - | |
| 6 | get_buoy_observation | `{buoyName}` | buoyName | - | 부이명(위치 아님) |
| 7 | get_visibility | `{place, zone, lat, lon}` | **place|zone** | lat,lon | place 우선, zone 폴백 |
| 8 | get_buoys_with_obs | `{zone, lat, lon}` | zone | lat,lon | |
| 9 | get_tide | `{place, lat, lon}` | place | lat,lon | |
| 10 | get_typhoon_status | `{}` | - | - | 무인자 |
| 11 | get_zones_ranked | `{metric, order, threshold, top, scope}` | - | - | 집계 전용(위치 없음) |
| 12 | get_app_capabilities | `{}` | - | - | 무인자 |
| 13 | get_fishing_index | `{location}` | location | - | |
| 14 | get_surfing_index | `{beach}` | beach | - | |
| 15 | get_sea_split_index | `{place}` | place | - | |
| 16 | get_seafog_cctv | `{harbor}` | harbor | - | 항구명 |
| 17 | get_current | `{zone, lat, lon, date}` | zone | lat,lon,date | coordsFor |
| 18 | get_depth | `{zone, lat, lon}` | zone | lat,lon | coordsFor |
| 19 | resolve_location | `{text}` | text | - | 임의 지명 |
| 20 | get_nearest_buoy | `{lat, lon}` | - | lat,lon | 좌표 전용 |

---

## 2. 불일치 식별

위치(지명/해역)를 받는 인자명이 **6종으로 분산**:

- `zone` : marine_forecast, warning, midterm, list_buoys_near, buoys_with_obs, current, depth (7)
- `place` : visibility, tide, sea_split_index (3)
- `location` : fishing_index (1)
- `beach` : surfing_index (1)
- `harbor` : seafog_cctv (1)
- `text` : resolve_location (1)

**비위치 인자(통일 대상 아님)** — 의미가 다르므로 그대로 둠:
- `zoneId`(해구 격자번호), `buoyName`(부이명), `lat/lon`(좌표), `date`, `hoursAhead`, `metric/order/threshold/top/scope`.

### 불일치가 일으킨 실제 회귀
주석(L1456~1458)에 명시: v3 에서 focus 후속 전파가 `args.zone` 만 채워
`get_tide(place)` / `get_buoy_observation(buoyName)` 등에 **무영향** → 연속 카테고리 -5p 회귀.
→ #22 가 `FOCUS_ZONE_ARG` 매핑 테이블로 임시 봉합 중. 이 테이블의 존재 자체가 인자명 분산의 증거.

---

## 3. 통일 스키마 제안 — `location` 단일 + 별칭 호환

### 3.1 원칙
1. **정규 위치인자 = `location`** (의미 중립, 해역/지명/해수욕장/항구 모두 포괄).
   - 사유: 이미 LLM 친화적이고, "위치"라는 개념이 도구 종류와 무관하게 일관됨.
2. **기존 인자명은 별칭(alias)으로 영구 유지** → LLM 프롬프트/캐시 무회귀.
   - `zone, place, beach, harbor` → `location` 의 별칭.
   - `text`(resolve_location)도 `location` 별칭으로 흡수 가능(선택).
3. **좌표(`lat/lon`)·격자(`zoneId`)·부이(`buoyName`)는 별도 정규 인자로 유지** (위치인자와 의미가 직교).
4. 도구 핸들러 진입 직전 **정규화 셰임(normalize shim)** 이 `location ← (zone||place||beach||harbor||text)` 로 채워 넣고, 기존 핸들러는 그대로 동작.

### 3.2 정규화 우선순위 (별칭 → location)
```
location := args.location ?? args.zone ?? args.place
         ?? args.beach ?? args.harbor ?? args.text
```
역방향(하위호환): 핸들러가 아직 zone/place 등을 읽으므로, 셰임이 **양방향 채움**.
단, **모든 별칭 키를 무차별로 채우지 말 것** — 도구가 읽지 않는 키까지 채우면(예: zone계 도구에
`harbor` 주입) 의미 없는 키가 args 에 섞여 검증·로깅·후속 분석을 흐린다. 해당 도구의 **정규(`location`)
+ 그 도구가 실제 읽는 별칭만** 채운다(도구별 읽는 별칭은 §3.4 kind / 1장 표의 "위치인자" 열로 결정):
```
const L = pickLocation(args);              // 위 우선순위
if (L != null) {
  args.location ??= L;                     // 정규형은 항상 채움
  for (const a of READ_ALIASES[tool] || [])// 그 도구가 실제 읽는 별칭만(예: visibility→[place,zone])
      args[a] ??= L;
}
```
- `get_visibility` 는 핸들러가 `place || zone` 둘 다 읽으므로 `READ_ALIASES = [place, zone]` (둘 다 채움).
- 그 외 zone계는 `[zone]`, place계는 `[place]`, surfing 은 `[beach]`, seafog 는 `[harbor]`, resolve 는 `[text]`.
→ 인자명이 무엇으로 들어와도 핸들러가 자기 이름으로 읽되, 불필요한 키 오염은 없음. **핸들러 코드 변경 불필요**(셰임만 추가).

### 3.3 focus 주입(#22) · canonZone 연계
- `FOCUS_ZONE_ARG` 테이블은 **셰임 도입 후 단순화 가능** → 모든 위치도구에 `location` 한 키만 채우면 됨:
  ```
  if (focusZone && WANTS_LOCATION.has(step.tool) && pickLocation(step.args) == null)
      step.args.location = focusZone;
  ```
  (단, 마이그레이션 무회귀를 위해 테이블은 당분간 병행 — 4장 순서 참조.)
- `canonZone(z)`(L1451): 현재 `args.zone` 만 정규화. 통일 후엔 **정규 위치인자에 일괄 적용**:
  ```
  const L = pickLocation(step.args);
  if (typeof L === 'string') {
      const c = canonZone(L);
      // 도구가 명명해역계일 때만 정규화 결과를 되쓴다(해수욕장/항구명은 보존)
  }
  ```
  ※ 주의: `canonZone`/`detectZoneDeterministic` 은 **해역명** 전용. `get_surfing_index(beach)`,
  `get_seafog_cctv(harbor)` 의 값은 해역명이 아니므로 정규화 대상에서 제외해야 함
  (= `LOCATION_KIND` 메타로 구분, 3.4 참조).
- 좌표 후속(`COORD_TOOLS`, L1481)·`zoneId`·`buoyName` 주입은 **현행 유지**(위치인자와 독립).

### 3.4 위치인자 종류(kind) 메타
정규화 시 어떤 값까지 canonZone 을 적용할지 판단하기 위해 도구별 위치 종류를 분류:

| kind | 도구 | canonZone 적용 |
|------|------|----------------|
| `zone` (명명해역) | marine_forecast, warning, midterm, list_buoys_near, buoys_with_obs, current, depth | O |
| `place` (지명/해역 혼용) | visibility, tide, sea_split_index | 조건부(해역이면 O) |
| `beach` (해수욕장) | surfing_index | X |
| `harbor` (항구) | seafog_cctv | X |
| `fishing` (낚시포인트) | fishing_index | X |
| `free` (임의텍스트) | resolve_location | X |

---

## 4. JSON Schema 도구 정의 (정규형)

각 도구를 선언적 스키마로 정의. `aliases` 와 `locationKind` 는 셰임/검증이 사용하는 확장 키.

```jsonc
// 위치도구 예시 — get_marine_forecast
{
  "name": "get_marine_forecast",
  "locationKind": "zone",
  "parameters": {
    "type": "object",
    "properties": {
      "location": { "type": "string", "description": "해상예보구역명(예: 제주도북부앞바다)" }
    },
    "required": ["location"],
    "aliases": { "zone": "location" }      // 별칭 → 정규
  }
}

// 좌표 겸용 — get_current
{
  "name": "get_current",
  "locationKind": "zone",
  "parameters": {
    "type": "object",
    "properties": {
      "location": { "type": "string" },
      "lat": { "type": "number" },
      "lon": { "type": "number" },
      "date": { "type": "string", "pattern": "^\\d{8}$" }
    },
    "anyOf": [ { "required": ["location"] }, { "required": ["lat","lon"] } ],
    "aliases": { "zone": "location" }
  }
}

// 좌표 전용 — get_nearest_buoy
{
  "name": "get_nearest_buoy",
  "parameters": {
    "type": "object",
    "properties": { "lat": {"type":"number"}, "lon": {"type":"number"} },
    "required": ["lat","lon"]
  }
}

// 격자번호 — get_zone_forecast (위치인자 아님)
{
  "name": "get_zone_forecast",
  "parameters": {
    "type": "object",
    "properties": {
      "zoneId": { "type": "string", "description": "해구 번호(예: 325)" },
      "hoursAhead": { "type": "number", "minimum": 0, "maximum": 72 }
    },
    "required": ["zoneId"]
  }
}

// 집계 전용 — get_zones_ranked (위치 없음)
{
  "name": "get_zones_ranked",
  "parameters": {
    "type": "object",
    "properties": {
      "metric":    { "enum": ["wave","wind","temp","vis"] },
      "order":     { "enum": ["desc","asc"], "default": "desc" },
      "threshold": { "type": "number" },
      "top":       { "type": "integer", "minimum": 1 },
      "scope":     { "enum": ["zone","haegu"], "default": "zone" }
    },
    "required": ["metric"]
  }
}

// 무인자 — get_typhoon_status / get_app_capabilities
{ "name": "get_typhoon_status", "parameters": { "type": "object", "properties": {} } }
```

별칭표(전체):
| 도구 | 정규 | 별칭 |
|------|------|------|
| get_visibility | location | place, zone |
| get_tide | location | place |
| get_sea_split_index | location | place |
| get_fishing_index | location | (별칭 없음 — 이미 정규형) |
| get_surfing_index | location | beach |
| get_seafog_cctv | location | harbor |
| get_current/get_depth/marine/warning/midterm/list_buoys_near/buoys_with_obs | location | zone |
| resolve_location | location | text |

---

## 5. 런타임 검증 방안

핸들러 실행 직전(`TOOL_EXEC[step.tool](args)` 호출 전, L1506 루프)에 **validate→normalize 게이트** 삽입:

1. **별칭 정규화** — `aliases` 로 별칭 값을 `location` 으로 승격(셰임, 3.2 양방향).
2. **타입 검증** — schema `properties` 타입 강제:
   - 숫자형(`lat,lon,hoursAhead,threshold,top`) → `Number()` 강제, `NaN` 이면 reject.
   - enum(`metric,order,scope`) → 미허용 값이면 reject 또는 default 대체.
   - `zoneId` → `String()` 강제(현재 핸들러도 `String(zoneId)` 함).
3. **필수 인자 검증** — `required`/`anyOf` 미충족 시:
   - 위치도구: focus/profileDefaultZone/location(GPS)에서 보강 시도(이미 #22 가 일부 수행).
   - 보강 실패 시 도구 **skip + 구조화 사유**(`{skipped:true, reason:'missing location'}`)를 results 에 남겨 synth 가 "위치를 알려주세요"로 응답하게 함(L1554 환각 가드와 정합).
4. **검증 결과 로깅** — 어떤 별칭이 들어왔는지 카운트 → 마이그레이션 진척/회귀 관측 지표.

검증기 형태(설계):
```
function validateAndNormalize(toolName, args, ctx) {
  const def = TOOL_SCHEMA[toolName];
  if (!def) return { ok:true, args };           // 미정의 도구는 통과(점진 적용)
  args = applyAliases(def, args);               // 별칭 → location (+ 역방향 채움)
  const errs = checkTypes(def, args);           // 타입/enum
  coerceNumbers(def, args);
  if (!satisfiesRequired(def, args)) {
     const filled = tryFillLocation(def, args, ctx.focus, ctx.profile, ctx.gps);
     if (!filled) return { ok:false, reason:'missing:'+def.locationKind };
  }
  return errs.length ? { ok:false, reason:errs.join(',') } : { ok:true, args };
}
```
※ 외부 라이브러리 불필요(ajv 미도입). 스키마가 작고 고정이라 경량 자체검증으로 충분.

---

## 6. 2차 자체검토 — 호환·무회귀 마이그레이션

### 6.1 TOOL_CATALOG(LLM 프롬프트) 호환
- **TOOL_CATALOG 의 인자명 표기는 당장 바꾸지 않는다.** LLM 이 학습/관성으로 내는 `zone/place/beach/harbor` 가 별칭으로 그대로 동작하므로 프롬프트 변경 불필요.
- 도구 디스크립션 임베딩 워밍업(`scheduleToolEmbedWarmup`, L907)은 **캐시 키가 텍스트 해시** → CATALOG 텍스트 불변이면 **재워밍업/캐시 무효화 없음**. (인자명 통일을 카탈로그에 반영하려면 별도 단계 + 캐시 재생성 필요 → 후순위.)
- 셰임은 양방향 채움이라, LLM 이 `location` 으로 주든 `zone` 으로 주든 동일 결과 → **출력 동치**.

### 6.2 무회귀 마이그레이션 순서
1. **(논리·코드무영향) 스키마 테이블 `TOOL_SCHEMA` + 별칭/kind 메타 추가** — 아직 호출 경로에 연결 안 함. 단위테스트로 스키마 자체 검증.
2. **셰임 삽입(양방향 채움)** — 실행 루프 직전. 별칭→location, location→별칭 동시 채움. 이 시점에 핸들러 코드는 **여전히 zone/place 등을 읽으므로 동작 동일**(순수 추가). 골든셋(`phase0_golden.jsonl`) 회귀 0 확인.
3. **검증 게이트 활성(경고 모드)** — reject 대신 로그만. 실데이터로 타입/필수 위반 빈도 수집. 회귀 없음 확인 후 enforce.
4. **#22 단순화** — `FOCUS_ZONE_ARG` 테이블을 `location` 단일 주입으로 치환하되, **셰임이 zone계 핸들러에 zone 도 채우므로** 기존 동작 보존. 골든셋 재확인 후 구테이블 제거.
5. **canonZone 일괄 적용** — 단, `locationKind ∈ {beach,harbor,fishing,free}` 는 제외(해역명 정규화가 오히려 매칭 깨뜨림). 서핑/해무/낚시 골든 케이스 회귀 확인.
6. **(선택·후순위) TOOL_CATALOG 인자명을 `location` 으로 표기 통일** — 임베딩 캐시 재생성·LLM 프롬프트 재검증 동반. 별칭은 영구 유지하므로 안전망 존재.

### 6.3 잔여 리스크 / 가드
- `get_visibility` 는 현재 `place||zone` 둘 다 받음 → 셰임이 `location` 으로 합쳐도 핸들러가 `place||zone` 을 읽으니, 셰임이 `place` 와 `zone` **둘 다** 채워야 함(3.2 역방향 채움이 보장).
- `resolve_location(text)` 를 `location` 별칭으로 흡수 시, "임의 지명"과 "해역명"의 의미 혼동 가능 → kind=`free` 로 canonZone 미적용 유지하면 안전. (별칭 흡수는 선택사항, 미적용해도 무방.)
- 좌표/격자/부이 인자는 통일 대상 아님을 문서·검증에 못박아 **과잉 통일 방지**.
- 검증 enforce 전 반드시 `phase0_golden.jsonl` + 연속(focus) 카테고리 회귀 측정 → -5p 회귀(L1457 사례) 재발 차단.

---

## 7. 요약
- 위치인자 6종(zone/place/location/beach/harbor/text) → **정규 `location` 1종 + 별칭 영구 유지**.
- 핸들러 코드 무변경: **양방향 셰임**이 정규/별칭을 상호 채움.
- 좌표·격자·부이·집계 인자는 의미 직교 → 통일 제외.
- JSON Schema(+aliases/locationKind) 선언 → 경량 자체검증(타입·필수·enum)으로 인자누락/타입오류 차단, 누락 시 focus/GPS 보강 또는 안전 skip.
- 마이그레이션: 스키마추가→셰임→검증(경고)→#22단순화→canonZone일괄→(선택)카탈로그표기, 각 단계 골든셋 회귀 0 확인. 임베딩 캐시는 카탈로그 텍스트 불변이면 무영향.
