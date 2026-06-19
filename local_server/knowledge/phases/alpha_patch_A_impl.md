# α 옵션 — 단일 PR 8커밋 통합 패치 **시점 A** 실코드 diff 안

> 본 문서는 **설계 산출만**(코드 수정 금지). `patch_A_continuity_localgov.md` 의 ANG-2-01b + LG-1-01 두 결함을 `patch_synthesis.md` §1.3 충돌 봉합(변수명 분리·상등 1회 선언) 을 반영해 실코드 diff 로 정착시킨다. 실코드는 `local_server/routes/assistant.js` (총 2183 라인) 기준.
>
> 시점 A 산출 = 8커밋 중 **C1·C2·C3·C4·C5** 5개 (ANG-2-01b: C1~C4, LG-1-01: C3·C5). C6·C7·C8 은 옵션 B 시점.

---

## 0. 충돌 봉합 적용 확인 (synthesis §1.3)

| 봉합 항목 | 적용 위치 | 처리 방식 |
|----------|----------|----------|
| #1 `planTools` 변수명 중복 → `_buoyPlanTools` / `_lgPlanTools` 분리 | runBrain (line 1502 직후, 신규 2블록 내부) | 각 블록 안에서 `const _buoyPlanTools = new Set(...)` / `const _lgPlanTools = new Set(...)` 로 식별자 분리. §2.3·§4.2 정의 |
| #2 `VAGUE_LOCAL_RE` · `MONITOR_JIKGUN` 함수 상단 1회 선언 | runBrain 진입 직후 (line 1455 `canonZone` 정의 *직전*) | §4.2 블록·§4.3 isDomainQuery 가 공유. 함수 상단 1회 `const VAGUE_LOCAL_RE = …`, `const MONITOR_JIKGUN = new Set([...])`. 두 블록은 참조만 |
| #3 (옵션 B 의존) synth bullet ↔ §4.2 결과 객체 보장 | A 단독 시점에선 §4.2 의 `get_warning({})` 호출 자체로 results 가 ≥1 보장 → 옵션 B 적용 시 자연 정합 | 본 시점 A 산출엔 영향 없음 |
| #4 `get_warning` 응답 키 호환 — 기존 `warning:{}` 보존 + 신규 `warnings:[]`·`activeCount` 추가 | TOOL_EXEC.get_warning (line 1135) | zone 있을 때는 기존 키 그대로, zone 비면 신규 키. **양쪽 분기 모두 zone 키는 항상 포함** |
| S3 (synthesis §2.2) `monitorOverview` AND-narrow | §4.3 isDomainQuery 보강 | `MONITOR_JIKGUN.has(slug) && VAGUE_LOCAL_RE.test(cq) && /어때\|상황…/.test(cq)` — 3항 AND 로 좁힘 |

---

## 1. ANG-2-01b 패치 — 부이 follow-up 폴백 (C1·C2·C4)

### 1.1 C1: `buoyToCoords` 헬퍼 — line 110 직후 신규

**현재 코드 (line 107-110, 인용):**
```js
    console.log(`[Assistant] 부이 ${BUOY_BY_ID.length}개 로드됨`);
} catch (e) {
    console.warn('[Assistant] buoyLocations 파싱 실패 — 일반 부이 링크로 폴백:', e.message);
}
```

**diff (line 110 직후 신규 함수 삽입):**
```diff
 } catch (e) {
     console.warn('[Assistant] buoyLocations 파싱 실패 — 일반 부이 링크로 폴백:', e.message);
 }
+
+// [패치 A] 부이 이름 → 좌표 lookup — focus.buoy 만 있는 follow-up 에서 좌표 폴백.
+//   정확 일치 우선(nname === nn), 없으면 양방향 includes 로 보조 매칭(오매칭 위험 최소화).
+function buoyToCoords(name) {
+    if (!name) return null;
+    const nn = String(name).replace(/[\s·]/g, '');
+    if (!nn) return null;
+    let hit = BUOY_BY_ID.find(b => b.nname === nn);
+    if (!hit) hit = BUOY_BY_ID.find(b => b.nname.includes(nn) || nn.includes(b.nname));
+    return hit ? { lat: hit.lat, lon: hit.lon } : null;
+}
```

