# 패치 A — 연속(ANG-2-01b) + local_gov 관내(LG-1-01) 잔존 결함 직타 설계

Sentinel 회귀 게이트의 두 실패 케이스를 설계 단위로 분해하고, runBrain/planQuery 후처리에서 결정론적으로 막을 패치안을 제시한다. **본 문서는 설계만**이며 코드 수정은 별도 PR.

---

## 1. ANG-2-01b 원인 분석 — "거기 풍속은?" 빈 응답

### 1.1 선행 턴 (ANG-2-01a) 의 focus 상태

- query: "거문도 파고 알려줘", profile=`{purpose:"낚시"}` → 직군 미감지(angler 키워드 매칭 미달).
- planQuery 규칙 line 1375-1376 ("섬·항·해안 지명…먼저 get_buoy_observation") 적용 → `get_buoy_observation(buoyName="거문도")`.
- `getBuoyObs("거문도")` 정상 응답: `{name:"거문도", 파고m:…, 풍속ms:…(있을 수도/없을 수도), 수온C:…, …}`.
- deriveFocus 결과 (line 1271-1294):
  - `focus.buoy = "거문도"` (line 1278: `if (v.name && r.tool === 'get_buoy_observation') focus.buoy = v.name;`)
  - `focus.zone = null` — `detectZoneDeterministic("거문도 파고 알려줘")` 가 null (거문도는 ZONE_NAMES 에 없음, REGION_DIR_RE 매칭 토큰 0).
  - `focus.coords = null` — getBuoyObs 결과에 `위도/경도` 키가 없음 (line 988-994 의 fields 에 좌표 누락).
  - `focus.haegu = null`, `focus.rankedItems = null`.

→ **clients 가 다음 턴에 동봉하는 focus 는 `{buoy:"거문도"}` 만 유효**.

### 1.2 후속 턴 (ANG-2-01b) planQuery 가 선택할 도구

`cq = "거기 풍속은?"`, PRONOUN_RE 가 "거기" 매칭 → `isPronounFollowup = true`.

planQuery 프롬프트의 `focusLine` 은:

```
[직전 확정 대상] 부이/지점=거문도
질문이 "거기/…" 등으로 대상을 가리키면 위 [직전 확정 대상]을 그대로 args 에 쓰세요…
```

LLM 후보 도구 (TOOL_CATALOG line 873-903 기준):
- (a) `get_buoy_observation(buoyName="거문도")` — 풍속은 buoy obs 의 `풍속ms` 필드에 있으므로 자연스럽고 정확한 선택.
- (b) `get_marine_forecast(zone=…)` — "풍속" 이 단기 기상전망 키워드라 LLM 가 우선시할 가능성. 하지만 `zone` 인자에 무엇을 넣을지 결정 불가 → `zone:null` 또는 `zone:"거문도"`(존재하지 않는 zone).
- (c) `get_visibility / get_nearest_buoy` 등 풍속과 무관한 도구.

### 1.3 빈 응답의 진짜 원인 — 3 가지 분기

| 분기 | 도구 선택 | 결과 | 합성 답 |
|------|----------|------|--------|
| **A** | `get_marine_forecast(zone=null)` 또는 `zone="거문도"` | `resolveZoneName` null → `fc=null` → `{error:"해당 해역 단기예보가 없습니다.", zone:null}` | `hasRealData=false`, isDomainQuery=true(풍속 키워드) → 환각 가드(line 1554) 가 막아 "지금 그 정보를 가져오지 못했어요" 비슷한 메시지. 그러나 results.length ≥ 1 이므로 가드 진입 안 함 → synth 가 "그 정보는 없어요" (line 1574 의 환각금지 규칙) 로 답. **= 관측된 증상**. |
| **B** | `get_buoy_observation(buoyName="거문도")` 정상, 단 거문도 buoy 의 ws 필드 비어 있음 | `{name:"거문도", 파고m:1.2, 수온C:18}` (풍속 누락) | synth 가 "풍속 정보는 없어요" — 동일 증상. |
| **C** | `get_buoy_observation` 호출했으나 LLM 이 `buoyName` 인자를 누락 | `{error:"부이 이름이 비었습니다."}` | hasRealData=false → 환각 가드 또는 빈 응답. |