### 1.2 C2: `deriveFocus` — focus.coords 자동 채움 (line 1278)

**현재 코드 (line 1273-1287, 인용):**
```js
    for (const r of (results || [])) {
        const v = r && r.result;
        if (!v || typeof v !== 'object' || v.error) continue;
        if (v.zoneId) focus.haegu = String(v.zoneId);
        if (focus.coords == null && v['위도'] != null && v['경도'] != null) focus.coords = { lat: v['위도'], lon: v['경도'] };
        if (v.name && r.tool === 'get_buoy_observation') focus.buoy = v.name;
        if (v.nearest && v.nearest.name) focus.buoy = v.nearest.name;
```

**diff:**
```diff
     for (const r of (results || [])) {
         const v = r && r.result;
         if (!v || typeof v !== 'object' || v.error) continue;
         if (v.zoneId) focus.haegu = String(v.zoneId);
         if (focus.coords == null && v['위도'] != null && v['경도'] != null) focus.coords = { lat: v['위도'], lon: v['경도'] };
-        if (v.name && r.tool === 'get_buoy_observation') focus.buoy = v.name;
-        if (v.nearest && v.nearest.name) focus.buoy = v.nearest.name;
+        if (v.name && r.tool === 'get_buoy_observation') {
+            focus.buoy = v.name;
+            // [패치 A] 후속 zone/좌표 기반 도구(get_current/get_depth/get_visibility 등) 폴백을 위해
+            //   부이 좌표를 함께 보존. BUOY_BY_ID 에서 정확/양방향 매칭.
+            if (focus.coords == null) {
+                const co = buoyToCoords(v.name);
+                if (co) focus.coords = co;
+            }
+        }
+        if (v.nearest && v.nearest.name) {
+            focus.buoy = v.nearest.name;
+            if (focus.coords == null && v.nearest.lat != null && v.nearest.lon != null) {
+                focus.coords = { lat: v.nearest.lat, lon: v.nearest.lon };
+            }
+        }
```

### 1.3 C4: runBrain 부이 follow-up 폴백 블록 — line 1502 직후 신규

**현재 코드 (line 1500-1505, 인용):**
```js
            step.args.lat = focusCoords.lat;
            step.args.lon = focusCoords.lon;
        }
    }

    const results = [];
```

**diff (line 1502 의 for 루프 종료 `}` 직후, `const results = []` 전):**
```diff
             step.args.lat = focusCoords.lat;
             step.args.lon = focusCoords.lon;
         }
     }
+
+    // [패치 A — ANG-2-01b 게이트] 후속 부이 follow-up 의 풍속/시정/유속 등 폴백.
+    //   focus.buoy 만 있고 focus.zone 이 없는 상태에서 후속이 zone 기반 도구로 라우팅되면
+    //   args 가 비어 빈 응답이 된다. 안전한 결정론적 보강:
+    //     1) get_buoy_observation 이 plan 에 없으면 강제 1단계 추가 (단일 부이 실측).
+    //     2) focus.coords 있으면 get_buoys_with_obs 군집 폴백(단일 부이 ws 결측 대비).
+    if (isPronounFollowup && focusBuoy && !focusZone) {
+        const wantWind = /풍속|바람|풍향/.test(cq);
+        const wantVis  = /시정|가시거리/.test(cq);
+        const wantTemp = /수온/.test(cq);
+        const wantWave = /파고|물결|파주기/.test(cq);
+        const needsBuoyObs = (wantWind || wantVis || wantTemp || wantWave);
+        const _buoyPlanTools = new Set(plan.steps.map(s => s.tool));
+        if (needsBuoyObs && !_buoyPlanTools.has('get_buoy_observation')) {
+            plan.steps.unshift({ tool: 'get_buoy_observation', args: { buoyName: focusBuoy } });
+            _buoyPlanTools.add('get_buoy_observation');
+        }
+        if (needsBuoyObs && focusCoords && !_buoyPlanTools.has('get_buoys_with_obs')) {
+            plan.steps.push({ tool: 'get_buoys_with_obs', args: { lat: focusCoords.lat, lon: focusCoords.lon } });
+            _buoyPlanTools.add('get_buoys_with_obs');
+        }
+    }

     const results = [];
```