**A 와 C 의 공통 원인: FOCUS_ZONE_ARG / focusBuoy 주입 로직(line 1466-1496) 은 step.tool 별로 1:1 매핑만 한다.** 즉,
- LLM 이 `get_marine_forecast` 선택 시 → `focusZone` 이 null 이므로 `FOCUS_ZONE_ARG['get_marine_forecast']='zone'` 매핑은 발동돼도 채울 값이 없음.
- LLM 이 `get_buoy_observation` 선택 시 → focusBuoy 가 있어 정상 주입(line 1494-1496). 이 분기에선 결함 아님.
- LLM 이 잘못된 도구를 골랐을 때 **focus.buoy → zone 도메인 도구 자동 변환이 없다** = 핵심 누락.

B 의 buoy 데이터 누락은 별 이슈(부이 ws 결측). focus 전파의 책임 범위를 넘어가므로 폴백 도구로 보강해야 한다.

### 1.4 진단 결론

- focus.buoy 만 있고 focus.zone 이 없는 상태에서, 후속 풍속 질의가 zone-기반 도구로 라우팅되면 args 가 비어 빈 결과가 발생.
- planQuery 가 `get_buoy_observation` 으로 고른다 해도 단일 부이의 ws 결측 시 폴백이 없어 빈 응답.
- 두 분기 모두 **focus.buoy → 좌표/근접부이 군집** 으로 확장하는 결정론적 후처리가 빠져 있다.

---

## 2. ANG-2-01b 패치안

### 2.1 변경 위치

`/home/user/SEAGNAL/local_server/routes/assistant.js`

1. **deriveFocus (line 1271-1294)** — get_buoy_observation 결과에 buoy 좌표를 함께 채워 focus.coords 도 보존.
2. **runBrain FOCUS_ZONE_ARG 주입 직후 (line 1502 이후, 도구 실행 전)** — focus 폴백 보강 블록 신설.
3. **새 헬퍼 — `buoyToCoords(name)`** — BUOY_BY_ID 에서 부이 이름 → {lat, lon} 조회 (이미 line 95-110 에 BUOY_BY_ID 로딩 존재).

### 2.2 deriveFocus 보강 (focus.coords 채우기)

**before** (line 1273-1287)

```js
for (const r of (results || [])) {
    const v = r && r.result;
    if (!v || typeof v !== 'object' || v.error) continue;
    if (v.zoneId) focus.haegu = String(v.zoneId);
    if (focus.coords == null && v['위도'] != null && v['경도'] != null) focus.coords = { lat: v['위도'], lon: v['경도'] };
    if (v.name && r.tool === 'get_buoy_observation') focus.buoy = v.name;
    ...
}
```

**after**

```js
for (const r of (results || [])) {
    const v = r && r.result;
    if (!v || typeof v !== 'object' || v.error) continue;
    if (v.zoneId) focus.haegu = String(v.zoneId);
    if (focus.coords == null && v['위도'] != null && v['경도'] != null) focus.coords = { lat: v['위도'], lon: v['경도'] };
    if (v.name && r.tool === 'get_buoy_observation') {
        focus.buoy = v.name;
        // [패치 A — 후속 풍속/유속/시정 등 zone/좌표 기반 도구 폴백용]
        if (focus.coords == null) {
            const co = buoyToCoords(v.name);   // BUOY_BY_ID 에서 lookup
            if (co) focus.coords = co;
        }
    }
    ...
}
```

`buoyToCoords` 헬퍼(예: line 110 직후):

```js
function buoyToCoords(name) {
    if (!name) return null;
    const nn = String(name).replace(/[\s·]/g, '');
    const hit = BUOY_BY_ID.find(b => b.nname.includes(nn) || nn.includes(b.nname));
    return hit ? { lat: hit.lat, lon: hit.lon } : null;
}
```

### 2.3 runBrain — focus 폴백 보강 블록 (도구별 args 주입 직후)