---

## 2. LG-1-01 패치 — local_gov "관내" 강제 호출 (C3·C5)

### 2.1 공통 상수 1회 선언 — runBrain 진입부, line 1455 `canonZone` 정의 *직전* (synthesis §1.3 #2 봉합)

**현재 코드 (line 1448-1455, 인용):**
```js
    // [지명 정규화] LLM 이 "전남남해" 처럼 표준 해역명을 살짝 다르게 주면,
    //   detectZoneDeterministic 으로 fuzzy 매칭해 표준명("전남남해앞바다")으로 정정.
    //   tool 호출이 빈 결과를 내고 web_search 폴백으로 빠지는 패턴을 사전 차단한다.
    const canonZone = (z) => {
        if (typeof z !== 'string' || !z.trim()) return z;
        const r = detectZoneDeterministic(z);
        return (r && r !== z) ? r : z;
    };
```

**diff (line 1450 의 주석 종료 직후 — canonZone 위에 상수 선언):**
```diff
     // [지명 정규화] LLM 이 "전남남해" 처럼 표준 해역명을 살짝 다르게 주면,
     //   detectZoneDeterministic 으로 fuzzy 매칭해 표준명("전남남해앞바다")으로 정정.
     //   tool 호출이 빈 결과를 내고 web_search 폴백으로 빠지는 패턴을 사전 차단한다.
+    // [패치 A — 공유 상수] §4.2(local_gov 강제 호출) + §4.3(isDomainQuery 보강)이 함께 참조.
+    //   함수 상단 1회 선언으로 중복·스코프 충돌 방지(synthesis §1.3 #2).
+    const VAGUE_LOCAL_RE = /관내|우리\s*시|시청\s*관할|관할\s*해역|관할\s*구역|우리\s*지역/;
+    const MONITOR_JIKGUN = new Set(['local_gov', 'coast_guard', 'navy', 'mof', 'public_org']);
+    const OVERVIEW_RE = /어때|상황|전반|전체|괜찮/;
+    const _jikgunSlug = detectJikgun(profile);   // 1회 계산 — §4.2/§4.3 공유(synthesis 누락위험 #4 완화)
     const canonZone = (z) => {
         if (typeof z !== 'string' || !z.trim()) return z;
         const r = detectZoneDeterministic(z);
         return (r && r !== z) ? r : z;
     };
```

### 2.2 C3: `TOOL_EXEC.get_warning` 전국 집계 지원 — line 1135

**현재 코드 (line 1135, 인용):**
```js
    get_warning: async ({ zone } = {}) => { const z = resolveZoneName(zone); return { zone: z, warning: z ? findWarning(z) : null }; },
```