**위치**: line 1502 의 for 루프 종료 직후, results 채우기(line 1504) 전.

**신설 블록**:

```js
// [패치 A — 후속 부이 follow-up 의 풍속/시정/유속 등 폴백]
// focus.buoy 만 있고 focus.zone 이 없는 상태에서 후속이 "풍속/유속/시정/수온/특보" 등
// zone 기반 도구를 호출하면 args 가 비어 빈 응답이 된다. 안전한 보강:
//  1) get_buoy_observation 이 plan 에 없으면 강제로 1단계 추가(가장 신뢰 높은 단일 부이 실측).
//  2) focus.coords 있으면 get_buoys_with_obs 를 함께 호출해 군집 폴백(단일 부이 ws 결측 대비).
if (isPronounFollowup && focusBuoy && !focusZone) {
    const wantWind = /풍속|바람|풍향/.test(cq);
    const wantVis  = /시정|가시거리/.test(cq);
    const wantTemp = /수온/.test(cq);
    const wantWave = /파고|물결|파주기/.test(cq);
    const needsBuoyObs = (wantWind || wantVis || wantTemp || wantWave);
    const planTools = new Set(plan.steps.map(s => s.tool));
    if (needsBuoyObs && !planTools.has('get_buoy_observation')) {
        plan.steps.unshift({ tool: 'get_buoy_observation', args: { buoyName: focusBuoy } });
    }
    // 단일 부이 결측 폴백 — 좌표로 인근 부이 군집
    if (needsBuoyObs && focusCoords && !planTools.has('get_buoys_with_obs')) {
        plan.steps.push({ tool: 'get_buoys_with_obs', args: { lat: focusCoords.lat, lon: focusCoords.lon } });
    }
}
```

### 2.4 합성 단계 동작

- get_buoy_observation 으로 ws 가 있으면 synth 가 "거문도 풍속은 초속 N미터 입니다" 로 답.
- ws 결측이면 get_buoys_with_obs 결과의 인근 부이들 중 ws 있는 항목을 답("거문도 부이는 풍속 결측. 인근 ○○부이는 초속 N미터").
- 둘 다 비면 환각금지 규칙(line 1574)에 따라 "현재 풍속 정보는 없어요" — `expect_no_halluc=true` 도 통과.

---

## 3. LG-1-01 원인 분석 — "관내 어때" web_search 폴백

### 3.1 현재 처리 경로

- profile=`{affiliation:"시청 방재"}` → detectJikgun 매칭: JIKGUN_META.local_gov.kw 에 "시청", "방재" 둘 다 포함 → `slug = "local_gov"`.
- planQuery 프롬프트(line 1387)에 #23 규칙 주입됨:
  > 지방자치단체(local_gov) 직군 + "관내…" 같은 모호 지명은 사용자 GPS 좌표(있으면) 또는 활동 default 해역으로 도구 호출. 둘 다 없으면 get_warning(zone="전국") 으로 전국 특보 요약하세요. "관내" 를 그대로 zone 인자에 넣지 마세요.
- 사례 조건: location(GPS)·profile.location.zone(default) 모두 미설정. 규칙대로면 `get_warning(zone="전국")` 호출해야 함.
- 실제 결과: web_search 폴백 → "어떤 관내인지 알려주세요" 류 답.

### 3.2 LLM 이 규칙을 어기는 원인

1. **규칙이 promptline 1387 한 줄로 묻혀 있음** — TOOL_CATALOG, 일반규칙, 직군 floor 들 사이에 끼어 있어 LLM 가중치 낮음.
2. **`get_warning(zone="전국")` 의 모호성** — TOOL_CATALOG(line 878)은 `get_warning(zone)` 만 정의, "전국" 같은 가상 zone 의미 미정의. LLM 이 "이 도구 호출해도 결과 없을 것" 으로 판단해 비움.
3. **모호어("관내") 자체가 zone 식별 트리거가 안 됨** — detectZoneDeterministic("관내 어때") 는 null → planQuery 의 마지막 줄(line 1383 "위치가 모호해도 web_search 폴백을 노리고 steps 를 비우지 말고…") 까지 무시당함.
4. **steps:[] 반환 시 결과** — runBrain line 1554: `isDomainQuery=true`(특보 키워드 미포함이지만 "관내" 자체는 키워드 아님; 단 LG 직군이라 DOMAIN_RE 매칭 실패 가능). `DOMAIN_RE` 확인 시 "관내 어때" 는 도메인 키워드 0개 → `isDomainQuery=false`(detectZoneDeterministic 도 null) → `gotUseful=false && !isDomainQuery` → web_search 폴백 진입 → "어떤 관내인지" 모호 답.

→ **이중 결함: (A) 플래너가 도구 비움, (B) 도메인 가드가 LG 케이스를 도메인으로 인식 못 함.**

### 3.3 진단 결론

- 프롬프트 규칙은 LLM 의지에 의존 — 결정론적 후처리 필요.
- "관내" + local_gov + GPS·default 모두 없음 = `get_warning(zone=null)`(전체 트리 집계) 강제 호출이 가장 안전.
- 도메인 가드 강화: profile 직군이 감지된 종합 모니터링 직군(local_gov/coast_guard/navy/mof/public_org)이면 query 키워드 없어도 도메인으로 간주.

---

## 4. LG-1-01 패치안

### 4.1 변경 위치

`/home/user/SEAGNAL/local_server/routes/assistant.js`

1. **runBrain — plan.steps 보강 (line 1502 직후, results 채우기 전)** — local_gov "관내" 후처리.
2. **isDomainQuery 보강 (line 1548)** — 종합 모니터링 직군 + 모호 종합 질의도 도메인으로.
3. **get_warning 처리 (TOOL_EXEC.get_warning, line 1135)** — `zone="전국"` 또는 `zone=null` 일 때 전체 특보 트리 집계 반환(웹검색 폴백 안 가도 useful).

### 4.2 plan.steps 보강 — 관내 강제 호출

**위치**: §2.3 패치 A 의 부이 폴백 블록과 같은 위치(line 1502 직후), 별도 블록.

```js
// [패치 A — local_gov "관내/관할/우리시" 모호지명 결정론 보강]
// planQuery 의 LLM 규칙(#23)을 LLM 이 무시해 web_search 로 빠지는 회귀 직타.
// 직군이 local_gov 이고 모호어가 있고, GPS·default·focus 어느 것도 잡지 못했으면
// get_warning 을 zone 인자 없이 강제 호출(아래 §4.4 의 전체 특보 집계).
const VAGUE_LOCAL_RE = /관내|우리\s*시|시청\s*관할|관할\s*해역|관할\s*구역|우리\s*지역/;
const jikgunSlug = detectJikgun(profile);
const pz = profileDefaultZone(profile);
const hasGPS = location && location.lat != null && location.lon != null;
const vagueLocal = VAGUE_LOCAL_RE.test(cq);
if (jikgunSlug === 'local_gov' && vagueLocal && !hasGPS && !pz && !focusZone) {
    const planTools = new Set(plan.steps.map(s => s.tool));
    if (!planTools.has('get_warning')) {
        plan.steps.unshift({ tool: 'get_warning', args: {} });   // zone 비움 → 전체 집계
    }
    if (!planTools.has('get_typhoon_status')) {
        plan.steps.push({ tool: 'get_typhoon_status', args: {} });
    }
}
```

### 4.3 isDomainQuery 보강

**before** (line 1548-1550)

```js
const isDomainQuery = DOMAIN_RE.test(query) || DOMAIN_RE.test(cq)
    || ISLAND_BUOY_RE.test(query) || ISLAND_BUOY_RE.test(cq)
    || !!detectZoneDeterministic(query) || !!detectZoneDeterministic(cq);
```

**after**