**diff:**
```diff
-    get_warning: async ({ zone } = {}) => { const z = resolveZoneName(zone); return { zone: z, warning: z ? findWarning(z) : null }; },
+    get_warning: async ({ zone } = {}) => {
+        // [패치 A — synthesis §1.3 #4 봉합]
+        //   zone 미지정 또는 "전국"/"전 해역" → 전국 발효 특보 트리 집계 반환.
+        //   ★ 응답 키 호환성: zone 있는 호출은 기존 {zone, warning:{}} 그대로,
+        //     zone 비는 호출은 {zone:'전국', activeCount:N, warnings:[…], warning:null}.
+        //     기존 `warning` 키도 null 로 포함해 합성/소비자 호환 유지.
+        if (!zone || /^전국$|^전\s*해역$/.test(String(zone).trim())) {
+            const tree = (dataCache.warnings && dataCache.warnings.current) || null;
+            if (!tree) return { zone: '전국', activeCount: 0, warnings: [], warning: null, note: '특보 데이터를 불러오지 못했습니다.' };
+            const active = [];
+            const walk = (node, pathArr) => {
+                if (!node || typeof node !== 'object') return;
+                if ('current' in node || 'upcoming' in node) {
+                    if (node.current) active.push({
+                        zone: pathArr[pathArr.length - 1] || null,
+                        type: node.current.type || '해상 특보',
+                        detail: node.current
+                    });
+                    return;
+                }
+                for (const k of Object.keys(node)) walk(node[k], pathArr.concat(k));
+            };
+            walk(tree, []);
+            return { zone: '전국', activeCount: active.length, warnings: active.slice(0, 12), warning: null };
+        }
+        const z = resolveZoneName(zone);
+        return { zone: z, warning: z ? findWarning(z) : null };
+    },
```

### 2.3 C5-a: runBrain — local_gov 관내 강제 호출 블록 (§4.2)