```js
// [패치 A] 종합 모니터링 직군 + 모호 종합 질의도 도메인으로 — web_search 폴백 차단
const MONITOR_JIKGUN = new Set(['local_gov', 'coast_guard', 'navy', 'mof', 'public_org']);
const monitorOverview = MONITOR_JIKGUN.has(detectJikgun(profile)) &&
    (VAGUE_LOCAL_RE.test(cq) || /어때|상황|전반|전체|괜찮/.test(cq));
const isDomainQuery = DOMAIN_RE.test(query) || DOMAIN_RE.test(cq)
    || ISLAND_BUOY_RE.test(query) || ISLAND_BUOY_RE.test(cq)
    || !!detectZoneDeterministic(query) || !!detectZoneDeterministic(cq)
    || monitorOverview;
```

(VAGUE_LOCAL_RE 와 MONITOR_JIKGUN 은 §4.2 블록과 공유; 변수 스코프 정리는 구현 시 함수 상단으로.)

### 4.4 TOOL_EXEC.get_warning — 전국 집계 지원

**before** (line 1135)

```js
get_warning: async ({ zone } = {}) => { const z = resolveZoneName(zone); return { zone: z, warning: z ? findWarning(z) : null }; },
```

**after**

```js
get_warning: async ({ zone } = {}) => {
    // [패치 A] zone 미지정 또는 "전국" → 전체 특보 트리에서 발효 중인 항목 집계
    if (!zone || /^전국$|^전\s*해역$/.test(String(zone).trim())) {
        const tree = (dataCache.warnings && dataCache.warnings.current) || null;
        if (!tree) return { zone: '전국', warnings: [], note: '특보 데이터를 불러오지 못했습니다.' };
        const active = [];
        const walk = (node, pathArr) => {
            if (!node || typeof node !== 'object') return;
            if ('current' in node || 'upcoming' in node) {
                if (node.current) active.push({ zone: pathArr[pathArr.length - 1], type: node.current.type || '해상 특보', detail: node.current });
                return;
            }
            for (const k of Object.keys(node)) walk(node[k], pathArr.concat(k));
        };
        walk(tree, []);
        return { zone: '전국', activeCount: active.length, warnings: active.slice(0, 12) };
    }
    const z = resolveZoneName(zone);
    return { zone: z, warning: z ? findWarning(z) : null };
},
```

### 4.5 동작 흐름

1. LLM 이 #23 무시해도 §4.2 의 후처리가 `get_warning(args={})` 를 plan.steps 앞에 삽입.
2. `get_warning({})` → 전국 발효 특보 N건 집계 반환 → `hasRealData=true` → synth 진입.
3. synth: "현재 전국에 풍랑주의보 N건, 강풍주의보 M건 등이 발효 중입니다. 우리 시 관할은 별도로 알려주시면…" 같은 자연스러운 답.
4. 발효 0건이라도 `{activeCount:0, warnings:[]}` 는 `hasRealData=true`(activeCount 키 존재)로 synth 가 "현재 전국에 발효 중인 해상 특보는 없습니다" 로 응답 → expect_tools_any 의 `get_warning` 통과.

---

## 5. 회귀 위험 분석

### 5.1 §2 (ANG-2-01b) 패치 영향

| 영향 면 | 위험도 | 분석 |
|--------|------|------|
| 다른 부이 후속 케이스(CG-2-01b 등) | 낮음(+) | `isPronounFollowup && focusBuoy && !focusZone` 조건이 좁아 zone 있는 케이스엔 무영향. zone 없고 부이만 있는 후속은 강화. |
| 첫 턴 단독 호출 | 무영향 | 조건 `isPronounFollowup=true` 게이트로 차단. |
| deriveFocus 의 focus.coords 채움 | 낮음 | 이전엔 null 이었음. 새로 좌표 잡힌다 → 후속 좌표기반 도구(get_current/get_depth/get_tide) 호출이 더 정확해짐. 단, 잘못된 부이→좌표 매칭 시 엉뚱한 좌표 위험 → `buoyToCoords` 의 normalize 매칭이 `nname.includes(nn) \|\| nn.includes(nname)` 양방향이라 단명 부이 오매칭 가능(예: "독도" → "독도부이" vs "독도등표"). **완화: 정확 일치 우선(`nname === nn`) → 그다음 includes**. |
| plan.steps 에 부이 호출 자동 추가 → 토큰/지연 | 낮음 | 최대 2개 도구 추가, 후속 턴만. |
| get_buoys_with_obs(lat,lon) 호출이 plan 에 없던 케이스 추가 | 낮음 | 인근 부이 군집만 반환 → 답 풍부해짐. results 6개 cap(line 1505) 안 넘김. |

### 5.2 §4 (LG-1-01) 패치 영향

| 영향 면 | 위험도 | 분석 |
|--------|------|------|
| 다른 local_gov 케이스 (LG-4-01, LG-8-01) | 낮음 | VAGUE_LOCAL_RE("관내/우리시/시청 관할…") 미매칭이면 미발동. LG-4-01/LG-8-01 의 질문이 구체 지명이면 영향 없음(query 텍스트 확인 필요). |
| 다른 모니터링 직군(coast_guard/navy/mof/public_org) 의 "관내" 류 | 의도된 강화 | local_gov 만 §4.2 적용(jikgunSlug==='local_gov' 조건). 다른 직군은 isDomainQuery 보강만 — web_search 차단 효과(synth 가 "위치를 알려주세요" 응답). 의도된 변화. |
| isDomainQuery 확장으로 web_search 케이스 감소 | 매우 낮음 | 비도메인 메타/잡담 질의는 직군이 매칭 안 되거나 monitorOverview 키워드("어때/상황/관내") 미포함 → 영향 없음. |
| `get_warning(zone=null)` 의 새 시그니처 | 낮음 | 기존 호출자(LLM 이 `zone=null` 줄 일 거의 없음; synth/findWarning) 와 호환. zone 있으면 기존 경로 그대로. **단 합성 단계에서 `warnings:[]` 키와 기존 `warning:{}` 키 모양이 달라 synth 가 혼동할 가능성** → synth 프롬프트는 JSON 그대로 던지므로 LLM 가 자연어로 잘 처리. 회귀 거의 없음. |
| 환각 가드(line 1554) — results 가 가드 진입 안 함 | 의도 부합 | §4.2 가 results.length ≥ 1 보장 → 가드 진입 X, synth 정상 진행. |

### 5.3 공통 위험 — 회귀 검증 게이트

- **sentinel 20케이스 전체 재실행 필수.** 특히:
  - ANG-2-01a (선행 단독) — 첫 턴 동작 무변(`isPronounFollowup=false` 게이트).
  - CG-2-01a/b, MOF-6-01a/b — 후속쌍 영향 확인.
  - LG-4-01, LG-8-01 — local_gov 다른 카테고리 영향.
  - PO-3-01 (public_org) — monitorOverview 가 잘못 발동하면 plan 변경 없지만 isDomainQuery 만 영향.
- **자유변칙 440 평가셋 회귀** — cat2(연속) 48%→ 상승 기대, cat1(기본)/cat5(비도메인) 안정 유지 확인.

### 5.4 미해결 잔존 위험

- ANG-2-01b 의 분기 B(buoy ws 결측) 는 폴백 도구가 잡지만, 인근 부이도 ws 결측이면 결국 "정보 없음" 답. 이는 데이터 결함이지 라우팅 결함 아니므로 본 패치 범위 밖.
- LG-1-01 의 "관내" 가 실제로 어떤 시·군 관할인지 specify 못 함 — 전국 요약 답을 받게 됨. expect_tools_any 통과는 보장되나 사용자 만족도는 별개. 추후 phase 에서 GPS 활용 권장 UX 필요.

---

## 6. 적용 순서 권장

1. (헬퍼) `buoyToCoords` 추가 — 위험 최저, 다른 곳 영향 없음.
2. (deriveFocus) focus.coords 채우기 — 단독 회귀.
3. (TOOL_EXEC.get_warning) zone 비움 → 전국 집계 — 단독 회귀.
4. (runBrain) §2.3 부이 폴백 블록 — sentinel ANG-2-01b 회귀 확인.
5. (runBrain) §4.2 local_gov 강제 호출 블록 + §4.3 isDomainQuery 보강 — sentinel LG-1-01 회귀 확인.
6. sentinel 20케이스 + freevar 회귀 → 통과 시 머지.