**위치**: §1.3 의 부이 폴백 블록 *직후* (synthesis §1.3 #1: 부이→LG 순서 고정). 즉 line 1502 직후 2번째 신규 블록.

**diff (§1.3 부이 블록 종료 `}` 직후 이어서 삽입):**
```diff
         if (needsBuoyObs && focusCoords && !_buoyPlanTools.has('get_buoys_with_obs')) {
             plan.steps.push({ tool: 'get_buoys_with_obs', args: { lat: focusCoords.lat, lon: focusCoords.lon } });
             _buoyPlanTools.add('get_buoys_with_obs');
         }
     }
+
+    // [패치 A — LG-1-01 게이트] local_gov + "관내/우리시…" 모호지명 결정론 보강.
+    //   planQuery 의 LLM 규칙(#23)을 LLM 이 무시해 web_search 폴백으로 빠지는 회귀를 직타.
+    //   직군이 local_gov 이고 모호어가 있고 GPS·default·focus 어느 것도 잡지 못했으면
+    //   get_warning(args={}) 강제 호출(§2.2 의 전국 집계 분기 진입).
+    const _pz = profileDefaultZone(profile);
+    const _hasGPS = !!(location && location.lat != null && location.lon != null);
+    const _vagueLocal = VAGUE_LOCAL_RE.test(cq);
+    if (_jikgunSlug === 'local_gov' && _vagueLocal && !_hasGPS && !_pz && !focusZone) {
+        const _lgPlanTools = new Set(plan.steps.map(s => s.tool));
+        if (!_lgPlanTools.has('get_warning')) {
+            plan.steps.unshift({ tool: 'get_warning', args: {} });   // zone 비움 → 전국 집계
+            _lgPlanTools.add('get_warning');
+        }
+        if (!_lgPlanTools.has('get_typhoon_status')) {
+            plan.steps.push({ tool: 'get_typhoon_status', args: {} });
+            _lgPlanTools.add('get_typhoon_status');
+        }
+    }
```

### 2.4 C5-b: `isDomainQuery` 보강 (§4.3) — line 1548

**현재 코드 (line 1546-1550, 인용):**
```js
    const DOMAIN_RE = /특보|예보|파고|파주기|풍속|풍향|풍랑|해상|해양|연안|해역|해구|부이|시정|가시거리|조석|만조|간조|물때|유속|유향|해류|수심|태풍|기상|관측|수온|낚시|서핑|어업|조업|항해|바다|섬|항구|항만/;
    const ISLAND_BUOY_RE = /거문도|오륙도|마라도|추자도|울릉도|서귀포|신안|가거도|백령도|연평도|흑산도|위미|독도|덕적|영흥|울진|포항|속초|동해|강릉|삼척|군산|목포|여수|통영|거제|부산|보길도|진도|완도|소청도|대청도|어청도|울도|소흑산도/;
    const isDomainQuery = DOMAIN_RE.test(query) || DOMAIN_RE.test(cq)
        || ISLAND_BUOY_RE.test(query) || ISLAND_BUOY_RE.test(cq)
        || !!detectZoneDeterministic(query) || !!detectZoneDeterministic(cq);
```

**diff:**
```diff
     const DOMAIN_RE = /특보|예보|파고|파주기|풍속|풍향|풍랑|해상|해양|연안|해역|해구|부이|시정|가시거리|조석|만조|간조|물때|유속|유향|해류|수심|태풍|기상|관측|수온|낚시|서핑|어업|조업|항해|바다|섬|항구|항만/;
     const ISLAND_BUOY_RE = /거문도|오륙도|마라도|추자도|울릉도|서귀포|신안|가거도|백령도|연평도|흑산도|위미|독도|덕적|영흥|울진|포항|속초|동해|강릉|삼척|군산|목포|여수|통영|거제|부산|보길도|진도|완도|소청도|대청도|어청도|울도|소흑산도/;
-    const isDomainQuery = DOMAIN_RE.test(query) || DOMAIN_RE.test(cq)
-        || ISLAND_BUOY_RE.test(query) || ISLAND_BUOY_RE.test(cq)
-        || !!detectZoneDeterministic(query) || !!detectZoneDeterministic(cq);
+    // [패치 A — synthesis §2.2 S3 완화] AND-narrow 로 좁힘.
+    //   종합 모니터링 직군 + 모호지명 매칭 + 종합 어휘(어때/상황…) 의 *세 조건 동시* 만 도메인 인정.
+    //   "회식 어때" 같은 비도메인 잡담은 VAGUE_LOCAL_RE 미매칭 → false-positive 차단.
+    const monitorOverview = MONITOR_JIKGUN.has(_jikgunSlug)
+        && (VAGUE_LOCAL_RE.test(cq) || VAGUE_LOCAL_RE.test(query))
+        && (OVERVIEW_RE.test(cq) || OVERVIEW_RE.test(query));
+    const isDomainQuery = DOMAIN_RE.test(query) || DOMAIN_RE.test(cq)
+        || ISLAND_BUOY_RE.test(query) || ISLAND_BUOY_RE.test(cq)
+        || !!detectZoneDeterministic(query) || !!detectZoneDeterministic(cq)
+        || monitorOverview;
```

---

## 3. 라인 위치 요약 (현행 코드 기준 — drift 전)

| 커밋 | 변경 위치 | 행위 |
|------|----------|------|
| C1 | assistant.js:110 직후 (신규) | `buoyToCoords` 함수 삽입 |
| C2 | assistant.js:1278-1279 보강 | get_buoy_observation/nearest 분기에 coords 폴백 |
| C3 | assistant.js:1135 함수 본문 교체 | get_warning zone 비움 분기 추가 (호환 키 보존) |
| C5-pre | assistant.js:1450 의 주석 종료 직후 (canonZone 위) | `VAGUE_LOCAL_RE`/`MONITOR_JIKGUN`/`OVERVIEW_RE`/`_jikgunSlug` 1회 선언 |
| C4 | assistant.js:1502 의 for-루프 `}` 직후 신규 블록 #1 | 부이 follow-up 강제 호출 (`_buoyPlanTools`) |
| C5-a | C4 블록 종료 `}` 직후 신규 블록 #2 | local_gov 강제 호출 (`_lgPlanTools`) |
| C5-b | assistant.js:1548 (isDomainQuery 선언) 교체 | `monitorOverview` AND 추가 |

> 블록 #1 → 블록 #2 순서 고정(synthesis §1.3 #1). 두 블록 모두 `const` 식별자 분리로 컴파일 충돌 방지.

---

## 4. 회귀 검증 시나리오

### 4.1 sentinel 직타 게이트 — N=2 (시점 A 대상)

| 케이스 | 입력 | 패치 전 결과 | 패치 후 기대 | 통과 기준 |
|-------|------|------------|------------|----------|
| **ANG-2-01b** | 선행: "거문도 파고" → 후속: "거기 풍속은?" (profile.purpose="낚시", GPS 무) | synth "그 정보는 없어요" 또는 빈/모호 응답 (FAIL) | C2 가 focus.coords=거문도 좌표 채움 → C4 가 `get_buoy_observation(buoyName="거문도")` 강제 + `get_buoys_with_obs(lat,lon)` 폴백. synth: "거문도 부이 풍속 초속 N미터" 또는 "거문도 결측 — 인근 ○○ 부이는 초속 N미터" | `toolsUsed ⊇ {get_buoy_observation}` + `expect_no_halluc=true` 통과 + 답 ≥ 15자 |
| **LG-1-01** | "관내 어때" (profile.affiliation="시청 방재", GPS 무, default 해역 무) | LLM 이 #23 규칙 무시 → steps=[] → isDomainQuery=false → web_search 폴백 → "어떤 관내인지" 모호 답 (FAIL) | C5-pre 가 `_jikgunSlug='local_gov'` 1회 계산. C5-a 가 `get_warning({})` + `get_typhoon_status({})` 강제 unshift. C3 분기 진입 → `{activeCount:N, warnings:[...]}` 반환. C5-b 가 `monitorOverview=true` → isDomainQuery=true (web_search 차단). synth: "현재 전국에 풍랑주의보 N건…" | `toolsUsed ⊇ {get_warning}` + web_search 호출 0회 + `expect_no_halluc` 통과 |

### 4.2 sentinel 잔여 18건 무회귀

| 케이스 군 | 위험 | 점검 포인트 |
|---------|------|------------|
| **ANG-2-01a** (선행 단독) | C2 의 coords 폴백 부작용 | 첫 턴 `isPronounFollowup=false` → C4 게이트 미발동. C2 만 발동해 focus.coords 신규 채움 → memory 에만 영향(client 가 다음 턴에 더 풍부한 focus 사용) — 다음 턴 ANG-2-01b 직타 의도와 일치. **무회귀** |
| **CG-2-01a/b**, **MOF-6-01a/b** | C4 부이 폴백이 다른 follow-up 쌍에 의도외 도구 추가 | C4 조건 `isPronounFollowup && focusBuoy && !focusZone` 가 좁아 zone 있는 후속(MOF-6 등)은 미발동. 부이 follow-up 만 강화. **체크: focusZone 보존 확인** |
| **LG-4-01, LG-8-01** | C5-a 가 다른 local_gov 케이스에 발동 | VAGUE_LOCAL_RE("관내/우리시/시청 관할/관할…") 미매칭이면 미발동. 구체 지명·해역 query 인 경우 영향 없음. **체크: 두 케이스 query 텍스트가 VAGUE 매칭 안 되는지 확인** |
| **PO-3-01** (public_org) | C5-b `monitorOverview` 가 plan 변경 (X) — isDomainQuery 만 영향 | AND-narrow 로 좁혀 OVERVIEW + VAGUE 동시 충족 시만 발동. 구체 질의는 미발동. **무회귀 추정** |
| **모든 zone 있는 케이스** | C3 응답 키 변경 영향 | zone 인자 있는 호출은 기존 `{zone, warning}` 분기 100% 유지 (조건 `if (!zone || /^전국$/)` 진입 안 함). **무회귀 보장** |
| **TOOL_EXEC.get_warning 의 기존 합성 소비자** | findWarning 결과 키 호환 | C3 의 zone 비움 분기는 `warning:null` 도 함께 포함 → 기존 `result.warning` 접근 코드(line 1739 `findWarning(zone)` 직접 호출은 unchanged) 안전 |

### 4.3 평가셋 N=3 회귀 (synthesis §3.2 Stage III 부분)

| 셋 | 케이스 수 | 시점 A 기대 |
|----|---------|------------|
| `phase2b_sentinel.jsonl` | 20 | 2건 직타 PASS + 18건 유지. 시점 A 후 PASS율 18+2=20 중 ANG/LG 2건 의존 → 최소 18/20(90%) 보장, 직타 성공 시 20/20 |
| `phase2b_eval.jsonl` (구) | N | 기존 PASS율 ±2pp 이내 |
| `phase2b_eval_freevar.jsonl` | 440 | cat2(연속) 48% → 시점 A 적용으로 +5~8pp 부분 상승 (C4 부이 폴백 효과). cat5(비도메인) ±2pp 안정 (C5-b AND-narrow). cat4 는 시점 B 의존이므로 변동 없음 |

### 4.4 시점 A 단독 추가 점검(synthesis 누락 위험 대응)

1. **`buoyToCoords` 오매칭** — "독도" 가 "독도부이" vs "독도등표" 양쪽 매칭 가능. C1 의 *정확 일치 우선* 로직(`b.nname === nn`) 으로 우선 차단 → BUOY_BY_ID 에 "독도" 정확 이름이 있으면 hit. 없으면 includes 폴백 시 첫 매칭. **수동 점검**: `BUOY_BY_ID` 중 동음 부이 목록 확인 (`grep "독도\|마라도\|거문도" buoyLocations.js`).
2. **`detectJikgun(profile)` 캐시** — `_jikgunSlug` 를 함수 상단 1회로 통일(C5-pre). §4.2·§4.3 각 1회 호출 회피.
3. **`needsReplan` 의 results 6개 cap 상호작용** — C4 가 plan.steps 에 최대 2개 더 추가(get_buoy_observation + get_buoys_with_obs). 원본 plan.steps 가 4개 이상이면 cap(6) 초과로 일부 잘림 → 1회 재계획(line 1515) 에서 다시 실행될 가능성. **체크: 후속 풍속 질의의 LLM plan.steps 크기 (보통 1-2개) — 안전**.
4. **TTS 음성 출력**: C2 가 답 본문에는 영향 없음(focus 만 채움). C4 의 추가 도구는 synth 가 "거문도는 풍속 결측 — 인근 ○○부이 초속 N미터" 류로 자연어화 — TTS 규칙(초속 N미터) 정합 유지.

---

## 5. 시점 A 산출 요약

- 8커밋 중 **C1(헬퍼) · C2(focus.coords) · C3(get_warning 전국) · C4(부이 폴백) · C5(LG 강제+isDomain)** 5건의 실코드 diff·라인 위치·검증 시나리오 완비.
- 충돌 봉합 4건 모두 적용: 변수명 `_buoyPlanTools`/`_lgPlanTools` 분리(#1), `VAGUE_LOCAL_RE`/`MONITOR_JIKGUN` 함수 상단 1회 선언(#2), get_warning 응답 키 호환 유지(#4), monitorOverview AND-narrow(S3).
- 코드 수정은 본 문서 범위 밖. 시점 B 산출(`alpha_patch_B_impl.md`)에서 C6·C7·C8 + 통합 회귀 게이트 추가 예정.

---

**한 줄 요약**: `patch_A` 의 ANG-2-01b·LG-1-01 두 결함을 `assistant.js` 5개 위치(L110/L1278/L1135/L1450/L1502/L1548) 에 정착시키는 통합 diff 와 sentinel 직타·잔여 18 무회귀 게이트를 설계 완료. 충돌 봉합 4건(변수명 분리·상수 1회 선언·키 호환·AND-narrow) 적용 확인.
